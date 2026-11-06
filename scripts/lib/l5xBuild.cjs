'use strict';
// l5xBuild.cjs — shared L5X text helpers for the 1163 station builders (forms from build1163EA / build1163S10).
const crypto = require('crypto');

const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, p, q) => p + t + q);
const setRungComment = (r, c) => r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, p, q) => p + c + q);
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
const programBody = (src, name) => { const m = progRe(name).exec(src); return m ? m[0] : null; };
const getRoutine = (body, rn) => { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; };
const putRungs = (body, rn, rungs) => {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(body)) fail('routine not found: ' + rn);
  return body.replace(re, (m, p, inner, q) => p + '\n' + renumber(rungs.join('\n')) + '\n' + q);
};
const tagXml = (body, name) => (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0];
const replaceTagIn = (body, name, xml) => { const old = tagXml(body, name); if (!old) fail('tag not found: ' + name); return body.replace(old, xml); };
const insertBefore = (hay, marker, text, what) => { const i = hay.indexOf(marker); if (i < 0) fail('marker not found: ' + what); return hay.slice(0, i) + text + hay.slice(i); };
const insertAfter = (hay, marker, text, what) => { const i = hay.indexOf(marker); if (i < 0) fail('marker not found: ' + what); const j = i + marker.length; return hay.slice(0, j) + text + hay.slice(j); };
const countOf = (hay, s) => hay.split(s).length - 1;
const rep1 = (src, from, to, what) => { const i = src.indexOf(from); must(i >= 0 && src.indexOf(from, i + 1) < 0, what + ': expected exactly once'); return src.slice(0, i) + to + src.slice(i + from.length); };
const guid = () => '{' + crypto.randomUUID().toUpperCase() + '}';
const moduleXml = (src, name) => (new RegExp('<Module Name="' + name + '"[\\s\\S]*?</Module>').exec(src) || [null])[0] || fail('module not found: ' + name);
const legs = (xs) => xs.length === 1 ? xs[0] : '[' + xs.join(' ,') + ' ]'; // Studio refuses a one-leg branch
const st = (n) => 'XIC(Status.State[' + n + '])';
const states = (ns) => legs(ns.map(st));

// ── tag builders ──
const l5kStr = (s, n) => '[' + s.length + ",'" + s + '$00'.repeat(n - s.length) + "']";
const descXml = (d) => d ? '<Description>\n<![CDATA[' + d + ']]>\n</Description>\n' : '';
const openTag = (name, type, extra) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n';
const l5kReal = (n) => Number(n).toExponential(8).replace(/e([+-])(\d)$/, 'e$10$2');
const decReal = (n) => { const s = String(Number(n)); return s.includes('.') ? s : s + '.0'; };
function scalarTag(name, type, radix, value, { usage, desc, constant } = {}) {
  const dec = type === 'REAL' ? decReal(value) : String(value);
  const l5k = type === 'REAL' ? l5kReal(value) : String(value);
  let head = openTag(name, type, ' Radix="' + radix + '"' + (usage ? ' Usage="' + usage + '"' : ''));
  if (constant) head = head.replace('Constant="false"', 'Constant="true"');
  return head + descXml(desc) +
    '<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + dec + '"/>\n</Data>\n</Tag>';
}
const boolTag = (name, o) => scalarTag(name, 'BOOL', 'Decimal', (o && o.value) || 0, o);
const dintTag = (name, value, o) => scalarTag(name, 'DINT', 'Decimal', value, o);
const sintTag = (name, value, o) => scalarTag(name, 'SINT', 'Decimal', value, o);
const realTag = (name, value, o) => scalarTag(name, 'REAL', 'Float', value, o);
function timerTag(name, pre, desc) {
  return openTag(name, 'TIMER', '') + descXml(desc) + '<Data Format="L5K">\n<![CDATA[[0,' + pre + ',0]]]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="TIMER">\n' +
    '<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="' + pre + '"/>\n<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>\n' +
    '<DataValueMember Name="EN" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TT" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DN" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>';
}
function stringTag(name, desc) {
  return openTag(name, 'STRING', '') + descXml(desc) + '<Data Format="L5K">\n<![CDATA[' + l5kStr('', 82) + ']]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="STRING">\n' +
    '<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[]]>\n</DataValueMember>\n</Structure>\n</Data>\n</Tag>';
}
const strElemDec = (i, s) => '<Element Index="[' + i + ']">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[' + (s ? "'" + s + "'" : '') + ']]>\n</DataValueMember>\n</Structure>\n</Element>';
function stringArrayTag(name, values, dims) {
  const vals = Array.from({ length: dims }, (_, i) => values[i] || '');
  return openTag(name, 'STRING', ' Dimensions="' + dims + '"') + '<Data Format="L5K">\n<![CDATA[[' + vals.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="' + dims + '">\n' + vals.map((s, i) => strElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
const alarmElemL5K = (s) => '[0,0,0,0,' + l5kStr(s, 100) + ',0,0,0,0]';
const alarmElemDec = (i, s) => '<Element Index="[' + i + ']">\n<Structure DataType="AlarmData">\n' +
  ['ProgramID', 'AlarmID', 'Severity', 'Group'].map((m) => '<DataValueMember Name="' + m + '" DataType="INT" Radix="Decimal" Value="0"/>').join('\n') +
  '\n<StructureMember Name="Message" DataType="STRING100">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII">\n<![CDATA[' + (s ? "'" + s + "'" : '') + ']]>\n</DataValueMember>\n</StructureMember>\n' +
  '<DataValueMember Name="TimeStamp" DataType="LINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Duration" DataType="DINT" Radix="Decimal" Value="0"/>\n' +
  '<DataValueMember Name="Active" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DoNotSaveToHistory" DataType="BOOL" Value="0"/>\n<DataValueMember Name="HMI_ResetCount" DataType="BOOL" Value="0"/>\n</Structure>\n</Element>';
function alarmArrayTag(name, prefix, messages, dims) {
  const vals = Array.from({ length: dims }, (_, i) => messages[i] ? prefix + messages[i] : '');
  return openTag(name, 'AlarmData', ' Dimensions="' + dims + '"') + '<Data Format="L5K">\n<![CDATA[[' + vals.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + dims + '">\n' + vals.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function dintCommentTag(name, comments) {
  const cm = comments.length ? '<Comments>\n' + comments.map(([bit, c]) => '<Comment Operand=".' + bit + '">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n' : '';
  return openTag(name, 'DINT', ' Radix="Decimal"') + cm + '<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="DINT" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>';
}
function copyTag(body, srcName, newName, desc) {
  let t = tagXml(body, srcName) || fail('example tag not found: ' + srcName);
  t = t.replace('<Tag Name="' + srcName + '"', '<Tag Name="' + newName + '"');
  if (desc !== undefined) {
    t = /<Description>/.test(t) ? t.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>\n?/, desc ? descXml(desc) : '') : t.replace(/(<Tag [^>]*>\n)/, '$1' + descXml(desc));
  }
  return t;
}
// ServoOverall with seeded positions (copied from an existing HMI_<axis> tag)
function hmiAxisTag(body, srcName, newName, positions) {
  let t = copyTag(body, srcName, newName, '');
  if (!positions.length) return t;
  const twelve = /\[((?:0\.00000000e\+000[,\s]*){12})\]/;
  must(twelve.test(t), newName + ': Positions[12] L5K');
  const vals = Array.from({ length: 12 }, (_, i) => positions[i] || 0);
  t = t.replace(twelve, '[' + vals.map(l5kReal).join(',') + ']');
  t = t.replace(/(<ArrayMember Name="Positions" DataType="REAL" Dimensions="12" Radix="Float">)([\s\S]*?)(<\/ArrayMember>)/, (m, p, inner, q) => p + '\n' + vals.map((val, i) => '<Element Index="[' + i + ']" Value="' + decReal(val) + '"/>').join('\n') + '\n' + q);
  return t;
}
function statusTag(srcBody, stateComments) {
  let t = tagXml(srcBody, 'Status') || fail('Status tag');
  const cm = '<Comments>\n' + Object.entries(stateComments).map(([n, c]) => '<Comment Operand=".STATE[' + n + ']">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n';
  t = /<Comments>/.test(t) ? t.replace(/<Comments>[\s\S]*?<\/Comments>\n?/, cm) : t.replace(/(<Tag [^>]*>\n)/, '$1' + cm);
  return t;
}
function programXml(name, tags, routines) {
  const names = tags.map((t) => /<Tag Name="([^"]+)"/.exec(t)[1]);
  must(new Set(names).size === names.length, 'duplicate tag: ' + names.filter((n, i) => names.indexOf(n) !== i).join(','));
  for (const t of tags) for (const m of t.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) must(m[1].length <= 30, 'description over 30 chars: ' + m[1]);
  const sorted = tags.slice().sort((a, b) => { const na = /<Tag Name="([^"]+)"/.exec(a)[1].toLowerCase(), nb = /<Tag Name="([^"]+)"/.exec(b)[1].toLowerCase(); return na < nb ? -1 : na > nb ? 1 : 0; });
  const rts = routines.map((r) => '<Routine Name="' + r.name + '" Type="RLL">\n<RLLContent>\n' + renumber(r.rungs.map(([c, t]) => newRung(c, t)).join('\n')) + '\n</RLLContent>\n</Routine>').join('\n');
  return '<Program Name="' + name + '" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">\n<Tags>\n' + sorted.join('\n') + '\n</Tags>\n<Routines>\n' + rts + '\n</Routines>\n</Program>';
}
// ── the standard device-output rung: one rung carrying both modes (Jason, 2026-09-01) ──
// onStates / offStates are rung fragments; extra is a permissive on both modes (may be '').
const outputRung = (out, onStates, sealOff, momOn, momOff, extra = '') =>
  '[XIO(Status.State[1]) ' + extra + '[' + onStates + ' ,XIC(' + out + ') ' + sealOff + ' ] ,XIC(Status.State[1]) ' + extra + '[XIC(HMI_Momentary.' + momOn + ') ,XIC(' + out + ') XIO(HMI_Momentary.' + momOff + ') ] ]OTE(' + out + ');';
// sealed waiting-for fault (Jason 2026-10-19 / 11-05): states, fault time, optional "not done" condition
const waitAlarm = (i, stateList, ms, notDone, onsBit) =>
  '[' + states(stateList) + ' MOVE(' + ms + ',Control.FaultTime) XIC(Status.TimeoutFlt) ' + (notDone || '') + ',XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(' + onsBit + ') CONCAT(g_L2StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];';
const warnAlarm = (i, cond, onsBit) =>
  cond + '[OTE(Alarm[' + i + '].Active) ,ONS(' + onsBit + ') MOVE(1,Alarm[' + i + '].Severity) CONCAT(g_L2StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];';
const sealedAlarm = (i, cond, onsBit) =>
  '[' + cond + ' ,XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(' + onsBit + ') CONCAT(g_L2StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];';

module.exports = { fail, must, cdataOf, rungList, rungText, setRungText, setRungComment, newRung, renumber, progRe, programBody, getRoutine, putRungs, tagXml, replaceTagIn,
  insertBefore, insertAfter, countOf, rep1, guid, moduleXml, legs, st, states, l5kStr, descXml, openTag, l5kReal, decReal, scalarTag, boolTag, dintTag, sintTag, realTag, timerTag,
  stringTag, strElemDec, stringArrayTag, alarmElemL5K, alarmElemDec, alarmArrayTag, dintCommentTag, copyTag, hmiAxisTag, statusTag, programXml, outputRung, waitAlarm, warnAlarm, sealedAlarm };
