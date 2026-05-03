/**
 * UniversalPicker — the unified picker for both Action and Decision nodes.
 *
 * Consumes:
 *  - `grammar`  : array of grammar rows from pickerGrammar.js (defines TYPES)
 *  - `subjects` : array of test subjects from pickerTestSubjects.js (instances)
 *
 * Each subject is bound to a grammar row via `subject.grammarRowId`. The
 * grammar provides the SHAPE (actions, inputs, detail categories); the
 * subject provides the IDENTITY (name, named detail values).
 *
 * ─── PILL STRUCTURES ─────────────────────────────────────────────────────
 *
 *   Action mode:        ACTION  /  SUBJECT  /  DETAIL?
 *   Decision · Wait:    Wait    /  SUBJECT  /  CONDITION  /  DETAIL?
 *   Decision · Check:   Check   /  SUBJECT  /  DETAIL?     ← no CONDITION
 *   Decision · Branch:  Branch  /  SUBJECT  /  CONDITION  /  DETAIL?
 *                            └ CONDITION = primary (left) branch.
 *                              Click a different INPUTS state to flip.
 *
 * ─── EDGE TOPOLOGY ───────────────────────────────────────────────────────
 *
 *   Wait    → 1 edge   (advance when condition true)
 *   Check   → 1 edge   (log + unconditional advance)
 *   Branch  → N edges  (one per INPUTS state; primary first)
 *   Action  → 1 edge   (standard)
 *
 * ─── OUTPUT (onPick callback) ────────────────────────────────────────────
 *
 *   {
 *     mode: 'action' | 'decision',
 *     subAction: 'wait' | 'check' | 'branch' | null,  // null in action mode
 *     subjectId,                          // subject instance id (sub_xxx)
 *     subjectName,                        // 'VerticalCylinder'
 *     grammarRowId,                       // 'cylinder'
 *     grammarFamily,                      // 'Pneumatic Cylinder (linear, ...)'
 *     actionVerb,                         // action mode only
 *     condition,                          // wait & branch only
 *     detail: { [category]: value },      // empty {} when no DETAIL
 *     edgeTopology: 1 | N,
 *     edgeLabels: string[],               // [] for action / wait / check
 *   }
 */

import { useState, useMemo } from 'react';
import { GRAMMAR_CATEGORIES, loadGrammar, parseDetailField } from '../lib/pickerGrammar.js';
import { DeviceIcon, CheckContinueIcon, CheckBranchIcon } from './DeviceIcons.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';

// Map grammar row id → DeviceIcon type so the subject buttons can render
// the same SVG icons used elsewhere in the app. Keeps visual identity
// consistent between the picker, the device sidebar, and the canvas.
// Exported so on-node action rows (PickerV2ActionRow) can reuse it.
export const GRAMMAR_TO_DEVICE_TYPE = {
  cylinder:      'PneumaticLinearActuator',
  rotary:        'PneumaticRotaryActuator',
  gripper:       'PneumaticGripper',
  vacuum:        'PneumaticVacGenerator',
  servo:         'ServoAxis',
  conveyor:      'Conveyor',
  digitalSensor: 'DigitalSensor',
  analogSensor:  'AnalogSensor',
  vision:        'VisionSystem',
  robot:         'Robot',
  signal:        'Signal',
  partTracking:  'Signal',     // PT reuses signal icon (no dedicated icon)
  parameter:     'Parameter',
  timer:         'Timer',
  custom:        'Custom',
};

// Sub-action taxonomy. A branch is conceptually just a check that branches —
// you can't fork without first observing something. So the picker exposes:
//   wait    — block until condition becomes true (no log, single exit)
//   check   — observe + log + always advance (single exit)
//   branch  — observe + log + fork on the observed value (N exits)
// "Check & Continue" / "Check & Branch" are the user-facing labels; the
// internal ids stay short (`check`, `branch`) for storage compactness and
// to avoid breaking existing pickerConfig data.
const SUB_ACTIONS = [
  { id: 'wait',   label: 'Wait',             tagline: 'Block until condition is true' },
  { id: 'check',  label: 'Check & Continue', tagline: 'Observe, log result, advance',  icon: 'continue' },
  { id: 'branch', label: 'Check & Branch',   tagline: 'Observe, log result, fork on value', icon: 'branch' },
];

const parseList = (s) =>
  String(s ?? '').split(/[,·]/).map(x => x.trim()).filter(Boolean);

export function UniversalPicker({
  grammar,
  subjects,
  onPick,
  onCancel,
  initialMode = 'action',
  // When set, the picker opens in EDIT mode: state is pre-populated from the
  // action's pickerConfig and the commit callback receives `isEdit: true`.
  // The caller (StateNode) is responsible for updateAction-vs-addAction.
  editAction = null,
}) {
  const grammarRows = useMemo(() => grammar || loadGrammar(), [grammar]);
  const subjectList = subjects || [];

  // Index grammar by id for fast lookup
  const grammarById = useMemo(() => {
    const m = {};
    grammarRows.forEach(r => { m[r.id] = r; });
    return m;
  }, [grammarRows]);

  // Seed initial state from editAction.pickerConfig if present.
  // Falls back to default empty picks for fresh-add mode.
  const seed = editAction?.pickerConfig || null;
  const [mode, setMode]               = useState(seed?.mode || initialMode);
  const [subAction, setSubAction]     = useState(seed?.subAction || 'wait');
  const [subjectId, setSubjectId]     = useState(seed?.subjectId || null);
  const [actionVerb, setActionVerb]   = useState(seed?.actionVerb || null);
  const [condition, setCondition]     = useState(seed?.condition || null);
  const [detailValues, setDetailVals] = useState(seed?.detail ? { ...seed.detail } : {});
  // Branch sub-action: optional 3rd exit on the bottom handle (`exit-retry`)
  // for "loop back and try again" patterns. Off by default — most branches
  // are simple Pass/Fail forks. Toggling this on adds a 3rd label "Retry"
  // to edgeLabels so the auto-spawn generates the third edge from
  // `exit-retry` (bottom-center). User wires it back to a previous state
  // for retry-with-counter logic.
  const [retryEnabled, setRetryEnabled] = useState(seed?.retryEnabled || false);

  // Log target — Check & Continue and Check & Branch can write the observed
  // value to a Part-Tracking (PT) field. Defaults to OFF (user's call: most
  // checks don't need to log; logging is the exception). When toggled on,
  // user picks an existing field or creates a new one; the PT field is
  // auto-created on commit by the StateNode caller.
  const [ptEnabled,  setPtEnabled]  = useState(seed?.ptEnabled  ?? false);
  const [ptFieldId,  setPtFieldId]  = useState(seed?.ptFieldId  ?? null);
  const [ptFieldName, setPtFieldName] = useState(seed?.ptFieldName ?? '');

  // Terminal-state shortcut — instead of picking an action, the user can
  // mark THIS state as Cycle Complete (✓) or Fault (⚠). Selecting one
  // grays out the rest of the picker; on commit, the StateNode caller
  // sets `data.isComplete` or `data.isFault` on the node and skips the
  // addAction step. null = normal action/decision flow.
  const [terminalType, setTerminalType] = useState(null);

  // Branch count — Check & Branch can have 2 to 5 outgoing edges. Default is
  // derived from the grammar's INPUTS list (e.g., digital sensor = 2 for On/Off,
  // analog with 3-way classification = 3). User can increment / decrement
  // within [2, 5]. Extra branches beyond grammar.inputs.length get auto-labels
  // like "Branch 4", "Branch 5" — editable per-edge after creation.
  const [branchCount, setBranchCount] = useState(seed?.branchCount ?? null);

  // The currently selected subject instance + its grammar row.
  const subject = useMemo(
    () => subjectList.find(s => s.id === subjectId) || null,
    [subjectList, subjectId]
  );
  const grammarRow = useMemo(
    () => subject ? grammarById[subject.grammarRowId] || null : null,
    [subject, grammarById]
  );

  // ── Mode-filtered subjects ──────────────────────────────────────────────
  const visibleSubjects = useMemo(() => subjectList.filter(s => {
    const g = grammarById[s.grammarRowId];
    if (!g) return false;
    if (mode === 'action')   return parseList(g.actions).length > 0;
    if (mode === 'decision') return parseList(g.inputs).length > 0;
    return true;
  }), [subjectList, grammarById, mode]);

  const subjectsByCategory = useMemo(() => {
    const map = {};
    GRAMMAR_CATEGORIES.forEach(c => { map[c.id] = []; });
    visibleSubjects.forEach(s => {
      const g = grammarById[s.grammarRowId];
      const c = g?.category || 'misc';
      if (!map[c]) map[c] = [];
      map[c].push(s);
    });
    return map;
  }, [visibleSubjects, grammarById]);

  // Detail categories (structured: { name, enum }). Enum values come from
  // the grammar's `detail` field syntax: `Move Type: Absolute|Incremental|Index`.
  const detailCategories = useMemo(
    () => grammarRow ? parseDetailField(grammarRow.detail) : [],
    [grammarRow]
  );

  // ── Mutators ────────────────────────────────────────────────────────────

  function handleModeChange(next) {
    setMode(next);
    if (subjectId) {
      const s = subjectList.find(x => x.id === subjectId);
      const g = s ? grammarById[s.grammarRowId] : null;
      const valid = g && (
        next === 'action'   ? parseList(g.actions).length > 0 :
        next === 'decision' ? parseList(g.inputs).length > 0  : true
      );
      if (!valid) {
        clearSelection();
      } else if (next === 'action') {
        setActionVerb(parseList(g.actions)[0] || null);
        setCondition(null);
      } else {
        setCondition(parseList(g.inputs)[0] || null);
        setActionVerb(null);
      }
    }
  }

  function clearSelection() {
    setSubjectId(null);
    setActionVerb(null);
    setCondition(null);
    setDetailVals({});
  }

  function handleSubActionChange(next) {
    setSubAction(next);
    if (grammarRow && !condition) {
      setCondition(parseList(grammarRow.inputs)[0] || null);
    }
    // Check & Continue auto-enables log — the whole point of "check + continue"
    // is to record what was observed. Other sub-actions don't auto-enable.
    if (next === 'check') {
      setPtEnabled(true);
    }
  }

  function handleSubjectChange(id) {
    setSubjectId(id);
    const s = subjectList.find(x => x.id === id);
    if (!s) return;
    const g = grammarById[s.grammarRowId];
    if (!g) return;
    if (mode === 'action') {
      setActionVerb(parseList(g.actions)[0] || null);
      setCondition(null);
    } else {
      setCondition(parseList(g.inputs)[0] || null);
      setActionVerb(null);
    }
    setDetailVals({});
  }

  // ── Derived: edge topology ──────────────────────────────────────────────

  const edgeInfo = useMemo(() => {
    if (!grammarRow)            return { topology: 1, labels: [] };
    if (mode === 'action')      return { topology: 1, labels: [] };
    if (subAction === 'wait')   return { topology: 1, labels: [] };
    if (subAction === 'check')  return { topology: 1, labels: [] };
    // Branch: build labels[] sized by branchCount (default = grammar inputs).
    //   - First N labels come from grammar inputs, condition (primary) first.
    //   - Beyond inputs.length, auto-name "Branch <n>" (user can rename per-edge).
    const inputs = parseList(grammarRow.inputs);
    const orderedInputs = condition
      ? [condition, ...inputs.filter(s => s !== condition)]
      : inputs;

    // Effective count: user override (clamped to [2, 5]) OR derived from grammar.
    // Grammar with <2 inputs degenerates to a 1-exit "branch" (functionally a Wait).
    const grammarCount = Math.max(orderedInputs.length, 1);
    const requested    = branchCount ?? grammarCount;
    const count        = Math.max(grammarCount === 1 ? 1 : 2, Math.min(5, requested));

    let labels = [];
    for (let i = 0; i < count; i++) {
      labels.push(orderedInputs[i] ?? `Branch ${i + 1}`);
    }
    // Retry: append a "Retry" label so the auto-spawn generates a final edge
    // from `exit-retry` (bottom-center). Independent of branchCount — counts
    // as a separate "extra" exit on top of whatever you set.
    if (retryEnabled) {
      labels = [...labels, 'Retry'];
    }
    return { topology: labels.length, labels };
  }, [grammarRow, mode, subAction, condition, retryEnabled, branchCount]);

  // Terminal-state path commits standalone — no subject/condition needed.
  const canCommit = !!terminalType || (
    !!subject && !!grammarRow && (
      mode === 'action'
        ? !!actionVerb
        : (subAction === 'check' || !!condition)
    )
  );

  function handleCommit() {
    if (!canCommit) return;
    // Terminal-state shortcut: emit a special payload that the caller (StateNode)
    // detects and uses to flip `data.isComplete` / `data.isFault` on the node
    // instead of adding an action.
    if (terminalType) {
      onPick && onPick({
        terminalType,           // 'complete' | 'fault'
        isEdit: !!editAction,
      });
      return;
    }
    // Derive exit state for Action mode — the input we'd verify on advance.
    // Heuristic: pick the input whose name shares a root with the action verb
    // (e.g. "Extend" → "Extended", "Retract" → "Retracted"). Fall back to the
    // first input. Caller can override later via an inline edit.
    const inputs = parseList(grammarRow.inputs);
    let exitState = null;
    if (mode === 'action' && inputs.length > 0 && actionVerb) {
      const v = actionVerb.toLowerCase().split(/\s+/)[0];
      exitState = inputs.find(i => i.toLowerCase().startsWith(v)) || inputs[0];
    }

    // Log target persists across check sub-actions (continue + branch). Wait
    // mode never logs (it just blocks), Action mode doesn't have a "result"
    // to log. The caller (StateNode onPick handler) auto-creates a PT field
    // if `ptEnabled && !ptFieldId` — using `ptFieldName` (or subject name as
    // a default) as the new field's name.
    const isCheck = mode === 'decision' && (subAction === 'check' || subAction === 'branch');
    onPick && onPick({
      mode,
      subAction:    mode === 'decision' ? subAction : null,
      subjectId:    subject.id,
      subjectName:  subject.name,
      grammarRowId: grammarRow.id,
      grammarFamily: grammarRow.family,
      actionVerb:   mode === 'action' ? actionVerb : null,
      condition:    mode === 'decision' ? condition : null,
      detail:       { ...detailValues },
      exitState,    // null for Decision mode
      edgeTopology: edgeInfo.topology,
      edgeLabels:   edgeInfo.labels,
      // Persist retry flag on pickerConfig so re-opening the picker
      // shows the toggle in the same state. Only meaningful for Branch.
      retryEnabled: subAction === 'branch' ? retryEnabled : false,
      // Log target — only for check / branch. The picker stores the user's
      // explicit choice; the StateNode caller auto-creates the PT field on
      // commit if no id was selected.
      ptEnabled:    isCheck ? ptEnabled : false,
      ptFieldId:    isCheck && ptEnabled ? ptFieldId : null,
      ptFieldName:  isCheck && ptEnabled
        ? (ptFieldName || `${subject.name}_Check`)
        : null,
      // Branch count override (for Check & Branch only). Stored so re-opening
      // the picker preserves the user's chosen N.
      branchCount:  subAction === 'branch' ? (branchCount ?? null) : null,
      // True when the picker was opened to edit an existing action.
      // The caller uses this to choose updateAction vs addAction.
      isEdit:       !!editAction,
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const accentColor = modeAccent(mode, subAction);
  const noSubjects = subjectList.length === 0;

  return (
    <div style={pickerWrap}>
      {/* Mode toggle */}
      <div style={sectionRow}>
        <ModeBtn
          label="Action"
          active={mode === 'action'}
          onClick={() => handleModeChange('action')}
          blurb="Node fires something"
          color="#0072B5"
        />
        <ModeBtn
          label="Decision"
          active={mode === 'decision'}
          onClick={() => handleModeChange('decision')}
          blurb="Node observes + reacts"
          color="#7c3aed"
        />
      </div>

      {/* Sub-action toggle (decision only) */}
      {mode === 'decision' && (
        <div style={{ ...sectionRow, gap: 6, marginTop: 6 }}>
          {SUB_ACTIONS.map(s => (
            <SubActionBtn
              key={s.id}
              {...s}
              active={subAction === s.id}
              onClick={() => handleSubActionChange(s.id)}
            />
          ))}
        </div>
      )}

      {/* Subject picker */}
      <SectionTitle>Subject</SectionTitle>
      {noSubjects ? (
        <div style={emptyHint}>
          No test subjects yet — add some in the <strong>Test Subjects</strong>
          panel above to populate this list.
        </div>
      ) : (
        <div style={subjectGrid}>
          {GRAMMAR_CATEGORIES.map(cat => {
            const subs = subjectsByCategory[cat.id] || [];
            if (subs.length === 0) return null;
            // When every subject in this section shares ONE grammar family,
            // use that family name as the section banner (e.g. "SERVO AXIS"
            // instead of the broader "MOTION") — otherwise the banner is
            // redundant with the per-chip subtitle that says the same thing.
            // Multi-family sections (e.g. mixed Servo + Conveyor) keep the
            // category label and chip subtitles.
            const families = new Set();
            subs.forEach(s => {
              const fam = grammarById[s.grammarRowId]?.family;
              if (fam) families.add(fam);
            });
            const oneFamily   = families.size === 1 ? [...families][0] : null;
            const bannerText  = oneFamily
              ? oneFamily.split(/[(/]/)[0].trim()
              : cat.label;
            return (
              <div key={cat.id} style={{ marginBottom: 6 }}>
                <div style={{ ...catHeader, background: cat.color }}>
                  {bannerText}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 2px' }}>
                  {subs.map(s => {
                    const g = grammarById[s.grammarRowId];
                    const inputsHint = parseList(g?.inputs).join(' / ');
                    const actionsHint = parseList(g?.actions).join(' / ');
                    const deviceType = GRAMMAR_TO_DEVICE_TYPE[s.grammarRowId];
                    const isActive = subjectId === s.id;
                    // Pneumatic device names already encode their type
                    // (Cylinder, Gripper, Rotary, Vacuum), so we skip the
                    // type sub-label there. Single-family sections also skip
                    // the subtitle — the banner already shows the family.
                    const showTypeHint = !oneFamily && cat.id !== 'pneumatic';
                    const shortType = (g?.family || '').split(/[(/]/)[0].trim();
                    return (
                      <button
                        key={s.id}
                        onClick={() => handleSubjectChange(s.id)}
                        style={subjectChip(isActive, cat.color)}
                        title={`${g?.family || ''}\n` + (
                          mode === 'action'
                            ? `Actions: ${actionsHint || '(none)'}`
                            : `Inputs: ${inputsHint || '(none)'}`
                        )}
                      >
                        {deviceType && (
                          <DeviceIcon
                            type={deviceType}
                            size={18}
                          />
                        )}
                        <span style={{
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          lineHeight: 1.1,
                        }}>
                          <span>{s.name}</span>
                          {showTypeHint && shortType && (
                            <span style={{
                              fontSize: 8,
                              fontWeight: 500,
                              color: '#64748b',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              marginTop: 1,
                            }}>
                              {shortType}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visibleSubjects.length === 0 && (
            <div style={emptyHint}>
              No subjects match this mode. Add one whose type has{' '}
              {mode === 'action' ? 'a non-empty ACTIONS list' : 'a non-empty INPUTS list'}.
            </div>
          )}
        </div>
      )}

      {/* Detail — moved up here so it sits RIGHT BELOW the subject. The flow
          is "pick subject → pick the detail of that subject (setpoint name,
          servo position, vision job…) → THEN pick what condition / action
          to take." Reads broad → specific. Only renders if the grammar row
          has detail categories AND we already have a chosen grammar row. */}
      {grammarRow && detailCategories.length > 0 && (() => {
        // "Controlled" categories — those auto-filled by another category's
        // detailValueMeta. Rendered read-only (Move Type follows the chosen
        // Position; user shouldn't edit it directly).
        const controlled = new Set();
        if (subject?.detailValueMeta) {
          for (const fillsByValue of Object.values(subject.detailValueMeta)) {
            if (!fillsByValue || typeof fillsByValue !== 'object') continue;
            for (const fills of Object.values(fillsByValue)) {
              if (!fills || typeof fills !== 'object') continue;
              for (const k of Object.keys(fills)) controlled.add(k);
            }
          }
        }
        return (<>
          <SectionTitle>Detail</SectionTitle>
          {detailCategories.map(cat => {
            // Choice priority: subject's per-instance values > grammar enum > free text.
            // Lookup is tolerant: tries exact match, then strips trailing
            // "(...)" parenthetical hints. Lets a grammar entry like
            // `Setpoint name (HeightCheck)` still match a subject's
            // `Setpoint name` key.
            const stripParens = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
            const lookupKey = stripParens(cat.name);
            const subjectValues =
              subject?.detailValues?.[cat.name] ||
              subject?.detailValues?.[lookupKey] ||
              [];
            const choices = subjectValues.length > 0 ? subjectValues : cat.enum;

            // detailValueMeta-driven auto-fill. When the user picks a value
            // for THIS category, check if it has a meta map that fills other
            // categories. E.g. picking Servo position "Pick" auto-fills
            // Move Type with "Absolute" — no typing.
            const meta = subject?.detailValueMeta?.[cat.name]
                      || subject?.detailValueMeta?.[lookupKey]
                      || null;
            const setValueWithFill = (v) => {
              setDetailVals(d => {
                const next = { ...d, [cat.name]: v };
                const fills = meta?.[v];
                if (fills && typeof fills === 'object') {
                  for (const [k, fv] of Object.entries(fills)) {
                    next[k] = fv;
                  }
                }
                return next;
              });
            };
            const hasChoices = choices.length > 0;
            const current = detailValues[cat.name] || '';
            const isControlled = controlled.has(cat.name);
            return (
              <div key={cat.name} style={detailRow}>
                <label style={detailLabel}>{cat.name}</label>
                {isControlled ? (
                  // Controlled by another category's auto-fill — render as
                  // a read-only tag, not a clickable selector. E.g. Move Type
                  // displays whatever the chosen position dictated.
                  <span style={readOnlyTag}>
                    {current || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>auto · pick a position</span>}
                    {current && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: '#64748b', fontWeight: 500 }}>
                        (from position)
                      </span>
                    )}
                  </span>
                ) : hasChoices ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                    {choices.map(v => (
                      <button
                        key={v}
                        onClick={() => setValueWithFill(v)}
                        style={pickChip(current === v, '#475569')}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={current}
                    onChange={e => setValueWithFill(e.target.value)}
                    placeholder={`(${cat.name.toLowerCase()})`}
                    style={detailInput}
                  />
                )}
              </div>
            );
          })}
        </>);
      })()}

      {/* Action verb (action mode) */}
      {grammarRow && mode === 'action' && (
        <>
          <SectionTitle>Action</SectionTitle>
          <div style={chipRow}>
            {parseList(grammarRow.actions).map(v => (
              <button
                key={v}
                onClick={() => setActionVerb(v)}
                style={pickChip(actionVerb === v, '#0072B5')}
              >
                {v}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Condition — Wait + Branch only (Check & Continue always advances
          regardless of value, so no condition picker). The retry/branch-count/
          log-target rows below this still render for Check & Continue —
          they're inside the same outer `mode === 'decision'` block but
          gate on subAction individually. */}
      {grammarRow && mode === 'decision' && (
        <>
          {subAction !== 'check' && (
            <>
              <SectionTitle>
                {subAction === 'wait'
                  ? 'Condition · what to wait for'
                  : 'Preferred outcome · straight-down branch'}
              </SectionTitle>
              <div style={chipRow}>
                {parseList(grammarRow.inputs).map((v, idx) => {
                  const chipColor = subAction === 'branch'
                    ? (idx === 0 ? '#16a34a' : idx === 1 ? '#dc2626' : '#f59e0b')
                    : accentColor;
                  return (
                    <button
                      key={v}
                      onClick={() => setCondition(v)}
                      style={pickChip(condition === v, chipColor)}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
              {subAction === 'branch' && parseList(grammarRow.inputs).length > 1 && (
                <div style={hintText}>
                  The selected outcome is the PRIMARY branch — its child node
                  spawns straight down. Alternates spawn to the right;
                  the optional Retry exit goes left.
                </div>
              )}
            </>
          )}

          {/* Compact one-line rows for Branch options. Order:
                1. Number of branches  (stepper, default from grammar inputs)
                2. Retry exit          (checkbox; uses the bottom handle)
              Both render in a single line — no descriptions — to keep the
              picker window short. The Log-target picker (below) follows the
              same compact style. */}
          {subAction === 'branch' && (() => {
            const grammarN     = parseList(grammarRow.inputs).length;
            const minN         = grammarN <= 1 ? 1 : 2;
            const maxN         = retryEnabled ? 2 : 3;
            const current      = branchCount ?? Math.max(grammarN, 2);
            const retryBlocked = current >= 3;
            const step = (delta) => {
              const next = Math.max(minN, Math.min(maxN, current + delta));
              setBranchCount(next);
            };
            return (
              <>
                {/* Number of branches — single line, stepper on the right */}
                <div
                  style={{
                    marginTop: 6,
                    padding: '5px 10px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  title="Number of outgoing branches (Retry exit is separate)"
                >
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#475569' }}>
                    Number of branches
                  </span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={() => step(-1)}
                      disabled={current <= minN}
                      style={stepperBtn(current <= minN)}
                      title="Remove one branch"
                    >
                      −
                    </button>
                    <span style={{
                      fontSize: 13, fontWeight: 700, minWidth: 16, textAlign: 'center',
                      color: '#0f172a',
                    }}>
                      {current}
                    </span>
                    <button
                      onClick={() => step(1)}
                      disabled={current >= maxN}
                      style={stepperBtn(current >= maxN)}
                      title="Add one branch"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Retry — single line checkbox row, matches Log style */}
                <div
                  style={{
                    marginTop: 6,
                    padding: '5px 10px',
                    background: retryEnabled ? '#fef3c7' : '#f8fafc',
                    border: `1px solid ${retryEnabled ? '#f59e0b' : '#e2e8f0'}`,
                    borderRadius: 6,
                    opacity: retryBlocked ? 0.5 : 1,
                  }}
                  title={retryBlocked
                    ? "Drop branch count to 2 to enable retry — only 3 source handles available."
                    : "Adds an extra exit on the bottom of the node, labeled Retry."}
                >
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: retryBlocked ? 'not-allowed' : 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={retryEnabled}
                      disabled={retryBlocked}
                      onChange={(e) => setRetryEnabled(e.target.checked)}
                      style={{ cursor: retryBlocked ? 'not-allowed' : 'pointer' }}
                    />
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: retryEnabled ? '#92400e' : '#475569',
                    }}>
                      Add Retry exit (bottom)
                    </span>
                  </label>
                </div>
              </>
            );
          })()}

          {/* Log-target picker — Check & Continue and Check & Branch. Both
              "checks" record their observed value to a Part Tracking field by
              default. The toggle lets the user opt out (rare — usually you
              want the log). When enabled, picks an existing PT field or
              creates a new one inline. */}
          {(subAction === 'check' || subAction === 'branch') && (
            <LogTargetPicker
              ptEnabled={ptEnabled}
              setPtEnabled={setPtEnabled}
              ptFieldId={ptFieldId}
              setPtFieldId={setPtFieldId}
              ptFieldName={ptFieldName}
              setPtFieldName={setPtFieldName}
              defaultName={`${subject?.name || 'Result'}_Check`}
            />
          )}
        </>
      )}

      {/* Footer — terminal-state chips inline with Done.
          Clicking ✓ Cycle Complete or ⚠ Fault marks this state as terminal
          (skipping the normal action flow). Click again to deselect; the
          two are mutually exclusive. Chips push left, Done stays right.
          Click-outside the picker closes it, so no explicit Cancel button. */}
      <div style={footerRow}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginRight: 'auto' }}>
          <button
            onClick={() => setTerminalType(t => t === 'complete' ? null : 'complete')}
            style={terminalChip(terminalType === 'complete', '#16a34a')}
            title="Mark this state as Cycle Complete (terminal end-of-cycle)"
          >
            ✓ Cycle Complete
          </button>
          <button
            onClick={() => setTerminalType(t => t === 'fault' ? null : 'fault')}
            style={terminalChip(terminalType === 'fault', '#dc2626')}
            title="Mark this state as a Fault (terminal error)"
          >
            ⚠ Fault
          </button>
        </div>
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          style={btnPrimary(canCommit)}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function ModeBtn({ label, active, onClick, blurb, color }) {
  return (
    <button onClick={onClick} style={modeBtnStyle(active, color)}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 1 }}>{blurb}</div>
    </button>
  );
}

// Stepper button style — used for the branch-count +/- controls.
function terminalChip(active, color) {
  return {
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 12,
    border: `1px solid ${color}`,
    background: active ? color : '#fff',
    color: active ? '#fff' : color,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

function stepperBtn(disabled) {
  return {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: '1px solid #cbd5e1',
    background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#cbd5e1' : '#0f172a',
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: 0,
    lineHeight: 1,
  };
}

// Log-target picker — toggle + dropdown (existing PT fields, or create new).
// Renders inline inside the picker for Check & Continue / Check & Branch.
//   - Toggle "Log result to PT field" (default ON)
//   - When ON: dropdown of project's PT fields, plus "+ New field" entry
//   - "+ New field" reveals a text input pre-seeded with `defaultName`
//   - The actual PT field is created on commit by the StateNode caller (this
//     keeps the picker free of side effects until the user clicks "Use this")
function LogTargetPicker({
  ptEnabled, setPtEnabled,
  ptFieldId, setPtFieldId,
  ptFieldName, setPtFieldName,
  defaultName,
}) {
  const ptFields = useDiagramStore(s => s.project?.partTracking?.fields ?? []);
  const isCreatingNew = ptEnabled && !ptFieldId && !!ptFieldName;

  return (
    <div
      style={{
        marginTop: 6,
        padding: '5px 10px',
        background: ptEnabled ? '#ecfdf5' : '#f8fafc',
        border: `1px solid ${ptEnabled ? '#10b981' : '#e2e8f0'}`,
        borderRadius: 6,
      }}
      title="Records the observed value to a Part Tracking field for later analysis."
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={ptEnabled}
          onChange={(e) => setPtEnabled(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: ptEnabled ? '#065f46' : '#475569' }}>
          Log result to PT field
        </span>
      </label>

      {ptEnabled && (
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isCreatingNew ? (
            <select
              value={ptFieldId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__new__') {
                  setPtFieldId(null);
                  setPtFieldName(defaultName);
                } else if (v === '') {
                  setPtFieldId(null);
                  setPtFieldName('');
                } else {
                  const f = ptFields.find(x => x.id === v);
                  if (f) {
                    setPtFieldId(f.id);
                    setPtFieldName(f.name);
                  }
                }
              }}
              style={{
                flex: 1,
                fontSize: 11,
                padding: '3px 4px',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="">— pick existing field —</option>
              {ptFields.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
              <option value="__new__">+ New field…</option>
            </select>
          ) : (
            <>
              <input
                type="text"
                value={ptFieldName}
                onChange={(e) => setPtFieldName(e.target.value)}
                placeholder={defaultName}
                style={{
                  flex: 1,
                  fontSize: 11,
                  padding: '3px 6px',
                  border: '1px solid #10b981',
                  borderRadius: 4,
                  background: '#fff',
                }}
                autoFocus
              />
              <button
                onClick={() => { setPtFieldId(null); setPtFieldName(''); }}
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#475569',
                }}
                title="Cancel new field"
              >
                ↶
              </button>
            </>
          )}
        </div>
      )}

      {ptEnabled && isCreatingNew && (
        <div style={{ fontSize: 9, color: '#10b981', marginTop: 3, fontStyle: 'italic' }}>
          New field will be created on save.
        </div>
      )}
    </div>
  );
}

function SubActionBtn({ id, label, tagline, icon, active, onClick }) {
  // Topology icon — same SVG used on the canvas action pill so the picker
  // and the resulting node look consistent. Color follows the button text
  // (white when active, slate when inactive).
  const iconColor = active ? '#fff' : '#475569';
  const iconNode  = icon === 'continue' ? <CheckContinueIcon size={18} color={iconColor} />
                  : icon === 'branch'   ? <CheckBranchIcon   size={26} color={iconColor} />
                  : null;
  return (
    <button onClick={onClick} style={subActionBtnStyle(active)}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'flex-start',
      }}>
        {iconNode && (
          <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            {iconNode}
          </span>
        )}
        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>{label}</div>
      </div>
      <div style={{ fontSize: 9, color: active ? '#cbd5e1' : '#64748b', marginTop: 2 }}>
        {tagline}
      </div>
    </button>
  );
}

function SectionTitle({ children }) {
  return <div style={sectionTitleStyle}>{children}</div>;
}

function Pill({ children, color, outlined }) {
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
      background: outlined ? '#fff' : color,
      color:      outlined ? color  : '#fff',
      border:     outlined ? `1.5px solid ${color}` : 'none',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Sep() {
  return <span style={{ color: '#cbd5e1', fontWeight: 700 }}>/</span>;
}

function EdgePreview({ info, mode, subAction }) {
  const tag = mode === 'action'
    ? 'Action'
    : (subAction.charAt(0).toUpperCase() + subAction.slice(1));

  return (
    <div style={edgePreviewBox}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: '#0f172a' }}>{tag} node</span>
        {' → '}
        <span>
          {info.topology} outgoing edge{info.topology !== 1 ? 's' : ''}
        </span>
      </div>
      {info.labels.length === 0 ? (
        <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>
          (single advance · unlabeled edge)
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {info.labels.map((lab, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#cbd5e1' }}>──</span>
              <span style={{
                padding: '1px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                background: i === 0 ? '#16a34a' : '#dc2626', color: '#fff',
              }}>{lab}</span>
              <span style={{ color: '#cbd5e1' }}>──→ next state</span>
              {i === 0 && info.labels.length > 1 && (
                <span style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic' }}>
                  (primary / left)
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Style helpers ────────────────────────────────────────────────────────

function modeAccent(mode, sub) {
  if (mode === 'action') return '#0072B5';
  if (sub === 'branch')  return '#16a34a';
  if (sub === 'check')   return '#0891b2';
  return '#7c3aed'; // wait
}

const pickerWrap = {
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: 10,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  // ~1.5x the standard state-node width (240px) so the popup stays visually
  // tight against the node it's anchored to.
  width: 360,
  maxWidth: 360,
  boxSizing: 'border-box',
};

const sectionRow = {
  display: 'flex', gap: 8, alignItems: 'stretch',
};

const subjectGrid = {
  maxHeight: 240,
  overflow: 'auto',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  padding: 4,
  background: '#fafbfc',
};

const catHeader = {
  fontSize: 9, fontWeight: 700, color: '#fff',
  padding: '2px 8px', textTransform: 'uppercase',
  letterSpacing: '0.04em', borderRadius: 3,
};

const chipRow = {
  display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2,
};

const pillRow = {
  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
  padding: '6px 8px', background: '#f8fafc', border: '1px solid #e2e8f0',
  borderRadius: 4,
};

const detailRow = {
  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
};

const detailLabel = {
  minWidth: 110, fontSize: 11, color: '#475569', fontWeight: 600,
};

const detailInput = {
  flex: 1, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit',
  border: '1px solid #cbd5e1', borderRadius: 4, color: '#0f172a',
  outline: 'none',
};

const readOnlyTag = {
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 10px', fontSize: 11, fontWeight: 600,
  color: '#0f172a', background: '#f1f5f9',
  border: '1px dashed #94a3b8', borderRadius: 12,
  cursor: 'default', userSelect: 'none',
};

const sectionTitleStyle = {
  fontSize: 10, fontWeight: 700, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  marginTop: 10, marginBottom: 4, borderBottom: '1px solid #e2e8f0',
  paddingBottom: 2,
};

const hintText = {
  fontSize: 10, color: '#64748b', fontStyle: 'italic',
  padding: '4px 0', lineHeight: 1.4,
};

const emptyHint = {
  fontSize: 11, color: '#94a3b8', fontStyle: 'italic',
  padding: '8px 10px', background: '#fafbfc',
  border: '1px dashed #e2e8f0', borderRadius: 4,
};

const edgePreviewBox = {
  padding: 8, background: '#f8fafc', border: '1px solid #e2e8f0',
  borderRadius: 4, fontSize: 11, color: '#475569',
};

const footerRow = {
  marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end',
};

function modeBtnStyle(active, color) {
  return {
    flex: 1, padding: '8px 12px', borderRadius: 4,
    background: active ? color : '#fff',
    color:      active ? '#fff' : color,
    border: `2px solid ${color}`,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    transition: 'all .15s',
  };
}

function subActionBtnStyle(active) {
  return {
    flex: 1, padding: '6px 10px', borderRadius: 4,
    background: active ? '#1e293b' : '#fff',
    color:      active ? '#fff'    : '#0f172a',
    border: `1px solid ${active ? '#1e293b' : '#cbd5e1'}`,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    transition: 'all .15s',
    ...(active ? SELECTION_OUTLINE : {}),
  };
}

// Shared selection indicator — strong dark ring around any selected chip.
// Use `outline` so it sits OUTSIDE the chip (no layout shift from added
// border width) and combines cleanly with each chip type's existing styling.
const SELECTION_OUTLINE = {
  outline: '3px solid #0f172a',
  outlineOffset: '2px',
};

function subjectChip(active, color) {
  // Selected: white bg, bold text, strong dark outline halo.
  // Inactive: normal chip with thin gray border.
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 8px', fontSize: 11,
    fontWeight: active ? 700 : 600,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#0f172a',
    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all .12s',
    ...(active ? SELECTION_OUTLINE : {}),
  };
}

function pickChip(active, color) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 700,
    border: `1.5px solid ${color}`,
    background: active ? color : '#fff',
    color:      active ? '#fff' : color,
    borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all .12s',
    // Same strong dark ring as subject chip when this chip is selected.
    // Sits outside the chip's coloured border so the semantic colour
    // (green pass / red fail / blue action) still reads.
    ...(active ? SELECTION_OUTLINE : {}),
  };
}

function btnPrimary(enabled) {
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 700,
    background: enabled ? '#0072B5' : '#cbd5e1',
    color: '#fff', border: 'none', borderRadius: 4,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit',
  };
}

const btnSecondary = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1',
  borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
};
