#!/usr/bin/env node
/**
 * jarvisDailyTraining.cjs — curriculum-driven daily training for Jarvis.
 *
 * Dan's directive (2026-08): "Every day you should be training on more SDC
 * code... vision, laser markers, robots, everything you possibly can, based on
 * our standards, so that you think and act and code like an SDC controls
 * engineer."
 *
 * What it does:
 *   1. Builds/refreshes jarvis-knowledge/curriculum.json — an inventory of the
 *      whole ingested corpus (plc-reference/standard, standards-docs,
 *      training-material, training-queue, analysis) with topic tags, status
 *      (unstudied / studied / needs-restudy), and the concept file(s) each
 *      item's lessons land in. Hash changes flip studied → needs-restudy.
 *   2. Picks the highest-value unstudied (or needs-restudy) item.
 *   3. Studies it DEEPLY in ONE model pass (budget-capped, ~$1-2/day) and
 *      DEEPENS the relevant jarvis-knowledge/concepts/*.md files — integrated
 *      understanding with sources cited, never appended rule lists
 *      (concepts-not-rules doctrine). Anti-pattern items study into
 *      anti-patterns.md ONLY.
 *   4. Logs to plc-reference/analysis/TRAINING_LOG.md, updates the manifest,
 *      files concept-level questions (API if up, questions.json otherwise).
 *
 * Usage:
 *   node scripts/jarvisDailyTraining.cjs --dry-run          # $0: manifest + selection only
 *   node scripts/jarvisDailyTraining.cjs                    # full daily cycle (one model call)
 *   node scripts/jarvisDailyTraining.cjs --study <id|path>  # study a specific item
 *   node scripts/jarvisDailyTraining.cjs --intake <absPath> --topic <topic> [--resolve <questionId>] [--no-study]
 *       # example intake (used by POST /api/jarvis/examples): register a
 *       # provided example as highest-priority, study it immediately.
 *   node scripts/jarvisDailyTraining.cjs --budget 2         # USD cap for the study call (default 2)
 *
 * Requires ANTHROPIC_API_KEY in .env for real runs (not for --dry-run).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PLC_REF = path.join(ROOT, 'plc-reference');
const CONCEPTS_DIR = path.join(ROOT, 'jarvis-knowledge', 'concepts');
const MANIFEST_PATH = path.join(ROOT, 'jarvis-knowledge', 'curriculum.json');
const QUESTIONS_PATH = path.join(ROOT, 'jarvis-knowledge', 'questions.json');
const TRAINING_LOG = path.join(PLC_REF, 'analysis', 'TRAINING_LOG.md');
const GOLDEN_GAPS = path.join(PLC_REF, 'analysis', 'GOLDEN_GAPS.md');

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (_) {}
}
loadEnv();

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
// $ per M tokens — same table as agentGenerator/client.js
const PRICING = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-fable-5': { in: 5, out: 25 },
};
const price = PRICING[MODEL] || PRICING['claude-opus-5'];

// ── topic model ──────────────────────────────────────────────────────────────
// topic → concept file(s) its lessons land in
const TOPIC_CONCEPTS = {
  'vision':          ['vision-systems.md'],
  'robot':           ['station-archetypes.md', 'coordination.md'],
  'indexer':         ['coordination.md', 'station-archetypes.md'],
  'chassis-cam':     ['servo-motion.md', 'station-archetypes.md'],
  'servo':           ['servo-motion.md'],
  'alarms':          ['alarms.md'],
  'part-tracking':   ['coordination.md'],
  'production-oee':  ['production-and-operator.md'],
  'hmi':             ['production-and-operator.md'],
  'pneumatics':      ['pneumatics.md'],
  'laser-marker':    ['station-archetypes.md'],
  'recipe':          ['production-and-operator.md'],
  'sensors':         ['pneumatics.md'],
  'naming-structure': ['naming-and-structure.md'],
  'process':         ['naming-and-structure.md'],
  'anti-pattern':    ['anti-patterns.md'],
};

// Coverage-goal weights (Dan's directive). Higher = studied sooner.
const TOPIC_WEIGHT = {
  'vision': 100, 'laser-marker': 95, 'robot': 90, 'indexer': 85,
  'chassis-cam': 80, 'alarms': 75, 'production-oee': 70, 'part-tracking': 65,
  'servo': 60, 'recipe': 55, 'pneumatics': 50, 'hmi': 45, 'sensors': 40,
  'naming-structure': 35, 'process': 30, 'anti-pattern': 25,
};

// Path/filename → topics (checked lowercase)
const PATH_TOPIC_RULES = [
  [/\bvision\b|keyence|cv[-_ ]?x/i, 'vision'],
  [/laser[-_ ]?mark|telesis|ipg/i, 'laser-marker'],
  [/robot|flexfeeder|\beda\b/i, 'robot'], // \b: "TimeDate" contains "eDa"
  [/indexer|dial/i, 'indexer'],
  [/chassis/i, 'chassis-cam'],
  [/servo|motors?_cables?_drives|pnp/i, 'servo'],
  [/alarm/i, 'alarms'],
  [/oee|production|cycletime|cycle.time/i, 'production-oee'],
  [/hmi/i, 'hmi'],
  [/pneumatic/i, 'pneumatics'],
  [/recipe/i, 'recipe'],
  [/sensor/i, 'sensors'],
  [/standardization, rev|naming|tech note|template revision/i, 'naming-structure'],
  [/debug and testing|hardware specification/i, 'process'],
];

// L5X content sniff → topics
const CONTENT_TOPIC_RULES = [
  [/MAPC|CAM_PROFILE|MCCP/i, 'chassis-cam'],
  // marker-specific tokens only — "laser" alone hits laser SENSORS in the
  // standards docs and would falsely close the laser-marker gap
  [/Telesis|IPG_YLR|Laser[_ ]?Mark|LaserData|LaserInspect/i, 'laser-marker'],
  [/\bVision\b|Keyence|CameraTrigger|InspectJob/i, 'vision'], // \b: "Revision" is not vision
  [/RobotStatus|\bEDA[_0-9]/i, 'robot'],
  [/q_WaitStationsComplete|Indexer/i, 'indexer'],
  [/AXIS_CIP_DRIVE|\bMAM\b/, 'servo'],
  [/AlarmHandler|TopAlarms/i, 'alarms'],
  [/\bOEE\b|ProductionData/i, 'production-oee'],
  [/Tracking\.p_Data|PartTracking/i, 'part-tracking'],
  [/Debounce|q_Extend|q_Retract/, 'pneumatics'],
];

// ── corpus scan ──────────────────────────────────────────────────────────────
const SCAN_ROOTS = [
  ['standard', 'template'],
  ['standards-docs', 'standards-doc'],
  ['training-material', 'training-material'],
  ['training-queue', 'intake'],
  ['analysis', 'analysis'],
];
const SKIP_DIRS = /SDC_PNP_Test/i; // benchmark artifacts, not study material
// Training OUTPUTS are not study material — scanning them creates a
// self-referential loop (every run appends to the log → hash change → restudy)
const SKIP_FILES = /TRAINING_LOG\.md$|GOLDEN_GAPS\.md$/i;
const STUDYABLE_EXT = /\.(l5x|md|txt)$/i; // .docx/.xlsx studied via their .extracted.md

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.test(p)) walk(p, out); }
    else out.push(p);
  }
  return out;
}

function sha12(buf) { return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12); }
function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

function tagTopics(relPath, content) {
  const topics = new Set();
  for (const [re, t] of PATH_TOPIC_RULES) if (re.test(relPath)) topics.add(t);
  if (content) for (const [re, t] of CONTENT_TOPIC_RULES) if (re.test(content)) topics.add(t);
  if (/Examples NOT Following/i.test(relPath)) topics.add('anti-pattern');
  if (topics.size === 0) topics.add('naming-structure');
  return [...topics];
}

function conceptFilesFor(topics, antiPattern) {
  if (antiPattern) return ['anti-patterns.md']; // anti-pattern lessons land here ONLY
  // top-3 topics by weight — one deep pass deepens a focused set, not everything
  const top = [...topics].sort((a, b) => (TOPIC_WEIGHT[b] || 0) - (TOPIC_WEIGHT[a] || 0)).slice(0, 3);
  const files = new Set();
  for (const t of top) for (const f of (TOPIC_CONCEPTS[t] || [])) files.add(f);
  return [...files].slice(0, 3);
}

function priorityFor(item) {
  if (item.kind === 'intake') return 1000; // team-provided examples first, always
  let p = Math.max(...item.topics.map(t => TOPIC_WEIGHT[t] || 30));
  if (item.kind === 'template') p += 15;
  if (/SoftwareStandardization\.L5X$/i.test(item.path)) p += 20; // full V4.2 controller
  if (item.antiPattern) p -= 30; // evidence of what-not, mined later...
  if (item.antiPattern && item.topics.includes('laser-marker')) p += 40; // ...unless it's the only laser evidence we have
  if (item.status === 'needs-restudy') p += 25;
  return p;
}

// Items already covered by the Aug 2026 broad ingestions (sources.json /
// TRAINING_LOG evidence). Deep single-item passes may still revisit them, but
// they start "studied" so the unstudied queue is honest about NEW material.
const PRE_STUDIED = [
  /^plc-reference\/standard\//,                                    // template inventory machinery + 08-21 ingestion
  /CONTROLS_LEADS_QUESTIONS\.extracted\.md$/,                      // answered questionnaires (Jason, 08-20)
  /JARVIS_QUESTIONS_FOR_LEADS\.extracted\.md$/,
  /PLC Software Standardization, Rev2\.extracted\.md$/,            // the CE bible — distilled 08-21
  /Pneumatic Standardization Selection Guide, Rev2\.extracted\.md$/,
  /Sensor Standardization Rev 2\.extracted\.md$/,
  /SDC_Motors_Cables_Drives_Guildelines_Rev 2\.extracted\.md$/,
  /Revision History\.md$/,                                         // changelogs read 08-21
  /^plc-reference\/analysis\//,                                    // our own study outputs
];
// Exact duplicates of files that exist elsewhere in the corpus
const DUPLICATES = [
  /training-material\/SDC Standard Templates\//,
  /training-material\/SDC Standards Document\//,
];

function buildManifest() {
  const prev = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : { items: [] };
  const prevById = new Map((prev.items || []).map(i => [i.id, i]));

  const items = [];
  for (const [sub, kind] of SCAN_ROOTS) {
    for (const file of walk(path.join(PLC_REF, sub))) {
      const r = rel(file);
      if (!STUDYABLE_EXT.test(file) || SKIP_FILES.test(file)) continue;
      // skip a raw doc when its .extracted.md sibling is the study item
      if (/\.extracted\.md$/i.test(file) === false && /\.(docx|xlsx)$/i.test(file)) continue;

      const buf = fs.readFileSync(file);
      const isL5X = /\.l5x$/i.test(file);
      const content = buf.toString('utf8').slice(0, isL5X ? 2_000_000 : 200_000);
      const antiPattern = /Examples NOT Following/i.test(r);
      const topics = tagTopics(r, content);
      const id = 'ci_' + sha12(Buffer.from(r));
      const hash = sha12(buf);
      const old = prevById.get(id);

      let status = 'unstudied';
      let studiedAt = null, studiedNote = null;
      if (old) {
        status = old.status; studiedAt = old.studiedAt || null; studiedNote = old.studiedNote || null;
        // our own analysis outputs never need a restudy pass
        if (old.hash !== hash && old.status === 'studied' && kind !== 'analysis') status = 'needs-restudy';
        if (kind === 'analysis') status = 'studied';
      } else if (DUPLICATES.some(re => re.test(r))) {
        status = 'studied'; studiedNote = 'duplicate of the standards-docs/standard copy';
      } else if (PRE_STUDIED.some(re => re.test(r))) {
        status = 'studied'; studiedAt = '2026-08-21';
        studiedNote = 'covered by the Aug-2026 broad ingestion (sources.json)';
      }

      const item = {
        id, path: r, kind: kind === 'training-material' && antiPattern ? 'anti-pattern'
          : kind === 'training-material' && /Examples Following/i.test(r) ? 'exemplar'
          : kind === 'standards-doc' && isL5X ? 'standard-program'
          : kind,
        topics, antiPattern,
        conceptFiles: conceptFilesFor(topics, antiPattern),
        status, studiedAt, studiedNote,
        sizeBytes: buf.length, hash,
      };
      item.priority = priorityFor(item);
      items.push(item);
    }
  }
  items.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));

  // Honest gap inventory: coverage-goal topics with no standard-conformant material
  const goalTopics = ['vision', 'robot', 'indexer', 'chassis-cam', 'alarms', 'production-oee', 'part-tracking', 'servo', 'laser-marker'];
  const gaps = [];
  const CODE_KINDS = new Set(['template', 'standard-program', 'exemplar', 'intake']);
  for (const t of goalTopics) {
    const all = items.filter(i => i.topics.includes(t));
    // a gap closes only with standard-conformant CODE — a passing mention in a
    // standards document (e.g. "Telesis Laser" as a tag-prefix example) does not count
    const good = all.filter(i => !i.antiPattern && CODE_KINDS.has(i.kind));
    if (good.length === 0) {
      gaps.push({
        topic: t,
        finding: all.length
          ? `only anti-pattern evidence exists (${all.map(i => path.basename(i.path)).join(', ')}) — no standard-conformant example`
          : 'no material in the corpus at all',
        request: t === 'laser-marker'
          ? 'export one recent laser-marker station program (standard-conformant) to the training folder'
          : `provide a standard-conformant ${t} example to the training folder`,
      });
    }
  }

  const manifest = {
    updatedAt: new Date().toISOString(),
    doctrine: 'concepts-not-rules: each study pass DEEPENS concept files (integrated understanding, cited sources); anti-pattern items land in anti-patterns.md only',
    counts: summarize(items),
    gaps,
    items,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function summarize(items) {
  const byStatus = {}, byTopic = {};
  for (const i of items) {
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    for (const t of i.topics) byTopic[t] = (byTopic[t] || 0) + 1;
  }
  return { total: items.length, byStatus, byTopic };
}

// ── gap → leads-queue request (idempotent) ───────────────────────────────────
function fileGapRequests(manifest) {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8')); } catch (_) {}
  let changed = false;
  for (const gap of manifest.gaps) {
    const id = 'q_gap_' + gap.topic.replace(/[^a-z0-9]/gi, '_');
    if (arr.some(q => q && q.id === id)) continue;
    arr.push({
      id,
      question: `I don't have a good standard-conformant SDC example for ${gap.topic.replace('-', ' ')} — can you give me one? (${gap.finding})`,
      proposedSolution: gap.request.charAt(0).toUpperCase() + gap.request.slice(1) + '; I will study it into the concept files on the next training run.',
      addressee: 'CE',
      context: `Training curriculum gap — jarvis-knowledge/curriculum.json topic "${gap.topic}"`,
      source: 'training',
      domain: 'jarvis',
      kind: 'example-request',
      askedAt: new Date().toISOString(),
      status: 'open',
    });
    changed = true;
    console.log(`  filed leads-queue example request: ${id}`);
  }
  if (changed) fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

// ── selection ────────────────────────────────────────────────────────────────
function selectNext(manifest) {
  return manifest.items.find(i => i.status === 'unstudied' || i.status === 'needs-restudy') || null;
}

// ── L5X distillation (keep the study call inside budget) ────────────────────
function extractL5XEssence(xml, capChars) {
  const out = [];
  const progRe = /<Program\b[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/Program>/g;
  const pushRungs = (routineXml, indent) => {
    const rungRe = /<Rung\b[^>]*Number="(\d+)"[^>]*>([\s\S]*?)<\/Rung>/g;
    let r;
    while ((r = rungRe.exec(routineXml))) {
      const body = r[2];
      const cm = body.match(/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
      const tx = body.match(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
      if (cm) out.push(`${indent}  // ${cm[1].trim().replace(/\s+/g, ' ').slice(0, 300)}`);
      if (tx) out.push(`${indent}  [${r[1]}] ${tx[1].trim()}`);
    }
  };
  let p;
  while ((p = progRe.exec(xml))) {
    out.push(`\nPROGRAM ${p[1]}`);
    const routRe = /<Routine\b[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/Routine>/g;
    let rt;
    while ((rt = routRe.exec(p[2]))) { out.push(` ROUTINE ${rt[1]}`); pushRungs(rt[2], ' '); }
    // program tags (names + types only)
    const tags = [...p[2].matchAll(/<Tag\b[^>]*Name="([^"]+)"[^>]*DataType="([^"]+)"[^>]*>/g)]
      .map(m => `${m[1]}:${m[2]}`);
    if (tags.length) out.push(` TAGS ${tags.slice(0, 400).join(', ')}`);
  }
  // AOIs
  const aoiRe = /<AddOnInstructionDefinition\b[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/AddOnInstructionDefinition>/g;
  let a;
  while ((a = aoiRe.exec(xml))) {
    out.push(`\nAOI ${a[1]}`);
    const params = [...a[2].matchAll(/<Parameter\b[^>]*Name="([^"]+)"[^>]*DataType="([^"]+)"[^>]*Usage="([^"]+)"/g)]
      .map(m => `${m[1]}:${m[2]}(${m[3]})`);
    if (params.length) out.push(` PARAMS ${params.join(', ')}`);
    pushRungs(a[2], ' ');
  }
  // UDTs
  const udtRe = /<DataType\b[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/DataType>/g;
  let u;
  while ((u = udtRe.exec(xml))) {
    const members = [...u[2].matchAll(/<Member\b[^>]*Name="([^"]+)"[^>]*DataType="([^"]+)"/g)]
      .map(m => `${m[1]}:${m[2]}`);
    out.push(`\nUDT ${u[1]} { ${members.slice(0, 120).join(', ')} }`);
  }
  // controller-scope tags
  const ctrlTags = [...xml.matchAll(/<Tag\b[^>]*Name="([^"]+)"[^>]*TagType="Base"[^>]*DataType="([^"]+)"/g)]
    .slice(0, 300).map(m => `${m[1]}:${m[2]}`);
  if (ctrlTags.length) out.push(`\nCONTROLLER TAGS ${ctrlTags.join(', ')}`);
  let text = out.join('\n');
  if (text.length > capChars) text = text.slice(0, capChars) + '\n...[TRUNCATED at study budget cap]';
  if (text.trim().length < 200) {
    // fallback: raw slice (some files may not match the shapes above)
    text = xml.slice(0, Math.min(capChars, xml.length));
  }
  return text;
}

function loadStudyMaterial(item, budgetUSD) {
  const abs = path.join(ROOT, item.path);
  const raw = fs.readFileSync(abs, 'utf8');
  // input-token budget: leave room for concepts + doctrine (~15k tokens) and
  // worst-case output (16k tokens * $25/M = $0.40)
  const inBudgetTokens = Math.max(20_000, Math.floor(((budgetUSD - 0.40) / price.in) * 1_000_000) - 15_000);
  // RLL rung text is punctuation-dense: ~2.5 chars/token (measured 2026-08-23:
  // 1.3M chars → 528k tokens). Prose runs ~4 chars/token.
  if (/\.l5x$/i.test(item.path)) return extractL5XEssence(raw, Math.floor(inBudgetTokens * 2.5));
  const capChars = inBudgetTokens * 4;
  return raw.length > capChars ? raw.slice(0, capChars) + '\n...[TRUNCATED]' : raw;
}

// ── the study pass ───────────────────────────────────────────────────────────
async function studyItem(item, manifest, { budgetUSD = 2, resolveQuestionId = null } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing (.env) — cannot study');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const conceptFiles = item.conceptFiles.length ? item.conceptFiles : ['naming-and-structure.md'];
  const concepts = conceptFiles.map(f => {
    const p = path.join(CONCEPTS_DIR, f);
    return { file: f, content: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' };
  });
  const material = loadStudyMaterial(item, budgetUSD);

  const system = `You are Jarvis, SDC Automation's AI controls engineer, on your daily deep-study pass.

DOCTRINE (Dan's law — CONCEPTS, NOT RULES): you DEEPEN concept documents the way a senior SDC controls engineer explains a subject to a new hire — mechanism, intent behind it, and the judgment calls, with real rungs as illustrations. You NEVER append rule lists. Deepening means REWRITING the relevant sections so the new understanding is INTEGRATED into the existing narrative. Cite the source inline as "seen in {filename}: ...". If the material CONTRADICTS an existing belief, flag it prominently in the text ("CONFLICT — needs Dan/leads ruling: ...") rather than silently merging. Concept files ride in every generation prompt: keep them lean — total net growth across all edited files must stay under ~80 lines; tighten existing prose to make room when needed.

${item.antiPattern ? 'THIS IS AN ANTI-PATTERN ITEM (from "Examples NOT Following SDC Standard"): its lessons go into anti-patterns.md ONLY — what the legacy code did, why it violates the standard, and what the standard shape is instead. It is NEVER style authority. Do not touch any other concept file. EXCEPTION: purely factual observations about devices SDC has no standard example for (e.g. how a Telesis laser marker is interfaced) may be recorded in anti-patterns.md as "legacy evidence, unverified against standard".' : 'Authority level of this item: templates and standards docs outrank legacy code; exemplars ("Examples Following SDC Standard") are trusted seen-SDC-code.'}

Respond with ONLY a JSON object:
{
 "conceptEdits": [{"file": "<one of: ${conceptFiles.join(', ')}>", "updatedContent": "<the COMPLETE new file content>"}],
 "trainingLogLine": "<one sentence: the concept-level takeaway of this study>",
 "goldenGaps": ["<recurring station type/variation lacking template coverage, if any — else empty>"],
 "questions": [{"question": "<CE-to-CE concept-level question where the material left the concept thin or deviant — 0 to 3, never case questions>", "context": "<concept area — from ${path.basename(item.path)}>", "proposedSolution": "<REQUIRED: your best answer>", "kind": "question"}],
 "manifestNote": "<one sentence: what this item taught>"
}
Only edit files from the allowed list. Include a conceptEdit ONLY for files you genuinely deepen — an edit that merely appends bullets is a doctrine violation.`;

  const user = `STUDY ITEM: ${item.path}
Kind: ${item.kind}${item.antiPattern ? ' (ANTI-PATTERN)' : ''}   Topics: ${item.topics.join(', ')}

CURRENT CONCEPT FILE(S) you may deepen:
${concepts.map(c => `\n===== ${c.file} (current content) =====\n${c.content}`).join('\n')}

===== THE MATERIAL (distilled) =====
${material}

Study it deeply through the concept lens: for each domain present, does it confirm, deepen, or contradict the concept files? Is it a new MODE of a known concept or genuinely new? Then produce the JSON.`;

  const estIn = Math.ceil((system.length + user.length) / 4);
  console.log(`  model: ${MODEL}   est input ~${estIn.toLocaleString()} tokens (~$${(estIn * price.in / 1e6).toFixed(2)})`);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16_000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const usage = resp.usage || { input_tokens: 0, output_tokens: 0 };
  const costUSD = usage.input_tokens * price.in / 1e6 + usage.output_tokens * price.out / 1e6;
  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in study response');
  const result = JSON.parse(jsonMatch[0]);

  // apply concept edits (allowed files only, sanity-checked)
  const applied = [];
  for (const edit of result.conceptEdits || []) {
    if (!conceptFiles.includes(edit.file)) { console.warn(`  SKIPPED edit to non-allowed file ${edit.file}`); continue; }
    const p = path.join(CONCEPTS_DIR, edit.file);
    const oldLen = (concepts.find(c => c.file === edit.file) || { content: '' }).content.length;
    const next = String(edit.updatedContent || '');
    if (next.trim().length < Math.min(oldLen * 0.5, 500)) { console.warn(`  SKIPPED suspiciously short rewrite of ${edit.file}`); continue; }
    fs.writeFileSync(p, next.replace(/\r\n/g, '\n'), 'utf8');
    applied.push(edit.file);
  }

  // training log
  const date = new Date().toISOString().slice(0, 10);
  const logLine = `${date} | ${item.path.replace(/^plc-reference\//, '')} | ${String(result.trainingLogLine || 'studied').trim()} (deepened: ${applied.join(', ') || 'none'}; $${costUSD.toFixed(2)})`;
  fs.appendFileSync(TRAINING_LOG, logLine + '\n', 'utf8');

  // golden gaps
  const gaps = (result.goldenGaps || []).filter(g => g && g.trim());
  if (gaps.length) {
    const header = fs.existsSync(GOLDEN_GAPS) ? '' : '# Golden Gaps — recurring station types/variations lacking template coverage\n\n';
    fs.appendFileSync(GOLDEN_GAPS, header + gaps.map(g => `- (${date}, from ${path.basename(item.path)}) ${g.trim()}`).join('\n') + '\n', 'utf8');
  }

  // questions → API, else questions.json
  const questions = (result.questions || []).filter(q => q && q.question).slice(0, 3);
  for (const q of questions) {
    const posted = await postQuestion({
      question: q.question,
      context: q.context || `training — from ${item.path}`,
      proposedSolution: q.proposedSolution || null,
      source: 'training',
      kind: q.kind === 'example-request' ? 'example-request' : 'question',
    });
    console.log(`  question ${posted ? 'POSTed to API' : 'appended to questions.json'}: ${q.question.slice(0, 90)}...`);
  }

  // resolve an originating example-request (example intake path)
  if (resolveQuestionId) resolveQuestion(resolveQuestionId, item);

  // manifest bookkeeping
  const mi = manifest.items.find(x => x.id === item.id);
  if (mi) {
    mi.status = 'studied';
    mi.studiedAt = new Date().toISOString();
    mi.studiedNote = String(result.manifestNote || '').trim() || null;
    mi.priority = priorityFor(mi);
    manifest.counts = summarize(manifest.items);
    manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return { applied, logLine, questions: questions.length, costUSD, usage, gaps };
}

async function postQuestion(body) {
  const port = Number(process.env.PORT) || 3131;
  try {
    const res = await fetch(`http://localhost:${port}/api/jarvis/questions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) return true;
  } catch (_) {}
  // fallback: direct append in the established shape
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8')); } catch (_) {}
  arr.push({
    id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    question: body.question, proposedSolution: body.proposedSolution || null,
    addressee: 'CE', context: body.context || '', source: 'training',
    domain: 'controls', kind: body.kind || 'question',
    askedAt: new Date().toISOString(), status: 'open',
  });
  fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(arr, null, 2), 'utf8');
  return false;
}

function resolveQuestion(id, item) {
  try {
    const arr = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
    const q = arr.find(x => x && x.id === id);
    if (!q) return;
    q.status = 'answered';
    q.answer = `Example provided and studied: ${item.path} → ${item.conceptFiles.join(', ')}`;
    q.answeredBy = 'Controls (example upload)';
    q.answeredAt = new Date().toISOString();
    fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(arr, null, 2), 'utf8');
    console.log(`  resolved example-request ${id}`);
  } catch (e) { console.warn('  resolve failed:', e.message); }
}

// ── intake (POST /api/jarvis/examples calls this via --intake) ──────────────
function registerIntake(absPath, topic, manifest) {
  const r = rel(absPath);
  const buf = fs.readFileSync(absPath);
  const id = 'ci_' + sha12(Buffer.from(r));
  let item = manifest.items.find(x => x.id === id);
  if (!item) {
    const topics = topic && TOPIC_CONCEPTS[topic] ? [topic] : tagTopics(r, buf.toString('utf8').slice(0, 500_000));
    item = {
      id, path: r, kind: 'intake', topics, antiPattern: false,
      conceptFiles: conceptFilesFor(topics, false),
      status: 'unstudied', studiedAt: null,
      studiedNote: 'team-provided example (ask-for-examples doctrine)',
      sizeBytes: buf.length, hash: sha12(buf),
    };
    item.priority = priorityFor(item);
    manifest.items.unshift(item);
    manifest.items.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));
    manifest.counts = summarize(manifest.items);
    manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  }
  return item;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; }
function has(name) { return process.argv.includes(name); }

async function main() {
  const budgetUSD = Number(arg('--budget')) || 2;
  console.log('Jarvis daily training — curriculum mode');
  console.log('Refreshing curriculum manifest...');
  const manifest = buildManifest();
  fileGapRequests(manifest);
  const c = manifest.counts;
  console.log(`  ${c.total} study items | status: ${JSON.stringify(c.byStatus)}`);
  console.log(`  topics: ${Object.entries(c.byTopic).map(([t, n]) => `${t}:${n}`).join('  ')}`);
  if (manifest.gaps.length) console.log(`  gaps: ${manifest.gaps.map(g => g.topic).join(', ')}`);

  let item = null;
  const intakePath = arg('--intake');
  if (intakePath) {
    item = registerIntake(path.resolve(intakePath), arg('--topic'), manifest);
    console.log(`Intake registered: ${item.path} (topics: ${item.topics.join(', ')})`);
    if (has('--no-study')) return;
  } else if (arg('--study')) {
    const key = arg('--study');
    item = manifest.items.find(x => x.id === key || x.path === key.replace(/\\/g, '/') || x.path.endsWith(key.replace(/\\/g, '/')));
    if (!item) { console.error(`Study item not found: ${key}`); process.exit(1); }
  } else {
    item = selectNext(manifest);
  }

  if (!item) { console.log('Curriculum fully studied — nothing to do.'); return; }
  console.log(`\nSelected: ${item.path}`);
  console.log(`  kind=${item.kind}  topics=${item.topics.join(',')}  priority=${item.priority}  status=${item.status}`);
  console.log(`  lessons land in: ${item.conceptFiles.join(', ')}`);

  if (has('--dry-run')) { console.log('\n--dry-run: stopping before the model call ($0).'); return; }

  console.log('\nStudying (one model pass)...');
  const res = await studyItem(item, manifest, { budgetUSD, resolveQuestionId: arg('--resolve') });
  console.log(`\nDone. Deepened: ${res.applied.join(', ') || '(no edits applied)'}`);
  console.log(`  log: ${res.logLine}`);
  console.log(`  questions filed: ${res.questions}   golden gaps: ${res.gaps.length}`);
  console.log(`  cost: $${res.costUSD.toFixed(2)} (${res.usage.input_tokens} in / ${res.usage.output_tokens} out)`);
}

if (require.main === module) {
  main().catch(e => { console.error('TRAINING FAILED:', e.message); process.exit(1); });
}

module.exports = { buildManifest, selectNext, studyItem, registerIntake };
