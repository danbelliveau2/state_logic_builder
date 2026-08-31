/**
 * stationNeeds.js — QUESTION HOME (meKnowledge, Dan 2026-08-22): ALL questions
 * to humans surface on the SPEC SHEET. This module is the one place that
 * knows what a station is currently blocked on.
 *
 * Dan's rulings (Aug 23 live review) on what counts as "blocked":
 *   - *Verify flags that reference a servo axis position are VALUES, not
 *     questions — they become red proposed rows in the Servo values table
 *     (servoBands.js) with an intelligent pre-filled proposal. Accepting is
 *     doing nothing, so a mapped flag does NOT count toward the red pill.
 *   - *Replace flags are SDC Engineer's own stub decisions on a standalone build —
 *     never blocking, never red; one quiet line in the sheet's interactions
 *     section.
 *   - The red pill counts ONLY genuinely-stuck asks: held-build questions +
 *     *Verify flags that could NOT be mapped to a servo value row.
 */

import { useEffect, useState } from 'react';
import { mapVerifyFlagsToServoRows, requiredServoRowsOf } from '../lib/servoBands.js';
import { geometryIssuesOf } from '../lib/geometrySanity.js';

/** Parse one *-flag into { label, unit, defaultVal, full }.
 *  NEVER truncates (Dan's no-truncate law): the label is the full flag text
 *  minus the "*Verify (x):" prefix — it wraps in the UI, never ellipsizes. */
export function parseBlankFlag(text) {
  const full = String(text).trim();
  let rest = full
    .replace(/^\*\s*\w+\s*(\([^)]*\))?\s*[:—–-]?\s*/i, '') // "*Verify (x):" / "*Replace —"
    .replace(/^[—–-]\s*/, '');
  let label = rest.trim();
  if (label) label = label[0].toUpperCase() + label.slice(1);
  const def = /defaulted to\s+(\d+(?:\.\d+)?)\s*(mm|ms|s|deg|°|%)?/i.exec(full);
  const unitMatch = def?.[2] ?? (/(\d+(?:\.\d+)?)\s*(mm|ms|deg|°)\b/.exec(full)?.[2] ?? '');
  return {
    full,
    label: label || full,
    unit: unitMatch || '',
    defaultVal: def ? def[1] : null,
  };
}

/** The station's *Replace stub notes (SDC Engineer's own decisions — never asks). */
export function replaceFlagsOf(sm) {
  return (sm?.compiledSequence?.ir?.reviewFlags ?? [])
    .map(String)
    .filter((f) => /^\s*\*\s*replace/i.test(f));
}

// ── THE THREE BLOCKER SHAPES (Dan, 2026-08-25 — enforced structurally) ──────
// The blocking strip may only render: (1) a VALUE ask naming a specific field,
// (2) a QUESTION (askable, proposal prefilled), (3) everything else is a NOTE —
// quiet, ✓-agree, never counted, never blocking. Classified at RENDER TIME:
// the UI never trusts the pipeline's categorization blindly (defense in depth
// alongside the compile-side notes-vs-asks separation).

const VALUE_ASK_RE = /\b(delay|timer|time(?:out)?|ms|milliseconds?|seconds?|speed|distance|height|clearance|stroke|threshold|deadband|band|increment|fixtures?|count)\b/i;

/** 'value' | 'question' | 'note' for one parsed *-flag. STATEMENTS win first:
 *  a decide-and-record line ("assumed SDC default (… 1000ms …)") mentions
 *  units without asking anything — it is a NOTE no matter what numbers it
 *  quotes (Dan's screenshot, 2026-08-25). */
export function blockerShapeOf(parsed) {
  const stated = /synthesized|assumed|decided|recorded|defaulted/i.test(parsed.full);
  const asks = isRealQuestion(parsed.full) || isRealQuestion(parsed.label);
  if (stated && !asks) return 'note';
  if (parsed.unit || parsed.defaultVal != null) return 'value';
  if (VALUE_ASK_RE.test(parsed.full)) return 'value';
  if (asks) return 'question';
  return 'note';
}

/** Flags the ME already ✓-agreed to (persisted on machineSpec.acknowledgedFlags). */
export function acknowledgedFlagsOf(sm) {
  return new Set((sm?.machineSpec?.acknowledgedFlags ?? []).map((s) => String(s).trim()));
}

/** GENUINE open value asks: *Verify flags that could NOT be mapped onto a
 *  servo value row (mapped ones live as proposed values in the servo table).
 *  Decide-and-record STATEMENTS are excluded — they are notes (noteFlagsOf),
 *  never blockers with a naked value box. */
export function valueFlagsOf(sm) {
  const acked = acknowledgedFlagsOf(sm);
  return mapVerifyFlagsToServoRows(sm)
    .filter((r) => r.unmapped)
    .map((r) => parseBlankFlag(r.flag))
    .filter((p) => !acked.has(p.full))
    .filter((p) => blockerShapeOf(p) !== 'note');
}

/** Unmapped flags that are STATEMENTS — quiet notes with a ✓-agree, never
 *  counted in the red pill, never rendered with an input box. */
export function noteFlagsOf(sm) {
  const acked = acknowledgedFlagsOf(sm);
  return mapVerifyFlagsToServoRows(sm)
    .filter((r) => r.unmapped)
    .map((r) => parseBlankFlag(r.flag))
    .filter((p) => !acked.has(p.full))
    .filter((p) => blockerShapeOf(p) === 'note');
}

/** Held-for-help builds for one station (by SM name). */
export function heldBuildsOf(builds, smName) {
  return (builds ?? []).filter(
    (b) => b && b.sm === smName && b.help && b.help.status === 'waiting' &&
      (b.help.questions ?? []).length > 0
  );
}

/**
 * Poll /api/jarvis/generations for this station's held builds.
 * Light poll (20s) — the banner and spec sheet both ride on it.
 */
export function useHeldBuilds(smName, extraDep = 0) {
  const [held, setHeld] = useState([]);
  useEffect(() => {
    if (!smName) { setHeld([]); return undefined; }
    let alive = true;
    const load = () =>
      fetch('/api/jarvis/generations')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d) setHeld(heldBuildsOf(d.builds, smName)); })
        .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [smName, extraDep]);
  return held;
}

/** Required positions the compiled code MOVES TO that are absent from the
 *  axis table — genuine blockers (no proposal derivable; the value lives in
 *  the mechanical model). Band anchors with proposals are NOT here — they
 *  render as red proposed rows in the servo table instead. */
export function requiredPositionAsksOf(sm) {
  return requiredServoRowsOf(sm).filter((r) => r.kind === 'position');
}

/** Is a held item actually a QUESTION? (Dan, Aug 24: "statements are not
 *  questions" — a statement the pipeline emitted as a hold renders as a note,
 *  never as a blocking ask.) */
export function isRealQuestion(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (s.includes('?')) return true;
  return /^(what|which|where|when|who|how|why|should|shall|can|could|do|does|did|is|are|will|would|may|might)\b/i.test(s);
}

/** GEOMETRIC SANITY blockers (Dan, Aug 24: "PlaceTransition 450 vs Place 300
 *  — geometric nonsense"): arithmetic-impossible axis values. Each carries the
 *  plain sentence; they count toward the red pill and clear the moment the
 *  value is fixed in the servo table. */
export function geometryBlockersOf(sm) {
  return geometryIssuesOf(sm);
}

/** Total open asks for one station: value flags + held-build QUESTIONS (held
 *  statements render as notes, not asks) + compiled moves targeting positions
 *  the table doesn't have + geometric-sanity errors. */
export function needsCount(sm, heldBuilds) {
  const flags = valueFlagsOf(sm).length;
  const helpQs = (heldBuilds ?? []).reduce(
    (n, b) => n + (b.help?.questions ?? []).filter((q) => isRealQuestion(q?.question ?? q?.text)).length, 0);
  return flags + helpQs + requiredPositionAsksOf(sm).length + geometryBlockersOf(sm).length;
}
