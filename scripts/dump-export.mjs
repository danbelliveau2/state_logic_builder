import { exportToL5X } from '../src/lib/l5xExporter.js';
import { writeFileSync } from 'fs';

const sm = {
  id: 'sm1', name: 'ServoPnpTest', displayName: 'Servo PNP Test', stationNumber: 1,
  description: 'Synthetic PNP',
  devices: [
    { id: 'x', type: 'ServoAxis', name: 'XAxis', displayName: 'X Axis', axisNumber: 1,
      positions: [
        { id: 'xp0', name: 'Home', value: 0, positionIndex: 0, tolerance: 0.1 },
        { id: 'xp1', name: 'Pick', value: 100, positionIndex: 1, tolerance: 0.1 },
        { id: 'xp2', name: 'Place', value: 200, positionIndex: 2, tolerance: 0.1 }]},
    { id: 'z', type: 'ServoAxis', name: 'ZAxis', displayName: 'Z Axis', axisNumber: 2,
      positions: [
        { id: 'zp0', name: 'Retracted', value: 0, positionIndex: 0, tolerance: 0.1 },
        { id: 'zp1', name: 'Extended', value: 50, positionIndex: 1, tolerance: 0.1 }]},
    { id: 'g', type: 'PneumaticGripper', name: 'Gripper', displayName: 'Gripper',
      sensorArrangement: '2-sensor (Closed + Open)', homePosition: 'Disengage' }],
  nodes: [
    { id: 'n0', type: 'stateNode', position: { x: 0, y: 0 }, data: { label: 'Home', isInitial: true, actions: [] } },
    { id: 'n1', type: 'stateNode', position: { x: 0, y: 120 }, data: { label: 'Move to Pick', actions: [{ id: 'a1', deviceId: 'x', operation: 'ServoMove', positionName: 'Pick' }] } },
    { id: 'n7', type: 'stateNode', position: { x: 0, y: 840 }, data: { label: 'Cycle Complete', isComplete: true, actions: [] } }],
  edges: [{ id: 'e0', source: 'n0', target: 'n1', type: 'routableEdge', data: {} },
          { id: 'e6', source: 'n1', target: 'n7', type: 'routableEdge', data: {} }]
};

const xml = exportToL5X(sm, [sm], [], { controllerName: 'SDCController' });
writeFileSync('scripts/out.L5X', xml);
console.log('wrote scripts/out.L5X', xml.length, 'chars,', xml.split('\n').length, 'lines');
