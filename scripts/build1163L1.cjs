'use strict';
// build1163L1.cjs — 1163 v0.8 on the v0.7.6 stamp (Jason, 2026-11-05 plan, built 2026-11-06).
// L1 indexer tracking: the L2 Tracking_* UDTs become L2Tracking_*, a new L1Tracking_* family carries two parts per nest
// (A upstream, B downstream, the 1160 nest record without Recycle / Sample) with Station[9] and Nest[19]; L1_Tracking and
// L1_S00_IndexerNoSP are the L2 programs re-pointed (one nest per index, p_StationPositionA / B per part, R05 per part);
// the L1 indexer drive sd21_L1Indexer / axis a21_L1Indexer (IP tab .110) is cloned from sd01 / a01 with the L2 safety form;
// Supervisor, Alarms, HMI and the task take the two programs. HMI_NestIndicator -> HMI_L2NestIndicator (+ L1 A / B).
// L2 tracking and indexer LOGIC untouched (Jason, Nov 6). No L1 stations (designs not final): the indexer's station
// inputs and the StationCompleteTimes rungs sit on AlwaysOff as in v0.1. D017.
//   node scripts/build1163L1.cjs [--dry]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const BASE = H + '/1163_Haemonetics_v0.7.6_2026-11-05.L5X';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.8';
const ISO = new Date().toISOString().slice(0, 10), SHORT = 'Nov 6';
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const NESTS = 18, STATIONS = 8;                       // L1: 18 nests, positions 1..8 active
const POS_A = [0, 1, 3, 0, 5, 0, 0, 0, 8];            // upstream part position per station number
const POS_B = [0, 1, 2, 0, 4, 0, 0, 0, 8];            // downstream part position per station number
const UNLOAD = 8;
const DRIVE = 'sd21_L1Indexer', AXIS = 'a21_L1Indexer', IP = '10.68.167.110';
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
let x = fs.readFileSync(BASE, 'utf8');

// ── helpers (build1163S10.cjs forms) ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const rungComment = (r) => ((/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(r) || [])[1] || '').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, p, q) => p + t + q);
const setRungComment = (r, c) => /<Comment>/.test(r) ? r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, p, q) => p + c + q) : r.replace(/(<Rung\b[^>]*>\n)/, '$1<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n');
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
const programBody = (src, name) => { const m = progRe(name).exec(src); return m ? m[0] : null; };
const replaceProgram = (name, body) => { const m = progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const getRoutine = (body, rn) => { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; };
const putRungs = (body, rn, rungs) => { const old = getRoutine(body, rn); must(old != null, 'routine ' + rn); return body.replace(old, '\n' + renumber(rungs.join('\n')) + '\n'); };
const editRoutineIn = (body, rn, fn) => putRungs(body, rn, fn(rungList(getRoutine(body, rn) || fail('no routine ' + rn))));
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = editRoutineIn(b, rn, fn); replaceProgram(prog, b); };
const stLines = (lines) => '<STContent>\n' + lines.map((l, i) => '<Line Number="' + i + '">\n<![CDATA[' + l + ']]>\n</Line>').join('\n') + '\n</STContent>';
const putST = (body, rn, lines) => { const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[^>]*>\\s*)<STContent>[\\s\\S]*?</STContent>'); must(re.test(body), 'ST routine ' + rn); return body.replace(re, (m, p) => p + stLines(lines)); };
const getST = (body, rn) => { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[^>]*>\\s*<STContent>([\\s\\S]*?)</STContent>').exec(body) || fail('ST routine ' + rn); return [...m[1].matchAll(/<Line Number="\d+">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((l) => l[1]); };
const tagXml = (body, name) => (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0];
const rep1 = (src, from, to, what) => { const i = src.indexOf(from); must(i >= 0 && src.indexOf(from, i + 1) < 0, what + ': expected exactly once'); return src.slice(0, i) + to + src.slice(i + from.length); };
const repAll = (src, from, to, what, n) => { const c = src.split(from).length - 1; must(n == null ? c > 0 : c === n, what + ': expected ' + (n == null ? '>0' : n) + ', found ' + c); return src.split(from).join(to); };
const countOf = (hay, s) => hay.split(s).length - 1;
const norm = (s) => s.replace(/\s+/g, '');
const l5kStr = (s, n) => '[' + s.length + ",'" + s + '$00'.repeat(n - s.length) + "']";
const descXml = (d) => d ? '<Description>\n<![CDATA[' + d + ']]>\n</Description>\n' : '';
const openTag = (name, type, extra) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n';
const REAL0 = '0.00000000e+000';
const scalarTag = (name, type, radix, value, desc, usage) => openTag(name, type, ' Radix="' + radix + '"' + (usage ? ' Usage="' + usage + '"' : '')) + descXml(desc) +
  '<Data Format="L5K">\n<![CDATA[' + String(value) + ']]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + String(value) + '"/>\n</Data>\n</Tag>';
const dintTag = (name, desc) => scalarTag(name, 'DINT', 'Decimal', 0, desc);
const boolTag = (name, desc) => scalarTag(name, 'BOOL', 'Decimal', 0, desc);
function arrayTag(name, type, radix, vals, dims, opts) {
  const o = opts || {};
  const v = Array.from({ length: dims }, (_, i) => vals[i] != null ? vals[i] : (type === 'REAL' ? 0 : 0));
  const l5 = (n) => type === 'REAL' ? (n === 0 ? REAL0 : Number(n).toExponential(8).replace(/e([+-])(\d)$/, 'e$10$2')) : String(n);
  const dec = (n) => type === 'REAL' ? (n === 0 ? '0.0' : String(n)) : String(n);
  return openTag(name, type, ' Dimensions="' + dims + '" Radix="' + radix + '"' + (o.usage ? ' Usage="' + o.usage + '"' : '')) + descXml(o.desc) +
    '<Data Format="L5K">\n<![CDATA[[' + v.map(l5).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="' + type + '" Dimensions="' + dims + '" Radix="' + radix + '">\n' +
    v.map((n, i) => '<Element Index="[' + i + ']" Value="' + dec(n) + '"/>').join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
const dintArrayTag = (name, vals, dims, opts) => arrayTag(name, 'DINT', 'Decimal', vals, dims, opts);
const realArrayTag = (name, vals, dims, opts) => arrayTag(name, 'REAL', 'Float', vals, dims, opts);
function stringArrayTag(name, values, dims) {
  const vals = Array.from({ length: dims }, (_, i) => values[i] || '');
  const dec = (i, s) => '<Element Index="[' + i + ']">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[' + (s ? "'" + s + "'" : '') + ']]>\n</DataValueMember>\n</Structure>\n</Element>';
  return openTag(name, 'STRING', ' Dimensions="' + dims + '"') + '<Data Format="L5K">\n<![CDATA[[' + vals.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="' + dims + '">\n' + vals.map((s, i) => dec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
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
const stringsOf = (listXml) => [...listXml.matchAll(/<DataValueMember Name="DATA" DataType="STRING[0-9]*" Radix="ASCII">\s*<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[1] || '');
// L5K array splitter: '[a,b,c]' -> ['a','b','c'] (nested brackets, quoted strings, whitespace dropped)
function splitTop(s) {
  s = s.trim(); must(s[0] === '[' && s[s.length - 1] === ']', 'L5K array');
  const out = []; let depth = 0, cur = '', q = false;
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === "'") q = false; continue; }
    if (ch === "'") { q = true; cur += ch; continue; }
    if (/\s/.test(ch)) continue;
    if (ch === '[') depth++; else if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
// depth-aware XML block: from the open tag at `from` to its matching close
function block(s, from, open, close) {
  const i = s.indexOf(from); must(i >= 0, 'block ' + from.slice(0, 60));
  let depth = 0, j = i;
  const reO = new RegExp('<' + open + '[\\s>]', 'g'), reC = new RegExp('</' + close + '>', 'g');
  for (;;) {
    reO.lastIndex = j; reC.lastIndex = j;
    const o = reO.exec(s), c = reC.exec(s); must(c, 'unclosed ' + open);
    if (o && o.index < c.index) { depth++; j = o.index + 1; } else { depth--; j = c.index + c[0].length; if (depth === 0) return s.slice(i, j); }
  }
}
const newGuid = () => '{' + crypto.randomUUID().toUpperCase() + '}';

// ═══ 1. L2 UDTs renamed L2Tracking_* (type names only; Tracking_*_Op_Status and Tracking_Perform_* stay shared) ═══
const five = ['Data', 'Nest', 'Part_Assy_Stat', 'Process_Op_Result', 'Station'];
const before = five.map((n) => countOf(x, 'Tracking_' + n));
x = x.replace(/\bTracking_(Data|Nest|Part_Assy_Stat|Process_Op_Result|Station)\b/g, 'L2Tracking_$1');
for (const n of five) must(!new RegExp('[^2]Tracking_' + n + '\\b').test(x.replace(/ZZZZZZZZZZTracking_/g, '')), 'unprefixed Tracking_' + n + ' remains');
must(/<Tag Name="p_Data" TagType="Base" DataType="L2Tracking_Data"/.test(x) && /<Tag Name="ZeroPartAssyStat" TagType="Base" DataType="L2Tracking_Part_Assy_Stat"/.test(x), 'L2_Tracking declarations');
must(countOf(x, 'Tracking_Nest_Op_Status') === countOf(fs.readFileSync(BASE, 'utf8'), 'Tracking_Nest_Op_Status'), 'shared Op_Status UDT untouched');
console.log('L2 UDTs renamed: ' + five.map((n, i) => n + ' x' + before[i]).join(', '));

// ═══ 2. L1Tracking_* UDTs ════════════════════════════════════════════════════
const mem = (name, type, dim, radix, extra, desc) => '<Member Name="' + name + '" DataType="' + type + '" Dimension="' + dim + '" Radix="' + radix + '" Hidden="false"' + (extra || '') + ' ExternalAccess="Read/Write"' + (desc ? '>\n<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n</Member>' : '/>');
const hidden = (name) => '<Member Name="' + name + '" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>';
const bit = (name, target, n, desc) => mem(name, 'BIT', 0, 'Decimal', ' Target="' + target + '" BitNumber="' + n + '"', desc);
const udt = (name, desc, members) => '<DataType Name="' + name + '" Family="NoFamily" Class="User">\n' + descXml(desc) + '<Members>\n' + members.join('\n') + '\n</Members>\n</DataType>';
const HID = 'ZZZZZZZZZZL1Tracking0';
const PART_BITS = ['GoodA', 'BadA', 'PartLoadedA', 'GoodB', 'BadB', 'PartLoadedB'];
const OP_BITS = ['AttemptA', 'SuccessA', 'FailureA', 'LockoutA', 'AttemptB', 'SuccessB', 'FailureB', 'LockoutB'];
const OP_DESC = { Attempt: 'Process Attempted', Success: 'Process Completed Successful', Failure: 'Process Failed', Lockout: 'Station Was In Lockout Mode When Nest Present' };
const sideWord = (s) => s === 'A' ? 'Upstream Part (A)' : 'Downstream Part (B)';
const L1_UDTS = [
  udt('L1Tracking_Data', '', [mem('Nest', 'L1Tracking_Nest', NESTS + 1, 'NullType'), mem('Station', 'L1Tracking_Station', STATIONS + 1, 'NullType')]),
  udt('L1Tracking_Nest', 'Tracking Data\nL1 Nests - Two Parts Per Nest', [
    mem('OpStatus', 'Tracking_Nest_Op_Status', 0, 'NullType', '', 'Nest Operational Status'),
    mem('PartStatus', 'L1Tracking_Part_Assy_Stat', 0, 'NullType', '', 'Assembly Status From All Stations For The Two Parts In The Nest'),
    mem('PerformData', 'Tracking_Perform_Nest', 0, 'NullType', '', 'Nest Performance Data')]),
  udt('L1Tracking_Part_Assy_Stat', 'Tracking Part Assembly Status From Stations\nA = Upstream Part, B = Downstream Part', [
    hidden(HID), ...PART_BITS.map((b, i) => bit(b, HID, i)),
    mem('Station', 'L1Tracking_Process_Op_Result', STATIONS + 1, 'NullType'),
    mem('FailureTypeA', 'INT', 0, 'Decimal', '', 'Failure (Reject ) Type - Station Num + Inc Number 0-9'),
    mem('FailureMessageA', 'STRING', 0, 'NullType', '', 'Failure Type Description'),
    mem('FailureTypeB', 'INT', 0, 'Decimal', '', 'Failure (Reject ) Type - Station Num + Inc Number 0-9'),
    mem('FailureMessageB', 'STRING', 0, 'NullType', '', 'Failure Type Description')]),
  udt('L1Tracking_Process_Op_Result', 'Tracking\nProcess Operation Results\nA = Upstream Part, B = Downstream Part', [
    hidden(HID), ...OP_BITS.map((b, i) => bit(b, HID, i, OP_DESC[b.slice(0, -1)] + ' - ' + sideWord(b.slice(-1))))]),
  udt('L1Tracking_Station', 'Tracking Data\nAssembly Stations', [
    mem('OpStatus', 'Tracking_Station_Op_Status', 0, 'NullType', '', 'Station Operational Status'),
    mem('NestNumA', 'DINT', 0, 'Decimal', '', 'Nest Number At Station - ' + sideWord('A')),
    mem('NestNumB', 'DINT', 0, 'Decimal', '', 'Nest Number At Station - ' + sideWord('B')),
    mem('PerformData', 'Tracking_Perform_Station', 0, 'NullType', '', 'Station Performance Data')]),
];
x = rep1(x, '<DataType Name="L2Tracking_Data"', L1_UDTS.join('\n') + '\n<DataType Name="L2Tracking_Data"', 'UDT insert');

// ═══ 3. tracking data generators, proven on L2 before use on L1 ═════════════
const L2T = programBody(x, 'L2_Tracking') || fail('L2_Tracking');
const pDataL2 = tagXml(L2T, 'p_Data');
const l5kOf = (tag) => cdataOf((/<Data Format="L5K">([\s\S]*?)<\/Data>/.exec(tag) || [])[1]);
const decOf = (tag) => (/<Data Format="Decorated">\s*([\s\S]*?)\s*<\/Data>\s*<\/Tag>/.exec(tag) || [])[1];
const [nestsL5K, stationsL5K] = splitTop(l5kOf(pDataL2)).map(splitTop);
must(nestsL5K.length === 65 && stationsL5K.length === 17, 'L2 p_Data L5K shape ' + nestsL5K.length + '/' + stationsL5K.length);
const STATION_L5K = stationsL5K[0];
const PERFORM_L5K = '[0,0,0,' + REAL0 + ',' + REAL0 + ',0,0,0]';
const partL5Kn = (nSt, fails) => '[0,[' + Array(nSt).fill('[0]').join(',') + ']' + fails.map(() => ',0,' + l5kStr('', 82)).join('') + ']';
const nestL5K = (nSt, fails) => '[[0],' + partL5Kn(nSt, fails) + ',' + PERFORM_L5K + ']';
must(norm(nestL5K(17, [''])) === norm(nestsL5K[0]), 'L5K nest generator does not reproduce L2');
const decL2 = decOf(pDataL2);
const nestDecL2 = block(decL2, '<Element Index="[0]">', 'Element', 'Element');
const OPSTATUS_DEC = block(nestDecL2, '<StructureMember Name="OpStatus"', 'StructureMember', 'StructureMember');
const PERFORM_DEC = block(nestDecL2, '<StructureMember Name="PerformData"', 'StructureMember', 'StructureMember');
const stationDecL2 = block(decL2.slice(decL2.indexOf('<ArrayMember Name="Station" DataType="L2Tracking_Station"')), '<Element Index="[0]">', 'Element', 'Element');
const bitsDec = (names) => names.map((n) => '<DataValueMember Name="' + n + '" DataType="BOOL" Value="0"/>').join('\n');
const strMemberDec = (name) => '<StructureMember Name="' + name + '" DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[]]>\n</DataValueMember>\n</StructureMember>';
const partMembersDec = (c) => bitsDec(c.partBits) + '\n<ArrayMember Name="Station" DataType="' + c.opType + '" Dimensions="' + c.nSt + '">\n' +
  Array.from({ length: c.nSt }, (_, i) => '<Element Index="[' + i + ']">\n<Structure DataType="' + c.opType + '">\n' + bitsDec(c.opBits) + '\n</Structure>\n</Element>').join('\n') +
  '\n</ArrayMember>\n' + c.fails.map((s) => '<DataValueMember Name="FailureType' + s + '" DataType="INT" Radix="Decimal" Value="0"/>\n' + strMemberDec('FailureMessage' + s)).join('\n');
const nestDec = (c, i) => '<Element Index="[' + i + ']">\n<Structure DataType="' + c.nestType + '">\n' + OPSTATUS_DEC + '\n<StructureMember Name="PartStatus" DataType="' + c.partType + '">\n' + partMembersDec(c) + '\n</StructureMember>\n' + PERFORM_DEC + '\n</Structure>\n</Element>';
const stationDec = (c, i) => stationDecL2.replace('<Element Index="[0]">', '<Element Index="[' + i + ']">').replace(/L2Tracking_Station/g, c.stationType);
const pDataDec = (c) => '<Structure DataType="' + c.dataType + '">\n<ArrayMember Name="Nest" DataType="' + c.nestType + '" Dimensions="' + c.nNest + '">\n' + Array.from({ length: c.nNest }, (_, i) => nestDec(c, i)).join('\n') +
  '\n</ArrayMember>\n<ArrayMember Name="Station" DataType="' + c.stationType + '" Dimensions="' + c.nSt + '">\n' + Array.from({ length: c.nSt }, (_, i) => stationDec(c, i)).join('\n') + '\n</ArrayMember>\n</Structure>';
const pDataL5K = (c) => '[[' + Array(c.nNest).fill(nestL5K(c.nSt, c.fails)).join(',') + '],[' + Array(c.nSt).fill(STATION_L5K).join(',') + ']]';
const pDataTag = (c) => '<Tag Name="p_Data" TagType="Base" DataType="' + c.dataType + '" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[' + pDataL5K(c) + ']]>\n</Data>\n<Data Format="Decorated">\n' + pDataDec(c) + '\n</Data>\n</Tag>';
const zeroTag = (c) => '<Tag Name="ZeroPartAssyStat" TagType="Base" DataType="' + c.partType + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[' + partL5Kn(c.nSt, c.fails) + ']]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="' + c.partType + '">\n' + partMembersDec(c) + '\n</Structure>\n</Data>\n</Tag>';
const CFG2 = { dataType: 'L2Tracking_Data', nestType: 'L2Tracking_Nest', partType: 'L2Tracking_Part_Assy_Stat', stationType: 'L2Tracking_Station', opType: 'L2Tracking_Process_Op_Result', nNest: 65, nSt: 17, partBits: ['Good', 'Bad', 'PartLoaded'], opBits: ['Attempt', 'Success', 'Failure', 'Lockout'], fails: [''] };
const CFG1 = { dataType: 'L1Tracking_Data', nestType: 'L1Tracking_Nest', partType: 'L1Tracking_Part_Assy_Stat', stationType: 'L1Tracking_Station', opType: 'L1Tracking_Process_Op_Result', nNest: NESTS + 1, nSt: STATIONS + 1, partBits: PART_BITS, opBits: OP_BITS, fails: ['A', 'B'] };
must(norm(pDataTag(CFG2)) === norm(pDataL2), 'p_Data generator does not reproduce L2_Tracking.p_Data');
must(norm(zeroTag(CFG2)) === norm(tagXml(L2T, 'ZeroPartAssyStat')), 'ZeroPartAssyStat generator does not reproduce L2');
console.log('tracking data generators reproduce L2 p_Data (' + pDataL2.length + ' chars) and ZeroPartAssyStat');

// ═══ 4. L1_Tracking from L2_Tracking ═════════════════════════════════════════
let T = L2T.replace('<Program Name="L2_Tracking"', '<Program Name="L1_Tracking"').replace(/L2Tracking_/g, 'L1Tracking_');
T = T.replace(tagXml(T, 'p_Data'), pDataTag(CFG1));
T = T.replace(tagXml(T, 'ZeroPartAssyStat'), zeroTag(CFG1));
T = T.replace(tagXml(T, 'ResetTimersA'), dintArrayTag('ResetTimersA', [], NESTS + 1));
T = T.replace(tagXml(T, 'ResetTimersB'), dintArrayTag('ResetTimersB', [], STATIONS + 1));
T = T.replace(tagXml(T, 'p_StationPosition'), dintArrayTag('p_StationPositionA', POS_A, STATIONS + 1, { usage: 'Public', desc: 'Upstream Part Position' }) + '\n' + dintArrayTag('p_StationPositionB', POS_B, STATIONS + 1, { usage: 'Public', desc: 'Downstream Part Position' }));
T = editRoutineIn(T, 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t.startsWith('MOVE(p_Data.Station[11].NestNumA,FailureNestNumA)')) return setRungComment(setRungText(rg, 'MOVE(p_Data.Station[' + UNLOAD + '].NestNumA,FailureNestNumA)MOVE(p_Data.Station[' + UNLOAD + '].NestNumB,FailureNestNumB);'), 'Nest Numbers At The Unload Station - Reject');
  if (t.startsWith('MOVE(p_Data.Station[12].NestNumA,SuccessNestNumA)')) return setRungComment(setRungText(rg, 'MOVE(p_Data.Station[' + UNLOAD + '].NestNumA,SuccessNestNumA)MOVE(p_Data.Station[' + UNLOAD + '].NestNumB,SuccessNestNumB);'), 'Nest Numbers At The Unload Station - Good');
  return rg;
}));
must(countOf(T, 'Station[' + UNLOAD + '].NestNum') === 4 && !/Station\[1[12]\]/.test(T), 'L1_Tracking R01 unload station');
const r05side = (s) => [
  '	//' + sideWord(s),
  '	NestSuccess := 0;',
  '	NestFailure := 0;',
  '	MyNestNum := p_Data.Station[StationNum].NestNum' + s + ';',
  '	//Check stations at or before this one by the physical position of the ' + (s === 'A' ? 'upstream' : 'downstream') + ' part (p_StationPosition' + s + ')',
  '	FOR StationNum2 := 0 TO p_StationQty BY 1 DO',
  '		IF p_Data.Nest[MyNestNum].PartStatus.PartLoaded' + s + ' AND (p_StationPosition' + s + '[StationNum2] <= p_StationPosition' + s + '[StationNum]) THEN',
  '			IF (p_Data.Nest[MyNestNum].PartStatus.Station[StationNum2].Failure' + s + ' AND NOT p_Data.Nest[MyNestNum].PartStatus.Station[StationNum2].Lockout' + s + ') THEN',
  '				NestFailure := 1;',
  '				NestSuccess := 0;',
  '				EXIT;',
  '			ELSIF (p_Data.Nest[MyNestNum].PartStatus.Station[StationNum2].Success' + s + ' OR p_Data.Nest[MyNestNum].PartStatus.Station[StationNum2].Lockout' + s + ') THEN',
  '				NestFailure := 0;',
  '				NestSuccess := 1;',
  '			END_IF;',
  '		END_IF;',
  '	END_FOR;',
  '	IF (NestSuccess) THEN',
  '		p_Data.Nest[MyNestNum].PartStatus.Bad' + s + ' := 0;',
  '		p_Data.Nest[MyNestNum].PartStatus.Good' + s + ' := 1;',
  '	ELSIF (NestFailure) THEN',
  '		p_Data.Nest[MyNestNum].PartStatus.Bad' + s + ' := 1;',
  '		p_Data.Nest[MyNestNum].PartStatus.Good' + s + ' := 0;',
  '	ELSE',
  '		p_Data.Nest[MyNestNum].PartStatus.Bad' + s + ' := 0;',
  '		p_Data.Nest[MyNestNum].PartStatus.Good' + s + ' := 0;',
  '	END_IF;'];
T = putST(T, 'R05_PartOverallStatus', [
  '//Overall part status for both parts in the nest at every station - A upstream, B downstream',
  '//A station number with position 0 is not used and is skipped',
  'FOR StationNum := 1 TO p_StationQty BY 1 DO',
  'IF (p_StationPositionA[StationNum] > 0) THEN',
  ...r05side('A'),
  ...r05side('B'),
  'END_IF;',
  'END_FOR;']);
for (const k of ['Side', 'StationNum', 'StationNum2', 'MyNestNum', 'NestSuccess', 'NestFailure']) must(tagXml(T, k), 'L1_Tracking tag ' + k);
must(!/\bStation\[StationNum2\]\.(Success|Failure)\b/.test(getST(T, 'R05_PartOverallStatus').join('\n')), 'R05 side suffixes');
must(countOf(T, 'L2Tracking_') === 0 && countOf(T, 'Dimensions="65"') === 0 && countOf(T, 'Dimensions="17"') === 0, 'L1_Tracking leftovers');

// ═══ 5. L1_S00_IndexerNoSP from L2_S00_IndexerNoSP ═══════════════════════════
const S2 = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00');
let S = S2.replace('<Program Name="L2_S00_IndexerNoSP"', '<Program Name="L1_S00_IndexerNoSP"');
S = repAll(S, '\\L2_Tracking.', '\\L1_Tracking.', 'L1_S00 tracking refs');
S = repAll(S, 'g_StationList[', 'g_L1StationList[', 'L1_S00 station list');
S = S.replace(tagXml(S, 'NestsPerIndex'), tagXml(S, 'NestsPerIndex').replace('<![CDATA[2.00000000e+000]]>', '<![CDATA[1.00000000e+000]]>').replace('Value="2.0"', 'Value="1.0"'));
must(/<Tag Name="NestsPerIndex"[\s\S]*?1\.00000000e\+000[\s\S]*?Value="1\.0"/.test(tagXml(S, 'NestsPerIndex')), 'NestsPerIndex 1.0');
S = S.replace(tagXml(S, 'StationCompleteTimes'), realArrayTag('StationCompleteTimes', [], STATIONS + 1));
const PFX = 'L1S00 Indexer: ';
const aList = stringsOf(tagXml(S, 'AlarmList')), sList = stringsOf(tagXml(S, 'ServoAlarmList'));
must(aList.length === 10 && sList.length === 6, 'L1_S00 alarm lists ' + aList.length + '/' + sList.length);
S = S.replace(tagXml(S, 'Alarm'), alarmArrayTag('Alarm', PFX, aList, 10));
S = S.replace(tagXml(S, 'ServoAlarm'), alarmArrayTag('ServoAlarm', PFX, sList, 6));
// R01: no stations yet - stations complete on the delay alone, actuators safe and pause on AlwaysOff (v0.1 form)
let hits = 0;
S = editRoutineIn(S, 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (/OTE\(StationsComplete\);$/.test(t)) { hits++; return setRungComment(setRungText(rg, 'XIC(Status.State[4])TON(StationsCompleteDelay,?,?)XIC(StationsCompleteDelay.DN)ONS(ONS.6)OTE(StationsComplete);'), 'All Stations Complete - add your station'); }
  if (/OTE\(ActuatorsSafe\);$/.test(t)) { hits++; return setRungComment(setRungText(rg, 'XIC(g_MachineBasic.AlwaysOff)OTE(ActuatorsSafe);'), 'All Actuators Safe - add your station'); }
  if (/OTE\(Pause\);$/.test(t)) { hits++; return setRungComment(setRungText(rg, 'XIC(g_MachineBasic.AlwaysOff)OTE(Pause);'), 'Move The Indexer Into Pause - add your station'); }
  return rg;
}));
must(hits === 3 && !S.includes('L2_S10'), 'L1_S00 R01 station rungs');
// R03: StationCompleteTimes per planned station, on AlwaysOff until the station exists (template ONS bits)
const SCT = [[1, 7], [2, 8], [4, 9], [8, 24]];
for (const [, b] of SCT) must(!S.includes('ONS(ONS.' + b + ')'), 'ONS.' + b + ' in use');
S = editRoutineIn(S, 'R03_StateLogic', (r) => [...r, ...SCT.map(([n, b], i) => newRung(i === 0 ? 'Record Ok To Index For Each Station - Replace AlwaysOff With The Station q_StationComplete' : '', 'XIC(g_MachineBasic.AlwaysOff)ONS(ONS.' + b + ')DIV(CycleTimer.ACC,1000,StationCompleteTimes[' + n + ']);'))]);
// R10: one nest per index, A and B nests per station from the two position tables
const TR = '\\L1_Tracking.';
S = putST(S, 'R10_CalcDialStationNestNums', [
  '//Nest numbers for every station: one index moves one nest; each nest carries two parts, A upstream and B downstream',
  '//Station[0] is the nest one index upstream of station 1 - the nest arriving next, which S01 reads as its incoming nest',
  '//p_StationPositionA / p_StationPositionB give the physical position each station works on per part - a station on two positions (2/3, 4/5) reads A from the upstream nest and B from the downstream one',
  'NewNestNum := ((TRUNC(iq_IndexerAxis.ActualPosition + OnStationTolNests) + (' + TR + 'p_NestQty - 1)) MOD ' + TR + 'p_NestQty) + 1;',
  'IF (' + TR + 'p_Data.Station[1].NestNumA = NewNestNum) THEN',
  '	NestsShiftedPulse := 0;',
  'ELSE',
  '	' + TR + 'p_Data.Station[1].NestNumA := NewNestNum;',
  '	NestsShiftedPulse := 1;',
  'END_IF;',
  'FOR StationNum := 0 TO ' + TR + 'p_StationQty BY 1 DO',
  '	' + TR + 'p_Data.Station[StationNum].NestNumA := (NewNestNum - 1 - (' + TR + 'p_StationPositionA[StationNum] - 1) + ' + TR + 'p_NestQty) MOD ' + TR + 'p_NestQty + 1;',
  '	' + TR + 'p_Data.Station[StationNum].NestNumB := (NewNestNum - 1 - (' + TR + 'p_StationPositionB[StationNum] - 1) + ' + TR + 'p_NestQty) MOD ' + TR + 'p_NestQty + 1;',
  'END_FOR;']);
must(countOf(S, 'L2_') === 0 && countOf(S, 'p_StationPosition[') === 0, 'L1_S00 leftovers');
// the indexer's own alarm text is the L1 station list, checked through g_L1StationList[0] below

// ═══ 6. controller scope: station lists, axis, drive, connection, schedule ══
const gslOld = tagXml(x, 'g_StationList');
const gsl = stringsOf(gslOld); must(gsl.length === 17 && gsl[0] === 'S00 Indexer: ', 'g_StationList');
gsl[0] = 'L2S00 Indexer: ';
const ctrlStringArray = (name, vals, dims) => stringArrayTag(name, vals, dims).replace('<Tag Name="' + name + '" TagType="Base"', '<Tag Name="' + name + '" Class="Standard" TagType="Base"');
must(norm(ctrlStringArray('g_StationList', stringsOf(gslOld), 17)) === norm(gslOld), 'g_StationList generator does not reproduce the file');
const l1List = ['L1S00 Indexer: '];
x = x.replace(gslOld, ctrlStringArray('g_L1StationList', l1List, STATIONS + 1) + '\n' + ctrlStringArray('g_StationList', gsl, 17));
// axis a21 from a01
const a01 = tagXml(x, 'a01_L2Indexer'); must(a01 && /MotionModule="sd01_L2Indexer:Ch1"/.test(a01) && /PositionUnwind="6400000"/.test(a01) && /PositionUnwindNumerator="64\.0"/.test(a01), 'a01 axis');
const ids = new Set([...x.matchAll(/AxisID="(\d+)"/g)].map((m) => m[1]));
let axisId; do { axisId = String(crypto.randomInt(1, 0x7fffffff)); } while (ids.has(axisId));
const a21 = a01.replace('<Tag Name="a01_L2Indexer"', '<Tag Name="' + AXIS + '"').replace('MotionModule="sd01_L2Indexer:Ch1"', 'MotionModule="' + DRIVE + ':Ch1"')
  .replace('PositionUnwind="6400000"', 'PositionUnwind="' + NESTS * 100000 + '"').replace('PositionUnwindNumerator="64.0"', 'PositionUnwindNumerator="' + NESTS + '.0"').replace(/AxisID="\d+"/, 'AxisID="' + axisId + '"');
const a14 = tagXml(x, 'a14_L2S10Horizontal'); must(a14, 'a14');
x = x.replace(a14, a14 + '\n' + a21);
// drive sd21 from sd01
const sd01 = (/<Module Name="sd01_L2Indexer"[\s\S]*?<\/Module>/.exec(x) || [])[0]; must(sd01 && /Address="10\.68\.167\.20"/.test(sd01), 'sd01 module');
const sd21 = sd01.replace('<Module Name="sd01_L2Indexer"', '<Module Name="' + DRIVE + '"').replace('Address="10.68.167.20"', 'Address="' + IP + '"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + newGuid() + '"');
const sd14 = (/<Module Name="sd14_L2S10Horizontal"[\s\S]*?<\/Module>/.exec(x) || [])[0]; must(sd14, 'sd14 module');
x = x.replace(sd14, sd14 + '\n' + sd21);
x = rep1(x, '<ParameterConnection EndPoint1="\\L2_S00_IndexerNoSP.iq_IndexerAxis" EndPoint2="a01_L2Indexer"/>',
  '<ParameterConnection EndPoint1="\\L2_S00_IndexerNoSP.iq_IndexerAxis" EndPoint2="a01_L2Indexer"/>\n<ParameterConnection EndPoint1="\\L1_S00_IndexerNoSP.iq_IndexerAxis" EndPoint2="' + AXIS + '"/>', 'axis connection');
x = rep1(x, '<ScheduledProgram Name="Supervisor"/>', '<ScheduledProgram Name="Supervisor"/>\n<ScheduledProgram Name="L1_Tracking"/>\n<ScheduledProgram Name="L1_S00_IndexerNoSP"/>', 'schedule');
// the two programs, ahead of L2_S00 (alphabetical)
x = rep1(x, '<Program Name="L2_S00_IndexerNoSP"', T + '\n' + S + '\n<Program Name="L2_S00_IndexerNoSP"', 'program insert');
must(programBody(x, 'L1_Tracking') && programBody(x, 'L1_S00_IndexerNoSP'), 'programs inserted');

// ═══ 7. Supervisor, Alarms, HMI, Safety take the L1 indexer ══════════════════
const L1 = '\\L1_S00_IndexerNoSP.', L2 = '\\L2_S00_IndexerNoSP.';
editRoutine('Supervisor', 'R01_Inputs', (r) => { let n = 0; const out = r.map((rg) => { let t = rungText(rg), u = t;
  for (const q of ['q_AutoMode', 'q_AutoStopped', 'q_StartOK']) if (t.startsWith('XIC(' + L2 + q + ')')) { u = 'XIC(' + L1 + q + ')' + t; n++; }
  if (t === 'XIC(' + L2 + 'q_PauseRestart)OTE(HornOverride);') { u = '[XIC(' + L1 + 'q_PauseRestart) ,XIC(' + L2 + 'q_PauseRestart) ]OTE(HornOverride);'; n++; }
  return u === t ? rg : setRungText(rg, u); }); must(n === 4, 'Supervisor R02 chains ' + n); return out; });
let sup = programBody(x, 'Supervisor');
const eipTpl = tagXml(sup, 'sd01_IndexerEIP') || fail('sd01_IndexerEIP');
sup = sup.replace(eipTpl, eipTpl + '\n' + eipTpl.replace('Name="sd01_IndexerEIP"', 'Name="' + DRIVE + 'EIP"'));
const supAlarm = tagXml(sup, 'Alarm'); must(/Dimensions="20"/.test(supAlarm), 'Supervisor Alarm[20]');
const supMsgs = stringsOf(supAlarm); must(supMsgs.length === 20 && supMsgs[16] === '' && /Valve Bank/.test(supMsgs[15]), 'Supervisor Alarm messages');
const EIP_MSG = 'Loss Of L1 Indexer Servo EIP Communications';
const supL5K = splitTop(l5kOf(supAlarm)); must(supL5K.length === 20, 'Supervisor Alarm L5K');
supL5K[16] = alarmElemL5K(EIP_MSG);
let supAlarmNew = supAlarm.replace(/(<Data Format="L5K">\s*<!\[CDATA\[)[\s\S]*?(\]\]>)/, (m, p, q) => p + '[' + supL5K.join(',') + ']' + q);
supAlarmNew = supAlarmNew.replace(block(supAlarmNew, '<Element Index="[16]">', 'Element', 'Element'), alarmElemDec(16, EIP_MSG));
sup = sup.replace(supAlarm, supAlarmNew);
replaceProgram('Supervisor', sup);
editRoutine('Supervisor', 'R15_EIPMonitor', (r) => r.map((rg) => rungText(rg) === 'GE(EIPStatusCount,15)MOVE(0,EIPStatusCount);' ? setRungText(rg, 'GE(EIPStatusCount,16)MOVE(0,EIPStatusCount);') : rg));
must(/GE\(EIPStatusCount,16\)/.test(programBody(x, 'Supervisor')), 'EIP node count 16');
editRoutine('Supervisor', 'R20_Alarms', (r) => { const i = r.findIndex((rg) => rungText(rg).includes('EQ(EIPStatusCount,14) AOI_EIPStatus(vb06_MainAssemblyEIP')); must(i > 0, 'vb06 EIP rung');
  return [...r.slice(0, i + 1), newRung(EIP_MSG, '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,15) AOI_EIPStatus(' + DRIVE + 'EIP,' + DRIVE + ') XIO(' + DRIVE + 'EIP.ComOK) ,XIC(Alarm[16].Active) XIO(q_FaultReset) ]OTE(Alarm[16].Active);'), ...r.slice(i + 1)]; });
editRoutine('Alarms', 'R01_Logic', (r) => { let n = 0; const out = r.map((rg) => { const t = rungText(rg);
  for (const q of ['q_AlarmActive', 'q_WarningActive']) if (t.includes('XIO(' + L2 + q + ')')) { n++; return setRungText(rg, t.replace('XIO(' + L2 + q + ')', 'XIO(' + L1 + q + ')XIO(' + L2 + q + ')')); }
  return rg; }); must(n === 2, 'Alarms chains ' + n); return out; });
// HMI: nest indicator per indexer, cleanout waits for both
let hmi = programBody(x, 'HMI');
hmi = repAll(hmi, 'HMI_NestIndicator', 'HMI_L2NestIndicator', 'HMI_NestIndicator rename', 2);
hmi = hmi.replace(tagXml(hmi, 'HMI_L2NestIndicator'), tagXml(hmi, 'HMI_L2NestIndicator') + '\n' + dintArrayTag('HMI_L1NestIndicatorA', [], NESTS + 1) + '\n' + dintArrayTag('HMI_L1NestIndicatorB', [], NESTS + 1));
hmi = hmi.replace(tagXml(hmi, 'MyNestStatus'), tagXml(hmi, 'MyNestStatus') + '\n' + dintTag('MyNestStatusA') + '\n' + dintTag('MyNestStatusB'));
const l1Ind = (s) => [
  '	IF (\\L1_Tracking.p_Data.Nest[NestNum].OpStatus.Lockout) THEN', '		MyNestStatus' + s + ' := 1;',
  '	ELSIF (\\L1_Tracking.p_Data.Nest[NestNum].PartStatus.Bad' + s + ') THEN', '		MyNestStatus' + s + ' := 2;',
  '	ELSIF (\\L1_Tracking.p_Data.Nest[NestNum].PartStatus.Good' + s + ') THEN', '		MyNestStatus' + s + ' := 3;',
  '	ELSE', '		MyNestStatus' + s + ' := 4;  // Nest Is Empty (Greyed Out)', '	END_IF;'];
hmi = putST(hmi, 'R02_NestIndicators', [...getST(hmi, 'R02_NestIndicators'), '',
  '//L1 nests carry two parts - one indicator per part, A upstream and B downstream',
  'FOR NestNum := 1 TO \\L1_Tracking.p_NestQty BY 1 DO', '', '	MyNestStatusA := 0;', '	MyNestStatusB := 0;', '',
  ...l1Ind('A'), '', ...l1Ind('B'), '', '	HMI_L1NestIndicatorA[NestNum] := MyNestStatusA;', '	HMI_L1NestIndicatorB[NestNum] := MyNestStatusB;', '', 'End_for;']);
hmi = editRoutineIn(hmi, 'R03_CleanoutMode', (r) => r.map((rg) => { const t = rungText(rg); if (!t.includes('Nest[64].PartStatus.PartLoaded)ONS(ONS.2)')) return rg;
  const l1 = Array.from({ length: NESTS }, (_, i) => 'XIO(\\L1_Tracking.p_Data.Nest[' + (i + 1) + '].PartStatus.PartLoadedA)XIO(\\L1_Tracking.p_Data.Nest[' + (i + 1) + '].PartStatus.PartLoadedB)').join('');
  return setRungText(rg, t.replace('Nest[64].PartStatus.PartLoaded)ONS(ONS.2)', 'Nest[64].PartStatus.PartLoaded)' + l1 + 'ONS(ONS.2)')); }));
must(countOf(hmi, 'PartLoadedA)') === NESTS && countOf(hmi, 'PartLoadedB)') === NESTS && countOf(hmi, 'Nest[' + NESTS + '].PartStatus.PartLoadedB)ONS(ONS.2)') === 1, 'HMI cleanout L1 chain: ' + countOf(hmi, 'PartLoadedA)') + '/' + countOf(hmi, 'PartLoadedB)'));
replaceProgram('HMI', hmi);
// Safety: the L1 drive takes the L2 drive's form (status, STO reset, STO on the main guard door)
let saf = programBody(x, 'SafetyProgram');
const okTag = tagXml(saf, 'L2IndexerOK'); must(okTag, 'L2IndexerOK');
saf = saf.replace(okTag, tagXml(saf, 'L1IndexerOK') ? okTag : okTag.replace('Name="L2IndexerOK"', 'Name="L1IndexerOK"') + '\n' + okTag);
saf = editRoutineIn(saf, 'R01_Inputs', (r) => { const i = r.findIndex((rg) => rungText(rg).endsWith('OTE(L2IndexerOK);')); must(i >= 0, 'L2IndexerOK rung');
  return [...r.slice(0, i + 1), newRung('', 'XIC(' + DRIVE + ':SI.RunMode)XIO(' + DRIVE + ':SI.ConnectionFaulted)XIO(' + DRIVE + ':SI.SafetyFault)OTE(L1IndexerOK);'), ...r.slice(i + 1)]; });
saf = editRoutineIn(saf, 'R03_Outputs', (r) => { const i = r.findIndex((rg) => rungText(rg) === 'XIC(L2IndexerOK)XIC(GuardDoorL2Output)OTE(sd01_L2Indexer:SO.SafeTorqueOff);'); must(i > 0, 'L2 STO rung');
  return [...r.slice(0, i + 1), newRung('', 'XIC(' + DRIVE + ':SO.SafeTorqueOff)XIC(' + DRIVE + ':SI.TorqueDisabled)XIC(' + DRIVE + ':SI.ResetRequired)OTE(' + DRIVE + ':SO.Reset);'),
    newRung('', 'XIC(L1IndexerOK)XIC(GuardDoorL2Output)OTE(' + DRIVE + ':SO.SafeTorqueOff);'), ...r.slice(i + 1)]; });
replaceProgram('SafetyProgram', saf);

// ═══ 8. self-checks, write ═══════════════════════════════════════════════════
const base = fs.readFileSync(BASE, 'utf8');
const sameRoutines = (name) => { const a = programBody(base, name), b = programBody(x, name); return norm(a.slice(a.indexOf('<Routines>'))) === norm(b.slice(b.indexOf('<Routines>')).replace(/L2Tracking_/g, 'Tracking_')); };
for (const p of ['L2_S00_IndexerNoSP', 'L2_Tracking', 'L2_S01_TubeFeedUpstream', 'L2_S01_DereelerUpstream', 'L2_S01_TubeFeedDownstream', 'L2_S01_DereelerDownstream', 'L2_S10_BlueTubeCoiler', 'Production', 'MapInputs', 'MapOutputs']) must(sameRoutines(p), p + ' logic changed');
must(norm(programBody(base, 'L2_Tracking').replace(/Tracking_(Data|Nest|Part_Assy_Stat|Process_Op_Result|Station)\b/g, 'L2Tracking_$1')) === norm(programBody(x, 'L2_Tracking')), 'L2_Tracking changed beyond the type names');
must(norm(programBody(base, 'L2_S00_IndexerNoSP')) === norm(programBody(x, 'L2_S00_IndexerNoSP')), 'L2_S00_IndexerNoSP changed');
const T1 = programBody(x, 'L1_Tracking'), S1 = programBody(x, 'L1_S00_IndexerNoSP');
must(countOf(x, 'DataType="L1Tracking_') > 0 && countOf(x, '<DataType Name="L1Tracking_') === 5 && countOf(x, '<DataType Name="L2Tracking_') === 5, 'UDT count');
must(countOf(x, 'AxisID="' + axisId + '"') === 1 && countOf(x, '<Module Name="' + DRIVE + '"') === 1 && countOf(x, '<Tag Name="' + AXIS + '"') === 1, 'axis / drive once');
must(countOf(x, '<ScheduledProgram Name="L1_Tracking"/>') === 1 && countOf(x, '<ScheduledProgram Name="L1_S00_IndexerNoSP"/>') === 1, 'schedule once');
must(countOf(S1, 'g_StationList[') === 0 && countOf(S1, 'g_L1StationList[StaNum]') === 9, 'L1 alarms prefix: ' + countOf(S1, 'g_L1StationList[StaNum]'));
for (const t of [...S1.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g), ...T1.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g), ...programBody(x, 'Supervisor').matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g), ...programBody(x, 'HMI').matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1])) {
  let paren = 0; const legs = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') paren++; else if (ch === ')') paren--; else if (paren) continue;
    else if (ch === '[' && !/[A-Za-z0-9_\].]/.test(t[i - 1] || '')) legs.push(1);
    else if (ch === ',' && legs.length) legs[legs.length - 1]++;
    else if (ch === ']' && legs.length && !/[A-Za-z0-9_]/.test(t[i - 1] || '')) must(legs.pop() > 1, 'single-leg branch in ' + t.slice(0, 120));
  }
}
for (const n of ['p_StationPositionA', 'p_StationPositionB']) { const d = (/<Description>\s*<!\[CDATA\[([^\]]*)/.exec(tagXml(T1, n)) || [])[1] || ''; must(d && d.length <= 30, 'description over 30: ' + n); }
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
fs.mkdirSync(PROGDIR, { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.writeFileSync(path.join(PROGDIR, 'L1_S00_IndexerNoSP.xml'), S1);
fs.writeFileSync(path.join(PROGDIR, 'L1_Tracking.xml'), T1);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars): L1_S00 ' + rungList(S1).length + ' rungs / ' + (S1.match(/<Tag Name=/g) || []).length + ' tags, L1_Tracking ' + rungList(T1).length + ' rungs / ' + (T1.match(/<Tag Name=/g) || []).length + ' tags; axis ' + AXIS + ' id ' + axisId);

// ═══ 9. gates ════════════════════════════════════════════════════════════════
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', path.join(PROGDIR, 'L1_S00_IndexerNoSP.xml'), path.join(PROGDIR, 'L1_Tracking.xml')]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-8).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict)) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW/.test(l)).slice(0, 40).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');

// ═══ 10. cover note fragments, contract, intake, meta ════════════════════════
const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8');
if (!h.includes('<tr><td>' + VERSION + '</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>' + VERSION + '</td><td>' + SHORT + '</td><td>L1 indexer tracking (D017): <code>L1_Tracking</code> and <code>L1_S00_IndexerNoSP</code>, the L2 programs re-pointed &ndash; 18 nests, one nest per index, two parts per nest tracked per part (A upstream, B downstream) in a new <code>L1Tracking_*</code> UDT family; the L2 family is renamed <code>L2Tracking_*</code>, <code>HMI_NestIndicator</code> becomes <code>HMI_L2NestIndicator</code> with <code>HMI_L1NestIndicatorA / B</code> beside it, <code>g_L1StationList</code> added. Drive <code>sd21_L1Indexer</code> / axis <code>a21_L1Indexer</code> (IP tab .110) cloned from the L2 indexer with the same safety form; Supervisor, Alarms, HMI cleanout and the task take the two programs. L2 tracking and indexer logic untouched; no L1 stations yet.</td><td>Jason, ' + SHORT + ': &ldquo;build a new version with L1 Tracking, L1 Indexer, and the L2 renaming as discussed. L2 tracking / indexer logic is not to be touched. I do not want to build the L1 stations yet.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>' + VERSION + '</td>'), 'head row');
  h = rep1(h, '<td><b>2UP linear indexer L2</b>', '<td><b>L1 indexer</b> (18 nests, one nest per index, two parts per nest &ndash; A upstream, B downstream &ndash; 8 active positions: S01, S02 on positions 2/3, S04 on 4/5, S08 robot unload; stations not built) building the subassembly for the <b>2UP linear indexer L2</b>', 'head platform');
  h = rep1(h, 'MainTask: MapInputs, Supervisor, L2_Tracking, L2_S00_IndexerNoSP,', 'MainTask: MapInputs, Supervisor, <b>L1_Tracking, L1_S00_IndexerNoSP</b>, L2_Tracking, L2_S00_IndexerNoSP,', 'head controller');
  h = rep1(h, 'SafetyTask: SafetyProgram (untouched).', 'SafetyTask: SafetyProgram (the L1 indexer drive added in the L2 drive&rsquo;s form).', 'head safety');
  h = rep1(h, 'instances 100 / 101). Byte map', 'instances 100 / 101); <b>sd21_L1Indexer</b> .110 (2198-H040-ERS2 with integrated safety, cloned from sd01). Byte map', 'head hardware');
  h = rep1(h, ' <b>L2S10</b>: <code>a10_L2S10RotaryUpstream</code>', ' <b>L1</b>: <code>a21_L1Indexer</code> on sd21 (.110), the a01 axis cloned &ndash; VPL-A1003F-P, 50:1, 1 unit = 1 nest, 18-nest unwind (motor and gearbox to confirm). <b>L2S10</b>: <code>a10_L2S10RotaryUpstream</code>', 'head axes');
  h = rep1(h, 'a station number is its physical position in the indexer nest math.</td></tr>', 'a station number is its physical position in the indexer nest math. <b>D017</b> (Open, Jason Nov 5): L1 nests carry two parts tracked per part (the job 1160 A / B nest record) on the dial family, and a station spanning two positions (2/3, 4/5) takes its A nest from one position and its B nest from the other through <code>p_StationPositionA</code> / <code>B</code> &ndash; conflicts with the dial template (one part per nest, one position per station).</td></tr>', 'head deviations');
  h = rep1(h, 'database name are assumptions in the Asks.</td></tr>', 'database name are assumptions in the Asks. L1 tracking and indexer: 8 &ndash; the L2 forms re-pointed; drive, motor and gearbox assumed equal to L2, STO on the main guard door until the macaroni safety I/O exists.</td></tr>', 'head logic');
}
if (!b.includes('<b>L1_Tracking</b>')) {
  b = rep1(b, 'a feeder has no nest.</td></tr>', 'a feeder has no nest.</td></tr>\n<tr><td class="k"><b>L1_Tracking</b></td><td>L2_Tracking re-pointed to the <code>L1Tracking_*</code> family (D017): Nest[19] with two parts per nest (PartLoadedA / B, GoodA / B, BadA / B, FailureTypeA / B, FailureMessageA / B, Station[9] of AttemptA / B, SuccessA / B, FailureA / B, LockoutA / B), Station[9] with NestNumA (upstream part) and NestNumB (downstream part). <code>p_StationPositionA</code> = [0,1,3,0,5,0,0,0,8], <code>p_StationPositionB</code> = [0,1,2,0,4,0,0,0,8]: a station on two positions reads A from the upstream nest and B from the downstream one; position 0 = unused station. R05 judges each part over the stations at or before its own position (Lockout counts as passed, a Failure ends the scan). Good and reject triggers on AlwaysOff until L1_S08 exists; both read Station[8]. No Recycle / Sample.</td></tr>', 'back tracking');
  b = rep1(b, 'Alarms rolls up Supervisor, the indexer, the four L2S01 programs', 'Alarms rolls up Supervisor, both indexers, the four L2S01 programs', 'back alarms');
  b = rep1(b, 'HMI unchanged; screens out of scope.', 'HMI: <code>HMI_NestIndicator</code> renamed <code>HMI_L2NestIndicator</code>; <code>HMI_L1NestIndicatorA / B</code>[19] added (same colour codes, one per part); cleanout waits for every nest on both indexers empty. <code>g_StationList[0]</code> now reads &ldquo;L2S00 Indexer: &rdquo;, <code>g_L1StationList[0]</code> &ldquo;L1S00 Indexer: &rdquo;. Screens out of scope.', 'back hmi');
  b = rep1(b, 'Polls six state machines; EIP monitor counts 15 nodes;', 'Polls seven state machines (the L1 indexer added to auto, stopped and start-OK; horn override from either indexer&rsquo;s pause restart); EIP monitor counts 16 nodes, Alarm[16] = L1 indexer drive;', 'back supervisor');
  b = rep1(b, 'SafetyProgram verbatim from the Oct 29 export.', 'SafetyProgram from the Oct 29 export plus the L1 indexer drive in the L2 drive&rsquo;s form: <code>L1IndexerOK</code> status, STO reset, STO on <code>GuardDoorL2Output</code> (Ask 30).', 'back safety');
  const asks = [
    [29, 'L1 indexer drive <code>sd21_L1Indexer</code> / axis <code>a21_L1Indexer</code> at 10.68.167.110 (IP tab device 60) are the L2 indexer cloned &ndash; 2198-H040-ERS2 (the heat-load tab counts two H040), VPL-A1003F-P, 50:1, 1 unit = 1 nest, 18-nest unwind; confirm the motor, gearbox and nests per output rev.', 'Jason / Vipin'],
    [30, 'The L1 drive&rsquo;s STO follows <code>GuardDoorL2Output</code> (main assembly guard doors) until the Macaroni sub-assembly safety I/O (5069 rack .100) is defined; then its own door chain in the same form.', 'Jason'],
    [31, 'HMI tags to follow: <code>HMI_NestIndicator</code> is now <code>HMI_L2NestIndicator</code>, plus <code>HMI_L1NestIndicatorA</code> / <code>B</code>[19] for the two parts of each L1 nest.', 'HMI'],
    [32, 'L1 indexer with no stations: stations-complete on its delay alone, actuators-safe and pause on AlwaysOff, <code>StationCompleteTimes</code>[1 / 2 / 4 / 8] rungs on AlwaysOff &ndash; each L1 station build replaces its term (the v0.1 form). <code>i_EmptyNestA / B</code> (the two part sensors at position 8) unconnected until the station 8 I/O is known.', 'Jason'],
    [33, 'L2 untouched today: the <code>StationCompleteTimes</code> rung for L2S10 in L2_S00 R03 (one rung, ONS.7) waits for the next L2 increment.', 'Jason'],
    [34, '<code>g_StationList</code> stays the L2 table (the machine-wide standard name); L1 has <code>g_L1StationList</code>[9]. Renaming the L2 table <code>g_L2StationList</code> is a name-only change across every L2 alarm CONCAT if wanted.', 'Jason'],
  ];
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks.map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n') + '\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>34</td>'), 'asks');
}
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
if (!meta.L1_S00_IndexerNoSP) {
  meta.L1_S00_IndexerNoSP = {
    title: 'L1_S00 &ndash; Linear indexer, one nest per index',
    does: 'Waits for the stations to report complete, checks every actuator is clear, indexes one nest, and publishes the nest numbers for the upstream (A) and downstream (B) part of every station from the two position tables. No L1 station exists yet: stations-complete runs on its delay alone, actuators-safe and pause sit on AlwaysOff.',
    devices: 'a21_L1Indexer &ndash; 2198-H040-ERS2 / VPL-A1003F-P, 50:1 (cloned from the L2 indexer, Ask 29) &ndash; servo indexer, 1 unit = 1 nest, 18-nest unwind &middot; i_EmptyNestA / i_EmptyNestB &ndash; the two part positions of the nest at station 8 empty before the index',
    notes: 'L2_S00_IndexerNoSP re-pointed to L1_Tracking: NestsPerIndex 1, R10 nest math without the 2x factor, Station[0] = the nest arriving at station 1, StationCompleteTimes[9] with placeholder rungs for stations 1, 2, 4 and 8. Alarm prefix g_L1StationList[0] = &ldquo;L1S00 Indexer: &rdquo;.',
    extra: { Form: 'L2_S00_IndexerNoSP (template S00_IndexerNoSP), stubbed as in v0.1', Deviation: 'D017 Open &ndash; two parts per nest, split-station position tables (Jason)', Logic: '8 &ndash; template clone; drive, motor and gearbox assumed equal to L2', Referenced: 'L1_TRACKING_PLAN.md, NAMES_CONTRACT_L2S01_EA.md (L1 section)', Ask: '29, 30, 32' },
  };
  meta.Supervisor.does = meta.Supervisor.does.replace('Polls the indexer and the four L2S01 programs', 'Polls both indexers and the four L2S01 programs').replace('horn override from the indexer&rsquo;s pause restart', 'horn override from either indexer&rsquo;s pause restart').replace('fifteen EIP nodes monitored (', 'sixteen EIP nodes monitored (L1 indexer drive, ');
  must(/sixteen EIP/.test(meta.Supervisor.does) && /both indexers/.test(meta.Supervisor.does), 'meta supervisor');
}
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (!c.includes('## L1 tracking and indexer')) c = c.trimEnd() + '\n\n## L1 tracking and indexer (0.8, Jason 2026-11-05 plan, D017)\n| Item | Name |\n|---|---|\n| UDTs | `L1Tracking_Data` (Nest[19], Station[9]) · `L1Tracking_Nest` · `L1Tracking_Part_Assy_Stat` (GoodA/B, BadA/B, PartLoadedA/B, Station[9], FailureTypeA/B, FailureMessageA/B) · `L1Tracking_Process_Op_Result` (AttemptA/B, SuccessA/B, FailureA/B, LockoutA/B) · `L1Tracking_Station` (OpStatus, NestNumA, NestNumB, PerformData); L2 family renamed `L2Tracking_*`; `Tracking_*_Op_Status` / `Tracking_Perform_*` shared |\n| A / B | A = upstream part, B = downstream part of ONE nest (1160 meaning). On L2, A / B = two nests |\n| Programs | `L1_Tracking` (p_Data, p_NestQty 18, p_StationQty 8, `p_StationPositionA` [0,1,3,0,5,0,0,0,8], `p_StationPositionB` [0,1,2,0,4,0,0,0,8]; unload station 8; R05 per part, Lockout = passed) · `L1_S00_IndexerNoSP` (NestsPerIndex 1, R10 NestAt(p) = (NewNestNum - 1 - (p - 1) + 18) MOD 18 + 1 per table, Station[0] = arriving nest, StationCompleteTimes[9]) |\n| Stations (not built) | `L1_S01` StaNum 1 / StaNumPre 0 · `L1_S02` StaNum 2 (A at position 3, B at 2) / StaNumPre 1 · `L1_S04` StaNum 4 (A at 5, B at 4) / StaNumPre 2 · `L1_S08` robot unload, StaNumPre 4, per-part good / reject, i_EmptyNestA / B. A station reads `\\\\L1_Tracking.p_Data.Station[StaNum].NestNumA` (upstream part) / `NestNumB` (downstream part) and writes `Nest[n].PartStatus.Station[StaNum].AttemptA / SuccessA` for A, `...B` for B |\n| Hardware | `sd21_L1Indexer` 2198-H040-ERS2 10.68.167.110 (IP tab device 60, Macaroni Sub Assembly) · `a21_L1Indexer` (a01 cloned: VPL-A1003F-P, 50:1, 1 unit = 1 nest, unwind 18) · Supervisor EIP node 15, Alarm[16] · Safety `L1IndexerOK`, STO on `GuardDoorL2Output` (Ask 30) |\n| Controller / HMI | `g_L1StationList`[9] ([0] = "L1S00 Indexer: "); `g_StationList[0]` = "L2S00 Indexer: "; `HMI_L2NestIndicator`[65] (was HMI_NestIndicator), `HMI_L1NestIndicatorA / B`[19]; HMI cleanout waits for both indexers |\n| Reserved | a22 L1S1 feed · a23-a26 L1S3 · a27 L1S5 (IP tab devices 61-66, .111-.116) |\n';
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
cfg.programs = '^(L[12]_S00_|L2_S01_|L2_S10_|Supervisor$)';
cfg.shapeLintPrograms = '^(L2_S(01|10)_|L1_S00_|L1_Tracking$)';
cfg.title = '1163 Haemonetics - L1 Indexer and Tracking, L2 Indexer, L2S01 (EA) Tube Load, L2S10 (EJ) Blue Tube Coiler';
const exF = B + '/plan/station-examples.json';
const ex = JSON.parse(fs.readFileSync(exF, 'utf8'));
ex.L1_Tracking = ex.L1_Tracking || { example: 'L2_Tracking (SoftwareStandardization Tracking, 2UP) re-pointed; job 1160 Tracking R05 for the per-part A / B judgement', reference: 'L1_TRACKING_PLAN.md (Jason, 2026-11-05)' };
ex.L1_S00_IndexerNoSP = ex.L1_S00_IndexerNoSP || { example: 'L2_S00_IndexerNoSP (SoftwareStandardization S00_IndexerNoSP), one nest per index; station inputs stubbed as in v0.1', reference: 'L1_TRACKING_PLAN.md' };

if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 11. deliver + stamp ═════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);
fs.writeFileSync(headF, h); fs.writeFileSync(backF, b); fs.writeFileSync(metaF, JSON.stringify(meta, null, 2)); fs.writeFileSync(cf, c);
fs.writeFileSync(cfgF, JSON.stringify(cfg, null, 2)); fs.writeFileSync(exF, JSON.stringify(ex, null, 2));
console.log('fragments, meta, contract, intake, examples updated');

// ═══ 12. cover note ══════════════════════════════════════════════════════════
const html = OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.html';
const s = run(['scripts/sequenceOfOperation.cjs', D + '/' + M + '.L5X', '--out', html, '--head', headF, '--meta', metaF, '--front', frontF, '--back', backF, '--foot', 'If a device or step is wrong, fix the code, not this sheet.', '--programs', cfg.programs, '--title', cfg.title, '--subtitle', 'Cover note and sequence of operation - v' + VERSION]);
console.log(s.out.trim().split('\n').pop()); must(s.code === 0, 'sequenceOfOperation');
const docx = D + '/' + M + '_CoverNote.docx';
const w = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (B + '/w8_convert.ps1').replace(/\//g, '\\'), '-Html', html.replace(/\//g, '\\'), '-Docx', docx.replace(/\//g, '\\'), '-Pdf', (OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.pdf').replace(/\//g, '\\')], { encoding: 'utf8' });
const wout = (w.stdout || '') + (w.stderr || '');
console.log(wout.trim().split('\n').slice(-2).join('\n'));
must(/saved /.test(wout), 'cover note conversion failed (is Word open?)');
fs.copyFileSync(docx, H + '/' + M + '_CoverNote_v' + VERSION + '_' + ISO + '.docx');
console.log('cover note stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION);
