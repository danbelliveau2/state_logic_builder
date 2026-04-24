// Smoke test — synthesize a 2-axis servo PNP machine with a gripper and export.
// Confirms the exporter doesn't crash and emits expected markers for a machine
// we haven't hand-tailored.
import { exportToL5X } from '../src/lib/l5xExporter.js';

const sm = {
  id: 'sm1',
  name: 'ServoPnpTest',
  displayName: 'Servo PNP Test',
  stationNumber: 1,
  description: 'Synthetic PNP — XAxis/ZAxis + gripper',
  devices: [
    {
      id: 'x',
      type: 'ServoAxis',
      name: 'XAxis',
      displayName: 'X Axis',
      axisNumber: 1,
      positions: [
        { id: 'xp0', name: 'Home', value: 0, positionIndex: 0, tolerance: 0.1 },
        { id: 'xp1', name: 'Pick', value: 100, positionIndex: 1, tolerance: 0.1 },
        { id: 'xp2', name: 'Place', value: 200, positionIndex: 2, tolerance: 0.1 },
      ],
    },
    {
      id: 'z',
      type: 'ServoAxis',
      name: 'ZAxis',
      displayName: 'Z Axis',
      axisNumber: 2,
      positions: [
        { id: 'zp0', name: 'Retracted', value: 0, positionIndex: 0, tolerance: 0.1 },
        { id: 'zp1', name: 'Extended', value: 50, positionIndex: 1, tolerance: 0.1 },
      ],
    },
    {
      id: 'g',
      type: 'PneumaticGripper',
      name: 'Gripper',
      displayName: 'Gripper',
      sensorArrangement: '2-sensor (Closed + Open)',
      homePosition: 'Disengage',
    },
  ],
  nodes: [
    { id: 'n0', type: 'stateNode', position: { x: 0, y: 0 },
      data: { label: 'Home', isInitial: true, actions: [] } },
    { id: 'n1', type: 'stateNode', position: { x: 0, y: 120 },
      data: { label: 'Move to Pick', actions: [
        { id: 'a1', deviceId: 'x', operation: 'ServoMove', positionName: 'Pick' },
      ] } },
    { id: 'n2', type: 'stateNode', position: { x: 0, y: 240 },
      data: { label: 'Extend Z', actions: [
        { id: 'a2', deviceId: 'z', operation: 'ServoMove', positionName: 'Extended' },
      ] } },
    { id: 'n3', type: 'stateNode', position: { x: 0, y: 360 },
      data: { label: 'Close Gripper', actions: [
        { id: 'a3', deviceId: 'g', operation: 'Engage' },
      ] } },
    { id: 'n4', type: 'stateNode', position: { x: 0, y: 480 },
      data: { label: 'Retract Z', actions: [
        { id: 'a4', deviceId: 'z', operation: 'ServoMove', positionName: 'Retracted' },
      ] } },
    { id: 'n5', type: 'stateNode', position: { x: 0, y: 600 },
      data: { label: 'Move to Place', actions: [
        { id: 'a5', deviceId: 'x', operation: 'ServoMove', positionName: 'Place' },
      ] } },
    { id: 'n6', type: 'stateNode', position: { x: 0, y: 720 },
      data: { label: 'Open Gripper', actions: [
        { id: 'a6', deviceId: 'g', operation: 'Disengage' },
      ] } },
    { id: 'n7', type: 'stateNode', position: { x: 0, y: 840 },
      data: { label: 'Cycle Complete', isComplete: true, actions: [] } },
  ],
  edges: [
    { id: 'e0', source: 'n0', target: 'n1', type: 'routableEdge', data: {} },
    { id: 'e1', source: 'n1', target: 'n2', type: 'routableEdge', data: {} },
    { id: 'e2', source: 'n2', target: 'n3', type: 'routableEdge', data: {} },
    { id: 'e3', source: 'n3', target: 'n4', type: 'routableEdge', data: {} },
    { id: 'e4', source: 'n4', target: 'n5', type: 'routableEdge', data: {} },
    { id: 'e5', source: 'n5', target: 'n6', type: 'routableEdge', data: {} },
    { id: 'e6', source: 'n6', target: 'n7', type: 'routableEdge', data: {} },
  ],
};

try {
  // exportToL5X(sm, allSMs, trackingFields, machineConfig)
  const xml = exportToL5X(sm, [sm], [], { controllerName: 'SDCController' });
  const lineCount = xml.split('\n').length;
  console.log(`Export OK — ${lineCount} lines, ${xml.length} chars`);

  const markers = [
    // Engineer convention: MAM suffix naming ({axis}_MAM), per-axis servo routines R04/R05,
    // position tag {axis}{positionName} with .InPos output from AOI_RangeCheck
    'R04_XAxisServo', 'R05_ZAxisServo',
    // MAM naming is suffix style per engineer: {axis}_MAM
    'XAxis_MAM', 'ZAxis_MAM',
    // Controller-scope axis tag — no station infix
    'a01_XAxis', 'a02_ZAxis',
    // Per-axis MAMParam instance named {axis}MotionParameters (no underscore)
    'XAxisMotionParameters', 'ZAxisMotionParameters',
    // Flat per-position REAL tags
    'p_XAxisHome', 'p_XAxisPick', 'p_XAxisPlace', 'p_ZAxisRetracted', 'p_ZAxisExtended',
    // AOI_RangeCheck instance per position — engineer drops RC suffix
    'XAxisHome', 'XAxisPick', 'XAxisPlace', 'ZAxisRetracted', 'ZAxisExtended',
    // RangeCheck .InPos used by R02 transitions (NOT In_Range anymore)
    'XAxisPick.InPos', 'XAxis_MAM.PC',
    // Other servo/HMI tags
    'iq_XAxis', 'iq_ZAxis', 'HMI_XAxis', 'HMI_ZAxis',
    'MotionGroup', 'AXIS_CIP_DRIVE',
    'ServoOverall', 'STRING100', 'MAMParam',
    'HMI_Toggle.0', 'HMI_Toggle.1', 'HMI_Toggle.2',
    'CPU_TimeDate_wJulian',
    'q_CloseGripper', 'q_OpenGripper',
    'i_GripperClosed', 'i_GripperOpen',
    'GripperCloseDelay', 'GripperOpenDelay',
    'MOVE(99,Control.StateReg)',
    'State_Engine_128Max',
  ];
  let missing = [];
  for (const m of markers) {
    const count = (xml.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count === 0) missing.push(m);
    else console.log(`  ${m.padEnd(30)} ${count}`);
  }
  if (missing.length) {
    console.log(`\nMISSING MARKERS (${missing.length}):`);
    for (const m of missing) console.log(`  ${m}`);
  } else {
    console.log('\nAll markers present.');
  }

  // Reserved-state sanity check
  const flowchartStateMoves = (xml.match(/MOVE\((\d+),Control\.StateReg\)/g) || [])
    .map(s => parseInt(s.match(/\d+/)[0], 10))
    .filter(n => (n === 99) || (n >= 100 && n <= 127));
  console.log(`\nReserved-range MOVEs (99, 100-127): ${flowchartStateMoves.length} occurrences`);
  console.log(`  Distinct values: ${[...new Set(flowchartStateMoves)].sort((a,b) => a-b).join(', ')}`);
} catch (err) {
  console.error('EXPORT FAILED:');
  console.error(err);
  process.exit(1);
}
