/**
 * testAgentGenerate.cjs — CLI harness for the agentGenerator pipeline.
 * Runs WITHOUT an API key:
 *
 *   Part 1: promptBuilder dry-run on projects/SDC_Servo_PNP.json
 *           (prints chosen template, analysis docs, rule count, prompt size)
 *   Part 2: validator.js against the two SDC_PNP_Test files
 *           (V4.2 AI export should PASS; old SLD export should FAIL with its
 *            known defects: undeclared \Supervisor / \Alarms / g_CPUDateTime)
 *   Part 3: reports whether ANTHROPIC_API_KEY is configured (no API call made)
 *
 * Usage: node scripts/testAgentGenerate.cjs
 * Exits non-zero if any expectation is not met.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { buildGenerationPrompt } = require(path.join(ROOT, 'src/lib/agentGenerator/promptBuilder.js'));
const { validateL5X, formatReport } = require(path.join(ROOT, 'src/lib/agentGenerator/validator.js'));

let failures = 0;
const check = (cond, label) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// ── Part 1: promptBuilder (stops before any API use) ────────────────────────
console.log('\n=== Part 1: promptBuilder — projects/SDC_Servo_PNP.json ===');
const projectPath = path.join(ROOT, 'projects', 'SDC_Servo_PNP.json');
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const smId = project.stateMachines[0].id;

const { stableText, jobText, system, meta } = buildGenerationPrompt(project, smId);
console.log(`  Project:        ${meta.projectName}`);
console.log(`  State machine:  ${meta.smName} (station ${meta.stationNumber})`);
console.log(`  Template:       ${meta.template}  (${meta.templateReason})`);
console.log(`  Rule count:     ${meta.ruleCount}`);
console.log(`  Prompt size:    ${meta.promptChars.toLocaleString()} chars (stable ${meta.stableChars.toLocaleString()} + job ${meta.jobChars.toLocaleString()}, + ${meta.systemChars} system)`);
check(meta.template === 'S05_ServoPNP.L5X', 'servo axes present -> S05_ServoPNP template selected');
check(meta.ruleCount >= 8, `rule count ${meta.ruleCount} >= 8`);
check(!stableText.includes('<RSLogix5000Content'), 'prompt does NOT embed the full template L5X (v1.0.1 extracts only)');
check(stableText.includes('# GENERATION RULES'), 'prompt embeds generationRules.md');
check(stableText.includes('# EDIT PLAN FORMAT'), 'prompt embeds the edit-plan schema');
check(stableText.includes('### Routine R02_StateTransitions'), 'prompt embeds R02 template extract');
check(jobText.includes('# Intermediate Representation'), 'job block embeds the IR');
check(jobText.includes('State 4:'), 'IR carries assigned state numbers');
check(system.length > 0, 'system prompt assembled');

// ── Part 2: validator ────────────────────────────────────────────────────────
console.log('\n=== Part 2: validator — known-good V4.2 AI export ===');
const goodPath = path.join(ROOT, 'plc-reference', 'SDC_PNP_Test', 'S01_ServoPNP_AI_Generated_V42.L5X');
const good = validateL5X(fs.readFileSync(goodPath, 'utf8'));
console.log(formatReport(good).split('\n').map(l => '  ' + l).join('\n'));
check(good.ok, 'S01_ServoPNP_AI_Generated_V42.L5X validates clean');

console.log('\n=== Part 2: validator — old SLD export (expected to fail) ===');
const badPath = path.join(ROOT, 'plc-reference', 'SDC_PNP_Test', 'S01_SDCServoPNP_SLD.L5X');
const bad = validateL5X(fs.readFileSync(badPath, 'utf8'));
console.log(formatReport(bad).split('\n').map(l => '  ' + l).join('\n'));
check(!bad.ok, 'S01_SDCServoPNP_SLD.L5X fails validation');
const errText = bad.errors.join('\n');
check(errText.includes('\\Supervisor'), 'defect detected: unresolved \\Supervisor program reference');
check(errText.includes('\\Alarms'), 'defect detected: unresolved \\Alarms program reference');
check(errText.includes('g_CPUDateTime'), 'defect detected: undeclared g_CPUDateTime controller tag');

// ── Part 3: API key status (no call made) ───────────────────────────────────
console.log('\n=== Part 3: API configuration ===');
const { isConfigured } = require(path.join(ROOT, 'src/lib/agentGenerator/client.js'));
console.log(isConfigured()
  ? '  ANTHROPIC_API_KEY is configured — POST /api/generate is live.'
  : '  ANTHROPIC_API_KEY not set — POST /api/generate will return 503 until a key lands in .env.');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
