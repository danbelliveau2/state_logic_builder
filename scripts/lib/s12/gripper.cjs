'use strict';
// L2_S1n_YSiteGripper — lowers onto the Y site in its nest and closes to locate it for the robot's insertion, holds it until the robot
// has inserted the tube and backed out, then opens and lifts. The Y site is never lifted (Jason, 2026-11-13), so the gripper always
// opens before Z retracts, in the sequence and at initialization. Form: the L2S6 SoftCapGripper (L2_S04 / S03 pneumatics: one-sensor
// slide, sensorless gripper, TubeFeed device-form faults), no tracking, no held-part memory.
const H = require('../l5xBuild.cjs');
const C = require('../s4/common.cjs');
const { st, states, outputRung, waitAlarm } = H;

function build({ S01, cfg }) {
  const PROG = 'L2_S' + String(cfg.sta).padStart(2, '0') + '_YSiteGripper';
  const ROB = '\\' + cfg.robotProg + '.';
  const stateComments = { ...C.baseStates,
    4: 'Wait For Cycle Start', 7: 'Extend Z To The Y Site', 10: 'Close Y Site Gripper', 13: 'Wait For Tube Inserted', 16: 'Open Y Site Gripper', 19: 'Retract Z', 22: 'Cycle Complete',
    100: 'Initialization Open Y Site Gripper', 103: 'Initialization Retract Z' };
  const alarms = ['Waiting For Y Site Gripper Z To Extend', 'Waiting For Y Site Gripper Z To Retract', 'Waiting For Y Site Gripper To Close', 'Waiting For Y Site Gripper To Open', 'Waiting For Tube Insertion'];

  const tags = [
    ...C.engineTags(S01, cfg.prefix, stateComments, alarms, []),
    H.boolTag('i_YSiteGripperZRetracted', { usage: 'Input', desc: 'Y Site Gripper Z Retracted' }),
    H.boolTag('q_ExtendYSiteGripperZ', { usage: 'Output', desc: 'Extend Y Site Gripper Z' }), H.boolTag('q_RetractYSiteGripperZ', { usage: 'Output', desc: 'Retract Y Site Gripper Z' }),
    H.boolTag('q_CloseYSiteGripper', { usage: 'Output', desc: 'Close Y Site Gripper' }), H.boolTag('q_OpenYSiteGripper', { usage: 'Output', desc: 'Open Y Site Gripper' }),
    H.boolTag('YSiteGripperZRetracted'), H.boolTag('YSiteGripperZExtended'), H.timerTag('YSiteGripperZExtendedDelay', 300, 'Gripper Z Extend Delay'),
    H.boolTag('YSiteGripperClosed'), H.boolTag('YSiteGripperOpened'), H.timerTag('CloseYSiteGripperDelay', 100, 'Gripper Close Delay'), H.timerTag('OpenYSiteGripperDelay', 100, 'Gripper Open Delay'),
    H.alarmTimerTag('AlarmTimerYSiteGripperZExtended'), H.alarmTimerTag('AlarmTimerYSiteGripperZRetracted'),
    H.boolTag('CycleStarted'), H.boolTag('TubeInserted'), H.boolTag('RobotClearOfYSite'), H.boolTag('DryRun'),
    H.boolTag('q_ActuatorsSafe', { usage: 'Output', desc: 'Actuators Safe For Index' }), H.boolTag('p_YSitePresented', { usage: 'Public', desc: 'Y Site Located For Insert' }),
    H.dintCommentTag('HMI_Momentary', [[0, 'Extend Y Site Gripper Z'], [1, 'Retract Y Site Gripper Z'], [2, 'Close Y Site Gripper'], [3, 'Open Y Site Gripper']]),
  ];

  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Station Number', 'MOVE(' + cfg.sta + ',StaNum);'],
    ['Robot handshakes', 'XIC(' + ROB + 'p_CycleStarted)OTE(CycleStarted);'],
    ['', 'XIC(' + ROB + 'p_TubeInserted)OTE(TubeInserted);'],
    ['', 'XIC(' + ROB + 'p_RobotClearOfYSite)OTE(RobotClearOfYSite);'],
    ['Y site gripper Z slide: retracted sensor, extended by delay', 'XIC(i_YSiteGripperZRetracted)XIC(q_RetractYSiteGripperZ)XIO(q_ExtendYSiteGripperZ)OTE(YSiteGripperZRetracted);'],
    ['', 'XIO(i_YSiteGripperZRetracted)XIC(q_ExtendYSiteGripperZ)XIO(q_RetractYSiteGripperZ)TON(YSiteGripperZExtendedDelay,?,?)XIC(YSiteGripperZExtendedDelay.DN)OTE(YSiteGripperZExtended);'],
    ['Y site gripper: commanded state plus delay', 'XIC(q_CloseYSiteGripper)XIO(q_OpenYSiteGripper)TON(CloseYSiteGripperDelay,?,?)XIC(CloseYSiteGripperDelay.DN)OTE(YSiteGripperClosed);'],
    ['', 'XIC(q_OpenYSiteGripper)XIO(q_CloseYSiteGripper)TON(OpenYSiteGripperDelay,?,?)XIC(OpenYSiteGripperDelay.DN)OTE(YSiteGripperOpened);'],
    ...C.logicInputs({ sides: [cfg.ab], dial: false,
      initialized: 'XIC(YSiteGripperZRetracted)XIC(YSiteGripperOpened)',
      lockoutRungs: [['Lockout', 'XIC(' + C.OP + 'Lockout' + cfg.ab + ')XIO(ManualMode)OTE(Lockout);']],
      dryRunRungs: [['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + C.OP + 'DryRun' + cfg.ab + ') ,XIC(g_HMI_DryRun) ]OTE(DryRun);']] }),
    ...C.clearMomentary(),
  ];
  const R02 = [
    ...C.r02Head([22]),
    ['State 4: Start of sequence, wait for the robot to start on the nest', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[22]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Robot working this nest, lower the gripper onto the Y site', st(4) + 'XIC(CycleStarted)XIC(SS_OK)MOVE(7,Control.StateReg);'],
    ['State 10: Close the gripper to locate the Y site', st(7) + 'XIC(YSiteGripperZExtended)XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Y site located, wait for the robot to insert the tube', st(10) + 'XIC(YSiteGripperClosed)XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Tube inserted and the robot clear, open the gripper', st(13) + 'XIC(TubeInserted)XIC(RobotClearOfYSite)XIC(SS_OK)MOVE(16,Control.StateReg);'],
    ['State 19: Retract the gripper Z', st(16) + 'XIC(YSiteGripperOpened)XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: Cycle Complete', st(19) + 'XIC(YSiteGripperZRetracted)MOVE(22,Control.StateReg);'],
    ...C.r02Tail(),
    ['State 100:Start of initialization sequence, open the gripper so the Y site stays in its nest', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization retract the gripper Z', st(100) + 'XIC(YSiteGripperOpened)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 124: Initialization complete', st(103) + 'XIC(YSiteGripperZRetracted)MOVE(124,Control.StateReg);'],
    ...C.r02End(),
  ];
  const R03 = [
    ...C.r03Head('XIC(SafetyOK)', [cfg.ab], false),
    ['Actuators Safe For Index: gripper Z up', 'XIC(YSiteGripperZRetracted)OTE(q_ActuatorsSafe);'],
    ['Handshake to the robot: Z down and the gripper closed on the Y site', st(13) + 'XIC(YSiteGripperZExtended)XIC(YSiteGripperClosed)OTE(p_YSitePresented);'],
    ['Y Site Gripper Z Control: down onto the Y site, up once the gripper has opened', outputRung('q_ExtendYSiteGripperZ', st(7), 'XIO(Status.State[19]) XIO(Status.State[103])', 0, 1)],
    ['', outputRung('q_RetractYSiteGripperZ', states([19, 103]), 'XIO(Status.State[7])', 1, 0)],
    ['Y Site Gripper Control: closed from locating the Y site until the tube is in', outputRung('q_CloseYSiteGripper', st(10), 'XIO(Status.State[16]) XIO(Status.State[100])', 2, 3)],
    ['', outputRung('q_OpenYSiteGripper', states([16, 100]), 'XIO(Status.State[10])', 3, 2)],
  ];
  const A = 'AlarmONS.';
  const R20 = [
    [alarms[0], H.deviceAlarm(0, 'Lockout', 'q_ExtendYSiteGripperZ', 'YSiteGripperZExtended', 'AlarmTimerYSiteGripperZExtended', A + 0)],
    [alarms[1], H.deviceAlarm(1, 'Lockout', 'q_RetractYSiteGripperZ', 'YSiteGripperZRetracted', 'AlarmTimerYSiteGripperZRetracted', A + 1)],
    [alarms[2], waitAlarm(2, [10], 3000, 'XIO(YSiteGripperClosed) ', A + 2)],
    [alarms[3], waitAlarm(3, [16, 100], 3000, 'XIO(YSiteGripperOpened) ', A + 3)],
    [alarms[4], waitAlarm(4, [13], 60000, 'XIO(TubeInserted) ', A + 4)],
    ...C.r20Tail(false),
  ];
  return { PROG, xml: H.programXml(PROG, tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R20_Alarms', rungs: R20 }]) };
}
module.exports = { build };
