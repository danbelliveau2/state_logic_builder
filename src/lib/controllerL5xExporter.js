/**
 * Controller L5X Exporter
 *
 * Generates a complete Allen Bradley controller L5X file containing:
 *  - All station programs (from l5xExporter)
 *  - Supervisor program (from supervisorL5xExporter)
 *  - MainProgram with JSR routing to all programs
 *  - MainTask with all scheduled programs
 *  - Shared DataTypes and AOIs (generated once)
 *  - Controller-scoped recipe tags and RecipeManager program
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

// ── MainProgram generation ──────────────────────────────────────────────────

/**
 * Generate MainProgram with MainRoutine containing JSR calls to each program's R00_Main.
 */
function generateMainProgram(programNames) {
  const rungs = [];
  for (let i = 0; i < programNames.length; i++) {
    rungs.push(buildRung(i,
      `Call ${programNames[i]}`,
      `JSR(\\${programNames[i]}.R00_Main,0);`));
  }

  // If no programs, add a placeholder rung
  if (programNames.length === 0) {
    rungs.push(buildRung(0, 'No programs configured', 'NOP();'));
  }

  return `<Program Name="MainProgram" TestEdits="false" MainRoutineName="MainRoutine" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata('Main Program - JSR routing to all station and supervisor programs - Auto-generated by SDC State Logic Builder')}
</Description>
<Tags>
</Tags>
<Routines>
<Routine Name="MainRoutine" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>
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

  // ── Generate shared DataTypes and AOIs ONCE ───────────────────────────────
  let dataTypesXml = generateDataTypes(hasServos, trackingFields, robotDevices);
  let aoiXml = generateAOI(hasRangeCheck, hasRobots);

  // Strip Use="Context" from DataTypes and AOI — controller-level export doesn't use context
  dataTypesXml = dataTypesXml.replace('<DataTypes Use="Context">', '<DataTypes>');
  aoiXml = aoiXml.replace('<AddOnInstructionDefinitions Use="Context">', '<AddOnInstructionDefinitions>');

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

  for (const sm of allSMs) {
    try {
      const programXml = exportProgramXml(sm, allSMs, trackingFields);
      // Strip Use="Target" from program — controller export doesn't need it
      const cleaned = programXml.replace(' Use="Target"', '');
      smProgramXmls.push(cleaned);
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

  // ── Build MainProgram ─────────────────────────────────────────────────────
  // Order: supervisor first (if present), then SM programs, then RecipeManager
  const jsrProgramNames = [];
  if (hasSupervisor) jsrProgramNames.push('Supervisor');
  jsrProgramNames.push(...smProgramNames);
  if (hasRecipes) jsrProgramNames.push('RecipeManager');

  const mainProgramXml = generateMainProgram(jsrProgramNames);

  // ── Build controller-scoped tags ──────────────────────────────────────────
  const controllerTags = [];
  if (recipeTagsXml) {
    controllerTags.push(recipeTagsXml);
  }
  const controllerTagsXml = controllerTags.length > 0
    ? `<Tags>\n${controllerTags.join('\n')}\n</Tags>`
    : '<Tags/>';

  // ── Build scheduled programs list ─────────────────────────────────────────
  const scheduledPrograms = ['MainProgram'];
  if (hasSupervisor) scheduledPrograms.push('Supervisor');
  scheduledPrograms.push(...smProgramNames);
  if (hasRecipes) scheduledPrograms.push('RecipeManager');

  const scheduledProgramsXml = scheduledPrograms
    .map(name => `<ScheduledProgram Name="${name}"/>`)
    .join('\n          ');

  // ── Assemble all programs ─────────────────────────────────────────────────
  const allPrograms = [mainProgramXml];
  if (hasSupervisor) allPrograms.push(supervisorXml);
  allPrograms.push(...smProgramXmls);
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
