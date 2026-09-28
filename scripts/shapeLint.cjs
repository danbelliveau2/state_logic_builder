#!/usr/bin/env node
'use strict';
/**
 * shapeLint.cjs — "SAME LOOK AND FEEL AS THE EXAMPLES" checker (2026-09-18, Dan + Jason v1.1 review)
 *
 * Dan: "even if you don't have an example, you can't ever create something that doesn't look and feel like
 * the examples you do have … same theory and approach on every station." This script makes that a gate:
 *
 *   1. VOCABULARY   every instruction / AOI call in a program must appear somewhere in the example corpus.
 *                   The project file wins over Examples\ (Jason 2026-09-23).
 *   2. SHAPE BUDGET tags, rungs and non-tracking OTL/OTU per program may not exceed the closest example (+25 %).
 *   3. FORBIDDEN    platform-scoped (see JOB.platform): Single Step / Single Cycle / AutoIdle are forbidden on
 *                   the cam chassis and REQUIRED on the dial (Jason 2026-09-18, 2026-09-23); Chassis_CamPos_Check
 *                   is the mirror. Plus AIN1:/AOUT1: module-name addressing, bypass constants, PLC-5 mnemonics,
 *                   provenance narrative in comments.
 *   4. WORDING      rung comments = one sentence (Jason); tag descriptions <= 30 characters (Jason).
 *   5. ROUTINES     routine set must be one the examples use.
 *   6. AOI DATA     an AOI backing tag may carry a <Data> block only in a shape an example instance shows.
 *   7. SCHEDULE     MapInputs first in MainTask (Jason); heat programs in the 1 s periodic task (Jason).
 *
 * FOR A NEW JOB: edit the JOB block below and nothing else. Everything under it is platform- and
 * job-independent (Jason, 2026-09-23 — this replaces forking a per-job copy of the script).
 *
 * Run:  node scripts/shapeLint.cjs [file.xml ...]      (default: every program in JOB.progDir)
 *       node scripts/shapeLint.cjs --json               (machine-readable)
 * Exit: 0 clean, 1 findings.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ═══════════════════════════════════════════════════════════════════════════════
// JOB CONFIG — the only part that changes per job
// ═══════════════════════════════════════════════════════════════════════════════
const JOB = {
  id: '1131',

  // 'chassis-1up' cam chassis, one nest      ChassisStandard_1UP.L5X        (13 programs, single-sided)
  // 'chassis-2up' cam chassis, two-up        ChassisStandard_2UP_*.L5X      (19 programs, A/B twins)
  // 'dial'        indexing dial / ring       SoftwareStandardizationNew.L5X (22 programs)
  // 'standalone'  no indexer, no cams        1131 Tarkett (Dan 2026-09-28, D006): services from the standard project,
  //               stations self-actuated with p_ handshakes; single step is the StateMachine-skeleton HMI_Toggle form
  platform: 'standalone',

  progDir: 'generated/1131/build/programs',
  tasks: 'generated/1131/build/controller/Tasks.xml',

  corpus: [
    // THE PROJECT FILE WINS (Jason 2026-09-23): every standard program - S05_ServoPNP, S06_IV4Vision, S10_FlexFeedConveyor,
    // Supervisor, Alarms, HMI, Production, Recipe, MapInputs/MapOutputs, StateMachine, SafetyProgram - is in this export.
    'plc-reference/training-material/SDC Standard Templates/SoftwareStandardizationNew.L5X',
  ],

  // Instructions this job legitimately uses that the corpus cannot supply.
  vocabularyExtras: {
    // Outfeed gantry picks on the fly: X is geared to the belt axis while the pick happens (John Stanko P06 R04 rung 27,
    // commissioned). No template carries gearing - PROPOSED NON-STANDARD PATTERN named in the cover note.
    MAG: 'outfeed gantry X geared to the outfeed belt axis for the pick on the fly',
    // Vendor IO-Link AOI on the 1734-4IOL (ifm O1D100 stack-height laser), called from MapInputs.
    O1D100_Decode: 'ifm O1D100 IO-Link laser decode (John Stanko, commissioned)',
    // GuardLogix safety instructions in the two carried-verbatim safety programs.
    LC: 'light curtain (SafetyProgramLoader/Unloader, verbatim)',
    TSSM: 'two-sensor muting (SafetyProgramLoader/Unloader, verbatim)',
    CROUT: 'monitored safety output (SafetyProgramLoader/Unloader, verbatim)',
    MSG: 'Timesavers peer PLC stubs (Communications, verbatim)',
    OSR: 'one-shot rising in the two carried-verbatim safety programs (SafetyProgramLoader/Unloader)',
  },

  // closest example per program family: [maxTags, maxRungs, maxNonTrackingLatches, note]
  families: [
    [/^S03_InfeedGantry$/, [175, 167, 4, 'S05_ServoPNP in the project file (137 tags, 133 rungs, 2 latches) +25 %; +3 tags for the master Restart Logic rung (UseRestartLogic) and the two safety axis-stop reads the review required']],
    [/^S07_OutfeedGantry$/, [205, 195, 6, 'S05_ServoPNP (137/133) + gearing rungs + gauge place/retrieve branch (PROPOSED NON-STANDARD PATTERN)']],
    [/^S0(1_InfeedCart|9_OutfeedCart)$/, [160, 150, 4, 'S05_ServoPNP one-axis half (~95/90) + 12 pneumatic devices with derived states (~50/45) +25 %']],
    [/^S0(2_InfeedVision|6_OutfeedVision)$/, [120, 110, 4, 'S06_IV4Vision (55 tags, 51 rungs) + S05 single-axis block (~40/35) +25 %']],
    [/^S0(4_InfeedConveyor|5_OutfeedConveyor)$/, [110, 100, 2, 'S10_FlexFeedConveyor in the project file (~95 tags, 93 rungs) +25 %']],
    [/^S08_ThicknessGauge$/, [120, 115, 4, 'StateMachine skeleton (35 rungs) + 6 pneumatic devices + 4 analog probes + ConsecFails (S04_PartVerify form) +25 %']],
  ],

  // Task schedule this job must satisfy. heatStationPrograms: [] when a job has no heaters.
  schedule: {
    heatTaskRateMs: 1000,
    heatTaskProgram: 'HeatControl',
    heatStationPrograms: [],
  },
};
// END JOB CONFIG — everything below is general
// ═══════════════════════════════════════════════════════════════════════════════

const PROG_DIR = path.join(ROOT, JOB.progDir);
const TASKS = path.join(ROOT, JOB.tasks);
const CORPUS = JOB.corpus.map((p) => path.join(ROOT, p));
const FAMILIES = JOB.families;
const IS_CHASSIS = JOB.platform.startsWith('chassis');

const ROUTINE_SETS = [
  "R00_Main,R01_Inputs,R02_Logic,R20_Alarms",
  "R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic,R20_Alarms",
  "R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic,R04_ZAxisServo,R20_Alarms",
];
// A station may carry one or two per-axis servo routines, R04_{Axis}Servo[,R05_{Axis}Servo] (S05_ServoPNP form: R04_XAxisServo,R05_ZAxisServo).
const ROUTINE_SET_RE = /^R00_Main,R01_Inputs,R02_StateTransitions,R03_StateLogic(,R04_[A-Z][A-Za-z]*AxisServo(,R05_[A-Z][A-Za-z]*AxisServo)?)?,R20_Alarms$/;
const FORBIDDEN = [
  // chassis only — the dial platform requires this block
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
// The Compare set, from the Studio v37 instruction tree (Jason, 2026-09-21). Admitted whole so a legitimate
// comparison is never flagged for being absent from the examples - MEQ appears in no example program.
for (const c of ['CMP', 'LIMIT', 'MEQ', 'EQ', 'NE', 'LT', 'GT', 'LE', 'GE']) vocab.add(c);
for (const c of Object.keys(JOB.vocabularyExtras)) vocab.add(c);

// ── AOI backing-tag shapes, learned from the corpus ──────────────────────────
// An AOI instance's L5K block is a packed MEMORY IMAGE (BOOLs in leading words, then the numeric
// members, locals included, with alignment) - it is not derivable from the definition. 1160 v1.6
// shipped a hand-written one and Studio rejected it with "Data type mismatch". So: a Data block may
// only be emitted in a shape an example already shows for that same AOI. No example instance ->
// declare the tag alone and let Studio initialise it.
const AOI_NAMES = new Set();
const AOI_L5K_ARITY = new Map();   // AOI type -> Set of top-level L5K counts seen in the corpus
function topLevelCount(l5k) {
  const b = l5k.trim().replace(/^\[/, '').replace(/\]$/, '');
  let d = 0, q = false, n = 1;
  for (const ch of b) {
    if (q) { if (ch === "'") q = false; continue; }
    if (ch === "'") { q = true; continue; }
    if (ch === '[') d++; else if (ch === ']') d--; else if (ch === ',' && d === 0) n++;
  }
  return n;
}
function learnAoiShapes(xml) {
  for (const m of xml.matchAll(/<AddOnInstructionDefinition[^>]*\sName="([^"]+)"/g)) AOI_NAMES.add(m[1]);
  for (const m of xml.matchAll(/<Tag\s+Name="[^"]+"[^>]*DataType="([^"]+)"[^>]*>/g)) {
    if (!AOI_NAMES.has(m[1])) continue;
    if (m[0].trimEnd().endsWith('/>')) continue;   // declaration-only; no body to learn from
    const i = m.index, j = xml.indexOf('</Tag>', i);
    if (j < 0) continue;
    const l = /<Data Format="L5K">\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml.slice(i, j));
    if (!l) continue;
    if (!AOI_L5K_ARITY.has(m[1])) AOI_L5K_ARITY.set(m[1], new Set());
    AOI_L5K_ARITY.get(m[1]).add(topLevelCount(l[1]));
  }
}
for (const f of CORPUS.flatMap((p) => walk(p))) learnAoiShapes(readText(f));
// the job's own AOI definitions name types the corpus may not carry
for (const f of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const defs = path.join(path.dirname(f), '..', 'controller', 'AddOnInstructionDefinitions.xml');
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
    // A self-closing <Tag .../> is declaration-only and has no body. Without this guard the
    // slice below runs past it to the NEXT tag's </Tag> and reads that tag's <Data> as if it
    // belonged to the AOI - which is how the 1158 delivery showed 12 phantom errors against a
    // correctly declared AOI_TorqueHome (the members were the following MOTION_INSTRUCTION's).
    if (m[0].trimEnd().endsWith('/>')) continue;
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
    if (!ROUTINE_SETS.includes(set) && !ROUTINE_SET_RE.test(set)) fail('routine-set', set, `routine set is not one the examples use (${ROUTINE_SETS.slice(0, 3).join(' | ')})`);
  }
  return F;
}

// ── schedule checks ──────────────────────────────────────────────────────────
function lintTasks() {
  const F = [];
  if (!fs.existsSync(TASKS)) return F;
  const rel = JOB.tasks;
  const t = readText(TASKS);
  const main = t.match(/<Task\s+Name="MainTask"[^>]*>([\s\S]*?)<\/Task>/);
  const first = main && (main[1].match(/<ScheduledProgram\s+Name="([^"]+)"/) || [])[1];
  if (first !== 'MapInputs') F.push({ program: 'Tasks', file: rel, rule: 'mapinputs-first', where: first || 'none', msg: 'MapInputs must be the first program executed in MainTask (Jason 2026-09-18)' });
  const S = JOB.schedule;
  if (S.heatStationPrograms.length) {
    const heat = t.match(new RegExp('<Task\\s+Name="[^"]+"\\s+Type="PERIODIC"\\s+Rate="' + S.heatTaskRateMs + '"[^>]*>([\\s\\S]*?)</Task>'));
    const heatProgs = heat ? [...heat[1].matchAll(/<ScheduledProgram\s+Name="([^"]+)"/g)].map((m) => m[1]) : [];
    if (heatProgs.join() !== S.heatTaskProgram) F.push({ program: S.heatTaskProgram, file: rel, rule: 'heat-periodic-task', where: heatProgs.join(',') || 'none', msg: `exactly ONE program (${S.heatTaskProgram}: R00_Main + R02_Logic with the PID loops) runs in the ${S.heatTaskRateMs / 1000} s periodic task; the rest of the heat logic is ${S.heatStationPrograms.join(' / ')} in MainTask (Jason 2026-09-18 15:21)` });
    for (const p of S.heatStationPrograms) if (!main || !main[1].includes(`Name="${p}"`)) F.push({ program: p, file: rel, rule: 'heat-station-maintask', where: p, msg: 'the station heat program belongs in MainTask in standard SDC format (Jason 2026-09-18 15:21)' });
  }
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

if (json) console.log(JSON.stringify({ job: JOB.id, platform: JOB.platform, vocabulary: [...vocab].sort(), findings }, null, 2));
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
  console.log(`\nshapeLint [job ${JOB.id}, ${JOB.platform}]: ${findings.length} finding(s) in ${by.size} program(s); corpus vocabulary ${vocab.size} instruction/AOI names`);
}
process.exit(findings.length ? 1 : 0);
