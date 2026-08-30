/**
 * client.js — Anthropic API client + JARVIS surgical generation loop.
 *
 * v1.0.2: continuation support — a plan that parses cleanly and ends with
 * "toBeContinued": true is a deliberate split; the loop requests the remainder
 * (up to MAX_CONTINUATIONS extra calls within the same attempt) and
 * concatenates the operations arrays before merging.
 *
 * FIRST-PASS DOCTRINE (Dan, 2026-08-25 — his sequence verbatim): "Look at the
 * request. Use SDC standards. Look at the references they gave you. Ask the
 * engineers any questions BEFORE writing. Write the code based on SDC
 * standards. Maybe one review at the end. You don't get eight revisions — you
 * get one." Pipeline order is now: PRE-WRITE STUDY (preWriteStudy.js — full
 * exemplar + reference lessons + build rulings assembled into context) →
 * READINESS PASS (one cheap fast-model call; real gaps HOLD the build before
 * any write) → WRITE ONCE (the translation call, reframed: final file, no
 * revision loop) → ONE review (internalReviewer). The fix loop below remains
 * as a SAFETY NET only; every fix round auto-files tuition lessons
 * (formulateTuition → correctionLearner) so rounds trend to zero. THE METRIC:
 * result.firstPassShip + result.roundsToShip, recorded per build and
 * aggregated by GET /api/jarvis/trackrecord (first-pass ship rate).
 * Gates: JARVIS_PREWRITE_STUDY, JARVIS_READINESS, JARVIS_TUITION (default on).
 *
 * generateL5X(projectJson, smId, options):
 *   promptBuilder (edit-plan prompt, cached stable prefix)
 *     -> Claude (JARVIS_MODEL, default claude-opus-5) authors a JSON edit plan
 *     -> editPlanSchema.validatePlan
 *     -> mergeEngine.applyEditPlan (deterministic template surgery)
 *     -> validator.validateL5X + validator.validateAgainstDiagram
 *   Failures at any stage (bad JSON, schema errors, merge assertion failures,
 *   validation errors) are fed back to the model for a revised plan, up to
 *   JARVIS_MAX_ATTEMPTS total model calls.
 *   LOOP LIMIT → HOLD-FOR-HELP (Dan's escalation model, Aug 2026): a
 *   validation finding that survives JARVIS_FINDING_ROUND_LIMIT (default 4)
 *   consecutive fix rounds — or JARVIS_MAX_FIX_ROUNDS (default 8) total
 *   rounds — stops the loop: Jarvis formulates question(s) WITH proposed
 *   solution(s) (result.held.questions) plus resume state (result.held.resume);
 *   the server persists the build as held and resumes it later via
 *   options.resume once a human answers.
 *   STRUCTURAL-DELTA HIGHLIGHT: in translation mode the plan may declare
 *   deliberate deviations from the approved compiled IR
 *   (plan.structuralChanges with irPatch ops); validation runs against the
 *   PATCHED contract and the caller persists result.patchedCompiledIr back
 *   onto sm.compiledSequence — never silent divergence. Each change rides as
 *   { text, approved:false } for a quick human approve.
 *   WRITING NOTES: result.writingNotes = [{ text }] — the right-amount notes
 *   of what came up while writing (no quota, never filler).
 *   LAST STAGE (validation passed): the PRE-DELIVERY INTERNAL REVIEW
 *   (internalReviewer.js) — Jarvis adversarially reviews the finished file
 *   against the template like the senior CE would; result rides on
 *   result.internalReview ({verdict:'ship'|'fix'|'unsure', findings, ...}).
 *   A 'fix' verdict never auto-loops regeneration — a human decides. An
 *   'unsure' verdict HOLDS the build and files standards questions to the
 *   controls team (unknown standard ≠ known violation).
 *   Gate: JARVIS_INTERNAL_REVIEW=on|off (default on).
 *
 * Configuration (.env, all optional). Quality is the constraint, not cost —
 * caps exist for visibility and runaway protection only:
 *   JARVIS_MODEL              default claude-opus-5 ($5/$25 per M).
 *                             claude-fable-5 ($10/$50) is the QUALITY
 *                             ESCALATION PATH for hard stations — use it
 *                             freely; claude-sonnet-5 ($3/$15) for cheap runs.
 *   JARVIS_MAX_OUTPUT_TOKENS  default 64000 (an edit plan is 5-15K tokens but
 *                             machineSpec-driven stations produced 30K+ plans;
 *                             headroom is deliberate — never starve the plan.
 *                             SDK streaming is already used, so no timeout risk)
 *   JARVIS_MAX_ATTEMPTS       default 5 (total plan attempts incl. repairs;
 *                             continuation calls within an attempt don't count)
 *   JARVIS_MAX_COST_USD       default 20 (sanity ceiling, not a budget)
 *
 * Every result carries meta.costEstimate computed from the actual usage
 * numbers and the model's per-M pricing (cache reads at 10% of the input
 * rate, cache writes at 125%).
 *
 * Reads ANTHROPIC_API_KEY from process.env / repo-root .env (dotenv).
 * CommonJS, plain Node — required lazily by server.js.
 */

const fs = require('fs');
const path = require('path');

// Load repo-root .env (server.js uses only Node built-ins and doesn't).
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { buildGenerationPrompt } = require('./promptBuilder');
const { createCodegenSession } = require('./codegenSdk');
const { validateL5X, validateAgainstDiagram, validateAgainstCompiledIR, formatReport } = require('./validator');
const { validatePlan } = require('./editPlanSchema');
const { applyEditPlan, MergeError } = require('./mergeEngine');
const { JARVIS_VERSION, currentEntry } = require('./jarvisVersion');

// $ per 1M tokens: [input, output]. Cache read = 10% of input rate,
// cache write = 125% of input rate.
const PRICING = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
const MAX_TOKENS = parseInt(process.env.JARVIS_MAX_OUTPUT_TOKENS, 10) || 64000;
const MAX_ATTEMPTS = parseInt(process.env.JARVIS_MAX_ATTEMPTS, 10) || 5;
// Max continuation calls per attempt for plans split with "toBeContinued".
const MAX_CONTINUATIONS = 4;
// Sanity ceiling only — cost is reported, not optimized for. Quality wins.
const MAX_COST_USD = parseFloat(process.env.JARVIS_MAX_COST_USD) || 20;

// ── LOOP LIMIT → HOLD-FOR-HELP (Dan's escalation model, Aug 2026) ────────────
// The fix-and-re-validate loop never grinds forever (the v4 build burned 12
// rounds on one junction). Two configurable budgets:
//   FINDING_ROUND_LIMIT — a validation finding that survives this many
//     consecutive fix rounds means Jarvis genuinely can't clear it: STOP
//     generating, ask a human (with a proposed solution), hold the build.
//   HARD_ROUND_CAP — absolute ceiling on total fix rounds regardless of
//     which findings persist (only bites when JARVIS_MAX_ATTEMPTS is raised
//     above it).
const FINDING_ROUND_LIMIT = parseInt(process.env.JARVIS_FINDING_ROUND_LIMIT, 10) || 4;
const HARD_ROUND_CAP = parseInt(process.env.JARVIS_MAX_FIX_ROUNDS, 10) || 8;

/** Thrown when no ANTHROPIC_API_KEY is configured. Endpoint maps it to 503. */
class AiNotConfiguredError extends Error {
  constructor() {
    super('AI generation not configured — add ANTHROPIC_API_KEY to .env');
    this.name = 'AiNotConfiguredError';
    this.code = 'AI_NOT_CONFIGURED';
  }
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client = null;
function getClient() {
  if (!isConfigured()) throw new AiNotConfiguredError();
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env
  }
  return _client;
}

/** Pull the JSON edit plan out of a model response (tolerates fences/prose). */
function extractPlanJson(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return { plan: null, error: 'Response contained no JSON object' };
  }
  const slice = t.slice(start, end + 1);
  try {
    return { plan: JSON.parse(slice), error: null };
  } catch (e) {
    // Repair invalid JSON escapes from quoted rung text (\Tracking.p_Data… —
    // raw L5X backslash paths). A plan that quotes such a rung in a "match"
    // string is otherwise perfect JSON; don't burn a repair round on it.
    try { return { plan: JSON.parse(slice.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')), error: null }; }
    catch (_) { return { plan: null, error: `JSON parse failed: ${e.message}` }; }
  }
}

/** Collect the engineer-action comments (*Replace ...) out of the generated L5X. */
function extractReviewNotes(l5x) {
  const notes = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(l5x)) !== null) {
    for (const line of m[1].split('\n')) {
      const s = line.trim();
      if (s.startsWith('*Replace') || s.startsWith('*Verify')) notes.push(s);
    }
  }
  return [...new Set(notes)];
}

function costOfUsage(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-opus-5'];
  const input = (usage.input_tokens || 0) * inRate;
  const cacheRead = (usage.cache_read_input_tokens || 0) * inRate * 0.10;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * inRate * 2.0; // 1h-TTL writes bill at 2x input rate
  const output = (usage.output_tokens || 0) * outRate;
  return (input + cacheRead + cacheWrite + output) / 1e6;
}

// ── Fix rounds are TUITION (Dan's first-pass doctrine) ───────────────────────

/**
 * One cheap model call after a build that needed fix rounds: with the whole
 * failed-and-repaired conversation in context, ask "what should the PRE-WRITE
 * STUDY have caught so the first plan was already right?" Lessons are filed
 * through correctionLearner (>=0.7 confidence → concept docs; lower →
 * returned for the writing notes). Rounds become tuition, trending to zero.
 * Never throws for model trouble — tuition failure never fails a build.
 */
async function formulateTuition(client, system, messages, { rootCauses, smName, projectName, signal }) {
  const causes = [...(rootCauses || new Map()).entries()]
    .map(([cause, n]) => `- (${n} round${n === 1 ? '' : 's'}) ${cause}`);
  const ask = [
    'THE BUILD IS DONE — this is a learning pass, not another edit plan.',
    'This build needed fix round(s) that the first-pass doctrine says should not exist.',
    'The distinct root causes were:',
    ...causes,
    '',
    'For each root cause: what should the PRE-WRITE STUDY have caught — what concept,',
    'exemplar detail, or plan ambiguity, understood BEFORE writing, would have made the',
    'first plan already correct? Transferable concepts only (a lesson must apply to',
    'future stations, never a restatement of this one edit). No padding — only lessons',
    'the rounds actually support.',
    '',
    'Respond with ONLY a JSON object:',
    '{"lessons":[{"lesson":"...","conceptArea":"servo-motion|vision-systems|pneumatics|coordination|recovery|alarms|general","confidence":0.0-1.0}]}',
  ].join('\n');
  try {
    const r = await callModel(client, system, [...messages, { role: 'user', content: ask }],
      { signal, effort: 'low' });
    const { plan: parsed } = extractPlanJson(r.text);
    const costUSD = r.usage ? Number(costOfUsage(r.usage, MODEL).toFixed(4)) : 0;
    const lessons = (parsed && Array.isArray(parsed.lessons) ? parsed.lessons : [])
      .filter(l => l && String(l.lesson || '').trim())
      .map(l => ({
        lesson: String(l.lesson).replace(/\s+/g, ' ').trim(),
        conceptArea: String(l.conceptArea || 'general'),
        confidence: Math.max(0, Math.min(1, Number(l.confidence) || 0)),
      }));
    // File through correctionLearner (lazy require — it requires this module).
    let applied = [];
    let queued = [];
    if (lessons.length) {
      const { applyLessons } = require('./correctionLearner');
      const res = applyLessons({
        lessons,
        reviewer: 'the fix loop (tuition)',
        buildId: `${projectName || '?'} / ${smName}`,
        buildLabel: `${projectName || '?'} / ${smName}`,
        addQuestion: null, // low-confidence lessons ride in writing notes instead
        marker: '[tuition]',
      });
      applied = res.applied;
      queued = res.queued.map(l => l.lesson);
    }
    return { lessons, applied, queued, costUSD };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) throw e;
    return { lessons: [], applied: [], queued: [], costUSD: 0, error: e.message || String(e) };
  }
}

// ── Hold-for-help question formulation ───────────────────────────────────────

/**
 * Deterministic fallback when the help-formulation model call fails: one
 * question per persistent finding, derived from context and marked derived.
 * proposedSolution stays honestly null — Jarvis had no better idea (that is
 * exactly why the build is holding).
 */
function fallbackHelpQuestions(persistentFindings, rounds, smName) {
  return (persistentFindings || []).slice(0, 6).map(f => ({
    question: `Generation of ${smName} is held: this finding survived ${rounds} fix round(s) and Jarvis could not clear it — "${String(f).slice(0, 300)}". How should it be resolved?`,
    proposedSolution: null,
    addressee: 'CE',
    domain: 'controls',
    derived: true,
  }));
}

/**
 * ONE extra model call on the (rare) escalation path: the model has the whole
 * failed conversation in context — ask it to state, for a human, what it is
 * stuck on and its best proposed solution (solutions, not explanations).
 * Falls back to fallbackHelpQuestions() on any failure.
 */
async function formulateHelpQuestions(client, system, messages, { persistentFindings, rounds, smName, signal }) {
  const { resolveQuestionDomain, resolveAddressee } = require('./questionRouter');
  const ask = [
    'STOP — the fix loop is being escalated to a human (hold-for-help).',
    `These validation finding(s) survived ${rounds} fix round(s) and your plans could not clear them:`,
    ...persistentFindings.map(f => `- ${f}`),
    '',
    'Do NOT send another edit plan. Instead, formulate the question(s) a human must answer',
    'before generation can resume. SDC culture (Dan): every question comes with YOUR',
    'proposed solution — "here\'s the situation, here\'s my proposed answer, do you like it',
    'or should I change it?" 1-3 sentences each; it doesn\'t have to be right, it has to be',
    'your honest best idea. One question per genuinely distinct unknown — no padding.',
    'Addressee: "ME" when the answer lives in the mechanical model / station intent,',
    '"CE" when it is an SDC-standards / code-form ruling.',
    '',
    'HOLD DISCIPLINE — the self-answer test applies HERE too: for each finding, first',
    'ask yourself "can I derive the answer from the sheet, the geometry, or SDC',
    'standards?" If YES, do NOT file a question — decide it and return it under',
    '"decisions" (recorded for after-the-fact review); the build resumes on it.',
    'Hold ONLY what genuinely fails that test.',
    'STATEMENTS ARE NOT QUESTIONS (Dan): every held item MUST be an actual question a',
    'human can answer — interrogative, ending in "?", with your proposed answer.',
    'A finding restated as a sentence is not an ask.',
    '',
    'Respond with ONLY a JSON object:',
    '{"questions":[{"question":"...?","proposedSolution":"<REQUIRED — your best answer>","addressee":"ME"|"CE","domain":"mechanical"|"controls"|"jarvis"}],"decisions":["<derivable finding you decided, and how>"]}',
  ].join('\n');
  try {
    const r = await callModel(client, system, [...messages, { role: 'user', content: ask }],
      { signal, effort: 'medium' });
    const { plan: parsed } = extractPlanJson(r.text);
    const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : null;
    // HOLD DISCIPLINE (Dan, Aug 24): derivable findings come back as decisions
    // — recorded, never asked. And statements are not questions: any returned
    // item that isn't an actual question is demoted to a decision note (the
    // UI renders those as notes, never as blocking asks).
    const decisions = (parsed && Array.isArray(parsed.decisions) ? parsed.decisions : [])
      .map(d => String(d || '').trim()).filter(Boolean);
    const isRealQuestion = (s) => /\?/.test(s) ||
      /^(what|which|where|when|who|how|why|should|shall|can|could|do|does|did|is|are|will|would|may|might)\b/i.test(s);
    if ((!list || !list.length) && !decisions.length) throw new Error('no questions in response');
    const questions = (list ?? [])
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
      });
    const realQuestions = questions.filter(q => isRealQuestion(q.question));
    for (const q of questions) {
      if (!isRealQuestion(q.question)) {
        decisions.push(`Filed as a statement, kept as a note (statements are not questions): ${q.question}` +
          (q.proposedSolution ? ` — Jarvis's take: ${q.proposedSolution}` : ''));
      }
    }
    if (!realQuestions.length && !decisions.length) throw new Error('no usable questions in response');
    const costUSD = r.usage ? costOfUsage(r.usage, MODEL) : 0;
    return { questions: realQuestions, decisions, costUSD };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) throw e;
    return { questions: fallbackHelpQuestions(persistentFindings, rounds, smName), costUSD: 0, formulationError: e.message || String(e) };
  }
}

/**
 * Persistent-finding tracker for the escalation budget. Pure — unit-tested.
 * `counts` maps finding text -> consecutive validate-round survivals; each
 * validate-stage failure calls track() with the round's error list.
 * @returns {{ persistent: string[] }} findings at/over the round limit
 */
function trackPersistentFindings(counts, errors, limit = FINDING_ROUND_LIMIT) {
  const current = new Set(errors || []);
  for (const k of [...counts.keys()]) if (!current.has(k)) counts.delete(k);
  for (const e of current) counts.set(e, (counts.get(e) || 0) + 1);
  return { persistent: [...counts.entries()].filter(([, n]) => n >= limit).map(([e]) => e) };
}

/** One model call. Streaming; adaptive thinking with SUMMARIZED display —
 *  on Fable/Opus-5-class models display defaults to "omitted", which streams
 *  thinking_delta events with EMPTY text: the ring froze for minutes during
 *  the reasoning phase with nothing to advance on. display:'summarized'
 *  streams readable summary text (billing unchanged) so the UI can show
 *  Jarvis literally thinking.
 *  Server-side refusal fallback enabled for fable/opus models.
 *  onText(textChars) fires as REAL output text streams in;
 *  onThinking(deltaText, totalThinkingChars) fires on each thinking summary
 *  delta; signal (AbortSignal) aborts the SDK stream mid-flight. */
async function callModel(client, system, messages, { onText, onThinking, signal, effort } = {}) {
  const req = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive', display: 'summarized' },
    system,
    messages,
  };
  // Translation mode (JARVIS v1.1): the thinking already happened at Build
  // time — run the near-mechanical translation at reduced effort. Omitted
  // (undefined) keeps the request byte-identical to the v1.0.x pipeline.
  if (effort) req.output_config = { effort };
  if (/^claude-(fable|opus)-/.test(MODEL)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  if (onText || onThinking) {
    let chars = 0;
    let thinkingChars = 0;
    stream.on('text', (delta) => {
      chars += delta.length;
      if (onText) { try { onText(chars) } catch (_) {} }
    });
    // Thinking summaries stream as thinking_delta events (readable text with
    // display:'summarized'); surface them so the progress UI stays alive
    // through the minutes-long reasoning phase.
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
        const t = event.delta.thinking || '';
        thinkingChars += t.length;
        if (onThinking) { try { onThinking(t, thinkingChars) } catch (_) {} }
      }
    });
  }
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    const why = response.stop_details?.explanation || 'model declined the request';
    throw new Error(`Model refused generation: ${why}`);
  }
  const truncated = response.stop_reason === 'max_tokens';
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return { text, usage: response.usage, model: response.model, truncated };
}

/**
 * Run the full surgical generation pipeline for one state machine.
 *
 * @returns {Promise<{ ok, l5x, validation, editPlan, reviewNotes, meta }>}
 * @throws {AiNotConfiguredError} when ANTHROPIC_API_KEY is not set
 */
async function generateL5X(projectJson, smId, options = {}) {
  const client = getClient(); // throws AiNotConfiguredError before any work

  // Live-progress plumbing (optional). onProgress(pct, stage, detail) is
  // called with monotonically increasing pct 0-100; signal (AbortSignal)
  // aborts the in-flight SDK stream when the caller cancels.
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const abortSignal = options.signal || null;
  // Expected output size for the writing progress ramp (45% -> 70%).
  // An edit plan is typically 5-15K tokens; ~20K keeps the bar honest.
  const EXPECTED_OUTPUT_TOKENS = 20000;
  // Expected thinking depth for the reasoning ramp (15% -> 45%). Build
  // history doesn't record thinking tokens yet, so this is a static budget;
  // if reasoning runs past it the ring HOLDS at the band top — it never
  // fakes progress and never steps backward.
  const EXPECTED_THINKING_TOKENS = 15000;

  const { system, stableText, jobText, ir, compiledIr, meta } = buildGenerationPrompt(projectJson, smId, options);
  const smObj = (projectJson.stateMachines || []).find(s => s.id === ir.smId) || null;
  // Translation mode (JARVIS v1.1 pipeline inversion): an APPROVED compiled
  // sequence exists — the thinking happened at Build time; generation is
  // near-mechanical translation at effort 'medium' (expect ~1-2 min instead
  // of the multi-minute authoring reasoning phase). Authoring mode passes
  // effort undefined -> request unchanged from v1.0.x.
  const mode = meta.mode || 'authoring';
  // Phase 3: the SDK writer session runs at its default effort — the
  // translation-mode 'medium' effort knob does not apply to it.
  const modelEffort = undefined;
  onProgress(8, 'ir', mode === 'translation'
    ? 'Approved compiled sequence loaded (translation mode)'
    : 'Intermediate representation built');
  const templateXml = fs.readFileSync(meta.templatePath, 'utf8');
  const stamp = `Generated by JARVIS v${JARVIS_VERSION} (${currentEntry().date}) - SDC State Logic Builder`;
  // Full state map — injected deterministically by the merge engine as the
  // first R02 rung comment (Jason's-review fix: the map travels inside the
  // routine, immune to Studio 5000 tag-comment collisions on import). Source:
  // the same IR the validation contract uses (compiled IR in translation mode).
  const mapSource = (mode === 'translation' && compiledIr && Array.isArray(compiledIr.states))
    ? compiledIr.states : ir.states;
  const stateMap = 'STATE MAP (generated - authoritative): ' + mapSource
    .filter(s => Number.isInteger(s.stateNumber))
    .sort((a, b) => a.stateNumber - b.stateNumber)
    .map(s => `${s.stateNumber}=${String(s.label || '').replace(/\s+/g, ' ').trim() || '(unnamed)'}`)
    .join(' | ');

  // ── PRE-WRITE STUDY PHASE (Dan's first-pass doctrine, 2026-08-25) ──────────
  // Before the write: assemble the full working context deliberately — the
  // COMPLETE closest engineer-corrected exemplar, the studied reference
  // material's lessons, and the build's decisions/rulings (preWriteStudy.js).
  // The full-exemplar context costs more per write — that is the right trade
  // vs eight review rounds. Gate: JARVIS_PREWRITE_STUDY=on|off (default on).
  let study = null;
  const studyEnabled = String(process.env.JARVIS_PREWRITE_STUDY || 'on').toLowerCase() !== 'off';
  if (studyEnabled) {
    try {
      const { assembleStudyContext } = require('./preWriteStudy');
      study = assembleStudyContext({ projectJson, sm: smObj, templateName: meta.template });
      if (study.text) {
        onProgress(10, 'study', `Pre-write study: exemplar ${study.exemplar ? `${study.exemplar.name} (${study.exemplar.kind}${study.exemplar.complete ? ', complete' : ''})` : 'none found'}, ${Math.round(study.sizes.totalChars / 4).toLocaleString()} tokens of context`);
      }
    } catch (e) {
      study = null;
      onProgress(10, 'study', 'Pre-write study unavailable (build proceeds): ' + (e.message || e));
    }
  }

  // WRITE ONCE (Dan, verbatim intent): "You don't get eight revisions — you
  // get one." The translation call is reframed as writing the final file.
  const WRITE_ONCE = [
    '',
    '# WRITE ONCE (Dan\'s doctrine)',
    'You are writing the FINAL file. There is no revision loop: a senior engineer',
    'reviews this file ONCE at the end, and it ships on that review. Everything you',
    'need is already in context — the approved plan, the SDC standards and concepts,',
    'the complete engineer-corrected exemplar, and this build\'s recorded decisions.',
    'Any question worth asking was asked before this call. Get every rung right in',
    'this single plan: shapes from the exemplar/template, logic from the approved',
    'sequence, nothing invented, nothing deferred to a fix round.',
  ].join('\n');

  const jobPieces = [jobText + WRITE_ONCE];

  // Cache layout: stable per-template content carries a breakpoint; the study
  // context (stable per station) carries its own; the per-job IR comes after,
  // so repeat runs and repair rounds reuse both cached prefixes.
  const messages = [{
    role: 'user',
    content: [
      // 1h TTL: attempts routinely run >5 minutes (adaptive thinking + long
      // plans), so the default 5m cache expired between repair rounds
      // (observed cacheRead=0 on every v1.0.1 benchmark attempt).
      { type: 'text', text: stableText, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ...(study && study.text
        ? [{ type: 'text', text: study.text, cache_control: { type: 'ephemeral', ttl: '1h' } }]
        : []),
      { type: 'text', text: jobPieces.join('\n') },
    ],
  }];

  // ── RESUME AFTER HOLD-FOR-HELP (Dan's escalation model) ────────────────────
  // options.resume = { lastEditPlan, persistentFindings, attemptCount,
  //                    answers: [{ question, proposedSolution, answer, answeredBy }] }
  // The cheapest faithful resume representation (documented decision): the
  // conversation's stable prefix is DETERMINISTIC (rebuilt above from the
  // project + template, and served from the prompt cache when warm), so the
  // only session-unique state worth persisting is the last edit plan, the
  // findings that forced the hold, and the human answers. We re-seed the
  // conversation with the prior plan as an assistant turn + one feedback turn
  // carrying findings and answers, then re-enter the normal fix loop.
  if (options.resume && options.resume.lastEditPlan) {
    const r = options.resume;
    messages.push({ role: 'assistant', content: JSON.stringify(r.lastEditPlan) });
    messages.push({
      role: 'user',
      content: [
        '# RESUME AFTER HOLD-FOR-HELP',
        'Your previous edit plan (above) is where generation stopped. These validation',
        `finding(s) had survived ${r.attemptCount ?? 'several'} fix round(s) and the build was held:`,
        ...(r.persistentFindings || []).map(f => `- ${f}`),
        '',
        'You asked for help; the humans answered:',
        ...(r.answers || []).flatMap(a => [
          `Q: ${a.question}`,
          `Jarvis proposed: ${a.proposedSolution || '(no proposal)'}`,
          `A (${a.answeredBy || 'human'}): ${a.answer}`,
          '',
        ]),
        'Fold these answers into the plan — they are authoritative. Respond with ONLY the',
        'corrected complete JSON edit plan.',
      ].join('\n'),
    });
    onProgress(12, 'resume', `Resuming held build with ${(r.answers || []).length} human answer(s) in context`);
  } else if (options.resume && Array.isArray(options.resume.answers) && options.resume.answers.length) {
    // READINESS HOLD RESUME (held BEFORE any write — no edit plan exists yet):
    // fold the human answers into the job text as authoritative context and
    // proceed straight to the write-once call.
    const block = [
      '',
      '# PRE-WRITE QUESTIONS — ANSWERED (authoritative)',
      'The build was held before writing; the humans answered. These answers are law:',
      ...options.resume.answers.flatMap(a => [
        `Q: ${a.question}`,
        `Jarvis proposed: ${a.proposedSolution || '(no proposal)'}`,
        `A (${a.answeredBy || 'human'}): ${a.answer}`,
        '',
      ]),
    ].join('\n');
    const last = messages[0].content[messages[0].content.length - 1];
    last.text += block;
    onProgress(12, 'resume', `Resuming pre-write hold with ${options.resume.answers.length} human answer(s) folded in`);
  }

  // ── READINESS PASS (ask BEFORE writing — Dan: "Ask the engineers any
  // questions BEFORE writing") ────────────────────────────────────────────────
  // One cheap fast-model call: anything unresolved/ambiguous/missing that
  // would cause a defect? Real items → the build HOLDS here, before a single
  // write token is spent; questions (with proposed solutions) go through the
  // existing hold-for-help channel. Empty list → write. Skipped on resume
  // (the answers are already in context). Gate: JARVIS_READINESS=on|off
  // (default on; requires the study phase).
  let readiness = null;
  const readinessEnabled = studyEnabled &&
    String(process.env.JARVIS_READINESS || 'on').toLowerCase() !== 'off';
  if (readinessEnabled && !options.resume) {
    onProgress(13, 'readiness', 'Readiness pass — anything unresolved that would cause a defect?');
    const { readinessCheck } = require('./preWriteStudy');
    readiness = await readinessCheck({
      planText: jobText,
      studyText: (study && study.text) || '',
      signal: abortSignal,
    });
    if (readiness.error) {
      onProgress(14, 'readiness', 'Readiness check unavailable (build proceeds): ' + readiness.error);
    } else if (!readiness.ready) {
      // HELD BEFORE WRITING — the cheapest possible hold: $0 of write tokens.
      onProgress(92.5, 'held',
        `Held before writing: ${readiness.questions.length} pre-write question(s) — asked now, never discovered mid-write`);
      const held = {
        reason: `pre-write readiness found ${readiness.questions.length} unresolved item(s) — held before any write`,
        rounds: 0,
        persistentFindings: [],
        questions: readiness.questions,
        resume: {
          version: 1,
          stage: 'readiness',
          smId: ir.smId,
          smName: ir.smName,
          mode,
          template: meta.template,
          attemptCount: 0,
          lastEditPlan: null,
          lastL5xDraft: null,
          persistentFindings: [],
          validationReport: '(held before writing — no draft exists yet)',
        },
      };
      return {
        ok: false,
        l5x: null,
        internalReview: null,
        validation: {
          ok: false,
          errors: [`Held before writing: ${held.reason}`],
          warnings: [],
        },
        editPlan: null,
        held,
        structuralChanges: null,
        patchedCompiledIr: null,
        writingNotes: [{ text: `Held before writing — readiness pass filed ${readiness.questions.length} question(s) (write cost $0).` }],
        reviewNotes: [],
        ir,
        firstPassShip: null,
        roundsToShip: null,
        meta: {
          ...meta,
          mode,
          modelEffort: 'sdk-session', engine: 'claude-agent-sdk',
          model: MODEL,
          jarvisVersion: JARVIS_VERSION,
          attempts: [],
          repairRounds: 0,
          study: study ? { exemplar: study.exemplar, sizes: study.sizes } : null,
          readiness: { ran: true, ready: false, model: readiness.model, costUSD: readiness.costUSD },
          costEstimate: {
            totalUSD: Number((readiness.costUSD || 0).toFixed(4)),
            model: readiness.model,
            note: 'held before writing — readiness pass only',
          },
        },
      };
    } else {
      onProgress(14, 'readiness', '✓ Readiness: nothing unresolved — writing the final file');
    }
  }

  onProgress(15, 'prompt', `Prompt assembled (template: ${meta.template || 'selected'})`);

  // ── PHASE 3 (Dan, 2026-08-30): THE WRITER IS THE SDK ENGINE ────────────────
  // "on the same version you are, with access to the folder with all our
  // samples and standards": one read-only SDK session per build (Read/Grep/
  // Glob over plc-reference, verified exemplars, concepts, shipped code).
  // Repair rounds resume the SAME session. Everything around the transport —
  // parse, schema, merge, validator gates, holds, review — is unchanged.
  const progressRef = { pct: 16, stage: 'model' };
  const writer = createCodegenSession({
    systemText: system,
    signal: abortSignal,
    onActivity: (label) => onProgress(progressRef.pct, progressRef.stage, '· ' + label),
  });
  let writerStarted = false;
  const contentToText = (c) => (typeof c === 'string' ? c
    : Array.isArray(c) ? c.map((b) => b?.text ?? '').join('\n') : String(c ?? ''));
  // First call carries the whole assembled conversation (incl. resume replay);
  // later calls resume the session with only the new feedback text.
  const writerCall = async (msgs) => {
    const promptText = writerStarted
      ? contentToText(msgs[msgs.length - 1].content)
      : msgs.map((m) => (m.role === 'assistant'
        ? `(your previous response)\n${contentToText(m.content)}`
        : contentToText(m.content))).join('\n\n');
    writerStarted = true;
    return writer.call(promptText);
  };

  const attempts = [];
  let l5x = null;
  let editPlan = null;
  let validation = { ok: false, errors: ['No generation attempt completed'], warnings: [] };
  let totalCost = readiness ? (readiness.costUSD || 0) : 0;

  // Escalation-budget state (loop limit → hold-for-help).
  const findingCounts = new Map(); // finding text -> consecutive validate-round survivals
  const rootCauses = new Map();    // distinct failure cause -> rounds it cost (writing notes)
  let held = null;                 // set = build held for help; loop stopped deliberately
  let structuralChanges = null;    // declared weeds-decisions from the winning plan
  let patchedCompiledIr = null;    // compiled IR updated to match declared changes

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Attempt 1 streams 15% -> 70%; repair rounds squeeze into 88% -> 92%.
    const streamBase = attempt === 1 ? 15 : Math.min(88 + (attempt - 2) * 2, 91);
    const streamSpan = attempt === 1 ? 55 : 2;
    const stageName = attempt === 1 ? 'model' : 'repair';
    const stageDetail = attempt === 1
      ? 'Model authoring edit plan'
      : `Repair round ${attempt - 1}: model revising plan`;
    onProgress(streamBase, stageName, stageDetail);
    // Split the attempt's band: reasoning owns the first ~55% (attempt 1:
    // 15 -> 45), writing owns the rest (45 -> 70). Repair rounds split their
    // tiny band the same way.
    const thinkSpan = attempt === 1 ? 30 : streamSpan / 2;
    const writeBase = streamBase + thinkSpan;
    const writeSpan = streamSpan - thinkSpan;
    // The SDK writer streams tool activity (which reference file it is
    // reading) through onActivity; point it at this attempt's band.
    progressRef.pct = streamBase + Math.min(thinkSpan, 6);
    progressRef.stage = stageName;
    void writeBase; void writeSpan; void EXPECTED_OUTPUT_TOKENS; void EXPECTED_THINKING_TOKENS;
    const first = await writerCall(messages);
    let { text, usage, model } = first;
    let truncated = first.truncated;
    let cost = first.costUSD || 0;
    totalCost += cost;
    const attemptUsage = usage ? {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
    } : null;
    // Record the assistant turn now — continuation and repair rounds both
    // build on it.
    messages.push({ role: 'assistant', content: text });

    let feedback = null; // set = this attempt failed; message goes back to the model
    let stage = null;
    let continuations = 0;

    // Continuation support: a plan that parses cleanly and ends with
    // "toBeContinued": true is a deliberate split — request the remainder and
    // concatenate the operations arrays. Only engages on clean JSON.
    let parsed = extractPlanJson(text);
    if (parsed.plan && parsed.plan.toBeContinued === true && Array.isArray(parsed.plan.operations)) {
      const basePlan = parsed.plan;
      const allOps = [...basePlan.operations];
      let chunk = basePlan;
      let contFailed = null;
      while (chunk && chunk.toBeContinued === true) {
        if (continuations >= MAX_CONTINUATIONS) {
          contFailed = `plan still marked toBeContinued after ${MAX_CONTINUATIONS} continuation calls`;
          break;
        }
        continuations++;
        onProgress(Math.min(streamBase + streamSpan, 87), stageName,
          `Continuation ${continuations}: requesting remaining operations (${allOps.length} so far)`);
        messages.push({
          role: 'user',
          content: `Continue your edit plan. You have sent ${allOps.length} operation(s) so far. ` +
            'Respond with ONLY a JSON object {"operations":[...], "toBeContinued": true|false} ' +
            'containing the REMAINING operations in order — do not repeat any operation already sent. ' +
            'Set "toBeContinued": false (or omit it) when the plan is complete.',
        });
        const cont = await writerCall(messages);
        const contCost = cont.costUSD || 0;
        totalCost += contCost;
        cost += contCost;
        if (cont.usage && attemptUsage) {
          attemptUsage.input += cont.usage.input_tokens || 0;
          attemptUsage.output += cont.usage.output_tokens || 0;
          attemptUsage.cacheRead += cont.usage.cache_read_input_tokens || 0;
          attemptUsage.cacheWrite += cont.usage.cache_creation_input_tokens || 0;
        }
        messages.push({ role: 'assistant', content: cont.text });
        const p2 = extractPlanJson(cont.text);
        if (cont.truncated && !p2.plan) {
          contFailed = `continuation ${continuations} was itself truncated at ${MAX_TOKENS} tokens`;
          break;
        }
        if (!p2.plan || !Array.isArray(p2.plan.operations)) {
          contFailed = `continuation ${continuations} was not a valid JSON object with an "operations" array` +
            (p2.error ? ` (${p2.error})` : '');
          break;
        }
        chunk = p2.plan;
        allOps.push(...chunk.operations);
      }
      if (contFailed) {
        parsed = { plan: null, error: null };
        stage = 'continuation';
        feedback = `Your split edit plan could not be completed: ${contFailed}. ` +
          `You had sent ${allOps.length} operation(s). Continue with ONLY a JSON object ` +
          '{"operations":[...], "toBeContinued": true|false} containing the remaining operations, ' +
          'splitting into smaller chunks if needed.';
      } else {
        const combined = { ...basePlan, operations: allOps };
        delete combined.toBeContinued;
        parsed = { plan: combined, error: null };
        truncated = false; // each chunk was closed deliberately
      }
    }

    if (!feedback && truncated && !parsed.plan) {
      stage = 'truncated';
      const roughOps = (text.match(/"op"\s*:/g) || []).length;
      feedback = `Your response was truncated at ${MAX_TOKENS} output tokens` +
        (roughOps ? ` — the cut-off plan contained ~${roughOps} operations` : '') + '. Two ways to fix this: ' +
        '(1) produce a SMALLER edit plan — prefer updateRung over replaceRoutineRungs, use the shortest ' +
        'unique "match" strings, omit "notes", never restate unchanged rungs; or ' +
        '(2) SPLIT the plan across responses — end a response early with VALID, complete JSON whose last ' +
        'property is "toBeContinued": true; you will then be asked for the remainder and the ' +
        '"operations" arrays are concatenated in order before merging.';
    }

    if (!feedback) {
      const { plan, error } = parsed;
      if (error) { stage = 'parse'; feedback = `Your response was not a valid JSON edit plan. ${error}. Respond with ONLY the JSON object.`; }
      else {
        const schema = validatePlan(plan);
        if (!schema.ok) {
          stage = 'schema';
          feedback = 'Your edit plan failed schema validation. Fix every issue and respond with ONLY the corrected JSON plan:\n' +
            schema.errors.map(e => `- ${e}`).join('\n');
        } else {
          editPlan = plan;

          // ── STRUCTURAL-DELTA HIGHLIGHT (Dan's escalation model) ────────────
          // The writer may DECLARE deliberate structural changes vs the
          // approved compiled IR (plan.structuralChanges, each with an
          // irPatch). The patch is applied to a COPY of the compiled IR so:
          //   (a) validation checks the code against the PATCHED contract
          //       (declared divergence passes; silent divergence still fails),
          //   (b) the caller persists the patched IR back onto
          //       sm.compiledSequence — the flowchart stays truthful,
          //   (c) each change is flagged { text, approved:false } for Dan's
          //       quick approve; unapproved changes never block the file.
          structuralChanges = null;
          patchedCompiledIr = null;
          let contractIr = compiledIr;
          const declared = (mode === 'translation' && compiledIr && Array.isArray(plan.structuralChanges))
            ? plan.structuralChanges.filter(c => c && String(c.text || '').trim())
            : [];
          if (declared.length) {
            // Lazy require at call time — coordinationAuthor requires this
            // module at ITS top, so a top-level require here would cycle.
            const { applyIrPatches } = require('./coordinationAuthor');
            const patched = JSON.parse(JSON.stringify(compiledIr));
            const patchErrors = [];
            for (const c of declared) {
              if (Array.isArray(c.irPatch) && c.irPatch.length) {
                const r = applyIrPatches(patched, c.irPatch);
                if (!r.ok) patchErrors.push(...r.errors.map(x => `declared change "${String(c.text).slice(0, 80)}": ${x}`));
              }
            }
            if (patchErrors.length) {
              stage = 'irpatch';
              feedback = 'Your declared structuralChanges could not be applied to the approved compiled ' +
                'sequence. Fix the irPatch ops (or drop the change and follow the approved sequence) and ' +
                'respond with ONLY the corrected complete JSON plan:\n' +
                patchErrors.map(x => `- ${x}`).join('\n');
            } else {
              contractIr = patched;
              patchedCompiledIr = patched;
              structuralChanges = declared.map(c => ({
                text: String(c.text).trim(),
                ...(c.irPatch ? { irPatch: c.irPatch } : {}),
                approved: false,
              }));
            }
          }

          if (!feedback) {
            onProgress(attempt === 1 ? 78 : 91.5, 'merge', 'Merging edit plan into template');
            try {
              const merged = applyEditPlan(templateXml, plan, {
                smName: ir.smName, stationNumber: meta.stationNumber, stamp, stateMap,
              });
              l5x = merged.xml;
            } catch (e) {
              if (!(e instanceof MergeError)) throw e;
              stage = 'merge';
              feedback = 'The merge engine could not apply your edit plan. Every anchor must match exactly once — ' +
                'for an ambiguous anchor, add "occurrence" (1-based index among the listed matches) or ' +
                '"nearComment" (substring of the intended rung\'s comment) to pin the rung. ' +
                'Fix these and respond with ONLY the corrected JSON plan:\n' +
                e.errors.map(x => `- ${x}`).join('\n');
            }
          }
          if (!feedback) {
            onProgress(attempt === 1 ? 88 : 92, 'validate', 'Validating generated program');
            // compiledIr rides along so the flow-order check can exempt
            // side-path recovery excursions (legal backward re-entries).
            const v = validateL5X(l5x, {
              compiledIr: (mode === 'translation' && contractIr) ? contractIr : null,
            });
            // In translation mode the APPROVED compiled sequence — not the
            // drawn diagram — is the approval contract: states/conditions the
            // compiler synthesized (retry exhaustion, handshakes) exist only
            // in the compiled IR, so the cross-check runs against it. When
            // the plan declared structural changes, the PATCHED IR is the
            // contract (declared divergence is legitimate; silent isn't).
            const d = (mode === 'translation' && contractIr)
              ? validateAgainstCompiledIR(contractIr, l5x)
              : validateAgainstDiagram(projectJson, smId, l5x);
            validation = {
              ok: v.ok && d.ok,
              errors: [...v.errors, ...d.errors],
              warnings: [...v.warnings, ...d.warnings],
            };
            if (!validation.ok) {
              stage = 'validate';
              feedback = 'The merged program failed validation. Revise your edit plan to fix EVERY issue ' +
                'and respond with ONLY the corrected complete JSON plan:\n\n' + formatReport(validation);

              // ── LOOP LIMIT → HOLD-FOR-HELP ────────────────────────────────
              // A finding that survives FINDING_ROUND_LIMIT consecutive fix
              // rounds — or a run that hits HARD_ROUND_CAP total rounds —
              // stops generating: Jarvis formulates the question(s) WITH his
              // proposed solution(s) and the build is held for a human.
              const { persistent } = trackPersistentFindings(findingCounts, validation.errors);
              const overCap = attempt >= HARD_ROUND_CAP;
              if (persistent.length || overCap) {
                stage = 'held';
                feedback = null;
                const findings = persistent.length ? persistent : validation.errors.slice(0, 6);
                const reason = persistent.length
                  ? `${persistent.length} finding(s) survived ${FINDING_ROUND_LIMIT} consecutive fix rounds`
                  : `hard cap of ${HARD_ROUND_CAP} total fix rounds reached`;
                onProgress(92.5, 'held',
                  `Hold-for-help: ${reason} — formulating question(s) with proposed solution(s)`);
                const help = await formulateHelpQuestions(client, system, messages, {
                  persistentFindings: findings, rounds: attempt, smName: ir.smName, signal: abortSignal,
                });
                totalCost += help.costUSD || 0;
                held = {
                  reason,
                  rounds: attempt,
                  persistentFindings: findings,
                  questions: help.questions,
                  ...(help.decisions?.length ? { decisions: help.decisions } : {}),
                  ...(help.formulationError ? { formulationError: help.formulationError } : {}),
                  // Resume state — see the RESUME block above for why this is
                  // the cheapest faithful representation.
                  resume: {
                    version: 1,
                    smId: ir.smId,
                    smName: ir.smName,
                    mode,
                    template: meta.template,
                    attemptCount: attempt,
                    lastEditPlan: editPlan || null,
                    lastL5xDraft: l5x || null,
                    persistentFindings: findings,
                    validationReport: formatReport(validation),
                  },
                };
              }
            } else {
              stage = 'ok';
            }
          }
        }
      }
    }

    attempts.push({
      attempt,
      stage,
      ok: stage === 'ok',
      errors: validation.errors.length,
      warnings: validation.warnings.length,
      continuations,
      usage: attemptUsage,
      costUSD: Number(cost.toFixed(4)),
      model,
    });

    // Writing-notes source: what actually came up while writing — the
    // distinct root cause of each failed round (aggregated post-loop).
    if (stage && stage !== 'ok') {
      const cause = stage === 'validate' || stage === 'held'
        ? String(validation.errors[0] || stage)
        : String((feedback || stage).split('\n')[0]);
      const key = `${stage === 'held' ? 'validate' : stage}: ${cause.slice(0, 160)}`;
      rootCauses.set(key, (rootCauses.get(key) || 0) + 1);
    }

    if (held) break;    // hold-for-help: stop generating, a human decides
    if (stage === 'ok') break;
    if (attempt === MAX_ATTEMPTS) {
      if (stage !== 'validate') {
        validation = { ok: false, errors: [`Pipeline stopped at stage "${stage}": ${feedback}`], warnings: [] };
      }
      break;
    }
    if (totalCost >= MAX_COST_USD) {
      validation = {
        ok: false,
        errors: [
          `Aborted: accumulated cost $${totalCost.toFixed(2)} reached the JARVIS_MAX_COST_USD cap ($${MAX_COST_USD}) after attempt ${attempt} (stage "${stage}")`,
          ...validation.errors,
        ],
        warnings: validation.warnings,
      };
      break;
    }
    messages.push({ role: 'user', content: feedback });
  }

  // ── PRE-DELIVERY INTERNAL REVIEW (the "pre-Jason pass") ────────────────────
  // Last pipeline stage: before any generated file can be marked ready to go
  // external, Jarvis reviews it the way the senior CE would — adversarially,
  // against the template (internalReviewer.js, ONE model call, effort high).
  // Mechanical validation above catches structure; this catches style drift,
  // missing template blocks, wrong-shaped logic. A 'fix' verdict does NOT
  // auto-loop regeneration (cost discipline) — it marks the build "not ready
  // for external delivery" so a human decides.
  // Gate: JARVIS_INTERNAL_REVIEW=on|off (default on).
  let internalReview = null;
  const reviewEnabled = String(process.env.JARVIS_INTERNAL_REVIEW || 'on').toLowerCase() !== 'off';
  if (reviewEnabled && validation.ok && l5x) {
    onProgress(94, 'review', 'Internal review — Jarvis checking the file against the template like the senior CE would');
    try {
      const { reviewGenerated } = require('./internalReviewer');
      internalReview = await reviewGenerated({
        l5x, projectJson, smId, signal: abortSignal,
        // Declared structural changes updated the contract — review against it.
        compiledIrOverride: patchedCompiledIr || null,
      });
      totalCost += internalReview.costUSD || 0;
      onProgress(98, 'review', internalReview.verdict === 'ship'
        ? '✓ Internal review: ship'
        : internalReview.verdict === 'unsure'
          ? `⏸ Internal review: unsure — ${internalReview.heldStatus || 'held, standards question(s) filed for the controls team'}`
          : `⚠ Internal review: ${internalReview.findings.length} finding(s) — not ready for external delivery`);
    } catch (e) {
      // A review failure never fails the build — but it is reported honestly
      // (verdict null = "review didn't run", NOT "reviewed clean").
      if (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) throw e;
      internalReview = { verdict: null, error: e.message || String(e), findings: [], missingVsTemplate: [], summary: '' };
      onProgress(98, 'review', 'Internal review failed (build kept): ' + (e.message || e));
    }
  }

  // ── TUITION (Dan's first-pass doctrine): every fix round auto-files a
  // lesson — "what should the pre-write study have caught?" — through
  // correctionLearner, so rounds trend to zero. Runs only when fix rounds
  // actually happened and the loop wasn't held (held builds learn on resume).
  // Gate: JARVIS_TUITION=on|off (default on).
  let tuition = null;
  const tuitionEnabled = String(process.env.JARVIS_TUITION || 'on').toLowerCase() !== 'off';
  if (tuitionEnabled && !held && attempts.length > 1) {
    onProgress(99, 'tuition', `Filing tuition — what should the pre-write study have caught? (${attempts.length - 1} fix round(s))`);
    tuition = await formulateTuition(client, system, messages, {
      rootCauses, smName: ir.smName, projectName: projectJson.name, signal: abortSignal,
    });
    totalCost += tuition.costUSD || 0;
  }

  // ── THE METRIC (Dan's headline question: "can you create a correct file
  // with no prior version?"). firstPassShip = ONE write, zero fix rounds,
  // validation clean, and the single review said ship. null = the review
  // didn't run, so a ship claim would be dishonest. roundsToShip = total
  // attempts when the build shipped, else null.
  const reviewVerdict = internalReview ? internalReview.verdict : null;
  const shipped = validation.ok && reviewVerdict === 'ship';
  const firstPassShip = internalReview == null
    ? null
    : (shipped && attempts.length === 1 && !options.resume);
  const roundsToShip = shipped ? attempts.length : null;

  // ── WRITING NOTES (Dan's escalation model): the right-amount one-sentence
  // notes of what came up while writing. No quota — nothing came up, nothing
  // is written; never filler. Sources: the model's own plan notes, the
  // distinct root cause of each fix round (with how many rounds it cost),
  // and a hold marker when the build escalated.
  const writingNotes = [];
  if (editPlan && String(editPlan.notes || '').trim()) {
    writingNotes.push({ text: String(editPlan.notes).replace(/\s+/g, ' ').trim() });
  }
  for (const [cause, n] of rootCauses) {
    writingNotes.push({ text: `Cost ${n} fix round${n === 1 ? '' : 's'} — ${cause}` });
  }
  if (held) {
    writingNotes.push({ text: `Held for help after ${held.rounds} round(s): ${held.reason}.` });
    // Hold discipline: decisions the formulator made instead of asking
    // (derivable → decide-and-record) — reviewable notes, never blocking asks.
    for (const d of held.decisions ?? []) {
      writingNotes.push({ text: `Decided during hold-formulation: ${d}` });
    }
  }
  if (tuition && (tuition.applied.length || tuition.queued.length)) {
    writingNotes.push({ text: `Tuition filed for ${attempts.length - 1} fix round(s): ${tuition.applied.length} lesson(s) into concept docs${tuition.queued.length ? `, ${tuition.queued.length} low-confidence kept as notes` : ''}.` });
    for (const q of tuition.queued) writingNotes.push({ text: `Tuition (unconfirmed): ${q}` });
  } else if (tuition && tuition.error) {
    writingNotes.push({ text: `Tuition pass failed (build unaffected): ${tuition.error}` });
  }

  return {
    ok: validation.ok,
    l5x,
    internalReview,
    validation,
    editPlan,
    // Escalation-model payloads (all additive; absent/null when nothing
    // escalated — the existing generate path is byte-identical then):
    held,                 // { reason, rounds, questions:[{question, proposedSolution, addressee, domain}], resume } | null
    structuralChanges,    // [{ text, irPatch?, approved:false }] | null
    patchedCompiledIr,    // compiled IR updated to match declared changes | null
    writingNotes,         // [{ text }]
    // THE METRIC (first-pass doctrine): recorded per build in buildScores and
    // aggregated by the trackrecord API — Jarvis's headline number.
    firstPassShip,        // true | false | null (null = review didn't run)
    roundsToShip,         // int when shipped, else null
    reviewNotes: l5x ? extractReviewNotes(l5x) : [],
    // Full structured IR (irVersion 1) — persisted as .ir.json by the server /
    // benchmark harness so the UI can render the compiled "Full Controls" view.
    // `.text` remains the human-readable rendering (backward compatible).
    ir,
    meta: {
      ...meta,
      mode, // 'authoring' | 'translation' (approved compiled sequence found)
      modelEffort: 'sdk-session', engine: 'claude-agent-sdk',
      expectedDuration: mode === 'translation' ? '~1-2 min (mechanical translation)' : null,
      model: MODEL,
      maxOutputTokens: MAX_TOKENS,
      maxAttempts: MAX_ATTEMPTS,
      jarvisVersion: JARVIS_VERSION,
      attempts,
      repairRounds: attempts.length - 1,
      editPlanOps: editPlan ? (editPlan.operations || []).length : 0,
      // First-pass doctrine instrumentation (all additive):
      study: study ? { exemplar: study.exemplar, sizes: study.sizes } : null,
      readiness: readiness
        ? { ran: true, ready: readiness.ready, model: readiness.model, costUSD: readiness.costUSD, ...(readiness.error ? { error: readiness.error } : {}) }
        : { ran: false },
      tuition: tuition
        ? { lessons: tuition.lessons.length, applied: tuition.applied.length, costUSD: tuition.costUSD, ...(tuition.error ? { error: tuition.error } : {}) }
        : null,
      firstPassShip,
      roundsToShip,
      costEstimate: {
        totalUSD: Number(totalCost.toFixed(4)),
        model: MODEL,
        pricingPerM: PRICING[MODEL] || PRICING['claude-opus-5'],
        note: 'input + 2.0x cache-write (1h TTL) + 0.10x cache-read + output, per attempt'
          + (internalReview && internalReview.costUSD ? `; includes internal review ($${internalReview.costUSD})` : ''),
      },
    },
  };
}

module.exports = {
  generateL5X, isConfigured, AiNotConfiguredError,
  extractPlanJson, extractReviewNotes, costOfUsage, PRICING, MODEL, MAX_TOKENS, MAX_ATTEMPTS,
  // Escalation model (loop limit → hold-for-help) — budgets + pure helpers
  // exported for unit tests.
  FINDING_ROUND_LIMIT, HARD_ROUND_CAP,
  trackPersistentFindings, fallbackHelpQuestions,
  // First-pass doctrine — exported for unit tests.
  formulateTuition,
};
