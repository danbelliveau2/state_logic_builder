#!/usr/bin/env node
'use strict';
/**
 * shapeLint1160.cjs — "SAME LOOK AND FEEL AS THE EXAMPLES" checker (2026-09-18, Dan + Jason v1.1 review)
 *
 * Dan: "even if you don't have an example, you can't ever create something that doesn't look and feel like
 * the examples you do have … same theory and approach on every station." This script makes that a gate:
 *
 *   1. VOCABULARY   every instruction / AOI call in a program must appear somewhere in the example corpus
 *                   (the job's platform template + SoftwareStandardizationNew.L5X + MidBaseLoad). The project
 *                   file wins over Examples\ (Jason 2026-09-23), so it supplies S04/S05/S06/S08/S10/S18/S19,
 *                   MapInputs, MapOutputs and the SafetyProgram's CROUT shape.
 *   2. SHAPE BUDGET tags, rungs and non-tracking OTL/OTU per program may not exceed the closest example (+25 %).
 *   3. FORBIDDEN    platform-scoped, see PLATFORM: Single Step / Single Cycle / AutoIdle are forbidden on the
 *                   cam chassis and REQUIRED on the dial (Jason 2026-09-18, 2026-09-23); plus
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
  // The platform template for THIS job (cam chassis).
  'plc-reference/training-material/SDC Standard Templates/ChassisStandard_2UP_2026-09-17.L5X',
  // THE PROJECT FILE WINS; Examples is for programs not in it (Jason, 2026-09-23). Every standard
  // example program - S04, S05, S06, S08, S10 pair, S18, S19, MapInputs, MapOutputs, SafetyProgram -
  // now lives in this one export, so it replaces the per-program X_* copies taken from Examples\ and
  // the SafetyProgram slice that supplied CROUT. Do not re-add an Examples copy of a program that is
  // in here: the two drift and the Examples one is the stale side.
  'plc-reference/training-material/SDC Standard Templates/SoftwareStandardizationNew.L5X',
  // MidBaseLoad is our own generated output (sdce v1.4.1), not an SDC example, and it is the file
  // Jason reviewed on 2026-09-01 and found defects in. It stays for ONE reason: its escapement and
  // pick-and-place are the current basis for a self-actuated station, which neither platform standard
  // has, and Jason ruled 2026-09-23 that the architecture is not to change. It is the SIZE reference
  // for the S05_PortLoad / S14_BinDiverter / S01_YSiteEscapement family budget below - nothing else:
  // it contributes zero unique vocabulary (measured), so its defects cannot reach a generated program
  // through this corpus. The FORM comes from Jason's corrected rulings in the knowledge file, never
  // from this file: no part-tracking writes, no CycleStation, no q_StationComplete, no StaNumPre /
  // NestNumIncoming / NestNumCurrent, no AOI_Debounce on a pneumatic position sensor.
  'generated/1160/ref/MidBaseLoad_v1_4_1',
].map((p) => path.join(ROOT, p));

// PLATFORM — three SDC platforms (Jason, 2026-09-23):
//   'chassis-1up'  cam chassis, one nest        ChassisStandard_1UP.L5X          (13 programs, single-sided)
//   'chassis-2up'  cam chassis, two-up          ChassisStandard_2UP_*.L5X        (19 programs, A/B twins)  <- job 1160
//   'dial'         indexing dial / ring         SoftwareStandardizationNew.L5X   (22 programs)
// Single Step / Single Cycle / AutoIdle are a DIAL feature: the dial carries the block in every
// station's R01_Inputs, BOTH chassis variants carry none of it. Chassis_CamPos_Check is the mirror -
// both chassis variants use it, the dial does not. The two chassis variants differ in TWINNING, not
// in these rules, so the gate keys on the family below. Set this when copying the script for a job.
const PLATFORM = 'chassis-2up';
const IS_CHASSIS = PLATFORM.startsWith('chassis');

// closest example per program family: [maxTags, maxRungs, maxNonTrackingLatches, note]
const FAMILIES = [
  [/^S(01_YSiteLoad|02_YVerify|06_PortVerify|13_PhysicalCheck|14_GoodUnload|16_EmptyNest)[AB]$|^S15_RejectUnload$/, [49, 38, 4, 'template cam-listener stations S01/S02/S03/S18/S19/S20 (27-39 tags, 22-30 rungs, 0-3 latches)']],
  [/^S03_YSiteInspect[AB]$|^S12_OpticalCheck$/, [69, 64, 4, "S06_IV4Vision in the project file x2 cameras (55 tags, 51 rungs, 2 latches per camera)"]],
  [/^S07_PortCut[AB]$/, [80, 80, 4, "S06_IV4Vision in the project file + a template pneumatic listener"]],
  [/^S05_PortLoad$|^S14_BinDiverter$|^S01_YSiteEscapement[AB]$/, [105, 110, 2, "MidBaseLoad escapement / pick-and-place, S19_GoodUnload in the project file (72-97 tags, 74-103 rungs, 0 latches)"]],
  [/^S(09_PortCloseB|11_PortCloseA)$/, [140, 135, 3, "S05_ServoPNP in the project file (137 tags, 133 rungs, 2 latches)"]],
  [/^S(08_YHeatB|10_YHeatA)$/, [40, 40, 0, "Jason's OV_PID + HeaterControl_SUB one-zone form (17 heat rungs) + template station R00/R01/R20 block (15) = 32, +25 %; no state machine"]],
];
const ROUTINE_SETS = [
  'R00_Main,R01_Inputs,R02_Logic,R20_Alarms',
  'R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic,R20_Alarms',
  'R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic,R04_ZAxisServo,R20_Alarms',
  'R00_Main,R01_Inputs,R02_Logic,R20_Alarms', // heat programs use the listener routine set (no state machine)
];
const FORBIDDEN = [
  // chassis only — the dial platform requires this block, see PLATFORM above
  ...(IS_CHASSIS ? [
    [/\bSS_OK\b|\bSS\b(?=[",)\s])|SingleStep|SingleCycle|SingleTrigger|SingleClearTracking|SingleDisableTracking|LocalSSONS/, 'single-step', 'Single Step / Single Cycle is not used on SDC chassis stations (Jason 2026-09-18); the dial platform does use it'],
    [/\bAutoIdle\b/, 'auto-idle', 'AutoIdle is not required in any inputs routine on the chassis (Jason 2026-09-18); the dial platform does mirror it'],
  ] : []),
  // dial only — Chassis_CamPos_Check is a chassis AOI. Jason's first SoftwareStandardizationNew export
  // carried it by mistake and he re-exported without it the same day (2026-09-23), so the dial template
  // no longer even defines it; this rule stays as the guard, because a dial station that reached for a
  // cam-position window would be wrong whether or not the template happened to declare the AOI.
  ...(!IS_CHASSIS ? [
    [/\bChassis_CamPos_Check\b/, 'chassis-aoi-on-dial', 'Chassis_CamPos_Check is a chassis AOI (Jason 2026-09-23); a dial station leaves state 4 on \\S00_Indexer*.p_OnStation and CycleStation, not a cam-position window'],
  ] : []),
  [/\bAIN1:[IOC]\b|\bAOUT1:[IOC]\b/, 'module-name-address', 'local modules are addressed Local:<slot>:I - the 5069-IY4 is Local:5:I.Ch0X.Data (Jason 2026-09-18); the 5069-OF8 is gone (feeders are digital on/off)'],
  [/\bSTUB\b|DECLARED EXTENSION|\[CTX\]|\[CALL\]|\[BOM\]|\[ELEC\]|question #|NAMES.CONTRACT|X_ServoPNP|X_FlexFeed|MidBaseLoad|ChassisStandard|S06_IV4Vision|\bJason\b|\bDan\b|\bMark\b|\bMarks\b|\bHailey\b|doctrine|2026-0\d-\d\d|\bv0\.\d\b|\bv1\.\d\b/i, 'provenance-narrative', 'comments and descriptions describe the machine, never the build history or its sources'],
  [/i_Disable[A-Za-z]*Check|Bypass[A-Za-z]*Constant|ApplicationConstant|DebugLatch\b(?![\s\S]*Chassis)/, 'bypass-constant', 'no bypass / application constants - the examples have none'],
  [/(?:^|[\[\s,;)\]])(EQU|NEQ|LES|GRT|LEQ|GEQ|LIM|MOV)\(/, 'legacy-mnemonic', 'PLC-5 / SLC form - Studio v37 uses EQ NE LT GT LE GE LIMIT MEQ CMP and MOVE (Jason 2026-09-21); LIM( is what failed the v1.4 import'],
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
// Jason_return_0918 (OV_PID / HeaterControl_SUB) is deliberately NOT in the corpus: his note ships it as
// "a previous SDC project NOT done using our new standards ... Generated code must use our standard".
// Admitting those files wholesale legalises their old mnemonics (LIM, MOV, EQU, NEQ, GRT, LES); LIM( is what
// failed the v1.4 import. Take the one instruction the heat form needs; the files stay on disk as the
// rung-form reference the NAMES CONTRACT ruling 10 points at.
vocab.add('PID');
// The Compare set, from the Studio v37 instruction tree (Jason, 2026-09-21). Admitted whole so a legitimate
// comparison is never flagged for being absent from the examples - MEQ appears in no example program.
for (const c of ['CMP', 'LIMIT', 'MEQ', 'EQ', 'NE', 'LT', 'GT', 'LE', 'GE']) vocab.add(c);
// AOI_HeatControl: the time-proportional heater output AOI, supplied by Jason as a standalone
// definition (2026-09-22) and declared in the project. Its own body is ST and never reaches a rung.
vocab.add('AOI_HeatControl');

// ── AOI backing-tag shapes, learned from the corpus ──────────────────────────
// An AOI instance's L5K block is a packed MEMORY IMAGE (BOOLs in leading words, then
// the numeric members, locals included, with alignment) - it is not derivable from the
// definition. 1160 v1.6 shipped a hand-written one and Studio rejected it with
// "Data type mismatch". So: a Data block may only be emitted in a shape an example
// already shows for that same AOI. No example instance -> declare the tag alone.
const AOI_NAMES = new Set();
const AOI_L5K_ARITY = new Map();   // AOI type -> Set of top-level L5K counts seen in the corpus
function topLevelCount(l5k) {
  const b = l5k.trim().replace(/^\[/, "").replace(/\]$/, "");
  let d = 0, q = false, n = 1;
  for (const ch of b) {
    if (q) { if (ch === "'") q = false; continue; }
    if (ch === "'") { q = true; continue; }
    if (ch === "[") d++; else if (ch === "]") d--; else if (ch === "," && d === 0) n++;
  }
  return n;
}
function learnAoiShapes(xml) {
  for (const m of xml.matchAll(/<AddOnInstructionDefinition[^>]*\sName="([^"]+)"/g)) AOI_NAMES.add(m[1]);
  for (const m of xml.matchAll(/<Tag\s+Name="[^"]+"[^>]*DataType="([^"]+)"[^>]*>/g)) {
    if (!AOI_NAMES.has(m[1])) continue;
    const i = m.index, j = xml.indexOf("</Tag>", i);
    if (j < 0) continue;
    const l = /<Data Format="L5K">\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml.slice(i, j));
    if (!l) continue;
    if (!AOI_L5K_ARITY.has(m[1])) AOI_L5K_ARITY.set(m[1], new Set());
    AOI_L5K_ARITY.get(m[1]).add(topLevelCount(l[1]));
  }
}
for (const f of CORPUS.flatMap((p) => walk(p))) learnAoiShapes(readText(f));
// the job's own AOI definitions name types the corpus may not carry
for (const f of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const defs = path.join(path.dirname(f), "..", "controller", "AddOnInstructionDefinitions.xml");
  if (fs.existsSync(defs)) { for (const m of readText(defs).matchAll(/<AddOnInstructionDefinition[^>]*\sName="([^"]+)"/g)) AOI_NAMES.add(m[1]); break; }
}

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
  // 4b. AOI backing-tag data
  for (const m of body.matchAll(/<Tag\s+Name="([^"]+)"[^>]*DataType="([^"]+)"[^>]*>/g)) {
    if (!AOI_NAMES.has(m[2])) continue;
    const i = m.index, j = body.indexOf('</Tag>', i);
    if (j < 0) continue;
    const l = /<Data Format="L5K">\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(body.slice(i, j));
    if (!l) continue;   // declaration only - always safe, Studio initialises from the definition
    const seen = AOI_L5K_ARITY.get(m[2]);
    const n = topLevelCount(l[1]);
    if (!seen) fail('aoi-backing-data', m[1], `AOI backing tag "${m[1]}" (${m[2]}) carries a data block but no example instance of ${m[2]} exists to copy its shape from - the L5K image is a packed memory layout, not derivable; declare the tag with no <Data> block`);
    else if (!seen.has(n)) fail('aoi-backing-data', m[1], `AOI backing tag "${m[1]}" (${m[2]}) has an L5K block of ${n} top-level values; the example instances have ${[...seen].join(' or ')} - copy the example shape or declare the tag with no <Data> block`);
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
