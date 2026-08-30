/**
 * regressCodegenSdk.cjs — Phase 3 acceptance (Dan, 2026-08-30): the Generate
 * pipeline's writer runs on the SDK engine ("the same version you are") with
 * read access to the samples/standards folders, while EVERY objective gate
 * stays: editPlanSchema, mergeEngine, validateL5X (importSimValidator
 * byte-level import simulation inside), diagram/IR cross-check, one internal
 * review.
 *
 * Runs ONE real paid build on projects/SDC_Servo_PNP.json and asserts the
 * result contract.
 *
 * Run: node -r dotenv/config scripts/regressCodegenSdk.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { generateL5X } = require(path.join(ROOT, 'src/lib/agentGenerator/client.js'));

const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'SDC_Servo_PNP.json'), 'utf8'));
const smId = project.stateMachines[0].id;

const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok, extra });

(async () => {
  const t0 = Date.now();
  const stages = [];
  const r = await generateL5X(project, smId, {
    onProgress: (pct, stage, detail) => {
      if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
      if (detail) console.log(`  [${String(pct).padStart(4)}%] ${stage}: ${detail}`);
    },
  });

  const held = !!r.held;
  check('result contract intact', 'ok' in r && 'l5x' in r && 'validation' in r && 'meta' in r);
  check('engine is the SDK', r.meta?.engine === 'claude-agent-sdk', String(r.meta?.engine));
  if (held) {
    // A hold is a LEGITIMATE outcome (readiness or persistent findings) — the
    // contract checks still apply; the build asks instead of guessing.
    check('held carries questions + resume', (r.held.questions?.length ?? 0) > 0 && !!r.held.resume,
      `${r.held.questions?.length ?? 0} question(s): ${r.held.reason}`);
    console.log('\nHELD — questions:');
    for (const q of r.held.questions ?? []) console.log(` - ${q.question}\n   proposal: ${q.proposedSolution ?? '(none)'}`);
  } else {
    check('validation passed (importSim + byte gates inside)', r.validation?.ok === true,
      (r.validation?.errors ?? []).slice(0, 3).join(' | '));
    check('L5X produced', typeof r.l5x === 'string' && r.l5x.length > 10000, `${r.l5x?.length ?? 0} chars`);
    check('edit plan recorded', !!r.editPlan && Array.isArray(r.editPlan.operations), `${r.editPlan?.operations?.length ?? 0} ops`);
    check('internal review ran', r.internalReview != null && 'verdict' in (r.internalReview ?? {}),
      String(r.internalReview?.verdict));
  }
  check('cost recorded', Number(r.meta?.costEstimate?.totalUSD ?? 0) > 0, `$${r.meta?.costEstimate?.totalUSD}`);
  check('attempts recorded', Array.isArray(r.meta?.attempts), `${r.meta?.attempts?.length ?? 0} attempt(s)`);

  console.log(`\nstages: ${stages.join(' → ')}`);
  console.log(`took ${(Math.round((Date.now() - t0) / 1000))}s, $${r.meta?.costEstimate?.totalUSD}, ` +
    `${r.meta?.attempts?.length ?? 0} attempt(s), firstPassShip=${r.firstPassShip}, review=${r.internalReview?.verdict ?? 'n/a'}`);

  let fail = 0;
  for (const x of results) {
    if (!x.ok) fail++;
    console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.extra ? ` (${x.extra})` : ''}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('regression errored:', e.stack || e.message); process.exit(2); });
