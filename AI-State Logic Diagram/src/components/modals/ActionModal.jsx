/**
 * ActionModal - Add or edit a device action within a state step.
 * ME picks: device → operation → (optional) position/timer.
 */

import { useState, useEffect } from 'react';
import { DEVICE_TYPES } from '../../lib/deviceTypes.js';
import { useDiagramStore } from '../../store/useDiagramStore.js';

export function ActionModal() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const nodeId = store.actionModalNodeId;
  const actionId = store.actionModalActionId; // null = add new

  const node = sm?.nodes.find(n => n.id === nodeId);
  const existingAction = actionId ? node?.data.actions.find(a => a.id === actionId) : null;

  const devices = sm?.devices ?? [];

  const [deviceId, setDeviceId] = useState(existingAction?.deviceId ?? '');
  const [operation, setOperation] = useState(existingAction?.operation ?? '');
  const [positionName, setPositionName] = useState(existingAction?.positionName ?? '');
  const [delayMs, setDelayMs] = useState(existingAction?.delayMs ?? '');

  useEffect(() => {
    if (existingAction) {
      setDeviceId(existingAction.deviceId ?? '');
      setOperation(existingAction.operation ?? '');
      setPositionName(existingAction.positionName ?? '');
      setDelayMs(existingAction.delayMs ?? '');
    } else {
      setDeviceId('');
      setOperation('');
      setPositionName('');
      setDelayMs('');
    }
  }, [nodeId, actionId]);

  const selectedDevice = devices.find(d => d.id === deviceId);
  const typeInfo = selectedDevice ? DEVICE_TYPES[selectedDevice.type] : null;
  const operations = typeInfo?.operations ?? [];
  const selectedOp = operations.find(op => op.value === operation);
  const isServo = selectedDevice?.type === 'ServoAxis';
  const servoPositions = selectedDevice?.positions ?? [];
  const isTimer = selectedDevice?.type === 'Timer';

  function handleDeviceChange(id) {
    setDeviceId(id);
    setOperation('');
    setPositionName('');
    setDelayMs('');
    // Auto-select first operation if only one
    const dev = devices.find(d => d.id === id);
    const ops = DEVICE_TYPES[dev?.type]?.operations ?? [];
    if (ops.length === 1) setOperation(ops[0].value);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!deviceId || !operation) return;
    if (!sm) return;

    const actionData = {
      deviceId,
      operation,
      positionName: isServo ? positionName : undefined,
      delayMs: delayMs !== '' ? Number(delayMs) : undefined,
    };

    if (actionId) {
      store.updateAction(sm.id, nodeId, actionId, actionData);
    } else {
      store.addAction(sm.id, nodeId, actionData);
    }

    store.closeActionModal();
  }

  const stepInfo = node?.data
    ? `${node.data.isInitial ? 'START' : `S${node.data.stepNumber}`}: ${node.data.label}`
    : '';

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) store.closeActionModal(); }}>
      <div className="modal" style={{ width: 480 }}>
        <div className="modal__header">
          <div>
            <div>{actionId ? 'Edit Action' : 'Add Action'}</div>
            {stepInfo && <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>{stepInfo}</div>}
          </div>
          <button className="icon-btn" onClick={store.closeActionModal}>✕</button>
        </div>

        <form className="modal__body" onSubmit={handleSubmit}>
          {/* Device selection */}
          <label className="form-label">Device *</label>
          {devices.length === 0 ? (
            <div className="props-empty">
              No devices defined. Add devices first via the left sidebar.
            </div>
          ) : (
            <div className="device-select-grid">
              {devices.map(d => {
                const info = DEVICE_TYPES[d.type];
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`device-select-card${deviceId === d.id ? ' device-select-card--selected' : ''}`}
                    style={{ '--card-color': info?.color ?? '#9ca3af' }}
                    onClick={() => handleDeviceChange(d.id)}
                  >
                    <span className="device-select-card__icon">{info?.icon ?? '?'}</span>
                    <span className="device-select-card__name">{d.displayName}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Operation selection */}
          {selectedDevice && operations.length > 0 && (
            <>
              <label className="form-label" style={{ marginTop: 16 }}>Operation *</label>
              <div className="op-select-row">
                {operations.map(op => (
                  <button
                    key={op.value}
                    type="button"
                    className={`op-btn${operation === op.value ? ' op-btn--selected' : ''}`}
                    style={{ '--op-color': typeInfo?.color ?? '#9ca3af' }}
                    onClick={() => setOperation(op.value)}
                  >
                    <span>{op.icon}</span>
                    <span>{op.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Servo position */}
          {isServo && operation === 'ServoMove' && (
            <>
              <label className="form-label" style={{ marginTop: 12 }}>Target Position *</label>
              {servoPositions.length === 0 ? (
                <div className="props-empty">
                  No positions defined for this servo. Edit the device to add positions.
                </div>
              ) : (
                <select
                  className="form-select"
                  value={positionName}
                  onChange={e => setPositionName(e.target.value)}
                  required
                >
                  <option value="">Select position...</option>
                  {servoPositions.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.isRecipe ? ' (recipe)' : ''} — {p.defaultValue ?? 0}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          {/* Timer override */}
          {isTimer && (
            <>
              <label className="form-label" style={{ marginTop: 12 }}>Dwell Time (ms)</label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="100"
                value={delayMs}
                onChange={e => setDelayMs(e.target.value)}
                placeholder={`Default: ${selectedDevice?.timerMs ?? 1000}`}
              />
            </>
          )}

          {/* Preview */}
          {deviceId && operation && (
            <div className="props-info-box" style={{ marginTop: 12 }}>
              <div className="props-info-box__label">Action Preview</div>
              <div className="props-info-box__value">
                <span style={{ color: typeInfo?.color, marginRight: 6 }}>{typeInfo?.icon}</span>
                <strong>{selectedDevice?.displayName}</strong>
                {' → '}
                {operation === 'ServoMove' ? `Move to ${positionName || '?'}` : operation}
              </div>
            </div>
          )}

          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={store.closeActionModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!deviceId || !operation || (isServo && operation === 'ServoMove' && !positionName)}
            >
              {actionId ? 'Save Changes' : 'Add Action'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
