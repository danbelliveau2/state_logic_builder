/**
 * ceBridge.js — the CE <-> SDC Engineer bridge (Dan, 2026-08-31).
 *
 * Jason (senior CE) runs Claude Code pointed at the network folder
 *   \\...\Electrical Dept\SDC Engineer\
 * His sessions APPEND dated, attributed entries to Knowledge\ce-knowledge.md
 * and type answers into Knowledge\questions-for-ce.md. This module is the
 * repo side of that contract, called once per librarian run:
 *
 *   1. ce-knowledge.md  — new appended entries ingest as engineer-authored
 *      doctrine into meKnowledge (the one store buildEngineContext rides
 *      into every codegen call). Top tier: attributed, dated, never distilled
 *      through a model — the engineer's words go in as written.
 *   2. questions-for-ce.md — open controls questions from
 *      jarvis-knowledge/questions.json are APPENDED (never rewriting Jason's
 *      edits); answers found under a question file back into questions.json
 *      (status answered, credited) and into meKnowledge.
 *
 * State lives in librarian-state.json under `ceBridge` (offset+hash of the
 * ingested ce-knowledge prefix, so only NEW appends are read). All writes to
 * the share are additive; his files are never reordered or truncated.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KNOW_DIR = path.join(__dirname, '..', '..', '..', 'jarvis-knowledge');
const QUESTIONS_PATH = path.join(KNOW_DIR, 'questions.json');

const CE_KNOWLEDGE = 'ce-knowledge.md';
const QUESTIONS_DOC = 'questions-for-ce.md';
const ANSWER_MARK = '**Answer:**';
const FILED_MARK = '_(filed ';
const PLACEHOLDER = '(type your answer below this line)';

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function sha16(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }
function today() { return new Date().toISOString().slice(0, 10); }

/** Resolve the folder layout from the librarian config. */
function paths(cfg) {
  const root = path.join(cfg.networkRoot, cfg.networkEngineerRoot || 'SDC Engineer');
  return {
    root,
    knowledgeDir: path.join(root, 'Knowledge'),
    ceKnowledge: path.join(root, 'Knowledge', CE_KNOWLEDGE),
    questionsDoc: path.join(root, 'Knowledge', QUESTIONS_DOC),
    shareLedger: path.join(root, '_learned', 'LEDGER.md'),
  };
}

/** RETIRED (Dan, 2026-08-31 — share minimalism): the share holds EXACTLY
 *  Knowledge\ + Samples\; nothing may auto-create folders/files there. The
 *  full drop-by-drop ledger lives locally in _learned\LEDGER.md. No-op. */
function appendShareLedger(_cfg, _line) {}

// ── 1. ce-knowledge.md → meKnowledge (engineer-authored doctrine) ───────────

/** Ingest NEW appended content only. Entries go into meKnowledge verbatim
 *  (dated + attributed by Jason's own headings), scope 'sdc-standard' — the
 *  same tier verified-exemplar facts ride at. */
function ingestCeKnowledge(cfg, state, summaryLines) {
  const p = paths(cfg).ceKnowledge;
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  const st = state.ceBridge = state.ceBridge || {};
  let offset = st.ceKnowledgeOffset || 0;
  // Append-only contract check: the prefix we already ingested must be
  // unchanged. If it was edited, re-read from the top (meKnowledge dedupes).
  if (offset > text.length || sha16(text.slice(0, offset)) !== st.ceKnowledgePrefixHash) offset = 0;
  const fresh = text.slice(offset).trim();
  if (fresh) {
    // Split into dated entry blocks (## heading … until next ##); loose
    // bullet lines without a heading still ingest, attributed to the file.
    const blocks = fresh.split(/\n(?=##\s)/).map(b => b.trim()).filter(Boolean)
      .filter(b => !/^#\s/.test(b)); // skip the file's own title/header block
    const facts = [];
    for (const b of blocks) {
      const heading = (b.match(/^##\s*(.+)$/m) || [])[1] || `${today()} — CE`;
      for (const line of b.split('\n')) {
        const m = line.match(/^\s*[-*]\s+(.+)$/);
        if (m && m[1].trim()) facts.push(`${m[1].trim()} (${heading.trim()})`);
      }
    }
    if (facts.length) {
      const { appendLearnedFacts } = require('./meKnowledge.js');
      appendLearnedFacts(
        facts.map(f => ({ fact: `${f} [source: ${CE_KNOWLEDGE} — engineer-authored doctrine]`, scope: 'sdc-standard' })),
        { who: 'CE' }
      );
      summaryLines.push(`ce-knowledge.md: ${facts.length} engineer-taught fact(s) filed as doctrine`);
      appendShareLedger(cfg, `${today()} · ce-knowledge.md — ${facts.length} entr(ies) filed into the SDC Engineer's standing knowledge (rides every build).`);
    }
  }
  st.ceKnowledgeOffset = text.length;
  st.ceKnowledgePrefixHash = sha16(text);
}

// ── 2. questions-for-ce.md — write open questions, read back answers ────────

/** Open controls/CE questions worth a senior engineer's time (skip the
 *  librarian's own inventory notices and auto bug reports). */
function openCeQuestions() {
  return readJson(QUESTIONS_PATH, []).filter(q =>
    q.status === 'open'
    && (q.domain === 'controls' || q.addressee === 'CE')
    && !/^Found \d+ new L5X/i.test(q.question || '')
    && !/^BUG auto-report/i.test(q.question || ''));
}

function questionBlock(q, n) {
  const lines = [
    `## Q${n} [${q.id}]`,
    '',
    `**Question:** ${String(q.question).trim()}`,
  ];
  if (q.proposedSolution) lines.push('', `**Best guess:** ${String(q.proposedSolution).trim()}`);
  if (q.context) lines.push('', `_Context: ${String(q.context).trim()}${q.buildRef ? ` (${q.buildRef})` : ''}_`);
  lines.push('', ANSWER_MARK, PLACEHOLDER, '', '---', '');
  return lines.join('\r\n');
}

const DOC_HEADER = [
  '# Questions for the CE',
  '',
  'Open controls questions from the SDC Engineer. Type your answer under',
  '**Answer:** (replace the placeholder line) and save — he reads it on his',
  'next daily pass, files it with your name, and marks the question answered',
  'in the app. New questions are appended at the end; answered ones get a',
  '_(filed ...)_ stamp. Never worry about formatting — plain words win.',
  '',
  '---',
  '',
].join('\r\n');

/** Append any open question not yet in the doc. Never touches existing text. */
function writeQuestionsForCe(cfg, summaryLines) {
  const p = paths(cfg).questionsDoc;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const missing = openCeQuestions().filter(q => !text.includes(`[${q.id}]`));
  if (!missing.length && text) return;
  let out = text || DOC_HEADER;
  let n = (text.match(/^## Q\d+/gm) || []).length;
  for (const q of missing) out += questionBlock(q, ++n);
  fs.writeFileSync(p, out, 'utf8');
  if (missing.length) summaryLines.push(`questions-for-ce.md: ${missing.length} open question(s) posted for the CE`);
}

/** Extract {id → answerText} for blocks with a real answer and no filed stamp. */
function parseCeAnswers(text) {
  const answers = {};
  const blocks = text.split(/^## /m).slice(1);
  for (const b of blocks) {
    const id = (b.match(/^Q\d+\s*\[([^\]]+)\]/) || [])[1];
    if (!id) continue;
    const ai = b.indexOf(ANSWER_MARK);
    if (ai < 0 || b.includes(FILED_MARK)) continue;
    let a = b.slice(ai + ANSWER_MARK.length);
    a = a.split(/\r?\n---/)[0]; // stop at the block divider
    a = a.split('\n').filter(l => !l.includes(PLACEHOLDER)).join('\n').trim();
    if (a) answers[id] = a;
  }
  return answers;
}

/** Read answers back: file into questions.json (credited, closed in-app),
 *  meKnowledge, and stamp the doc block "(filed ...)". */
function readCeAnswers(cfg, summaryLines) {
  const p = paths(cfg).questionsDoc;
  if (!fs.existsSync(p)) return;
  let text = fs.readFileSync(p, 'utf8');
  const answers = parseCeAnswers(text);
  const ids = Object.keys(answers);
  if (!ids.length) return;
  const arr = readJson(QUESTIONS_PATH, []);
  const { appendLearnedFacts } = require('./meKnowledge.js');
  let filed = 0;
  for (const id of ids) {
    const q = arr.find(x => x.id === id);
    if (!q || q.status !== 'open') continue;
    q.status = 'answered';
    q.answer = answers[id];
    q.answeredBy = 'Jason (CE)';
    q.answeredAt = today();
    q.answerSource = `SDC Engineer/Knowledge/${QUESTIONS_DOC}`;
    appendLearnedFacts(
      [{ fact: `${answers[id]} (Jason (CE), ${today()}, answering: "${String(q.question).slice(0, 160)}") [source: ${QUESTIONS_DOC}]`, scope: 'sdc-standard' }],
      { who: 'CE' }
    );
    // Stamp the block so it is never re-read (and Jason sees it landed).
    text = text.replace(`[${id}]`, `[${id}] _(filed ${today()} — thank you)_`);
    filed++;
  }
  if (filed) {
    writeJson(QUESTIONS_PATH, arr);
    fs.writeFileSync(p, text, 'utf8');
    summaryLines.push(`questions-for-ce.md: ${filed} answer(s) from Jason (CE) filed and closed`);
    appendShareLedger(cfg, `${today()} · questions-for-ce.md — ${filed} answer(s) filed, credited Jason (CE), closed in-app.`);
  }
}

/** One call per librarian run. Never throws (share may be unreachable).
 *  RETIRED 2026-08-31 (Dan's structure ruling): the questions-for-ce.md
 *  mechanism is gone — Knowledge\ holds EXACTLY the one master file, and we
 *  never push question files at Jason (his Claude conversations + drops are
 *  how he teaches; open CE questions live in-app only). readCeAnswers still
 *  runs so an old copy resurfacing ingests once; writeQuestionsForCe is
 *  never called — do not revive it. */
function syncCeBridge(cfg, state, summaryLines) {
  try {
    if (!fs.existsSync(paths(cfg).root)) return;
    readCeAnswers(cfg, summaryLines);   // legacy answers doc, ingest-only
    ingestCeKnowledge(cfg, state, summaryLines);
  } catch (e) {
    summaryLines.push(`ce-bridge: FAILED (${e.message})`);
  }
}

module.exports = { syncCeBridge, _internals: { parseCeAnswers, openCeQuestions, questionBlock, paths } };
