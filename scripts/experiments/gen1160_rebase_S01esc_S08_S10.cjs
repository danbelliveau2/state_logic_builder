#!/usr/bin/env node
'use strict';
/**
 * gen1160_split.cjs - Job 1160 re-base onto Jason's 2-UP chassis template (2026-09-17).
 * Emits, from ONE parameterized source per station so the A/B twins are identical by construction:
 *   S01_YSiteEscapementA.xml / S01_YSiteEscapementB.xml   (split of build_v0 S01_YSiteEscapement.xml)
 *   S08_YHeatA.xml / S10_YHeatB.xml                         (rename of build_v0 S08_RightYHeat.xml / S10_LeftYHeat.xml)
 * Output dir: generated/1160/build/programs/
 */
const fs = require('fs');
const path = require('path');
const OUT = path.resolve('C:/SDC-StateLogic/generated/1160/build/programs');

// ---------------------------------------------------------------- helpers
const AX = 'Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"';
const RO = 'Constant="false" ExternalAccess="Read Only" OpcUaAccess="None"';
const desc = (d) => (d ? `\n<Description>\n<![CDATA[${d}]]>\n</Description>` : '');
const bool = (name, o = {}) => {
  const usage = o.usage ? ` Usage="${o.usage}"` : '';
  const ax = o.usage === 'Output' || (o.usage === 'Public' && o.ro) ? RO : AX;
  const val = o.value !== undefined ? o.value : 0;
  if (!o.desc && val === 0) return `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal"${usage} ${ax}/>`;
  return `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal"${usage} ${ax}>${desc(o.desc)}\n<Data Format="Decorated">\n<DataValue DataType="BOOL" Radix="Decimal" Value="${val}"/>\n</Data>\n</Tag>`;
};
const dint = (name, o = {}) => {
  const usage = o.usage ? ` Usage="${o.usage}"` : '';
  const cm = o.comments ? `\n<Comments>\n${Object.entries(o.comments).map(([k, v]) => `<Comment Operand="${k}">\n<![CDATA[${v}]]>\n</Comment>`).join('\n')}\n</Comments>` : '';
  if (!o.desc && !cm) return `<Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal"${usage} ${AX}/>`;
  return `<Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal"${usage} ${AX}>${desc(o.desc)}${cm}\n</Tag>`;
};
const real = (name, o = {}) => {
  const usage = o.usage ? ` Usage="${o.usage}"` : '';
  const data = o.value !== undefined ? `\n<Data Format="Decorated">\n<DataValue DataType="REAL" Radix="Float" Value="${o.value}"/>\n</Data>` : '';
  return `<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float"${usage} ${AX}>${desc(o.desc)}${data}\n</Tag>`;
};
const timer = (name, pre, d) => `<Tag Name="${name}" TagType="Base" DataType="TIMER" ${AX}>${desc(d)}\n<Data Format="Decorated">\n<Structure DataType="TIMER">\n<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>\n<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="EN" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TT" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DN" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
const udt = (name, dt, o = {}) => `<Tag Name="${name}" TagType="Base" DataType="${dt}"${o.dims ? ` Dimensions="${o.dims}"` : ''}${o.radix ? ` Radix="${o.radix}"` : ''} ${AX}>${desc(o.desc)}${o.comments ? `\n<Comments>\n${Object.entries(o.comments).map(([k, v]) => `<Comment Operand="${k}">\n<![CDATA[${v}]]>\n</Comment>`).join('\n')}\n</Comments>` : ''}\n</Tag>`;
const consecFails = (name, setpoint, d) => `<Tag Name="${name}" TagType="Base" DataType="ConsecFails" ${AX}>${desc(d)}\n<Data Format="Decorated">\n<Structure DataType="ConsecFails">\n<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Setpoint" DataType="DINT" Radix="Decimal" Value="${setpoint}"/>\n</Structure>\n</Data>\n</Tag>`;
const debounce = (name, d) => `<Tag Name="${name}" TagType="Base" DataType="AOI_Debounce" ${AX}>${desc(d)}\n<Data Format="L5K">\n<![CDATA[[1,0,0,[0,0,0],[0,0,0]]]]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="AOI_Debounce">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Input" DataType="BOOL" Value="0"/>\n<DataValueMember Name="OnDelay" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="OffDelay" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="On" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Off" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
const rangeCheck = (name, d) => `<Tag Name="${name}" TagType="Base" DataType="AOI_RangeCheck" ${AX}>${desc(d)}\n<Data Format="Decorated">\n<Structure DataType="AOI_RangeCheck">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Value" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="Deadband" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="Actual" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="InPos" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DeadbandWide" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="InPosWide" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
function stringArray(name, texts, d) {
  for (const t of texts) { if (t.length > 82) throw new Error(`STRING > 82: ${t}`); if (/'/.test(t)) throw new Error(`apostrophe in STRING: ${t}`); }
  const els = texts.map((t, i) => `<Element Index="[${i}]">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${t.length}"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[${t ? `'${t}'` : ''}]]>\n</DataValueMember>\n</Structure>\n</Element>`).join('\n');
  return `<Tag Name="${name}" TagType="Base" DataType="STRING" Dimensions="${texts.length}" ${AX}>${desc(d)}\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="${texts.length}">\n${els}\n</Array>\n</Data>\n</Tag>`;
}
const stateComments = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`.STATE[${k}]`, v]));

function routine(name, rungs) {
  const body = rungs.map((r, i) => `<Rung Number="${i}" Type="N">${r.c ? `\n<Comment>\n<![CDATA[${r.c}]]>\n</Comment>` : ''}\n<Text>\n<![CDATA[${r.t}]]>\n</Text>\n</Rung>`).join('\n');
  return `<Routine Name="${name}" Type="RLL">\n<RLLContent>\n${body}\n</RLLContent>\n</Routine>`;
}
const R = (t, c) => ({ t, c });
function program(name, description, tags, routines) {
  return `<Program Name="${name}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">\n<Description>\n<![CDATA[${description}]]>\n</Description>\n<Tags>\n${tags.join('\n')}\n</Tags>\n<Routines>\n${routines.join('\n')}\n</Routines>\n</Program>\n`;
}
function checkAscii(name, xml) {
  const errs = [];
  const bad = xml.match(/[^\x09\x0A\x0D\x20-\x7E]/);
  if (bad) errs.push(`${name}: non-ASCII U+${bad[0].codePointAt(0).toString(16)}`);
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) if (m[1].length > 512) errs.push(`${name}: Description ${m[1].length} > 512: ${m[1].slice(0, 70)}`);
  for (const m of xml.matchAll(/<Comment Operand="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) if (m[2].length > 512) errs.push(`${name}: operand comment ${m[1]} > 512`);
  if (/Use="/.test(xml)) errs.push(`${name}: Use= attribute`);
  if (errs.length) throw new Error('\n' + errs.join('\n'));
}

// ================================================================ S01_YSiteEscapement A / B
function escapement(S) {
  // S = side parameters
  const L = S.letter, side = `Side ${L}`, LOAD = `S01_YSiteLoad${L}`, PROG = `S01_YSiteEscapement${L}`;
  const T = `\\Tracking.p_Data`;
  const loA = `Lockout${L}`;
  const ons = (() => { let n = 0; return () => `ONS.${n++}`; })();
  const onsCycleStopped = ons(), onsSS = ons(), onsFault = ons(), onsSafety = ons(), onsCycleTime = ons(), onsConsec = ons();

  const alarmTexts = [
    `${side} Escapement Waiting For Part Present`,
    `${side} Y-Site Supply Starved Three Cycles In A Row`,
    `${side} Waiting For Hold Back To Extend`,
    `${side} Waiting For Hold Back To Retract`,
    `${side} Hold Back Outputs Misconfigured`,
    `${side} Waiting For Lift To Raise`,
    `${side} Waiting For Lift To Lower`,
    `${side} Lift Outputs Misconfigured`,
    `${side} Escapement Waiting For Y-Site Load To Pick The Part`,
    S.feeder ? 'Y-Site Body Feeder Fault' : '',
    S.feeder ? 'Y-Site Body Feeder Low Level' : '',
  ];

  const description = `S01 Y-Site Escapement ${L} - escapement state machine (State_Engine_128Max) feeding one Y-site to the ${S.nestWord} dead nest for the S01 pick (two-up: ${side} = ${S.nestLong}). Own Hold Back (MIS8-10D, vb02 slot ${S.hbSlot}, no switch - delays), Lift (CDQ2WB20-25, vb02 slot ${S.liftSlot}, Lowered switch input ${S.liftLoweredIn}, Raised input unmapped), Part Present fiber (FU-77TZ, input ${S.ppIn}). Waits ${LOAD}.p_PartsPicked; publishes p_PartReady, q_PauseRequest.${S.feeder ? ' Side A owns the shared Y-Site Body Feeder enable + speeds.' : ''} Job 1160.`;

  const tags = [
    udt('Alarm', 'AlarmData', { dims: alarmTexts.length }),
    stringArray('AlarmList', alarmTexts, `Alarm message suffixes; R20 builds Alarm[n].Message = CONCAT(g_StationList[StaNum], AlarmList[n]).${S.feeder ? ' [9] and [10] are the shared Y-Site Body Feeder stubs - side A owns the feeder (NAMES CONTRACT).' : ' [9] and [10] are blank: the shared Y-Site Body Feeder belongs to S01_YSiteEscapementA only (NAMES CONTRACT).'}`),
    timer('AlarmTimerHoldBackExtended', 3000, 'Alarm Timer - Hold Back Extended'),
    timer('AlarmTimerHoldBackMisconfigured', 50, 'Alarm Timer - Hold Back Outputs Misconfigured'),
    timer('AlarmTimerHoldBackRetracted', 3000, 'Alarm Timer - Hold Back Retracted'),
    timer('AlarmTimerLiftLowered', 3000, 'Alarm Timer - Lift Lowered'),
    timer('AlarmTimerLiftMisconfigured', 50, 'Alarm Timer - Lift Outputs Misconfigured'),
    timer('AlarmTimerLiftRaised', 3000, 'Alarm Timer - Lift Raised'),
    udt('AOI_ProgramAlarmHandler', 'ProgramAlarmHandler'),
    consecFails('ConsecFails', 3, `Consecutive cycles the ${side} dead nest starved past the part-present wait (Count) and the three-strikes setpoint (default 3) - SDC load-station form: warning + pause, never a fault`),
    udt('Control', 'StateLogicControl'),
    timer('CycleTimer', 1000000),
    bool('CycleRunning'),
    bool('CycleStopped', { desc: 'Cycle Stop Override From Supervisor' }),
    bool('CycleStopping'),
    bool('DryRun'),
    bool('FaultReset'),
    dint('FaultState'),
    ...(S.feeder ? [
      real('HMI_LeftBowlFeederSpeed', { value: 2.5, desc: 'Y-Site Body Left Bowl Feeder speed reference (V) - CUI SDVC34 bowl drive, written DIRECTLY to AOUT1:O.Ch01.Data (5069-OF8 OUT1, voltage mode; no buffer - NAMES CONTRACT). Seed 2.5 V, clamped 0-5 V (SDVC34 speed input 0-5 V per the Belco feeder-control drawing) - CE to confirm the span; HMI-adjustable, retained. Left/Right here name the two Belco bowls of the ONE shared feeder owned by side A, not a nest side.' }),
      real('HMI_LinearTrackSpeed', { value: 2.5, desc: 'Y-Site Body Linear Track speed reference (V) - CUI SDVC311 linear drive, written DIRECTLY to AOUT1:O.Ch02.Data (5069-OF8 OUT2, voltage mode; no buffer - NAMES CONTRACT). Seed 2.5 V, clamped 0-5 V - the SDVC311 speed input terminates A1-A3, a different termination from the SDVC34, so the CE confirms both spans; HMI-adjustable, retained.' }),
    ] : []),
    bool('HMI_LocalManualOverride'),
    dint('HMI_Momentary', { comments: Object.assign({ '.0': 'Extend Hold Back', '.1': 'Retract Hold Back', '.2': 'Raise Lift', '.3': 'Lower Lift' }, S.feeder ? { '.4': 'Y-Site Body Feeder On', '.5': 'Y-Site Body Feeder Off' } : {}) }),
    bool('HMI_MomentaryOnPrevScan'),
    ...(S.feeder ? [
      real('HMI_RightBowlFeederSpeed', { value: 2.5, desc: 'Y-Site Body Right Bowl Feeder speed reference (V) - CUI SDVC34 bowl drive, written DIRECTLY to AOUT1:O.Ch00.Data (5069-OF8 OUT0, voltage mode; no buffer - NAMES CONTRACT). Seed 2.5 V, clamped 0-5 V (SDVC34 speed input 0-5 V, +5 V reference on A3 per the Belco feeder-control drawing) - CE to confirm the span; HMI-adjustable, retained. Left/Right here name the two Belco bowls of the ONE shared feeder owned by side A, not a nest side.' }),
    ] : []),
    dint('HMI_Toggle', { desc: `HMI toggles, SDC fixed bit map: .1 Dry Run (fiber check passes without a part), .2 Single Step (R01 SS block, identical in every 1160 program). Bit 0 is not read here: station lockout comes from Tracking Station[StaNum].OpStatus.${loA} (template form) and the production toggle lives in ${LOAD}. No other bit is assigned.`, comments: { '.1': 'Dry Run', '.2': 'Single Step' } }),
    bool('HoldBackExtended'),
    timer('HoldBackExtendDelay', 100, 'Hold Back Extended Delay Timer - no switch on the MIS8-10D (NAMES CONTRACT: retract/extend on delay), 10 mm stroke; proposal 100 ms, HMI-adjustable (the 1000 ms under-100 mm default does not fit the 1.2 s cycle)'),
    bool('HoldBackRetracted'),
    timer('HoldBackRetractDelay', 100, 'Hold Back Retracted Delay Timer - no switch on the MIS8-10D (NAMES CONTRACT: retract on delay; 1160-DAA-000 item 14 draws no switch, schematic points 1651/1655PRX are unread); proposal 100 ms, HMI-adjustable'),
    bool('HoldBackRetractedSettled', { desc: 'Hold Back retracted and the PartPresentEnableDelay settle has run - the fiber may be read' }),
    bool('Initialized'),
    bool('i_LiftLowered', { usage: 'Input', desc: `Lift Is Lowered - SMC D-M9PSAPC C-slot switch ${S.liftLoweredPrx}, LOWER switch of the CDQ2WB20-25DMZ (1160-DAA-000 item 17), vb02 Table Valve Bank input ${S.liftLoweredIn} (schematic label ${S.rtlt} Escapement Lift Lowered)` }),
    bool('i_LiftRaised', { usage: 'Input', desc: `Lift Is Raised - SMC D-M9PSAPC C-slot switch, UPPER switch of the CDQ2WB20-25DMZ (1160-DAA-000 item 17: 4 switches = 2 per lift). No point on 1160-V-015 yet - UNMAPPED Input parameter (reads 0) until Hailey assigns a vb02 EX600-DXPC input (7 or 10-15 spare); LiftRaiseDelay is ORed in and stands in until then.` }),
    bool('i_PartPresent', { usage: 'Input', desc: `Part Present - Keyence FU-77TZ fiber ${S.fiberPec} on ${S.fiberAmp} at the ${S.rtlt} dead nest, vb02 Table Valve Bank input ${S.ppIn}, ON = Y-site seated; head in an angled bore of the Y-SITE DEAD NEST (1160-DAA-000 item 16)` }),
    bool('LiftLowered'),
    bool('LiftLoweredSettled', { desc: 'Lift lowered and LiftLowerSettleDelay done' }),
    timer('LiftLowerSettleDelay', 100, 'Settle after the Lift reads Lowered before the Hold Back retracts - Mark 6:36 "retract the escapement on a slight delay so that they do not get hung up on that pin coming down"; proposal 100 ms, HMI-adjustable'),
    bool('LiftRaised'),
    timer('LiftRaiseDelay', 200, 'Lift Raised Delay Timer - Raised switch exists on 1160-DAA-000 (item 17) but has no I/O point - timer stands in until i_LiftRaised is wired (22 mm travel); proposal 200 ms, HMI-adjustable'),
    bool('LocalSSONS'),
    bool('Lockout'),
    bool('ManualMode'),
    dint('NestNumIncoming', { desc: 'Nest indexing into S01 next - the part presented now is picked for it; read for the nest lockout' }),
    dint('ONS'),
    bool('PartSeated', { desc: 'Side enabled and the fiber sees the Y-site seated in the dead nest (Check Part Present, state 13)' }),
    debounce('PartPresentDebounce', 'Part Present fiber debounce (50 / 50 ms)'),
    timer('PartPresentEnableDelay', 300, 'Fiber read settle after the Hold Back retracts - timing sheet seq 25 Part Present Sensor Enabled 0.3 s after the escapement Retract; seed 300 ms, HMI-adjustable'),
    timer('PartReadyTimer', 2000, 'Part presented and holding for this long resets the three-strikes count (clears the pause while the chassis is paused)'),
    real('p_CycleTime', { usage: 'Public', desc: 'Station cycle time (s), stamped on re-entry to state 4' }),
    bool('p_PartReady', { usage: 'Public', ro: true, desc: `Y-site presented on the raised Lift - read by ${LOAD} at the gripper-close window. Set at state 22, held until state 7 (lift lowering after Parts Picked), initialization 100 or lockout 99.` }),
    bool('q_AlarmActive', { usage: 'Output' }),
    bool('q_ExtendHoldBack', { usage: 'Output', desc: `Extend Hold Back (block the parts behind the ${S.rtlt} dead nest) - vb02 Table Valve Bank slot ${S.hbSlot} A = Data[0].${S.hbExtBit} - SMC MIS8-10D 8 mm bore x 10 mm stroke single-finger escapement, meter-out AS1201F-U1032-04A both ports (1160-DAA-000 item 14), drives ESCAPEMENT BLADE 1160-DAA-016 against END STOP 1160-DAA-002` }),
    bool('q_LowerLift', { usage: 'Output', desc: `Lower Lift - vb02 Table Valve Bank slot ${S.liftSlot} B = Data[0].${S.liftLowerBit} (SY3300 closed-center: both solenoids off holds position) - SMC CDQ2WB20-25DMZ 20 mm bore x 25 mm stroke double-rod compact cylinder, 22.00 travel to the stop nut, meter-out AS1201F-M5-06A both ports (1160-DAA-000 item 13)` }),
    bool('q_PauseRequest', { usage: 'Output', desc: `Pause request to Chassis (PauseReason ${S.pauseReason}) - a starved dead nest pauses the dial, never faults` }),
    bool('q_RaiseLift', { usage: 'Output', desc: `Raise Lift (present the ${S.rtlt} Y-site to the pick) - vb02 Table Valve Bank slot ${S.liftSlot} A = Data[0].${S.liftRaiseBit} - SMC CDQ2WB20-25DMZ 20 mm bore x 25 mm stroke double-rod compact cylinder, 22.00 travel to the stop nut, meter-out AS1201F-M5-06A both ports (1160-DAA-000 item 13)` }),
    bool('q_RetractHoldBack', { usage: 'Output', desc: `Retract Hold Back (let the next ${S.rtlt} Y-site advance into the dead nest) - vb02 Table Valve Bank slot ${S.hbSlot} B = Data[0].${S.hbRetBit} - SMC MIS8-10D 8 mm bore x 10 mm stroke single-finger escapement, meter-out AS1201F-U1032-04A both ports (1160-DAA-000 item 14), drives ESCAPEMENT BLADE 1160-DAA-016 against END STOP 1160-DAA-002` }),
    bool('q_WarningActive', { usage: 'Output' }),
    ...(S.feeder ? [bool('q_YSiteBodyFeederEnable', { usage: 'Output', desc: 'Y-Site Body Feeder Enable to the Belco feeder controller (both bowls + linear track run enable) - DOUT1 5069-OB16 point by ParameterConnection (controller/ParameterConnections.xml; v0 shell Pt12), interposing relay 1229CR. Side A owns the ONE shared feeder; S01_YSiteEscapementB has no feeder rungs. Schematic label sits beside OUT CH 7, wire 12290 / 1229CR beside OUT CH 13 - confirm the channel against 1160-V-011 before download.' })] : []),
    dint('RestartState'),
    bool('SafetyOK'),
    dint('SafetyStopState'),
    bool('SideEnabled', { desc: `This side may be fed and presented this cycle - ${LOAD}.p_LoadEnabled, the incoming nest not locked out (whole fixture: Nest[].OpStatus.Lockout) and this station side not locked out (Station[StaNum].OpStatus.${loA}) - template S01_PartLoad${L} CycleStation form` }),
    bool('SS'),
    bool('SS_OK'),
    dint('StaNum'),
    dint('StaNumPre'),
    udt('StateEngine', 'State_Engine_128Max'),
    udt('StateHistory', 'SINT', { dims: 10, radix: 'Decimal' }),
    udt('Status', 'StateLogicStatus', { comments: stateComments({ 0: 'Emergency Stop', 1: 'Manual Mode', 2: 'Auto Mode Idle Not Ready', 3: 'Auto Mode Idle Ready', 4: 'Wait For Part Picked From Y-Site Load', 7: 'Lower Lift', 10: 'Retract Hold Back', 13: 'Check Part Present', 16: 'Extend Hold Back', 19: 'Raise Lift', 22: 'Signal Part Ready To Y-Site Load', 99: 'Lockout', 100: 'Initialization Lower Lift', 103: 'Initialization Extend Hold Back - Dead Nest Empty', 106: 'Initialization Extend Hold Back - Y-Site Seated', 124: 'Initialization Complete', 127: 'Faulted' }) }),
    bool('UseRestartLogic'),
  ];

  const r00 = routine('R00_Main', [
    R('JSR(R01_Inputs,0);', `Subroutine Calls

S01 Y-Site Escapement ${L} - ${side} = ${S.nestLong} (NAMES CONTRACT two-up rule: one station program per nest side, A/B identical except side members, points and text). Carried from the v0 single program S01_YSiteEscapement onto Jason's 2-UP template: this program owns ONLY its side's Hold Back, Lift and Part Present fiber; the twin owns the other side.
Sequence: 4 wait for ${LOAD}.p_PartsPicked (or nothing presented) -> 7 lower Lift -> 10 retract Hold Back -> 13 check Part Present (fiber) -> 16 extend Hold Back -> 19 raise Lift -> 22 signal p_PartReady -> 4. Initialization 100 lower Lift -> 103 extend Hold Back (dead nest empty) / 106 extend Hold Back (Y-site seated) -> 124 -> 4 or 13.
Tracking: no part record (${LOAD} owns Attempt/Success/Failure and StationPerformance for station 1); reads Nest[NestNumIncoming].OpStatus.Lockout (whole fixture - the template has no per-side nest lockout) and Station[StaNum].OpStatus.${loA}; counts its faults into Station[StaNum].PerformData.FaultCount${L}.
Jason's R02 rule: R02_StateTransitions holds transitions only - the cycle-time stamp and the ConsecFails count/reset live in R03_StateLogic.${S.feeder ? '\nSide A also owns the shared Y-Site Body Feeder: enable (DOUT1 point by ParameterConnection - controller/ParameterConnections.xml) and the three speed references written DIRECTLY to AOUT1:O (no buffer). S01_YSiteEscapementB has no feeder rungs.' : '\nThe shared Y-Site Body Feeder (enable + speeds) belongs to S01_YSiteEscapementA; this program has no feeder rungs and reads nothing about the feeder.'}`),
    R('JSR(R02_StateTransitions,0);'),
    R('JSR(R03_StateLogic,0);'),
    R('JSR(R20_Alarms,0);'),
  ]);

  const r01 = routine('R01_Inputs', [
    R(`[MOVE(1,StaNum) MOVE(16,StaNumPre) ,MOVE(${T}.Station[StaNumPre].NestNum,NestNumIncoming) ];`, `Nest & Station Numbers

1160: StaNum 1 = S01 (Y-Site Load station - the escapement feeds it). StaNumPre 16 = S16 Empty Nest, the dial position upstream of S01, so NestNumIncoming is the nest the presented part is picked for. This program writes NO part tracking (${LOAD} owns the Attempt / Success / Failure record and StationPerformance for station 1); StaNum and NestNumIncoming are kept for the OpStatus reads and the alarm text prefix only.`),
    R(`XIC(vb02_TableValveBank_IN.Data[0].${S.ppIn})OTE(i_PartPresent);`, `Mapped inputs - this side reads its field points from the table valve bank vb02_TableValveBank (SMC EX600-SEN7, 192.168.1.22, EX600-DXPC unit 0), buffered once by MapInputs into vb02_TableValveBank_IN and mapped here as XIC(<buffer>.Data[n].b) OTE(i_X) (S02 / S06 / S14 / S16 form). The i_ tags stay Input parameters. Byte 0 = the first EX600-DXPC module; confirm the byte offset against the SMC configurator / EDS.

Part Present - Keyence FU-77TZ fiber ${S.fiberPec} on ${S.fiberAmp} at the ${S.rtlt} dead nest, vb02 input ${S.ppIn}. Hailey 1160-V-015: S01-Y LOAD ${S.rtlt} PART PRESENT.`),
    R(`XIC(vb02_TableValveBank_IN.Data[0].${S.liftLoweredIn})OTE(i_LiftLowered);`, `Lift Lowered - SMC D-M9PSAPC C-slot switch ${S.liftLoweredPrx}, LOWER switch of the CDQ2WB20-25DMZ (1160-DAA-000 item 17), vb02 input ${S.liftLoweredIn}. Hailey 1160-V-015: S01-Y LOAD ${S.rtlt} ESCAPEMENT LIFT LOWERED. The Hold Back has no switch (NAMES CONTRACT: retract on delay) - vb02 input ${S.hbRetIn} (schematic ${S.hbPrx}, no sensor on 1160-DAA-000 item 14) is not read.`),
    R('AOI_Debounce(PartPresentDebounce,i_PartPresent,50,50);', 'Debounced digital sensor - the part-present fiber only (AOI_Debounce is for digital sensors, never for cylinder switches). 50 / 50 ms as in S02_YVerify.'),
    R('XIC(q_ExtendHoldBack)XIO(q_RetractHoldBack)TON(HoldBackExtendDelay,?,?)XIC(HoldBackExtendDelay.DN)OTE(HoldBackExtended);', `Hold Back derived states (PLC Std trigger legs, no switch - NAMES CONTRACT "no switch - retract on delay")

Extended - extend command on + retract command off + HoldBackExtendDelay (100 ms proposal, HMI-adjustable). Retracted - retract command on + extend command off + HoldBackRetractDelay (100 ms proposal, HMI-adjustable). If Hailey/Mark add MIS8 auto-switches later, the switch takes the place of the delay in these two rungs - no other logic change.`),
    R('XIC(q_RetractHoldBack)XIO(q_ExtendHoldBack)TON(HoldBackRetractDelay,?,?)XIC(HoldBackRetractDelay.DN)OTE(HoldBackRetracted);'),
    R('XIO(i_LiftLowered)XIC(q_RaiseLift)XIO(q_LowerLift)TON(LiftRaiseDelay,?,?)[XIC(i_LiftRaised) ,XIC(LiftRaiseDelay.DN) ]OTE(LiftRaised);', `Lift derived states

Raised - the UPPER D-M9PSAPC switch exists on 1160-DAA-000 (item 17) but has no I/O point yet: i_LiftRaised is an UNMAPPED Input parameter (reads 0) ORed with LiftRaiseDelay (200 ms proposal, HMI-adjustable) - the moment Hailey lands the point the switch is used, the delay stays as the fallback. Lowered - lower switch on + lower command on + raise command off. The lift valve is an SY3300 closed-center (vertical motion, holds on air or power loss); the lower command stays on while the lift rests down so the derived Lowered stays true.`),
    R('XIC(i_LiftLowered)XIC(q_LowerLift)XIO(q_RaiseLift)OTE(LiftLowered);'),
    R(`XIC(\\${LOAD}.p_LoadEnabled)XIO(${T}.Nest[NestNumIncoming].OpStatus.Lockout)XIO(${T}.Station[StaNum].OpStatus.${loA})OTE(SideEnabled);`, `Side enabled (two-up)

This side is fed and presented only when ${LOAD} will pick it: p_LoadEnabled (the load program's CycleStation for this side) AND the incoming nest not locked out (whole fixture: Nest[].OpStatus.Lockout - the 2-UP template has NO per-side nest lockout) AND this station side not locked out (Station[StaNum].OpStatus.${loA}) - exactly the template S01_PartLoad${L} CycleStation form. A disabled side keeps its Lift down and holds at 13 with no warning (nothing to feed). Mark 19:03 "they wanted the ability to lock one nest out"; Jason 19:19 "that's part of our standard software".`),
    R('XIC(LiftLowered)TON(LiftLowerSettleDelay,?,?)XIC(LiftLowerSettleDelay.DN)OTE(LiftLoweredSettled);', 'Lift Lowered Settled - the Lift reads Lowered and the LiftLowerSettleDelay has run. Mark 6:36: "I would bring this one down and then retract the escapement on a slight delay so that they don\'t get hung up on that pin coming down." Proposal 100 ms, HMI-adjustable.'),
    R('XIC(HoldBackRetracted)TON(PartPresentEnableDelay,?,?)XIC(PartPresentEnableDelay.DN)OTE(HoldBackRetractedSettled);', 'Hold Back Retracted Settled - the Hold Back reads Retracted and the PartPresentEnableDelay settle has run (timing sheet seq 25: Part Present Sensor Enabled 0.3 s after the escapement Retract). The fiber is not trusted until then.'),
    R('XIC(SideEnabled)XIC(PartPresentDebounce.On)OTE(PartSeated);', 'Part Seated - one bit for the Check at state 13: this side enabled and its fiber On. With the side disabled the check holds without a warning (nothing to feed - the load program is not picking this side).'),
    R('XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);', 'Logic inputs - Supervisor mirrors (chassis-family state machine form: CycleRunning follows q_CycleStartLatch as in Chassis and the 1160 state machines; the cam listeners mirror q_MachineRunning)'),
    R('XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'),
    R('XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'),
    R('XIC(\\Supervisor.q_CycleStartLatch)OTE(CycleRunning);'),
    R('XIO(\\Supervisor.q_CycleStartLatch)OTE(CycleStopping);'),
    R(`XIC(\\Supervisor.q_CycleStopped)ONS(${onsCycleStopped})XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);`),
    R('XIC(LiftLowered)XIC(HoldBackExtended)OTE(Initialized);', 'Home posture - Lift lowered, Hold Back extended (blocking). The escapement never holds a part of its own - the dead nest does - so there is one rest posture; a seated part is handled by the initialization branch 106, not by a carrying flag.'),
    R(`XIC(${T}.Station[StaNum].OpStatus.${loA})XIO(ManualMode)OTE(Lockout);`, `Lockout - this side's station lockout from Tracking (Station[StaNum].OpStatus.${loA}; the 2-UP template carries the side in the member name). Consumed by the State 99 entry rung and the State 2 exit branch${S.feeder ? ', the feeder enable' : ''} and the R20 motion alarms.`),
    R('XIC(HMI_Toggle.1)OTE(DryRun);', 'Dry run logic - HMI_Toggle.1 (SDC fixed bit map). Dry run lets the fiber check pass without a part; the Parts Picked handshake still comes from the cam.'),
    R('XIC(HMI_Toggle.2)OTE(SS);', 'Single Step Logic\n\nEmitted in R01 of every 1160 program for standardization: Single Step is HMI_Toggle.2 (SDC bit map). SS_OK gates every transition that advances a motion.'),
    R(`[XIO(SS) ,XIC(LocalSSONS) ONS(${onsSS}) ]OTE(SS_OK);`),
    R('XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);', 'Clear HMI Manual Triggers'),
    R('NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'),
  ]);

  const r02 = routine('R02_StateTransitions', [
    R('NOP();', 'STATE MAP (authoritative): 4=Wait For Part Picked From Y-Site Load | 7=Lower Lift | 10=Retract Hold Back | 13=Check Part Present | 16=Extend Hold Back | 19=Raise Lift | 22=Signal Part Ready To Y-Site Load | 99=Lockout | 100=Initialization Lower Lift | 103=Initialization Extend Hold Back (dead nest empty) | 106=Initialization Extend Hold Back (Y-site seated) | 124=Initialization Complete | 127=Fault\nStart Of State Machine\n\nJason 2026-09-17: this routine holds TRANSITIONS ONLY (MOVE n to Control.StateReg). The cycle-time stamp and every latch / counter live in R03_StateLogic. The fault (127) and safety-stop (0) rungs keep their FaultState / RestartState snapshot branch because the snapshot IS the state change (template Chassis R04_StateTransitions form).'),
    R('[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);', 'State 2: Auto mode idle not ready'),
    R('[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[22]) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);', 'State 3: Auto mode idle ready\n\nA cycle stop parks the sequence at 4 or 22 (the part stays presented on the raised Lift; the next start initializes - lift down, then 106 -> 124 -> 13 re-presents the seated part) or at 124.'),
    R('[[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[124]) ] XIO(PartPresentDebounce.On) ,XIC(Status.State[22]) ]XIC(CycleRunning)MOVE(4,Control.StateReg);', 'State 4: Start of sequence - wait for Parts Picked from Y-Site Load\n\nEntered from idle ready (3) or initialization complete (124) when the dead nest is EMPTY, and from 22 every cycle. With a Y-site seated in the dead nest, 3 and 124 re-enter at 13 instead (state 13 rung) so the Hold Back is never retracted onto a seated part - Mark 6:36 hang-up on the pin. Never blindly at 4 (Jason 2026-08-31).'),
    R(`XIC(Status.State[4])XIC(CycleRunning)[XIC(\\${LOAD}.p_PartsPicked) ,XIO(p_PartReady) ]XIC(SS_OK)MOVE(7,Control.StateReg);`, `State 7: Lower Lift - the chassis has lifted the picked part clear

Advances on ${LOAD}.p_PartsPicked (set in the load program's pick-clear window, g_S01_PartsPickedAngle 142 deg = middle hub Up 1 reached; Mark 6:06 "they can both be signaled by the chassis getting to a position"), or at once when nothing is presented (p_PartReady off - after initialization the load program clears p_PartsPicked while Part Ready is off, so there is nothing to wait for and the escapement re-arms). CycleRunning keeps a cycle stop parked here.`),
    R('XIC(Status.State[7])XIC(LiftLoweredSettled)XIC(SS_OK)MOVE(10,Control.StateReg);', 'State 10: Retract Hold Back - open the track so the next part advances into the dead nest\n\nLift lowered + LiftLowerSettleDelay (Mark\'s "slight delay"). Part Ready to the load program is released at 7 (R03).'),
    R('[XIC(Status.State[10]) XIC(HoldBackRetractedSettled) XIC(SS_OK) ,[XIC(Status.State[124]) ,XIC(Status.State[3]) XIC(Initialized) ] XIC(PartPresentDebounce.On) XIC(CycleRunning) ]MOVE(13,Control.StateReg);', 'State 13: Check Part Present - this side\'s fiber On\n\nFrom 10 when the Hold Back is retracted and the 300 ms fiber-enable settle has run. Re-entry with a Y-site already seated in the dead nest: initialization complete (124, via 106) and idle ready (3) re-enter HERE, skipping the retract at 10 - the seated part must not be uncovered again (Mark 6:36). An enabled empty side waits here under the standard Waiting For Part Present warning; a disabled side holds here silently.'),
    R('XIC(Status.State[13])[XIC(PartSeated) ,XIC(DryRun) XIC(SideEnabled) ]XIC(SS_OK)MOVE(16,Control.StateReg);', 'State 16: Extend Hold Back - close off the parts behind the seated one\n\nPass = PartSeated (R01). Not ready within 5 s = Severity 1 Waiting For Part Present + q_PauseRequest, hold here (starvation is a pause, never a fault - R20). No retry on this check in the first pass (nothing to redo but wait for Belco); if Mark wants a re-cycle for a tipped part, configure Retry back to 10, count 3, exhausted -> initialization. Dry run passes when the side is enabled.'),
    R('XIC(Status.State[16])XIC(HoldBackExtended)XIC(SS_OK)MOVE(19,Control.StateReg);', 'State 19: Raise Lift - present the part to the chassis pick-and-place (a disabled side stays down, R03)'),
    R('XIC(Status.State[19])[XIO(SideEnabled) ,XIC(LiftRaised) ]XIC(SS_OK)MOVE(22,Control.StateReg);', 'State 22: Signal Part Ready to Y-Site Load - the Lift raised (a disabled side is not required)\n\np_PartReady is set in R03 on this state and held until 7. Then straight back to 4 (next-cycle loop). Budget: 142 deg -> next gripper close at 50 deg = 268 deg = 0.89 s for states 7-22 including the 300 ms settle - the plan\'s question on the lift-down angle stands.'),
    R('XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);', `State 99: Lockout\n\nEntry half of the side's station lockout (exit is the branch on the State 2 rung).${S.feeder ? ' The feeder enable drops in 99 (R03).' : ''}`),
    R('XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);', 'State 100: Start of initialization sequence - lower Lift\n\nVertical-class device first (SY3300 closed-center, commanded down, not dropped). Part Ready to the load program is released here (R03).'),
    R('XIC(Status.State[100])XIC(LiftLoweredSettled)XIO(PartPresentDebounce.On)XIC(SS_OK)MOVE(103,Control.StateReg);', 'State 103: Initialization extend Hold Back - dead nest EMPTY\n\nFiber off after the Lift is down: home = extended / blocking (timing sheet seq 26 "Home"). Completes to 124 and re-enters at 4 to feed.'),
    R('XIC(Status.State[100])XIC(LiftLoweredSettled)XIC(PartPresentDebounce.On)XIC(SS_OK)MOVE(106,Control.StateReg);', 'State 106: Initialization extend Hold Back - Y-site SEATED\n\nFiber On (a real power-up state the sensor defines, covered per Jason\'s exhaustive-coverage law): extend the Hold Back to keep the seated part captured. Completes to 124 and re-enters at 13 (Check Part Present), never through the retract at 10.'),
    R('[XIC(Status.State[103]) ,XIC(Status.State[106]) ]XIC(HoldBackExtended)MOVE(124,Control.StateReg);', 'State 124: Initialization complete\n\nHold Back extended. Two exits, one rung each (one-rung-one-state): the State 4 rung takes 124 with the dead nest empty, the State 13 rung takes 124 with a Y-site seated.'),
    R('XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)XIC(g_MachineBasic.AlwaysOff)MOVE(RestartState,FaultState);', 'Restart Logic\n\n*Use the part status at this station to determine a course of action here.\n\n1160: the escapement holds no part of its own - the dead nest does - so restart is initialization (100 -> 103 / 106 -> 124) in every case; this rung stays AlwaysOff by design (template hook kept).'),
    R(`XIC(q_AlarmActive)[ONS(${onsFault}) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];`, 'State 127: Fault\n\nSnapshot FaultState / RestartState (LIMIT 4..99) in the same rung as the overwrite - the snapshot is part of the state change (template Chassis R04 form), not a side effect.'),
    R('XIC(ManualMode)MOVE(1,Control.StateReg);', 'State 1: Manual Mode'),
    R(`[XIO(SafetyOK) ,XIC(S:FS) ][ONS(${onsSafety}) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];`, 'State 0: Safety Stop'),
    R('State_Engine_128Max(StateEngine,Control,Status,StateHistory);', 'State Engine'),
  ]);

  const pauseTerms = S.feeder ? '[XIC(Alarm[0].Active) ,XIC(Alarm[1].Active) ,XIC(Alarm[10].Active) ]' : '[XIC(Alarm[0].Active) ,XIC(Alarm[1].Active) ]';
  const r03Rungs = [
    R(`${pauseTerms}OTE(q_PauseRequest);`, `Pause Request To Chassis (PauseReason ${S.pauseReason} in the Chassis PauseCondition rung)

A starved dead nest (Waiting For Part Present, 5 s) or three starved cycles in a row on this lane asks the Chassis for a controlled pause (40 -> 43 -> 46) - never a fault. The feeder keeps running (CycleRunning holds through a pause) so the pause clears itself when parts arrive. The state-4 wait on the load program is a warning only - a pause there would hold the pick it is waiting for.${S.feeder ? ' Y-Site Body Feeder Low Level (Alarm[10] - an AlwaysOff stub until the Belco point lands) also pauses.' : ''}`),
    R('[XIO(Status.State[1]) [XIC(Status.State[16]) ,XIC(Status.State[103]) ,XIC(Status.State[106]) ,XIC(q_ExtendHoldBack) XIO(Status.State[10]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.0) ,XIC(q_ExtendHoldBack) XIO(HMI_Momentary.1) ] ]OTE(q_ExtendHoldBack);', 'Hold Back Control\n\nOne rung per output, auto and manual in the same rung with the seal-in inside (exemplar form). Auto: extend at 16 and in initialization 103 / 106, retract at 10; each output holds until the opposite state. Manual: HMI_Momentary.0 extend / .1 retract.'),
    R('[XIO(Status.State[1]) [XIC(Status.State[10]) ,XIC(q_RetractHoldBack) XIO(Status.State[16]) XIO(Status.State[103]) XIO(Status.State[106]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.1) ,XIC(q_RetractHoldBack) XIO(HMI_Momentary.0) ] ]OTE(q_RetractHoldBack);'),
    R('[XIO(Status.State[1]) [XIC(Status.State[19]) XIC(SideEnabled) ,XIC(q_RaiseLift) XIO(Status.State[7]) XIO(Status.State[100]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.2) ,XIC(q_RaiseLift) XIO(HMI_Momentary.3) ] ]OTE(q_RaiseLift);', 'Lift Control (SY3300 closed-center, vertical)\n\nAuto raise at 19 ONLY when this side is enabled (a locked side keeps its Lift down); lower at 7 and in initialization 100. The lower command stays on through 19 for a disabled side so the closed-center valve is commanded down, not left floating. Manual: HMI_Momentary.2 raise / .3 lower.'),
    R('[XIO(Status.State[1]) [XIC(Status.State[7]) ,XIC(Status.State[100]) ,XIC(q_LowerLift) [XIO(Status.State[19]) ,XIO(SideEnabled) ] ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.3) ,XIC(q_LowerLift) XIO(HMI_Momentary.2) ] ]OTE(q_LowerLift);'),
    R('[XIC(Status.State[22]) XIC(SideEnabled) XIC(LiftRaised) ,XIC(p_PartReady) XIO(Status.State[7]) XIO(Status.State[100]) XIO(Status.State[99]) ]OTE(p_PartReady);', `SM Output Signal: Part Ready - set at 22 when this side is enabled and its Lift is raised, held until the Lift lowers after Parts Picked (7), initialization (100) or lockout (99)

Read by ${LOAD} at the gripper-close window. Keyed on the raised Lift, not a live fiber: the fiber proved the seated part at 13, and whether it still sees a LIFTED part is open (plan question) - a live AND could drop inside the close window and fail every close as FailureType 11.`),
    R(`[XIC(Status.State[4]) ONS(${onsCycleTime}) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];`, 'Cycle Time (moved here from R02 - Jason 2026-09-17: R02 holds transitions only; the template Chassis keeps its cycle time out of R04_StateTransitions too)\n\nOne cycle = one part presented and picked (state 4 re-entry to state 4 re-entry) - p_CycleTime stamped on re-entry to state 4, CycleTimer runs across the in-sequence states 4-98.'),
    R(`XIC(Alarm[0].Active)ONS(${onsConsec})ADD(ConsecFails.Count,1,ConsecFails.Count);`, 'Consecutive Failures - count a starved cycle: one per Waiting For Part Present warning on this lane (rising edge). Counter kept in R03 per the NAMES CONTRACT (ConsecFails counters live in the logic routine); the three-strikes alarm itself is R20 Alarm[1].'),
    R('[XIC(Status.State[13]) XIC(PartPresentDebounce.On) XIO(Status.TimeoutFlt) ,XIC(p_PartReady) TON(PartReadyTimer,?,?) XIC(PartReadyTimer.DN) ,XIC(Alarm[1].Active) [XIO(CycleRunning) ,XIC(\\HMI.q_CleanoutModeEnabled) ] ]MOVE(0,ConsecFails.Count);', 'Consecutive Failures - reset the count when the check passes in time (fiber On at 13 before the timeout), when the part has been presented and holding for PartReadyTimer (clears the pause while the chassis is paused - template S01_PartLoad R20 rung 1 shape, the latched Part Ready stands for the load\'s PartPresentDebounce.On), or while the warning is up and the cycle is stopped or in cleanout.'),
  ];
  if (S.feeder) {
    r03Rungs.push(
      R('[XIC(Status.State[1]) [XIC(HMI_Momentary.4) ,XIC(q_YSiteBodyFeederEnable) XIO(HMI_Momentary.5) ] ,XIO(Status.State[1]) XIC(CycleRunning) XIO(Lockout) XIO(Status.State[127]) XIO(\\HMI.q_CleanoutModeEnabled) ]OTE(q_YSiteBodyFeederEnable);', 'Y-Site Body Feeder Enable (Belco: both bowls + linear track run enable; Belco owns level and feeding) - SIDE A OWNS THE SHARED FEEDER (NAMES CONTRACT); S01_YSiteEscapementB has no feeder rungs.\n\nS10_FlexFeedConveyor vibratory-feeder rung form: manual HMI_Momentary.4 on / .5 off latch in state 1; auto on while CycleRunning and not locked out (99), not faulted (127), not cleanout. The hoppers sit outside the enclosure with covers, so the enable follows CycleRunning, not a door. CycleRunning holds through a Chassis pause, so a starved dead nest keeps feeding until the pause clears. Wired to a DOUT1 5069-OB16 point by ParameterConnection (controller/ParameterConnections.xml; v0 shell Pt12) - relay 1229CR; the schematic label sits beside OUT CH 7 and the wire 12290 / 1229CR beside OUT CH 13 - confirm the channel against 1160-V-011 before download.'),
      R('XIC(g_MachineBasic.AlwaysOn)[LIMIT(0.0,HMI_RightBowlFeederSpeed,5.0) MOVE(HMI_RightBowlFeederSpeed,AOUT1:O.Ch00.Data) ,LIMIT(0.0,HMI_LeftBowlFeederSpeed,5.0) MOVE(HMI_LeftBowlFeederSpeed,AOUT1:O.Ch01.Data) ,LIMIT(0.0,HMI_LinearTrackSpeed,5.0) MOVE(HMI_LinearTrackSpeed,AOUT1:O.Ch02.Data) ];', 'Feeder Speed References - Right Bowl / Left Bowl / Linear Track (S10_FlexFeedConveyor conveyor-speed rung form: always-on, LIMIT-clamped MOVE) written DIRECTLY to the 5069-OF8 output tag AOUT1:O (Local slot 6, voltage mode) - NAMES CONTRACT: the OF8 is written directly from the owning program, no MapOutputs buffer.\n\nHMI setpoints in volts: Ch00.Data = Y-Site Body Right Bowl (CUI SDVC34, OUT0), Ch01.Data = Left Bowl (SDVC34, OUT1), Ch02.Data = Linear Track (SDVC311, OUT2) - Right/Left name the two bowls of the ONE shared feeder, not a nest side. Clamp 0-5 V = the SDVC34 speed-input span on the Belco drawing (+5 V reference A3); the SDVC311 terminates A1-A3 - CE confirms BOTH spans and the OF8 channel range. The enable, not the speed, stops the feeder. NOTE: the 5069-OF8 is drawn but not on the ETO BOM - gap.'),
    );
  }
  r03Rungs.push(
    R(`[XIC(q_ExtendHoldBack) OTE(vb02_TableValveBank_OUT.Data[0].${S.hbExtBit}) ,XIC(q_RetractHoldBack) OTE(vb02_TableValveBank_OUT.Data[0].${S.hbRetBit}) ,XIC(q_RaiseLift) OTE(vb02_TableValveBank_OUT.Data[0].${S.liftRaiseBit}) ,XIC(q_LowerLift) OTE(vb02_TableValveBank_OUT.Data[0].${S.liftLowerBit}) ];`, `Valve Bank Output Mapping

1160: vb02 Table Valve Bank (SMC EX600-SEN7, HHB-183728, pneumatic drawing 1160-P-002). This side: slot ${S.hbSlot} = Hold Back (SY3200 double), slot ${S.liftSlot} = Lift (SY3300 closed-center). Contract bit rule: slot n -> output bits 2n-2 (A = extend / raise) and 2n-1 (B = retract / lower): slot ${S.hbSlot} -> Data[0].${S.hbExtBit} / .${S.hbRetBit}, slot ${S.liftSlot} -> Data[0].${S.liftRaiseBit} / .${S.liftLowerBit}. MapOutputs copies vb02_TableValveBank_OUT to the module. Slot order and which two slots carry the closed-center valves: confirm against the SMC configurator and 1160-P-002.`),
  );
  const r03 = routine('R03_StateLogic', r03Rungs);

  const alarmRung = (i, cond, o = {}) => {
    const sev = o.warning ? ` MOVE(1,Alarm[${i}].Severity)` : '';
    if (o.latched) return `XIO(Lockout)[${cond} ,XIC(Alarm[${i}].Active) XIO(FaultReset) ][OTE(Alarm[${i}].Active) ,ONS(${ons()}) CONCAT(g_StationList[StaNum],AlarmList[${i}],Alarm[${i}].Message) ];`;
    return `${cond}[OTE(Alarm[${i}].Active) ,ONS(${ons()})${sev} CONCAT(g_StationList[StaNum],AlarmList[${i}],Alarm[${i}].Message) ];`;
  };
  const r20Rungs = [
    R(alarmRung(0, 'XIC(Status.State[13])XIC(SideEnabled)XIO(PartPresentDebounce.On)MOVE(5000,Control.FaultTime)XIC(Status.TimeoutFlt)', { warning: true }), `Waiting For Part Present (${side} Escapement Waiting For Part Present)

Severity 1 warning - the enabled dead nest has not filled within 5 s of the fiber being enabled at state 13 (Control.FaultTime -> Status.TimeoutFlt). Starvation is a pause (q_PauseRequest, R03), never a fault: the station holds at 13 and clears itself when Belco delivers.`),
    R(alarmRung(1, 'XIC(CycleRunning)XIO(Lockout)GE(ConsecFails.Count,ConsecFails.Setpoint)', { warning: true }), `Consecutive Failures (${side} Y-Site Supply Starved Three Cycles In A Row)

Three starved cycles in a row on this lane (ConsecFails.Setpoint, default 3) = Severity 1 warning + pause request, the load-station form - notify the operator, never a fault (Mark 18:02 "if one of these didn't come on for three times in a row, they would want the system to notify"; Jason 18:31 "that's our standard method"). Count and reset are in R03 (NAMES CONTRACT: counters live in the logic routine). The gripper-side three strikes live in ${LOAD}.`),
    R(alarmRung(2, 'XIC(q_ExtendHoldBack) XIO(HoldBackExtended) TON(AlarmTimerHoldBackExtended,?,?) XIC(AlarmTimerHoldBackExtended.DN)', { latched: true }), 'Waiting For Hold Back To Extend - fault timer per motion (3 s), latched until Fault Reset'),
    R(alarmRung(3, 'XIC(q_RetractHoldBack) XIO(HoldBackRetracted) TON(AlarmTimerHoldBackRetracted,?,?) XIC(AlarmTimerHoldBackRetracted.DN)', { latched: true }), 'Waiting For Hold Back To Retract'),
    R(alarmRung(4, 'XIC(q_ExtendHoldBack) XIC(q_RetractHoldBack) TON(AlarmTimerHoldBackMisconfigured,?,?) XIC(AlarmTimerHoldBackMisconfigured.DN)', { latched: true }), 'Hold Back Outputs Misconfigured - both solenoids commanded for 50 ms'),
    R(alarmRung(5, 'XIC(q_RaiseLift) XIO(LiftRaised) TON(AlarmTimerLiftRaised,?,?) XIC(AlarmTimerLiftRaised.DN)', { latched: true }), 'Waiting For Lift To Raise'),
    R(alarmRung(6, 'XIC(q_LowerLift) XIO(LiftLowered) TON(AlarmTimerLiftLowered,?,?) XIC(AlarmTimerLiftLowered.DN)', { latched: true }), 'Waiting For Lift To Lower'),
    R(alarmRung(7, 'XIC(q_RaiseLift) XIC(q_LowerLift) TON(AlarmTimerLiftMisconfigured,?,?) XIC(AlarmTimerLiftMisconfigured.DN)', { latched: true }), 'Lift Outputs Misconfigured'),
    R(alarmRung(8, 'XIC(Status.State[4])MOVE(10000,Control.FaultTime)XIC(Status.TimeoutFlt)', { warning: true }), `Escapement Waiting For Y-Site Load To Pick The Part

Severity 1 warning - the part has been presented at state 4 for 10 s and ${LOAD} has not signalled Parts Picked (exemplar "Waiting For Pick And Place To Take Part" form). Warning only: it is NOT in q_PauseRequest, because a pause would hold the very pick this state waits for.`),
  ];
  if (S.feeder) {
    r20Rungs.push(
      R(alarmRung(9, 'XIC(g_MachineBasic.AlwaysOff)'), 'Y-Site Body Feeder Fault - STUB (AlwaysOff): no Belco -> PLC ready / fault input is drawn on Hailey\'s schematic (Q#149 Belco / Hailey). The rung exists so the CE fills the condition in one place when the point is added; never invent the input. Feeder-owner policy: both Belco feeder owners, S01_YSiteEscapementA and S05_SeptumShuttle, carry the same Feeder Fault / Feeder Low Level stubs (exemplar "*Replace AlwaysOff" form).'),
      R(alarmRung(10, 'XIC(g_MachineBasic.AlwaysOff)', { warning: true }), 'Y-Site Body Feeder Low Level - STUB (AlwaysOff), Severity 1 warning once wired (Belco owns hopper level - Dan 2026-09-15). Already in the pause rung (R03 rung 0), so the pause follows as soon as the CE replaces AlwaysOff with the input.'),
    );
  }
  r20Rungs.push(
    R('ProgramAlarmHandler(AOI_ProgramAlarmHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);'),
    R(`XIC(q_AlarmActive)ONS(${ons()})ADD(${T}.Station[StaNum].PerformData.FaultCount${L},1,${T}.Station[StaNum].PerformData.FaultCount${L});`, `Station Fault Count\n\nTemplate S01_PartLoad${L} R20 form: this side's faults land in Station[StaNum].PerformData.FaultCount${L}. Station 1 is shared with ${LOAD} - both programs' faults land in the same side counter.`),
  );
  const r20 = routine('R20_Alarms', r20Rungs);

  return program(PROG, description, tags, [r00, r01, r02, r03, r20]);
}

const ESC_A = { letter: 'A', nestWord: 'right', nestLong: 'Right nest (RT)', rtlt: 'RT', hbSlot: 1, hbExtBit: 0, hbRetBit: 1, hbRetIn: 2, hbPrx: '1651PRX', liftSlot: 3, liftRaiseBit: 4, liftLowerBit: 5, liftLoweredIn: 4, liftLoweredPrx: '1660PRX', ppIn: 0, fiberPec: '1643PEC', fiberAmp: 'FS-N41P', pauseReason: 3, feeder: true };
const ESC_B = { letter: 'B', nestWord: 'left', nestLong: 'Left nest (LT)', rtlt: 'LT', hbSlot: 2, hbExtBit: 2, hbRetBit: 3, hbRetIn: 3, hbPrx: '1655PRX', liftSlot: 4, liftRaiseBit: 6, liftLowerBit: 7, liftLoweredIn: 5, liftLoweredPrx: '1664PRX', ppIn: 1, fiberPec: '1647PEC', fiberAmp: 'FS-N42P', pauseReason: 4, feeder: false };

// ================================================================ S08_YHeatA / S10_YHeatB
function heat(S) {
  const L = S.letter, side = `Side ${L}`, PROG = S.prog, T = `\\Tracking.p_Data`, loA = `Lockout${L}`;
  const ch0 = `AIN1:I.Ch0${S.chControl}`, ch1 = `AIN1:I.Ch0${S.chSafety}`;
  const ons = (() => { let n = 0; return () => `ONS.${n++}`; })();
  const onsCycleStopped = ons(), onsSS = ons(), onsFault = ons(), onsSafety = ons(), onsCycleTime = ons();

  const alarmTexts = [
    `${side} Air Heater Over Temperature - Heater Off, Check Heater, Reset When Cool`,
    `${side} Air Temperature Sensor Fault - Check RTD Wiring`,
    `${side} Waiting For Heater Air Flow - Check Air Supply`,
    `${side} Waiting For Air Heater To Reach Temperature`,
    `${side} Heat And Air Off - Dial Did Not Index`,
    `${side} Station Locked Out`,
  ];
  const description = `${S.sta} Y Heat ${L} - hot-air heater run/stop utility STATE MACHINE (State_Engine_128Max, states 4-19, lockout 99, init 100-127) for the ${S.nestLong} (two-up: ${side}). Air Heater SSR (DOUT1 ${S.pt}, ${S.ssr}), Heater Air valve (vb01 slot ${S.slot} single), Air Temperature / Safety RTDs read DIRECTLY from AIN1:I.Ch0${S.chControl} / Ch0${S.chSafety} (no IY4 buffer), Heater Air Flow OK (unconnected Input, bypass). Publishes p_AtTemperature, q_PauseRequest (PauseReason ${S.pauseReason}). Heater control = declared extension. Job 1160.`;

  const tags = [
    bool('p_AtTemperature', { usage: 'Public', ro: true, desc: `${side} air heater at temperature (NAMES CONTRACT Public): state 13 Running with the control RTD inside the setpoint band and heater air flow OK. Consumer: ${S.consumer} form gate (pending Mark's answer) - published as a fact here.` }),
    bool('q_AlarmActive', { usage: 'Output' }),
    bool('q_PauseRequest', { usage: 'Output', desc: `Pause request to Chassis (PauseReason ${S.pauseReason}): heater warming up at state 10 (Alarm[3] Severity 1) - the dial holds so no cold ${side} part reaches the former; never a fault` }),
    bool('q_WarningActive', { usage: 'Output' }),
    real('p_CycleTime', { usage: 'Public', value: 0.0, desc: 'Run time (s) of the last heater run, stamped on re-entry to state 4 (template cycle-time rung, kept for the standard shape - in R03 per Jason\'s R02 rule)' }),
    bool('q_AirHeater', { usage: 'Output', desc: `Air Heater SSR command (time-proportioned pulse while heat is enabled) - DOUT1 5069-OB16 ${S.pt} by ParameterConnection (v0 shell point), wire ${S.wire} to SSR ${S.ssr} (G3PE-215B) coil -> 3x HEATING ELEMENT PLUS TD25015FS 240 V 200 W cartridge heaters (600 W per core) in heater core 1160-DHA-001 (1160-DHA-000 item 10), schematic ${S.htr}. Heater power via contactor 1112CON on safety output SO2 Air Heater On. Channel per 1160-V-011 tag-row convention - confirm before download.` }),
    bool('q_HeaterAir', { usage: 'Output', desc: `Heater Air supply ON - vb01 Upper Valve Bank slot ${S.slot} (SY3100 single, continuous-flow load: one ON output) -> vb01_UpperValveBank_OUT.Data[3].${S.valveBit} (bit rule 2n-2). ${S.airPrepNote} Confirm the slot against the SMC configurator and 1160-P-001.` }),
    bool('i_HeaterAirFlowOK', { usage: 'Input', desc: `Heater Air Flow OK - PFM digital flow switch on the ${side} heater air line (CTX decision 2026-06-17 air-flow interlock). NOT on schematic 1160-V-0xx or the ETO BOM: unconnected Input parameter, reads 0 until Hailey adds the point (ParameterConnection for a DIN1 point, MapInputs buffer bit for a valve-bank DXPC input). HeaterAirFlowBypass (seeded ON) stands in for it - S14 drop-sensor precedent.` }),
    real('AirTemperature', { desc: `Air Temperature (deg C) - control RTD, Omega RTD-831 3-wire, AIN1 5069-IY4 IN${S.chControl} (${S.rtdControl}) read DIRECTLY from ${ch0}.Data (NAMES CONTRACT: no CPS of the IY4). 1160-DHA-000 item 11: 2x OMEGA RTD-831-MTP-HT per core - drawing description reads THERMOCOUPLE, part number is RTD; RTD assumed (IY4 RTD channel profile) - confirm` }),
    real('AirTemperatureSafety', { desc: `Air Temperature Safety (deg C) - independent over-temperature RTD, RTD-831 3-wire, AIN1 5069-IY4 IN${S.chSafety} (${S.rtdSafety} - tag pair to confirm on 1160-V-011) read DIRECTLY from ${ch1}.Data. 1160-DHA-000 item 11: 2x OMEGA RTD-831-MTP-HT per core - drawing description reads THERMOCOUPLE, part number is RTD; RTD assumed (IY4 RTD channel profile) - confirm` }),
    real('AirTemperatureScale', { value: 1.0, desc: `RTD channel scale to deg C. 1.0 = AIN1 Ch0${S.chControl}/Ch0${S.chSafety} set in the 5069-IY4 profile to RTD input, Pt100 385 alpha 3-wire (Omega RTD-831), temperature units deg C, OpenWireEn=1, so Ch.Data is already deg C. The copied module config is NOT yet RTD (v0.4 lint #3) - the CE sets the profile before download and confirms. If the channels stay in raw/engineering mode the CE puts the deg-C-per-count scale here instead.` }),
    real('RTDRangeLow', { value: -60.0, desc: 'RTD-831 sensor range low (deg C) - a channel reading outside RTDRangeLow..RTDRangeHigh is an open/short RTD (sensor fault)' }),
    real('RTDRangeHigh', { value: 450.0, desc: 'RTD-831 sensor range high (deg C)' }),
    bool('AirTemperatureSensorOK', { desc: 'Control RTD healthy: raw channel inside the RTD-831 range and no IY4 channel Fault / OpenWire / Underrange / Overrange' }),
    bool('AirTemperatureSafetySensorOK', { desc: 'Safety RTD healthy - see AirTemperatureSensorOK' }),
    bool('OverTemperature', { desc: 'Either RTD at or above HMI_AirOverTemperatureLimit - heat permissive drops immediately; Alarm[0] FAULT after AlarmTimerOverTemperature' }),
    rangeCheck('AirTemperatureInRange', 'At temperature fact (template AOI_RangeCheck, the ChassisStandard band instrument): InPos = control RTD within +/- HMI_AirTemperatureBand of the setpoint; InPosWide = within twice the band (drop-out hysteresis 13 -> 10)'),
    real('AirTemperatureBandLow', { desc: 'Setpoint minus band (deg C) - computed each scan; below it the heater runs 100 percent, and in state 127 the cooling air stays on until both RTDs are below it' }),
    real('AirTemperatureBandWide', { desc: 'Twice HMI_AirTemperatureBand (deg C) - computed each scan, the AOI_RangeCheck wide deadband (drop-out hysteresis)' }),
    real('AirTemperatureError', { desc: 'Setpoint minus control RTD (deg C) while heat is enabled' }),
    real('HeatDutyCycle', { desc: 'Heater duty 0.0-1.0 = error / band, clamped: 1.0 at or below setpoint minus band, 0.0 at or above setpoint (proportional band = HMI_AirTemperatureBand). HMI heater output percent = this x 100.' }),
    real('HeatOnTime', { desc: 'SSR on time (ms) within the current HeatCycleTimer period = duty x period' }),
    bool('HeaterOn', { desc: 'Heat ENABLED (states 10 / 13 in auto, HMI_Momentary.2 / .3 latch in manual) through the permissives: safety, not locked out, no over-temperature, both RTDs healthy, heater air flow OK. Never the pulsed q_AirHeater - the at-temperature fact and the pause use this bit.' }),
    bool('HeatPulse', { desc: 'Time-proportioned SSR pulse: ON for HeatOnTime of each HeatCycleTimer period' }),
    timer('HeatCycleTimer', 1000, 'Time-proportioning period (ms) for the zero-cross SSR - free-running while heat is enabled. Seed 1000 ms (G3PE zero-cross SSR handles 1 s cycling); CE tunes'),
    debounce('HeaterAirFlowDebounce', 'Heater Air Flow OK debounce - the PFM flow switch is the one DIGITAL sensor on this station (RTDs are analog: no debounce). ON 50 ms / OFF 50 ms template values'),
    bool('HeaterAirFlowBypass', { value: 1, desc: 'Stands in for the missing PFM flow switch (not on the schematic or the ETO BOM) - seeded ON so the heater runs with the air commanded; CLEAR it once i_HeaterAirFlowOK is wired. S14 DropSensorBypass precedent.' }),
    bool('HeaterAirFlowOK', { desc: 'Heater air commanded AND flow proven (debounced switch, or the bypass) - the heat permissive and the at-temperature term' }),
    timer('NoIndexTimer', 60000, 'No-index timeout (ms) - runs in state 13, reset on every dial index; done = heat off then air off (Mark 24:46: the air stays on unless the system does not index within a certain amount of time). Seed 60000 ms; HMI-adjustable (PRE), password level'),
    dint('NestNumPrevious', { desc: 'Last seen \\Tracking.p_Data.Station[StaNum].NestNum - a change means the dial indexed (DialIndexed pulse)' }),
    bool('DialIndexed', { desc: 'One-scan pulse: the dial indexed (\\Chassis.ChassisStatus.NestNumShifted, or the station nest number changed) - resets NoIndexTimer and clears HeatOffNoIndex' }),
    bool('HeatOffNoIndex', { desc: 'Heat and air were switched off because the dial did not index (latched in R03 on NoIndexTimer.DN); blocks 4 -> 7 until the dial indexes again, the cycle stops, or manual mode. Alarm[4] Severity 1 notice.' }),
    real('HMI_AirTemperatureSetpoint', { value: 185.0, desc: `${side} air temperature setpoint (deg C). Seed 185.0 (CTX 2026-06-17; traceability open #16) - HMI-adjustable, retained, password level (URS IR.001 / IR.004)` }),
    real('HMI_AirTemperatureBand', { value: 10.0, desc: 'At-temperature band (+/- deg C around the setpoint) and the heater proportional band. Seed 10.0 (plan proposal, Mark to confirm) - HMI-adjustable, must stay above 0' }),
    real('HMI_AirOverTemperatureLimit', { value: 200.0, desc: 'Over-temperature high limit (deg C) on EITHER RTD -> FAULT, heat off. Seed 200.0 (setpoint + 15, under the ~204 deg C seal ceiling in CTX #18; plan proposal) - HMI-adjustable, password level' }),
    bool('HMI_HeaterEnable', { value: 1, desc: 'Heater enable toggle (HMI, retained): 1 = the heater runs with the cycle (4 -> 7), 0 = the sequence idles at state 4 with heat and air off. Seed 1. A program-scope toggle because HMI_Toggle bit map is fixed (NAMES CONTRACT).' }),
    bool('HMI_LocalManualOverride'),
    dint('HMI_Momentary', { comments: { '.0': 'Heater Air On', '.1': 'Heater Air Off', '.2': 'Air Heater On', '.3': 'Air Heater Off' } }),
    bool('HMI_MomentaryOnPrevScan'),
    dint('HMI_Toggle', { desc: `HMI toggles, SDC fixed bit map: .0 Lockout (fixed position, not read here - station lockout comes from \\Tracking.p_Data.Station[${S.staNum}].OpStatus.${loA}), .1 Dry Run (fixed position, not read here - a heater has no dry-run behaviour), .2 Single Step (R01 SS block). No other bit is assigned; the heater enable is HMI_HeaterEnable.`, comments: { '.0': 'Lockout - fixed bit map position, not read here', '.1': 'Dry Run - fixed bit map position, not read here', '.2': 'Single Step' } }),
    udt('Control', 'StateLogicControl'),
    udt('Status', 'StateLogicStatus', { comments: stateComments({ 0: 'Emergency Stop', 1: 'Manual Mode', 2: 'Auto Mode Idle Not Ready', 3: 'Auto Mode Idle Ready', 4: 'Start Of Sequence - Wait For Heater Enabled', 7: 'Heater Air On - Wait For Air Flow', 10: 'Air Heater On - Warm Up To Temperature', 13: 'Running At Temperature', 16: 'Air Heater Off', 19: 'Heater Air Off', 99: 'Lockout', 100: 'Start Of Initialization - Heat Off, Air Off (Nothing To Home)', 124: 'Initialization Complete', 127: 'Faulted' }) }),
    udt('StateEngine', 'State_Engine_128Max'),
    udt('StateHistory', 'SINT', { dims: 10, radix: 'Decimal' }),
    bool('CycleRunning'),
    bool('CycleStopping'),
    bool('CycleStopped', { desc: 'Cycle Stop Override From Supervisor' }),
    bool('FaultReset'),
    bool('Initialized'),
    bool('Lockout'),
    bool('ManualMode'),
    bool('SafetyOK'),
    bool('SS'),
    bool('SS_OK'),
    bool('LocalSSONS'),
    dint('FaultState'),
    dint('RestartState'),
    dint('SafetyStopState'),
    bool('UseRestartLogic'),
    timer('CycleTimer', 1000000),
    dint('ONS'),
    dint('StaNum'),
    udt('Alarm', 'AlarmData', { dims: 6 }),
    stringArray('AlarmList', alarmTexts, 'Alarm message suffixes; R20 builds Alarm[n].Message = CONCAT(g_StationList[StaNum], AlarmList[n]). Index order is blame order: over-temperature first.'),
    udt('AOI_ProgramAlarmHandler', 'ProgramAlarmHandler'),
    timer('AlarmTimerOverTemperature', 500, 'Alarm Timer - Air Heater Over Temperature (either RTD at or above the high limit for 500 ms - a filter against a single noisy sample; CE-adjustable)'),
    timer('AlarmTimerAirTemperatureSensor', 1000, 'Alarm Timer - Air Temperature Sensor Fault (either RTD out of range or channel status bad for 1000 ms; CE-adjustable)'),
    timer('AlarmTimerHeaterAirFlow', 5000, 'Alarm Timer - Waiting For Heater Air Flow (air commanded, flow not proven for 5000 ms; the Chassis oil-flow utility form uses 15000 - CE-adjustable)'),
  ];

  const r00 = routine('R00_Main', [
    R('JSR(R01_Inputs,0);', `Subroutine Calls

${S.sta} Y Heat ${L} - hot-air heater run/stop utility STATE MACHINE (State_Engine_128Max, states 4-19 step 3, lockout 99, initialization 100-127). Job 1160 Haemonetics Y-Site Assembly Machine, two-up; this program heats the ${S.nestLong} Y-site rim so ${S.consumer} can form it. ${S.twin} is the identical mirror (${S.twinNote}). NAMES CONTRACT v2: single-side station, exists only on its side - no A/B twin of this program, ${side} = ${S.nestLong}.
Owns: Air Heater (3 cartridges ${S.htr} through SSR ${S.ssr}, DOUT1 5069-OB16 ${S.pt} by ParameterConnection; heater power via contactor 1112CON on safety output SO2), Heater Air (vb01 Upper Valve Bank slot ${S.slot} single valve -> vb01_UpperValveBank_OUT.Data[3].${S.valveBit}), Air Temperature (control RTD, AIN1 5069-IY4 IN${S.chControl}) and Air Temperature Safety (over-temperature RTD, AIN1 IN${S.chSafety}) read DIRECTLY from the module tag AIN1:I (Jason: do NOT CPS the 5069-IY4 - no ain01 buffer), Heater Air Flow OK (PFM flow switch - NOT on the schematic: unconnected Input parameter, HeaterAirFlowBypass seeded ON).
Sequence (compact Build Plan, Mark 24:46): 4 wait for the cycle running and the heater enabled (HMI) -> 7 air on, wait for flow -> 10 heat on, warm up (Alarm[3] Severity 1 + q_PauseRequest so the dial holds) -> 13 running at temperature (p_AtTemperature ON while the control RTD is inside the band and flow is OK; NoIndexTimer runs, reset on every dial index) -> 16 heat off -> 19 air off -> 4. No-index timeout latches HeatOffNoIndex (R03) so 4 -> 7 waits for the dial to index again. Over-temperature on EITHER RTD -> FAULT (heat off; air stays on in 127 until both RTDs are below the band). RTD open/short -> FAULT. Lockout 99 = heat off, air off, p_AtTemperature off. Initialization 100 -> 124 collapsed (nothing to home).
Handshakes: p_AtTemperature (Public); q_PauseRequest -> Chassis PauseCondition (PauseReason ${S.pauseReason}); q_AlarmActive / q_WarningActive -> Alarms roll-up. Reads \\Chassis.ChassisStatus.NestNumShifted and \\Tracking.p_Data.Station[${S.staNum}].NestNum (dial indexed), Station[${S.staNum}].OpStatus.${loA}, the Supervisor mirrors. No part-tracking writes (the heater never enters the nest); faults counted into Station[${S.staNum}].PerformData.FaultCount${L}.
Jason's R02 rule (2026-09-17): R02_StateTransitions holds transitions only - the HeatOffNoIndex latch and the cycle-time stamp moved to R03_StateLogic.
DECLARED EXTENSION (template consultation is mandatory; no SDC heater / temperature-control exemplar exists in ChassisStandard, ShowRoomChassis, ShowRoomFlexFeeder, SoftwareStandardization, X_ServoPNP, X_FlexFeedConveyor or the verified work): the heater loop is the simplest standard form - time-proportioned on/off on the zero-cross SSR with a proportional band equal to the at-temperature band (100 percent below setpoint minus band, 0 percent at setpoint, 1 s period), the at-temperature fact from the template AOI_RangeCheck, and an independent GE high-limit compare on the safety RTD. Ask-for-example filed to the leads. CE tunes period and band at commissioning.`),
    R('JSR(R02_StateTransitions,0);'),
    R('JSR(R03_StateLogic,0);'),
    R('JSR(R20_Alarms,0);'),
  ]);

  const r01 = routine('R01_Inputs', [
    R(`MOVE(${S.staNum},StaNum);`, `Station Number

1160: StaNum ${S.staNum} = ${S.sta} Y Heat ${L} - g_StationList[${S.staNum}] prefixes the alarm text, \\Tracking.p_Data.Station[${S.staNum}].OpStatus.${loA} is the station lockout, Station[${S.staNum}].NestNum is the dial-indexed read. No nest lookups (NestNumCurrent / NestNumIncoming) and no CycleStation: this program writes no part record - emit no tag the program cannot use (Jason 2026-09-01).`),
    R(`XIC(g_MachineBasic.AlwaysOn)[MUL(${ch0}.Data,AirTemperatureScale,AirTemperature) ,MUL(${ch1}.Data,AirTemperatureScale,AirTemperatureSafety) ];`, `RTD Temperatures - scale to deg C in one rung. AIN1 5069-IY4 (Local slot 5) is read DIRECTLY from its input tag AIN1:I (NAMES CONTRACT / Jason: do NOT CPS the 5069-IY4 - only Ethernet generic modules go through MapInputs buffers). Ch0${S.chControl}.Data = Air Temperature (control RTD ${S.rtdControl}, ${S.sta} ${S.rtlt} Y AIR TEMP), Ch0${S.chSafety}.Data = Air Temperature Safety (over-temperature RTD, ${S.sta} ${S.rtlt} Y AIR TEMP SAFETY). Member names are the card's connection tag (AB:5000_AI4CJ:I:0: Ch00..Ch03 structures with .Data / .Fault / .OpenWire / .Underrange / .Overrange).

SCALING ASSUMPTION (confirm channel config): the IY4 channels are configured RTD 3-wire, Pt100 385 (Omega RTD-831-MTP-HT, -60..450 deg C), temperature units deg C, so Ch.Data is REAL deg C and AirTemperatureScale = 1.0. If Hailey leaves the channels in raw/percent mode the CE puts the engineering scale in AirTemperatureScale. Analog sensors: no AOI_Debounce - range compares below (Jason 2026-09-01).`),
    R(`LIMIT(RTDRangeLow,${ch0}.Data,RTDRangeHigh)XIO(${ch0}.Fault)XIO(${ch0}.OpenWire)XIO(${ch0}.Underrange)XIO(${ch0}.Overrange)OTE(AirTemperatureSensorOK);`, 'Air Temperature Sensor OK - control RTD healthy: the raw channel value inside the RTD-831 range (LIMIT -60..450 deg C: an open RTD reads far over range, a shorted RTD far under) AND no IY4 channel Fault / OpenWire / Underrange / Overrange. Consumers test this derived bit; R20 Alarm[1] faults when either RTD is not OK.'),
    R(`LIMIT(RTDRangeLow,${ch1}.Data,RTDRangeHigh)XIO(${ch1}.Fault)XIO(${ch1}.OpenWire)XIO(${ch1}.Underrange)XIO(${ch1}.Overrange)OTE(AirTemperatureSafetySensorOK);`, 'Air Temperature Safety Sensor OK - over-temperature RTD healthy, same form'),
    R('[GE(AirTemperature,HMI_AirOverTemperatureLimit) ,GE(AirTemperatureSafety,HMI_AirOverTemperatureLimit) ]OTE(OverTemperature);', 'Over Temperature - EITHER RTD at or above HMI_AirOverTemperatureLimit (CTX decision 2026-06-17: independent over-temperature high limit on a separate channel; the control RTD is compared too so a runaway is caught by whichever sensor sees it first). Drops the heat permissive (R03) the same scan; R20 Alarm[0] FAULT after AlarmTimerOverTemperature. Not safety-rated (standard IY4 channel) - a SIL-rated high limit needs a hardware limit controller in the 1112CON circuit (plan question 9).'),
    R('XIC(g_MachineBasic.AlwaysOn)[SUB(HMI_AirTemperatureSetpoint,HMI_AirTemperatureBand,AirTemperatureBandLow) ,MUL(HMI_AirTemperatureBand,2.0,AirTemperatureBandWide) ];', 'Band arithmetic - AirTemperatureBandLow = setpoint minus band (heater 100 percent below it; cooling-air hold in state 127 until both RTDs are below it); AirTemperatureBandWide = twice the band (AOI_RangeCheck wide deadband, the 13 -> 10 drop-out hysteresis so the at-temperature fact does not chatter at the band edge).'),
    R('AOI_RangeCheck(AirTemperatureInRange,HMI_AirTemperatureSetpoint,HMI_AirTemperatureBand,AirTemperature,AirTemperatureBandWide);', 'At Temperature - AOI_RangeCheck (the ChassisStandard band instrument, 4 instances on the cam axis): InPos = control RTD within +/- HMI_AirTemperatureBand of HMI_AirTemperatureSetpoint; InPosWide = within twice the band. A temperature is a fact, not a target (servo-motion.md applied to temperature).'),
    R('AOI_Debounce(HeaterAirFlowDebounce,i_HeaterAirFlowOK,50,50);', 'Sensor Debounce - AOI_Debounce on the one DIGITAL sensor (Heater Air Flow OK, PFM flow switch); the RTDs are analog and are never debounced. Template 50 / 50 ms.\n\nThe PFM flow switch is NOT on Hailey\'s schematic or the ETO BOM (CTX decision 2026-06-17 asks for it; plan question 6): i_HeaterAirFlowOK is an unconnected Input parameter that reads 0 until the point is landed - wire it by ParameterConnection (DIN1) or a MapInputs buffer bit (valve-bank DXPC input), then clear HeaterAirFlowBypass.'),
    R('XIC(q_HeaterAir)[XIC(HeaterAirFlowDebounce.On) ,XIC(HeaterAirFlowBypass) ]OTE(HeaterAirFlowOK);', 'Heater Air Flow OK - air commanded AND flow proven (debounced switch, or HeaterAirFlowBypass seeded ON while the switch does not exist - S14 DropSensorBypass precedent). The heat permissive, the state 7 -> 10 confirmation and the p_AtTemperature term.'),
    R('[XIC(\\Chassis.ChassisStatus.NestNumShifted) ,NE(\\Tracking.p_Data.Station[StaNum].NestNum,NestNumPrevious) ]OTE(DialIndexed);', `Dial Indexed - one-scan pulse: \\Chassis.ChassisStatus.NestNumShifted (Public, the Chassis per-index pulse) OR the station's nest number changed (\\Tracking.p_Data.Station[${S.staNum}].NestNum, written by Chassis R03_CalcDialStationNestNums on every index). The nest-number compare is the working reset if the Chassis does not write the Public pulse yet (open item for the Chassis builder). Never the Chassis local tag.`),
    R('XIC(DialIndexed)[RES(NoIndexTimer) ,MOVE(\\Tracking.p_Data.Station[StaNum].NestNum,NestNumPrevious) ];', 'No-Index Timer reset and nest memory - every dial index resets NoIndexTimer and stores the nest number seen.'),
    R('XIC(Status.State[13])TON(NoIndexTimer,?,?);', 'No-Index Timer - runs only in state 13 (running at temperature); the warm-up at 10 is exempt by construction so the "waiting for temperature" pause can always clear. Done = 13 -> 16 heat off -> 19 air off (Mark 24:46) and the HeatOffNoIndex latch in R03. Seed 60 s (plan question 1 - Mark\'s value is open), HMI-adjustable PRE.'),
    R('XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);', 'Logic inputs - Supervisor mirrors (chassis-family state machine form: CycleRunning follows q_CycleStartLatch as in Chassis and the 1160 state machines)'),
    R('XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'),
    R('XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'),
    R('XIC(\\Supervisor.q_CycleStartLatch)OTE(CycleRunning);'),
    R('XIO(\\Supervisor.q_CycleStartLatch)OTE(CycleStopping);'),
    R(`XIC(\\Supervisor.q_CycleStopped)ONS(${onsCycleStopped})XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);`, 'Cycle Stopped - state machine form (exemplar): one shot of the Supervisor cycle-stopped signal (Supervisor state 12 Machine In Cycle Stopped) while the sequence is not already idle.'),
    R('XIC(g_MachineBasic.AlwaysOn)OTE(Initialized);', 'Initialized - hard ON. No Homing Required For The Air Heater (a static heater and nozzle: nothing enters the nest, no posture to drive to). Initialization Logic Retained For Standardization (ShowRoomFlexFeeder P02_Conveyor / X_FlexFeedConveyor rung comment): the 100 -> 124 block is kept, collapsed, and heat and air are off in it by construction (R03 outputs are keyed to the run states only).'),
    R(`XIC(${T}.Station[StaNum].OpStatus.${loA})XIO(ManualMode)OTE(Lockout);`, `Lockout - this side's station lockout from tracking (Station[StaNum].OpStatus.${loA}; the 2-UP template carries the side in the member name. HMI_Toggle.0 is the fixed bit map position, not read here).`),
    R('XIC(HMI_Toggle.2)OTE(SS);', 'Single Step Logic\n\nStandard block emitted in R01 of every program (Jason 2026-09-10) - SS from HMI_Toggle.2 (SDC fixed bit map). SS_OK is consumed on every R02 transition that switches a device (air on, heat on, heat off, air off). Dry Run: HMI_Toggle.1 is the fixed position but a heater has no dry-run behaviour (no parts), so no DryRun tag is emitted (emit no tag the program cannot use).'),
    R(`[XIO(SS) ,XIC(LocalSSONS) ONS(${onsSS}) ]OTE(SS_OK);`),
    R('XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);', 'Clear HMI Manual Triggers'),
    R('NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);'),
  ]);

  const r02 = routine('R02_StateTransitions', [
    R('NOP();', 'STATE MAP (authoritative): 4=Wait For Heater Enabled | 7=Heater Air On, Wait For Air Flow | 10=Air Heater On, Warm Up To Temperature | 13=Running At Temperature | 16=Air Heater Off | 19=Heater Air Off | 99=Lockout | 100=Init Start (heat off, air off, nothing to home) | 124=Init Complete | 127=Fault\nStart Of State Machine\n\nJason 2026-09-17: this routine holds TRANSITIONS ONLY. The HeatOffNoIndex latch (was a parallel branch on the state 16 rung) and the cycle-time stamp live in R03_StateLogic. The fault (127) and safety-stop (0) rungs keep their FaultState / RestartState snapshot branch because the snapshot IS the state change (template Chassis R04_StateTransitions form).'),
    R('[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);', 'State 2: Auto mode idle not ready'),
    R('[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[19]) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);', 'State 3: Auto mode idle ready\n\nExemplar form (X_FlexFeedConveyor). The cycle may stop at 4 (idle), at 19 (air off complete) or at 124; the Supervisor cycle-stopped one shot returns the sequence to 3 from any run state with heat and air off. Mark\'s rule that the air stays on until the dial has not indexed for the timeout is carried IN CYCLE by NoIndexTimer (a paused or stalled dial); on a Supervisor cycle stop the template shape stops the utility through 16 -> 19 like the exemplar conveyor (state 16 rung) - if Mark wants the heater to ride through a cycle stop, remove XIO(CycleRunning) from the state 16 rung and XIC(CycleStopped) from this one (flagged, not built).'),
    R('[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[19]) XIO(q_HeaterAir) ,XIC(Status.State[124]) ]XIC(CycleRunning)MOVE(4,Control.StateReg);', 'State 4: Start of sequence - wait for the heater enabled\n\nEntered from 3 / 124 with the cycle running, and re-entered from 19 once the air is off (heat off -> air off -> 4, Mark 24:46 order). The initialization block re-enters here (124 -> 4).'),
    R('XIC(Status.State[4])XIC(HMI_HeaterEnable)XIO(HeatOffNoIndex)XIC(SS_OK)MOVE(7,Control.StateReg);', 'State 7: Heater Air on\n\nAdvance when the heater is enabled on the HMI (HMI_HeaterEnable - a disabled heater idles here with heat and air off, no alarm) and the heater was not switched off by a no-index timeout that the dial has not yet cleared (HeatOffNoIndex: after Mark\'s heat-off / air-off the heater comes back when the dial indexes again, the cycle is restarted, or manual mode is used). Air BEFORE heat: the cartridges never see power without flow.'),
    R('[XIC(Status.State[7]) XIC(q_HeaterAir) XIC(HeaterAirFlowOK) ,XIC(Status.State[13]) XIO(AirTemperatureInRange.InPosWide) ]XIC(SS_OK)MOVE(10,Control.StateReg);', 'State 10: Air Heater on - warm up\n\nFirst branch: from 7 when the air is commanded and flow is proven (HeaterAirFlowOK - the stage\'s own confirmation; R20 Alarm[2] FAULT if flow is not proven in 5000 ms). Second branch: from 13 when the control RTD leaves the WIDE band (InPosWide off = twice HMI_AirTemperatureBand) - the heater re-enters warm-up, p_AtTemperature drops and the dial is held again (Alarm[3] + q_PauseRequest) instead of forming cold parts. One rung per destination state (Jason 2026-09-01 / 14).'),
    R('XIC(Status.State[10])XIC(AirTemperatureInRange.InPos)XIC(SS_OK)MOVE(13,Control.StateReg);', 'State 13: Running at temperature - the control RTD is inside +/- HMI_AirTemperatureBand of the setpoint (AirTemperatureInRange.InPos). p_AtTemperature turns on here (R03); the warm-up warning and the pause request clear. The heater stays in 13 across many parts while the dial indexes - NoIndexTimer is reset on every index (R01).'),
    R('XIC(Status.State[13])[XIC(NoIndexTimer.DN) ,XIO(CycleRunning) ]XIC(SS_OK)MOVE(16,Control.StateReg);', 'State 16: Air Heater off\n\nFrom 13 when the dial has not indexed for NoIndexTimer (Mark 24:46: "Then we turn off the heat and turn off the air.") - HeatOffNoIndex is latched in R03 on the same timer so 4 -> 7 waits for the next dial index (R20 Alarm[4] Severity 1 notice, not a fault) - or when the cycle stops (exemplar conveyor form: state 16 Running -> 19 on XIO(CycleRunning)). Heat off FIRST, then air (state 19): the flowing air carries the residual heat out of the cartridges. Transition only (Jason 2026-09-17) - the latch branch moved to R03.'),
    R('XIC(Status.State[16])XIO(q_AirHeater)XIC(SS_OK)MOVE(19,Control.StateReg);', 'State 19: Heater Air off - the heat is confirmed off (q_AirHeater dropped: state 16 is not a heat state and HeaterOn is false). State 19 is not an air state, so the air drops next scan and the sequence returns to 4 (state 4 rung) or to 3 when the cycle is not running (state 3 rung).'),
    R('XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);', `State 99: Lockout - entry (the exit is the XIC(Status.State[99]) XIO(CycleRunning) branch on the State 2 rung). While locked out heat and air are off and p_AtTemperature is off (R03 outputs are keyed to the run states only); R20 Alarm[5] Severity 1 Station Locked Out. A locked-out heater lets ${S.consumer} form an unheated part (production-and-operator.md section 28 lockout semantics) - pair lockout of ${S.sta} with ${S.consumerSta} is Mark's open question 8.`),
    R('XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)MOVE(100,Control.StateReg);', 'State 100: Start of initialization sequence - heat off, air off, nothing to home\n\nKept and collapsed per the exemplar (ShowRoomFlexFeeder P02_Conveyor: no homing required, logic retained for standardization): Initialized is hard ON so this branch is never taken in production; if a later revision makes Initialized a real posture (for example heat off AND air off), the block runs 100 -> 124 -> 4 with both outputs off by construction and re-enters the run at 4.'),
    R('XIC(Status.State[100])MOVE(124,Control.StateReg);', 'State 124: Initialization complete - re-enters the sequence at 4 (state 4 rung) when the cycle is running, or 3 when it is not (state 3 rung).'),
    R('XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)XIC(g_MachineBasic.AlwaysOff)MOVE(RestartState,FaultState);', 'Restart Logic\n\n*Use the part status at this station to determine a course of action here. The heater holds no part and has no posture, so the template restart hook is held off (AlwaysOff stub, exemplar shape); a fault restarts through 127 -> 2 -> 3 -> 4 -> 7.'),
    R(`XIC(q_AlarmActive)[ONS(${onsFault}) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];`, 'State 127: Fault - the sequence state is captured before it is overwritten (one shot, range-gated 4-99; the snapshot is part of the state change - template Chassis R04 form). Heat is off in 127 (HeaterOn is keyed to 10 / 13 and drops on over-temperature); the AIR STAYS ON in 127 while either RTD is above setpoint minus band (R03 air rung) so the hot cartridges are cooled - it never dumps on an over-temperature.'),
    R('XIC(ManualMode)MOVE(1,Control.StateReg);', 'State 1: Manual Mode'),
    R(`[XIO(SafetyOK) ,XIC(S:FS) ][ONS(${onsSafety}) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];`, 'State 0: Safety Stop'),
    R('State_Engine_128Max(StateEngine,Control,Status,StateHistory);', 'State Engine'),
  ]);

  const r03 = routine('R03_StateLogic', [
    R('XIC(NoIndexTimer.DN)OTL(HeatOffNoIndex);', 'No-Index Shutoff Memory latched (moved here from the R02 state 16 rung - Jason 2026-09-17: R02 holds transitions only). NoIndexTimer runs only in state 13 (R01), so its Done bit IS Mark\'s condition: the dial did not index within the timeout - heat off, air off, and the heater waits at 4 until the dial indexes again. Latched before the clear rung below so a same-scan dial index wins.'),
    R('[XIC(DialIndexed) ,XIO(CycleRunning) ,XIC(Status.State[1]) ]OTU(HeatOffNoIndex);', 'No-Index Shutoff Memory cleared - the dial indexed again (DialIndexed pulse), the cycle is not running (a restart re-enables the heater at cycle start - controls judgment, plan decisionsFromDoctrine), or manual mode.'),
    R('XIC(Status.State[13])XIC(AirTemperatureInRange.InPos)XIC(HeaterAirFlowOK)OTE(p_AtTemperature);', `At Temperature - p_AtTemperature (Public, NAMES CONTRACT): state 13 Running with the control RTD inside the band and the heater air flow OK. Published as a fact; the ${S.consumer} form gate that would consume \\${PROG}.p_AtTemperature is Mark's open question 7 and is written in ${S.consumer}, not here.`),
    R('[XIO(Status.State[1]) [XIC(Status.State[7]) ,XIC(Status.State[10]) ,XIC(Status.State[13]) ,XIC(Status.State[16]) ,XIC(Status.State[127]) [GT(AirTemperature,AirTemperatureBandLow) ,GT(AirTemperatureSafety,AirTemperatureBandLow) ] ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.0) ,XIC(q_HeaterAir) XIO(HMI_Momentary.1) ] ]OTE(q_HeaterAir);', `Heater Air - continuous-flow load, one ON output (pneumatics.md: a single-solenoid air supply is just an ON output - no extend/retract pair, no delay timer). One rung, both modes, seal-in inside (Jason 2026-09-01).
Auto: ON through the run states 7 / 10 / 13 / 16 (air before heat, air after heat), and in FAULT 127 while EITHER RTD is above setpoint minus band - the air keeps cooling the cartridges after an over-temperature or any other fault and drops only when the heater has cooled below the band. Not in 4 / 19 / 99 / 100 / 124 / 0 / 2 / 3 (air off).
Manual: HMI_Momentary.0 on / .1 off latch. No over-temperature term on the air rung - over-temperature drops HEAT, never the air.
GAP: the valve has no ETO BOM line or pneumatic-drawing station yet (plan question 5) - the contract places it on vb01 slot ${S.slot} (R03 valve-bank mapping rung).`),
    R('[XIO(Status.State[1]) [XIC(Status.State[10]) ,XIC(Status.State[13]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.2) ,XIC(HeaterOn) XIO(HMI_Momentary.3) ] ]XIC(SafetyOK)XIO(Lockout)XIO(OverTemperature)XIC(AirTemperatureSensorOK)XIC(AirTemperatureSafetySensorOK)XIC(HeaterAirFlowOK)OTE(HeaterOn);', 'Air Heater Enabled (HeaterOn) - one rung, both modes, seal-in inside, through the SAME permissives in auto and manual (Jason 2026-09-01: manual never bypasses over-temperature, flow or safety): SafetyOK, not locked out, no over-temperature on either RTD, both RTDs healthy, heater air commanded and flow OK.\nAuto: heat enabled in 10 (warm up) and 13 (running); off in 16 / 19 / 99 / 127 and every idle state.\nManual: HMI_Momentary.2 heat on / .3 heat off latch (the air must be on by hand first: .0).\nThis is heat ENABLED, not the pulsed SSR output - the at-temperature fact and the HMI heater indicator use it.'),
    R('XIC(HeaterOn)[SUB(HMI_AirTemperatureSetpoint,AirTemperature,AirTemperatureError) ,DIV(AirTemperatureError,HMI_AirTemperatureBand,HeatDutyCycle) ];', 'Heater Control - DECLARED EXTENSION (see R00 rung 0): time-proportioned on/off on the zero-cross SSR with a proportional band.\nError = setpoint minus control RTD; duty = error / band (1.0 = 100 percent at or below setpoint minus band, 0.0 = off at or above the setpoint). HMI_AirTemperatureBand must stay above 0 (HMI minimum). The CE tunes band and period at commissioning; a Logix PID replaces these rungs only if commissioning shows the band cannot be held (plan question 13 to the leads).'),
    R('XIC(HeaterOn)[GT(HeatDutyCycle,1.0) MOVE(1.0,HeatDutyCycle) ,LT(HeatDutyCycle,0.0) MOVE(0.0,HeatDutyCycle) ];', 'Heater Control - clamp the duty to 0.0 .. 1.0'),
    R('XIC(HeaterOn)MUL(HeatDutyCycle,HeatCycleTimer.PRE,HeatOnTime);', 'Heater Control - SSR on time (ms) in the current period = duty x HeatCycleTimer.PRE'),
    R('XIC(HeaterOn)XIO(HeatCycleTimer.DN)TON(HeatCycleTimer,?,?);', 'Heater Control - free-running period timer (self-resetting TON, 1000 ms seed) while heat is enabled'),
    R('XIC(HeaterOn)LT(HeatCycleTimer.ACC,HeatOnTime)OTE(HeatPulse);', 'Heater Control - the SSR pulse is ON for the first HeatOnTime ms of every period'),
    R('XIC(HeaterOn)XIC(HeatPulse)OTE(q_AirHeater);', `Air Heater SSR output - heat enabled AND the time-proportioned pulse. Reaches DOUT1 5069-OB16 ${S.pt} by ParameterConnection (controller/ParameterConnections.xml, NAMES CONTRACT DOUT1 rule), wire ${S.wire} -> SSR ${S.ssr} coil -> cartridges ${S.htr}; heater power is switched by contactor 1112CON on safety output SO2 Air Heater On (SafetyProgram). Channel per the 1160-V-011 tag-row convention - confirm the point before download.`),
    R(`[XIC(Status.State[4]) ONS(${onsCycleTime}) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];`, 'Cycle Time (moved here from R02 - Jason 2026-09-17: R02 holds transitions only; the template Chassis keeps its cycle time out of R04_StateTransitions too)\n\n**Stamped on re-entry to state 4 and run across the in-sequence states (template form kept for the standard shape) - for a run/stop utility this is the run time of the last heater run, not a per-part cycle.'),
    R(`XIC(q_HeaterAir)OTE(vb01_UpperValveBank_OUT.Data[3].${S.valveBit});`, `Valve Bank Output Mapping

1160: vb01 Upper Valve Bank (SMC EX600-SEN7, HHB-183731). Contract bit rule: slot n -> output bits 2n-2 (A) and 2n-1 (B), bit i at vb01_UpperValveBank_OUT.Data[i/8].(i mod 8); a single valve uses A only.
Slot ${S.slot} Heater Air (SY3100 single): A On = Data[3].${S.valveBit}.
MapOutputs copies vb01_UpperValveBank_OUT to the module. Slot assignment: confirm against the SMC configurator and 1160-P-001 (the valve is a GAP device - plan question 5).`),
  ]);

  const A = (i, cond, o = {}) => {
    const sev = o.warning ? ` MOVE(1,Alarm[${i}].Severity)` : '';
    if (o.latched) return `${o.lockoutGate ? 'XIO(Lockout)' : ''}[${cond} ,XIC(Alarm[${i}].Active) XIO(FaultReset) ][OTE(Alarm[${i}].Active) ,ONS(${ons()}) CONCAT(g_StationList[StaNum],AlarmList[${i}],Alarm[${i}].Message) ];`;
    return `${cond}[OTE(Alarm[${i}].Active) ,ONS(${ons()})${sev} CONCAT(g_StationList[StaNum],AlarmList[${i}],Alarm[${i}].Message) ];`;
  };
  const r20 = routine('R20_Alarms', [
    R(A(0, 'XIC(OverTemperature) TON(AlarmTimerOverTemperature,?,?) XIC(AlarmTimerOverTemperature.DN)', { latched: true }), `Air Heater Over Temperature - FAULT: either RTD at or above HMI_AirOverTemperatureLimit for AlarmTimerOverTemperature (500 ms). Heat is already off (R03 permissive); the sequence goes to 127 where the air keeps cooling the cartridges until both RTDs are below setpoint minus band. Sealed [condition , XIC(Alarm[0].Active) XIO(FaultReset)] so the first cause is held to Fault Reset (alarms.md blame order). NOT gated by Lockout - a hazard alarm, unlike the waiting-for alarms. Message = g_StationList[${S.staNum}] + AlarmList[0].`),
    R(A(1, '[XIO(AirTemperatureSensorOK) ,XIO(AirTemperatureSafetySensorOK) ] TON(AlarmTimerAirTemperatureSensor,?,?) XIC(AlarmTimerAirTemperatureSensor.DN)', { latched: true }), 'Air Temperature Sensor Fault - FAULT: either RTD reads outside the RTD-831 range (open / short) or its IY4 channel reports Fault / OpenWire / Underrange / Overrange for AlarmTimerAirTemperatureSensor (1000 ms). Heat is off (R03 permissive). Not gated by Lockout (a broken sensor is reported whether or not the station runs).'),
    R(A(2, 'XIC(q_HeaterAir) XIO(HeaterAirFlowOK) TON(AlarmTimerHeaterAirFlow,?,?) XIC(AlarmTimerHeaterAirFlow.DN)', { latched: true, lockoutGate: true }), 'Waiting For Heater Air Flow - FAULT, device-conditioned (air commanded, flow not proven within AlarmTimerHeaterAirFlow 5000 ms - the Chassis R10_OilPump utility-output-on-flow-not-proven form), so it covers state 7, a flow loss at 10 / 13 and manual. Held to Fault Reset. With HeaterAirFlowBypass seeded ON (no PFM switch on the schematic) this rung cannot fire until the switch is wired and the bypass cleared.'),
    R(A(3, 'XIC(Status.State[10])', { warning: true }), `Waiting For Air Heater To Reach Temperature - Severity 1 WARNING + q_PauseRequest while the heater warms up at state 10 (standing, no timer: the dial must hold from the first scan so no cold ${side} part reaches ${S.consumer}). A starved station asks the chassis to hold rather than faulting (Jason 2026-09-09 / 14); self-clears at 13. Doctrine-derived beyond Mark's words - plan question 3.`),
    R(A(4, 'XIC(HeatOffNoIndex)', { warning: true }), 'Heat And Air Off - Dial Did Not Index - Severity 1 notice while HeatOffNoIndex is latched (Mark 24:46: heat off, air off after the no-index timeout - not a fault). Clears when the dial indexes again, the cycle restarts, or manual mode.'),
    R(A(5, `XIC(${T}.Station[StaNum].OpStatus.${loA})`, { warning: true }), 'Station Locked Out - Severity 1 warning; the sequence sits at 99 with heat and air off.'),
    R('ProgramAlarmHandler(AOI_ProgramAlarmHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);'),
    R(`XIC(q_AlarmActive)ONS(${ons()})ADD(${T}.Station[StaNum].PerformData.FaultCount${L},1,${T}.Station[StaNum].PerformData.FaultCount${L});`, `Station Fault Count - template S01_PartLoad${L} R20 form: faults land in Station[StaNum].PerformData.FaultCount${L}.`),
    R('XIC(Alarm[3].Active)OTE(q_PauseRequest);', `Pause Request To Chassis (PauseReason ${S.pauseReason} in the Chassis PauseCondition rung) - the heater is warming up (Alarm[3]); the dial holds until at temperature. A warming heater PAUSES rather than faults.`),
  ]);

  return program(PROG, description, tags, [r00, r01, r02, r03, r20]);
}

const HEAT_A = { letter: 'A', prog: 'S08_YHeatA', sta: 'S08', staNum: 8, nestLong: 'Right nest (RT)', rtlt: 'RT', chControl: 0, chSafety: 1, rtdControl: '1244RTD', rtdSafety: '1266RTD', slot: 15, valveBit: 4, pauseReason: 6, consumer: 'S09_PortCloseA', consumerSta: 'S09', pt: 'Pt04', wire: '12110', ssr: '1211CR', htr: '145HTR', twin: 'S10_YHeatB', twinNote: 'Left nest, AIN1 IN2/IN3, vb01 slot 16, DOUT1 Pt05, StaNum 10, PauseReason 7', airPrepNote: '1160-DH-000 shows only MANUAL air prep (AMG250C-03 separator, AMD250C-03-T mist filter, IR2010-02G-A precision regulator) plus the 1160-DHA AS2052FS-08A manual speed controller and no solenoid - this valve exists only on 1160-P-001 slot 15.' };
const HEAT_B = { letter: 'B', prog: 'S10_YHeatB', sta: 'S10', staNum: 10, nestLong: 'Left nest (LT)', rtlt: 'LT', chControl: 2, chSafety: 3, rtdControl: '1252RTD', rtdSafety: '1259RTD', slot: 16, valveBit: 6, pauseReason: 7, consumer: 'S11_PortCloseB', consumerSta: 'S11', pt: 'Pt05', wire: '12130', ssr: '1213CR', htr: '148HTR', twin: 'S08_YHeatA', twinNote: 'Right nest, AIN1 IN0/IN1, vb01 slot 15, DOUT1 Pt04, StaNum 8, PauseReason 6', airPrepNote: '1160-DK-000 carries NO air-prep train (heater assy + mount + T-nuts only) - feed source open; valve per 1160-P-001 slot 16.' };

// ---------------------------------------------------------------- emit
fs.mkdirSync(OUT, { recursive: true });
const files = [
  ['S01_YSiteEscapementA.xml', escapement(ESC_A)],
  ['S01_YSiteEscapementB.xml', escapement(ESC_B)],
  ['S08_YHeatA.xml', heat(HEAT_A)],
  ['S10_YHeatB.xml', heat(HEAT_B)],
];
for (const [name, xml] of files) {
  checkAscii(name, xml);
  fs.writeFileSync(path.join(OUT, name), xml, 'utf8');
  console.log(`wrote ${name} ${Buffer.byteLength(xml)} bytes, ${xml.split('\n').length - 1} lines, ${(xml.match(/<Rung /g) || []).length} rungs, ${(xml.match(/<Tag /g) || []).length} tags`);
}
