#!/usr/bin/env node
'use strict';
/**
 * twins1160_S07_S14.cjs — Job 1160 re-base onto Jason's 2-UP chassis template (2026-09-17).
 *
 * Generates the A/B twins from ONE parameterized source per station, so the two files are
 * identical by construction except the side members / points / text (NAMES_CONTRACT v2.1):
 *   generated/1160/build_v0/programs/S14_GoodUnload.xml -> S14_GoodUnloadA (Left, vb01 slot 11) / S14_GoodUnloadB (Right, slot 10)
 *   generated/1160/build_v0/programs/S07_PortCut.xml    -> S07_PortCutA (Left, slot 9 / in 13 / vb02 slot 7) / S07_PortCutB (Right, slot 8 / in 12 / vb02 slot 6)
 *
 * Side mapping (Jason 2026-09-17 11:58): A = LEFT nest (v0 PartStatusLT), B = RIGHT nest (v0 PartStatusRT).
 * Tracking recipe: PartStatusRT.X -> PartStatus.XB, PartStatusLT.X -> PartStatus.XA; Nest OpStatus.LockoutRT/LT -> whole-nest
 * OpStatus.Lockout + Station[StaNum].OpStatus.LockoutB/A; Station OpStatus / PerformData / StationPerformance -> side letter.
 *
 * Run:  node scripts/experiments/twins1160_S07_S14.cjs            (writes the 4 programs + TWINS_MANIFEST_S07_S14.json)
 *       node scripts/experiments/twins1160_S07_S14.cjs --check    (diff-verify + lint only, no writes)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'generated', '1160', 'build', 'programs');
const CHECK_ONLY = process.argv.includes('--check');

// ── cross-program roots (single backslash in the emitted text) ──────────────
const TR = '\\Tracking.p_Data';
const CH = '\\Chassis.ChassisStatus';
const SUP = '\\Supervisor';
const ALM = '\\Alarms';
const HMIP = '\\HMI';
const DIV = '\\S14_BinDiverter';

// ── side parameters ─────────────────────────────────────────────────────────
// Valve bit rule (contract): bank slot n -> output bits 2n-2 (coil A) / 2n-1 (coil B); single valves 2n-2; bit i = Data[i/8].(i mod 8).
const SIDES = {
  A: {
    L: 'A', O: 'B', word: 'Left', WORD: 'LEFT', lt: 'LT',
    s14: { slot: 11, closeBit: 'Data[2].4', openBit: 'Data[2].5', bits: '20/21', pause: 7 },
    s07: { slot: 9, extBit: 'Data[2].0', retBit: 'Data[2].1', bits: '16/17', extIn: 13, extInBit: 'Data[1].5', prx: '1524PRX', cbl: '1524CBL', ioIn: 'IN5', shroudSlot: 7, shroudBit: 'Data[1].4', shroudBitNo: 12, cam: 'cam06_LeftCutterPresent', camIp: '192.168.1.36' },
  },
  B: {
    L: 'B', O: 'A', word: 'Right', WORD: 'RIGHT', lt: 'RT',
    s14: { slot: 10, closeBit: 'Data[2].2', openBit: 'Data[2].3', bits: '18/19', pause: 8 },
    s07: { slot: 8, extBit: 'Data[1].6', retBit: 'Data[1].7', bits: '14/15', extIn: 12, extInBit: 'Data[1].4', prx: '1520PRX', cbl: '1520CBL', ioIn: 'IN4', shroudSlot: 6, shroudBit: 'Data[1].2', shroudBitNo: 10, cam: 'cam05_RightCutterPresent', camIp: '192.168.1.35' },
  },
};

// ── XML helpers ─────────────────────────────────────────────────────────────
const cdata = (s) => `<![CDATA[${s}]]>`;
const ATTR = 'Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"';
const ATTR_RO = 'Constant="false" ExternalAccess="Read Only" OpcUaAccess="None"';
const desc = (d) => (d ? `\n<Description>\n${cdata(d)}\n</Description>` : '');

function tagBool(name, d = '', usage = null, seed = null) {
  const u = usage ? ` Usage="${usage}"` : '';
  const acc = usage === 'Output' ? ATTR_RO : ATTR;
  const data = seed === null ? '' : `\n<Data Format="L5K">\n${cdata(String(seed))}\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="BOOL" Radix="Decimal" Value="${seed}"/>\n</Data>`;
  if (!d && !data) return `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal"${u} ${acc}/>`;
  return `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal"${u} ${acc}>${desc(d)}${data}\n</Tag>`;
}
function tagDint(name, d = '', usage = null, comments = null) {
  const u = usage ? ` Usage="${usage}"` : '';
  const acc = usage === 'Output' ? ATTR_RO : ATTR;
  const cm = comments ? `\n<Comments>\n${comments.map(([op, t]) => `<Comment Operand="${op}">\n${cdata(t)}\n</Comment>`).join('\n')}\n</Comments>` : '';
  if (!d && !cm) return `<Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal"${u} ${acc}/>`;
  return `<Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal"${u} ${acc}>${desc(d)}${cm}\n</Tag>`;
}
function tagReal(name, d = '') {
  if (!d) return `<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float" ${ATTR}/>`;
  return `<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float" ${ATTR}>${desc(d)}\n</Tag>`;
}
function tagStruct(name, dt, d = '', dims = null) {
  const dm = dims ? ` Dimensions="${dims}"` : '';
  if (!d) return `<Tag Name="${name}" TagType="Base" DataType="${dt}"${dm} ${ATTR}/>`;
  return `<Tag Name="${name}" TagType="Base" DataType="${dt}"${dm} ${ATTR}>${desc(d)}\n</Tag>`;
}
function tagTimer(name, pre, d = '') {
  return `<Tag Name="${name}" TagType="Base" DataType="TIMER" ${ATTR}>${desc(d)}
<Data Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}
function tagConsecFails(d) {
  return `<Tag Name="ConsecFails" TagType="Base" DataType="ConsecFails" ${ATTR}>${desc(d)}
<Data Format="Decorated">
<Structure DataType="ConsecFails">
<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Setpoint" DataType="DINT" Radix="Decimal" Value="3"/>
</Structure>
</Data>
</Tag>`;
}
function strElem(i, s) {
  return `<Element Index="[${i}]">
<Structure DataType="STRING">
<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${s.length}"/>
<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">
${cdata(s ? `'${s}'` : '')}
</DataValueMember>
</Structure>
</Element>`;
}
function tagStringArray(name, strings, dims, d) {
  const els = [];
  for (let i = 0; i < dims; i++) els.push(strElem(i, strings[i] || ''));
  return `<Tag Name="${name}" TagType="Base" DataType="STRING" Dimensions="${dims}" ${ATTR}>${desc(d)}
<Data Format="Decorated">
<Array DataType="STRING" Dimensions="${dims}">
${els.join('\n')}
</Array>
</Data>
</Tag>`;
}
function rung(n, comment, text) {
  return `<Rung Number="${n}" Type="N">${comment ? `\n<Comment>\n${cdata(comment)}\n</Comment>` : ''}\n<Text>\n${cdata(text)}\n</Text>\n</Rung>`;
}
function routine(name, rungs) {
  return `<Routine Name="${name}" Type="RLL">\n<RLLContent>\n${rungs.map((r, i) => rung(i, r[0], r[1])).join('\n')}\n</RLLContent>\n</Routine>`;
}
function program(name, description, tags, routines) {
  return `<Program Name="${name}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata(description)}
</Description>
<Tags>
${tags.join('\n')}
</Tags>
<Routines>
${routines.join('\n')}
</Routines>
</Program>
`;
}

// ── shared rung fragments (every 1160 cam listener carries these) ───────────
const CAMCHK = (inst, angle, adv) => `Chassis_CamPos_Check(${inst},${angle},${CH}.CamPosDeg,${adv},${CH}.ActualVelocity)`;
const ALARM_HANDLER = `ProgramAlarmHandler(AOI_ProgramAlarmHandler,${ALM}.p_ProgramID,Alarm,${ALM}.p_Active,${ALM}.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);`;
const R00 = routine('R00_Main', [
  ['Subroutine Calls', 'JSR(R01_Inputs,0);'],
  ['', 'JSR(R02_Logic,0);'],
  ['', 'JSR(R20_Alarms,0);'],
]);
const LOGIC_INPUT_RUNGS = [
  ['Logic inputs\n\n*Replace always off bits with real conditions', `XIC(${SUP}.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);`],
  ['', `XIC(${SUP}.q_SafetyOK)OTE(SafetyOK);`],
  ['', `XIC(${SUP}.q_FaultReset)OTE(FaultReset);`],
  ['', `XIC(${SUP}.q_MachineRunning)OTE(CycleRunning);`],
  ['', `XIO(${SUP}.q_CycleStartLatch)OTE(CycleStopping);`],
  ['', `XIC(${SUP}.q_CycleStopped)ONS(ONS.0)XIC(g_MachineBasic.AlwaysOff)OTE(CycleStopped);`],
  ['Initialized - a cam listener has no init block; the Chassis program (Resync) owns recovery. AlwaysOff is the template shape, deliberate.', 'XIC(g_MachineBasic.AlwaysOff)OTE(Initialized);'],
  ['Single Step Logic\n\nStandard SINGLE STEP block, emitted in every program for standardization (Jason 2026-09-10). SS from HMI_Toggle.2 (fixed bit map). SS_OK is not consumed here - the chassis cam drives this station, so single step acts through the Chassis / Supervisor, not through this program.', 'XIC(HMI_Toggle.2)OTE(SS);'],
  ['', '[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);'],
];
const HMI_CLEAR_RUNGS = [
  ['Clear HMI Manual Triggers', 'XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);'],
  ['', 'NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'],
];
const COMMON_TAGS_HEAD = () => [
  tagStruct('AOI_ProgramAlarmHandler', 'ProgramAlarmHandler'),
];
const COMMON_TAGS_MISC = () => [
  tagBool('CycleRunning'),
  tagBool('CycleStopped'),
  tagBool('CycleStopping'),
  tagBool('FaultReset'),
  tagBool('HMI_LocalManualOverride'),
  tagBool('HMI_MomentaryOnPrevScan'),
  tagDint('HMI_Toggle', '', null, [['.0', 'Lockout'], ['.1', 'Dry Run'], ['.2', 'Single Step']]),
  tagBool('Initialized'),
  tagBool('LocalSSONS'),
  tagBool('ManualMode'),
  tagDint('NestNumCurrent'),
  tagDint('NestNumIncoming'),
  tagDint('ONS'),
];
const COMMON_TAGS_TAIL = () => [
  tagBool('SafetyOK'),
  tagBool('SS'),
  tagBool('SS_OK'),
  tagDint('StaNum'),
  tagDint('StaNumPre'),
  tagStruct('StationPerformance', 'StationPerformance'),
];
const perf = (L, attempt, success) => `StationPerformance(StationPerformance,${attempt},${success},g_PresetStationPerformLow,g_PresetStationPerformHigh,${TR}.Station[StaNum].PerformData.Attempts${L},${TR}.Station[StaNum].PerformData.Successes${L},${TR}.Station[StaNum].PerformData.Failures${L},${TR}.Station[StaNum].PerformData.Efficiency${L},${TR}.Station[StaNum].PerformData.HMIColorStatus${L});`;
const faultCount = (L) => `XIC(q_AlarmActive)ONS(ONS.2)ADD(${TR}.Station[StaNum].PerformData.FaultCount${L},1,${TR}.Station[StaNum].PerformData.FaultCount${L});`;
const alarmOut = (i, ons, severity1) => `[OTE(Alarm[${i}].Active) ,${severity1 ? `MOVE(1,Alarm[${i}].Severity) ,` : ''}ONS(ONS.${ons}) CONCAT(g_StationList[StaNum],AlarmList[${i}],Alarm[${i}].Message) ]`;

// ═══════════════════════════════════════════════════════════════════════════
// S14_GoodUnload{A|B}
// ═══════════════════════════════════════════════════════════════════════════
function buildS14(side) {
  const { L, O, word, WORD } = side;
  const P = side.s14;
  const name = `S14_GoodUnload${L}`;
  const other = `S14_GoodUnload${O}`;
  const sta = `${TR}.Station[StaNum]`;
  const ps = (n) => `${TR}.Nest[${n}].PartStatus`;
  const st = (n, k, m) => `${ps(n)}.Station[${k}].${m}${L}`;

  const alarmList = [
    `Side ${L} Consecutive Missed Drops - Check Gripper And Chute Sensor`,
    `Side ${L} Chute Sensor Blocked - Clear Chute`,
    `Side ${L} Station Bypassed`,
    `Side ${L} Station Locked Out`,
    '',
  ];
  const tags = [
    tagStruct('Alarm', 'AlarmData', `Side ${L} alarms: [0] Consecutive Missed Drops (warning + pause request), [1] Chute Sensor Blocked (fault), [2] Station Bypassed (warning), [3] Station Locked Out (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.`, 5),
    tagStringArray('AlarmList', alarmList, 5, 'Alarm text suffixes - R20 builds Alarm[n].Message = CONCAT(g_StationList[StaNum], AlarmList[n]). Twin text: Side A = Left nest, Side B = Right nest.'),
    ...COMMON_TAGS_HEAD(),
    tagBool('CamCloseGripper'),
    tagBool('CamOpenGripper'),
    tagStruct('CamPosCheckA', 'Chassis_CamPos_Check', 'Close Gripper window (g_S14_GripperCloseAngle, timing advance 1)'),
    tagStruct('CamPosCheckB', 'Chassis_CamPos_Check', 'Open Gripper window (g_S14_GripperOpenAngle, timing advance 1)'),
    tagStruct('CamPosCheckC', 'Chassis_CamPos_Check', 'Drop Check window (g_S14_DropCheckAngle, timing advance 0 - sensor read)'),
    tagStruct('CamPosCheckD', 'Chassis_CamPos_Check', 'Zero Part Tracking window (g_S14_DropCheckAngle + 10 deg)'),
    tagTimer('ChuteBlockedTimer', 2000, 'Drop Sensor held ON this long = chute blocked (ms, HMI-adjustable)'),
    tagStruct('ChuteSensorDebounce', 'AOI_Debounce'),
    tagConsecFails(`Side ${L} consecutive missed drops - Setpoint HMI-adjustable, default 3`),
    ...COMMON_TAGS_MISC().slice(0, 1), // CycleRunning
    tagBool('CycleStation', `Side ${L} (${word} nest) is GOOD and mine to unload this cycle`),
    ...COMMON_TAGS_MISC().slice(1, 3), // CycleStopped, CycleStopping
    tagBool('DropCheckArmed', 'Gripper released a tracked part - drop check pending'),
    tagBool('DropSeen', 'Drop Sensor pulse (or DropSensorBypass) latched since the release'),
    tagBool('DropSensorBypass', 'Drop Sensor Bypass (seeded 1) - the shared FU-E40 drop fibers ARE on 1160-DPA-000 (item 18) but have no fiber amplifier channel (FS-N42P expansion needed) and no schematic point - bypass ON counts every open as a confirmed drop; clear it once the fibers are wired. Program-scope, not a parameter; the same bypass exists in the twin. Read in R02 Drop Seen in parallel with the debounced i_DropSensor.', null, 1),
    tagStringArray('FailureMessages', ['Part Not Detected At Chute', '', '', '', ''], 5, 'Failure text suffixes - FailureMessage = CONCAT(g_StationList[StaNum], FailureMessages[n]); [0] = FailureType 141'),
    ...COMMON_TAGS_MISC().slice(3, 5), // FaultReset, HMI_LocalManualOverride
    tagDint('HMI_Momentary', '', null, [['.0', 'Close Gripper'], ['.1', 'Open Gripper']]),
    ...COMMON_TAGS_MISC().slice(5, 8), // HMI_MomentaryOnPrevScan, HMI_Toggle, Initialized
    tagBool('i_DropSensor', `Drop Sensor - the ONE shared Keyence FU-E40 through-beam pair (1160-DPA-000 item 18) on SENSOR PLATE 1160-DPA-001 at the Unload Diverter inlet: a part passed after either Unload Gripper opened. Shared by S14_GoodUnloadA and S14_GoodUnloadB (both declare this Input). Drawn, but NO amplifier channel (FS-N42P expansion needed) and NO 1160-V-016 point: unmapped Input parameter, reads 0 until wired; DropSensorBypass stands in.`, 'Input'),
    ...COMMON_TAGS_MISC().slice(8, 12), // LocalSSONS, ManualMode, NestNumCurrent, NestNumIncoming
    tagDint('NestUnloaded', `Nest number latched when the Unload Gripper closed - release / drop check / zero write go to this nest's side ${L} record`),
    ...COMMON_TAGS_MISC().slice(12), // ONS
    tagBool('p_ChuteClear', `No side-${L} part in flight between the gripper release and the drop sensor (consumed by S14_BinDiverter - AND with ${other}.p_ChuteClear)`, 'Public'),
    tagBool('q_AlarmActive', '', 'Output'),
    tagBool('q_CloseGripper', `Close Unload Gripper - ${word} (vb01 upper bank slot ${P.slot} coil A)`, 'Output'),
    tagBool('q_IncrementGood', `One-scan pulse - side ${L} (${word} nest) good part confirmed dropped (Production, S14_BinDiverter count)`, 'Output'),
    tagBool('q_IncrementMissedDrop', `One-scan pulse - side ${L} released part was not seen at the chute (FailureType 141; Production FailureTypeCounts)`, 'Output'),
    tagBool('q_OpenGripper', `Open Unload Gripper - ${word} (vb01 upper bank slot ${P.slot} coil B)`, 'Output'),
    tagBool('q_PauseRequest', `Ask the chassis to pause - consecutive missed drops on side ${L} (Chassis PauseReason ${P.pause})`, 'Output'),
    tagBool('q_WarningActive', '', 'Output'),
    ...COMMON_TAGS_TAIL(),
    tagStruct('ZeroPartAssyStat', 'Tracking_Part_Assy_Stat', 'All-zero part record copied over the fixture record once BOTH sides have left the nest (2-UP template: one PartStatus per nest carries side A and side B members)'),
    tagReal('ZeroPartTrackingAngle'),
  ];

  const R01 = routine('R01_Inputs', [
    ['Sensor Debounce - Drop Sensor\n\nDigital (through-beam) sensor only - the unload gripper is sensorless (commanded CLOSED = carrying, no cylinder switches to debounce). 10/10 ms because the part-passed pulse is short; the R02 Drop Seen latch holds it for the cam window. i_DropSensor is the ONE shared drop fiber pair above the diverter, declared as an unmapped Input parameter in both twins (no amplifier channel / no schematic point yet); DropSensorBypass stands in until it is wired. CE: confirm the pulse width exceeds the debounce time or latch the raw input.', 'AOI_Debounce(ChuteSensorDebounce,i_DropSensor,10,10);'],
    ...LOGIC_INPUT_RUNGS,
    ...HMI_CLEAR_RUNGS,
  ]);

  const R02 = routine('R02_Logic', [
    ['Load Station Numbers\n\n1160: station 14, predecessor 13 (S13_PhysicalCheck). Template S19 ships MOVE(18)/MOVE(17) - not inherited.', 'MOVE(14,StaNum)MOVE(13,StaNumPre);'],
    [`Load Nest Numbers\n\nTwo-up: one fixture = one nest number; this twin reads and writes only the side ${L} (${word} nest) members of Nest[n].PartStatus. NestNumCurrent = the fixture at station 14 after the index (dial stationary 120-360 deg).`, `MOVE(${TR}.Station[StaNum].NestNum,NestNumCurrent)MOVE(${TR}.Station[StaNumPre].NestNum,NestNumIncoming);`],
    [`Conditions For The Station To Cycle - side ${L} (${word} nest)\n\nSide ${L} is GOOD when: part loaded, station 13 succeeded or was locked out (pass-through), FailureType 0, not yet attempted here, no side-${L} station lockout and no fixture lockout, and the Unload Diverter reports a receiving bin (\\S14_BinDiverter.p_ActiveBin 1 = Right, 2 = Left). This IS the good-part decision - a not-good side is never gripped and rides to S15_RejectUnload. [CALL] Mark 29:01: 'If the status of the part is good, the gripper will close on that part. If it does not good, the gripper will not close.'`,
      `XIC(SafetyOK)XIC(CycleRunning)XIO(${sta}.OpStatus.Lockout${L})XIO(${TR}.Nest[NestNumCurrent].OpStatus.Lockout)[EQ(${DIV}.p_ActiveBin,1) ,EQ(${DIV}.p_ActiveBin,2) ]XIC(${ps('NestNumCurrent')}.PartLoaded${L})[XIC(${st('NestNumCurrent', 'StaNumPre', 'Success')}) ,XIC(${st('NestNumCurrent', 'StaNumPre', 'Lockout')}) ]EQ(${ps('NestNumCurrent')}.FailureType${L},0)XIO(${st('NestNumCurrent', 'StaNum', 'Attempt')})OTE(CycleStation);`],
    [`Station Locked Out - Stamp Part Tracking\n\nSide ${L} of station 14 locked out with a part loaded: stamp Station[14].Lockout${L} on the record so S15_RejectUnload removes the part and Tracking R05_PartOverallStatus counts the lockout as a pass-through (template S02 rung 3 shape).`,
      `XIC(SafetyOK)XIC(CycleRunning)XIC(${sta}.OpStatus.Lockout${L})XIC(${ps('NestNumCurrent')}.PartLoaded${L})OTL(${st('NestNumCurrent', 'StaNum', 'Lockout')});`],
    [`Close Gripper\n\n***CamPosTrig Angle Is Opposite As Part Is Picked From Dial, Not Conveyor***\n\ng_S14_GripperCloseAngle 230 deg (controller-scope, shared by both twins; timing sheet, timing advance 1) - middle hub Down/Place dwell 227-253 deg, P-N-P In over the dial. Closes only while CycleStation is true. The nest number is latched (NestUnloaded) because the open and the drop check fall inside the 0-120 deg dial index, where Station[14].NestNum shifts to the next fixture.`,
      `XIO(ManualMode)${CAMCHK('CamPosCheckA', 'g_S14_GripperCloseAngle', 1)}XIC(CycleStation)[OTL(${st('NestNumCurrent', 'StaNum', 'Attempt')}) ,MOVE(NestNumCurrent,NestUnloaded) ,OTE(CamCloseGripper) ];`],
    [`Open Gripper\n\n***CamPosTrig Angle Is Opposite As Part Is Picked From Dial, Not Conveyor***\n\ng_S14_GripperOpenAngle 50 deg (timing advance 1) - middle hub Down/Pick dwell 47-73 deg, P-N-P Out over the chute. Opens whenever the gripper is closed (also after a stop with a part in hand). Arms the drop check only when the gripper closed on a tracked part (Attempt${L} set, no result yet) and clears the Drop Seen latch. 1160 change: Success and the good count move from this rung to the Drop Check (template counts good at the open).`,
      `XIC(g_MachineBasic.AlwaysOn)${CAMCHK('CamPosCheckB', 'g_S14_GripperOpenAngle', 1)}XIC(q_CloseGripper)[OTE(CamOpenGripper) ,XIC(${st('NestUnloaded', 'StaNum', 'Attempt')}) XIO(${st('NestUnloaded', 'StaNum', 'Success')}) XIO(${st('NestUnloaded', 'StaNum', 'Failure')}) [OTL(DropCheckArmed) ,OTU(DropSeen) ] ];`],
    [`Drop Seen\n\nLatch the evidence that the released part left the gripper while the drop check is armed: the debounced part-passed pulse from the shared Drop Sensor (the pulse is far shorter than a cam window) OR DropSensorBypass. Bypass ON (seeded - the FU-E40 drop fibers have no amplifier channel or schematic point yet) latches Drop Seen the scan the gripper opens, so every open counts as a confirmed drop at the Drop Check; wire the fibers (FS-N42P expansion + point) and clear the bypass. The sensor is ONE pair above the diverter shared by both twins: when both grippers release in the same cycle both twins latch from the same pulse. [CALL] Mark 29:01: 'a Through beam sensor ... looking to make sure that a part was dropped when it was supposed to be'.`,
      'XIC(DropCheckArmed)[XIC(DropSensorBypass) ,XIC(ChuteSensorDebounce.On) ]OTL(DropSeen);'],
    [`Drop Check\n\ng_S14_DropCheckAngle 100 deg (timing advance 0 - sensor read). While armed: drop seen (the Drop Sensor pulse or DropSensorBypass, latched in Drop Seen) or side-${L} station Bypass = Success${L}, one-scan q_IncrementGood pulse, consecutive-miss count cleared; not seen = Failure${L}, FailureType${L} 141 'Part Not Detected At Chute', consecutive-miss count +1, one-scan q_IncrementMissedDrop pulse. Verify-rung shape (template S02 rung 4). Either way the part is OFF the nest, so PartLoaded${L} is cleared here (2-UP: the fixture record is zeroed only once both sides are off - next rungs) and S15 never claims it. A single miss is data in the nest record; the count reaching its setpoint is the R20 warning. OTU(DropCheckArmed) makes every pulse exactly one scan.`,
      `XIC(g_MachineBasic.AlwaysOn)${CAMCHK('CamPosCheckC', 'g_S14_DropCheckAngle', 0)}XIC(DropCheckArmed)[[XIC(DropSeen) ,XIC(${sta}.OpStatus.Bypass${L}) ] [OTL(${st('NestUnloaded', 'StaNum', 'Success')}) ,MOVE(0,ConsecFails.Count) ,OTE(q_IncrementGood) ] ,XIO(${sta}.OpStatus.Bypass${L}) XIO(DropSeen) [OTU(${st('NestUnloaded', 'StaNum', 'Success')}) ,OTL(${st('NestUnloaded', 'StaNum', 'Failure')}) ,MOVE(141,${ps('NestUnloaded')}.FailureType${L}) ,CONCAT(g_StationList[StaNum],FailureMessages[0],${ps('NestUnloaded')}.FailureMessage${L}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,OTE(q_IncrementMissedDrop) ] ,OTU(${ps('NestUnloaded')}.PartLoaded${L}) ,OTU(DropCheckArmed) ];`],
    [`Zero Part Tracking\n\nZeroPartTrackingAngle = g_S14_DropCheckAngle + 10 deg (timing advance 0, same as the drop check, to keep the 10 deg gap). The unload ends the nest's tracking life - template S19 rung 5 shape, COP(ZeroPartAssyStat) over the fixture record. 2-UP CHANGE (Jason's template has ONE PartStatus per nest carrying side A and side B members - no per-side record to zero): this twin zeroes the whole record only once its own side has a station 14 result (Success${L}, or a type-141 miss) AND the other side has no part left on the nest (PartLoaded${O} = 0: never loaded, or its twin dropped it this cycle and cleared PartLoaded${O} at its drop check). A nest still carrying a side-${O} reject is NOT zeroed here - its record must reach S15_RejectUnload, which zeroes the fixture after the blast. Jason 2026-09-01: zero only once the part is physically off.`,
      `XIC(g_MachineBasic.AlwaysOn)ADD(g_S14_DropCheckAngle,10.0,ZeroPartTrackingAngle)${CAMCHK('CamPosCheckD', 'ZeroPartTrackingAngle', 0)}XIC(${st('NestUnloaded', 'StaNum', 'Attempt')})[XIC(${st('NestUnloaded', 'StaNum', 'Success')}) ,XIC(${st('NestUnloaded', 'StaNum', 'Failure')}) ]XIO(${ps('NestUnloaded')}.PartLoaded${O})COP(ZeroPartAssyStat,${ps('NestUnloaded')},1);`],
    [`Chute Clear\n\nPublic handshake read by S14_BinDiverter as \\${name}.p_ChuteClear (ANDed with \\${other}.p_ChuteClear): no side-${L} part in flight between the gripper release and the drop sensor (drop check disarmed). With DropSensorBypass ON the drop check disarms at g_S14_DropCheckAngle regardless of the sensor.`,
      'XIO(DropCheckArmed)OTE(p_ChuteClear);'],
    [`Gripper Control\n\nOne rung per output carrying both modes with the seal-in inside (template S19 rungs 6/7). Manual: HMI_Momentary.0 Close / .1 Open. Sensorless gripper: commanded CLOSED = carrying (Dan 2026-08-31); the double valve holds its last command through a stop.`,
      '[XIO(ManualMode) [XIC(CamCloseGripper) ,XIC(q_CloseGripper) XIO(CamOpenGripper) ] ,XIC(ManualMode) [XIC(HMI_Momentary.0) ,XIC(q_CloseGripper) XIO(HMI_Momentary.1) ] ]OTE(q_CloseGripper);'],
    ['', '[XIO(ManualMode) [XIC(CamOpenGripper) ,XIC(q_OpenGripper) XIO(CamCloseGripper) ] ,XIC(ManualMode) [XIC(HMI_Momentary.1) ,XIC(q_OpenGripper) XIO(HMI_Momentary.0) ] ]OTE(q_OpenGripper);'],
    [`Valve Bank Outputs\n\nUpper valve bank vb01_UpperValveBank (SMC EX600-SEN7, 192.168.1.21, HHB-183731): slot ${P.slot} = ${word} Unload Gripper (pneumatic drawing 1160-P-001; 4 mm double valve, no sensors). Contract bit rule: slot n -> output bits 2n-2 (coil A = close) and 2n-1 (coil B = open). Slot ${P.slot} -> bits ${P.bits} = ${P.closeBit} close / ${P.openBit} open. Confirm the A/B coil assignment and the output map against the SMC configurator / EDS. MapOutputs copies vb01_UpperValveBank_OUT to the module.`,
      `[XIC(q_CloseGripper) OTE(vb01_UpperValveBank_OUT.${P.closeBit}) ,XIC(q_OpenGripper) OTE(vb01_UpperValveBank_OUT.${P.openBit}) ];`],
    [`Station Performance\n\nSide ${L} instance accumulating into Station[14].PerformData side-${L} counters (the AOI edge-counts Attempt / Success). Attempt read on the fixture at the station (latched at the close), Success on the latched unloaded nest (latched at the drop check).`,
      perf(L, st('NestNumCurrent', 'StaNum', 'Attempt'), st('NestUnloaded', 'StaNum', 'Success'))],
  ]);

  const R20 = routine('R20_Alarms', [
    [`Consecutive Missed Drops\n\nSide ${L} missed-drop count at its setpoint (default 3) while running and not locked out -> Severity 1 warning plus a pause request (template S01 'Consecutive Failures' shape; [CALL] Mark 18:02 / Jason 18:31 'that's our standard method'). A single miss is data in the nest record, never an alarm. Text = CONCAT(g_StationList[14], AlarmList[0]).`,
      `XIC(CycleRunning)XIO(${sta}.OpStatus.Lockout${L})GE(ConsecFails.Count,ConsecFails.Setpoint)${alarmOut(0, 3, true)};`],
    ['Clear the missed-drop count when the warning is up and the cycle stops or cleanout mode is on (a confirmed drop clears the count in R02 - template S01 shape).',
      `XIC(Alarm[0].Active)[XIO(CycleRunning) ,XIC(${HMIP}.q_CleanoutModeEnabled) ]MOVE(0,ConsecFails.Count);`],
    [`Pause If Consecutive Missed Drops\n\nRead by Chassis R01 'PauseCondition' as \\${name}.q_PauseRequest (PauseReason ${P.pause}).`, 'XIC(Alarm[0].Active)OTE(q_PauseRequest);'],
    [`Chute Sensor Blocked\n\nThe shared Drop Sensor (through-beam) held ON longer than ChuteBlockedTimer (2000 ms seed, HMI-adjustable) while running = a part or debris sitting in the chute. Fault held to FaultReset (template S02 'Probe Not Off' stuck-ON shape). Both twins watch the same sensor, so both annunciate. Inert until the drop sensor is wired (an unconnected Input parameter reads 0). The value has no 1160 source - CE to confirm.`,
      `[XIC(CycleRunning) XIC(ChuteSensorDebounce.On) TON(ChuteBlockedTimer,?,?) XIC(ChuteBlockedTimer.DN) ,XIC(Alarm[1].Active) XIO(FaultReset) ]${alarmOut(1, 4, false)};`],
    [`Station Bypassed\n\nSide-${L} Bypass forces the drop check to pass; it must still annunciate as a warning so nobody runs bypassed silently (template S02).`,
      `XIC(${sta}.OpStatus.Bypass${L})${alarmOut(2, 5, true)};`],
    ['Station Locked Out', `XIC(${sta}.OpStatus.Lockout${L})${alarmOut(3, 6, true)};`],
    ['', ALARM_HANDLER],
    ['Station Fault Count', faultCount(L)],
  ]);

  const description = `S14 Good Unload - Side ${L} (${WORD} nest) - cam listener for the ${word} Unload Gripper on the chassis P-N-P (2-UP template S19_GoodUnload${L} shape). Closes at g_S14_GripperCloseAngle on a GOOD side-${L} part, opens at g_S14_GripperOpenAngle over the chute, confirms the drop at g_S14_DropCheckAngle on the shared drop through-beam (i_DropSensor, unmapped; DropSensorBypass seeded ON until wired). Twin of ${other}: identical except side members, valve slot ${P.slot} and text. Chassis owns the cam.`;
  return program(name, description, tags, [R00, R01, R02, R20]);
}

// ═══════════════════════════════════════════════════════════════════════════
// S07_PortCut{A|B}
// ═══════════════════════════════════════════════════════════════════════════
function buildS07(side) {
  const { L, O, word, WORD } = side;
  const P = side.s07;
  const name = `S07_PortCut${L}`;
  const other = `S07_PortCut${O}`;
  const sta = `${TR}.Station[StaNum]`;
  const ps = (n) => `${TR}.Nest[${n}].PartStatus`;
  const st = (n, k, m) => `${ps(n)}.Station[${k}].${m}${L}`;

  const alarmList = [
    `Side ${L} Consecutive Failures`,
    `Side ${L} Pierce Not Retracted Before Chassis Raise - Immediate Stop Requested`,
    `Side ${L} Cutter Tip Not Present - Pierce Locked Out, Replace Needle`,
    `Side ${L} Station Bypassed`,
    `Side ${L} Station Locked Out`,
  ];
  const tags = [
    tagStruct('Alarm', 'AlarmData', `Side ${L} alarms: [0] Consecutive Failures (fault), [1] Pierce Not Retracted Before Chassis Raise (fault + immediate stop request), [2] Cutter Tip Not Present - Pierce Locked Out (warning), [3] Station Bypassed (warning), [4] Station Locked Out (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.`, 5),
    tagStringArray('AlarmList', alarmList, 5, 'Alarm message suffixes. Station prefix comes from g_StationList[7] - never authored here. Twin text: Side A = Left nest, Side B = Right nest.'),
    ...COMMON_TAGS_HEAD(),
    tagBool('CamExtendPierce'),
    tagStruct('CamPosCheckA', 'Chassis_CamPos_Check', 'Extend Pierce window (g_S07_PierceExtendAngle, timing advance 1)'),
    tagStruct('CamPosCheckB', 'Chassis_CamPos_Check', 'Retract Pierce + prove Extended window (g_S07_PierceRetractAngle, timing advance 1)'),
    tagStruct('CamPosCheckC', 'Chassis_CamPos_Check', 'Pierce Retracted deadline check (g_S07_PierceDeadlineAngle, timing advance 0)'),
    tagStruct('CamPosCheckD', 'Chassis_CamPos_Check', 'Cutter tip check + Vacuum Shroud off window (g_S07_CutterInspectAngle, timing advance 0)'),
    tagBool('CamRetractPierce'),
    tagBool('CamVacuumShroudOff'),
    tagBool('CamVacuumShroudOn'),
    tagConsecFails(`Side ${L} consecutive S07 failures (did not extend / tip not present). Setpoint 3 = SDC standard default, HMI-settable; Count >= Setpoint = FAULT (check-station form).`),
    tagBool('CutterCameraBypass', `Cutter Camera Bypass (seeded 1) - awaiting Jason IV4 standard program. The ${word} Cutter Present Camera (Keyence IV4, node ${P.cam} ${P.camIp}) is not handshaken by this program yet: i_CutterPresentOK is an unmapped Input parameter, so with the bypass ON the cutter tip check at g_S07_CutterInspectAngle stamps Success. Clear it once Jason's IV4 program drives i_CutterPresentOK. Program-scope, not a parameter; the same bypass exists in the twin.`, null, 1),
    ...COMMON_TAGS_MISC().slice(0, 1), // CycleRunning
    tagBool('CycleStation', `Side ${L} (${word} nest) qualified to pierce this cycle`),
    ...COMMON_TAGS_MISC().slice(1, 3), // CycleStopped, CycleStopping
    tagStringArray('FailureMessages', ['Pierce Did Not Extend', 'Cutter Tip Not Present', 'Cutter Vision Timeout', '', ''], 5, 'Part failure reasons written into the nest side record: [0] FailureType 71 Pierce Did Not Extend, [1] 72 Cutter Tip Not Present, [2] 74 Cutter Vision Timeout (reserved for Jason\'s IV4 program - not written while the camera check is bypassed). FailureMessage = CONCAT(g_StationList[7], FailureMessages[n]).'),
    ...COMMON_TAGS_MISC().slice(3, 5), // FaultReset, HMI_LocalManualOverride
    tagDint('HMI_Momentary', '', null, [['.0', 'Extend Pierce'], ['.1', 'Retract Pierce'], ['.2', 'Vacuum Shroud On'], ['.3', 'Vacuum Shroud Off']]),
    ...COMMON_TAGS_MISC().slice(5, 6), // HMI_MomentaryOnPrevScan
    `<Tag Name="HMI_Toggle" TagType="Base" DataType="DINT" Radix="Decimal" ${ATTR}>${desc('HMI toggles, SDC fixed bit map: .0 Lockout (not read here - station lockout is Tracking Station[7].OpStatus.Lockout' + L + '), .1 Dry Run (not read here - a dry-run pierce would fire the needle into an empty nest, CE decision), .2 Single Step (R01 SS block). No other bit is assigned - \'Shroud Always On\' (Mark\'s fallback) = widen the shroud window on the HMI angles or Manual + HMI_Momentary, not a new toggle bit.')}
<Comments>
<Comment Operand=".0">
${cdata('Lockout - fixed bit map position, not read here')}
</Comment>
<Comment Operand=".1">
${cdata('Dry Run - fixed bit map position, not read here')}
</Comment>
<Comment Operand=".2">
${cdata('Single Step')}
</Comment>
</Comments>
</Tag>`,
    ...COMMON_TAGS_MISC().slice(7, 8), // Initialized
    tagBool('i_CutterPresentOK', `Cutter tip present = OK - the ${word} Cutter Present Camera (Keyence IV4-G120 amplifier / IV4-G500MA head, node ${P.cam} ${P.camIp}) result for side ${L}. Unmapped Input parameter awaiting Jason IV4 standard program (the v0 cam handshake rungs are removed): reads 0 until that program drives it; CutterCameraBypass (seeded 1) stands in at the cutter tip check.`, 'Input'),
    tagBool('i_PierceExtended', `Pierce Extended - SMC D-M9PSAPC cylinder switch ${P.prx}, vb01 upper valve bank input ${P.extIn} (Hailey 1160-V: S07-PORT CUT ${side.lt} PIERCE EXTENDED; pneumatic drawing 1160-P-001 slot ${P.slot}). No Retracted switch is drawn - Retracted is DERIVED in R01. 1160-DGB-000 item 11: ONE D-M9PSAPC per MXS8-20 slide - the drawing does not label which end; confirm it is the Extended end (a Retracted switch is a BOM add).`, 'Input'),
    ...COMMON_TAGS_MISC().slice(8, 12), // LocalSSONS, ManualMode, NestNumCurrent, NestNumIncoming
    tagBool('OkManExtendPierce', 'Manual extend permissive for the Pierce needle: Manual mode, safety OK, chassis cam not running and not jogging (S05_PortLoad OkMan form; tooling protection - a needle is never extended by hand while the cam can move). Retract is always permitted in Manual.'),
    ...COMMON_TAGS_MISC().slice(12), // ONS
    tagBool('p_ImmediateStopRequest', `The side-${L} Pierce needle was not proven retracted by g_S07_PierceDeadlineAngle - Chassis R01 'Chassis Immediate Stop Conditions' -> ChassisControl.ImmedStop (the chassis stops before it lifts the tooling through the part). Held until Fault Reset with the needle retracted. Chassis reads \\${name} and \\${other}.`, 'Public'),
    tagBool('p_PierceRetracted', `Side-${L} Pierce needle derived-retracted - Chassis R01 'Chassis Dial Index Permissives' IndexPermissiveStatus[7] = XIC(\\S07_PortCutA.p_PierceRetracted) XIC(\\S07_PortCutB.p_PierceRetracted).`, 'Public'),
    tagBool('Pierced', `Side-${L} Pierce extended into the septum this cycle (Extended switch proven at the retract window, or Bypass) - the side whose cutter tip must be checked at g_S07_CutterInspectAngle.`),
    tagBool('PierceExtended'),
    tagBool('PierceLockout', `Side-${L} Pierce locked out by this program - latched when the cutter tip check reports the needle tip NOT present (broken tip, Mark: 'reject + lock out the station'); side ${L} is no longer pierced and its parts are stamped Station[7].Lockout${L} (skipped). Severity 1 warning; cleared by Fault Reset after the needle is replaced. Inert while CutterCameraBypass is ON.`),
    tagBool('PierceNotRetracted'),
    tagTimer('PierceRetractDelay', 80, 'Pierce derived-retracted delay (ms): retract commanded, extend off and the Extended switch clear for this long = Retracted (no Retracted switch drawn). Seed 80 = nominal 20 mm stroke at 250 mm/s (timing sheet item 9), sized so Retracted is proven (~264 deg at 1.2 s/cycle) before the 270 deg g_S07_PierceDeadlineAngle - the plan\'s 160 ms would land ~290 deg and fault every cycle. HMI-adjustable; a Retracted switch (BOM add) replaces this timer.'),
    tagBool('PierceRetracted'),
    tagBool('q_AlarmActive', '', 'Output'),
    tagBool('q_ExtendPierce', `Extend Pierce - ${word} - vb01 Upper Valve Bank slot ${P.slot} coil A (SY3200 double solenoid, pneumatic drawing 1160-P-001) - SMC MXS8-20 precision slide table (1160-DGB-000 item 8), 8 mm bore x 20 mm stroke, no stroke adjuster, no flow controls on the BOM; needle 1160-DGB-001 down`, 'Output'),
    tagBool('q_RetractPierce', `Retract Pierce - ${word} - vb01 Upper Valve Bank slot ${P.slot} coil B - SMC MXS8-20 precision slide table (1160-DGB-000 item 8); needle 1160-DGB-001 up`, 'Output'),
    tagBool('q_VacuumShroudOn', `Vacuum Shroud On - ${word} - vb02 Table Valve Bank slot ${P.shroudSlot} (SY3100 single solenoid to the vacuum generator, pneumatic drawing 1160-P-002) - EXAIR 800003 low vacuum generator + SMC AF30-03B-D filter (1160-DGC-000, one per lane) pulling through the 1160-DGB-007 vacuum shroud`, 'Output'),
    tagBool('q_WarningActive', '', 'Output'),
    ...COMMON_TAGS_TAIL(),
  ];

  const R01 = routine('R01_Inputs', [
    [`Mapped Inputs - Pierce Extended (${word})\n\nSMC D-M9PSAPC cylinder switch ${P.prx} (cable ${P.cbl}) -> vb01_UpperValveBank (SMC EX600-SEN7, 192.168.1.21, HHB-183731) EX600-DXPC #2 ${P.ioIn} = bank input point ${P.extIn} (io-schematic.md: S07-PORT CUT ${side.lt} PIERCE EXTENDED; layout channel numbers approximate - confirm with Hailey). Point ${P.extIn} = vb01_UpperValveBank_IN ${P.extInBit}, assuming the input point data starts at byte 0 of the MapInputs buffer - confirm against the SMC configurator / EDS. Pneumatic position sensor: NO AOI_Debounce (digital sensors only). Valve-bank points arrive through the MapInputs buffer and are mapped here as XIC(<buffer>.Data[n].b) OTE(i_X) - the same rung shape in every 1160 cam listener; the i_ tag stays an Input parameter (Studio's verify warning on the in-program write is accepted).`,
      `XIC(vb01_UpperValveBank_IN.${P.extInBit})OTE(i_PierceExtended);`],
    ...LOGIC_INPUT_RUNGS,
    [`Pierce Derived State - one-sensor form (Extended switch only; S05_PortLoad insertion form mirrored to the far position).\n\nExtended = Extended switch made, extend commanded, retract off.\nRetracted = the position no sensor covers: retract commanded, extend off, Extended switch clear, and PierceRetractDelay done (80 ms seed = nominal stroke, HMI-adjustable; sized to prove Retracted before the 270 deg deadline). Pneumatic drawing 1160-P-001 draws only ${P.prx} Extended on slot ${P.slot} - a Retracted switch is a BOM add; until then this derived bit is the dial index permissive proof (p_PierceRetracted) and the immediate-stop deadline proof. Consumers test these bits, never the raw switch or output.`,
      'XIC(i_PierceExtended)XIC(q_ExtendPierce)XIO(q_RetractPierce)OTE(PierceExtended);'],
    ['', 'XIC(q_RetractPierce)XIO(q_ExtendPierce)XIO(i_PierceExtended)TON(PierceRetractDelay,?,?)XIC(PierceRetractDelay.DN)OTE(PierceRetracted);'],
    ['Manual Extend Permissive\n\nS05_PortLoad OkMan form: the Pierce needle is extended by hand only in Manual, with safety OK and the chassis cam neither running nor jogging (tooling protection - the tooling must be parked, never moving, with a needle out). Retract is always permitted in Manual (no permissive).',
      `XIC(ManualMode)XIC(SafetyOK)XIO(${CH}.Running)XIO(${CH}.Jogging)OTE(OkManExtendPierce);`],
    ...HMI_CLEAR_RUNGS,
  ]);

  const R02 = routine('R02_Logic', [
    ['Load Station Numbers\n\nS07 Port Cut = dial position 7; predecessor S06 Port Verify (Station 6). Template S02_ProbeCheck R02 rung 0 shape.', 'MOVE(7,StaNum)MOVE(6,StaNumPre);'],
    [`Load Nest Numbers\n\n1160 two-up: one fixture number per index; this twin reads and writes only the side ${L} (${word} nest) members of Nest[n].PartStatus. S07 acts after the index is complete, so every qualification and write uses NestNumCurrent; NestNumIncoming is loaded (template rung 1) but never written against.`,
      `MOVE(${TR}.Station[StaNum].NestNum,NestNumCurrent)MOVE(${TR}.Station[StaNumPre].NestNum,NestNumIncoming);`],
    [`Conditions For The Station To Cycle - side ${L} (${word} nest)\n\nS02_ProbeCheck rung 2 full form + the S03_PartLoad EQ(FailureType,0) term (URS reject rule: a part S05 / S06 failed is not pierced - Mark 20:18 'if there's not a septum present, then we wouldn't try to pierce it') + PierceLockout (this program's own side lockout after a broken-tip result). True only for a side S06 verified (or S06 was locked out over) with no failure on the record and no S07 attempt yet, no side-${L} station lockout and no fixture lockout. HMI_Toggle.1 Dry Run is not read (S01_YSiteLoad form).`,
      `XIC(SafetyOK)XIC(CycleRunning)XIO(${sta}.OpStatus.Lockout${L})XIO(PierceLockout)XIO(${TR}.Nest[NestNumCurrent].OpStatus.Lockout)[XIC(${st('NestNumCurrent', 'StaNumPre', 'Success')}) ,XIC(${ps('NestNumCurrent')}.PartLoaded${L}) XIC(${st('NestNumCurrent', 'StaNumPre', 'Lockout')}) ]EQ(${ps('NestNumCurrent')}.FailureType${L},0)XIO(${st('NestNumCurrent', 'StaNum', 'Attempt')})OTE(CycleStation);`],
    [`Station Locked Out - stamp the step as skipped (not failed) on the side-${L} part record (S02_ProbeCheck rung 3 shape) while side ${L} of the station is locked out on the HMI OR while this program has locked the Pierce out after a broken-tip result (PierceLockout), so S08-S13 treat S07 as skipped on this side. Only a part not yet attempted here is stamped - a part attempted this dwell carries its own Success / Failure (added because the side lockout can latch mid-dwell). FLAG (Mark Q5b, plan): an unslit septum is not a saleable part - if Mark rules unslit parts are rejects, this stamp becomes Failure + FailureType 75 'Pierce Locked Out'.`,
      `XIC(SafetyOK)XIC(CycleRunning)XIC(${ps('NestNumCurrent')}.PartLoaded${L})XIO(${st('NestNumCurrent', 'StaNum', 'Attempt')})[XIC(${sta}.OpStatus.Lockout${L}) ,XIC(PierceLockout) ]OTL(${st('NestNumCurrent', 'StaNum', 'Lockout')});`],
    [`Extend Pierce And Vacuum Shroud On\n\n***NestNumCurrent Used Because The Needle Fires After The Dial Index Is Complete, Inside The Middle-Hub Down Dwell***\n\nS01_PartLoad rung 3 window form: ONE Chassis_CamPos_Check window at g_S07_PierceExtendAngle (controller-scope, shared by both twins; seed 195 deg, timing advance ON = actuator command; the AOI output is a one-shot). A qualified side latches Station[7].Attempt${L} on its part record, pulses CamExtendPierce (sealed in the output rung until the retract pulse) and pulses CamVacuumShroudOn (Mark 23:42 / 24:08: the exhaust shroud runs while slitting and retracting - on from the extend window, off at the inspect window). A side that is not qualified (no septum, failed upstream, locked out) stays retract-commanded and nothing is written - S06 already carries its reason. Pierced is cleared here so the tip check is rebuilt fresh each cycle.`,
      `XIO(ManualMode)${CAMCHK('CamPosCheckA', 'g_S07_PierceExtendAngle', 1)}XIC(CycleStation)[OTL(${st('NestNumCurrent', 'StaNum', 'Attempt')}) ,OTE(CamExtendPierce) ,OTE(CamVacuumShroudOn) ,OTU(Pierced) ];`],
    [`Retract Pierce And Prove Extended\n\nSecond command window at g_S07_PierceRetractAngle (seed 250 deg, timing advance ON): when the extend output is sealed on (q_ExtendPierce = commanded this cycle) the retract pulse fires - the mechanical stripper holds the septum while the needle draws out (Mark 20:18). The same instant proves the stroke: PierceExtended (switch made, R01 derived) -> Pierced = this side is slit and its cutter tip is due for the check at the inspect window. Extended NOT made with Bypass off = the septum was not slit -> Failure${L}, FailureType${L} 71 'Pierce Did Not Extend' (StaNum x 10 + 1), FailureMessage${L} = g_StationList[7] + FailureMessages[0], ConsecFails + 1, no tip check (a needle that did not reach the part has nothing to inspect); the retract is commanded anyway. NO in-window retry - the down dwell has no room for a second stroke; the next fixture is a fresh attempt. Side-${L} station Bypass forces the pierced path (the inspect window then forces Success). No extend-fault timer: the cam window is the deadline (S02 shape).`,
      `XIO(ManualMode)${CAMCHK('CamPosCheckB', 'g_S07_PierceRetractAngle', 1)}XIC(q_ExtendPierce)[OTE(CamRetractPierce) ,[XIC(PierceExtended) ,XIC(${sta}.OpStatus.Bypass${L}) ] OTL(Pierced) ,XIO(PierceExtended) XIO(${sta}.OpStatus.Bypass${L}) [OTU(${st('NestNumCurrent', 'StaNum', 'Success')}) ,OTL(${st('NestNumCurrent', 'StaNum', 'Failure')}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(71,${ps('NestNumCurrent')}.FailureType${L}) ,CONCAT(g_StationList[StaNum],FailureMessages[0],${ps('NestNumCurrent')}.FailureMessage${L}) ] ];`],
    [`Check Pierce Retracted Before The Chassis Raises The Tooling\n\nS02_ProbeCheck rung 5 'Check Probe Off When Station Retracted' form, read window at g_S07_PierceDeadlineAngle (seed 270 deg = 17.5 deg / 58 ms before the middle hub leaves down-place at 287.5; timing advance OFF - a check). The needle not derived-retracted (retract commanded, extend off, Extended switch clear for the retract delay - a stuck Extended switch or a needle still in the part both fail this) latches PierceNotRetracted -> p_ImmediateStopRequest -> Chassis 'Immediate Stop Conditions' -> ChassisControl.ImmedStop, so the chassis stops before it lifts the tooling through the part; R20 Alarm[1] FAULT. Checked every cycle regardless of qualification - a non-qualified side is retract-commanded by default and must prove it. Not gated by station lockout: this is a physical proof.\n\nTIMING (1.2 s cycle = 3.3 ms/deg): retract commanded ~237 deg (250 less ~13 deg timing advance at 300 deg/s), switch clears ~240, PierceRetractDelay 80 ms -> Retracted ~264 deg, deadline 270 - about 20 ms margin. Mark Q6 (retract may finish as the hub starts to rise at 287.5?) and the Retracted-switch BOM add are the real fixes - the angles and the delay are HMI-adjustable meanwhile.`,
      `XIO(ManualMode)${CAMCHK('CamPosCheckC', 'g_S07_PierceDeadlineAngle', 0)}XIO(PierceRetracted)OTL(PierceNotRetracted);`],
    ['Clear the not-retracted latch - Fault Reset with the needle now proven retracted (a Fault Reset with the needle still down keeps the immediate stop request up; the operator retracts it in Manual first).',
      'XIC(FaultReset)XIC(PierceRetracted)OTU(PierceNotRetracted);'],
    [`Dial Index Permissive (Public)\n\np_PierceRetracted = the side-${L} needle derived-retracted, published every scan -> Chassis R01 'Chassis Dial Index Permissives' IndexPermissiveStatus[7] = XIC(\\S07_PortCutA.p_PierceRetracted) XIC(\\S07_PortCutB.p_PierceRetracted) ('S07 Pierce Not Retracted' when false). The needle is the only S07 device that enters a nest under its own power (the tooling itself rides the hub - no software interlock for the cam-enforced motion).`,
      'XIC(PierceRetracted)OTE(p_PierceRetracted);'],
    [`Immediate Stop Request (Public)\n\nThe not-retracted latch -> p_ImmediateStopRequest -> Chassis R01 'Chassis Immediate Stop Conditions' (ChassisControl.ImmedStop, chassis state 37); Chassis ORs \\S07_PortCutA and \\S07_PortCutB. Held until Fault Reset with the needle retracted (previous rungs).`,
      'XIC(PierceNotRetracted)OTE(p_ImmediateStopRequest);'],
    [`Cutter Tip Check And Vacuum Shroud Off\n\nRead window at g_S07_CutterInspectAngle (seed 300 deg, timing advance OFF): the needle is back and the tooling is still down (Mark 20:18: 'when it's in the retracted position here, we take a picture of it with the two IV4 sensors to make sure that the tip of the needle didn't break off in the part'). S02_ProbeCheck verify-rung shape on the side that pierced this cycle: i_CutterPresentOK (the ${word} Cutter Present Camera result - an unmapped Input parameter awaiting Jason IV4 standard program) OR CutterCameraBypass (seeded ON) OR side-${L} station Bypass -> Success${L}, ConsecFails cleared. All three off = the tip broke off in the part -> Failure${L}, FailureType${L} 72 'Cutter Tip Not Present' (StaNum x 10 + 2), FailureMessage${L} = g_StationList[7] + FailureMessages[1], ConsecFails + 1, AND PierceLockout latched: the needle is broken, so side ${L} is no longer pierced (rung 2) and its parts are stamped skipped (rung 3) until the needle is replaced and Fault Reset pressed - Severity 1 warning in R20. Pierced is cleared so the check runs once per fixture. The shroud-off pulse fires here every cycle (Mark 24:08 'turn it off as we're raising up'). The v0 PLC-triggered IV4 handshake (demand / ready / trigger / busy / store / acknowledge / timeout) is REMOVED - Jason's IV4 standard program will own the camera and drive i_CutterPresentOK.`,
      `XIO(ManualMode)${CAMCHK('CamPosCheckD', 'g_S07_CutterInspectAngle', 0)}[XIC(Pierced) [[XIC(i_CutterPresentOK) ,XIC(CutterCameraBypass) ,XIC(${sta}.OpStatus.Bypass${L}) ] [OTL(${st('NestNumCurrent', 'StaNum', 'Success')}) ,OTU(${st('NestNumCurrent', 'StaNum', 'Failure')}) ,MOVE(0,ConsecFails.Count) ] ,XIO(i_CutterPresentOK) XIO(CutterCameraBypass) XIO(${sta}.OpStatus.Bypass${L}) [OTU(${st('NestNumCurrent', 'StaNum', 'Success')}) ,OTL(${st('NestNumCurrent', 'StaNum', 'Failure')}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(72,${ps('NestNumCurrent')}.FailureType${L}) ,CONCAT(g_StationList[StaNum],FailureMessages[1],${ps('NestNumCurrent')}.FailureMessage${L}) ,OTL(PierceLockout) ] ,OTU(Pierced) ] ,OTE(CamVacuumShroudOff) ];`],
    [`Pierce Control\n\nOne rung per output, auto and manual in the same rung with the seal-in inside (S01_PartLoad rungs 5-6). Auto: the extend pulse seals on until the retract pulse at g_S07_PierceRetractAngle - a stop mid-dwell leaves the needle where the hub-lowered tooling already holds it, and the retract window fires when the cam resumes (template shape, no cycle term in the seal). Manual: HMI_Momentary.0 extend (OkManExtendPierce: cam parked) / .1 retract.`,
      '[XIO(ManualMode) [XIC(CamExtendPierce) ,XIC(q_ExtendPierce) XIO(CamRetractPierce) ] ,XIC(ManualMode) [XIC(HMI_Momentary.0) XIC(OkManExtendPierce) ,XIC(q_ExtendPierce) XIO(HMI_Momentary.1) ] ]OTE(q_ExtendPierce);'],
    ['Retract Pierce - the mirror, plus the default leg: in auto the retract solenoid is commanded whenever extend is not (power-up, cycle stop, non-qualified side) - the double-solenoid valve is driven to the retracted position, which is what p_PierceRetracted (dial index permissive) and the deadline check prove. Manual: HMI_Momentary.1 retract / .0 extend, retract always permitted.',
      '[XIO(ManualMode) [XIC(CamRetractPierce) ,XIC(q_RetractPierce) XIO(CamExtendPierce) ,XIO(q_ExtendPierce) ] ,XIC(ManualMode) [XIC(HMI_Momentary.1) ,XIC(q_RetractPierce) XIO(HMI_Momentary.0) ] ]OTE(q_RetractPierce);'],
    [`Vacuum Shroud Control\n\nSingle-solenoid spring-return valve (vb02 slot ${P.shroudSlot}) to the Exair vacuum generator: one output, ON = exhaust running. Auto: on-pulse from the extend window seals until the off-pulse from the inspect window (Mark 24:08: on while lowering / slitting / retracting, off as it raises); the seal also drops when the cycle stops. Manual: HMI_Momentary.2 on / .3 off. Mark's 'leave it on all the time' fallback (24:31) = widen g_S07_PierceExtendAngle / g_S07_CutterInspectAngle on the HMI or hold it in Manual - no toggle bit is assigned.`,
      '[XIO(ManualMode) [XIC(CamVacuumShroudOn) ,XIC(q_VacuumShroudOn) XIO(CamVacuumShroudOff) XIC(CycleRunning) ] ,XIC(ManualMode) [XIC(HMI_Momentary.2) ,XIC(q_VacuumShroudOn) XIO(HMI_Momentary.3) ] ]OTE(q_VacuumShroudOn);'],
    [`Station Performance\n\nSide ${L} instance accumulating into Station[7].PerformData side-${L} counters; the AOI edge-detects its own Attempt / Success. Both read the live nest (S02 form).`,
      perf(L, st('NestNumCurrent', 'StaNum', 'Attempt'), st('NestNumCurrent', 'StaNum', 'Success'))],
    [`Valve Bank Output Mapping - Upper Bank (Pierce)\n\n1160: vb01 Upper Valve Bank (SMC EX600-SEN7, HHB-183731, pneumatic drawing 1160-P-001) slot ${P.slot} = ${word} Pierce (Extended ${P.prx}), SY3200 double solenoid. Contract bit rule: slot n -> output bits 2n-2 (A = extend) and 2n-1 (B = retract), bit i at vb01_UpperValveBank_OUT.Data[i/8].(i mod 8): slot ${P.slot} -> bits ${P.bits} = ${P.extBit} extend / ${P.retBit} retract. MapOutputs copies vb01_UpperValveBank_OUT to the module; this program never writes the module tag. Confirm against the SMC configurator.`,
      `[XIC(q_ExtendPierce) OTE(vb01_UpperValveBank_OUT.${P.extBit}) ,XIC(q_RetractPierce) OTE(vb01_UpperValveBank_OUT.${P.retBit}) ];`],
    [`Valve Bank Output Mapping - Table Bank (Vacuum Shroud)\n\n1160: vb02 Table Valve Bank (SMC EX600-SEN7, HHB-183728, pneumatic drawing 1160-P-002) slot ${P.shroudSlot} = ${word} Vacuum Shroud, SY3100 single solenoid to the vacuum generator (single valves use bit 2n-2 only): slot ${P.shroudSlot} -> bit ${P.shroudBitNo} = ${P.shroudBit}. MapOutputs copies vb02_TableValveBank_OUT to the module. Confirm against the SMC configurator / 1160-P-002.`,
      `XIC(q_VacuumShroudOn)OTE(vb02_TableValveBank_OUT.${P.shroudBit});`],
  ]);

  const R20 = routine('R20_Alarms', [
    [`Consecutive Failures\n\nCheck-station form: FAULT held until Fault Reset (template S02_ProbeCheck); ConsecFails.Setpoint default 3, HMI-settable. Counts every side-${L} S07 failure (did not extend 71, tip not present 72); a pass clears it. Message = g_StationList[7] + AlarmList[0].`,
      `[XIC(CycleRunning) XIO(${sta}.OpStatus.Lockout${L}) GE(ConsecFails.Count,ConsecFails.Setpoint) ,XIC(Alarm[0].Active) XIO(FaultReset) ]${alarmOut(0, 3, false)};`],
    ['', 'XIC(Alarm[0].Active)MOVE(0,ConsecFails.Count);'],
    [`Pierce Not Retracted Before Chassis Raise\n\nFAULT driven by the R02 deadline latch (PierceNotRetracted), which is itself the seal: it clears only on Fault Reset with the needle proven retracted, and while it stands p_ImmediateStopRequest holds the chassis. Chassis side: AlarmIndexPerm 'S07 Pierce Not Retracted' and the ImmedStop warning.`,
      `XIC(PierceNotRetracted)${alarmOut(1, 4, false)};`],
    [`Cutter Tip Not Present - Pierce Locked Out\n\nSeverity 1 WARNING while this program holds side ${L} locked out after a broken-tip result (R02 cutter tip check): the machine keeps running, side ${L} is skipped (stamped Station[7].Lockout${L}), the operator replaces the needle and presses Fault Reset (next rung). Mark Q5 decides stop-on-first-failed-picture vs keep-running; built as keep-running with the warning (the ConsecFails fault still stops the machine on repeated pierce failures). Inert while CutterCameraBypass is ON.`,
      `XIC(PierceLockout)${alarmOut(2, 5, true)};`],
    ['Fault Reset clears the Pierce lockout (needle replaced). If the tip is still missing the next check locks the side out again with one more reject.', 'XIC(FaultReset)OTU(PierceLockout);'],
    [`Station Bypassed\n\nSeverity 1 warning - side-${L} Bypass forces the pierced path and stamps Success without a tip check; it must never run silently (S02 R20 form).`,
      `XIC(${sta}.OpStatus.Bypass${L})${alarmOut(3, 6, true)};`],
    [`Station Locked Out\n\nSeverity 1 warning - a locked-out side pierces nothing and stamps Station[7].Lockout${L} in R02.`,
      `XIC(${sta}.OpStatus.Lockout${L})${alarmOut(4, 7, true)};`],
    ['', ALARM_HANDLER],
    ['Station Fault Count', faultCount(L)],
  ]);

  const description = `S07 Port Cut - Side ${L} (${WORD} nest) - cam listener with pneumatic actions (2-UP S02_ProbeCheck + S01_PartLoad shape). Middle-hub down dwell: extend the ${word} Pierce (vb01 slot ${P.slot}), retract, prove retracted by g_S07_PierceDeadlineAngle (else p_ImmediateStopRequest + fault), run the ${word} Vacuum Shroud (vb02 slot ${P.shroudSlot}), check the cutter tip at g_S07_CutterInspectAngle (i_CutterPresentOK unmapped, CutterCameraBypass ON awaiting Jason IV4 standard program). Twin of ${other}: side members, points, text differ.`;
  return program(name, description, tags, [R00, R01, R02, R20]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Diff-verify + lint + manifest
// ═══════════════════════════════════════════════════════════════════════════
// Every A-vs-B difference must be explained by side letter / side word / points / text: neutralize BOTH files with the
// same token map and require equality (structure check), then verify DIRECTION (a twin's rung text touches only its own side).
const MEMBER = '(Attempt|Success|Failure|Lockout|Recycle|PartLoaded|Good|Bad|Recycled|Sample|FailureType|FailureMessage|RecycleCount|Bypass|Faulted|Warning|Attempts|Successes|Failures|Efficiency|FaultCount|HMIColorStatus)';
const NEUTRAL = [
  [/(S\d\d_[A-Za-z]+)(A|B)\b/g, '$1X'],
  [/\b(Side|side)[ -](A|B)\b/g, '$1 X'],
  [new RegExp(MEMBER + '(A|B)\\b', 'g'), '$1X'],
  [/\b(RIGHT|LEFT)\b/g, 'SIDE'], [/\b(Right|Left)\b/g, 'Side'], [/\b(RT|LT)\b/g, 'XT'],
  [/\b[Ss]lot (?:6|7|8|9|10|11)\b/g, 'slot N'], [/bits (?:14\/15|16\/17|18\/19|20\/21)/g, 'bits N'],
  [/Data\[[12]\]\.[0-7]\b/g, 'Data[N].N'], [/PauseReason [78]\)/g, 'PauseReason N)'],
  [/\b(input|point|Point) 1[23]\b/g, '$1 N'], [/152[04](PRX|CBL)/g, '152N$1'], [/\bIN[45]\b/g, 'INN'], [/\bbit 1[02]\b/g, 'bit N'],
  [/cam0[56]_(?:Right|Left|Side)CutterPresent/g, 'cam0N_SideCutterPresent'], [/192\.168\.1\.3[56]/g, '192.168.1.3N'],
];
const neutral = (line) => NEUTRAL.reduce((acc, [re, rep]) => acc.replace(re, rep), line);

function diffTwins(aText, bText, L = { A: 'A', B: 'B' }, allowOther = { A: 0, B: 0 }) {
  const a = aText.split('\n'), b = bText.split('\n');
  const out = { diffLines: 0, sameLineCount: a.length === b.length, unexplained: [], diff: [], direction: [] };
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const la = a[i] ?? '', lb = b[i] ?? '';
    if (la === lb) continue;
    out.diffLines++;
    const ta = la.split(/(\s+|[(),;\[\]])/), tb = lb.split(/(\s+|[(),;\[\]])/);
    const changes = [];
    for (let k = 0; k < Math.max(ta.length, tb.length); k++) if ((ta[k] ?? '') !== (tb[k] ?? '')) changes.push(`${(ta[k] ?? '').slice(0, 40)} -> ${(tb[k] ?? '').slice(0, 40)}`);
    const uniq = [...new Set(changes)].slice(0, 6);
    out.diff.push(`L${i + 1}: ${uniq.join(' | ')}${changes.length > 6 ? ' | ...' : ''}`);
    if (neutral(la) !== neutral(lb)) out.unexplained.push({ line: i + 1, a: la.slice(0, 200), b: lb.slice(0, 200) });
  }
  // direction: in each twin's RUNG TEXT every tracking member suffix is its own letter (allowOther = whitelisted other-side reads)
  for (const [letter, text] of [['A', aText], ['B', bText]]) {
    const other = letter === 'A' ? 'B' : 'A';
    const rungs = [...text.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1]).join('\n');
    const wrong = [...rungs.matchAll(new RegExp(MEMBER + other + '\\b', 'g'))].map((m) => m[0]);
    if (wrong.length !== allowOther[letter]) out.direction.push(`twin ${letter}: ${wrong.length} other-side member token(s) in rung text (${wrong.join(', ') || 'none'}), ${allowOther[letter]} allowed`);
    const progRefs = [...rungs.matchAll(/\\(S\d\d_[A-Za-z]+)(A|B)\b/g)].filter((m) => m[2] !== letter);
    if (progRefs.length) out.direction.push(`twin ${letter}: rung text references the other twin: ${progRefs.map((m) => m[0]).join(', ')}`);
  }
  return out;
}

// ── lint: ASCII, description length, no Use=, well-formed-ish, tag roots declared ──
const CONTROLLER_KNOWN = new Set([
  // template ControllerTags.xml (ChassisStandard_2UP) that these programs read
  'g_CPUDateTime', 'g_MachineBasic', 'g_PresetStationPerformHigh', 'g_PresetStationPerformLow', 'g_StationList',
  // 1160 module buffers (v0 ControllerTags.xml, carried forward by the controller builder)
  'vb01_UpperValveBank_IN', 'vb01_UpperValveBank_OUT', 'vb02_TableValveBank_OUT',
  // contract angle tags (controller-scope REALs shared by A/B twins) - requested below
  'g_S14_GripperCloseAngle', 'g_S14_GripperOpenAngle', 'g_S14_DropCheckAngle',
  'g_S07_PierceExtendAngle', 'g_S07_PierceRetractAngle', 'g_S07_PierceDeadlineAngle', 'g_S07_CutterInspectAngle',
]);
const CONTRACT_PROGRAMS = new Set(['Supervisor', 'Tracking', 'Chassis', 'MapInputs', 'S01_YSiteEscapement', 'S01_YSiteLoadA', 'S01_YSiteLoadB', 'S02_YVerifyA', 'S02_YVerifyB', 'S03_YSiteInspectA', 'S03_YSiteInspectB', 'S05_PortLoad', 'S06_PortVerifyA', 'S06_PortVerifyB', 'S07_PortCutA', 'S07_PortCutB', 'S08_YHeatB', 'S09_PortCloseB', 'S10_YHeatA', 'S11_PortCloseA', 'S12_OpticalCheck', 'S13_PhysicalCheckA', 'S13_PhysicalCheckB', 'S14_GoodUnloadA', 'S14_GoodUnloadB', 'S14_BinDiverter', 'S15_RejectUnload', 'S16_EmptyNestA', 'S16_EmptyNestB', 'MapOutputs', 'Production', 'Alarms', 'HMI', 'SafetyProgram']);
const AOIS = new Set(['AOI_Debounce', 'Chassis_CamPos_Check', 'StationPerformance', 'ProgramAlarmHandler']);
const MNEMONICS = new Set(['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'TON', 'MOVE', 'COP', 'ADD', 'EQ', 'NE', 'GE', 'CONCAT', 'JSR']);

function lintProgram(xml, fileName) {
  const findings = [];
  const nonAscii = [...xml.matchAll(/[^\x09\x0A\x0D\x20-\x7E]/g)];
  if (nonAscii.length) findings.push(`${fileName}: ${nonAscii.length} non-ASCII character(s)`);
  if (/\sUse="/.test(xml)) findings.push(`${fileName}: Use= attribute present`);
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Description>/g)) if (m[1].length > 512) findings.push(`${fileName}: Description ${m[1].length} chars > 512: "${m[1].slice(0, 60)}..."`);
  for (const m of xml.matchAll(/<Comment(?: Operand="[^"]*")?>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/g)) if (m[1].length > 5000) findings.push(`${fileName}: rung comment ${m[1].length} chars`);
  // STRING LEN vs text
  for (const m of xml.matchAll(/<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="(\d+)"\/>\s*<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\s*<!\[CDATA\[(.*?)\]\]>/g)) {
    const txt = m[2].replace(/^'|'$/g, '');
    if (Number(m[1]) !== txt.length) findings.push(`${fileName}: STRING LEN ${m[1]} != ${txt.length} for "${txt}"`);
    if (txt.length > 82) findings.push(`${fileName}: STRING > 82 chars "${txt}"`);
  }
  // tag roots declared
  const tagsBlock = (xml.match(/<Tags>([\s\S]*?)<\/Tags>/) || [])[1] || '';
  const local = new Map();
  for (const m of tagsBlock.matchAll(/<Tag Name="([^"]+)"([^>]*?)\/?>/g)) local.set(m[1], { usage: (m[2].match(/Usage="([^"]+)"/) || [])[1] || null, dataType: (m[2].match(/DataType="([^"]+)"/) || [])[1] });
  const controllerUsed = new Set(), xrefs = new Set(), undeclared = new Set(), used = new Set();
  const rungs = [...xml.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1]);
  for (const text of rungs) {
    for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      const mn = m[1];
      if (!MNEMONICS.has(mn) && !AOIS.has(mn)) findings.push(`${fileName}: unknown instruction ${mn}`);
      const args = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      args.forEach((arg, idx) => {
        if (mn === 'JSR' && idx === 0) return;
        if (arg === '?' || /^-?\d/.test(arg)) return;
        const xr = arg.match(/^\\([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
        if (xr) { xrefs.add(`\\${xr[1]}.${xr[2]}`); if (!CONTRACT_PROGRAMS.has(xr[1])) findings.push(`${fileName}: \\${xr[1]} is not a NAMES CONTRACT program`); return; }
        const root = (arg.match(/^([A-Za-z_][A-Za-z0-9_]*)/) || [])[1];
        if (!root) return;
        used.add(root);
        if (local.has(root)) return;
        if (CONTROLLER_KNOWN.has(root)) { controllerUsed.add(root); return; }
        undeclared.add(root);
      });
    }
  }
  for (const u of undeclared) findings.push(`${fileName}: undeclared tag root "${u}"`);
  // declared but never used in a rung (parameters excluded: they are the interface)
  const unused = [...local.keys()].filter((t) => !used.has(t) && !local.get(t).usage && !/^(Alarm|AlarmList|AOI_ProgramAlarmHandler|CamPosCheck[A-D]|ONS|HMI_Toggle|ZeroPartAssyStat)$/.test(t) && !/Debounce$|Delay$|Timer$|^StationPerformance$/.test(t));
  // params: inputs written in-program are accepted (vb01 mapping); outputs never written are a finding
  for (const [t, d] of local) if (d.usage === 'Output' && !rungs.some((r) => new RegExp(`(OTE|OTL|OTU)\\(${t}\\)|,${t}\\)|,${t},|\\(${t},`).test(r))) findings.push(`${fileName}: Output ${t} never written`);
  return { findings, unused, controllerUsed: [...controllerUsed].sort(), crossProgramRefs: [...xrefs].sort(), tags: local.size, params: [...local.entries()].filter(([, d]) => d.usage).map(([t, d]) => `${t} (${d.usage} ${d.dataType})`), routines: [...xml.matchAll(/<Routine Name="([^"]+)"/g)].map((m) => m[1]), rungCount: rungs.length };
}

// ── requested controller tags (contract angle seeds) ────────────────────────
const REQUESTED_CONTROLLER_TAGS = [
  { name: 'g_S14_GripperCloseAngle', dataType: 'REAL', seed: 230.0, description: 'S14 Good Unload - cam angle (deg) to close the Unload Grippers over the dial - HMI setup value, timing advance 1 (timing sheet 230). Shared by S14_GoodUnloadA / B.' },
  { name: 'g_S14_GripperOpenAngle', dataType: 'REAL', seed: 50.0, description: 'S14 Good Unload - cam angle (deg) to open the Unload Grippers over the chute - HMI setup value, timing advance 1 (timing sheet 50). Shared by S14_GoodUnloadA / B.' },
  { name: 'g_S14_DropCheckAngle', dataType: 'REAL', seed: 100.0, description: 'S14 Good Unload - cam angle (deg) at which the drop sensor must have seen the released parts - HMI setup value, timing advance 0. Zero Part Tracking = +10 deg. Shared by S14_GoodUnloadA / B.' },
  { name: 'g_S07_PierceExtendAngle', dataType: 'REAL', seed: 195.0, description: 'S07 Port Cut - cam angle (deg) to extend the Pierce needles on the qualified sides and turn the Vacuum Shrouds on (timing advance 1). Seed 195 from the timing sheet. Shared by S07_PortCutA / B.' },
  { name: 'g_S07_PierceRetractAngle', dataType: 'REAL', seed: 250.0, description: 'S07 Port Cut - cam angle (deg) to retract the Pierce needles and prove each commanded side reached Extended (timing advance 1). Seed 250 from the timing sheet. Shared by S07_PortCutA / B.' },
  { name: 'g_S07_PierceDeadlineAngle', dataType: 'REAL', seed: 270.0, description: 'S07 Port Cut - cam angle (deg) by which each Pierce needle must be derived-retracted; a side not retracted latches p_ImmediateStopRequest and faults (timing advance 0). Seed 270 (plan-chosen - question for Mark). Shared by S07_PortCutA / B.' },
  { name: 'g_S07_CutterInspectAngle', dataType: 'REAL', seed: 300.0, description: 'S07 Port Cut - cam angle (deg) for the cutter tip check on the sides that pierced and the Vacuum Shrouds off (timing advance 0). Seed 300 from the timing sheet. Shared by S07_PortCutA / B.' },
].map((t) => ({ ...t, xml: `<Tag Name="${t.name}" TagType="Base" DataType="REAL" Radix="Float" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Description>\n<![CDATA[${t.description}]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[${t.seed.toExponential(8).replace('e+', 'e+0').replace('e-', 'e-0')}]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="REAL" Radix="Float" Value="${t.seed.toFixed(1)}"/>\n</Data>\n</Tag>` }));

// ── main ────────────────────────────────────────────────────────────────────
const built = {
  S14: { A: buildS14(SIDES.A), B: buildS14(SIDES.B) },
  S07: { A: buildS07(SIDES.A), B: buildS07(SIDES.B) },
};
const manifest = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/experiments/twins1160_S07_S14.cjs',
  contract: 'generated/1160/build/NAMES_CONTRACT.md (v2.1, Jason 2026-09-17 11:58: A = LEFT, B = RIGHT)',
  sources: { S14: 'generated/1160/build_v0/programs/S14_GoodUnload.xml', S07: 'generated/1160/build_v0/programs/S07_PortCut.xml' },
  templateShape: { S14: 'generated/1160/ref/ChassisStandard_2UP/Program_S19_GoodUnloadA.xml', S07: 'generated/1160/ref/ChassisStandard_2UP/Program_S02_ProbeCheckA.xml + Program_S01_PartLoadA.xml' },
  controllerScopeSource: ['generated/1160/build/controller/ControllerTags.xml (not yet delivered - checked against the template ControllerTags.xml + v0 module buffers + the requested angle tags below)'],
  twins: [],
  requestedControllerTags: REQUESTED_CONTROLLER_TAGS,
  consumersToUpdate: [],
  findings: [],
};
let hard = 0;
for (const [station, pair] of Object.entries(built)) {
  const base = station === 'S14' ? 'S14_GoodUnload' : 'S07_PortCut';
  const rec = {};
  for (const L of ['A', 'B']) {
    const name = `${base}${L}`;
    const file = `generated/1160/build/programs/${name}.xml`;
    const lint = lintProgram(pair[L], name);
    rec[L.toLowerCase()] = { file, program: name, tags: lint.tags, params: lint.params, routines: lint.routines, rungs: lint.rungCount, controllerTagsUsed: lint.controllerUsed, crossProgramRefs: lint.crossProgramRefs, unusedLocalTags: lint.unused };
    for (const f of lint.findings) { manifest.findings.push(f); hard++; }
    if (!CHECK_ONLY) fs.writeFileSync(path.join(OUT_DIR, `${name}.xml`), pair[L], 'utf8');
  }
  const d = diffTwins(pair.A, pair.B, undefined, station === 'S14' ? { A: 1, B: 1 } : { A: 0, B: 0 }); // S14: the zero rung reads the OTHER side's PartLoaded once
  rec.diffLines = d.diffLines;
  rec.sameLineCount = d.sameLineCount;
  rec.diff = d.diff;
  rec.unexplainedDiffs = d.unexplained;
  rec.directionChecks = d.direction;
  if (d.direction.length) { for (const x of d.direction) manifest.findings.push(`${base}: ${x}`); hard++; }
  if (!d.sameLineCount) { manifest.findings.push(`${base}: A and B have different line counts`); hard++; }
  if (d.unexplained.length) { manifest.findings.push(`${base}: ${d.unexplained.length} A/B difference(s) not explained by side members / points / text`); hard++; }
  manifest.twins.push(rec);
}
manifest.consumersToUpdate = [
  // status as probed 2026-09-17 12:35 against generated/1160/build/programs (other builders write concurrently)
  'DONE - Chassis: reads \\S07_PortCutA/B.p_PierceRetracted, \\S07_PortCutA/B.p_ImmediateStopRequest, \\S14_GoodUnloadA/B.q_PauseRequest (PauseReason 7 / 8)',
  'DONE - Alarms: rolls up \\S07_PortCutA/B and \\S14_GoodUnloadA/B q_AlarmActive / q_WarningActive',
  'DONE - Production: good = \\S14_GoodUnloadA.q_IncrementGood + \\S14_GoodUnloadB.q_IncrementGood (R01 rung 1, R02 rung 4). NOTE: no reader of q_IncrementMissedDrop (v0 Production counted FailureTypeCounts[141] from \\S14_GoodUnload.q_IncrementMissedDrop) - both twins still publish it; wire it or drop the count',
  'DONE - S14_BinDiverter: counts \\S14_GoodUnloadA/B.q_IncrementGood into the active bin; state 7 -> 10 permissive = XIC(\\S14_GoodUnloadA.p_ChuteClear) XIC(\\S14_GoodUnloadB.p_ChuteClear); p_ActiveBin stays Public DINT (the twins read it: 1 = Right, 2 = Left, as the receiving-bin permissive in their cycle condition)',
  'DONE - Tracking R02: good-unload trigger = XIC(\\S14_GoodUnloadA.q_IncrementGood) OTE(IncrementSuccessA) / B',
  'DONE - ControllerTags.xml: g_S07_PierceExtendAngle / PierceRetractAngle / PierceDeadlineAngle / CutterInspectAngle and g_S14_GripperCloseAngle / GripperOpenAngle / DropCheckAngle present with the contract seeds; vb01_UpperValveBank_IN/_OUT, vb02_TableValveBank_OUT present. requestedControllerTags below is the twins view of the same 7 tags (import-ready XML) for cross-check',
  'DONE - Tasks.xml schedules S07_PortCutA, S07_PortCutB, S14_GoodUnloadA, S14_GoodUnloadB in contract order',
  'PENDING - MapInputs / MapOutputs still CPS cam05_RightCutterPresent / cam06_LeftCutterPresent (_IN/_OUT) - no program consumes them now (the IV4 camera check is a bypassed Input parameter until Jason IV4 standard program). Dead but harmless; drop the two rungs each and the four buffers, or keep them for the IV4 program to consume',
  'PENDING - scripts/assemble1160.cjs CONTRACT_MAIN_TASK still lists the v0 names (S07_PortCut, S14_GoodUnload, S08_RightYHeat ...) - update to the v2.1 program table or the assembler keeps warning contract-unexpected-program / contract-missing-programs',
  'PENDING - S15_RejectUnload (single program, not yet delivered): must zero the whole Nest[n].PartStatus after its blast - the 2-UP UDT has no per-side record; the S14 twins zero the fixture only when the other side has no part left (PartLoaded of the other side = 0), so a nest carrying a reject reaches S15 with the good side already PartLoaded = 0 / Station[14].Success = 1',
];
manifest.summary = {
  programs: manifest.twins.flatMap((t) => [t.a.program, t.b.program]),
  hardFindings: hard,
  ok: hard === 0,
};
if (!CHECK_ONLY) fs.writeFileSync(path.join(OUT_DIR, 'TWINS_MANIFEST_S07_S14.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`twins1160_S07_S14 ${CHECK_ONLY ? '(check only)' : '-> ' + path.relative(ROOT, OUT_DIR)}`);
for (const t of manifest.twins) {
  console.log(`  ${t.a.program} / ${t.b.program}: ${t.a.tags} tags, ${t.a.rungs} rungs, routines ${t.a.routines.join(',')}; diff ${t.diffLines} lines (${t.unexplainedDiffs.length} unexplained)${t.sameLineCount ? '' : ' LINE COUNT MISMATCH'}`);
  console.log(`     controller: ${t.a.controllerTagsUsed.join(', ')}`);
  console.log(`     xrefs: ${t.a.crossProgramRefs.join(', ')}`);
  if (t.a.unusedLocalTags.length) console.log(`     unused local tags: ${t.a.unusedLocalTags.join(', ')}`);
  for (const u of t.unexplainedDiffs.slice(0, 5)) console.log(`     UNEXPLAINED L${u.line}:\n       A: ${u.a}\n       B: ${u.b}\n       B->A: ${u.mappedB}`);
}
for (const f of manifest.findings) console.log(`  FINDING: ${f}`);
console.log(`  ${manifest.summary.ok ? 'OK' : 'FAIL'} - ${hard} hard finding(s)`);
process.exit(hard ? 1 : 0);
