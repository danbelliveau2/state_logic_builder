/**
 * StateNode - Custom React Flow node representing a single state step.
 * Displays the step number, label, and list of device actions.
 */

import { Handle, Position } from '@xyflow/react';
import { DEVICE_TYPES } from '../../lib/deviceTypes.js';
import { useDiagramStore } from '../../store/useDiagramStore.js';

const TYPE_COLORS = {
  PneumaticLinearActuator:  { border: '#3b82f6', bg: '#eff6ff', icon: '⬆' },
  PneumaticRotaryActuator:  { border: '#6366f1', bg: '#eef2ff', icon: '↺' },
  PneumaticGripper:          { border: '#22c55e', bg: '#f0fdf4', icon: '✋' },
  PneumaticVacGenerator:     { border: '#a855f7', bg: '#faf5ff', icon: '💨' },
  ServoAxis:                 { border: '#f59e0b', bg: '#fffbeb', icon: '⚡' },
  Timer:                     { border: '#9ca3af', bg: '#f9fafb', icon: '⏱' },
  DigitalSensor:             { border: '#06b6d4', bg: '#ecfeff', icon: '👁' },
};

function ActionRow({ action, devices }) {
  const device = devices?.find(d => d.id === action.deviceId);
  if (!device) return null;

  const typeInfo = TYPE_COLORS[device.type] ?? { border: '#9ca3af', bg: '#f9fafb', icon: '?' };
  const opLabel = action.operation === 'ServoMove'
    ? `→ ${action.positionName ?? '?'}`
    : action.operation;

  return (
    <div className="action-row" style={{ borderLeftColor: typeInfo.border }}>
      <span className="action-icon">{typeInfo.icon}</span>
      <span className="action-device">{device.displayName}</span>
      <span className="action-op">{opLabel}</span>
    </div>
  );
}

export function StateNode({ data, selected, id }) {
  const { stepNumber, label, actions = [], isInitial } = data;
  const sm = useDiagramStore(s => s.getActiveSm());
  const devices = sm?.devices ?? [];

  // Determine node border color based on first action type (or initial)
  let borderColor = '#64748b';
  if (isInitial) borderColor = '#10b981';
  else if (actions.length > 0) {
    const firstDev = devices.find(d => d.id === actions[0]?.deviceId);
    if (firstDev) {
      borderColor = TYPE_COLORS[firstDev.type]?.border ?? borderColor;
    }
  }

  return (
    <div
      className={`state-node${selected ? ' state-node--selected' : ''}${isInitial ? ' state-node--initial' : ''}`}
      style={{ '--node-border': borderColor }}
    >
      {/* Target handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#64748b', width: 10, height: 10, border: '2px solid #fff' }}
      />

      {/* Header */}
      <div className="state-node__header">
        <span className="step-badge" style={{ background: borderColor }}>
          {isInitial ? 'START' : `S${stepNumber}`}
        </span>
        <span className="state-node__title">{label || `Step ${stepNumber}`}</span>
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="state-node__actions">
          {actions.map(action => (
            <ActionRow key={action.id} action={action} devices={devices} />
          ))}
        </div>
      )}

      {actions.length === 0 && (
        <div className="state-node__empty">
          <span>Click to add actions</span>
        </div>
      )}

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#64748b', width: 10, height: 10, border: '2px solid #fff' }}
      />
    </div>
  );
}
