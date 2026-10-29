#!/usr/bin/env node
'use strict';
/**
 * build1163IndexerOnly.cjs — job 1163 Haemonetics: the 2UP linear-indexer program with the six station programs
 * and the valve bank removed, and the indexer drive/motor changed (Jason, 2026-10-23).
 *
 *   node scripts/build1163IndexerOnly.cjs [--src <L5X>] [--out <L5X>]
 *
 *   1. S01_PartLoadA/B, S11_RejectUnloadA/B, S12_GoodUnloadA/B removed, with every reference:
 *      Supervisor polls, Indexer polls / complete-times / actuators-safe lists, Alarms roll-up,
 *      Tracking and Production triggers (back to AlwaysOff placeholders), MainTask schedule.
 *      Supervisor and Alarms keep the template form with the indexer polled (\S00_IndexerNoSP.q_*).
 *   2. vb01_MainMachine removed: module, controller buffer tags, MapInputs/MapOutputs CPS rungs (NOP),
 *      Supervisor EIP tag + alarm rung, EIP node count 3 -> 1.
 *   3. sd01_Indexer 2198-H008-ERS2 -> 2198-H040-ERS2 (ProductCode 5, config header, catalog text);
 *      a01_Indexer motor VPL-B1001M-P -> VPL-A1003F-P (the database form of the orderable VPL-A1003F-PJ12AA), drive peak current 32.5 A.
 *      Motor parameters are left for Studio's Motion Database to refresh on import.
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'C:/2UP Linear Indexer AI Code/_1163_Haemonetics.L5X');
const OUT = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const log = [];
let x = fs.readFileSync(SRC, 'utf8');
const srcLen = x.length;

// ── helpers (same forms as build2UPIndexer.cjs) ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const rungComment = (r) => cdataOf((/<Comment>([\s\S]*?)<\/Comment>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, a, b) => a + t + b);
const setRungComment = (r, c) => /<Comment>/.test(r) ? r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, a, b) => a + c + b) : r.replace(/(<Rung\b[^>]*>)/, '$1\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>');
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, a, b) => a + (n++) + b); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
function programBody(name) { const m = progRe(name).exec(x); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = progRe(name).exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(body)) fail('routine not found: ' + rn);
  return body.replace(re, (m, a, inner, c) => a + '\n' + renumber(rungs.join('\n')) + '\n' + c);
}
function editRoutine(prog, rn, fn) { let b = programBody(prog) || fail('no program ' + prog); const rungs = rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)); b = putRungs(b, rn, fn(rungs)); replaceProgram(prog, b); }
function tagXml(body, name) { return (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0]; }
function dropTagIn(body, name) { const t = tagXml(body, name); if (!t) fail('tag not found: ' + name); return body.replace(t, ''); }
function replaceTag(body, name, xml) { const old = tagXml(body, name); if (!old) fail('tag not found: ' + name); return body.replace(old, xml); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sintPad = (len) => '$00'.repeat(82 - len);
const l5kStr = (s) => '[' + s.length + ",'" + s + sintPad(s.length) + "'\n\t\t]";
const decStr = (s) => '<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[\'' + s + '\']]>\n</DataValueMember>\n</Structure>';
function stringArrayTag(name, values, dims) {
  const vals = Array.from({ length: dims }, (_, i) => values[i] || '');
  return '<Tag Name="' + name + '" TagType="Base" DataType="STRING" Dimensions="' + dims + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[' + vals.map(l5kStr).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="' + dims + '">\n' + vals.map((v, i) => '<Element Index="[' + i + ']">\n' + decStr(v) + '\n</Element>').join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function stringValues(body, name) { const t = tagXml(body, name); const l5k = cdataOf((/<Data Format="L5K">([\s\S]*?)<\/Data>/.exec(t) || [])[1]); return [...l5k.matchAll(/\[(\d+),'([^']*)'/g)].map((m) => m[2].replace(/\$00.*$/, '')); }
const must = (cond, m) => { if (!cond) fail(m); };

// ═══ 1. station programs ═══════════════════════════════════════════════════
const STATIONS = ['S01_PartLoadA', 'S01_PartLoadB', 'S11_RejectUnloadA', 'S11_RejectUnloadB', 'S12_GoodUnloadA', 'S12_GoodUnloadB'];
for (const p of STATIONS) {
  must(programBody(p), 'program not found: ' + p);
  replaceProgram(p, '');
  x = x.replace(new RegExp('\\s*<ScheduledProgram Name="' + p + '"\\s*/>'), '');
  x = x.replace(/<ParameterConnection[^>]*>\s*/g, (m) => (m.includes('\\' + p + '.') ? '' : m));
}
log.push('programs removed: ' + STATIONS.join(', '));
const stationRef = new RegExp('\\\\(' + STATIONS.join('|') + ')\\.', 'g');

// Supervisor polls: template form, the indexer polled
editRoutine('Supervisor', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/OTE\(AllSMInAuto\)/.test(t)) return setRungText(r, 'XIC(\\S00_IndexerNoSP.q_AutoMode)OTE(AllSMInAuto);');
  if (/OTE\(MachineStopped\)/.test(t)) return setRungText(r, 'XIC(\\S00_IndexerNoSP.q_AutoStopped)OTE(MachineStopped);');
  if (/OTE\(StartOK\)/.test(t)) return setRungText(r, 'XIC(\\S00_IndexerNoSP.q_StartOK)[XIC(EnableBatchCount) NE(BatchCount,HMI_BatchSetpoint) ,XIO(EnableBatchCount) ]XIO(q_MachineFaultActive)OTE(StartOK);');
  return r;
}));
// Alarms roll-up: Supervisor + indexer
editRoutine('Alarms', 'R01_Logic', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/OTE\(p_NoMachineFaults\)/.test(t)) return setRungText(r, 'XIO(\\Supervisor.q_AlarmActive)XIO(\\S00_IndexerNoSP.q_AlarmActive)OTE(p_NoMachineFaults);');
  if (/OTE\(p_NoMachineWarnings\)/.test(t)) return setRungText(r, 'XIO(\\Supervisor.q_WarningActive)XIO(\\S00_IndexerNoSP.q_WarningActive)OTE(p_NoMachineWarnings);');
  return r;
}));
// Indexer R01 polls -> placeholders
editRoutine('S00_IndexerNoSP', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/OTE\(StationsComplete\)/.test(t)) return setRungComment(setRungText(r, 'XIC(Status.State[4])TON(StationsCompleteDelay,?,?)XIC(StationsCompleteDelay.DN)ONS(ONS.6)OTE(StationsComplete);'), 'All Stations Complete - add your station');
  if (/OTE\(ActuatorsSafe\)/.test(t)) return setRungComment(setRungText(r, 'XIC(g_MachineBasic.AlwaysOff)OTE(ActuatorsSafe);'), 'All Actuators Safe - add your station');
  if (/OTE\(Pause\)/.test(t)) return setRungComment(setRungText(r, 'XIC(g_MachineBasic.AlwaysOff)OTE(Pause);'), 'Move The Indexer Into Pause - add your station');
  return r;
}));
// Indexer R03: the six station complete-time rungs go
editRoutine('S00_IndexerNoSP', 'R03_StateLogic', (rungs) => rungs.filter((r) => !/StationCompleteTimes\[/.test(rungText(r))));
// Indexer R20: actuators-safe message lists lose their station legs
editRoutine('S00_IndexerNoSP', 'R20_Alarms', (rungs) => rungs.map((r) => {
  let t = rungText(r);
  if (!/ActuatorsSafeMessageA\) \[/.test(t)) return r;
  const n = /Alarm\[(\d+)\]\.Active\)/.exec(t)[1];
  const listRe = new RegExp('CONCAT\\(g_StationList\\[StaNum\\],AlarmList\\[1\\],ActuatorsSafeMessageA\\) \\[.*ActuatorsSafeList\\[\\d+\\],Alarm\\[' + n + '\\]\\.Message\\) ');
  must(listRe.test(t), 'actuators-safe list not matched on Alarm[' + n + ']');
  t = t.replace(listRe, (m) => m.endsWith(',MOVE') ? m : '');
  // r3: "... ONS(ONS.15) <list>] ];"  ->  "... ONS(ONS.15) CONCAT(...,Alarm[1].Message) ];"
  // r9: "... ONS(ONS.22) <list>,MOVE(1,Alarm[7].Severity) ] ];" -> "... ONS(ONS.22) [CONCAT(...,Alarm[7].Message) ,MOVE(1,Alarm[7].Severity) ] ];"
  if (/,MOVE\(1,Alarm\[\d+\]\.Severity\) \] \];$/.test(t)) t = t.replace(/(ONS\(ONS\.\d+\) ),MOVE\(1,Alarm\[(\d+)\]\.Severity\) \] \];$/, (m, a, k) => a + '[CONCAT(g_StationList[StaNum],AlarmList[1],Alarm[' + k + '].Message) ,MOVE(1,Alarm[' + k + '].Severity) ] ];');
  else t = t.replace(/(ONS\(ONS\.\d+\) )\] \];$/, (m, a) => a + 'CONCAT(g_StationList[StaNum],AlarmList[1],Alarm[' + n + '].Message) ];');
  must(!/ActuatorsSafeList|ActuatorsSafeMessageA/.test(t), 'list leftovers on Alarm[' + n + ']');
  return setRungText(r, t);
}));
{ // indexer strings: no station names left; the alarm text loses its trailing " - "
  let b = programBody('S00_IndexerNoSP');
  b = replaceTag(b, 'ActuatorsSafeList', stringArrayTag('ActuatorsSafeList', [], 10));
  const al = stringValues(b, 'AlarmList').map((s) => s.replace(/\s*-\s*$/, ''));
  b = replaceTag(b, 'AlarmList', stringArrayTag('AlarmList', al, 10));
  replaceProgram('S00_IndexerNoSP', b);
}
// Tracking and Production triggers back to the template placeholders
editRoutine('Tracking', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r); if (!stationRef.test(t)) return r; stationRef.lastIndex = 0;
  return setRungComment(setRungText(r, t.replace(/\\S1[12]_[A-Za-z]+\.q_PartUnloaded/g, 'g_MachineBasic.AlwaysOff')), rungComment(r).replace(/ - A And B$/, '') + ' - Replace AlwaysOff With The Unload Trigger');
}));
for (const rn of ['R01_ProductionData', 'R02_ShiftData']) editRoutine('Production', rn, (rungs) => rungs.map((r) => {
  const t = rungText(r); if (!stationRef.test(t)) return r; stationRef.lastIndex = 0;
  return setRungComment(setRungText(r, t.replace(/\\S1[12]_[A-Za-z]+\.q_PartUnloaded/g, 'g_MachineBasic.AlwaysOff')), rungComment(r).replace(/ - A And B.*$/, '') + ' - Replace AlwaysOff With The Unload Trigger');
}));
must(!stationRef.test(x), 'a station reference survived'); stationRef.lastIndex = 0;

// ═══ 2. valve bank ═════════════════════════════════════════════════════════
{
  const m = /<Module\b[^>]*\bName="vb01_MainMachine"[\s\S]*?<\/Module>\s*/.exec(x); must(m, 'module vb01_MainMachine not found'); x = x.replace(m[0], '');
  const end = x.indexOf('<Programs>'); let head = x.slice(0, end); const tail = x.slice(end);
  for (const t of ['vb01_MainMachine_IN', 'vb01_MainMachine_OUT']) head = dropTagIn(head, t);
  x = head + tail;
  for (const [p, rn] of [['MapInputs', 'R01_Logic'], ['MapOutputs', 'R01_Logic']]) editRoutine(p, rn, (rungs) => rungs.map((r) => (/vb01_MainMachine/.test(rungText(r)) ? setRungText(r, 'NOP();') : r)));
  let b = programBody('Supervisor');
  b = dropTagIn(b, 'vb01_MainMachineEIP');
  replaceProgram('Supervisor', b);
  editRoutine('Supervisor', 'R20_Alarms', (rungs) => rungs.filter((r) => !/vb01_MainMachine/.test(rungText(r))));
  editRoutine('Supervisor', 'R15_EIPMonitor', (rungs) => rungs.map((r) => (/GE\(EIPStatusCount,\d+\)/.test(rungText(r)) ? setRungText(r, rungText(r).replace(/GE\(EIPStatusCount,\d+\)/, 'GE(EIPStatusCount,1)')) : r)));
  must(!/vb01/.test(x), 'a vb01 reference survived');
  log.push('vb01_MainMachine removed: module, buffer tags, MapInputs/MapOutputs CPS -> NOP, Supervisor EIP tag + alarm rung, EIP node count 1');
}

// ═══ 3. indexer drive and motor ════════════════════════════════════════════
{
  const m = /<Module\b[^>]*\bName="sd01_Indexer"[\s\S]*?<\/Module>/.exec(x); must(m, 'module sd01_Indexer not found');
  let mod = m[0];
  must(/CatalogNumber="2198-H008-ERS2"/.test(mod) && /ProductCode="2"/.test(mod), 'sd01_Indexer is not the expected 2198-H008-ERS2');
  mod = mod.replace('CatalogNumber="2198-H008-ERS2"', 'CatalogNumber="2198-H040-ERS2"').replace(/ProductCode="2"/, 'ProductCode="5"');
  mod = mod.replace('<CatNum>2198-H008-ERS2</CatNum>', '<CatNum>2198-H040-ERS2</CatNum>');
  must(/CDATA\[\[380,3,257,2,430572775,/.test(mod), 'config header not in the expected form');
  mod = mod.replace('CDATA[[380,3,257,2,430572775,', 'CDATA[[380,3,257,5,430572647,');      // product code + config id as a 2198-H040-ERS2 writes them
  x = x.replace(m[0], mod);
  const a = /<Tag Name="a01_Indexer"[\s\S]*?<\/Tag>/.exec(x); must(a, 'axis a01_Indexer not found');
  let ax = a[0];
  must(/MotorCatalogNumber="VPL-B1001M-P"/.test(ax) && /DriveRatedPeakCurrent="6.25"/.test(ax), 'a01_Indexer is not the expected VPL-B1001M-P on an H008');
  ax = ax.replace('MotorCatalogNumber="VPL-B1001M-P"', 'MotorCatalogNumber="VPL-A1003F-P"').replace('DriveRatedPeakCurrent="6.25"', 'DriveRatedPeakCurrent="32.5"');
  x = x.replace(a[0], ax);
  log.push('sd01_Indexer: 2198-H008-ERS2 -> 2198-H040-ERS2 (ProductCode 5); a01_Indexer motor VPL-B1001M-P -> VPL-A1003F-P (Motion Database form of VPL-A1003F-PJ12AA), drive peak current 32.5 A');
}

// ═══ write ═════════════════════════════════════════════════════════════════
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, x);
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'applyStateEngine.cjs'), OUT], { stdio: 'inherit' }); // current State_Engine_128Max (PLAYBOOK 7d)
x = fs.readFileSync(OUT, 'utf8');
console.log('1163 Haemonetics - indexer only\n');
for (const l of log) console.log('  ' + l);
console.log('\n  programs: ' + [...x.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  scheduled: ' + [...x.matchAll(/<ScheduledProgram Name="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  modules:   ' + [...x.matchAll(/<Module\b[^>]*\bName="([^"]+)"[^>]*\bCatalogNumber="([^"]+)"/g)].map((m) => m[1] + ' ' + m[2]).join(', '));
console.log('  dangling \\Prog. refs: ' + ([...new Set([...x.matchAll(/\\(S\d\d_[A-Za-z]+|Supervisor|Tracking|Alarms|HMI|Production|Recipe)\./g)].map((m) => m[1]))].filter((p) => !programBody(p)).join(', ') || 'none'));
console.log('\n  wrote ' + OUT + '  (' + x.length + ' bytes, from ' + srcLen + ')');
