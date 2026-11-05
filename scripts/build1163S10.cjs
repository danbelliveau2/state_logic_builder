#!/usr/bin/env node
'use strict';
/**
 * build1163S10.cjs — 1163 v0.7: L2S10 (EJ) Blue Tube Coiler on the v0.6.2 stamp.
 *
 *   node scripts/build1163S10.cjs [--dry]
 *
 *   One program L2_S10_BlueTubeCoiler (Jason, 2026-11-04: one program, X shared, Z / rotary per nest side):
 *     five axes a10..a14 on sd10..sd14 (order = Master Electrical IP tab), VB6 valve bank, nest openers L/R (retracted
 *     sensors), SCHUNK spike grippers EJ1/EJ2 and 3-jaw coil grippers EJ3/EJ4 (delay-confirmed).
 *     Coil = MAPC position cams per slave (rotary, Z) with the X axis as master (chassis template MCCP/MAPC form),
 *     2-point linear profile built in ladder: rotary 360 deg and Z one pitch per pi*D of X travel (Caleb, EJ walkthrough).
 *   Every existing module moves from 10.1.60.x to 10.68.167.x (IP tab). Indexer rungs 2-4 take S10 (first station wired).
 *   Then gates, deliver, stamp, cover note (same steps as revise1163_v06.cjs).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const BASE = H + '/1163_Haemonetics_v0.6.2_2026-11-03.L5X';
const V54 = path.join(ROOT, 'plc-reference/training-material/SDC Standard Templates/SoftwareStandardization.L5X');
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.7.3';
const ISO = new Date().toISOString().slice(0, 10), SHORT = 'Nov 4';
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const PROG = 'L2_S10_BlueTubeCoiler', PREFIX = 'L2S10 Tube Coil: ', STA = 10, STAPRE = 9;
const SUBNET = '10.68.167.';
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const log = [];
let x = fs.readFileSync(BASE, 'utf8');
const v = fs.readFileSync(V54, 'utf8');

// ── helpers (build1163EA forms) ──────────────────────────────────────────────
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, p, q) => p + t + q);
const setRungComment = (r, c) => r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, p, q) => p + c + q);
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
function programBody(src, name) { const m = progRe(name).exec(src); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = progRe(name).exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(body)) fail('routine not found: ' + rn);
  return body.replace(re, (m, p, inner, q) => p + '\n' + renumber(rungs.join('\n')) + '\n' + q);
}
function editRoutine(prog, rn, fn) { let b = programBody(x, prog) || fail('no program ' + prog); const rungs = rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)); b = putRungs(b, rn, fn(rungs)); replaceProgram(prog, b); }
function tagXml(body, name) { return (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0]; }
function replaceTagIn(body, name, xml) { const old = tagXml(body, name); if (!old) fail('tag not found: ' + name); return body.replace(old, xml); }
const insertBefore = (hay, marker, text, what) => { const i = hay.indexOf(marker); if (i < 0) fail('marker not found: ' + what); return hay.slice(0, i) + text + hay.slice(i); };
const insertAfter = (hay, marker, text, what) => { const i = hay.indexOf(marker); if (i < 0) fail('marker not found: ' + what); const j = i + marker.length; return hay.slice(0, j) + text + hay.slice(j); };
const countOf = (hay, s) => hay.split(s).length - 1;
const rep1 = (src, from, to, what) => { const i = src.indexOf(from); must(i >= 0 && src.indexOf(from, i + 1) < 0, what + ': expected exactly once'); return src.slice(0, i) + to + src.slice(i + from.length); };
const guid = () => '{' + crypto.randomUUID().toUpperCase() + '}';
const moduleXml = (src, name) => (new RegExp('<Module Name="' + name + '"[\\s\\S]*?</Module>').exec(src) || [null])[0] || fail('module not found: ' + name);

// ── tag builders ──
const l5kStr = (s, n) => '[' + s.length + ",'" + s + '$00'.repeat(n - s.length) + "']";
const descXml = (d) => d ? '<Description>\n<![CDATA[' + d + ']]>\n</Description>\n' : '';
const openTag = (name, type, extra) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n';
const l5kReal = (n) => Number(n).toExponential(8).replace(/e([+-])(\d)$/, 'e$10$2');
const decReal = (n) => { const s = String(Number(n)); return s.includes('.') ? s : s + '.0'; };
function scalarTag(name, type, radix, value, { usage, desc } = {}) {
  const dec = type === 'REAL' ? decReal(value) : String(value);
  const l5k = type === 'REAL' ? l5kReal(value) : String(value);
  return openTag(name, type, ' Radix="' + radix + '"' + (usage ? ' Usage="' + usage + '"' : '')) + descXml(desc) +
    '<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + dec + '"/>\n</Data>\n</Tag>';
}
const boolTag = (name, o) => scalarTag(name, 'BOOL', 'Decimal', (o && o.value) || 0, o);
const dintTag = (name, value, o) => scalarTag(name, 'DINT', 'Decimal', value, o);
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
function dintCommentTag(name, comments) {
  const cm = comments.length ? '<Comments>\n' + comments.map(([bit, c]) => '<Comment Operand=".' + bit + '">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n' : '';
  return openTag(name, 'DINT', ' Radix="Decimal"') + cm + '<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="DINT" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>';
}
function sintArrayDecorated(n) { return Array.from({ length: n }, (_, i) => '<Element Index="[' + i + ']" Value="0"/>').join('\n'); }
function bufferTag(name, type, nBytes) {
  return '<Tag Name="' + name + '" Class="Standard" TagType="Base" DataType="' + type + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[[' + Array(nBytes).fill('0').join(',') + ']]]]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="' + type + '">\n<ArrayMember Name="Data" DataType="SINT" Dimensions="' + nBytes + '" Radix="Decimal">\n' + sintArrayDecorated(nBytes) + '\n</ArrayMember>\n</Structure>\n</Data>\n</Tag>';
}
// CAM[n] and CAM_PROFILE[n] (chassis template Chassis program form)
function camTag(name, n) {
  const el = (i) => '<Element Index="[' + i + ']">\n<Structure DataType="CAM">\n<DataValueMember Name="Master" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="Slave" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="SegmentType" DataType="DINT" Radix="Decimal" Value="0"/>\n</Structure>\n</Element>';
  return '<Tag Name="' + name + '" TagType="Base" DataType="CAM" Dimensions="' + n + '" Constant="false" ExternalAccess="None" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[' + Array(n).fill('[0.00000000e+000,0.00000000e+000,0]').join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="CAM" Dimensions="' + n + '">\n' + Array.from({ length: n }, (_, i) => el(i)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function camProfileTag(name, n) {
  const el = (i) => '<Element Index="[' + i + ']">\n<Structure DataType="CAM_PROFILE">\n<DataValueMember Name="Status" DataType="DINT" Radix="Decimal" Value="0"/>\n</Structure>\n</Element>';
  return '<Tag Name="' + name + '" TagType="Base" DataType="CAM_PROFILE" Dimensions="' + n + '" Constant="false" ExternalAccess="None" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[' + Array(n).fill('[0,0,0,0,0,0,0,0,0,0,0,0,0,0]').join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="CAM_PROFILE" Dimensions="' + n + '">\n' + Array.from({ length: n }, (_, i) => el(i)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function copyTag(body, srcName, newName, desc) {
  let t = tagXml(body, srcName) || fail('example tag not found: ' + srcName);
  t = t.replace('<Tag Name="' + srcName + '"', '<Tag Name="' + newName + '"');
  if (desc !== undefined) {
    t = /<Description>/.test(t) ? t.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>\n?/, desc ? descXml(desc) : '') : t.replace(/(<Tag [^>]*>\n)/, '$1' + descXml(desc));
  }
  return t;
}
// ServoOverall with seeded positions
function hmiAxisTag(body, srcName, newName, positions) {
  let t = copyTag(body, srcName, newName, '');
  if (!positions.length) return t;
  const twelve = /\[((?:0\.00000000e\+000[,\s]*){12})\]/;
  must(twelve.test(t), newName + ': Positions[12] L5K');
  const vals = Array.from({ length: 12 }, (_, i) => positions[i] || 0);
  t = t.replace(twelve, '[' + vals.map(l5kReal).join(',') + ']');
  t = t.replace(/(<ArrayMember Name="Positions" DataType="REAL" Dimensions="12" Radix="Float">)([\s\S]*?)(<\/ArrayMember>)/, (m, p, inner, q) => p + '\n' + vals.map((val, i) => '<Element Index="[' + i + ']" Value="' + decReal(val) + '"/>').join('\n') + '\n' + q);
  must(countOf(t, 'Value="' + decReal(positions[0]) + '"') >= 1, newName + ': seeded');
  return t;
}
const L2S00 = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00_IndexerNoSP');
const S01 = programBody(x, 'L2_S01_TubeFeedUpstream') || fail('L2_S01_TubeFeedUpstream');
const TRK = programBody(x, 'L2_Tracking') || fail('L2_Tracking');
const S05 = programBody(v, 'S05_ServoPNP') || fail('V5.4 S05_ServoPNP');
function statusTag(states) {
  let t = tagXml(S01, 'Status') || fail('L2_S01 Status tag');
  const cm = '<Comments>\n' + Object.entries(states).map(([n, c]) => '<Comment Operand=".STATE[' + n + ']">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n';
  t = /<Comments>/.test(t) ? t.replace(/<Comments>[\s\S]*?<\/Comments>\n?/, cm) : t.replace(/(<Tag [^>]*>\n)/, '$1' + cm);
  return t;
}
function programXml(name, tags, routines) {
  const names = tags.map((t) => /<Tag Name="([^"]+)"/.exec(t)[1]);
  must(new Set(names).size === names.length, 'duplicate tag: ' + names.filter((n, i) => names.indexOf(n) !== i).join(','));
  const sorted = tags.slice().sort((a, b) => { const na = /<Tag Name="([^"]+)"/.exec(a)[1].toLowerCase(), nb = /<Tag Name="([^"]+)"/.exec(b)[1].toLowerCase(); return na < nb ? -1 : na > nb ? 1 : 0; });
  const rts = routines.map((r) => '<Routine Name="' + r.name + '" Type="RLL">\n<RLLContent>\n' + renumber(r.rungs.map(([c, t]) => newRung(c, t)).join('\n')) + '\n</RLLContent>\n</Routine>').join('\n');
  return '<Program Name="' + name + '" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">\n<Tags>\n' + sorted.join('\n') + '\n</Tags>\n<Routines>\n' + rts + '\n</Routines>\n</Program>';
}

// ═══ hardware configuration (Master Electrical IP tab, 2026-11-04) ═══════════
const SIDES = ['Upstream', 'Downstream'];
const { tlpBrake } = require('./lib/tlpBrake.cjs'); // brake delays from the motor catalog number (Jason, 2026-11-05)
const AXES = {
  XAxis: { tag: 'a14_L2S10Horizontal', drive: 'sd14_L2S10Horizontal', ip: SUBNET + '33', kind: 'linear', lead: 20.0, motor: 'TLP-A070-040-Dxxx2x', label: 'X Axis', eip: 'Loss Of L2S10 Horizontal Servo EIP' },
  ZAxisUpstream: { tag: 'a12_L2S10VerticalUpstream', drive: 'sd12_L2S10VerticalUpstream', ip: SUBNET + '31', kind: 'linear', lead: 10.0, motor: 'TLP-A070-040-Dxxx4x', label: 'Z Axis Upstream', eip: 'Loss Of L2S10 Vertical Upstream Servo EIP' },
  ZAxisDownstream: { tag: 'a13_L2S10VerticalDownstream', drive: 'sd13_L2S10VerticalDownstream', ip: SUBNET + '32', kind: 'linear', lead: 10.0, motor: 'TLP-A070-040-Dxxx4x', label: 'Z Axis Downstream', eip: 'Loss Of L2S10 Vertical Downstream Servo EIP' },
  RAxisUpstream: { tag: 'a10_L2S10RotaryUpstream', drive: 'sd10_L2S10RotaryUpstream', ip: SUBNET + '29', kind: 'rotary', gear: 10, motor: 'TLP-A070-040-Dxxx2x', label: 'R Axis Upstream', eip: 'Loss Of L2S10 Rotary Upstream Servo EIP' },
  RAxisDownstream: { tag: 'a11_L2S10RotaryDownstream', drive: 'sd11_L2S10RotaryDownstream', ip: SUBNET + '30', kind: 'rotary', gear: 10, motor: 'TLP-A070-040-Dxxx2x', label: 'R Axis Downstream', eip: 'Loss Of L2S10 Rotary Downstream Servo EIP' },
};
const AX_ORDER = ['RAxisUpstream', 'RAxisDownstream', 'ZAxisUpstream', 'ZAxisDownstream', 'XAxis'];   // a10 .. a14
const VB = 'vb06_MainAssembly', VB_IP = SUBNET + '93', VB_IN = 10, VB_OUT = 8;   // EX600-SEN7: 2x DXPC (4) + AXA (4) + DMPF (1) + pad / DYPE (2) + DMPF (1) + 16 stations x 2 coils (4) + pad
const COIL0 = 3;   // first valve-coil byte of the output assembly (after DYPE 0-1, DMPF 2)
// valve station n: A coil = bit 2n-2 (close / extend), B coil = bit 2n-1 (open / retract); EJ1-EJ4 in I/O-list order, nest openers 5 / 6
const VALVE = { SpikeGripperUpstream: 1, SpikeGripperDownstream: 2, CoilGripperUpstream: 3, CoilGripperDownstream: 4, NestOpenerUpstream: 5, NestOpenerDownstream: 6 };
const coilBit = (station, b) => { const bit = 2 * (station - 1) + b; return '.Data[' + (COIL0 + Math.floor(bit / 8)) + '].' + (bit % 8); };
const IP_MOVES = [['sd01_L2Indexer', '10.1.60.20', '20'], ['sd02_L2S01FeedUpstream', '10.1.60.21', '21'], ['sd03_L2S01FeedDownstream', '10.1.60.22', '22'],
  ['fd01_L2S01PayoutUpstreamA', '10.1.60.31', '50'], ['fd02_L2S01PayoutUpstreamB', '10.1.60.32', '51'], ['fd03_L2S01PayoutDownstreamA', '10.1.60.33', '52'], ['fd04_L2S01PayoutDownstreamB', '10.1.60.34', '53'],
  ['vb01_MainAssembly', '10.1.60.40', '90'], ['mm01_L2S01Micrometer', '10.1.60.50', '80']];

// ═══ the program ═════════════════════════════════════════════════════════════
function coilerProgram() {
  const OP = '\\L2_Tracking.p_Data.Station[StaNum].OpStatus.';
  const NEST = (side) => '\\L2_Tracking.p_Data.Nest[NestNumCurrent' + side + ']';
  const AB = { Upstream: 'A', Downstream: 'B' };
  const IDX = '\\L2_S00_IndexerNoSP.';
  const states = {
    0: 'Safety Stop', 1: 'Manual Mode', 2: 'Auto Mode Idle Not Ready', 3: 'Auto Mode Idle Ready',
    4: 'Wait For Index', 7: 'Z Axes To Pick', 10: 'Close Spike Grippers', 13: 'Open Coil Grippers', 16: 'Open Nests', 19: 'Pre-Tension Move', 22: 'Z Axes To Coil Start',
    25: 'Close Nests', 28: 'Lock Cams To X Axis', 31: 'Coil Move To Place', 34: 'Release Cams', 37: 'Z Axes To Place', 40: 'Close Coil Grippers', 43: 'Open Spike Grippers',
    46: 'Retract Z Axes', 49: 'Rotary Axes Home', 52: 'X Axis To Pick', 99: 'Lockout',
    100: 'Initialization Release Grippers', 103: 'Initialization Retract Z Axes', 106: 'Initialization Close Nests', 109: 'Initialization Rotary Home', 112: 'Initialization X Axis To Pick', 124: 'Initialization Complete', 127: 'Fault' };
  const alarms = ['Waiting For Z Axis To Extend To Pick', 'Waiting For Pre-Tension Move', 'Waiting For Z Axis To Coil Start', 'Waiting For Nest Opener To Retract',
    'Waiting For Coil Cams To Lock', 'Waiting For Coil Move', 'Waiting For Coil Cams To Release', 'Waiting For Z Axis To Extend To Place',
    'Waiting For Z Axis To Retract', 'Waiting For R Axis To Home', 'Waiting For X Axis To Return To Pick', 'Coil Interrupted, Nest Failed'];
  const servoAlarms = [];
  for (const a of AX_ORDER.slice().sort((p, q) => ['XAxis', 'ZAxisUpstream', 'ZAxisDownstream', 'RAxisUpstream', 'RAxisDownstream'].indexOf(p) - ['XAxis', 'ZAxisUpstream', 'ZAxisDownstream', 'RAxisUpstream', 'RAxisDownstream'].indexOf(q))) servoAlarms.push(AXES[a].label + ' Servo Drive Is Faulted', AXES[a].label + ' Loss Of Absolute Position Reference');
  const SERVO_ORDER = ['XAxis', 'ZAxisUpstream', 'ZAxisDownstream', 'RAxisUpstream', 'RAxisDownstream'];

  const tags = [
    // parameters
    ...SERVO_ORDER.map((a) => '<Tag Name="iq_' + a + '" TagType="Base" DataType="AXIS_CIP_DRIVE" Usage="InOut" ExternalAccess="Read/Write" OpcUaAccess="None"/>'),
    ...SIDES.map((s) => boolTag('i_NestOpener' + s + 'Retracted', { usage: 'Input', desc: 'Nest ' + s + ' Retracted' })),
    ...SIDES.flatMap((s) => [
      boolTag('q_CloseSpikeGripper' + s, { usage: 'Output', desc: 'Close Spike Gripper ' + s }), boolTag('q_OpenSpikeGripper' + s, { usage: 'Output', desc: 'Open Spike Gripper ' + s }),
      boolTag('q_OpenCoilGripper' + s, { usage: 'Output', desc: 'Open Coil Gripper ' + s }), boolTag('q_CloseCoilGripper' + s, { usage: 'Output', desc: 'Close Coil Gripper ' + s }),
      boolTag('q_ExtendNestOpener' + s, { usage: 'Output', desc: 'Open Nest ' + s }), boolTag('q_RetractNestOpener' + s, { usage: 'Output', desc: 'Close Nest ' + s })]),
    boolTag('q_ActuatorsSafe', { usage: 'Output', desc: 'Actuators Safe For Index' }), boolTag('q_StationComplete', { usage: 'Output' }), boolTag('q_Pause', { usage: 'Output' }),
    boolTag('q_AlarmActive', { usage: 'Output' }), boolTag('q_WarningActive', { usage: 'Output' }), boolTag('q_AutoMode', { usage: 'Output' }), boolTag('q_AutoStopped', { usage: 'Output' }), boolTag('q_StartOK', { usage: 'Output' }),
    realTag('p_CycleTime', 0, { usage: 'Public' }),
    // state engine + alarms (job forms, current engine)
    copyTag(S01, 'Control', 'Control'), statusTag(states), copyTag(S01, 'StateEngine', 'StateEngine'), copyTag(S01, 'StateHistory', 'StateHistory'),
    alarmArrayTag('Alarm', PREFIX, alarms, 12), stringArrayTag('AlarmList', alarms, 12), copyTag(S01, 'ProgramFaultHandler', 'ProgramFaultHandler'),
    alarmArrayTag('ServoAlarm', PREFIX, servoAlarms, 10), stringArrayTag('ServoAlarmList', servoAlarms, 10), copyTag(S01, 'ServoFaultHandler', 'ServoFaultHandler'),
    boolTag('AlarmActive'), boolTag('WarningActive'), boolTag('ServoAlarmActive'), boolTag('ServoWarningActive'),
    // mode / supervisor / tracking (S05 form, per side)
    boolTag('AutoIdle'), boolTag('CycleRunning'), boolTag('CycleStopped'), boolTag('CycleStopping'), copyTag(S01, 'CycleTimer', 'CycleTimer'), boolTag('FaultReset'), dintTag('FaultState', 0),
    boolTag('HMI_LocalManualOverride'), boolTag('Initialized'), boolTag('LocalSSONS'), boolTag('Lockout'), boolTag('ManualMode'), dintTag('ONS', 0), dintTag('RestartState', 0), boolTag('SafetyOK'), dintTag('SafetyStopState', 0),
    boolTag('SS'), boolTag('SS_OK'), boolTag('SingleCycle'), boolTag('SingleDisableTracking'), dintTag('StaNum', 0), dintTag('StaNumPre', 0), boolTag('UseRestartLogic'), boolTag('HMI_MomentaryOnPrevScan'),
    copyTag(TRK, 'ZeroPartAssyStat', 'ZeroPartAssyStat'),
    ...SIDES.flatMap((s) => [dintTag('NestNumCurrent' + s, 0), dintTag('NestNumIncoming' + s, 0), boolTag('CycleStationA' + s), boolTag('CycleStationB' + s), boolTag('Lockout' + s), boolTag('DryRun' + s),
      boolTag('Work' + s), boolTag('CoilStarted' + s), copyTag(S05, 'SingleResetDelay', 'SingleResetDelay' + s), copyTag(S05, 'StationPerformance', 'StationPerformance' + s)]),
    dintCommentTag('HMI_Momentary', [[0, 'Close Spike Gripper Upstream'], [1, 'Open Spike Gripper Upstream'], [2, 'Close Spike Gripper Downstream'], [3, 'Open Spike Gripper Downstream'], [4, 'Open Coil Gripper Upstream'], [5, 'Close Coil Gripper Upstream'], [6, 'Open Coil Gripper Downstream'], [7, 'Close Coil Gripper Downstream'], [8, 'Open Nest Upstream'], [9, 'Close Nest Upstream'], [10, 'Open Nest Downstream'], [11, 'Close Nest Downstream']]),
    // device states
    ...SIDES.flatMap((s) => [
      boolTag('SpikeGripper' + s + 'Closed'), boolTag('SpikeGripper' + s + 'Opened'), copyTag(S05, 'CloseGripperDelay', 'CloseSpikeGripper' + s + 'Delay', 'Spike ' + s + ' Close Delay'), copyTag(S05, 'OpenGripperDelay', 'OpenSpikeGripper' + s + 'Delay', 'Spike ' + s + ' Open Delay'),
      boolTag('CoilGripper' + s + 'Opened'), boolTag('CoilGripper' + s + 'Closed'), copyTag(S05, 'OpenGripperDelay', 'OpenCoilGripper' + s + 'Delay', 'Coil ' + s + ' Open Delay'), copyTag(S05, 'CloseGripperDelay', 'CloseCoilGripper' + s + 'Delay', 'Coil ' + s + ' Close Delay'),
      boolTag('NestOpener' + s + 'Extended'), boolTag('NestOpener' + s + 'Retracted'), timerTag('NestOpener' + s + 'ExtendedDelay', 500, 'Nest ' + s + ' Open Delay')]),
    // coil cams (chassis template form) and setpoints
    camTag('RotaryCam', 2), camProfileTag('RotaryCamProfile', 2), camTag('ZCam', 2), camProfileTag('ZCamProfile', 2),
    copyTag(S01, 'FeedAxis_MAM', 'RotaryCam_MCCP', ''), copyTag(S01, 'FeedAxis_MAM', 'ZCam_MCCP', ''),
    realTag('HMI_CoilDiameter', 75.0, { desc: 'Coil Midline Diameter mm' }), realTag('HMI_CoilPitch', 4.2, { desc: 'Z Travel Per Coil Turn mm' }), realTag('HMI_PretensionDistance', 10.0, { desc: 'Pre-Tension X Move mm' }),
    realTag('CoilStartPosition', 0, { desc: 'X At Coil Start mm' }), realTag('CoilTravel', 0, { desc: 'X Travel While Coiling mm' }), realTag('CoilRevolutions', 0, { desc: 'Rotary Turns Per Coil' }),
    realTag('RotaryCoilTravel', 0, { desc: 'Rotary Travel Per Coil deg' }), realTag('ZCoilTravel', 0, { desc: 'Z Travel Per Coil mm' }),
  ];
  // servo tags per axis (S05 form)
  for (const a of SERVO_ORDER) {
    const C = AXES[a], L = C.label;
    const positions = a === 'XAxis' ? [765.5, 50.0] : [];
    tags.push(hmiAxisTag(S01, 'HMI_FeedAxis', 'HMI_' + a, positions), boolTag(a + 'AutoEnable'), copyTag(S01, 'FeedAxisEnableDelay', a + 'EnableDelay', L.replace(' Axis', '') + ' Enable Delay'), stringTag(a + 'Fault'), stringTag(a + 'FaultMessage'),
      boolTag(a + 'HomeConfimed'), copyTag(S01, 'FeedAxisHomeConfirmDelay', a + 'HomeConfirmDelay', L.replace(' Axis', '') + ' Home Confirm'), boolTag(a + 'HomeRequested'), boolTag(a + 'HomeSelect', { value: C.kind === 'linear' ? 1 : 0 }), realTag(a + 'InchAmount', 0), dintTag(a + 'JogDirection', 0),
      boolTag(a + 'ManMoveTrig'), copyTag(S01, 'FeedAxisMotionParameters', a + 'MotionParameters', ''), dintTag(a + 'ONS', 0), boolTag(a + 'Permissive'), boolTag(a + 'Ready'), copyTag(S01, 'FeedAxisTorqueHome', a + 'TorqueHome', ''),
      ...['_Inch', '_MAFR', '_MAH', '_MAJ', '_MAM', '_MASR', '_MAS_All', '_MAS_Jog', '_MSF', '_MSO'].map((s) => copyTag(S01, 'FeedAxis_MAM', a + s, '')));
    if (a !== 'XAxis') tags.push(copyTag(S01, 'FeedAxis_MAM', a + '_MAPC', ''), copyTag(S01, 'FeedAxis_MAM', a + '_MAS_Cam', ''));
    if (a === 'XAxis') tags.push(copyTag(S05, 'XAxisExtend', 'XAxisPick', 'At Pick Position'), copyTag(S05, 'XAxisExtend', 'XAxisPlace', 'At Place Position'));
    if (/^ZAxis/.test(a)) tags.push(copyTag(S05, 'XAxisExtend', a + 'Pick', 'At Pick Position'), copyTag(S05, 'XAxisExtend', a + 'Place', 'At Place Position'), copyTag(S05, 'XAxisExtend', a + 'Retract', 'At Retract Position'), copyTag(S05, 'XAxisExtend', a + 'CoilStart', 'At Coil Start Position'));
  }
  for (const t of tags) for (const m of t.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) must(m[1].length <= 30, 'description over 30 chars: ' + m[1]);

  // per-side helpers
  const both = (fn) => SIDES.map(fn).join('');
  const bothBr = (fn) => '[' + SIDES.map(fn).join(' ,') + ' ]';
  const legs = (xs) => xs.length === 1 ? xs[0] : '[' + xs.join(' ,') + ' ]'; // Studio refuses a one-leg branch
  const working = (side, cond) => '[XIO(Work' + side + ') ,' + cond + ' ]';   // a head with no work passes
  const everyHead = (fn) => SIDES.map((s) => working(s, fn(s))).join('');

  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R04_XAxisServo,0);'], ['', 'JSR(R05_ZAxisUpstreamServo,0);'], ['', 'JSR(R06_ZAxisDownstreamServo,0);'], ['', 'JSR(R07_RAxisUpstreamServo,0);'], ['', 'JSR(R08_RAxisDownstreamServo,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Nest & Station Numbers', '[MOVE(' + STA + ',StaNum) MOVE(' + STAPRE + ',StaNumPre) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNumA,NestNumCurrentUpstream) MOVE(\\L2_Tracking.p_Data.Station[StaNumPre].NestNumA,NestNumIncomingUpstream) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNumB,NestNumCurrentDownstream) MOVE(\\L2_Tracking.p_Data.Station[StaNumPre].NestNumB,NestNumIncomingDownstream) ];'],
    ['Coil start X = pick position + pre-tension move', 'ADD(HMI_XAxis.Parameters.Positions[0],HMI_PretensionDistance,CoilStartPosition);'],
    ['Mapped/debounced inputs', 'XIC(q_CloseSpikeGripperUpstream)XIO(q_OpenSpikeGripperUpstream)TON(CloseSpikeGripperUpstreamDelay,?,?)XIC(CloseSpikeGripperUpstreamDelay.DN)OTE(SpikeGripperUpstreamClosed);'],
    ['', 'XIC(q_OpenSpikeGripperUpstream)XIO(q_CloseSpikeGripperUpstream)TON(OpenSpikeGripperUpstreamDelay,?,?)XIC(OpenSpikeGripperUpstreamDelay.DN)OTE(SpikeGripperUpstreamOpened);'],
    ['', 'XIC(q_CloseSpikeGripperDownstream)XIO(q_OpenSpikeGripperDownstream)TON(CloseSpikeGripperDownstreamDelay,?,?)XIC(CloseSpikeGripperDownstreamDelay.DN)OTE(SpikeGripperDownstreamClosed);'],
    ['', 'XIC(q_OpenSpikeGripperDownstream)XIO(q_CloseSpikeGripperDownstream)TON(OpenSpikeGripperDownstreamDelay,?,?)XIC(OpenSpikeGripperDownstreamDelay.DN)OTE(SpikeGripperDownstreamOpened);'],
    ['Coil gripper open = jaws set to the coil diameter, closed = coil released', 'XIC(q_OpenCoilGripperUpstream)XIO(q_CloseCoilGripperUpstream)TON(OpenCoilGripperUpstreamDelay,?,?)XIC(OpenCoilGripperUpstreamDelay.DN)OTE(CoilGripperUpstreamOpened);'],
    ['', 'XIC(q_CloseCoilGripperUpstream)XIO(q_OpenCoilGripperUpstream)TON(CloseCoilGripperUpstreamDelay,?,?)XIC(CloseCoilGripperUpstreamDelay.DN)OTE(CoilGripperUpstreamClosed);'],
    ['', 'XIC(q_OpenCoilGripperDownstream)XIO(q_CloseCoilGripperDownstream)TON(OpenCoilGripperDownstreamDelay,?,?)XIC(OpenCoilGripperDownstreamDelay.DN)OTE(CoilGripperDownstreamOpened);'],
    ['', 'XIC(q_CloseCoilGripperDownstream)XIO(q_OpenCoilGripperDownstream)TON(CloseCoilGripperDownstreamDelay,?,?)XIC(CloseCoilGripperDownstreamDelay.DN)OTE(CoilGripperDownstreamClosed);'],
    ['Nest openers: retracted sensor, extended by delay', 'XIO(i_NestOpenerUpstreamRetracted)XIC(q_ExtendNestOpenerUpstream)XIO(q_RetractNestOpenerUpstream)TON(NestOpenerUpstreamExtendedDelay,?,?)XIC(NestOpenerUpstreamExtendedDelay.DN)OTE(NestOpenerUpstreamExtended);'],
    ['', 'XIC(i_NestOpenerUpstreamRetracted)XIC(q_RetractNestOpenerUpstream)XIO(q_ExtendNestOpenerUpstream)OTE(NestOpenerUpstreamRetracted);'],
    ['', 'XIO(i_NestOpenerDownstreamRetracted)XIC(q_ExtendNestOpenerDownstream)XIO(q_RetractNestOpenerDownstream)TON(NestOpenerDownstreamExtendedDelay,?,?)XIC(NestOpenerDownstreamExtendedDelay.DN)OTE(NestOpenerDownstreamExtended);'],
    ['', 'XIC(i_NestOpenerDownstreamRetracted)XIC(q_RetractNestOpenerDownstream)XIO(q_ExtendNestOpenerDownstream)OTE(NestOpenerDownstreamRetracted);'],
    ['Logic inputs  *Replace always off bits with real conditions', 'XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);'],
    ['', 'XIC(\\Supervisor.q_AutoIdle)OTE(AutoIdle);'], ['', 'XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'], ['', 'XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'],
    ['', '[XIC(\\Supervisor.q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ,XIC(' + OP + 'SingleStepA) ,XIC(' + OP + 'SingleStepB) ,XIC(' + OP + 'SingleCycleA) ,XIC(' + OP + 'SingleCycleB) ]OTE(CycleRunning);'],
    ['', 'XIO(\\Supervisor.q_CycleStartLatch)XIO(HMI_LocalManualOverride)XIO(' + OP + 'SingleStepA)XIO(' + OP + 'SingleStepB)XIO(' + OP + 'SingleCycleA)XIO(' + OP + 'SingleCycleB)OTE(CycleStopping);'],
    ['', 'XIC(\\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);'],
    ['', 'XIC(ZAxisUpstreamRetract.InPos)XIC(ZAxisDownstreamRetract.InPos)XIC(NestOpenerUpstreamRetracted)XIC(NestOpenerDownstreamRetracted)XIC(SpikeGripperUpstreamOpened)XIC(SpikeGripperDownstreamOpened)XIC(CoilGripperUpstreamClosed)XIC(CoilGripperDownstreamClosed)XIC(XAxisPick.InPos)OTE(Initialized);'],
    ['Lockout per nest side, station lockout when both', 'XIC(' + OP + 'LockoutA)XIO(ManualMode)OTE(LockoutUpstream);'],
    ['', 'XIC(' + OP + 'LockoutB)XIO(ManualMode)OTE(LockoutDownstream);'],
    ['', 'XIC(LockoutUpstream)XIC(LockoutDownstream)OTE(Lockout);'],
    ['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + OP + 'DryRunA) ,XIC(g_HMI_DryRun) ]OTE(DryRunUpstream);'],
    ['', '[XIC(' + OP + 'DryRunB) ,XIC(g_HMI_DryRun) ]OTE(DryRunDownstream);'],
    ['Single Step Logic, either side steps both heads', '[XIC(AutoIdle) ,XIC(HMI_LocalManualOverride) ][XIC(' + OP + 'SingleStepA) ,XIC(' + OP + 'SingleStepB) ,XIC(' + OP + 'SingleCycleA) ,XIC(' + OP + 'SingleCycleB) ]OTE(SS);'],
    ['', 'XIC(SS)[XIC(' + OP + 'SingleDisableTrackingA) ,XIC(' + OP + 'SingleDisableTrackingB) ]OTE(SingleDisableTracking);'],
    ['', '[XIC(' + OP + 'SingleStepA) ,XIC(' + OP + 'SingleStepB) ]ONS(ONS.12)OTU(' + OP + 'SingleCycleA)OTU(' + OP + 'SingleCycleB);'],
    ['', '[XIC(' + OP + 'SingleCycleA) ,XIC(' + OP + 'SingleCycleB) ]ONS(ONS.13)OTU(' + OP + 'SingleStepA)OTU(' + OP + 'SingleStepB);'],
    ['', '[XIC(AutoIdle) ,XIC(HMI_LocalManualOverride) ][XIC(' + OP + 'SingleCycleA) XIC(' + OP + 'SingleTriggerA) ,XIC(' + OP + 'SingleCycleB) XIC(' + OP + 'SingleTriggerB) ]ONS(ONS.14)OTL(SingleCycle);'],
    ['', 'XIC(SingleCycle)[XIO(AutoIdle) XIO(HMI_LocalManualOverride) ,XIO(' + OP + 'SingleCycleA) XIO(' + OP + 'SingleCycleB) ,XIC(q_AlarmActive) ,XIC(Status.State[4]) ONS(ONS.15) ]OTU(SingleCycle);'],
    ['', '[XIO(SS) ,[XIC(AutoIdle) ,XIC(HMI_LocalManualOverride) ] XIC(' + IDX + 'p_OnStation) [[XIC(LocalSSONS) ,XIC(' + OP + 'SingleTriggerA) ,XIC(' + OP + 'SingleTriggerB) ] ONS(ONS.1) ,XIC(SingleCycle) ] ]OTE(SS_OK);'],
    ['', 'XIC(SS)XIC(' + OP + 'SingleClearTrackingA)TON(SingleResetDelayUpstream,?,?)XIC(SingleResetDelayUpstream.DN)COP(ZeroPartAssyStat,' + NEST('Upstream') + '.PartStatus,1);'],
    ['', 'XIC(SS)XIC(' + OP + 'SingleClearTrackingB)TON(SingleResetDelayDownstream,?,?)XIC(SingleResetDelayDownstream.DN)COP(ZeroPartAssyStat,' + NEST('Downstream') + '.PartStatus,1);'],
    ['Cycle Station per nest side', cycleStation('Upstream')],
    ['', cycleStation('Downstream')],
    ['Clear HMI Manual Triggers', 'XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);'], ['', 'NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'],
  ];
  function cycleStation(s) {
    return '[XIC(' + NEST(s) + '.PartStatus.PartLoaded) [XIC(' + NEST(s) + '.PartStatus.Station[StaNumPre].Success) ,XIC(' + NEST(s) + '.PartStatus.Station[StaNumPre].Lockout) ] ,XIC(DryRun' + s + ') ][XIO(' + NEST(s) + '.PartStatus.Station[StaNum].Attempt) OTE(CycleStationA' + s + ') ,OTE(CycleStationB' + s + ') ];';
  }
  const trk = (s, bit) => NEST(s) + '.PartStatus.Station[StaNum].' + bit;
  const R02 = [
    ['Start Of State Machine', 'NOP();'],
    ['State 2: Auto mode idle not ready', '[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);'],
    ['State 3: Auto mode idle ready', '[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);'],
    ['State 4: Start of sequence, wait for the index with the heads at pick', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[124]) ,XIC(Status.State[52]) XIC(XAxis_MAM.PC) XIC(XAxisPick.InPos) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Nests on station, extend the working Z axes to pick', 'XIC(Status.State[4])XIC(' + IDX + 'q_WaitStationsComplete)[XIC(WorkUpstream) ,XIC(WorkDownstream) ]XIC(SS_OK)MOVE(7,Control.StateReg)XIO(SingleDisableTracking)[XIC(WorkUpstream) OTL(' + trk('Upstream', 'Attempt') + ') ,XIC(WorkDownstream) OTL(' + trk('Downstream', 'Attempt') + ') ];'],
    ['State 10: Close the spike grippers on the tube', 'XIC(Status.State[7])' + everyHead((s) => 'XIC(ZAxis' + s + '_MAM.PC) XIC(ZAxis' + s + 'Pick.InPos)') + 'XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Open the coil grippers to the coil diameter', 'XIC(Status.State[10])' + everyHead((s) => 'XIC(SpikeGripper' + s + 'Closed)') + 'XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Open the nests', 'XIC(Status.State[13])' + everyHead((s) => 'XIC(CoilGripper' + s + 'Opened)') + 'XIC(SS_OK)MOVE(16,Control.StateReg);'],
    ['State 19: Pre-tension the tube with a short X move', 'XIC(Status.State[16])' + everyHead((s) => 'XIC(NestOpener' + s + 'Extended)') + 'XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: Lift the working Z axes to the coil start height', 'XIC(Status.State[19])XIC(XAxis_MAM.PC)XIC(SS_OK)MOVE(22,Control.StateReg);'],
    ['State 25: Close the nests', 'XIC(Status.State[22])' + everyHead((s) => 'XIC(ZAxis' + s + '_MAM.PC) XIC(ZAxis' + s + 'CoilStart.InPos)') + 'XIC(SS_OK)MOVE(25,Control.StateReg);'],
    ['State 28: Lock the working rotary and Z axes to the X axis', 'XIC(Status.State[25])' + everyHead((s) => 'XIC(NestOpener' + s + 'Retracted)') + 'XIC(SS_OK)MOVE(28,Control.StateReg);'],
    ['State 31: Coil, X axis to place with the heads following', 'XIC(Status.State[28])' + everyHead((s) => 'XIC(RAxis' + s + '_MAPC.IP) XIC(ZAxis' + s + '_MAPC.IP)') + 'XIC(SS_OK)MOVE(31,Control.StateReg);'],
    ['State 34: Release the heads from the X axis', 'XIC(Status.State[31])XIC(XAxis_MAM.PC)XIC(XAxisPlace.InPos)XIC(SS_OK)MOVE(34,Control.StateReg);'],
    ['State 37: Working Z axes down to place', 'XIC(Status.State[34])' + everyHead((s) => 'XIC(RAxis' + s + '_MAS_Cam.PC) XIC(ZAxis' + s + '_MAS_Cam.PC)') + 'XIC(SS_OK)MOVE(37,Control.StateReg);'],
    ['State 40: Close the coil grippers to relax the coil', 'XIC(Status.State[37])' + everyHead((s) => 'XIC(ZAxis' + s + '_MAM.PC) XIC(ZAxis' + s + 'Place.InPos)') + 'XIC(SS_OK)MOVE(40,Control.StateReg);'],
    ['State 43: Open the spike grippers', 'XIC(Status.State[40])' + everyHead((s) => 'XIC(CoilGripper' + s + 'Closed)') + 'XIC(SS_OK)MOVE(43,Control.StateReg);'],
    ['State 46: Coil placed, retract the Z axes', 'XIC(Status.State[43])' + everyHead((s) => 'XIC(SpikeGripper' + s + 'Opened)') + 'XIC(SS_OK)MOVE(46,Control.StateReg)XIO(SingleDisableTracking)[XIC(WorkUpstream) OTL(' + trk('Upstream', 'Success') + ') ,XIC(WorkDownstream) OTL(' + trk('Downstream', 'Success') + ') ];'],
    ['State 49: Rotary axes back to home', 'XIC(Status.State[46])' + everyHead((s) => 'XIC(ZAxis' + s + '_MAM.PC) XIC(ZAxis' + s + 'Retract.InPos)') + 'XIC(SS_OK)MOVE(49,Control.StateReg);'],
    ['State 52: X axis back to pick', 'XIC(Status.State[49])' + everyHead((s) => 'XIC(RAxis' + s + '_MAM.PC)') + 'XIC(SS_OK)MOVE(52,Control.StateReg);'],
    ['State 99: Lockout', 'XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);'],
    ['State 100:Start of initialization sequence, release the grippers', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization retract the Z axes', 'XIC(Status.State[100])XIC(SpikeGripperUpstreamOpened)XIC(SpikeGripperDownstreamOpened)XIC(CoilGripperUpstreamClosed)XIC(CoilGripperDownstreamClosed)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 106: Initialization close the nests', 'XIC(Status.State[103])XIC(ZAxisUpstream_MAM.PC)XIC(ZAxisUpstreamRetract.InPos)XIC(ZAxisDownstream_MAM.PC)XIC(ZAxisDownstreamRetract.InPos)XIC(SS_OK)MOVE(106,Control.StateReg);'],
    ['State 109: Initialization rotary axes home', 'XIC(Status.State[106])XIC(NestOpenerUpstreamRetracted)XIC(NestOpenerDownstreamRetracted)XIC(SS_OK)MOVE(109,Control.StateReg);'],
    ['State 112: Initialization X axis to pick', 'XIC(Status.State[109])XIC(RAxisUpstream_MAM.PC)XIC(RAxisDownstream_MAM.PC)XIC(SS_OK)MOVE(112,Control.StateReg);'],
    ['State 124: Initialization complete', 'XIC(Status.State[112])XIC(XAxis_MAM.PC)XIC(XAxisPick.InPos)MOVE(124,Control.StateReg);'],
    ['Restart Logic  *Use the part status at this station to determine a course of action here.  For instance, no attempt made, no part present, no success or failure status at this station indicates initialization is in order. If an attempt was made with no success or failure, restart at last state may be in order. Also, you do not always need to go into the state you left. Some cases require you to go into the prior state to restart a particular portion of the sequence.', 'XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)XIC(g_MachineBasic.AlwaysOff)MOVE(RestartState,FaultState);'],
    ['State 127: Fault', 'XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];'],
    ['State 1: Manual Mode', 'XIC(ManualMode)MOVE(1,Control.StateReg);'],
    ['State 0: Safety Stop', '[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];'],
    ['', 'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'],
    ['Cycle Time  **Limit Instruction Low & High Limits Populated WIth Range Of States In Which Station Is Running (Example, PNP Is Picking & Placing A Part) **Cycle Complete State Shown As Example', '[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];'],
  ];
  const gripper = (out, closeStates, openStates, side, bitOn, bitOff, other) =>
    '[XIO(Status.State[1]) [' + closeStates + ' ,XIC(' + out + ') ' + openStates + ' ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.' + bitOn + ') ,XIC(' + out + ') XIO(HMI_Momentary.' + bitOff + ') ] ]OTE(' + out + ');';
  const sideOut = (s) => {
    const b = s === 'Upstream' ? 0 : 2;   // momentary bit base per side (spike 0/2, coil 4/6, nest 8/10)
    return [
      ['Spike Gripper ' + s + ' Control: closed on the tube, opened once the coil is placed', gripper('q_CloseSpikeGripper' + s, 'XIC(Status.State[10]) XIC(Work' + s + ')', 'XIO(Status.State[43]) XIO(Status.State[100])', s, b, b + 1)],
      ['', gripper('q_OpenSpikeGripper' + s, 'XIC(Status.State[43]) ,XIC(Status.State[100])', '[XIO(Status.State[10]) ,XIO(Work' + s + ') ]', s, b + 1, b)],
      ['Coil Gripper ' + s + ' Control: open to set the coil diameter, closed to release the coil', gripper('q_OpenCoilGripper' + s, 'XIC(Status.State[13]) XIC(Work' + s + ')', 'XIO(Status.State[40]) XIO(Status.State[100])', s, 4 + b, 5 + b)],
      ['', gripper('q_CloseCoilGripper' + s, 'XIC(Status.State[40]) ,XIC(Status.State[100])', '[XIO(Status.State[13]) ,XIO(Work' + s + ') ]', s, 5 + b, 4 + b)],
      ['Nest Opener ' + s + ' Control: open the nest to free the tube, close it once the tube is lifted', gripper('q_ExtendNestOpener' + s, 'XIC(Status.State[16]) XIC(Work' + s + ')', 'XIO(Status.State[25]) XIO(Status.State[106])', s, 8 + b, 9 + b)],
      ['', gripper('q_RetractNestOpener' + s, 'XIC(Status.State[25]) ,XIC(Status.State[106])', '[XIO(Status.State[16]) ,XIO(Work' + s + ') ]', s, 9 + b, 8 + b)],
    ];
  };
  const mapc = (slave, profile) => 'MAPC(iq_' + slave + ',iq_XAxis,' + slave + '_MAPC,0,' + profile + ',1,1,Once,Immediate,0,iq_XAxis.ActualPosition,New Cam,Command,Bi-Directional)';
  const masCam = (slave) => 'MAS(iq_' + slave + ',' + slave + '_MAS_Cam,Position Cam,Yes,HMI_' + slave + '.Parameters.Decel[0],Units per sec2,No,0,Units per sec3)';
  const perf = (s) => 'XIC(g_MachineBasic.AlwaysOn)StationPerformance(StationPerformance' + s + ',' + trk(s, 'Attempt') + ',' + trk(s, 'Success') + ',g_PresetStationPerformLow,g_PresetStationPerformHigh,\\L2_Tracking.p_Data.Station[StaNum].PerformData.Attempts' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Successes' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Failures' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Efficiency' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.HMIColorStatus' + AB[s] + ');';
  const R03 = [
    ['Output Status to Supervisor', SERVO_ORDER.map((a) => 'XIC(iq_' + a + '.ServoActionStatus)XIC(iq_' + a + '.AxisHomedStatus)').join('') + 'XIO(' + OP + 'SingleStepA)XIO(' + OP + 'SingleStepB)XIO(' + OP + 'SingleCycleA)XIO(' + OP + 'SingleCycleB)OTE(q_StartOK);'],
    ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ]XIO(CycleRunning)OTE(q_AutoMode);'],
    ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ,XIC(Status.State[127]) ]XIO(CycleRunning)OTE(q_AutoStopped);'],
    ['Actuators Safe For Index', 'XIC(iq_ZAxisUpstream.AxisHomedStatus)XIC(ZAxisUpstreamRetract.InPos)XIC(iq_ZAxisDownstream.AxisHomedStatus)XIC(ZAxisDownstreamRetract.InPos)XIC(NestOpenerUpstreamRetracted)XIC(NestOpenerDownstreamRetracted)OTE(q_ActuatorsSafe);'],
    ['Pause Request To Indexer', 'XIC(g_MachineBasic.AlwaysOff)OTE(q_Pause);'],
    ['Heads working this cycle: a side with a part to coil and not locked out, held until the cycle ends', '[XIC(Status.State[4]) XIC(CycleStationAUpstream) XIO(LockoutUpstream) ,XIC(WorkUpstream) XIO(Status.State[1]) XIO(Status.State[2]) XIO(Status.State[3]) XIO(Status.State[4]) ]OTE(WorkUpstream);'],
    ['', '[XIC(Status.State[4]) XIC(CycleStationADownstream) XIO(LockoutDownstream) ,XIC(WorkDownstream) XIO(Status.State[1]) XIO(Status.State[2]) XIO(Status.State[3]) XIO(Status.State[4]) ]OTE(WorkDownstream);'],
    ['Coil started: the spike gripper holds the tube until the coil is placed', '[XIC(Status.State[10]) XIC(WorkUpstream) ,XIC(CoilStartedUpstream) XIO(Status.State[46]) XIO(Status.State[103]) XIO(g_MachineBasic.PowerUpCP) ]OTE(CoilStartedUpstream);'],
    ['', '[XIC(Status.State[10]) XIC(WorkDownstream) ,XIC(CoilStartedDownstream) XIO(Status.State[46]) XIO(Status.State[103]) XIO(g_MachineBasic.PowerUpCP) ]OTE(CoilStartedDownstream);'],
    ['Coil interrupted: a tube released at initialization fails its nest', 'XIC(Status.State[100])ONS(ONS.5)XIO(SingleDisableTracking)[XIC(CoilStartedUpstream) OTL(' + trk('Upstream', 'Failure') + ') MOVE(101,' + NEST('Upstream') + '.PartStatus.FailureType) ,XIC(CoilStartedDownstream) OTL(' + trk('Downstream', 'Failure') + ') MOVE(101,' + NEST('Downstream') + '.PartStatus.FailureType) ];'],
    ['Set Part Tracking If Station Or Side Is Locked Out', 'XIC(' + IDX + 'q_WaitStationsComplete)[XIC(Status.State[99]) ,XIC(LockoutUpstream) ]XIC(' + NEST('Upstream') + '.PartStatus.PartLoaded)OTL(' + trk('Upstream', 'Lockout') + ');'],
    ['', 'XIC(' + IDX + 'q_WaitStationsComplete)[XIC(Status.State[99]) ,XIC(LockoutDownstream) ]XIC(' + NEST('Downstream') + '.PartStatus.PartLoaded)OTL(' + trk('Downstream', 'Lockout') + ');'],
    ['Station Complete', 'XIC(' + IDX + 'q_WaitStationsComplete)' + SIDES.map((s) => '[XIC(CycleStationB' + s + ') [XIC(' + trk(s, 'Success') + ') ,XIC(' + trk(s, 'Failure') + ') ,XIC(' + trk(s, 'Lockout') + ') ] ,XIO(CycleStationB' + s + ') ]').join('') + 'OTE(q_StationComplete);'],
    ...sideOut('Upstream'), ...sideOut('Downstream'),
    ['Coil cam profiles: one rotary turn and one pitch of Z per pi x coil diameter of X travel, place to coil start', 'XIC(Status.State[28])SUB(CoilStartPosition,HMI_XAxis.Parameters.Positions[1],CoilTravel)CPT(CoilRevolutions,CoilTravel/(3.14159*HMI_CoilDiameter))CPT(RotaryCoilTravel,CoilRevolutions*360.0)CPT(ZCoilTravel,CoilRevolutions*HMI_CoilPitch)[MOVE(HMI_XAxis.Parameters.Positions[1],RotaryCam[0].Master) MOVE(RotaryCoilTravel,RotaryCam[0].Slave) MOVE(0,RotaryCam[0].SegmentType) ,MOVE(CoilStartPosition,RotaryCam[1].Master) MOVE(0.0,RotaryCam[1].Slave) MOVE(0,RotaryCam[1].SegmentType) ,MOVE(HMI_XAxis.Parameters.Positions[1],ZCam[0].Master) MOVE(ZCoilTravel,ZCam[0].Slave) MOVE(0,ZCam[0].SegmentType) ,MOVE(CoilStartPosition,ZCam[1].Master) MOVE(0.0,ZCam[1].Slave) MOVE(0,ZCam[1].SegmentType) ]MCCP(RotaryCam_MCCP,RotaryCam,2,0,0,RotaryCamProfile)MCCP(ZCam_MCCP,ZCam,2,0,0,ZCamProfile);'],
    ['Lock the Upstream head to the X axis', 'XIC(Status.State[28])XIC(WorkUpstream)XIC(RotaryCam_MCCP.DN)XIC(ZCam_MCCP.DN)' + mapc('RAxisUpstream', 'RotaryCamProfile') + mapc('ZAxisUpstream', 'ZCamProfile') + ';'],
    ['Lock the Downstream head to the X axis', 'XIC(Status.State[28])XIC(WorkDownstream)XIC(RotaryCam_MCCP.DN)XIC(ZCam_MCCP.DN)' + mapc('RAxisDownstream', 'RotaryCamProfile') + mapc('ZAxisDownstream', 'ZCamProfile') + ';'],
    ['Release the heads from the X axis once the coil move is done', 'XIC(Status.State[34])XIC(WorkUpstream)' + masCam('RAxisUpstream') + masCam('ZAxisUpstream') + ';'],
    ['', 'XIC(Status.State[34])XIC(WorkDownstream)' + masCam('RAxisDownstream') + masCam('ZAxisDownstream') + ';'],
    ['Station Performance per nest side', perf('Upstream')],
    ['', perf('Downstream')],
  ];

  // ── servo routine per axis (S05 R04 / R05 form) ──
  function servoRoutine(a, o) {
    const A = 'iq_' + a, H = 'HMI_' + a, P = H + '.Parameters', ST = H + '.Status', CT = H + '.Control', MP = a + 'MotionParameters';
    const r = [
      ['Axis Is Ready For Operation', 'XIC(MotionGroup.GroupSynced)XIO(' + A + '.SafeTorqueOffActiveInhibit)OTE(' + a + 'Ready);'],
      ['', 'XIC(SafetyOK)XIC(' + a + 'Ready)TON(' + a + 'EnableDelay,?,?)XIC(' + a + 'EnableDelay.DN)ONS(' + a + 'ONS.0)OTE(' + a + 'AutoEnable);'],
      ['Axis Motion Permissive (Add more conditions if necessary. Permissive should be based on the physical state of itself potentially interfering devices)', o.permissive + 'OTE(' + a + 'Permissive);'],
      ['Enable Axis', '[XIC(Status.State[1]) XIC(' + CT + '.Enable) XIC(' + a + 'Ready) ,XIC(' + a + 'AutoEnable) ]XIO(' + A + '.ServoActionStatus)MSO(' + A + ',' + a + '_MSO);'],
      ['Disable Axis', 'XIC(Status.State[1])XIC(' + CT + '.Disable)MSF(' + A + ',' + a + '_MSF);'],
      ['Fault Reset Axis', 'NE(' + A + '.AxisFault,0)XIC(FaultReset)[XIO(' + A + '.ShutdownStatus) MAFR(' + A + ',' + a + '_MAFR) ,XIC(' + A + '.ShutdownStatus) MASR(' + A + ',' + a + '_MASR) ];'],
      ['Jog Axis', 'XIC(Status.State[1])XIC(' + a + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)[XIC(' + CT + '.JogPositive) XIO(' + CT + '.JogNegative) MOVE(0,' + a + 'JogDirection) ,XIC(' + CT + '.JogNegative) XIO(' + CT + '.JogPositive) MOVE(1,' + a + 'JogDirection) ]MAJ(' + A + ',' + a + '_MAJ,' + a + 'JogDirection,' + P + '.JogSpeed,Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None);'],
      ['', 'XIC(' + a + '_MAJ.IP)XIO(' + CT + '.JogPositive)XIO(' + CT + '.JogNegative)MAS(' + A + ',' + a + '_MAS_Jog,Jog,Yes,' + P + '.Decel[0],Units per sec2,No,0,Units per sec3);'],
      ['Inch Axis', 'XIC(Status.State[1])[XIC(' + CT + '.InchPositive) ONS(' + a + 'ONS.1) MOVE(' + P + '.InchAmount,' + a + 'InchAmount) ,XIC(' + CT + '.InchNegative) ONS(' + a + 'ONS.2) NEG(' + P + '.InchAmount,' + a + 'InchAmount) ]XIC(' + a + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)MAM(' + A + ',' + a + '_Inch,1,' + a + 'InchAmount,' + P + '.ManualSpeed,Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);'],
      ['Home Axis', 'XIC(Status.State[1])[XIC(' + CT + '.HomeRequest) ONS(' + a + 'ONS.3) XIO(' + a + 'TorqueHome.IP) ,XIC(' + a + 'HomeRequested) XIO(' + a + 'HomeConfirmDelay.DN) XIO(' + a + 'HomeConfimed) ]XIC(' + a + 'Ready)[OTE(' + a + 'HomeRequested) ,TON(' + a + 'HomeConfirmDelay,?,?) ];'],
      ['', 'XIC(Status.State[1])[XIC(' + CT + '.HomeConfirm) ONS(' + a + 'ONS.4) ,XIC(' + a + 'HomeConfimed) XIC(' + a + 'HomeSelect) XIO(' + a + 'TorqueHome.PC) XIO(' + a + 'TorqueHome.Error) ]OTE(' + a + 'HomeConfimed);'],
      ['Home Select = 0 is for Immediate Home (Example, servo indexer) Home Select = 1 is for Home To Torque (Example, PNP)  Homing Torque = Start at 25%, Increase In 5% Increments If Not Enough Run Torque = Normal Running Torque Of Axis Homing Speed = Homing Speed in units/s Overtorque Limit = Set The Same As Homing Torque Home Offset Distance = Distance Moved Off Of Hard Stop When Homing Complete Home Direction = 0 Is Positive, 1 Is Negative', 'XIC(' + a + 'HomeConfimed)[XIO(' + a + 'HomeSelect) MAH(' + A + ',' + a + '_MAH) ,XIC(' + a + 'HomeSelect) AOI_TorqueHome(' + a + 'TorqueHome,' + A + ',25.0,100.0,5.0,25.0,0.5,1) ];'],
      ['', '[XIC(' + a + 'HomeRequested) OTE(' + ST + '.HomeRequested) ,[XIC(' + a + 'TorqueHome.IP) ,XIC(' + a + '_MAH.IP) ] OTE(' + ST + '.HomeInProcess) ,[XIC(' + a + 'TorqueHome.PC) ,XIC(' + a + '_MAH.PC) ] OTE(' + ST + '.HomeComplete) ];'],
      ['Manual Mode', 'XIC(SafetyOK)XIC(Status.State[1])[[MOVE(' + P + '.ManualSpeed,' + MP + '.Speed) ,MOVE(' + P + '.Accel[0],' + MP + '.Accel) ,MOVE(' + P + '.Decel[0],' + MP + '.Decel) ] ,XIC(' + a + 'Permissive) ' + legs(o.manual.map((name, i) => 'XIC(' + CT + '.ManMoves.' + i + ') MOVE(' + P + '.Positions[' + i + '],' + MP + '.Position)')) + ' OTE(' + a + 'ManMoveTrig) ];'],
      [o.autoComment, 'XIC(SafetyOK)XIO(Status.State[1])[MOVE(' + o.moveType + ',' + MP + '.MoveType) ,MOVE(' + P + '.AutoSpeed[0],' + MP + '.Speed) ,MOVE(' + P + '.Accel[0],' + MP + '.Accel) ,MOVE(' + P + '.Decel[0],' + MP + '.Decel) ,' + o.auto + ' ];'],
      ['Axis Motion Command', 'XIC(SafetyOK)[XIC(Status.State[1]) XIC(' + a + 'ManMoveTrig) ,XIO(Status.State[1]) ' + o.mamGate + ' ]XIC(' + A + '.ServoActionStatus)XIC(' + A + '.AxisHomedStatus)XIC(' + a + 'Permissive)MAM(' + A + ',' + a + '_MAM,' + MP + '.MoveType,' + MP + '.Position,' + MP + '.Speed,Units per sec,' + MP + '.Accel,Units per sec2,' + MP + '.Decel,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);'],
      ['Stop axis if permissive turns off while in motion and use max or close to max decel value', 'XIO(' + A + '.MotionStatus.0)[XIO(' + a + 'Permissive) ,XIO(SafetyOK) ]MAS(' + A + ',' + a + '_MAS_All,All,Yes,' + ST + '.MaxDecel,Units per sec2,Yes,10,% of Time);'],
      ['Set torque', 'XIC(' + CT + '.SetTorquePos)MOVE(' + P + '.TorquePos,' + A + '.TorqueLimitPositive);'],
      ['', 'XIC(' + CT + '.SetTorqueNeg)MOVE(' + P + '.TorqueNeg,' + A + '.TorqueLimitNegative);'],
      ['Retrieve values from axis', 'MOVE(' + A + '.ActualPosition,' + ST + '.ActualPosition)MOVE(' + A + '.ActualVelocity,' + ST + '.ActualVelocity)MOVE(' + A + '.TorqueReferenceFiltered,' + ST + '.ActualTorque);'],
      ['Retrieve the maximum speed value from the axis and calculate max accel and decel.  The max velocity is 85% of full speed.  Equation is based upon 100% speed at a 30ms accel/decel time.', 'XIC(S:FS)GSV(Axis,' + A + ',MaximumSpeed,' + ST + '.MaxVelocity)CPT(' + ST + '.MaxAccel,(' + ST + '.MaxVelocity/0.85)/0.03)MOVE(' + ST + '.MaxAccel,' + ST + '.MaxDecel);'],
    ];
    if (o.ranges) r.push(['Axis Position Monitor', legs(o.ranges.map(([n, i, wide]) => 'AOI_RangeCheck(' + n + ',' + P + '.Positions[' + i + '],0.5,' + ST + '.ActualPosition,' + wide + ')')) + ';']);
    return r;
  }
  const zAxis = (s) => servoRoutine('ZAxis' + s, {
    permissive: 'XIC(g_MachineBasic.AlwaysOn)', manual: ['Pick', 'Place', 'Retract', 'CoilStart'], moveType: 0,
    autoComment: 'Auto Mode - 0 pick, 1 place, 2 retract, 3 coil start',
    auto: 'XIC(Status.State[7]) MOVE(HMI_ZAxis' + s + '.Parameters.Positions[0],ZAxis' + s + 'MotionParameters.Position) ,XIC(Status.State[37]) MOVE(HMI_ZAxis' + s + '.Parameters.Positions[1],ZAxis' + s + 'MotionParameters.Position) ,[XIC(Status.State[46]) ,XIC(Status.State[103]) ] MOVE(HMI_ZAxis' + s + '.Parameters.Positions[2],ZAxis' + s + 'MotionParameters.Position) ,XIC(Status.State[22]) MOVE(HMI_ZAxis' + s + '.Parameters.Positions[3],ZAxis' + s + 'MotionParameters.Position)',
    mamGate: '[XIC(Work' + s + ') [XIC(Status.State[7]) ,XIC(Status.State[22]) ,XIC(Status.State[37]) ,XIC(Status.State[46]) ] ,XIC(Status.State[103]) ]',
    ranges: [['ZAxis' + s + 'Pick', 0, 10], ['ZAxis' + s + 'Place', 1, 10], ['ZAxis' + s + 'Retract', 2, 10], ['ZAxis' + s + 'CoilStart', 3, 10]],
  });
  const rotary = (s) => servoRoutine('RAxis' + s, {
    permissive: 'XIC(g_MachineBasic.AlwaysOn)', manual: ['Home'], moveType: 2,
    autoComment: 'Auto Mode - rotary shortest path back to home after the coil',
    auto: '[XIC(Status.State[49]) ,XIC(Status.State[109]) ] MOVE(HMI_RAxis' + s + '.Parameters.Positions[0],RAxis' + s + 'MotionParameters.Position)',
    mamGate: '[XIC(Work' + s + ') XIC(Status.State[49]) ,XIC(Status.State[109]) ]',
  });
  const R04 = servoRoutine('XAxis', {
    permissive: 'XIC(iq_ZAxisUpstream.AxisHomedStatus)XIC(iq_ZAxisDownstream.AxisHomedStatus)[XIO(Status.State[1]) ,XIC(ZAxisUpstreamRetract.InPos) XIC(ZAxisDownstreamRetract.InPos) ]', manual: ['Pick', 'Place'], moveType: 0,
    autoComment: 'Auto Mode - 0 pick, 1 place; pre-tension is an incremental move, the coil move runs at AutoSpeed[1]',
    auto: 'XIC(Status.State[19]) MOVE(1,XAxisMotionParameters.MoveType) MOVE(HMI_PretensionDistance,XAxisMotionParameters.Position) ,XIC(Status.State[31]) MOVE(HMI_XAxis.Parameters.AutoSpeed[1],XAxisMotionParameters.Speed) MOVE(HMI_XAxis.Parameters.Positions[1],XAxisMotionParameters.Position) ,[XIC(Status.State[52]) ,XIC(Status.State[112]) ] MOVE(HMI_XAxis.Parameters.Positions[0],XAxisMotionParameters.Position)',
    mamGate: '[XIC(Status.State[19]) ,XIC(Status.State[31]) ,XIC(Status.State[52]) ,XIC(Status.State[112]) ]',
    ranges: [['XAxisPick', 0, 5], ['XAxisPlace', 1, 5]],
  });

  // ── alarms ──
  const servoAl = SERVO_ORDER.flatMap((a, i) => {
    const A = 'iq_' + a, n = 2 * i;
    return [
      [AXES[a].label + ' Servo Drive Is Faulted', 'XIO(Lockout)NE(' + A + '.AxisFault,0)[OTE(ServoAlarm[' + n + '].Active) ,ONS(' + a + 'ONS.5) DTOS(' + A + '.AxisFault,' + a + 'Fault) CONCAT(g_StationList[StaNum],ServoAlarmList[' + n + '],' + a + 'FaultMessage) CONCAT(' + a + 'FaultMessage,' + a + 'Fault,ServoAlarm[' + n + '].Message) ];'],
      [AXES[a].label + ' Loss Of Absolute Position Reference', 'XIO(Lockout)XIC(g_MachineBasic.PowerUpCP)XIO(' + A + '.AxisHomedStatus)[OTE(ServoAlarm[' + (n + 1) + '].Active) ,ONS(' + a + 'ONS.6) CONCAT(g_StationList[StaNum],ServoAlarmList[' + (n + 1) + '],ServoAlarm[' + (n + 1) + '].Message) ];'],
    ];
  });
  const al = (i, states, ms) => {
    const inStates = states.length === 1 ? 'XIC(Status.State[' + states[0] + '])' : '[' + states.map((st) => 'XIC(Status.State[' + st + '])').join(' ,') + ' ]';
    return [alarms[i], '[' + inStates + ' MOVE(' + ms + ',Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(ONS.' + (16 + i) + ') CONCAT(g_StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];'];
  };
  const R20 = [
    ...servoAl,
    al(0, [7], 3000), al(1, [19], 3000), al(2, [22], 3000), al(3, [25, 106], 5000), al(4, [28], 3000), al(5, [31], 15000), al(6, [34], 3000), al(7, [37], 3000), al(8, [46, 103], 3000), al(9, [49, 109], 5000), al(10, [52, 112], 10000),
    [alarms[11], 'XIC(Status.State[100])[XIC(CoilStartedUpstream) ,XIC(CoilStartedDownstream) ][OTE(Alarm[11].Active) ,ONS(ONS.27) MOVE(1,Alarm[11].Severity) CONCAT(g_StationList[StaNum],AlarmList[11],Alarm[11].Message) ];'],
    ['Servo Alarm Handler', 'ProgramAlarmHandler(ServoFaultHandler,\\Alarms.p_ProgramID,ServoAlarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,ServoAlarmActive,ServoWarningActive);'],
    ['Station Alarm Handler', 'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,AlarmActive,WarningActive);'],
    ['Alarm/Warning Active Outputs', '[XIC(ServoAlarmActive) ,XIC(AlarmActive) ]OTE(q_AlarmActive);'],
    ['', '[XIC(ServoWarningActive) ,XIC(WarningActive) ]OTE(q_WarningActive);'],
  ];
  return programXml(PROG, tags, [
    { name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 },
    { name: 'R04_XAxisServo', rungs: R04 }, { name: 'R05_ZAxisUpstreamServo', rungs: zAxis('Upstream') }, { name: 'R06_ZAxisDownstreamServo', rungs: zAxis('Downstream') },
    { name: 'R07_RAxisUpstreamServo', rungs: rotary('Upstream') }, { name: 'R08_RAxisDownstreamServo', rungs: rotary('Downstream') }, { name: 'R20_Alarms', rungs: R20 }]);
}

// ═══ 1. IP addresses: every existing module onto the IP tab ═══════════════════
for (const [mod, old, last] of IP_MOVES) {
  const m = moduleXml(x, mod);
  must(countOf(m, 'Address="' + old + '"') === 1, mod + ' at ' + old);
  x = x.replace(m, m.replace('Address="' + old + '"', 'Address="' + SUBNET + last + '"'));
}
must(countOf(x, 'Address="10.1.60.') === 0, 'no 10.1.60.x address left');
log.push('IP addresses: ' + IP_MOVES.length + ' modules moved to ' + SUBNET + 'x');

// ═══ 2. program ══════════════════════════════════════════════════════════════
must(!programBody(x, PROG), 'program already present: ' + PROG);
const progXml = coilerProgram();
x = insertBefore(x, '</Programs>', progXml + '\n', '</Programs>');
fs.mkdirSync(PROGDIR, { recursive: true });
fs.writeFileSync(path.join(PROGDIR, PROG + '.xml'), progXml);
for (const p of ['L2_S01_TubeFeedUpstream', 'L2_S01_DereelerUpstream', 'L2_S01_TubeFeedDownstream', 'L2_S01_DereelerDownstream']) fs.writeFileSync(path.join(PROGDIR, p + '.xml'), programBody(x, p));
log.push('program ' + PROG + ': ' + rungList(progXml).length + ' rungs, ' + (progXml.match(/<Tag Name=/g) || []).length + ' tags');

// ═══ 3. modules + axes ═══════════════════════════════════════════════════════
const mods = [], axes = [], ctrlTags = [];
const sdTpl = moduleXml(x, 'sd02_L2S01FeedUpstream');            // Kinetix 5300, single phase (ConfigData[35] = 33619968)
must(/,33619968,/.test(sdTpl), 'sd02 is single phase');
const axTpl = tagXml(x, 'a02_L2S01FeedUpstream') || fail('a02');
const maxAxisId = Math.max(...[...x.matchAll(/AxisID="(\d+)"/g)].map((m) => +m[1]));
AX_ORDER.forEach((a, i) => {
  const C = AXES[a];
  mods.push(sdTpl.replace('Name="sd02_L2S01FeedUpstream"', 'Name="' + C.drive + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + C.ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'));
  let ax = axTpl.replace('<Tag Name="a02_L2S01FeedUpstream"', '<Tag Name="' + C.tag + '"').replace('MotionModule="sd02_L2S01FeedUpstream:Ch1"', 'MotionModule="' + C.drive + ':Ch1"');
  const setAttr = (k, val) => { must(new RegExp(' ' + k + '="[^"]*"').test(ax), 'axis attribute ' + k); ax = ax.replace(new RegExp(' ' + k + '="[^"]*"'), ' ' + k + '="' + val + '"'); };
  // scaling in the template forms: screw (V5.4 a03/a04: lead 10 -> ConversionConstant 10000, MotionResolution 10000, Limited);
  // rotary in degrees through a gearbox (chassis a01_Cam: 1000 counts/deg, MotionResolution 360000, unwind 360000, Cyclic)
  setAttr('AxisID', String(maxAxisId + 1 + i)); setAttr('MotorCatalogNumber', C.motor);
  const brake = tlpBrake(C.motor);
  if (brake) { setAttr('MechanicalBrakeEngageDelay', brake.engage.toFixed(2)); setAttr('MechanicalBrakeReleaseDelay', brake.release.toFixed(2)); }
  if (C.kind === 'linear') {
    setAttr('LoadType', 'Linear Actuator'); setAttr('ActuatorType', 'Screw'); setAttr('ActuatorLead', C.lead.toFixed(1)); setAttr('ActuatorDiameter', '1.0'); setAttr('TravelMode', 'Limited');
    setAttr('TransmissionRatioInput', '1'); setAttr('TransmissionRatioOutput', '1'); setAttr('PositionUnits', 'mm');
    setAttr('ConversionConstant', (C.lead * 1000).toFixed(1)); setAttr('MotionResolution', String(C.lead * 1000)); setAttr('PositionUnwind', '1000000');
  } else {
    setAttr('LoadType', 'Rotary Transmission'); setAttr('ActuatorType', '&lt;none>'); setAttr('ActuatorLead', '1.0'); setAttr('ActuatorDiameter', '1.0'); setAttr('TravelMode', 'Cyclic');
    setAttr('TransmissionRatioInput', String(C.gear)); setAttr('TransmissionRatioOutput', '1'); setAttr('PositionUnits', 'deg');
    setAttr('PositionScalingNumerator', '360.0'); setAttr('PositionUnwindNumerator', '360.0');
    setAttr('ConversionConstant', '1000.0'); setAttr('MotionResolution', '360000'); setAttr('PositionUnwind', '360000');
  }
  axes.push(ax);
});
{
  const ids = [...(x + axes.join('')).matchAll(/AxisID="(\d+)"/g)].map((m) => m[1]);
  must(new Set(ids).size === ids.length, 'duplicate AxisID: ' + ids.join(','));
}
// VB6: EX600-SEN7 generic ETHERNET-MODULE, cloned from vb01 (54 / 52) and resized
{
  const tpl = moduleXml(x, 'vb01_MainAssembly');
  let m = tpl.replace('Name="vb01_MainAssembly"', 'Name="' + VB + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + VB_IP + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"');
  m = m.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>/, '<Description>\n<![CDATA[EX600 with (2) 16 Point Digital Input Modules ]]>\n</Description>');
  m = rep1(m, 'PrimCxnInputSize="54"', 'PrimCxnInputSize="' + VB_IN + '"', 'vb06 input size');
  m = rep1(m, 'PrimCxnOutputSize="52"', 'PrimCxnOutputSize="' + VB_OUT + '"', 'vb06 output size');
  m = m.replace(/OutputSize="52" InputSize="54"/, 'OutputSize="' + VB_OUT + '" InputSize="' + VB_IN + '"');
  must(m.includes('OutputSize="' + VB_OUT + '" InputSize="' + VB_IN + '"'), 'vb06 connection sizes');
  m = m.split('AB:ETHERNET_MODULE_SINT_54Bytes:I:0').join('AB:ETHERNET_MODULE_SINT_' + VB_IN + 'Bytes:I:0').split('AB:ETHERNET_MODULE_SINT_52Bytes:O:0').join('AB:ETHERNET_MODULE_SINT_' + VB_OUT + 'Bytes:O:0');
  const resize = (block, n) => block
    .replace(/<Data Format="L5K">\s*<!\[CDATA\[\[\[[0-9,\s]*\]\]\]\]>\s*<\/Data>/, '<Data Format="L5K">\n<![CDATA[[[' + Array(n).fill('0').join(',') + ']]]]>\n</Data>')
    .replace(/<ArrayMember Name="Data" DataType="SINT" Dimensions="\d+" Radix="Decimal">[\s\S]*?<\/ArrayMember>/, '<ArrayMember Name="Data" DataType="SINT" Dimensions="' + n + '" Radix="Decimal">\n' + sintArrayDecorated(n) + '\n</ArrayMember>');
  m = m.replace(/<InputTag[\s\S]*?<\/InputTag>/, (s) => resize(s, VB_IN)).replace(/<OutputTag[\s\S]*?<\/OutputTag>/, (s) => resize(s, VB_OUT));
  must(countOf(m, 'Dimensions="' + VB_IN + '"') === 1 && countOf(m, 'Dimensions="' + VB_OUT + '"') === 1 && !/Dimensions="5[24]"/.test(m), 'vb06 data arrays resized');
  mods.push(m);
  ctrlTags.push(bufferTag(VB + '_IN', 'AB:ETHERNET_MODULE_SINT_' + VB_IN + 'Bytes:I:0', VB_IN), bufferTag(VB + '_OUT', 'AB:ETHERNET_MODULE_SINT_' + VB_OUT + 'Bytes:O:0', VB_OUT));
}
x = insertBefore(x, '</Modules>', mods.join('\n') + '\n', '</Modules>');
{
  const a03 = tagXml(x, 'a03_L2S01FeedDownstream') || fail('a03');
  x = x.replace(a03, a03 + '\n' + axes.join('\n'));
  const m = /<\/Tags>\s*<Programs>/.exec(x) || fail('controller tags end');
  x = x.slice(0, m.index) + ctrlTags.join('\n') + '\n' + x.slice(m.index);
}
log.push('modules: 5 Kinetix 5300 + VB6; axes a10-a14; buffers ' + VB + '_IN/_OUT');

// g_StationList[10]
{
  // rebuilt from the decorated elements (the L5K text wraps mid-string): set [10], regenerate L5K + Decorated
  const gl = tagXml(x, 'g_StationList') || fail('g_StationList');
  const names = [...gl.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[2] || '');
  must(names.length === 17 && names[10] === '' && names[1] === 'L2S01 Tube Load: ', 'g_StationList elements: ' + names.length);
  names[10] = PREFIX;
  const head = gl.slice(0, gl.indexOf('<Data Format="L5K">'));
  const dec = (i, s) => '<Element Index="[' + i + ']">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[' + (s ? "'" + s + "'" : '') + ']]>\n</DataValueMember>\n</Structure>\n</Element>';
  const neu = head + '<Data Format="L5K">\n<![CDATA[[' + names.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="17">\n' + names.map((s, i) => dec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  must(countOf(neu, PREFIX) === 2 && countOf(neu, 'S00 Indexer: ') === 2, 'g_StationList[10] in L5K and Decorated');
  x = replaceTagIn(x, 'g_StationList', neu);
}

// ═══ 4. services ═════════════════════════════════════════════════════════════
editRoutine('MapInputs', 'R01_Logic', (r) => { must(rungText(r[0]).endsWith('CPS(mm01_L2S01Micrometer:I,mm01_L2S01Micrometer_IN,1) ];'), 'MapInputs r0'); r[0] = setRungText(r[0], rungText(r[0]).replace(' ];', ' ,CPS(' + VB + ':I,' + VB + '_IN,1) ];')); return r; });
editRoutine('MapOutputs', 'R01_Logic', (r) => { must(rungText(r[0]).endsWith('CPS(mm01_L2S01Micrometer_OUT,mm01_L2S01Micrometer:O,1) ];'), 'MapOutputs r0'); r[0] = setRungText(r[0], rungText(r[0]).replace(' ];', ' ,CPS(' + VB + '_OUT,' + VB + ':O,1) ];')); return r; });
// indexer: the first station wired in
editRoutine('L2_S00_IndexerNoSP', 'R01_Inputs', (r) => {
  must(rungText(r[2]) === 'XIC(Status.State[4])TON(StationsCompleteDelay,?,?)XIC(StationsCompleteDelay.DN)ONS(ONS.6)OTE(StationsComplete);', 'indexer r2');
  must(rungText(r[3]) === 'XIC(g_MachineBasic.AlwaysOff)OTE(ActuatorsSafe);' && rungText(r[4]) === 'XIC(g_MachineBasic.AlwaysOff)OTE(Pause);', 'indexer r3 / r4');
  r[2] = setRungComment(setRungText(r[2], 'XIC(Status.State[4])TON(StationsCompleteDelay,?,?)XIC(StationsCompleteDelay.DN)XIC(\\' + PROG + '.q_StationComplete)ONS(ONS.6)OTE(StationsComplete);'), 'All Stations Complete');
  r[3] = setRungComment(setRungText(r[3], 'XIC(\\' + PROG + '.q_ActuatorsSafe)OTE(ActuatorsSafe);'), 'All Actuators Safe');
  r[4] = setRungComment(setRungText(r[4], 'XIC(\\' + PROG + '.q_Pause)MOVE(' + STA + ',PauseReason)OTE(Pause);'), 'Move The Indexer Into Pause');
  return r;
});
// Supervisor polls
editRoutine('Supervisor', 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (/^XIC\(\\L2_S00_IndexerNoSP\.q_AutoMode\).*OTE\(AllSMInAuto\);$/.test(t)) return setRungText(rg, t.replace('OTE(AllSMInAuto);', 'XIC(\\' + PROG + '.q_AutoMode)OTE(AllSMInAuto);'));
  if (/^XIC\(\\L2_S00_IndexerNoSP\.q_AutoStopped\).*OTE\(MachineStopped\);$/.test(t)) return setRungText(rg, t.replace('OTE(MachineStopped);', 'XIC(\\' + PROG + '.q_AutoStopped)OTE(MachineStopped);'));
  if (t.startsWith('XIC(\\L2_S00_IndexerNoSP.q_StartOK)')) return setRungText(rg, t.replace('XIC(\\L2_S01_DereelerDownstream.q_StartOK)[', 'XIC(\\L2_S01_DereelerDownstream.q_StartOK)XIC(\\' + PROG + '.q_StartOK)['));
  return rg;
}));
must(countOf(programBody(x, 'Supervisor'), '\\' + PROG + '.q_') === 3, 'Supervisor polls S10 three times');
// Supervisor EIP monitor: 15 nodes, six new loss-of-communication alarms at Alarm[10]-[15]
const eipNodes = AX_ORDER.map((a) => [AXES[a].drive + 'EIP', AXES[a].drive, AXES[a].eip]).concat([[VB + 'EIP', VB, 'Loss Of L2S10 Valve Bank EIP']]);
editRoutine('Supervisor', 'R15_EIPMonitor', (r) => r.map((rg) => rungText(rg) === 'GE(EIPStatusCount,9)MOVE(0,EIPStatusCount);' ? setRungText(rg, 'GE(EIPStatusCount,' + (9 + eipNodes.length) + ')MOVE(0,EIPStatusCount);') : rg));
must(/GE\(EIPStatusCount,15\)/.test(programBody(x, 'Supervisor')), 'EIP node count 15');
editRoutine('Supervisor', 'R20_Alarms', (r) => {
  must(rungText(r[8]).includes('EQ(EIPStatusCount,8) AOI_EIPStatus(mm01_L2S01MicrometerEIP'), 'Supervisor R20 r8 is the micrometer EIP rung');
  const add = eipNodes.map(([tag, mod, msg], i) => newRung(msg + ' Communications', '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,' + (9 + i) + ') AOI_EIPStatus(' + tag + ',' + mod + ') XIO(' + tag + '.ComOK) ,XIC(Alarm[' + (10 + i) + '].Active) XIO(q_FaultReset) ]OTE(Alarm[' + (10 + i) + '].Active);'));
  return [...r.slice(0, 9), ...add, ...r.slice(9)];
});
{
  let sup = programBody(x, 'Supervisor');
  const eipTpl = tagXml(sup, 'sd01_IndexerEIP') || fail('Supervisor sd01_IndexerEIP tag');
  sup = sup.replace(eipTpl, eipTpl + '\n' + eipNodes.map(([tag]) => eipTpl.replace('Name="sd01_IndexerEIP"', 'Name="' + tag + '"')).join('\n'));
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm tag');
  must(al.includes('Dimensions="15"'), 'Supervisor Alarm[15]');
  const N = 20;
  const msgs = Array(N).fill('');
  eipNodes.forEach(([, , msg], i) => { msgs[10 + i] = msg + ' Communications'; });
  // keep the existing messages 0-9, 7 = batch counter
  const l5kElems = [...al.matchAll(/\[0,0,0,0,\[\d+,'[^']*'\s*\],0,0,0,0\]/g)].map((m) => m[0]);
  must(l5kElems.length === 15, 'Supervisor Alarm L5K has 15 elements: ' + l5kElems.length);
  const oldDec = [...al.matchAll(/<Element Index="\[\d+\]">[\s\S]*?<\/Element>/g)].map((m) => m[0]);
  must(oldDec.length === 15, 'Supervisor Alarm decorated elements');
  const existing = oldDec.map((e) => (/<!\[CDATA\['([^']*)'\]\]>/.exec(e) || [, ''])[1]);
  for (let i = 0; i < 10; i++) msgs[i] = existing[i];
  const head = al.slice(0, al.indexOf('<Data Format="L5K">')).replace('Dimensions="15"', 'Dimensions="' + N + '"');
  al = head + '<Data Format="L5K">\n<![CDATA[[' + msgs.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + N + '">\n' + msgs.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
}
log.push('Supervisor: S10 polled, 6 EIP-loss alarms (10-15), Alarm[20], node count 15');
// Alarms roll-up
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t.endsWith('XIO(\\L2_S01_DereelerDownstream.q_AlarmActive)OTE(p_NoMachineFaults);')) return setRungText(rg, t.replace('OTE(p_NoMachineFaults);', 'XIO(\\' + PROG + '.q_AlarmActive)OTE(p_NoMachineFaults);'));
  if (t.endsWith('XIO(\\L2_S01_DereelerDownstream.q_WarningActive)OTE(p_NoMachineWarnings);')) return setRungText(rg, t.replace('OTE(p_NoMachineWarnings);', 'XIO(\\' + PROG + '.q_WarningActive)OTE(p_NoMachineWarnings);'));
  return rg;
}));
must(countOf(programBody(x, 'Alarms'), '\\' + PROG + '.q_') === 2, 'Alarms roll-up');
// schedule
x = insertAfter(x, '<ScheduledProgram Name="L2_S01_DereelerDownstream"/>', '\n<ScheduledProgram Name="' + PROG + '"/>', 'MainTask schedule');
// parameter connections
const pcs = [];
for (const a of ['XAxis', 'ZAxisUpstream', 'ZAxisDownstream', 'RAxisUpstream', 'RAxisDownstream']) pcs.push(['\\' + PROG + '.iq_' + a, AXES[a].tag]);
pcs.push([VB + '_IN.Data[0].0', '\\' + PROG + '.i_NestOpenerUpstreamRetracted'], [VB + '_IN.Data[0].1', '\\' + PROG + '.i_NestOpenerDownstreamRetracted']);
for (const s of SIDES) {
  pcs.push(['\\' + PROG + '.q_CloseSpikeGripper' + s, VB + '_OUT' + coilBit(VALVE['SpikeGripper' + s], 0)], ['\\' + PROG + '.q_OpenSpikeGripper' + s, VB + '_OUT' + coilBit(VALVE['SpikeGripper' + s], 1)]);
  pcs.push(['\\' + PROG + '.q_CloseCoilGripper' + s, VB + '_OUT' + coilBit(VALVE['CoilGripper' + s], 0)], ['\\' + PROG + '.q_OpenCoilGripper' + s, VB + '_OUT' + coilBit(VALVE['CoilGripper' + s], 1)]);
  pcs.push(['\\' + PROG + '.q_ExtendNestOpener' + s, VB + '_OUT' + coilBit(VALVE['NestOpener' + s], 0)], ['\\' + PROG + '.q_RetractNestOpener' + s, VB + '_OUT' + coilBit(VALVE['NestOpener' + s], 1)]);
}
x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
log.push('parameter connections: ' + pcs.length);

// ═══ 5. self-checks, write ═══════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
must(countOf(x, '<Program Name="' + PROG + '"') === 1 && countOf(x, '<ScheduledProgram Name="' + PROG + '"/>') === 1, 'program scheduled once');
must(countOf(x, '<Module Name="sd1') === 5 && countOf(x, '<Module Name="' + VB + '"') === 1, 'six modules added');
for (const a of AX_ORDER) must(countOf(x, '<Tag Name="' + AXES[a].tag + '"') === 1, AXES[a].tag);
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.mkdirSync(path.join(PROGDIR, '..', 'controller'), { recursive: true });
fs.writeFileSync(path.join(PROGDIR, '..', 'controller', 'Tasks.xml'), (/<Tasks>[\s\S]*?<\/Tasks>/.exec(x) || [''])[0]);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);

// ═══ 6. gates ════════════════════════════════════════════════════════════════
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', path.join(PROGDIR, PROG + '.xml')]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-12).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-3).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict)) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW/.test(l)).slice(0, 40).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');
// ═══ 7. cover note fragments + contract (computed before anything is delivered) ═══
const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8'), f = fs.readFileSync(frontF, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
if (!h.includes('<tr><td>0.7</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.7</td><td>' + SHORT + '</td><td>L2S10 (EJ) Blue Tube Coiler: one program <code>' + PROG + '</code> with five axes (a10&ndash;a14 on sd10&ndash;sd14), VB6, two nest openers, SCHUNK spike and 3-jaw coil grippers L / R; coil = MAPC position cams on the rotary and Z axes with the X axis as master. Every module moved to the Master Electrical IP tab (10.68.167.x). Indexer stations-complete, actuators-safe and pause rungs take S10. LightControl V5.4 rides in.</td><td>Jason, ' + SHORT + ': &ldquo;write the logic for 1163 L2S10 &hellip; S10 should only be 1 program. The x axis is shared &hellip; Q2 MAPC cam per slave &hellip; Q4 nest openers have retracted sensors. Defaults for remaining.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  h = rep1(h, 'answered Oct 30</td></tr>', 'answered Oct 30. EJ walkthrough Nov 3 (Jason, Vipin, Caleb, Tim), questions answered Nov 4</td></tr>', 'head row 1');
  h = rep1(h, 'WA, WB)</td></tr>', 'WA, WB). EJ: gantry screenshot, no balloons</td></tr>', 'head row 2');
  h = rep1(h, 'walkthrough and I/O list govern</td></tr>', 'walkthrough and I/O list govern. EJ rows 118&ndash;122 (budget-era: two rotary heads, head openers, push-off, load verify)</td></tr>', 'head row 3');
  h = rep1(h, 'PLC MOD 6 CH0/CH1)</td></tr>', 'PLC MOD 6 CH0/CH1). EJ: five 2198-C1004-ERS, TLP-A070-040-DJA32A (rotary, horizontal) and DJA34A brake (vertical); no sensors, nest opener or push-off</td></tr>', 'head row 4');
  h = rep1(h, 'VB1 unit sizes and order from Jason (Oct 30)</td></tr>', 'VB1 unit sizes and order from Jason (Oct 30). EJ rows 42&ndash;50: five motors, SCHUNK EJ1&ndash;EJ4; no valve or input assignments (&ldquo;VB6 waiting for final station designs&rdquo;)</td></tr>', 'head row 5');
  h = rep1(h, 'no circuit drawing</td></tr>', 'no circuit drawing. VB6 manifold layout (SY3000, 16 stations, EX600 2x DXPC), no station map</td></tr>', 'head row 6');
  h = rep1(h, '1117 HoseFeed / Dereeler as sequence reference only</td></tr>', '1117 HoseFeed / Dereeler as sequence reference only. S10: V5.4 S05_ServoPNP (servo form), chassis template Chassis (MCCP / MAPC cam form), 2UP S01 / S11 (per-side tracking); no example has five axes or a cam slaved to a PNP axis</td></tr>', 'head row 8');
  h = rep1(h, '<tr><td>9 Ethernet device list</td><td>partial</td><td>Module sizes set by Jason in Studio (0.3.2); CB-EP100 manual section 3-3 for the micrometer map; IPs still assumed</td></tr>', '<tr><td>9 Ethernet device list</td><td>yes</td><td>Master Electrical &ldquo;IP Addresses&rdquo; tab (Nov 3): every device IP on 10.68.167.x, device order = axis / drive numbers; VB6 sizes still assumed</td></tr>', 'head row 9');
  h = rep1(h, 'pick and place (not designed yet).</td></tr>', 'pick and place (not designed yet). <b>L2S10 (EJ)</b>, the blue tube coiler: a shared X gantry carrying two heads (Upstream = nest A = the IP tab&rsquo;s Left, Downstream = nest B = Right), each a Z axis, a rotary axis with a spike gripper and a 3-jaw coil gripper, plus a nest opener per side. The heads pick the tube by its spike, pre-tension, lift, and coil three turns onto the 3-jaw while the X axis carries them to place.</td></tr>', 'head platform');
  h = rep1(h, 'L2_S01_DereelerDownstream</b>, Production', 'L2_S01_DereelerDownstream, ' + PROG + '</b>, Production', 'head controller');
  h = rep1(h, '<b>sd02_L2S01FeedUpstream</b> 10.1.60.21, <b>sd03_L2S01FeedDownstream</b> .22', '<b>sd02_L2S01FeedUpstream</b> 10.68.167.21, <b>sd03_L2S01FeedDownstream</b> .22', 'head sd02');
  h = rep1(h, '(Upstream A/B .31/.32, Downstream A/B .33/.34)', '(Upstream A/B .50/.51, Downstream A/B .52/.53)', 'head fd');
  h = rep1(h, 'EX600-SEN7 .40', 'EX600-SEN7 .90', 'head vb01');
  h = rep1(h, 'CB-EP100 .50', 'CB-EP100 .80', 'head mm01');
  h = rep1(h, 'CH0 / CH1.</td></tr>', 'CH0 / CH1. <b>L2S10</b>: <code>a10_L2S10RotaryUpstream</code> / <code>a11_L2S10RotaryDownstream</code> on sd10 / sd11 (.29 / .30): TLP-A070-040-Dxxx2x, rotary transmission 10:1, degrees, cyclic 360; <code>a12_L2S10VerticalUpstream</code> / <code>a13_L2S10VerticalDownstream</code> on sd12 / sd13 (.31 / .32): TLP-A070-040-Dxxx4x (brake, DJA34A), screw 10 mm, mm, limited; <code>a14_L2S10Horizontal</code> on sd14 (.33): TLP-A070-040-Dxxx2x, screw 20 mm, mm, limited. All five 2198-C1004-ERS single phase. <b>vb06_MainAssembly</b> EX600-SEN7 .93 (generic SINT, in 10 / out 8 assumed, instances 100 / 150). Axis and drive numbers follow the IP tab order (a04&ndash;a09 reserved for L2S2 / L2S4).</td></tr>', 'head axes');
  h = rep1(h, 'StagingEmpty is a placeholder).</td></tr>', 'StagingEmpty is a placeholder). S10: 6 &ndash; sequence per the EJ walkthrough and Jason&rsquo;s Nov 4 answers; the cam form (MAPC per slave, X master, 2-point linear profile from coil diameter and pitch) has no SDC precedent on a PNP axis, VB6 sizes and bits, Z direction and the brake-motor database name are assumptions in the Asks.</td></tr>', 'head logic');
  h = h.replace('<tr><td class="k"><b>Modes</b></td><td>', '<tr><td class="k"><b>Modes</b></td><td>Coiler: wait for the index &rarr; working Z axes to pick &rarr; spike grippers close &rarr; 3-jaws open to the coil diameter &rarr; nests open &rarr; 10 mm pre-tension &rarr; Z to coil start &rarr; nests close &rarr; rotary and Z cams lock to X &rarr; X to place (coil) &rarr; cams release &rarr; Z to place &rarr; 3-jaws close (coil relaxes) &rarr; spike grippers open (Success) &rarr; Z retract &rarr; rotaries home &rarr; X to pick. A side with no part or locked out stays up; both heads ride the same X pass. ');
  must(h.includes('Coiler: wait for the index'), 'head modes');
}
if (h.includes('<tr><td>0.7.2</td>') && !h.includes('<tr><td>0.7.3</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.7.3</td><td>' + SHORT + '</td><td>Studio import fix: the indexer pause rung and the rotary Manual Mode rungs (R07 / R08 rung 13) wrapped a single leg in branch brackets, which Studio refuses along with every rung after it (28 errors). Brackets removed; the import simulation now counts legs outside operand lists. Same logic.</td><td>Jason, ' + SHORT + ': &ldquo;There were 28 errors when importing.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>0.7.3</td>'), 'head 0.7.3');
}
if (h.includes('<tr><td>0.7.1</td>') && !h.includes('<tr><td>0.7.2</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.7.2</td><td>' + SHORT + '</td><td>Axis and drive names follow the sides too: a10 / sd10 RotaryUpstream, a11 / sd11 RotaryDownstream, a12 / sd12 VerticalUpstream, a13 / sd13 VerticalDownstream (a14 / sd14 Horizontal unchanged); Supervisor EIP alarm text to match. Same logic.</td><td>Jason, ' + SHORT + ': &ldquo;Rename them too.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  for (const [a, bb] of [['L2S10RotaryLeft', 'L2S10RotaryUpstream'], ['L2S10RotaryRight', 'L2S10RotaryDownstream'], ['L2S10VerticalLeft', 'L2S10VerticalUpstream'], ['L2S10VerticalRight', 'L2S10VerticalDownstream']]) h = h.split(a).join(bb);
  must(h.includes('a10_L2S10RotaryUpstream') && !/L2S10(Rotary|Vertical)(Left|Right)/.test(h), 'head 0.7.2');
}
if (!h.includes('<tr><td>0.7.1</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.7.1</td><td>' + SHORT + '</td><td>L2S10 sides renamed Upstream (nest A, IP-tab Left) / Downstream (nest B, Right) in every program tag, routine, HMI tag and alarm; axis and drive names keep the IP tab&rsquo;s Left / Right. Same logic.</td><td>Jason, ' + SHORT + ': &ldquo;I want left / right defined as upstream / downstream in the program, like was done with S01.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  h = rep1(h, '(Left = nest A = Upstream, Right = nest B)', '(Upstream = nest A = the IP tab&rsquo;s Left, Downstream = nest B = Right)', 'head 0.7.1 sides');
  must(h.includes('<tr><td>0.7.1</td>'), 'head 0.7.1 row');
}
if (!b.includes('vb06_MainAssembly')) {
  b = rep1(b, 'Alarms rolls up Supervisor, the indexer and the four L2S01 programs (faults and warnings). ', 'Alarms rolls up Supervisor, the indexer, the four L2S01 programs and ' + PROG + ' (faults and warnings); <code>g_StationList[10]</code> = &ldquo;' + PREFIX + '&rdquo;. ', 'back alarms');
  b = rep1(b, 'CPS of vb01_MainAssembly, mm01_L2S01Micrometer and the four ', 'CPS of vb01_MainAssembly, vb06_MainAssembly, mm01_L2S01Micrometer and the four ', 'back map');
  b = rep1(b, '65 parameter connections', '84 parameter connections', 'back pcs');
  b = rep1(b, 'Polls five state machines; EIP monitor counts 9 nodes; Alarm', 'Polls six state machines; EIP monitor counts 15 nodes; Alarm[10]&ndash;[15] are the S10 loss-of-communication alarms (five drives, VB6), the array grown to 20; Alarm', 'back supervisor');
  b = rep1(b, '<tr><td>3</td><td>IP addresses assumed: sd02 .21, sd03 .22, fd01&ndash;fd04 .31&ndash;.34, vb01 .40, mm01 .50 on 10.1.60.x.</td>', '<tr><td>3</td><td>Closed: every module now carries the Master Electrical IP tab address (10.68.167.x; payouts .50&ndash;.53, VB1 .90, micrometer .80) (0.7).</td>', 'back ask 3');
  const asks = [
    ['20', 'Vertical axes a12 / a13: the brake motor TLP-A070-040-DJA34A is written by database name <code>TLP-A070-040-Dxxx4x</code> (no example carries it) &ndash; re-select the motor in Studio so its ratings and brake data load; a10 / a11 / a14 carry Dxxx2x like the feed axes.', 'Jason'],
    ['21', 'VB6: in 10 / out 8 bytes assumed from the EX600 unit list (2x DXPC, AXA, DMPF / DYPE, DMPF, 16 stations x 2 coils); set the real sizes in Studio. Valve stations 1&ndash;6 = EJ1 spike L, EJ2 spike R, EJ3 3-jaw L, EJ4 3-jaw R, nest opener L, nest opener R (A coil = close / extend at bit 2n-2 of byte 3); nest-opener retracted sensors on DXPC1 bits 0.0 / 0.1.', 'Jason'],
    ['22', 'Scaling from the walkthrough: X screw 20 mm/rev, Z screw 10 mm/rev, rotary 10:1 in degrees (cyclic 360); Studio recomputes the conversion constants from these on import &ndash; confirm the leads and gearbox on the EJ drawings.', 'Vipin / Jason'],
    ['23', 'Coil cams: 2-point linear MAPC profiles built in ladder each cycle &ndash; rotary 360&deg; and Z one <code>HMI_CoilPitch</code> (4.2 mm, signed, assumes Z positive = up) per &pi; x <code>HMI_CoilDiameter</code> (75 mm) of X travel from coil start (pick + 10 mm pre-tension) to place; X command position is the master (chassis form), executed Once, released with MAS Position Cam. 725.5 mm of travel = 3.04 turns. Confirm the Z sign and that Once + Bi-Directional runs the profile as X moves toward place.', 'Jason / Caleb'],
    ['24', 'Not built: push-off / stripper (not designed) and the load-verify sensor (none in the BOM) &ndash; Success is latched when the spike gripper opens at place; a tube released by a restart fails its nest with code 101.', 'Jason / Caleb'],
    ['25', 'Positions seeded: X pick 765.5, place 50.0 (from the homing block); Z pick / place / retract / coil start and rotary home 0 are HMI setpoints the CE sets, as are every speed (AutoSpeed[1] on X is the coil speed). X and Z torque-home negative (block / up), rotaries home immediate.', 'Jason'],
    ['26', 'Carried from Nov 4 readiness: one X pass coils both nests when both carry a part (yes), lockout / dry run per side and single step from either side (yes), rotary coils positive and returns by shortest path (yes), 3-jaw closes to relax the coil before the spike gripper opens (Caleb).', '&ndash;'],
  ].map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n');
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks + '\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>26</td>'), 'back asks');
  b = rep1(b, '<code>_1146_AlconNewRegisters.L5X</code> (fd01_FFConv)', '<code>_1146_AlconNewRegisters.L5X</code> (fd01_FFConv), <code>AI Inputs\\L2S10\\</code>: <code>1163_ EJ Walkthrough.docx</code>, <code>EJ Screenshot.png</code>, <code>VB6.pdf</code>, Master Electrical IP tab; <code>ChassisStandard_2UP</code> Chassis program (cam form)', 'back referenced');
}
if (!f.includes('Coiler')) {
  f = rep1(f, '<tr><td class="k">Index</td><td>', '<tr><td class="k">Coiler</td><td><b>L2S10</b> waits at pick for the index. For each nest side with a good part (tracking) the head picks the tube by its spike, opens the 3-jaw to the coil diameter, opens the nest, pre-tensions 10 mm, lifts to coil start, closes the nest, locks its rotary and Z to the X axis and rides X to place while coiling three turns; at place the 3-jaw closes to relax the coil, the spike gripper opens (Success), Z retracts, the rotary homes and X returns to pick. Both heads share the one X pass.</td></tr>\n<tr><td class="k">Index</td><td>', 'front coiler');
  f = f.replace('L2S01 has no nest and does not gate the index.', 'L2S01 has no nest and does not gate the index; L2S10 is the first station wired into the stations-complete, actuators-safe (both Z retracted, nests closed) and pause rungs.');
  must(f.includes('L2S10 is the first station'), 'front index');
}
if (meta[PROG] && /nest A \(Left\)/.test(meta[PROG].notes)) {
  for (const k of ['does', 'devices', 'notes']) meta[PROG][k] = meta[PROG][k].replace(/\bLeft\b/g, 'Upstream').replace(/\bRight\b/g, 'Downstream');
  meta[PROG].does = meta[PROG].does.replace('the Upstream head works nest A and the Downstream head nest B', 'the Upstream head (IP-tab Left) works nest A and the Downstream head (Right) nest B');
  must(/IP-tab Left/.test(meta[PROG].does), 'meta 0.7.1 sides');
}
if (!meta[PROG]) {
  meta[PROG] = {
    title: 'L2S10 &ndash; Blue tube coiler, two heads on a shared X axis',
    does: 'Picks the blue tube from each nest by its spike, forms three turns of coil around the 3-jaw gripper while the X axis carries the head to place, and lays the coil down. One program: the X axis is shared, the Upstream head works nest A and the Downstream head nest B; a side with no part or locked out stays retracted and the other coils alone.',
    devices: 'X Axis &ndash; TLP-A070-040-DJA32A on 2198-C1004-ERS (sd14), 20 mm screw, shared gantry &middot; Z Axis Upstream / Downstream &ndash; TLP-A070-040-DJA34A brake motor on sd12 / sd13, 10 mm screw &middot; R Axis Upstream / Downstream (rotary coiling head) &ndash; TLP-A070-040-DJA32A on sd10 / sd11, 10:1 gearbox, degrees &middot; Spike Gripper Upstream / Downstream &ndash; SCHUNK 0305521 parallel gripper, valves EJ1 / EJ2, two solenoids, delay-confirmed &middot; Coil Gripper Upstream / Downstream &ndash; SCHUNK 0340530 3-jaw, valves EJ3 / EJ4, open = jaws at the coil diameter, close = coil released &middot; Nest Opener Upstream / Downstream &ndash; VB6 stations 5 / 6, retracted sensor, extended by delay',
    notes: 'StaNum 10, StaNumPre 9; nest A (Upstream) and nest B (Downstream) tracked per side: CycleStationA/BUpstream and Downstream, lockout / dry run per side (LockoutA / B, DryRunA / B), single step or single cycle from either side steps both heads. Attempt at state 7, Success at 43 (spike gripper opened at place), Lockout on a locked-out side at the index, Failure 101 on a tube released by a restart (CoilStartedUpstream / Downstream). Coil cams: at state 28 the profile is computed from HMI_CoilDiameter (75 mm) and HMI_CoilPitch (4.2 mm) over the X travel from CoilStartPosition (pick + HMI_PretensionDistance 10 mm) to place and loaded with MCCP; each working rotary and Z axis is locked to the X command position with MAPC (Once, Immediate, Bi-Directional), the X move to place runs at AutoSpeed[1], MAS Position Cam releases them at 34. Initialization releases the grippers (3-jaw close, spike open), retracts both Z, closes the nests, homes the rotaries and returns X to pick. q_ActuatorsSafe = both Z at retract and homed, both nests closed. Fault times 3 s per move, 5 s nest close / rotary home, 10 s X return, 15 s coil move; gripper states have no alarm (coils and a delay only).',
    extra: { Form: 'S05_ServoPNP servo form per axis (R04&ndash;R08) + S03 pneumatics for grippers and nest openers + 2UP S01 / S11 per-side tracking; chassis Chassis program for MCCP / MAPC', Logic: '6 &ndash; sequence per the EJ walkthrough and the Nov 4 answers; cam form, VB6 map, Z sign and scaling are assumptions', Referenced: 'NAMES_CONTRACT_L2S01_EA.md (L2S10 section), L2S10_EJ_readiness_2026-11-04.md', Ask: '20, 21, 22, 23, 24, 25' },
  };
  meta.Supervisor.does = meta.Supervisor.does.replace('nine EIP nodes monitored (indexer drive, two feed drives, four payout VFDs, valve bank, micrometer)', 'fifteen EIP nodes monitored (indexer drive, two feed drives, four payout VFDs, VB1, micrometer, five S10 drives, VB6)');
  meta.Supervisor.extra.Logic = '9';
  meta.L2_S00_IndexerNoSP.does = meta.L2_S00_IndexerNoSP.does.replace('L2S01 is a feeder with no nest, so the stations-complete, actuators-safe and pause rungs are still the template placeholders.', 'L2S01 is a feeder with no nest; L2S10 is the first station in the stations-complete, actuators-safe and pause rungs.');
  meta.L2_S00_IndexerNoSP.notes = 'R01 rungs 2&ndash;4 read ' + PROG + ' q_StationComplete, q_ActuatorsSafe and q_Pause (pause reason 10).';
  must(/fifteen EIP/.test(meta.Supervisor.does) && /L2S10 is the first/.test(meta.L2_S00_IndexerNoSP.does), 'meta edits');
}
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (/L2S10(Rotary|Vertical)(Left|Right)/.test(c)) {
  for (const [a, bb] of [['L2S10RotaryLeft', 'L2S10RotaryUpstream'], ['L2S10RotaryRight', 'L2S10RotaryDownstream'], ['L2S10VerticalLeft', 'L2S10VerticalUpstream'], ['L2S10VerticalRight', 'L2S10VerticalDownstream']]) c = c.split(a).join(bb);
  c = c.replace('a11 / sd11 RotaryRight .30 · a12 / sd12 VerticalLeft .31 · a13 / sd13 VerticalRight .32', 'a11 / sd11 RotaryDownstream .30 · a12 / sd12 VerticalUpstream .31 · a13 / sd13 VerticalDownstream .32').replace('; axis and drive names keep the IP-tab Left / Right', '; axis and drive names follow the sides (0.7.2)');
  must(c.includes('RotaryDownstream .30') && !/L2S10(Rotary|Vertical)(Left|Right)/.test(c), 'contract 0.7.2');
}
if (c.includes('Left = nest A = Upstream, Right = nest B')) {
  c = c.replace('Left = nest A = Upstream, Right = nest B', 'Upstream = nest A = IP-tab Left, Downstream = nest B = Right, D013 form').replace('program tags XAxis, ZAxisLeft / Right, RAxisLeft / Right (routines R04-R08)', 'program tags XAxis, ZAxisUpstream / Downstream, RAxisUpstream / Downstream (routines R04-R08); axis and drive names keep the IP-tab Left / Right');
  must(c.includes('ZAxisUpstream / Downstream'), 'contract 0.7.1');
}
if (!c.includes('## L2S10 (EJ)')) {
  c = c.trimEnd() + '\n\n## L2S10 (EJ) Blue Tube Coiler (0.7, Jason 2026-11-04)\n| Item | Name |\n|---|---|\n| Program | `' + PROG + '` (one program: X shared, Z / rotary per nest side; Upstream = nest A = IP-tab Left, Downstream = nest B = Right, D013 form) |\n| StaNum | 10, StaNumPre 9; reads Station[10].NestNumA / NestNumB, OpStatus A / B bits; FailureType 101 coil interrupted |\n| Axes (IP-tab order) | `a10_L2S10RotaryUpstream` / `sd10_L2S10RotaryUpstream` 10.68.167.29 · a11 / sd11 RotaryRight .30 · a12 / sd12 VerticalLeft .31 · a13 / sd13 VerticalRight .32 · a14 / sd14 Horizontal .33 (2198-C1004-ERS single phase; TLP-A070-040-Dxxx2x, Dxxx4x brake on Z); program tags XAxis, ZAxisUpstream / Downstream, RAxisUpstream / Downstream (routines R04-R08) |\n| Scaling | X screw 20 mm, Z screw 10 mm (limited); rotary 10:1 transmission, deg, cyclic 360 |\n| Valve bank | `vb06_MainAssembly` .93 (EX600-SEN7, generic SINT, in 10 / out 8 assumed, instances 100 / 150); coils from byte 3: station n A = bit 2n-2, B = 2n-1 |\n| Valve stations | 1 EJ1 spike gripper L (close 3.0 / open 3.1) · 2 EJ2 spike R (3.2 / 3.3) · 3 EJ3 3-jaw coil L (close 3.4 / open 3.5) · 4 EJ4 coil R (3.6 / 3.7) · 5 nest opener L (extend 4.0 / retract 4.1) · 6 nest opener R (4.2 / 4.3) |\n| Inputs | nest opener L / R retracted = in 0.0 / 0.1 (DXPC1) |\n| HMI setpoints | HMI_CoilDiameter 75.0, HMI_CoilPitch 4.2 (signed, Z per turn), HMI_PretensionDistance 10.0; X Positions[0] pick 765.5, [1] place 50.0; Z Positions 0 pick, 1 place, 2 retract, 3 coil start; R Positions[0] home |\n| Cams | RotaryCam / ZCam (CAM[2]) -> RotaryCamProfile / ZCamProfile (CAM_PROFILE[2]) via MCCP at state 28; MAPC per working slave, master iq_XAxis Command, Once, Immediate, Bi-Directional; MAS Position Cam at 34 |\n| To the indexer | q_StationComplete, q_ActuatorsSafe (both Z retracted + homed, nests closed), q_Pause (AlwaysOff) - first station wired into R01 rungs 2-4 |\n| Supervisor | EIP nodes 9-14 = sd10-sd14, vb06; Alarm[10]-[15]; node count 15 |\n\nIP tab (2026-11-04): sd01 .20, sd02 .21, sd03 .22, fd01-fd04 .50-.53, vb01 .90, mm01 .80 on 10.68.167.x. Reserved by order: a04 / a05 L2S2, a06-a09 L2S4, a15 L2S11, a16-a20 L2S14.\n';
}
const exF = B + '/plan/station-examples.json';
const ex = JSON.parse(fs.readFileSync(exF, 'utf8'));
ex[PROG] = ex[PROG] || { example: 'SoftwareStandardization V5.4 S05_ServoPNP (servo form per axis) + S03_PartLoad (pneumatic derived states, R20 alarm form) + 2UP S01_PartLoadA/B, S11_RejectUnloadA (per-side tracking) + ChassisStandard_2UP Chassis program (MCCP / MAPC cam form)', reference: 'EJ walkthrough 2026-11-03 (sequence), chassis dial cam (MAPC)' };
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
cfg.programs = '^(L2_S0[01]_|L2_S10_|Supervisor$)'; cfg.shapeLintPrograms = '^L2_S(01|10)_'; cfg.title = '1163 Haemonetics - L2 Indexer, L2S01 (EA) Tube Load, L2S10 (EJ) Blue Tube Coiler';

if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 8. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);
fs.writeFileSync(headF, h); fs.writeFileSync(backF, b); fs.writeFileSync(frontF, f); fs.writeFileSync(metaF, JSON.stringify(meta, null, 2));
fs.writeFileSync(cf, c); fs.writeFileSync(exF, JSON.stringify(ex, null, 2) + '\n'); fs.writeFileSync(cfgF, JSON.stringify(cfg, null, 2) + '\n');
console.log('fragments, contract, station examples, intake updated');

// ═══ 9. cover note ═══════════════════════════════════════════════════════════
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

