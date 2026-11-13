#!/usr/bin/env node
'use strict';
/**
 * build1163S6.cjs — 1163 v0.12: L2S6-L2S9 (EE / EH) Epson tube insert stations on the v0.11 stamp.
 *
 *   node scripts/build1163S6.cjs [--dry]
 *
 *   Three programs per station (Jason, 2026-11-12): L2_S0n_InsertRobot (Epson LS4-C SCARA + tube nest opener + load cell, Station[n] tracking on
 *   its nest side), L2_S0n_SoftCapGripper (cap nest opener, gripper Z, gripper - runs in parallel with the robot), L2_S0n_Dispenser (DST503 on VB5's
 *   DMPF). S6 downstream nest, S7 upstream, S8 downstream, S9 upstream; S6 / S7 gate on Station[4] and the soft cap record Station[16].
 *   Hardware: rob03-rob06 (IP tab .65 / .67 / .69 / .71, V5.4 rob03_EpsonPNP form, Epson UDTs + AOI_Epson_IN / OUT carried from V5.4),
 *   vb05_MainAssembly (.92, in 12 / out 6). Then gates, deliver, stamp. Cover note: scripts/coverNote1163S6.cjs.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, newRung, programBody, getRoutine, putRungs, tagXml, replaceTagIn, insertBefore, countOf, rep1, guid, moduleXml, l5kStr, strElemDec, alarmElemL5K, alarmElemDec } = H;
const ROBOT = require('./lib/s6/robot.cjs');
const GRIP = require('./lib/s6/gripper.cjs');
const DISP = require('./lib/s6/dispenser.cjs');

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H_ = D + '/_history';
const BASE = H_ + '/1163_Haemonetics_v0.11_2026-11-12.L5X';
const V54 = path.join(ROOT, 'plc-reference/training-material/SDC Standard Templates/SoftwareStandardization.L5X');
const M = '1163_Haemonetics';
const VERSION = (() => { const i = process.argv.indexOf('--version'); return i >= 0 ? process.argv[i + 1] : '0.12'; })();   // --version 0.13gen: re-run the generator with Jason's v0.13 corrections to check it against his file
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const SUBNET = '10.68.167.';
const log = [];
const base = fs.readFileSync(BASE, 'utf8');
let x = base;
const v = fs.readFileSync(V54, 'utf8');
const S01 = programBody(x, 'L2_S01_TubeFeedUpstream') || fail('L2_S01_TubeFeedUpstream');
const TRK = programBody(x, 'L2_Tracking') || fail('L2_Tracking');
const IDXB = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00_IndexerNoSP');
const S05 = programBody(v, 'S05_ServoPNP') || fail('V5.4 S05_ServoPNP');
const S08 = programBody(v, 'S08_EpsonRobotPNP') || fail('V5.4 S08_EpsonRobotPNP');
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); const m = H.progRe(prog).exec(x); x = x.slice(0, m.index) + b + x.slice(m.index + m[0].length); };
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const sn = (n) => 'L2S' + String(n).padStart(2, '0');

// ═══ the four stations (Master Electrical BOM I/O ASSIGNMENT, IP tab, VB5 valve order; Jason's answers 2026-11-12) ═══
// sensors: [soft cap nest opener retracted, tube nest opener retracted, gripper Z retracted] as VB5 [byte, bit]; lc: load cell AXA bytes; dmpf: DMPF in / out byte + nibble;
// coilByte: the station's four valves (st 4n-3 .. 4n): A coil = bit 2k, B = 2k+1 for valve k = 0 soft cap nest opener, 1 tube nest opener, 2 gripper Z, 3 gripper
const STATIONS = [
  { sta: 6, ab: 'B', side: 'Downstream', pre: 4, capGate: 16, robot: 'rob03_L2S06Robot', ip: '65', sensors: [[0, 0], [0, 1], [0, 2]], lc: [2, 3], dmpf: { inByte: 10, outByte: 0, nib: 0 }, coilByte: 2 },
  { sta: 7, ab: 'A', side: 'Upstream', pre: 4, capGate: 16, robot: 'rob04_L2S07Robot', ip: '67', sensors: [[0, 3], [0, 4], [0, 5]], lc: [4, 5], dmpf: { inByte: 10, outByte: 0, nib: 4 }, coilByte: 3 },
  { sta: 8, ab: 'B', side: 'Downstream', pre: 6, capGate: 0, robot: 'rob05_L2S08Robot', ip: '69', sensors: [[0, 6], [0, 7], [1, 0]], lc: [6, 7], dmpf: { inByte: 11, outByte: 1, nib: 0 }, coilByte: 4 },
  { sta: 9, ab: 'A', side: 'Upstream', pre: 7, capGate: 0, robot: 'rob06_L2S09Robot', ip: '71', sensors: [[1, 1], [1, 2], [1, 3]], lc: [8, 9], dmpf: { inByte: 11, outByte: 1, nib: 4 }, coilByte: 5 },
];
for (const c of STATIONS) { c.prefix = sn(c.sta) + ' Tube Insert: '; c.robotProg = 'L2_S0' + c.sta + '_InsertRobot'; c.gripperProg = 'L2_S0' + c.sta + '_SoftCapGripper'; c.dispenserProg = 'L2_S0' + c.sta + '_Dispenser'; c.eip = 'Loss Of ' + sn(c.sta) + ' Robot EIP'; }
const VB6 = 'vb06_MainAssembly', VB = 'vb05_MainAssembly', VB_IP = '92', VB_IN = 12, VB_OUT = 6, VB_EIP = 'Loss Of VB5 Valve Bank EIP';
const IN = (byte, bit) => VB + '_IN.Data[' + byte + '].' + bit, OUT = (byte, bit) => VB + '_OUT.Data[' + byte + '].' + bit;

// ═══ 1. programs ═════════════════════════════════════════════════════════════
const progs = [];
for (const cfg of STATIONS) {
  const r = ROBOT.build({ S01, S05, S08, TRK, IDXB, cfg }), g = GRIP.build({ S01, cfg }), d = DISP.build({ S01, cfg });
  must(r.PROG === cfg.robotProg && g.PROG === cfg.gripperProg && d.PROG === cfg.dispenserProg, 'program names ' + cfg.sta);
  progs.push([r.PROG, r.xml, cfg], [g.PROG, g.xml, cfg], [d.PROG, d.xml, cfg]);
}
fs.mkdirSync(PROGDIR, { recursive: true });
for (const [name, xml] of progs) {
  must(!programBody(x, name), 'program already present: ' + name);
  x = insertBefore(x, '</Programs>', xml + '\n', '</Programs>');
  fs.writeFileSync(path.join(PROGDIR, name + '.xml'), xml);
  log.push('program ' + name + ': ' + rungList(xml).length + ' rungs, ' + (xml.match(/<Tag Name=/g) || []).length + ' tags');
}
const NEW = progs.map(([n]) => n);
// proof: the four stations are one build - every program equal to its S6 twin once names, numbers and the nest side are normalized
{
  const norm = (s, c) => s.split('L2_S0' + c.sta + '_').join('L2_S0#_').split(sn(c.sta) + ' ').join('L2S0# ')
    .replace('MOVE(' + c.sta + ',StaNum)', 'MOVE(#,StaNum)').replace('MOVE(' + c.pre + ',StaNumPre)', 'MOVE(#,StaNumPre)')
    .replace(/(NestNum|Lockout|DryRun|SingleStep|SingleCycle|SingleTrigger|SingleDisableTracking|SingleClearTracking|Attempts|Successes|Failures|Efficiency|HMIColorStatus)[AB]\b/g, '$1#')
    .replace('Station[' + (c.sta - 1) + '].NestNum#,NestNumIncoming', 'Station[#].NestNum#,NestNumIncoming')
    .replace(new RegExp('(MOVE\\(|FailureType,)' + c.sta + '([1-4])(?=[,)])', 'g'), '$1#$2')
    .replace(/ \[XIC\(\\L2_Tracking\.p_Data\.Nest\[NestNumCurrent\]\.PartStatus\.Station\[16\]\.Success\) ,XIC\(\\L2_Tracking\.p_Data\.Nest\[NestNumCurrent\]\.PartStatus\.Station\[16\]\.Lockout\) \]/g, '').replace(' and the soft cap record', '');
  for (const kind of ['InsertRobot', 'SoftCapGripper', 'Dispenser']) {
    const ref = norm(progs.find(([n]) => n === 'L2_S06_' + kind)[1], STATIONS[0]);
    for (const c of STATIONS.slice(1)) must(norm(progs.find(([n]) => n === 'L2_S0' + c.sta + '_' + kind)[1], c) === ref, kind + ' ' + c.sta + ' differs from S6 beyond names and points');
  }
  log.push('S7 / S8 / S9 programs identical to S6 except names, station numbers, nest side and failure codes');
}

// ═══ 2. Epson types from V5.4 (first robot in the job) ══════════════════════
{
  const udt = (n) => (new RegExp('<DataType Name="' + n + '"[^>]*>[\\s\\S]*?</DataType>').exec(v) || [null])[0] || fail('V5.4 UDT ' + n);
  const aoi = (n) => (new RegExp('<AddOnInstructionDefinition [^>]*Name="' + n + '"[^>]*>[\\s\\S]*?</AddOnInstructionDefinition>').exec(v) || [null])[0] || fail('V5.4 AOI ' + n);
  must(!/Epson_Robot_Status|AOI_Epson_IN/.test(base), 'Epson types absent in the base');
  x = insertBefore(x, '</DataTypes>', udt('Epson_Robot_Control') + '\n' + udt('Epson_Robot_Status') + '\n', '</DataTypes>');
  x = insertBefore(x, '</AddOnInstructionDefinitions>', aoi('AOI_Epson_IN') + '\n' + aoi('AOI_Epson_OUT') + '\n', '</AddOnInstructionDefinitions>');
  log.push('types: Epson_Robot_Status / Epson_Robot_Control UDTs, AOI_Epson_IN / AOI_Epson_OUT (V5.4)');
}

// ═══ 3. modules + controller tags ════════════════════════════════════════════
{
  const mods = [], tags = [];
  const cloneTag = (src, from, to) => { const t = tagXml(src, from) || fail('tag ' + from); return t.replace('<Tag Name="' + from + '"', '<Tag Name="' + to + '"'); };
  // robots: V5.4 rob03_EpsonPNP (generic ETHERNET-MODULE, in 100 / out 150, 32 INT, config 1 size 0) and its four controller tags
  const robTpl = moduleXml(v, 'rob03_EpsonPNP');
  must(/InputCxnPoint="100" OutputCxnPoint="150" OutputSize="64" InputSize="64"/.test(robTpl) && /ConfigSize="0"/.test(robTpl), 'V5.4 rob03 connection 100 / 150, 64 / 64, config 0');
  for (const c of STATIONS) {
    mods.push(robTpl.split('rob03_EpsonPNP').join(c.robot).replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + SUBNET + c.ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'));
    tags.push(cloneTag(v, 'rob03_EpsonPNPStatus', c.robot + 'Status'), cloneTag(v, 'rob03_EpsonPNPControl', c.robot + 'Control'), cloneTag(v, 'EpsonPNPInputs', 'Epson' + sn(c.sta) + 'Inputs'), cloneTag(v, 'EpsonPNPOutputs', 'Epson' + sn(c.sta) + 'Outputs'));
  }
  // VB5: vb06 (EX600-SEN7 generic SINT, in 10 / out 8) cloned and resized to in 12 / out 6
  const elems = (n) => Array.from({ length: n }, (_, i) => '<Element Index="[' + i + ']" Value="0"/>').join('\n');
  const resize = (block, n) => block
    .replace(/<Data Format="L5K">\s*<!\[CDATA\[\[\[[0-9,\s]*\]\]\]\]>\s*<\/Data>/, '<Data Format="L5K">\n<![CDATA[[[' + Array(n).fill('0').join(',') + ']]]]>\n</Data>')
    .replace(/<ArrayMember Name="Data" DataType="SINT" Dimensions="\d+" Radix="Decimal">[\s\S]*?<\/ArrayMember>/, '<ArrayMember Name="Data" DataType="SINT" Dimensions="' + n + '" Radix="Decimal">\n' + elems(n) + '\n</ArrayMember>');
  const TI = 'AB:ETHERNET_MODULE_SINT_' + VB_IN + 'Bytes:I:0', TO = 'AB:ETHERNET_MODULE_SINT_' + VB_OUT + 'Bytes:O:0';
  let m = moduleXml(x, VB6);
  const sz = /PrimCxnInputSize="(\d+)" PrimCxnOutputSize="(\d+)"/.exec(m) || fail('vb06 sizes');
  const OLD_IN = +sz[1], OLD_OUT = +sz[2];        // 8 / 8 as Jason set them in Studio (v0.7.4 return)
  const oldTI = 'AB:ETHERNET_MODULE_SINT_' + OLD_IN + 'Bytes:I:0', oldTO = 'AB:ETHERNET_MODULE_SINT_' + OLD_OUT + 'Bytes:O:0';
  must(countOf(m, VB6) === 1 && m.includes('OutputSize="' + OLD_OUT + '" InputSize="' + OLD_IN + '"') && m.includes(oldTI) && m.includes(oldTO), 'vb06 form (in ' + OLD_IN + ' / out ' + OLD_OUT + ')');
  m = m.split(VB6).join(VB).replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + SUBNET + VB_IP + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"');
  m = m.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>/, '<Description>\n<![CDATA[EX600 with (2) 8 Point Digital Input, (2) Analog Input, (2) Digital I/O Modules ]]>\n</Description>');
  m = rep1(m, 'PrimCxnInputSize="' + OLD_IN + '" PrimCxnOutputSize="' + OLD_OUT + '"', 'PrimCxnInputSize="' + VB_IN + '" PrimCxnOutputSize="' + VB_OUT + '"', 'vb05 primary sizes');
  m = rep1(m, 'OutputSize="' + OLD_OUT + '" InputSize="' + OLD_IN + '"', 'OutputSize="' + VB_OUT + '" InputSize="' + VB_IN + '"', 'vb05 connection sizes');
  m = m.split(oldTI).join(TI).split(oldTO).join(TO);
  m = m.replace(/<InputTag[\s\S]*?<\/InputTag>/, (s) => resize(s, VB_IN)).replace(/<OutputTag[\s\S]*?<\/OutputTag>/, (s) => resize(s, VB_OUT));
  must(countOf(m, 'Dimensions="' + VB_IN + '"') === 1 && countOf(m, 'Dimensions="' + VB_OUT + '"') === 1 && !m.includes('Dimensions="' + OLD_IN + '"') && !m.includes('Dimensions="' + OLD_OUT + '"') && !/SINT_8Bytes/.test(m), 'vb05 data arrays resized');
  mods.push(m);
  const vbIn = resize(cloneTag(x, VB6 + '_IN', VB + '_IN').split(oldTI).join(TI), VB_IN);
  const vbOut = resize(cloneTag(x, VB6 + '_OUT', VB + '_OUT').split(oldTO).join(TO), VB_OUT);
  for (const [t, n] of [[vbIn, VB_IN], [vbOut, VB_OUT]]) must(countOf(t, '<Element Index=') === n && countOf(t, 'Bytes:') === 2 && (/\[\[([0-9,]*)\]\]/.exec(t)[1].split(',').length === n), 'vb05 buffer tag ' + n + ' bytes');
  tags.push(vbIn, vbOut);
  for (const t of tags) must(!tagXml(x, /<Tag Name="([^"]+)"/.exec(t)[1]), 'controller tag free: ' + /<Tag Name="([^"]+)"/.exec(t)[1]);
  x = insertBefore(x, '</Modules>', mods.join('\n') + '\n', '</Modules>');
  const last = tagXml(x, VB6 + '_OUT') || fail(VB6 + '_OUT');
  x = x.replace(last, last + '\n' + tags.join('\n'));
  log.push('modules: ' + STATIONS.map((c) => c.robot + ' (.' + c.ip + ')').join(', ') + ', ' + VB + ' (.' + VB_IP + ', in ' + VB_IN + ' / out ' + VB_OUT + '); ' + tags.length + ' controller tags');
}

// ═══ 4. g_L2StationList[6..9] ════════════════════════════════════════════════
{
  const gl = tagXml(x, 'g_L2StationList') || fail('g_L2StationList');
  const names = [...gl.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[2] || '');
  must(names.length === 17 && names[4] === 'L2S04 Spike And Cap: ' && STATIONS.every((c) => names[c.sta] === ''), 'g_L2StationList elements');
  for (const c of STATIONS) names[c.sta] = c.prefix;
  const head = gl.slice(0, gl.indexOf('<Data Format="L5K">'));
  x = replaceTagIn(x, 'g_L2StationList', head + '<Data Format="L5K">\n<![CDATA[[' + names.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="17">\n' + names.map((s, i) => strElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>');
}

// ═══ 5. MapInputs / MapOutputs: VB5 CPS in the general rung, one AOI_Epson rung per robot (V5.4 form) ═══
for (const [prog, dir] of [['MapInputs', 'Inputs'], ['MapOutputs', 'Outputs']]) editRoutine(prog, 'R01_Logic', (r) => {
  const cps = (mod) => dir === 'Inputs' ? 'CPS(' + mod + ':I,' + mod + '_IN,1)' : 'CPS(' + mod + '_OUT,' + mod + ':O,1)';
  const g = r.findIndex((rg) => rungText(rg).includes(cps(VB6)));
  must(g >= 0, prog + ' general rung');
  r[g] = setRungText(r[g], rep1(rungText(r[g]), ',' + cps(VB6), ',' + cps(VB) + ' ,' + cps(VB6), prog + ' general devices'));
  const robots = STATIONS.map((c) => newRung('Map Ethernet IP ' + dir + ' - ' + sn(c.sta) + ' Robot', dir === 'Inputs'
    ? 'AOI_Epson_IN(Epson' + sn(c.sta) + 'Inputs,' + c.robot + ':I,' + c.robot + 'Status);'
    : 'AOI_Epson_OUT(Epson' + sn(c.sta) + 'Outputs,' + c.robot + ':O,' + c.robot + 'Control);'));
  return [...r, ...robots];
});

// ═══ 6. indexer, supervisor, alarms, schedule ════════════════════════════════
const S10 = 'L2_S10_BlueTubeCoiler', PNP4 = 'L2_S04_SpikePNP';
editRoutine('L2_S00_IndexerNoSP', 'R01_Inputs', (r) => {
  must(rungText(r[2]).includes('XIC(\\' + PNP4 + '.q_StationComplete)XIC(\\' + S10 + '.q_StationComplete)ONS(ONS.6)'), 'indexer r2');
  must(rungText(r[3]) === 'XIC(\\' + PNP4 + '.q_ActuatorsSafe)XIC(\\' + S10 + '.q_ActuatorsSafe)OTE(ActuatorsSafe);', 'indexer r3');
  must(rungText(r[4]) === '[XIC(\\' + PNP4 + '.q_Pause) MOVE(4,PauseReason) ,XIC(\\' + S10 + '.q_Pause) MOVE(10,PauseReason) ]OTE(Pause);', 'indexer r4');
  r[2] = setRungText(r[2], rungText(r[2]).replace('XIC(\\' + S10 + '.q_StationComplete)', STATIONS.map((c) => 'XIC(\\' + c.robotProg + '.q_StationComplete)').join('') + 'XIC(\\' + S10 + '.q_StationComplete)'));
  r[3] = setRungText(r[3], 'XIC(\\' + PNP4 + '.q_ActuatorsSafe)' + STATIONS.map((c) => 'XIC(\\' + c.robotProg + '.q_ActuatorsSafe)XIC(\\' + c.gripperProg + '.q_ActuatorsSafe)').join('') + 'XIC(\\' + S10 + '.q_ActuatorsSafe)OTE(ActuatorsSafe);');
  r[4] = setRungText(r[4], '[XIC(\\' + PNP4 + '.q_Pause) MOVE(4,PauseReason) ,' + STATIONS.map((c) => 'XIC(\\' + c.robotProg + '.q_Pause) MOVE(' + c.sta + ',PauseReason)').join(' ,') + ' ,XIC(\\' + S10 + '.q_Pause) MOVE(10,PauseReason) ]OTE(Pause);');
  return r;
});
editRoutine('L2_S00_IndexerNoSP', 'R03_StateLogic', (r) => {
  must(r.length === 8 && rungText(r[7]).includes('StationCompleteTimes[4]'), 'L2_S00 R03');
  const used = new Set([...programBody(x, 'L2_S00_IndexerNoSP').matchAll(/ONS\(ONS\.(\d+)\)/g)].map((m) => +m[1]));
  const bits = [24, 25, 26, 27];
  for (const b of bits) must(!used.has(b), 'indexer ONS.' + b + ' free');
  return [...r, ...STATIONS.map((c, i) => newRung('Record Ok To Index For Each Station', 'XIC(\\' + c.robotProg + '.q_StationComplete)ONS(ONS.' + bits[i] + ')DIV(CycleTimer.ACC,1000,StationCompleteTimes[' + c.sta + ']);'))];
});
editRoutine('Supervisor', 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (/OTE\(AllSMInAuto\);$/.test(t)) return setRungText(rg, t.replace('OTE(AllSMInAuto);', NEW.map((n) => 'XIC(\\' + n + '.q_AutoMode)').join('') + 'OTE(AllSMInAuto);'));
  if (/OTE\(MachineStopped\);$/.test(t)) return setRungText(rg, t.replace('OTE(MachineStopped);', NEW.map((n) => 'XIC(\\' + n + '.q_AutoStopped)').join('') + 'OTE(MachineStopped);'));
  if (t.includes('XIC(\\' + S10 + '.q_StartOK)')) return setRungText(rg, rep1(t, 'XIC(\\' + S10 + '.q_StartOK)', 'XIC(\\' + S10 + '.q_StartOK)' + NEW.map((n) => 'XIC(\\' + n + '.q_StartOK)').join(''), 'Supervisor StartOK'));
  return rg;
}));
for (const n of NEW) must(countOf(programBody(x, 'Supervisor'), '\\' + n + '.q_') === 3, 'Supervisor polls ' + n + ' three times');
const eipNodes = [...STATIONS.map((c) => [c.robot + 'EIP', c.robot, c.eip]), [VB + 'EIP', VB, VB_EIP]];
const NODE0 = 28, ALARM0 = 29, ALARM_N = 35;
editRoutine('Supervisor', 'R15_EIPMonitor', (r) => r.map((rg) => rungText(rg) === 'GE(EIPStatusCount,' + NODE0 + ')MOVE(0,EIPStatusCount);' ? setRungText(rg, 'GE(EIPStatusCount,' + (NODE0 + eipNodes.length) + ')MOVE(0,EIPStatusCount);') : rg));
must(programBody(x, 'Supervisor').includes('GE(EIPStatusCount,' + (NODE0 + eipNodes.length) + ')'), 'EIP node count ' + (NODE0 + eipNodes.length));
editRoutine('Supervisor', 'R20_Alarms', (r) => {
  const i = r.findIndex((rg) => rungText(rg).includes('EQ(EIPStatusCount,' + (NODE0 - 1) + ') AOI_EIPStatus('));
  must(i > 0 && !r.some((rg) => rungText(rg).includes('EQ(EIPStatusCount,' + NODE0 + ')')), 'Supervisor R20 last EIP rung');
  const add = eipNodes.map(([tag, mod, msg], j) => newRung(msg + ' Communications', '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,' + (NODE0 + j) + ') AOI_EIPStatus(' + tag + ',' + mod + ') XIO(' + tag + '.ComOK) ,XIC(Alarm[' + (ALARM0 + j) + '].Active) XIO(q_FaultReset) ]OTE(Alarm[' + (ALARM0 + j) + '].Active);'));
  return [...r.slice(0, i + 1), ...add, ...r.slice(i + 1)];
});
{
  let sup = programBody(x, 'Supervisor');
  const eipTpl = tagXml(sup, 'sd01_IndexerEIP') || fail('Supervisor sd01_IndexerEIP');
  for (const [tag] of eipNodes) must(!tagXml(sup, tag), 'Supervisor tag free: ' + tag);
  sup = sup.replace(eipTpl, eipTpl + '\n' + eipNodes.map(([tag]) => eipTpl.replace('Name="sd01_IndexerEIP"', 'Name="' + tag + '"')).join('\n'));
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm');
  must(al.includes('Dimensions="30"'), 'Supervisor Alarm[30]');
  const oldDec = [...al.matchAll(/<Element Index="\[\d+\]">[\s\S]*?<\/Element>/g)].map((m) => m[0]);
  must(oldDec.length === 30, 'Supervisor Alarm decorated elements');
  const msgs = Array.from({ length: ALARM_N }, (_, i) => i < 30 ? (/<!\[CDATA\['([^']*)'\]\]>/.exec(oldDec[i]) || [, ''])[1] : '');
  eipNodes.forEach(([, , msg], j) => { must(msgs[ALARM0 + j] === '', 'Supervisor Alarm[' + (ALARM0 + j) + '] free'); msgs[ALARM0 + j] = msg + ' Communications'; });
  const head = al.slice(0, al.indexOf('<Data Format="L5K">')).replace('Dimensions="30"', 'Dimensions="' + ALARM_N + '"');
  al = head + '<Data Format="L5K">\n<![CDATA[[' + msgs.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + ALARM_N + '">\n' + msgs.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
  log.push('Supervisor: twelve programs polled, ' + eipNodes.length + ' EIP-loss alarms (' + ALARM0 + '-' + (ALARM0 + eipNodes.length - 1) + '), Alarm[' + ALARM_N + '], node count ' + (NODE0 + eipNodes.length));
}
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t.endsWith('OTE(p_NoMachineFaults);')) return setRungText(rg, t.replace('OTE(p_NoMachineFaults);', NEW.map((n) => 'XIO(\\' + n + '.q_AlarmActive)').join('') + 'OTE(p_NoMachineFaults);'));
  if (t.endsWith('OTE(p_NoMachineWarnings);')) return setRungText(rg, t.replace('OTE(p_NoMachineWarnings);', NEW.map((n) => 'XIO(\\' + n + '.q_WarningActive)').join('') + 'OTE(p_NoMachineWarnings);'));
  return rg;
}));
for (const n of NEW) must(countOf(programBody(x, 'Alarms'), '\\' + n + '.q_') === 2, 'Alarms roll-up ' + n);
x = insertBefore(x, '<ScheduledProgram Name="' + S10 + '"/>', NEW.map((n) => '<ScheduledProgram Name="' + n + '"/>\n').join(''), 'MainTask schedule');

// ═══ 7. parameter connections ════════════════════════════════════════════════
const pcs = [];
for (const c of STATIONS) {
  const R_ = '\\' + c.robotProg + '.', G_ = '\\' + c.gripperProg + '.', D_ = '\\' + c.dispenserProg + '.';
  const coil = (k, b) => OUT(c.coilByte, 2 * k + b);
  pcs.push([c.robot + 'Status', R_ + 'i_RobotStatus'], [R_ + 'q_RobotControl', c.robot + 'Control']);
  pcs.push([IN(...c.sensors[1]), R_ + 'i_TubeNestOpenerRetracted'], [VB + '_IN.Data[' + c.lc[0] + ']', R_ + 'i_LoadCellByte0'], [VB + '_IN.Data[' + c.lc[1] + ']', R_ + 'i_LoadCellByte1'],
    [R_ + 'q_ExtendTubeNestOpener', coil(1, 0)], [R_ + 'q_RetractTubeNestOpener', coil(1, 1)]);
  pcs.push([IN(...c.sensors[0]), G_ + 'i_SoftCapNestOpenerRetracted'], [IN(...c.sensors[2]), G_ + 'i_SoftCapGripperZRetracted'],
    [G_ + 'q_ExtendSoftCapNestOpener', coil(0, 0)], [G_ + 'q_RetractSoftCapNestOpener', coil(0, 1)], [G_ + 'q_ExtendSoftCapGripperZ', coil(2, 0)], [G_ + 'q_RetractSoftCapGripperZ', coil(2, 1)],
    [G_ + 'q_CloseSoftCapGripper', coil(3, 0)], [G_ + 'q_OpenSoftCapGripper', coil(3, 1)]);
  const o = c.dmpf.nib;
  pcs.push([D_ + 'q_AdapterBit0', OUT(c.dmpf.outByte, o)], [D_ + 'q_AdapterBit1', OUT(c.dmpf.outByte, o + 1)], [D_ + 'q_DispenserStart', OUT(c.dmpf.outByte, o + 2)], [D_ + 'q_DispenserReset', OUT(c.dmpf.outByte, o + 3)],
    [IN(c.dmpf.inByte, o), D_ + 'i_AdapterBit0'], [IN(c.dmpf.inByte, o + 1), D_ + 'i_AdapterBit1'], [IN(c.dmpf.inByte, o + 2), D_ + 'i_DispenserReady'], [IN(c.dmpf.inByte, o + 3), D_ + 'i_DispenserAlarmOK']);
}
{
  const ends = pcs.flat();
  must(new Set(ends).size === ends.length, 'duplicate endpoint');
  for (const e of ends) must(!x.includes('EndPoint1="' + e + '"') && !x.includes('EndPoint2="' + e + '"'), 'endpoint already connected: ' + e);
  for (const e of ends) { const root = e.startsWith('\\') ? null : e.split(/[.[]/)[0]; if (root) must(countOf(x, '<Tag Name="' + root + '"') === 1, 'endpoint tag exists: ' + root); }
  for (const e of ends.filter((s) => s.startsWith('\\'))) { const [, p, t] = /^\\([^.]+)\.(.+)$/.exec(e); must(tagXml(programBody(x, p) || '', t), 'program tag exists: ' + e); }
  x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
  log.push('parameter connections: ' + pcs.length);
}

// ═══ 8. proof: every other program stays as stamped ══════════════════════════
{
  const EDITED = new Set(['Supervisor', 'Alarms', 'MapInputs', 'MapOutputs', 'L2_S00_IndexerNoSP']);
  const names = [...base.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) if (!EDITED.has(n)) must(programBody(x, n) === programBody(base, n), 'program changed: ' + n);
  for (const n of [VB6 + '_IN', VB6 + '_OUT', 'g_L1StationList']) must(tagXml(x, n) === tagXml(base, n), 'tag changed: ' + n);
  for (const n of [VB6, 'vb01_MainAssembly', 'sd01_L2Indexer']) must(moduleXml(x, n) === moduleXml(base, n), 'module changed: ' + n);
  log.push('untouched: ' + (names.length - EDITED.size) + ' programs byte-identical to the stamp');
}

// ═══ 9. write + gates ════════════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
for (const n of NEW) must(countOf(x, '<Program Name="' + n + '"') === 1 && countOf(x, '<ScheduledProgram Name="' + n + '"/>') === 1, n + ' scheduled once');
for (const c of STATIONS) must(countOf(x, '<Module Name="' + c.robot + '"') === 1 && countOf(x, '<Tag Name="' + c.robot + 'Status"') === 1, c.robot);
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.mkdirSync(path.join(PROGDIR, '..', 'controller'), { recursive: true });
fs.writeFileSync(path.join(PROGDIR, '..', 'controller', 'Tasks.xml'), (/<Tasks>[\s\S]*?<\/Tasks>/.exec(x) || [''])[0]);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);

const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', ...NEW.map((n) => path.join(PROGDIR, n + '.xml'))]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-30).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict) || process.argv.includes('--verbose')) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW|warn/i.test(l)).slice(0, 80).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');
if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 10. deliver + stamp ═════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION + ' (cover note: node scripts/coverNote1163S6.cjs)');
