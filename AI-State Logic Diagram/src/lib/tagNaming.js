/**
 * SDC Tag Naming Utilities
 * Based on PLC Software Standardization Guide Rev1
 *
 * Conventions:
 *  PascalCase throughout (each word capitalized, no spaces)
 *  g_  = global/controller scope
 *  p_  = public parameter (HMI/recipe visible)
 *  i_  = input parameter (sensor inputs)
 *  q_  = output parameter (solenoid/drive outputs)
 *  No prefix = local tag
 *
 * Device tags from SDC_StateLogic_Template_rev5.1.xlsm:
 *  i_{DeviceName}Ext        - extend proximity sensor
 *  i_{DeviceName}Ret        - retract proximity sensor
 *  q_Ext{DeviceName}        - extend solenoid output
 *  q_Ret{DeviceName}        - retract solenoid output
 *  {DeviceName}ExtDelay     - extend verify delay TIMER (local)
 *  {DeviceName}RetDelay     - retract verify delay TIMER (local)
 */

import { DEVICE_TYPES } from './deviceTypes.js';

/**
 * Resolve a tag pattern for a device, replacing {name}, {axisNum}, etc.
 */
function resolvePattern(pattern, device, extras = {}) {
  return pattern
    .replace(/\{name\}/g, device.name)
    .replace(/\{axisNum\}/g, String(device.axisNumber ?? '01').padStart(2, '0'))
    .replace(/\{positionName\}/g, extras.positionName ?? '')
    .replace(/\{step\}/g, extras.step ?? '0')
    .replace(/\{delayMs\}/g, extras.delayMs ?? '0');
}

/**
 * Get all tags generated for a device (for tag declarations in L5X)
 * Returns array of { name, usage, dataType, description, preMs }
 */
export function getDeviceTags(device) {
  const type = DEVICE_TYPES[device.type];
  if (!type) return [];

  const tags = [];
  const patterns = type.tagPatterns;
  const sensorCount = device.sensorArrangement?.includes('2-sensor') ? 2 : 1;

  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      // Extend sensor (always present)
      if (sensorCount === 2) {
        tags.push({
          name: resolvePattern(patterns.inputExt, device),
          usage: 'Input',
          dataType: 'BOOL',
          description: `${device.displayName} - Extend proximity sensor`,
        });
      }
      // Retract sensor
      tags.push({
        name: resolvePattern(patterns.inputRet, device),
        usage: 'Input',
        dataType: 'BOOL',
        description: `${device.displayName} - Retract proximity sensor`,
      });
      // Outputs
      tags.push({
        name: resolvePattern(patterns.outputExtend, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Extend solenoid`,
      });
      tags.push({
        name: resolvePattern(patterns.outputRetract, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Retract solenoid`,
      });
      // Delay timers (local)
      tags.push({
        name: resolvePattern(patterns.timerExt, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Extend verify delay timer`,
        preMs: device.extTimerMs ?? type.defaultTimerPreMs,
      });
      tags.push({
        name: resolvePattern(patterns.timerRet, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Retract verify delay timer`,
        preMs: device.retTimerMs ?? type.defaultTimerPreMs,
      });
      // Debounce timers (local)
      if (sensorCount === 2) {
        tags.push({
          name: resolvePattern(patterns.debounceExt, device),
          usage: 'Local',
          dataType: 'TIMER',
          description: `${device.displayName} - Extend sensor debounce`,
          preMs: 10,
        });
      }
      tags.push({
        name: resolvePattern(patterns.debounceRet, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Retract sensor debounce`,
        preMs: 10,
      });
      break;

    case 'PneumaticGripper': {
      const sensorCountG = device.sensorArrangement?.includes('2-sensor') ? 2 : 1;
      tags.push({
        name: resolvePattern(patterns.inputEngage, device),
        usage: 'Input',
        dataType: 'BOOL',
        description: `${device.displayName} - Engaged sensor`,
      });
      if (sensorCountG === 2) {
        tags.push({
          name: resolvePattern(patterns.inputDisengage, device),
          usage: 'Input',
          dataType: 'BOOL',
          description: `${device.displayName} - Disengaged sensor`,
        });
      }
      tags.push({
        name: resolvePattern(patterns.outputEngage, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Engage solenoid`,
      });
      tags.push({
        name: resolvePattern(patterns.outputDisengage, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Disengage solenoid`,
      });
      tags.push({
        name: resolvePattern(patterns.timerEngage, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Engage verify delay timer`,
        preMs: device.engageTimerMs ?? type.defaultTimerPreMs,
      });
      tags.push({
        name: resolvePattern(patterns.timerDisengage, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Disengage verify delay timer`,
        preMs: device.disengageTimerMs ?? type.defaultTimerPreMs,
      });
      tags.push({
        name: resolvePattern(patterns.debounceEngage, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Engage debounce`,
        preMs: 10,
      });
      break;
    }

    case 'PneumaticVacGenerator':
      tags.push({
        name: resolvePattern(patterns.inputVacOn, device),
        usage: 'Input',
        dataType: 'BOOL',
        description: `${device.displayName} - Vacuum established sensor`,
      });
      tags.push({
        name: resolvePattern(patterns.outputVacOn, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Vac On solenoid`,
      });
      tags.push({
        name: resolvePattern(patterns.outputVacOff, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Vac Off solenoid`,
      });
      if (device.hasEject) {
        tags.push({
          name: resolvePattern(patterns.outputVacOnEject, device),
          usage: 'Output',
          dataType: 'BOOL',
          description: `${device.displayName} - Vac On + Eject solenoid`,
        });
        tags.push({
          name: resolvePattern(patterns.timerVacOnEject, device),
          usage: 'Local',
          dataType: 'TIMER',
          description: `${device.displayName} - Eject verify delay timer`,
          preMs: device.vacEjectTimerMs ?? type.defaultTimerPreMs,
        });
      }
      tags.push({
        name: resolvePattern(patterns.timerVacOn, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Vac On verify delay timer`,
        preMs: device.vacOnTimerMs ?? type.defaultTimerPreMs,
      });
      break;

    case 'ServoAxis':
      // Axis tag (CIP Motion - no Local/Input/Output, it's a special type)
      tags.push({
        name: resolvePattern(patterns.axisTag, device),
        usage: 'Local',
        dataType: 'AXIS_CIP_DRIVE',
        description: `${device.displayName} - CIP Axis`,
        isAxis: true,
      });
      // MAM control tag per axis
      tags.push({
        name: resolvePattern(patterns.mamControl, device),
        usage: 'Local',
        dataType: 'MOTION_INSTRUCTION',
        description: `${device.displayName} - Motion instruction control`,
      });
      // Position parameters (one per defined position)
      if (device.positions) {
        for (const pos of device.positions) {
          tags.push({
            name: resolvePattern(patterns.positionParam, device, { positionName: pos.name }),
            usage: pos.isRecipe ? 'Public' : 'Local',
            dataType: 'REAL',
            description: `${device.displayName} - ${pos.name} position${pos.isRecipe ? ' (recipe)' : ''}`,
            defaultValue: pos.defaultValue ?? 0.0,
          });
        }
      }
      break;

    case 'Timer':
      tags.push({
        name: device.name,
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Dwell timer`,
        preMs: device.timerMs ?? type.defaultTimerPreMs,
      });
      break;

    case 'DigitalSensor':
      tags.push({
        name: resolvePattern(patterns.inputTag, device),
        usage: 'Input',
        dataType: 'BOOL',
        description: `${device.displayName} - Sensor input`,
      });
      tags.push({
        name: resolvePattern(patterns.debounce, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Input debounce`,
        preMs: 10,
      });
      break;
  }

  return tags;
}

/**
 * Get the sensor tag name for verifying a specific operation on a device
 */
export function getSensorTagForOperation(device, operation) {
  const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
  if (!patterns) return null;

  const map = {
    Extend:    patterns.inputExt,
    Retract:   patterns.inputRet,
    Engage:    patterns.inputEngage,
    Disengage: patterns.inputDisengage,
    VacOn:     patterns.inputVacOn,
    VacOnEject:patterns.inputVacOnEject,
    WaitOn:    patterns.inputTag,
    WaitOff:   patterns.inputTag,
    Verify:    patterns.inputTag,
  };

  const pattern = map[operation];
  if (!pattern) return null;
  return resolvePattern(pattern, device);
}

/**
 * Get the output tag name for an operation
 */
export function getOutputTagForOperation(device, operation) {
  const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
  if (!patterns) return null;

  const map = {
    Extend:    patterns.outputExtend,
    Retract:   patterns.outputRetract,
    Engage:    patterns.outputEngage,
    Disengage: patterns.outputDisengage,
    VacOn:     patterns.outputVacOn,
    VacOff:    patterns.outputVacOff,
    VacOnEject:patterns.outputVacOnEject,
  };

  const pattern = map[operation];
  if (!pattern) return null;
  return resolvePattern(pattern, device);
}

/**
 * Get the delay timer tag for an operation
 */
export function getDelayTimerForOperation(device, operation) {
  const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
  if (!patterns) return null;

  const map = {
    Extend:    patterns.timerExt,
    Retract:   patterns.timerRet,
    Engage:    patterns.timerEngage,
    Disengage: patterns.timerDisengage,
    VacOn:     patterns.timerVacOn,
    VacOnEject:patterns.timerVacOnEject,
  };

  const pattern = map[operation];
  if (!pattern) return null;
  return resolvePattern(pattern, device);
}

/**
 * Get the axis tag name for a servo device
 */
export function getAxisTag(device) {
  if (device.type !== 'ServoAxis') return null;
  return resolvePattern(DEVICE_TYPES.ServoAxis.tagPatterns.axisTag, device);
}

/**
 * Get a position parameter tag for a servo at a named position
 */
export function getPositionTag(device, positionName) {
  if (device.type !== 'ServoAxis') return null;
  return resolvePattern(
    DEVICE_TYPES.ServoAxis.tagPatterns.positionParam,
    device,
    { positionName }
  );
}

/**
 * Build the program name per SDC convention: S{nn}_{PascalCaseName}
 */
export function buildProgramName(stationNumber, name) {
  const num = String(stationNumber).padStart(2, '0');
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '');
  return `S${num}_${cleaned}`;
}

/**
 * Auto-generate transition label text for display on edges
 */
export function buildTransitionLabel(condition, devices) {
  if (!condition) return '?';

  switch (condition.conditionType) {
    case 'trigger':
      return `Trigger @ ${condition.tagName || '?'}`;
    case 'indexComplete':
      return 'Index Complete';
    case 'servoAtTarget': {
      const dev = devices?.find(d => d.id === condition.deviceId);
      return `@ '${condition.positionName || '?'}'${dev ? ` (${dev.displayName})` : ''}`;
    }
    case 'sensorTimer': {
      const dev = devices?.find(d => d.id === condition.deviceId);
      return dev
        ? `'${dev.displayName}' ${condition.operation || ''} & Timer`
        : 'Sensor + Timer';
    }
    case 'sensorOn': {
      const dev = devices?.find(d => d.id === condition.deviceId);
      return dev ? `'${dev.displayName}' ON` : 'Sensor ON';
    }
    case 'sensorOff': {
      const dev = devices?.find(d => d.id === condition.deviceId);
      return dev ? `'${dev.displayName}' OFF` : 'Sensor OFF';
    }
    case 'timer':
      return `Timer ${condition.delayMs ?? '?'}ms`;
    case 'partPresent':
      return `Part Present w/ Debounce`;
    case 'escapementComplete':
      return 'Escapement Complete';
    case 'always':
      return '(immediate)';
    case 'custom':
      return condition.customLabel || condition.tagName || '(custom)';
    default:
      return condition.label || '?';
  }
}
