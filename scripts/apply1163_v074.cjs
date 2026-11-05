'use strict';
// apply1163_v074.cjs — runs on the 1163 delivery after Jason's 2026-11-05 Studio copy of v0.7.3 (returnIntake --apply).
// Jason: "please add faults for both upstream / downstream devices. For example, there must be a 'Waiting For Z Axis
// Upstream To Extend To Pick' & 'Waiting For Z Axis Downstream To Extend To Pick' fault."
// Every per-side device in L2_S10_BlueTubeCoiler gets its own state-timeout alarm, qualified by the side working and the
// side's device not done; the shared X axis keeps one. 21 station alarms; their one-shots move to AlarmONS (ONS had no room).
// Cover-note asks 21 and 23 close on Jason's copy. Self-gates: import simulation vs the returned stamp, shape lint on S10.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H = D + '/_history', OUT = D + '/build-inputs/out';
const FILE = D + '/1163_Haemonetics.L5X';
const PROG = 'L2_S10_BlueTubeCoiler', PREFIX = 'L2S10 Tube Coil: ';
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
let x = fs.readFileSync(FILE, 'utf8');

// ── helpers (build1163S10.cjs forms) ──
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungComment = (r) => ((/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(r) || [])[1] || '').trim();
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const tagXml = (body, name) => (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0];
const l5kStr = (s, n) => '[' + s.length + ",'" + s + '$00'.repeat(n - s.length) + "']";
const openTag = (name, type, extra) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n';
const dintTag = (name) => openTag(name, 'DINT', ' Radix="Decimal"') + '<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="DINT" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>';
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

// ── the alarm set: sequence order, Upstream then Downstream for every per-side device ──
const SIDES = ['Upstream', 'Downstream'];
const A = [];
const side = (msg, states, ms, cond) => SIDES.forEach((s) => A.push({ msg: msg.replace('{S}', s), states, ms, side: s, cond: cond(s) }));
const shared = (msg, states, ms) => A.push({ msg, states, ms });
side('Waiting For Z Axis {S} To Extend To Pick', [7], 3000, (s) => 'XIO(ZAxis' + s + 'Pick.InPos)');
shared('Waiting For Pre-Tension Move', [19], 3000);
side('Waiting For Z Axis {S} To Coil Start', [22], 3000, (s) => 'XIO(ZAxis' + s + 'CoilStart.InPos)');
side('Waiting For Nest Opener {S} To Retract', [25, 106], 5000, (s) => 'XIO(NestOpener' + s + 'Retracted)');
side('Waiting For Coil Cams {S} To Lock', [28], 3000, (s) => '[XIO(iq_RAxis' + s + '.PositionCamStatus) ,XIO(iq_ZAxis' + s + '.PositionCamStatus) ]');
shared('Waiting For Coil Move', [31], 15000);
side('Waiting For Coil Cams {S} To Release', [34], 3000, (s) => '[XIC(iq_RAxis' + s + '.PositionCamStatus) ,XIC(iq_ZAxis' + s + '.PositionCamStatus) ]');
side('Waiting For Z Axis {S} To Extend To Place', [37], 3000, (s) => 'XIO(ZAxis' + s + 'Place.InPos)');
side('Waiting For Z Axis {S} To Retract', [46, 103], 3000, (s) => 'XIO(ZAxis' + s + 'Retract.InPos)');
side('Waiting For R Axis {S} To Home', [49, 109], 5000, (s) => 'XIO(RAxis' + s + 'Home.InPos)');
shared('Waiting For X Axis To Return To Pick', [52, 112], 10000);
SIDES.forEach((s) => A.push({ msg: 'Coil Interrupted, Nest ' + s + ' Failed', interrupted: s }));
must(A.length === 21, 'alarm count ' + A.length);
A.forEach((a) => must((PREFIX + a.msg).length <= 82, 'message too long: ' + a.msg));

const stateLeg = (st, s) => 'XIC(Status.State[' + st + '])' + (s && st < 100 ? ' XIC(Work' + s + ')' : '');
const rungOf = (a, i) => {
  if (a.interrupted) return 'XIC(Status.State[100])XIC(CoilStarted' + a.interrupted + ')[OTE(Alarm[' + i + '].Active) ,ONS(AlarmONS.' + i + ') MOVE(1,Alarm[' + i + '].Severity) CONCAT(g_StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];';
  const inStates = a.states.length === 1 ? stateLeg(a.states[0], a.side) : '[' + a.states.map((st) => stateLeg(st, a.side)).join(' ,') + ' ]';
  return '[' + inStates + ' MOVE(' + a.ms + ',Control.FaultTime) XIC(Status.TimeoutFlt)' + (a.cond ? ' ' + a.cond : '') + ' ,XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(AlarmONS.' + i + ') CONCAT(g_StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];';
};

// ── program edits ──
const pm = progRe(PROG).exec(x) || fail('program not found');
let body = pm[0];
const oldAlarm = tagXml(body, 'Alarm'), oldList = tagXml(body, 'AlarmList');
must(oldAlarm.includes('Dimensions="12"') && oldList.includes('Dimensions="12"'), 'Alarm / AlarmList [12] not found');
must(!tagXml(body, 'AlarmONS'), 'AlarmONS already there');
body = body.replace(oldAlarm, alarmArrayTag('Alarm', PREFIX, A.map((a) => a.msg), 21));
body = body.replace(oldList, stringArrayTag('AlarmList', A.map((a) => a.msg), 21) + '\n' + dintTag('AlarmONS'));

const rm = /<Routine\b[^>]*\bName="R20_Alarms"[\s\S]*?<RLLContent>([\s\S]*?)<\/RLLContent>/.exec(body) || fail('R20 not found');
const rungs = rungList(rm[1]);
const first = rungs.findIndex((r) => rungComment(r) === 'Waiting For Z Axis To Extend To Pick');
const last = rungs.findIndex((r) => rungComment(r) === 'Coil Interrupted, Nest Failed');
must(first > 0 && last === first + 11, 'station alarm rungs not where expected: ' + first + ' ' + last);
const fresh = A.map((a, i) => newRung(a.msg, rungOf(a, i)));
const rebuilt = renumber([...rungs.slice(0, first), ...fresh, ...rungs.slice(last + 1)].join('\n'));
body = body.replace(rm[1], '\n' + rebuilt + '\n');
x = x.slice(0, pm.index) + body + x.slice(pm.index + pm[0].length);

// ── checks ──
const prog = progRe(PROG).exec(x)[0];
must(!/ONS\(ONS\.(1[6-9]|2[0-7])\)/.test(prog), 'old alarm one-shots remain');
must((prog.match(/ONS\(AlarmONS\.\d+\)/g) || []).length === 21, 'AlarmONS one-shots');
must(!prog.includes('Alarm[21]') && prog.includes('Alarm[20].Active'), 'alarm indices');
must(prog.includes('Waiting For Z Axis Upstream To Extend To Pick') && prog.includes('Waiting For Z Axis Downstream To Extend To Pick'), 'example faults');
for (const t of [...prog.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1])) {
  // no single-leg branch: every '[' that is not a subscript must see a top-level ',' before its ']'
  let depth = 0, paren = 0; const legs = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') paren++; else if (ch === ')') paren--; else if (paren) continue;
    else if (ch === '[' && !/[A-Za-z0-9_\].]/.test(t[i - 1] || '')) legs.push(1);
    else if (ch === ',' && legs.length) legs[legs.length - 1]++;
    else if (ch === ']' && legs.length && !/[A-Za-z0-9_]/.test(t[i - 1] || '') ) { const n = legs.pop(); must(n > 1, 'single-leg branch in ' + t.slice(0, 120)); }
  }
}
fs.writeFileSync(FILE, x);
console.log('apply v0.7.4: 21 station alarms (' + A.filter((a) => a.side || a.interrupted).length + ' per side, 3 shared), AlarmONS added');

// ── cover-note asks ──
const backF = OUT + '/1163_CoverNote_back.html';
let b = fs.readFileSync(backF, 'utf8');
const row = (n, text, who) => { const re = new RegExp('<tr><td>' + n + '</td><td>[\\s\\S]*?</tr>'); must(re.test(b), 'ask ' + n); b = b.replace(re, '<tr><td>' + n + '</td><td>' + text + '</td><td>' + who + '</td></tr>'); };
row(21, 'Closed: VB6 is 8 bytes in / 8 bytes out, set in Studio (Nov 5). Station map as before: 1&ndash;6 = spike, 3-jaw, nest opener per side; nest-opener retracted sensors on Data[0].0 / .1.', 'Jason');
row(23, 'Closed: Jason&rsquo;s Nov 5 copy sets the cams &ndash; master relative 0 to <code>CoilTravel</code>, first segment cubic, MAPC locks at <code>CoilStartPosition</code> / <code>CoilTravel</code> and follows the X axis Reverse Only; the Z slave is negative (one <code>HMI_CoilPitch</code> down per turn). Pre-tension is an absolute X move to <code>CoilStartPosition</code> (pick + <code>HMI_PretensionDistance</code>).', 'Jason');
b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, '<tr><td>27</td><td>Per-side faults (Nov 5): every Upstream / Downstream device has its own Waiting For alarm, 21 station alarms in all; timeouts carried from 0.7 &ndash; 3 s Z moves and cam lock / release, 5 s nests and rotary home, 15 s coil move, 10 s X return &ndash; adjust to the real moves.</td><td>Jason</td></tr>\n</table>\n<h2>Referenced</h2>');
must(b.includes('<tr><td>27</td>'), 'ask 27');
fs.writeFileSync(backF, b);
console.log('cover-note asks 21, 23 closed, 27 added');

// ── self-gates on the delivery ──
const stamp = fs.readdirSync(H).filter((f) => /^1163_Haemonetics_v0\.7\.3_returned_\d{4}-\d{2}-\d{2}\.L5X$/.test(f)).sort().pop();
must(stamp, 'returned stamp not found');
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const v = run(['scripts/validate1160.cjs', FILE, '--baseline', H + '/' + stamp, '--json', OUT + '/apply_v0.7.4.validate.json']);
const verdict = (v.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0];
console.log('- import simulation vs returned stamp: ' + verdict);
must(/VERDICT: PASS/.test(verdict), 'validate1160 did not pass');
const dir = path.join(ROOT, 'generated', '1163', 'build', 'programs'); fs.mkdirSync(dir, { recursive: true });
const slice = path.join(dir, PROG + '.xml'); fs.writeFileSync(slice, prog);
const l = run(['scripts/shapeLint.cjs', slice]);
const lint = (l.out.match(/shapeLint[^\n]*/) || [l.out.trim().split('\n').pop()])[0];
console.log('- shape lint: ' + lint);
must(/ 0 finding/.test(lint), 'shape lint findings');
