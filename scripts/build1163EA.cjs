#!/usr/bin/env node
'use strict';
/**
 * build1163EA.cjs — job 1163 Haemonetics, L2S01 (EA) Long Clear Tube Load, added to Jason's 2026-10-29 export.
 *
 *   node scripts/build1163EA.cjs [--src <1163 L5X>] [--v53 <V5.3 L5X>] [--ex1146 <1146 L5X>] [--out <L5X>] [--progdir <dir>]
 *
 *   Programs (D013: Upstream = I/O-list LH, Downstream = RH):
 *     L2_S01_TubeFeedUpstream / Downstream  - feed servo (S05/S10 R04 form), cutter, selector, inserter, two grippers,
 *                                             payout-confirm encoder (1756-HSC), X/Y micrometers, staging handoff.
 *     L2_S01_DereelerUpstream / Downstream  - payout A/B on PowerFlex 525 (1146 fd01_FFConv form), dancer A/B (IO-Link).
 *   Hardware: sd02/sd03 2198-C1004-ERS + axes a02/a03 (TLP-A070-040, 1117 scaling), fd01..fd04 PowerFlex 525,
 *             vb01_MainAssembly EX600 (generic SINT 32/8), mm01_L2S01Micrometer LS-9501 (generic SINT 32/4).
 *   Services: MapInputs/MapOutputs CPS + unpack rungs, Supervisor polls + 8 EIP-loss alarms, Alarms roll-up,
 *             MainTask schedule, g_StationList[1], ParameterConnections.
 *   Twins are built by the same generator with side = 'Upstream' | 'Downstream'.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'C:/1163 AI Code/AI Inputs/_1163_Haemonetics.L5X');
const V53 = flag('v53', 'X:/Electrical Dept/SDC Engineer/Deliveries/SoftwareStandardization V5.3/SoftwareStandardization.L5X');
const EX1146 = flag('ex1146', 'C:/1163 AI Code/AI Inputs/_1146_AlconNewRegisters.L5X');
const OUT = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X');
const PROGDIR = flag('progdir', path.join(__dirname, '..', 'generated', '1163', 'build', 'programs'));
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const log = [];
let x = fs.readFileSync(SRC, 'utf8');
const v = fs.readFileSync(V53, 'utf8');
const e = fs.readFileSync(EX1146, 'utf8');

// ── helpers (build2UPIndexer / build1163 / buildV53 forms) ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, p, q) => p + t + q);
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
const guid = () => '{' + crypto.randomUUID().toUpperCase() + '}';
const moduleXml = (src, name) => (new RegExp('<Module Name="' + name + '"[\\s\\S]*?</Module>').exec(src) || [null])[0] || fail('module not found: ' + name);

// ── tag builders ──
const l5kStr = (s, n) => '[' + s.length + ",'" + s + '$00'.repeat(n - s.length) + "']";
const descXml = (d) => d ? '<Description>\n<![CDATA[' + d + ']]>\n</Description>\n' : '';
const openTag = (name, type, extra) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n';
function scalarTag(name, type, radix, value, { usage, desc } = {}) {
  const dec = type === 'REAL' ? Number(value).toFixed(1).replace(/\.0$/, '.0') : String(value);
  const l5k = type === 'REAL' ? Number(value).toExponential(8).replace(/e([+-])(\d)$/, 'e$10$2').replace('e', 'e') : String(value);
  return openTag(name, type, ' Radix="' + radix + '"' + (usage ? ' Usage="' + usage + '"' : '')) + descXml(desc) +
    '<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + dec + '"/>\n</Data>\n</Tag>';
}
const boolTag = (name, o) => scalarTag(name, 'BOOL', 'Decimal', 0, o);
const dintTag = (name, value, o) => scalarTag(name, 'DINT', 'Decimal', value, o);
const intTag = (name, value, o) => scalarTag(name, 'INT', 'Decimal', value, o);
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
function alarmArrayTag(name, prefix, messages, dims) {
  const vals = Array.from({ length: dims }, (_, i) => messages[i] ? prefix + messages[i] : '');
  const l5k = vals.map((s) => '[0,0,0,0,' + l5kStr(s, 100) + ',0,0,0,0]').join(',');
  const dec = (i, s) => '<Element Index="[' + i + ']">\n<Structure DataType="AlarmData">\n' +
    ['ProgramID', 'AlarmID', 'Severity', 'Group'].map((m) => '<DataValueMember Name="' + m + '" DataType="INT" Radix="Decimal" Value="0"/>').join('\n') +
    '\n<StructureMember Name="Message" DataType="STRING100">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII">\n<![CDATA[' + (s ? "'" + s + "'" : '') + ']]>\n</DataValueMember>\n</StructureMember>\n' +
    '<DataValueMember Name="TimeStamp" DataType="LINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Duration" DataType="DINT" Radix="Decimal" Value="0"/>\n' +
    '<DataValueMember Name="Active" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DoNotSaveToHistory" DataType="BOOL" Value="0"/>\n<DataValueMember Name="HMI_ResetCount" DataType="BOOL" Value="0"/>\n</Structure>\n</Element>';
  return openTag(name, 'AlarmData', ' Dimensions="' + dims + '"') + '<Data Format="L5K">\n<![CDATA[[' + l5k + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + dims + '">\n' + vals.map((s, i) => dec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function dintCommentTag(name, comments) {
  const cm = comments.length ? '<Comments>\n' + comments.map(([bit, c]) => '<Comment Operand=".' + bit + '">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n' : '';
  return openTag(name, 'DINT', ' Radix="Decimal"') + cm + '<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="DINT" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>';
}
function sintArrayDecorated(n) { return Array.from({ length: n }, (_, i) => '<Element Index="[' + i + ']" Value="0"/>').join('\n'); }
function bufferTag(name, type, nBytes) {
  return '<Tag Name="' + name + '" Class="Standard" TagType="Base" DataType="' + type + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[[' + Array(nBytes).fill('0').join(',') + ']]]]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="' + type + '">\n<ArrayMember Name="Data" DataType="SINT" Dimensions="' + nBytes + '" Radix="Decimal">\n' + sintArrayDecorated(nBytes) + '\n</ArrayMember>\n</Structure>\n</Data>\n</Tag>';
}
function numArrayCtrlTag(name, type, n) {
  return '<Tag Name="' + name + '" Class="Standard" TagType="Base" DataType="' + type + '" Dimensions="' + n + '" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[' + Array(n).fill('0').join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="' + type + '" Dimensions="' + n + '" Radix="Decimal">\n' + sintArrayDecorated(n) + '\n</Array>\n</Data>\n</Tag>';
}
// copy a tag from an example program body under a new name (and description)
function copyTag(body, srcName, newName, desc) {
  let t = tagXml(body, srcName) || fail('example tag not found: ' + srcName);
  t = t.replace('<Tag Name="' + srcName + '"', '<Tag Name="' + newName + '"');
  if (desc !== undefined) {
    t = /<Description>/.test(t) ? t.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>\n?/, desc ? descXml(desc) : '') : t.replace(/(<Tag [^>]*>\n)/, '$1' + descXml(desc));
  }
  return t;
}
// StateLogicStatus tag with this station's state comments (current-engine data copied from the indexer program)
const L2S00 = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00_IndexerNoSP not in the source file');
function statusTag(states) {
  let t = tagXml(L2S00, 'Status') || fail('L2_S00 Status tag');
  const cm = '<Comments>\n' + Object.entries(states).map(([n, c]) => '<Comment Operand=".STATE[' + n + ']">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n';
  t = /<Comments>/.test(t) ? t.replace(/<Comments>[\s\S]*?<\/Comments>\n?/, cm) : t.replace(/(<Tag [^>]*>\n)/, '$1' + cm);
  return t;
}
const S05 = programBody(v, 'S05_ServoPNP') || fail('V5.3 S05_ServoPNP');
const S03 = programBody(v, 'S03_PartLoad') || fail('V5.3 S03_PartLoad');
const S10 = programBody(v, 'S10_FlexFeedConveyor') || fail('V5.3 S10_FlexFeedConveyor');
const SUP = programBody(x, 'Supervisor') || fail('Supervisor');

function programXml(name, tags, routines) {
  const sorted = tags.slice().sort((a, b) => { const na = /<Tag Name="([^"]+)"/.exec(a)[1].toLowerCase(), nb = /<Tag Name="([^"]+)"/.exec(b)[1].toLowerCase(); return na < nb ? -1 : na > nb ? 1 : 0; });
  const rts = routines.map((r) => '<Routine Name="' + r.name + '" Type="RLL">\n<RLLContent>\n' + renumber(r.rungs.map(([c, t]) => newRung(c, t)).join('\n')) + '\n</RLLContent>\n</Routine>').join('\n');
  return '<Program Name="' + name + '" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">\n<Tags>\n' + sorted.join('\n') + '\n</Tags>\n<Routines>\n' + rts + '\n</Routines>\n</Program>';
}

// ═══ station configuration ════════════════════════════════════════════════
const SIDES = {
  Upstream: { ioWord: 'LH', hsc: 0, axis: 'a02_L2S01FeedUpstream', drive: 'sd02_L2S01FeedUpstream', driveIp: '10.1.60.21', fdA: 'fd01_L2S01PayoutUpstreamA', fdB: 'fd02_L2S01PayoutUpstreamB', fdAIp: '10.1.60.31', fdBIp: '10.1.60.32', dancerA: 0, dancerB: 1, micX: 0, micY: 1,
    out: { cutterExt: [0, 0], cutterRet: [0, 1], selExt: [0, 4], selRet: [0, 5], insExt: [1, 0], insRet: [1, 1], gripAClose: [1, 4], gripAOpen: [1, 5], gripBClose: [1, 6], gripBOpen: [1, 7] },
    in: { cutterExt: [25, 0], cutterRet: [25, 1], tubeALoaded: [25, 2], tubeBLoaded: [25, 3], selExt: [25, 4], selRet: [25, 5], insRet: [25, 6], tubeAInDrive: [25, 7], tubeBInDrive: [26, 0] } },
  Downstream: { ioWord: 'RH', hsc: 1, axis: 'a03_L2S01FeedDownstream', drive: 'sd03_L2S01FeedDownstream', driveIp: '10.1.60.22', fdA: 'fd03_L2S01PayoutDownstreamA', fdB: 'fd04_L2S01PayoutDownstreamB', fdAIp: '10.1.60.33', fdBIp: '10.1.60.34', dancerA: 2, dancerB: 3, micX: 2, micY: 3,
    out: { cutterExt: [0, 2], cutterRet: [0, 3], selExt: [0, 6], selRet: [0, 7], insExt: [1, 2], insRet: [1, 3], gripAClose: [2, 0], gripAOpen: [2, 1], gripBClose: [2, 2], gripBOpen: [2, 3] },
    in: { cutterExt: [26, 1], cutterRet: [26, 2], tubeALoaded: [26, 3], tubeBLoaded: [26, 4], selExt: [26, 5], selRet: [26, 6], insRet: [26, 7], tubeAInDrive: [27, 0], tubeBInDrive: [27, 1] } },
};
const VB = 'vb01_MainAssembly', MM = 'mm01_L2S01Micrometer';
const PREFIX = 'L2S01 Tube Load: ';
const feedName = (s) => 'L2_S01_TubeFeed' + s, dereelerName = (s) => 'L2_S01_Dereeler' + s;

// ═══ TubeFeed program ═════════════════════════════════════════════════════
function feedProgram(side) {
  const C = SIDES[side], DR = '\\' + dereelerName(side);
  const H = 'HMI_FeedAxis', A = 'iq_FeedAxis', FA = 'FeedAxis';
  const alarms = [
    'Waiting For Operator To Load A Tube', 'Waiting For Cutter To Extend', 'Waiting For Cutter To Retract', 'Cutter Sensors/Outputs Misconfigured',
    'Waiting For Selector To Extend', 'Waiting For Selector To Retract', 'Selector Sensors/Outputs Misconfigured', 'Waiting For Inserter To Retract',
    'Waiting For Tube To Enter The Drive', 'Waiting For Encoder Reset', 'Waiting For Feed To Complete', 'Waiting For Correction Move',
    'Waiting For Tube To Back Out', 'Waiting For Prime Feed', 'Waiting For Drive To Stop', 'Tube Length Out Of Tolerance',
    'Tube Diameter Out Of Tolerance', 'Tube Ovality Out Of Tolerance', 'Waiting For Staging To Empty'];
  const servoAlarms = ['Feed Axis Servo Drive Is Faulted'];
  const states = {
    0: 'Safety Stop', 1: 'Manual Mode', 2: 'Auto Mode Idle Not Ready', 3: 'Auto Mode Idle Ready',
    4: 'Wait For Staging Empty', 7: 'Reset Encoder', 10: 'Feed Tube', 13: 'Check Fed Length', 16: 'Correction Move', 19: 'Extend Cutter', 22: 'Retract Cutter', 25: 'Tube Complete',
    40: 'Back Tube Out Of The Drive', 43: 'Retract Inserter', 46: 'Select Loaded Tube', 49: 'Insert Tube Into The Drive', 52: 'Stop Drive Open Gripper', 55: 'Prime Feed',
    99: 'Lockout', 100: 'Initialization Retract Cutter', 124: 'Initialization Complete', 127: 'Fault' };
  const tags = [
    // parameters: inputs
    boolTag('i_CutterExtended', { usage: 'Input', desc: 'Cutter Extended' }), boolTag('i_CutterRetracted', { usage: 'Input', desc: 'Cutter Retracted' }),
    boolTag('i_SelectorExtended', { usage: 'Input', desc: 'Selector At Tube B' }), boolTag('i_SelectorRetracted', { usage: 'Input', desc: 'Selector At Tube A' }),
    boolTag('i_InserterRetracted', { usage: 'Input', desc: 'Inserter Retracted' }),
    boolTag('i_TubeAInDrive', { usage: 'Input', desc: 'Tube A Air Spring Made' }), boolTag('i_TubeBInDrive', { usage: 'Input', desc: 'Tube B Air Spring Made' }),
    boolTag('i_TubeALoaded', { usage: 'Input', desc: 'Tube A At Staging Sensor' }), boolTag('i_TubeBLoaded', { usage: 'Input', desc: 'Tube B At Staging Sensor' }),
    dintTag('i_EncoderCount', 0, { usage: 'Input', desc: 'Payout Encoder Count' }),
    dintTag('i_MicrometerX', 0, { usage: 'Input', desc: 'Micrometer X Reading' }), dintTag('i_MicrometerY', 0, { usage: 'Input', desc: 'Micrometer Y Reading' }),
    '<Tag Name="' + A + '" TagType="Base" DataType="AXIS_CIP_DRIVE" Usage="InOut" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    // parameters: outputs
    boolTag('q_ExtendCutter', { usage: 'Output', desc: 'Extend Cutter' }), boolTag('q_RetractCutter', { usage: 'Output', desc: 'Retract Cutter' }),
    boolTag('q_ExtendSelector', { usage: 'Output', desc: 'Selector To Tube B' }), boolTag('q_RetractSelector', { usage: 'Output', desc: 'Selector To Tube A' }),
    boolTag('q_ExtendInserter', { usage: 'Output', desc: 'Extend Inserter' }), boolTag('q_RetractInserter', { usage: 'Output', desc: 'Retract Inserter' }),
    boolTag('q_CloseTubeAGripper', { usage: 'Output', desc: 'Close Tube A Gripper' }), boolTag('q_OpenTubeAGripper', { usage: 'Output', desc: 'Open Tube A Gripper' }),
    boolTag('q_CloseTubeBGripper', { usage: 'Output', desc: 'Close Tube B Gripper' }), boolTag('q_OpenTubeBGripper', { usage: 'Output', desc: 'Open Tube B Gripper' }),
    boolTag('q_ResetEncoder', { usage: 'Output', desc: 'Reset Payout Encoder' }),
    boolTag('q_TubeReady', { usage: 'Output', desc: 'Cut Tube In Staging' }), boolTag('q_TubeGood', { usage: 'Output', desc: 'Tube In Staging Is Good' }),
    dintTag('q_TubeFailureCode', 0, { usage: 'Output', desc: 'Tube Failure Code' }),
    boolTag('q_ActiveTubeB', { usage: 'Output', desc: 'Tube B Is The Active Tube' }), boolTag('q_TubeInDrive', { usage: 'Output', desc: 'Active Tube In The Drive' }),
    boolTag('q_TubeALoaded', { usage: 'Output', desc: 'Tube A Loaded At Staging' }), boolTag('q_TubeBLoaded', { usage: 'Output', desc: 'Tube B Loaded At Staging' }),
    boolTag('q_AlarmActive', { usage: 'Output' }), boolTag('q_WarningActive', { usage: 'Output' }), boolTag('q_AutoMode', { usage: 'Output' }), boolTag('q_AutoStopped', { usage: 'Output' }), boolTag('q_StartOK', { usage: 'Output' }),
    realTag('p_CycleTime', 0, { usage: 'Public' }),
    // state engine + alarms (template forms)
    copyTag(S03, 'Control', 'Control'), statusTag(states), copyTag(S03, 'StateEngine', 'StateEngine'), copyTag(S03, 'StateHistory', 'StateHistory'),
    alarmArrayTag('Alarm', PREFIX, alarms, 20), stringArrayTag('AlarmList', alarms, 20), copyTag(S03, 'ProgramFaultHandler', 'ProgramFaultHandler'),
    alarmArrayTag('ServoAlarm', PREFIX, servoAlarms, 2), stringArrayTag('ServoAlarmList', servoAlarms, 2), copyTag(S05, 'ServoFaultHandler', 'ServoFaultHandler'),
    boolTag('AlarmActive'), boolTag('WarningActive'), boolTag('ServoAlarmActive'), boolTag('ServoWarningActive'),
    // mode / supervisor
    boolTag('AutoIdle'), boolTag('CycleRunning'), boolTag('CycleStopped'), boolTag('CycleStopping'), copyTag(S03, 'CycleTimer', 'CycleTimer'), boolTag('DryRun'), boolTag('FaultReset'), dintTag('FaultState', 0),
    boolTag('HMI_LocalManualOverride'), boolTag('Initialized'), boolTag('LocalSSONS'), boolTag('Lockout'), boolTag('ManualMode'), dintTag('ONS', 0), dintTag('RestartState', 0), boolTag('SafetyOK'), dintTag('SafetyStopState', 0),
    boolTag('SS'), boolTag('SS_OK'), dintTag('StaNum', 0), boolTag('UseRestartLogic'), boolTag('HMI_MomentaryOnPrevScan'),
    dintCommentTag('HMI_Momentary', [[0, 'Extend Cutter'], [1, 'Retract Cutter'], [2, 'Selector To Tube A'], [3, 'Selector To Tube B'], [4, 'Extend Inserter'], [5, 'Retract Inserter'], [6, 'Close Tube A Gripper'], [7, 'Open Tube A Gripper'], [8, 'Close Tube B Gripper'], [9, 'Open Tube B Gripper'], [10, 'Reset Encoder']]),
    // derived device states
    boolTag('CutterExtended'), boolTag('CutterRetracted'), boolTag('SelectorExtended'), boolTag('SelectorRetracted'), boolTag('InserterExtended'), boolTag('InserterRetracted'),
    timerTag('InserterExtendedDelay', 500, 'Inserter Extended Delay Timer'),
    boolTag('TubeAGripperOpened'), boolTag('TubeAGripperClosed'), boolTag('TubeBGripperOpened'), boolTag('TubeBGripperClosed'),
    timerTag('OpenTubeAGripperDelay', 250, 'Tube A Gripper Open Delay'), timerTag('CloseTubeAGripperDelay', 250, 'Tube A Gripper Close Delay'),
    timerTag('OpenTubeBGripperDelay', 250, 'Tube B Gripper Open Delay'), timerTag('CloseTubeBGripperDelay', 250, 'Tube B Gripper Close Delay'),
    copyTag(S03, 'PartPresentDebounce', 'TubeALoadedDebounce', 'Tube A At Staging Sensor'), copyTag(S03, 'PartPresentDebounce', 'TubeBLoadedDebounce', 'Tube B At Staging Sensor'),
    boolTag('TubeInDrive'), boolTag('ActiveGripperOpened'), boolTag('ActiveSpoolEmpty'), boolTag('StagingEmpty'), boolTag('PrimeCycle'), boolTag('LengthOK'),
    boolTag('OkManExtendSelector'), boolTag('OkManRetractSelector'),
    // measurements and setpoints
    realTag('EncoderCountsPerRev', 1024, { desc: 'Encoder Counts Per Revolution' }), realTag('EncoderWheelCircumference', 200, { desc: 'Encoder Wheel mm Per Rev' }),
    realTag('EncoderRevs', 0, { desc: 'Encoder Revolutions' }), realTag('EncoderLength', 0, { desc: 'Length Paid Out mm' }),
    realTag('MicrometerCountsPerMm', 100000, { desc: 'Micrometer Counts Per mm' }), realTag('DiameterX', 0, { desc: 'Tube Diameter X mm' }), realTag('DiameterY', 0, { desc: 'Tube Diameter Y mm' }),
    realTag('OvalityXY', 0, { desc: 'Diameter X Minus Y' }), realTag('OvalityYX', 0, { desc: 'Diameter Y Minus X' }),
    realTag('DiameterMin', 0, { desc: 'Smallest Diameter This Tube' }), realTag('DiameterMax', 0, { desc: 'Largest Diameter This Tube' }), realTag('OvalityMax', 0, { desc: 'Largest Ovality This Tube' }),
    realTag('HMI_TubeLength', 736.6, { desc: 'Tube Length mm' }), realTag('HMI_LengthTolerance', 2, { desc: 'Length Tolerance mm' }), realTag('HMI_PrimeLength', 100, { desc: 'Prime Feed Length mm' }),
    realTag('HMI_BackoutLength', 300, { desc: 'Back Out Length mm' }), realTag('HMI_DiameterMin', 0, { desc: 'Minimum Diameter mm' }), realTag('HMI_DiameterMax', 99, { desc: 'Maximum Diameter mm' }), realTag('HMI_OvalityMax', 99, { desc: 'Maximum Ovality mm' }),
    realTag('LengthError', 0, { desc: 'Fed Length Error mm' }), realTag('LengthToleranceNeg', 0, { desc: 'Negative Length Tolerance' }), realTag('CorrectionLength', 0, { desc: 'Correction Move mm' }), realTag('BackoutMove', 0, { desc: 'Back Out Move mm' }),
    dintTag('CorrectionCount', 0, { desc: 'Correction Moves This Tube' }),
    // servo (S05 / S10 R04 form)
    copyTag(S05, 'HMI_XAxis', H, ''), boolTag(FA + 'AutoEnable'), copyTag(S05, 'XAxisEnableDelay', FA + 'EnableDelay', 'Feed Axis Enable Delay'), stringTag(FA + 'Fault'), stringTag(FA + 'FaultMessage'),
    boolTag(FA + 'HomeConfimed'), copyTag(S05, 'XAxisHomeConfirmDelay', FA + 'HomeConfirmDelay', 'Feed Axis Home Confirm Delay'), boolTag(FA + 'HomeRequested'), boolTag(FA + 'HomeSelect'), realTag(FA + 'InchAmount', 0), dintTag(FA + 'JogDirection', 0),
    boolTag(FA + 'ManMoveTrig'), copyTag(S05, 'XAxisMotionParameters', FA + 'MotionParameters', ''), dintTag(FA + 'ONS', 0), boolTag(FA + 'Permissive'), boolTag(FA + 'Ready'), copyTag(S05, 'XAxisTorqueHome', FA + 'TorqueHome', ''),
    ...['_Inch', '_MAFR', '_MAH', '_MAJ', '_MAM', '_MASR', '_MAS_All', '_MAS_Jog', '_MSF', '_MSO', 'Auto_MAJ', 'Auto_MAS'].map((s) => copyTag(S05, 'XAxis_MAM', FA + s, '')),
  ];
  for (const t of tags) for (const m of t.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) must(m[1].length <= 30, 'description over 30 chars: ' + m[1]);
  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R04_FeedAxisServo,0);'], ['', 'JSR(R20_Alarms,0);']];
  const OP = '\\L2_Tracking.p_Data.Station[StaNum].OpStatus.';
  const R01 = [
    ['Station Number', 'MOVE(1,StaNum);'],
    ['Mapped/debounced inputs', 'XIC(i_CutterExtended)XIO(i_CutterRetracted)XIC(q_ExtendCutter)XIO(q_RetractCutter)OTE(CutterExtended);'],
    ['', 'XIC(i_CutterRetracted)XIO(i_CutterExtended)XIC(q_RetractCutter)XIO(q_ExtendCutter)OTE(CutterRetracted);'],
    ['', 'XIC(i_SelectorExtended)XIO(i_SelectorRetracted)XIC(q_ExtendSelector)XIO(q_RetractSelector)OTE(SelectorExtended);'],
    ['', 'XIC(i_SelectorRetracted)XIO(i_SelectorExtended)XIC(q_RetractSelector)XIO(q_ExtendSelector)OTE(SelectorRetracted);'],
    ['', 'XIO(i_InserterRetracted)XIC(q_ExtendInserter)XIO(q_RetractInserter)TON(InserterExtendedDelay,?,?)XIC(InserterExtendedDelay.DN)OTE(InserterExtended);'],
    ['', 'XIC(i_InserterRetracted)XIC(q_RetractInserter)XIO(q_ExtendInserter)OTE(InserterRetracted);'],
    ['', 'XIC(q_OpenTubeAGripper)XIO(q_CloseTubeAGripper)TON(OpenTubeAGripperDelay,?,?)XIC(OpenTubeAGripperDelay.DN)OTE(TubeAGripperOpened);'],
    ['', 'XIC(q_CloseTubeAGripper)XIO(q_OpenTubeAGripper)TON(CloseTubeAGripperDelay,?,?)XIC(CloseTubeAGripperDelay.DN)OTE(TubeAGripperClosed);'],
    ['', 'XIC(q_OpenTubeBGripper)XIO(q_CloseTubeBGripper)TON(OpenTubeBGripperDelay,?,?)XIC(OpenTubeBGripperDelay.DN)OTE(TubeBGripperOpened);'],
    ['', 'XIC(q_CloseTubeBGripper)XIO(q_OpenTubeBGripper)TON(CloseTubeBGripperDelay,?,?)XIC(CloseTubeBGripperDelay.DN)OTE(TubeBGripperClosed);'],
    ['', 'AOI_Debounce(TubeALoadedDebounce,i_TubeALoaded,100,100)XIC(TubeALoadedDebounce.On)OTE(q_TubeALoaded);'],
    ['', 'AOI_Debounce(TubeBLoadedDebounce,i_TubeBLoaded,100,100)XIC(TubeBLoadedDebounce.On)OTE(q_TubeBLoaded);'],
    ['Active tube held by the drive (air spring sensor made)', '[XIO(q_ActiveTubeB) XIC(i_TubeAInDrive) ,XIC(q_ActiveTubeB) XIC(i_TubeBInDrive) ][OTE(TubeInDrive) ,OTE(q_TubeInDrive) ];'],
    ['', '[XIO(q_ActiveTubeB) XIC(TubeAGripperOpened) ,XIC(q_ActiveTubeB) XIC(TubeBGripperOpened) ]OTE(ActiveGripperOpened);'],
    ['Spool of the active tube ran out', '[XIO(q_ActiveTubeB) XIC(' + DR + '.q_SpoolAEmpty) ,XIC(q_ActiveTubeB) XIC(' + DR + '.q_SpoolBEmpty) ]OTE(ActiveSpoolEmpty);'],
    ['Staging empty  *Replace always on with the pick and place signal', 'XIC(g_MachineBasic.AlwaysOn)OTE(StagingEmpty);'],
    ['Length paid out from the encoder wheel', 'DIV(i_EncoderCount,EncoderCountsPerRev,EncoderRevs)CPT(EncoderLength,EncoderRevs*EncoderWheelCircumference);'],
    ['Fed length error and correction move', 'SUB(EncoderLength,HMI_TubeLength,LengthError)SUB(HMI_TubeLength,EncoderLength,CorrectionLength)NEG(HMI_LengthTolerance,LengthToleranceNeg)NEG(HMI_BackoutLength,BackoutMove);'],
    ['', 'LIMIT(LengthToleranceNeg,LengthError,HMI_LengthTolerance)OTE(LengthOK);'],
    ['Tube diameter from the X and Y micrometers', 'DIV(i_MicrometerX,MicrometerCountsPerMm,DiameterX)DIV(i_MicrometerY,MicrometerCountsPerMm,DiameterY)SUB(DiameterX,DiameterY,OvalityXY)SUB(DiameterY,DiameterX,OvalityYX);'],
    ['Logic inputs  *Replace always off bits with real conditions', 'XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);'],
    ['', 'XIC(\\Supervisor.q_AutoIdle)OTE(AutoIdle);'], ['', 'XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'], ['', 'XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'],
    ['', '[XIC(\\Supervisor.q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ,XIC(' + OP + 'SingleStepA) ]OTE(CycleRunning);'],
    ['', 'XIO(\\Supervisor.q_CycleStartLatch)XIO(HMI_LocalManualOverride)XIO(' + OP + 'SingleStepA)OTE(CycleStopping);'],
    ['', 'XIC(\\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);'],
    ['', 'XIC(CutterRetracted)XIC(' + A + '.ServoActionStatus)OTE(Initialized);'],
    ['Lockout', 'XIC(' + OP + 'LockoutA)XIO(ManualMode)OTE(Lockout);'],
    ['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + OP + 'DryRunA) ,XIC(g_HMI_DryRun) ]OTE(DryRun);'],
    ['Single Step Logic', 'XIC(' + OP + 'SingleStepA)OTE(SS);'],
    ['', '[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);'],
    ['Clear HMI Manual Triggers', 'XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);'], ['', 'NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'],
  ];
  const R02 = [
    ['Start Of State Machine', 'NOP();'],
    ['State 2: Auto mode idle not ready', '[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);'],
    ['State 3: Auto mode idle ready', '[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[25]) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);'],
    ['State 4: Start of sequence, wait for the staging position to be empty', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[25]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Reset the payout encoder, tube in the drive and spool not empty', 'XIC(Status.State[4])XIC(StagingEmpty)XIC(TubeInDrive)XIO(ActiveSpoolEmpty)XIC(SS_OK)MOVE(7,Control.StateReg);'],
    ['State 10: Feed one tube length', 'XIC(Status.State[7])LE(i_EncoderCount,2)XIC(SS_OK)MOVE(10,Control.StateReg)MOVE(0,CorrectionCount)MOVE(999.0,DiameterMin)MOVE(0.0,DiameterMax)MOVE(0.0,OvalityMax);'],
    ['State 13: Check the fed length against the encoder', '[XIC(Status.State[10]) ,XIC(Status.State[16]) ]XIC(' + FA + '_MAM.PC)MOVE(13,Control.StateReg);'],
    ['State 16: Correction move when the encoder disagrees, two tries', 'XIC(Status.State[13])XIO(LengthOK)LT(CorrectionCount,2)XIC(SS_OK)MOVE(16,Control.StateReg)ADD(CorrectionCount,1,CorrectionCount);'],
    ['State 19: Extend cutter', '[XIC(Status.State[13]) [XIC(LengthOK) ,GE(CorrectionCount,2) ] ,XIC(Status.State[55]) XIC(' + FA + '_MAM.PC) ]XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: Retract cutter', 'XIC(Status.State[19])XIC(CutterExtended)XIC(SS_OK)MOVE(22,Control.StateReg);'],
    ['State 25: Tube complete, result to the pick and place', 'XIC(Status.State[22])XIC(CutterRetracted)XIC(SS_OK)MOVE(25,Control.StateReg);'],
    ['State 40: No tube in the drive or spool empty, back out and change over', 'XIC(Status.State[4])XIC(StagingEmpty)[XIO(TubeInDrive) ,XIC(ActiveSpoolEmpty) ]XIC(SS_OK)MOVE(40,Control.StateReg);'],
    ['State 43: Retract inserter once the tube is clear of the drive', 'XIC(Status.State[40])XIO(TubeInDrive)XIO(' + FA + '_MAM.IP)XIC(SS_OK)MOVE(43,Control.StateReg);'],
    ['State 46: Select the staging position that holds a tube', 'XIC(Status.State[43])XIC(InserterRetracted)XIC(SS_OK)MOVE(46,Control.StateReg);'],
    ['State 49: Extend inserter and jog the drive until the air spring sensor is made', 'XIC(Status.State[46])[XIO(q_ActiveTubeB) XIC(SelectorRetracted) XIC(q_TubeALoaded) ,XIC(q_ActiveTubeB) XIC(SelectorExtended) XIC(q_TubeBLoaded) ]XIC(SS_OK)MOVE(49,Control.StateReg);'],
    ['State 52: Stop the drive and open the active gripper', 'XIC(Status.State[49])XIC(TubeInDrive)MOVE(52,Control.StateReg);'],
    ['State 55: Prime feed past the cutter', 'XIC(Status.State[52])XIO(' + A + '.JogStatus)XIC(ActiveGripperOpened)XIC(SS_OK)MOVE(55,Control.StateReg)OTL(PrimeCycle);'],
    ['State 99: Lockout', 'XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);'],
    ['State 100:Start of initialization sequence, retract cutter', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 124: Initialization complete', 'XIC(Status.State[100])XIC(CutterRetracted)XIC(' + A + '.ServoActionStatus)MOVE(124,Control.StateReg);'],
    ['Restart Logic  *Use the part status at this station to determine a course of action here.  For instance, no attempt made, no part present, no success or failure status at this station indicates initialization is in order. If an attempt was made with no success or failure, restart at last state may be in order. Also, you do not always need to go into the state you left. Some cases require you to go into the prior state to restart a particular portion of the sequence.', 'XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)XIC(g_MachineBasic.AlwaysOff)MOVE(RestartState,FaultState);'],
    ['State 127: Fault', 'XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];'],
    ['State 1: Manual Mode', 'XIC(ManualMode)MOVE(1,Control.StateReg);'],
    ['State 0: Safety Stop', '[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];'],
    ['', 'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'],
    ['Cycle Time  **Limit Instruction Low & High Limits Populated WIth Range Of States In Which Station Is Running (Example, PNP Is Picking & Placing A Part) **Cycle Complete State Shown As Example', '[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];'],
  ];
  const R03 = [
    ['Output Status to Supervisor', 'XIC(' + A + '.ServoActionStatus)XIC(' + A + '.AxisHomedStatus)XIO(' + OP + 'SingleStepA)OTE(q_StartOK);'],
    ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ]XIO(CycleRunning)OTE(q_AutoMode);'],
    ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ,XIC(Status.State[127]) ]XIO(CycleRunning)OTE(q_AutoStopped);'],
    ['Active Tube: the other staging position takes over when it holds a tube', 'XIC(Status.State[46])[XIO(q_ActiveTubeB) [XIC(ActiveSpoolEmpty) ,XIO(q_TubeALoaded) ] XIC(q_TubeBLoaded) OTL(q_ActiveTubeB) ,XIC(q_ActiveTubeB) [XIC(ActiveSpoolEmpty) ,XIO(q_TubeBLoaded) ] XIC(q_TubeALoaded) OTU(q_ActiveTubeB) ];'],
    ['Cutter Control', '[XIO(Status.State[1]) [XIC(Status.State[19]) ,XIC(q_ExtendCutter) XIO(Status.State[22]) XIO(Status.State[100]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.0) ,XIC(q_ExtendCutter) XIO(HMI_Momentary.1) ] ]OTE(q_ExtendCutter);'],
    ['', '[XIO(Status.State[1]) [XIC(Status.State[22]) ,XIC(Status.State[100]) ,XIC(q_RetractCutter) XIO(Status.State[19]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.1) ,XIC(q_RetractCutter) XIO(HMI_Momentary.0) ] ]OTE(q_RetractCutter);'],
    ['Selector Control, only with the inserter retracted', 'XIC(Status.State[1])XIC(InserterRetracted)[XIC(HMI_Momentary.3) OTE(OkManExtendSelector) ,XIC(HMI_Momentary.2) OTE(OkManRetractSelector) ];'],
    ['', '[XIO(Status.State[1]) [XIC(Status.State[46]) XIC(q_ActiveTubeB) ,XIC(q_ExtendSelector) XIO(q_RetractSelector) ] ,XIC(Status.State[1]) [XIC(OkManExtendSelector) ,XIC(q_ExtendSelector) XIO(OkManRetractSelector) ] ]XIO(Status.State[0])OTE(q_ExtendSelector);'],
    ['', '[XIO(Status.State[1]) [XIC(Status.State[46]) XIO(q_ActiveTubeB) ,XIC(q_RetractSelector) XIO(Status.State[46]) ,XIC(q_RetractSelector) XIO(q_ActiveTubeB) ] ,XIC(Status.State[1]) [XIC(OkManRetractSelector) ,XIC(q_RetractSelector) XIO(OkManExtendSelector) ] ]XIO(q_ExtendSelector)OTE(q_RetractSelector);'],
    ['Inserter Control', '[XIO(Status.State[1]) [XIC(Status.State[49]) ,XIC(q_ExtendInserter) XIO(Status.State[43]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.4) ,XIC(q_ExtendInserter) XIO(HMI_Momentary.5) ] ]OTE(q_ExtendInserter);'],
    ['', '[XIO(Status.State[1]) [XIC(Status.State[43]) ,XIC(q_RetractInserter) XIO(Status.State[49]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.5) ,XIC(q_RetractInserter) XIO(HMI_Momentary.4) ] ]OTE(q_RetractInserter);'],
    ['Tube A Gripper Control: closed at staging, open once the drive holds the tube', '[XIO(Status.State[1]) XIC(q_TubeALoaded) [XIC(q_ActiveTubeB) ,XIO(i_TubeAInDrive) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.6) ,XIC(q_CloseTubeAGripper) XIO(HMI_Momentary.7) ] ]OTE(q_CloseTubeAGripper);'],
    ['', '[XIO(Status.State[1]) [XIO(q_TubeALoaded) ,XIO(q_ActiveTubeB) XIC(i_TubeAInDrive) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.7) ,XIC(q_OpenTubeAGripper) XIO(HMI_Momentary.6) ] ]OTE(q_OpenTubeAGripper);'],
    ['Tube B Gripper Control', '[XIO(Status.State[1]) XIC(q_TubeBLoaded) [XIO(q_ActiveTubeB) ,XIO(i_TubeBInDrive) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.8) ,XIC(q_CloseTubeBGripper) XIO(HMI_Momentary.9) ] ]OTE(q_CloseTubeBGripper);'],
    ['', '[XIO(Status.State[1]) [XIO(q_TubeBLoaded) ,XIC(q_ActiveTubeB) XIC(i_TubeBInDrive) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.9) ,XIC(q_OpenTubeBGripper) XIO(HMI_Momentary.8) ] ]OTE(q_OpenTubeBGripper);'],
    ['Encoder Reset', '[XIC(Status.State[7]) ,XIC(Status.State[1]) XIC(HMI_Momentary.10) ]OTE(q_ResetEncoder);'],
    ['Diameter and ovality extremes over the fed length', 'XIC(Status.State[10])[LT(DiameterX,DiameterMin) MOVE(DiameterX,DiameterMin) ,LT(DiameterY,DiameterMin) MOVE(DiameterY,DiameterMin) ,GT(DiameterX,DiameterMax) MOVE(DiameterX,DiameterMax) ,GT(DiameterY,DiameterMax) MOVE(DiameterY,DiameterMax) ,GT(OvalityXY,OvalityMax) MOVE(OvalityXY,OvalityMax) ,GT(OvalityYX,OvalityMax) MOVE(OvalityYX,OvalityMax) ];'],
    ['Tube Result: 0 good, 11 slug, 12 length, 13 diameter, 14 ovality', 'XIC(Status.State[25])ONS(ONS.7)[XIC(PrimeCycle) MOVE(11,q_TubeFailureCode) ,XIO(PrimeCycle) [MOVE(0,q_TubeFailureCode) ,GT(OvalityMax,HMI_OvalityMax) MOVE(14,q_TubeFailureCode) ,[LT(DiameterMin,HMI_DiameterMin) ,GT(DiameterMax,HMI_DiameterMax) ] MOVE(13,q_TubeFailureCode) ,XIO(LengthOK) MOVE(12,q_TubeFailureCode) ] ]OTU(PrimeCycle);'],
    ['Tube ready in staging until the next feed pushes it on', '[XIC(Status.State[25]) OTL(q_TubeReady) ,XIC(Status.State[10]) OTU(q_TubeReady) ];'],
    ['', 'XIC(q_TubeReady)EQ(q_TubeFailureCode,0)OTE(q_TubeGood);'],
  ];
  const P = H + '.Parameters', ST = H + '.Status', CT = H + '.Control', MP = FA + 'MotionParameters';
  const R04 = [
    ['Axis Is Ready For Operation', 'XIC(MotionGroup.GroupSynced)XIO(' + A + '.SafeTorqueOffActiveInhibit)OTE(' + FA + 'Ready);'],
    ['', 'XIC(SafetyOK)XIC(' + FA + 'Ready)TON(' + FA + 'EnableDelay,?,?)XIC(' + FA + 'EnableDelay.DN)ONS(' + FA + 'ONS.0)OTE(' + FA + 'AutoEnable);'],
    ['Axis Motion Permissive', 'XIC(g_MachineBasic.AlwaysOn)OTE(' + FA + 'Permissive);'],
    ['Enable Axis', '[XIC(Status.State[1]) XIC(' + CT + '.Enable) XIC(' + FA + 'Ready) ,XIC(' + FA + 'AutoEnable) ]XIO(' + A + '.ServoActionStatus)MSO(' + A + ',' + FA + '_MSO);'],
    ['Disable Axis', 'XIC(Status.State[1])XIC(' + CT + '.Disable)MSF(' + A + ',' + FA + '_MSF);'],
    ['Fault Reset Axis', 'NE(' + A + '.AxisFault,0)XIC(FaultReset)[XIO(' + A + '.ShutdownStatus) MAFR(' + A + ',' + FA + '_MAFR) ,XIC(' + A + '.ShutdownStatus) MASR(' + A + ',' + FA + '_MASR) ];'],
    ['Manual Jog Axis', 'XIC(Status.State[1])XIC(' + FA + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)[XIC(' + CT + '.JogPositive) XIO(' + CT + '.JogNegative) MOVE(0,' + FA + 'JogDirection) ,XIC(' + CT + '.JogNegative) XIO(' + CT + '.JogPositive) MOVE(1,' + FA + 'JogDirection) ]MAJ(' + A + ',' + FA + '_MAJ,' + FA + 'JogDirection,' + P + '.JogSpeed,Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None);'],
    ['', 'XIC(' + FA + '_MAJ.IP)XIO(' + CT + '.JogPositive)XIO(' + CT + '.JogNegative)MAS(' + A + ',' + FA + '_MAS_Jog,Jog,Yes,' + P + '.Decel[0],Units per sec2,No,0,Units per sec3);'],
    ['Inch Axis', 'XIC(Status.State[1])XIC(' + FA + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)[XIC(' + CT + '.InchPositive) ONS(' + FA + 'ONS.1) MOVE(' + P + '.InchAmount,' + FA + 'InchAmount) ,XIC(' + CT + '.InchNegative) ONS(' + FA + 'ONS.2) NEG(' + P + '.InchAmount,' + FA + 'InchAmount) ]MAM(' + A + ',' + FA + '_Inch,1,' + FA + 'InchAmount,' + P + '.ManualSpeed,Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);'],
    ['Home Axis  ***No Homing Required For The Tube Feed Belt.  Logic Left In For Standardization.***', 'XIC(Status.State[1])[XIC(' + CT + '.HomeRequest) ONS(' + FA + 'ONS.3) XIO(' + FA + 'TorqueHome.IP) ,XIC(' + FA + 'HomeRequested) XIO(' + FA + 'HomeConfirmDelay.DN) XIO(' + FA + 'HomeConfimed) ]XIC(' + FA + 'Ready)[OTE(' + FA + 'HomeRequested) ,TON(' + FA + 'HomeConfirmDelay,?,?) ];'],
    ['', 'XIC(Status.State[1])[XIC(' + CT + '.HomeConfirm) ONS(' + FA + 'ONS.4) ,XIC(' + FA + 'HomeConfimed) XIC(' + FA + 'HomeSelect) XIO(' + FA + 'TorqueHome.PC) XIO(' + FA + 'TorqueHome.Error) ]OTE(' + FA + 'HomeConfimed);'],
    ['Home Select = 0 is for Immediate Home (Example, servo indexer) Home Select = 1 is for Home To Torque (Example, PNP)  Homing Torque = Start at 25%, Increase In 5% Increments If Not Enough Run Torque = Normal Running Torque Of Axis Homing Speed = Homing Speed in units/s Overtorque Limit = Set The Same As Homing Torque Home Offset Distance = Distance Moved Off Of Hard Stop When Homing Complete Home Direction = 0 Is Positive, 1 Is Negative', 'XIC(' + FA + 'HomeConfimed)[XIO(' + FA + 'HomeSelect) MAH(' + A + ',' + FA + '_MAH) ,XIC(' + FA + 'HomeSelect) AOI_TorqueHome(' + FA + 'TorqueHome,' + A + ',25.0,100.0,5.0,25.0,0.5,1) ];'],
    ['', '[XIC(' + FA + 'HomeRequested) OTE(' + ST + '.HomeRequested) ,[XIC(' + FA + 'TorqueHome.IP) ,XIC(' + FA + '_MAH.IP) ] OTE(' + ST + '.HomeInProcess) ,[XIC(' + FA + 'TorqueHome.PC) ,XIC(' + FA + '_MAH.PC) ] OTE(' + ST + '.HomeComplete) ];'],
    ['Manual Mode', 'XIC(SafetyOK)XIC(Status.State[1])[MOVE(' + P + '.ManualSpeed,' + MP + '.Speed) ,XIC(' + FA + 'Permissive) XIC(' + CT + '.ManMoves.0) MOVE(HMI_TubeLength,' + MP + '.Position) OTE(' + FA + 'ManMoveTrig) ];'],
    ['Auto Mode: feed, correction, back out and prime are incremental moves', 'XIC(SafetyOK)XIO(Status.State[1])[MOVE(1,' + MP + '.MoveType) ,MOVE(' + P + '.AutoSpeed[0],' + MP + '.Speed) ,MOVE(' + P + '.Accel[0],' + MP + '.Accel) ,MOVE(' + P + '.Decel[0],' + MP + '.Decel) ,XIC(Status.State[10]) MOVE(HMI_TubeLength,' + MP + '.Position) ,XIC(Status.State[16]) MOVE(CorrectionLength,' + MP + '.Position) ,XIC(Status.State[40]) MOVE(BackoutMove,' + MP + '.Position) ,XIC(Status.State[55]) MOVE(HMI_PrimeLength,' + MP + '.Position) ];'],
    ['Axis Motion Command', 'XIC(SafetyOK)[XIC(Status.State[1]) XIC(' + FA + 'ManMoveTrig) ,XIO(Status.State[1]) [XIC(Status.State[10]) ,XIC(Status.State[16]) ,XIC(Status.State[40]) XIC(TubeInDrive) ,XIC(Status.State[55]) ] ]XIC(' + A + '.ServoActionStatus)XIC(' + A + '.AxisHomedStatus)XIC(' + FA + 'Permissive)MAM(' + A + ',' + FA + '_MAM,' + MP + '.MoveType,' + MP + '.Position,' + MP + '.Speed,Units per sec,' + MP + '.Accel,Units per sec2,' + MP + '.Decel,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);'],
    ['Auto Jog Axis: pull the tube into the drive while inserting', 'XIO(Status.State[1])XIC(Status.State[49])XIC(' + FA + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)MAJ(' + A + ',' + FA + 'Auto_MAJ,0,' + P + '.AutoSpeed[1],Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None);'],
    ['', 'XIO(Status.State[1])XIC(Status.State[52])XIC(' + FA + 'Auto_MAJ.IP)MAS(' + A + ',' + FA + 'Auto_MAS,Jog,Yes,' + P + '.Decel[0],Units per sec2,No,0,Units per sec3);'],
    ['Stop axis if permissive turns off while in motion and use max or close to max decel value', 'XIO(' + A + '.MotionStatus.0)[XIO(' + FA + 'Permissive) ,XIO(SafetyOK) ]MAS(' + A + ',' + FA + '_MAS_All,All,Yes,90,% of Maximum,Yes,90,% of Maximum);'],
    ['Set torque', 'XIC(' + CT + '.SetTorquePos)MOVE(' + P + '.TorquePos,' + A + '.TorqueLimitPositive);'],
    ['', 'XIC(' + CT + '.SetTorqueNeg)MOVE(' + P + '.TorqueNeg,' + A + '.TorqueLimitNegative);'],
    ['Retrieve values from axis', 'MOVE(' + A + '.ActualPosition,' + ST + '.ActualPosition)MOVE(' + A + '.ActualVelocity,' + ST + '.ActualVelocity)MOVE(' + A + '.TorqueReferenceLimited,' + ST + '.ActualTorque);'],
    ['Retrieve the maximum speed value from the axis and calculate max accel and decel.  The max velocity is 85% of full speed.  Equation is based upon 100% speed at a 30ms accel/decel time.', 'XIC(S:FS)GSV(Axis,' + A + ',MaximumSpeed,' + ST + '.MaxVelocity)CPT(' + ST + '.MaxAccel,(' + ST + '.MaxVelocity/0.85)/0.03)MOVE(' + ST + '.MaxAccel,' + ST + '.MaxDecel);'],
  ];
  const al = (i, comment, cond) => [comment, '[' + cond + ' ,XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(ONS.' + (8 + i) + ') CONCAT(g_StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];'];
  const stateTimeout = (st, ms) => 'XIC(Status.State[' + st + ']) MOVE(' + ms + ',Control.FaultTime) XIC(Status.TimeoutFlt)';
  const R20 = [
    ['Feed Axis Servo Drive Is Faulted', 'NE(' + A + '.AxisFault,0)[OTE(ServoAlarm[0].Active) ,ONS(ONS.5) DTOS(' + A + '.AxisFault,' + FA + 'Fault) CONCAT(g_StationList[StaNum],ServoAlarmList[0],' + FA + 'FaultMessage) CONCAT(' + FA + 'FaultMessage,' + FA + 'Fault,ServoAlarm[0].Message) ];'],
    ['Waiting For Operator To Load A Tube', 'XIC(Status.State[46])MOVE(10000,Control.FaultTime)XIC(Status.TimeoutFlt)XIO(q_TubeALoaded)XIO(q_TubeBLoaded)[OTE(Alarm[0].Active) ,ONS(ONS.6) MOVE(1,Alarm[0].Severity) CONCAT(g_StationList[StaNum],AlarmList[0],Alarm[0].Message) ];'],
    al(1, 'Waiting For Cutter To Extend', 'XIO(Lockout) XIC(q_ExtendCutter) XIO(CutterExtended) TON(AlarmTimerCutterExtended,?,?) XIC(AlarmTimerCutterExtended.DN)'),
    al(2, 'Waiting For Cutter To Retract', 'XIO(Lockout) XIC(q_RetractCutter) XIO(CutterRetracted) TON(AlarmTimerCutterRetracted,?,?) XIC(AlarmTimerCutterRetracted.DN)'),
    al(3, 'Cutter Sensors/Outputs Misconfigured', 'XIO(Lockout) [XIC(q_RetractCutter) XIC(q_ExtendCutter) ,XIC(i_CutterExtended) XIC(i_CutterRetracted) ] TON(AlarmTimerCutterMisconfigured,?,?) XIC(AlarmTimerCutterMisconfigured.DN)'),
    al(4, 'Waiting For Selector To Extend', 'XIO(Lockout) XIC(q_ExtendSelector) XIO(SelectorExtended) TON(AlarmTimerSelectorExtended,?,?) XIC(AlarmTimerSelectorExtended.DN)'),
    al(5, 'Waiting For Selector To Retract', 'XIO(Lockout) XIC(q_RetractSelector) XIO(SelectorRetracted) TON(AlarmTimerSelectorRetracted,?,?) XIC(AlarmTimerSelectorRetracted.DN)'),
    al(6, 'Selector Sensors/Outputs Misconfigured', 'XIO(Lockout) [XIC(q_RetractSelector) XIC(q_ExtendSelector) ,XIC(i_SelectorExtended) XIC(i_SelectorRetracted) ] TON(AlarmTimerSelectorMisconfigured,?,?) XIC(AlarmTimerSelectorMisconfigured.DN)'),
    al(7, 'Waiting For Inserter To Retract', 'XIO(Lockout) XIC(q_RetractInserter) XIO(InserterRetracted) TON(AlarmTimerInserterRetracted,?,?) XIC(AlarmTimerInserterRetracted.DN)'),
    al(8, 'Waiting For Tube To Enter The Drive', stateTimeout(49, 10000)),
    al(9, 'Waiting For Encoder Reset', stateTimeout(7, 2000)),
    al(10, 'Waiting For Feed To Complete', stateTimeout(10, 15000)),
    al(11, 'Waiting For Correction Move', stateTimeout(16, 5000)),
    al(12, 'Waiting For Tube To Back Out', stateTimeout(40, 10000)),
    al(13, 'Waiting For Prime Feed', stateTimeout(55, 10000)),
    al(14, 'Waiting For Drive To Stop', stateTimeout(52, 3000)),
    ['Tube Length Out Of Tolerance', 'XIC(Status.State[25])EQ(q_TubeFailureCode,12)[OTE(Alarm[15].Active) ,ONS(ONS.23) MOVE(1,Alarm[15].Severity) CONCAT(g_StationList[StaNum],AlarmList[15],Alarm[15].Message) ];'],
    ['Tube Diameter Out Of Tolerance', 'XIC(Status.State[25])EQ(q_TubeFailureCode,13)[OTE(Alarm[16].Active) ,ONS(ONS.24) MOVE(1,Alarm[16].Severity) CONCAT(g_StationList[StaNum],AlarmList[16],Alarm[16].Message) ];'],
    ['Tube Ovality Out Of Tolerance', 'XIC(Status.State[25])EQ(q_TubeFailureCode,14)[OTE(Alarm[17].Active) ,ONS(ONS.25) MOVE(1,Alarm[17].Severity) CONCAT(g_StationList[StaNum],AlarmList[17],Alarm[17].Message) ];'],
    ['Waiting For Staging To Empty', 'XIC(Status.State[4])MOVE(10000,Control.FaultTime)XIC(Status.TimeoutFlt)XIO(StagingEmpty)[OTE(Alarm[18].Active) ,ONS(ONS.26) MOVE(1,Alarm[18].Severity) CONCAT(g_StationList[StaNum],AlarmList[18],Alarm[18].Message) ];'],
    ['Servo Alarm Handler', 'ProgramAlarmHandler(ServoFaultHandler,\\Alarms.p_ProgramID,ServoAlarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,ServoAlarmActive,ServoWarningActive);'],
    ['Station Alarm Handler', 'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,AlarmActive,WarningActive);'],
    ['Alarm/Warning Active Outputs', '[XIC(ServoAlarmActive) ,XIC(AlarmActive) ]OTE(q_AlarmActive);'],
    ['', '[XIC(ServoWarningActive) ,XIC(WarningActive) ]OTE(q_WarningActive);'],
  ];
  for (const t of ['CutterExtended', 'CutterRetracted', 'CutterMisconfigured', 'SelectorExtended', 'SelectorRetracted', 'SelectorMisconfigured', 'InserterRetracted']) tags.push(timerTag('AlarmTimer' + t, 5000, 'Alarm Timer'));
  return programXml(feedName(side), tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R04_FeedAxisServo', rungs: R04 }, { name: 'R20_Alarms', rungs: R20 }]);
}

// ═══ Dereeler program ═════════════════════════════════════════════════════
function dereelerProgram(side) {
  const C = SIDES[side], FD = '\\' + feedName(side);
  const IA = C.fdA + '_IN', OA = C.fdA + '_OUT', IB = C.fdB + '_IN', OB = C.fdB + '_OUT';
  const alarms = ['Payout A Drive Is Faulted', 'Payout B Drive Is Faulted', 'Waiting For Payout To Start', 'Waiting For Payout To Stop', 'Waiting For Dancer To Return', 'Spool A Is Empty', 'Spool B Is Empty'];
  const states = { 0: 'Safety Stop', 1: 'Manual Mode', 2: 'Auto Mode Idle Not Ready', 3: 'Auto Mode Idle Ready', 4: 'Wait For Dancer To Rise', 7: 'Run Payout', 10: 'Stop Payout', 13: 'Spool Empty', 99: 'Lockout', 100: 'Initialization', 124: 'Initialization Complete', 127: 'Fault' };
  const tags = [
    intTag('i_DancerA', 0, { usage: 'Input', desc: 'Dancer A Distance 0.1 mm' }), intTag('i_DancerB', 0, { usage: 'Input', desc: 'Dancer B Distance 0.1 mm' }),
    boolTag('q_SpoolAEmpty', { usage: 'Output', desc: 'Spool A Ran Out' }), boolTag('q_SpoolBEmpty', { usage: 'Output', desc: 'Spool B Ran Out' }),
    boolTag('q_AlarmActive', { usage: 'Output' }), boolTag('q_WarningActive', { usage: 'Output' }), boolTag('q_AutoMode', { usage: 'Output' }), boolTag('q_AutoStopped', { usage: 'Output' }), boolTag('q_StartOK', { usage: 'Output' }),
    realTag('p_CycleTime', 0, { usage: 'Public' }),
    copyTag(S03, 'Control', 'Control'), statusTag(states), copyTag(S03, 'StateEngine', 'StateEngine'), copyTag(S03, 'StateHistory', 'StateHistory'),
    alarmArrayTag('Alarm', PREFIX, alarms, 10), stringArrayTag('AlarmList', alarms, 10), copyTag(S03, 'ProgramFaultHandler', 'ProgramFaultHandler'),
    boolTag('AutoIdle'), boolTag('CycleRunning'), boolTag('CycleStopped'), boolTag('CycleStopping'), copyTag(S03, 'CycleTimer', 'CycleTimer'), boolTag('DryRun'), boolTag('FaultReset'), dintTag('FaultState', 0),
    boolTag('HMI_LocalManualOverride'), boolTag('Initialized'), boolTag('LocalSSONS'), boolTag('Lockout'), boolTag('ManualMode'), dintTag('ONS', 0), dintTag('RestartState', 0), boolTag('SafetyOK'), dintTag('SafetyStopState', 0),
    boolTag('SS'), boolTag('SS_OK'), dintTag('StaNum', 0), boolTag('UseRestartLogic'), boolTag('HMI_MomentaryOnPrevScan'),
    dintCommentTag('HMI_Momentary', [[0, 'Run Payout A'], [1, 'Stop Payout A'], [2, 'Run Payout B'], [3, 'Stop Payout B']]),
    boolTag('PayoutAManLatch'), boolTag('PayoutBManLatch'), boolTag('RunPayoutA'), boolTag('RunPayoutB'), boolTag('TubeInDrive'), boolTag('ActiveTubeB'), boolTag('ActiveSpoolEmpty'),
    realTag('DancerADistance', 0, { desc: 'Dancer A Distance mm' }), realTag('DancerBDistance', 0, { desc: 'Dancer B Distance mm' }), realTag('ActiveDancerDistance', 0, { desc: 'Active Dancer Distance mm' }),
    realTag('HMI_PayoutStartDistance', 100, { desc: 'Dancer Up Start Payout mm' }), realTag('HMI_PayoutStopDistance', 300, { desc: 'Dancer Down Stop Payout mm' }), realTag('HMI_SpoolEmptyDistance', 380, { desc: 'Dancer Bottomed Out mm' }),
    dintTag('HMI_PayoutSpeed', 30, { desc: 'Payout Speed Hz' }), dintTag('PayoutFrequency', 0, { desc: 'Payout Frequency 0.01 Hz' }),
    timerTag('AlarmTimerPayoutAFault', 1000, 'Alarm Timer'), timerTag('AlarmTimerPayoutBFault', 1000, 'Alarm Timer'),
  ];
  const OP = '\\L2_Tracking.p_Data.Station[StaNum].OpStatus.';
  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Station Number', 'MOVE(1,StaNum);'],
    ['Dancer arm distance, larger as the arm drops', 'DIV(i_DancerA,10.0,DancerADistance)DIV(i_DancerB,10.0,DancerBDistance);'],
    ['Active tube and spool follow the tube feed', 'XIC(' + FD + '.q_ActiveTubeB)OTE(ActiveTubeB);'],
    ['', 'XIC(' + FD + '.q_TubeInDrive)OTE(TubeInDrive);'],
    ['', '[XIO(ActiveTubeB) MOVE(DancerADistance,ActiveDancerDistance) ,XIC(ActiveTubeB) MOVE(DancerBDistance,ActiveDancerDistance) ];'],
    ['', '[XIO(ActiveTubeB) XIC(q_SpoolAEmpty) ,XIC(ActiveTubeB) XIC(q_SpoolBEmpty) ]OTE(ActiveSpoolEmpty);'],
    ['Logic inputs  *Replace always off bits with real conditions', 'XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);'],
    ['', 'XIC(\\Supervisor.q_AutoIdle)OTE(AutoIdle);'], ['', 'XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'], ['', 'XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'],
    ['', '[XIC(\\Supervisor.q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ,XIC(' + OP + 'SingleStepA) ]OTE(CycleRunning);'],
    ['', 'XIO(\\Supervisor.q_CycleStartLatch)XIO(HMI_LocalManualOverride)XIO(' + OP + 'SingleStepA)OTE(CycleStopping);'],
    ['', 'XIC(\\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);'],
    ['', 'XIC(g_MachineBasic.AlwaysOn)OTE(Initialized);'],
    ['Lockout', 'XIC(' + OP + 'LockoutA)XIO(ManualMode)OTE(Lockout);'],
    ['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + OP + 'DryRunA) ,XIC(g_HMI_DryRun) ]OTE(DryRun);'],
    ['Single Step Logic', 'XIC(' + OP + 'SingleStepA)OTE(SS);'],
    ['', '[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);'],
    ['Clear HMI Manual Triggers', 'XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);'], ['', 'NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'],
  ];
  const R02 = [
    ['Start Of State Machine', 'NOP();'],
    ['State 2: Auto mode idle not ready', '[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);'],
    ['State 3: Auto mode idle ready', '[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[10]) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);'],
    ['State 4: Wait for the dancer to rise as the feed pulls tube', '[[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[124]) ] ,XIC(Status.State[10]) XIO(' + IA + '.Active) XIO(' + IB + '.Active) ,XIC(Status.State[13]) XIO(TubeInDrive) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Run the active payout', 'XIC(Status.State[4])XIC(TubeInDrive)XIO(ActiveSpoolEmpty)LE(ActiveDancerDistance,HMI_PayoutStartDistance)XIC(SS_OK)MOVE(7,Control.StateReg);'],
    ['State 10: Stop the payout when the dancer is back down', 'XIC(Status.State[7])GE(ActiveDancerDistance,HMI_PayoutStopDistance)MOVE(10,Control.StateReg);'],
    ['State 13: Spool empty, the dancer bottomed out', '[XIC(Status.State[4]) ,XIC(Status.State[7]) ,XIC(Status.State[10]) ]XIC(TubeInDrive)GE(ActiveDancerDistance,HMI_SpoolEmptyDistance)MOVE(13,Control.StateReg);'],
    ['State 99: Lockout', 'XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);'],
    ['State 100:Start of initialization sequence, no action', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)MOVE(100,Control.StateReg);'],
    ['State 124: Initialization complete', 'XIC(Status.State[100])MOVE(124,Control.StateReg);'],
    ['Restart Logic  *Use the part status at this station to determine a course of action here.  For instance, no attempt made, no part present, no success or failure status at this station indicates initialization is in order. If an attempt was made with no success or failure, restart at last state may be in order. Also, you do not always need to go into the state you left. Some cases require you to go into the prior state to restart a particular portion of the sequence.', 'XIC(g_MachineBasic.AlwaysOff)XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)MOVE(RestartState,FaultState);'],
    ['State 127: Fault', 'XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];'],
    ['State 1: Manual Mode', 'XIC(ManualMode)MOVE(1,Control.StateReg);'],
    ['State 0: Safety Stop', '[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];'],
    ['', 'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'],
    ['Cycle Time  **Limit Instruction Low & High Limits Populated WIth Range Of States In Which Station Is Running (Example, PNP Is Picking & Placing A Part) **Cycle Complete State Shown As Example', '[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];'],
  ];
  const vfd = (letter, IN, OUT, latch, run, runBit, stopBit) => [
    ['Payout ' + letter + ' VFD Control', 'XIC(g_MachineBasic.AlwaysOn)[OTE(' + OUT + '.Forward) ,LIMIT(0,HMI_PayoutSpeed,60) CPT(PayoutFrequency,HMI_PayoutSpeed*100) MOVE(PayoutFrequency,' + OUT + '.FreqCommand) ];'],
    ['', 'XIC(' + IN + '.Faulted)XIC(FaultReset)OTE(' + OUT + '.ClearFaults);'],
    ['', 'XIC(Status.State[1])XIC(HMI_Momentary.' + runBit + ')OTL(' + latch + ');'],
    ['', 'XIC(' + latch + ')[XIC(HMI_Momentary.' + stopBit + ') ,XIO(Status.State[1]) ]OTU(' + latch + ');'],
    ['', '[XIC(Status.State[1]) XIC(' + latch + ') ,XIO(Status.State[1]) XIC(Status.State[7]) ' + (letter === 'A' ? 'XIO' : 'XIC') + '(ActiveTubeB) ]XIC(SafetyOK)OTE(' + run + ');'],
    ['', 'XIC(' + run + ')OTE(' + OUT + '.Start);'],
    ['', 'XIO(' + run + ')OTE(' + OUT + '.Stop);'],
  ];
  const R03 = [
    ['Output Status to Supervisor', 'XIC(' + IA + '.Ready)XIC(' + IB + '.Ready)XIO(' + OP + 'SingleStepA)OTE(q_StartOK);'],
    ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ]XIO(CycleRunning)OTE(q_AutoMode);'],
    ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ,XIC(Status.State[127]) ]XIO(CycleRunning)OTE(q_AutoStopped);'],
    ...vfd('A', IA, OA, 'PayoutAManLatch', 'RunPayoutA', 0, 1),
    ...vfd('B', IB, OB, 'PayoutBManLatch', 'RunPayoutB', 2, 3),
    ['Spool empty is held until a new tube is loaded at that staging position', '[XIC(Status.State[13]) XIO(ActiveTubeB) OTL(q_SpoolAEmpty) ,XIC(q_SpoolAEmpty) XIC(ActiveTubeB) XIC(' + FD + '.q_TubeALoaded) ONS(ONS.5) OTU(q_SpoolAEmpty) ];'],
    ['', '[XIC(Status.State[13]) XIC(ActiveTubeB) OTL(q_SpoolBEmpty) ,XIC(q_SpoolBEmpty) XIO(ActiveTubeB) XIC(' + FD + '.q_TubeBLoaded) ONS(ONS.6) OTU(q_SpoolBEmpty) ];'],
  ];
  const al = (i, comment, cond, warn) => [comment, '[' + cond + ' ,XIC(Alarm[' + i + '].Active) XIO(FaultReset) ][OTE(Alarm[' + i + '].Active) ,ONS(ONS.' + (8 + i) + ') ' + (warn ? 'MOVE(1,Alarm[' + i + '].Severity) ' : '') + 'CONCAT(g_StationList[StaNum],AlarmList[' + i + '],Alarm[' + i + '].Message) ];'];
  const R20 = [
    al(0, 'Payout A Drive Is Faulted', 'XIC(SafetyOK) XIC(' + IA + '.Faulted) TON(AlarmTimerPayoutAFault,?,?) XIC(AlarmTimerPayoutAFault.DN)'),
    al(1, 'Payout B Drive Is Faulted', 'XIC(SafetyOK) XIC(' + IB + '.Faulted) TON(AlarmTimerPayoutBFault,?,?) XIC(AlarmTimerPayoutBFault.DN)'),
    al(2, 'Waiting For Payout To Start', 'XIC(Status.State[7]) MOVE(3000,Control.FaultTime) XIC(Status.TimeoutFlt) [XIO(ActiveTubeB) XIO(' + IA + '.Active) ,XIC(ActiveTubeB) XIO(' + IB + '.Active) ]'),
    al(3, 'Waiting For Payout To Stop', 'XIC(Status.State[10]) MOVE(5000,Control.FaultTime) XIC(Status.TimeoutFlt)'),
    al(4, 'Waiting For Dancer To Return', 'XIC(Status.State[7]) MOVE(15000,Control.FaultTime) XIC(Status.TimeoutFlt) [XIO(ActiveTubeB) XIC(' + IA + '.Active) ,XIC(ActiveTubeB) XIC(' + IB + '.Active) ]'),
    ['Spool A Is Empty', 'XIC(q_SpoolAEmpty)[OTE(Alarm[5].Active) ,ONS(ONS.13) MOVE(1,Alarm[5].Severity) CONCAT(g_StationList[StaNum],AlarmList[5],Alarm[5].Message) ];'],
    ['Spool B Is Empty', 'XIC(q_SpoolBEmpty)[OTE(Alarm[6].Active) ,ONS(ONS.14) MOVE(1,Alarm[6].Severity) CONCAT(g_StationList[StaNum],AlarmList[6],Alarm[6].Message) ];'],
    ['', 'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);'],
  ];
  return programXml(dereelerName(side), tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R20_Alarms', rungs: R20 }]);
}

// ═══ 1. programs ══════════════════════════════════════════════════════════
const programs = [];
for (const side of ['Upstream', 'Downstream']) { programs.push([feedName(side), feedProgram(side)]); programs.push([dereelerName(side), dereelerProgram(side)]); }
for (const [n] of programs) must(!programBody(x, n), 'program already present: ' + n);
x = insertBefore(x, '</Programs>', programs.map((p) => p[1]).join('\n') + '\n', '</Programs>');
fs.mkdirSync(PROGDIR, { recursive: true });
for (const [n, body] of programs) fs.writeFileSync(path.join(PROGDIR, n + '.xml'), body);
log.push('programs: ' + programs.map((p) => p[0]).join(', '));

// ═══ 2. modules ═══════════════════════════════════════════════════════════
const mods = [];
// Kinetix 5300 drives (V5.3 sd02_ShotPin form) + axes (V5.3 a03 TLP form, 1117 HoseFeedServo scaling)
const sdTpl = moduleXml(v, 'sd02_ShotPin');
const axTpl = tagXml(v, 'a03_S01PNPXAxis') || fail('V5.3 a03_S01PNPXAxis');
const axes = [];
for (const side of ['Upstream', 'Downstream']) {
  const C = SIDES[side];
  mods.push(sdTpl.replace('Name="sd02_ShotPin"', 'Name="' + C.drive + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + C.driveIp + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'));
  let ax = axTpl.replace('<Tag Name="a03_S01PNPXAxis"', '<Tag Name="' + C.axis + '"').replace('MotionModule="sd03_S01PNPXAxis:Ch1"', 'MotionModule="' + C.drive + ':Ch1"');
  const setAttr = (k, val) => { must(new RegExp(' ' + k + '="[^"]*"').test(ax), 'axis attribute ' + k); ax = ax.replace(new RegExp(' ' + k + '="[^"]*"'), ' ' + k + '="' + val + '"'); };
  setAttr('ActuatorType', 'Belt and Pulley'); setAttr('TravelMode', 'Unlimited'); setAttr('TransmissionRatioInput', '20'); setAttr('TransmissionRatioOutput', '15');
  setAttr('ActuatorLead', '1.0'); setAttr('ActuatorDiameter', '50.927'); setAttr('MaximumSpeed', '10200.0'); setAttr('MaximumAcceleration', '1473265.0'); setAttr('MaximumDeceleration', '1473265.0');
  setAttr('MaximumAccelerationJerk', '425590416.0'); setAttr('MaximumDecelerationJerk', '425590416.0');
  axes.push(ax);
}
// PowerFlex 525 (1146 fd01_FFConv form) + buffer tags
const fdTpl = moduleXml(e, 'fd01_FFConv');
const fdIn = tagXml(e, 'fd01_FFConv_IN') || fail('1146 fd01_FFConv_IN'), fdOut = tagXml(e, 'fd01_FFConv_OUT') || fail('1146 fd01_FFConv_OUT');
const ctrlTags = [];
const fds = [];
for (const side of ['Upstream', 'Downstream']) for (const k of ['A', 'B']) {
  const C = SIDES[side], name = C['fd' + k], ip = C['fd' + k + 'Ip'];
  fds.push(name);
  mods.push(fdTpl.replace('Name="fd01_FFConv"', 'Name="' + name + '"').replace(/Address="10\.11\.46\.21"/, 'Address="' + ip + '"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'));
  ctrlTags.push(fdIn.replace('Name="fd01_FFConv_IN"', 'Name="' + name + '_IN"'));
  ctrlTags.push(fdOut.replace('Name="fd01_FFConv_OUT"', 'Name="' + name + '_OUT"').replace('[17,4200]', '[17,0]').replace(/(Name="FreqCommand"[^>]*Value=")4200(")/, '$10$2'));
}
// generic EtherNet/IP adapters (V5.3 vb01_MainMachine form): valve bank SINT 32/8 at 100/150, micrometer SINT 32/4 at 100/101
const genTpl = moduleXml(v, 'vb01_MainMachine');
function genericModule(name, ip, inB, outB, inCxn, outCxn) {
  let m = genTpl.replace('Name="vb01_MainMachine"', 'Name="' + name + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"');
  m = m.replace('PrimCxnInputSize="4"', 'PrimCxnInputSize="' + inB + '"').replace('PrimCxnOutputSize="4"', 'PrimCxnOutputSize="' + outB + '"');
  m = m.replace(/InputCxnPoint="100" OutputCxnPoint="150" OutputSize="4" InputSize="4"/, 'InputCxnPoint="' + inCxn + '" OutputCxnPoint="' + outCxn + '" OutputSize="' + outB + '" InputSize="' + inB + '"');
  m = m.replace('AB:ETHERNET_MODULE_SINT_4Bytes:I:0', 'AB:ETHERNET_MODULE_SINT_' + inB + 'Bytes:I:0').replace('AB:ETHERNET_MODULE_SINT_4Bytes:O:0', 'AB:ETHERNET_MODULE_SINT_' + outB + 'Bytes:O:0');
  must(m.includes('SINT_' + inB + 'Bytes:I:0') && m.includes('SINT_' + outB + 'Bytes:O:0') && m.includes('InputSize="' + inB + '"'), 'generic module sizes');
  return m;
}
mods.push(genericModule(VB, '10.1.60.40', 32, 8, 100, 150));
mods.push(genericModule(MM, '10.1.60.50', 32, 4, 100, 101));
ctrlTags.push(bufferTag(VB + '_IN', 'AB:ETHERNET_MODULE_SINT_32Bytes:I:0', 32), bufferTag(VB + '_OUT', 'AB:ETHERNET_MODULE_SINT_8Bytes:O:0', 8));
ctrlTags.push(bufferTag(MM + '_IN', 'AB:ETHERNET_MODULE_SINT_32Bytes:I:0', 32), bufferTag(MM + '_OUT', 'AB:ETHERNET_MODULE_SINT_4Bytes:O:0', 4));
ctrlTags.push(numArrayCtrlTag('vb01_DancerDistance', 'INT', 4), numArrayCtrlTag('mm01_L2S01MicrometerValue', 'DINT', 4));
x = insertBefore(x, '</Modules>', mods.join('\n') + '\n', '</Modules>');
log.push('modules: ' + mods.length + ' (2 Kinetix 5300, 4 PowerFlex 525, valve bank, micrometer)');

// controller tags: axes + buffers, before the controller </Tags>
{
  const m = /<\/Tags>\s*<Programs>/.exec(x) || fail('marker not found: controller tags end');
  x = x.slice(0, m.index) + axes.join('\n') + '\n' + ctrlTags.join('\n') + '\n' + x.slice(m.index);
}
log.push('controller tags: ' + (axes.length + ctrlTags.length));

// g_StationList[1] = the station prefix the alarm messages carry
{
  let gl = tagXml(x, 'g_StationList') || fail('g_StationList');
  const old = 'S01 Part Load: ', neu = PREFIX;
  must(gl.includes(old), 'g_StationList[1] text');
  gl = gl.replace('[' + old.length + ",'" + old + '$00'.repeat(82 - old.length) + "'", '[' + neu.length + ",'" + neu + '$00'.repeat(82 - neu.length) + "'");
  gl = gl.replace(new RegExp('(<Element Index="\\[1\\]">\\s*<Structure DataType="STRING">\\s*<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value=")' + old.length + '("/>\\s*<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\\s*<!\\[CDATA\\[\')' + old + '(\')'), '$1' + neu.length + '$2' + neu + '$3');
  must(countOf(gl, neu) === 2, 'g_StationList[1] replaced in L5K and Decorated');
  x = replaceTagIn(x, 'g_StationList', gl);
}

// ═══ 3. MapInputs / MapOutputs ════════════════════════════════════════════
editRoutine('MapInputs', 'R01_Logic', (r) => {
  must(r.length === 1 && rungText(r[0]) === 'NOP();', 'MapInputs R01 is the one NOP rung');
  return [
    newRung('Map Ethernet IP Inputs Using CPS Instruction - General Devices', '[CPS(' + VB + ':I,' + VB + '_IN,1) ,CPS(' + MM + ':I,' + MM + '_IN,1) ];'),
    newRung('Map Ethernet IP Inputs Using CPS Instruction - L2S01 Payout VFDs', '[' + fds.map((f) => 'CPS(' + f + ':I,' + f + '_IN,1)').join(' ,') + ' ];'),
    newRung('Dancer distances (IO-Link) and micrometer readings, one value per device', '[' + [9, 13, 17, 21].map((b, i) => 'COP(' + VB + '_IN.Data[' + b + '],vb01_DancerDistance[' + i + '],1)').join(' ,') + ' ,' + [4, 8, 12, 16].map((b, i) => 'COP(' + MM + '_IN.Data[' + b + '],mm01_L2S01MicrometerValue[' + i + '],1)').join(' ,') + ' ];'),
  ];
});
editRoutine('MapOutputs', 'R01_Logic', (r) => {
  must(r.length === 1 && rungText(r[0]) === 'NOP();', 'MapOutputs R01 is the one NOP rung');
  return [
    newRung('Map Ethernet IP Outputs Using CPS Instruction - General Devices', '[CPS(' + VB + '_OUT,' + VB + ':O,1) ,CPS(' + MM + '_OUT,' + MM + ':O,1) ];'),
    newRung('Map Ethernet IP Outputs Using CPS Instruction - L2S01 Payout VFDs', '[' + fds.map((f) => 'CPS(' + f + '_OUT,' + f + ':O,1)').join(' ,') + ' ];'),
  ];
});
log.push('MapInputs 3 rungs, MapOutputs 2 rungs');

// ═══ 4. Supervisor: polls, EIP monitor, EIP-loss alarms ═══════════════════
const newProgs = programs.map((p) => p[0]);
editRoutine('Supervisor', 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t === 'XIC(\\L2_S00_IndexerNoSP.q_AutoMode)OTE(AllSMInAuto);') return setRungText(rg, 'XIC(\\L2_S00_IndexerNoSP.q_AutoMode)' + newProgs.map((p) => 'XIC(\\' + p + '.q_AutoMode)').join('') + 'OTE(AllSMInAuto);');
  if (t === 'XIC(\\L2_S00_IndexerNoSP.q_AutoStopped)OTE(MachineStopped);') return setRungText(rg, 'XIC(\\L2_S00_IndexerNoSP.q_AutoStopped)' + newProgs.map((p) => 'XIC(\\' + p + '.q_AutoStopped)').join('') + 'OTE(MachineStopped);');
  if (t.startsWith('XIC(\\L2_S00_IndexerNoSP.q_StartOK)[')) return setRungText(rg, t.replace('XIC(\\L2_S00_IndexerNoSP.q_StartOK)', 'XIC(\\L2_S00_IndexerNoSP.q_StartOK)' + newProgs.map((p) => 'XIC(\\' + p + '.q_StartOK)').join('')));
  return rg;
}));
const eipNodes = [
  ['sd02_L2S01FeedUpstreamEIP', SIDES.Upstream.drive, 1, 'Loss Of L2S01 Upstream Feed Servo EIP'], ['sd03_L2S01FeedDownstreamEIP', SIDES.Downstream.drive, 2, 'Loss Of L2S01 Downstream Feed Servo EIP'],
  ['fd01_PayoutUpstreamAEIP', SIDES.Upstream.fdA, 3, 'Loss Of L2S01 Upstream Payout A VFD EIP'], ['fd02_PayoutUpstreamBEIP', SIDES.Upstream.fdB, 4, 'Loss Of L2S01 Upstream Payout B VFD EIP'],
  ['fd03_PayoutDownstreamAEIP', SIDES.Downstream.fdA, 5, 'Loss Of L2S01 Downstream Payout A VFD EIP'], ['fd04_PayoutDownstreamBEIP', SIDES.Downstream.fdB, 6, 'Loss Of L2S01 Downstream Payout B VFD EIP'],
  ['vb01_MainAssemblyEIP', VB, 8, 'Loss Of Main Assembly Valve Bank EIP'], ['mm01_L2S01MicrometerEIP', MM, 9, 'Loss Of L2S01 Micrometer EIP'],
];
editRoutine('Supervisor', 'R15_EIPMonitor', (r) => r.map((rg) => rungText(rg) === 'GE(EIPStatusCount,1)MOVE(0,EIPStatusCount);' ? setRungText(rg, 'GE(EIPStatusCount,9)MOVE(0,EIPStatusCount);') : rg));
must(/GE\(EIPStatusCount,9\)/.test(programBody(x, 'Supervisor')), 'EIP node count set to 9');
editRoutine('Supervisor', 'R20_Alarms', (r) => {
  must(rungText(r[0]).startsWith('[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,0) AOI_EIPStatus(sd01_IndexerEIP'), 'Supervisor R20 r0 is the indexer EIP rung');
  const add = eipNodes.map(([tag, mod, idx, msg], i) => newRung(msg.replace(' EIP', ' EIP Communications'), '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,' + (i + 1) + ') AOI_EIPStatus(' + tag + ',' + mod + ') XIO(' + tag + '.ComOK) ,XIC(Alarm[' + idx + '].Active) XIO(q_FaultReset) ]OTE(Alarm[' + idx + '].Active);'));
  return [r[0], ...add, ...r.slice(1)];
});
{
  let sup = programBody(x, 'Supervisor');
  const eipTpl = tagXml(sup, 'sd01_IndexerEIP') || fail('Supervisor sd01_IndexerEIP tag');
  const newTags = eipNodes.map(([tag]) => eipTpl.replace('Name="sd01_IndexerEIP"', 'Name="' + tag + '"')).join('\n');
  sup = sup.replace(eipTpl, eipTpl + '\n' + newTags);
  // alarm messages for the new EIP nodes (indices 1-6, 8, 9; 7 = batch counter)
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm tag');
  const l5kElems = [...al.matchAll(/\[0,0,0,0,\[\d+,'[^']*'\s*\],0,0,0,0\]/g)].map((m) => m[0]);
  must(l5kElems.length === 15, 'Supervisor Alarm L5K has 15 elements: ' + l5kElems.length);
  const setMsg = (idx, msg) => {
    al = al.replace(l5kElems[idx], '[0,0,0,0,' + l5kStr(msg, 100) + ',0,0,0,0]');
    const re = new RegExp('(<Element Index="\\[' + idx + '\\]">\\s*<Structure DataType="AlarmData">[\\s\\S]*?<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value=")\\d+("/>\\s*<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII">\\s*<!\\[CDATA\\[)[^\\]]*(\\]\\]>)');
    must(re.test(al), 'Supervisor Alarm decorated element ' + idx);
    al = al.replace(re, '$1' + msg.length + "$2'" + msg + "'$3");
  };
  for (const [, , idx, msg] of eipNodes) setMsg(idx, msg + ' Communications');
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
}
log.push('Supervisor: 4 programs polled, 8 EIP-loss alarms, node count 9');

// ═══ 5. Alarms roll-up ════════════════════════════════════════════════════
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t === 'XIO(\\Supervisor.q_AlarmActive)XIO(\\L2_S00_IndexerNoSP.q_AlarmActive)OTE(p_NoMachineFaults);') return setRungText(rg, 'XIO(\\Supervisor.q_AlarmActive)XIO(\\L2_S00_IndexerNoSP.q_AlarmActive)' + newProgs.map((p) => 'XIO(\\' + p + '.q_AlarmActive)').join('') + 'OTE(p_NoMachineFaults);');
  if (t === 'XIO(\\Supervisor.q_WarningActive)XIO(\\L2_S00_IndexerNoSP.q_WarningActive)OTE(p_NoMachineWarnings);') return setRungText(rg, 'XIO(\\Supervisor.q_WarningActive)XIO(\\L2_S00_IndexerNoSP.q_WarningActive)' + newProgs.map((p) => 'XIO(\\' + p + '.q_WarningActive)').join('') + 'OTE(p_NoMachineWarnings);');
  return rg;
}));
must(countOf(programBody(x, 'Alarms'), 'L2_S01_TubeFeedUpstream.q_AlarmActive') === 1, 'Alarms roll-up');

// ═══ 6. schedule ══════════════════════════════════════════════════════════
x = insertAfter(x, '<ScheduledProgram Name="L2_S00_IndexerNoSP"/>', '\n' + newProgs.map((p) => '<ScheduledProgram Name="' + p + '"/>').join('\n'), 'MainTask schedule');

// ═══ 7. parameter connections ═════════════════════════════════════════════
const pcs = [];
const bit = ([b, i]) => '.Data[' + b + '].' + i;
for (const side of ['Upstream', 'Downstream']) {
  const C = SIDES[side], F = '\\' + feedName(side), D = '\\' + dereelerName(side);
  pcs.push([F + '.iq_FeedAxis', C.axis]);
  for (const [param, key] of [['i_CutterExtended', 'cutterExt'], ['i_CutterRetracted', 'cutterRet'], ['i_SelectorExtended', 'selExt'], ['i_SelectorRetracted', 'selRet'], ['i_InserterRetracted', 'insRet'], ['i_TubeAInDrive', 'tubeAInDrive'], ['i_TubeBInDrive', 'tubeBInDrive'], ['i_TubeALoaded', 'tubeALoaded'], ['i_TubeBLoaded', 'tubeBLoaded']]) pcs.push([VB + '_IN' + bit(C.in[key]), F + '.' + param]);
  for (const [param, key] of [['q_ExtendCutter', 'cutterExt'], ['q_RetractCutter', 'cutterRet'], ['q_ExtendSelector', 'selExt'], ['q_RetractSelector', 'selRet'], ['q_ExtendInserter', 'insExt'], ['q_RetractInserter', 'insRet'], ['q_CloseTubeAGripper', 'gripAClose'], ['q_OpenTubeAGripper', 'gripAOpen'], ['q_CloseTubeBGripper', 'gripBClose'], ['q_OpenTubeBGripper', 'gripBOpen']]) pcs.push([F + '.' + param, VB + '_OUT' + bit(C.out[key])]);
  pcs.push(['HSC1:I.PresentValue[' + C.hsc + ']', F + '.i_EncoderCount']);
  pcs.push([F + '.q_ResetEncoder', 'HSC1:O.ResetCounter.' + C.hsc]);
  pcs.push(['mm01_L2S01MicrometerValue[' + C.micX + ']', F + '.i_MicrometerX']);
  pcs.push(['mm01_L2S01MicrometerValue[' + C.micY + ']', F + '.i_MicrometerY']);
  pcs.push(['vb01_DancerDistance[' + C.dancerA + ']', D + '.i_DancerA']);
  pcs.push(['vb01_DancerDistance[' + C.dancerB + ']', D + '.i_DancerB']);
}
x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
log.push('parameter connections: ' + pcs.length);

// ═══ 8. export header + write ═════════════════════════════════════════════
const NOW = new Date();
const stamp = NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + stamp + '"');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, x);
// tasks block for the shape checker
const tasks = (/<Tasks>[\s\S]*?<\/Tasks>/.exec(x) || [''])[0];
fs.mkdirSync(path.join(PROGDIR, '..', 'controller'), { recursive: true });
fs.writeFileSync(path.join(PROGDIR, '..', 'controller', 'Tasks.xml'), tasks);
console.log('wrote ' + OUT + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);
