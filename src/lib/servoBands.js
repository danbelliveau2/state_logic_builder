/**
 * servoBands.js — wide-band (InPosWide / AOI_RangeCheck) value proposals from
 * axis geometry. Pure logic, no React, no store.
 *
 * Dan's ruling (Aug 2026, live review of the v2.4.1 spec questions): compiled
 * `*Verify` band placeholders are SERVO VALUES, not questions. They surface as
 * red proposed rows inside the correct axis's card in the Servo values table,
 * pre-filled with an intelligent proposal derived from the axis geometry —
 * accepting = doing nothing, editing = typing. This file holds the heuristic
 * and the reviewFlag → row mapper so the pipeline can reuse both later.
 *
 * Heuristic (Dan's): start from a ~10 mm default band, but clamp against the
 * gaps between the axis's named positions so a band can never overlap an
 * adjacent position (e.g. pick 60 / transition 50 → the transition band must
 * stay under 10 mm → propose 5). Round to clean numbers (10s, else 5s).
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Propose a wide-band value (mm) for one named position on an axis.
 * @param {Array<{name, defaultValue}>} positions the axis's position table
 * @param {string} posName the position the band belongs to
 * @returns {{ value:number, minGap:number|null, rationale:string }}
 */
export function proposeWideBand(positions, posName) {
  const all = (positions ?? []).filter((p) => num(p?.defaultValue) !== null);
  const target = all.find(
    (p) => String(p?.name ?? '').toLowerCase() === String(posName ?? '').toLowerCase()
  );
  const tv = target ? num(target.defaultValue) : null;

  let minGap = null;
  if (tv !== null) {
    for (const p of all) {
      if (p === target) continue;
      const g = Math.abs(num(p.defaultValue) - tv);
      if (g > 0 && (minGap === null || g < minGap)) minGap = g;
    }
  }

  let value = 10; // Dan's default band
  if (minGap !== null && value >= minGap) {
    value = Math.floor(minGap / 2);
    if (value >= 10) value = Math.floor(value / 10) * 10;
    else if (value >= 5) value = Math.floor(value / 5) * 5;
    if (value < 1) value = 1;
  }

  const rationale =
    minGap !== null
      ? `Jarvis picked ${value} mm from your positions (nearest named position ${minGap} mm away) — change it if the model says otherwise.`
      : `Jarvis picked ${value} mm (standard band — no neighboring positions to clamp against) — change it if the model says otherwise.`;

  return { value, minGap, rationale };
}

// ── Corner-based blend zones (Dan's sketch, 2026-08-24) ─────────────────────
// MEs name blend zones by CORNER: position + level + "blend start/end". The
// pick-place path is an inverted U — Pick → up to Retract level → traverse →
// down to Place — with TWO independent corners: above PICK (exit — the
// traverse starts inside this zone as Z rises) and above PLACE (approach —
// Z starts down inside this zone as the traverse finishes). They REPLACE the
// single {Level}WideBand for retract-level corners; the two corners may
// differ geometrically, so each is its own value.
// The {Pos}TransitionWideBand rows are a DIFFERENT thing — fast→slow
// SPEED-CHANGE windows, never called "blend" (blend start ≠ transition point).

const CORNER_BLEND_RE = /^(Pick|Place)(.+)Blend$/i;

/** Corner-aware ME meaning for a blend row's rationale/tooltip. */
function cornerMeaning(axisName, corner, level, value) {
  return `${corner} ${String(level).toLowerCase()} blend start/end — the motion starts rounding ${value} mm before the corner above ${corner}; the next move begins inside this zone.`;
}

/** ME-plain description of what a generic blend/wideband row MEANS. */
export function bandMeaning(axisName, posName, value) {
  return /transition/i.test(String(posName))
    ? `${posName} speed-change window — within ${value} mm of ${posName} counts as "there" for the fast/slow switch.`
    : `${posName} blend window — the next move may start once ${axisName} is within ${value} mm of ${posName}.`;
}

/** Plain-English DISPLAY label for a servo row NAME (Dan, Aug 24 round 2:
 *  the card rows read as the NAME plus "Start/End" for corner blends — short,
 *  single-line, never wrapping). The built SM keeps the PLC-safe name.
 *    PickRetractBlend        → "PickRetractBlend Start/End"
 *    PlaceRetractBlend       → "PlaceRetractBlend Start/End"
 *    PickTransitionWideBand  → "PickTransition speed window"   (advanced only)
 *    RetractWideBand (legacy)→ "Retract blend window"          (advanced only)
 *    anything else           → unchanged */
export function plainServoRowLabel(name) {
  const n = String(name ?? '');
  if (CORNER_BLEND_RE.test(n)) return `${n} Start/End`;
  // Z's fast→slow points read as what they ARE (Dan, Aug 24 round 3):
  // "Pick speed transition" / "Place speed transition". The PLC-safe internal
  // name stays PickTransition/PlaceTransition.
  const t = n.match(/^(Pick|Place)Transition$/i);
  if (t) return `${t[1]} speed transition`;
  const w = n.match(/^(.+)WideBand$/i);
  if (w) return /transition/i.test(w[1]) ? `${w[1]} speed window` : `${w[1]} blend window`;
  return n;
}

/** Speed-change windows and legacy level widebands are INTERNAL values, not
 *  peer rows (Dan, Aug 24 round 2): the card shows named positions and corner
 *  blends only; every *WideBand row lives under the tiny "advanced" expander
 *  so its value survives without cluttering the sheet. */
export function isSpeedWindowName(name) {
  return /WideBand$/i.test(String(name ?? ''));
}

/** Card display ORDER (Dan, Aug 24 round 2 — Vertical reads Retract,
 *  PickTransition, Pick, PickRetractBlend Start/End, PlaceTransition, Place,
 *  PlaceRetractBlend Start/End): keep the axis's own order but slot each
 *  corner blend row immediately AFTER its corner position (exact "Pick" /
 *  "Place" row; falls back to the last row starting with that corner). */
export function orderServoDisplayRows(rows, getName = (r) => r?.name) {
  const out = [];
  const blends = [];
  for (const r of rows ?? []) {
    const m = String(getName(r) ?? '').match(CORNER_BLEND_RE);
    if (m) blends.push({ r, corner: m[1].toLowerCase() });
    else out.push(r);
  }
  for (const { r, corner } of blends) {
    let at = -1;
    for (let i = 0; i < out.length; i++) {
      const n = String(getName(out[i]) ?? '').toLowerCase();
      if (n === corner) { at = i; break; }
    }
    if (at === -1) {
      for (let i = 0; i < out.length; i++) {
        if (String(getName(out[i]) ?? '').toLowerCase().startsWith(corner)) at = i;
      }
    }
    if (at === -1) out.push(r); else out.splice(at + 1, 0, r);
  }
  return out;
}

/** Display label for a derived row object (kept for the table call sites). */
export function bandRowLabel(row) {
  return plainServoRowLabel(row?.rowName);
}

/** GROUPED display (Dan, Aug 24 round 5): the axis card reads in three
 *  groups — POSITIONS, then SPEED TRANSITIONS, then BLENDS — each in the
 *  axis's own order. Returns [{key, label, rows}] with empty groups dropped;
 *  a plain axis (X: just Pick/Place) yields ONE unlabeled positions group so
 *  no headers clutter a card that has nothing to separate. */
export function groupServoRows(rows, getName = (r) => r?.name) {
  const pos = [];
  const trans = [];
  const blends = [];
  for (const r of rows ?? []) {
    const n = String(getName(r) ?? '');
    if (CORNER_BLEND_RE.test(n)) blends.push(r);
    else if (/^(Pick|Place)Transition$/i.test(n)) trans.push(r);
    else pos.push(r);
  }
  const labeled = trans.length > 0 || blends.length > 0;
  const out = [];
  if (pos.length) out.push({ key: 'positions', label: labeled ? 'Positions' : null, rows: pos });
  if (trans.length) out.push({ key: 'transitions', label: 'Speed transitions', rows: trans });
  if (blends.length) out.push({ key: 'blends', label: 'Blends', rows: blends });
  return out;
}

/** Quiet explainer lines, each rendered ONCE under a group of rows — only the
 *  kinds actually present. Accepts derived rows and/or position names. */
export const BAND_EXPLAINER = 'Blend start/end — how far from the corner the motion starts rounding; the next move begins inside this zone.';
export const SPEED_WINDOW_EXPLAINER = 'Speed-change window — how close to the transition point counts as "there" when switching between fast and slow.';
export function bandExplainersFor(names) {
  const list = (names ?? []).map(n => String(n ?? ''));
  const out = [];
  if (list.some(n => CORNER_BLEND_RE.test(n) || (/WideBand$/i.test(n) && !/transition/i.test(n)))) out.push(BAND_EXPLAINER);
  if (list.some(n => /WideBand$/i.test(n) && /transition/i.test(n))) out.push(SPEED_WINDOW_EXPLAINER);
  return out;
}

/**
 * EVERY servo point the compiled code uses must be a VISIBLE named row in its
 * axis table (Dan, Aug 23 — no invisible positions). Derive the full required
 * set from the compiled sequence:
 *   - every position a ServoMove targets,
 *   - a `{Position}WideBand` blend anchor for every wideband-advance move
 *     (the SDC InPosWide pattern — the next axis starts inside this band).
 * Returns rows for points MISSING from the axis's table:
 *   band rows  → { kind:'band', deviceId, deviceName, posName, rowName,
 *                  proposedValue, rationale }              (red, proposal prefilled)
 *   position rows → { kind:'position', deviceId, deviceName, rowName,
 *                  question }                              (genuine blocker — the
 *                  code moves to a position the table doesn't know)
 */
export function requiredServoRowsOf(sm) {
  const states = sm?.compiledSequence?.ir?.states;
  if (!Array.isArray(states)) return [];
  const axes = (sm?.devices ?? []).filter((d) => d.type === 'ServoAxis');
  if (!axes.length) return [];

  const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const axisByName = new Map();
  for (const d of axes) {
    axisByName.set(normKey(d.name), d);
    if (d.displayName) axisByName.set(normKey(d.displayName), d);
  }

  const rows = [];
  const seen = new Set();
  // Corner identity for retract-level widebands: the PREVIOUS target this
  // axis moved to says which side of the inverted-U we are on (rising out of
  // Pick/PickTransition → the corner above PICK; out of Place → above PLACE).
  const lastTargetByAxis = new Map();
  for (const st of states) {
    for (const a of st.actions ?? []) {
      if (a.operation !== 'ServoMove') continue;
      const dev = axisByName.get(normKey(a.deviceName || a.device));
      const posName = a.params?.positionName;
      if (!dev || !posName) continue;
      const prevTarget = lastTargetByAxis.get(dev.id);
      lastTargetByAxis.set(dev.id, String(posName));
      const positions = dev.positions ?? [];
      const findRow = (name) =>
        positions.find((p) => normKey(p.name) === normKey(name));

      // 1. The move's target position must exist as a table row.
      if (!findRow(posName)) {
        const key = `${dev.id}:pos:${normKey(posName)}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            kind: 'position',
            deviceId: dev.id,
            deviceName: dev.displayName || dev.name,
            rowName: String(posName),
            question: `The compiled sequence moves ${dev.displayName || dev.name} to "${posName}", but the axis table has no such position — what is its value (${dev.motionType === 'rotary' ? '°' : 'mm'}, from the model)?`,
          });
        }
      }

      // 2. Wideband-advance moves need their blend anchor visible.
      if (a.params?.advance === 'wideband') {
        const filled = (p) => p && !(p.defaultValue === null || p.defaultValue === undefined || p.defaultValue === '');
        // CORNER-BASED naming (Dan's sketch, Aug 24): a wideband on the shared
        // level (Retract etc. — the target name carries no pick/place) is one
        // of the U-path's two corners; it gets its OWN independent row,
        // Pick{Level}Blend / Place{Level}Blend.
        const corner = !/pick|place/i.test(String(posName)) && prevTarget
          ? (/pick/i.test(prevTarget) ? 'Pick' : /place/i.test(prevTarget) ? 'Place' : null)
          : null;
        // SPEED WINDOWS ARE DEAD (Dan, Aug 24 round 3: "the blend start/end
        // IS the window"): transitions take STRICT arrival (MAM.PC + InPos);
        // the ONLY windows in the system are the two corner blends. A
        // wideband advance that isn't a corner creates no row — the compile
        // shouldn't emit one, and we never resurrect {Pos}WideBand rows.
        if (!corner) continue;
        const rowName = `${corner}${posName}Blend`;
        // MIGRATION: an already-agreed legacy {Level}WideBand value satisfies
        // BOTH corner rows — never reopen a settled blocker.
        const hasVal = filled(findRow(rowName))
          || (corner && filled(findRow(`${posName}WideBand`)));
        if (!hasVal) {
          const key = `${dev.id}:band:${normKey(rowName)}`;
          if (!seen.has(key)) {
            seen.add(key);
            const { value, rationale } = proposeWideBand(positions, posName);
            // CORNER BLENDS ARE THE ME'S NUMBERS (Dan, Aug 24: the 2 mm
            // placeholders "were never his") — no auto-proposal, no agree
            // shortcut: the row is empty + red until HE types the value from
            // the application. Speed windows keep their derived proposal.
            rows.push({
              kind: 'band',
              deviceId: dev.id,
              deviceName: dev.displayName || dev.name,
              posName: String(posName),
              ...(corner ? { corner } : {}),
              rowName,
              proposedValue: corner ? null : value,
              rationale: corner
                ? `${corner} ${String(posName).toLowerCase()} blend start/end — how far from the corner the motion starts rounding. You set this from the application; Jarvis never guesses corner clearances.`
                : bandMeaning(dev.displayName || dev.name, posName, value) + ' ' + rationale,
            });
          }
        }
      }
    }
  }
  return rows;
}

/** Is a position entry's value present? (0 is a real value.) */
function hasValue(p) {
  const v = p?.defaultValue;
  return !(v === null || v === undefined || v === '');
}

/**
 * Map a station's compiled `*Verify` reviewFlags onto servo-table rows.
 *
 * A flag maps when it references `{AxisName}{PositionName}` (word-bounded, so
 * "VerticalAxisPickTransition" never also matches "VerticalAxisPick"). One
 * flag can map to several rows (e.g. the pick/place transition-band flag).
 *
 * @returns {Array} rows — each either
 *   { flag, deviceId, deviceName, posName, rowName, proposedValue,
 *     rationale, resolved }   (mapped: a proposed value stands in the table)
 *   or { flag, unmapped: true } (no axis/position reference found — this one
 *     is still a genuine ask and keeps counting toward the red pill).
 */
export function mapVerifyFlagsToServoRows(sm) {
  const flags = (sm?.compiledSequence?.ir?.reviewFlags ?? [])
    .map(String)
    .filter((f) => /^\s*\*\s*verify/i.test(f));
  const axes = (sm?.devices ?? []).filter((d) => d.type === 'ServoAxis');
  const rows = [];
  const seen = new Set();

  for (const flag of flags) {
    let matched = false;
    for (const d of axes) {
      const dName = String(d.name || '');
      if (!dName) continue;
      const positions = d.positions ?? [];
      for (const p of positions) {
        if (!p?.name) continue;
        const re = new RegExp(esc(`${dName}${p.name}`) + '(?![A-Za-z0-9])');
        if (!re.test(flag)) continue;
        matched = true;
        const dedupe = `${d.id}:${p.name}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const findNamed = (name) => positions.find(
          (x) => String(x?.name ?? '').toLowerCase() === String(name).toLowerCase()
        );
        const legacy = findNamed(`${p.name}WideBand`);
        const { value, rationale } = proposeWideBand(positions, p.name);
        // Retract-level flags map to the TWO corner blend rows (Dan's sketch,
        // Aug 24 — pick/place corners are independent). Transition-point
        // flags map to NOTHING: speed windows are dead (Dan, Aug 24 round 3 —
        // transitions take strict MAM.PC + InPos; the corner blends are the
        // only windows). The flag still counts as handled, never unmapped.
        const cornerBased = !/pick|place/i.test(String(p.name));
        const variants = cornerBased
          ? ['Pick', 'Place'].map((corner) => ({ corner, rowName: `${corner}${p.name}Blend` }))
          : [];
        for (const v of variants) {
          const existing = findNamed(v.rowName);
          rows.push({
            flag,
            deviceId: d.id,
            deviceName: d.displayName || d.name,
            posName: p.name,
            ...(v.corner ? { corner: v.corner } : {}),
            rowName: v.rowName,
            // Corner blends: NO auto-proposal — the ME sets them (Dan, Aug 24).
            proposedValue: v.corner ? null : value,
            // Lead with what the row MEANS in ME terms, then how the number
            // was picked (Dan: naming must read clearly to an ME).
            rationale: v.corner
              ? `${v.corner} ${String(p.name).toLowerCase()} blend start/end — how far from the corner the motion starts rounding. You set this from the application; Jarvis never guesses corner clearances.`
              : bandMeaning(d.displayName || d.name, p.name, value) + ' ' + rationale,
            resolved: (existing != null && hasValue(existing))
              || (v.corner != null && legacy != null && hasValue(legacy)),
          });
        }
      }
    }
    if (!matched) rows.push({ flag, unmapped: true });
  }
  return rows;
}
