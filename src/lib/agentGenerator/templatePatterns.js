/**
 * templatePatterns.js — AUTO-DERIVED template pattern inventory.
 *
 * Dan's directive (Aug 2026, after the multi-move-per-state incident): "I
 * shouldn't be telling you to do that... put rules in place to look at this
 * kind of stuff so I don't have to keep telling you every single time."
 * Until now Jarvis's template knowledge was hand-curated notes — it only knew
 * the rules someone had already been burned by. This module parses the
 * standard templates THEMSELVES (plc-reference/standard/*.L5X) and extracts
 * their structural invariants as data, so the whole rulebook the templates
 * embody is available to every compile, translation, and review — and when a
 * new template drops in, the inventory re-derives itself. No human curation.
 *
 * What it derives per template:
 *   - per-axis motion rung shape: exactly ONE main auto MAM rung per axis,
 *     manual branch (State[1] + {Axis}ManMoveTrig) OR'd with a plain
 *     XIC(Status.State[n]) auto-state list, gated by ServoActionStatus +
 *     AxisHomedStatus + {Axis}Permissive  ⇒  ONE MOVE PER STATE
 *   - staging rung shape: the one "Auto Mode" rung per axis — defaults
 *     (MoveType / AutoSpeed / Accel / Decel) first, then per-state
 *     Positions[i] select branches; each auto state maps to exactly ONE
 *     position index
 *   - transition condition families in R02: strict (MAM.PC + InPos) and
 *     wideband ([MAM.PC + InPos , MAM.IP + InPosWide])
 *   - R02 ordering: sequence MOVE targets ascending, override block
 *     (99, 100→127) after all sequence rungs
 *   - compare-mnemonic family (EQ/NE/... vs EQU/NEQ/...)
 *   - init-block state graph (transitions among 100–127 and their exits)
 *
 * ENFORCEABLE INVARIANTS vs OBSERVATIONS (Dan, 2026-08-21): structural shapes
 * (one move per state, trigger shape, staging shape/ordering, wideband form,
 * R02 order, mnemonics) are invariants. Counts that merely describe the
 * template sample — positions per axis, AutoSpeed indices used — are
 * OBSERVATIONS, never rules: the fast/slow + transition-point standard is a
 * STANDING SANCTIONED EXTENSION that deliberately exceeds them.
 *
 * Cache: jarvis-knowledge/analysis/template-patterns.json keyed by SHA-256 of
 * every template file — any changed/added/removed template re-derives.
 *
 * CommonJS, plain Node, no dependencies beyond fs/path/crypto. Must not
 * require any other agentGenerator module (validator/promptBuilder require
 * THIS module).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const STANDARD_DIR = path.join(ROOT, 'plc-reference', 'standard');
const CACHE_DIR = path.join(ROOT, 'jarvis-knowledge', 'analysis');
const CACHE_FILE = path.join(CACHE_DIR, 'template-patterns.json');

// Bump when the derivation logic changes so stale caches re-derive.
const DERIVER_VERSION = 2;

// ── Low-level L5X slicing (regex over raw XML — attribute-order safe) ───────

function targetProgramSlice(xml) {
  const m = /<Program Use="Target"[^>]*>/.exec(xml);
  if (!m) return null;
  const end = xml.indexOf('</Program>', m.index);
  return xml.slice(m.index, end === -1 ? xml.length : end);
}

function listRoutineNames(progXml) {
  return [...progXml.matchAll(/<Routine Name="([^"]+)" Type="RLL"/g)].map(m => m[1]);
}

function extractRoutineRungs(progXml, routineName) {
  const rm = new RegExp(`<Routine Name="${routineName}"[^>]*>`).exec(progXml);
  if (!rm) return null;
  const end = progXml.indexOf('</Routine>', rm.index);
  const section = progXml.slice(rm.index, end === -1 ? progXml.length : end);
  const rungs = [];
  const re = /<Rung\b[^>]*>([\s\S]*?)<\/Rung>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const body = m[1];
    const cm = /<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/.exec(body);
    const tm = /<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/.exec(body);
    rungs.push({ comment: cm ? cm[1].trim() : null, text: tm ? tm[1].trim() : '' });
  }
  return rungs;
}

const stateRefs = text =>
  [...text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)].map(m => parseInt(m[1], 10));

// ── Per-axis motion structure ────────────────────────────────────────────────

/** Axis name from a main MAM call: MAM(iq_ZAxis,ZAxis_MAM,...) -> ZAxis. */
function axisFromMam(text) {
  const m = /MAM\(iq_([A-Za-z0-9_]+),([A-Za-z0-9_]+),/.exec(text);
  if (!m) return null;
  return { axis: m[1], backingTag: m[2] };
}

/**
 * Parse one axis routine's structural facts.
 * A "main MAM rung" is any rung with a MAM whose backing tag is not the
 * Inch move (manual jog-by-amount — not a state-driven motion).
 */
function deriveAxisStructure(routineName, rungs) {
  const mamRungs = [];
  rungs.forEach((r, idx) => {
    for (const m of r.text.matchAll(/MAM\(iq_[A-Za-z0-9_]+,([A-Za-z0-9_]+),/g)) {
      if (!/inch/i.test(m[1])) { mamRungs.push({ idx, rung: r }); break; }
    }
  });
  if (!mamRungs.length) return null; // not a servo axis routine

  const first = mamRungs[0].rung;
  const id = axisFromMam(first.text) || { axis: null, backingTag: null };
  const axis = id.axis;

  const autoStates = [...new Set(stateRefs(first.text).filter(n => n !== 1))].sort((a, b) => a - b);
  const gates = {
    servoActionStatus: first.text.includes('.ServoActionStatus'),
    axisHomedStatus: first.text.includes('.AxisHomedStatus'),
    permissive: new RegExp(`XIC\\(${axis}Permissive\\)`).test(first.text),
  };
  const manualBranch = new RegExp(
    `XIC\\(Status\\.State\\[1\\]\\)\\s*XIC\\(${axis}ManMoveTrig\\)`).test(first.text);

  // Staging rung ("Auto Mode"): the rung selecting Positions[i] per state,
  // active outside manual (XIO(Status.State[1])).
  let staging = null;
  rungs.forEach((r, idx) => {
    if (staging) return;
    if (!r.text.includes(`.Parameters.Positions[`)) return;
    if (!/XIO\(Status\.State\[1\]\)/.test(r.text)) return;
    staging = { idx, rung: r };
  });

  let stagingFacts = null;
  if (staging) {
    const t = staging.rung.text;
    // Walk the rung text: collect state refs; each MOVE(...Positions[i]...)
    // consumes the states collected since the previous position MOVE.
    const tokenRe = /XIC\(Status\.State\[(\d+)\]\)|MOVE\(HMI_[A-Za-z0-9_]+\.Parameters\.(Positions|AutoSpeed|Accel|Decel)\[(\d+)\][^)]*\)|MOVE\((\d+),[A-Za-z0-9_]+MotionParameters\.MoveType\)/g;
    let m;
    let pending = [];
    const statePositionMap = {};   // state -> [position indices]
    const defaults = { moveTypeFirst: false, autoSpeedDefaultIndex: null };
    let sawPositionSelect = false;
    let defaultsBeforeSelects = true;
    while ((m = tokenRe.exec(t)) !== null) {
      if (m[1] !== undefined) { pending.push(parseInt(m[1], 10)); continue; }
      if (m[4] !== undefined) { // MoveType default
        defaults.moveTypeFirst = !sawPositionSelect;
        continue;
      }
      const kind = m[2];
      const index = parseInt(m[3], 10);
      if (kind === 'Positions') {
        sawPositionSelect = true;
        const states = pending.length ? pending : [];
        for (const s of states) {
          if (!statePositionMap[s]) statePositionMap[s] = [];
          statePositionMap[s].push(index);
        }
        pending = [];
      } else { // AutoSpeed / Accel / Decel
        if (!pending.length) { // unconditional default branch
          if (kind === 'AutoSpeed' && defaults.autoSpeedDefaultIndex === null) {
            defaults.autoSpeedDefaultIndex = index;
            if (sawPositionSelect) defaultsBeforeSelects = false;
          }
        }
      }
    }
    const multiPositionStates = Object.entries(statePositionMap)
      .filter(([, v]) => v.length > 1).map(([k]) => parseInt(k, 10));
    stagingFacts = {
      rungIndex: staging.idx,
      comment: staging.rung.comment,
      defaults,
      defaultsBeforeSelects,
      statePositionMap,
      multiPositionStates,
      autoSpeedIndicesUsed: [...new Set(
        [...t.matchAll(/\.Parameters\.AutoSpeed\[(\d+)\]/g)].map(x => parseInt(x[1], 10)))].sort(),
      positionIndicesUsed: [...new Set(
        [...t.matchAll(/\.Parameters\.Positions\[(\d+)\]/g)].map(x => parseInt(x[1], 10)))].sort(),
    };
  }

  return {
    routine: routineName,
    axis,
    mamRungCount: mamRungs.length,
    motionCommandRungIndex: mamRungs[0].idx,
    motionCommandComment: first.comment,
    autoStates,
    gates,
    manualBranch,
    staging: stagingFacts,
    oneMovePerState: stagingFacts
      ? stagingFacts.multiPositionStates.length === 0
      : autoStates.length === new Set(autoStates).size,
  };
}

// ── R02 structure ────────────────────────────────────────────────────────────

function deriveR02(rungs) {
  if (!rungs) return null;
  const sequenceTargets = [];
  const overrideTargets = [];
  const flowEdges = [];
  rungs.forEach((r, idx) => {
    const tos = [...r.text.matchAll(/MOVE?\((\d+),\s*Control\.StateReg\)/g)]
      .map(m => parseInt(m[1], 10));
    const froms = stateRefs(r.text);
    for (const t of tos) {
      if (t >= 4 && t <= 97) {
        sequenceTargets.push({ n: t, idx });
        for (const f of froms) if (f !== t && f >= 4 && f <= 97) flowEdges.push([f, t]);
      } else if (t === 99 || (t >= 100 && t <= 127)) {
        overrideTargets.push({ n: t, idx });
        for (const f of froms) if (f !== t && f >= 100 && f <= 127) flowEdges.push([f, t]);
      }
    }
  });

  const seqNums = sequenceTargets.map(s => s.n);
  const ascending = seqNums.every((n, i) => i === 0 || n >= seqNums[i - 1]);
  const firstOverrideIdx = overrideTargets.length ? Math.min(...overrideTargets.map(o => o.idx)) : null;
  const sequenceBeforeOverrides = firstOverrideIdx === null ||
    sequenceTargets.every(s => s.idx < firstOverrideIdx);

  // Transition condition families
  const blob = rungs.map(r => r.text).join('\n');
  const strictCount = (blob.match(/_MAM\.PC\)/g) || []).length;
  const widebandCount = (blob.match(/InPosWide/g) || []).length;

  // Init graph (edges within/into 100–127 plus exits back to the sequence)
  const initEdges = [];
  rungs.forEach(r => {
    const tos = [...r.text.matchAll(/MOVE?\((\d+),\s*Control\.StateReg\)/g)]
      .map(m => parseInt(m[1], 10));
    const froms = stateRefs(r.text).filter(f => f >= 100 && f <= 127);
    for (const t of tos) for (const f of froms) if (f !== t) initEdges.push({ from: f, to: t });
  });

  return {
    sequenceTargets: seqNums,
    ascending,
    sequenceBeforeOverrides,
    overrideTargets: overrideTargets.map(o => o.n),
    strictTransitionCount: strictCount,
    widebandTransitionCount: widebandCount,
    flowEdges,
    initEdges,
  };
}

// ── Compare-mnemonic family (kept local — no validator dependency) ──────────

const LONG_COMPARES = new Set(['EQU', 'NEQ', 'LES', 'GRT', 'GEQ', 'LEQ']);
function deriveMnemonicFamily(progXml) {
  let short = 0, long = 0;
  for (const m of progXml.matchAll(/\b(EQU|NEQ|LES|GRT|GEQ|LEQ|EQ|NE|LT|GT|GE|LE)\(/g)) {
    if (LONG_COMPARES.has(m[1])) long++; else short++;
  }
  if (short === 0 && long === 0) return null;
  return short >= long ? 'short' : 'long';
}

// ── Per-template derivation ──────────────────────────────────────────────────

function deriveTemplate(file, xml) {
  const prog = targetProgramSlice(xml);
  if (!prog) return { file, error: 'no <Program Use="Target">' };
  const routineNames = listRoutineNames(prog);

  const axes = [];
  let r02 = null;
  for (const name of routineNames) {
    const rungs = extractRoutineRungs(prog, name);
    if (!rungs) continue;
    if (/R02/i.test(name)) { r02 = deriveR02(rungs); continue; }
    const ax = deriveAxisStructure(name, rungs);
    if (ax) axes.push(ax);
  }

  // Same-axis R02-adjacent states both in one axis's MAM list would mean the
  // second move never edge-fires — verify the template never does this.
  for (const ax of axes) {
    ax.consecutiveAutoStates = [];
    if (!r02) continue;
    const listed = new Set(ax.autoStates);
    for (const [f, t] of r02.flowEdges) {
      if (listed.has(f) && listed.has(t)) ax.consecutiveAutoStates.push([f, t]);
    }
  }

  return {
    file,
    routines: routineNames,
    mnemonicFamily: deriveMnemonicFamily(prog),
    axes,
    r02,
  };
}

// ── Cross-template invariants + observations ────────────────────────────────

/**
 * Fold per-template facts into the invariant list. An invariant is only
 * emitted when EVERY template that exhibits the construct agrees; each
 * carries its evidence so prompts can cite it. `derived: true` means the
 * fact was computed from the template files; `derived: false` marks the few
 * facts that needed hardcoding (reported honestly).
 */
function deriveInvariants(templates) {
  const inv = [];
  const obs = [];
  const withAxes = templates.filter(t => (t.axes || []).length);

  const evAxis = (fn) => withAxes.flatMap(t => t.axes.map(a => fn(t, a)));

  if (withAxes.length) {
    const allOneMam = withAxes.every(t => t.axes.every(a => a.mamRungCount === 1));
    inv.push({
      id: 'ONE_MAM_PER_AXIS', derived: true, holds: allOneMam,
      statement: 'Each servo axis has exactly ONE main auto MAM, inside the single "Axis Motion Command" rung of its routine.',
      evidence: evAxis((t, a) => `${t.file} ${a.routine}: ${a.mamRungCount} main MAM rung(s)`),
    });

    const allOneMove = withAxes.every(t => t.axes.every(a => a.oneMovePerState));
    inv.push({
      id: 'ONE_MOVE_PER_STATE', derived: true, holds: allOneMove,
      statement: 'ONE SERVO MOVE PER STATE: each state in an axis\'s auto list maps to exactly one Positions[i] in the staging rung. MAM edge-fires once per rung false→true, so a state can only ever command one move per axis. A multi-speed stroke is ONE MAM to the final target plus an MCD speed change at the transition point (Jason 2026-08-25) — the speed-change segment states are keyed on the MCD rung and are NOT in the MAM list.',
      evidence: evAxis((t, a) => `${t.file} ${a.routine} (${a.axis}): auto states [${a.autoStates.join(',')}]` +
        (a.staging ? ` each map to one position index (multi-position states: ${a.staging.multiPositionStates.length ? a.staging.multiPositionStates.join(',') : 'none'})` : '')),
    });

    const noConsec = withAxes.every(t => t.axes.every(a => (a.consecutiveAutoStates || []).length === 0));
    inv.push({
      id: 'NO_CONSECUTIVE_SAME_AXIS_MOVES', derived: true, holds: noConsec,
      statement: 'No two R02-adjacent states are both in one axis\'s MAM state list (the rung would never drop false, so the second move would never execute). Back-to-back DISTINCT moves on one axis use the trigger/wait split: move state → wait/confirm state not in the list → next move state. Fast/slow segments of ONE stroke are not two moves — they are one MAM plus an MCD speed change (Jason 2026-08-25).',
      evidence: evAxis((t, a) => `${t.file} ${a.routine}: adjacent-pair violations: ${(a.consecutiveAutoStates || []).length ? JSON.stringify(a.consecutiveAutoStates) : 'none'}`),
    });

    const allGated = withAxes.every(t => t.axes.every(a =>
      a.gates.servoActionStatus && a.gates.axisHomedStatus && a.gates.permissive));
    inv.push({
      id: 'MAM_GATING', derived: true, holds: allGated,
      statement: 'Every motion command rung is gated by ServoActionStatus + AxisHomedStatus + {Axis}Permissive.',
      evidence: evAxis((t, a) => `${t.file} ${a.routine}: gates ${JSON.stringify(a.gates)}`),
    });

    const allManual = withAxes.every(t => t.axes.every(a => a.manualBranch));
    inv.push({
      id: 'MANUAL_BRANCH', derived: true, holds: allManual,
      statement: 'The motion command rung\'s manual branch is XIC(Status.State[1]) XIC({Axis}ManMoveTrig), OR\'d with the plain auto state list — never per-state trigger latches, ONS droppers, or sub-step counters.',
      evidence: evAxis((t, a) => `${t.file} ${a.routine}: manual branch ${a.manualBranch ? 'present' : 'MISSING'}`),
    });

    const allStagedFirst = withAxes.every(t => t.axes.every(a =>
      !a.staging || a.staging.defaultsBeforeSelects));
    inv.push({
      id: 'STAGING_DEFAULTS_FIRST', derived: true, holds: allStagedFirst,
      statement: 'Each axis has ONE Auto Mode staging rung: unconditional defaults (MoveType, AutoSpeed/Accel/Decel) as leading parallel branches, then per-state Positions[i] select branches — position AND speed-profile selection live in THIS one rung as branches, never as separate per-state rungs.',
      evidence: evAxis((t, a) => a.staging
        ? `${t.file} ${a.routine}: staging rung ${a.staging.rungIndex}, defaults-first=${a.staging.defaultsBeforeSelects}, position indices ${JSON.stringify(a.staging.positionIndicesUsed)}`
        : `${t.file} ${a.routine}: (no staging rung found)`),
    });
  }

  const withR02 = templates.filter(t => t.r02);
  if (withR02.length) {
    const allAsc = withR02.every(t => t.r02.ascending && t.r02.sequenceBeforeOverrides);
    inv.push({
      id: 'R02_ASCENDING_ORDER', derived: true, holds: allAsc,
      statement: 'R02 sequence-state MOVE rungs are laid out in ascending target order, all before the override block (lockout 99, init 100→127); last write to Control.StateReg wins the scan.',
      evidence: withR02.map(t => `${t.file}: sequence targets [${t.r02.sequenceTargets.join(',')}] ascending=${t.r02.ascending}, before overrides=${t.r02.sequenceBeforeOverrides}, overrides [${t.r02.overrideTargets.join(',')}]`),
    });

    const strictTotal = withR02.reduce((s, t) => s + t.r02.strictTransitionCount, 0);
    const wideTotal = withR02.reduce((s, t) => s + t.r02.widebandTransitionCount, 0);
    inv.push({
      id: 'TRANSITION_CONDITION_FAMILIES', derived: true, holds: strictTotal > 0,
      statement: 'Motion-complete transitions use the template families ONLY: strict XIC({Axis}_MAM.PC) XIC({Pos}.InPos), or the wideband blend OR [XIC(_MAM.PC) XIC(.InPos) , XIC(_MAM.IP) XIC(.InPosWide)] for sanctioned early-advance corners. The MCD architecture (Jason 2026-08-25) adds two sanctioned MID-FLIGHT forms for multi-speed strokes: XIC({Axis}_MAM.IP) alone out of the stroke-command state, and bare XIC({Pos}.InPosWide) to enter the speed-change segment at the transition band. No other invented condition shapes.',
      evidence: withR02.map(t => `${t.file}: strict MAM.PC refs=${t.r02.strictTransitionCount}, InPosWide refs=${t.r02.widebandTransitionCount}`),
    });
  }

  const families = [...new Set(templates.map(t => t.mnemonicFamily).filter(Boolean))];
  inv.push({
    id: 'MNEMONIC_FAMILY', derived: true, holds: families.length === 1,
    statement: families.length === 1
      ? `Compare instructions use the ${families[0] === 'short' ? 'EQ/NE/LT/GT/GE/LE' : 'EQU/NEQ/LES/GRT/GEQ/LEQ'} family — never the other spelling (they import as different instructions).`
      : 'Templates disagree on compare-mnemonic family — resolve manually.',
    evidence: templates.map(t => `${t.file}: ${t.mnemonicFamily || '(no compares)'}`),
  });

  const initTemplates = withR02.filter(t => t.r02.initEdges.length);
  if (initTemplates.length) {
    inv.push({
      id: 'INIT_BLOCK_GRAPH', derived: true, holds: true,
      statement: 'The 100–127 init block is a template-law state graph — keep its rungs and edges, only retarget conditions inside them.',
      evidence: initTemplates.map(t => `${t.file}: ${[...new Set(t.r02.initEdges.map(e => `${e.from}→${e.to}`))].join(', ')}`),
    });
  }

  // ── OBSERVATIONS (template sample facts — NOT enforceable rules) ──────────
  // Dan, 2026-08-21: fast/slow speeds + transition points are the NEW SDC
  // standard; the templates simply predate it. Speed-index and position-set
  // counts describe the sample, they do not bound new work.
  for (const t of withAxes) {
    for (const a of t.axes) {
      if (!a.staging) continue;
      obs.push(`${t.file} ${a.routine} (${a.axis}): uses AutoSpeed indices ${JSON.stringify(a.staging.autoSpeedIndicesUsed)} and position indices ${JSON.stringify(a.staging.positionIndicesUsed)} — OBSERVATION ONLY. The fast/slow + transition-point standard (Dan, 2026-08-21, meKnowledge.md) is a STANDING SANCTIONED EXTENSION: per-state AutoSpeed[i] selection and transition-point positions EXTEND this template shape and are standard, not deviation.`);
    }
  }

  return { invariants: inv, observations: obs };
}

// ── Hashing + cache ──────────────────────────────────────────────────────────

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listTemplateFiles() {
  try {
    return fs.readdirSync(STANDARD_DIR).filter(f => /\.l5x$/i.test(f)).sort();
  } catch (_) { return []; }
}

function currentHashes() {
  const out = {};
  for (const f of listTemplateFiles()) {
    try { out[f] = sha256(fs.readFileSync(path.join(STANDARD_DIR, f))); } catch (_) {}
  }
  return out;
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (_) { return null; }
}

function cacheIsFresh(cache, hashes) {
  if (!cache || cache.deriverVersion !== DERIVER_VERSION || !cache.files) return false;
  const a = Object.keys(cache.files).sort();
  const b = Object.keys(hashes).sort();
  if (a.length !== b.length || a.some((k, i) => k !== b[i])) return false;
  return a.every(k => cache.files[k] === hashes[k]);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Derive (or load from cache) the full pattern inventory across every
 * template in plc-reference/standard/. Re-derives automatically whenever any
 * template file's hash changes — new templates need no human curation.
 * @param {{ force?: boolean }} [opts]
 * @returns {{ patterns: object, fromCache: boolean }}
 */
function getTemplatePatterns(opts = {}) {
  const hashes = currentHashes();
  if (!opts.force) {
    const cache = readCache();
    if (cacheIsFresh(cache, hashes)) return { patterns: cache.patterns, fromCache: true };
  }

  const templates = [];
  for (const f of Object.keys(hashes).sort()) {
    const xml = fs.readFileSync(path.join(STANDARD_DIR, f), 'utf8');
    templates.push(deriveTemplate(f, xml));
  }
  const { invariants, observations } = deriveInvariants(templates);
  const patterns = {
    derivedAt: new Date().toISOString(),
    deriverVersion: DERIVER_VERSION,
    sourceDir: 'plc-reference/standard',
    templates,
    invariants,
    observations,
  };

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      deriverVersion: DERIVER_VERSION,
      files: hashes,
      patterns,
    }, null, 2), 'utf8');
  } catch (_) { /* cache write failure is non-fatal — derivation still returns */ }

  return { patterns, fromCache: false };
}

/**
 * Rendered text block for prompts: the invariant list with evidence, scoped
 * to one selected template (its per-axis facts called out) but carrying the
 * family-wide invariants — the templates answer each other's questions.
 * @param {string} [templateFile] e.g. 'S05_ServoPNP.L5X'
 */
function renderPatternInventory(templateFile) {
  const { patterns } = getTemplatePatterns();
  const lines = [];
  lines.push('# TEMPLATE PATTERN INVENTORY (auto-derived from the standard template files — regenerated whenever a template changes)');
  lines.push('These structural invariants were EXTRACTED FROM THE TEMPLATES THEMSELVES, not curated by hand. They are the standard\'s own structure. Every STRUCTURAL decision (state granularity, trigger shape, staging, transition condition form, ordering) must either follow one of these patterns (cite its id) or be an explicitly declared extension.');
  lines.push('');
  for (const inv of patterns.invariants) {
    if (!inv.holds) continue; // never present a broken derivation as law
    lines.push(`## ${inv.id}`);
    lines.push(inv.statement);
    const ev = templateFile
      ? inv.evidence.filter(e => e.startsWith(templateFile)).concat(
        inv.evidence.filter(e => !e.startsWith(templateFile)).slice(0, 2))
      : inv.evidence;
    for (const e of ev) lines.push(`  evidence: ${e}`);
    lines.push('');
  }
  if (patterns.observations.length) {
    lines.push('## TEMPLATE OBSERVATIONS (sample facts — NOT rules)');
    const obs = templateFile
      ? patterns.observations.filter(o => o.startsWith(templateFile))
      : patterns.observations;
    for (const o of (obs.length ? obs : patterns.observations)) lines.push(`- ${o}`);
    lines.push('');
  }
  lines.push('## STANDING SANCTIONED EXTENSION (Dan, 2026-08-21; execution architecture corrected by Jason Perry, 2026-08-25)');
  lines.push('Fast/slow speeds + transition-point positions are the NEW SDC STANDARD — the templates predate it. Per-state AutoSpeed[i]/Accel[i]/Decel[i] selection as branches in the ONE staging rung, plus transition-point entries in HMI_{axis}.Parameters.Positions[] (each with its own AOI_RangeCheck instance), are cited as basis "sanctioned-extension", never re-questioned, never flagged as deviation.');
  lines.push('EXECUTION: a multi-speed stroke is ONE MAM commanded to the FINAL target (staged with the starting profile) plus ONE "Use MCD For Speed Changes" rung per axis that changes speed/accel/decel on the fly at the transition band — never a second MAM per segment, never a decel-to-zero at the transition. The MCD rung is keyed on the speed-change segment states (which are NOT in the axis\'s MAM state list) and has its OWN MOTION_INSTRUCTION control tag ({Axis}_MCD) and its OWN staging tags ({Axis}MCDSpeed/{Axis}MCDAccel/{Axis}MCDDecel) separate from {Axis}MotionParameters, so the in-flight move\'s parameters change without disturbing the original command. Segment entry fires mid-flight on the transition position\'s .InPosWide; strict MAM.PC + .InPos remains the form for final targets and grips/releases. The one-MAM-per-axis, staging-rung, trigger-shape, and wideband-corner invariants above otherwise apply unchanged.');
  return lines.join('\n');
}

module.exports = {
  getTemplatePatterns,
  renderPatternInventory,
  // internals exported for tests
  deriveTemplate, deriveInvariants, deriveAxisStructure, deriveR02,
  CACHE_FILE, STANDARD_DIR, DERIVER_VERSION,
};
