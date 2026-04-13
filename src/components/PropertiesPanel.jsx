/**
 * PropertiesPanel - Right panel, context-sensitive to selection.
 * Shows: SM properties (nothing selected), Node properties (state step),
 *        DecisionNode properties (decision node), Edge properties (transition).
 */

import { useState, useEffect } from 'react';
import { DEVICE_TYPES } from '../lib/deviceTypes.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DeviceIcon } from './DeviceIcons.jsx';
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
  const isComplete = node.data.isComplete;

  // Find auto-verify device for this node (if any)
  const verifyAction = actions.find(a => {
    const dev = devices.find(d => d.id === a.deviceId);
    return dev?.type === 'CheckResults' && dev._autoVerify;
  });
  const verifyDevice = verifyAction ? devices.find(d => d.id === verifyAction.deviceId) : null;
  const verifyOutcomes = verifyDevice?.outcomes ?? [];

  function updateOutcome(outcomeId, updates) {
    if (!verifyDevice) return;
    const updatedOutcomes = verifyOutcomes.map(o =>
      o.id === outcomeId ? { ...o, ...updates } : o
    );
    store.updateDevice(sm.id, verifyDevice.id, { outcomes: updatedOutcomes });
  }

  // Determine badge
  const badge = isComplete ? 'DONE' : node.data.isInitial ? 'START' : `S${node.data.stepNumber}`;

  return (
    <div className="props-section">
      <div className="props-section__title">
        <span className="step-badge-sm" style={isComplete ? { background: '#5a9a48' } : undefined}>{badge}</span>
        {isComplete ? 'Cycle Complete' : 'State Step'}
      </div>

      <label className="form-label">Label / Description</label>
      <textarea
        className="form-input form-textarea"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={saveLabel}
        rows={3}
        placeholder={isComplete ? 'e.g. Cycle Complete' : 'e.g. Extend Post Cutter Cylinder'}
      />

      {/* Complete node: no actions, just info */}
      {isComplete && (
        <div className="props-info-box">
          <div className="props-info-box__label">Behavior</div>
          <div className="props-info-box__value">Transitions back to Wait (Step 1) to restart the cycle.</div>
        </div>
      )}

      {/* Actions list (not shown for complete nodes) */}
      {!isComplete && (
        <>
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
            // Hide auto-verify device from actions list (shown in Verify Conditions below)
            if (device?.type === 'CheckResults' && device._autoVerify) return null;
            return (
              <div key={action.id} className="action-card">
                <div className="action-card__left" style={{ background: typeInfo?.colorBg ?? '#f9fafb', borderColor: typeInfo?.color ?? '#9ca3af' }}>
                  <DeviceIcon type={device?.type} size={20} />
                </div>
                <div className="action-card__body">
                  <div className="action-card__device">{device?.displayName ?? '(unknown device)'}</div>
                  <div className="action-card__op">
                    {action.operation === 'ServoMove'
                      ? `Move → ${action.positionName ?? '?'}`
                      : action.operation === 'ServoIncr'
                      ? `↔ Increment ${action.incrementDist ?? 0}mm`
                      : action.operation === 'ServoIndex'
                      ? `🔄 Index ${action.indexAngle ?? 0}° (${action.indexStations ?? '?'}-pos)`
                      : action.operation === 'VisionInspect'
                      ? `📷 ${action.jobName ?? '?'} ${action.continuous ? '🔍 Search' : '📷 Snap'}`
                      : action.operation}
                    {action.delayMs ? <span className="action-card__timer"> ({action.delayMs}ms)</span> : null}
                    {action.continuous && action.continuousTimeoutMs ? <span className="action-card__timer"> (timeout: {action.continuousTimeoutMs}ms)</span> : null}
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
        </>
      )}

      {/* Verify Conditions section — shown when node has auto-verify outcomes */}
      {verifyOutcomes.length > 0 && (
        <>
          <div className="props-divider" />
          <div className="props-section__title" style={{ fontSize: 12 }}>Verify Conditions</div>
          {verifyOutcomes.map(out => (
            <div key={out.id} className="verify-outcome-card">
              <div className="verify-outcome-card__header">
                <span className="verify-outcome-card__label">{out.label || 'Condition'}</span>
                <button
                  className="icon-btn icon-btn--sm icon-btn--danger"
                  onClick={() => store.removeVerifyCondition(sm.id, node.id, out.id)}
                  title="Remove condition"
                >✕</button>
              </div>
              <div className="verify-outcome-card__retry">
                <label className="verify-retry-check">
                  <input
                    type="checkbox"
                    checked={!!out.retry}
                    onChange={e => updateOutcome(out.id, { retry: e.target.checked })}
                  />
                  Retry
                </label>
                {out.retry && (
                  <div className="verify-retry-fields">
                    <label className="verify-retry-field">
                      <span>Max</span>
                      <input
                        type="number"
                        className="form-input form-input--mini"
                        min="1"
                        max="99"
                        value={out.maxRetries ?? 3}
                        onChange={e => updateOutcome(out.id, { maxRetries: Number(e.target.value) || 3 })}
                      />
                    </label>
                    <label className="verify-retry-field">
                      <span>Fault → 127</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="props-divider" />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn--sm btn--secondary"
          onClick={() => store.duplicateNode(sm.id, node.id)}
        >
          ⧉ Duplicate
        </button>
        <button
          className="btn btn--sm btn--danger-ghost"
          onClick={() => {
            if (confirm(`Delete state "${node.data.label}"?`)) {
              store.deleteNode(sm.id, node.id);
            }
          }}
        >
          Delete State
        </button>
      </div>
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
  { value: 'analogInRange',    label: 'Analog Sensor In Range' },
  { value: 'timer',            label: 'Timer / Dwell' },
  { value: 'partPresent',      label: 'Part Present (with Debounce)' },
  { value: 'checkResult',      label: 'Check Result (Branch)' },
  { value: 'visionResult',    label: 'Vision Result (Branch)' },
  { value: 'servoComplete',   label: 'Servo Motion Complete' },
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
  const [outcomeId, setOutcomeId] = useState(cond.outcomeId ?? '');
  const [outcomeLabel, setOutcomeLabel] = useState(cond.outcomeLabel ?? '');

  const devices = sm.devices ?? [];
  const selectedDevice = devices.find(d => d.id === deviceId);
  const deviceOps = selectedDevice ? (DEVICE_TYPES[selectedDevice.type]?.operations ?? []) : [];
  const servoPositions = selectedDevice?.positions ?? [];

  // Available CheckResults devices for the checkResult condition type
  const checkResultsDevices = devices.filter(d => d.type === 'CheckResults');
  const checkDevice = checkResultsDevices.find(d => d.id === deviceId);
  const checkOutcomes = checkDevice?.outcomes ?? [];

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
      case 'checkResult': return outcomeLabel || '(branch)';
      case 'visionResult': return outcomeLabel || '(vision branch)';
      case 'servoComplete': {
        const d = devices.find(x => x.id === deviceId);
        return d ? `${d.displayName} Motion Complete` : 'Motion Complete';
      }
      case 'always': return '(immediate)';
      case 'custom': return tagName || '(custom)';
      default: return condType;
    }
  }

  function save() {
    const label = buildLabel();
    const outcomeIdx = checkOutcomes.findIndex(o => o.id === outcomeId);
    store.updateEdge(sm.id, edge.id, {
      conditionType: condType,
      tagName,
      deviceId,
      operation,
      positionName,
      delayMs: Number(delayMs),
      timerTag,
      label,
      outcomeId:    condType === 'checkResult' ? outcomeId : undefined,
      outcomeLabel: condType === 'checkResult' ? outcomeLabel : undefined,
      outcomeIndex: condType === 'checkResult' ? (outcomeIdx >= 0 ? outcomeIdx : 0) : undefined,
    });
  }

  const needsDevice = ['sensorTimer', 'sensorOn', 'sensorOff', 'servoAtTarget', 'partPresent'].includes(condType);
  const needsOperation = ['sensorTimer', 'sensorOn', 'sensorOff'].includes(condType);
  const needsPosition = condType === 'servoAtTarget';
  const needsTag = ['trigger', 'custom'].includes(condType);
  const needsTimer = condType === 'timer';
  const needsCheckResult = condType === 'checkResult';

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

      {needsCheckResult && (
        <>
          <label className="form-label">Check Results Device</label>
          <select
            className="form-select"
            value={deviceId}
            onChange={e => { setDeviceId(e.target.value); setOutcomeId(''); setOutcomeLabel(''); }}
            onBlur={save}
          >
            <option value="">Select check device...</option>
            {checkResultsDevices.map(d => (
              <option key={d.id} value={d.id}>{d.displayName}</option>
            ))}
          </select>

          {checkDevice && (
            <>
              <label className="form-label">Outcome (Branch)</label>
              <select
                className="form-select"
                value={outcomeId}
                onChange={e => {
                  const oid = e.target.value;
                  setOutcomeId(oid);
                  const out = checkOutcomes.find(o => o.id === oid);
                  setOutcomeLabel(out?.label ?? '');
                }}
                onBlur={save}
              >
                <option value="">Select outcome...</option>
                {checkOutcomes.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </>
          )}
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

// ─── Vision Signal Builder ────────────────────────────────────────────────────

function buildVisionSignals(allSMs) {
  const result = [];
  for (const sm of allSMs) {
    for (const device of (sm.devices ?? [])) {
      if (device.type !== 'VisionSystem') continue;
      for (const job of (device.jobs ?? [])) {
        result.push({
          id: `vision_${sm.id}_${device.id}_${job.name}`,
          label: `${device.name} \u2192 ${job.name}`,
          name: `${device.name} \u2192 ${job.name}`,
          smName: sm.name,
          type: 'visionJob',
          outcomes: job.outcomes ?? ['Pass', 'Fail'],
        });
      }
    }
  }
  return result;
}

// ─── Type Badge ──────────────────────────────────────────────────────────────

function SigTypeBadge({ type }) {
  const badges = {
    visionJob:    { label: 'VISION', textColor: '#fde68a', bg: '#451a03', border: '#f59e0b' },
    position:     { label: 'POS',   textColor: '#fcd34d', bg: '#78350f', border: '#f59e0b' },
    state:        { label: 'STATE', textColor: '#93c5fd', bg: '#1e3a5f', border: '#0072B5' },
    condition:    { label: 'COND',  textColor: '#d1d5db', bg: '#1f2937', border: '#6b7280' },
  };
  const b = badges[type] ?? badges.condition;
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
      color: b.textColor, background: b.bg, border: `1px solid ${b.border}`,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {b.label}
    </span>
  );
}

// ─── Decision Node Properties (read-only — editing is done inline on the node) ──

function DecisionNodeProperties({ node, sm }) {
  const store = useDiagramStore();
  const data = node.data;

  const signalName   = data.signalName   ?? 'Not configured';
  const signalSource = data.signalSource ?? data.signalSmName ?? null;
  const stateNumber  = data.stateNumber  ?? null;
  const exitCount    = data.exitCount    ?? 2;
  const exit1Label   = data.exit1Label   ?? 'Pass';
  const exit2Label   = data.exit2Label   ?? 'Fail';

  return (
    <div className="props-section">
      <div className="props-section__title">
        {stateNumber != null && stateNumber > 0 && (
          <span className="step-badge-sm" style={{ marginRight: 6 }}>{stateNumber}</span>
        )}
        Wait / Decision
      </div>

      <div className="props-info-box">
        <div className="props-info-box__label">Wait on Signal</div>
        <div className="props-info-box__value" style={{ fontWeight: 700 }}>{signalName}</div>
        {signalSource && (
          <div className="props-info-box__value" style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{signalSource}</div>
        )}
      </div>

      <div className="props-info-box">
        <div className="props-info-box__label">Branches</div>
        <div className="props-info-box__value">{exitCount === 1 ? '1 branch — wait then continue' : `2 branches: ${exit1Label} / ${exit2Label}`}</div>
      </div>

      <div className="props-info-box" style={{ fontSize: 10, color: '#6b7280', fontStyle: 'italic', background: 'none', border: 'none', padding: 0 }}>
        To edit: hover the diamond and click the ✎ icon.
      </div>

      <div className="props-divider" />
      <button
        className="btn btn--sm btn--danger-ghost"
        onClick={() => {
          if (confirm('Delete this decision node?')) {
            store.deleteNode(sm.id, node.id);
          }
        }}
      >
        Delete Decision Node
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

  const isDecisionNode = selectedNode?.type === 'decisionNode';
  const isStateNode = selectedNode && !isDecisionNode;

  return (
    <aside className="properties-panel">
      <div className="properties-panel__header">
        {isDecisionNode
          ? 'Decision Properties'
          : isStateNode
          ? 'State Properties'
          : selectedEdge
          ? 'Transition Properties'
          : 'Program Properties'}
      </div>

      {isDecisionNode && <DecisionNodeProperties node={selectedNode} sm={sm} />}
      {isStateNode && <NodeProperties node={selectedNode} sm={sm} />}
      {!selectedNode && selectedEdge && <EdgeProperties edge={selectedEdge} sm={sm} />}
      {!selectedNode && !selectedEdge && <SmProperties sm={sm} smId={sm.id} />}
    </aside>
  );
}
