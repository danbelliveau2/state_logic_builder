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
 *
 * Besides the flat counts, the result carries a `breakdown` — per-category
 * contributor lists so the UI can answer "what specifically are those items?"
 * Each entry: { name, station, detail } where `station` is the S## label of
 * the owning state machine and `detail` says what the device contributes.
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

/** Human description of WHAT a device's INPUT points are (for the drill-down). */
function deviceInDetail(device, io) {
  const isGripper = device.type === 'PneumaticGripper';
  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
    case 'PneumaticGripper': {
      const posWords = isGripper ? 'closed/open' : 'extended/retracted';
      return io.in === 2 ? `i_ 2 points: ${posWords} position sensors`
        : 'i_ 1 point: position sensor';
    }
    case 'PneumaticVacGenerator': return 'i_ 1 point: vacuum switch';
    case 'DigitalSensor':         return 'i_ 1 point: discrete sensor';
    case 'AnalogSensor':          return '1 analog input point';
    case 'VisionSystem':          return 'i_ 3 points: ready/result/pass handshake';
    case 'Robot':                 return `${io.in} point${io.in === 1 ? '' : 's'}: robot interface inputs`;
    default:                      return `${io.in} input point${io.in === 1 ? '' : 's'}`;
  }
}

/** Human description of WHAT a device's OUTPUT points are (for the drill-down). */
function deviceOutDetail(device, io) {
  const isGripper = device.type === 'PneumaticGripper';
  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
    case 'PneumaticGripper':
      return `q_ 2 points: ${isGripper ? 'gripper close/open' : 'extend/retract'} solenoid outputs`;
    case 'PneumaticVacGenerator': return 'q_ 2 points: vacuum on / eject outputs';
    case 'VisionSystem':          return 'q_ 1 point: inspection trigger output';
    case 'Conveyor':              return 'q_ 2 points: run/direction outputs';
    case 'Robot':                 return `${io.out} point${io.out === 1 ? '' : 's'}: robot interface outputs`;
    default:                      return `${io.out} output point${io.out === 1 ? '' : 's'}`;
  }
}

/** Best-effort display name for spec-IO list entries (strings or objects). */
function specItemName(item) {
  if (item == null) return '(unnamed)';
  if (typeof item === 'string') return item;
  return item.name ?? item.tag ?? item.label ?? item.function ?? '(unnamed)';
}

/**
 * Compute machine-wide totals across all SMs of a project.
 * Returns { stations, servos, standardMotors, pneumaticActuators, valves,
 *           sensors, vision, robots, ioIn, ioOut, ioTotal, breakdown }.
 * `breakdown` maps category → [{ name, station, detail }] (see header).
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
    breakdown: {
      stations: [],
      servos: [],
      standardMotors: [],
      pneumaticActuators: [],
      valves: [],
      sensors: [],
      vision: [],
      robots: [],
      inputs: [],
      outputs: [],
    },
  };
  const bd = totals.breakdown;
  const sms = project?.stateMachines ?? [];
  totals.stations = sms.length;

  for (const sm of sms) {
    const devices = sm?.devices ?? [];
    const stLabel = `S${String(sm?.stationNumber ?? 0).padStart(2, '0')}`;
    const dName = (d) => d.displayName ?? d.name ?? '(unnamed)';
    bd.stations.push({
      name: sm?.displayName ?? sm?.name ?? '(unnamed)',
      station: stLabel,
      detail: `${devices.length} device${devices.length === 1 ? '' : 's'} · ${(sm?.nodes ?? []).length} states drawn`,
    });

    // Device-category counts are always device-based.
    for (const d of devices) {
      if (!d?.type) continue;
      if (d.type === 'ServoAxis') {
        totals.servos++;
        bd.servos.push({
          name: dName(d), station: stLabel,
          detail: `servo axis${d.axisNumber != null ? ` #${d.axisNumber}` : ''} — network drive, no discrete IO`,
        });
      } else if (d.type === 'Conveyor') {
        totals.standardMotors++;
        bd.standardMotors.push({ name: dName(d), station: stLabel, detail: 'conveyor drive motor' });
      } else if (PNEUMATIC_ACTUATOR_TYPES.has(d.type)) {
        totals.pneumaticActuators++;
        const kind = d.type === 'PneumaticGripper' ? 'gripper'
          : d.type === 'PneumaticRotaryActuator' ? 'rotary actuator' : 'linear actuator';
        bd.pneumaticActuators.push({
          name: dName(d), station: stLabel,
          detail: `pneumatic ${kind} (${d.sensorArrangement ?? 'default sensors'})`,
        });
      } else if (d.type === 'DigitalSensor' || d.type === 'AnalogSensor') {
        totals.sensors++;
        bd.sensors.push({
          name: dName(d), station: stLabel,
          detail: d.type === 'AnalogSensor' ? 'analog sensor' : 'digital sensor',
        });
      } else if (d.type === 'VisionSystem') {
        totals.vision++;
        bd.vision.push({ name: dName(d), station: stLabel, detail: 'vision system' });
      } else if (d.type === 'Robot') {
        const nSigs = Array.isArray(d.signals) ? d.signals.length : 0;
        totals.robots++;
        bd.robots.push({
          name: dName(d), station: stLabel,
          detail: nSigs ? `robot — ${nSigs} declared interface signal${nSigs === 1 ? '' : 's'}` : 'robot — no interface signals declared',
        });
      }
    }

    // Valves + IO: prefer the station's explicit machineSpec.io when present.
    const specIo = sm?.machineSpec?.io;
    const specSensors = Array.isArray(specIo?.sensors) ? specIo.sensors : null;
    const specValves = Array.isArray(specIo?.valveFunctions) ? specIo.valveFunctions : null;
    if (specSensors || specValves) {
      totals.ioIn += specSensors?.length ?? 0;
      totals.ioOut += specValves?.length ?? 0;
      totals.valves += specValves?.length ?? 0;
      for (const v of specValves ?? []) {
        bd.valves.push({
          name: specItemName(v), station: stLabel,
          detail: 'valve function from the station spec IO list',
        });
      }
      for (const s of specSensors ?? []) {
        bd.inputs.push({
          name: specItemName(s), station: stLabel,
          detail: 'sensor input from the station spec IO list',
        });
      }
      for (const v of specValves ?? []) {
        bd.outputs.push({
          name: specItemName(v), station: stLabel,
          detail: 'valve function output from the station spec IO list',
        });
      }
      continue;
    }

    for (const d of devices) {
      if (!d?.type) continue;
      if (PNEUMATIC_ACTUATOR_TYPES.has(d.type)) {
        totals.valves += 1;
        bd.valves.push({ name: dName(d), station: stLabel, detail: '1 double-solenoid valve (SDC standard)' });
      } else if (d.type === 'PneumaticVacGenerator') {
        totals.valves += 1;
        bd.valves.push({ name: dName(d), station: stLabel, detail: '1 vacuum generator valve' });
      }
      const io = deviceIo(d);
      totals.ioIn += io.in;
      totals.ioOut += io.out;
      if (io.in > 0) {
        bd.inputs.push({ name: dName(d), station: stLabel, detail: deviceInDetail(d, io) });
      }
      if (io.out > 0) {
        bd.outputs.push({ name: dName(d), station: stLabel, detail: deviceOutDetail(d, io) });
      }
    }
  }

  totals.ioTotal = totals.ioIn + totals.ioOut;
  return totals;
}
