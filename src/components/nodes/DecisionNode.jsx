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

function DecisionEditPopup({ nodeId, smId, data, onClose, style }) {
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
  const [exitCount, setExitCount] = useState(data.exitCount ?? 2);
  const [exit1Label, setExit1Label] = useState(data.exit1Label ?? 'Pass');
  const [exit2Label, setExit2Label] = useState(data.exit2Label ?? 'Fail');
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
    setExitCount(2);
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
    setExit1Label('True');
    setExit2Label('False');
    setExitCount(1);
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
    setExit1Label('Pass');
    setExit2Label('Fail');
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
    setExitCount(2);
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
    // Verify mode: sensor uses On/Off (matching what's being verified),
    // non-sensor uses Pass/Fail.
    if (nodeMode === 'verify') {
      if (cond.inputType === 'range') {
        exit1 = 'InRange';
        exit2 = 'OutOfRange';
      } else if (cond.signalType === 'sensor') {
        exit1 = conditionType === 'off' ? 'Off' : 'On';
        exit2 = conditionType === 'off' ? 'On' : 'Off';
      } else {
        exit1 = 'Pass';
        exit2 = 'Fail';
      }
    } else if (cond.inputType === 'range') {
      exit1 = 'InRange';
      exit2 = 'OutOfRange';
    } else if (cond.signalType === 'sensor') {
      exit1 = 'On';
      exit2 = 'Off';
    } else if (cond.signalType === 'state' || cond.signalType === 'signal' || cond.signalType === 'condition') {
      exit1 = 'True';
      exit2 = 'False';
    } else {
      exit1 = 'Pass';
      exit2 = 'Fail';
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
    const finalExit1Label = primary ? primary.exit1 : exit1Label;
    const finalExit2Label = primary ? primary.exit2 : exit2Label;

    const updatedData = {
      signalId,
      signalName: finalSignalName,
      signalSource: finalSignalSource,
      signalSmName,
      signalType: finalSignalType,
      decisionType,
      exitCount,
      exit1Label: finalExit1Label,
      exit2Label: finalExit2Label,
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
    if (exitCount > 2) {
      updatedData.outcomeLabels = outcomeLabels.slice(0, exitCount);
    }
    store.updateNodeData(smId, nodeId, updatedData);
    if (exitCount > 2) {
      store.addDecisionMultiBranch(smId, nodeId, outcomeLabels.slice(0, exitCount));
    } else if (exitCount === 2) {
      store.addDecisionBranches(smId, nodeId, finalExit1Label, finalExit2Label);
    } else if (exitCount === 1) {
      store.addDecisionSingleBranch(smId, nodeId, finalExit1Label);
    }
    // Create retry branch if retry is enabled (any mode with 2 exits)
    if (retryEnabled && exitCount === 2) {
      store.addDecisionRetryBranch(smId, nodeId);
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
                        // Decide always branches — force exitCount to 2 if currently 1
                        if (m.key === 'decide' && exitCount === 1) setExitCount(2);
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
        const isVision = signalType === 'visionJob';
        const isSensor = signalType === 'sensor';
        const isVerify = nodeMode === 'verify';
        const isRange = sensorInputType === 'range';
        // For verify-sensor: labels reflect the actual ON/OFF condition.
        // Green (pass) = what you're verifying; Red (fail) = the opposite.
        // For verify-vision or verify-signal: generic Pass/Fail.
        const singleLabel = isVerify
          ? (isSensor && !isRange ? (conditionType === 'off' ? 'Off' : 'On') : 'Pass')
          : isVision ? 'Pass' : 'True';
        const dualLabel1 = isVerify
          ? (isSensor ? (isRange ? 'In Range' : (conditionType === 'off' ? 'Off' : 'On')) : 'Pass')
          : isVision ? 'Pass'
          : isSensor ? (isRange ? 'In Range' : (conditionType === 'off' ? 'Off' : 'On'))
          : 'True';
        const dualLabel2 = isVerify
          ? (isSensor ? (isRange ? 'Out of Range' : (conditionType === 'off' ? 'On' : 'Off')) : 'Fail')
          : isVision ? 'Fail'
          : isSensor ? (isRange ? 'Out of Range' : (conditionType === 'off' ? 'On' : 'Off'))
          : 'False';
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
                {/* Pass/Fail values */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: '#16a34a', fontWeight: 700, marginBottom: 1 }}>✓ Pass writes</div>
                    <select className="nodrag" value={ptPassValue} onChange={e => setPtPassValue(e.target.value)}
                      style={{ width: '100%', fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db', background: '#fff', color: '#1e293b', cursor: 'pointer' }}>
                      <option value="SUCCESS">SUCCESS</option>
                      <option value="FAILURE">FAILURE</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700, marginBottom: 1 }}>✗ Fail writes</div>
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
              onClick={() => { setExitCount(1); setExit1Label(singleLabel); }}
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

          {/* 2 branches -- dual exit */}
          <button
            className="nodrag"
            onClick={() => { setExitCount(2); setExit1Label(dualLabel1); setExit2Label(dualLabel2); }}
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
                  onChange={e => setExit1Label(e.target.value)}
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
                  onChange={e => setExit2Label(e.target.value)}
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
    exit1Label = 'Pass',
    exit2Label = 'Fail',
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
  const isDecide = !isVerify && (nodeMode === 'decide' || exitCount === 2);

  // Display text
  const isVisionJob = signalType === 'visionJob';
  const displayName = isVisionJob
    ? (signalSource ?? signalSmName ?? signalName ?? 'Select Signal...')
    : (signalName ?? signalSource ?? 'Select Signal...');

  // Multi-condition data
  const multiConditions = data.conditions ?? [];
  const multiLogic = data.conditionLogic ?? 'AND';

  // Dynamically resolve state signal step numbers from the referenced SM
  const allSMs = useDiagramStore(s => s.project?.stateMachines ?? []);
  const projectSignals = useDiagramStore(s => s.project?.signals ?? []);
  const resolvedSourceLabel = useMemo(() => {
    // Find the signal this node references
    const sigId = data.signalId;
    if (!sigId) return null;
    const sig = projectSignals.find(s => s.id === sigId);
    if (!sig || sig.type !== 'state' || !sig.stateNodeId || !sig.smId) return null;
    // Find the referenced SM and compute current step numbers
    const refSm = allSMs.find(sm => sm.id === sig.smId);
    if (!refSm) return null;
    const { stateMap } = computeStateNumbers(refSm.nodes ?? [], refSm.edges ?? [], refSm.devices ?? []);
    const stepNum = stateMap.get(sig.stateNodeId) ?? '?';
    const refNode = (refSm.nodes ?? []).find(n => n.id === sig.stateNodeId);
    // Build a clean state label
    let stateName = sig.stateName ?? 'State';
    // Strip any old [N] prefix from legacy stored names
    stateName = stateName.replace(/^\[\d+\]\s*[✓⌂⏳]?\s*/, '');
    if (refNode) {
      if (refNode.data?.isComplete) stateName = 'Cycle Complete';
      else if (refNode.data?.isInitial) stateName = 'Home / Initial';
      else if (refNode.type === 'decisionNode') {
        const src = refNode.data?.signalSource ?? refNode.data?.signalName ?? 'Decision';
        stateName = `Wait: ${src}`;
      } else if (refNode.data?.label) stateName = refNode.data.label;
    }
    const smName = refSm.displayName ?? refSm.name ?? '';
    return `${smName} \u2192 [${stepNum}] ${stateName}`;
  }, [data.signalId, projectSignals, allSMs]);

  // Build subtitle: for sensors show condition info, for vision show job name, else source
  let sourceLabel;
  if (multiConditions.length > 1) {
    sourceLabel = `${multiConditions.length} conditions (${multiLogic})`;
  } else if (isSensor) {
    if (sensorInputType === 'range') {
      const minStr = rangeMin !== undefined && rangeMin !== '' ? rangeMin : '?';
      const maxStr = rangeMax !== undefined && rangeMax !== '' ? rangeMax : '?';
      sourceLabel = `Range: ${minStr} – ${maxStr}`;
    } else {
      // Wait = "On" / "Off"; Decide = "Check: On/Off"; Verify = "Verify: On/Off"
      const state = conditionType === 'off' ? 'OFF' : 'ON';
      sourceLabel = isVerify ? `Verify: ${state}`
                  : isDecide ? `Check: ${state}`
                  : state;
    }
  } else if (isVisionJob) {
    sourceLabel = signalName && signalName !== displayName ? signalName : null;
  } else {
    // Use dynamically resolved label for state signals, fall back to stored value
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

      {/* Content -- centered text; click here to open popup (not the border) */}
      <div
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        style={{
          padding: '10px 20px 10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          color: textColor,
          lineHeight: 1.3,
          minHeight: 64,
          pointerEvents: 'auto',
        }}
      >
        {/* Line 1: mode label */}
        <span style={{ fontSize: 10, color: mutedColor, marginBottom: 2, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {!isVerify && isSensor && <DeviceIcon type={sensorInputType === 'range' ? 'AnalogSensor' : 'DigitalSensor'} size={12} color="rgba(255,255,255,0.75)" />}
          {!isVerify && isVisionJob && <DeviceIcon type="VisionSystem" size={12} color="rgba(255,255,255,0.75)" />}
          {isVerify ? 'Verify' : isDecide ? (isSensor ? 'Branch:' : 'Decide:') : (isSensor ? 'Wait:' : 'Wait on:')}
        </span>
        {/* Line 2: signal name — wraps to 2 lines if long */}
        <span
          title={displayName}
          style={{
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.2,
            maxWidth: '100%',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {displayName}
        </span>
        {/* Line 3: source label — verify mode gets bold colored ON/OFF pill (decide doesn't — both paths are equal) */}
        {sourceLabel && isVerify && isSensor && sensorInputType !== 'range' ? (
          <span style={{
            display: 'inline-block',
            fontSize: 10, fontWeight: 800, letterSpacing: '.5px',
            padding: '2px 10px',
            borderRadius: 8,
            color: '#fff',
            background: conditionType === 'off' ? '#dc2626' : '#16a34a',
            marginTop: 3,
            textShadow: '0 1px 1px rgba(0,0,0,0.3)',
          }}>Verify {conditionType === 'off' ? 'Off' : 'On'}</span>
        ) : sourceLabel ? (
          <span style={{ fontSize: 10, color: mutedColor, lineHeight: 1.2, marginTop: 2 }}>
            {sourceLabel}
          </span>
        ) : null}
        {/* Retry badge — shows in any mode when retry is enabled */}
        {retryEnabled && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 9, fontWeight: 700,
            background: 'rgba(0,0,0,0.3)', color: '#fbbf24',
            padding: '1px 6px', borderRadius: 8, marginTop: 3,
            letterSpacing: '0.03em',
          }}>
            {'\u21BB'} Retry x{retryMax}
          </span>
        )}
        {/* Part Tracking badge */}
        {data.ptEnabled && data.ptFieldName && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 9, fontWeight: 700,
            background: 'rgba(0,0,0,0.3)', color: '#86efac',
            padding: '1px 6px', borderRadius: 8, marginTop: 3,
            letterSpacing: '0.03em',
          }}>
            📊 PT: {data.ptFieldName}
          </span>
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
