/**
 * DecisionNode - Pill/rounded-rectangle decision/wait node for React Flow.
 * Same shape as StateNode (rounded rectangle, 240px wide).
 * Solid colored fill: blue for signal type, amber for vision type.
 * Click anywhere on node to open "Wait On..." config popup to the RIGHT.
 *
 * Popup flow:
 *   Step 1: Pick from VISION jobs, SIGNALS, SENSORS/DEVICES, or PART TRACKING
 *     - Vision pick → step 2 (branch config)
 *     - Signal pick → step 2 (branch config)
 *     - Sensor/device pick → step 2 (branch config with condition setup)
 *   Step 2: Choose 1 or 2 exits, set condition (on/off or value range)
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from '@xyflow/react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildAvailableInputs } from '../../lib/availableInputs.js';
import { computeStateNumbers } from '../../lib/computeStateNumbers.js';
import { useReactFlowZoomScale } from '../../lib/useReactFlowZoomScale.js';
import { DeviceIcon } from '../DeviceIcons.jsx';
import { PtBadge } from './PtBadge.jsx';
import { ConnectMenu, HandleClickZone } from '../ConnectMenu.jsx';
import { OUTCOME_COLORS } from '../../lib/outcomeColors.js';

// ── Subject color palette ─────────────────────────────────────────────────────
// v1.31 unified-grammar: every node body is `[Action verb] [Detail] [Value]`,
// and the SUBJECT category (the *kind* of thing — cylinder, signal, vision,
// etc.) is communicated entirely through the node's outer border + tint.
// No subject pill, no icon prefix — just chrome. The three inner pills carry
// orthogonal info channels: action verb (wait/check/branch), detail (named
// instance), value (on/off/in-tol/etc.).
const SUBJECT_COLORS = {
  cylinder:     { border: '#475569', fill: '#475569', dim: '#334155' }, // slate
  signal:       { border: '#4f46e5', fill: '#4f46e5', dim: '#3730a3' }, // indigo
  sensor:       { border: '#d97706', fill: '#d97706', dim: '#b45309' }, // amber
  servo:        { border: '#0891b2', fill: '#0891b2', dim: '#0e7490' }, // cyan
  vision:       { border: '#7c3aed', fill: '#7c3aed', dim: '#6d28d9' }, // violet
  robot:        { border: '#ea580c', fill: '#ea580c', dim: '#c2410c' }, // orange
  partTracking: { border: '#16a34a', fill: '#16a34a', dim: '#15803d' }, // green
  partResult:   { border: '#16a34a', fill: '#16a34a', dim: '#15803d' }, // green
  default:      { border: '#475569', fill: '#475569', dim: '#334155' }, // slate fallback
};

// Map a node's data shape to a subject category. The data we have to work
// with is the same set of flags used elsewhere in this file — we just collapse
// them into one of the SUBJECT_COLORS keys for styling purposes.
function getSubjectKey({ signalType, decisionType, primaryCond, liveDevice }) {
  // Vision wins regardless of how it was wired (direct vision job OR a
  // vision-linked Part Tracking field that's really a vision result).
  if (signalType === 'visionJob' || decisionType === 'vision'
      || primaryCond?.signalType === 'visionJob' || primaryCond?._visionLinked === true) {
    return 'vision';
  }
  if (signalType === 'partResult' || primaryCond?.signalType === 'partResult') return 'partResult';
  if (signalType === 'partTracking' || (primaryCond?.signalType === 'partTracking' && !primaryCond?._visionLinked)) {
    return 'partTracking';
  }
  // Sensor with a live device → derive subject from device type
  if (liveDevice?.type === 'Robot') return 'robot';
  if (liveDevice?.type === 'ServoAxis') return 'servo';
  if (liveDevice?.type === 'AnalogSensor') return 'sensor';
  if (liveDevice?.type === 'PneumaticCylinder' || liveDevice?.type === 'PneumaticGripper') return 'cylinder';
  if (liveDevice?.type === 'DigitalSensor') return 'sensor';
  // Generic sensor (no live device match)
  if (signalType === 'sensor' || primaryCond?.signalType === 'sensor') return 'sensor';
  // Plain project signal (state, condition, position)
  if (signalType === 'signal' || primaryCond?.signalType === 'signal') return 'signal';
  return 'default';
}

// ── On/Off Switcher Popup ─────────────────────────────────────────────────────
// Mirrors StateNode's OperationSwitcher UX. Click the Wait On / Verify On pill
// on a decision node to open this little menu; pick On or Off.

function OnOffSwitcher({ smId, nodeId, currentType, mode, pos, onClose, onUpdate, analog = false }) {
  const menuRef = useRef(null);
  const store = useDiagramStore();
  const zoomStyle = useReactFlowZoomScale();

  useEffect(() => {
    function handleDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleDown, true);
    };
  }, [onClose]);

  const verb = mode === 'verify' ? 'Verify' : mode === 'log' ? 'Log' : 'Wait';
  // Analog probe subjects use in-tolerance vocabulary; everything else uses ON/OFF.
  const onLabel  = analog ? 'In Tolerance'     : 'On';
  const offLabel = analog ? 'Out of Tolerance' : 'Off';
  const options = [
    { value: 'on',  label: `${verb} ${onLabel}`,  color: '#16a34a' },
    { value: 'off', label: `${verb} ${offLabel}`, color: '#dc2626' },
  ];

  return createPortal(
    <div ref={menuRef} className="nodrag nowheel" style={{
      position: 'fixed',
      top: pos.top,
      left: pos.left,
      zIndex: 10000,
      background: '#fff',
      border: '1px solid #d1d5db',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      padding: '4px 0',
      minWidth: 140,
      ...zoomStyle,
    }}>
      {options.map(op => {
        const isActive = currentType === op.value || (op.value === 'on' && currentType !== 'off');
        return (
          <div
            key={op.value}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (!isActive) {
                if (onUpdate) onUpdate({ conditionType: op.value });
                else store.updateNodeData(smId, nodeId, { conditionType: op.value });
              }
              onClose();
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', cursor: 'pointer',
              background: isActive ? '#f0f7ff' : 'transparent',
              fontWeight: isActive ? 700 : 500,
              fontSize: 12,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: 3,
              background: op.color, flexShrink: 0,
            }} />
            <span style={{ color: '#1e293b' }}>{op.label}</span>
            {isActive && <span style={{ marginLeft: 'auto', color: '#1574c4', fontSize: 11 }}>✓</span>}
          </div>
        );
      })}
    </div>,
    document.body
  );
}

// ── Log polarity vocabulary helper ─────────────────────────────────────────────
// The footer "Log:" pill announces what polarity pair is being recorded — in
// the engineer's vocabulary for that subject. Vision jobs say "pass / fail",
// analog probe point-checks say "in tol / out of tol", range probes say
// "in / out of range", binary subjects (signals/digital sensors) say "on / off".
// Used by both DecisionBody (embedded inline card) and DecisionNode (standalone
// node), so it lives at module scope to keep the two surfaces in lockstep.
function deriveLogPolarityLabel({ isAnalogSubject, isVisionJob, sensorInputType }) {
  if (sensorInputType === 'range') return 'in / out of range';
  if (isAnalogSubject) return 'in tol / out of tol';
  if (isVisionJob) return 'pass / fail';
  return 'on / off';
}

// ── Inline Edit Popup ──────────────────────────────────────────────────────────

function buildVisionSignalsLocal(allSMs) {
  const result = [];
  for (const sm of allSMs) {
    for (const device of (sm.devices ?? [])) {
      if (device.type !== 'VisionSystem') continue;
      for (const job of (device.jobs ?? [])) {
        result.push({
          id: `vision_${sm.id}_${device.id}_${job.name}`,
          label: `${device.name} \u2192 ${job.name}`,
          signalName: job.name,
          signalSource: device.name,
          signalSmName: sm.name,
          type: 'visionJob',
          decisionType: 'signal',
          outcomes: job.outcomes ?? ['Pass', 'Fail'],
        });
      }
    }
  }
  return result;
}

// saveTarget: 'node' (default) → writes to node via updateNodeData + creates branch nodes
//             'action'          → writes to an action row via updateAction (embedded decision),
//                                 no branch node creation (the state's outgoing edges handle that)
// When saveTarget === 'action', `actionId` must be provided.
export function DecisionEditPopup({ nodeId, smId, data, onClose, style, saveTarget = 'node', actionId = null }) {
  const store = useDiagramStore();
  const allSMs = store.project?.stateMachines ?? [];
  const projectSignals = store.project?.signals ?? [];
  const ptFields = store.project?.partTracking?.fields ?? [];
  const visionSignals = buildVisionSignalsLocal(allSMs);
  const allSignals = [...visionSignals, ...projectSignals];

  // Build sensor/device inputs from current SM
  const currentSm = allSMs.find(s => s.id === smId);
  const sensorInputs = buildAvailableInputs(
    currentSm?.devices ?? [], allSMs, smId, ptFields
  ).filter(inp => inp.group !== 'Part Tracking'); // PT has its own section

  // State: which signal is selected + branch config
  const [signalId, setSignalId] = useState(data.signalId ?? null);
  const [signalName, setSignalName] = useState(data.signalName ?? '');
  const [signalSource, setSignalSource] = useState(data.signalSource ?? '');
  const [signalType, setSignalType] = useState(data.signalType ?? null);
  const [signalSmName, setSignalSmName] = useState(data.signalSmName ?? null);
  const [decisionType, setDecisionType] = useState(data.decisionType ?? 'signal');
  const [exitCount, setExitCount] = useState(() => {
    const isConfigured = data.signalName && data.signalName !== 'Select Signal...';
    const storedCount = data.exitCount;
    if (storedCount != null && isConfigured) {
      // Rule: a wait node with one (or zero) condition can't branch — if the
      // condition isn't met, the state simply doesn't advance (same as any
      // other state). Only decide-mode and multi-condition waits branch.
      // Auto-correct older nodes that violate this rule on popup open.
      const condCount = data.conditions?.length ?? (data.sensorRef || data.signalType === 'partTracking' ? 1 : 0);
      if (data.nodeMode !== 'decide' && condCount <= 1 && storedCount > 1) return 1;
      return storedCount;
    }
    return data.nodeMode === 'decide' ? 2 : 1;
  });
  // Initial input values. These are just a placeholder until the useEffect
  // below re-derives them from conditions[0] + current mode. Vision defaults
  // to Pass/Fail (vision-only vocabulary); everything else defaults to On/Off
  // so a fresh popup with no condition picked doesn't flash the wrong word.
  const [exit1Label, setExit1Label] = useState(data.exit1Label ?? (data.signalType === 'visionJob' ? 'Pass' : 'On'));
  const [exit2Label, setExit2Label] = useState(data.exit2Label ?? (data.signalType === 'visionJob' ? 'Fail' : 'Off'));
  // Tracks whether the user has manually typed into the Left/Right exit inputs.
  // When true, `syncDecisionExitLabels` must NOT overwrite the labels with
  // auto-derived defaults. Reset to false whenever the user picks a new
  // condition (vision/signal/PT/sensor) or hits an On/Off/Range preset button,
  // because the new condition implies fresh defaults.
  const [labelsCustomized, setLabelsCustomized] = useState(!!data.exitLabelsCustomized);
  const [nodeMode, setNodeMode] = useState(data.nodeMode ?? 'wait');  // 'wait' | 'decide' | 'verify'

  // Multi-outcome labels for decide mode (exitCount > 2)
  const [outcomeLabels, setOutcomeLabels] = useState(data.outcomeLabels ?? ['Option A', 'Option B', 'Option C']);

  // Condition config for sensor branching
  const [conditionType, setConditionType] = useState(data.conditionType ?? 'on');  // 'on' | 'off' | 'range'
  const [rangeMin, setRangeMin] = useState(data.rangeMin ?? '');
  const [rangeMax, setRangeMax] = useState(data.rangeMax ?? '');
  const [sensorRef, setSensorRef] = useState(data.sensorRef ?? null);
  const [sensorTag, setSensorTag] = useState(data.sensorTag ?? '');
  const [sensorInputType, setSensorInputType] = useState(data.sensorInputType ?? 'bool'); // 'bool' | 'range'

  // Part tracking: optionally set a PT field on pass/fail branches.
  // For Log mode, ptEnabled is auto-forced TRUE on mode pick — the user
  // can still untick it if they explicitly don't want a write, but we
  // surface the dropdown immediately because Log without PT is a no-op.
  const [ptEnabled, setPtEnabled] = useState(data.ptEnabled ?? false);
  const [ptFieldId, setPtFieldId] = useState(data.ptFieldId ?? null);
  const [ptFieldName, setPtFieldName] = useState(data.ptFieldName ?? '');
  const [ptPassValue, setPtPassValue] = useState(data.ptPassValue ?? 'SUCCESS');
  const [ptFailValue, setPtFailValue] = useState(data.ptFailValue ?? 'FAILURE');

  // Log mode "Also store value" add-on: writes the AnalogSensor's raw
  // {name}Scaled tag to a REAL PT field. Only meaningful when the picked
  // subject is an AnalogSensor; the toggle stays hidden otherwise.
  const [valueLogEnabled, setValueLogEnabled] = useState(data.valueLogEnabled ?? false);
  const [valueFieldId, setValueFieldId]       = useState(data.valueFieldId ?? null);
  const [valueFieldName, setValueFieldName]   = useState(data.valueFieldName ?? '');

  // Retry counter config (only meaningful for 'wait' mode)
  const [retryEnabled, setRetryEnabled] = useState(data.retryEnabled ?? false);
  const [retryMax, setRetryMax] = useState(data.retryMax ?? 3);

  // After picking any signal/vision, show branch config step
  // Always start on the branch config builder — no separate signal picker step
  const [showBranchConfig, setShowBranchConfig] = useState(true);

  // v1.32 — Universal node builder. The 4-pill stepper at the top of the popup
  // IS the navigator: clicking a pill loads that stage's picker into the body,
  // replacing whatever was there. The body never shows two stages at once.
  //   subject → flat list of subject categories (Cylinder/Sensor/Signal/etc.)
  //   detail  → flat list of named instances within the picked subject
  //   action  → Wait / Check / Decide cards
  //   value   → polarity buttons (On/Off, Pass/Fail, In Tol/Out, range editor)
  // Outcomes / Log / Retry render BELOW the active stage's picker, always
  // visible once a detail is committed (gated on conditions.length > 0).
  const [activeStage, setActiveStage] = useState(() => {
    // Fresh node with no condition picked yet → start at subject picker
    const isFresh = !(data.conditions?.length || data.sensorRef || data.signalType === 'partTracking');
    if (isFresh) return 'subject';
    // Configured node → land on the Action stage (most recently meaningful slot)
    return 'action';
  });
  // goToStage: click handler for stepper pills. Syncs the legacy
  // showBranchConfig / subjectTypeView / pickerStage flags so the existing
  // sub-flow handlers (handleSensorPick, handleVisionPick, etc.) keep working
  // — they were written against the old boolean model. Refusing to advance
  // to action/value when there's no committed condition keeps the user from
  // landing on an empty Wait/Check page with nothing to act on.
  const goToStage = (stage) => {
    if (stage === 'subject') {
      setActiveStage('subject');
      setShowBranchConfig(false);
      setSubjectTypeView(null);
      setPickerStage('subject');
      setDraftDeviceId(null);
      setAddingCondition(false);
      setEditingConditionIdx(null);
      return;
    }
    if (stage === 'detail') {
      setActiveStage('detail');
      setShowBranchConfig(false);
      setAddingCondition(false);
      setEditingConditionIdx(null);
      // If subjectTypeView is null, infer from current saved state so the
      // detail list isn't empty. Otherwise leave the user where they were.
      if (subjectTypeView === null) {
        const inferred = (() => {
          if (decisionType === 'vision' || signalType === 'visionJob') return 'vision';
          if (signalType === 'partTracking') return 'partTracking';
          if (signalType === 'partResult') return 'partResults';
          if (signalType === 'sensor') {
            // v1.32: Devices + Sensors are now separate buckets. Map back to
            // the right one by re-applying the same group → bucket logic that
            // bucketForInput uses in Stage A. Robot signals stay in 'robots'.
            const grp = (conditions ?? [])[0]?.group ?? '';
            if (grp.startsWith('Robot')) return 'robots';
            if (grp === 'Cylinders / Actuators' || grp === 'Grippers'
                || grp === 'Vacuum' || grp === 'Servo Positions') return 'devices';
            if (grp === 'Sensors' || grp === 'Analog Sensors') return 'sensors';
            if (grp === 'Vision') return 'vision';
            if (grp === 'Parameters') return 'signals';
            return 'sensors';
          }
          return 'signals';
        })();
        setSubjectTypeView(inferred);
      }
      return;
    }
    if (stage === 'action' || stage === 'value') {
      // Need a committed condition to be on Action/Value. Bounce back if not.
      if (conditions.length === 0) {
        setActiveStage(subjectTypeView !== null ? 'detail' : 'subject');
        return;
      }
      setActiveStage(stage);
      setShowBranchConfig(true);
      setAddingCondition(false);
      setEditingConditionIdx(null);
    }
  };

  // Expanded-section tracking — keyed by section name. Default: all collapsed.
  // A key is present (true) only when the user has opened that section.
  const [expandedSections, setExpandedSections] = useState({});
  const toggleSection = (key) => setExpandedSections(s => ({ ...s, [key]: !s[key] }));
  const isExpanded = (key) => !!expandedSections[key];

  // Multi-condition support (AND/OR logic for multiple checks)
  const [conditions, setConditions] = useState(() => {
    if (data.conditions?.length) return data.conditions;
    // Backward compat: build single-entry array from legacy single-condition data
    if (data.sensorRef) return [{ ref: data.sensorRef, tag: data.sensorTag ?? '', label: data.signalName ?? '', inputType: data.sensorInputType ?? 'bool', conditionType: data.conditionType ?? 'on', signalType: 'sensor', group: data.signalSource ?? '' }];
    if (data.signalType === 'partTracking') return [{ ref: `_tracking:${data.signalId?.replace('pt_', '')}`, tag: '', label: data.signalName ?? '', inputType: 'bool', conditionType: 'on', signalType: 'partTracking', group: 'Part Tracking' }];
    return [];
  });
  const [conditionLogic, setConditionLogic] = useState(data.conditionLogic ?? 'AND');
  const [addingCondition, setAddingCondition] = useState(false);
  const [editingConditionIdx, setEditingConditionIdx] = useState(null); // when set: picked signal REPLACES this condition
  // v1.30.1: Two-stage subject picker. null = show TYPE cards (Vision /
  // Sensors / Signals / etc). Set to a type key = drill into that one type's
  // items only. Mirrors the user's mental model: pick subject TYPE first,
  // then in a different selector pick the actual job/signal/sensor.
  const [subjectTypeView, setSubjectTypeView] = useState(null);

  // v1.30.5 — Step-by-step builder (3 stages). Each picker layer is its own
  // page so the user is never staring at a wall of mashed-up options.
  //   pickerStage === 'subject'  → Stage A (TYPE cards) or Stage B (per-type
  //                                  list of subjects, grouped by device)
  //   pickerStage === 'check'    → Stage C (per-device check picker)
  // A device with multiple checks (e.g. a probe with 3 setpoints, a 2-sensor
  // cylinder, a robot with 12 signals) shows as ONE button in Stage B that
  // advances to Stage C. Single-check devices skip Stage C and commit
  // directly. `draftDeviceId` is the device chosen in Stage B that we're
  // drilling into.
  const [pickerStage, setPickerStage] = useState('subject');
  const [draftDeviceId, setDraftDeviceId] = useState(null);
  // Reset Stage C state whenever we leave the picker (drop into branch
  // config) or change subject type. Otherwise opening the picker again
  // could land the user mid-drill on a stale device.
  useEffect(() => {
    if (showBranchConfig || subjectTypeView === null) {
      if (pickerStage !== 'subject') setPickerStage('subject');
      if (draftDeviceId !== null) setDraftDeviceId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBranchConfig, subjectTypeView]);

  // v1.32 — Auto-advance activeStage when the sub-flow handlers commit forward
  // (handleSensorPick / handleVisionPick / etc. flip showBranchConfig=true).
  // Forward-only: a manual stepper click that opens an earlier stage stays
  // put. When the popup is reset to no-subject (legacy back arrow), drop
  // back to the subject stage.
  useEffect(() => {
    if (showBranchConfig && conditions.length > 0
        && (activeStage === 'subject' || activeStage === 'detail')) {
      setActiveStage('action');
      return;
    }
    if (!showBranchConfig && subjectTypeView !== null && activeStage === 'subject') {
      setActiveStage('detail');
      return;
    }
    if (!showBranchConfig && subjectTypeView === null && activeStage !== 'subject') {
      setActiveStage('subject');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBranchConfig, subjectTypeView, conditions.length]);

  // Click-outside to dismiss (capture phase)
  const popupRef = useRef(null);
  useEffect(() => {
    function handleMouseDown(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [onClose]);

  // Wheel fix ONLY on the scrollable signal list
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handler = (e) => e.stopPropagation();
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Auto-refresh exit label inputs when they're stale relative to the current
  // condition vocabulary. Example: a decision saved before v1.24.10 has
  // exit1Label='Pass'/exit2Label='Fail' baked in, but its condition is a binary
  // signal like "Part_Gripped" which should branch into On/Off today.
  //
  // We CAN'T purely gate on `labelsCustomized` — that flag gets sticky-true on
  // any save where it was true in the past, and pre-v1.24.10 records that
  // auto-defaulted to Pass/Fail may have it set as well. Instead we detect
  // whether the current labels look like a GENERIC DEFAULT PAIR (Pass/Fail,
  // True/False, On/Off, Off/On, InRange/OutOfRange). If they do → overwrite
  // with the fresh `derivePrimary` output. A user-typed label like "Gripped"
  // won't match any default pair, so those stay put.
  const GENERIC_DEFAULT_PAIRS = [
    ['Pass', 'Fail'],
    ['True', 'False'],
    ['On', 'Off'],
    ['Off', 'On'],
    ['InRange', 'OutOfRange'],
    ['In Range', 'Out of Range'],
  ];
  function looksLikeGenericDefault(e1, e2) {
    return GENERIC_DEFAULT_PAIRS.some(([a, b]) => e1 === a && e2 === b);
  }
  useEffect(() => {
    if (conditions.length === 0) return;
    const primary = derivePrimary(conditions[0]);
    if (!primary) return;
    // Respect truly custom labels — if either input holds something outside
    // the known default vocabulary, the user typed it, so don't touch.
    if (!looksLikeGenericDefault(exit1Label, exit2Label)) return;
    if (primary.exit1 !== exit1Label) setExit1Label(primary.exit1);
    if (primary.exit2 !== exit2Label) setExit2Label(primary.exit2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions, conditionType, nodeMode]);

  // Vision job picked -> show branch config
  function handleVisionPick(sig) {
    const jobName = sig.signalName ?? sig.name ?? 'Signal';
    const newCond = { ref: `vision_${sig.id}`, tag: '', label: `${sig.signalSource} → ${jobName}`, inputType: 'bool', conditionType: 'on', signalType: 'visionJob', group: 'Vision' };
    if (editingConditionIdx !== null) {
      setConditions(prev => prev.map((c, i) => i === editingConditionIdx ? { ...newCond, conditionType: c.conditionType ?? 'on' } : c));
      setEditingConditionIdx(null);
      setShowBranchConfig(true);
      return;
    }
    if (addingCondition) {
      setConditions(prev => [...prev, newCond]);
      setAddingCondition(false);
      setShowBranchConfig(true);
      return;
    }
    setSignalId(sig.id);
    setSignalName(jobName);
    setSignalSource(sig.signalSource ?? '');
    setSignalSmName(sig.signalSmName ?? null);
    setSignalType('visionJob');
    setDecisionType('signal');
    setExit1Label('Pass');
    setExit2Label('Fail');
    setLabelsCustomized(false);
    setExitCount(nodeMode === 'decide' ? 2 : 1);
    // nodeMode stays whatever the user chose at the top of the popup
    setConditions([newCond]);
    setShowBranchConfig(true);
  }

  // Signal picked -> show branch config (step 2)
  function handleSignalPick(sig) {
    const name = sig.name ?? sig.signalName ?? 'Signal';
    // Store clean source without baked step numbers — they resolve dynamically
    const cleanStateName = (sig.stateName ?? '').replace(/^\[\d+\]\s*[✓⌂⏳]?\s*/, '');
    const source = sig.type === 'state' && sig.smName && cleanStateName
      ? `${sig.smName} \u2192 ${cleanStateName}`
      : (sig.smName ?? '');
    const newCond = { ref: `signal_${sig.id}`, tag: '', label: name, inputType: 'bool', conditionType: 'on', signalType: sig.type ?? 'signal', group: source };
    if (editingConditionIdx !== null) {
      setConditions(prev => prev.map((c, i) => i === editingConditionIdx ? { ...newCond, conditionType: c.conditionType ?? 'on' } : c));
      setEditingConditionIdx(null);
      setShowBranchConfig(true);
      return;
    }
    if (addingCondition) {
      setConditions(prev => [...prev, newCond]);
      setAddingCondition(false);
      setShowBranchConfig(true);
      return;
    }
    setSignalId(sig.id);
    setSignalName(name);
    setSignalSource(source);
    setSignalSmName(sig.smName ?? null);
    setSignalType(sig.type ?? 'signal');
    setDecisionType('signal');
    // Default exit labels follow the CONDITION. A binary signal ("is this
    // signal on?") branches into On/Off — same vocabulary as a sensor decision.
    // Verify mode: match conditionType so "Verify On" → exit1=On, "Verify Off"
    // → exit1=Off (the "pass" side of the verify is whichever polarity was
    // picked). Wait/decide modes always use On/Off in condition order.
    if (nodeMode === 'verify') {
      setExit1Label(conditionType === 'off' ? 'Off' : 'On');
      setExit2Label(conditionType === 'off' ? 'On' : 'Off');
    } else {
      setExit1Label('On');
      setExit2Label('Off');
    }
    setLabelsCustomized(false);
    setExitCount(nodeMode === 'decide' ? 2 : 1);
    // nodeMode stays whatever the user chose at the top of the popup
    setConditions([newCond]);
    setShowBranchConfig(true);
  }

  // Part Tracking field picked -> show branch config
  function handlePTPick(field) {
    const isVisionLinked = !!field._visionLinked;
    const isRealField = field.type === 'real';
    const sourceLabel = isVisionLinked && field._visionSmName && field._visionSmId !== smId
      ? `${field._visionSmName} → ${field.name}`
      : field.name;
    const newCond = {
      ref: `_tracking:${field.id}`,
      tag: `PartTracking.${field.name}`,
      label: sourceLabel,
      inputType: isRealField ? 'range' : 'bool',
      conditionType: 'on',
      signalType: 'partTracking',
      group: isVisionLinked ? 'Part Results' : 'Part Tracking',
      // Upstream-source metadata (for L5X resolution across stations)
      _visionLinked: isVisionLinked,
      _visionSmId: field._visionSmId ?? null,
      _visionSmName: field._visionSmName ?? null,
      _visionDeviceId: field._visionDeviceId ?? null,
      _visionJobId: field._visionJobId ?? null,
      _visionJobName: field._visionJobName ?? null,
      _visionOutputName: field._visionOutputName ?? null,
    };
    if (editingConditionIdx !== null) {
      setConditions(prev => prev.map((c, i) => i === editingConditionIdx ? { ...newCond, conditionType: c.conditionType ?? 'on' } : c));
      setEditingConditionIdx(null);
      setShowBranchConfig(true);
      return;
    }
    if (addingCondition) {
      setConditions(prev => [...prev, newCond]);
      setAddingCondition(false);
      setShowBranchConfig(true);
      return;
    }
    setSignalId(`pt_${field.id}`);
    setSignalName(field.name);
    setSignalSource(isVisionLinked && field._visionSmName ? field._visionSmName : 'Part Tracking');
    setSignalSmName(isVisionLinked ? (field._visionSmName ?? null) : null);
    setSignalType(isVisionLinked ? 'partResult' : 'partTracking');
    setDecisionType('signal');
    // Part tracking fields are binary → On/Off vocabulary (not Pass/Fail,
    // which is vision-only).
    if (isRealField) {
      setExit1Label('InRange');
      setExit2Label('OutOfRange');
    } else {
      setExit1Label('On');
      setExit2Label('Off');
    }
    setLabelsCustomized(false);
    setExitCount(2);
    // nodeMode stays whatever the user chose at the top of the popup.
    // If the user hadn't changed it from the default 'wait', switch to 'decide'
    // since PT is a latched value and waiting on it doesn't make sense.
    if (nodeMode === 'wait' && !data.nodeMode) setNodeMode('decide');
    setConditionType('on');
    setSensorRef(null);
    setSensorTag('');
    setSensorInputType('bool');
    setConditions([newCond]);
    setShowBranchConfig(true);
  }

  // Sensor/device input picked -> show branch config with condition setup
  function handleSensorPick(inp) {
    const shortName = inp.label.replace(/\s*\(.*\)$/, '');  // strip cross-SM suffix
    const newCond = { ref: inp.ref, tag: inp.tag, label: shortName, inputType: inp.inputType ?? 'bool', conditionType: inp.inputType === 'range' ? 'range' : 'on', signalType: 'sensor', group: inp.group };

    // Subject-aware exit-label defaults — drive the OUTCOMES inputs and the
    // branch-edge labels so a probe doesn't show On/Off (it's IN TOL/OUT).
    const refDevId = (inp.ref && typeof inp.ref === 'string' && inp.ref.includes(':'))
      ? inp.ref.split(':')[0]
      : null;
    const refDev = refDevId
      ? (currentSm?.devices ?? []).find(d => d.id === refDevId)
      : null;
    const refIsAnalog = refDev?.type === 'AnalogSensor';
    const seedDefaults = () => {
      setSignalId(`sensor_${inp.ref}`);
      setSignalName(shortName);
      setSignalSource(inp.group);
      setSignalSmName(null);
      setSignalType('sensor');
      setDecisionType('signal');
      setSensorRef(inp.ref);
      setSensorTag(inp.tag);
      setSensorInputType(inp.inputType ?? 'bool');
      let e1, e2;
      if (inp.inputType === 'range') {
        setConditionType('range');
        e1 = 'InRange';
        e2 = 'OutOfRange';
      } else if (refIsAnalog) {
        setConditionType('on');
        e1 = 'InTol';
        e2 = 'Out';
      } else {
        setConditionType('on');
        e1 = 'On';
        e2 = 'Off';
      }
      setExit1Label(e1);
      setExit2Label(e2);
      setLabelsCustomized(false);
    };

    if (editingConditionIdx !== null) {
      setConditions(prev => prev.map((c, i) => i === editingConditionIdx ? { ...newCond, conditionType: (c.inputType === newCond.inputType ? (c.conditionType ?? newCond.conditionType) : newCond.conditionType) } : c));
      setEditingConditionIdx(null);
      setShowBranchConfig(true);
      // If editing the FIRST condition, also seed legacy state so the rest
      // of the popup (CONDITION section, verb badge, branch labels) stays
      // in sync with the new pick.
      if (editingConditionIdx === 0) seedDefaults();
      return;
    }
    if (addingCondition) {
      setConditions(prev => [...prev, newCond]);
      setAddingCondition(false);
      setShowBranchConfig(true);
      // First-condition path: seed legacy state so isSensor / sensorRef /
      // exit labels reflect the new subject. Without this the CONDITION
      // section never shows and OUTCOMES defaults stick at On/Off for
      // analog probes.
      if (conditions.length === 0) seedDefaults();
      return;
    }
    seedDefaults();
    setExitCount(nodeMode === 'decide' ? 2 : 1);
    setConditions([newCond]);

    // All modes go to branch config so user can review retries, labels, multi-outcome, etc.
    setShowBranchConfig(true);
  }

  // Derive primary display fields from the first condition so the node label
  // and branch edge labels stay in sync when conditions are edited.
  function derivePrimary(cond) {
    if (!cond) return null;
    const rawLabel = cond.label ?? '';
    const name = rawLabel.includes('\u2192') ? rawLabel.split('\u2192').pop().trim() : rawLabel;
    const source = rawLabel.includes('\u2192')
      ? rawLabel.split('\u2192')[0].trim()
      : (cond.group ?? '');
    const type = cond.signalType ?? 'signal';
    let exit1, exit2;
    // Branch labels follow the CONDITION — the MODE never dictates the vocabulary.
    //   Vision job (named outcomes) → Pass / Fail    [ONLY place Pass/Fail appears]
    //   Range                       → InRange / OutOfRange
    //   Analog probe (RC.InPos BOOL) → InTol / Out  (the BOOL of an analog
    //     setpoint is conceptually a tolerance hit, not an On/Off state)
    //   Binary (digital sensor/signal/state/condition/PT) → On / Off
    //     (Verify+Off swaps so exit1 = picked polarity)
    // Rationale: Verify means "assert the condition"; Decide means "branch on
    // the condition". Neither is a Pass/Fail concept — that's vision-only.
    const condDevId = (typeof cond.ref === 'string' && cond.ref.includes(':'))
      ? cond.ref.split(':')[0] : null;
    const condDevForLabels = condDevId && condDevId !== '_tracking'
      ? (currentSm?.devices ?? []).find(d => d.id === condDevId)
      : null;
    const condIsAnalog = condDevForLabels?.type === 'AnalogSensor';
    if (cond.signalType === 'visionJob') {
      exit1 = 'Pass';
      exit2 = 'Fail';
    } else if (cond.inputType === 'range' || cond.conditionType === 'range') {
      exit1 = 'InRange';
      exit2 = 'OutOfRange';
    } else if (condIsAnalog) {
      // Analog probe BOOL — flip with verify+off the same way On/Off does.
      if (nodeMode === 'verify' && conditionType === 'off') {
        exit1 = 'Out';
        exit2 = 'InTol';
      } else {
        exit1 = 'InTol';
        exit2 = 'Out';
      }
    } else {
      // Binary — digital sensor / signal / state / condition / PT.
      if (nodeMode === 'verify' && conditionType === 'off') {
        exit1 = 'Off';
        exit2 = 'On';
      } else {
        exit1 = 'On';
        exit2 = 'Off';
      }
    }
    return { name, source, type, exit1, exit2 };
  }

  // Done from branch config
  function handleDone() {
    // Re-derive primary display fields from conditions[0] so node + branches
    // reflect the currently-selected primary condition (fixes stale labels
    // after editing a condition in place).
    const primary = conditions.length > 0 ? derivePrimary(conditions[0]) : null;
    const finalSignalName = primary?.name ?? signalName;
    const finalSignalSource = primary?.source ?? signalSource;
    const finalSignalType = primary?.type ?? signalType;
    // Exit labels: honor whatever the user last typed into the Left/Right exit
    // inputs. `exit1Label`/`exit2Label` are already kept in sync via
    // `setExit1Label`/`setExit2Label` whenever a condition is added or swapped,
    // so the state already reflects the defaults for the current condition
    // EXCEPT when the user has since overridden them — which is exactly what
    // we want to preserve. Don't re-derive from `primary` here, because that
    // would silently clobber "On/Off" back to "True/False" on Done.
    const finalExit1Label = exit1Label;
    const finalExit2Label = exit2Label;

    // Safety net: enforce the wait-branching rule. A wait node with ≤1 condition
    // can't branch — it just waits. Force single exit regardless of what the
    // local state says (which should already be correct via UI hiding + init).
    // Verify mode: used to be clamped to 1 here, but the "Branch Pass/Fail" UI
    // button is visible for verify (so the user can pick 2 exits), and silently
    // reverting that choice broke "pick 2 branches on embedded verify → nothing
    // happens". Verify with 2 exits is legitimate (pass=continue, fail=fault).
    const finalExitCount = (nodeMode === 'wait' && conditions.length <= 1 && exitCount > 1)
      ? 1
      : exitCount;

    const updatedData = {
      signalId,
      signalName: finalSignalName,
      signalSource: finalSignalSource,
      signalSmName,
      signalType: finalSignalType,
      decisionType,
      exitCount: finalExitCount,
      exit1Label: finalExit1Label,
      exit2Label: finalExit2Label,
      // Persist the "user customized the labels" flag so `syncDecisionExitLabels`
      // won't clobber custom names like "On"/"Off" on a signal-type condition.
      exitLabelsCustomized: labelsCustomized,
      nodeMode,
      // Sensor/condition data
      conditionType,
      rangeMin: rangeMin !== '' ? Number(rangeMin) : undefined,
      rangeMax: rangeMax !== '' ? Number(rangeMax) : undefined,
      sensorRef,
      sensorTag,
      sensorInputType,
      // Retry counter (available for wait, decide, and verify modes)
      retryEnabled,
      retryMax: retryEnabled ? Number(retryMax) || 3 : undefined,
      // Part tracking. Unified-flag model (v1.28+): ptEnabled is an orthogonal
      // toggle that composes with any mode — Verify+Log, Decide+Log, Wait+Log
      // all persist PT fields the same way. Log mode auto-flips the local
      // toggle on entry (see mode switcher) so the persisted ptEnabled is
      // already true; no special-casing needed here.
      ptEnabled,
      ptFieldId: ptEnabled ? ptFieldId : undefined,
      ptFieldName: ptEnabled ? ptFieldName : undefined,
      ptPassValue: ptEnabled ? ptPassValue : undefined,
      ptFailValue: ptEnabled ? ptFailValue : undefined,
      // Value-log add-on: copies an AnalogSensor's {name}Scaled into a REAL
      // PT field at the moment of the check. Also orthogonal — composable
      // with any mode that has an analog subject.
      valueLogEnabled,
      valueFieldId: valueLogEnabled ? valueFieldId : undefined,
      valueFieldName: valueLogEnabled ? valueFieldName : undefined,
      // Multi-condition
      conditions: conditions.length > 0 ? conditions : undefined,
      conditionLogic: conditions.length > 1 ? conditionLogic : undefined,
    };
    // Auto-create PT field if user typed a new name (no existing field selected).
    // Unified-flag model: gate purely on the local ptEnabled flag. Log mode
    // auto-flips it on mode-entry, so this still covers the "log node always
    // writes PT" case.
    if (ptEnabled && ptFieldName && !ptFieldId) {
      // Check if a field with this name already exists
      const existing = ptFields.find(f => f.name === ptFieldName);
      if (existing) {
        updatedData.ptFieldId = existing.id;
      } else {
        const newId = store.addTrackingField({ name: ptFieldName, dataType: 'boolean', description: `Auto-created from decision node: ${finalSignalName}` });
        updatedData.ptFieldId = newId;
      }
    }
    // Auto-create REAL value field for the optional "Also store value" add-on.
    // Also orthogonal now — composable with any mode that has an analog subject.
    if (valueLogEnabled && valueFieldName && !valueFieldId) {
      const existing = ptFields.find(f => f.name === valueFieldName);
      if (existing) {
        updatedData.valueFieldId = existing.id;
      } else {
        const newId = store.addTrackingField({ name: valueFieldName, dataType: 'real', description: `Auto-created REAL log field for: ${finalSignalName}` });
        updatedData.valueFieldId = newId;
      }
    }
    // Include outcome labels for multi-outcome mode
    if (finalExitCount > 2) {
      updatedData.outcomeLabels = outcomeLabels.slice(0, finalExitCount);
    }
    if (saveTarget === 'action' && actionId) {
      // Embedded decision row: save onto the action, preserve deviceId === '_decision'
      // and set operation to match the mode.
      store.updateAction(smId, nodeId, actionId, {
        ...updatedData,
        deviceId: '_decision',
        operation: nodeMode === 'wait'   ? 'Wait'
                 : nodeMode === 'decide' ? 'Decide'
                 : nodeMode === 'verify' ? 'Verify'
                 : nodeMode === 'log'    ? 'Log'
                 : 'Wait',
        autoOpenPopup: false,
      });
      // If this embedded decision is the LAST row AND has 2+ exits, the parent
      // state needs to branch the same way a standalone DecisionNode would.
      // Delegate to the existing branch-creation store actions using the PARENT
      // state's nodeId as the "decision" source, so Pass_X / Fail_X nodes spawn
      // below the state and edges wire to its side handles.
      // Recovery-aware lookup: the parent state may live in sm.nodes OR in any
      // recoverySeqs[*].nodes (recovery tab). Must search both so this doesn't
      // silently no-op on recovery-tab decisions.
      const sm = store.project?.stateMachines?.find(m => m.id === smId);
      let parentState = sm?.nodes?.find(n => n.id === nodeId);
      if (!parentState) {
        for (const r of (sm?.recoverySeqs ?? [])) {
          const found = (r.nodes ?? []).find(n => n.id === nodeId);
          if (found) { parentState = found; break; }
        }
      }
      const parentActions = parentState?.data?.actions ?? [];
      const isLastRow = parentActions.length > 0
        && parentActions[parentActions.length - 1]?.id === actionId;
      if (isLastRow) {
        if (finalExitCount > 2) {
          store.addDecisionMultiBranch(smId, nodeId, outcomeLabels.slice(0, finalExitCount));
        } else if (finalExitCount === 2) {
          store.addDecisionBranches(smId, nodeId, finalExit1Label, finalExit2Label);
          if (retryEnabled) {
            store.addDecisionRetryBranch(smId, nodeId);
          }
        }
        // exitCount === 1 → use the state's default bottom handle; no branch
        // creation needed. User can draw the onward edge manually.
      }
    } else {
      store.updateNodeData(smId, nodeId, updatedData);
      if (finalExitCount > 2) {
        store.addDecisionMultiBranch(smId, nodeId, outcomeLabels.slice(0, finalExitCount));
      } else if (finalExitCount === 2) {
        store.addDecisionBranches(smId, nodeId, finalExit1Label, finalExit2Label);
      } else if (finalExitCount === 1) {
        store.addDecisionSingleBranch(smId, nodeId, finalExit1Label);
      }
      // Create retry branch if retry is enabled (any mode with 2 exits)
      if (retryEnabled && finalExitCount === 2) {
        store.addDecisionRetryBranch(smId, nodeId);
      }
    }
    onClose();
  }

  const typeBadgeMap = {
    position:     { label: 'POS',    color: '#fcd34d', bg: '#78350f' },
    state:        { label: 'STATE',  color: '#93c5fd', bg: '#1e3a5f' },
    condition:    { label: 'COND',   color: '#d1d5db', bg: '#1f2937' },
    partTracking: { label: 'PT',     color: '#86efac', bg: '#14532d' },
    sensor:       { label: 'SENSOR', color: '#22d3ee', bg: '#164e63' },
  };

  // ── Universal-shell label vocabulary ─────────────────────────────────────────
  // v1.32.7: Lifted out of the (former) showBranchConfig IIFE so the OUTCOMES /
  // LOG / RETRY / DONE footer below can read them at every stage. Branch label
  // vocabulary flows from the CONDITION, never the mode.
  //   - Vision job → Pass / Fail
  //   - Range      → In Range / Out of Range
  //   - Binary (sensor / signal / state / condition / partTracking) → On / Off
  //     (Verify Off swaps so exit1 = picked polarity = the "good" side)
  //   - No condition picked yet → "—" placeholders (footer still renders)
  const vocab = (() => {
    const cond = conditions[0];
    if (!cond) return { exit1: '—', exit2: '—' };
    if (cond.signalType === 'visionJob') return { exit1: 'Pass', exit2: 'Fail' };
    if (cond.inputType === 'range' || cond.conditionType === 'range') {
      return { exit1: 'In Range', exit2: 'Out of Range' };
    }
    if (nodeMode === 'verify' && conditionType === 'off') {
      return { exit1: 'Off', exit2: 'On' };
    }
    return { exit1: 'On', exit2: 'Off' };
  })();
  const singleLabel = vocab.exit1;
  const dualLabel1 = vocab.exit1;
  const dualLabel2 = vocab.exit2;
  const isVision = signalType === 'visionJob';
  const isSensor = signalType === 'sensor' || !!sensorRef;
  const isVerify = nodeMode === 'verify';
  const isRange = sensorInputType === 'range';
  void isVision; void isSensor; void isVerify; void isRange;

  // Popup rendered via createPortal -- style comes from parent (fixed position, to the RIGHT)
  // Scale to match canvas zoom so the popup grows with zoomed-in nodes.
  const zoomStyle = useReactFlowZoomScale();
  const popupContent = (
    <div
      ref={popupRef}
      className="nodrag nowheel"
      style={{
        ...style,
        ...zoomStyle,
        width: 320,
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        fontSize: 14,
        color: '#1e293b',
        maxHeight: 520,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #e2e8f0' }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 4px' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {showBranchConfig
              ? (<>{signalType === 'visionJob' ? <DeviceIcon type="VisionSystem" size={14} /> : signalType === 'sensor' ? <DeviceIcon type={sensorInputType === 'range' ? 'AnalogSensor' : 'DigitalSensor'} size={14} /> : null} {signalName}</>)
              : editingConditionIdx !== null ? '✎ Change Condition'
              : addingCondition ? '+ Add Condition'
              // v1.30.5 — wizard banner shows where you are in the flow.
              // Stage A (no type yet) = "Pick Subject"; Stage B (type drilled,
              // no device chosen) = "Pick Subject"; Stage C (device drilled)
              // = "Pick Check".
              : pickerStage === 'check' ? 'Pick Check'
              : 'Pick Subject'}
          </span>
          {showBranchConfig ? (
            <button
              className="nodrag"
              onClick={() => setShowBranchConfig(false)}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}
            >{'\u2190'} Back</button>
          ) : editingConditionIdx !== null ? (
            <button
              className="nodrag"
              onClick={() => { setEditingConditionIdx(null); setShowBranchConfig(true); }}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}
            >{'\u2190'} Cancel</button>
          ) : addingCondition ? (
            <button
              className="nodrag"
              onClick={() => { setAddingCondition(false); setShowBranchConfig(true); }}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}
            >{'\u2190'} Cancel</button>
          ) : (
            <button
              className="nodrag"
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
            >{'\u00d7'}</button>
          )}
        </div>
        {/* v1.32 — Wait/Check toggle removed; action verb is now picked in
            the Action stage of the stepper below. The 4 stepper pills (Subject
            / Detail / Action / Value) ARE the navigator — clicking each loads
            that stage's picker into the body. */}
      </div>

      {/* Wizard stepper — three steps: Subject (CATEGORY) → Check (picked
          item) → Action (polarity). The active step glows (blue ring),
          completed steps go solid green with their picked value, downstream
          steps render gray. Hidden when editing or adding a condition (those
          are sub-flows that don't follow the main wizard).

          v1.30.6 — Subject is the CATEGORY (Signals / Sensors / Vision /
          Robot / Part Tracking / Part Results) — NOT the picked item. Per
          user: "What are we looking at? A signal. What's the signal?
          AllStationsReady. So Subject should say Signals." Check is the
          specific picked item ("AllStationsReady"). Action is the polarity
          (formerly "Polarity" — user said that word makes no sense; the
          mental model is "the subject, the check, the action"). */}
      {editingConditionIdx === null && !addingCondition && (() => {
        // Which step is the user on?
        //   showBranchConfig=true → action (final step, picked subject+check)
        //   subjectTypeView !== null → check (Stage B picks item, Stage C
        //                                     drills into a multi-check
        //                                     device — both are the user
        //                                     actively choosing the CHECK)
        //   anything else → subject (Stage A: pick a category)
        // v1.31 — 4-step cascade: Subject → Detail → Action → Value.
        // Subject = the type of thing (Signal/Cylinder/Sensor/etc.).
        // Detail  = the specific named instance within that type.
        // Action  = the verb (Wait/Check/Branch).
        // Value   = the polarity / sub-instance the action targets.
        // v1.32 — activeStage is now the canonical source of truth (state at
        // top of component). Stepper pills are clickable; clicking calls
        // goToStage() which syncs the legacy showBranchConfig / subjectTypeView
        // flags so the existing sub-flow handlers keep working.

        // v1.32.2 — Pill labels follow the USER'S CONTRACT, not bucket names.
        // The bucket cards in Stage A ("Devices", "Sensors", etc.) are pure
        // navigation — they are NOT subjects. Picking a bucket does NOT
        // populate the SUBJECT pill. Only picking a specific item does.
        //
        // SUBJECT comes from the picked thing itself:
        //   • Physical device (cylinder/gripper/vacuum/servo/sensor/probe/
        //     camera/robot) → device.displayName
        //   • Project signal                                       → "Signal"
        //   • Part Tracking field                                  → "PT"
        //
        // DETAIL+VALUE pills HIDE for "single-state" subjects whose action
        // already encodes everything there is to check:
        //   • Cylinder, Gripper, Vacuum, Digital sensor → SUBJECT + ACTION only
        // Everything else shows all four pills.
        const findDeviceById = (dId) => (currentSm?.devices ?? []).find(d => d.id === dId)
          ?? allSMs.flatMap(m => m.devices ?? []).find(d => d.id === dId)
          ?? null;

        // Subject types whose pills collapse to SUBJECT + ACTION only.
        // The check picker (Stage C) for these picks the ACTION, not a detail.
        const isMinimalPillSet = (t) =>
          t === 'PneumaticLinearActuator' || t === 'PneumaticRotaryActuator'
          || t === 'PneumaticGripper'      || t === 'PneumaticVacGenerator'
          || t === 'DigitalSensor';

        const deriveStepperLabels = () => {
          // ── Committed: a condition has been picked. Derive per the table. ──
          if (conditions.length > 0) {
            const cond0 = conditions[0];
            const rawLabel = cond0.label ?? signalName ?? '';

            // Project signal (state / position / condition)
            if (cond0.signalType === 'state' || cond0.signalType === 'position'
                || cond0.signalType === 'condition' || cond0.signalType === 'signal') {
              return { subject: 'Signal', detail: signalName || rawLabel, hideDetail: false, hideValue: false };
            }
            // Part Tracking
            if (cond0.signalType === 'partTracking' || cond0.signalType === 'partResult') {
              return { subject: 'PT', detail: signalName || rawLabel, hideDetail: false, hideValue: false };
            }

            // Device-backed pick — derive from the device's type
            const devId = (typeof cond0.ref === 'string' && cond0.ref.includes(':'))
              ? cond0.ref.split(':')[0] : null;
            const dev = devId ? findDeviceById(devId) : null;
            const devName = dev?.displayName ?? dev?.name ?? '';

            // Strip the device-name prefix from rawLabel so the DETAIL pill
            // shows only the slot/check name (e.g., "Probe - HeightCheck"
            // becomes "HeightCheck"). Used by analog/servo/robot/vision.
            const stripDevPrefix = () => {
              if (!devName) return rawLabel;
              for (const sep of [' - ', ' @ ', ' ']) {
                if (rawLabel.startsWith(devName + sep)) {
                  return rawLabel.slice(devName.length + sep.length).trim();
                }
              }
              return rawLabel === devName ? rawLabel : rawLabel;
            };

            // Vision job signal (separate from a VisionSystem device pick)
            if (cond0.signalType === 'visionJob' || decisionType === 'vision') {
              const detail = signalName || rawLabel.split('\u2192').pop()?.trim() || rawLabel;
              return { subject: devName || 'Camera', detail, hideDetail: false, hideValue: false };
            }

            if (isMinimalPillSet(dev?.type)) {
              // Cylinder/Gripper/Vacuum/Digital sensor → only SUBJECT + ACTION
              return { subject: devName, detail: null, hideDetail: true, hideValue: true };
            }
            if (dev?.type === 'ServoAxis') {
              return { subject: devName, detail: stripDevPrefix(), hideDetail: false, hideValue: false };
            }
            if (dev?.type === 'AnalogSensor') {
              return { subject: devName, detail: stripDevPrefix(), hideDetail: false, hideValue: false };
            }
            if (dev?.type === 'VisionSystem') {
              return { subject: devName, detail: stripDevPrefix(), hideDetail: false, hideValue: false };
            }
            if (dev?.type === 'Robot') {
              return { subject: devName, detail: stripDevPrefix(), hideDetail: false, hideValue: false };
            }
            if (dev?.type === 'Parameter') {
              return { subject: 'Signal', detail: devName, hideDetail: false, hideValue: false };
            }

            // Fallback: unknown device type — show the raw label
            return { subject: devName || 'Subject', detail: rawLabel, hideDetail: false, hideValue: false };
          }

          // ── Pre-commit: nothing picked yet. ──
          // Mid-drill on a multi-check device (Stage C): preview the SUBJECT
          // pill with the device name so the user knows what they're picking
          // a check on. The check itself fills DETAIL/ACTION on commit.
          if (draftDeviceId) {
            const dev = findDeviceById(draftDeviceId);
            const devName = dev?.displayName ?? dev?.name ?? null;
            const hideDetail = isMinimalPillSet(dev?.type);
            const hideValue  = hideDetail;
            return { subject: devName, detail: null, hideDetail, hideValue };
          }

          // Stage A or B with no specific item picked → all pills empty.
          // The bucket name ("Devices", "Sensors") is NOT a subject and
          // must not pre-fill the SUBJECT pill.
          return { subject: null, detail: null, hideDetail: false, hideValue: false };
        };

        const { subject: subjectCategory, detail: checkValue, hideDetail, hideValue } = deriveStepperLabels();

        const stepStyle = (state) => {
          // v1.32.6 — pills bumped UP from 9px/4px to 11px/6px for parity
          // with InlinePicker. Body items stay tight (font 11, pad 4×8) so
          // the pills still lead visually.
          const base = {
            flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.04em', textTransform: 'uppercase',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            transition: 'all .15s', minWidth: 0,
          };
          if (state === 'active') return {
            ...base,
            background: '#dbeafe', color: '#1d4ed8',
            border: '1px solid #3b82f6',
            boxShadow: '0 0 0 2px rgba(59,130,246,0.25)',
          };
          if (state === 'completed') return {
            ...base,
            background: '#16a34a', color: '#fff',
            border: '1px solid #15803d',
          };
          return {
            ...base,
            background: '#f1f5f9', color: '#94a3b8',
            border: '1px solid #e2e8f0',
          };
        };

        // v1.32.2 — A pill is "completed" only when its slot has a real
        // value. Picking a Stage A bucket (which is just navigation) does
        // NOT complete the SUBJECT pill — the user hasn't picked a subject
        // yet, only a category. SUBJECT completes when conditions[0] exists
        // OR the user is mid-drill on a specific device (draftDeviceId).
        const subjectPicked = !!subjectCategory;
        const detailPicked  = conditions.length > 0 && !!checkValue;
        const actionPicked  = conditions.length > 0;
        // Value is implicitly set the moment a condition exists (defaults to
        // 'on' / Pass / On-tol). It only goes "completed" once the user has
        // explicitly visited the Value stage OR committed via Done. For now,
        // mark it completed whenever a detail exists — the polarity buttons
        // always have a default selection, so there's nothing "missing".
        const valuePicked   = conditions.length > 0;

        const pillState = (stage, picked) =>
          activeStage === stage ? 'active'
          : picked              ? 'completed'
          : 'pending';

        const subjectState = pillState('subject', subjectPicked);
        const detailState  = pillState('detail',  detailPicked);
        const actionState  = pillState('action',  actionPicked);
        const valueState   = pillState('value',   valuePicked);

        // Derive the verb shown in the Action pill once it's filled. Falls
        // back to "Wait" / "Check" / "Decide" depending on saved nodeMode.
        const actionLabel = (() => {
          if (!actionPicked) return null;
          if (nodeMode === 'wait') return 'Wait';
          if (nodeMode === 'decide') return 'Decide';
          return 'Check';
        })();
        // Derive the polarity / outcome label shown in the Value pill.
        const valueLabel = (() => {
          if (!valuePicked) return null;
          const cond0 = (conditions ?? [])[0];
          if (!cond0) return null;
          if (cond0.signalType === 'visionJob') {
            return cond0.conditionType === 'off' ? 'Fail' : 'Pass';
          }
          if (cond0.inputType === 'range') return 'In Range';
          // Detect analog probe by ref → device type
          if (typeof cond0.ref === 'string' && cond0.ref.includes(':')) {
            const devId = cond0.ref.split(':')[0];
            const dev = (currentSm?.devices ?? []).find(d => d.id === devId);
            if (dev?.type === 'AnalogSensor') {
              return cond0.conditionType === 'off' ? 'Out' : 'In Tol';
            }
          }
          return cond0.conditionType === 'off' ? 'Off' : 'On';
        })();

        const StepPill = ({ name, value, state, stage }) => (
          <button
            type="button"
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); goToStage(stage); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              ...stepStyle(state),
              cursor: 'pointer',
              fontFamily: 'inherit',
              outline: 'none',
            }}
            title={`Go to ${name} stage`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, lineHeight: 1.1 }}>
              {state === 'completed' && <span>{'\u2713'}</span>}
              <span>{name}</span>
            </span>
            {value && (
              <span style={{
                fontSize: 9, fontWeight: 600,
                color: state === 'completed' ? 'rgba(255,255,255,0.85)' : '#64748b',
                textTransform: 'none', letterSpacing: 0,
                maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{value}</span>
            )}
          </button>
        );

        return (
          <div style={{
            flexShrink: 0, padding: '6px 10px',
            borderBottom: '1px solid #e2e8f0', background: '#f8fafc',
            display: 'flex', alignItems: 'stretch', gap: 4,
          }}>
            {/* Visual order: ACTION | SUBJECT | DETAIL | VALUE. Matches the
                left-to-right reading of the rendered action row in the node
                ("Wait VerticalCylinder Extended On"). Filling order is still
                subject-first behind the scenes — the active highlight just
                jumps backward to ACTION after subject is committed. */}
            <StepPill stage="action"  name="Action"  value={actionLabel}     state={actionState} />
            <span style={{ fontSize: 11, color: '#cbd5e1', alignSelf: 'center' }}>{'\u203A'}</span>
            <StepPill stage="subject" name="Subject" value={subjectCategory} state={subjectState} />
            {!hideDetail && (
              <>
                <span style={{ fontSize: 11, color: '#cbd5e1', alignSelf: 'center' }}>{'\u203A'}</span>
                <StepPill stage="detail"  name="Detail"  value={checkValue}      state={detailState} />
              </>
            )}
            {!hideValue && (
              <>
                <span style={{ fontSize: 11, color: '#cbd5e1', alignSelf: 'center' }}>{'\u203A'}</span>
                <StepPill stage="value"   name="Value"   value={valueLabel}      state={valueState} />
              </>
            )}
          </div>
        );
      })()}

      {/* -- Subject picker (step 1) -- v1.30.5 THREE-STAGE step-by-step builder.
            Stage A (subjectTypeView === null): big TYPE CARDS only —
              Vision / Part Results / Part Tracking / Sensors & Devices /
              Robot / Signals. Each card shows item count and an arrow.
            Stage B (subjectTypeView set, pickerStage === 'subject'): drill
              into that ONE type's items, grouped by DEVICE. Multi-check
              devices (probe with N setpoints, 2-sensor cylinder, robot with
              many signals) show as a single "{Device} › {N} checks" button
              that advances to Stage C. Single-check devices commit directly.
            Stage C (pickerStage === 'check'): per-device check picker — list
              the checks belonging to draftDeviceId so the user can pick the
              specific slot (Extended/Retracted, Part1 setpoint, MagnetPick
              signal). "Back" goes to Stage B for the same subject type.
            Picking an item still calls the same handlers (handleVisionPick /
            handlePTPick / handleSensorPick / handleSignalPick) which advance
            the popup to the branch-config step. */}
      {!showBranchConfig && (() => {
        // v1.32 — Stage A buckets are SPLIT and REORDERED to match the user's
        // mental model. Old behavior lumped actuators + sensors into "Sensors
        // & Devices" and put PT high in the list; new behavior:
        //
        //   1. Devices       — cylinders, grippers, vacuum, servo positions
        //   2. Sensors       — digital sensors, analog probes
        //   3. Vision        — camera jobs + vision-device signals
        //   4. Robots        — robot DI / DO from any robot device
        //   5. Signals       — project signals (state, position, condition)
        //                      + parameter devices (recipe / position params)
        //   6. Part Results  — vision-linked PT fields (bottom)
        //   7. Part Tracking — user-defined PT fields (very bottom)
        //
        // Each input group from buildAvailableInputs() lands in exactly one
        // bucket. The mapping is keyed on `inp.group` (the static group string
        // assigned at input-build time, e.g. "Cylinders / Actuators").
        const bucketForInput = (inp) => {
          const g = inp?.group ?? '';
          if (typeof g === 'string' && g.startsWith('Robot ')) return 'robots';
          if (g === 'Cylinders / Actuators' || g === 'Grippers'
              || g === 'Vacuum' || g === 'Servo Positions') return 'devices';
          if (g === 'Sensors' || g === 'Analog Sensors')      return 'sensors';
          if (g === 'Vision')      return 'vision';
          if (g === 'Parameters')  return 'signals';
          return 'devices';
        };
        const devicesPool = sensorInputs.filter(inp => bucketForInput(inp) === 'devices');
        const sensorsPool = sensorInputs.filter(inp => bucketForInput(inp) === 'sensors');
        const visionPool  = sensorInputs.filter(inp => bucketForInput(inp) === 'vision');
        const robotsPool  = sensorInputs.filter(inp => bucketForInput(inp) === 'robots');
        const paramsPool  = sensorInputs.filter(inp => bucketForInput(inp) === 'signals');
        // Stage C / pickerStage='check' walks `[...deviceInputs, ...robotInputs]`
        // looking up checks by deviceId — both names retained for back-compat.
        const deviceInputs = [...devicesPool, ...sensorsPool, ...visionPool, ...paramsPool];
        const robotInputs  = robotsPool;

        const visionLinkedFields = ptFields.filter(f => f._visionLinked);
        const userPtFields       = ptFields.filter(f => !f._visionLinked);

        // Helper: group an input array into Map<deviceId, inputs[]>.
        // Used by Stage B to collapse multi-check devices into one button,
        // and by Stage C to find the picked device's checks.
        const groupByDevice = (items) => {
          const map = new Map();
          for (const inp of items) {
            const dId = inp.ref?.split(':')[0];
            if (!dId) continue;
            if (!map.has(dId)) map.set(dId, []);
            map.get(dId).push(inp);
          }
          return map;
        };
        // Lookup: device by id, searching all SMs (cross-SM robots / params).
        const findDevice = (dId) => (currentSm?.devices ?? []).find(d => d.id === dId)
          ?? allSMs.flatMap(m => m.devices ?? []).find(d => d.id === dId)
          ?? null;

        // Stage C: per-device CHECK picker. The user has already chosen a
        // subject TYPE (sensors/robot) AND drilled into a specific device.
        // Now they pick which slot/check on that device — Extended/Retracted
        // for a 2-sensor cylinder, a setpoint name for a probe, a signal
        // name for a robot, etc. Single-check devices skip this stage.
        if (pickerStage === 'check' && draftDeviceId) {
          const dev = findDevice(draftDeviceId);
          const devName = dev?.displayName ?? dev?.name ?? 'Device';
          const devType = dev?.type ?? 'DigitalSensor';
          // The draftDeviceId could have come from either the sensors or
          // robot pool; filter both so the right checks appear.
          const allInputs = [...deviceInputs, ...robotInputs];
          const checks = allInputs.filter(inp => inp.ref?.split(':')[0] === draftDeviceId);
          const isRobotDev = devType === 'Robot';
          const accentHex = isRobotDev ? '#a78bfa' : '#22d3ee';
          const accentBg  = isRobotDev ? '#3b2a6b' : '#164e63';
          // Strip the device prefix from the input label so we render only
          // the check name (label = "ProbeCheck - Part1" → "Part1").
          const stripDevPrefix = (label) => {
            if (!label) return label;
            // Try common separators: "Device - Check", "Device Check", "Device @ Check"
            for (const sep of [' - ', ' @ ', ' ']) {
              if (label.startsWith(devName + sep)) return label.slice(devName.length + sep.length).trim();
            }
            return label;
          };
          return (
            <div ref={listRef} style={{ padding: '4px 0', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Back to Stage B */}
              <button
                className="nodrag"
                onClick={() => { setPickerStage('subject'); setDraftDeviceId(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'none', border: 'none',
                  fontSize: 11, color: '#0072B5', cursor: 'pointer',
                  padding: '8px 12px 4px', fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 14 }}>{'\u2039'}</span>
                <span>Back</span>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>· Subjects</span>
              </button>
              {/* Wizard banner: shows the picked subject + "PICK CHECK" hint
                  so the user always knows where they are in the flow. */}
              <div className="nodrag" style={{
                display: 'flex', alignItems: 'center', gap: 8,
                margin: '2px 10px 6px', padding: '6px 8px', borderRadius: 6,
                background: '#eff6ff', border: '1px solid #bfdbfe',
              }}>
                <DeviceIcon type={devType} size={16} color={accentHex} />
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: '#1d4ed8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Subject
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {devName}
                  </span>
                </span>
              </div>
              <div className="nodrag" style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', letterSpacing: '0.05em', textTransform: 'uppercase', padding: '4px 12px 4px' }}>
                Pick Check
              </div>
              {checks.length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>
                  No checks available on this device.
                </div>
              ) : checks.map(inp => (
                <button
                  key={inp.ref}
                  className="nodrag"
                  onClick={() => {
                    handleSensorPick(inp);
                    setPickerStage('subject');
                    setDraftDeviceId(null);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: signalId === `sensor_${inp.ref}` ? '#f1f5f9' : 'none',
                    border: 'none', borderLeft: signalId === `sensor_${inp.ref}` ? `3px solid ${accentHex}` : '3px solid transparent',
                    color: '#1e293b', cursor: 'pointer', padding: '7px 12px 7px 28px',
                    textAlign: 'left', fontSize: 11,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = signalId === `sensor_${inp.ref}` ? '#f1f5f9' : 'none'; }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stripDevPrefix(inp.label)}
                  </span>
                  <span style={{
                    fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                    color: inp.inputType === 'range' ? '#fbbf24' : accentHex,
                    background: inp.inputType === 'range' ? '#78350f' : accentBg,
                  }}>
                    {inp.inputType === 'range' ? 'RANGE' : 'BOOL'}
                  </span>
                </button>
              ))}
            </div>
          );
        }

        // v1.32.5 — UNIFIED FLAT-LIST SUBJECT PICKER.
        // The old flow was Stage A (bucket cards) → drill into Stage B (one
        // type at a time). The user wants every subject visible at once
        // grouped by TYPE HEADING — same shape as InlinePicker in
        // StateNode.jsx. Multi-check devices still drill into Stage C
        // (pickerStage === 'check') for the per-device check pick; single-
        // check devices commit directly. `subjectTypeView` is no longer
        // read for routing — kept around only so existing setSubjectTypeView
        // calls in handlers don't crash.
        const groupBy = (items) => {
          const out = {};
          for (const inp of items) {
            const g = inp.group || 'Other';
            if (!out[g]) out[g] = [];
            out[g].push(inp);
          }
          return out;
        };
        const devicesGrouped = groupBy(devicesPool);
        const sensorsGrouped = groupBy(sensorsPool);
        const visionGrouped  = groupBy(visionPool);
        const robotGrouped   = groupBy(robotsPool);
        const renderSensorItem = (inp, accentHex, accentBg) => (
          <button
            key={inp.ref}
            className="nodrag"
            onClick={() => handleSensorPick(inp)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', background: signalId === `sensor_${inp.ref}` ? '#f1f5f9' : 'none',
              border: 'none', borderLeft: signalId === `sensor_${inp.ref}` ? `3px solid ${accentHex}` : '3px solid transparent',
              color: '#1e293b', cursor: 'pointer', padding: '4px 8px 4px 22px',
              textAlign: 'left', fontSize: 11,
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.label}</span>
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
              color: inp.inputType === 'range' ? '#fbbf24' : accentHex,
              background: inp.inputType === 'range' ? '#78350f' : accentBg,
            }}>
              {inp.inputType === 'range' ? 'RANGE' : 'BOOL'}
            </span>
          </button>
        );

        // Empty-state guard: no subjects of any kind anywhere.
        const totalCount = visionSignals.length + visionLinkedFields.length + userPtFields.length
          + devicesPool.length + sensorsPool.length + visionPool.length + robotsPool.length
          + projectSignals.length + paramsPool.length;
        if (totalCount === 0) {
          return (
            <div style={{ padding: '16px 12px', fontSize: 10, color: '#6b7280', fontStyle: 'italic', textAlign: 'center' }}>
              No signals or sensors available.<br/>Add devices, Signals, or Part Tracking fields.
            </div>
          );
        }

        // Section header — TYPE label + count, accent-colored. Mirrors
        // InlinePicker (StateNode.jsx) so the two pickers look identical.
        const SectionHeader = ({ label, color, count }) => (
          <div className="nodrag" style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
            color, padding: '4px 8px 2px',
            textTransform: 'uppercase',
            borderBottom: `1px solid ${color}22`,
            marginBottom: 2,
          }}>
            {label} <span style={{ color: '#cbd5e1', fontWeight: 600 }}>({count})</span>
          </div>
        );
        const EmptyRow = () => (
          <div style={{ fontSize: 10, color: '#cbd5e1', padding: '2px 8px 3px', fontStyle: 'italic' }}>
            none
          </div>
        );

        // ── SECTION RENDERERS ─────────────────────────────────────────
        // Each renders ONE typed list. Headers are always emitted so the
        // user sees the full taxonomy at once.

        // DEVICES + SENSORS share the device-grouped layout (single-check
        // commits directly, multi-check drills into Stage C).
        const renderDevSensSection = (groupedObj, accentHex, accentBg) =>
          Object.entries(groupedObj).map(([groupName, items]) => {
            const byDev = groupByDevice(items);
            const firstItem = items[0];
            const sampleDevId = firstItem?.ref?.split(':')[0];
            const sampleDev = sampleDevId ? findDevice(sampleDevId) : null;
            const subIconType = sampleDev?.type ?? 'DigitalSensor';
            return (
              <div key={groupName}>
                <div className="nodrag" style={{ fontSize: 10, color: '#4b5563', padding: '4px 8px 2px 12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <DeviceIcon type={subIconType} size={12} />
                  {groupName}
                </div>
                {Array.from(byDev.entries()).map(([dId, devInputs]) => {
                  if (devInputs.length === 1) {
                    return renderSensorItem(devInputs[0], accentHex, accentBg);
                  }
                  const dev = findDevice(dId);
                  const devName = dev?.displayName ?? dev?.name ?? devInputs[0]?.label ?? 'Device';
                  const devType = dev?.type ?? 'DigitalSensor';
                  return (
                    <button
                      key={dId}
                      className="nodrag"
                      onClick={() => { setDraftDeviceId(dId); setPickerStage('check'); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        width: '100%', background: 'none',
                        border: 'none', borderLeft: '3px solid transparent',
                        color: '#1e293b', cursor: 'pointer', padding: '4px 8px 4px 22px',
                        textAlign: 'left', fontSize: 11,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      <DeviceIcon type={devType} size={12} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{devName}</span>
                      <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap' }}>{devInputs.length} checks</span>
                      <span style={{ fontSize: 14, color: '#cbd5e1' }}>{'\u203A'}</span>
                    </button>
                  );
                })}
              </div>
            );
          });

        return (
          <div ref={listRef} style={{ padding: '4px 0', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>

            {/* ── DEVICES ─────────────────────────────────────────────── */}
            <SectionHeader label="Devices" color="#475569" count={devicesPool.length} />
            {devicesPool.length === 0
              ? <EmptyRow />
              : renderDevSensSection(devicesGrouped, '#475569', '#1e293b')}

            {/* ── SENSORS ─────────────────────────────────────────────── */}
            <SectionHeader label="Sensors" color="#d97706" count={sensorsPool.length} />
            {sensorsPool.length === 0
              ? <EmptyRow />
              : renderDevSensSection(sensorsGrouped, '#d97706', '#78350f')}

            {/* ── VISION ──────────────────────────────────────────────── */}
            <SectionHeader label="Vision" color="#7c3aed" count={visionSignals.length + visionPool.length} />
            {(visionSignals.length + visionPool.length) === 0 && <EmptyRow />}
            {visionSignals.map(sig => (
              <button
                key={sig.id}
                className="nodrag"
                onClick={() => handleVisionPick(sig)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', background: signalId === sig.id ? '#eff6ff' : 'none',
                  border: 'none', borderLeft: signalId === sig.id ? '3px solid #f59e0b' : '3px solid transparent',
                  color: '#1e293b', cursor: 'pointer', padding: '4px 8px',
                  textAlign: 'left', fontSize: 11,
                }}
              >
                <DeviceIcon type="VisionSystem" size={12} color="#0891b2" />
                <span style={{ flex: 1 }}>{sig.signalName}</span>
                <span style={{ fontSize: 9, color: '#9ca3af' }}>{sig.signalSource}</span>
              </button>
            ))}
            {Object.entries(visionGrouped).map(([groupName, items]) => {
              const byDev = groupByDevice(items);
              return (
                <div key={`v_${groupName}`}>
                  <div className="nodrag" style={{ fontSize: 10, color: '#4b5563', padding: '4px 8px 2px 12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <DeviceIcon type="VisionSystem" size={12} color="#7c3aed" />
                    {groupName}
                  </div>
                  {Array.from(byDev.entries()).map(([dId, devInputs]) => {
                    if (devInputs.length === 1) {
                      return renderSensorItem(devInputs[0], '#7c3aed', '#3b2a6b');
                    }
                    const dev = findDevice(dId);
                    const devName = dev?.displayName ?? dev?.name ?? devInputs[0]?.label ?? 'Vision';
                    return (
                      <button
                        key={dId}
                        className="nodrag"
                        onClick={() => { setDraftDeviceId(dId); setPickerStage('check'); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          width: '100%', background: 'none',
                          border: 'none', borderLeft: '3px solid transparent',
                          color: '#1e293b', cursor: 'pointer', padding: '4px 8px 4px 22px',
                          textAlign: 'left', fontSize: 11,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                      >
                        <DeviceIcon type="VisionSystem" size={12} color="#7c3aed" />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{devName}</span>
                        <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap' }}>{devInputs.length} checks</span>
                        <span style={{ fontSize: 14, color: '#cbd5e1' }}>{'\u203A'}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* ── ROBOTS ──────────────────────────────────────────────── */}
            <SectionHeader label="Robots" color="#ea580c" count={robotsPool.length} />
            {robotsPool.length === 0 && <EmptyRow />}
            {Object.entries(robotGrouped).map(([groupName, items]) => {
              const subLabel = groupName.replace(/^Robot\s+/, '');
              const byDev = groupByDevice(items);
              return (
                <div key={`r_${groupName}`}>
                  <div className="nodrag" style={{ fontSize: 10, color: '#4b5563', padding: '4px 8px 2px 12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <DeviceIcon type="Robot" size={12} color="#7c3aed" />
                    {subLabel}
                  </div>
                  {Array.from(byDev.entries()).map(([dId, devInputs]) => {
                    if (devInputs.length === 1) {
                      return renderSensorItem(devInputs[0], '#a78bfa', '#3b2a6b');
                    }
                    const dev = findDevice(dId);
                    const devName = dev?.displayName ?? dev?.name ?? devInputs[0]?.label ?? 'Robot';
                    return (
                      <button
                        key={dId}
                        className="nodrag"
                        onClick={() => { setDraftDeviceId(dId); setPickerStage('check'); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          width: '100%', background: 'none',
                          border: 'none', borderLeft: '3px solid transparent',
                          color: '#1e293b', cursor: 'pointer', padding: '4px 8px 4px 22px',
                          textAlign: 'left', fontSize: 11,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                      >
                        <DeviceIcon type="Robot" size={12} color="#7c3aed" />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{devName}</span>
                        <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap' }}>{devInputs.length} signals</span>
                        <span style={{ fontSize: 14, color: '#cbd5e1' }}>{'\u203A'}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* ── SIGNALS ─────────────────────────────────────────────── */}
            <SectionHeader label="Signals" color="#4f46e5" count={projectSignals.length + paramsPool.length} />
            {(projectSignals.length + paramsPool.length) === 0 && <EmptyRow />}
            {projectSignals.map(sig => {
              const badge = typeBadgeMap[sig.type];
              const cleanState = (sig.stateName ?? '').replace(/^\[\d+\]\s*[✓⌂⏳]?\s*/, '');
              const subtext = sig.type === 'state' && sig.smName && cleanState
                ? `${sig.smName} \u2192 ${cleanState}`
                : (sig.type === 'state' && sig.smName ? sig.smName : null);
              return (
                <button
                  key={sig.id}
                  className="nodrag"
                  onClick={() => handleSignalPick(sig)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: 'none',
                    border: 'none', borderLeft: '3px solid transparent',
                    color: '#1e293b', cursor: 'pointer', padding: '4px 8px',
                    textAlign: 'left', fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1 }}>{sig.name}</span>
                  {subtext && <span style={{ fontSize: 9, color: '#9ca3af', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtext}</span>}
                  {badge && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, color: badge.color, background: badge.bg }}>{badge.label}</span>}
                </button>
              );
            })}
            {paramsPool.length > 0 && (
              <>
                <div className="nodrag" style={{ fontSize: 10, color: '#4b5563', padding: '4px 8px 2px 12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <DeviceIcon type="Parameter" size={12} color="#4f46e5" />
                  Parameters
                </div>
                {paramsPool.map(inp => renderSensorItem(inp, '#4f46e5', '#1e1b4b'))}
              </>
            )}

            {/* ── PART RESULTS (vision-linked PT fields) ──────────────── */}
            <SectionHeader label="Part Results" color="#fbbf24" count={visionLinkedFields.length} />
            {visionLinkedFields.length === 0 && <EmptyRow />}
            {visionLinkedFields.map(field => {
              const isCurrentSm = field._visionSmId === smId;
              return (
                <button
                  key={field.id}
                  className="nodrag"
                  onClick={() => handlePTPick(field)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: signalId === `pt_${field.id}` ? '#fef9c3' : 'none',
                    border: 'none', borderLeft: signalId === `pt_${field.id}` ? '3px solid #fbbf24' : '3px solid transparent',
                    color: '#1e293b', cursor: 'pointer', padding: '4px 8px',
                    textAlign: 'left', fontSize: 11,
                  }}
                >
                  <DeviceIcon type="VisionSystem" size={12} color="#fbbf24" />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                    <span>{field.name}</span>
                    {field._visionSmName && (
                      <span style={{ fontSize: 8, color: isCurrentSm ? '#6b7280' : '#fbbf24' }}>
                        {isCurrentSm ? 'this station' : `from: ${field._visionSmName}`}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, color: '#fbbf24', background: '#78350f' }}>
                    {field.type === 'real' ? 'REAL' : 'PASS'}
                  </span>
                </button>
              );
            })}

            {/* ── PART TRACKING (user-defined PT fields) ──────────────── */}
            <SectionHeader label="Part Tracking" color="#16a34a" count={userPtFields.length} />
            {userPtFields.length === 0 && <EmptyRow />}
            {userPtFields.map(field => (
              <button
                key={field.id}
                className="nodrag"
                onClick={() => handlePTPick(field)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', background: signalId === `pt_${field.id}` ? '#f0fdf4' : 'none',
                  border: 'none', borderLeft: signalId === `pt_${field.id}` ? '3px solid #86efac' : '3px solid transparent',
                  color: '#1e293b', cursor: 'pointer', padding: '4px 8px',
                  textAlign: 'left', fontSize: 11,
                }}
              >
                <DeviceIcon type="Parameter" size={12} color="#f97316" />
                <span style={{ flex: 1 }}>{field.name}</span>
                <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, color: '#86efac', background: '#14532d' }}>PT</span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* -- Branch config (step 2) -- works for vision, signals, sensors */}
      {showBranchConfig && (() => {
        // Local type flags — used by JSX below (sensor condition config,
        // range picker, etc.). Keep these in sync with the standalone
        // DecisionNode component's equivalents (search for `const isSensor`).
        const isVision = signalType === 'visionJob';
        const isSensor = signalType === 'sensor' || !!sensorRef;
        const isVerify = nodeMode === 'verify';
        const isRange = sensorInputType === 'range';

        // Branch label vocabulary flows from the CONDITION, never the mode.
        //   - Vision job → Pass / Fail (vision jobs have named outcomes)
        //   - Range      → In Range / Out of Range
        //   - Binary (sensor, signal, state, condition, partTracking) → On / Off
        //     (Verify Off swaps so exit1 = picked polarity = the "good" side)
        //   - Nothing picked yet → generic "—"
        // There is NO "Pass/Fail" or "True/False" for Verify or Decide modes;
        // both those modes assert/branch on a condition, and the condition's
        // own vocabulary (On/Off, InRange/OutOfRange) is what we show.
        const vocab = (() => {
          const cond = conditions[0];
          if (!cond) return { exit1: '—', exit2: '—' };
          if (cond.signalType === 'visionJob') return { exit1: 'Pass', exit2: 'Fail' };
          if (cond.inputType === 'range' || cond.conditionType === 'range') {
            return { exit1: 'In Range', exit2: 'Out of Range' };
          }
          if (nodeMode === 'verify' && conditionType === 'off') {
            return { exit1: 'Off', exit2: 'On' };
          }
          return { exit1: 'On', exit2: 'Off' };
        })();
        const singleLabel = vocab.exit1;
        const dualLabel1 = vocab.exit1;
        const dualLabel2 = vocab.exit2;
        // Silence unused-var lint; several of these are referenced only by
        // deeper JSX branches that may or may not render for a given mode.
        void isVision; void isSensor; void isVerify; void isRange;
        return (
        <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>

          {/* ── ACTION stage picker — Wait / Check / Decide cards ──────────────
              v1.32: replaces the legacy CHECK card. Renders only when the
              user is on the Action stage of the stepper. Each verb is a full-
              width card with a one-line description. Picking a verb sets
              nodeMode AND adjusts exitCount (Wait collapses to 1, Decide forces
              ≥2, Check stays put). The verb you pick determines the node's
              behavior; outcome / log / retry below configure the rest. */}
          {activeStage === 'action' && (() => {
            const action = nodeMode === 'wait'   ? 'wait'
                         : nodeMode === 'decide' ? 'decide'
                         : 'check';
            const cards = [
              { key: 'wait',   label: 'Wait',   activeBg: '#0072B5', activeBorder: '#3b82f6', tip: 'Sit on the subject until the condition is true, then proceed.' },
              { key: 'check',  label: 'Check',  activeBg: '#0d9488', activeBorder: '#14b8a6', tip: 'Read the subject NOW and proceed. Branch on the result, log it, or both.' },
              { key: 'decide', label: 'Decide', activeBg: '#7c3aed', activeBorder: '#8b5cf6', tip: 'Fork the flow on the subject. Both paths are equal — no expected side.' },
            ];
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Action — what does this node do?
                </div>
                {cards.map(c => {
                  const isActive = action === c.key;
                  return (
                    <button
                      key={c.key}
                      className="nodrag"
                      onClick={() => {
                        setNodeMode(c.key);
                        // Outcome-count rules per verb:
                        //   wait + single condition → 1 exit (state just sits)
                        //   decide → ≥2 exits (branching is the entire point)
                        //   check → leave alone
                        let nextExitCount = exitCount;
                        if (c.key === 'wait' && exitCount > 1 && conditions.length <= 1) {
                          nextExitCount = 1;
                        }
                        if (c.key === 'decide' && exitCount < 2) {
                          nextExitCount = 2;
                        }
                        if (nextExitCount !== exitCount) setExitCount(nextExitCount);

                        // Live preview: push verb + exitCount immediately so
                        // the underlying node body re-derives its pills.
                        const livePatch = { nodeMode: c.key, exitCount: nextExitCount };
                        if (saveTarget === 'action' && actionId) {
                          store.updateAction(smId, nodeId, actionId, livePatch);
                        } else {
                          store.updateNodeData(smId, nodeId, livePatch);
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '9px 10px', borderRadius: 6, cursor: 'pointer',
                        background: isActive ? c.activeBg : '#fff',
                        border: isActive ? `1px solid ${c.activeBorder}` : '1px solid #d1d5db',
                        color: isActive ? '#fff' : '#1e293b',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{c.label}</span>
                      <span style={{
                        flex: 1, fontSize: 10, fontWeight: 500, lineHeight: 1.3,
                        color: isActive ? 'rgba(255,255,255,0.85)' : '#64748b',
                      }}>{c.tip}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── SLOT picker — drill into a multi-slot sensor device ──────────────
              Renders ONLY for sensor refs with multiple slots (an analog
              probe with multiple setpoints, a 2-sensor cylinder, a multi-
              position servo, a robot with multiple signals). For signals /
              PT / vision / single-slot sensors there's nothing to pick, so
              the section is hidden — the Check card above already names
              the picked item.

              Both wait AND check modes get this — wait nodes can also be
              waiting on a specific slot, so the gate is no longer
              `nodeMode !== 'wait'`. The cond0.inputType !== 'range' guard
              keeps it hidden for range probes (range has its own min/max
              inputs elsewhere). */}
          {(() => {
            const cond0 = conditions[0];
            if (!cond0) return null;
            if (conditions.length > 1) return null;
            const ref = cond0.ref;
            if (typeof ref !== 'string' || !ref.includes(':')) return null;
            const [devId, ...rest] = ref.split(':');
            if (!devId || devId === '_tracking') return null;
            const conditionKey = rest.join(':');
            const dev = (currentSm?.devices ?? []).find(d => d.id === devId);
            if (!dev) return null;

            // Available slots for this device.
            const condOptions = (() => {
              const opts = [];
              const arr = (dev.sensorArrangement ?? '').toLowerCase();
              const isBoth = arr.includes('2-sensor');
              const isExtOnly = arr.includes('ext only');
              const isRetOnly = arr.includes('ret only') || arr.includes('1-sensor');
              if (dev.type === 'AnalogSensor') {
                for (const sp of (dev.setpoints ?? [])) opts.push({ key: sp.name, label: sp.name });
              } else if (dev.type === 'PneumaticLinearActuator' || dev.type === 'PneumaticRotaryActuator') {
                if (isBoth || isExtOnly || (!isExtOnly && !isRetOnly)) opts.push({ key: 'ext', label: 'Extended' });
                if (isBoth || isRetOnly || (!isExtOnly && !isRetOnly)) opts.push({ key: 'ret', label: 'Retracted' });
              } else if (dev.type === 'PneumaticGripper') {
                if (isBoth || arr.includes('engaged only') || (!arr.includes('engaged only') && !isRetOnly)) opts.push({ key: 'eng', label: 'Engaged' });
                if (isBoth) opts.push({ key: 'dis', label: 'Disengaged' });
              } else if (dev.type === 'ServoAxis') {
                for (const pos of (dev.positions ?? [])) opts.push({ key: pos.name, label: pos.name });
              } else if (dev.type === 'Robot') {
                for (const sig of (dev.signals ?? [])) {
                  if (!sig.name?.trim()) continue;
                  opts.push({ key: sig.id, label: sig.name });
                }
              }
              return opts;
            })();

            // No multi-slot picking needed — bail. Single-slot devices have
            // their slot named in the Check card row label already.
            if (condOptions.length <= 1) return null;

            const currentKey = conditionKey;
            const slotLabel = (() => {
              if (dev.type === 'AnalogSensor') return 'Setpoint';
              if (dev.type === 'PneumaticLinearActuator'
                  || dev.type === 'PneumaticRotaryActuator'
                  || dev.type === 'PneumaticGripper') return 'Position';
              if (dev.type === 'ServoAxis') return 'Position';
              if (dev.type === 'Robot') return 'Signal';
              return 'Slot';
            })();

            return (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{slotLabel}</div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 5, lineHeight: 1.3 }}>
                  Which {slotLabel.toLowerCase()} on {dev.displayName ?? dev.name ?? 'this device'}?
                </div>
                <select
                  className="nodrag"
                  value={currentKey}
                  onChange={e => {
                    const newKey = e.target.value;
                    const newRef = `${devId}:${newKey}`;
                    const matchInput = sensorInputs.find(inp => inp.ref === newRef);
                    if (!matchInput) return;
                    setConditions(prev => prev.map((c, i) => i === 0
                      ? { ...c, ref: newRef, tag: matchInput.tag, label: matchInput.label, inputType: matchInput.inputType ?? 'bool' }
                      : c));
                    setSensorRef(newRef);
                    setSensorTag(matchInput.tag);
                    setSensorInputType(matchInput.inputType ?? 'bool');
                  }}
                  style={{
                    width: '100%', background: '#fff', border: '1px solid #d1d5db',
                    color: '#1e293b', borderRadius: 4, padding: '5px 6px', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {condOptions.map(opt => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>
            );
          })()}

          {/* ── VALUE stage picker — polarity (on/off, in tol/out, pass/fail) ──
              v1.32: replaces the legacy ACTION ON/OFF row. Renders only when
              the user is on the Value stage of the stepper. Vocabulary follows
              the subject: vision = Pass/Fail, analog probe = In Tol/Out,
              everything else = On/Off. Range conditions get min/max inputs
              instead of polarity buttons. Multi-condition mode: per-row
              polarity is set in the Detail stage so this is hidden. */}
          {activeStage === 'value' && (() => {
            const cond0 = conditions[0];
            if (!cond0) return null;
            if (conditions.length > 1) return null;
            const isRangeCond = cond0.inputType === 'range' || conditionType === 'range';

            // Detect analog probe subject (sensor ref pointing at an
            // AnalogSensor device). Vision jobs and PT / signals don't
            // qualify even though their refs may include colons.
            const ref = cond0.ref;
            let isAnalogSubj = false;
            if (typeof ref === 'string' && ref.includes(':') && cond0.signalType !== 'partTracking') {
              const devId = ref.split(':')[0];
              const dev = (currentSm?.devices ?? []).find(d => d.id === devId);
              if (dev?.type === 'AnalogSensor') isAnalogSubj = true;
            }
            const isVisionSubj = cond0.signalType === 'visionJob';

            // Range condition → show min/max inputs instead of On/Off pair.
            // The In Range / Out of Range branch labels are derived in the
            // Outcomes section and won't change here.
            if (isRangeCond) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Value — what range counts as in-tolerance?
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 2 }}>Min</div>
                      <input
                        className="nodrag" type="number" value={rangeMin}
                        onChange={e => setRangeMin(e.target.value)}
                        placeholder="—"
                        style={{
                          width: '100%', background: '#fff', border: '1px solid #d1d5db',
                          color: '#1e293b', borderRadius: 4, padding: '4px 6px', fontSize: 11,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 2 }}>Max</div>
                      <input
                        className="nodrag" type="number" value={rangeMax}
                        onChange={e => setRangeMax(e.target.value)}
                        placeholder="—"
                        style={{
                          width: '100%', background: '#fff', border: '1px solid #d1d5db',
                          color: '#1e293b', borderRadius: 4, padding: '4px 6px', fontSize: 11,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                  {(cond0.tag || sensorTag) && (
                    <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2, fontFamily: 'monospace' }}>
                      Tag: {cond0.tag || sensorTag}
                    </div>
                  )}
                </div>
              );
            }

            const onWord  = isVisionSubj ? 'PASS'   : isAnalogSubj ? 'IN TOL' : 'ON';
            const offWord = isVisionSubj ? 'FAIL'   : isAnalogSubj ? 'OUT'    : 'OFF';
            const onLabel  = isVisionSubj ? 'Pass'  : isAnalogSubj ? 'InTol'  : 'On';
            const offLabel = isVisionSubj ? 'Fail'  : isAnalogSubj ? 'Out'    : 'Off';

            const activeType = cond0.conditionType ?? conditionType;

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Value — {nodeMode === 'wait'
                    ? `wait until the subject is which way?`
                    : nodeMode === 'decide'
                    ? `the "primary" side of the fork.`
                    : `the "good" side when the subject is read.`}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="nodrag"
                    onClick={() => {
                      setConditionType('on');
                      setConditions(prev => prev.map((c, i) => i === 0 ? { ...c, conditionType: 'on' } : c));
                      setExit1Label(onLabel);
                      setExit2Label(offLabel);
                      setLabelsCustomized(false);
                    }}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      background: activeType === 'on' ? '#16a34a' : '#fff',
                      border: activeType === 'on' ? '1px solid #22c55e' : '1px solid #d1d5db',
                      color: activeType === 'on' ? '#fff' : '#64748b',
                    }}
                  >{'\u2713'} {onWord}</button>
                  <button
                    className="nodrag"
                    onClick={() => {
                      setConditionType('off');
                      setConditions(prev => prev.map((c, i) => i === 0 ? { ...c, conditionType: 'off' } : c));
                      setExit1Label(offLabel);
                      setExit2Label(onLabel);
                      setLabelsCustomized(false);
                    }}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      background: activeType === 'off' ? '#dc2626' : '#fff',
                      border: activeType === 'off' ? '1px solid #ef4444' : '1px solid #d1d5db',
                      color: activeType === 'off' ? '#fff' : '#64748b',
                    }}
                  >{'\u2717'} {offWord}</button>
                </div>
                {(cond0.tag || sensorTag) && (
                  <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2, fontFamily: 'monospace' }}>
                    Tag: {cond0.tag || sensorTag}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── OUTCOMES section (1 / 2 / N) ─────────────────────────────────────
              v1.30: Pulled into its own labeled box so it reads as "how this
              state exits" — a separate concern from SUBJECT (what we're
              looking at), TEST FOR (polarity), ADVANCE (retry), and LOG
              (PT field write). Polarity stripped from button labels — those
              live in TEST FOR now.
              Constraint: a Wait on a SINGLE condition can't 2-branch (the
              state simply doesn't advance if the condition isn't met).
              Multi-condition waits CAN branch (one exit per condition).
              v1.30.3: Moved above LOG per user spec — order is Subject →
              Check → Measurement → Retry → Outcomes → Log → Done. */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outcomes</div>
            <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.3, marginBottom: 2 }}>How this node exits the state.</div>
          <button
            className="nodrag"
            onClick={() => { setExitCount(1); setExit1Label(singleLabel); setLabelsCustomized(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: exitCount === 1 ? '#16a34a' : '#fff',
              border: exitCount === 1 ? '1px solid #22c55e' : '1px solid #d1d5db',
              color: exitCount === 1 ? '#fff' : '#1e293b', fontSize: 11, textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>1</span>
            <span style={{ flex: 1 }}>One path forward</span>
          </button>

          {!(nodeMode === 'wait' && conditions.length <= 1) && (
            <button
              className="nodrag"
              onClick={() => { setExitCount(2); setExit1Label(dualLabel1); setExit2Label(dualLabel2); setLabelsCustomized(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                background: exitCount === 2 ? '#1574c4' : '#fff',
                border: exitCount === 2 ? '1px solid #3b82f6' : '1px solid #d1d5db',
                color: exitCount === 2 ? '#fff' : '#1e293b', fontSize: 11, textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>2</span>
              <span style={{ flex: 1 }}>Two branches</span>
            </button>
          )}

          <button
            className="nodrag"
            onClick={() => {
              const count = exitCount > 2 ? exitCount : 3;
              setExitCount(count);
              setOutcomeLabels(prev => {
                const labels = [...prev];
                while (labels.length < count) labels.push(`Option ${String.fromCharCode(65 + labels.length)}`);
                return labels;
              });
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: exitCount > 2 ? '#7c3aed' : '#fff',
              border: exitCount > 2 ? '1px solid #8b5cf6' : '1px solid #d1d5db',
              color: exitCount > 2 ? '#fff' : '#1e293b', fontSize: 11, textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>N</span>
            <span style={{ flex: 1 }}>Multi-branch (custom labels)</span>
          </button>

          {/* Custom labels (only when 2-branch selected) */}
          {exitCount === 2 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 2 }}>Left exit</div>
                <input
                  className="nodrag"
                  value={exit1Label}
                  onChange={e => { setExit1Label(e.target.value); setLabelsCustomized(true); }}
                  style={{
                    width: '100%', background: '#fff', border: '1px solid #d1d5db',
                    color: '#1e293b', borderRadius: 4, padding: '3px 6px', fontSize: 11,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 2 }}>Right exit</div>
                <input
                  className="nodrag"
                  value={exit2Label}
                  onChange={e => { setExit2Label(e.target.value); setLabelsCustomized(true); }}
                  style={{
                    width: '100%', background: '#fff', border: '1px solid #d1d5db',
                    color: '#1e293b', borderRadius: 4, padding: '3px 6px', fontSize: 11,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {/* Multi-outcome editor (exitCount > 2) */}
          {exitCount > 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
              {/* Count stepper */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Outcomes:</span>
                <button
                  className="nodrag"
                  onClick={() => {
                    if (exitCount > 3) setExitCount(exitCount - 1);
                  }}
                  style={{
                    width: 24, height: 24, borderRadius: 4, cursor: exitCount > 3 ? 'pointer' : 'not-allowed',
                    background: exitCount > 3 ? '#f1f5f9' : '#f8fafc', border: '1px solid #d1d5db',
                    color: exitCount > 3 ? '#1e293b' : '#cbd5e1', fontSize: 14, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >{'\u2212'}</button>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', minWidth: 20, textAlign: 'center' }}>{exitCount}</span>
                <button
                  className="nodrag"
                  onClick={() => {
                    const next = exitCount + 1;
                    setExitCount(next);
                    setOutcomeLabels(prev => {
                      const labels = [...prev];
                      while (labels.length < next) labels.push(`Option ${String.fromCharCode(65 + labels.length)}`);
                      return labels;
                    });
                  }}
                  style={{
                    width: 24, height: 24, borderRadius: 4, cursor: 'pointer',
                    background: '#f1f5f9', border: '1px solid #d1d5db',
                    color: '#1e293b', fontSize: 14, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >+</button>
              </div>
              {/* Label inputs */}
              {outcomeLabels.slice(0, exitCount).map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 9, fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', background: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
                    flexShrink: 0,
                  }}>{i + 1}</span>
                  <input
                    className="nodrag"
                    value={label}
                    onChange={e => {
                      const updated = [...outcomeLabels];
                      updated[i] = e.target.value;
                      setOutcomeLabels(updated);
                    }}
                    style={{
                      flex: 1, background: '#fff', border: '1px solid #d1d5db',
                      color: '#1e293b', borderRadius: 4, padding: '3px 6px', fontSize: 11,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          </div>

          {/* ── Part Tracking (LOG) ──
              v1.30.3: Gated on Check mode — Wait mode is just SUBJECT + RETRY +
              OUTCOMES per user spec. Wait is a blocking step with no result to
              log; Check is a sample-and-record so the LOG section is meaningful. */}
          {nodeMode !== 'wait' && (() => {
            // Detect AnalogSensor subject (gates the optional "Also store value"
            // toggle). Reads from local edit state, not data, so it reflects
            // the in-progress condition pick.
            const refForType = sensorRef ?? conditions[0]?.ref;
            const isAnalogSubject = (() => {
              if (!refForType || typeof refForType !== 'string') return false;
              const devId = refForType.split(':')[0];
              if (!devId || devId === '_tracking') return false;
              const dev = (currentSm?.devices ?? []).find(d => d.id === devId);
              return dev?.type === 'AnalogSensor';
            })();
            // Log mode: PT is the entire purpose of the node — surface the
            // field picker without a toggle. The check is implicitly required.
            const isLog = nodeMode === 'log';
            return (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0d9488', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Log</div>
            <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 5, lineHeight: 1.3 }}>
              {isAnalogSubject
                ? 'Record the probe reading at this moment in the cycle.'
                : 'Record what this condition evaluated to at this moment in the cycle.'}
            </div>
            {/* Primary log option. Subject-aware:
                  - Analog probe → "Log the measured value (REAL)" leads, since
                    that's what an engineer actually wants from a probe (the
                    number, not just pass/fail). Pass/fail BOOL is the optional
                    secondary below.
                  - Binary subject (sensor / signal / state) → "Log the on/off
                    state (BOOL)" — there's no value to record, just the bit. */}
            {isAnalogSubject ? (
              <label
                className="nodrag"
                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}
                onClick={() => {
                  const next = !valueLogEnabled;
                  setValueLogEnabled(next);
                  if (next && !valueFieldName) {
                    const base = signalName?.replace(/\s+/g, '_') ?? 'Value';
                    setValueFieldName(`${base}_Value`);
                  }
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: valueLogEnabled ? '#0d9488' : '#fff',
                  border: valueLogEnabled ? '1px solid #14b8a6' : '1px solid #d1d5db',
                  fontSize: 10, color: '#fff', fontWeight: 700,
                }}>
                  {valueLogEnabled ? '\u2713' : ''}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: valueLogEnabled ? '#0d9488' : '#64748b' }}>
                  Log the measured value <span style={{ fontWeight: 500, color: '#94a3b8' }}>(REAL)</span>
                </span>
              </label>
            ) : (
              <label
                className="nodrag"
                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}
                onClick={() => {
                  const next = !ptEnabled;
                  setPtEnabled(next);
                  if (next && !ptFieldName) {
                    const autoName = signalName?.replace(/\s+/g, '_') ?? 'Result';
                    setPtFieldName(autoName);
                  }
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: ptEnabled ? '#16a34a' : '#fff',
                  border: ptEnabled ? '1px solid #22c55e' : '1px solid #d1d5db',
                  fontSize: 10, color: '#000', fontWeight: 700,
                }}>
                  {ptEnabled ? '\u2713' : ''}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: ptEnabled ? '#16a34a' : '#64748b' }}>
                  Log the result <span style={{ fontWeight: 500, color: '#94a3b8' }}>(BOOL)</span>
                </span>
              </label>
            )}
            {/* Analog-only secondary: also log the pass/fail BOOL alongside
                the REAL value. Hidden by default. The user almost never wants
                BOTH, but L5X export supports it for engineers who want a
                separate IN-TOL latch they can reference downstream. */}
            {isAnalogSubject && (
              <label
                className="nodrag"
                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1, marginTop: 4 }}
                onClick={() => {
                  const next = !ptEnabled;
                  setPtEnabled(next);
                  if (next && !ptFieldName) {
                    const autoName = signalName?.replace(/\s+/g, '_') ?? 'Result';
                    setPtFieldName(autoName);
                  }
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: ptEnabled ? '#16a34a' : '#fff',
                  border: ptEnabled ? '1px solid #22c55e' : '1px solid #d1d5db',
                  fontSize: 10, color: '#000', fontWeight: 700,
                }}>
                  {ptEnabled ? '\u2713' : ''}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: ptEnabled ? '#16a34a' : '#64748b' }}>
                  Also log pass/fail <span style={{ fontWeight: 500, color: '#94a3b8' }}>(BOOL)</span>
                </span>
              </label>
            )}
            {/* REAL value-log field picker — primary for analog probe.
                Only renders when valueLogEnabled is on; collects the field
                name that {name}Scaled gets MOV'd into at this state. */}
            {valueLogEnabled && isAnalogSubject && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.3 }}>
                  Where to store the reading. Pick an existing REAL field or name a new one.
                </div>
                {ptFields.filter(f => f.dataType === 'real').length > 0 && (
                  <select
                    className="nodrag"
                    value={valueFieldId ?? ''}
                    onChange={e => {
                      const fid = e.target.value;
                      if (fid === '__new__') {
                        setValueFieldId(null);
                        const base = signalName?.replace(/\s+/g, '_') ?? 'Value';
                        setValueFieldName(`${base}_Value`);
                        return;
                      }
                      const f = ptFields.find(f => f.id === fid);
                      if (f) { setValueFieldId(f.id); setValueFieldName(f.name); }
                    }}
                    style={{
                      width: '100%', background: '#fff', border: '1px solid #d1d5db',
                      color: '#1e293b', borderRadius: 4, padding: '4px 6px', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    <option value="" disabled>Select REAL field…</option>
                    {ptFields.filter(f => f.dataType === 'real').map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                    <option value="__new__">+ New REAL field…</option>
                  </select>
                )}
                {(!valueFieldId || ptFields.filter(f => f.dataType === 'real').length === 0) && (
                  <input
                    className="nodrag"
                    value={valueFieldName}
                    onChange={e => { setValueFieldName(e.target.value); setValueFieldId(null); }}
                    placeholder="REAL field name"
                    style={{
                      width: '100%', background: '#fff', border: '1px solid #d1d5db',
                      color: '#1e293b', borderRadius: 4, padding: '4px 6px', fontSize: 11,
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>
            )}
            {/* BOOL field picker + per-truth-state writes. Renders when:
                - ptEnabled is on (any subject — primary for binary, secondary for analog), OR
                - legacy isLog (nodeMode === 'log') — kept for old records during hydration. */}
            {(ptEnabled || isLog) && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.3 }}>
                  {isAnalogSubject
                    ? 'Where to store the pass/fail bit. Pick an existing BOOL field or name a new one.'
                    : 'Where to store the result. Pick an existing field or name a new one.'}
                </div>
                {ptFields.length > 0 && (
                  <select
                    className="nodrag"
                    value={ptFieldId ?? ''}
                    onChange={e => {
                      const fid = e.target.value;
                      if (fid === '__new__') {
                        setPtFieldId(null);
                        const autoName = signalName?.replace(/\s+/g, '_') ?? 'Result';
                        setPtFieldName(autoName);
                        return;
                      }
                      const f = ptFields.find(f => f.id === fid);
                      if (f) { setPtFieldId(f.id); setPtFieldName(f.name); }
                    }}
                    style={{
                      width: '100%', background: '#fff', border: '1px solid #d1d5db',
                      color: '#1e293b', borderRadius: 4, padding: '4px 6px', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    <option value="" disabled>Select field…</option>
                    {ptFields.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                    <option value="__new__">+ New field…</option>
                  </select>
                )}
                {(!ptFieldId || ptFields.length === 0) && (
                  <input
                    className="nodrag"
                    value={ptFieldName}
                    onChange={e => { setPtFieldName(e.target.value); setPtFieldId(null); }}
                    placeholder="Field name"
                    style={{
                      width: '100%', background: '#fff', border: '1px solid #d1d5db',
                      color: '#1e293b', borderRadius: 4, padding: '4px 6px', fontSize: 11,
                      boxSizing: 'border-box',
                    }}
                  />
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: '#16a34a', fontWeight: 700, marginBottom: 1 }}>
                      ✓ {isLog
                          ? (isAnalogSubject ? 'When IN TOLERANCE writes' : 'When TRUE writes')
                          : `${exit1Label} writes`}
                    </div>
                    <select className="nodrag" value={ptPassValue} onChange={e => setPtPassValue(e.target.value)}
                      style={{ width: '100%', fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db', background: '#fff', color: '#1e293b', cursor: 'pointer' }}>
                      <option value="SUCCESS">SUCCESS</option>
                      <option value="FAILURE">FAILURE</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700, marginBottom: 1 }}>
                      ✗ {isLog
                          ? (isAnalogSubject ? 'When OUT OF TOLERANCE writes' : 'When FALSE writes')
                          : `${exit2Label} writes`}
                    </div>
                    <select className="nodrag" value={ptFailValue} onChange={e => setPtFailValue(e.target.value)}
                      style={{ width: '100%', fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db', background: '#fff', color: '#1e293b', cursor: 'pointer' }}>
                      <option value="FAILURE">FAILURE</option>
                      <option value="SUCCESS">SUCCESS</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
            );
          })()}

          {/* ── RETRY section — moved to bottom (v1.30.6) ──────────────────────
              Per user: "Retry should be at the bottom. I don't like how
              it's in the middle." The other concerns (Subject / Check /
              Action / Outcomes / Log) describe WHAT the node does —
              retry is a fallback policy applied AFTER everything else
              is configured, so it reads more naturally last.

              v1.30.1: Renamed from "ADVANCE" — that was a fake umbrella
              for one option. The section is just retry today; if/when
              timer or hold-off lands they'll get their own boxes too.
              No invented category headers for single-option sections. */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', marginBottom: 2 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#d97706', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Retry</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label
                className="nodrag"
                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}
                onClick={() => setRetryEnabled(!retryEnabled)}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: retryEnabled ? '#f59e0b' : '#fff',
                  border: retryEnabled ? '1px solid #d97706' : '1px solid #d1d5db',
                  fontSize: 10, color: '#000', fontWeight: 700,
                }}>
                  {retryEnabled ? '\u2713' : ''}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: retryEnabled ? '#d97706' : '#64748b' }}>
                  Enable retry counter
                </span>
              </label>
              {retryEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: '#94a3b8' }}>Max:</span>
                  <input
                    className="nodrag"
                    type="number"
                    min={1}
                    max={99}
                    value={retryMax}
                    onChange={e => setRetryMax(e.target.value)}
                    style={{
                      width: 44, background: '#fff', border: '1px solid #d1d5db',
                      color: '#1e293b', borderRadius: 4, padding: '2px 4px', fontSize: 11,
                      textAlign: 'center', boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}
            </div>
            {retryEnabled && (
              <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 3, lineHeight: 1.3 }}>
                {nodeMode === 'verify'
                  ? `If verify fails, retry up to ${retryMax}x before taking the fail branch.`
                  : nodeMode === 'decide'
                  ? `If decision comes back false, retry up to ${retryMax}x before taking the false branch.`
                  : `If condition fails, retry up to ${retryMax}x before taking the fail branch.`}
              </div>
            )}
          </div>

          {/* Done button — disabled until a signal/condition is picked */}
          <button
            className="nodrag"
            disabled={conditions.length === 0}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (conditions.length > 0) handleDone(); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 700,
              background: conditions.length === 0 ? '#cbd5e1' : '#1574c4',
              color: '#fff', border: 'none', borderRadius: 5,
              cursor: conditions.length === 0 ? 'not-allowed' : 'pointer',
              letterSpacing: '0.03em', marginTop: 4,
            }}
          >{conditions.length === 0 ? 'Pick a subject first' : 'Done'}</button>
        </div>
        );
      })()}
    </div>
  );

  return createPortal(popupContent, document.body);
}

// ── DecisionBody ──────────────────────────────────────────────────────────────
// Visual body of a decision — colored card + icon + subject + op badge + verify
// text + retry + PT badges. Shared between standalone DecisionNode and embedded
// `_decision` action rows inside StateNode so they look and feel identical.
//
// Props:
//   data       — decision data object (signalId, signalName, nodeMode, conditionType, ...)
//   smId       — state machine id (for live device/signal resolution)
//   nodeId     — host node id (for setSelectedNode on click)
//   selected   — boolean, for white border highlight
//   onClick    — click handler (opens the editor popup from parent)
//   onContextMenu — optional right-click handler
//   embedded   — true when rendered inside a StateNode row (omits state-number badge,
//                adjusts width/margins to fit inside a state)
export function DecisionBody({ data, smId, nodeId, selected, onClick, onContextMenu, embedded = false, onUpdate = null }) {
  const {
    decisionType = 'signal',
    signalName = 'Select Signal...',
    signalSource = null,
    signalSmName = null,
    signalType = null,
    exitCount = 2,
    nodeMode = 'wait',
    stateNumber = null,
    conditionType = 'on',
    rangeMin,
    rangeMax,
    sensorRef = null,
    sensorTag = '',
    sensorInputType = 'bool',
    retryEnabled = false,
    retryMax = 3,
  } = data;

  const store = useDiagramStore();
  const [opSwitcher, setOpSwitcher] = useState(null);
  const nodeRef = useRef(null);
  const pointerDownPos = useRef(null);

  // Derivation (mirrors DecisionNode main render logic) ────────────────────────
  const primaryCond = (data.conditions ?? [])[0];
  const isVision = signalType === 'visionJob'
    || signalType === 'partResult'
    || decisionType === 'vision'
    || primaryCond?.signalType === 'visionJob'
    || primaryCond?._visionLinked === true;
  // v1.31 unified grammar: action verb (wait/check/branch) lives in a dedicated
  // inner pill with its own color. Outer container colors are driven by the
  // SUBJECT instead — see subjectColor block below liveDevice resolution.
  const action = nodeMode === 'wait' ? 'wait' : 'check';
  // Action pill colors (inner left pill). Wait → SDC blue, Check/Branch → teal.
  const actionFill   = action === 'wait' ? '#0072B5' : '#0d9488';
  const actionBorder = action === 'wait' ? '#005a91' : '#0f766e';
  const isSensor = signalType === 'sensor' || !!sensorRef;
  // Kept for downstream branches that still read these flags in this function
  // (verifyText subtitle, icon picking, decide-recipe suppression). Now derived
  // from the unified flags rather than mode strings.
  const isVerify = action === 'check' && exitCount === 1 && !!data.assert;
  const isDecide = action === 'check' && exitCount >= 2 && !data.ptEnabled && !data.valueLogEnabled;
  // `isLog` in v1.29 = check + single-exit + ptEnabled (the "stamp the read"
  // pattern). Used by the verifyText subtitle to prepend "Log: …" on probe
  // rows so the row reads like "Log: Part1 in tolerance".
  const isLog = action === 'check' && exitCount === 1 && !!data.ptEnabled;
  const ioType = isSensor && sensorInputType !== 'range'
    ? (sensorTag?.startsWith('q_') ? 'DO' : sensorTag?.startsWith('i_') ? 'DI' : null)
    : null;
  const isVisionJob = signalType === 'visionJob';
  const displayName = isVisionJob
    ? (signalSource ?? signalSmName ?? signalName ?? 'Select Signal...')
    : (signalName ?? signalSource ?? 'Select Signal...');
  const multiConditions = data.conditions ?? [];
  const multiLogic = data.conditionLogic ?? 'AND';

  let conditionDisplayName = displayName;
  let axisCount = null;
  let deviceDisplayLabel = null;
  if (isSensor) {
    const pc = multiConditions[0] ?? null;
    const rawLabel = (pc?.label || displayName || '').trim();
    const group = (pc?.group || signalSource || '').trim();
    let condPart = rawLabel;
    let devicePart = null;
    if (group && rawLabel.startsWith(group)) {
      condPart = rawLabel.slice(group.length).trim();
      devicePart = group;
    } else {
      const tokens = rawLabel.split(' ');
      const last = tokens[tokens.length - 1];
      if (last && /^\[\d+\]$/.test(last)) {
        axisCount = last.match(/\[(\d+)\]/)[1];
        condPart = tokens[tokens.length - 2] ?? '';
        devicePart = tokens.slice(0, -2).join(' ') || null;
      }
    }
    if (!axisCount) {
      const axisMatch = condPart.match(/\[(\d+)\]$/);
      if (axisMatch) {
        axisCount = axisMatch[1];
        condPart = condPart.replace(/\s*\[\d+\]$/, '').trim();
      }
    }
    if (condPart && condPart !== rawLabel) {
      conditionDisplayName = condPart;
      deviceDisplayLabel = devicePart || null;
    }
  }

  const smDevices = useDiagramStore(s => s.project?.stateMachines?.find(m => m.id === smId)?.devices ?? []);
  const allSMs = useDiagramStore(s => s.project?.stateMachines ?? []);
  const projectSignals = useDiagramStore(s => s.project?.signals ?? []);
  const resolvedSourceLabel = useMemo(() => {
    const sigId = data.signalId;
    if (!sigId) return null;
    const sig = projectSignals.find(s => s.id === sigId);
    if (!sig || sig.type !== 'state' || !sig.smId) return null;
    const refSm = allSMs.find(sm => sm.id === sig.smId);
    if (!refSm) return null;
    const { stateMap } = computeStateNumbers(refSm.nodes ?? [], refSm.edges ?? [], refSm.devices ?? []);
    let stepNum = sig.stateNodeId ? stateMap.get(sig.stateNodeId) : null;
    if (stepNum == null && sig.stateName) {
      const cleanSigState = sig.stateName.replace(/^\[\d+\]\s*[✓⌂⏳]?\s*/, '').trim();
      const matchNode = (refSm.nodes ?? []).find(n => (n.data?.label ?? '').trim() === cleanSigState);
      if (matchNode) stepNum = stateMap.get(matchNode.id);
    }
    if (stepNum == null) return null;
    const smName = refSm.displayName ?? refSm.name ?? '';
    const verb = sig.reachedMode === 'reached' ? 'has reached' : 'is in';
    return `${smName ? smName + ' ' : ''}${verb} State ${stepNum}`;
  }, [data.signalId, projectSignals, allSMs]);

  const primaryRef = multiConditions[0]?.ref || sensorRef || '';
  const colonIdx = primaryRef.indexOf(':');
  const refDeviceId = colonIdx >= 0 ? primaryRef.slice(0, colonIdx) : (primaryRef || null);
  const refSuffix = colonIdx >= 0 ? primaryRef.slice(colonIdx + 1) : null;
  const liveDevice = (isSensor && refDeviceId)
    ? (smDevices.find(d => d.id === refDeviceId) ?? allSMs.flatMap(m => m.devices ?? []).find(d => d.id === refDeviceId) ?? null)
    : null;
  const liveDeviceName = liveDevice?.displayName ?? liveDevice?.name ?? null;
  const refSignalId = refSuffix?.split(':')[0] ?? null;
  const liveSignal = (liveDevice?.type === 'Robot' && refSignalId)
    ? (liveDevice.signals?.find(s => s.id === refSignalId) ?? null)
    : null;
  const liveConditionName = liveSignal?.name ?? null;
  const liveAxisCount = liveSignal?.number != null ? String(liveSignal.number) : null;

  // Analog probe subject? AnalogSensor refs are `{deviceId}:{setpointId}` (v1.30.4+)
  // — older data may still have `{deviceId}:{setpointName}` until the hydration
  // migration runs. Either way we resolve to the LIVE setpoint object and read
  // its CURRENT name, so a rename in the device editor propagates instantly.
  // The underlying tag is `{name}{setpointName}RC.InPos`. Treated as a binary
  // BOOL semantically — but the engineer's vocabulary is "in tolerance" /
  // "out of tolerance", not ON/OFF. Detected here so the row + badge + verify
  // line all read in probe vocabulary instead of generic sensor vocabulary.
  const isAnalogSubject = liveDevice?.type === 'AnalogSensor';
  const liveAnalogSetpoint = (isAnalogSubject && refSuffix && Array.isArray(liveDevice?.setpoints))
    ? (liveDevice.setpoints.find(sp => sp.id === refSuffix)
       ?? liveDevice.setpoints.find(sp => sp.name === refSuffix)
       ?? (liveDevice.setpoints.length === 1 ? liveDevice.setpoints[0] : null))
    : null;
  // Always render the CURRENT name from the device, never the stale ref string.
  // Falls back to the ref's literal suffix only when no setpoint lookup succeeds
  // (e.g. setpoint was deleted) — which makes the staleness visible to the user
  // rather than silently masking it.
  const analogSetpointName = isAnalogSubject ? (liveAnalogSetpoint?.name ?? refSuffix ?? null) : null;

  // v1.31 — SUBJECT-derived chrome colors. Outer container border + tint encode
  // the *kind* of thing (signal/cylinder/sensor/etc.). Replaces the previous
  // action-derived (blue/teal) container colors — those moved to the inner
  // action verb pill where the action verb belongs.
  const subjectKey = getSubjectKey({
    signalType, decisionType,
    primaryCond: multiConditions[0],
    liveDevice,
  });
  const subjectColor = SUBJECT_COLORS[subjectKey] ?? SUBJECT_COLORS.default;
  // Aliases preserved so downstream styling continues to read `fillColor` /
  // `borderColor` (smaller diff, fewer stale references).
  const fillColor   = subjectColor.fill;
  const borderColor = subjectColor.dim;

  let effectiveIoType = ioType;
  if (liveSignal?.group === 'DI' || liveSignal?.group === 'DO') {
    effectiveIoType = liveSignal.group;
  } else if (isSensor && !liveSignal) {
    const storedGroup = multiConditions[0]?.group || '';
    if (storedGroup.includes(' DI') || storedGroup === 'Robot DI') effectiveIoType = 'DI';
    else if (storedGroup.includes(' DO') || storedGroup === 'Robot DO') effectiveIoType = 'DO';
  }

  // v1.30.4 — Subject is rendered as `{Subject} - {Check}` with a hyphen.
  // The check segment is a parameter of the subject — same weight, hyphen
  // separator. Was `@` previously; hyphen reads more naturally for non-position
  // checks and matches the user's mental model.
  const subjectLine = isAnalogSubject && liveDeviceName && analogSetpointName
    ? `${liveDeviceName} - ${analogSetpointName}`
    : (liveDeviceName ?? deviceDisplayLabel ?? (isSensor ? (signalSource || displayName) : displayName));
  const condName = liveConditionName || conditionDisplayName || '';
  const effectiveAxisCount = liveAxisCount || axisCount;
  const conditionPrefix = (effectiveIoType ?? '') + (effectiveAxisCount ? `[${effectiveAxisCount}]` : '');

  // Op badge label + color — v1.29 unified-flag derivation.
  // The badge reads as "<Verb> <TestWord>[ · Branch][ · Log]". Verb comes from
  // the action (Wait | Check). TestWord is subject-aware: digital → ON/OFF,
  // analog probe → IN TOL/OUT, vision → PASS/FAIL, range → "Range".
  // Branch suffix appears when exitCount >= 2 AND there's actually a path
  // distinction to advertise (Wait+1 doesn't branch; Check+2 does).
  // Log suffix appears whenever PT or value logging is enabled.
  const isOn = conditionType !== 'off';
  const hasLogFlag = !!(data.ptEnabled || data.valueLogEnabled);
  const branches = exitCount >= 2;

  // Test-word vocabulary, follows the subject. When the subject is a vision
  // job the result is PASS/FAIL (the word "ON" makes no sense for a vision
  // result). Range probes read as "Range" (the min/max line below carries
  // the actual values). Analog probes read as "In Tol"/"Out". Default is
  // ON/OFF for binary digital sensors and project signals.
  let testWord;
  if (sensorInputType === 'range') {
    testWord = 'Range';
  } else if (isVisionJob) {
    testWord = isOn ? 'Pass' : 'Fail';
  } else if (isAnalogSubject) {
    testWord = isOn ? 'In Tol' : 'Out';
  } else {
    testWord = isOn ? 'On' : 'Off';
  }

  const verb = action === 'wait' ? 'Wait' : 'Check';
  // v1.31 — split the old composite "Wait On · Branch" pill into two pills:
  // [Action verb] ... [Value]. Action verb describes WHAT we're doing
  // (Wait / Check / Decide / "Wait → Branch" / "Check → Branch"). Value
  // pill describes the polarity / outcome (On / Off / Pass / Fail / In Tol /
  // Out / Range). Decide rows omit the value pill — the branch edge labels
  // already communicate the polarity — so a Decide row reads as a single
  // "Decide" verb pill.
  let actionVerb;
  if (isDecide) {
    actionVerb = 'Decide';
  } else if (branches) {
    actionVerb = `${verb} \u2192 Branch`;
  } else {
    actionVerb = verb;
  }
  const valueLabel = isDecide ? null : testWord;

  // v1.30.6 — Log is its OWN concern (the corner PtBadge + footer pill carry
  // the field name). It is NOT part of the action verb, so we don't suffix
  // "· Log" onto the op pill. Per user: "logging is its own thing.
  // You don't put log in the action."

  // Value-pill color: green = on/pass, red = off/fail, amber = range probe.
  // Null when there's no value pill (Decide).
  let valueColor = null;
  if (!isDecide) {
    valueColor = sensorInputType === 'range' ? '#f59e0b'
               : (isOn ? '#16a34a' : '#dc2626');
  }

  // opColor still drives the inner-card left-border accent and a couple of
  // legacy styling hooks. Mirrors valueColor for non-Decide rows; teal for
  // Decide.
  const opColor = isDecide ? '#0d9488' : valueColor;

  // Icon type — what glyph to render next to the subject name. Priority:
  //   1. Vision job       → camera
  //   2. Live device tag  → the device's own icon (cylinder / servo / etc.)
  //   3. Sensor ref       → sensor beam / analog gauge
  //   4. Project signal   → broadcast "Signal" glyph. This covers the
  //      common case "Decide on Part_Gripped" where the subject is a
  //      computed / latched signal with no direct device tie — the row
  //      used to render iconless, which felt inconsistent with every
  //      other row in the state (they all lead with an icon).
  let iconType = null;
  if (isVisionJob) iconType = 'VisionSystem';
  else if (liveDevice?.type) iconType = liveDevice.type;
  else if (isSensor) iconType = sensorInputType === 'range' ? 'AnalogSensor' : 'DigitalSensor';
  else if (data.signalId) iconType = 'Signal';

  const nameLen = (subjectLine ?? '').length;
  const badgeLen = (actionVerb ?? '').length + (valueLabel ?? '').length;
  const totalLen = nameLen + badgeLen;
  const nameFontSize = totalLen <= 14 ? 13 : totalLen <= 18 ? 12 : totalLen <= 22 ? 11 : totalLen <= 28 ? 10 : 9;

  const stripSourcePrefix = (name) => {
    if (!name) return name;
    let out = name;
    const candidates = [signalSource, subjectLine, deviceDisplayLabel, liveDeviceName].filter(Boolean);
    for (const pfx of candidates) {
      if (out.startsWith(pfx + ' ') || out.startsWith(pfx + '\u2192') || out.startsWith(pfx + ' \u2192')) {
        out = out.slice(pfx.length).replace(/^\s*\u2192?\s*/, '').trim();
      }
    }
    return out || name;
  };

  let verifyText = null;
  if (isVerify) {
    verifyText = null;
  } else if (isSensor && sensorInputType === 'range') {
    const minStr = rangeMin !== undefined && rangeMin !== '' ? rangeMin : '?';
    const maxStr = rangeMax !== undefined && rangeMax !== '' ? rangeMax : '?';
    verifyText = `Range: ${minStr} – ${maxStr}`;
  } else if (isAnalogSubject) {
    // Probe vocabulary: "Part1 — in tolerance" instead of "{tag} = ON".
    // v1.31 — strip the "Log: " inline prefix; the corner PtBadge + footer
    // pill name the tracked field, so the verify line stays clean.
    const sp = analogSetpointName ?? '?';
    const inOut = isOn ? 'in tolerance' : 'out of tolerance';
    verifyText = `${sp} ${inOut}`;
  } else if (isSensor) {
    const tag = multiConditions[0]?.tag || sensorTag;
    const detail = tag
      || (condName && condName !== subjectLine ? condName : null)
      || stripSourcePrefix(signalName)
      || subjectLine;
    verifyText = `${detail} = ${isOn ? 'ON' : 'OFF'}`;
  } else if (isVisionJob && signalName && signalName !== subjectLine) {
    verifyText = `Job: ${signalName}`;
  } else if (isDecide) {
    // Decide = snapshot + branch. The signal's internal recipe
    // (e.g., "SDC_Servo_PNP is in State 7") is authoring-detail that
    // belongs in the tooltip/editor, NOT on the row — reading the row
    // the answer you want is "branching on Part_Gripped", not the
    // chain of conditions that compute Part_Gripped's bit. Leave the
    // verify line blank; the signal name + [Decide] badge carries the
    // meaning, and hover tooltip below preserves the recipe.
    verifyText = null;
  } else if (resolvedSourceLabel) {
    verifyText = resolvedSourceLabel;
  } else if (signalName && signalName !== subjectLine) {
    const detail = stripSourcePrefix(signalName);
    verifyText = `${detail} = ${isOn ? 'ON' : 'OFF'}`;
  }

  const innerBg = `color-mix(in srgb, ${fillColor} 22%, #ffffff)`;
  const isRangeOp = sensorInputType === 'range';
  const canToggleOnOff = !isDecide && !isVisionJob && !isRangeOp;
  const handleOpClick = canToggleOnOff
    ? (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (opSwitcher) setOpSwitcher(null);
        else {
          const rect = e.currentTarget.getBoundingClientRect();
          setOpSwitcher({ pos: { top: rect.bottom + 4, left: rect.left } });
        }
      }
    : undefined;

  function handlePointerDown(e) {
    if (e.target.closest('.react-flow__handle')) return;
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }

  function handleBodyClick(e) {
    if (e.target.closest('.react-flow__handle')) return;
    e.stopPropagation();
    if (smId && nodeId) store.setSelectedNode(nodeId);
    if (pointerDownPos.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);
      if (dx > 5 || dy > 5) return;
    }
    onClick?.(e);
  }

  return (
    <div
      ref={nodeRef}
      style={{
        width: embedded ? '100%' : (exitCount > 2 ? Math.max(NODE_WIDTH, exitCount * 70) : NODE_WIDTH),
        position: 'relative',
        cursor: 'pointer',
        background: fillColor,
        border: `2px solid ${selected ? '#ffffff' : borderColor}`,
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 3px ${fillColor}66, 0 10px 24px rgba(0,0,0,0.12)`
          : (embedded ? 'none' : '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)'),
        transition: 'box-shadow .15s',
        userSelect: 'none',
      }}
      onContextMenu={onContextMenu}
    >
      {/* State number badge (top-left) — only on standalone DecisionNode, not embedded */}
      {!embedded && stateNumber != null && stateNumber > 0 && (
        <div style={{
          position: 'absolute', top: -6, left: -6, minWidth: 22, height: 18, padding: '0 4px',
          borderRadius: 9, fontSize: 9, fontWeight: 800, color: '#fff', background: '#1a1f2e',
          border: '1.5px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 3, pointerEvents: 'none', lineHeight: 1,
          boxSizing: 'border-box',
        }}>{stateNumber}</div>
      )}

      <div
        onPointerDown={handlePointerDown}
        onClick={handleBodyClick}
        style={{ padding: '8px 10px', pointerEvents: 'auto' }}
      >
        <div className="action-row-wrap">
          <div className="action-row" style={{ borderLeftColor: opColor, background: innerBg }}>
            {iconType && (
              <span className="action-icon"><DeviceIcon type={iconType} size={18} /></span>
            )}
            {/* v1.31 — three-pill layout: [Action verb] [Detail = subject] [Value].
                Action verb describes WHAT we're doing (Wait / Check / Decide /
                "Wait → Branch"). The middle is the subject's specific instance
                (device / signal / job name). The trailing Value pill carries
                the polarity (On / Off / Pass / Fail / In Tol / Out / Range).
                Decide rows omit the value pill — branches communicate it. */}
            <span
              className="action-op"
              style={{
                background: actionFill,
                color: '#fff',
                borderColor: actionFill,
                marginLeft: 0,
              }}
              title={`Action: ${actionVerb}`}
            >{actionVerb}</span>
            {/* For Decide rows the recipe (resolvedSourceLabel) is suppressed
                from the visible row, but we still expose it via the title
                tooltip so authors can discover it on hover without opening
                the editor. Other row types keep the default subject tooltip. */}
            <span
              className="action-device"
              style={{ fontSize: nameFontSize }}
              title={
                isDecide && resolvedSourceLabel
                  ? `${subjectLine} — TRUE when ${resolvedSourceLabel}`
                  : subjectLine
              }
            >
              {subjectLine}
            </span>
            {valueLabel && (
              <span
                className={`action-op${canToggleOnOff ? ' action-op--clickable nodrag' : ''}`}
                style={{ background: valueColor, color: '#fff', borderColor: valueColor }}
                onClick={handleOpClick}
                onMouseDown={canToggleOnOff ? (e) => e.stopPropagation() : undefined}
                title={canToggleOnOff ? 'Click to toggle On / Off' : `Value: ${valueLabel}`}
              >{valueLabel}</span>
            )}
          </div>
          {verifyText && (
            <div className="action-verify" style={{ color: '#ffffff', opacity: 0.92, textShadow: '0 1px 1px rgba(0,0,0,0.25)' }}>
              {verifyText}
            </div>
          )}
        </div>

        {/* Retry badge */}
        {retryEnabled && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700,
              background: 'rgba(0,0,0,0.3)', color: '#fbbf24', padding: '1px 6px', borderRadius: 8,
              letterSpacing: '0.03em',
            }}>{'\u21BB'} Retry x{retryMax}</span>
          </div>
        )}
        {/* Log footer pill — names the PT FIELD (or value-log field) being
            written. v1.30.6: per user, the polarity vocab here was redundant
            with the op pill above ("Check In Tol · Log" + "Log: in tol / out
            of tol" said the same thing twice). The op pill carries the
            polarity; this pill carries the field NAME — the unique piece of
            info the engineer cares about. */}
        {((data.ptEnabled && data.ptFieldName) || (data.valueLogEnabled && data.valueFieldName)) && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4, gap: 4, flexWrap: 'wrap' }}>
            {data.valueLogEnabled && data.valueFieldName && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700,
                background: 'rgba(0,0,0,0.3)', color: '#5eead4', padding: '1px 6px', borderRadius: 8,
                letterSpacing: '0.03em',
              }}>📊 {data.valueFieldName}</span>
            )}
            {data.ptEnabled && data.ptFieldName && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700,
                background: 'rgba(0,0,0,0.3)', color: '#86efac', padding: '1px 6px', borderRadius: 8,
                letterSpacing: '0.03em',
              }}>📊 {data.ptFieldName}</span>
            )}
          </div>
        )}
      </div>

      {/* On/Off switcher popup */}
      {opSwitcher && smId && (
        <OnOffSwitcher
          smId={smId}
          nodeId={nodeId}
          currentType={conditionType}
          mode={nodeMode}
          analog={isAnalogSubject}
          pos={opSwitcher.pos}
          onClose={() => setOpSwitcher(null)}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

// ── DecisionNode ───────────────────────────────────────────────────────────────

// Node width matches StateNode (240px)
const NODE_WIDTH = 240;

export function DecisionNode({ data, selected, id }) {
  const {
    decisionType = 'signal',
    signalName = 'Select Signal...',
    signalSource = null,
    signalSmName = null,
    signalType = null,
    exitCount = 2,
    // Fallback defaults: Pass/Fail ONLY for vision (vision jobs have named
    // pass/fail outcomes); On/Off for everything else (binary conditions).
    // `syncDecisionExitLabels` re-syncs these to the correct vocabulary on
    // next mount anyway — this just prevents the wrong word flashing for a
    // frame on an unconfigured node.
    exit1Label = (signalType === 'visionJob' ? 'Pass' : 'On'),
    exit2Label = (signalType === 'visionJob' ? 'Fail' : 'Off'),
    nodeMode = 'wait',
    stateNumber = null,
    conditionType = 'on',
    rangeMin,
    rangeMax,
    sensorRef = null,
    sensorTag = '',
    sensorInputType = 'bool',
    retryEnabled = false,
    retryMax = 3,
  } = data;

  const store = useDiagramStore();
  const smId = store.activeSmId;

  const [showPopup, setShowPopup] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  // Op pill switcher (On/Off picker) — matches StateNode's OperationSwitcher pattern
  const [opSwitcher, setOpSwitcher] = useState(null); // { pos: { top, left } }

  // ref on the node wrapper for getBoundingClientRect
  const nodeRef = useRef(null);

  // Auto-open popup when created from picker (autoOpenPopup flag in data)
  useEffect(() => {
    if (data.autoOpenPopup) {
      // Delay to let the node render and measure its DOM rect
      const timer = setTimeout(() => {
        if (nodeRef.current) {
          const rect = nodeRef.current.getBoundingClientRect();
          setPopupPos({ position: 'fixed', top: rect.top, left: rect.right + 8, zIndex: 9999 });
        }
        setShowPopup(true);
        // Clear the flag so it doesn't re-open
        if (smId) {
          store.updateNodeData(smId, id, { autoOpenPopup: false });
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [data.autoOpenPopup]);

  // ── Live label sync: keep exit labels & connected edges in sync with current
  //    node config (mode, conditionType, signalName). Fixes stale "Pass_X" labels
  //    on nodes that were created before the On/Off labelling was added.
  useEffect(() => {
    if (!smId || !signalName || signalName === 'Select Signal...') return;
    store.syncDecisionExitLabels(smId, id);
  }, [smId, id, nodeMode, conditionType, signalType, signalName, sensorInputType]);

  // Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState(null);

  // Drag detection -- only open popup on click, not on drag
  const pointerDownPos = useRef(null);

  // Color by what the decision is based on:
  //   • anything involving a VISION result (direct vision job OR vision-linked
  //     Part Tracking field used as a part result) → SDC yellow
  //   • plain Part Tracking (user-defined, non-vision) → purple
  //   • anything else → default SDC blue
  const primaryCond = (data.conditions ?? [])[0];
  const isVision = signalType === 'visionJob'
    || signalType === 'partResult'
    || decisionType === 'vision'
    || primaryCond?.signalType === 'visionJob'
    || primaryCond?._visionLinked === true;
  const isPT = !isVision && (
    signalType === 'partTracking'
    || (primaryCond?.signalType === 'partTracking' && !primaryCond?._visionLinked)
  );
  // v1.29 unified-flag model: only two actions exist — `wait` and `check`.
  // v1.31: color now follows the SUBJECT (cylinder / sensor / signal / servo
  // etc.), not the action. The action is still surfaced via a dedicated verb
  // pill inside the row, using these `actionFill`/`actionBorder` colors:
  //   blue  = Wait
  //   teal  = Check
  // The outer card fillColor/borderColor are derived from the subject below,
  // once liveDevice has been resolved.
  const action = nodeMode === 'wait' ? 'wait' : 'check';
  const actionFill   = action === 'wait' ? '#0072B5' : '#0d9488';
  const actionBorder = action === 'wait' ? '#005a91' : '#0f766e';
  const textColor    = '#ffffff';
  const mutedColor   = 'rgba(255,255,255,0.75)';

  // Derived flags used in render below — kept for downstream branches that
  // still distinguish single-test verify (assert: true), branching check, or
  // pure-log check, since the visual cues for each variant differ. After
  // hydration migration `nodeMode` is always `wait`/`check`, so these are
  // derived from the orthogonal flags rather than legacy mode strings.
  const isSensor = signalType === 'sensor' || !!sensorRef;
  const isVerify = action === 'check' && exitCount === 1 && !!data.assert;
  const isDecide = action === 'check' && exitCount >= 2 && !data.ptEnabled && !data.valueLogEnabled;
  const isLog    = action === 'check' && exitCount === 1 && !!(data.ptEnabled || data.valueLogEnabled);
  // IO type from tag prefix: i_ = DI, q_ = DO
  const ioType = isSensor && sensorInputType !== 'range'
    ? (sensorTag?.startsWith('q_') ? 'DO' : sensorTag?.startsWith('i_') ? 'DI' : null)
    : null;

  // Display text
  const isVisionJob = signalType === 'visionJob';
  const displayName = isVisionJob
    ? (signalSource ?? signalSmName ?? signalName ?? 'Select Signal...')
    : (signalName ?? signalSource ?? 'Select Signal...');

  // Multi-condition data
  const multiConditions = data.conditions ?? [];
  const multiLogic = data.conditionLogic ?? 'AND';

  // For sensor nodes: split "Device Condition [N]" into parts.
  // Priority: use conditions[0].group as device; fallback to token heuristic ([N] is always last).
  let conditionDisplayName = displayName;
  let axisCount = null;
  let deviceDisplayLabel = null;
  if (isSensor) {
    const pc = multiConditions[0] ?? null;
    const rawLabel = (pc?.label || displayName || '').trim();
    const group = (pc?.group || signalSource || '').trim();

    let condPart = rawLabel;
    let devicePart = null;

    if (group && rawLabel.startsWith(group)) {
      // Known device prefix — strip it
      condPart = rawLabel.slice(group.length).trim();
      devicePart = group;
    } else {
      // Token heuristic: "Device Condition [N]" — last token is [N], second-to-last is condition
      const tokens = rawLabel.split(' ');
      const last = tokens[tokens.length - 1];
      if (last && /^\[\d+\]$/.test(last)) {
        axisCount = last.match(/\[(\d+)\]/)[1];
        condPart = tokens[tokens.length - 2] ?? '';
        devicePart = tokens.slice(0, -2).join(' ') || null;
      }
    }

    // Extract [N] from condPart if not already found via token heuristic
    if (!axisCount) {
      const axisMatch = condPart.match(/\[(\d+)\]$/);
      if (axisMatch) {
        axisCount = axisMatch[1];
        condPart = condPart.replace(/\s*\[\d+\]$/, '').trim();
      }
    }

    if (condPart && condPart !== rawLabel) {
      conditionDisplayName = condPart;
      deviceDisplayLabel = devicePart || null;
    }
  }

  // Live device lookup — stays linked after device renames
  const smDevices = useDiagramStore(s => s.project?.stateMachines?.find(m => m.id === smId)?.devices ?? []);

  // Dynamically resolve state signal step numbers from the referenced SM
  const allSMs = useDiagramStore(s => s.project?.stateMachines ?? []);
  const projectSignals = useDiagramStore(s => s.project?.signals ?? []);
  const resolvedSourceLabel = useMemo(() => {
    // Find the signal this node references
    const sigId = data.signalId;
    if (!sigId) return null;
    const sig = projectSignals.find(s => s.id === sigId);
    if (!sig || sig.type !== 'state' || !sig.smId) return null;
    // Find the referenced SM and compute current step numbers (live — state numbers
    // are never cached; they come from computeStateNumbers every render).
    const refSm = allSMs.find(sm => sm.id === sig.smId);
    if (!refSm) return null;
    const { stateMap } = computeStateNumbers(refSm.nodes ?? [], refSm.edges ?? [], refSm.devices ?? []);
    // Prefer stateNodeId (stable across renames). Fallback: match by stateName
    // for older signals stored before we switched to node-id references — avoids
    // showing stale "Step 3" baked into signalSource when the state has moved.
    let stepNum = sig.stateNodeId ? stateMap.get(sig.stateNodeId) : null;
    if (stepNum == null && sig.stateName) {
      const cleanSigState = sig.stateName.replace(/^\[\d+\]\s*[✓⌂⏳]?\s*/, '').trim();
      const matchNode = (refSm.nodes ?? []).find(n => (n.data?.label ?? '').trim() === cleanSigState);
      if (matchNode) stepNum = stateMap.get(matchNode.id);
    }
    if (stepNum == null) return null;
    const smName = refSm.displayName ?? refSm.name ?? '';
    // reachedMode: 'in' → Step == N (in that state right now) → "is in State N"
    //              'reached' → Step >= N (at or past that state) → "has reached State N"
    const verb = sig.reachedMode === 'reached' ? 'has reached' : 'is in';
    return `${smName ? smName + ' ' : ''}${verb} State ${stepNum}`;
  }, [data.signalId, projectSignals, allSMs]);

  // Resolve live device + condition name from conditions[0].ref
  // ref formats: "deviceId:signalId" (Robot), "deviceId:ext/ret/sensor/etc" (pneumatics/digital),
  //              "deviceId:positionName" (ServoAxis), "deviceId:signalId:cross:smId" (cross-SM Robot)
  const primaryRef = multiConditions[0]?.ref || sensorRef || '';
  const colonIdx = primaryRef.indexOf(':');
  const refDeviceId = colonIdx >= 0 ? primaryRef.slice(0, colonIdx) : (primaryRef || null);
  const refSuffix = colonIdx >= 0 ? primaryRef.slice(colonIdx + 1) : null;
  // Search all SMs — device may be in a different SM (cross-SM robot signal)
  const liveDevice = (isSensor && refDeviceId)
    ? (smDevices.find(d => d.id === refDeviceId) ?? allSMs.flatMap(m => m.devices ?? []).find(d => d.id === refDeviceId) ?? null)
    : null;
  const liveDeviceName = liveDevice?.displayName ?? liveDevice?.name ?? null;

  // v1.31 — outer-card color follows SUBJECT category (cylinder / signal /
  // sensor / servo / vision / robot / part-tracking). Aliases preserved so
  // downstream styling continues to read `fillColor` / `borderColor`
  // (smaller diff, fewer stale references).
  const subjectKey = getSubjectKey({
    signalType,
    decisionType,
    primaryCond: multiConditions[0],
    liveDevice,
  });
  const subjectColor = SUBJECT_COLORS[subjectKey] ?? SUBJECT_COLORS.default;
  const fillColor   = subjectColor.fill;
  const borderColor = subjectColor.dim;

  // For Robot signals the suffix is the signal's stable UUID — look up live name + number
  const refSignalId = refSuffix?.split(':')[0] ?? null;
  const liveSignal = (liveDevice?.type === 'Robot' && refSignalId)
    ? (liveDevice.signals?.find(s => s.id === refSignalId) ?? null)
    : null;
  const liveConditionName = liveSignal?.name ?? null;
  const liveAxisCount = liveSignal?.number != null ? String(liveSignal.number) : null;

  // Analog probe subject? AnalogSensor refs are `{deviceId}:{setpointId}` (v1.30.4+).
  // Engineer vocabulary is "in tolerance" / "out of tolerance" not ON/OFF.
  // Live-resolves to the CURRENT setpoint object so renames propagate instantly.
  const isAnalogSubject = liveDevice?.type === 'AnalogSensor';
  const liveAnalogSetpoint = (isAnalogSubject && refSuffix && Array.isArray(liveDevice?.setpoints))
    ? (liveDevice.setpoints.find(sp => sp.id === refSuffix)
       ?? liveDevice.setpoints.find(sp => sp.name === refSuffix)
       ?? (liveDevice.setpoints.length === 1 ? liveDevice.setpoints[0] : null))
    : null;
  const analogSetpointName = isAnalogSubject ? (liveAnalogSetpoint?.name ?? refSuffix ?? null) : null;

  // IO type for display: Robot signals use the signal's group (robot's perspective: DI/DO),
  // not the PLC tag prefix (q_ would wrongly show "DO" for Robot DI signals).
  // Fallback: use stored condition group (e.g. "Robot DI" → "DI").
  let effectiveIoType = ioType;
  if (liveSignal?.group === 'DI' || liveSignal?.group === 'DO') {
    effectiveIoType = liveSignal.group;
  } else if (isSensor && !liveSignal) {
    const storedGroup = multiConditions[0]?.group || '';
    if (storedGroup.includes(' DI') || storedGroup === 'Robot DI') effectiveIoType = 'DI';
    else if (storedGroup.includes(' DO') || storedGroup === 'Robot DO') effectiveIoType = 'DO';
  }

  // Subject line (big bold) — device name, live from store. For analog probes
  // include the setpoint name inline ("ProbeCheck - HeightCheck") so the
  // engineer sees what they're checking, not just which device. v1.30.4 uses
  // a hyphen separator (was `@`) — reads more naturally for non-position
  // checks and matches the user's mental model of "subject, then which
  // thing on it".
  const subjectLine = isAnalogSubject && liveDeviceName && analogSetpointName
    ? `${liveDeviceName} - ${analogSetpointName}`
    : (liveDeviceName ?? deviceDisplayLabel ?? (isSensor ? (signalSource || displayName) : displayName));

  // Condition subtitle: "DI[2] - ConditionName" (only for wait/decide sensor nodes)
  // Prefer live-resolved name (Robot signals stay linked after rename)
  const condName = liveConditionName || conditionDisplayName || '';
  const effectiveAxisCount = liveAxisCount || axisCount;
  // conditionPrefix + condName rendered separately so pill can go between them
  const conditionPrefix = (effectiveIoType ?? '') + (effectiveAxisCount ? `[${effectiveAxisCount}]` : '');
  const showConditionRow = isSensor && !isVerify && sensorInputType !== 'range'
    && (conditionPrefix || (condName && condName !== subjectLine));

  // Pill label for sensor On/Off state
  let sourceLabel;
  if (multiConditions.length > 1) {
    sourceLabel = `${multiConditions.length} conditions (${multiLogic})`;
  } else if (isSensor) {
    if (sensorInputType === 'range') {
      const minStr = rangeMin !== undefined && rangeMin !== '' ? rangeMin : '?';
      const maxStr = rangeMax !== undefined && rangeMax !== '' ? rangeMax : '?';
      sourceLabel = `Range: ${minStr} – ${maxStr}`;
    } else {
      sourceLabel = conditionType === 'off' ? 'Off' : 'On';
    }
  } else if (isVisionJob) {
    sourceLabel = signalName && signalName !== displayName ? signalName : null;
  } else {
    sourceLabel = resolvedSourceLabel ?? signalSource ?? signalSmName ?? null;
  }

  // Open popup with fixed position derived from node DOM rect -- to the RIGHT
  function handlePointerDown(e) {
    // Don't capture if the event originates from a Handle (let React Flow process it for edge drawing)
    if (e.target.closest('.react-flow__handle')) return;
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }

  function handleClick(e) {
    // Don't open popup when clicking a handle
    if (e.target.closest('.react-flow__handle')) return;
    e.stopPropagation();
    // Always select this node so Delete key works
    if (smId) store.setSelectedNode(id);
    // Only open popup if pointer didn't move much (not a drag)
    if (pointerDownPos.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);
      if (dx > 5 || dy > 5) return;
    }
    if (nodeRef.current) {
      const rect = nodeRef.current.getBoundingClientRect();
      setPopupPos({
        position: 'fixed',
        top: rect.top,
        left: rect.right + 8,
        zIndex: 9999,
      });
    }
    setShowPopup(true);
  }

  return (
    <div
      ref={nodeRef}
      style={{
        // Same shape as StateNode — wider for multi-outcome
        width: exitCount > 2 ? Math.max(NODE_WIDTH, exitCount * 70) : NODE_WIDTH,
        position: 'relative',
        cursor: 'pointer',
        background: fillColor,
        border: `2px solid ${selected ? '#ffffff' : borderColor}`,
        borderRadius: 10, // matches --radius-lg
        boxShadow: selected
          ? `0 0 0 3px ${fillColor}66, 0 10px 24px rgba(0,0,0,0.12)`
          : '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)',
        transition: 'box-shadow .15s',
        userSelect: 'none',
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* State number badge -- top-left, same style as StateNode */}
      {stateNumber != null && stateNumber > 0 && (
        <div style={{
          position: 'absolute',
          top: -6,
          left: -6,
          minWidth: 22,
          height: 18,
          padding: '0 4px',
          borderRadius: 9,
          fontSize: 9,
          fontWeight: 800,
          color: '#fff',
          background: '#1a1f2e',
          border: '1.5px solid rgba(255,255,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3,
          pointerEvents: 'none',
          lineHeight: 1,
          boxSizing: 'border-box',
        }}>
          {stateNumber}
        </div>
      )}

      {/* Content — ActionRow-style layout: [icon] [subject bold] [op badge] / advance-when text.
          Mirrors StateNode ActionRow so verify/wait/decide share the same visual grammar as actions. */}
      <div
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        style={{
          padding: '8px 10px',
          pointerEvents: 'auto',
        }}
      >
        {(() => {
          // Icon type from device/signal category. Priority: specific device
          // type (Robot, Stamper, ServoAxis, …) wins over the generic
          // DigitalSensor/AnalogSensor fallback — a wait on a Robot signal
          // is still a *Robot*, not a faceless sensor. Robot signals go
          // through handleSensorPick so `isSensor` is true, which previously
          // masked the Robot icon; checking `liveDevice?.type` first fixes it.
          let iconType = null;
          if (isVisionJob) iconType = 'VisionSystem';
          else if (liveDevice?.type) iconType = liveDevice.type;
          else if (isSensor) iconType = sensorInputType === 'range' ? 'AnalogSensor' : 'DigitalSensor';

          // v1.31 — split the old composite "Wait On · Branch" pill into two
          // pills: [Action verb] ... [Value]. Action verb describes WHAT we're
          // doing (Wait / Check / Decide / "Wait → Branch"). Value pill
          // describes the polarity / outcome (On / Off / Pass / Fail / In Tol /
          // Out / Range). Decide rows omit the value pill — the branch edge
          // labels already communicate the polarity.
          //
          // Logging is its OWN concern — the corner PtBadge + footer field-
          // name pill carry that. We do NOT suffix "· Log" onto the action
          // verb. Per user: "logging is its own thing. You don't put log in
          // the action."
          const isOn = conditionType !== 'off';
          const branches = exitCount >= 2;

          let testWord;
          if (sensorInputType === 'range') {
            testWord = 'Range';
          } else if (isVisionJob) {
            testWord = isOn ? 'Pass' : 'Fail';
          } else if (isAnalogSubject) {
            testWord = isOn ? 'In Tol' : 'Out';
          } else {
            testWord = isOn ? 'On' : 'Off';
          }

          const verb = action === 'wait' ? 'Wait' : 'Check';
          let actionVerb;
          if (isDecide) {
            actionVerb = 'Decide';
          } else if (branches) {
            actionVerb = `${verb} \u2192 Branch`;
          } else {
            actionVerb = verb;
          }
          const valueLabel = isDecide ? null : testWord;

          // Value-pill color: green = on/pass, red = off/fail, amber = range probe.
          // Null when there's no value pill (Decide).
          let valueColor = null;
          if (!isDecide) {
            valueColor = sensorInputType === 'range' ? '#f59e0b'
                       : (isOn ? '#16a34a' : '#dc2626');
          }
          // opColor still drives the inner-card left-border accent. Mirrors
          // valueColor for non-Decide rows; teal for Decide.
          const opColor = isDecide ? '#0d9488' : valueColor;

          // Auto-scale subject font (match StateNode scaling)
          const nameLen = (subjectLine ?? '').length;
          const badgeLen = (actionVerb ?? '').length + (valueLabel ?? '').length;
          const totalLen = nameLen + badgeLen;
          const nameFontSize = totalLen <= 14 ? 13 : totalLen <= 18 ? 12 : totalLen <= 22 ? 11 : totalLen <= 28 ? 10 : 9;

          // Advance-when detail line (under the row).
          //   Verify: on/off is already in the op badge AND on the branch edges — no second row.
          //   Wait:   name the SPECIFIC signal/tag that advances the step. The big-bold subject
          //           above is the *source* (device / SM / Robot) — the subtitle must name the
          //           actual bit you're waiting on, e.g. "q_MagnetLoadRobotMagnetPickClear = ON"
          //           — NOT "Magnet_Load_Robot = ON" (that reads as "wait for the robot",
          //           which is meaningless — you wait for an output bit of the robot).
          //   Decide: show the signal/source being branched on.
          //   Vision: show the job name when it differs from the subject.
          //
          // Helper: strip the source prefix from a signal name so we don't show it
          // twice ("Magnet_Load_Robot MagnetPickClear [3]" → "MagnetPickClear [3]").
          const stripSourcePrefix = (name) => {
            if (!name) return name;
            let out = name;
            const candidates = [signalSource, subjectLine, deviceDisplayLabel, liveDeviceName].filter(Boolean);
            for (const pfx of candidates) {
              if (out.startsWith(pfx + ' ') || out.startsWith(pfx + '\u2192') || out.startsWith(pfx + ' \u2192')) {
                out = out.slice(pfx.length).replace(/^\s*\u2192?\s*/, '').trim();
              }
            }
            return out || name;
          };

          let verifyText = null;
          if (isVerify) {
            verifyText = null; // branch labels + op badge already communicate the condition
          } else if (isSensor && sensorInputType === 'range') {
            const minStr = rangeMin !== undefined && rangeMin !== '' ? rangeMin : '?';
            const maxStr = rangeMax !== undefined && rangeMax !== '' ? rangeMax : '?';
            verifyText = `Range: ${minStr} – ${maxStr}`;
          } else if (isAnalogSubject) {
            // Probe subject — verify-text reads in the engineer's vocabulary.
            // v1.31 — strip the inline "Log: ... → PT" decoration; the corner
            // PtBadge + footer pill already name the tracked field, so the
            // verify line stays clean for both Wait and Log modes.
            const inOut = isOn ? 'in tolerance' : 'out of tolerance';
            verifyText = inOut;
          } else if (isSensor) {
            // Wait on/off sensor: name the exact TAG (preferred) or the specific
            // condition/signal name — never just the device. The condition to
            // advance is the bit, not its owner.
            const tag = multiConditions[0]?.tag || sensorTag;
            const detail = tag
              || (condName && condName !== subjectLine ? condName : null)
              || stripSourcePrefix(signalName)
              || subjectLine;
            verifyText = `${detail} = ${isOn ? 'ON' : 'OFF'}`;
          } else if (isVisionJob && signalName && signalName !== subjectLine) {
            verifyText = `Job: ${signalName}`;
          } else if (isDecide) {
            // Prefer LIVE state-resolved text ("{sm} has reached State N" / "{sm} is in State N")
            // so renumbering stays accurate. Never fall back to stored signalSource —
            // older entries baked "→ Step N" into that string and it goes stale on renumber.
            verifyText = resolvedSourceLabel || (signalName && signalName !== subjectLine ? signalName : null);
          } else if (resolvedSourceLabel) {
            verifyText = resolvedSourceLabel;
          } else if (signalName && signalName !== subjectLine) {
            // Wait on a signal (state / condition / position / SM output) — show
            // the SPECIFIC signal that advances, stripped of any redundant source
            // prefix. Honor conditionType so OFF waits don't mislabel as ON.
            const detail = stripSourcePrefix(signalName);
            verifyText = `${detail} = ${isOn ? 'ON' : 'OFF'}`;
          } else if (sourceLabel && !isSensor) {
            verifyText = sourceLabel;
          }

          // Inner card tinted to match the outer node color (softer than pure white).
          const innerBg = `color-mix(in srgb, ${fillColor} 22%, #ffffff)`;

          // Op pill opens a mini popup (matches StateNode action-pill pattern).
          // Binary wait/verify nodes only — Decide, Vision, and Range aren't binary.
          const isRangeOp = sensorInputType === 'range';
          const canToggleOnOff = !isDecide && !isVisionJob && !isRangeOp;
          const handleOpClick = canToggleOnOff
            ? (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (opSwitcher) {
                  setOpSwitcher(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setOpSwitcher({ pos: { top: rect.bottom + 4, left: rect.left } });
                }
              }
            : undefined;

          return (
            <div className="action-row-wrap">
              <div className="action-row" style={{ borderLeftColor: opColor, background: innerBg }}>
                {iconType && (
                  <span className="action-icon"><DeviceIcon type={iconType} size={18} /></span>
                )}
                {/* v1.31 — three-pill layout: [Action verb] [Detail = subject]
                    [Value]. Action verb uses actionFill (blue Wait / teal Check).
                    The middle is the subject's specific instance (device / signal
                    / job name). The trailing Value pill carries the polarity
                    (On/Off/Pass/Fail/In Tol/Out/Range). Decide rows omit the
                    value pill — branches communicate it. */}
                <span
                  className="action-op"
                  style={{
                    background: actionFill,
                    color: '#fff',
                    borderColor: actionFill,
                    marginLeft: 0,
                  }}
                  title={`Action: ${actionVerb}`}
                >{actionVerb}</span>
                <span
                  className="action-device"
                  style={{ fontSize: nameFontSize }}
                  title={subjectLine}
                >
                  {subjectLine}
                </span>
                {valueLabel && (
                  <span
                    className={`action-op${canToggleOnOff ? ' action-op--clickable nodrag' : ''}`}
                    style={{
                      background: valueColor,
                      color: '#fff',
                      borderColor: valueColor,
                    }}
                    onClick={handleOpClick}
                    onMouseDown={canToggleOnOff ? (e) => e.stopPropagation() : undefined}
                    title={canToggleOnOff ? 'Click to toggle On / Off' : `Value: ${valueLabel}`}
                  >{valueLabel}</span>
                )}
              </div>
              {verifyText && (
                <div className="action-verify" style={{ color: '#ffffff', opacity: 0.92, textShadow: '0 1px 1px rgba(0,0,0,0.25)' }}>
                  {verifyText}
                </div>
              )}
            </div>
          );
        })()}

        {/* Retry badge — shows in any mode when retry is enabled */}
        {retryEnabled && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, fontWeight: 700,
              background: 'rgba(0,0,0,0.3)', color: '#fbbf24',
              padding: '1px 6px', borderRadius: 8,
              letterSpacing: '0.03em',
            }}>
              {'\u21BB'} Retry x{retryMax}
            </span>
          </div>
        )}
        {/* v1.30.6 — Removed the in-node "Log: <polarity>" footer pill.
            On standalone DecisionNode the corner PtBadge already names the
            tracked field; an inline footer would be redundant (and the
            polarity vocab here read as duplicate info next to the op pill).
            DecisionBody (embedded row) keeps a slim field-name pill since
            it has no corner badge of its own. */}
      </div>


      {/* Popup rendered via createPortal at document.body with fixed position */}
      {showPopup && smId && (
        <DecisionEditPopup
          nodeId={id}
          smId={smId}
          data={data}
          onClose={() => setShowPopup(false)}
          style={popupPos}
        />
      )}

      {/* On/Off switcher popup for the op pill */}
      {opSwitcher && smId && (
        <OnOffSwitcher
          smId={smId}
          nodeId={id}
          currentType={conditionType}
          mode={nodeMode}
          analog={isAnalogSubject}
          pos={opSwitcher.pos}
          onClose={() => setOpSwitcher(null)}
        />
      )}

      {/* PT/Signal Badge — always visible when content exists. v1.29: any
          decision (wait or check) with ptEnabled contributes its own PT
          field as a derived annotation so the corner badge appears without
          the user manually wiring data.ptAnnotations. The optional REAL
          value-log field gets a second annotation when valueLogEnabled. */}
      {(() => {
        const derived = [];
        if (data.ptEnabled && (data.ptFieldName || data.ptFieldId)) {
          derived.push({
            fieldId: data.ptFieldId ?? `node_${id}`,
            fieldName: data.ptFieldName ?? '(unnamed)',
            value: data.ptPassValue ?? 'SUCCESS',
          });
          if (data.valueLogEnabled && (data.valueFieldId || data.valueFieldName)) {
            derived.push({
              fieldId: data.valueFieldId ?? `node_${id}_val`,
              fieldName: data.valueFieldName ?? '(unnamed value)',
              value: 'SET',
            });
          }
        }
        const combined = [...(data.ptAnnotations ?? []), ...derived];
        return <PtBadge nodeId={id} smId={smId} annotations={combined} selected={selected} />;
      })()}

      {/* Connect Menu — direction arrows when handle clicked */}
      <ConnectMenu nodeId={id} nodeType="decisionNode" exitCount={exitCount} signalName={signalName} smId={smId} />

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        className="sdc-handle"
      />

      {/* Bottom handle for single-exit or unconfigured nodes */}
      {(exitCount === 1 || !signalName || signalName === 'Select Signal...') && exitCount <= 2 && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="exit-single"
          className="sdc-handle"
        />
      )}

      {/* Side handles for 2-exit branching */}
      {exitCount === 2 && signalName && signalName !== 'Select Signal...' && (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="exit-pass"
            className="sdc-handle sdc-handle--pass"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="exit-fail"
            className="sdc-handle sdc-handle--fail"
          />
        </>
      )}

      {/* Bottom handle for retry branch (only when retry is enabled + 2-exit) */}
      {retryEnabled && exitCount === 2 && signalName && signalName !== 'Select Signal...' && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="exit-retry"
          className="sdc-handle sdc-handle--retry"
          isConnectable
        />
      )}

      {/* Multi-outcome bottom handles (exitCount > 2) — evenly spaced */}
      {exitCount > 2 && signalName && signalName !== 'Select Signal...' && (
        <>
          {Array.from({ length: exitCount }, (_, i) => {
            const pct = ((i + 1) / (exitCount + 1)) * 100;
            return (
              <Handle
                key={`exit-${i}`}
                type="source"
                position={Position.Bottom}
                id={`exit-${i}`}
                className="sdc-handle sdc-handle--multi"
                style={{ left: `${pct}%` }}
              />
            );
          })}
        </>
      )}

      {/* Click detection on handles to open ConnectMenu */}
      {(exitCount === 1 || !signalName || signalName === 'Select Signal...') && exitCount <= 2 && (
        <HandleClickZone nodeId={id} handleSelector=".sdc-handle.react-flow__handle-bottom" handleId="exit-single" />
      )}
      {exitCount === 2 && signalName && signalName !== 'Select Signal...' && (
        <>
          <HandleClickZone nodeId={id} handleSelector=".sdc-handle--pass" handleId="exit-pass" />
          <HandleClickZone nodeId={id} handleSelector=".sdc-handle--fail" handleId="exit-fail" />
          {retryEnabled && (
            <HandleClickZone nodeId={id} handleSelector=".sdc-handle--retry" handleId="exit-retry" />
          )}
        </>
      )}
      {exitCount > 2 && signalName && signalName !== 'Select Signal...' && (
        <>
          {Array.from({ length: exitCount }, (_, i) => (
            <HandleClickZone key={`hcz-${i}`} nodeId={id} handleSelector={`.sdc-handle--multi[data-handleid='exit-${i}']`} handleId={`exit-${i}`} />
          ))}
        </>
      )}

      {/* Right-click context menu via portal */}
      {ctxMenu && createPortal(
        <DecisionContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          nodeId={id}
          smId={smId}
          onClose={() => setCtxMenu(null)}
        />,
        document.body
      )}
    </div>
  );
}

// ── Right-click context menu for DecisionNode ────────────────────────────────
function DecisionContextMenu({ x, y, nodeId, smId, onClose }) {
  const store = useDiagramStore();
  const ref = useRef(null);
  const zoomStyle = useReactFlowZoomScale();

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 9999,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        padding: '4px 0',
        minWidth: 140,
        fontSize: 13,
        ...zoomStyle,
      }}
    >
      <button
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '6px 14px', background: 'none', border: 'none',
          cursor: 'pointer', color: '#dc2626', fontSize: 13, textAlign: 'left',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
        onClick={() => { store.deleteNode(smId, nodeId); onClose(); }}
      >
        {'\u2715'} Delete
      </button>
    </div>
  );
}
