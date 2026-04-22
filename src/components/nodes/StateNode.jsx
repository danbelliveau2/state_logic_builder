/**
 * StateNode - Custom React Flow node for state steps.
 * Headerless: shows only action rows (device + operation).
 * Node outline shape changes per device type (hexagon, octagon, pill, etc.)
 * Inline picker via NodeToolbar for quick action add.
 * Right-click context menu with Duplicate option.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { DEVICE_TYPES } from '../../lib/deviceTypes.js';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { DeviceIcon } from '../DeviceIcons.jsx';
import { hasSensorForOperation, needsTimerForOperation } from '../../lib/conditionBuilder.js';
import { getSensorTagForOperation, getDelayTimerForOperation } from '../../lib/tagNaming.js';
import { OUTCOME_COLORS } from '../../lib/outcomeColors.js';
import { buildAvailableInputs } from '../../lib/availableInputs.js';
import { useReactFlowZoomScale } from '../../lib/useReactFlowZoomScale.js';
import { ENTRY_RULES, getEntryRuleMeta, resolveEntryRule, isEntryRuleOverridden } from '../../lib/entryRules.js';
import { START_CONDITIONS, getStartConditionMeta, resolveIndexSync, isIndexSyncOverridden } from '../../lib/indexSync.js';
import { PartTrackingPill } from '../PartTrackingPanel.jsx';
import { PtBadge } from './PtBadge.jsx';
import { ConnectMenu, HandleClickZone } from '../ConnectMenu.jsx';

// Tiny local ID generator (mirrors store uid — not exported from store)
let _localId = Date.now();
const uid = () => `id_${(_localId++).toString(36)}`;

// ── Operation-based colors (SDC Brand: active = SDC Blue, return = SDC Light Blue) ──

const OPERATION_COLORS = {
  // Active operations (SDC Blue)
  Extend:     '#1574c4',
  Engage:     '#1574c4',
  VacOn:      '#1574c4',
  VacOnEject: '#aacee8',
  // Return operations (SDC Light Blue)
  Retract:    '#aacee8',
  Disengage:  '#aacee8',
  VacOff:     '#aacee8',
  // Parameter operations
  SetOn:      '#1574c4',
  SetOff:     '#aacee8',
  WaitOn:     '#1574c4',
  WaitOff:    '#aacee8',
  SetValue:   '#befa4f',
  // Sensors
  VerifyValue:'#d9d9d9',
  Check:      '#d9d9d9',
  // VisionSystem
  Inspect:       '#ffde51',
  VisionInspect: '#ffde51',
  // ServoAxis operations
  ServoMove:     '#1574c4',
  ServoIncr:     '#befa4f',
  ServoIndex:    '#aacee8',
};

function getOperationColor(operation, deviceType) {
  if (OPERATION_COLORS[operation]) return OPERATION_COLORS[operation];
  // Fallback to device type color for servo, timer, sensor
  return DEVICE_TYPES[deviceType]?.color ?? '#9ca3af';
}

// ── Operation Switcher Popup ──────────────────────────────────────────────────
// Small portaled dropdown that appears when clicking an operation badge.
// Shows available operations for the device type so user can quickly switch.
// Uses screen coordinates from the click event (not anchorEl ref) for reliable positioning.
function OperationSwitcher({ action, device, smId, nodeId, pos, onClose }) {
  const menuRef = useRef(null);
  const store = useDiagramStore();
  const deviceDef = DEVICE_TYPES[device.type];
  const operations = deviceDef?.operations ?? [];

  // Click outside to close — use setTimeout so the opening click doesn't immediately close
  useEffect(() => {
    function handleDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleDown, true);
    };
  }, [onClose]);

  const zoomStyle = useReactFlowZoomScale();
  if (operations.length < 2) return null;

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
      {operations.map(op => {
        const color = getOperationColor(op.value, device.type);
        const LIGHT_BG_COLORS = new Set(['#aacee8', '#befa4f', '#d9d9d9']);
        const isLightBg = LIGHT_BG_COLORS.has(color);
        const isActive = action.operation === op.value;
        return (
          <div
            key={op.value}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (!isActive) {
                store.updateAction(smId, nodeId, action.id, { operation: op.value });
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
              background: color, border: isLightBg ? '1px solid #b0b0b0' : 'none',
              flexShrink: 0,
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

/** Build short verify-condition text for a single action */
function buildActionVerifyText(action, device) {
  if (!device) return null;
  const parts = [];

  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
    case 'PneumaticGripper': {
      const oppMap = { Extend: 'Retract', Retract: 'Extend', Engage: 'Disengage', Disengage: 'Engage' };
      const oppOp = oppMap[action.operation];
      // Departure: opposite sensor OFF (only if sensor exists)
      if (oppOp && hasSensorForOperation(device, oppOp)) {
        const tag = getSensorTagForOperation(device, oppOp);
        if (tag) parts.push(`${tag}=OFF`);
      }
      // Arrival: target sensor ON, or delay timer
      if (hasSensorForOperation(device, action.operation)) {
        const tag = getSensorTagForOperation(device, action.operation);
        if (tag) parts.push(`${tag}=ON`);
      } else if (needsTimerForOperation(device, action.operation)) {
        const timerTag = getDelayTimerForOperation(device, action.operation);
        if (timerTag) parts.push(`${timerTag}.DN`);
      }
      break;
    }
    case 'PneumaticVacGenerator': {
      if (action.operation === 'VacOff') {
        // VacOff reuses the VacOn delay timer
        const timerTag = getDelayTimerForOperation(device, 'VacOn');
        if (timerTag) parts.push(`${timerTag}.DN`);
      } else {
        const tag = getSensorTagForOperation(device, action.operation);
        if (tag) parts.push(`${tag}=ON`);
      }
      break;
    }
    case 'ServoAxis': {
      const posName = action.positionName ?? '';
      parts.push(`${device.name}iq_MAM.PC`);
      if (posName) parts.push(`${device.name}iq_${posName}RC.In_Range`);
      break;
    }
    case 'Timer':
      parts.push(`${device.name}.DN`);
      break;
    case 'DigitalSensor': {
      const tag = getSensorTagForOperation(device, action.operation);
      if (tag) parts.push(`${tag}=${action.operation === 'WaitOff' ? 'OFF' : 'ON'}`);
      break;
    }
    case 'Robot': {
      if (action.operation === 'RunSequence') {
        const n = action.sequenceNumber ?? '?';
        parts.push(`Seq #${n} → wait PrgDone`);
      } else if (action.operation === 'SetOutput') {
        const n = action.signalNumber != null ? `DI[${action.signalNumber}]` : '';
        parts.push(`${n} ${action.signalName ?? ''} = ${action.signalValue ?? 'ON'}`.trim());
      } else if (action.operation === 'WaitInput') {
        const n = action.signalNumber != null ? `DO[${action.signalNumber}]` : '';
        parts.push(`${n} ${action.signalName ?? ''} = ${action.signalValue ?? 'ON'}`.trim());
      }
      break;
    }
    case 'AnalogSensor': {
      const spName = action.setpointName ?? '';
      if (spName) {
        const sp = device.setpoints?.find(s => s.name === spName);
        if (sp) {
          const nominal = sp.nominal ?? sp.defaultValue;
          const tol = sp.tolerance;
          const low = sp.lowLimit;
          const high = sp.highLimit;
          if (nominal !== undefined && tol !== undefined) {
            parts.push(`${spName}: ${Number(nominal).toFixed(2)} ± ${Number(tol).toFixed(2)}`);
          } else if (low !== undefined && high !== undefined) {
            parts.push(`${spName}: ${Number(low).toFixed(2)} – ${Number(high).toFixed(2)}`);
          } else if (nominal !== undefined) {
            parts.push(`${spName}: ${Number(nominal).toFixed(2)}`);
          } else {
            parts.push(spName);
          }
        } else {
          parts.push(spName);
        }
      }
      break;
    }
    case 'Parameter': {
      // SetOn / SetOff / SetValue: latch — no verify condition to show
      if (action.operation === 'WaitOn' || action.operation === 'WaitOff') {
        const pPfx = device.dataType === 'boolean' ? 'q_' : 'p_';
        const tag = `${pPfx}${device.name}`;
        parts.push(`${tag}=${action.operation === 'WaitOff' ? 'OFF' : 'ON'}`);
      }
      break;
    }
    case 'CheckResults': {
      const outcomes = device.outcomes ?? [];
      // 1 outcome: show inline verify text. 2+: chips rendered below.
      if (outcomes.length === 1 && outcomes[0].label) {
        parts.push(outcomes[0].label);
      }
      break;
    }
    case 'VisionSystem': {
      // Don't show verify text here — sub-steps are rendered below
      break;
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

// ── Node shape per device type (matches SDC standard reference frames) ───────

const DEVICE_NODE_SHAPES = {
  PneumaticLinearActuator: 'rect',
  PneumaticRotaryActuator: 'pentagon',
  PneumaticGripper:        'hexagon',
  PneumaticVacGenerator:   'octagon',
  ServoAxis:               'decagon',
  Timer:                   'dodecagon',
  DigitalSensor:           'poly14',
  AnalogSensor:            'poly14',
  Parameter:               'pill',
  CheckResults:            'poly16',
  VisionSystem:            'rect',
};

/** Determine node shape from the primary (first) device action */
function getNodeShape(actions, devices) {
  if (!actions || actions.length === 0) return 'rounded';
  const firstDevice = devices?.find(d => d.id === actions[0]?.deviceId);
  if (!firstDevice) return 'rounded';

  // CheckResults: only diamond if 2+ outcomes (branching). 1 outcome = stay rounded (linear verify).
  if (firstDevice.type === 'CheckResults') {
    return (firstDevice.outcomes ?? []).length >= 2 ? 'poly16' : 'rounded';
  }

  return DEVICE_NODE_SHAPES[firstDevice.type] || 'rounded';
}

// ── SVG Shape Background ─────────────────────────────────────────────────────
// Renders an SVG polygon as the node border/fill. Uses vectorEffect to keep
// stroke width consistent when the SVG stretches to fit node dimensions.

// Fixed corner inset in pixels — stays constant regardless of node height
const CORNER_PX = 14;

// Generates polygon points with fixed-pixel corner insets for each shape.
// w = node width, h = node height, c = corner inset in px
function buildShapePoints(shape, w, h) {
  const c = CORNER_PX;
  const cx = Math.min(c, w * 0.15); // don't exceed 15% of width
  const cy = Math.min(c, h * 0.15); // don't exceed 15% of height
  switch (shape) {
    case 'rect':
      return `0,0 ${w},0 ${w},${h} 0,${h}`;
    case 'pentagon':
      return `${cx},0 ${w-cx},0 ${w},${h*0.62} ${w/2},${h} 0,${h*0.62}`;
    case 'hexagon':
      return `${cx},0 ${w-cx},0 ${w},${h/2} ${w-cx},${h} ${cx},${h} 0,${h/2}`;
    case 'octagon':
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${cy}`;
    case 'decagon':
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${h/2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h/2} 0,${cy}`;
    case 'dodecagon': {
      const cy2 = cy * 2.5;
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${cy2} ${w},${h-cy2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h-cy2} 0,${cy2} 0,${cy}`;
    }
    case 'poly14': {
      const cy2 = cy * 2.2;
      const cy3 = cy * 3.8;
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${cy2} ${w},${h/2} ${w},${h-cy2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h-cy2} 0,${h/2} 0,${cy2} 0,${cy}`;
    }
    case 'poly16': {
      const cy2 = cy * 1.8;
      const cy3 = cy * 3;
      const cy4 = cy * 4.2;
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${cy2} ${w},${cy3} ${w},${h-cy3} ${w},${h-cy2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h-cy2} 0,${h-cy3} 0,${cy3} 0,${cy2} 0,${cy}`;
    }
    default:
      return null;
  }
}

function ShapeBackground({ shape, borderColor, selected }) {
  const svgRef = useRef(null);
  const [dims, setDims] = useState({ w: 240, h: 80 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDims({ w: width, h: height });
        }
      }
    });
    ro.observe(el);
    // Initial measurement
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDims({ w: rect.width, h: rect.height });
    }
    return () => ro.disconnect();
  }, []);

  const points = buildShapePoints(shape, dims.w, dims.h);
  if (!points) return null;

  return (
    <svg
      ref={svgRef}
      className="state-node__shape-bg"
      viewBox={`0 0 ${dims.w} ${dims.h}`}
      preserveAspectRatio="none"
    >
      <polygon
        points={points}
        fill="white"
        stroke={borderColor}
        strokeWidth={selected ? 3 : 2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Action Row ────────────────────────────────────────────────────────────────

function ActionRow({ action, devices, onClickName, onClickOp, smId, nodeId }) {
  // Part Tracking action — special rendering
  if (action.deviceId === '_tracking') {
    const fieldName = action.trackingFieldName ?? action.ptFieldName ?? 'Field';
    let badgeColor, badgeLabel, verifyText;
    if (action.operation === 'TrackWaitOn') {
      badgeColor = '#1574c4'; badgeLabel = 'WaitOn';
      verifyText = `PT:${fieldName}=SUCCESS`;
    } else if (action.operation === 'TrackWaitOff') {
      badgeColor = '#aacee8'; badgeLabel = 'WaitOff';
      verifyText = `PT:${fieldName}=FAILURE`;
    } else if (action.operation === 'TrackSet' || action.operation === 'UpdateTracking') {
      const isSuccess = action.ptValue === 'SUCCESS' || action.operation === 'TrackSet';
      badgeColor = isSuccess ? '#74c415' : '#fa5650';
      badgeLabel = isSuccess ? 'PT: SUCCESS' : 'PT: FAILURE';
    } else {
      badgeColor = '#fa5650'; badgeLabel = 'PT: FAILURE';
    }
    const isLight = ['#aacee8','#befa4f','#d9d9d9'].includes(badgeColor);
    return (
      <div className="action-row-wrap">
        <div className="action-row" style={{ borderLeftColor: badgeColor }}>
          <span className="action-icon" style={{ fontSize: 14 }}>&#x1F4CB;</span>
          <span
            className={`action-device${onClickName ? ' action-device--clickable nodrag' : ''}`}
            style={{ fontSize: 12 }}
            onClick={onClickName}
          >{fieldName}</span>
          <span className="action-op" style={{
            background: badgeColor,
            color: isLight ? '#333' : '#fff',
            borderColor: badgeColor,
          }}>{badgeLabel}</span>
        </div>
        {verifyText && <div className="action-verify-text">{verifyText}</div>}
      </div>
    );
  }

  // Special rendering for all tracking actions (no device needed)
  if (action.operation === 'UpdateTracking') {
    const ptColor = action.ptValue === 'SUCCESS' ? '#74c415' : '#fa5650';
    const badgeLabel = `PT: ${action.ptValue}`;
    return (
      <div className="action-row" style={{ borderLeft: `3px solid ${ptColor}` }}>
        <div className="action-row__main">
          <span className="action-row__name" style={{ fontSize: 11 }}>
            📊 {action.ptFieldName ?? 'PT'}
          </span>
          <span className="action-row__badge" style={{
            backgroundColor: ptColor,
            color: action.ptValue === 'SUCCESS' ? '#1a3a1a' : '#fff',
            borderColor: ptColor,
          }}>{badgeLabel}</span>
        </div>
      </div>
    );
  }
  if (action.operation === 'TrackWaitOn' || action.operation === 'TrackWaitOff') {
    const isOn = action.operation === 'TrackWaitOn';
    const badgeColor = isOn ? '#1574c4' : '#aacee8';
    const badgeLabel = isOn ? 'WaitOn' : 'WaitOff';
    const verifyText = `PT:${action.trackingFieldName}=${isOn ? 'SUCCESS' : 'FAILURE'}`;
    return (
      <div className="action-row" style={{ borderLeft: `3px solid ${badgeColor}` }}>
        <div className="action-row__main">
          <span className="action-row__name" style={{ fontSize: 11 }}>
            📊 {action.trackingFieldName ?? 'PT'}
          </span>
          <span className="action-row__badge" style={{
            backgroundColor: badgeColor,
            color: '#fff',
            borderColor: badgeColor,
          }}>{badgeLabel}</span>
        </div>
        <div className="action-row__verify">{verifyText}</div>
      </div>
    );
  }
  if (action.operation === 'TrackSet' || action.operation === 'TrackClear') {
    const isSet = action.operation === 'TrackSet';
    const ptColor = isSet ? '#74c415' : '#fa5650';
    const badgeLabel = isSet ? 'PT: SUCCESS' : 'PT: FAILURE';
    return (
      <div className="action-row" style={{ borderLeft: `3px solid ${ptColor}` }}>
        <div className="action-row__main">
          <span className="action-row__name" style={{ fontSize: 11 }}>
            📊 {action.trackingFieldName ?? 'PT'}
          </span>
          <span className="action-row__badge" style={{
            backgroundColor: ptColor,
            color: isSet ? '#1a3a1a' : '#fff',
            borderColor: ptColor,
          }}>{badgeLabel}</span>
        </div>
      </div>
    );
  }

  // WaitRefPos — special rendering (before device lookup)
  if (action.operation === 'WaitRefPos') {
    return (
      <div className="action-row" style={{ borderLeft: '3px solid #f59e0b' }}>
        <div className="action-row__main">
          <span className="action-row__name">📍 {action.refPosName ?? 'RefPos'}</span>
          <span className="action-row__badge" style={{ backgroundColor: '#f59e0b', color: '#1a1a1a', borderColor: '#f59e0b' }}>
            WaitRef
          </span>
        </div>
        <div className="action-row__verify">At: {action.refPosName ?? '?'}</div>
      </div>
    );
  }

  // WaitSmOutput — special rendering (before device lookup)
  if (action.operation === 'WaitSmOutput') {
    return (
      <div className="action-row" style={{ borderLeft: '3px solid #0072B5' }}>
        <div className="action-row__main">
          <span className="action-row__name">⤴ {action.outputSmName ?? 'SM'}</span>
          <span className="action-row__badge" style={{ backgroundColor: '#0072B5', color: '#fff', borderColor: '#0072B5' }}>
            {action.outputName ?? 'Output'}
          </span>
        </div>
        <div className="action-row__verify">{action.outputSmName}: {action.outputName}</div>
      </div>
    );
  }

  const device = devices?.find(d => d.id === action.deviceId);
  if (!device) return null;

  const opColor = getOperationColor(action.operation, device.type);
  // Light background colors need dark text
  const LIGHT_BG_COLORS = new Set(['#aacee8', '#befa4f', '#d9d9d9']);
  const isLightBg = LIGHT_BG_COLORS.has(opColor);
  let opLabel;
  if (action.operation === 'ServoMove') {
    const posName = action.positionName ?? '?';
    const pos = device.positions?.find(p => p.name === action.positionName);
    const val = pos?.defaultValue;
    opLabel = val !== undefined ? `→ ${posName} ${Number(val).toFixed(1)}` : `→ ${posName}`;
    if (action.offsetSource) opLabel += ' +offset';
  } else if (action.operation === 'ServoIncr') {
    const dist = action.incrementDist ?? 1.0;
    opLabel = action.positionName ? `Δ ${action.positionName} ${dist}mm` : `Δ ${dist}mm`;
  } else if (action.operation === 'ServoIndex') {
    const stations = action.indexStations ?? 6;
    const angle = action.indexAngle ?? 60;
    opLabel = action.positionName ? `⟳ ${action.positionName} ${angle}°` : `⟳ ${angle}° (${stations}-pos)`;
  } else if (action.operation === 'VisionInspect') {
    const mode = action.continuous ? 'Search' : 'Snap';
    opLabel = `${action.jobName ?? '?'} [${mode}]`;
  } else if (device?.type === 'Robot') {
    if (action.operation === 'RunSequence') {
      opLabel = action.sequenceName
        ? `▶ ${action.sequenceName}`
        : `▶ Seq#${action.sequenceNumber ?? '?'}`;
    } else if (action.operation === 'SetOutput') {
      opLabel = `Set ${action.signalValue ?? 'ON'}`;
    } else if (action.operation === 'WaitInput') {
      opLabel = `Wait ${action.signalValue ?? 'ON'}`;
    } else {
      opLabel = action.operation;
    }
  } else if (device?.type === 'AnalogSensor') {
    // AnalogSensor: badge shows the operation ("Check Range" / "Read Value");
    // the setpoint being tested is rendered in the verify line below.
    if (action.operation === 'ReadValue') {
      opLabel = 'Read Value';
    } else {
      // CheckRange (and legacy 'VerifyValue')
      opLabel = 'Check Range';
    }
  } else if (device.type === 'CheckResults') {
    const outs = device.outcomes ?? [];
    if (device._autoVerify && outs.length === 1 && outs[0].label) {
      // Show what's being verified, e.g. "Verify (ClampLift Ext = ON)"
      const shortLabel = outs[0].label.length > 22
        ? outs[0].label.slice(0, 20) + '…'
        : outs[0].label;
      opLabel = `Verify (${shortLabel})`;
    } else {
      opLabel = device._autoVerify ? 'Verify' : 'Check';
    }
  } else {
    opLabel = action.operation;
  }

  const verifyText = buildActionVerifyText(action, device);
  const outcomes = device.type === 'CheckResults' ? (device.outcomes ?? []) : [];
  const isVisionInspect = device.type === 'VisionSystem' && (action.operation === 'Inspect' || action.operation === 'VisionInspect');
  // Vision sub-step numbers injected from Canvas.jsx
  const visionSubSteps = action.visionSubSteps ?? [];

  // Auto-scale device name font size based on name + badge length
  const nameLen = (device.displayName ?? '').length;
  const badgeLen = (opLabel ?? '').length;
  const totalLen = nameLen + badgeLen;
  const nameFontSize = totalLen <= 14 ? 13 : totalLen <= 18 ? 12 : totalLen <= 22 ? 11 : totalLen <= 28 ? 10 : 9;

  return (
    <div className="action-row-wrap">
      <div className="action-row" style={{ borderLeftColor: opColor }}>
        <span className="action-icon"><DeviceIcon type={device.type} size={14} /></span>
        <span
          className={`action-device${onClickName ? ' action-device--clickable nodrag' : ''}`}
          style={{ fontSize: nameFontSize }}
          onClick={onClickName}
        >{device.displayName}</span>
        <span className={`action-op${onClickOp ? ' action-op--clickable nodrag' : ''}`} style={{
          background: opColor,
          color: isLightBg ? '#1e3a5f' : '#fff',
          borderColor: opColor,
        }} onClick={onClickOp}>{opLabel}</span>
      </div>
      {/* Continuous mode banner */}
      {isVisionInspect && action.continuous && (
        <div className="vision-continuous-banner">
          <span className="vision-continuous-banner__icon">🔄</span>
          <span className="vision-continuous-banner__text">Continuous · loops until pass or timeout</span>
        </div>
      )}
      {verifyText && (
        <div className="action-verify">{verifyText}</div>
      )}
      {/* Offset source indicator for servo moves — click to remove */}
      {action.operation === 'ServoMove' && action.offsetSource && (
        <div className="action-offset action-offset--clickable nodrag"
          onClick={(e) => {
            e.stopPropagation();
            useDiagramStore.getState().updateAction(smId, nodeId, action.id, { offsetSource: undefined });
          }}
          title="Click to remove offset">
          <span className="action-offset__icon">📊</span>
          <span className="action-offset__text">+ offset from <strong>{action.offsetSource}</strong></span>
          <span className="action-offset__remove">✕</span>
        </div>
      )}
      {/* Conditional parameter conditions — show what makes it ON */}
      {device.type === 'Parameter' &&
       (action.operation === 'WaitOn' || action.operation === 'WaitOff') &&
       (() => {
         // For cross-SM params, look up source device to get conditions
         let srcDev = device;
         if (device.crossSmId) {
           const srcSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === device.crossSmId);
           const found = (srcSm?.devices ?? []).find(d => d.name === device.name && d.paramType === 'conditional');
           if (found) srcDev = found;
         }
         return srcDev.paramType === 'conditional' && Array.isArray(srcDev.conditions) && srcDev.conditions.length > 0;
       })() && (
        <div className="conditional-param-conditions">
          {(() => {
            let srcDev = device;
            if (device.crossSmId) {
              const srcSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === device.crossSmId);
              const found = (srcSm?.devices ?? []).find(d => d.name === device.name && d.paramType === 'conditional');
              if (found) srcDev = found;
            }
            return srcDev.conditions ?? [];
          })().map((cond, ci) => {
            let condText = '';
            const name = cond.sourceName ?? cond.deviceName ?? '?';
            if (cond.sourceType === 'servo' || cond.type === 'ServoAxis') {
              const posLabel = cond.positionName ?? (cond.field ?? '').replace('position:', '') ?? '?';
              condText = `${name} at ${posLabel} ±${cond.tolerance ?? 1}mm`;
            } else if (cond.sourceType === 'parameter' || cond.type === 'Parameter') {
              condText = `${name} = ${cond.value ?? cond.state ?? 'ON'}`;
            } else if (cond.sourceType === 'sensor' || cond.type === 'DigitalSensor') {
              condText = `${name} = ${cond.value ?? cond.state ?? 'ON'}`;
            } else if (cond.sourceType === 'partTracking' || cond.type === 'PartTracking') {
              condText = `PT: ${cond.sourceName ?? cond.fieldName ?? '?'} = ${cond.value ?? cond.state ?? 'SUCCESS'}`;
            } else {
              condText = `${name}`;
            }
            return (
              <div key={ci} className="conditional-param-cond">
                <span className="conditional-param-cond__bullet">•</span>
                <span className="conditional-param-cond__text">{condText}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* Vision sub-steps — show the 5-step sequence within the node */}
      {isVisionInspect && (
        <div className="vision-substeps">
          <div className="vision-substep">
            {visionSubSteps[0] != null && <span className="vision-substep__num">{visionSubSteps[0]}</span>}
            <span className="vision-substep__icon">✓</span>
            <span className="vision-substep__text">Verify Trigger Ready</span>
          </div>
          <div className="vision-substep">
            {visionSubSteps[1] != null && <span className="vision-substep__num">{visionSubSteps[1]}</span>}
            <span className="vision-substep__icon">⏱</span>
            <span className="vision-substep__text">Wait Timer</span>
          </div>
          <div className="vision-substep">
            {visionSubSteps[2] != null && <span className="vision-substep__num">{visionSubSteps[2]}</span>}
            <span className="vision-substep__icon">⚡</span>
            <span className="vision-substep__text">Trigger</span>
          </div>
          <div className="vision-substep">
            {visionSubSteps[3] != null && <span className="vision-substep__num">{visionSubSteps[3]}</span>}
            <span className="vision-substep__icon">🔍</span>
            <span className="vision-substep__text">Check Results</span>
          </div>
          <div className="vision-substep">
            {visionSubSteps[4] != null && <span className="vision-substep__num">{visionSubSteps[4]}</span>}
            <span className="vision-substep__icon">📋</span>
            <span className="vision-substep__text">Update PT{action.ptFieldName ? `: ${action.ptFieldName}` : ''}</span>
          </div>
          {/* Show data outputs from job definition */}
          {(() => {
            const job = (device?.jobs ?? []).find(j => j.name === action.jobName);
            const outputs = job?.numericOutputs ?? [];
            if (outputs.length === 0) return null;
            return (
              <div className="vision-outputs">
                <div className="vision-outputs__label">📊 Data Outputs:</div>
                {outputs.map((out, i) => (
                  <div key={i} className="vision-outputs__field">
                    <span className="vision-outputs__idx">R{i}</span>
                    <span className="vision-outputs__name">{out.name || '?'}</span>
                    {out.unit && <span className="vision-outputs__unit">{out.unit}</span>}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
      {/* Outcome chips for VisionInspect — only show when NOT using side-exit branches */}
      {isVisionInspect && !action.ptFieldName && (action.outcomes ?? []).length >= 2 && (
        <div className="action-outcomes">
          {(action.outcomes ?? []).map((out, i) => (
            <div key={out.id} className="outcome-chip-row">
              <span
                className="outcome-chip"
                style={{ backgroundColor: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }}
              >
                {out.label || `Branch ${i + 1}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Outcome chips for CheckResults — only show when 2+ outcomes (branching) */}
      {outcomes.length >= 2 && (
        <div className="action-outcomes">
          {outcomes.map((out, i) => {
            // Use the stored label (auto-generated by AddDeviceModal)
            let chipLabel = out.label || `Branch ${i + 1}`;
            return (
              <div key={out.id} className="outcome-chip-row">
                <span
                  className="outcome-chip"
                  style={{ backgroundColor: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }}
                >
                  {chipLabel}
                </span>
                {out.retry && (
                  <span className="retry-badge" title={`Re-try ${out.maxRetries ?? 3}× then Fault 127`}>
                    Re-try = {out.maxRetries ?? 3}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Home Position Row (for initial/home node) ────────────────────────────────

function HomeRow({ device }) {
  const typeInfo = DEVICE_TYPES[device.type] ?? {};
  const opColor = getOperationColor(device.homePosition, device.type);
  const isLightBg = opColor === '#9BC4E2' || opColor === '#e0b898' || opColor === '#dcc0a0';
  const opInfo = typeInfo.operations?.find(o => o.value === device.homePosition);
  let opLabel = opInfo?.label ?? device.homePosition;
  // For servo axes, show the home position name instead of "Move to Position"
  if (device.type === 'ServoAxis' && device._servoHomePosName) {
    opLabel = `→ ${device._servoHomePosName}`;
  }

  // Auto-scale font size
  const nameLen = (device.displayName ?? '').length;
  const badgeLen = (opLabel ?? '').length;
  const totalLen = nameLen + badgeLen;
  const nameFontSize = totalLen <= 14 ? 13 : totalLen <= 18 ? 12 : totalLen <= 22 ? 11 : totalLen <= 28 ? 10 : 9;

  return (
    <div className="action-row" style={{ borderLeftColor: opColor }}>
      <span className="action-icon"><DeviceIcon type={device.type} size={14} /></span>
      <span className="action-device" style={{ fontSize: nameFontSize }}>{device.displayName}</span>
      <span className="action-op" style={{
        background: opColor,
        color: isLightBg ? '#1e3a5f' : '#fff',
        borderColor: opColor,
      }}>{opLabel}</span>
    </div>
  );
}

// ── Inline Picker (NodeToolbar popup) ─────────────────────────────────────────

function InlinePicker({ smId, nodeId, devices, onClose, editActionId, editAction, initialStep }) {
  const store = useDiagramStore();

  // All SMs — for cross-SM param browsing
  const allSMs = store.project?.stateMachines ?? [];
  // Other SMs that have at least one GLOBAL Parameter subject
  const otherSMsWithParams = allSMs.filter(
    s => s.id !== smId && (s.devices ?? []).some(d => d.type === 'Parameter' && d.paramScope === 'global')
  );

  // Legacy: SM Outputs from other SMs (kept for rendering existing WaitSmOutput actions)
  const otherSMOutputs = allSMs
    .filter(s => s.id !== smId)
    .flatMap(s => (s.smOutputs ?? []).map(o => ({ ...o, smId: s.id, smName: s.name })));

  // step: 'device' | 'operation' | 'position' | 'cross-sm-list' | 'cross-sm-params' | 'cross-sm-op'
  //      | 'verify-input' | 'verify-route' | 'visionJob' | 'visionConfig'
  //      | 'servoIncrPick' | 'servoIncrConfig' | 'servoIndexPick' | 'servoIndexConfig' | 'setpoint'
  //      | 'tracking-field' | 'tracking-op'
  const [step, setStep] = useState(() => {
    if (initialStep && editAction) return initialStep;
    return 'device';
  });
  // Wait/Decision section collapsed by default
  const [waitExpanded, setWaitExpanded] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    if (initialStep && editAction) return editAction.deviceId;
    return null;
  });
  const [selectedOp, setSelectedOp] = useState(() => {
    if (initialStep && editAction) return editAction.operation;
    return null;
  });
  const [crossSmId, setCrossSmId] = useState(null);
  const [crossSmParam, setCrossSmParam] = useState(null);

  // Offset checkbox state for servo position picker
  const [withOffset, setWithOffset] = useState(false);
  const [selectedPosName, setSelectedPosName] = useState(null);

  // Vision flow state
  const [pickerJob, setPickerJob] = useState(null);
  const [visionContinuous, setVisionContinuous] = useState(false);
  const [visionTimeoutMs, setVisionTimeoutMs] = useState(5000);
  const [visionPtName, setVisionPtName] = useState('');
  const [visionExitCount, setVisionExitCount] = useState(2); // 1 = single exit down, 2 = pass/fail sides
  const [visionBranches, setVisionBranches] = useState([
    { id: uid(), label: 'Pass' },
    { id: uid(), label: 'Fail' },
  ]);

  // Verify route state: map of outcomeIndex → { mode: 'new' | 'loop', targetNodeId }
  const [verifyRoutes, setVerifyRoutes] = useState(new Map());

  // Current SM nodes (for loop-back targets)
  const currentSm = allSMs.find(s => s.id === smId);
  const smNodes = currentSm?.nodes ?? [];

  // Part Tracking state
  const [selectedTrackingFieldId, setSelectedTrackingFieldId] = useState(null);
  const [ptExpanded, setPtExpanded] = useState(false);
  const trackingFields = store.project?.partTracking?.fields ?? [];

  // Servo config state
  const [servoIncrDist, setServoIncrDist] = useState(1.0);
  const [servoIncrRecipe, setServoIncrRecipe] = useState(false);
  const [servoIndexStations, setServoIndexStations] = useState(6);
  const [servoIndexAngle, setServoIndexAngle] = useState(60);
  const [servoIndexRecipe, setServoIndexRecipe] = useState(false);

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  const typeInfo = selectedDevice ? DEVICE_TYPES[selectedDevice.type] : null;
  const operations = typeInfo?.operations ?? [];
  const servoPositions = selectedDevice?.positions ?? [];
  const analogSetpoints = selectedDevice?.setpoints ?? [];

  // Verify flow: build available inputs from all non-auto-verify devices
  const verifyInputs = buildAvailableInputs(
    devices.filter(d => !d._autoVerify),
    allSMs,
    smId,
    trackingFields
  );
  const verifyGroups = [...new Set(verifyInputs.map(a => a.group))];

  const crossSm = allSMs.find(s => s.id === crossSmId);
  const crossSmParams = (crossSm?.devices ?? []).filter(d => d.type === 'Parameter' && d.paramScope === 'global' && !d._autoVision);

  // ── Local device flow ──────────────────────────────────────────────────────
  function selectDevice(deviceId) {
    // Handle Part Tracking field selection — go straight to Set/Clear picker
    if (typeof deviceId === 'string' && deviceId.startsWith('_pt_')) {
      const ptName = deviceId.slice(4); // strip '_pt_' prefix
      const ptField = trackingFields.find(f => f.name === ptName);
      if (ptField) {
        setSelectedTrackingFieldId(ptField.id);
        setStep('tracking-op');
      }
      return;
    }

    setSelectedDeviceId(deviceId);
    const dev = devices.find(d => d.id === deviceId);
    const ops = DEVICE_TYPES[dev?.type]?.operations ?? [];

    // ServoAxis: skip operation step — go straight to combined moves list
    if (dev?.type === 'ServoAxis') {
      setStep('servoMoves');
      return;
    }

    // Robot: show operation picker first (Run Sequence / Set Signal / Wait Signal)
    if (dev?.type === 'Robot') {
      setStep('operation');
      return;
    }

    // AnalogSensor: show operation picker first (Check In Range / Read Value),
    // then pick setpoint. A single setpoint + single op auto-completes.
    if (dev?.type === 'AnalogSensor') {
      const analogOps = DEVICE_TYPES.AnalogSensor.operations ?? [];
      if (analogOps.length === 1) {
        setSelectedOp(analogOps[0].value);
        setStep('setpoint');
      } else {
        setStep('operation');
      }
      return;
    }

    // VisionSystem: go to job picker (skip operation since only 1)
    if (dev?.type === 'VisionSystem') {
      setStep('visionJob');
      return;
    }

    if (ops.length === 1) {
      finishAdd(deviceId, ops[0].value);
    } else {
      setStep('operation');
    }
  }

  function selectOp(opValue) {
    const dev = devices.find(d => d.id === selectedDeviceId);
    // Robot: route to the right sub-picker (sequence, set-signal, wait-signal)
    if (dev?.type === 'Robot') {
      setSelectedOp(opValue);
      if (opValue === 'RunSequence') {
        const seqs = dev.sequences ?? [];
        // Always show the picker if defaults will be used (legacy devices) so the
        // user can see what they're choosing. Only auto-commit when a real user-
        // defined single sequence exists.
        if (seqs.length === 1) {
          const actionData = { deviceId: selectedDeviceId, operation: 'RunSequence',
            sequenceNumber: seqs[0].number, sequenceName: seqs[0].name };
          store.addAction(smId, nodeId, actionData); onClose();
        } else {
          setStep('robotSequence');
        }
      } else if (opValue === 'SetOutput') {
        setStep('robotSetOutput');
      } else if (opValue === 'WaitInput') {
        setStep('robotWaitInput');
      }
      return;
    }
    // AnalogSensor: both ops (CheckRange / ReadValue) require a setpoint pick next
    if (dev?.type === 'AnalogSensor') {
      setSelectedOp(opValue);
      const setpoints = dev.setpoints ?? [];
      if (setpoints.length === 1) {
        const actionData = { deviceId: selectedDeviceId, operation: opValue, setpointName: setpoints[0].name };
        store.addAction(smId, nodeId, actionData);
        onClose();
      } else {
        setStep('setpoint');
      }
      return;
    }
    if (dev?.type === 'ServoAxis') {
      setSelectedOp(opValue);
      if (opValue === 'ServoMove') {
        const absPositions = (dev.positions ?? []).filter(p => !p.type || p.type === 'position');
        if (absPositions.length > 0) {
          setStep('position');
        } else {
          finishAdd(selectedDeviceId, opValue, null);
        }
      } else if (opValue === 'ServoIncr') {
        const incrEntries = (dev.positions ?? []).filter(p => p.type === 'incremental');
        if (incrEntries.length > 0) {
          setStep('servoIncrPick');
        } else {
          setStep('servoIncrConfig');
        }
      } else if (opValue === 'ServoIndex') {
        const indexEntries = (dev.positions ?? []).filter(p => p.type === 'index');
        if (indexEntries.length > 0) {
          setStep('servoIndexPick');
        } else {
          setStep('servoIndexConfig');
        }
      }
    } else {
      finishAdd(selectedDeviceId, opValue);
    }
  }

  function selectPosition(posName) {
    finishAdd(selectedDeviceId, selectedOp, posName);
  }

  function selectSetpoint(spName) {
    const actionData = { deviceId: selectedDeviceId, operation: selectedOp, setpointName: spName };
    store.addAction(smId, nodeId, actionData);
    onClose();
  }

  function finishAdd(deviceId, operation, positionName) {
    const actionData = { deviceId, operation };
    if (positionName !== undefined) actionData.positionName = positionName;
    if (editActionId) {
      store.updateAction(smId, nodeId, editActionId, actionData);
    } else {
      store.addAction(smId, nodeId, actionData);
    }
    onClose();
  }

  // ── Cross-SM param flow ────────────────────────────────────────────────────
  function openCrossSmFlow() {
    if (otherSMsWithParams.length === 1) {
      // Skip SM list — go straight to that SM's params
      setCrossSmId(otherSMsWithParams[0].id);
      setStep('cross-sm-params');
    } else {
      setStep('cross-sm-list');
    }
  }

  function selectCrossSmSm(id) {
    setCrossSmId(id);
    setStep('cross-sm-params');
  }

  function selectCrossSmParam(param) {
    setCrossSmParam(param);
    setStep('cross-sm-op');
  }

  function finishCrossSmAdd(operation) {
    // Find or auto-create a cross-SM Parameter device in this SM
    const freshSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === smId);
    let ref = (freshSm?.devices ?? []).find(d =>
      d.type === 'Parameter' &&
      d.paramScope === 'cross-sm' &&
      d.crossSmId === crossSmId &&
      d.name === crossSmParam.name
    );

    if (!ref) {
      // Auto-create the cross-SM reference — it won't show in Subject Library clutter
      // unless the user edits it, but it wires up the L5X correctly
      store.addDevice(smId, {
        type:        'Parameter',
        displayName: `${crossSm?.name ?? 'SM'}: ${crossSmParam.displayName}`,
        name:        crossSmParam.name,
        paramScope:  'cross-sm',
        crossSmId,
        dataType:    crossSmParam.dataType ?? 'boolean',
      });
      // Read fresh state to get the auto-generated ID
      const updated = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === smId);
      ref = (updated?.devices ?? []).find(d =>
        d.type === 'Parameter' &&
        d.paramScope === 'cross-sm' &&
        d.crossSmId === crossSmId &&
        d.name === crossSmParam.name
      );
    }

    if (ref) {
      if (editActionId) {
        store.updateAction(smId, nodeId, editActionId, { deviceId: ref.id, operation });
      } else {
        store.addAction(smId, nodeId, { deviceId: ref.id, operation });
      }
    }
    onClose();
  }

  // ── Reference Position handler ─────────────────────────────────────────
  function handleWaitRefPos(rp) {
    store.addAction(smId, nodeId, {
      operation: 'WaitRefPos',
      refPosId: rp.id,
      refPosName: rp.name,
    });
    onClose();
  }

  // ── SM Output handler ──────────────────────────────────────────────────
  function handleWaitSmOutput(out) {
    store.addAction(smId, nodeId, {
      operation: 'WaitSmOutput',
      outputSmId: out.smId,
      outputSmName: out.smName,
      outputId: out.id,
      outputName: out.name,
    });
    onClose();
  }

  // ── Verify flow (multi-select with ON/OFF) ─────────────────────────────
  // Map keyed by "inputRef:condition" → { condition, label, inp }
  // This allows selecting BOTH ON and OFF for the same input (two branches)
  const [verifySelections, setVerifySelections] = useState(new Map());

  function toggleVerifyInput(inp, condition) {
    const key = `${inp.ref}:${condition}`;
    setVerifySelections(prev => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const condLabel = condition === 'inRange' ? 'In Range'
          : condition === 'outOfRange' ? 'Out of Range'
          : condition === 'off' ? 'OFF' : 'ON';
        next.set(key, {
          ref: inp.ref,
          condition,
          label: `${inp.label} = ${condLabel}`,
          inp,
        });
      }
      return next;
    });
  }

  function isVerifySelected(inputRef, condition) {
    return verifySelections.has(`${inputRef}:${condition}`);
  }

  /** After conditions selected, derive verify name and go to routing step (or finish if single condition) */
  function handleVerifyConditionsDone() {
    // 1. Add all conditions to the verify device
    for (const [, sel] of verifySelections) {
      store.addVerifyCondition(smId, nodeId, sel.ref, sel.condition, sel.label);
    }

    // 2. Derive a meaningful name from the conditions (strip " = ON/OFF" suffix)
    const subjectNames = [...new Set(
      [...verifySelections.values()].map(sel => {
        // "Pass_LocateStamp (Stamper) = ON" → "Pass_LocateStamp (Stamper)"
        return sel.label.replace(/\s*=\s*(ON|OFF|In Range|Out of Range)$/i, '').trim();
      })
    )];
    const verifyName = subjectNames.length <= 2 ? subjectNames.join(' / ') : subjectNames[0] + ' +' + (subjectNames.length - 1);

    // Update the verify device's displayName
    const freshSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === smId);
    const freshNode = freshSm?.nodes?.find(n => n.id === nodeId);
    if (freshNode) {
      const verifyAction = (freshNode.data?.actions ?? []).find(a => {
        const dev = (freshSm?.devices ?? []).find(d => d.id === a.deviceId);
        return dev?.type === 'CheckResults' && dev._autoVerify;
      });
      if (verifyAction) {
        store.updateDevice(smId, verifyAction.deviceId, { displayName: verifyName, name: verifyName.replace(/[^a-zA-Z0-9]/g, '') });
        const device = freshSm.devices.find(d => d.id === verifyAction.deviceId);
        const outcomes = device?.outcomes ?? [];

        // If 2+ outcomes (branching), show routing step
        const existingEdges = (freshSm.edges ?? []).filter(e => e.source === nodeId);
        const usedOutcomeIds = new Set(
          existingEdges.filter(e => e.data?.conditionType === 'checkResult').map(e => e.data?.outcomeId)
        );
        const missingOutcomes = outcomes.filter(o => !usedOutcomeIds.has(o.id));

        if (missingOutcomes.length >= 2) {
          // Initialize routes: first = new step, rest = new step by default
          const initRoutes = new Map();
          missingOutcomes.forEach((o, i) => {
            initRoutes.set(outcomes.indexOf(o), { mode: 'new', targetNodeId: null });
          });
          setVerifyRoutes(initRoutes);
          setStep('verify-route');
          return;
        }
      }
    }

    // Single condition or no branching: auto-create and finish
    handleVerifyFinish();
  }

  /** Final step: create branch nodes/edges based on routing choices */
  function handleVerifyFinish() {
    const freshSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === smId);
    const freshNode = freshSm?.nodes?.find(n => n.id === nodeId);
    if (freshNode) {
      const verifyAction = (freshNode.data?.actions ?? []).find(a => {
        const dev = (freshSm?.devices ?? []).find(d => d.id === a.deviceId);
        return dev?.type === 'CheckResults' && dev._autoVerify;
      });
      if (verifyAction) {
        const device = freshSm.devices.find(d => d.id === verifyAction.deviceId);
        const outcomes = device?.outcomes ?? [];

        if (outcomes.length >= 2) {
          const existingEdges = (freshSm.edges ?? []).filter(e => e.source === nodeId);
          const usedOutcomeIds = new Set(
            existingEdges.filter(e => e.data?.conditionType === 'checkResult').map(e => e.data?.outcomeId)
          );
          const missingOutcomes = outcomes.filter(o => !usedOutcomeIds.has(o.id));

          if (missingOutcomes.length > 0) {
            const sourcePos = freshNode.position;
            const hSpacing = 220;
            const vDrop = 180;
            const total = outcomes.length;

            for (const outcome of missingOutcomes) {
              const idx = outcomes.indexOf(outcome);
              const route = verifyRoutes.get(idx) ?? { mode: 'new', targetNodeId: null };
              const edgeLabel = outcome.label || `Branch ${idx + 1}`;

              let targetId;
              if (route.mode === 'loop' && route.targetNodeId) {
                // Loop back to existing node
                targetId = route.targetNodeId;
              } else {
                // Create new step node
                const startX = sourcePos.x - ((total - 1) * hSpacing) / 2;
                const nodeX = startX + idx * hSpacing;
                const nodeY = sourcePos.y + vDrop;
                targetId = store.addNode(smId, { position: { x: nodeX, y: nodeY } });
              }

              if (targetId) {
                store.addEdge(smId, {
                  source: nodeId,
                  sourceHandle: null,
                  target: targetId,
                  targetHandle: null,
                }, {
                  conditionType: 'checkResult',
                  deviceId: device.id,
                  outcomeId: outcome.id,
                  outcomeLabel: edgeLabel,
                  outcomeIndex: idx,
                  label: edgeLabel,
                  inputRef: outcome.inputRef,
                  condition: outcome.condition,
                });
              }
            }
          }
        }
      }
    }

    setVerifySelections(new Map());
    setVerifyRoutes(new Map());
    onClose();
  }

  // ── Vision Done handler (auto-create side-exit branch nodes + edges) ──────
  function handleVisionDone() {
    // Guard: prevent duplicate VisionInspect actions if clicked twice
    const currentNode = useDiagramStore.getState().project?.stateMachines
      ?.find(s => s.id === smId)?.nodes?.find(n => n.id === nodeId);
    const alreadyHasVision = (currentNode?.data?.actions ?? []).some(
      a => a.operation === 'VisionInspect' && a.deviceId === selectedDeviceId && a.jobName === pickerJob
    );
    if (alreadyHasVision) { onClose(); return; }

    const ptName = visionPtName || pickerJob || 'VisionJob';

    // 1. Add the VisionInspect action (stores exit mode + PT field name)
    const actionData = {
      deviceId: selectedDeviceId,
      operation: 'VisionInspect',
      jobName: pickerJob,
      continuous: visionContinuous,
      continuousTimeoutMs: visionContinuous ? visionTimeoutMs : undefined,
      faultStep: visionContinuous ? 127 : undefined,
      ptFieldName: ptName,
      outcomes: [
        { id: visionBranches[0]?.id || uid(), label: 'Pass' },
        { id: visionBranches[1]?.id || uid(), label: 'Fail' },
      ],
    };
    store.addAction(smId, nodeId, actionData);

    // 2. Set visionExitMode on node data so handles render correctly
    store.updateNodeData(smId, nodeId, {
      visionExitMode: visionExitCount === 2 ? '2-node' : '1-node',
    });

    // 3. Auto-create Part Tracking field for this vision job (idempotent)
    const ptFields = useDiagramStore.getState().project?.partTracking?.fields ?? [];
    const ptExists = ptFields.some(f => f.name === ptName);
    if (!ptExists) {
      store.addTrackingField({
        name: ptName,
        type: 'boolean',
        description: `Vision job result — auto-linked from ${devices.find(d => d.id === selectedDeviceId)?.displayName ?? 'camera'}`,
        _visionLinked: true,
        _visionDeviceId: selectedDeviceId,
      });
    }

    // 4. Create branch nodes using side-exit store functions
    if (visionExitCount === 2) {
      store.addVisionBranches(smId, nodeId, `Pass_${pickerJob}`, `Fail_${pickerJob}`, ptName);
    } else {
      store.addVisionSingleBranch(smId, nodeId, `Next_${pickerJob}`, ptName);
    }

    onClose();
  }

  // ── Signal pick handler ────────────────────────────────────────────────────
  // When a signal is clicked: if current node is empty → replace with DecisionNode,
  // else → add a DecisionNode below this node and connect it.
  function handleSignalPick(signal) {
    const freshSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === smId);
    const currentNode = freshSm?.nodes?.find(n => n.id === nodeId);
    if (!currentNode) { onClose(); return; }

    // FIX 5: robust empty check — handles undefined/null/empty actions
    const isEmpty = !currentNode.data?.actions || currentNode.data.actions.length === 0;
    console.log('[handleSignalPick] nodeId:', nodeId, 'isEmpty:', isEmpty, 'actions:', currentNode.data?.actions);

    // Support both old-style signals (name/type) and new vision signals (signalName/signalType/signalSource)
    const resolvedSignalName = signal.signalName ?? signal.name ?? 'Signal';
    // FIX 8: store signalSource (camera/device name) separately from signalName (job name)
    const resolvedSignalSource = signal.signalSource ?? null;
    const resolvedSignalType = signal.signalType ?? signal.type ?? 'signal';
    const resolvedSignalSmName = signal.signalSmName ?? signal.smName ?? null;
    // FIX 2: use job name in exit labels for vision signals (Pass_JobName / Fail_JobName)
    const isVisionSig = resolvedSignalType === 'visionJob';
    const exit1Label = isVisionSig ? `Pass_${resolvedSignalName}` : 'True';
    const exit2Label = isVisionSig ? `Fail_${resolvedSignalName}` : 'False';
    const decisionData = {
      signalId: signal.id,
      signalName: resolvedSignalName,
      signalSource: resolvedSignalSource,
      signalType: resolvedSignalType,
      signalSmName: resolvedSignalSmName,
      decisionType: signal.decisionType ?? 'signal',
      exitCount: 2,
      exit1Label,
      exit2Label,
      updatePartTracking: false,
      autoOpenPopup: true,
    };

    if (isEmpty) {
      // Replace this state node with a DecisionNode at the same position
      store.replaceNodeWithDecision(smId, nodeId, decisionData);
    } else {
      // Add a DecisionNode below this node and connect it
      // StateNode renders ~300px wide; DecisionNode is 240px
      const decisionId = uid();
      // Center decision node (240px) under parent node
      const parentWidth = currentNode.measured?.width ?? currentNode.width ?? 240;
      const decWidth = 240;
      const decX = currentNode.position.x + (parentWidth - decWidth) / 2;
      store.addDecisionNode(smId, {
        id: decisionId,
        position: {
          x: decX,
          y: currentNode.position.y + 200,
        },
        data: {
          label: 'Decision',
          decisionType: 'signal',
          ...decisionData,
        },
      });
      store.addEdge(smId, {
        source: nodeId,
        sourceHandle: null,
        target: decisionId,
        targetHandle: 'input',
      }, { conditionType: 'ready', label: '' });
    }
    onClose();
  }

  // Block wheel events from reaching React Flow and manually scroll the picker
  // (React Flow calls preventDefault on wheel events, blocking native scroll)
  const pickerRef = useCallback(node => {
    if (!node) return;
    node.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      node.scrollTop -= e.deltaY;
    }, { passive: false });
  }, []);

  // Same wheel-capture for the verify popup scroll area
  const verifyScrollRef = useCallback(node => {
    if (!node) return;
    node.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      node.scrollTop -= e.deltaY;
    }, { passive: false });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="inline-picker" ref={pickerRef}>

      {/* ── Step 1: device list ──────────────────────────────────────────── */}
      {step === 'device' && (
        <>
          <div className="inline-picker__title">{editActionId ? 'Change Subject' : 'Select Subject'}</div>

          {/* Cycle Complete card */}
          <button
            className="inline-picker__item inline-picker__item--complete"
            onClick={() => {
              store.updateNodeData(smId, nodeId, { isComplete: true, isFault: false, actions: [] });
              onClose();
            }}
            style={{ borderLeft: '3px solid #5a9a48', fontWeight: 600 }}
          >
            <span style={{ fontSize: 16, color: '#5a9a48' }}>●</span>
            <span>Cycle Complete</span>
          </button>

          {/* Fault State card */}
          <button
            className="inline-picker__item"
            onClick={() => {
              store.updateNodeData(smId, nodeId, { isFault: true, isComplete: false, actions: [] });
              onClose();
            }}
            style={{ borderLeft: '3px solid #dc2626', fontWeight: 600 }}
          >
            <span style={{ fontSize: 16, color: '#dc2626' }}>⚠</span>
            <span style={{ color: '#dc2626' }}>Fault State</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>Step 127</span>
          </button>

          {/* WAIT / DECISION section — collapsed by default, expand on click */}
          {(() => {
            // Build vision signals from all SMs
            const visionSignals = [];
            for (const sm of allSMs) {
              for (const device of (sm.devices ?? [])) {
                if (device.type !== 'VisionSystem') continue;
                for (const job of (device.jobs ?? [])) {
                  visionSignals.push({
                    id: `vision_${sm.id}_${device.id}_${job.name}`,
                    label: job.name,
                    sublabel: device.name,
                    smLabel: sm.name,
                    decisionType: 'signal',
                    // FIX 8: store only job name and source separately
                    signalName: job.name,
                    signalSource: device.name,
                    signalType: 'visionJob',
                    signalSmName: sm.name,
                    outcomes: job.outcomes ?? ['Pass', 'Fail'],
                  });
                }
              }
            }

            const projectSignals = store.project?.signals ?? [];
            const typeBadgeMap = {
              position:  { label: 'POS',   color: '#fcd34d', bg: '#78350f' },
              state:     { label: 'STATE', color: '#93c5fd', bg: '#1e3a5f' },
              condition: { label: 'COND',  color: '#d1d5db', bg: '#1f2937' },
            };

            return (
              <>
                <div className="inline-picker__divider" />
                {/* Wait / Decision — immediately creates decision node with popup */}
                <button
                  className="inline-picker__item"
                  style={{ borderLeft: '3px solid #f59e0b', fontWeight: 700, color: '#f59e0b' }}
                  onClick={() => {
                    // Create an empty decision node with autoOpenPopup so the popup opens immediately
                    handleSignalPick({
                      id: null,
                      signalName: 'Select Signal...',
                      signalSource: null,
                      signalType: null,
                      signalSmName: null,
                      decisionType: 'signal',
                      type: null,
                    });
                  }}
                >
                  <span style={{ fontSize: 14 }}>&#x2B23;</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>Wait / Decision / Verify</span>
                </button>
              </>
            );
          })()}

          <div className="inline-picker__divider" />

          {devices.filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId && d.type !== 'Parameter').length === 0 && (
            <div className="inline-picker__empty">No subjects yet. Add one in the sidebar.</div>
          )}
          {devices.filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId && d.type !== 'Parameter').map(d => {
            const isCurrent = editAction && d.id === editAction.deviceId;
            return (
              <button key={d.id}
                className={`inline-picker__item${isCurrent ? ' inline-picker__item--current' : ''}`}
                onClick={() => selectDevice(d.id)}>
                <DeviceIcon type={d.type} size={16} />
                <span>{d.displayName}</span>
                {isCurrent && <span className="inline-picker__current-badge">current</span>}
              </button>
            );
          })}

          {/* Reference Positions removed — use DecisionNode instead */}

          {/* SM Outputs removed — use DecisionNode instead */}

          {/* Cross-SM separator — only shown if other SMs have parameters */}
          {otherSMsWithParams.length > 0 && (
            <>
              <div className="inline-picker__divider" />
              <button className="inline-picker__item inline-picker__item--cross-sm" onClick={openCrossSmFlow}>
                <span className="inline-picker__cross-sm-icon">⤴</span>
                <span>Param from other SM…</span>
              </button>
            </>
          )}

          {/* Part Tracking — collapsible, only show if tracking fields exist */}
          {trackingFields.length > 0 && (
            <>
              <div className="inline-picker__divider" />
              <button
                className="inline-picker__item"
                style={{ borderLeft: '3px solid #6366f1', fontWeight: 600, color: '#6366f1', fontSize: 11 }}
                onClick={() => setPtExpanded(prev => !prev)}
              >
                <span style={{ fontSize: 14 }}>📋</span>
                <span style={{ flex: 1, textAlign: 'left' }}>Part Tracking</span>
                <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>{ptExpanded ? '▲' : '▼'}</span>
              </button>
              {ptExpanded && trackingFields.map(f => (
                <button key={f.id} className="inline-picker__item" onClick={() => {
                  setSelectedTrackingFieldId(f.id);
                  setStep('tracking-op');
                }}
                  style={{ paddingLeft: 24, borderLeft: '3px solid #6366f1' }}
                >
                  <span style={{ fontSize: 12 }}>📋</span>
                  <span>{f.name}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>{f.type === 'real' ? 'REAL' : 'BOOL'}</span>
                </button>
              ))}
            </>
          )}

          {/* Advanced section - Parameters */}
          {devices.filter(d => d.type === 'Parameter' && !d._autoVerify && !d._autoVision && !d.crossSmId).length > 0 && (
            <>
              <div className="inline-picker__divider" />
              <div className="inline-picker__group-label" style={{ color: '#9ca3af' }}>Advanced</div>
              {devices.filter(d => d.type === 'Parameter' && !d._autoVerify && !d._autoVision && !d.crossSmId).map(d => (
                <button key={d.id} className="inline-picker__item" onClick={() => selectDevice(d.id)}>
                  <DeviceIcon type={d.type} size={16} />
                  <span>{d.displayName}</span>
                </button>
              ))}
            </>
          )}
        </>
      )}

      {/* ── Step 2a: choose SM (only when 2+ SMs have params) ───────────── */}
      {step === 'cross-sm-list' && (
        <>
          <div className="inline-picker__title">Choose State Machine</div>
          {otherSMsWithParams.map(s => (
            <button key={s.id} className="inline-picker__item" onClick={() => selectCrossSmSm(s.id)}>
              <span className="inline-picker__sm-badge">SM</span>
              <span>{s.name}</span>
            </button>
          ))}
          <button className="inline-picker__back" onClick={() => setStep('device')}>← Back</button>
        </>
      )}

      {/* ── Step 2b: choose parameter from the selected SM ───────────────── */}
      {step === 'cross-sm-params' && crossSm && (
        <>
          <div className="inline-picker__title">{crossSm.name}</div>
          {crossSmParams.length === 0 && (
            <div className="inline-picker__empty">No global parameters in this SM.</div>
          )}
          {crossSmParams.map(p => (
            <button key={p.id} className="inline-picker__item" onClick={() => selectCrossSmParam(p)}>
              <DeviceIcon type="Parameter" size={16} />
              <span>{p.displayName}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>
                {p.dataType === 'numeric' ? 'REAL' : 'BOOL'}
              </span>
            </button>
          ))}
          <button className="inline-picker__back"
            onClick={() => setStep(otherSMsWithParams.length === 1 ? 'device' : 'cross-sm-list')}
          >← Back</button>
        </>
      )}

      {/* ── Step 3: choose Wait ON / Wait OFF ───────────────────────────── */}
      {step === 'cross-sm-op' && crossSmParam && (
        <>
          <div className="inline-picker__title">{crossSmParam.displayName}</div>
          <div className="inline-picker__hint">from {crossSm?.name}</div>
          <button className="inline-picker__item" onClick={() => finishCrossSmAdd('WaitOn')}>
            Wait ON
          </button>
          <button className="inline-picker__item" onClick={() => finishCrossSmAdd('WaitOff')}>
            Wait OFF
          </button>
          <button className="inline-picker__back" onClick={() => setStep('cross-sm-params')}>← Back</button>
        </>
      )}

      {/* ── Tracking field picker ────────────────────────────────────────── */}
      {step === 'tracking-field' && (
        <>
          <div className="inline-picker__title">Select Tracking Field</div>
          {trackingFields.map(f => (
            <button key={f.id} className="inline-picker__item" onClick={() => {
              setSelectedTrackingFieldId(f.id);
              setStep('tracking-op');
            }}>
              <span style={{ fontSize: 14 }}>&#x1F4CB;</span>
              <span>{f.name}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>BOOL</span>
            </button>
          ))}
          <button className="inline-picker__back" onClick={() => setStep('device')}>← Back</button>
        </>
      )}

      {/* ── Tracking Operations (Wait / Set) ────────────────────────────── */}
      {step === 'tracking-op' && (() => {
        const tf = trackingFields.find(f => f.id === selectedTrackingFieldId);
        const tfName = tf?.name ?? 'Field';
        function addTrackAction(op) {
          store.addAction(smId, nodeId, {
            deviceId: '_tracking',
            operation: op,
            trackingFieldId: selectedTrackingFieldId,
            trackingFieldName: tfName,
          });
          onClose();
        }
        return (
          <>
            <div className="inline-picker__title">PT: {tfName}</div>
            <div style={{ fontSize: 10, color: '#6b7280', padding: '0 8px 6px', fontWeight: 600, textTransform: 'uppercase' }}>Wait (condition to advance)</div>
            <button className="inline-picker__item" onClick={() => addTrackAction('TrackWaitOn')}
              style={{ borderLeft: '3px solid #1574c4' }}>
              <span>WaitOn</span>
              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>advance when SUCCESS</span>
            </button>
            <button className="inline-picker__item" onClick={() => addTrackAction('TrackWaitOff')}
              style={{ borderLeft: '3px solid #aacee8' }}>
              <span>WaitOff</span>
              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>advance when FAILURE</span>
            </button>
            <div className="inline-picker__divider" />
            <div style={{ fontSize: 10, color: '#6b7280', padding: '0 8px 6px', fontWeight: 600, textTransform: 'uppercase' }}>Set (write value)</div>
            <button className="inline-picker__item" onClick={() => addTrackAction('TrackSet')}
              style={{ borderLeft: '3px solid #74c415' }}>
              <span>Set SUCCESS</span>
              <span style={{ fontSize: 11, color: '#74c415', marginLeft: 'auto' }}>&#x2713;</span>
            </button>
            <button className="inline-picker__item" onClick={() => addTrackAction('TrackClear')}
              style={{ borderLeft: '3px solid #fa5650' }}>
              <span>Set FAILURE</span>
              <span style={{ fontSize: 11, color: '#fa5650', marginLeft: 'auto' }}>&#x2717;</span>
            </button>
            <button className="inline-picker__back" onClick={() => setStep('tracking-field')}>← Back</button>
          </>
        );
      })()}

      {/* ── Local operation step ─────────────────────────────────────────── */}
      {step === 'operation' && selectedDevice && (
        <>
          <div className="inline-picker__title">{selectedDevice.displayName}</div>
          {operations.map(op => (
            <button key={op.value} className="inline-picker__item" onClick={() => selectOp(op.value)}>
              {op.label}
            </button>
          ))}
          <button className="inline-picker__back" onClick={() => { setStep('device'); setSelectedDeviceId(null); }}>
            ← Back
          </button>
        </>
      )}

      {/* ── Combined servo moves step (positions + incremental + index) ── */}
      {step === 'servoMoves' && selectedDevice && (() => {
        const allPos = selectedDevice.positions ?? [];
        const absPositions = allPos.filter(p => !p.type || p.type === 'position');
        const incrEntries = allPos.filter(p => p.type === 'incremental');
        const indexEntries = allPos.filter(p => p.type === 'index');
        const ptFields = store.project?.partTracking?.fields ?? [];
        const realFields = ptFields.filter(f => f.type === 'real');
        const hasOffsetFields = realFields.length > 0;
        return (
          <>
            <div className="inline-picker__title">{selectedDevice.displayName}</div>
            {absPositions.length === 0 && incrEntries.length === 0 && indexEntries.length === 0 && (
              <div className="inline-picker__empty">
                No moves defined — edit this servo in the Subject Library to add them.
              </div>
            )}
            {absPositions.map(p => (
              <button key={p.name} className="inline-picker__item inline-picker__item--position"
                onClick={() => {
                  setSelectedOp('ServoMove');
                  if (withOffset && hasOffsetFields) {
                    setSelectedPosName(p.name);
                    setStep('offset');
                  } else {
                    finishAdd(selectedDeviceId, 'ServoMove', p.name);
                  }
                }}>
                <span className="inline-picker__pos-name">→ {p.name}</span>
                <span className="inline-picker__pos-value">{Number(p.defaultValue ?? 0).toFixed(1)}</span>
              </button>
            ))}
            {incrEntries.map(p => (
              <button key={p.name} className="inline-picker__item"
                style={{ borderLeft: '3px solid #befa4f' }}
                onClick={() => {
                  const actionData = { deviceId: selectedDeviceId, operation: 'ServoIncr', positionName: p.name, incrementDist: p.defaultValue ?? 1.0 };
                  if (editActionId) {
                    store.updateAction(smId, nodeId, editActionId, actionData);
                  } else {
                    store.addAction(smId, nodeId, actionData);
                  }
                  onClose();
                }}>
                <span>↔ {p.name}</span>
                <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 10 }}>{Number(p.defaultValue ?? 0).toFixed(1)}</span>
              </button>
            ))}
            {indexEntries.map(p => (
              <button key={p.name} className="inline-picker__item"
                style={{ borderLeft: '3px solid #aacee8' }}
                onClick={() => {
                  const stations = p.indexStations ?? 6;
                  const angle = p.indexAngle ?? (stations > 0 ? Math.round((360 / stations) * 100) / 100 : 60);
                  const actionData = { deviceId: selectedDeviceId, operation: 'ServoIndex', positionName: p.name, indexStations: stations, indexAngle: angle };
                  if (editActionId) {
                    store.updateAction(smId, nodeId, editActionId, actionData);
                  } else {
                    store.addAction(smId, nodeId, actionData);
                  }
                  onClose();
                }}>
                <span>⟳ {p.name}</span>
                <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 10 }}>{p.indexStations ?? 6}-pos</span>
              </button>
            ))}
            {hasOffsetFields && (
              <label className="inline-picker__offset-check nodrag" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={withOffset}
                  onChange={e => setWithOffset(e.target.checked)} />
                <span>📊 Apply vision offset</span>
              </label>
            )}
            <button className="inline-picker__back" onClick={() => { setStep('device'); setSelectedDeviceId(null); }}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── Servo position step (absolute positions only — legacy/from operation) ── */}
      {step === 'position' && selectedDevice && (() => {
        const absPositions = servoPositions.filter(p => !p.type || p.type === 'position');
        const ptFields = store.project?.partTracking?.fields ?? [];
        const realFields = ptFields.filter(f => f.type === 'real');
        const hasOffsetFields = realFields.length > 0;
        return (
          <>
            <div className="inline-picker__title">{selectedDevice.displayName}: Move To</div>
            {absPositions.length === 0 && (
              <div className="inline-picker__empty">
                No positions defined — edit this servo in the Subject Library to add them.
              </div>
            )}
            {absPositions.map(p => (
              <button key={p.name} className="inline-picker__item inline-picker__item--position"
                onClick={() => {
                  if (withOffset && hasOffsetFields) {
                    setSelectedPosName(p.name);
                    setStep('offset');
                  } else {
                    selectPosition(p.name);
                  }
                }}>
                <span className="inline-picker__pos-name">{p.name}</span>
                <span className="inline-picker__pos-value">{Number(p.defaultValue ?? 0).toFixed(1)}</span>
              </button>
            ))}
            {hasOffsetFields && (
              <label className="inline-picker__offset-check nodrag" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={withOffset}
                  onChange={e => setWithOffset(e.target.checked)} />
                <span>📊 Apply vision offset</span>
              </label>
            )}
            <button className="inline-picker__back" onClick={() => { setStep('servoMoves'); }}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── Offset picker step (only when checkbox enabled) ──────────── */}
      {step === 'offset' && (() => {
        const ptFields = store.project?.partTracking?.fields ?? [];
        const realFields = ptFields.filter(f => f.type === 'real');
        return (
          <>
            <div className="inline-picker__title">Offset for: {selectedPosName}</div>
            <div style={{ fontSize: 10, color: '#64748b', padding: '0 8px 4px' }}>
              Select a vision data field to use as offset.
            </div>
            {realFields.map(f => (
              <button key={f.name} className="inline-picker__item"
                style={{ color: '#1d4ed8', fontWeight: 600 }}
                onClick={() => {
                  const actionData = { deviceId: selectedDeviceId, operation: selectedOp, positionName: selectedPosName, offsetSource: f.name };
                  if (editActionId) {
                    store.updateAction(smId, nodeId, editActionId, actionData);
                  } else {
                    store.addAction(smId, nodeId, actionData);
                  }
                  onClose();
                }}>
                <span>📊</span>
                <span>{f.name}</span>
                {f.unit && <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>({f.unit})</span>}
              </button>
            ))}
            <button className="inline-picker__back" onClick={() => setStep('servoMoves')}>
              ← Back
            </button>
          </>
        );
      })()}


      {/* ── Verify: multi-select input picker with ON/OFF ─────────────── */}
      {step === 'verify-input' && (
        <>
          <div className="inline-picker__title">Verify / Branch</div>
          <div className="inline-picker__hint" style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 4px' }}>
            Select ON or OFF for each input — can pick both for 2 branches
          </div>
          {/* Scrollable list area */}
          <div className="verify-scroll-area" ref={verifyScrollRef}>
            {verifyInputs.length === 0 && (
              <div className="inline-picker__empty">No checkable inputs. Add devices with sensors first.</div>
            )}
            {verifyGroups.map(groupName => (
              <div key={groupName}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', padding: '6px 8px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {groupName}
                </div>
                {verifyInputs.filter(a => a.group === groupName).map(inp => {
                  const isRange = inp.inputType === 'range';
                  const isTracking = inp.ref.startsWith('_tracking:');
                  const onLabel = isRange ? 'In Rng' : isTracking ? 'SUCCESS' : 'ON';
                  const offLabel = isRange ? 'Out' : isTracking ? 'FAILURE' : 'OFF';
                  const onCond = isRange ? 'inRange' : 'on';
                  const offCond = isRange ? 'outOfRange' : 'off';
                  return (
                    <div key={inp.ref} className="verify-input-row">
                      <span className="verify-input-row__label" title={inp.tag}>{inp.label}</span>
                      <button
                        className={`verify-input-row__btn${isVerifySelected(inp.ref, onCond) ? ' verify-input-row__btn--selected' : ''}`}
                        onClick={() => toggleVerifyInput(inp, onCond)}
                      >{onLabel}</button>
                      <button
                        className={`verify-input-row__btn${isVerifySelected(inp.ref, offCond) ? ' verify-input-row__btn--selected' : ''}`}
                        onClick={() => toggleVerifyInput(inp, offCond)}
                      >{offLabel}</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {/* Fixed footer */}
          {verifySelections.size > 0 && (
            <div className="verify-status-bar">✓ {verifySelections.size} condition{verifySelections.size !== 1 ? 's' : ''} selected</div>
          )}
          <div className="verify-done-row">
            <button className="inline-picker__back" onClick={() => { setVerifySelections(new Map()); setStep('device'); }}>← Back</button>
            <button
              className="verify-done-btn"
              disabled={verifySelections.size === 0}
              onClick={handleVerifyConditionsDone}
            >✓ Done</button>
          </div>
        </>
      )}

      {/* ── Verify: route each branch (new step or loop back) ─────────── */}
      {step === 'verify-route' && (() => {
        const freshSm = useDiagramStore.getState().project?.stateMachines?.find(s => s.id === smId);
        const freshNode = freshSm?.nodes?.find(n => n.id === nodeId);
        const verifyAction = (freshNode?.data?.actions ?? []).find(a => {
          const dev = (freshSm?.devices ?? []).find(d => d.id === a.deviceId);
          return dev?.type === 'CheckResults' && dev._autoVerify;
        });
        const device = verifyAction ? freshSm.devices.find(d => d.id === verifyAction.deviceId) : null;
        const outcomes = device?.outcomes ?? [];
        const existingEdges = (freshSm?.edges ?? []).filter(e => e.source === nodeId);
        const usedOutcomeIds = new Set(
          existingEdges.filter(e => e.data?.conditionType === 'checkResult').map(e => e.data?.outcomeId)
        );
        const missingOutcomes = outcomes.filter(o => !usedOutcomeIds.has(o.id));

        // Compute state numbers via DFS (same algorithm as Canvas.jsx)
        const allNodes = freshSm?.nodes ?? [];
        const allEdges = freshSm?.edges ?? [];
        const allDevices = freshSm?.devices ?? [];
        const stateNums = new Map();
        const visited = new Set();
        const dfsOrder = [];
        const initialNode = allNodes.find(n => !allEdges.some(e => e.target === n.id));
        if (initialNode) {
          const stack = [initialNode.id];
          while (stack.length > 0) {
            const nid = stack.pop();
            if (visited.has(nid)) continue;
            visited.add(nid);
            dfsOrder.push(nid);
            const outEdges = allEdges.filter(e => e.source === nid);
            const targets = outEdges.map(e => allNodes.find(n => n.id === e.target)).filter(Boolean);
            targets.sort((a, b) => (b.position?.x ?? 0) - (a.position?.x ?? 0));
            for (const t of targets) stack.push(t.id);
          }
        }
        let curState = 1;
        for (const nid of dfsOrder) {
          stateNums.set(nid, curState);
          const nd = allNodes.find(n => n.id === nid);
          const acts = nd?.data?.actions ?? [];
          const isVision = acts.some(a => a.operation === 'VisionInspect' || a.operation === 'Inspect');
          curState += isVision ? 12 : 3;
        }
        // For unvisited nodes, assign remaining numbers
        for (const n of allNodes) {
          if (!stateNums.has(n.id)) { stateNums.set(n.id, curState); curState += 3; }
        }

        // Build loop-back targets with state numbers and action descriptions
        const loopTargets = allNodes
          .filter(n => n.id !== nodeId)
          .map(n => {
            const acts = n.data?.actions ?? [];
            const firstAct = acts[0];
            const dev = firstAct ? allDevices.find(d => d.id === firstAct.deviceId) : null;
            const desc = dev ? `${dev.displayName} ${firstAct.operation ?? ''}`.trim() : (n.data?.label ?? 'Step');
            return { id: n.id, stateNumber: stateNums.get(n.id) ?? '?', desc };
          })
          .sort((a, b) => (a.stateNumber ?? 0) - (b.stateNumber ?? 0));

        return (
          <>
            <div className="inline-picker__title">Route Branches</div>
            <div className="inline-picker__hint" style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 6px' }}>
              Choose where each branch goes
            </div>
            {missingOutcomes.map(outcome => {
              const idx = outcomes.indexOf(outcome);
              const route = verifyRoutes.get(idx) ?? { mode: 'new', targetNodeId: null };
              return (
                <div key={outcome.id} style={{ padding: '4px 8px 6px', borderBottom: '1px solid #374151' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb', marginBottom: 4 }}>
                    {outcome.label || `Branch ${idx + 1}`}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className={`verify-input-row__btn${route.mode === 'new' ? ' verify-input-row__btn--selected' : ''}`}
                      onClick={() => setVerifyRoutes(prev => {
                        const next = new Map(prev);
                        next.set(idx, { mode: 'new', targetNodeId: null });
                        return next;
                      })}
                      style={{ flex: 1, fontSize: 10 }}
                    >→ New Step</button>
                    <button
                      className={`verify-input-row__btn${route.mode === 'loop' ? ' verify-input-row__btn--selected' : ''}`}
                      onClick={() => setVerifyRoutes(prev => {
                        const next = new Map(prev);
                        next.set(idx, { mode: 'loop', targetNodeId: loopTargets[0]?.id ?? null });
                        return next;
                      })}
                      style={{ flex: 1, fontSize: 10 }}
                    >↩ Loop Back</button>
                  </div>
                  {route.mode === 'loop' && (
                    <select
                      value={route.targetNodeId || ''}
                      onChange={e => setVerifyRoutes(prev => {
                        const next = new Map(prev);
                        next.set(idx, { mode: 'loop', targetNodeId: e.target.value });
                        return next;
                      })}
                      style={{
                        width: '100%', marginTop: 4, padding: '3px 4px', fontSize: 10,
                        background: '#1f2937', color: '#e5e7eb', border: '1px solid #4b5563',
                        borderRadius: 4,
                      }}
                    >
                      <option value={nodeId}>↩ State {stateNums.get(nodeId) ?? '?'}: This step (retry)</option>
                      {loopTargets.map(t => (
                        <option key={t.id} value={t.id}>State {t.stateNumber}: {t.desc}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
            <div className="verify-done-row">
              <button className="inline-picker__back" onClick={() => setStep('verify-input')}>← Back</button>
              <button className="verify-done-btn" onClick={handleVerifyFinish}>✓ Done</button>
            </div>
          </>
        );
      })()}

      {/* ── Analog sensor setpoint step ───────────────────────────────────── */}
      {step === 'setpoint' && selectedDevice && (
        <>
          <div className="inline-picker__title">
            {selectedDevice.displayName}
            {selectedOp && (
              <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', marginLeft: 6 }}>
                · {selectedOp === 'ReadValue' ? 'Read Value' : 'Check Range'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 4px' }}>
            Pick the setpoint to test
          </div>
          {analogSetpoints.length === 0 && (
            <div className="inline-picker__empty">
              No setpoints defined — edit this sensor in the Subject Library to add them.
            </div>
          )}
          {analogSetpoints.map(sp => {
            const nominal = sp.nominal ?? sp.defaultValue;
            const tol = sp.tolerance;
            let rangeLabel;
            if (nominal !== undefined && tol !== undefined) {
              rangeLabel = `${Number(nominal).toFixed(2)} ± ${Number(tol).toFixed(2)}`;
            } else if (sp.lowLimit !== undefined && sp.highLimit !== undefined) {
              rangeLabel = `${Number(sp.lowLimit).toFixed(2)} – ${Number(sp.highLimit).toFixed(2)}`;
            } else {
              rangeLabel = Number(nominal ?? 0).toFixed(1);
            }
            return (
              <button key={sp.name} className="inline-picker__item inline-picker__item--position"
                onClick={() => selectSetpoint(sp.name)}>
                <span className="inline-picker__pos-name">{sp.name}</span>
                <span className="inline-picker__pos-value">{rangeLabel}</span>
              </button>
            );
          })}
          <button className="inline-picker__back" onClick={() => {
            // Back to operation picker if this is the analog sensor flow (both ops available)
            const analogOps = DEVICE_TYPES.AnalogSensor?.operations ?? [];
            if (selectedDevice?.type === 'AnalogSensor' && analogOps.length > 1) {
              setStep('operation');
              setSelectedOp(null);
            } else {
              setStep('device');
              setSelectedDeviceId(null);
              setSelectedOp(null);
            }
          }}>
            ← Back
          </button>
        </>
      )}

      {/* ── Robot: sequence picker ───────────────────────────────────────── */}
      {step === 'robotSequence' && selectedDevice && (() => {
        // Fallback defaults for legacy robot devices created before sequences existed.
        // The user can customize these in the Subject Library.
        const DEFAULT_SEQS = [
          { id: 'seq_default_1', number: 1, name: 'Home',  description: 'Move to home / perch position' },
          { id: 'seq_default_2', number: 2, name: 'Pick',  description: 'Pick part from nest' },
          { id: 'seq_default_3', number: 3, name: 'Place', description: 'Place part at target' },
        ];
        const persistedSeqs = selectedDevice.sequences ?? [];
        const usingDefaults = persistedSeqs.length === 0;
        const seqs = usingDefaults ? DEFAULT_SEQS : persistedSeqs;
        return (
          <>
            <div className="inline-picker__title">
              {selectedDevice.displayName}
              <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', marginLeft: 6 }}>· Run Sequence</span>
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 4px' }}>
              {usingDefaults
                ? 'Default programs (edit the robot in Subject Library to customize)'
                : 'Pick a program to run'}
            </div>
            {seqs.map(seq => (
              <button key={seq.id ?? seq.number} className="inline-picker__item inline-picker__item--position"
                onClick={() => {
                  const actionData = { deviceId: selectedDeviceId, operation: 'RunSequence',
                    sequenceNumber: seq.number, sequenceName: seq.name };
                  if (editActionId) store.updateAction(smId, nodeId, editActionId, actionData);
                  else store.addAction(smId, nodeId, actionData);
                  onClose();
                }}>
                <span className="inline-picker__pos-name">{seq.name}</span>
                <span className="inline-picker__pos-value">#{seq.number}</span>
              </button>
            ))}
            <button className="inline-picker__back" onClick={() => { setStep('operation'); setSelectedOp(null); }}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── Robot: set-output (PLC→Robot DI) picker ──────────────────────── */}
      {step === 'robotSetOutput' && selectedDevice && (() => {
        // Fallback: legacy robot devices without a signals list still get the baseline DI.
        const DEFAULT_DI = [
          { id: 'di_default_ok_enter_dial', number: 1, name: 'OkToEnterDial', group: 'DI', direction: 'output', dataType: 'BOOL' },
        ];
        const persisted = (selectedDevice.signals ?? []).filter(s => s.direction === 'output' && s.group === 'DI');
        const usingDefaults = persisted.length === 0;
        const outs = usingDefaults ? DEFAULT_DI : persisted;
        return (
          <>
            <div className="inline-picker__title">
              {selectedDevice.displayName}
              <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', marginLeft: 6 }}>· Set Signal</span>
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 4px' }}>
              {usingDefaults
                ? 'Default PLC→Robot signals (edit robot in Subject Library to customize)'
                : 'Pick a PLC→Robot signal to set'}
            </div>
            {outs.map(sig => (
              <div key={sig.id ?? sig.number} className="robot-sig-row">
                <div className="robot-sig-row__label">
                  <span className="robot-sig-row__name" title={sig.name}>{sig.name}</span>
                  <span className="robot-sig-row__addr">DI[{sig.number}]</span>
                </div>
                <button className="robot-sig-row__btn robot-sig-row__btn--on"
                  onClick={() => {
                    const actionData = { deviceId: selectedDeviceId, operation: 'SetOutput',
                      signalId: sig.id, signalName: sig.name, signalNumber: sig.number, signalValue: 'ON' };
                    if (editActionId) store.updateAction(smId, nodeId, editActionId, actionData);
                    else store.addAction(smId, nodeId, actionData);
                    onClose();
                  }}>ON</button>
                <button className="robot-sig-row__btn robot-sig-row__btn--off"
                  onClick={() => {
                    const actionData = { deviceId: selectedDeviceId, operation: 'SetOutput',
                      signalId: sig.id, signalName: sig.name, signalNumber: sig.number, signalValue: 'OFF' };
                    if (editActionId) store.updateAction(smId, nodeId, editActionId, actionData);
                    else store.addAction(smId, nodeId, actionData);
                    onClose();
                  }}>OFF</button>
              </div>
            ))}
            <button className="inline-picker__back" onClick={() => { setStep('operation'); setSelectedOp(null); }}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── Robot: wait-input (Robot→PLC DO) picker ──────────────────────── */}
      {step === 'robotWaitInput' && selectedDevice && (() => {
        // Fallback: legacy robot devices without a signals list still get the baseline DO.
        const DEFAULT_DO = [
          { id: 'do_default_part_grip', number: 1, name: 'PartGrip', group: 'DO', direction: 'input', dataType: 'BOOL' },
        ];
        const persisted = (selectedDevice.signals ?? []).filter(s => s.direction === 'input' && s.group === 'DO');
        const usingDefaults = persisted.length === 0;
        const ins = usingDefaults ? DEFAULT_DO : persisted;
        return (
          <>
            <div className="inline-picker__title">
              {selectedDevice.displayName}
              <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', marginLeft: 6 }}>· Wait for Signal</span>
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 4px' }}>
              {usingDefaults
                ? 'Default Robot→PLC signals (edit robot in Subject Library to customize)'
                : 'Pick a Robot→PLC signal to wait on'}
            </div>
            {ins.map(sig => (
              <div key={sig.id ?? sig.number} className="robot-sig-row">
                <div className="robot-sig-row__label">
                  <span className="robot-sig-row__name" title={sig.name}>{sig.name}</span>
                  <span className="robot-sig-row__addr">DO[{sig.number}]</span>
                </div>
                <button className="robot-sig-row__btn robot-sig-row__btn--on"
                  onClick={() => {
                    const actionData = { deviceId: selectedDeviceId, operation: 'WaitInput',
                      signalId: sig.id, signalName: sig.name, signalNumber: sig.number, signalValue: 'ON' };
                    if (editActionId) store.updateAction(smId, nodeId, editActionId, actionData);
                    else store.addAction(smId, nodeId, actionData);
                    onClose();
                  }}>ON</button>
                <button className="robot-sig-row__btn robot-sig-row__btn--off"
                  onClick={() => {
                    const actionData = { deviceId: selectedDeviceId, operation: 'WaitInput',
                      signalId: sig.id, signalName: sig.name, signalNumber: sig.number, signalValue: 'OFF' };
                    if (editActionId) store.updateAction(smId, nodeId, editActionId, actionData);
                    else store.addAction(smId, nodeId, actionData);
                    onClose();
                  }}>OFF</button>
              </div>
            ))}
            <button className="inline-picker__back" onClick={() => { setStep('operation'); setSelectedOp(null); }}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── Vision: job picker step ────────────────────────────────────────── */}
      {step === 'visionJob' && selectedDevice && (
        <>
          <div className="inline-picker__title">{selectedDevice.displayName}</div>
          <div className="inline-picker__hint" style={{ fontSize: 10, color: '#9ca3af', padding: '0 8px 4px' }}>
            Select a job
          </div>
          {(selectedDevice.jobs ?? []).length === 0 && (
            <div className="inline-picker__empty">
              No jobs defined — edit this camera in the Subject Library to add them.
            </div>
          )}
          {(selectedDevice.jobs ?? []).map(job => (
            <button key={job.name} className="inline-picker__item"
              onClick={() => {
                setPickerJob(job.name);
                setVisionPtName(job.name); // Default PT field name = job name
                // Always use simple Pass/Fail branches (PT handles the tracking)
                setVisionBranches([
                  { id: uid(), label: 'Pass' },
                  { id: uid(), label: 'Fail' },
                ]);
                setStep('visionConfig');
              }}>
              <span>{job.name}</span>
              <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 'auto' }}>
                Pass / Fail → PT
              </span>
            </button>
          ))}
          <button className="inline-picker__back" onClick={() => { setStep('device'); setSelectedDeviceId(null); }}>
            ← Back
          </button>
        </>
      )}

      {/* ── Vision: config step (mode + branch count + PT) ─────────────── */}
      {step === 'visionConfig' && selectedDevice && pickerJob && (
        <>
          <div className="inline-picker__title" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>📷</span> {selectedDevice.displayName}: {pickerJob}
          </div>

          {/* Branch count toggle: 1 or 2 */}
          <div style={{ padding: '4px 8px', display: 'flex', gap: 4 }}>
            <button className="nodrag" onClick={() => setVisionExitCount(1)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: visionExitCount === 1 ? '#16a34a' : '#f3f4f6',
                border: visionExitCount === 1 ? '1px solid #22c55e' : '1px solid #e5e7eb',
                color: visionExitCount === 1 ? '#fff' : '#6b7280',
              }}>
              1 Exit ↓
            </button>
            <button className="nodrag" onClick={() => setVisionExitCount(2)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: visionExitCount === 2 ? '#1574c4' : '#f3f4f6',
                border: visionExitCount === 2 ? '1px solid #3b82f6' : '1px solid #e5e7eb',
                color: visionExitCount === 2 ? '#fff' : '#6b7280',
              }}>
              2 Exit ← →
            </button>
          </div>
          <div style={{ padding: '0 8px 4px', fontSize: 9, color: '#9ca3af' }}>
            {visionExitCount === 1
              ? 'Single exit down — pass or fail continues to next step'
              : 'Pass exits left, Fail exits right — separate branches'}
          </div>

          {/* Mode toggle */}
          <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={visionContinuous} onChange={e => setVisionContinuous(e.target.checked)} />
              Continuous (Search)
            </label>
          </div>

          {/* Continuous options */}
          {visionContinuous && (
            <>
              <div style={{ padding: '2px 8px 4px', fontSize: 10, color: '#6b7280', display: 'flex', gap: 8 }}>
                <label>Timeout:
                  <input type="number" value={visionTimeoutMs} onChange={e => setVisionTimeoutMs(Number(e.target.value))}
                    style={{ width: 56, marginLeft: 4, fontSize: 10 }} /> ms
                </label>
              </div>
              <div style={{ padding: '2px 8px 4px', fontSize: 9, color: '#92400e', background: '#fef3c7', margin: '2px 4px', borderRadius: 3, lineHeight: 1.5 }}>
                🔄 Loops until match or timeout → fault 127
              </div>
            </>
          )}

          {/* Part Tracking field name */}
          <div style={{ padding: '4px 8px', fontSize: 11, borderTop: '1px solid #e5e7eb' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#6b7280' }}>PT Field:</span>
              <input className="form-input" value={visionPtName}
                onChange={e => setVisionPtName(e.target.value)}
                placeholder="Part Tracking field name"
                style={{ flex: 1, fontSize: 11, padding: '2px 6px' }} />
            </label>
            <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>
              Auto-updates PT after Check Results
            </div>
          </div>

          {/* Done */}
          <div className="verify-done-row">
            <button className="inline-picker__back" onClick={() => setStep('visionJob')}>← Back</button>
            <button className="verify-done-btn" onClick={handleVisionDone}>✓ Done</button>
          </div>
        </>
      )}

      {/* ── ServoIncr pick step (device-defined incremental moves) ─────── */}
      {step === 'servoIncrPick' && selectedDevice && (() => {
        const incrEntries = servoPositions.filter(p => p.type === 'incremental');
        return (
          <>
            <div className="inline-picker__title">{selectedDevice.displayName}: Incremental</div>
            {incrEntries.map(p => (
              <button key={p.name} className="inline-picker__item inline-picker__item--position"
                onClick={() => {
                  const actionData = {
                    deviceId: selectedDeviceId,
                    operation: 'ServoIncr',
                    positionName: p.name,
                    incrementDist: Number(p.defaultValue ?? 1),
                    incrementRecipe: !!p.isRecipe,
                  };
                  store.addAction(smId, nodeId, actionData);
                  onClose();
                }}>
                <span className="inline-picker__pos-name">{p.name}</span>
                <span className="inline-picker__pos-value">{Number(p.defaultValue ?? 1).toFixed(1)} mm</span>
              </button>
            ))}
            <div className="inline-picker__divider" />
            <button className="inline-picker__item" style={{ color: '#0072B5', fontStyle: 'italic' }}
              onClick={() => setStep('servoIncrConfig')}>
              + Custom distance…
            </button>
            <button className="inline-picker__back" onClick={() => setStep('servoMoves')}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── ServoIncr config step ──────────────────────────────────────────── */}
      {step === 'servoIncrConfig' && selectedDevice && (
        <>
          <div className="inline-picker__title">{selectedDevice.displayName}: Incremental</div>
          <div style={{ padding: '6px 8px', fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Increment Distance:
              <input type="number" value={servoIncrDist} step="0.1"
                onChange={e => setServoIncrDist(Number(e.target.value))}
                style={{ width: 64, fontSize: 11, padding: '2px 4px' }} />
            </label>
          </div>
          <div style={{ padding: '2px 8px', fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={servoIncrRecipe} onChange={e => setServoIncrRecipe(e.target.checked)} />
              Recipe
            </label>
          </div>
          <div className="verify-done-row">
            <button className="inline-picker__back" onClick={() => setStep('servoMoves')}>← Back</button>
            <button className="verify-done-btn" onClick={() => {
              const actionData = { deviceId: selectedDeviceId, operation: 'ServoIncr', incrementDist: servoIncrDist, incrementRecipe: servoIncrRecipe };
              store.addAction(smId, nodeId, actionData);
              onClose();
            }}>✓ Done</button>
          </div>
        </>
      )}

      {/* ── ServoIndex pick step (device-defined index configs) ──────── */}
      {step === 'servoIndexPick' && selectedDevice && (() => {
        const indexEntries = servoPositions.filter(p => p.type === 'index');
        return (
          <>
            <div className="inline-picker__title">{selectedDevice.displayName}: Index</div>
            {indexEntries.map(p => (
              <button key={p.name} className="inline-picker__item inline-picker__item--position"
                onClick={() => {
                  const actionData = {
                    deviceId: selectedDeviceId,
                    operation: 'ServoIndex',
                    positionName: p.name,
                    indexStations: Number(p.heads ?? 6),
                    indexAngle: Number(p.defaultValue ?? 60),
                    indexRecipe: !!p.isRecipe,
                  };
                  store.addAction(smId, nodeId, actionData);
                  onClose();
                }}>
                <span className="inline-picker__pos-name">{p.name}</span>
                <span className="inline-picker__pos-value">{p.heads ?? 6}-pos · {Number(p.defaultValue ?? 60).toFixed(1)}°</span>
              </button>
            ))}
            <div className="inline-picker__divider" />
            <button className="inline-picker__item" style={{ color: '#0072B5', fontStyle: 'italic' }}
              onClick={() => setStep('servoIndexConfig')}>
              + Custom index…
            </button>
            <button className="inline-picker__back" onClick={() => setStep('servoMoves')}>
              ← Back
            </button>
          </>
        );
      })()}

      {/* ── ServoIndex config step ─────────────────────────────────────────── */}
      {step === 'servoIndexConfig' && selectedDevice && (
        <>
          <div className="inline-picker__title">{selectedDevice.displayName}: Index</div>
          <div style={{ padding: '6px 8px', fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Number of Stations:
              <input type="number" value={servoIndexStations} min="2"
                onChange={e => {
                  const n = Number(e.target.value);
                  setServoIndexStations(n);
                  setServoIndexAngle(n > 0 ? Math.round((360 / n) * 100) / 100 : 0);
                }}
                style={{ width: 48, fontSize: 11, padding: '2px 4px' }} />
            </label>
          </div>
          <div style={{ padding: '2px 8px', fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Index Angle:
              <input type="number" value={servoIndexAngle} step="0.01"
                onChange={e => setServoIndexAngle(Number(e.target.value))}
                style={{ width: 64, fontSize: 11, padding: '2px 4px' }} /> °
            </label>
          </div>
          <div style={{ padding: '2px 8px', fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={servoIndexRecipe} onChange={e => setServoIndexRecipe(e.target.checked)} />
              Recipe
            </label>
          </div>
          <div className="verify-done-row">
            <button className="inline-picker__back" onClick={() => setStep('servoMoves')}>← Back</button>
            <button className="verify-done-btn" onClick={() => {
              const actionData = { deviceId: selectedDeviceId, operation: 'ServoIndex', indexStations: servoIndexStations, indexAngle: servoIndexAngle, indexRecipe: servoIndexRecipe };
              store.addAction(smId, nodeId, actionData);
              onClose();
            }}>✓ Done</button>
          </div>
        </>
      )}

    </div>
  );
}

// ── Context Menu ──────────────────────────────────────────────────────────────

function ContextMenu({ x, y, nodeId, smId, onClose }) {
  const store = useDiagramStore();
  const ref = useRef(null);
  const zoomStyle = useReactFlowZoomScale();

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000, ...zoomStyle }}
    >
      <button
        className="context-menu__item"
        onClick={() => { store.duplicateNode(smId, nodeId); onClose(); }}
      >
        ⧉ Duplicate
      </button>
      <button
        className="context-menu__item"
        onClick={() => { store.openActionModal(nodeId); onClose(); }}
      >
        + Add Action
      </button>
      <button
        className="context-menu__item"
        onClick={() => {
          const currentSm = store.getActiveSm();
          const currentNode = currentSm?.nodes?.find(n => n.id === nodeId);
          if (currentNode && currentSm) {
            const newNodeId = store.addNode(smId, {
              position: {
                x: currentNode.position.x + 250,
                y: currentNode.position.y + 100,
              },
            });
            if (newNodeId) {
              store.addEdge(smId, {
                source: nodeId,
                sourceHandle: null,
                target: newNodeId,
                targetHandle: null,
              }, { conditionType: 'ready', label: '' });
              store.setOpenPickerOnNode(newNodeId);
            }
          }
          onClose();
        }}
      >
        ⑂ Add Branch
      </button>
      <button
        className="context-menu__item"
        onClick={() => {
          const currentSm = store.getActiveSm();
          const currentNode = currentSm?.nodes?.find(n => n.id === nodeId);
          if (currentNode && currentSm) {
            const decisionId = uid();
            // StateNode renders ~300px wide; DecisionNode is 240px
            const decX = currentNode.position.x + ((currentNode.measured?.width ?? currentNode.width ?? 240) - 240) / 2;
            store.addDecisionNode(smId, {
              id: decisionId,
              position: {
                x: decX,
                y: currentNode.position.y + 180,
              },
              data: {
                label: 'Decision',
                decisionType: 'signal',
                signalId: null,
                signalName: 'Select Signal...',
                exitCount: 2,
                exit1Label: 'Pass',
                exit2Label: 'Fail',
                updatePartTracking: false,
              },
            });
            store.addEdge(smId, {
              source: nodeId,
              sourceHandle: null,
              target: decisionId,
              targetHandle: 'input',
            }, { conditionType: 'ready', label: '' });
          }
          onClose();
        }}
      >
        ◇ Add Decision
      </button>
      <div className="context-menu__divider" />
      <button
        className="context-menu__item context-menu__item--danger"
        onClick={() => {
          if (confirm('Delete this state?')) store.deleteNode(smId, nodeId);
          onClose();
        }}
      >
        ✕ Delete
      </button>
    </div>,
    document.body
  );
}


// ── Home-node config pills (Entry Rule + Start Condition) ─────────────────────

/**
 * Generic labeled pill with a portaled dropdown.
 * Used for both Entry Rule and Start Condition controls on home nodes.
 */
function ConfigPill({ label, options, effective, meta, overridden, overrideText, tooltip, onPick }) {
  const zoomStyleConfigPill = useReactFlowZoomScale('top center');
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const pillRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      const insidePill = pillRef.current && pillRef.current.contains(e.target);
      const insideMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!insidePill && !insideMenu) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick, true);
    return () => document.removeEventListener('mousedown', onDocClick, true);
  }, [open]);

  return (
    <>
      <div
        ref={pillRef}
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
        }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        title={tooltip}
      >
        <button
          ref={btnRef}
          onClick={(e) => {
            e.stopPropagation();
            if (overridden) return;
            if (!open && btnRef.current) {
              const r = btnRef.current.getBoundingClientRect();
              setMenuPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
            }
            setOpen(v => !v);
          }}
          style={{
            fontSize: 14,
            fontWeight: 700,
            padding: '6px 16px',
            borderRadius: 999,
            border: `2px solid ${overridden ? '#475569' : meta.border}`,
            background: overridden ? 'rgba(71,85,105,0.15)' : meta.bg,
            color: overridden ? '#94a3b8' : meta.color,
            cursor: overridden ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            opacity: overridden ? 0.55 : 1,
            textDecoration: overridden ? 'line-through' : 'none',
            lineHeight: 1.2,
            boxShadow: overridden ? 'none' : '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          {overridden ? (overrideText ?? `${meta.short} (overridden)`) : meta.label} {overridden ? '' : '▾'}
        </button>
      </div>
      {open && !overridden && menuPos && createPortal(
        <div
          ref={menuRef}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            // Combine horizontal centering with zoom scale
            transform: `translateX(-50%) ${zoomStyleConfigPill.transform}`,
            transformOrigin: zoomStyleConfigPill.transformOrigin,
            background: '#ffffff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            width: 260,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            zIndex: 100000,
            overflow: 'hidden',
          }}
        >
          {options.map(o => (
            <button
              key={o.value}
              onClick={(e) => {
                e.stopPropagation();
                onPick(o.value);
                setOpen(false);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 10px', textAlign: 'left', background: 'none',
                border: 'none', color: '#374151', fontSize: 12, cursor: 'pointer',
                borderBottom: '1px solid #e5e7eb',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              title={o.desc}
            >
              <span style={{
                width: 10, height: 10, borderRadius: 999,
                background: o.color, border: `1px solid ${o.border}`,
                flex: '0 0 auto',
              }} />
              <span style={{ flex: 1, fontWeight: 600, color: o.color }}>{o.label}</span>
              {o.value === effective && <span style={{ color: meta.color, fontSize: 13 }}>✓</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * Unified "START CONDITIONS" panel above the home node.
 * Two rows: "When:" (index timing) and "Run:" (part-tracking rule).
 * Index timing row only shown on indexing/dial machines.
 */
function HomeConfigPills({ smId, nodeId, sm, machineConfig }) {
  const store = useDiagramStore();
  // Standards are generic sequence templates — they don't carry station-level
  // start conditions (index timing, part-tracking entry rule). Hide those pills
  // when editing a standard, but keep the Part Tracking table pill.
  const isStandard = useDiagramStore(s => s.project?.isStandard === true);
  const homeNode = sm?.nodes?.find(n => n.id === nodeId);

  const entryEffective = resolveEntryRule(homeNode, sm, machineConfig);
  const entryMeta = getEntryRuleMeta(entryEffective);
  const entryOverridden = isEntryRuleOverridden(nodeId, sm);

  const indexEffective = resolveIndexSync(homeNode, sm, machineConfig);
  const indexMeta = getStartConditionMeta(indexEffective);
  const indexOverridden = isIndexSyncOverridden(nodeId, sm);

  const isIndexing = !isStandard && (machineConfig?.machineType ?? 'indexing') === 'indexing';

  return (
    <div
      style={{
        position: 'absolute',
        top: isStandard ? -60 : (isIndexing ? -160 : -140),
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9,
        pointerEvents: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'center',
      }}>
        {/* Header — standards are generic sequences, no "Start Conditions" */}
        {!isStandard && (
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#94a3b8',
            textAlign: 'center',
          }}>
            Start Conditions
          </div>
        )}

        {/* Index timing row (indexing machines only, hidden on standards) */}
        {isIndexing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <ConfigPill
              options={START_CONDITIONS}
              effective={indexEffective}
              meta={indexMeta}
              overridden={indexOverridden}
              overrideText={`${indexMeta.short} (explicit)`}
              tooltip={indexOverridden
                ? 'Start condition is handled by the explicit IndexComplete wait node you drew after home.'
                : 'When this station begins relative to the dial index.'}
              onPick={(v) => store.updateNodeData(smId, nodeId, { indexSync: v })}
            />
            {indexEffective === 'midIndex' && !indexOverridden && (
              <>
                <span style={{ fontSize: 11, color: '#64748b' }}>at</span>
                <input
                  type="number"
                  value={homeNode?.data?.midIndexAngle ?? ''}
                  placeholder="°"
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Number(e.target.value);
                    store.updateNodeData(smId, nodeId, { midIndexAngle: val });
                  }}
                  style={{
                    width: 50,
                    padding: '2px 4px',
                    fontSize: 12,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    textAlign: 'center',
                    background: '#fff',
                    color: '#374151',
                  }}
                />
                <span style={{ fontSize: 11, color: '#64748b' }}>°</span>
              </>
            )}
          </div>
        )}

        {/* Part-tracking entry rule row — hidden on standards (not a station concept) */}
        {!isStandard && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <ConfigPill
              options={ENTRY_RULES}
              effective={entryEffective}
              meta={entryMeta}
              overridden={entryOverridden}
              tooltip={entryOverridden
                ? 'Overridden — the decision node after home controls part-tracking branching.'
                : 'Whether this station runs based on part-tracking status.'}
              onPick={(v) => store.updateNodeData(smId, nodeId, { entryRule: v })}
            />
          </div>
        )}

        {/* Part Tracking table pill — opens a portaled editable table (kept on standards) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 2 }}>
          <PartTrackingPill sm={sm} />
        </div>
      </div>
    </div>
  );
}

// ── Main StateNode Component ──────────────────────────────────────────────────

export function StateNode({ data, selected, id }) {
  const { actions = [], isInitial, isComplete, isFault, stateNumber } = data;
  const store = useDiagramStore();
  const sm = useDiagramStore(s => s.getActiveSm());
  const machineConfig = useDiagramStore(s => s.project?.machineConfig);
  const openPickerOnNodeId = useDiagramStore(s => s.openPickerOnNodeId);
  const closePickerSignal = useDiagramStore(s => s._closePickerSignal);
  const devices = sm?.devices ?? [];

  // SM Outputs that are active during this node (TRUE while SM is in this state)
  const triggeredOutputs = (sm?.smOutputs ?? []).filter(o => o.activeNodeId === id);

  // For the initial (home) node: show device home positions
  // Fall back to defaultHomePosition from device type if device doesn't have one set
  const homeDevices = isInitial
    ? devices
        .filter(d => DEVICE_TYPES[d.type]?.homePositions)
        .map(d => {
          if (d.type === 'ServoAxis') {
            // For servo: find the isHome position name
            const homePos = (d.positions ?? []).find(p => p.isHome);
            return {
              ...d,
              homePosition: 'ServoMove',
              _servoHomePosName: homePos?.name ?? (d.positions?.[0]?.name ?? '?'),
            };
          }
          return {
            ...d,
            homePosition: d.homePosition || DEVICE_TYPES[d.type]?.defaultHomePosition,
          };
        })
    : [];

  const [showPicker, setShowPicker] = useState(false);
  const [editingActionId, setEditingActionId] = useState(null);
  const [pickerInitialStep, setPickerInitialStep] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [opSwitcher, setOpSwitcher] = useState(null); // { actionId, pos: {top, left} }
  const addMenuRef = useRef(null);

  // Close add-menu when clicking outside
  useEffect(() => {
    if (!showAddMenu) return;
    function handleClickOutside(e) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [showAddMenu]);

  // Auto-open picker when signaled from Canvas (e.g. after drag-to-create)
  useEffect(() => {
    if (openPickerOnNodeId === id) {
      setShowPicker(true);
      useDiagramStore.getState().clearOpenPickerOnNode();
    }
  }, [openPickerOnNodeId, id]);

  // Close picker when node transitions from selected → deselected.
  // Uses a ref to track previous selected value so clicking an action row
  // on a non-selected node (where selected starts false) won't race-close
  // the picker before React Flow's selection update arrives.
  const prevSelected = useRef(selected);
  useEffect(() => {
    if (prevSelected.current && !selected && showPicker) {
      setShowPicker(false);
      setEditingActionId(null);
    }
    prevSelected.current = selected;
  }, [selected, showPicker]);

  const lastCloseSignal = useRef(closePickerSignal);
  useEffect(() => {
    if (closePickerSignal !== lastCloseSignal.current) {
      lastCloseSignal.current = closePickerSignal;
      if (showPicker) {
        setShowPicker(false);
        setEditingActionId(null);
      }
    }
  }, [closePickerSignal]);

  // Determine node border color
  let borderColor = '#64748b';
  if (isInitial || isComplete) borderColor = '#5a9a48';
  else if (isFault) borderColor = '#dc2626';
  else if (actions.length > 0) {
    const firstDev = devices.find(d => d.id === actions[0]?.deviceId);
    if (firstDev?.type === 'CheckResults') borderColor = '#d9d9d9';
    else if (firstDev?.type === 'VisionSystem') borderColor = '#f59e0b';
    else if (firstDev) borderColor = DEVICE_TYPES[firstDev.type]?.color ?? borderColor;
  }

  // Determine node outline shape from primary device
  const shape = (isComplete || isFault) ? 'rounded' : getNodeShape(actions, devices);
  const useSvgShape = shape !== 'rounded' && shape !== 'pill';

  // Vision exit mode: detect if this node has a VisionInspect action with side exits
  const hasVisionInspect = actions.some(a => {
    const dev = devices.find(d => d.id === a.deviceId);
    return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
  });
  const visionExitMode = data.visionExitMode ?? null;
  const showVisionSideHandles = hasVisionInspect && visionExitMode === '2-node';
  const showVisionSingleHandle = hasVisionInspect && visionExitMode === '1-node';

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      className={`state-node state-node--${shape}${selected ? ' state-node--selected' : ''}${isInitial ? ' state-node--initial' : ''}${isComplete ? ' state-node--complete' : ''}${isFault ? ' state-node--fault' : ''}`}
      style={{ '--node-border': borderColor }}
      onContextMenu={handleContextMenu}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="sdc-handle"
      />

      {/* SVG shape background (hexagon, octagon, diamond) */}
      {useSvgShape && (
        <ShapeBackground shape={shape} borderColor={borderColor} selected={selected} />
      )}

      {/* Floating + button with add-menu */}
      <div style={{ position: 'absolute', top: -14, right: -14, zIndex: 10 }} ref={addMenuRef}>
        <button
          className="state-node__add-btn"
          onClick={(e) => { e.stopPropagation(); setShowAddMenu(v => !v); }}
          title="Add action or next node"
        >+</button>
        {showAddMenu && (
          <div
            style={{
              position: 'absolute',
              top: '110%',
              right: 0,
              background: '#1e2937',
              border: '1px solid #374151',
              borderRadius: 6,
              minWidth: 150,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              zIndex: 10001,
              overflow: 'hidden',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button
              style={{
                display: 'block', width: '100%', padding: '7px 12px',
                textAlign: 'left', background: 'none', border: 'none',
                color: '#e5e7eb', fontSize: 12, cursor: 'pointer',
                borderBottom: '1px solid #374151',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#273548'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu(false);
                setEditingActionId(null);
                setShowPicker(p => !p);
              }}
            >
              ＋ Add Action
            </button>
            <button
              style={{
                display: 'block', width: '100%', padding: '7px 12px',
                textAlign: 'left', background: 'none', border: 'none',
                color: '#e5e7eb', fontSize: 12, cursor: 'pointer',
                borderBottom: '1px solid #374151',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#273548'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu(false);
                const currentSm = store.getActiveSm();
                const currentNode = currentSm?.nodes?.find(n => n.id === id);
                if (currentNode && currentSm) {
                  const newNodeId = store.addNode(sm.id, {
                    position: {
                      x: currentNode.position.x,
                      y: currentNode.position.y + 200,
                    },
                  });
                  if (newNodeId) {
                    store.addEdge(sm.id, {
                      source: id,
                      sourceHandle: null,
                      target: newNodeId,
                      targetHandle: null,
                    }, { conditionType: 'ready', label: '' });
                  }
                }
              }}
            >
              ⬜ Add State
            </button>
            <button
              style={{
                display: 'block', width: '100%', padding: '7px 12px',
                textAlign: 'left', background: 'none', border: 'none',
                color: '#e5e7eb', fontSize: 12, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#273548'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu(false);
                const currentSm = store.getActiveSm();
                const currentNode = currentSm?.nodes?.find(n => n.id === id);
                if (currentNode && currentSm) {
                  const decisionId = uid();
                  // StateNode renders ~300px wide; DecisionNode is 240px
                  const decX = currentNode.position.x + ((currentNode.measured?.width ?? currentNode.width ?? 240) - 240) / 2;
                  store.addDecisionNode(sm.id, {
                    id: decisionId,
                    position: {
                      x: decX,
                      y: currentNode.position.y + 200,
                    },
                    data: {
                      label: 'Decision',
                      decisionType: 'signal',
                      signalId: null,
                      signalName: 'Select Signal...',
                      exitCount: 2,
                      exit1Label: 'Pass',
                      exit2Label: 'Fail',
                      updatePartTracking: false,
                    },
                  });
                  store.addEdge(sm.id, {
                    source: id,
                    sourceHandle: null,
                    target: decisionId,
                    targetHandle: 'input',
                  }, { conditionType: 'ready', label: '' });
                }
              }}
            >
              ◇ Add Decision
            </button>
          </div>
        )}
      </div>


      {/* NodeToolbar inline picker */}
      {showPicker && sm && (
        <NodeToolbar isVisible position="right" offset={8}>
          <InlinePicker
            smId={sm.id}
            nodeId={id}
            devices={devices}
            onClose={() => { setShowPicker(false); setEditingActionId(null); setPickerInitialStep(null); }}
            editActionId={editingActionId}
            editAction={editingActionId ? actions.find(a => a.id === editingActionId) : null}
            initialStep={pickerInitialStep}
          />
        </NodeToolbar>
      )}

      {/* Home-node config pills (Entry Rule + Start Condition) */}
      {isInitial && sm && (
        <HomeConfigPills smId={sm.id} nodeId={id} sm={sm} machineConfig={machineConfig} />
      )}

      {/* State number badge (small, top-left corner) */}
      {stateNumber != null && (
        <div className="state-node__step-num" style={{
          background: isFault ? '#dc2626' : (isInitial || isComplete) ? '#5a9a48' : borderColor,
        }}>
          {stateNumber}
        </div>
      )}

      {/* Body — action rows or home positions */}
      <div className="state-node__body">
        {isFault ? (
          // Fault node: red "⚠ Fault State" text
          <div className="state-node__complete" style={{ color: '#dc2626' }}>
            <span className="state-node__complete-icon">⚠</span>
            <span>Fault State</span>
          </div>
        ) : isComplete ? (
          // Complete node: green "Cycle Complete" text
          <div className="state-node__complete">
            <span className="state-node__complete-icon">✓</span>
            <span>Cycle Complete</span>
          </div>
        ) : isInitial ? (
          // Home node: header + device home positions
          <div>
            <div style={{
              textAlign: 'center',
              padding: '6px 8px 4px',
              fontSize: 13,
              fontWeight: 700,
              color: '#5a9a48',
              letterSpacing: '0.03em',
              borderBottom: '1px solid rgba(90,154,72,0.25)',
              marginBottom: 2,
            }}>
              🏠 Home Conditions
            </div>
            {homeDevices.length > 0 ? (
              homeDevices.map(d => (
                <HomeRow key={d.id} device={d} />
              ))
            ) : (
              <div className="state-node__empty" style={{ fontSize: 11, padding: '8px 10px', color: '#94a3b8' }}>
                Add devices to populate home positions
              </div>
            )}
          </div>
        ) : (
          // Regular node: show actions
          actions.length > 0 ? (
            actions.map(action => (
              <ActionRow key={action.id} action={action} devices={devices} smId={sm?.id} nodeId={id}
                onClickName={(e) => {
                  e.stopPropagation();
                  if (editingActionId === action.id && showPicker) {
                    setShowPicker(false); setEditingActionId(null); setPickerInitialStep(null);
                  } else {
                    setEditingActionId(action.id); setPickerInitialStep(null); setShowPicker(true);
                  }
                }}
                onClickOp={(() => {
                  const dev = devices?.find(d => d.id === action.deviceId);
                  const devDef = dev ? DEVICE_TYPES[dev.type] : null;
                  // Servo: open picker at servo positions step
                  if (action.operation === 'ServoMove' || action.operation === 'ServoIncr' || action.operation === 'ServoIndex') {
                    return (e) => {
                      e.stopPropagation();
                      if (editingActionId === action.id && showPicker) {
                        setShowPicker(false); setEditingActionId(null); setPickerInitialStep(null);
                      } else {
                        setEditingActionId(action.id); setPickerInitialStep('servoMoves'); setShowPicker(true);
                      }
                    };
                  }
                  // Any device with 2+ operations: open operation switcher popup
                  if (devDef && (devDef.operations?.length ?? 0) >= 2) {
                    return (e) => {
                      e.stopPropagation();
                      if (opSwitcher?.actionId === action.id) {
                        setOpSwitcher(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setOpSwitcher({ actionId: action.id, pos: { top: rect.bottom + 4, left: rect.left } });
                      }
                    };
                  }
                  return undefined;
                })()}
              />
            ))
          ) : (
            <div
              className="state-node__empty"
              onClick={(e) => { e.stopPropagation(); store.setSelectedNode(id); setShowPicker(true); }}
            >
              + Add action
            </div>
          )
        )}
      </div>

      {/* Operation Switcher popup (for pneumatic/gripper/vac badge clicks) */}
      {opSwitcher && (() => {
        const act = actions.find(a => a.id === opSwitcher.actionId);
        const dev = act ? devices?.find(d => d.id === act.deviceId) : null;
        if (!act || !dev) return null;
        return (
          <OperationSwitcher
            action={act}
            device={dev}
            smId={sm?.id}
            nodeId={id}
            pos={opSwitcher.pos}
            onClose={() => setOpSwitcher(null)}
          />
        );
      })()}

      {/* SM Output badges — shown below actions for outputs triggered by this node */}
      {triggeredOutputs.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '2px 4px' }}>
          {triggeredOutputs.map(o => (
            <span key={o.id} style={{ fontSize: 9, background: '#0072B5', color: '#fff', borderRadius: 3, padding: '1px 5px' }}>
              ⤴ {o.name}
            </span>
          ))}
        </div>
      )}

      {/* PT/Signal Badge — always visible when content exists, add-badge on select */}
      {sm && !isInitial && !isComplete && !isFault && (
        <PtBadge nodeId={id} smId={sm.id} annotations={data.ptAnnotations ?? []} selected={selected} />
      )}

      {/* Connect Menu — direction arrows when handle clicked */}
      {sm && !isComplete && !isFault && (
        <ConnectMenu nodeId={id} nodeType="stateNode" smId={sm.id} />
      )}

      {/* Source handles: vision side exits OR default bottom handle */}
      {showVisionSideHandles ? (
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
      ) : showVisionSingleHandle ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="exit-single"
          className="sdc-handle"
        />
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="sdc-handle"
        />
      )}

      {/* Click detection on bottom handle to open ConnectMenu */}
      {sm && !isComplete && !isFault && (
        <HandleClickZone
          nodeId={id}
          handleSelector=".sdc-handle.react-flow__handle-bottom"
          handleId={null}
        />
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          nodeId={id}
          smId={sm?.id}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
