/**
 * Supervisor Program L5X Generator — 1116 Molex Production Pattern
 *
 * Auto-generates the Supervisor program that orchestrates all station state machines:
 *  - Mode switching (Manual / Auto)
 *  - Cycle start / stop control
 *  - Safety interlocks
 *  - Stacklight outputs (R03_StackLight)
 *  - Global logic stub (R10_Global)
 *  - EtherNet/IP monitoring stub (R15_EIPMonitor)
 *  - Alarm handling (R20_Alarms)
 *
 * Uses State_Engine_128Max AOI (SDC standard).
 * Reserved state numbers per 1116 Molex:
 *   0  = Safety Stop
 *   1  = Idle (no mode / after reset)
 *   3  = Manual Mode
 *   4  = Auto Init (waiting for stations ready)
 *   6  = Auto Idle (all ready, waiting for cycle start)
 *   8  = Auto Running
 *   10 = Cycle Stopping (finishing current cycle)
 *   12 = Cycle Stopped
 *   127 = Fault
 *
 * Reference: 1116 Molex Supervisor (production standard)
 */

import {
  cdata,
  buildRung,
  buildTimerTagXml,
  buildBoolTagXml,
  buildControlTagXml,
  buildStateEngineTagXml,
  buildStateHistoryTagXml,
  generate128BoolL5K,
  generate128BoolDecorated,
  generateDataTypes,
  generateAOI,
  SCHEMA_REV,
  SOFTWARE_REV,
  CONTROLLER_NAME,
} from './l5xExporter.js';

import { buildProgramName } from './tagNaming.js';

// ── Supervisor reserved state numbers (1116 Molex standard) ─────────────────

const SUP_SAFETY_STOP    = 0;
const SUP_IDLE           = 1;
const SUP_MANUAL         = 3;
const SUP_AUTO_INIT      = 4;
const SUP_AUTO_IDLE      = 6;
const SUP_RUNNING        = 8;
const SUP_CYCLE_STOPPING = 10;
const SUP_CYCLE_STOPPED  = 12;
const SUP_FAULT          = 127;

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
    { step: SUP_SAFETY_STOP,    label: 'Safety Stop' },
    { step: SUP_IDLE,           label: 'Idle - No Mode Selected' },
    { step: SUP_MANUAL,         label: 'Manual Mode' },
    { step: SUP_AUTO_INIT,      label: 'Auto Init - Waiting for Stations Ready' },
    { step: SUP_AUTO_IDLE,      label: 'Auto Idle - All Ready, Waiting for Cycle Start' },
    { step: SUP_RUNNING,        label: 'Auto Running' },
    { step: SUP_CYCLE_STOPPING, label: 'Cycle Stopping - Finishing Current Cycle' },
    { step: SUP_CYCLE_STOPPED,  label: 'Cycle Stopped' },
    { step: SUP_FAULT,          label: 'Faulted - Requires Reset' },
  ];

  const comments = stateComments.map(s =>
    `<Comment Operand=".STATE[${s.step}]">\n${cdata(s.label)}\n</Comment>`
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

// ── Generate all Supervisor tags ────────────────────────────────────────────

function generateSupervisorTags(linkedStations, standardsProfile, machineConfig = {}) {
  const tags = [];

  // ── State engine infrastructure ──────────────────────────────────────────
  tags.push(buildControlTagXml());
  tags.push(buildSupervisorStatusTagXml());
  tags.push(buildStateEngineTagXml());
  tags.push(buildStateHistoryTagXml());

  // ── Output tags (Usage="Output") — published to stations ─────────────────
  tags.push(buildBoolTagXml('q_ManualMode',         'Manual mode active (published to stations)',          'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_SafetyOK',           'Safety circuit OK (published to stations)',           'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_FaultReset',         'Fault reset pulse (published to stations)',           'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_CycleStartLatch',    'Cycle start latched (published to stations)',         'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_CycleStopped',       'Machine cycle stopped (published to stations)',       'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_MachineRunning',     'Machine actively running cycles',                    'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_MachineFaultActive', 'One or more stations have an active fault',          'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_StackGreen',         'Stacklight - Green (running)',                       'Output'));
  tags.push(buildBoolTagXml('q_StackYellow',        'Stacklight - Yellow (manual/init)',                  'Output'));
  tags.push(buildBoolTagXml('q_StackRed',           'Stacklight - Red (faulted/safety)',                  'Output'));
  tags.push(buildBoolTagXml('q_AlarmHorn',          'Alarm horn output',                                  'Output'));
  tags.push(buildBoolTagXml('q_AlarmActive',        'Supervisor alarm active',                            'Output', 'Read Only'));
  tags.push(buildBoolTagXml('q_WarningActive',      'Supervisor warning active',                          'Output', 'Read Only'));

  // ── Input tags (Usage="Input") — CE maps post-import ─────────────────────
  tags.push(buildBoolTagXml('i_CycleStart',    'Cycle start pushbutton',       'Input'));
  tags.push(buildBoolTagXml('i_CycleStop',     'Cycle stop pushbutton',        'Input'));
  tags.push(buildBoolTagXml('i_FaultReset',    'Fault reset pushbutton',       'Input'));
  tags.push(buildBoolTagXml('i_SafetyOK',      'Safety circuit OK',            'Input'));
  tags.push(buildBoolTagXml('i_AirPressure',   'Air pressure OK',              'Input'));

  // ── Internal tags ────────────────────────────────────────────────────────
  tags.push(buildBoolTagXml('AllSMInAuto',     'All station SMs in auto mode'));
  tags.push(buildBoolTagXml('MachineStopped',  'All stations completed and stopped'));
  tags.push(buildBoolTagXml('StartOK',         'All stations report start OK'));
  tags.push(buildBoolTagXml('ManualMode',      'Local copy - manual mode active'));
  tags.push(buildBoolTagXml('SafetyOK',        'Local copy - safety OK'));
  tags.push(buildBoolTagXml('FaultReset',      'Local copy - fault reset'));
  tags.push(buildBoolTagXml('CycleRunning',    'Local copy - cycle currently running'));

  // HMI interface
  tags.push(buildBoolTagXml('HMI_ModeAuto',    'HMI - Auto mode selected',     'Input'));
  tags.push(buildBoolTagXml('i_ManualMode',    'HMI/Selector - Manual mode',   'Input'));

  // Timers
  tags.push(buildTimerTagXml('CycleStartDelay',  'Delay after cycle start before running',
    standardsProfile.cycleStartDelay ?? 2000));
  tags.push(buildTimerTagXml('StuckInRunTimer',   'Stuck in run watchdog timer',
    standardsProfile.stuckInRunTimeout ?? 10000));

  // Alarm arrays
  tags.push(`
<Tag Name="Alarm" TagType="Base" DataType="AlarmData" Dimensions="10" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Supervisor Alarm Data')}
</Description>
</Tag>`);

  // Program fault handler AOI instance
  tags.push(`
<Tag Name="ProgramFaultHandler" TagType="Base" DataType="ProgramAlarmHandler" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Program Alarm Handler Instance')}
</Description>
</Tag>`);

  // Per-station lockout tags
  for (const ls of linkedStations) {
    if (ls.hasLockout) {
      const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
      tags.push(buildBoolTagXml(lockoutTag,
        `Lockout - S${String(ls.stationNumber).padStart(2, '0')} ${ls.stationName}`, 'Input'));
    }
  }

  // ── Indexing machine-specific tags ──────────────────────────────────────
  const machineType = machineConfig?.machineType ?? 'indexing';
  if (machineType === 'indexing') {
    // IndexComplete — set when indexer has completed its rotation
    tags.push(buildBoolTagXml('IndexComplete', 'Indexer rotation complete - stations may begin processing', 'Output', 'Read Only'));

    // IndexAngle — current indexer angle (REAL) for mid-index start
    tags.push(`
<Tag Name="IndexAngle" TagType="Base" DataType="REAL" Radix="Float" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Current indexer angle (degrees) - used for mid-index start gating')}
</Description>
</Tag>`);

    // StationStatus array — one per station for part tracking/reject status on dial machines
    // Uses a simple struct with Reject BOOL per station
    const maxStation = linkedStations.reduce((max, ls) => Math.max(max, ls.stationNumber ?? 0), 0);
    const stationStatusDim = Math.max(maxStation + 1, 91); // match 1116 pattern of 91 slots
    tags.push(`
<Tag Name="StationStatus" TagType="Base" DataType="StationStatus" Dimensions="${stationStatusDim}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Per-station part tracking status (dial machines) - StationStatus[stationNum].Reject = skip processing')}
</Description>
</Tag>`);
  }

  return tags.join('\n');
}

// ── R00_Main ────────────────────────────────────────────────────────────────

function generateR00Main() {
  const rungs = [];
  rungs.push(buildRung(0, 'Jump to Inputs',            'JSR(R01_Inputs,0);'));
  rungs.push(buildRung(1, 'Jump to State Transitions',  'JSR(R02_StateTransitions,0);'));
  rungs.push(buildRung(2, 'Jump to StackLight',         'JSR(R03_StackLight,0);'));
  rungs.push(buildRung(3, 'Jump to Global Logic',       'JSR(R10_Global,0);'));
  rungs.push(buildRung(4, 'Jump to EIP Monitor',        'JSR(R15_EIPMonitor,0);'));
  rungs.push(buildRung(5, 'Jump to Alarms',             'JSR(R20_Alarms,0);'));

  return `
<Routine Name="R00_Main" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R01_Inputs — Station aggregation + safety mapping ───────────────────────

function generateR01Inputs(linkedStations) {
  const rungs = [];
  let rungNum = 0;

  // Rung 0: Safety input → local copy
  rungs.push(buildRung(rungNum++,
    'Safety input mapping',
    'XIC(i_SafetyOK)OTE(SafetyOK);'));

  // Rung 1: All stations in auto mode
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls => {
      const contact = `XIC(\\${ls.programName}.q_AutoMode)`;
      if (ls.hasLockout) {
        const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
        return `[${contact} ,XIC(${lockoutTag})]`;
      }
      return contact;
    });
    rungs.push(buildRung(rungNum++,
      'All stations in auto mode',
      `${contacts.join('')}OTE(AllSMInAuto);`));
  } else {
    rungs.push(buildRung(rungNum++,
      'All stations in auto mode - No stations linked',
      'OTE(AllSMInAuto);'));
  }

  // Rung 2: All stations stopped
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls => {
      const contact = `XIC(\\${ls.programName}.q_AutoStopped)`;
      if (ls.hasLockout) {
        const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
        return `[${contact} ,XIC(${lockoutTag})]`;
      }
      return contact;
    });
    rungs.push(buildRung(rungNum++,
      'All stations stopped',
      `${contacts.join('')}OTE(MachineStopped);`));
  } else {
    rungs.push(buildRung(rungNum++,
      'All stations stopped - No stations linked',
      'OTE(MachineStopped);'));
  }

  // Rung 3: Start OK — all stations report start OK
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls => {
      const contact = `XIC(\\${ls.programName}.q_StartOK)`;
      if (ls.hasLockout) {
        const lockoutTag = `Lockout_S${String(ls.stationNumber).padStart(2, '0')}`;
        return `[${contact} ,XIC(${lockoutTag})]`;
      }
      return contact;
    });
    rungs.push(buildRung(rungNum++,
      'Start OK - All stations ready to start',
      `${contacts.join('')}OTE(StartOK);`));
  } else {
    rungs.push(buildRung(rungNum++,
      'Start OK - No stations linked',
      'OTE(StartOK);'));
  }

  // Rung 4: Any station fault → q_MachineFaultActive
  if (linkedStations.length > 0) {
    const contacts = linkedStations.map(ls =>
      `XIC(\\${ls.programName}.q_AlarmActive)`
    );
    rungs.push(buildRung(rungNum++,
      'Any station fault active',
      `[${contacts.join(' ,')}]OTE(q_MachineFaultActive);`));
  } else {
    rungs.push(buildRung(rungNum++,
      'Any station fault active - No stations linked',
      'OTU(q_MachineFaultActive);'));
  }

  // Rung 5: Manual mode input → local copy + output
  rungs.push(buildRung(rungNum++,
    'Manual mode mapping',
    'XIC(i_ManualMode)OTE(ManualMode);'));

  // Rung 6: Fault reset input → local copy
  rungs.push(buildRung(rungNum++,
    'Fault reset mapping',
    'XIC(i_FaultReset)OTE(FaultReset);'));

  return `
<Routine Name="R01_Inputs" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R02_StateTransitions — MOVE(N,Control.StateReg) pattern ─────────────────

function generateR02StateTransitions() {
  const rungs = [];
  let rungNum = 0;

  // Rung 0: Safety Stop (state 0) — from ANY state when safety lost or first scan
  rungs.push(buildRung(rungNum++,
    'Safety Stop (state 0) - From any state when safety lost or first scan',
    `[XIO(SafetyOK) ,XIC(S:FS)]MOVE(${SUP_SAFETY_STOP},Control.StateReg);`));

  // Rung 1: Idle (state 1) — from safety stop (0) when safety restored
  rungs.push(buildRung(rungNum++,
    'Idle (state 1) - From safety stop when safety restored',
    `XIC(Status.State[${SUP_SAFETY_STOP}])XIC(SafetyOK)MOVE(${SUP_IDLE},Control.StateReg);`));

  // Rung 2: Manual (state 3) — from idle (1) or auto idle (6) when manual selected
  rungs.push(buildRung(rungNum++,
    'Manual (state 3) - From idle or auto idle when manual mode selected',
    `[XIC(Status.State[${SUP_IDLE}]) ,XIC(Status.State[${SUP_AUTO_IDLE}])]XIC(i_ManualMode)MOVE(${SUP_MANUAL},Control.StateReg);`));

  // Rung 3: Auto Init (state 4) — from idle (1) when auto selected and not manual
  rungs.push(buildRung(rungNum++,
    'Auto Init (state 4) - From idle when auto mode selected',
    `XIC(Status.State[${SUP_IDLE}])XIC(HMI_ModeAuto)XIO(q_ManualMode)MOVE(${SUP_AUTO_INIT},Control.StateReg);`));

  // Rung 4: Auto Idle (state 6) — from init (4) when all stations ready
  rungs.push(buildRung(rungNum++,
    'Auto Idle (state 6) - From auto init when all stations report start OK',
    `XIC(Status.State[${SUP_AUTO_INIT}])XIC(StartOK)MOVE(${SUP_AUTO_IDLE},Control.StateReg);`));

  // Rung 5: Running (state 8) — from auto idle (6) when cycle start latched
  rungs.push(buildRung(rungNum++,
    'Running (state 8) - From auto idle when cycle start latched',
    `XIC(Status.State[${SUP_AUTO_IDLE}])XIC(q_CycleStartLatch)MOVE(${SUP_RUNNING},Control.StateReg);`));

  // Rung 6: Cycle Stopping (state 10) — from running (8) when cycle start unlatched
  rungs.push(buildRung(rungNum++,
    'Cycle Stopping (state 10) - From running when cycle start unlatched',
    `XIC(Status.State[${SUP_RUNNING}])XIO(q_CycleStartLatch)MOVE(${SUP_CYCLE_STOPPING},Control.StateReg);`));

  // Rung 7: Cycle Stopped (state 12) — from stopping (10) when all stations stopped
  rungs.push(buildRung(rungNum++,
    'Cycle Stopped (state 12) - From cycle stopping when all stations stopped',
    `XIC(Status.State[${SUP_CYCLE_STOPPING}])XIC(MachineStopped)MOVE(${SUP_CYCLE_STOPPED},Control.StateReg);`));

  // Rung 8: Back to auto idle (6) from cycle stopped (12)
  rungs.push(buildRung(rungNum++,
    'Auto Idle (state 6) - Return from cycle stopped',
    `XIC(Status.State[${SUP_CYCLE_STOPPED}])MOVE(${SUP_AUTO_IDLE},Control.StateReg);`));

  // Rung 9: Fault (state 127) — from any auto state when alarm active
  rungs.push(buildRung(rungNum++,
    'Fault (state 127) - From any state when alarm active',
    `[XIC(Status.State[${SUP_AUTO_INIT}]) ,XIC(Status.State[${SUP_AUTO_IDLE}]) ,XIC(Status.State[${SUP_RUNNING}]) ,XIC(Status.State[${SUP_CYCLE_STOPPING}])]XIC(q_AlarmActive)MOVE(${SUP_FAULT},Control.StateReg);`));

  // Rung 10: Fault → Idle (state 1) — when fault reset and no active alarms and safety OK
  rungs.push(buildRung(rungNum++,
    'Fault Reset - Return to idle when faults cleared and safety OK',
    `XIC(Status.State[${SUP_FAULT}])XIC(FaultReset)XIO(q_AlarmActive)XIC(SafetyOK)MOVE(${SUP_IDLE},Control.StateReg);`));

  // Rung 11: Manual → Idle when manual deselected
  rungs.push(buildRung(rungNum++,
    'Manual → Idle - Return to idle when manual mode deselected',
    `XIC(Status.State[${SUP_MANUAL}])XIO(i_ManualMode)MOVE(${SUP_IDLE},Control.StateReg);`));

  // Rung 12: Auto Init → Idle when auto deselected
  rungs.push(buildRung(rungNum++,
    'Auto Init → Idle - Return to idle when auto mode deselected',
    `XIC(Status.State[${SUP_AUTO_INIT}])XIO(HMI_ModeAuto)MOVE(${SUP_IDLE},Control.StateReg);`));

  // Rung 13: Cycle Start Latch — set
  rungs.push(buildRung(rungNum++,
    'Cycle Start Latch - Latch on when cycle start pressed in auto idle with start OK',
    `XIC(Status.State[${SUP_AUTO_IDLE}])XIC(i_CycleStart)XIC(i_CycleStop)XIC(StartOK)OTL(q_CycleStartLatch);`));

  // Rung 14: Cycle Start Latch — unlatch on cycle stop
  rungs.push(buildRung(rungNum++,
    'Cycle Start Unlatch - Unlatch when cycle stop pressed',
    `XIO(i_CycleStop)OTU(q_CycleStartLatch);`));

  // Rung 15: State Engine AOI call
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

// ── R03_StackLight — Dedicated stacklight routine ───────────────────────────

function generateR03StackLight() {
  const rungs = [];
  let rungNum = 0;

  // Rung 0: Publish q_ManualMode
  rungs.push(buildRung(rungNum++,
    'Publish q_ManualMode - Stations read \\Supervisor.q_ManualMode',
    `XIC(Status.State[${SUP_MANUAL}])OTE(q_ManualMode);`));

  // Rung 1: Publish q_SafetyOK
  rungs.push(buildRung(rungNum++,
    'Publish q_SafetyOK - Stations read \\Supervisor.q_SafetyOK',
    'XIC(SafetyOK)OTE(q_SafetyOK);'));

  // Rung 2: Publish q_FaultReset
  rungs.push(buildRung(rungNum++,
    'Publish q_FaultReset - Stations read \\Supervisor.q_FaultReset',
    'XIC(FaultReset)OTE(q_FaultReset);'));

  // Rung 3: Publish q_CycleStopped
  rungs.push(buildRung(rungNum++,
    'Publish q_CycleStopped',
    `[XIC(Status.State[${SUP_IDLE}]) ,XIC(Status.State[${SUP_CYCLE_STOPPED}]) ,XIC(Status.State[${SUP_FAULT}])]OTE(q_CycleStopped);`));

  // Rung 4: Publish q_MachineRunning
  rungs.push(buildRung(rungNum++,
    'Publish q_MachineRunning',
    `XIC(Status.State[${SUP_RUNNING}])OTE(q_MachineRunning);`));

  // Rung 5: Stacklight Green — machine is running (state 8)
  rungs.push(buildRung(rungNum++,
    'Stacklight Green - Machine is running',
    `XIC(Status.State[${SUP_RUNNING}])OTE(q_StackGreen);`));

  // Rung 6: Stacklight Yellow — manual mode (3) or auto init (4)
  rungs.push(buildRung(rungNum++,
    'Stacklight Yellow - Manual mode or Auto Init',
    `[XIC(Status.State[${SUP_MANUAL}]) ,XIC(Status.State[${SUP_AUTO_INIT}])]OTE(q_StackYellow);`));

  // Rung 7: Stacklight Red — faulted (127) or safety stop (0)
  rungs.push(buildRung(rungNum++,
    'Stacklight Red - Faulted or Safety Stop',
    `[XIC(Status.State[${SUP_FAULT}]) ,XIC(Status.State[${SUP_SAFETY_STOP}])]OTE(q_StackRed);`));

  // Rung 8: Alarm Horn — faulted state
  rungs.push(buildRung(rungNum++,
    'Alarm Horn - Active during fault',
    `XIC(Status.State[${SUP_FAULT}])OTE(q_AlarmHorn);`));

  return `
<Routine Name="R03_StackLight" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R10_Global — Stub for global logic ──────────────────────────────────────

function generateR10Global() {
  const rungs = [];

  rungs.push(buildRung(0,
    'Global logic - AOI_MachineBasic, CPU_TimeDate, dry cycle (placeholder)',
    'NOP();'));

  return `
<Routine Name="R10_Global" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R15_EIPMonitor — Stub for EtherNet/IP monitoring ────────────────────────

function generateR15EIPMonitor() {
  const rungs = [];

  rungs.push(buildRung(0,
    'EtherNet/IP connection monitoring (placeholder)',
    'NOP();'));

  return `
<Routine Name="R15_EIPMonitor" Type="RLL">
<RLLContent>
${rungs.join('\n')}
</RLLContent>
</Routine>`;
}

// ── R20_Alarms — Supervisor-level alarms + ProgramAlarmHandler ──────────────

function generateR20Alarms() {
  const rungs = [];
  let rungNum = 0;

  // Rung 0: Alarm[0] — Safety circuit fault (self-latching)
  rungs.push(buildRung(rungNum++,
    'Alarm[0] - Safety Circuit Fault',
    `XIO(SafetyOK)[OTE(Alarm[0].Trigger) ,OTL(Alarm[0].Latch)];XIC(FaultReset)OTU(Alarm[0].Latch);`));

  // Rung 1: Alarm[1] — Air pressure loss (self-latching)
  rungs.push(buildRung(rungNum++,
    'Alarm[1] - Air Pressure Loss',
    `XIO(i_AirPressure)[OTE(Alarm[1].Trigger) ,OTL(Alarm[1].Latch)];XIC(FaultReset)OTU(Alarm[1].Latch);`));

  // Rung 2: Alarm[2] — Station fault escalation (self-latching)
  rungs.push(buildRung(rungNum++,
    'Alarm[2] - Station Fault Escalation',
    `XIC(q_MachineFaultActive)[OTE(Alarm[2].Trigger) ,OTL(Alarm[2].Latch)];XIC(FaultReset)OTU(Alarm[2].Latch);`));

  // Rung 3: Alarm[3] — Stuck in run watchdog
  rungs.push(buildRung(rungNum++,
    'Alarm[3] - Stuck In Run Watchdog',
    `XIC(q_MachineRunning)XIO(MachineStopped)TON(StuckInRunTimer,?,?);`));
  rungs.push(buildRung(rungNum++,
    'Alarm[3] - Stuck In Run Latch',
    `XIC(StuckInRunTimer.DN)[OTE(Alarm[3].Trigger) ,OTL(Alarm[3].Latch)];XIC(FaultReset)OTU(Alarm[3].Latch);`));

  // Rung 5: ProgramAlarmHandler AOI call
  rungs.push(buildRung(rungNum++,
    'ProgramAlarmHandler AOI - Process alarms, set q_AlarmActive/q_WarningActive',
    'ProgramAlarmHandler(ProgramFaultHandler,\\Alarms.p_ProgramID,Alarm,\\Alarms.p_Active,\\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);'));

  return `
<Routine Name="R20_Alarms" Type="RLL">
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

  const machineConfig = project.machineConfig ?? {};
  const tagsXml = generateSupervisorTags(linkedStations, standardsProfile, machineConfig);
  const r00 = generateR00Main();
  const r01 = generateR01Inputs(linkedStations);
  const r02 = generateR02StateTransitions();
  const r03 = generateR03StackLight();
  const r10 = generateR10Global();
  const r15 = generateR15EIPMonitor();
  const r20 = generateR20Alarms();

  return `<Program Use="Target" Name="${programName}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata('Supervisor - Machine orchestration, mode control, safety, stacklight, alarms - Auto-generated by SDC State Logic Builder (1116 Molex pattern)')}
</Description>
<Tags>
${tagsXml}
</Tags>
<Routines>
${r00}
${r01}
${r02}
${r03}
${r10}
${r15}
${r20}
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
