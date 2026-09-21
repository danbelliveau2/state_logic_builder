#!/usr/bin/env node
'use strict';
/**
 * shapeLint1160.cjs — "SAME LOOK AND FEEL AS THE EXAMPLES" checker (2026-09-18, Dan + Jason v1.1 review)
 *
 * Dan: "even if you don't have an example, you can't ever create something that doesn't look and feel like
 * the examples you do have … same theory and approach on every station." This script makes that a gate:
 *
 *   1. VOCABULARY   every instruction / AOI call in a program must appear somewhere in the example corpus
 *                   (2-UP chassis template, Jason's X-drive examples, MidBaseLoad, his IV4 package, his heater PID,
 *                   plus the SoftwareStandardization SafetyProgram alone for the contract's CROUT safety-output shape).
 *   2. SHAPE BUDGET tags, rungs and non-tracking OTL/OTU per program may not exceed the closest example (+25 %).
 *   3. FORBIDDEN    Single Step / Single Cycle / AutoIdle (Jason 2026-09-18: not used on chassis stations),
 *                   AIN1:/AOUT1: module-name addressing (local modules are Local:<slot>:I), bypass constants,
 *                   provenance narrative in comments (STUB, DECLARED EXTENSION, [CTX], names, dates).
 *   4. WORDING      rung comments = one sentence (Jason); tag descriptions <= 30 characters (Jason).
 *   5. ROUTINES     routine set must be one the examples use.
 *   6. SCHEDULE     MapInputs first in MainTask (Jason); heat programs in a 1 s periodic task (Jason).
 *
 * Run:  node scripts/shapeLint1160.cjs [file.xml ...]      (default: every program in generated/1160/build/programs)
 *       node scripts/shapeLint1160.cjs --json               (machine-readable)
 * Exit: 0 clean, 1 findings.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROG_DIR = path.join(ROOT, 'generated/1160/build/programs');
const TASKS = path.join(ROOT, 'generated/1160/build/controller/Tasks.xml');
const CORPUS = [
  'plc-reference/training-material/SDC Standard Templates/ChassisStandard_2UP_2026-09-17.L5X',
  'generated/1160/ref/X_FlexFeedConveyor', 'generated/1160/ref/X_GoodUnload', 'generated/1160/ref/X_RejectUnload',
  'generated/1160/ref/X_PartVerify', 'generated/1160/ref/X_ServoPNP', 'generated/1160/ref/X_MapInputs', 'generated/1160/ref/X_MapOutputs',
  'generated/1160/ref/MidBaseLoad_v1_4_1', 'generated/1160/ref/Jason_IV4', 'generated/1160/ref/Jason_return_0918',
  // SoftwareStandardization SafetyProgram ONLY (one file, not the 18-program project): the NAMES CONTRACT SafetyProgram
  // row asks for its "V4.2 CROUT NEGATIVE/200 shape" for SO1 guard-door relay / SO2 heater contactor, and
  // jason-engineer-additions 2026-09-01: "SoftwareStandardization.L5X should be generating code, not only informing it".
  // The 2-UP template has no such output rung. Adds exactly one name (CROUT) to the vocabulary; ratification is the
  // SafetyProgram cover-note question (v1.3) - narrow back if Jason says the Air Dump Valve plain OTE form instead.
  'generated/1160/ref/SoftwareStandardization/Program_SafetyProgram.xml',
].map((p) => path.join(ROOT, p));

// closest example per program family: [maxTags, maxRungs, maxNonTrackingLatches, note]
const FAMILIES = [
  [/^S(01_YSiteLoad|02_YVerify|06_PortVerify|13_PhysicalCheck|14_GoodUnload|16_EmptyNest)[AB]$|^S15_RejectUnload$/, [49, 38, 4, 'template cam-listener stations S01/S02/S03/S18/S19/S20 (27-39 tags, 22-30 rungs, 0-3 latches)']],
  [/^S03_YSiteInspect[AB]$|^S12_OpticalCheck$/, [69, 64, 4, "Jason's S06_IV4Vision x2 cameras (55 tags, 51 rungs, 2 latches per camera)"]],
  [/^S07_PortCut[AB]$/, [80, 80, 4, "Jason's S06_IV4Vision + a template pneumatic listener"]],
  [/^S05_PortLoad$|^S14_BinDiverter$|^S01_YSiteEscapement[AB]$/, [105, 110, 2, "Jason's MidBaseLoad escapement / pick-and-place, X_GoodUnload (72-97 tags, 74-103 rungs, 0 latches)"]],
  [/^S(09_PortCloseB|11_PortCloseA)$/, [140, 135, 3, "Jason's X_ServoPNP (137 tags, 133 rungs, 2 latches)"]],
  [/^S(08_YHeatB|10_YHeatA)$/, [40, 40, 0, "Jason's OV_PID + HeaterControl_SUB one-zone form (17 heat rungs) + template station R00/R01/R20 block (15) = 32, +25 %; no state machine"]],
];
const ROUTINE_SETS = [
  'R00_Main,R01_Inputs,R02_Logic,R20_Alarms',
  'R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic,R20_Alarms',
  'R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic,R04_ZAxisServo,R20_Alarms',
  'R00_Main,R01_Inputs,R02_Logic,R20_Alarms', // heat programs use the listener routine set (no state machine)
];
const FORBIDDEN = [
  [/\bSS_OK\b|\bSS\b(?=[",)\s])|SingleStep|SingleCycle|SingleTrigger|SingleClearTracking|SingleDisableTracking|LocalSSONS/, 'single-step', 'Single Step / Single Cycle is not used on SDC chassis stations (Jason 2026-09-18)'],
  [/\bAutoIdle\b/, 'auto-idle', 'AutoIdle is not required in any inputs routine (Jason 2026-09-18)'],
  [/\bAIN1:[IOC]\b|\bAOUT1:[IOC]\b/, 'module-name-address', 'local modules are addressed Local:<slot>:I - the 5069-IY4 is Local:5:I.Ch0X.Data (Jason 2026-09-18); the 5069-OF8 is gone (feeders are digital on/off)'],
  [/\bSTUB\b|DECLARED EXTENSION|\[CTX\]|\[CALL\]|\[BOM\]|\[ELEC\]|question #|NAMES.CONTRACT|X_ServoPNP|X_FlexFeed|MidBaseLoad|ChassisStandard|S06_IV4Vision|\bJason\b|\bDan\b|\bMark\b|\bMarks\b|\bHailey\b|doctrine|2026-0\d-\d\d|\bv0\.\d\b|\bv1\.\d\b/i, 'provenance-narrative', 'comments and descriptions describe the machine, never the build history or its sources'],
  [/i_Disable[A-Za-z]*Check|Bypass[A-Za-z]*Constant|ApplicationConstant|DebugLatch\b(?![\s\S]*Chassis)/, 'bypass-constant', 'no bypass / application constants - the examples have none'],
];

function readText(f) { return fs.readFileSync(f, 'utf8'); }
function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
  else if (/\.(xml|L5X|l5x)$/i.test(p)) out.push(p);
  return out;
}
function rungTexts(xml) { return [...xml.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1]); }
function calls(text) { return [...text.matchAll(/(?:^|[\[\s,;)\]])([A-Za-z_][A-Za-z0-9_]*)\(/g)].map((m) => m[1]); }

// ── corpus vocabulary ────────────────────────────────────────────────────────
const vocab = new Set();
for (const f of CORPUS.flatMap((p) => walk(p))) for (const t of rungTexts(readText(f))) for (const c of calls(t)) vocab.add(c);
vocab.add('NOP'); vocab.add('JSR');

// ── per-program checks ───────────────────────────────────────────────────────
function programsIn(xml) {
  return [...xml.matchAll(/<Program\b[^>]*?\sName="([^"]+)"[^>]*>([\s\S]*?)<\/Program>/g)].map((m) => ({ name: m[1], body: m[0] }));
}
function lintProgram(p, file) {
  const F = [];
  const fail = (rule, where, msg) => F.push({ program: p.name, file: path.relative(ROOT, file), rule, where, msg });
  const fam = FAMILIES.find(([re]) => re.test(p.name));
  const isStation = /^S\d\d_/.test(p.name);
  const body = p.body;
  // 1. vocabulary
  const used = new Set();
  for (const t of rungTexts(body)) for (const c of calls(t)) used.add(c);
  for (const c of used) if (!vocab.has(c)) fail('vocabulary', c, `instruction/AOI "${c}" appears in no example program - use the form the examples use`);
  // 2. shape budget
  if (fam) {
    const [, [maxTags, maxRungs, maxLatch, note]] = fam;
    const tags = (body.match(/<Tag\s/g) || []).length;
    const rungs = (body.match(/<Rung\s/g) || []).length;
    const latches = [...body.matchAll(/OT[LU]\(([^)]+)\)/g)].map((m) => m[1]).filter((o) => !/p_Data/.test(o));
    if (tags > maxTags) fail('shape-tags', `${tags} tags`, `more tags than the closest example allows (max ${maxTags}; ${note})`);
    if (rungs > maxRungs) fail('shape-rungs', `${rungs} rungs`, `more rungs than the closest example allows (max ${maxRungs}; ${note})`);
    if (latches.length > maxLatch) fail('shape-latches', `${latches.length} non-tracking OTL/OTU`, `internal latches beyond the example (max ${maxLatch}): ${[...new Set(latches)].slice(0, 8).join(', ')} - use OTE forms as the examples do`);
  }
  // 3. forbidden tokens
  for (const [re, rule, msg] of FORBIDDEN) {
    const m = body.match(re);
    if (m) fail(rule, m[0], msg);
  }
  // 4. wording (station programs only - template service programs carry Jason's own text)
  if (isStation) {
    for (const m of body.matchAll(/<Rung\s+Number="(\d+)"[^>]*>[\s\S]*?<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
      const c = m[2].replace(/\s+/g, ' ').trim();
      const routine = (body.slice(0, m.index).match(/<Routine\s+Name="([^"]+)"[^>]*>(?![\s\S]*<Routine\s)/) || [])[1] || '?';
      if (c.length > 160 || /[.!?]\s+[A-Z(\\]/.test(c)) fail('comment-one-sentence', `${routine} rung ${m[1]}`, `rung comment must be one concise sentence (Jason 2026-09-18): "${c.slice(0, 90)}${c.length > 90 ? '…' : ''}"`);
    }
    const tagsSec = (body.match(/<Tags>([\s\S]*?)<\/Tags>/) || [])[1] || '';
    for (const m of tagsSec.matchAll(/<Tag\s+Name="([^"]+)"[^>]*>[\s\S]*?<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
      const d = m[2].trim();
      if (d.length > 30) fail('description-30', m[1], `tag description is ${d.length} characters, limit 30 (Jason 2026-09-18): "${d.slice(0, 60)}${d.length > 60 ? '…' : ''}"`);
    }
  }
  // 5. routine set
  if (isStation) {
    const set = [...body.matchAll(/<Routine\s+Name="([^"]+)"/g)].map((m) => m[1]).join(',');
    if (!ROUTINE_SETS.includes(set)) fail('routine-set', set, `routine set is not one the examples use (${ROUTINE_SETS.slice(0, 3).join(' | ')})`);
  }
  return F;
}

// ── schedule checks ──────────────────────────────────────────────────────────
function lintTasks() {
  const F = [];
  if (!fs.existsSync(TASKS)) return F;
  const t = readText(TASKS);
  const main = t.match(/<Task\s+Name="MainTask"[^>]*>([\s\S]*?)<\/Task>/);
  const first = main && (main[1].match(/<ScheduledProgram\s+Name="([^"]+)"/) || [])[1];
  if (first !== 'MapInputs') F.push({ program: 'Tasks', file: 'generated/1160/build/controller/Tasks.xml', rule: 'mapinputs-first', where: first || 'none', msg: 'MapInputs must be the first program executed in MainTask (Jason 2026-09-18)' });
  const heat = t.match(/<Task\s+Name="[^"]+"\s+Type="PERIODIC"\s+Rate="1000"[^>]*>([\s\S]*?)<\/Task>/);
  const heatProgs = heat ? [...heat[1].matchAll(/<ScheduledProgram\s+Name="([^"]+)"/g)].map((m) => m[1]) : [];
  if (heatProgs.join() !== 'HeatControl') F.push({ program: 'HeatControl', file: 'generated/1160/build/controller/Tasks.xml', rule: 'heat-periodic-task', where: heatProgs.join(',') || 'none', msg: 'exactly ONE program (HeatControl: R00_Main + R02_Logic with the PID loops) runs in the 1 s periodic task; the rest of the heat logic is S08_YHeatB / S10_YHeatA in MainTask (Jason 2026-09-18 15:21)' });
  for (const p of ['S08_YHeatB', 'S10_YHeatA']) if (!main || !main[1].includes(`Name="${p}"`)) F.push({ program: p, file: 'generated/1160/build/controller/Tasks.xml', rule: 'heat-station-maintask', where: p, msg: 'the station heat program belongs in MainTask in standard SDC format (Jason 2026-09-18 15:21)' });
  return F;
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
const targets = files.length ? files.map((f) => path.resolve(f)) : fs.readdirSync(PROG_DIR).filter((f) => /^[A-Za-z].*\.xml$/.test(f)).map((f) => path.join(PROG_DIR, f));
let findings = [];
for (const f of targets) for (const p of programsIn(readText(f))) findings.push(...lintProgram(p, f));
if (!files.length) findings.push(...lintTasks());

if (json) console.log(JSON.stringify({ vocabulary: [...vocab].sort(), findings }, null, 2));
else {
  const by = new Map();
  for (const f of findings) { if (!by.has(f.program)) by.set(f.program, []); by.get(f.program).push(f); }
  for (const [prog, list] of by) {
    console.log(`\n== ${prog}  (${list.length} finding${list.length === 1 ? '' : 's'})`);
    const grouped = new Map();
    for (const f of list) { if (!grouped.has(f.rule)) grouped.set(f.rule, []); grouped.get(f.rule).push(f); }
    for (const [rule, fs2] of grouped) {
      console.log(`  ${rule}: ${fs2.length}`);
      for (const f of fs2.slice(0, rule.startsWith('description') || rule.startsWith('comment') ? 6 : 12)) console.log(`     - ${f.where}: ${f.msg}`);
      if (fs2.length > 6 && (rule.startsWith('description') || rule.startsWith('comment'))) console.log(`     … ${fs2.length - 6} more`);
    }
  }
  console.log(`\nshapeLint1160: ${findings.length} finding(s) in ${by.size} program(s); corpus vocabulary ${vocab.size} instruction/AOI names`);
}
process.exit(findings.length ? 1 : 0);
