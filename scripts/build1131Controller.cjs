#!/usr/bin/env node
'use strict';
/**
 * build1131Controller.cjs — JOB 1131 CONTROLLER-SCOPE PIECES (2026-09-28)
 *
 * Emits generated/1131/build/controller/{00_header,DataTypes,Modules,AddOnInstructionDefinitions,ControllerTags,Tasks,
 * ParameterConnections}.xml and copies the three carried-verbatim programs (SafetyProgramLoader, SafetyProgramUnloader,
 * Communications) into generated/1131/build/programs/, all with the NAMES CONTRACT renames applied.
 *
 * Sources
 *   generated/1131/ref/Tarkett_092826/   John Stanko's import-proven export (hardware layer, axes, safety, buffers)
 *   generated/1131/ref/Template/         SoftwareStandardizationNew.L5X (UDTs, AOIs, g_ globals, Recipe)
 *   generated/1131/build/CONTRACT.json   task schedule
 *   generated/1131/build/programs/*.connections.xml   builder-delivered <ParameterConnection> fragments (optional)
 *
 * Run: node scripts/build1131Controller.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const REF = path.join(ROOT, 'generated/1131/ref/Tarkett_092826');
const TPL = path.join(ROOT, 'generated/1131/ref/Template');
const BUILD = path.join(ROOT, 'generated/1131/build');
const CTRL = path.join(BUILD, 'controller');
const PROGS = path.join(BUILD, 'programs');
fs.mkdirSync(CTRL, { recursive: true });
fs.mkdirSync(PROGS, { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const write = (p, s) => { fs.writeFileSync(p, s, 'utf8'); console.log(`  wrote ${path.relative(ROOT, p)} (${s.length} bytes)`); };

// ── NAMES CONTRACT §3/§4 renames (old → new). Applied as whole identifiers; _IN/_OUT/EIP suffixes follow the base. ──
const RENAMES = [
  ['sd01_Loader_PNPXAxis', 'sd01_InfeedGantryXAxis'], ['sd02_Loader_PNPZAxis', 'sd02_InfeedGantryZAxis'],
  ['sd03_Unloader_PNPXAxis', 'sd03_OutfeedGantryXAxis'], ['sd04_Unloader_PNPZAxis', 'sd04_OutfeedGantryZAxis'],
  ['sd05_Unloader_Conveyor', 'sd05_OutfeedBelt'], ['sd06_LoaderCartXaxis', 'sd06_InfeedCartYAxis'],
  ['sd07_UnloaderCartXaxis', 'sd07_OutfeedCartYAxis'], ['sd08_InfeedServoCamera', 'sd08_InfeedCameraRAxis'],
  ['io01_loader', 'io01_InfeedPointIO'],
  ['vb01_LoaderCart', 'vb01_InfeedCartValves'], ['vb02_Inspection', 'vb02_GaugeValves'],
  ['vb03_UnloaderCart', 'vb03_OutfeedCartValves'], ['vb03_UnLoaderCart', 'vb03_OutfeedCartValves'],
  ['vb04_LoaderGantry', 'vb04_InfeedGantryValves'], ['vb05_UnLoaderGantry', 'vb05_OutfeedGantryValves'], ['vb05_UnloaderGantry', 'vb05_OutfeedGantryValves'],
  ['cam01_InfeedCamera', 'cam01_InfeedCamera'], ['cam02_OutfeedCamera', 'cam02_OutfeedCamera'],
  ['cam01_infeed', 'cam01_InfeedCamera'], ['cam02_outfeed', 'cam02_OutfeedCamera'],
  ['fd01_Infeed_Conveyor', 'fd01_InfeedBelt'],
  ['a01_LoaderPNPXAxis', 'a01_InfeedGantryXAxis'], ['a02_LoaderPNPZAxis', 'a02_InfeedGantryZAxis'],
  ['a03_UnloaderConveyor', 'a03_OutfeedBeltAxis'], ['a04_UnloaderPNPXAxis', 'a04_OutfeedGantryXAxis'],
  ['a05_UnloaderPNPZAxis', 'a05_OutfeedGantryZAxis'], ['a06_LoaderCartXAxis', 'a06_InfeedCartYAxis'],
  ['a07_UnloaderCartXAxis', 'a07_OutfeedCartYAxis'], ['a08_InfeedServoCamera', 'a08_InfeedCameraRAxis'],
];
function rename(s) {
  for (const [o, n] of RENAMES) {
    if (o === n) continue;
    const re = new RegExp(`(?<![A-Za-z0-9_])${o}(?=_IN\\b|_OUT\\b|EIP\\b|[^A-Za-z0-9_]|$)`, 'g');
    s = s.replace(re, n);
  }
  return s;
}

// ── helpers over section XML ────────────────────────────────────────────────
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*?\\sName="([^"]+)"[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'))].map((m) => ({ name: m[1], xml: m[0] }));
// <Tag ... /> self-closing OR <Tag ...>...</Tag>; Name is the first attribute in Studio exports
const tagBlocks = (xml) => [...xml.matchAll(/<Tag\s+Name="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/Tag>)/g)].map((m) => ({ name: m[1], xml: m[0] }));
const pick = (list, names) => names.map((n) => { const b = list.find((x) => x.name === n); if (!b) throw new Error(`missing ${n}`); return b.xml; });

const refHeader = read(path.join(REF, '00_header.xml'));
const refDT = blocks(read(path.join(REF, 'DataTypes.xml')), 'DataType');
const tplDT = blocks(read(path.join(TPL, 'DataTypes.xml')), 'DataType');
const refAOI = blocks(read(path.join(REF, 'AddOnInstructionDefinitions.xml')), 'AddOnInstructionDefinition');
const tplAOI = blocks(read(path.join(TPL, 'AddOnInstructionDefinitions.xml')), 'AddOnInstructionDefinition');
const refTags = tagBlocks(read(path.join(REF, 'ControllerTags.xml')));
const tplTags = tagBlocks(read(path.join(TPL, 'ControllerTags.xml')));
const refModules = read(path.join(REF, 'Modules.xml'));
const refTasks = read(path.join(REF, 'Tasks.xml'));
const contract = JSON.parse(read(path.join(BUILD, 'CONTRACT.json')));

// 1. header — John's controller attributes + SafetyTagMap, stamped today
const now = new Date();
const stamp = now.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, (m, d, mo, day, y) => `${d} ${mo} ${day} ${now.toTimeString().slice(0, 8)} ${y}`);
let header = refHeader.replace(/ExportDate="[^"]*"/, `ExportDate="${stamp}"`).replace(/LastModifiedDate="[^"]*"/, `LastModifiedDate="${stamp}"`);
write(path.join(CTRL, '00_header.xml'), header.trim() + '\n');

// 2. DataTypes — template set that 1131 uses (template version wins) + John's Keyence VS family, in source order
const TPL_UDTS = ['AlarmData', 'AlarmHistory', 'ConsecFails', 'CPU_TimeDate', 'DisplayListControl', 'MachineBasic', 'MAMParam', 'ProductionData',
  'Recipe_Control', 'Recipe_Data', 'Recipe_Structure', 'ServoMomentary', 'ServoOverall', 'ServoParameters', 'ServoStatus', 'StateLogicControl',
  'StateLogicStatus', 'STRING100', 'string20', 'STRING30', 'TopAlarmsDT'];
const REF_UDTS = ['VS_Status', 'VS_CommandResponse', 'VS_InspectionResults', 'VS_Control', 'VS_CommandRequest', 'VS_InspectionParameters', 'VS_I', 'VS_O'];
const tplOrder = tplDT.filter((d) => TPL_UDTS.includes(d.name)).map((d) => d.xml);
const refOrder = refDT.filter((d) => REF_UDTS.includes(d.name)).map((d) => d.xml);
for (const n of TPL_UDTS) if (!tplDT.find((d) => d.name === n)) throw new Error(`template UDT ${n} missing`);
for (const n of REF_UDTS) if (!refDT.find((d) => d.name === n)) throw new Error(`job UDT ${n} missing`);
write(path.join(CTRL, 'DataTypes.xml'), `<DataTypes>\n${[...tplOrder, ...refOrder].join('\n')}\n</DataTypes>\n`);

// 3. Modules — John's verbatim, renamed
write(path.join(CTRL, 'Modules.xml'), rename(refModules).trim() + '\n');

// 4. AOIs — template set used by services + stations, plus John's ifm laser decode
const TPL_AOIS = ['AOI_Debounce', 'AOI_EIPStatus', 'AOI_MachineBasic', 'AOI_RangeCheck', 'AOI_TorqueHome', 'CPU_TimeDate_wJulian', 'LightControl',
  'MovingAverage', 'OEE', 'ProgramAlarmHandler', 'State_Engine_128Max', 'TopAlarms'];
const REF_AOIS = ['O1D100_Decode'];
write(path.join(CTRL, 'AddOnInstructionDefinitions.xml'), `<AddOnInstructionDefinitions>\n${[...pick(tplAOI, TPL_AOIS), ...pick(refAOI, REF_AOIS).map(rename)].join('\n')}\n</AddOnInstructionDefinitions>\n`);

// 5. Controller tags
const STATION_LIST = ['Supervisor: ', 'S01 Infeed Cart: ', 'S02 Infeed Vision: ', 'S03 Infeed Gantry: ', 'S04 Infeed Conveyor: ',
  'S05 Outfeed Conveyor: ', 'S06 Outfeed Vision: ', 'S07 Outfeed Gantry: ', 'S08 Thickness Gauge: ', 'S09 Outfeed Cart: '];
function stringArrayTag(name, values, desc) {
  const pad = (s) => { const b = s.length; return `[${b},'${s}${'$00'.repeat(82 - b)}']`; };
  const l5k = `[${values.map(pad).join(',')}]`;
  const dec = values.map((v, i) => `<Element Index="[${i}]">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${v.length}"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII"><![CDATA['${v}']]></DataValueMember>\n</Structure>\n</Element>`).join('\n');
  return `<Tag Name="${name}" TagType="Base" DataType="STRING" Dimensions="${values.length}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Description>\n<![CDATA[${desc}]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[${l5k}]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="${values.length}" Radix="ASCII">\n${dec}\n</Array>\n</Data>\n</Tag>`;
}
function realTag(name, desc) {
  return `<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Description>\n<![CDATA[${desc}]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[0.0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="REAL" Radix="Float" Value="0.0"/>\n</Data>\n</Tag>`;
}
const AXES = ['a01_LoaderPNPXAxis', 'a02_LoaderPNPZAxis', 'a03_UnloaderConveyor', 'a04_UnloaderPNPXAxis', 'a05_UnloaderPNPZAxis', 'a06_LoaderCartXAxis', 'a07_UnloaderCartXAxis', 'a08_InfeedServoCamera'];
const BUFFERS = ['vb01_LoaderCart_IN', 'vb01_LoaderCart_OUT', 'vb02_Inspection_IN', 'vb02_Inspection_OUT', 'vb03_UnloaderCart_IN', 'vb03_UnLoaderCart_OUT',
  'vb04_LoaderGantry_IN', 'vb04_LoaderGantry_OUT', 'vb05_UnLoaderGantry_IN', 'vb05_UnloaderGantry_OUT',
  'cam01_InfeedCamera_IN', 'cam01_InfeedCamera_OUT', 'cam02_OutfeedCamera_IN', 'cam02_OutfeedCamera_OUT'];
const SAFETY_MAP_STD = ['g_OperatorBypassActive', 'g_LoaderExitDoorOpen', 'g_LoaderEntryDoorOpen', 'g_UnloaderAxesEnablePermissive', 'g_LoaderAxesEnablePermissive',
  'g_loaderMotionStopped', 'g_UnloaderMotionStopped', 'g_unloaderExit_RequestToEnter', 'g_UnloaderEntry_RequestToEnter', 'g_LoaderEntry_RequestToEnter',
  'g_LoaderExit_RequestToEnter', 'g_MuteInfeedLightcurtains'];
const safetyClass = refTags.filter((t) => /\sClass="Safety"/.test(t.xml)).map((t) => t.name);
const tplGlobals = ['g_MachineBasic', 'g_CPUDateTime', 'g_HMI_DryRun', 'g_PresetStationPerformLow', 'g_PresetStationPerformHigh', 'Recipe'];
const tags = [
  ...pick(tplTags, tplGlobals),
  stringArrayTag('g_StationList', STATION_LIST, 'Station names for alarm text'),
  realTag('io01_InfeedStackHeight_IN', 'Infeed stack height mm'),
  ...pick(refTags, AXES).map(rename),
  ...pick(refTags, ['MotionGroup']),
  ...pick(refTags, BUFFERS).map(rename),
  ...pick(refTags, SAFETY_MAP_STD),
  ...pick(refTags, safetyClass),
];
write(path.join(CTRL, 'ControllerTags.xml'), `<Tags>\n${tags.join('\n')}\n</Tags>\n`);

// 6. Tasks — from the contract, John's task attributes
const mainAttrs = (refTasks.match(/<Task\s+Name="MainTask"[^>]*>/) || [])[0];
const safeAttrs = (refTasks.match(/<Task\s+Name="SafetyTask"[^>]*>/) || [])[0];
const sched = (list) => `<ScheduledPrograms>\n${list.map((p) => `<ScheduledProgram Name="${p}"/>`).join('\n')}\n</ScheduledPrograms>`;
write(path.join(CTRL, 'Tasks.xml'), `<Tasks>\n${mainAttrs}\n${sched(contract.mainTask)}\n</Task>\n${safeAttrs}\n${sched(contract.safetyTask)}\n</Task>\n</Tasks>\n`);

// 7. ParameterConnections — axes + Supervisor operator stations + builder fragments
const AXIS_CONN = [
  ['\\S01_InfeedCart.iq_YAxis', 'a06_InfeedCartYAxis'], ['\\S02_InfeedVision.iq_RAxis', 'a08_InfeedCameraRAxis'],
  ['\\S03_InfeedGantry.iq_XAxis', 'a01_InfeedGantryXAxis'], ['\\S03_InfeedGantry.iq_ZAxis', 'a02_InfeedGantryZAxis'],
  ['\\S05_OutfeedConveyor.iq_BeltAxis', 'a03_OutfeedBeltAxis'],
  ['\\S07_OutfeedGantry.iq_XAxis', 'a04_OutfeedGantryXAxis'], ['\\S07_OutfeedGantry.iq_ZAxis', 'a05_OutfeedGantryZAxis'], ['\\S07_OutfeedGantry.iq_BeltAxis', 'a03_OutfeedBeltAxis'],
  ['\\S09_OutfeedCart.iq_YAxis', 'a07_OutfeedCartYAxis'],
];
const conn = (a, b) => `<ParameterConnection EndPoint1="${a}" EndPoint2="${b}"/>`;
const frags = fs.existsSync(PROGS) ? fs.readdirSync(PROGS).filter((f) => f.endsWith('.connections.xml')).sort() : [];
const fragLines = frags.flatMap((f) => read(path.join(PROGS, f)).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('<ParameterConnection')));
const allConn = [...AXIS_CONN.map(([a, b]) => conn(a, b)), ...fragLines];
const seen = new Set(); const dedup = allConn.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
write(path.join(CTRL, 'ParameterConnections.xml'), `<ParameterConnections>\n${dedup.join('\n')}\n</ParameterConnections>\n`);
console.log(`  connections: ${AXIS_CONN.length} axis + ${fragLines.length} from ${frags.length} fragment(s) → ${dedup.length}`);

// 8. Carried-verbatim programs (renamed): both safety programs, Communications
for (const p of ['SafetyProgramLoader', 'SafetyProgramUnloader', 'Communications']) {
  const src = read(path.join(REF, `Program_${p}.xml`));
  write(path.join(PROGS, `${p}.xml`), rename(src).trim() + '\n');
}
console.log('build1131Controller: done');
