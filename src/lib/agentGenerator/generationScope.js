/**
 * generationScope.js — the build's scope contract: what this generation
 * covers vs what is deliberately NOT in this build yet.
 *
 * Dan (Aug 23): the scope is an INTERNAL default, not a UI checklist — the
 * spec sheet shows one quiet line (GenerationScopeNote.jsx). It persists on
 * sm.machineSpec.generationScope when someone ever sets it; otherwise the
 * standalone default below applies. It feeds BOTH prompts (compile via
 * ir.text, generation via compiled/authored text) so Jarvis never asks about,
 * flags, or stub-apologizes for out-of-scope items.
 *
 * IMPORTANT (Dan): the generated FILE composition never shrinks — the full
 * station file (template shell, init block, lockout, R01, station
 * part-tracking block, sequence, recovery, alarms) ALWAYS emits, exactly like
 * v4. Scope governs only the machine-level/creative extras: what gets asked,
 * flagged, or coordinated beyond this station.
 *
 * CommonJS, plain Node — required by ir.js and coordinationAuthor.js.
 */

const DEFAULT_GENERATE = [
  'station sequence logic',
  'servo motion commands',
  'device commands & verification',
  'state transitions',
  'basic sequence faults/retries needed for the sequence',
];

const DEFAULT_NOT_YET = [
  'machine-level part tracking',
  'upstream/downstream coordination beyond defined IO',
  'overall machine initialization',
  'machine-wide fault manager',
  'production/OEE logic',
  'supervisor sequencing outside this station',
];

/** Normalize a stored machineSpec.generationScope (or nothing) into the
 *  canonical { generate:[], notYet:[] } shape. */
function normalizeGenerationScope(raw) {
  const list = (v, fallback) =>
    Array.isArray(v) && v.length ? v.map(String).filter(Boolean) : fallback.slice();
  return {
    generate: list(raw && raw.generate, DEFAULT_GENERATE),
    notYet: list(raw && raw.notYet, DEFAULT_NOT_YET),
  };
}

/** Prompt lines for the scope contract — appended to the IR text (compile)
 *  and the compiled-sequence text (generation/translation).
 *  `purpose` (optional): the ME's one-line "what's this build for" from the
 *  spec sheet (machineSpec.purpose) — when present it colors how the build is
 *  approached (a proof-of-concept vs production cell reads differently). */
function renderGenerationScopeText(scope, purpose = '') {
  const s = normalizeGenerationScope(scope);
  const purposeLines = String(purpose || '').trim()
    ? [`BUILD PURPOSE (from the ME — let it shape your approach): ${String(purpose).trim()}`]
    : [];
  return [
    '',
    '## GENERATION SCOPE (contract — what this build covers vs not)',
    ...purposeLines,
    `THIS BUILD GENERATES: ${s.generate.join('; ')}.`,
    `NOT IN THIS BUILD (machine-level extras deferred until the station joins a machine): ${s.notYet.join('; ')}.`,
    'Scope law: NEVER ask about, flag, or apologize for NOT-IN-THIS-BUILD items.',
    'Where the sequence touches one (e.g. a partner/supervisor signal outside the',
    "defined IO), stub it quietly per the SDC standalone pattern (*Replace rung",
    'comment) and move on — that is your own decision, not a question. A',
    'standalone sequence terminates cleanly in "Sequence Complete / Ready for',
    'next command".',
    'The station-level template pieces ALWAYS emit regardless of scope: init',
    'block, lockout, R01 inputs, station part-tracking block, alarms — the full',
    'station file, never a reduced one.',
  ];
}

module.exports = { normalizeGenerationScope, renderGenerationScopeText, DEFAULT_GENERATE, DEFAULT_NOT_YET };
