/**
 * stationModel.js — PROJECT → STATION → STATE MACHINES (Dan's ruling,
 * 2026-08-25: "This is ONE station. One station can have multiple state
 * machines — NOT station one and station two.").
 *
 * The store still keeps a flat `project.stateMachines[]`; this module gives
 * each record STATION IDENTITY and derives the station grouping from it:
 *
 *   sm.stationId      stable station key — every SM of one station shares it
 *   sm.stationNumber  the STATION's number (S01…) — shared by its SMs
 *   sm.stationName    the real station name, e.g. "Magnet Dial"
 *   sm.smName         this state machine's name, e.g. "Magnet Pick Head"
 *
 * Every field is optional: a record with no stationId is its OWN station
 * (legacy projects render exactly as before — one station, one SM).
 *
 * Pure logic, no React, no store.
 */

const str = (v) => String(v ?? '').trim();

/** The station this SM belongs to. Legacy records = their own station. */
export function stationKeyOf(sm) {
  return str(sm?.stationId) || `sm:${sm?.id ?? ''}`;
}

/** The STATION's number (S01…). Falls back to the SM's own number. */
export function stationNumberOf(sm) {
  const n = Number(sm?.stationNumber);
  return Number.isFinite(n) ? n : 0;
}

/** The STATION's display name — "Magnet Dial", not "Magnet Pick Head". */
export function stationNameOf(sm) {
  return str(sm?.stationName) || str(sm?.displayName) || str(sm?.name) || 'Untitled';
}

/** THIS state machine's name inside its station. */
export function smLabelOf(sm) {
  return str(sm?.smName) || str(sm?.displayName) || str(sm?.name) || '(unnamed)';
}

/**
 * The project's STATIONS, each with its state machines.
 * @returns [{ key, stationNumber, stationName, sms: [sm] }] sorted by number.
 */
export function stationsOf(project) {
  const sms = project?.stateMachines ?? [];
  const byKey = new Map();
  for (const sm of sms) {
    const key = stationKeyOf(sm);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        stationNumber: stationNumberOf(sm),
        stationName: stationNameOf(sm),
        sms: [],
      });
    }
    byKey.get(key).sms.push(sm);
  }
  return [...byKey.values()].sort(
    (a, b) => (a.stationNumber || 999) - (b.stationNumber || 999)
  );
}

/** The station record containing `smId`, or null. */
export function stationOfSm(project, smId) {
  if (!smId) return null;
  return stationsOf(project).find((st) => st.sms.some((s) => s.id === smId)) ?? null;
}

/** Every SM of this SM's station, INCLUDING itself (input order). */
export function stationSmsOf(project, sm) {
  if (!sm) return [];
  const key = stationKeyOf(sm);
  return (project?.stateMachines ?? []).filter((s) => stationKeyOf(s) === key);
}

/** The station's PRIMARY state machine — the one that owns the spec sheet
 *  (ONE sheet per station; inside it everything breaks out per SM). */
export function primarySmOf(station) {
  return station?.sms?.[0] ?? null;
}

/** True when this SM's station holds more than one state machine. */
export function isMultiSmStation(project, sm) {
  return stationSmsOf(project, sm).length > 1;
}
