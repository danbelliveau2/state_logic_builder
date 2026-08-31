#!/usr/bin/env node
/**
 * testEditClassifier.cjs — offline unit tests for THE SPEED ARCHITECTURE:
 * the edit classifier (deterministic layer), the sheet value patch, and the
 * flow-order regression from Dan's 2026-08-25 Magnet Dial compile (legal
 * recovery excursions must not be flagged; genuine splices still must).
 *
 * Run: node scripts/testEditClassifier.cjs   (no API key needed, $0)
 */

const path = require('path');
const {
  classifyEdit, applyValueTargetsToSheet, collectNamedValues,
} = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'editClassifier.js'));
const {
  validateMachineCore, renumberInlineOnGrid, isMainFlowEdge,
} = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'coordinationAuthor.js'));
const { sidePathStatesOf } = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'validator.js'));

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── A representative Magnet Dial sheet (devices from Dan's real station) ─────
const sheet = {
  devices: [
    { name: 'HoldDownCylinder', displayName: 'Hold_Down_Cylinder', type: 'PneumaticLinearActuator', delays: { extendMs: 500, retractMs: 500 } },
    { name: 'VerticalShuttleCylinder', displayName: 'Vertical_Shuttle_Cylinder', type: 'PneumaticLinearActuator', delays: { extendMs: 1000, retractMs: 1000 } },
    { name: 'HorizontalShuttleCylinder', displayName: 'Horizontal_Shuttle_Cylinder', type: 'PneumaticLinearActuator' },
    { name: 'PartGripper', displayName: 'Part_Gripper', type: 'PneumaticGripper', delays: { extendMs: 250, retractMs: 250 } },
    { name: 'MagnetDial', displayName: 'Magnet_Dial', type: 'ServoAxis', motionType: 'rotary', fixtureCount: 10 },
    { name: 'ZAxis', displayName: 'ZAxis', type: 'ServoAxis',
      positions: [{ name: 'Retract', valueMm: 100 }, { name: 'Pick', valueMm: 210 }, { name: 'PickRetractBlend', valueMm: 2 }],
      speeds: { fastMmS: 1000, slowMmS: 100 } },
  ],
  sequence: [
    'Wait for cycle start and pick head clear',
    'Retract hold down, index dial 36 deg to next stack',
    'Extend hold down on magnet stack',
    'Strip one magnet to the shuttle pick position',
  ],
  failureHandling: [
    { when: 'Strip fails (magnet not in place)', then: 'retry the strip', retries: 3, whenExhausted: 'fault' },
  ],
  interactions: [{ station: 'Robot', how: 'presents magnet to the robot' }],
};
const smSplit = [
  { name: 'S01_MagnetLoad', deviceNames: ['Magnet_Dial', 'Hold_Down_Cylinder', 'Vertical_Shuttle_Cylinder', 'Horizontal_Shuttle_Cylinder'], sequence: ['Retract Hold Down / Trigger Dial Index 36 deg To Next Stack', 'Strip one magnet'] },
  { name: 'S02_MagnetPickHead', deviceNames: ['Part_Gripper', 'ZAxis'], sequence: ['Rotate head to robot place position', 'Present magnet to robot'] },
];

console.log('\n== class a: VALUE (Dan\'s timer edits, 2026-08-25) ==');
{
  const r = classifyEdit({ text: 'set the hold down extend delay to 1 second', sheet, smSplit });
  t('timer edit #1 classifies value/deterministic', r.class === 'value' && r.confidence === 'deterministic', JSON.stringify(r));
  t('timer edit #1 target = HoldDownCylinder extend 1000ms',
    r.targets.length === 1 && r.targets[0].field === 'delays.extendMs' && r.targets[0].valueMs === 1000
    && /HoldDown/i.test(r.targets[0].deviceName), JSON.stringify(r.targets));
}
{
  const r = classifyEdit({ text: 'make the vertical shuttle retract delay 250 ms', sheet, smSplit });
  t('timer edit #2 classifies value/deterministic', r.class === 'value' && r.confidence === 'deterministic', JSON.stringify(r));
  t('timer edit #2 target = VerticalShuttleCylinder retract 250ms',
    r.targets.length === 1 && r.targets[0].field === 'delays.retractMs' && r.targets[0].valueMs === 250, JSON.stringify(r.targets));
}
{
  const r = classifyEdit({ text: 'gripper delays 250 ms each way', sheet, smSplit });
  t('one number fans out to both gripper delay rows', r.class === 'value' && r.targets.length === 2
    && r.targets.every(x => x.valueMs === 250), JSON.stringify(r.targets));
}
{
  const r = classifyEdit({ text: 'pick is at 210 and the pick retract blend should be 3mm', sheet, smSplit });
  t('position + blend edit classifies value', r.class === 'value', JSON.stringify(r));
  t('blend target resolves to PickRetractBlend 3mm',
    r.targets.some(x => /Blend/i.test(x.name) && x.valueMm === 3), JSON.stringify(r.targets));
}

console.log('\n== class d: DECOMPOSITION (Dan\'s 4-SM correction, 2026-08-25) ==');
{
  const danText = "yeah so I think you're right you have the dial indexer is one state machine the magnet shuttle is one state machine the magnet picking place is a state machine and then the robot if we want to consider that in this you know is is another one I'm going to say it is";
  const r = classifyEdit({ text: danText, sheet, smSplit });
  t('4-SM correction classifies decomposition/deterministic',
    r.class === 'decomposition' && r.confidence === 'deterministic', JSON.stringify({ class: r.class, conf: r.confidence }));
}
{
  const r = classifyEdit({ text: 'split the pick head into its own state machine', sheet, smSplit });
  t('explicit split classifies decomposition', r.class === 'decomposition', r.class);
}

console.log('\n== class c: STRUCTURAL-SM ==');
{
  const r = classifyEdit({ text: 'add a part present sensor at the shuttle and wait for it before the strip', sheet, smSplit });
  t('add-sensor classifies structural-sm', r.class === 'structural-sm', JSON.stringify({ class: r.class }));
  t('attributed to S01_MagnetLoad', r.machine === 'S01_MagnetLoad', String(r.machine));
}
{
  const r = classifyEdit({ text: 'remove the top retainer cylinder, we redesigned the nest', sheet, smSplit });
  t('remove-device classifies structural-sm', r.class === 'structural-sm', r.class);
}

console.log('\n== class b: SECTION ==');
{
  const r = classifyEdit({ text: 'on a jam the hold down should stay engaged until the operator clears it, then re-home', sheet, smSplit });
  t('fault-behavior wording classifies section', r.class === 'section', JSON.stringify({ class: r.class, section: r.section }));
  t('section = failureHandling', r.section === 'failureHandling', String(r.section));
}

console.log('\n== value patch applies to the sheet ==');
{
  const { targets } = classifyEdit({ text: 'set the hold down extend delay to 1 second', sheet, smSplit });
  const { sheet: out, changesMade, unapplied } = applyValueTargetsToSheet(sheet, targets);
  t('patch lands on the right device', out.devices[0].delays.extendMs === 1000, JSON.stringify(out.devices[0].delays));
  t('untouched values survive verbatim', out.devices[0].delays.retractMs === 500 && out.devices[1].delays.extendMs === 1000);
  t('receipt computed', changesMade.length === 1 && /1000 ms/.test(changesMade[0].text), JSON.stringify(changesMade));
  t('nothing unapplied', unapplied.length === 0);
  t('original sheet not mutated', sheet.devices[0].delays.extendMs === 500);
}
{
  const named = collectNamedValues(sheet);
  t('named-value surface includes defaulted sensorless pneumatic delays',
    named.some(v => v.deviceName === 'HorizontalShuttleCylinder' && v.defaulted), '');
}

console.log('\n== flow-order regression (Dan\'s live compile, 2026-08-25) ==');
{
  let realTested = false;
  try {
    const p = require(path.join(__dirname, '..', 'projects', 'Magnet_Dial_v3.json'));
    const ir = p.stateMachines[0].compiledSequence.ir;
    const m = ir.stateMachines.find(x => /pick head/i.test(x.name));
    if (m) {
      const v = validateMachineCore(m);
      const flowErrors = v.errors.filter(e => /Flow order/.test(e));
      t('legal recovery excursion (13→37 fail, 37→34 abandon) no longer flagged', flowErrors.length === 0, flowErrors.join(' | '));
      const renum = renumberInlineOnGrid(JSON.parse(JSON.stringify(m)));
      t('renumberer agrees (no changes on the shape it produced)', renum.changed.length === 0, JSON.stringify(renum.changed));
      const side = sidePathStatesOf(m);
      t('validator sidePathStatesOf sees state 37 as side path', side.has(37), [...side].join(','));
      realTested = true;
    }
  } catch (e) { /* project data not present */ }
  if (!realTested) console.log('  (skipped real-project checks — Magnet_Dial_v3.json not found)');

  // Synthetic: a GENUINE splice (main-flow sandwich) must still be flagged.
  const bad = {
    states: [4, 7, 52, 10].map((n, i) => ({ stateNumber: n, label: `S${n}`, isInitial: i === 0, actions: [] })),
    transitions: [
      { fromState: 4, toState: 7, conditionText: 'x', kind: 'sequence' },
      { fromState: 7, toState: 52, conditionText: 'x', kind: 'sequence' },
      { fromState: 52, toState: 10, conditionText: 'x', kind: 'sequence' },
    ],
    waits: [],
  };
  const v2 = validateMachineCore(JSON.parse(JSON.stringify(bad)));
  t('genuine main-flow splice still flagged by the check', v2.errors.some(e => /Flow order/.test(e)), v2.errors.join(' | '));
  const fixed = JSON.parse(JSON.stringify(bad));
  const ren = renumberInlineOnGrid(fixed);
  t('renumberer fixes the splice inline (52 → 10, downstream shifts)', ren.changed.length > 0
    && fixed.states.every(s => [4, 7, 10, 13].includes(s.stateNumber)), JSON.stringify(fixed.states.map(s => s.stateNumber)));
  const v3 = validateMachineCore(fixed);
  t('after renumbering the check passes (check never flags what the fix produces)',
    !v3.errors.some(e => /Flow order/.test(e)), v3.errors.join(' | '));
  t('isMainFlowEdge: pass branch is main, fail branch is not',
    isMainFlowEdge({ kind: 'branch', branch: 'pass' }) && !isMainFlowEdge({ kind: 'branch', branch: 'fail' })
    && !isMainFlowEdge({ kind: 'recovery' }) && isMainFlowEdge({ kind: 'wait' }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
