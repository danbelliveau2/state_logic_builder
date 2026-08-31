/**
 * Mocked END-TO-END hold-for-help test: stubs @anthropic-ai/sdk in the require
 * cache, then runs the REAL generateL5X fix loop against a real project +
 * template with a forced-low round budget. Zero model spend, zero writes to
 * repo data (generateL5X itself persists nothing — server.js does).
 *
 * Script: every plan call returns an EMPTY edit plan (merges clean, fails
 * diagram validation with the same errors every round) -> the same findings
 * survive JARVIS_FINDING_ROUND_LIMIT=2 rounds -> the loop escalates -> the
 * help-formulation call (detected by its STOP prompt) returns scripted
 * questions WITH proposed solutions -> result.held verified end to end.
 */
process.env.JARVIS_FINDING_ROUND_LIMIT = '2';
process.env.JARVIS_MAX_ATTEMPTS = '5';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-used';
process.env.JARVIS_INTERNAL_REVIEW = 'off';

const assert = require('assert');
const path = require('path');
const ROOT = 'C:/SDC-StateLogic';

// ── Stub the SDK before anything requires it ────────────────────────────────
const sdkPath = require.resolve(path.join(ROOT, 'node_modules', '@anthropic-ai/sdk'));
let calls = 0;
let sawResumeTurn = false;
function scriptedResponse(req) {
  calls++;
  const allTexts = req.messages.map(m => typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('\n'));
  if (allTexts.some(t => t.includes('# RESUME AFTER HOLD-FOR-HELP') && t.includes('A (Jason): Retarget the rungs.'))) sawResumeTurn = true;
  const lastUser = [...req.messages].reverse().find(m => m.role === 'user');
  const text = typeof lastUser.content === 'string'
    ? lastUser.content
    : lastUser.content.map(c => c.text || '').join('\n');
  if (text.includes('STOP — the fix loop is being escalated')) {
    return JSON.stringify({
      questions: [{
        question: 'Should the generated R02 keep the template state set when the diagram declares different states?',
        proposedSolution: 'Follow the diagram: retarget every template R02 rung to the diagram state numbers. That is my best answer — do you like it or should I change it?',
        addressee: 'CE',
        domain: 'controls',
      }],
    });
  }
  // Every plan attempt: an empty plan — merges clean, fails validation the
  // same way each round (persistent findings).
  return JSON.stringify({ operations: [] });
}
function FakeAnthropic() {
  return {
    beta: { messages: { stream: (req) => ({
      on() { return this; },
      async finalMessage() {
        const text = scriptedResponse(req);
        return {
          stop_reason: 'end_turn',
          model: 'fake-model',
          content: [{ type: 'text', text }],
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      },
    }) } },
  };
}
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: FakeAnthropic };

// ── Run the real pipeline ────────────────────────────────────────────────────
const fs = require('fs');
const { generateL5X } = require(path.join(ROOT, 'src/lib/agentGenerator/client.js'));
const projectJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'SDC_Servo_PNP.json'), 'utf8'));
const sm = projectJson.stateMachines[0];

(async () => {
  const result = await generateL5X(projectJson, sm.id, {});
  assert.ok(result.held, 'result.held must be set');
  assert.ok(/survived 2 consecutive fix rounds/.test(result.held.reason), 'reason names the budget: ' + result.held.reason);
  assert.strictEqual(result.held.rounds, 2, 'escalated at round 2 (forced budget)');
  assert.ok(result.held.persistentFindings.length >= 1, 'persistent findings recorded');
  assert.strictEqual(result.held.questions.length, 1);
  assert.ok(result.held.questions[0].proposedSolution.includes('retarget every template R02 rung'), 'proposed solution carried');
  assert.strictEqual(result.held.questions[0].addressee, 'CE');
  // Resume state is complete for a later continue:
  const r = result.held.resume;
  assert.strictEqual(r.version, 1);
  assert.strictEqual(r.smId, sm.id);
  assert.ok(r.lastEditPlan && Array.isArray(r.lastEditPlan.operations), 'last plan persisted');
  assert.ok(typeof r.lastL5xDraft === 'string' && r.lastL5xDraft.includes('RSLogix5000Content'), 'L5X draft persisted');
  assert.ok(r.validationReport.includes('VALIDATION FAILED'));
  assert.strictEqual(r.attemptCount, 2);
  // Attempts trail shows 2 rounds then held; writing notes exist and mention the hold.
  assert.deepStrictEqual(result.meta.attempts.map(a => a.stage), ['validate', 'held']);
  assert.ok(result.writingNotes.some(n => /Held for help after 2 round/.test(n.text)), 'writing note records the hold');
  assert.strictEqual(result.ok, false);
  console.log('ok  mocked end-to-end hold: 2 plan rounds + 1 help-formulation call =', calls, 'model calls, $0 spend');

  // ── RESUME leg: same mocked model now returns a plan again; verify the
  // resume seeding path executes (prior plan + answers land in the messages).
  const resumed = await generateL5X(projectJson, sm.id, {
    resume: {
      lastEditPlan: r.lastEditPlan,
      persistentFindings: r.persistentFindings,
      attemptCount: r.attemptCount,
      answers: [{ question: result.held.questions[0].question,
                  proposedSolution: result.held.questions[0].proposedSolution,
                  answer: 'Retarget the rungs.', answeredBy: 'Jason' }],
    },
  });
  assert.ok(sawResumeTurn, 'resume seeding turn (prior plan + human answers) reached the model');
  assert.ok(resumed.held, 'still-failing mock holds again — loop re-entered normally');
  console.log('ok  mocked resume: prior plan + answers seeded into the conversation, fix loop re-entered');
  console.log('\nend-to-end hold/resume mechanics verified with mocks (no model spend)');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
