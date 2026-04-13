/**
 * ReferencePositionModal - Create/Edit a Reference Position.
 * A Reference Position is a named set of servo axis positions that
 * the state machine can wait on (e.g. "PickPos", "PlacePos").
 */

import { useState, useEffect } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';

// Tiny ID generator
let _id = Date.now();
const uid = () => `id_${(_id++).toString(36)}`;

export function ReferencePositionModal({ refPos, onClose }) {
  const store = useDiagramStore();
  const allSMs = store.project?.stateMachines ?? [];

  const [name, setName] = useState(refPos?.name ?? '');
  const [description, setDescription] = useState(refPos?.description ?? '');
  const [axes, setAxes] = useState(refPos?.axes ?? []);

  // Build a flat list of servo devices across all SMs
  function getServosForSm(smId) {
    const sm = allSMs.find(s => s.id === smId);
    return (sm?.devices ?? []).filter(d => d.type === 'ServoAxis');
  }

  function getPositionsForServo(smId, axisDeviceId) {
    const sm = allSMs.find(s => s.id === smId);
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
      axisDeviceId: firstServo?.id ?? '',
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

  function handleSave() {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!cleanName) return;
    const data = { name: cleanName, description: description.trim(), axes };
    if (refPos) {
      store.updateReferencePosition(refPos.id, data);
    } else {
      store.addReferencePosition(data);
    }
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 540, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <h2 className="modal__title">{refPos ? 'Edit Reference Position' : 'New Reference Position'}</h2>
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
              placeholder="PickPos"
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

          {/* Axes table */}
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label className="form-label" style={{ margin: 0 }}>Axes</label>
              <button className="btn btn--xs btn--ghost" onClick={addAxis}>+ Add Axis</button>
            </div>

            {axes.length === 0 && (
              <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0', fontStyle: 'italic' }}>
                No axes defined. Click "+ Add Axis" to add servo axes to this reference position.
              </div>
            )}

            {axes.map(axis => {
              const servos = getServosForSm(axis.smId);
              const positions = getPositionsForServo(axis.smId, axis.axisDeviceId);
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
                        axisDeviceId: firstServo?.id ?? '',
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
                    value={axis.axisDeviceId}
                    onChange={e => {
                      const newAxisId = e.target.value;
                      const firstPos = getPositionsForServo(axis.smId, newAxisId)[0];
                      updateAxis(axis.id, {
                        axisDeviceId: newAxisId,
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <input
                      type="number"
                      className="form-input"
                      style={{ fontSize: 11, padding: '3px 4px', width: '100%' }}
                      value={axis.tolerance}
                      min="0"
                      step="0.1"
                      onChange={e => updateAxis(axis.id, { tolerance: Number(e.target.value) })}
                      title="Tolerance (mm)"
                    />
                  </div>

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

          {/* Tag preview */}
          {name.trim() && (
            <div style={{
              padding: '6px 10px', background: '#1e2937', borderRadius: 4,
              fontSize: 11, color: '#9ca3af', fontFamily: 'Consolas, monospace',
            }}>
              Sample tag: <span style={{ color: '#befa4f' }}>p_At{name.trim().replace(/[^a-zA-Z0-9_]/g, '')}</span>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {refPos ? 'Save Changes' : 'Add Reference Position'}
          </button>
        </div>
      </div>
    </div>
  );
}
