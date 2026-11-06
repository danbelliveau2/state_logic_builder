'use strict';
// L2_S04_SpikeEscapement — feeder bowl, escapement blade, servo shuttle (5 positions), two rotaries with grippers, reject blow-off.
// Escapement rules (Jason 2026-09-01 / 09-23): no tracking writes, no CycleStation, no q_StationComplete; reads Station[4].OpStatus.
// Permissives (Jason 2026-11-06, v0.9.1 return): the shuttle and the rotary presenters need the PNP clear; grippers, blade and blow-off do not.
// Restart by situation (v0.10, Jason 2026-11-06): PartLoaded / RejectPending latches survive every stop; initialization never opens a
// gripper that holds a part and never moves a loaded shuttle to a load position; state 4 re-enters the state the facts call for.
const H = require('../l5xBuild.cjs');
const C = require('./common.cjs');
const V = require('./servo.cjs');
const { st, states, outputRung, waitAlarm, warnAlarm, sealedAlarm } = H;

const PROG = 'L2_S04_SpikeEscapement', PNP = '\\L2_S04_SpikePNP.';
const SIDES = ['Upstream', 'Downstream'], AB = { Upstream: 'A', Downstream: 'B' };

function build({ S01, S05, PREFIX, STA }) {
  const stateComments = { ...C.baseStates,
    4: 'Start Of Sequence', 7: 'Shuttle To Upstream Load', 10: 'Retract Blade For Upstream', 13: 'Wait For Spike Upstream', 16: 'Close Rotary Gripper Upstream', 19: 'Extend Blade Upstream', 22: 'Check Cap Upstream',
    25: 'Shuttle To Downstream Load', 28: 'Retract Blade For Downstream', 31: 'Wait For Spike Downstream', 34: 'Close Rotary Gripper Downstream', 37: 'Extend Blade Downstream', 40: 'Check Cap Downstream',
    43: 'Shuttle To Pick', 46: 'Present Rotaries', 49: 'Wait For Parts Picked', 52: 'Open Rotary Grippers', 55: 'Return Rotaries', 58: 'Cycle Complete',
    67: 'Shuttle To Reject Upstream', 70: 'Blow Off Reject Upstream', 73: 'Shuttle Back To Upstream Load', 76: 'Shuttle To Reject Downstream', 79: 'Blow Off Reject Downstream', 82: 'Shuttle Back To Downstream Load',
    100: 'Initialization Extend Blade', 103: 'Initialization Open Grippers', 106: 'Initialization Return Rotaries', 109: 'Initialization Shuttle To Upstream Load' };
  const alarms = ['Waiting For Shuttle At Upstream Load', 'Waiting For Blade To Retract', 'Waiting For Spike From Feeder Upstream', 'Cap Missing Upstream, Part Rejected',
    'Waiting For Shuttle At Downstream Load', 'Waiting For Spike From Feeder Downstream', 'Cap Missing Downstream, Part Rejected', 'Waiting For Shuttle At Pick',
    'Waiting For Rotary Upstream To Present', 'Waiting For Rotary Downstream To Present', 'Waiting For Rotary Upstream To Return', 'Waiting For Rotary Downstream To Return',
    'Waiting For Shuttle At Reject Upstream', 'Waiting For Shuttle At Reject Downstream', 'Consecutive Cap Missing Rejects', 'Waiting For Blade To Extend',
    'Rotary Upstream Sensors/Outputs Misconfigured', 'Rotary Downstream Sensors/Outputs Misconfigured'];
  const servo = V.servoAlarms([['XAxis', 'Shuttle Axis']]);
  const ranges = [['XAxisLoadUpstream', 0, 5, 'At Upstream Load'], ['XAxisLoadDownstream', 1, 5, 'At Downstream Load'], ['XAxisPick', 2, 5, 'At Pick Position'], ['XAxisRejectUpstream', 3, 5, 'At Upstream Reject'], ['XAxisRejectDownstream', 4, 5, 'At Downstream Reject']];

  const tags = [
    ...C.engineTags(S01, PREFIX, stateComments, alarms, servo.list),
    ...V.servoTags(S01, S05, 'XAxis', { label: 'Shuttle Axis', positions: [0, 200, 300, 0, 0], ranges }),
    H.boolTag('i_EscapementRetracted', { usage: 'Input', desc: 'Blade Retracted' }), H.boolTag('i_SpikePresent', { usage: 'Input', desc: 'Spike Present' }), H.boolTag('i_CapPresent', { usage: 'Input', desc: 'Cap Present On Spike' }),
    ...SIDES.flatMap((s) => [H.boolTag('i_Rotary' + s + 'Extended', { usage: 'Input', desc: 'Rotary ' + s + ' Presented' }), H.boolTag('i_Rotary' + s + 'Retracted', { usage: 'Input', desc: 'Rotary ' + s + ' Returned' })]),
    H.boolTag('q_ExtendEscapement', { usage: 'Output', desc: 'Extend Blade' }), H.boolTag('q_RetractEscapement', { usage: 'Output', desc: 'Retract Blade' }), H.boolTag('q_RejectBlowOff', { usage: 'Output', desc: 'Reject Blow-Off' }),
    H.boolTag('q_FeederBowlEnable', { usage: 'Output', desc: 'Feeder Bowl Run' }),
    ...SIDES.flatMap((s) => [H.boolTag('q_ExtendRotary' + s, { usage: 'Output', desc: 'Present Rotary ' + s }), H.boolTag('q_RetractRotary' + s, { usage: 'Output', desc: 'Return Rotary ' + s }),
      H.boolTag('q_CloseRotaryGripper' + s, { usage: 'Output', desc: 'Close Gripper ' + s }), H.boolTag('q_OpenRotaryGripper' + s, { usage: 'Output', desc: 'Open Gripper ' + s })]),
    H.boolTag('p_PartsPresented', { usage: 'Public', desc: 'Parts Presented To PNP' }), H.boolTag('p_EscapementGrippersOpen', { usage: 'Public', desc: 'Rotary Grippers Open' }), H.boolTag('p_EscapementSafeForPick', { usage: 'Public', desc: 'Safe For PNP To Pick' }),
    H.boolTag('p_RotariesReturned', { usage: 'Public', desc: 'Both Rotaries Returned' }),
    ...SIDES.map((s) => H.boolTag('p_PartLoaded' + s, { usage: 'Public', desc: 'Good Part Held ' + s })),
    ...SIDES.flatMap((s) => [H.boolTag('Lockout' + s), H.boolTag('DryRun' + s), H.boolTag('PartLoaded' + s), H.boolTag('RejectPending' + s), H.boolTag('Held' + s), H.boolTag('SideDone' + s),
      H.boolTag('Rotary' + s + 'Extended'), H.boolTag('Rotary' + s + 'Retracted'),
      H.boolTag('RotaryGripper' + s + 'Closed'), H.boolTag('RotaryGripper' + s + 'Opened'), H.copyTag(S05, 'CloseGripperDelay', 'CloseRotaryGripper' + s + 'Delay', 'Gripper ' + s + ' Close Delay'), H.copyTag(S05, 'OpenGripperDelay', 'OpenRotaryGripper' + s + 'Delay', 'Gripper ' + s + ' Open Delay')]),
    H.boolTag('AnyHeld'), H.boolTag('GrippersMatchHeld'), H.boolTag('RotariesPresented'),
    H.alarmTimerTag('AlarmTimerEscapementExtended'), H.alarmTimerTag('AlarmTimerEscapementRetracted'),
    ...SIDES.flatMap((s) => [H.alarmTimerTag('AlarmTimerRotary' + s + 'Extended'), H.alarmTimerTag('AlarmTimerRotary' + s + 'Retracted'), H.alarmTimerTag('AlarmTimerRotary' + s + 'Misconfigured')]),
    H.boolTag('EscapementExtended'), H.boolTag('EscapementRetracted'), H.timerTag('EscapementExtendedDelay', 300, 'Blade Extend Delay'), H.boolTag('ShuttleAtLoad'), H.boolTag('PnpClear'), H.boolTag('PartsPicked'),
    H.copyTag(S01, 'TubeALoadedDebounce', 'SpikePresentDebounce', 'Spike Present Sensor'), H.copyTag(S01, 'TubeALoadedDebounce', 'CapPresentDebounce', 'Cap Present Sensor'), H.boolTag('SpikePresent'), H.boolTag('CapPresent'),
    H.timerTag('CapCheckDelay', 200, 'Cap Check Settle'), H.timerTag('BlowOffDelay', 500, 'Reject Blow-Off Time'), H.boolTag('FeederBowlManLatch'), H.copyTag(S01, 'ConsecFails', 'ConsecFails'),
    H.dintCommentTag('HMI_Momentary', [[0, 'Present Rotary Upstream'], [1, 'Return Rotary Upstream'], [2, 'Present Rotary Downstream'], [3, 'Return Rotary Downstream'], [4, 'Close Rotary Gripper Upstream'], [5, 'Open Rotary Gripper Upstream'],
      [6, 'Close Rotary Gripper Downstream'], [7, 'Open Rotary Gripper Downstream'], [8, 'Reject Blow-Off'], [9, 'Feeder Bowl On'], [10, 'Feeder Bowl Off'], [11, 'Extend Blade'], [12, 'Retract Blade']]),
  ];

  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R04_XAxisServo,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Station Number', 'MOVE(' + STA + ',StaNum);'],
    ['Pick and place clear of the escapement, parts picked', 'XIC(' + PNP + 'p_PnpClearOfEscapement)OTE(PnpClear);'],
    ['', 'XIC(' + PNP + 'p_PartsPicked)OTE(PartsPicked);'],
    ['Spike and cap present sensors', 'AOI_Debounce(SpikePresentDebounce,i_SpikePresent,100,100)XIC(SpikePresentDebounce.On)OTE(SpikePresent);'],
    ['', 'AOI_Debounce(CapPresentDebounce,i_CapPresent,100,100)XIC(CapPresentDebounce.On)OTE(CapPresent);'],
    ['Escapement blade: retracted sensor, extended by delay', 'XIC(i_EscapementRetracted)XIC(q_RetractEscapement)XIO(q_ExtendEscapement)OTE(EscapementRetracted);'],
    ['', 'XIO(i_EscapementRetracted)XIC(q_ExtendEscapement)XIO(q_RetractEscapement)TON(EscapementExtendedDelay,?,?)XIC(EscapementExtendedDelay.DN)OTE(EscapementExtended);'],
  ];
  SIDES.forEach((s, i) => {
    R01.push([i === 0 ? 'Rotary actuators: two sensors, extended = presented to the pick and place' : '', 'XIC(i_Rotary' + s + 'Extended)XIO(i_Rotary' + s + 'Retracted)XIC(q_ExtendRotary' + s + ')XIO(q_RetractRotary' + s + ')OTE(Rotary' + s + 'Extended);']);
    R01.push(['', 'XIC(i_Rotary' + s + 'Retracted)XIO(i_Rotary' + s + 'Extended)XIC(q_RetractRotary' + s + ')XIO(q_ExtendRotary' + s + ')OTE(Rotary' + s + 'Retracted);']);
  });
  R01.push(['Both rotaries at the presented position (sensors only, for the restart)', 'XIC(i_RotaryUpstreamExtended)XIC(i_RotaryDownstreamExtended)OTE(RotariesPresented);']);
  SIDES.forEach((s, i) => {
    R01.push([i === 0 ? 'Rotary grippers: commanded state plus delay' : '', 'XIC(q_CloseRotaryGripper' + s + ')XIO(q_OpenRotaryGripper' + s + ')TON(CloseRotaryGripper' + s + 'Delay,?,?)XIC(CloseRotaryGripper' + s + 'Delay.DN)OTE(RotaryGripper' + s + 'Closed);']);
    R01.push(['', 'XIC(q_OpenRotaryGripper' + s + ')XIO(q_CloseRotaryGripper' + s + ')TON(OpenRotaryGripper' + s + 'Delay,?,?)XIC(OpenRotaryGripper' + s + 'Delay.DN)OTE(RotaryGripper' + s + 'Opened);']);
  });
  SIDES.forEach((s, i) => {
    R01.push([i === 0 ? 'What each gripper holds: a good part or a reject not yet blown off' : '', '[XIC(PartLoaded' + s + ') ,XIC(RejectPending' + s + ') ]OTE(Held' + s + ');']);
  });
  R01.push(['', '[XIC(HeldUpstream) ,XIC(HeldDownstream) ]OTE(AnyHeld);']);
  R01.push(['', SIDES.map((s) => '[XIC(Held' + s + ') XIC(RotaryGripper' + s + 'Closed) ,XIO(Held' + s + ') XIC(RotaryGripper' + s + 'Opened) ]').join('') + 'OTE(GrippersMatchHeld);']);
  R01.push(...C.logicInputs({
    sides: ['A', 'B'], dial: false,
    initialized: 'XIC(EscapementExtended)XIC(GrippersMatchHeld)[XIO(AnyHeld) XIC(RotaryUpstreamRetracted) XIC(RotaryDownstreamRetracted) XIC(XAxisLoadUpstream.InPos) ,XIC(AnyHeld) [XIC(XAxisLoadUpstream.InPos) ,XIC(XAxisLoadDownstream.InPos) ,XIC(XAxisPick.InPos) ] [XIC(RotaryUpstreamRetracted) XIC(RotaryDownstreamRetracted) ,XIC(RotariesPresented) ] ]',
    lockoutRungs: [['Lockout per side, station lockout when both', 'XIC(' + C.OP + 'LockoutA)XIO(ManualMode)OTE(LockoutUpstream);'], ['', 'XIC(' + C.OP + 'LockoutB)XIO(ManualMode)OTE(LockoutDownstream);'], ['', 'XIC(LockoutUpstream)XIC(LockoutDownstream)OTE(Lockout);']],
    dryRunRungs: [['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + C.OP + 'DryRunA) ,XIC(g_HMI_DryRun) ]OTE(DryRunUpstream);'], ['', '[XIC(' + C.OP + 'DryRunB) ,XIC(g_HMI_DryRun) ]OTE(DryRunDownstream);']],
  }));
  SIDES.forEach((s, i) => R01.push([i === 0 ? 'A side is done when it holds a good part or is locked out' : '', '[XIC(PartLoaded' + s + ') ,XIC(Lockout' + s + ') ]OTE(SideDone' + s + ');']));
  R01.push(['Shuttle at a load position, the blade may retract', '[XIC(XAxisLoadUpstream.InPos) ,XIC(XAxisLoadDownstream.InPos) ]OTE(ShuttleAtLoad);']);
  R01.push(...C.clearMomentary());

  const capOk = (s) => 'XIC(CapCheckDelay.DN)[XIC(CapPresent) ,XIC(DryRun' + s + ') ]';
  const atPos = (n) => 'XIC(XAxis_MAM.PC)XIC(' + n + '.InPos)';
  const noReject = 'XIO(RejectPendingUpstream) XIO(RejectPendingDownstream)';
  const resume = st(4) + ' XIC(AnyHeld) ' + noReject;
  const R02 = [
    ...C.r02Head([13, 31, 49]),
    ['State 4: Start of sequence, re-enters the sequence by what the grippers hold', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[58]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Shuttle to the Upstream load position (Upstream empty)', st(4) + noReject + ' XIO(PartLoadedUpstream)[XIO(AnyHeld) ,XIO(XAxisPick.InPos) ,XIO(RotariesPresented) ]XIO(LockoutUpstream)XIC(SS_OK)MOVE(7,Control.StateReg);'],
    ['State 10: Retract the blade to let one spike into the Upstream gripper', states([7, 73]) + atPos('XAxisLoadUpstream') + 'XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Wait for the feeder to present a spike', st(10) + 'XIC(EscapementRetracted)XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Close the Upstream rotary gripper on the spike', st(13) + '[XIC(SpikePresent) ,XIC(DryRunUpstream) ]XIC(SS_OK)MOVE(16,Control.StateReg);'],
    ['State 19: Extend the blade to hold the inline back', st(16) + 'XIC(RotaryGripperUpstreamClosed)XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: Check the cap is on the Upstream spike', st(19) + 'XIC(EscapementExtended)XIC(SS_OK)MOVE(22,Control.StateReg);'],
    ['State 25: Shuttle to the Downstream load position (Downstream empty)', '[' + st(22) + ' ' + capOk('Upstream') + ' XIO(PartLoadedDownstream) ,' + st(4) + ' ' + noReject + ' XIO(PartLoadedDownstream) [XIC(PartLoadedUpstream) ,XIC(LockoutUpstream) ] [XIO(AnyHeld) ,XIO(XAxisPick.InPos) ,XIO(RotariesPresented) ] ]XIO(LockoutDownstream)XIC(SS_OK)MOVE(25,Control.StateReg);'],
    ['State 28: Retract the blade to let one spike into the Downstream gripper', states([25, 82]) + atPos('XAxisLoadDownstream') + 'XIC(SS_OK)MOVE(28,Control.StateReg);'],
    ['State 31: Wait for the feeder to present a spike', st(28) + 'XIC(EscapementRetracted)XIC(SS_OK)MOVE(31,Control.StateReg);'],
    ['State 34: Close the Downstream rotary gripper on the spike', st(31) + '[XIC(SpikePresent) ,XIC(DryRunDownstream) ]XIC(SS_OK)MOVE(34,Control.StateReg);'],
    ['State 37: Extend the blade to hold the inline back', st(34) + 'XIC(RotaryGripperDownstreamClosed)XIC(SS_OK)MOVE(37,Control.StateReg);'],
    ['State 40: Check the cap is on the Downstream spike', st(37) + 'XIC(EscapementExtended)XIC(SS_OK)MOVE(40,Control.StateReg);'],
    ['State 43: Shuttle to the pick position with every side loaded or locked out', '[' + st(40) + ' ' + capOk('Downstream') + ' ,' + st(22) + ' ' + capOk('Upstream') + ' [XIC(LockoutDownstream) ,XIC(PartLoadedDownstream) ] ,' + resume + ' XIO(XAxisPick.InPos) XIC(SideDoneUpstream) XIC(SideDoneDownstream) ]XIC(SS_OK)MOVE(43,Control.StateReg);'],
    ['State 46: Present the rotaries to the pick and place', '[' + st(43) + ' ' + atPos('XAxisPick') + ' ,' + resume + ' XIC(XAxisPick.InPos) XIO(RotariesPresented) XIC(SideDoneUpstream) XIC(SideDoneDownstream) ]XIC(PnpClear)XIC(SS_OK)MOVE(46,Control.StateReg);'],
    ['State 49: Parts presented, wait for the pick and place to take them', '[' + st(46) + ' XIC(RotaryUpstreamExtended) XIC(RotaryDownstreamExtended) ,' + resume + ' XIC(XAxisPick.InPos) XIC(RotariesPresented) ]XIC(SS_OK)MOVE(49,Control.StateReg);'],
    ['State 52: Open the rotary grippers', st(49) + 'XIC(PartsPicked)XIC(SS_OK)MOVE(52,Control.StateReg);'],
    ['State 55: Return the rotaries once the pick and place is clear', st(52) + 'XIC(RotaryGripperUpstreamOpened)XIC(RotaryGripperDownstreamOpened)XIC(PnpClear)XIC(SS_OK)MOVE(55,Control.StateReg);'],
    ['State 58: Cycle Complete', st(55) + 'XIC(RotaryUpstreamRetracted)XIC(RotaryDownstreamRetracted)MOVE(58,Control.StateReg);'],
    ['State 67: Cap missing, shuttle the Upstream part to the reject chute', '[' + st(22) + ' XIC(CapCheckDelay.DN) XIO(CapPresent) XIO(DryRunUpstream) ,' + st(4) + ' XIC(RejectPendingUpstream) ]XIC(SS_OK)MOVE(67,Control.StateReg);'],
    ['State 70: Open the Upstream gripper and blow the part down the chute', st(67) + atPos('XAxisRejectUpstream') + 'XIC(SS_OK)MOVE(70,Control.StateReg);'],
    ['State 73: Shuttle back to the Upstream load position', st(70) + 'XIC(RotaryGripperUpstreamOpened)XIC(BlowOffDelay.DN)XIC(SS_OK)MOVE(73,Control.StateReg);'],
    ['State 76: Cap missing, shuttle the Downstream part to the reject chute', '[' + st(40) + ' XIC(CapCheckDelay.DN) XIO(CapPresent) XIO(DryRunDownstream) ,' + st(4) + ' XIO(RejectPendingUpstream) XIC(RejectPendingDownstream) ]XIC(SS_OK)MOVE(76,Control.StateReg);'],
    ['State 79: Open the Downstream gripper and blow the part down the chute', st(76) + atPos('XAxisRejectDownstream') + 'XIC(SS_OK)MOVE(79,Control.StateReg);'],
    ['State 82: Shuttle back to the Downstream load position', st(79) + 'XIC(RotaryGripperDownstreamOpened)XIC(BlowOffDelay.DN)XIC(SS_OK)MOVE(82,Control.StateReg);'],
    ...C.r02Tail(),
    ['State 100:Start of initialization sequence, extend the blade', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization open the rotary grippers (nothing held)', st(100) + 'XIC(EscapementExtended)XIO(AnyHeld)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 106: Initialization return the rotaries', '[' + st(103) + ' XIC(RotaryGripperUpstreamOpened) XIC(RotaryGripperDownstreamOpened) ,' + st(100) + ' XIC(EscapementExtended) XIC(AnyHeld) XIC(GrippersMatchHeld) XIC(PnpClear) ]XIC(SS_OK)MOVE(106,Control.StateReg);'],
    ['State 109: Initialization shuttle to the Upstream load position (nothing held)', st(106) + 'XIC(RotaryUpstreamRetracted)XIC(RotaryDownstreamRetracted)XIO(AnyHeld)XIC(SS_OK)MOVE(109,Control.StateReg);'],
    ['State 124: Initialization complete; parts held stay where they are, the pick and place over them finishes first', '[' + st(109) + ' ' + atPos('XAxisLoadUpstream') + ' ,' + st(106) + ' XIC(RotaryUpstreamRetracted) XIC(RotaryDownstreamRetracted) XIC(AnyHeld) ,' + st(100) + ' XIC(EscapementExtended) XIC(AnyHeld) XIC(GrippersMatchHeld) XIO(PnpClear) XIC(XAxisPick.InPos) XIC(RotariesPresented) ]MOVE(124,Control.StateReg);'],
    ...C.r02End(),
  ];

  const R03 = [
    ...C.r03Head('XIC(iq_XAxis.ServoActionStatus)XIC(iq_XAxis.AxisHomedStatus)', ['A', 'B'], false),
    ['Cap check settle and reject blow-off timers', states([22, 40]) + 'TON(CapCheckDelay,?,?);'],
    ['', 'XIC(q_RejectBlowOff)TON(BlowOffDelay,?,?);'],
    ['Good part held in each rotary gripper (kept through every stop)', '[' + st(22) + ' ' + capOk('Upstream') + ' OTL(PartLoadedUpstream) ,' + states([52, 70, 103]) + ' OTU(PartLoadedUpstream) ];'],
    ['', '[' + st(40) + ' ' + capOk('Downstream') + ' OTL(PartLoadedDownstream) ,' + states([52, 79, 103]) + ' OTU(PartLoadedDownstream) ];'],
    ['Reject held until it is blown off (kept through every stop)', '[' + st(67) + ' OTL(RejectPendingUpstream) ,' + states([73, 103]) + ' OTU(RejectPendingUpstream) ];'],
    ['', '[' + st(76) + ' OTL(RejectPendingDownstream) ,' + states([82, 103]) + ' OTU(RejectPendingDownstream) ];'],
    ['Consecutive cap-missing rejects', states([67, 76]) + 'ONS(ONS.5)ADD(ConsecFails.Count,1,ConsecFails.Count);'],
    ['', states([25, 43]) + 'ONS(ONS.6)MOVE(0,ConsecFails.Count);'],
    ['Handshake to the pick and place', 'XIC(PartLoadedUpstream)OTE(p_PartLoadedUpstream);'], ['', 'XIC(PartLoadedDownstream)OTE(p_PartLoadedDownstream);'],
    ['', 'XIC(XAxisPick.InPos)XIO(iq_XAxis.MotionStatus.0)XIC(RotariesPresented)OTE(p_EscapementSafeForPick);'],
    ['', st(49) + 'XIC(p_EscapementSafeForPick)OTE(p_PartsPresented);'],
    ['', '[XIC(LockoutUpstream) ,XIC(RotaryGripperUpstreamOpened) ][XIC(LockoutDownstream) ,XIC(RotaryGripperDownstreamOpened) ]OTE(p_EscapementGrippersOpen);'],
    ['', 'XIC(i_RotaryUpstreamRetracted)XIC(i_RotaryDownstreamRetracted)OTE(p_RotariesReturned);'],
    ['Feeder bowl runs while the cycle runs', 'XIC(Status.State[1])XIC(HMI_Momentary.9)OTL(FeederBowlManLatch);'],
    ['', 'XIC(FeederBowlManLatch)[XIC(HMI_Momentary.10) ,XIO(Status.State[1]) ]OTU(FeederBowlManLatch);'],
    ['', '[XIO(Status.State[1]) XIC(CycleRunning) XIO(Lockout) XIO(Status.State[127]) ,XIC(Status.State[1]) XIC(FeederBowlManLatch) ]XIC(SafetyOK)OTE(q_FeederBowlEnable);'],
    ['Blade Control: retracted only with the shuttle at a load position', outputRung('q_RetractEscapement', states([10, 28]), 'XIO(Status.State[19]) XIO(Status.State[37]) XIO(Status.State[100])', 12, 11, 'XIC(ShuttleAtLoad) ')],
    ['', outputRung('q_ExtendEscapement', states([19, 37, 100]), 'XIO(Status.State[10]) XIO(Status.State[28])', 11, 12)],
    ['Reject Blow-Off Control: single solenoid, timed', '[XIO(Status.State[1]) ' + states([70, 79]) + ' ,XIC(Status.State[1]) [XIC(HMI_Momentary.8) ,XIC(q_RejectBlowOff) XIO(BlowOffDelay.DN) ] ]OTE(q_RejectBlowOff);'],
  ];
  SIDES.forEach((s, i) => {
    const b = i * 2, g = 4 + i * 2, on = i === 0 ? 16 : 34, blow = i === 0 ? 70 : 79, off = [52, blow, 103];
    R03.push(['Rotary ' + s + ' Control: presented to the pick and place while it picks, or returned (needs the PNP clear)', outputRung('q_ExtendRotary' + s, 'LIMIT(46,Control.StateReg,52)', 'XIO(Status.State[55]) XIO(Status.State[106])', b, b + 1, 'XIC(PnpClear) ')]);
    R03.push(['', outputRung('q_RetractRotary' + s, states([55, 106]), 'XIO(Status.State[46])', b + 1, b, 'XIC(PnpClear) ')]);
    R03.push(['Rotary Gripper ' + s + ' Control: closed while it holds a part, re-commanded from the held memory after a stop', outputRung('q_CloseRotaryGripper' + s, '[' + st(on) + ' ,XIC(PartLoaded' + s + ') ,XIC(RejectPending' + s + ') XIO(Status.State[' + blow + ']) ]', off.map((n) => 'XIO(Status.State[' + n + '])').join(' '), g, g + 1)]);
    R03.push(['', outputRung('q_OpenRotaryGripper' + s, states(off), 'XIO(Status.State[' + on + '])', g + 1, g)]);
  });

  const R04 = V.servoRoutine('XAxis', {
    permissive: 'XIC(PnpClear)', manual: ['LoadUpstream', 'LoadDownstream', 'Pick', 'RejectUpstream', 'RejectDownstream'],
    autoComment: 'Auto Mode - 0 Upstream load, 1 Downstream load, 2 pick, 3 Upstream reject, 4 Downstream reject',
    auto: [V.autoBranch('XAxis', [7, 73, 109], 0), V.autoBranch('XAxis', [25, 82], 1), V.autoBranch('XAxis', [43], 2), V.autoBranch('XAxis', [67], 3), V.autoBranch('XAxis', [76], 4)].join(' ,'),
    mamGate: states([7, 25, 43, 67, 73, 76, 82, 109]), ranges,
  });

  const A = 'AlarmONS.';
  const R20 = [
    ...servo.rungs,
    [alarms[0], waitAlarm(0, [7, 73, 109], 5000, 'XIO(XAxisLoadUpstream.InPos) ', A + 0)],
    [alarms[1], H.deviceAlarm(1, 'Lockout', 'q_RetractEscapement', 'EscapementRetracted', 'AlarmTimerEscapementRetracted', A + 1)],
    [alarms[2], warnAlarm(2, st(13) + 'MOVE(30000,Control.FaultTime)XIC(Status.TimeoutFlt)', A + 2)],
    [alarms[3], warnAlarm(3, st(67), A + 3)],
    [alarms[4], waitAlarm(4, [25, 82], 5000, 'XIO(XAxisLoadDownstream.InPos) ', A + 4)],
    [alarms[5], warnAlarm(5, st(31) + 'MOVE(30000,Control.FaultTime)XIC(Status.TimeoutFlt)', A + 5)],
    [alarms[6], warnAlarm(6, st(76), A + 6)],
    [alarms[7], waitAlarm(7, [43], 5000, 'XIO(XAxisPick.InPos) ', A + 7)],
    [alarms[8], H.deviceAlarm(8, 'LockoutUpstream', 'q_ExtendRotaryUpstream', 'RotaryUpstreamExtended', 'AlarmTimerRotaryUpstreamExtended', A + 8)],
    [alarms[9], H.deviceAlarm(9, 'LockoutDownstream', 'q_ExtendRotaryDownstream', 'RotaryDownstreamExtended', 'AlarmTimerRotaryDownstreamExtended', A + 9)],
    [alarms[10], H.deviceAlarm(10, 'LockoutUpstream', 'q_RetractRotaryUpstream', 'RotaryUpstreamRetracted', 'AlarmTimerRotaryUpstreamRetracted', A + 10)],
    [alarms[11], H.deviceAlarm(11, 'LockoutDownstream', 'q_RetractRotaryDownstream', 'RotaryDownstreamRetracted', 'AlarmTimerRotaryDownstreamRetracted', A + 11)],
    [alarms[12], waitAlarm(12, [67], 5000, 'XIO(XAxisRejectUpstream.InPos) ', A + 12)],
    [alarms[13], waitAlarm(13, [76], 5000, 'XIO(XAxisRejectDownstream.InPos) ', A + 13)],
    [alarms[14], sealedAlarm(14, 'GT(ConsecFails.Count,ConsecFails.Setpoint)', A + 14)],
    ['', 'XIC(Alarm[14].Active)MOVE(0,ConsecFails.Count);'],
    [alarms[15], H.deviceAlarm(15, 'Lockout', 'q_ExtendEscapement', 'EscapementExtended', 'AlarmTimerEscapementExtended', A + 15)],
    [alarms[16], H.misconfiguredAlarm(16, 'LockoutUpstream', 'q_RetractRotaryUpstream', 'q_ExtendRotaryUpstream', 'i_RotaryUpstreamExtended', 'i_RotaryUpstreamRetracted', 'AlarmTimerRotaryUpstreamMisconfigured', A + 16)],
    [alarms[17], H.misconfiguredAlarm(17, 'LockoutDownstream', 'q_RetractRotaryDownstream', 'q_ExtendRotaryDownstream', 'i_RotaryDownstreamExtended', 'i_RotaryDownstreamRetracted', 'AlarmTimerRotaryDownstreamMisconfigured', A + 17)],
    ...C.r20Tail(true),
  ];
  return H.programXml(PROG, tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R04_XAxisServo', rungs: R04 }, { name: 'R20_Alarms', rungs: R20 }]);
}
module.exports = { PROG, build };
