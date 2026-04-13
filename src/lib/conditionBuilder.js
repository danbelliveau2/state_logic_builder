/**
 * conditionBuilder.js
 * Builds auto-generated transition condition options based on the source
 * state's device actions and each device's sensor configuration.
 *
 * Logic per SDC context doc:
 *   Sensor present on operation side  → sensorOn condition
 *   No sensor on operation side       → timer condition
 *   Servo                             → servoAtTarget condition
 *   VacOn / VacOnEject                → sensorTimer (pressure switch + timer)
 *   VacOff                            → timer only (no vac-off sensor)
 */

import { DEVICE_TYPES, getSensorConfigKey } from './deviceTypes.js';
import { getSensorTagForOperation, getDelayTimerForOperation } from './tagNaming.js';

// ── Sensor presence helpers ────────────────────────────────────────────────────

/**
 * Returns true if the device has a physical sensor for the given operation,
 * based on its sensorConfig.
 */
export function hasSensorForOperation(device, operation) {
  const configKey = getSensorConfigKey(device);

  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      if (operation === 'Extend')  return configKey === 'both' || configKey === 'extendOnly';
      if (operation === 'Retract') return configKey === 'both' || configKey === 'retractOnly';
      return false;

    case 'PneumaticGripper':
      if (operation === 'Engage')    return configKey === 'both' || configKey === 'engageOnly';
      if (operation === 'Disengage') return configKey === 'both';
      return false;

    case 'PneumaticVacGenerator':
      return operation === 'VacOn' || operation === 'VacOnEject';

    case 'DigitalSensor':
      return true;

    default:
      return false;
  }
}

/**
 * Returns true if the device+operation requires a delay timer
 * (i.e. no sensor configured for that direction).
 */
export function needsTimerForOperation(device, operation) {
  const configKey = getSensorConfigKey(device);

  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      if (operation === 'Extend')  return configKey === 'retractOnly' || configKey === 'none';
      if (operation === 'Retract') return configKey === 'extendOnly'  || configKey === 'none';
      return false;

    case 'PneumaticGripper':
      if (operation === 'Engage')    return configKey === 'none';
      if (operation === 'Disengage') return configKey === 'engageOnly' || configKey === 'none';
      return false;

    case 'PneumaticVacGenerator':
      return operation === 'VacOff';

    case 'Timer':
      return true;

    default:
      return false;
  }
}

// ── Timer ms helpers ──────────────────────────────────────────────────────────

function getTimerMsForOperation(device, operation) {
  switch (operation) {
    case 'Extend':    return device.extTimerMs      ?? 500;
    case 'Retract':   return device.retTimerMs      ?? 500;
    case 'Engage':    return device.engageTimerMs   ?? 300;
    case 'Disengage': return device.disengageTimerMs ?? 300;
    case 'VacOff':    return device.vacOnTimerMs    ?? 300;
    case 'VacOn':     return device.vacOnTimerMs    ?? 300;
    case 'VacOnEject':return device.vacOnTimerMs    ?? 300;
    default:          return device.timerMs         ?? 1000;
  }
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build auto-generated condition options for a transition leaving sourceNode.
 * Each option represents one possible way the transition can be conditioned.
 *
 * @param {object}   sourceNode - React Flow node (with data.actions[])
 * @param {object[]} devices    - All devices in the state machine
 * @returns {object[]} Array of condition option objects
 */
export function buildAutoConditions(sourceNode, devices) {
  if (!sourceNode) return getDefaultConditions();

  const actions = sourceNode.data?.actions ?? [];
  const conditions = [];

  for (const action of actions) {
    const device = devices.find(d => d.id === action.deviceId);
    if (!device) continue;

    const typeInfo = DEVICE_TYPES[device.type];
    if (!typeInfo) continue;

    const opInfo = typeInfo.operations?.find(op => op.value === action.operation);
    const opLabel = opInfo?.label ?? action.operation;

    switch (device.type) {

      // ── Pneumatic (linear, rotary, gripper) ──────────────────────────────
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator':
      case 'PneumaticGripper': {
        const hasSensor   = hasSensorForOperation(device, action.operation);
        const needsTimer  = needsTimerForOperation(device, action.operation);
        const sensorTag   = getSensorTagForOperation(device, action.operation);
        const timerTag    = getDelayTimerForOperation(device, action.operation);
        const delayMs     = getTimerMsForOperation(device, action.operation);

        if (hasSensor && sensorTag) {
          conditions.push({
            conditionType: 'sensorOn',
            deviceId:      device.id,
            operation:     action.operation,
            sensorTag,
            label:         `${device.displayName} \u2014 ${opLabel} \u2713`,
            description:   `Sensor: ${sensorTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        } else if (needsTimer && timerTag) {
          conditions.push({
            conditionType: 'timer',
            deviceId:      device.id,
            operation:     action.operation,
            timerTag,
            delayMs,
            label:         `${device.displayName} \u2014 ${opLabel} (timer)`,
            description:   `No sensor \u2014 waits ${delayMs}ms: ${timerTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        }
        break;
      }

      // ── Vacuum Generator ──────────────────────────────────────────────────
      case 'PneumaticVacGenerator': {
        const sensorTag = getSensorTagForOperation(device, action.operation);
        const timerTag  = getDelayTimerForOperation(device, action.operation);
        const delayMs   = getTimerMsForOperation(device, action.operation);

        if (action.operation === 'VacOff') {
          if (timerTag) {
            conditions.push({
              conditionType: 'timer',
              deviceId:      device.id,
              operation:     action.operation,
              timerTag,
              delayMs,
              label:         `${device.displayName} \u2014 Vac Off timer`,
              description:   `Timer only (no vac-off sensor)`,
              group:         device.displayName,
              groupColor:    typeInfo.color,
            });
          }
        } else if (sensorTag) {
          conditions.push({
            conditionType: 'sensorTimer',
            deviceId:      device.id,
            operation:     action.operation,
            sensorTag,
            timerTag,
            label:         `${device.displayName} \u2014 ${opLabel} verified`,
            description:   `Sensor: ${sensorTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        }
        break;
      }

      // ── Servo Axis ────────────────────────────────────────────────────────
      case 'ServoAxis': {
        if (action.operation === 'ServoIncr' || action.operation === 'ServoIndex') {
          // Incremental / Index: verify via MAM.PC only (no range check)
          conditions.push({
            conditionType: 'servoComplete',
            deviceId:      device.id,
            operation:     action.operation,
            label:         `${device.displayName} \u2014 Motion Complete`,
            description:   `Servo MAM progress complete`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        } else {
          const posName = action.positionName ?? '';
          conditions.push({
            conditionType: 'servoAtTarget',
            deviceId:      device.id,
            operation:     action.operation,
            positionName:  posName,
            label:         `${device.displayName} \u2014 @ ${posName || '(position)'}`,
            description:   `Servo at target position`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        }
        break;
      }

      // ── Timer / Dwell ─────────────────────────────────────────────────────
      case 'Timer': {
        const timerMs = action.delayMs ?? device.timerMs ?? 1000;
        conditions.push({
          conditionType: 'timer',
          deviceId:      device.id,
          operation:     action.operation,
          timerTag:      device.name,
          delayMs:       timerMs,
          label:         `${device.displayName} \u2014 ${timerMs}ms elapsed`,
          description:   `Dwell timer complete`,
          group:         device.displayName,
          groupColor:    typeInfo.color,
        });
        break;
      }

      // ── Digital Sensor ────────────────────────────────────────────────────
      case 'DigitalSensor': {
        const sensorTag = getSensorTagForOperation(device, action.operation);
        if (action.operation === 'WaitOff') {
          conditions.push({
            conditionType: 'sensorOff',
            deviceId:      device.id,
            operation:     action.operation,
            sensorTag,
            label:         `${device.displayName} \u2014 OFF`,
            description:   `Wait for sensor OFF: ${sensorTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        } else {
          conditions.push({
            conditionType: 'sensorOn',
            deviceId:      device.id,
            operation:     action.operation,
            sensorTag,
            label:         `${device.displayName} \u2014 ON`,
            description:   `Wait for sensor ON: ${sensorTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        }
        break;
      }

      // ── Parameter ─────────────────────────────────────────────────────────
      case 'Parameter': {
        // WaitOn / WaitOff produce transition conditions
        const paramPfx = device.dataType === 'boolean' ? 'q_' : 'p_';
        const paramTag = `${paramPfx}${device.name}`;
        if (action.operation === 'WaitOn') {
          conditions.push({
            conditionType: 'paramOn',
            deviceId:      device.id,
            operation:     action.operation,
            paramTag,
            label:         `${device.displayName} \u2014 = ON`,
            description:   `Wait for parameter ON: ${paramTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        } else if (action.operation === 'WaitOff') {
          conditions.push({
            conditionType: 'paramOff',
            deviceId:      device.id,
            operation:     action.operation,
            paramTag,
            label:         `${device.displayName} \u2014 = OFF`,
            description:   `Wait for parameter OFF: ${paramTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        }
        // SetOn / SetOff / SetValue: output latch — no transition condition generated here
        break;
      }

      // ── Analog Sensor / LVDT ────────────────────────────────────────────
      case 'AnalogSensor': {
        const spName = action.setpointName ?? '';
        const rcTag = `${device.name}${spName}RC`;
        conditions.push({
          conditionType: 'analogInRange',
          deviceId:      device.id,
          operation:     action.operation,
          setpointName:  spName,
          rcTag,
          label:         `${device.displayName} — @ ${spName || '(setpoint)'}`,
          description:   `Value in range: ${rcTag}.In_Range`,
          group:         device.displayName,
          groupColor:    typeInfo.color,
        });
        break;
      }

      // ── CheckResults / Verify ──────────────────────────────────────────
      case 'CheckResults': {
        const outcomes = device.outcomes ?? [];
        if (outcomes.length === 1) {
          // Single condition: standard verify condition (linear)
          const out = outcomes[0];
          conditions.push({
            conditionType: 'singleVerify',
            deviceId:      device.id,
            operation:     action.operation,
            inputRef:      out.inputRef,
            condition:     out.condition,
            label:         `Verify: ${out.label || 'input'}`,
            description:   `Single-condition verify`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        } else {
          for (const outcome of outcomes) {
            conditions.push({
              conditionType: 'checkResult',
              deviceId:      device.id,
              operation:     action.operation,
              outcomeId:     outcome.id,
              outcomeLabel:  outcome.label,
              label:         `${device.displayName} → ${outcome.label}`,
              description:   `Branch: outcome "${outcome.label}"`,
              group:         device.displayName,
              groupColor:    typeInfo.color,
            });
          }
        }
        break;
      }

      // ── Vision System ────────────────────────────────────────────────────
      case 'VisionSystem': {
        if (action.operation === 'VisionInspect' && action.outcomes?.length >= 2) {
          // VisionInspect with branching — outcomes handled via visionResult edges
          for (const outcome of action.outcomes) {
            conditions.push({
              conditionType: 'visionResult',
              deviceId:      device.id,
              operation:     action.operation,
              outcomeId:     outcome.id,
              outcomeLabel:  outcome.label,
              label:         `${device.displayName} → ${outcome.label}`,
              description:   `Branch: vision outcome "${outcome.label}"`,
              group:         device.displayName,
              groupColor:    typeInfo.color,
            });
          }
        } else {
          const dwellMs = device.trigDwellMs ?? 500;
          const trigDwellTag = `${device.name}TrigDwell`;
          conditions.push({
            conditionType: 'timer',
            deviceId:      device.id,
            operation:     action.operation,
            timerTag:      trigDwellTag,
            delayMs:       dwellMs,
            label:         `${device.displayName} — Trigger Dwell (${dwellMs}ms)`,
            description:   `Vision trigger complete, dwell timer: ${trigDwellTag}`,
            group:         device.displayName,
            groupColor:    typeInfo.color,
          });
        }
        break;
      }
    }
  }

  // ── Always append generic options ─────────────────────────────────────────
  conditions.push({
    conditionType: 'always',
    label:         'Immediate (no condition)',
    description:   'Transition fires immediately when step is active',
    group:         'Other',
    groupColor:    '#6b7280',
  });
  conditions.push({
    conditionType: 'trigger',
    label:         'Trigger (PLC tag ON)',
    description:   'Wait for a specific tag to go high',
    group:         'Other',
    groupColor:    '#6b7280',
  });
  conditions.push({
    conditionType: 'custom',
    label:         'Custom tag\u2026',
    description:   'Enter any custom tag/condition',
    group:         'Other',
    groupColor:    '#6b7280',
  });

  return conditions;
}

/** Fallback when no source node is available */
function getDefaultConditions() {
  return [
    {
      conditionType: 'always',
      label:         'Immediate (no condition)',
      description:   'Transition fires immediately',
      group:         'Other',
      groupColor:    '#6b7280',
    },
    {
      conditionType: 'trigger',
      label:         'Trigger (PLC tag ON)',
      description:   'Wait for a tag to go high',
      group:         'Other',
      groupColor:    '#6b7280',
    },
    {
      conditionType: 'custom',
      label:         'Custom tag\u2026',
      description:   'Enter any custom tag/condition',
      group:         'Other',
      groupColor:    '#6b7280',
    },
  ];
}

/**
 * Find the best matching condition option from an autoConditions array
 * for a currently-saved edge condition object.
 */
export function findMatchingCondition(autoConditions, savedCond) {
  if (!savedCond || !savedCond.conditionType) return null;
  return autoConditions.find(c =>
    c.conditionType === savedCond.conditionType &&
    (c.deviceId   === undefined || c.deviceId   === savedCond.deviceId) &&
    (c.operation  === undefined || c.operation  === savedCond.operation) &&
    (c.positionName === undefined || c.positionName === savedCond.positionName) &&
    (c.outcomeId  === undefined || c.outcomeId  === savedCond.outcomeId)
  ) ?? null;
}

// ── Verify condition builder (for edge labels) ───────────────────────────────

/** Map an operation to its opposite direction */
function getOppositeOperation(operation) {
  switch (operation) {
    case 'Extend':    return 'Retract';
    case 'Retract':   return 'Extend';
    case 'Engage':    return 'Disengage';
    case 'Disengage': return 'Engage';
    default:          return null;
  }
}

/**
 * Build verify1 + verify2 condition text for a transition leaving sourceNode.
 * Returns { label: string, conditions: array } where label is multiline
 * "tag=state" text suitable for an edge label, and conditions is the
 * structured array for L5X export.
 *
 * Verify rules per SDC standard:
 *   verify1 (departure): opposite-direction sensor OFF  (if that sensor exists)
 *   verify2 (arrival):   target-direction sensor ON     (if sensor exists)
 *                    OR   target-direction delay timer   (if no sensor)
 */
export function buildVerifyLabel(sourceNode, devices) {
  if (!sourceNode) return { label: '', conditions: [] };

  const actions = sourceNode.data?.actions ?? [];
  const conditions = [];

  for (const action of actions) {
    const device = devices.find(d => d.id === action.deviceId);
    if (!device) continue;

    switch (device.type) {

      // ── Pneumatic (linear, rotary, gripper) ──────────────────────────────
      // Each direction gets EITHER a sensor OR a timer, never both.
      // verify1 (departure): opposite sensor OFF — only if that sensor exists
      // verify2 (arrival):   target sensor ON — or delay timer if no sensor
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator':
      case 'PneumaticGripper': {
        const oppOp = getOppositeOperation(action.operation);

        // verify1: departure — opposite sensor OFF (only if opposite HAS a sensor)
        if (oppOp && hasSensorForOperation(device, oppOp)) {
          const depTag = getSensorTagForOperation(device, oppOp);
          if (depTag) {
            conditions.push({ tag: depTag, state: 'Off', role: 'departure',
              deviceId: device.id, operation: action.operation });
          }
        }

        // verify2: arrival — sensor if exists, else timer
        if (hasSensorForOperation(device, action.operation)) {
          const arrTag = getSensorTagForOperation(device, action.operation);
          if (arrTag) {
            conditions.push({ tag: arrTag, state: 'On', role: 'arrival',
              deviceId: device.id, operation: action.operation });
          }
        } else {
          const timerTag = getDelayTimerForOperation(device, action.operation);
          if (timerTag) {
            const ms = getTimerMsForOperation(device, action.operation);
            conditions.push({ tag: timerTag, state: String(ms), role: 'timer',
              deviceId: device.id, operation: action.operation });
          }
        }
        break;
      }

      // ── Vacuum Generator ──────────────────────────────────────────────────
      case 'PneumaticVacGenerator': {
        const sensorTag = getSensorTagForOperation(device, action.operation);
        const timerTag  = getDelayTimerForOperation(device, action.operation);
        const ms        = getTimerMsForOperation(device, action.operation);

        if (sensorTag) {
          conditions.push({ tag: sensorTag, state: 'On', role: 'sensor',
            deviceId: device.id, operation: action.operation });
        }
        if (timerTag && !sensorTag) {
          conditions.push({ tag: timerTag, state: String(ms), role: 'timer',
            deviceId: device.id, operation: action.operation });
        }
        break;
      }

      // ── Servo Axis ────────────────────────────────────────────────────────
      case 'ServoAxis': {
        // VerifyCond1: MAM Progress Complete
        conditions.push({ tag: `${device.name}iq_MAM.PC`, state: 'On', role: 'servo-mam',
          deviceId: device.id, operation: action.operation });
        // VerifyCond2: Position In_Range — only for ServoMove with known position (not for ServoIncr/ServoIndex)
        if (action.operation === 'ServoMove') {
          const posName = action.positionName ?? '';
          if (posName) {
            conditions.push({ tag: `${device.name}iq_${posName}RC.In_Range`, state: 'On', role: 'servo-inrange',
              deviceId: device.id, operation: action.operation });
          }
        }
        break;
      }

      // ── Timer / Dwell ─────────────────────────────────────────────────────
      case 'Timer': {
        const ms = action.delayMs ?? device.timerMs ?? 1000;
        conditions.push({ tag: device.name, state: String(ms), role: 'timer',
          deviceId: device.id, operation: action.operation });
        break;
      }

      // ── Digital Sensor ────────────────────────────────────────────────────
      case 'DigitalSensor': {
        const sensorTag = getSensorTagForOperation(device, action.operation);
        if (sensorTag) {
          const state = action.operation === 'WaitOff' ? 'Off' : 'On';
          conditions.push({ tag: sensorTag, state, role: 'sensor',
            deviceId: device.id, operation: action.operation });
        }
        break;
      }

      // ── Parameter ─────────────────────────────────────────────────────────
      case 'Parameter': {
        // Only WaitOn / WaitOff produce verify conditions; Set ops produce output latches
        const pPfx = device.dataType === 'boolean' ? 'q_' : 'p_';
        if (action.operation === 'WaitOn') {
          const tag = `${pPfx}${device.name}`;
          conditions.push({ tag, state: 'On', role: 'param',
            deviceId: device.id, operation: action.operation });
        } else if (action.operation === 'WaitOff') {
          const tag = `${pPfx}${device.name}`;
          conditions.push({ tag, state: 'Off', role: 'param',
            deviceId: device.id, operation: action.operation });
        }
        break;
      }

      // ── Analog Sensor / LVDT ──────────────────────────────────────────
      case 'AnalogSensor': {
        const spName = action.setpointName ?? '';
        if (spName) {
          const rcTag = `${device.name}${spName}RC`;
          conditions.push({ tag: `${rcTag}.In_Range`, state: 'On', role: 'analog-inrange',
            deviceId: device.id, operation: action.operation });
        }
        break;
      }

      // ── CheckResults / Verify (single condition = linear verify) ──────
      case 'CheckResults': {
        const outcomes = device.outcomes ?? [];
        if (outcomes.length === 1 && outcomes[0].label) {
          const out = outcomes[0];
          const state = (out.condition === 'off' || out.condition === 'outOfRange') ? 'Off' : 'On';
          conditions.push({ tag: out.label, state, role: 'verify-input',
            deviceId: device.id, operation: action.operation });
        }
        // 2+ outcomes: skip — branching handled in Canvas edge data
        break;
      }

      // ── Vision System ───────────────────────────────────────────────────
      case 'VisionSystem': {
        if (action.operation === 'VisionInspect' && action.outcomes?.length >= 2) {
          // VisionInspect with branching — skip here, handled in Canvas edge data
          break;
        }
        // The verify condition after the full vision sequence is the trigger dwell timer
        const trigDwellTag = `${device.name}TrigDwell`;
        const ms = device.trigDwellMs ?? 500;
        conditions.push({ tag: trigDwellTag, state: String(ms), role: 'timer',
          deviceId: device.id, operation: action.operation });
        break;
      }
    }
  }

  const label = conditions.map(c => `${c.tag}=${c.state}`).join('\n');
  return { label, conditions };
}
