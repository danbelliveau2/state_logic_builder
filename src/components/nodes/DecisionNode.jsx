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
  const [nodeMode, setNodeMode] = useState(data.nodeMode ?? 'wait');  // 'wait' | 'decide'

  // Condition config for sensor branching
  const [conditionType, setConditionType] = useState(data.conditionType ?? 'on');  // 'on' | 'off' | 'range'
  const [rangeMin, setRangeMin] = useState(data.rangeMin ?? '');
  const [rangeMax, setRangeMax] = useState(data.rangeMax ?? '');
  const [sensorRef, setSensorRef] = useState(data.sensorRef ?? null);
  const [sensorTag, setSensorTag] = useState(data.sensorTag ?? '');
  const [sensorInputType, setSensorInputType] = useState(data.sensorInputType ?? 'bool'); // 'bool' | 'range'

  // Retry counter config (only meaningful for 'wait' mode)
  const [retryEnabled, setRetryEnabled] = useState(data.retryEnabled ?? false);
  const [retryMax, setRetryMax] = useState(data.retryMax ?? 3);

  // After picking any signal/vision, show branch config step
  const [showBranchConfig, setShowBranchConfig] = useState(!!data.signalId);

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
    setExit1Label(`Pass_${jobName}`);
    setExit2Label(`Fail_${jobName}`);
    setExitCount(2);
    setNodeMode('wait');
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
    setExit1Label(`True_${name}`);
    setExit2Label(`False_${name}`);
    setExitCount(1);
    setNodeMode('wait');
    setConditions([newCond]);
    setShowBranchConfig(true);
  }

  // Part Tracking field picked -> show branch config (default to 'decide' — PT is already set, no waiting)
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
    setExit1Label(`Pass_${field.name}`);
    setExit2Label(`Fail_${field.name}`);
    setExitCount(2);
    setNodeMode('decide');
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
    setNodeMode('decide');
    setSensorRef(inp.ref);
    setSensorTag(inp.tag);
    setSensorInputType(inp.inputType ?? 'bool');
    if (inp.inputType === 'range') {
      setConditionType('range');
      setExit1Label(`InRange_${shortName}`);
      setExit2Label(`OutOfRange_${shortName}`);
    } else {
      setConditionType('on');
      setExit1Label(`On_${shortName}`);
      setExit2Label(`Off_${shortName}`);
    }
    setConditions([newCond]);
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
    if (cond.inputType === 'range') {
      exit1 = `InRange_${name}`;
      exit2 = `OutOfRange_${name}`;
    } else if (cond.signalType === 'sensor') {
      exit1 = `On_${name}`;
      exit2 = `Off_${name}`;
    } else if (cond.signalType === 'state' || cond.signalType === 'signal' || cond.signalType === 'condition') {
      exit1 = `True_${name}`;
      exit2 = `False_${name}`;
    } else {
      exit1 = `Pass_${name}`;
      exit2 = `Fail_${name}`;
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
      // Retry counter (wait mode only)
      retryEnabled: nodeMode === 'wait' ? retryEnabled : false,
      retryMax: nodeMode === 'wait' && retryEnabled ? Number(retryMax) || 3 : undefined,
      // Multi-condition
      conditions: conditions.length > 0 ? conditions : undefined,
      conditionLogic: conditions.length > 1 ? conditionLogic : undefined,
    };
    store.updateNodeData(smId, nodeId, updatedData);
    if (exitCount === 2) {
      store.addDecisionBranches(smId, nodeId, finalExit1Label, finalExit2Label);
    } else if (exitCount === 1) {
      store.addDecisionSingleBranch(smId, nodeId, finalExit1Label);
    }
    // Create retry branch if retry is enabled (only for wait mode with 2 exits)
    if (nodeMode === 'wait' && retryEnabled && exitCount === 2) {
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
  const popupContent = (
    <div
      ref={popupRef}
      className="nodrag nowheel"
      style={{
        ...style,
        width: 260,
        background: '#1a1f2e',
        border: '1px solid #374151',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontSize: 12,
        color: '#e5e7eb',
        maxHeight: 420,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 6px', borderBottom: '1px solid #374151', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {showBranchConfig
            ? (signalType === 'visionJob' ? `📷 ${signalName}` : signalType === 'partTracking' ? `📋 ${signalName}` : signalType === 'sensor' ? `🔌 ${signalName}` : `⚡ ${signalName}`)
            : editingConditionIdx !== null ? '✎ Change Condition'
            : addingCondition ? '+ Add Condition' : 'Wait On…'}
        </span>
        {showBranchConfig ? (
          <button
            className="nodrag"
            onClick={() => setShowBranchConfig(false)}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
          >{'\u2190'} Back</button>
        ) : editingConditionIdx !== null ? (
          <button
            className="nodrag"
            onClick={() => { setEditingConditionIdx(null); setShowBranchConfig(true); }}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
          >{'\u2190'} Cancel</button>
        ) : addingCondition ? (
          <button
            className="nodrag"
            onClick={() => { setAddingCondition(false); setShowBranchConfig(true); }}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
          >{'\u2190'} Cancel</button>
        ) : (
          <button
            className="nodrag"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
          >{'\u00d7'}</button>
        )}
      </div>

      {/* -- Signal picker (step 1) -- */}
      {!showBranchConfig && (
        <div ref={listRef} style={{ padding: '4px 0', overflowY: 'auto', flex: 1 }}>

          {/* VISION section */}
          {visionSignals.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', padding: '4px 10px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{'\uD83D\uDCF7'} Vision</div>
              {visionSignals.map(sig => (
                <button
                  key={sig.id}
                  className="nodrag"
                  onClick={() => handleVisionPick(sig)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: signalId === sig.id ? '#1e3a5f' : 'none',
                    border: 'none', borderLeft: signalId === sig.id ? '3px solid #f59e0b' : '3px solid transparent',
                    color: '#e5e7eb', cursor: 'pointer', padding: '5px 10px',
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
              <div style={{ fontSize: 9, fontWeight: 700, color: '#fbbf24', padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{'\u2B50'} Part Results (from upstream)</div>
              {ptFields.filter(f => f._visionLinked).map(field => {
                const isCurrentSm = field._visionSmId === smId;
                return (
                  <button
                    key={field.id}
                    className="nodrag"
                    onClick={() => handlePTPick(field)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      width: '100%', background: signalId === `pt_${field.id}` ? '#78350f33' : 'none',
                      border: 'none', borderLeft: signalId === `pt_${field.id}` ? '3px solid #fbbf24' : '3px solid transparent',
                      color: '#e5e7eb', cursor: 'pointer', padding: '5px 10px',
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
              <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{'📋'} Part Tracking</div>
              {ptFields.filter(f => !f._visionLinked).map(field => (
                <button
                  key={field.id}
                  className="nodrag"
                  onClick={() => handlePTPick(field)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', background: signalId === `pt_${field.id}` ? '#14532d33' : 'none',
                    border: 'none', borderLeft: signalId === `pt_${field.id}` ? '3px solid #86efac' : '3px solid transparent',
                    color: '#e5e7eb', cursor: 'pointer', padding: '5px 10px',
                    textAlign: 'left', fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1 }}>{field.name}</span>
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, color: '#86efac', background: '#14532d' }}>PT</span>
                </button>
              ))}
            </>
          )}

          {/* SENSORS & DEVICES section */}
          {sensorInputs.length > 0 && (() => {
            // Group by the 'group' field
            const grouped = {};
            for (const inp of sensorInputs) {
              const g = inp.group || 'Other';
              if (!grouped[g]) grouped[g] = [];
              grouped[g].push(inp);
            }
            return (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{'🔌'} Sensors & Devices</div>
                {Object.entries(grouped).map(([groupName, items]) => (
                  <div key={groupName}>
                    <div style={{ fontSize: 8, color: '#4b5563', padding: '3px 10px 1px 16px', fontWeight: 600 }}>{groupName}</div>
                    {items.map(inp => (
                      <button
                        key={inp.ref}
                        className="nodrag"
                        onClick={() => handleSensorPick(inp)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          width: '100%', background: signalId === `sensor_${inp.ref}` ? '#1e293b' : 'none',
                          border: 'none', borderLeft: signalId === `sensor_${inp.ref}` ? '3px solid #22d3ee' : '3px solid transparent',
                          color: '#e5e7eb', cursor: 'pointer', padding: '4px 10px 4px 20px',
                          textAlign: 'left', fontSize: 11,
                        }}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.label}</span>
                        <span style={{
                          fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                          color: inp.inputType === 'range' ? '#fbbf24' : '#22d3ee',
                          background: inp.inputType === 'range' ? '#78350f' : '#164e63',
                        }}>
                          {inp.inputType === 'range' ? 'RANGE' : 'BOOL'}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            );
          })()}

          {/* SIGNALS section (all user signals -- position, state, condition merged) */}
          {projectSignals.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{'\u26A1'} Signals</div>
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
                      color: '#e5e7eb', cursor: 'pointer', padding: '5px 10px',
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
      )}

      {/* -- Branch config (step 2) -- works for vision, signals, sensors */}
      {showBranchConfig && (() => {
        const isVision = signalType === 'visionJob';
        const isSensor = signalType === 'sensor';
        const isRange = sensorInputType === 'range';
        const singleLabel = isVision ? 'Pass' : 'True';
        const dualLabel1 = isVision ? 'Pass' : isSensor
          ? (isRange ? 'In Range' : (conditionType === 'off' ? 'Off' : 'On'))
          : 'True';
        const dualLabel2 = isVision ? 'Fail' : isSensor
          ? (isRange ? 'Out of Range' : (conditionType === 'off' ? 'On' : 'Off'))
          : 'False';
        return (
        <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>

          {/* Wait / Decide toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
            <button
              className="nodrag"
              onClick={() => setNodeMode('wait')}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: nodeMode === 'wait' ? '#0072B5' : '#111827',
                border: nodeMode === 'wait' ? '1px solid #3b82f6' : '1px solid #374151',
                color: nodeMode === 'wait' ? '#fff' : '#6b7280',
              }}
            >⏳ Wait</button>
            <button
              className="nodrag"
              onClick={() => setNodeMode('decide')}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: nodeMode === 'decide' ? '#7c3aed' : '#111827',
                border: nodeMode === 'decide' ? '1px solid #8b5cf6' : '1px solid #374151',
                color: nodeMode === 'decide' ? '#fff' : '#6b7280',
              }}
            >⚡ Decide</button>
          </div>
          <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 2, lineHeight: 1.4 }}>
            {nodeMode === 'wait'
              ? 'Step pauses until condition is TRUE, then advances.'
              : 'Step immediately checks current value and routes — no waiting.'}
          </div>

          {/* ── Retry counter (wait mode only) ─────────────── */}
          {nodeMode === 'wait' && (
            <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, padding: '6px 8px', marginBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label
                  className="nodrag"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}
                  onClick={() => setRetryEnabled(!retryEnabled)}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: retryEnabled ? '#f59e0b' : '#1a1f2e',
                    border: retryEnabled ? '1px solid #d97706' : '1px solid #374151',
                    fontSize: 10, color: '#000', fontWeight: 700,
                  }}>
                    {retryEnabled ? '\u2713' : ''}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: retryEnabled ? '#f59e0b' : '#6b7280' }}>
                    Retry Counter
                  </span>
                </label>
                {retryEnabled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 9, color: '#9ca3af' }}>Max:</span>
                    <input
                      className="nodrag"
                      type="number"
                      min={1}
                      max={99}
                      value={retryMax}
                      onChange={e => setRetryMax(e.target.value)}
                      style={{
                        width: 44, background: '#1a1f2e', border: '1px solid #374151',
                        color: '#e5e7eb', borderRadius: 4, padding: '2px 4px', fontSize: 11,
                        textAlign: 'center', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}
              </div>
              {retryEnabled && (
                <div style={{ fontSize: 8, color: '#6b7280', marginTop: 3, lineHeight: 1.3 }}>
                  If condition fails, retry up to {retryMax}x before taking the fail branch.
                </div>
              )}
            </div>
          )}

          {/* ── Sensor condition config (single condition only) ─── */}
          {isSensor && conditions.length <= 1 && (
            <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, padding: '6px 8px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#22d3ee', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Condition</div>

              {/* Boolean sensor: On / Off toggle */}
              {!isRange && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="nodrag"
                    onClick={() => {
                      setConditionType('on');
                      setExit1Label(`On_${signalName}`);
                      setExit2Label(`Off_${signalName}`);
                    }}
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                      background: conditionType === 'on' ? '#16a34a' : '#1a1f2e',
                      border: conditionType === 'on' ? '1px solid #22c55e' : '1px solid #374151',
                      color: conditionType === 'on' ? '#fff' : '#6b7280',
                    }}
                  >✓ Check ON</button>
                  <button
                    className="nodrag"
                    onClick={() => {
                      setConditionType('off');
                      setExit1Label(`Off_${signalName}`);
                      setExit2Label(`On_${signalName}`);
                    }}
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                      background: conditionType === 'off' ? '#dc2626' : '#1a1f2e',
                      border: conditionType === 'off' ? '1px solid #ef4444' : '1px solid #374151',
                      color: conditionType === 'off' ? '#fff' : '#6b7280',
                    }}
                  >✗ Check OFF</button>
                </div>
              )}

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
                            setExit1Label(`InRange_${signalName}_${spName}`);
                            setExit2Label(`OutOfRange_${signalName}_${spName}`);
                          }}
                          style={{
                            width: '100%', background: '#1a1f2e', border: '1px solid #374151',
                            color: '#e5e7eb', borderRadius: 4, padding: '5px 6px', fontSize: 11,
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

          {/* ── Multi-condition list ──────────────────────── */}
          {conditions.length > 0 && (
            <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, padding: '6px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Conditions{conditions.length > 1 ? ` (${conditions.length})` : ''}
                </span>
                {conditions.length > 1 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="nodrag" onClick={() => setConditionLogic('AND')}
                      style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                        background: conditionLogic === 'AND' ? '#16a34a' : '#1a1f2e',
                        border: conditionLogic === 'AND' ? '1px solid #22c55e' : '1px solid #374151',
                        color: conditionLogic === 'AND' ? '#fff' : '#6b7280' }}>AND</button>
                    <button className="nodrag" onClick={() => setConditionLogic('OR')}
                      style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                        background: conditionLogic === 'OR' ? '#2563eb' : '#1a1f2e',
                        border: conditionLogic === 'OR' ? '1px solid #3b82f6' : '1px solid #374151',
                        color: conditionLogic === 'OR' ? '#fff' : '#6b7280' }}>OR</button>
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
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0', borderTop: idx > 0 ? '1px solid #1f2937' : 'none' }}>
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
                      fontSize: 10, color: '#e5e7eb',
                      background: 'transparent', border: '1px solid transparent',
                      borderRadius: 3, padding: '2px 4px', cursor: 'pointer',
                      textAlign: 'left', overflow: 'hidden',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.borderColor = '#475569'; }}
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
              <button className="nodrag" onClick={() => { setAddingCondition(true); setShowBranchConfig(false); }}
                style={{ width: '100%', marginTop: 4, padding: '4px 0', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  background: '#1a1f2e', border: '1px dashed #374151', color: '#6b7280' }}>
                + Add Condition
              </button>
            </div>
          )}

          {/* 1 branch -- single exit */}
          <button
            className="nodrag"
            onClick={() => { setExitCount(1); setExit1Label(`${singleLabel}_${signalName}`); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: exitCount === 1 ? '#16a34a' : '#111827',
              border: exitCount === 1 ? '1px solid #22c55e' : '1px solid #374151',
              color: '#e5e7eb', fontSize: 11, textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>1</span>
            <span style={{ flex: 1 }}>Single exit — <b>{singleLabel}</b></span>
          </button>

          {/* 2 branches -- dual exit */}
          <button
            className="nodrag"
            onClick={() => { setExitCount(2); setExit1Label(`${dualLabel1}_${signalName}`); setExit2Label(`${dualLabel2}_${signalName}`); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: exitCount === 2 ? '#1574c4' : '#111827',
              border: exitCount === 2 ? '1px solid #3b82f6' : '1px solid #374151',
              color: '#e5e7eb', fontSize: 11, textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>2</span>
            <span style={{ flex: 1 }}>Branch <b>{dualLabel1} / {dualLabel2}</b></span>
          </button>

          {/* Custom labels (only when 2-branch selected) */}
          {exitCount === 2 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 2 }}>Left exit</div>
                <input
                  className="nodrag"
                  value={exit1Label}
                  onChange={e => setExit1Label(e.target.value)}
                  style={{
                    width: '100%', background: '#111827', border: '1px solid #374151',
                    color: '#e5e7eb', borderRadius: 4, padding: '3px 6px', fontSize: 11,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 2 }}>Right exit</div>
                <input
                  className="nodrag"
                  value={exit2Label}
                  onChange={e => setExit2Label(e.target.value)}
                  style={{
                    width: '100%', background: '#111827', border: '1px solid #374151',
                    color: '#e5e7eb', borderRadius: 4, padding: '3px 6px', fontSize: 11,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {/* Done button */}
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDone(); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 700,
              background: '#1574c4', color: '#fff', border: 'none', borderRadius: 5,
              cursor: 'pointer', letterSpacing: '0.03em', marginTop: 4,
            }}
          >Done</button>
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
  const fillColor   = isVision ? '#E8A317' : isPT ? '#7c3aed' : '#0072B5';
  const borderColor = isVision ? '#b87d0f' : isPT ? '#6d28d9' : '#005a91';
  const textColor   = '#ffffff';
  const mutedColor  = 'rgba(255,255,255,0.75)';

  // Derived mode flags used in render below
  const isSensor = signalType === 'sensor' || !!sensorRef;
  const isDecide = nodeMode === 'decide' || exitCount === 2;

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
      sourceLabel = conditionType === 'off' ? 'Check: OFF' : 'Check: ON';
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
        // Same shape as StateNode
        width: NODE_WIDTH,
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
        <span style={{ fontSize: 10, color: mutedColor, marginBottom: 2 }}>
          {isSensor ? (isDecide ? '🔌 Branch:' : '🔌 Wait:') : isDecide ? 'Decide:' : 'Wait on:'}
        </span>
        {/* Line 2: signal name */}
        <span style={{
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}>
          {displayName}
        </span>
        {/* Line 3: source name (only if different from signal name) */}
        {sourceLabel && (
          <span style={{ fontSize: 10, color: mutedColor, lineHeight: 1.2, marginTop: 2 }}>
            {sourceLabel}
          </span>
        )}
        {/* Retry badge */}
        {retryEnabled && nodeMode === 'wait' && (
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

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        style={{ left: '50%', background: '#64748b', width: 10, height: 10, border: '2px solid #fff' }}
      />

      {/* Bottom handle for single-exit or unconfigured nodes */}
      {(exitCount === 1 || !signalName || signalName === 'Select Signal...') && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="exit-single"
          style={{ left: '50%', background: '#64748b', width: 10, height: 10, border: '2px solid #fff' }}
        />
      )}

      {/* Side handles for 2-exit branching */}
      {exitCount === 2 && signalName && signalName !== 'Select Signal...' && (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="exit-pass"
            style={{ top: '50%', background: '#5a9a48', width: 10, height: 10, border: '2px solid #fff' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="exit-fail"
            style={{ top: '50%', background: '#ef4444', width: 10, height: 10, border: '2px solid #fff' }}
          />
        </>
      )}

      {/* Bottom handle for retry branch (only when retry is enabled + 2-exit) */}
      {retryEnabled && exitCount === 2 && signalName && signalName !== 'Select Signal...' && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="exit-retry"
          style={{ left: '50%', background: '#f59e0b', width: 10, height: 10, border: '2px solid #fff' }}
          isConnectable
        />
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
