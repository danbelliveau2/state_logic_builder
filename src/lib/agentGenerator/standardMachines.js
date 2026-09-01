/**
 * standardMachines.js — STANDARD MACHINES FROM PRECEDENT (Dan, 2026-09-01:
 * "as a mechanical engineer I don't know how to set up the dial — the dial
 * index is standard"). When a proposed machine matches a shipped SDC
 * standard pattern, the engine builds that machine's spec FROM doctrine and
 * shipped work and tells the ME so — its walk steps ask ONLY the
 * station-specific values, never the design he doesn't own.
 *
 * Detection is deterministic (archetype triggers on name + owned devices);
 * the ME can always override. propose_split stamps
 * machine.standardPattern = { key, label, asks[] }.
 */

const PATTERNS = [
  {
    key: 'dial-indexer',
    label: 'Dial Indexer',
    match: (name, devs) => /\b(dial|index(er)?)\b/i.test(name) || devs.some((d) => /dial|index/i.test(d)),
    asks: ['fixture/station count', 'nest sensors present?', 'reject behavior (full-revolution vs immediate)', 'index angle / stations per index'],
    doctrine: 'Stack-present monitoring and the consecutive-empty-fixture counter live INSIDE the dial machine per shipped work (S00_IndexerSP family) — never asked of the ME.',
  },
  {
    key: 'escapement',
    label: 'Escapement Feed',
    match: (name, devs) => /escapement/i.test(name) || devs.some((d) => /escapement|finger/i.test(d)),
    asks: ['finger count (1 or 2)', 'nest part-present sensor?', 'starved-feed behavior (warn vs pause)'],
    doctrine: 'One-at-a-time release, queue-hold finger pattern, and starvation warnings follow the shipped escapement stations.',
  },
  {
    key: 'standard-feeder',
    label: 'Standard Feeder',
    match: (name, devs) => /\b(feeder|bowl|flex ?feed)\b/i.test(name) || devs.some((d) => /feeder|bowl/i.test(d)),
    asks: ['feeder type (bowl / flex)', 'low-level sensor?', 'purge behavior'],
    doctrine: 'Feeder run/idle control and low-level warnings follow the shipped FlexFeeder pattern.',
  },
];

/** @returns {null | { key, label, asks, doctrine }} */
function detectStandardPattern(machine) {
  const name = String(machine?.name ?? '');
  const devs = (machine?.ownedDeviceNames ?? machine?.deviceNames ?? []).map(String);
  for (const p of PATTERNS) {
    if (p.match(name, devs)) return { key: p.key, label: p.label, asks: p.asks, doctrine: p.doctrine };
  }
  return null;
}

module.exports = { detectStandardPattern, PATTERNS };
