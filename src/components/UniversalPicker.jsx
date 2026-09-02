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
import { GRAMMAR_CATEGORIES, loadGrammar, parseDetailField, GRAMMAR_TO_DEVICE_TYPE } from '../lib/pickerGrammar.js';
import { getDigitalIoPoints } from '../lib/getProjectIoMap.js';
import { DeviceIcon, CheckContinueIcon, CheckBranchIcon } from './DeviceIcons.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { isV3Shell } from '../lib/shellFlags.js';

// Map grammar row id → DeviceIcon type so the subject buttons can render
// the same SVG icons used elsewhere in the app. Keeps visual identity
// consistent between the picker, the device sidebar, and the canvas.
// Exported so on-node action rows (PickerV2ActionRow) can reuse it.
// GRAMMAR_TO_DEVICE_TYPE moved to src/lib/pickerGrammar.js so the picker
// file is component-only and React Fast Refresh hot-swaps cleanly. Mixing
// non-component exports here invalidates HMR and forces a full page reload
// on every edit, which makes development confusing — your "fix is live"
// claim is wrong because the browser is still running the previous bundle.

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
  // ADD-mode pre-fill. When set (and editAction is not), the picker uses this
  // as the seed for initial state but stays in ADD mode (commit goes through
  // addAction, isEdit=false). Used by the vision-pair flow: the parent state
  // node pre-fills mode='decision', subjectId={cam}, detail['Job name']={job}
  // so the user lands on the decision step with the camera/job already chosen.
  seedConfig = null,
  // Banner copy shown above the mode toggle when set. Lets the parent node
  // tell the user what this picker invocation is FOR — e.g. "Step 2 of vision
  // node — pick what to do with the result".
  contextBanner = null,
}) {
  const grammarRows = useMemo(() => grammar || loadGrammar(), [grammar]);
  const subjectList = subjects || [];

  // Index grammar by id for fast lookup
  const grammarById = useMemo(() => {
    const m = {};
    grammarRows.forEach(r => { m[r.id] = r; });
    return m;
  }, [grammarRows]);

  // Seed initial state from editAction.pickerConfig (edit mode) or seedConfig
  // (add mode pre-fill). Falls back to default empty picks for fresh-add mode.
  const seed = editAction?.pickerConfig || seedConfig || null;
  // v3.4 — exitCount stepper at the top is now the SINGLE source of truth
  // for how many outgoing branches the action has. The legacy `branchCount`
  // field is read on migration but no longer maintained as state. Retry
  // is a label/semantic flag for the LAST exit; it doesn't add an extra
  // exit on top of exitCount anymore.
  const [mode, setMode]               = useState(seed?.mode || initialMode);
  // v3.3 — unified Decision model. Sub-action is now DERIVED from two
  // independent fields: blockUntilTrue (Wait vs Check) and exitCount
  // (1 = single forward, 2+ = branch). This is the user-asked-for
  // unification: "what subject are you using? how many ways out?" rather
  // than picking from three named modes.
  // Migration: legacy seed.subAction maps cleanly to the new fields.
  //   wait   → block=Y, exits=1
  //   check  → block=N, exits=1
  //   branch → block=N, exits=branchCount||2
  const [blockUntilTrue, setBlockUntilTrue] = useState(() => {
    if (typeof seed?.blockUntilTrue === 'boolean') return seed.blockUntilTrue;
    return (seed?.subAction || 'wait') === 'wait';
  });
  const [exitCount, setExitCount] = useState(() => {
    if (typeof seed?.exitCount === 'number') return seed.exitCount;
    const sa = seed?.subAction || 'wait';
    if (sa === 'branch') return seed?.branchCount || 2;
    return 1;
  });
  // Derived sub-action — keeps the rest of the picker logic + L5X exporter
  // compatible. Branch mode is anything with 2+ exits regardless of block;
  // wait is the only 1-exit "block" combo; check is 1-exit "sample now."
  const subAction = (() => {
    if (mode !== 'decision') return null;
    if (exitCount >= 2) return 'branch';
    if (blockUntilTrue) return 'wait';
    return 'check';
  })();
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
  // Max retries before the state faults / gives up. Stored alongside
  // retryEnabled so the rung that increments + tests the retry counter
  // has a concrete bound at L5X-export time. Default 3 — adjustable per
  // state. Only meaningful when retryEnabled is true.
  const [retryCount, setRetryCount] = useState(Number(seed?.retryCount ?? 3));

  // Log target — Check & Continue and Check & Branch can write the observed
  // value to Part-Tracking (PT) fields. The PRIMARY log is whatever you just
  // checked (the picked Condition) — there's nothing to choose, the system
  // logs that automatically. Some subjects also expose EXTRA values worth
  // logging alongside (e.g. an analog probe can also log Actual Position
  // beyond the in-tol/out-of-tol verdict). Those render as "Also log:"
  // checkboxes; ptExtraLogs holds the user's selected extras by name.
  // Default: ON for Check & Continue (set by handleSubActionChange), OFF
  // otherwise. PT fields are auto-created on commit by the StateNode
  // caller — names are derived, not user-typed.
  const [ptEnabled,    setPtEnabled]    = useState(seed?.ptEnabled    ?? false);
  const [ptExtraLogs,  setPtExtraLogs]  = useState(seed?.ptExtraLogs  ?? []);
  // v2.3 — Custom user-typed log fields. Replaces the rigid auto-primary
  // ("log subject name") + preset extras model with a free-form list.
  // Shape: [{ name: 'RotationAngle', dataType: 'REAL' }, ...]
  const [ptCustomLogs, setPtCustomLogs] = useState(seed?.ptCustomLogs ?? []);

  // Terminal-state shortcut — instead of picking an action, the user can
  // mark THIS state as Cycle Complete (✓) or Fault (⚠). Selecting one
  // grays out the rest of the picker; on commit, the StateNode caller
  // sets `data.isComplete` or `data.isFault` on the node and skips the
  // addAction step. null = normal action/decision flow.
  const [terminalType, setTerminalType] = useState(null);

  // Cross-SM signal: an explicit reference to a signal from a different
  // SM's device. Hidden behind a "+ From another SM…" chip in the SIGNAL
  // category — rare flow, kept compact. When set, it replaces normal
  // subject selection: the picker treats it as a binary signal subject
  // (On/Off conditions), commit emits the ref under `crossSmRef`.
  const [crossSmRef, setCrossSmRef] = useState(seed?.crossSmRef || null);
  // Raw I/O point reference — Decision mode only. Same shape pattern as
  // crossSmRef: when set, picker treats it as a virtual signal subject.
  // L5X export resolves directly to the raw tag (e.g. q_ExtendCyl). Lets
  // engineers decide off ANY tag in the I/O map, not just sensor inputs.
  const [ioRef, setIoRef] = useState(seed?.ioRef || null);
  const [ioDrawerOpen, setIoDrawerOpen] = useState(false);
  const [crossSmDrawerOpen, setCrossSmDrawerOpen] = useState(false);
  const [crossSmDraft, setCrossSmDraft] = useState(
    seed?.crossSmRef
      ? { smId: seed.crossSmRef.smId, deviceId: seed.crossSmRef.deviceId, signalId: seed.crossSmRef.signalId }
      : { smId: '', deviceId: '', signalId: '' }
  );
  const allSMs = useDiagramStore(s => s.project?.stateMachines ?? []);

  // Branch count — Check & Branch can have 2 to 5 outgoing edges. Default is
  // derived from the grammar's INPUTS list (e.g., digital sensor = 2 for On/Off,
  // analog with 3-way classification = 3). User can increment / decrement
  // within [2, 5]. Extra branches beyond grammar.inputs.length get auto-labels
  // like "Branch 4", "Branch 5" — editable per-edge after creation.
  // v3.4 — branchCount removed; exitCount is the single source. Keep
  // a no-op placeholder so any straggling references don't crash before
  // the next pass cleans them up.
  const branchCount = null;
  // v3.4.1 — per-exit custom labels. Sparse array indexed by exit position;
  // entries default to undefined (use grammar input fallback). User can
  // rename any exit; rename persists on `edgeLabels` so the spawn + edges
  // pick it up. Seed from existing edgeLabels so re-opening a row shows
  // the names the user already set.
  const [customLabels, setCustomLabels] = useState(() => {
    const seeded = seed?.edgeLabels;
    return Array.isArray(seeded) ? [...seeded] : [];
  });

  // The currently selected subject instance + its grammar row.
  // When `crossSmRef` is set, synthesize a virtual subject so the rest
  // of the picker (condition, branch labels, log target, etc.) treats
  // it like a normal binary signal pick.
  const subject = useMemo(() => {
    if (crossSmRef) {
      return {
        id: '__crossSm__',
        name: crossSmRef.signalName || 'Cross-SM signal',
        grammarRowId: 'signal',
      };
    }
    if (ioRef) {
      return {
        id: '__ioRef__',
        name: ioRef.tagName || 'I/O point',
        grammarRowId: 'signal',
      };
    }
    return subjectList.find(s => s.id === subjectId) || null;
  }, [subjectList, subjectId, crossSmRef, ioRef]);
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

  // v3.3 — sub-action no longer user-pickable; derived from blockUntilTrue
  // + exitCount above. These helpers mutate the new fields. Auto-enable log
  // when transitioning into "Check & Continue" (block=N, exits=1) since
  // that's specifically the "observe + record" mode.
  function setBlock(next) {
    setBlockUntilTrue(next);
    if (grammarRow && !condition) {
      setCondition(parseList(grammarRow.inputs)[0] || null);
    }
    // Going from blocking → sampling with single exit = Check & Continue
    // (the whole point is to log + advance). Auto-enable PT.
    if (!next && exitCount === 1) setPtEnabled(true);
  }
  function setExits(next) {
    // v3.4 — clamp 1..3 (current handle availability: exit-pass = bottom,
    // exit-fail = right, exit-retry = left). 4+ would require additional
    // handles which haven't been laid out yet.
    const clamped = Math.max(1, Math.min(3, next));
    setExitCount(clamped);
    if (grammarRow && !condition) {
      setCondition(parseList(grammarRow.inputs)[0] || null);
    }
    // Adding a second exit while in Check mode = Check & Branch.
    // Don't auto-enable log here (Branch labels carry outcome on edges).
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
    // v3.4 — labels driven by `exitCount` (the top stepper) + user-typed
    // customLabels[i] overrides. Fallback chain per exit i:
    //   customLabels[i]  (user explicitly named it)
    //   grammar input    (e.g. "On", "Off", "InTol")
    //   "Branch N"       (generic fallback)
    // Retry: when enabled, the LAST exit's label is forced to "Retry"
    // UNLESS the user has typed a custom label for that position.
    const inputs = parseList(grammarRow.inputs);
    const orderedInputs = condition
      ? [condition, ...inputs.filter(s => s !== condition)]
      : inputs;
    const count = Math.max(2, Math.min(3, exitCount));  // clamped to available handle count
    const labels = [];
    for (let i = 0; i < count; i++) {
      const custom  = customLabels[i];
      const grammar = orderedInputs[i];
      const fallback = `Branch ${i + 1}`;
      labels.push((custom && custom.trim()) || grammar || fallback);
    }
    if (retryEnabled && labels.length > 0) {
      const lastIdx = labels.length - 1;
      // Only override with "Retry" if user hasn't typed a custom label
      if (!(customLabels[lastIdx] && customLabels[lastIdx].trim())) {
        labels[lastIdx] = 'Retry';
      }
    }
    return { topology: labels.length, labels };
  }, [grammarRow, mode, subAction, condition, retryEnabled, exitCount, customLabels]);

  // Terminal-state path commits standalone — no subject/condition needed.
  const canCommit = !!terminalType || mode === 'describe' || (
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
        terminalType,           // 'complete' | 'fault' | 'initialize' (v3)
        isEdit: !!editAction,
        editActionId: editAction?.id ?? null,
      });
      return;
    }
    if (mode === 'describe') {
      onPick && onPick({ describe: true, isEdit: !!editAction, editActionId: editAction?.id ?? null });
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
    // mode never logs (it just blocks); Action mode has no "result" to log.
    // The PRIMARY log target is the picked condition itself — auto-derived,
    // not user-typed. EXTRA log targets come from grammarRow.logExtras and
    // are stored by name in `ptExtraLogs`. The StateNode commit handler
    // auto-creates one PT field per active log target (primary + extras).
    const isCheck = mode === 'decision' && (subAction === 'check' || subAction === 'branch');
    const validExtras = parseList(grammarRow.logExtras);
    const filteredExtras = (ptExtraLogs ?? []).filter(x => validExtras.includes(x));
    onPick && onPick({
      mode,
      subAction:    mode === 'decision' ? subAction : null,
      // v3.3 unified Decision fields. Stored alongside the derived
      // subAction so future logic can read them directly without needing
      // to re-derive. Migration on re-open uses these first.
      blockUntilTrue: mode === 'decision' ? blockUntilTrue : null,
      exitCount:    mode === 'decision' ? exitCount : null,
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
      retryCount:   subAction === 'branch' && retryEnabled ? retryCount : null,
      // Log target — only for check / branch. Primary log = the picked
      // condition (auto). Extras = user-checked items from logExtras.
      ptEnabled:    isCheck ? ptEnabled : false,
      ptExtraLogs:  isCheck && ptEnabled ? filteredExtras : [],
      ptCustomLogs: isCheck && ptEnabled ? (ptCustomLogs ?? []) : [],
      // Branch count override (for Check & Branch only). Stored so re-opening
      // the picker preserves the user's chosen N.
      branchCount:  subAction === 'branch' ? (branchCount ?? null) : null,
      // Cross-SM signal reference (rare flow). When set, this signal
      // lives on a different SM's device — the L5X exporter should
      // resolve it as a cross-SM tag reference. Stored alongside the
      // normal pickerConfig so re-opening the picker re-shows it.
      crossSmRef:   crossSmRef || null,
      // Raw I/O point reference. When set, the L5X exporter resolves the
      // decision condition to read directly from `ioRef.tagName`
      // (e.g. q_ExtendVerticalCylinder) instead of a device-derived sensor.
      ioRef:        ioRef || null,
      // True when the picker was opened to edit an existing action.
      // The caller uses this to choose updateAction vs addAction.
      isEdit:       !!editAction,
      // v2.3 — also include the action id directly in the payload. This
      // makes StateNode's commit handler immune to any race in its own
      // editingActionId state — if we got here from an edit, this id
      // identifies WHICH action to update. Without this, transient state
      // clears (e.g. node deselect → setEditingActionId(null)) cause edits
      // to fall through to addAction, producing duplicate rows.
      editActionId: editAction?.id ?? null,
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const accentColor = modeAccent(mode, subAction);
  const noSubjects = subjectList.length === 0;

  return (
    <div
      className="nowheel nodrag"
      style={pickerWrap}
    >
      {/* Context banner — set by the parent node when this picker invocation
          is part of a multi-step flow (e.g. step 2 of a vision pair). Tells
          the user what they're picking FOR before they see the mode toggle. */}
      {contextBanner && (
        <div style={{
          background: '#fef3c7',
          color: '#92400e',
          border: '1px solid #fcd34d',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 8,
        }}>
          {contextBanner}
        </div>
      )}
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
        {isV3Shell() && (
          // DESCRIBE (Dan, 2026-09-02): say the intent in plain words instead
          // of drawing logic — the SDC Engineer implements it at build time.
          <ModeBtn
            label="Describe"
            active={mode === 'describe'}
            onClick={() => handleModeChange('describe')}
            blurb="Say it in your words"
            color="#b45309"
          />
        )}
      </div>

      {/* Decision controls (v3.3) — left-aligned, two rows.
          Row 1: Wait / Check segmented toggle (Wait blocks until condition
                 is true; Check samples the value now and advances).
          Row 2: Number of exits stepper (1 = single forward; 2+ = branch). */}
      {mode === 'decision' && (
        <div style={{
          marginTop: 6, padding: '8px 10px',
          background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8,
          alignItems: 'flex-start',
        }}>
          {/* Wait / Check segmented toggle */}
          <div style={{ display: 'inline-flex', gap: 0, border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
            {[
              { value: true,  label: 'Wait',  tip: 'Block this state until the condition becomes true, then advance' },
              { value: false, label: 'Check', tip: 'Sample the condition value now; advance/branch on whatever it reads' },
            ].map(opt => {
              const active = blockUntilTrue === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setBlock(opt.value)}
                  title={opt.tip}
                  style={{
                    padding: '5px 14px',
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                    background: active ? '#7c3aed' : '#fff',
                    color: active ? '#fff' : '#475569',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Number of exits stepper */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#475569' }}>
            <span>Number of exits:</span>
            <button
              type="button"
              onClick={() => setExits(exitCount - 1)}
              disabled={exitCount <= 1}
              style={{
                width: 24, height: 24, padding: 0,
                fontSize: 15, fontWeight: 700,
                background: '#fff', color: exitCount <= 1 ? '#cbd5e1' : '#475569',
                border: '1px solid #cbd5e1', borderRadius: 4,
                cursor: exitCount <= 1 ? 'not-allowed' : 'pointer',
              }}
            >−</button>
            <span style={{
              minWidth: 24, textAlign: 'center',
              fontSize: 13, fontWeight: 700, color: '#0f172a',
            }}>{exitCount}</span>
            <button
              type="button"
              onClick={() => setExits(exitCount + 1)}
              disabled={exitCount >= 3}
              style={{
                width: 24, height: 24, padding: 0,
                fontSize: 15, fontWeight: 700,
                background: '#fff', color: exitCount >= 3 ? '#cbd5e1' : '#475569',
                border: '1px solid #cbd5e1', borderRadius: 4,
                cursor: exitCount >= 3 ? 'not-allowed' : 'pointer',
              }}
            >+</button>
          </div>
          {/* v3.4.1 — per-exit label rename. Only shows when exits >= 2
              (single-exit branches don't need a label). Each row shows
              the handle direction (↓ bottom / → right / ← left) and an
              editable input pre-filled with the live label (grammar
              default or user override). Empty input falls back to
              grammar / "Branch N". */}
          {exitCount >= 2 && edgeInfo.labels.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, width: '100%' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
                EXIT LABELS
              </div>
              {edgeInfo.labels.map((label, i) => {
                const arrow = i === 0 ? '↓' : i === 1 ? '→' : '←';
                const position = i === 0 ? 'bottom' : i === 1 ? 'right' : 'left';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 16, fontSize: 13, fontWeight: 700, color: '#0f172a',
                      textAlign: 'center', lineHeight: 1,
                    }} title={position}>{arrow}</span>
                    <input
                      type="text"
                      value={customLabels[i] ?? label}
                      onChange={(e) => {
                        const next = [...customLabels];
                        next[i] = e.target.value;
                        setCustomLabels(next);
                      }}
                      placeholder={label}
                      style={{
                        flex: 1, padding: '3px 6px',
                        fontSize: 11, fontFamily: 'inherit',
                        border: '1px solid #cbd5e1', borderRadius: 4,
                        background: '#fff',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
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
            // Always render the signals section so the "+ From another SM…"
            // chip is reachable even when the project has no project-level
            // signals defined yet.
            if (subs.length === 0 && cat.id !== 'signals') return null;
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
                {/* Cross-SM signal chip + drawer — only inside the signals
                    section. Hidden behind a single "From another SM…" chip
                    until clicked, so the common case stays uncluttered. */}
                {cat.id === 'signals' && (
                  <CrossSmSignalRow
                    allSMs={allSMs}
                    crossSmRef={crossSmRef}
                    setCrossSmRef={(ref) => {
                      setCrossSmRef(ref);
                      if (ref) {
                        // Clear the regular subject pick so the picker uses
                        // the virtual cross-SM subject instead.
                        setSubjectId(null);
                        setActionVerb(null);
                        if (mode === 'decision') setCondition('On');
                      }
                    }}
                    drawerOpen={crossSmDrawerOpen}
                    setDrawerOpen={setCrossSmDrawerOpen}
                    draft={crossSmDraft}
                    setDraft={setCrossSmDraft}
                  />
                )}
                {/* Raw I/O point chip + drawer — visible in BOTH Action and
                    Decision modes (was decision-only). In Action mode this
                    means "directly drive this output" (OTL / OTU on commit);
                    in Decision mode it means "decide based on this tag's
                    value". Either way you're working with a tag straight
                    out of the project's I/O map. */}
                {cat.id === 'signals' && (
                  <RawIoPointRow
                    project={allSMs.length > 0 ? { stateMachines: allSMs } : null}
                    ioRef={ioRef}
                    setIoRef={(ref) => {
                      setIoRef(ref);
                      if (ref) {
                        setSubjectId(null);
                        setActionVerb(null);
                        setCrossSmRef(null);
                        if (mode === 'decision') setCondition('On');
                      }
                    }}
                    drawerOpen={ioDrawerOpen}
                    setDrawerOpen={setIoDrawerOpen}
                  />
                )}
              </div>
            );
          })}
          {visibleSubjects.length === 0 && !crossSmRef && (
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

          {/* v3.4 — duplicate "Number of branches" stepper removed.
              The TOP stepper ("Number of exits") is now the single source
              of truth — it drives the spawn fan-out count directly via
              edgeInfo.topology. Retry remains as a label/semantic flag
              for the LAST exit (when enabled, the last exit reads
              "Retry" and retryCount applies). */}
          {subAction === 'branch' && (() => {
            const retryBlocked = false;  // no longer blocked by branch count
            return (
              <>
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
                  {/* Retry count — bounds the retry counter for L5X export
                      and shows on the state node below the action row, so
                      engineers see at a glance how many attempts before the
                      retry path is taken. Only renders when retry is on. */}
                  {retryEnabled && (
                    <div style={{
                      marginTop: 6, display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: '#92400e',
                    }}>
                      <span style={{ fontWeight: 600 }}>Max retries:</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={retryCount}
                        onChange={(e) => setRetryCount(
                          Math.max(1, Math.min(99, Number(e.target.value) || 1))
                        )}
                        style={{
                          width: 50,
                          fontSize: 11, fontWeight: 700,
                          padding: '2px 6px',
                          border: '1px solid #f59e0b',
                          borderRadius: 4,
                          background: '#fff',
                          color: '#92400e',
                        }}
                      />
                      <span style={{ fontStyle: 'italic', color: '#a16207' }}>
                        before fault / take retry path
                      </span>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Log-target picker — Check & Continue / Check & Branch.
              v2.3 redesign: free-text custom field list. User types each
              field they want to log (e.g. RotationAngle, PositionX) with
              a dataType selector. No auto-primary — Pass/Fail of a branch
              is already on the edge label, so re-logging it is noise.
              Branch sub-action also keeps the toggle off-by-default for
              the same reason — most branches just decide flow, no logging
              needed. User must explicitly turn it on AND add field names. */}
          {(subAction === 'check' || subAction === 'branch') && (
            <LogTargetPicker
              ptEnabled={ptEnabled}
              setPtEnabled={setPtEnabled}
              ptCustomLogs={ptCustomLogs}
              setPtCustomLogs={setPtCustomLogs}
              subjectName={subject?.name}
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
          {isV3Shell() && (
            <button
              onClick={() => setTerminalType(t => t === 'initialize' ? null : 'initialize')}
              style={terminalChip(terminalType === 'initialize', '#1d4ed8')}
              title="Mark this state as → Initialize: the machine runs its initialization (init block, state 100). A Check whose retry count is met lands here implicitly."
            >
              → Initialize
            </button>
          )}
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

// Log-target picker — fully manual, free-text custom fields.
//
// Per user feedback: subjects vary too widely to pre-define what to log.
// Pass/Fail of a branch is already on the edge label — re-logging it adds
// nothing. The useful logs are values the user wants to capture for trend
// analysis (rotation angle, position X, score, force reading, etc).
//
// Layout:
//   master toggle:           "Log values to Part Tracking"
//   field-list:              [ name input ] [ type select ] [ + Add ]
//                            ──────────────────────────────────────
//                            • RotationAngle (REAL)  ✕
//                            • PositionX     (REAL)  ✕
//
// Field name shown to user = bare typed name (e.g. "RotationAngle").
// Stored field name = `{Subject}_{typed}` (e.g. "Cam1_RotationAngle") to
// keep the PT field list namespaced and avoid collisions across subjects.
// Stored as `pickerConfig.ptCustomLogs = [{ name, dataType }, ...]`.
function LogTargetPicker({
  ptEnabled, setPtEnabled,
  ptCustomLogs, setPtCustomLogs,
  subjectName,
}) {
  const [draftName, setDraftName] = useState('');
  const [draftType, setDraftType] = useState('REAL');
  const list = Array.isArray(ptCustomLogs) ? ptCustomLogs : [];
  const stripName = (s) => String(s).trim().replace(/[^A-Za-z0-9_]/g, '');

  const addEntry = () => {
    const name = stripName(draftName);
    if (!name) return;
    if (list.some(e => e.name === name)) return;
    setPtCustomLogs([...list, { name, dataType: draftType }]);
    setDraftName('');
  };
  const removeEntry = (name) => {
    setPtCustomLogs(list.filter(e => e.name !== name));
  };
  const updateType = (name, dataType) => {
    setPtCustomLogs(list.map(e => e.name === name ? { ...e, dataType } : e));
  };

  return (
    <div
      style={{
        marginTop: 6,
        padding: '5px 10px',
        background: ptEnabled ? '#ecfdf5' : '#f8fafc',
        border: `1px solid ${ptEnabled ? '#10b981' : '#e2e8f0'}`,
        borderRadius: 6,
      }}
      title="Capture custom values to Part Tracking fields for trend / outcome analysis."
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={ptEnabled}
          onChange={(e) => setPtEnabled(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: ptEnabled ? '#065f46' : '#475569' }}>
          Log values to Part Tracking
        </span>
      </label>

      {ptEnabled && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {/* Hint — clarifies what the field name will look like in PT. */}
          <div style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic' }}>
            Stored field name: <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3 }}>
              {(subjectName || 'Subject') + '_<your name>'}
            </code>
          </div>

          {/* Quick "+ Log Result" preset chip. Adds a {Subject}_Result
              BOOL field in one click — the field stores the ACTUAL
              outcome of the check (true = passed, false = failed). Named
              "_Result" (not "_Pass") because the value isn't always Pass;
              it's whatever the check evaluated to. Station-level rollup
              (S{NN}_PartPass) is automatic and separate from this — this
              is for recording THIS specific check's outcome alongside the
              station rollup. */}
          {(() => {
            const presetName = 'Result';
            const already = list.some(e => e.name === presetName);
            if (already) return null;
            return (
              <button
                type="button"
                onClick={() => setPtCustomLogs([...list, { name: presetName, dataType: 'BOOL' }])}
                style={{
                  alignSelf: 'flex-start',
                  padding: '3px 9px',
                  fontSize: 10, fontWeight: 700,
                  background: '#fff', color: '#15803d',
                  border: '1px dashed #16a34a', borderRadius: 6,
                  cursor: 'pointer',
                }}
                title={`Adds a {Subject}_Result BOOL field that stores the actual check outcome (true = passed, false = failed). Station-level rollup is automatic (S{NN}_PartPass) and doesn't need this.`}
              >
                + Log result (Pass / Fail outcome)
              </button>
            );
          })()}

          {/* Add row — name input, dataType select, Add button. Pressing
              Enter in the name field triggers Add. Strips spaces / special
              chars so the resulting PLC tag stays valid. */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="e.g. RotationAngle"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addEntry(); }
              }}
              style={{
                flex: 1, minWidth: 80,
                fontSize: 11,
                padding: '3px 6px',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
              }}
            />
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value)}
              style={{
                fontSize: 10, fontWeight: 700,
                padding: '3px 4px',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                background: '#fff',
              }}
              title="PLC data type for this field"
            >
              <option value="REAL">REAL</option>
              <option value="DINT">DINT</option>
              <option value="BOOL">BOOL</option>
              <option value="STRING">STRING</option>
            </select>
            <button
              type="button"
              onClick={addEntry}
              disabled={!stripName(draftName)}
              style={{
                fontSize: 10, fontWeight: 700,
                padding: '3px 8px',
                background: stripName(draftName) ? '#10b981' : '#cbd5e1',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: stripName(draftName) ? 'pointer' : 'not-allowed',
              }}
            >
              + Add
            </button>
          </div>

          {/* List of added entries — each row: name pill, type select, X. */}
          {list.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
              {list.map(entry => (
                <div key={entry.name} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '2px 6px',
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  fontSize: 10,
                }}>
                  <span style={{ fontWeight: 700, color: '#0f172a', flex: 1 }}>
                    {entry.name}
                  </span>
                  <select
                    value={entry.dataType}
                    onChange={(e) => updateType(entry.name, e.target.value)}
                    style={{
                      fontSize: 9, fontWeight: 700,
                      padding: '1px 3px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 3,
                      background: '#f8fafc',
                    }}
                  >
                    <option value="REAL">REAL</option>
                    <option value="DINT">DINT</option>
                    <option value="BOOL">BOOL</option>
                    <option value="STRING">STRING</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.name)}
                    style={{
                      fontSize: 11, fontWeight: 700,
                      padding: '0 5px',
                      background: 'transparent',
                      color: '#dc2626',
                      border: 'none',
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                    title="Remove this log field"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Cross-SM signal row — collapsed chip until clicked, then expands into a
// 3-step inline drawer (SM → Device → Signal). The compact path: most flows
// never need this, so it stays one line of UI; users who DO need cross-SM
// references click in to dig.
function CrossSmSignalRow({ allSMs, crossSmRef, setCrossSmRef, drawerOpen, setDrawerOpen, draft, setDraft }) {
  const sm = (allSMs ?? []).find(s => s.id === draft.smId);
  // Devices in the picked SM that have at least one signal/IO point.
  const devicesWithSignals = (sm?.devices ?? []).filter(d =>
    Array.isArray(d.signals) && d.signals.length > 0
  );
  const device = devicesWithSignals.find(d => d.id === draft.deviceId);
  const deviceSignals = device?.signals ?? [];

  function confirm() {
    if (!sm || !device) return;
    const signal = deviceSignals.find(s => s.id === draft.signalId);
    if (!signal) return;
    setCrossSmRef({
      smId: sm.id,
      smName: sm.displayName ?? sm.name,
      deviceId: device.id,
      deviceName: device.displayName ?? device.name,
      signalId: signal.id,
      signalName: signal.name,
    });
    setDrawerOpen(false);
  }

  function clear() {
    setCrossSmRef(null);
    setDraft({ smId: '', deviceId: '', signalId: '' });
  }

  if (!drawerOpen && !crossSmRef) {
    return (
      <div style={{ padding: '4px 4px 0' }}>
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            fontSize: 10, padding: '3px 8px',
            border: '1px dashed #94a3b8',
            borderRadius: 6,
            background: '#fff',
            color: '#475569',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          title="Reference a signal on a device in another SM"
        >
          + From another SM…
        </button>
      </div>
    );
  }

  if (crossSmRef && !drawerOpen) {
    return (
      <div style={{
        margin: '4px 2px 0',
        padding: '4px 8px',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 600,
        border: '1px solid #0072B5',
        background: '#dbeafe',
        color: '#0f172a',
        borderRadius: 6,
      }}>
        <span>↗ {crossSmRef.smName} · {crossSmRef.deviceName}.{crossSmRef.signalName}</span>
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            fontSize: 9, padding: '1px 6px',
            border: '1px solid #cbd5e1', background: '#fff',
            borderRadius: 4, cursor: 'pointer', color: '#475569',
          }}
          title="Edit"
        >
          edit
        </button>
        <button
          onClick={clear}
          style={{
            fontSize: 11, padding: 0, width: 16, height: 16,
            border: 'none', background: 'transparent',
            cursor: 'pointer', color: '#475569',
          }}
          title="Clear"
        >
          ×
        </button>
      </div>
    );
  }

  // Drawer
  return (
    <div style={{
      margin: '4px 2px 0',
      padding: 8,
      border: '1px solid #cbd5e1',
      borderRadius: 6,
      background: '#f8fafc',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
        Pick from another SM
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <select
          value={draft.smId}
          onChange={(e) => setDraft({ smId: e.target.value, deviceId: '', signalId: '' })}
          style={crossSmSelectStyle}
        >
          <option value="">— SM —</option>
          {allSMs.map(s => (
            <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>
          ))}
        </select>
        <select
          value={draft.deviceId}
          onChange={(e) => setDraft({ ...draft, deviceId: e.target.value, signalId: '' })}
          disabled={!sm}
          style={crossSmSelectStyle}
        >
          <option value="">— Device —</option>
          {devicesWithSignals.map(d => (
            <option key={d.id} value={d.id}>{d.displayName ?? d.name} ({d.type})</option>
          ))}
        </select>
        <select
          value={draft.signalId}
          onChange={(e) => setDraft({ ...draft, signalId: e.target.value })}
          disabled={!device}
          style={crossSmSelectStyle}
        >
          <option value="">— Signal —</option>
          {deviceSignals.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}{s.group ? ` (${s.group})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
        <button
          onClick={() => setDrawerOpen(false)}
          style={{
            fontSize: 11, padding: '3px 10px',
            border: '1px solid #cbd5e1', background: '#fff',
            borderRadius: 4, cursor: 'pointer', color: '#0f172a',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={!draft.smId || !draft.deviceId || !draft.signalId}
          style={{
            fontSize: 11, padding: '3px 10px',
            border: 'none',
            background: (draft.smId && draft.deviceId && draft.signalId) ? '#0072B5' : '#cbd5e1',
            color: '#fff',
            borderRadius: 4,
            cursor: (draft.smId && draft.deviceId && draft.signalId) ? 'pointer' : 'not-allowed',
            fontWeight: 700,
            fontFamily: 'inherit',
          }}
        >
          Use this
        </button>
      </div>
    </div>
  );
}

const crossSmSelectStyle = {
  fontSize: 11, padding: '3px 6px',
  border: '1px solid #cbd5e1', borderRadius: 4,
  background: '#fff', fontFamily: 'inherit',
};

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
  // Cap height so the popup can never overflow the viewport when an inline
  // drawer expands (raw I/O list, cross-SM drawer). Vertical scroll lets
  // the user reach long lists; the inline drawers also scroll internally.
  // overscrollBehavior: 'contain' prevents wheel events from chaining up to
  // the page when the picker (or its inner scrollable lists) hits its
  // scroll boundary — without this, scrolling inside the I/O list would
  // also scroll the canvas behind the picker.
  maxHeight: 'calc(100vh - 80px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
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

// ── Raw I/O point row ────────────────────────────────────────────────────────
//
// Hidden behind a "+ I/O point" chip in the SIGNAL category (Decision mode
// only). Click → drawer opens with a flat list of every digital I/O point
// the project will emit (`getDigitalIoPoints` reads `getProjectIoMap`, the
// same data backing the toolbar popup and the canvas I/O Map tab — so what
// you can pick from here is exactly what gets emitted to Studio 5000).
// On pick, the picker treats it as a virtual signal subject; commit emits
// `pickerConfig.ioRef = { tagName, group, deviceId, smId, smName }`.
function RawIoPointRow({ project, ioRef, setIoRef, drawerOpen, setDrawerOpen }) {
  const ioPoints = useMemo(() => {
    if (!project) return [];
    return getDigitalIoPoints(project);
  }, [project]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');  // all | inputs | outputs
  const filtered = useMemo(() => {
    let list = ioPoints;
    if (filter === 'inputs')  list = list.filter(p => p.section === 'digitalInput');
    if (filter === 'outputs') list = list.filter(p => p.section === 'digitalOutput');
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(p =>
      p.tagName.toLowerCase().includes(q) ||
      p.deviceName.toLowerCase().includes(q)
    );
  }, [ioPoints, search, filter]);

  if (ioRef) {
    return (
      <div style={{
        marginTop: 6, padding: '6px 8px',
        background: '#fef3c7', border: '1px solid #f59e0b',
        borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {/* No type badge — the tag name's q_/i_ prefix already says
            input vs output. Border color is enough as a visual marker. */}
        <span style={{ fontFamily: 'Consolas, monospace', fontSize: 11, fontWeight: 600, color: '#0f172a' }}>
          {ioRef.tagName}
        </span>
        <span style={{ fontSize: 9, color: '#a16207', flex: 1 }}>
          {ioRef.smName} · {ioRef.deviceName}
        </span>
        <button
          onClick={() => setIoRef(null)}
          style={{
            padding: '2px 8px', fontSize: 10, fontWeight: 700,
            background: '#fff', color: '#92400e', border: '1px solid #f59e0b',
            borderRadius: 3, cursor: 'pointer',
          }}
          title="Clear I/O point"
        >
          ×
        </button>
      </div>
    );
  }

  if (!drawerOpen) {
    return (
      <button
        onClick={() => setDrawerOpen(true)}
        style={{
          marginTop: 6, marginLeft: 4,
          padding: '4px 10px',
          fontSize: 11, fontWeight: 600,
          background: '#fff', color: '#92400e',
          border: '1px dashed #f59e0b', borderRadius: 6,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
        title="Pick any input or output the project will emit (e.g. q_ExtendCyl). Same data as the toolbar I/O button."
      >
        + Pick I/O point…
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 6, padding: 8,
      background: '#f8fafc', border: '1px solid #cbd5e1',
      borderRadius: 6,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>I/O point:</span>
        {[
          { k: 'all',     l: 'All' },
          { k: 'inputs',  l: 'Inputs' },
          { k: 'outputs', l: 'Outputs' },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setFilter(t.k)}
            style={{
              padding: '2px 7px', fontSize: 9, fontWeight: 700,
              background: filter === t.k ? '#0072B5' : '#fff',
              color: filter === t.k ? '#fff' : '#475569',
              border: '1px solid ' + (filter === t.k ? '#0072B5' : '#cbd5e1'),
              borderRadius: 3, cursor: 'pointer',
            }}
          >{t.l}</button>
        ))}
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, fontSize: 10, padding: '2px 6px',
            border: '1px solid #cbd5e1', borderRadius: 3,
          }}
        />
        <button
          onClick={() => setDrawerOpen(false)}
          style={{
            background: 'none', border: 'none', fontSize: 14,
            color: '#64748b', cursor: 'pointer', padding: '0 4px',
          }}
          title="Close"
        >×</button>
      </div>
      {/* No inner scroll container — the picker's outer container handles
          all scrolling. Nested scroll surfaces created bidirectional
          confusion (could scroll down but not back up because the wheel
          event was being routed to whichever surface the cursor's last
          position landed on). One scroll surface = predictable scroll. */}
      <div
        style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4 }}
      >
        {filtered.length === 0 && (
          <div style={{ padding: 8, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            No I/O points match.
          </div>
        )}
        {filtered.map(p => {
          const isOutput = p.section === 'digitalOutput';
          return (
            <button
              key={`${p.smId}-${p.tagName}`}
              onClick={() => {
                setIoRef({
                  tagName:    p.tagName,
                  group:      isOutput ? 'DO' : 'DI',
                  smId:       p.smId,
                  smName:     p.smName,
                  deviceId:   p.deviceId,
                  deviceName: p.deviceName,
                });
                setDrawerOpen(false);
              }}
              style={{
                // 4px colored bar on the left replaces the redundant
                // IN/OUT pill — the tag's q_/i_ prefix already says
                // direction. Color stays so input vs output is still
                // visually scannable.
                display: 'grid',
                gridTemplateColumns: '4px 1fr',
                gap: 8, alignItems: 'center', width: '100%',
                padding: '4px 8px', textAlign: 'left',
                background: 'none', border: 'none',
                borderBottom: '1px solid #f1f5f9',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <span style={{
                alignSelf: 'stretch',
                background: isOutput ? '#1574C4' : '#5a9a48',
                borderRadius: 2,
              }} />
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{
                  fontFamily: 'Consolas, monospace', fontSize: 11, color: '#0f172a',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {p.tagName}
                </div>
                <div style={{
                  fontSize: 9, color: '#94a3b8',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {p.station} · {p.deviceName}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
