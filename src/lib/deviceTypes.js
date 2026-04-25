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
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 4,
    category: 'Pneumatic',
    operations: [
      { value: 'Extend', label: 'Extend', verb: 'Extend', icon: '⬆' },
      { value: 'Retract', label: 'Retract', verb: 'Retract', icon: '⬇' },
    ],
    homePositions: [
      { value: 'Retract', label: 'Retracted' },
      { value: 'Extend', label: 'Extended' },
    ],
    defaultHomePosition: 'Retract',
    sensorArrangements: ['1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
    defaultSensorArrangement: '2-sensor (Ext + Ret)',
    // SDC Guide §8/§10: full words, never Ext/Ret abbreviations.
    tagPatterns: {
      inputExt:       'i_{name}Extended',
      inputRet:       'i_{name}Retracted',
      outputExtend:   'q_Extend{name}',
      outputRetract:  'q_Retract{name}',
      timerExt:       '{name}ExtendDelay',
      timerRet:       '{name}RetractDelay',
      debounceExt:    '{name}ExtendDebounce',
      debounceRet:    '{name}RetractDebounce',
    },
    defaultTimerPreMs: 500,
    // Transition condition auto-generated after each operation:
    transitionConditions: {
      Extend: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Extended',
        timerTag: '{name}ExtendDelay',
        labelTemplate: "'{deviceName}' Extended & Timer",
      },
      Retract: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Retracted',
        timerTag: '{name}RetractDelay',
        labelTemplate: "'{deviceName}' Retracted & Timer",
      },
    },
  },

  PneumaticRotaryActuator: {
    label: 'Rotary Actuator',
    icon: '↺',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 5,
    category: 'Pneumatic',
    operations: [
      { value: 'Extend', label: 'Extend (CW)', verb: 'Extend', icon: '↺' },
      { value: 'Retract', label: 'Retract (CCW)', verb: 'Retract', icon: '↻' },
    ],
    homePositions: [
      { value: 'Retract', label: 'Retracted (CCW)' },
      { value: 'Extend', label: 'Extended (CW)' },
    ],
    defaultHomePosition: 'Retract',
    sensorArrangements: ['1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
    defaultSensorArrangement: '2-sensor (Ext + Ret)',
    tagPatterns: {
      inputExt:       'i_{name}Extended',
      inputRet:       'i_{name}Retracted',
      outputExtend:   'q_Extend{name}',
      outputRetract:  'q_Retract{name}',
      timerExt:       '{name}ExtendDelay',
      timerRet:       '{name}RetractDelay',
      debounceExt:    '{name}ExtendDebounce',
      debounceRet:    '{name}RetractDebounce',
    },
    defaultTimerPreMs: 500,
    transitionConditions: {
      Extend: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Extended',
        timerTag: '{name}ExtendDelay',
        labelTemplate: "'{deviceName}' Extended",
      },
      Retract: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Retracted',
        timerTag: '{name}RetractDelay',
        labelTemplate: "'{deviceName}' Retracted",
      },
    },
  },

  // SDC Guide §15.9: 2-solenoid gripper is the standard.
  // Operation values stay Engage/Disengage for UI backward-compat;
  // tag patterns use Close/Open per guide.
  PneumaticGripper: {
    label: 'Gripper',
    icon: '✋',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 6,
    category: 'Pneumatic',
    operations: [
      { value: 'Engage', label: 'Close (Engage)', verb: 'Close', icon: '✊' },
      { value: 'Disengage', label: 'Open (Disengage)', verb: 'Open', icon: '✋' },
    ],
    homePositions: [
      { value: 'Disengage', label: 'Open' },
      { value: 'Engage', label: 'Closed' },
    ],
    defaultHomePosition: 'Disengage',
    sensorArrangements: ['1-sensor (Closed only)', '2-sensor (Closed + Open)'],
    defaultSensorArrangement: '2-sensor (Closed + Open)',
    tagPatterns: {
      inputEngage:      'i_{name}Closed',
      inputDisengage:   'i_{name}Open',
      outputEngage:     'q_Close{name}',
      outputDisengage:  'q_Open{name}',
      timerEngage:      '{name}CloseDelay',
      timerDisengage:   '{name}OpenDelay',
      debounceEngage:   '{name}CloseDebounce',
      debounceDisengage:'{name}OpenDebounce',
    },
    defaultTimerPreMs: 500,
    transitionConditions: {
      Engage: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Closed',
        timerTag: '{name}CloseDelay',
        labelTemplate: "'{deviceName}' Closed",
      },
      Disengage: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Open',
        timerTag: '{name}OpenDelay',
        labelTemplate: "'{deviceName}' Open",
      },
    },
  },

  PneumaticVacGenerator: {
    label: 'Vacuum Generator',
    icon: '💨',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 8,
    category: 'Pneumatic',
    operations: [
      { value: 'VacOn', label: 'Vacuum On', verb: 'VacOn', icon: '💨' },
      { value: 'VacOff', label: 'Vacuum Off', verb: 'VacOff', icon: '⭕' },
      { value: 'VacOnEject', label: 'Vac Eject On', verb: 'VacEjectOn', icon: '🌬️' },
    ],
    homePositions: [
      { value: 'VacOff', label: 'Vacuum Off' },
      { value: 'VacOn', label: 'Vacuum On' },
    ],
    defaultHomePosition: 'VacOff',
    tagPatterns: {
      inputVacOn:       'i_{name}VacOn',
      inputVacOnEject:  'i_{name}VacEjectOn',
      outputVacOn:      'q_VacOn{name}',
      outputVacOff:     'q_VacOff{name}',
      outputVacOnEject: 'q_VacEjectOn{name}',
      timerVacOn:       '{name}VacOnDelay',
      timerVacOnEject:  '{name}VacEjectOnDelay',
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
        sensorTag: 'i_{name}VacEjectOn',
        timerTag: '{name}VacEjectOnDelay',
        labelTemplate: "'{deviceName}' Vac Eject Verified",
      },
    },
  },

  // SDC Guide §15.4: Servo architecture —
  //   Controller-scope AXIS_CIP_DRIVE: a{NN}_S{station}{name}  (NN = global axis #)
  //   Program InOut (alias):          iq_{name}
  //   HMI block (ServoOverall UDT):   HMI_{name}
  //   Motion instruction instances:   MSO_/MSF_/MAFR_/MASR_/MAJ_/MAS_{name}_Jog/MAH_/MAM_{name}_Auto
  //   Support tags:                   {Name}Ready/Permissive/AutoEnable/HomeConfimed/HomeRequested/HomeSelect/TorqueHome
  //   Positions live in HMI_{name}.Parameters.Positions[N] (stable index, §15.3)
  ServoAxis: {
    label: 'Servo Axis',
    icon: '⚡',
    color: '#061d39',
    colorBg: '#e6eaf0',
    sides: 10,
    category: 'Servo',
    homePositions: 'dynamic', // resolved from device.positions where isHome === true
    defaultHomePosition: 'ServoMove',
    operations: [
      { value: 'ServoMove', label: 'Move to Position', verb: 'MoveTo', icon: '⚡' },
      { value: 'ServoIncr', label: 'Incremental Move', verb: 'Increment', icon: '↔' },
      { value: 'ServoIndex', label: 'Index', verb: 'Index', icon: '🔄' },
    ],
    tagPatterns: {
      // Controller-scope axis tag (AXIS_CIP_DRIVE). {axisNum} = global axis index.
      // Engineer convention: a{NN}_{name} — no station infix.
      axisTag:          'a{axisNum}_{name}',
      // Program-scope InOut parameter aliased to the controller axis tag.
      axisInOut:        'iq_{name}',
      // HMI block — ServoOverall UDT (replaces legacy MAMParam).
      hmiTag:           'HMI_{name}',
      // Per-position REAL parameter tags and AOI_RangeCheck instance tags.
      // Engineer uses flat tags directly (not HMI_{name}.Parameters.Positions[N] array).
      // AOI_RangeCheck instance is named by position directly (e.g., XAxisExtend, ZAxisPick)
      // and exposes .InPos / .InPosWide BOOL outputs.
      positionParam:    'p_{name}{positionName}',
      positionRC:       '{name}{positionName}',
      incrementParam:   'p_{name}IncrDist',
      indexAngleParam:  'p_{name}IndexAngle',
      // Motion instruction instances (MOTION_INSTRUCTION — one per rung type).
      // Engineer convention: suffix style — {name}_MAM, {name}_MSO, etc.
      msoInst:          '{name}_MSO',
      msfInst:          '{name}_MSF',
      mafrInst:         '{name}_MAFR',
      masrInst:         '{name}_MASR',
      majInst:          '{name}_MAJ',
      masJogInst:       '{name}_MAS_Jog',
      masAllInst:       '{name}_MAS_All',    // Stop-on-permissive-lost
      mahInst:          '{name}_MAH',
      mamAutoInst:      '{name}_MAM',        // Auto-mode MAM
      mamInchInst:      '{name}_MAM_Inch',   // Inch-mode MAM
      // Per-axis support tags.
      readyTag:         '{Name}Ready',
      enableDelayTag:   '{Name}EnableDelay', // TON — debounce Ready→AutoEnable
      onsTag:           '{Name}ONS',         // DINT — ONS bits 0..N
      permissiveTag:    '{Name}Permissive',
      autoEnableTag:    '{Name}AutoEnable',
      jogDirectionTag:  '{Name}JogDirection',// DINT — 0 pos / 1 neg
      inchAmountTag:    '{Name}InchAmount',  // REAL — signed inch distance
      homeConfirmedTag: '{Name}HomeConfimed',    // sic — spelling per SDC guide §10
      homeConfirmDelayTag: '{Name}HomeConfirmDelay', // TIMER
      homeRequestedTag: '{Name}HomeRequested',
      homeSelectTag:    '{Name}HomeSelect',
      torqueHomeTag:    '{Name}TorqueHome',  // AOI_TorqueHome instance
      manMoveTrigTag:   '{Name}ManMoveTrig',
      motionParamsTag:  '{name}MotionParameters', // MAMParam UDT instance — engineer: {axis}MotionParameters
      // Position signal (SM output): p_At{name}.
      atPositionSignal: 'p_At{name}',
    },
    defaultTimerPreMs: 0,
    // Positions are user-defined per device instance; each carries a stable positionIndex (§15.3).
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
    color: '#d9d9d9',
    colorBg: '#f5f5f5',
    sides: 12,
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
    color: '#aacee8',
    colorBg: '#eef5fb',
    sides: 14,
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

  AnalogSensor: {
    label: 'Analog Sensor / Probe',
    icon: '📊',
    color: '#6366f1',
    colorBg: '#eef2ff',
    sides: 14,
    category: 'Sensor',
    // No `operations` — probes are not state-logic actions. Declare the device,
    // declare its setpoints, then reference each setpoint's `RC.InPos` BOOL
    // through a Verify-mode Decision node. Continuous AOI_RangeCheck monitoring
    // is emitted in R03 by `l5xExporter.generateAnalogSensorMonitoring`.
    operations: [],
    tagPatterns: {
      inputTag:        'i_{name}',
      scaledTag:       '{name}Scaled',
      highLimit:       '{name}HighLim',
      lowLimit:        '{name}LowLim',
      inRangeTag:      '{name}RC.InPos',
      debounce:        '{name}Debounce',
      rangeCheckInst:  '{name}{setpointName}RC',
      setpointParam:   'p_{name}{setpointName}',
    },
    defaultTimerPreMs: 10,
    // No transitionConditions — see comment above. Verify-mode pulls per-setpoint
    // BOOL inputs (`{name}{setpointName}RC.InPos`) via availableInputs.js.
    // Setpoints are user-defined per device instance (stored in device.setpoints[]).
    // Each setpoint: { name, nominal, tolerance, lowLimit, highLimit }
  },

  VisionSystem: {
    label: 'Vision System',
    icon: '📷',
    color: '#fa9150',
    colorBg: '#fff0e6',
    sides: 4,
    category: 'Sensor',
    operations: [
      { value: 'Trigger', label: 'Trigger Inspection', verb: 'Trigger', icon: '📷' },
    ],
    tagPatterns: {
      trigger:          'q_Trigger{name}',
      triggerOutput:    'q_Trigger{name}',
      triggerReady:     'i_{name}TrigRdy',
      trigReady:        'i_{name}TrigRdy',
      resultReady:      'i_{name}ResultReady',
      inspPass:         'i_{name}InspPass',
      waitTimer:        '{name}WaitTimer',
      trigDwell:        '{name}TrigDwell',
      searchTimeout:    '{name}SearchTimeout',
      jobOutcome:       'q_Pass_{jobName}',   // per-job pass/fail params
    },
    defaultTimerPreMs: 50,
    transitionConditions: {
      Trigger: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}ResultReady',
        timerTag: '{name}TrigDwell',
        labelTemplate: "'{deviceName}' Result Ready",
      },
    },
  },

  Robot: {
    label: 'Robot',
    icon: '🤖',
    color: '#7c3aed',
    colorBg: '#f3eaff',
    sides: 6,
    category: 'Robot',
    // PLC side of robot integration: the robot runs sequences (programs),
    // PLC sets/waits on user DI/DO bits. No positions in PLC — those live
    // in the robot program as PR[] registers.
    operations: [
      { value: 'RunSequence', label: 'Run Sequence',   verb: 'Run',     icon: '▶' },
      { value: 'SetOutput',   label: 'Set Signal',     verb: 'Set',     icon: '●' },
      { value: 'WaitInput',   label: 'Wait for Signal',verb: 'Wait',    icon: '⏳' },
    ],
    tagPatterns: {
      rinTag:       '{name}_RIN',
      routTag:      '{name}_ROUT',
      seqReqTag:    '{name}_SeqRequest',
      seqRunTag:    '{name}_RunningSeq',
      runSeqInst:   'RunSeq_{name}_{seqName}',
    },
    defaultTimerPreMs: 0,
    transitionConditions: {
      RunSequence: {
        type: 'robotSeqComplete',
        labelTemplate: "'{deviceName}' '{sequenceName}' Complete",
      },
      SetOutput: {
        type: 'immediate',
        labelTemplate: "'{deviceName}' '{signalName}' Set",
      },
      WaitInput: {
        type: 'robotSignalOn',
        labelTemplate: "'{deviceName}' '{signalName}' ON",
      },
    },
    // Per-instance data:
    //   device.sequences[] = [{ id, number, name, description }]
    //   device.signals[]   = [{ id, number, name, group: 'DI'|'DO'|'Register',
    //                           direction: 'input'|'output', dataType, description }]
  },

  Conveyor: {
    label: 'Conveyor',
    icon: '🔄',
    color: '#0891b2',
    colorBg: '#ecfeff',
    sides: 8,
    category: 'Conveyor',
    operations: [
      { value: 'Run', label: 'Run Conveyor', verb: 'Run', icon: '▶' },
      { value: 'Stop', label: 'Stop Conveyor', verb: 'Stop', icon: '⏹' },
    ],
    homePositions: [
      { value: 'Stop', label: 'Stopped' },
      { value: 'Run', label: 'Running' },
    ],
    defaultHomePosition: 'Stop',
    tagPatterns: {
      outputRun:   'q_Run{name}',
      outputStop:  'q_Stop{name}',
      outputFwd:   'q_Fwd{name}',
      speedParam:  'p_{name}Speed',
    },
    defaultTimerPreMs: 0,
    transitionConditions: {
      Run: {
        type: 'immediate',
        labelTemplate: "'{deviceName}' Running",
      },
      Stop: {
        type: 'immediate',
        labelTemplate: "'{deviceName}' Stopped",
      },
    },
  },

  Parameter: {
    label: 'Parameter',
    icon: '⚙',
    color: '#ffde51',
    colorBg: '#fffde6',
    sides: 0,
    category: 'Logic',
    operations: [
      { value: 'SetOn',    label: 'Set ON',    verb: 'SetOn',    icon: '●' },
      { value: 'SetOff',   label: 'Set OFF',   verb: 'SetOff',   icon: '○' },
      { value: 'WaitOn',   label: 'Wait ON',   verb: 'WaitOn',   icon: '⏳' },
      { value: 'WaitOff',  label: 'Wait OFF',  verb: 'WaitOff',  icon: '⏳' },
      { value: 'SetValue', label: 'Set Value', verb: 'SetValue', icon: '=' },
    ],
    tagPatterns: {
      paramTag: 'p_{name}',
    },
    defaultTimerPreMs: 0,
    // Parameters latch (OTL/OTU). WaitOn/WaitOff produce verify transition conditions.
    transitionConditions: {
      WaitOn: {
        type: 'paramOn',
        paramTag: 'p_{name}',
        labelTemplate: "'{deviceName}' = ON",
      },
      WaitOff: {
        type: 'paramOff',
        paramTag: 'p_{name}',
        labelTemplate: "'{deviceName}' = OFF",
      },
      // SetOn / SetOff / SetValue do not produce a verify transition condition.
    },
  },

  Custom: {
    label: 'Custom Device',
    icon: '🔧',
    color: '#6b7280',
    colorBg: '#f3f4f6',
    sides: 0,
    category: 'Custom',
    // Operations, tag patterns, and transition conditions are defined
    // per-instance via device.customTypeDef
    operations: [],
    tagPatterns: {},
    defaultTimerPreMs: 500,
    transitionConditions: {},
  },
};

export const DEVICE_CATEGORIES = {
  Pneumatic: ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator'],
  Servo: ['ServoAxis'],
  Robot: ['Robot'],
  Conveyor: ['Conveyor'],
  Logic: ['Timer', 'Parameter'],
  Sensor: ['DigitalSensor', 'AnalogSensor', 'VisionSystem'],
  Custom: ['Custom'],
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

/**
 * Derive a normalised sensor-config key from the device's sensorArrangement string.
 * Returns: 'both' | 'extendOnly' | 'retractOnly' | 'engageOnly' | 'none'
 */
export function getSensorConfigKey(device) {
  const arr = (device.sensorArrangement ?? '').toLowerCase();

  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      if (arr.includes('2-sensor')) return 'both';
      if (arr.includes('ret only') || arr.includes('1-sensor')) return 'retractOnly';
      if (arr.includes('ext only')) return 'extendOnly';
      return 'none';

    case 'PneumaticGripper':
      if (arr.includes('2-sensor')) return 'both';
      if (arr.includes('1-sensor') || arr.includes('engaged only') || arr.includes('closed only')) return 'engageOnly';
      return 'none';

    default:
      return 'none';
  }
}
