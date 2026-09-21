'use strict';
// gen_s07.cjs - emits S07_PortCutA.xml / S07_PortCutB.xml (Jason IV4 shape, chassis adaptation) from ONE template.
// Twins differ only by the side object below. Source of shape: generated/1160/build/IV4_SPEC.md section 5,
// Jason's Program_S06_IV4Vision.xml, and the v1.0 S07 listener whose pierce behaviour is preserved rung for rung.
const fs = require('fs');
const path = require('path');
const OUT = 'C:/SDC-StateLogic/generated/1160/build/programs';

const SIDES = {
  A: { S: 'A', side: 'Side A', nest: 'left', Nest: 'Left', NEST: 'LEFT', twin: 'S07_PortCutB',
       cam: 'cam06_LeftCutterPresent', ip: '192.168.1.36',
       slot: 9, extBit: 'Data[2].0', retBit: 'Data[2].1', bits: '16/17',
       sw: '1524PRX', swCbl: '1524CBL', swInput: 13, swBit: 'Data[1].5', swIn: 'IN5',
       shroudSlot: 7, shroudBit: 'Data[1].4', shroudBitNo: 12 },
  B: { S: 'B', side: 'Side B', nest: 'right', Nest: 'Right', NEST: 'RIGHT', twin: 'S07_PortCutA',
       cam: 'cam05_RightCutterPresent', ip: '192.168.1.35',
       slot: 8, extBit: 'Data[1].6', retBit: 'Data[1].7', bits: '14/15',
       sw: '1520PRX', swCbl: '1520CBL', swInput: 12, swBit: 'Data[1].4', swIn: 'IN4',
       shroudSlot: 6, shroudBit: 'Data[1].2', shroudBitNo: 10 },
};

const cd = (s) => `<![CDATA[${s}]]>`;
const strEl = (i, s) => `<Element Index="[${i}]">
<Structure DataType="STRING">
<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${s.length}"/>
<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">
${cd(`'${s}'`)}
</DataValueMember>
</Structure>
</Element>`;
const strArray = (arr) => `<Data Format="Decorated">
<Array DataType="STRING" Dimensions="${arr.length}">
${arr.map((s, i) => strEl(i, s)).join('\n')}
</Array>
</Data>`;
const timer = (pre) => `<Data Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</Data>`;

// tag(name, attrs, description, dataXml, commentsXml)
function tag(name, attrs, desc, data, comments) {
  const open = `<Tag Name="${name}" TagType="Base" ${attrs} Constant="false"`;
  if (!desc && !data && !comments) return `${open.replace(/ Constant="false"$/, '')} Constant="false"${attrs.includes('ExternalAccess') ? '' : ' ExternalAccess="Read/Write"'} OpcUaAccess="None"/>`;
  return `${open}${attrs.includes('ExternalAccess') ? '' : ' ExternalAccess="Read/Write"'} OpcUaAccess="None">
${desc ? `<Description>\n${cd(desc)}\n</Description>\n` : ''}${comments ? comments + '\n' : ''}${data ? data + '\n' : ''}</Tag>`;
}
const BOOL = 'DataType="BOOL" Radix="Decimal"';
const DINT = 'DataType="DINT" Radix="Decimal"';
const IN = `${BOOL} Usage="Input" ExternalAccess="Read/Write"`;
const OUTP = `${BOOL} Usage="Output" ExternalAccess="Read Only"`;
const PUB = `${BOOL} Usage="Public" ExternalAccess="Read/Write"`;

function rung(n, text, comment) {
  return `<Rung Number="${n}" Type="N">
${comment ? `<Comment>\n${cd(comment)}\n</Comment>\n` : ''}<Text>
${cd(text)}
</Text>
</Rung>`;
}
function routine(name, rungs) {
  return `<Routine Name="${name}" Type="RLL">
<RLLContent>
${rungs.map((r, i) => rung(i, r[0], r[1])).join('\n')}
</RLLContent>
</Routine>`;
}

function build(s) {
  const M = s.S;
  const N = (m) => `\\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.${m}`;
  const NI = (m) => `\\Tracking.p_Data.Nest[InspectNestNum].PartStatus.${m}`;
  const ST = (m) => `\\Tracking.p_Data.Station[StaNum].${m}`;
  const CAM = (inst, ang, adv) => `Chassis_CamPos_Check(${inst},${ang},\\Chassis.ChassisStatus.CamPosDeg,${adv},\\Chassis.ChassisStatus.ActualVelocity)`;
  const name = `S07_PortCut${M}`;

  // ---------------- TAGS ----------------
  const tags = [
    tag('Alarm', 'DataType="AlarmData" Dimensions="7"',
      `${s.side} alarms: [0] Consecutive Failures (fault), [1] Pierce Not Retracted Before Chassis Raise (fault + immediate stop request), [2] Cutter Tip Not Present - Pierce Locked Out (warning), [3] Waiting For Camera Trigger Ready (fault), [4] Waiting For Camera Results (fault), [5] Station Bypassed (warning), [6] Station Locked Out (warning). Message = CONCAT(g_StationList[StaNum], AlarmList[n]) in R20.`),
    tag('AlarmList', 'DataType="STRING" Dimensions="7"',
      `Alarm message suffixes. Station prefix comes from g_StationList[7] - never authored here. Twin text: Side A = Left nest, Side B = Right nest.`,
      strArray([
        `${s.side} Consecutive Failures`,
        `${s.side} Pierce Not Retracted Before Chassis Raise - Immediate Stop Requested`,
        `${s.side} Cutter Tip Not Present - Pierce Locked Out, Replace Needle`,
        `${s.side} Waiting For Camera Trigger Ready`,
        `${s.side} Waiting For Camera Results`,
        `${s.side} Station Bypassed`,
        `${s.side} Station Locked Out`,
      ])),
    tag('AOI_ProgramAlarmHandler', 'DataType="ProgramAlarmHandler"'),
    tag('CamPosCheckA', 'DataType="Chassis_CamPos_Check"', `Extend Pierce window (g_S07_PierceExtendAngle, timing advance 1) - leaves state 4`),
    tag('CamPosCheckB', 'DataType="Chassis_CamPos_Check"', `Retract Pierce window (g_S07_PierceRetractAngle, timing advance 1) - leaves state 7`),
    tag('CamPosCheckC', 'DataType="Chassis_CamPos_Check"', `Pierce Retracted deadline check (g_S07_PierceDeadlineAngle, timing advance 0) - every cycle, R03`),
    tag('CamPosCheckD', 'DataType="Chassis_CamPos_Check"', `Cutter inspect window (g_S07_CutterInspectAngle, timing advance 0) - leaves state 13 into the IV4 handshake`),
    tag('ConsecFails', 'DataType="ConsecFails"',
      `${s.side} consecutive S07 failures (71 did not extend, 72 tip not present, 73 cutter vision no result). Setpoint 3 = SDC standard default, HMI-settable; Count >= Setpoint = FAULT.`,
      `<Data Format="Decorated">
<Structure DataType="ConsecFails">
<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Setpoint" DataType="DINT" Radix="Decimal" Value="3"/>
</Structure>
</Data>`),
    tag('Control', 'DataType="StateLogicControl"', null,
      `<Data Format="Decorated">
<Structure DataType="StateLogicControl">
<DataValueMember Name="StateReg" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EnaFaultDetect" DataType="BOOL" Value="0"/>
<DataValueMember Name="EnaTransitionTimer" DataType="BOOL" Value="0"/>
<DataValueMember Name="FaultTime" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="TransitionTime" DataType="DINT" Radix="Decimal" Value="0"/>
</Structure>
</Data>`),
    tag('CycleRunning', BOOL),
    tag('CycleStation', BOOL, `${s.side} (${s.Nest} nest) qualified to pierce this cycle - first pass (no S07 Attempt${M} yet)`),
    tag('CycleStopped', BOOL),
    tag('CycleStopping', BOOL),
    tag('CycleTimer', 'DataType="TIMER"', `Station cycle timer - RTO across states 4-98, read into p_CycleTime on re-entry to state 4. PRE must exceed any cycle (an RTO holds ACC at PRE).`, timer(1000000)),
    tag('FailureMessages', 'DataType="STRING" Dimensions="5"',
      `Part failure reasons written into the nest side record (FailureType = StaNum x 10 + n): [0] 71 Pierce Did Not Extend, [1] 72 Cutter Tip Not Present, [2] 73 Cutter Vision No Result. FailureMessage = CONCAT(g_StationList[7], FailureMessages[n]).`,
      strArray(['Pierce Did Not Extend', 'Cutter Tip Not Present', 'Cutter Vision No Result', '', ''])),
    tag('FaultReset', BOOL),
    tag('FaultState', DINT),
    tag('HMI_LocalManualOverride', BOOL),
    tag('HMI_Momentary', DINT, null, null,
      `<Comments>
<Comment Operand=".0">
${cd('Extend Pierce')}
</Comment>
<Comment Operand=".1">
${cd('Retract Pierce')}
</Comment>
<Comment Operand=".2">
${cd('Vacuum Shroud On')}
</Comment>
<Comment Operand=".3">
${cd('Vacuum Shroud Off')}
</Comment>
<Comment Operand=".4">
${cd('Trigger Camera')}
</Comment>
</Comments>`),
    tag('HMI_MomentaryOnPrevScan', BOOL),
    tag('HMI_Toggle', DINT,
      `HMI toggles, SDC fixed bit map: .0 Lockout (not read here - station lockout is Tracking Station[7].OpStatus.Lockout${M}), .1 Dry Run (not read here - a dry-run pierce would fire the needle into an empty nest), .2 Single Step (R01 SS block). No other bit is assigned.`,
      null,
      `<Comments>
<Comment Operand=".0">
${cd('Lockout - fixed bit map position, not read here')}
</Comment>
<Comment Operand=".1">
${cd('Dry Run - fixed bit map position, not read here')}
</Comment>
<Comment Operand=".2">
${cd('Single Step')}
</Comment>
</Comments>`),
    tag('Initialized', BOOL),
    tag('InspectionComplete', BOOL, `IV4 handshake: camera update complete seen (either edge of i_CameraUpdateComplete) - cleared at state 4, required to leave state 19 (Jason IV4 standard)`),
    tag('InspectNestNum', DINT, `Nest number captured on entry to state 7 - every tracking write of this cycle (71 / 72 / 73 / Success) uses it, because the chassis does not hold the index for the camera result and Chassis rewrites NestNumCurrent at every index`),
    tag('i_bCameraTool1Result', IN, `IV4 tool 1 result = cutter tip present (${s.cam} ${s.ip}, ${s.cam}_IN.Data[3].0) - ${s.Nest} Cutter Present Camera, Keyence IV4-G120 / IV4-G500MA`),
    tag('i_bCameraTool2Result', IN, `IV4 tool 2 result (${s.cam}_IN.Data[3].1). Jason's pass test ANDs tool 1 and tool 2 - a one-tool camera program must set tool 2 OK or every part fails (spec Q2)`),
    tag('i_CameraReady', IN, `IV4 Ready (${s.cam}_IN.Data[1].5) - ${s.Nest} Cutter Present Camera`),
    tag('i_CameraResultsAvailable', IN, `IV4 Results Available (${s.cam}_IN.Data[1].0) - leaves state 19 with InspectionComplete`),
    tag('i_CameraRun', IN, `IV4 Run mode (${s.cam}_IN.Data[1].4) - with Ready = q_StartOK`),
    tag('i_CameraTriggerReady', IN, `IV4 Trigger Ready (${s.cam}_IN.Data[1].6) - leaves state 16`),
    tag('i_CameraUpdateComplete', IN, `IV4 Update Complete (${s.cam}_IN.Data[1].1) - either edge latches InspectionComplete`),
    tag('i_PierceExtended', IN,
      `Pierce Extended - SMC D-M9PSAPC cylinder switch ${s.sw}, vb01 upper valve bank input ${s.swInput} (Hailey 1160-V: S07-PORT CUT ${s.NEST.slice(0, 1)}T PIERCE EXTENDED; pneumatic drawing 1160-P-001 slot ${s.slot}). No Retracted switch is drawn - Retracted is DERIVED in R01. 1160-DGB-000 item 11: one D-M9PSAPC per MXS8-20 slide - confirm it is the Extended end (a Retracted switch is a BOM add).`),
    tag('LocalSSONS', BOOL),
    tag('Lockout', BOOL, `${s.side} station lockout (Tracking Station[7].OpStatus.Lockout${M}, not in Manual) - state 99 entry; exit on the State 2 rung`),
    tag('ManualMode', BOOL),
    tag('NestNumCurrent', DINT),
    tag('NestNumIncoming', DINT),
    tag('OkManExtendPierce', BOOL, `Manual extend permissive for the Pierce needle: Manual mode, safety OK, chassis cam not running and not jogging (tooling protection - a needle is never extended by hand while the cam can move). Retract is always permitted in Manual.`),
    tag('ONS', DINT),
    tag('p_CycleTime', 'DataType="REAL" Radix="Float" Usage="Public" ExternalAccess="Read/Write"', `Station cycle time (s), stamped on re-entry to state 4`,
      `<Data Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</Data>`),
    tag('p_ImmediateStopRequest', PUB,
      `The side-${M} Pierce needle was not proven retracted by g_S07_PierceDeadlineAngle - Chassis R01 'Chassis Immediate Stop Conditions' -> ChassisControl.ImmedStop (the chassis stops before it lifts the tooling through the part). Held until Fault Reset with the needle retracted. Chassis reads \\S07_PortCutA and \\S07_PortCutB.`),
    tag('p_PierceRetracted', PUB,
      `Side-${M} Pierce needle derived-retracted - Chassis R01 'Chassis Dial Index Permissives' IndexPermissiveStatus[7] = XIC(\\S07_PortCutA.p_PierceRetracted) XIC(\\S07_PortCutB.p_PierceRetracted).`),
    tag('Pierced', BOOL, `Side-${M} Pierce extended into the septum this cycle (Extended switch proven during state 7, or Bypass) - the side whose cutter tip is checked at g_S07_CutterInspectAngle (states 13 -> 16 -> 19 -> 22)`),
    tag('PierceExtended', BOOL),
    tag('PierceLockout', BOOL,
      `Side-${M} Pierce locked out by this program - latched when the cutter tip check reports the needle tip NOT present (broken tip, Mark: 'reject + lock out the station'); side ${M} is no longer pierced (CycleStation) and its parts are stamped Station[7].Lockout${M} (skipped). Severity 1 warning; cleared by Fault Reset after the needle is replaced.`),
    tag('PierceNotRetracted', BOOL),
    tag('PierceRetractDelay', 'DataType="TIMER"',
      `Pierce derived-retracted delay (ms): retract commanded, extend off and the Extended switch clear for this long = Retracted (no Retracted switch drawn). Seed 80 = nominal 20 mm stroke at 250 mm/s, sized so Retracted is proven (~264 deg at 1.2 s/cycle) before the 270 deg g_S07_PierceDeadlineAngle. HMI-adjustable; a Retracted switch (BOM add) replaces this timer.`,
      timer(80)),
    tag('PierceRetracted', BOOL),
    tag('q_AlarmActive', OUTP),
    tag('q_CameraTrigger', OUTP, `IV4 Trigger (${s.cam}_OUT.Data[0].0, MapOutputs copies the buffer to the module) - held during state 19; Manual = HMI_Momentary.4`),
    tag('q_ExtendPierce', OUTP,
      `Extend Pierce - ${s.Nest} - vb01 Upper Valve Bank slot ${s.slot} coil A (SY3200 double solenoid, pneumatic drawing 1160-P-001) - SMC MXS8-20 precision slide table (1160-DGB-000 item 8), 8 mm bore x 20 mm stroke; needle 1160-DGB-001 down`),
    tag('q_RetractPierce', OUTP,
      `Retract Pierce - ${s.Nest} - vb01 Upper Valve Bank slot ${s.slot} coil B - SMC MXS8-20 precision slide table (1160-DGB-000 item 8); needle 1160-DGB-001 up`),
    tag('q_StartOK', OUTP, `Camera in Run and Ready (Jason IV4 standard block) - no chassis consumer today; kept because it is where i_CameraReady / i_CameraRun are consumed`),
    tag('q_VacuumShroudOn', OUTP,
      `Vacuum Shroud On - ${s.Nest} - vb02 Table Valve Bank slot ${s.shroudSlot} (SY3100 single solenoid to the vacuum generator, pneumatic drawing 1160-P-002) - EXAIR 800003 low vacuum generator + SMC AF30-03B-D filter (1160-DGC-000, one per lane) pulling through the 1160-DGB-007 vacuum shroud`),
    tag('q_WarningActive', OUTP),
    tag('SafetyOK', BOOL),
    tag('SafetyStopState', DINT),
    tag('SS', BOOL),
    tag('SS_OK', BOOL),
    tag('StaNum', DINT),
    tag('StaNumPre', DINT),
    tag('StateEngine', 'DataType="State_Engine_128Max"', null,
      `<Data Format="Decorated">
<Structure DataType="State_Engine_128Max">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
</Structure>
</Data>`),
    tag('StateHistory', 'DataType="SINT" Dimensions="10" Radix="Decimal"', null,
      `<Data Format="Decorated">
<Array DataType="SINT" Dimensions="10" Radix="Decimal">
${Array.from({ length: 10 }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n')}
</Array>
</Data>`),
    tag('StationPerformance', 'DataType="StationPerformance"'),
    tag('Status', 'DataType="StateLogicStatus"', null, null,
      `<Comments>
${[[0, 'Emergency Stop'], [1, 'Manual Mode'], [2, 'Auto Mode Idle Not Ready'], [3, 'Auto Mode Idle Ready'],
   [4, 'Start Of Sequence, Wait For Pierce Window'], [7, 'Extend Pierce, Vacuum Shroud On'], [10, 'Retract Pierce, Prove Stroke'],
   [13, 'Wait For Cutter Inspect Window'], [16, 'Reset Inspection Complete, Check Camera Trigger Ready'], [19, 'Trigger Camera'],
   [22, 'Check Results'], [99, 'Lockout'], [100, 'Initialization - Retract Pierce'], [124, 'Initialization Complete'], [127, 'Faulted']]
   .map(([n, c]) => `<Comment Operand=".STATE[${n}]">\n${cd(c)}\n</Comment>`).join('\n')}
</Comments>`),
  ];

  // ---------------- R00_Main ----------------
  const R00 = [
    ['JSR(R01_Inputs,0);', `Subroutine Calls

S07 Port Cut - ${s.side} (${s.NEST} nest) - pierce + cutter-tip check STATE MACHINE (State_Engine_128Max; Jason IV4 standard program adapted to the chassis: Chassis_CamPos_Check windows leave states 4, 7 and 13). Twin of ${s.twin}: side members, points, camera node and text differ, nothing else.
States: 4 wait for the pierce window (g_S07_PierceExtendAngle) on a qualified side -> 7 extend Pierce, Vacuum Shroud on -> 10 retract Pierce at g_S07_PierceRetractAngle, stroke proven -> 13 wait for the cutter inspect window (g_S07_CutterInspectAngle), needle derived-retracted -> 16 reset inspection complete, check camera trigger ready -> 19 trigger camera -> 22 check results -> 4. 99 lockout; 100 initialization retract Pierce -> 124 complete; 127 fault.
Results: tip present (tool 1 AND tool 2) or Bypass = Success${M}; tip missing = Failure${M} 72 + PierceLockout (Severity 1 warning, side skipped until the needle is replaced and Fault Reset). Stroke not proven = Failure${M} 71. Camera timeout = fault + Failure${M} 73.
Handshakes: p_PierceRetracted -> Chassis IndexPermissiveStatus[7]; p_ImmediateStopRequest -> Chassis immediate stop (needle not retracted by g_S07_PierceDeadlineAngle); q_AlarmActive / q_WarningActive -> Alarms roll-up. Camera bits by ParameterConnection to the ${s.cam}_IN / _OUT buffers (MapInputs / MapOutputs CPS).`],
    ['JSR(R02_StateTransitions,0);'],
    ['JSR(R03_StateLogic,0);'],
    ['JSR(R20_Alarms,0);'],
  ];

  // ---------------- R01_Inputs ----------------
  const R01 = [
    // 2026-09-17 17:18 machine-wide fix pass (sibling workflow agent): valve-bank i_ points are bound by ParameterConnection
    // (vb01_UpperValveBank_IN.<bit> -> \S07_PortCutX.i_PierceExtended), MapInputs is the one CPS layer - no in-program map rung.
    ['[MOVE(7,StaNum) MOVE(6,StaNumPre) ,MOVE(\\Tracking.p_Data.Station[StaNum].NestNum,NestNumCurrent) MOVE(\\Tracking.p_Data.Station[StaNumPre].NestNum,NestNumIncoming) ];',
      `Mapped inputs - i_PierceExtended <- vb01_UpperValveBank_IN.${s.swBit} bound in controller/ParameterConnections.xml (MapInputs is the one CPS layer - Jason 2026-09-04); nothing is mapped in this program. Nest & Station Numbers

S07 Port Cut = dial position 7; predecessor S06 Port Verify (Station 6). S07 acts after the index is complete, so qualification uses NestNumCurrent; the tracking writes of a cycle use InspectNestNum captured on entry to state 7 (R03).`],
    ['XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);',
      `Logic inputs

State-machine form (Jason IV4 standard): CycleRunning = Supervisor cycle start latch OR the local manual override; CycleStopped = one shot of the Supervisor cycle-stopped signal while the sequence is not already idle.`],
    ['XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'],
    ['XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'],
    ['[XIC(\\Supervisor.q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ]OTE(CycleRunning);'],
    ['XIO(\\Supervisor.q_CycleStartLatch)XIO(HMI_LocalManualOverride)OTE(CycleStopping);'],
    ['XIC(\\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);'],
    ['XIC(i_PierceExtended)XIC(q_ExtendPierce)XIO(q_RetractPierce)OTE(PierceExtended);',
      `Pierce Derived State - one-sensor form (Extended switch only).

Extended = Extended switch made, extend commanded, retract off.
Retracted = the position no sensor covers: retract commanded, extend off, Extended switch clear, and PierceRetractDelay done (80 ms seed = nominal stroke, HMI-adjustable; sized to prove Retracted before the 270 deg deadline). Pneumatic drawing 1160-P-001 draws only ${s.sw} Extended on slot ${s.slot} - a Retracted switch is a BOM add; until then this derived bit is the dial index permissive proof (p_PierceRetracted), the immediate-stop deadline proof and Initialized. Consumers test these bits, never the raw switch or output.`],
    ['XIC(q_RetractPierce)XIO(q_ExtendPierce)XIO(i_PierceExtended)TON(PierceRetractDelay,?,?)XIC(PierceRetractDelay.DN)OTE(PierceRetracted);'],
    ['XIC(PierceRetracted)OTE(Initialized);',
      `Initialized - the one rest posture: needle derived-retracted (the pierce never holds a part). Not retracted at state 2 -> initialization 100 (retract) -> 124.`],
    [`XIC(${ST(`OpStatus.Lockout${M}`)})XIO(ManualMode)OTE(Lockout);`,
      `Lockout - ${s.side} of the station locked out on the HMI (Tracking Station[7].OpStatus.Lockout${M}), not in Manual. Both halves: state 99 entry in R02, exit branch on the State 2 rung (Jason 2026-09-04). HMI_Toggle.0 is the fixed bit map position, not read here.`],
    [`XIC(SafetyOK)XIC(CycleRunning)XIO(${ST(`OpStatus.Lockout${M}`)})XIO(PierceLockout)XIO(\\Tracking.p_Data.Nest[NestNumCurrent].OpStatus.Lockout)[XIC(${N(`Station[StaNumPre].Success${M}`)}) ,XIC(${N(`PartLoaded${M}`)}) XIC(${N(`Station[StaNumPre].Lockout${M}`)}) ]EQ(${N(`FailureType${M}`)},0)XIO(${N(`Station[StaNum].Attempt${M}`)})OTE(CycleStation);`,
      `Conditions For The Station To Cycle - ${s.side} (${s.Nest} nest)

Template S02_ProbeCheck form + EQ(FailureType,0) (URS reject rule: a part S05 / S06 failed is not pierced - Mark 20:18) + PierceLockout (this program's own side lockout after a broken-tip result). True only for a side S06 verified (or S06 was locked out over) with no failure on the record and no S07 attempt yet, no side-${M} station lockout and no fixture lockout. Leaves state 4 with the pierce window. HMI_Toggle.1 Dry Run is not read (a dry-run pierce would fire the needle into an empty nest).`],
    ['XIC(HMI_Toggle.2)OTE(SS);',
      `Single Step Logic

Standard block, emitted in R01 of every program (Jason 2026-09-10). SS from HMI_Toggle.2 (fixed bit map). S07 is PLC-driven (the pierce, the shroud and the camera trigger), so SS_OK IS consumed on every R02 sequence transition. Note: the window transitions (4 -> 7, 7 -> 10, 13 -> 16) are Chassis_CamPos_Check one-shots - in single step the station advances only when the step trigger coincides with the cam window; step the chassis instead.`],
    ['[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);'],
    ['XIC(ManualMode)XIC(SafetyOK)XIO(\\Chassis.ChassisStatus.Running)XIO(\\Chassis.ChassisStatus.Jogging)OTE(OkManExtendPierce);',
      `Manual Extend Permissive

The Pierce needle is extended by hand only in Manual, with safety OK and the chassis cam neither running nor jogging (tooling protection - the tooling must be parked, never moving, with a needle out). Retract is always permitted in Manual (no permissive).`],
    ['XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);', `Clear HMI Manual Triggers`],
    ['NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'],
  ];

  // ---------------- R02_StateTransitions ----------------
  const R02 = [
    ['NOP();', `STATE MAP: 4=Wait For Pierce Window | 7=Extend Pierce, Vacuum Shroud On | 10=Retract Pierce, Prove Stroke | 13=Wait For Cutter Inspect Window | 16=Reset Inspection Complete, Check Camera Trigger Ready | 19=Trigger Camera | 22=Check Results | 99=Lockout | 100=Initialization Retract Pierce | 124=Initialization Complete | 127=Fault
Start Of State Machine`],
    ['[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);',
      `State 2: Auto mode idle not ready`],
    ['[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[22]) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);',
      `State 3: Auto mode idle ready

Stop points: 4 (waiting for the window, needle up), 22 (results read) and 124 (initialization complete). 7 / 10 / 13 / 16 / 19 are NOT stop points: a cycle stop mid-dwell leaves the needle where the hub-lowered tooling holds it and the retract window fires when the cam resumes; a pierced part waits at 13 for its picture so it always gets a verdict.`],
    ['[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[124]) ,XIC(Status.State[22]) ,XIC(Status.State[13]) XIO(Pierced) ]XIC(CycleRunning)MOVE(4,Control.StateReg);',
      `State 4: Start of sequence - wait for the pierce window

Sources: idle ready, initialization complete, results read, or the inspect wait (13) when this side did not pierce this cycle (no tip to check - XIO(Pierced)). One destination per rung; the pierced case leaves 13 on the State 16 rung.`],
    [`XIC(Status.State[4])${CAM('CamPosCheckA', 'g_S07_PierceExtendAngle', 1)}XIC(CycleStation)XIC(SS_OK)MOVE(7,Control.StateReg);`,
      `State 7: Extend Pierce and Vacuum Shroud on

***NestNumCurrent Used Because The Needle Fires After The Dial Index Is Complete, Inside The Middle-Hub Down Dwell***

Chassis_CamPos_Check window at g_S07_PierceExtendAngle (controller-scope, shared by both twins; seed 195 deg, timing advance ON = actuator command; the AOI output is a one-shot) for a qualified side (CycleStation). A side that is not qualified (no septum, failed upstream, locked out) stays at 4 retract-commanded and nothing is written - S06 already carries its reason. The Attempt latch, the nest capture and the Pierced reset are R03 state-7 entry rungs (R02 holds transitions only - Jason 2026-09-17).`],
    [`XIC(Status.State[7])${CAM('CamPosCheckB', 'g_S07_PierceRetractAngle', 1)}XIC(SS_OK)MOVE(10,Control.StateReg);`,
      `State 10: Retract Pierce

Second command window at g_S07_PierceRetractAngle (seed 250 deg, timing advance ON): the mechanical stripper holds the septum while the needle draws out (Mark 20:18). The stroke proof (Pierced) is latched in R03 during state 7; a stroke not proven records Failure 71 on entry to 10 (R03). NO in-window retry - the down dwell has no room for a second stroke; the next fixture is a fresh attempt.`],
    ['XIC(Status.State[10])XIC(PierceRetracted)XIC(SS_OK)MOVE(13,Control.StateReg);',
      `State 13: Wait for the cutter inspect window - needle derived-retracted (retract commanded, extend off, Extended switch clear, PierceRetractDelay done). A needle still down at g_S07_PierceDeadlineAngle is caught by the R03 deadline check -> immediate stop request + fault.`],
    [`XIC(Status.State[13])${CAM('CamPosCheckD', 'g_S07_CutterInspectAngle', 0)}XIC(Pierced)XIC(SS_OK)MOVE(16,Control.StateReg);`,
      `State 16: Reset inspection complete and check camera trigger ready (Jason IV4 state 7)

Read window at g_S07_CutterInspectAngle (seed 300 deg, timing advance OFF): the needle is back and the tooling is still down (Mark 20:18: 'when it's in the retracted position here, we take a picture of it with the two IV4 sensors to make sure that the tip of the needle didn't break off in the part'). Only for a side that pierced this cycle (Pierced).`],
    ['XIC(Status.State[16])XIO(InspectionComplete)XIC(i_CameraTriggerReady)XIC(SS_OK)MOVE(19,Control.StateReg);',
      `State 19: Trigger camera (Jason IV4 state 10) - inspection complete cleared at state 4, camera reports trigger ready. R20 Alarm[3] 'Waiting For Camera Trigger Ready' times state 16 (1000 ms).`],
    ['XIC(Status.State[19])XIC(InspectionComplete)XIC(i_CameraResultsAvailable)XIC(SS_OK)MOVE(22,Control.StateReg);',
      `State 22: Check results (Jason IV4 state 13) - the camera has updated (InspectionComplete) and reports results available. R20 Alarm[4] 'Waiting For Camera Results' times state 19 (2000 ms). The verdict is written in R03 on state 22.`],
    ['XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);',
      `State 99: Lockout - entry (the exit is the XIC(Status.State[99]) XIO(CycleRunning) branch on the State 2 rung). While locked out the Pierce is commanded Retracted (R03) so the side never holds the dial index; loaded parts are stamped Station[7].Lockout${M} (R03).`],
    ['XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);',
      `State 100: Start of initialization - retract the Pierce (the only device; the needle never holds a part, so there is one init path)`],
    ['XIC(Status.State[100])XIC(PierceRetracted)XIC(SS_OK)MOVE(124,Control.StateReg);',
      `State 124: Initialization complete - needle derived-retracted. Exit 124 -> 4 on the State 4 rung.`],
    ['XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) ,MOVE(127,Control.StateReg) ];',
      `State 127: Fault - the sequence state is captured before it is overwritten (one shot, range-gated 4-99)`],
    ['XIC(ManualMode)MOVE(1,Control.StateReg);', `State 1: Manual Mode`],
    ['[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) ,MOVE(0,Control.StateReg) ];', `State 0: Safety Stop`],
    ['State_Engine_128Max(StateEngine,Control,Status,StateHistory);', `State Engine`],
  ];

  // ---------------- R03_StateLogic ----------------
  const R03 = [
    ['XIC(i_CameraReady)XIC(i_CameraRun)OTE(q_StartOK);',
      `Output Status To Supervisor - camera in Run and Ready (Jason IV4 standard block; the 2-UP Supervisor derives its own readiness, so this has no consumer today)`],
    [`XIC(Status.State[7])ONS(ONS.5)[MOVE(NestNumCurrent,InspectNestNum) ,OTL(${N(`Station[StaNum].Attempt${M}`)}) ,OTU(Pierced) ];`,
      `State 7 Entry - Attempt on the side-${M} record, nest captured for every tracking write of this cycle, Pierced rebuilt fresh

Chassis adaptation of Jason's IV4 program (which latches Attempt on the indexer handshake): the chassis cam does not wait for the camera result and Chassis R03_CalcDialStationNestNums rewrites NestNumCurrent at every index, so the 71 / 72 / 73 / Success writes below all use InspectNestNum.`],
    [`XIC(Status.State[7])[XIC(PierceExtended) ,XIC(${ST(`OpStatus.Bypass${M}`)}) ]OTL(Pierced);`,
      `Pierced - the Extended switch proven while extending (derived PierceExtended: switch made, extend commanded, retract off), or side-${M} station Bypass forces the pierced path (the results rung then forces Success). Pierced = this side is slit and its cutter tip is due for the check at the inspect window.`],
    [`XIC(Status.State[10])ONS(ONS.6)XIO(Pierced)XIO(${ST(`OpStatus.Bypass${M}`)})[OTU(${NI(`Station[StaNum].Success${M}`)}) ,OTL(${NI(`Station[StaNum].Failure${M}`)}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(71,${NI(`FailureType${M}`)}) ,CONCAT(g_StationList[StaNum],FailureMessages[0],${NI(`FailureMessage${M}`)}) ];`,
      `State 10 Entry - Pierce Did Not Extend

Extended NOT made during the extend state with Bypass off = the septum was not slit -> Failure${M}, FailureType${M} 71 (StaNum x 10 + 1), FailureMessage${M} = g_StationList[7] + FailureMessages[0], ConsecFails + 1, no tip check (a needle that did not reach the part has nothing to inspect - 13 -> 4 on XIO(Pierced)). The retract is commanded anyway (state 10).`],
    [`XIO(Status.State[1])${CAM('CamPosCheckC', 'g_S07_PierceDeadlineAngle', 0)}XIO(PierceRetracted)OTL(PierceNotRetracted);`,
      `Check Pierce Retracted Before The Chassis Raises The Tooling

Read window at g_S07_PierceDeadlineAngle (seed 270 deg = 17.5 deg / 58 ms before the middle hub leaves down-place at 287.5; timing advance OFF - a check), every cycle in every state but Manual. The needle not derived-retracted (a stuck Extended switch or a needle still in the part both fail this) latches PierceNotRetracted -> p_ImmediateStopRequest -> Chassis 'Immediate Stop Conditions' -> ChassisControl.ImmedStop, so the chassis stops before it lifts the tooling through the part; R20 Alarm[1] FAULT. Checked regardless of qualification and lockout - a physical proof.

TIMING (1.2 s cycle = 3.3 ms/deg): retract commanded ~237 deg (250 less ~13 deg timing advance at 300 deg/s), switch clears ~240, PierceRetractDelay 80 ms -> Retracted ~264 deg, deadline 270 - about 20 ms margin. Mark Q6 and the Retracted-switch BOM add are the real fixes; the angles and the delay are HMI-adjustable meanwhile.`],
    ['XIC(FaultReset)XIC(PierceRetracted)OTU(PierceNotRetracted);',
      `Clear the not-retracted latch - Fault Reset with the needle now proven retracted (a Fault Reset with the needle still down keeps the immediate stop request up; the operator retracts it in Manual first).`],
    ['XIC(PierceRetracted)OTE(p_PierceRetracted);',
      `Dial Index Permissive (Public)

p_PierceRetracted = the side-${M} needle derived-retracted, published every scan -> Chassis R01 'Chassis Dial Index Permissives' IndexPermissiveStatus[7] = XIC(\\S07_PortCutA.p_PierceRetracted) XIC(\\S07_PortCutB.p_PierceRetracted) ('S07 Pierce Not Retracted' when false).`],
    ['XIC(PierceNotRetracted)OTE(p_ImmediateStopRequest);',
      `Immediate Stop Request (Public)

The not-retracted latch -> p_ImmediateStopRequest -> Chassis R01 'Chassis Immediate Stop Conditions' (ChassisControl.ImmedStop, chassis state 37); Chassis ORs \\S07_PortCutA and \\S07_PortCutB. Held until Fault Reset with the needle retracted (previous rungs).`],
    [`XIC(SafetyOK)XIC(CycleRunning)XIC(${N(`PartLoaded${M}`)})XIO(${N(`Station[StaNum].Attempt${M}`)})[XIC(${ST(`OpStatus.Lockout${M}`)}) ,XIC(PierceLockout) ]OTL(${N(`Station[StaNum].Lockout${M}`)});`,
      `Station Locked Out - stamp the step as skipped (not failed) on the side-${M} part record (template S02_ProbeCheck rung 3 shape) while side ${M} of the station is locked out on the HMI OR while this program has locked the Pierce out after a broken-tip result (PierceLockout), so S08-S13 treat S07 as skipped on this side. Only a part not yet attempted here is stamped. FLAG (Mark Q5b): if unslit parts are rejects this stamp becomes Failure + FailureType 75 'Pierce Locked Out'.`],
    ['XIO(Status.State[1])XIC(Status.State[4])OTU(InspectionComplete);',
      `Camera Control (Jason IV4 standard rungs) - reset the inspection-complete latch at the start of every cycle; trigger held during state 19 (Manual: HMI_Momentary.4); either edge of the camera's Update Complete latches InspectionComplete.`],
    ['[XIO(Status.State[1]) XIC(Status.State[19]) ,XIC(Status.State[1]) XIC(HMI_Momentary.4) ]OTE(q_CameraTrigger);'],
    ['[XIC(i_CameraUpdateComplete) ONS(ONS.8) ,XIO(i_CameraUpdateComplete) ONS(ONS.9) ]OTL(InspectionComplete);'],
    [`XIO(Status.State[1])XIC(Status.State[22])ONS(ONS.12)[[XIC(i_bCameraTool1Result) XIC(i_bCameraTool2Result) ,XIC(${ST(`OpStatus.Bypass${M}`)}) ] [OTL(${NI(`Station[StaNum].Success${M}`)}) ,OTU(${NI(`Station[StaNum].Failure${M}`)}) ,MOVE(0,ConsecFails.Count) ] ,XIO(${ST(`OpStatus.Bypass${M}`)}) [XIO(i_bCameraTool1Result) ,XIO(i_bCameraTool2Result) ] [OTU(${NI(`Station[StaNum].Success${M}`)}) ,OTL(${NI(`Station[StaNum].Failure${M}`)}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(72,${NI(`FailureType${M}`)}) ,CONCAT(g_StationList[StaNum],FailureMessages[1],${NI(`FailureMessage${M}`)}) ,OTL(PierceLockout) ] ];`,
      `Results - Cutter Tip Check (Jason IV4 results rung, one shot on state 22)

Tip present = every camera tool OK, or side-${M} station Bypass -> Success${M}, Failure${M} cleared, ConsecFails cleared. Tip missing (any tool NG, Bypass off) = the tip broke off in the part -> Failure${M}, FailureType${M} 72 'Cutter Tip Not Present' (StaNum x 10 + 2), FailureMessage${M} = g_StationList[7] + FailureMessages[1], ConsecFails + 1, AND PierceLockout latched: the needle is broken, so side ${M} is no longer pierced (R01 CycleStation) and its parts are stamped skipped until the needle is replaced and Fault Reset pressed - Severity 1 warning in R20 (Mark 20:18 / 23:16: 'reject that part and then have to lock out that station'). Written to Nest[InspectNestNum] - the nest captured at state 7.`],
    [`[XIC(Alarm[3].Active) ,XIC(Alarm[4].Active) ]ONS(ONS.13)XIC(Pierced)XIC(${NI(`Station[StaNum].Attempt${M}`)})XIO(${NI(`Station[StaNum].Success${M}`)})XIO(${NI(`Station[StaNum].Failure${M}`)})[OTL(${NI(`Station[StaNum].Failure${M}`)}) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(73,${NI(`FailureType${M}`)}) ,CONCAT(g_StationList[StaNum],FailureMessages[2],${NI(`FailureMessage${M}`)}) ];`,
      `Cutter Vision No Result - a camera timeout (Alarm[3] trigger ready / Alarm[4] results) is a FAULT in Jason's shape; the pierced part it was taken on must still carry a verdict, so the attempted, unjudged record is stamped Failure${M} 73 once (spec Q9).`],
    ['[XIO(Status.State[1]) XIC(Status.State[7]) ,XIC(Status.State[1]) [XIC(HMI_Momentary.0) XIC(OkManExtendPierce) ,XIC(q_ExtendPierce) XIO(HMI_Momentary.1) ] ]OTE(q_ExtendPierce);',
      `Pierce Control

One rung per output, auto and manual in the same rung with the seal-in inside (Jason 2026-09-01). Auto: extend commanded through state 7 (window at g_S07_PierceExtendAngle to window at g_S07_PierceRetractAngle) - a cycle stop mid-dwell stays in 7 with the needle where the hub-lowered tooling already holds it, and the retract window fires when the cam resumes; a fault or safety stop leaves 7 and the needle retracts. Manual: HMI_Momentary.0 extend (OkManExtendPierce: cam parked) / .1 retract.`],
    ['[XIO(Status.State[1]) [XIC(Status.State[10]) ,XIC(Status.State[99]) ,XIC(Status.State[100]) ,XIO(q_ExtendPierce) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.1) ,XIC(q_RetractPierce) XIO(HMI_Momentary.0) ] ]OTE(q_RetractPierce);',
      `Retract Pierce - auto at 10, 99, 100 and whenever extend is not commanded (power-up, idle, non-qualified side): the double-solenoid valve is driven to the retracted position, which p_PierceRetracted (dial index permissive) and the deadline check prove. Manual: HMI_Momentary.1 retract / .0 extend, retract always permitted.`],
    ['[XIO(Status.State[1]) [XIC(Status.State[7]) ,XIC(Status.State[10]) ,XIC(Status.State[13]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.2) ,XIC(q_VacuumShroudOn) XIO(HMI_Momentary.3) ] ]OTE(q_VacuumShroudOn);',
      `Vacuum Shroud Control

Single-solenoid spring-return valve (vb02 slot ${s.shroudSlot}) to the Exair vacuum generator: one output, ON = exhaust running. Auto: on while slitting and retracting - states 7, 10, 13 - off at the inspect window (Mark 23:42 / 24:08: on while lowering / slitting / retracting, off as it raises; the picture is taken with the shroud off - spec Q11). Manual: HMI_Momentary.2 on / .3 off. Mark's 'leave it on all the time' fallback (24:31) = hold it in Manual or widen the angles on the HMI - no toggle bit is assigned.`],
    [`StationPerformance(StationPerformance,${N(`Station[StaNum].Attempt${M}`)},${N(`Station[StaNum].Success${M}`)},g_PresetStationPerformLow,g_PresetStationPerformHigh,\\Tracking.p_Data.Station[StaNum].PerformData.Attempts${M},\\Tracking.p_Data.Station[StaNum].PerformData.Successes${M},\\Tracking.p_Data.Station[StaNum].PerformData.Failures${M},\\Tracking.p_Data.Station[StaNum].PerformData.Efficiency${M},\\Tracking.p_Data.Station[StaNum].PerformData.HMIColorStatus${M});`,
      `Station Performance

Side ${M} instance accumulating into Station[7].PerformData side-${M} counters; the AOI edge-detects its own Attempt / Success. Both read the live nest (template S02 form).`],
    [`[XIC(q_ExtendPierce) OTE(vb01_UpperValveBank_OUT.${s.extBit}) ,XIC(q_RetractPierce) OTE(vb01_UpperValveBank_OUT.${s.retBit}) ];`,
      `Valve Bank Output Mapping - Upper Bank (Pierce)

1160: vb01 Upper Valve Bank (SMC EX600-SEN7, HHB-183731, pneumatic drawing 1160-P-001) slot ${s.slot} = ${s.Nest} Pierce (Extended ${s.sw}), SY3200 double solenoid. Contract bit rule: slot n -> output bits 2n-2 (A = extend) and 2n-1 (B = retract), bit i at vb01_UpperValveBank_OUT.Data[i/8].(i mod 8): slot ${s.slot} -> bits ${s.bits} = ${s.extBit} extend / ${s.retBit} retract. MapOutputs copies vb01_UpperValveBank_OUT to the module; this program never writes the module tag. Confirm against the SMC configurator.`],
    [`XIC(q_VacuumShroudOn)OTE(vb02_TableValveBank_OUT.${s.shroudBit});`,
      `Valve Bank Output Mapping - Table Bank (Vacuum Shroud)

1160: vb02 Table Valve Bank (SMC EX600-SEN7, HHB-183728, pneumatic drawing 1160-P-002) slot ${s.shroudSlot} = ${s.Nest} Vacuum Shroud, SY3100 single solenoid to the vacuum generator (single valves use bit 2n-2 only): slot ${s.shroudSlot} -> bit ${s.shroudBitNo} = ${s.shroudBit}. MapOutputs copies vb02_TableValveBank_OUT to the module. Confirm against the SMC configurator / 1160-P-002.`],
    ['[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];',
      `Cycle Time - stamped on re-entry to state 4 and run across the in-sequence states (PLC-driven station form; here in R03, not R02 - Jason 2026-09-17)`],
  ];

  // ---------------- R20_Alarms ----------------
  const R20 = [
    [`[XIC(CycleRunning) XIO(${ST(`OpStatus.Lockout${M}`)}) GE(ConsecFails.Count,ConsecFails.Setpoint) ,XIC(Alarm[0].Active) XIO(FaultReset) ][OTE(Alarm[0].Active) ,ONS(ONS.14) CONCAT(g_StationList[StaNum],AlarmList[0],Alarm[0].Message) ];`,
      `Consecutive Failures

Check-station form: FAULT held until Fault Reset (template S02_ProbeCheck); ConsecFails.Setpoint default 3, HMI-settable. Counts every side-${M} S07 failure (71 did not extend, 72 tip not present, 73 cutter vision no result); a pass clears it. Message = g_StationList[7] + AlarmList[0].`],
    ['XIC(Alarm[0].Active)MOVE(0,ConsecFails.Count);'],
    ['XIC(PierceNotRetracted)[OTE(Alarm[1].Active) ,ONS(ONS.15) CONCAT(g_StationList[StaNum],AlarmList[1],Alarm[1].Message) ];',
      `Pierce Not Retracted Before Chassis Raise

FAULT driven by the R03 deadline latch (PierceNotRetracted), which is itself the seal: it clears only on Fault Reset with the needle proven retracted, and while it stands p_ImmediateStopRequest holds the chassis. Chassis side: AlarmIndexPerm 'S07 Pierce Not Retracted' and the ImmedStop warning.`],
    ['XIC(PierceLockout)[OTE(Alarm[2].Active) ,MOVE(1,Alarm[2].Severity) ,ONS(ONS.16) CONCAT(g_StationList[StaNum],AlarmList[2],Alarm[2].Message) ];',
      `Cutter Tip Not Present - Pierce Locked Out

Severity 1 WARNING while this program holds side ${M} locked out after a broken-tip result (R03 results rung): the machine keeps running, side ${M} is skipped (stamped Station[7].Lockout${M}), the operator replaces the needle and presses Fault Reset (next rung). Mark Q5 decides stop-on-first-failed-picture vs keep-running; built as keep-running with the warning (the ConsecFails fault still stops the machine on repeated failures).`],
    ['XIC(FaultReset)OTU(PierceLockout);',
      `Fault Reset clears the Pierce lockout (needle replaced). If the tip is still missing the next check locks the side out again with one more reject.`],
    ['[XIC(Status.State[16]) MOVE(1000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[3].Active) XIO(FaultReset) ][OTE(Alarm[3].Active) ,ONS(ONS.17) CONCAT(g_StationList[StaNum],AlarmList[3],Alarm[3].Message) ];',
      `Waiting For Camera Trigger Ready (Jason IV4 standard rung, state 16, 1000 ms) - FAULT held to Fault Reset; the pierced part is stamped Failure 73 in R03.`],
    ['[XIC(Status.State[19]) MOVE(2000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[4].Active) XIO(FaultReset) ][OTE(Alarm[4].Active) ,ONS(ONS.18) CONCAT(g_StationList[StaNum],AlarmList[4],Alarm[4].Message) ];',
      `Waiting For Camera Results (Jason IV4 standard rung, state 19, 2000 ms) - FAULT held to Fault Reset.`],
    [`XIC(${ST(`OpStatus.Bypass${M}`)})[OTE(Alarm[5].Active) ,MOVE(1,Alarm[5].Severity) ,ONS(ONS.19) CONCAT(g_StationList[StaNum],AlarmList[5],Alarm[5].Message) ];`,
      `Station Bypassed

Severity 1 warning - side-${M} Bypass forces the pierced path and a pass at the results rung; it must never run silently (template S02 R20 form).`],
    [`XIC(${ST(`OpStatus.Lockout${M}`)})[OTE(Alarm[6].Active) ,MOVE(1,Alarm[6].Severity) ,ONS(ONS.20) CONCAT(g_StationList[StaNum],AlarmList[6],Alarm[6].Message) ];`,
      `Station Locked Out

Severity 1 warning - a locked-out side sits at state 99, pierces nothing and stamps Station[7].Lockout${M} in R03.`],
    ['ProgramAlarmHandler(AOI_ProgramAlarmHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);'],
    [`XIC(q_AlarmActive)ONS(ONS.21)ADD(\\Tracking.p_Data.Station[StaNum].PerformData.FaultCount${M},1,\\Tracking.p_Data.Station[StaNum].PerformData.FaultCount${M});`,
      `Station Fault Count`],
  ];

  const desc = `S07 Port Cut - ${s.side} (${s.NEST} nest) - pierce + cutter-tip check state machine (Jason IV4 standard, chassis adaptation). Extend the ${s.Nest} Pierce (vb01 slot ${s.slot}) at g_S07_PierceExtendAngle, retract at g_S07_PierceRetractAngle, prove retracted by g_S07_PierceDeadlineAngle (else immediate stop + fault), ${s.Nest} Vacuum Shroud (vb02 slot ${s.shroudSlot}), ${s.Nest} Cutter Present Camera (${s.cam}) at g_S07_CutterInspectAngle: tip present = pass, missing = Failure 72 + side locked out. Twin of ${s.twin}.`;

  return `<Program Name="${name}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cd(desc)}
</Description>
<Tags>
${tags.join('\n')}
</Tags>
<Routines>
${routine('R00_Main', R00)}
${routine('R01_Inputs', R01)}
${routine('R02_StateTransitions', R02)}
${routine('R03_StateLogic', R03)}
${routine('R20_Alarms', R20)}
</Routines>
</Program>
`;
}

for (const k of ['A', 'B']) {
  const xml = build(SIDES[k]);
  const f = path.join(OUT, `S07_PortCut${k}.xml`);
  fs.writeFileSync(f, xml.replace(/\r?\n/g, '\n'), 'utf8');
  console.log('wrote', f, xml.length, 'chars');
}
