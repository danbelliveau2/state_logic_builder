/**
 * smDecomposer.js — the cascade's STEP-1, DECOMPOSE-ONLY call (Dan,
 * 2026-08-26): takes the ME's explanation (+ reference images + his
 * expectation) and returns ONLY the state-machine breakup proposal —
 * [{name, oneLiner, ownedDeviceNames, why, sequence}] + the asynchrony
 * reasoning. NO diagram build, NO compile — those happen ONLY at the
 * Generate step after every cascade approval. Cheap/fast tier (sonnet by
 * default): step 1 must come back in ~30s.
 *
 * ONE DOOR (Dan's flow-replacement law, 2026-08-26): this replaces the old
 * build-then-compile step-1 kick, which is DELETED — not routed around.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { AiNotConfiguredError } = require('./client');
const { loadMeKnowledge } = require('./meKnowledge');
const { precedentsBlock } = require('./precedents'); // (assign/check still reference it via engineContext)
const { buildEngineContext } = require('./engineContext');

const MODEL = process.env.JARVIS_DECOMPOSE_MODEL || 'claude-sonnet-5';
// 16K floor — 3000 truncated real proposals (a multi-SM station with per-machine
// sequences overruns it easily; same truncation class as the reviewer's 16K bug).
const MAX_TOKENS = parseInt(process.env.JARVIS_DECOMPOSE_MAX_TOKENS, 10) || 16000;

// Pricing per M tokens (mirrors client.js PRICING for the tiers we use here).
const PRICING = { 'claude-sonnet-5': [3, 15], 'claude-opus-5': [5, 25], 'claude-haiku-4-5': [1, 5] };
function costOf(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-sonnet-5'];
  return (((usage?.input_tokens ?? 0) * inRate) + ((usage?.output_tokens ?? 0) * outRate)) / 1e6;
}

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

// The decomposer thinks WITH the standards, not from the prompt alone: the
// CE-authored decomposition doctrine (asynchrony test, dial-station patterns,
// one-SM-per-program) rides in the system prompt on every call.
function loadDecompositionConcept() {
  try {
    const fs = require('fs');
    const p = path.join(__dirname, '..', '..', '..', 'jarvis-knowledge', 'concepts', 'multi-state-machine.md');
    return '\n# SDC decomposition doctrine (CE standard)\n' + fs.readFileSync(p, 'utf8');
  } catch { return ''; }
}

function extractJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON object in the model response');
  return JSON.parse(text.slice(s, e + 1));
}

// STRUCTURED SEQUENCE STEPS (Dan, 2026-08-28: the grid shape "should come
// FROM the engine, not regex-parsed from prose"). The model emits
// {action, target, detail, counterpart}; we keep the objects on
// sequenceSteps (exact tag derivation + cleaner codegen input) AND
// serialize each to ONE canonical prose line (sequence stays string[] —
// every downstream consumer keeps working, and the render's type column
// splits on the canonical first word exactly, not fuzzily).
function normalizeStep(x) {
  if (x && typeof x === 'object') {
    const step = {
      action: String(x.action ?? '').trim(),
      target: String(x.target ?? '').trim(),
      detail: String(x.detail ?? '').trim(),
      counterpart: String(x.counterpart ?? '').trim(),
      // DEVICE LINK (Dan, 2026-08-30: "the sequence can't be different
      // names, it's got to be based on the devices always") — the stable
      // device id rides the step; the target NAME is derived from it.
      ...(x.deviceId ? { deviceId: String(x.deviceId) } : {}),
    };
    // ONE VOCABULARY (Dan, 2026-08-28): the stored step carries the SDC
    // operation, so sequence ↔ diagram ↔ codegen agree by construction.
    if (/^close$/i.test(step.action) && /gripper/i.test(step.target)) step.action = 'Engage';
    if (/^open$/i.test(step.action) && /gripper/i.test(step.target)) step.action = 'Disengage';
    if (/^move$/i.test(step.action) && /axis/i.test(step.target)) step.action = 'Servo Move';
    return (step.action || step.target) ? step : null;
  }
  const t = String(x ?? '').trim();
  return t ? { raw: t } : null;
}
function stepText(s) {
  if (!s) return '';
  if (s.raw) return s.raw;
  const a = s.action.toLowerCase();
  if (a === 'wait') {
    // target may already say "…signal" / lead with the counterpart's
    // possessive / "wait for" — never double any of them.
    let tgt = s.target.replace(/^wait\s+for\s+/i, '').replace(/\s*\bsignal\b\s*$/i, '');
    if (s.counterpart) {
      const esc = s.counterpart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      tgt = tgt.replace(new RegExp(`^${esc}['’]s\\s+`, 'i'), '');
      return `Wait for ${s.counterpart}'s ${tgt} signal`;
    }
    return `Wait for ${tgt}${s.detail ? ` — ${s.detail}` : ''}`;
  }
  if (a === 'signal' && s.counterpart) return `Signal ${s.target} to ${s.counterpart}`;
  if (a === 'home') return `Home: ${[s.target, s.detail].filter(Boolean).join(' — ') || 'initial position'}`;
  if (a === 'repeat') return 'Repeat';
  return `${s.action}${s.target ? ` ${s.target}` : ''}${s.detail ? ` — ${s.detail}` : ''}`.trim();
}
// ── RECOVERY IS A BRANCHING FLOW (Dan, 2026-08-30) ──────────────────────────
// Items: a step object/string, OR {decision:'Gripper Engaged?', branches:
// [{label:'Yes'|'No'|…, steps:[step|string]}]}. Strings stay the derived,
// persisted flat view; renders compose from the structure.
function flattenRecoveryItems(items) {
  const lineOf = (s) => (typeof s === 'string' ? s : stepText(s));
  const out = [];
  for (const it of (items ?? [])) {
    if (it && typeof it === 'object' && it.decision) {
      out.push(`◇ ${String(it.decision).trim()}`);
      for (const b of (it.branches ?? [])) {
        for (const s of (b.steps ?? [])) out.push(`${String(b.label ?? '?').trim()}: ${lineOf(s)}`);
      }
    } else if (it != null) {
      out.push(lineOf(it));
    }
  }
  return out.filter(Boolean);
}
function normalizeRecoveryItems(items) {
  return (Array.isArray(items) ? items : []).map((it) => {
    if (it && typeof it === 'object' && it.decision) {
      return {
        decision: String(it.decision).trim(),
        branches: (Array.isArray(it.branches) ? it.branches : []).map((b) => ({
          label: String(b?.label ?? 'Yes').trim(),
          steps: (Array.isArray(b?.steps) ? b.steps : [])
            .map((s) => (typeof s === 'string' ? s : normalizeStep(s))).filter(Boolean),
        })).filter((b) => b.steps.length),
      };
    }
    return typeof it === 'string' ? it : normalizeStep(it);
  }).filter((it) => it && (typeof it === 'string' || it.decision || it.action || it.target || it.raw));
}

// ── SEQUENCE VOCABULARY IS THE OPERATION SET (Dan, 2026-08-28; objective
// checker rule 2026-09-01): engine output is STRUCTURED steps/decisions
// only. A raw prose sequence line — one whose leading token is outside the
// operation vocabulary ("NEW stack setup", "PER-magnet cycle", "RE-clamp",
// "BACK to", "STACK change") — is an OBJECTIVE violation, flagged
// deterministically, never left to the model checker's judgment.
const SEQUENCE_ACTION_VOCAB = new Set([
  'extend', 'retract', 'engage', 'disengage', 'servo move', 'move', 'index',
  'wait', 'signal', 'home', 'repeat', 'decide', 'loop', 'hold', 'verify',
  'yes', 'no', 'rejoin',
]);
function vocabTokenOf(x) {
  if (x && typeof x === 'object' && !x.raw) return String(x.action ?? '').trim().toLowerCase();
  const t = String((x && typeof x === 'object') ? x.raw : x ?? '').trim();
  if (/^servo\s+move\b/i.test(t)) return 'servo move';
  return (t.match(/^([A-Za-z]+)/)?.[1] ?? '').toLowerCase();
}
function sequenceVocabViolations(machines) {
  const bad = [];
  const checkRows = (rows, where) => {
    (rows ?? []).forEach((s, i) => {
      if (s && typeof s === 'object' && s.decision) {
        for (const b of (s.branches ?? [])) checkRows(b.steps, `${where} "${s.decision}" ${b.label}-branch`);
        return;
      }
      const tok = vocabTokenOf(s);
      if (!tok || !SEQUENCE_ACTION_VOCAB.has(tok)) {
        const text = typeof s === 'string' ? s : (s?.raw ?? stepText(s));
        bad.push(`${where} line ${i + 1} is raw prose, not a structured step ("${String(text).slice(0, 80)}") — "${tok || '(empty)'}" is not in the operation vocabulary`);
      }
    });
  };
  for (const m of (machines ?? [])) {
    checkRows(m?.sequenceSteps ?? m?.sequence, `${m?.name ?? '?'} sequence`);
    checkRows(m?.faultRecoverySteps ?? m?.faultRecovery, `${m?.name ?? '?'} recovery`);
  }
  return bad;
}

function normalizeMachine(m) {
  const steps = (Array.isArray(m?.sequence) ? m.sequence : []).map(normalizeStep).filter(Boolean);
  const recoveryItems = normalizeRecoveryItems(m?.faultRecovery);
  return {
    faultRecovery: flattenRecoveryItems(recoveryItems),
    faultRecoverySteps: recoveryItems,
    // Natural display name, spaces kept ("Mid Base Escapement") — the
    // PascalCase PLC program name is derived at Generate, not here.
    name: String(m?.name ?? '').trim().replace(/\s+/g, ' '),
    oneLiner: String(m?.oneLiner ?? '').trim(),
    ownedDeviceNames: (Array.isArray(m?.ownedDeviceNames) ? m.ownedDeviceNames : [])
      .map((x) => String(x).trim()).filter(Boolean),
    why: String(m?.why ?? '').trim(),
    sequence: steps.map(stepText).filter(Boolean),
    sequenceSteps: steps,
  };
}

/**
 * @param {object} args
 * @param {string} args.description             the ME's raw explanation (required)
 * @param {Array}  [args.images]                [{name, base64, mediaType}] reference pictures
 * @param {string} [args.expectedStateMachines] the ME's own expectation, free text
 * @param {Array}  [args.otherSms]              [{name, displayName}] other stations
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{stateMachines:Array, reasoning:string, meta:object}>}
 */
async function decompose({ description, images = [], expectedStateMachines = '', otherSms = [], currentProposal = null, sheetDevices = [], signal = null }) {
  const client = getClient();
  let me = '';
  try { me = loadMeKnowledge(); } catch { /* knowledge optional */ }

  const system = [
    "You are JARVIS, SDC Automation's controls engineer. TASK: read a mechanical engineer's",
    'plain-words description of ONE station and propose ONLY its STATE MACHINE DECOMPOSITION —',
    'how the station splits into independently running state machines (PLC programs).',
    '',
    'THE ASYNCHRONY TEST: two mechanisms get separate state machines ONLY when they must run',
    'asynchronously — overlapping cycles, independent rates, or a handshake between them.',
    'A purely sequential station is ONE state machine. Never split for organization alone.',
    '',
    'NAMES (Dan, 2026-08-26): name each machine the way an SDC engineer would SAY it, with',
    'spaces — "Pick And Place", "Mid Base Escapement", "Dial Index" — SPECIFIC to what it',
    'handles, never a generic mechanism word alone ("Escapement" is not a name; many',
    'escapements exist — say what it escapes). No PascalCase here: the PLC program name is',
    'derived later.',
    '',
    'SEQUENCE LINES ARE THE ACTION ONLY (Dan, 2026-08-28): NO parenthetical annotations,',
    'ever — no "(250ms)", no "(finger1 + shuttle extended)", no "(X already at pick)".',
    'Values live on the device sheet; reasoning stays in your head. "Close gripper", not',
    '"Close gripper (250ms)".',
    '',
    'INTERACTIONS ARE SEQUENCE LINES (Dan, 2026-08-28): machines coordinate through lines IN',
    'their sequences — never a separate interactions list. Every such line NAMES the',
    'counterpart and uses the word "signal", in exactly ONE of two shapes:',
    '  incoming: "Wait for {Counterpart}\'s {thing} signal"  — e.g. "Wait for Escapement\'s part-ready signal", "Wait for Dial\'s ready signal"',
    '  outgoing: "Signal {thing} to {Counterpart}"           — e.g. "Signal part gripped to Escapement"',
    'Same shape every time so the counterpart always sits in the same place. NEVER the word',
    '"handshake" in a sequence line. Every wait-for-a-signal line must have its counterpart: the',
    'machine that SETS that signal does it at its own state transition, as a line in ITS sequence. Two',
    'scopes matter for the code: another machine in THIS station is program-to-program',
    'signaling inside the station; a DIFFERENT station entirely goes through the station\'s',
    'external interface — keep the counterpart\'s name exact so the scope is unambiguous.',
    '',
    'SCOPE ON CORRECTION ROUNDS: feedback about one machine edits THAT machine; touch',
    'another machine ONLY when a stated interaction requires it (a new signal needs both',
    'sides). Never reword another machine\'s lines in passing — carry them forward verbatim.',
    '',
    'TAG FEEDBACK IS NOT LINE FEEDBACK (Dan, 2026-08-28: "I didn\'t ask you to change these',
    'things"): the engineer sees each step with its interaction tag (the counterpart). A',
    'comment that a step "doesn\'t need to interact with X" / questions its tag CLEARS that',
    'step\'s counterpart and NOTHING ELSE — the step itself stays, word for word. DELETING a',
    'step requires the engineer explicitly asking to remove the step. When in doubt: keep the',
    'line, clear the tag.',
    '',
    'VOICE (Dan, 2026-08-26): the reasoning speaks directly TO the engineer — second person',
    '("Your description shows…"), NEVER about him ("the ME…", "the engineer\'s description…").',
    'ONE to TWO short sentences, no more.',
    "Weigh the engineer's stated expectation seriously — agree or counter WITH the reasoning",
    'shown; never silently ignore it, never blindly obey it.',
    '',
    'Respond with ONLY one JSON object (no markdown fences, no prose):',
    '{',
    '  "stateMachines": [',
    '    { "name": "<Natural Name With Spaces>",',
    '      "oneLiner": "<one sentence: what this machine owns and does>",',
    '      "ownedDeviceNames": ["<device name as the engineer said it>", ...],',
    '      "why": "<one line: why it must run asynchronously from the others (omit or empty for a single machine)>",',
    '      "sequence": [ { "deviceId": "<the device\'s devId when the step acts on a sheet device — the',
    '                        target NAME derives from this link and follows renames>",',
    '                      "action": "<ONE canonical operation — the SAME vocabulary as diagram actions:',
    '                        Extend|Retract (pneumatics) · Engage|Disengage (grippers — NEVER \'Open\'/\'Close\'',
    '                        a gripper, that is not SDC terminology) · Servo Move (servos — the target names',
    '                        the axis and the named position: target \'X Axis\', detail \'to Place\') ·',
    '                        Index (dial/indexer) · Wait|Signal|Home|Repeat (non-motion)>",',
    '                      "target": "<the device, sensor, or signal acted on — \'Escapement Finger One\', \'part ready for pick\'>",',
    '                      "detail": "<OPTIONAL short clause — \'stop the next part\'; omit when the action+target says it all>",',
    '                      "counterpart": "<OPTIONAL machine/station name — ONLY when this step is a REAL interaction:',
    '                        waiting on that machine\'s signal, or signaling to it. A motion that merely mentions a',
    '                        machine (\'Extend Shuttle to present the part to X\') gets NO counterpart. Home and Repeat',
    '                        NEVER have one.>" }, ... ],',
    '      "faultRecovery": [ <how THIS machine gets home safe from a mid-cycle fault — a BRANCHING FLOW,',
    '                        never prose with inline "if"s: linear steps until a DECISION, then labeled branches.',
    '                        Items are steps (same shape as sequence) or decisions:',
    '                        { "decision": "Gripper Engaged?", "branches": [ { "label": "Yes", "steps": [ … ] },',
    '                        { "label": "No", "steps": [ … ] } ] }. Retract vertical motion first; land in a',
    '                        known safe state. ALWAYS provide it. > ] }',
    '',
    'DETAIL RULES BY DEVICE TYPE (Dan): pneumatics are two-position devices — the action IS the',
    'whole statement ("Retract Vertical Slide", NEVER "— to clear height"; sensors/timers say when',
    'it\'s there). Servo Move DOES carry the named position as detail ("Servo Move X Axis — Place',
    'Position"). Waits/signals keep their object. TITLE CASE for named things everywhere: devices,',
    'named positions, signals ("Place Position", "Part-Ready Signal") — ordinary words stay normal.',
    '  ],',
    '  "reasoning": "<1-2 short sentences, spoken TO the engineer: the asynchrony reasoning behind this count>",',
    '  "noteToEngineer": "<OPTIONAL, usually omit. ONE plain sentence, ONLY when something the engineer',
    '    explicitly asked for was honored somewhere OTHER than a visible sequence line (e.g. folded into',
    '    a device parameter or an existing step) — tell him where it went so he never thinks it was',
    '    dropped. Never use this for style fixes or internals.>"',
    '}',
    loadDecompositionConcept(),
    // STRUCTURAL KNOWLEDGE CARRIAGE (Dan, 2026-08-28): every engine call
    // physically includes its knowledge — meKnowledge, precedents, and the
    // archetype/multi-SM concepts (the thousand-bowl facts) by construction.
    buildEngineContext(['meKnowledge', 'precedents', 'concepts:station-archetypes', 'concepts:multi-state-machine']),
  ].join('\n');

  const content = [];
  for (const img of images.slice(0, 6)) {
    if (img && img.base64 && String(img.mediaType || '').startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
    }
  }
  let userText = `# The engineer's explanation\n${String(description).trim()}`;
  // CORRECTION ROUNDS (Dan's one-engine law, 2026-08-28): the proposal being
  // revised rides along COMPLETE — the feedback edits IT; everything the
  // feedback doesn't touch carries forward VERBATIM (machines, sequences,
  // owned devices). Dictated feedback resolves its garbled words against the
  // REAL names in this proposal — never ignore a comment for odd wording, and
  // "looks good outside my comments" means: apply every comment, keep the rest.
  if (Array.isArray(sheetDevices) && sheetDevices.length) {
    userText += '\n\n# THE SHEET\'S DEVICES (real names — resolve dictated words against these)\n'
      + sheetDevices.map((d) => `- ${d.name}${d.type ? ` (${d.type})` : ''}`).join('\n');
  }
  if (Array.isArray(currentProposal) && currentProposal.length) {
    userText += '\n\n# YOUR CURRENT PROPOSAL (being revised — carry forward everything the feedback does not touch, verbatim)\n'
      + JSON.stringify(currentProposal, null, 1);
  }
  if (String(expectedStateMachines).trim()) {
    userText += `\n\n# The engineer expects (guidance — agree or counter with reasoning)\n${String(expectedStateMachines).trim()}`;
  }
  if (otherSms.length) {
    userText += `\n\n# Other stations in this machine\n${otherSms.map((s) => s.displayName || s.name).filter(Boolean).join(', ')}`;
  }
  content.push({ type: 'text', text: userText });

  const response = await client.messages.create(
    { model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content }] },
    signal ? { signal } : undefined
  );
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Decomposer response truncated at ${MAX_TOKENS} tokens`);
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = extractJson(text);
  const stateMachines = (Array.isArray(parsed.stateMachines) ? parsed.stateMachines : [])
    .map(normalizeMachine)
    .filter((m) => m.name);
  if (!stateMachines.length) throw new Error('The decomposer returned no state machines — retry');

  // THE CHECKER (Dan, 2026-08-28): the breakup is reviewed against the same
  // knowledge BEFORE the ME sees it. One bounce — a corrected decomposition
  // is adopted; violations ride along either way.
  let finalMachines = stateMachines;
  let finalReasoning = String(parsed.reasoning ?? '').trim();
  // NEVER-SILENT (Dan's eaten-message P0, 2026-08-28): when the engine honors
  // an ME request somewhere other than a visible sequence line, this sentence
  // tells him where it went. User-facing — rides to the chat as a Jarvis turn.
  let noteToEngineer = String(parsed.noteToEngineer ?? '').trim();
  let checked = null;
  let checkCost = 0;
  try {
    const chk = await checkProposal({
      kind: 'decomposition',
      payload: {
        stateMachines,
        reasoning: finalReasoning,
        correctionRound: !!(Array.isArray(currentProposal) && currentProposal.length),
      },
      description, signal,
    });
    checkCost = chk.meta.costUSD;
    checked = { verdict: chk.verdict, violations: chk.violations };
    if (chk.verdict === 'fix' && Array.isArray(chk.corrected?.stateMachines)) {
      const fixed = chk.corrected.stateMachines
        .map(normalizeMachine)
        .filter((m) => m.name);
      // ADOPTION GUARD (Dan's approved keys, 2026-08-28): on a correction
      // round the checker may fix CONTENT but never the machine identities —
      // a rename would orphan every approval keyed to the old names.
      const isCorrection = Array.isArray(currentProposal) && currentProposal.length > 0;
      const normId = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const sameIdentities = fixed.length === stateMachines.length
        && fixed.every((f) => stateMachines.some((m) => normId(m.name) === normId(f.name)));
      if (fixed.length && (!isCorrection || sameIdentities)) {
        finalMachines = fixed;
        if (String(chk.corrected.reasoning ?? '').trim()) finalReasoning = String(chk.corrected.reasoning).trim();
        if (String(chk.corrected.noteToEngineer ?? '').trim()) noteToEngineer = String(chk.corrected.noteToEngineer).trim();
        checked.corrected = true;
      } else if (fixed.length) {
        checked.violations = [...chk.violations, 'checker correction NOT adopted — it renamed/re-split approved machines on a correction round'];
      }
    }
  } catch (e) {
    checked = { verdict: 'unchecked', violations: [`checker unavailable: ${e.message}`] };
  }
  // OBJECTIVE VOCAB RULE (2026-09-01): raw prose sequence lines are flagged
  // deterministically — the model checker never gets to overlook them.
  {
    const objective = sequenceVocabViolations(finalMachines);
    if (objective.length) {
      checked = {
        verdict: 'fix',
        violations: [...(checked?.violations ?? []), ...objective],
        ...(checked?.corrected ? { corrected: true } : {}),
      };
    }
  }

  // IDENTITY LOCK on correction rounds (Dan's "Mid-Base" drift, 2026-08-28):
  // an identity-matched machine keeps its EXACT prior name — thinker and
  // checker drift ("Mid-Base Pick and Place") never touches approved names.
  if (Array.isArray(currentProposal) && currentProposal.length) {
    const normId2 = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    finalMachines = finalMachines.map((m) => {
      const prior = currentProposal.find((p) => normId2(p?.name) === normId2(m.name));
      return prior?.name ? { ...m, name: String(prior.name) } : m;
    });
  }

  return {
    stateMachines: finalMachines,
    reasoning: finalReasoning,
    noteToEngineer,
    checked,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: Number((costOf(response.usage, response.model || MODEL) + checkCost).toFixed(4)),
    },
  };
}

// ── assignDevices — AGENTIC device→machine assignment (Dan, 2026-08-28:
// "Why is it a guess? Aren't you using our standards, our history, our code
// examples?"). The client's deterministic layers handle only the CERTAIN
// cases (ME-explicit, exact owned-name claims); everything else lands here in
// ONE cheap batched call that decides like an SDC controls engineer — from
// precedents, the concept files, and standing knowledge — and states its
// EVIDENCE. precedent:false means the search genuinely found nothing: the
// sheet then asks the ME (once, ever — the answer files as doctrine). ────────

const ASSIGN_MODEL = process.env.JARVIS_ASSIGN_MODEL || 'claude-haiku-4-5';
function loadConceptFile(name) {
  try {
    return require('fs').readFileSync(
      path.join(__dirname, '..', '..', '..', 'jarvis-knowledge', 'concepts', name), 'utf8').trim();
  } catch { return ''; }
}

/**
 * @param {object} args
 * @param {Array}  args.devices     [{name, type, purpose}] — the UNRESOLVED devices only
 * @param {Array}  args.machines    [{name, key, ownedDeviceNames, sequence}]
 * @param {string} [args.description] the ME's station explanation (context)
 * @returns {Promise<{assignments:[{device,machine,evidence,precedent}], meta}>}
 */
async function assignDevices({ devices, machines, description = '', directives = [], signal = null }) {
  if (!Array.isArray(devices) || !devices.length) return { assignments: [], meta: { costUSD: 0 } };
  if (!Array.isArray(machines) || machines.length < 2) throw new Error('assignDevices needs >= 2 machines');
  const client = getClient();
  let me = '';
  try { me = loadMeKnowledge(); } catch { /* optional */ }
  const { precedentsBlock } = require('./precedents');
  const system = [
    "You are JARVIS, SDC Automation's controls engineer. TASK: decide which state machine",
    'each listed device runs with — the way a senior SDC CE would: from SDC\'s SHIPPED WORK,',
    'standards, and the concept notes below. Never guess from word similarity.',
    '',
    'For each device: name the machine, and give ONE line of EVIDENCE citing the precedent',
    '("in our shipped escapement stations the bowl runs with the feeding machine — FlexFeeder,',
    'the escapement pattern"). Return the device name EXACTLY as given — never reworded.',
    '',
    'PRECEDENT HONESTY: "precedent": true ONLY when this DEVICE CLASS actually appears in the',
    'precedent lists, concept notes, or standing knowledge below — you can point at the line.',
    'A device class absent from ALL of them is "precedent": false EVEN IF general engineering',
    'logic suggests a placement — then still pick the most sensible machine, and the evidence',
    'line states plainly: no SDC example of this device class exists. Never dress a general',
    'inference up as a precedent.',
    '',
    'Respond with ONLY one JSON object (no fences):',
    '{ "assignments": [ { "device": "<exact device name given>", "machine": "<exact machine name given>",',
    '    "evidence": "<one line>", "precedent": true|false } ] }',
    '',
    // STRUCTURAL KNOWLEDGE CARRIAGE (Dan, 2026-08-28): assembled in ONE
    // place — a pass cannot exist without its knowledge riding along.
    buildEngineContext(['meKnowledge', 'precedents', 'concepts:station-archetypes', 'concepts:multi-state-machine']),
  ].join('\n');
  const userText = [
    '# The station (the engineer\'s explanation)',
    String(description).trim() || '(none given)',
    '',
    '# The state machines',
    ...machines.map((m) => `- ${m.name}: owns [${(m.ownedDeviceNames ?? []).join(', ')}]`
      + ((m.sequence ?? []).length ? `; sequence: ${(m.sequence ?? []).join(' → ')}` : '')),
    '',
    '# Devices to place (one decision each)',
    ...devices.map((d) => `- ${d.name} (${d.type ?? 'unknown type'})${d.purpose ? ` — ${d.purpose}` : ''}`),
    ...((Array.isArray(directives) ? directives : []).filter(Boolean).length
      ? ['', "# THE ENGINEER RULED (honor these — his word outranks precedent; if one violates a hard SDC standard, still honor it and say so in the evidence)",
        ...directives.filter(Boolean).map((x) => `- ${String(x).trim()}`)]
      : []),
  ].join('\n');
  const response = await client.messages.create(
    { model: ASSIGN_MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: userText }] },
    signal ? { signal } : undefined
  );
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = extractJson(text);
  let assignments = canonAssignments(parsed.assignments, devices, machines);

  // THE CHECKER (Dan, 2026-08-28): a second engineer reviews the placement
  // against the same knowledge BEFORE it renders. One bounce max — a fix
  // with corrections is adopted; violations ride the response either way.
  let checked = null;
  let checkCost = 0;
  try {
    const chk = await checkProposal({
      kind: 'assignment',
      payload: {
        machines: machines.map((m) => ({ name: m.name, ownedDeviceNames: m.ownedDeviceNames ?? [] })),
        assignments,
      },
      description, signal,
    });
    checkCost = chk.meta.costUSD;
    checked = { verdict: chk.verdict, violations: chk.violations };
    if (chk.verdict === 'fix' && Array.isArray(chk.corrected?.assignments)) {
      const fixed = canonAssignments(chk.corrected.assignments, devices, machines);
      if (fixed.length) {
        const byDev = new Map(fixed.map((a) => [a.device.toLowerCase(), a]));
        assignments = assignments.map((a) => byDev.get(a.device.toLowerCase()) ?? a);
        for (const f of fixed) {
          if (!assignments.some((a) => a.device.toLowerCase() === f.device.toLowerCase())) assignments.push(f);
        }
        checked.corrected = true;
      }
    }
  } catch (e) {
    checked = { verdict: 'unchecked', violations: [`checker unavailable: ${e.message}`] };
  }

  return {
    assignments,
    checked,
    meta: {
      model: response.model || ASSIGN_MODEL,
      usage: response.usage || null,
      costUSD: Number((costOf(response.usage, response.model || ASSIGN_MODEL) + checkCost).toFixed(4)),
    },
  };
}

/** Canonicalize model assignment rows back onto the REQUESTED device names
 *  and REAL machines (models sometimes echo "PlasmaWelder (Custom)"). */
function canonAssignments(list, devices, machines) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (Array.isArray(list) ? list : [])
    .map((a) => {
      const machine = machines.find((m) => norm(m.name) === norm(a?.machine))
        ?? machines.find((m) => norm(m.name).includes(norm(a?.machine)) || norm(a?.machine).includes(norm(m.name)));
      const given = devices.find((d) => norm(d?.name) === norm(a?.device))
        ?? devices.find((d) => norm(a?.device).includes(norm(d?.name)) || norm(d?.name).includes(norm(a?.device)));
      return machine && given ? {
        device: String(given.name),
        machine: machine.name,
        machineKey: machine.key,
        evidence: String(a?.evidence ?? '').trim(),
        precedent: a?.precedent === true,
      } : null;
    })
    .filter((a) => a && a.device);
}

// ── checkProposal — THE CHECKER (Dan, 2026-08-28: "an agent that really
// understands SDC state machines… then a CHECKER trained on the same
// information that checks the thinker's proposal BEFORE we build/render it"
// — Jason's process applied to the spec sheet, exactly like internalReviewer
// does for code). Same knowledge as the thinker; verdict pass|fix; one
// bounce max, then surface honestly. ─────────────────────────────────────────

const CHECK_MODEL = process.env.JARVIS_SPEC_CHECK_MODEL || 'claude-haiku-4-5';

/**
 * @param {object} args
 * @param {'decomposition'|'assignment'} args.kind
 * @param {object} args.payload   decomposition: {stateMachines, reasoning};
 *                                assignment: {machines, assignments}
 * @param {string} [args.description]
 * @returns {Promise<{verdict:'pass'|'fix', violations:string[], corrected:object|null, meta}>}
 */
async function checkProposal({ kind, payload, description = '', signal = null }) {
  const client = getClient();
  let me = '';
  try { me = loadMeKnowledge(); } catch { /* optional */ }
  const { precedentsBlock } = require('./precedents');
  const system = [
    "You are JARVIS's CHECKER — a second SDC controls engineer reviewing the first one's",
    `proposal (${kind}) BEFORE it reaches the mechanical engineer. Same question as every SDC`,
    'review: is it correct, and is it the SDC way — per the shipped work, the concept notes,',
    'and standing knowledge below?',
    kind === 'assignment'
      ? 'SCOPE: check ONLY the device→machine ownership and each "precedent" claim (a feeder '
        + 'bowl owned by a pick-and-place violates every dial station SDC has shipped; '
        + '"precedent": true the knowledge does not support is a violation). Names are NOT in '
        + 'scope here — never flag naming.'
      : kind === 'sheet-correction'
        ? 'SCOPE: the engineer gave feedback (often dictated — words that match no real name '
          + 'are phonetic slips; resolve them against the sheet\'s actual device/position/step '
          + 'names in the payload, never via alias tables) and the thinker returned a revised '
          + 'sheet. Check ONE thing: was EVERY edit embedded in the feedback actually APPLIED, '
          + 'the SDC way? Approval-with-comments is approval PLUS edits — each comment must '
          + 'show up in the revision. A substantive edit missing from the revision is a '
          + 'violation — name it precisely. Style/naming is NOT in scope. Always set '
          + '"corrected": null for this kind.'
        : 'SCOPE: check the split (asynchrony justification per machine — a purely sequential '
          + 'station is ONE machine), the device ownership implied by ownedDeviceNames, and the '
          + 'machine names (natural SDC speech with spaces — "Mid Base Escapement"; NEVER '
          + 'underscores or PascalCase here, the PLC program name is derived later). STEP-SCOPED '
          + 'OUTPUT (Dan, 2026-09-01): a step-1 proposal is names + one-liners ONLY — NEVER flag '
          + 'missing sequences/devices/recoveries on a step-1 proposal; those belong to later '
          + 'steps. A name the engineer dictated (nameByME) is verbatim law — flag any change '
          + 'to it. Words the engineer never used are violations (no invented vocabulary). '
          + 'EXCEPTION — '
          + 'CORRECTION ROUNDS (payload.correctionRound true): the engineer already approved this '
          + 'proposal and gave feedback on it; check ONLY that the feedback was applied and the '
          + 'untouched content carried forward verbatim. Machine names and the split itself are '
          + 'NOT in scope then — never rename or re-split what he already approved. '
          + 'UNREQUESTED DELETIONS: a sequence step present in the prior proposal but missing '
          + 'from the revision, with no explicit "remove that step" in the feedback, is a '
          + 'violation — restore it. Feedback about a step\'s INTERACTION ("doesn\'t need to '
          + 'interact with X") clears that step\'s counterpart tag only; it never deletes the '
          + 'step. '
          + 'ALWAYS in scope — REMOVAL PROPAGATION: when the feedback removes a device, the '
          + 'corrected proposal must reference it NOWHERE — not in any ownedDeviceNames, sequence '
          + 'line, or fault-recovery line. A half-removed device (dropped from ownership but still '
          + 'named in a line, or vice versa) is a violation — fix it outright. '
          + 'ALWAYS in scope — SIGNALS: every "Wait for X\'s ... signal" line must have a '
          + 'counterpart line in machine X\'s sequence that sets it (and clears it where the cycle '
          + 'repeats); a wait nobody sets, or a set nobody waits on, is a violation. Sequence lines '
          + 'never use the word "handshake" — the word is "signal", with the counterpart named.',
    '',
    'Respond with ONLY one JSON object (no fences):',
    '{ "verdict": "pass" | "fix",',
    '  "violations": ["<one line each — empty when pass>"],',
    kind === 'assignment'
      ? '  "corrected": { "assignments": [ { "device": "...", "machine": "...", "evidence": "...", "precedent": true|false } ] } | null }'
      : '  "corrected": { "stateMachines": [ ...same shape as proposed... ], "reasoning": "...", "noteToEngineer": "<optional>" } | null }',
    'Provide "corrected" ONLY when you can fix it outright from the knowledge; otherwise null.',
    'NEVER-SILENT RULE: if your correction moves something the engineer explicitly asked for OFF a',
    'visible sequence line (e.g. a blow-off pulse becomes a device parameter on an existing step),',
    'you MUST say where it went in "noteToEngineer" — one plain sentence to him. His request must',
    'never just vanish from what he sees.',
    '',
    // STRUCTURAL KNOWLEDGE CARRIAGE (Dan, 2026-08-28): the checker reads the
    // SAME assembled knowledge as the thinker — by construction.
    buildEngineContext(['meKnowledge', 'precedents', 'concepts:station-archetypes', 'concepts:multi-state-machine']),
  ].join('\n');
  const userText = [
    '# The station (the engineer\'s explanation)',
    String(description).trim() || '(none given)',
    '',
    `# The ${kind} proposal to check`,
    JSON.stringify(payload, null, 1),
  ].join('\n');
  const response = await client.messages.create(
    { model: CHECK_MODEL, max_tokens: 2000, system, messages: [{ role: 'user', content: userText }] },
    signal ? { signal } : undefined
  );
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = extractJson(text);
  return {
    verdict: parsed.verdict === 'fix' ? 'fix' : 'pass',
    violations: (Array.isArray(parsed.violations) ? parsed.violations : []).map(String).filter(Boolean),
    corrected: parsed.corrected && typeof parsed.corrected === 'object' ? parsed.corrected : null,
    meta: {
      model: response.model || CHECK_MODEL,
      usage: response.usage || null,
      costUSD: Number(costOf(response.usage, response.model || CHECK_MODEL).toFixed(4)),
    },
  };
}

module.exports = { decompose, assignDevices, checkProposal, normalizeStep, stepText, flattenRecoveryItems, normalizeRecoveryItems, normalizeMachine, sequenceVocabViolations };
