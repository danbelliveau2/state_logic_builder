/**
 * questionRouter.js — domain classification + stale-question hygiene for the
 * Jarvis question queue (jarvis-knowledge/questions.json).
 *
 * THE INCIDENT (2026-08-22): the CE Review page surfaced the raw open-question
 * queue for ServoPNP — 14 questions, most either MECHANICAL (Z clearance
 * heights, transition-point geometry, home-vs-pick positions) or STALE
 * ("default position values are placeholders", filed before the position
 * tables got real values). Dan: "positions are not controls — the MEs design
 * the station, they know the positions; anything position-related belongs on
 * the spec page."
 *
 * Every queue entry carries a domain:
 *   'mechanical' — the answer lives in the MECHANICAL MODEL: positions,
 *                  heights, clearances, distances, transition-point geometry,
 *                  strokes, home-vs-pick posture, speeds-as-values. Belongs to
 *                  the ME, surfaced on the SPEC SHEET at describe time — never
 *                  on a controls surface, never filed at compile. If the spec
 *                  sheet's tables already contain the value, USE it.
 *   'controls'   — controls-engineering judgment / SDC standards: transition
 *                  and motion-command FORM, staging, recovery standards,
 *                  tag/naming standards, part-tracking treatment, alarm rules.
 *                  JARVIS IS THE CONTROLS ENGINEER (Dan, 2026-08-22): the
 *                  default is DECIDE AND RECORD (reviewable after the fact);
 *                  only genuinely GENERAL "how does SDC want this done"
 *                  standards questions go to the leads' queue on the Jarvis
 *                  page — phrased project-agnostically. Nothing controls-domain
 *                  renders on a per-station page.
 *   'jarvis'     — tool/meta questions for Dan: exports/ingestion requests,
 *                  lost artifacts (screenshots), doc corrections, Jarvis's own
 *                  plumbing.
 *
 * CommonJS, dependency-free, no fs — required by server.js and
 * internalReviewer.js (and safe to import anywhere).
 */

const QUESTION_DOMAINS = ['mechanical', 'controls', 'jarvis'];

// SOLUTIONS-NOT-EXPLANATIONS (Dan, 2026-08-22): help is ONE lane with an
// addressee tag, not separate buckets. Every question carries WHO answers it:
//   'ME' — mechanical engineer (mechanical/model questions; also 'jarvis'
//          tool/meta questions, which go to Dan — the ME-side tool owner)
//   'CE' — controls engineering leads (general SDC-standards questions)
const ADDRESSEES = ['ME', 'CE'];

/** Domain → addressee: mechanical→ME, controls→CE, jarvis→ME (Dan). */
function addresseeForDomain(domain) {
  return domain === 'controls' ? 'CE' : 'ME';
}

/** Validate a caller-supplied addressee, else derive it from the domain. */
function resolveAddressee(addressee, domain) {
  return ADDRESSEES.includes(addressee) ? addressee : addresseeForDomain(domain);
}

// ASK-FOR-EXAMPLES DOCTRINE (Dan, 2026-08-23): when Jarvis hits a mechanism/
// sequence/device pattern with NO template or studied example, he does not
// invent alone — he files a blocker question of kind 'example-request'
// ("I don't have a good SDC example for X — can you give me one?"), with his
// best-guess proposedSolution still attached (solutions-first). The team
// answers by uploading a file to POST /api/jarvis/examples with this
// question's id as requestId — that resolves the question (status 'answered')
// and trains the example into the curriculum immediately.
const QUESTION_KINDS = ['question', 'example-request'];

/** Validate a caller-supplied kind; default 'question'. */
function resolveQuestionKind(kind) {
  return QUESTION_KINDS.includes(kind) ? kind : 'question';
}

// Tool/meta signals — tested against the QUESTION TEXT ONLY (contexts often
// say "Jarvis decided per SDC standards", which would false-positive).
const JARVIS_META = /\bjarvis\b|\.acd\b|\bexport\b.{0,40}\bl5x\b|\bl5x\b.{0,30}\bexport|\bscreenshot|\bdocx\b|\bclaude\.md\b|architecture\.md|\bre-?request\b|\bre-?export\b|text extraction|question queue itself/i;

// Explicit rule/standard requests — controls even when mm values appear in
// the question (e.g. "is there an SDC rule for the wideband value?").
const ASKS_FOR_RULE = /\bis there (an? )?(sdc[- ]?)?(rule|standard|convention)\b|\bwhat is the (sdc[- ]?)?standard\b|\bwhat does sdc use\b|\bsanctioned\b|\bapproved (shape|form|sequence)\b|\bsdc[- ]standard treatment\b|\bstandard treatment\b|\bconfirm .{0,40}(ruling|standard)\b/i;

// Geometry / model-value vocabulary — the answer lives in the mechanical
// model. Positions, heights, clearances, distances, transition-point
// geometry, strokes, home-vs-pick.
const GEOMETRY = new RegExp([
  'at what (vertical |z[- ]?|)?(height|elevation)',
  'what (z|vertical) (height|clearance)',
  'clearance threshold',
  'clear(ance)? (height|elevation|value)',
  '\\bmm from\\b',
  'how close .{0,50}(mm|position)',
  'home position .{0,80}(pick|place)',
  'home .{0,30}coincide',
  'transition point .{0,60}(same|height|differ)',
  '\\bplaceholder',
  'real (travel|position).{0,25}values',
  '\\bgeometry\\b',
  'stroke (length|time|distance)',
  'safe[- ]clear',
  'blend[- ]start',
  'vertical(ly)? clear',
].join('|'), 'i');

// Code-form / controls vocabulary.
const CODE_FORM = new RegExp([
  '\\brung\\b', '\\br0\\d\\b', '\\br2\\d\\b', '\\broutine\\b',
  '\\bmam\\b', '\\bmso\\b', '\\bmsf\\b', '\\bmah\\b', '\\bmaj\\b', '\\bmag\\b', '\\bmapc\\b',
  '\\botl\\b', '\\botu\\b', '\\bote\\b', '\\bons\\b', '\\baoi\\b', '\\budt\\b', '\\bjsr\\b',
  '\\bxic\\b', '\\bxio\\b', '\\blatch\\b', '\\bseal\\b',
  'stanum', 'part[- ]?tracking', 'tracking\\.p_data',
  'faulttime', 'timeoutflt', '\\balarm', 'state numbering', 'status\\.state',
  'tag nam', '\\b[qpi]_[A-Za-z]', '\\bstaging\\b', '\\brecovery\\b',
  '\\bhandshake\\b', '\\bsupervisor\\b', '\\bindexer\\b', '\\bdry ?run\\b',
  '\\blockout\\b', '\\bhmi\\b', 'cycle[- ]start', '\\bretry\\b', '\\bfault\\b',
  '\\bwarning\\b', '\\bservo\\b', '\\bvision\\b', '\\bcamera\\b', '\\bwideband\\b',
  '\\binposwide\\b', '\\bboilerplate\\b', '\\btemplate\\b',
].join('|'), 'i');

/**
 * Classify one question into 'mechanical' | 'controls' | 'jarvis'.
 * Rule-based, deterministic. Precedence:
 *   1. tool/meta (question text only)         → jarvis
 *   2. geometry value-request, no rule-ask     → mechanical
 *   3. rule/standard request (even with mm)    → controls
 *   4. code-form vocabulary                    → controls
 *   5. default (controls judgment)             → controls
 * @param {string} question
 * @param {string} [context]
 * @returns {'mechanical'|'controls'|'jarvis'}
 */
function classifyQuestionDomain(question, context = '') {
  const q = String(question || '');
  const t = (q + ' ' + String(context || '')).toLowerCase();

  if (JARVIS_META.test(q)) return 'jarvis';

  const geo = GEOMETRY.test(t);
  const rule = ASKS_FOR_RULE.test(t);
  if (geo && !rule) return 'mechanical';   // asking for a VALUE → the model
  if (rule) return 'controls';             // asking for a RULE → standards
  if (CODE_FORM.test(t)) return 'controls';
  return 'controls';
}

/** Validate a caller-supplied domain, else classify. */
function resolveQuestionDomain(domain, question, context = '') {
  return QUESTION_DOMAINS.includes(domain)
    ? domain
    : classifyQuestionDomain(question, context);
}

// ── Stale-question hygiene ───────────────────────────────────────────────────

/** Same rule as v2/servoValues.js positionValueMissing — 0 is a real value. */
function positionValueMissing_(pos) {
  const v = pos ? pos.defaultValue : undefined;
  return v === null || v === undefined || v === '';
}

/** Every ServoAxis on the SM has a non-empty position table with real values. */
function stationHasRealPositionValues(sm) {
  const servos = ((sm && sm.devices) || []).filter(d => d.type === 'ServoAxis');
  if (!servos.length) return false;
  return servos.every(d =>
    Array.isArray(d.positions) && d.positions.length > 0 &&
    d.positions.every(p => !positionValueMissing_(p)));
}

/** Does a queue entry belong to this station? (context or buildRef mention) */
function questionMatchesStation(q, sm) {
  if (!q || !sm) return false;
  const hay = String(q.context || '') + ' ' + String(q.buildRef || '');
  return (sm.name && hay.includes(sm.name)) ||
         (sm.displayName && hay.includes(sm.displayName));
}

// A question whose premise is "the position values are placeholders/defaults".
const STALE_PREMISE = /placeholder|default position values|values are (placeholders|defaults)|give real (travel|position)|real travel and transition-point values/i;

/**
 * Compile-time hygiene: close this station's open questions whose premise is
 * gone — they reference placeholder/default position values but the station's
 * devices now hold real position values. Closed entries STAY in the queue
 * (history), status 'closed', closedReason 'stale — data now exists'.
 *
 * Mutates the entries in `queue`; the caller persists.
 * @returns {object[]} the entries that were closed
 */
function closeStaleQuestionsForStation(queue, sm, { now = null } = {}) {
  if (!Array.isArray(queue) || !stationHasRealPositionValues(sm)) return [];
  const closed = [];
  for (const q of queue) {
    if (!q || q.status !== 'open') continue;
    if (!questionMatchesStation(q, sm)) continue;
    if (!STALE_PREMISE.test(String(q.question || ''))) continue;
    q.status = 'closed';
    q.closedReason = 'stale — data now exists';
    q.closedAt = (now || new Date()).toISOString();
    q.domain = resolveQuestionDomain(q.domain, q.question, q.context);
    q.note = 'Auto-closed at compile: the premise is gone — '
      + `${sm.displayName || sm.name}'s position tables now hold real values `
      + '(the spec sheet\'s tables are the answer source).';
    closed.push(q);
  }
  return closed;
}

module.exports = {
  QUESTION_DOMAINS,
  ADDRESSEES,
  QUESTION_KINDS,
  resolveQuestionKind,
  addresseeForDomain,
  resolveAddressee,
  classifyQuestionDomain,
  resolveQuestionDomain,
  stationHasRealPositionValues,
  questionMatchesStation,
  closeStaleQuestionsForStation,
};
