#!/usr/bin/env node
'use strict';
/**
 * build1163S12.cjs — 1163 v0.15: L2S12 / L2S13 Y site tube insert stations on the v0.14 stamp.
 *
 *   node scripts/build1163S12.cjs [--dry]
 *
 *   The L2S6 build (Jason's v0.13 S06 form) with the gripper cut to locate-only: the Y site stays in its nest, the gripper closes on it for the
 *   insertion and opens before Z lifts (Jason, 2026-11-13). Three programs per station: L2_S1n_InsertRobot (Epson LS4-C SCARA + tube nest opener
 *   + load cell, Station[n] tracking on its nest side, the clear tube into the Y site), L2_S1n_YSiteGripper (gripper Z, gripper), L2_S1n_Dispenser
 *   (DST503 on VB6's DMPF). S12 downstream nest (B), S13 upstream (A); both gate on Station[11]. Hardware: rob07 / rob08 (IP tab .73 / .75, the
 *   rob03 form), VB6 as shipped (in 8 / out 8): DXPC2 1.2-1.5 sensors, AXA bytes 2-5 load cells, DMPF in 6 / out 2, DYPE out 0-1 (Jason, 2026-11-13).
 *   Then gates, deliver, stamp. Cover note: scripts/coverNote1163S12.cjs.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, newRung, programBody, getRoutine, putRungs, tagXml, replaceTagIn, insertBefore, countOf, rep1, guid, moduleXml, l5kStr, strElemDec, alarmElemL5K, alarmElemDec } = H;
const ROBOT = require('./lib/s6/robot.cjs');
const GRIP = require('./lib/s12/gripper.cjs');
const DISP = require('./lib/s6/dispenser.cjs');

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H_ = D + '/_history';
const BASE = H_ + '/1163_Haemonetics_v0.14_2026-11-13.L5X';
const V53 = path.join(ROOT, 'plc-reference/training-material/SDC Standard Templates/SoftwareStandardization.L5X');
const M = '1163_Haemonetics';
const VERSION = (() => { const i = process.argv.indexOf('--version'); return i >= 0 ? process.argv[i + 1] : '0.15'; })();
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const SUBNET = '10.68.167.';
const log = [];
const base = fs.readFileSync(BASE, 'utf8');
let x = base;
const v = fs.readFileSync(V53, 'utf8');
const S01 = programBody(x, 'L2_S01_TubeFeedUpstream') || fail('L2_S01_TubeFeedUpstream');
const TRK = programBody(x, 'L2_Tracking') || fail('L2_Tracking');
const IDXB = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00_IndexerNoSP');
const S05 = programBody(v, 'S05_ServoPNP') || fail('V5.3 S05_ServoPNP');
const S08 = programBody(v, 'S08_EpsonRobotPNP') || fail('V5.3 S08_EpsonRobotPNP');
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); const m = H.progRe(prog).exec(x); x = x.slice(0, m.index) + b + x.slice(m.index + m[0].length); };
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const sn = (n) => 'L2S' + String(n).padStart(2, '0');

// ═══ the two stations (Master Electrical BOM I/O ASSIGNMENT Nov 13, IP tab, VB6 valve order; Jason's answers 2026-11-13) ═══
// sensors: [tube nest opener retracted, gripper Z retracted] as VB6 [byte, bit]; lc: load cell AXA bytes; dmpf: DMPF in / out byte + nibble;
// dype: first DYPE output bit of the station's three valves (tube nest opener, gripper Z, gripper), two bits each: A = extend / close, B = retract / open
const YSITE = { tag: 'YSite', words: 'Y Site', sentence: 'Y site', gripper: 'Y site gripper', clear: 'p_RobotClearOfYSite', clearDesc: 'Robot Clear Of Y Site',
  insertedDesc: 'Insert Done, Release Y Site', wait: 'Tube out of the dispenser, wait for the Y site located in the gripper' };
const STATIONS = [
  { sta: 12, ab: 'B', side: 'Downstream', pre: 11, capGate: 0, robot: 'rob07_L2S12Robot', ip: '73', sensors: [[1, 2], [1, 3]], lc: [2, 3], dmpf: { inByte: 6, outByte: 2, nib: 0 }, dype: 0 },
  { sta: 13, ab: 'A', side: 'Upstream', pre: 11, capGate: 0, robot: 'rob08_L2S13Robot', ip: '75', sensors: [[1, 4], [1, 5]], lc: [4, 5], dmpf: { inByte: 6, outByte: 2, nib: 4 }, dype: 6 },
];
for (const c of STATIONS) { c.prefix = sn(c.sta) + ' Y Site Insert: '; c.robotProg = 'L2_S' + c.sta + '_InsertRobot'; c.gripperProg = 'L2_S' + c.sta + '_YSiteGripper'; c.dispenserProg = 'L2_S' + c.sta + '_Dispenser'; c.eip = 'Loss Of ' + sn(c.sta) + ' Robot EIP'; c.held = YSITE; }
const VB = 'vb06_MainAssembly', VB_IN = 8, VB_OUT = 8;
const IN = (byte, bit) => VB + '_IN.Data[' + byte + '].' + bit, OUT = (byte, bit) => VB + '_OUT.Data[' + byte + '].' + bit;
const dypeBit = (c, k, b) => { const n = c.dype + 2 * k + b; return OUT(n >> 3, n & 7); };
{
  const m = moduleXml(x, VB);
  must(m.includes('PrimCxnInputSize="' + VB_IN + '" PrimCxnOutputSize="' + VB_OUT + '"'), 'vb06 in ' + VB_IN + ' / out ' + VB_OUT + ' as shipped');
  must(countOf(tagXml(x, VB + '_IN'), '<Element Index=') === VB_IN && countOf(tagXml(x, VB + '_OUT'), '<Element Index=') === VB_OUT, 'vb06 buffers');
}

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
  must(!/Soft ?Cap|soft cap|SoftCap/.test(xml), name + ' carries no soft cap words');
  x = insertBefore(x, '</Programs>', xml + '\n', '</Programs>');
  fs.writeFileSync(path.join(PROGDIR, name + '.xml'), xml);
  log.push('program ' + name + ': ' + rungList(xml).length + ' rungs, ' + (xml.match(/<Tag Name=/g) || []).length + ' tags');
}
const NEW = progs.map(([n]) => n);
// proof 1: S13 equals S12 once names, numbers, the nest side and the failure codes are normalized
{
  const norm = (s, c) => s.split('L2_S' + c.sta + '_').join('L2_S##_').split(sn(c.sta) + ' ').join('L2S## ')
    .replace('MOVE(' + c.sta + ',StaNum)', 'MOVE(#,StaNum)').replace('Station[' + (c.sta - 1) + '].NestNum', 'Station[#].NestNum')
    .replace(/(NestNum|Lockout|DryRun|SingleStep|SingleCycle|SingleTrigger|SingleDisableTracking|SingleClearTracking|Attempts|Successes|Failures|Efficiency|HMIColorStatus)[AB]\b/g, '$1#')
    .replace(new RegExp('MOVE\\(' + c.sta + '([1-4]),\\\\L2_Tracking', 'g'), 'MOVE(#$1,\\L2_Tracking').replace(new RegExp('FailureType,' + c.sta + '([1-4])\\)', 'g'), 'FailureType,#$1)');
  for (const kind of ['InsertRobot', 'YSiteGripper', 'Dispenser']) {
    const ref = norm(progs.find(([n]) => n === 'L2_S12_' + kind)[1], STATIONS[0]);
    must(norm(progs.find(([n]) => n === 'L2_S13_' + kind)[1], STATIONS[1]) === ref, kind + ' 13 differs from S12 beyond names and points');
  }
  log.push('S13 programs identical to S12 except names, station number, nest side and failure codes');
}
// proof 2: the robot and dispenser programs are the shipped S06 forms (Jason's v0.13, a Studio export) once the station, the nest gate and the
// Y site words are normalized - compared as content (tags, descriptions, operand comments, strings, rung comments, rung text), not as XML
{
  const shape = (body) => {
    const tags = [...body.matchAll(/<Tag Name="([^"]+)"[^>]*?DataType="([^"]+)"([^>]*?)>/g)].map((m) => 'TAG ' + m[1] + ' ' + m[2] + (/Dimensions="(\d+)"/.exec(m[3]) ? ' [' + /Dimensions="(\d+)"/.exec(m[3])[1] + ']' : '') + (/Usage="(\w+)"/.exec(m[3]) ? ' ' + /Usage="(\w+)"/.exec(m[3])[1] : ''));
    const descs = [...body.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => 'DESC ' + m[1].trim());
    const ops = [...body.matchAll(/<Comment Operand="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => 'OP ' + m[1] + ' ' + m[2].trim());
    const strs = [...body.matchAll(/\[\d+,'([^']*?)(?:\$00)*'/g)].map((m) => 'STR ' + m[1]);
    const timers = [...body.matchAll(/<Tag Name="([^"]+)"[^>]*DataType="TIMER"[\s\S]*?Name="PRE"[^>]*Value="(\d+)"/g)].map((m) => 'PRE ' + m[1] + ' ' + m[2]);
    const rungs = [];
    for (const r of body.matchAll(/<Routine Name="([^"]+)"[\s\S]*?<\/Routine>/g)) for (const rg of rungList(r[0])) rungs.push('RUNG ' + r[1] + ' | ' + ((/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(rg) || [, ''])[1]).replace(/\s+/g, ' ').trim() + ' | ' + rungText(rg));
    const srt = (a) => a.slice().sort(); return [...srt(tags), ...srt(descs), ...srt(ops), ...srt(strs), ...srt(timers), ...rungs].join('\n');
  };
  const normS = (s, c) => s.split('L2_S' + String(c.sta).padStart(2, '0') + '_').join('L2_S##_').split(sn(c.sta) + ' ').join('L2S## ')
    .replace('MOVE(' + c.sta + ',StaNum) MOVE(' + c.pre + ',StaNumPre)', 'MOVE(#,StaNum) MOVE(#,StaNumPre)').split('MOVE(' + c.sta + ',StaNum)').join('MOVE(#,StaNum)').replace('Station[' + (c.sta - 1) + '].NestNum', 'Station[#].NestNum')
    .replace(/(NestNum|Lockout|DryRun|SingleStep|SingleCycle|SingleTrigger|SingleDisableTracking|SingleClearTracking|Attempts|Successes|Failures|Efficiency|HMIColorStatus)[AB]\b/g, '$1#')
    .replace(new RegExp('MOVE\\(' + c.sta + '([1-4]),\\\\L2_Tracking', 'g'), 'MOVE(#$1,\\L2_Tracking').replace(new RegExp('FailureType,' + c.sta + '([1-4])\\)', 'g'), 'FailureType,#$1)')
    .replace(/ \[XIC\(\\L2_Tracking\.p_Data\.Nest\[NestNumCurrent\]\.PartStatus\.Station\[16\]\.Success\) ,XIC\(\\L2_Tracking\.p_Data\.Nest\[NestNumCurrent\]\.PartStatus\.Station\[16\]\.Lockout\) \]/g, '').replace(' and the soft cap record', '')
    .split('SoftCapGripper').join('##Gripper').split('YSiteGripper').join('##Gripper').split('SoftCap').join('##').split('YSite').join('##')
    .split('Soft Cap').join('##').split('Y Site').join('##').split('Soft cap').join('##').split('Y site').join('##').split('soft cap').join('##')
    .split('p_RobotClearOfCap').join('p_RobotClearOf##').split('Insert Done, Place The Cap').join('Insert Done, #').split('Insert Done, Release ##').join('Insert Done, #')
    .replace('wait for the ## in the funnel gripper', 'wait for the ##').replace('wait for the ## located in the gripper', 'wait for the ##')
    .split(' Tube Insert: ').join(' ## Insert: ')
    // State_Engine_128Max 5.1 is applied to the assembled file by applyStateEngine.cjs, after this proof
    .replace('TAG StateDurationHistory DINT [10]\n', '').replace(',StateHistory,StateDurationHistory)', ',StateHistory)');
  const s06 = programBody(x, 'L2_S06_InsertRobot') || fail('L2_S06_InsertRobot'), d06 = programBody(x, 'L2_S06_Dispenser') || fail('L2_S06_Dispenser');
  const c06 = { sta: 6, pre: 4 };
  const r12 = progs.find(([n]) => n === 'L2_S12_InsertRobot')[1], d12 = progs.find(([n]) => n === 'L2_S12_Dispenser')[1];
  const cmp = (what, A, B) => {
    const order = (s) => { const ls = s.split('\n'); return [...ls.filter((l) => !l.startsWith('RUNG')).sort(), ...ls.filter((l) => l.startsWith('RUNG')).map((l) => l.replace(/\s+/g, ''))]; };
    const a = order(normS(shape(A), c06)), b = order(normS(shape(B), STATIONS[0]));
    const i = a.findIndex((l, k) => l !== b[k]);
    if (i >= 0 || a.length !== b.length) fail(what + ' differs from Jason\'s S06 beyond names and points at line ' + (i + 1) + ':\n  S06: ' + (a[i] || '(end)') + '\n  S12: ' + (b[i] || '(end)'));
    return a.length;
  };
  const n1 = cmp('L2_S12_InsertRobot', s06, r12), n2 = cmp('L2_S12_Dispenser', d06, d12);
  log.push('S12 robot and dispenser programs identical to Jason\'s S06 (v0.13) in every tag, description, operand comment, string, preset, rung comment and rung (' + n1 + ' + ' + n2 + ' lines) except names, station numbers, the nest gate and the Y site words');
}

// ═══ 2. modules + controller tags (the rob03 form already in the file) ══════
{
  must(/Epson_Robot_Status|AOI_Epson_IN/.test(base), 'Epson types present in the base');
  const mods = [], tags = [];
  const cloneTag = (src, from, to) => { const t = tagXml(src, from) || fail('tag ' + from); return t.replace('<Tag Name="' + from + '"', '<Tag Name="' + to + '"'); };
  const robTpl = moduleXml(x, 'rob03_L2S06Robot');
  must(/InputCxnPoint="100" OutputCxnPoint="150" OutputSize="64" InputSize="64"/.test(robTpl) && /ConfigSize="0"/.test(robTpl) && /Address="10\.68\.167\.65"/.test(robTpl), 'rob03 form');
  for (const c of STATIONS) {
    mods.push(robTpl.split('rob03_L2S06Robot').join(c.robot).replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + SUBNET + c.ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'));
    tags.push(cloneTag(x, 'rob03_L2S06RobotStatus', c.robot + 'Status'), cloneTag(x, 'rob03_L2S06RobotControl', c.robot + 'Control'), cloneTag(x, 'EpsonL2S06Inputs', 'Epson' + sn(c.sta) + 'Inputs'), cloneTag(x, 'EpsonL2S06Outputs', 'Epson' + sn(c.sta) + 'Outputs'));
  }
  for (const m of mods) must(!/rob03|L2S06/.test(m), 'module renamed through');
  for (const t of tags) must(!/rob03|L2S06/.test(t) && !tagXml(x, /<Tag Name="([^"]+)"/.exec(t)[1]), 'controller tag free and renamed: ' + /<Tag Name="([^"]+)"/.exec(t)[1]);
  x = insertBefore(x, '</Modules>', mods.join('\n') + '\n', '</Modules>');
  const last = tagXml(x, 'EpsonL2S09Outputs') || fail('EpsonL2S09Outputs');
  x = x.replace(last, last + '\n' + tags.join('\n'));
  log.push('modules: ' + STATIONS.map((c) => c.robot + ' (.' + c.ip + ')').join(', ') + '; ' + tags.length + ' controller tags; VB6 untouched (in ' + VB_IN + ' / out ' + VB_OUT + ')');
}

// ═══ 3. g_L2StationList[12], [13] ════════════════════════════════════════════
{
  const gl = tagXml(x, 'g_L2StationList') || fail('g_L2StationList');
  const names = [...gl.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[2] || '');
  must(names.length === 17 && names[6] === 'L2S06 Tube Insert: ' && names[12] === 'S12 Good Unload: ' && names[13] === '', 'g_L2StationList elements (12 still carries the template name)');
  for (const c of STATIONS) names[c.sta] = c.prefix;
  const head = gl.slice(0, gl.indexOf('<Data Format="L5K">'));
  x = replaceTagIn(x, 'g_L2StationList', head + '<Data Format="L5K">\n<![CDATA[[' + names.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="17">\n' + names.map((s, i) => strElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>');
}

// ═══ 4. MapInputs / MapOutputs: one AOI_Epson rung per robot (V5.3 form) ═════
for (const [prog, dir] of [['MapInputs', 'Inputs'], ['MapOutputs', 'Outputs']]) editRoutine(prog, 'R01_Logic', (r) => {
  must(r.some((rg) => rungText(rg).includes('rob06_L2S09Robot')) && !r.some((rg) => rungText(rg).includes('rob07')), prog + ' robot rungs');
  const robots = STATIONS.map((c) => newRung('Map Ethernet IP ' + dir + ' - ' + sn(c.sta) + ' Robot', dir === 'Inputs'
    ? 'AOI_Epson_IN(Epson' + sn(c.sta) + 'Inputs,' + c.robot + ':I,' + c.robot + 'Status);'
    : 'AOI_Epson_OUT(Epson' + sn(c.sta) + 'Outputs,' + c.robot + ':O,' + c.robot + 'Control);'));
  return [...r, ...robots];
});

// ═══ 5. indexer, supervisor, alarms, schedule ════════════════════════════════
const S10 = 'L2_S10_BlueTubeCoiler', S9R = 'L2_S09_InsertRobot', S9G = 'L2_S09_SoftCapGripper';
editRoutine('L2_S00_IndexerNoSP', 'R01_Inputs', (r) => {
  must(rungText(r[2]).includes('XIC(\\' + S9R + '.q_StationComplete)XIC(\\' + S10 + '.q_StationComplete)ONS(ONS.6)'), 'indexer r2');
  must(rungText(r[3]).includes('XIC(\\' + S9G + '.q_ActuatorsSafe)XIC(\\' + S10 + '.q_ActuatorsSafe)OTE(ActuatorsSafe);'), 'indexer r3');
  must(rungText(r[4]).includes('XIC(\\' + S9R + '.q_Pause) MOVE(9,PauseReason) ,XIC(\\' + S10 + '.q_Pause) MOVE(10,PauseReason) ]OTE(Pause);'), 'indexer r4');
  r[2] = setRungText(r[2], rep1(rungText(r[2]), 'XIC(\\' + S10 + '.q_StationComplete)', 'XIC(\\' + S10 + '.q_StationComplete)' + STATIONS.map((c) => 'XIC(\\' + c.robotProg + '.q_StationComplete)').join(''), 'indexer r2 edit'));
  r[3] = setRungText(r[3], rep1(rungText(r[3]), 'XIC(\\' + S10 + '.q_ActuatorsSafe)', 'XIC(\\' + S10 + '.q_ActuatorsSafe)' + STATIONS.map((c) => 'XIC(\\' + c.robotProg + '.q_ActuatorsSafe)XIC(\\' + c.gripperProg + '.q_ActuatorsSafe)').join(''), 'indexer r3 edit'));
  r[4] = setRungText(r[4], rep1(rungText(r[4]), 'MOVE(10,PauseReason) ]', 'MOVE(10,PauseReason)' + STATIONS.map((c) => ' ,XIC(\\' + c.robotProg + '.q_Pause) MOVE(' + c.sta + ',PauseReason)').join('') + ' ]', 'indexer r4 edit'));
  return r;
});
editRoutine('L2_S00_IndexerNoSP', 'R03_StateLogic', (r) => {
  must(r.length === 12 && rungText(r[11]).includes('StationCompleteTimes[9]'), 'L2_S00 R03');
  must(/Dimensions="17"/.test(tagXml(programBody(x, 'L2_S00_IndexerNoSP'), 'StationCompleteTimes')), 'StationCompleteTimes[17]');
  const used = new Set([...programBody(x, 'L2_S00_IndexerNoSP').matchAll(/ONS\(ONS\.(\d+)\)/g)].map((m) => +m[1]));
  const bits = [28, 29];
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
const eipNodes = STATIONS.map((c) => [c.robot + 'EIP', c.robot, c.eip]);
const NODE0 = 33, ALARM0 = 34, ALARM_N = 37;
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
  const eipTpl = tagXml(sup, 'rob06_L2S09RobotEIP') || fail('Supervisor rob06_L2S09RobotEIP');
  for (const [tag] of eipNodes) must(!tagXml(sup, tag), 'Supervisor tag free: ' + tag);
  sup = sup.replace(eipTpl, eipTpl + '\n' + eipNodes.map(([tag]) => eipTpl.replace('Name="rob06_L2S09RobotEIP"', 'Name="' + tag + '"')).join('\n'));
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm');
  must(al.includes('Dimensions="35"'), 'Supervisor Alarm[35]');
  const oldDec = [...al.matchAll(/<Element Index="\[\d+\]">[\s\S]*?<\/Element>/g)].map((m) => m[0]);
  must(oldDec.length === 35, 'Supervisor Alarm decorated elements');
  const msgs = Array.from({ length: ALARM_N }, (_, i) => i < 35 ? (/<!\[CDATA\['([^']*)'\]\]>/.exec(oldDec[i]) || [, ''])[1] : '');
  eipNodes.forEach(([, , msg], j) => { must(msgs[ALARM0 + j] === '', 'Supervisor Alarm[' + (ALARM0 + j) + '] free'); msgs[ALARM0 + j] = msg + ' Communications'; });
  const head = al.slice(0, al.indexOf('<Data Format="L5K">')).replace('Dimensions="35"', 'Dimensions="' + ALARM_N + '"');
  al = head + '<Data Format="L5K">\n<![CDATA[[' + msgs.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + ALARM_N + '">\n' + msgs.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
  log.push('Supervisor: six more programs polled, ' + eipNodes.length + ' EIP-loss alarms (' + ALARM0 + '-' + (ALARM0 + eipNodes.length - 1) + '), Alarm[' + ALARM_N + '], node count ' + (NODE0 + eipNodes.length));
}
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t.endsWith('OTE(p_NoMachineFaults);')) return setRungText(rg, t.replace('OTE(p_NoMachineFaults);', NEW.map((n) => 'XIO(\\' + n + '.q_AlarmActive)').join('') + 'OTE(p_NoMachineFaults);'));
  if (t.endsWith('OTE(p_NoMachineWarnings);')) return setRungText(rg, t.replace('OTE(p_NoMachineWarnings);', NEW.map((n) => 'XIO(\\' + n + '.q_WarningActive)').join('') + 'OTE(p_NoMachineWarnings);'));
  return rg;
}));
for (const n of NEW) must(countOf(programBody(x, 'Alarms'), '\\' + n + '.q_') === 2, 'Alarms roll-up ' + n);
x = insertBefore(x, '<ScheduledProgram Name="Production"/>', NEW.map((n) => '<ScheduledProgram Name="' + n + '"/>\n').join(''), 'MainTask schedule');

// ═══ 6. parameter connections ════════════════════════════════════════════════
const pcs = [];
for (const c of STATIONS) {
  const R_ = '\\' + c.robotProg + '.', G_ = '\\' + c.gripperProg + '.', D_ = '\\' + c.dispenserProg + '.';
  pcs.push([c.robot + 'Status', R_ + 'i_RobotStatus'], [R_ + 'q_RobotControl', c.robot + 'Control']);
  pcs.push([IN(...c.sensors[0]), R_ + 'i_TubeNestOpenerRetracted'], [VB + '_IN.Data[' + c.lc[0] + ']', R_ + 'i_LoadCellByte0'], [VB + '_IN.Data[' + c.lc[1] + ']', R_ + 'i_LoadCellByte1'],
    [R_ + 'q_ExtendTubeNestOpener', dypeBit(c, 0, 0)], [R_ + 'q_RetractTubeNestOpener', dypeBit(c, 0, 1)]);
  pcs.push([IN(...c.sensors[1]), G_ + 'i_YSiteGripperZRetracted'],
    [G_ + 'q_ExtendYSiteGripperZ', dypeBit(c, 1, 0)], [G_ + 'q_RetractYSiteGripperZ', dypeBit(c, 1, 1)], [G_ + 'q_CloseYSiteGripper', dypeBit(c, 2, 0)], [G_ + 'q_OpenYSiteGripper', dypeBit(c, 2, 1)]);
  const o = c.dmpf.nib;
  pcs.push([D_ + 'q_AdapterBit0', OUT(c.dmpf.outByte, o)], [D_ + 'q_AdapterBit1', OUT(c.dmpf.outByte, o + 1)], [D_ + 'q_DispenserStart', OUT(c.dmpf.outByte, o + 2)], [D_ + 'q_DispenserReset', OUT(c.dmpf.outByte, o + 3)],
    [IN(c.dmpf.inByte, o), D_ + 'i_AdapterBit0'], [IN(c.dmpf.inByte, o + 1), D_ + 'i_AdapterBit1'], [IN(c.dmpf.inByte, o + 2), D_ + 'i_DispenserReady'], [IN(c.dmpf.inByte, o + 3), D_ + 'i_DispenserAlarmOK']);
}
{
  must(dypeBit(STATIONS[1], 0, 0) === OUT(0, 6) && dypeBit(STATIONS[1], 1, 0) === OUT(1, 0) && dypeBit(STATIONS[1], 2, 1) === OUT(1, 3), 'S13 DYPE bits 0.6-1.3');
  const ends = pcs.flat();
  must(new Set(ends).size === ends.length, 'duplicate endpoint');
  for (const e of ends) must(!x.includes('EndPoint1="' + e + '"') && !x.includes('EndPoint2="' + e + '"'), 'endpoint already connected: ' + e);
  for (const e of ends) { const root = e.startsWith('\\') ? null : e.split(/[.[]/)[0]; if (root) must(countOf(x, '<Tag Name="' + root + '"') === 1, 'endpoint tag exists: ' + root); }
  for (const e of ends.filter((s) => s.startsWith('\\'))) { const [, p, t] = /^\\([^.]+)\.(.+)$/.exec(e); must(tagXml(programBody(x, p) || '', t), 'program tag exists: ' + e); }
  x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
  log.push('parameter connections: ' + pcs.length + ' (VB6 in 1.2-1.5, 2-5, 6.0-6.7; out 0.0-1.3, 2.0-2.7)');
}

// ═══ 7. proof: every other program stays as stamped ══════════════════════════
{
  const EDITED = new Set(['Supervisor', 'Alarms', 'MapInputs', 'MapOutputs', 'L2_S00_IndexerNoSP']);
  const names = [...base.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) if (!EDITED.has(n)) must(programBody(x, n) === programBody(base, n), 'program changed: ' + n);
  for (const n of [VB + '_IN', VB + '_OUT', 'vb05_MainAssembly_IN', 'g_L1StationList', 'rob03_L2S06RobotStatus']) must(tagXml(x, n) === tagXml(base, n), 'tag changed: ' + n);
  for (const n of [VB, 'vb05_MainAssembly', 'rob03_L2S06Robot', 'sd01_L2Indexer']) must(moduleXml(x, n) === moduleXml(base, n), 'module changed: ' + n);
  log.push('untouched: ' + (names.length - EDITED.size) + ' programs byte-identical to the stamp');
}

// ═══ 8. write + gates ════════════════════════════════════════════════════════
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

// ═══ 9. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION + ' (cover note: node scripts/coverNote1163S12.cjs)');
