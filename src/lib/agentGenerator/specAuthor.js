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
const { loadMeKnowledge } = require('./meKnowledge');

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
  "questions": ["<0-3 questions, mechanical intent only — obey the Question policy above>"]
}

Rules of engagement:
- devicePurposes keys MUST be ids of the EXISTING devices listed below. Match generously:
  the engineer says "the shuttle" / "the horizontal slide" — map it to the configured device whose
  name is closest. Only propose a NEW device when nothing configured plausibly matches.
- proposedDevices: full-word PascalCase names (SDC standard, no abbreviations). Include
  sensorArrangement only for pneumatic types, choosing from that type's options.
  Obey the Device taxonomy above: never propose valves, EOAT assemblies, timers,
  or HMI elements as devices — decompose to the actual actuated mechanism.
- unmentionedDeviceIds: every existing device the description said nothing about.
- outcomeRules: one rule per distinct failure the text describes. retryCount only when a number
  of tries is stated. Keep trigger/response/escalation in the engineer's plain language.
- relationships: withSmId MUST be one of the ids in the STATIONS list — never invent an id.
  kinds: feeds = sends parts to, consumes = receives parts from, requests-index = asks for a
  dial/index move, signals = tells something to, custom = anything else.
- Do not invent behavior the text does not state; ask about it in questions instead.
- questions: obey the Question policy above — never ask about Standing SDC facts, learned
  facts, or controls-architecture decisions. Zero questions is a good answer.
  NEVER ask a question whose answer is derivable from the description, the engineer's
  prior answers (Q&A history in the message), the standing knowledge above, or an
  earlier question in this session. Asked-and-answered is answered forever — repeating
  or REPHRASING an earlier question is forbidden.
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

  out.questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map(String).slice(0, 3);
  return { result: out, fixups };
}

/**
 * @param {object} opts
 * @param {string} opts.description   Free-form station explanation (required)
 * @param {Array<{name?:string, base64:string, mediaType:string}>} [opts.images]
 * @param {object} opts.sm            { id, name, displayName, devices:[{id,name,displayName,type,sensorArrangement}], drawnSteps:[string] }
 * @param {Array}  [opts.otherSms]    [{ id, name, displayName }] — the other stations in the project
 * @param {object} [opts.existingSpec] previously saved machineSpec (context for re-extraction)
 * @param {string} [opts.corrections]  the engineer's answers/corrections this round (Apply answers)
 * @param {number} [opts.round]        how many Q&A rounds have already run
 * @param {Array}  [opts.qaHistory]    [{ questions:[string], answer:string }] — asked-and-answered, never re-asked
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ spec, proposedDevices, unmentionedDeviceIds, questions, fixups, meta }>}
 */
async function authorSpec({
  description, images = [], sm = {}, otherSms = [], existingSpec = null,
  corrections = '', round = 0, qaHistory = [], signal = null,
} = {}) {
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

  const meKnowledge = loadMeKnowledge();
  const system =
    'You are JARVIS, the SDC Automation station-spec extractor. A manufacturing engineer explains ' +
    'an automation station in plain language, the way they would to a new engineer. You extract a ' +
    'structured Station Spec from EXACTLY what they said — their words, their intent, nothing invented.\n' +
    (meKnowledge ? '\n' + meKnowledge + '\n' : '') +
    DEVICE_VOCAB + OUTPUT_SPEC;

  const content = [];
  for (const img of images.slice(0, 8)) {
    if (!img || !img.base64) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
    });
  }
  let userText =
    `STATION being specified: "${sm.displayName || sm.name || 'Unknown'}"\n\n` +
    `EXISTING configured devices on this station:\n${deviceLines}\n\n` +
    `STATIONS (other state machines in this project — relationships resolve against these ids):\n${stationLines}\n` +
    drawnLines +
    (existingSpec ? `\nPreviously saved spec (being revised — context only):\n${JSON.stringify(existingSpec)}\n` : '') +
    `\nEngineer's explanation:\n\n${String(description).trim()}`;
  // Q&A history + corrections — same discipline as the summarize path: an
  // asked-and-answered question is answered forever, in every rewording.
  const qa = (Array.isArray(qaHistory) ? qaHistory : []).filter(r => r && (r.questions?.length || r.answer));
  if (qa.length) {
    userText += '\n\nQ&A HISTORY this session (questions you already asked and the engineer\'s answers — '
      + 'NEVER re-ask these or anything derivable from them, in any wording):\n'
      + qa.map((r, i) =>
        `Round ${i + 1}:\n`
        + (r.questions || []).map(q => `  Q: ${q}`).join('\n')
        + (r.answer ? `\n  A: ${String(r.answer).trim()}` : '')
      ).join('\n');
  }
  if (corrections && String(corrections).trim()) {
    userText += `\n\nEngineer's ANSWERS / CORRECTIONS to apply (these override anything they conflict with above — fold them into the spec):\n\n${String(corrections).trim()}`;
  }
  const roundN = Number(round) || 0;
  if (roundN >= 2) {
    userText += '\n\nLATE-ROUND QUESTION DISCIPLINE: the engineer has already answered '
      + (qa.length ? `${qa.length} round(s) of questions` : 'questions')
      + '. Apply the self-answer test with maximum strictness now: a new question is allowed ONLY '
      + 'if a correct spec is impossible without it AND it has never been asked or answered in any '
      + 'form this session. Everything else: decide per SDC standards and fold the decision into '
      + 'the spec — decisions, not questions. Repeating or rephrasing an earlier question is forbidden.';
  }
  if (images.length) userText += `\n\n(${images.length} image(s) of the station/CAD are attached above.)`;
  content.push({ type: 'text', text: userText });

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

  // Backstop (mirrors summarizeDescription): drop any question that is a
  // repeat/rephrase of one already asked this session — the prompt forbids
  // it, this guarantees it.
  const priorQs = qa.flatMap(r => r.questions || []).map(q => String(q).toLowerCase());
  if (priorQs.length) {
    result.questions = result.questions.filter(q => {
      const words = String(q).toLowerCase().split(/\W+/).filter(w => w.length > 3);
      return !priorQs.some(pq => {
        const shared = words.filter(w => pq.includes(w)).length;
        return words.length > 0 && shared / words.length > 0.6;
      });
    });
  }

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
    { "name": "<device name, the engineer's term>", "purpose": "<one short line: what it is for>",
      "type": "<EXACT device type string from the Device types list — omit if genuinely unsure>" }
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
  "io": {
    "sensors": [ { "name": "<sensor name/purpose, the engineer's term>", "type": "<short kind, e.g. 'prox', 'photo eye', 'analog' — omit if not stated>",
                   "purpose": "<one short line — omit if the name already says it>" } ],
    "valveFunctions": ["<one short line per valve function, e.g. 'gripper open/close — 1 double-solenoid'>", ...],
    "ioNotes": "<one short line of other IO detail the engineer stated — '' if none>"
  },
  "questions": ["<0-3 short questions, mechanical intent only — obey the Question policy>"],
  "learnedFacts": [
    { "fact": "<a standing rule or fact the engineer stated/corrected, one tight sentence>",
      "scope": "sdc-standard" | "this-project" }
  ],
  "nonStandardFlags": [
    { "what": "<what the engineer asked for, their words>",
      "standard": "<the SDC standard it contradicts, one tight sentence>",
      "severity": "note" | "warning" }
  ]
}

Summary rules:
- Each array restates what the engineer SAID — their intent, cleaned up and organized into
  short scannable lines. Faithful: never invent devices, steps, numbers, or behavior they
  did not state. A section with nothing stated is an EMPTY array.
- TIGHT output. Device purposes: 8 words or fewer. Sequence steps: 10 words or fewer.
  No filler adjectives, no restating the obvious. Every line must scan in one glance.
- devices: obey the Device taxonomy above. Valves, EOAT assemblies, timers, and HMI
  elements are NOT devices — decompose to the actual actuated mechanism (an "EOAT with a
  gripper" is ONE device: the gripper). Keep the engineer's terms for real devices.
  "type" must be one of the EXACT Device types strings; omit it rather than guess wildly.
- io: OPTIONAL capture, never a requirement. Include it ONLY when the engineer explicitly
  mentioned sensors, valves, solenoids, or IO counts — otherwise OMIT the "io" key entirely.
  It records station IO for the machine's valve-bank and IO-bank layout. It has NO coverage
  item and NEVER generates questions unless something stated is truly ambiguous. Empty
  arrays / empty string for anything not mentioned.
- sequence: one physical step per line, no numbering prefix (the UI numbers them).
- interactions: "station" should match one of the project's other station names when possible.
- questions: obey the Question policy above — never ask about Standing SDC facts, learned
  facts, or controls-architecture decisions. Zero questions is a good answer.
  NEVER ask a question whose answer is derivable from the description, the engineer's
  prior answers (Q&A history in the message), the standing knowledge above, or an
  earlier question in this session. Asked-and-answered is answered forever.

Coverage monotonicity:
- When the message includes your PREVIOUS coverage verdicts, coverage may only IMPROVE.
  A section previously scored 2 stays 2; a 1 may become 2, never 0. The engineer answering
  questions adds information — it never removes any.
- learnedFacts: when the engineer states or corrects a RULE (not a description of this
  station), capture it. scope "sdc-standard" = a standing rule that applies to every
  future station ("servo speeds always live in the HMI"); scope "this-project" = true
  only here ("this gripper has no sensors"). Only facts the engineer actually stated —
  usually an empty array. Never repeat a fact already in the standing knowledge above.

Non-standard detection (nonStandardFlags):
- Compare the engineer's description against the Standing SDC facts and Learned
  knowledge above. When the description asks for something that CONTRADICTS one of
  those standards — not merely something new or unmentioned — add one flag per
  contradiction: "what" = the request in the engineer's words, "standard" = the SDC
  standard it contradicts, "severity" = "warning" when it removes a safety/diagnostic
  behavior (fault timers, lockout, retries before faulting), "note" otherwise.
- Do NOT silently comply, and do NOT refuse or "correct" the summary: the summary
  still restates EXACTLY what the engineer asked for. The flag is a heads-up for
  controls-engineer review, nothing more. Never turn a flag into a question.
- Something the standards don't cover is NOT a flag. Most descriptions produce an
  empty array — omit the key or return [] when nothing contradicts a standard.

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
  priorSummary = '', corrections = '', round = 0, qaHistory = [],
  priorCoverage = null, signal = null, onProgress = null,
} = {}) {
  if (!description || !String(description).trim()) {
    throw new Error('description is required');
  }
  const client = getClient();

  const stationLines = (otherSms || []).map(s => `  - ${s.displayName || s.name}`).join('\n')
    || '  (no other stations in this project yet)';

  const meKnowledge = loadMeKnowledge();
  const system =
    'You are JARVIS, an intelligent SDC controls engineer listening to a MECHANICAL engineer ' +
    'who has just finished explaining an automation station out loud (dictated and/or typed — ' +
    'expect rambling, repetition, speech artifacts). You restate it cleanly and TIGHTLY and ' +
    'judge how complete it is. You already know how SDC does controls — you never ask the ME ' +
    'about it. You NEVER invent behavior — everything in the summary must come from what they ' +
    'said.\n' +
    (meKnowledge ? '\n' + meKnowledge + '\n' : '') +
    DEVICE_VOCAB + SUMMARIZE_OUTPUT;

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
  if (priorCoverage && typeof priorCoverage === 'object') {
    text += `\n\nYour PREVIOUS coverage verdicts (monotonic — scores may only improve): ${JSON.stringify(priorCoverage)}`;
  }
  const qa = (Array.isArray(qaHistory) ? qaHistory : []).filter(r => r && (r.questions?.length || r.answer));
  if (qa.length) {
    text += '\n\nQ&A HISTORY this session (questions you already asked and the engineer\'s answers — '
      + 'NEVER re-ask these or anything derivable from them):\n'
      + qa.map((r, i) =>
        `Round ${i + 1}:\n`
        + (r.questions || []).map(q => `  Q: ${q}`).join('\n')
        + (r.answer ? `\n  A: ${String(r.answer).trim()}` : '')
      ).join('\n');
  }
  if (corrections && String(corrections).trim()) {
    text += `\n\nEngineer's CORRECTIONS to apply (these override anything they conflict with above):\n\n${String(corrections).trim()}`;
  }
  const roundN = Number(round) || 0;
  if (roundN >= 2) {
    text += '\n\nLATE-ROUND QUESTION DISCIPLINE: the engineer has already answered '
      + (qa.length ? `${qa.length} round(s) of questions` : 'questions')
      + '. Apply the self-answer test with maximum strictness now: a new question is allowed ONLY '
      + 'if correct logic is impossible without it AND it has never been asked or answered in any '
      + 'form this session. Everything else: decide per SDC standards and fold the decision into '
      + 'the summary — decisions, not questions. Repeating or rephrasing an earlier question is forbidden.';
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
    let score = c && [0, 1, 2].includes(Number(c.score)) ? Number(c.score) : 0;
    let missing = String((c && c.missing) || '').trim();
    // Hard monotonic clamp: never regress below the prior verdict.
    const prior = priorCoverage && priorCoverage[k] && Number(priorCoverage[k].score);
    if ([1, 2].includes(prior) && prior > score) {
      score = prior;
      if (score === 2) missing = '';
    }
    coverage[k] = { score, missing };
  }
  const str = (v) => String(v == null ? '' : v).trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const summary = {
    devices: arr(parsed.devices)
      .map(d => ({
        name: str(d && d.name),
        purpose: str(d && d.purpose),
        // Exact deviceTypes.js string when the model gave a valid one —
        // drives the device icon in the summary UI. Dropped when invalid.
        ...(d && VALID_TYPES.has(d.type) ? { type: d.type } : {}),
      }))
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
  // Optional station-IO capture: only present when the engineer mentioned
  // sensors / valves / IO counts (feeds the machine's valve/IO-bank layout).
  // Never gates anything; omitted entirely when empty.
  if (parsed.io && typeof parsed.io === 'object') {
    const io = {
      sensors: arr(parsed.io.sensors)
        .map(x => {
          const s = { name: str(x && x.name) };
          const ty = str(x && x.type);
          const pu = str(x && x.purpose);
          if (ty) s.type = ty;
          if (pu) s.purpose = pu;
          return s;
        })
        .filter(x => x.name || x.purpose),
      valveFunctions: arr(parsed.io.valveFunctions).map(str).filter(Boolean),
      ioNotes: str(parsed.io.ioNotes),
    };
    if (io.sensors.length || io.valveFunctions.length || io.ioNotes) summary.io = io;
  }
  if (!summary.devices.length && !summary.sequence.length
    && !summary.failureHandling.length && !summary.interactions.length) {
    throw new Error('Model returned an empty summary');
  }
  // Question policy (Dan): no hard cap — the self-answer test in meKnowledge.md
  // governs. Backstops only: dedupe against every question already asked this
  // session (no repeats/rephrases sneaking through), soft-cap at 5 per round.
  const priorQs = (Array.isArray(qaHistory) ? qaHistory : [])
    .flatMap(r => r.questions || []).map(q => String(q).toLowerCase());
  const isRepeat = (q) => {
    const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    return priorQs.some(pq => {
      const shared = words.filter(w => pq.includes(w)).length;
      return words.length > 0 && shared / words.length > 0.6;
    });
  };
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map(q => String(q).trim()).filter(Boolean)
    .filter(q => !isRepeat(q))
    .slice(0, 5);
  // Learned standing rules the engineer stated — only what the model
  // explicitly returned; the server decides what persists.
  const learnedFacts = (Array.isArray(parsed.learnedFacts) ? parsed.learnedFacts : [])
    .map(f => ({
      fact: String((f && f.fact) || '').trim(),
      scope: (f && f.scope) === 'sdc-standard' ? 'sdc-standard' : 'this-project',
    }))
    .filter(f => f.fact)
    .slice(0, 8);
  // Non-standard requests the model flagged (description contradicts a
  // Standing SDC fact / learned rule). Flag + proceed — never a gate.
  const nonStandardFlags = (Array.isArray(parsed.nonStandardFlags) ? parsed.nonStandardFlags : [])
    .map(f => ({
      what: String((f && f.what) || '').trim(),
      // The UI labels this "SDC standard:" — strip the model's own prefix.
      standard: String((f && f.standard) || '').trim()
        .replace(/^(?:the\s+)?SDC\s+standard(?:\s+is)?[:\s]\s*/i, ''),
      severity: (f && f.severity) === 'warning' ? 'warning' : 'note',
    }))
    .filter(f => f.what && f.standard)
    .slice(0, 8);
  if (progress) { try { progress(100, 'done'); } catch (_) {} }

  return {
    summary,
    coverage,
    questions,
    learnedFacts,
    nonStandardFlags,
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
