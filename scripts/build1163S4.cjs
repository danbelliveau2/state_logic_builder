#!/usr/bin/env node
'use strict';
/**
 * build1163S4.cjs — 1163 v0.9: L2S04 (EC) Spike and Cap Load on the v0.8.1 stamp.
 *
 *   node scripts/build1163S4.cjs [--dry]
 *
 *   Four programs (Jason, 2026-11-06): L2_S04_SpikeEscapement (feeder, blade, servo shuttle, two rotaries with grippers, reject blow-off),
 *   L2_S04_SpikePNP (X / Z / spindle, spike grippers, load cells, funnel grippers; Station[4] tracking per nest side),
 *   L2_S04_DispenserUpstream / Downstream (Marposs DST503 on the DMPF). Four Kinetix 5300 drives a06-a09 (IP tab order), no new EtherNet/IP node.
 *   Then gates, deliver, stamp. Cover note: scripts/coverNote1163S4.cjs.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, setRungComment, newRung, programBody, getRoutine, putRungs, tagXml, replaceTagIn, insertBefore, countOf, rep1, guid, moduleXml, l5kStr, strElemDec, alarmElemL5K, alarmElemDec } = H;
const { motorBrake } = require('./lib/motorBrake.cjs');
const ESC = require('./lib/s4/escapement.cjs');
const PNP = require('./lib/s4/pnp.cjs');
const DISP = require('./lib/s4/dispenser.cjs');

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', H_ = D + '/_history';
const BASE = H_ + '/1163_Haemonetics_v0.8.1_2026-11-06.L5X';
const V54 = path.join(ROOT, 'plc-reference/training-material/SDC Standard Templates/SoftwareStandardization.L5X');
const M = '1163_Haemonetics', VERSION = '0.9';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const STA = 4, STAPRE = 3, PREFIX = 'L2S04 Spike And Cap: ', SUBNET = '10.68.167.';
const SIDES = ['Upstream', 'Downstream'];
const log = [];
let x = fs.readFileSync(BASE, 'utf8');
const v = fs.readFileSync(V54, 'utf8');
const S01 = programBody(x, 'L2_S01_TubeFeedUpstream') || fail('L2_S01_TubeFeedUpstream');
const TRK = programBody(x, 'L2_Tracking') || fail('L2_Tracking');
const IDXB = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00_IndexerNoSP');
const S05 = programBody(v, 'S05_ServoPNP') || fail('V5.4 S05_ServoPNP');
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); const m = H.progRe(prog).exec(x); x = x.slice(0, m.index) + b + x.slice(m.index + m[0].length); };
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };

// ═══ hardware (Master Electrical IP tab, BOM) ═════════════════════════════════
const AXES = {
  EscShuttle: { prog: ESC.PROG, param: 'iq_XAxis', tag: 'a06_L2S04EscapementShuttle', drive: 'sd06_L2S04EscapementShuttle', ip: SUBNET + '25', kind: 'linear', lead: 20.0, motor: 'TLP-A070-040-Dxxx2x', eip: 'Loss Of L2S04 Escapement Shuttle Servo EIP' },
  Spindle: { prog: PNP.PROG, param: 'iq_RAxis', tag: 'a07_L2S04Spindle', drive: 'sd07_L2S04Spindle', ip: SUBNET + '26', kind: 'rotary', gear: 20, motor: 'TLP-A046-010-Dxxx4x', eip: 'Loss Of L2S04 Spindle Servo EIP' },
  Vertical: { prog: PNP.PROG, param: 'iq_ZAxis', tag: 'a08_L2S04Vertical', drive: 'sd08_L2S04Vertical', ip: SUBNET + '27', kind: 'linear', lead: 20.0, motor: 'TLP-A070-020-Dxxx4x', eip: 'Loss Of L2S04 Vertical Servo EIP' },
  Horizontal: { prog: PNP.PROG, param: 'iq_XAxis', tag: 'a09_L2S04Horizontal', drive: 'sd09_L2S04Horizontal', ip: SUBNET + '28', kind: 'linear', lead: 20.0, motor: 'TLP-A070-040-Dxxx2x', eip: 'Loss Of L2S04 Horizontal Servo EIP' },
};
const AX_ORDER = ['EscShuttle', 'Spindle', 'Vertical', 'Horizontal'];   // a06 .. a09
const VB = 'vb01_MainAssembly';
const IN = (byte, bit) => VB + '_IN.Data[' + byte + '].' + bit, OUT = (byte, bit) => VB + '_OUT.Data[' + byte + '].' + bit;
// VB1 coils bytes 47-50, station n: A = bit 2n-2 (extend / close), B = 2n-1; VB3 through the DYPE bytes 44-45 (valve n = bits 2n-2 / 2n-1, Jason 2026-11-06)
const vb1 = (station, b) => { const bit = 2 * (station - 1) + b; return OUT(47 + Math.floor(bit / 8), bit % 8); };
const vb3 = (station, b) => { const bit = 2 * (station - 1) + b; return OUT(44 + Math.floor(bit / 8), bit % 8); };

// ═══ 1. programs ═════════════════════════════════════════════════════════════
const progs = [
  [ESC.PROG, ESC.build({ S01, S05, PREFIX, STA })],
  [PNP.PROG, PNP.build({ S01, S05, TRK, IDXB, PREFIX, STA, STAPRE })],
  ...SIDES.map((side) => { const d = DISP.build({ S01, PREFIX, STA, side }); return [d.PROG, d.xml]; }),
];
fs.mkdirSync(PROGDIR, { recursive: true });
for (const [name, xml] of progs) {
  must(!programBody(x, name), 'program already present: ' + name);
  x = insertBefore(x, '</Programs>', xml + '\n', '</Programs>');
  fs.writeFileSync(path.join(PROGDIR, name + '.xml'), xml);
  log.push('program ' + name + ': ' + rungList(xml).length + ' rungs, ' + (xml.match(/<Tag Name=/g) || []).length + ' tags');
}

// ═══ 2. drives + axes ════════════════════════════════════════════════════════
{
  const mods = [], axes = [];
  const sdTpl = moduleXml(x, 'sd02_L2S01FeedUpstream');
  must(/,33619968,/.test(sdTpl), 'sd02 is single phase');
  const axTpl = tagXml(x, 'a02_L2S01FeedUpstream') || fail('a02');
  const maxAxisId = Math.max(...[...x.matchAll(/AxisID="(\d+)"/g)].map((m) => +m[1]));
  AX_ORDER.forEach((k, i) => {
    const C = AXES[k];
    mods.push(sdTpl.replace('Name="sd02_L2S01FeedUpstream"', 'Name="' + C.drive + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + C.ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'));
    let ax = axTpl.replace('<Tag Name="a02_L2S01FeedUpstream"', '<Tag Name="' + C.tag + '"').replace('MotionModule="sd02_L2S01FeedUpstream:Ch1"', 'MotionModule="' + C.drive + ':Ch1"');
    const setAttr = (key, val) => { must(new RegExp(' ' + key + '="[^"]*"').test(ax), 'axis attribute ' + key); ax = ax.replace(new RegExp(' ' + key + '="[^"]*"'), ' ' + key + '="' + val + '"'); };
    setAttr('AxisID', String(maxAxisId + 1 + i)); setAttr('MotorCatalogNumber', C.motor);
    const brake = motorBrake(C.motor);
    if (brake) { setAttr('MechanicalBrakeEngageDelay', brake.engage.toFixed(2)); setAttr('MechanicalBrakeReleaseDelay', brake.release.toFixed(2)); }
    if (C.kind === 'linear') {
      setAttr('LoadType', 'Linear Actuator'); setAttr('ActuatorType', 'Screw'); setAttr('ActuatorLead', C.lead.toFixed(1)); setAttr('ActuatorDiameter', '1.0'); setAttr('TravelMode', 'Limited');
      setAttr('TransmissionRatioInput', '1'); setAttr('TransmissionRatioOutput', '1'); setAttr('PositionUnits', 'mm');
      setAttr('ConversionConstant', '10000.0'); setAttr('MotionResolution', '10000'); setAttr('PositionUnwind', '1000000');
    } else {
      // spindle: direct-drive pulleys 1:1 through a 20:1 gearbox, degrees, limited travel (oscillates +/- 30 deg about home)
      setAttr('LoadType', 'Rotary Transmission'); setAttr('ActuatorType', '&lt;none>'); setAttr('ActuatorLead', '1.0'); setAttr('ActuatorDiameter', '1.0'); setAttr('TravelMode', 'Limited');
      setAttr('TransmissionRatioInput', String(C.gear)); setAttr('TransmissionRatioOutput', '1'); setAttr('PositionUnits', 'deg');
      setAttr('PositionScalingNumerator', '360.0'); setAttr('PositionUnwindNumerator', '360.0');
      setAttr('ConversionConstant', '1000.0'); setAttr('MotionResolution', '360000'); setAttr('PositionUnwind', '360000');
    }
    axes.push(ax);
  });
  const ids = [...(x + axes.join('')).matchAll(/AxisID="(\d+)"/g)].map((m) => m[1]);
  must(new Set(ids).size === ids.length, 'duplicate AxisID');
  x = insertBefore(x, '</Modules>', mods.join('\n') + '\n', '</Modules>');
  const a03 = tagXml(x, 'a03_L2S01FeedDownstream') || fail('a03');
  x = x.replace(a03, a03 + '\n' + axes.join('\n'));
  log.push('modules: 4 Kinetix 5300 (sd06-sd09, single phase); axes a06-a09');
}

// ═══ 3. g_L2StationList[4] ═══════════════════════════════════════════════════
{
  const gl = tagXml(x, 'g_L2StationList') || fail('g_L2StationList');
  const names = [...gl.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[2] || '');
  must(names.length === 17 && names[4] === '' && names[10] === 'L2S10 Tube Coil: ', 'g_L2StationList elements');
  names[4] = PREFIX;
  const head = gl.slice(0, gl.indexOf('<Data Format="L5K">'));
  const neu = head + '<Data Format="L5K">\n<![CDATA[[' + names.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="17">\n' + names.map((s, i) => strElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  must(countOf(neu, PREFIX) === 2, 'g_L2StationList[4]');
  x = replaceTagIn(x, 'g_L2StationList', neu);
}

// ═══ 4. indexer, supervisor, alarms, schedule ════════════════════════════════
const S10 = 'L2_S10_BlueTubeCoiler';
editRoutine('L2_S00_IndexerNoSP', 'R01_Inputs', (r) => {
  must(rungText(r[2]).includes('XIC(\\' + S10 + '.q_StationComplete)ONS(ONS.6)'), 'indexer r2');
  must(rungText(r[3]) === 'XIC(\\' + S10 + '.q_ActuatorsSafe)OTE(ActuatorsSafe);' && rungText(r[4]) === 'XIC(\\' + S10 + '.q_Pause)MOVE(10,PauseReason)OTE(Pause);', 'indexer r3 / r4');
  r[2] = setRungText(r[2], rungText(r[2]).replace('XIC(\\' + S10 + '.q_StationComplete)', 'XIC(\\' + PNP.PROG + '.q_StationComplete)XIC(\\' + S10 + '.q_StationComplete)'));
  r[3] = setRungText(r[3], 'XIC(\\' + PNP.PROG + '.q_ActuatorsSafe)XIC(\\' + S10 + '.q_ActuatorsSafe)OTE(ActuatorsSafe);');
  r[4] = setRungText(r[4], '[XIC(\\' + PNP.PROG + '.q_Pause) MOVE(' + STA + ',PauseReason) ,XIC(\\' + S10 + '.q_Pause) MOVE(10,PauseReason) ]OTE(Pause);');
  return r;
});
editRoutine('L2_S00_IndexerNoSP', 'R03_StateLogic', (r) => { must(r.length === 7 && rungText(r[6]).includes('StationCompleteTimes[10]'), 'L2_S00 R03'); must(!programBody(x, 'L2_S00_IndexerNoSP').includes('ONS(ONS.8)'), 'ONS.8 free');
  return [...r, newRung('Record Ok To Index For Each Station', 'XIC(\\' + PNP.PROG + '.q_StationComplete)ONS(ONS.8)DIV(CycleTimer.ACC,1000,StationCompleteTimes[' + STA + ']);')]; });
const NEW = progs.map(([n]) => n);
editRoutine('Supervisor', 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (/OTE\(AllSMInAuto\);$/.test(t)) return setRungText(rg, t.replace('OTE(AllSMInAuto);', NEW.map((n) => 'XIC(\\' + n + '.q_AutoMode)').join('') + 'OTE(AllSMInAuto);'));
  if (/OTE\(MachineStopped\);$/.test(t)) return setRungText(rg, t.replace('OTE(MachineStopped);', NEW.map((n) => 'XIC(\\' + n + '.q_AutoStopped)').join('') + 'OTE(MachineStopped);'));
  if (t.includes('XIC(\\' + S10 + '.q_StartOK)[')) return setRungText(rg, t.replace('XIC(\\' + S10 + '.q_StartOK)[', 'XIC(\\' + S10 + '.q_StartOK)' + NEW.map((n) => 'XIC(\\' + n + '.q_StartOK)').join('') + '['));
  return rg;
}));
must(countOf(programBody(x, 'Supervisor'), '\\' + PNP.PROG + '.q_') === 3, 'Supervisor polls the PNP three times');
const eipNodes = AX_ORDER.map((k) => [AXES[k].drive + 'EIP', AXES[k].drive, AXES[k].eip]);
const NODE0 = 16, ALARM0 = 17;
editRoutine('Supervisor', 'R15_EIPMonitor', (r) => r.map((rg) => rungText(rg) === 'GE(EIPStatusCount,' + NODE0 + ')MOVE(0,EIPStatusCount);' ? setRungText(rg, 'GE(EIPStatusCount,' + (NODE0 + eipNodes.length) + ')MOVE(0,EIPStatusCount);') : rg));
must(/GE\(EIPStatusCount,20\)/.test(programBody(x, 'Supervisor')), 'EIP node count 20');
editRoutine('Supervisor', 'R20_Alarms', (r) => {
  const i = r.findIndex((rg) => rungText(rg).includes('EQ(EIPStatusCount,15) AOI_EIPStatus(sd21_L1IndexerEIP'));
  must(i > 0, 'Supervisor R20 L1 indexer EIP rung');
  const add = eipNodes.map(([tag, mod, msg], j) => newRung(msg + ' Communications', '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,' + (NODE0 + j) + ') AOI_EIPStatus(' + tag + ',' + mod + ') XIO(' + tag + '.ComOK) ,XIC(Alarm[' + (ALARM0 + j) + '].Active) XIO(q_FaultReset) ]OTE(Alarm[' + (ALARM0 + j) + '].Active);'));
  return [...r.slice(0, i + 1), ...add, ...r.slice(i + 1)];
});
{
  let sup = programBody(x, 'Supervisor');
  const eipTpl = tagXml(sup, 'sd01_IndexerEIP') || fail('Supervisor sd01_IndexerEIP');
  sup = sup.replace(eipTpl, eipTpl + '\n' + eipNodes.map(([tag]) => eipTpl.replace('Name="sd01_IndexerEIP"', 'Name="' + tag + '"')).join('\n'));
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm');
  must(al.includes('Dimensions="20"'), 'Supervisor Alarm[20]');
  const N = 25;
  const oldDec = [...al.matchAll(/<Element Index="\[\d+\]">[\s\S]*?<\/Element>/g)].map((m) => m[0]);
  must(oldDec.length === 20, 'Supervisor Alarm decorated elements');
  const msgs = Array.from({ length: N }, (_, i) => i < 20 ? (/<!\[CDATA\['([^']*)'\]\]>/.exec(oldDec[i]) || [, ''])[1] : '');
  for (let j = 0; j < eipNodes.length; j++) { must(msgs[ALARM0 + j] === '', 'Supervisor Alarm[' + (ALARM0 + j) + '] free'); msgs[ALARM0 + j] = eipNodes[j][2] + ' Communications'; }
  const head = al.slice(0, al.indexOf('<Data Format="L5K">')).replace('Dimensions="20"', 'Dimensions="' + N + '"');
  al = head + '<Data Format="L5K">\n<![CDATA[[' + msgs.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + N + '">\n' + msgs.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
  log.push('Supervisor: four programs polled, 4 EIP-loss alarms (17-20), Alarm[25], node count 20');
}
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (t.endsWith('OTE(p_NoMachineFaults);')) return setRungText(rg, t.replace('OTE(p_NoMachineFaults);', NEW.map((n) => 'XIO(\\' + n + '.q_AlarmActive)').join('') + 'OTE(p_NoMachineFaults);'));
  if (t.endsWith('OTE(p_NoMachineWarnings);')) return setRungText(rg, t.replace('OTE(p_NoMachineWarnings);', NEW.map((n) => 'XIO(\\' + n + '.q_WarningActive)').join('') + 'OTE(p_NoMachineWarnings);'));
  return rg;
}));
must(countOf(programBody(x, 'Alarms'), '\\' + PNP.PROG + '.q_') === 2, 'Alarms roll-up');
x = insertBefore(x, '<ScheduledProgram Name="' + S10 + '"/>', NEW.map((n) => '<ScheduledProgram Name="' + n + '"/>\n').join(''), 'MainTask schedule');

// ═══ 5. parameter connections ════════════════════════════════════════════════
const pcs = [];
for (const k of AX_ORDER) pcs.push(['\\' + AXES[k].prog + '.' + AXES[k].param, AXES[k].tag]);
const E = '\\' + ESC.PROG + '.', P = '\\' + PNP.PROG + '.';
// escapement inputs: DXPC IN3 = byte 2, IN4 = byte 3 (BOM I/O ASSIGNMENT); Upstream = I/O-list LT, Downstream = RT
pcs.push([IN(2, 2), E + 'i_BladeRetracted'], [IN(2, 3), E + 'i_SpikePresent'], [IN(2, 4), E + 'i_CapPresent'],
  [IN(2, 5), E + 'i_PresenterUpstreamExtended'], [IN(2, 6), E + 'i_PresenterUpstreamRetracted'], [IN(2, 7), E + 'i_PresenterDownstreamExtended'], [IN(3, 0), E + 'i_PresenterDownstreamRetracted']);
// escapement outputs: EC1 blade VB1 st11, EC2 blow-off VB1 st12 (single), EC3 RT rotary VB1 st13, EC4 RT rotary gripper VB1 st14, EC5 LT rotary VB3 st1, EC6 LT rotary gripper VB3 st2
pcs.push([E + 'q_ExtendBlade', vb1(11, 0)], [E + 'q_RetractBlade', vb1(11, 1)], [E + 'q_RejectBlowOff', vb1(12, 0)],
  [E + 'q_ExtendPresenterDownstream', vb1(13, 0)], [E + 'q_RetractPresenterDownstream', vb1(13, 1)], [E + 'q_CloseRotaryGripperDownstream', vb1(14, 0)], [E + 'q_OpenRotaryGripperDownstream', vb1(14, 1)],
  [E + 'q_ExtendPresenterUpstream', vb3(1, 0)], [E + 'q_RetractPresenterUpstream', vb3(1, 1)], [E + 'q_CloseRotaryGripperUpstream', vb3(2, 0)], [E + 'q_OpenRotaryGripperUpstream', vb3(2, 1)],
  [E + 'q_FeederBowlEnable', 'Local:5:O.Data.7']);
// PNP: EC7 RT spike gripper VB3 st3, EC8 LT st4, EC9 RT funnel st5, EC10 LT funnel st6; load cells AXA CH0 (bytes 48-49) Upstream, CH1 (50-51) Downstream
pcs.push([P + 'q_CloseSpikeGripperDownstream', vb3(3, 0)], [P + 'q_OpenSpikeGripperDownstream', vb3(3, 1)], [P + 'q_CloseSpikeGripperUpstream', vb3(4, 0)], [P + 'q_OpenSpikeGripperUpstream', vb3(4, 1)],
  [P + 'q_CloseFunnelGripperDownstream', vb3(5, 0)], [P + 'q_OpenFunnelGripperDownstream', vb3(5, 1)], [P + 'q_CloseFunnelGripperUpstream', vb3(6, 0)], [P + 'q_OpenFunnelGripperUpstream', vb3(6, 1)],
  [VB + '_IN.Data[48]', P + 'i_LoadCellUpstreamByte0'], [VB + '_IN.Data[49]', P + 'i_LoadCellUpstreamByte1'], [VB + '_IN.Data[50]', P + 'i_LoadCellDownstreamByte0'], [VB + '_IN.Data[51]', P + 'i_LoadCellDownstreamByte1']);
// dispensers on the DMPF: out byte 46 (IN1, IN2, START, RESET), in byte 52 (OUT1, OUT2, READY, ALARMS); Upstream bits 0-3, Downstream 4-7
SIDES.forEach((s, i) => {
  const Dp = '\\L2_S04_Dispenser' + s + '.', o = i * 4;
  pcs.push([Dp + 'q_AdapterBit0', OUT(46, o)], [Dp + 'q_AdapterBit1', OUT(46, o + 1)], [Dp + 'q_DispenserStart', OUT(46, o + 2)], [Dp + 'q_DispenserReset', OUT(46, o + 3)],
    [IN(52, o), Dp + 'i_AdapterBit0'], [IN(52, o + 1), Dp + 'i_AdapterBit1'], [IN(52, o + 2), Dp + 'i_DispenserReady'], [IN(52, o + 3), Dp + 'i_DispenserAlarmOK']);
});
{
  const used = new Set(), dup = pcs.map(([a, b]) => [a, b].find((e) => /vb01|Local:/.test(e))).filter(Boolean).filter((e) => used.has(e) ? true : (used.add(e), false));
  must(dup.length === 0, 'duplicate I/O point: ' + dup.join(','));
  for (const [a, b] of pcs) must(!x.includes('EndPoint2="' + b + '"/>') || !/vb01|Local:/.test(b), 'point already connected: ' + b);
}
x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
log.push('parameter connections: ' + pcs.length);

// ═══ 6. write + gates ════════════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
for (const n of NEW) must(countOf(x, '<Program Name="' + n + '"') === 1 && countOf(x, '<ScheduledProgram Name="' + n + '"/>') === 1, n + ' scheduled once');
for (const k of AX_ORDER) must(countOf(x, '<Tag Name="' + AXES[k].tag + '"') === 1 && countOf(x, '<Module Name="' + AXES[k].drive + '"') === 1, AXES[k].tag);
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.mkdirSync(path.join(PROGDIR, '..', 'controller'), { recursive: true });
fs.writeFileSync(path.join(PROGDIR, '..', 'controller', 'Tasks.xml'), (/<Tasks>[\s\S]*?<\/Tasks>/.exec(x) || [''])[0]);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);

const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', ...NEW.map((n) => path.join(PROGDIR, n + '.xml'))]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict)) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW/.test(l)).slice(0, 60).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');
if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 7. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION + ' (cover note: node scripts/coverNote1163S4.cjs)');
