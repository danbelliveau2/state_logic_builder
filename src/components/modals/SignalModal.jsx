/**
 * SignalModal - Create/Edit a Signal.
 * Replaces ReferencePositionModal + SmOutputModal with a unified interface.
 *
 * Signal types:
 *   'position' - servo reference position (was ReferencePosition)
 *   'state'    - SM output: TRUE while SM is in a specific state
 *   'condition'- custom condition (future)
 *
 * Latch model (v1.24.17+):
 *   The top-level signal fields (axes / smId+stateNodeId+reachedMode / conditions)
 *   are ALWAYS the ON condition — the expression that fires OTE (pure computed) or
 *   OTL (when an OFF condition is also defined).
 *
 *   `offCondition` (optional, null by default) is a mirrored block of the same
 *   type-specific shape. When present, the signal behaves as a SET/RESET latch:
 *   OTL on ON-fire, OTU on OFF-fire. When null, the signal is a pure OTE.
 *
 *   Rationale: most signals (servo position, sensor ready, etc.) are naturally
 *   transient and don't need an explicit OFF. Sequence flags like `Part_Gripped`
 *   that must persist across many states need an SR-latch — opt-in, not default.
 */

import { useState, useMemo, useEffect } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { computeStateNumbers } from '../../lib/computeStateNumbers.js';

// ── Auto Part Tracking signal generator (same logic as DecisionNode) ──────────
function getAutoPTSignals(allSMs) {
  const result = [];
  for (const sm of allSMs) {
    const devices = sm.devices ?? [];
    for (const device of devices) {
      if (device.type === 'VisionSystem' || device._autoVision === true) {
        const deviceName = device.displayName ?? device.name ?? 'Vision';
        result.push({
          id: `pt_${sm.id}_${device.id}_pass`,
          name: `${deviceName}_Pass`,
          type: 'partTracking',
          smName: sm.displayName ?? sm.name,
          auto: true,
        });
        result.push({
          id: `pt_${sm.id}_${device.id}_fail`,
          name: `${deviceName}_Fail`,
          type: 'partTracking',
          smName: sm.displayName ?? sm.name,
          auto: true,
        });
      }
    }
  }
  return result;
}

// Tiny ID generator
let _id = Date.now();
const uid = () => `id_${(_id++).toString(36)}`;

export function SignalModal({ isOpen, onClose, signal }) {
  const store = useDiagramStore();
  const allSMs = store.project?.stateMachines ?? [];

  const [name, setName] = useState(signal?.name ?? '');
  const [description, setDescription] = useState(signal?.description ?? '');
  const [type, setType] = useState(signal?.type ?? 'position');

  // ── ON condition state (top-level fields on the signal) ────────────────────
  const [axes, setAxes] = useState(signal?.axes ?? []);
  const [smId, setSmId] = useState(signal?.smId ?? (allSMs[0]?.id ?? ''));
  const [stateNodeId, setStateNodeId] = useState(signal?.stateNodeId ?? '');
  const [reachedMode, setReachedMode] = useState(signal?.reachedMode ?? 'reached');
  const [conditions, setConditions] = useState(signal?.conditions ?? []);

  // ── OFF condition state (optional, mirrors ON block by type) ───────────────
  const [hasOff, setHasOff] = useState(!!signal?.offCondition);
  const [offAxes, setOffAxes] = useState(signal?.offCondition?.axes ?? []);
  const [offSmId, setOffSmId] = useState(signal?.offCondition?.smId ?? (allSMs[0]?.id ?? ''));
  const [offStateNodeId, setOffStateNodeId] = useState(signal?.offCondition?.stateNodeId ?? '');
  const [offReachedMode, setOffReachedMode] = useState(signal?.offCondition?.reachedMode ?? 'reached');
  const [offConditions, setOffConditions] = useState(signal?.offCondition?.conditions ?? []);

  // Re-sync all form state when signal prop changes (new vs edit)
  useEffect(() => {
    setName(signal?.name ?? '');
    setDescription(signal?.description ?? '');
    setType(signal?.type ?? 'position');
    setAxes(signal?.axes ?? []);
    setSmId(signal?.smId ?? (allSMs[0]?.id ?? ''));
    setStateNodeId(signal?.stateNodeId ?? '');
    setReachedMode(signal?.reachedMode ?? 'reached');
    setConditions(signal?.conditions ?? []);
    setHasOff(!!signal?.offCondition);
    setOffAxes(signal?.offCondition?.axes ?? []);
    setOffSmId(signal?.offCondition?.smId ?? (allSMs[0]?.id ?? ''));
    setOffStateNodeId(signal?.offCondition?.stateNodeId ?? '');
    setOffReachedMode(signal?.offCondition?.reachedMode ?? 'reached');
    setOffConditions(signal?.offCondition?.conditions ?? []);
  }, [signal, isOpen]);

  // Auto PT signals + project signals for condition picker
  const autoPTSignals = getAutoPTSignals(allSMs);
  // Deduplicate by id (signals from auto-PT may overlap with project signals)
  const seenIds = new Set();
  const combinedSignals = [];
  for (const s of [...autoPTSignals, ...(store.project?.signals ?? [])]) {
    if (!seenIds.has(s.id)) { seenIds.add(s.id); combinedSignals.push(s); }
  }

  // ── Helpers for state type (hooks must be before early return) ────────────
  const selectedSm = allSMs.find(s => s.id === smId);
  const selectedOffSm = allSMs.find(s => s.id === offSmId);
  const smNodes = selectedSm?.nodes ?? [];
  const offSmNodes = selectedOffSm?.nodes ?? [];

  // Compute correct sequential state numbers using shared utility
  const stateNumberMap = useMemo(() => {
    if (!selectedSm) return new Map();
    return computeStateNumbers(selectedSm.nodes ?? [], selectedSm.edges ?? [], selectedSm.devices ?? []).stateMap;
  }, [selectedSm]);
  const offStateNumberMap = useMemo(() => {
    if (!selectedOffSm) return new Map();
    return computeStateNumbers(selectedOffSm.nodes ?? [], selectedOffSm.edges ?? [], selectedOffSm.devices ?? []).stateMap;
  }, [selectedOffSm]);

  if (!isOpen) return null;

  // ── Helpers for position type ──────────────────────────────────────────────

  function getServosForSm(targetSmId) {
    const sm = allSMs.find(s => s.id === targetSmId);
    return (sm?.devices ?? []).filter(d => d.type === 'ServoAxis');
  }

  function getPositionsForServo(targetSmId, axisDeviceId) {
    const sm = allSMs.find(s => s.id === targetSmId);
    const dev = (sm?.devices ?? []).find(d => d.id === axisDeviceId);
    return (dev?.positions ?? []).filter(p => !p.type || p.type === 'position');
  }

  // Generic axis-list helpers that work for both ON and OFF sides
  function addAxisFor(setter) {
    const firstSm = allSMs[0];
    const firstServo = firstSm ? getServosForSm(firstSm.id)[0] : null;
    const firstPos = firstServo ? getPositionsForServo(firstSm?.id, firstServo.id)[0] : null;
    setter(prev => [...prev, {
      id: uid(),
      smId: firstSm?.id ?? '',
      deviceId: firstServo?.id ?? '',
      deviceName: firstServo?.displayName ?? '',
      positionName: firstPos?.name ?? '',
      tolerance: 1,
    }]);
  }
  function removeAxisFor(setter, axisId) {
    setter(prev => prev.filter(a => a.id !== axisId));
  }
  function updateAxisFor(setter, axisId, updates) {
    setter(prev => prev.map(a => a.id === axisId ? { ...a, ...updates } : a));
  }

  // Generic condition-row helpers for both ON and OFF sides
  function addConditionRowFor(setter) {
    setter(prev => [...prev, { id: uid(), signalId: '', signalName: '', signalType: '' }]);
  }
  function removeConditionRowFor(setter, rowId) {
    setter(prev => prev.filter(c => c.id !== rowId));
  }
  function updateConditionRowFor(setter, rowId, signalId) {
    const sig = combinedSignals.find(s => s.id === signalId);
    setter(prev => prev.map(c =>
      c.id === rowId
        ? { ...c, signalId, signalName: sig?.name ?? '', signalType: sig?.type ?? '' }
        : c
    ));
  }

  function nodeLabelFor(node, numberMap) {
    const stepNum = numberMap.get(node.id) ?? node.data?.stepNumber ?? node.data?.stateNumber ?? '?';
    if (node.data?.isComplete) return `[${stepNum}] ✓ Cycle Complete`;
    if (node.data?.isInitial)  return `[${stepNum}] ⌂ Home / Initial`;
    if (node.type === 'decisionNode') {
      const src = node.data?.signalSource ?? node.data?.signalName ?? 'Decision';
      return `[${stepNum}] ⏳ Wait: ${src}`;
    }
    const actions = node.data?.actions ?? [];
    const devices = selectedSm?.devices ?? [];
    if (actions.length > 0) {
      const parts = actions.slice(0, 3).map(a => {
        const dev = devices.find(d => d.id === a.deviceId);
        const devName = dev?.displayName ?? dev?.name ?? '?';
        const pos = a.positionName ? ` (${a.positionName})` : '';
        return `${devName} → ${a.operation ?? ''}${pos}`.trim();
      });
      const suffix = actions.length > 3 ? ` +${actions.length - 3}` : '';
      return `[${stepNum}]  ${parts.join('  |  ')}${suffix}`;
    }
    if (node.data?.label) return `[${stepNum}] ${node.data.label}`;
    return `[${stepNum}] (empty)`;
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  function handleSave() {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!cleanName) return;

    let data = { name: cleanName, description: description.trim(), type };

    if (type === 'position') {
      data.axes = axes;
    } else if (type === 'state') {
      const selectedStateNode = smNodes.find(n => n.id === stateNodeId);
      let stateName = cleanName;
      if (selectedStateNode) {
        if (selectedStateNode.data?.isComplete) stateName = 'Cycle Complete';
        else if (selectedStateNode.data?.isInitial) stateName = 'Home / Initial';
        else if (selectedStateNode.type === 'decisionNode') {
          const src = selectedStateNode.data?.signalSource ?? selectedStateNode.data?.signalName ?? 'Decision';
          stateName = `Wait: ${src}`;
        } else if (selectedStateNode.data?.label) stateName = selectedStateNode.data.label;
        else stateName = cleanName;
      }
      const selectedSmObj = allSMs.find(s => s.id === smId);
      data.smId = smId;
      data.smName = selectedSmObj?.displayName ?? selectedSmObj?.name ?? '';
      data.stateNodeId = stateNodeId || null;
      data.stateName = stateName;
      data.reachedMode = reachedMode;
    } else if (type === 'condition') {
      data.conditions = conditions.filter(c => c.signalId);
    }

    // ── OFF condition block (optional, mirrors the ON type) ────────────────
    if (hasOff) {
      if (type === 'position') {
        data.offCondition = { axes: offAxes };
      } else if (type === 'state') {
        const offNode = offSmNodes.find(n => n.id === offStateNodeId);
        let offStateName = '';
        if (offNode) {
          if (offNode.data?.isComplete) offStateName = 'Cycle Complete';
          else if (offNode.data?.isInitial) offStateName = 'Home / Initial';
          else if (offNode.type === 'decisionNode') {
            const src = offNode.data?.signalSource ?? offNode.data?.signalName ?? 'Decision';
            offStateName = `Wait: ${src}`;
          } else offStateName = offNode.data?.label ?? '';
        }
        const offSmObj = allSMs.find(s => s.id === offSmId);
        data.offCondition = {
          smId: offSmId,
          smName: offSmObj?.displayName ?? offSmObj?.name ?? '',
          stateNodeId: offStateNodeId || null,
          stateName: offStateName,
          reachedMode: offReachedMode,
        };
      } else if (type === 'condition') {
        data.offCondition = { conditions: offConditions.filter(c => c.signalId) };
      }
    } else {
      data.offCondition = null;
    }

    if (signal) {
      store.updateSignal(signal.id, data);
    } else {
      store.addSignal(data);
    }
    onClose();
  }

  const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '');

  // ── Axis row renderer, reused for ON and OFF position blocks ───────────────
  function renderAxisRow(axis, setter) {
    const servos = getServosForSm(axis.smId);
    const positions = getPositionsForServo(axis.smId, axis.deviceId);
    return (
      <div key={axis.id} style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px 28px',
        gap: 6, alignItems: 'center', marginBottom: 6,
        padding: '6px 8px', background: '#f9fafb', borderRadius: 4,
        border: '1px solid #e5e7eb',
      }}>
        <select
          className="form-input"
          style={{ fontSize: 11, padding: '3px 4px' }}
          value={axis.smId}
          onChange={e => {
            const newSmId = e.target.value;
            const firstServo = getServosForSm(newSmId)[0];
            const firstPos = firstServo ? getPositionsForServo(newSmId, firstServo.id)[0] : null;
            updateAxisFor(setter, axis.id, {
              smId: newSmId,
              deviceId: firstServo?.id ?? '',
              deviceName: firstServo?.displayName ?? '',
              positionName: firstPos?.name ?? '',
            });
          }}
        >
          <option value="">-- SM --</option>
          {allSMs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select
          className="form-input"
          style={{ fontSize: 11, padding: '3px 4px' }}
          value={axis.deviceId}
          onChange={e => {
            const newDevId = e.target.value;
            const servo = getServosForSm(axis.smId).find(d => d.id === newDevId);
            const firstPos = servo ? getPositionsForServo(axis.smId, newDevId)[0] : null;
            updateAxisFor(setter, axis.id, {
              deviceId: newDevId,
              deviceName: servo?.displayName ?? '',
              positionName: firstPos?.name ?? '',
            });
          }}
        >
          <option value="">-- Servo --</option>
          {servos.map(d => <option key={d.id} value={d.id}>{d.displayName}</option>)}
        </select>

        <select
          className="form-input"
          style={{ fontSize: 11, padding: '3px 4px' }}
          value={axis.positionName}
          onChange={e => updateAxisFor(setter, axis.id, { positionName: e.target.value })}
        >
          <option value="">-- Position --</option>
          {positions.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>

        <input
          type="number"
          className="form-input"
          style={{ fontSize: 11, padding: '3px 4px' }}
          value={axis.tolerance}
          min="0"
          step="0.1"
          onChange={e => updateAxisFor(setter, axis.id, { tolerance: Number(e.target.value) })}
          title="Tolerance (mm)"
        />

        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          onClick={() => removeAxisFor(setter, axis.id)}
          title="Remove axis"
        >✕</button>
      </div>
    );
  }

  // ── Condition row renderer, reused for ON and OFF condition blocks ─────────
  function renderConditionRow(row, idx, setter) {
    const ptSigs = combinedSignals.filter(s => s.type === 'partTracking');
    const posSigs = combinedSignals.filter(s => s.type === 'position');
    const stateSigs = combinedSignals.filter(s => s.type === 'state');
    return (
      <div key={row.id} style={{
        display: 'flex', gap: 6, alignItems: 'center',
        marginBottom: 6, padding: '4px 0',
        borderBottom: '1px solid #e5e7eb',
      }}>
        {idx > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#0072B5', minWidth: 28, textAlign: 'center' }}>AND</span>
        )}
        {idx === 0 && (
          <span style={{ fontSize: 10, color: '#6b7280', minWidth: 28, textAlign: 'center' }}>IF</span>
        )}
        <select
          className="form-input"
          style={{ flex: 1, fontSize: 11, padding: '3px 4px' }}
          value={row.signalId}
          onChange={e => updateConditionRowFor(setter, row.id, e.target.value)}
        >
          <option value="">-- Select Signal --</option>
          {ptSigs.length > 0 && (
            <optgroup label="Part Tracking">
              {ptSigs.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.smName ? ` (${s.smName})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {posSigs.length > 0 && (
            <optgroup label="Position Signals">
              {posSigs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
          {stateSigs.length > 0 && (
            <optgroup label="State Signals">
              {stateSigs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
        </select>
        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          onClick={() => removeConditionRowFor(setter, row.id)}
          title="Remove condition"
        >✕</button>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <h2 className="modal__title">{signal ? 'Edit Signal' : 'New Signal'}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body" style={{ flex: 1, overflowY: 'auto' }}>

          {/* Name */}
          <div className="form-group">
            <label className="form-label">Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="SignalName"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              className="form-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          {/* Type */}
          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-input"
              value={type}
              onChange={e => setType(e.target.value)}
            >
              <option value="position">Servo Position</option>
              <option value="state">SM State</option>
              <option value="condition">Custom Condition</option>
            </select>
          </div>

          {/* ── ON condition heading (only shown when OFF is also active) ─── */}
          {hasOff && (
            <div style={{
              marginTop: 8, marginBottom: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              color: '#16a34a', textTransform: 'uppercase',
            }}>
              <span style={{ fontSize: 13, verticalAlign: 'middle' }}>●</span> Turn ON when
            </div>
          )}

          {/* ── Position type fields (ON side) ─────────────────────────────── */}
          {type === 'position' && (
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>Servo Axes</label>
                <button className="btn btn--xs btn--ghost" onClick={() => addAxisFor(setAxes)}>+ Add Axis</button>
              </div>
              {axes.length === 0 && (
                <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0', fontStyle: 'italic' }}>
                  No axes defined. Click "+ Add Axis" to add servo axes to this signal.
                </div>
              )}
              {axes.map(axis => renderAxisRow(axis, setAxes))}
              {axes.length > 0 && (
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                  Columns: SM · Servo · Position · Tolerance (mm)
                </div>
              )}
            </div>
          )}

          {/* ── State type fields (ON side) ────────────────────────────────── */}
          {type === 'state' && (
            <>
              <div className="form-group">
                <label className="form-label">State Machine</label>
                <select
                  className="form-input"
                  value={smId}
                  onChange={e => { setSmId(e.target.value); setStateNodeId(''); }}
                >
                  <option value="">-- Select SM --</option>
                  {allSMs.map(s => <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">State</label>
                <select
                  className="form-input"
                  value={stateNodeId}
                  onChange={e => setStateNodeId(e.target.value)}
                >
                  <option value="">-- Select state --</option>
                  {smNodes.map(n => (
                    <option key={n.id} value={n.id}>{nodeLabelFor(n, stateNumberMap)}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Trigger mode</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="reachedMode" value="in" checked={reachedMode === 'in'} onChange={() => setReachedMode('in')} />
                    <span><b>Is in state</b> — TRUE only while SM is executing this step</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="reachedMode" value="completed" checked={reachedMode === 'completed'} onChange={() => setReachedMode('completed')} />
                    <span><b>Has completed state</b> — TRUE once SM has finished and moved past this step</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="reachedMode" value="reached" checked={reachedMode === 'reached'} onChange={() => setReachedMode('reached')} />
                    <span><b>Has reached state</b> — TRUE at or past this step (includes current)</span>
                  </label>
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, padding: '4px 8px', background: '#f9fafb', borderRadius: 4 }}>
                  {reachedMode === 'in'        && 'SM.Step == N'}
                  {reachedMode === 'completed' && 'SM.Step > N  (advanced past this state)'}
                  {reachedMode === 'reached'   && 'SM.Step \u2265 N  (at or past this state)'}
                </div>
              </div>
            </>
          )}

          {/* ── Condition type (ON side) ───────────────────────────────────── */}
          {type === 'condition' && (
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>Conditions (all must be true)</label>
                <button className="btn btn--xs btn--ghost" onClick={() => addConditionRowFor(setConditions)}>+ Add Condition</button>
              </div>
              {conditions.length === 0 && (
                <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0', fontStyle: 'italic' }}>
                  No conditions yet. Click "+ Add Condition".
                </div>
              )}
              {conditions.map((row, idx) => renderConditionRow(row, idx, setConditions))}
              {conditions.filter(c => c.signalId).length > 0 && (
                <div style={{
                  marginTop: 8, padding: '6px 10px',
                  background: '#1e2937', borderRadius: 4,
                  fontSize: 10, color: '#9ca3af',
                  fontFamily: 'Consolas, monospace',
                }}>
                  TRUE when:{' '}
                  <span style={{ color: '#86efac' }}>
                    {conditions.filter(c => c.signalName).map(c => c.signalName).join(' AND ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Latch checkbox: opt into an OFF condition ─────────────────── */}
          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: hasOff ? '#fff7ed' : '#f9fafb',
            border: `1px solid ${hasOff ? '#fdba74' : '#e5e7eb'}`,
            borderRadius: 6,
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={hasOff}
                onChange={e => setHasOff(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Also define an OFF condition</span>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  Signal latches ON when the top condition fires, and OFF when the one below fires.
                  Leave unchecked for a pure computed signal (default).
                </div>
              </span>
            </label>
          </div>

          {/* ── OFF condition block (only when hasOff) ────────────────────── */}
          {hasOff && (
            <div style={{
              marginTop: 8, padding: '10px 12px',
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
            }}>
              <div style={{
                marginBottom: 8,
                fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                color: '#dc2626', textTransform: 'uppercase',
              }}>
                <span style={{ fontSize: 13, verticalAlign: 'middle' }}>●</span> Turn OFF when
              </div>

              {/* Position OFF */}
              {type === 'position' && (
                <div className="form-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label className="form-label" style={{ margin: 0 }}>Servo Axes</label>
                    <button className="btn btn--xs btn--ghost" onClick={() => addAxisFor(setOffAxes)}>+ Add Axis</button>
                  </div>
                  {offAxes.length === 0 && (
                    <div style={{ fontSize: 11, color: '#6b7280', padding: '6px 0', fontStyle: 'italic' }}>
                      No axes defined for the OFF condition.
                    </div>
                  )}
                  {offAxes.map(axis => renderAxisRow(axis, setOffAxes))}
                </div>
              )}

              {/* State OFF */}
              {type === 'state' && (
                <>
                  <div className="form-group">
                    <label className="form-label">State Machine</label>
                    <select
                      className="form-input"
                      value={offSmId}
                      onChange={e => { setOffSmId(e.target.value); setOffStateNodeId(''); }}
                    >
                      <option value="">-- Select SM --</option>
                      {allSMs.map(s => <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">State</label>
                    <select
                      className="form-input"
                      value={offStateNodeId}
                      onChange={e => setOffStateNodeId(e.target.value)}
                    >
                      <option value="">-- Select state --</option>
                      {offSmNodes.map(n => (
                        <option key={n.id} value={n.id}>{nodeLabelFor(n, offStateNumberMap)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Trigger mode</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input type="radio" name="offReachedMode" value="in" checked={offReachedMode === 'in'} onChange={() => setOffReachedMode('in')} />
                        <span><b>Is in state</b> — OFF only while SM is executing this step</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input type="radio" name="offReachedMode" value="completed" checked={offReachedMode === 'completed'} onChange={() => setOffReachedMode('completed')} />
                        <span><b>Has completed state</b> — OFF once SM has moved past this step</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input type="radio" name="offReachedMode" value="reached" checked={offReachedMode === 'reached'} onChange={() => setOffReachedMode('reached')} />
                        <span><b>Has reached state</b> — OFF at or past this step</span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* Condition OFF */}
              {type === 'condition' && (
                <div className="form-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label className="form-label" style={{ margin: 0 }}>Conditions (all must be true to turn OFF)</label>
                    <button className="btn btn--xs btn--ghost" onClick={() => addConditionRowFor(setOffConditions)}>+ Add Condition</button>
                  </div>
                  {offConditions.length === 0 && (
                    <div style={{ fontSize: 11, color: '#6b7280', padding: '6px 0', fontStyle: 'italic' }}>
                      No OFF conditions yet.
                    </div>
                  )}
                  {offConditions.map((row, idx) => renderConditionRow(row, idx, setOffConditions))}
                </div>
              )}
            </div>
          )}

          {/* ── Tag preview ──────────────────────────────────────────────── */}
          {cleanName && (
            <div style={{
              padding: '6px 10px', background: '#1e2937', borderRadius: 4,
              fontSize: 11, color: '#9ca3af', fontFamily: 'Consolas, monospace', marginTop: 8,
            }}>
              {type === 'position' && (
                <>Tag: <span style={{ color: '#befa4f' }}>p_At{cleanName}</span> <span style={{ color: '#6b7280' }}>(BOOL)</span></>
              )}
              {type === 'state' && (() => {
                const selNode = smNodes.find(n => n.id === stateNodeId);
                const stepNum = stateNumberMap.get(selNode?.id) ?? selNode?.data?.stepNumber ?? selNode?.data?.stateNumber ?? 'N';
                const op = reachedMode === 'reached' ? '>=' : reachedMode === 'completed' ? '>' : '==';
                const offSel = offSmNodes.find(n => n.id === offStateNodeId);
                const offStep = offStateNumberMap.get(offSel?.id) ?? offSel?.data?.stepNumber ?? offSel?.data?.stateNumber ?? 'N';
                const offOp = offReachedMode === 'reached' ? '>=' : offReachedMode === 'completed' ? '>' : '==';
                return (
                  <>
                    Tag: <span style={{ color: '#befa4f' }}>p_{cleanName}</span>{' '}
                    <span style={{ color: '#6b7280' }}>(BOOL)</span>
                    {!hasOff && selNode && (
                      <span style={{ marginLeft: 8, color: '#6b7280' }}>
                        &larr; OTE via XIC(SM.Step {op} {stepNum})
                      </span>
                    )}
                    {hasOff && (
                      <>
                        {selNode && (
                          <div style={{ marginTop: 4, color: '#86efac' }}>
                            ON (OTL): XIC(SM.Step {op} {stepNum})
                          </div>
                        )}
                        {offSel && (
                          <div style={{ color: '#fca5a5' }}>
                            OFF (OTU): XIC(SM.Step {offOp} {offStep})
                          </div>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
              {type === 'condition' && (
                <>Tag: <span style={{ color: '#befa4f' }}>p_{cleanName}</span> <span style={{ color: '#6b7280' }}>(BOOL)</span>{hasOff && <div style={{ marginTop: 4, color: '#fca5a5' }}>Latched (OTL/OTU)</div>}</>
              )}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!name.trim() || (type === 'condition' && conditions.filter(c => c.signalId).length < 1)}
          >
            {signal ? 'Save Changes' : 'Add Signal'}
          </button>
        </div>
      </div>
    </div>
  );
}
