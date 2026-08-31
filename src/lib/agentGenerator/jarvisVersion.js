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

const JARVIS_VERSION = '1.4.0';

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
  {
    version: '1.1.1',
    date: '2026-08-20',
    changes: 'Jason\'s servo-PNP review (speed changes missing, blending coded wrong, EQU/LES instead of ' +
      'EQ/LT): concept-learning layer added — jarvis-knowledge/concepts/ (engineer\'s-understanding docs, ' +
      'starting with servo-motion.md distilled from all four V4.2 templates) is loaded into BOTH the compile ' +
      'and translation prompts. Compiled IR now carries motion intent as structured data (positionName / ' +
      'speedProfile / advance per ServoMove) and renders device positions+speedProfiles into the translation ' +
      'prompt (previously dropped). S05 template notes teach per-state AutoSpeed[i] staging and the wideband ' +
      '[MAM.PC+InPos , MAM.IP+InPosWide] blending idiom. Rules 13 (compare-mnemonic family must match the ' +
      'template verbatim — EQ/NE/LT/GT/GE/LE) and 14 (motion intent coverage). Validator: long-family compare ' +
      'mnemonics = ERROR; multi-speed intent with <2 staged AutoSpeed indices = ERROR; wideband intent with ' +
      'no InPosWide in R02 = ERROR (prose-only blend mention = warning).',
    templates: 'V4.2',
  },
  {
    version: '1.1.2',
    date: '2026-08-21',
    changes: 'Jason\'s v1.1.1 review (out-of-order state transitions, reformatted motion triggers): ' +
      'STRUCTURAL FIDELITY LAW added to jarvis-knowledge/concepts (README + servo-motion.md + ' +
      'coordination.md) — template structural shapes (rung ordering, trigger rung format, staging shape) ' +
      'are law; problems the template doesn\'t visibly solve are solved the way the template family solves ' +
      'them elsewhere (back-to-back same-axis moves = the indexer\'s trigger/wait split), never by invention. ' +
      'promptBuilder COMMON_NOTES + coordinationAuthor OUTPUT_SPEC reinforce R02 ordering + motion trigger ' +
      'laws. Rules 15 (R02 rung order) and 16 (motion trigger shape). Validator: R02 sequence rungs must be ' +
      'ascending before the override block = ERROR; invented move-trigger latches / extra per-axis MAMs / ' +
      'missing state-list+gating = ERROR; consecutive same-axis move states both in one MAM list (second ' +
      'move never executes) = ERROR.',
    templates: 'V4.2',
  },
  {
    version: '1.2.0',
    date: '2026-08-21',
    changes: 'Template consultation made MANDATORY and self-deriving (Dan: multi-move states vs S05\'s ' +
      'one-move-per-state; "put rules in place so I don\'t have to keep telling you"). (1) templatePatterns.js ' +
      'auto-derives structural invariants from the plc-reference/standard L5X files themselves (one MAM per ' +
      'axis, one move per state, staging shape defaults-first, transition condition families, R02 ordering, ' +
      'mnemonic family, init graph), cached by file hash in jarvis-knowledge/analysis/template-patterns.json — ' +
      'new templates re-derive with no curation. (2) Compile conformance contract: templateConformance section ' +
      'required in compiled output — every structural decision cites its inventory pattern or declares an ' +
      'extension (sanctioned-extension recognized for the fast/slow + transition-point standard, Dan 2026-08-21); ' +
      'uncited = compile validation error. Inventory + contract injected into compile, generation, and review ' +
      'prompts. (3) validator.checkOneMovePerState: >=2 ServoMoves on one axis in one state = ERROR at IR level ' +
      '(compile validation AND validateAgainstCompiledIR); cross-axis after-complete chain in one state = ERROR; ' +
      'cross-axis overlap = warning (must be permissive-gated wideband). Internal reviewer runs a ' +
      'template-conformance pass against the inventory; undeclared divergence = blocker. Dan\'s doctrine ' +
      'codified as THE CHECK: the internal review\'s one question is "is this in line with SDC standards?" — ' +
      'it runs on every generation path (full run, pretranslation, and a review-only pass on cached ' +
      'pretranslated files that were never reviewed). Third verdict \'unsure\': the standards knowledge ' +
      'doesn\'t answer a structural choice -> build HELD (never shipped, never guessed), specific standards ' +
      'questions filed to jarvis-knowledge/questions.json (source \'internal review\', linked to the build id); ' +
      'Code grid shows "held — N standards questions filed for the controls team". unsure != fix: fix is for ' +
      'known violations, unsure is for unknown standards.',
    templates: 'V4.2',
  },
  {
    version: '1.3.0',
    date: '2026-08-22',
    changes: 'DAN\'S ESCALATION MODEL built into the pipeline. (1) Solutions, not explanations — every ' +
      'question-creating path (compile questions, internal-review standardsQuestions, hold-for-help, ' +
      'correction lessons, /api/jarvis/questions) carries proposedSolution (Jarvis\'s best answer, required ' +
      'by prompt contract) and addressee (\'ME\'|\'CE\', derived from the question domain). (2) Loop limit -> ' +
      'hold-for-help: a validation finding surviving JARVIS_FINDING_ROUND_LIMIT (default 4) consecutive fix ' +
      'rounds, or JARVIS_MAX_FIX_ROUNDS (default 8) total rounds, STOPS generation (the v4 build burned 12 ' +
      'rounds on one junction); Jarvis formulates the question(s) WITH proposed solution(s), the build ' +
      'persists as held (build.help {questions, status:\'waiting\'}) with resume state (last edit plan + ' +
      'L5X draft + findings — the prompt is deterministic, so that is the whole session-unique state). ' +
      '(3) POST /api/jarvis/builds/:id/continue folds human answers into knowledge and resumes the held fix ' +
      'loop through THE CHECK. (4) Structural-delta highlight: translation plans may DECLARE deliberate ' +
      'deviations (plan.structuralChanges + irPatch); validation and internal review run against the PATCHED ' +
      'contract, sm.compiledSequence is updated so the flowchart stays truthful, and each change rides as ' +
      '{text, approved:false} for quick approve (POST /api/jarvis/builds/:id/approve-changes) — never silent ' +
      'divergence, never blocking the file. (5) build.writingNotes [{text}] — right-amount notes of what came ' +
      'up while writing (plan notes + per-round root causes), no quota, never filler.',
    templates: 'V4.2',
  },
  {
    version: '1.4.0',
    date: '2026-08-25',
    changes: 'FIRST-PASS DOCTRINE (Dan, verbatim: "Look at the request. Use SDC standards. Look at the ' +
      'references they gave you. Ask the engineers any questions BEFORE writing. Write the code based on ' +
      'SDC standards. Maybe one review at the end. You don\'t get eight revisions — you get one."). ' +
      '(1) PRE-WRITE STUDY (preWriteStudy.js): the write call now carries the COMPLETE closest ' +
      'engineer-corrected exemplar of the same template family (rung-for-rung routine bodies, ' +
      'whole-routine budget trim), lessons from studied reference material (sources.json), and the ' +
      'build\'s recorded rulings (approved deviations, compile flags/decisions, answered questions) — ' +
      'own 1h-TTL cache block. (2) READINESS PASS: one cheap fast-model call (JARVIS_READINESS_MODEL, ' +
      'default claude-haiku-4-5) before writing — "list anything unresolved, ambiguous, or missing that ' +
      'would cause a defect"; real items HOLD the build before any write token is spent (questions with ' +
      'proposed solutions through the existing hold channel; resume folds answers in and skips the pass). ' +
      '(3) WRITE ONCE: the translation prompt is reframed — final file, no revision loop, one senior ' +
      'review at the end. (4) Fix loop = SAFETY NET, rounds = TUITION: caps unchanged, but every build ' +
      'that needed fix rounds files lessons ("what should the pre-write study have caught?") through ' +
      'correctionLearner into the concept docs. (5) THE METRIC: firstPassShip + roundsToShip recorded ' +
      'per build (buildScores) and aggregated by GET /api/jarvis/trackrecord as the first-pass ship ' +
      'rate — Jarvis\'s headline number. Gates: JARVIS_PREWRITE_STUDY / JARVIS_READINESS / ' +
      'JARVIS_TUITION (all default on).',
    templates: 'V4.2',
  },
];

/** The HISTORY entry matching JARVIS_VERSION (falls back to the last entry). */
function currentEntry() {
  return HISTORY.find(h => h.version === JARVIS_VERSION) ?? HISTORY[HISTORY.length - 1];
}

module.exports = { JARVIS_VERSION, HISTORY, currentEntry };
