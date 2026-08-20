#!/usr/bin/env node
/**
 * jarvisBenchmark.cjs — run the full JARVIS pipeline for one project + SM and
 * archive the result as a versioned benchmark.
 *
 * Uses the exact same code path as POST /api/generate:
 *   src/lib/agentGenerator/client.js -> generateL5X(projectJson, smId)
 *   (promptBuilder -> Claude -> validator, with self-repair)
 *
 * Usage:
 *   node scripts/jarvisBenchmark.cjs <projectFile> [smNameOrId]
 *
 *   <projectFile>  path to a project JSON, or a bare name resolved against
 *                  ./projects/ (".json" optional)
 *   [smNameOrId]   state machine name (case-insensitive) or id;
 *                  omit to list the project's state machines
 *
 * Output (never overwrites — appends -2, -3, ... for repeat runs of a version):
 *   benchmarks/{projectBase}/{smName}__jarvis_v{JARVIS_VERSION}.L5X
 *   benchmarks/{projectBase}/{smName}__jarvis_v{JARVIS_VERSION}.report.json
 *
 * Requires ANTHROPIC_API_KEY in .env (same as the endpoint).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { generateL5X } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'client.js'));
const { JARVIS_VERSION } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'jarvisVersion.js'));

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

function resolveProjectFile(arg) {
  const candidates = [
    arg,
    path.join(ROOT, arg),
    path.join(ROOT, 'projects', arg),
    path.join(ROOT, 'projects', arg + '.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
  }
  return null;
}

/** First free "<base><suffix>" pair where NEITHER the .L5X nor the report exists.
 *  Refuses to overwrite an existing benchmark for the same version: -2, -3, ... */
function nextFreeBase(dir, base) {
  for (let n = 1; ; n++) {
    const b = n === 1 ? base : `${base}-${n}`;
    if (!fs.existsSync(path.join(dir, b + '.L5X')) &&
        !fs.existsSync(path.join(dir, b + '.report.json'))) {
      return b;
    }
  }
}

async function main() {
  const [, , projectArg, smArg] = process.argv;
  if (!projectArg) {
    fail('Usage: node scripts/jarvisBenchmark.cjs <projectFile> [smNameOrId]');
  }

  const projectFile = resolveProjectFile(projectArg);
  if (!projectFile) fail(`Project file not found: ${projectArg}`);

  const projectJson = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const sms = projectJson.stateMachines || [];
  if (sms.length === 0) fail('Project has no state machines.');

  if (!smArg) {
    console.log(`State machines in ${path.basename(projectFile)}:`);
    for (const s of sms) console.log(`  ${s.name}  (id: ${s.id}, ${(s.nodes || []).length} nodes)`);
    process.exit(0);
  }

  const sm = sms.find(s => s.id === smArg) ||
             sms.find(s => (s.name || '').toLowerCase() === smArg.toLowerCase());
  if (!sm) fail(`State machine "${smArg}" not found. Available: ${sms.map(s => s.name).join(', ')}`);

  const projectBase = path.basename(projectFile, '.json');
  const outDir = path.join(ROOT, 'benchmarks', projectBase);
  fs.mkdirSync(outDir, { recursive: true });

  const base = nextFreeBase(outDir, `${sm.name}__jarvis_v${JARVIS_VERSION}`);
  const l5xPath = path.join(outDir, base + '.L5X');
  const reportPath = path.join(outDir, base + '.report.json');

  console.log(`JARVIS v${JARVIS_VERSION} benchmark`);
  console.log(`  project: ${projectBase}   SM: ${sm.name}`);
  console.log(`  output:  ${path.relative(ROOT, l5xPath)}`);
  console.log('  running full pipeline (same code path as /api/generate)...');

  const t0 = Date.now();
  let result;
  try {
    result = await generateL5X(projectJson, sm.id, {});
  } catch (e) {
    const durationMs = Date.now() - t0;
    fs.writeFileSync(reportPath, JSON.stringify({
      jarvisVersion: JARVIS_VERSION,
      project: projectBase,
      smName: sm.name,
      smId: sm.id,
      ranAt: new Date().toISOString(),
      durationMs,
      ok: false,
      error: e.message,
      errorCode: e.code || null,
    }, null, 2));
    fail(`Generation failed after ${durationMs}ms: ${e.message}\nPartial report saved to ${reportPath}`);
  }
  const durationMs = Date.now() - t0;

  if (result.l5x) fs.writeFileSync(l5xPath, result.l5x, 'utf8');

  // Save the Intermediate Representation next to the output for engineer review.
  const irPath = path.join(outDir, base + '.ir.txt');
  if (result.ir?.text) fs.writeFileSync(irPath, result.ir.text, 'utf8');
  // Structured IR (irVersion 1) — same shape the server persists to
  // generated/<project>/*.ir.json for the compiled "Full Controls" view.
  if (result.ir?.irVersion) {
    fs.writeFileSync(path.join(outDir, base + '.ir.json'), JSON.stringify({
      ...result.ir,
      generatedAt: new Date().toISOString(),
      jarvisVersion: JARVIS_VERSION,
      l5xFile: result.l5x ? path.basename(l5xPath) : null,
      validationOk: result.ok === true,
    }, null, 2), 'utf8');
  }

  // Token usage: the SDK exposes per-call usage; client.js records it per attempt.
  const attempts = result.meta?.attempts || [];
  const tokenUsage = attempts.reduce(
    (acc, a) => a.usage
      ? {
          input: acc.input + (a.usage.input || 0),
          output: acc.output + (a.usage.output || 0),
          cacheRead: acc.cacheRead + (a.usage.cacheRead || 0),
          cacheWrite: acc.cacheWrite + (a.usage.cacheWrite || 0),
        }
      : acc,
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  );

  const report = {
    jarvisVersion: JARVIS_VERSION,
    project: projectBase,
    smName: sm.name,
    smId: sm.id,
    ranAt: new Date().toISOString(),
    durationMs,
    ok: result.ok,
    validation: result.validation,
    attemptsUsed: attempts.length,
    repairRounds: result.meta?.repairRounds ?? null,
    attempts,
    tokenUsage,
    costEstimate: result.meta?.costEstimate ?? null,
    editPlanOps: result.meta?.editPlanOps ?? null,
    editPlan: result.editPlan ?? null,
    promptChars: result.meta?.promptChars ?? null,
    systemChars: result.meta?.systemChars ?? null,
    template: result.meta?.templatePath ?? null,
    templateReason: result.meta?.templateReason ?? null,
    model: result.meta?.model ?? null,
    reviewNotes: result.reviewNotes || [],
    l5xFile: result.l5x ? path.basename(l5xPath) : null,
    l5xChars: result.l5x ? result.l5x.length : 0,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`  done in ${(durationMs / 1000).toFixed(1)}s — validation ${result.ok ? 'PASS' : 'FAIL'}`);
  console.log(`  errors: ${result.validation.errors.length}, warnings: ${result.validation.warnings.length}, attempts: ${attempts.length}`);
  console.log(`  tokens: in=${tokenUsage.input} out=${tokenUsage.output} cacheR=${tokenUsage.cacheRead} cacheW=${tokenUsage.cacheWrite}`);
  console.log(`  cost:   $${result.meta?.costEstimate?.totalUSD ?? '?'} (${result.meta?.model})`);
  console.log(`  saved: ${path.relative(ROOT, l5xPath)}`);
  console.log(`         ${path.relative(ROOT, reportPath)}`);
  if (!result.ok) process.exitCode = 2;
}

main();
