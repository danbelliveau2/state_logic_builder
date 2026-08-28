/**
 * L5X Exporter
 * Converts SDC State Logic diagrams to Allen Bradley L5X format
 * for import into Studio 5000 Logix Designer.
 *
 * Generates per SDC PLC Software Standardization Guide Rev1:
 *  R00_Main       - JSR calls only
 *  R01_Inputs     - sensor debounce timers
 *  R02_StateTransitions - state engine & transition logic (DINT-based step counter)
 *  R03_StateLogicValves - pneumatic output control (OTL/OTU pattern)
 *  R04_StateLogicServo  - servo motion commands (MAM)
 *  R20_Alarms     - fault detect timers + alarm rungs
 *
 * NOTE: State_Engine_128Max AOI must be imported from X drive by CE.
 * This exporter uses a DINT Step counter as a compatible scaffold.
 */

import { getDeviceTags, getSensorTagForOperation, getOutputTagForOperation, getDelayTimerForOperation, getAxisTag, getPositionTag, buildProgramName } from './tagNaming.js';
import { DEVICE_TYPES } from './deviceTypes.js';

const SCHEMA_REV = '1.0';
const SOFTWARE_REV = '35.00';
const PROCESSOR_TYPE = '1769-L33ERM';

// ─── XML helpers ────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cdata(str) {
  return `<![CDATA[${str}]]>`;
}

function xmlTag(name, attrs, children = '') {
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  if (children === '') return `<${name}${attrStr}/>`;
  return `<${name}${attrStr}>${children}</${name}>`;
}

// ─── Tag declaration builders ────────────────────────────────────────────────

function buildTimerTagXml(name, description, preMs) {
  return `
        <Tag Name="${name}" TagType="Base" DataType="TIMER" Radix="NullType" Usage="Local" Constant="false" ExternalAccess="Read/Write">
          <Description>${cdata(description)}</Description>
          <Data Format="Decorated">
            <Structure DataType="TIMER">
              <DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${preMs}"/>
              <DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
              <DataValueMember Name="EN" DataType="BOOL" Value="0"/>
              <DataValueMember Name="TT" DataType="BOOL" Value="0"/>
              <DataValueMember Name="DN" DataType="BOOL" Value="0"/>
            </Structure>
          </Data>
        </Tag>`;
}

function buildBoolTagXml(name, usage, description) {
  return `
        <Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal" Usage="${usage}" Constant="false" ExternalAccess="Read/Write">
          <Description>${cdata(description)}</Description>
          <Data Format="Decorated">
            <DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
          </Data>
        </Tag>`;
}

function buildDintTagXml(name, usage, description, value = 0) {
  return `
        <Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal" Usage="${usage}" Constant="false" ExternalAccess="Read/Write">
          <Description>${cdata(description)}</Description>
          <Data Format="Decorated">
            <DataValue DataType="DINT" Radix="Decimal" Value="${value}"/>
          </Data>
        </Tag>`;
}

function buildRealTagXml(name, usage, description, value = 0.0) {
  return `
        <Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float" Usage="${usage}" Constant="false" ExternalAccess="Read/Write">
          <Description>${cdata(description)}</Description>
          <Data Format="Decorated">
            <DataValue DataType="REAL" Radix="Float" Value="${value.toFixed(4)}"/>
          </Data>
        </Tag>`;
}

function buildMotionInstructionTagXml(name, description) {
  // MOTION_INSTRUCTION is a built-in UDT in Studio 5000
  return `
        <Tag Name="${name}" TagType="Base" DataType="MOTION_INSTRUCTION" Radix="NullType" Usage="Local" Constant="false" ExternalAccess="Read/Write">
          <Description>${cdata(description)}</Description>
          <Data Format="L5K">
            <![CDATA[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]]>
          </Data>
        </Tag>`;
}

function buildOneShotTagXml(name, description) {
  return buildBoolTagXml(name, 'Local', description);
}

// ─── Rung builder ────────────────────────────────────────────────────────────

function buildRung(number, comment, text) {
  let xml = `
              <Rung Number="${number}" Type="N">`;
  if (comment) {
    xml += `
                <Comment>${cdata(comment)}</Comment>`;
  }
  xml += `
                <Text>${cdata(text)}</Text>
              </Rung>`;
  return xml;
}

// ─── Resolve device by id ────────────────────────────────────────────────────

function findDevice(devices, deviceId) {
  return devices.find(d => d.id === deviceId);
}

// ─── Build ordered step list from nodes/edges ────────────────────────────────

/**
 * Topologically sort state nodes using edge connections.
 * Returns nodes in execution order (start node first).
 * Falls back to stepNumber sort if no clear path.
 */
function orderNodes(nodes, edges) {
  if (!nodes || nodes.length === 0) return [];

  // Find start node (isInitial flag or lowest stepNumber)
  const start = nodes.find(n => n.data.isInitial) ?? [...nodes].sort((a, b) => a.data.stepNumber - b.data.stepNumber)[0];
  if (!start) return nodes;

  const visited = new Set();
  const ordered = [];

  function dfs(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if (node) ordered.push(node);
    const outEdges = edges.filter(e => e.source === nodeId);
    for (const e of outEdges) {
      dfs(e.target);
    }
  }

  dfs(start.id);

  // Append any unreachable nodes
  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push(n);
  }

  return ordered;
}

/**
 * Map from node id → sequential step index (0-based)
 */
function buildStepMap(orderedNodes) {
  const map = {};
  orderedNodes.forEach((n, i) => { map[n.id] = i; });
  return map;
}

// ─── Tag generation pass ─────────────────────────────────────────────────────

function generateAllTags(sm, orderedNodes, stepMap, edges) {
  const tagXmls = [];
  const seenNames = new Set();

  function addTag(xml, name) {
    if (!seenNames.has(name)) {
      seenNames.add(name);
      tagXmls.push(xml);
    }
  }

  // Step counter (DINT, Local)
  addTag(
    buildDintTagXml('Step', 'Local', 'State machine step counter'),
    'Step'
  );

  // One-shot for first scan init
  addTag(buildBoolTagXml('FirstScan_OS', 'Local', 'First scan one-shot'), 'FirstScan_OS');

  // Per-device tags
  for (const device of sm.devices) {
    const deviceTags = getDeviceTags(device);
    for (const t of deviceTags) {
      let xml = '';
      if (t.isAxis) {
        // Axis tags are referenced by name only (already on controller from drive config)
        // Include as a comment placeholder
        xml = `\n        <!-- Axis tag ${t.name} must be configured in controller scope as AXIS_CIP_DRIVE -->`;
        addTag(xml, t.name);
        continue;
      }
      switch (t.dataType) {
        case 'BOOL':
          xml = buildBoolTagXml(t.name, t.usage, t.description);
          break;
        case 'TIMER':
          xml = buildTimerTagXml(t.name, t.description, t.preMs ?? 500);
          break;
        case 'REAL':
          xml = buildRealTagXml(t.name, t.usage, t.description, t.defaultValue ?? 0.0);
          break;
        case 'DINT':
          xml = buildDintTagXml(t.name, t.usage, t.description, 0);
          break;
        case 'MOTION_INSTRUCTION':
          xml = buildMotionInstructionTagXml(t.name, t.description);
          break;
        default:
          xml = buildBoolTagXml(t.name, t.usage, t.description);
      }
      addTag(xml, t.name);
    }
  }

  // Alarm fault timers (one per device action that needs verify)
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of (node.data.actions ?? [])) {
      const device = findDevice(sm.devices, action.deviceId);
      if (!device) continue;

      const delayTag = getDelayTimerForOperation(device, action.operation);
      if (delayTag) {
        const faultTimerName = `${delayTag}_Fault`;
        if (!seenNames.has(faultTimerName)) {
          addTag(
            buildTimerTagXml(faultTimerName, `${device.displayName} ${action.operation} fault detect timer`, 5000),
            faultTimerName
          );
        }
      }

      // Servo one-shot tags
      if (action.operation === 'ServoMove') {
        const osName = `${device.name}_Step${step}_OS`;
        addTag(buildOneShotTagXml(osName, `${device.displayName} Step ${step} move one-shot`), osName);
      }
    }
  }

  // Wait/dwell timers added inline for Timer device actions
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of (node.data.actions ?? [])) {
      const device = findDevice(sm.devices, action.deviceId);
      if (!device) continue;
      if (device.type === 'Timer') {
        const timerName = `${device.name}_Step${step}`;
        addTag(
          buildTimerTagXml(timerName, `${device.displayName} - Step ${step} dwell`, action.delayMs ?? 1000),
          timerName
        );
      }
    }
  }

  return tagXmls.join('\n');
}

// ─── R00_Main ────────────────────────────────────────────────────────────────

function generateR00Main(hasServo) {
  const rungs = [
    buildRung(0, 'Call Input Processing Routine', 'JSR(R01_Inputs,0);'),
    buildRung(1, 'Call State Transition Logic', 'JSR(R02_StateTransitions,0);'),
    buildRung(2, 'Call Pneumatic Valve Output Logic', 'JSR(R03_StateLogicValves,0);'),
  ];
  if (hasServo) {
    rungs.push(buildRung(3, 'Call Servo Motion Logic', 'JSR(R04_StateLogicServo,0);'));
  }
  rungs.push(buildRung(hasServo ? 4 : 3, 'Call Alarms Routine', 'JSR(R20_Alarms,0);'));

  return `
            <Routine Name="R00_Main" Type="RLL">
              <RLLContent>${rungs.join('')}
              </RLLContent>
            </Routine>`;
}

// ─── R01_Inputs ──────────────────────────────────────────────────────────────

function generateR01Inputs(sm) {
  const rungs = [];
  let rungNum = 0;

  for (const device of sm.devices) {
    const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
    if (!patterns) continue;

    switch (device.type) {
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator': {
        const sensorCount = device.sensorArrangement?.includes('2-sensor') ? 2 : 1;
        if (sensorCount === 2) {
          const extSensor = patterns.inputExt.replace(/\{name\}/g, device.name);
          const extDebounce = patterns.debounceExt.replace(/\{name\}/g, device.name);
          rungs.push(buildRung(rungNum++,
            `${device.displayName} - Extend sensor debounce (10ms)`,
            `XIC(${extSensor})TON(${extDebounce},0,0);`
          ));
        }
        const retSensor = patterns.inputRet.replace(/\{name\}/g, device.name);
        const retDebounce = patterns.debounceRet.replace(/\{name\}/g, device.name);
        rungs.push(buildRung(rungNum++,
          `${device.displayName} - Retract sensor debounce (10ms)`,
          `XIC(${retSensor})TON(${retDebounce},0,0);`
        ));
        break;
      }

      case 'PneumaticGripper': {
        const engSensor = patterns.inputEngage.replace(/\{name\}/g, device.name);
        const engDebounce = patterns.debounceEngage.replace(/\{name\}/g, device.name);
        rungs.push(buildRung(rungNum++,
          `${device.displayName} - Engage sensor debounce (10ms)`,
          `XIC(${engSensor})TON(${engDebounce},0,0);`
        ));
        break;
      }

      case 'DigitalSensor': {
        const inputTag = patterns.inputTag.replace(/\{name\}/g, device.name);
        const debounce = patterns.debounce.replace(/\{name\}/g, device.name);
        rungs.push(buildRung(rungNum++,
          `${device.displayName} - Input debounce`,
          `XIC(${inputTag})TON(${debounce},0,0);`
        ));
        break;
      }
    }
  }

  if (rungs.length === 0) {
    rungs.push(buildRung(0, 'No sensor inputs defined', 'AFI();'));
  }

  return `
            <Routine Name="R01_Inputs" Type="RLL">
              <RLLContent>${rungs.join('')}
              </RLLContent>
            </Routine>`;
}

// ─── R02_StateTransitions ────────────────────────────────────────────────────

function generateR02StateTransitions(sm, orderedNodes, stepMap, edges) {
  const rungs = [];
  let rungNum = 0;

  // Rung 0: First scan initialization
  rungs.push(buildRung(rungNum++,
    'First Scan - Initialize to Step 0',
    'XIC(S:FS)MOV(0,Step);'
  ));

  // For each edge (transition), generate a state transition rung
  for (const edge of edges) {
    const srcStep = stepMap[edge.source];
    const tgtStep = stepMap[edge.target];
    if (srcStep === undefined || tgtStep === undefined) continue;

    const cond = edge.data ?? {};
    const conditionText = buildConditionText(cond, sm.devices);
    const comment = `Step ${srcStep} → Step ${tgtStep}: ${edge.label ?? buildEdgeLabel(cond)}`;

    rungs.push(buildRung(rungNum++, comment,
      `EQU(Step,${srcStep})${conditionText}MOV(${tgtStep},Step);`
    ));
  }

  // Fault/reset: If no edges defined, add placeholder
  if (edges.length === 0) {
    rungs.push(buildRung(rungNum++, 'TODO: Add transition conditions in diagram', 'AFI();'));
  }

  return `
            <Routine Name="R02_StateTransitions" Type="RLL">
              <RLLContent>${rungs.join('')}
              </RLLContent>
            </Routine>`;
}

function buildEdgeLabel(cond) {
  switch (cond.conditionType) {
    case 'trigger': return `Trigger @ ${cond.tagName ?? '?'}`;
    case 'indexComplete': return 'Index Complete';
    case 'servoAtTarget': return `@ '${cond.positionName ?? '?'}'`;
    case 'sensorTimer': return 'Sensor + Timer';
    case 'sensorOn': return 'Sensor ON';
    case 'sensorOff': return 'Sensor OFF';
    case 'timer': return `Timer ${cond.delayMs ?? '?'}ms`;
    case 'always': return '(immediate)';
    default: return cond.conditionType ?? '?';
  }
}

function buildConditionText(cond, devices) {
  if (!cond || !cond.conditionType) return '';

  switch (cond.conditionType) {
    case 'always':
      return '';

    case 'indexComplete':
      return 'XIC(g_IndexComplete)';

    case 'trigger':
      return `XIC(${cond.tagName ?? 'g_Trigger'})`;

    case 'escapementComplete':
      return 'XIC(g_EscapementComplete)';

    case 'sensorOn': {
      const dev = findDevice(devices, cond.deviceId);
      if (!dev) return 'XIC(TODO_SensorTag)';
      const tag = getSensorTagForOperation(dev, cond.operation ?? 'WaitOn');
      const debounce = getDebounceTag(dev, cond.operation ?? 'WaitOn');
      if (debounce) return `XIC(${debounce}.DN)`;
      return `XIC(${tag})`;
    }

    case 'sensorOff': {
      const dev = findDevice(devices, cond.deviceId);
      if (!dev) return 'XIO(TODO_SensorTag)';
      const tag = getSensorTagForOperation(dev, cond.operation ?? 'WaitOff');
      return `XIO(${tag})`;
    }

    case 'sensorTimer': {
      const dev = findDevice(devices, cond.deviceId);
      if (!dev) return 'XIC(TODO_SensorTag)';
      const sensorTag = getSensorTagForOperation(dev, cond.operation);
      const timerTag = getDelayTimerForOperation(dev, cond.operation);
      const debounce = getDebounceTag(dev, cond.operation);
      if (!sensorTag || !timerTag) return 'XIC(TODO_SensorTimer)';
      if (debounce) return `XIC(${debounce}.DN)XIC(${timerTag}.DN)`;
      return `XIC(${sensorTag})XIC(${timerTag}.DN)`;
    }

    case 'timer': {
      const dev = findDevice(devices, cond.deviceId);
      if (dev?.type === 'Timer') return `XIC(${dev.name}.DN)`;
      if (cond.timerTag) return `XIC(${cond.timerTag}.DN)`;
      return 'XIC(TODO_TimerTag.DN)';
    }

    case 'servoAtTarget': {
      const dev = findDevice(devices, cond.deviceId);
      if (!dev) return 'XIC(TODO_Servo.PC)';
      const axisTag = getAxisTag(dev);
      // Servo at-target: use axis .PC (position command complete) or a custom AOI tag
      return `XIC(${axisTag}.PC)`;
    }

    case 'partPresent': {
      const dev = findDevice(devices, cond.deviceId);
      if (!dev) return 'XIC(TODO_PartPresent)';
      const tag = getSensorTagForOperation(dev, 'WaitOn') ?? `i_${dev.name}`;
      const debounce = getDebounceTag(dev, 'WaitOn');
      return debounce ? `XIC(${debounce}.DN)` : `XIC(${tag})`;
    }

    case 'custom':
      return cond.tagName ? `XIC(${cond.tagName})` : 'XIC(TODO_CustomTag)';

    default:
      return '';
  }
}

function getDebounceTag(device, operation) {
  const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
  if (!patterns) return null;
  const map = {
    Extend:    patterns.debounceExt,
    Retract:   patterns.debounceRet,
    Engage:    patterns.debounceEngage,
    Disengage: patterns.debounceDisengage,
    WaitOn:    patterns.debounce,
    Verify:    patterns.debounce,
  };
  const pattern = map[operation];
  if (!pattern) return null;
  return pattern.replace(/\{name\}/g, device.name);
}

// ─── R03_StateLogicValves ────────────────────────────────────────────────────

function generateR03StateLogicValves(sm, orderedNodes, stepMap) {
  const rungs = [];
  let rungNum = 0;

  // For each device, gather all steps that set/clear each output
  // We use OTL (latch) when an operation starts, OTU (unlatch) for the opposing operation
  // Also handle opposing outputs (e.g. when Extend is set, Retract must be cleared)

  const OPPOSING = {
    Extend:    'Retract',
    Retract:   'Extend',
    Engage:    'Disengage',
    Disengage: 'Engage',
    VacOn:     'VacOff',
    VacOff:    'VacOn',
    VacOnEject:'VacOff',
  };

  // Build a map: deviceId → [ { step, operation, outputTag } ]
  const deviceActionMap = {};

  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of (node.data.actions ?? [])) {
      const device = findDevice(sm.devices, action.deviceId);
      if (!device) continue;
      if (device.type === 'ServoAxis' || device.type === 'Timer' || device.type === 'DigitalSensor') continue;

      const outputTag = getOutputTagForOperation(device, action.operation);
      if (!outputTag) continue;

      if (!deviceActionMap[device.id]) deviceActionMap[device.id] = [];
      deviceActionMap[device.id].push({ step, operation: action.operation, outputTag, device });
    }
  }

  // Generate OTL + OTU rungs for each action
  for (const [, actions] of Object.entries(deviceActionMap)) {
    for (const { step, operation, outputTag, device } of actions) {
      const opLabel = `${device.displayName} - ${operation} (Step ${step})`;

      // OTL the output when in this step
      rungs.push(buildRung(rungNum++,
        opLabel,
        `EQU(Step,${step})OTL(${outputTag});`
      ));

      // OTU the opposing output
      const opposingOp = OPPOSING[operation];
      if (opposingOp) {
        const opposingTag = getOutputTagForOperation(device, opposingOp);
        if (opposingTag) {
          rungs.push(buildRung(rungNum++,
            `${device.displayName} - Clear ${opposingOp} when ${operation} (Step ${step})`,
            `EQU(Step,${step})OTU(${opposingTag});`
          ));
        }
      }
    }
  }

  if (rungs.length === 0) {
    rungs.push(buildRung(0, 'No pneumatic outputs defined', 'AFI();'));
  }

  return `
            <Routine Name="R03_StateLogicValves" Type="RLL">
              <RLLContent>${rungs.join('')}
              </RLLContent>
            </Routine>`;
}

// ─── R04_StateLogicServo ─────────────────────────────────────────────────────

function generateR04StateLogicServo(sm, orderedNodes, stepMap) {
  const rungs = [];
  let rungNum = 0;

  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of (node.data.actions ?? [])) {
      if (action.operation !== 'ServoMove') continue;

      const device = findDevice(sm.devices, action.deviceId);
      if (!device || device.type !== 'ServoAxis') continue;

      const axisTag = getAxisTag(device);
      const posTag = getPositionTag(device, action.positionName);
      const mamTag = `MAM_${device.name}`;
      const osTag = `${device.name}_Step${step}_OS`;

      // Generate one-shot MAM rung - fires once on state entry
      rungs.push(buildRung(rungNum++,
        `Move ${device.displayName} to ${action.positionName ?? '?'} (Step ${step})`,
        // MAM neutral text format: MAM(axis, ctrl_struct, motion_type, position, speed, accel, decel, speed_units, accel_units, decel_units, merge, merge_speed, lock_pos, event_dist, lock_dir, calc_profile)
        `EQU(Step,${step})ONS(${osTag})MAM(${axisTag},${mamTag},TRAPEZOIDAL,POSITION,${posTag ?? '0.0'},0.0,0.0,0.0,UNITS_PER_SEC,UNITS_PER_SEC_SQ,UNITS_PER_SEC_SQ,0,0.0,0,0.0,FORWARD,1);`
      ));
    }
  }

  if (rungs.length === 0) {
    rungs.push(buildRung(0, 'No servo axes defined', 'AFI();'));
  }

  return `
            <Routine Name="R04_StateLogicServo" Type="RLL">
              <RLLContent>${rungs.join('')}
              </RLLContent>
            </Routine>`;
}

// ─── R20_Alarms ──────────────────────────────────────────────────────────────

function generateR20Alarms(sm, orderedNodes, stepMap) {
  const rungs = [];
  let rungNum = 0;
  const programName = buildProgramName(sm.stationNumber, sm.name);

  // For each action that has a sensor verify, add a fault detect timer rung
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of (node.data.actions ?? [])) {
      const device = findDevice(sm.devices, action.deviceId);
      if (!device) continue;

      const sensorTag = getSensorTagForOperation(device, action.operation);
      const delayTag = getDelayTimerForOperation(device, action.operation);
      if (!sensorTag || !delayTag) continue;

      const faultTimer = `${delayTag}_Fault`;
      // Fault detect: while in this step AND sensor not yet confirmed → run fault timer
      // When fault timer DN → alarm
      rungs.push(buildRung(rungNum++,
        `${programName}: Fault detect - ${device.displayName} ${action.operation} (Step ${step})`,
        `EQU(Step,${step})XIO(${sensorTag})TON(${faultTimer},0,0);`
      ));
      rungs.push(buildRung(rungNum++,
        `${programName}: Fault alarm - ${device.displayName} ${action.operation} timeout`,
        `XIC(${faultTimer}.DN)OTE(TODO_${device.name}_${action.operation}_Fault);`
      ));
    }
  }

  if (rungs.length === 0) {
    rungs.push(buildRung(0, 'No alarm conditions defined', 'AFI();'));
  }

  return `
            <Routine Name="R20_Alarms" Type="RLL">
              <RLLContent>${rungs.join('')}
              </RLLContent>
            </Routine>`;
}

// ─── Main export function ────────────────────────────────────────────────────

/**
 * Export a state machine to L5X string
 * @param {Object} sm - state machine object from store
 * @returns {string} - complete L5X XML string
 */
export function exportToL5X(sm) {
  if (!sm) throw new Error('No state machine provided');

  const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
  const orderedNodes = orderNodes(sm.nodes ?? [], sm.edges ?? []);
  const stepMap = buildStepMap(orderedNodes);
  const edges = sm.edges ?? [];

  const hasServo = (sm.devices ?? []).some(d => d.type === 'ServoAxis');
  const hasValves = (sm.devices ?? []).some(d =>
    ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator'].includes(d.type)
  );

  const tagsXml = generateAllTags(sm, orderedNodes, stepMap, edges);
  const r00 = generateR00Main(hasServo);
  const r01 = generateR01Inputs(sm);
  const r02 = generateR02StateTransitions(sm, orderedNodes, stepMap, edges);
  const r03 = hasValves ? generateR03StateLogicValves(sm, orderedNodes, stepMap) : `
            <Routine Name="R03_StateLogicValves" Type="RLL">
              <RLLContent>${buildRung(0, 'No pneumatic valves', 'AFI();')}
              </RLLContent>
            </Routine>`;
  const r04 = generateR04StateLogicServo(sm, orderedNodes, stepMap);
  const r20 = generateR20Alarms(sm, orderedNodes, stepMap);

  const now = new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!--
  SDC State Logic Builder Export
  Program: ${programName}
  Station: S${String(sm.stationNumber ?? 0).padStart(2, '0')} ${sm.description ?? ''}
  Generated: ${now}

  IMPORT NOTES FOR CE:
  1. Import this file into Studio 5000 via "Import Component"
  2. Assign physical I/O to all i_ (Input) and q_ (Output) parameter tags
  3. Configure servo axes (AXIS_CIP_DRIVE) in the controller
  4. Set MAM velocity/accel parameters per machine requirements
  5. Replace TODO_ fault output tags with ProgramAlarmHandler alarm bits
  6. Import State_Engine_128Max AOI from X drive (optional - current Step DINT approach is compatible)
-->
<RSLogix5000Content SchemaRevision="${SCHEMA_REV}" SoftwareRevision="${SOFTWARE_REV}"
  TargetName="${programName}" TargetType="Program" ContainsContext="false"
  Owner="SDC State Logic Builder" ExportDate="${now}">
  <Controller Name="Controller" ProcessorType="${PROCESSOR_TYPE}" MajorRev="30" MinorRev="11"
    TimeSlice="20" ShareUnusedTimeSlice="1">
    <Programs>
      <Program Name="${programName}" TestEdits="false" MainRoutineName="R00_Main"
        Disabled="false" UseAsFolder="false">
        <Description>${cdata(`S${String(sm.stationNumber ?? 0).padStart(2, '0')} ${sm.description ?? sm.name ?? ''} - Auto-generated by SDC State Logic Builder`)}</Description>
        <Tags>${tagsXml}
        </Tags>
        <Routines>${r00}${r01}${r02}${r03}${r04}${r20}
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
}

/**
 * Trigger browser download of the L5X file
 */
export function downloadL5X(sm) {
  const xml = exportToL5X(sm);
  const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
  a.href = url;
  a.download = `${programName}.L5X`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export full project as JSON backup
 */
export function exportProjectJSON(project) {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name ?? 'project'}_backup.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
