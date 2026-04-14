/**
 * Controller L5X Exporter
 *
 * Generates a complete Allen Bradley controller L5X file containing:
 *  - All station programs (from l5xExporter)
 *  - Supervisor program (from supervisorL5xExporter)
 *  - Shell programs: MapInputs, MapOutputs, HMI, Production
 *  - Alarms program (centralized alarm aggregation)
 *  - RecipeManager program (if recipes configured)
 *  - MainTask with directly scheduled programs (no MainProgram)
 *  - Shared DataTypes (including MachineBasic UDT) and AOIs
 *  - Controller-scoped tags: g_CPUDateTime, MotionGroup, MB, axis tags
 *
 * Task schedule order:
 *   1. MapInputs
 *   2. Supervisor
 *   3. (station programs in station number order)
 *   4. Production
 *   5. Alarms
 *   6. HMI
 *   7. MapOutputs
 *   8. RecipeManager (if exists)
 *
 * Usage:
 *   import { downloadControllerL5X } from './controllerL5xExporter.js';
 *   downloadControllerL5X(project);
 */

import {
  escapeXml,
  cdata,
  buildRung,
  buildBoolTagXml,
  buildDintTagXml,
  generateDataTypes,
  generateAOI,
  exportProgramXml,
  SCHEMA_REV,
  SOFTWARE_REV,
  CONTROLLER_NAME,
} from './l5xExporter.js';

import { exportSupervisorProgramXml } from './supervisorL5xExporter.js';
import { buildProgramName } from './tagNaming.js';

// ── Recipe UDT helpers ──────────────────────────────────────────────────────

/**
 * Scan all SMs to collect recipe-eligible parameters.
 * Returns array of { smName, deviceName, paramName, tagPath, defaultValue, memberName }
 *
 * Recipe parameters are:
 *  - Servo positions with isRecipe === true
 *  - Analog setpoints with isRecipe === true
 *  - Timer devices with overrides in any recipe
 *  - Any other parameters surfaced through recipeOverrides
 */
function collectRecipeParameters(project) {
  const params = [];
  const allSMs = project.stateMachines ?? [];

  for (const sm of allSMs) {
    const smClean = (sm.name ?? 'Unknown').replace(/[^a-zA-Z0-9]/g, '');
    const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unknown');

    for (const device of (sm.devices ?? [])) {
      const devClean = (device.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');

      if (device.type === 'ServoAxis') {
        for (const pos of (device.positions ?? [])) {
          if (!pos.isRecipe) continue;
          const posClean = (pos.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
          const memberName = `${smClean}_${devClean}_${posClean}`;
          // Tag path in the program: p_{deviceName}{posName}
          const tagPath = `\\${programName}.p_${device.name}${pos.name}`;
          params.push({
            smName: sm.name,
            deviceName: device.name,
            paramName: pos.name,
            memberName,
            tagPath,
            defaultValue: pos.defaultValue ?? 0.0,
            dataType: 'REAL',
          });
        }
      }

      if (device.type === 'AnalogSensor') {
        for (const sp of (device.setpoints ?? [])) {
          if (!sp.isRecipe) continue;
          const spClean = (sp.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
          const memberName = `${smClean}_${devClean}_${spClean}`;
          const tagPath = `\\${programName}.p_${device.name}${sp.name}`;
          params.push({
            smName: sm.name,
            deviceName: device.name,
            paramName: sp.name,
            memberName,
            tagPath,
            defaultValue: sp.defaultValue ?? 0.0,
            dataType: 'REAL',
          });
        }
      }
    }
  }

  // Also check recipeOverrides for timer/speed overrides
  const overrides = project.recipeOverrides ?? {};
  for (const [, recipeOv] of Object.entries(overrides)) {
    // Positions: { "smId:deviceId:posName": value }
    for (const key of Object.keys(recipeOv.positions ?? {})) {
      const parts = key.split(':');
      if (parts.length < 3) continue;
      const [smId, deviceId, posName] = parts;
      // Check if already captured via isRecipe
      if (params.some(p => p.memberName.endsWith(`_${posName.replace(/[^a-zA-Z0-9_]/g, '')}`))) continue;
      const sm = allSMs.find(s => s.id === smId);
      const device = sm ? (sm.devices ?? []).find(d => d.id === deviceId) : null;
      if (!sm || !device) continue;
      const smClean = (sm.name ?? 'Unknown').replace(/[^a-zA-Z0-9]/g, '');
      const devClean = (device.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
      const posClean = (posName ?? '').replace(/[^a-zA-Z0-9_]/g, '');
      const memberName = `${smClean}_${devClean}_${posClean}`;
      if (params.some(p => p.memberName === memberName)) continue;
      const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unknown');
      params.push({
        smName: sm.name,
        deviceName: device.name,
        paramName: posName,
        memberName,
        tagPath: `\\${programName}.p_${device.name}${posName}`,
        defaultValue: 0.0,
        dataType: 'REAL',
      });
    }

    // Timers: { "smId:deviceId": value }
    for (const key of Object.keys(recipeOv.timers ?? {})) {
      const parts = key.split(':');
      if (parts.length < 2) continue;
      const [smId, deviceId] = parts;
      const sm = allSMs.find(s => s.id === smId);
      const device = sm ? (sm.devices ?? []).find(d => d.id === deviceId) : null;
      if (!sm || !device) continue;
      const smClean = (sm.name ?? 'Unknown').replace(/[^a-zA-Z0-9]/g, '');
      const devClean = (device.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
      const memberName = `${smClean}_${devClean}_Timer`;
      if (params.some(p => p.memberName === memberName)) continue;
      const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unknown');
      params.push({
        smName: sm.name,
        deviceName: device.name,
        paramName: 'Timer',
        memberName,
        tagPath: `\\${programName}.${device.name}.PRE`,
        defaultValue: recipeOv.timers[key] ?? 0,
        dataType: 'DINT',
      });
    }

    // Speeds: { "smId:deviceId": value }
    for (const key of Object.keys(recipeOv.speeds ?? {})) {
      const parts = key.split(':');
      if (parts.length < 2) continue;
      const [smId, deviceId] = parts;
      const sm = allSMs.find(s => s.id === smId);
      const device = sm ? (sm.devices ?? []).find(d => d.id === deviceId) : null;
      if (!sm || !device) continue;
      const smClean = (sm.name ?? 'Unknown').replace(/[^a-zA-Z0-9]/g, '');
      const devClean = (device.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
      const memberName = `${smClean}_${devClean}_Speed`;
      if (params.some(p => p.memberName === memberName)) continue;
      const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unknown');
      params.push({
        smName: sm.name,
        deviceName: device.name,
        paramName: 'Speed',
        memberName,
        tagPath: `\\${programName}.${device.name}MotionParameters.Speed`,
        defaultValue: recipeOv.speeds[key] ?? 0.0,
        dataType: 'REAL',
      });
    }
  }

  return params;
}

/**
 * Generate Recipe_UDT XML with members for each recipe parameter.
 */
function generateRecipeUDT(recipeParams) {
  if (recipeParams.length === 0) return '';

  // Group BOOL-backed members need hidden SINTs, but recipe params are all REAL/DINT
  const members = recipeParams.map(p => {
    const dt = p.dataType === 'DINT' ? 'DINT' : 'REAL';
    const radix = dt === 'REAL' ? 'Float' : 'Decimal';
    return `<Member Name="${escapeXml(p.memberName)}" DataType="${dt}" Dimension="0" Radix="${radix}" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata(`${p.smName} / ${p.deviceName} / ${p.paramName}`)}
</Description>
</Member>`;
  });

  return `
<DataType Name="Recipe_UDT" Family="NoFamily" Class="User">
<Description>
${cdata('Recipe parameters - Auto-generated by SDC State Logic Builder')}
</Description>
<Members>
${members.join('\n')}
</Members>
</DataType>`;
}

/**
 * Generate controller-scoped recipe tags:
 *  - Recipes[N] array pre-populated with defaults
 *  - ActiveRecipeIndex (DINT)
 *  - ActiveRecipe (Recipe_UDT)
 *  - PrevRecipeIndex (DINT) for change detection
 */
function generateRecipeTags(project, recipeParams) {
  if (recipeParams.length === 0) return '';

  const recipes = project.recipes ?? [];
  const recipeCount = Math.max(recipes.length, 1);
  const overrides = project.recipeOverrides ?? {};

  const tags = [];

  // ActiveRecipeIndex
  tags.push(buildDintTagXml('ActiveRecipeIndex', 'Active recipe index - set by HMI', 0));

  // PrevRecipeIndex for change detection
  tags.push(buildDintTagXml('PrevRecipeIndex', 'Previous recipe index - for change detection', -1));

  // RecipeLoadTrigger
  tags.push(buildBoolTagXml('RecipeLoadTrigger', 'Recipe load trigger - one-shot', 'Local'));

  // ActiveRecipe instance
  tags.push(`
<Tag Name="ActiveRecipe" TagType="Base" DataType="Recipe_UDT" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Currently active recipe parameters')}
</Description>
</Tag>`);

  // Recipes array tag with pre-populated default values
  // Build decorated data for each recipe slot
  const recipeElements = [];
  for (let i = 0; i < recipeCount; i++) {
    const recipe = recipes[i];
    const recipeId = recipe?.id;
    const recipeOv = recipeId ? (overrides[recipeId] ?? {}) : {};

    const memberValues = recipeParams.map(p => {
      // Check if this recipe has an override for this parameter
      let value = p.defaultValue;

      if (recipeOv.positions) {
        // Look for matching position override
        for (const [key, val] of Object.entries(recipeOv.positions)) {
          if (key.endsWith(`:${p.paramName}`)) {
            value = val;
            break;
          }
        }
      }
      if (recipeOv.timers && p.paramName === 'Timer') {
        for (const [, val] of Object.entries(recipeOv.timers)) {
          value = val;
          break;
        }
      }
      if (recipeOv.speeds && p.paramName === 'Speed') {
        for (const [, val] of Object.entries(recipeOv.speeds)) {
          value = val;
          break;
        }
      }

      const dt = p.dataType === 'DINT' ? 'DINT' : 'REAL';
      const radix = dt === 'REAL' ? 'Float' : 'Decimal';
      const formattedVal = dt === 'REAL' ? Number(value).toFixed(6) : String(Math.round(value));
      return `<DataValueMember Name="${escapeXml(p.memberName)}" DataType="${dt}" Radix="${radix}" Value="${formattedVal}"/>`;
    });

    recipeElements.push(`<Element Index="[${i}]">
<Structure DataType="Recipe_UDT">
${memberValues.join('\n')}
</Structure>
</Element>`);
  }

  tags.push(`
<Tag Name="Recipes" TagType="Base" DataType="Recipe_UDT" Dimensions="${recipeCount}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Recipe array - one slot per product variant')}
</Description>
<Data Format="Decorated">
<Array DataType="Recipe_UDT" Dimensions="${recipeCount}">
${recipeElements.join('\n')}
</Array>
</Data>
</Tag>`);

  return tags.join('\n');
}

/**
 * Generate RecipeManager program with R00_RecipeLoad routine.
 * Detects ActiveRecipeIndex change, COPs from array to ActiveRecipe,
 * then MOVes each parameter to its target tag.
 */
function generateRecipeManagerProgram(recipeParams, recipeCount) {
  if (recipeParams.length === 0) return '';

  const rungs = [];
  let rungNum = 0;

  // Rung 0: Detect recipe index change
  rungs.push(buildRung(rungNum++,
    'Detect recipe index change',
    'NEQ(ActiveRecipeIndex,PrevRecipeIndex) OTE(RecipeLoadTrigger);'));

  // Rung 1: COP recipe from array to ActiveRecipe
  rungs.push(buildRung(rungNum++,
    'Copy selected recipe to ActiveRecipe',
    `XIC(RecipeLoadTrigger) COP(Recipes[ActiveRecipeIndex],ActiveRecipe,1);`));

  // Rung 2+: MOV each parameter from ActiveRecipe to target tag
  for (const p of recipeParams) {
    const srcMember = `ActiveRecipe.${p.memberName}`;
    const destTag = p.tagPath;
    rungs.push(buildRung(rungNum++,
      `Load ${p.smName} / ${p.deviceName} / ${p.paramName}`,
      `XIC(RecipeLoadTrigger) MOV(${srcMember},${destTag});`));
  }

  // Final rung: Update PrevRecipeIndex
  rungs.push(buildRung(rungNum++,
    'Update previous recipe index',
    'MOV(ActiveRecipeIndex,PrevRecipeIndex);'));

  return `<Program Name="RecipeManager" TestEdits="false" MainRoutineName="R00_RecipeLoad" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata('Recipe Manager - Loads recipe parameters on index change - Auto-generated by SDC State Logic Builder')}
</Description>
<Tags>
</Tags>
<Routines>
<Routine Name="R00_RecipeLoad" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>
</Routines>
</Program>`;
}

// ── Shell Program Generators ───────────────────────────────────────────────

/**
 * Generate a simple shell program with R00_Main (JSR to subroutines) and empty stub routines.
 * @param {string} name — Program name
 * @param {string} description — Program description
 * @param {Array<{name: string, comment: string}>} routines — Subroutine definitions
 * @returns {string} Complete <Program> XML block
 */
function generateShellProgram(name, description, routines) {
  // Build JSR calls in R00_Main for each subroutine
  const jsrRungs = routines.map((r, i) =>
    buildRung(i, `Call ${r.name}`, `JSR(${r.name},0);`)
  );

  const r00 = `<Routine Name="R00_Main" Type="RLL">
<RLLContent>
${jsrRungs.join('\n')}
</RLLContent>
</Routine>`;

  // Build each stub routine with a NOP comment rung
  const stubRoutines = routines.map(r => {
    const commentRung = buildRung(0, r.comment, 'NOP();');
    return `<Routine Name="${escapeXml(r.name)}" Type="RLL">
<RLLContent>
${commentRung}
</RLLContent>
</Routine>`;
  });

  return `<Program Name="${escapeXml(name)}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>${cdata(description)}</Description>
<Tags>
</Tags>
<Routines>
${r00}
${stubRoutines.join('\n')}
</Routines>
</Program>`;
}

/**
 * Generate MapInputs shell program.
 */
function generateMapInputsProgram() {
  return generateShellProgram('MapInputs',
    'Map EtherNet/IP module inputs to controller-scope tags - Auto-generated by SDC State Logic Builder',
    [{ name: 'R01_Logic', comment: 'Map EtherNet/IP module inputs to controller-scope tags — configure post-export' }]
  );
}

/**
 * Generate MapOutputs shell program.
 */
function generateMapOutputsProgram() {
  return generateShellProgram('MapOutputs',
    'Map controller-scope tags to EtherNet/IP module outputs - Auto-generated by SDC State Logic Builder',
    [{ name: 'R01_Logic', comment: 'Map controller-scope tags to EtherNet/IP module outputs — configure post-export' }]
  );
}

/**
 * Generate HMI shell program.
 */
function generateHMIProgram() {
  return generateShellProgram('HMI',
    'HMI data aggregation - Auto-generated by SDC State Logic Builder',
    [{ name: 'R01_Logic', comment: 'HMI data aggregation — configure post-export' }]
  );
}

/**
 * Generate Production shell program.
 */
function generateProductionProgram() {
  return generateShellProgram('Production',
    'Production and shift data tracking - Auto-generated by SDC State Logic Builder',
    [
      { name: 'R01_ProductionData', comment: 'Production data tracking — configure post-export' },
      { name: 'R02_ShiftData', comment: 'Shift data tracking — configure post-export' },
    ]
  );
}

// ── MachineBasic UDT ──────────────────────────────────────────────────────

/**
 * Generate MachineBasic UDT XML.
 */
function generateMachineBasicUDT() {
  return `
<DataType Name="MachineBasic" Family="NoFamily" Class="User">
<Members>
<Member Name="AlwaysOn" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="AlwaysOff" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="PowerUpCP" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="MotionUpCP" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash100msPS" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash250msPD" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash250msPS" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash500msPD" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash500msPS" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash1sPD" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Flash1sPS" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>`;
}

// ── Axis numbering helper ─────────────────────────────────────────────────

/**
 * Build a map of deviceId -> sequential axis number across ALL state machines.
 * Numbering starts at 1, incremented for each ServoAxis device found.
 * SMs are processed in station number order (same order as program generation).
 *
 * @param {Array} allSMs — All state machines in the project
 * @returns {Map<string, number>} deviceId -> axis number (1-based)
 */
function buildAxisNumberMap(allSMs) {
  const sorted = [...allSMs].sort((a, b) => (a.stationNumber ?? 0) - (b.stationNumber ?? 0));
  const axisMap = new Map();
  let axisNum = 1;
  for (const sm of sorted) {
    for (const device of (sm.devices ?? [])) {
      if (device.type === 'ServoAxis') {
        axisMap.set(device.id, axisNum);
        axisNum++;
      }
    }
  }
  return axisMap;
}

/**
 * Format axis number with zero-padded 2-digit prefix: 1 -> "01", 12 -> "12"
 */
function formatAxisNum(n) {
  return String(n).padStart(2, '0');
}

// ── Alarms Program Generator ──────────────────────────────────────────────────
// Centralized alarm aggregation program. Every station's R20_Alarms calls
// ProgramAlarmHandler with \Alarms.p_ProgramID, \Alarms.p_Active, \Alarms.p_History.
// This program provides those public arrays.

function generateAlarmsProgram(stationNames = []) {
  const tags = [];

  // p_ProgramID — public INT, unique per station (assigned by CE or auto-incremented)
  tags.push(`<Tag Name="p_ProgramID" TagType="Base" DataType="INT" Radix="Decimal" Usage="Public" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('Unique program ID counter — each station reads this to identify its alarms')}</Description>
</Tag>`);

  // p_Active — public AlarmData[100], active alarms from all stations
  tags.push(`<Tag Name="p_Active" TagType="Base" DataType="AlarmData" Dimensions="100" Usage="Public" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('Active alarms aggregate — written by each station ProgramAlarmHandler')}</Description>
</Tag>`);

  // p_History — public AlarmData[100], alarm history from all stations
  tags.push(`<Tag Name="p_History" TagType="Base" DataType="AlarmData" Dimensions="100" Usage="Public" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('Alarm history — written by each station ProgramAlarmHandler')}</Description>
</Tag>`);

  // q_AnyAlarmActive — output: true if any station has an active alarm
  tags.push(`<Tag Name="q_AnyAlarmActive" TagType="Base" DataType="BOOL" Usage="Output" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('TRUE when any station has an active alarm')}</Description>
</Tag>`);

  // q_AnyWarningActive — output: true if any station has an active warning
  tags.push(`<Tag Name="q_AnyWarningActive" TagType="Base" DataType="BOOL" Usage="Output" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('TRUE when any station has an active warning')}</Description>
</Tag>`);

  // Build R00_Main with JSR to R01
  const r00 = `<Routine Name="R00_Main" Type="RLL">
<RLLContent>
${buildRung(0, 'Call alarm aggregation', 'JSR(R01_AlarmAggregation,0);')}
</RLLContent>
</Routine>`;

  // Build R01_AlarmAggregation — OR all station q_AlarmActive outputs
  const aggRungs = [];
  let rungNum = 0;

  if (stationNames.length > 0) {
    // OR all station alarm-active signals
    const alarmBranches = stationNames.map(n => `XIC(\\${n}.q_AlarmActive)`).join(' ,');
    aggRungs.push(buildRung(rungNum++, 'Any station alarm active',
      `[${alarmBranches}]OTE(q_AnyAlarmActive);`));

    const warnBranches = stationNames.map(n => `XIC(\\${n}.q_WarningActive)`).join(' ,');
    aggRungs.push(buildRung(rungNum++, 'Any station warning active',
      `[${warnBranches}]OTE(q_AnyWarningActive);`));
  } else {
    aggRungs.push(buildRung(rungNum++, 'No stations configured', 'NOP();'));
  }

  const r01 = `<Routine Name="R01_AlarmAggregation" Type="RLL">
<RLLContent>
${aggRungs.join('')}
</RLLContent>
</Routine>`;

  return `<Program Name="Alarms" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>${cdata('Centralized alarm aggregation — provides p_ProgramID, p_Active, p_History arrays referenced by every station ProgramAlarmHandler.')}</Description>
<Tags>
${tags.join('\n')}
</Tags>
<Routines>
${r00}
${r01}
</Routines>
</Program>`;
}

// ── Main export function ────────────────────────────────────────────────────

/**
 * Generate a complete controller L5X containing all programs, shared types,
 * AOIs, recipe system, and task configuration.
 *
 * @param {object} project — Full project object from the store
 * @returns {string} Complete L5X XML string
 */
export function exportControllerL5X(project) {
  const allSMs = project.stateMachines ?? [];
  const trackingFields = project.partTracking?.fields ?? [];

  // ── Determine union capabilities across ALL SMs ───────────────────────────
  let hasServos = false;
  let hasRangeCheck = false;
  let hasRobots = false;
  const robotDevices = [];

  for (const sm of allSMs) {
    for (const device of (sm.devices ?? [])) {
      if (device.type === 'ServoAxis') { hasServos = true; hasRangeCheck = true; }
      if (device.type === 'AnalogSensor') hasRangeCheck = true;
      if (device.type === 'Robot') { hasRobots = true; robotDevices.push(device); }
    }
  }

  // ── Build axis number map (sequential across all SMs) ─────────────────────
  const axisNumberMap = buildAxisNumberMap(allSMs);

  // ── Generate shared DataTypes and AOIs ONCE ───────────────────────────────
  let dataTypesXml = generateDataTypes(hasServos, trackingFields, robotDevices);
  let aoiXml = generateAOI(hasRangeCheck, hasRobots);

  // Strip Use="Context" from DataTypes and AOI — controller-level export doesn't use context
  dataTypesXml = dataTypesXml.replace('<DataTypes Use="Context">', '<DataTypes>');
  aoiXml = aoiXml.replace('<AddOnInstructionDefinitions Use="Context">', '<AddOnInstructionDefinitions>');

  // ── Inject MachineBasic UDT into DataTypes ────────────────────────────────
  const machineBasicUDT = generateMachineBasicUDT();
  dataTypesXml = dataTypesXml.replace('</DataTypes>', `${machineBasicUDT}\n</DataTypes>`);

  // ── Recipe system ─────────────────────────────────────────────────────────
  const recipeParams = collectRecipeParameters(project);
  const hasRecipes = (project.recipes ?? []).length > 0 && recipeParams.length > 0;

  let recipeUDTXml = '';
  let recipeTagsXml = '';
  let recipeManagerXml = '';

  if (hasRecipes) {
    recipeUDTXml = generateRecipeUDT(recipeParams);
    recipeTagsXml = generateRecipeTags(project, recipeParams);
    recipeManagerXml = generateRecipeManagerProgram(recipeParams, (project.recipes ?? []).length);

    // Inject Recipe_UDT into DataTypes block (before closing </DataTypes>)
    dataTypesXml = dataTypesXml.replace('</DataTypes>', `${recipeUDTXml}\n</DataTypes>`);
  }

  // ── Generate each SM program ──────────────────────────────────────────────
  const smProgramXmls = [];
  const smProgramNames = [];

  // Sort SMs by station number for consistent ordering
  const sortedSMs = [...allSMs].sort((a, b) => (a.stationNumber ?? 0) - (b.stationNumber ?? 0));

  for (const sm of sortedSMs) {
    try {
      let programXml = exportProgramXml(sm, allSMs, trackingFields, project?.machineConfig ?? null);
      // Strip Use="Target" from program — controller export doesn't need it
      programXml = programXml.replace(' Use="Target"', '');

      // Resolve axis number placeholders: a{axisNum}_ -> a01_, a02_, etc.
      for (const device of (sm.devices ?? [])) {
        if (device.type === 'ServoAxis') {
          const axisNum = axisNumberMap.get(device.id);
          if (axisNum != null) {
            const paddedNum = formatAxisNum(axisNum);
            // Replace placeholder pattern used in tag naming
            const placeholder = new RegExp(`a\\{axisNum\\}_${escapeRegExp(device.name)}`, 'g');
            programXml = programXml.replace(placeholder, `a${paddedNum}_${device.name}`);
          }
        }
      }

      smProgramXmls.push(programXml);
      smProgramNames.push(buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed'));
    } catch (err) {
      console.warn(`[controllerL5xExporter] Skipping SM "${sm.name}": ${err.message}`);
    }
  }

  // ── Generate Supervisor program ───────────────────────────────────────────
  let supervisorXml = '';
  let hasSupervisor = false;
  try {
    supervisorXml = exportSupervisorProgramXml(project);
    // Strip Use="Target" from supervisor program
    supervisorXml = supervisorXml.replace(' Use="Target"', '');
    hasSupervisor = true;
  } catch (err) {
    console.warn(`[controllerL5xExporter] Skipping Supervisor: ${err.message}`);
  }

  // ── Generate shell programs ───────────────────────────────────────────────
  const mapInputsXml = generateMapInputsProgram();
  const mapOutputsXml = generateMapOutputsProgram();
  const hmiXml = generateHMIProgram();
  const productionXml = generateProductionProgram();

  // ── Generate Alarms program (central alarm aggregator) ──────────────────
  const alarmsXml = generateAlarmsProgram(smProgramNames);

  // ── Build controller-scoped tags ──────────────────────────────────────────
  const controllerTags = [];

  // g_CPUDateTime — CPU_TimeDate UDT, populated by GSV in Supervisor R10_Global
  controllerTags.push(`<Tag Name="g_CPUDateTime" TagType="Base" DataType="CPU_TimeDate" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('CPU Time/Date - populated by GSV WallClockTime in Supervisor R10_Global')}</Description>
</Tag>`);

  // MotionGroup — always generated, with standard motion parameters
  controllerTags.push(`<Tag Name="MotionGroup" TagType="Base" DataType="MOTION_GROUP" ExternalAccess="Read/Write">
<Description>${cdata('Motion group for all servo axes')}</Description>
<Data Format="MotionGroup">
<MotionGroupParameters CoarseUpdatePeriod="2000" PhaseShift="0" GeneralFaultType="Non Major Fault" AutoTagUpdate="Enabled" Alternate1UpdateMultiplier="1" Alternate2UpdateMultiplier="1"/>
</Data>
</Tag>`);

  // MB — MachineBasic UDT instance
  controllerTags.push(`<Tag Name="MB" TagType="Base" DataType="MachineBasic" Constant="false" ExternalAccess="Read/Write">
<Description>${cdata('Machine basic status bits — AlwaysOn, AlwaysOff, flash pulses')}</Description>
</Tag>`);

  // Axis tags — one per servo device across all SMs, sequentially numbered
  // Each axis references MotionGroup and a servo drive module (placeholder sd{nn}_{name}:Ch1)
  for (const sm of sortedSMs) {
    for (const device of (sm.devices ?? [])) {
      if (device.type === 'ServoAxis') {
        const axisNum = axisNumberMap.get(device.id);
        if (axisNum != null) {
          const paddedNum = formatAxisNum(axisNum);
          const axisTagName = `a${paddedNum}_${device.name}`;
          const moduleAlias = `sd${paddedNum}_${device.name}`;
          controllerTags.push(`<Tag Name="${escapeXml(axisTagName)}" TagType="Base" DataType="AXIS_CIP_DRIVE" ExternalAccess="Read/Write">
<Description>${cdata(`Servo axis ${paddedNum} - ${device.name} (${sm.name})`)}</Description>
<Data Format="Axis">
<AxisParameters MotionGroup="MotionGroup" MotionModule="${escapeXml(moduleAlias)}:Ch1" AxisConfiguration="Position Loop" FeedbackConfiguration="Motor Feedback" MotorDataSource="Database" MotorCatalogNumber="" Feedback1Type="Hiperface DSL" MotorType="Rotary Permanent Magnet" MotionScalingConfiguration="Control Scaling"/>
</Data>
</Tag>`);
        }
      }
    }
  }

  // Recipe tags (if any)
  if (recipeTagsXml) {
    controllerTags.push(recipeTagsXml);
  }

  const controllerTagsXml = controllerTags.length > 0
    ? `<Tags>\n${controllerTags.join('\n')}\n</Tags>`
    : '<Tags/>';

  // ── Build scheduled programs list ─────────────────────────────────────────
  // Order: MapInputs, Supervisor, stations, Production, Alarms, HMI, MapOutputs, RecipeManager
  const scheduledPrograms = [];
  scheduledPrograms.push('MapInputs');
  if (hasSupervisor) scheduledPrograms.push('Supervisor');
  scheduledPrograms.push(...smProgramNames);
  scheduledPrograms.push('Production');
  scheduledPrograms.push('Alarms');
  scheduledPrograms.push('HMI');
  scheduledPrograms.push('MapOutputs');
  if (hasRecipes) scheduledPrograms.push('RecipeManager');

  const scheduledProgramsXml = scheduledPrograms
    .map(name => `<ScheduledProgram Name="${name}"/>`)
    .join('\n          ');

  // ── Assemble all programs ─────────────────────────────────────────────────
  const allPrograms = [];
  allPrograms.push(mapInputsXml);
  if (hasSupervisor) allPrograms.push(supervisorXml);
  allPrograms.push(...smProgramXmls);
  allPrograms.push(productionXml);
  allPrograms.push(alarmsXml);
  allPrograms.push(hmiXml);
  allPrograms.push(mapOutputsXml);
  if (hasRecipes) allPrograms.push(recipeManagerXml);

  // ── Final XML ─────────────────────────────────────────────────────────────
  const now = new Date().toUTCString();
  const swRev = project.machineConfig?.softwareRevision ?? SOFTWARE_REV;
  const majorRev = swRev.split('.')[0] ?? '35';
  const processorType = project.machineConfig?.processorType ?? '1756-L83E';
  const controllerName = project.machineConfig?.controllerName ?? CONTROLLER_NAME;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="${SCHEMA_REV}" SoftwareRevision="${swRev}" TargetName="${controllerName}" TargetType="Controller" ContainsContext="false" ExportDate="${now}" ExportOptions="References NoRawData L5KData DecoratedData ForceProtectedEncoding AllProjDocTrans">
<Controller Name="${controllerName}" ProcessorType="${processorType}" MajorRev="${majorRev}" MinorRev="11">
${dataTypesXml}
${aoiXml}
${controllerTagsXml}
<Programs>
${allPrograms.join('\n')}
</Programs>
<Tasks>
<Task Name="MainTask" Type="CONTINUOUS" Rate="10" Priority="10" Watchdog="500">
<ScheduledPrograms>
          ${scheduledProgramsXml}
</ScheduledPrograms>
</Task>
</Tasks>
</Controller>
</RSLogix5000Content>`;
}

// ── Regex escape helper ────────────────────────────────────────────────────

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Download helper ─────────────────────────────────────────────────────────

/**
 * Trigger a browser download of the full controller L5X.
 * File name: {ProjectName}_Controller.L5X
 *
 * @param {object} project — Full project object from the store
 */
export function downloadControllerL5X(project) {
  const xml = exportControllerL5X(project);
  const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const projectName = (project.name ?? 'Project').replace(/[^a-zA-Z0-9_-]/g, '_');
  a.href = url;
  a.download = `${projectName}_Controller.L5X`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
