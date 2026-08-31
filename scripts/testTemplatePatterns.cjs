/**
 * testTemplatePatterns.cjs — sanity harness for the auto-derived template
 * pattern inventory (templatePatterns.js) and checkOneMovePerState.
 *
 * Run: node scripts/testTemplatePatterns.cjs
 * Exits non-zero on any failed expectation. No API calls, no cost.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const tp = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'templatePatterns'));
const { checkOneMovePerState } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'validator'));

let failures = 0;
function expect(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}

// ── 1. Derivation on the real templates ──────────────────────────────────────
console.log('# templatePatterns derivation');
const { patterns } = tp.getTemplatePatterns({ force: true });

const s05 = patterns.templates.find(t => t.file === 'S05_ServoPNP.L5X');
expect(!!s05, 'S05_ServoPNP.L5X derived');
if (s05) {
  const z = s05.axes.find(a => a.axis === 'ZAxis');
  const x = s05.axes.find(a => a.axis === 'XAxis');
  expect(z && z.autoStates.join(',') === '7,13,22,28,100', `S05 Z auto states 7,13,22,28,100 (got ${z && z.autoStates})`);
  expect(x && x.autoStates.join(',') === '16,31,103,106', `S05 X auto states 16,31,103,106 (got ${x && x.autoStates})`);
  expect(s05.axes.every(a => a.mamRungCount === 1), 'S05: one main MAM rung per axis');
  expect(s05.mnemonicFamily === 'short', 'S05 mnemonic family short (EQ/NE/...)');
  expect(s05.r02 && s05.r02.ascending && s05.r02.sequenceBeforeOverrides, 'S05 R02 ascending, sequence before overrides');
}

const REQUIRED_HOLDING = ['ONE_MAM_PER_AXIS', 'ONE_MOVE_PER_STATE', 'NO_CONSECUTIVE_SAME_AXIS_MOVES',
  'MAM_GATING', 'MANUAL_BRANCH', 'STAGING_DEFAULTS_FIRST', 'R02_ASCENDING_ORDER',
  'TRANSITION_CONDITION_FAMILIES', 'MNEMONIC_FAMILY'];
for (const id of REQUIRED_HOLDING) {
  const inv = patterns.invariants.find(i => i.id === id);
  expect(inv && inv.holds, `invariant ${id} derived and holds across the template family`);
}

// Cache freshness
const second = tp.getTemplatePatterns();
expect(second.fromCache === true, 'second call served from hash cache');
expect(fs.existsSync(tp.CACHE_FILE), 'cache file written: ' + path.relative(ROOT, tp.CACHE_FILE));

// Rendered inventory carries the sanctioned extension
const rendered = tp.renderPatternInventory('S05_ServoPNP.L5X');
expect(/SANCTIONED EXTENSION/.test(rendered), 'rendered inventory names the fast/slow + transition-point sanctioned extension');
expect(/ONE_MOVE_PER_STATE/.test(rendered), 'rendered inventory carries ONE_MOVE_PER_STATE');

// ── 2. checkOneMovePerState — the real incident fixture ─────────────────────
console.log('# checkOneMovePerState');

// Fixture frozen from the real incident (Test_Project_v2 ServoPNP diagram,
// 2026-08-21, before the split fix): one state carrying the whole
// fast-then-slow stroke as two ServoMoves on one axis, and a three-move state.
const incident = {
  states: [
    { stateNumber: 10, label: 'Vertical Down to Pick (Fast to Transition, Slow to Pick)', actions: [
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'PickTransition', speedProfile: 'Fast' } },
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'Pick', speedProfile: 'Slow' } },
    ] },
    { stateNumber: 16, label: 'Vertical Up — Horizontal Blends to Place', actions: [
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'PickTransition', speedProfile: 'Slow' } },
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'Retract', speedProfile: 'Fast' } },
      { operation: 'ServoMove', deviceId: 'dev_h', deviceName: 'HorizontalAxis', params: { positionName: 'Place', speedProfile: 'Fast' } },
    ] },
  ],
};
const r1 = checkOneMovePerState(incident);
expect(r1.ok === false, 'incident fixture FAILS (multi-move states caught)');
expect(r1.errors.length >= 2, `incident fixture: >=2 errors (got ${r1.errors.length})`);
expect(r1.errors.some(e => /state 10/.test(e)) && r1.errors.some(e => /state 16/.test(e)),
  'both multi-move states named in errors');

// Clean shape: one move per state, cross-axis permissive overlap allowed as warning
const clean = {
  states: [
    { stateNumber: 10, label: 'V fast to PickTransition', actions: [
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'PickTransition' } }] },
    { stateNumber: 13, label: 'V slow to Pick', actions: [
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'Pick' } }] },
    { stateNumber: 22, label: 'V to Retract; H blends to Place', actions: [
      { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'Retract' } },
      { operation: 'ServoMove', deviceId: 'dev_h', deviceName: 'HorizontalAxis', params: { positionName: 'Place' },
        detail: 'permissive-gated on [VerticalAxisRetract.InPos , VerticalAxisRetract.InPosWide]' }] },
  ],
};
const r2 = checkOneMovePerState(clean);
expect(r2.ok === true, 'clean split sequence passes (no errors)');
expect(r2.warnings.length === 1 && /2 axes/.test(r2.warnings[0]), 'cross-axis overlap surfaces as ONE warning');

// Cross-axis after-complete chain in one state = error
const chained = {
  states: [{ stateNumber: 22, label: 'V retract then H place', actions: [
    { operation: 'ServoMove', deviceId: 'dev_v', deviceName: 'VerticalAxis', params: { positionName: 'Retract' } },
    { operation: 'ServoMove', deviceId: 'dev_h', deviceName: 'HorizontalAxis', params: { positionName: 'Place' },
      detail: 'starts after VerticalAxis_MAM.PC completes' }] }],
};
const r3 = checkOneMovePerState(chained);
expect(r3.ok === false && r3.errors.some(e => /after-complete/.test(e)),
  'cross-axis after-complete chain inside one state = error');

// ── 3. Live project (whatever shape it is in now) — informational ───────────
try {
  const { buildIR } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'ir'));
  const proj = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'Test_Project_v2.json'), 'utf8'));
  const ir = buildIR(proj, undefined);
  const r = checkOneMovePerState(ir);
  console.log(`# live Test_Project_v2 drawn IR: ok=${r.ok} errors=${r.errors.length} warnings=${r.warnings.length} (informational)`);
} catch (e) {
  console.log('# live Test_Project_v2 check skipped: ' + e.message);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
