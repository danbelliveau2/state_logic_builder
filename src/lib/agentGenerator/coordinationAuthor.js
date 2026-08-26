/**
 * coordinationAuthor.js — JARVIS v1.1 "pipeline inversion": the Build-time
 * COMPILE step.
 *
 * Dan's directive: thinking happens ONCE, interactively, at Build time; the
 * compiled sequence gets reviewed/edited by the engineer; Generate = "I agree
 * with everything to this point" -> near-mechanical translation. "Reason based
 * on knowledge you already have… never relearn the template."
 *
 * compileSequence({ projectJson, smId, onProgress, signal }):
 *   ONE reasoning call (JARVIS_MODEL, output_config effort 'high' — this is
 *   THE thinking step) that takes:
 *     - the drawn diagram IR (ir.js — final state numbers, actions, machineSpec
 *       with outcome rules / relationships / reciprocal partner declarations)
 *     - meKnowledge.md (standing SDC facts + question discipline)
 *     - the distilled per-template pattern notes promptBuilder already carries
 *       (TEMPLATE_NOTES — never the template file itself)
 *   and produces the COMPLETE compiled sequence as a structured object in the
 *   ir.js irVersion-1 shape: states with real numbers on the SDC grid
 *   (4, 7, 10 … 97) + init/lockout ranges, every transition with concrete
 *   conditionText in SDC tag idioms, every wait with ALL exits including
 *   partner-failure and timeout paths (the no-exitless-waits rule), recovery
 *   behavior, handshake signals, and review flags for the controls engineer.
 *
 *   Also returns clarifying questions (self-answer-test discipline applies)
 *   and the real cost of the call.
 *
 * The caller (POST /api/jarvis/compile in server.js) persists the result to
 * the project as:
 *   sm.compiledSequence = { ir, compiledAt, jarvisVersion, approved: false, cost }
 *
 * DORMANCY: nothing in the existing pipeline requires this module. It only
 * runs when the compile endpoint is called, and the generation pipeline only
 * changes behavior when sm.compiledSequence.approved === true exists
 * (promptBuilder translation mode).
 *
 * CommonJS, plain Node — required lazily by server.js.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { buildIR, STATE_BASE, STATE_STEP, IR_VERSION } = require('./ir');
const { selectTemplate, TEMPLATE_NOTES, COMMON_NOTES } = require('./promptBuilder');
const { loadMeKnowledge, loadConcepts, SUPREME_LAW } = require('./meKnowledge');
const { precedentsBlock } = require('./precedents');
const { costOfUsage, AiNotConfiguredError } = require('./client');
const { renderPatternInventory } = require('./templatePatterns');
const { checkOneMovePerState } = require('./validator');
const { resolveQuestionDomain, resolveAddressee } = require('./questionRouter');
const { normalizeGenerationScope, renderGenerationScopeText } = require('./generationScope');

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
const MAX_TOKENS = parseInt(process.env.JARVIS_COMPILE_MAX_TOKENS, 10) || 32000;

// Version identity of the COMPILER step (independent of the generation
// pipeline's JARVIS_VERSION so a dev compiler never restamps generated files).
const COMPILER_VERSION = '1.1.1';

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

function extractJson(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Model response contained no JSON object');
  }
  return JSON.parse(t.slice(start, end + 1));
}

// ── Output contract (what the one reasoning call must return) ───────────────

const OUTPUT_SPEC = `
# Your response

Respond with ONLY one JSON object (no markdown fences, no prose before/after):
{
  "states": [
    { "stateNumber": <int on the 4,7,10,... grid>,
      "label": "<what this state does>",
      "sourceNodeId": "<REQUIRED: the drawn node's EXACT id, copied verbatim from the
        "[node ...]" tag on the diagram IR's state line, when this state implements a
        drawn node; null for a state you synthesized. NEVER invent an id — the UI joins
        compiled states back to drawn nodes by this id>",
      "synthesized": true|false,
      "isInitial": true|false, "isComplete": true|false,
      "actions": [
        { "operation": "<Extend|Retract|Engage|Disengage|ServoMove|SetSignal|ClearSignal|Wait|...>",
          "deviceName": "<device name from the Devices list, or null for a p_ signal action>",
          "detail": "<concrete SDC detail, e.g. 'OTL(p_RequestNextStack)' or 'q_ExtendHoldDown'>",
          "positionName": "<ServoMove only: target position name from the device's positions list>",
          "speedProfile": "<ServoMove only: speed profile name from the device's speedProfiles list, e.g. 'Fast' or 'Slow' — REQUIRED on every ServoMove when the device declares more than one profile>",
          "advance": "<ServoMove only: 'complete' (strict MAM.PC + InPos), 'wideband' (blend: next state may start on MAM.IP + InPosWide), or 'inflight' (multi-speed stroke command state: next state on MAM.IP alone — the move continues while the sequence watches for the speed-transition band) — REQUIRED on every ServoMove>" }
      ] }
  ],
  "transitions": [
    { "fromState": <int>, "toState": <int>,
      "fromLabel": "<state label>", "toLabel": "<state label>",
      "conditionText": "<CONCRETE SDC rung-condition idiom using real tag names,
        e.g. 'i_MagnetSensor AND HorizontalShuttleExtendDelay.DN' or
        '\\\\Magnet_Pick.p_MagnetTaken' or 'MagnetRetryCount GEQ 3' or
        'Status.TimeoutFlt (FaultTime 5000ms)'>",
      "kind": "sequence"|"wait"|"branch"|"recovery"|"timeout",
      "outcomeLabel": "<Pass|Fail|Retry|Timeout|null>",
      "branch": "pass"|"fail"|"retry"|null }
  ],
  "waits": [
    { "stateNumber": <int>, "signal": "<signal/sensor name>", "source": "<device or partner SM>",
      "partner": "<partner SM name or null>", "direction": "incoming",
      "mode": "wait"|"branch"|"handshake",
      "exits": [ { "toState": <int>, "when": "<condition summary>" } ] }
  ],
  "handshakes": [
    { "signal": "<p_TagName>", "direction": "out"|"in", "partner": "<SM name>",
      "purpose": "<one line>", "setAtState": <int|null>, "clearAtState": <int|null> }
  ],
  "templateConformance": [
    { "decision": "<one STRUCTURAL choice: state granularity, motion trigger shape, staging, transition condition form, R02 ordering, alarm shape, ...>",
      "basis": "template" | "sanctioned-extension" | "extension",
      "citation": "<basis template: the pattern-inventory id being followed (e.g. ONE_MOVE_PER_STATE, TRANSITION_CONDITION_FAMILIES). basis sanctioned-extension: name the standing extension (e.g. 'fast/slow + transition points — Dan 2026-08-21'). basis extension: null>",
      "justification": "<basis extension ONLY: 'no template example — extending per SDC style because X'>" }
  ],
  "reviewFlags": [ "<*Replace/*Verify item or design decision the CE must review>" ],
  "stateMachines": [
    { "name": "<one coordinated state machine in this plan, e.g. 'Dial index' or 'Pick head'>",
      "oneLiner": "<ONE short sentence: what this machine owns>",
      "programName": "<SDC program name per the naming standard: S{nn}_{Descriptive} on an
        indexing machine (the dial/indexer SM takes S00_, heads take their station-position
        numbers upstream->downstream), P{nn}_{Descriptive} for non-indexing processes>",
      "states": [ <MULTI-SM COMPILES ONLY: this machine's complete state list, same
        schema as the top-level "states" — each machine numbers its OWN grid from 4> ],
      "transitions": [ <same schema as top-level "transitions">, ... ],
      "waits": [ <same schema as top-level "waits">, ... ],
      "handshakes": [ <same schema as top-level "handshakes" — this machine's declared
        inter-SM signals; "partner" names the other planned machine>, ... ] }
  ],
  "questions": [ { "domain": "controls"|"jarvis",
      "question": "<GENERAL SDC-standards question that PASSES the self-answer test — usually empty; never geometry>",
      "proposedSolution": "<REQUIRED with every question: YOUR best answer, 1-3 sentences. SDC culture (Dan): 'here's the situation, here's my proposed answer — do you like it or should I change it?' It doesn't have to be right; it has to be your honest best idea. A question with no proposedSolution is a contract violation.>" } ],
  "summary": "<AT MOST 5 short sentences / ~80 words, plain English: what the cycle does, how it recovers, what talks to the supervisor. This is read in ten seconds by the mechanical engineer — never a paragraph-by-paragraph walkthrough; the states/transitions carry the detail>"
}

Rules:
- State numbers — FLOW ORDER OWNS THE GRID (Jason Perry review, 2026-08-24):
  number the MAIN FLOW in strictly ascending +${STATE_STEP} steps from ${STATE_BASE}
  (start of sequence) to cycle complete. A state you synthesize into the middle
  of the flow (a confirm/wait between stroke segments, any splice) takes its
  INLINE flow position and every downstream state SHIFTS UP — the sequence
  reads 10 → 13 → 16, never 10 → 52 → back to 13. Drawn states' assigned
  numbers are a starting layout, not a contract: shift them when a splice
  demands it (the diagram joins on sourceNodeId, never on the number). Only
  genuine SIDE paths (recovery excursions off the main flow) take the next
  free numbers after the main sequence, like the indexer's 31/34/37; only
  loop-backs (retry, next cycle) may transition numerically backward. Max 97;
  99 is lockout, 100-127 is the template init block — never author states
  there; reference them in conditionText only where the template law requires
  (e.g. init-complete 124/127 entry). Inline flow order is also mechanically
  enforced after compile — out-of-flow numbering is renumbered and flagged.
- stateMachines — THE ASYNCHRONY TEST (CE standard, Program Structure section:
  "Asynchronous sequences should be separated into multiple programs. Each
  program must have no more than one state machine."): if any two sequences of
  this station can be doing work AT THE SAME MOMENT (a shuttle strips the next
  part WHILE a head presents the current one, a dial indexes WHILE heads work),
  or the ME explicitly asks for multiple state machines, you MUST decompose:
  one stateMachines[] entry per asynchronous sequence, each carrying its OWN
  complete states/transitions/waits/handshakes (each machine's grid starts at
  ${STATE_BASE} — state numbers are per-program) and an SDC programName. In a
  multi-SM compile the TOP-LEVEL states/transitions/waits/handshakes MUST be
  empty arrays — every state lives inside its machine. Handshake signals
  between the planned machines are parameters and must appear on BOTH sides:
  the producer's handshakes (direction "out", set/clear states) and the
  consumer's handshakes (direction "in") + the wait/transition that consumes
  them. Compiling a concurrent station as ONE interleaved state machine
  violates the standard and is a defect (SUPREME LAW). Sequences that merely
  alternate (strictly serialized by the mechanism) are ONE machine — do not
  decompose synchronous work. A single-sequence station keeps the current
  shape: top-level states/transitions/etc., and stateMachines omitted or one
  name+oneLiner entry for the spec sheet.
  THE ME'S EXPECTED DECOMPOSITION: when the MACHINE SPEC carries the ME's
  expected state machines, weigh it seriously against the asynchrony test —
  agree where the test supports it, counter where it does not. Your decision
  must SHOW the reasoning: a decomposition that differs from their expectation
  adds ONE reviewFlag naming the expectation and the asynchrony-test reasoning
  for the difference (deviation-handshake spirit). Never silently ignore the
  expectation; never blindly obey it.
- EVERY wait must list ALL its exits: the success path, one exit per partner
  failure mode declared in the MACHINE SPEC, and a timeout path (standard
  Control.FaultTime 5000ms unless the spec says otherwise). NO EXITLESS WAITS.
- Every transition needs concrete conditionText in SDC tag idioms — real tag
  names per SDC naming (i_/q_/p_ prefixes, {Name}ExtendDelay timers,
  \\\\PartnerProgram.p_Signal cross-program refs). Never vague prose.
- AXIS NAMING (Jason Perry review, 2026-08-24): servo axes are named by their
  single-letter machine direction in every generated identifier — XAxis
  (horizontal traverse), ZAxis (vertical), YAxis, RAxis (rotary) — never the
  ME's descriptive words (HorizontalAxis/VerticalAxis are defects). Map the
  description to the letter once and use the letter in routine names, HMI_
  tags, parameters, RangeCheck instances, and alarm text; the ME's descriptive
  name belongs only in comments/labels where it helps the reader.
- Retry counters: name them, state where they increment and reset, and give the
  exhaustion branch its own transition (GEQ n).
- Handshake signals (p_*) must appear on BOTH sides: the action that latches/
  unlatches them and the wait/transition that consumes them.
- Questions: apply the self-answer test with maximum strictness. YOU ARE THE
  CONTROLS ENGINEER (Dan, 2026-08-22 — no per-station CE review exists):
  DECIDE-AND-RECORD is the default for every controls choice — decide it and
  put the decision in reviewFlags, reviewable after the fact. A question is
  the exception, reserved for a genuinely GENERAL "how does SDC want this
  done" standards unknown that standing knowledge does not answer AND whose
  choice is consequential. Phrase it PROJECT-AGNOSTICALLY (it lands in the
  leads' queue, not on this station) and tag its domain: "controls" for
  SDC-standards questions, "jarvis" for tool/meta requests to Dan.
- THE MECHANICAL/CONTROLS BOUNDARY (Dan's law — the ServoPNP incident):
  geometry and mechanical intent (positions, heights, clearances, distances,
  transition/blend-start values, strokes, home-vs-pick posture) are NEVER
  compile questions — those answers live in the MECHANICAL MODEL and are asked
  of the ME at spec time or read from the spec's tables. If the spec's
  position/device tables already contain the value, USE IT — asking for it is
  a defect. When a geometry value is genuinely absent here, pick the
  SDC-standard placeholder, use it, and add a "*Verify …" reviewFlag naming
  the value the ME must confirm. A compile question about geometry is always
  wrong; domain "mechanical" must never appear in your questions.
- Motion intent is data, not prose: every ServoMove action carries
  positionName, speedProfile (when the device has more than one), and advance
  ('complete' | 'wideband' | 'inflight').
  MULTI-SPEED STROKES USE THE MCD ARCHITECTURE (Jason Perry's correction of
  build b_mt7qbdtl_7i0izo, 2026-08-25 — supersedes the older two-MAM segment
  split): a stroke the spec calls fast-then-slow is ONE MAM commanded to the
  FINAL target, with the speed changed on the fly by an MCD at the transition
  point — never a second MAM, never a decel-to-zero at the transition. Plan it
  as THREE states: (1) the ServoMove state — positionName = the FINAL target,
  speedProfile = the STARTING profile, advance:'inflight' (exit on MAM.IP);
  (2) a synthesized wait state whose exit conditionText is the transition
  position's bare {Axis}{Transition}.InPosWide (the axis is mid-flight —
  MAM.PC/.InPos are wrong here); (3) a synthesized speed-change segment state
  carrying operation "ServoSpeedChange" (deviceName + speedProfile = the NEW
  profile) — the translator keys the axis's MCD rung on these states and they
  are NOT in the axis's MAM state list — exiting on strict MAM.PC +
  {Target}.InPos (or the wideband OR at a sanctioned blend corner).
  A blended/rounded corner is advance:'wideband' on the travel move whose
  clearance permits the next axis to start early; grips/releases/process
  actions are always advance:'complete'. Wideband transitions' conditionText
  uses the template idiom [Axis_MAM.PC + {Pos}.InPos , Axis_MAM.IP + {Pos}.InPosWide].
  CORNER-BASED BLEND VALUES (Dan's sketch, 2026-08-24): the pick-place path's
  two corners are INDEPENDENT — the axis table may carry PickRetractBlend and
  PlaceRetractBlend (mm) as named values. The pick-side corner (exit from
  pick: the vertical rising to Retract, traverse starts inside the zone) uses
  PickRetractBlend as its wide deadband; the place-side corner (approach:
  traverse finishing, vertical starts down) uses PlaceRetractBlend. When only
  a legacy {Level}WideBand value exists, it applies to both corners.
  SPEED WINDOWS DO NOT EXIST (Dan, 2026-08-24 final): there are NO
  {Pos}TransitionWideBand values and no windows of any kind besides the two
  corner blends. The speed change at a transition point fires MID-FLIGHT on
  the transition position's {Pos}.InPosWide (the MCD segment state entry —
  Jason 2026-08-25); strict [Axis_MAM.PC + {Pos}.InPos] is reserved for the
  stroke's FINAL target and for grips/releases. The
  vertical axis has exactly TWO speed-transition points (PickTransition,
  PlaceTransition — ME-facing name "Pick/Place speed transition"); the
  horizontal PNP axis has NONE, ever — it decelerates naturally on its
  accel/decel settings. Never invent transition or window points on it.
- STRUCTURAL FIDELITY (two altitudes): sequence LOGIC is yours — think freely
  about states, transitions, recovery, retries. Rung EXPRESSION speaks SDC:
  never design a sequence that forces the translator to invent a rung shape
  when the template family already has one; if a genuinely new expression
  pattern seems necessary, flag it as "PROPOSED NON-STANDARD PATTERN: …" in
  reviewFlags instead of implying it silently. MAM only
  executes on its rung going false→true and state bits swap atomically, so
  BACK-TO-BACK DISTINCT MOVES ON THE SAME AXIS (two consecutive states each
  commanding a genuinely separate move — e.g. the indexer's repeat index
  moves) require the template family's trigger/wait split: synthesize a
  wait/confirm state between the two move states (the indexer's "Trigger
  Index" -> "Wait For Index Complete" shape) so the motion command rung drops
  false and the next move re-triggers naturally. Fast/slow SEGMENTS OF ONE
  PHYSICAL STROKE are NOT two moves — they are ONE MAM plus an MCD speed
  change (see MULTI-SPEED STROKES above; Jason 2026-08-25). Never rely on
  (or imply) per-state one-shot trigger latches — they are a defect.
- TEMPLATE CONSULTATION IS MANDATORY (the templateConformance contract): for
  EVERY structural decision — state granularity (how work splits into states,
  especially servo strokes), motion trigger shape, staging structure,
  transition condition form, R02 ordering — you must either (a) cite the
  matching TEMPLATE PATTERN INVENTORY id you are following ("basis":
  "template"), or (b) declare the extension explicitly. An uncited structural
  choice is a DEFECT: the compile is rejected. Two extension kinds:
  * "sanctioned-extension" — a standing, already-approved extension of the
    template (fast/slow speeds + transition points per Dan 2026-08-21 is one:
    cite it, use it, do NOT re-question or re-flag it).
  * "extension" — genuinely new: justification REQUIRED ("no template example
    — extending per SDC style because X") AND a matching
    "PROPOSED NON-STANDARD PATTERN: …" reviewFlag.
  One entry per structural decision KIND is enough (e.g. one entry covering
  all servo stroke splits) — not one per state.
- ONE MOVE PER STATE is a derived template invariant (each axis has ONE auto
  MAM that edge-fires once per state; the staging rung maps each state to
  exactly one Positions[i]): a state may carry AT MOST ONE ServoMove per
  axis. A multi-speed stroke is still multiple STATES (command / wait /
  speed-change segment) but only the FIRST commands the MAM — the segment
  states carry the MCD speed change, never a second ServoMove. Two axes in
  one state is legitimate ONLY as permissive-gated overlap (the wideband
  corner) — a "move A then move B" chain is two states, expressed as a
  transition.
- R02 ORDER: generated R02 rungs are laid out in ASCENDING state-number order
  (side-path states sit at their numeric position, like the indexer's
  31/34/37 recovery states), with the lockout/init/fault/manual/safety
  override block after all sequence rungs. Because flow order owns the grid
  (above), the main flow's rungs also READ in flow order; only retry/next-
  cycle loop-backs and side-path entries jump numerically.
`;

// ── Mechanical validation of the compiled IR ────────────────────────────────

function onGrid(n) {
  return Number.isInteger(n) && n >= STATE_BASE && n <= 97 && (n - STATE_BASE) % STATE_STEP === 0;
}

// ── Inline flow-order renumbering (Jason Perry's review of v5, 2026-08-24) ──
//
// "States 52/55/58/61 were added out of order — the sequence must go
// 10 → 13 → 16": synthesized/confirm states take their FLOW position on the
// +3 grid and downstream states shift up; they are never appended at high
// numbers the flow jumps out to and back from. This pass makes that
// MECHANICAL: after normalization, sequence states are renumbered in flow
// order (DFS from the initial state over 'sequence'-kind transitions,
// branch ties broken by the compiler's own numbers), side-path states take
// the numbers after the main flow, and every numeric reference — transitions,
// waits, entryFrom, Status.State[n] tokens and "state N" prose in condition
// text — is remapped in one atomic pass.

/** MAIN-FLOW edge — the single definition shared by the renumberer and the
 *  flow-order self-check (they MUST agree: the check must never flag a shape
 *  the renumberer deliberately produces — Dan, 2026-08-25, the Magnet Dial
 *  round where a legal recovery excursion [13→37 fail, 37→34 abandoned] was
 *  flagged as out-of-flow). Sequence and wait kinds continue the main flow;
 *  PASS branches continue it too (the success path IS the flow). Fail/retry
 *  branches, recovery and timeout edges are SIDE excursions — their states
 *  legitimately sit after the main flow and re-enter it backward (the
 *  indexer's 31/34/37 shape). */
function isMainFlowEdge(t) {
  if (!t) return false;
  if (!t.kind || t.kind === 'sequence' || t.kind === 'wait') return true;
  if (t.kind === 'branch') return t.branch === 'pass' || t.branch == null;
  return false; // recovery, timeout
}

function renumberInlineOnGrid(ir) {
  const states = Array.isArray(ir.states) ? ir.states : [];
  const transitions = Array.isArray(ir.transitions) ? ir.transitions : [];
  const seq = states.filter(s => Number.isInteger(s.stateNumber) &&
    s.stateNumber >= STATE_BASE && s.stateNumber <= 97);
  if (seq.length < 2) return { changed: [] };

  const seqNums = new Set(seq.map(s => s.stateNumber));
  const out = new Map(); // stateNumber -> [transition]
  for (const t of transitions) {
    if (!seqNums.has(t.fromState) || !seqNums.has(t.toState)) continue;
    if (!out.has(t.fromState)) out.set(t.fromState, []);
    out.get(t.fromState).push(t);
  }

  // Main flow first: DFS over sequence-kind transitions from the initial
  // state; branch order = the compiler's own numbering (lower first), so
  // pass-before-fail layouts keep their intent. Side paths (reached only via
  // timeout/recovery/other kinds, or unreachable) are appended after the main
  // flow in their existing numeric order — the indexer's 31/34/37 shape.
  const isMainKind = isMainFlowEdge;
  const start = seq.find(s => s.isInitial) || seq.reduce((a, b) => (a.stateNumber < b.stateNumber ? a : b));
  const order = [];
  const visited = new Set();
  const stack = [start.stateNumber];
  while (stack.length) {
    const n = stack.pop();
    if (visited.has(n)) continue;
    visited.add(n);
    order.push(n);
    const nexts = (out.get(n) || [])
      .filter(isMainKind)
      .map(t => t.toState)
      .filter(m => !visited.has(m))
      .sort((a, b) => a - b);
    for (let i = nexts.length - 1; i >= 0; i--) stack.push(nexts[i]);
  }
  for (const s of seq.slice().sort((a, b) => a.stateNumber - b.stateNumber)) {
    if (!visited.has(s.stateNumber)) { visited.add(s.stateNumber); order.push(s.stateNumber); }
  }

  const map = new Map(); // old -> new
  order.forEach((oldN, i) => map.set(oldN, STATE_BASE + i * STATE_STEP));
  const changed = [...map.entries()].filter(([o, n]) => o !== n).map(([o, n]) => ({ from: o, to: n }));
  if (!changed.length) return { changed };

  const mapNum = n => (map.has(n) ? map.get(n) : n);
  // Single-pass token remap — each token is rewritten from the OLD->NEW map
  // atomically, so chains like 13->16 and 16->19 cannot cascade.
  const mapText = (s) => String(s || '')
    .replace(/Status\.State\[(\d+)\]/g, (m0, n) => (map.has(+n) ? `Status.State[${map.get(+n)}]` : m0))
    .replace(/\bstate\s+(\d+)\b/gi, (m0, n) => (map.has(+n) ? m0.replace(n, String(map.get(+n))) : m0));

  for (const s of states) {
    if (map.has(s.stateNumber)) s.stateNumber = map.get(s.stateNumber);
    if (Array.isArray(s.entryFrom)) s.entryFrom = s.entryFrom.map(mapNum).sort((a, b) => a - b);
  }
  for (const t of transitions) {
    t.fromState = mapNum(t.fromState); t.toState = mapNum(t.toState);
    t.from = t.fromState; t.to = t.toState;
    if (t.conditionText) t.conditionText = mapText(t.conditionText);
  }
  for (const w of ir.waits || []) {
    w.stateNumber = mapNum(w.stateNumber);
    for (const x of w.exits || []) { x.toState = mapNum(x.toState); if (x.when) x.when = mapText(x.when); }
  }
  for (const h of ir.handshakes || []) {
    if (Number.isInteger(h.setAtState)) h.setAtState = mapNum(h.setAtState);
    if (Number.isInteger(h.clearAtState)) h.clearAtState = mapNum(h.clearAtState);
  }
  states.sort((a, b) => a.stateNumber - b.stateNumber);
  if (ir.stateRanges && ir.stateRanges.sequence) {
    const nums = states.map(s => s.stateNumber).filter(n => Number.isInteger(n) && n <= 97);
    ir.stateRanges.sequence.to = nums.length ? Math.max(...nums) : ir.stateRanges.sequence.to;
  }
  return { changed };
}

/**
 * Mechanical checks on ONE machine's sequence: grid discipline, transition
 * integrity, flow order, one-move-per-state, and the no-exitless-waits rule.
 * Called once for a single-SM compile, once per machine for a multi-SM
 * decomposition. Pure function.
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateMachineCore(ir) {
  const errors = [];
  const warnings = [];
  const states = Array.isArray(ir.states) ? ir.states : [];
  const transitions = Array.isArray(ir.transitions) ? ir.transitions : [];
  const waits = Array.isArray(ir.waits) ? ir.waits : [];

  if (!states.length) errors.push('Compiled sequence has no states');
  const seen = new Set();
  for (const s of states) {
    if (!onGrid(s.stateNumber)) {
      errors.push(`State "${s.label}" has number ${s.stateNumber} — not on the SDC grid (${STATE_BASE},${STATE_BASE + STATE_STEP},… max 97)`);
    }
    if (seen.has(s.stateNumber)) errors.push(`Duplicate state number ${s.stateNumber}`);
    seen.add(s.stateNumber);
  }
  const initials = states.filter(s => s.isInitial);
  if (initials.length !== 1) warnings.push(`Expected exactly 1 initial state, found ${initials.length}`);
  if (!states.some(s => s.isComplete)) warnings.push('No cycle-complete state marked');

  const known = new Set(states.map(s => s.stateNumber));
  // Template override/idle states are legal transition endpoints: 0 safety
  // stop, 1 manual, 2/3 auto idle, 99 lockout, 100-127 init/fault — recovery
  // entries from state 2 and fault-reset 127→2 are the template's own shape.
  const legalRef = n => known.has(n) || n === 0 || n === 1 || n === 2 || n === 3 || n === 99 || (n >= 100 && n <= 127);
  const outgoing = new Map(); // stateNumber -> [transition]
  for (const t of transitions) {
    if (!legalRef(t.fromState)) errors.push(`Transition from unknown state ${t.fromState} ("${t.fromLabel || '?'}")`);
    if (!legalRef(t.toState)) errors.push(`Transition to unknown state ${t.toState} ("${t.toLabel || '?'}")`);
    if (!String(t.conditionText || '').trim()) {
      errors.push(`Transition [${t.fromState}]->[${t.toState}] has no conditionText`);
    }
    if (!outgoing.has(t.fromState)) outgoing.set(t.fromState, []);
    outgoing.get(t.fromState).push(t);
  }

  // Flow order (Jason Perry review, 2026-08-24): walking the MAIN flow, state
  // numbers strictly ascend. The defect signature is the sandwich — the flow
  // runs a → X → b with a < b < X (state X spliced out of numeric order).
  // MAIN-FLOW EDGES ONLY (isMainFlowEdge — the same definition the renumberer
  // uses, so this check can never flag a shape the renumberer produced): side
  // excursions (fail/retry branches, recovery, timeout) legally sit after the
  // main flow and re-enter it backward — the indexer's 31/34/37 shape.
  {
    const seqNums = new Set(states.filter(s => onGrid(s.stateNumber)).map(s => s.stateNumber));
    const inc = new Map(), outg = new Map();
    for (const t of transitions) {
      if (!isMainFlowEdge(t)) continue;
      if (!seqNums.has(t.fromState) || !seqNums.has(t.toState) || t.fromState === t.toState) continue;
      if (!inc.has(t.toState)) inc.set(t.toState, new Set());
      inc.get(t.toState).add(t.fromState);
      if (!outg.has(t.fromState)) outg.set(t.fromState, new Set());
      outg.get(t.fromState).add(t.toState);
    }
    for (const [x, outs] of outg) {
      for (const b of outs) {
        if (b >= x) continue;
        for (const a of inc.get(x) || new Set()) {
          if (a < b) {
            errors.push(`Flow order: the sequence runs ${a} → ${x} → back to ${b} — state ${x} sits out of flow ` +
              'order; synthesized states are renumbered INLINE on the +3 grid with downstream states shifted up ' +
              '(Jason Perry review, 2026-08-24)');
          }
        }
      }
    }
  }

  // Every non-complete state must have at least one exit.
  for (const s of states) {
    if (s.isComplete) continue;
    if (!(outgoing.get(s.stateNumber) || []).length) {
      errors.push(`State ${s.stateNumber} ("${s.label}") has no outgoing transition`);
    }
  }

  // One move per state — the derived template invariant that caught the
  // multi-move incident (Dan, Aug 2026). Same check runs again at L5X
  // validation; here it kills the defect before the engineer even reviews.
  const omps = checkOneMovePerState(ir);
  errors.push(...omps.errors);
  warnings.push(...omps.warnings);

  // No exitless waits: every wait must have a non-success exit — a timeout/
  // recovery transition, or a fail/retry branch, or a condition mentioning a
  // timeout/fault/exhaustion path.
  const ESCAPE = /timeout|fault|retry|exhaust|abort|giveup|gave.?up|geq|fail/i;
  for (const w of waits) {
    const outs = outgoing.get(w.stateNumber) || [];
    if (!outs.length) {
      errors.push(`Wait at state ${w.stateNumber} ("${w.signal || '?'}") has NO exits at all`);
      continue;
    }
    const hasEscape = outs.some(t =>
      t.kind === 'timeout' || t.kind === 'recovery' ||
      t.branch === 'fail' || t.branch === 'retry' ||
      ESCAPE.test(String(t.conditionText || '') + ' ' + String(t.outcomeLabel || '')));
    if (!hasEscape) {
      // The SDC standard's blanket escape: every state carries the per-state
      // fault timer (Control.FaultTime, 5000ms default) -> R20 alarm -> state
      // 127. When the plan carries that fault path, a wait with only success
      // exits is covered by the blanket — note it, don't block on it.
      const hasFaultBlanket = transitions.some(t =>
        t.toState === 127 || t.fromState === 127 ||
        /q_AlarmActive|FaultReset|TimeoutFlt|FaultTime/i.test(String(t.conditionText || '')));
      if (hasFaultBlanket) {
        warnings.push(`Wait at state ${w.stateNumber} ("${w.signal || '?'}") has only success exits — covered by the standard per-state fault timer (Control.FaultTime -> R20 -> 127); confirm R20 carries a named waiting alarm for it`);
      } else {
        errors.push(`Exitless wait: state ${w.stateNumber} waits on "${w.signal || '?'}" with only success exits — needs a timeout/partner-failure path (no-exitless-waits rule)`);
      }
    }
  }

  return { errors, warnings };
}

/** Cross-machine handshake integrity for a multi-SM decomposition: every
 *  inter-SM signal must exist on BOTH sides — the producer's declaration and
 *  something on the partner that consumes/produces it (a handshake entry, a
 *  wait, a transition condition, or an action). Partners that are not planned
 *  machines (robot, supervisor, other stations) are out of scope here. */
function validateCrossMachineHandshakes(machines, errors) {
  const byName = new Map();
  for (const m of machines) {
    for (const key of [m.name, m.programName].filter(Boolean)) {
      byName.set(String(key).toLowerCase(), m);
    }
  }
  const mentionsSignal = (m, signal) => {
    if (!signal) return false;
    if ((m.handshakes || []).some(h => h.signal === signal)) return true;
    if ((m.waits || []).some(w => w.signal === signal ||
      (w.exits || []).some(x => String(x.when || '').includes(signal)))) return true;
    if ((m.transitions || []).some(t => String(t.conditionText || '').includes(signal))) return true;
    if ((m.states || []).some(s => (s.actions || []).some(a =>
      String(a.detail || '').includes(signal)))) return true;
    return false;
  };
  for (const m of machines) {
    for (const h of (m.handshakes || [])) {
      if (!h.partner) continue;
      const partner = byName.get(String(h.partner).toLowerCase());
      if (!partner || partner === m) continue;
      if (!mentionsSignal(partner, h.signal)) {
        errors.push(`Handshake ${h.signal || '(unnamed)'} (${m.name} ↔ ${h.partner}) has no counterpart on ` +
          `${h.partner} — inter-SM signals are parameters and must appear on BOTH sides ` +
          '(the producer\'s set/clear and the consumer\'s wait/transition)');
      }
    }
  }
}

/**
 * Mechanical checks on a compiled IR — single-SM or multi-SM decomposition.
 * Multi (ir.multiSm): each machine is validated independently on its own
 * grid, program names must follow the SDC S{nn}_/P{nn}_ convention, and
 * inter-SM handshake signals must exist on both sides.
 * Pure function — also used by tests.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateCompiledIR(ir) {
  const errors = [];
  const warnings = [];
  const machines = Array.isArray(ir.stateMachines) ? ir.stateMachines : [];
  let hasStructure;

  if (ir.multiSm) {
    if (machines.length < 2) {
      errors.push('Multi-SM compile with fewer than 2 machines — the asynchrony test decomposition needs one machine per concurrent sequence');
    }
    for (const m of machines) {
      const core = validateMachineCore(m);
      const tag = `[${m.name || m.programName || 'machine'}] `;
      errors.push(...core.errors.map(e => tag + e));
      warnings.push(...core.warnings.map(w => tag + w));
    }
    // Program naming — one SM per program, named per the CE standard.
    const seenNames = new Set();
    for (const m of machines) {
      if (!m.programName) {
        errors.push(`[${m.name || 'machine'}] has no programName — one SM per program requires an SDC program name (S{nn}_{Descriptive} / P{nn}_{Descriptive})`);
      } else {
        if (!/^[SP]\d{2}_[A-Za-z0-9_]+$/.test(m.programName)) {
          warnings.push(`[${m.name}] programName "${m.programName}" does not match the SDC S{nn}_/P{nn}_ convention`);
        }
        if (seenNames.has(m.programName)) errors.push(`Duplicate programName "${m.programName}"`);
        seenNames.add(m.programName);
      }
    }
    validateCrossMachineHandshakes(machines, errors);
    hasStructure = machines.some(m =>
      (m.states || []).some(s => (s.actions || []).length) || (m.transitions || []).length);
  } else {
    const core = validateMachineCore(ir);
    errors.push(...core.errors);
    warnings.push(...core.warnings);
    hasStructure = (Array.isArray(ir.states) ? ir.states : []).some(s => (s.actions || []).length) ||
      (Array.isArray(ir.transitions) ? ir.transitions : []).length > 0;
  }

  // Template consultation contract: every structural decision cites a
  // pattern or declares an extension. Uncited structural choices are a
  // defect (Dan, Aug 2026). One record for the whole station (multi-SM
  // decompositions share it).
  const conf = Array.isArray(ir.templateConformance) ? ir.templateConformance : [];
  if (hasStructure && !conf.length) {
    errors.push('templateConformance is empty — every structural decision (state granularity, trigger shape, staging, transition condition form, ordering) must cite its template pattern or declare an extension (template consultation is mandatory)');
  }
  for (const c of conf) {
    const basis = String(c.basis || '');
    if (!String(c.decision || '').trim()) {
      errors.push('templateConformance entry with no decision text');
    }
    if (basis === 'template' && !String(c.citation || '').trim()) {
      errors.push(`templateConformance "${c.decision}" claims basis "template" but cites no pattern — an uncited structural choice is a defect`);
    }
    if (basis === 'extension' && !String(c.justification || '').trim()) {
      errors.push(`templateConformance "${c.decision}" is an extension with no justification — declare "no template example — extending per SDC style because X"`);
    }
    if (!['template', 'sanctioned-extension', 'extension'].includes(basis)) {
      errors.push(`templateConformance "${c.decision}" has unknown basis "${basis}"`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Normalization + rendering ────────────────────────────────────────────────

/** Normalize ONE machine's parsed states/transitions/waits/handshakes into
 *  compiled-IR shape. Used for the single-SM top level AND for each entry of
 *  a multi-SM decomposition (Dan's Magnet Dial round, 2026-08-25 — the
 *  asynchrony test: concurrent sequences are separate SMs/programs). */
function normalizeMachineParts(parsed, baseIr, sourceNodeWarnings) {
  // SOURCE NODE IDS (shell-agent fix, 2026-08-22): each compiled state carries
  // the DRAWN diagram node id it implements (sourceNodeId) so UI views can
  // join compiled states to drawn nodes by stable id — never by state number
  // (numbers can shift). The model must copy ids verbatim from the diagram
  // IR; anything not in the drawn set (the old "state4"-style inventions) is
  // coerced to null (synthesized) and reported as a warning. Older prompt
  // shapes that used "nodeId" are accepted. Backward compat: stored compiles
  // without the field simply have no sourceNodeId — readers treat it as
  // optional.
  const drawnIds = new Set((baseIr.states || []).map(s => s.nodeId).filter(Boolean));
  const resolveSourceNodeId = (s) => {
    const claimed = s.sourceNodeId ?? s.nodeId ?? null;
    if (claimed == null || claimed === '') return null;
    if (drawnIds.has(claimed)) return claimed;
    sourceNodeWarnings.push(
      `State ${s.stateNumber} ("${s.label}") claims sourceNodeId "${claimed}" which is not a drawn node id — treated as synthesized (ids must be copied verbatim from the diagram IR)`);
    return null;
  };
  const states = (parsed.states || []).map(s => {
    const sourceNodeId = resolveSourceNodeId(s);
    return {
    nodeId: sourceNodeId,          // legacy alias — existing consumers read nodeId
    sourceNodeId,                  // the drawn node this state implements (null = synthesized)
    synthesized: s.synthesized === true || !sourceNodeId,
    type: 'compiledState',
    label: String(s.label || ''),
    stateNumber: Number(s.stateNumber),
    isInitial: !!s.isInitial,
    isComplete: !!s.isComplete,
    actions: (s.actions || []).map(a => {
      const dev = (baseIr.devices || []).find(d =>
        d.name === a.deviceName || d.displayName === a.deviceName);
      // Motion intent travels as structured data (speed/transition/blend can
      // never silently drop between compile and translation — Jason, Aug 2026).
      const params = {};
      if (a.positionName) params.positionName = String(a.positionName);
      if (a.speedProfile) params.speedProfile = String(a.speedProfile);
      if (a.advance) params.advance = String(a.advance);
      const motionBits = [
        params.positionName ? `position=${params.positionName}` : null,
        params.speedProfile ? `speed=${params.speedProfile}` : null,
        params.advance ? `advance=${params.advance}` : null,
      ].filter(Boolean).join(' ');
      return {
        operation: String(a.operation || ''),
        deviceId: dev ? dev.id : null,
        deviceName: a.deviceName || null,
        device: dev ? (dev.displayName || dev.name) : (a.deviceName || null),
        params,
        detail: [String(a.detail || ''), motionBits].filter(Boolean).join(' | '),
      };
    }),
    entryFrom: [],
    };
  }).sort((a, b) => a.stateNumber - b.stateNumber);

  const transitions = (parsed.transitions || []).map(t => ({
    fromLabel: t.fromLabel || null,
    toLabel: t.toLabel || null,
    fromState: Number(t.fromState),
    toState: Number(t.toState),
    from: Number(t.fromState),
    to: Number(t.toState),
    conditionType: null,
    label: t.outcomeLabel || null,
    outcomeLabel: t.outcomeLabel || null,
    branch: t.branch || null,
    conditionText: String(t.conditionText || ''),
    kind: t.kind || 'sequence',
  }));

  const byNumber = new Map(states.map(s => [s.stateNumber, s]));
  for (const t of transitions) {
    const target = byNumber.get(t.toState);
    if (target && !target.entryFrom.includes(t.fromState)) target.entryFrom.push(t.fromState);
  }
  for (const s of states) s.entryFrom.sort((a, b) => a - b);

  const waits = (parsed.waits || []).map(w => ({
    stateNumber: Number(w.stateNumber),
    signal: w.signal || null,
    source: w.source || null,
    partner: w.partner || null,
    direction: w.direction || 'incoming',
    mode: w.mode || 'wait',
    exits: (w.exits || []).map(x => ({ toState: Number(x.toState), when: String(x.when || '') })),
  }));

  const handshakes = (parsed.handshakes || []).map(h => ({
    signal: h.signal || '', direction: h.direction || 'out', partner: h.partner || null,
    purpose: h.purpose || '', setAtState: h.setAtState ?? null, clearAtState: h.clearAtState ?? null,
  }));

  return { states, transitions, waits, handshakes };
}

/** Fold the model's compiled object + the deterministic base IR into one
 *  irVersion-1 compiled IR the engineer reviews and Generate translates.
 *
 *  TWO SHAPES (the asynchrony test — CE standard "each program must have no
 *  more than one state machine"; Dan's Magnet Dial round, 2026-08-25):
 *  - single-SM: parsed.states/transitions/waits/handshakes at the top level
 *    (the original shape, unchanged byte-for-byte for existing stations);
 *  - multi-SM:  two or more parsed.stateMachines[] entries each carrying
 *    their OWN states/transitions/waits/handshakes → ir.multiSm = true,
 *    ir.stateMachines = full per-machine sub-sequences (each independently
 *    flow-renumbered on its own grid), top-level sequence arrays empty. */
function normalizeCompiledIR(parsed, baseIr) {
  const warnings = [];
  const machineEntries = (Array.isArray(parsed.stateMachines) ? parsed.stateMachines : [])
    .filter(x => x && typeof x === 'object');
  const carriers = machineEntries.filter(m => Array.isArray(m.states) && m.states.length);
  const multiSm = carriers.length >= 2;

  // One carrier + empty top level = the model put a single machine inside the
  // decomposition field — fold it back to the single-SM shape.
  let topParsed = parsed;
  if (!multiSm && carriers.length === 1 && !(Array.isArray(parsed.states) && parsed.states.length)) {
    topParsed = {
      ...parsed,
      states: carriers[0].states,
      transitions: carriers[0].transitions || [],
      waits: carriers[0].waits || [],
      handshakes: carriers[0].handshakes || parsed.handshakes || [],
    };
    warnings.push('Compile returned one stateMachines[] carrier with an empty top level — folded into the single-machine shape');
  }

  let states = [], transitions = [], waits = [], handshakes = [];
  let machines = [];
  if (multiSm) {
    machines = machineEntries.map((m, i) => {
      const parts = normalizeMachineParts(m, baseIr, warnings);
      const sub = {
        name: String(m.name || `Machine ${i + 1}`).trim(),
        oneLiner: String(m.oneLiner || '').trim(),
        programName: String(m.programName || '').trim() || null,
        ...parts,
      };
      // Each machine is independently flow-renumbered on its own +3 grid
      // (state numbers are per-program).
      const renum = renumberInlineOnGrid(sub);
      if (renum.changed.length) {
        warnings.push(`[${sub.name}] Inline flow-order renumbering applied: ` +
          renum.changed.map(c => `${c.from}→${c.to}`).join(', '));
      }
      return sub;
    });
    if (Array.isArray(parsed.states) && parsed.states.length) {
      warnings.push('Multi-SM compile also returned top-level states — ignored (every state must live inside its machine)');
    }
  } else {
    ({ states, transitions, waits, handshakes } = normalizeMachineParts(topParsed, baseIr, warnings));
  }

  const assigned = (multiSm ? machines.flatMap(m => m.states) : states)
    .map(s => s.stateNumber).filter(Number.isFinite);
  const ir = {
    irVersion: IR_VERSION,
    compiled: true,                       // marks this as a Build-time compiled sequence
    compilerVersion: COMPILER_VERSION,
    smId: baseIr.smId,
    smName: baseIr.smName,
    displayName: baseIr.displayName,
    stationNumber: baseIr.stationNumber,
    description: baseIr.description,
    devices: baseIr.devices,
    // Multi-SM decomposition (one SM per program — CE standard). When true,
    // stateMachines[] carries the full per-machine sub-sequences and the
    // top-level sequence arrays are empty.
    multiSm,
    states,
    transitions,
    waits,
    handshakes,
    templateConformance: (parsed.templateConformance || []).map(c => ({
      decision: String(c.decision || ''),
      basis: String(c.basis || ''),
      citation: c.citation != null ? String(c.citation) : null,
      justification: c.justification != null ? String(c.justification) : null,
    })),
    reviewFlags: (parsed.reviewFlags || []).map(String),
    // SM decomposition ("STATE MACHINES (N)" on the spec sheet — Dan's Magnet
    // Dial round, 2026-08-25). Multi: the full sub-sequences (name/oneLiner
    // first, so the sheet's planned line reads them unchanged). Single: the
    // summary entries. Graceful absent everywhere.
    stateMachines: multiSm
      ? machines
      : machineEntries
        .map(x => ({
          name: String((x && x.name) || '').trim(),
          oneLiner: String((x && x.oneLiner) || '').trim(),
        }))
        .filter(x => x.name)
        .slice(0, 12),
    summary: String(parsed.summary || ''),
    stateRanges: {
      reserved: { powerup: 0, sdc: [1, 2, 3] },
      sequence: { from: STATE_BASE, to: assigned.length ? Math.max(...assigned) : null },
      lockout: 99,
      init: { from: 100, to: 127, cycleReady: 127 },
    },
    machineSpec: baseIr.machineSpec,
    generationScope: normalizeGenerationScope(baseIr.generationScope),
    // Seeded with normalization warnings (invalid sourceNodeId claims, fold/
    // renumber notes); compileSequence merges these into validation.warnings
    // and re-renders.
    warnings,
  };

  // Inline flow-order renumbering (Jason Perry review, 2026-08-24): the
  // mechanical guarantee that synthesized states never sit out of flow order.
  // (Multi-SM machines were each renumbered above.)
  if (!multiSm) {
    const renum = renumberInlineOnGrid(ir);
    if (renum.changed.length) {
      ir.warnings.push('Inline flow-order renumbering applied (synthesized states take their flow position, ' +
        'downstream states shift — Jason Perry review, 2026-08-24): ' +
        renum.changed.map(c => `${c.from}→${c.to}`).join(', '));
    }
  }

  ir.text = renderCompiledText(ir);
  return ir;
}

/** Render one machine's states/transitions/waits/handshakes sections.
 *  prefix distinguishes machines in a multi-SM decomposition ("[S00_DialIndex] "). */
function renderMachineSections(lines, m, prefix) {
  lines.push('', `## ${prefix}States (numbers are FINAL — approved by the engineer)`);
  for (const s of m.states || []) {
    const flags = [
      s.isInitial ? 'INITIAL' : null,
      s.isComplete ? 'CYCLE-COMPLETE' : null,
      s.synthesized ? 'SYNTHESIZED' : null,
    ].filter(Boolean).join(', ');
    lines.push(`- State ${s.stateNumber}: "${s.label}"` + (flags ? ` {${flags}}` : ''));
    for (const a of s.actions || []) {
      lines.push(`    action: ${a.operation} -> ${a.deviceName || '(signal)'}` +
        (a.detail ? ` (${a.detail})` : ''));
    }
  }

  lines.push('', `## ${prefix}Transitions (conditionText is the rung condition — implement exactly)`);
  for (const t of m.transitions || []) {
    const tag = [t.kind !== 'sequence' ? t.kind : null, t.branch ? `branch=${t.branch}` : null]
      .filter(Boolean).join(' ');
    lines.push(`- [${t.fromState}] -> [${t.toState}]${tag ? ` {${tag}}` : ''}: ${t.conditionText}`);
  }

  if ((m.waits || []).length) {
    lines.push('', `## ${prefix}Waits (every wait lists ALL its exits — no exitless waits)`);
    for (const w of m.waits) {
      lines.push(`- State ${w.stateNumber} waits on ${w.signal || '?'}` +
        (w.partner ? ` from ${w.partner}` : w.source ? ` (${w.source})` : '') + ` [${w.mode}]`);
      for (const x of w.exits || []) lines.push(`    exit -> [${x.toState}] when ${x.when}`);
    }
  }

  if ((m.handshakes || []).length) {
    lines.push('', `## ${prefix}Handshake signals`);
    for (const h of m.handshakes) {
      const set = h.setAtState != null ? ` set@${h.setAtState}` : '';
      const clr = h.clearAtState != null ? ` clear@${h.clearAtState}` : '';
      lines.push(`- ${h.signal} (${h.direction}${h.partner ? ` ${h.direction === 'out' ? '->' : '<-'} ${h.partner}` : ''})${set}${clr}: ${h.purpose}`);
    }
  }
}

/** Human-readable rendering of the compiled sequence — what the engineer
 *  reviews/edits and what the translation prompt receives verbatim. */
function renderCompiledText(ir) {
  const lines = [];
  lines.push(`# COMPILED SEQUENCE — ${ir.smName}` +
    (ir.displayName !== ir.smName ? ` (${ir.displayName})` : ''));
  lines.push(`Station number: ${ir.stationNumber} | Compiler: JARVIS v${ir.compilerVersion}`);
  if (ir.summary) lines.push('', ir.summary);

  lines.push('', '## Devices');
  for (const d of ir.devices || []) {
    lines.push(`- [${d.type}] ${d.name}` + (d.displayName !== d.name ? ` "${d.displayName}"` : ''));
    // Motion data must survive into the translation prompt (dropping it here
    // is how the fast/slow spec became single-speed code — Jason, Aug 2026).
    const ex = d.extras || {};
    if (Array.isArray(ex.positions) && ex.positions.length) {
      lines.push(`    positions: ${ex.positions.map(p => `${p.name}${p.isHome ? ' (home)' : ''}`).join(', ')}`);
    }
    if (Array.isArray(ex.speedProfiles) && ex.speedProfiles.length) {
      lines.push(`    speedProfiles: ${ex.speedProfiles.map((p, i) => `[${i}] ${p.name}`).join(', ')}`);
    }
  }

  if (ir.multiSm) {
    const machines = ir.stateMachines || [];
    lines.push('', `## State machine decomposition (${machines.length} programs — one SM per program, CE standard)`);
    lines.push('Asynchronous sequences are separate programs; each machine below numbers its');
    lines.push('OWN state grid. Inter-SM handshake signals are parameters and appear on both sides.');
    for (const m of machines) {
      lines.push(`- ${m.programName || m.name}: ${m.oneLiner || m.name}`);
    }
    for (const m of machines) {
      renderMachineSections(lines, m, `[${m.programName || m.name}] `);
    }
  } else {
    renderMachineSections(lines, ir, '');
  }

  if ((ir.templateConformance || []).length) {
    lines.push('', '## Template conformance (every structural choice cites its pattern or declares an extension)');
    for (const c of ir.templateConformance) {
      const tail = c.basis === 'template' ? `pattern ${c.citation}`
        : c.basis === 'sanctioned-extension' ? `sanctioned extension: ${c.citation || '(uncited)'}`
        : `EXTENSION — ${c.justification || '(no justification)'}`;
      lines.push(`- ${c.decision} [${tail}]`);
    }
  }

  if (ir.reviewFlags.length) {
    lines.push('', '## Review flags for the controls engineer');
    for (const f of ir.reviewFlags) lines.push(`- ${f}`);
  }

  // Scope contract rides into the translation prompt too — out-of-scope
  // questions/flags are unaskable at every stage (Dan, Aug 23).
  for (const l of renderGenerationScopeText(ir.generationScope, ir.machineSpec && ir.machineSpec.purpose)) lines.push(l);

  if (ir.warnings.length) {
    lines.push('', '## Compile warnings');
    for (const w of ir.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

// ── Shared compile system prompt ─────────────────────────────────────────────

/** The compiler's system prompt — shared by the full compile and the scoped
 *  per-machine recompile so both reason from identical knowledge. */
function buildCompileSystem({ choice, notes, meKnowledge, concepts }) {
  return (
    SUPREME_LAW + '\n\n' +
    'You are JARVIS, the SDC Automation coordination compiler. This is the ONE ' +
    'thinking step of the pipeline: you take the engineer\'s drawn diagram and ' +
    'machine spec and compile the COMPLETE station sequence — every state, every ' +
    'transition condition, every wait exit, every handshake, every recovery path — ' +
    'as a reviewable object. The engineer will review and approve it; code ' +
    'generation afterwards is mechanical translation of what you produce here. ' +
    'Reason from the knowledge you already have below — never relearn the ' +
    'template, never invent alternatives to SDC standards.\n\n' +
    (meKnowledge ? meKnowledge + '\n\n' : '') +
    (concepts
      ? '# ENGINEERING CONCEPTS (how SDC thinks — apply the concepts to this station\'s specifics)\n' +
        'These are understanding, not templates: mechanism, intent, and judgment.\n' +
        'Where the station differs from any template, reason from these concepts.\n\n' +
        concepts + '\n\n'
      : '') +
    `# SDC state grid law\n` +
    `- Flowchart states: ${STATE_BASE}, ${STATE_BASE + STATE_STEP}, ${STATE_BASE + 2 * STATE_STEP}, ... up to 97 (step ${STATE_STEP}).\n` +
    '- Reserved: 0 (powerup), 1-3 (SDC reserved), 99 (lockout), 100-127 (template init block), 127 (cycle-ready).\n' +
    '- Standard per-state fault timer: MOVE(5000,Control.FaultTime) + Status.TimeoutFlt.\n\n' +
    renderPatternInventory(choice.template) + '\n\n' +
    `# Template pattern knowledge (distilled — ${choice.template}, selected: ${choice.reason})\n` +
    notes + '\n' +
    OUTPUT_SPEC
  );
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * The one Build-time reasoning call.
 * @param {object} opts
 * @param {object} opts.projectJson  full project JSON
 * @param {string} [opts.smId]       state machine id (default: first SM)
 * @param {(pct:number, stage:string, detail?:string)=>void} [opts.onProgress]
 * @param {string} [opts.corrections]  the engineer's change notes for a
 *   re-compile — authoritative; the model must fold them in AND confirm each
 *   one in consumedNotes (the UI warned "compiler didn't confirm it used your
 *   change notes" when this was silently dropped — Dan, 2026-08-25).
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ ir, questions, cost, validation, consumedNotes, meta }>}
 */
async function compileSequence({ projectJson, smId, onProgress = () => {}, corrections = '', signal = null } = {}) {
  const client = getClient();

  onProgress(5, 'ir', 'Building diagram IR');
  const baseIr = buildIR(projectJson, smId);
  const sm = (projectJson.stateMachines || []).find(s => s.id === baseIr.smId);
  const choice = selectTemplate(sm);
  const notes = TEMPLATE_NOTES[choice.template] || COMMON_NOTES;
  // PRECEDENT PACK (Dan, 2026-08-26): naming grounds in shipped work.
  const meKnowledge = loadMeKnowledge() + precedentsBlock();
  const concepts = loadConcepts();

  const system = buildCompileSystem({ choice, notes, meKnowledge, concepts });

  const jobText =
    '# COMPILE THIS STATION\n' +
    'Below is the drawn diagram IR (state numbers FINAL) plus the MACHINE SPEC ' +
    '(authoritative mechanical intent, including partner stations\' reciprocal ' +
    'declarations). Compile the complete coordinated sequence:\n' +
    '- keep the drawn states and their numbers;\n' +
    '- synthesize any missing states the spec requires (retries exhausted, ' +
    'escalation, handshake waits) on the next free grid numbers;\n' +
    '- give EVERY transition concrete SDC-tag conditionText;\n' +
    '- give EVERY wait all of its exits: success, each partner failure mode, timeout;\n' +
    '- define the handshake signals both directions with set/clear states;\n' +
    '- flag every real design decision for CE review.\n\n' +
    (String(corrections || '').trim()
      ? '# ENGINEER\'S CHANGE NOTES (authoritative — this is a RE-COMPILE)\n' +
        'The engineer reviewed the previous compiled sequence and sent these change\n' +
        'notes. Fold EVERY one into the sequence you produce — they override anything\n' +
        'they conflict with. Then CONFIRM each note in a top-level "consumedNotes"\n' +
        'array in your JSON response: one short line per note stating what you did\n' +
        'with it ("Raised the shuttle retract delay to 1s in state 16" / "Did not\n' +
        'apply X because Y — flagged for review"). A change note that appears in\n' +
        'neither the sequence nor consumedNotes is a contract violation.\n\n' +
        String(corrections).trim() + '\n\n'
      : '') +
    baseIr.text;

  onProgress(15, 'model', 'Compiling the sequence (the thinking step)');
  // One retry on the two recoverable failures (truncation → double the budget;
  // malformed JSON → ask again) so a single bad sample can't 500 a 4-minute
  // paid run (real incident 2026-08-20).
  let parsed = null;
  let response = null;
  let maxTokens = MAX_TOKENS;
  let retryNote = '';
  let totalCostUSD = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const req = {
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },     // THE thinking step — full effort
      system,
      messages: [{ role: 'user', content: jobText + retryNote }],
    };
    if (/^claude-(fable|opus)-/.test(MODEL)) {
      req.betas = ['server-side-fallback-2026-07-01'];
      req.fallbacks = 'default';
    }
    const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
    let chars = 0;
    stream.on('text', (d) => {
      chars += d.length;
      const frac = Math.min((chars / 4) / 12000, 1);
      try { onProgress(40 + 45 * frac, 'model', `Writing compiled sequence (~${Math.round(chars / 4).toLocaleString()} tokens)`); } catch (_) {}
    });
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta' && event.delta.thinking) {
        const line = event.delta.thinking.replace(/\s+/g, ' ').trim();
        if (line) { try { onProgress(20, 'model', '· ' + (line.length > 90 ? line.slice(0, 90) + '…' : line)); } catch (_) {} }
      }
    });
    response = await stream.finalMessage();
    if (response.usage) totalCostUSD += costOfUsage(response.usage, MODEL);
    if (response.stop_reason === 'refusal') {
      throw new Error('Model refused the compile request: ' + (response.stop_details?.explanation || 'no reason given'));
    }
    if (response.stop_reason === 'max_tokens') {
      if (attempt === 2) throw new Error(`Compile response truncated at ${maxTokens} tokens (after retry)`);
      maxTokens = maxTokens * 2;
      retryNote = '\n\n(Your previous response was truncated. Respond with ONLY the JSON object, compactly.)';
      onProgress(30, 'model', 'First pass truncated — retrying with a larger budget');
      continue;
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    onProgress(88, 'validate', 'Validating compiled sequence');
    try {
      parsed = extractJson(text);
      break;
    } catch (e) {
      if (attempt === 2) throw new Error('Compile response was not valid JSON (after retry): ' + e.message);
      retryNote = '\n\n(Your previous response was not parseable JSON. Respond with ONLY one valid JSON object — no prose, no fences.)';
      onProgress(30, 'model', 'Response was malformed — asking Jarvis to restate it');
    }
  }
  const ir = normalizeCompiledIR(parsed, baseIr);
  const validation = validateCompiledIR(ir);
  // sourceNodeId coercion warnings from normalization ride with validation.
  validation.warnings.push(...ir.warnings);

  // GEOMETRIC SANITY (Dan, Aug 24: the compile invented "PlaceTransition 450"
  // on an axis whose Place is 300 — geometric nonsense no arithmetic check
  // caught). Every servo axis's named values must pass the mechanical checks
  // in src/lib/geometrySanity.js: a transition strictly between approach and
  // target, blends within their Z-leg/X-leg limits (Dan's rule), nothing
  // outside a declared envelope. Failures are compile ERRORS in plain
  // sentences — they feed the fix loop like any other finding.
  try {
    const { pathToFileURL } = require('url');
    const path = require('path');
    const { geometryIssuesOf } = await import(
      pathToFileURL(path.join(__dirname, '..', 'geometrySanity.js')).href);
    for (const g of geometryIssuesOf(sm)) {
      validation.errors.push(`Geometric error — ${g.axisName}: ${g.message}`);
    }
  } catch (e) {
    validation.warnings.push('Geometry sanity checks unavailable: ' + e.message);
  }

  // Domain-tagged questions ({ question, domain, proposedSolution }) —
  // strings from older prompt shapes are classified by the rule-based
  // router. Geometry questions are a prompt violation; the domain tag lets
  // the surfaces route them away from controls pages regardless.
  // SOLUTIONS, NOT EXPLANATIONS (Dan, 2026-08-22): the prompt REQUIRES a
  // proposedSolution with every question — schema-check it here: a missing
  // one is recorded as a validation warning (honest null, never fabricated).
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map(q => (q && typeof q === 'object')
      ? { question: String(q.question || '').trim(), domain: q.domain,
          proposedSolution: String(q.proposedSolution || '').trim() || null,
          addressee: q.addressee }
      : { question: String(q || '').trim(), domain: undefined,
          proposedSolution: null, addressee: undefined })
    .filter(q => q.question)
    .map(q => {
      const domain = resolveQuestionDomain(q.domain, q.question);
      return {
        question: q.question,
        proposedSolution: q.proposedSolution,
        addressee: resolveAddressee(q.addressee, domain),
        domain,
      };
    });
  for (const q of questions) {
    if (!q.proposedSolution) {
      validation.warnings.push(`Question filed without a proposedSolution (prompt contract violation — solutions, not explanations): "${q.question.slice(0, 120)}"`);
    }
  }

  ir.warnings = [...validation.errors.map(e => `ERROR: ${e}`), ...validation.warnings];
  ir.text = renderCompiledText(ir); // re-render with warnings included

  // Change-notes acknowledgment (Dan, 2026-08-25): when corrections were
  // sent, the model must confirm each one; an empty confirmation on a
  // corrections compile is itself a warning the UI surfaces.
  const consumedNotes = (Array.isArray(parsed.consumedNotes) ? parsed.consumedNotes : [])
    .map(n => String(n || '').trim()).filter(Boolean);
  if (String(corrections || '').trim() && !consumedNotes.length) {
    validation.warnings.push('Change notes were sent with this compile but the compiler did not confirm consuming them (no consumedNotes in the response) — verify the sequence reflects your notes');
  }

  const cost = Number(totalCostUSD.toFixed(4)); // accumulated across retries
  onProgress(96, 'validate', 'Compile complete');
  return {
    ir,
    questions,
    cost,
    validation,
    consumedNotes,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: cost,
      compilerVersion: COMPILER_VERSION,
      template: choice.template,
      templateReason: choice.reason,
      correctionsApplied: Boolean(String(corrections || '').trim()) && consumedNotes.length > 0,
      ...(String(corrections || '').trim() ? { corrections: String(corrections).trim() } : {}),
    },
  };
}

// ── Scoped per-machine recompile (THE SPEED ARCHITECTURE, class c) ──────────
//
// A STRUCTURAL-SM edit (states/transitions/devices change WITHIN one planned
// machine) re-plans ONLY that machine: the multi-SM compiled sequence is
// per-machine, so the other machines carry forward byte-identical and the
// handshake contract is re-validated cheaply (validateCrossMachineHandshakes
// is a pure function). ~2-4 min instead of a full station compile.

/**
 * @param {object} opts
 * @param {object} opts.projectJson
 * @param {string} opts.smId
 * @param {string} opts.machineName   name of the planned machine to re-plan
 *                                    (an ir.stateMachines[] entry)
 * @param {string} opts.correction    the engineer's change request (required)
 * @param {(pct:number, stage:string, detail?:string)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ ir, validation, cost, consumedNotes, machine, meta }>}
 *          ir = the FULL compiled IR with only the target machine replaced
 */
async function recompileMachine({ projectJson, smId, machineName, correction, onProgress = () => {}, signal = null } = {}) {
  const client = getClient();
  if (!String(correction || '').trim()) throw new Error('correction is required');

  const sm = (projectJson.stateMachines || []).find(s =>
    s.id === smId || s.name === smId || s.displayName === smId);
  if (!sm) throw new Error(`State machine "${smId}" not found`);
  const prior = sm.compiledSequence && sm.compiledSequence.ir;
  if (!prior || !prior.multiSm || !Array.isArray(prior.stateMachines)) {
    throw new Error('Scoped recompile needs an existing multi-SM compiled sequence — run a full compile instead');
  }
  const idx = prior.stateMachines.findIndex(m =>
    String(m.name).toLowerCase() === String(machineName).toLowerCase()
    || String(m.programName || '').toLowerCase() === String(machineName).toLowerCase());
  if (idx === -1) {
    throw new Error(`Planned machine "${machineName}" not found — machines: ${prior.stateMachines.map(m => m.name).join(', ')}`);
  }
  const target = prior.stateMachines[idx];

  onProgress(5, 'ir', `Scoped recompile: re-planning "${target.name}" only`);
  const baseIr = buildIR(projectJson, sm.id);
  const choice = selectTemplate(sm);
  const notes = TEMPLATE_NOTES[choice.template] || COMMON_NOTES;
  const system = buildCompileSystem({
    choice, notes, meKnowledge: loadMeKnowledge() + precedentsBlock(), concepts: loadConcepts(),
  });

  const others = prior.stateMachines.filter((_, i) => i !== idx);
  const jobText = [
    '# RE-PLAN ONE MACHINE (scoped recompile — the rest of the station is FROZEN)',
    `The station "${prior.displayName || prior.smName}" was already compiled as a multi-SM`,
    'decomposition and the engineer sent a correction that affects EXACTLY ONE machine.',
    `Re-plan ONLY "${target.name}"${target.programName ? ` (${target.programName})` : ''}. Every other machine is carried`,
    'forward untouched — you cannot change them.',
    '',
    '## The correction (authoritative)',
    String(correction).trim(),
    '',
    '## HANDSHAKE CONTRACT (frozen unless the correction demands otherwise)',
    'The other machines\' handshake declarations are below. Your re-planned machine',
    'must keep every inter-SM signal name and its produce/consume direction intact',
    'so both sides still match. If the correction genuinely forces a handshake',
    'change, declare it in "handshakeChanges": [{ "signal", "change", "partner" }]',
    '— the partner machines are frozen this round, so any change here becomes a',
    'review flag for a follow-up edit on the partner.',
    '',
    ...others.map(m => `- ${m.name}${m.programName ? ` (${m.programName})` : ''}: handshakes ${JSON.stringify((m.handshakes || []).map(h => ({ signal: h.signal, direction: h.direction, partner: h.partner })))}`),
    '',
    '## THE MACHINE BEING RE-PLANNED (current plan — apply the correction to this)',
    JSON.stringify({
      name: target.name, oneLiner: target.oneLiner, programName: target.programName,
      states: target.states, transitions: target.transitions,
      waits: target.waits, handshakes: target.handshakes,
    }, null, 1),
    '',
    '## STATION CONTEXT (diagram IR + machine spec — reference only)',
    baseIr.text,
    '',
    '# Your response',
    'Respond with ONLY one JSON object — a SINGLE machine in the stateMachines[]-entry',
    'schema from your instructions, plus the acknowledgments:',
    '{ "name", "oneLiner", "programName", "states": [...], "transitions": [...],',
    '  "waits": [...], "handshakes": [...],',
    '  "consumedNotes": ["<one line per part of the correction: what you did with it>"],',
    '  "handshakeChanges": [ { "signal", "change", "partner" } ],',
    '  "reviewFlags": ["<real design decisions this change forced>"] }',
    'Keep everything the correction does not touch IDENTICAL to the current plan —',
    'same states, same numbers where possible, same conditionText. This is an edit,',
    'not a fresh design.',
  ].join('\n');

  onProgress(15, 'model', `Re-planning ${target.name} (scoped — other machines frozen)`);
  let parsed = null;
  let response = null;
  let totalCostUSD = 0;
  let retryNote = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const req = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive', display: 'summarized' },
      // Scoped edit of an already-thought-through plan — medium effort is the
      // speed point of this path (full compile stays effort high).
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: jobText + retryNote }],
    };
    if (/^claude-(fable|opus)-/.test(MODEL)) {
      req.betas = ['server-side-fallback-2026-07-01'];
      req.fallbacks = 'default';
    }
    const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
    let chars = 0;
    stream.on('text', (d) => {
      chars += d.length;
      const frac = Math.min((chars / 4) / 6000, 1);
      try { onProgress(30 + 55 * frac, 'model', `Writing re-planned machine (~${Math.round(chars / 4).toLocaleString()} tokens)`); } catch (_) {}
    });
    response = await stream.finalMessage();
    if (response.usage) totalCostUSD += costOfUsage(response.usage, MODEL);
    if (response.stop_reason === 'refusal') {
      throw new Error('Model refused the recompile request: ' + (response.stop_details?.explanation || 'no reason given'));
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try { parsed = extractJson(text); break; }
    catch (e) {
      if (attempt === 2) throw new Error('Recompile response was not valid JSON (after retry): ' + e.message);
      retryNote = '\n\n(Your previous response was not parseable JSON. Respond with ONLY one valid JSON object.)';
    }
  }

  onProgress(88, 'validate', 'Splicing + re-validating the decomposition');
  // Normalize the returned machine exactly like a compile round would.
  const warnings = [];
  const parts = normalizeMachineParts(parsed, baseIr, warnings);
  const replanned = {
    name: String(parsed.name || target.name).trim(),
    oneLiner: String(parsed.oneLiner || target.oneLiner || '').trim(),
    programName: String(parsed.programName || target.programName || '').trim() || null,
    ...parts,
  };
  const renum = renumberInlineOnGrid(replanned);
  if (renum.changed.length) {
    warnings.push(`[${replanned.name}] Inline flow-order renumbering applied: ` +
      renum.changed.map(c => `${c.from}→${c.to}`).join(', '));
  }

  // Splice into a deep copy of the prior IR — everything else byte-identical.
  const ir = JSON.parse(JSON.stringify(prior));
  ir.stateMachines[idx] = replanned;
  ir.compilerVersion = COMPILER_VERSION;
  ir.warnings = warnings;

  // Cheap full re-validation: pure functions over the spliced decomposition —
  // per-machine core checks + the cross-machine handshake contract.
  const validation = validateCompiledIR(ir);
  validation.warnings.push(...warnings);
  const consumedNotes = (Array.isArray(parsed.consumedNotes) ? parsed.consumedNotes : [])
    .map(n => String(n || '').trim()).filter(Boolean);
  if (!consumedNotes.length) {
    validation.warnings.push('The recompile did not confirm consuming the correction (no consumedNotes) — verify the machine reflects it');
  }
  for (const h of Array.isArray(parsed.handshakeChanges) ? parsed.handshakeChanges : []) {
    if (h && h.signal) {
      ir.reviewFlags = ir.reviewFlags || [];
      ir.reviewFlags.push(`Handshake changed by scoped recompile of ${replanned.name}: ${h.signal} — ${h.change || 'changed'} (partner ${h.partner || '?'} was frozen this round; follow up on its side)`);
    }
  }
  ir.warnings = [...validation.errors.map(e => `ERROR: ${e}`), ...validation.warnings];
  ir.text = renderCompiledText(ir);

  const cost = Number(totalCostUSD.toFixed(4));
  onProgress(96, 'validate', 'Scoped recompile complete');
  return {
    ir, validation, cost, consumedNotes,
    machine: replanned.name,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: cost,
      compilerVersion: COMPILER_VERSION,
      scope: `re-planned ${replanned.name} only (${others.length} machine(s) untouched)`,
      correctionsApplied: consumedNotes.length > 0,
      corrections: String(correction).trim(),
    },
  };
}

// ── Structural-delta patching (Dan's escalation model, 2026-08) ─────────────
// When code-writing changes the planned structure vs the approved compiled IR,
// the writer DECLARES it as a structural change with an irPatch. The patch is
// applied to the compiled IR so the diagram stays truthful — never silent
// divergence. Ops (all state numbers are integers on the SDC grid):
//   { op:'addState', state:{ stateNumber, label, actions?, isInitial?, isComplete? } }
//   { op:'removeState', stateNumber }
//   { op:'updateState', stateNumber, patch:{ label?, actions?, ... } }
//   { op:'addTransition', transition:{ fromState, toState, conditionText, kind?, ... } }
//   { op:'removeTransition', fromState, toState }
//   { op:'updateTransition', fromState, toState, patch:{ conditionText?, toState?, ... } }

/**
 * Apply one structural change's irPatch ops to a compiled IR IN PLACE
 * (callers pass a deep copy when they need the original kept). Re-derives
 * entryFrom, re-sorts states, and re-renders `.text`.
 * Pure data manipulation — no model calls.
 * @returns {{ ok: boolean, errors: string[] }}
 */
function applyIrPatches(ir, patches) {
  const errors = [];
  const ops = (Array.isArray(patches) ? patches : []).filter(Boolean);
  if (!ir || !Array.isArray(ir.states)) return { ok: false, errors: ['applyIrPatches: no compiled IR'] };

  const findState = n => ir.states.find(s => s.stateNumber === Number(n));
  const findTransition = (f, t) => ir.transitions.find(x => x.fromState === Number(f) && x.toState === Number(t));

  for (const p of ops) {
    switch (p.op) {
      case 'addState': {
        const s = p.state || {};
        if (!Number.isInteger(s.stateNumber)) { errors.push('addState: state.stateNumber (integer) required'); break; }
        if (findState(s.stateNumber)) { errors.push(`addState: state ${s.stateNumber} already exists`); break; }
        ir.states.push({
          nodeId: null, sourceNodeId: null, synthesized: true, type: 'compiledState',
          label: String(s.label || ''), stateNumber: s.stateNumber,
          isInitial: !!s.isInitial, isComplete: !!s.isComplete,
          actions: Array.isArray(s.actions) ? s.actions : [],
          entryFrom: [],
        });
        break;
      }
      case 'removeState': {
        const i = ir.states.findIndex(s => s.stateNumber === Number(p.stateNumber));
        if (i === -1) { errors.push(`removeState: no state ${p.stateNumber}`); break; }
        ir.states.splice(i, 1);
        ir.transitions = ir.transitions.filter(t => t.fromState !== Number(p.stateNumber) && t.toState !== Number(p.stateNumber));
        ir.waits = (ir.waits || []).filter(w => w.stateNumber !== Number(p.stateNumber));
        break;
      }
      case 'updateState': {
        const s = findState(p.stateNumber);
        if (!s) { errors.push(`updateState: no state ${p.stateNumber}`); break; }
        Object.assign(s, p.patch || {});
        break;
      }
      case 'addTransition': {
        const t = p.transition || {};
        if (!Number.isInteger(t.fromState) || !Number.isInteger(t.toState)) { errors.push('addTransition: transition.fromState/toState (integers) required'); break; }
        ir.transitions.push({
          fromLabel: t.fromLabel || (findState(t.fromState)?.label ?? null),
          toLabel: t.toLabel || (findState(t.toState)?.label ?? null),
          fromState: t.fromState, toState: t.toState,
          from: t.fromState, to: t.toState,
          conditionType: null,
          label: t.outcomeLabel || null, outcomeLabel: t.outcomeLabel || null,
          branch: t.branch || null,
          conditionText: String(t.conditionText || ''),
          kind: t.kind || 'sequence',
        });
        break;
      }
      case 'removeTransition': {
        const i = ir.transitions.findIndex(x => x.fromState === Number(p.fromState) && x.toState === Number(p.toState));
        if (i === -1) { errors.push(`removeTransition: no transition [${p.fromState}]->[${p.toState}]`); break; }
        ir.transitions.splice(i, 1);
        break;
      }
      case 'updateTransition': {
        const t = findTransition(p.fromState, p.toState);
        if (!t) { errors.push(`updateTransition: no transition [${p.fromState}]->[${p.toState}]`); break; }
        Object.assign(t, p.patch || {});
        if (p.patch && p.patch.toState !== undefined) { t.to = Number(p.patch.toState); t.toState = Number(p.patch.toState); }
        if (p.patch && p.patch.conditionText !== undefined) t.conditionText = String(p.patch.conditionText);
        break;
      }
      default:
        errors.push(`applyIrPatches: unknown op "${p.op}"`);
    }
  }

  // Re-derive entryFrom + ordering, then re-render the reviewable text so the
  // flowchart/compiled view stays truthful to what the code now does.
  ir.states.sort((a, b) => a.stateNumber - b.stateNumber);
  for (const s of ir.states) s.entryFrom = [];
  const byNumber = new Map(ir.states.map(s => [s.stateNumber, s]));
  for (const t of ir.transitions) {
    const target = byNumber.get(t.toState);
    if (target && !target.entryFrom.includes(t.fromState)) target.entryFrom.push(t.fromState);
  }
  for (const s of ir.states) s.entryFrom.sort((a, b) => a - b);
  try { ir.text = renderCompiledText(ir); } catch (e) { errors.push('re-render failed: ' + e.message); }

  return { ok: errors.length === 0, errors };
}

module.exports = { compileSequence, recompileMachine, validateCompiledIR, validateMachineCore, normalizeCompiledIR, normalizeMachineParts, renumberInlineOnGrid, renderCompiledText, applyIrPatches, isMainFlowEdge, COMPILER_VERSION };
