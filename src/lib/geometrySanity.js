/**
 * geometrySanity.js — arithmetic sanity checks on servo axis geometry.
 * Pure logic, no React, no store.
 *
 * Why this exists (Dan, 2026-08-24): a compile invented "PlaceTransition 450"
 * on an axis whose Place is 300 — geometric nonsense that no arithmetic check
 * caught. These checks are MECHANICAL (free, no model call) and run everywhere
 * axis values live: the servo values table, the station sheet's servo cards,
 * the motion-path diagram, and (via validateCompiledIR — see the pipeline
 * TODO) compile validation.
 *
 * The rules, in plain engineer's terms:
 *   1. A transition point sits strictly BETWEEN the approach and the target
 *      ("fast to the transition, slow into the target") — a PlaceTransition
 *      beyond Place is not a tuning issue, it is geometrically impossible.
 *   2. Corner blends (Dan's rule, Aug 24 — the ONLY windows in the system):
 *      the arc extends blend-distance from the retract-level corner along
 *      each leg. Z-leg: blend ≤ (that side's speed transition − Retract) —
 *      the rounding may not extend past the speed-change point; EQUAL is
 *      allowed ("ideally the fastest motion is close to zero gap, clearance
 *      permitting"). X-leg: blend ≤ the X travel between Pick and Place.
 *      Bigger blends are GOOD (faster) — nothing else constrains them, and
 *      large-but-legal values get no warnings.
 *   3. No point may sit outside the axis's declared travel envelope
 *      (min/max), when the axis declares one.
 *
 * Every issue is a PLAIN SENTENCE a mechanical engineer reads and immediately
 * sees the mistake — never a code, never jargon.
 */

const CORNER_BLEND_RE = /^(Pick|Place)(.+)Blend$/i;
const TRANSITION_RE = /^(.+)Transition$/i;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Is this row a DISTANCE (blend zone / wideband window) rather than a
 *  position on the travel? Distances are checked by rule 2, never rule 1/3. */
export function isDistanceRow(name) {
  const n = String(name ?? '');
  return CORNER_BLEND_RE.test(n) || /WideBand$/i.test(n);
}

/**
 * Run the sanity checks on ONE axis.
 * @param {string} axisName display name for the sentences
 * @param {Array<{name:string, value:number|null}>} rows the axis's named rows
 *        (positions AND distance rows), values in mm; null values are skipped
 * @param {{minMm?:number|null, maxMm?:number|null}} [envelope]
 * @param {{xTravelMm?:number|null}} [opts] cross-axis facts: the horizontal
 *        Pick↔Place travel, for the corner blends' X-leg limit (aggregate
 *        callers pass it; single-axis contexts may omit — Z-leg still checks)
 * @returns {Array<{axisName, rowName, message}>}
 */
export function axisGeometryIssues(axisName, rows, envelope = {}, opts = {}) {
  const issues = [];
  const named = (rows ?? [])
    .map((r) => ({ name: String(r?.name ?? ''), value: num(r?.value) }))
    .filter((r) => r.name && r.value !== null);
  const positions = named.filter((r) => !isDistanceRow(r.name));
  const distances = named.filter((r) => isDistanceRow(r.name));
  const byKey = new Map(positions.map((r) => [normKey(r.name), r]));
  const flag = (rowName, message) => issues.push({ axisName, rowName, message });

  // ── 1. Transitions sit strictly between approach and target ──────────────
  for (const t of positions) {
    const m = t.name.match(TRANSITION_RE);
    if (!m) continue;
    const targetName = m[1]; // PickTransition → Pick
    const target = byKey.get(normKey(targetName));
    const approach = byKey.get(normKey('Retract'));
    if (target && approach) {
      const lo = Math.min(target.value, approach.value);
      const hi = Math.max(target.value, approach.value);
      if (!(t.value > lo && t.value < hi)) {
        const beyond = Math.abs(t.value - target.value) >= Math.abs(t.value - approach.value)
          ? approach : target;
        flag(t.name,
          `${t.name} ${t.value} is beyond ${beyond.name} ${beyond.value} — ` +
          `a transition must sit between the approach (${approach.name} ${approach.value}) ` +
          `and the target (${target.name} ${target.value}).`);
      }
    } else if (target && positions.length > 2) {
      // No Retract on this axis: the transition must at least lie inside the
      // travel spanned by the axis's named positions.
      const vals = positions.filter((p) => p !== t).map((p) => p.value);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      if (t.value < lo || t.value > hi) {
        flag(t.name,
          `${t.name} ${t.value} is outside the travel between this axis's named positions ` +
          `(${lo} to ${hi}) — a transition sits on the way to ${target.name} ${target.value}, never past the ends.`);
      }
    }
  }

  // ── 2. Corner blends (Dan's rule, Aug 24 — bigger is faster, so only the
  //       real physical limits apply; equality is always allowed) ────────────
  const retract = byKey.get(normKey('Retract'));
  const xTravel = num(opts?.xTravelMm);
  for (const d of distances) {
    const m = d.name.match(CORNER_BLEND_RE);
    if (!m) continue; // *WideBand rows are dead (speed windows don't exist) — never checked
    if (d.value <= 0) {
      flag(d.name, `${d.name} ${d.value} mm — a blend distance must be a positive number of millimeters.`);
      continue;
    }
    // Z-leg: the rounding may not extend past that side's speed-change point
    // (fallback: past the working point itself when no transition exists).
    if (retract) {
      const side = m[1]; // Pick | Place
      const limitRow = byKey.get(normKey(`${side}Transition`)) ?? byKey.get(normKey(side));
      if (limitRow) {
        const legLimit = Math.abs(limitRow.value - retract.value);
        if (d.value > legLimit) {
          flag(d.name,
            `${d.name} ${d.value} mm reaches past ${limitRow.name} — only ${legLimit} mm of travel ` +
            `lies between Retract ${retract.value} and ${limitRow.name} ${limitRow.value}, and the ` +
            `rounding may not extend beyond the speed-change point.`);
        }
      }
    }
    // X-leg: the rounding can't extend past the far point of the traverse.
    if (xTravel !== null && xTravel > 0 && d.value > xTravel) {
      flag(d.name,
        `${d.name} ${d.value} mm is longer than the whole Pick↔Place traverse (${xTravel} mm) — ` +
        `the rounding can't extend past the far point.`);
    }
  }

  // ── 3. Travel envelope ────────────────────────────────────────────────────
  const lo = num(envelope?.minMm);
  const hi = num(envelope?.maxMm);
  if (lo !== null || hi !== null) {
    for (const p of positions) {
      if (lo !== null && p.value < lo) {
        flag(p.name, `${p.name} ${p.value} is below this axis's minimum travel (${lo}) — the axis cannot physically reach it.`);
      }
      if (hi !== null && p.value > hi) {
        flag(p.name, `${p.name} ${p.value} is beyond this axis's maximum travel (${hi}) — the axis cannot physically reach it.`);
      }
    }
  }

  return issues;
}

/** The horizontal Pick↔Place travel (mm) from a set of axis row-lists, for
 *  the blends' X-leg limit. Rows: [{name, value}]. Null when unknown. */
export function xTravelOfAxes(axisRowLists) {
  for (const rows of axisRowLists ?? []) {
    const byKey = new Map((rows ?? []).filter((r) => r?.name && num(r.value) !== null)
      .map((r) => [normKey(r.name), num(r.value)]));
    if (byKey.has('retract')) continue; // vertical axis — not the traverse
    const pick = byKey.get('pick');
    const place = byKey.get('place');
    if (pick !== undefined && place !== undefined) {
      const t = Math.abs(place - pick);
      if (t > 0) return t;
    }
  }
  return null;
}

/** Sanity-check a BUILT SM's servo axes (device.positions[].defaultValue). */
export function geometryIssuesOf(sm) {
  const issues = [];
  const axes = (sm?.devices ?? []).filter((x) => x.type === 'ServoAxis');
  const rowsOf = (d) => (d.positions ?? []).map((p) => ({ name: p?.name, value: p?.defaultValue }));
  const xTravelMm = xTravelOfAxes(axes.map(rowsOf));
  for (const d of axes) {
    issues.push(...axisGeometryIssues(d.displayName || d.name, rowsOf(d),
      { minMm: d.travelMinMm, maxMm: d.travelMaxMm }, { xTravelMm }));
  }
  return issues;
}

/** Sanity-check a station SHEET's servo device rows (positions[].valueMm). */
export function sheetGeometryIssues(devices) {
  const issues = [];
  const axes = (devices ?? []).filter((d) => /servo/i.test(String(d?.type ?? '')) && Array.isArray(d?.positions));
  const rowsOf = (d) => d.positions.map((p) => ({ name: p?.name, value: p?.valueMm ?? p?.value }));
  const xTravelMm = xTravelOfAxes(axes.map(rowsOf));
  for (const d of axes) {
    issues.push(...axisGeometryIssues(d.name || 'axis', rowsOf(d), {}, { xTravelMm }));
  }
  return issues;
}
