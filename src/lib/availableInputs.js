/**
 * Shared utility: build a flat array of all checkable inputs
 * from every device in a state machine.
 *
 * Used by both the InlinePicker (Verify flow) and AddDeviceModal.
 */

/**
 * Normalise a device's sensorArrangement string to a simple key.
 * Returns: 'both' | 'extendOnly' | 'retractOnly' | 'engageOnly'
 */
export function sensorCfg(d) {
  const arr = (d.sensorArrangement ?? '').toLowerCase();
  if (arr.includes('2-sensor')) return 'both';
  if (arr.includes('ret only') || arr.includes('1-sensor'))
    return d.type === 'PneumaticGripper' ? 'engageOnly' : 'retractOnly';
  if (arr.includes('ext only')) return 'extendOnly';
  if (arr.includes('engaged only')) return 'engageOnly';
  return 'both';
}

/**
 * Build a flat array of all checkable inputs across all devices in a state machine.
 *
 * @param {object[]} devices     All devices in the current SM
 * @param {object[]} allSMs      All state machines in the project
 * @param {string}   currentSmId The current SM's id
 * @param {object[]} [trackingFields] Part tracking fields from project.partTracking.fields
 * @returns {{ ref: string, tag: string, label: string, inputType: 'bool'|'range', group: string }[]}
 */
export function buildAvailableInputs(devices, allSMs, currentSmId, trackingFields) {
  const inputs = [];

  for (const d of (devices ?? [])) {
    // Skip auto-created verify devices — they aren't checkable inputs
    if (d._autoVerify || d._autoVision) continue;

    switch (d.type) {
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator': {
        const cfg = sensorCfg(d);
        if (cfg === 'both' || cfg === 'extendOnly')
          inputs.push({ ref: `${d.id}:ext`, tag: `i_${d.name}Ext`, label: `${d.displayName} Extended`, inputType: 'bool', group: 'Cylinders / Actuators' });
        if (cfg === 'both' || cfg === 'retractOnly')
          inputs.push({ ref: `${d.id}:ret`, tag: `i_${d.name}Ret`, label: `${d.displayName} Retracted`, inputType: 'bool', group: 'Cylinders / Actuators' });
        break;
      }
      case 'PneumaticGripper': {
        const cfg = sensorCfg(d);
        if (cfg === 'both' || cfg === 'engageOnly')
          inputs.push({ ref: `${d.id}:eng`, tag: `i_${d.name}Engage`, label: `${d.displayName} Engaged`, inputType: 'bool', group: 'Grippers' });
        if (cfg === 'both')
          inputs.push({ ref: `${d.id}:dis`, tag: `i_${d.name}Disengage`, label: `${d.displayName} Disengaged`, inputType: 'bool', group: 'Grippers' });
        break;
      }
      case 'PneumaticVacGenerator':
        inputs.push({ ref: `${d.id}:vac`, tag: `i_${d.name}VacOn`, label: `${d.displayName} Vacuum`, inputType: 'bool', group: 'Vacuum' });
        break;
      case 'DigitalSensor':
        inputs.push({ ref: `${d.id}:sensor`, tag: `i_${d.name}`, label: d.displayName, inputType: 'bool', group: 'Sensors' });
        break;
      case 'AnalogSensor':
        // Raw scaled value — can be used for range comparisons
        inputs.push({ ref: `${d.id}:value`, tag: `${d.name}Scaled`, label: `${d.displayName} Value`, inputType: 'range', group: 'Analog Sensors' });
        // Each setpoint as a bool "in range" check
        for (const sp of (d.setpoints ?? []))
          inputs.push({ ref: `${d.id}:${sp.name}`, tag: `${d.name}${sp.name}RC.In_Range`, label: `${d.displayName} @ ${sp.name} (In Range)`, inputType: 'bool', group: 'Analog Sensors' });
        break;
      case 'ServoAxis':
        for (const pos of (d.positions ?? []))
          inputs.push({ ref: `${d.id}:${pos.name}`, tag: `${d.name}${pos.name}RC.In_Range`, label: `${d.displayName} @ ${pos.name}`, inputType: 'range', group: 'Servo Positions' });
        break;
      case 'Parameter': {
        const pfx = d.dataType === 'boolean' ? 'q_' : 'p_';
        inputs.push({ ref: `${d.id}:param`, tag: `${pfx}${d.name}`, label: d.displayName, inputType: 'bool', group: 'Parameters', paramScope: d.paramScope, crossSmId: d.crossSmId });
        break;
      }
      case 'VisionSystem':
        inputs.push({ ref: `${d.id}:trigReady`, tag: `i_${d.name}TrigRdy`, label: `${d.displayName} Trigger Ready`, inputType: 'bool', group: 'Vision' });
        inputs.push({ ref: `${d.id}:resultReady`, tag: `i_${d.name}ResultReady`, label: `${d.displayName} Result Ready`, inputType: 'bool', group: 'Vision' });
        inputs.push({ ref: `${d.id}:inspPass`, tag: `i_${d.name}InspPass`, label: `${d.displayName} Inspection Pass`, inputType: 'bool', group: 'Vision' });
        // Numeric outputs per job (vision data values — PartCount, X_Offset, etc.)
        for (const job of (d.jobs ?? [])) {
          for (const numOut of (job.numericOutputs ?? [])) {
            if (!numOut.name?.trim()) continue;
            const cleanName = numOut.name.replace(/[^a-zA-Z0-9_]/g, '');
            const tag = `p_${d.name}_${job.name}_${cleanName}`;
            const unitLabel = numOut.unit ? ` (${numOut.unit})` : '';
            inputs.push({
              ref: `${d.id}:visionOut:${job.name}:${cleanName}`,
              tag,
              label: `${d.displayName} ${job.name} → ${numOut.name}${unitLabel}`,
              inputType: 'range',
              group: 'Vision',
            });
          }
        }
        break;
      case 'Robot':
        for (const sig of (d.signals ?? [])) {
          if (!sig.name?.trim()) continue;
          // Only signals with direction 'input' (robot→PLC) are checkable conditions
          if (sig.direction === 'input') {
            const grp = sig.group || 'DO';
            let tag, inputGroup;
            if (grp === 'Register') {
              tag = `${d.name}R${sig.number ?? 0}`;
              inputGroup = 'Robot Registers';
            } else {
              tag = `i_${d.name}${sig.name}`;
              inputGroup = sig.isRefPos ? 'Robot Reference Positions' : 'Robot DO';
            }
            inputs.push({
              ref: `${d.id}:${sig.id}`,
              tag,
              label: `${d.displayName} ${sig.name}${sig.number ? ` [${sig.number}]` : ''}`,
              inputType: (sig.dataType === 'DINT' || sig.dataType === 'REAL') ? 'range' : 'bool',
              group: inputGroup,
            });
          }
        }
        break;
      case 'Conveyor':
        inputs.push({ ref: `${d.id}:run`, tag: `q_Run${d.name}`, label: `${d.displayName} Running`, inputType: 'bool', group: 'Conveyors' });
        break;
      case 'Custom': {
        const cDef = d.customTypeDef;
        if (cDef) {
          for (const inp of (cDef.inputs ?? [])) {
            if (!inp.tagPattern || !inp.name) continue;
            const tag = inp.tagPattern.replace(/\{name\}/g, d.name);
            inputs.push({ ref: `${d.id}:${inp.name}`, tag, label: `${d.displayName} ${inp.name}`, inputType: (inp.dataType === 'REAL') ? 'range' : 'bool', group: 'Custom Devices' });
          }
          for (const aio of (cDef.analogIO ?? [])) {
            if (!aio.tagPattern || !aio.name || aio.direction !== 'input') continue;
            const tag = aio.tagPattern.replace(/\{name\}/g, d.name);
            inputs.push({ ref: `${d.id}:${aio.name}`, tag, label: `${d.displayName} ${aio.name}`, inputType: 'range', group: 'Custom Devices' });
          }
        }
        break;
      }
    }
  }

  // Global params from other SMs
  for (const otherSm of (allSMs ?? [])) {
    if (otherSm.id === currentSmId) continue;
    for (const d of (otherSm.devices ?? [])) {
      if (d.type === 'Parameter' && d.paramScope === 'global' && !d._autoVision) {
        const pfx = d.dataType === 'boolean' ? 'q_' : 'p_';
        inputs.push({ ref: `${d.id}:cross:${otherSm.id}`, tag: `${pfx}${d.name}`, label: `${d.displayName} (${otherSm.name})`, inputType: 'bool', group: 'Cross-SM Parameters', paramScope: 'cross-sm', crossSmId: otherSm.id, deviceId: d.id });
      }
      // Robot signals available cross-SM
      if (d.type === 'Robot') {
        for (const sig of (d.signals ?? [])) {
          if (!sig.name?.trim() || sig.direction !== 'input') continue;
          const grp = sig.group || 'DO';
          const tag = grp === 'Register' ? `${d.name}R${sig.number ?? 0}` : `i_${d.name}${sig.name}`;
          const sigGroup = grp === 'Register' ? 'Robot Registers' : 'Robot DO';
          inputs.push({
            ref: `${d.id}:${sig.id}:cross:${otherSm.id}`,
            tag,
            label: `${d.displayName} ${sig.name}${sig.number ? ` [${sig.number}]` : ''} (${otherSm.name})`,
            inputType: (sig.dataType === 'DINT' || sig.dataType === 'REAL') ? 'range' : 'bool',
            group: `${sigGroup} (${otherSm.name})`,
            paramScope: 'cross-sm',
            crossSmId: otherSm.id,
          });
        }
      }
    }
  }

  // Part Tracking fields (project-level)
  for (const field of (trackingFields ?? [])) {
    inputs.push({
      ref: `_tracking:${field.id}`,
      tag: `PartTracking.${field.name}`,
      label: `PT: ${field.name}`,
      inputType: 'bool',
      group: 'Part Tracking',
    });
  }

  // Cumulative "All Pass" entry — only if there are tracking fields
  if ((trackingFields ?? []).length > 0) {
    inputs.push({
      label: 'PT: All Pass',
      ref: '_tracking:_allPass',
      type: 'boolean',
      inputType: 'bool',
      group: 'Part Tracking',
    });
  }

  return inputs;
}
