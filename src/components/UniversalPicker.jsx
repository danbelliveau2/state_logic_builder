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
import { DeviceIcon } from './DeviceIcons.jsx';

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

const SUB_ACTIONS = [
  { id: 'wait',   label: 'Wait',   tagline: 'Block until condition is true' },
  { id: 'check',  label: 'Check',  tagline: 'Log current state, advance' },
  { id: 'branch', label: 'Branch', tagline: 'Fork — one edge per INPUTS state' },
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
    // Branch: one edge per INPUTS state, condition (primary) first
    const inputs = parseList(grammarRow.inputs);
    if (inputs.length < 2) return { topology: 1, labels: inputs };
    const labels = condition
      ? [condition, ...inputs.filter(s => s !== condition)]
      : inputs;
    return { topology: labels.length, labels };
  }, [grammarRow, mode, subAction, condition]);

  const canCommit = !!subject && !!grammarRow && (
    mode === 'action' ? !!actionVerb : !!condition
  );

  function handleCommit() {
    if (!canCommit) return;
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
            return (
              <div key={cat.id} style={{ marginBottom: 6 }}>
                <div style={{ ...catHeader, background: cat.color }}>
                  {cat.label}
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
                    // type sub-label there. Everything else benefits from
                    // a small type hint under the name.
                    const showTypeHint = cat.id !== 'pneumatic';
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

      {/* Condition — universal across all decision sub-actions */}
      {grammarRow && mode === 'decision' && (
        <>
          <SectionTitle>
            {subAction === 'wait'   ? 'Condition · what to wait for'      :
             subAction === 'check'  ? 'Condition · what we\'re checking'  :
             /* branch */             'Condition · primary (left) branch'}
          </SectionTitle>
          <div style={chipRow}>
            {parseList(grammarRow.inputs).map((v, idx) => {
              // Branch mode: chips are colored by their semantic role —
              // index 0 = pass (green), 1 = fail (red), 2+ = retry (amber).
              // Selected chip = filled; others = outlined. The selection
              // marks which is primary/left.
              // Wait & Check modes: all chips use the mode accent (purple/cyan).
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
          {subAction === 'check' && (
            <div style={hintText}>
              Reads <strong>{subject?.name}</strong>'s current state and
              logs it to a PT field. Pass = matches <em>{condition}</em>;
              Fail = anything else. Always advances.
            </div>
          )}
          {subAction === 'branch' && parseList(grammarRow.inputs).length > 1 && (
            <div style={hintText}>
              Click a different state above to flip which is the primary
              (left) branch. Other states auto-spawn outgoing edges to the right.
            </div>
          )}
        </>
      )}

      {/* Detail */}
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

      {/* Footer */}
      <div style={footerRow}>
        {onCancel && (
          <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        )}
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          style={btnPrimary(canCommit)}
        >
          Use this
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

function SubActionBtn({ id, label, tagline, active, onClick }) {
  return (
    <button onClick={onClick} style={subActionBtnStyle(active)}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 9, color: active ? '#cbd5e1' : '#64748b', marginTop: 1 }}>
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
