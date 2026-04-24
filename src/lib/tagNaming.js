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
 * Resolve a tag pattern for a device, replacing {name}, {Name}, {axisNum}, {station}, etc.
 * {name} and {Name} are both the device's PascalCase name (device.name is already PascalCase
 * per SDC convention); {Name} is an alias to keep pattern strings readable where the
 * guide writes "{Name}Ready", etc.
 * {station} requires extras.stationNumber (the SM's stationNumber) to be padded 2-digit.
 */
function resolvePattern(pattern, device, extras = {}) {
  const stationNum = extras.stationNumber ?? device._stationNumber ?? 1;
  const axisNum = device.axisNumber ?? extras.axisNumber ?? 1;
  return pattern
    .replace(/\{name\}/g, device.name)
    .replace(/\{Name\}/g, device.name)
    .replace(/\{axisNum\}/g, String(axisNum).padStart(2, '0'))
    .replace(/\{station\}/g, String(stationNum).padStart(2, '0'))
    .replace(/\{positionName\}/g, extras.positionName ?? '')
    .replace(/\{setpointName\}/g, extras.setpointName ?? '')
    .replace(/\{step\}/g, extras.step ?? '0')
    .replace(/\{delayMs\}/g, extras.delayMs ?? '0');
}

/**
 * Get all tags generated for a device (for tag declarations in L5X)
 * Returns array of { name, usage, dataType, description, preMs }
 *
 * @param {object} device - device definition
 * @param {object} [context] - { stationNumber } to resolve {station} in tag patterns
 */
export function getDeviceTags(device, context = {}) {
  const type = DEVICE_TYPES[device.type];
  if (!type) return [];

  const tags = [];
  const patterns = type.tagPatterns;
  const sensorCount = device.sensorArrangement?.includes('2-sensor') ? 2 : 1;
  const extras = { stationNumber: context.stationNumber ?? device._stationNumber ?? 1 };

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

    case 'ServoAxis': {
      // SDC Guide §15.4: Servo architecture.
      // Program scope carries an InOut alias to the controller-scope AXIS_CIP_DRIVE tag,
      // a ServoOverall HMI block, and all motion instruction + support tags per axis.
      // The controller-scope axis tag (a{NN}_S{station}{name}) is emitted separately
      // from exportToL5X — NOT here.

      // iq_{name} InOut alias to controller-scope axis.
      tags.push({
        name: resolvePattern(patterns.axisInOut, device, extras),
        usage: 'InOut',
        dataType: 'AXIS_CIP_DRIVE',
        description: `${device.displayName} - CIP Axis (controller-scope alias)`,
        isAxis: true,
        // Record the controller-scope target so the exporter can wire the alias.
        axisControllerTag: resolvePattern(patterns.axisTag, device, extras),
      });

      // HMI_{name} — ServoOverall UDT (HMI-visible Status/Control/Parameters/Momentary).
      tags.push({
        name: resolvePattern(patterns.hmiTag, device, extras),
        usage: 'Public',
        dataType: 'ServoOverall',
        description: `${device.displayName} - HMI block`,
      });

      // Motion instruction instances (MOTION_INSTRUCTION, Local).
      const motionInstPatterns = [
        { key: 'msoInst',     desc: 'MSO - Servo On' },
        { key: 'msfInst',     desc: 'MSF - Servo Off' },
        { key: 'mafrInst',    desc: 'MAFR - Axis Fault Reset' },
        { key: 'masrInst',    desc: 'MASR - Shutdown Reset' },
        { key: 'majInst',     desc: 'MAJ - Jog' },
        { key: 'masJogInst',  desc: 'MAS - Stop Jog' },
        { key: 'masAllInst',  desc: 'MAS - Stop All' },
        { key: 'mahInst',     desc: 'MAH - Home' },
        { key: 'mamAutoInst', desc: 'MAM - Auto Move' },
        { key: 'mamInchInst', desc: 'MAM - Inch' },
      ];
      for (const m of motionInstPatterns) {
        const patt = patterns[m.key];
        if (!patt) continue;
        tags.push({
          name: resolvePattern(patt, device, extras),
          usage: 'Local',
          dataType: 'MOTION_INSTRUCTION',
          description: `${device.displayName} - ${m.desc}`,
        });
      }

      // Per-axis support tags. Data type noted per-tag.
      const supportPatterns = [
        { key: 'readyTag',            desc: 'Ready',               dataType: 'BOOL' },
        { key: 'enableDelayTag',      desc: 'Enable Debounce',     dataType: 'TIMER' },
        { key: 'onsTag',              desc: 'ONS Bits',            dataType: 'DINT' },
        { key: 'permissiveTag',       desc: 'Motion Permissive',   dataType: 'BOOL' },
        { key: 'autoEnableTag',       desc: 'Auto Enable',         dataType: 'BOOL' },
        { key: 'jogDirectionTag',     desc: 'Jog Direction',       dataType: 'DINT' },
        { key: 'inchAmountTag',       desc: 'Inch Amount',         dataType: 'REAL' },
        { key: 'homeConfirmedTag',    desc: 'Home Confirmed',      dataType: 'BOOL' },  // sic
        { key: 'homeConfirmDelayTag', desc: 'Home Confirm Delay',  dataType: 'TIMER' },
        { key: 'homeRequestedTag',    desc: 'Home Requested',      dataType: 'BOOL' },
        { key: 'homeSelectTag',       desc: 'Home Select',         dataType: 'BOOL' },
        { key: 'torqueHomeTag',       desc: 'Torque Home AOI',     dataType: 'AOI_TorqueHome' },
        { key: 'manMoveTrigTag',      desc: 'Manual Move Trigger', dataType: 'BOOL' },
        { key: 'motionParamsTag',     desc: 'MAM Parameters',      dataType: 'MAMParam' },
      ];
      for (const s of supportPatterns) {
        const patt = patterns[s.key];
        if (!patt) continue;
        tags.push({
          name: resolvePattern(patt, device, extras),
          usage: 'Local',
          dataType: s.dataType,
          description: `${device.displayName} - ${s.desc}`,
        });
      }

      // Per-position REAL parameter tags — p_{name}{positionName}. Engineer
      // references these directly in MAM position-select rungs (no array indirection).
      for (const pos of (device.positions ?? [])) {
        if (!pos?.name) continue;
        tags.push({
          name: resolvePattern(patterns.positionParam, device, { positionName: pos.name }),
          usage: 'Local',
          dataType: 'REAL',
          description: `${device.displayName} - ${pos.name} position setpoint`,
          defaultValue: pos.value ?? 0.0,
        });
      }
      break;
    }

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

    case 'AnalogSensor':
      // REAL analog input
      tags.push({
        name: resolvePattern(patterns.inputTag, device),
        usage: 'Input',
        dataType: 'REAL',
        description: `${device.displayName} - Analog input`,
      });
      // Per-setpoint: REAL parameter + AOI_RangeCheck instance
      if (device.setpoints) {
        for (const sp of device.setpoints) {
          tags.push({
            name: resolvePattern(patterns.setpointParam, device, { setpointName: sp.name }),
            usage: sp.isRecipe ? 'Public' : 'Local',
            dataType: 'REAL',
            description: `${device.displayName} - ${sp.name} setpoint${sp.isRecipe ? ' (recipe)' : ''}`,
            defaultValue: sp.defaultValue ?? 0.0,
          });
          tags.push({
            name: resolvePattern(patterns.rangeCheckInst, device, { setpointName: sp.name }),
            usage: 'Local',
            dataType: 'AOI_RangeCheck',
            description: `${device.displayName} - At ${sp.name}`,
          });
        }
      }
      break;

    case 'Parameter':
      // Only owned parameters get a tag declaration; cross-SM references are
      // defined in the source program and referenced by scope path at export time.
      // Global scope → Public (visible to other programs); Local → Local (private to this SM).
      if (device.paramScope !== 'cross-sm') {
        const paramPrefix = device.dataType === 'boolean' ? 'q_' : 'p_';
        tags.push({
          name: `${paramPrefix}${device.name}`,
          usage: device.paramScope === 'global' ? 'Public' : 'Local',
          dataType: device.dataType === 'numeric' ? 'REAL' : 'BOOL',
          description: `${device.displayName} - Parameter`,
          defaultValue: device.dataType === 'numeric' ? 0.0 : 0,
        });
      }
      break;

    case 'Custom': {
      const cDef = device.customTypeDef;
      if (!cDef) break;
      // Custom outputs
      for (const out of (cDef.outputs ?? [])) {
        if (!out.tagPattern) continue;
        tags.push({
          name: resolvePattern(out.tagPattern, device),
          usage: 'Output',
          dataType: 'BOOL',
          description: `${device.displayName} - ${out.name} output`,
        });
      }
      // Custom inputs
      for (const inp of (cDef.inputs ?? [])) {
        if (!inp.tagPattern) continue;
        tags.push({
          name: resolvePattern(inp.tagPattern, device),
          usage: 'Input',
          dataType: inp.dataType || 'BOOL',
          description: `${device.displayName} - ${inp.name} input`,
        });
      }
      // Analog I/O
      for (const aio of (cDef.analogIO ?? [])) {
        if (!aio.tagPattern) continue;
        tags.push({
          name: resolvePattern(aio.tagPattern, device),
          usage: aio.direction === 'input' ? 'Input' : 'Output',
          dataType: 'REAL',
          description: `${device.displayName} - ${aio.name} (analog)`,
        });
      }
      // Timers from operations
      for (const op of (cDef.operations ?? [])) {
        if (!op.timerSuffix) continue;
        tags.push({
          name: `${device.name}${op.timerSuffix}`,
          usage: 'Local',
          dataType: 'TIMER',
          description: `${device.displayName} - ${op.label} verify delay`,
          preMs: op.defaultTimerMs ?? 500,
        });
      }
      break;
    }

    case 'VisionSystem':
      tags.push({
        name: resolvePattern(patterns.triggerReady, device),
        usage: 'Input',
        dataType: 'BOOL',
        description: `${device.displayName} - Trigger Ready`,
      });
      tags.push({
        name: resolvePattern(patterns.trigger, device),
        usage: 'Output',
        dataType: 'BOOL',
        description: `${device.displayName} - Camera Trigger`,
      });
      tags.push({
        name: resolvePattern(patterns.waitTimer, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Wait Timer`,
        preMs: device.waitTimerMs ?? type.defaultTimerPreMs,
      });
      tags.push({
        name: resolvePattern(patterns.trigDwell, device),
        usage: 'Local',
        dataType: 'TIMER',
        description: `${device.displayName} - Trigger Dwell`,
        preMs: device.trigDwellMs ?? 500,
      });
      // Numeric outputs per job (vision data values — X_Offset, PartCount, etc.)
      for (const job of (device.jobs ?? [])) {
        for (const numOut of (job.numericOutputs ?? [])) {
          if (!numOut.name?.trim()) continue;
          const tagName = `p_${device.name}_${job.name}_${numOut.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
          tags.push({
            name: tagName,
            usage: 'Public',
            dataType: 'REAL',
            description: `${device.displayName} ${job.name} - ${numOut.name}${numOut.unit ? ` (${numOut.unit})` : ''}`,
          });
        }
      }
      break;
  }

  return tags;
}

/**
 * Get the fully-scoped tag name for a Parameter device.
 * SDC convention: q_ prefix for boolean params, p_ for numeric (REAL).
 * Local:    q_{name}  or  p_{name}
 * Cross-SM: \{ProgramName}.q_{name}  or  \{ProgramName}.p_{name}
 *
 * @param {object}   device          - The Parameter device object
 * @param {object[]} allStateMachines - All SMs in the project (for cross-SM lookup)
 */
export function getParameterTag(device, allStateMachines = []) {
  if (device.type !== 'Parameter') return null;
  const prefix = device.dataType === 'boolean' ? 'q_' : 'p_';
  const localTag = `${prefix}${device.name}`;
  if (device.paramScope === 'cross-sm' && device.crossSmId) {
    const crossSm = allStateMachines.find(sm => sm.id === device.crossSmId);
    if (crossSm) {
      const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
      return `\\${progName}.${localTag}`;
    }
  }
  return localTag;
}

/**
 * Get the sensor tag name for verifying a specific operation on a device
 */
export function getSensorTagForOperation(device, operation) {
  const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
  if (!patterns) return null;

  // Custom device: resolve from customTypeDef operations
  if (device.type === 'Custom' && device.customTypeDef) {
    const cOp = device.customTypeDef.operations?.find(o => o.value === operation);
    if (cOp?.inputToVerify) {
      const inp = device.customTypeDef.inputs?.find(i => i.name === cOp.inputToVerify);
      if (inp?.tagPattern) return resolvePattern(inp.tagPattern, device);
    }
    return null;
  }

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
  // Custom device: resolve from customTypeDef operations
  if (device.type === 'Custom' && device.customTypeDef) {
    const cOp = device.customTypeDef.operations?.find(o => o.value === operation);
    if (cOp?.outputsToEnergize?.length > 0) {
      const out = device.customTypeDef.outputs?.find(o => o.name === cOp.outputsToEnergize[0]);
      if (out?.tagPattern) return resolvePattern(out.tagPattern, device);
    }
    return null;
  }

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
  // Custom device: resolve from customTypeDef operations
  if (device.type === 'Custom' && device.customTypeDef) {
    const cOp = device.customTypeDef.operations?.find(o => o.value === operation);
    if (cOp?.timerSuffix) return `${device.name}${cOp.timerSuffix}`;
    return null;
  }

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
    case 'analogInRange': {
      const dev = devices?.find(d => d.id === condition.deviceId);
      return `@ '${condition.setpointName || '?'}'${dev ? ` (${dev.displayName})` : ''}`;
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
