/**
 * partTracking.js — Per-SM Part Tracking table derivation.
 *
 * A state machine's Part Tracking table is auto-derived from:
 *   1) The Cycle Complete node               → StationResult row (overall outcome)
 *   2) Dual-branch decision nodes             → one row per device outcome
 *   3) Vision Inspect state actions           → one row per vision job
 *   4) Analog-sensor "Check Range" actions    → one row per setpoint tested
 *      (even when the flow has no decision branch — the PT comes from the
 *       device operation itself, recorded pass/fail at the state where it runs)
 *
 * The user may append manual rows stored on the SM:
 *   sm.partTrackingOverrides.customRows[] = [{ id, fieldName, ... }]
 *
 * And may disable any auto row via:
 *   sm.partTrackingOverrides[fieldName] = { enabled: false }
 */

import { DEVICE_TYPES } from './deviceTypes.js';

function sanitizeTag(s) {
  return (s ?? '')
    .toString()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function deviceTypeLabel(type) {
  return DEVICE_TYPES[type]?.label ?? type ?? '';
}

/**
 * Given a decision node, find the underlying device + what-is-being-tested label.
 * Handles multiple storage formats:
 *   - Vision decisions: signalSource = device name, signalName = job name
 *   - Sensor decisions: sensorRef = "deviceId:setpointName"
 *   - Other signals:    signalId = "pt_<id>" / "state_<id>" / etc.
 */
function resolveDecisionSubject(node, devices) {
  const d = node.data ?? {};

  // Sensor path: sensorRef = "deviceId:setpointName"
  if (d.sensorRef && typeof d.sensorRef === 'string' && d.sensorRef.includes(':')) {
    const [deviceId, setpointName] = d.sensorRef.split(':');
    const device = devices.find(x => x.id === deviceId);
    if (device) {
      return {
        device,
        deviceName: device.name,
        deviceType: deviceTypeLabel(device.type),
        testName: setpointName || d.signalName || '',
      };
    }
  }

  // Vision / direct device path: signalSource = device name
  const byName = devices.find(x =>
    x.name === d.signalSource || x.displayName === d.signalSource
  );
  if (byName) {
    return {
      device: byName,
      deviceName: byName.name,
      deviceType: deviceTypeLabel(byName.type),
      testName: d.signalName || '',
    };
  }

  // Fallback: use whatever labels the node has. Try to salvage a device name
  // from the signalName (e.g., "Measure_Probe @ Test" → device "Measure_Probe").
  const rawLabel = d.signalName ?? '';
  let deviceName = d.signalSource ?? '';
  let testName = rawLabel;
  if (rawLabel.includes('@')) {
    const [left, right] = rawLabel.split('@').map(s => s.trim());
    if (devices.some(x => x.name === left)) {
      deviceName = left;
      testName = right;
    }
  }
  const fallbackDev = devices.find(x => x.name === deviceName);

  return {
    device: fallbackDev ?? null,
    deviceName: deviceName || 'Signal',
    deviceType: fallbackDev ? deviceTypeLabel(fallbackDev.type) : (d.decisionType === 'vision' ? 'Vision System' : 'Signal'),
    testName,
  };
}

/**
 * Derive the Part Tracking table rows for one state machine.
 * Rows are sorted by state number ascending.
 */
export function derivePartTrackingTable(sm, stateMap) {
  if (!sm) return [];

  const rows = [];
  const overrides = sm.partTrackingOverrides ?? {};
  const devices = sm.devices ?? [];
  const nodes = sm.nodes ?? [];

  const getState = (id) => {
    if (!id) return null;
    if (stateMap instanceof Map) return stateMap.get(id) ?? null;
    if (stateMap && typeof stateMap === 'object') return stateMap[id] ?? null;
    return null;
  };

  // ── 1. StationResult (overall station outcome) ───────────────────────
  const completeNode = nodes.find(n => n.data?.isComplete);
  rows.push({
    id: 'row_station_result',
    kind: 'stationResult',
    fieldNameRaw: 'StationResult',
    subjectName: 'This Station',
    subjectType: 'Overall',
    description: 'Rolled-up station outcome — Success if no other PT reject was written this cycle',
    setAtNodeId: completeNode?.id ?? null,
    setAtState: getState(completeNode?.id),
    writeValue: 'Success / Reject',
    dataType: 'bool',
    auto: true,
    enabled: overrides['StationResult']?.enabled !== false,
  });

  // ── 2. Dual-branch decision nodes ─────────────────────────────────────
  for (const node of nodes) {
    if (node.type !== 'decisionNode') continue;
    if (node.data?.exitCount !== 2) continue;

    const { deviceName, deviceType, testName } = resolveDecisionSubject(node, devices);
    const fieldRaw = sanitizeTag(testName) || sanitizeTag(deviceName);
    if (!fieldRaw) continue;

    rows.push({
      id: `row_dec_${node.id}`,
      kind: 'decision',
      fieldNameRaw: fieldRaw,
      subjectName: deviceName,
      subjectType: deviceType,
      description: node.data?.decisionType === 'vision'
        ? 'Vision result → success or reject'
        : 'Decision result → success or reject',
      setAtNodeId: node.id,
      setAtState: getState(node.id),
      writeValue: 'Success / Reject',
      dataType: 'bool',
      auto: true,
      enabled: overrides[fieldRaw]?.enabled !== false,
      _deviceName: deviceName,
    });
  }

  // ── 3. Vision Inspect state actions ───────────────────────────────────
  // Emits a BOOL pass/fail row per inspect + one REAL row per numeric
  // data-output (e.g. X_Offset, PartCount) so downstream stations can read
  // them off the PartTracking UDT.
  for (const node of nodes) {
    if (node.type !== 'stateNode') continue;
    for (const action of node.data?.actions ?? []) {
      if (action.operation !== 'VisionInspect' && action.operation !== 'Inspect') continue;
      const device = devices.find(d => d.id === action.deviceId);
      if (!device) continue;
      const jobName = action.jobName ?? '';
      const fieldRaw = action.ptFieldName
        ? sanitizeTag(action.ptFieldName)
        : sanitizeTag(jobName);
      if (fieldRaw) {
        rows.push({
          id: `row_vis_${node.id}_${action.id}`,
          kind: 'vision',
          fieldNameRaw: fieldRaw,
          subjectName: device.name || device.displayName || '',
          subjectType: deviceTypeLabel(device.type),
          description: 'Vision inspect result → success or reject',
          setAtNodeId: node.id,
          setAtState: getState(node.id),
          writeValue: 'Success / Reject',
          dataType: 'bool',
          auto: true,
          enabled: overrides[fieldRaw]?.enabled !== false,
          _deviceName: device.name,
        });
      }

      // Numeric data outputs defined on the job (REAL values)
      const job = (device.jobs ?? []).find(j => j.name === jobName);
      for (const numOut of (job?.numericOutputs ?? [])) {
        const outName = (numOut?.name ?? '').trim();
        if (!outName) continue;
        const numFieldRaw = sanitizeTag(outName);
        if (!numFieldRaw) continue;
        const safeOut = outName.replace(/[^a-zA-Z0-9_]/g, '');
        const sourceTag = `p_${device.name}_${jobName}_${safeOut}`;
        rows.push({
          id: `row_vis_num_${node.id}_${action.id}_${numFieldRaw}`,
          kind: 'visionNumeric',
          fieldNameRaw: numFieldRaw,
          subjectName: device.name || device.displayName || '',
          subjectType: deviceTypeLabel(device.type),
          description: `Vision data output: ${jobName}.${outName}${numOut.unit ? ` (${numOut.unit})` : ''}`,
          setAtNodeId: node.id,
          setAtState: getState(node.id),
          writeValue: numOut.unit ? `REAL (${numOut.unit})` : 'REAL',
          dataType: 'real',
          unit: numOut.unit ?? '',
          auto: true,
          enabled: overrides[numFieldRaw]?.enabled !== false,
          _deviceName: device.name,
          _jobName: jobName,
          _outputName: outName,
          _sourceTag: sourceTag,
        });
      }
    }
  }

  // ── 4. Analog sensor Check Range actions ──────────────────────────────
  // Each AnalogSensor CheckRange action on a state node becomes a PT row.
  // This fires regardless of whether a decision branch follows — the test
  // result is captured at the state where the probe check runs.
  for (const node of nodes) {
    if (node.type !== 'stateNode') continue;
    for (const action of node.data?.actions ?? []) {
      const device = devices.find(d => d.id === action.deviceId);
      if (!device || device.type !== 'AnalogSensor') continue;
      // ReadValue has no pass/fail concept — skip (numeric PT comes later)
      if (action.operation === 'ReadValue') continue;
      // Accept CheckRange + legacy VerifyValue
      const spName = action.setpointName ?? '';
      if (!spName) continue;

      const fieldRaw = sanitizeTag(spName);
      rows.push({
        id: `row_analog_${node.id}_${action.id}`,
        kind: 'analogCheck',
        fieldNameRaw: fieldRaw,
        subjectName: device.name || device.displayName || '',
        subjectType: deviceTypeLabel(device.type),
        description: `Range check at setpoint ${spName}`,
        setAtNodeId: node.id,
        setAtState: getState(node.id),
        writeValue: 'Success / Reject',
        dataType: 'bool',
        auto: true,
        enabled: overrides[fieldRaw]?.enabled !== false,
        _deviceName: device.name,
        _setpointName: spName,
      });
    }
  }

  // ── 5. Custom rows (user-added) ───────────────────────────────────────
  for (const custom of (overrides.customRows ?? [])) {
    if (!custom?.fieldName) continue;
    rows.push({
      id: custom.id ?? `row_custom_${custom.fieldName}`,
      kind: 'custom',
      fieldNameRaw: sanitizeTag(custom.fieldName),
      subjectName: custom.subjectName ?? 'Manual',
      subjectType: custom.subjectType ?? 'Custom',
      description: custom.description ?? 'User-added PT write',
      setAtNodeId: custom.setAtNodeId ?? null,
      setAtState: getState(custom.setAtNodeId),
      writeValue: custom.writeValue ?? 'Success / Reject',
      dataType: custom.dataType ?? 'bool',
      auto: false,
      enabled: custom.enabled !== false,
      _custom: true,
    });
  }

  // ── Collision resolution: prefix field name with device on collisions ──
  // e.g., two cameras both writing `TestJob` → `Cam1_TestJob`, `Cam2_TestJob`
  {
    const countByField = new Map();
    for (const r of rows) countByField.set(r.fieldNameRaw, (countByField.get(r.fieldNameRaw) ?? 0) + 1);
    for (const r of rows) {
      const dupCount = countByField.get(r.fieldNameRaw) ?? 0;
      if (dupCount > 1 && r._deviceName) {
        r.fieldName = sanitizeTag(`${r._deviceName}_${r.fieldNameRaw}`);
      } else {
        r.fieldName = r.fieldNameRaw;
      }
    }
  }

  // ── Sort by state number ascending (nulls last), StationResult last within tie ──
  rows.sort((a, b) => {
    const sa = a.setAtState ?? Number.POSITIVE_INFINITY;
    const sb = b.setAtState ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    if (a.kind === 'stationResult' && b.kind !== 'stationResult') return 1;
    if (b.kind === 'stationResult' && a.kind !== 'stationResult') return -1;
    return 0;
  });

  return rows;
}

export function getEnabledPtRows(sm, stateMap) {
  return derivePartTrackingTable(sm, stateMap).filter(r => r.enabled);
}

/**
 * Strip legacy inline PT actions (TrackSet/TrackClear on state nodes).
 */
export function stripLegacyPtActions(sm) {
  if (!sm || !Array.isArray(sm.nodes)) return sm;
  let mutated = false;
  const nodes = sm.nodes.map(n => {
    const actions = n.data?.actions;
    if (!Array.isArray(actions) || actions.length === 0) return n;
    const filtered = actions.filter(a => {
      if (a?.deviceId !== '_tracking') return true;
      if (a?.operation === 'TrackSet' || a?.operation === 'TrackClear') {
        mutated = true;
        return false;
      }
      return true;
    });
    if (filtered.length === actions.length) return n;
    return { ...n, data: { ...n.data, actions: filtered } };
  });
  return mutated ? { ...sm, nodes } : sm;
}
