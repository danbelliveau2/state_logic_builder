#!/usr/bin/env node
'use strict';
/**
 * build1163S14.cjs — 1163 v0.17: L2S14 (EL) Clear Tube Coiler on the v0.16 stamp.
 *
 *   node scripts/build1163S14.cjs [--dry]
 *
 *   L2S14 performs the same function as L2S10 on its own devices (Jason, 2026-11-16): the stamped L2_S10_BlueTubeCoiler (his Studio
 *   lineage) is cloned to L2_S14_ClearTubeCoiler with StaNum 14 / StaNumPre 13, FailureType 141 and the L2S14 alarm prefix; its five
 *   drives and axes come from the Master Electrical IP tab (sd16-sd20 / a16-a20 at .35-.39, the sd10-sd14 / a10-a14 twins); the fourteen
 *   pneumatic parameters (spike and coil grippers, nest openers, nest opener sensors) stay declared and UNCONNECTED - the valve bank
 *   is not defined yet. X pick is extrapolated from the tube length (13.5 in clear vs the 29 in blue tube): place 50.0 stays, pick
 *   765.5 -> 383.1, so the coil travel is 343.1 mm. Indexer, Supervisor, Alarms, the schedule and g_L2StationList[14] take the program.
 *   Then gates, deliver, stamp. Cover note: scripts/coverNote1163S14.cjs.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, newRung, programBody, getRoutine, putRungs, tagXml, replaceTagIn, insertBefore, countOf, rep1, guid, moduleXml, l5kStr, strElemDec, alarmElemL5K, alarmElemDec } = H;

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H_ = D + '/_history';
const BASE = H_ + '/1163_Haemonetics_v0.16_2026-11-16.L5X';
const M = '1163_Haemonetics';
const VERSION = (() => { const i = process.argv.indexOf('--version'); return i >= 0 ? process.argv[i + 1] : '0.17'; })();
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const SUBNET = '10.68.167.';
const SRC = 'L2_S10_BlueTubeCoiler', NEW = 'L2_S14_ClearTubeCoiler';
const STA = 14, STAPRE = 13, PREFIX_FROM = 'L2S10 Tube Coil: ', PREFIX = 'L2S14 Tube Coil: ';
// positions: pick-to-place distance scaled by the tube length (13.5 in / 29 in); place 50.0 (from the homing block) and the 10 mm pre-tension stay
const TUBE_RATIO = 13.5 / 29, PLACE = 50.0, PICK_FROM = 765.5, PRETENSION = 10.0, COIL_DIA = 75.0, COIL_PITCH = 4.2;
const PICK = Math.round((PLACE + (PICK_FROM - PLACE) * TUBE_RATIO) * 10) / 10;                      // 383.1
const COIL_START = Math.round((PICK + PRETENSION) * 10) / 10, COIL_TRAVEL = Math.round((COIL_START - PLACE) * 10) / 10;   // 393.1, 343.1
const REVS = Math.round(COIL_TRAVEL / (Math.PI * COIL_DIA) * 1000) / 1000;                                               // 1.456
const ROT_TRAVEL = Math.round(REVS * 360 * 100) / 100, Z_TRAVEL = Math.round(REVS * COIL_PITCH * 1000) / 1000;            // 524.16, 6.115
const f32 = (n) => Math.fround(n).toExponential(8).replace(/e([+-])(\d+)$/, (m, s, d) => 'e' + s + d.padStart(3, '0'));
const log = [];
const base = fs.readFileSync(BASE, 'utf8');
let x = base;
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); const m = H.progRe(prog).exec(x); x = x.slice(0, m.index) + b + x.slice(m.index + m[0].length); };
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };

// ═══ hardware map: L2S10 device -> its L2S14 twin (Master Electrical IP tab 2026-11-16, devices 22-26; BOM 1163-EL, same drives and motors) ═══
const DRIVES = [
  ['sd10_L2S10RotaryUpstream', 'sd16_L2S14RotaryUpstream', '35', 'a10_L2S10RotaryUpstream', 'a16_L2S14RotaryUpstream', 'Loss Of L2S14 Rotary Upstream Servo EIP', 'iq_RAxisUpstream'],
  ['sd11_L2S10RotaryDownstream', 'sd17_L2S14RotaryDownstream', '36', 'a11_L2S10RotaryDownstream', 'a17_L2S14RotaryDownstream', 'Loss Of L2S14 Rotary Downstream Servo EIP', 'iq_RAxisDownstream'],
  ['sd12_L2S10VerticalUpstream', 'sd18_L2S14VerticalUpstream', '37', 'a12_L2S10VerticalUpstream', 'a18_L2S14VerticalUpstream', 'Loss Of L2S14 Vertical Upstream Servo EIP', 'iq_ZAxisUpstream'],
  ['sd13_L2S10VerticalDownstream', 'sd19_L2S14VerticalDownstream', '38', 'a13_L2S10VerticalDownstream', 'a19_L2S14VerticalDownstream', 'Loss Of L2S14 Vertical Downstream Servo EIP', 'iq_ZAxisDownstream'],
  ['sd14_L2S10Horizontal', 'sd20_L2S14Horizontal', '39', 'a14_L2S10Horizontal', 'a20_L2S14Horizontal', 'Loss Of L2S14 Horizontal Servo EIP', 'iq_XAxis'],
];
// pneumatic parameters: declared on the program, not connected (valve bank not defined - Jason, 2026-11-16)
const PNEUMATIC = ['i_NestOpenerUpstreamRetracted', 'i_NestOpenerDownstreamRetracted',
  'q_CloseSpikeGripperUpstream', 'q_OpenSpikeGripperUpstream', 'q_CloseSpikeGripperDownstream', 'q_OpenSpikeGripperDownstream',
  'q_CloseCoilGripperUpstream', 'q_OpenCoilGripperUpstream', 'q_CloseCoilGripperDownstream', 'q_OpenCoilGripperDownstream',
  'q_ExtendNestOpenerUpstream', 'q_RetractNestOpenerUpstream', 'q_ExtendNestOpenerDownstream', 'q_RetractNestOpenerDownstream'];

// ═══ 1. the program: L2S10 re-pointed ═══════════════════════════════════════
fs.mkdirSync(PROGDIR, { recursive: true });
const src = programBody(x, SRC) || fail(SRC);
let p;
{
  must(!programBody(x, NEW), 'program already present: ' + NEW);
  must(!src.includes(NEW) && countOf(src, 'L2_S10_') === 1, SRC + ' carries no self reference beyond its name');
  p = src.replace('<Program Name="' + SRC + '"', '<Program Name="' + NEW + '"');
  must(countOf(p, PREFIX_FROM) === 70, 'L2S10 alarm prefix count: ' + countOf(p, PREFIX_FROM));   // (25 alarms + 10 servo alarms) x (L5K + decorated)
  p = p.split(PREFIX_FROM).join(PREFIX);
  p = rep1(p, 'MOVE(10,StaNum) MOVE(9,StaNumPre)', 'MOVE(' + STA + ',StaNum) MOVE(' + STAPRE + ',StaNumPre)', NEW + ' StaNum / StaNumPre');
  must(countOf(p, 'MOVE(101,\\L2_Tracking') === 2, 'FailureType 101 twice (upstream, downstream)');
  p = p.split('MOVE(101,\\L2_Tracking').join('MOVE(' + STA + '1,\\L2_Tracking');
  // positions and the coil numbers Jason's copy carries (recomputed by the ladder at state 28; seeded consistent)
  const seedReal = (name, from, to) => {
    const t = tagXml(p, name) || fail('tag ' + name);
    must(t.includes('<![CDATA[' + f32(from) + ']]>') && t.includes('Value="' + from + '"'), name + ' seed ' + from);
    p = p.replace(t, t.replace('<![CDATA[' + f32(from) + ']]>', '<![CDATA[' + f32(to) + ']]>').replace('Value="' + from + '"', 'Value="' + to + '"'));
  };
  {
    const t = tagXml(p, 'HMI_XAxis') || fail('HMI_XAxis');
    must(countOf(t, '[' + f32(PICK_FROM) + ',' + f32(PLACE) + ',') === 1 && countOf(t, '<Element Index="[0]" Value="' + PICK_FROM + '"/>') === 1, 'HMI_XAxis pick / place seeds');
    p = p.replace(t, t.replace('[' + f32(PICK_FROM) + ',' + f32(PLACE) + ',', '[' + f32(PICK) + ',' + f32(PLACE) + ',').replace('<Element Index="[0]" Value="' + PICK_FROM + '"/>', '<Element Index="[0]" Value="' + PICK + '"/>'));
  }
  seedReal('CoilStartPosition', 775.5, COIL_START);
  seedReal('CoilTravel', 725.5, COIL_TRAVEL);
  seedReal('CoilRevolutions', 3.08, REVS);
  seedReal('RotaryCoilTravel', 1108.57, ROT_TRAVEL);
  seedReal('ZCoilTravel', 12.936, Z_TRAVEL);
  // the cam point arrays Jason's copy holds from the last MCCP (master 0 -> CoilTravel, slave RotaryCoilTravel / -ZCoilTravel)
  const seedCam = (name, slaveFrom, slaveTo) => {
    const t = tagXml(p, name) || fail('tag ' + name);
    must(countOf(t, f32(slaveFrom)) === 1 && countOf(t, 'Value="' + slaveFrom + '"') === 1 && countOf(t, f32(725.5)) === 1 && countOf(t, 'Value="725.5"') === 1, name + ' cam points');
    p = p.replace(t, t.replace(f32(slaveFrom), f32(slaveTo)).replace('Value="' + slaveFrom + '"', 'Value="' + slaveTo + '"').replace(f32(725.5), f32(COIL_TRAVEL)).replace('Value="725.5"', 'Value="' + COIL_TRAVEL + '"'));
  };
  seedCam('RotaryCam', 1108.57, ROT_TRAVEL);
  seedCam('ZCam', -12.936, -Z_TRAVEL);
  must(!/L2S10|L2_S10|Blue/.test(p), NEW + ' carries no L2S10 name');
  for (const n of PNEUMATIC) { const t = tagXml(p, n) || fail('parameter ' + n); must(/Usage="(Input|Output)"/.test(t), n + ' is a parameter'); }
  for (const [, , , , , , iq] of DRIVES) must(/Usage="InOut"/.test(tagXml(p, iq) || ''), iq + ' is an InOut parameter');
  must(tagXml(p, 'StateDurationHistory') && p.includes(',StateHistory,StateDurationHistory)'), NEW + ' carries the 5.1 state engine form');
  x = insertBefore(x, '</Programs>', p + '\n', '</Programs>');
  fs.writeFileSync(path.join(PROGDIR, NEW + '.xml'), p);
  log.push('program ' + NEW + ': ' + rungList(p).length + ' rungs, ' + (p.match(/<Tag Name=/g) || []).length + ' tags; X pick ' + PICK + ', place ' + PLACE + ', coil travel ' + COIL_TRAVEL + ' mm = ' + REVS + ' turns at ' + COIL_DIA + ' mm');
}
// proof: L2S14 equals the stamped L2S10 once the name, the station numbers, the failure code and the scaled numbers are normalized
{
  const norm = (s, sta, pre, pick, cs, ct, revs, rot, z) => s.replace('<Program Name="L2_S' + sta + '_', '<Program Name="L2_S##_').split('L2S' + sta + ' Tube Coil: ').join('L2S## Tube Coil: ')
    .replace('MOVE(' + sta + ',StaNum) MOVE(' + pre + ',StaNumPre)', 'MOVE(#,StaNum) MOVE(#,StaNumPre)').split('MOVE(' + sta + '1,\\L2_Tracking').join('MOVE(#1,\\L2_Tracking')
    .split(f32(pick)).join('#PICK').split('Value="' + pick + '"').join('Value="#PICK"')
    .split(f32(cs)).join('#CS').split('Value="' + cs + '"').join('Value="#CS"').split(f32(ct)).join('#CT').split('Value="' + ct + '"').join('Value="#CT"')
    .split(f32(revs)).join('#R').split('Value="' + revs + '"').join('Value="#R"').split(f32(rot)).join('#ROT').split('Value="' + rot + '"').join('Value="#ROT"')
    .split(f32(z)).join('#Z').split('Value="-' + z + '"').join('Value="-#Z"').split('Value="' + z + '"').join('Value="#Z"');
  const a = norm(src.replace('<Program Name="L2_S10_BlueTubeCoiler"', '<Program Name="L2_S10_'), 10, 9, PICK_FROM, 775.5, 725.5, 3.08, 1108.57, 12.936);
  const b = norm(p.replace('<Program Name="L2_S14_ClearTubeCoiler"', '<Program Name="L2_S14_'), STA, STAPRE, PICK, COIL_START, COIL_TRAVEL, REVS, ROT_TRAVEL, Z_TRAVEL);
  if (a !== b) { let i = 0; while (a[i] === b[i]) i++; fail(NEW + ' differs from the stamped L2S10 beyond names and numbers at offset ' + i + ':\n  S10: ' + a.slice(i - 60, i + 80) + '\n  S14: ' + b.slice(i - 60, i + 80)); }
  log.push(NEW + ' identical to the stamped L2S10 except the name, StaNum / StaNumPre, FailureType 141, the alarm prefix and the six scaled numbers');
}

// ═══ 2. modules + axes ═══════════════════════════════════════════════════════
{
  const cloneMod = (from, to, ip) => { const m = moduleXml(x, from); must(countOf(m, from) === 1, from + ' named once in its module'); must(/,33619968,/.test(m), from + ' is single phase'); return m.replace('Name="' + from + '"', 'Name="' + to + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + SUBNET + ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'); };
  const maxAxisId = Math.max(...[...x.matchAll(/AxisID="(\d+)"/g)].map((m) => +m[1]));
  const mods = [], axes = [];
  DRIVES.forEach(([sdFrom, sdTo, ip, aFrom, aTo], i) => {
    must(countOf(x, '<Module Name="' + sdTo + '"') === 0 && countOf(x, '<Tag Name="' + aTo + '"') === 0, sdTo + ' / ' + aTo + ' free');
    mods.push(cloneMod(sdFrom, sdTo, ip));
    let ax = tagXml(x, aFrom) || fail('axis ' + aFrom);
    must(countOf(ax, aFrom) === 1, aFrom + ' named once in its tag');
    ax = ax.replace('<Tag Name="' + aFrom + '"', '<Tag Name="' + aTo + '"');
    ax = rep1(ax, 'MotionModule="' + sdFrom + ':Ch1"', 'MotionModule="' + sdTo + ':Ch1"', aTo + ' motion module');
    ax = ax.replace(/ AxisID="\d+"/, ' AxisID="' + (maxAxisId + 1 + i) + '"');
    axes.push(ax);
  });
  const lastMod = moduleXml(x, DRIVES[4][0]);
  x = x.replace(lastMod, lastMod + '\n' + mods.join('\n'));
  const lastAx = tagXml(x, DRIVES[4][3]) || fail(DRIVES[4][3]);
  x = x.replace(lastAx, lastAx + '\n' + axes.join('\n'));
  const ids = [...x.matchAll(/AxisID="(\d+)"/g)].map((m) => m[1]);
  must(new Set(ids).size === ids.length, 'duplicate AxisID');
  const ips = [...x.matchAll(/Address="(10\.68\.167\.\d+)" Type="Ethernet"/g)].map((m) => m[1]);
  must(new Set(ips).size === ips.length, 'duplicate IP address');
  log.push('modules: sd16-sd20 (.35-.39, the sd10-sd14 drives cloned, single phase); axes a16-a20 (a10-a14 cloned, own AxisID); no valve bank');
}

// ═══ 3. g_L2StationList[14] ══════════════════════════════════════════════════
{
  const gl = tagXml(x, 'g_L2StationList') || fail('g_L2StationList');
  const names = [...gl.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[2] || '');
  must(names.length === 17 && names[STA] === '' && names[10] === PREFIX_FROM, 'g_L2StationList elements');
  names[STA] = PREFIX;
  const head = gl.slice(0, gl.indexOf('<Data Format="L5K">'));
  x = replaceTagIn(x, 'g_L2StationList', head + '<Data Format="L5K">\n<![CDATA[[' + names.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="17">\n' + names.map((s, i) => strElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>');
}

// ═══ 4. indexer, supervisor, alarms, schedule ════════════════════════════════
const S13R = 'L2_S13_InsertRobot', S13G = 'L2_S13_YSiteGripper';
editRoutine('L2_S00_IndexerNoSP', 'R01_Inputs', (r) => {
  r[2] = setRungText(r[2], rep1(rungText(r[2]), 'XIC(\\' + S13R + '.q_StationComplete)', 'XIC(\\' + S13R + '.q_StationComplete)XIC(\\' + NEW + '.q_StationComplete)', 'indexer stations complete'));
  r[3] = setRungText(r[3], rep1(rungText(r[3]), 'XIC(\\' + S13G + '.q_ActuatorsSafe)', 'XIC(\\' + S13G + '.q_ActuatorsSafe)XIC(\\' + NEW + '.q_ActuatorsSafe)', 'indexer actuators safe'));
  r[4] = setRungText(r[4], rep1(rungText(r[4]), 'XIC(\\' + S13R + '.q_Pause) MOVE(13,PauseReason) ]', 'XIC(\\' + S13R + '.q_Pause) MOVE(13,PauseReason) ,XIC(\\' + NEW + '.q_Pause) MOVE(' + STA + ',PauseReason) ]', 'indexer pause'));
  return r;
});
editRoutine('L2_S00_IndexerNoSP', 'R03_StateLogic', (r) => {
  must(r.length === 14 && rungText(r[13]).includes('StationCompleteTimes[13]'), 'L2_S00 R03');
  const used = new Set([...programBody(x, 'L2_S00_IndexerNoSP').matchAll(/ONS\(ONS\.(\d+)\)/g)].map((m) => +m[1]));
  const bit = 30;
  must(!used.has(bit), 'indexer ONS.' + bit + ' free');
  return [...r, newRung('Record Ok To Index For Each Station', 'XIC(\\' + NEW + '.q_StationComplete)ONS(ONS.' + bit + ')DIV(CycleTimer.ACC,1000,StationCompleteTimes[' + STA + ']);')];
});
editRoutine('Supervisor', 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (/OTE\(AllSMInAuto\);$/.test(t)) return setRungText(rg, t.replace('OTE(AllSMInAuto);', 'XIC(\\' + NEW + '.q_AutoMode)OTE(AllSMInAuto);'));
  if (/OTE\(MachineStopped\);$/.test(t)) return setRungText(rg, t.replace('OTE(MachineStopped);', 'XIC(\\' + NEW + '.q_AutoStopped)OTE(MachineStopped);'));
  if (t.includes('XIC(\\' + SRC + '.q_StartOK)')) return setRungText(rg, rep1(t, 'XIC(\\' + SRC + '.q_StartOK)', 'XIC(\\' + SRC + '.q_StartOK)XIC(\\' + NEW + '.q_StartOK)', 'Supervisor StartOK'));
  return rg;
}));
must(countOf(programBody(x, 'Supervisor'), '\\' + NEW + '.q_') === 3, 'Supervisor polls ' + NEW + ' three times');
const eipNodes = DRIVES.map(([, sd, , , , msg]) => [sd + 'EIP', sd, msg]);
const NODE0 = 35, ALARM0 = 37, ALARM_N = 42, ALARM_WAS = 37;
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
  const eipTpl = tagXml(sup, DRIVES[4][0] + 'EIP') || fail('Supervisor ' + DRIVES[4][0] + 'EIP');
  for (const [tag] of eipNodes) must(!tagXml(sup, tag), 'Supervisor tag free: ' + tag);
  sup = sup.replace(eipTpl, eipTpl + '\n' + eipNodes.map(([tag]) => eipTpl.replace('Name="' + DRIVES[4][0] + 'EIP"', 'Name="' + tag + '"')).join('\n'));
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm');
  must(al.includes('Dimensions="' + ALARM_WAS + '"'), 'Supervisor Alarm[' + ALARM_WAS + ']');
  const oldDec = [...al.matchAll(/<Element Index="\[\d+\]">[\s\S]*?<\/Element>/g)].map((m) => m[0]);
  must(oldDec.length === ALARM_WAS, 'Supervisor Alarm decorated elements');
  const msgs = Array.from({ length: ALARM_N }, (_, i) => i < ALARM_WAS ? (/<!\[CDATA\['([^']*)'\]\]>/.exec(oldDec[i]) || [, ''])[1] : '');
  eipNodes.forEach(([, , msg], j) => { must(msgs[ALARM0 + j] === '', 'Supervisor Alarm[' + (ALARM0 + j) + '] free'); msgs[ALARM0 + j] = msg + ' Communications'; });
  const head = al.slice(0, al.indexOf('<Data Format="L5K">')).replace('Dimensions="' + ALARM_WAS + '"', 'Dimensions="' + ALARM_N + '"');
  al = head + '<Data Format="L5K">\n<![CDATA[[' + msgs.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + ALARM_N + '">\n' + msgs.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
  log.push('Supervisor: one more program polled, ' + eipNodes.length + ' EIP-loss alarms (' + ALARM0 + '-' + (ALARM0 + eipNodes.length - 1) + '), Alarm[' + ALARM_N + '], node count ' + (NODE0 + eipNodes.length));
}
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t.endsWith('OTE(p_NoMachineFaults);')) return setRungText(rg, t.replace('OTE(p_NoMachineFaults);', 'XIO(\\' + NEW + '.q_AlarmActive)OTE(p_NoMachineFaults);'));
  if (t.endsWith('OTE(p_NoMachineWarnings);')) return setRungText(rg, t.replace('OTE(p_NoMachineWarnings);', 'XIO(\\' + NEW + '.q_WarningActive)OTE(p_NoMachineWarnings);'));
  return rg;
}));
must(countOf(programBody(x, 'Alarms'), '\\' + NEW + '.q_') === 2, 'Alarms roll-up ' + NEW);
x = insertBefore(x, '<ScheduledProgram Name="Production"/>', '<ScheduledProgram Name="' + NEW + '"/>\n', 'MainTask schedule');

// ═══ 5. parameter connections: the five axes only ════════════════════════════
{
  const pcs = DRIVES.map(([, , , , aTo, , iq]) => ['\\' + NEW + '.' + iq, aTo]);
  const ends = pcs.flat();
  for (const e of ends) must(!x.includes('EndPoint1="' + e + '"') && !x.includes('EndPoint2="' + e + '"'), 'endpoint already connected: ' + e);
  for (const e of ends.filter((s) => !s.startsWith('\\'))) must(countOf(x, '<Tag Name="' + e + '"') === 1, 'endpoint tag exists: ' + e);
  x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
  for (const n of PNEUMATIC) must(!x.includes('"\\' + NEW + '.' + n + '"'), n + ' stays unconnected');
  log.push('parameter connections: ' + pcs.length + ' (iq_ axes); ' + PNEUMATIC.length + ' pneumatic parameters declared, not connected');
}

// ═══ 6. proof: every other program stays as stamped ══════════════════════════
{
  const EDITED = new Set(['Supervisor', 'Alarms', 'L2_S00_IndexerNoSP']);
  const names = [...base.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) if (!EDITED.has(n)) must(programBody(x, n) === programBody(base, n), 'program changed: ' + n);
  for (const [sd, , , a] of DRIVES) { must(moduleXml(x, sd) === moduleXml(base, sd), 'module changed: ' + sd); must(tagXml(x, a) === tagXml(base, a), 'axis changed: ' + a); }
  for (const n of ['vb06_MainAssembly', 'sd01_L2Indexer']) must(moduleXml(x, n) === moduleXml(base, n), 'module changed: ' + n);
  log.push('untouched: ' + (names.length - EDITED.size) + ' programs byte-identical to the stamp, the L2S10 hardware unchanged');
}

// ═══ 7. write + gates ════════════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
must(countOf(x, '<Program Name="' + NEW + '"') === 1 && countOf(x, '<ScheduledProgram Name="' + NEW + '"/>') === 1, NEW + ' scheduled once');
for (const [, sd, , , a] of DRIVES) must(countOf(x, '<Tag Name="' + a + '"') === 1 && countOf(x, '<Module Name="' + sd + '"') === 1, a);
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.mkdirSync(path.join(PROGDIR, '..', 'controller'), { recursive: true });
fs.writeFileSync(path.join(PROGDIR, '..', 'controller', 'Tasks.xml'), (/<Tasks>[\s\S]*?<\/Tasks>/.exec(x) || [''])[0]);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);

const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', path.join(PROGDIR, NEW + '.xml')]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-20).map((l) => '    ' + l).join('\n'));
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

// ═══ 8. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION + ' (cover note: node scripts/coverNote1163S14.cjs)');
