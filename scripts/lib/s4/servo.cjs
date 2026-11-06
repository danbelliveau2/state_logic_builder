'use strict';
// S05_ServoPNP servo form (R04 / R05) as shipped in 1163 L2_S10 (Jason-corrected): one routine per axis, tags per axis.
const H = require('../l5xBuild.cjs');
const { legs } = H;

// program tags for one axis; S01 = L2_S01_TubeFeedUpstream body (template forms), S05 = V5.4 S05_ServoPNP body (range-check form)
function servoTags(S01, S05, a, { label, positions = [], homeSelect = 1, ranges = [], extraMotion = [] }) {
  const short = label.replace(' Axis', '');
  const t = [
    '<Tag Name="iq_' + a + '" TagType="Base" DataType="AXIS_CIP_DRIVE" Usage="InOut" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    H.hmiAxisTag(S01, 'HMI_FeedAxis', 'HMI_' + a, positions), H.boolTag(a + 'AutoEnable'), H.copyTag(S01, 'FeedAxisEnableDelay', a + 'EnableDelay', short + ' Enable Delay'),
    H.stringTag(a + 'Fault'), H.stringTag(a + 'FaultMessage'), H.boolTag(a + 'HomeConfimed'), H.copyTag(S01, 'FeedAxisHomeConfirmDelay', a + 'HomeConfirmDelay', short + ' Home Confirm'),
    H.boolTag(a + 'HomeRequested'), H.boolTag(a + 'HomeSelect', { value: homeSelect }), H.realTag(a + 'InchAmount', 0), H.dintTag(a + 'JogDirection', 0),
    H.boolTag(a + 'ManMoveTrig'), H.copyTag(S01, 'FeedAxisMotionParameters', a + 'MotionParameters', ''), H.dintTag(a + 'ONS', 0), H.boolTag(a + 'Permissive'), H.boolTag(a + 'Ready'),
    H.copyTag(S01, 'FeedAxisTorqueHome', a + 'TorqueHome', ''),
    ...['_Inch', '_MAFR', '_MAH', '_MAJ', '_MAM', '_MASR', '_MAS_All', '_MAS_Jog', '_MSF', '_MSO', ...extraMotion].map((s) => H.copyTag(S01, 'FeedAxis_MAM', a + s, '')),
    ...ranges.map(([n, , , desc]) => H.copyTag(S05, 'XAxisExtend', n, desc)),
  ];
  return t;
}

// o: permissive, manual [names], manualGate {i: fragment}, moveType, autoComment, auto (branches), mamGate, ranges [[name, idx, wide]], extra rungs, before rungs
function servoRoutine(a, o) {
  const A = 'iq_' + a, HM = 'HMI_' + a, P = HM + '.Parameters', ST = HM + '.Status', CT = HM + '.Control', MP = a + 'MotionParameters';
  const r = [
    ['Axis Is Ready For Operation', 'XIC(MotionGroup.GroupSynced)XIO(' + A + '.SafeTorqueOffActiveInhibit)OTE(' + a + 'Ready);'],
    ['', 'XIC(SafetyOK)XIC(' + a + 'Ready)TON(' + a + 'EnableDelay,?,?)XIC(' + a + 'EnableDelay.DN)ONS(' + a + 'ONS.0)OTE(' + a + 'AutoEnable);'],
    ['Axis Motion Permissive (Add more conditions if necessary. Permissive should be based on the physical state of itself potentially interfering devices)', o.permissive + 'OTE(' + a + 'Permissive);'],
    ['Enable Axis', '[XIC(Status.State[1]) XIC(' + CT + '.Enable) XIC(' + a + 'Ready) ,XIC(' + a + 'AutoEnable) ]XIO(' + A + '.ServoActionStatus)MSO(' + A + ',' + a + '_MSO);'],
    ['Disable Axis', 'XIC(Status.State[1])XIC(' + CT + '.Disable)MSF(' + A + ',' + a + '_MSF);'],
    ['Fault Reset Axis', 'NE(' + A + '.AxisFault,0)XIC(FaultReset)[XIO(' + A + '.ShutdownStatus) MAFR(' + A + ',' + a + '_MAFR) ,XIC(' + A + '.ShutdownStatus) MASR(' + A + ',' + a + '_MASR) ];'],
    ['Jog Axis', 'XIC(Status.State[1])XIC(' + a + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)[XIC(' + CT + '.JogPositive) XIO(' + CT + '.JogNegative) MOVE(0,' + a + 'JogDirection) ,XIC(' + CT + '.JogNegative) XIO(' + CT + '.JogPositive) MOVE(1,' + a + 'JogDirection) ]MAJ(' + A + ',' + a + '_MAJ,' + a + 'JogDirection,' + P + '.JogSpeed,Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None);'],
    ['', 'XIC(' + a + '_MAJ.IP)XIO(' + CT + '.JogPositive)XIO(' + CT + '.JogNegative)MAS(' + A + ',' + a + '_MAS_Jog,Jog,Yes,' + P + '.Decel[0],Units per sec2,No,0,Units per sec3);'],
    ['Inch Axis', 'XIC(Status.State[1])[XIC(' + CT + '.InchPositive) ONS(' + a + 'ONS.1) MOVE(' + P + '.InchAmount,' + a + 'InchAmount) ,XIC(' + CT + '.InchNegative) ONS(' + a + 'ONS.2) NEG(' + P + '.InchAmount,' + a + 'InchAmount) ]XIC(' + a + 'Permissive)XIC(' + A + '.ServoActionStatus)XIO(' + A + '.JogStatus)XIO(' + A + '.MoveStatus)MAM(' + A + ',' + a + '_Inch,1,' + a + 'InchAmount,' + P + '.ManualSpeed,Units per sec,' + P + '.Accel[0],Units per sec2,' + P + '.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);'],
    ['Home Axis', 'XIC(Status.State[1])[XIC(' + CT + '.HomeRequest) ONS(' + a + 'ONS.3) XIO(' + a + 'TorqueHome.IP) ,XIC(' + a + 'HomeRequested) XIO(' + a + 'HomeConfirmDelay.DN) XIO(' + a + 'HomeConfimed) ]XIC(' + a + 'Ready)[OTE(' + a + 'HomeRequested) ,TON(' + a + 'HomeConfirmDelay,?,?) ];'],
    ['', 'XIC(Status.State[1])[XIC(' + CT + '.HomeConfirm) ONS(' + a + 'ONS.4) ,XIC(' + a + 'HomeConfimed) XIC(' + a + 'HomeSelect) XIO(' + a + 'TorqueHome.PC) XIO(' + a + 'TorqueHome.Error) ]OTE(' + a + 'HomeConfimed);'],
    ['Home Select = 0 is for Immediate Home (Example, servo indexer) Home Select = 1 is for Home To Torque (Example, PNP)  Homing Torque = Start at 25%, Increase In 5% Increments If Not Enough Run Torque = Normal Running Torque Of Axis Homing Speed = Homing Speed in units/s Overtorque Limit = Set The Same As Homing Torque Home Offset Distance = Distance Moved Off Of Hard Stop When Homing Complete Home Direction = 0 Is Positive, 1 Is Negative', 'XIC(' + a + 'HomeConfimed)[XIO(' + a + 'HomeSelect) MAH(' + A + ',' + a + '_MAH) ,XIC(' + a + 'HomeSelect) AOI_TorqueHome(' + a + 'TorqueHome,' + A + ',25.0,100.0,5.0,25.0,0.5,' + (o.homeDirection == null ? 1 : o.homeDirection) + ') ];'],
    ['', '[XIC(' + a + 'HomeRequested) OTE(' + ST + '.HomeRequested) ,[XIC(' + a + 'TorqueHome.IP) ,XIC(' + a + '_MAH.IP) ] OTE(' + ST + '.HomeInProcess) ,[XIC(' + a + 'TorqueHome.PC) ,XIC(' + a + '_MAH.PC) ] OTE(' + ST + '.HomeComplete) ];'],
    ['Manual Mode', 'XIC(SafetyOK)XIC(Status.State[1])[[MOVE(0,' + MP + '.MoveType) ,MOVE(' + P + '.ManualSpeed,' + MP + '.Speed) ,MOVE(' + P + '.Accel[0],' + MP + '.Accel) ,MOVE(' + P + '.Decel[0],' + MP + '.Decel) ] ,XIC(' + a + 'Permissive) ' + legs(o.manual.map((name, i) => 'XIC(' + CT + '.ManMoves.' + i + ') ' + ((o.manualGate || {})[i] || '') + 'MOVE(' + P + '.Positions[' + i + '],' + MP + '.Position)')) + ' OTE(' + a + 'ManMoveTrig) ];'],
    ...(o.before || []),
    [o.autoComment, 'XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,' + MP + '.MoveType) ,MOVE(' + P + '.AutoSpeed[0],' + MP + '.Speed) ,MOVE(' + P + '.Accel[0],' + MP + '.Accel) ,MOVE(' + P + '.Decel[0],' + MP + '.Decel) ,' + o.auto + ' ];'],
    ['Axis Motion Command', 'XIC(SafetyOK)[XIC(Status.State[1]) XIC(' + a + 'ManMoveTrig) ,XIO(Status.State[1]) ' + o.mamGate + ' ]XIC(' + A + '.ServoActionStatus)XIC(' + A + '.AxisHomedStatus)XIC(' + a + 'Permissive)MAM(' + A + ',' + a + '_MAM,' + MP + '.MoveType,' + MP + '.Position,' + MP + '.Speed,Units per sec,' + MP + '.Accel,Units per sec2,' + MP + '.Decel,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);'],
    ...(o.extra || []),
    ['Stop axis if permissive turns off while in motion and use max or close to max decel value', 'XIO(' + A + '.MotionStatus.0)[XIO(' + a + 'Permissive) ,XIO(SafetyOK) ]MAS(' + A + ',' + a + '_MAS_All,All,Yes,' + ST + '.MaxDecel,Units per sec2,Yes,10,% of Time);'],
    ['Set torque', 'XIC(' + CT + '.SetTorquePos)MOVE(' + P + '.TorquePos,' + A + '.TorqueLimitPositive);'],
    ['', 'XIC(' + CT + '.SetTorqueNeg)MOVE(' + P + '.TorqueNeg,' + A + '.TorqueLimitNegative);'],
    ['Retrieve values from axis', 'MOVE(' + A + '.ActualPosition,' + ST + '.ActualPosition)MOVE(' + A + '.ActualVelocity,' + ST + '.ActualVelocity)MOVE(' + A + '.TorqueReferenceFiltered,' + ST + '.ActualTorque);'],
    ['Retrieve the maximum speed value from the axis and calculate max accel and decel.  The max velocity is 85% of full speed.  Equation is based upon 100% speed at a 30ms accel/decel time.', 'XIC(S:FS)GSV(Axis,' + A + ',MaximumSpeed,' + ST + '.MaxVelocity)CPT(' + ST + '.MaxAccel,(' + ST + '.MaxVelocity/0.85)/0.03)MOVE(' + ST + '.MaxAccel,' + ST + '.MaxDecel);'],
  ];
  if (o.ranges && o.ranges.length) r.push(['Axis Position Monitor', legs(o.ranges.map(([n, i, wide]) => 'AOI_RangeCheck(' + n + ',' + (typeof i === 'number' ? P + '.Positions[' + i + ']' : i) + ',0.5,' + ST + '.ActualPosition,' + wide + ')')) + ';']);
  return r;
}
// auto staging branch: states -> HMI position index (optionally a speed index)
const autoBranch = (a, stateList, posIdx, speedIdx) => {
  const P = 'HMI_' + a + '.Parameters', MP = a + 'MotionParameters';
  const pos = typeof posIdx === 'number' ? P + '.Positions[' + posIdx + ']' : posIdx;
  if (speedIdx == null) return H.states(stateList) + ' MOVE(' + pos + ',' + MP + '.Position)';
  return H.states(stateList) + ' [MOVE(' + pos + ',' + MP + '.Position) ,MOVE(' + P + '.AutoSpeed[' + speedIdx + '],' + MP + '.Speed) ,MOVE(' + P + '.Accel[' + speedIdx + '],' + MP + '.Accel) ,MOVE(' + P + '.Decel[' + speedIdx + '],' + MP + '.Decel) ]';
};
// servo alarms (drive faulted / loss of reference) for a list of axes; indices n, n+1 per axis; ONS bits 5 / 6 of <axis>ONS
function servoAlarms(axes) {
  const list = [], rungs = [];
  axes.forEach(([a, label], i) => {
    const A = 'iq_' + a, n = 2 * i;
    list.push(label + ' Servo Drive Is Faulted', label + ' Loss Of Absolute Position Reference');
    rungs.push([list[n], 'XIO(Lockout)NE(' + A + '.AxisFault,0)[OTE(ServoAlarm[' + n + '].Active) ,ONS(' + a + 'ONS.5) DTOS(' + A + '.AxisFault,' + a + 'Fault) CONCAT(g_L2StationList[StaNum],ServoAlarmList[' + n + '],' + a + 'FaultMessage) CONCAT(' + a + 'FaultMessage,' + a + 'Fault,ServoAlarm[' + n + '].Message) ];']);
    rungs.push([list[n + 1], 'XIO(Lockout)XIC(g_MachineBasic.PowerUpCP)XIO(' + A + '.AxisHomedStatus)[OTE(ServoAlarm[' + (n + 1) + '].Active) ,ONS(' + a + 'ONS.6) CONCAT(g_L2StationList[StaNum],ServoAlarmList[' + (n + 1) + '],ServoAlarm[' + (n + 1) + '].Message) ];']);
  });
  return { list, rungs };
}
module.exports = { servoTags, servoRoutine, autoBranch, servoAlarms };
