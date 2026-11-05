'use strict';
// build1163S10jog.cjs — 1163 v0.7.5 on the v0.7.4 stamp: manual coil jog on L2_S10_BlueTubeCoiler (D016, Jason 2026-11-05).
// In manual one head at a time cams its Z and R to the X axis with the auto cam profiles, Bi-Directional, and the operator
// jogs X with the normal jog buttons. Momentary Cam On / Cam Off per head (HMI_Momentary.12-15), the PLC latches CamJog{Side};
// engage only with Z at coil start, R at home, the spike gripper closed and X between place and coil start. Release on Cam Off,
// leaving manual, safety, X permissive, a slave fault or a failed engage (MAS Position Cam). Z / R manual moves of a cammed
// head and the X position moves / home are blocked while a head is cammed. One alarm per head: Head {Side} Cam Did Not Engage.
//   node scripts/build1163S10jog.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const BASE = H + '/1163_Haemonetics_v0.7.4_2026-11-05.L5X';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.7.5';
const ISO = new Date().toISOString().slice(0, 10), SHORT = 'Nov 5';
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const PROG = 'L2_S10_BlueTubeCoiler', PREFIX = 'L2S10 Tube Coil: ';
const SIDES = ['Upstream', 'Downstream'];
const OTHER = { Upstream: 'Downstream', Downstream: 'Upstream' };
const MOM = { Upstream: { on: 12, off: 13 }, Downstream: { on: 14, off: 15 } };
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
let x = fs.readFileSync(BASE, 'utf8');

// ── helpers (build1163S10.cjs forms) ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const rungComment = (r) => ((/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(r) || [])[1] || '').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, p, q) => p + t + q);
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
const programBody = (src, name) => { const m = progRe(name).exec(src); return m ? m[0] : null; };
const replaceProgram = (name, body) => { const m = progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const getRoutine = (body, rn) => { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; };
const putRungs = (body, rn, rungs) => { const old = getRoutine(body, rn); must(old != null, 'routine ' + rn); return body.replace(old, '\n' + renumber(rungs.join('\n')) + '\n'); };
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + rn)))); replaceProgram(prog, b); };
const tagXml = (body, name) => (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0];
const rep1 = (src, from, to, what) => { const i = src.indexOf(from); must(i >= 0 && src.indexOf(from, i + 1) < 0, what + ': expected exactly once'); return src.slice(0, i) + to + src.slice(i + from.length); };
const countOf = (hay, s) => hay.split(s).length - 1;
const l5kStr = (s, n) => '[' + s.length + ",'" + s + '$00'.repeat(n - s.length) + "']";
const descXml = (d) => d ? '<Description>\n<![CDATA[' + d + ']]>\n</Description>\n' : '';
const openTag = (name, type, extra) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n';
const l5kReal = (n) => Number(n).toExponential(8).replace(/e([+-])(\d)$/, 'e$10$2');
const scalarTag = (name, type, radix, value, desc) => openTag(name, type, ' Radix="' + radix + '"') + descXml(desc) +
  '<Data Format="L5K">\n<![CDATA[' + (type === 'REAL' ? l5kReal(value) : String(value)) + ']]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + (type === 'REAL' ? '0.0' : String(value)) + '"/>\n</Data>\n</Tag>';
const boolTag = (name, desc) => scalarTag(name, 'BOOL', 'Decimal', 0, desc);
const realTag = (name, desc) => scalarTag(name, 'REAL', 'Float', 0, desc);
const copyTag = (body, srcName, newName) => { const t = tagXml(body, srcName); must(t, 'tag to copy: ' + srcName); return t.replace('<Tag Name="' + srcName + '"', '<Tag Name="' + newName + '"'); };
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

// ═══ 1. tags ═════════════════════════════════════════════════════════════════
let body = programBody(x, PROG) || fail('program');
const listXml = tagXml(body, 'AlarmList');
const alarms = [...listXml.matchAll(/<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\s*<!\[CDATA\['([^']*)'\]\]>/g)].map((m) => m[1]);
must(alarms.length === 21 && alarms[20] === 'Coil Interrupted, Nest Downstream Failed', 'alarm list 21: ' + alarms.length);
const CAM_ALARM = {};
for (const s of SIDES) { CAM_ALARM[s] = alarms.length; alarms.push('Head ' + s + ' Cam Did Not Engage'); }
body = body.replace(tagXml(body, 'Alarm'), alarmArrayTag('Alarm', PREFIX, alarms, 23));
body = body.replace(listXml, stringArrayTag('AlarmList', alarms, 23));
const newTags = [];
for (const s of SIDES) {
  newTags.push(boolTag('CamJog' + s, 'Manual Cam Jog ' + s), boolTag('Cammed' + s, s + ' Head Cammed To X'));
  for (const a of ['RAxis', 'ZAxis']) newTags.push(copyTag(body, 'RAxisUpstream_MAPC', a + s + '_MAPC_Jog'), copyTag(body, 'RAxisUpstream_MAPC', a + s + '_MAS_CamJog'));
}
newTags.push(realTag('CamJogLockPosition', 'Cam Lock, X Minus Place'));
newTags.forEach((t) => { const d = (/<Description>\s*<!\[CDATA\[([^\]]*)/.exec(t) || [])[1]; if (d) must(d.length <= 30, 'description over 30: ' + d); });
body = body.replace(tagXml(body, 'CoilStartPosition'), tagXml(body, 'CoilStartPosition') + '\n' + newTags.join('\n'));
const mom = tagXml(body, 'HMI_Momentary'); must(mom.includes('<Comment Operand=".11">') && !mom.includes('<Comment Operand=".12">'), 'HMI_Momentary comments');
body = body.replace(mom, mom.replace('</Comments>', [['12', 'Cam On Upstream'], ['13', 'Cam Off Upstream'], ['14', 'Cam On Downstream'], ['15', 'Cam Off Downstream']].map(([b, c]) => '<Comment Operand=".' + b + '">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>'));
replaceProgram(PROG, body);

// ═══ 2. rungs ════════════════════════════════════════════════════════════════
const insertAfterText = (t, after, add, what) => { must(t.startsWith(after), what + ': form'); return after + add + t.slice(after.length); };
// R01: Initialized needs no head cammed
editRoutine(PROG, 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (!t.endsWith('OTE(Initialized);')) return rg;
  return setRungText(rg, t.replace('OTE(Initialized);', 'XIO(CamJogUpstream)XIO(CamJogDownstream)OTE(Initialized);'));
}));
must(countOf(programBody(x, PROG), 'XIO(CamJogDownstream)OTE(Initialized)') === 1, 'Initialized');
// R03: profiles also on a manual request; manual lock / status / release rungs after the auto release rungs
editRoutine(PROG, 'R03_StateLogic', (r) => {
  const out = [];
  let profiles = 0, lastRelease = -1;
  r.forEach((rg, i) => { if (rungText(rg).startsWith('XIC(Status.State[34])XIC(WorkDownstream)MAS(')) lastRelease = i; });
  must(lastRelease > 0, 'auto release rung');
  r.forEach((rg, i) => {
    let t = rungText(rg);
    if (t.startsWith('XIC(Status.State[28])SUB(CoilStartPosition')) { profiles++; rg = setRungText(rg, '[XIC(Status.State[28]) ,XIC(CamJogUpstream) XIO(CammedUpstream) ,XIC(CamJogDownstream) XIO(CammedDownstream) ]' + t.slice('XIC(Status.State[28])'.length)); }
    out.push(rg);
    if (i !== lastRelease) return;
    for (const s of SIDES) {
      const R = 'iq_RAxis' + s, Z = 'iq_ZAxis' + s, o = OTHER[s];
      out.push(newRung('Manual coil jog: lock the ' + s + ' head to X when the operator asks with the head at coil start and the tube held',
        'XIC(Status.State[1])XIC(HMI_Momentary.' + MOM[s].on + ')XIC(SafetyOK)XIO(CamJog' + o + ')XIC(iq_XAxis.AxisHomedStatus)XIC(' + Z + '.AxisHomedStatus)XIC(' + R + '.AxisHomedStatus)XIO(iq_XAxis.MotionStatus.0)XIO(' + Z + '.MotionStatus.0)XIO(' + R + '.MotionStatus.0)XIC(ZAxis' + s + 'CoilStart.InPos)XIC(RAxis' + s + 'Home.InPos)XIC(SpikeGripper' + s + 'Closed)CMP(iq_XAxis.ActualPosition >= HMI_XAxis.Parameters.Positions[1])CMP(iq_XAxis.ActualPosition <= CoilStartPosition)OTL(CamJog' + s + ');'));
      out.push(newRung('Engage the ' + s + ' cams Bi-Directional from where X stands',
        'XIC(Status.State[1])XIC(CamJog' + s + ')XIO(Cammed' + s + ')XIC(RotaryCam_MCCP.DN)XIC(ZCam_MCCP.DN)XIO(RAxis' + s + '_MAPC_Jog.IP)XIO(ZAxis' + s + '_MAPC_Jog.IP)SUB(iq_XAxis.ActualPosition,HMI_XAxis.Parameters.Positions[1],CamJogLockPosition)' +
        'MAPC(' + R + ',iq_XAxis,RAxis' + s + '_MAPC_Jog,0,RotaryCamProfile,1,1,Once,Immediate,CoilStartPosition,CamJogLockPosition,New Cam,Command,Bi-Directional)' +
        'MAPC(' + Z + ',iq_XAxis,ZAxis' + s + '_MAPC_Jog,0,ZCamProfile,1,1,Once,Immediate,CoilStartPosition,CamJogLockPosition,New Cam,Command,Bi-Directional);'));
      out.push(newRung('', 'XIC(CamJog' + s + ')XIC(' + R + '.PositionCamStatus)XIC(' + Z + '.PositionCamStatus)OTE(Cammed' + s + ');'));
      out.push(newRung('Release the ' + s + ' head on Cam Off, leaving manual, safety, X permissive, a slave fault or a failed engage',
        'XIC(CamJog' + s + ')[XIC(HMI_Momentary.' + MOM[s].off + ') ,XIO(Status.State[1]) ,XIO(SafetyOK) ,XIO(XAxisPermissive) ,NE(' + R + '.AxisFault,0) ,NE(' + Z + '.AxisFault,0) ,XIC(RAxis' + s + '_MAPC_Jog.ER) ,XIC(ZAxis' + s + '_MAPC_Jog.ER) ]' +
        '[OTU(CamJog' + s + ') ,MAS(' + R + ',RAxis' + s + '_MAS_CamJog,Position Cam,Yes,HMI_RAxis' + s + '.Parameters.Decel[0],Units per sec2,No,0,Units per sec3) MAS(' + Z + ',ZAxis' + s + '_MAS_CamJog,Position Cam,Yes,HMI_ZAxis' + s + '.Parameters.Decel[0],Units per sec2,No,0,Units per sec3) ];'));
    }
  });
  must(profiles === 1, 'profile rung');
  return out;
});
// R04: X position moves and home blocked while a head is cammed; jog and inch stay
editRoutine(PROG, 'R04_XAxisServo', (r) => r.map((rg) => {
  const c = rungComment(rg), t = rungText(rg);
  if (c === 'Manual Mode') return setRungText(rg, rep1(t, 'XIC(XAxisPermissive) [XIC(HMI_XAxis.Control.ManMoves.0)', 'XIC(XAxisPermissive) XIO(CamJogUpstream) XIO(CamJogDownstream) [XIC(HMI_XAxis.Control.ManMoves.0)', 'X manual'));
  if (c === 'Home Axis') return setRungText(rg, insertAfterText(t, 'XIC(Status.State[1])', 'XIO(CamJogUpstream)XIO(CamJogDownstream)', 'X home'));
  return rg;
}));
// R05-R08: the cammed head's own jog, inch, home and position moves are blocked
for (const s of SIDES) for (const a of ['ZAxis', 'RAxis']) {
  const rn = (a === 'ZAxis' ? (s === 'Upstream' ? 'R05_' : 'R06_') : (s === 'Upstream' ? 'R07_' : 'R08_')) + a + s + 'Servo';
  let hits = 0;
  editRoutine(PROG, rn, (r) => r.map((rg) => {
    const c = rungComment(rg), t = rungText(rg);
    if (!['Jog Axis', 'Inch Axis', 'Home Axis', 'Manual Mode'].includes(c)) return rg;
    hits++;
    const lead = t.startsWith('XIC(SafetyOK)XIC(Status.State[1])') ? 'XIC(SafetyOK)XIC(Status.State[1])' : 'XIC(Status.State[1])';
    return setRungText(rg, insertAfterText(t, lead, 'XIO(CamJog' + s + ')', rn + ' ' + c));
  }));
  must(hits === 4, rn + ': expected 4 manual rungs, got ' + hits);
}
// R20: one alarm per head, after the last station alarm
editRoutine(PROG, 'R20_Alarms', (r) => {
  const out = [];
  r.forEach((rg) => {
    out.push(rg);
    if (rungComment(rg) !== 'Coil Interrupted, Nest Downstream Failed') return;
    for (const s of SIDES) {
      const i = CAM_ALARM[s];
      out.push(newRung(alarms[i], '[XIC(Status.State[1]) [XIC(RAxis' + s + '_MAPC_Jog.ER) ,XIC(ZAxis' + s + '_MAPC_Jog.ER) ] ,XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(AlarmONS.' + i + ') CONCAT(g_StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];'));
    }
  });
  return out;
});

// ═══ 3. self-checks, write ═══════════════════════════════════════════════════
const prog = programBody(x, PROG);
must(countOf(prog, 'OTL(CamJogUpstream)') === 1 && countOf(prog, 'OTL(CamJogDownstream)') === 1, 'latches');
must(countOf(prog, 'Command,Bi-Directional)') === 4 && countOf(prog, 'Command,Reverse Only)') === 4, 'cam directions');
must(countOf(prog, 'ONS(AlarmONS.21)') === 1 && countOf(prog, 'ONS(AlarmONS.22)') === 1 && !prog.includes('Alarm[23]'), 'cam alarms');
// Initialized, X manual, X home, 4 Z rungs, 4 R rungs, the other head's latch = 12 each
must(countOf(prog, 'XIO(CamJogUpstream)') === 12 && countOf(prog, 'XIO(CamJogDownstream)') === 12, 'lockouts');
for (const t of [...prog.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1])) {
  let paren = 0; const legs = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') paren++; else if (ch === ')') paren--; else if (paren) continue;
    else if (ch === '[' && !/[A-Za-z0-9_\].]/.test(t[i - 1] || '')) legs.push(1);
    else if (ch === ',' && legs.length) legs[legs.length - 1]++;
    else if (ch === ']' && legs.length && !/[A-Za-z0-9_]/.test(t[i - 1] || '')) must(legs.pop() > 1, 'single-leg branch in ' + t.slice(0, 120));
  }
}
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
fs.mkdirSync(PROGDIR, { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.writeFileSync(path.join(PROGDIR, PROG + '.xml'), prog);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars): ' + rungList(prog).length + ' rungs, ' + (prog.match(/<Tag Name=/g) || []).length + ' tags in ' + PROG);

// ═══ 4. gates ════════════════════════════════════════════════════════════════
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', path.join(PROGDIR, PROG + '.xml')]);
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

// ═══ 5. cover note fragments + contract ══════════════════════════════════════
const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8');
if (!h.includes('<tr><td>' + VERSION + '</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>' + VERSION + '</td><td>' + SHORT + '</td><td>Manual coil jog (D016): in manual, Cam On locks one head&rsquo;s Z and R to the X axis with the auto cam profiles, Bi-Directional, and the operator jogs X with the normal jog buttons; Cam Off, leaving manual, safety, X permissive, a slave fault or a failed engage releases it. Engage needs Z at coil start, R at home, the spike gripper closed and X between place and coil start. The cammed head&rsquo;s own jog / inch / home / position moves and the X position moves / home are blocked meanwhile. HMI_Momentary.12&ndash;15, alarms Head Upstream / Downstream Cam Did Not Engage.</td><td>Jason, ' + SHORT + ': &ldquo;Propose a method to jog the x axis in manual mode with the z and r axes cammed &hellip; bidirectional &hellip; require z and r to be at coil start and home &hellip; momentary &hellip; build.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>' + VERSION + '</td>'), 'head row');
}
if (!b.includes('<tr><td>28</td>')) {
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, '<tr><td>28</td><td>Manual coil jog (D016): four momentary buttons to add on the S10 manual screen &ndash; <code>HMI_Momentary.12</code> Cam On Upstream, <code>.13</code> Cam Off Upstream, <code>.14</code> Cam On Downstream, <code>.15</code> Cam Off Downstream &ndash; with <code>CammedUpstream</code> / <code>CammedDownstream</code> as the indicators. One head at a time.</td><td>Jason / HMI</td></tr>\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>28</td>'), 'ask 28');
}
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (!c.includes('CamJogUpstream')) c = c.trimEnd() + '\n| Manual coil jog (0.7.5, D016) | `CamJogUpstream` / `CamJogDownstream` latched intent, `CammedUpstream` / `CammedDownstream` status, `CamJogLockPosition`; `RAxis{Side}_MAPC_Jog`, `ZAxis{Side}_MAPC_Jog`, `RAxis{Side}_MAS_CamJog`, `ZAxis{Side}_MAS_CamJog`; `HMI_Momentary.12-15` Cam On / Off per head; alarms [21] / [22] Head {Side} Cam Did Not Engage |\n';
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));

if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 6. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);
fs.writeFileSync(headF, h); fs.writeFileSync(backF, b); fs.writeFileSync(cf, c);
console.log('fragments and contract updated');

// ═══ 7. cover note ═══════════════════════════════════════════════════════════
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
