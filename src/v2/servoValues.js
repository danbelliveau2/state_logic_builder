/**
 * servoValues.js — servo position-table readiness + role inference (pure).
 *
 * Dan (Aug 2026): servo position tables are a MECHANICAL prerequisite — "the
 * table of values has to be filled out by the mechanical team before it gets
 * to this point; the tool should know that." These helpers power:
 *   - the pre-compile readiness state in the Code grid's status column
 *     ("⚠ Servo positions needed — VerticalAxis (2 of 5 values)")
 *   - the soft gate on Compile (confirm listing missing values — compile
 *     stays clickable because sometimes values genuinely defer to commissioning)
 *   - the station-level Servo values table (ServoValuesTable.jsx)
 *
 * Missing = a position whose value (defaultValue) is null/undefined/'' — or a
 * ServoAxis device with an EMPTY positions list. A value of 0 is legitimate
 * (retract/home are often 0) and is NEVER flagged.
 */

/** Is a single position entry missing its value? (0 is a real value.) */
export function positionValueMissing(pos) {
  const v = pos?.defaultValue;
  return v === null || v === undefined || v === '';
}

/** Per-device gaps for one SM.
 *  → [{ deviceId, deviceName, missing: [posName…], total }] — only devices
 *  that actually have gaps. Empty array = servo-ready (or no servos). */
export function servoGaps(sm) {
  const out = [];
  for (const d of sm?.devices ?? []) {
    if (d.type !== 'ServoAxis') continue;
    const positions = d.positions ?? [];
    if (positions.length === 0) {
      out.push({ deviceId: d.id, deviceName: d.displayName || d.name, missing: ['(no positions defined)'], total: 0 });
      continue;
    }
    const missing = positions.filter(positionValueMissing).map(p => p.name || '(unnamed)');
    if (missing.length) {
      out.push({ deviceId: d.id, deviceName: d.displayName || d.name, missing, total: positions.length });
    }
  }
  return out;
}

/** One-line summary for status chips / hints.
 *  "Servo positions needed — VerticalAxis (2 of 5 values)" or
 *  "Servo positions needed — VerticalAxis, HorizontalAxis" for multi. */
export function servoGapSummary(gaps) {
  if (!gaps || gaps.length === 0) return null;
  if (gaps.length === 1) {
    const g = gaps[0];
    return `Servo positions needed — ${g.deviceName} (${g.missing.length} of ${g.total || g.missing.length} value${g.missing.length === 1 ? '' : 's'})`;
  }
  return `Servo positions needed — ${gaps.map(g => g.deviceName).join(', ')}`;
}

/** Multi-line detail for the soft-gate confirm dialog. */
export function servoGapDetail(gaps) {
  return (gaps || [])
    .map(g => `${g.deviceName}: ${g.missing.join(', ')}`)
    .join('\n');
}

/** Auto role tag from a position's name (home/pick/place/transition/safe-clear
 *  where inferable — otherwise null, no tag shown). isHome wins. */
export function inferPositionRole(pos) {
  if (pos?.isHome) return 'home';
  const n = String(pos?.name || '').toLowerCase();
  if (/home/.test(n)) return 'home';
  if (/pick/.test(n) && /trans/.test(n)) return 'transition';
  if (/place/.test(n) && /trans/.test(n)) return 'transition';
  if (/trans|between|blend/.test(n)) return 'transition';
  if (/pick/.test(n)) return 'pick';
  if (/place|put|drop/.test(n)) return 'place';
  if (/clear|safe|retract/.test(n)) return 'safe-clear';
  return null;
}

/** Does the SM have any ServoAxis devices at all? (gates entry points) */
export function hasServoAxes(sm) {
  return (sm?.devices ?? []).some(d => d.type === 'ServoAxis');
}
