/**
 * specAuthor.js — "Explain this station" -> machineSpec extraction.
 *
 * authorSpec({ description, images, sm, otherSms, existingSpec }):
 *   Sends the engineer's free-form station explanation (plus optional CAD
 *   screenshots) to Claude and gets back a structured machineSpec (purpose,
 *   devicePurposes, outcomeRules, relationships) PLUS a devices delta:
 *   - proposedDevices: devices mentioned in the text but not yet configured
 *     on the SM (typed with the deviceTypes.js vocabulary)
 *   - unmentionedDeviceIds: configured devices the text never mentioned
 *   and 2-5 clarifying questions.
 *
 * The caller (SpecEditorModal via POST /api/jarvis/spec) renders the result
 * as a review screen; nothing is persisted here.
 *
 * CommonJS, plain Node — required lazily by server.js.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { costOfUsage, AiNotConfiguredError } = require('./client');

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
const MAX_TOKENS = parseInt(process.env.JARVIS_SPEC_MAX_TOKENS, 10) || 8000;

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

// Device vocabulary the model may propose (mirrors src/lib/deviceTypes.js).
const DEVICE_VOCAB = `
Device types (EXACT strings) and their sensorArrangement options:
  PneumaticLinearActuator  — cylinder/slide/shuttle/lift. sensorArrangement: 'No sensors' | '1-sensor (Ret only)' | '2-sensor (Ext + Ret)' (default '2-sensor (Ext + Ret)')
  PneumaticRotaryActuator  — rotary. Same sensorArrangement options.
  PneumaticGripper         — gripper. sensorArrangement: 'No sensors' | '1-sensor (Closed only)' | '2-sensor (Closed + Open)'
  PneumaticVacGenerator    — vacuum pick. No sensorArrangement.
  ServoAxis                — servo axis / dial indexer. No sensorArrangement.
  Timer                    — pure delay. No sensorArrangement.
  DigitalSensor            — presence/discrete sensor. No sensorArrangement.
  AnalogSensor             — analog measurement. No sensorArrangement.
  VisionSystem             — camera inspection. No sensorArrangement.
  Robot                    — robot interface. No sensorArrangement.
  Conveyor                 — conveyor. No sensorArrangement.
  Parameter                — soft flag/value. No sensorArrangement.
`;

const REL_KINDS = ['feeds', 'consumes', 'requests-index', 'signals', 'custom'];

const OUTPUT_SPEC = `
# Your response

Respond with ONLY one JSON object (no markdown fences, no prose):
{
  "spec": {
    "purpose": "<one sentence: what this station is for>",
    "devicePurposes": { "<existing device id>": "<what that device is physically for, in the engineer's words>", ... },
    "outcomeRules": [
      { "trigger": "<when this happens>", "response": "<what to do about it>",
        "retryCount": <integer, ONLY if the text states a number of tries>,
        "escalation": "<what to do when the tries run out — '' if none stated>" }
    ],
    "relationships": [
      { "withSmId": "<id of the other station from the STATIONS list>", "withSmName": "<its name>",
        "kind": "<one of: ${REL_KINDS.join(' | ')}>",
        "description": "<one sentence describing the interaction>" }
    ]
  },
  "proposedDevices": [
    { "name": "<PascalCase, no spaces>", "displayName": "<Friendly_Name>",
      "type": "<exact device type string>", "sensorArrangement": "<option, only for pneumatic types>",
      "purpose": "<what it is for, from the text>" }
  ],
  "unmentionedDeviceIds": ["<existing device id the text never mentioned>", ...],
  "questions": ["<2-5 clarifying questions about genuine ambiguities>"]
}

Rules of engagement:
- devicePurposes keys MUST be ids of the EXISTING devices listed below. Match generously:
  the engineer says "the shuttle" / "the horizontal slide" — map it to the configured device whose
  name is closest. Only propose a NEW device when nothing configured plausibly matches.
- proposedDevices: full-word PascalCase names (SDC standard, no abbreviations). Include
  sensorArrangement only for pneumatic types, choosing from that type's options.
- unmentionedDeviceIds: every existing device the description said nothing about.
- outcomeRules: one rule per distinct failure the text describes. retryCount only when a number
  of tries is stated. Keep trigger/response/escalation in the engineer's plain language.
- relationships: withSmId MUST be one of the ids in the STATIONS list — never invent an id.
  kinds: feeds = sends parts to, consumes = receives parts from, requests-index = asks for a
  dial/index move, signals = tells something to, custom = anything else.
- Do not invent behavior the text does not state; ask about it in questions instead.
`;

function extractJson(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Model response contained no JSON object');
  }
  return JSON.parse(t.slice(start, end + 1));
}

const VALID_TYPES = new Set([
  'PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper',
  'PneumaticVacGenerator', 'ServoAxis', 'Timer', 'DigitalSensor', 'AnalogSensor',
  'VisionSystem', 'Robot', 'Conveyor', 'Parameter',
]);

let _uidN = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(_uidN++).toString(36)}`;

/** Normalize + validate the model output against the real SM context. */
function normalizeResult(parsed, sm, otherSms) {
  const fixups = [];
  const out = {
    spec: { purpose: '', devicePurposes: {}, outcomeRules: [], relationships: [] },
    proposedDevices: [],
    unmentionedDeviceIds: [],
    questions: [],
  };
  const spec = parsed?.spec && typeof parsed.spec === 'object' ? parsed.spec : {};
  out.spec.purpose = String(spec.purpose || '').trim();

  const deviceIds = new Set((sm?.devices || []).map(d => d.id));
  for (const [id, txt] of Object.entries(spec.devicePurposes || {})) {
    if (!deviceIds.has(id)) { fixups.push(`dropped devicePurpose for unknown device id "${id}"`); continue; }
    if (String(txt || '').trim()) out.spec.devicePurposes[id] = String(txt).trim();
  }

  for (const r of Array.isArray(spec.outcomeRules) ? spec.outcomeRules : []) {
    if (!r || (!String(r.trigger || '').trim() && !String(r.response || '').trim())) continue;
    const rule = {
      id: uid('or'),
      trigger: String(r.trigger || '').trim(),
      response: String(r.response || '').trim(),
      escalation: String(r.escalation || '').trim(),
    };
    const n = Number(r.retryCount);
    if (Number.isFinite(n) && n > 0) rule.retryCount = Math.round(n);
    out.spec.outcomeRules.push(rule);
  }

  const smById = new Map((otherSms || []).map(s => [s.id, s]));
  const smByName = new Map((otherSms || []).map(s => [String(s.displayName || s.name || '').toLowerCase(), s]));
  for (const r of Array.isArray(spec.relationships) ? spec.relationships : []) {
    if (!r) continue;
    let target = smById.get(r.withSmId);
    if (!target && r.withSmName) target = smByName.get(String(r.withSmName).toLowerCase());
    if (!target) {
      fixups.push(`relationship with unknown station "${r.withSmName || r.withSmId}" kept without id`);
    }
    out.spec.relationships.push({
      id: uid('rel'),
      withSmId: target ? target.id : '',
      withSmName: target ? (target.displayName || target.name) : String(r.withSmName || ''),
      kind: REL_KINDS.includes(r.kind) ? r.kind : 'custom',
      description: String(r.description || '').trim(),
    });
  }

  const existingNames = new Set((sm?.devices || []).flatMap(d =>
    [d.name, d.displayName].filter(Boolean).map(s => String(s).toLowerCase())));
  for (const p of Array.isArray(parsed.proposedDevices) ? parsed.proposedDevices : []) {
    if (!p || !p.name || !VALID_TYPES.has(p.type)) {
      if (p) fixups.push(`dropped proposed device "${p.name || '?'}" — invalid type "${p.type}"`);
      continue;
    }
    if (existingNames.has(String(p.name).toLowerCase())
      || existingNames.has(String(p.displayName || '').toLowerCase())) {
      fixups.push(`dropped proposed device "${p.name}" — already configured`);
      continue;
    }
    out.proposedDevices.push({
      name: String(p.name).replace(/\s+/g, ''),
      displayName: String(p.displayName || p.name),
      type: p.type,
      sensorArrangement: p.sensorArrangement ? String(p.sensorArrangement) : undefined,
      purpose: String(p.purpose || '').trim(),
    });
  }

  for (const id of Array.isArray(parsed.unmentionedDeviceIds) ? parsed.unmentionedDeviceIds : []) {
    if (deviceIds.has(id) && !out.spec.devicePurposes[id]) out.unmentionedDeviceIds.push(id);
  }

  out.questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map(String).slice(0, 6);
  return { result: out, fixups };
}

/**
 * @param {object} opts
 * @param {string} opts.description   Free-form station explanation (required)
 * @param {Array<{name?:string, base64:string, mediaType:string}>} [opts.images]
 * @param {object} opts.sm            { id, name, displayName, devices:[{id,name,displayName,type,sensorArrangement}], drawnSteps:[string] }
 * @param {Array}  [opts.otherSms]    [{ id, name, displayName }] — the other stations in the project
 * @param {object} [opts.existingSpec] previously saved machineSpec (context for re-extraction)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ spec, proposedDevices, unmentionedDeviceIds, questions, fixups, meta }>}
 */
async function authorSpec({ description, images = [], sm = {}, otherSms = [], existingSpec = null, signal = null } = {}) {
  if (!description || !String(description).trim()) {
    throw new Error('description is required');
  }
  const client = getClient();

  const deviceLines = (sm.devices || []).map(d =>
    `  - id "${d.id}": ${d.displayName || d.name} (${d.type}${d.sensorArrangement ? `, ${d.sensorArrangement}` : ''})`
  ).join('\n') || '  (none configured yet)';
  const stationLines = (otherSms || []).map(s =>
    `  - id "${s.id}": ${s.displayName || s.name}`
  ).join('\n') || '  (no other stations)';
  const drawnLines = (sm.drawnSteps || []).length
    ? '\nDrawn sequence already on the canvas (context only):\n'
      + sm.drawnSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
    : '';

  const system =
    'You are JARVIS, the SDC Automation station-spec extractor. A manufacturing engineer explains ' +
    'an automation station in plain language, the way they would to a new engineer. You extract a ' +
    'structured Station Spec from EXACTLY what they said — their words, their intent, nothing invented.\n' +
    DEVICE_VOCAB + OUTPUT_SPEC;

  const content = [];
  for (const img of images.slice(0, 8)) {
    if (!img || !img.base64) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
    });
  }
  content.push({
    type: 'text',
    text:
      `STATION being specified: "${sm.displayName || sm.name || 'Unknown'}"\n\n` +
      `EXISTING configured devices on this station:\n${deviceLines}\n\n` +
      `STATIONS (other state machines in this project — relationships resolve against these ids):\n${stationLines}\n` +
      drawnLines +
      (existingSpec ? `\nPreviously saved spec (being revised — context only):\n${JSON.stringify(existingSpec)}\n` : '') +
      `\nEngineer's explanation:\n\n${String(description).trim()}` +
      (images.length ? `\n\n(${images.length} image(s) of the station/CAD are attached above.)` : ''),
  });

  const req = { model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content }] };
  if (/^claude-(fable|opus)-/.test(MODEL)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused the request: ' + (response.stop_details?.explanation || 'no reason given'));
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Model response truncated at ${MAX_TOKENS} tokens — try a shorter description`);
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = extractJson(text);
  const { result, fixups } = normalizeResult(parsed, sm, otherSms);

  const costUSD = response.usage ? costOfUsage(response.usage, MODEL) : 0;
  return {
    ...result,
    fixups,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: Number(costUSD.toFixed(4)),
    },
  };
}

// ── summarizeDescription — "Done explaining" cleanup + coverage verdict ─────
//
// Cheap, fast call: restates the engineer's raw explanation as a clean,
// STRUCTURED summary — four scannable sections (devices, sequence,
// failureHandling, interactions) returned as JSON arrays — plus a
// per-checklist-item coverage verdict (replacing the local regex heuristics
// once it exists) and 2-4 questions back to the engineer. Used by
// CreateStationPage's summary loop; the final Build then runs on the
// serialized summary (+ original appended as reference).

// Token budget is generous on purpose — the user's explanation length is
// sacred and a structured JSON summary won't come near 16K. Never tell the
// user to shorten their description. The real limit is COST, enforced by the
// client per summary loop (JARVIS_SUMMARIZE_MAX_COST_USD, default $5,
// surfaced via meta.maxCostUSD below).
const SUMMARIZE_MAX_TOKENS = parseInt(process.env.JARVIS_SUMMARIZE_MAX_TOKENS, 10) || 16000;
const SUMMARIZE_MAX_COST_USD = parseFloat(process.env.JARVIS_SUMMARIZE_MAX_COST_USD) || 5;

const COVERAGE_KEYS = ['devices', 'sequence', 'failures', 'interactions'];

const SUMMARIZE_OUTPUT = `
# Your response

Respond with ONLY one JSON object (no markdown fences, no prose):
{
  "devices": [
    { "name": "<device name, the engineer's term>", "purpose": "<one short line: what it is for>" }
  ],
  "sequence": ["<one short line per cycle step, in order>", ...],
  "failureHandling": [
    { "when": "<the failure case>", "then": "<what should happen>",
      "retries": <integer, ONLY if a number of tries was stated>,
      "whenExhausted": "<what happens when the tries run out — omit if not stated>" }
  ],
  "interactions": [
    { "station": "<other station's name>", "how": "<one short line: the interaction>" }
  ],
  "coverage": {
    "devices":      { "score": 0|1|2, "missing": "<one short line: what is still missing — '' when score is 2>" },
    "sequence":     { "score": 0|1|2, "missing": "..." },
    "failures":     { "score": 0|1|2, "missing": "..." },
    "interactions": { "score": 0|1|2, "missing": "..." }
  },
  "questions": ["<2-4 short questions back to the engineer about genuine gaps or ambiguities>"]
}

Summary rules:
- Each array restates what the engineer SAID — their intent, cleaned up and organized into
  short scannable lines. Faithful: never invent devices, steps, numbers, or behavior they
  did not state. A section with nothing stated is an EMPTY array.
- Keep the engineer's device names/terms. Fix grammar and rambling, not meaning.
- sequence: one physical step per line, no numbering prefix (the UI numbers them).
- interactions: "station" should match one of the project's other station names when possible.

Coverage rules (2 = fully covered, 1 = mentioned briefly, 0 = not covered):
- devices: are the physical devices named with what each is for?
- sequence: is the cycle walked step by step, in order?
- failures: are failure cases given WITH what should happen about them?
- interactions: are relationships to other stations stated (feeds / waits for / tells / hands off)?
  When the project has no other stations this may be scored 2 with missing "".
- "missing": actionable and specific ("the gripper's open/closed sensing isn't stated"), not generic.
`;

/**
 * @param {object} opts
 * @param {string} opts.description       The engineer's raw explanation (required)
 * @param {Array}  [opts.images]          [{name?, base64, mediaType}]
 * @param {object} [opts.checklist]       local heuristic scores (context only)
 * @param {object} [opts.sm]              { name, displayName }
 * @param {Array}  [opts.otherSms]        [{ name, displayName }]
 * @param {string} [opts.priorSummary]    previous summary being revised (serialized text)
 * @param {string} [opts.corrections]     the engineer's correction text
 * @param {AbortSignal} [opts.signal]
 * @param {function} [opts.onProgress]    (pct, stage) — real progress, 0-100.
 *   5 = request sent, 10-95 ramps with streamed output (thinking deltas at
 *   half weight, like client.js), 100 = response parsed. stage is one of
 *   'sent' | 'reading' | 'writing' | 'done'.
 * @returns {Promise<{ summary: {devices,sequence,failureHandling,interactions}, coverage, questions, meta }>}
 */

// Expected summary output for the streaming progress ramp. The response is
// typically 700-1500 tokens of JSON; ~1200 keeps the ramp honest.
const SUMMARIZE_EXPECTED_OUTPUT_TOKENS = 1200;

async function summarizeDescription({
  description, images = [], checklist = null, sm = {}, otherSms = [],
  priorSummary = '', corrections = '', signal = null, onProgress = null,
} = {}) {
  if (!description || !String(description).trim()) {
    throw new Error('description is required');
  }
  const client = getClient();

  const stationLines = (otherSms || []).map(s => `  - ${s.displayName || s.name}`).join('\n')
    || '  (no other stations in this project yet)';

  const system =
    'You are JARVIS, the SDC Automation station explainer. A manufacturing engineer has just ' +
    'finished explaining an automation station out loud (dictated and/or typed — expect rambling, ' +
    'repetition, speech artifacts). You restate it cleanly and judge how complete it is. You NEVER ' +
    'invent behavior — everything in the summary must come from what they said.\n' + SUMMARIZE_OUTPUT;

  const content = [];
  for (const img of images.slice(0, 8)) {
    if (!img || !img.base64) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
    });
  }
  let text =
    `STATION being described: "${sm.displayName || sm.name || 'Unknown'}"\n\n` +
    `Other stations in this project:\n${stationLines}\n`;
  if (checklist && typeof checklist === 'object') {
    text += `\nLocal keyword-heuristic checklist scores (rough context only — your verdict replaces them): ${JSON.stringify(checklist)}\n`;
  }
  text += `\nEngineer's raw explanation:\n\n${String(description).trim()}`;
  if (priorSummary && String(priorSummary).trim()) {
    text += `\n\nYour PREVIOUS summary (being revised):\n\n${String(priorSummary).trim()}`;
  }
  if (corrections && String(corrections).trim()) {
    text += `\n\nEngineer's CORRECTIONS to apply (these override anything they conflict with above):\n\n${String(corrections).trim()}`;
  }
  if (images.length) text += `\n\n(${images.length} image(s) of the station/CAD are attached above.)`;
  content.push({ type: 'text', text });

  const progress = typeof onProgress === 'function' ? onProgress : null;
  if (progress) { try { progress(5, 'sent'); } catch (_) {} }

  // Never punish a long explanation: if a response somehow hits the token
  // budget, auto-retry ONCE with double the budget before surfacing anything.
  let response = null;
  let totalCostUSD = 0;
  let maxTokens = SUMMARIZE_MAX_TOKENS;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const req = { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
    if (/^claude-(fable|opus)-/.test(MODEL)) {
      req.betas = ['server-side-fallback-2026-07-01'];
      req.fallbacks = 'default';
    }
    const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
    if (progress) {
      // Same pattern as client.js callModel: text deltas ramp the bar against
      // the expected output size; adaptive thinking can run before any text
      // streams, so thinking deltas count at half weight to keep it moving.
      const expectedChars = SUMMARIZE_EXPECTED_OUTPUT_TOKENS * 4; // rough tokens->chars
      let chars = 0;
      let thinkingChars = 0;
      const emit = () => {
        const frac = Math.min((chars + thinkingChars * 0.5) / expectedChars, 1);
        const pct = 10 + 85 * frac; // 10 -> 95
        try { progress(pct, chars > 0 ? 'writing' : 'reading'); } catch (_) {}
      };
      stream.on('text', (delta) => { chars += delta.length; emit(); });
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          thinkingChars += (event.delta.thinking || '').length;
          emit();
        }
      });
    }
    response = await stream.finalMessage();
    if (response.usage) totalCostUSD += costOfUsage(response.usage, MODEL);
    if (response.stop_reason === 'refusal') {
      throw new Error('Model refused the request: ' + (response.stop_details?.explanation || 'no reason given'));
    }
    if (response.stop_reason === 'max_tokens') {
      if (attempt === 1) { maxTokens *= 2; continue; }
      throw new Error(
        `Summary response hit the ${maxTokens}-token output budget twice — ` +
        'raise JARVIS_SUMMARIZE_MAX_TOKENS in .env'
      );
    }
    break;
  }
  const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = extractJson(raw);

  // Normalize
  const coverage = {};
  for (const k of COVERAGE_KEYS) {
    const c = parsed.coverage && parsed.coverage[k];
    const score = c && [0, 1, 2].includes(Number(c.score)) ? Number(c.score) : 0;
    coverage[k] = { score, missing: String((c && c.missing) || '').trim() };
  }
  const str = (v) => String(v == null ? '' : v).trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const summary = {
    devices: arr(parsed.devices)
      .map(d => ({ name: str(d && d.name), purpose: str(d && d.purpose) }))
      .filter(d => d.name || d.purpose),
    sequence: arr(parsed.sequence).map(str).filter(Boolean),
    failureHandling: arr(parsed.failureHandling)
      .map(f => {
        const rule = { when: str(f && f.when), then: str(f && f.then) };
        const n = Number(f && f.retries);
        if (Number.isFinite(n) && n > 0) rule.retries = Math.round(n);
        const ex = str(f && f.whenExhausted);
        if (ex) rule.whenExhausted = ex;
        return rule;
      })
      .filter(f => f.when || f.then),
    interactions: arr(parsed.interactions)
      .map(x => ({ station: str(x && x.station), how: str(x && x.how) }))
      .filter(x => x.station || x.how),
  };
  if (!summary.devices.length && !summary.sequence.length
    && !summary.failureHandling.length && !summary.interactions.length) {
    throw new Error('Model returned an empty summary');
  }
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map(q => String(q).trim()).filter(Boolean).slice(0, 4);
  if (progress) { try { progress(100, 'done'); } catch (_) {} }

  return {
    summary,
    coverage,
    questions,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: Number(totalCostUSD.toFixed(4)),
      // Per-summary-loop cost ceiling — the CLIENT gates on its running total.
      maxCostUSD: SUMMARIZE_MAX_COST_USD,
    },
  };
}

module.exports = { authorSpec, summarizeDescription };
