#!/usr/bin/env node
'use strict';
/**
 * split1131Halves.cjs - job 1131 v0.4 (Jason, 2026-09-29, deviation D010).
 *
 * The machine is two independent halves. Turns the single Supervisor / Alarms / HMI of
 * v0.3 into a pair each - one per half - and repoints every cross-program reference.
 *
 *   LOADER    Supervisor_Loader   Alarms_Loader   HMI_Loader     S01 S02 S03 S04
 *   UNLOADER  Supervisor_Unloader Alarms_Unloader HMI_Unloader   S05 S06 S07 S08 S09
 *
 * Single, machine-wide, unchanged: MapInputs, MapOutputs, Communications, Recipe, Production.
 *
 * Two things this does NOT copy from John Stanko's original two-supervisor file:
 *   - both his supervisors call AOI_MachineBasic and CPU_TimeDate_wJulian, writing the same
 *     controller tags g_MachineBasic / g_CPUDateTime from two programs. That is a duplicate
 *     destructive write. R10_Global stays in Supervisor_Loader alone; the unloader reads it.
 *   - both his supervisors monitor all 13 EIP nodes. Here the 17 nodes split 9 / 8, each half
 *     watching its own, so a node is polled by exactly one program.
 *
 * Each half's operator station becomes its own parameters, with no "Infeed" suffix - a half
 * only knows its own station:
 *   LOADER   in io01_InfeedPointIO:4:I.0-.5   out io01_InfeedPointIO:6:O.0-.6
 *   UNLOADER in Local:4:I.Pt00-Pt08           out Local:5:O.Pt00-Pt06
 *
 *   node scripts/split1131Halves.cjs [--build-dir generated/1131/build]
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const BUILD = path.resolve(flag('build-dir', 'generated/1131/build'));
const PROGS = path.join(BUILD, 'programs');
const CTRL = path.join(BUILD, 'controller');

const LOADER_ST = ['S01_InfeedCart', 'S02_InfeedVision', 'S03_InfeedGantry', 'S04_InfeedConveyor'];
const UNLOADER_ST = ['S05_OutfeedConveyor', 'S06_OutfeedVision', 'S07_OutfeedGantry', 'S08_ThicknessGauge', 'S09_OutfeedCart'];
const HALF_OF = {};
for (const s of LOADER_ST) HALF_OF[s] = 'Loader';
for (const s of UNLOADER_ST) HALF_OF[s] = 'Unloader';

// EIP nodes, by the half that owns the hardware
const EIP = {
  Loader: [
    ['sd01_InfeedGantryXAxis', 'Loss Of Infeed Gantry X Axis Servo EIP'],
    ['sd02_InfeedGantryZAxis', 'Loss Of Infeed Gantry Z Axis Servo EIP'],
    ['sd06_InfeedCartYAxis', 'Loss Of Infeed Cart Y Axis Servo EIP'],
    ['sd08_InfeedCameraRAxis', 'Loss Of Infeed Camera R Axis Servo EIP'],
    ['vb01_InfeedCartValves', 'Loss Of Infeed Cart Valve Bank EIP'],
    ['vb04_InfeedGantryValves', 'Loss Of Infeed Gantry Valve Bank EIP'],
    ['cam01_InfeedCamera', 'Loss Of Infeed Camera EIP'],
    ['fd01_InfeedBelt', 'Loss Of Infeed Belt Drive EIP'],
    ['io01_InfeedPointIO', 'Loss Of Infeed Point IO EIP'],
  ],
  Unloader: [
    ['sd03_OutfeedGantryXAxis', 'Loss Of Outfeed Gantry X Axis Servo EIP'],
    ['sd04_OutfeedGantryZAxis', 'Loss Of Outfeed Gantry Z Axis Servo EIP'],
    ['sd05_OutfeedBelt', 'Loss Of Outfeed Belt Servo EIP'],
    ['sd07_OutfeedCartYAxis', 'Loss Of Outfeed Cart Y Axis Servo EIP'],
    ['vb02_GaugeValves', 'Loss Of Gauge Valve Bank EIP'],
    ['vb03_OutfeedCartValves', 'Loss Of Outfeed Cart Valve Bank EIP'],
    ['vb05_OutfeedGantryValves', 'Loss Of Outfeed Gantry Valve Bank EIP'],
    ['cam02_OutfeedCamera', 'Loss Of Outfeed Camera EIP'],
  ],
};
const WARN_CART = { Loader: 'S01_InfeedCart', Unloader: 'S09_OutfeedCart' };
const SAFETY_OF = { Loader: 'SafetyProgramLoader', Unloader: 'SafetyProgramUnloader' };

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');
const note = [];

// ── rung helpers ────────────────────────────────────────────────────────────
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
function rungList(routineBody) {
  return [...routineBody.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
}
function rungComment(r) { return cdataOf((/<Comment>([\s\S]*?)<\/Comment>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim(); }
function rungText(r) { return cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim(); }
function setRungText(r, txt) { return r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, a, b) => a + txt + b); }
function setRungComment(r, c) {
  if (/<Comment>/.test(r)) return r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, a, b) => a + c + b);
  return r.replace(/(<Rung\b[^>]*>)/, '$1\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>');
}
function renumber(routineBody) {
  let n = 0;
  return routineBody.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, a, b) => a + (n++) + b);
}
/** Replace one routine's whole <RLLContent> with the given rungs. */
function putRungs(programXml, routineName, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + routineName + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(programXml)) throw new Error('routine not found: ' + routineName);
  return programXml.replace(re, (m, a, body, c) => a + '\n' + renumber(rungs.join('\n')) + '\n' + c);
}
function getRoutine(programXml, routineName) {
  const re = new RegExp('<Routine\\b[^>]*\\bName="' + routineName + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>');
  const m = re.exec(programXml);
  return m ? m[1] : null;
}
function dropRoutine(programXml, routineName) {
  const re = new RegExp('<Routine\\b[^>]*\\bName="' + routineName + '"[\\s\\S]*?</Routine>\\s*', 'g');
  return programXml.replace(re, '');
}
function renameProgram(programXml, from, to) {
  return programXml.replace(new RegExp('(<Program\\b[^>]*\\bName=")' + from + '(")'), '$1' + to + '$2');
}

// ── 1. the Supervisor, split in two ─────────────────────────────────────────
const supSrc = read(path.join(PROGS, 'Supervisor.xml'));

function buildSupervisor(half) {
  const stations = half === 'Loader' ? LOADER_ST : UNLOADER_ST;
  const other = half === 'Loader' ? 'Unloader' : 'Loader';
  let p = renameProgram(supSrc, 'Supervisor', 'Supervisor_' + half);

  // -- R01_Inputs: keep this half's rungs, rewrite the shared ones --
  // (the operator-station parameter surgery happens at the END of this function, so that it
  //  also rewrites the rungs spliced in below - they are taken from the untouched source)
  const r01 = rungList(getRoutine(supSrc, 'R01_Inputs'));
  const keep = [];
  for (const r of r01) {
    const c = rungComment(r), t = rungText(r);
    // safety: this half's safety program only
    if (/SafetyCircuitReady must turn on/.test(c)) {
      keep.push(setRungText(r, 'XIC(\\' + SAFETY_OF[half] + '.Safe_q_Reset)OTE(SafetyCircuitReady);')); continue;
    }
    if (/q_SafetyOK must turn on/.test(c)) {
      keep.push(setRungText(r, 'XIC(\\' + SAFETY_OF[half] + '.Safe_q_Status)OTE(q_SafetyOK);')); continue;
    }
    // operator station: one station per half now, so the two-station OR/AND collapses
    if (/Cycle start from either operator station/.test(c)) {
      keep.push(setRungComment(setRungText(r, 'XIC(i_CycleStart)OTE(CycleStartPushbutton);'),
        'Cycle start from this half\'s operator station.')); continue;
    }
    if (/cycle stop pushbuttons are healthy/.test(c)) {
      keep.push(setRungComment(setRungText(r, 'XIC(i_CycleStop)OTE(CycleStopPushbutton);'),
        'The normally closed cycle stop pushbutton is healthy.')); continue;
    }
    if (/Air pressure OK at both operator stations/.test(c)) {
      keep.push(setRungComment(setRungText(r, 'XIC(i_AirPressureOK)OTE(AirPressureOK);'),
        'Air pressure OK at this half\'s operator station.')); continue;
    }
    // the three station polls: this half's stations only
    for (const [pat, tag, dest] of [
      [/All State Machines In Automatic Mode/, 'q_AutoMode', 'AllSMInAuto'],
      [/All State Machines In Cycle Stop/, 'q_AutoStopped', 'MachineStopped'],
      [/Automatic Mode Start OK/, 'q_StartOK', 'StartOK'],
    ]) {
      if (!pat.test(c)) continue;
      const terms = stations.map((s) => 'XIC(\\' + s + '.' + tag + ')').join('');
      keep.push(setRungText(r, terms + 'OTE(' + dest + ');'));
    }
    if (/All State Machines|Automatic Mode Start OK/.test(c)) continue;
    // half-specific rungs: keep only this half's
    const mine = new RegExp(half === 'Loader' ? 'loader' : 'unloader', 'i');
    const theirs = new RegExp(half === 'Loader' ? 'unloader' : '(?<!un)loader', 'i');
    if (/axes stopped for the safety task|doors may unlock|door open to the safety task|door unlock requests|Operator bypass/i.test(c)) {
      if (mine.test(c) && !(half === 'Loader' && /unloader/i.test(c))) keep.push(r);
      continue;
    }
    // the axis-enable permissive drives both halves' g_ tags from one rung: keep this half's coil
    if (/Axis enable permissive to the safety task/.test(c)) {
      keep.push(setRungComment(setRungText(r,
        '[XIC(q_CycleStartLatch) ,XIC(q_ManualMode) ]OTE(g_' + half + 'AxesEnablePermissive);'),
        'Axis enable permissive to the safety task while running or in manual mode.'));
      continue;
    }
    // light curtain mute belongs to the loader (the infeed cart asks for it)
    if (/light curtain mute/i.test(c)) { if (half === 'Loader') keep.push(r); continue; }
    keep.push(r);
  }
  // the machine-basic input is "either half running", so the flashers do not stop when one half does
  if (half === 'Loader') {
    keep.push('<Rung Number="0" Type="N">\n<Comment>\n<![CDATA[Either half running, for the machine basic flashers.]]>\n</Comment>\n<Text>\n<![CDATA['
      + '[XIC(q_MachineRunning) ,XIC(\\Supervisor_Unloader.q_MachineRunning) ]OTE(EitherHalfRunning);]]>\n</Text>\n</Rung>');
  }
  p = putRungs(p, 'R01_Inputs', keep);

  // -- R03_StackLight: this half's own cart station drives the blue segment --
  const r03 = rungList(getRoutine(supSrc, 'R03_StackLight')).map((r) => {
    if (!/Blue stack light/.test(rungComment(r))) return r;
    return setRungComment(setRungText(r,
      'XIC(\\' + WARN_CART[half] + '.q_WarningActive)XIC(g_MachineBasic.Flash500msPD)OTE(q_BlueStackLight);'),
      'Blue stack light flashes while this half\'s cart station waits on the operator.');
  });
  p = putRungs(p, 'R03_StackLight', r03);

  // -- R10_Global: one owner only (see the header note) --
  if (half === 'Loader') {
    const r10 = rungList(getRoutine(supSrc, 'R10_Global')).map((r) =>
      /AOI_MachineBasic/.test(rungText(r))
        ? setRungComment(setRungText(r, 'AOI_MachineBasic(MachineBasic,EitherHalfRunning,g_MachineBasic);'),
          'Machine basic - flashers, always on. Owned by this half; the unloader reads g_MachineBasic.')
        : r);
    p = putRungs(p, 'R10_Global', r10);
  } else {
    p = dropRoutine(p, 'R10_Global');
    p = p.replace(/<Tag Name="MachineBasic"[\s\S]*?<\/Tag>\s*/, '').replace(/<Tag Name="CPUDateTime"[\s\S]*?<\/Tag>\s*/, '');
    // and the JSR that called it, or the routine reference dangles
    const main = rungList(getRoutine(p, 'R00_Main')).filter((r) => !/JSR\(R10_Global/.test(rungText(r)));
    p = putRungs(p, 'R00_Main', main);
    note.push('Supervisor_Unloader: R10_Global and its JSR dropped - g_MachineBasic and g_CPUDateTime have one owner (Supervisor_Loader).');
  }

  // -- R15_EIPMonitor: wrap on this half's node count --
  const nodes = EIP[half];
  const r15 = rungList(getRoutine(supSrc, 'R15_EIPMonitor')).map((r) =>
    /GE\(EIPStatusCount,/.test(rungText(r))
      ? setRungComment(setRungText(r, 'GE(EIPStatusCount,' + nodes.length + ')MOVE(0,EIPStatusCount);'),
        'Wrap the node counter after the last of the ' + nodes.length + ' EIP nodes on this half.')
      : r);
  p = putRungs(p, 'R15_EIPMonitor', r15);

  // -- R20_Alarms: this half's EIP nodes, renumbered from 0; batch + handler kept --
  const src20 = rungList(getRoutine(supSrc, 'R20_Alarms'));
  const eipTemplate = src20.find((r) => /AOI_EIPStatus/.test(rungText(r)));
  const out20 = nodes.map(([dev, title], i) => setRungComment(setRungText(eipTemplate,
    '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,' + i + ') AOI_EIPStatus(' + dev + 'EIP,' + dev + ') XIO(' + dev + 'EIP.ComOK) ,'
    + 'XIC(Alarm[' + i + '].Active) XIO(q_FaultReset) ]OTE(Alarm[' + i + '].Active);'), title));
  let idx = nodes.length;
  for (const r of src20) {
    const t = rungText(r);
    if (/AOI_EIPStatus/.test(t)) continue;
    if (/ProgramAlarmHandler/.test(t)) {
      out20.push(setRungText(r, t.replace(/\\Alarms\./g, '\\Alarms_' + half + '.')));
      continue;
    }
    if (/Alarm\[17\]/.test(t)) { out20.push(setRungText(r, t.replace(/Alarm\[17\]/g, 'Alarm[' + idx + ']'))); idx++; continue; }
    out20.push(r);
  }
  p = putRungs(p, 'R20_Alarms', out20);

  // -- drop this half's unused EIP backing tags --
  const mineDevs = new Set(nodes.map(([d]) => d + 'EIP'));
  for (const [d] of EIP[other]) p = p.replace(new RegExp('<Tag Name="' + d + 'EIP"[\\s\\S]*?</Tag>\\s*'), '');

  // -- every remaining cross-program name --
  p = p.replace(/\\Alarms\./g, '\\Alarms_' + half + '.');

  // -- operator station: each half keeps only its own, under the plain names.
  //    Done last, so it rewrites the rungs spliced in above as well as the declarations. --
  const OPER = ['CycleStart', 'CycleStop', 'FaultReset', 'AirPressureOK', 'EntryDoorClosed', 'ExitDoorClosed'];
  if (half === 'Loader') {
    for (const n of OPER) p = p.replace(new RegExp('<Tag Name="i_' + n + '"[\\s\\S]*?</Tag>\\s*'), '');
    p = p.replace(new RegExp('\\bi_(' + OPER.join('|') + ')Infeed\\b', 'g'), 'i_$1');
  } else {
    for (const n of OPER) p = p.replace(new RegExp('<Tag Name="i_' + n + 'Infeed"[\\s\\S]*?</Tag>\\s*'), '');
    p = p.replace(new RegExp('\\bi_(' + OPER.join('|') + ')Infeed\\b', 'g'), 'i_$1');
  }

  // -- the either-half-running helper the loader adds --
  if (half === 'Loader') {
    p = p.replace(/(<Tag Name="EnableBatchCount")/,
      '<Tag Name="EitherHalfRunning" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n'
      + '<Description>\n<![CDATA[Either half running]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n</Tag>\n$1');
  }
  return p;
}

for (const half of ['Loader', 'Unloader']) {
  write(path.join(PROGS, 'Supervisor_' + half + '.xml'), buildSupervisor(half));
  note.push('Supervisor_' + half + ': ' + (half === 'Loader' ? LOADER_ST : UNLOADER_ST).join(', ')
    + ' | ' + EIP[half].length + ' EIP nodes');
}
fs.unlinkSync(path.join(PROGS, 'Supervisor.xml'));

// ── 2. Alarms and HMI, one pair each ────────────────────────────────────────
const alarmsSrc = read(path.join(PROGS, 'Alarms.xml'));
const hmiSrc = read(path.join(PROGS, 'HMI.xml'));
for (const half of ['Loader', 'Unloader']) {
  const stations = half === 'Loader' ? LOADER_ST : UNLOADER_ST;
  let a = renameProgram(alarmsSrc, 'Alarms', 'Alarms_' + half);
  // the two roll-up rungs list only this half's stations
  const r01 = rungList(getRoutine(alarmsSrc, 'R01_Logic')).map((r) => {
    const c = rungComment(r), t = rungText(r);
    for (const [pat, tag, dest] of [
      [/any machine faults present/i, 'q_AlarmActive', 'p_NoMachineFaults'],
      [/Any Machine Warnings Present/i, 'q_WarningActive', 'p_NoMachineWarnings'],
    ]) {
      if (!pat.test(c)) continue;
      const terms = ['XIO(\\Supervisor_' + half + '.' + tag + ')']
        .concat(stations.map((s) => 'XIO(\\' + s + '.' + tag + ')')).join('');
      return setRungText(r, terms + 'OTE(' + dest + ');');
    }
    return setRungText(r, t.replace(/\\Supervisor\./g, '\\Supervisor_' + half + '.').replace(/\\HMI\./g, '\\HMI_' + half + '.'));
  });
  a = putRungs(a, 'R01_Logic', r01);
  a = a.replace(/\\Supervisor\./g, '\\Supervisor_' + half + '.').replace(/\\HMI\./g, '\\HMI_' + half + '.');
  write(path.join(PROGS, 'Alarms_' + half + '.xml'), a);
  write(path.join(PROGS, 'HMI_' + half + '.xml'), renameProgram(hmiSrc, 'HMI', 'HMI_' + half));
}
fs.unlinkSync(path.join(PROGS, 'Alarms.xml'));
fs.unlinkSync(path.join(PROGS, 'HMI.xml'));

// ── 3. repoint every station, and Production ────────────────────────────────
for (const [st, half] of Object.entries(HALF_OF)) {
  const f = path.join(PROGS, st + '.xml');
  let s = read(f);
  const before = (s.match(/\\(Supervisor|Alarms)\./g) || []).length;
  s = s.replace(/\\Supervisor\./g, '\\Supervisor_' + half + '.').replace(/\\Alarms\./g, '\\Alarms_' + half + '.');
  write(f, s);
  note.push(st + ' -> ' + half + ' (' + before + ' references repointed)');
}
// Production counts what leaves the machine, so it follows the unloader (John's Production_Outfeed)
{
  const f = path.join(PROGS, 'Production.xml');
  let s = read(f);
  s = s.replace(/\\Supervisor\./g, '\\Supervisor_Unloader.');
  write(f, s);
  note.push('Production -> Supervisor_Unloader (it counts what leaves the machine; ASK whether loader stops should count as downtime)');
}

// ── 4. Tasks: schedule the new programs in place of the old ─────────────────
{
  const f = path.join(CTRL, 'Tasks.xml');
  let s = read(f);
  s = s.replace(/<ScheduledProgram Name="Supervisor"\s*\/>/,
    '<ScheduledProgram Name="Supervisor_Loader"/>');
  // the unloader supervisor runs ahead of its own stations
  s = s.replace(/(<ScheduledProgram Name="S05_OutfeedConveyor"\s*\/>)/,
    '<ScheduledProgram Name="Supervisor_Unloader"/>\n$1');
  s = s.replace(/<ScheduledProgram Name="Alarms"\s*\/>/,
    '<ScheduledProgram Name="Alarms_Loader"/>\n<ScheduledProgram Name="Alarms_Unloader"/>');
  s = s.replace(/<ScheduledProgram Name="HMI"\s*\/>/,
    '<ScheduledProgram Name="HMI_Loader"/>\n<ScheduledProgram Name="HMI_Unloader"/>');
  write(f, s);
}

// ── 5. ParameterConnections: each half wired to its own operator station ────
{
  const f = path.join(CTRL, 'ParameterConnections.xml');
  let s = read(f);
  const keep = [];
  for (const line of s.split(/\r?\n/)) {
    if (!/\\Supervisor\./.test(line)) { keep.push(line); continue; }
    // main station -> unloader; infeed station -> loader, with the suffix dropped
    if (/Local:4:I|Local:5:O/.test(line)) { keep.push(line.replace(/\\Supervisor\./g, '\\Supervisor_Unloader.')); continue; }
    if (/io01_InfeedPointIO:4:I|io01_InfeedPointIO:6:O/.test(line)) {
      keep.push(line.replace(/\\Supervisor\./g, '\\Supervisor_Loader.')
        .replace(/\.i_(CycleStart|CycleStop|FaultReset|AirPressureOK|EntryDoorClosed|ExitDoorClosed)Infeed\b/g, '.i_$1'));
      continue;
    }
    keep.push(line.replace(/\\Supervisor\./g, '\\Supervisor_Unloader.'));
  }
  write(f, keep.join('\n'));
}

console.log('1131 v0.4 - two halves\n');
for (const n of note) console.log('  ' + n);
console.log('\nprograms now: ' + fs.readdirSync(PROGS).map((f) => f.replace(/\.xml$/, '')).join(', '));
