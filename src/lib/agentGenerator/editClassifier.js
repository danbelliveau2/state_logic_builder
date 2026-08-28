/**
 * editClassifier.js — THE SPEED ARCHITECTURE, step 1: classify an ME
 * correction/edit BEFORE any expensive pipeline runs, so the apply route can
 * do only the work the change actually needs (Dan: "I can't iterate — every
 * change takes 10 minutes and redoes everything. It should only change what
 * it needs to.")
 *
 * classifyEdit({ text, sheet, smSplit, compiledSequence, hasGeneratedCode })
 *   → { class: 'value' | 'section' | 'structural-sm' | 'decomposition',
 *       confidence: 'deterministic' | 'model' | 'default',
 *       targets:   [ { kind:'delay'|'position'|'speed'|'retries'|'faultTime'
 *                        |'blend'|'fixtureCount', deviceName, field, name?,
 *                       valueMs?|valueMm?|valueMmS?|valueDeg?|value? } ],   // class 'value' only
 *       section:   'sequence'|'devices'|'failureHandling'|'interactions'|null, // class 'section'
 *       machine:   '<planned SM name from smSplit>' | null,                 // class 'structural-sm'
 *       reason:    '<one sentence why this class>' }
 *
 * The four classes and what runs for each (the handlers live at the route):
 *   value          — named values changing (timers, positions, bands, speeds,
 *                    delays, retry counts). NO planning model call: direct
 *                    patch through the persistence paths. Seconds, $0.
 *   section        — one section's CONTENT changes (sequence step wording,
 *                    device config, a fault-recovery step, interactions) with
 *                    no states/devices added or removed. Scoped cheap-model
 *                    section patch. Target <20 s.
 *   structural-sm  — states/transitions/devices added/removed WITHIN one
 *                    planned machine. Re-plan ONLY that machine (multi-SM
 *                    compiledSequence is per-machine). ~2-4 min.
 *   decomposition  — SM count/boundaries change. Full compile (the only case).
 *
 * DETERMINISTIC FIRST: a value diff is detectable without a model (a number +
 * unit + a name that resolves to an existing named row/field on the sheet).
 * Decomposition keywords are equally mechanical. Only the section-vs-
 * structural boundary is fuzzy — that falls through to classifyEditWithModel
 * (fast model, one tiny call) when the caller allows it; pure classifyEdit
 * returns its best deterministic guess with confidence 'default'.
 *
 * CommonJS, plain Node, no dependencies. Pure functions — unit-tested in
 * test/editClassifier.test.js against Dan's real corrections from 2026-08-25.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────────

// Value nouns → target kind. Full words, SDC style.
const VALUE_NOUNS = [
  { re: /\b(delay|timer|dwell|debounce)s?\b/i, kind: 'delay' },
  { re: /\b(retry|retries|attempts?|tries)\b/i, kind: 'retries' },
  { re: /\bfault\s*(time|timeout)\b/i, kind: 'faultTime' },
  { re: /\b(blend)s?\b/i, kind: 'blend' },
  { re: /\b(speed|velocity|fast|slow)\b/i, kind: 'speed' },
  { re: /\b(position|height|transition\s*point|retract|pick|place|clearance|stroke)\b/i, kind: 'position' },
  { re: /\b(fixtures?|nests?)\b/i, kind: 'fixtureCount' },
  { re: /\b(band|deadband|tolerance|in\s*pos)\b/i, kind: 'band' },
];

// number + unit → canonical value field. Bare numbers allowed when a value
// noun pinned the kind.
const UNIT_RE = /(-?\d+(?:\.\d+)?)\s*(ms|milliseconds?|s\b|secs?|seconds?|mm\/s|mm|millimet(?:er|re)s?|deg(?:rees)?|°|%)?/gi;

// Structural verbs — states/devices/steps appearing or disappearing.
const STRUCTURAL_RE = /\b(add|remove|delete|drop|insert|new|another|extra|get\s+rid\s+of|instead\s+of|swap|replace|reorder|move\s+(the\s+)?step|before\s+the|after\s+the|skip|no\s+longer|don'?t\s+.*\s+anymore|split\s+the\s+step|combine\s+the\s+steps?)\b/i;

// Device/sensor nouns that, with a structural verb, mean structure changed.
const DEVICE_NOUN_RE = /\b(sensor|cylinder|gripper|axis|servo|shuttle|conveyor|robot|camera|vision|device|signal|handshake|counter|state|step|wait|branch|verify)\b/i;

// Decomposition — SM count/boundaries.
const DECOMP_RE = /\b(state\s*machines?|programs?)\b/i;
const DECOMP_VERB_RE = /\b(split|merge|combine|separate|another|one\s+more|fewer|extra|own|move\s+.*\s+(into|to)\s+.*\b(machine|program)|should\s+be\s+(its\s+own|\d+|one|two|three|four|five))\b/i;
const DECOMP_COUNT_RE = /\b(one|two|three|four|five|\d+)\s+(state\s*machines?|programs?)\b/i;

const SECTION_HINTS = [
  { re: /\b(recover|recovery|fault|fail|alarm|abort|jam|stuck)\b/i, section: 'failureHandling' },
  { re: /\b(interact|handshake|upstream|downstream|feeds?|robot\s+tells|other\s+station|supervisor)\b/i, section: 'interactions' },
  { re: /\b(step|sequence|order|then|first|before|after|cycle)\b/i, section: 'sequence' },
  { re: /\b(sensor|stroke|gripper|cylinder|axis|device)\b/i, section: 'devices' },
];

// ── Sheet-name resolution ─────────────────────────────────────────────────────

/** Fraction of a name's distinctive words present in the text.
 *  "hold down" vs Hold_Down_Cylinder → 1.0; "shuttle" vs
 *  HorizontalShuttleCylinder → 0.5. 0 when nothing matches. */
function matchRatio(text, name) {
  if (!name) return 0;
  const words = String(name).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/)
    .map(w => w.toLowerCase()).filter(w => w.length > 2 &&
      !['the', 'cylinder', 'sensor', 'axis'].includes(w));
  if (!words.length) return 0;
  const t = String(text).toLowerCase();
  const hit = words.filter(w => t.includes(w)).length;
  return hit >= 1 ? hit / words.length : 0;
}

/** Loose word-match: "hold down" matches Hold_Down_Cylinder / HoldDownCylinder. */
function looseNameMatch(text, name) {
  return matchRatio(text, name) >= 0.5;
}

/** Every named value row/field the sheet exposes (the value-patch surface). */
function collectNamedValues(sheet) {
  const out = [];
  const devices = Array.isArray(sheet && sheet.devices) ? sheet.devices : [];
  for (const d of devices) {
    const dev = d.name || d.displayName || '';
    if (d.delays) {
      if (d.delays.extendMs !== undefined) out.push({ kind: 'delay', deviceName: dev, field: 'delays.extendMs', name: 'extend' });
      if (d.delays.retractMs !== undefined) out.push({ kind: 'delay', deviceName: dev, field: 'delays.retractMs', name: 'retract' });
    }
    // Sensorless pneumatics get default delays even when unstated — the rows
    // exist on the rendered sheet, so they are patchable by name.
    if (/^Pneumatic/i.test(d.type || '') && !d.delays) {
      out.push({ kind: 'delay', deviceName: dev, field: 'delays.extendMs', name: 'extend', defaulted: true });
      out.push({ kind: 'delay', deviceName: dev, field: 'delays.retractMs', name: 'retract', defaulted: true });
    }
    for (const p of Array.isArray(d.positions) ? d.positions : []) {
      out.push({
        kind: /blend/i.test(p.name) ? 'blend' : 'position',
        deviceName: dev, field: `positions.${p.name}.valueMm`, name: p.name,
      });
    }
    if (d.speeds || d.type === 'ServoAxis') {
      out.push({ kind: 'speed', deviceName: dev, field: 'speeds.fastMmS', name: 'Fast' });
      out.push({ kind: 'speed', deviceName: dev, field: 'speeds.slowMmS', name: 'Slow' });
    }
    if (d.fixtureCount !== undefined) {
      out.push({ kind: 'fixtureCount', deviceName: dev, field: 'fixtureCount', name: 'fixtures' });
    }
    if (d.strokeMm !== undefined) {
      out.push({ kind: 'position', deviceName: dev, field: 'strokeMm', name: 'stroke' });
    }
  }
  for (const f of Array.isArray(sheet && sheet.failureHandling) ? sheet.failureHandling : []) {
    if (f.retries !== undefined) out.push({ kind: 'retries', deviceName: null, field: 'failureHandling.retries', name: f.when || 'retries' });
  }
  return out;
}

/** Normalize a stated number+unit to the canonical field value. */
function normalizeValue(kind, num, unit) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').toLowerCase();
  if (kind === 'delay' || kind === 'faultTime') {
    if (/^s($|ec)/.test(u) || /second/.test(u)) return { valueMs: Math.round(n * 1000) };
    return { valueMs: Math.round(n) }; // ms default (bare number in a delay context)
  }
  if (kind === 'position' || kind === 'blend' || kind === 'band') {
    if (/deg|°/.test(u)) return { valueDeg: n };
    return { valueMm: n };
  }
  if (kind === 'speed') return { valueMmS: n };
  if (kind === 'retries' || kind === 'fixtureCount') return { value: Math.round(n) };
  return { value: n };
}

// ── Sentence-level value-edit extraction ─────────────────────────────────────

/** Split a correction into clauses so multi-edit messages classify per-ask. */
function splitClauses(text) {
  return String(text || '')
    .split(/(?<=[.;!?])\s+|\band\s+(?:also\s+)?(?:the\s+)|\balso[, ]+/i)
    .map(s => s.trim()).filter(s => s.length > 2);
}

/** Try to resolve one clause as a pure value edit. */
function matchValueEdit(clause, namedValues) {
  const noun = VALUE_NOUNS.find(v => v.re.test(clause));
  UNIT_RE.lastIndex = 0;
  const nums = [];
  let m;
  while ((m = UNIT_RE.exec(clause)) !== null) {
    // skip bare small integers that are step references ("step 6")
    const before = clause.slice(Math.max(0, m.index - 12), m.index);
    if (/\bstep\s*$|\bstate\s*$/i.test(before)) continue;
    nums.push({ num: m[1], unit: m[2] || '' });
  }
  if (!nums.length) return null;
  // Candidate targets: rows whose DEVICE the clause names. A bare row name
  // ("extend", "Pick") never qualifies a row on its own — it only narrows
  // among the named device's rows below (otherwise "extend delay 1 second"
  // would fan out to every device's extend row). Device-less rows (retries,
  // fault time) may match by row/kind name alone.
  const scored = namedValues
    .filter(v => v.deviceName)
    .map(v => ({ v, score: matchRatio(clause, v.deviceName) }))
    .filter(x => x.score >= 0.5);
  // BEST device wins outright: "vertical shuttle" (1.0) must not also pull in
  // HorizontalShuttleCylinder (0.5).
  const top = scored.length ? Math.max(...scored.map(x => x.score)) : 0;
  let candidates = scored.filter(x => x.score === top).map(x => x.v);
  if (!candidates.length) {
    // Device-less rows (retries, fault time) match by row/kind name alone.
    candidates = namedValues.filter(v => !v.deviceName && v.name && looseNameMatch(clause, v.name));
  }
  if (!candidates.length) {
    // Distinctive NAMED ROWS (servo positions/blends — Pick, PlaceTransition,
    // PickRetractBlend) may match by row name without the device being named:
    // "the pick retract blend should be 3mm". Never delays/speeds — their row
    // names (extend/Fast) are shared by every device.
    candidates = namedValues.filter(v =>
      ['position', 'blend', 'band', 'fixtureCount'].includes(v.kind)
      && v.name && matchRatio(clause, v.name) === 1);
  }
  if (!candidates.length) return null;
  const kind = noun ? noun.kind : candidates[0].kind;
  // Narrow by kind, then by row-name mention (extend vs retract, Pick vs Place).
  let pool = candidates.filter(c => c.kind === kind);
  if (!pool.length) pool = candidates;
  const named = pool.filter(c => c.name && looseNameMatch(clause, c.name));
  if (named.length) pool = named;
  // One number, several rows of one device+kind ("gripper delays 250"):
  // fan the value out to all rows; several numbers pair in order.
  const targets = [];
  if (nums.length === 1 && pool.length >= 1) {
    for (const c of pool) targets.push({ ...c, ...normalizeValue(c.kind, nums[0].num, nums[0].unit) });
  } else {
    for (let i = 0; i < Math.min(nums.length, pool.length); i++) {
      targets.push({ ...pool[i], ...normalizeValue(pool[i].kind, nums[i].num, nums[i].unit) });
    }
  }
  return targets.length ? targets : null;
}

// ── Machine attribution (structural-sm scope) ────────────────────────────────

/** Which planned machine (smSplit entry) does this correction talk about? */
function attributeMachine(text, smSplit) {
  const split = Array.isArray(smSplit) ? smSplit : [];
  const scores = split.map(m => {
    let s = 0;
    if (looseNameMatch(text, m.name)) s += 3;
    for (const dn of Array.isArray(m.deviceNames) ? m.deviceNames : []) {
      if (looseNameMatch(text, dn)) s += 2;
    }
    for (const step of Array.isArray(m.sequence) ? m.sequence : []) {
      // cheap overlap on distinctive words
      const words = String(step).toLowerCase().split(/\W+/).filter(w => w.length > 5);
      const t = text.toLowerCase();
      if (words.some(w => t.includes(w))) s += 1;
    }
    return { name: m.name, score: s };
  }).sort((a, b) => b.score - a.score);
  if (!scores.length || scores[0].score === 0) return { machine: null, ambiguous: false };
  const ambiguous = scores.length > 1 && scores[1].score > 0 && scores[1].score >= scores[0].score * 0.8;
  return { machine: scores[0].name, ambiguous };
}

// ── The classifier ────────────────────────────────────────────────────────────

/**
 * Deterministic classification. Never calls a model.
 * confidence 'deterministic' = safe to route without the model fallback;
 * 'default' = best guess, caller should confirm with classifyEditWithModel.
 */
function classifyEdit({ text, sheet = null, smSplit = null } = {}) {
  const t = String(text || '').trim();
  if (!t) return { class: 'section', confidence: 'default', targets: [], section: null, machine: null, reason: 'empty correction' };

  // (d) DECOMPOSITION — SM count/boundaries named explicitly.
  if (DECOMP_RE.test(t) && (DECOMP_VERB_RE.test(t) || DECOMP_COUNT_RE.test(t))) {
    return {
      class: 'decomposition', confidence: 'deterministic',
      targets: [], section: null, machine: null,
      reason: 'the correction names state-machine count/boundaries',
    };
  }

  // (a) VALUE-ONLY — every clause with a number resolves to a named sheet row,
  // and NO clause carries structural language.
  const clauses = splitClauses(t);
  const namedValues = collectNamedValues(sheet);
  const valueTargets = [];
  let sawNumberClause = false;
  let allValueClauses = clauses.length > 0;
  for (const c of clauses) {
    UNIT_RE.lastIndex = 0;
    const hasNumber = UNIT_RE.test(c);
    if (STRUCTURAL_RE.test(c) && DEVICE_NOUN_RE.test(c)) { allValueClauses = false; continue; }
    if (!hasNumber) {
      // a clause with no number and no structural language is neutral filler
      // ("okay so", "one more thing") unless it carries section content
      if (VALUE_NOUNS.some(v => v.re.test(c)) || c.split(/\s+/).length <= 4) continue;
      allValueClauses = false;
      continue;
    }
    sawNumberClause = true;
    const targets = matchValueEdit(c, namedValues);
    if (targets) valueTargets.push(...targets);
    else allValueClauses = false;
  }
  if (sawNumberClause && allValueClauses && valueTargets.length) {
    return {
      class: 'value', confidence: 'deterministic',
      targets: valueTargets, section: null, machine: null,
      reason: `every ask resolves to a named value row (${valueTargets.map(v => `${v.deviceName ? v.deviceName + '.' : ''}${v.name}`).join(', ')})`,
    };
  }

  // (c) STRUCTURAL-SM — structural verbs on devices/steps/states, attributable
  // to one planned machine.
  const structural = STRUCTURAL_RE.test(t) && DEVICE_NOUN_RE.test(t);
  const { machine, ambiguous } = attributeMachine(t, smSplit);
  if (structural) {
    return {
      class: 'structural-sm',
      confidence: machine && !ambiguous ? 'deterministic' : 'default',
      targets: valueTargets, section: null, machine,
      reason: machine
        ? `structural change scoped to ${machine}`
        : 'structural change; owning machine unresolved — model confirm recommended',
    };
  }

  // (b) SECTION-SCOPED — everything else: content edits with no structure change.
  const hint = SECTION_HINTS.find(h => h.re.test(t));
  return {
    class: 'section',
    confidence: valueTargets.length ? 'default' : (hint ? 'deterministic' : 'default'),
    targets: valueTargets,
    section: hint ? hint.section : null,
    machine,
    reason: hint
      ? `content edit in the ${hint.section} section, no structure change detected`
      : 'no value/structure/decomposition signals — treated as a section content edit',
  };
}

// ── Fast-model fallback for ambiguity ────────────────────────────────────────

const FALLBACK_MODEL = process.env.JARVIS_CLASSIFIER_MODEL || 'claude-haiku-4-5';

/**
 * ONE tiny fast-model call to settle an ambiguous classification. Called by
 * the route ONLY when classifyEdit returned confidence 'default'. The model
 * sees the correction + a compact sheet digest and returns the class (and
 * machine/section). Deterministic result fields (targets) are kept — the
 * model never invents value patches.
 */
async function classifyEditWithModel({ text, sheet = null, smSplit = null, deterministic = null, signal = null } = {}) {
  const det = deterministic || classifyEdit({ text, sheet, smSplit });
  if (det.confidence === 'deterministic') return det;
  if (!process.env.ANTHROPIC_API_KEY) return det; // honest fallback: best guess
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const machines = (Array.isArray(smSplit) ? smSplit : []).map(m => ({
    name: m.name, devices: m.deviceNames || [], steps: (m.sequence || []).slice(0, 12),
  }));
  const digest = {
    devices: (sheet && sheet.devices || []).map(d => ({
      name: d.name || d.displayName, type: d.type,
      positions: (d.positions || []).map(p => p.name),
      delays: d.delays || null,
    })),
    sequence: (sheet && sheet.sequence || []).slice(0, 30),
    machines,
  };
  const prompt =
    'Classify this mechanical engineer\'s correction to an automation-station spec into EXACTLY one class:\n' +
    '- "value": only named values change (timers, positions, speeds, delays, retry counts). No steps/devices/states added, removed, or reordered.\n' +
    '- "section": one section\'s content changes (step wording, a fault-recovery behavior, device config detail, an interaction) but no states/devices/steps are added or removed and no values-only change.\n' +
    '- "structural-sm": states, steps, transitions, or devices are added/removed/reordered WITHIN one state machine.\n' +
    '- "decomposition": the number or boundaries of the state machines themselves change.\n\n' +
    `SHEET DIGEST:\n${JSON.stringify(digest)}\n\nCORRECTION:\n${String(text).trim()}\n\n` +
    'Respond with ONLY JSON: {"class":"value|section|structural-sm|decomposition",' +
    '"machine":"<planned machine name from the digest, or null>",' +
    '"section":"sequence|devices|failureHandling|interactions|null",' +
    '"reason":"<one short sentence>"}';
  const req = {
    model: FALLBACK_MODEL, max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  };
  try {
    const r = await client.messages.create(req, signal ? { signal } : undefined);
    const raw = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(s, e + 1));
    const cls = ['value', 'section', 'structural-sm', 'decomposition'].includes(parsed.class)
      ? parsed.class : det.class;
    const machineNames = new Set(machines.map(m => m.name));
    return {
      ...det,
      class: cls,
      confidence: 'model',
      machine: machineNames.has(parsed.machine) ? parsed.machine : det.machine,
      section: ['sequence', 'devices', 'failureHandling', 'interactions'].includes(parsed.section)
        ? parsed.section : det.section,
      reason: String(parsed.reason || det.reason).trim(),
      classifierModel: FALLBACK_MODEL,
      classifierCostUSD: r.usage
        ? Number((((r.usage.input_tokens || 0) * 1 + (r.usage.output_tokens || 0) * 5) / 1e6).toFixed(5))
        : 0,
    };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) throw e;
    return { ...det, classifierError: e.message || String(e) };
  }
}

// ── Sheet value patch (class a handler — deterministic, $0) ─────────────────

/**
 * Apply classified value targets to a structured sheet (summarize shape).
 * Pure: returns a new sheet + the computed changesMade receipt entries.
 * Unmatched targets come back in `unapplied` (the caller reports honestly).
 */
function applyValueTargetsToSheet(sheet, targets = []) {
  const out = JSON.parse(JSON.stringify(sheet || {}));
  out.devices = Array.isArray(out.devices) ? out.devices : [];
  const changesMade = [];
  const unapplied = [];
  const fmt = (t) => t.valueMs !== undefined ? `${t.valueMs} ms`
    : t.valueMm !== undefined ? `${t.valueMm} mm`
    : t.valueDeg !== undefined ? `${t.valueDeg}°`
    : t.valueMmS !== undefined ? `${t.valueMmS} mm/s`
    : String(t.value);
  for (const t of targets) {
    let done = false;
    if (t.field && t.field.startsWith('failureHandling.')) {
      for (const f of Array.isArray(out.failureHandling) ? out.failureHandling : []) {
        if (f.retries !== undefined || /retry|retries|attempt/i.test(`${f.when} ${f.then}`)) {
          f.retries = t.value; done = true;
          changesMade.push({ section: 'failureHandling', text: `Retries set to ${t.value}` });
          break;
        }
      }
    } else {
      const dev = out.devices.find(d => looseNameMatch(`${d.name} ${d.displayName || ''}`, t.deviceName)
        || looseNameMatch(t.deviceName || '', d.name));
      if (dev && t.field) {
        if (t.field === 'delays.extendMs' || t.field === 'delays.retractMs') {
          dev.delays = dev.delays || {};
          dev.delays[t.field.split('.')[1]] = t.valueMs; done = true;
          changesMade.push({ section: 'devices', text: `${dev.name}: ${t.name} delay → ${fmt(t)}` });
        } else if (t.field.startsWith('positions.')) {
          const posName = t.field.split('.')[1];
          dev.positions = Array.isArray(dev.positions) ? dev.positions : [];
          let row = dev.positions.find(p => compactEq(p.name, posName));
          if (!row) { row = { name: posName }; dev.positions.push(row); }
          row.valueMm = t.valueMm ?? t.valueDeg; done = true;
          changesMade.push({ section: 'devices', text: `${dev.name}: ${posName} → ${fmt(t)}` });
        } else if (t.field === 'speeds.fastMmS' || t.field === 'speeds.slowMmS') {
          dev.speeds = dev.speeds || {};
          dev.speeds[t.field.split('.')[1]] = t.valueMmS; done = true;
          changesMade.push({ section: 'devices', text: `${dev.name}: ${t.name} speed → ${fmt(t)}` });
        } else if (t.field === 'strokeMm') {
          dev.strokeMm = t.valueMm; done = true;
          changesMade.push({ section: 'devices', text: `${dev.name}: stroke → ${fmt(t)}` });
        } else if (t.field === 'fixtureCount') {
          dev.fixtureCount = t.value; done = true;
          changesMade.push({ section: 'devices', text: `${dev.name}: fixtures → ${t.value}` });
        }
      }
    }
    if (!done) unapplied.push(t);
  }
  return { sheet: out, changesMade, unapplied };
}

function compactEq(a, b) {
  return String(a || '').replace(/[\s_-]+/g, '').toLowerCase()
    === String(b || '').replace(/[\s_-]+/g, '').toLowerCase();
}

module.exports = {
  classifyEdit, classifyEditWithModel, applyValueTargetsToSheet,
  // exported for unit tests
  collectNamedValues, matchValueEdit, splitClauses, looseNameMatch,
  attributeMachine, normalizeValue,
};
