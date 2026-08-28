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
const crypto = require('crypto');
const { execFileSync } = require('child_process');

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
  networkDropFolder: 'JARVIS Inbox',
  watch: [
    'JARVIS Inbox',
    'SDC Knowledgebase',
    'Standards - Software',
    'Standards - Elect Design',
    'Standards - Pneumatics',
    'EE Process and Standards Documents',
  ],
  batchPerRun: 10,
};

const NETWORK_README =
  'JARVIS INBOX (team drop folder)\r\n' +
  '===============================\r\n\r\n' +
  'Drop standards, shipped code, references, or lessons-learned notes here —\r\n' +
  'Jarvis reads new files daily. Your files stay put (Jarvis reads in place,\r\n' +
  'never moves or edits them). Questions and what he learned are visible to\r\n' +
  'Dan in the State Logic Builder app (Jarvis page > Knowledge tab).\r\n';

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
  if (cfg) return { ...DEFAULT_CONFIG, ...cfg };
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
    md = '# JARVIS Inbox — learning ledger\n\n---\n';
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
      '> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the\n' +
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

// ── text extraction ──────────────────────────────────────────────────────────

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.md', '.txt', '.markdown', '.csv', '.json'].includes(ext)) {
    return { ok: true, text: fs.readFileSync(filePath, 'utf8') };
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

async function distillDocument({ sourceName, origin, text }) {
  const client = getClient();
  const inv = knowledgeInventory();
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
  const user = `Document: ${sourceName}\nOrigin: ${origin}\n\n---\n${String(text).slice(0, MAX_DOC_CHARS)}`;
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
  try {
    for (const f of fs.readdirSync(LOCAL_INBOX)) {
      const fp = path.join(LOCAL_INBOX, f);
      if (!fs.statSync(fp).isFile()) continue;
      if (/^readme\.txt$/i.test(f) || f.startsWith('~$') || f.startsWith('.')) continue;
      out.push({ file: f, path: fp, verified: false });
    }
    if (fs.existsSync(LOCAL_VERIFIED)) {
      for (const f of fs.readdirSync(LOCAL_VERIFIED)) {
        const fp = path.join(LOCAL_VERIFIED, f);
        if (!fs.statSync(fp).isFile() || f.startsWith('~$') || f.startsWith('.')) continue;
        out.push({ file: f, path: fp, verified: true });
      }
    }
  } catch (_) {}
  return out;
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

async function processLocalFile(item, summaryLines) {
  const stamp = nowIso().slice(0, 16).replace('T', ' ');
  const ext = path.extname(item.file).toLowerCase();

  if (ext === '.l5x') {
    if (item.verified) {
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
        takeaways: ['Engineer-verified exemplar — ranks in the naming precedent pack' + (harvested ? ' (precedents.md refreshed)' : '')],
      });
      appendLedger(`${stamp} · **${item.file}** (local inbox, verified\\) — engineer-verified L5X → copied to \`plc-reference/verified/${path.basename(dest)}\`${harvested ? ', precedents.md re-harvested' : ' (precedent harvest FAILED — rerun scripts/harvestPrecedents.cjs)'}. Drop preserved as \`_learned/${learnedAs}\`.`);
      summaryLines.push(`verified L5X ${item.file} → plc-reference/verified/`);
    } else {
      // Unverified L5X — never rank it silently; ask.
      const learnedAs = moveToLearned(item.path);
      fileQuestion({
        question: `"${item.file}" was dropped in the JARVIS Inbox root (not verified\\). Is it engineer-verified SDC code I should rank as an exemplar, or reference-only?`,
        proposedSolution: `If verified, say so (or re-drop it into JARVIS Inbox\\verified\\) and I will file it into plc-reference/verified/ and re-harvest precedents. Until then I hold it in _learned/${learnedAs} as reference-only.`,
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
  const result = await distillDocument({ sourceName: item.file, origin: 'local inbox drop', text: extracted.text });
  const { filed, questions } = applyDistill(result, { sourceName: item.file, origin: 'local inbox drop' });
  const learnedAs = moveToLearned(item.path);
  updateSourcesManifest({
    name: item.file,
    location: `JARVIS Inbox/_learned/${learnedAs}`,
    accessStatus: 'copied-locally',
    takeaways: result.takeaways || [],
  });
  appendLedger(`${stamp} · **${item.file}** (local inbox) — ${result.classification || 'document'}: ${result.summary || ''} → filed: ${filed.length ? filed.join(', ') : 'nothing new'}${questions ? `; ${questions} conflict question(s) filed` : ''}. Moved to \`_learned/${learnedAs}\`.`);
  summaryLines.push(`${item.file}: ${filed.length ? 'filed → ' + filed.join(', ') : 'nothing new'}${questions ? `, ${questions} question(s)` : ''}`);
}

// ── network sources (read in place, batched) ─────────────────────────────────

const DOC_EXTS = new Set(['.pdf', '.md', '.txt', '.markdown']);
const CODE_EXTS = new Set(['.l5x']);

function walkNetworkFolder(dir, out, depth = 0) {
  if (depth > 6 || out.length > 5000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { walkNetworkFolder(fp, out, depth + 1); continue; }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!DOC_EXTS.has(ext) && !CODE_EXTS.has(ext) && !['.docx', '.doc', '.xlsx'].includes(ext)) continue;
    try {
      const st = fs.statSync(fp);
      if (st.size > MAX_FILE_BYTES) continue;
      out.push({ path: fp, name: e.name, ext, size: st.size, mtimeMs: st.mtimeMs });
    } catch (_) {}
  }
}

function ensureNetworkDropFolder(cfg, state) {
  const drop = path.join(cfg.networkRoot, cfg.networkDropFolder);
  try {
    if (!fs.existsSync(drop)) {
      fs.mkdirSync(drop);
      fs.writeFileSync(path.join(drop, 'README.txt'), NETWORK_README, 'utf8');
      state.network.dropFolderCreated = nowIso();
      appendLedger(`${nowIso().slice(0, 16).replace('T', ' ')} · created the team drop folder \`${drop}\` (README inside) — anyone on the network can now feed Jarvis.`);
    } else if (!fs.existsSync(path.join(drop, 'README.txt'))) {
      fs.writeFileSync(path.join(drop, 'README.txt'), NETWORK_README, 'utf8');
    }
  } catch (e) {
    console.warn('[librarian] could not create network drop folder:', e.message);
  }
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

  // Inventory every watched folder; collect new/changed candidates.
  const candidates = [];
  for (const folder of cfg.watch) {
    const dir = path.join(cfg.networkRoot, folder);
    const files = [];
    walkNetworkFolder(dir, files);
    let pending = 0;
    for (const f of files) {
      const key = `${f.size}:${Math.round(f.mtimeMs)}`;
      const seen = net.seen[f.path];
      if (!seen || seen.key !== key) { candidates.push({ ...f, folder, key }); pending++; }
    }
    net.folders[folder] = { lastScanned: nowIso(), known: files.length, pending };
  }

  // Prioritize: L5X and "Standards" folders first, then readable docs.
  const score = c =>
    (CODE_EXTS.has(c.ext) ? 0 : DOC_EXTS.has(c.ext) ? 1 : 2) + (/standard/i.test(c.folder) ? 0 : 0.5);
  candidates.sort((a, b) => score(a) - score(b) || b.mtimeMs - a.mtimeMs);
  const batch = candidates.slice(0, cfg.batchPerRun);
  const stamp = () => nowIso().slice(0, 16).replace('T', ' ');

  const newL5X = [];
  for (const c of batch) {
    const rel = path.relative(cfg.networkRoot, c.path);
    try {
      const buf = fs.readFileSync(c.path);
      const hash = sha256(buf);
      if (CODE_EXTS.has(c.ext)) {
        newL5X.push(rel);
        appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — L5X inventoried in place (\`${rel}\`); verification question pending. Never moved.`);
      } else if (DOC_EXTS.has(c.ext)) {
        const extracted = await extractText(c.path);
        if (!extracted.ok) {
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — could not read: ${extracted.reason}. Left in place (\`${rel}\`).`);
        } else {
          const result = await distillDocument({ sourceName: c.name, origin: `network: ${c.folder}`, text: extracted.text });
          const { filed, questions } = applyDistill(result, { sourceName: c.name, origin: `network: ${c.folder}` });
          updateSourcesManifest({
            name: c.name,
            location: `\\\\…\\Electrical Dept\\${rel}`,
            accessStatus: 'full-access',
            takeaways: result.takeaways || [],
          });
          appendLedger(`${stamp()} · **${c.name}** (network: ${c.folder}) — ${result.classification || 'document'}: ${result.summary || ''} → filed: ${filed.length ? filed.join(', ') : 'nothing new'}${questions ? `; ${questions} conflict question(s)` : ''}. Read in place (\`${rel}\`).`);
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

  if (newL5X.length) {
    fileQuestion({
      question: `Found ${newL5X.length} new L5X file(s) on the network watch folders: ${newL5X.slice(0, 8).join('; ')}${newL5X.length > 8 ? ` (+${newL5X.length - 8} more)` : ''}. Which of these are engineer-verified SDC code I should rank as exemplars?`,
      proposedSolution: 'Tell me which are verified (or copy them into JARVIS Inbox\\verified\\ locally) and I will file them into plc-reference/verified/ and re-harvest precedents. The rest stay inventoried as reference.',
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
    // Local drops first (Dan's inbox), then the network batch.
    for (const item of listLocalUnread()) {
      try { await processLocalFile(item, summaryLines); }
      catch (e) {
        errors.push(`${item.file}: ${e.message}`);
        // AI down = every doc will fail the same way; stop instead of spamming.
        if (e.code === 'AI_NOT_CONFIGURED') break;
      }
    }
    try { await processNetworkSources(cfg, state, summaryLines); }
    catch (e) { errors.push(`network scan: ${e.message}`); }

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
  const netFolders = cfg.watch.map(f => ({ folder: f, ...(state.network.folders?.[f] || { lastScanned: null, known: null, pending: null }) }));
  const backlog = netFolders.reduce((n, f) => n + (f.pending || 0), 0);
  return {
    running: _running,
    unreadCount: unread.length,
    unreadFiles: unread.map(u => (u.verified ? 'verified\\' : '') + u.file),
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

module.exports = { runLibrarian, getStatus, LOCAL_INBOX, LEARNED_DIR, LEDGER_PATH };

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
