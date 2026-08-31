#!/usr/bin/env node
/**
 * testMultiSmCompile.cjs — unit tests for the multi-state-machine compile
 * shape (Dan's Magnet Dial round, 2026-08-25): normalization, per-machine
 * validation, cross-machine handshake integrity, program naming, per-machine
 * renumbering, single-SM regression, and the SUPREME-LAW generation hold.
 *
 * No model calls, no network — pure mocks. Run: node scripts/testMultiSmCompile.cjs
 */

const assert = require('assert');
const path = require('path');
const {
  normalizeCompiledIR, validateCompiledIR,
} = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'coordinationAuthor.js'));
const { buildGenerationPrompt } = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'promptBuilder.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

const baseIr = {
  smId: 'sm1', smName: 'MagnetDial', displayName: 'Magnet Dial', stationNumber: 1,
  description: '', devices: [], states: [{ nodeId: 'n1' }, { nodeId: 'n2' }],
  machineSpec: null, generationScope: undefined,
};

const conformance = [{ decision: 'state granularity', basis: 'template', citation: 'ONE_MOVE_PER_STATE' }];

function machine(name, programName, opts = {}) {
  return {
    name, programName, oneLiner: `${name} owns its sequence`,
    states: [
      { stateNumber: 4, label: 'Start', sourceNodeId: null, synthesized: true, isInitial: true, isComplete: false,
        actions: [{ operation: 'SetSignal', deviceName: null, detail: opts.produceDetail || '' }] },
      { stateNumber: 7, label: 'Done', sourceNodeId: null, synthesized: true, isInitial: false, isComplete: true, actions: [] },
    ],
    transitions: [
      { fromState: 4, toState: 7, conditionText: opts.consumeCondition || 'StackPresent AND SS_OK', kind: 'sequence' },
      { fromState: 4, toState: 7, conditionText: 'Status.TimeoutFlt (FaultTime 5000ms)', kind: 'timeout' },
    ],
    waits: [
      { stateNumber: 4, signal: opts.waitSignal || 'StackPresent', source: 'sensor', partner: null, direction: 'incoming', mode: 'wait',
        exits: [{ toState: 7, when: 'signal true' }, { toState: 7, when: 'timeout' }] },
    ],
    handshakes: opts.handshakes || [],
  };
}

// ── 1. Single-SM regression: top-level shape unchanged ──────────────────────
test('single-SM parse keeps the original shape', () => {
  const parsed = {
    states: machine('x', 'S01_X').states,
    transitions: machine('x', 'S01_X').transitions,
    waits: machine('x', 'S01_X').waits,
    handshakes: [],
    templateConformance: conformance,
    stateMachines: [{ name: 'Only machine', oneLiner: 'does the whole station' }],
    summary: 's',
  };
  const ir = normalizeCompiledIR(parsed, baseIr);
  assert.strictEqual(ir.multiSm, false);
  assert.strictEqual(ir.states.length, 2);
  assert.strictEqual(ir.stateMachines.length, 1);
  assert.strictEqual(ir.stateMachines[0].name, 'Only machine');
  const v = validateCompiledIR(ir);
  assert.strictEqual(v.ok, true, 'expected ok, got: ' + v.errors.join(' | '));
});

// ── 2. Multi-SM: two machines, both-sides handshake — valid ─────────────────
function validMultiParsed() {
  return {
    states: [], transitions: [], waits: [], handshakes: [],
    templateConformance: conformance,
    summary: 'two machines',
    stateMachines: [
      machine('Magnet load', 'S01_MagnetLoad', {
        produceDetail: 'OTL(p_MagnetReady)',
        handshakes: [{ signal: 'p_MagnetReady', direction: 'out', partner: 'S02_PickHead', purpose: 'magnet staged', setAtState: 4, clearAtState: 7 }],
      }),
      machine('Pick head', 'S02_PickHead', {
        waitSignal: 'p_MagnetReady',
        consumeCondition: '\\\\S01_MagnetLoad.p_MagnetReady',
        handshakes: [{ signal: 'p_MagnetReady', direction: 'in', partner: 'S01_MagnetLoad', purpose: 'magnet staged' }],
      }),
    ],
  };
}

test('multi-SM normalizes to per-machine sub-sequences and validates ok', () => {
  const ir = normalizeCompiledIR(validMultiParsed(), baseIr);
  assert.strictEqual(ir.multiSm, true);
  assert.strictEqual(ir.states.length, 0, 'top-level states empty in multi');
  assert.strictEqual(ir.stateMachines.length, 2);
  assert.strictEqual(ir.stateMachines[0].programName, 'S01_MagnetLoad');
  assert.ok(ir.stateMachines[0].states.length === 2);
  // Spec-sheet planned line contract: name + oneLiner present on every entry
  for (const m of ir.stateMachines) { assert.ok(m.name); assert.ok(m.oneLiner); }
  assert.ok(ir.text.includes('State machine decomposition (2 programs'));
  assert.ok(ir.text.includes('[S01_MagnetLoad] States'));
  const v = validateCompiledIR(ir);
  assert.strictEqual(v.ok, true, 'expected ok, got: ' + v.errors.join(' | '));
});

// ── 3. Handshake missing its counterpart → error ─────────────────────────────
test('one-sided handshake between planned machines is an error', () => {
  const parsed = validMultiParsed();
  parsed.stateMachines[1] = machine('Pick head', 'S02_PickHead'); // no consume, no in-handshake
  const ir = normalizeCompiledIR(parsed, baseIr);
  const v = validateCompiledIR(ir);
  assert.ok(v.errors.some(e => e.includes('no counterpart')), v.errors.join(' | '));
});

// ── 4. Missing / duplicate program names ─────────────────────────────────────
test('missing programName is an error; duplicate is an error', () => {
  const parsed = validMultiParsed();
  parsed.stateMachines[0].programName = null;
  let ir = normalizeCompiledIR(parsed, baseIr);
  let v = validateCompiledIR(ir);
  assert.ok(v.errors.some(e => e.includes('no programName')), v.errors.join(' | '));

  const parsed2 = validMultiParsed();
  parsed2.stateMachines[1].programName = 'S01_MagnetLoad';
  ir = normalizeCompiledIR(parsed2, baseIr);
  v = validateCompiledIR(ir);
  assert.ok(v.errors.some(e => e.includes('Duplicate programName')), v.errors.join(' | '));
});

// ── 5. Per-machine inline renumbering ────────────────────────────────────────
test('each machine renumbers on its own grid', () => {
  const parsed = validMultiParsed();
  // Machine 2 numbered 4, 13 (gap) — must come back 4, 7
  parsed.stateMachines[1].states[1].stateNumber = 13;
  parsed.stateMachines[1].transitions.forEach(t => { if (t.toState === 7) t.toState = 13; });
  parsed.stateMachines[1].waits[0].exits.forEach(x => { x.toState = 13; });
  const ir = normalizeCompiledIR(parsed, baseIr);
  const nums = ir.stateMachines[1].states.map(s => s.stateNumber);
  assert.deepStrictEqual(nums, [4, 7], 'got ' + nums.join(','));
  assert.ok(ir.warnings.some(w => w.includes('[Pick head]')), ir.warnings.join(' | '));
});

// ── 6. One-move-per-state runs per machine, errors tagged ────────────────────
test('one-move-per-state violation inside a machine is tagged with its name', () => {
  const parsed = validMultiParsed();
  parsed.stateMachines[0].states[0].actions = [
    { operation: 'ServoMove', deviceName: 'DialAxis', positionName: 'A', advance: 'complete' },
    { operation: 'ServoMove', deviceName: 'DialAxis', positionName: 'B', advance: 'complete' },
  ];
  const ir = normalizeCompiledIR(parsed, baseIr);
  const v = validateCompiledIR(ir);
  assert.ok(v.errors.some(e => e.startsWith('[Magnet load]')), v.errors.join(' | '));
});

// ── 7. Fold: one carrier machine + empty top level → single shape ────────────
test('single stateMachines carrier with empty top level folds to single-SM', () => {
  const m = machine('Solo', 'S01_Solo');
  const parsed = { states: [], transitions: [], waits: [], handshakes: [],
    templateConformance: conformance, stateMachines: [m], summary: '' };
  const ir = normalizeCompiledIR(parsed, baseIr);
  assert.strictEqual(ir.multiSm, false);
  assert.strictEqual(ir.states.length, 2);
});

// ── 8. SUPREME LAW hold: generation against a multi-SM sequence throws ───────
test('buildGenerationPrompt HOLDs on an approved multi-SM sequence', () => {
  const project = {
    name: 'T', stateMachines: [{
      id: 'sm1', name: 'MagnetDial', displayName: 'Magnet Dial', stationNumber: 1,
      nodes: [{ id: 'n1', type: 'stateNode', position: { x: 0, y: 0 }, data: { isInitial: true, label: 'Home', actions: [] } }],
      edges: [], devices: [],
      compiledSequence: { approved: true, ir: { multiSm: true, stateMachines: [{}, {}, {}], text: 'x' } },
    }],
  };
  assert.throws(() => buildGenerationPrompt(project, 'sm1'),
    /HOLD — standard prevents generation.*one program per state machine/s);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
