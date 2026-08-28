/**
 * PropertiesPanel - Right panel, context-sensitive to selection.
 * Shows: SM properties (nothing selected), Node properties (state step), Edge properties (transition).
 */

import { useState, useEffect } from 'react';
import { DEVICE_TYPES } from '../lib/deviceTypes.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { buildProgramName } from '../lib/tagNaming.js';

// ─── State Machine Properties ────────────────────────────────────────────────

function SmProperties({ sm, smId }) {
  const store = useDiagramStore();
  const [localName, setLocalName] = useState(sm.displayName ?? sm.name);
  const [localStation, setLocalStation] = useState(sm.stationNumber);
  const [localDesc, setLocalDesc] = useState(sm.description ?? '');

  useEffect(() => {
    setLocalName(sm.displayName ?? sm.name);
    setLocalStation(sm.stationNumber);
    setLocalDesc(sm.description ?? '');
  }, [sm.id]);

  function save() {
    store.updateStateMachine(smId, {
      name: localName.replace(/[^a-zA-Z0-9_]/g, ''),
      displayName: localName,
      stationNumber: Number(localStation) || 1,
      description: localDesc,
    });
  }

  const programName = buildProgramName(localStation, localName);

  return (
    <div className="props-section">
      <div className="props-section__title">State Machine</div>

      <label className="form-label">Display Name</label>
      <input
        className="form-input"
        value={localName}
        onChange={e => setLocalName(e.target.value)}
        onBlur={save}
        placeholder="e.g. Post Cutter Verify"
      />

      <label className="form-label">Station Number</label>
      <input
        className="form-input"
        type="number"
        min="1"
        max="99"
        value={localStation}
        onChange={e => setLocalStation(e.target.value)}
        onBlur={save}
      />

      <label className="form-label">Description</label>
      <input
        className="form-input"
        value={localDesc}
        onChange={e => setLocalDesc(e.target.value)}
        onBlur={save}
        placeholder="e.g. Post Cutter and Verify"
      />

      <div className="props-info-box">
        <div className="props-info-box__label">Generated Program Name</div>
        <div className="props-info-box__value mono">{programName}</div>
      </div>

      <div className="props-info-box">
        <div className="props-info-box__label">States / Transitions</div>
        <div className="props-info-box__value">{sm.nodes?.length ?? 0} states, {sm.edges?.length ?? 0} transitions</div>
      </div>

      <div className="props-info-box">
        <div className="props-info-box__label">Devices</div>
        <div className="props-info-box__value">{sm.devices?.length ?? 0} device{sm.devices?.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  );
}

// ─── Node Properties ─────────────────────────────────────────────────────────

function NodeProperties({ node, sm }) {
  const store = useDiagramStore();
  const [label, setLabel] = useState(node.data.label);

  useEffect(() => {
    setLabel(node.data.label);
  }, [node.id]);

  function saveLabel() {
    store.updateNodeData(sm.id, node.id, { label });
  }

  const actions = node.data.actions ?? [];
  const devices = sm.devices ?? [];

  return (
    <div className="props-section">
      <div className="props-section__title">
        <span className="step-badge-sm">{node.data.isInitial ? 'START' : `S${node.data.stepNumber}`}</span>
        State Step
      </div>

      <label className="form-label">Label / Description</label>
      <textarea
        className="form-input form-textarea"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={saveLabel}
        rows={3}
        placeholder="e.g. Extend Post Cutter Cylinder"
      />

      {/* Actions list */}
      <div className="props-actions-header">
        <span className="form-label" style={{ marginBottom: 0 }}>Actions</span>
        <button
          className="btn btn--xs btn--primary"
          onClick={() => store.openActionModal(node.id)}
        >
          + Add
        </button>
      </div>

      {actions.length === 0 && (
        <div className="props-empty">No actions. Click + Add to define what happens in this state.</div>
      )}

      {actions.map(action => {
        const device = devices.find(d => d.id === action.deviceId);
        const typeInfo = DEVICE_TYPES[device?.type];
        return (
          <div key={action.id} className="action-card">
            <div className="action-card__left" style={{ background: typeInfo?.colorBg ?? '#f9fafb', borderColor: typeInfo?.color ?? '#9ca3af' }}>
              <span style={{ fontSize: 18 }}>{typeInfo?.icon ?? '?'}</span>
            </div>
            <div className="action-card__body">
              <div className="action-card__device">{device?.displayName ?? '(unknown device)'}</div>
              <div className="action-card__op">
                {action.operation === 'ServoMove'
                  ? `Move → ${action.positionName ?? '?'}`
                  : action.operation}
                {action.delayMs ? <span className="action-card__timer"> ({action.delayMs}ms)</span> : null}
              </div>
            </div>
            <div className="action-card__btns">
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => store.openActionModal(node.id, action.id)}
                title="Edit"
              >✏</button>
              <button
                className="icon-btn icon-btn--sm icon-btn--danger"
                onClick={() => store.deleteAction(sm.id, node.id, action.id)}
                title="Delete"
              >✕</button>
            </div>
          </div>
        );
      })}

      <div className="props-divider" />
      <button
        className="btn btn--sm btn--danger-ghost"
        onClick={() => {
          if (confirm(`Delete state "${node.data.label}"?`)) {
            store.deleteNode(sm.id, node.id);
          }
        }}
      >
        Delete This State
      </button>
    </div>
  );
}

// ─── Edge Properties ─────────────────────────────────────────────────────────

const CONDITION_TYPES = [
  { value: 'trigger',          label: 'Trigger (Tag ON)' },
  { value: 'indexComplete',    label: 'Index Complete' },
  { value: 'escapementComplete', label: 'Escapement Complete' },
  { value: 'sensorTimer',      label: 'Device Sensor + Timer' },
  { value: 'sensorOn',         label: 'Device Sensor ON' },
  { value: 'sensorOff',        label: 'Device Sensor OFF' },
  { value: 'servoAtTarget',    label: 'Servo At Target Position' },
  { value: 'timer',            label: 'Timer / Dwell' },
  { value: 'partPresent',      label: 'Part Present (with Debounce)' },
  { value: 'always',           label: 'Immediate (no condition)' },
  { value: 'custom',           label: 'Custom Tag' },
];

function EdgeProperties({ edge, sm }) {
  const store = useDiagramStore();
  const cond = edge.data ?? {};
  const [condType, setCondType] = useState(cond.conditionType ?? 'trigger');
  const [tagName, setTagName] = useState(cond.tagName ?? '');
  const [deviceId, setDeviceId] = useState(cond.deviceId ?? '');
  const [operation, setOperation] = useState(cond.operation ?? '');
  const [positionName, setPositionName] = useState(cond.positionName ?? '');
  const [delayMs, setDelayMs] = useState(cond.delayMs ?? 500);
  const [timerTag, setTimerTag] = useState(cond.timerTag ?? '');

  const devices = sm.devices ?? [];
  const selectedDevice = devices.find(d => d.id === deviceId);
  const deviceOps = selectedDevice ? (DEVICE_TYPES[selectedDevice.type]?.operations ?? []) : [];
  const servoPositions = selectedDevice?.positions ?? [];

  function buildLabel() {
    switch (condType) {
      case 'trigger': return `Trigger @ ${tagName || '?'}`;
      case 'indexComplete': return 'Index Complete';
      case 'escapementComplete': return 'Escapement Complete';
      case 'sensorTimer': {
        const d = devices.find(x => x.id === deviceId);
        return d ? `'${d.displayName}' ${operation} & Timer` : 'Sensor + Timer';
      }
      case 'sensorOn': {
        const d = devices.find(x => x.id === deviceId);
        return d ? `'${d.displayName}' ON` : 'Sensor ON';
      }
      case 'sensorOff': {
        const d = devices.find(x => x.id === deviceId);
        return d ? `'${d.displayName}' OFF` : 'Sensor OFF';
      }
      case 'servoAtTarget': {
        const d = devices.find(x => x.id === deviceId);
        return `@ '${positionName || '?'}'${d ? ` (${d.displayName})` : ''}`;
      }
      case 'timer': return `Timer ${delayMs}ms`;
      case 'partPresent': {
        const d = devices.find(x => x.id === deviceId);
        return d ? `'${d.displayName}' Part Present` : 'Part Present';
      }
      case 'always': return '(immediate)';
      case 'custom': return tagName || '(custom)';
      default: return condType;
    }
  }

  function save() {
    const label = buildLabel();
    store.updateEdge(sm.id, edge.id, {
      conditionType: condType,
      tagName,
      deviceId,
      operation,
      positionName,
      delayMs: Number(delayMs),
      timerTag,
      label,
    });
  }

  const needsDevice = ['sensorTimer', 'sensorOn', 'sensorOff', 'servoAtTarget', 'partPresent'].includes(condType);
  const needsOperation = ['sensorTimer', 'sensorOn', 'sensorOff'].includes(condType);
  const needsPosition = condType === 'servoAtTarget';
  const needsTag = ['trigger', 'custom'].includes(condType);
  const needsTimer = condType === 'timer';

  return (
    <div className="props-section">
      <div className="props-section__title">Transition Condition</div>

      <label className="form-label">Condition Type</label>
      <select
        className="form-select"
        value={condType}
        onChange={e => { setCondType(e.target.value); }}
        onBlur={save}
      >
        {CONDITION_TYPES.map(ct => (
          <option key={ct.value} value={ct.value}>{ct.label}</option>
        ))}
      </select>

      {needsDevice && (
        <>
          <label className="form-label">Device</label>
          <select
            className="form-select"
            value={deviceId}
            onChange={e => { setDeviceId(e.target.value); setOperation(''); setPositionName(''); }}
            onBlur={save}
          >
            <option value="">Select device...</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.displayName}</option>
            ))}
          </select>
        </>
      )}

      {needsOperation && selectedDevice && (
        <>
          <label className="form-label">Operation Verified</label>
          <select
            className="form-select"
            value={operation}
            onChange={e => setOperation(e.target.value)}
            onBlur={save}
          >
            <option value="">Select operation...</option>
            {deviceOps.map(op => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </>
      )}

      {needsPosition && selectedDevice && (
        <>
          <label className="form-label">Position Name</label>
          <select
            className="form-select"
            value={positionName}
            onChange={e => setPositionName(e.target.value)}
            onBlur={save}
          >
            <option value="">Select position...</option>
            {servoPositions.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </>
      )}

      {needsTag && (
        <>
          <label className="form-label">Tag Name</label>
          <input
            className="form-input mono"
            value={tagName}
            onChange={e => setTagName(e.target.value)}
            onBlur={save}
            placeholder="e.g. g_IndexComplete"
          />
        </>
      )}

      {needsTimer && (
        <>
          <label className="form-label">Delay (ms)</label>
          <input
            className="form-input"
            type="number"
            min="0"
            step="100"
            value={delayMs}
            onChange={e => setDelayMs(e.target.value)}
            onBlur={save}
          />
        </>
      )}

      {/* Preview label */}
      <div className="props-info-box">
        <div className="props-info-box__label">Edge Label Preview</div>
        <div className="props-info-box__value">{buildLabel()}</div>
      </div>

      <button className="btn btn--sm btn--primary" onClick={save} style={{ marginTop: 8 }}>
        Apply Condition
      </button>

      <div className="props-divider" />
      <button
        className="btn btn--sm btn--danger-ghost"
        onClick={() => {
          if (confirm('Delete this transition?')) {
            store.deleteEdge(sm.id, edge.id);
          }
        }}
      >
        Delete Transition
      </button>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function PropertiesPanel() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const selectedNode = store.getSelectedNode();
  const selectedEdge = store.getSelectedEdge();

  if (!sm) return null;

  return (
    <aside className="properties-panel">
      <div className="properties-panel__header">
        {selectedNode
          ? 'State Properties'
          : selectedEdge
          ? 'Transition Properties'
          : 'Program Properties'}
      </div>

      {selectedNode && <NodeProperties node={selectedNode} sm={sm} />}
      {!selectedNode && selectedEdge && <EdgeProperties edge={selectedEdge} sm={sm} />}
      {!selectedNode && !selectedEdge && <SmProperties sm={sm} smId={sm.id} />}
    </aside>
  );
}
