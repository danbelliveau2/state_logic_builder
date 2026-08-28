/**
 * codePatcher.js — THE SPEED ARCHITECTURE, generation incrementality: when
 * generated code already exists and a VALUE or SECTION change lands, patch the
 * EXISTING L5X through mergeEngine edit-plan ops scoped to the affected
 * tags/rungs — never a full re-translate (that stays reserved for
 * structural-sm and decomposition classes).
 *
 * Two paths:
 *   patchValues({ l5x, targets })
 *     Deterministic, $0, sub-second: builds setTagData / updateRung ops from
 *     classified value targets (editClassifier.js), resolves each against the
 *     tags actually present in the file, applies via mergeEngine.applyEditPlan.
 *     Anything unresolvable comes back in `unresolved` — the caller marks the
 *     build stale instead of guessing (honest fallback, never wrong data).
 *
 *   patchSection({ l5x, correction, compiledIr, projectJson, smId })
 *     ONE scoped model call authoring a SMALL edit plan against the current
 *     file (not the template), merged deterministically, validated, then
 *     re-reviewed DELTA-SCOPED (internalReviewer with previousL5x +
 *     priorFindings=[]) so THE CHECK re-runs only on the changed rungs.
 *
 * CommonJS, plain Node — required lazily by server.js.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { applyEditPlan, MergeError } = require('./mergeEngine');
const { validatePlan, PLAN_SCHEMA_DOC } = require('./editPlanSchema');
const { validateL5X, formatReport } = require('./validator');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Program name of an already-generated file (its RSLogix TargetName). */
function targetNameOf(l5x) {
  const m = /<RSLogix5000Content[^>]*\bTargetName="([^"]+)"/.exec(l5x);
  return m ? m[1] : null;
}

/** Does a tag exist (program or controller scope) in the file? */
function hasTag(l5x, name) {
  return new RegExp(`<Tag Name="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s>]`).test(l5x);
}

/** Does the tag exist AND carry the member (top-level Decorated leaf)? Plain
 *  TIMER/DINT tags accept PRE/whole-value without a member listing. */
function hasTagMember(l5x, name, member) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<Tag Name="${esc}"[\\s>][\\s\\S]*?</Tag>`).exec(l5x);
  if (!m) return false;
  if (!member || member === 'PRE' || /DataType="(TIMER|DINT|REAL|BOOL)"/.test(m[0].slice(0, 200))) return true;
  return new RegExp(`Name="${member}"`).test(m[0]);
}

const compact = (s) => String(s || '').replace(/[\s_-]+/g, '');

/** Candidate (tag, member) pairs for one classified value target. Ordered —
 *  first existing wins. Naming per SDC tagNaming conventions. */
function tagCandidatesFor(target) {
  const dev = compact(target.deviceName);
  const out = [];
  if (target.kind === 'delay') {
    const dir = /extend/i.test(target.field || target.name) ? 'ext' : 'ret';
    const stems = dir === 'ext'
      ? ['ExtendDelay', 'EngageDelay', 'CloseDelay']
      : ['RetractDelay', 'DisengageDelay', 'OpenDelay'];
    for (const s of stems) out.push({ tag: `${dev}${s}`, member: 'PRE', value: target.valueMs });
  } else if (target.kind === 'position' || target.kind === 'blend' || target.kind === 'band') {
    const pos = compact(target.name);
    const value = target.valueMm ?? target.valueDeg;
    // Per-position AOI_RangeCheck instance ({Axis}{Pos}): Value = the position
    // target; DeadbandWide = the wide band (a blend row's distance lives on
    // its own corner instance, e.g. ZAxisPickRetractBlend.DeadbandWide).
    if (target.kind === 'position') {
      out.push({ tag: `${dev}${pos}`, member: 'Value', value });
    } else {
      out.push({ tag: `${dev}${pos}`, member: 'DeadbandWide', value });
      out.push({ tag: `${dev}${pos}`, member: 'Deadband', value });
    }
  } else if (target.kind === 'faultTime') {
    out.push({ tag: 'Control', member: 'FaultTime', value: target.valueMs });
  }
  return out.filter(c => Number.isFinite(c.value));
}

/** Retry-count edits live in rung compare text (GE(Counter.ACC,N)), not tags:
 *  find the actual rungs and build exact-match updateRung ops. */
function retryOpsFor(l5x, target) {
  const ops = [];
  const want = target.value;
  if (!Number.isFinite(want)) return ops;
  // Routine-scoped scan: find rungs containing a retry compare.
  const routineRe = /<Routine Name="([^"]+)"[\s\S]*?<\/Routine>/g;
  let rm;
  while ((rm = routineRe.exec(l5x)) !== null) {
    const routine = rm[1];
    const rungRe = /<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g;
    let g;
    while ((g = rungRe.exec(rm[0])) !== null) {
      const text = g[1];
      const cmpRe = /\bGE\((\w*[Rr]etry\w*)\.ACC,(\d+)\)/g;
      let c; let newText = text; let touched = false;
      while ((c = cmpRe.exec(text)) !== null) {
        if (parseInt(c[2], 10) !== want) {
          newText = newText.split(c[0]).join(`GE(${c[1]}.ACC,${want})`);
          touched = true;
        }
      }
      if (touched) {
        ops.push({ op: 'updateRung', routine, match: text.trim().slice(0, 200), newText: newText.trim() });
      }
    }
  }
  return ops;
}

// ── Value patch (deterministic, $0) ──────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.l5x       the CURRENT generated file (utf8, BOM/CRLF intact)
 * @param {Array}  opts.targets   classified value targets (editClassifier)
 * @param {string} [opts.stamp]   description stamp note
 * @returns {{ xml: string|null, applied: object[], unresolved: object[], log: string[] }}
 */
function patchValues({ l5x, targets = [], stamp = null } = {}) {
  const programName = targetNameOf(l5x);
  if (!programName) throw new Error('File has no RSLogix5000Content TargetName — not a generated L5X');
  const applied = [];
  const unresolved = [];
  const hmiParams = [];   // values that live on the HMI — no code edit exists or is needed
  const operations = [];
  for (const t of targets) {
    if (t.kind === 'retries') {
      const ops = retryOpsFor(l5x, t);
      if (ops.length) { operations.push(...ops); applied.push({ ...t, via: `${ops.length} rung compare(s)` }); }
      else unresolved.push({ ...t, why: 'no GE(*Retry*.ACC,N) compare found in any routine' });
      continue;
    }
    if (t.kind === 'position' || t.kind === 'blend' || t.kind === 'band') {
      // SDC standard: servo positions/blends are HMI PARAMETERS — the code
      // wires HMI_{Axis}.Parameters.Positions[N] at runtime and the L5X only
      // carries 0.0 initializers (verified on the ServoPNP v1.3.0 builds).
      // A value change therefore needs NO code patch: the sheet/spec table is
      // the store, the value reaches the PLC through the HMI. We verify the
      // named point is actually wired in the file and report it as an HMI
      // parameter, never as a code edit.
      const inst = compact(t.deviceName) + compact(t.name);
      const call = new RegExp(`AOI_RangeCheck\\(${inst},([^,]+),([^,]+),([^,]+),([^)\\s]+)\\)`).exec(l5x);
      const ref = call ? (t.kind === 'position' ? call[1] : call[4]).trim() : null;
      const hm = ref && /^(HMI_\w+)\.(Parameters\.Positions\[\d+\])$/.exec(ref);
      if (hm) {
        hmiParams.push({ ...t, via: `${hm[1]}.${hm[2]} — HMI parameter, code carries no copy (no patch needed)` });
      } else {
        unresolved.push({ ...t, why: call
          ? `the ${t.kind} value of ${inst} is "${ref}" — not an HMI Positions slot`
          : `no AOI_RangeCheck instance "${inst}" in the file` });
      }
      continue;
    }
    const cands = tagCandidatesFor(t);
    const hit = cands.find(c => hasTag(l5x, c.tag) && hasTagMember(l5x, c.tag, c.member));
    if (hit) {
      operations.push({ op: 'setTagData', tag: hit.tag, member: hit.member, value: hit.value });
      applied.push({ ...t, via: `${hit.tag}.${hit.member}` });
    } else {
      unresolved.push({ ...t, why: cands.length ? `none of ${cands.map(c => c.tag).join('/')} exist in the file` : 'no deterministic tag mapping for this kind' });
    }
  }
  if (!operations.length) return { xml: null, applied, hmiParams, unresolved, log: [] };
  const applyOpts = {
    smName: programName,
    stamp: stamp || `Value patch (no recompile) - SDC State Logic Builder`,
  };
  try {
    const { xml, log } = applyEditPlan(l5x, { programName, operations }, applyOpts);
    return { xml, applied, hmiParams, unresolved, log };
  } catch (e) {
    if (!(e instanceof MergeError)) throw e;
    // Partial application: drop the ops the engine refused (packed layouts,
    // missing anchors), report them honestly as unresolved, land the rest.
    const badIdx = new Set();
    for (const msg of e.errors) {
      const m = /^operations\[(\d+)\]/.exec(msg);
      if (m) badIdx.add(Number(m[1]));
    }
    if (!badIdx.size) throw e;
    const survivors = operations.filter((_, i) => !badIdx.has(i));
    const failedOps = operations.filter((_, i) => badIdx.has(i));
    const failedTags = new Set(failedOps.map(o => String(o.tag || '')).filter(Boolean));
    const stillApplied = [];
    for (const a of applied) {
      if (failedTags.size && [...failedTags].some(tag => String(a.via || '').includes(tag))) {
        unresolved.push({ ...a, why: 'merge engine refused the edit (unsupported data layout) - re-generate to pick the value up' });
      } else stillApplied.push(a);
    }
    if (!survivors.length) return { xml: null, applied: [], hmiParams, unresolved, log: [] };
    const { xml, log } = applyEditPlan(l5x, { programName, operations: survivors }, applyOpts);
    return { xml, applied: stillApplied, hmiParams, unresolved, log };
  }
}

// ── Section-scoped model patch (one small call + delta review) ───────────────

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
const MAX_TOKENS = parseInt(process.env.JARVIS_PATCH_MAX_TOKENS, 10) || 16000;

/** Program-section extract for the prompt: routine bodies only, capped. */
function programExtract(l5x, cap = 60000) {
  const m = /<Program Use="Target"[\s\S]*?<\/Program>/.exec(l5x);
  const body = m ? m[0] : l5x;
  return body.length > cap ? body.slice(0, cap) + '\n<!-- (truncated for prompt) -->' : body;
}

/**
 * @param {object} opts
 * @param {string} opts.l5x         current generated file
 * @param {string} opts.correction  the ME's section-scoped correction
 * @param {object} [opts.compiledIr] approved compiled IR (contract context)
 * @param {object} [opts.projectJson] project (for the delta review's contract)
 * @param {string} [opts.smId]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ ok, xml, validation, review, editPlan, costUSD, error? }>}
 */
async function patchSection({ l5x, correction, compiledIr = null, projectJson = null, smId = null, signal = null } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI not configured');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const programName = targetNameOf(l5x);
  if (!programName) throw new Error('File has no TargetName');

  const system =
    'You are JARVIS, the SDC Automation code patcher. A generated, validated L5X program ' +
    'already exists; the engineer sent ONE scoped correction. Author the SMALLEST edit plan ' +
    'that lands the correction — touch ONLY the rungs/tags it requires; everything else in ' +
    'the file is settled and out of scope. The plan is applied against the CURRENT file ' +
    '(not the template), so every "match" anchor must quote the file below exactly.\n\n' +
    PLAN_SCHEMA_DOC;

  const jobText = [
    '# THE CORRECTION (authoritative)',
    String(correction).trim(),
    '',
    ...(compiledIr && compiledIr.text ? ['# THE APPROVED SEQUENCE (contract context)', String(compiledIr.text).slice(0, 20000), ''] : []),
    `# THE CURRENT GENERATED PROGRAM ("${programName}") — your anchors must match this text`,
    programExtract(l5x),
    '',
    '# Your response',
    `Respond with ONLY the JSON edit plan. Set "programName": "${programName}" (the file keeps its name).`,
  ].join('\n');

  let totalCost = 0;
  let feedback = null;
  let editPlan = null;
  let xml = null;
  let validation = { ok: false, errors: ['no attempt'], warnings: [] };
  const messages = [{ role: 'user', content: jobText }];

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (feedback) messages.push({ role: 'user', content: feedback });
    const req = {
      model: MODEL, max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      system, messages,
    };
    if (/^claude-(fable|opus)-/.test(MODEL)) {
      req.betas = ['server-side-fallback-2026-07-01'];
      req.fallbacks = 'default';
    }
    const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
    const response = await stream.finalMessage();
    const { costOfUsage } = require('./client');
    if (response.usage) totalCost += costOfUsage(response.usage, MODEL);
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    messages.push({ role: 'assistant', content: text });
    const { extractPlanJson } = require('./client');
    const { plan, error } = extractPlanJson(text);
    if (!plan) { feedback = `Not a valid JSON edit plan (${error}). Respond with ONLY the JSON object.`; continue; }
    const schema = validatePlan(plan);
    if (!schema.ok) { feedback = 'Schema errors:\n' + schema.errors.map(e => `- ${e}`).join('\n'); continue; }
    editPlan = { ...plan, programName };
    try {
      ({ xml } = applyEditPlan(l5x, editPlan, {
        smName: programName,
        stamp: 'Section patch (scoped, no full re-translate) - SDC State Logic Builder',
      }));
    } catch (e) {
      if (!(e instanceof MergeError)) throw e;
      feedback = 'Merge failed — every anchor must match the CURRENT file exactly once:\n'
        + e.errors.map(x => `- ${x}`).join('\n');
      continue;
    }
    validation = validateL5X(xml, { compiledIr });
    if (!validation.ok) { feedback = 'Validation failed:\n\n' + formatReport(validation); xml = null; continue; }
    break;
  }

  if (!xml) {
    return { ok: false, xml: null, validation, review: null, editPlan, costUSD: Number(totalCost.toFixed(4)), error: feedback || 'patch failed' };
  }

  // THE CHECK, delta-scoped: re-review ONLY the changed rungs against the
  // standard (previousL5x + priorFindings=[] engages the delta path — the
  // rest of the file already shipped and stays shipped).
  let review = null;
  try {
    const { reviewGenerated } = require('./internalReviewer');
    review = await reviewGenerated({
      l5x: xml, previousL5x: l5x, priorFindings: [],
      projectJson, smId,
      compiledIrOverride: compiledIr || null, signal,
    });
    totalCost += review.costUSD || 0;
  } catch (e) {
    review = { verdict: null, error: e.message || String(e), findings: [] };
  }

  return { ok: true, xml, validation, review, editPlan, costUSD: Number(totalCost.toFixed(4)) };
}

module.exports = { patchValues, patchSection, targetNameOf, tagCandidatesFor, retryOpsFor, hasTag };
