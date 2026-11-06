'use strict';
// L2_S04_Dispenser{Upstream,Downstream} — one Marposs Dosaset DST503 each, 4 in / 4 out on VB1's EX600-DMPF.
// DST manual rev. 20260930 ch. 13: PLC mode entry (wait READY + no ALARM, RESET >= 100 ms, START >= 100 ms, wheel to IN1/IN2),
// work cycle (START high >= 500 ms while the part sits in the bushing, drop START once it is out, wheel turns, READY returns).
// Self-actuated follower form (L2_S01 Dereeler): no tracking, reads Station[4].OpStatus of its side.
const H = require('../l5xBuild.cjs');
const C = require('./common.cjs');
const { st, states, waitAlarm, sealedAlarm } = H;
const PNP = '\\L2_S04_SpikePNP.';

function build({ S01, PREFIX, STA, side }) {
  const PROG = 'L2_S04_Dispenser' + side, AB = side === 'Upstream' ? 'A' : 'B';
  const stateComments = { ...C.baseStates, 4: 'Wait For Dispense Request', 7: 'Start Dispense', 10: 'Wait For Spike Out', 13: 'Wait For Dispenser Ready', 16: 'Cycle Complete',
    100: 'Initialization Wait For Dispenser', 103: 'Initialization Reset Pulse', 106: 'Initialization Start Pulse', 109: 'Initialization Wait For Adapter' };
  const alarms = ['Dispenser ' + side + ' Alarm', 'Waiting For Dispenser ' + side + ' Ready', 'Waiting For Spike Out Of Dispenser ' + side, 'Dispenser ' + side + ' Adapter Mismatch'];
  const tags = [
    ...C.engineTags(S01, PREFIX, stateComments, alarms, []),
    H.boolTag('i_AdapterBit0', { usage: 'Input', desc: 'Adapter Echo Bit 0' }), H.boolTag('i_AdapterBit1', { usage: 'Input', desc: 'Adapter Echo Bit 1' }),
    H.boolTag('i_DispenserReady', { usage: 'Input', desc: 'Dispenser Ready' }), H.boolTag('i_DispenserAlarmOK', { usage: 'Input', desc: 'Dispenser Alarm Output' }),
    H.boolTag('q_AdapterBit0', { usage: 'Output', desc: 'Adapter Select Bit 0' }), H.boolTag('q_AdapterBit1', { usage: 'Output', desc: 'Adapter Select Bit 1' }),
    H.boolTag('q_DispenserStart', { usage: 'Output', desc: 'Dispenser Start' }), H.boolTag('q_DispenserReset', { usage: 'Output', desc: 'Dispenser Reset' }),
    H.boolTag('p_DispenseReady', { usage: 'Public', desc: 'Ready For A Dip' }), H.boolTag('p_DispenseComplete', { usage: 'Public', desc: 'Dip Done, Wheel Turning' }),
    H.dintTag('HMI_AdapterPosition', 1, { desc: 'Adapter Position 1-4' }), H.boolTag('AdapterAtPosition'), H.boolTag('PlcModeEntered'), H.boolTag('DispenseRequest'), H.boolTag('SpikeOut'), H.boolTag('DryRun'),
    H.timerTag('StartMinDelay', 500, 'Start Held Minimum'), H.timerTag('ResetPulseDelay', 100, 'Reset Pulse'), H.timerTag('StartPulseDelay', 100, 'Start Pulse'),
    H.timerTag('ManualStartDelay', 500, 'Manual Start Pulse'), H.timerTag('ManualResetDelay', 200, 'Manual Reset Pulse'),
    H.dintCommentTag('HMI_Momentary', [[0, 'Dispenser Start'], [1, 'Dispenser Reset']]),
  ];
  const R00 = [['Subroutine Calls', 'JSR(R01_Inputs,0);'], ['', 'JSR(R02_StateTransitions,0);'], ['', 'JSR(R03_StateLogic,0);'], ['', 'JSR(R20_Alarms,0);']];
  const R01 = [
    ['Station Number', 'MOVE(' + STA + ',StaNum);'],
    ['Adapter echo matches the selected adapter', '[XIC(q_AdapterBit0) XIC(i_AdapterBit0) ,XIO(q_AdapterBit0) XIO(i_AdapterBit0) ][XIC(q_AdapterBit1) XIC(i_AdapterBit1) ,XIO(q_AdapterBit1) XIO(i_AdapterBit1) ]OTE(AdapterAtPosition);'],
    ['Dip request and spike out from the pick and place', 'XIC(' + PNP + 'p_DispenseRequest)OTE(DispenseRequest);'],
    ['', 'XIC(' + PNP + 'p_SpikeOutOfDispenser)OTE(SpikeOut);'],
    ...C.logicInputs({ sides: [AB], dial: false, initialized: 'XIC(PlcModeEntered)XIC(i_DispenserReady)XIC(i_DispenserAlarmOK)XIC(AdapterAtPosition)',
      lockoutRungs: [['Lockout', 'XIC(' + C.OP + 'Lockout' + AB + ')XIO(ManualMode)OTE(Lockout);']],
      dryRunRungs: [['Dry run logic (can add supervisor dry run condition if needed as parallel branch)', '[XIC(' + C.OP + 'DryRun' + AB + ') ,XIC(g_HMI_DryRun) ]OTE(DryRun);']] }),
    ...C.clearMomentary(),
  ];
  const R02 = [
    ...C.r02Head([13]),
    ['State 4: Start of sequence, wait for the pick and place to dip a spike', '[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[16]) ,XIC(Status.State[124]) ]XIC(CycleRunning)XIO(Lockout)MOVE(4,Control.StateReg);'],
    ['State 7: Spike in the bushing, raise START and vibrate', st(4) + 'XIC(DispenseRequest)XIC(i_DispenserReady)XIC(SS_OK)MOVE(7,Control.StateReg);'],
    ['State 10: Hold START until the spike is pulled out', st(7) + 'XIC(StartMinDelay.DN)XIC(SS_OK)MOVE(10,Control.StateReg);'],
    ['State 13: Drop START, the wheel turns to refresh the adapter', st(10) + 'XIC(SpikeOut)XIC(SS_OK)MOVE(13,Control.StateReg);'],
    ['State 16: Cycle Complete', st(13) + 'XIO(q_DispenserStart)XIC(i_DispenserReady)MOVE(16,Control.StateReg);'],
    ...C.r02Tail(),
    ['State 100:Start of initialization sequence, wait for the dispenser', 'XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);'],
    ['State 103: Initialization RESET pulse to enter PLC mode', st(100) + 'XIC(i_DispenserReady)XIC(i_DispenserAlarmOK)XIC(SS_OK)MOVE(103,Control.StateReg);'],
    ['State 106: Initialization START pulse, wheel to the selected adapter', st(103) + 'XIC(ResetPulseDelay.DN)XIC(SS_OK)MOVE(106,Control.StateReg);'],
    ['State 109: Initialization wait for the adapter in the working position', st(106) + 'XIC(StartPulseDelay.DN)XIC(SS_OK)MOVE(109,Control.StateReg);'],
    ['State 124: Initialization complete', st(109) + 'XIC(i_DispenserReady)XIC(AdapterAtPosition)MOVE(124,Control.StateReg);'],
    ...C.r02End(),
  ];
  const R03 = [
    ...C.r03Head('XIC(i_DispenserReady)XIC(i_DispenserAlarmOK)', [AB], false),
    ['Adapter select from the HMI position 1-4 (IN1 = bit 0, IN2 = bit 1)', '[EQ(HMI_AdapterPosition,2) ,EQ(HMI_AdapterPosition,4) ]OTE(q_AdapterBit0);'],
    ['', '[EQ(HMI_AdapterPosition,3) ,EQ(HMI_AdapterPosition,4) ]OTE(q_AdapterBit1);'],
    ['Pulse and hold timers', st(7) + 'TON(StartMinDelay,?,?);'], ['', st(103) + 'TON(ResetPulseDelay,?,?);'], ['', st(106) + 'TON(StartPulseDelay,?,?);'],
    ['', 'XIC(Status.State[1])XIC(q_DispenserStart)TON(ManualStartDelay,?,?);'], ['', 'XIC(Status.State[1])XIC(q_DispenserReset)TON(ManualResetDelay,?,?);'],
    ['Dispenser START: held through the dip, pulsed to enter PLC mode', '[XIO(Status.State[1]) [' + states([7, 10]) + ' ,' + st(106) + ' XIO(StartPulseDelay.DN) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.0) ,XIC(q_DispenserStart) XIO(ManualStartDelay.DN) ] ]XIC(SafetyOK)XIO(q_DispenserReset)OTE(q_DispenserStart);'],
    ['Dispenser RESET: pulsed to enter PLC mode', '[XIO(Status.State[1]) ' + st(103) + ' XIO(ResetPulseDelay.DN) ,XIC(Status.State[1]) [XIC(HMI_Momentary.1) ,XIC(q_DispenserReset) XIO(ManualResetDelay.DN) ] ]XIC(SafetyOK)OTE(q_DispenserReset);'],
    ['PLC mode entered, held until the dispenser reboots with both outputs low', '[' + st(109) + ' XIC(i_DispenserReady) XIC(AdapterAtPosition) ,XIC(PlcModeEntered) [XIC(i_DispenserReady) ,XIC(i_DispenserAlarmOK) ] ]XIO(g_MachineBasic.PowerUpCP)OTE(PlcModeEntered);'],
    ['Handshake to the pick and place', st(4) + 'XIC(Initialized)OTE(p_DispenseReady);'],
    ['', states([13, 16]) + 'OTE(p_DispenseComplete);'],
  ];
  const A = 'AlarmONS.';
  const R20 = [
    [alarms[0], sealedAlarm(0, 'XIC(SafetyOK)XIC(g_MachineBasic.PowerUpCP)XIO(i_DispenserAlarmOK)', A + 0)],
    [alarms[1], waitAlarm(1, [13, 100, 109], 10000, 'XIO(i_DispenserReady) ', A + 1)],
    [alarms[2], waitAlarm(2, [10], 10000, '', A + 2)],
    [alarms[3], waitAlarm(3, [4, 109], 5000, 'XIO(AdapterAtPosition) ', A + 3)],
    ...C.r20Tail(false),
  ];
  return { PROG, xml: H.programXml(PROG, tags, [{ name: 'R00_Main', rungs: R00 }, { name: 'R01_Inputs', rungs: R01 }, { name: 'R02_StateTransitions', rungs: R02 }, { name: 'R03_StateLogic', rungs: R03 }, { name: 'R20_Alarms', rungs: R20 }]) };
}
module.exports = { build };
