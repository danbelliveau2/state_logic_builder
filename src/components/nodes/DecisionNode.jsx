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

// ── On/Off Switcher Popup ─────────────────────────────────────────────────────
// Mirrors StateNode's OperationSwitcher UX. Click the Wait On / Verify On pill
// on a decision node to open this little menu; pick On or Off.

function OnOffSwitcher({ smId, nodeId, currentType, mode, pos, onClose, onUpdate }) {
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

  const verb = mode === 'verify' ? 'Verify' : 'Wait';
  const options = [
    { value: 'on',  label: `${verb} On`,  color: '#16a34a' },
    { value: 'off', label: `${verb} Off`, color: '#dc2626' },
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

  // Part tracking: optionally set a PT field on pass/fail branches
  const [ptEnabled, setPtEnabled] = useState(data.ptEnabled ?? false);
  const [ptFieldId, setPtFieldId] = useState(data.ptFieldId ?? null);
  const [ptFieldName, setPtFieldName] = useState(data.ptFieldName ?? '');
  const [ptPassValue, setPtPassValue] = useState(data.ptPassValue ?? 'SUCCESS');
  const [ptFailValue, setPtFailValue] = useState(data.ptFailValue ?? 'FAILURE');

  // Retry counter config (only meaningful for 'wait' mode)
  const [retryEnabled, setRetryEnabled] = useState(data.retryEnabled ?? false);
  const [retryMax, setRetryMax] = useState(data.retryMax ?? 3);

  // After picking any signal/vision, show branch config step
  // Always start on the branch config builder — no separate signal picker step
  const [showBranchConfig, setShowBranchConfig] = useState(true);

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
    if (editingConditionIdx !== null) {
      setConditions(prev => prev.map((c, i) => i === editingConditionIdx ? { ...newCond, conditionType: (c.inputType === newCond.inputType ? (c.conditionType ?? newCond.conditionType) : newCond.conditionType) } : c));
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
    setSignalId(`sensor_${inp.ref}`);
    setSignalName(shortName);
    setSignalSource(inp.group);
    setSignalSmName(null);
    setSignalType('sensor');
    setDecisionType('signal');
    setExitCount(nodeMode === 'decide' ? 2 : 1);
    setSensorRef(inp.ref);
    setSensorTag(inp.tag);
    setSensorInputType(inp.inputType ?? 'bool');
    let e1, e2;
    if (inp.inputType === 'range') {
      setConditionType('range');
      e1 = 'InRange';
      e2 = 'OutOfRange';
    } else {
      setConditionType('on');
      e1 = 'On';
      e2 = 'Off';
    }
    setExit1Label(e1);
    setExit2Label(e2);
    setLabelsCustomized(false);
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
    //   Binary (sensor/signal/state/condition/PT) → On / Off
    //     (Verify+Off swaps so exit1 = picked polarity)
    // Rationale: Verify means "assert the condition"; Decide means "branch on the
    // condition". Neither is a Pass/Fail concept — those are vision-only.
    if (cond.signalType === 'visionJob') {
      exit1 = 'Pass';
      exit2 = 'Fail';
    } else if (cond.inputType === 'range' || cond.conditionType === 'range') {
      exit1 = 'InRange';
      exit2 = 'OutOfRange';
    } else {
      // Binary — everything that isn't vision or range falls here.
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
      // Part tracking
      ptEnabled,
      ptFieldId: ptEnabled ? ptFieldId : undefined,
      ptFieldName: ptEnabled ? ptFieldName : undefined,
      ptPassValue: ptEnabled ? ptPassValue : undefined,
      ptFailValue: ptEnabled ? ptFailValue : undefined,
      // Multi-condition
      conditions: conditions.length > 0 ? conditions : undefined,
      conditionLogic: conditions.length > 1 ? conditionLogic : undefined,
    };
    // Auto-create PT field if user typed a new name (no existing field selected)
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
        operation: nodeMode === 'wait' ? 'Wait' : nodeMode === 'decide' ? 'Decide' : 'Verify',
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
              : nodeMode === 'decide' ? 'Decide On…'
              : nodeMode === 'verify' ? 'Verify…'
              : 'Wait On…'}
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
        {/* Mode selector row — always visible so user can switch Wait/Decide/Verify at any step */}
        {editingConditionIdx === null && !addingCondition && (() => {
          const modes = [
            { key: 'wait',   label: 'Wait',   emoji: '\u23F3', active: '#0072B5', activeBorder: '#3b82f6', tip: 'Pause step until condition is TRUE.' },
            { key: 'decide', label: 'Decide', emoji: '\u26A1', active: '#7c3aed', activeBorder: '#8b5cf6', tip: 'Read condition NOW and branch — no pause.' },
            { key: 'verify', label: 'Verify', emoji: '\u2713', active: '#E8A317', activeBorder: '#f59e0b', tip: 'Confirm condition is TRUE; if not, fault.' },
          ];
          return (
            <div style={{ padding: '2px 8px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {modes.map(m => {
                  const isActive = nodeMode === m.key;
                  return (
                    <button
                      key={m.key}
                      className="nodrag"
                      onClick={() => {
                        setNodeMode(m.key);
                        // Decide always branches; Wait collapses to a single exit UNLESS
                        // it's a multi-condition wait (each condition can own an exit).
                        if (m.key === 'decide' && exitCount === 1) setExitCount(2);
                        if (m.key === 'wait' && exitCount > 1 && conditions.length <= 1) setExitCount(1);
                        if (m.key === 'verify' && exitCount > 1) setExitCount(1);
                      }}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        background: isActive ? m.active : '#f1f5f9',
                        border: isActive ? `1px solid ${m.activeBorder}` : '1px solid #d1d5db',
                        color: isActive ? '#fff' : '#64748b',
                      }}
                    >{m.emoji} {m.label}</button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.3, padding: '0 2px' }}>
                {modes.find(m => m.key === nodeMode)?.tip}
              </div>
            </div>
          );
        })()}
      </div>

      {/* -- Signal picker (step 1) -- */}
      {!showBranchConfig && (() => {
        // Collapsible section header. Entire row clickable; chevron + icon + label.
        const SectionHeader = ({ sectionKey, iconType, label, color = '#6b7280' }) => {
          const collapsed = !isExpanded(sectionKey);
          return (
            <div
              className="nodrag"
              onClick={() => toggleSection(sectionKey)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 700, color, padding: '8px 12px 3px',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              <span style={{ fontSize: 9, width: 10, display: 'inline-block', transition: 'transform 120ms', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>{'\u25BE'}</span>
              {iconType && <DeviceIcon type={iconType} size={14} color={color} />}
              <span>{label}</span>
            </div>
          );
        };
        return (
        <div ref={listRef} style={{ padding: '4px 0', overflowY: 'auto', flex: 1 }}>

          {/* VISION section */}
          {visionSignals.length > 0 && (
            <>
              <SectionHeader sectionKey="vision" iconType="VisionSystem" label="Vision" color="#0891b2" />
              {isExpanded('vision') && visionSignals.map(sig => (
                <button
                  key={sig.id}
                  className="nodrag"
                  onClick={() => handleVisionPick(sig)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: signalId === sig.id ? '#eff6ff' : 'none',
                    border: 'none', borderLeft: signalId === sig.id ? '3px solid #f59e0b' : '3px solid transparent',
                    color: '#1e293b', cursor: 'pointer', padding: '5px 10px',
                    textAlign: 'left', fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1 }}>{sig.signalName}</span>
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>{sig.signalSource}</span>
                </button>
              ))}
            </>
          )}

          {/* PART RESULTS section — vision-linked PT fields from upstream stations */}
          {ptFields.some(f => f._visionLinked) && (
            <>
              <SectionHeader sectionKey="partResults" iconType="VisionSystem" label="Part Results (from upstream)" color="#fbbf24" />
              {isExpanded('partResults') && ptFields.filter(f => f._visionLinked).map(field => {
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
                      color: '#1e293b', cursor: 'pointer', padding: '5px 10px',
                      textAlign: 'left', fontSize: 11,
                    }}
                  >
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
            </>
          )}

          {/* PART TRACKING section — user-defined fields */}
          {ptFields.some(f => !f._visionLinked) && (
            <>
              <SectionHeader sectionKey="partTracking" iconType="Parameter" label="Part Tracking" color="#f97316" />
              {isExpanded('partTracking') && ptFields.filter(f => !f._visionLinked).map(field => (
                <button
                  key={field.id}
                  className="nodrag"
                  onClick={() => handlePTPick(field)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: signalId === `pt_${field.id}` ? '#f0fdf4' : 'none',
                    border: 'none', borderLeft: signalId === `pt_${field.id}` ? '3px solid #86efac' : '3px solid transparent',
                    color: '#1e293b', cursor: 'pointer', padding: '5px 10px',
                    textAlign: 'left', fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1 }}>{field.name}</span>
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, color: '#86efac', background: '#14532d' }}>PT</span>
                </button>
              ))}
            </>
          )}

          {/* SENSORS & DEVICES section + separate ROBOT section */}
          {sensorInputs.length > 0 && (() => {
            // Partition: anything whose group starts with "Robot " is a robot signal
            const isRobotGroup = (g) => typeof g === 'string' && g.startsWith('Robot ');
            const robotInputs  = sensorInputs.filter(inp => isRobotGroup(inp.group));
            const deviceInputs = sensorInputs.filter(inp => !isRobotGroup(inp.group));

            const groupBy = (items) => {
              const out = {};
              for (const inp of items) {
                const g = inp.group || 'Other';
                if (!out[g]) out[g] = [];
                out[g].push(inp);
              }
              return out;
            };
            const deviceGrouped = groupBy(deviceInputs);
            const robotGrouped  = groupBy(robotInputs);

            const renderItem = (inp, accentHex, accentBg) => (
              <button
                key={inp.ref}
                className="nodrag"
                onClick={() => handleSensorPick(inp)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', background: signalId === `sensor_${inp.ref}` ? '#f1f5f9' : 'none',
                  border: 'none', borderLeft: signalId === `sensor_${inp.ref}` ? `3px solid ${accentHex}` : '3px solid transparent',
                  color: '#1e293b', cursor: 'pointer', padding: '4px 10px 4px 20px',
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

            return (
              <>
                {deviceInputs.length > 0 && (
                  <>
                    <SectionHeader sectionKey="sensors" iconType="DigitalSensor" label="Sensors & Devices" color="#64748b" />
                    {isExpanded('sensors') && Object.entries(deviceGrouped).map(([groupName, items]) => {
                      const subKey = `sensors/${groupName}`;
                      const subCollapsed = !isExpanded(subKey);
                      // Resolve device type for icon from first item's device
                      const firstItem = items[0];
                      const devId = firstItem?.ref?.split(':')[0];
                      const dev = devId ? (currentSm?.devices ?? []).find(d => d.id === devId) : null;
                      const subIconType = dev?.type ?? 'DigitalSensor';
                      return (
                        <div key={groupName}>
                          <div
                            className="nodrag"
                            onClick={() => toggleSection(subKey)}
                            style={{ fontSize: 10, color: '#4b5563', padding: '4px 10px 2px 18px', fontWeight: 600, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <span style={{ fontSize: 8, display: 'inline-block', width: 8, transform: subCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}>{'\u25BE'}</span>
                            <DeviceIcon type={subIconType} size={12} />
                            {groupName}
                          </div>
                          {!subCollapsed && items.map(inp => renderItem(inp, '#22d3ee', '#164e63'))}
                        </div>
                      );
                    })}
                  </>
                )}

                {robotInputs.length > 0 && (
                  <>
                    <SectionHeader sectionKey="robot" iconType="Robot" label="Robot" color="#7c3aed" />
                    {isExpanded('robot') && Object.entries(robotGrouped).map(([groupName, items]) => {
                      // Strip the "Robot " prefix for the sub-label — section header already says Robot
                      const subLabel = groupName.replace(/^Robot\s+/, '');
                      const subKey = `robot/${groupName}`;
                      const subCollapsed = !isExpanded(subKey);
                      return (
                        <div key={groupName}>
                          <div
                            className="nodrag"
                            onClick={() => toggleSection(subKey)}
                            style={{ fontSize: 10, color: '#4b5563', padding: '4px 10px 2px 18px', fontWeight: 600, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <span style={{ fontSize: 8, display: 'inline-block', width: 8, transform: subCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}>{'\u25BE'}</span>
                            <DeviceIcon type="Robot" size={12} color="#7c3aed" />
                            {subLabel}
                          </div>
                          {!subCollapsed && items.map(inp => renderItem(inp, '#a78bfa', '#3b2a6b'))}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            );
          })()}

          {/* SIGNALS section (all user signals -- position, state, condition merged) */}
          {projectSignals.length > 0 && (
            <>
              <SectionHeader sectionKey="signals" label="Signals" color="#64748b" />
              {isExpanded('signals') && projectSignals.map(sig => {
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
                      color: '#1e293b', cursor: 'pointer', padding: '5px 10px',
                      textAlign: 'left', fontSize: 11,
                    }}
                  >
                    <span style={{ flex: 1 }}>{sig.name}</span>
                    {subtext && <span style={{ fontSize: 9, color: '#9ca3af', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtext}</span>}
                    {badge && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, color: badge.color, background: badge.bg }}>{badge.label}</span>}
                  </button>
                );
              })}
            </>
          )}

          {allSignals.length === 0 && ptFields.length === 0 && sensorInputs.length === 0 && (
            <div style={{ padding: '12px 10px', fontSize: 10, color: '#6b7280', fontStyle: 'italic', textAlign: 'center' }}>
              No signals or sensors available.<br/>Add devices, Signals, or Part Tracking fields.
            </div>
          )}
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

          {/* ── Retry counter (available in all modes: wait, decide, verify) ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', marginBottom: 2 }}>
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
                  Retry Counter
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

          {/* ── Sensor condition config (single condition only) ─── */}
          {isSensor && conditions.length <= 1 && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#0891b2', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Condition</div>

              {/* Boolean sensor: On / Off toggle — label changes by mode */}
              {!isRange && (() => {
                // Wait = "Wait for ON", Decide = "Check ON", Verify = "Verify ON"
                const verb = nodeMode === 'wait' ? 'Wait for'
                           : nodeMode === 'verify' ? 'Verify'
                           : 'Check';
                return (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="nodrag"
                      onClick={() => {
                        setConditionType('on');
                        setExit1Label('On');
                        setExit2Label('Off');
                        setLabelsCustomized(false);
                      }}
                      style={{
                        flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                        background: conditionType === 'on' ? '#16a34a' : '#fff',
                        border: conditionType === 'on' ? '1px solid #22c55e' : '1px solid #d1d5db',
                        color: conditionType === 'on' ? '#fff' : '#64748b',
                      }}
                    >{'\u2713'} {verb} ON</button>
                    <button
                      className="nodrag"
                      onClick={() => {
                        setConditionType('off');
                        setExit1Label('Off');
                        setExit2Label('On');
                        setLabelsCustomized(false);
                      }}
                      style={{
                        flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                        // In Verify mode: green when selected (you're picking what to verify, not bad/good).
                        // In other modes: OFF stays red to signal "not the expected condition".
                        background: conditionType === 'off'
                          ? (nodeMode === 'verify' ? '#16a34a' : '#dc2626')
                          : '#fff',
                        border: conditionType === 'off'
                          ? (nodeMode === 'verify' ? '1px solid #22c55e' : '1px solid #ef4444')
                          : '1px solid #d1d5db',
                        color: conditionType === 'off' ? '#fff' : '#64748b',
                      }}
                    >{'\u2717'} {verb} OFF</button>
                  </div>
                );
              })()}

              {/* Range sensor: setpoint picker */}
              {isRange && (() => {
                // Resolve device from sensorRef to get its named setpoints
                const refDeviceId = sensorRef?.split(':')[0];
                const refDevice = refDeviceId ? (currentSm?.devices ?? []).find(d => d.id === refDeviceId) : null;
                const namedSetpoints = refDevice?.type === 'AnalogSensor'
                  ? (refDevice.setpoints ?? [])
                  : refDevice?.type === 'ServoAxis'
                    ? (refDevice.positions ?? [])
                    : [];
                // Currently selected setpoint name (from sensorRef like "deviceId:setpointName")
                const currentSpName = sensorRef?.split(':')[1];
                const isRawValue = currentSpName === 'value';

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {namedSetpoints.length > 0 ? (
                      <>
                        <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1.3 }}>
                          Pick a setpoint — range is defined on the device.
                        </div>
                        <select
                          className="nodrag"
                          value={isRawValue ? '' : (currentSpName || '')}
                          onChange={e => {
                            const spName = e.target.value;
                            if (!spName) return;
                            // Update sensorRef to point at the named setpoint (bool In_Range check)
                            const newRef = `${refDeviceId}:${spName}`;
                            setSensorRef(newRef);
                            // Find the matching input from available inputs to get the correct tag
                            const matchInput = sensorInputs.find(inp => inp.ref === newRef);
                            if (matchInput) {
                              setSensorTag(matchInput.tag);
                              setSensorInputType('bool');
                            }
                            setConditionType('on');
                            setExit1Label('InRange');
                            setExit2Label('OutOfRange');
                            setLabelsCustomized(false);
                          }}
                          style={{
                            width: '100%', background: '#fff', border: '1px solid #d1d5db',
                            color: '#1e293b', borderRadius: 4, padding: '5px 6px', fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          <option value="" disabled>Select setpoint…</option>
                          {namedSetpoints.map(sp => (
                            <option key={sp.name} value={sp.name}>
                              {sp.name}{sp.nominal != null ? ` (${sp.nominal}${sp.tolerance != null ? ` ±${sp.tolerance}` : ''})` : sp.defaultValue != null ? ` (${sp.defaultValue})` : ''}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1.3 }}>
                          No setpoints defined on device. Add setpoints in device config.
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Tag preview */}
              {sensorTag && (
                <div style={{ fontSize: 9, color: '#4b5563', marginTop: 4, fontFamily: 'monospace' }}>
                  Tag: {sensorTag}
                </div>
              )}
            </div>
          )}

          {/* ── Signal / Condition picker (always visible) ──────────────────────── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {conditions.length === 0 ? 'Signal / Condition' : `Conditions${conditions.length > 1 ? ` (${conditions.length})` : ''}`}
              </span>
                {conditions.length > 1 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="nodrag" onClick={() => setConditionLogic('AND')}
                      style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                        background: conditionLogic === 'AND' ? '#16a34a' : '#fff',
                        border: conditionLogic === 'AND' ? '1px solid #22c55e' : '1px solid #d1d5db',
                        color: conditionLogic === 'AND' ? '#fff' : '#64748b' }}>AND</button>
                    <button className="nodrag" onClick={() => setConditionLogic('OR')}
                      style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                        background: conditionLogic === 'OR' ? '#2563eb' : '#fff',
                        border: conditionLogic === 'OR' ? '1px solid #3b82f6' : '1px solid #d1d5db',
                        color: conditionLogic === 'OR' ? '#fff' : '#64748b' }}>OR</button>
                  </div>
                )}
              </div>
              {conditions.length > 1 && (
                <div style={{ fontSize: 8, color: '#6b7280', marginBottom: 4, lineHeight: 1.3 }}>
                  {conditionLogic === 'AND'
                    ? 'ALL conditions must be true to pass.'
                    : 'ANY condition being true will pass.'}
                </div>
              )}
              {conditions.map((cond, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0', borderTop: idx > 0 ? '1px solid #e2e8f0' : 'none' }}>
                  {cond.inputType !== 'range' && (
                    <button className="nodrag" onClick={() => {
                      const newType = cond.conditionType === 'on' ? 'off' : 'on';
                      setConditions(prev => prev.map((c, i) => i === idx ? { ...c, conditionType: newType } : c));
                      // Sync primary conditionType if it's the first condition
                      if (idx === 0) setConditionType(newType);
                    }}
                      style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, cursor: 'pointer', border: 'none',
                        background: cond.conditionType === 'off' ? '#dc2626' : '#16a34a',
                        color: '#fff', flexShrink: 0 }}>
                      {cond.conditionType === 'off' ? 'OFF' : 'ON'}
                    </button>
                  )}
                  {cond.inputType === 'range' && (
                    <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#78350f', color: '#fbbf24', flexShrink: 0 }}>RNG</span>
                  )}
                  <button
                    className="nodrag"
                    title="Click to change this condition"
                    onClick={() => { setEditingConditionIdx(idx); setShowBranchConfig(false); }}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 10, color: '#1e293b',
                      background: 'transparent', border: '1px solid transparent',
                      borderRadius: 3, padding: '2px 4px', cursor: 'pointer',
                      textAlign: 'left', overflow: 'hidden',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cond.label}</span>
                    <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0 }}>{'\u270E'}</span>
                  </button>
                  {conditions.length > 1 && (
                    <button className="nodrag" onClick={() => setConditions(prev => prev.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '0 2px', flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              {conditions.length === 0 ? (
                <>
                  <button className="nodrag" onClick={() => { setAddingCondition(true); setShowBranchConfig(false); }}
                    style={{
                      width: '100%', padding: '10px 8px', borderRadius: 6, cursor: 'pointer',
                      fontSize: 12, fontWeight: 700, color: '#fff',
                      background: '#0072B5', border: '1px solid #005a91',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                    + Pick Signal / Sensor / Condition
                  </button>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, textAlign: 'center', lineHeight: 1.3 }}>
                    Choose what this node will {nodeMode === 'verify' ? 'verify' : nodeMode === 'decide' ? 'branch on' : 'wait for'}.
                  </div>
                </>
              ) : (
                <button className="nodrag" onClick={() => { setAddingCondition(true); setShowBranchConfig(false); }}
                  style={{ width: '100%', marginTop: 4, padding: '4px 0', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                    background: '#fff', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  + Add Condition
                </button>
              )}
            </div>

          {/* ── Part Tracking toggle ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label
                className="nodrag"
                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}
                onClick={() => {
                  const next = !ptEnabled;
                  setPtEnabled(next);
                  // Auto-populate field name from signal name when first enabled
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
                  📊 Part Tracking
                </span>
              </label>
            </div>
            {ptEnabled && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Field picker: existing fields or custom name */}
                <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.3 }}>
                  Pick an existing field or name a new one.
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
                {/* PT field writes per branch. Labels use the current branch
                    vocabulary (exit1Label/exit2Label) — NOT hardcoded "Pass/Fail".
                    For a binary "Verify On" condition these read "✓ On writes" /
                    "✗ Off writes"; for a vision decision they read "✓ Pass writes"
                    / "✗ Fail writes". */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: '#16a34a', fontWeight: 700, marginBottom: 1 }}>✓ {exit1Label} writes</div>
                    <select className="nodrag" value={ptPassValue} onChange={e => setPtPassValue(e.target.value)}
                      style={{ width: '100%', fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db', background: '#fff', color: '#1e293b', cursor: 'pointer' }}>
                      <option value="SUCCESS">SUCCESS</option>
                      <option value="FAILURE">FAILURE</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700, marginBottom: 1 }}>✗ {exit2Label} writes</div>
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

          {/* 1 branch -- single exit (wait & verify only — decide always branches) */}
          {nodeMode !== 'decide' && (
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
              <span style={{ flex: 1 }}>Single exit — <b>{singleLabel}</b></span>
            </button>
          )}

          {/* 2 branches -- dual exit.
              Hidden for wait mode with ≤1 condition: a wait on a single condition
              can't branch — if the condition isn't met, the state just doesn't
              advance (same rule as any other state). Wait only branches when
              multiple conditions are being watched (one exit per condition). */}
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
              <span style={{ flex: 1 }}>Branch <b>{dualLabel1} / {dualLabel2}</b></span>
            </button>
          )}

          {/* Multiple outcomes — decide mode only */}
          {nodeMode === 'decide' && (
            <button
              className="nodrag"
              onClick={() => {
                const count = exitCount > 2 ? exitCount : 3;
                setExitCount(count);
                // Ensure outcomeLabels has enough entries
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
              <span style={{ flex: 1 }}>Multiple outcomes</span>
            </button>
          )}

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
          >{conditions.length === 0 ? 'Pick a signal first' : 'Done'}</button>
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
  const fillColor   = nodeMode === 'verify' ? '#E8A317'
                    : nodeMode === 'decide' ? '#7c3aed'
                    : '#0072B5';
  const borderColor = nodeMode === 'verify' ? '#b87d0f'
                    : nodeMode === 'decide' ? '#6d28d9'
                    : '#005a91';
  const isSensor = signalType === 'sensor' || !!sensorRef;
  const isVerify = nodeMode === 'verify';
  const isDecide = nodeMode === 'decide';
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

  let effectiveIoType = ioType;
  if (liveSignal?.group === 'DI' || liveSignal?.group === 'DO') {
    effectiveIoType = liveSignal.group;
  } else if (isSensor && !liveSignal) {
    const storedGroup = multiConditions[0]?.group || '';
    if (storedGroup.includes(' DI') || storedGroup === 'Robot DI') effectiveIoType = 'DI';
    else if (storedGroup.includes(' DO') || storedGroup === 'Robot DO') effectiveIoType = 'DO';
  }

  const subjectLine = liveDeviceName ?? deviceDisplayLabel ?? (isSensor ? (signalSource || displayName) : displayName);
  const condName = liveConditionName || conditionDisplayName || '';
  const effectiveAxisCount = liveAxisCount || axisCount;
  const conditionPrefix = (effectiveIoType ?? '') + (effectiveAxisCount ? `[${effectiveAxisCount}]` : '');

  // Op badge label + color
  const isOn = conditionType !== 'off';
  let opLabel, opColor;
  if (isVerify) {
    if (sensorInputType === 'range') { opLabel = 'Verify Range'; opColor = '#f59e0b'; }
    else { opLabel = isOn ? 'Verify On' : 'Verify Off'; opColor = isOn ? '#16a34a' : '#dc2626'; }
  } else if (isDecide) {
    opLabel = 'Decide'; opColor = '#7c3aed';
  } else if (isVisionJob) {
    opLabel = 'Vision'; opColor = '#0ea5e9';
  } else if (isSensor) {
    if (sensorInputType === 'range') { opLabel = 'Wait Range'; opColor = '#0ea5e9'; }
    else { opLabel = isOn ? 'Wait On' : 'Wait Off'; opColor = isOn ? '#16a34a' : '#dc2626'; }
  } else {
    opLabel = isOn ? 'Wait On' : 'Wait Off';
    opColor = isOn ? '#16a34a' : '#dc2626';
  }

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
  const badgeLen = (opLabel ?? '').length;
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
              <span className="action-icon"><DeviceIcon type={iconType} size={14} /></span>
            )}
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
            <span
              className={`action-op${canToggleOnOff ? ' action-op--clickable nodrag' : ''}`}
              style={{ background: opColor, color: '#fff', borderColor: opColor }}
              onClick={handleOpClick}
              onMouseDown={canToggleOnOff ? (e) => e.stopPropagation() : undefined}
              title={canToggleOnOff ? 'Click to toggle On / Off' : undefined}
            >{opLabel}</span>
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
        {/* Part Tracking badge */}
        {data.ptEnabled && data.ptFieldName && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700,
              background: 'rgba(0,0,0,0.3)', color: '#86efac', padding: '1px 6px', borderRadius: 8,
              letterSpacing: '0.03em',
            }}>📊 PT: {data.ptFieldName}</span>
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
  // Node color determined by MODE, not signal type.
  //   Wait   → blue      Decide → purple      Verify → orange
  const fillColor   = nodeMode === 'verify' ? '#E8A317'
                    : nodeMode === 'decide' ? '#7c3aed'
                    : '#0072B5';
  const borderColor = nodeMode === 'verify' ? '#b87d0f'
                    : nodeMode === 'decide' ? '#6d28d9'
                    : '#005a91';
  const textColor   = '#ffffff';
  const mutedColor  = 'rgba(255,255,255,0.75)';

  // Derived mode flags used in render below
  const isSensor = signalType === 'sensor' || !!sensorRef;
  const isVerify = nodeMode === 'verify';
  // Only the explicit 'decide' mode earns the "Decide" badge + purple styling.
  // A wait node with 2 exits (user picked "Branch True/False" in step 2) is still
  // a WAIT node — it waits for the signal to resolve, then branches on the outcome.
  // Its op badge should still read "Wait On" / "Wait Off", and its on/off toggle
  // should stay usable (canToggleOnOff depends on !isDecide).
  const isDecide = nodeMode === 'decide';
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

  // For Robot signals the suffix is the signal's stable UUID — look up live name + number
  const refSignalId = refSuffix?.split(':')[0] ?? null;
  const liveSignal = (liveDevice?.type === 'Robot' && refSignalId)
    ? (liveDevice.signals?.find(s => s.id === refSignalId) ?? null)
    : null;
  const liveConditionName = liveSignal?.name ?? null;
  const liveAxisCount = liveSignal?.number != null ? String(liveSignal.number) : null;

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

  // Subject line (big bold) — device name, live from store
  const subjectLine = liveDeviceName ?? deviceDisplayLabel ?? (isSensor ? (signalSource || displayName) : displayName);

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

          // Operation badge: mode + sensor polarity drives label + color
          const isOn = conditionType !== 'off';
          let opLabel, opColor;
          if (isVerify) {
            if (sensorInputType === 'range') { opLabel = 'Verify Range'; opColor = '#f59e0b'; }
            else { opLabel = isOn ? 'Verify On' : 'Verify Off'; opColor = isOn ? '#16a34a' : '#dc2626'; }
          } else if (isDecide) {
            opLabel = 'Decide'; opColor = '#7c3aed';
          } else if (isVisionJob) {
            opLabel = 'Vision'; opColor = '#0ea5e9';
          } else if (isSensor) {
            if (sensorInputType === 'range') { opLabel = 'Wait Range'; opColor = '#0ea5e9'; }
            else { opLabel = isOn ? 'Wait On' : 'Wait Off'; opColor = isOn ? '#16a34a' : '#dc2626'; }
          } else {
            // Signal-based waits (state / condition / position) — still binary,
            // respect conditionType so the label toggles with the op switcher.
            opLabel = isOn ? 'Wait On' : 'Wait Off';
            opColor = isOn ? '#16a34a' : '#dc2626';
          }

          // Auto-scale subject font (match StateNode scaling)
          const nameLen = (subjectLine ?? '').length;
          const badgeLen = (opLabel ?? '').length;
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
                  <span className="action-icon"><DeviceIcon type={iconType} size={14} /></span>
                )}
                <span
                  className="action-device"
                  style={{ fontSize: nameFontSize }}
                  title={subjectLine}
                >
                  {subjectLine}
                </span>
                <span
                  className={`action-op${canToggleOnOff ? ' action-op--clickable nodrag' : ''}`}
                  style={{
                    background: opColor,
                    color: '#fff',
                    borderColor: opColor,
                  }}
                  onClick={handleOpClick}
                  onMouseDown={canToggleOnOff ? (e) => e.stopPropagation() : undefined}
                  title={canToggleOnOff ? 'Click to toggle On / Off' : undefined}
                >{opLabel}</span>
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
        {/* Part Tracking badge */}
        {data.ptEnabled && data.ptFieldName && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, fontWeight: 700,
              background: 'rgba(0,0,0,0.3)', color: '#86efac',
              padding: '1px 6px', borderRadius: 8,
              letterSpacing: '0.03em',
            }}>
              📊 PT: {data.ptFieldName}
            </span>
          </div>
        )}
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
          pos={opSwitcher.pos}
          onClose={() => setOpSwitcher(null)}
        />
      )}

      {/* PT/Signal Badge — always visible when content exists */}
      <PtBadge nodeId={id} smId={smId} annotations={data.ptAnnotations ?? []} selected={selected} />

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
