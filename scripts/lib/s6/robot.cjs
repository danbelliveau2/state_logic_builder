'use strict';
// L2_S0n_InsertRobot — the indexed program of a tube insert station (L2S6-L2S9): Epson LS4-C SCARA, tube nest opener, load cell.
// Form: V5.3 S08_EpsonRobotPNP (Jason's Epson form, playbook 7e) + L2_S04_SpikePNP (per-side tracking, force judge, ConsecFails) +
// L2_S04 escapement blade (one-sensor cylinder). Handshake form (Jason, 2026-11-12): trigger the robot program, wait for the robot at the
// location (InsideBox), do the PLC action, raise Proceed (UserOut[0].5), wait for Program Done. INSERT is one state with the force watch;
// InsertStop (UserOut[0].6) halts the slow move on over force. Boxes: 1 Safe For Index (1 = safe), 2 TubePick, 3 GluePos, 4 CapInsert, 5 HomePos.
// v0.13 (Jason's S06 corrections, 2026-11-13): NestNumIncoming from the station before this one; no Work memory (state 7 on CycleStationA, the
// force watch / judge / result alarms on the state alone); AtHome derived from Box 5; nest opener alarm timers 1 s; robot I/O numbers in the tag comments.
const H = require('../l5xBuild.cjs');
const C = require('../s4/common.cjs');
const { st, states, outputRung, waitAlarm, warnAlarm, sealedAlarm } = H;

const R = 'i_RobotStatus.', Q = 'q_RobotControl.';
const ECHO = R + 'UserWord[0]', DONE = R + 'UserIn[0].0';
const NEST = '\\L2_Tracking.p_Data.Nest[NestNumCurrent]';
const trk = (bit) => NEST + '.PartStatus.Station[StaNum].' + bit;
const FT = NEST + '.PartStatus.FailureType';
// operand comments on a copied UDT tag (replace or add), Studio's alphabetical order
const withComments = (tag, map) => {
  const cur = new Map([...tag.matchAll(/<Comment Operand="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/g)].map((m) => [m[1], m[2].trim()]));
  for (const [k, v] of Object.entries(map)) cur.set(k, v);
  const block = '<Comments>\n' + [...cur.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => '<Comment Operand="' + k + '">\n<![CDATA[' + v + ']]>\n</Comment>').join('\n') + '\n</Comments>';
  if (!/<Comments>[\s\S]*?<\/Comments>/.test(tag)) H.fail('withComments: no <Comments> block to replace');
  return tag.replace(/<Comments>[\s\S]*?<\/Comments>/, block);
};

// cfg: { sta, pre, ab ('A' upstream nest / 'B' downstream nest), side, prefix, capGate (station of the soft cap record or 0), gripperProg, dispenserProg }
function build({ S01, S05, S08, TRK, IDXB, cfg }) {
  const PROG = 'L2_S' + String(cfg.sta).padStart(2, '0') + '_InsertRobot';
  const GRIP = '\\' + cfg.gripperProg + '.', DISP = '\\' + cfg.dispenserProg + '.';
  const code = (n) => cfg.sta * 10 + n;
  const stateComments = { ...C.baseStates,
    4: 'Wait For Index And Part', 7: 'Trigger Pick Program', 10: 'Wait For Robot At Pick', 13: 'Open Tube Nest', 16: 'Wait For Pick Program Complete',
    19: 'Trigger Get Glue Program', 22: 'Wait For Robot At Dispenser', 25: 'Dispense', 28: 'Wait For Get Glue Program Complete', 31: 'Wait For Soft Cap Presented',
    34: 'Trigger Insert Program', 37: 'Wait For Insert Program Complete', 40: 'Cycle Complete', 43: 'Stop Robot Program',
    100: 'Initialization Turn Robot Motors On', 103: 'Initialization Start Robot Program', 106: 'Initialization Trigger Safe Home Program', 109: 'Initialization Wait For Safe Home Program', 112: 'Initialization Close Tube Nest' };
  const alarms = ['Robot Is Faulted', 'Waiting For Part In Nest', 'Invalid Program Command', 'Robot Program Did Not Start', 'Robot Handshakes Incorrect',
    'Waiting For Robot Program To Stop', 'Waiting For Safe Home Program To Start', 'Waiting For Safe Home Program To Complete',
    'Waiting For Pick Program To Start', 'Waiting For Robot At Pick', 'Waiting For Pick Program To Complete',
    'Waiting For Get Glue Program To Start', 'Waiting For Robot At Dispenser', 'Waiting For Dispenser Ready', 'Waiting For Dispense',
    'Waiting For Get Glue Program To Complete', 'Waiting For Soft Cap Presented', 'Waiting For Insert Program To Start', 'Waiting For Insert Program To Complete',
    'Waiting For Robot Motors To Turn On', 'Waiting For Tube Nest To Open', 'Waiting For Tube Nest To Close',
    'Tube Not Inserted, No Force', 'Insertion Force High, Part Rejected', 'Insert Stopped Short, Part Rejected', 'Cycle Aborted, Nest Failed', 'Consecutive Insertion Failures'];

  const tags = [
    ...C.engineTags(S01, cfg.prefix, stateComments, alarms, []),
    // robot (V5.3 S08 form)
    withComments(H.copyTag(S08, 'i_RobotStatus', 'i_RobotStatus'), { '.INSIDEBOX1': 'Robot Safe For Index (Out 543)', '.INSIDEBOX2': 'Robot At Pick Position (Out 544)', '.INSIDEBOX3': 'Robot At Place Position (Out 545)', '.INSIDEBOX4': 'Robot At Insert Position (Out 546)', '.INSIDEBOX5': 'Robot At Home Position (Out 547)' }),
    withComments(H.copyTag(S08, 'q_RobotControl', 'q_RobotControl'), { '.USEROUT[0].4': 'Machine In Manual Mode (In 596)', '.USEROUT[0].5': 'Proceed (Nest Open, Solvent Applied) (In 597)', '.USEROUT[0].6': 'Insert Stop, Over Force (In 598)' }),
    H.copyTag(S08, 'AutoStopRobotTimer', 'AutoStopRobotTimer'), H.copyTag(S08, 'AutoResetRobotDelay', 'AutoResetRobotDelay'), H.copyTag(S08, 'AlarmTimerProgramStart', 'AlarmTimerProgramStart'), H.copyTag(S08, 'AlarmTimerHandshakes', 'AlarmTimerHandshakes'),
    H.boolTag('StoppingRobot'), H.boolTag('Permissive'), H.boolTag('AtPick'), H.boolTag('AtDispenser'), H.boolTag('AtHome'), H.boolTag('AtInsert'), H.boolTag('TubeInRobotGripper'),
    H.dintCommentTag('HMI_Hold', [[0, 'Start Robot Program'], [1, 'Stop Robot Program'], [2, 'Turn Robot Motors On'], [3, 'Turn Robot Motors Off']]),
    H.dintCommentTag('HMI_Momentary', [[0, 'Trigger Pick Program'], [1, 'Trigger Get Glue Program'], [2, 'Trigger Insert Program'], [3, 'Trigger Safe Home Program'], [4, 'Proceed To Robot'], [5, 'Open Tube Nest'], [6, 'Close Tube Nest']]),
    // tube nest opener: retracted sensor, extended by delay (L2S01 inserter form)
    H.boolTag('i_TubeNestOpenerRetracted', { usage: 'Input', desc: 'Tube Nest Opener Retracted' }),
    H.boolTag('q_ExtendTubeNestOpener', { usage: 'Output', desc: 'Open Tube Nest' }), H.boolTag('q_RetractTubeNestOpener', { usage: 'Output', desc: 'Close Tube Nest' }),
    H.boolTag('TubeNestOpenerRetracted'), H.boolTag('TubeNestOpenerExtended'), H.timerTag('TubeNestOpenerExtendedDelay', 100, 'Tube Nest Open Delay'),
    H.timerTag('AlarmTimerTubeNestOpenerExtended', 1000, 'Alarm Timer'), H.timerTag('AlarmTimerTubeNestOpenerRetracted', 1000, 'Alarm Timer'),
    // load cell (L2_S04_SpikePNP form, one cell)
    H.sintTag('i_LoadCellByte0', 0, { usage: 'Input', desc: 'Load Cell Byte 0' }), H.sintTag('i_LoadCellByte1', 0, { usage: 'Input', desc: 'Load Cell Byte 1' }),
    H.dintTag('LoadCellCounts', 0, { desc: 'Load Cell Counts' }), H.realTag('Force', 0, { desc: 'Insertion Force lb' }), H.copyTag(IDXB, 'MovingAverageA', 'ForceFilter', ''),
    H.dintTag('HMI_ForceZeroCounts', 2048, { desc: 'Zero Force Counts' }), H.realTag('HMI_ForceLbPerCount', 0.0024, { desc: 'Force lb Per Count' }),
    H.realTag('HMI_EngageForce', 0.3, { desc: 'Tube Engaged Force lb' }), H.realTag('HMI_ForceMax', 4.0, { desc: 'Insertion Force Limit lb' }),
    H.boolTag('Engaged'), H.boolTag('OverForce'), H.boolTag('InsertReached'),
    // tracking (S10 / S04 form, one nest side)
    H.boolTag('SingleCycle'), H.boolTag('SingleDisableTracking'), H.dintTag('StaNumPre', 0), H.copyTag(TRK, 'ZeroPartAssyStat', 'ZeroPartAssyStat'),
    H.dintTag('NestNumCurrent', 0), H.dintTag('NestNumIncoming', 0), H.boolTag('CycleStationA'), H.boolTag('CycleStationB'), H.boolTag('DryRun'),
    H.copyTag(S05, 'SingleResetDelay', 'SingleResetDelay'), H.copyTag(S05, 'StationPerformance', 'StationPerformance'), H.copyTag(S01, 'ConsecFails', 'ConsecFails'),
    H.boolTag('q_ActuatorsSafe', { usage: 'Output', desc: 'Actuators Safe For Index' }), H.boolTag('q_StationComplete', { usage: 'Output' }), H.boolTag('q_Pause', { usage: 'Output' }),
    // handshakes
    H.boolTag('SoftCapPresented'), H.boolTag('DispenseReady'), H.boolTag('DispenseComplete'), H.timerTag('DispenseDwellDelay', 700, 'Dwell In The Dispenser'),
    H.boolTag('p_CycleStarted', { usage: 'Public', desc: 'Working This Nest' }), H.boolTag('p_RobotClearOfCap', { usage: 'Public', desc: 'Robot Clear Of Soft Cap' }),
    H.boolTag('p_TubeInserted', { usage: 'Public', desc: 'Insert Done, Place The Cap' }), H.boolTag('p_DispenseRequest', { usage: 'Public', desc: 'Tube In The Dispenser' }),
    H.boolTag('p_TubeOutOfDispenser', { usage: 'Public', desc: 'Tube Out Of Dispenser' }),
  ];

  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Nest & Station Numbers', '[MOVE(' + cfg.sta + ',StaNum) MOVE(' + cfg.pre + ',StaNumPre) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNum' + cfg.ab + ',NestNumCurrent) MOVE(\\L2_Tracking.p_Data.Station[' + (cfg.sta - 1) + '].NestNum' + cfg.ab + ',NestNumIncoming) ];'],
    ['Load cell: two EX600-AXA bytes to counts, counts to pounds, filtered', 'MUL(i_LoadCellByte1,256,LoadCellCounts)ADD(LoadCellCounts,i_LoadCellByte0,LoadCellCounts);'],
    ['', 'LT(i_LoadCellByte0,0)ADD(LoadCellCounts,256,LoadCellCounts);'],
    ['', 'CPT(Force,(LoadCellCounts-HMI_ForceZeroCounts)*HMI_ForceLbPerCount);'],
    ['', 'MovingAverage(ForceFilter,Force,10);'],
    ['Soft cap gripper and dispenser handshakes', 'XIC(' + GRIP + 'p_SoftCapPresented)OTE(SoftCapPresented);'],
    ['', 'XIC(' + DISP + 'p_DispenseReady)OTE(DispenseReady);'],
    ['', 'XIC(' + DISP + 'p_DispenseComplete)OTE(DispenseComplete);'],
    ['Robot positions from the InsideBox outputs: 2 pick, 3 dispenser, 4 insert, 5 home', 'XIC(' + R + 'InsideBox2)OTE(AtPick);'],
    ['', 'XIC(' + R + 'InsideBox3)OTE(AtDispenser);'],
    ['', 'XIC(' + R + 'InsideBox4)OTE(AtInsert);'],
    ['', 'XIC(' + R + 'InsideBox5)OTE(AtHome);'],
    ['Robot gripper closed on a tube', 'XIC(' + R + 'UserIn[0].6)OTE(TubeInRobotGripper);'],
    ['Tube nest opener: retracted sensor, extended by delay', 'XIC(i_TubeNestOpenerRetracted)XIC(q_RetractTubeNestOpener)XIO(q_ExtendTubeNestOpener)OTE(TubeNestOpenerRetracted);'],
    ['', 'XIO(i_TubeNestOpenerRetracted)XIC(q_ExtendTubeNestOpener)XIO(q_RetractTubeNestOpener)TON(TubeNestOpenerExtendedDelay,?,?)XIC(TubeNestOpenerExtendedDelay.DN)OTE(TubeNestOpenerExtended);'],
    ...C.logicInputs({
      sides: [cfg.ab], dial: true, nestSides: [{ name: '', ab: cfg.ab }],
      initialized: 'XIC(' + R + 'Running)EQ(' + ECHO + ',0)XIC(' + DONE + ')XIC(AtHome)XIC(TubeNestOpenerRetracted)',
      lockoutRungs: [['Lockout', 'XIC(' + C.OP + 'Lockout' + cfg.ab + ')XIO(ManualMode)OTE(Lockout);']],
      dryRunRungs: [['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + C.OP + 'DryRun' + cfg.ab + ') ,XIC(g_HMI_DryRun) ]OTE(DryRun);']],
    }),
  ];
  const preOk = (n) => '[XIC(' + NEST + '.PartStatus.Station[' + n + '].Success) ,XIC(' + NEST + '.PartStatus.Station[' + n + '].Lockout) ]';
  R01.push(['Cycle Station: a part in the nest with the upstream results' + (cfg.capGate ? ' and the soft cap record' : ''),
    '[XIC(' + NEST + '.PartStatus.PartLoaded) ' + preOk('StaNumPre') + (cfg.capGate ? ' ' + preOk(cfg.capGate) : '') + ' ,XIC(DryRun) ][XIO(' + trk('Attempt') + ') OTE(CycleStationA) ,OTE(CycleStationB) ];']);
  R01.push(...C.clearMomentary(), ['', 'XIO(Status.State[1])NE(HMI_Hold,0)MOVE(0,HMI_Hold);']);

  const idle = 'EQ(' + ECHO + ',0)XIC(' + DONE + ')';
  const started = (cmd) => 'EQ(' + ECHO + ',' + cmd + ')XIO(' + DONE + ')';
  const R02 = [
    ['Start Of State Machine', 'NOP();'],
    ['State 2: Auto mode idle not ready', '[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);'],
    ['State 3: Auto mode idle ready', '[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[' + states([4, 40, 124]) + ' ,' + st(43) + ' XIO(' + R + 'Running) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);'],
    ['State 4: Start of sequence, wait for the index and a part in the nest', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[40]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Nest on station with a part, trigger the pick program', st(4) + 'XIC(' + C.IDX + 'q_WaitStationsComplete)XIC(CycleStationA)XIO(TubeInRobotGripper)' + idle + 'XIC(Permissive)XIC(SS_OK)MOVE(7,Control.StateReg)XIO(SingleDisableTracking)OTL(' + trk('Attempt') + ');'],
    ['State 10: Pick program running, wait for the robot at the tube', st(7) + started(2) + 'XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Robot gripper closed on the tube, open the tube nest', st(10) + 'XIC(AtPick)XIC(TubeInRobotGripper)XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Nest open, tell the robot to proceed and wait for the pick to finish', st(13) + 'XIC(TubeNestOpenerExtended)XIC(SS_OK)MOVE(16,Control.StateReg);'],
    ['State 19: Tube lifted out, trigger the get glue program', st(16) + idle + 'XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: Get glue program running, wait for the robot at the dispenser', st(19) + started(4) + 'XIC(SS_OK)MOVE(22,Control.StateReg);'],
    ['State 25: Tube in the bushing and the dispenser ready, dispense', st(22) + 'XIC(AtDispenser)XIC(DispenseReady)XIC(SS_OK)MOVE(25,Control.StateReg);'],
    ['State 28: Solvent applied, tell the robot to proceed and wait for the get glue to finish', st(25) + 'XIC(DispenseComplete)XIC(DispenseDwellDelay.DN)XIC(SS_OK)MOVE(28,Control.StateReg);'],
    ['State 31: Tube out of the dispenser, wait for the soft cap in the funnel gripper', st(28) + idle + 'XIC(SS_OK)MOVE(31,Control.StateReg);'],
    ['State 34: Soft cap presented, trigger the insert program', st(31) + 'XIC(SoftCapPresented)XIC(SS_OK)MOVE(34,Control.StateReg);'],
    ['State 37: Insert program running, watch the force', st(34) + started(3) + 'XIC(SS_OK)MOVE(37,Control.StateReg);'],
    ['State 40: Cycle Complete, the insertion is judged', st(37) + idle + 'MOVE(40,Control.StateReg);'],
    ['State 43: Stop the robot program when the cycle stops', st(40) + 'XIO(CycleRunning)MOVE(43,Control.StateReg);'],
    ...C.r02Tail(),
    ['State 100:Start of initialization sequence, turn the robot motors on', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization start the robot program', st(100) + 'XIC(' + R + 'MotorOn)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 106: Initialization trigger the safe home program', st(103) + 'XIC(' + R + 'Running)' + idle + 'XIO(AtHome)XIC(SS_OK)MOVE(106,Control.StateReg);'],
    ['State 109: Initialization wait for the safe home program', st(106) + started(100) + 'XIC(SS_OK)MOVE(109,Control.StateReg);'],
    ['State 112: Initialization robot at home, close the tube nest', '[' + st(103) + ' XIC(' + R + 'Running) ,' + st(109) + ' ]' + idle + 'XIC(AtHome)XIC(SS_OK)MOVE(112,Control.StateReg);'],
    ['State 124: Initialization complete', st(112) + 'XIC(TubeNestOpenerRetracted)MOVE(124,Control.StateReg);'],
    ...C.r02End(),
  ];

  const F = 'ForceFilter.Average';
  const R03 = [
    ...C.r03Head('XIC(' + R + 'AutoMode)XIO(' + R + 'Error)XIO(' + R + 'EStopOn)XIO(' + R + 'SafeguardOn)', [cfg.ab], true),
    ['Permissive for every robot command', 'XIC(' + R + 'Running)XIO(' + R + 'Error)XIC(SafetyOK)OTE(Permissive);'],
    ['Actuators Safe For Index: the robot reports safe (InsideBox1) and the tube nest is closed', 'XIC(' + R + 'InsideBox1)XIC(TubeNestOpenerRetracted)OTE(q_ActuatorsSafe);'],
    ['Pause Request To Indexer', 'XIC(g_MachineBasic.AlwaysOff)OTE(q_Pause);'],
    ['A cycle left unfinished fails its nest at initialization', 'XIC(Status.State[100])ONS(ONS.8)XIO(SingleDisableTracking)XIC(' + trk('Attempt') + ')XIO(' + trk('Success') + ')XIO(' + trk('Failure') + ')XIO(' + trk('Lockout') + ')OTL(' + trk('Failure') + ')MOVE(' + code(4) + ',' + FT + ');'],
    ['Set Part Tracking If Station Is Locked Out', 'XIC(' + C.IDX + 'q_WaitStationsComplete)XIC(Status.State[99])XIC(' + NEST + '.PartStatus.PartLoaded)OTL(' + trk('Lockout') + ');'],
    ['Station Complete', 'XIC(' + C.IDX + 'q_WaitStationsComplete)[XIC(CycleStationB) [XIC(' + trk('Success') + ') ,XIC(' + trk('Failure') + ') ,XIC(' + trk('Lockout') + ') ] ,XIO(CycleStationB) ]OTE(q_StationComplete);'],
    ['Dispense dwell', st(25) + 'TON(DispenseDwellDelay,?,?);'],
    ['Force watch while inserting: engaged, over force, insert depth reached', states([34, 37]) + 'GE(' + F + ',HMI_EngageForce)OTL(Engaged);'],
    ['', states([34, 37]) + 'GT(' + F + ',HMI_ForceMax)OTL(OverForce);'],
    ['', states([34, 37]) + 'XIC(AtInsert)OTL(InsertReached);'],
    ['', st(4) + 'OTU(Engaged)OTU(OverForce)OTU(InsertReached);'],
    ['Judge the insertion once at state 40', st(40) + 'ONS(ONS.5)XIO(SingleDisableTracking)XIC(Engaged)XIO(OverForce)XIC(InsertReached)OTL(' + trk('Success') + ')MOVE(0,ConsecFails.Count);'],
    ['', st(40) + 'ONS(ONS.6)XIO(SingleDisableTracking)[XIO(Engaged) MOVE(' + code(1) + ',' + FT + ') ,XIC(Engaged) XIC(OverForce) MOVE(' + code(2) + ',' + FT + ') ,XIC(Engaged) XIO(OverForce) XIO(InsertReached) MOVE(' + code(3) + ',' + FT + ') ]OTL(' + trk('Failure') + ')ADD(ConsecFails.Count,1,ConsecFails.Count);'],
    ['Handshakes to the soft cap gripper and the dispenser', 'LIMIT(7,Control.StateReg,37)OTE(p_CycleStarted);'],
    ['', 'XIO(AtInsert)OTE(p_RobotClearOfCap);'],
    ['', '[' + st(40) + ' ,LIMIT(100,Control.StateReg,124) ]OTE(p_TubeInserted);'],
    ['', st(25) + 'OTE(p_DispenseRequest);'],
    ['', 'XIO(AtDispenser)XIO(Status.State[25])OTE(p_TubeOutOfDispenser);'],
    ['Motors On To Robot', '[XIO(Status.State[1]) XIC(Status.State[100]) ,XIC(Status.State[1]) XIC(HMI_Hold.2) ]XIO(' + R + 'MotorOn)OTE(' + Q + 'SetMotorsOn);'],
    ['Motors Off To Robot', 'XIC(Status.State[1])XIC(HMI_Hold.3)XIC(' + R + 'MotorOn)OTE(' + Q + 'SetMotorsOff);'],
    ['Start Signal To Robot', '[XIO(Status.State[1]) [XIC(Status.State[103]) ,XIC(q_StartOK) XIO(StoppingRobot) ] ,XIC(Status.State[1]) XIC(HMI_Hold.0) ]XIC(g_MachineBasic.Flash250msPD)XIO(' + R + 'Paused)OTE(' + Q + 'StartCmd);'],
    ['Robot Stop Control', '[XIO(SafetyOK) ,XIC(Status.State[1]) ,XIC(Status.State[43]) ,XIC(Status.State[127]) ]TON(AutoStopRobotTimer,?,?)[XIC(AutoStopRobotTimer.TT) OTE(' + Q + 'StopCmd) ,OTE(StoppingRobot) ];'],
    ['Robot Reset', '[XIC(SafetyOK) TON(AutoResetRobotDelay,?,?) XIC(AutoResetRobotDelay.DN) XIC(g_MachineBasic.Flash250msPD) [XIC(' + R + 'Error) ,XIC(' + R + 'EStopOn) ,XIC(' + R + 'SafeguardOn) ] ,XIC(' + R + 'Error) XIC(FaultReset) ]OTE(' + Q + 'Reset);'],
    ['Continue', 'XIO(CycleRunning)XIC(SafetyOK)XIO(' + R + 'Error)XIO(' + R + 'EStopOn)XIO(' + R + 'SafeguardOn)XIC(' + R + 'Paused)XIC(g_MachineBasic.Flash250msPD)OTE(' + Q + 'ContinueCmd);'],
    ['Manual Mode To Robot', 'XIC(Status.State[1])OTE(' + Q + 'UserOut[0].4);'],
    ['Trigger Pick Program', '[XIO(Status.State[1]) XIC(Status.State[7]) ,XIC(Status.State[1]) XIC(HMI_Momentary.0) ]XIC(Permissive)MOVE(2,' + Q + 'UserWord[0]);'],
    ['Trigger Get Glue Program', '[XIO(Status.State[1]) XIC(Status.State[19]) ,XIC(Status.State[1]) XIC(HMI_Momentary.1) ]XIC(Permissive)MOVE(4,' + Q + 'UserWord[0]);'],
    ['Trigger Insert Program', '[XIO(Status.State[1]) XIC(Status.State[34]) ,XIC(Status.State[1]) XIC(HMI_Momentary.2) ]XIC(Permissive)MOVE(3,' + Q + 'UserWord[0]);'],
    ['Trigger Safe Home Program', '[XIO(Status.State[1]) XIC(Status.State[106]) ,XIC(Status.State[1]) XIC(HMI_Momentary.3) ]XIC(Permissive)MOVE(100,' + Q + 'UserWord[0]);'],
    ['Clear Command Word', 'NE(' + ECHO + ',0)MOVE(0,' + Q + 'UserWord[0]);'],
    ['Proceed To Robot: the nest is open, the solvent is applied', '[XIO(Status.State[1]) ' + states([16, 28]) + ' ,XIC(Status.State[1]) XIC(HMI_Momentary.4) ]OTE(' + Q + 'UserOut[0].5);'],
    ['Insert Stop To Robot: over force', 'XIC(OverForce)OTE(' + Q + 'UserOut[0].6);'],
    ['Tube Nest Opener Control: open from the robot gripping the tube until it lifts the tube out', outputRung('q_ExtendTubeNestOpener', states([13, 16]), 'XIO(Status.State[19]) XIO(Status.State[112])', 5, 6)],
    ['', outputRung('q_RetractTubeNestOpener', states([19, 112]), 'XIO(Status.State[13])', 6, 5)],
    ['Station Performance', 'XIC(g_MachineBasic.AlwaysOn)StationPerformance(StationPerformance,' + trk('Attempt') + ',' + trk('Success') + ',g_PresetStationPerformLow,g_PresetStationPerformHigh,\\L2_Tracking.p_Data.Station[StaNum].PerformData.Attempts' + cfg.ab + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Successes' + cfg.ab + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Failures' + cfg.ab + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Efficiency' + cfg.ab + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.HMIColorStatus' + cfg.ab + ');'],
  ];

  const A = 'AlarmONS.';
  const failWarn = (i, n) => warnAlarm(i, st(40) + 'EQ(' + FT + ',' + code(n) + ')', A + i);
  const R20 = [
    [alarms[0], sealedAlarm(0, 'XIC(' + R + 'Error)', A + 0)],
    [alarms[1], warnAlarm(1, st(4) + 'XIC(' + C.IDX + 'q_WaitStationsComplete)MOVE(30000,Control.FaultTime)XIC(Status.TimeoutFlt)', A + 1)],
    [alarms[2], sealedAlarm(2, 'XIC(' + R + 'UserIn[0].1)', A + 2)],
    [alarms[3], sealedAlarm(3, 'XIC(Status.State[103])XIO(' + R + 'Running)TON(AlarmTimerProgramStart,?,?)XIC(AlarmTimerProgramStart.DN)', A + 3)],
    [alarms[4], sealedAlarm(4, 'XIC(Status.State[103])[NE(' + ECHO + ',0) ,XIO(' + DONE + ') ]TON(AlarmTimerHandshakes,?,?)XIC(AlarmTimerHandshakes.DN)', A + 4)],
    [alarms[5], waitAlarm(5, [43], 5000, '', A + 5)],
    [alarms[6], waitAlarm(6, [106], 1000, '', A + 6)],
    [alarms[7], waitAlarm(7, [109], 10000, '', A + 7)],
    [alarms[8], waitAlarm(8, [7], 1000, '', A + 8)],
    [alarms[9], waitAlarm(9, [10], 10000, '', A + 9)],
    [alarms[10], waitAlarm(10, [16], 10000, '', A + 10)],
    [alarms[11], waitAlarm(11, [19], 1000, '', A + 11)],
    [alarms[12], waitAlarm(12, [22], 10000, 'XIO(AtDispenser) ', A + 12)],
    [alarms[13], waitAlarm(13, [22], 10000, 'XIC(AtDispenser) XIO(DispenseReady) ', A + 13)],
    [alarms[14], waitAlarm(14, [25], 10000, '', A + 14)],
    [alarms[15], waitAlarm(15, [28], 10000, '', A + 15)],
    [alarms[16], waitAlarm(16, [31], 10000, '', A + 16)],
    [alarms[17], waitAlarm(17, [34], 1000, '', A + 17)],
    [alarms[18], waitAlarm(18, [37], 15000, '', A + 18)],
    [alarms[19], waitAlarm(19, [100], 5000, '', A + 19)],
    [alarms[20], H.deviceAlarm(20, 'Lockout', 'q_ExtendTubeNestOpener', 'TubeNestOpenerExtended', 'AlarmTimerTubeNestOpenerExtended', A + 20)],
    [alarms[21], H.deviceAlarm(21, 'Lockout', 'q_RetractTubeNestOpener', 'TubeNestOpenerRetracted', 'AlarmTimerTubeNestOpenerRetracted', A + 21)],
    [alarms[22], sealedAlarm(22, st(40) + 'XIO(DryRun)EQ(' + FT + ',' + code(1) + ')', A + 22)],
    [alarms[23], failWarn(23, 2)],
    [alarms[24], failWarn(24, 3)],
    [alarms[25], warnAlarm(25, st(100) + 'EQ(' + FT + ',' + code(4) + ')', A + 25)],
    [alarms[26], sealedAlarm(26, 'GT(ConsecFails.Count,ConsecFails.Setpoint)', A + 26)],
    ['', 'XIC(Alarm[26].Active)MOVE(0,ConsecFails.Count);'],
    ...C.r20Tail(false),
  ];
  return { PROG, xml: H.programXml(PROG, tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R20_Alarms', rungs: R20 }]) };
}
module.exports = { build };
