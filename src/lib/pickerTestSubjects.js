/**
 * pickerTestSubjects.js — Test subjects for the Picker Preview playground.
 *
 * Real state machines have CONCRETE subjects (VerticalCylinder, PartInNest,
 * AllStationsReady, PNPXAxis, …). Each subject is an instance of a grammar
 * row "type" — VerticalCylinder is a `cylinder`, PNPXAxis is a `servo`, etc.
 *
 * The Picker Preview tab uses these to drive the picker, simulating what
 * a real project would feed to it. Persisted to localStorage so the user's
 * test fixture sticks around between visits.
 *
 * ─── SCHEMA ──────────────────────────────────────────────────────────────
 *
 *   {
 *     id:           string,    // 'sub_xxx' — stable
 *     name:         string,    // human-readable: 'VerticalCylinder', 'PNPXAxis'
 *     grammarRowId: string,    // FK to pickerGrammar row: 'cylinder', 'servo', …
 *     detailValues: {          // optional named values per DETAIL category
 *       [categoryName]: string[]
 *     }
 *   }
 *
 * Example for a Servo:
 *   {
 *     id: 'sub_pnpX',
 *     name: 'PNPXAxis',
 *     grammarRowId: 'servo',
 *     detailValues: { 'Position name': ['Pickup', 'Place', 'Home'] }
 *   }
 *
 * The picker uses `detailValues` to render DETAIL as chips when populated;
 * empty = falls back to free-text input.
 */

// Bumped to v2: previously seeded with 19 default subjects which were
// confusing on first load. v2 starts empty.
const STORAGE_KEY = 'sdc.pickerPreview.subjects.v2';

// Start empty — user adds their own. This is a test fixture, not a seed.
export const DEFAULT_TEST_SUBJECTS = [];

function clone(subjects) {
  return subjects.map(s => ({
    ...s,
    detailValues: Object.fromEntries(
      Object.entries(s.detailValues || {}).map(([k, v]) => [k, [...v]])
    ),
  }));
}

export function loadTestSubjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_TEST_SUBJECTS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return clone(DEFAULT_TEST_SUBJECTS);
    // Light validation — drop rows missing the basics.
    return parsed.filter(s => s && s.id && s.name && s.grammarRowId).map(s => ({
      id: String(s.id),
      name: String(s.name),
      grammarRowId: String(s.grammarRowId),
      detailValues: s.detailValues && typeof s.detailValues === 'object' ? s.detailValues : {},
    }));
  } catch {
    return clone(DEFAULT_TEST_SUBJECTS);
  }
}

export function saveTestSubjects(subjects) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects));
  } catch (e) {
    // localStorage full or disabled — silently swallow
  }
}

export function resetTestSubjects() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function newSubjectId() {
  return 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
