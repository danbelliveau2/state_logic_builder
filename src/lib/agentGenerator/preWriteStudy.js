/**
 * preWriteStudy.js — the PRE-WRITE STUDY PHASE (Dan's first-pass doctrine,
 * 2026-08-25, his sequence verbatim): "Look at the request. Use SDC standards.
 * Look at the references they gave you — pictures, L5X files, documents,
 * anything. Ask the engineers any questions BEFORE writing. Write the code
 * based on SDC standards. Maybe one review at the end. You don't get eight
 * revisions — you get one."
 *
 * Two jobs, both BEFORE the translation call ever runs:
 *
 * 1. assembleStudyContext() — deliberately gather the full working context:
 *    - the COMPLETE closest exemplar: the newest engineer-VERIFIED file
 *      (plc-reference/verified/ — confirmed correct by a senior CE), else
 *      engineer-corrected build (generated/**__corrected_by_*.L5X), else
 *      delivered file (JARVIS Deliveries/) of the same template family,
 *      rendered rung-for-rung
 *      (routine bodies via internalReviewer.renderProgramRoutines — never tag
 *      blobs). Token budget guard: over EXEMPLAR_CHAR_BUDGET the core
 *      routines ride whole in priority order and the rest are named as
 *      omitted (whole routines or nothing — never truncated mid-routine).
 *    - the station's studied reference material → its lessons
 *      (jarvis-knowledge/sources.json takeaways).
 *    - the build's decisions and rulings: approved deviations, compile
 *      review flags/decisions, and this station's ANSWERED questions from
 *      the queue (the humans already ruled — those answers are law).
 *    (Concept docs + meKnowledge already ride in the generation prompt via
 *    promptBuilder — not duplicated here.)
 *
 * 2. readinessCheck() — one CHEAP fast-model call gating the write:
 *    "Before writing: list anything unresolved, ambiguous, or missing that
 *    would cause a defect." Hold discipline applies (the self-answer test —
 *    derivable items are decided, never asked). Anything real comes back as
 *    blocking questions WITH proposed solutions (the existing channel);
 *    client.js holds the build BEFORE the write. Empty list → proceed.
 *
 * The 8-round fix loop remains in client.js as a SAFETY NET only; every fix
 * round now files tuition lessons (see client.js formulateTuition) so rounds
 * trend to zero. The headline metric is firstPassShip (buildScores.js).
 *
 * CommonJS, server-side only. Required lazily by client.js. Must NOT require
 * client.js (client.js requires this module).
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..', '..', '..');
const GENERATED_DIR = path.join(ROOT, 'generated');
const DELIVERIES_DIR = path.join(ROOT, 'SDC Engineer Deliveries');
const VERIFIED_DIR = path.join(ROOT, 'plc-reference', 'verified');
const SOURCES_FILE = path.join(ROOT, 'jarvis-knowledge', 'sources.json');
const QUESTIONS_FILE = path.join(ROOT, 'jarvis-knowledge', 'questions.json');

// The readiness pass is deliberately CHEAP — a fast model, small output.
const READINESS_MODEL = process.env.JARVIS_READINESS_MODEL || 'claude-haiku-4-5';
const READINESS_MAX_TOKENS = parseInt(process.env.JARVIS_READINESS_MAX_TOKENS, 10) || 4000;

// $ per 1M tokens: [input, output] — kept local (no client.js require).
const PRICING = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

function costOfUsage(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-haiku-4-5'];
  const input = (usage.input_tokens || 0) * inRate;
  const cacheRead = (usage.cache_read_input_tokens || 0) * inRate * 0.10;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * inRate * 1.25;
  const output = (usage.output_tokens || 0) * outRate;
  return (input + cacheRead + cacheWrite + output) / 1e6;
}

// ── Exemplar selection ───────────────────────────────────────────────────────

/** Template family of a template filename (S05_ServoPNP → 'servo', …). */
function templateFamily(templateName) {
  if (/Indexer/i.test(templateName || '')) return 'indexer';
  if (/ServoPNP/i.test(templateName || '')) return 'servo';
  return 'pneumatic';
}

/** Family of a candidate exemplar L5X, judged by its actual contents. The
 *  target program's NAME decides indexer (dial programs are S00_*Index*);
 *  content markers like q_WaitStationsComplete appear in PNP stations too
 *  (they consume the dial's handshake), so they must not decide. */
function exemplarFamily(xml) {
  const progName = (xml.match(/<Program Use="Target" Name="([^"]+)"/) || [])[1] || '';
  if (/Index/i.test(progName) || /<Routine Name="\w*ShotPin\w*"/i.test(xml)) return 'indexer';
  if (/<Routine Name="R0\d_\w*Servo"/i.test(xml) || /\bMAM\(/.test(xml)) return 'servo';
  return 'pneumatic';
}

function walkL5x(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of entries) {
    const fp = path.join(dir, d.name);
    if (d.isDirectory()) walkL5x(fp, out);
    else if (/\.L5X$/i.test(d.name)) out.push(fp);
  }
  return out;
}

/**
 * Find the closest KNOWN-GOOD exemplar for a template family. Only three kinds
 * of file qualify (a plain generated file may itself be flawed):
 *   1. engineer-verified builds (plc-reference/verified/) — a senior controls
 *      engineer read the file and confirmed it CORRECT (e.g. Jason Perry
 *      confirming SDCServoPNP_JARVIS_v7, 2026-08-26). The gold standard.
 *   2. engineer-corrected builds (…__corrected_by_<name>.L5X) — engineer
 *      rewrote the wrong parts; the corrections are law, the rest is theirs.
 *   3. delivered files (JARVIS Deliveries/) — shipped, so vetted.
 * Ranked verified > corrected > delivered, then newest. Returns
 * { path, name, kind: 'engineer-verified'|'engineer-corrected'|'delivered', mtime } or null.
 */
const EXEMPLAR_RANK = { 'engineer-verified': 0, 'engineer-corrected': 1, 'delivered': 2 };

function findClosestExemplar(templateName) {
  const family = templateFamily(templateName);
  const candidates = [];
  for (const fp of walkL5x(VERIFIED_DIR, [])) {
    candidates.push({ path: fp, kind: 'engineer-verified' });
  }
  for (const fp of walkL5x(GENERATED_DIR, [])) {
    if (/__corrected_by_/i.test(path.basename(fp))) {
      candidates.push({ path: fp, kind: 'engineer-corrected' });
    }
  }
  for (const fp of walkL5x(DELIVERIES_DIR, [])) {
    candidates.push({ path: fp, kind: 'delivered' });
  }
  const scored = [];
  for (const c of candidates) {
    let xml;
    try { xml = fs.readFileSync(c.path, 'utf8'); } catch (_) { continue; }
    if (exemplarFamily(xml) !== family) continue;
    let mtime = 0;
    try { mtime = fs.statSync(c.path).mtimeMs; } catch (_) {}
    scored.push({ ...c, name: path.basename(c.path), mtime, xml });
  }
  scored.sort((a, b) =>
    (a.kind === b.kind ? b.mtime - a.mtime
      : (EXEMPLAR_RANK[a.kind] ?? 9) - (EXEMPLAR_RANK[b.kind] ?? 9)));
  const best = scored[0] || null;
  // family + considered ride along so the PICK REASONING can be recorded on
  // the build (Dan, 2026-08-26: "which one do I pick? that's key" — the choice
  // is never silent).
  return best ? { ...best, family, considered: scored.length } : null;
}

// Core routines ride whole first when the exemplar must be trimmed to budget.
const CORE_PRIORITY = [
  /^R02_/, /^R03_/, /Servo$/i, /^R20_/, /^R01_/, /^R00_/,
];

/**
 * Render an exemplar's routine bodies rung-for-rung, within a char budget.
 * Over budget: whole routines are kept in CORE_PRIORITY order until the
 * budget is spent; omitted routines are NAMED (whole-or-nothing, never
 * truncated mid-routine). Under budget: the complete file's routines.
 */
function renderExemplarStudy(xml, { charBudget = 150000 } = {}) {
  const { renderProgramRoutines } = require('./internalReviewer');
  const full = renderProgramRoutines(xml);
  if (full.text.length <= charBudget) {
    return { text: full.text, complete: true, omittedRoutines: [] };
  }
  // Re-render per routine so we can pick whole routines by priority.
  const sections = full.text.split(/\n\n(?=### Routine )/);
  const byName = new Map();
  for (const s of sections) {
    const m = /^### Routine (\S+)/.exec(s);
    if (m) byName.set(m[1], s);
  }
  const ranked = [...byName.keys()].sort((a, b) => {
    const rank = n => {
      const i = CORE_PRIORITY.findIndex(re => re.test(n));
      return i === -1 ? CORE_PRIORITY.length : i;
    };
    return rank(a) - rank(b);
  });
  const kept = [];
  const omitted = [];
  let used = 0;
  for (const name of ranked) {
    const s = byName.get(name);
    if (used + s.length <= charBudget) { kept.push(name); used += s.length; }
    else omitted.push(name);
  }
  // Preserve original routine order in the output.
  const text = [...byName.keys()].filter(n => kept.includes(n)).map(n => byName.get(n)).join('\n\n');
  return { text, complete: false, omittedRoutines: omitted };
}

// ── Reference lessons + build decisions ──────────────────────────────────────

/** Lessons from studied reference material (jarvis-knowledge/sources.json). */
function collectReferenceLessons() {
  let sources;
  try {
    const parsed = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    sources = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.sources) ? parsed.sources : []);
  } catch (_) { return ''; }
  const lines = [];
  for (const s of sources) {
    if (!s || !Array.isArray(s.takeaways) || !s.takeaways.length) continue;
    lines.push(`- ${s.name || s.id || 'source'}${s.lastIngested ? ` (studied ${s.lastIngested})` : ''}:`);
    for (const t of s.takeaways.slice(0, 12)) lines.push(`  - ${String(t).trim()}`);
  }
  return lines.join('\n');
}

const asText = v => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    return String(v.text || v.what || v.note || v.flag || v.decision || JSON.stringify(v)).trim();
  }
  return String(v).trim();
};

/**
 * The build's decisions and rulings: approved deviations (spec-level law),
 * compile review flags / recorded decisions, and this station's ANSWERED
 * questions from the queue (a human already ruled — the answer is law).
 */
function collectBuildDecisions(projectJson, sm) {
  const lines = [];
  const specs = [sm && sm.machineSpec, projectJson && projectJson.machineSpec].filter(Boolean);
  for (const spec of specs) {
    for (const d of (Array.isArray(spec.approvedDeviations) ? spec.approvedDeviations : [])) {
      const t = asText(d);
      if (t) lines.push(`- APPROVED DEVIATION (never re-flag, never "correct" back to standard): ${t}` +
        (d && d.reason ? ` — reason: ${asText(d.reason)}` : '') +
        (d && d.approvedBy ? ` (approved by ${d.approvedBy})` : ''));
    }
  }
  const cir = sm && sm.compiledSequence && sm.compiledSequence.ir;
  if (cir) {
    for (const f of (Array.isArray(cir.reviewFlags) ? cir.reviewFlags : [])) {
      const t = asText(f);
      if (t) lines.push(`- COMPILE REVIEW FLAG: ${t}`);
    }
    for (const d of (Array.isArray(cir.decisions) ? cir.decisions : [])) {
      const t = asText(d);
      if (t) lines.push(`- COMPILE DECISION (recorded): ${t}`);
    }
  }
  // Answered questions touching this station — human rulings, authoritative.
  try {
    const queue = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
    const smName = (sm && sm.name) || '';
    const hits = (Array.isArray(queue) ? queue : []).filter(q =>
      q && q.status === 'answered' && String(q.answer || '').trim() &&
      (String(q.buildRef || '').includes(smName) || String(q.context || '').includes(smName)));
    for (const q of hits.slice(0, 20)) {
      lines.push(`- ANSWERED (${q.answeredBy || 'human'}): Q: ${String(q.question).trim()} → A: ${String(q.answer).trim()}`);
    }
  } catch (_) {}
  return lines.join('\n');
}

// ── Study assembly ───────────────────────────────────────────────────────────

/**
 * Assemble the full pre-write study context for one station.
 * @returns {{ text, exemplar: {name, kind, complete, omittedRoutines}|null,
 *             sizes: { exemplarChars, lessonsChars, decisionsChars, totalChars } }}
 */
function assembleStudyContext({ projectJson, sm, templateName, exemplarCharBudget }) {
  const parts = [];
  let exemplarInfo = null;
  const ex = findClosestExemplar(templateName);
  let exemplarChars = 0;
  if (ex) {
    const rendered = renderExemplarStudy(ex.xml, exemplarCharBudget ? { charBudget: exemplarCharBudget } : {});
    exemplarChars = rendered.text.length;
    exemplarInfo = {
      name: ex.name, kind: ex.kind, family: ex.family,
      complete: rendered.complete, omittedRoutines: rendered.omittedRoutines,
      // The recorded WHY of the pick — rides onto the build record
      // (buildScores study.exemplar.reason) so every dossier says which
      // exemplar was studied and why it won.
      reason: `${ex.family} family match for template ${templateName || '(unspecified)'}; `
        + `ranked ${ex.kind} (verified > corrected > delivered, newest first) `
        + `of ${ex.considered} family candidate(s)`,
    };
    const kindLabel = ex.kind === 'engineer-verified'
      ? 'ENGINEER-VERIFIED-CORRECT — confirmed correct by the senior controls engineer'
      : ex.kind === 'engineer-corrected' ? 'engineer-corrected, rung-for-rung gold standard'
      : 'delivered/vetted file';
    parts.push(
      `## THE CLOSEST EXEMPLAR — ${ex.name} (${kindLabel})`,
      'This is a COMPLETE real SDC program of the same family, ' +
      (ex.kind === 'engineer-verified'
        ? 'read and CONFIRMED CORRECT by the senior controls engineer — every shape in it is verified SDC standard. Before asking any human a question, check whether this file already answers it.'
        : ex.kind === 'engineer-corrected'
        ? 'corrected rung-for-rung by the senior controls engineer — every shape in it is what the reviewer accepts.'
        : 'shipped to the controls team.'),
      'Study it for SHAPES and idioms (trigger rungs, staging, alarms, ordering, comments).',
      'Its state numbers, positions, and station specifics belong to ITS station — never copy',
      'those; your station\'s approved sequence is the law for logic.',
      rendered.complete ? '' :
        `(Budget trim: routines included whole — omitted: ${rendered.omittedRoutines.join(', ')})`,
      '',
      rendered.text,
    );
  }
  const lessons = collectReferenceLessons();
  if (lessons) {
    parts.push('', '## LESSONS FROM STUDIED REFERENCE MATERIAL (sources already ingested)', lessons);
  }
  const decisions = collectBuildDecisions(projectJson, sm);
  if (decisions) {
    parts.push('', '## THIS BUILD\'S DECISIONS AND RULINGS (authoritative — already decided, never re-ask, never re-flag)', decisions);
  }
  const text = parts.length
    ? ['# PRE-WRITE STUDY CONTEXT (Dan\'s first-pass doctrine: study → ask → write once → one review)',
       'This phase is Jason Perry\'s steps 1-6 (read/understand/review/select — concepts/how-jason-writes-code.md);',
       'the write that follows is judged against his steps 7-14. Cite the step a decision serves.',
       '', ...parts].join('\n')
    : '';
  return {
    text,
    exemplar: exemplarInfo,
    sizes: {
      exemplarChars,
      lessonsChars: lessons.length,
      decisionsChars: decisions.length,
      totalChars: text.length,
    },
  };
}

// ── Readiness pass ───────────────────────────────────────────────────────────

function extractJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (_) {}
  try { return JSON.parse(slice.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')); } catch (_) { return null; }
}

const isRealQuestion = (s) => /\?/.test(s) ||
  /^(what|which|where|when|who|how|why|should|shall|can|could|do|does|did|is|are|will|would|may|might)\b/i.test(s);

const READINESS_SYSTEM = [
  'You are Jarvis, THE SDC controls engineer (there is no CE review gate — YOU decide',
  'controls), about to write the FINAL L5X program for a station in ONE pass.',
  'Your only job right now is the PRE-WRITE READINESS CHECK.',
  '',
  'JARVIS IS THE CE (Dan\'s doctrine, 2026-08-31): every controls-grade item you can answer',
  'from the exemplar, SDC standards, shipped patterns, or the approved sheet is a DECISION,',
  'never a question. Decide it, cite the precedent, and move on — decisions are logged in',
  'the build record for the reviewer, not asked. Examples of DECISIONS: motion-complete',
  'gating, sensorless-actuator timer patterns, external-signal stubs, standard timeouts and',
  'alarms, debounce defaults, cycle-complete outputs, fault-recovery rung shape when the',
  'approved recovery panel specifies it.',
  '',
  'A QUESTION exists only when the answer needs the MECHANICAL engineer\'s knowledge of the',
  'physical machine (a dwell vs padding, geometry intent, process policy with no precedent).',
  'THE SHEET ANSWERS FIRST (the VerticalSlide regression): before asking, check the sheet\'s',
  'EFFECTIVE state — a delay marked "inactive (sensor governs)" IS the answer (exit on the',
  'sensor); an approved recovery panel IS the rung shape; a device the change log deleted is',
  'GONE. Approved deviations and answered questions are settled — never re-raise them.',
  'NO PADDING: an empty list is the expected, honest answer when the context is complete.',
  '',
  'FEW WORDS (Dan\'s law): questions in as few words as possible — strip parentheses,',
  'examples, tag names and jargon unless the answer is impossible without them. One plain',
  'sentence of proposal + the citation. Every question ends in "?".',
  '',
  'Respond with ONLY a JSON object:',
  '{"ready": true|false,',
  ' "decisions": [{"decision":"<one sentence>","citation":"<exemplar/standard/sheet source>"}],',
  ' "unresolved": [{"question":"...?","proposedSolution":"<one sentence + citation>","domain":"mechanical"|"controls"|"jarvis"}]}',
  '"ready" is false ONLY when "unresolved" is non-empty. Decisions never hold the build.',
].join('\n');

/**
 * One cheap fast-model call: is everything resolved enough to write a
 * defect-free file? Empty list → proceed. Real items → the caller holds the
 * build BEFORE writing and files the questions (existing channel).
 *
 * @returns {Promise<{ready, questions:[{question,proposedSolution,domain,addressee}],
 *                    costUSD, model, error?}>}
 * Never throws for model/parse trouble — a readiness failure must never block
 * generation (it degrades to ready:true with error noted; the write-once
 * prompt and the final review still stand behind it).
 */
async function readinessCheck({ planText, studyText, signal }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ready: true, questions: [], costUSD: 0, model: READINESS_MODEL, error: 'no API key' };
  }
  try {
    const { resolveQuestionDomain, resolveAddressee } = require('./questionRouter');
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();
    const req = {
      model: READINESS_MODEL,
      max_tokens: READINESS_MAX_TOKENS,
      system: READINESS_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          ...(studyText ? [{ type: 'text', text: studyText }] : []),
          { type: 'text', text: [
            '# THE PLAN YOU ARE ABOUT TO WRITE FROM',
            planText,
            '',
            '# TASK',
            'Run the pre-write readiness check on everything above. Respond with ONLY the JSON object.',
          ].join('\n') },
        ],
      }],
    };
    const resp = await client.beta.messages.create(req, signal ? { signal } : undefined);
    if (resp.stop_reason === 'refusal') throw new Error('model declined the readiness check');
    const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const costUSD = resp.usage ? Number(costOfUsage(resp.usage, READINESS_MODEL).toFixed(4)) : 0;
    const parsed = extractJson(text);
    if (!parsed) throw new Error('readiness response was not parseable JSON');
    const questions = (Array.isArray(parsed.unresolved) ? parsed.unresolved : [])
      .filter(q => q && String(q.question || '').trim())
      .map(q => {
        const question = String(q.question).trim();
        const domain = resolveQuestionDomain(q.domain, question);
        return {
          question,
          proposedSolution: String(q.proposedSolution || '').trim() || null,
          addressee: resolveAddressee(q.addressee, domain),
          domain,
        };
      })
      // Statements are not questions (Dan) — drop non-questions honestly.
      .filter(q => isRealQuestion(q.question));
    // JARVIS IS THE CE: precedent-backed items come back as DECISIONS —
    // logged for the reviewer, never holding the build.
    const decisions = (Array.isArray(parsed.decisions) ? parsed.decisions : [])
      .map(x => ({ decision: String(x?.decision ?? '').trim(), citation: String(x?.citation ?? '').trim() }))
      .filter(x => x.decision);
    return { ready: questions.length === 0, questions, decisions, costUSD, model: resp.model || READINESS_MODEL };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) throw e;
    // Fail open, reported honestly: a broken readiness check never blocks the
    // build — the safety-net loop and the final review still stand behind it.
    return { ready: true, questions: [], decisions: [], costUSD: 0, model: READINESS_MODEL, error: e.message || String(e) };
  }
}

module.exports = {
  assembleStudyContext, readinessCheck,
  findClosestExemplar, renderExemplarStudy, templateFamily, exemplarFamily,
  collectReferenceLessons, collectBuildDecisions,
  READINESS_MODEL,
};
