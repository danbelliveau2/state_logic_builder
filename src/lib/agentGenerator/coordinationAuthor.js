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
const { loadMeKnowledge, loadConcepts } = require('./meKnowledge');
const { costOfUsage, AiNotConfiguredError } = require('./client');

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
      "nodeId": "<drawn node id, or null for a state you synthesized>",
      "synthesized": true|false,
      "isInitial": true|false, "isComplete": true|false,
      "actions": [
        { "operation": "<Extend|Retract|Engage|Disengage|ServoMove|SetSignal|ClearSignal|Wait|...>",
          "deviceName": "<device name from the Devices list, or null for a p_ signal action>",
          "detail": "<concrete SDC detail, e.g. 'OTL(p_RequestNextStack)' or 'q_ExtendHoldDown'>",
          "positionName": "<ServoMove only: target position name from the device's positions list>",
          "speedProfile": "<ServoMove only: speed profile name from the device's speedProfiles list, e.g. 'Fast' or 'Slow' — REQUIRED on every ServoMove when the device declares more than one profile>",
          "advance": "<ServoMove only: 'complete' (strict MAM.PC + InPos) or 'wideband' (blend: next state may start on MAM.IP + InPosWide) — REQUIRED on every ServoMove>" }
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
  "reviewFlags": [ "<*Replace/*Verify item or design decision the CE must review>" ],
  "questions": [ "<CONTROLS-ARCHITECTURE question that PASSES the self-answer test — usually empty>" ],
  "summary": "<3-5 sentence plain-English narrative of the compiled sequence>"
}

Rules:
- State numbers: keep every drawn state's ASSIGNED number exactly as given. New
  synthesized states continue on the same grid (next free multiples: base ${STATE_BASE},
  step ${STATE_STEP}, max 97). 99 is lockout, 100-127 is the template init block —
  never author states there; reference them in conditionText only where the
  template law requires (e.g. init-complete 124/127 entry).
- EVERY wait must list ALL its exits: the success path, one exit per partner
  failure mode declared in the MACHINE SPEC, and a timeout path (standard
  Control.FaultTime 5000ms unless the spec says otherwise). NO EXITLESS WAITS.
- Every transition needs concrete conditionText in SDC tag idioms — real tag
  names per SDC naming (i_/q_/p_ prefixes, {Name}ExtendDelay timers,
  \\\\PartnerProgram.p_Signal cross-program refs). Never vague prose.
- Retry counters: name them, state where they increment and reset, and give the
  exhaustion branch its own transition (GEQ n).
- Handshake signals (p_*) must appear on BOTH sides: the action that latches/
  unlatches them and the wait/transition that consumes them.
- Questions: apply the self-answer test with maximum strictness. If SDC
  standards, the machine spec, or physics force the answer — decide it and put
  the decision in reviewFlags, not questions.
- Questions are CONTROLS-ARCHITECTURE ONLY: handshake mechanics with partner
  stations/supervisor, supervisor integration choices, fault-philosophy
  decisions the spec leaves genuinely open. Geometry and mechanical intent
  (positions, heights, home-vs-pick posture, transition/blend-start values,
  strokes, clearances) are NEVER compile questions — the describe phase owns
  those. When a geometry/mechanical value is unknown here, pick the SDC-standard
  placeholder, use it, and add a "*Verify …" reviewFlag naming the value the ME
  must confirm. A compile question about geometry is always wrong.
- Motion intent is data, not prose: every ServoMove action carries
  positionName, speedProfile (when the device has more than one), and advance
  ('complete' | 'wideband'). A stroke the spec calls fast-then-slow is TWO
  states (fast to the transition-point position, slow to the final position).
  A blended/rounded corner is advance:'wideband' on the travel move whose
  clearance permits the next axis to start early; grips/releases/process
  actions are always advance:'complete'. Wideband transitions' conditionText
  uses the template idiom [Axis_MAM.PC + {Pos}.InPos , Axis_MAM.IP + {Pos}.InPosWide].
`;

// ── Mechanical validation of the compiled IR ────────────────────────────────

function onGrid(n) {
  return Number.isInteger(n) && n >= STATE_BASE && n <= 97 && (n - STATE_BASE) % STATE_STEP === 0;
}

/**
 * Mechanical checks on a compiled IR: grid discipline, transition integrity,
 * and the no-exitless-waits rule. Pure function — also used by tests.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateCompiledIR(ir) {
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
  const legalRef = n => known.has(n) || n === 99 || (n >= 100 && n <= 127);
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

  // Every non-complete state must have at least one exit.
  for (const s of states) {
    if (s.isComplete) continue;
    if (!(outgoing.get(s.stateNumber) || []).length) {
      errors.push(`State ${s.stateNumber} ("${s.label}") has no outgoing transition`);
    }
  }

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
      errors.push(`Exitless wait: state ${w.stateNumber} waits on "${w.signal || '?'}" with only success exits — needs a timeout/partner-failure path (no-exitless-waits rule)`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Normalization + rendering ────────────────────────────────────────────────

/** Fold the model's compiled object + the deterministic base IR into one
 *  irVersion-1 compiled IR the engineer reviews and Generate translates. */
function normalizeCompiledIR(parsed, baseIr) {
  const states = (parsed.states || []).map(s => ({
    nodeId: s.nodeId || null,
    synthesized: s.synthesized === true || !s.nodeId,
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
  })).sort((a, b) => a.stateNumber - b.stateNumber);

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

  const assigned = states.map(s => s.stateNumber).filter(Number.isFinite);
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
    states,
    transitions,
    waits,
    handshakes: (parsed.handshakes || []).map(h => ({
      signal: h.signal || '', direction: h.direction || 'out', partner: h.partner || null,
      purpose: h.purpose || '', setAtState: h.setAtState ?? null, clearAtState: h.clearAtState ?? null,
    })),
    reviewFlags: (parsed.reviewFlags || []).map(String),
    summary: String(parsed.summary || ''),
    stateRanges: {
      reserved: { powerup: 0, sdc: [1, 2, 3] },
      sequence: { from: STATE_BASE, to: assigned.length ? Math.max(...assigned) : null },
      lockout: 99,
      init: { from: 100, to: 127, cycleReady: 127 },
    },
    machineSpec: baseIr.machineSpec,
    warnings: [],
  };
  ir.text = renderCompiledText(ir);
  return ir;
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

  lines.push('', '## States (numbers are FINAL — approved by the engineer)');
  for (const s of ir.states) {
    const flags = [
      s.isInitial ? 'INITIAL' : null,
      s.isComplete ? 'CYCLE-COMPLETE' : null,
      s.synthesized ? 'SYNTHESIZED' : null,
    ].filter(Boolean).join(', ');
    lines.push(`- State ${s.stateNumber}: "${s.label}"` + (flags ? ` {${flags}}` : ''));
    for (const a of s.actions) {
      lines.push(`    action: ${a.operation} -> ${a.deviceName || '(signal)'}` +
        (a.detail ? ` (${a.detail})` : ''));
    }
  }

  lines.push('', '## Transitions (conditionText is the rung condition — implement exactly)');
  for (const t of ir.transitions) {
    const tag = [t.kind !== 'sequence' ? t.kind : null, t.branch ? `branch=${t.branch}` : null]
      .filter(Boolean).join(' ');
    lines.push(`- [${t.fromState}] -> [${t.toState}]${tag ? ` {${tag}}` : ''}: ${t.conditionText}`);
  }

  if (ir.waits.length) {
    lines.push('', '## Waits (every wait lists ALL its exits — no exitless waits)');
    for (const w of ir.waits) {
      lines.push(`- State ${w.stateNumber} waits on ${w.signal || '?'}` +
        (w.partner ? ` from ${w.partner}` : w.source ? ` (${w.source})` : '') + ` [${w.mode}]`);
      for (const x of w.exits || []) lines.push(`    exit -> [${x.toState}] when ${x.when}`);
    }
  }

  if (ir.handshakes.length) {
    lines.push('', '## Handshake signals');
    for (const h of ir.handshakes) {
      const set = h.setAtState != null ? ` set@${h.setAtState}` : '';
      const clr = h.clearAtState != null ? ` clear@${h.clearAtState}` : '';
      lines.push(`- ${h.signal} (${h.direction}${h.partner ? ` ${h.direction === 'out' ? '->' : '<-'} ${h.partner}` : ''})${set}${clr}: ${h.purpose}`);
    }
  }

  if (ir.reviewFlags.length) {
    lines.push('', '## Review flags for the controls engineer');
    for (const f of ir.reviewFlags) lines.push(`- ${f}`);
  }

  if (ir.warnings.length) {
    lines.push('', '## Compile warnings');
    for (const w of ir.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * The one Build-time reasoning call.
 * @param {object} opts
 * @param {object} opts.projectJson  full project JSON
 * @param {string} [opts.smId]       state machine id (default: first SM)
 * @param {(pct:number, stage:string, detail?:string)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ ir, questions, cost, validation, meta }>}
 */
async function compileSequence({ projectJson, smId, onProgress = () => {}, signal = null } = {}) {
  const client = getClient();

  onProgress(5, 'ir', 'Building diagram IR');
  const baseIr = buildIR(projectJson, smId);
  const sm = (projectJson.stateMachines || []).find(s => s.id === baseIr.smId);
  const choice = selectTemplate(sm);
  const notes = TEMPLATE_NOTES[choice.template] || COMMON_NOTES;
  const meKnowledge = loadMeKnowledge();
  const concepts = loadConcepts();

  const system =
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
    `# Template pattern knowledge (distilled — ${choice.template}, selected: ${choice.reason})\n` +
    notes + '\n' +
    OUTPUT_SPEC;

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
  ir.warnings = [...validation.errors.map(e => `ERROR: ${e}`), ...validation.warnings];
  ir.text = renderCompiledText(ir); // re-render with warnings included

  const cost = Number(totalCostUSD.toFixed(4)); // accumulated across retries
  onProgress(96, 'validate', 'Compile complete');
  return {
    ir,
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String) : [],
    cost,
    validation,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: cost,
      compilerVersion: COMPILER_VERSION,
      template: choice.template,
      templateReason: choice.reason,
    },
  };
}

module.exports = { compileSequence, validateCompiledIR, normalizeCompiledIR, renderCompiledText, COMPILER_VERSION };
