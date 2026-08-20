/**
 * machineTotals.js — machine-wide device tally for quoting (ESTIMATES).
 *
 * Pure helper (no React, no store): pass the project object, get back counts
 * across ALL state machines. Used by the v2 stations panel "Machine totals"
 * block; kept here so quoting exports can reuse it later.
 *
 * Estimate rules (SDC standards):
 *   - Valves ≈ 1 per pneumatic actuator (double-solenoid standard;
 *     single-solenoid spring-return is the rare exception) + 1 per vacuum
 *     generator.
 *   - IO points per device:
 *       pneumatic actuator: sensors per arrangement (2 / 1 / 0) in + 2 out
 *       vacuum generator:   1 in + 2 out
 *       digital sensor:     1 in
 *       analog sensor:      1 in (analog)
 *       vision system:      3 in + 1 out (trigger/ready/result/pass handshake)
 *       robot:              declared robot signals[] count (else 0 — the
 *                           device itself is still tallied under Robots)
 *       conveyor:           2 out
 *       servo axis:         0 (network drive — no discrete IO)
 *   - If a SM's machineSpec.io exists (sensors / valveFunctions arrays from
 *     the spec system), its explicit counts REPLACE the per-device IO and
 *     valve derivation for that station.
 */

import { getSensorConfigKey } from './deviceTypes.js';

const PNEUMATIC_ACTUATOR_TYPES = new Set([
  'PneumaticLinearActuator',
  'PneumaticRotaryActuator',
  'PneumaticGripper',
]);

/** IO estimate for one device: { in, out }. */
function deviceIo(device) {
  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
    case 'PneumaticGripper': {
      const key = getSensorConfigKey(device);
      const ins = key === 'both' ? 2 : key === 'none' ? 0 : 1;
      return { in: ins, out: 2 };
    }
    case 'PneumaticVacGenerator': return { in: 1, out: 2 };
    case 'DigitalSensor':         return { in: 1, out: 0 };
    case 'AnalogSensor':          return { in: 1, out: 0 };
    case 'VisionSystem':          return { in: 3, out: 1 };
    case 'Conveyor':              return { in: 0, out: 2 };
    case 'Robot': {
      const sigs = Array.isArray(device.signals) ? device.signals : [];
      let ins = 0, outs = 0;
      for (const s of sigs) {
        if (s?.direction === 'output' || s?.group === 'DO') outs++;
        else ins++;
      }
      return { in: ins, out: outs };
    }
    default: return { in: 0, out: 0 };
  }
}

/**
 * Compute machine-wide totals across all SMs of a project.
 * Returns { stations, servos, standardMotors, pneumaticActuators, valves,
 *           sensors, vision, robots, ioIn, ioOut, ioTotal }.
 * Category lines mirror the SDC quoting sheet: servo motors and standard
 * motors (conveyors etc.) are separate lines; vision systems their own line.
 * All derived numbers (valves, io*) are quoting ESTIMATES.
 */
export function computeMachineTotals(project) {
  const totals = {
    stations: 0,
    servos: 0,
    standardMotors: 0,
    pneumaticActuators: 0,
    valves: 0,
    sensors: 0,
    vision: 0,
    robots: 0,
    ioIn: 0,
    ioOut: 0,
    ioTotal: 0,
  };
  const sms = project?.stateMachines ?? [];
  totals.stations = sms.length;

  for (const sm of sms) {
    const devices = sm?.devices ?? [];

    // Device-category counts are always device-based.
    for (const d of devices) {
      if (!d?.type) continue;
      if (d.type === 'ServoAxis') totals.servos++;
      else if (d.type === 'Conveyor') totals.standardMotors++;
      else if (PNEUMATIC_ACTUATOR_TYPES.has(d.type)) totals.pneumaticActuators++;
      else if (d.type === 'DigitalSensor' || d.type === 'AnalogSensor') totals.sensors++;
      else if (d.type === 'VisionSystem') totals.vision++;
      else if (d.type === 'Robot') totals.robots++;
    }

    // Valves + IO: prefer the station's explicit machineSpec.io when present.
    const specIo = sm?.machineSpec?.io;
    const specSensors = Array.isArray(specIo?.sensors) ? specIo.sensors : null;
    const specValves = Array.isArray(specIo?.valveFunctions) ? specIo.valveFunctions : null;
    if (specSensors || specValves) {
      totals.ioIn += specSensors?.length ?? 0;
      totals.ioOut += specValves?.length ?? 0;
      totals.valves += specValves?.length ?? 0;
      continue;
    }

    for (const d of devices) {
      if (!d?.type) continue;
      if (PNEUMATIC_ACTUATOR_TYPES.has(d.type)) totals.valves += 1;
      else if (d.type === 'PneumaticVacGenerator') totals.valves += 1;
      const io = deviceIo(d);
      totals.ioIn += io.in;
      totals.ioOut += io.out;
    }
  }

  totals.ioTotal = totals.ioIn + totals.ioOut;
  return totals;
}
