/**
 * jarvisVersion.js — JARVIS version identity.
 *
 * JARVIS is the official name of the AI L5X-generation layer:
 *   ir.js + promptBuilder.js + editPlanSchema.js + mergeEngine.js +
 *   validator.js + client.js + generationRules.md
 *   + POST /api/generate (server.js).
 *
 * Bump JARVIS_VERSION (and append a HISTORY entry) whenever the pipeline's
 * behavior changes: rules edits, template revisions, prompt structure,
 * validator checks, or repair-loop changes. Every generated L5X is stamped
 * with this version in its program Description, and every benchmark file
 * is named by it — see docs/JARVIS_VERSIONS.md and benchmarks/README.md.
 *
 * CommonJS, plain Node — required by client.js and scripts/jarvisBenchmark.cjs.
 */

const JARVIS_VERSION = '1.1.0';

const HISTORY = [
  {
    version: '1.0.0',
    date: '2026-08-19',
    changes: 'Initial Jarvis: V4.2 template law, prompt builder, validator, 2-round self-repair',
    templates: 'V4.2',
  },
  {
    version: '1.0.1',
    date: '2026-08-19',
    changes: 'Surgical merge architecture: model authors edit plan only; deterministic template merge; ' +
      'diagram-vs-code cross-validation; IR module + .ir.txt review file; prompt slimmed to template ' +
      'extracts with cached stable prefix; default model claude-opus-5; max_tokens 16K with cost ' +
      'estimation (v1.0.0 truncated at 100K writing full files)',
    templates: 'V4.2',
  },
  {
    version: '1.0.2',
    date: '2026-08-19',
    changes: 'Fixes for machineSpec-scale plans (v1.0.1 failed 996 Magnet_Feed: attempts 1-2 truncated at ' +
      'the 32K output cap, attempt 3 died on ONE ambiguous spliceRungs anchor, exhausting the 3-attempt cap ' +
      'at $2.21 with no file): output cap 32K -> 64K; attempts 3 -> 5; plan continuation ("toBeContinued": ' +
      'true splits a plan across responses, operations concatenated); anchor disambiguation via optional ' +
      '"occurrence"/"nearComment" on updateRung/spliceRungs; ambiguity errors now list matched rung numbers ' +
      'AND comments so repair rounds can disambiguate trivially',
    templates: 'V4.2',
  },
  {
    version: '1.1.0',
    date: '2026-08-20',
    changes: 'Pipeline inversion ACTIVE: Build-time compileSequence (one reasoning call) -> engineer ' +
      'approval -> translation-mode generation (effort medium, validated against the approved compiled IR). ' +
      'Approval now kicks off a background PRE-TRANSLATION server-side; a fresh pretranslation short-circuits ' +
      '/api/generate/stream in <1s (meta.mode=pretranslated). Jason\'s-review fixes: the merge engine ' +
      'deterministically injects the full STATE MAP as the first R02 rung comment (immune to Studio 5000 ' +
      'tag-comment collisions on import); validator now checks Status .STATE[n] tag comments and R02 rung ' +
      'comments against the IR state labels (mismatch = error) and no longer counts rung comments as device ' +
      'evidence. smId params accept id, name, or displayName on all generate/compile endpoints; compile ' +
      'questions are pushed to the Jarvis question queue.',
    templates: 'V4.2',
  },
];

/** The HISTORY entry matching JARVIS_VERSION (falls back to the last entry). */
function currentEntry() {
  return HISTORY.find(h => h.version === JARVIS_VERSION) ?? HISTORY[HISTORY.length - 1];
}

module.exports = { JARVIS_VERSION, HISTORY, currentEntry };
