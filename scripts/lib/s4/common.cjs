'use strict';
// Template block shared by every 1163 L2S04 program: state-engine tags, mode tags, the R02 head / tail rungs,
// the R03 supervisor outputs and the R20 handlers (forms from L2_S01 / L2_S10 as Jason corrected them).
const H = require('../l5xBuild.cjs');
const OP = '\\L2_Tracking.p_Data.Station[StaNum].OpStatus.';
const IDX = '\\L2_S00_IndexerNoSP.';
const SUP = '\\Supervisor.';

// state-engine + alarm + mode tags; alarms: list of messages; servo: [[axis,label],...] or []
function engineTags(S01, PREFIX, stateComments, alarms, servoList) {
  const t = [
    H.copyTag(S01, 'Control', 'Control'), H.statusTag(S01, stateComments), H.copyTag(S01, 'StateEngine', 'StateEngine'), H.copyTag(S01, 'StateHistory', 'StateHistory'),
    H.alarmArrayTag('Alarm', PREFIX, alarms, alarms.length), H.stringArrayTag('AlarmList', alarms, alarms.length), H.copyTag(S01, 'ProgramFaultHandler', 'ProgramFaultHandler'),
    H.boolTag('AlarmActive'), H.boolTag('WarningActive'), H.dintTag('AlarmONS', 0),
    H.boolTag('q_AlarmActive', { usage: 'Output' }), H.boolTag('q_WarningActive', { usage: 'Output' }), H.boolTag('q_AutoMode', { usage: 'Output' }), H.boolTag('q_AutoStopped', { usage: 'Output' }), H.boolTag('q_StartOK', { usage: 'Output' }),
    H.realTag('p_CycleTime', 0, { usage: 'Public' }),
    H.boolTag('AutoIdle'), H.boolTag('CycleRunning'), H.boolTag('CycleStopped'), H.boolTag('CycleStopping'), H.copyTag(S01, 'CycleTimer', 'CycleTimer'), H.boolTag('FaultReset'), H.dintTag('FaultState', 0),
    H.boolTag('HMI_LocalManualOverride'), H.boolTag('Initialized'), H.boolTag('LocalSSONS'), H.boolTag('Lockout'), H.boolTag('ManualMode'), H.dintTag('ONS', 0), H.dintTag('RestartState', 0), H.boolTag('SafetyOK'), H.dintTag('SafetyStopState', 0),
    H.boolTag('SS'), H.boolTag('SS_OK'), H.dintTag('StaNum', 0), H.boolTag('UseRestartLogic'), H.boolTag('HMI_MomentaryOnPrevScan'),
  ];
  if (servoList.length) t.push(H.alarmArrayTag('ServoAlarm', PREFIX, servoList, servoList.length), H.stringArrayTag('ServoAlarmList', servoList, servoList.length), H.copyTag(S01, 'ServoFaultHandler', 'ServoFaultHandler'), H.boolTag('ServoAlarmActive'), H.boolTag('ServoWarningActive'));
  return t;
}
// R01 "Logic inputs" block. sides: ['A'] | ['A','B'] (which OpStatus single-step bits drive CycleRunning / SS); dial: true adds the full single-step block (nest stations)
function logicInputs({ sides, initialized, lockoutRungs, dryRunRungs, dial, nestSides }) {
  const ss = (b) => OP + 'SingleStep' + b, sc = (b) => OP + 'SingleCycle' + b;
  const r = [
    ['Logic inputs  *Replace always off bits with real conditions', 'XIC(' + SUP + 'q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);'],
    ['', 'XIC(' + SUP + 'q_AutoIdle)OTE(AutoIdle);'], ['', 'XIC(' + SUP + 'q_SafetyOK)OTE(SafetyOK);'], ['', 'XIC(' + SUP + 'q_FaultReset)OTE(FaultReset);'],
  ];
  if (dial) {
    r.push(['', '[XIC(' + SUP + 'q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ,' + sides.map((b) => 'XIC(' + ss(b) + ') ,XIC(' + sc(b) + ')').join(' ,') + ' ]OTE(CycleRunning);']);
    r.push(['', 'XIO(' + SUP + 'q_CycleStartLatch)XIO(HMI_LocalManualOverride)' + sides.map((b) => 'XIO(' + ss(b) + ')XIO(' + sc(b) + ')').join('') + 'OTE(CycleStopping);']);
  } else {
    r.push(['', '[XIC(' + SUP + 'q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ,' + sides.map((b) => 'XIC(' + ss(b) + ')').join(' ,') + ' ]OTE(CycleRunning);']);
    r.push(['', 'XIO(' + SUP + 'q_CycleStartLatch)XIO(HMI_LocalManualOverride)' + sides.map((b) => 'XIO(' + ss(b) + ')').join('') + 'OTE(CycleStopping);']);
  }
  r.push(['', 'XIC(' + SUP + 'q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);']);
  r.push(['', initialized + 'OTE(Initialized);']);
  r.push(...lockoutRungs, ...dryRunRungs);
  if (dial) {
    const trig = (b) => OP + 'SingleTrigger' + b;
    r.push(['Single Step Logic', '[XIC(AutoIdle) ,XIC(HMI_LocalManualOverride) ]' + H.legs(sides.flatMap((b) => ['XIC(' + ss(b) + ')', 'XIC(' + sc(b) + ')'])) + 'OTE(SS);']);
    r.push(['', 'XIC(SS)' + H.legs(sides.map((b) => 'XIC(' + OP + 'SingleDisableTracking' + b + ')')) + 'OTE(SingleDisableTracking);']);
    r.push(['', H.legs(sides.map((b) => 'XIC(' + ss(b) + ')')) + 'ONS(ONS.12)' + sides.map((b) => 'OTU(' + sc(b) + ')').join('') + ';']);
    r.push(['', H.legs(sides.map((b) => 'XIC(' + sc(b) + ')')) + 'ONS(ONS.13)' + sides.map((b) => 'OTU(' + ss(b) + ')').join('') + ';']);
    r.push(['', '[XIC(AutoIdle) ,XIC(HMI_LocalManualOverride) ]' + H.legs(sides.map((b) => 'XIC(' + sc(b) + ') XIC(' + trig(b) + ')')) + 'ONS(ONS.14)OTL(SingleCycle);']);
    r.push(['', 'XIC(SingleCycle)[XIO(AutoIdle) XIO(HMI_LocalManualOverride) ,' + sides.map((b) => 'XIO(' + sc(b) + ')').join(' ') + ' ,XIC(q_AlarmActive) ,XIC(Status.State[4]) ONS(ONS.15) ]OTU(SingleCycle);']);
    r.push(['', '[XIO(SS) ,[XIC(AutoIdle) ,XIC(HMI_LocalManualOverride) ] XIC(' + IDX + 'p_OnStation) [[XIC(LocalSSONS) ,' + sides.map((b) => 'XIC(' + trig(b) + ')').join(' ,') + ' ] ONS(ONS.1) ,XIC(SingleCycle) ] ]OTE(SS_OK);']);
    for (const s of nestSides) r.push(['', 'XIC(SS)XIC(' + OP + 'SingleClearTracking' + s.ab + ')TON(SingleResetDelay' + s.name + ',?,?)XIC(SingleResetDelay' + s.name + '.DN)COP(ZeroPartAssyStat,\\L2_Tracking.p_Data.Nest[NestNumCurrent' + s.name + '].PartStatus,1);']);
  } else {
    r.push(['Single Step Logic', H.legs(sides.map((b) => 'XIC(' + ss(b) + ')')) + 'OTE(SS);']);
    r.push(['', '[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);']);
  }
  return r;
}
const clearMomentary = () => [['Clear HMI Manual Triggers', 'XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);'], ['', 'NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);']];

// R02 head: states 2 and 3. holding: states that leave to 3 when the cycle stops (besides 4 / 124)
const r02Head = (holding) => [
  ['Start Of State Machine', 'NOP();'],
  ['State 2: Auto mode idle not ready', '[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);'],
  ['State 3: Auto mode idle ready', '[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,' + H.states([4, ...holding, 124]) + ' XIO(CycleRunning) ]MOVE(3,Control.StateReg);'],
];
// R02 tail: lockout, restart, fault, manual, safety, engine, cycle time
const r02Tail = () => [
  ['State 99: Lockout', 'XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);'],
];
const r02End = () => [
  ['Restart Logic  *Use the part status at this station to determine a course of action here.  For instance, no attempt made, no part present, no success or failure status at this station indicates initialization is in order. If an attempt was made with no success or failure, restart at last state may be in order. Also, you do not always need to go into the state you left. Some cases require you to go into the prior state to restart a particular portion of the sequence.', 'XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)XIC(g_MachineBasic.AlwaysOff)MOVE(RestartState,FaultState);'],
  ['State 127: Fault', 'XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];'],
  ['State 1: Manual Mode', 'XIC(ManualMode)MOVE(1,Control.StateReg);'],
  ['State 0: Safety Stop', '[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];'],
  ['', 'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'],
  ['Cycle Time  **Limit Instruction Low & High Limits Populated WIth Range Of States In Which Station Is Running (Example, PNP Is Picking & Placing A Part) **Cycle Complete State Shown As Example', '[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];'],
];
// R03 head: supervisor outputs. startOk: condition fragment before the single-step XIOs
const r03Head = (startOk, sides, dial) => [
  ['Output Status to Supervisor', startOk + sides.map((b) => 'XIO(' + OP + 'SingleStep' + b + ')' + (dial ? 'XIO(' + OP + 'SingleCycle' + b + ')' : '')).join('') + 'OTE(q_StartOK);'],
  ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ]XIO(CycleRunning)OTE(q_AutoMode);'],
  ['', '[XIC(Status.State[2]) ,XIC(Status.State[3]) ,XIC(Status.State[127]) ]XIO(CycleRunning)OTE(q_AutoStopped);'],
];
const r20Tail = (servo) => servo ? [
  ['Servo Alarm Handler', 'ProgramAlarmHandler(ServoFaultHandler,\\Alarms.p_ProgramID,ServoAlarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,ServoAlarmActive,ServoWarningActive);'],
  ['Station Alarm Handler', 'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,AlarmActive,WarningActive);'],
  ['Alarm/Warning Active Outputs', '[XIC(ServoAlarmActive) ,XIC(AlarmActive) ]OTE(q_AlarmActive);'],
  ['', '[XIC(ServoWarningActive) ,XIC(WarningActive) ]OTE(q_WarningActive);'],
] : [
  ['Station Alarm Handler', 'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,AlarmActive,WarningActive);'],
  ['Alarm/Warning Active Outputs', 'XIC(AlarmActive)OTE(q_AlarmActive);'],
  ['', 'XIC(WarningActive)OTE(q_WarningActive);'],
];
const baseStates = { 0: 'Safety Stop', 1: 'Manual Mode', 2: 'Auto Mode Idle Not Ready', 3: 'Auto Mode Idle Ready', 99: 'Lockout', 124: 'Initialization Complete', 127: 'Fault' };
module.exports = { OP, IDX, SUP, engineTags, logicInputs, clearMomentary, r02Head, r02Tail, r02End, r03Head, r20Tail, baseStates };
