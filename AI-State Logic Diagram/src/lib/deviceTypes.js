/**
 * SDC Device Type Definitions
 * Based on SDC_StateLogic_Template_rev5.1.xlsm and PLC Software Standardization Guide Rev1
 *
 * Each device type defines:
 *  - label: display name in UI
 *  - icon: emoji icon for UI
 *  - color: accent color for node display
 *  - operations: available actions an ME can assign to a state
 *  - sensorArrangements: '1-sensor' | '2-sensor' (for pneumatic actuators)
 *  - tagPatterns: how tags are named (use {name} as placeholder)
 *  - defaultTimerPreMs: default delay timer preset in milliseconds
 */

export const DEVICE_TYPES = {
  PneumaticLinearActuator: {
    label: 'Cylinder / Linear Actuator',
    icon: '⬆',
    color: '#3b82f6',
    colorBg: '#eff6ff',
    category: 'Pneumatic',
    operations: [
      { value: 'Extend', label: 'Extend', verb: 'Extend', icon: '⬆' },
      { value: 'Retract', label: 'Retract', verb: 'Retract', icon: '⬇' },
    ],
    sensorArrangements: ['1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
    defaultSensorArrangement: '2-sensor (Ext + Ret)',
    tagPatterns: {
      inputExt:       'i_{name}Ext',
      inputRet:       'i_{name}Ret',
      outputExtend:   'q_Ext{name}',
      outputRetract:  'q_Ret{name}',
      timerExt:       '{name}ExtDelay',
      timerRet:       '{name}RetDelay',
      debounceExt:    '{name}ExtDebounce',
      debounceRet:    '{name}RetDebounce',
    },
    defaultTimerPreMs: 500,
    // Transition condition auto-generated after each operation:
    transitionConditions: {
      Extend: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ext',
        timerTag: '{name}ExtDelay',
        labelTemplate: "'{deviceName}' Extended & Timer",
      },
      Retract: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ret',
        timerTag: '{name}RetDelay',
        labelTemplate: "'{deviceName}' Retracted & Timer",
      },
    },
  },

  PneumaticRotaryActuator: {
    label: 'Rotary Actuator',
    icon: '↺',
    color: '#6366f1',
    colorBg: '#eef2ff',
    category: 'Pneumatic',
    operations: [
      { value: 'Extend', label: 'Extend (CW)', verb: 'Extend', icon: '↺' },
      { value: 'Retract', label: 'Retract (CCW)', verb: 'Retract', icon: '↻' },
    ],
    sensorArrangements: ['1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
    defaultSensorArrangement: '2-sensor (Ext + Ret)',
    tagPatterns: {
      inputExt:       'i_{name}Ext',
      inputRet:       'i_{name}Ret',
      outputExtend:   'q_Ext{name}',
      outputRetract:  'q_Ret{name}',
      timerExt:       '{name}ExtDelay',
      timerRet:       '{name}RetDelay',
      debounceExt:    '{name}ExtDebounce',
      debounceRet:    '{name}RetDebounce',
    },
    defaultTimerPreMs: 500,
    transitionConditions: {
      Extend: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ext',
        timerTag: '{name}ExtDelay',
        labelTemplate: "'{deviceName}' Extended",
      },
      Retract: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ret',
        timerTag: '{name}RetDelay',
        labelTemplate: "'{deviceName}' Retracted",
      },
    },
  },

  PneumaticGripper: {
    label: 'Gripper',
    icon: '✋',
    color: '#22c55e',
    colorBg: '#f0fdf4',
    category: 'Pneumatic',
    operations: [
      { value: 'Engage', label: 'Engage (Close)', verb: 'Engage', icon: '✊' },
      { value: 'Disengage', label: 'Disengage (Open)', verb: 'Disengage', icon: '✋' },
    ],
    sensorArrangements: ['1-sensor (Engaged only)', '2-sensor (Eng + Dis)'],
    defaultSensorArrangement: '1-sensor (Engaged only)',
    tagPatterns: {
      inputEngage:      'i_{name}Engage',
      inputDisengage:   'i_{name}Disengage',
      outputEngage:     'q_Engage{name}',
      outputDisengage:  'q_Disengage{name}',
      timerEngage:      '{name}EngageDelay',
      timerDisengage:   '{name}DisengageDelay',
      debounceEngage:   '{name}EngageDebounce',
      debounceDisengage:'{name}DisengageDebounce',
    },
    defaultTimerPreMs: 300,
    transitionConditions: {
      Engage: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Engage',
        timerTag: '{name}EngageDelay',
        labelTemplate: "'{deviceName}' Engaged",
      },
      Disengage: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Disengage',
        timerTag: '{name}DisengageDelay',
        labelTemplate: "'{deviceName}' Disengaged",
      },
    },
  },

  PneumaticVacGenerator: {
    label: 'Vacuum Generator',
    icon: '💨',
    color: '#a855f7',
    colorBg: '#faf5ff',
    category: 'Pneumatic',
    operations: [
      { value: 'VacOn', label: 'Vacuum On', verb: 'VacOn', icon: '💨' },
      { value: 'VacOff', label: 'Vacuum Off', verb: 'VacOff', icon: '⭕' },
      { value: 'VacOnEject', label: 'Vacuum On + Eject', verb: 'VacOnEject', icon: '💨' },
    ],
    tagPatterns: {
      inputVacOn:       'i_{name}VacOn',
      inputVacOnEject:  'i_{name}VacOnEject',
      outputVacOn:      'q_VacOn{name}',
      outputVacOff:     'q_VacOff{name}',
      outputVacOnEject: 'q_VacOnEject{name}',
      timerVacOn:       '{name}VacOnDelay',
      timerVacOnEject:  '{name}VacOnEjectDelay',
    },
    defaultTimerPreMs: 300,
    transitionConditions: {
      VacOn: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}VacOn',
        timerTag: '{name}VacOnDelay',
        labelTemplate: "'{deviceName}' Vac On Verified",
      },
      VacOff: {
        type: 'timer',
        timerTag: '{name}VacOnDelay',
        labelTemplate: "'{deviceName}' Vac Off Timer",
      },
      VacOnEject: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}VacOnEject',
        timerTag: '{name}VacOnEjectDelay',
        labelTemplate: "'{deviceName}' VacEject Verified",
      },
    },
  },

  ServoAxis: {
    label: 'Servo Axis',
    icon: '⚡',
    color: '#f59e0b',
    colorBg: '#fffbeb',
    category: 'Servo',
    operations: [
      { value: 'ServoMove', label: 'Move to Position', verb: 'MoveTo', icon: '⚡' },
    ],
    tagPatterns: {
      axisTag:          'a{axisNum}_{name}',
      positionParam:    'p_{name}{positionName}',
      mamControl:       'MAM_{name}',
      oneShotTag:       '{name}_Step{step}_OS',
    },
    defaultTimerPreMs: 0,
    // Positions are user-defined per device instance
    transitionConditions: {
      ServoMove: {
        type: 'servoAtTarget',
        labelTemplate: "@ '{positionName}'",
      },
    },
  },

  Timer: {
    label: 'Timer / Dwell',
    icon: '⏱',
    color: '#9ca3af',
    colorBg: '#f9fafb',
    category: 'Logic',
    operations: [
      { value: 'Wait', label: 'Wait (Dwell)', verb: 'Wait', icon: '⏱' },
    ],
    tagPatterns: {
      timerTag: '{name}',
    },
    defaultTimerPreMs: 1000,
    transitionConditions: {
      Wait: {
        type: 'timer',
        timerTag: '{name}',
        labelTemplate: "Timer {delayMs}ms",
      },
    },
  },

  DigitalSensor: {
    label: 'Digital Sensor / PEC',
    icon: '👁',
    color: '#06b6d4',
    colorBg: '#ecfeff',
    category: 'Sensor',
    operations: [
      { value: 'Verify', label: 'Verify (Check Sensor)', verb: 'Verify', icon: '✓' },
      { value: 'WaitOn', label: 'Wait For ON', verb: 'WaitOn', icon: '👁' },
      { value: 'WaitOff', label: 'Wait For OFF', verb: 'WaitOff', icon: '👁' },
    ],
    tagPatterns: {
      inputTag: 'i_{name}',
      debounce: '{name}Debounce',
    },
    defaultTimerPreMs: 10,
    transitionConditions: {
      WaitOn: {
        type: 'sensorOn',
        sensorTag: 'i_{name}',
        labelTemplate: "'{deviceName}' ON",
      },
      WaitOff: {
        type: 'sensorOff',
        sensorTag: 'i_{name}',
        labelTemplate: "'{deviceName}' OFF",
      },
      Verify: {
        type: 'sensorOn',
        sensorTag: 'i_{name}',
        labelTemplate: "'{deviceName}' Verified ON",
      },
    },
  },
};

export const DEVICE_CATEGORIES = {
  Pneumatic: ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator'],
  Servo: ['ServoAxis'],
  Logic: ['Timer'],
  Sensor: ['DigitalSensor'],
};

/**
 * Get all available operations for a device type
 */
export function getOperationsForType(typeKey) {
  return DEVICE_TYPES[typeKey]?.operations ?? [];
}

/**
 * Get the default transition condition suggestion for a given device operation
 */
export function getTransitionSuggestion(typeKey, operation) {
  return DEVICE_TYPES[typeKey]?.transitionConditions?.[operation] ?? null;
}
