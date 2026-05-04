/**
 * pickerGrammar.js — Universal-picker grammar table.
 *
 * Single source of truth for what the picker offers across the app. Both
 * the InlinePicker (state-node "+ Add action") and the DecisionEditPopup
 * (decision-node config) read from this file.
 *
 * Edit directly OR from Project Setup → Picker Grammar tab. The editor
 * persists overrides to localStorage; the defaults below are the fallback
 * shipped baseline.
 *
 * ─── PICKER MODEL ─────────────────────────────────────────────────────────
 *
 * The picker has TWO modes the user picks first:
 *
 *   • Action    — the node fires something
 *                 (Extend, Move Absolute, Set, Trigger, …)
 *   • Decision  — the node observes an input and reacts
 *                 (sub-actions: Wait | Check | Branch)
 *
 * Pill structure (universal — same shape both modes):
 *
 *     ACTION  /  SUBJECT  /  DETAIL
 *
 *   - ACTION   The action being taken: a fire-action (Action mode) or a
 *              sub-action (Wait / Check / Branch in Decision mode).
 *   - SUBJECT  The device / signal / target it operates on. The picker
 *              filters the subject list by mode (Action filters to subjects
 *              with a non-empty ACTIONS column; Decision filters to subjects
 *              with a non-empty INPUTS column).
 *   - DETAIL   The parameter the action needs:
 *              · Action mode: position name, job name, sequence #, etc.
 *              · Wait sub-action: which input state to wait for (from INPUTS).
 *              · Check sub-action: which PT field to log the result into.
 *              · Branch sub-action: setpoint name (analog) or empty (binary —
 *                branches auto-spawn from INPUTS).
 *
 * No separate VALUE pill — DETAIL absorbs the parameter.
 *
 * ─── ACTIONS vs INPUTS ────────────────────────────────────────────────────
 *
 *   ACTIONS   fire-actions the subject offers (Extend, Move Absolute, Trigger,
 *             Set, …). Used in Action mode only. EMPTY = subject is read-only
 *             (sensors, signals) — Action mode unavailable.
 *
 *   INPUTS    states the subject can be observed in (Extended, On,
 *             In Tolerance, Pass, …). Used in Decision mode for Wait /
 *             Check / Branch. The picker shows these as an info chip next
 *             to the subject so the engineer always sees what input shape
 *             the subject exposes.
 *
 * Decision sub-actions (Wait / Check / Branch) are universal in the picker
 * — they're always available whenever the subject has a non-empty INPUTS
 * list. They are NOT listed per-row in the grammar.
 *
 *  ── columns ──
 *  id          stable key (used as React row key + override merge key)
 *  category    section the row lives in (see GRAMMAR_CATEGORIES)
 *  family      human-readable subject family name (the row label)
 *  subject     what the SUBJECT pill displays (`Device name`, `"Signal"`, …)
 *  detail      pill list of categories the DETAIL pill draws from in
 *              Action mode (e.g. `Position name` for Servo, empty = hidden).
 *              Decision mode populates DETAIL per sub-action (see model).
 *  actions     pill list of fire-actions (Action mode only).
 *  inputs      pill list of observable states (Decision mode).
 *  notes       free-form engineering notes / SDC standard refs
 */

// Category metadata. Order here = display order in the editor. Each section
// renders with a subdued colored header bar and is collapsible. New rows
// added from a section's "+ Add row" button inherit that section's category.
//
// Colors are intentionally muted (slate / earth-tone family) rather than
// pure primaries — the editor sits in a dense grid and bright headers
// shouted over the data.
export const GRAMMAR_CATEGORIES = [
  { id: 'pneumatic', label: 'Pneumatic',          color: '#4a6fa5' },
  { id: 'motion',    label: 'Motion',             color: '#6b5b95' },
  { id: 'sensors',   label: 'Sensors',            color: '#5b8c5a' },
  { id: 'vision',    label: 'Vision',             color: '#5a8e8e' },
  { id: 'robot',     label: 'Robot',              color: '#a67a51' },
  { id: 'signals',   label: 'Signals & Tracking', color: '#9c5e5e' },
  { id: 'misc',      label: 'Misc',               color: '#6b7a8f' },
];

export const DEFAULT_GRAMMAR = [
  // ── Pneumatic ────────────────────────────────────────────────────────────
  {
    id: 'cylinder',
    category: 'pneumatic',
    family: 'Pneumatic Cylinder (linear, 1- or 2-sensor)',
    subject: 'Device name',
    detail:  '',
    actions: 'Extend, Retract',
    inputs:  'Extended, Retracted',
    notes: 'If 1-sensor, the missing input is inverted in R01.',
  },
  {
    id: 'rotary',
    category: 'pneumatic',
    family: 'Pneumatic Rotary',
    subject: 'Device name',
    detail:  '',
    actions: 'Rotate CW, Rotate CCW',
    inputs:  'At CW, At CCW',
    notes: 'Clockwise / counter-clockwise — NOT engage / disengage.',
  },
  {
    id: 'gripper',
    category: 'pneumatic',
    family: 'Pneumatic Gripper (2-sol default)',
    subject: 'Device name',
    detail:  '',
    actions: 'Engage, Disengage',
    inputs:  'Engaged, Disengaged',
    notes: 'Spring-return single-sol = manual code per SDC §15.9.',
  },
  {
    id: 'vacuum',
    category: 'pneumatic',
    family: 'Pneumatic Vacuum',
    subject: 'Device name',
    detail:  '',
    actions: 'Vac On, Vac Off, Vac Eject On',
    inputs:  'Vac On, Vac Off',
    notes: '',
  },

  // ── Motion (servo + conveyor) ────────────────────────────────────────────
  {
    id: 'servo',
    category: 'motion',
    family: 'Servo Axis',
    subject: 'Device name',
    detail:  'Position name',
    actions: 'Move Absolute, Move Incremental, Index',
    inputs:  'At Position, Not At Position',
    notes: 'DETAIL = position name; underlying value lives on the position config (e.g. "Pickup → 25mm").',
  },
  {
    id: 'conveyor',
    category: 'motion',
    family: 'Conveyor',
    subject: 'Device name',
    detail:  '',
    actions: 'Run, Stop',
    inputs:  'Running, Stopped',
    notes: '',
  },

  // ── Sensors ──────────────────────────────────────────────────────────────
  {
    id: 'digitalSensor',
    category: 'sensors',
    family: 'Digital Sensor / PEC',
    subject: 'Device name',
    detail:  '',
    actions: '',
    inputs:  'On, Off',
    notes: 'Read-only — Decision mode only (Wait / Check / Branch).',
  },
  {
    id: 'analogSensor',
    category: 'sensors',
    family: 'Analog Sensor (Probe)',
    subject: 'Device name',
    detail:  'Setpoint name',
    actions: '',
    inputs:  'In Tolerance, Out of Tolerance',
    // logExtras = additional values that can be logged BEYOND the picked
    // condition. The condition itself always logs as the primary; extras
    // render as "Also log:" checkboxes in the picker. Empty = no extras.
    logExtras: 'Actual Position',
    notes: 'DETAIL = which setpoint to compare against. Decision mode only.',
  },

  // ── Vision ───────────────────────────────────────────────────────────────
  {
    id: 'vision',
    category: 'vision',
    family: 'Vision System',
    subject: 'Device name (camera)',
    detail:  'Job name',
    actions: 'Trigger, Inspect',
    inputs:  'Pass, Fail',
    notes: '"Inspect" = pulse trigger + wait result + log to PT (a compound Action).',
  },

  // ── Robot ────────────────────────────────────────────────────────────────
  {
    id: 'robot',
    category: 'robot',
    family: 'Robot',
    subject: 'Device name',
    detail:  'Sequence #, Signal name',
    actions: 'Run Sequence, Set Output',
    inputs:  'On, Off',
    notes: '',
  },

  // ── Signals & Tracking ───────────────────────────────────────────────────
  {
    id: 'signal',
    category: 'signals',
    family: 'Signal (state / position / condition / vision-PT / cross-SM)',
    subject: 'Device name',
    detail:  '',
    actions: '',
    inputs:  'On, Off',
    notes: 'Read-only. The SUBJECT is the signal — no extra DETAIL needed.',
  },
  {
    id: 'partTracking',
    category: 'signals',
    family: 'Part Tracking field',
    subject: 'Device name',
    detail:  '',
    actions: 'Set, Clear',
    inputs:  'Pass, Fail',
    notes: 'BOOL fields use Set / Clear. SUBJECT is the field name.',
  },
  {
    id: 'parameter',
    category: 'signals',
    family: 'Parameter (cross-SM global)',
    subject: 'Device name',
    detail:  '',
    actions: '',
    inputs:  'On, Off',
    notes: 'BOOL params use On / Off. SUBJECT is the param name.',
  },

  // ── Misc ─────────────────────────────────────────────────────────────────
  {
    id: 'timer',
    category: 'misc',
    family: 'Timer / Dwell',
    subject: '"Timer"',
    detail:  '',
    actions: '',
    inputs:  'Duration elapsed',
    notes: 'Wait sub-action only. Duration ms is a parameter the picker collects.',
  },
  {
    id: 'custom',
    category: 'misc',
    family: 'Custom Device',
    subject: 'Device name',
    detail:  '',
    actions: '(per-device action)',
    inputs:  '(per-device state)',
    notes: '',
  },
];

// Column metadata for the in-app editor. Order = display order.
//
// Two column kinds:
//   - text/multiline: simple click-to-edit
//   - pills:          one-pill-per-row stacked list, separator-joined
//
// ACTIONS = fire-actions for Action mode.
// INPUTS  = observable states for Decision mode (Wait / Check / Branch).
export const GRAMMAR_COLUMNS = [
  { key: 'family',  label: 'Family',  width: 170, multiline: false },
  { key: 'subject', label: 'SUBJECT', width: 110, multiline: false },
  { key: 'detail',  label: 'DETAIL',  width: 130, pills: true, separator: ',', placeholder: 'category' },
  { key: 'actions', label: 'ACTIONS — fire-actions (Action mode)',           width: 200, pills: true, separator: ',', placeholder: 'action' },
  { key: 'inputs',  label: 'INPUTS — observable states (Decision mode)',     width: 200, pills: true, separator: ',', placeholder: 'state' },
  { key: 'notes',   label: 'Notes',   width: 200, multiline: true  },
];

// localStorage key for persisted overrides (full row array). When absent or
// invalid JSON, the editor falls back to DEFAULT_GRAMMAR.
export const GRAMMAR_STORAGE_KEY = 'sdc.pickerGrammar.v1';

/**
 * Parse a `detail` cell into structured categories with optional enum values.
 *
 * Syntax per category (separated by `,`):
 *   `Category Name`                            → free-text input
 *   `Category Name: opt1 | opt2 | opt3`        → enum picker (chips)
 *
 * Examples:
 *   ''                              → []
 *   'Position name'                 → [{name:'Position name', enum:[]}]
 *   'Position name, Move Type: Absolute | Incremental | Index'
 *                                   → [{name:'Position name', enum:[]},
 *                                       {name:'Move Type', enum:['Absolute','Incremental','Index']}]
 *
 * Picker rendering: when a category has enum values, render chips. When
 * empty, fall back to subject's per-instance detailValues, then free-text.
 */
export function parseDetailField(s) {
  return String(s ?? '')
    .split(',')
    .map(piece => {
      const trimmed = piece.trim();
      if (!trimmed) return null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return { name: trimmed, enum: [] };
      const name = trimmed.slice(0, colonIdx).trim();
      const enumVals = trimmed.slice(colonIdx + 1)
        .split('|')
        .map(v => v.trim())
        .filter(Boolean);
      return { name, enum: enumVals };
    })
    .filter(Boolean);
}

// Legacy fields from prior schema versions — stripped from rows during
// migration so localStorage stays clean.
const LEGACY_FIELDS = [
  // v1 schema (original — single comma-string `actions` mixing all verbs)
  'defaultVerb', 'outcomes',
  // v2 schema (per-verb groups)
  'actionEnabled', 'actionValues',
  'waitValues', 'checkValues', 'decideValues',
  'positions',
  // v3 schema (action / value / waitEnabled / checkEnabled / decideEnabled)
  'action', 'value',
  'waitEnabled', 'checkEnabled', 'decideEnabled',
  // v4 schema (outputs / inputs)
  'outputs',
];

// Fields that the current (v5) schema requires.
const V5_REQUIRED = ['subject', 'detail', 'actions', 'inputs', 'logExtras'];

/**
 * Migrate one persisted row to the current v5 schema.
 *
 * Schema history:
 *   v1 — single `actions` string mixing all verbs + `defaultVerb` + `outcomes`.
 *   v2 — per-verb value groups (`actionValues`, `waitValues`, `checkValues`, …).
 *   v3 — split into `action` (singular) + `value` + per-mode `*Enabled` BOOLs.
 *   v4 — renamed to `outputs` + `inputs` (no per-mode BOOLs; modes implicit).
 *   v5 — current. Renamed `outputs` → `actions`. Decision mode has 3
 *        sub-actions (Wait / Check / Branch); ACTIONS column is fire-actions
 *        only; INPUTS feeds Decision-mode universally.
 *
 * Strategy: detect the source version by sentinel field, do any cleanup or
 * field renames, then strip legacy fields and backfill missing v5 fields
 * from defaults (or empty-string fallbacks for custom rows).
 */
function migrateRow(persisted) {
  const def = DEFAULT_GRAMMAR.find(d => d.id === persisted.id);
  const merged = { ...persisted };

  // Backfill category on rows that pre-date categorization.
  if (!merged.category) merged.category = def?.category || 'misc';

  // Old "—" sentinel for hidden DETAIL is now just empty string.
  if (merged.detail === '—') merged.detail = '';

  // Schema detection by sentinel field.
  const isV1 = 'defaultVerb' in persisted || 'outcomes' in persisted;
  const isV2 = !isV1 && (
    'actionEnabled' in persisted || 'actionValues' in persisted ||
    'waitValues'    in persisted || 'checkValues'  in persisted ||
    'decideValues'  in persisted
  );
  // v3: had `action` (singular) but no `outputs` and no `actions` (plural)
  const isV3 = !isV1 && !isV2 &&
               'action' in persisted &&
               !('outputs' in persisted) &&
               !('actions' in persisted);
  // v4: had `outputs` (renamed in v5 to `actions`)
  const isV4 = 'outputs' in persisted && !('actions' in persisted);

  // v1's `actions` field is a mixed-verb comma-string with different
  // semantics from v5. Strip it; reseed from defaults below.
  if (isV1 && 'actions' in merged) {
    delete merged.actions;
  }

  // v3 → v5: rename `action` → `actions`, `value` → `inputs`.
  if (isV3) {
    merged.actions = persisted.action || '';
    merged.inputs  = persisted.value  || '';
  }

  // v4 → v5: rename `outputs` → `actions`.
  if (isV4) {
    merged.actions = persisted.outputs || '';
  }

  // Strip every legacy field.
  for (const k of LEGACY_FIELDS) delete merged[k];

  // Backfill any missing v5 fields from defaults (or safe fallbacks).
  for (const k of V5_REQUIRED) {
    if (k in merged) continue;
    if (def && def[k] !== undefined) {
      merged[k] = def[k];
    } else {
      merged[k] = '';
    }
  }

  // ── Targeted v5.1 cleanup: signal/partTracking/parameter rows ─────────
  // Older defaults stored a redundant "Signal name" / "Field name" / "Param
  // name" detail category, and a few got their detail field corrupted with
  // parenthetical example values. The SUBJECT IS the signal/field/param, so
  // detail should be empty for these row types.
  // Also: switch legacy "True, False" inputs to "On, Off" for signal &
  // parameter (matches user feedback on PLC-standard convention).
  if (['signal', 'partTracking', 'parameter'].includes(merged.id)) {
    if (typeof merged.detail === 'string') {
      const trimmedDetail = merged.detail.trim();
      const isLegacyDetail = ['Signal name', 'Field name', 'Param name'].includes(trimmedDetail);
      const hasParens = /[()]/.test(trimmedDetail);
      if (isLegacyDetail || hasParens) {
        merged.detail = '';
      }
    }
  }
  if ((merged.id === 'signal' || merged.id === 'parameter')
      && merged.inputs === 'True, False') {
    merged.inputs = 'On, Off';
  }

  // Gripper: Close/Open → Engage/Disengage (matches mech-engineering vocab).
  if (merged.id === 'gripper') {
    if (merged.actions === 'Close, Open') merged.actions = 'Engage, Disengage';
    if (merged.inputs  === 'Closed, Open') merged.inputs  = 'Engaged, Disengaged';
  }
  // Vacuum: add eject-on action; old defaults had only on/off.
  if (merged.id === 'vacuum') {
    if (merged.actions === 'Turn On, Turn Off') merged.actions = 'Vac On, Vac Off, Vac Eject On';
  }

  return merged;
}

/**
 * Load the active grammar table — overrides if present, else defaults.
 * Auto-migrates rows from older schema versions to the current v5 schema.
 *
 * Returns a deep-clone array so callers can mutate freely.
 */
export function loadGrammar() {
  try {
    const raw = localStorage.getItem(GRAMMAR_STORAGE_KEY);
    if (!raw) return DEFAULT_GRAMMAR.map(r => ({ ...r }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_GRAMMAR.map(r => ({ ...r }));
    return parsed.map(migrateRow);
  } catch {
    return DEFAULT_GRAMMAR.map(r => ({ ...r }));
  }
}

/** Persist a full grammar table (array of rows). */
export function saveGrammar(rows) {
  try {
    localStorage.setItem(GRAMMAR_STORAGE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

/** Wipe overrides — restore defaults on next load. */
export function resetGrammar() {
  try {
    localStorage.removeItem(GRAMMAR_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Look up a single row by id. Returns null if not found.
 * Picker code can call this at runtime when it needs subject-specific config.
 */
export function getGrammarRow(id, rows) {
  const table = rows ?? loadGrammar();
  return table.find(r => r.id === id) ?? null;
}
