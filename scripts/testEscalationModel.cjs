/**
 * testEscalationModel.cjs — unit tests for Dan's escalation model (Jarvis v1.3.0).
 *
 * Covers the pure/persistence plumbing with NO model calls and NO real data:
 *   1. questionRouter addressee mapping (solutions-not-explanations lane tags)
 *   2. client.js loop-limit helpers (trackPersistentFindings, fallback questions)
 *   3. buildScores normalization of writingNotes / structuralChanges / help
 *      (+ backward compatibility) and approve-changes
 *   4. handleBuildsRoute POST /:id/approve-changes with mock req/res
 *   5. coordinationAuthor.applyIrPatches (structural-delta patching)
 *   6. editPlanSchema structuralChanges validation
 *   7. internalReviewer.normalizeReview proposedSolution/addressee carriage
 *   8. Hold/resume state round-trip (file shape a continue call reads back)
 *
 * Run: node scripts/testEscalationModel.cjs
 * NOT covered here (honest): a real held generation end-to-end — that needs a
 * paid model run; the hold and resume paths share generateL5X's fix loop, so
 * the seams tested here are the persistence/routing ones.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const qr = require('../src/lib/agentGenerator/questionRouter.js');
const client = require('../src/lib/agentGenerator/client.js');
const scores = require('../src/lib/agentGenerator/buildScores.js');
const { applyIrPatches, normalizeCompiledIR } = require('../src/lib/agentGenerator/coordinationAuthor.js');
const { validatePlan } = require('../src/lib/agentGenerator/editPlanSchema.js');
const { normalizeReview } = require('../src/lib/agentGenerator/internalReviewer.js');

let passed = 0;
const pending = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(
        () => { passed++; console.log('  ok  ' + name); },
        (e) => { console.error('FAIL  ' + name + '\n      ' + (e && e.message)); process.exitCode = 1; }));
      return;
    }
    passed++; console.log('  ok  ' + name);
  }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.message)); process.exitCode = 1; }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-escalation-test-'));
const scoresFile = path.join(tmpDir, 'buildScores.json');

// ── 1. questionRouter addressee mapping ──────────────────────────────────────
console.log('questionRouter');
test('addresseeForDomain: mechanical -> ME, controls -> CE, jarvis -> ME (Dan)', () => {
  assert.strictEqual(qr.addresseeForDomain('mechanical'), 'ME');
  assert.strictEqual(qr.addresseeForDomain('controls'), 'CE');
  assert.strictEqual(qr.addresseeForDomain('jarvis'), 'ME');
});
test('resolveAddressee: valid passes through, invalid derives from domain', () => {
  assert.strictEqual(qr.resolveAddressee('ME', 'controls'), 'ME');
  assert.strictEqual(qr.resolveAddressee('CE', 'mechanical'), 'CE');
  assert.strictEqual(qr.resolveAddressee('bogus', 'controls'), 'CE');
  assert.strictEqual(qr.resolveAddressee(undefined, 'mechanical'), 'ME');
});

// ── 2. Loop-limit helpers ────────────────────────────────────────────────────
console.log('client.js loop budget');
test('budgets are configurable constants with the agreed defaults', () => {
  assert.strictEqual(client.FINDING_ROUND_LIMIT, 4);
  assert.strictEqual(client.HARD_ROUND_CAP, 8);
});
test('trackPersistentFindings: a finding surviving N rounds escalates, a cleared one resets', () => {
  const counts = new Map();
  // Rounds 1-3: A persists, B appears then clears.
  assert.deepStrictEqual(client.trackPersistentFindings(counts, ['A', 'B'], 4).persistent, []);
  assert.deepStrictEqual(client.trackPersistentFindings(counts, ['A'], 4).persistent, []);
  assert.deepStrictEqual(client.trackPersistentFindings(counts, ['A', 'C'], 4).persistent, []);
  // Round 4: A hits the limit.
  const r4 = client.trackPersistentFindings(counts, ['A', 'C'], 4);
  assert.deepStrictEqual(r4.persistent, ['A']);
  // B was cleared and re-appearing later starts from 1 again.
  const r5 = client.trackPersistentFindings(counts, ['B'], 4);
  assert.deepStrictEqual(r5.persistent, []);
  assert.strictEqual(counts.get('B'), 1);
  assert.strictEqual(counts.has('A'), false); // cleared this round
});
test('fallbackHelpQuestions: derived, addressed, honest null proposedSolution', () => {
  const qs = client.fallbackHelpQuestions(['R02 rung out of order'], 4, 'ServoPNP');
  assert.strictEqual(qs.length, 1);
  assert.ok(qs[0].question.includes('ServoPNP'));
  assert.ok(qs[0].question.includes('R02 rung out of order'));
  assert.strictEqual(qs[0].proposedSolution, null);
  assert.strictEqual(qs[0].addressee, 'CE');
  assert.strictEqual(qs[0].derived, true);
});

// ── 3. buildScores normalization + approve-changes ───────────────────────────
console.log('buildScores');
test('recordBuild normalizes the escalation fields (exact UI contract)', () => {
  const b = scores.recordBuild(scoresFile, {
    project: 'P', sm: 'SM', validationOk: false,
    writingNotes: [{ text: '  Cost 2 fix rounds — validate: X ' }, { text: '' }, 'string note'],
    structuralChanges: [
      { text: 'Split state 31 into trigger/wait', irPatch: [{ op: 'addState', state: { stateNumber: 34 } }], approved: 'yes' },
      { text: '' }, // dropped
    ],
    help: {
      questions: [
        { id: 'q1', question: 'How should X be staged?', proposedSolution: 'Stage it as Y.', addressee: 'CE' },
        { id: 'q2', question: 'Clearance intent?', domain: 'mechanical' }, // addressee derived -> ME
      ],
      status: 'nonsense', // -> waiting
    },
    resumePath: path.join(tmpDir, 'x.resume.json'),
  });
  assert.deepStrictEqual(b.writingNotes, [
    { text: 'Cost 2 fix rounds — validate: X' },
    { text: 'string note' },
  ]);
  assert.strictEqual(b.structuralChanges.length, 1);
  assert.strictEqual(b.structuralChanges[0].approved, false); // 'yes' !== true
  assert.ok(Array.isArray(b.structuralChanges[0].irPatch));
  assert.strictEqual(b.help.status, 'waiting');
  assert.deepStrictEqual(Object.keys(b.help), ['questions', 'status']); // exact shape
  assert.deepStrictEqual(b.help.questions[0],
    { id: 'q1', question: 'How should X be staged?', proposedSolution: 'Stage it as Y.', addressee: 'CE' });
  assert.strictEqual(b.help.questions[1].addressee, 'ME');
  assert.strictEqual(b.help.questions[1].proposedSolution, null);
  assert.ok(b.resumePath.endsWith('x.resume.json'));
});
test('recordBuild is backward-compatible: old-shape records get empty/null defaults', () => {
  const b = scores.recordBuild(scoresFile, { project: 'P2', sm: 'SM2', validationOk: true });
  assert.deepStrictEqual(b.writingNotes, []);
  assert.deepStrictEqual(b.structuralChanges, []);
  assert.strictEqual(b.help, null);
  assert.strictEqual(b.resumePath, null);
});
test('approveStructuralChanges: approves all by default, specific indexes, validates', () => {
  const held = scores.readBuilds(scoresFile)[0];
  const upd = scores.approveStructuralChanges(scoresFile, held.id, { approvedBy: 'Dan' });
  assert.strictEqual(upd.structuralChanges[0].approved, true);
  assert.strictEqual(upd.structuralChanges[0].approvedBy, 'Dan');
  assert.ok(upd.structuralChanges[0].approvedAt);
  assert.throws(() => scores.approveStructuralChanges(scoresFile, 'nope', {}), /Build not found/);
  const clean = scores.readBuilds(scoresFile)[1];
  assert.throws(() => scores.approveStructuralChanges(scoresFile, clean.id, {}), /no structural changes/);
  assert.throws(() => scores.approveStructuralChanges(scoresFile, held.id, { indexes: [5] }), /Invalid structural-change index/);
});

// ── 4. handleBuildsRoute approve-changes (mock req/res) ─────────────────────
console.log('handleBuildsRoute');
test('POST /api/jarvis/builds/:id/approve-changes routes and responds', async () => {
  // re-seed a fresh unapproved change
  const b = scores.recordBuild(scoresFile, {
    project: 'P3', sm: 'SM3',
    structuralChanges: [{ text: 'Redirected 37->40 timeout to recovery', approved: false }],
  });
  let sent = null;
  await scores.handleBuildsRoute(
    { /* req */ },
    { /* res */ },
    {
      pathname: `/api/jarvis/builds/${b.id}/approve-changes`,
      method: 'POST',
      sendJson: (res, status, data) => { sent = { status, data }; },
      readBody: async () => JSON.stringify({ approvedBy: 'Dan' }),
      file: scoresFile,
    });
  assert.ok(sent, 'no response sent');
  assert.strictEqual(sent.status, 200);
  assert.strictEqual(sent.data.ok, true);
  assert.strictEqual(sent.data.build.structuralChanges[0].approved, true);
});

// ── 5. applyIrPatches ────────────────────────────────────────────────────────
console.log('applyIrPatches');
function miniIr() {
  return {
    irVersion: 1, compiled: true, smId: 'sm1', smName: 'TestSM', displayName: 'TestSM',
    stationNumber: 1, description: '', compilerVersion: 'test',
    devices: [],
    states: [
      { nodeId: 'n1', synthesized: false, type: 'compiledState', label: 'Home', stateNumber: 4, isInitial: true, isComplete: false, actions: [], entryFrom: [] },
      { nodeId: 'n2', synthesized: false, type: 'compiledState', label: 'Move', stateNumber: 7, isInitial: false, isComplete: false, actions: [], entryFrom: [4] },
      { nodeId: 'n3', synthesized: false, type: 'compiledState', label: 'Done', stateNumber: 10, isInitial: false, isComplete: true, actions: [], entryFrom: [7] },
    ],
    transitions: [
      { fromState: 4, toState: 7, from: 4, to: 7, conditionText: 'Start', kind: 'sequence', fromLabel: 'Home', toLabel: 'Move', label: null, outcomeLabel: null, branch: null, conditionType: null },
      { fromState: 7, toState: 10, from: 7, to: 10, conditionText: 'AxisDone', kind: 'sequence', fromLabel: 'Move', toLabel: 'Done', label: null, outcomeLabel: null, branch: null, conditionType: null },
    ],
    waits: [], handshakes: [], templateConformance: [], reviewFlags: [], warnings: [],
    summary: '', stateRanges: { lockout: 99 },
  };
}
test('addState + retarget transition + addTransition (the trigger/wait split)', () => {
  const ir = miniIr();
  const r = applyIrPatches(ir, [
    { op: 'addState', state: { stateNumber: 13, label: 'Wait for move complete' } },
    { op: 'updateTransition', fromState: 7, toState: 10, patch: { toState: 13 } },
    { op: 'addTransition', transition: { fromState: 13, toState: 10, conditionText: 'MAM.PC AND InPos', kind: 'sequence' } },
  ]);
  assert.strictEqual(r.ok, true, r.errors.join('; '));
  assert.deepStrictEqual(ir.states.map(s => s.stateNumber), [4, 7, 10, 13]);
  const s13 = ir.states.find(s => s.stateNumber === 13);
  assert.strictEqual(s13.synthesized, true);
  assert.deepStrictEqual(s13.entryFrom, [7]);
  assert.deepStrictEqual(ir.states.find(s => s.stateNumber === 10).entryFrom, [13]);
  assert.ok(ir.text.includes('State 13: "Wait for move complete"'), 'text re-rendered');
  assert.ok(ir.text.includes('[13] -> [10]'), 'new transition rendered');
});
test('removeState drops its transitions and waits; errors are collected not thrown', () => {
  const ir = miniIr();
  ir.waits.push({ stateNumber: 7, signal: 'x', exits: [] });
  const r = applyIrPatches(ir, [
    { op: 'removeState', stateNumber: 7 },
    { op: 'updateState', stateNumber: 999, patch: {} },       // error
    { op: 'removeTransition', fromState: 1, toState: 2 },     // error
    { op: 'frobnicate' },                                     // error
  ]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 3);
  assert.deepStrictEqual(ir.states.map(s => s.stateNumber), [4, 10]);
  assert.strictEqual(ir.transitions.length, 0);
  assert.strictEqual(ir.waits.length, 0);
});

// ── 5b. normalizeCompiledIR sourceNodeId (shell-agent fix 2026-08-22) ────────
console.log('normalizeCompiledIR sourceNodeId');
test('valid drawn ids kept, invented ids coerced to null + warned, legacy nodeId accepted', () => {
  const baseIr = {
    smId: 'sm1', smName: 'T', displayName: 'T', stationNumber: 1, description: '',
    devices: [], machineSpec: null,
    states: [
      { nodeId: 'node-abc', stateNumber: 4, label: 'Home' },
      { nodeId: 'node-def', stateNumber: 7, label: 'Move' },
    ],
  };
  const ir = normalizeCompiledIR({
    states: [
      { stateNumber: 4, label: 'Home', sourceNodeId: 'node-abc', isInitial: true },           // valid
      { stateNumber: 7, label: 'Move', nodeId: 'node-def' },                                  // legacy field, valid
      { stateNumber: 10, label: 'Retry exhausted', sourceNodeId: 'state10' },                 // invented -> null
      { stateNumber: 13, label: 'Wait', sourceNodeId: null, synthesized: true },              // honest synthesized
    ],
    transitions: [], waits: [], handshakes: [], templateConformance: [], reviewFlags: [],
  }, baseIr);
  const byNum = new Map(ir.states.map(s => [s.stateNumber, s]));
  assert.strictEqual(byNum.get(4).sourceNodeId, 'node-abc');
  assert.strictEqual(byNum.get(4).nodeId, 'node-abc');   // legacy alias kept in sync
  assert.strictEqual(byNum.get(4).synthesized, false);
  assert.strictEqual(byNum.get(7).sourceNodeId, 'node-def'); // old prompt shape tolerated
  assert.strictEqual(byNum.get(10).sourceNodeId, null);      // invented id rejected
  assert.strictEqual(byNum.get(10).synthesized, true);
  assert.strictEqual(byNum.get(13).sourceNodeId, null);
  assert.strictEqual(ir.warnings.length, 1, 'exactly one coercion warning');
  assert.ok(/claims sourceNodeId "state10"/.test(ir.warnings[0]), ir.warnings[0]);
});

// ── 6. editPlanSchema structuralChanges validation ───────────────────────────
console.log('editPlanSchema');
test('plans without structuralChanges validate exactly as before', () => {
  const v = validatePlan({ operations: [{ op: 'renameTag', from: 'A', to: 'B' }] });
  assert.strictEqual(v.ok, true, v.errors.join('; '));
});
test('declared structuralChanges validate; bad shapes are named', () => {
  const good = validatePlan({
    operations: [],
    structuralChanges: [{ text: 'Split move into trigger/wait', irPatch: [{ op: 'addState', state: { stateNumber: 13 } }] }],
  });
  assert.strictEqual(good.ok, true, good.errors.join('; '));
  const bad = validatePlan({
    operations: [],
    structuralChanges: [{ irPatch: [{ op: 'nukeEverything' }] }],
  });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some(e => /needs "text"/.test(e)), 'missing text flagged');
  assert.ok(bad.errors.some(e => /unknown op "nukeEverything"/.test(e)), 'bad op flagged');
});

// ── 7. internalReviewer.normalizeReview ──────────────────────────────────────
console.log('internalReviewer');
test('standardsQuestions carry proposedSolution + addressee', () => {
  const r = normalizeReview({
    verdict: 'unsure',
    findings: [],
    standardsQuestions: [
      { topic: 'Servo staging', question: 'How should back-to-back moves be staged?', proposedSolution: 'Use the indexer trigger/wait split.', domain: 'controls' },
      'Is a bare-string question still tolerated?',
    ],
    summary: 's',
  });
  assert.strictEqual(r.verdict, 'unsure');
  assert.strictEqual(r.standardsQuestions[0].proposedSolution, 'Use the indexer trigger/wait split.');
  assert.strictEqual(r.standardsQuestions[0].addressee, 'CE');
  assert.strictEqual(r.standardsQuestions[1].proposedSolution, null); // honest: model gave none
  assert.ok(r.standardsQuestions[1].addressee);
});
test('unsure with no question synthesizes one with honest null proposedSolution', () => {
  const r = normalizeReview({ verdict: 'unsure', findings: [], standardsQuestions: [], summary: 'could not tell' });
  assert.strictEqual(r.standardsQuestions.length, 1);
  assert.strictEqual(r.standardsQuestions[0].proposedSolution, null);
  assert.strictEqual(r.standardsQuestions[0].addressee, 'CE');
});

// ── 8. Hold/resume state round-trip ──────────────────────────────────────────
console.log('hold/resume plumbing');
test('resume sidecar round-trips the fields the continue endpoint consumes', () => {
  // The exact shape client.js puts in held.resume and persistHold_ augments.
  const resume = {
    version: 1, smId: 'sm1', smName: 'TestSM', mode: 'translation', template: 'S05.L5X',
    attemptCount: 4,
    lastEditPlan: { operations: [{ op: 'renameTag', from: 'A', to: 'B' }] },
    lastL5xDraft: '<RSLogix5000Content/>',
    persistentFindings: ['Compiled state 13 has no MOVE(13,Control.StateReg) transition in R02'],
    validationReport: 'VALIDATION FAILED\n  ERROR: ...',
    projectFilename: 'Test.json',
    heldAt: new Date().toISOString(),
    reason: '1 finding(s) survived 4 consecutive fix rounds',
    questions: [{ id: 'q_help_x', question: 'Q?', proposedSolution: 'S.', addressee: 'CE' }],
  };
  const p = path.join(tmpDir, 'TestSM__held__x.resume.json');
  fs.writeFileSync(p, JSON.stringify(resume, null, 2), 'utf8');
  const back = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Everything the continue endpoint reads:
  assert.strictEqual(back.projectFilename, 'Test.json');
  assert.strictEqual(back.smId, 'sm1');
  assert.ok(back.lastEditPlan && Array.isArray(back.lastEditPlan.operations));
  assert.ok(Array.isArray(back.persistentFindings) && back.persistentFindings.length);
  assert.strictEqual(typeof back.attemptCount, 'number');
  // And the generateL5X resume option contract:
  const opt = {
    lastEditPlan: back.lastEditPlan,
    persistentFindings: back.persistentFindings,
    attemptCount: back.attemptCount,
    answers: [{ question: 'Q?', proposedSolution: 'S.', answer: 'Do X.', answeredBy: 'Jason' }],
  };
  assert.ok(opt.lastEditPlan, 'resume option seeds from the persisted plan');
});
test('help-status lifecycle: waiting -> resumed -> resolved via updateBuild + normalizeHelp', () => {
  const b = scores.recordBuild(scoresFile, {
    project: 'P4', sm: 'SM4',
    help: { questions: [{ id: 'q1', question: 'Q?', proposedSolution: 'S.', addressee: 'CE' }], status: 'waiting' },
  });
  scores.updateBuild(scoresFile, b.id, { help: scores.normalizeHelp({ questions: b.help.questions, status: 'resumed' }) });
  assert.strictEqual(scores.getBuild(scoresFile, b.id).help.status, 'resumed');
  scores.updateBuild(scoresFile, b.id, { help: scores.normalizeHelp({ questions: b.help.questions, status: 'resolved' }) });
  const done = scores.getBuild(scoresFile, b.id);
  assert.strictEqual(done.help.status, 'resolved');
  assert.strictEqual(done.help.questions[0].proposedSolution, 'S.');
});

Promise.all(pending).then(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\n${passed} test(s) passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
});
