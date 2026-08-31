/**
 * masterKnowledge.js — THE ONE MASTER FILE on the share (Dan, 2026-08-31).
 *
 *   \\...\Electrical Dept\SDC Engineer\Knowledge\SDC-Engineer-Knowledge.md
 *
 * ONE file — "not a series of a hundred files" — holding EVERYTHING the
 * SDC Engineer uses to generate code: every meKnowledge law and learned
 * lesson (dated, attributed), every concept doc, the naming-precedents
 * digest, the standards-document extracts, and the template/init pattern
 * digest. Standard: a generator reading only this file plus a station sheet
 * should produce today's-quality code.
 *
 * TWO-WAY SYNC (generalizes the ceBridge contract):
 *   app → file  regenerateMasterFile(): rebuilds the AUTO sections from the
 *               local store on every librarian run (new laws, librarian
 *               learnings, concept edits all land here). The
 *               "## Engineer additions" section at the bottom is preserved
 *               VERBATIM across every regeneration — Jason appends freely.
 *   file → app  ingestEngineerAdditions(): new appends under
 *               "## Engineer additions" file into meKnowledge (top tier,
 *               attributed "Jason (CE)" or per his own byline) — the one
 *               store buildEngineContext rides into every codegen call.
 *               ingestKnowledgeFiles(): any OTHER .md/.txt Jason (or his
 *               Claude sessions) saves into Knowledge\ ingests the same way,
 *               watermarked by content hash so nothing double-files.
 *
 * State lives in librarian-state.json under `masterKnowledge`. All parsing
 * is additive and deduped by meKnowledge's fuzzy-duplicate check; the
 * engineer's files are never edited, reordered, or truncated (the master
 * file's auto sections are the single exception — they are OURS).
 *
 * Standalone: node src/lib/agentGenerator/masterKnowledge.js  (full sync)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const KNOW_DIR = path.join(ROOT, 'jarvis-knowledge');
const CONCEPTS_DIR = path.join(KNOW_DIR, 'concepts');
const STANDARDS_DOCS_DIR = path.join(ROOT, 'plc-reference', 'standards-docs');

const MASTER_FILE = 'SDC-Engineer-Knowledge.md';
const ENGINEER_HEADING = '## Engineer additions';
// Files in Knowledge\ that are their OWN channels — never generic-ingested here.
const CHANNEL_FILES = /^(ce-knowledge\.md|questions-for-ce\.md|claude\.md|_provenance\.txt)$/i;

function sha16(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }
function today() { return new Date().toISOString().slice(0, 10); }
function readOr(fn, fallback = '') { try { return fn(); } catch (_) { return fallback; } }

function masterPath(cfg) {
  return path.join(cfg.networkRoot, cfg.networkEngineerRoot || 'SDC Engineer', 'Knowledge', MASTER_FILE);
}

// ── app → file: regenerate the auto sections ────────────────────────────────

function conceptSections() {
  const files = readOr(() => fs.readdirSync(CONCEPTS_DIR), [])
    .filter(f => f.toLowerCase().endsWith('.md') && !/^readme\.md$/i.test(f))
    .sort();
  return files.map(f => ({
    title: path.basename(f, '.md'),
    body: readOr(() => fs.readFileSync(path.join(CONCEPTS_DIR, f), 'utf8')).trim(),
  })).filter(s => s.body);
}

function standardsExtractSections() {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    for (const e of readOr(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walk(fp, depth + 1); continue; }
      if (!/\.extracted\.md$/i.test(e.name)) continue;
      const body = readOr(() => fs.readFileSync(fp, 'utf8')).trim();
      if (body) out.push({ title: e.name.replace(/\.extracted\.md$/i, ''), body });
    }
  };
  walk(STANDARDS_DOCS_DIR);
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

function templatePatternsBlock() {
  const patterns = readOr(() => require('./templatePatterns.js').getTemplatePatterns().patterns, null);
  if (!patterns) return '';
  return [
    'Machine-derived structural digest of the shipped SDC standard templates',
    '(routines, per-axis rung structure, R02 transition shapes, invariants).',
    'Regenerated automatically whenever a template file changes.',
    '',
    '```json',
    JSON.stringify(patterns, null, 1),
    '```',
  ].join('\n');
}

const ENGINEER_SEED = [
  ENGINEER_HEADING,
  '',
  '> Yours, Jason — append freely below this line. Everything here survives',
  '> every regeneration VERBATIM, and new bullets are read into the SDC',
  "> Engineer's standing knowledge on his next daily pass (credited to you,",
  '> top tier — it rides every build). Date and sign entries like:',
  '>',
  '> ### 2026-08-31 — Jason',
  '> - The rule, in one sentence.',
  '',
].join('\n');

/** Rebuild the master file's auto sections; preserve engineer additions. */
function regenerateMasterFile(cfg, state, summaryLines) {
  const p = masterPath(cfg);
  let engineerSection = ENGINEER_SEED;
  if (fs.existsSync(p)) {
    const existing = fs.readFileSync(p, 'utf8');
    const idx = existing.indexOf(ENGINEER_HEADING);
    if (idx >= 0) engineerSection = existing.slice(idx).replace(/\s*$/, '') + '\n';
  }

  const version = readOr(() => require('./jarvisVersion.js').JARVIS_VERSION, '?');
  const meKnowledge = readOr(() => require('./meKnowledge.js').loadMeKnowledge());
  const precedents = readOr(() => fs.readFileSync(path.join(KNOW_DIR, 'precedents.md'), 'utf8')).trim();
  const conflicts = readOr(() => fs.readFileSync(path.join(KNOW_DIR, 'analysis', 'standards-doc-conflicts.md'), 'utf8')).trim();
  const concepts = conceptSections();
  const extracts = standardsExtractSections();
  const tpl = templatePatternsBlock();

  const sections = [];
  sections.push({ h: '## 1. Standing knowledge — laws and learned lessons (meKnowledge)', body: meKnowledge });
  sections.push({
    h: '## 2. Concept notes',
    body: concepts.map(c => `### 2.${concepts.indexOf(c) + 1} ${c.title}\n\n${c.body}`).join('\n\n---\n\n'),
  });
  sections.push({ h: '## 3. Naming precedents (auto-harvested from shipped SDC code)', body: precedents });
  sections.push({
    h: '## 4. Standards document extracts',
    body: extracts.map((s, i) => `### 4.${i + 1} ${s.title}\n\n${s.body}`).join('\n\n---\n\n'),
  });
  sections.push({ h: '## 5. Template & initialization patterns', body: tpl });
  sections.push({ h: '## 6. Open standards conflicts (interim rulings)', body: conflicts });

  const kept = sections.filter(s => s.body);
  const mapLines = kept.map(s => `- ${s.h.replace(/^##\s*/, '')}`);
  mapLines.push(`- ${ENGINEER_HEADING.replace(/^##\s*/, '')} — Jason's section, preserved verbatim`);

  const header = [
    '# SDC Engineer — Knowledge (master file)',
    '',
    `> ONE file, the whole brain. Auto-generated by the SDC Engineer (engine v${version})`,
    `> on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — every section above "${ENGINEER_HEADING.replace(/^##\s*/, '')}"`,
    '> is rebuilt on his daily pass; DO NOT edit those by hand (edits are lost on',
    `> regeneration). YOUR section is "${ENGINEER_HEADING.replace(/^##\s*/, '')}" at the bottom — append there`,
    '> (or drop sample files in Examples\\ — any structure you like), and he reads',
    '> it into his standing knowledge on his next pass.',
    '',
    '## Section map',
    '',
    ...mapLines,
    '',
  ].join('\n');

  const content = header + '\n' + kept.map(s => `${s.h}\n\n${s.body}`).join('\n\n\n') + '\n\n\n' + engineerSection;

  const st = state.masterKnowledge = state.masterKnowledge || {};
  const bodyHash = sha16(content.replace(/on \d{4}-\d{2}-\d{2} \d{2}:\d{2}/, '')); // stamp-insensitive
  if (st.lastWrittenHash === bodyHash && fs.existsSync(p)) return; // unchanged — no churn on the share
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  st.lastWrittenHash = bodyHash;
  st.lastWrittenAt = new Date().toISOString();
  if (summaryLines) summaryLines.push(`${MASTER_FILE}: regenerated (${kept.length} auto sections + engineer additions preserved)`);
}

// ── file → app: engineer additions + other Knowledge\ files ─────────────────

/** Byline of a block heading like "### 2026-08-31 — Jason" → "Jason (CE)". */
function bylineOf(heading) {
  const m = String(heading || '').match(/[—-]\s*([A-Za-z][A-Za-z .'-]{1,40})\s*$/);
  const name = m ? m[1].trim() : '';
  if (!name || /^\d/.test(name)) return 'Jason (CE)';
  return /\(CE\)/i.test(name) ? name : `${name} (CE)`;
}

/** Bullet lines of a markdown block → fact strings; paragraph fallback. */
function factsOfBlock(block, headingLabel) {
  const facts = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (m && m[1].trim()) facts.push(`${m[1].trim()}${headingLabel ? ` (${headingLabel})` : ''}`);
  }
  if (!facts.length) {
    // No bullets — short paragraphs file as facts (Jason writes prose too).
    for (const para of block.split(/\n\s*\n/)) {
      const t = para.replace(/^#+.*$/m, '').replace(/\s+/g, ' ').trim();
      if (t && t.length >= 20 && t.length <= 500 && !t.startsWith('>')) {
        facts.push(`${t}${headingLabel ? ` (${headingLabel})` : ''}`);
      }
    }
  }
  return facts;
}

/** Parse markdown into attributed facts: split on ##/### headings. */
function attributedFacts(text, defaultLabel) {
  const out = []; // [{ fact, who }]
  const blocks = String(text).split(/\n(?=###?\s)/).map(b => b.trim()).filter(Boolean);
  for (const b of blocks) {
    const heading = (b.match(/^###?\s*(.+)$/m) || [])[1] || '';
    if (/^#\s/.test(b)) continue; // file's own title block
    const label = heading.trim() || defaultLabel || `${today()} — CE`;
    const who = bylineOf(heading);
    for (const f of factsOfBlock(b.replace(/^###?.*$/m, ''), label)) out.push({ fact: f, who });
  }
  return out;
}

function fileFacts(facts, sourceName, summaryLines) {
  if (!facts.length) return 0;
  const { appendLearnedFacts } = require('./meKnowledge.js');
  let recorded = 0;
  // Group by attribution so each rides with the right name.
  const byWho = new Map();
  for (const f of facts) {
    if (!byWho.has(f.who)) byWho.set(f.who, []);
    byWho.get(f.who).push({ fact: `${f.fact} [source: ${sourceName} — engineer-authored]`, scope: 'sdc-standard' });
  }
  for (const [who, list] of byWho) {
    const r = appendLearnedFacts(list, { who });
    recorded += r.recorded.length;
  }
  if (recorded && summaryLines) summaryLines.push(`${sourceName}: ${recorded} engineer-taught fact(s) filed as doctrine`);
  return recorded;
}

/** New appends under "## Engineer additions" → meKnowledge (watermarked). */
function ingestEngineerAdditions(cfg, state, summaryLines) {
  const p = masterPath(cfg);
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  const idx = text.indexOf(ENGINEER_HEADING);
  if (idx < 0) return;
  const section = text.slice(idx + ENGINEER_HEADING.length);
  const st = state.masterKnowledge = state.masterKnowledge || {};
  let offset = st.additionsOffset || 0;
  if (offset > section.length || sha16(section.slice(0, offset)) !== st.additionsPrefixHash) offset = 0;
  const fresh = section.slice(offset)
    .split('\n').filter(l => !l.trim().startsWith('>')).join('\n').trim(); // seed text is quoted
  if (fresh) fileFacts(attributedFacts(fresh, 'Engineer additions'), `${MASTER_FILE} — Engineer additions`, summaryLines);
  st.additionsOffset = section.length;
  st.additionsPrefixHash = sha16(section);
}

/** Other .md/.txt files saved into Knowledge\ ingest verbatim, top tier. */
function ingestKnowledgeFiles(cfg, state, summaryLines) {
  const dir = path.dirname(masterPath(cfg));
  if (!fs.existsSync(dir)) return;
  const st = state.masterKnowledge = state.masterKnowledge || {};
  st.files = st.files || {};
  for (const e of readOr(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (name === MASTER_FILE || CHANNEL_FILES.test(name)) continue;
    if (!/\.(md|txt)$/i.test(name) || name.startsWith('~$') || name.startsWith('.')) continue;
    const text = readOr(() => fs.readFileSync(path.join(dir, name), 'utf8'));
    if (!text.trim()) continue;
    const hash = sha16(text);
    if (st.files[name] && st.files[name].hash === hash) continue; // unchanged
    fileFacts(attributedFacts(text, name), `Knowledge/${name}`, summaryLines);
    st.files[name] = { hash, ingestedAt: new Date().toISOString() };
  }
}

/** One call per librarian run — ingest first (file → app), then regenerate
 *  (app → file) so today's teachings appear in today's master file. */
function syncMasterKnowledge(cfg, state, summaryLines) {
  try {
    const root = path.join(cfg.networkRoot, cfg.networkEngineerRoot || 'SDC Engineer');
    if (!fs.existsSync(root)) return;
    ingestEngineerAdditions(cfg, state, summaryLines);
    ingestKnowledgeFiles(cfg, state, summaryLines);
    regenerateMasterFile(cfg, state, summaryLines);
  } catch (e) {
    if (summaryLines) summaryLines.push(`master-knowledge: FAILED (${e.message})`);
  }
}

module.exports = {
  syncMasterKnowledge, regenerateMasterFile, MASTER_FILE, ENGINEER_HEADING,
  _internals: { attributedFacts, bylineOf, factsOfBlock, masterPath },
};

// Standalone: node src/lib/agentGenerator/masterKnowledge.js
if (require.main === module) {
  const cfgPath = path.join(KNOW_DIR, 'inbox-sources.json');
  const statePath = path.join(KNOW_DIR, 'librarian-state.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const state = readOr(() => JSON.parse(fs.readFileSync(statePath, 'utf8')), {});
  const lines = [];
  syncMasterKnowledge(cfg, state, lines);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(lines.join('\n') || '(no changes)');
}
