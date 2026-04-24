/**
 * L5X Exporter v2 — State_Engine_128Max Pattern
 *
 * Generates L5X matching CE's Studio 5000 output:
 *  - State_Engine_128Max AOI with StateLogicControl / StateLogicStatus UDTs
 *  - Steps numbered by 3s starting at 10 (10, 13, 16, 19, …)
 *  - Auto-generated Wait (state 10) and Complete bookend states
 *  - R00_Main       — 3 JSR calls
 *  - R01_Inputs     — inverted-sensor → delay timer (1-sensor devices only)
 *  - R02_StateTransitions — XIC(Status.State[N]) + verify conditions + MOVE + AOI call
 *  - R03_StateLogic — OTE branch/latch per device, complementary outputs
 *  - No R04/R20     — fault detection via AOI FaultTime
 *
 * Reference: S01_CoreCoverLoadPNP.L5X (CE gold standard)
 */

import {
  getOutputTagForOperation,
  getSensorTagForOperation,
  getDelayTimerForOperation,
  getParameterTag,
  buildProgramName,
  getDeviceTags,
} from './tagNaming.js';
import { DEVICE_TYPES, getSensorConfigKey } from './deviceTypes.js';
import { resolveEntryRule } from './entryRules.js';
import { resolveIndexSync, isIndexSyncOverridden } from './indexSync.js';
import { derivePartTrackingTable } from './partTracking.js';

/**
 * Merge global PT fields (project.partTracking.fields) with fields derived
 * from this SM's auto-generated PT table. Returns a deduplicated fields[]
 * list suitable for tag/UDT generation.
 *
 * Each derived row becomes a synthetic BOOL field:
 *   { id: 'pt_<name>', name, dataType: 'boolean', _derived: true }
 */
function buildEffectiveTrackingFields(sm, stepMap, globalFields = []) {
  const byName = new Map();
  for (const f of (globalFields ?? [])) {
    if (f?.name) byName.set(f.name, f);
  }
  const rows = derivePartTrackingTable(sm, stepMap);
  for (const row of rows) {
    if (!row.enabled) continue;
    if (byName.has(row.fieldName)) continue;
    // Numeric data-output rows (vision R0..Rn) become REAL fields;
    // everything else stays BOOL.
    const dataType = row.dataType === 'real' ? 'real' : 'boolean';
    byName.set(row.fieldName, {
      id: `pt_${row.fieldName}`,
      name: row.fieldName,
      dataType,
      unit: row.unit ?? '',
      description: row.description ?? '',
      _derived: true,
    });
  }
  return Array.from(byName.values());
}

// ── Unified inputRef → tag resolver ─────────────────────────────────────────
//
// inputRef format:  "deviceId:key"   or   "deviceId:cross:smId"
//   key = ext | ret | eng | dis | vac | sensor | param | trigReady | {positionName/setpointName}
//
// Returns the L5X tag string (e.g. "i_CylExt", "q_MyParam", "MyServoHomeRC.In_Range")
// or null if unresolvable.

function resolveInputRefTag(inputRef, devices, allSMs = [], trackingFields = []) {
  if (!inputRef) return null;
  const parts = inputRef.split(':');
  if (parts.length < 2) return null;

  const deviceId = parts[0];
  const key = parts[1];

  // Part Tracking field reference: "_tracking:fieldId"
  if (deviceId === '_tracking') {
    // "All Pass" — AND of all tracking fields
    if (key === '_allPass') {
      if (!trackingFields || trackingFields.length === 0) return null;
      return trackingFields.map(f => `PartTracking.${f.name}`).join(' AND ');
    }
    const field = trackingFields.find(f => f.id === key);
    if (field) return `PartTracking.${field.name}`;
    return null;
  }

  // Cross-SM parameter:  "deviceId:cross:smId"
  if (key === 'cross' && parts[2]) {
    const crossSmId = parts[2];
    const crossSm = allSMs.find(s => s.id === crossSmId);
    if (!crossSm) return null;
    const dev = (crossSm.devices ?? []).find(d => d.id === deviceId);
    if (!dev) return null;
    const pfx = dev.dataType === 'boolean' ? 'q_' : 'p_';
    const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
    return `\\${progName}.${pfx}${dev.name}`;
  }

  // Local device lookup
  const dev = devices.find(d => d.id === deviceId);
  if (!dev) return null;

  switch (dev.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      // SDC Guide §8: full words — Extended/Retracted, not Ext/Ret.
      if (key === 'ext') return `i_${dev.name}Extended`;
      if (key === 'ret') return `i_${dev.name}Retracted`;
      break;
    case 'PneumaticGripper':
      // SDC Guide §15.9: 2-solenoid gripper — sensors are Closed/Open.
      if (key === 'eng') return `i_${dev.name}Closed`;
      if (key === 'dis') return `i_${dev.name}Open`;
      break;
    case 'PneumaticVacGenerator':
      if (key === 'vac') return `i_${dev.name}VacOn`;
      break;
    case 'DigitalSensor':
      if (key === 'sensor') return `i_${dev.name}`;
      break;
    case 'AnalogSensor':
      // key = setpointName → AOI_RangeCheck instance "{name}{setpointName}RC" with .InPos output
      return `${dev.name}${key}RC.InPos`;
    case 'ServoAxis':
      // key = positionName → AOI_RangeCheck instance "{name}{positionName}" with .InPos output
      return `${dev.name}${key}.InPos`;
    case 'Parameter': {
      const pfx = dev.dataType === 'boolean' ? 'q_' : 'p_';
      return `${pfx}${dev.name}`;
    }
    case 'VisionSystem':
      if (key === 'trigReady') return `i_${dev.name}TrigRdy`;
      if (key === 'resultReady') return `i_${dev.name}ResultReady`;
      if (key === 'inspPass') return `i_${dev.name}InspPass`;
      // Numeric output: ref = "deviceId:visionOut:jobName:outputName"
      if (key === 'visionOut' && parts[2] && parts[3]) {
        return `p_${dev.name}_${parts[2]}_${parts[3]}`;
      }
      break;
    case 'Robot': {
      // key = signal id → resolve to tag based on signal type
      const sig = (dev.signals ?? []).find(s => s.id === key);
      if (!sig) break;
      if (sig.group === 'Register') return `${dev.name}R${sig.number ?? 0}`;
      const tagPfx = sig.direction === 'input' ? 'i' : 'q';
      return `${tagPfx}_${dev.name}${sig.name}`;
    }
    case 'Custom': {
      const cDef = dev.customTypeDef;
      if (!cDef) break;
      // key matches an input name
      const inp = (cDef.inputs ?? []).find(i => i.name === key);
      if (inp?.tagPattern) return inp.tagPattern.replace(/\{name\}/g, dev.name);
      // key matches an analog I/O name
      const aio = (cDef.analogIO ?? []).find(a => a.name === key);
      if (aio?.tagPattern) return aio.tagPattern.replace(/\{name\}/g, dev.name);
      break;
    }
  }
  return null;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SCHEMA_REV = '1.0';
// SDC Guide §15.11: default to Studio 5000 v37 (engineer's current standard).
// Per-project override via project.machineConfig.softwareRevision.
export const SOFTWARE_REV = '37.00';
export const STEP_BASE = 1;          // Wait/Home state = 1
export const STEP_INCREMENT = 3;     // First action = 4, then 7, 10, 13, …
export const DEFAULT_FAULT_TIME = 5000;
// SDC Guide §15.11: controller name flows from project.machineConfig.controllerName.
// Constant is a fallback only for un-named projects.
export const CONTROLLER_NAME = 'SDCController';

// SDC Guide §15.5: state numbers reserved across all SDC machines — DFS must skip.
// 0 = pre-init; 1/2/3 = reserved; 99 = lockout; 100–127 = station-type init block.
// Flowchart DFS numbers (1, 4, 7, ...) that fall within any reserved range jump forward.
export const RESERVED_STATE_NUMBERS = new Set([0, 1, 2, 3, 99]);
export const RESERVED_STATE_RANGE_LOCKOUT = 99;
export const RESERVED_STATE_RANGE_INIT_MIN = 100;
export const RESERVED_STATE_RANGE_INIT_MAX = 127;

// ── XML helpers ──────────────────────────────────────────────────────────────

export function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function cdata(str) {
  return `<![CDATA[${str}]]>`;
}

// ── Node ordering (topological sort) ─────────────────────────────────────────

function orderNodes(nodes, edges) {
  if (!nodes || nodes.length === 0) return [];

  const start =
    nodes.find((n) => n.data.isInitial) ??
    [...nodes].sort((a, b) => a.data.stepNumber - b.data.stepNumber)[0];
  if (!start) return nodes;

  const visited = new Set();
  const ordered = [];

  function dfs(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    if (node) ordered.push(node);
    const outEdges = edges.filter((e) => e.source === nodeId);
    for (const e of outEdges) {
      dfs(e.target);
    }
  }

  dfs(start.id);

  // Append unreachable nodes
  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push(n);
  }

  return ordered;
}

// ── Step map (start at 4, increment by 3) ────────────────────────────────────
//
// State 1 = auto-generated Wait/Home state
// States 4, 7, 10, … = user's action nodes
// Last step + 3 = auto-generated Complete state

/**
 * Returns true if `n` lands in (or overlaps with) an SDC-reserved state number.
 * Reserved per §15.5: 0, 1, 2, 3 (future SDC use), 99 (lockout), 100-127 (init block).
 * The first three are handled by STEP_BASE starting the iteration after them;
 * this check covers 99 and the 100-127 range.
 */
function isReservedStateNumber(n) {
  if (n === RESERVED_STATE_RANGE_LOCKOUT) return true;
  if (n >= RESERVED_STATE_RANGE_INIT_MIN && n <= RESERVED_STATE_RANGE_INIT_MAX) return true;
  return false;
}

/** Advance `step` forward by STEP_INCREMENT, skipping any reserved numbers. */
function advanceStep(step) {
  let next = step + STEP_INCREMENT;
  while (isReservedStateNumber(next)) {
    next += STEP_INCREMENT;
  }
  return next;
}

function buildStepMap(orderedNodes, devices) {
  const map = {};
  let currentStep = STEP_BASE; // starts at 1 (wait state)

  orderedNodes.forEach((n) => {
    currentStep = advanceStep(currentStep);
    map[n.id] = currentStep;

    // VisionSystem Inspect nodes consume 4 sub-states (N, N+3, N+6, N+9)
    const hasVisionInspect = (n.data?.actions ?? []).some(a => {
      const dev = (devices ?? []).find(d => d.id === a.deviceId);
      return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
    });
    if (hasVisionInspect) {
      // Consume 3 extra slots. Skip reserved along the way.
      for (let i = 0; i < 3; i++) currentStep = advanceStep(currentStep);
    }
  });

  return map;
}

/** Recovery step map: states start at 100, increment by 3 */
function buildRecoveryStepMap(orderedNodes, devices) {
  const map = {};
  let currentStep = 100 - STEP_INCREMENT; // first node gets 100

  for (const n of orderedNodes) {
    currentStep += STEP_INCREMENT;
    map[n.id] = currentStep;
    const hasVisionInspect = (n.data?.actions ?? []).some(a => {
      const dev = (devices ?? []).find(d => d.id === a.deviceId);
      return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
    });
    if (hasVisionInspect) currentStep += STEP_INCREMENT * 3;
  }

  return map;
}

/** Get the vision sub-step numbers for a node, or null if not a vision node */
function getVisionSubSteps(node, devices, stepMap) {
  const baseStep = stepMap[node.id];
  if (baseStep === undefined) return null;
  const hasVisionInspect = (node.data?.actions ?? []).some(a => {
    const dev = (devices ?? []).find(d => d.id === a.deviceId);
    return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
  });
  if (!hasVisionInspect) return null;
  return [baseStep, baseStep + STEP_INCREMENT, baseStep + STEP_INCREMENT * 2, baseStep + STEP_INCREMENT * 3];
}

function getWaitStep() {
  return STEP_BASE; // always 1
}

function getCompleteStep(_orderedNodes, _devices) {
  // SDC Standard: Cycle Complete is always state 60 (reserved).
  // Process states occupy 4-59, init states 100-124.
  return 60;
}

// ── State description for Status tag comments ────────────────────────────────

function getStateDescription(node, devices) {
  // Decision nodes: use signal/condition name
  if (node?.type === 'decisionNode') {
    const mode = node.data?.nodeMode === 'decide' ? 'Branch' : 'Wait';
    const name = node.data?.signalName ?? 'Decision';
    const condCount = (node.data?.conditions ?? []).length;
    return condCount > 1 ? `${mode}: ${name} +${condCount - 1} more` : `${mode}: ${name}`;
  }
  const actions = node?.data?.actions ?? [];
  if (actions.length === 0) return node?.data?.label ?? 'Empty State';

  return actions
    .map((a) => {
      const dev = devices.find((d) => d.id === a.deviceId);
      if (!dev) return a.operation ?? '?';
      if (a.operation === 'ServoMove') {
        return `Move ${dev.displayName} to ${a.positionName ?? '?'}`;
      }
      if (a.operation === 'ServoIncr') {
        return a.positionName
          ? `Increment ${dev.displayName} — ${a.positionName} (${a.incrementDist ?? 1}mm)`
          : `Increment ${dev.displayName} (${a.incrementDist ?? 1}mm)`;
      }
      if (a.operation === 'ServoIndex') {
        return a.positionName
          ? `Index ${dev.displayName} — ${a.positionName} (${a.indexStations ?? 6}-pos)`
          : `Index ${dev.displayName} (${a.indexStations ?? 6}-pos)`;
      }
      if (a.operation === 'VisionInspect') {
        return `${dev.displayName} Inspect ${a.jobName ?? ''}`;
      }
      return `${a.operation} ${dev.displayName}`;
    })
    .join(', ');
}

// ── Rung builder ─────────────────────────────────────────────────────────────

export function buildRung(number, comment, text) {
  let xml = `\n<Rung Number="${number}" Type="N">`;
  if (comment) {
    xml += `\n<Comment>\n${cdata(comment)}\n</Comment>`;
  }
  xml += `\n<Text>\n${cdata(text)}\n</Text>`;
  xml += `\n</Rung>`;
  return xml;
}

// ── Tag XML builders ─────────────────────────────────────────────────────────

export function buildTimerTagXml(name, description, preMs) {
  return `
<Tag Name="${name}" TagType="Base" DataType="TIMER" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(`[0,${preMs},0]`)}
</Data>
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

export function buildBoolTagXml(name, description, usage, externalAccess = 'Read/Write') {
  return `
<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="${externalAccess}" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata('0')}
</Data>
<Data Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</Data>
</Tag>`;
}

export function buildDintTagXml(name, description, defaultValue = 0) {
  return `
<Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(String(defaultValue))}
</Data>
<Data Format="Decorated">
<DataValue DataType="DINT" Radix="Decimal" Value="${defaultValue}"/>
</Data>
</Tag>`;
}

function buildRealTagXml(name, description, defaultValue = 0.0) {
  return `
<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(String(defaultValue.toFixed(6)))}
</Data>
<Data Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="${defaultValue.toFixed(6)}"/>
</Data>
</Tag>`;
}

// ── Servo-specific tag XML builders ──────────────────────────────────────────

function buildAxisTagXml(name, description) {
  return `
<Tag Name="${name}" TagType="Base" DataType="AXIS_CIP_DRIVE" Usage="InOut" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
</Tag>`;
}

function buildMotionInstructionTagXml(name, description) {
  // MOTION_INSTRUCTION is a system-defined type whose members vary by firmware.
  // Omit Data sections — the controller initialises defaults on import.
  return `
<Tag Name="${name}" TagType="Base" DataType="MOTION_INSTRUCTION" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
</Tag>`;
}

function buildMAMParamTagXml(name) {
  return `
<Tag Name="${name}" TagType="Base" DataType="MAMParam" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata('[0,0.00000000e+000,0.00000000e+000,0.00000000e+000,0.00000000e+000]')}
</Data>
<Data Format="Decorated">
<Structure DataType="MAMParam">
<DataValueMember Name="MoveType" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Position" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Speed" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Accel" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Decel" DataType="REAL" Radix="Float" Value="0.0"/>
</Structure>
</Data>
</Tag>`;
}

/**
 * Minimal AOI instance tag. For complex AOIs (AOI_TorqueHome, AOI_Debounce,
 * etc.) where we don't enumerate every internal member, emit just the type
 * declaration — Studio 5000 fills defaults on import.
 */
function buildAOIInstanceTagXml(name, aoiName, description) {
  return `
<Tag Name="${name}" TagType="Base" DataType="${aoiName}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
</Tag>`;
}

function buildRangeCheckTagXml(name, description) {
  return `
<Tag Name="${name}" TagType="Base" DataType="AOI_RangeCheck" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata('[1,0.00000000e+000,0.00000000e+000,0.00000000e+000,0.00000000e+000,0]')}
</Data>
<Data Format="Decorated">
<Structure DataType="AOI_RangeCheck">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
<DataValueMember Name="Value" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Deadband" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Actual" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="InPos" DataType="BOOL" Value="0"/>
<DataValueMember Name="DeadbandWide" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="InPosWide" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

function buildRealParamTagXml(name, description, defaultValue = 0.0, usage = 'Local') {
  // Only include Usage attribute for 'Public' or 'InOut'; omit for local scope
  const usageAttr = (usage && usage !== 'Local') ? ` Usage="${usage}"` : '';
  return `
<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float"${usageAttr} Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(String(defaultValue.toFixed(6)))}
</Data>
<Data Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="${defaultValue.toFixed(6)}"/>
</Data>
</Tag>`;
}

// ── 128-element BOOL array helpers ───────────────────────────────────────────

export function generate128BoolL5K() {
  return Array(128).fill('2#0').join(',');
}

export function generate128BoolDecorated() {
  const lines = [];
  for (let i = 0; i < 128; i++) {
    lines.push(`<Element Index="[${i}]" Value="0"/>`);
  }
  return lines.join('\n');
}

// ── Control tag (StateLogicControl UDT) ──────────────────────────────────────

export function buildControlTagXml() {
  return `
<Tag Name="Control" TagType="Base" DataType="StateLogicControl" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata('[0,0,0,0]')}
</Data>
<Data Format="Decorated">
<Structure DataType="StateLogicControl">
<DataValueMember Name="StateReg" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EnaFaultDetect" DataType="BOOL" Value="0"/>
<DataValueMember Name="EnaTransitionTimer" DataType="BOOL" Value="0"/>
<DataValueMember Name="FaultTime" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="TransitionTime" DataType="DINT" Radix="Decimal" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

// ── Status tag (StateLogicStatus UDT) with state comments ────────────────────

function buildStatusTagXml(orderedNodes, stepMap, devices) {
  // Build state comments
  const waitStep = getWaitStep();
  const completeStep = getCompleteStep(orderedNodes, devices);
  const comments = [];

  comments.push(
    `<Comment Operand=".STATE[${waitStep}]">\n${cdata('Wait For Ready')}\n</Comment>`
  );

  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    const desc = getStateDescription(node, devices);
    const visionSubs = getVisionSubSteps(node, devices, stepMap);

    if (visionSubs) {
      // Vision sub-state comments (4 sub-states)
      const visionDevice = (devices ?? []).find(d => {
        return d.type === 'VisionSystem' && (node.data?.actions ?? []).some(a => a.deviceId === d.id);
      });
      const devName = visionDevice?.displayName ?? 'Vision';
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[0]}]">\n${cdata(`${devName} - Verify Trigger Ready`)}\n</Comment>`
      );
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[1]}]">\n${cdata(`${devName} - Wait Timer`)}\n</Comment>`
      );
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[2]}]">\n${cdata(`${devName} - Trigger`)}\n</Comment>`
      );
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[3]}]">\n${cdata(`${devName} - Check Results`)}\n</Comment>`
      );
    } else {
      comments.push(
        `<Comment Operand=".STATE[${step}]">\n${cdata(desc)}\n</Comment>`
      );
    }
  }

  comments.push(
    `<Comment Operand=".STATE[${completeStep}]">\n${cdata('Complete')}\n</Comment>`
  );

  const boolL5K = generate128BoolL5K();
  const boolDec = generate128BoolDecorated();

  return `
<Tag Name="Status" TagType="Base" DataType="StateLogicStatus" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Comments>
${comments.join('\n')}
</Comments>
<Data Format="L5K">
${cdata(`[[${boolL5K}],0,0]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="StateLogicStatus">
<ArrayMember Name="State" DataType="BOOL" Dimensions="128" Radix="Decimal">
${boolDec}
</ArrayMember>
<DataValueMember Name="PreviousState" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="StateChangeOccurred_OS" DataType="BOOL" Value="0"/>
<DataValueMember Name="TimeoutFlt" DataType="BOOL" Value="0"/>
<DataValueMember Name="TransitionTimerDone" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

// ── StateEngine tag (AOI instance) ───────────────────────────────────────────

export function buildStateEngineTagXml() {
  const boolL5K = generate128BoolL5K();

  return `
<Tag Name="StateEngine" TagType="Base" DataType="State_Engine_128Max" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata(`[1,[1,0,0,0,0,0,0,0,0,4,0,0],0,0,[1,0,0,0,0,0,0,0,0,4,0,0],[[${boolL5K}],0,0],0]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="State_Engine_128Max">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

// ── StateHistory tag (SINT[10]) ──────────────────────────────────────────────

export function buildStateHistoryTagXml() {
  return `
<Tag Name="StateHistory" TagType="Base" DataType="SINT" Dimensions="10" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata('[0,0,0,0,0,0,0,0,0,0]')}
</Data>
<Data Format="Decorated">
<Array DataType="SINT" Dimensions="10" Radix="Decimal">
<Element Index="[0]" Value="0"/>
<Element Index="[1]" Value="0"/>
<Element Index="[2]" Value="0"/>
<Element Index="[3]" Value="0"/>
<Element Index="[4]" Value="0"/>
<Element Index="[5]" Value="0"/>
<Element Index="[6]" Value="0"/>
<Element Index="[7]" Value="0"/>
<Element Index="[8]" Value="0"/>
<Element Index="[9]" Value="0"/>
</Array>
</Data>
</Tag>`;
}

// ── Generate all program tags ────────────────────────────────────────────────

function generateAllTags(sm, orderedNodes, stepMap, trackingFields = []) {
  const tags = [];
  const seen = new Set();

  function addTag(xml, name) {
    if (!seen.has(name)) {
      seen.add(name);
      tags.push(xml);
    }
  }

  // State engine infrastructure tags
  addTag(buildControlTagXml(), 'Control');
  addTag(buildStatusTagXml(orderedNodes, stepMap, sm.devices ?? []), 'Status');
  addTag(buildStateEngineTagXml(), 'StateEngine');
  addTag(buildStateHistoryTagXml(), 'StateHistory');

  // ── Standard scaffold tags (1116 pattern) ─────────────────────────────

  // Cycle control
  addTag(buildBoolTagXml('CycleRunning', 'Cycle Running', 'Local'), 'CycleRunning');
  addTag(buildBoolTagXml('CycleStopped', 'Cycle Stopped', 'Local'), 'CycleStopped');
  addTag(buildBoolTagXml('CycleStopping', 'Cycle Stopping', 'Local'), 'CycleStopping');
  addTag(buildTimerTagXml('CycleTimer', 'Cycle Time Accumulator', 0), 'CycleTimer');

  // Supervisor mapped inputs
  addTag(buildBoolTagXml('ManualMode', 'Manual Mode (from Supervisor)', 'Local'), 'ManualMode');
  addTag(buildBoolTagXml('SafetyOK', 'Safety OK (from Supervisor)', 'Local'), 'SafetyOK');
  addTag(buildBoolTagXml('FaultReset', 'Fault Reset (from Supervisor)', 'Local'), 'FaultReset');
  addTag(buildBoolTagXml('Initialized', 'Station Initialized', 'Local'), 'Initialized');

  // Fault state capture
  addTag(buildDintTagXml('FaultState', 'State when fault occurred'), 'FaultState');
  addTag(buildDintTagXml('RestartState', 'State to restart from after fault'), 'RestartState');
  addTag(buildDintTagXml('SafetyStopState', 'State when safety stop occurred'), 'SafetyStopState');

  // Single step
  addTag(buildBoolTagXml('SS', 'Single Step Active', 'Local'), 'SS');
  addTag(buildBoolTagXml('SS_OK', 'Single Step OK to Advance', 'Local'), 'SS_OK');
  addTag(buildBoolTagXml('LocalSS', 'Local Single Step Request', 'Local'), 'LocalSS');
  addTag(buildBoolTagXml('LocalSSONS', 'Local Single Step ONS', 'Local'), 'LocalSSONS');

  // One-shot and HMI
  addTag(buildDintTagXml('ONS', 'One-Shot Storage Bits'), 'ONS');
  addTag(buildDintTagXml('HMI_Button', 'HMI Manual Control Buttons'), 'HMI_Button');
  addTag(buildBoolTagXml('HMI_LocalManualOverride', 'Local Manual Override (bypasses Supervisor)', 'Local'), 'HMI_LocalManualOverride');

  // Timer arrays
  addTag(`
<Tag Name="Timer" TagType="Base" DataType="TIMER" Dimensions="10" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('General Purpose Timers')}
</Description>
</Tag>`, 'Timer');
  addTag(`
<Tag Name="SensorTimer" TagType="Base" DataType="TIMER" Dimensions="10" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Sensor Delay Timers')}
</Description>
</Tag>`, 'SensorTimer');

  // Alarm arrays
  addTag(`
<Tag Name="Alarm" TagType="Base" DataType="AlarmData" Dimensions="10" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Station Alarm Data')}
</Description>
</Tag>`, 'Alarm');
  addTag(`
<Tag Name="Warning" TagType="Base" DataType="AlarmData" Dimensions="5" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Station Warning Data')}
</Description>
</Tag>`, 'Warning');

  // NOTE: ProgramAlarmHandler references \Alarms.p_ProgramID, \Alarms.p_Active, \Alarms.p_History
  // and controller-scope g_CPUDateTime — these are provided by the Alarms program and controller tags.

  // Program fault handler AOI instance
  addTag(`
<Tag Name="ProgramFaultHandler" TagType="Base" DataType="ProgramAlarmHandler" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Program Alarm Handler Instance')}
</Description>
</Tag>`, 'ProgramFaultHandler');

  // Cycle time output
  addTag(`
<Tag Name="p_CycleTime" TagType="Base" DataType="REAL" Radix="Float" Usage="Public" Constant="false" ExternalAccess="Read Only" OpcUaAccess="None">
<Description>
${cdata('Last Cycle Time (seconds)')}
</Description>
<Data Format="L5K">
${cdata('0.000000')}
</Data>
<Data Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</Data>
</Tag>`, 'p_CycleTime');

  // Station status outputs
  addTag(buildBoolTagXml('q_AlarmActive', 'Alarm Active', 'Output', 'Read Only'), 'q_AlarmActive');
  addTag(buildBoolTagXml('q_WarningActive', 'Warning Active', 'Output', 'Read Only'), 'q_WarningActive');
  addTag(buildBoolTagXml('q_AutoMode', 'Auto Mode Status', 'Output', 'Read Only'), 'q_AutoMode');
  addTag(buildBoolTagXml('q_AutoStopped', 'Auto Stopped Status', 'Output', 'Read Only'), 'q_AutoStopped');
  addTag(buildBoolTagXml('q_StartOK', 'Station Start OK', 'Output', 'Read Only'), 'q_StartOK');

  // Debug tag
  addTag(buildDintTagXml('Debug_DINT', 'Debug Value'), 'Debug_DINT');

  // Per-device tags (I/O + delay timers, NO debounce, NO fault timers)
  for (const device of sm.devices ?? []) {
    const typeDef = DEVICE_TYPES[device.type];
    if (!typeDef) continue;
    const patterns = typeDef.tagPatterns;
    const sensorConfig = getSensorConfigKey(device);

    switch (device.type) {
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator': {
        // Sensor inputs
        if (sensorConfig === 'both') {
          addTag(
            buildBoolTagXml(
              patterns.inputExt.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Extended`,
              'Input'
            ),
            patterns.inputExt.replace(/\{name\}/g, device.name)
          );
          addTag(
            buildBoolTagXml(
              patterns.inputRet.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Retracted`,
              'Input'
            ),
            patterns.inputRet.replace(/\{name\}/g, device.name)
          );
          // 2-sensor: NO delay timers needed (direct sensor checks)
        } else if (sensorConfig === 'retractOnly') {
          addTag(
            buildBoolTagXml(
              patterns.inputRet.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Retracted`,
              'Input'
            ),
            patterns.inputRet.replace(/\{name\}/g, device.name)
          );
          // 1-sensor (Ret only): need ExtDelay timer for R01 pattern
          addTag(
            buildTimerTagXml(
              patterns.timerExt.replace(/\{name\}/g, device.name),
              `${device.displayName} Extended Delay Timer`,
              device.extTimerMs ?? typeDef.defaultTimerPreMs
            ),
            patterns.timerExt.replace(/\{name\}/g, device.name)
          );
        } else if (sensorConfig === 'extendOnly') {
          addTag(
            buildBoolTagXml(
              patterns.inputExt.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Extended`,
              'Input'
            ),
            patterns.inputExt.replace(/\{name\}/g, device.name)
          );
          addTag(
            buildTimerTagXml(
              patterns.timerRet.replace(/\{name\}/g, device.name),
              `${device.displayName} Retracted Delay Timer`,
              device.retTimerMs ?? typeDef.defaultTimerPreMs
            ),
            patterns.timerRet.replace(/\{name\}/g, device.name)
          );
        }

        // Output solenoids
        addTag(
          buildBoolTagXml(
            patterns.outputExtend.replace(/\{name\}/g, device.name),
            `Extend ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputExtend.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputRetract.replace(/\{name\}/g, device.name),
            `Retract ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputRetract.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'PneumaticGripper': {
        // Sensor inputs (only if device has sensors)
        if (sensorConfig === 'both' || sensorConfig === 'engageOnly') {
          addTag(
            buildBoolTagXml(
              patterns.inputEngage.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Engaged`,
              'Input'
            ),
            patterns.inputEngage.replace(/\{name\}/g, device.name)
          );
        }
        if (sensorConfig === 'both') {
          addTag(
            buildBoolTagXml(
              patterns.inputDisengage.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Disengaged`,
              'Input'
            ),
            patterns.inputDisengage.replace(/\{name\}/g, device.name)
          );
        }

        // Output solenoids
        addTag(
          buildBoolTagXml(
            patterns.outputEngage.replace(/\{name\}/g, device.name),
            `Engage ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputEngage.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputDisengage.replace(/\{name\}/g, device.name),
            `Disengage ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputDisengage.replace(/\{name\}/g, device.name)
        );

        // Delay timers (always needed — gripper uses inline TON in R02)
        addTag(
          buildTimerTagXml(
            patterns.timerEngage.replace(/\{name\}/g, device.name),
            `${device.displayName} Engage Delay Timer`,
            device.engageTimerMs ?? typeDef.defaultTimerPreMs
          ),
          patterns.timerEngage.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildTimerTagXml(
            patterns.timerDisengage.replace(/\{name\}/g, device.name),
            `${device.displayName} Disengage Delay Timer`,
            device.disengageTimerMs ?? typeDef.defaultTimerPreMs
          ),
          patterns.timerDisengage.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'PneumaticVacGenerator': {
        addTag(
          buildBoolTagXml(
            patterns.inputVacOn.replace(/\{name\}/g, device.name),
            `${device.displayName} Vacuum Established`,
            'Input'
          ),
          patterns.inputVacOn.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputVacOn.replace(/\{name\}/g, device.name),
            `${device.displayName} Vac On`,
            'Output',
            'Read Only'
          ),
          patterns.outputVacOn.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputVacOff.replace(/\{name\}/g, device.name),
            `${device.displayName} Vac Off`,
            'Output',
            'Read Only'
          ),
          patterns.outputVacOff.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildTimerTagXml(
            patterns.timerVacOn.replace(/\{name\}/g, device.name),
            `${device.displayName} Vac On Delay Timer`,
            device.vacOnTimerMs ?? typeDef.defaultTimerPreMs
          ),
          patterns.timerVacOn.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'Timer': {
        addTag(
          buildTimerTagXml(
            device.name,
            `${device.displayName} - Dwell Timer`,
            device.timerMs ?? typeDef.defaultTimerPreMs
          ),
          device.name
        );
        break;
      }

      case 'DigitalSensor': {
        addTag(
          buildBoolTagXml(
            patterns.inputTag.replace(/\{name\}/g, device.name),
            `${device.displayName} Sensor Input`,
            'Input'
          ),
          patterns.inputTag.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'Parameter': {
        // Cross-SM parameters are defined in the source program — no local tag needed
        if (device.paramScope !== 'cross-sm') {
          const paramPrefix = device.dataType === 'boolean' ? 'q_' : 'p_';
          const paramTagName = `${paramPrefix}${device.name}`;
          if (device.dataType === 'numeric') {
            addTag(
              buildRealTagXml(paramTagName, `${device.displayName} - Parameter`),
              paramTagName
            );
          } else {
            addTag(
              buildBoolTagXml(paramTagName, `${device.displayName} - Parameter`, 'Public'),
              paramTagName
            );
          }
        }
        break;
      }

      case 'ServoAxis': {
        // SDC Guide §15.4: Program-scope servo emissions.
        //   iq_{name}      InOut alias to controller-scope AXIS_CIP_DRIVE
        //   HMI_{name}     ServoOverall UDT (HMI block)
        //   MSO_/MSF_/MAFR_/MASR_/MAJ_/MAS_{name}_Jog/MAH_/MAM_{name}_Auto
        //   {Name}Ready/Permissive/AutoEnable/HomeConfimed/HomeRequested/HomeSelect/TorqueHome
        //
        // Controller-scope axis tag and MotionGroup are emitted separately in exportToL5X.
        // Positions live inside HMI_{name}.Parameters.Positions[N] (stable index, §15.3),
        // not as per-position REAL tags.
        const sp = DEVICE_TYPES.ServoAxis.tagPatterns;
        const stationNum = String(sm.stationNumber ?? 1).padStart(2, '0');
        const resolve = (patt) =>
          patt
            .replace(/\{name\}/g, device.name)
            .replace(/\{Name\}/g, device.name)
            .replace(/\{axisNum\}/g, String(device.axisNumber ?? 1).padStart(2, '0'))
            .replace(/\{station\}/g, stationNum);

        // iq_{name} InOut alias to controller-scope axis tag.
        const axisInOutTag = resolve(sp.axisInOut);
        addTag(buildAxisTagXml(axisInOutTag, `${device.displayName} - CIP Axis`), axisInOutTag);

        // HMI_{name} ServoOverall UDT — HMI block.
        const hmiTag = resolve(sp.hmiTag);
        addTag(
          `        <Tag Name="${hmiTag}" TagType="Base" DataType="ServoOverall" Constant="false" ExternalAccess="Read/Write">\n` +
          `          <Description>\n            ${cdata(`${device.displayName} - HMI block`)}\n          </Description>\n` +
          `          <Data Format="Decorated"><Structure DataType="ServoOverall"/></Data>\n` +
          `        </Tag>`,
          hmiTag
        );

        // Motion instruction instances (MOTION_INSTRUCTION, Local).
        // Engineer convention: {name}_MSO, {name}_MAJ, {name}_MAM, etc. — name prefix.
        const motionInstances = [
          { key: 'msoInst',     desc: 'MSO - Servo On' },
          { key: 'msfInst',     desc: 'MSF - Servo Off' },
          { key: 'mafrInst',    desc: 'MAFR - Axis Fault Reset' },
          { key: 'masrInst',    desc: 'MASR - Shutdown Reset' },
          { key: 'majInst',     desc: 'MAJ - Jog' },
          { key: 'masJogInst',  desc: 'MAS - Stop Jog' },
          { key: 'masAllInst',  desc: 'MAS - Stop All (permissive lost)' },
          { key: 'mahInst',     desc: 'MAH - Home' },
          { key: 'mamAutoInst', desc: 'MAM - Auto Move' },
          { key: 'mamInchInst', desc: 'MAM - Inch' },
        ];
        for (const m of motionInstances) {
          const patt = sp[m.key];
          if (!patt) continue;
          const tagName = resolve(patt);
          addTag(
            buildMotionInstructionTagXml(tagName, `${device.displayName} - ${m.desc}`),
            tagName
          );
        }

        // Per-axis support tags — mixed data types (§15.4 engineer reference).
        // BOOLs
        const supportBools = [
          { key: 'readyTag',         desc: 'Ready' },
          { key: 'permissiveTag',    desc: 'Motion Permissive' },
          { key: 'autoEnableTag',    desc: 'Auto Enable' },
          { key: 'homeConfirmedTag', desc: 'Home Confirmed' },  // sic: HomeConfimed per guide
          { key: 'homeRequestedTag', desc: 'Home Requested' },
          { key: 'homeSelectTag',    desc: 'Home Select' },
          { key: 'manMoveTrigTag',   desc: 'Manual Move Trigger' },
        ];
        for (const s of supportBools) {
          const patt = sp[s.key];
          if (!patt) continue;
          const tagName = resolve(patt);
          addTag(
            buildBoolTagXml(tagName, `${device.displayName} - ${s.desc}`, 'Local'),
            tagName
          );
        }
        // TIMER — EnableDelay + HomeConfirmDelay
        if (sp.enableDelayTag) {
          const t = resolve(sp.enableDelayTag);
          addTag(buildTimerTagXml(t, `${device.displayName} - Enable Debounce`, 0), t);
        }
        if (sp.homeConfirmDelayTag) {
          const t = resolve(sp.homeConfirmDelayTag);
          addTag(buildTimerTagXml(t, `${device.displayName} - Home Confirm Delay`, 0), t);
        }
        // DINT — ONS bits + JogDirection
        if (sp.onsTag) {
          const t = resolve(sp.onsTag);
          addTag(buildDintTagXml(t, `${device.displayName} - ONS Bits`), t);
        }
        if (sp.jogDirectionTag) {
          const t = resolve(sp.jogDirectionTag);
          addTag(buildDintTagXml(t, `${device.displayName} - Jog Direction (0=+, 1=-)`), t);
        }
        // REAL — InchAmount
        if (sp.inchAmountTag) {
          const t = resolve(sp.inchAmountTag);
          addTag(buildRealTagXml(t, `${device.displayName} - Inch Amount`), t);
        }
        // MAMParam UDT — MotionParameters block
        if (sp.motionParamsTag) {
          const t = resolve(sp.motionParamsTag);
          addTag(buildMAMParamTagXml(t), t);
        }
        // AOI_TorqueHome instance
        if (sp.torqueHomeTag) {
          const t = resolve(sp.torqueHomeTag);
          addTag(buildAOIInstanceTagXml(t, 'AOI_TorqueHome', `${device.displayName} - Torque Home`), t);
        }

        // Increment / Index params — retained for ServoIncr / ServoIndex operations.
        if (sp.incrementParam) {
          const incrTag = resolve(sp.incrementParam);
          addTag(
            buildRealParamTagXml(incrTag, `${device.displayName} - Increment Distance`, 0.0, 'Public'),
            incrTag
          );
        }
        if (sp.indexAngleParam) {
          const indexTag = resolve(sp.indexAngleParam);
          addTag(
            buildRealParamTagXml(indexTag, `${device.displayName} - Index Angle`, 0.0, 'Public'),
            indexTag
          );
        }
        break;
      }

      case 'VisionSystem': {
        const vp = DEVICE_TYPES.VisionSystem.tagPatterns;
        const trigReadyTag = vp.triggerReady.replace(/\{name\}/g, device.name);
        const triggerTag   = vp.trigger.replace(/\{name\}/g, device.name);
        const waitTimerTag = vp.waitTimer.replace(/\{name\}/g, device.name);
        const trigDwellTag = vp.trigDwell.replace(/\{name\}/g, device.name);

        // Trigger Ready input
        addTag(
          buildBoolTagXml(trigReadyTag, `${device.displayName} - Trigger Ready`, 'Input'),
          trigReadyTag
        );
        // Trigger output
        addTag(
          buildBoolTagXml(triggerTag, `${device.displayName} - Camera Trigger`, 'Output', 'Read Only'),
          triggerTag
        );
        // Wait Timer (between trigger ready and trigger)
        addTag(
          buildTimerTagXml(waitTimerTag, `${device.displayName} - Wait Timer`, device.waitTimerMs ?? 100),
          waitTimerTag
        );
        // Trigger Dwell Timer (after trigger, before next state)
        addTag(
          buildTimerTagXml(trigDwellTag, `${device.displayName} - Trigger Dwell`, device.trigDwellMs ?? 500),
          trigDwellTag
        );
        // Result Ready input
        const resultReadyTag = vp.resultReady.replace(/\{name\}/g, device.name);
        addTag(
          buildBoolTagXml(resultReadyTag, `${device.displayName} - Result Ready`, 'Input'),
          resultReadyTag
        );
        // Inspection Pass input
        const inspPassTag = vp.inspPass.replace(/\{name\}/g, device.name);
        addTag(
          buildBoolTagXml(inspPassTag, `${device.displayName} - Inspection Pass`, 'Input'),
          inspPassTag
        );
        // Search Timeout timer (for continuous mode — check if any action uses continuous)
        const searchTimeoutTag = vp.searchTimeout.replace(/\{name\}/g, device.name);
        addTag(
          buildTimerTagXml(searchTimeoutTag, `${device.displayName} - Search Timeout`, 5000),
          searchTimeoutTag
        );
        // Numeric outputs per job (vision data values — X_Offset, PartCount, etc.)
        for (const job of (device.jobs ?? [])) {
          for (const numOut of (job.numericOutputs ?? [])) {
            if (!numOut.name?.trim()) continue;
            const outTagName = `p_${device.name}_${job.name}_${numOut.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
            const unitSuffix = numOut.unit ? ` (${numOut.unit})` : '';
            addTag(
              buildRealParamTagXml(outTagName, `${device.displayName} ${job.name} - ${numOut.name}${unitSuffix}`, 0.0, 'Public'),
              outTagName
            );
          }
        }
        break;
      }

      case 'Robot': {
        // RIN tag instance (Robot → PLC)
        const rinTagName = `${device.name}_RIN`;
        const rinUdtName = `FanucRobotRIN_${device.name}`;
        addTag(`
<Tag Name="${rinTagName}" TagType="Base" DataType="${rinUdtName}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(`${device.displayName} - Robot Input Data (Robot to PLC)`)}
</Description>
</Tag>`, rinTagName);

        // ROUT tag instance (PLC → Robot)
        const routTagName = `${device.name}_ROUT`;
        const routUdtName = `FanucRobotROUT_${device.name}`;
        addTag(`
<Tag Name="${routTagName}" TagType="Base" DataType="${routUdtName}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(`${device.displayName} - Robot Output Data (PLC to Robot)`)}
</Description>
</Tag>`, routTagName);

        // Run_Robot_Seq AOI instances + supporting tags
        addTag(buildDintTagXml(`${device.name}_SeqReq`, `${device.displayName} Sequence Request`), `${device.name}_SeqReq`);
        addTag(buildDintTagXml(`${device.name}_RunningSeq`, `${device.displayName} Running Sequence`), `${device.name}_RunningSeq`);
        addTag(buildBoolTagXml(`${device.name}_ResumeOK`, `${device.displayName} Resume OK`, 'Local'), `${device.name}_ResumeOK`);

        // Also keep individual aliased tags for backward compatibility with availableInputs refs
        for (const sig of (device.signals ?? [])) {
          if (!sig.name?.trim()) continue;
          if (sig.group === 'Register') {
            const regTag = `${device.name}R${sig.number ?? 0}`;
            const dt = sig.dataType === 'REAL' ? 'REAL' : 'DINT';
            if (dt === 'REAL') {
              addTag(buildRealParamTagXml(regTag, `${device.displayName} R[${sig.number}] ${sig.name}`, 0.0, sig.direction === 'output' ? 'Public' : 'Local'), regTag);
            } else {
              addTag(buildDintTagXml(regTag, `${device.displayName} R[${sig.number}] ${sig.name}`), regTag);
            }
          } else {
            const tagPfx = sig.direction === 'input' ? 'i' : 'q';
            const tagName = `${tagPfx}_${device.name}${sig.name}`;
            const usage = sig.direction === 'input' ? 'Input' : 'Output';
            const grpLabel = sig.group === 'DI' ? 'DI' : 'DO';
            addTag(
              buildBoolTagXml(tagName, `${device.displayName} ${grpLabel}[${sig.number}] ${sig.name}`, usage, sig.direction === 'output' ? 'Read Only' : undefined),
              tagName
            );
          }
        }
        break;
      }

      case 'Custom': {
        const cDef = device.customTypeDef;
        if (!cDef) break;
        // Custom outputs
        for (const out of (cDef.outputs ?? [])) {
          if (!out.tagPattern) continue;
          const tag = out.tagPattern.replace(/\{name\}/g, device.name);
          addTag(
            buildBoolTagXml(tag, `${device.displayName} - ${out.name}`, 'Output', 'Read Only'),
            tag
          );
        }
        // Custom inputs
        for (const inp of (cDef.inputs ?? [])) {
          if (!inp.tagPattern) continue;
          const tag = inp.tagPattern.replace(/\{name\}/g, device.name);
          if (inp.dataType === 'REAL') {
            addTag(buildRealParamTagXml(tag, `${device.displayName} - ${inp.name}`, 0.0, 'Local'), tag);
          } else {
            addTag(buildBoolTagXml(tag, `${device.displayName} - ${inp.name}`, 'Input'), tag);
          }
        }
        // Analog I/O
        for (const aio of (cDef.analogIO ?? [])) {
          if (!aio.tagPattern) continue;
          const tag = aio.tagPattern.replace(/\{name\}/g, device.name);
          addTag(
            buildRealParamTagXml(tag, `${device.displayName} - ${aio.name}`, 0.0, aio.direction === 'input' ? 'Local' : 'Local'),
            tag
          );
        }
        // Timers from operations
        for (const op of (cDef.operations ?? [])) {
          if (!op.timerSuffix) continue;
          const timerTag = `${device.name}${op.timerSuffix}`;
          addTag(
            buildTimerTagXml(timerTag, `${device.displayName} - ${op.label} delay`, op.defaultTimerMs ?? 500),
            timerTag
          );
        }
        break;
      }
    }
  }

  // Retry counter tags for CheckResults outcomes with retry enabled
  for (const device of sm.devices ?? []) {
    if (device.type !== 'CheckResults') continue;
    for (const outcome of device.outcomes ?? []) {
      if (!outcome.retry) continue;
      const counterTag = `${device.name}_${outcome.id}_RetryCnt`;
      addTag(
        buildDintTagXml(counterTag, `${device.displayName} Branch retry counter`),
        counterTag
      );
      const maxTag = `${device.name}_${outcome.id}_MaxRetries`;
      addTag(
        buildDintTagXml(maxTag, `${device.displayName} Branch max retries`, outcome.maxRetries ?? 3),
        maxTag
      );
    }
  }

  // PartTracking tag instance (if any fields are defined)
  if (trackingFields.length > 0) {
    // Build L5K and Decorated data for the UDT instance
    const sintCount = Math.ceil(trackingFields.length / 8);
    const l5kData = Array(sintCount).fill('0').join(',');
    let decoratedMembers = '';
    trackingFields.forEach((f, i) => {
      const sintIdx = Math.floor(i / 8);
      const bitNum = i % 8;
      decoratedMembers += `<DataValueMember Name="${escapeXml(f.name)}" DataType="BOOL" Value="0"/>\n`;
    });
    addTag(`
<Tag Name="PartTracking" TagType="Base" DataType="PartTracking_UDT" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Part Tracking Data')}
</Description>
<Data Format="L5K">
${cdata(`[${l5kData}]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="PartTracking_UDT">
${decoratedMembers}</Structure>
</Data>
</Tag>`, 'PartTracking');
  }

  // SM Output BOOL tags (q_OutputName) — one per smOutput entry
  // q_ prefix = output parameter (non-latching, OTE pattern per SDC standard)
  for (const smOut of sm.smOutputs ?? []) {
    if (!smOut.name) continue;
    const tag = `q_${smOut.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
    const desc = smOut.description ? smOut.description : `SM Output: ${smOut.name}`;
    addTag(buildBoolTagXml(tag, desc, 'Public'), tag);
  }

  return tags.join('\n');
}

// ── R00_Main ─────────────────────────────────────────────────────────────────

function generateR00Main(sm = null) {
  const rungs = [];
  let n = 0;
  rungs.push(buildRung(n++, 'Subroutine Calls', 'JSR(R01_Inputs,0);'));
  rungs.push(buildRung(n++, null, 'JSR(R02_StateTransitions,0);'));
  rungs.push(buildRung(n++, null, 'JSR(R03_StateLogic,0);'));

  // Per-axis servo routines: R04_{axis1}Servo, R05_{axis2}Servo, ... (engineer convention).
  const servos = (sm?.devices ?? []).filter(d => d.type === 'ServoAxis');
  servos.forEach((dev, idx) => {
    const num = String(4 + idx).padStart(2, '0');
    rungs.push(buildRung(n++, null, `JSR(R${num}_${dev.name}Servo,0);`));
  });

  // Recovery routine at the next consecutive slot after servos (R04 if 0 servos).
  const recoveryNum = String(4 + servos.length).padStart(2, '0');
  rungs.push(buildRung(n++, null, `JSR(R${recoveryNum}_Recovery,0);`));

  rungs.push(buildRung(n++, null, 'JSR(R20_Alarms,0);'));

  return `
<Routine Name="R00_Main" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── R01_Inputs ───────────────────────────────────────────────────────────────
//
// SDC Guide §15.7 — boilerplate R01 ordering (emitted on every SM):
//   1. HMI_Toggle decode (fixed bit map: .0 Lockout, .1 DryRun, .2 SS)
//   2. SS_OK derivation (single-step advance pulse gate)
//   3. HMI_Momentary auto-clear (one OTU per declared momentary bit)
//   4. 1-sensor pneumatic invert (only for devices flagged as 1-sensor)
//   5. AOI_Debounce calls for part-present DigitalSensors (100/100 ms defaults)
//   6. CPU_TimeDate_wJulian call (once per program)
//
// Legacy Supervisor mappings (ManualMode/SafetyOK/FaultReset/CycleRunning/
// Initialized) are retained at the top for backward compatibility with
// existing State 0/1/2/3 R02 rungs — these will eventually be folded into the
// §15.5 reserved-state model.

function generateR01Inputs(sm) {
  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];

  // ── Legacy Supervisor integration (retained) ─────────────────────────────
  rungs.push(buildRung(rungNum++, 'Mapped Inputs from Supervisor', 'NOP();'));
  rungs.push(buildRung(rungNum++, null, 'XIC(\\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);'));
  rungs.push(buildRung(rungNum++, null, 'XIC(\\Supervisor.q_SafetyOK)OTE(SafetyOK);'));
  rungs.push(buildRung(rungNum++, null, 'XIC(\\Supervisor.q_FaultReset)OTE(FaultReset);'));
  rungs.push(buildRung(rungNum++, null, '[XIC(\\Supervisor.q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ]OTE(CycleRunning);'));
  rungs.push(buildRung(rungNum++, null, 'XIO(\\Supervisor.q_CycleStartLatch)OTE(CycleStopping);'));
  rungs.push(buildRung(rungNum++, null, 'XIC(\\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);'));
  rungs.push(buildRung(rungNum++, 'Initialization', 'XIC(Status.State[124])OTE(Initialized);'));

  // ── §15.7 step 1: HMI_Toggle decode (fixed bit map) ──────────────────────
  rungs.push(buildRung(rungNum++, 'HMI_Toggle Decode', 'XIC(HMI_Toggle.0)OTE(Lockout);'));
  rungs.push(buildRung(rungNum++, null, 'XIC(HMI_Toggle.1)OTE(DryRun);'));
  rungs.push(buildRung(rungNum++, null, 'XIC(HMI_Toggle.2)OTE(SS);'));

  // ── §15.7 step 2: SS_OK ──────────────────────────────────────────────────
  // SS_OK is true when single-step is OFF, or when SS is ON and the operator
  // has pulsed HMI_Momentary.StepAdvance (one-shot advance).
  rungs.push(buildRung(rungNum++, 'SS_OK', '[XIO(SS) ,XIC(SS) XIC(HMI_Momentary.StepAdvance) ONS(SS_ONS) ]OTE(SS_OK);'));

  // ── §15.7 step 3: HMI_Momentary auto-clear ───────────────────────────────
  // Each declared momentary bit: XIC(HMI_Momentary.X) OTU(HMI_Momentary.X) so
  // the pulse self-clears on the next scan. Default bit: StepAdvance. Additional
  // bits from project.machineConfig.hmiMomentaryBits (if present) get added.
  const momentaryBits = sm.hmiMomentaryBits ?? ['StepAdvance', 'FaultReset', 'CycleStart'];
  let momentaryCommentAdded = false;
  for (const bitName of momentaryBits) {
    rungs.push(buildRung(rungNum++, !momentaryCommentAdded ? 'HMI_Momentary Auto-Clear' : null,
      `XIC(HMI_Momentary.${bitName})OTU(HMI_Momentary.${bitName});`));
    momentaryCommentAdded = true;
  }

  // ── §15.7 step 4: 1-sensor pneumatic invert ──────────────────────────────
  // For devices with only one limit switch, derive the opposite sensor via TON
  // (the existing pattern is a delay-timer gate on the declared-sensor edge).
  let addedSensorComment = false;
  for (const device of devices) {
    if (device.type !== 'PneumaticLinearActuator' && device.type !== 'PneumaticRotaryActuator') continue;
    const sensorConfig = getSensorConfigKey(device);
    const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
    if (!patterns) continue;

    if (sensorConfig === 'retractOnly') {
      const retSensor = patterns.inputRet.replace(/\{name\}/g, device.name);
      const extDelay = patterns.timerExt.replace(/\{name\}/g, device.name);
      rungs.push(buildRung(rungNum++, !addedSensorComment ? '1-Sensor Pneumatic Delay Timers' : null,
        `XIO(${retSensor})TON(${extDelay},?,?);`));
      addedSensorComment = true;
    } else if (sensorConfig === 'extendOnly') {
      const extSensor = patterns.inputExt.replace(/\{name\}/g, device.name);
      const retDelay = patterns.timerRet.replace(/\{name\}/g, device.name);
      rungs.push(buildRung(rungNum++, !addedSensorComment ? '1-Sensor Pneumatic Delay Timers' : null,
        `XIO(${extSensor})TON(${retDelay},?,?);`));
      addedSensorComment = true;
    }
  }

  // ── §15.7 step 5: AOI_Debounce calls for part-present DigitalSensors ─────
  // Per user confirmation: required for DigitalSensor part-present; NOT for
  // pneumatic ext/ret sensors, NOT for robot DI/DO.
  let debounceCommentAdded = false;
  for (const device of devices) {
    if (device.type !== 'DigitalSensor') continue;
    const inputTag = `i_${device.name}`;
    const debounceInst = `${device.name}Debounce`;
    // AOI_Debounce(instance, Input, OnDelay, OffDelay) — SDC default 100 ms / 100 ms.
    rungs.push(buildRung(rungNum++, !debounceCommentAdded ? 'Debounce Filters' : null,
      `AOI_Debounce(${debounceInst},${inputTag},100,100);`));
    debounceCommentAdded = true;
  }

  // ── §15.7 step 6: CPU time/date capture (g_CPUDateTime is controller-scope) ──
  rungs.push(buildRung(rungNum++, 'CPU Time/Date',
    'CPU_TimeDate_wJulian(\\g_CPUDateTime);'));

  // Legacy SS handling — retained so LocalSS panel buttons still work until
  // the project fully migrates to HMI_Toggle-only.
  rungs.push(buildRung(rungNum++, 'Legacy LocalSS Passthrough', 'XIC(LocalSS)OTE(SS);'));

  return `
<Routine Name="R01_Inputs" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── Verify condition builder ─────────────────────────────────────────────────
//
// Given a source state's actions, build the ladder rung condition text
// that verifies all actions completed before allowing transition.
//
// Patterns (matching CE output):
//   2-sensor cylinder Extend:  XIC(i_{name}Ext)XIO(i_{name}Ret)
//   2-sensor cylinder Retract: XIC(i_{name}Ret)XIO(i_{name}Ext)
//   1-sensor (Ret) Extend:     XIC({name}ExtDelay.DN)
//   1-sensor (Ret) Retract:    XIC(i_{name}Ret)
//   Gripper (any):             TON({name}XXXDelay,?,?)XIC({name}XXXDelay.DN)
//   Timer/Dwell:               TON({name},?,?)XIC({name}.DN)
//   DigitalSensor WaitOn:      XIC(i_{name})
//   DigitalSensor WaitOff:     XIO(i_{name})
//   VacGenerator VacOn:        XIC(i_{name}VacOn)

function buildVerifyConditions(node, devices, allSMs = [], trackingFields = []) {
  // Decision nodes with single exit (wait mode): resolve wait condition
  if (node?.type === 'decisionNode' && node?.data?.exitCount === 1) {
    const dData = node.data;
    const dConditions = dData.conditions ?? [];
    const dLogic = dData.conditionLogic ?? 'AND';
    if (dConditions.length > 0) {
      const condParts = [];
      for (const cond of dConditions) {
        const tag = resolveInputRefTag(cond.ref, devices, allSMs, trackingFields);
        if (!tag) continue;
        const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
        for (const t of tagList) {
          condParts.push(cond.conditionType === 'off' ? `XIO(${t})` : `XIC(${t})`);
        }
      }
      if (dLogic === 'OR' && condParts.length > 1) {
        return `[${condParts.join(' ,')}]`;
      }
      return condParts.join('');
    } else if (dData.sensorRef) {
      const tag = resolveInputRefTag(dData.sensorRef, devices, allSMs, trackingFields);
      if (tag) return dData.conditionType === 'off' ? `XIO(${tag})` : `XIC(${tag})`;
    }
    return '';
  }

  const actions = node?.data?.actions ?? [];
  if (actions.length === 0) return '';

  let conditions = '';

  for (const action of actions) {
    // Skip tracking actions — they are output latches, not verify conditions
    if (action.deviceId === '_tracking') continue;

    const device = devices.find((d) => d.id === action.deviceId);
    if (!device) continue;

    // CheckResults with 2+ outcomes: branching handled in R02 (skip here)
    // CheckResults with 1 outcome: single-condition verify (generate XIC/XIO inline)
    if (device.type === 'CheckResults') {
      const outcomes = device.outcomes ?? [];
      if (outcomes.length === 1 && outcomes[0].inputRef) {
        const out = outcomes[0];
        const tag = resolveInputRefTag(out.inputRef, devices, allSMs, trackingFields);
        if (tag) {
          const isOff = out.condition === 'off' || out.condition === 'outOfRange';
          // _allPass returns "tag1 AND tag2 …" — expand to multiple XIC/XIO
          const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
          for (const t of tagList) {
            conditions += isOff ? `XIO(${t})` : `XIC(${t})`;
          }
        }
      }
      continue;
    }
    // VisionSystem has internal sub-state transitions — handled separately in R02
    if (device.type === 'VisionSystem') continue;

    const typeDef = DEVICE_TYPES[device.type];
    if (!typeDef) continue;
    const patterns = typeDef.tagPatterns;
    const sensorConfig = getSensorConfigKey(device);

    switch (device.type) {
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator': {
        if (sensorConfig === 'both') {
          if (action.operation === 'Extend') {
            const extTag = patterns.inputExt.replace(/\{name\}/g, device.name);
            const retTag = patterns.inputRet.replace(/\{name\}/g, device.name);
            conditions += `XIC(${extTag})XIO(${retTag})`;
          } else if (action.operation === 'Retract') {
            const retTag = patterns.inputRet.replace(/\{name\}/g, device.name);
            const extTag = patterns.inputExt.replace(/\{name\}/g, device.name);
            conditions += `XIC(${retTag})XIO(${extTag})`;
          }
        } else if (sensorConfig === 'retractOnly') {
          if (action.operation === 'Extend') {
            const delayTag = patterns.timerExt.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${delayTag}.DN)`;
          } else if (action.operation === 'Retract') {
            const retTag = patterns.inputRet.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${retTag})`;
          }
        } else if (sensorConfig === 'extendOnly') {
          if (action.operation === 'Extend') {
            const extTag = patterns.inputExt.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${extTag})`;
          } else if (action.operation === 'Retract') {
            const delayTag = patterns.timerRet.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${delayTag}.DN)`;
          }
        }
        break;
      }

      case 'PneumaticGripper': {
        if (action.operation === 'Engage') {
          const tmr = patterns.timerEngage.replace(/\{name\}/g, device.name);
          conditions += `TON(${tmr},?,?)XIC(${tmr}.DN)`;
        } else if (action.operation === 'Disengage') {
          const tmr = patterns.timerDisengage.replace(
            /\{name\}/g,
            device.name
          );
          conditions += `TON(${tmr},?,?)XIC(${tmr}.DN)`;
        }
        break;
      }

      case 'PneumaticVacGenerator': {
        if (action.operation === 'VacOn') {
          const sensorTag = patterns.inputVacOn.replace(
            /\{name\}/g,
            device.name
          );
          conditions += `XIC(${sensorTag})`;
        } else if (action.operation === 'VacOff') {
          const tmr = patterns.timerVacOn.replace(/\{name\}/g, device.name);
          conditions += `TON(${tmr},?,?)XIC(${tmr}.DN)`;
        }
        break;
      }

      case 'ServoAxis': {
        // Engineer convention: {name}_MAM is the auto-move instance (§15.2).
        const mamTag = (patterns.mamAutoInst ?? '{name}_MAM').replace(/\{name\}/g, device.name);
        conditions += `XIC(${mamTag}.PC)`;
        // Position In_Range only for ServoMove (not ServoIncr/ServoIndex)
        if (action.operation === 'ServoMove') {
          const posName = action.positionName ?? '';
          if (posName) {
            const rcTag = patterns.positionRC
              .replace(/\{name\}/g, device.name)
              .replace(/\{positionName\}/g, posName);
            conditions += `XIC(${rcTag}.InPos)`;
          }
        }
        break;
      }

      case 'Timer': {
        conditions += `TON(${device.name},?,?)XIC(${device.name}.DN)`;
        break;
      }

      case 'DigitalSensor': {
        const sensorTag = patterns.inputTag.replace(
          /\{name\}/g,
          device.name
        );
        if (
          action.operation === 'WaitOn' ||
          action.operation === 'Verify'
        ) {
          conditions += `XIC(${sensorTag})`;
        } else if (action.operation === 'WaitOff') {
          conditions += `XIO(${sensorTag})`;
        }
        break;
      }

      case 'AnalogSensor': {
        // VerifyValue: check AOI_RangeCheck .InPos bit for the selected setpoint
        const spName = action.setpointName ?? '';
        if (spName) {
          const rcTag = patterns.rangeCheckInst
            .replace(/\{name\}/g, device.name)
            .replace(/\{setpointName\}/g, spName);
          conditions += `XIC(${rcTag}.InPos)`;
        }
        break;
      }

      case 'Parameter': {
        // WaitOn → XIC(p_Name), WaitOff → XIO(p_Name)
        // SetOn/SetOff/SetValue are outputs (handled in R03) — no verify condition
        const paramTag = getParameterTag(device, allSMs);
        if (action.operation === 'WaitOn') {
          conditions += `XIC(${paramTag})`;
        } else if (action.operation === 'WaitOff') {
          conditions += `XIO(${paramTag})`;
        }
        break;
      }

      case 'Robot': {
        // RunSequence: transition when Run_Robot_Seq AOI reports .Complete
        // WaitInput:   transition when the named DO bit matches expected value
        // SetOutput:   immediate — latched in R03, no verify condition
        if (action.operation === 'RunSequence') {
          const instName = `RunSeq_${device.name}_${(action.sequenceName ?? 'Seq').replace(/[^a-zA-Z0-9_]/g, '')}`;
          conditions += `XIC(${instName}.Complete)`;
        } else if (action.operation === 'WaitInput') {
          const sig = (device.signals ?? []).find(s => s.id === action.signalId)
            ?? { name: action.signalName };
          const tag = `${device.name}_RIN.${sig.name}`;
          conditions += action.signalValue === 'OFF' ? `XIO(${tag})` : `XIC(${tag})`;
        }
        // SetOutput has no verify — the PLC drives the bit in R03
        break;
      }
    }
  }

  return conditions;
}

// ── Home verify conditions ──────────────────────────────────────────────────
//
// Build verify conditions for the wait→first action transition.
// Checks that all devices with a homePosition are in their home state.
// Reuses the same verify patterns as buildVerifyConditions.

function buildHomeVerifyConditions(devices, allSMs = [], trackingFields = []) {
  // Create virtual actions from each device's home position
  // Fall back to defaultHomePosition from device type if not explicitly set
  const virtualActions = (devices ?? [])
    .map(d => ({
      deviceId: d.id,
      operation: d.homePosition || DEVICE_TYPES[d.type]?.defaultHomePosition,
    }))
    .filter(a => a.operation);

  if (virtualActions.length === 0) return '';

  const virtualNode = { data: { actions: virtualActions } };
  return buildVerifyConditions(virtualNode, devices, allSMs, trackingFields);
}

// ── R02_StateTransitions ─────────────────────────────────────────────────────

function generateR02StateTransitions(sm, orderedNodes, stepMap, allSMs = [], trackingFields = [], machineConfig = null) {
  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];
  const waitStep = getWaitStep();

  // Check for explicit complete node — if present, use its step instead of auto-calculated
  const explicitCompleteNode = orderedNodes.find(n => n.data?.isComplete);
  const completeStep = explicitCompleteNode
    ? stepMap[explicitCompleteNode.id]
    : getCompleteStep(orderedNodes, devices);

  // ── Reserved States (SDC Standard 1116 pattern) ───────────────────────────

  // State 0: Safety Stop — with state capture
  rungs.push(
    buildRung(rungNum++, 'State 0: Safety Stop',
      `[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];`)
  );

  // State 1: Manual Mode
  rungs.push(
    buildRung(rungNum++, 'State 1: Manual Mode',
      `XIC(ManualMode)MOVE(1,Control.StateReg);`)
  );

  // State 2: Auto Idle NOT Ready (from Safety/Manual/Fault/Init)
  rungs.push(
    buildRung(rungNum++, 'State 2: Auto Idle NOT Ready',
      `[XIC(Status.State[0]) XIC(SafetyOK) XIO(ManualMode) ,XIC(Status.State[1]) XIO(ManualMode) ,XIC(Status.State[127]) XIC(FaultReset) ,XIC(Status.State[124]) ]MOVE(2,Control.StateReg);`)
  );

  // State 3: Auto Idle Ready (from 2 or cycle complete)
  rungs.push(
    buildRung(rungNum++, 'State 3: Auto Idle Ready',
      `[XIC(Status.State[2]) XIC(Initialized) ,XIC(Status.State[${completeStep}]) ]MOVE(3,Control.StateReg);`)
  );

  // State 99: Lockout (§15.5 — HMI_Toggle.0 forces Step=99 from any state).
  // Safe-state outputs (retract pneumatics, disable servos) are handled in R03.
  rungs.push(
    buildRung(rungNum++, 'State 99: Lockout (HMI_Toggle.0)',
      `XIC(HMI_Toggle.0)MOVE(99,Control.StateReg);`)
  );

  // ── Process Transitions ───────────────────────────────────────────────────

  // State 3 → first process state (with home position verify)
  if (orderedNodes.length > 0) {
    const firstStep = stepMap[orderedNodes[0].id];
    const homeConditions = buildHomeVerifyConditions(devices, allSMs, trackingFields);
    rungs.push(
      buildRung(
        rungNum++,
        `State ${firstStep}: ${getStateDescription(orderedNodes[0], devices)}`,
        `XIC(Status.State[3])XIC(CycleRunning)${homeConditions}MOVE(${firstStep},Control.StateReg);`
      )
    );
  }

  // Rungs for each transition between action states
  const edges = sm.edges ?? [];
  // Track nodes that we've already generated branching rungs for
  const branchHandled = new Set();

  for (let i = 0; i < orderedNodes.length - 1; i++) {
    const srcNode = orderedNodes[i];
    const srcStep = stepMap[srcNode.id];

    // Skip complete nodes — they just loop back to wait (handled by the Complete→Wait rung above)
    if (srcNode.data?.isComplete) continue;

    // Check if this node has a CheckResults action with 2+ outcomes → branching
    const checkAction = (srcNode.data?.actions ?? []).find(a => {
      const dev = devices.find(d => d.id === a.deviceId);
      return dev?.type === 'CheckResults' && (dev.outcomes ?? []).length >= 2;
    });

    if (checkAction) {
      branchHandled.add(srcNode.id);
      const checkDevice = devices.find(d => d.id === checkAction.deviceId);
      const outcomes = checkDevice?.outcomes ?? [];

      // Find outgoing edges from this node
      const outEdges = edges.filter(e => e.source === srcNode.id);

      for (const outEdge of outEdges) {
        const tgtNode = orderedNodes.find(n => n.id === outEdge.target);
        if (!tgtNode) continue;
        const tgtStep = stepMap[tgtNode.id];
        if (tgtStep === undefined) continue;

        const outcomeId = outEdge.data?.outcomeId;
        const outcomeLabel = outEdge.data?.outcomeLabel ?? 'branch';
        const desc = getStateDescription(tgtNode, devices);

        // Find the matching outcome to get its per-outcome param data
        const outcome = outcomes.find(o => o.id === outcomeId);

        // Resolve per-outcome branch condition — unified inputRef or legacy sourceType
        let branchCond = '';
        if (outcome?.inputRef) {
          // New unified format: inputRef = "deviceId:key" or "deviceId:cross:smId" or "_tracking:fieldId"
          const tag = resolveInputRefTag(outcome.inputRef, devices, allSMs, trackingFields);
          if (tag) {
            const isOff = outcome.condition === 'off' || outcome.condition === 'outOfRange';
            // _allPass returns "tag1 AND tag2 …" — expand to multiple XIC/XIO
            const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
            branchCond = tagList.map(t => isOff ? `XIO(${t})` : `XIC(${t})`).join('');
          }
        } else if (outcome?.sourceType === 'digitalSensor' && outcome?.sensorDeviceId) {
          // Legacy: DigitalSensor
          const sensorDev = devices.find(d => d.id === outcome.sensorDeviceId);
          if (sensorDev) branchCond = outcome.condition === 'off' ? `XIO(i_${sensorDev.name})` : `XIC(i_${sensorDev.name})`;
        } else if (outcome?.sourceType === 'analogSensor' && outcome?.sensorDeviceId) {
          // Legacy: AnalogSensor
          const sensorDev = devices.find(d => d.id === outcome.sensorDeviceId);
          if (sensorDev) {
            const rcTag = `${sensorDev.name}${outcome.setpointName ?? ''}RC.InPos`;
            branchCond = outcome.condition === 'outOfRange' ? `XIO(${rcTag})` : `XIC(${rcTag})`;
          }
        } else if (outcome?.paramDeviceId) {
          // Legacy: Parameter
          let paramDev = devices.find(d => d.id === outcome.paramDeviceId);
          const pfx = paramDev?.dataType === 'boolean' ? 'q_' : 'p_';
          let paramTag = paramDev ? `${pfx}${paramDev.name}` : '';
          if (outcome.paramScope === 'cross-sm' && outcome.crossSmId) {
            const crossSm = allSMs.find(s => s.id === outcome.crossSmId);
            if (crossSm) {
              const crossParamDev = (crossSm.devices ?? []).find(d => d.id === outcome.paramDeviceId);
              if (crossParamDev) {
                const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
                paramTag = `\\${progName}.${crossParamDev.dataType === 'boolean' ? 'q_' : 'p_'}${crossParamDev.name}`;
              }
            }
          }
          if (paramTag) branchCond = outcome.condition === 'off' ? `XIO(${paramTag})` : `XIC(${paramTag})`;
        }

        // Retry logic: if outcome has retry, generate fault-check + increment rungs
        if (outcome?.retry && checkDevice) {
          const counterTag = `${checkDevice.name}_${outcome.id}_RetryCnt`;
          const maxTag = `${checkDevice.name}_${outcome.id}_MaxRetries`;
          const faultStep = 127; // SDC standard: all faults → state 127

          // Rung 1: condition met AND counter >= max → fault
          rungs.push(
            buildRung(
              rungNum++,
              `State ${faultStep}: FAULT — ${outcomeLabel} retries exceeded`,
              `XIC(Status.State[${srcStep}])${branchCond}GEQ(${counterTag},${maxTag})MOVE(${faultStep},Control.StateReg);`
            )
          );
          // Rung 2: condition met AND counter < max → increment + go to recovery path
          rungs.push(
            buildRung(
              rungNum++,
              `State ${tgtStep}: ${desc} [${outcomeLabel}] (retry)`,
              `XIC(Status.State[${srcStep}])${branchCond}LES(${counterTag},${maxTag})[ADD(${counterTag},1,${counterTag}),MOVE(${tgtStep},Control.StateReg)];`
            )
          );
        } else {
          // No retry — collect counter resets from sibling outcomes that have retry
          let resetRungs = '';
          if (checkDevice) {
            for (const sib of outcomes) {
              if (sib.retry && sib.id !== outcome?.id) {
                const sibCounter = `${checkDevice.name}_${sib.id}_RetryCnt`;
                resetRungs += `MOVE(0,${sibCounter})`;
              }
            }
          }

          rungs.push(
            buildRung(
              rungNum++,
              `State ${tgtStep}: ${desc} [${outcomeLabel}]`,
              `XIC(Status.State[${srcStep}])${branchCond}${resetRungs}MOVE(${tgtStep},Control.StateReg);`
            )
          );
        }
      }
    } else if (srcNode.type === 'decisionNode' && srcNode.data?.exitCount === 2 && (srcNode.data?.sensorRef || (srcNode.data?.conditions ?? []).length > 0)) {
      // ── Decision node branching ──────────────────────────────────────────
      branchHandled.add(srcNode.id);
      const dData = srcNode.data;
      const dConditions = dData.conditions ?? [];
      const dLogic = dData.conditionLogic ?? 'AND';

      // Build pass-branch condition string from conditions array (or legacy single condition)
      let passCond = '';
      if (dConditions.length > 0) {
        const condParts = [];
        for (const cond of dConditions) {
          const tag = resolveInputRefTag(cond.ref, devices, allSMs, trackingFields);
          if (!tag) continue;
          const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
          for (const t of tagList) {
            condParts.push(cond.conditionType === 'off' ? `XIO(${t})` : `XIC(${t})`);
          }
        }
        if (dLogic === 'OR' && condParts.length > 1) {
          // OR = parallel branches: [cond1 ,cond2 ,cond3]
          passCond = `[${condParts.join(' ,')}]`;
        } else {
          // AND = serial chain
          passCond = condParts.join('');
        }
      } else if (dData.sensorRef) {
        // Legacy single condition
        const tag = resolveInputRefTag(dData.sensorRef, devices, allSMs, trackingFields);
        if (tag) {
          passCond = dData.conditionType === 'off' ? `XIO(${tag})` : `XIC(${tag})`;
        }
      }

      // Build fail condition (inverse of pass)
      let failCond = '';
      if (dConditions.length > 0) {
        const condParts = [];
        for (const cond of dConditions) {
          const tag = resolveInputRefTag(cond.ref, devices, allSMs, trackingFields);
          if (!tag) continue;
          const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
          for (const t of tagList) {
            // Invert: ON→XIO, OFF→XIC
            condParts.push(cond.conditionType === 'off' ? `XIC(${t})` : `XIO(${t})`);
          }
        }
        if (dLogic === 'AND' && condParts.length > 1) {
          // Inverse of AND is OR: any one failing → fail branch
          failCond = `[${condParts.join(' ,')}]`;
        } else {
          // Inverse of OR is AND: all must fail
          failCond = condParts.join('');
        }
      } else if (dData.sensorRef) {
        const tag = resolveInputRefTag(dData.sensorRef, devices, allSMs, trackingFields);
        if (tag) {
          failCond = dData.conditionType === 'off' ? `XIC(${tag})` : `XIO(${tag})`;
        }
      }

      // Find outgoing edges by sourceHandle
      const outEdges = edges.filter(e => e.source === srcNode.id);
      for (const outEdge of outEdges) {
        const tgtNode = orderedNodes.find(n => n.id === outEdge.target);
        if (!tgtNode) continue;
        const tgtStep = stepMap[tgtNode.id];
        if (tgtStep === undefined) continue;
        const desc = getStateDescription(tgtNode, devices);

        const isPass = outEdge.sourceHandle === 'exit-pass';
        const isFail = outEdge.sourceHandle === 'exit-fail';
        const cond = isPass ? passCond : isFail ? failCond : '';
        const branchLabel = isPass ? 'Pass' : isFail ? 'Fail' : outEdge.label ?? '';

        rungs.push(
          buildRung(
            rungNum++,
            `State ${tgtStep}: ${desc} [${branchLabel}]`,
            `XIC(Status.State[${srcStep}])${cond}MOVE(${tgtStep},Control.StateReg);`
          )
        );
      }
    } else {
      // Check if this node has a VisionSystem Inspect action → multi-step
      const visionSubs = getVisionSubSteps(srcNode, devices, stepMap);

      if (visionSubs) {
        // VisionSystem generates 4 internal sub-state transitions:
        //   [0] Verify Trigger Ready → [1] Wait Timer → [2] Trigger → [3] Check Results
        const visionAction = (srcNode.data?.actions ?? []).find(a => {
          const dev = devices.find(d => d.id === a.deviceId);
          return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
        });
        const visionDevice = visionAction ? devices.find(d => d.id === visionAction.deviceId) : null;

        if (visionDevice) {
          const trigReadyTag = DEVICE_TYPES.VisionSystem.tagPatterns.triggerReady.replace(/\{name\}/g, visionDevice.name);
          const trigDwellTag = DEVICE_TYPES.VisionSystem.tagPatterns.trigDwell.replace(/\{name\}/g, visionDevice.name);
          const resultReadyTag = DEVICE_TYPES.VisionSystem.tagPatterns.resultReady.replace(/\{name\}/g, visionDevice.name);

          // Sub-state [0]→[1]: Verify Trigger Ready → Wait Timer
          rungs.push(
            buildRung(
              rungNum++,
              `State ${visionSubs[1]}: ${visionDevice.displayName} - Wait Timer`,
              `XIC(Status.State[${visionSubs[0]}])XIC(${trigReadyTag})MOVE(${visionSubs[1]},Control.StateReg);`
            )
          );

          // Sub-state [1]→[2]: Wait Timer → Trigger
          rungs.push(
            buildRung(
              rungNum++,
              `State ${visionSubs[2]}: ${visionDevice.displayName} - Trigger`,
              `XIC(Status.State[${visionSubs[1]}])TON(${trigDwellTag},?,?)XIC(${trigDwellTag}.DN)MOVE(${visionSubs[2]},Control.StateReg);`
            )
          );

          // Sub-state [2]→[3]: Trigger → Check Results (wait for ResultReady)
          rungs.push(
            buildRung(
              rungNum++,
              `State ${visionSubs[3]}: ${visionDevice.displayName} - Check Results`,
              `XIC(Status.State[${visionSubs[2]}])XIC(${resultReadyTag})MOVE(${visionSubs[3]},Control.StateReg);`
            )
          );

          // Sub-state [3] → branching (if VisionInspect with outcomes) or linear (old Inspect)
          const hasOutcomes = visionAction.operation === 'VisionInspect' && visionAction.outcomes?.length >= 2;

          if (hasOutcomes) {
            // Mark as branch-handled so we don't generate a normal transition
            branchHandled.add(srcNode.id);
            const inspPassTag = DEVICE_TYPES.VisionSystem.tagPatterns.inspPass.replace(/\{name\}/g, visionDevice.name);

            // Find outgoing edges from this node for VisionInspect branching
            const outEdges = edges.filter(e => e.source === srcNode.id);

            // Branch rungs for all configured outcomes (same for snap & continuous)
            for (const outEdge of outEdges) {
              const tgtNode = orderedNodes.find(n => n.id === outEdge.target);
              if (!tgtNode) continue;
              const tgtStep = stepMap[tgtNode.id];
              if (tgtStep === undefined) continue;

              const outcomeLabel = outEdge.data?.outcomeLabel ?? 'branch';
              const outcomeIdx = outEdge.data?.outcomeIndex ?? 0;
              const desc = getStateDescription(tgtNode, devices);

              // Default 2-outcome: Pass = XIC(InspPass), Fail = XIO(InspPass)
              const isPass = outcomeIdx === 0;
              const inspCond = isPass ? `XIC(${inspPassTag})` : `XIO(${inspPassTag})`;

              rungs.push(
                buildRung(
                  rungNum++,
                  `State ${tgtStep}: ${desc} [${outcomeLabel}]`,
                  `XIC(Status.State[${visionSubs[3]}])${inspCond}MOVE(${tgtStep},Control.StateReg);`
                )
              );
            }

            if (visionAction.continuous) {
              // Continuous mode extras: non-matching → loop back, timeout → fault 127
              const searchTimeoutTag = DEVICE_TYPES.VisionSystem.tagPatterns.searchTimeout.replace(/\{name\}/g, visionDevice.name);

              // Non-matching result → loop back to sub-state [0] (re-trigger)
              // This rung catches anything not already handled by the branch rungs above
              rungs.push(
                buildRung(
                  rungNum++,
                  `${visionDevice.displayName} - Search Loop (no match → re-trigger)`,
                  `XIC(Status.State[${visionSubs[3]}])MOVE(${visionSubs[0]},Control.StateReg);`
                )
              );

              // Timeout → fault 127 (accumulates across retries from sub-state [0])
              rungs.push(
                buildRung(
                  rungNum++,
                  `${visionDevice.displayName} - Search Timeout → Fault`,
                  `XIC(Status.State[${visionSubs[0]}])TON(${searchTimeoutTag},?,?)XIC(${searchTimeoutTag}.DN)MOVE(127,Control.StateReg);`
                )
              );
            }
          } else {
            // Old-style linear: Sub-state [3]→next node
            const tgtNode = orderedNodes[i + 1];
            if (tgtNode) {
              const tgtStep = stepMap[tgtNode.id];
              const desc = getStateDescription(tgtNode, devices);
              rungs.push(
                buildRung(
                  rungNum++,
                  `State ${tgtStep}: ${desc}`,
                  `XIC(Status.State[${visionSubs[3]}])MOVE(${tgtStep},Control.StateReg);`
                )
              );
            }
          }
        }
      } else {
        // Normal linear transition
        const tgtNode = orderedNodes[i + 1];
        const tgtStep = stepMap[tgtNode.id];
        const conditions = buildVerifyConditions(srcNode, devices, allSMs, trackingFields);
        const desc = getStateDescription(tgtNode, devices);

        // Index sync gating — only on the home/initial node's first transition,
        // only on indexing machines, and only when there's no user-drawn
        // IndexComplete wait node covering it.
        let indexSyncGate = '';
        if (srcNode.data?.isInitial
            && (machineConfig?.machineType ?? 'indexing') === 'indexing'
            && !isIndexSyncOverridden(srcNode.id, sm)) {
          const mode = resolveIndexSync(srcNode, sm, machineConfig);
          if (mode === 'afterIndex') {
            indexSyncGate = 'XIC(\\Supervisor.IndexComplete)';
          } else if (mode === 'midIndex') {
            const angle = srcNode.data?.midIndexAngle;
            if (angle != null && angle > 0) {
              const stationNum = sm.stationNumber ?? 0;
              indexSyncGate = `GEQ(\\Supervisor.IndexAngle,p_MidIndexStart_S${String(stationNum).padStart(2,'0')})`;
            }
          }
          // 'independent' → no auto-wait
        }

        // Entry rule gating — only on the home/initial node's first outgoing transition
        // (and only when the next node is NOT a decision node, which would handle branching itself).
        let entryRuleGate = '';
        let entryRuleSkipRung = null;
        const tgtIsBranchingDecision = tgtNode?.type === 'decisionNode' && (tgtNode?.data?.exitCount ?? 1) === 2;
        if (srcNode.data?.isInitial && !tgtIsBranchingDecision) {
          const rule = resolveEntryRule(srcNode, sm, machineConfig);
          const mcType = machineConfig?.machineType ?? 'indexing';
          const stationNum = sm.stationNumber ?? 0;
          // Reject tag convention: dial → \Supervisor.StationStatus[n].Reject ;  inline → local q_UpstreamReject
          const rejectTag = mcType === 'indexing'
            ? `\\Supervisor.StationStatus[${stationNum}].Reject`
            : 'q_UpstreamReject';

          if (rule === 'ifGood') {
            entryRuleGate = `XIO(${rejectTag})`;
            entryRuleSkipRung = buildRung(
              rungNum,
              `Entry Rule (If Good): reject present → skip sequence → Cycle Complete`,
              `XIC(Status.State[${srcStep}])XIC(${rejectTag})MOVE(${completeStep},Control.StateReg);`
            );
          } else if (rule === 'ifReject') {
            entryRuleGate = `XIC(${rejectTag})`;
            entryRuleSkipRung = buildRung(
              rungNum,
              `Entry Rule (If Reject): no reject → skip sequence → Cycle Complete`,
              `XIC(Status.State[${srcStep}])XIO(${rejectTag})MOVE(${completeStep},Control.StateReg);`
            );
          } else if (rule === 'custom') {
            // Placeholder — user wires custom condition post-import
            entryRuleGate = `XIC(p_CustomEntryRule_S${String(stationNum).padStart(2,'0')})`;
          }
          // 'always' → no gate, no skip
        }

        if (entryRuleSkipRung) {
          rungs.push(entryRuleSkipRung);
          rungNum++;
        }

        rungs.push(
          buildRung(
            rungNum++,
            `State ${tgtStep}: ${desc}`,
            `XIC(Status.State[${srcStep}])${indexSyncGate}${entryRuleGate}${conditions}MOVE(${tgtStep},Control.StateReg);`
          )
        );
      }
    }
  }

  // Last action → Complete (only if it wasn't already handled as a branch or explicit complete node)
  // If there's an explicit complete node, edges from preceding nodes handle the transition
  if (orderedNodes.length > 0 && !explicitCompleteNode) {
    const lastNode = orderedNodes[orderedNodes.length - 1];
    const lastStep = stepMap[lastNode.id];
    const lastVisionSubs = getVisionSubSteps(lastNode, devices, stepMap);
    // For vision nodes, the "last step" is the last sub-state (index 3 = Check Results)
    const effectiveLastStep = lastVisionSubs ? lastVisionSubs[3] : lastStep;

    if (!branchHandled.has(lastNode.id)) {
      let conditions;
      if (lastVisionSubs) {
        // Vision node: sub-state [3] (Check Results) already verified result,
        // so transition to Complete is unconditional from that sub-state
        conditions = '';
      } else {
        conditions = buildVerifyConditions(lastNode, devices, allSMs, trackingFields);
      }

      rungs.push(
        buildRung(
          rungNum++,
          `State ${completeStep}: Complete`,
          `XIC(Status.State[${effectiveLastStep}])${conditions}MOVE(${completeStep},Control.StateReg);`
        )
      );
    }
  }

  // State 127: Fault — with fault state capture (placed after all process states)
  rungs.push(
    buildRung(rungNum++, 'State 127: Fault',
      `XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];`)
  );

  // ── Cycle Time Tracking ──────────────────────────────────────────────────
  // RTO accumulates while in process states (4-59), resets + computes on cycle restart
  {
    // Cycle timer runs during process states
    const processStates = orderedNodes.map(n => stepMap[n.id]).filter(s => s >= 4 && s <= 59);
    if (processStates.length > 0) {
      const stateChecks = processStates.map(s => `XIC(Status.State[${s}])`);
      const rungText = stateChecks.length === 1
        ? `${stateChecks[0]}RTO(CycleTimer,?,?);`
        : `[${stateChecks.join(' ,')}]RTO(CycleTimer,?,?);`;
      rungs.push(buildRung(rungNum++, 'Cycle Time Accumulator', rungText));
    }

    // On cycle restart (entering first process state), compute cycle time and reset
    if (orderedNodes.length > 0) {
      const firstStep = stepMap[orderedNodes[0].id];
      rungs.push(
        buildRung(rungNum++, 'Cycle Time Compute + Reset',
          `XIC(Status.State[3])XIC(CycleRunning)ONS(ONS.4)[DIV(CycleTimer.ACC,1000.0,p_CycleTime) ,MOVE(0,CycleTimer.ACC) ];`)
      );
    }
  }

  // ── Fault Timer Enabling ──────────────────────────────────────────────────
  // Enable fault detection during process states (4-59), disable during single step
  rungs.push(
    buildRung(rungNum++, 'Fault Timer Enable',
      `LIMIT(4,Control.StateReg,59)XIO(SS)[MOVE(${DEFAULT_FAULT_TIME},Control.FaultTime) ,OTE(Control.EnaFaultDetect) ];`)
  );

  // Final rung: State_Engine_128Max AOI call
  rungs.push(
    buildRung(
      rungNum++,
      'State Engine',
      'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'
    )
  );

  return `
<Routine Name="R02_StateTransitions" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── R03_StateLogic ───────────────────────────────────────────────────────────
//
// OTE branch/latch pattern per device (matches CE output):
//
// For each device "primary direction" (e.g. Extend):
//   [XIC(Status.State[SET_STATE]) ,XIC(output) XIO(Status.State[CLEAR_STATE]) ]OTE(output);
//
// Multiple SET states:
//   [[XIC(Status.State[S1]) ,XIC(Status.State[S2]) ] ,XIC(output) XIO(Status.State[C1]) XIO(Status.State[C2]) ]OTE(output);
//
// Complementary output:
//   XIO(primary_output)OTE(complement_output);

function generateR03StateLogic(sm, orderedNodes, stepMap, allSMs = [], trackingFields = []) {
  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];
  const waitStep = getWaitStep();

  // CE pattern: ONE OTE per device (primary direction only).
  // The opposing direction is always XIO(primary)OTE(opposing) — pure complement.
  //
  // Primary directions:
  //   Extend (cylinders), Engage (grippers), VacOn (vacuum)
  // Opposing (complement only):
  //   Retract, Disengage, VacOff

  const PRIMARY_OPS = new Set(['Extend', 'Engage', 'VacOn', 'VacOnEject']);

  const OPPOSING_PAIRS = {
    Extend: 'Retract',
    Retract: 'Extend',
    Engage: 'Disengage',
    Disengage: 'Engage',
    VacOn: 'VacOff',
    VacOff: 'VacOn',
    VacOnEject: 'VacOff',
  };

  // Per-device: collect setSteps (primary op) and clearSteps (opposing op)
  const deviceMap = {}; // keyed by device.id

  // Helper to ensure a device entry exists
  function ensureEntry(device) {
    if (!deviceMap[device.id]) {
      deviceMap[device.id] = {
        device,
        primaryTag: null,
        opposingTag: null,
        setSteps: [],
        clearSteps: [],
      };
    }
    return deviceMap[device.id];
  }

  // 1) Process home positions for the wait state
  //    If home = primary direction (Extend, Engage, VacOn) → waitStep is a set step
  //    If home = opposing direction (Retract, Disengage, VacOff) → waitStep is a clear step
  for (const device of devices) {
    const homeOp = device.homePosition || DEVICE_TYPES[device.type]?.defaultHomePosition;
    if (!homeOp) continue;
    if (device.type === 'Timer' || device.type === 'DigitalSensor') continue;

    const outputTag = getOutputTagForOperation(device, homeOp);
    if (!outputTag) continue;

    const entry = ensureEntry(device);

    // Custom devices: use complementPairs to determine primary/opposing
    if (device.type === 'Custom' && device.customTypeDef) {
      const pairs = device.customTypeDef.complementPairs ?? [];
      const isPrim = pairs.some(p => p.primary === homeOp);
      if (isPrim) {
        entry.setSteps.push(waitStep);
        if (!entry.primaryTag) entry.primaryTag = outputTag;
        const pair = pairs.find(p => p.primary === homeOp);
        if (pair && !entry.opposingTag) entry.opposingTag = getOutputTagForOperation(device, pair.opposing);
      } else {
        entry.clearSteps.push(waitStep);
        if (!entry.primaryTag) {
          const pair = pairs.find(p => p.opposing === homeOp);
          if (pair) {
            entry.primaryTag = getOutputTagForOperation(device, pair.primary);
            entry.opposingTag = outputTag;
          }
        }
      }
      continue;
    }

    if (PRIMARY_OPS.has(homeOp)) {
      // Home is primary direction → set during wait
      entry.setSteps.push(waitStep);
      if (!entry.primaryTag) entry.primaryTag = outputTag;
      const oppOp = OPPOSING_PAIRS[homeOp];
      if (oppOp && !entry.opposingTag) entry.opposingTag = getOutputTagForOperation(device, oppOp);
    } else {
      // Home is opposing direction → clear during wait (primary OFF)
      entry.clearSteps.push(waitStep);
      if (!entry.primaryTag) {
        const primOp = OPPOSING_PAIRS[homeOp];
        if (primOp) {
          entry.primaryTag = getOutputTagForOperation(device, primOp);
          entry.opposingTag = outputTag;
        }
      }
    }
  }

  // 2) Process action nodes
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of node.data.actions ?? []) {
      const device = devices.find((d) => d.id === action.deviceId);
      if (!device) continue;
      if (device.type === 'Timer' || device.type === 'DigitalSensor' || device.type === 'Parameter' || device.type === 'CheckResults' || device.type === 'VisionSystem') continue;

      const outputTag = getOutputTagForOperation(device, action.operation);
      if (!outputTag) continue;

      const entry = ensureEntry(device);

      // Custom devices: determine primary/opposing from customTypeDef.complementPairs
      if (device.type === 'Custom' && device.customTypeDef) {
        const pairs = device.customTypeDef.complementPairs ?? [];
        const isPrim = pairs.some(p => p.primary === action.operation);
        const isOpp  = pairs.some(p => p.opposing === action.operation);
        if (isPrim) {
          entry.setSteps.push(step);
          entry.primaryTag = outputTag;
          const pair = pairs.find(p => p.primary === action.operation);
          if (pair) entry.opposingTag = getOutputTagForOperation(device, pair.opposing);
        } else if (isOpp) {
          entry.clearSteps.push(step);
          if (!entry.primaryTag) {
            const pair = pairs.find(p => p.opposing === action.operation);
            if (pair) {
              entry.primaryTag = getOutputTagForOperation(device, pair.primary);
              entry.opposingTag = outputTag;
            }
          }
        } else {
          // No complement pair — treat as a simple OTE (primary-only)
          entry.setSteps.push(step);
          if (!entry.primaryTag) entry.primaryTag = outputTag;
        }
        continue;
      }

      if (PRIMARY_OPS.has(action.operation)) {
        // Primary operation → set step
        entry.setSteps.push(step);
        entry.primaryTag = outputTag;
        const oppOp = OPPOSING_PAIRS[action.operation];
        if (oppOp) entry.opposingTag = getOutputTagForOperation(device, oppOp);
      } else {
        // Opposing operation (Retract, Disengage, VacOff) → clear step
        entry.clearSteps.push(step);
        // If primary hasn't been set yet (opposing action before primary), derive it
        if (!entry.primaryTag) {
          const primOp = OPPOSING_PAIRS[action.operation];
          if (primOp) {
            entry.primaryTag = getOutputTagForOperation(device, primOp);
            entry.opposingTag = outputTag;
          }
        }
      }
    }
  }

  // Generate rungs: self-latching OTE with manual overlay (1116 pattern)
  // Track HMI_Button bit allocation for manual control
  let hmiButtonBit = 0;

  for (const [, entry] of Object.entries(deviceMap)) {
    const { device, primaryTag, opposingTag, setSteps, clearSteps } = entry;
    if (!primaryTag || setSteps.length === 0) continue;

    // Assign HMI button bits for this device pair
    const primaryBit = hmiButtonBit++;
    const opposingBit = opposingTag ? hmiButtonBit++ : -1;

    // Branch 1: Auto states — energize in these states
    let autoBranch;
    if (setSteps.length === 1) {
      autoBranch = `XIC(Status.State[${setSteps[0]}])`;
    } else {
      const parts = setSteps.map((s) => `XIC(Status.State[${s}])`);
      autoBranch = `[${parts.join(' ,')}]`;
    }

    // Branch 2: Manual mode + HMI button
    const manualBranch = `XIC(ManualMode) XIC(HMI_Button.${primaryBit})`;

    // Branch 3: Self-latch with manual/auto sub-branches
    // In auto: latch ON while NOT in any opposing state
    // In manual: latch ON while opposing button NOT pressed
    let latchClearAuto = `XIO(ManualMode)`;
    for (const cs of clearSteps) {
      latchClearAuto += ` XIO(Status.State[${cs}])`;
    }
    let latchClearManual = opposingBit >= 0
      ? `XIC(ManualMode) XIO(HMI_Button.${opposingBit})`
      : `XIC(ManualMode)`;
    const latchBranch = `XIC(${primaryTag}) [${latchClearAuto} ,${latchClearManual}]`;

    const rungText = `[${autoBranch} ,${manualBranch} ,${latchBranch} ]OTE(${primaryTag});`;

    rungs.push(
      buildRung(rungNum++, `${device.displayName} Control`, rungText)
    );

    // Complement: opposing = NOT primary
    if (opposingTag) {
      rungs.push(
        buildRung(rungNum++, null, `XIO(${primaryTag})OTE(${opposingTag});`)
      );
    }
  }

  // ── Parameter OTL / OTU rungs ─────────────────────────────────────────────
  // SetOn  → OTL(p_Name) when in the set state (latch ON, stays until explicitly cleared)
  // SetOff → OTU(p_Name) when in the clear state (unlatch OFF)
  // WaitOn / WaitOff are transition conditions only (no R03 rung needed)
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of node.data.actions ?? []) {
      const device = devices.find((d) => d.id === action.deviceId);
      if (!device || device.type !== 'Parameter') continue;
      const paramTag = getParameterTag(device, allSMs);
      if (action.operation === 'SetOn') {
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set ON`,
            `XIC(Status.State[${step}])OTL(${paramTag});`
          )
        );
      } else if (action.operation === 'SetOff') {
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set OFF`,
            `XIC(Status.State[${step}])OTU(${paramTag});`
          )
        );
      } else if (action.operation === 'SetValue') {
        // Numeric parameter set — use MOV instruction
        const numVal = action.setValue ?? 0;
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set Value`,
            `XIC(Status.State[${step}])MOV(${numVal},${paramTag});`
          )
        );
      }
    }
  }

  // ── Robot output rungs ────────────────────────────────────────────────
  // RunSequence: call Run_Robot_Seq AOI while in the run state (handshake
  //   drives ROUT.Command, verifies CMDEcho, tracks running→complete).
  // SetOutput:   OTE/OTU the specified PLC→Robot DI bit while in state.
  //   (R95_RobotOutputs copies ROUT → module:O1 bulk.)
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of node.data.actions ?? []) {
      const device = devices.find(d => d.id === action.deviceId);
      if (!device || device.type !== 'Robot') continue;

      if (action.operation === 'RunSequence') {
        const seqName = (action.sequenceName ?? 'Seq').replace(/[^a-zA-Z0-9_]/g, '');
        const instName = `RunSeq_${device.name}_${seqName}`;
        const rinTag = `${device.name}_RIN`;
        const seqReqTag = `${device.name}_SeqRequest`;
        const seqRunTag = `${device.name}_RunningSeq`;
        const seqNum = action.sequenceNumber ?? 0;
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Run Sequence #${seqNum} (${action.sequenceName ?? ''})`,
            `XIC(Status.State[${step}])Run_Robot_Seq(${instName},${seqNum},30,${seqRunTag},${seqReqTag},${rinTag});`
          )
        );
      } else if (action.operation === 'SetOutput') {
        const sig = (device.signals ?? []).find(s => s.id === action.signalId) ?? { name: action.signalName };
        const tag = `${device.name}_ROUT.${sig.name}`;
        const instr = action.signalValue === 'OFF' ? 'OTU' : 'OTE';
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set ${sig.name} ${action.signalValue ?? 'ON'}`,
            `XIC(Status.State[${step}])${instr}(${tag});`
          )
        );
      }
      // WaitInput is a transition-only condition (R02) — no R03 rung.
    }
  }

  // ── Part Tracking: Clear all fields at cycle start ─────────────────────
  // On rising edge of CycleRunning (entering first process state), OTU all PT fields
  // so stale pass/fail data from a previous part doesn't carry over.
  if (trackingFields.length > 0) {
    const clearOTUs = trackingFields.map(f => `OTU(PartTracking.${f.name})`).join('');
    rungs.push(
      buildRung(rungNum++, 'Part Tracking: Clear All at Cycle Start',
        `XIC(CycleRunning)ONS(ONS.5)${clearOTUs};`)
    );
  }

  // ── Part Tracking OTE / OTU rungs (table-driven) ──────────────────────
  // Rows derived from: Cycle Complete, dual-branch decision nodes, vision
  // inspect actions. Each enabled row emits writes based on its kind.
  {
    const ptRows = derivePartTrackingTable(sm, stepMap);
    for (const row of ptRows) {
      if (!row.enabled) continue;
      const ptTag = `PartTracking.${row.fieldName}`;

      if (row.kind === 'stationResult' || row.kind === 'stationComplete') {
        // Single OTE when in the Cycle Complete state (rolled-up overall outcome)
        const step = stepMap[row.setAtNodeId];
        if (step == null) continue;
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${row.fieldName} (Station Result)`,
            `XIC(Status.State[${step}])OTE(${ptTag});`
          )
        );
        continue;
      }

      if (row.kind === 'custom') {
        // Manual custom row: write at selected state, value determines latch/unlatch
        const step = stepMap[row.setAtNodeId];
        if (step == null) continue;
        const instr = row.writeValue === 'FALSE' ? 'OTU' : 'OTE';
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${row.fieldName} (Custom)`,
            `XIC(Status.State[${step}])${instr}(${ptTag});`
          )
        );
        continue;
      }

      if (row.kind === 'visionNumeric') {
        // Copy the vision numeric output into a REAL PT field. Runs during
        // the state where the inspect action sits (value is stable once the
        // job has reported a result).
        const step = stepMap[row.setAtNodeId];
        if (step == null) continue;
        const src = row._sourceTag;
        if (!src) continue;
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${row.fieldName} (Vision Numeric)`,
            `XIC(Status.State[${step}])MOV(${src},${ptTag});`
          )
        );
        continue;
      }

      if (row.kind === 'analogCheck') {
        // Record In_Range result of the range-check AOI during the state
        // where the probe check runs. OTE while in range, OTU when out.
        const step = stepMap[row.setAtNodeId];
        if (step == null) continue;
        const device = devices.find(d => d.name === row._deviceName);
        if (!device) continue;
        const rcTag = `${device.name}${row._setpointName ?? ''}RC.InPos`;
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${row.fieldName} In Range`,
            `XIC(Status.State[${step}])XIC(${rcTag})OTE(${ptTag});`
          )
        );
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${row.fieldName} Out of Range`,
            `XIC(Status.State[${step}])XIO(${rcTag})OTU(${ptTag});`
          )
        );
        continue;
      }

      if (row.kind === 'vision') {
        // Vision inspect state node: pass/fail branches connect from its exit handles
        const passEdge = (sm.edges ?? []).find(e => e.source === row.setAtNodeId && e.sourceHandle === 'exit-pass');
        const failEdge = (sm.edges ?? []).find(e => e.source === row.setAtNodeId && e.sourceHandle === 'exit-fail');
        const passStep = passEdge ? stepMap[passEdge.target] : null;
        const failStep = failEdge ? stepMap[failEdge.target] : null;
        if (passStep != null) {
          rungs.push(
            buildRung(
              rungNum++,
              `Part Tracking: ${row.fieldName} Vision Pass`,
              `XIC(Status.State[${passStep}])OTE(${ptTag});`
            )
          );
        }
        if (failStep != null) {
          rungs.push(
            buildRung(
              rungNum++,
              `Part Tracking: ${row.fieldName} Vision Fail`,
              `XIC(Status.State[${failStep}])OTU(${ptTag});`
            )
          );
        }
        continue;
      }
    }
  }

  // ── ServoAxis motion commands (engineer's 3-rung pattern per axis) ───────
  // Per reference S01_SDCServoPNP, servo motion lives entirely in R03 — no
  // separate R04 routine. Three rungs per axis: Position Select / MAM / Monitor.
  {
    const servoMoveMap = {}; // deviceId -> { device, moves: [{ step, positionName, operation }] }

    for (const node of orderedNodes) {
      const step = stepMap[node.id];
      for (const action of node.data.actions ?? []) {
        const device = devices.find(d => d.id === action.deviceId);
        if (!device || device.type !== 'ServoAxis') continue;
        if (action.operation !== 'ServoMove' && action.operation !== 'ServoIncr' && action.operation !== 'ServoIndex') continue;

        if (!servoMoveMap[device.id]) {
          servoMoveMap[device.id] = { device, moves: [] };
        }
        servoMoveMap[device.id].moves.push({ step, positionName: action.positionName ?? '', operation: action.operation });
      }
    }

    for (const [, entry] of Object.entries(servoMoveMap)) {
      const { device, moves } = entry;
      const sp = DEVICE_TYPES.ServoAxis.tagPatterns;
      const axNum = String(device.axisNumber ?? 1).padStart(2, '0');
      const axisTag = sp.axisTag.replace(/\{name\}/g, device.name).replace(/\{axisNum\}/g, axNum);
      const mamTag = sp.mamAutoInst.replace(/\{name\}/g, device.name).replace(/\{axisNum\}/g, axNum);
      const motionParamTag = sp.motionParamsTag.replace(/\{name\}/g, device.name).replace(/\{Name\}/g, device.name).replace(/\{axisNum\}/g, axNum);

      // Rung A: Position Selection — conditional MOVE of target position per state
      if (moves.length > 0) {
        const moveBranches = moves.map(m => {
          if (m.operation === 'ServoIncr') {
            const incrTag = sp.incrementParam.replace(/\{name\}/g, device.name);
            return `XIC(Status.State[${m.step}]) [MOVE(${incrTag},${motionParamTag}.Position) ,MOVE(1,${motionParamTag}.MoveType) ]`;
          } else if (m.operation === 'ServoIndex') {
            const indexTag = sp.indexAngleParam.replace(/\{name\}/g, device.name);
            return `XIC(Status.State[${m.step}]) [MOVE(${indexTag},${motionParamTag}.Position) ,MOVE(1,${motionParamTag}.MoveType) ]`;
          } else {
            const posTag = sp.positionParam
              .replace(/\{name\}/g, device.name)
              .replace(/\{positionName\}/g, m.positionName);
            return `XIC(Status.State[${m.step}]) [MOVE(${posTag},${motionParamTag}.Position) ,MOVE(0,${motionParamTag}.MoveType) ]`;
          }
        });
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Position Selection`,
            `[${moveBranches.join(' ,')} ];`
          )
        );
      }

      // Rung B: MAM Execute — triggers on any servo move state for this axis
      if (moves.length > 0) {
        const triggerParts = moves.map(m => `XIC(Status.State[${m.step}])`);
        const triggerText = triggerParts.length === 1
          ? triggerParts[0]
          : `[${triggerParts.join(' ,')}]`;

        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Motion Command`,
            `${triggerText}MAM(${axisTag},${mamTag},${motionParamTag}.MoveType,${motionParamTag}.Position,${motionParamTag}.Speed,Units per sec,${motionParamTag}.Accel,Units per sec2,${motionParamTag}.Decel,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);`
          )
        );
      }

      // Rung C: Range Checks — AOI_RangeCheck per position (continuous monitoring)
      const positions = device.positions ?? [];
      if (positions.length > 0) {
        const rcBranches = positions.map(pos => {
          const rcTag = sp.positionRC
            .replace(/\{name\}/g, device.name)
            .replace(/\{positionName\}/g, pos.name);
          const posTag = sp.positionParam
            .replace(/\{name\}/g, device.name)
            .replace(/\{positionName\}/g, pos.name);
          return `AOI_RangeCheck(${rcTag},${posTag},0.5,${axisTag}.ActualPosition,5.0)`;
        });
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Position Monitoring`,
            `[${rcBranches.join(' ,')} ];`
          )
        );
      }
    }
  }

  // ── Analog Sensor AOI_RangeCheck continuous monitoring ────────────────────
  {
    const analogSensors = devices.filter(d => d.type === 'AnalogSensor');
    for (const device of analogSensors) {
      const setpoints = device.setpoints ?? [];
      if (setpoints.length === 0) continue;

      const ap = DEVICE_TYPES.AnalogSensor.tagPatterns;
      const inputTag = ap.inputTag.replace(/\{name\}/g, device.name);

      const rcBranches = setpoints.map(sp => {
        const rcTag = ap.rangeCheckInst
          .replace(/\{name\}/g, device.name)
          .replace(/\{setpointName\}/g, sp.name);
        const spTag = ap.setpointParam
          .replace(/\{name\}/g, device.name)
          .replace(/\{setpointName\}/g, sp.name);
        return `AOI_RangeCheck(${rcTag},${spTag},${device.tolerance ?? 0.5},${inputTag},5.0)`;
      });
      rungs.push(
        buildRung(
          rungNum++,
          `${device.displayName} Range Monitoring`,
          `[${rcBranches.join(' ,')} ];`
        )
      );
    }
  }

  // ── VisionSystem trigger output OTE ──────────────────────────────────────
  // Energize camera trigger only during the trigger sub-state
  for (const node of orderedNodes) {
    for (const action of node.data.actions ?? []) {
      const device = devices.find((d) => d.id === action.deviceId);
      if (!device || device.type !== 'VisionSystem') continue;
      if (action.operation !== 'Inspect' && action.operation !== 'VisionInspect') continue;

      const visionSubs = getVisionSubSteps(node, devices, stepMap);
      if (!visionSubs) continue;

      const triggerTag = DEVICE_TYPES.VisionSystem.tagPatterns.trigger.replace(/\{name\}/g, device.name);

      // Trigger fires during sub-state [2] (Trigger)
      rungs.push(
        buildRung(
          rungNum++,
          `${device.displayName} Camera Trigger`,
          `XIC(Status.State[${visionSubs[2]}])OTE(${triggerTag});`
        )
      );
    }
  }

  // ── Vision Result Parameter OTL / OTU ────────────────────────────────────
  // Auto-created vision outcome parameters (Pass/Fail) are latched/unlatched
  // at the check-results sub-state based on the inspection result.
  for (const node of orderedNodes) {
    for (const action of node.data.actions ?? []) {
      const device = devices.find(d => d.id === action.deviceId);
      if (!device || device.type !== 'VisionSystem') continue;
      if (action.operation !== 'VisionInspect') continue;
      if (!action.outcomes || action.outcomes.length < 2) continue;

      const visionSubs = getVisionSubSteps(node, devices, stepMap);
      if (!visionSubs) continue;

      const inspPassTag = DEVICE_TYPES.VisionSystem.tagPatterns.inspPass.replace(/\{name\}/g, device.name);

      // Find auto-vision Parameter devices for each outcome (match by stable label, not ephemeral id)
      const outcomeParams = action.outcomes.map(outcome => {
        const paramDev = devices.find(d =>
          d._autoVision && d._visionDeviceId === device.id &&
          d._visionJobName === action.jobName && d._outcomeLabel === outcome.label
        );
        if (!paramDev) return null;
        const paramTag = getParameterTag(paramDev, allSMs);
        return { outcome, paramDev, paramTag };
      }).filter(Boolean);

      if (outcomeParams.length === 0) continue;

      // For default 2-outcome (Pass/Fail): Pass = XIC(InspPass), Fail = XIO(InspPass)
      for (let oi = 0; oi < outcomeParams.length; oi++) {
        const { outcome, paramDev, paramTag } = outcomeParams[oi];
        const isPass = oi === 0;
        const inspCond = isPass ? `XIC(${inspPassTag})` : `XIO(${inspPassTag})`;

        // OTL this outcome's parameter
        rungs.push(
          buildRung(
            rungNum++,
            `${paramDev.displayName} — Latch`,
            `XIC(Status.State[${visionSubs[3]}])${inspCond}OTL(${paramTag});`
          )
        );

        // OTU all other outcome parameters (mutually exclusive)
        for (let oj = 0; oj < outcomeParams.length; oj++) {
          if (oj === oi) continue;
          rungs.push(
            buildRung(
              rungNum++,
              `${outcomeParams[oj].paramDev.displayName} — Unlatch`,
              `XIC(Status.State[${visionSubs[3]}])${inspCond}OTU(${outcomeParams[oj].paramTag});`
            )
          );
        }
      }
    }
  }

  // ── SM Output OTE rungs ──────────────────────────────────────────────────
  // Each SM Output is TRUE only while the SM is in the specified state (OTE pattern).
  // Tag: q_OutputName  (q_ = output parameter, non-latching)
  // Rung: XIC(Status.State[N]) OTE(q_OutputName);
  for (const smOut of sm.smOutputs ?? []) {
    if (!smOut.name || !smOut.activeNodeId) continue;
    const step = stepMap[smOut.activeNodeId];
    if (step == null) continue;
    const tag = `q_${smOut.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
    rungs.push(
      buildRung(
        rungNum++,
        smOut.description ? `SM Output: ${smOut.name} — ${smOut.description}` : `SM Output: ${smOut.name}`,
        `XIC(Status.State[${step}])OTE(${tag});`
      )
    );
  }

  // ── Standard boilerplate outputs (1116 pattern) ────────────────────────
  // q_StartOK: station is at home and ready to start a cycle
  rungs.push(
    buildRung(rungNum++, 'Station Start OK',
      `[XIC(Status.State[${waitStep}]) ,XIC(Status.State[2]) ,XIC(Status.State[3]) ]XIO(q_AlarmActive)OTE(q_StartOK);`)
  );

  // q_AutoMode: station is in idle states and not running
  rungs.push(
    buildRung(rungNum++, 'Auto Mode Status',
      `[XIC(Status.State[2]) ,XIC(Status.State[3]) ]XIO(CycleRunning)OTE(q_AutoMode);`)
  );

  // q_AutoStopped: station is in idle or fault state and not running
  rungs.push(
    buildRung(rungNum++, 'Auto Stopped Status',
      `[XIC(Status.State[2]) ,XIC(Status.State[3]) ,XIC(Status.State[127]) ]XIO(CycleRunning)OTE(q_AutoStopped);`)
  );

  return `
<Routine Name="R03_StateLogic" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── R20_Alarms ──────────────────────────────────────────────────────────────
//
// 1116 pattern: AlarmData[] array + ProgramAlarmHandler AOI
// Each alarm: [fault_condition TON(Timer[n]) XIC(Timer[n].DN) ,XIC(Alarm[n].Active) XIO(FaultReset)]OTE(Alarm[n].Active);
// Final rung: ProgramAlarmHandler AOI call

function generateR20Alarms(sm, orderedNodes, stepMap) {
  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];

  // Auto-generate alarms for devices that have sensor verify actions
  // Each verify action that could timeout gets an alarm slot
  let alarmIdx = 0;
  const alarmEntries = [];

  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of (node.data?.actions ?? [])) {
      const device = devices.find(d => d.id === action.deviceId);
      if (!device) continue;

      // Determine if this action has a verify condition that could fault
      let faultCondition = null;
      let alarmDesc = null;

      switch (device.type) {
        case 'PneumaticLinearActuator':
        case 'PneumaticRotaryActuator':
          if (action.operation === 'Extend' || action.operation === 'Retract') {
            faultCondition = `XIC(Status.State[${step}])`;
            alarmDesc = `${device.displayName} ${action.operation} Timeout`;
          }
          break;
        case 'PneumaticGripper':
          if (action.operation === 'Engage' || action.operation === 'Disengage') {
            faultCondition = `XIC(Status.State[${step}])`;
            alarmDesc = `${device.displayName} ${action.operation} Timeout`;
          }
          break;
        case 'PneumaticVacGenerator':
          if (action.operation === 'VacOn' || action.operation === 'VacOnEject') {
            faultCondition = `XIC(Status.State[${step}])`;
            alarmDesc = `${device.displayName} Vacuum Timeout`;
          }
          break;
        case 'ServoAxis':
          if (action.operation === 'ServoMove' || action.operation === 'ServoIncr' || action.operation === 'ServoIndex') {
            faultCondition = `XIC(Status.State[${step}])`;
            alarmDesc = `${device.displayName} Motion Timeout`;
          }
          break;
        case 'Custom': {
          const cDef = device.customTypeDef;
          if (cDef) {
            const op = (cDef.operations ?? []).find(o => o.label === action.operation);
            if (op?.inputToVerify) {
              faultCondition = `XIC(Status.State[${step}])`;
              alarmDesc = `${device.displayName} ${action.operation} Timeout`;
            }
          }
          break;
        }
      }

      if (faultCondition && alarmDesc && alarmIdx < 10) {
        alarmEntries.push({ faultCondition, alarmDesc, idx: alarmIdx });
        alarmIdx++;
      }
    }
  }

  if (alarmEntries.length === 0) {
    // No alarms — just add NOP and the handler call
    rungs.push(buildRung(rungNum++, 'No fault conditions defined', 'NOP();'));
  } else {
    // Generate alarm rungs
    for (const entry of alarmEntries) {
      rungs.push(
        buildRung(rungNum++, entry.alarmDesc,
          `[${entry.faultCondition}TON(SensorTimer[${entry.idx}],?,?)XIC(SensorTimer[${entry.idx}].DN) ,XIC(Alarm[${entry.idx}].Active) XIO(FaultReset) ]OTE(Alarm[${entry.idx}].Active);`)
      );
    }
  }

  // Final rung: ProgramAlarmHandler AOI call
  rungs.push(
    buildRung(rungNum++, 'Program Alarm Handler',
      'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);')
  );

  return `
<Routine Name="R20_Alarms" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── Fanuc Robot UDT Generation ───────────────────────────────────────────────
//
// Generates FanucRobotRIN_{name} and FanucRobotROUT_{name} UDTs per robot device.
// Standard signals (UOP, system config DO200+, AAMAIN handshake) are always included.
// Project-specific DI/DO signals come from user-configured robot signals.

function bitMember(name, desc, target, bit) {
  return `<Member Name="${escapeXml(name)}" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="${target}" BitNumber="${bit}" ExternalAccess="Read/Write">
<Description>${cdata(desc)}</Description>
</Member>`;
}

function sintMember(name, hidden = true) {
  return `<Member Name="${name}" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="${hidden}" ExternalAccess="Read/Write"/>`;
}

function sintMemberWithDesc(name, desc) {
  return `<Member Name="${name}" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>${cdata(desc)}</Description>
</Member>`;
}

function generateFanucRobotUDTs(robotDevices) {
  let udts = '';

  for (const robot of robotDevices) {
    const rName = robot.name;
    const signals = robot.signals ?? [];

    // Separate user signals by direction and group
    const userDO = signals.filter(s => s.direction === 'input' && (s.group === 'DO' || !s.group)); // Robot→PLC
    const userDI = signals.filter(s => s.direction === 'output' && s.group === 'DI'); // PLC→Robot
    const userRegsIn = signals.filter(s => s.direction === 'input' && s.group === 'Register');
    const userRegsOut = signals.filter(s => s.direction === 'output' && s.group === 'Register');

    // ── RIN UDT (Robot → PLC) ─────────────────────────────────────────────
    const rinMembers = [];
    let rinSintIdx = 0;

    // Byte 0: UOP outputs UO1-UO8
    const rinS0 = `ZZZZZZZZZZRIN_${rinSintIdx}`;
    rinMembers.push(sintMember(rinS0));
    const uoNames = ['CMDENBL','SYSRDY','Running','Paused','HoldActive','Faulted','AtPerch','TPEnabled'];
    const uoDescs = ['UO1 Command Enable','UO2 System Ready','UO3 Program Running','UO4 Program Paused','UO5 Hold Active','UO6 Robot Faulted','UO7 At Perch','UO8 Teach Pendant Enabled'];
    for (let i = 0; i < 8; i++) rinMembers.push(bitMember(uoNames[i], uoDescs[i], rinS0, i));
    rinSintIdx++;

    // Byte 1: UO9-10, PNS echo SNO1-6
    const rinS1 = `ZZZZZZZZZZRIN_${rinSintIdx}`;
    rinMembers.push(sintMember(rinS1));
    rinMembers.push(bitMember('BatteryLow', 'UO9 Battery Low', rinS1, 0));
    rinMembers.push(bitMember('Busy', 'UO10 Busy', rinS1, 1));
    for (let i = 0; i < 6; i++) rinMembers.push(bitMember(`SNO${i+1}`, `SNO${i+1} PNS Echo`, rinS1, i + 2));
    rinSintIdx++;

    // Byte 2: SNO7-8, PNSAck, then system DO200-204
    const rinS2 = `ZZZZZZZZZZRIN_${rinSintIdx}`;
    rinMembers.push(sintMember(rinS2));
    rinMembers.push(bitMember('SNO7', 'SNO7 PNS Echo', rinS2, 0));
    rinMembers.push(bitMember('SNO8', 'SNO8 PNS Echo', rinS2, 1));
    rinMembers.push(bitMember('PNSAck', 'PNS Acknowledge', rinS2, 2));
    rinMembers.push(bitMember('AutoMode', 'DO200 Auto Mode', rinS2, 3));
    rinMembers.push(bitMember('ManualModeT1', 'DO201 Manual T1', rinS2, 4));
    rinMembers.push(bitMember('ManualModeT2', 'DO202 Manual T2', rinS2, 5));
    rinMembers.push(bitMember('EStopActive', 'DO203 E-Stop Active', rinS2, 6));
    rinMembers.push(bitMember('InputSimulated', 'DO204 Input Simulated', rinS2, 7));
    rinSintIdx++;

    // Byte 3: DO205-212 (OutputSimulated, Override100, ColGuard, Collision, AtRefPosn1-4)
    const rinS3 = `ZZZZZZZZZZRIN_${rinSintIdx}`;
    rinMembers.push(sintMember(rinS3));
    rinMembers.push(bitMember('OutputSimulated', 'DO205 Output Simulated', rinS3, 0));
    rinMembers.push(bitMember('Override100', 'DO206 Override at 100%', rinS3, 1));
    rinMembers.push(bitMember('ColGuardEnabled', 'DO207 Collision Guard Enabled', rinS3, 2));
    rinMembers.push(bitMember('CollisionDetected', 'DO208 Collision Detected', rinS3, 3));
    for (let i = 0; i < 4; i++) rinMembers.push(bitMember(`AtRefPosn${i+1}`, `DO${209+i} At Reference Position ${i+1}`, rinS3, 4 + i));
    rinSintIdx++;

    // Byte 4: AtRefPosn5-10, SingleChannelFault, HeartBeat
    const rinS4 = `ZZZZZZZZZZRIN_${rinSintIdx}`;
    rinMembers.push(sintMember(rinS4));
    for (let i = 4; i < 10; i++) rinMembers.push(bitMember(`AtRefPosn${i+1}`, `DO${209+i} At Reference Position ${i+1}`, rinS4, i - 4));
    rinMembers.push(bitMember('SingleChannelFault', 'DO219 Safety Single Channel Fault', rinS4, 6));
    rinMembers.push(bitMember('HeartBeat', 'DO220 Heartbeat', rinS4, 7));
    rinSintIdx++;

    // Byte 5: SoftHeartBeat, SingleStep, AppFault, AAMAIN status (CMDComplete..ReqPLCResetCMD)
    const rinS5 = `ZZZZZZZZZZRIN_${rinSintIdx}`;
    rinMembers.push(sintMember(rinS5));
    rinMembers.push(bitMember('SoftHeartBeat', 'DO221 Soft Heartbeat', rinS5, 0));
    rinMembers.push(bitMember('SingleStep', 'DO222 Single Step', rinS5, 1));
    rinMembers.push(bitMember('AppFault', 'DO223 Application Fault', rinS5, 2));
    rinMembers.push(bitMember('CMDComplete', 'DO224 Command Complete', rinS5, 3));
    rinMembers.push(bitMember('CMDRunning', 'DO225 Command Running', rinS5, 4));
    rinMembers.push(bitMember('CMDFailed', 'DO226 Command Failed', rinS5, 5));
    rinMembers.push(bitMember('WaitingForCMD', 'DO227 Waiting for Command', rinS5, 6));
    rinMembers.push(bitMember('ReqPLCResetCMD', 'DO228 Request PLC Reset CMD', rinS5, 7));
    rinSintIdx++;

    // Group outputs (SINT registers)
    rinMembers.push(sintMemberWithDesc('CMDEcho', 'GO3 AAMAIN Command Echo'));
    rinMembers.push(sintMemberWithDesc('AppFaultCode', 'GO2 Application Fault Code'));

    // User-configured DO signals (Robot→PLC, project-specific)
    if (userDO.length > 0) {
      // Pack user DO into SINT bytes, 8 bits each
      const doBytes = Math.ceil(userDO.length / 8);
      for (let bi = 0; bi < doBytes; bi++) {
        const backName = `ZZZZZZZZZZRIN_DO_${bi}`;
        rinMembers.push(sintMember(backName));
        for (let bj = 0; bj < 8; bj++) {
          const sigIdx = bi * 8 + bj;
          if (sigIdx >= userDO.length) break;
          const sig = userDO[sigIdx];
          rinMembers.push(bitMember(sig.name, `DO[${sig.number ?? sigIdx+1}] ${sig.name}`, backName, bj));
        }
      }
    }

    // User-configured input registers (Robot→PLC, DINT/REAL)
    for (const reg of userRegsIn) {
      const dt = reg.dataType === 'REAL' ? 'REAL' : 'DINT';
      const radix = dt === 'REAL' ? 'Float' : 'Decimal';
      rinMembers.push(`<Member Name="${escapeXml(reg.name)}" DataType="${dt}" Dimension="0" Radix="${radix}" Hidden="false" ExternalAccess="Read/Write">
<Description>${cdata(`R[${reg.number ?? 0}] ${reg.name}`)}</Description>
</Member>`);
    }

    udts += `
<DataType Name="FanucRobotRIN_${rName}" Family="NoFamily" Class="User">
<Description>${cdata(`${robot.displayName} - Robot Inputs (Robot to PLC)`)}</Description>
<Members>
${rinMembers.join('\n')}
</Members>
</DataType>`;

    // ── ROUT UDT (PLC → Robot) ────────────────────────────────────────────
    const routMembers = [];
    let routSintIdx = 0;

    // Byte 0: UOP inputs UI1-UI8
    const routS0 = `ZZZZZZZZZZROUT_${routSintIdx}`;
    routMembers.push(sintMember(routS0));
    const uiNames = ['ImmediateStop','Hold','SafeSpeed','CycleStop','FaultReset','Start','Home','Enable'];
    const uiDescs = ['UI1 Immediate Stop (NC)','UI2 Hold (NC)','UI3 Safe Speed (NC)','UI4 Cycle Stop','UI5 Fault Reset','UI6 Start','UI7 Home','UI8 Enable'];
    for (let i = 0; i < 8; i++) routMembers.push(bitMember(uiNames[i], uiDescs[i], routS0, i));
    routSintIdx++;

    // Byte 1: PNS1-8
    const routS1 = `ZZZZZZZZZZROUT_${routSintIdx}`;
    routMembers.push(sintMember(routS1));
    for (let i = 0; i < 8; i++) routMembers.push(bitMember(`PNS${i+1}`, `PNS${i+1} Program Select`, routS1, i));
    routSintIdx++;

    // Byte 2: PNSStrobe, ProductionStart, + reserved
    const routS2 = `ZZZZZZZZZZROUT_${routSintIdx}`;
    routMembers.push(sintMember(routS2));
    routMembers.push(bitMember('PNSStrobe', 'PNS Strobe', routS2, 0));
    routMembers.push(bitMember('ProductionStart', 'UI18 Production Start', routS2, 1));
    routMembers.push(bitMember('PLCAuto', 'PLC in Auto Mode', routS2, 2));
    routMembers.push(bitMember('PLCRunning', 'PLC Cycle Running', routS2, 3));
    routSintIdx++;

    // Group input: Command (SINT)
    routMembers.push(sintMemberWithDesc('Command', 'GI2 AAMAIN Command Number'));

    // User-configured DI signals (PLC→Robot, project-specific)
    if (userDI.length > 0) {
      const diBytes = Math.ceil(userDI.length / 8);
      for (let bi = 0; bi < diBytes; bi++) {
        const backName = `ZZZZZZZZZZROUT_DI_${bi}`;
        routMembers.push(sintMember(backName));
        for (let bj = 0; bj < 8; bj++) {
          const sigIdx = bi * 8 + bj;
          if (sigIdx >= userDI.length) break;
          const sig = userDI[sigIdx];
          routMembers.push(bitMember(sig.name, `DI[${sig.number ?? sigIdx+1}] ${sig.name}`, backName, bj));
        }
      }
    }

    // User-configured output registers (PLC→Robot, DINT/REAL)
    for (const reg of userRegsOut) {
      const dt = reg.dataType === 'REAL' ? 'REAL' : 'DINT';
      const radix = dt === 'REAL' ? 'Float' : 'Decimal';
      routMembers.push(`<Member Name="${escapeXml(reg.name)}" DataType="${dt}" Dimension="0" Radix="${radix}" Hidden="false" ExternalAccess="Read/Write">
<Description>${cdata(`R[${reg.number ?? 0}] ${reg.name}`)}</Description>
</Member>`);
    }

    udts += `
<DataType Name="FanucRobotROUT_${rName}" Family="NoFamily" Class="User">
<Description>${cdata(`${robot.displayName} - Robot Outputs (PLC to Robot)`)}</Description>
<Members>
${routMembers.join('\n')}
</Members>
</DataType>`;
  }

  return udts;
}

// ── UDT Definitions ──────────────────────────────────────────────────────────

export function generateDataTypes(hasServos = false, trackingFields = [], robotDevices = []) {
  let servoUDT = '';
  if (hasServos) {
    // SDC Guide §15.4: ServoOverall UDT set emitted together whenever any servo is present.
    // Verbatim structural copy from the SDC standard library. Members are fixed-size arrays
    // (Positions[12], AutoSpeed[5], Accel/Decel[2]) so per-axis code can reference them by
    // stable index (§15.3). MAMParam is retained for per-MAM scratch use by R03/R04 logic.
    servoUDT = `
<DataType Name="MAMParam" Family="NoFamily" Class="User">
<Members>
<Member Name="MoveType" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Position" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Speed" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Accel" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Decel" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>
<DataType Name="ServoMomentary" Family="NoFamily" Class="User">
<Members>
<Member Name="ZZZZZZZZZZServoMomen0" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="Enable" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="0" ExternalAccess="Read/Write"/>
<Member Name="Disable" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="1" ExternalAccess="Read/Write"/>
<Member Name="JogPositive" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="2" ExternalAccess="Read/Write"/>
<Member Name="JogNegative" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="3" ExternalAccess="Read/Write"/>
<Member Name="InchPositive" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="4" ExternalAccess="Read/Write"/>
<Member Name="InchNegative" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="5" ExternalAccess="Read/Write"/>
<Member Name="HomeRequest" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="6" ExternalAccess="Read/Write"/>
<Member Name="HomeConfirm" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen0" BitNumber="7" ExternalAccess="Read/Write"/>
<Member Name="ZZZZZZZZZZServoMomen9" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="SetTorquePos" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen9" BitNumber="0" ExternalAccess="Read/Write"/>
<Member Name="SetTorqueNeg" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoMomen9" BitNumber="1" ExternalAccess="Read/Write"/>
<Member Name="ManMoves" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>
<DataType Name="ServoParameters" Family="NoFamily" Class="User">
<Members>
<Member Name="Accel" DataType="REAL" Dimension="2" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Decel" DataType="REAL" Dimension="2" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="JogSpeed" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="ManualSpeed" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="AutoSpeed" DataType="REAL" Dimension="5" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="InchAmount" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Positions" DataType="REAL" Dimension="12" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="TorquePos" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="TorqueNeg" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>
<DataType Name="ServoStatus" Family="NoFamily" Class="User">
<Members>
<Member Name="ZZZZZZZZZZServoStatu0" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="HomeRequested" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoStatu0" BitNumber="0" ExternalAccess="Read/Write"/>
<Member Name="HomeInProcess" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoStatu0" BitNumber="1" ExternalAccess="Read/Write"/>
<Member Name="HomeComplete" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZServoStatu0" BitNumber="2" ExternalAccess="Read/Write"/>
<Member Name="ActualTorque" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="ActualVelocity" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="ActualPosition" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="MaxVelocity" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="MaxAccel" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="MaxDecel" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>
<DataType Name="ServoOverall" Family="NoFamily" Class="User">
<Members>
<Member Name="Status" DataType="ServoStatus" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Control" DataType="ServoMomentary" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Parameters" DataType="ServoParameters" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
<Dependencies>
<Dependency Type="DataType" Name="ServoStatus"/>
<Dependency Type="DataType" Name="ServoMomentary"/>
<Dependency Type="DataType" Name="ServoParameters"/>
</Dependencies>
</DataType>`;
  }

  let partTrackingUDT = '';
  if (trackingFields.length > 0) {
    // Split fields: BOOLs get bit-packed into hidden SINTs; REALs emitted as
    // full members so numeric vision / probe outputs can be read downstream.
    const boolFields = trackingFields.filter(f => (f.dataType ?? 'boolean') === 'boolean');
    const realFields = trackingFields.filter(f => f.dataType === 'real');

    const hiddenMembers = [];
    const sintCount = Math.ceil(boolFields.length / 8);
    for (let si = 0; si < sintCount; si++) {
      hiddenMembers.push(
        `<Member Name="ZZZZZZZZZZPartTrack${si}" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>`
      );
    }
    const boolMembers = boolFields.map((f, i) => {
      const sintIdx = Math.floor(i / 8);
      const bitNum = i % 8;
      return `<Member Name="${escapeXml(f.name)}" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZPartTrack${sintIdx}" BitNumber="${bitNum}" ExternalAccess="Read/Write">
<Description>
${cdata(f.description || `Part Tracking: ${f.name}`)}
</Description>
</Member>`;
    });
    const realMembers = realFields.map(f => {
      const unitSuffix = f.unit ? ` (${f.unit})` : '';
      return `<Member Name="${escapeXml(f.name)}" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata((f.description || `Part Tracking: ${f.name}`) + unitSuffix)}
</Description>
</Member>`;
    });
    partTrackingUDT = `
<DataType Name="PartTracking_UDT" Family="NoFamily" Class="User">
<Members>
${hiddenMembers.join('\n')}
${boolMembers.join('\n')}
${realMembers.join('\n')}
</Members>
</DataType>`;
  }

  // ── Fanuc Robot UDTs (per robot device) ──────────────────────────────────
  let robotUDTs = '';
  if (robotDevices.length > 0) {
    robotUDTs = generateFanucRobotUDTs(robotDevices);
  }

  // ── CPU_TimeDate UDT (required by ProgramAlarmHandler AOI) ────────────────
  const cpuTimeDateUDT = `
<DataType Name="CPU_TimeDate" Family="NoFamily" Class="User">
<Description>
${cdata('CPU Time And Date Array')}
</Description>
<Members>
<Member Name="Year" DataType="INT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Month" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Day" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Hour" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Minutes" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Seconds" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Milliseconds" DataType="INT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Microseconds" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="UTCMicroseconds" DataType="LINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>`;

  // ── StationStatus UDT (required by Supervisor on indexing/dial machines) ──
  const stationStatusUDT = `
<DataType Name="StationStatus" Family="NoFamily" Class="User">
<Members>
<Member Name="ZZZZZZZZZZStationSta0" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="PartPresent" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZStationSta0" BitNumber="0" ExternalAccess="Read/Write">
<Description>
${cdata('Part present at this station')}
</Description>
</Member>
<Member Name="Reject" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZStationSta0" BitNumber="1" ExternalAccess="Read/Write">
<Description>
${cdata('Part marked reject - station skips processing')}
</Description>
</Member>
<Member Name="Complete" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZStationSta0" BitNumber="2" ExternalAccess="Read/Write">
<Description>
${cdata('Station processing complete for this part')}
</Description>
</Member>
<Member Name="HeadNumber" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Head/nest number currently at this station position')}
</Description>
</Member>
</Members>
</DataType>`;

  return `
<DataTypes Use="Context">${cpuTimeDateUDT}${stationStatusUDT}${servoUDT}${partTrackingUDT}${robotUDTs}
<DataType Name="StateLogicControl" Family="NoFamily" Class="User">
<Members>
<Member Name="StateReg" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Register')}
</Description>
</Member>
<Member Name="ZZZZZZZZZZState_Logi1" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="EnaFaultDetect" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi1" BitNumber="0" ExternalAccess="Read/Write">
<Description>
${cdata('Enable Fault Detection')}
</Description>
</Member>
<Member Name="EnaTransitionTimer" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi1" BitNumber="1" ExternalAccess="Read/Write">
<Description>
${cdata('Enable State Transition Timer')}
</Description>
</Member>
<Member Name="FaultTime" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Timeout Fault Time (Msec)')}
</Description>
</Member>
<Member Name="TransitionTime" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Transition preset time (ms)')}
</Description>
</Member>
</Members>
</DataType>
<DataType Name="StateLogicStatus" Family="NoFamily" Class="User">
<Members>
<Member Name="State" DataType="BOOL" Dimension="128" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Control Bits')}
</Description>
</Member>
<Member Name="PreviousState" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Previous State')}
</Description>
</Member>
<Member Name="ZZZZZZZZZZState_Logi2" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="StateChangeOccurred_OS" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi2" BitNumber="0" ExternalAccess="Read/Write">
<Description>
${cdata('State Change Occurred')}
</Description>
</Member>
<Member Name="TimeoutFlt" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi2" BitNumber="1" ExternalAccess="Read/Write">
<Description>
${cdata('State Timeout Fault')}
</Description>
</Member>
<Member Name="TransitionTimerDone" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi2" BitNumber="2" ExternalAccess="Read/Write">
<Description>
${cdata('State Transition Time Done')}
</Description>
</Member>
</Members>
</DataType>
<DataType Name="STRING100" Family="StringFamily" Class="User">
<Members>
<Member Name="LEN" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="DATA" DataType="SINT" Dimension="100" Radix="ASCII" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>
<DataType Name="AlarmData" Family="NoFamily" Class="User">
<Members>
<Member Name="ProgramID" DataType="INT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Unique ID given to each AOI instance.')}
</Description>
</Member>
<Member Name="AlarmID" DataType="INT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Index number of the alarm taken from the array attached to the AOI.')}
</Description>
</Member>
<Member Name="Severity" DataType="INT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Fault = 0, Warning = 1')}
</Description>
</Member>
<Member Name="Group" DataType="INT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Alarm group number. 0 -31')}
</Description>
</Member>
<Member Name="Message" DataType="STRING100" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Message Description (Default Language)')}
</Description>
</Member>
<Member Name="TimeStamp" DataType="LINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('UTC microseconds. Time it went active.')}
</Description>
</Member>
<Member Name="Count" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Count of Alarm Occurrences')}
</Description>
</Member>
<Member Name="Duration" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Duration in seconds')}
</Description>
</Member>
<Member Name="ZZZZZZZZZZAlarmData8" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="Active" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZAlarmData8" BitNumber="0" ExternalAccess="Read/Write">
<Description>
${cdata('Alarm Active')}
</Description>
</Member>
<Member Name="DoNotSaveToHistory" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZAlarmData8" BitNumber="1" ExternalAccess="Read/Write">
<Description>
${cdata('Set this flag to prevent the alarm from cluttering up the history.')}
</Description>
</Member>
<Member Name="HMI_ResetCount" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZAlarmData8" BitNumber="2" ExternalAccess="Read/Write">
<Description>
${cdata('HMI Reset input')}
</Description>
</Member>
</Members>
</DataType>
</DataTypes>`;
}

// ── AOI_RangeCheck Definition ─────────────────────────────────────────────────

function generateAOIRangeCheck() {
  return `
<AddOnInstructionDefinition Name="AOI_RangeCheck" Class="Standard" Revision="0.1" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2010-03-29T16:58:02.278Z" CreatedBy="SDC" EditedDate="2026-04-22T19:54:09.008Z" EditedBy="SDC" SoftwareRevision="v37.00">
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Input - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Output - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="Value" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="Deadband" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="Actual" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="InPos" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</DefaultData>
</Parameter>
<Parameter Name="DeadbandWide" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="InPosWide" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</DefaultData>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="Max" DataType="REAL" Radix="Float" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="Min" DataType="REAL" Radix="Float" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="MaxWide" DataType="REAL" Radix="Float" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="MinWide" DataType="REAL" Radix="Float" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>
${cdata('[ADD(Value,Deadband,Max) ,SUB(Value,Deadband,Min) ];')}
</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>
${cdata('LIMIT(Min,Actual,Max)OTE(InPos);')}
</Text>
</Rung>
<Rung Number="2" Type="N">
<Text>
${cdata('[ADD(Value,DeadbandWide,MaxWide) ,SUB(Value,Deadband,MinWide) ];')}
</Text>
</Rung>
<Rung Number="3" Type="N">
<Text>
${cdata('LIMIT(MinWide,Actual,MaxWide)OTE(InPosWide);')}
</Text>
</Rung>
</RLLContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>`;
}

// ── AOI Definition (State_Engine_128Max) ─────────────────────────────────────

export function generateAOI(hasServos = false, hasRobots = false, hasDebouncedSensors = false) {
  const boolL5K = generate128BoolL5K();
  const boolDec = generate128BoolDecorated();

  // FBD_TIMER default data (used for StateDurationTimer and FaultTimer local tags)
  const fbdTimerL5K = '[1,0,0,0,0,0,0,0,0,4,0,0]';
  const fbdTimerDec = `<Structure DataType="FBD_TIMER">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="TimerEnable" DataType="BOOL" Value="0"/>
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Reset" DataType="BOOL" Value="0"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
<DataValueMember Name="Status" DataType="DINT" Radix="Hex" Value="16#0000_0000"/>
<DataValueMember Name="InstructFault" DataType="BOOL" Value="0"/>
<DataValueMember Name="PresetInv" DataType="BOOL" Value="0"/>
</Structure>`;

  // StateLogicStatus default for localStatus local tag
  const localStatusL5K = `[[${boolL5K}],0,0]`;
  const localStatusDec = `<Structure DataType="StateLogicStatus">
<ArrayMember Name="State" DataType="BOOL" Dimensions="128" Radix="Decimal">
${boolDec}
</ArrayMember>
<DataValueMember Name="PreviousState" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="StateChangeOccurred_OS" DataType="BOOL" Value="0"/>
<DataValueMember Name="TimeoutFlt" DataType="BOOL" Value="0"/>
<DataValueMember Name="TransitionTimerDone" DataType="BOOL" Value="0"/>
</Structure>`;

  // Structured Text logic lines
  const stLines = [
    'StateDurationTimer.Reset := 0;',
    'StateDurationTimer.PRE := 2147483647;',
    'SIZE(StateHistoryArray,0,HistoryArraySize);',
    '',
    'TONR(StateDurationTimer);',
    '',
    'COP(StateLogicStatus, localStatus, 1); //localStatus used so all Status updates at the same time, at the end of this code.',
    'If (StateLogicControl.StateReg = StateReg_Prev) THEN',
    '\t//Previous State equal to Current State: Still in the same state as the last scan.',
    '\tlocalStatus.StateChangeOccurred_OS := 0;',
    '',
    '\t//State Duration Timer',
    '\tStateDurationTimer.TimerEnable := 1;',
    '',
    '\t//State Fault Timer',
    '\tIF (StateDurationTimer.ACC >= StateLogicControl.FaultTime ) THEN',
    '\t\tlocalStatus.TimeoutFlt := 1;',
    '\tELSE',
    '\t\tlocalStatus.TimeoutFlt := 0;',
    '\tEND_IF;',
    '',
    '',
    '\t//State Transition Timer',
    '\tIF (StateDurationTimer.ACC >= StateLogicControl.TransitionTime) THEN',
    '\t\tlocalStatus.TransitionTimerDone := 1;',
    '\tELSE',
    '\t\tlocalStatus.TransitionTimerDone := 0;',
    '\tEND_IF;',
    'ELSE',
    '\t//Previous State not Current State: State Change Occurred.',
    '\tlocalStatus.StateChangeOccurred_OS := 1;',
    '\tlocalStatus.PreviousState := StateReg_Prev;',
    '\tStateReg_Prev := StateLogicControl.StateReg;',
    '\t',
    '\t//Shift state history array and store last state in index 0',
    '\tif HistoryArraySize > 1 then //history array size of 1 would cause an array index out of bounds controller fault',
    '\t\tfor i := HistoryArraySize-1 to 1 by -1 do',
    '\t\t\tStateHistoryArray[i] := StateHistoryArray[i-1];',
    '\t\tend_for;',
    '\tend_if;',
    '\tStateHistoryArray[0] := StateReg_Prev;',
    '',
    '\tStateDurationTimer.Reset := 1;',
    '\tStateDurationTimer.TimerEnable := 0;',
    '\t//Default to DINT Max value.',
    '\t//EnaTransitionTimer and EnaFaultTimer bits kept for legacy compatibility',
    '\tStateLogicControl.TransitionTime := 2147483647;',
    '\tStateLogicControl.FaultTime := 2147483647;',
    '',
    '\tlocalStatus.TimeoutFlt := 0;',
    '\tlocalStatus.TransitionTimerDone := 0;',
    'END_IF;',
    '',
    '//Set the State Bit, clear all other bits.',
    'FOR i := 0 TO 127 DO',
    '\tlocalStatus.State[i] := 0;',
    'END_FOR;',
    'localStatus.State[StateLogicControl.StateReg] := 1;',
    '',
    'COP(localStatus, StateLogicStatus, 1);',
    '',
  ];

  const stContent = stLines
    .map((line, i) => `<Line Number="${i}">\n${cdata(line)}\n</Line>`)
    .join('\n');

  return `
<AddOnInstructionDefinitions Use="Context">
<AddOnInstructionDefinition Name="State_Engine_128Max" Class="Standard" Revision="5.0" Vendor="Steven Douglas Corp." ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2013-06-25T13:55:13.933Z" CreatedBy="SDC" EditedDate="2025-08-25T14:49:42.628Z" EditedBy="SDC"
 SoftwareRevision="v35.00">
<Description>
${cdata('State Logic Engine For 128 States')}
</Description>
<RevisionNote>
${cdata(`-Separated UDT into Control & Status Pieces For better use with standard "Progam" methods.
-Removed Timer,OS,Bit, Counter from Control UDT (Use local program tags instead)
-4.1 optimizations
-4.2 optimizations. Ena--Timer bits no longer needed.
-5.0 added integrated state history array (variable length) 1/14/23 D.G.`)}
</RevisionNote>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Input - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Output - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="StateLogicControl" TagType="Base" DataType="StateLogicControl" Usage="InOut" Required="true" Visible="true" Constant="false"/>
<Parameter Name="StateLogicStatus" TagType="Base" DataType="StateLogicStatus" Usage="InOut" Required="true" Visible="true" Constant="false"/>
<Parameter Name="StateHistoryArray" TagType="Base" DataType="SINT" Dimensions="1" Usage="InOut" Radix="Decimal" Required="true" Visible="true" Constant="false">
<Description>
${cdata('State history array')}
</Description>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="StateDurationTimer" DataType="FBD_TIMER" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata(fbdTimerL5K)}
</DefaultData>
<DefaultData Format="Decorated">
${fbdTimerDec}
</DefaultData>
</LocalTag>
<LocalTag Name="i" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="INT" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="StateReg_Prev" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="INT" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="FaultTimer" DataType="FBD_TIMER" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata(fbdTimerL5K)}
</DefaultData>
<DefaultData Format="Decorated">
${fbdTimerDec}
</DefaultData>
</LocalTag>
<LocalTag Name="localStatus" DataType="StateLogicStatus" ExternalAccess="None">
<Description>
${cdata('Temp structure for copying to ensure data changes all at once.')}
</Description>
<DefaultData Format="L5K">
${cdata(localStatusL5K)}
</DefaultData>
<DefaultData Format="Decorated">
${localStatusDec}
</DefaultData>
</LocalTag>
<LocalTag Name="HistoryArraySize" DataType="SINT" Radix="Decimal" ExternalAccess="None">
<Description>
${cdata('Size of state history array')}
</Description>
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="SINT" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="ST">
<STContent>
${stContent}
</STContent>
</Routine>
</Routines>
<Dependencies>
<Dependency Type="DataType" Name="StateLogicStatus"/>
<Dependency Type="DataType" Name="StateLogicControl"/>
</Dependencies>
</AddOnInstructionDefinition>${hasServos ? generateAOIRangeCheck() : ''}
${generateAOIProgramAlarmHandler()}
${hasRobots ? generateAOIRunRobotSeq() : ''}
${hasServos ? generateAOITorqueHome() : ''}
${hasDebouncedSensors ? generateAOIDebounce() : ''}
</AddOnInstructionDefinitions>`;
}

// ── ProgramAlarmHandler AOI (v3.0 — from SDC 1116 production standard) ───────

function generateAOIProgramAlarmHandler() {
  return `
<AddOnInstructionDefinition Name="ProgramAlarmHandler" Class="Standard" Revision="3.0" RevisionExtension="a" Vendor="Steven Douglas Corp." ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2017-08-23T18:02:02.410Z" CreatedBy="SDC" EditedDate="2026-03-06T16:45:45.860Z" EditedBy="SDC" SoftwareRevision="v37.00">
<Description>
${cdata('Creates a shared Alarm History array and a shared Active Alarms array.')}
</Description>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description><![CDATA[Enable Input - System Defined Parameter]]></Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description><![CDATA[Enable Output - System Defined Parameter]]></Description>
</Parameter>
<Parameter Name="PublicProgramIDTag" TagType="Base" DataType="INT" Usage="InOut" Radix="Decimal" Required="true" Visible="true" Constant="false">
<Description><![CDATA[Master Program ID tag used for all handler instances to obtain a unique ID]]></Description>
</Parameter>
<Parameter Name="LocalAlarmsArrayTag" TagType="Base" DataType="AlarmData" Dimensions="1" Usage="InOut" Required="true" Visible="true" Constant="false">
<Description><![CDATA[Local array tag. Faults, Warnings]]></Description>
</Parameter>
<Parameter Name="AlarmActiveArrayTag" TagType="Base" DataType="AlarmData" Dimensions="1" Usage="InOut" Required="true" Visible="true" Constant="false">
<Description><![CDATA[Active array tag. \\Alarms.Active]]></Description>
</Parameter>
<Parameter Name="AlarmHistoryArrayTag" TagType="Base" DataType="AlarmData" Dimensions="1" Usage="InOut" Required="true" Visible="true" Constant="false">
<Description><![CDATA[History array tag. \\Alarms.History]]></Description>
</Parameter>
<Parameter Name="ControllerTimeClockTag" TagType="Base" DataType="CPU_TimeDate" Usage="InOut" Required="true" Visible="true" Constant="false"/>
<Parameter Name="AlarmActiveTag" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="ActiveAlarmArrayIndex" TagType="Base" DataType="INT" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="ActiveAlarmDuration" TagType="Base" DataType="DINT" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="DINT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="MyProgramID" TagType="Base" DataType="INT" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="None">
<Description><![CDATA[This alarm handler's Program ID]]></Description>
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="WarningActiveTag" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="ActiveIndex" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="DataIndex" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="tempLength" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="ShiftIter" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="prevSecond" DataType="SINT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="SINT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="AlarmsActive_size" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="AlarmsHistory_size" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="OneSecond" DataType="BOOL" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
<LocalTag Name="EmptyAlarmData" DataType="AlarmData" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[[0,0,0,0,[0,'$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00$00'],0,0,0,0]]]></DefaultData>
<DefaultData Format="Decorated">
<Structure DataType="AlarmData">
<DataValueMember Name="ProgramID" DataType="INT" Radix="Decimal" Value="0"/>
<DataValueMember Name="AlarmID" DataType="INT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Severity" DataType="INT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Group" DataType="INT" Radix="Decimal" Value="0"/>
<StructureMember Name="Message" DataType="STRING100">
<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII"><![CDATA[]]></DataValueMember>
</StructureMember>
<DataValueMember Name="TimeStamp" DataType="LINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Duration" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Active" DataType="BOOL" Value="0"/>
<DataValueMember Name="DoNotSaveToHistory" DataType="BOOL" Value="0"/>
<DataValueMember Name="HMI_ResetCount" DataType="BOOL" Value="0"/>
</Structure>
</DefaultData>
</LocalTag>
<LocalTag Name="AlarmsLocal_size" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K"><![CDATA[0]]></DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="INT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="ST">
<STContent>
<Line Number="0"><![CDATA[PublicProgramIDTag := PublicProgramIDTag + 1;]]></Line>
<Line Number="1"><![CDATA[MyProgramID := PublicProgramIDTag;]]></Line>
<Line Number="2"><![CDATA[]]></Line>
<Line Number="3"><![CDATA[SIZE(AlarmActiveArrayTag, 0, AlarmsActive_size);]]></Line>
<Line Number="4"><![CDATA[SIZE(AlarmHistoryArrayTag, 0, AlarmsHistory_size);]]></Line>
<Line Number="5"><![CDATA[SIZE(LocalAlarmsArrayTag, 0, AlarmsLocal_size);]]></Line>
<Line Number="6"><![CDATA[]]></Line>
<Line Number="7"><![CDATA[if (ControllerTimeClockTag.Seconds <> prevSecond) then]]></Line>
<Line Number="8"><![CDATA[	prevSecond := ControllerTimeClockTag.Seconds;]]></Line>
<Line Number="9"><![CDATA[	OneSecond := 1;]]></Line>
<Line Number="10"><![CDATA[else]]></Line>
<Line Number="11"><![CDATA[	OneSecond := 0;]]></Line>
<Line Number="12"><![CDATA[end_if;]]></Line>
<Line Number="13"><![CDATA[]]></Line>
<Line Number="14"><![CDATA[for ActiveIndex := 0 to AlarmsActive_size - 1 by 1 do]]></Line>
<Line Number="15"><![CDATA[	if (AlarmActiveArrayTag[ActiveIndex].ProgramID = PublicProgramIDTag) then]]></Line>
<Line Number="16"><![CDATA[		DataIndex := AlarmActiveArrayTag[ActiveIndex].AlarmID;]]></Line>
<Line Number="17"><![CDATA[		if ((DataIndex < 0) OR (DataIndex >= AlarmsLocal_size)) then]]></Line>
<Line Number="18"><![CDATA[			tempLength := AlarmsActive_size - 1 - ActiveIndex;]]></Line>
<Line Number="19"><![CDATA[			if (tempLength > 0) then]]></Line>
<Line Number="20"><![CDATA[				COP(AlarmActiveArrayTag[ActiveIndex + 1], AlarmActiveArrayTag[ActiveIndex], tempLength);]]></Line>
<Line Number="21"><![CDATA[			end_if;]]></Line>
<Line Number="22"><![CDATA[			COP(EmptyAlarmData, AlarmActiveArrayTag[AlarmsActive_size - 1], 1);]]></Line>
<Line Number="23"><![CDATA[			exit;]]></Line>
<Line Number="24"><![CDATA[		end_if;]]></Line>
<Line Number="25"><![CDATA[		if (OneSecond) then]]></Line>
<Line Number="26"><![CDATA[			LocalAlarmsArrayTag[DataIndex].Duration := LocalAlarmsArrayTag[DataIndex].Duration +1;]]></Line>
<Line Number="27"><![CDATA[			AlarmActiveArrayTag[ActiveIndex].Duration := AlarmActiveArrayTag[ActiveIndex].Duration +1;]]></Line>
<Line Number="28"><![CDATA[		end_if;]]></Line>
<Line Number="29"><![CDATA[		if (NOT LocalAlarmsArrayTag[DataIndex].Active) then]]></Line>
<Line Number="30"><![CDATA[			if (NOT LocalAlarmsArrayTag[DataIndex].DoNotSaveToHistory) then]]></Line>
<Line Number="31"><![CDATA[				for ShiftIter := AlarmsHistory_size - 2 to 0 by -1 do]]></Line>
<Line Number="32"><![CDATA[					COP(AlarmHistoryArrayTag[ShiftIter], AlarmHistoryArrayTag[ShiftIter + 1], 1);]]></Line>
<Line Number="33"><![CDATA[				end_for;]]></Line>
<Line Number="34"><![CDATA[				COP(AlarmActiveArrayTag[ActiveIndex], AlarmHistoryArrayTag[0], 1);]]></Line>
<Line Number="35"><![CDATA[			end_if;]]></Line>
<Line Number="36"><![CDATA[			tempLength := AlarmsActive_size - 1 - ActiveIndex;]]></Line>
<Line Number="37"><![CDATA[			if (ActiveIndex < (AlarmsActive_size - 1)) then]]></Line>
<Line Number="38"><![CDATA[				COP(AlarmActiveArrayTag[ActiveIndex + 1], AlarmActiveArrayTag[ActiveIndex], tempLength);]]></Line>
<Line Number="39"><![CDATA[			end_if;]]></Line>
<Line Number="40"><![CDATA[			COP(EmptyAlarmData, AlarmActiveArrayTag[AlarmsActive_size - 1], 1);]]></Line>
<Line Number="41"><![CDATA[		end_if;]]></Line>
<Line Number="42"><![CDATA[	end_if;]]></Line>
<Line Number="43"><![CDATA[end_for;]]></Line>
<Line Number="44"><![CDATA[]]></Line>
<Line Number="45"><![CDATA[AlarmActiveTag := 0;]]></Line>
<Line Number="46"><![CDATA[WarningActiveTag := 0;]]></Line>
<Line Number="47"><![CDATA[]]></Line>
<Line Number="48"><![CDATA[For DataIndex := 0 to AlarmsLocal_size - 1 By 1 Do]]></Line>
<Line Number="49"><![CDATA[	If (LocalAlarmsArrayTag[DataIndex].Active) Then]]></Line>
<Line Number="50"><![CDATA[		If (LocalAlarmsArrayTag[DataIndex].Severity = 0) Then]]></Line>
<Line Number="51"><![CDATA[			AlarmActiveTag := 1;]]></Line>
<Line Number="52"><![CDATA[		End_If;]]></Line>
<Line Number="53"><![CDATA[		If (LocalAlarmsArrayTag[DataIndex].Severity = 1) Then]]></Line>
<Line Number="54"><![CDATA[			WarningActiveTag := 1;]]></Line>
<Line Number="55"><![CDATA[		End_If;]]></Line>
<Line Number="56"><![CDATA[		ActiveAlarmArrayIndex := DataIndex;]]></Line>
<Line Number="57"><![CDATA[		ActiveAlarmDuration := LocalAlarmsArrayTag[DataIndex].Duration;]]></Line>
<Line Number="58"><![CDATA[		For ActiveIndex := 0 to AlarmsActive_size - 1 By 1 Do]]></Line>
<Line Number="59"><![CDATA[			If ((AlarmActiveArrayTag[ActiveIndex].ProgramID = PublicProgramIDTag) AND (AlarmActiveArrayTag[ActiveIndex].AlarmID = DataIndex)) Then]]></Line>
<Line Number="60"><![CDATA[				Exit;]]></Line>
<Line Number="61"><![CDATA[			End_If;]]></Line>
<Line Number="62"><![CDATA[		End_For;]]></Line>
<Line Number="63"><![CDATA[		If (ActiveIndex > AlarmsActive_size - 1) Then]]></Line>
<Line Number="64"><![CDATA[			For ShiftIter := AlarmsActive_size - 2 to 0 By -1 Do]]></Line>
<Line Number="65"><![CDATA[				COP(AlarmActiveArrayTag[ShiftIter], AlarmActiveArrayTag[ShiftIter + 1], 1);]]></Line>
<Line Number="66"><![CDATA[			End_For;]]></Line>
<Line Number="67"><![CDATA[			LocalAlarmsArrayTag[DataIndex].ProgramID := PublicProgramIDTag;]]></Line>
<Line Number="68"><![CDATA[			LocalAlarmsArrayTag[DataIndex].AlarmID := DataIndex;]]></Line>
<Line Number="69"><![CDATA[			COP(ControllerTimeClockTag.UTCMicroseconds, LocalAlarmsArrayTag[DataIndex].TimeStamp, 1);]]></Line>
<Line Number="70"><![CDATA[			LocalAlarmsArrayTag[DataIndex].Duration := 0;]]></Line>
<Line Number="71"><![CDATA[			LocalAlarmsArrayTag[DataIndex].Count := LocalAlarmsArrayTag[DataIndex].Count +1;]]></Line>
<Line Number="72"><![CDATA[			COP(LocalAlarmsArrayTag[DataIndex], AlarmActiveArrayTag[0], 1);]]></Line>
<Line Number="73"><![CDATA[		End_If;]]></Line>
<Line Number="74"><![CDATA[	End_If;]]></Line>
<Line Number="75"><![CDATA[End_For;]]></Line>
<Line Number="76"><![CDATA[]]></Line>
<Line Number="77"><![CDATA[if (AlarmActiveTag) then]]></Line>
<Line Number="78"><![CDATA[	ActiveAlarmArrayIndex := 9999;]]></Line>
<Line Number="79"><![CDATA[	ActiveAlarmDuration := 0;]]></Line>
<Line Number="80"><![CDATA[end_if;]]></Line>
</STContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>`;
}

// ── Run_Robot_Seq AOI ────────────────────────────────────────────────────────

function generateAOIRunRobotSeq() {
  return `
<AddOnInstructionDefinition Name="Run_Robot_Seq" Class="Standard" Revision="1.0" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="true" CreatedDate="2024-01-01T00:00:00.000Z" CreatedBy="SDC" EditedDate="2024-01-01T00:00:00.000Z" EditedBy="SDC" SoftwareRevision="v35.00">
<Description>
${cdata('Manages a single robot sequence request through the AAMAIN command handshake. Rung-in triggers the sequence; outputs track status.')}
</Description>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>${cdata('Enable Input - System Defined Parameter')}</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>${cdata('Enable Output - System Defined Parameter')}</Description>
</Parameter>
<Parameter Name="Sequence_Number" TagType="Base" DataType="SINT" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="SINT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Timeout_s" TagType="Base" DataType="DINT" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="DINT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Running_Sequence" TagType="Base" DataType="DINT" Usage="InOut" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="Seq_Request" TagType="Base" DataType="DINT" Usage="InOut" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="CMDComplete" TagType="Base" DataType="BOOL" Usage="InOut" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="CMDFailed" TagType="Base" DataType="BOOL" Usage="InOut" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="CMDRunning" TagType="Base" DataType="BOOL" Usage="InOut" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write"/>
<Parameter Name="Pending" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Requested" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Running" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Complete" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Failed" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Timed_Out" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="TimeoutTimer" DataType="TIMER" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('[0,0,0]')}</DefaultData>
<DefaultData Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="ST">
<STContent>
<Line Number="0"><![CDATA[(* Run_Robot_Seq — manages single sequence through AAMAIN handshake *)]]></Line>
<Line Number="1"><![CDATA[IF EnableIn AND NOT Pending AND NOT Requested AND NOT Running AND NOT Complete AND NOT Failed THEN]]></Line>
<Line Number="2"><![CDATA[  Pending := 1; Requested := 0; Running := 0; Complete := 0; Failed := 0; Timed_Out := 0;]]></Line>
<Line Number="3"><![CDATA[END_IF;]]></Line>
<Line Number="4"><![CDATA[IF Pending AND Seq_Request = 0 THEN]]></Line>
<Line Number="5"><![CDATA[  Seq_Request := Sequence_Number; Pending := 0; Requested := 1;]]></Line>
<Line Number="6"><![CDATA[END_IF;]]></Line>
<Line Number="7"><![CDATA[IF Requested AND Running_Sequence = Sequence_Number THEN]]></Line>
<Line Number="8"><![CDATA[  Requested := 0; Running := 1;]]></Line>
<Line Number="9"><![CDATA[  IF Timeout_s > 0 THEN TimeoutTimer.PRE := Timeout_s * 1000; END_IF;]]></Line>
<Line Number="10"><![CDATA[END_IF;]]></Line>
<Line Number="11"><![CDATA[IF Running AND CMDComplete THEN Running := 0; Complete := 1; END_IF;]]></Line>
<Line Number="12"><![CDATA[IF Running AND CMDFailed THEN Running := 0; Failed := 1; END_IF;]]></Line>
<Line Number="13"><![CDATA[IF Running AND Timeout_s > 0 THEN]]></Line>
<Line Number="14"><![CDATA[  TimeoutTimer.TimerEnable := 1;]]></Line>
<Line Number="15"><![CDATA[  IF TimeoutTimer.DN THEN Running := 0; Timed_Out := 1; END_IF;]]></Line>
<Line Number="16"><![CDATA[END_IF;]]></Line>
<Line Number="17"><![CDATA[IF NOT EnableIn THEN]]></Line>
<Line Number="18"><![CDATA[  Pending := 0; Requested := 0; Running := 0; Complete := 0; Failed := 0; Timed_Out := 0;]]></Line>
<Line Number="19"><![CDATA[  TimeoutTimer.ACC := 0; TimeoutTimer.TimerEnable := 0;]]></Line>
<Line Number="20"><![CDATA[END_IF;]]></Line>
</STContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>`;
}

// ── AOI_Debounce (SDC Guide §15.8) ───────────────────────────────────────────
//
// Standard library AOI — verbatim XML structure from SDC library. Used by R01
// for part-present digital sensors (NOT pneumatic ext/ret, NOT robot DI/DO).
// Callers reference {name}Debounce.On (debounced true) and .Off (debounced false).
function generateAOIDebounce() {
  return `
<AddOnInstructionDefinition Name="AOI_Debounce" Class="Standard" Revision="1.0" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2017-12-20T17:38:23.616Z" CreatedBy="SDC" EditedDate="2017-12-20T17:43:44.150Z" EditedBy="SDC" SoftwareRevision="v30.00">
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>${cdata('Enable Input - System Defined Parameter')}</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>${cdata('Enable Output - System Defined Parameter')}</Description>
</Parameter>
<Parameter Name="Input" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="OnDelay" TagType="Base" DataType="DINT" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="DINT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="OffDelay" TagType="Base" DataType="DINT" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="DINT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="On" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="Off" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="OnTimer" DataType="TIMER" ExternalAccess="None">
<DefaultData Format="L5K">${cdata('[0,0,0]')}</DefaultData>
<DefaultData Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</DefaultData>
</LocalTag>
<LocalTag Name="OffTimer" DataType="TIMER" ExternalAccess="None">
<DefaultData Format="L5K">${cdata('[0,0,0]')}</DefaultData>
<DefaultData Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>${cdata('[XIC(Input) MOVE(OnDelay,OnTimer.PRE) TON(OnTimer,?,?) ,XIO(Input) MOVE(OffDelay,OffTimer.PRE) TON(OffTimer,?,?) ];')}</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>${cdata('[XIC(OnTimer.DN) OTE(On) ,XIC(OffTimer.DN) OTE(Off) ];')}</Text>
</Rung>
</RLLContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>`;
}

// ── AOI_TorqueHome (SDC Guide §15.4) ─────────────────────────────────────────
//
// Standard library AOI — verbatim logic from SDC library. Drives servo home
// using torque limit detection. Emitted only when any ServoAxis device is
// present. The engineer may use a plain MAH instead in the home rung, but this
// AOI must be available in the project.
function generateAOITorqueHome() {
  // Motion instruction local tag template (many copies are needed).
  const motionInst = (name) => `<LocalTag Name="${name}" DataType="MOTION_INSTRUCTION" ExternalAccess="None">
<DefaultData Format="L5K">${cdata('[0,0,0,0,0,0,0,0,0]')}</DefaultData>
<DefaultData Format="Decorated">
<Structure DataType="MOTION_INSTRUCTION">
<DataValueMember Name="FLAGS" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
<DataValueMember Name="ER" DataType="BOOL" Value="0"/>
<DataValueMember Name="PC" DataType="BOOL" Value="0"/>
<DataValueMember Name="IP" DataType="BOOL" Value="0"/>
<DataValueMember Name="AC" DataType="BOOL" Value="0"/>
<DataValueMember Name="ACCEL" DataType="BOOL" Value="0"/>
<DataValueMember Name="DECEL" DataType="BOOL" Value="0"/>
<DataValueMember Name="TrackingMaster" DataType="BOOL" Value="0"/>
<DataValueMember Name="CalculatedDataAvailable" DataType="BOOL" Value="0"/>
<DataValueMember Name="ERR" DataType="INT" Radix="Decimal" Value="0"/>
<DataValueMember Name="STATUS" DataType="SINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="STATE" DataType="SINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="SEGMENT" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EXERR" DataType="SINT" Radix="Decimal" Value="0"/>
</Structure>
</DefaultData>
</LocalTag>`;

  const timer = (name, pre = 0) => `<LocalTag Name="${name}" DataType="TIMER" ExternalAccess="None">
<DefaultData Format="L5K">${cdata(`[0,${pre},0]`)}</DefaultData>
<DefaultData Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${pre}"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</DefaultData>
</LocalTag>`;

  const realLocal = (name) => `<LocalTag Name="${name}" DataType="REAL" Radix="Float" ExternalAccess="None">
<DefaultData Format="L5K">${cdata('0.00000000e+000')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="REAL" Radix="Float" Value="0.0"/></DefaultData>
</LocalTag>`;

  const dintLocal = (name) => `<LocalTag Name="${name}" DataType="DINT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="DINT" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>`;

  const boolLocal = (name) => `<LocalTag Name="${name}" DataType="BOOL" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</LocalTag>`;

  return `
<AddOnInstructionDefinition Name="AOI_TorqueHome" Class="Standard" Revision="1.0" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="true" CreatedDate="2014-09-18T14:11:39.176Z" CreatedBy="SDC" EditedDate="2019-09-25T15:36:56.907Z" EditedBy="SDC" SoftwareRevision="v31.00">
<Description>${cdata('Home Servo Axis By Using Torque Limit')}</Description>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>${cdata('Enable Input - System Defined Parameter')}</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>${cdata('Enable Output - System Defined Parameter')}</Description>
</Parameter>
<Parameter Name="Axis" TagType="Base" DataType="AXIS_CIP_DRIVE" Usage="InOut" Required="true" Visible="true"/>
<Parameter Name="HomingTorque" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0.00000000e+000')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="REAL" Radix="Float" Value="0.0"/></DefaultData>
</Parameter>
<Parameter Name="RunTorque" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0.00000000e+000')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="REAL" Radix="Float" Value="0.0"/></DefaultData>
</Parameter>
<Parameter Name="Error" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="IP" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="PC" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="BOOL" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
<Parameter Name="HomingSpeed" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0.00000000e+000')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="REAL" Radix="Float" Value="0.0"/></DefaultData>
</Parameter>
<Parameter Name="OvertorqueLimit" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0.00000000e+000')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="REAL" Radix="Float" Value="0.0"/></DefaultData>
</Parameter>
<Parameter Name="HomeOffsetDist" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0.00000000e+000')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="REAL" Radix="Float" Value="0.0"/></DefaultData>
</Parameter>
<Parameter Name="HomeDirection" TagType="Base" DataType="DINT" Usage="Input" Radix="Decimal" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">${cdata('0')}</DefaultData>
<DefaultData Format="Decorated"><DataValue DataType="DINT" Radix="Decimal" Value="0"/></DefaultData>
</Parameter>
</Parameters>
<LocalTags>
${dintLocal('TorqueHome_CS')}
${dintLocal('TorqueHome_SW')}
${motionInst('Axis_MSO')}
${motionInst('Axis_MSF')}
${motionInst('Axis_MAJ')}
${realLocal('OvertorqueLimitTime')}
${motionInst('Axis_MAFR')}
${motionInst('Axis_MAM')}
${timer('FaultTimer', 0)}
${dintLocal('TorqueHome_CS_Pre')}
${boolLocal('TorqueHomeSC')}
${motionInst('Axis_MAH')}
${dintLocal('SoftOTCheck')}
${motionInst('Axis_MAS')}
${timer('TorqueHome_ST6_TMR', 500)}
${timer('PosSettleTimer', 0)}
${timer('TorqueHome_ST2_TMR', 100)}
${timer('TorqueHome_ST6A_TMR', 100)}
${realLocal('AxisScalingNumerator')}
${realLocal('OffsetMoveSpeed')}
</LocalTags>
<Routines>
<Routine Name="EnableInFalse" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N"><Text>${cdata('XIC(IP)OTU(IP);')}</Text></Rung>
</RLLContent>
</Routine>
<Routine Name="Logic" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N"><Text>${cdata('XIC(EnableIn)XIO(IP)[MOVE(0,TorqueHome_CS) ,OTL(IP) ,OTU(Error) ,OTU(PC) ];')}</Text></Rung>
<Rung Number="1" Type="N"><Text>${cdata('XIC(TorqueHome_SW.0)XIC(Axis.ServoActionStatus)MOVE(1,TorqueHome_CS);')}</Text></Rung>
<Rung Number="2" Type="N"><Text>${cdata('[XIC(TorqueHome_SW.1) MSF(Axis,Axis_MSF) ,XIC(TorqueHome_SW.0) ]XIO(Axis.ServoActionStatus)MOVE(2,TorqueHome_CS);')}</Text></Rung>
<Rung Number="3" Type="N"><Text>${cdata('XIC(TorqueHome_SW.2)[SSV(Axis,Axis,TorqueLimitNegative,HomingTorque) ,SSV(Axis,Axis,OvertorqueLimit,OvertorqueLimit) ,MOVE(0.1,OvertorqueLimitTime) SSV(Axis,Axis,OvertorqueLimitTime,OvertorqueLimitTime) ,MOVE(0,SoftOTCheck) SSV(Axis,Axis,SoftTravelLimitChecking,SoftOTCheck) ]MOVE(100,TorqueHome_ST2_TMR.PRE)TON(TorqueHome_ST2_TMR,?,?)XIC(TorqueHome_ST2_TMR.DN)MOVE(3,TorqueHome_CS);')}</Text></Rung>
<Rung Number="4" Type="N"><Text>${cdata('XIC(TorqueHome_SW.3)MSO(Axis,Axis_MSO)XIC(Axis.ServoActionStatus)MOVE(4,TorqueHome_CS);')}</Text></Rung>
<Rung Number="5" Type="N"><Text>${cdata('XIC(TorqueHome_SW.4)MAJ(Axis,Axis_MAJ,HomeDirection,HomingSpeed,Units per sec,50,Units per sec2,50,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None)XIC(Axis_MAJ.IP)MOVE(5,TorqueHome_CS);')}</Text></Rung>
<Rung Number="6" Type="N"><Text>${cdata('XIC(TorqueHome_SW.5)[XIC(Axis.OvertorqueLimitFault) ,XIC(Axis.ExcessivePositionErrorFault) ]XIO(Axis.ServoActionStatus)MOVE(6,TorqueHome_CS);')}</Text></Rung>
<Rung Number="7" Type="N"><Text>${cdata('XIC(TorqueHome_SW.6)MAFR(Axis,Axis_MAFR)EQ(Axis.AxisFault,0)[SSV(Axis,Axis,TorqueLimitNegative,RunTorque) ,MOVE(0,OvertorqueLimitTime) SSV(Axis,Axis,OvertorqueLimitTime,OvertorqueLimitTime) ,MOVE(1,SoftOTCheck) SSV(Axis,Axis,SoftTravelLimitChecking,SoftOTCheck) ]MOVE(1000,TorqueHome_ST6A_TMR.PRE)TON(TorqueHome_ST6A_TMR,?,?)XIC(TorqueHome_ST6A_TMR.DN)MOVE(7,TorqueHome_CS);')}</Text></Rung>
<Rung Number="8" Type="N"><Text>${cdata('XIC(TorqueHome_SW.7)MSO(Axis,Axis_MSO)XIC(Axis.ServoActionStatus)MOVE(8,TorqueHome_CS)GSV(Axis,Axis,PositionScalingNumerator,AxisScalingNumerator);')}</Text></Rung>
<Rung Number="9" Type="N"><Text>${cdata('XIC(TorqueHome_SW.8)[EQ(AxisScalingNumerator,360.0) MOVE(15.0,OffsetMoveSpeed) ,NE(AxisScalingNumerator,360.0) MOVE(1.0,OffsetMoveSpeed) ]MAM(Axis,Axis_MAM,1,HomeOffsetDist,OffsetMoveSpeed,Units per sec,150,Units per sec2,150,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0)XIC(Axis_MAM.PC)MOVE(250,PosSettleTimer.PRE)TON(PosSettleTimer,?,?)XIC(PosSettleTimer.DN)MOVE(10,TorqueHome_CS);')}</Text></Rung>
<Rung Number="10" Type="N"><Text>${cdata('AFI()XIC(TorqueHome_SW.9)MSF(Axis,Axis_MSF)XIO(Axis.ServoActionStatus)MOVE(10,TorqueHome_CS);')}</Text></Rung>
<Rung Number="11" Type="N"><Text>${cdata('XIC(TorqueHome_SW.10)MAH(Axis,Axis_MAH)XIC(Axis_MAH.PC)MOVE(11,TorqueHome_CS)OTL(PC);')}</Text></Rung>
<Rung Number="12" Type="N"><Text>${cdata('XIO(TorqueHomeSC)[[XIC(TorqueHome_SW.1) ,XIC(TorqueHome_SW.2) ,XIC(TorqueHome_SW.3) ,XIC(TorqueHome_SW.4) ,XIC(TorqueHome_SW.6) ,XIC(TorqueHome_SW.7) ,XIC(TorqueHome_SW.9) ,XIC(TorqueHome_SW.10) ] MOVE(2000,FaultTimer.PRE) ,XIC(TorqueHome_SW.5) MOVE(60000,FaultTimer.PRE) ,XIC(TorqueHome_SW.8) MOVE(5000,FaultTimer.PRE) ]TON(FaultTimer,?,?)XIC(FaultTimer.DN)[SSV(Axis,Axis,TorqueLimitNegative,RunTorque) ,MOVE(0,OvertorqueLimitTime) SSV(Axis,Axis,OvertorqueLimitTime,OvertorqueLimitTime) ,MOVE(1,SoftOTCheck) SSV(Axis,Axis,SoftTravelLimitChecking,SoftOTCheck) ]MOVE(31,TorqueHome_CS)[OTL(Error) ,MAS(Axis,Axis_MAS,All,Yes,150,Units per sec2,No,0,Units per sec3) ];')}</Text></Rung>
<Rung Number="13" Type="N"><Text>${cdata('[CLR(TorqueHome_SW) ,OTE(TorqueHome_SW.[TorqueHome_CS]) ];')}</Text></Rung>
<Rung Number="14" Type="N"><Text>${cdata('NE(TorqueHome_CS,TorqueHome_CS_Pre)MOVE(TorqueHome_CS,TorqueHome_CS_Pre)OTE(TorqueHomeSC);')}</Text></Rung>
</RLLContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>`;
}

// ── R04/R05+ per-axis servo routines (§15.4) ─────────────────────────────────
//
// Emits one routine per ServoAxis device. Naming per §15.2:
//   1 axis  → R04_StateLogicServo
//   2 axes  → R04_{axis1}Servo + R05_{axis2}Servo
//   N axes  → R04.. R(03+N)_{axisName}Servo
//
// Each routine has 22 rungs per the engineer's reference (R04_XAxisServo):
//   0  Axis Ready                       16  Stop on permissive lost (MAS)
//   1  AutoEnable (ready → debounce)    17  Set +Torque
//   2  Permissive (machine-specific)    18  Set -Torque
//   3  Enable (MSO)                     19  Retrieve ActualPosition/Velocity/Torque
//   4  Disable (MSF)                    20  GSV maximums (first-scan)
//   5  Fault reset (MAFR/MASR)          21  Position Monitor (AOI_RangeCheck)
//   6  Jog +/- (MAJ)
//   7  Jog stop (MAS_Jog)
//   8  Inch (MAM Inch)
//   9  Home Request
//  10  Home Confirm
//  11  Home (MAH or AOI_TorqueHome)
//  12  Home status → HMI
//  13  Manual Mode (HMI ManMoves → MAM params)
//  14  Auto Mode (state → position MOVE)
//  15  Axis Motion Command (MAM auto)
//
// Rungs 14, 15 auto-bind every ServoMove action in the flowchart (+ recovery
// flowchart) to this axis — rung 14 MOVEs the chosen position into the motion
// struct; rung 15 gates the MAM on the list of states that triggered any
// ServoMove. Rung 2 still emits a bare Permissive OTE (CE refines).
// Rung 21 generates one AOI_RangeCheck instance per declared position.

// Walk main + recovery flowcharts and return Map<stateNumber, positionIndex>
// for every ServoMove action that targets `device`.
function collectServoMovesForAxis(sm, device, orderedNodes, stepMap) {
  const positions = device.positions ?? [];
  const servoStateToPos = new Map();

  const addNode = (node, stepNum) => {
    if (!stepNum) return;
    const actions = node.data?.actions ?? [];
    for (const action of actions) {
      if (action.deviceId !== device.id) continue;
      if (action.operation !== 'ServoMove') continue;
      const pos = positions.find(p => p.name === action.positionName);
      if (!pos) continue;
      const posIdx = pos.positionIndex ?? positions.indexOf(pos);
      servoStateToPos.set(stepNum, posIdx);
    }
  };

  for (const node of orderedNodes ?? []) addNode(node, stepMap?.[node.id]);

  const recSeq = (sm.recoverySeqs ?? [])[0];
  if (recSeq?.nodes?.length > 0) {
    const recNodes = orderNodes(recSeq.nodes, recSeq.edges ?? []);
    const recMap = buildRecoveryStepMap(recNodes, sm.devices ?? []);
    for (const node of recNodes) addNode(node, recMap[node.id]);
  }

  return servoStateToPos;
}

function generateServoAxisRoutine(routineName, device, sm, orderedNodes, stepMap) {
  const name = device.name;
  const rungs = [];
  let n = 0;
  const positions = device.positions ?? [];
  const axisTag = `iq_${name}`;
  const hmi = `HMI_${name}`;
  const mp = `${name}MotionParameters`;

  const servoStateToPos = collectServoMovesForAxis(sm, device, orderedNodes, stepMap);
  // Group by position index so multiple states sharing a position share a MOVE branch.
  const posToStates = new Map();
  for (const [stateNum, posIdx] of servoStateToPos) {
    if (!posToStates.has(posIdx)) posToStates.set(posIdx, []);
    posToStates.get(posIdx).push(stateNum);
  }
  for (const list of posToStates.values()) list.sort((a, b) => a - b);
  const allServoStates = [...servoStateToPos.keys()].sort((a, b) => a - b);

  // Rung 0 — Axis Ready
  rungs.push(buildRung(n++, 'Axis Is Ready For Operation',
    `XIC(MotionGroup.GroupSynced)XIO(${axisTag}.SafeTorqueOffActiveInhibit)OTE(${name}Ready);`));

  // Rung 1 — AutoEnable (SafetyOK + Ready → TON debounce → ONS pulse)
  rungs.push(buildRung(n++, null,
    `XIC(SafetyOK)XIC(${name}Ready)TON(${name}EnableDelay,?,?)XIC(${name}EnableDelay.DN)ONS(${name}ONS.0)OTE(${name}AutoEnable);`));

  // Rung 2 — Permissive (machine-specific — CE adds interference checks)
  rungs.push(buildRung(n++,
    'Axis Motion Permissive (Add more conditions if necessary. Permissive should be based on the physical state of itself potentially interfering devices)',
    `OTE(${name}Permissive);`));

  // Rung 3 — Enable (MSO)
  rungs.push(buildRung(n++, 'Enable Axis',
    `[XIC(Status.State[1]) XIC(${hmi}.Control.Enable) XIC(${name}Ready) ,XIC(${name}AutoEnable) ]XIO(${axisTag}.ServoActionStatus)MSO(${axisTag},${name}_MSO);`));

  // Rung 4 — Disable (MSF)
  rungs.push(buildRung(n++, 'Disable Axis',
    `XIC(Status.State[1])XIC(${hmi}.Control.Disable)MSF(${axisTag},${name}_MSF);`));

  // Rung 5 — Fault Reset (MAFR on transient, MASR on shutdown)
  rungs.push(buildRung(n++, 'Fault Reset Axis',
    `NE(${axisTag}.AxisFault,0)XIC(FaultReset)[XIO(${axisTag}.ShutdownStatus) MAFR(${axisTag},${name}_MAFR) ,XIC(${axisTag}.ShutdownStatus) MASR(${axisTag},${name}_MASR) ];`));

  // Rung 6 — Jog +/- (MAJ) with direction MOVE
  rungs.push(buildRung(n++, 'Jog Axis',
    `XIC(Status.State[1])XIC(${name}Permissive)XIC(${axisTag}.ServoActionStatus)XIO(${axisTag}.JogStatus)XIO(${axisTag}.MoveStatus)` +
    `[XIC(${hmi}.Control.JogPositive) XIO(${hmi}.Control.JogNegative) MOVE(0,${name}JogDirection) ,` +
    `XIC(${hmi}.Control.JogNegative) XIO(${hmi}.Control.JogPositive) MOVE(1,${name}JogDirection) ]` +
    `MAJ(${axisTag},${name}_MAJ,${name}JogDirection,${hmi}.Parameters.JogSpeed,Units per sec,${hmi}.Parameters.Accel[0],Units per sec2,${hmi}.Parameters.Decel[0],Units per sec2,Trapezoidal,0,0,Units per MasterUnit3,Disabled,0,0,None);`));

  // Rung 7 — Jog stop (MAS_Jog)
  rungs.push(buildRung(n++, null,
    `XIC(${name}_MAJ.IP)XIO(${hmi}.Control.JogPositive)XIO(${hmi}.Control.JogNegative)MAS(${axisTag},${name}_MAS_Jog,Jog,Yes,${hmi}.Parameters.Decel[0],Units per sec2,No,0,Units per sec3);`));

  // Rung 8 — Inch (MAM Inch mode, signed)
  rungs.push(buildRung(n++, 'Inch Axis',
    `XIC(Status.State[1])XIC(${name}Permissive)XIC(${axisTag}.ServoActionStatus)XIO(${axisTag}.JogStatus)XIO(${axisTag}.MoveStatus)` +
    `[XIC(${hmi}.Control.InchPositive) ONS(${name}ONS.1) MOVE(${hmi}.Parameters.InchAmount,${name}InchAmount) ,` +
    `XIC(${hmi}.Control.InchNegative) ONS(${name}ONS.2) NEG(${hmi}.Parameters.InchAmount,${name}InchAmount) ]` +
    `MAM(${axisTag},${name}_Inch,1,${name}InchAmount,${hmi}.Parameters.ManualSpeed,Units per sec,${hmi}.Parameters.Accel[0],Units per sec2,${hmi}.Parameters.Decel[0],Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);`));

  // Rung 9 — Home Request (HMI pulse or retriggered)
  rungs.push(buildRung(n++, 'Home Axis',
    `XIC(Status.State[1])[XIC(${hmi}.Control.HomeRequest) ONS(${name}ONS.3) XIO(${name}TorqueHome.IP) ,` +
    `XIC(${name}HomeRequested) XIO(${name}HomeConfirmDelay.DN) XIO(${name}HomeConfimed) ]` +
    `XIC(${name}Ready)[OTE(${name}HomeRequested) ,TON(${name}HomeConfirmDelay,?,?) ];`));

  // Rung 10 — Home Confirm (operator confirms homed position)
  rungs.push(buildRung(n++, null,
    `XIC(Status.State[1])[XIC(${hmi}.Control.HomeConfirm) ONS(${name}ONS.4) ,` +
    `XIC(${name}HomeConfimed) XIC(${name}HomeSelect) XIO(${name}TorqueHome.PC) XIO(${name}TorqueHome.Error) ]OTE(${name}HomeConfimed);`));

  // Rung 11 — Home (MAH immediate or AOI_TorqueHome)
  rungs.push(buildRung(n++,
    `Home Select = 0 is for Immediate Home (Example, servo indexer)\nHome Select = 1 is for Home To Torque (Example, PNP)\n\nHoming Torque = Start at 25%, Increase In 5% Increments If Not Enough\nRun Torque = Normal Running Torque Of Axis\nHoming Speed = Homing Speed in units/s\nOvertorque Limit = Set The Same As Homing Torque\nHome Offset Distance = Distance Moved Off Of Hard Stop When Homing Complete\nHome Direction = 0 Is Positive, 1 Is Negative`,
    `XIC(${name}HomeConfimed)[XIO(${name}HomeSelect) MAH(${axisTag},${name}_MAH) ,` +
    `XIC(${name}HomeSelect) AOI_TorqueHome(${name}TorqueHome,${axisTag},25.0,100.0,5.0,25.0,0.5,1) ];`));

  // Rung 12 — Home status OTEs (HMI display)
  rungs.push(buildRung(n++, null,
    `[XIC(${name}HomeRequested) OTE(${hmi}.Status.HomeRequested) ,` +
    `[XIC(${name}TorqueHome.IP) ,XIC(${name}_MAH.IP) ] OTE(${hmi}.Status.HomeInProcess) ,` +
    `[XIC(${name}TorqueHome.PC) ,XIC(${name}_MAH.PC) ] OTE(${hmi}.Status.HomeComplete) ];`));

  // Rung 13 — Manual Mode (ManMoves.N → MotionParameters.Position via declared positions)
  let manBranches = `MOVE(${hmi}.Parameters.ManualSpeed,${mp}.Speed) ,XIC(${name}Permissive) [`;
  if (positions.length === 0) {
    manBranches += `XIC(${hmi}.Control.ManMoves.0) MOVE(${hmi}.Parameters.Positions[0],${mp}.Position) `;
  } else {
    manBranches += positions.map((pos, i) =>
      `XIC(${hmi}.Control.ManMoves.${pos.positionIndex ?? i}) MOVE(${hmi}.Parameters.Positions[${pos.positionIndex ?? i}],${mp}.Position)`
    ).join(' ,');
  }
  manBranches += ` ] OTE(${name}ManMoveTrig) `;
  rungs.push(buildRung(n++, 'Manual Mode',
    `XIC(SafetyOK)XIC(Status.State[1])[${manBranches}];`));

  // Rung 14 — Auto Mode (state → position MOVE). Each declared position gets a
  // branch listing every flowchart state that moves this axis to that position.
  let rung14 = `XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,${mp}.MoveType) ,` +
    `MOVE(${hmi}.Parameters.AutoSpeed[0],${mp}.Speed) ,` +
    `MOVE(${hmi}.Parameters.Accel[0],${mp}.Accel) ,` +
    `MOVE(${hmi}.Parameters.Decel[0],${mp}.Decel)`;
  const sortedPosEntries = [...posToStates.entries()].sort(([a], [b]) => a - b);
  for (const [posIdx, stateNums] of sortedPosEntries) {
    const gate = stateNums.length === 1
      ? `XIC(Status.State[${stateNums[0]}])`
      : `[${stateNums.map(s => `XIC(Status.State[${s}])`).join(' ,')}]`;
    rung14 += ` ,${gate} MOVE(${hmi}.Parameters.Positions[${posIdx}],${mp}.Position)`;
  }
  rung14 += ` ];`;
  rungs.push(buildRung(n++, 'Auto Mode', rung14));

  // Rung 15 — Axis Motion Command (MAM auto) — gated on manual trigger or any
  // state that binds a ServoMove to this axis.
  const autoStateGate = allServoStates.length === 0
    ? ''
    : (allServoStates.length === 1
        ? `XIC(Status.State[${allServoStates[0]}]) `
        : `[${allServoStates.map(s => `XIC(Status.State[${s}])`).join(' ,')}] `);
  rungs.push(buildRung(n++, 'Axis Motion Command',
    `XIC(SafetyOK)[XIC(Status.State[1]) XIC(${name}ManMoveTrig) ,XIO(Status.State[1]) ${autoStateGate}]` +
    `XIC(${axisTag}.ServoActionStatus)XIC(${axisTag}.AxisHomedStatus)XIC(${name}Permissive)` +
    `MAM(${axisTag},${name}_MAM,${mp}.MoveType,${mp}.Position,${mp}.Speed,Units per sec,${mp}.Accel,Units per sec2,${mp}.Decel,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);`));

  // Rung 16 — Stop on permissive lost
  rungs.push(buildRung(n++, 'Stop axis if permissive turns off while in motion and use max or close to max decel value',
    `XIO(${axisTag}.MotionStatus.0)[XIO(${name}Permissive) ,XIO(SafetyOK) ]MAS(${axisTag},${name}_MAS_All,All,Yes,90,% of Maximum,Yes,90,% of Maximum);`));

  // Rungs 17, 18 — Torque set (+ / -)
  rungs.push(buildRung(n++, 'Set torque',
    `XIC(${hmi}.Control.SetTorquePos)MOVE(${hmi}.Parameters.TorquePos,${axisTag}.TorqueLimitPositive);`));
  rungs.push(buildRung(n++, null,
    `XIC(${hmi}.Control.SetTorqueNeg)MOVE(${hmi}.Parameters.TorqueNeg,${axisTag}.TorqueLimitNegative);`));

  // Rung 19 — Retrieve values from axis → HMI status
  rungs.push(buildRung(n++, 'Retrieve values from axis',
    `MOVE(${axisTag}.ActualPosition,${hmi}.Status.ActualPosition)MOVE(${axisTag}.ActualVelocity,${hmi}.Status.ActualVelocity)MOVE(${axisTag}.TorqueReferenceFiltered,${hmi}.Status.ActualTorque);`));

  // Rung 20 — GSV max values (first-scan)
  rungs.push(buildRung(n++, 'Retrieve the max values from the drive and adjust them for your application if necessary with math instructions',
    `XIC(S:FS)GSV(Axis,${axisTag},MaximumAcceleration,${hmi}.Status.MaxAccel)GSV(Axis,${axisTag},MaximumDeceleration,${hmi}.Status.MaxDecel)GSV(Axis,${axisTag},MaximumSpeed,${hmi}.Status.MaxVelocity);`));

  // Rung 21 — Position Monitor (AOI_RangeCheck per declared position)
  if (positions.length > 0) {
    const rcBranches = positions.map((pos, i) => {
      const posIdx = pos.positionIndex ?? i;
      const rcTag = `${name}${pos.name.replace(/[^A-Za-z0-9]/g, '')}`;
      return `AOI_RangeCheck(${rcTag},${hmi}.Parameters.Positions[${posIdx}],0.5,${hmi}.Status.ActualPosition,5) `;
    }).join(',');
    rungs.push(buildRung(n++, 'Axis Position Monitor', `[${rcBranches}];`));
  }

  return `
<Routine Name="${routineName}" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

function generateR04ServoRoutines(sm, orderedNodes, stepMap) {
  const servos = (sm.devices ?? []).filter(d => d.type === 'ServoAxis');
  if (servos.length === 0) return '';

  // Engineer convention: R04_{axis1}Servo, R05_{axis2}Servo, R06_{axis3}Servo, ... consecutive.
  // Recovery routine is placed at R{4+N} after all servo routines.
  const routines = servos.map((dev, idx) => {
    const num = String(4 + idx).padStart(2, '0');
    return generateServoAxisRoutine(`R${num}_${dev.name}Servo`, dev, sm, orderedNodes, stepMap);
  });

  return routines.join('\n');
}

// AOI_RangeCheck instance tags — emitted per ServoAxis declared position.
// Called from generateAllTags so tags land with other program-scope declarations.
function generateServoRangeCheckTags(sm) {
  const servos = (sm.devices ?? []).filter(d => d.type === 'ServoAxis');
  const xmls = [];
  for (const dev of servos) {
    for (const pos of (dev.positions ?? [])) {
      const rcTag = `${dev.name}${pos.name.replace(/[^A-Za-z0-9]/g, '')}`;
      xmls.push(buildRangeCheckTagXml(rcTag, `${dev.displayName ?? dev.name} - ${pos.name} position check`));
    }
  }
  return xmls.join('');
}

// ── Recovery routine ─────────────────────────────────────────────────────────
//
// Executes the recovery sequence (states 100–121) when a fault occurs.
// Entry: State 127 (fault) → State 100 (first recovery action).
// Transitions through recovery nodes with verify conditions, then returns
// to State 2 (Auto Idle) when the last recovery action completes.
// Runs after R02 in R00_Main, so its MOVE wins over R02's 127→2 rung.
// Routine number is dynamic — placed at R{4+servoCount} to sit after R04..RN
// servo routines (e.g. 0 servos → R04_Recovery, 2 servos → R06_Recovery).

function generateRecoveryRoutine(sm, allSMs = [], trackingFields = []) {
  const servoCount = (sm.devices ?? []).filter(d => d.type === 'ServoAxis').length;
  const num = String(4 + servoCount).padStart(2, '0');
  const routineName = `R${num}_Recovery`;

  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];

  const recSeq = (sm.recoverySeqs ?? [])[0];
  const recNodes = recSeq?.nodes ?? [];
  const recEdges = recSeq?.edges ?? [];

  if (recNodes.length === 0) {
    rungs.push(buildRung(rungNum++, 'No recovery sequence configured — manual FaultReset returns to State 2', 'NOP();'));
    return `
<Routine Name="${routineName}" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
  }

  const orderedRecNodes = orderNodes(recNodes, recEdges);
  const recStepMap = buildRecoveryStepMap(orderedRecNodes, devices);
  const firstStep = recStepMap[orderedRecNodes[0].id];

  rungs.push(
    buildRung(rungNum++, `Recovery Entry: Fault (127) → State ${firstStep}`,
      `XIC(Status.State[127])MOVE(${firstStep},Control.StateReg);`)
  );

  for (let i = 0; i < orderedRecNodes.length; i++) {
    const srcNode = orderedRecNodes[i];
    const srcStep = recStepMap[srcNode.id];
    const isLast = i === orderedRecNodes.length - 1;
    const tgtStep = isLast ? 2 : recStepMap[orderedRecNodes[i + 1].id];

    const conditions = buildVerifyConditions(srcNode, devices, allSMs, trackingFields);
    const label = srcNode.data?.label ?? `Recovery ${i + 1}`;
    const destDesc = isLast ? 'State 2 (Auto Idle — recovery complete)' : `State ${tgtStep}`;

    rungs.push(
      buildRung(rungNum++, `${label} → ${destDesc}`,
        `XIC(Status.State[${srcStep}])${conditions}MOVE(${tgtStep},Control.StateReg);`)
    );
  }

  return `
<Routine Name="${routineName}" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── Program XML export (no Controller wrapper) ──────────────────────────────

export function exportProgramXml(sm, allSMs = [], trackingFields = [], machineConfig = null) {
  if (!sm) throw new Error('No state machine provided');

  const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
  const orderedNodes = orderNodes(sm.nodes ?? [], sm.edges ?? []);
  const stepMap = buildStepMap(orderedNodes, sm.devices ?? []);

  // Merge caller-provided PT fields with this SM's auto-derived PT table
  const effectiveTrackingFields = buildEffectiveTrackingFields(sm, stepMap, trackingFields);

  const servoCount = (sm.devices ?? []).filter(d => d.type === 'ServoAxis').length;

  const tagsXml = generateAllTags(sm, orderedNodes, stepMap, effectiveTrackingFields);
  const rangeCheckTags = generateServoRangeCheckTags(sm);
  const r00 = generateR00Main(sm);
  const r01 = generateR01Inputs(sm);
  const r02 = generateR02StateTransitions(sm, orderedNodes, stepMap, allSMs, effectiveTrackingFields, machineConfig);
  const r03 = generateR03StateLogic(sm, orderedNodes, stepMap, allSMs, effectiveTrackingFields);
  // Per-axis servo routines (engineer convention): R04_{axis1}Servo, R05_{axis2}Servo, ...
  // orderedNodes + stepMap let rungs 14/15 bind flowchart ServoMove states to MAM.
  const r04Servos = generateR04ServoRoutines(sm, orderedNodes, stepMap);
  // Recovery routine — placed at R{4+servoCount} to sit after all servo routines.
  const recovery = generateRecoveryRoutine(sm, allSMs, effectiveTrackingFields);
  const r20 = generateR20Alarms(sm, orderedNodes, stepMap);

  const stationDesc = `S${String(sm.stationNumber ?? 0).padStart(2, '0')} ${sm.description ?? sm.name ?? ''}`;

  return `<Program Use="Target" Name="${programName}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata(`${stationDesc} - Auto-generated by SDC State Logic Builder`)}
</Description>
<Tags>
${tagsXml}
${rangeCheckTags}
</Tags>
<Routines>
${r00}
${r01}
${r02}
${r03}
${r04Servos}
${recovery}
${r20}
</Routines>
</Program>`;
}

// ── Main export function ─────────────────────────────────────────────────────

export function exportToL5X(sm, allSMs = [], trackingFields = [], machineConfig = null) {
  if (!sm) throw new Error('No state machine provided');

  const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
  const servoDevices = (sm.devices ?? []).filter(d => d.type === 'ServoAxis');
  const hasServos = servoDevices.length > 0;
  const hasAnalogSensors = (sm.devices ?? []).some(d => d.type === 'AnalogSensor');
  const robotDevices = (sm.devices ?? []).filter(d => d.type === 'Robot');
  const digitalSensorDevices = (sm.devices ?? []).filter(d => d.type === 'DigitalSensor');
  const hasDebouncedSensors = digitalSensorDevices.length > 0;
  const needsRangeCheck = hasServos || hasAnalogSensors;

  // UDT needs the merged field list (global + derived from this SM's PT table)
  const orderedNodes = orderNodes(sm.nodes ?? [], sm.edges ?? []);
  const stepMap = buildStepMap(orderedNodes, sm.devices ?? []);
  const effectiveTrackingFields = buildEffectiveTrackingFields(sm, stepMap, trackingFields);

  const programXml = exportProgramXml(sm, allSMs, trackingFields, machineConfig);
  const dataTypes = generateDataTypes(hasServos, effectiveTrackingFields, robotDevices);
  const aoi = generateAOI(needsRangeCheck, robotDevices.length > 0, hasDebouncedSensors);

  // SDC Guide §15.11: per-project overrides from project.machineConfig.
  const softwareRevision = machineConfig?.softwareRevision ?? SOFTWARE_REV;
  const controllerName = machineConfig?.controllerName ?? CONTROLLER_NAME;

  // SDC Guide §15.4: controller-scope tags (MotionGroup + AXIS_CIP_DRIVE per axis)
  // must precede the Programs block whenever any servo is present in this SM.
  const controllerTags = hasServos
    ? generateControllerTagsXml(sm, servoDevices)
    : '';

  const now = new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="${SCHEMA_REV}" SoftwareRevision="${softwareRevision}" TargetName="${programName}" TargetType="Program" TargetClass="Standard" ContainsContext="true" ExportDate="${now}" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">
<Controller Use="Context" Name="${controllerName}">
${dataTypes}
${aoi}
${controllerTags}
<Programs Use="Context">
${programXml}
</Programs>
</Controller>
</RSLogix5000Content>`;
}

// ── Controller-scope Tags (SDC Guide §15.4) ──────────────────────────────────
//
// Emits a MotionGroup tag plus one AXIS_CIP_DRIVE tag per servo device.
// Engineer convention: axis tag = `a{NN}_{name}` (no station infix).
// Program-scope code references these via iq_{name} InOut parameters.
// AxisParameters are SDC defaults — CE tunes motor catalog / scaling / limits
// post-export.
function generateControllerTagsXml(sm, servoDevices) {
  // Per-axis default AxisParameters block. Attributes match the structure of
  // a newly-created AXIS_CIP_DRIVE; numeric values (motor specs, tuning) are
  // left as Rockwell defaults and CE reconfigures after import.
  const axisTags = servoDevices.map(dev => {
    const axisNum = String(dev.axisNumber ?? 1).padStart(2, '0');
    const axisTagName = `a${axisNum}_${dev.name}`;
    const moduleName = `sd${axisNum}_${dev.name}`;
    return `<Tag Name="${escapeXml(axisTagName)}" Class="Standard" TagType="Base" DataType="AXIS_CIP_DRIVE" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="Axis">
<AxisParameters MotionGroup="MotionGroup" MotionModule="${escapeXml(moduleName)}:Ch1" AxisConfiguration="Position Loop" FeedbackConfiguration="Motor Feedback" MotorDataSource="Database" ConversionConstant="10000.0" OutputCamExecutionTargets="0" PositionUnits="mm" AverageVelocityTimebase="0.25" PositionUnwind="1000000" HomeMode="Active" HomeDirection="Bi-directional Forward" HomeSequence="Immediate" HomeConfigurationBits="16#0000_0000" HomePosition="0.0" HomeOffset="0.0" HomeSpeed="0.0" HomeReturnSpeed="0.0" MaximumSpeed="0.0" MaximumAcceleration="0.0" MaximumDeceleration="0.0" ProgrammedStopMode="Fast Stop" AxisUpdateSchedule="Base" ScalingSource="From Calculator" LoadType="Linear Actuator" ActuatorType="Screw" TravelMode="Limited" PositionScalingNumerator="1.0" PositionScalingDenominator="1.0" TravelRange="1000.0" MotionResolution="10000" MotionPolarity="Normal"/>
</Data>
</Tag>`;
  }).join('\n');

  return `<Tags Use="Context">
${axisTags}
<Tag Name="MotionGroup" Class="Standard" TagType="Base" DataType="MOTION_GROUP" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="MotionGroup">
<MotionGroupParameters CoarseUpdatePeriod="2000" PhaseShift="0" GeneralFaultType="Non Major Fault" AutoTagUpdate="Enabled" Alternate1UpdateMultiplier="1" Alternate2UpdateMultiplier="1"/>
</Data>
</Tag>
</Tags>`;
}

// ── Download helpers ─────────────────────────────────────────────────────────

export function downloadL5X(sm, allSMs = [], trackingFields = [], machineConfig = null) {
  const xml = exportToL5X(sm, allSMs, trackingFields, machineConfig);
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
 * Export multiple SMs as a single ZIP file containing one .L5X per SM.
 * Minimal ZIP implementation — no external dependencies.
 */
export async function downloadAllL5XAsZip(stateMachines, trackingFields = [], project = null) {
  const files = [];
  for (const sm of stateMachines) {
    if ((sm.nodes ?? []).length === 0) continue;
    const name = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
    const xml = exportToL5X(sm, stateMachines, trackingFields, project?.machineConfig ?? null);
    files.push({ name: `${name}.L5X`, content: xml });
  }

  // Generate Supervisor program if project data is available
  if (project && (project.machineConfig?.stations ?? []).length > 0) {
    try {
      const { exportSupervisorL5X } = await import('./supervisorL5xExporter.js');
      const supervisorXml = exportSupervisorL5X(project);
      files.push({ name: 'Supervisor.L5X', content: supervisorXml });
    } catch (err) {
      console.warn('Supervisor generation failed:', err);
    }
  }

  if (files.length === 0) return;

  const zipBlob = buildZipBlob(files);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'SDC_StateMachines.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Minimal ZIP builder (no dependencies) ────────────────────────────────────

export function buildZipBlob(files) {
  const enc = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const dataBytes = enc.encode(file.content);
    const crc = crc32(dataBytes);

    // Local file header (30 bytes + name + data)
    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // signature
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0, true);             // flags
    lv.setUint16(8, 0, true);             // compression: stored
    lv.setUint16(10, 0, true);            // mod time
    lv.setUint16(12, 0, true);            // mod date
    lv.setUint32(14, crc, true);          // crc-32
    lv.setUint32(18, dataBytes.length, true); // compressed size
    lv.setUint32(22, dataBytes.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // file name length
    lv.setUint16(28, 0, true);            // extra field length
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);    // signature
    cv.setUint16(4, 20, true);            // version made by
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, 0, true);             // flags
    cv.setUint16(10, 0, true);            // compression
    cv.setUint16(12, 0, true);            // mod time
    cv.setUint16(14, 0, true);            // mod date
    cv.setUint32(16, crc, true);          // crc-32
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);            // extra length
    cv.setUint16(32, 0, true);            // comment length
    cv.setUint16(34, 0, true);            // disk number start
    cv.setUint16(36, 0, true);            // internal attrs
    cv.setUint32(38, 0, true);            // external attrs
    cv.setUint32(42, offset, true);       // local header offset
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  // End of central directory record (22 bytes)
  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localHeaders, ...centralHeaders, endRecord], { type: 'application/zip' });
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export async function exportProjectJSON(project) {
  const json = JSON.stringify(project, null, 2);
  const fileName = `${project.name ?? 'project'}.json`;

  // Electron desktop app: use native dialog via IPC (avoids showSaveFilePicker
  // createWritable() bug where the file is created but written as 0 KB).
  // After the first save we cache the chosen path in localStorage so subsequent
  // saves write directly — no dialog, no "replace?" prompt.
  if (window.electronAPI?.saveFile) {
    const cacheKey = `savePath_${project.id ?? project.name}`;
    const cachedPath = localStorage.getItem(cacheKey);

    if (cachedPath) {
      // Known path — overwrite directly, no dialog
      const result = await window.electronAPI.saveFileDirect(cachedPath, json);
      if (result.success) return;
      // If direct write failed (e.g. file moved), fall through to show dialog again
      localStorage.removeItem(cacheKey);
    }

    // First save or path no longer valid — show dialog once, cache the result
    const result = await window.electronAPI.saveFile(fileName, json);
    if (result.success && result.filePath) {
      localStorage.setItem(cacheKey, result.filePath);
    }
    return;
  }

  // Browser: use File System Access API — remembers last folder between saves.
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled — do nothing
      // Any other error: fall through to legacy download below
    }
  }

  // Fallback for browsers without showSaveFilePicker
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
