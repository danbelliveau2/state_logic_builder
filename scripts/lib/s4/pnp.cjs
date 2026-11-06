'use strict';
// L2_S04_SpikePNP — the indexed station: X / Z / R (spindle) servo PNP with two spike grippers, two load cells, two funnel grippers.
// Form: 1163 L2_S10 (Jason-corrected servo PNP with per-side tracking) + S05_ServoPNP + L2_S01 TubeFeed pass / fail (ConsecFails).
// Permissives (Jason 2026-11-06): Z lowers to pick only with the escapement safe; the escapement reads p_PnpClearOfEscapement.
const H = require('../l5xBuild.cjs');
const C = require('./common.cjs');
const V = require('./servo.cjs');
const { st, states, outputRung, waitAlarm, warnAlarm, sealedAlarm } = H;

const PROG = 'L2_S04_SpikePNP', ESC = '\\L2_S04_SpikeEscapement.', DISP = (s) => '\\L2_S04_Dispenser' + s + '.';
const SIDES = ['Upstream', 'Downstream'], AB = { Upstream: 'A', Downstream: 'B' };
const NEST = (s) => '\\L2_Tracking.p_Data.Nest[NestNumCurrent' + s + ']';
const trk = (s, bit) => NEST(s) + '.PartStatus.Station[StaNum].' + bit;
const working = (s, cond) => '[XIO(Work' + s + ') ,' + cond + ' ]';
const everyHead = (fn) => SIDES.map((s) => working(s, fn(s))).join('');

function build({ S01, S05, TRK, IDXB, PREFIX, STA, STAPRE }) {
  const stateComments = { ...C.baseStates,
    4: 'Wait For Index And Parts', 7: 'Close Funnel Grippers', 10: 'Z Axis To Pick', 13: 'Close Spike Grippers', 16: 'Wait For Escapement Release', 19: 'Z Axis Retract From Pick',
    22: 'X Axis To Dispense', 25: 'Z Axis To Dispense', 28: 'Dispense Dwell', 31: 'X Axis Pull Out Of Dispenser', 34: 'Z Axis Retract From Dispense', 37: 'X Axis To Pre-Insert', 40: 'Z Axis To Place',
    43: 'Oscillate, X Axis To Funnel Open', 46: 'Open Funnel Grippers', 49: 'X Axis To Insert', 52: 'Seat Jog', 55: 'Judge Insertion, Spindle Home', 58: 'Open Spike Grippers', 61: 'Z Axis Retract From Place', 64: 'X Axis To Pick', 67: 'Cycle Complete',
    100: 'Initialization Open Spike Grippers', 103: 'Initialization Retract Z Axis', 106: 'Initialization Spindle Home', 109: 'Initialization Open Funnel Grippers', 112: 'Initialization X Axis To Pick' };
  const alarms = ['Waiting For Parts From The Escapement', 'Waiting For Z Axis To Pick', 'Waiting For Escapement To Release', 'Waiting For Z Axis To Retract', 'Waiting For X Axis To Dispense',
    'Waiting For Dispenser Upstream Ready', 'Waiting For Dispenser Downstream Ready', 'Waiting For Z Axis To Dispense', 'Waiting For X Axis To Pull Out', 'Waiting For X Axis To Pre-Insert', 'Waiting For Z Axis To Place',
    'Waiting For X Axis To Funnel Open', 'Waiting For X Axis To Insert', 'Waiting For Spike To Seat', 'Waiting For Spindle To Home', 'Waiting For X Axis To Return To Pick',
    'Spike Upstream Not Engaged', 'Spike Downstream Not Engaged', 'Insertion Force High Upstream', 'Insertion Force High Downstream', 'Spike Upstream Seated Early', 'Spike Downstream Seated Early',
    'Spike Upstream Not Seated', 'Spike Downstream Not Seated', 'Spike Upstream Released, Nest Failed', 'Spike Downstream Released, Nest Failed', 'Consecutive Insertion Failures', 'Waiting For Escapement Safe To Pick'];
  const AX = [['XAxis', 'X Axis'], ['ZAxis', 'Z Axis'], ['RAxis', 'Spindle Axis']];
  const servo = V.servoAlarms(AX);
  const xr = [['XAxisPick', 0, 5, 'At Pick Position'], ['XAxisDispense', 1, 5, 'At Dispense Position'], ['XAxisDispenseRetract', 2, 5, 'At Dispense Pull-Out'], ['XAxisPreInsert', 3, 5, 'At Pre-Insert Position'], ['XAxisFunnelOpen', 4, 5, 'At Funnel Open Position'], ['XAxisInsert', 5, 5, 'At Insert Position'], ['XAxisSeatLimit', 6, 5, 'At Seat Jog Limit']];
  const zr = [['ZAxisPick', 0, 10, 'At Pick Height'], ['ZAxisDispense', 1, 10, 'At Dispense Height'], ['ZAxisPlace', 2, 10, 'At Place Height'], ['ZAxisRetract', 3, 10, 'At Retract Height']];
  const rr = [['RAxisHome', 0, 5, 'Spindle At Home']];

  const tags = [
    ...C.engineTags(S01, PREFIX, stateComments, alarms, servo.list),
    ...V.servoTags(S01, S05, 'XAxis', { label: 'X Axis', ranges: xr, extraMotion: ['Seat_MAJ', 'Seat_MAS'] }),
    ...V.servoTags(S01, S05, 'ZAxis', { label: 'Z Axis', ranges: zr }),
    ...V.servoTags(S01, S05, 'RAxis', { label: 'Spindle Axis', positions: [0, 30, -30], homeSelect: 0, ranges: rr }),
    ...SIDES.flatMap((s) => [H.sintTag('i_LoadCell' + s + 'Byte0', 0, { usage: 'Input', desc: 'Load Cell ' + s + ' Byte 0' }), H.sintTag('i_LoadCell' + s + 'Byte1', 0, { usage: 'Input', desc: 'Load Cell ' + s + ' Byte 1' })]),
    H.dintTag('i_DisableSeatJog', 0, { usage: 'Input', constant: true, desc: 'Disable The Seat Jog' }),
    ...SIDES.flatMap((s) => [H.boolTag('q_CloseSpikeGripper' + s, { usage: 'Output', desc: 'Close Spike Gripper ' + s }), H.boolTag('q_OpenSpikeGripper' + s, { usage: 'Output', desc: 'Open Spike Gripper ' + s }),
      H.boolTag('q_CloseFunnelGripper' + s, { usage: 'Output', desc: 'Close Funnel ' + s }), H.boolTag('q_OpenFunnelGripper' + s, { usage: 'Output', desc: 'Open Funnel ' + s })]),
    H.boolTag('q_ActuatorsSafe', { usage: 'Output', desc: 'Actuators Safe For Index' }), H.boolTag('q_StationComplete', { usage: 'Output' }), H.boolTag('q_Pause', { usage: 'Output' }),
    H.boolTag('p_PartsPicked', { usage: 'Public', desc: 'Spikes Taken From Escapement' }), H.boolTag('p_PnpClearOfEscapement', { usage: 'Public', desc: 'Clear Of The Escapement' }),
    H.boolTag('p_DispenseRequest', { usage: 'Public', desc: 'Spikes In The Dispensers' }), H.boolTag('p_SpikeOutOfDispenser', { usage: 'Public', desc: 'Spikes Out Of Dispensers' }),
    // tracking per nest side (S10 form)
    H.boolTag('SingleCycle'), H.boolTag('SingleDisableTracking'), H.dintTag('StaNumPre', 0), H.copyTag(TRK, 'ZeroPartAssyStat', 'ZeroPartAssyStat'),
    ...SIDES.flatMap((s) => [H.dintTag('NestNumCurrent' + s, 0), H.dintTag('NestNumIncoming' + s, 0), H.boolTag('CycleStationA' + s), H.boolTag('CycleStationB' + s), H.boolTag('Lockout' + s), H.boolTag('DryRun' + s),
      H.boolTag('Work' + s), H.boolTag('HoldingPart' + s), H.copyTag(S05, 'SingleResetDelay', 'SingleResetDelay' + s), H.copyTag(S05, 'StationPerformance', 'StationPerformance' + s)]),
    // escapement / dispenser handshake
    H.boolTag('PartsPresented'), H.boolTag('EscapementGrippersOpen'), H.boolTag('EscapementSafeForPick'), ...SIDES.flatMap((s) => [H.boolTag('PartLoaded' + s), H.boolTag('DispenseReady' + s)]),
    H.timerTag('DispenseDwellDelay', 700, 'Dwell In The Dispenser'),
    // grippers
    ...SIDES.flatMap((s) => [H.boolTag('SpikeGripper' + s + 'Closed'), H.boolTag('SpikeGripper' + s + 'Opened'), H.copyTag(S05, 'CloseGripperDelay', 'CloseSpikeGripper' + s + 'Delay', 'Spike ' + s + ' Close Delay'), H.copyTag(S05, 'OpenGripperDelay', 'OpenSpikeGripper' + s + 'Delay', 'Spike ' + s + ' Open Delay'),
      H.boolTag('FunnelGripper' + s + 'Closed'), H.boolTag('FunnelGripper' + s + 'Opened'), H.copyTag(S05, 'CloseGripperDelay', 'CloseFunnelGripper' + s + 'Delay', 'Funnel ' + s + ' Close Delay'), H.copyTag(S05, 'OpenGripperDelay', 'OpenFunnelGripper' + s + 'Delay', 'Funnel ' + s + ' Open Delay')]),
    // force
    ...SIDES.flatMap((s) => [H.dintTag('LoadCell' + s + 'Counts', 0, { desc: 'Load Cell ' + s + ' Counts' }), H.realTag('Force' + s, 0, { desc: 'Insertion Force ' + s + ' lb' }), H.copyTag(IDXB, 'MovingAverageA', 'ForceFilter' + s, ''),
      H.dintTag('HMI_ForceZeroCounts' + s, 2048, { desc: 'Zero Force Counts ' + s }), H.boolTag('Engaged' + s), H.boolTag('OverForce' + s), H.boolTag('Seated' + s), H.boolTag('SeatedEarly' + s)]),
    H.realTag('HMI_ForceLbPerCount', 0.0024, { desc: 'Force lb Per Count' }), H.realTag('HMI_EngageForce', 0.3, { desc: 'Tube Engaged Force lb' }), H.realTag('HMI_ForceMax', 2.0, { desc: 'Insertion Force Limit lb' }),
    H.realTag('HMI_SeatForce', 3.0, { desc: 'Seated Force lb' }), H.realTag('HMI_SeatWindow', 1.5, { desc: 'Seat Position Window mm' }), H.boolTag('DisableSeatJog'), H.boolTag('SeatJogDone'), H.boolTag('Oscillating'), H.dintTag('OscillateDirection', 0),
    H.copyTag(S01, 'ConsecFails', 'ConsecFails'),
    H.dintCommentTag('HMI_Momentary', [[0, 'Close Spike Gripper Upstream'], [1, 'Open Spike Gripper Upstream'], [2, 'Close Spike Gripper Downstream'], [3, 'Open Spike Gripper Downstream'], [4, 'Close Funnel Gripper Upstream'], [5, 'Open Funnel Gripper Upstream'], [6, 'Close Funnel Gripper Downstream'], [7, 'Open Funnel Gripper Downstream']]),
  ];

  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R04_XAxisServo,0);'], ['', 'JSR(R05_ZAxisServo,0);'], ['', 'JSR(R06_RAxisServo,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Nest & Station Numbers', '[MOVE(' + STA + ',StaNum) MOVE(' + STAPRE + ',StaNumPre) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNumA,NestNumCurrentUpstream) MOVE(\\L2_Tracking.p_Data.Station[StaNumPre].NestNumA,NestNumIncomingUpstream) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNumB,NestNumCurrentDownstream) MOVE(\\L2_Tracking.p_Data.Station[StaNumPre].NestNumB,NestNumIncomingDownstream) ];'],
  ];
  SIDES.forEach((s, i) => {
    R01.push([i === 0 ? 'Load cells: two EX600-AXA bytes to counts, counts to pounds, filtered' : '', 'MUL(i_LoadCell' + s + 'Byte1,256,LoadCell' + s + 'Counts)ADD(LoadCell' + s + 'Counts,i_LoadCell' + s + 'Byte0,LoadCell' + s + 'Counts);']);
    R01.push(['', 'LT(i_LoadCell' + s + 'Byte0,0)ADD(LoadCell' + s + 'Counts,256,LoadCell' + s + 'Counts);']);
    R01.push(['', 'CPT(Force' + s + ',(LoadCell' + s + 'Counts-HMI_ForceZeroCounts' + s + ')*HMI_ForceLbPerCount);']);
    R01.push(['', 'MovingAverage(ForceFilter' + s + ',Force' + s + ',10);']);
  });
  R01.push(['Escapement and dispenser handshakes', 'XIC(' + ESC + 'p_PartsPresented)OTE(PartsPresented);'], ['', 'XIC(' + ESC + 'p_EscapementGrippersOpen)OTE(EscapementGrippersOpen);'], ['', 'XIC(' + ESC + 'p_EscapementSafeForPick)OTE(EscapementSafeForPick);']);
  for (const s of SIDES) R01.push(['', 'XIC(' + ESC + 'p_PartLoaded' + s + ')OTE(PartLoaded' + s + ');'], ['', 'XIC(' + DISP(s) + 'p_DispenseReady)OTE(DispenseReady' + s + ');']);
  SIDES.forEach((s, i) => {
    R01.push([i === 0 ? 'Spike and funnel grippers: commanded state plus delay' : '', 'XIC(q_CloseSpikeGripper' + s + ')XIO(q_OpenSpikeGripper' + s + ')TON(CloseSpikeGripper' + s + 'Delay,?,?)XIC(CloseSpikeGripper' + s + 'Delay.DN)OTE(SpikeGripper' + s + 'Closed);']);
    R01.push(['', 'XIC(q_OpenSpikeGripper' + s + ')XIO(q_CloseSpikeGripper' + s + ')TON(OpenSpikeGripper' + s + 'Delay,?,?)XIC(OpenSpikeGripper' + s + 'Delay.DN)OTE(SpikeGripper' + s + 'Opened);']);
    R01.push(['', 'XIC(q_CloseFunnelGripper' + s + ')XIO(q_OpenFunnelGripper' + s + ')TON(CloseFunnelGripper' + s + 'Delay,?,?)XIC(CloseFunnelGripper' + s + 'Delay.DN)OTE(FunnelGripper' + s + 'Closed);']);
    R01.push(['', 'XIC(q_OpenFunnelGripper' + s + ')XIO(q_CloseFunnelGripper' + s + ')TON(OpenFunnelGripper' + s + 'Delay,?,?)XIC(OpenFunnelGripper' + s + 'Delay.DN)OTE(FunnelGripper' + s + 'Opened);']);
  });
  R01.push(['Disable The Seat Jog - If Required By Application', 'EQ(i_DisableSeatJog,1)OTE(DisableSeatJog);']);
  R01.push(...C.logicInputs({
    sides: ['A', 'B'], dial: true, nestSides: SIDES.map((s) => ({ name: s, ab: AB[s] })),
    initialized: 'XIC(XAxisPick.InPos)XIC(ZAxisRetract.InPos)XIC(RAxisHome.InPos)XIC(SpikeGripperUpstreamOpened)XIC(SpikeGripperDownstreamOpened)XIC(FunnelGripperUpstreamOpened)XIC(FunnelGripperDownstreamOpened)',
    lockoutRungs: [['Lockout per nest side, station lockout when both', 'XIC(' + C.OP + 'LockoutA)XIO(ManualMode)OTE(LockoutUpstream);'], ['', 'XIC(' + C.OP + 'LockoutB)XIO(ManualMode)OTE(LockoutDownstream);'], ['', 'XIC(LockoutUpstream)XIC(LockoutDownstream)OTE(Lockout);']],
    dryRunRungs: [['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + C.OP + 'DryRunA) ,XIC(g_HMI_DryRun) ]OTE(DryRunUpstream);'], ['', '[XIC(' + C.OP + 'DryRunB) ,XIC(g_HMI_DryRun) ]OTE(DryRunDownstream);']],
  }));
  const cycleStation = (s) => '[XIC(' + NEST(s) + '.PartStatus.PartLoaded) [XIC(' + NEST(s) + '.PartStatus.Station[StaNumPre].Success) ,XIC(' + NEST(s) + '.PartStatus.Station[StaNumPre].Lockout) ] ,XIC(DryRun' + s + ') ][XIO(' + trk(s, 'Attempt') + ') OTE(CycleStationA' + s + ') ,OTE(CycleStationB' + s + ') ];';
  R01.push(['Cycle Station per nest side', cycleStation('Upstream')], ['', cycleStation('Downstream')], ...C.clearMomentary());

  const atX = (n) => 'XIC(XAxis_MAM.PC)XIC(' + n + '.InPos)', atZ = (n) => 'XIC(ZAxis_MAM.PC)XIC(' + n + '.InPos)';
  const R02 = [
    ...C.r02Head([]),
    ['State 4: Start of sequence, wait for the index with the head at pick', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[67]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Nests on station and spikes presented, close the funnel grippers on the tubes', st(4) + 'XIC(' + C.IDX + 'q_WaitStationsComplete)[XIC(WorkUpstream) ,XIC(WorkDownstream) ]XIC(PartsPresented)XIC(SS_OK)MOVE(7,Control.StateReg)XIO(SingleDisableTracking)[XIC(WorkUpstream) OTL(' + trk('Upstream', 'Attempt') + ') ,XIC(WorkDownstream) OTL(' + trk('Downstream', 'Attempt') + ') ];'],
    ['State 10: Lower the Z axis to pick while the escapement holds still', st(7) + 'XIC(FunnelGripperUpstreamClosed)XIC(FunnelGripperDownstreamClosed)XIC(EscapementSafeForPick)XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Close the spike grippers', st(10) + atZ('ZAxisPick') + 'XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Wait for the escapement to release the spikes', st(13) + everyHead((s) => 'XIC(SpikeGripper' + s + 'Closed)') + 'XIC(SS_OK)MOVE(16,Control.StateReg);'],
    ['State 19: Lift the spikes out of the escapement', st(16) + 'XIC(EscapementGrippersOpen)XIC(SS_OK)MOVE(19,Control.StateReg);'],
    ['State 22: X axis to the dispensers', st(19) + atZ('ZAxisRetract') + 'XIC(SS_OK)MOVE(22,Control.StateReg);'],
    ['State 25: Dispensers ready, lower the spikes into the solvent', st(22) + atX('XAxisDispense') + everyHead((s) => 'XIC(DispenseReady' + s + ')') + 'XIC(SS_OK)MOVE(25,Control.StateReg);'],
    ['State 28: Dwell in the dispensers while the wheel vibrates', st(25) + atZ('ZAxisDispense') + 'XIC(SS_OK)MOVE(28,Control.StateReg);'],
    ['State 31: Pull the spikes out of the dispensers with the X axis', st(28) + 'XIC(DispenseDwellDelay.DN)XIC(SS_OK)MOVE(31,Control.StateReg);'],
    ['State 34: Lift the Z axis clear of the dispensers', st(31) + atX('XAxisDispenseRetract') + 'XIC(SS_OK)MOVE(34,Control.StateReg);'],
    ['State 37: X axis to the pre-insert position', st(34) + atZ('ZAxisRetract') + 'XIC(SS_OK)MOVE(37,Control.StateReg);'],
    ['State 40: Lower the spikes to the tube height', st(37) + atX('XAxisPreInsert') + 'XIC(SS_OK)MOVE(40,Control.StateReg);'],
    ['State 43: Start the oscillation and push the spikes into the funnels', st(40) + atZ('ZAxisPlace') + 'XIC(SS_OK)MOVE(43,Control.StateReg);'],
    ['State 46: Open the funnel grippers', st(43) + atX('XAxisFunnelOpen') + 'XIC(SS_OK)MOVE(46,Control.StateReg);'],
    ['State 49: Push the spikes home on the tubes', st(46) + everyHead((s) => 'XIC(FunnelGripper' + s + 'Opened)') + 'XIC(SS_OK)MOVE(49,Control.StateReg);'],
    ['State 52: Jog on until the seating force is seen', st(49) + atX('XAxisInsert') + 'XIO(DisableSeatJog)XIC(SS_OK)MOVE(52,Control.StateReg);'],
    ['State 55: Judge the insertion and home the spindle', '[' + st(49) + ' ' + atX('XAxisInsert') + ' XIC(DisableSeatJog) ,' + st(52) + ' XIC(SeatJogDone) XIO(XAxisSeat_MAJ.IP) ]XIC(SS_OK)MOVE(55,Control.StateReg);'],
    ['State 58: Open the spike grippers', st(55) + 'XIC(RAxis_MAM.PC)XIC(RAxisHome.InPos)XIC(SS_OK)MOVE(58,Control.StateReg);'],
    ['State 61: Lift the Z axis clear of the tubes', st(58) + everyHead((s) => 'XIC(SpikeGripper' + s + 'Opened)') + 'XIC(SS_OK)MOVE(61,Control.StateReg);'],
    ['State 64: X axis back to pick', st(61) + atZ('ZAxisRetract') + 'XIC(SS_OK)MOVE(64,Control.StateReg);'],
    ['State 67: Cycle Complete', st(64) + atX('XAxisPick') + 'MOVE(67,Control.StateReg);'],
    ...C.r02Tail(),
    ['State 100:Start of initialization sequence, open the spike grippers', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization retract the Z axis', st(100) + 'XIC(SpikeGripperUpstreamOpened)XIC(SpikeGripperDownstreamOpened)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 106: Initialization spindle home', st(103) + atZ('ZAxisRetract') + 'XIC(SS_OK)MOVE(106,Control.StateReg);'],
    ['State 109: Initialization open the funnel grippers', st(106) + 'XIC(RAxis_MAM.PC)XIC(RAxisHome.InPos)XIC(SS_OK)MOVE(109,Control.StateReg);'],
    ['State 112: Initialization X axis to pick', st(109) + 'XIC(FunnelGripperUpstreamOpened)XIC(FunnelGripperDownstreamOpened)XIC(SS_OK)MOVE(112,Control.StateReg);'],
    ['State 124: Initialization complete', st(112) + atX('XAxisPick') + 'MOVE(124,Control.StateReg);'],
    ...C.r02End(),
  ];

  const F = (s) => 'ForceFilter' + s + '.Average';
  const perf = (s) => 'XIC(g_MachineBasic.AlwaysOn)StationPerformance(StationPerformance' + s + ',' + trk(s, 'Attempt') + ',' + trk(s, 'Success') + ',g_PresetStationPerformLow,g_PresetStationPerformHigh,\\L2_Tracking.p_Data.Station[StaNum].PerformData.Attempts' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Successes' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Failures' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.Efficiency' + AB[s] + ',\\L2_Tracking.p_Data.Station[StaNum].PerformData.HMIColorStatus' + AB[s] + ');';
  const inWindow = 'CMP(iq_XAxis.ActualPosition <= HMI_XAxis.Parameters.Positions[5] + HMI_SeatWindow)';
  const R03 = [
    ...C.r03Head(AX.map(([a]) => 'XIC(iq_' + a + '.ServoActionStatus)XIC(iq_' + a + '.AxisHomedStatus)').join(''), ['A', 'B'], true),
    ['Actuators Safe For Index: funnels open and the head away from the tubes', 'XIC(FunnelGripperUpstreamOpened)XIC(FunnelGripperDownstreamOpened)[XIC(iq_XAxis.AxisHomedStatus) [XIC(XAxisPick.InPos) ,XIC(XAxisDispense.InPos) ] ,XIC(iq_ZAxis.AxisHomedStatus) XIC(ZAxisRetract.InPos) ]OTE(q_ActuatorsSafe);'],
    ['Pause Request To Indexer: starved of spikes', 'XIC(Alarm[0].Active)OTE(q_Pause);'],
    ['Heads working this cycle: a nest with a part, not locked out, a spike presented for it', '[XIC(Status.State[4]) XIC(CycleStationAUpstream) XIO(LockoutUpstream) XIC(PartLoadedUpstream) ,XIC(WorkUpstream) XIO(Status.State[1]) XIO(Status.State[2]) XIO(Status.State[3]) XIO(Status.State[67]) XIO(Status.State[127]) ]OTE(WorkUpstream);'],
    ['', '[XIC(Status.State[4]) XIC(CycleStationADownstream) XIO(LockoutDownstream) XIC(PartLoadedDownstream) ,XIC(WorkDownstream) XIO(Status.State[1]) XIO(Status.State[2]) XIO(Status.State[3]) XIO(Status.State[67]) XIO(Status.State[127]) ]OTE(WorkDownstream);'],
    ['Holding a spike from the pick until it is released on the tube', '[XIC(Status.State[16]) XIC(WorkUpstream) ,XIC(HoldingPartUpstream) XIO(Status.State[58]) XIO(Status.State[100]) XIO(Status.State[127]) ]OTE(HoldingPartUpstream);'],
    ['', '[XIC(Status.State[16]) XIC(WorkDownstream) ,XIC(HoldingPartDownstream) XIO(Status.State[58]) XIO(Status.State[100]) XIO(Status.State[127]) ]OTE(HoldingPartDownstream);'],
    ['Spike released at initialization fails its nest', 'XIC(Status.State[100])ONS(ONS.5)XIO(SingleDisableTracking)[XIC(HoldingPartUpstream) OTL(' + trk('Upstream', 'Failure') + ') MOVE(45,' + NEST('Upstream') + '.PartStatus.FailureType) ,XIC(HoldingPartDownstream) OTL(' + trk('Downstream', 'Failure') + ') MOVE(45,' + NEST('Downstream') + '.PartStatus.FailureType) ];'],
    ['Set Part Tracking If Station Or Side Is Locked Out', 'XIC(' + C.IDX + 'q_WaitStationsComplete)[XIC(Status.State[99]) ,XIC(LockoutUpstream) ]XIC(' + NEST('Upstream') + '.PartStatus.PartLoaded)OTL(' + trk('Upstream', 'Lockout') + ');'],
    ['', 'XIC(' + C.IDX + 'q_WaitStationsComplete)[XIC(Status.State[99]) ,XIC(LockoutDownstream) ]XIC(' + NEST('Downstream') + '.PartStatus.PartLoaded)OTL(' + trk('Downstream', 'Lockout') + ');'],
    ['Station Complete', 'XIC(' + C.IDX + 'q_WaitStationsComplete)' + SIDES.map((s) => '[XIC(CycleStationB' + s + ') [XIC(' + trk(s, 'Success') + ') ,XIC(' + trk(s, 'Failure') + ') ,XIC(' + trk(s, 'Lockout') + ') ] ,XIO(CycleStationB' + s + ') ]').join('') + 'OTE(q_StationComplete);'],
    ['Dispense dwell', st(28) + 'TON(DispenseDwellDelay,?,?);'],
    ['Oscillate the spindle while inserting', states([43, 46, 49, 52]) + 'OTE(Oscillating);'],
  ];
  SIDES.forEach((s, i) => {
    R03.push([i === 0 ? 'Force watch while inserting: engaged, over force, seated early, seated' : '', states([43, 46, 49, 52]) + 'XIC(Work' + s + ')GE(' + F(s) + ',HMI_EngageForce)OTL(Engaged' + s + ');']);
    R03.push(['', states([43, 46, 49, 52]) + 'XIC(Work' + s + ')GT(' + F(s) + ',HMI_ForceMax)OTL(OverForce' + s + ');']);
    R03.push(['', states([43, 46, 49]) + 'XIC(Work' + s + ')GE(' + F(s) + ',HMI_SeatForce)CMP(iq_XAxis.ActualPosition < HMI_XAxis.Parameters.Positions[5] - HMI_SeatWindow)OTL(SeatedEarly' + s + ');']);
    R03.push(['', st(52) + 'XIC(Work' + s + ')GE(' + F(s) + ',HMI_SeatForce)OTL(Seated' + s + ');']);
  });
  R03.push(['', st(4) + SIDES.map((s) => 'OTU(Engaged' + s + ')OTU(OverForce' + s + ')OTU(Seated' + s + ')OTU(SeatedEarly' + s + ')').join('') + ';']);
  R03.push(['Seat jog done: every working side seated, or the jog limit reached', st(52) + '[' + everyHead((s) => 'XIC(Seated' + s + ')') + ' ,GE(iq_XAxis.ActualPosition,HMI_XAxis.Parameters.Positions[6]) ]OTE(SeatJogDone);']);
  SIDES.forEach((s, i) => {
    const FT = NEST(s) + '.PartStatus.FailureType';
    R03.push([i === 0 ? 'Judge each insertion once at state 55' : '',
      st(55) + 'ONS(ONS.' + (6 + i) + ')XIC(Work' + s + ')XIO(SingleDisableTracking)XIC(Engaged' + s + ')XIO(OverForce' + s + ')XIO(SeatedEarly' + s + ')[XIC(DisableSeatJog) ,XIC(Seated' + s + ') ' + inWindow + ' ]OTL(' + trk(s, 'Success') + ')MOVE(0,ConsecFails.Count);']);
    R03.push(['', st(55) + 'ONS(ONS.' + (8 + i) + ')XIC(Work' + s + ')XIO(SingleDisableTracking)[XIO(Engaged' + s + ') MOVE(41,' + FT + ') ,XIC(Engaged' + s + ') XIC(OverForce' + s + ') MOVE(42,' + FT + ') ,XIC(Engaged' + s + ') XIO(OverForce' + s + ') XIC(SeatedEarly' + s + ') MOVE(43,' + FT + ') ,XIC(Engaged' + s + ') XIO(OverForce' + s + ') XIO(SeatedEarly' + s + ') XIO(DisableSeatJog) [XIO(Seated' + s + ') ,CMP(iq_XAxis.ActualPosition > HMI_XAxis.Parameters.Positions[5] + HMI_SeatWindow) ] MOVE(44,' + FT + ') ]OTL(' + trk(s, 'Failure') + ')ADD(ConsecFails.Count,1,ConsecFails.Count);']);
  });
  R03.push(['Handshake to the escapement and the dispensers', 'LIMIT(16,Control.StateReg,64)OTE(p_PartsPicked);']);
  R03.push(['', '[XIC(iq_ZAxis.AxisHomedStatus) XIC(ZAxisRetract.InPos) ,XIC(iq_XAxis.AxisHomedStatus) XIO(XAxisPick.InPos) ]OTE(p_PnpClearOfEscapement);']);
  R03.push(['', states([25, 28]) + 'OTE(p_DispenseRequest);']);
  R03.push(['', '[XIC(XAxisDispenseRetract.InPos) ,XIC(ZAxisRetract.InPos) ]XIO(Status.State[25])XIO(Status.State[28])OTE(p_SpikeOutOfDispenser);']);
  SIDES.forEach((s, i) => {
    const b = i * 2, f = 4 + i * 2;
    R03.push(['Spike Gripper ' + s + ' Control: closed at pick, opened once seated on the tube', outputRung('q_CloseSpikeGripper' + s, st(13) + ' XIC(Work' + s + ')', 'XIO(Status.State[58]) XIO(Status.State[100])', b, b + 1)]);
    R03.push(['', outputRung('q_OpenSpikeGripper' + s, states([58, 100]), '[XIO(Status.State[13]) ,XIO(Work' + s + ') ]', b + 1, b)]);
    R03.push(['Funnel Gripper ' + s + ' Control: closed on the tube after the index, opened as the spike starts on', outputRung('q_CloseFunnelGripper' + s, st(7), 'XIO(Status.State[46]) XIO(Status.State[109])', f, f + 1)]);
    R03.push(['', outputRung('q_OpenFunnelGripper' + s, states([46, 109]), 'XIO(Status.State[7])', f + 1, f)]);
  });
  R03.push(['Station Performance per nest side', perf('Upstream')], ['', perf('Downstream')]);

  const R04 = V.servoRoutine('XAxis', {
    permissive: 'XIC(iq_ZAxis.AxisHomedStatus)XIO(ZAxisPick.InPos)', manual: ['Pick', 'Dispense', 'DispenseRetract', 'PreInsert', 'FunnelOpen', 'Insert', 'SeatLimit'],
    autoComment: 'Auto Mode - 0 pick, 1 dispense, 2 pull-out, 3 pre-insert, 4 funnel open, 5 insert (AutoSpeed[1])',
    auto: [V.autoBranch('XAxis', [22], 1), V.autoBranch('XAxis', [31], 2), V.autoBranch('XAxis', [37], 3), V.autoBranch('XAxis', [43], 4, 1), V.autoBranch('XAxis', [49], 5, 1), V.autoBranch('XAxis', [64, 112], 0)].join(' ,'),
    mamGate: states([22, 31, 37, 43, 49, 64, 112]), ranges: xr,
    extra: [
      ['Auto Jog Axis: seat the spike until the force rises or the jog limit is reached', 'XIO(Status.State[1])XIC(Status.State[52])XIO(SeatJogDone)XIC(XAxisPermissive)XIC(iq_XAxis.ServoActionStatus)XIO(iq_XAxis.JogStatus)XIO(iq_XAxis.MoveStatus)MAJ(iq_XAxis,XAxisSeat_MAJ,0,HMI_XAxis.Parameters.AutoSpeed[1],Units per sec,HMI_XAxis.Parameters.Accel[0],Units per sec2,HMI_XAxis.Parameters.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None);'],
      ['', '[XIC(SeatJogDone) ,XIO(Status.State[52]) ]XIC(XAxisSeat_MAJ.IP)MAS(iq_XAxis,XAxisSeat_MAS,Jog,Yes,HMI_XAxis.Parameters.Decel[0],Units per sec2,No,0,Units per sec3);'],
    ],
  });
  const R05 = V.servoRoutine('ZAxis', {
    permissive: 'XIC(g_MachineBasic.AlwaysOn)', manual: ['Pick', 'Dispense', 'Place', 'Retract'], manualGate: { 0: 'XIC(EscapementSafeForPick) ' },
    autoComment: 'Auto Mode - 0 pick, 1 dispense, 2 place, 3 retract',
    auto: [V.autoBranch('ZAxis', [10], 0), V.autoBranch('ZAxis', [25], 1), V.autoBranch('ZAxis', [40], 2), V.autoBranch('ZAxis', [19, 34, 61, 103], 3)].join(' ,'),
    mamGate: '[' + st(10) + ' XIC(EscapementSafeForPick) ,' + states([19, 25, 34, 40, 61, 103]) + ' ]', ranges: zr,
  });
  const R06 = V.servoRoutine('RAxis', {
    permissive: 'XIC(g_MachineBasic.AlwaysOn)', manual: ['Home', 'OscillatePositive', 'OscillateNegative'], homeDirection: 0,
    before: [['Oscillation: swap the target each time a swing completes', 'XIC(Oscillating)XIC(RAxis_MAM.PC)ONS(RAxisONS.7)SUB(1,OscillateDirection,OscillateDirection);'],
      ['', 'XIO(Oscillating)MOVE(0,OscillateDirection);']],
    autoComment: 'Auto Mode - 0 home, 1 and 2 the oscillation swings while inserting',
    auto: [V.autoBranch('RAxis', [55, 106], 0), 'XIC(Oscillating) EQ(OscillateDirection,0) MOVE(HMI_RAxis.Parameters.Positions[1],RAxisMotionParameters.Position)', 'XIC(Oscillating) EQ(OscillateDirection,1) MOVE(HMI_RAxis.Parameters.Positions[2],RAxisMotionParameters.Position)'].join(' ,'),
    mamGate: '[' + states([55, 106]) + ' ,XIC(Oscillating) XIO(RAxis_MAM.IP) ]', ranges: rr,
  });

  const A = 'AlarmONS.';
  const failWarn = (i, s, code) => warnAlarm(i, st(58) + 'XIC(Work' + s + ')EQ(' + NEST(s) + '.PartStatus.FailureType,' + code + ')', A + i);
  const R20 = [
    ...servo.rungs,
    [alarms[0], warnAlarm(0, st(4) + 'XIC(' + C.IDX + 'q_WaitStationsComplete)[XIC(CycleStationAUpstream) ,XIC(CycleStationADownstream) ]XIO(PartsPresented)MOVE(30000,Control.FaultTime)XIC(Status.TimeoutFlt)', A + 0)],
    [alarms[1], waitAlarm(1, [10], 3000, 'XIO(ZAxisPick.InPos) ', A + 1)],
    [alarms[2], waitAlarm(2, [16], 5000, 'XIO(EscapementGrippersOpen) ', A + 2)],
    [alarms[3], waitAlarm(3, [19, 34, 61, 103], 3000, 'XIO(ZAxisRetract.InPos) ', A + 3)],
    [alarms[4], waitAlarm(4, [22], 5000, 'XIO(XAxisDispense.InPos) ', A + 4)],
    [alarms[5], waitAlarm(5, [22], 10000, 'XIC(WorkUpstream) XIO(DispenseReadyUpstream) ', A + 5)],
    [alarms[6], waitAlarm(6, [22], 10000, 'XIC(WorkDownstream) XIO(DispenseReadyDownstream) ', A + 6)],
    [alarms[7], waitAlarm(7, [25], 3000, 'XIO(ZAxisDispense.InPos) ', A + 7)],
    [alarms[8], waitAlarm(8, [31], 3000, 'XIO(XAxisDispenseRetract.InPos) ', A + 8)],
    [alarms[9], waitAlarm(9, [37], 5000, 'XIO(XAxisPreInsert.InPos) ', A + 9)],
    [alarms[10], waitAlarm(10, [40], 3000, 'XIO(ZAxisPlace.InPos) ', A + 10)],
    [alarms[11], waitAlarm(11, [43], 3000, 'XIO(XAxisFunnelOpen.InPos) ', A + 11)],
    [alarms[12], waitAlarm(12, [49], 3000, 'XIO(XAxisInsert.InPos) ', A + 12)],
    [alarms[13], waitAlarm(13, [52], 5000, 'XIO(SeatJogDone) ', A + 13)],
    [alarms[14], waitAlarm(14, [55, 106], 5000, 'XIO(RAxisHome.InPos) ', A + 14)],
    [alarms[15], waitAlarm(15, [64, 112], 10000, 'XIO(XAxisPick.InPos) ', A + 15)],
    [alarms[16], failWarn(16, 'Upstream', 41)], [alarms[17], failWarn(17, 'Downstream', 41)],
    [alarms[18], failWarn(18, 'Upstream', 42)], [alarms[19], failWarn(19, 'Downstream', 42)],
    [alarms[20], failWarn(20, 'Upstream', 43)], [alarms[21], failWarn(21, 'Downstream', 43)],
    [alarms[22], failWarn(22, 'Upstream', 44)], [alarms[23], failWarn(23, 'Downstream', 44)],
    [alarms[24], warnAlarm(24, st(100) + 'XIC(HoldingPartUpstream)', A + 24)], [alarms[25], warnAlarm(25, st(100) + 'XIC(HoldingPartDownstream)', A + 25)],
    [alarms[26], sealedAlarm(26, 'GT(ConsecFails.Count,ConsecFails.Setpoint)', A + 26)],
    ['', 'XIC(Alarm[26].Active)MOVE(0,ConsecFails.Count);'],
    [alarms[27], waitAlarm(27, [7], 5000, 'XIO(EscapementSafeForPick) ', A + 27)],
    ...C.r20Tail(true),
  ];
  return H.programXml(PROG, tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 },
    { name: 'R04_XAxisServo', rungs: R04 }, { name: 'R05_ZAxisServo', rungs: R05 }, { name: 'R06_RAxisServo', rungs: R06 }, { name: 'R20_Alarms', rungs: R20 }]);
}
module.exports = { PROG, build };
