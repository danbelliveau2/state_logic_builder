#!/usr/bin/env node
'use strict';
/**
 * author1160S03.cjs — JOB 1160 S03_YSiteInspectA/B on Jason's IV4 standard shape (2026-09-17)
 *
 * Source of every rung: generated/1160/ref/Jason_IV4/S06_IV4Vision/Program_S06_IV4Vision.xml (Jason's
 * Keyence IV4 example, indexer station 6), copied rung for rung and adapted ONLY as
 * generated/1160/build/IV4_SPEC.md section 4 says:
 *   - chassis window (Chassis_CamPos_Check at g_S03_InspectTriggerAngle) instead of \S00_IndexerSP.q_WaitStationsComplete
 *   - two cameras per side (tag suffix Branch / Trunk), AND on the transitions and the results
 *   - two-up side members (PartLoadedA, AttemptA/SuccessA/FailureA/LockoutA, FailureTypeA/MessageA, BypassA/LockoutA, PerformData *A)
 *   - contract names (cam01..cam04 buffers, g_StationList[3], FailureType 31/32/33)
 *   - Jason's 2026-09-17 rule: R02 holds transitions only (Attempt latch + Cycle Time live in R03)
 *   - Jason's 2026-09-01 rules: CONCAT(g_StationList[StaNum], suffix), ConsecFails.Setpoint 3, prefix sets Usage
 *   - Jason's 2026-09-10 rule: single-step block in R01 of every program
 * Deviations from the example and the rule forcing each: IV4_SPEC.md section 12.
 *
 * Also applies the controller-side edits the spec lists for S03 (sections 2, 6, 7):
 *   - Modules.xml: six IV4 generic modules resized to Jason's connection (394 in / 12 out, INT[197] / INT[6]), one-line descriptions
 *   - ControllerTags.xml: the twelve camNN_*_IN/_OUT buffers retyped to match
 *   - MapInputs.xml / MapOutputs.xml: the six camera CPS rung comments = one plain line naming the device (Jason 2026-09-17)
 *   - ParameterConnections.xml: 32 lines (16 per S03 twin) camera buffer bit <-> program parameter
 * (S07's 16 connections are NOT emitted here: S07_PortCutA/B do not declare the camera parameters yet, and a
 *  connection whose parameter is missing cancels the whole import - Jason 2026-08-31.)
 *
 * Run:   node scripts/author1160S03.cjs            (writes; idempotent)
 *        node scripts/author1160S03.cjs --check    (writes nothing; reports what would change)
 * Then:  node scripts/assemble1160.cjs --name <n> --ref-dir generated/1160/ref/ChassisStandard_2UP --template "plc-reference/training-material/SDC Standard Templates/ChassisStandard_2UP_2026-09-17.L5X"
 *        node scripts/validate1160.cjs generated/1160/out/<n>.L5X --baseline "plc-reference/training-material/SDC Standard Templates/ChassisStandard_2UP_2026-09-17.L5X"
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'generated', '1160', 'build');
const PROGRAMS = path.join(BUILD, 'programs');
const CONTROLLER = path.join(BUILD, 'controller');
const CHECK_ONLY = process.argv.includes('--check');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

const CRLF = '\r\n';
const readCrlf = (p) => fs.readFileSync(p, 'utf8');
function writeCrlf(p, text) {
  const out = text.replace(/\r?\n/g, CRLF);
  if (/[^\x00-\x7F]/.test(out)) throw new Error(`non-ASCII in ${rel(p)}`);
  if (CHECK_ONLY) { console.log(`[check] would write ${rel(p)} (${out.length} bytes)`); return; }
  fs.writeFileSync(p, out, 'utf8');
  console.log(`wrote ${rel(p)} (${out.length} bytes)`);
}

// ── the twin table (IV4_SPEC.md 4.1) ─────────────────────────────────────────
const SIDES = {
  A: { S: 'A', SIDE: 'A', NEST: 'left', ME: 'S03_YSiteInspectA', TWIN: 'S03_YSiteInspectB', BR: 'cam03_LeftBranchInspect', TR: 'cam04_LeftTrunkInspect', BRIP: '192.168.1.33', TRIP: '192.168.1.34' },
  B: { S: 'B', SIDE: 'B', NEST: 'right', ME: 'S03_YSiteInspectB', TWIN: 'S03_YSiteInspectA', BR: 'cam01_RightBranchInspect', TR: 'cam02_RightTrunkInspect', BRIP: '192.168.1.31', TRIP: '192.168.1.32' },
};
const fill = (text, side) => text.replace(/\{(S|SIDE|NEST|ME|TWIN|BR|TR|BRIP|TRIP)\}/g, (_, k) => side[k]);

// ── L5X tag helpers (shapes copied from Jason's export) ──────────────────────
const cdata = (s) => `<![CDATA[${s}]]>`;
const STRING_LEN = 82;   // STRING = 82 SINT
const STRING100_LEN = 100;
const pad00 = (n) => '$00'.repeat(n);
const strL5k = (s, cap) => `[${s.length},'${s}${pad00(cap - s.length)}']`;
const radixOf = (t) => (t === 'REAL' ? 'Float' : 'Decimal');

function descBlock(desc) { return desc ? `<Description>\n${cdata(desc)}\n</Description>\n` : ''; }
function commentsBlock(comments) {
  if (!comments) return '';
  return `<Comments>\n${comments.map(([op, txt]) => `<Comment Operand="${op}">\n${cdata(txt)}\n</Comment>`).join('\n')}\n</Comments>\n`;
}

/** Atomic tag (BOOL/DINT/INT/SINT/REAL) with L5K + Decorated data. usage: 'Input'|'Output'|'Public'|null */
function atomic(name, type, { usage = null, desc = null, comments = null } = {}) {
  const ext = usage === 'Output' ? 'Read Only' : 'Read/Write';
  const usageAttr = usage ? ` Usage="${usage}"` : '';
  const l5k = type === 'REAL' ? '0.00000000e+000' : '0';
  const dec = type === 'REAL' ? '0.0' : '0';
  return `<Tag Name="${name}" TagType="Base" DataType="${type}" Radix="${radixOf(type)}"${usageAttr} Constant="false" ExternalAccess="${ext}" OpcUaAccess="None">\n` +
    descBlock(desc) + commentsBlock(comments) +
    `<Data Format="L5K">\n${cdata(l5k)}\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="${type}" Radix="${radixOf(type)}" Value="${dec}"/>\n</Data>\n</Tag>`;
}

/** STRING[n] array with LEN/DATA (Jason's AlarmList / FailureMessages shape). Strings must be final text (no placeholders). */
function stringArray(name, strs, desc = null) {
  for (const s of strs) { if (/\{[A-Z]+\}/.test(s)) throw new Error(`${name}: unfilled placeholder in "${s}" - LEN/padding would be wrong`); if (s.length > STRING_LEN) throw new Error(`${name}: "${s}" exceeds STRING (${STRING_LEN})`); }
  const l5k = `[${strs.map((s) => strL5k(s, STRING_LEN)).join(',')}]`;
  const els = strs.map((s, i) => `<Element Index="[${i}]">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${s.length}"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n${cdata(s ? `'${s}'` : '')}\n</DataValueMember>\n</Structure>\n</Element>`).join('\n');
  return `<Tag Name="${name}" TagType="Base" DataType="STRING" Dimensions="${strs.length}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n` +
    descBlock(desc) +
    `<Data Format="L5K">\n${cdata(l5k)}\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="${strs.length}">\n${els}\n</Array>\n</Data>\n</Tag>`;
}

/** AlarmData[n] (Jason's Alarm shape). */
function alarmArray(name, n, desc = null) {
  const elL5k = `[0,0,0,0,[0,'${pad00(STRING100_LEN)}'],0,0,0,0]`;
  const l5k = `[${Array.from({ length: n }, () => elL5k).join(',')}]`;
  const el = (i) => `<Element Index="[${i}]">\n<Structure DataType="AlarmData">\n<DataValueMember Name="ProgramID" DataType="INT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="AlarmID" DataType="INT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Severity" DataType="INT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Group" DataType="INT" Radix="Decimal" Value="0"/>\n<StructureMember Name="Message" DataType="STRING100">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII">\n${cdata('')}\n</DataValueMember>\n</StructureMember>\n<DataValueMember Name="TimeStamp" DataType="LINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Duration" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Active" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DoNotSaveToHistory" DataType="BOOL" Value="0"/>\n<DataValueMember Name="HMI_ResetCount" DataType="BOOL" Value="0"/>\n</Structure>\n</Element>`;
  return `<Tag Name="${name}" TagType="Base" DataType="AlarmData" Dimensions="${n}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n` +
    descBlock(desc) +
    `<Data Format="L5K">\n${cdata(l5k)}\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="${n}">\n${Array.from({ length: n }, (_, i) => el(i)).join('\n')}\n</Array>\n</Data>\n</Tag>`;
}

function programAlarmHandler() {
  const l5k = `[1,0,0,0,0,0,0,0,0,0,0,[0,0,0,0,[0,'${pad00(STRING100_LEN)}'],0,0,0,0],0]`;
  return `<Tag Name="AOI_ProgramAlarmHandler" TagType="Base" DataType="ProgramAlarmHandler" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n${cdata(l5k)}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="ProgramAlarmHandler">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>\n<DataValueMember Name="AlarmActiveTag" DataType="BOOL" Value="0"/>\n<DataValueMember Name="ActiveAlarmArrayIndex" DataType="INT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="ActiveAlarmDuration" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="MyProgramID" DataType="INT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="WarningActiveTag" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
}

function consecFails(desc) {
  return `<Tag Name="ConsecFails" TagType="Base" DataType="ConsecFails" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n` + descBlock(desc) +
    `<Data Format="L5K">\n${cdata('[0,3]')}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="ConsecFails">\n<DataValueMember Name="Count" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Setpoint" DataType="DINT" Radix="Decimal" Value="3"/>\n</Structure>\n</Data>\n</Tag>`;
}

function controlTag() {
  return `<Tag Name="Control" TagType="Base" DataType="StateLogicControl" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n${cdata('[0,0,0,0]')}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="StateLogicControl">\n<DataValueMember Name="StateReg" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="EnaFaultDetect" DataType="BOOL" Value="0"/>\n<DataValueMember Name="EnaTransitionTimer" DataType="BOOL" Value="0"/>\n<DataValueMember Name="FaultTime" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="TransitionTime" DataType="DINT" Radix="Decimal" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
}

function timerTag(name) {
  return `<Tag Name="${name}" TagType="Base" DataType="TIMER" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n${cdata('[0,0,0]')}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="TIMER">\n<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="EN" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TT" DataType="BOOL" Value="0"/>\n<DataValueMember Name="DN" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
}

/** State_Engine_128Max instance - L5K copied verbatim from Jason's export (AOI revision 5.0 in both projects). */
function stateEngineTag() {
  const bits = Array.from({ length: 128 }, () => '2#0').join(',');
  const l5k = `[1,[1,0,0,0,0,0,0,0,0,4,0,0],0,0,[1,0,0,0,0,0,0,0,0,4,0,0],[[${bits}],0,0],0]`;
  return `<Tag Name="StateEngine" TagType="Base" DataType="State_Engine_128Max" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n${cdata(l5k)}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="State_Engine_128Max">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
}

function stateHistoryTag() {
  const els = Array.from({ length: 10 }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n');
  return `<Tag Name="StateHistory" TagType="Base" DataType="SINT" Dimensions="10" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n${cdata('[0,0,0,0,0,0,0,0,0,0]')}\n</Data>\n<Data Format="Decorated">\n<Array DataType="SINT" Dimensions="10" Radix="Decimal">\n${els}\n</Array>\n</Data>\n</Tag>`;
}

function stationPerformanceTag() {
  return `<Tag Name="StationPerformance" TagType="Base" DataType="StationPerformance" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n${cdata('[1,0.00000000e+000,0.00000000e+000,0.00000000e+000,0,0.00000000e+000]')}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="StationPerformance">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Attempt" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Success" DataType="BOOL" Value="0"/>\n<DataValueMember Name="PerformLow" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="PerformHigh" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="Efficiency" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="HMIColorStatus" DataType="DINT" Radix="Decimal" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
}

/** StateLogicStatus with the state comments (Jason's shape; comments per IV4_SPEC.md 4.2). */
function statusTag(stateComments) {
  const bits = Array.from({ length: 128 }, () => '2#0').join(',');
  const els = Array.from({ length: 128 }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n');
  return `<Tag Name="Status" TagType="Base" DataType="StateLogicStatus" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n` +
    commentsBlock(stateComments.map(([n, t]) => [`.STATE[${n}]`, t])) +
    `<Data Format="L5K">\n${cdata(`[[${bits}],0,0]`)}\n</Data>\n<Data Format="Decorated">\n<Structure DataType="StateLogicStatus">\n<ArrayMember Name="State" DataType="BOOL" Dimensions="128" Radix="Decimal">\n${els}\n</ArrayMember>\n<DataValueMember Name="PreviousState" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="StateChangeOccurred_OS" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TimeoutFlt" DataType="BOOL" Value="0"/>\n<DataValueMember Name="TransitionTimerDone" DataType="BOOL" Value="0"/>\n</Structure>\n</Data>\n</Tag>`;
}

/** AOI instance tag without data (S07_PortCutA / 2-UP template form for Chassis_CamPos_Check). */
function aoiInstance(name, type, desc) {
  return `<Tag Name="${name}" TagType="Base" DataType="${type}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n${descBlock(desc)}</Tag>`;
}

function rung(n, text, comment = null) {
  return `<Rung Number="${n}" Type="N">\n` + (comment ? `<Comment>\n${cdata(comment)}\n</Comment>\n` : '') + `<Text>\n${cdata(text)}\n</Text>\n</Rung>`;
}
function routine(name, rungs) {
  return `<Routine Name="${name}" Type="RLL">\n<RLLContent>\n${rungs.map((r, i) => rung(i, r[0], r[1] || null)).join('\n')}\n</RLLContent>\n</Routine>`;
}

// Studio sorts program tags case-insensitively with '_' after letters (Jason's export: Initialized, InspectionComplete, i_bCamera...).
const studioKey = (name) => name.toLowerCase().replace(/_/g, '~');
const sortTags = (tags) => tags.slice().sort((a, b) => (studioKey(a.name) < studioKey(b.name) ? -1 : 1));

// ── the program (IV4_SPEC.md section 4; placeholders filled per side) ─────────
const R = String.raw;

function buildProgram(side) {
  const camDesc = (role, node, ip, what) => `${role} camera ${node} (${ip}) - ${what}`;
  const tags = [];
  const T = (name, xml) => tags.push({ name, xml });
  // STRING array contents are filled BEFORE the tag is built: LEN and the $00 padding to 82 are computed from the
  // final text ('Side A ...'), never from the placeholder form ('Side {SIDE} ...').
  const F = (strs) => strs.map((s) => fill(s, side));

  // Parameters (prefix sets Usage - Jason 2026-09-01)
  for (const [role, node, ip] of [['Branch', '{BR}', '{BRIP}'], ['Trunk', '{TR}', '{TRIP}']]) {
    T(`i_CameraReady${role}`, atomic(`i_CameraReady${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Ready (${node}_IN.Data[1].5)`) }));
    T(`i_CameraTriggerReady${role}`, atomic(`i_CameraTriggerReady${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Trigger Ready (${node}_IN.Data[1].6)`) }));
    T(`i_CameraRun${role}`, atomic(`i_CameraRun${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Run mode (${node}_IN.Data[1].4)`) }));
    T(`i_CameraResultsAvailable${role}`, atomic(`i_CameraResultsAvailable${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Results Available (${node}_IN.Data[1].0)`) }));
    T(`i_CameraUpdateComplete${role}`, atomic(`i_CameraUpdateComplete${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Update Complete (${node}_IN.Data[1].1)`) }));
    T(`i_bCameraTool1Result${role}`, atomic(`i_bCameraTool1Result${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Tool 1 result OK (${node}_IN.Data[3].0)`) }));
    T(`i_bCameraTool2Result${role}`, atomic(`i_bCameraTool2Result${role}`, 'BOOL', { usage: 'Input', desc: camDesc(role, node, ip, `Tool 2 result OK (${node}_IN.Data[3].1)`) }));
    T(`q_CameraTrigger${role}`, atomic(`q_CameraTrigger${role}`, 'BOOL', { usage: 'Output', desc: camDesc(role, node, ip, `Trigger (${node}_OUT.Data[0].0)`) }));
  }
  T('q_ActuatorsSafe', atomic('q_ActuatorsSafe', 'BOOL', { usage: 'Output', desc: 'Safe to index - no actuators, always on' }));
  T('q_StartOK', atomic('q_StartOK', 'BOOL', { usage: 'Output', desc: 'Both cameras in Run and Ready' }));
  T('q_AlarmActive', atomic('q_AlarmActive', 'BOOL', { usage: 'Output' }));
  T('q_WarningActive', atomic('q_WarningActive', 'BOOL', { usage: 'Output' }));
  T('p_CycleTime', atomic('p_CycleTime', 'REAL', { usage: 'Public', desc: 'Cycle time in seconds (HMI)' }));

  // Locals (Jason's set, chassis-adapted)
  T('Alarm', alarmArray('Alarm', 5));
  T('AlarmList', stringArray('AlarmList', F(['Side {SIDE} Consecutive Failures', 'Side {SIDE} Waiting For Camera Trigger Ready', 'Side {SIDE} Waiting For Camera Results', 'Side {SIDE} Station Bypassed', 'Side {SIDE} Station Locked Out']),
    'Alarm message suffixes; R20 builds Alarm[n].Message = CONCAT(g_StationList[StaNum], AlarmList[n])'));
  T('AOI_ProgramAlarmHandler', programAlarmHandler());
  T('Bypass', atomic('Bypass', 'BOOL'));
  T('CamPosCheckA', aoiInstance('CamPosCheckA', 'Chassis_CamPos_Check', 'Inspect trigger window (g_S03_InspectTriggerAngle, timing advance 0)'));
  T('ConsecFails', consecFails('Side {SIDE} consecutive S03 failures. Setpoint 3 = SDC standard, HMI-settable; Count >= Setpoint = fault'));
  T('Control', controlTag());
  T('CycleRunning', atomic('CycleRunning', 'BOOL'));
  T('CycleStationA', atomic('CycleStationA', 'BOOL', { desc: 'This nest is side {SIDE} to inspect, first pass (no S03 attempt yet)' }));
  T('CycleStopped', atomic('CycleStopped', 'BOOL', { desc: 'Cycle Stopped Override From Supervisor' }));
  T('CycleStopping', atomic('CycleStopping', 'BOOL'));
  T('CycleTimer', timerTag('CycleTimer'));
  T('FailureMessages', stringArray('FailureMessages', F(['Branch Port Not Clear', 'Trunk Port Not Clear', 'Vision No Result', '', '']),
    'Failure message suffixes (FailureType 31, 32, 33); R03 writes CONCAT(g_StationList[StaNum], FailureMessages[n]) to the part record'));
  T('FaultReset', atomic('FaultReset', 'BOOL'));
  T('FaultState', atomic('FaultState', 'DINT'));
  T('RestartState', atomic('RestartState', 'DINT'));
  T('HMI_LocalManualOverride', atomic('HMI_LocalManualOverride', 'BOOL'));
  T('HMI_Momentary', atomic('HMI_Momentary', 'DINT', { comments: [['.0', 'Trigger Branch Camera'], ['.1', 'Trigger Trunk Camera']] }));
  T('HMI_MomentaryOnPrevScan', atomic('HMI_MomentaryOnPrevScan', 'BOOL'));
  T('HMI_Toggle', atomic('HMI_Toggle', 'DINT', {
    desc: 'HMI toggles, SDC fixed bit map: .0 Lockout (not read here - station lockout is Tracking Station[3].OpStatus.Lockout{S}), .1 Dry Run (not read here - a camera station has nothing to dry-run), .2 Single Step (R01 SS block)',
    comments: [['.0', 'Lockout - fixed bit map position, not read here'], ['.1', 'Dry Run - fixed bit map position, not read here'], ['.2', 'Single Step']],
  }));
  T('Initialized', atomic('Initialized', 'BOOL'));
  T('InspectionCompleteBranch', atomic('InspectionCompleteBranch', 'BOOL'));
  T('InspectionCompleteTrunk', atomic('InspectionCompleteTrunk', 'BOOL'));
  T('InspectNestNum', atomic('InspectNestNum', 'DINT', { desc: 'Nest under the cameras, captured at state 7 entry; every tracking write of this inspection uses it (the chassis does not hold the dial for a result)' }));
  T('Lockout', atomic('Lockout', 'BOOL'));
  T('LocalSSONS', atomic('LocalSSONS', 'BOOL'));
  T('ManualMode', atomic('ManualMode', 'BOOL'));
  T('NestNumCurrent', atomic('NestNumCurrent', 'DINT'));
  T('NestNumIncoming', atomic('NestNumIncoming', 'DINT'));
  T('ONS', atomic('ONS', 'DINT'));
  T('SafetyOK', atomic('SafetyOK', 'BOOL'));
  T('SafetyStopState', atomic('SafetyStopState', 'DINT'));
  T('SS', atomic('SS', 'BOOL'));
  T('SS_OK', atomic('SS_OK', 'BOOL'));
  T('StaNum', atomic('StaNum', 'DINT'));
  T('StaNumPre', atomic('StaNumPre', 'DINT'));
  T('StateEngine', stateEngineTag());
  T('StateHistory', stateHistoryTag());
  T('StationPerformance', stationPerformanceTag());
  T('Status', statusTag([
    [0, 'Emergency Stop'], [1, 'Manual Mode'], [2, 'Auto Mode Idle Not Ready'], [3, 'Auto Mode Idle Ready'],
    [4, 'Start Of Sequence, Wait For Inspect Trigger Window'], [7, 'Reset Inspection Complete, Check Camera Trigger Ready'],
    [10, 'Trigger Cameras'], [13, 'Check Results'], [99, 'Lockout'], [100, 'Start Of Initialization (Not Used - No Actuators)'], [127, 'Faulted'],
  ]));

  // ── R00_Main (IV4_SPEC.md 4.3; Jason's example lacks the R02 JSR - 12.1) ──
  const R00 = [
    [R`JSR(R01_Inputs,0);`, 'Subroutine Calls'],
    [R`JSR(R02_StateTransitions,0);`],
    [R`JSR(R03_StateLogic,0);`],
    [R`JSR(R20_Alarms,0);`],
  ];

  // ── R01_Inputs (Jason's R01 on the two-up side members; 4.4) ──
  const R01 = [
    [R`[MOVE(3,StaNum) MOVE(2,StaNumPre) ,MOVE(\Tracking.p_Data.Station[StaNum].NestNum,NestNumCurrent) MOVE(\Tracking.p_Data.Station[StaNumPre].NestNum,NestNumIncoming) ];`, 'Nest & Station Numbers'],
    [R`XIC(\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);`, 'Logic inputs'],
    [R`XIC(\Supervisor.q_SafetyOK)OTE(SafetyOK);`],
    [R`XIC(\Supervisor.q_FaultReset)OTE(FaultReset);`],
    [R`[XIC(\Supervisor.q_CycleStartLatch) ,XIC(HMI_LocalManualOverride) ]OTE(CycleRunning);`],
    [R`XIO(\Supervisor.q_CycleStartLatch)XIO(HMI_LocalManualOverride)OTE(CycleStopping);`],
    [R`XIC(\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);`],
    [R`XIC(g_MachineBasic.AlwaysOn)OTE(Initialized);`, 'Initialized - no actuators, always initialized'],
    [R`XIC(\Tracking.p_Data.Station[StaNum].OpStatus.Bypass{S})OTE(Bypass);`, 'Bypass'],
    [R`XIC(\Tracking.p_Data.Station[StaNum].OpStatus.Lockout{S})XIO(ManualMode)OTE(Lockout);`, 'Lockout'],
    [R`XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.PartLoaded{S})XIO(\Tracking.p_Data.Nest[NestNumCurrent].OpStatus.Lockout)[XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNumPre].Success{S}) ,XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNumPre].Lockout{S}) ]XIO(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt{S})OTE(CycleStationA);`,
      'Cycle Station\n\nThis nest is side {SIDE} to inspect: a part is loaded on side {SIDE}, the fixture is not locked out, S02 succeeded or was locked out on side {SIDE}, and S03 has not attempted it yet (first pass).'],
    [R`XIC(HMI_Toggle.2)OTE(SS);`, 'Single Step Logic\n\nStandard SINGLE STEP block, emitted in every program for standardization (Jason 2026-09-10). SS_OK is not consumed here - no moving devices to step.'],
    [R`[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);`],
    [R`XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);`, 'Clear HMI Manual Triggers'],
    [R`NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);`],
  ];

  // ── R02_StateTransitions (transitions only - Jason 2026-09-17; 4.5) ──
  const R02 = [
    [R`NOP();`, 'Start Of State Machine'],
    [R`[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);`, 'State 2: Auto mode idle not ready'],
    [R`[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[13]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);`, 'State 3: Auto mode idle ready'],
    [R`[XIC(Status.State[3]) ,XIC(Status.State[13]) ]XIC(CycleRunning)MOVE(4,Control.StateReg);`, 'State 4: Start of sequence, wait for the inspect trigger window'],
    [R`Chassis_CamPos_Check(CamPosCheckA,g_S03_InspectTriggerAngle,\Chassis.ChassisStatus.CamPosDeg,0,\Chassis.ChassisStatus.ActualVelocity)XIC(Status.State[4])XIC(CycleStationA)MOVE(7,Control.StateReg);`,
      'State 7: Reset inspection complete bits and check camera trigger ready\n\nLeaves state 4 on the Chassis_CamPos_Check window at g_S03_InspectTriggerAngle (timing advance 0 - a read event) for a nest this side may work; the window replaces the indexer example\'s q_WaitStationsComplete handshake (Jason\'s IV4 note). The AOI heads the rung so it is scanned every scan and its one-shot tracks the cam (2-UP template form). The Attempt latch lives in R03 (R02 holds transitions only - Jason 2026-09-17).'],
    [R`XIC(Status.State[7])XIO(InspectionCompleteBranch)XIO(InspectionCompleteTrunk)XIC(i_CameraTriggerReadyBranch)XIC(i_CameraTriggerReadyTrunk)MOVE(10,Control.StateReg);`, 'State 10: Trigger both cameras'],
    [R`XIC(Status.State[10])XIC(InspectionCompleteBranch)XIC(i_CameraResultsAvailableBranch)XIC(InspectionCompleteTrunk)XIC(i_CameraResultsAvailableTrunk)MOVE(13,Control.StateReg);`, 'State 13: Check results - both cameras updated with results available'],
    [R`XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);`, 'State 99: Lockout'],
    [R`XIC(Status.State[2])XIO(Initialized)XIC(CycleRunning)MOVE(100,Control.StateReg);`, 'State 100: Start of initialization sequence\n\nNever entered - no actuators, Initialized is always on; slot kept (Jason\'s shape).'],
    [R`XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];`, 'State 127: Fault'],
    [R`XIC(ManualMode)MOVE(1,Control.StateReg);`, 'State 1: Manual Mode'],
    [R`[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];`, 'State 0: Safety Stop'],
    [R`State_Engine_128Max(StateEngine,Control,Status,StateHistory);`],
  ];

  // ── R03_StateLogic (4.6) ──
  const nest = (m) => R`\Tracking.p_Data.Nest[InspectNestNum].PartStatus.` + m;
  const R03 = [
    [R`XIC(i_CameraReadyBranch)XIC(i_CameraRunBranch)XIC(i_CameraReadyTrunk)XIC(i_CameraRunTrunk)OTE(q_StartOK);`, 'Output Status To Supervisor\n\nBoth cameras in Run and Ready'],
    [R`XIC(g_MachineBasic.AlwaysOn)OTE(q_ActuatorsSafe);`, 'Actuators Safe For Index\n\nNo actuators - always safe (Jason: AlwaysOn)'],
    [R`XIC(Status.State[7])ONS(ONS.5)[MOVE(NestNumCurrent,InspectNestNum) ,OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt{S}) ];`,
      'State 7 Entry - Attempt\n\nLatch the S03 attempt on the side-{SIDE} record and capture the nest under the cameras. The chassis does not hold the dial for a result and Chassis R03 rewrites NestNumCurrent at every index, so every write for this inspection uses InspectNestNum.'],
    [R`XIC(SafetyOK)XIC(CycleRunning)XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.PartLoaded{S})XIC(\Tracking.p_Data.Station[StaNum].OpStatus.Lockout{S})OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Lockout{S});`, 'Set Part Tracking If Station Is Locked Out'],
    [R`XIO(Status.State[1])XIC(Status.State[4])[OTU(InspectionCompleteBranch) ,OTU(InspectionCompleteTrunk) ];`, 'Camera Control\n\nReset the inspection-complete latches at the start of every cycle'],
    [R`[XIO(Status.State[1]) XIC(Status.State[10]) ,XIC(Status.State[1]) XIC(HMI_Momentary.0) ]OTE(q_CameraTriggerBranch);`, 'Branch camera trigger'],
    [R`[XIO(Status.State[1]) XIC(Status.State[10]) ,XIC(Status.State[1]) XIC(HMI_Momentary.1) ]OTE(q_CameraTriggerTrunk);`, 'Trunk camera trigger'],
    [R`[XIC(i_CameraUpdateCompleteBranch) ONS(ONS.8) ,XIO(i_CameraUpdateCompleteBranch) ONS(ONS.9) ]OTL(InspectionCompleteBranch);`],
    [R`[XIC(i_CameraUpdateCompleteTrunk) ONS(ONS.10) ,XIO(i_CameraUpdateCompleteTrunk) ONS(ONS.11) ]OTL(InspectionCompleteTrunk);`],
    [R`XIO(Status.State[1])XIC(Status.State[13])ONS(ONS.12)[[XIC(i_bCameraTool1ResultBranch) XIC(i_bCameraTool2ResultBranch) XIC(i_bCameraTool1ResultTrunk) XIC(i_bCameraTool2ResultTrunk) ,XIC(Bypass) ] [OTL(` + nest(R`Station[StaNum].Success{S}`) + R`) ,MOVE(0,ConsecFails.Count) ] ,XIO(Bypass) [XIO(i_bCameraTool1ResultBranch) ,XIO(i_bCameraTool2ResultBranch) ,XIO(i_bCameraTool1ResultTrunk) ,XIO(i_bCameraTool2ResultTrunk) ] [OTU(` + nest(R`Station[StaNum].Success{S}`) + R`) ,OTL(` + nest(R`Station[StaNum].Failure{S}`) + R`) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,[XIO(i_bCameraTool1ResultTrunk) ,XIO(i_bCameraTool2ResultTrunk) ] MOVE(32,` + nest(R`FailureType{S}`) + R`) CONCAT(g_StationList[StaNum],FailureMessages[1],` + nest(R`FailureMessage{S}`) + R`) ,[XIO(i_bCameraTool1ResultBranch) ,XIO(i_bCameraTool2ResultBranch) ] MOVE(31,` + nest(R`FailureType{S}`) + R`) CONCAT(g_StationList[StaNum],FailureMessages[0],` + nest(R`FailureMessage{S}`) + R`) ] ];`,
      'Results\n\nPass = every tool of both cameras OK, or Bypass. Fail = any tool NG with Bypass off: Trunk evaluated first, Branch last, so a part failing both records 31 (Branch). FailureMessage = CONCAT(g_StationList[StaNum], suffix) - Jason 2026-09-01.'],
    [R`[XIC(Alarm[1].Active) ,XIC(Alarm[2].Active) ]ONS(ONS.13)XIC(` + nest(R`Station[StaNum].Attempt{S}`) + R`)XIO(` + nest(R`Station[StaNum].Success{S}`) + R`)XIO(` + nest(R`Station[StaNum].Failure{S}`) + R`)[OTL(` + nest(R`Station[StaNum].Failure{S}`) + R`) ,ADD(ConsecFails.Count,1,ConsecFails.Count) ,MOVE(33,` + nest(R`FailureType{S}`) + R`) ,CONCAT(g_StationList[StaNum],FailureMessages[2],` + nest(R`FailureMessage{S}`) + R`) ];`,
      'Vision No Result\n\nA camera timeout (Alarm[1] trigger ready / Alarm[2] results) is a fault in Jason\'s shape; the attempted, unjudged part still carries a verdict - Failure 33, once.'],
    [R`StationPerformance(StationPerformance,\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt{S},\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Success{S},g_PresetStationPerformLow,g_PresetStationPerformHigh,\Tracking.p_Data.Station[StaNum].PerformData.Attempts{S},\Tracking.p_Data.Station[StaNum].PerformData.Successes{S},\Tracking.p_Data.Station[StaNum].PerformData.Failures{S},\Tracking.p_Data.Station[StaNum].PerformData.Efficiency{S},\Tracking.p_Data.Station[StaNum].PerformData.HMIColorStatus{S});`, 'Station Performance'],
    [R`[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];`, 'Cycle Time\n\nHere, not in R02 - not a transition (Jason 2026-09-17).'],
  ];

  // ── R20_Alarms (4.7) ──
  const R20 = [
    [R`[XIC(CycleRunning) XIO(Lockout) GE(ConsecFails.Count,ConsecFails.Setpoint) ,XIC(Alarm[0].Active) XIO(FaultReset) ][OTE(Alarm[0].Active) ,ONS(ONS.14) CONCAT(g_StationList[StaNum],AlarmList[0],Alarm[0].Message) ];`, 'Consecutive Failures'],
    [R`XIC(Alarm[0].Active)MOVE(0,ConsecFails.Count);`],
    [R`[XIC(Status.State[7]) MOVE(1000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[1].Active) XIO(FaultReset) ][OTE(Alarm[1].Active) ,ONS(ONS.15) CONCAT(g_StationList[StaNum],AlarmList[1],Alarm[1].Message) ];`, 'Waiting For Camera Trigger Ready'],
    [R`[XIC(Status.State[10]) MOVE(2000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[2].Active) XIO(FaultReset) ][OTE(Alarm[2].Active) ,ONS(ONS.16) CONCAT(g_StationList[StaNum],AlarmList[2],Alarm[2].Message) ];`, 'Waiting For Camera Results'],
    [R`XIC(Bypass)[OTE(Alarm[3].Active) ,ONS(ONS.17) CONCAT(g_StationList[StaNum],AlarmList[3],Alarm[3].Message) MOVE(1,Alarm[3].Severity) ];`, 'Station Bypassed'],
    [R`XIC(Lockout)[OTE(Alarm[4].Active) ,ONS(ONS.18) CONCAT(g_StationList[StaNum],AlarmList[4],Alarm[4].Message) MOVE(1,Alarm[4].Severity) ];`, 'Station Locked Out'],
    [R`ProgramAlarmHandler(AOI_ProgramAlarmHandler,\Alarms.p_ProgramID,Alarm,\Alarms.p_Active,\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);`],
    [R`XIC(q_AlarmActive)ONS(ONS.19)ADD(\Tracking.p_Data.Station[StaNum].PerformData.FaultCount{S},1,\Tracking.p_Data.Station[StaNum].PerformData.FaultCount{S});`, 'Station Fault Count'],
  ];

  const description = `S03 Y-Site Inspect - Side {SIDE} ({NEST} nest). Keyence IV4 state machine on Jason's IV4 standard (S06_IV4Vision), chassis adaptation: state 4 leaves on the Chassis_CamPos_Check window at g_S03_InspectTriggerAngle for a nest this side may work; two cameras - Branch = {BR} (inclined port), Trunk = {TR} (central port); verdict on the side-{SIDE} record (FailureType{S} 31 Branch Port Not Clear, 32 Trunk Port Not Clear, 33 Vision No Result). Twin of {TWIN}. Job 1160.`;

  const xml = `<Program Name="{ME}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">\n` +
    `<Description>\n${cdata(description)}\n</Description>\n` +
    `<Tags>\n${sortTags(tags).map((t) => t.xml).join('\n')}\n</Tags>\n` +
    `<Routines>\n${[routine('R00_Main', R00), routine('R01_Inputs', R01), routine('R02_StateTransitions', R02), routine('R03_StateLogic', R03), routine('R20_Alarms', R20)].join('\n')}\n</Routines>\n` +
    `</Program>\n`;
  const filled = fill(xml, side);
  if (/\{(S|SIDE|NEST|ME|TWIN|BR|TR|BRIP|TRIP)\}/.test(filled)) throw new Error('unfilled placeholder');
  return filled;
}

// ── craft checks on a program (IV4_SPEC.md section 9) ────────────────────────
function checkProgram(xml, name) {
  const problems = [];
  if (/\sUse="/.test(xml)) problems.push('Use= attribute present');
  if (/[^\x00-\x7F]/.test(xml)) problems.push('non-ASCII');
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Description>/g)) if (m[1].length > 512) problems.push(`Description > 512 (${m[1].length})`);
  if (/\\S00_IndexerSP/.test(xml)) problems.push('\\S00_IndexerSP reference');
  // every tag used in rung text is declared here, at controller scope, or is a \Prog.param reference
  const declared = new Set([...xml.matchAll(/<Tag Name="([^"]+)"/g)].map((m) => m[1]));
  const controllerXml = readCrlf(path.join(CONTROLLER, 'ControllerTags.xml'));
  const controllerTags = new Set([...controllerXml.matchAll(/<Tag Name="([^"]+)"/g)].map((m) => m[1]));
  const texts = [...xml.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1]);
  const used = new Set();
  for (const t of texts) {
    const stripped = t.replace(/\\[A-Za-z0-9_]+\.[A-Za-z0-9_.\[\]]+/g, ' ').replace(/'[^']*'/g, ' ');
    for (const m of stripped.matchAll(/(?<![A-Za-z0-9_.\\])([A-Za-z_][A-Za-z0-9_]*)(?=[\s,.\[\)])/g)) used.add(m[1]);
  }
  const mnemonics = new Set(['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'MOVE', 'MOV', 'ADD', 'SUB', 'DIV', 'MUL', 'LIMIT', 'GE', 'GT', 'LE', 'LT', 'EQ', 'NE', 'NEQ', 'NOP', 'JSR', 'RES', 'RTO', 'TON', 'CONCAT', 'CPS', 'COP', 'S', 'FS',
    'State_Engine_128Max', 'ProgramAlarmHandler', 'StationPerformance', 'Chassis_CamPos_Check', 'R01_Inputs', 'R02_StateTransitions', 'R03_StateLogic', 'R20_Alarms']);
  const undeclared = [...used].filter((u) => !mnemonics.has(u) && !declared.has(u) && !controllerTags.has(u));
  if (undeclared.length) problems.push(`undeclared: ${undeclared.join(', ')}`);
  // cross-program references
  const refs = new Set([...texts.join(' ').matchAll(/\\([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`));
  for (const ref of refs) {
    const [prog, param] = ref.split('.');
    const pf = path.join(PROGRAMS, `${prog}.xml`);
    if (!fs.existsSync(pf)) { problems.push(`program ${prog} missing`); continue; }
    const pxml = readCrlf(pf);
    const m = pxml.match(new RegExp(`<Tag Name="${param}"[^>]*Usage="(Input|Output|Public|InOut)"`));
    if (!m) problems.push(`${ref} is not a parameter of ${prog}`);
  }
  // every tag declared is used (Jason: emit no tag the program cannot use) - NestNumIncoming is written in R01 rung 0 (Jason's shape)
  const unused = [...declared].filter((d) => !texts.some((t) => new RegExp(`(?<![A-Za-z0-9_])${d}(?![A-Za-z0-9_])`).test(t)));
  if (unused.length) problems.push(`declared but never used: ${unused.join(', ')}`);
  // R02: transitions only
  const r02 = xml.slice(xml.indexOf('<Routine Name="R02_StateTransitions"'), xml.indexOf('<Routine Name="R03_StateLogic"'));
  const r02texts = [...r02.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)].map((m) => m[1]);
  for (const t of r02texts) if (/\b(OTL|OTU|OTE|ADD|SUB|CONCAT|RTO|DIV|COP|CPS)\(/.test(t)) problems.push(`R02 side effect: ${t.slice(0, 60)}`);
  for (const t of r02texts) for (const m of t.matchAll(/MOVE\(([^,]+),([^)]+)\)/g)) if (!/^Control\.StateReg$|^FaultState$|^SafetyStopState$|^RestartState$/.test(m[2])) problems.push(`R02 MOVE not a state write: ${m[0]}`);
  // one rung, one destination state
  for (const t of r02texts) { const dests = new Set([...t.matchAll(/MOVE\((\d+),Control\.StateReg\)/g)].map((m) => m[1])); if (dests.size > 1) problems.push(`R02 rung with two destinations: ${[...dests]}`); }
  // balanced rung text
  for (const t of texts) { let d = 0; for (const ch of t) { if (ch === '[' || ch === '(') d++; if (ch === ']' || ch === ')') d--; if (d < 0) break; } if (d !== 0) problems.push(`unbalanced: ${t.slice(0, 60)}`); if (!t.trim().endsWith(';')) problems.push(`no terminator: ${t.slice(0, 60)}`); }
  console.log(`${name}: ${problems.length ? 'PROBLEMS ' + problems.join(' | ') : 'craft checks OK'} (tags ${declared.size}, rungs ${texts.length}, cross-program refs ${refs.size})`);
  return problems;
}

// ── twin diff (A vs B must differ only by side members / points / text) ──────
function twinDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const out = [];
  if (la.length !== lb.length) out.push(`LINE COUNT A ${la.length} vs B ${lb.length}`);
  const n = Math.max(la.length, lb.length);
  const sideWords = /Side A|Side B|side-A|side-B|side A|side B|left|right|Left|Right|S03_YSiteInspectA|S03_YSiteInspectB|cam0[1-4]_[A-Za-z]+|192\.168\.1\.3[1-4]|(Attempt|Success|Failure|Lockout|Bypass|PartLoaded|FailureType|FailureMessage|Attempts|Successes|Failures|Efficiency|HMIColorStatus|FaultCount)[AB]\b/g;
  for (let i = 0; i < n; i++) {
    if (la[i] === lb[i]) continue;
    const na = (la[i] || '').replace(sideWords, '#'), nb = (lb[i] || '').replace(sideWords, '#');
    out.push(`${na === nb ? 'side-only' : 'RESIDUAL '} L${i + 1}: ${(la[i] || '').trim().slice(0, 110)}  ->  ${(lb[i] || '').trim().slice(0, 110)}`);
  }
  return out;
}

// ── controller-side edits ────────────────────────────────────────────────────
const CAMS = [
  { node: 'cam01_RightBranchInspect', desc: 'IV4 camera S03 right branch' },
  { node: 'cam02_RightTrunkInspect', desc: 'IV4 camera S03 right trunk' },
  { node: 'cam03_LeftBranchInspect', desc: 'IV4 camera S03 left branch' },
  { node: 'cam04_LeftTrunkInspect', desc: 'IV4 camera S03 left trunk' },
  { node: 'cam05_RightCutterPresent', desc: 'IV4 camera S07 right cutter present' },
  { node: 'cam06_LeftCutterPresent', desc: 'IV4 camera S07 left cutter present' },
];
const IN_BYTES = 394, IN_WORDS = 197, OUT_BYTES = 12, OUT_WORDS = 6;   // Jason's AOP buffer types: INT[197] in, INT[6] out (IV4_SPEC.md 1.2 / 2)
const intElements = (n) => Array.from({ length: n }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n');
const zerosL5k = (n) => `[[${Array.from({ length: n }, () => '0').join(',')}]]`;

function replaceOnce(block, re, repl, label) {
  const m = block.match(re);
  if (!m) throw new Error(`${label}: pattern not found`);
  if (re.global && block.match(re).length !== 1) throw new Error(`${label}: pattern not unique`);
  return block.replace(re, repl);
}

function patchModules() {
  const p = path.join(CONTROLLER, 'Modules.xml');
  let xml = readCrlf(p);
  let changed = 0;
  for (const cam of CAMS) {
    const start = xml.indexOf(`<Module Name="${cam.node}"`);
    if (start < 0) throw new Error(`module ${cam.node} not found`);
    const end = xml.indexOf('</Module>', start) + '</Module>'.length;
    let block = xml.slice(start, end);
    const before = block;
    if (/PrimCxnInputSize="394"/.test(block)) { console.log(`Modules.xml: ${cam.node} already resized`); continue; }
    block = replaceOnce(block, /<Description>\r?\n<!\[CDATA\[[^\]]*\]\]>\r?\n<\/Description>/, `<Description>\r\n<![CDATA[Keyence ${cam.desc}]]>\r\n</Description>`, 'description');
    block = replaceOnce(block, /PrimCxnInputSize="40" PrimCxnOutputSize="8"/, `PrimCxnInputSize="${IN_BYTES}" PrimCxnOutputSize="${OUT_BYTES}"`, 'PrimCxn sizes');
    block = replaceOnce(block, /OutputSize="8" InputSize="40"/, `OutputSize="${OUT_BYTES}" InputSize="${IN_BYTES}"`, 'Connection sizes');
    block = replaceOnce(block, /<Structure DataType="AB:ETHERNET_MODULE_INT_40Bytes:I:0">\r?\n<ArrayMember Name="Data" DataType="INT" Dimensions="20" Radix="Decimal">\r?\n(?:<Element Index="\[\d+\]" Value="0"\/>\r?\n){20}<\/ArrayMember>/,
      `<Structure DataType="AB:ETHERNET_MODULE_INT_${IN_BYTES}Bytes:I:0">\r\n<ArrayMember Name="Data" DataType="INT" Dimensions="${IN_WORDS}" Radix="Decimal">\r\n${intElements(IN_WORDS).replace(/\n/g, '\r\n')}\r\n</ArrayMember>`, 'InputTag structure');
    block = replaceOnce(block, /<!\[CDATA\[\[\[0,0,0,0\]\]\]\]>/, `<![CDATA[${zerosL5k(OUT_WORDS)}]]>`, 'OutputTag L5K');
    block = replaceOnce(block, /<Structure DataType="AB:ETHERNET_MODULE_INT_8Bytes:O:0">\r?\n<ArrayMember Name="Data" DataType="INT" Dimensions="4" Radix="Decimal">\r?\n(?:<Element Index="\[\d+\]" Value="0"\/>\r?\n){4}<\/ArrayMember>/,
      `<Structure DataType="AB:ETHERNET_MODULE_INT_${OUT_BYTES}Bytes:O:0">\r\n<ArrayMember Name="Data" DataType="INT" Dimensions="${OUT_WORDS}" Radix="Decimal">\r\n${intElements(OUT_WORDS).replace(/\n/g, '\r\n')}\r\n</ArrayMember>`, 'OutputTag structure');
    if (/40Bytes|8Bytes|Dimensions="20"|Dimensions="4"/.test(block)) throw new Error(`${cam.node}: stale size text remains`);
    xml = xml.slice(0, start) + block + xml.slice(end);
    if (block !== before) changed++;
  }
  if (changed) writeCrlf(p, xml); else console.log('Modules.xml: no change');
  return changed;
}

function patchControllerTags() {
  const p = path.join(CONTROLLER, 'ControllerTags.xml');
  let xml = readCrlf(p);
  let changed = 0;
  for (const cam of CAMS) {
    for (const dir of ['IN', 'OUT']) {
      const name = `${cam.node}_${dir}`;
      const start = xml.indexOf(`<Tag Name="${name}"`);
      if (start < 0) throw new Error(`buffer ${name} not found`);
      const end = xml.indexOf('</Tag>', start) + '</Tag>'.length;
      let block = xml.slice(start, end);
      const before = block;
      const bytes = dir === 'IN' ? IN_BYTES : OUT_BYTES, words = dir === 'IN' ? IN_WORDS : OUT_WORDS;
      const oldBytes = dir === 'IN' ? 40 : 8, oldWords = dir === 'IN' ? 20 : 4;
      const io = dir === 'IN' ? 'I' : 'O';
      if (block.includes(`_${bytes}Bytes:${io}:0`)) { console.log(`ControllerTags.xml: ${name} already retyped`); continue; }
      block = replaceOnce(block, new RegExp(`DataType="AB:ETHERNET_MODULE_INT_${oldBytes}Bytes:${io}:0"`), `DataType="AB:ETHERNET_MODULE_INT_${bytes}Bytes:${io}:0"`, `${name} DataType`);
      block = replaceOnce(block, /<!\[CDATA\[\[\[0(?:,0)*\]\]\]\]>/, `<![CDATA[${zerosL5k(words)}]]>`, `${name} L5K`);
      block = replaceOnce(block, new RegExp(`<Structure DataType="AB:ETHERNET_MODULE_INT_${oldBytes}Bytes:${io}:0">\\r?\\n<ArrayMember Name="Data" DataType="INT" Dimensions="${oldWords}" Radix="Decimal">\\r?\\n(?:<Element Index="\\[\\d+\\]" Value="0"\\/>\\r?\\n){${oldWords}}<\\/ArrayMember>`),
        `<Structure DataType="AB:ETHERNET_MODULE_INT_${bytes}Bytes:${io}:0">\r\n<ArrayMember Name="Data" DataType="INT" Dimensions="${words}" Radix="Decimal">\r\n${intElements(words).replace(/\n/g, '\r\n')}\r\n</ArrayMember>`, `${name} structure`);
      xml = xml.slice(0, start) + block + xml.slice(end);
      if (block !== before) changed++;
    }
  }
  if (changed) writeCrlf(p, xml); else console.log('ControllerTags.xml: no change');
  return changed;
}

function patchMapComments() {
  let changed = 0;
  for (const [file, dir] of [['MapInputs.xml', 'I'], ['MapOutputs.xml', 'O']]) {
    const p = path.join(PROGRAMS, file);
    let xml = readCrlf(p);
    const before = xml;
    for (const cam of CAMS) {
      const cps = dir === 'I' ? `CPS(${cam.node}:I,${cam.node}_IN,1);` : `CPS(${cam.node}_OUT,${cam.node}:O,1);`;
      const re = new RegExp(`<Comment>\\r?\\n<!\\[CDATA\\[([^\\]]*)\\]\\]>\\r?\\n<\\/Comment>\\r?\\n<Text>\\r?\\n<!\\[CDATA\\[${cps.replace(/[()[\]:.,]/g, '\\$&')}\\]\\]>`);
      const m = xml.match(re);
      if (!m) throw new Error(`${file}: CPS rung for ${cam.node} not found (one rung per node, edit it - never duplicate)`);
      xml = xml.replace(re, m[0].replace(m[1], cam.desc));
    }
    const rungs = (xml.match(/<Rung Number=/g) || []).length;
    const cps = (xml.match(/CPS\(/g) || []).length;
    if (xml !== before) { writeCrlf(p, xml); changed++; } else console.log(`${file}: no change`);
    console.log(`${file}: ${rungs} rungs, ${cps} CPS`);
  }
  return changed;
}

function connectionLines() {
  const lines = [];
  for (const k of ['A', 'B']) {
    const s = SIDES[k];
    for (const [role, node] of [['Branch', s.BR], ['Trunk', s.TR]]) {
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[1].0" EndPoint2="\\${s.ME}.i_CameraResultsAvailable${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[1].1" EndPoint2="\\${s.ME}.i_CameraUpdateComplete${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[1].4" EndPoint2="\\${s.ME}.i_CameraRun${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[1].5" EndPoint2="\\${s.ME}.i_CameraReady${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[1].6" EndPoint2="\\${s.ME}.i_CameraTriggerReady${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[3].0" EndPoint2="\\${s.ME}.i_bCameraTool1Result${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="${node}_IN.Data[3].1" EndPoint2="\\${s.ME}.i_bCameraTool2Result${role}"/>`);
      lines.push(`<ParameterConnection EndPoint1="\\${s.ME}.q_CameraTrigger${role}" EndPoint2="${node}_OUT.Data[0].0"/>`);
    }
  }
  return lines;
}

function patchParameterConnections() {
  const p = path.join(CONTROLLER, 'ParameterConnections.xml');
  let xml = readCrlf(p);
  // A program endpoint must start with a backslash (\S07_PortCutA.i_CameraReady); one written without it (a heredoc
  // halving the backslash) reads as a controller tag and cancels the import. Repair any such S03/S07 line in place.
  const bare = xml.match(/EndPoint[12]="S0[37]_[A-Za-z]+\./g) || [];
  if (bare.length) { xml = xml.replace(/(EndPoint[12]=")(S0[37]_[A-Za-z]+\.)/g, '$1\\$2'); console.log(`ParameterConnections.xml: restored the leading backslash on ${bare.length} program endpoint(s)`); }
  const existing = new Set([...xml.matchAll(/<ParameterConnection [^>]*\/>/g)].map((m) => m[0]));
  const add = connectionLines().filter((l) => !existing.has(l));
  if (!add.length) { if (bare.length) writeCrlf(p, xml); else console.log('ParameterConnections.xml: all 32 S03 lines present'); return bare.length; }
  const close = xml.lastIndexOf('</ParameterConnections>');
  if (close < 0) throw new Error('ParameterConnections.xml: no closing tag');
  xml = xml.slice(0, close) + add.join('\r\n') + '\r\n' + xml.slice(close);
  writeCrlf(p, xml);
  console.log(`ParameterConnections.xml: +${add.length} lines (total ${existing.size + add.length})`);
  return add.length;
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const out = {};
  for (const k of ['A', 'B']) {
    out[k] = buildProgram(SIDES[k]);
  }
  const problems = [...checkProgram(out.A, 'S03_YSiteInspectA'), ...checkProgram(out.B, 'S03_YSiteInspectB')];
  const diff = twinDiff(out.A, out.B);
  const residual = diff.filter((d) => d.startsWith('RESIDUAL') || d.startsWith('LINE COUNT'));
  console.log(`twin diff: ${diff.length} differing lines, ${residual.length} non-side residuals`);
  for (const d of diff) console.log('  ' + d);
  if (problems.length || residual.length) { console.error('STOP: fix the problems above before writing'); process.exit(1); }
  for (const k of ['A', 'B']) writeCrlf(path.join(PROGRAMS, `${SIDES[k].ME}.xml`), out[k]);
  patchModules();
  patchControllerTags();
  patchMapComments();
  patchParameterConnections();
}
main();
