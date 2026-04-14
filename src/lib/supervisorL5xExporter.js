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

  // Station aggregate booleans (program-scope helpers)
  tags.push(buildBoolTagXml('AllStationsReady', 'All stations at home/ready position'));
  tags.push(buildBoolTagXml('AllStationsStopped', 'All stations completed and stopped'));

  // ── PUBLIC q_* outputs — read by every station's R01_Inputs via \Supervisor.q_* ──
  tags.push(buildBoolTagXml('q_ManualMode',     'Manual mode active (published to stations)',     'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_SafetyOK',       'Safety circuit OK (published to stations)',      'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_FaultReset',     'Fault reset pulse (published to stations)',      'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_CycleStartLatch','Cycle start latched (published to stations)',    'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_CycleStopped',   'Machine cycle stopped (published to stations)',  'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_MachineRunning', 'Machine actively running cycles',                'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_MachineFaultActive', 'One or more stations have an active fault', 'Output', 'Read Only'));

  // Cycle start delay timer
  tags.push(buildTimerTagXml('CycleStartDelay', 'Delay after cycle start before running',
    standardsProfile.cycleStartDelay ?? 2000));

  // ── HMI inputs (CE maps post-import) ────────────────────────────────────
  tags.push(buildBoolTagXml('HMI_ModeAuto',      'HMI - Auto mode selected',       'Input'));
  tags.push(buildBoolTagXml('HMI_ModeManual',    'HMI - Manual mode selected',     'Input'));
  tags.push(buildBoolTagXml('HMI_CycleStartCmd', 'HMI - Cycle start command',      'Input'));
  tags.push(buildBoolTagXml('HMI_CycleStopCmd',  'HMI - Cycle stop command',       'Input'));
  tags.push(buildBoolTagXml('HMI_FaultReset',    'HMI - Fault reset command',      'Input'));

  // Safety (CE maps post-import)
  tags.push(buildBoolTagXml('i_SafetyOK',     'Safety circuit OK',                  'Input'));
  tags.push(buildBoolTagXml('i_EStopActive',  'E-Stop active',                      'Input'));

  // Stacklight outputs
  tags.push(buildBoolTagXml('q_StackGreen',  'Stacklight - Green (running)',        'Output'));
  tags.push(buildBoolTagXml('q_StackYellow', 'Stacklight - Yellow (manual/init)',   'Output'));
  tags.push(buildBoolTagXml('q_StackRed',    'Stacklight - Red (faulted/e-stop)',   'Output'));

  // Stuck-in-run watchdog
  tags.push(buildTimerTagXml('StuckInRunTimer', 'Stuck in run watchdog timer',
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
    const rungText = `${contacts.join(' ')} OTE(AllStationsReady);`;
    rungs.push(buildRung(rungNum++, 'All Stations Ready - All at home/wait position', rungText));
  } else {
    rungs.push(buildRung(rungNum++, 'All Stations Ready - No stations linked', 'OTE(AllStationsReady);'));
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
    const rungText = `${contacts.join(' ')} OTE(AllStationsStopped);`;
    rungs.push(buildRung(rungNum++, 'All Stations Stopped - All returned to home', rungText));
  } else {
    rungs.push(buildRung(rungNum++, 'All Stations Stopped - No stations linked', 'OTE(AllStationsStopped);'));
  }

  // --- Fault Detection ---
  // OR of all station TimeoutFlt bits
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls =>
      `XIC(\\${ls.programName}.Status.TimeoutFlt)`
    );
    const rungText = `[${contacts.join(' ,')}] OTE(q_MachineFaultActive);`;
    rungs.push(buildRung(rungNum++, 'Fault Detection - Any station timeout fault', rungText));
  } else {
    rungs.push(buildRung(rungNum++, 'Fault Detection - No stations linked', 'OTU(q_MachineFaultActive);'));
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
    `XIC(Status.State[${SUP_IDLE}]) XIC(i_SafetyOK) XIC(HMI_ModeManual) MOV(${SUP_MANUAL},Control.StateReg);`));

  // Idle(1) → AutoInit(7): SafetyOK + ModeAuto
  rungs.push(buildRung(rungNum++,
    'Idle → Auto Init: Safety OK and Auto mode selected',
    `XIC(Status.State[${SUP_IDLE}]) XIC(i_SafetyOK) XIC(HMI_ModeAuto) MOV(${SUP_AUTO_INIT},Control.StateReg);`));

  // Manual(4) → Idle(1): mode deselect OR safety lost
  rungs.push(buildRung(rungNum++,
    'Manual → Idle: Mode deselected or safety lost',
    `XIC(Status.State[${SUP_MANUAL}]) [XIO(HMI_ModeManual) ,XIO(i_SafetyOK)] MOV(${SUP_IDLE},Control.StateReg);`));

  // Manual(4) → AutoInit(7): switch to auto
  rungs.push(buildRung(rungNum++,
    'Manual → Auto Init: Switch to auto mode',
    `XIC(Status.State[${SUP_MANUAL}]) XIC(i_SafetyOK) XIC(HMI_ModeAuto) MOV(${SUP_AUTO_INIT},Control.StateReg);`));

  // AutoInit(7) → AutoReady(10): AllStationsReady
  rungs.push(buildRung(rungNum++,
    'Auto Init → Auto Ready: All stations ready',
    `XIC(Status.State[${SUP_AUTO_INIT}]) XIC(AllStationsReady) MOV(${SUP_AUTO_READY},Control.StateReg);`));

  // AutoInit(7) → Idle(1): mode deselect OR safety lost
  rungs.push(buildRung(rungNum++,
    'Auto Init → Idle: Mode deselected or safety lost',
    `XIC(Status.State[${SUP_AUTO_INIT}]) [XIO(HMI_ModeAuto) ,XIO(i_SafetyOK)] MOV(${SUP_IDLE},Control.StateReg);`));

  // AutoReady(10) → CycleStop(13): CycleStopCmd
  rungs.push(buildRung(rungNum++,
    'Auto Ready → Cycle Stop: Cycle stop commanded',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIC(HMI_CycleStopCmd) MOV(${SUP_CYCLE_STOP},Control.StateReg);`));

  // AutoReady(10) → Faulted(16): FaultActive
  rungs.push(buildRung(rungNum++,
    'Auto Ready → Faulted: Station fault detected',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIC(q_MachineFaultActive) MOV(${SUP_FAULTED},Control.StateReg);`));

  // AutoReady(10) → Idle(1): safety lost
  rungs.push(buildRung(rungNum++,
    'Auto Ready → Idle: Safety lost',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIO(i_SafetyOK) MOV(${SUP_IDLE},Control.StateReg);`));

  // CycleStop(13) → Idle(1): AllStationsStopped
  rungs.push(buildRung(rungNum++,
    'Cycle Stop → Idle: All stations stopped',
    `XIC(Status.State[${SUP_CYCLE_STOP}]) XIC(AllStationsStopped) MOV(${SUP_IDLE},Control.StateReg);`));

  // CycleStop(13) → Faulted(16): FaultActive
  rungs.push(buildRung(rungNum++,
    'Cycle Stop → Faulted: Station fault during stop',
    `XIC(Status.State[${SUP_CYCLE_STOP}]) XIC(q_MachineFaultActive) MOV(${SUP_FAULTED},Control.StateReg);`));

  // Faulted(16) → Idle(1): FaultReset + !FaultActive + SafetyOK
  rungs.push(buildRung(rungNum++,
    'Faulted → Idle: Fault reset with no active faults and safety OK',
    `XIC(Status.State[${SUP_FAULTED}]) XIC(HMI_FaultReset) XIO(q_MachineFaultActive) XIC(i_SafetyOK) MOV(${SUP_IDLE},Control.StateReg);`));

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

  // ── Published status bits (read by every station's R01_Inputs) ─────────
  rungs.push(buildRung(rungNum++,
    'Publish q_ManualMode - Stations read \\Supervisor.q_ManualMode',
    `XIC(Status.State[${SUP_MANUAL}]) OTE(q_ManualMode);`));

  rungs.push(buildRung(rungNum++,
    'Publish q_SafetyOK - Stations read \\Supervisor.q_SafetyOK',
    'XIC(i_SafetyOK) OTE(q_SafetyOK);'));

  rungs.push(buildRung(rungNum++,
    'Publish q_FaultReset - Stations read \\Supervisor.q_FaultReset',
    'XIC(HMI_FaultReset) OTE(q_FaultReset);'));

  rungs.push(buildRung(rungNum++,
    'Publish q_CycleStopped - Stations read \\Supervisor.q_CycleStopped',
    `[XIC(Status.State[${SUP_IDLE}]) ,XIC(Status.State[${SUP_FAULTED}])] OTE(q_CycleStopped);`));

  // Cycle start latch (AutoReady + CycleStartCmd → OTL)
  rungs.push(buildRung(rungNum++,
    'Cycle Start Latch - Latch on cycle start command in Auto Ready',
    `XIC(Status.State[${SUP_AUTO_READY}]) XIC(HMI_CycleStartCmd) OTL(q_CycleStartLatch);`));

  // Cycle start delay timer
  rungs.push(buildRung(rungNum++,
    'Cycle Start Delay Timer',
    'XIC(q_CycleStartLatch) TON(CycleStartDelay,?,?);'));

  // Machine Running (latch DN + delay done)
  rungs.push(buildRung(rungNum++,
    'Machine Running - Cycle start latched and delay complete',
    'XIC(q_CycleStartLatch) XIC(CycleStartDelay.DN) OTE(q_MachineRunning);'));

  // Cycle stop unlatch
  rungs.push(buildRung(rungNum++,
    'Cycle Stop - Unlatch cycle start on Cycle Stop state',
    `XIC(Status.State[${SUP_CYCLE_STOP}]) OTU(q_CycleStartLatch);`));

  // Fault unlatch
  rungs.push(buildRung(rungNum++,
    'Fault - Unlatch cycle start on Faulted state',
    `XIC(Status.State[${SUP_FAULTED}]) OTU(q_CycleStartLatch);`));

  // Stacklight Green (MachineRunning)
  rungs.push(buildRung(rungNum++,
    'Stacklight Green - Machine is running',
    'XIC(q_MachineRunning) OTE(q_StackGreen);'));

  // Stacklight Yellow (Manual OR AutoInit)
  rungs.push(buildRung(rungNum++,
    'Stacklight Yellow - Manual mode or Auto Init',
    `[XIC(Status.State[${SUP_MANUAL}]) ,XIC(Status.State[${SUP_AUTO_INIT}])] OTE(q_StackYellow);`));

  // Stacklight Red (Faulted OR EStop)
  rungs.push(buildRung(rungNum++,
    'Stacklight Red - Faulted or E-Stop active',
    `[XIC(Status.State[${SUP_FAULTED}]) ,XIC(i_EStopActive)] OTE(q_StackRed);`));

  // Stuck-in-run timer (MachineRunning + !AllStationsReady → TON)
  rungs.push(buildRung(rungNum++,
    'Stuck In Run Watchdog - Timer starts when running but stations not ready',
    'XIC(q_MachineRunning) XIO(AllStationsReady) TON(StuckInRunTimer,?,?);'));

  // Stuck-in-run fault (timer.DN → OTL FaultActive)
  rungs.push(buildRung(rungNum++,
    'Stuck In Run Fault - Latch fault if watchdog expires',
    'XIC(StuckInRunTimer.DN) OTL(q_MachineFaultActive);'));

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
