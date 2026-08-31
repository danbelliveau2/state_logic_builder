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
 *   and clarifying questions (no quota, no cap — the Question policy in
 *   meKnowledge.md governs; the only post-filter is repeat/reword dedupe).
 *
 * The caller (SpecEditorModal via POST /api/jarvis/spec) renders the result
 * as a review screen; nothing is persisted here.
 *
 * CommonJS, plain Node — required lazily by server.js.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { costOfUsage, AiNotConfiguredError } = require('./client');
const { precedentsBlock } = require('./precedents'); // eslint-disable-line no-unused-vars
const { buildEngineContext } = require('./engineContext');

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
      "purpose": "<what it is for, from the text>",
      "strokeMm": <number, pneumatic types ONLY and ONLY if the text states the stroke>,
      "delays": { "extendMs": <int>, "retractMs": <int> } }
  ],
  "unmentionedDeviceIds": ["<existing device id the text never mentioned>", ...],
  "questions": ["<every question that genuinely passes the self-answer test, mechanical intent only — no quota, no cap; zero is fine, ten real ones are fine>"]
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
  facts, or controls-architecture decisions. Ask EVERY question that genuinely passes the
  self-answer test — there is no quota and no cap; ten real questions are fine, zero is
  fine. Never pad, never suppress.
  THE BOUNDARY (Dan's law): your questions are MECHANICAL-INTENT questions for the ME —
  this describe phase is the ONLY place geometry/model questions are ever asked (positions,
  heights, clearances, transition points, strokes). They are never controls questions and
  are never re-asked at compile. If the station's device/position tables already contain a
  value, the table IS the answer — USE it, never ask for it.
  NEVER ask a question whose answer is derivable from the description, the engineer's
  prior answers (Q&A history in the message), the standing knowledge above, or an
  earlier question in this session. Asked-and-answered is answered forever — repeating
  or REPHRASING an earlier question is forbidden. "You decide" / "skip that" / "don't
  need to answer" is a COMPLETE answer: make the decision per SDC standards, record it,
  and never ask that question (or a reworded version of it) again.
- ASK GEOMETRY / MECHANICAL-INTENT QUESTIONS NOW — this phase is the ONLY place
  they get asked (the compile step is forbidden from asking them and will
  otherwise guess with *Verify placeholders). When the station's devices IMPLY
  a geometry value the description never stated, that question passes the
  self-answer test by definition — ask it here, upfront:
  · servo axes present → the real named positions and their intent (home, pick,
    place), transition heights (fast-to-here-slow-the-rest points), and
    blend-start clearance when moves may overlap;
  · pneumatics with strokes that matter → end positions / part-present posture;
  · pick/place stations → home-vs-pick relationship if ambiguous.
  Never ask for exact numeric coordinates the ME would tune later — ask for the
  positions/heights/clearances as named intent (what exists and when it's safe).
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

// ── Station-data-sheet device fields (mirrors deviceTypes.js options) ───────
const SENSOR_OPTIONS = {
  PneumaticLinearActuator: ['No sensors', '1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
  PneumaticRotaryActuator: ['No sensors', '1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
  PneumaticGripper: ['No sensors', '1-sensor (Closed only)', '2-sensor (Closed + Open)'],
};

/** Snap a model-returned sensorArrangement onto the exact option string for
 *  the device type. null when it can't be matched (field then omitted). */
function matchSensorArrangement(type, raw) {
  const options = SENSOR_OPTIONS[type];
  if (!options || !raw) return null;
  const s = String(raw).toLowerCase();
  const exact = options.find(o => o.toLowerCase() === s);
  if (exact) return exact;
  if (/no\s*sensor|sensor-?less|timer\s*only|none/.test(s)) return options[0];
  if (/2|both|ext.*ret|closed.*open/.test(s)) return options[2];
  if (/1|only|single|ret|closed/.test(s)) return options[1];
  return null;
}

const finiteNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** SDC device-name style (Dan, Aug 24): first letter of EVERY word capitalized
 *  — XAxis, ZAxis, PartGripper. Applied on extraction to new device names;
 *  existing configured devices are never renamed here. */
function capDeviceName(s) {
  const t = String(s ?? '').trim();
  if (!t) return t;
  return t.replace(/(^|[\s_-]+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

/** Snap a model-returned pneumatic home onto the canonical op value for the
 *  type. null when unmatched (field then omitted → sheet default applies). */
function matchHomeState(type, raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (type === 'PneumaticGripper') {
    if (/disengage|open/.test(s)) return 'Disengage';
    if (/engage|clos/.test(s)) return 'Engage';
    return null;
  }
  if (/retract|ccw|home/.test(s)) return 'Retract';
  if (/extend|(^|[^c])cw/.test(s)) return 'Extend';
  return null;
}

/** Validate the optional data-sheet fields on a summarize device entry.
 *  Everything absent/invalid is simply omitted — presence means "the
 *  engineer's words stated this". */
function normalizeSheetFields(d) {
  if (!d || typeof d !== 'object') return {};
  const out = {};
  const type = VALID_TYPES.has(d.type) ? d.type : null;
  if (type && SENSOR_OPTIONS[type]) {
    const sa = matchSensorArrangement(type, d.sensorArrangement);
    if (sa) out.sensorArrangement = sa;
    const stroke = finiteNum(d.strokeMm);
    if (stroke !== null && stroke > 0) out.strokeMm = stroke;
    if (d.delays && typeof d.delays === 'object') {
      const ext = finiteNum(d.delays.extendMs);
      const ret = finiteNum(d.delays.retractMs);
      const delays = {};
      if (ext !== null && ext >= 0) delays.extendMs = Math.round(ext);
      if (ret !== null && ret >= 0) delays.retractMs = Math.round(ret);
      if (Object.keys(delays).length) out.delays = delays;
    }
    const hs = matchHomeState(type, d.homeState ?? d.homePosition);
    if (hs) out.homeState = hs;
  }
  if (type === 'ServoAxis') {
    const positions = (Array.isArray(d.positions) ? d.positions : [])
      .map(p => {
        const name = String((p && p.name) || '').trim().replace(/\s+/g, '');
        if (!name) return null;
        const v = finiteNum(p.valueMm);
        return v === null ? { name } : { name, valueMm: v };
      })
      .filter(Boolean);
    if (positions.length) out.positions = positions;
    // Extra named speeds (beyond Fast/Slow) — echoed sheets must not lose
    // them on agentic corrections rounds.
    const speedProfiles = (Array.isArray(d.speedProfiles) ? d.speedProfiles : [])
      .map(sp => {
        const name = String((sp && sp.name) || '').trim().replace(/\s+/g, '');
        const v = finiteNum(sp && sp.mmS);
        return name && v !== null ? { name, mmS: v } : null;
      })
      .filter(Boolean);
    if (speedProfiles.length) out.speedProfiles = speedProfiles;
    const hp = String(d.homePosition ?? '').trim().replace(/\s+/g, '');
    if (hp) out.homePosition = hp;
    if (d.speeds && typeof d.speeds === 'object') {
      const fast = finiteNum(d.speeds.fastMmS);
      const slow = finiteNum(d.speeds.slowMmS);
      const speeds = {};
      if (fast !== null && fast > 0) speeds.fastMmS = fast;
      if (slow !== null && slow > 0) speeds.slowMmS = slow;
      if (Object.keys(speeds).length) out.speeds = speeds;
    }
    // ROTARY / DIAL config (Dan's Magnet Dial round, 2026-08-25): fixtures
    // and degrees, never index-distance-in-mm.
    const mt = String(d.motionType ?? '').toLowerCase();
    if (mt === 'rotary' || mt === 'linear') out.motionType = mt;
    const fc = finiteNum(d.fixtureCount);
    if (fc !== null && fc >= 2) out.fixtureCount = Math.round(fc);
    const inc = finiteNum(d.indexIncrementDeg);
    if (inc !== null && inc > 0) out.indexIncrementDeg = inc;
  }
  return out;
}

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
    const sheet = normalizeSheetFields(p);
    out.proposedDevices.push({
      name: capDeviceName(String(p.name)).replace(/\s+/g, ''),
      displayName: capDeviceName(String(p.displayName || p.name)),
      type: p.type,
      sensorArrangement: sheet.sensorArrangement
        ?? (p.sensorArrangement ? String(p.sensorArrangement) : undefined),
      purpose: String(p.purpose || '').trim(),
      ...(sheet.strokeMm !== undefined ? { strokeMm: sheet.strokeMm } : {}),
      ...(sheet.delays ? { delays: sheet.delays } : {}),
    });
  }

  for (const id of Array.isArray(parsed.unmentionedDeviceIds) ? parsed.unmentionedDeviceIds : []) {
    if (deviceIds.has(id) && !out.spec.devicePurposes[id]) out.unmentionedDeviceIds.push(id);
  }

  // No count cap (Dan: no quota, no cap) — repeat/reword dedupe happens in
  // filterQuestions() at the call site; NOTHING is ever trimmed by count.
  out.questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map(q => String(q).trim()).filter(Boolean);
  return { result: out, fixups };
}

/** Question backstop — the ONLY post-filter on model questions (Dan: "no
 *  quota and no cap; ten real questions are fine, zero is fine — never pad,
 *  never suppress"). Drops repeats/rephrases of anything already asked this
 *  session; NEVER trims by count. A skip-style answer ("you decide", "skip
 *  that", "don't need to answer") is a COMPLETE answer — its questions sit in
 *  qaHistory like any substantively-answered ones, so they dedupe here exactly
 *  the same way and are never re-asked. */
function filterQuestions(rawQuestions, qaHistory) {
  const priorQs = (Array.isArray(qaHistory) ? qaHistory : [])
    .flatMap(r => (r && r.questions) || [])
    .map(q => String(q).toLowerCase());
  const isRepeat = (q) => {
    const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    return priorQs.some(pq => {
      const shared = words.filter(w => pq.includes(w)).length;
      return words.length > 0 && shared / words.length > 0.6;
    });
  };
  return (Array.isArray(rawQuestions) ? rawQuestions : [])
    .map(q => String(q).trim()).filter(Boolean)
    .filter(q => !isRepeat(q));
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

  // PRECEDENT PACK (Dan, 2026-08-26): every step grounds in shipped names.
  // One-brain law: ALL engine calls assemble context through buildEngineContext
  // (CE doctrine rides the meKnowledge source — never a direct load).
  const meKnowledge = buildEngineContext(['meKnowledge', 'precedents', 'concepts:station-archetypes', 'concepts:multi-state-machine']);
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
      + 'NEVER re-ask these or anything derivable from them, in any wording. An answer like '
      + '"you decide" / "skip that" / "don\'t need to answer" is a COMPLETE answer: decide it '
      + 'per SDC standards, record the decision, and never ask it again in any form):\n'
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

  // Backstop (shared with summarizeDescription): drop any question that is a
  // repeat/rephrase of one already asked this session — the prompt forbids
  // it, this guarantees it. No count trimming, ever.
  result.questions = filterQuestions(result.questions, qa);

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
// once it exists) and clarifying questions back to the engineer (no quota,
// no cap — the Question policy governs). Used by
// CreateStationPage's summary loop; the final Build then runs on the
// serialized summary (+ original appended as reference).

// Token budget is generous on purpose — the user's explanation length is
// sacred and a structured JSON summary won't come near 16K. Never tell the
// user to shorten their description. The real limit is COST, enforced by the
// client per summary loop (JARVIS_SUMMARIZE_MAX_COST_USD, default $5,
// surfaced via meta.maxCostUSD below).
const SUMMARIZE_MAX_TOKENS = parseInt(process.env.JARVIS_SUMMARIZE_MAX_TOKENS, 10) || 16000;
// Loop-era default (Dan, 2026-08-30): opus agent turns count against this
// ceiling too; $5 stranded a mid-walk draft with a disabled Send.
const SUMMARIZE_MAX_COST_USD = parseFloat(process.env.JARVIS_SUMMARIZE_MAX_COST_USD) || 25;

const COVERAGE_KEYS = ['devices', 'sequence', 'failures', 'interactions'];

const SUMMARIZE_OUTPUT = `
# Your response

Respond with ONLY one JSON object (no markdown fences, no prose):
{
  "devices": [
    { "name": "<device name, the engineer's term>", "purpose": "<one short line: what it is for>",
      "type": "<EXACT device type string from the Device types list — omit if genuinely unsure>",
      "sensorArrangement": "<pneumatic types ONLY, ONLY when the engineer's words state the sensor setup — the EXACT option string for that type>",
      "strokeMm": <number, pneumatic types ONLY and ONLY if the stroke was stated>,
      "delays": { "extendMs": <int>, "retractMs": <int> },
      "positions": [ { "name": "<PascalCase named position>", "valueMm": <number ONLY if stated> } ],
      "speeds": { "fastMmS": <number ONLY if stated>, "slowMmS": <number ONLY if stated> },
      "motionType": "<ServoAxis ONLY: 'rotary' for a dial / rotary index table axis, 'linear' otherwise — set 'rotary' whenever the words describe a dial, indexer table, or motion in degrees>",
      "fixtureCount": <int, rotary ServoAxis ONLY: the number of fixtures/nests around the dial, ONLY when the engineer's words state it ("ten fixtures around the dial" → 10)>,
      "homePosition": "<ServoAxis ONLY: the named position this axis rests at when the station is home — ONLY when the engineer's words state it>",
      "homeState": "<pneumatic types ONLY, ONLY when stated: 'Retract' | 'Extend' (cylinder/rotary) or 'Disengage' | 'Engage' (gripper)>"
    }
  ],
  "sequence": ["<one short line per cycle step, in order>", ...],
  "failureHandling": [
    { "when": "<the failure case / recovery condition>", "then": "<what should happen>",
      "retries": <integer, ONLY if a number of tries was stated>,
      "whenExhausted": "<what happens when the tries run out — omit if not stated>" }
  ],
  "interactions": [
    { "station": "<other station's name>", "how": "<one short line: the interaction>" }
  ],
  "coverage": {
    "devices":      { "covered": true } | { "covered": false, "needs": [ { "question": "<one SPECIFIC concrete question>", "proposedSolution": "<your proposed answer — how you plan to handle it>", "blocking": true|false } ] },
    "sequence":     { "covered": ..., "needs": [...] },
    "failures":     { "covered": ..., "needs": [...] },
    "interactions": { "covered": ..., "needs": [...] }
  },
  "io": {
    "sensors": [ { "name": "<sensor name/purpose, the engineer's term>", "type": "<short kind, e.g. 'prox', 'photo eye', 'analog' — omit if not stated>",
                   "purpose": "<one short line — omit if the name already says it>" } ],
    "valveFunctions": ["<one short line per valve function, e.g. 'gripper open/close — 1 double-solenoid'>", ...],
    "ioNotes": "<one short line of other IO detail the engineer stated — '' if none>"
  },
  "expectedStateMachines": [
    { "name": "<short SM name the engineer expects, e.g. 'Dial Indexer'>",
      "note": "<optional one-liner of their intent for it — '' if none>" }
  ],
  "questions": ["<every question that genuinely passes the self-answer test, mechanical intent only — no quota, no cap; zero is fine, ten real ones are fine>"],
  "learnedFacts": [
    { "fact": "<a standing rule or fact the engineer stated/corrected, one tight sentence>",
      "scope": "sdc-standard" | "this-project" }
  ],
  "nonStandardFlags": [
    { "what": "<what the engineer asked for, their words>",
      "standard": "<the SDC standard it contradicts, one tight sentence>",
      "severity": "note" | "warning" }
  ],
  "changesMade": [
    { "section": "devices" | "sequence" | "failureHandling" | "interactions" | "io",
      "text": "<one short sentence: what changed>" }
  ],
  "approvedDeviations": [
    { "what": "<the deviation now in force, one tight sentence — e.g. 'single speed on VerticalAxis, no speed transitions'>",
      "reason": "<the engineer's stated reason, their words — '' if none given>" }
  ],
  "chatReply": "<OPTIONAL, corrections rounds only: TERSE — at most one short acknowledgment sentence plus only your genuine questions; never an echo of what the engineer said — see The corrections chat below>"
}

Summary rules:
- Each array restates what the engineer SAID — their intent, cleaned up and organized into
  short scannable lines. Faithful: never invent devices, steps, numbers, or behavior they
  did not state. A section with nothing stated is an EMPTY array.
- TIGHT output. Device purposes: 8 words or fewer. Sequence steps: 10 words or fewer.
  No filler adjectives, no restating the obvious. Every line must scan in one glance.
- failureHandling is an ORDERED recovery SEQUENCE, not a bag of notes: emit the
  steps in the order they execute (e.g. 1. any fault → Z to safe height;
  2. gripper closed → run the place sequence; 3. gripper open → return to pick).
  Each entry is one if-then step; the array order IS the execution order.
- devices: obey the Device taxonomy above. Valves, EOAT assemblies, timers, and HMI
  elements are NOT devices — decompose to the actual actuated mechanism (an "EOAT with a
  gripper" is ONE device: the gripper). Keep the engineer's terms for real devices.
  "type" must be one of the EXACT Device types strings; omit it rather than guess wildly.
- STATION DATA SHEET fields on devices (the UI renders these as fill-in tables):
  · sensorArrangement / strokeMm / delays — pneumatic types only. Fill them ONLY from the
    engineer's words ("gripper, no sensors, 250 ms each" → sensorArrangement "No sensors",
    delays {"extendMs":250,"retractMs":250}; "150mm stroke cylinder" → strokeMm 150).
    AN EXPLICIT STATEMENT ALWAYS WINS: "no sensors" / "timer only" / "sensorless" MUST
    produce sensorArrangement "No sensors" — never leave it unstated for the default to
    override, and never contradict the device's own purpose line.
    For grippers, delays.extendMs = close/engage delay, delays.retractMs = open/disengage
    delay. Anything unstated → OMIT the field entirely; the UI applies the SDC defaults
    and tags them "(default)". Never invent values.
  · positions — ServoAxis devices MUST carry a positions array: the named positions this
    axis needs, INFERRED from the sequence (home, pick, place, transition points,
    safe-clear heights — whatever the described motion actually uses). PascalCase names.
    Build EVERYTHING you can — the ME only fills values in, never invents rows. Typical
    pick-and-place shapes: horizontal axis → Home, Pick, Place; vertical axis →
    Retract (safe height), PickTransition, Pick, PlaceTransition, Place (SDC standard:
    vertical PnP moves always have fast/slow transition points).
    valueMm ONLY when the engineer stated the number ("pick is at 210" → 210) — otherwise
    omit valueMm and leave the cell for the mechanical team.
  · homePosition / homeState — each device's HOME: where it must be for the cycle to
    start (the ME knows it from how they designed the station). Fill ONLY from the
    engineer's words ("starts at home with the vertical at safe height" → vertical axis
    homePosition "Retract"; "gripper starts open" → homeState "Disengage"). Unstated →
    OMIT: the sheet defaults it intelligently (servo: a position named Home, else
    vertical → Retract; cylinder → Retract; gripper → Disengage) and the ME can change
    it on the device card. A stated home the ME already set is never overridden.
  · speeds — ServoAxis only. The SDC standard speeds are Fast 1000 mm/s / Slow 100 mm/s
    and the UI prefills them — return fastMmS/slowMmS ONLY when the engineer states
    DIFFERENT values (their stated values always win). Omit otherwise; the ME never
    has to fill speeds.
  · ROTARY / DIAL AXES — a servo dial or rotary index table is a ServoAxis with
    motionType "rotary". A rotary axis thinks in FIXTURES and DEGREES, never mm:
    emit fixtureCount when the engineer's words state it; its positions/speeds are
    degrees and °/s (the numeric fields keep their names). The index increment
    DERIVES as 360/fixtureCount — NEVER ask for an index distance in mm, NEVER emit
    an "IndexIncrement" position row, and NEVER invent Pick/Place/Retract rows for a
    dial; the UI renders Fixtures + the derived increment. Ask for the fixture count
    only when the words leave it genuinely unknown.
- expectedStateMachines: the ME's EXPECTED SM DECOMPOSITION, distilled into PILLS
  (Dan, 2026-08-25: the sheet never displays the raw dictation paragraph — it shows
  pills). Whenever the engineer's words describe how they expect the station to
  split into state machines ("the dial indexer is one state machine, the shuttle is
  one, the pick is one, and the robot if we consider it"), distill to one entry per
  expected machine: short PascalCase-ish display name + an optional one-line note.
  RESOLVE their own back-and-forth to their FINAL intent (a "maybe X? ...yes let's
  include it" becomes an entry; a retracted idea does not). Omit the key entirely
  when they said nothing about the decomposition. This is INPUT guidance — never
  invent machines they did not name. On corrections rounds, carry the sheet's
  existing expectedStateMachines forward VERBATIM unless the correction changes
  them — like every other sheet value.
- io: OPTIONAL capture, never a requirement. Include it ONLY when the engineer explicitly
  mentioned sensors, valves, solenoids, or IO counts — otherwise OMIT the "io" key entirely.
  It records station IO for the machine's valve-bank and IO-bank layout. It has NO coverage
  item and NEVER generates questions unless something stated is truly ambiguous. Empty
  arrays / empty string for anything not mentioned.
- sequence: one physical step per line, no numbering prefix (the UI numbers them).
- interactions: "station" should match one of the project's other station names when possible.
- questions: obey the Question policy above — never ask about Standing SDC facts, learned
  facts, or controls-architecture decisions. Ask EVERY question that genuinely passes the
  self-answer test — there is no quota and no cap; ten real questions are fine, zero is
  fine. Never pad, never suppress.
  NEVER ask a question whose answer is derivable from the description, the engineer's
  prior answers (Q&A history in the message), the standing knowledge above, or an
  earlier question in this session. Asked-and-answered is answered forever. "You decide" /
  "skip that" / "don't need to answer" is a COMPLETE answer: make the decision per SDC
  standards, record it, and never ask that question (or a reworded version of it) again.
- ASK GEOMETRY / MECHANICAL-INTENT QUESTIONS NOW, in the describe phase — the
  ME is right here and this is the ONLY phase allowed to ask them (the compile
  step never asks geometry; it guesses with *Verify placeholders instead —
  geometry filed as a controls question is a defect, per the ServoPNP incident).
  If the device/position tables already hold a value, the table IS the answer —
  USE it, never ask for it.
  When the devices described IMPLY a geometry value the engineer never stated,
  ask it upfront:
  · servo axes → the real named positions (home, pick, place), transition
    heights (where fast travel hands off to slow approach), and blend-start
    clearance when moves may overlap;
  · pneumatics whose stroke matters → end positions / posture with a part;
  · pick/place → home-vs-pick relationship if ambiguous.
  Ask for named intent (which positions exist and when each is safe), not exact
  numeric coordinates the ME would tune later.
- NEVER ASK IN PROSE FOR DATA THE DATA SHEET TABLES COLLECT. The review screen
  renders fill-in tables for servo positions/speeds and pneumatic sensors, stroke
  and delay timers, straight from the device fields above. A question like
  "please confirm the named positions and fill in the mm values" or "what sensors
  does the cylinder have?" is FORBIDDEN — emit the structured need instead: list
  the positions on the device (values omitted) and let the empty cells do the
  asking; leave pneumatic fields unstated so the defaults render editable.
  Questions are reserved for things a table cell cannot hold (geometry intent,
  failure behavior, what feeds what).

Coverage monotonicity:
- When the message includes your PREVIOUS coverage verdicts, coverage may only IMPROVE.
  A section previously covered stays covered; open needs may resolve, never multiply
  from nothing new. The engineer answering questions adds information — it never
  removes any.
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

The deviation handshake (approvedDeviations — corrections rounds; Dan, 2026-08-24):
- The engineer CAN turn off standard behaviors by explaining it in the chat — single
  speed the whole stroke (no speed transitions), no blending / square corners, or any
  other departure from a Standing SDC fact. The pattern is standard → pushback ONCE →
  confirm → approved deviation:
  · FIRST ask (no confirmation yet): do NOT apply. Reply CE-style in chatReply — state
    the standard and ask to confirm, solutions-first ("Our standard is fast/slow with
    speed transitions — you did a cycle study and want single-speed the whole stroke?
    Confirm and I'll build it that way."). Sheet UNCHANGED, changesMade empty,
    approvedDeviations empty.
  · CONFIRMED (the reply says yes/confirm, or the original message already carries the
    engineering reason — "we did a cycle study, single speed is fine"): APPLY. Return
    the corrected sheet (single speed → the axis's *Transition rows are GONE; no
    blending → the *Blend rows are GONE), add ONE approvedDeviations entry ({what,
    reason}), confirm in chatReply ("Done — single speed on Z, recorded as an approved
    deviation."). Do NOT also emit a nonStandardFlag — an approved deviation is not a
    flag, and it is never re-asked or re-flagged by anyone downstream.
- Deviations already recorded (the message or sheet state lists approvedDeviations):
  honor them silently — never re-add the removed rows, never question them again.
- Reverting is the same handshake in reverse ("go back to standard fast/slow") — apply
  immediately (returning TO standard needs no pushback), restore the rows as empty
  values for the engineer to fill, and note it in changesMade.

The corrections chat (chatReply — corrections rounds only):
- The engineer's corrections arrive as CHAT: you are the same Jarvis that generates the
  code, thinking about their message and replying in ONE of three modes:
  · APPLY — the message asks for a change you can make: return the complete corrected
    sheet and one short confirming sentence ("Done — one gripper, 250 ms each way.").
    The UI verifies your work by diffing the sheet you return against the previous one —
    your bullets are computed, so just confirm and stop.
  · CLARIFY — the message is ambiguous: return the sheet UNCHANGED (carried forward
    verbatim, changesMade empty) and ask ONE short question WITH your proposed
    interpretation, solutions-first ("You said tighten the pick blend — 3 mm instead
    of 5? Reply yes and I'll set it.").
  · ANSWER — the message is a question about the sheet, not a change request: return
    the sheet UNCHANGED and answer plainly in chatReply.
- READING FEEDBACK (Dan, 2026-08-28 — general rules, never case-specific):
  · CLASSIFY every message first: a question (answer from context), an approval, a
    set of corrections, or APPROVAL + CORRECTIONS — "looks good outside the few
    comments I just made" is that last one: extract and APPLY every embedded
    correction; the approval covers only what he did not correct.
  · DICTATION SELF-RESOLVES FROM CONTEXT: feedback is often voice-transcribed and
    words come out wrong. Any term that matches no real name is a phonetic slip —
    resolve it against the sheet's ACTUAL device, position, signal, and step names
    (all in your context) before concluding a comment doesn't apply. Never keep or
    invent alias tables; the context is the resolver, every case is different.
  · NEVER A SILENT NO-OP: if you apply nothing from a substantive message, chatReply
    MUST state your reading and check it ("I read this as approving the sequence
    as-is — did I miss changes?"). Silence after feedback is a defect.
- TERSE, ALWAYS (Dan, 2026-08-25: "as few words as possible — don't explain back what
  I'm saying; if you understand, say 'okay, got it' and ask questions if you don't"):
  NEVER recapitulate or paraphrase the engineer's own explanation back at them.
  Acknowledge in AT MOST one short sentence ("Okay, got it."), then output ONLY your
  genuine questions or needs — nothing else. NEVER walk their sequence back
  step-by-step, never list "what I understood", never volunteer sequence steps they
  did not ask about — the ONLY exception is the engineer explicitly asking
  ("what did you understand?"). The what-changed receipt is separate COMPUTED
  machinery — never restate changes in chatReply beyond the one confirming sentence.
- Omit chatReply entirely on a first summary with no corrections.

CURRENT SHEET STATE (agentic corrections — when the message carries it):
- When the message includes a CURRENT SHEET STATE JSON block, that sheet is COMPLETE and
  AUTHORITATIVE — it holds every device with its committed values (positions, delays,
  sensors, speeds, homes). Your response's summary sections ARE the corrected sheet:
  there is NO client-side merge behind you. That means:
  · Carry forward every untouched device, line, and value VERBATIM — same names, same
    numbers, same fields. Dropping a filled value you were not asked to touch LOSES it.
  · An EXPLICIT REMOVAL WINS: when the engineer says remove/delete/dedupe something,
    the sheet you return must NOT contain it — no keep-logic will resurrect it, and
    nothing you leave in comes back out.
  · Duplicates of the same physical device under name variants (Gripper / Part_Gripper /
    PartGripper) are ONE device: when asked to dedupe, keep the one the sequence
    references, merge the better config (the engineer's stated values win), drop the twin.
  · Never invent values; never rename devices unasked.

The apply receipt (changesMade):
- Present ONLY when the message carries engineer CORRECTIONS to apply (a revision
  round). One entry per concrete change you actually made, tagged with the section
  it landed in. ONE short sentence each — brevity law, general idea only:
  "Sequence step 6: retract now before the traverse" / "PartGripper: no sensors,
  250 ms delays" / "Fault recovery: retries set to 3". Never restate unchanged
  content, never enumerate; an empty array means the corrections changed nothing
  (say nothing else about it). Omit the key entirely on a first summary with no
  corrections. Nothing is ever changed silently — every real edit gets its line.

Coverage rules — a section is either COVERED or it lists SPECIFIC needs. NEVER a
vague quality verdict ("thin", "mentioned briefly") — that is forbidden output:
- covered: true means "I have what I need for THIS build" — nothing else. Judge
  coverage against what THIS build actually needs (its scope), never a maximal
  ideal: a standalone station (no other stations in the project, or the ME said
  standalone/test) with an empty interactions section IS covered — there is
  nothing to interact with yet. A simple two-device station that fully walked its
  short sequence IS covered, however brief.
- covered: false requires needs: a list of the SPECIFIC missing items, each as a
  CONCRETE question WITH your proposed answer — the way a controls engineer talks:
  "I see a second pick attempt in your sequence but no retry count — I plan 3
  tries then fault. Agree?" question = the specific ask; proposedSolution = how
  you plan to handle it (always give one — your best idea, it doesn't have to be
  right). What do you NEED, not what you'd like.
- blocking: true ONLY when correct logic is genuinely impossible without the
  answer (unknowable mechanical intent with no sensible default). blocking: false
  (the default) when your proposedSolution is safe to proceed on — the ME just
  confirms or corrects it.
- Section meanings: devices = the physical devices named with what each is for;
  sequence = the cycle walked step by step, in order; failures = failure cases
  WITH what should happen; interactions = relationships to other stations
  (feeds / waits for / tells / hands off) — covered when none apply to this build.
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
  priorCoverage = null, sheetState = null, signal = null, onProgress = null,
  // FULL CONTEXT ON EVERY CHAT TURN (Dan, 2026-08-28) — the P0 "chatHistory
  // is not defined" send failure was these three missing from this list.
  chatHistory = [], cascadePosition = null, changeLog = [],
  // THE SPEED ARCHITECTURE (class b — section-scoped corrections): the edit
  // classifier routes single-section content edits here with a cheaper model
  // and a scope lock so the round costs <20s instead of a full opus pass.
  modelOverride = null, sectionScope = null,
} = {}) {
  const useModel = modelOverride || MODEL;
  if (!description || !String(description).trim()) {
    throw new Error('description is required');
  }
  const client = getClient();

  const stationLines = (otherSms || []).map(s => `  - ${s.displayName || s.name}`).join('\n')
    || '  (no other stations in this project yet)';

  // PRECEDENT PACK (Dan, 2026-08-26): every step grounds in shipped names.
  // One-brain law: ALL engine calls assemble context through buildEngineContext
  // (CE doctrine rides the meKnowledge source — never a direct load).
  const meKnowledge = buildEngineContext(['meKnowledge', 'precedents', 'concepts:station-archetypes', 'concepts:multi-state-machine']);
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
    ((Array.isArray(sm.approvedDeviations) && sm.approvedDeviations.length)
      ? 'APPROVED DEVIATIONS already in force (honor silently — never re-add the removed rows, never re-ask, never flag):\n'
        + sm.approvedDeviations.map(d => `  - ${d.what}${d.reason ? ` (reason: ${d.reason})` : ''}`).join('\n') + '\n\n'
      : '') +
    `Other stations in this project:\n${stationLines}\n`;
  if (checklist && typeof checklist === 'object') {
    text += `\nLocal keyword-heuristic checklist scores (rough context only — your verdict replaces them): ${JSON.stringify(checklist)}\n`;
  }
  text += `\nEngineer's raw explanation:\n\n${String(description).trim()}`;
  // AGENTIC corrections (Dan, Aug 2026): the complete structured sheet rides
  // along — the model IS the merge; the sheet it returns is what renders.
  if (sheetState && typeof sheetState === 'object') {
    text += `\n\nCURRENT SHEET STATE (complete and authoritative — see the rules above; the sheet you return replaces this one):\n${JSON.stringify(sheetState, null, 1)}`;
  } else if (priorSummary && String(priorSummary).trim()) {
    text += `\n\nYour PREVIOUS summary (being revised):\n\n${String(priorSummary).trim()}`;
  }
  if (priorCoverage && typeof priorCoverage === 'object') {
    text += `\n\nYour PREVIOUS coverage verdicts (monotonic — covered stays covered, needs only resolve): ${JSON.stringify(priorCoverage)}`;
  }
  const qa = (Array.isArray(qaHistory) ? qaHistory : []).filter(r => r && (r.questions?.length || r.answer));
  if (qa.length) {
    text += '\n\nQ&A HISTORY this session (questions you already asked and the engineer\'s answers — '
      + 'NEVER re-ask these or anything derivable from them, in any wording. An answer like '
      + '"you decide" / "skip that" / "don\'t need to answer" is a COMPLETE answer: decide it '
      + 'per SDC standards, record the decision, and never ask it again in any form):\n'
      + qa.map((r, i) =>
        `Round ${i + 1}:\n`
        + (r.questions || []).map(q => `  Q: ${q}`).join('\n')
        + (r.answer ? `\n  A: ${String(r.answer).trim()}` : '')
      ).join('\n');
  }
  // FULL CONTEXT ON EVERY CHAT TURN (Dan, 2026-08-28): the conversation, his
  // position in the cascade, and the recent actions ride the prompt — the
  // chat is the SAME engine as the build, with the same view of the work.
  const chatTurns = (Array.isArray(chatHistory) ? chatHistory : []).filter(t => t && t.text);
  if (chatTurns.length) {
    text += '\n\nTHE CONVERSATION SO FAR (this draft\'s chat — context for reading the new message):\n'
      + chatTurns.slice(-20).map(t => `  ${t.role === 'me' ? 'ENGINEER' : 'JARVIS'}: ${String(t.text).slice(0, 300)}`).join('\n');
  }
  if (cascadePosition && typeof cascadePosition === 'object') {
    text += `\n\nWHERE THE ENGINEER IS RIGHT NOW (the cascade): ${String(cascadePosition.activeLabel ?? 'unknown step')}`
      + (Array.isArray(cascadePosition.approved) && cascadePosition.approved.length
        ? ` — already approved: ${cascadePosition.approved.join(', ')}` : '')
      + '. Feedback with no named target is usually about THIS step.';
  }
  const logLines = (Array.isArray(changeLog) ? changeLog : []).filter(Boolean);
  if (logLines.length) {
    text += '\n\nRECENT ACTIONS on this sheet (the change log — never silently undo these):\n'
      + logLines.slice(-12).map(l => `  - ${String(l).slice(0, 200)}`).join('\n');
  }
  if (corrections && String(corrections).trim()) {
    text += `\n\nEngineer's CORRECTIONS to apply (these override anything they conflict with above):\n\n${String(corrections).trim()}`
      + '\n\nCORRECTION ROUTING (non-negotiable): the ME\'s correction names its target section '
      + 'implicitly — read what it is about (a device, a sequence step, a failure behavior, an '
      + 'interaction) and apply it to the right section(s) ONLY. Never wholesale-rewrite sections '
      + 'the correction does not touch: every untouched section is carried forward from the '
      + 'previous summary EXACTLY as it was — same items, same wording, same values. This is a '
      + 'non-destructive merge, not a fresh restatement. Report every concrete change you make '
      + 'in changesMade (one short sentence each) — nothing changes silently.';
    if (sectionScope && ['devices', 'sequence', 'failureHandling', 'interactions', 'io'].includes(sectionScope)) {
      text += `\n\nSCOPE LOCK (the edit was classified as a ${sectionScope}-section content change): `
        + `apply the correction to the "${sectionScope}" section ONLY. Every other section MUST come back `
        + 'byte-identical to the current sheet — same items, same wording, same values, nothing added or '
        + 'removed. changesMade entries may only carry section "' + sectionScope + '". If the correction '
        + 'actually requires touching another section, do NOT touch it — say so in chatReply instead '
        + '("this also affects X — send it as its own correction") so the round stays scoped.';
    }
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
    const req = {
      model: useModel,
      max_tokens: maxTokens,
      // The system prompt (meKnowledge + output spec) is large and stable —
      // cache it so corrections rounds reuse the prefix instead of re-reading
      // ~20K tokens every round (speed architecture: rounds must be fast).
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    };
    // Section-scoped rounds are surgical edits of a known sheet — minimal
    // reasoning keeps them inside the <20s target.
    if (sectionScope) req.output_config = { effort: 'low' };
    if (/^claude-(fable|opus)-/.test(useModel)) {
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
    if (response.usage) totalCostUSD += costOfUsage(response.usage, useModel);
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

  // Normalize — covered/needs verdicts (Dan, Aug 23: a section is covered or
  // it lists SPECIFIC needs with proposed answers; "thin" is dead). Tolerates
  // the legacy {score,missing} shape from either side of the wire.
  const normalizeVerdict = (c) => {
    if (!c || typeof c !== 'object') return { covered: false, needs: [] };
    if ('covered' in c || Array.isArray(c.needs)) {
      const needs = (Array.isArray(c.needs) ? c.needs : [])
        .map(n => ({
          question: String((n && n.question) || '').trim(),
          proposedSolution: String((n && n.proposedSolution) || '').trim(),
          blocking: (n && n.blocking) === true,
          // Device attribution (Dan, 2026-08-27): a question born from a
          // device names it — the sheet routes it to that device's machine.
          ...((n && n.device) ? { device: String(n.device).trim() } : {}),
        }))
        .filter(n => n.question)
        .slice(0, 8);
      // Needs present → not covered, whatever the flag said; no needs and not
      // explicitly uncovered → covered.
      return { covered: needs.length === 0 && c.covered !== false, needs };
    }
    // Legacy shape: score 2 = covered; anything else becomes one plain need.
    const score = Number(c.score);
    const missing = String(c.missing || '').trim();
    if (score === 2) return { covered: true, needs: [] };
    return {
      covered: false,
      needs: missing ? [{ question: missing, proposedSolution: '', blocking: false }] : [],
    };
  };
  const coverage = {};
  for (const k of COVERAGE_KEYS) {
    let v = normalizeVerdict(parsed.coverage && parsed.coverage[k]);
    // Hard monotonic clamp: a previously covered section never regresses.
    const prior = priorCoverage && normalizeVerdict(priorCoverage[k]);
    if (prior && prior.covered && !v.covered) v = { covered: true, needs: [] };
    coverage[k] = v;
  }
  const str = (v) => String(v == null ? '' : v).trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const summary = {
    devices: arr(parsed.devices)
      .map(d => ({
        name: capDeviceName(str(d && d.name)),
        purpose: str(d && d.purpose),
        // Exact deviceTypes.js string when the model gave a valid one —
        // drives the device icon in the summary UI. Dropped when invalid.
        ...(d && VALID_TYPES.has(d.type) ? { type: d.type } : {}),
        // STATION DATA SHEET fields — present ONLY when the engineer's words
        // stated them (the UI applies SDC defaults for anything absent and
        // tags them "(default)").
        ...normalizeSheetFields(d),
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
  // ME's expected SM decomposition, distilled to pills (Dan, 2026-08-25) —
  // the sheet renders these instead of the raw dictation paragraph.
  const expectedStateMachines = (Array.isArray(parsed.expectedStateMachines) ? parsed.expectedStateMachines : [])
    .map(x => ({ name: str(x && x.name), note: str(x && x.note) }))
    .filter(x => x.name)
    .slice(0, 10);
  if (expectedStateMachines.length) summary.expectedStateMachines = expectedStateMachines;
  // Question policy (Dan): NO quota and NO cap — the self-answer test in
  // meKnowledge.md governs. The only backstop is the shared repeat/reword
  // dedupe against every question already asked this session.
  const questions = filterQuestions(parsed.questions, qaHistory);
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
  // Apply receipt (Dan, Aug 24: "I hit apply changes and idk what actually
  // changed") — one short sentence per concrete change, tagged by section.
  // Only meaningful on a corrections round; harmless empty otherwise.
  const CHANGE_SECTIONS = new Set(['devices', 'sequence', 'failureHandling', 'interactions', 'io']);
  const changesMade = (Array.isArray(parsed.changesMade) ? parsed.changesMade : [])
    .map(c => ({
      section: CHANGE_SECTIONS.has(c && c.section) ? c.section : 'other',
      text: String((c && c.text) || '').trim(),
    }))
    .filter(c => c.text)
    .slice(0, 12);
  // Corrections-chat reply (clarify / apply-confirm / answer) — optional,
  // conversational, capped. The UI computes what-changed itself; this is
  // Jarvis's voice, never the receipt.
  const chatReply = String(parsed.chatReply || '').trim().slice(0, 600);
  // DEVIATION HANDSHAKE (Dan, Aug 24): ME-confirmed departures from SDC
  // standards. The client records them on machineSpec.approvedDeviations
  // (with approvedBy/at) and strips the corresponding rows from the station.
  const approvedDeviations = (Array.isArray(parsed.approvedDeviations) ? parsed.approvedDeviations : [])
    .map(d => ({ what: String((d && d.what) || '').trim(), reason: String((d && d.reason) || '').trim() }))
    .filter(d => d.what)
    .slice(0, 8);
  if (progress) { try { progress(100, 'done'); } catch (_) {} }

  return {
    summary,
    coverage,
    questions,
    learnedFacts,
    nonStandardFlags,
    changesMade,
    ...(approvedDeviations.length ? { approvedDeviations } : {}),
    ...(chatReply ? { chatReply } : {}),
    meta: {
      model: response.model || useModel,
      usage: response.usage || null,
      costUSD: Number(totalCostUSD.toFixed(4)),
      // Per-summary-loop cost ceiling — the CLIENT gates on its running total.
      maxCostUSD: SUMMARIZE_MAX_COST_USD,
      ...(sectionScope ? { sectionScope } : {}),
    },
  };
}

module.exports = { authorSpec, summarizeDescription, filterQuestions };
