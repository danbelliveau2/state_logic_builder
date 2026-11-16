'use strict';
// L2_S0n_SoftCapGripper — lifts the soft cap out of its nest as the funnel for the robot's insertion, then places cap and tube back.
// Runs in parallel with the robot (Jason, 2026-11-12). Form: L2_S04 escapement / PNP pneumatics (one-sensor cylinders, sensorless gripper,
// TubeFeed device-form faults), no tracking (reads Station[n].OpStatus of its nest side), HoldingCap memory survives every stop and
// initialization never opens the gripper while it holds a cap.
// v0.16 (Jason, 2026-11-16): p_TubeInserted is a one-scan handshake, so "tube inserted" and "robot clear" are two states, never one rung.
const H = require('../l5xBuild.cjs');
const C = require('../s4/common.cjs');
const { st, states, outputRung, waitAlarm } = H;

function build({ S01, cfg }) {
  const PROG = 'L2_S' + String(cfg.sta).padStart(2, '0') + '_SoftCapGripper';
  const ROB = '\\' + cfg.robotProg + '.';
  const stateComments = { ...C.baseStates,
    4: 'Wait For Cycle Start', 7: 'Extend Z To The Soft Cap', 10: 'Close Soft Cap Gripper', 13: 'Open Soft Cap Nest', 16: 'Retract Z With The Soft Cap',
    19: 'Wait For Tube Inserted', 22: 'Wait For Robot Clear Of Soft Cap', 25: 'Extend Z To Place', 28: 'Close Soft Cap Nest', 31: 'Open Soft Cap Gripper', 34: 'Retract Z', 37: 'Cycle Complete',
    100: 'Initialization Retract Z', 103: 'Initialization Close Soft Cap Nest', 106: 'Initialization Open Soft Cap Gripper' };
  const alarms = ['Waiting For Soft Cap Gripper Z To Extend', 'Waiting For Soft Cap Gripper Z To Retract', 'Waiting For Soft Cap Gripper To Close', 'Waiting For Soft Cap Gripper To Open',
    'Waiting For Soft Cap Nest To Open', 'Waiting For Soft Cap Nest To Close', 'Waiting For Tube Insertion', 'Waiting For Robot Clear Of Soft Cap'];

  const tags = [
    ...C.engineTags(S01, cfg.prefix, stateComments, alarms, []),
    H.boolTag('i_SoftCapNestOpenerRetracted', { usage: 'Input', desc: 'Soft Cap Nest Opener Retracted' }), H.boolTag('i_SoftCapGripperZRetracted', { usage: 'Input', desc: 'Soft Cap Gripper Z Retracted' }),
    H.boolTag('q_ExtendSoftCapNestOpener', { usage: 'Output', desc: 'Open Soft Cap Nest' }), H.boolTag('q_RetractSoftCapNestOpener', { usage: 'Output', desc: 'Close Soft Cap Nest' }),
    H.boolTag('q_ExtendSoftCapGripperZ', { usage: 'Output', desc: 'Extend Soft Cap Gripper Z' }), H.boolTag('q_RetractSoftCapGripperZ', { usage: 'Output', desc: 'Retract Soft Cap Gripper Z' }),
    H.boolTag('q_CloseSoftCapGripper', { usage: 'Output', desc: 'Close Soft Cap Gripper' }), H.boolTag('q_OpenSoftCapGripper', { usage: 'Output', desc: 'Open Soft Cap Gripper' }),
    H.boolTag('SoftCapNestOpenerRetracted'), H.boolTag('SoftCapNestOpenerExtended'), H.timerTag('SoftCapNestOpenerExtendedDelay', 100, 'Soft Cap Nest Open Delay'),
    H.boolTag('SoftCapGripperZRetracted'), H.boolTag('SoftCapGripperZExtended'), H.timerTag('SoftCapGripperZExtendedDelay', 300, 'Gripper Z Extend Delay'),
    H.boolTag('SoftCapGripperClosed'), H.boolTag('SoftCapGripperOpened'), H.timerTag('CloseSoftCapGripperDelay', 100, 'Gripper Close Delay'), H.timerTag('OpenSoftCapGripperDelay', 100, 'Gripper Open Delay'),
    H.alarmTimerTag('AlarmTimerSoftCapNestOpenerExtended'), H.alarmTimerTag('AlarmTimerSoftCapNestOpenerRetracted'), H.alarmTimerTag('AlarmTimerSoftCapGripperZExtended'), H.alarmTimerTag('AlarmTimerSoftCapGripperZRetracted'),
    H.boolTag('HoldingCap'), H.boolTag('CycleStarted'), H.boolTag('TubeInserted'), H.boolTag('RobotClearOfCap'), H.boolTag('DryRun'),
    H.boolTag('q_ActuatorsSafe', { usage: 'Output', desc: 'Actuators Safe For Index' }), H.boolTag('p_SoftCapPresented', { usage: 'Public', desc: 'Soft Cap Held For Insert' }),
    H.dintCommentTag('HMI_Momentary', [[0, 'Extend Soft Cap Gripper Z'], [1, 'Retract Soft Cap Gripper Z'], [2, 'Close Soft Cap Gripper'], [3, 'Open Soft Cap Gripper'], [4, 'Open Soft Cap Nest'], [5, 'Close Soft Cap Nest']]),
  ];

  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Station Number', 'MOVE(' + cfg.sta + ',StaNum);'],
    ['Robot handshakes', 'XIC(' + ROB + 'p_CycleStarted)OTE(CycleStarted);'],
    ['', 'XIC(' + ROB + 'p_TubeInserted)OTE(TubeInserted);'],
    ['', 'XIC(' + ROB + 'p_RobotClearOfCap)OTE(RobotClearOfCap);'],
    ['Soft cap nest opener: retracted sensor, extended by delay', 'XIC(i_SoftCapNestOpenerRetracted)XIC(q_RetractSoftCapNestOpener)XIO(q_ExtendSoftCapNestOpener)OTE(SoftCapNestOpenerRetracted);'],
    ['', 'XIO(i_SoftCapNestOpenerRetracted)XIC(q_ExtendSoftCapNestOpener)XIO(q_RetractSoftCapNestOpener)TON(SoftCapNestOpenerExtendedDelay,?,?)XIC(SoftCapNestOpenerExtendedDelay.DN)OTE(SoftCapNestOpenerExtended);'],
    ['Soft cap gripper Z slide: retracted sensor, extended by delay', 'XIC(i_SoftCapGripperZRetracted)XIC(q_RetractSoftCapGripperZ)XIO(q_ExtendSoftCapGripperZ)OTE(SoftCapGripperZRetracted);'],
    ['', 'XIO(i_SoftCapGripperZRetracted)XIC(q_ExtendSoftCapGripperZ)XIO(q_RetractSoftCapGripperZ)TON(SoftCapGripperZExtendedDelay,?,?)XIC(SoftCapGripperZExtendedDelay.DN)OTE(SoftCapGripperZExtended);'],
    ['Soft cap gripper: commanded state plus delay', 'XIC(q_CloseSoftCapGripper)XIO(q_OpenSoftCapGripper)TON(CloseSoftCapGripperDelay,?,?)XIC(CloseSoftCapGripperDelay.DN)OTE(SoftCapGripperClosed);'],
    ['', 'XIC(q_OpenSoftCapGripper)XIO(q_CloseSoftCapGripper)TON(OpenSoftCapGripperDelay,?,?)XIC(OpenSoftCapGripperDelay.DN)OTE(SoftCapGripperOpened);'],
    ...C.logicInputs({ sides: [cfg.ab], dial: false,
      initialized: 'XIC(SoftCapGripperZRetracted)[XIO(HoldingCap) XIC(SoftCapNestOpenerRetracted) XIC(SoftCapGripperOpened) ,XIC(HoldingCap) XIC(SoftCapGripperClosed) ]',
      lockoutRungs: [['Lockout', 'XIC(' + C.OP + 'Lockout' + cfg.ab + ')XIO(ManualMode)OTE(Lockout);']],
      dryRunRungs: [['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + C.OP + 'DryRun' + cfg.ab + ') ,XIC(g_HMI_DryRun) ]OTE(DryRun);']] }),
    ...C.clearMomentary(),
  ];
  const R02 = [
    ...C.r02Head([37]),
    ['State 4: Start of sequence, wait for the robot to start on the nest; holding a cap it re-enters at the wait for the insertion', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[37]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Robot working this nest, lower the gripper onto the soft cap', st(4) + 'XIO(HoldingCap)XIC(CycleStarted)XIC(SS_OK)MOVE(7,Control.StateReg);'],
    ['State 10: Close the gripper on the soft cap', st(7) + 'XIC(SoftCapGripperZExtended)XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Open the soft cap nest', st(10) + 'XIC(SoftCapGripperClosed)XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Lift the soft cap out of the nest', st(13) + 'XIC(SoftCapNestOpenerExtended)XIC(SS_OK)MOVE(16,Control.StateReg);'],
    ['State 19: Cap presented as the funnel, wait for the robot to insert the tube', '[' + st(16) + ' XIC(SoftCapGripperZRetracted) ,' + st(4) + ' XIC(HoldingCap) ]XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: Tube inserted, wait for the robot to back out of the cap', st(19) + 'XIC(TubeInserted)XIC(SS_OK)MOVE(22,Control.StateReg);'],
    ['State 25: Robot clear, lower the cap and tube into the nest', st(22) + 'XIC(RobotClearOfCap)XIC(SoftCapNestOpenerExtended)XIC(SS_OK)MOVE(25,Control.StateReg);'],
    ['State 28: Close the soft cap nest', st(25) + 'XIC(SoftCapGripperZExtended)XIC(SS_OK)MOVE(28,Control.StateReg);'],
    ['State 31: Open the gripper', st(28) + 'XIC(SoftCapNestOpenerRetracted)XIC(SS_OK)MOVE(31,Control.StateReg);'],
    ['State 34: Retract the gripper Z', st(31) + 'XIC(SoftCapGripperOpened)XIC(SS_OK)MOVE(34,Control.StateReg);'],
    ['State 37: Cycle Complete', st(34) + 'XIC(SoftCapGripperZRetracted)MOVE(37,Control.StateReg);'],
    ...C.r02Tail(),
    ['State 100:Start of initialization sequence, retract the gripper Z', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization close the soft cap nest (no cap held)', st(100) + 'XIC(SoftCapGripperZRetracted)XIO(HoldingCap)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 106: Initialization open the gripper (no cap held)', st(103) + 'XIC(SoftCapNestOpenerRetracted)XIC(SS_OK)MOVE(106,Control.StateReg);'],
    ['State 124: Initialization complete; a held cap stays in the closed gripper', '[' + st(106) + ' XIC(SoftCapGripperOpened) ,' + st(100) + ' XIC(SoftCapGripperZRetracted) XIC(HoldingCap) XIC(SoftCapGripperClosed) ]MOVE(124,Control.StateReg);'],
    ...C.r02End(),
  ];
  const R03 = [
    ...C.r03Head('XIC(SafetyOK)', [cfg.ab], false),
    ['Actuators Safe For Index: gripper Z up and the soft cap nest closed', 'XIC(SoftCapGripperZRetracted)XIC(SoftCapNestOpenerRetracted)OTE(q_ActuatorsSafe);'],
    ['Holding a soft cap from the lift until the gripper opens (kept through every stop)', '[' + st(16) + ' OTL(HoldingCap) ,' + states([34, 106]) + ' OTU(HoldingCap) ];'],
    ['Handshake to the robot: cap lifted, gripper closed, nest open', st(19) + 'XIC(SoftCapGripperZRetracted)XIC(SoftCapGripperClosed)XIC(SoftCapNestOpenerExtended)OTE(p_SoftCapPresented);'],
    ['Soft Cap Gripper Z Control: down onto the cap and down to place, up with the cap and after placing', outputRung('q_ExtendSoftCapGripperZ', states([7, 25]), 'XIO(Status.State[16]) XIO(Status.State[34]) XIO(Status.State[100])', 0, 1)],
    ['', outputRung('q_RetractSoftCapGripperZ', states([16, 34, 100]), 'XIO(Status.State[7]) XIO(Status.State[25])', 1, 0)],
    ['Soft Cap Gripper Control: closed while it holds a cap, re-commanded from the held memory after a stop', outputRung('q_CloseSoftCapGripper', '[' + st(10) + ' ,XIC(HoldingCap) XIO(Status.State[106]) ]', 'XIO(Status.State[31]) XIO(Status.State[106])', 2, 3)],
    ['', outputRung('q_OpenSoftCapGripper', states([31, 106]), 'XIO(Status.State[10])', 3, 2)],
    ['Soft Cap Nest Opener Control: open while the cap is out of the nest', outputRung('q_ExtendSoftCapNestOpener', states([13, 19, 22, 25]), 'XIO(Status.State[28]) XIO(Status.State[103])', 4, 5)],
    ['', outputRung('q_RetractSoftCapNestOpener', states([28, 103]), 'XIO(Status.State[13])', 5, 4)],
  ];
  const A = 'AlarmONS.';
  const R20 = [
    [alarms[0], H.deviceAlarm(0, 'Lockout', 'q_ExtendSoftCapGripperZ', 'SoftCapGripperZExtended', 'AlarmTimerSoftCapGripperZExtended', A + 0)],
    [alarms[1], H.deviceAlarm(1, 'Lockout', 'q_RetractSoftCapGripperZ', 'SoftCapGripperZRetracted', 'AlarmTimerSoftCapGripperZRetracted', A + 1)],
    [alarms[2], waitAlarm(2, [10], 3000, 'XIO(SoftCapGripperClosed) ', A + 2)],
    [alarms[3], waitAlarm(3, [31, 106], 3000, 'XIO(SoftCapGripperOpened) ', A + 3)],
    [alarms[4], H.deviceAlarm(4, 'Lockout', 'q_ExtendSoftCapNestOpener', 'SoftCapNestOpenerExtended', 'AlarmTimerSoftCapNestOpenerExtended', A + 4)],
    [alarms[5], H.deviceAlarm(5, 'Lockout', 'q_RetractSoftCapNestOpener', 'SoftCapNestOpenerRetracted', 'AlarmTimerSoftCapNestOpenerRetracted', A + 5)],
    [alarms[6], waitAlarm(6, [19], 60000, 'XIO(TubeInserted) ', A + 6)],
    [alarms[7], waitAlarm(7, [22], 10000, 'XIO(RobotClearOfCap) ', A + 7)],
    ...C.r20Tail(false),
  ];
  return { PROG, xml: H.programXml(PROG, tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R20_Alarms', rungs: R20 }]) };
}
module.exports = { build };
