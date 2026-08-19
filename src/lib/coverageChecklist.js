/**
 * coverageChecklist.js — LOCAL heuristic scoring for the Create Station
 * describe surface. No API calls: pure regex/word-count scoring so the
 * checklist can update live (debounced) while the engineer types.
 *
 * Each checklist item scores 0 (unchecked), 1 (partial — "mentioned
 * briefly"), or 2 (checked — covered).
 *
 * Tuned against: Dan's magnet-feed style description (all four should
 * check) and a one-liner (only some should check). See
 * scripts/tuneCoverage.cjs history in the session notes.
 */

export const COVERAGE_ITEMS = [
  {
    key: 'devices',
    label: 'Devices & what each is for',
    hint: 'cylinders, slides, grippers, sensors, servos…',
  },
  {
    key: 'sequence',
    label: 'What the station does, step by step',
    hint: 'the motions in order — "first… then… once…"',
  },
  {
    key: 'failures',
    label: 'What can go wrong & what should happen',
    hint: 'misses, jams, retries, faults, operator steps',
  },
  {
    key: 'interactions',
    label: 'How it interacts with other stations',
    hint: 'feeds / waits for / tells / hands off / index',
    optionalWhenAlone: true, // marked optional when the project has no other SMs
  },
];

// ── Vocabulary ───────────────────────────────────────────────────────────────

const DEVICE_TERMS = [
  'cylinder', 'slide', 'shuttle', 'gripper', 'sensor', 'servo', 'axis', 'axes',
  'vacuum', 'venturi', 'camera', 'vision', 'robot', 'conveyor', 'actuator',
  'nest', 'stopper', 'lift', 'clamp', 'feeder', 'escapement', 'indexer',
  'dial', 'pusher', 'rail', 'chute', 'press', 'stamp', 'stamper', 'solenoid',
  'timer', 'switch', 'photoeye', 'prox',
];

const SEQ_VERBS = [
  'extend', 'extends', 'retract', 'retracts', 'raise', 'raises', 'lower',
  'lowers', 'slide', 'slides', 'move', 'moves', 'drop', 'drops', 'lift',
  'lifts', 'pick', 'picks', 'place', 'places', 'close', 'closes', 'open',
  'opens', 'clamp', 'clamps', 'release', 'releases', 'return', 'returns',
  'index', 'indexes', 'feed', 'feeds', 'push', 'pushes', 'advance',
  'advances', 'trigger', 'triggers', 'check', 'checks', 'verify', 'verifies',
  'home', 'homes', 'engage', 'engages', 'grab', 'grabs', 'transfer',
  'transfers',
];

const SEQ_CONNECTIVES = [
  'then', 'first', 'next', 'after', 'once', 'when', 'finally', 'second',
  'third', 'until', 'before', 'step', 'lastly', 'while',
];

// Failure triggers (what goes wrong)…
const FAIL_TRIGGERS = [
  'fail', 'fails', 'failure', 'failed', 'jam', 'jams', 'jammed', 'miss',
  'misses', 'missed', 'missing', 'wrong', 'bad', 'error', 'timeout',
  'drops', 'dropped', 'stuck', 'empty', 'low', 'not seated', 'not present',
  'not picked', 'not placed', 'not there', 'no part', "isn't", 'isnt',
  "doesn't", 'doesnt',
];
// …and responses (what should happen about it).
const FAIL_RESPONSES = [
  'retry', 'retries', 'try again', 'tries', 'warn', 'warns', 'warning',
  'alarm', 'fault', 'faults', 'pause', 'pauses', 'stop', 'stops', 'halt',
  'reject', 'rejects', 'scrap', 'operator', 'lockout', 'clear', 'clears',
  'cleared', 'skip', 'skips', 'abort',
];

// Strong interaction verbs — one clear one is enough to check the item.
const INTERACT_STRONG = [
  'feeds', 'feed parts', 'feeds parts', 'waits for', 'wait for', 'tells',
  'tell', 'hands off', 'hand off', 'handoff', 'hand-off', 'receives from',
  'receives parts', 'interacts with', 'signals to', 'signal to',
  'asks for', 'requests', 'sends parts', 'supplies', 'loads the',
  'unloads the', 'picks from', 'places into', 'after the dial',
  'when the dial', 'dial indexes', 'index completes', 'index complete',
];
// Weak interaction hints — need two, or one plus a strong hit nearby.
const INTERACT_WEAK = [
  'dial', 'indexer', 'upstream', 'downstream', 'other station',
  'next station', 'previous station', 'station before', 'station after',
  'the pick', 'the place', 'robot', 'supervisor', 'conveyor',
];

function countDistinct(text, terms) {
  let n = 0;
  const found = [];
  for (const t of terms) {
    // word-ish boundary match, case-insensitive; multi-word terms allowed
    const re = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`, 'i');
    if (re.test(text)) { n++; found.push(t); }
  }
  return { n, found };
}

/**
 * Assess a description for checklist coverage.
 *
 * Returns per-item scores AND an actionable teaching line for every item
 * that is not fully covered — driven by the same local heuristics, so the
 * engineer learns exactly what's still missing while they type.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string[]} [opts.otherSmNames] display names of the project's other
 *   stations — mentioning one counts toward "interactions".
 * @returns {{
 *   scores:   {devices:0|1|2, sequence:0|1|2, failures:0|1|2, interactions:0|1|2},
 *   messages: {devices?:string, sequence?:string, failures?:string, interactions?:string},
 * }}
 */
export function assessCoverage(text, { otherSmNames = [] } = {}) {
  const t = String(text || '').toLowerCase();
  const scores = { devices: 0, sequence: 0, failures: 0, interactions: 0 };
  const messages = {};
  const empty = t.trim().length < 8;

  // ── Devices: distinct device nouns. Two distinct kinds = checked. ────────
  const dev = empty ? { n: 0, found: [] } : countDistinct(t, DEVICE_TERMS);
  scores.devices = dev.n >= 2 ? 2 : dev.n === 1 ? 1 : 0;
  if (scores.devices === 0) {
    messages.devices = 'Name the devices — cylinders, slides, grippers, sensors — and say what each is for.';
  } else if (scores.devices === 1) {
    messages.devices = `Found "${dev.found[0]}" — name the other devices and say what each one is for.`;
  }

  // ── Sequence: distinct motion verbs + ordering connectives. ──────────────
  const verbs = empty ? { n: 0, found: [] } : countDistinct(t, SEQ_VERBS);
  const conns = empty ? { n: 0, found: [] } : countDistinct(t, SEQ_CONNECTIVES);
  if (verbs.n >= 3 && conns.n >= 1) scores.sequence = 2;
  else if (verbs.n + conns.n >= 2) scores.sequence = 1;
  if (scores.sequence === 0) {
    messages.sequence = 'Walk the cycle in order — "first… then… once the sensor sees it…".';
  } else if (scores.sequence === 1) {
    messages.sequence = verbs.found.length
      ? `Some motion mentioned (${verbs.found.slice(0, 2).join(', ')}) — walk the WHOLE cycle in order: first… then… once…`
      : 'Ordering words found but no motions — say what actually moves, step by step.';
  }

  // ── Failures: a trigger AND a response = checked; either alone = partial. ─
  const trig = empty ? { n: 0, found: [] } : countDistinct(t, FAIL_TRIGGERS);
  const resp = empty ? { n: 0, found: [] } : countDistinct(t, FAIL_RESPONSES);
  if (trig.n >= 1 && resp.n >= 1) scores.failures = 2;
  else if (trig.n >= 1 || resp.n >= 1) scores.failures = 1;
  if (scores.failures === 0) {
    messages.failures = 'What can go wrong (a miss, a jam) — and what should happen (retry, fault, call the operator)?';
  } else if (scores.failures === 1) {
    messages.failures = trig.n >= 1
      ? `You said what goes wrong ("${trig.found[0]}") — now say what should HAPPEN: retry? fault? warn the operator?`
      : `You said a response ("${resp.found[0]}") — now say what TRIGGERS it: a miss, a jam, a part not seated?`;
  }

  // ── Interactions: one strong verb = checked; weak hints = partial. ───────
  const strong = empty ? { n: 0, found: [] } : countDistinct(t, INTERACT_STRONG);
  const weak = empty ? { n: 0, found: [] } : countDistinct(t, INTERACT_WEAK);
  const namedSm = !empty && otherSmNames.some(n => n && t.includes(String(n).toLowerCase()));
  if (strong.n >= 1 || (namedSm && weak.n >= 1)) scores.interactions = 2;
  else if (weak.n >= 1 || namedSm) scores.interactions = 1;
  if (scores.interactions === 0) {
    messages.interactions = 'How does it work with the other stations — feeds parts to, waits for, tells, hands off?';
  } else if (scores.interactions === 1) {
    messages.interactions = `You mentioned "${weak.found[0] || otherSmNames.find(n => n && t.includes(String(n).toLowerCase()))}" — say the interaction outright: feeds / waits for / tells / hands off.`;
  }

  return { scores, messages };
}

/** Back-compat: scores only. */
export function scoreCoverage(text, opts) {
  return assessCoverage(text, opts).scores;
}
