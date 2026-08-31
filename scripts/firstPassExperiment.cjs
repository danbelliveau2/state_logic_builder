/* firstPassExperiment.cjs — Dan's experiment (2026-08-25): regenerate the
 * ServoPNP logic from scratch through the NEW first-pass flow (study →
 * readiness → single write → one review) and record the honest metrics.
 * Run: node scripts/firstPassExperiment.cjs
 * Output: generated/Test_Project_v2/ + a JSON report next to this script's log. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

(async () => {
  const startedAt = Date.now();
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'Test_Project_v2.json'), 'utf8'));
  const sm = project.stateMachines.find(s => s.name === 'ServoPNP');
  if (!sm) throw new Error('ServoPNP not found');
  const gen = require(path.join(ROOT, 'src/lib/agentGenerator/client.js'));

  let lastPct = -1;
  const result = await gen.generateL5X(project, sm.id, {
    onProgress: (pct, stage, detail) => {
      if (pct !== lastPct || detail) {
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${String(pct).padStart(5)}% ${stage}${detail ? ' — ' + detail : ''}`);
        lastPct = pct;
      }
    },
  });
  const durationS = Math.round((Date.now() - startedAt) / 1000);

  let savedPath = null;
  if (result.l5x) {
    const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
    savedPath = path.join(ROOT, 'generated', 'Test_Project_v2',
      `ServoPNP__jarvis_v${result.meta.jarvisVersion}__firstpass__${date}.L5X`);
    fs.writeFileSync(savedPath, result.l5x, 'utf8');
  }

  const report = {
    experiment: 'first-pass doctrine — ServoPNP regeneration (Dan, 2026-08-25)',
    ok: result.ok,
    firstPassShip: result.firstPassShip,
    roundsToShip: result.roundsToShip,
    attempts: result.meta.attempts,
    repairRounds: result.meta.repairRounds,
    durationS,
    costUSD: result.meta.costEstimate.totalUSD,
    readiness: result.meta.readiness,
    study: result.meta.study,
    tuition: result.meta.tuition,
    held: result.held ? { reason: result.held.reason, questions: result.held.questions } : null,
    validation: { ok: result.validation.ok, errors: result.validation.errors, warnings: result.validation.warnings.length },
    internalReview: result.internalReview ? {
      verdict: result.internalReview.verdict,
      findings: result.internalReview.findings,
      missingVsTemplate: result.internalReview.missingVsTemplate,
      summary: result.internalReview.summary,
      costUSD: result.internalReview.costUSD,
      durationS: result.internalReview.durationS,
    } : null,
    writingNotes: result.writingNotes,
    structuralChanges: result.structuralChanges,
    savedPath,
    jarvisVersion: result.meta.jarvisVersion,
    model: result.meta.model,
    ranAt: new Date().toISOString(),
  };
  const reportPath = path.join(ROOT, 'generated', 'Test_Project_v2', 'firstpass_experiment_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== EXPERIMENT RESULT ===');
  console.log(JSON.stringify({ ...report, internalReview: report.internalReview && { verdict: report.internalReview.verdict, findings: report.internalReview.findings.length, summary: report.internalReview.summary } }, null, 2));
  console.log('report:', reportPath);
})().catch(e => { console.error('EXPERIMENT CRASH:', e); process.exit(1); });
