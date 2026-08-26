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
const { precedentsBlock } = require('./precedents');

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

/**
 * @param {object} args
 * @param {string} args.description             the ME's raw explanation (required)
 * @param {Array}  [args.images]                [{name, base64, mediaType}] reference pictures
 * @param {string} [args.expectedStateMachines] the ME's own expectation, free text
 * @param {Array}  [args.otherSms]              [{name, displayName}] other stations
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{stateMachines:Array, reasoning:string, meta:object}>}
 */
async function decompose({ description, images = [], expectedStateMachines = '', otherSms = [], signal = null }) {
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
    '      "sequence": ["<short step, one line>", ...] }',
    '  ],',
    '  "reasoning": "<1-2 short sentences, spoken TO the engineer: the asynchrony reasoning behind this count>"',
    '}',
    me ? '\n# Standing SDC knowledge\n' + me : '',
    loadDecompositionConcept(),
    // PRECEDENT PACK (Dan, 2026-08-26): past work is the baseline — names
    // come from what SDC has actually shipped, never from an invented style.
    precedentsBlock(),
  ].join('\n');

  const content = [];
  for (const img of images.slice(0, 6)) {
    if (img && img.base64 && String(img.mediaType || '').startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
    }
  }
  let userText = `# The engineer's explanation\n${String(description).trim()}`;
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
    .map((m) => ({
      // Natural display name, spaces kept ("Mid Base Escapement") — the
      // PascalCase PLC program name is derived at Generate, not here.
      name: String(m?.name ?? '').trim().replace(/\s+/g, ' '),
      oneLiner: String(m?.oneLiner ?? '').trim(),
      ownedDeviceNames: (Array.isArray(m?.ownedDeviceNames) ? m.ownedDeviceNames : [])
        .map((x) => String(x).trim()).filter(Boolean),
      why: String(m?.why ?? '').trim(),
      sequence: (Array.isArray(m?.sequence) ? m.sequence : [])
        .map((x) => String(x).trim()).filter(Boolean),
    }))
    .filter((m) => m.name);
  if (!stateMachines.length) throw new Error('The decomposer returned no state machines — retry');

  return {
    stateMachines,
    reasoning: String(parsed.reasoning ?? '').trim(),
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: Number(costOf(response.usage, response.model || MODEL).toFixed(4)),
    },
  };
}

module.exports = { decompose };
