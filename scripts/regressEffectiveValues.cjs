/**
 * regressEffectiveValues.cjs — THE VERTICALSLIDE REGRESSION (Dan, 2026-08-31):
 * a stored retract delay on a device WITH a retract sensor held his first
 * build with a question the sheet already answered. The engine must see the
 * sheet's EFFECTIVE semantics: sensor governs → delay reads "inactive".
 *
 * Deterministic, free. Run: node scripts/regressEffectiveValues.cjs
 */
const path = require('path');
const { buildIR } = require(path.join(__dirname, '..', 'src/lib/agentGenerator/ir.js'));

const sm = {
  id: 'sm1', name: 'TestStation', stationNumber: 1,
  devices: [
    { id: 'd1', type: 'PneumaticLinearActuator', name: 'VerticalSlide', sensorArrangement: 'Retract only', extTimerMs: 1000, retTimerMs: 5000 },
    { id: 'd2', type: 'PneumaticGripper', name: 'PNPGripper', sensorArrangement: 'No sensors', engageTimerMs: 250, disengageTimerMs: 250 },
  ],
  nodes: [
    { id: 'n1', type: 'stateNode', position: { x: 0, y: 0 }, data: { label: 'Home / Initial', actions: [], isInitial: true } },
    { id: 'n2', type: 'stateNode', position: { x: 0, y: 150 }, data: { label: 'Cycle Complete', actions: [], isComplete: true } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'routableEdge', data: { conditionType: 'trigger' } }],
};

const ir = buildIR({ name: 'P', stateMachines: [sm] }, 'sm1');
const dv = ir.devices.find(d => d.name === 'VerticalSlide');
const gr = ir.devices.find(d => d.name === 'PNPGripper');

const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok, extra });

check('retract delay reads INACTIVE (sensor governs)', /inactive/i.test(String(dv?.extras?.retTimerMs)), String(dv?.extras?.retTimerMs));
check('extend delay stays a real number (no extend sensor)', dv?.extras?.extTimerMs === 1000, String(dv?.extras?.extTimerMs));
check('sensorless gripper timers stay real numbers', gr?.extras?.engageTimerMs === 250 && gr?.extras?.disengageTimerMs === 250,
  `${gr?.extras?.engageTimerMs}/${gr?.extras?.disengageTimerMs}`);

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? ` (${r.extra})` : ''}`); }
process.exit(fail ? 1 : 0);
