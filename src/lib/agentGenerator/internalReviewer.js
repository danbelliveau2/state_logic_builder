/**
 * internalReviewer.js — the PRE-DELIVERY INTERNAL REVIEW ("pre-Jason pass").
 *
 * Before ANY generated file goes external, Jarvis reviews it the way the
 * senior SDC controls engineer would — adversarially, against the template.
 * Mechanical validators (validator.js) catch structure; THIS pass catches
 * what they can't: style drift, missing template blocks, wrong-shaped logic,
 * anything a CE would flag. One set of changes, fixed right — the file only
 * gets marked "ready to send" when this pass says ship.
 *
 * THE CHECK (Dan, Aug 2026 — the doctrine): "Once you generate the code, it
 * must always pass ONE check: based on everything you know about SDC and the
 * template files, does this code's breakdown and structure match SDC
 * standards? If you don't know — ask questions about SDC standards. That's
 * the check, always." Three verdicts:
 *   'ship'   — in line with SDC standards; Jarvis puts his name on it.
 *   'fix'    — a KNOWN standards violation; not ready until a human decides.
 *   'unsure' — the pattern inventory + concepts + meKnowledge do not answer
 *              whether a structural choice meets SDC standards. The build is
 *              HELD (never shipped, never "fixed" by guessing): specific
 *              standards questions are filed to jarvis-knowledge/questions.json
 *              (source 'internal review') for the controls team.
 *
 * reviewGenerated({ l5xPath | l5x, projectJson, smId, signal, buildId }):
 *   ONE model call (JARVIS_MODEL, effort high). Input:
 *     - the generated file's ROUTINE BODIES (rung text + comments per
 *       routine — never tag data blobs; the input stays focused),
 *     - the matching template's same routines COMPLETE (the one place
 *       full-fidelity template context is worth every token — the reviewer
 *       must see the reference),
 *     - the compiled IR summary (the approved sequence when one exists,
 *       else the diagram IR),
 *     - the engineering concepts + ME knowledge (loadConcepts/loadMeKnowledge).
 *   Returns { verdict: 'ship'|'fix'|'unsure', findings, standardsQuestions,
 *             questionIds, heldStatus, missingVsTemplate, summary, costUSD,
 *             model, durationS, at }. Stored build records with only
 *             'ship'|'fix'|null stay valid — 'unsure' is additive.
 *
 * A 'fix' verdict does NOT auto-loop regeneration (cost discipline) — it
 * marks the build "not ready for external delivery" so a human decides.
 *
 * Gate: JARVIS_INTERNAL_REVIEW=on|off (default on) — checked by the CALLER
 * (client.js generateL5X), not here, so direct calls (benchmarks, the
 * calibration harness) always run.
 *
 * CommonJS, plain Node — required lazily by client.js. Must NOT require
 * client.js (client.js requires this module).
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { buildIR } = require('./ir');
const { selectTemplate } = require('./promptBuilder');
const { loadConcepts, loadMeKnowledge, SUPREME_LAW } = require('./meKnowledge');
const { renderPatternInventory } = require('./templatePatterns');
const { resolveQuestionDomain, resolveAddressee, resolveQuestionKind } = require('./questionRouter');

const ROOT = path.join(__dirname, '..', '..', '..');
const STANDARD_DIR = path.join(ROOT, 'plc-reference', 'standard');

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
// A review is prose+JSON, not an edit plan — 32K output is generous headroom.
const MAX_TOKENS = parseInt(process.env.JARVIS_REVIEW_MAX_OUTPUT_TOKENS, 10) || 32000;
// Cheaper tier for INTERMEDIATE delta-scoped fix rounds only (86-minute
// autopsy, 2026-08-25). The first full review and the final ship verdict
// ALWAYS run the full MODEL on the full file — that quality gate never moves.
const INTERMEDIATE_MODEL = process.env.JARVIS_REVIEW_INTERMEDIATE_MODEL || 'claude-sonnet-5';

// $ per 1M tokens: [input, output] — same table as client.js (kept local so
// this module never requires client.js: client.js requires THIS module).
const PRICING = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

function costOfUsage(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-opus-5'];
  const input = (usage.input_tokens || 0) * inRate;
  const cacheRead = (usage.cache_read_input_tokens || 0) * inRate * 0.10;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * inRate * 1.25;
  const output = (usage.output_tokens || 0) * outRate;
  return (input + cacheRead + cacheWrite + output) / 1e6;
}

// ── L5X routine extraction (self-contained; mirrors promptBuilder's parsers) ─

function targetProgramSlice(xml) {
  const m = /<Program Use="Target"[^>]*>/.exec(xml);
  if (!m) throw new Error('L5X has no <Program Use="Target">');
  const end = xml.indexOf('</Program>', m.index);
  return xml.slice(m.index, end === -1 ? xml.length : end);
}

function listRoutineNames(progXml) {
  return [...progXml.matchAll(/<Routine Name="([^"]+)" Type="RLL"/g)].map(m => m[1]);
}

function extractRoutineRungs(progXml, routineName) {
  const rm = new RegExp(`<Routine Name="${routineName}"[^>]*>`).exec(progXml);
  if (!rm) return null;
  const end = progXml.indexOf('</Routine>', rm.index);
  const section = progXml.slice(rm.index, end === -1 ? progXml.length : end);
  const rungs = [];
  const re = /<Rung\b[^>]*>([\s\S]*?)<\/Rung>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const body = m[1];
    const cm = /<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/.exec(body);
    const tm = /<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/.exec(body);
    rungs.push({ comment: cm ? cm[1].trim() : null, text: tm ? tm[1].trim() : '' });
  }
  return rungs;
}

/** Render every RLL routine of a program as "rung N // comment \n text" —
 *  routine bodies ONLY (no tag data blobs). */
function renderProgramRoutines(xml) {
  const prog = targetProgramSlice(xml);
  const names = listRoutineNames(prog);
  const parts = [];
  for (const name of names) {
    const rungs = extractRoutineRungs(prog, name);
    if (!rungs) continue;
    const lines = [`### Routine ${name} (${rungs.length} rungs)`];
    rungs.forEach((r, i) => {
      if (r.comment) lines.push(`rung ${i} // ${r.comment.replace(/\r?\n/g, ' | ')}`);
      else lines.push(`rung ${i}`);
      lines.push(`  ${r.text}`);
    });
    parts.push(lines.join('\n'));
  }
  return { text: parts.join('\n\n'), routineNames: names };
}

// ── Response parsing ─────────────────────────────────────────────────────────

/** Pull the review JSON out of the model response (tolerates fences/prose). */
function extractReviewJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const slice = t.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (_) {}
  // Repair invalid JSON escapes from quoted rung text (\Tracking.p_Data… —
  // raw L5X backslash paths inside findings). Same fix as correctionLearner.
  try { return JSON.parse(slice.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')); } catch (_) { return null; }
}

const SEVERITIES = new Set(['blocker', 'style', 'note']);

function normalizeReview(raw) {
  const findings = (Array.isArray(raw.findings) ? raw.findings : [])
    .filter(f => f && (f.finding || f.issue))
    .map(f => ({
      severity: SEVERITIES.has(String(f.severity || '').toLowerCase())
        ? String(f.severity).toLowerCase() : 'note',
      routine: f.routine != null ? String(f.routine) : null,
      finding: String(f.finding || f.issue || '').trim(),
      templateEvidence: f.templateEvidence != null ? String(f.templateEvidence) : null,
    }));
  const missingVsTemplate = (Array.isArray(raw.missingVsTemplate) ? raw.missingVsTemplate : [])
    .map(x => String(typeof x === 'object' && x !== null ? (x.finding || x.item || JSON.stringify(x)) : x).trim())
    .filter(Boolean);
  const rawVerdict = String(raw.verdict || '').toLowerCase();
  let verdict = rawVerdict === 'ship' ? 'ship' : rawVerdict === 'unsure' ? 'unsure' : 'fix';
  const standardsQuestions = (Array.isArray(raw.standardsQuestions) ? raw.standardsQuestions : [])
    .map(q => (typeof q === 'string' ? { topic: 'SDC standards', question: q } : q))
    .filter(q => q && String(q.question || '').trim())
    .map(q => {
      const question = String(q.question).trim();
      // Domain routes the surface (mechanical → spec sheet, controls →
      // leads' queue, jarvis → Dan). Model-supplied when valid, else the
      // rule-based classifier decides.
      const domain = resolveQuestionDomain(q.domain, question, String(q.topic || ''));
      return {
        topic: String(q.topic || 'SDC standards').trim(),
        question,
        // SOLUTIONS, NOT EXPLANATIONS (Dan, 2026-08-22): every question
        // carries Jarvis's best proposed answer. The prompt REQUIRES it;
        // null here means the model violated the contract — kept honest
        // (never fabricated) and visible to the reader.
        proposedSolution: String(q.proposedSolution || '').trim() || null,
        // Help is ONE lane with an addressee tag (ME or CE).
        addressee: resolveAddressee(q.addressee, domain),
        domain,
        // 'example-request' = ask-for-examples doctrine (Dan, 2026-08-23):
        // the UI renders these as blockers the team answers by uploading a
        // real example to POST /api/jarvis/examples.
        kind: resolveQuestionKind(q.kind),
      };
    });
  // Consistency guards:
  // - "ship" with blocker findings is a contradiction — blockers win (the
  //   whole point is nothing questionable goes external).
  // - "unsure" with blocker findings: the KNOWN violation dominates the
  //   unknown — verdict fix; the standardsQuestions still ride along.
  // - "unsure" with no question is not actionable — synthesize one from the
  //   summary so the controls team always gets something specific to answer.
  if ((verdict === 'ship' || verdict === 'unsure') && findings.some(f => f.severity === 'blocker')) verdict = 'fix';
  if (verdict === 'unsure' && !standardsQuestions.length) {
    standardsQuestions.push({
      topic: 'SDC standards',
      question: 'Internal review could not determine whether this build meets SDC standards: '
        + (String(raw.summary || '').trim() || 'no specifics were given — review the build against the standards manually.'),
      // Synthesized fallback — Jarvis genuinely has no proposal here (the
      // whole point is the reviewer couldn't decide). Honest null, never
      // a fabricated solution.
      proposedSolution: null,
      addressee: 'CE',
      domain: 'controls',
    });
  }
  return {
    verdict,
    findings,
    standardsQuestions,
    missingVsTemplate,
    summary: String(raw.summary || '').trim(),
  };
}

// ── Standards-question filing (jarvis-knowledge/questions.json) ─────────────

const QUESTIONS_FILE = path.join(ROOT, 'jarvis-knowledge', 'questions.json');

function readQuestions_() {
  try {
    const q = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
    return Array.isArray(q) ? q : [];
  } catch (_) { return []; }
}

/**
 * File the reviewer's standards questions into the Jarvis question queue.
 * One entry per question: context = the question's topic, source
 * 'internal review', attributed to the build (buildRef always; buildId when
 * the caller already has one — otherwise attach it later via
 * attachBuildIdToQuestions once recordBuild returns the id).
 * @returns {string[]} the filed question ids ([] on write failure)
 */
function fileStandardsQuestions(standardsQuestions, { buildRef = null, buildId = null } = {}) {
  const list = (standardsQuestions || []).filter(q => q && String(q.question || '').trim());
  if (!list.length) return [];
  try {
    const queue = readQuestions_();
    const ids = [];
    for (const q of list) {
      const id = 'q_ir_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const question = String(q.question).trim();
      const domain = resolveQuestionDomain(q.domain, question, String(q.topic || ''));
      queue.unshift({
        id,
        question,
        // Solutions, not explanations: the proposed answer rides with the
        // question everywhere it surfaces.
        proposedSolution: String(q.proposedSolution || '').trim() || null,
        addressee: resolveAddressee(q.addressee, domain),
        context: String(q.topic || 'SDC standards').trim(),
        source: 'internal review',
        buildRef: buildRef || null,
        buildId: buildId || null,
        domain,
        kind: resolveQuestionKind(q.kind),
        askedAt: new Date().toISOString(),
        status: 'open',
        priority: 1,
      });
      ids.push(id);
    }
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(queue, null, 2) + '\n', 'utf8');
    return ids;
  } catch (e) {
    console.warn('[internalReviewer] standards-question filing failed:', e.message);
    return [];
  }
}

/** Stamp a recorded build's id onto previously filed questions. */
function attachBuildIdToQuestions(questionIds, buildId) {
  if (!buildId || !Array.isArray(questionIds) || !questionIds.length) return false;
  try {
    const queue = readQuestions_();
    let changed = false;
    for (const q of queue) {
      if (questionIds.includes(q.id) && q.buildId !== buildId) { q.buildId = buildId; changed = true; }
    }
    if (changed) fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(queue, null, 2) + '\n', 'utf8');
    return changed;
  } catch (e) {
    console.warn('[internalReviewer] attachBuildIdToQuestions failed:', e.message);
    return false;
  }
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM = `${SUPREME_LAW}
For this review that law means: a violation of a KNOWN standard at ANY of those levels is a "blocker" finding and the verdict is "fix" (or "unsure"→held when the standard itself is unknown) — NEVER a style note, NEVER shipped with a flag riding along.

You are the senior SDC controls engineer reviewing a junior's program against THE SDC STANDARDS before it ships to the controls team.

THE CHECK — the one question this entire review answers (Dan's doctrine, verbatim intent): "Based on everything you know about SDC and the template files, does this code's breakdown and structure match SDC standards? Is this in line with SDC standards?" That is the check, always. Three honest answers:
- YES → verdict "ship".
- NO, it violates a standard you KNOW (the inventory, the template, the concepts, or learned knowledge shows the standard and the file breaks it) → verdict "fix" with findings.
- YOU DON'T KNOW — a structural choice where the pattern inventory + concepts + learned knowledge simply do not answer what the SDC standard is → verdict "unsure". Do NOT ship it, do NOT invent a fix, do NOT guess a standard into existence: ask. File specific standardsQuestions — each names the construct, what the file did, what the templates do/don't show, and exactly what the controls team must answer. Unsure is NOT fix: fix is for known violations, unsure is for unknown standards. The standards are everything you have learned — the concepts, the learned knowledge, the lead's teachings — with the template sets as the freshest, strongest evidence of them (but the template is a small sample of the standards, not their entirety; judge by the standards, use the template as the clearest reference at hand). Everything is built WITHIN the SDC standards; freedom exists only inside them. The team's culture is "one set of changes, fixed right" — anything a reviewing CE would flag costs the whole team credibility, so BE ADVERSARIAL. Mechanical validators already checked structure (state coverage, tag references, XML shape); your job is everything they cannot see.

JASON'S CORRECTIONS OF v1.4.0 (2026-08-31) — check these EVERY review, blockers all:
- ONE PROGRAM PER STATE MACHINE (CE bible §3): an approved multi-machine split emitted as one interleaved program is an architecture violation. Cross-machine signals are the handshake interface between separate programs.
- NO UNUSED DEVICES: the emitted device set must equal the sheet's device set exactly — any template-baggage device (tags, UDTs, axis blocks, NOP routines, "unused/delete at integration" comments) is a blocker.
- INITIALIZATION RE-ENTRY TARGETS: the init block (100–127) must re-enter the sequence at the CORRECT state per the approved initialization branches (carrying → the place-side state; empty → pick/start) — verify every init exit MOV's target against the branches; landing blindly at the first step is a blocker.
- INIT SCENARIO COVERAGE IS EXHAUSTIVE (Dan): enumerate the power-up state space the devices define (gripper engaged × part known/unknown where sensorless × slide positions × axis known/unknown) and verify EVERY combination reaches a defined init path. An uncovered combination (e.g. "not initialized AND gripper closed" on a sensorless gripper) is a blocker or an unsure-question — never silence.

Compare ROUTINE BY ROUTINE against the template: rung ordering, rung shapes, trigger/staging/alarm patterns, naming, completeness vs the template skeleton (missing init branches, dropped rungs), style drift. The junior's past failures — look hard for exactly this class:
- R02 sequence rungs out of ascending state-number order (spliced in flow order or appended at the end)
- invented per-state motion trigger latches (ONS trigger rungs, OTL/OTU move-trigger latches, sub-step counters) instead of the template's single state-list MAM rung per axis
- dropped init-block branches (e.g. init 106 carrying-part path missing)
- oversized rung descriptions / comments that drift from the template's terse style
- the wrong mnemonic family (EQU/NEQ/LES/GRT/GEQ/LEQ instead of the template's EQ/NE/LT/GT/GE/LE, or vice versa)
- separate speed-profile rungs instead of branches inside the one Auto Mode staging rung
- template boilerplate rungs altered or removed without the sequence requiring it

TEMPLATE-CONFORMANCE PASS (mandatory): you receive an AUTO-DERIVED TEMPLATE
PATTERN INVENTORY — structural invariants extracted from the template files
themselves. Check EVERY structural choice in the generated program against it:
one auto MAM per axis, one servo move per state (multi-segment strokes are
multiple states), staging-rung shape with defaults-first branches, the two
transition condition families, R02 ascending order, mnemonic family, init-block
graph. Any structure that diverges from the inventory WITHOUT a declared
extension (a "Template conformance" entry in the approved sequence, or a
"PROPOSED NON-STANDARD PATTERN:" rung comment) is a BLOCKER — silent invention
is exactly the defect class this pass exists to catch.
ARCHITECTURE-CONFORMANCE PASS (mandatory — added after the Magnet Dial incident,
Dan 2026-08-25: a concurrent station shipped as ONE interleaved state machine and
the review never looked above the rungs): before judging any rung, judge the
MACHINE ARCHITECTURE against the CE standard's Program Structure section:
- THE ASYNCHRONY TEST: "Asynchronous sequences should be separated into multiple
  programs. Each program must have no more than one state machine." If the
  station's sequences can overlap in time (a feeder re-arms while a head works,
  a dial indexes while heads act) and the program interleaves them in one state
  machine (one Step variable describing two mechanisms, or two state variables
  in one program), that is a BLOCKER — an architecture violation is a standards
  violation like any other, judged before rung style.
- Program naming: S{nn}_{Descriptive} on indexing machines (dial/indexer takes
  the S00_ slot per the template family), P{nn}_{Descriptive} for non-indexing
  processes.
- Inter-SM/cross-station handshakes are PARAMETERS (p_/i_/q_ program parameters
  or \\Program.p_ references — CONTROLS #23 and the Tag Structure section),
  never ad-hoc controller tags; every handshake must exist on BOTH sides
  (producer set/clear + consumer wait/transition).
- Cam-synchronized (chassis-archetype) stations legitimately have NO state
  machine — do not force the SM skeleton onto them, and do not accept an SM
  skeleton where the machine is cam-sequenced.
SANCTIONED EXTENSION (Dan, 2026-08-21 — NOT a finding): fast/slow speeds +
transition-point positions are the new SDC standard; the templates predate it.
Per-state AutoSpeed[i]/Accel[i]/Decel[i] selection as branches in the ONE
staging rung, and transition-point entries in Positions[], conform — do not
flag them as deviation. The structural invariants (one move per state, trigger
shape, staging shape, wideband form) still bind them.

Severity meanings:
- "blocker": a reviewing CE would bounce the file — wrong-shaped logic, missing template blocks, ordering violations, invented patterns, anything that behaves differently from the standard.
- "style": would draw a red pen but not a bounce — comment style drift, naming inconsistency, non-standard-but-functional expression.
- "note": worth knowing, no action required.

Verdict discipline: "ship" ONLY when there are zero blockers, no unanswered standards unknowns, and you would put your own name on the file. Any blocker means "fix" (a known violation dominates an unknown — file the standardsQuestions anyway). Zero blockers but a genuine standards unknown means "unsure", never "ship" and never a guessed "fix". Differences the approved sequence itself requires (renamed positions, station-specific states, retargeted conditions) are NOT findings — judge the expression, not the intent. APPROVED DEVIATIONS (the compiled spec's "APPROVED DEVIATIONS" block — ME-confirmed departures from a standard after the standard was stated once, e.g. single speed with no speed transitions, no blending) are NEVER findings: the deviation is the intent; flag only its EXPRESSION when the rungs implement it wrong.

QUESTION DISCIPLINE (the mechanical/controls boundary — Dan's law):
- GEOMETRY IS NEVER A STANDARDS QUESTION. Positions, heights, clearances,
  distances, transition-point values, strokes, home-vs-pick — those answers
  live in the MECHANICAL MODEL: they are asked of the ME at spec time or read
  from the spec's tables. If the spec/position tables already contain the
  value, the value IS the answer — a question about it is a defect. A filed
  geometry question here is always wrong; note a "*Verify" flag instead if a
  used value genuinely needs ME confirmation.
- YOU ARE THE CONTROLS ENGINEER (Dan, 2026-08-22 — there is no per-station CE
  review). Per-station controls choices are yours to DECIDE AND RECORD as
  findings/decisions, reviewable after the fact. File a standardsQuestion ONLY
  for a genuinely GENERAL "how does SDC want this done" unknown that the
  pattern inventory, concepts, and learned knowledge do not answer AND whose
  choice is consequential — and phrase it PROJECT-AGNOSTICALLY (the leads read
  a queue, not this station).
- Tag every standardsQuestion with its domain: "controls" for SDC-standards /
  code-form questions (the normal case), "jarvis" for tool/meta requests to
  Dan (exports, missing artifacts). Never "mechanical" — see above.
- SOLUTIONS, NOT EXPLANATIONS (Dan's law — how SDC works): every question you
  ask a human MUST come with YOUR proposed solution — your best answer, 1-3
  sentences, even if you're not sure it's right. The format is always: here's
  the situation, here's my proposed answer — do you like it or should I change
  it? A question with no proposedSolution is a contract violation. It doesn't
  have to be right; it has to be your honest best idea.
- ASK FOR EXAMPLES (Dan, 2026-08-23): when the file contains a mechanism,
  sequence, or device pattern that NO template, exemplar, or studied concept
  shows (a device family Jarvis has never seen SDC code for, a handshake with
  no SDC precedent), do NOT let invention ship silently — file a
  standardsQuestion with "kind":"example-request", phrased "I don't have a
  good SDC example for X — can you give me one?", with your best-guess
  approach as the proposedSolution. The team uploads a real example and Jarvis
  trains on it immediately. Use it only for genuinely example-less patterns —
  never for constructs the templates or concepts already answer.

Respond with ONLY a JSON object:
{"verdict":"ship"|"fix"|"unsure","findings":[{"severity":"blocker"|"style"|"note","routine":"R02_StateTransitions","finding":"...","templateEvidence":"the template rung/pattern that proves it"}],"standardsQuestions":[{"topic":"<short construct topic, e.g. 'Servo staging'>","question":"<the specific GENERAL SDC-standards question the leads must answer — project-agnostic phrasing>","proposedSolution":"<REQUIRED: your best answer, 1-3 sentences — 'here's my proposed solution — do you like it or should I change it?'>","domain":"controls"|"jarvis","kind":"question"|"example-request"}],"missingVsTemplate":["..."],"summary":"2-4 sentences, the way you'd tell the junior"}
standardsQuestions is REQUIRED (non-empty) when verdict is "unsure"; include it with any verdict when you hit an unknown worth asking. Every standardsQuestion REQUIRES its proposedSolution.`;

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Review one generated L5X against its matching template. ONE model call.
 *
 * @param {object} opts
 * @param {string} [opts.l5x]      the generated L5X content
 * @param {string} [opts.l5xPath]  path to it (used when l5x not given)
 * @param {object} opts.projectJson  the project the build came from
 * @param {string} opts.smId       state machine id (buildIR resolves it)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{verdict,findings,missingVsTemplate,summary,costUSD,model,durationS,at}>}
 */
async function reviewGenerated({
  l5x, l5xPath, projectJson, smId, signal, buildId = null, compiledIrOverride = null,
  // ── Speed levers (86-minute autopsy, 2026-08-25). All optional — omitting
  //    every one of them keeps the call byte-identical to the old behavior
  //    except for prompt caching (pure win) and the free mechanical pre-check.
  // previousL5x: the file as it stood BEFORE this fix round. When given
  //   (with priorFindings), the round is DELTA-SCOPED: the model reviews ONLY
  //   the changed rungs plus verification of the prior findings — never the
  //   whole file again. First round and the final ship verdict must NOT pass
  //   this (full review is the quality gate).
  // priorFindings: findings from the previous round, for the model to verify.
  // effort: override reasoning effort ('high' default; 'medium' recommended
  //   for delta rounds).
  // model: override the review model (intermediate fix rounds may run
  //   JARVIS_REVIEW_INTERMEDIATE_MODEL / sonnet-tier; the FINAL verdict
  //   always runs the default full model on the full file).
  // mechanicalFirst (default true): run the free mechanical validator before
  //   spending a model call — a file that fails validateL5X comes back as an
  //   instant 'fix' verdict with the mechanical findings, $0, ~0s.
  previousL5x = null, priorFindings = null, effort = null, model = null, mechanicalFirst = true,
} = {}) {
  if (!l5x && l5xPath) l5x = fs.readFileSync(l5xPath, 'utf8');
  if (!l5x) throw new Error('reviewGenerated needs l5x or l5xPath');
  if (!projectJson) throw new Error('reviewGenerated needs projectJson');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI review not configured — add ANTHROPIC_API_KEY to .env');

  const startedAt = Date.now();

  // FREE REJECTS FIRST: mechanical validation costs ~0s and $0 — never pay
  // for a model review of a file a validator already rejects.
  if (mechanicalFirst) {
    try {
      const { validateL5X } = require('./validator');
      const v = validateL5X(l5x);
      if (!v.ok) {
        return {
          verdict: 'fix',
          findings: v.errors.slice(0, 25).map(e => ({
            severity: 'blocker', routine: null,
            finding: String(e), templateEvidence: 'mechanical validator (validateL5X) — no model call spent',
          })),
          standardsQuestions: [], questionIds: [], heldStatus: null, missingVsTemplate: [],
          summary: `Mechanical validation failed with ${v.errors.length} error(s) — fix these before a model review round.`,
          mechanicalReject: true,
          template: null, model: 'mechanical', costUSD: 0,
          durationS: Math.round((Date.now() - startedAt) / 1000),
          at: new Date().toISOString(),
        };
      }
    } catch (e) { /* validator unavailable — fall through to the model */ }
  }

  const ir = buildIR(projectJson, smId);
  const sm = (projectJson.stateMachines || []).find(s => s.id === ir.smId);

  // The compiled IR summary — the approved sequence when one exists (that is
  // the contract the file was built to), else the diagram IR. When the writer
  // declared structural changes, the caller passes the PATCHED IR
  // (compiledIrOverride) so the reviewer judges against the updated contract
  // — declared divergence is legitimate, silent divergence is the defect.
  const compiledIr = compiledIrOverride
    || (sm && sm.compiledSequence && sm.compiledSequence.ir ? sm.compiledSequence.ir : null);
  const irText = (compiledIr && compiledIr.text) ? compiledIr.text : ir.text;

  const choice = selectTemplate(sm);
  const templateXml = fs.readFileSync(path.join(STANDARD_DIR, choice.template), 'utf8');
  const template = renderProgramRoutines(templateXml); // COMPLETE routines — the reviewer must see the reference
  const generated = renderProgramRoutines(l5x);        // routine bodies only — focused input

  const concepts = loadConcepts();
  const meKnowledge = loadMeKnowledge();

  // Stable prefix — identical for EVERY review round of the same station type
  // (concepts + learned knowledge + pattern inventory + the complete template).
  // This is by far the largest part of the input; cache it (1h TTL) so fix
  // rounds 2..N read it at 10% price and near-zero prefill latency instead of
  // re-processing it from scratch every round (the 86-minute autopsy's single
  // biggest per-round cost).
  const stableText = [
    ...(concepts ? ['# ENGINEERING CONCEPTS (how SDC thinks — the standard you are enforcing)', concepts, ''] : []),
    ...(meKnowledge ? ['# ME KNOWLEDGE (standing facts and learned corrections)', meKnowledge, ''] : []),
    renderPatternInventory(choice.template),
    '',
    `# THE STANDARD TEMPLATE — ${choice.template} (selected: ${choice.reason})`,
    'These are the template\'s routines COMPLETE. This is the reference the junior was',
    'supposed to perform surgery on — every idiom, every rung shape, every ordering here',
    'is the standard.',
    '',
    template.text,
  ].join('\n');

  // DELTA-SCOPED ROUND: when the caller passes the previous round's file and
  // findings, the model reviews ONLY (a) whether each prior finding is fixed
  // and (b) the changed rungs themselves — never the whole file again.
  // DETERMINISM RULE (Dan, 2026-08-25 — the speed architecture): the full
  // file travels exactly ONCE per build, in round 1. Every round after r1 is
  // delta-scoped — verify prior findings + changed rungs, nothing else. A
  // delta round with all priors cleared and 0 blockers on the changed rungs
  // means THE SHIP VERDICT STANDS — there is no fresh full-file pass at the
  // end, because a stochastic re-read of unchanged logic manufactures new
  // findings on code that already passed (a round with 0 blockers on
  // unchanged logic = ship stands).
  const deltaScoped = Boolean(previousL5x && Array.isArray(priorFindings));
  let jobText;
  if (deltaScoped) {
    // Lazy require — correctionLearner requires client.js; keep this module
    // free of any top-level path back to client.js (which lazy-requires us).
    const { diffL5X, formatDiffForModel } = require('./correctionLearner');
    const { changes, stats } = diffL5X(previousL5x, l5x);
    const diffText = formatDiffForModel(changes, { maxChanges: 60, maxRungChars: 900, maxTotalChars: 40000 })
      // formatDiffForModel speaks "YOURS/ENGINEER'S" (its home is correction
      // learning) — in a fix round the roles are before/after.
      .replace(/ENGINEER'S:/g, 'AFTER FIX:').replace(/ENGINEER'S COMMENT:/g, 'COMMENT AFTER FIX:')
      .replace(/YOURS:/g, 'BEFORE:').replace(/YOUR COMMENT:/g, 'COMMENT BEFORE:')
      .replace(/Rung the engineer ADDED/g, 'Rung ADDED by the fix').replace(/Rung the engineer REMOVED/g, 'Rung REMOVED by the fix')
      .replace(/Tag the engineer ADDED/g, 'Tag ADDED by the fix').replace(/Tag the engineer REMOVED/g, 'Tag REMOVED by the fix');
    jobText = [
      '# THE APPROVED SEQUENCE (what the program is supposed to implement)',
      irText,
      '',
      `# DELTA-SCOPED FIX-ROUND REVIEW — station "${ir.smName}"`,
      'You already reviewed this program in full and returned the findings below. The junior',
      'has now applied a fix. This round you review ONLY the delta — do NOT re-review the',
      'whole program (that already happened in round 1 and is settled: unchanged code that',
      'passed then has passed, period — re-opening it is forbidden).',
      '',
      '## Your prior findings (verify each: fixed, not fixed, or fixed wrong)',
      ...priorFindings.map((f, i) => `${i + 1}. [${f.severity || 'note'}] ${f.routine ? f.routine + ': ' : ''}${f.finding || String(f)}`),
      '',
      `## What changed since your review (${stats.changedRungs} changed, ${stats.addedRungs} added, ${stats.removedRungs} removed rung(s), ${stats.tagChanges} tag change(s))`,
      diffText,
      '',
      '# TASK',
      'Judge ONLY: (1) is each prior finding genuinely fixed (a finding not addressed, or',
      '"fixed" in a way that violates the standard, stays a finding); (2) do the changed',
      'rungs themselves introduce any NEW standards violation. Unchanged code is out of',
      'scope this round — a "finding" on an unchanged rung is a contract violation, not',
      'diligence. Respond with ONLY the JSON review object described in your',
      'instructions — findings list = everything still standing (unfixed priors + new',
      'issues in the delta); verdict "ship" here is FINAL for this build: all priors',
      'cleared + delta clean = the ship stands, no further full-file pass runs.',
    ].join('\n');
  } else {
    jobText = [
      '# THE APPROVED SEQUENCE (what the program is supposed to implement)',
      irText,
      '',
      `# THE JUNIOR'S GENERATED PROGRAM — station "${ir.smName}" (routine bodies)`,
      generated.text,
      '',
      '# TASK',
      'Review the generated program against the template, routine by routine. Respond with',
      'ONLY the JSON review object described in your instructions.',
    ].join('\n');
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const reviewModel = model || MODEL;
  const req = {
    model: reviewModel,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive', display: 'summarized' },
    // Full reviews earn full reasoning depth — the last gate before a file
    // goes external. Delta rounds default to medium (the caller may override
    // either way).
    output_config: { effort: effort || (deltaScoped ? 'medium' : 'high') },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: stableText, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: jobText },
      ],
    }],
  };
  if (/^claude-(fable|opus)-/.test(reviewModel)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused the review: ' + (response.stop_details?.explanation || 'no explanation'));
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const raw = extractReviewJson(text);
  if (!raw || !raw.verdict) {
    throw new Error('Internal review returned no parseable verdict'
      + (response.stop_reason === 'max_tokens' ? ' (response truncated)' : ''));
  }

  const costUSD = response.usage ? Number(costOfUsage(response.usage, reviewModel).toFixed(4)) : null;
  const review = normalizeReview(raw);

  // 'unsure' = HELD: file the standards questions for the controls team and
  // carry a user-facing hold status. Never ship, never guess a fix.
  let questionIds = [];
  let heldStatus = null;
  if (review.verdict === 'unsure') {
    const buildRef = `${projectJson.name || '(project)'} / ${ir.smName}`;
    questionIds = fileStandardsQuestions(review.standardsQuestions, { buildRef, buildId });
    const n = review.standardsQuestions.length;
    heldStatus = `held — ${n} standards question${n === 1 ? '' : 's'} filed for the controls team`;
  }

  return {
    ...review,
    questionIds,
    heldStatus,
    template: choice.template,
    scope: deltaScoped ? 'delta' : 'full',
    model: response.model || reviewModel,
    costUSD,
    durationS: Math.round((Date.now() - startedAt) / 1000),
    at: new Date().toISOString(),
  };
}

module.exports = {
  reviewGenerated, renderProgramRoutines, normalizeReview, extractReviewJson,
  fileStandardsQuestions, attachBuildIdToQuestions, INTERMEDIATE_MODEL,
};
