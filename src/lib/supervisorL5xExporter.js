/**
 * Supervisor Program L5X Generator
 *
 * Auto-generates the Supervisor program that orchestrates all station state machines:
 *  - Mode switching (Manual / Auto)
 *  - Cycle start / stop control
 *  - Safety interlocks
 *  - Stacklight outputs
 *  - Fault escalation
 *  - Station lockout support
 *
 * Uses State_Engine_128Max AOI (new SDC standard).
 * States numbered base=1, increment=3: Idle(1), Manual(4), AutoInit(7),
 * AutoReady(10), CycleStop(13), Faulted(16).
 *
 * Reference: 1107 GE Healthcare Supervisor (old standard) — adapted to R00-R03 naming.
 */

import {
  escapeXml,
  cdata,
  buildRung,
  buildTimerTagXml,
  buildBoolTagXml,
  buildControlTagXml,
  buildStateEngineTagXml,
  buildStateHistoryTagXml,
  buildDintTagXml,
  generate128BoolL5K,
  generate128BoolDecorated,
  generateDataTypes,
  generateAOI,
  SCHEMA_REV,
  SOFTWARE_REV,
  CONTROLLER_NAME,
  STEP_BASE,
} from './l5xExporter.js';

import { buildProgramName } from './tagNaming.js';

// ── Supervisor state numbers ────────────────────────────────────────────────

const SUP_IDLE       = 1;
const SUP_MANUAL     = 4;
const SUP_AUTO_INIT  = 7;
const SUP_AUTO_READY = 10;
const SUP_CYCLE_STOP = 13;
const SUP_FAULTED    = 16;

// ── Resolve linked station info ─────────────────────────────────────────────

function resolveStationSMs(project) {
  const machineConfig = project.machineConfig ?? {};
  const allSMs = project.stateMachines ?? [];
  const stations = machineConfig.stations ?? [];

  const linked = [];
  for (const station of stations) {
    const smIds = station.smIds ?? [];
    for (const smId of smIds) {
      const sm = allSMs.find(s => s.id === smId);
      if (!sm) continue;
      const programName = buildProgramName(sm.stationNumber ?? station.number ?? 0, sm.name ?? 'Unknown');
      linked.push({
        stationId: station.id,
        stationNumber: station.number,
        stationName: station.name,
        smId: sm.id,
        smName: sm.name,
        programName,
        hasLockout: !!station.lockout,
        hasBypass: !!station.bypass,
      });
    }
  }
  return linked;
}

// ── Build Status tag with Supervisor state comments ─────────────────────────

function buildSupervisorStatusTagXml() {
  const stateComments = [
    { step: SUP_IDLE,       label: 'Idle - No Mode Selected' },
    { step: SUP_MANUAL,     label: 'Manual Mode' },
    { step: SUP_AUTO_INIT,  label: 'Auto Init - Waiting for Stations Ready' },
    { step: SUP_AUTO_READY, label: 'Auto Ready - Running' },
    { step: SUP_CYCLE_STOP, label: 'Cycle Stop - Waiting for Stations Complete' },
    { step: SUP_FAULTED,    label: 'Faulted - Requires Reset' },
  ];

  const comments = stateComments.map(s =>
    `<Comment Operand=".STATE[${s.step}]">\n${cdata(s.label)}\n</Comment>`
  );

  const boolL5K = generate128BoolL5K();
  const boolDec = generate128BoolDecorated();

  return `
<Tag Name="Status" TagType="Base" DataType="StateLogicStatus" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
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

// ── Generate all Supervisor tags ────────────────────────────────────────────

function generateSupervisorTags(linkedStations, standardsProfile) {
  const tags = [];

  // State engine infrastructure
  tags.push(buildControlTagXml());
  tags.push(buildSupervisorStatusTagXml());
  tags.push(buildStateEngineTagXml());
  tags.push(buildStateHistoryTagXml());

  // Station aggregate booleans
  tags.push(buildBoolTagXml('Sup_AllStationsReady', 'All stations at home/ready position'));
  tags.push(buildBoolTagXml('Sup_AllStationsStopped', 'All stations completed and stopped'));

  // Cycle control
  tags.push(buildBoolTagXml('Sup_MachineRunning', 'Machine is actively running cycles'));
  tags.push(buildBoolTagXml('Sup_CycleStartLatch', 'Cycle start latched'));
  tags.push(buildTimerTagXml('Sup_CycleStartDelay', 'Delay after cycle start before running',
    standardsProfile.cycleStartDelay ?? 2000));

  // Mode selection (HMI inputs)
  tags.push(buildBoolTagXml('Sup_ModeAuto', 'HMI - Auto mode selected', 'Input'));
  tags.push(buildBoolTagXml('Sup_ModeManual', 'HMI - Manual mode selected', 'Input'));

  // Safety (CE maps post-import)
  tags.push(buildBoolTagXml('Sup_SafetyOK', 'Safety circuit OK', 'Input'));
  tags.push(buildBoolTagXml('Sup_EStopActive', 'E-Stop is active', 'Input'));

  // HMI commands
  tags.push(buildBoolTagXml('Sup_CycleStartCmd', 'HMI - Cycle start command', 'Input'));
  tags.push(buildBoolTagXml('Sup_CycleStopCmd', 'HMI - Cycle stop command', 'Input'));
  tags.push(buildBoolTagXml('Sup_FaultReset', 'HMI - Fault reset command', 'Input'));

  // Fault detection
  tags.push(buildBoolTagXml('Sup_FaultActive', 'One or more stations have a fault'));

  // Stacklight outputs
  tags.push(buildBoolTagXml('Sup_StackGreen', 'Stacklight - Green (running)', 'Output'));
  tags.push(buildBoolTagXml('Sup_StackYellow', 'Stacklight - Yellow (manual/init)', 'Output'));
  tags.push(buildBoolTagXml('Sup_StackRed', 'Stacklight - Red (faulted/e-stop)', 'Output'));

  // Stuck-in-run watchdog
  tags.push(buildTimerTagXml('Sup_StuckInRunTimer', 'Stuck in run watchdog timer',
    standardsProfile.stuckInRunTimeout ?? 10000));

  // Per-station lockout tags
  for (const ls of linkedStations) {
    if (ls.hasLockout) {
      const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
      tags.push(buildBoolTagXml(lockoutTag,
        `Lockout - S${String(ls.stationNumber).padStart(2, '0')} ${ls.stationName}`, 'Input'));
    }
  }

  return tags.join('\n');
}

// ── R00_Main ────────────────────────────────────────────────────────────────

function generateR00Main() {
  const rungs = [];
  rungs.push(buildRung(0, 'Jump to Inputs', 'JSR(R01_Inputs,0);'));
  rungs.push(buildRung(1, 'Jump to State Transitions', 'JSR(R02_StateTransitions,0);'));
  rungs.push(buildRung(2, 'Jump to State Logic', 'JSR(R03_StateLogic,0);'));

  return `
<Routine Name="R00_Main" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R01_Inputs — Station ready/stopped/fault aggregation ────────────────────

function generateR01Inputs(linkedStations) {
  const rungs = [];
  let rungNum = 0;

  // --- All Stations Ready ---
  // AND of all station wait-state bits. Lockout stations get parallel branch (OR with lockout).
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls => {
      const waitStateContact = `XIC(\\${ls.programName}.Status.State[${STEP_BASE}])`;
      if (ls.hasLockout) {
        const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
        return `[${waitStateContact} ,XIC(${lockoutTag})]`;
      }
      return waitStateContact;
    });
    const rungText = `${contacts.join(' ')} OTE(Sup_AllStationsReady);`;
    rungs.push(buildRung(rungNum++, 'All Stations Ready - All at home/wait position', rungText));
  } else {
    rungs.push(buildRung(rungNum++, 'All Stations Ready - No stations linked', 'OTE(Sup_AllStationsReady);'));
  }

  // --- All Stations Stopped ---
  // Same pattern — stations back at wait step means they've finished
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls => {
      const waitStateContact = `XIC(\\${ls.programName}.Status.State[${STEP_BASE}])`;
      if (ls.hasLockout) {
        const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
        return `[${waitStateContact} ,XIC(${lockoutTag})]`;
      }
      return waitStateContact;
    });
    const rungText = `${contacts.join(' ')} OTE(Sup_AllStationsStopped);`;
    rungs.push(buildRung(rungNum++, 'All Stations Stopped - All returned to home', rungText));
  } else {
    rungs.push(buildRung(rungNum++, 'All Stations Stopped - No stations linked', 'OTE(Sup_AllStationsStopped);'));
  }

  // --- Fault Detection ---
  // OR of all station TimeoutFlt bits
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls =>
      `XIC(\\${ls.programName}.Status.TimeoutFlt)`
    );
    const rungText = `[${contacts.join(' ,')}] OTE(Sup_FaultActive);`;
    rungs.push(buildRung(rungNum++, 'Fault Detection - Any station timeout fault', rungText));
  } else {
    rungs.push(buildRung(rungNum++, 'Fault Detection - No stations linked', 'OTU(Sup_FaultActive);'));
  }

  return `
<Routine Name="R01_Inputs" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R02_StateTransitions ────────────────────────────────────────────────────

function generateR02StateTransitions() {
  const rungs = [];
  let rungNum = 0;

  // Idle(1) → Manual(4): SafetyOK + ModeManual
  rungs.push(buildRung(rungNum++,
    'Idle → Manual: Safety OK and Manual mode selected',
    `XIC(Status.State[${SUP_IDLE}]) XIC(Sup_SafetyOK) XIC(Sup_ModeManual) MOV(${SUP_MANUAL},Control.StateReg);`));

  // Idle(1) → AutoInit(7): SafetyOK + ModeAuto
  rungs.push(buildRung(rungNum++,
    'Idle → Auto Init: Safety OK and Auto mode selected',
    `XIC(Status.State[${SUP_IDLE}]) XIC(Sup_SafetyOK) XIC(Sup_ModeAuto) MOV(${SUP_AUTO_INIT},Control.StateReg);`));

  // Manual(4) → Idle(1): mode deselect OR safety lost
  rungs.push(buildRung(rungNum++,
    'Manual → Idle: Mode deselected or safety lost',
    `XIC(Status.State[${SUP_MANUAL}]) [XIO(Sup_ModeManual) ,XIO(Sup_SafetyOK)] MOV(${SUP_IDLE},Control.StateReg);`));

  // Manual(4) → AutoInit(7): switch to auto
  rungs.push(buildRung(rungNum++,
    'Manual → Auto Init: Switch to auto mode',
    `XIC(Status.State[${SUP_MANUAL}]) XIC(Sup_SafetyOK) XIC(Sup_ModeAuto) MOV(${SUP_AUTO_INIT},Control.StateReg);`));

  // AutoInit(7) → AutoReady(10): AllStationsReady
  rungs.push(buildRung(rungNum++,
    'Auto Init → Auto Ready: All stations ready',
    `XIC(Status.State[${SUP_AUTO_INIT}]) XIC(Sup_AllStationsReady) MOV(${SUP_AUTO_READY},Control.StateReg);`));

  // AutoInit(7) → Idle(1): mode deselect OR safety lost
  rungs.push(buildRung(rungNum++,
    'Auto Init → Idle: Mode deselected or safety lost',
    `XIC(Status.State[${SUP_AUTO_INIT}]) [XIO(Sup_ModeAuto) ,XIO(Sup_SafetyOK)] MOV(${SUP_IDLE},Control.StateReg);`));

  // AutoReady(10) → CycleStop(13): CycleStopCmd
  rungs.push(buildRung(rungNum++,
    'Auto Ready → Cycle Stop: Cycle stop commanded',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIC(Sup_CycleStopCmd) MOV(${SUP_CYCLE_STOP},Control.StateReg);`));

  // AutoReady(10) → Faulted(16): FaultActive
  rungs.push(buildRung(rungNum++,
    'Auto Ready → Faulted: Station fault detected',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIC(Sup_FaultActive) MOV(${SUP_FAULTED},Control.StateReg);`));

  // AutoReady(10) → Idle(1): safety lost
  rungs.push(buildRung(rungNum++,
    'Auto Ready → Idle: Safety lost',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIO(Sup_SafetyOK) MOV(${SUP_IDLE},Control.StateReg);`));

  // CycleStop(13) → Idle(1): AllStationsStopped
  rungs.push(buildRung(rungNum++,
    'Cycle Stop → Idle: All stations stopped',
    `XIC(Status.State[${SUP_CYCLE_STOP}]) XIC(Sup_AllStationsStopped) MOV(${SUP_IDLE},Control.StateReg);`));

  // CycleStop(13) → Faulted(16): FaultActive
  rungs.push(buildRung(rungNum++,
    'Cycle Stop → Faulted: Station fault during stop',
    `XIC(Status.State[${SUP_CYCLE_STOP}]) XIC(Sup_FaultActive) MOV(${SUP_FAULTED},Control.StateReg);`));

  // Faulted(16) → Idle(1): FaultReset + !FaultActive + SafetyOK
  rungs.push(buildRung(rungNum++,
    'Faulted → Idle: Fault reset with no active faults and safety OK',
    `XIC(Status.State[${SUP_FAULTED}]) XIC(Sup_FaultReset) XIO(Sup_FaultActive) XIC(Sup_SafetyOK) MOV(${SUP_IDLE},Control.StateReg);`));

  // State Engine AOI call (last rung)
  rungs.push(buildRung(rungNum++,
    'State Engine AOI',
    'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'));

  return `
<Routine Name="R02_StateTransitions" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R03_StateLogic — Outputs ────────────────────────────────────────────────

function generateR03StateLogic() {
  const rungs = [];
  let rungNum = 0;

  // Cycle start latch (AutoReady + CycleStartCmd → OTL)
  rungs.push(buildRung(rungNum++,
    'Cycle Start Latch - Latch on cycle start command in Auto Ready',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIC(Sup_CycleStartCmd) OTL(Sup_CycleStartLatch);`));

  // Cycle start delay timer
  rungs.push(buildRung(rungNum++,
    'Cycle Start Delay Timer',
    'XIC(Sup_CycleStartLatch) TON(Sup_CycleStartDelay,?,?);'));

  // Machine Running (latch DN + delay done)
  rungs.push(buildRung(rungNum++,
    'Machine Running - Cycle start latched and delay complete',
    'XIC(Sup_CycleStartLatch) XIC(Sup_CycleStartDelay.DN) OTE(Sup_MachineRunning);'));

  // Cycle stop unlatch
  rungs.push(buildRung(rungNum++,
    'Cycle Stop - Unlatch cycle start on Cycle Stop state',
    `XIC(Status.State[${SUP_CYCLE_STOP}]) OTU(Sup_CycleStartLatch);`));

  // Fault unlatch
  rungs.push(buildRung(rungNum++,
    'Fault - Unlatch cycle start on Faulted state',
    `XIC(Status.State[${SUP_FAULTED}]) OTU(Sup_CycleStartLatch);`));

  // Stacklight Green (MachineRunning)
  rungs.push(buildRung(rungNum++,
    'Stacklight Green - Machine is running',
    'XIC(Sup_MachineRunning) OTE(Sup_StackGreen);'));

  // Stacklight Yellow (Manual OR AutoInit)
  rungs.push(buildRung(rungNum++,
    'Stacklight Yellow - Manual mode or Auto Init',
    `[XIC(Status.State[${SUP_MANUAL}]) ,XIC(Status.State[${SUP_AUTO_INIT}])] OTE(Sup_StackYellow);`));

  // Stacklight Red (Faulted OR EStop)
  rungs.push(buildRung(rungNum++,
    'Stacklight Red - Faulted or E-Stop active',
    `[XIC(Status.State[${SUP_FAULTED}]) ,XIC(Sup_EStopActive)] OTE(Sup_StackRed);`));

  // Stuck-in-run timer (MachineRunning + !AllStationsReady → TON)
  rungs.push(buildRung(rungNum++,
    'Stuck In Run Watchdog - Timer starts when running but stations not ready',
    'XIC(Sup_MachineRunning) XIO(Sup_AllStationsReady) TON(Sup_StuckInRunTimer,?,?);'));

  // Stuck-in-run fault (timer.DN → OTL FaultActive)
  rungs.push(buildRung(rungNum++,
    'Stuck In Run Fault - Latch fault if watchdog expires',
    'XIC(Sup_StuckInRunTimer.DN) OTL(Sup_FaultActive);'));

  return `
<Routine Name="R03_StateLogic" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── Program XML (no Controller wrapper) ────────────────────────────────────

export function exportSupervisorProgramXml(project) {
  const standardsProfile = project.standardsProfile ?? {};
  const linkedStations = resolveStationSMs(project);
  const programName = 'Supervisor';

  const tagsXml = generateSupervisorTags(linkedStations, standardsProfile);
  const r00 = generateR00Main();
  const r01 = generateR01Inputs(linkedStations);
  const r02 = generateR02StateTransitions();
  const r03 = generateR03StateLogic();

  return `<Program Use="Target" Name="${programName}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata('Supervisor - Machine orchestration, mode control, safety, stacklight - Auto-generated by SDC State Logic Builder')}
</Description>
<Tags>
${tagsXml}
</Tags>
<Routines>
${r00}
${r01}
${r02}
${r03}
</Routines>
</Program>`;
}

// ── Main export (full L5X with Controller wrapper) ─────────────────────────

export function exportSupervisorL5X(project) {
  const programName = 'Supervisor';
  const programXml = exportSupervisorProgramXml(project);

  const dataTypes = generateDataTypes(false, []);
  const aoi = generateAOI(false);

  const now = new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="${SCHEMA_REV}" SoftwareRevision="${SOFTWARE_REV}" TargetName="${programName}" TargetType="Program" TargetClass="Standard" ContainsContext="true" ExportDate="${now}" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">
<Controller Use="Context" Name="${CONTROLLER_NAME}">
${dataTypes}
${aoi}
<Programs Use="Context">
${programXml}
</Programs>
</Controller>
</RSLogix5000Content>`;
}
