/**
 * SignalModal - Create/Edit a Signal.
 * Replaces ReferencePositionModal + SmOutputModal with a unified interface.
 *
 * Signal types:
 *   'position' - servo reference position (was ReferencePosition)
 *   'state'    - SM output: TRUE while SM is in a specific state
 *   'condition'- custom condition (future)
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

  // Position type state
  const [axes, setAxes] = useState(signal?.axes ?? []);

  // State type state
  const [smId, setSmId] = useState(signal?.smId ?? (allSMs[0]?.id ?? ''));
  const [stateNodeId, setStateNodeId] = useState(signal?.stateNodeId ?? '');
  const [reachedMode, setReachedMode] = useState(signal?.reachedMode ?? 'reached');

  // Condition type state — each condition row: { id, signalId, signalName, signalType }
  const [conditions, setConditions] = useState(signal?.conditions ?? []);

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
  }, [signal, isOpen]);

  // Auto PT signals + project signals for condition picker
  const autoPTSignals = getAutoPTSignals(allSMs);
  const allAvailableSignals = [...autoPTSignals, ...allSMs.flatMap(() => []), ...(store.project?.signals ?? [])];
  // Deduplicate by id
  const seenIds = new Set();
  const combinedSignals = [];
  for (const s of [...autoPTSignals, ...(store.project?.signals ?? [])]) {
    if (!seenIds.has(s.id)) { seenIds.add(s.id); combinedSignals.push(s); }
  }

  function addConditionRow() {
    setConditions(prev => [...prev, { id: uid(), signalId: '', signalName: '', signalType: '' }]);
  }

  function removeConditionRow(rowId) {
    setConditions(prev => prev.filter(c => c.id !== rowId));
  }

  function updateConditionRow(rowId, signalId) {
    const sig = combinedSignals.find(s => s.id === signalId);
    setConditions(prev => prev.map(c =>
      c.id === rowId
        ? { ...c, signalId, signalName: sig?.name ?? '', signalType: sig?.type ?? '' }
        : c
    ));
  }

  // ── Helpers for state type (hooks must be before early return) ────────────
  const selectedSm = allSMs.find(s => s.id === smId);
  const smNodes = selectedSm?.nodes ?? [];

  // Compute correct sequential state numbers using shared utility
  const stateNumberMap = useMemo(() => {
    if (!selectedSm) return new Map();
    return computeStateNumbers(selectedSm.nodes ?? [], selectedSm.edges ?? [], selectedSm.devices ?? []).stateMap;
  }, [selectedSm]);

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

  function addAxis() {
    const firstSm = allSMs[0];
    const firstServo = firstSm ? getServosForSm(firstSm.id)[0] : null;
    const firstPos = firstServo ? getPositionsForServo(firstSm?.id, firstServo.id)[0] : null;
    setAxes(prev => [...prev, {
      id: uid(),
      smId: firstSm?.id ?? '',
      deviceId: firstServo?.id ?? '',
      deviceName: firstServo?.displayName ?? '',
      positionName: firstPos?.name ?? '',
      tolerance: 1,
    }]);
  }

  function removeAxis(axisId) {
    setAxes(prev => prev.filter(a => a.id !== axisId));
  }

  function updateAxis(axisId, updates) {
    setAxes(prev => prev.map(a => a.id === axisId ? { ...a, ...updates } : a));
  }

  function nodeLabel(node) {
    const stepNum = stateNumberMap.get(node.id) ?? node.data?.stepNumber ?? node.data?.stateNumber ?? '?';
    // Special node types
    if (node.data?.isComplete) return `[${stepNum}] ✓ Cycle Complete`;
    if (node.data?.isInitial)  return `[${stepNum}] ⌂ Home / Initial`;
    if (node.type === 'decisionNode') {
      const src = node.data?.signalSource ?? node.data?.signalName ?? 'Decision';
      return `[${stepNum}] ⏳ Wait: ${src}`;
    }
    // Regular state node: show all actions as "Device → Op" pairs
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
      // Store a clean state name WITHOUT step number — step numbers are resolved dynamically
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

    if (signal) {
      store.updateSignal(signal.id, data);
    } else {
      store.addSignal(data);
    }
    onClose();
  }

  const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '');

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

          {/* ── Position type fields ─────────────────────────────────────── */}
          {type === 'position' && (
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>Servo Axes</label>
                <button className="btn btn--xs btn--ghost" onClick={addAxis}>+ Add Axis</button>
              </div>

              {axes.length === 0 && (
                <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0', fontStyle: 'italic' }}>
                  No axes defined. Click "+ Add Axis" to add servo axes to this signal.
                </div>
              )}

              {axes.map(axis => {
                const servos = getServosForSm(axis.smId);
                const positions = getPositionsForServo(axis.smId, axis.deviceId);
                return (
                  <div key={axis.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px 28px',
                    gap: 6, alignItems: 'center', marginBottom: 6,
                    padding: '6px 8px', background: '#f9fafb', borderRadius: 4,
                    border: '1px solid #e5e7eb',
                  }}>
                    {/* SM dropdown */}
                    <select
                      className="form-input"
                      style={{ fontSize: 11, padding: '3px 4px' }}
                      value={axis.smId}
                      onChange={e => {
                        const newSmId = e.target.value;
                        const firstServo = getServosForSm(newSmId)[0];
                        const firstPos = firstServo ? getPositionsForServo(newSmId, firstServo.id)[0] : null;
                        updateAxis(axis.id, {
                          smId: newSmId,
                          deviceId: firstServo?.id ?? '',
                          deviceName: firstServo?.displayName ?? '',
                          positionName: firstPos?.name ?? '',
                        });
                      }}
                    >
                      <option value="">-- SM --</option>
                      {allSMs.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>

                    {/* Servo dropdown */}
                    <select
                      className="form-input"
                      style={{ fontSize: 11, padding: '3px 4px' }}
                      value={axis.deviceId}
                      onChange={e => {
                        const newDevId = e.target.value;
                        const servo = getServosForSm(axis.smId).find(d => d.id === newDevId);
                        const firstPos = servo ? getPositionsForServo(axis.smId, newDevId)[0] : null;
                        updateAxis(axis.id, {
                          deviceId: newDevId,
                          deviceName: servo?.displayName ?? '',
                          positionName: firstPos?.name ?? '',
                        });
                      }}
                    >
                      <option value="">-- Servo --</option>
                      {servos.map(d => (
                        <option key={d.id} value={d.id}>{d.displayName}</option>
                      ))}
                    </select>

                    {/* Position dropdown */}
                    <select
                      className="form-input"
                      style={{ fontSize: 11, padding: '3px 4px' }}
                      value={axis.positionName}
                      onChange={e => updateAxis(axis.id, { positionName: e.target.value })}
                    >
                      <option value="">-- Position --</option>
                      {positions.map(p => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>

                    {/* Tolerance */}
                    <input
                      type="number"
                      className="form-input"
                      style={{ fontSize: 11, padding: '3px 4px' }}
                      value={axis.tolerance}
                      min="0"
                      step="0.1"
                      onChange={e => updateAxis(axis.id, { tolerance: Number(e.target.value) })}
                      title="Tolerance (mm)"
                    />

                    {/* Remove */}
                    <button
                      className="icon-btn icon-btn--sm icon-btn--danger"
                      onClick={() => removeAxis(axis.id)}
                      title="Remove axis"
                    >✕</button>
                  </div>
                );
              })}

              {axes.length > 0 && (
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                  Columns: SM · Servo · Position · Tolerance (mm)
                </div>
              )}
            </div>
          )}

          {/* ── State type fields ────────────────────────────────────────── */}
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
                  {allSMs.map(s => (
                    <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>
                  ))}
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
                    <option key={n.id} value={n.id}>
                      {nodeLabel(n)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Trigger mode</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="reachedMode"
                      value="in"
                      checked={reachedMode === 'in'}
                      onChange={() => setReachedMode('in')}
                    />
                    <span><b>Is in state</b> — TRUE only while SM is executing this step</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="reachedMode"
                      value="completed"
                      checked={reachedMode === 'completed'}
                      onChange={() => setReachedMode('completed')}
                    />
                    <span><b>Has completed state</b> — TRUE once SM has finished and moved past this step</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="reachedMode"
                      value="reached"
                      checked={reachedMode === 'reached'}
                      onChange={() => setReachedMode('reached')}
                    />
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

          {/* ── Condition type — multi-condition AND builder ─────────────── */}
          {type === 'condition' && (
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>
                  Conditions (all must be true)
                </label>
                <button className="btn btn--xs btn--ghost" onClick={addConditionRow}>+ Add Condition</button>
              </div>

              {conditions.length === 0 && (
                <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0', fontStyle: 'italic' }}>
                  No conditions yet. Click "+ Add Condition".
                </div>
              )}

              {conditions.map((row, idx) => {
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
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#0072B5', minWidth: 28, textAlign: 'center' }}>
                        AND
                      </span>
                    )}
                    {idx === 0 && (
                      <span style={{ fontSize: 10, color: '#6b7280', minWidth: 28, textAlign: 'center' }}>
                        IF
                      </span>
                    )}
                    <select
                      className="form-input"
                      style={{ flex: 1, fontSize: 11, padding: '3px 4px' }}
                      value={row.signalId}
                      onChange={e => updateConditionRow(row.id, e.target.value)}
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
                          {posSigs.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {stateSigs.length > 0 && (
                        <optgroup label="State Signals">
                          {stateSigs.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      className="icon-btn icon-btn--sm icon-btn--danger"
                      onClick={() => removeConditionRow(row.id)}
                      title="Remove condition"
                    >✕</button>
                  </div>
                );
              })}

              {/* Preview */}
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
                const stepNum = selNode?.data?.stepNumber ?? selNode?.data?.stateNumber ?? 'N';
                const op = reachedMode === 'reached' ? '>=' : reachedMode === 'completed' ? '>' : '==';
                return (
                  <>
                    Tag: <span style={{ color: '#befa4f' }}>p_{cleanName}</span>{' '}
                    <span style={{ color: '#6b7280' }}>(BOOL)</span>
                    {selNode && (
                      <span style={{ marginLeft: 8, color: '#6b7280' }}>
                        &larr; XIC(SM.Step {op} {stepNum})
                      </span>
                    )}
                  </>
                );
              })()}
              {type === 'condition' && (
                <>Tag: <span style={{ color: '#befa4f' }}>p_{cleanName}</span> <span style={{ color: '#6b7280' }}>(BOOL)</span></>
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
