#!/usr/bin/env node
'use strict';
/**
 * author1160Twins.cjs — JOB 1160 A-TWIN AUTHOR (2026-09-17, NAMES CONTRACT v2.1)
 *
 * Emits the hand-authored A (LEFT nest) twins of the four v0 listener programs onto Jason's
 * ChassisStandard_2UP template idiom (Program_S01_PartLoadA / Program_S02_ProbeCheckA /
 * Program_S20_EmptyNestA): the v0 LEFT rungs and tags are kept, the RIGHT ones dropped, and
 *   - tracking members  PartStatusLT.Station[k].X -> PartStatus.Station[k].XA, PartStatusLT.Y -> PartStatus.YA
 *   - Nest[n].OpStatus.LockoutLT (no such member in the 2-UP record) -> XIO(Nest[n].OpStatus.Lockout) + XIO(Station[StaNum].OpStatus.LockoutA)
 *   - Station[StaNum].OpStatus.Lockout|Bypass -> LockoutA|BypassA; PerformData.* -> *A; StationPerformance AOI -> A members (template rung)
 *   - program-local angle tags -> controller-scope g_S##_<Action>Angle (contract seeds); S06/S16 off-proof -> template g_ProbeOffAngle (60 = v0 seed)
 *   - device tags carry no side word (q_CloseGripper, i_PartPresent ...); alarm text 'Side A ...'
 * The B (RIGHT) twins are produced from these by substitution and diff-verified by scripts/twin1160.cjs.
 *
 * Source: generated/1160/build_v0/programs/{S01_YSiteLoad,S02_YVerify,S06_PortVerify,S16_EmptyNest}.xml (import-clean v0.5)
 * Output: generated/1160/build/programs/{S01_YSiteLoadA,S02_YVerifyA,S06_PortVerifyA,S16_EmptyNestA}.xml
 * Run:    node scripts/author1160Twins.cjs && node scripts/twin1160.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'generated/1160/build/programs');

// ── XML helpers (v0 house style: one element per line, no indentation, Decorated data only) ──
const RW = 'Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"';
const RO = 'Constant="false" ExternalAccess="Read Only" OpcUaAccess="None"';
const cdata = (s) => `<![CDATA[${s}]]>`;
const ascii = (s, where) => { const bad = s.match(/[^\x09\x0A\x0D\x20-\x7E]/); if (bad) throw new Error(`${where}: non-ASCII U+${bad[0].codePointAt(0).toString(16)}`); return s; };
const desc = (s, where) => (s ? `<Description>\n${cdata(ascii(s, where))}\n</Description>\n` : '');
const comments = (map) => (map ? `<Comments>\n${Object.entries(map).map(([op, t]) => `<Comment Operand="${op}">\n${cdata(ascii(t, op))}\n</Comment>`).join('\n')}\n</Comments>\n` : '');
const tagOpen = (name, dataType, { dims, usage, radix } = {}) => {
  const access = usage === 'Output' || usage === 'Public' ? RO : RW;
  return `<Tag Name="${name}" TagType="Base" DataType="${dataType}"${dims ? ` Dimensions="${dims}"` : ''}${radix ? ` Radix="${radix}"` : ''}${usage ? ` Usage="${usage}"` : ''} ${access}>`;
};
const boolTag = (name, o = {}) => `${tagOpen(name, 'BOOL', { radix: 'Decimal', usage: o.usage })}\n${desc(o.desc, name)}<Data Format="Decorated">\n<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>`;
const dintTag = (name, o = {}) => `${tagOpen(name, 'DINT', { radix: 'Decimal' })}\n${desc(o.desc, name)}${comments(o.comments)}<Data Format="Decorated">\n<DataValue DataType="DINT" Radix="Decimal" Value="${o.value ?? 0}"/>\n</Data>\n</Tag>`;
const structTag = (name, dataType, o = {}) => `${tagOpen(name, dataType, { dims: o.dims })}\n${desc(o.desc, name)}</Tag>`;
const timerTag = (name, pre) => `${tagOpen(name, 'TIMER')}\n<Data Format="Decorated">\n<Structure DataType="TIMER">\n<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>\n<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="EN" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TT" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DN" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
const consecTag = (name, setpoint, d) => `${tagOpen(name, 'ConsecFails')}\n${desc(d, name)}<Data Format="Decorated">\n<Structure DataType="ConsecFails">\n<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Setpoint" DataType="DINT" Radix="Decimal" Value="${setpoint}"/>\n</Structure>\n</Data>\n</Tag>`;
function strArrayTag(name, dims, values, d) {
  const els = Array.from({ length: dims }, (_, i) => values[i] || '');
  for (const v of els) { ascii(v, name); if (v.length > 82) throw new Error(`${name}: STRING literal ${v.length} chars (> 82): ${v}`); if (v.includes("'")) throw new Error(`${name}: apostrophe in STRING literal: ${v}`); }
  return `${tagOpen(name, 'STRING', { dims })}\n${desc(d, name)}<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="${dims}">\n${els.map((v, i) => `<Element Index="[${i}]">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${v.length}"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n${cdata(v ? `'${v}'` : '')}\n</DataValueMember>\n</Structure>\n</Element>`).join('\n')}\n</Array>\n</Data>\n</Tag>`;
}
const R = (t, c) => ({ t, c });
const routine = (name, rungs) => `<Routine Name="${name}" Type="RLL">\n<RLLContent>\n${rungs.map((r, i) => {
  ascii(r.t, `${name} rung ${i}`); if (r.c) ascii(r.c, `${name} rung ${i} comment`);
  if ((r.t.match(/\(/g) || []).length !== (r.t.match(/\)/g) || []).length || (r.t.match(/\[/g) || []).length !== (r.t.match(/\]/g) || []).length) throw new Error(`${name} rung ${i}: unbalanced () or []`);
  if (!/;$/.test(r.t)) throw new Error(`${name} rung ${i}: missing ';'`);
  return `<Rung Number="${i}" Type="N">\n${r.c ? `<Comment>\n${cdata(r.c)}\n</Comment>\n` : ''}<Text>\n${cdata(r.t)}\n</Text>\n</Rung>`;
}).join('\n')}\n</RLLContent>\n</Routine>`;
const tagName = (xml) => xml.match(/^<Tag Name="([^"]+)"/)[1];
function program(name, description, tags, routines) {
  if (description.length > 512) throw new Error(`${name}: Description ${description.length} chars (> 512)`);
  const sorted = [...tags].sort((a, b) => tagName(a).toLowerCase().localeCompare(tagName(b).toLowerCase()));
  const seen = new Set(); for (const t of sorted) { const n = tagName(t); if (seen.has(n)) throw new Error(`${name}: duplicate tag ${n}`); seen.add(n); }
  return `<Program Name="${name}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">\n<Description>\n${cdata(ascii(description, name))}\n</Description>\n<Tags>\n${sorted.join('\n')}\n</Tags>\n<Routines>\n${routines.join('\n')}\n</Routines>\n</Program>\n`;
}

// ── shared operand roots ─────────────────────────────────────────────────────
const T = '\\Tracking.p_Data';
const NC = (m) => `${T}.Nest[NestNumCurrent].${m}`;
const NI = (m) => `${T}.Nest[NestNumIncoming].${m}`;
const ST = (m) => `${T}.Station[StaNum].${m}`;
const CH = '\\Chassis.ChassisStatus';
const CLEANOUT = '\\HMI.q_CleanoutModeEnabled';
const ESC_READY = '\\S01_YSiteEscapement.p_LeftPartReady';
const CAM = (inst, angle, adv) => `Chassis_CamPos_Check(${inst},${angle},${CH}.CamPosDeg,${adv},${CH}.ActualVelocity)`;
const ALARM_HANDLER = 'ProgramAlarmHandler(AOI_ProgramAlarmHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);';
const FAULT_COUNT = `XIC(q_AlarmActive)ONS(ONS.2)ADD(${ST('PerformData.FaultCountA')},1,${ST('PerformData.FaultCountA')});`;
const STATION_PERF = (attemptNest) => `StationPerformance(StationPerformance,${T}.Nest[${attemptNest}].PartStatus.Station[StaNum].AttemptA,${NC('PartStatus.Station[StaNum].SuccessA')},g_PresetStationPerformLow,g_PresetStationPerformHigh,${ST('PerformData.AttemptsA')},${ST('PerformData.SuccessesA')},${ST('PerformData.FailuresA')},${ST('PerformData.EfficiencyA')},${ST('PerformData.HMIColorStatusA')});`;
const NEST_NUMS = `MOVE(${T}.Station[StaNum].NestNum,NestNumCurrent)MOVE(${T}.Station[StaNumPre].NestNum,NestNumIncoming);`;
// template 'Check Probe Off' shape: prove the sensor can read OFF once per cycle; station Side A lockout suppresses the latch
const OFF_PROOF = (inst, angle, debounce, latch) => `XIO(ManualMode)${CAM(inst, angle, 0)}[XIO(${ST('OpStatus.LockoutA')}) XIO(${debounce}.Off) OTL(${latch}) ,[XIC(${debounce}.Off) ,XIC(${ST('OpStatus.LockoutA')}) ] OTU(${latch}) ];`;
// R20 fault form (sealed until FaultReset) and Severity-1 warning form
const FAULT = (idx, ons, cond) => `[${cond} ,XIC(Alarm[${idx}].Active) XIO(FaultReset) ][OTE(Alarm[${idx}].Active) ,ONS(ONS.${ons}) CONCAT(g_StationList[StaNum],AlarmList[${idx}],Alarm[${idx}].Message) ];`;
const WARN = (idx, ons, cond) => `${cond}[OTE(Alarm[${idx}].Active) ,MOVE(1,Alarm[${idx}].Severity) ,ONS(ONS.${ons}) CONCAT(g_StationList[StaNum],AlarmList[${idx}],Alarm[${idx}].Message) ];`;

// ── shared tags / rungs (every listener) ─────────────────────────────────────
const commonTags = (staNum) => [
  structTag('AOI_ProgramAlarmHandler', 'ProgramAlarmHandler'),
  boolTag('CycleRunning'), boolTag('CycleStation', { desc: 'Side A of the nest at this station is due for this cycle (qualified, not yet attempted)' }),
  boolTag('CycleStopped'), boolTag('CycleStopping'), boolTag('FaultReset'), boolTag('HMI_LocalManualOverride'),
  boolTag('Initialized'), boolTag('LocalSSONS'), boolTag('ManualMode'), boolTag('SafetyOK'),
  boolTag('SS'), boolTag('SS_OK'),
  dintTag('NestNumCurrent'), dintTag('NestNumIncoming'), dintTag('ONS'), dintTag('StaNum'), dintTag('StaNumPre'),
  boolTag('q_AlarmActive', { usage: 'Output' }), boolTag('q_WarningActive', { usage: 'Output' }),
  structTag('StationPerformance', 'StationPerformance'),
];
const R00 = routine('R00_Main', [R('JSR(R01_Inputs,0);', 'Subroutine Calls'), R('JSR(R02_Logic,0);'), R('JSR(R20_Alarms,0);')]);
const logicInputs = (extraFirstComment) => [
  R('XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);', `Logic inputs\n\n*Replace always off bits with real conditions${extraFirstComment ? `\n\n${extraFirstComment}` : ''}`),
  R('XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'),
  R('XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'),
  R('XIC(\\Supervisor.q_MachineRunning)OTE(CycleRunning);'),
  R('XIO(\\Supervisor.q_CycleStartLatch)OTE(CycleStopping);'),
  R('XIC(\\Supervisor.q_CycleStopped)ONS(ONS.0)XIC(g_MachineBasic.AlwaysOff)OTE(CycleStopped);'),
  R('XIC(g_MachineBasic.AlwaysOff)OTE(Initialized);', 'Initialized - cam listener, nothing of its own to initialize; the Chassis Resync owns recovery (template shape, AlwaysOff is deliberate).'),
  R('XIC(HMI_Toggle.2)OTE(SS);', 'Single Step Logic\n\nStandard block in R01 of every 1160 program. SS = HMI_Toggle.2 (SDC fixed bit map) because Tracking_Station_Op_Status carries no SingleStep member. A cam listener has no PLC-driven transitions to gate, so SS_OK is derived here and not consumed.'),
  R('[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);'),
];
const clearMomentary = (note) => [
  R('XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);', `Clear HMI Manual Triggers${note ? `\n\n${note}` : ''}`),
  R('NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'),
];
const HMI_TOGGLE_SENSOR = dintTag('HMI_Toggle', { desc: 'HMI toggles, SDC fixed bit map: .0 Lockout and .1 Dry Run are not read here (station lockout comes from Tracking Station[StaNum].OpStatus.LockoutA; cam listener, no motion of its own), .2 Single Step (R01 SS block).', comments: { '.2': 'Single Step' } });

// ═════════════════════════════════════════════════════════════════════════════
// S01_YSiteLoadA — LEFT Y-Site Load Gripper, vb01 slot 2 (OUT Data[0].2 close / .3 open), reads \S01_YSiteEscapement.p_LeftPartReady
// ═════════════════════════════════════════════════════════════════════════════
const S01 = program('S01_YSiteLoadA',
  'S01 Y-Site Load, Side A (Left nest) - cam listener for the Left Y-Site Load Gripper on the chassis pick-and-place. ChassisStandard 2-UP S01_PartLoadA shape: close the gripper at g_S01_GripperCloseAngle on the incoming nest when S01_YSiteEscapement presents a Left part, open at g_S01_GripperOpenAngle on the current nest, publish p_PartsPicked / p_LoadEnabled to the escapement. Side A of the S01 Y-Site Load twin pair (one program per nest side). Job 1160 Y-Site Assembly.',
  [
    ...commonTags(1),
    structTag('Alarm', 'AlarmData', { dims: 5, desc: 'Side A alarms: [0] No Parts Warning (Severity 1 + pause request), [1] Station Bypassed (warning), [2] Station Locked Out (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.' }),
    strArrayTag('AlarmList', 5, ['Side A No Parts Warning', 'Side A Station Bypassed', 'Side A Station Locked Out'], 'Alarm message suffixes. Station prefix comes from g_StationList[StaNum] - never authored here.'),
    boolTag('CamCloseGripper'), boolTag('CamOpenGripper'),
    structTag('CamPosCheckA', 'Chassis_CamPos_Check', { desc: 'Gripper close window at g_S01_GripperCloseAngle (timing advance ON)' }),
    structTag('CamPosCheckB', 'Chassis_CamPos_Check', { desc: 'Gripper open window at g_S01_GripperOpenAngle (timing advance ON)' }),
    structTag('CamPosCheckC', 'Chassis_CamPos_Check', { desc: 'Parts picked read window at g_S01_PartsPickedAngle (timing advance OFF)' }),
    consecTag('ConsecFails', 3, 'Side A consecutive no-part strikes at the gripper close window - Setpoint default 3 (HMI adjustable). Warning + pause, never a fault (load-station form).'),
    strArrayTag('FailureMessages', 5, ['Part Not At Escapement'], 'FailureMessage suffixes - written as CONCAT(g_StationList[StaNum], FailureMessages[n]) into PartStatus.FailureMessageA'),
    boolTag('GripperClosed', { desc: 'Derived: Left Y-Site Load Gripper commanded closed and GripperCloseDelay done (sensorless gripper - closed = carrying). Consumers test this bit, never the raw output.' }),
    timerTag('GripperCloseDelay', 250), timerTag('GripperOpenDelay', 250),
    boolTag('GripperOpened', { desc: 'Derived: Left Y-Site Load Gripper commanded open and GripperOpenDelay done' }),
    dintTag('HMI_Momentary', { comments: { '.0': 'Close Gripper', '.1': 'Open Gripper' } }),
    boolTag('HMI_MomentaryOnPrevScan'),
    dintTag('HMI_Toggle', { desc: 'HMI toggles, SDC fixed bit map: .0 Production Enabled (chassis template S01_PartLoad idiom, R02 cycle conditions), .1 Dry Run (not read here), .2 Single Step (R01 SS block), .3 Single Step Disable Tracking (R01). Bit 3 is INTERIM until Tracking_Station_Op_Status carries SingleDisableTracking (UDT question #166 for Jason).', comments: { '.0': 'Production Enabled', '.2': 'Single Step', '.3': 'Single Step Disable Tracking' } }),
    boolTag('p_LoadEnabled', { usage: 'Public', desc: 'Side A may load the incoming nest (CycleStation) - read by S01_YSiteEscapement so it presents the Left part only when it will be picked' }),
    boolTag('p_PartsPicked', { usage: 'Public', desc: 'Chassis has lifted the picked Left part clear of the escapement - read by S01_YSiteEscapement' }),
    timerTag('PartPresentTimer', 2000),
    boolTag('q_CloseGripper', { usage: 'Output', desc: 'Close Left Y-Site Load Gripper - vb01 Upper Valve Bank slot 2 coil A (SMC SY3200 double solenoid, sensorless)' }),
    boolTag('q_OpenGripper', { usage: 'Output', desc: 'Open Left Y-Site Load Gripper - vb01 Upper Valve Bank slot 2 coil B' }),
    boolTag('q_PauseRequest', { usage: 'Output', desc: 'Ask the Chassis to pause - Side A starved (PauseReason 1 in the Chassis PauseCondition rung)' }),
    boolTag('SingleDisableTracking', { desc: 'Single stepping with tracking latches disabled (HMI_Toggle.3 while SS)' }),
  ],
  [
    R00,
    routine('R01_Inputs', [
      ...logicInputs('1160: the Left Y-Site Load Gripper is sensorless (closed = carrying) and the Left Part Present fiber belongs to S01_YSiteEscapement, so this program carries no AOI_Debounce rung (debounce is for digital sensors only).'),
      R('XIC(SS)XIC(HMI_Toggle.3)OTE(SingleDisableTracking);', 'Single Step Disable Tracking - operator choice (HMI_Toggle.3) that gates the part-tracking latches while single stepping.\n\nINTERIM source: HMI_Toggle.3. Target shape (X_ServoPNP S05 R01): XIC(SS)XIC(Tracking Station[StaNum].OpStatus.SingleDisableTracking) - retarget once Tracking_Station_Op_Status carries the member (UDT question #166 for Jason).'),
      R('XIC(q_CloseGripper)XIO(q_OpenGripper)TON(GripperCloseDelay,?,?)XIC(GripperCloseDelay.DN)OTE(GripperClosed);', 'Left Y-Site Load Gripper Derived State\n\nSensorless gripper (pneumatic drawing 1160-P-001: no sensors): closed = carrying, open = empty. Derived state = own command on, opposite command off, GripperCloseDelay / GripperOpenDelay done (250 ms, HMI-adjustable). Consumers test these bits, never the raw output.'),
      R('XIC(q_OpenGripper)XIO(q_CloseGripper)TON(GripperOpenDelay,?,?)XIC(GripperOpenDelay.DN)OTE(GripperOpened);'),
      ...clearMomentary(),
    ]),
    routine('R02_Logic', [
      R('MOVE(1,StaNum)MOVE(16,StaNumPre);', 'Load Station Numbers\n\n1160: StaNum 1 = S01 Y-Site Load. StaNumPre 16 = S16 Empty Nest, the dial position upstream of S01 on the 16-nest dial.'),
      R(NEST_NUMS, 'Load Nest Numbers\n\n2-UP: one fixture number per index - the Side A (Left) part is recorded in the Side A members of the same nest record (template Tracking_Part_Assy_Stat / Tracking_Process_Op_Result).'),
      R(`XIC(SafetyOK)XIC(CycleRunning)XIO(${ST('OpStatus.LockoutA')})XIO(${NI('OpStatus.Lockout')})XIC(HMI_Toggle.0)XIO(${CLEANOUT})XIO(${NI('PartStatus.Station[StaNum].AttemptA')})[OTE(CycleStation) ,OTE(p_LoadEnabled) ];`,
        'Conditions For The Station To Cycle\n\nTemplate S01_PartLoadA rung: station Side A not locked out, incoming fixture not locked out, Production Enabled (HMI_Toggle.0), not cleanout mode, Side A not yet attempted on the incoming nest. The same condition is published as p_LoadEnabled so S01_YSiteEscapement presents the Left part only when it will be picked.'),
      R(`XIO(ManualMode)${CAM('CamPosCheckA', 'g_S01_GripperCloseAngle', 1)}XIC(CycleStation)[XIO(SingleDisableTracking) OTL(${NI('PartStatus.Station[StaNum].AttemptA')}) ,[XIC(${ESC_READY}) ,XIC(${ST('OpStatus.BypassA')}) ] OTE(CamCloseGripper) ,XIO(${ST('OpStatus.BypassA')}) XIO(${ESC_READY}) [OTU(${NI('PartStatus.Station[StaNum].SuccessA')}) ,OTL(${NI('PartStatus.Station[StaNum].FailureA')}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(11,${NI('PartStatus.FailureTypeA')}) ,CONCAT(g_StationList[StaNum],FailureMessages[0],${NI('PartStatus.FailureMessageA')}) ] ];`,
        'Close Gripper\n\n***NestNumIncoming Used Because Gripper Closes When Dial Is Indexing New Nest Into Station***\n\ng_S01_GripperCloseAngle (seed 50 deg inside the middle-hub Down/Pick dwell 47-73 deg, timing advance ON). Pass = the Left part is ready at the escapement (S01_YSiteEscapement.p_LeftPartReady) or Side A is bypassed -> close the gripper. Fail = no part ready -> SuccessA off, FailureA on, FailureTypeA 11 (StaNum x 10 + 1 = Part Not At Escapement, message = g_StationList[StaNum] + FailureMessages[0]), ConsecFails +1 (the window output is a one-shot). Tracking latches guarded by XIO(SingleDisableTracking).'),
      R(`XIO(ManualMode)${CAM('CamPosCheckB', 'g_S01_GripperOpenAngle', 1)}XIC(GripperClosed)[XIO(SingleDisableTracking) [OTL(${NC('PartStatus.PartLoadedA')}) ,OTL(${NC('PartStatus.Station[StaNum].SuccessA')}) ] ,MOVE(0,ConsecFails.Count) ,OTE(CamOpenGripper) ];`,
        'Open Gripper\n\n***NestNumCurrent Used Because Gripper Opens After Dial Index Is Complete***\n\ng_S01_GripperOpenAngle (seed 230 deg, middle-hub Down/Place dwell 227-253 deg), timing advance ON. Opens only if the gripper is closed (derived GripperClosed - sensorless gripper, closed = carrying) and stamps PartLoadedA + Station[1].SuccessA: the physical evidence is that the gripper was carrying and is opened over the nest. S02 checks the placed part; the load has no place-side sensor.'),
      R('[XIO(ManualMode) [XIC(CamCloseGripper) ,XIC(q_CloseGripper) XIO(CamOpenGripper) ] ,XIC(ManualMode) [XIC(HMI_Momentary.0) ,XIC(q_CloseGripper) XIO(HMI_Momentary.1) ] ]OTE(q_CloseGripper);',
        'Gripper Control\n\nOne rung per output, auto and manual in the same rung with the seal-in inside (template S01_PartLoadA rungs 5-6). Manual: HMI_Momentary.0 close / .1 open. Sensorless gripper: commanded closed = carrying, so a part held through a stop is placed at the next open window.'),
      R('[XIO(ManualMode) [XIC(CamOpenGripper) ,XIC(q_OpenGripper) XIO(CamCloseGripper) ] ,XIC(ManualMode) [XIC(HMI_Momentary.1) ,XIC(q_OpenGripper) XIO(HMI_Momentary.0) ] ]OTE(q_OpenGripper);'),
      R(`XIO(ManualMode)${CAM('CamPosCheckC', 'g_S01_PartsPickedAngle', 0)}OTL(p_PartsPicked);`,
        'Parts Picked\n\n1160 extension (two-program station): p_PartsPicked tells S01_YSiteEscapement the chassis has lifted the picked part clear so it may lower the lifts and re-arm (Mark: signaled by the chassis getting to a position). g_S01_PartsPickedAngle seed 142 deg = middle hub Up 1 reached; a read window, timing advance OFF. Cleared in the next rung once the escapement drops the Left Part Ready signal. The escapement ORs the p_PartsPicked of both twins.'),
      R(`XIO(${ESC_READY})OTU(p_PartsPicked);`),
      R(STATION_PERF('NestNumIncoming'), 'Station Performance\n\nTemplate S01_PartLoadA rung: Side A attempts (incoming nest) and successes (current nest) into the Station[1] Side A performance members.'),
      R('[XIC(q_CloseGripper) OTE(vb01_UpperValveBank_OUT.Data[0].2) ,XIC(q_OpenGripper) OTE(vb01_UpperValveBank_OUT.Data[0].3) ];',
        'Valve Bank Output Mapping\n\n1160: vb01 Upper Valve Bank (SMC EX600-SEN7, pneumatic drawing 1160-P-001) slot 2 = Left Y-Site Load Gripper, SY3200 double solenoid, no sensors. Contract bit rule: slot n -> output bits 2n-2 (coil A = close) and 2n-1 (coil B = open): slot 2 -> OUT Data[0].2 close / Data[0].3 open. MapOutputs copies vb01_UpperValveBank_OUT to the module (Ethernet generic module - buffered). Confirm against the SMC configurator.'),
    ]),
    routine('R20_Alarms', [
      R(`XIC(CycleRunning)XIO(${ST('OpStatus.LockoutA')})GE(ConsecFails.Count,ConsecFails.Setpoint)[OTE(Alarm[0].Active) ,ONS(ONS.3) MOVE(1,Alarm[0].Severity) CONCAT(g_StationList[StaNum],AlarmList[0],Alarm[0].Message) ];`,
        'Consecutive Failures\n\n1160: three strikes on the Side A lane (ConsecFails.Setpoint, default 3) = Severity 1 warning + pause request, the load-station form (template S01_PartLoadA) - waiting on part supply is a pause, never a fault. Message = g_StationList[StaNum] + AlarmList[0].'),
      R(`[XIC(${ESC_READY}) TON(PartPresentTimer,?,?) XIC(PartPresentTimer.DN) ,XIC(Alarm[0].Active) [XIO(CycleRunning) ,XIC(${CLEANOUT}) ] ]MOVE(0,ConsecFails.Count);`,
        'Reset the count when the Left part has been ready for PartPresentTimer, or while the warning is up and the cycle is stopped or in cleanout (template rung 1 shape; the template PartPresentDebounce.On is S01_YSiteEscapement.p_LeftPartReady on this two-program station).'),
      R(`XIC(${ST('OpStatus.BypassA')})[OTE(Alarm[1].Active) ,ONS(ONS.4) MOVE(1,Alarm[1].Severity) CONCAT(g_StationList[StaNum],AlarmList[1],Alarm[1].Message) ];`, 'Station Bypassed\n\nSeverity 1 warning so nobody runs Side A bypassed silently.'),
      R(`XIC(${ST('OpStatus.LockoutA')})[OTE(Alarm[2].Active) ,ONS(ONS.5) MOVE(1,Alarm[2].Severity) CONCAT(g_StationList[StaNum],AlarmList[2],Alarm[2].Message) ];`, 'Station Locked Out'),
      R(ALARM_HANDLER),
      R(FAULT_COUNT, 'Station Fault Count'),
      R('XIC(Alarm[0].Active)OTE(q_PauseRequest);', 'Pause If No Parts\n\n1160: Side A starved three times asks the Chassis to pause (PauseReason 1 in the Chassis PauseCondition rung).'),
    ]),
  ]);

// ═════════════════════════════════════════════════════════════════════════════
// S02_YVerifyA — LEFT Part Present (vb01 input 1 = IN Data[0].1) + Part Seated (input 3 = IN Data[0].3) forks
// ═════════════════════════════════════════════════════════════════════════════
const S02 = program('S02_YVerifyA',
  'S02 Y Verify, Side A (Left nest) - stateless cam listener: reads the Left Part Present and Part Seated forks once per dwell at g_S02_VerifyProcessAngle and writes pass/fail into the Side A members of the nest record; proves Part Present OFF at g_S02_VerifyOffAngle; consecutive failures fault. Nothing moves. ChassisStandard 2-UP S02_ProbeCheckA shape + two-sensor verify rule. Side A of the S02 Y Verify twin pair. Station Alignment pin is a manual mechanism (Dan 2026-09-16) - not in the PLC. Job 1160.',
  [
    ...commonTags(2),
    structTag('Alarm', 'AlarmData', { dims: 5, desc: 'Side A alarms: [0] Consecutive Failures (fault), [1] Part Present Sensor Did Not Turn Off (fault), [2] Station Bypassed (warning), [3] Station Locked Out (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.' }),
    strArrayTag('AlarmList', 5, ['Side A Consecutive Failures', 'Side A Part Present Sensor Did Not Turn Off', 'Side A Station Bypassed', 'Side A Station Locked Out'], 'Alarm message suffixes. Station prefix comes from g_StationList[StaNum] - never authored here.'),
    structTag('CamPosCheckA', 'Chassis_CamPos_Check', { desc: 'Verify read window at g_S02_VerifyProcessAngle' }),
    structTag('CamPosCheckB', 'Chassis_CamPos_Check', { desc: 'Part Present OFF proof window at g_S02_VerifyOffAngle' }),
    consecTag('ConsecFails', 3, 'Side A consecutive verify failures - Setpoint default 3 (HMI adjustable; URS: stop after three rejects in a row)'),
    strArrayTag('FailureMessages', 5, ['Part Present Sensor Failed', 'Part Seated Sensor Failed'], 'FailureMessage suffixes - written as CONCAT(g_StationList[StaNum], FailureMessages[n]) into PartStatus.FailureMessageA'),
    HMI_TOGGLE_SENSOR,
    boolTag('i_PartPresent', { usage: 'Input', desc: 'Left Part Present - Balluff BGL 80A-001-S49 fork sensor 1447PEC, vb01 Upper Valve Bank input 1 (Hailey 1160-V: S02-Y VERIFY LT-Y SITE PART PRESENT). 1160-DB-000 item 10, one Present post + one Seated post per nest on the 1160-DB-008 stage mount; pure sensing station, no actuator. ON = part present.' }),
    boolTag('i_PartSeated', { usage: 'Input', desc: 'Left Part Seated - Balluff BGL 80A-001-S49 fork sensor 1455PEC, vb01 Upper Valve Bank input 3 (Hailey 1160-V: S02-Y VERIFY LT-Y SITE PART SEATED). Proves the part is not proud of the nest (crash risk going around the dial). ON = part seated.' }),
    structTag('PartPresentDebounce', 'AOI_Debounce'),
    boolTag('PartPresentNotOff', { desc: 'Left Part Present fork did not read OFF in the g_S02_VerifyOffAngle window (stuck ON)' }),
    structTag('PartSeatedDebounce', 'AOI_Debounce'),
  ],
  [
    R00,
    routine('R01_Inputs', [
      R('XIC(vb01_UpperValveBank_IN.Data[0].1)OTE(i_PartPresent);',
        'Mapped Inputs - Left Part Present\n\nBalluff BGL 80A fork 1447PEC (cable 1447CBL), vb01 Upper Valve Bank (SMC EX600-SEN7, 192.168.1.21) input 1 = EX600-DXPC unit 0 point 1 -> vb01_UpperValveBank_IN byte 0 bit 1, buffered once by MapInputs (Ethernet generic module). Assumes no SI-unit diagnostic bytes lead the input assembly - confirm the byte offset against the SMC configurator / EDS. Hailey 1160-V: S02-Y VERIFY LT-Y SITE PART PRESENT.'),
      R('XIC(vb01_UpperValveBank_IN.Data[0].3)OTE(i_PartSeated);',
        'Mapped Inputs - Left Part Seated\n\nBalluff BGL 80A fork 1455PEC (cable 1455CBL), vb01 input 3 = DXPC unit 0 point 3 -> byte 0 bit 3. Hailey 1160-V: S02-Y VERIFY LT-Y SITE PART SEATED. Mark 7:07: the seated sensor makes sure the part is not up too high so it crashes on something going around the dial.'),
      R('AOI_Debounce(PartPresentDebounce,i_PartPresent,50,50);', 'Sensor Debounce\n\nAOI_Debounce 50/50 on the two digital fork sensors (template S02_ProbeCheck value). ON = pass, never inverted in code (PLC Software Standardization Rev2 section 23): light-on / dark-on is configured at each sensor - CE to confirm the setting.'),
      R('AOI_Debounce(PartSeatedDebounce,i_PartSeated,50,50);'),
      ...logicInputs(),
    ]),
    routine('R02_Logic', [
      R('MOVE(2,StaNum)MOVE(1,StaNumPre);', 'Load Station Numbers\n\nS02 Y Verify; predecessor S01 Y-Site Load (Station 1).'),
      R(NEST_NUMS, 'Load Nest Numbers\n\nNest numbers come from Chassis R03_CalcDialStationNestNums through Tracking.p_Data. S02 reads the fixture in the dwell after index complete, so every write below uses NestNumCurrent.'),
      R(`XIC(SafetyOK)XIC(CycleRunning)XIO(${ST('OpStatus.LockoutA')})XIO(${NC('OpStatus.Lockout')})[XIC(${NC('PartStatus.Station[StaNumPre].SuccessA')}) ,XIC(${NC('PartStatus.PartLoadedA')}) XIC(${NC('PartStatus.Station[StaNumPre].LockoutA')}) ]XIO(${NC('PartStatus.Station[StaNum].AttemptA')})OTE(CycleStation);`,
        'Conditions For The Station To Cycle\n\nTemplate S02_ProbeCheckA rung: Side A of a nest that S01 loaded (Station[1].SuccessA, or PartLoadedA with S01 locked out) and this station has not yet attempted. Station Side A lockout and whole-fixture lockout stop this side. Nest reference = NestNumCurrent: the read happens after the index is complete.'),
      R(`XIC(SafetyOK)XIC(CycleRunning)XIC(${NC('PartStatus.PartLoadedA')})XIC(${ST('OpStatus.LockoutA')})OTL(${NC('PartStatus.Station[StaNum].LockoutA')});`,
        'Station Locked Out - stamp Station[2].LockoutA into the loaded Side A part so S03 treats S02 as skipped, not failed (template S02_ProbeCheckA rung 3).'),
      R(`XIO(ManualMode)${CAM('CamPosCheckA', 'g_S02_VerifyProcessAngle', 0)}XIC(CycleStation)[OTL(${NC('PartStatus.Station[StaNum].AttemptA')}) ,[XIC(PartPresentDebounce.On) XIC(PartSeatedDebounce.On) ,XIC(${ST('OpStatus.BypassA')}) ] [OTL(${NC('PartStatus.Station[StaNum].SuccessA')}) ,OTU(${NC('PartStatus.Station[StaNum].FailureA')}) ,MOVE(0,ConsecFails.Count) ] ,XIO(${ST('OpStatus.BypassA')}) [XIO(PartPresentDebounce.On) ,XIO(PartSeatedDebounce.On) ] [OTL(${NC('PartStatus.Station[StaNum].FailureA')}) ,OTU(${NC('PartStatus.Station[StaNum].SuccessA')}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,XIO(PartPresentDebounce.On) [MOVE(21,${NC('PartStatus.FailureTypeA')}) ,CONCAT(g_StationList[StaNum],FailureMessages[0],${NC('PartStatus.FailureMessageA')}) ] ,XIO(PartSeatedDebounce.On) [MOVE(22,${NC('PartStatus.FailureTypeA')}) ,CONCAT(g_StationList[StaNum],FailureMessages[1],${NC('PartStatus.FailureMessageA')}) ] ] ];`,
        'Verify Part At Process Angle\n\nFires once when CamPosDeg passes g_S02_VerifyProcessAngle (seed 240 deg, mid-dwell; EnableTimingAdvance 0 for a sensor read). Pass = Part Present ON AND Part Seated ON (or Side A bypass) -> SuccessA, strike counter cleared. Fail -> FailureA + one strike: Present OFF = FailureTypeA 21 Part Present Sensor Failed (S01 said loaded, nothing there); Seated OFF = FailureTypeA 22 Part Seated Sensor Failed (part proud). FailureType = StaNum x 10 + reason; FailureMessageA = g_StationList[2] + reason. A single failure is data in the nest record - the side is a reject downstream (EQ(FailureTypeA,0) good) - only consecutive failures fault. No retry: one read per dwell.'),
      R(OFF_PROOF('CamPosCheckB', 'g_S02_VerifyOffAngle', 'PartPresentDebounce', 'PartPresentNotOff'),
        'Check Part Present Sensor Off When Nest Away\n\nStuck-ON proof (Rev2 section 23; template Check Probe Off shape) for the Part Present fork at g_S02_VerifyOffAngle (seed 80 deg, mid-index - confirm the beam is clear at that angle). The Seated fork carries no OFF proof by default (Jason S04_PartVerify clear-sensor form; Rev2 section 23 deviation recorded for CE review). Station Side A lockout suppresses the latch.'),
      R(STATION_PERF('NestNumCurrent'), 'Station Performance\n\nTemplate S02_ProbeCheckA rung: Side A attempts and successes into the Station[2] Side A performance members.'),
    ]),
    routine('R20_Alarms', [
      R(FAULT(0, 3, `XIC(CycleRunning) XIO(${ST('OpStatus.LockoutA')}) GE(ConsecFails.Count,ConsecFails.Setpoint)`),
        'Consecutive Failures\n\nCheck-station form: FAULT held until Fault Reset (template S02_ProbeCheck); ConsecFails.Setpoint default 3, HMI-settable. Message = g_StationList[2] + AlarmList[0].'),
      R('XIC(Alarm[0].Active)MOVE(0,ConsecFails.Count);', 'Clear the strike counter while the fault stands so the station does not re-fault on the first scan after restart (S04_PartVerify form).'),
      R(FAULT(1, 4, 'XIC(CycleRunning) XIC(PartPresentNotOff)'), 'Part Present Sensor Did Not Turn Off\n\nThe beam stayed blocked at g_S02_VerifyOffAngle with the nest away (stuck ON). Fault held to Fault Reset; the latch clears when the alarm sets (template S02_ProbeCheck).'),
      R('XIC(Alarm[1].Active)OTU(PartPresentNotOff);'),
      R(WARN(2, 5, `XIC(${ST('OpStatus.BypassA')})`), 'Station Bypassed - Severity 1 warning; BypassA forces the pass branch in R02_Logic.'),
      R(WARN(3, 6, `XIC(${ST('OpStatus.LockoutA')})`), 'Station Locked Out - Severity 1 warning; a locked-out side reads nothing and stamps .LockoutA in R02_Logic.'),
      R(ALARM_HANDLER),
      R(FAULT_COUNT, 'Station Fault Count'),
    ]),
  ]);

// ═════════════════════════════════════════════════════════════════════════════
// S06_PortVerifyA — LEFT Septum Present laser, vb01 input 11 (IN Data[1].3)
// ═════════════════════════════════════════════════════════════════════════════
const S06 = program('S06_PortVerifyA',
  'S06 Port Verify, Side A (Left nest) - stateless cam listener: reads the Left Septum Present laser (Keyence LR-ZB100CP, vb01 input 11) once per fixture at g_S06_VerifyProcessAngle and writes Station[6] AttemptA / SuccessA / FailureA (FailureTypeA 61) into the nest record; proves the laser OFF at g_ProbeOffAngle. ChassisStandard 2-UP S02_ProbeCheckA shape. Side A of the S06 Port Verify twin pair. Sensor stand DU vs DF open - see i_SeptumPresent. Job 1160.',
  [
    ...commonTags(6),
    structTag('Alarm', 'AlarmData', { dims: 5, desc: 'Side A alarms: [0] Septum Present Consecutive Failures (fault), [1] Septum Present Sensor Did Not Turn Off (fault), [2] Bypass Active (warning), [3] Lockout Active (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.' }),
    strArrayTag('AlarmList', 5, ['Side A Septum Present Consecutive Failures', 'Side A Septum Present Sensor Did Not Turn Off', 'Side A Bypass Active', 'Side A Lockout Active'], 'Alarm text suffixes - R20 builds Alarm[n].Message = CONCAT(g_StationList[StaNum], AlarmList[n])'),
    structTag('CamPosCheckA', 'Chassis_CamPos_Check', { desc: 'Septum present read window at g_S06_VerifyProcessAngle' }),
    structTag('CamPosCheckB', 'Chassis_CamPos_Check', { desc: 'Sensor OFF proof window at g_ProbeOffAngle (template controller tag, seed 60 deg = mid dial index)' }),
    consecTag('ConsecFails', 3, 'Side A Septum Present consecutive failures - Setpoint default 3 (HMI adjustable)'),
    strArrayTag('FailureMessages', 5, ['Septum Not Detected'], 'FailureMessage suffixes - written as CONCAT(g_StationList[StaNum], FailureMessages[n]) into PartStatus.FailureMessageA'),
    HMI_TOGGLE_SENSOR,
    boolTag('i_SeptumPresent', { usage: 'Input', desc: 'Left Septum Present laser (Keyence LR-ZB100CP, 1515PEC) - vb01 Upper Valve Bank input 11. Matches 1160-DU-000 (S6-1160 PORT VERIFY: LR-ZB100CP x2 on 1160-DS-001 mounts / 1160-DC-001 post). If the alternate 1160-DF-000 stand (GV-H45L heads + GV-21/22 amplifier) is placed, the sensor type and output wiring change. ON = septum present.' }),
    structTag('SeptumPresentDebounce', 'AOI_Debounce'),
    boolTag('SeptumPresentNotOff', { desc: 'Left Septum Present laser did not read OFF in the g_ProbeOffAngle window' }),
  ],
  [
    R00,
    routine('R01_Inputs', [
      R('XIC(vb01_UpperValveBank_IN.Data[1].3)OTE(i_SeptumPresent);',
        'Mapped Inputs - Left Septum Present\n\nKeyence LR-ZB100CP 1515PEC, cable 1515CBL, schematic 1160-V-014 S06-PORT VERIFY LT SEPTUM PRESENT, vb01 Upper Valve Bank (SMC EX600-SEN7) input 11 = EX600-DXPC unit 1 point 3 -> vb01_UpperValveBank_IN byte 1 bit 3, buffered once by MapInputs (Ethernet generic module). Byte order assumes one SINT per DXPC unit in unit order with no diagnostic bytes - confirm byte/bit against the EX600 EDS / SMC configurator.'),
      R('AOI_Debounce(SeptumPresentDebounce,i_SeptumPresent,50,50);', 'Sensor Debounce\n\nThe LR-ZB100CP laser is a digital sensor -> AOI_Debounce 50/50 (template S02_ProbeCheck value). No cylinder switches at this station.'),
      ...logicInputs(),
    ]),
    routine('R02_Logic', [
      R('MOVE(6,StaNum)MOVE(5,StaNumPre);', 'Load Station Numbers\n\nS06 Port Verify; predecessor S05 Port Load (septum insertion).'),
      R(NEST_NUMS, 'Load Nest Numbers\n\nNest numbers come from Chassis R03_CalcDialStationNestNums through Tracking.p_Data. S06 reads the fixture in the dwell after index complete, so every write below uses NestNumCurrent.'),
      R(`XIC(SafetyOK)XIC(CycleRunning)XIO(${ST('OpStatus.LockoutA')})XIO(${NC('OpStatus.Lockout')})[XIC(${NC('PartStatus.Station[StaNumPre].SuccessA')}) ,XIC(${NC('PartStatus.PartLoadedA')}) XIC(${NC('PartStatus.Station[StaNumPre].LockoutA')}) ]EQ(${NC('PartStatus.FailureTypeA')},0)XIO(${NC('PartStatus.Station[StaNum].AttemptA')})OTE(CycleStation);`,
        'Conditions For The Station To Cycle\n\nTemplate S02_ProbeCheckA rung plus the reject rule: Side A cycles when the station Side A and the fixture are not locked out, S05 succeeded on this side (or S05 is locked out with a part loaded), the part is not already a reject (FailureTypeA = 0 - URS: a rejected side is skipped by every following station) and S06 has not yet attempted it.'),
      R(`XIC(SafetyOK)XIC(CycleRunning)XIC(${NC('PartStatus.PartLoadedA')})XIC(${ST('OpStatus.LockoutA')})OTL(${NC('PartStatus.Station[StaNum].LockoutA')});`,
        'Station Locked Out - stamp Station[6].LockoutA into the loaded Side A part so downstream stations treat S06 as skipped, not failed.'),
      R(`XIO(ManualMode)${CAM('CamPosCheckA', 'g_S06_VerifyProcessAngle', 0)}XIC(CycleStation)[OTL(${NC('PartStatus.Station[StaNum].AttemptA')}) ,[XIC(SeptumPresentDebounce.On) ,XIC(${ST('OpStatus.BypassA')}) ] [OTL(${NC('PartStatus.Station[StaNum].SuccessA')}) ,MOVE(0,ConsecFails.Count) ] ,XIO(${ST('OpStatus.BypassA')}) XIO(SeptumPresentDebounce.On) [OTU(${NC('PartStatus.Station[StaNum].SuccessA')}) ,OTL(${NC('PartStatus.Station[StaNum].FailureA')}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(61,${NC('PartStatus.FailureTypeA')}) ,CONCAT(g_StationList[StaNum],FailureMessages[0],${NC('PartStatus.FailureMessageA')}) ] ];`,
        'Check Septum Present Process\n\nOne Chassis_CamPos_Check window at g_S06_VerifyProcessAngle (seed 240 deg, inside the dial dwell, EnableTimingAdvance 0 = sensor read at the true angle). ON = pass (septum present at the taught height window). OFF with BypassA off = fail: FailureTypeA 61 (6 x 10 + 1 Septum Not Detected), FailureMessageA = CONCAT(g_StationList[6], FailureMessages[0]), ConsecFails + 1. BypassA forces the pass branch. Downstream: S07 will not pierce a side without Station[6].SuccessA.'),
      R(OFF_PROOF('CamPosCheckB', 'g_ProbeOffAngle', 'SeptumPresentDebounce', 'SeptumPresentNotOff'),
        'Check Septum Present Sensor Off When Dial Indexing\n\nTemplate Check Probe Off window: the laser must prove it can read OFF once per cycle (stuck-ON detection). g_ProbeOffAngle (template controller tag, seed 60 deg = mid dial index 0-120 deg) with the fixture gap passing the beam - geometry to confirm with the ME. Skipped while station Side A is locked out.'),
      R(STATION_PERF('NestNumCurrent'), 'Station Performance\n\nTemplate S02_ProbeCheckA rung: Side A attempts and successes into the Station[6] Side A performance members.'),
    ]),
    routine('R20_Alarms', [
      R(FAULT(0, 3, `XIC(CycleRunning) XIO(${ST('OpStatus.LockoutA')}) GE(ConsecFails.Count,ConsecFails.Setpoint)`),
        'Consecutive Failures - Septum Present\n\nFAULT: three consecutive missing septa on Side A (ConsecFails.Setpoint, default 3) means S05 is not inserting on this side. Sealed until FaultReset. Message = CONCAT(g_StationList[6], AlarmList[0]).'),
      R('XIC(Alarm[0].Active)MOVE(0,ConsecFails.Count);', 'Clear the strike counter while the fault stands so the station does not re-fault on the first scan after restart (S04_PartVerify form).'),
      R(FAULT(1, 4, 'XIC(CycleRunning) XIC(SeptumPresentNotOff)'), 'Septum Present Sensor Did Not Turn Off\n\nFAULT (template Probe Did Not Turn Off form): the laser never read OFF in the g_ProbeOffAngle window - stuck ON, misaimed or blocked.'),
      R('XIC(Alarm[1].Active)OTU(SeptumPresentNotOff);'),
      R(WARN(2, 5, `XIC(${ST('OpStatus.BypassA')})`), 'Station Bypassed\n\nWARNING (Severity 1) while the S06 Side A bypass toggle is on - the check still runs but the side passes.'),
      R(WARN(3, 6, `XIC(${ST('OpStatus.LockoutA')})`), 'Station Locked Out\n\nWARNING (Severity 1) while the S06 Side A lockout toggle is on - no read, Station[6].LockoutA stamped into the loaded part.'),
      R(ALARM_HANDLER),
      R(FAULT_COUNT, 'Station Fault Count'),
    ]),
  ]);

// ═════════════════════════════════════════════════════════════════════════════
// S16_EmptyNestA — LEFT Nest Empty laser, vb01 input 15 (IN Data[1].7)
// ═════════════════════════════════════════════════════════════════════════════
const S16 = program('S16_EmptyNestA',
  'S16 Empty Nest Check, Side A (Left nest) - cam listener (no state machine): reads the Left Nest Empty laser once per dwell at g_S16_VerifyProcessAngle; a part still in the nest is a fault (controlled stop before the next index) until the operator removes it and presses Fault Reset; proves the laser OFF at g_ProbeOffAngle. ChassisStandard 2-UP S20_EmptyNestA shape. Side A of the S16 Empty Nest twin pair. Job 1160 Y-Site Assembly.',
  [
    ...commonTags(16),
    structTag('Alarm', 'AlarmData', { dims: 5, desc: 'Side A alarms: [0] Part Detected In Nest (fault), [1] Nest Empty Sensor Not Off (fault), [2] Station Bypass (warning), [3] Station Lockout (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.' }),
    strArrayTag('AlarmList', 5, ['Side A Part Detected In Nest - Remove Part, Then Press Fault Reset', 'Side A Nest Empty Sensor Not Off - Check Laser, Then Press Fault Reset', 'Side A Station Bypass Is Active - Turn Off Bypass When Nest Checks Are Required', 'Side A Station Lockout Is Active - Turn Off Lockout To Resume Nest Checks'], 'Alarm message suffixes (condition + operator action). Station prefix comes from g_StationList[16] - never authored here.'),
    structTag('CamPosCheckA', 'Chassis_CamPos_Check', { desc: 'Nest empty read window at g_S16_VerifyProcessAngle' }),
    structTag('CamPosCheckB', 'Chassis_CamPos_Check', { desc: 'Laser off-proof window at g_ProbeOffAngle (template controller tag, seed 60 deg = dial in motion)' }),
    consecTag('ConsecFails', 1, 'Side A consecutive part-detected count. Setpoint 1 = template S20_EmptyNestA value: a part remaining in a nest wrecks the next load, so the FIRST detected part faults the machine (the 2-UP record has no per-side nest lockout to carry a softer count). HMI adjustable.'),
    HMI_TOGGLE_SENSOR,
    boolTag('i_NestEmpty', { usage: 'Input', desc: 'Left Nest Empty laser 1532PEC (Keyence LR-ZB100CP) - vb01 Upper Valve Bank input 15 (EX600-DXPC unit 1 IN7), mapped in R01 from vb01_UpperValveBank_IN. ON = nest empty.' }),
    structTag('NestEmptyDebounce', 'AOI_Debounce', { desc: 'Left Nest Empty laser debounce 50/50 ms' }),
    boolTag('NestEmptyNotOff', { desc: 'Left laser failed to read OFF between fixtures (off-proof)' }),
  ],
  [
    R00,
    routine('R01_Inputs', [
      R('XIC(vb01_UpperValveBank_IN.Data[1].7)OTE(i_NestEmpty);',
        'Mapped Inputs - Left Nest Empty\n\nLeft Nest Empty laser 1532PEC (Keyence LR-ZB100CP, ebom 3.23) via cable 1532CBL -> vb01 Upper Valve Bank (SMC EX600-SEN7) EX600-DXPC unit 1 IN7 = bank input point 15 (drawing sheet 1160-V-015) = vb01_UpperValveBank_IN byte 1 bit 7, buffered once by MapInputs (Ethernet generic module). Assumes the input point data starts at byte 0 of the buffer - confirm against the SMC configurator / EDS (input assembly offset) and confirm the channel with Hailey. Output ON = Nest Empty (taught to the empty-nest floor - confirm the teach direction).'),
      R('AOI_Debounce(NestEmptyDebounce,i_NestEmpty,50,50);', 'Sensor Debounce\n\nAOI_Debounce on digital sensors only (Keyence laser), 50/50 ms - template S20 R01 rung 0 shape. No cylinder switches on this station.'),
      ...logicInputs(),
    ]),
    routine('R02_Logic', [
      R('MOVE(16,StaNum)MOVE(15,StaNumPre);', 'Load Station Numbers\n\nS16 Empty Nest Check = dial position 16; predecessor = S15 Reject Unload. Template S20 R02 rung 0 shape.'),
      R(NEST_NUMS, 'Load Nest Numbers\n\nOne Tracking_Nest record per fixture (2-UP): the Side A part lives in the Side A members of the record, not a second nest index. Nest-at-station numbers are written by Chassis R03_CalcDialStationNestNums.'),
      R(`XIC(SafetyOK)XIC(CycleRunning)XIO(${ST('OpStatus.LockoutA')})XIO(${NC('OpStatus.Lockout')})XIO(${NC('PartStatus.Station[StaNum].AttemptA')})OTE(CycleStation);`,
        'Conditions For The Station To Cycle\n\nTemplate S20_EmptyNestA rung 2 plus the station Side A lockout term: whole-fixture lockout or station Side A lockout drops this side only; the other side is still qualified (Jason, 1160 call 18:42). Deliberately NO PartLoaded, NO predecessor Success, NO FailureType term - S16 judges the PHYSICAL nest. Depends on S14 / S15 zeroing the nest record on their own unload Success (template S18 / S19) so Station[16].AttemptA is 0 when the nest arrives.'),
      R(`XIO(ManualMode)${CAM('CamPosCheckA', 'g_S16_VerifyProcessAngle', 0)}XIC(CycleStation)[OTL(${NC('PartStatus.Station[StaNum].AttemptA')}) ,[XIC(NestEmptyDebounce.On) ,XIC(${ST('OpStatus.BypassA')}) ] [OTL(${NC('PartStatus.Station[StaNum].SuccessA')}) ,MOVE(0,ConsecFails.Count) ] ,XIO(${ST('OpStatus.BypassA')}) XIO(NestEmptyDebounce.On) [OTU(${NC('PartStatus.Station[StaNum].SuccessA')}) ,OTL(${NC('PartStatus.Station[StaNum].FailureA')}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ] ];`,
        'Check Nest Empty\n\nTemplate S20_EmptyNestA rung 3 (Check Probe Process). Read ONCE per dwell at g_S16_VerifyProcessAngle (seed 240 deg, mid-dwell: dial in motion 0-120 deg, stationary 120-360 deg; EnableTimingAdvance 0 = pure sensor read). Chassis_CamPos_Check one-shots and the AttemptA latch drops CycleStation, so the count moves once per cycle. Laser ON = nest empty = pass -> SuccessA, ConsecFails.Count = 0. Laser OFF = a part is still in the nest = fail -> FailureA, Count + 1 -> R20 Alarm[0] FAULT at ConsecFails.Setpoint (1, template value) so the machine stops before the next index loads into an occupied nest. Side A bypass forces a pass (warned in R20). No FailureType / FailureMessage write - template S20 shape, deliberate: this record belongs to the NEXT part S01 loads into the nest; the side is carried in the alarm text instead. The v0 per-side nest lockout latch has no member in the 2-UP record and is not carried.'),
      R(OFF_PROOF('CamPosCheckB', 'g_ProbeOffAngle', 'NestEmptyDebounce', 'NestEmptyNotOff'),
        'Check Nest Empty Sensor Off Between Fixtures\n\nTemplate S20 R02 rung 4 (Check Probe Off When Station Retracted): prove the laser can say OFF. Read at g_ProbeOffAngle (template controller tag, seed 60 deg = dial-in-motion peak) while the dial web passes under the fixed laser. If the LR-ZB100CP mounting / teach cannot read out-of-window during the index, hold this rung with XIC(g_MachineBasic.AlwaysOff) in series and agree an alternative OFF proof with the CE - never delete it (a verify that can only say pass is not a verify). Station Side A lockout suppresses the latch.'),
      R(STATION_PERF('NestNumCurrent'), 'Station Performance\n\nTemplate S20_EmptyNestA rung 5: Side A attempts and successes into the Station[16] Side A performance members.'),
    ]),
    routine('R20_Alarms', [
      R(FAULT(0, 3, `XIC(CycleRunning) XIO(${ST('OpStatus.LockoutA')}) GE(ConsecFails.Count,ConsecFails.Setpoint)`),
        'Part Detected In Nest\n\nTemplate S20 R20 rung 0 rule: a part remaining in a nest wrecks the next load, so ConsecFails.Setpoint is 1 (template value) and the FIRST detected part is a FAULT. GE(Count,Setpoint) keeps the value a settable tag. q_AlarmActive -> Alarms p_NoMachineFaults -> Supervisor machine fault -> chassis CONTROLLED stop parked at SetupCamStartupPosDeg before the next index (template path). Message = g_StationList[StaNum] + AlarmList[0], built once on the rising edge.'),
      R('XIC(Alarm[0].Active)MOVE(0,ConsecFails.Count);', 'Clear Consecutive Fail Count\n\nV4.2 two-sensor verify form: the count clears once its alarm is sealed in, so the fault cannot re-fire at cycle start before the nest is re-read.'),
      R(FAULT(1, 4, 'XIC(CycleRunning) XIC(NestEmptyNotOff)'), 'Nest Empty Sensor Not Off\n\nTemplate S20 R20 rung 1 (Probe Not Off) - the off-proof latched in R02.'),
      R('XIC(Alarm[1].Active)OTU(NestEmptyNotOff);'),
      R(WARN(2, 5, `XIC(${ST('OpStatus.BypassA')})`), 'Station Bypassed\n\nSeverity 1 warning (S02 R20 form) - a bypassed check forces a pass and must never run silently.'),
      R(WARN(3, 6, `XIC(${ST('OpStatus.LockoutA')})`), 'Station Locked Out\n\nSeverity 1 warning (S02 R20 form).'),
      R(ALARM_HANDLER),
      R(FAULT_COUNT, 'Station Fault Count'),
    ]),
  ]);

// ── write + self-check (A twins must be side-total: only 'Left'/'LT' side words, never 'Right'/'RT'/lower-case 'left') ──
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = { 'S01_YSiteLoadA.xml': S01, 'S02_YVerifyA.xml': S02, 'S06_PortVerifyA.xml': S06, 'S16_EmptyNestA.xml': S16 };
let bad = 0;
for (const [file, xml] of Object.entries(OUT)) {
  const stray = xml.match(/\bRight\b|\bRT\b|\bright\b|\bleft\b|PartStatusRT|PartStatusLT|LockoutRT|LockoutLT|\bSide B\b/g);
  if (stray) { bad++; console.error(`${file}: side words that would not survive the A->B substitution: ${[...new Set(stray)].join(', ')}`); }
  fs.writeFileSync(path.join(OUT_DIR, file), xml, 'utf8');
  console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, file))}  (${xml.split('\n').length} lines, ${(xml.match(/<Tag Name=/g) || []).length} tags)`);
}
process.exit(bad ? 1 : 0);
