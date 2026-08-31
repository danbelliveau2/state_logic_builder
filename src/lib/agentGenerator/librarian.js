/**
 * librarian.js — the JARVIS Inbox librarian (Dan's directive, 2026-08-28:
 * "drop anything; a librarian classifies, distills into the ONE knowledge
 * store, files conflicts as questions, moves processed files to _learned").
 *
 * TWO SOURCE CLASSES:
 *   LOCAL  — C:\...\JARVIS Inbox\ (Dan's drops). Processed files MOVE to
 *            _learned\ (never deleted) and every read appends a ledger line
 *            to _learned\LEDGER.md.
 *   NETWORK — team folders on the X: drive (UNC, never the drive letter:
 *            \\stevendouglas.local\dfs\Company\Engineering\Electrical Dept).
 *            Read IN PLACE: never move, rename, or write into them — the one
 *            exception is creating the team drop folder "JARVIS Inbox" (with
 *            a README) so anyone can feed Jarvis. Read-state is tracked
 *            LOCALLY by path + size/mtime key + content hash, so only new or
 *            changed files are read on each run. Volume caution: network
 *            folders may hold hundreds of files — each run ingests a
 *            prioritized batch (standards docs and L5X first); the backlog
 *            drains across runs and the status shows progress.
 *
 * ONE BRAIN (Dan, 2026-08-28): everything learned lands in the ONE knowledge
 * store — plc-reference/verified/ + jarvis-knowledge/precedents.md (via
 * scripts/harvestPrecedents.cjs) for engineer-verified L5X, dated
 * source-cited entries in jarvis-knowledge/concepts/ or meKnowledge.md for
 * documents, jarvis-knowledge/questions.json for conflicts. NO side stores —
 * the ledger, sources.json manifest, and librarian-state.json are
 * bookkeeping (what was read when), never knowledge.
 *
 * Rulings are append-only: the librarian only ever appends to concepts /
 * meKnowledge / the ledger; anything that CONTRADICTS existing knowledge is
 * filed as a question — never a silent override, even when the network doc
 * looks authoritative.
 *
 * CommonJS, required lazily by server.js. Also runnable standalone:
 *   node src/lib/agentGenerator/librarian.js          (one run)
 *   node src/lib/agentGenerator/librarian.js status   (print status)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, '..', '..', '..');
// Same env resolution as client.js — the librarian may be the first
// agentGenerator module the server touches.
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const LOCAL_INBOX = path.join(ROOT, 'JARVIS Inbox');
const LOCAL_VERIFIED = path.join(LOCAL_INBOX, 'verified');
const LEARNED_DIR = path.join(LOCAL_INBOX, '_learned');
const LEDGER_PATH = path.join(LEARNED_DIR, 'LEDGER.md');
const KNOW_DIR = path.join(ROOT, 'jarvis-knowledge');
const CONCEPTS_DIR = path.join(KNOW_DIR, 'concepts');
const QUESTIONS_PATH = path.join(KNOW_DIR, 'questions.json');
const SOURCES_PATH = path.join(KNOW_DIR, 'sources.json');
const STATE_PATH = path.join(KNOW_DIR, 'librarian-state.json');
const CONFIG_PATH = path.join(KNOW_DIR, 'inbox-sources.json');
const PLC_VERIFIED_DIR = path.join(ROOT, 'plc-reference', 'verified');
const HARVEST_SCRIPT = path.join(ROOT, 'scripts', 'harvestPrecedents.cjs');

const MODEL = process.env.JARVIS_LIBRARIAN_MODEL || 'claude-sonnet-5';
const MAX_DOC_CHARS = 60000; // per-document text budget into the distill call
const MAX_FILE_BYTES = 25 * 1024 * 1024; // skip anything bigger (network CAD dumps etc.)

// The editable watch-list config — surfaced on the Jarvis page inbox status
// so Dan can see (and a lead can edit) which network folders are watched.
const DEFAULT_CONFIG = {
  networkRoot: '\\\\stevendouglas.local\\dfs\\Company\\Engineering\\Electrical Dept',
  // The SDC Engineer's home folder on the share (README, CLAUDE.md for
  // Jason's Claude Code sessions, Knowledge\ memory files, _learned\).
  networkEngineerRoot: 'SDC Engineer',
  networkDropFolder: 'SDC Engineer\\Drop Files Here',
  // WATCH EVERYTHING (Dan, 2026-08-28: "learn everything in the electrical
  // department folder") — the whole dept share, recursively, minus the
  // judgment-call noise below. The backlog counter tells the story.
  watchAll: true,
  // Visible, editable exclusions — folder NAMES skipped at any depth.
  exclude: ['ARCHIVE', 'EPLAN', 'Backup', 'Backups', 'Old', 'node_modules', '_archive', '_learned'],
  // Legacy targeted list — used only when watchAll is false.
  watch: [
    'SDC Engineer',
    'SDC_Examples for AI Inbox',
    'SDC Knowledgebase',
    'Standards - Software',
    'Standards - Elect Design',
    'Standards - Pneumatics',
    'EE Process and Standards Documents',
  ],
  batchPerRun: 10,
};

// CATEGORY SUBFOLDERS (Dan, 2026-08-28) — SDC families in both inboxes; the
// category a drop lands in rides the distill call as a hint.
const CATEGORIES = [
  'Robot Integration', 'Vision', 'Servo Motion', 'Conveyors & Indexers',
  'Laser Marking', 'Full Machine Examples', 'Standards Docs',
  // Landed with the 2026-08-31 consolidation (N:\Job Folder\AI Folder retired):
  'CE Training Material', 'Templates',
];

const NETWORK_README = [
  'DROP FILES HERE — the SDC Engineer\'s ONE inbox',
  '==============================================',
  '',
  'This is the ONE folder — examples, standards, anything. The SDC Engineer reads',
  'new files daily. Your files stay put (he reads in place, never moves',
  'or edits them). Subfolders help him file things but are not required.',
  '',
  'THE SUBMISSION FORM (the good way to drop)',
  '  1. Make a subfolder for your drop (or use a category folder below).',
  '  2. Copy SUBMISSION FORM.docx from this folder into it, fill it in,',
  '     save it with SUBMISSION in the name (SUBMISSION - JSmith - 1119.docx).',
  '  3. Put your files beside it.',
  '  The "what should the SDC Engineer study" line steers his reading and is cited in',
  '  what he learns. Marking "engineer-verified working code: YES" ranks the',
  '  attached L5X as a top exemplar he writes new code from — only when true.',
  '',
  'CATEGORY FOLDERS — dropping into the right family helps him file it:',
  '  ' + CATEGORIES.join('  |  '),
  '',
  'QUESTIONS FROM THE SDC ENGINEER',
  '  If he has questions about your drop, a "Questions from SDC Engineer - ...docx"',
  '  appears next to your files. Type your answers directly under each',
  '  question and save — he reads them on his next pass, files what he',
  '  learned under your name, and renames the doc "(answered)".',
  '',
  'THE FOLDER ABOVE (SDC Engineer\\) — README.txt there is the map:',
  '  Knowledge\\ce-knowledge.md (engineer-taught memory, append-only),',
  '  Knowledge\\questions-for-ce.md (his open questions — answer in place),',
  '  _learned\\LEDGER.md, and CLAUDE.md for Claude Code sessions.',
  'Retired folders ("SDC_Examples for AI Inbox", "SDC Engineer Inbox",',
  '  N:\\Job Folder\\AI Folder) carry breadcrumbs pointing here.',
  '',
  'What he learned is visible in the State Logic Builder app',
  '(SDC Engineer page > Knowledge tab), with a ledger line for every file.',
].join('\r\n') + '\r\n';

// ── tiny fs helpers ──────────────────────────────────────────────────────────

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}
function nowIso() { return new Date().toISOString(); }
function today() { return nowIso().slice(0, 10); }

function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  if (cfg) {
    const merged = { ...DEFAULT_CONFIG, ...cfg };
    // New keys (watchAll/exclude) become VISIBLE in the editable file the
    // first run after an upgrade — existing hand-edits are preserved.
    if (cfg.watchAll === undefined || cfg.exclude === undefined) {
      try { writeJson(CONFIG_PATH, merged); } catch (_) {}
    }
    return merged;
  }
  // Seed the editable config on first run — but NEVER overwrite an existing
  // file: a hand-edit with a JSON typo should be fixed, not silently reset.
  if (fs.existsSync(CONFIG_PATH)) {
    console.warn(`[librarian] ${CONFIG_PATH} is not valid JSON — using defaults this run; fix the file to restore your edits`);
    return { ...DEFAULT_CONFIG };
  }
  try { writeJson(CONFIG_PATH, DEFAULT_CONFIG); } catch (_) {}
  return { ...DEFAULT_CONFIG };
}
function loadState() {
  return readJson(STATE_PATH, {
    lastRun: null, lastTrigger: null, lastResult: null,
    network: { reachable: null, dropFolderCreated: null, seen: {}, folders: {} },
  });
}
function saveState(state) { try { writeJson(STATE_PATH, state); } catch (_) {} }

// ── ledger (append-only, newest first, under the "---" separator) ────────────

function appendLedger(lines) {
  const entries = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
  if (!entries.length) return;
  let md = '';
  try { md = fs.readFileSync(LEDGER_PATH, 'utf8'); } catch (_) {
    md = '# SDC Engineer Inbox — learning ledger\n\n---\n';
  }
  const sep = md.indexOf('\n---\n');
  const block = entries.map(l => `- ${l}`).join('\n') + '\n';
  const updated = sep === -1
    ? md.replace(/\s*$/, '') + '\n\n---\n' + block
    : md.slice(0, sep + 5) + block + md.slice(sep + 5);
  fs.writeFileSync(LEDGER_PATH, updated, 'utf8');
}

function recentLedgerLines(n = 12) {
  try {
    const md = fs.readFileSync(LEDGER_PATH, 'utf8');
    const sep = md.indexOf('\n---\n');
    const body = sep === -1 ? md : md.slice(sep + 5);
    return body.split('\n').filter(l => l.startsWith('- ')).slice(0, n).map(l => l.slice(2));
  } catch (_) { return []; }
}

// ── the ONE knowledge store — filing helpers ─────────────────────────────────

/** Append a dated, source-cited section to a concept file (or create one). */
function fileToConcept({ concept, heading, markdown, sourceName, origin }) {
  const name = String(concept || 'general').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'general';
  const fp = path.join(CONCEPTS_DIR, name + '.md');
  const cite = `\n\n_Source: ${sourceName} (${origin}), ingested ${today()} by the inbox librarian._\n`;
  const section = `\n\n## ${heading || 'Learned from the inbox'} (${today()})\n\n${String(markdown).trim()}${cite}`;
  if (fs.existsSync(fp)) {
    fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').replace(/\s*$/, '') + section, 'utf8');
  } else {
    const title = name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const header = `# ${title} — how SDC thinks about it\n\n` +
      '> CONCEPTS, NOT RULES — when the SDC Engineer gets something wrong, deepen the\n' +
      '> understanding here; do not append a rule. (Dan, Aug 2026)\n';
    fs.writeFileSync(fp, header + section, 'utf8');
  }
  return `concepts/${name}.md`;
}

/** Append facts to meKnowledge.md "Learned" section (source-cited, deduped). */
function fileToMeKnowledge(facts, sourceName) {
  const { appendLearnedFacts } = require('./meKnowledge.js');
  const list = (Array.isArray(facts) ? facts : [facts])
    .map(f => ({ fact: `${String(f).trim()} [source: ${sourceName}]`, scope: 'sdc-standard' }));
  return appendLearnedFacts(list, { who: 'Inbox' });
}

/** File a conflict/uncertainty as a question — the same shape the server's
 *  POST /api/jarvis/questions writes, so the Questions tab shows it. */
function fileQuestion({ question, proposedSolution, context }) {
  const qr = require('./questionRouter.js');
  const domain = qr.resolveQuestionDomain(null, question, context);
  const entry = {
    id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    question: String(question).trim(),
    proposedSolution: proposedSolution ? String(proposedSolution).trim() : null,
    addressee: qr.resolveAddressee(null, domain),
    kind: qr.resolveQuestionKind(null),
    context: String(context || '').trim(),
    source: 'training',
    domain,
    askedAt: nowIso(),
    status: 'open',
  };
  const arr = readJson(QUESTIONS_PATH, []);
  arr.push(entry);
  writeJson(QUESTIONS_PATH, arr);
  return entry.id;
}

/** Upsert an entry in the sources manifest (the Knowledge tab's source cards). */
function updateSourcesManifest({ name, location, accessStatus, takeaways }) {
  let parsed = readJson(SOURCES_PATH, []);
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.sources) ? parsed.sources : []);
  const existing = arr.find(s => s && s.name === name);
  if (existing) {
    existing.lastIngested = today();
    if (takeaways?.length) {
      existing.takeaways = [...new Set([...(existing.takeaways || []), ...takeaways])].slice(-8);
    }
  } else {
    arr.push({ id: 'inbox-' + sha256(Buffer.from(name)).slice(0, 8), name, location, accessStatus, lastIngested: today(), takeaways: (takeaways || []).slice(0, 8) });
  }
  if (Array.isArray(parsed)) writeJson(SOURCES_PATH, arr);
  else { parsed.sources = arr; writeJson(SOURCES_PATH, parsed); }
}

// ── Word COM (this machine has Word 16) ──────────────────────────────────────

const psq = (s) => String(s).replace(/'/g, "''");

/** Extract the plain text of a .docx/.doc via Word COM (async, temp-file
 *  round-trip for clean UTF-8). */
async function wordExtractText(filePath) {
  const tmp = path.join(os.tmpdir(), `jarvis-doc-${Date.now().toString(36)}.txt`);
  const ps = `
$w = New-Object -ComObject Word.Application; $w.Visible = $false
try {
  $d = $w.Documents.Open('${psq(filePath)}', $false, $true)
  $d.Content.Text | Out-File -Encoding utf8 '${psq(tmp)}'
  $d.Close(0)
} finally { $w.Quit() }`;
  try {
    await execFileAsync('powershell', ['-NoProfile', '-Command', ps], { timeout: 120000 });
    const text = fs.readFileSync(tmp, 'utf8').replace(/^﻿/, '');
    return text;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

/** HTML → .docx via Word COM (SaveAs wdFormatXMLDocument = 16). */
async function htmlToDocx(html, destPath) {
  const tmpHtml = path.join(os.tmpdir(), `jarvis-gen-${Date.now().toString(36)}.html`);
  const tmpDocx = tmpHtml.replace(/\.html$/, '.docx');
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const ps = `
$w = New-Object -ComObject Word.Application; $w.Visible = $false
try {
  $d = $w.Documents.Open('${psq(tmpHtml)}')
  $d.SaveAs([ref]'${psq(tmpDocx)}', [ref]16)
  $d.Close($false)
} finally { $w.Quit() }`;
  try {
    await execFileAsync('powershell', ['-NoProfile', '-Command', ps], { timeout: 120000 });
    fs.copyFileSync(tmpDocx, destPath);
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch (_) {}
    try { fs.unlinkSync(tmpDocx); } catch (_) {}
  }
}

// ── the submission form (Dan, 2026-08-28: the CE two-way channel) ────────────

const FORM_TEMPLATE_NAME = 'SUBMISSION FORM.docx';
const QUESTIONS_DOC_PREFIX = 'Questions from SDC Engineer';
const QUESTIONS_DOC_PREFIX_LEGACY = 'Questions from Jarvis'; // pre-rename docs on the share still carry this

function isFormTemplate(name) { return name.toLowerCase() === FORM_TEMPLATE_NAME.toLowerCase(); }
function isQuestionsDoc(name) {
  const n = name.toLowerCase();
  return n.startsWith(QUESTIONS_DOC_PREFIX.toLowerCase()) || n.startsWith(QUESTIONS_DOC_PREFIX_LEGACY.toLowerCase());
}
function looksLikeSubmissionForm(name, text) {
  return (!isFormTemplate(name) && /submission/i.test(name) && /\.docx?$/i.test(name))
    || /(JARVIS|SDC ENGINEER) SUBMISSION FORM/i.test(String(text ?? '').slice(0, 600));
}

// The form's own hint sentences — stripped so parsed values are the CE's words.
const FORM_HINTS = [
  'so Jarvis can cite you', 'e.g. 1119 Stamper', 'the files you dropped beside this form',
  'the important part — point him at it', 'focus on the robot integration',
  'rides his study of every attached file', 'circle or delete one',
  'this code ran on a real machine', 'ranks as a top exemplar',
  'anything else — quirks', 'What happens next', 'Feeding the department',
];

/** Parse a filled submission form's plain text → structured context. */
function parseSubmissionForm(text) {
  const clean = String(text).replace(/\r/g, '\n').replace(/\x07/g, '\n'); // Word table cell marks
  const grab = (label, nextLabels) => {
    const i = clean.toLowerCase().indexOf(label.toLowerCase());
    if (i === -1) return '';
    let end = clean.length;
    for (const nl of nextLabels) {
      const j = clean.toLowerCase().indexOf(nl.toLowerCase(), i + label.length);
      if (j !== -1 && j < end) end = j;
    }
    let v = clean.slice(i + label.length, end);
    for (const h of FORM_HINTS) {
      const k = v.toLowerCase().indexOf(h.toLowerCase());
      if (k !== -1) v = v.slice(0, k);
    }
    return v.replace(/[\n_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  };
  const L = ['Your name', 'Date', 'Machine / job', 'What’s attached', "What's attached", 'What should Jarvis study', 'What should the SDC Engineer study', 'Engineer-verified working code', 'Notes', 'What happens next'];
  const verifiedRaw = grab('Engineer-verified working code', ['Notes', 'What happens next']);
  const hasYes = /\bYES\b/i.test(verifiedRaw); const hasNo = /\bNO\b/i.test(verifiedRaw);
  return {
    submitter: grab('Your name', L.slice(1)),
    date: grab('Date', L.slice(2)),
    machine: grab('Machine / job', L.slice(3)),
    attached: grab('What’s attached', L.slice(5)) || grab("What's attached", L.slice(5)),
    focus: (grab('What should the SDC Engineer study', L.slice(7)) || grab('What should Jarvis study', L.slice(6))).replace(/^\?\s*/, ''),
    verified: hasYes && !hasNo ? true : hasNo && !hasYes ? false : null,
    notes: grab('Notes', ['What happens next']),
  };
}

// ── text extraction ──────────────────────────────────────────────────────────

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.md', '.txt', '.markdown', '.csv', '.json'].includes(ext)) {
    return { ok: true, text: fs.readFileSync(filePath, 'utf8') };
  }
  if (ext === '.docx' || ext === '.doc') {
    try {
      const text = await wordExtractText(filePath);
      return text.trim() ? { ok: true, text } : { ok: false, reason: 'Word document has no text' };
    } catch (e) {
      return { ok: false, reason: `Word COM extraction failed: ${e.message}` };
    }
  }
  if (ext === '.pdf') {
    try {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
      const r = await parser.getText();
      await parser.destroy().catch?.(() => {});
      const text = (r && (r.text || (Array.isArray(r.pages) ? r.pages.map(p => p.text).join('\n') : ''))) || '';
      return text.trim() ? { ok: true, text } : { ok: false, reason: 'PDF has no extractable text (scanned image?)' };
    } catch (e) {
      return { ok: false, reason: `PDF extraction failed: ${e.message}` };
    }
  }
  return { ok: false, reason: `no text extractor for ${ext || 'this file type'} yet (re-drop as .pdf/.md/.txt to distill)` };
}

// ── the distill call (one model call per document) ───────────────────────────

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      const e = new Error('ANTHROPIC_API_KEY is not configured');
      e.code = 'AI_NOT_CONFIGURED';
      throw e;
    }
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

function knowledgeInventory() {
  const { loadMeKnowledge } = require('./meKnowledge.js');
  let conceptNames = [];
  try { conceptNames = fs.readdirSync(CONCEPTS_DIR).filter(f => f.endsWith('.md') && !/^readme/i.test(f)).map(f => f.replace(/\.md$/, '')); } catch (_) {}
  return { conceptNames, meKnowledge: loadMeKnowledge() };
}

async function distillDocument({ sourceName, origin, text, studyFocus = '', category = '', submitter = '', formNotes = '' }) {
  const client = getClient();
  const inv = knowledgeInventory();
  // STUDY EMPHASIS (Dan, 2026-08-28): a CE's submission form steers the
  // reading — "focus on the robot integration" — and is cited in the filing.
  const emphasis = [
    studyFocus ? `STUDY EMPHASIS from the submitting engineer${submitter ? ` (${submitter})` : ''} — weight this heavily; the filings should serve it first: "${studyFocus}"` : '',
    category ? `CATEGORY (the drop folder's SDC family — a filing hint): ${category}` : '',
    formNotes ? `The engineer's notes on this drop: "${formNotes}"` : '',
  ].filter(Boolean).join('\n');
  const system =
    "You are the librarian for JARVIS, SDC Automation's AI controls engineer. A new document " +
    'arrived in his knowledge inbox. Distill ONLY what changes or deepens how SDC builds ' +
    'machines and PLC code — mechanisms, standards, judgment. Skip boilerplate, contacts, ' +
    'revision tables, anything Jarvis already knows.\n\n' +
    'FILING TARGETS (the ONE knowledge store — never invent another):\n' +
    '- "concept": engineering understanding worth paragraphs — files into jarvis-knowledge/concepts/{concept}.md. ' +
    `Existing concept files (PREFER deepening one over creating new): ${inv.conceptNames.join(', ')}\n` +
    '- "meKnowledge": a short standing fact (one sentence) — appended to the learned-facts list.\n\n' +
    'CONFLICTS ARE QUESTIONS: if the document CONTRADICTS the current knowledge below, do NOT file the ' +
    'new claim — put it in "conflicts" with the exact contradiction and your proposed resolution. ' +
    'Rulings are append-only; a human decides every override.\n\n' +
    'CURRENT STANDING KNOWLEDGE (for conflict detection):\n' + inv.meKnowledge.slice(0, 30000) + '\n\n' +
    'Respond with ONLY a JSON object:\n' +
    '{"classification":"standards-doc"|"reference"|"lesson-notes",\n' +
    ' "summary":"one line — what this document is",\n' +
    ' "takeaways":["3-6 short bullets of what was learned"],\n' +
    ' "filings":[{"target":"concept","concept":"kebab-name","heading":"section heading","markdown":"the distilled understanding"}|{"target":"meKnowledge","fact":"one-sentence standing fact"}],\n' +
    ' "conflicts":[{"question":"...","proposedSolution":"...","context":"..."}]}\n' +
    'Empty arrays are fine — a document with nothing new gets empty filings and honest takeaways.';
  const user = `Document: ${sourceName}\nOrigin: ${origin}\n${emphasis ? emphasis + '\n' : ''}\n---\n${String(text).slice(0, MAX_DOC_CHARS)}`;
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 4000,
    system, messages: [{ role: 'user', content: user }],
  });
  const raw = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('distill call returned no JSON');
  return JSON.parse(m[0]);
}

/** Apply a distill result to the knowledge store. Returns filed-location strings. */
function applyDistill(result, { sourceName, origin }) {
  const filed = [];
  for (const f of result.filings || []) {
    try {
      if (f.target === 'concept' && f.markdown) {
        filed.push(fileToConcept({ concept: f.concept, heading: f.heading, markdown: f.markdown, sourceName, origin }));
      } else if (f.target === 'meKnowledge' && f.fact) {
        const r = fileToMeKnowledge([f.fact], sourceName);
        if (r.recorded.length) filed.push('meKnowledge.md');
      }
    } catch (e) { filed.push(`FILING FAILED (${e.message})`); }
  }
  let questions = 0;
  for (const c of result.conflicts || []) {
    if (!c?.question) continue;
    try {
      fileQuestion({
        question: c.question,
        proposedSolution: c.proposedSolution,
        context: `Inbox librarian — conflict found while reading "${sourceName}" (${origin}). ${c.context || ''}`.trim(),
      });
      questions++;
    } catch (_) {}
  }
  return { filed: [...new Set(filed)], questions };
}

// ── local inbox processing ───────────────────────────────────────────────────

function listLocalUnread() {
  const out = [];
  const skipName = (f) => /^readme\.txt$/i.test(f) || f.startsWith('~$') || f.startsWith('.')
    || isFormTemplate(f) || isQuestionsDoc(f);
  const scanDir = (dir, { verified = false, category = '' } = {}) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (dir !== LOCAL_INBOX) continue; // one level of user subfolders
        const nm = e.name.toLowerCase();
        if (nm === '_learned') continue;
        if (nm === 'verified') { scanDir(fp, { verified: true, category }); continue; }
        // Category folder or a CE's drop subfolder — either way, scan it;
        // a category name becomes the distill hint.
        const cat = CATEGORIES.find(c => c.toLowerCase() === nm) ?? '';
        scanDir(fp, { verified: false, category: cat });
        continue;
      }
      if (!e.isFile() || skipName(e.name)) continue;
      out.push({ file: e.name, path: fp, dir, verified, category });
    }
  };
  scanDir(LOCAL_INBOX);
  return out;
}

/** Category folders exist in both inboxes (created idempotently). */
function ensureCategoryFolders(baseDir) {
  for (const c of CATEGORIES) {
    try { fs.mkdirSync(path.join(baseDir, c), { recursive: true }); } catch (_) {}
  }
}

/** Move a processed drop into _learned\ (never delete; never overwrite). */
function moveToLearned(fp) {
  fs.mkdirSync(LEARNED_DIR, { recursive: true });
  let dest = path.join(LEARNED_DIR, path.basename(fp));
  if (fs.existsSync(dest)) {
    const ext = path.extname(dest);
    dest = path.join(LEARNED_DIR, path.basename(dest, ext) + '__' + Date.now().toString(36) + ext);
  }
  fs.renameSync(fp, dest);
  return path.basename(dest);
}

function refreshPrecedents() {
  try {
    execFileSync(process.execPath, [HARVEST_SCRIPT], { cwd: ROOT, timeout: 60000 });
    return true;
  } catch (e) {
    console.warn('[librarian] precedent harvest failed:', e.message);
    return false;
  }
}

async function processLocalFile(item, summaryLines, ctx = null) {
  const stamp = nowIso().slice(0, 16).replace('T', ' ');
  const ext = path.extname(item.file).toLowerCase();
  const via = ctx?.submitter ? ` — submitted by ${ctx.submitter}${ctx.machine ? ` (${ctx.machine})` : ''}` : '';

  if (ext === '.l5x') {
    // A submission form's verified answer replaces the which-are-verified
    // question for its own files (Dan, 2026-08-28).
    if (ctx && ctx.verified === false) {
      const learnedAs = moveToLearned(item.path);
      appendLedger(`${stamp} · **${item.file}** (local inbox${via}) — L5X marked NOT verified on the submission form → held reference-only in \`_learned/${learnedAs}\`.`);
      summaryLines.push(`L5X ${item.file}: reference-only per ${ctx.submitter || 'the'} form`);
      return;
    }
    if (item.verified || ctx?.verified === true) {
      // Engineer-verified exemplar → the shipped-code library, then re-harvest
      // precedents so the naming pack reflects it on the very next prompt.
      fs.mkdirSync(PLC_VERIFIED_DIR, { recursive: true });
      let dest = path.join(PLC_VERIFIED_DIR, item.file);
      if (fs.existsSync(dest)) {
        dest = path.join(PLC_VERIFIED_DIR, path.basename(item.file, ext) + '__' + today() + ext);
      }
      fs.copyFileSync(item.path, dest);
      const learnedAs = moveToLearned(item.path);
      const harvested = refreshPrecedents();
      updateSourcesManifest({
        name: `Verified build: ${item.file}`,
        location: `plc-reference/verified/${path.basename(dest)}`,
        accessStatus: 'copied-locally',
        takeaways: ['Engineer-verified exemplar — ranks in the naming precedent pack' + (harvested ? ' (precedents.md refreshed)' : '') + (ctx?.submitter ? ` (verified per ${ctx.submitter}'s submission form)` : '')],
      });
      appendLedger(`${stamp} · **${item.file}** (local inbox${item.verified ? ', verified\\' : ''}${via}) — engineer-verified L5X${ctx?.verified === true ? ' (per the submission form)' : ''} → copied to \`plc-reference/verified/${path.basename(dest)}\`${harvested ? ', precedents.md re-harvested' : ' (precedent harvest FAILED — rerun scripts/harvestPrecedents.cjs)'}. Drop preserved as \`_learned/${learnedAs}\`.`);
      summaryLines.push(`verified L5X ${item.file} → plc-reference/verified/`);
    } else {
      // Unverified L5X — never rank it silently; ask.
      const learnedAs = moveToLearned(item.path);
      fileQuestion({
        question: `"${item.file}" was dropped in the SDC Engineer Inbox root (not verified\\). Is it engineer-verified SDC code I should rank as an exemplar, or reference-only?`,
        proposedSolution: `If verified, say so (or re-drop it into SDC Engineer Inbox\\verified\\) and I will file it into plc-reference/verified/ and re-harvest precedents. Until then I hold it in _learned/${learnedAs} as reference-only.`,
        context: 'Inbox librarian — unverified L5X drop',
      });
      appendLedger(`${stamp} · **${item.file}** (local inbox) — L5X without verification → held reference-only in \`_learned/${learnedAs}\`; question filed asking whether it is engineer-verified.`);
      summaryLines.push(`unverified L5X ${item.file} → held, question filed`);
    }
    return;
  }

  // Document path: extract text → distill → file into the ONE store.
  const extracted = await extractText(item.path);
  if (!extracted.ok) {
    const learnedAs = moveToLearned(item.path);
    appendLedger(`${stamp} · **${item.file}** (local inbox) — could not read: ${extracted.reason}. Kept in \`_learned/${learnedAs}\`.`);
    summaryLines.push(`${item.file}: unreadable (${extracted.reason})`);
    return;
  }
  const origin = `local inbox drop${ctx?.submitter ? `; submitted by ${ctx.submitter}` : ''}${ctx?.focus ? `; study focus: "${ctx.focus}"` : ''}`;
  const result = await distillDocument({
    sourceName: item.file, origin, text: extracted.text,
    studyFocus: ctx?.focus ?? '', category: item.category ?? '', submitter: ctx?.submitter ?? '', formNotes: ctx?.notes ?? '',
  });
  const { filed, questions } = applyDistill(result, { sourceName: item.file, origin });
  const learnedAs = moveToLearned(item.path);
  updateSourcesManifest({
    name: item.file,
    location: `SDC Engineer Inbox/_learned/${learnedAs}`,
    accessStatus: 'copied-locally',
    takeaways: result.takeaways || [],
  });
  appendLedger(`${stamp} · **${item.file}** (local inbox${via}${item.category ? `, ${item.category}` : ''}${ctx?.focus ? ` — study focus: "${ctx.focus}"` : ''}) — ${result.classification || 'document'}: ${result.summary || ''} → filed: ${filed.length ? filed.join(', ') : 'nothing new'}${questions ? `; ${questions} conflict question(s) filed` : ''}. Moved to \`_learned/${learnedAs}\`.`);
  summaryLines.push(`${item.file}: ${filed.length ? 'filed → ' + filed.join(', ') : 'nothing new'}${questions ? `, ${questions} question(s)` : ''}`);
  return { questions };
}

// ── the two-way channel: questions docs + submission forms ───────────────────

/** Process a filled submission form (LOCAL): parse → ledger → move. Returns
 *  the parsed context for its sibling files. */
async function processLocalForm(item, summaryLines) {
  const stamp = nowIso().slice(0, 16).replace('T', ' ');
  let ctx = null;
  try {
    const text = await wordExtractText(item.path);
    ctx = parseSubmissionForm(text);
  } catch (e) {
    summaryLines.push(`${item.file}: form unreadable (${e.message})`);
  }
  const learnedAs = moveToLearned(item.path);
  if (ctx) {
    appendLedger(`${stamp} · **${item.file}** (local inbox) — submission form from ${ctx.submitter || 'unnamed'}${ctx.machine ? ` (${ctx.machine})` : ''}: study focus "${ctx.focus || '—'}", verified code: ${ctx.verified === true ? 'YES' : ctx.verified === false ? 'NO' : 'not stated'}. Form kept as \`_learned/${learnedAs}\`.`);
    summaryLines.push(`submission form from ${ctx.submitter || 'unnamed'} — focus: ${ctx.focus || '—'}`);
  }
  return ctx;
}

/** Write "Questions from Jarvis - {who}.docx" NEXT TO a submission — only
 *  ever inside OUR folders (either inbox); the read-in-place rule protects
 *  every other network folder. Also files each question into the app queue. */
async function writeQuestionsDoc(state, { dir, submitter, questions, sourceLabel }) {
  const items = questions.filter(q => q && q.question).slice(0, 8).map(q => ({
    qid: fileQuestion({
      question: q.question,
      proposedSolution: q.proposedSolution,
      context: `Inbox librarian — asked in "${QUESTIONS_DOC_PREFIX} - …" next to ${sourceLabel}${submitter ? ` (submitter: ${submitter})` : ''}. ${q.context || ''}`.trim(),
    }),
    question: q.question,
    proposed: q.proposedSolution || '',
  }));
  if (!items.length) return null;
  const who = (submitter || path.basename(dir) || 'this drop').replace(/[\\/:*?"<>|]/g, ' ').trim();
  let dest = path.join(dir, `${QUESTIONS_DOC_PREFIX} - ${who}.docx`);
  let n = 2;
  while (fs.existsSync(dest)) dest = path.join(dir, `${QUESTIONS_DOC_PREFIX} - ${who} (${n++}).docx`);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { font-family: Calibri, sans-serif; font-size: 11pt; margin: 0.6in; color: #1a2733; }
  h1 { font-size: 15pt; margin: 0 0 2pt; color: #0f4c81; }
  .sub { font-size: 9.5pt; color: #4a5a6a; margin-bottom: 12pt; }
  .q { font-weight: bold; margin: 12pt 0 2pt; }
  .p { font-size: 9.5pt; color: #4a5a6a; margin: 0 0 4pt; }
  .a { border: 1pt solid #b8c4d0; background: #f7fafc; min-height: 48pt; padding: 6pt; margin-bottom: 4pt; }
  .alabel { font-size: 8.5pt; color: #8a99a8; }
</style></head><body>
<h1>QUESTIONS FROM THE SDC ENGINEER</h1>
<div class="sub">About: ${esc(sourceLabel)}${submitter ? ` — submitted by ${esc(submitter)}` : ''}, ${today()}.
Type your answers in the boxes and save this document — Jarvis reads it on his next pass,
files what he learns under your name, and renames this doc &ldquo;(answered)&rdquo;.</div>
${items.map((it, i) => `<div class="q">${i + 1}. ${esc(it.question)}</div>${it.proposed ? `<div class="p">SDC Engineer's best guess: ${esc(it.proposed)}</div>` : ''}<div class="alabel">Your answer:</div><div class="a">&nbsp;</div>`).join('\n')}
</body></html>`;
  await htmlToDocx(html, dest);
  const st = fs.statSync(dest);
  state.questionDocs = state.questionDocs || [];
  state.questionDocs.push({
    path: dest, dir, submitter: submitter || '', createdAt: nowIso(),
    key: `${st.size}:${Math.round(st.mtimeMs)}`,
    items: items.map(({ qid, question }) => ({ qid, question })),
    resolved: false,
  });
  appendLedger(`${nowIso().slice(0, 16).replace('T', ' ')} · wrote **${path.basename(dest)}** next to ${sourceLabel} — ${items.length} question(s) for ${submitter || 'the submitter'}; also visible in the app question queue.`);
  return dest;
}

/** Read answers typed into a questions doc (one cheap model call to pair
 *  answer text with questions), file them cited to the answerer, mark the
 *  app-queue entries answered, rename the doc "(answered)". */
async function checkQuestionsDocs(state, summaryLines) {
  const docs = (state.questionDocs || []).filter(d => !d.resolved);
  for (const doc of docs) {
    let st;
    try { st = fs.statSync(doc.path); } catch (_) { doc.resolved = 'missing'; continue; }
    const key = `${st.size}:${Math.round(st.mtimeMs)}`;
    if (key === doc.key) continue; // untouched
    doc.key = key;
    let text = '';
    try { text = await wordExtractText(doc.path); } catch (e) { summaryLines.push(`questions doc ${path.basename(doc.path)}: unreadable (${e.message})`); continue; }
    // Pair answers to questions with one small call (typed answers are free
    // text under each numbered question — regex is too brittle for Word).
    let parsed = null;
    try {
      const client = getClient();
      const resp = await client.messages.create({
        model: MODEL, max_tokens: 1500,
        system: 'A controls engineer typed answers into a questions document. Extract them. ' +
          'Respond ONLY JSON: {"answers":[{"n":<question number>,"answer":"<their words, verbatim-ish>"}]} — ' +
          'include ONLY questions that actually have an answer typed (ignore empty boxes and the original question/guess text).',
        messages: [{ role: 'user', content: `The questions were:\n${doc.items.map((it, i) => `${i + 1}. ${it.question}`).join('\n')}\n\nThe document now reads:\n---\n${text.slice(0, 20000)}` }],
      });
      const raw = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) { summaryLines.push(`questions doc ${path.basename(doc.path)}: answer parse failed (${e.message})`); continue; }
    const answers = (parsed?.answers || []).filter(a => a && a.answer && doc.items[a.n - 1]);
    if (!answers.length) continue; // edited but nothing answered yet — keep watching
    const who = doc.submitter || 'a controls engineer';
    const stamp = nowIso().slice(0, 16).replace('T', ' ');
    const qArr = readJson(QUESTIONS_PATH, []);
    for (const a of answers) {
      const it = doc.items[a.n - 1];
      fileToMeKnowledge([`${String(a.answer).trim()} (${who} answering the SDC Engineer's question: "${it.question}")`], path.basename(doc.path));
      const qe = qArr.find(q => q && q.id === it.qid);
      if (qe) { qe.status = 'answered'; qe.answer = String(a.answer).trim(); qe.answeredBy = who; qe.answeredAt = nowIso(); }
      it.answered = true;
    }
    try { writeJson(QUESTIONS_PATH, qArr); } catch (_) {}
    const allAnswered = doc.items.every(it => it.answered);
    if (allAnswered) {
      const renamed = doc.path.replace(/\.docx$/i, ' (answered).docx');
      try { fs.renameSync(doc.path, renamed); doc.path = renamed; } catch (_) {}
      doc.resolved = true;
    }
    appendLedger(`${stamp} · **${path.basename(doc.path)}** — ${who} answered ${answers.length} question(s); filed as dated knowledge cited to ${who}${allAnswered ? '; doc marked (answered)' : '; watching for the rest'}.`);
    summaryLines.push(`${who} answered ${answers.length} question(s) in ${path.basename(doc.path)}`);
  }
}

// ── network sources (read in place, batched) ─────────────────────────────────

const DOC_EXTS = new Set(['.pdf', '.md', '.txt', '.markdown']);
const CODE_EXTS = new Set(['.l5x']);

function walkNetworkFolder(dir, out, depth = 0, exclude = []) {
  if (depth > 8 || out.length > 20000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Visible, editable exclusions (inbox-sources.json "exclude") — the
      // judgment-call noise: ARCHIVE, EPLAN binaries, backups.
      if (exclude.some(x => x.toLowerCase() === e.name.toLowerCase())) continue;
      walkNetworkFolder(fp, out, depth + 1, exclude);
      continue;
    }
    if (!e.isFile()) continue;
    // Our own two-way artifacts are channels, not knowledge to ingest.
    if (isFormTemplate(e.name) || isQuestionsDoc(e.name) || /^readme\.txt$/i.test(e.name)) continue;
    // The CE bridge's own channel files (SDC Engineer\Knowledge) and the
    // folder's CLAUDE.md are handled by ceBridge.js — never generic-ingested.
    if (/^(ce-knowledge\.md|questions-for-ce\.md|claude\.md|_provenance\.txt)$/i.test(e.name)) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!DOC_EXTS.has(ext) && !CODE_EXTS.has(ext) && !['.docx', '.doc', '.xlsx'].includes(ext)) continue;
    try {
      const st = fs.statSync(fp);
      if (st.size > MAX_FILE_BYTES) continue;
      out.push({ path: fp, name: e.name, ext, size: st.size, mtimeMs: st.mtimeMs, dir: path.dirname(fp) });
    } catch (_) {}
  }
}

function ensureNetworkDropFolder(cfg, state) {
  const drop = path.join(cfg.networkRoot, cfg.networkDropFolder);
  try {
    if (!fs.existsSync(drop)) {
      fs.mkdirSync(drop);
      state.network.dropFolderCreated = nowIso();
      appendLedger(`${nowIso().slice(0, 16).replace('T', ' ')} · created the team drop folder \`${drop}\` (README inside) — anyone on the network can now feed Jarvis.`);
    }
    // README kept current (the etiquette changed when the form landed).
    const readmePath = path.join(drop, 'README.txt');
    const current = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
    if (current !== NETWORK_README) fs.writeFileSync(readmePath, NETWORK_README, 'utf8');
    // The submission form template + category folders live in the drop root.
    ensureCategoryFolders(drop);
    const formSrc = path.join(LOCAL_INBOX, FORM_TEMPLATE_NAME);
    const formDest = path.join(drop, FORM_TEMPLATE_NAME);
    if (fs.existsSync(formSrc) && !fs.existsSync(formDest)) fs.copyFileSync(formSrc, formDest);
  } catch (e) {
    console.warn('[librarian] could not prepare network drop folder:', e.message);
  }
}

/** Is a directory inside one of OUR writable folders (either inbox)? */
function isWritableInboxDir(dir, cfg) {
  const drop = path.join(cfg.networkRoot, cfg.networkDropFolder).toLowerCase();
  const d = String(dir).toLowerCase();
  return d.startsWith(drop) || d.startsWith(LOCAL_INBOX.toLowerCase());
}

async function processNetworkSources(cfg, state, summaryLines) {
  const net = state.network;
  if (!fs.existsSync(cfg.networkRoot)) {
    net.reachable = false;
    summaryLines.push(`network root unreachable (${cfg.networkRoot}) — skipped, will retry next run`);
    return;
  }
  net.reachable = true;
  ensureNetworkDropFolder(cfg, state);

  // Inventory. watchAll = the WHOLE dept share minus the visible exclusions
  // (Dan: "learn everything in the electrical department folder"); the
  // legacy targeted list remains for watchAll:false.
  const candidates = [];
  const scanRoots = cfg.watchAll ? [{ label: '(dept root)', dir: cfg.networkRoot }]
    : cfg.watch.map(f => ({ label: f, dir: path.join(cfg.networkRoot, f) }));
  for (const rootEntry of scanRoots) {
    const files = [];
    walkNetworkFolder(rootEntry.dir, files, 0, cfg.exclude ?? []);
    let pending = 0;
    for (const f of files) {
      const key = `${f.size}:${Math.round(f.mtimeMs)}`;
      const seen = net.seen[f.path];
      const folder = cfg.watchAll
        ? (path.relative(cfg.networkRoot, f.dir).split(path.sep)[0] || '(root)')
        : rootEntry.label;
      if (!seen || seen.key !== key) { candidates.push({ ...f, folder, key }); pending++; }
    }
    net.folders[rootEntry.label] = { lastScanned: nowIso(), known: files.length, pending };
  }

  // Prioritize: submission forms first (they steer their siblings), then the
  // drop folder, then L5X + standards docs, then the rest.
  const isForm = c => looksLikeSubmissionForm(c.name);
  // folder is the FIRST path segment under the root; a nested drop folder
  // ('SDC Engineer\Drop Files Here') matches on its first segment.
  const dropTop = cfg.networkDropFolder.split(/[\\/]/)[0].toLowerCase();
  const inDrop = c => c.folder.toLowerCase() === dropTop;
  const score = c =>
    (isForm(c) ? -2 : 0) + (inDrop(c) ? -1 : 0)
    + (CODE_EXTS.has(c.ext) ? 0 : DOC_EXTS.has(c.ext) ? 1 : 2)
    + (/standard/i.test(c.folder) ? 0 : 0.5);
  candidates.sort((a, b) => score(a) - score(b) || b.mtimeMs - a.mtimeMs);
  let batch = candidates.slice(0, cfg.batchPerRun);
  // A form's SIBLINGS ride the same run (the form's answers govern them) —
  // pulled into the batch even past the cap, bounded.
  const formDirs = new Set(batch.filter(isForm).map(c => c.dir));
  if (formDirs.size) {
    const extra = candidates.filter(c => !batch.includes(c) && formDirs.has(c.dir)).slice(0, cfg.batchPerRun);
    batch = [...batch, ...extra];
  }
  const stamp = () => nowIso().slice(0, 16).replace('T', ' ');

  // Persisted submission contexts (a form read last week still governs a
  // file dropped beside it today).
  net.submissions = net.submissions || {};
  const ctxOf = (dir) => net.submissions[dir] || null;
  const dirQuestions = new Map(); // dir → [{question, proposedSolution, context}]
  const addDirQuestion = (dir, q) => {
    if (!dirQuestions.has(dir)) dirQuestions.set(dir, []);
    dirQuestions.get(dir).push(q);
  };

  const newL5X = [];
  for (const c of batch) {
    const rel = path.relative(cfg.networkRoot, c.path);
    try {
      const buf = fs.readFileSync(c.path);
      const hash = sha256(buf);
      if (['.docx', '.doc'].includes(c.ext) && isForm(c)) {
        // A CE's submission form: parse it, remember it for its folder.
        const text = await wordExtractText(c.path);
        if (looksLikeSubmissionForm(c.name, text)) {
          const ctx = parseSubmissionForm(text);
          net.submissions[c.dir] = { ...ctx, formPath: c.path, at: nowIso() };
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — submission form from ${ctx.submitter || 'unnamed'}${ctx.machine ? ` (${ctx.machine})` : ''}: study focus "${ctx.focus || '—'}", verified code: ${ctx.verified === true ? 'YES' : ctx.verified === false ? 'NO' : 'not stated'}. Read in place.`);
          summaryLines.push(`submission form from ${ctx.submitter || 'unnamed'} — focus: ${ctx.focus || '—'}`);
        } else {
          // Named like a form but isn't one — treat as a document below.
          const result = await distillDocument({ sourceName: c.name, origin: `network: ${c.folder}`, text });
          const { filed } = applyDistill(result, { sourceName: c.name, origin: `network: ${c.folder}` });
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — ${result.classification || 'document'}: ${result.summary || ''} → filed: ${filed.length ? filed.join(', ') : 'nothing new'}. Read in place (\`${rel}\`).`);
        }
        net.seen[c.path] = { key: c.key, hash, ingestedAt: nowIso() };
        continue;
      }
      const ctx = ctxOf(c.dir);
      const category = CATEGORIES.find(cat =>
        c.path.toLowerCase().includes(`${path.sep}${cat.toLowerCase()}${path.sep}`)) ?? '';
      if (CODE_EXTS.has(c.ext)) {
        if (ctx && ctx.verified === true) {
          // The form's YES replaces the verification question — exemplar.
          fs.mkdirSync(PLC_VERIFIED_DIR, { recursive: true });
          let dest = path.join(PLC_VERIFIED_DIR, c.name);
          if (fs.existsSync(dest)) dest = path.join(PLC_VERIFIED_DIR, path.basename(c.name, c.ext) + '__' + today() + c.ext);
          fs.copyFileSync(c.path, dest);
          const harvested = refreshPrecedents();
          updateSourcesManifest({
            name: `Verified build: ${c.name}`,
            location: `plc-reference/verified/${path.basename(dest)}`,
            accessStatus: 'copied-locally',
            takeaways: [`Engineer-verified per ${ctx.submitter || 'the'} submission form${ctx.machine ? ` (${ctx.machine})` : ''}${ctx.focus ? ` — study focus: "${ctx.focus}"` : ''}`],
          });
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder} — submitted by ${ctx.submitter || 'unnamed'}) — engineer-verified L5X per the submission form → copied to \`plc-reference/verified/${path.basename(dest)}\`${harvested ? ', precedents.md re-harvested' : ''}. Original stays in place (\`${rel}\`).`);
          summaryLines.push(`verified L5X ${c.name} (per ${ctx.submitter || 'form'}) → plc-reference/verified/`);
        } else if (ctx && ctx.verified === false) {
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder} — submitted by ${ctx.submitter || 'unnamed'}) — L5X marked NOT verified on the form → inventoried reference-only, in place (\`${rel}\`).`);
        } else {
          newL5X.push(rel);
          if (ctx) addDirQuestion(c.dir, {
            question: `Is "${c.name}" engineer-verified working code I should rank as an exemplar? The submission form didn't say YES or NO.`,
            proposedSolution: 'Circle YES on the form (or answer here) and I will rank it; otherwise it stays reference-only.',
          });
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — L5X inventoried in place (\`${rel}\`); verification question pending. Never moved.`);
        }
      } else if (DOC_EXTS.has(c.ext) || ['.docx', '.doc'].includes(c.ext)) {
        const extracted = await extractText(c.path);
        if (!extracted.ok) {
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — could not read: ${extracted.reason}. Left in place (\`${rel}\`).`);
        } else {
          const origin = `network: ${c.folder}${ctx?.submitter ? `; submitted by ${ctx.submitter}` : ''}${ctx?.focus ? `; study focus: "${ctx.focus}"` : ''}`;
          const result = await distillDocument({
            sourceName: c.name, origin, text: extracted.text,
            studyFocus: ctx?.focus ?? '', category, submitter: ctx?.submitter ?? '', formNotes: ctx?.notes ?? '',
          });
          const { filed, questions } = applyDistill(result, { sourceName: c.name, origin });
          for (const conf of (result.conflicts || [])) if (ctx && conf?.question) addDirQuestion(c.dir, conf);
          updateSourcesManifest({
            name: c.name,
            location: `\\\\…\\Electrical Dept\\${rel}`,
            accessStatus: 'full-access',
            takeaways: result.takeaways || [],
          });
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}${ctx?.submitter ? ` — submitted by ${ctx.submitter}` : ''}${ctx?.focus ? `, study focus: "${ctx.focus}"` : ''}${category ? `, ${category}` : ''}) — ${result.classification || 'document'}: ${result.summary || ''} → filed: ${filed.length ? filed.join(', ') : 'nothing new'}${questions ? `; ${questions} conflict question(s)` : ''}. Read in place (\`${rel}\`).`);
          summaryLines.push(`network ${c.name}: ${filed.length ? 'filed → ' + filed.join(', ') : 'nothing new'}`);
        }
      } else {
        appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — inventoried; no ${c.ext} extractor yet. Left in place (\`${rel}\`).`);
      }
      net.seen[c.path] = { key: c.key, hash, ingestedAt: nowIso() };
    } catch (e) {
      summaryLines.push(`network ${c.name}: FAILED (${e.message})`);
    }
  }

  // BACK-AND-FORTH: questions about a submission are written NEXT TO it —
  // but only inside OUR writable inbox folders, never the dept's own.
  for (const [dir, qs] of dirQuestions) {
    const ctx = ctxOf(dir);
    if (!isWritableInboxDir(dir, cfg)) {
      for (const q of qs) fileQuestion({ ...q, context: `Inbox librarian — about files in ${dir}. ${q.context || ''}`.trim() });
      continue;
    }
    try {
      await writeQuestionsDoc(state, {
        dir, submitter: ctx?.submitter || '', questions: qs,
        sourceLabel: `the drop in ${path.basename(dir)}${ctx?.machine ? ` (${ctx.machine})` : ''}`,
      });
    } catch (e) {
      summaryLines.push(`questions doc for ${path.basename(dir)}: FAILED (${e.message}) — filed to the app queue instead`);
      for (const q of qs) fileQuestion({ ...q, context: `Inbox librarian — about files in ${dir}.` });
    }
  }

  if (newL5X.length) {
    fileQuestion({
      question: `Found ${newL5X.length} new L5X file(s) on the network watch folders: ${newL5X.slice(0, 8).join('; ')}${newL5X.length > 8 ? ` (+${newL5X.length - 8} more)` : ''}. Which of these are engineer-verified SDC code I should rank as exemplars?`,
      proposedSolution: 'Tell me which are verified (or copy them into JARVIS Inbox\\verified\\ locally, or mark YES on a submission form beside them) and I will file them into plc-reference/verified/ and re-harvest precedents. The rest stay inventoried as reference.',
      context: 'Inbox librarian — network L5X inventory',
    });
  }
  const remaining = candidates.length - batch.length;
  if (remaining > 0) summaryLines.push(`network backlog: ${remaining} file(s) queued for future runs`);
}

// ── run + status ─────────────────────────────────────────────────────────────

let _running = false;

async function runLibrarian({ trigger = 'manual' } = {}) {
  if (_running) return { ok: false, error: 'A librarian run is already in progress' };
  _running = true;
  const summaryLines = [];
  const errors = [];
  const state = loadState();
  const cfg = loadConfig();
  try {
    ensureCategoryFolders(LOCAL_INBOX);
    // The two-way channel first: any questions doc a CE (or Dan) edited
    // gets read — answers file as dated knowledge cited to the answerer.
    try { await checkQuestionsDocs(state, summaryLines); }
    catch (e) { errors.push(`questions docs: ${e.message}`); }

    // Local drops (Dan's inbox): submission FORMS first — a form's answers
    // (study focus, verified yes/no) govern its sibling files this run.
    const localItems = listLocalUnread();
    const localCtxByDir = {};
    for (const item of localItems.filter(i => ['.docx', '.doc'].includes(path.extname(i.file).toLowerCase()) && looksLikeSubmissionForm(i.file))) {
      try {
        const ctx = await processLocalForm(item, summaryLines);
        if (ctx) localCtxByDir[item.dir] = ctx;
        item._done = true;
      } catch (e) { errors.push(`${item.file}: ${e.message}`); item._done = true; }
    }
    for (const item of localItems.filter(i => !i._done)) {
      try { await processLocalFile(item, summaryLines, localCtxByDir[item.dir] ?? null); }
      catch (e) {
        errors.push(`${item.file}: ${e.message}`);
        // AI down = every doc will fail the same way; stop instead of spamming.
        if (e.code === 'AI_NOT_CONFIGURED') break;
      }
    }
    try { await processNetworkSources(cfg, state, summaryLines); }
    catch (e) { errors.push(`network scan: ${e.message}`); }

    // The CE bridge (SDC Engineer\Knowledge): file Jason's appended
    // ce-knowledge entries as doctrine, post open questions, read answers.
    try { require('./ceBridge.js').syncCeBridge(cfg, state, summaryLines); }
    catch (e) { errors.push(`ce-bridge: ${e.message}`); }

    state.lastRun = nowIso();
    state.lastTrigger = trigger;
    state.lastResult = { processed: summaryLines, errors };
    saveState(state);
    return { ok: errors.length === 0, processed: summaryLines, errors, lastRun: state.lastRun };
  } finally {
    _running = false;
  }
}

function getStatus() {
  const state = loadState();
  const cfg = loadConfig();
  const unread = listLocalUnread();
  const watchLabels = cfg.watchAll ? ['(dept root)'] : cfg.watch;
  const netFolders = watchLabels.map(f => ({ folder: f, ...(state.network.folders?.[f] || { lastScanned: null, known: null, pending: null }) }));
  const backlog = netFolders.reduce((n, f) => n + (f.pending || 0), 0);
  const openDocs = (state.questionDocs || []).filter(d => d.resolved === false);
  return {
    running: _running,
    unreadCount: unread.length,
    unreadFiles: unread.map(u => (u.verified ? 'verified\\' : '') + u.file),
    // The two-way channel: questions docs awaiting CE answers.
    openQuestionDocs: openDocs.map(d => ({
      doc: path.basename(d.path), submitter: d.submitter || null,
      questions: d.items.length,
      answered: d.items.filter(i => i.answered).length,
      createdAt: d.createdAt,
    })),
    lastRun: state.lastRun,
    lastTrigger: state.lastTrigger,
    lastResult: state.lastResult,
    recentLedger: recentLedgerLines(12),
    network: {
      root: cfg.networkRoot,
      reachable: state.network.reachable,
      dropFolderCreated: state.network.dropFolderCreated,
      watched: netFolders,
      backlog,
      batchPerRun: cfg.batchPerRun,
    },
  };
}

module.exports = {
  runLibrarian, getStatus, LOCAL_INBOX, LEARNED_DIR, LEDGER_PATH,
  // exported for the regression script (scripts/regressLibrarianForms.cjs)
  _internals: { htmlToDocx, wordExtractText, parseSubmissionForm, writeQuestionsDoc, checkQuestionsDocs, loadState, saveState },
};

// Standalone: node src/lib/agentGenerator/librarian.js [status]
if (require.main === module) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  if (process.argv[2] === 'status') {
    console.log(JSON.stringify(getStatus(), null, 2));
  } else {
    runLibrarian({ trigger: 'cli' })
      .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); })
      .catch(e => { console.error(e); process.exit(1); });
  }
}
