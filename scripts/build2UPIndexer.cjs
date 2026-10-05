#!/usr/bin/env node
'use strict';
/**
 * build2UPIndexer.cjs - the 2UP linear-indexer template (Jason, 2026-10-02).
 *
 * Source: Templates\SoftwareStandardizationNew.L5X (never written). Output: a complete project in which
 *   - one index moves NestsPerIndex (2) nests; every station footprint spans two nests, A = left, B = right
 *   - station numbers mean the machine station (S01 = Station[1]); each side is its own program on the same
 *     StaNum; Tracking_Station carries NestNumA / NestNumB; every operator bit in Tracking_Station_Op_Status
 *     and every counter in Tracking_Perform_Station is per side (A/B) so lockout / single step / bypass work
 *     per side or together (both bits written)
 *   - 64 nests, 12 stations; S01_PartLoadA/B, S11_RejectUnloadA/B, S12_GoodUnloadA/B; the other station
 *     programs and their hardware removed; indexer drive, 1734 rack, valve bank and safety stay
 *   - StateMachine skeleton carries the current single-step block written against the A bits
 *
 *   node scripts/build2UPIndexer.cjs [--out "<dir>"] [--name SoftwareStandardization2UP]
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'X:/Electrical Dept/SDC Engineer/Templates/SoftwareStandardizationNew.L5X');
const CHASSIS = flag('chassis', 'X:/Electrical Dept/SDC Engineer/Templates/ChassisStandard_2UP_2026-09-17.L5X');
const OUT_DIR = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/2UP Linear Indexer');
const NAME = flag('name', 'SoftwareStandardization2UP');
const NEST_QTY = 64, STATION_QTY = 12, NESTS_PER_INDEX = 2;
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const log = [];

let x = fs.readFileSync(SRC, 'utf8');
const original = x;
const chassis = fs.readFileSync(CHASSIS, 'utf8');

// ── helpers (same family as stripInterviewTemplate.cjs) ──────────────────────
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const rungComment = (r) => cdataOf((/<Comment>([\s\S]*?)<\/Comment>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, a, b) => a + t + b);
const setRungComment = (r, c) => /<Comment>/.test(r) ? r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, a, b) => a + c + b) : r.replace(/(<Rung\b[^>]*>)/, '$1\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>');
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, a, b) => a + (n++) + b); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
function programBody(name, src) { const m = progRe(name).exec(src || x); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = progRe(name).exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(body)) fail('routine not found: ' + rn);
  return body.replace(re, (m, a, inner, c) => a + '\n' + renumber(rungs.join('\n')) + '\n' + c);
}
function editRoutine(prog, rn, fn) { let b = programBody(prog) || fail('no program ' + prog); const rungs = rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)); b = putRungs(b, rn, fn(rungs)); replaceProgram(prog, b); }
function setST(body, rn, lines) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[^>]*>\\s*<STContent>)([\\s\\S]*?)(</STContent>)');
  if (!re.test(body)) fail('ST routine not found: ' + rn);
  return body.replace(re, (m, a, inner, c) => a + '\n' + lines.map((l, i) => '<Line Number="' + i + '">\n<![CDATA[' + l + ']]>\n</Line>').join('\n') + '\n' + c);
}
function dropTagIn(body, name) {
  const open = new RegExp('<Tag Name="' + name + '"[^>]*?(/?)>').exec(body);
  if (!open) return body;
  if (open[1] === '/') return body.replace(open[0], '');
  return body.replace(new RegExp('<Tag Name="' + name + '"[^>]*>[\\s\\S]*?</Tag>\\s*'), '');
}
function tagXml(body, name) { return (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0]; }
function addTags(body, xmls) { return body.replace(/<\/Tags>/, xmls.join('\n') + '\n</Tags>'); }
function replaceTag(body, name, xml) { const old = tagXml(body, name); if (!old) fail('tag not found: ' + name); return body.replace(old, xml); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// tag builders
const sintPad = (len) => '$00'.repeat(82 - len);
const l5kStr = (s) => '[' + s.length + ",'" + s + sintPad(s.length) + "'\n\t\t]";
const decStr = (s) => '<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[\'' + s + '\']]>\n</DataValueMember>\n</Structure>';
function stringArrayTag(name, values, dims, attrs) {
  const vals = Array.from({ length: dims }, (_, i) => values[i] || '');
  return '<Tag Name="' + name + '" ' + (attrs || 'TagType="Base"') + ' DataType="STRING" Dimensions="' + dims + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[' + vals.map(l5kStr).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="' + dims + '">\n' + vals.map((v, i) => '<Element Index="[' + i + ']">\n' + decStr(v) + '\n</Element>').join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function scalarArrayTag(name, type, dims, desc) {
  const zero = type === 'REAL' ? '0.00000000e+000' : '0', radix = type === 'REAL' ? 'Float' : 'Decimal', dv = type === 'REAL' ? '0.0' : '0';
  return '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '" Dimensions="' + dims + '" Radix="' + radix + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n' + (desc ? '<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n' : '') + '<Data Format="L5K">\n<![CDATA[[' + Array(dims).fill(zero).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="' + type + '" Dimensions="' + dims + '" Radix="' + radix + '">\n' + Array.from({ length: dims }, (_, i) => '<Element Index="[' + i + ']" Value="' + dv + '"/>').join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function scalarTag(name, type, value, desc, extra) {
  const radix = type === 'REAL' ? 'Float' : 'Decimal';
  const l5k = type === 'REAL' ? Number(value).toExponential(8).replace(/e([+-])(\d)$/, 'e$10$2') : String(value);
  return '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '" Radix="' + radix + '" ' + (extra || 'Constant="false"') + ' ExternalAccess="Read/Write" OpcUaAccess="None">\n' + (desc ? '<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n' : '') + '<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + value + '"/>\n</Data>\n</Tag>';
}
function udtTag(name, type, desc, usage) {
  // a UDT/AOI-instance tag with no data block: Studio initialises it to zeros on import
  return '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '" ' + (usage ? 'Usage="' + usage + '" ' : '') + 'Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">' + (desc ? '\n<Description>\n<![CDATA[' + desc + ']]>\n</Description>' : '') + '\n</Tag>';
}

// ═══ 0. names ═══════════════════════════════════════════════════════════════
x = x.replace(/TargetName="SoftwareStandardization"/, 'TargetName="' + NAME + '"').replace(/<Controller Use="Target" Name="SoftwareStandardization"/, '<Controller Use="Target" Name="' + NAME + '"');

// ═══ 1. programs ════════════════════════════════════════════════════════════
const REMOVED = ['S00_IndexerSP', 'S03_PartLoad', 'S04_PartVerify', 'S05_ServoPNP', 'S06_IV4Vision', 'S08_FanucRobotPNP', 'S10_FlexFeedConveyor', 'S10_FlexFeedRobot'];
const SOURCES = ['S01_PartLoad', 'S18_RejectUnload', 'S19_GoodUnload'];                  // cloned, then removed
const srcBodies = Object.fromEntries(SOURCES.map((n) => [n, programBody(n) || fail('source program ' + n)]));
for (const p of REMOVED.concat(SOURCES)) {
  const m = new RegExp('<Program\\b[^>]*?\\sName="' + p + '"[\\s\\S]*?</Program>\\s*').exec(x);
  if (!m) fail('program vanished: ' + p);
  x = x.slice(0, m.index) + x.slice(m.index + m[0].length);
  x = x.replace(new RegExp('\\s*<ScheduledProgram Name="' + p + '"\\s*/>'), '');
}
// parameter connections of removed/source programs
x = x.replace(/<ParameterConnection[^>]*>\s*/g, (m) => (REMOVED.concat(SOURCES).some((p) => m.includes('\\' + p + '.')) ? '' : m));
log.push('programs removed: ' + REMOVED.join(', ') + '; cloned then removed: ' + SOURCES.join(', '));

// ═══ 2. hardware ════════════════════════════════════════════════════════════
const KEEP_MODULES = new Set(['Local', 'SIN1', 'SOUT1', 'sd01_Indexer', 'io01_MainMachine', 'io01_SIN2', 'io1_SOUT2', 'vb01_MainMachine']);
const modules = [...x.matchAll(/<Module\b[^>]*\bName="([^"]+)"[^>]*\bCatalogNumber="([^"]+)"[\s\S]*?<\/Module>/g)].map((m) => ({ name: m[1], cat: m[2], xml: m[0] }));
const removedModules = modules.filter((m) => !KEEP_MODULES.has(m.name));
for (const m of removedModules) x = x.replace(m.xml, '');
const removedModNames = removedModules.map((m) => m.name);
log.push('modules removed: ' + removedModNames.join(', '));
{
  const end = x.indexOf('<Programs>'); const head = x.slice(0, end), tail = x.slice(end); const gone = [];
  const newHead = head.replace(/<Tag Name="([^"]+)"([^>]*?)(?:\/>|>[\s\S]*?<\/Tag>)\s*/g, (m, name, attrs) => {
    const dt = (/DataType="([^"]+)"/.exec(attrs) || [])[1] || '';
    if (['MotionGroup', 'a01_Indexer'].includes(name)) return m;
    if (removedModNames.some((mn) => name.startsWith(mn)) || /^a0[2-9]_/.test(name) || /^AXIS_/.test(dt) || /Fanuc|ROBOT_|POSREG|Lenze/.test(dt)) { gone.push(name); return ''; }
    return m;
  });
  x = newHead + tail;
  log.push('controller tags removed: ' + gone.join(', '));
  x = x.replace(/<ParameterConnection[^>]*>\s*/g, (m) => (removedModNames.some((n) => m.includes(n + ':') || m.includes(n + '_')) || /"a0[2-9]_/.test(m) ? '' : m));
}
// indexer axis: 64 nests on the unwind
{
  const axis = tagXml(x, 'a01_Indexer') || fail('a01_Indexer');
  if (!/PositionUnwind="200000"/.test(axis) || !/PositionUnwindNumerator="20\.0"/.test(axis)) fail('a01_Indexer unwind attributes not as expected');
  x = x.replace(axis, axis.replace('PositionUnwind="200000"', 'PositionUnwind="' + (10000 * NEST_QTY) + '"').replace('PositionUnwindNumerator="20.0"', 'PositionUnwindNumerator="' + NEST_QTY + '.0"'));
}

// ═══ 3. Tracking UDTs ═══════════════════════════════════════════════════════
function udtBlock(src, name) { return (new RegExp('<DataType Name="' + name + '"[\\s\\S]*?</DataType>').exec(src) || [''])[0] || fail('UDT ' + name); }
x = x.replace(udtBlock(x, 'Tracking_Data'), udtBlock(x, 'Tracking_Data').replace(/(Name="Nest"[^>]*Dimension=")21/, '$1' + (NEST_QTY + 1)).replace(/(Name="Station"[^>]*Dimension=")21/, '$1' + (STATION_QTY + 1)));
{
  const b = udtBlock(x, 'Tracking_Station');
  const nestMember = /<Member Name="NestNum"[\s\S]*?<\/Member>/.exec(b)[0];
  const mk = (side, word) => nestMember.replace('Name="NestNum"', 'Name="NestNum' + side + '"').replace('Current Nest Number At Station', 'Nest Number At Station - ' + word + ' (' + side + ')');
  x = x.replace(b, b.replace(nestMember, mk('A', 'Left') + '\n' + mk('B', 'Right')));
}
{
  const b = udtBlock(x, 'Tracking_Station_Op_Status');
  const bits = ['Lockout', 'Bypass', 'SingleStep', 'DryRun', 'SingleCycle', 'SingleTrigger', 'SingleDisableTracking', 'SingleClearTracking'];
  const descs = { Lockout: 'Lockout (Toggle)', Bypass: 'Bypass (Toggle)', SingleStep: 'Single Step (Toggle)', DryRun: 'Dry Run Mode (Toggle)', SingleCycle: 'Single Cycle (Toggle)', SingleTrigger: 'Single Trigger (Momentary)', SingleDisableTracking: 'Disable Setting Tracking In Single Step / Single Cycle (Toggle)', SingleClearTracking: 'Clear Part Tracking When In Single Step / Single Cycle (Hold)' };
  const host = (n) => '<Member Name="ZZZZZZZZZZTracking_S' + n + '" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>';
  const bit = (name, hostN, i, side) => '<Member Name="' + name + side + '" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZTracking_S' + hostN + '" BitNumber="' + i + '" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[' + descs[name] + ' - ' + (side === 'A' ? 'Left' : 'Right') + ' (' + side + ')]]>\n</Description>\n</Member>';
  const members = [host(0), ...bits.map((n, i) => bit(n, 0, i, 'A')), host(9), ...bits.map((n, i) => bit(n, 9, i, 'B'))].join('\n');
  x = x.replace(b, b.replace(/<Members>[\s\S]*<\/Members>/, '<Members>\n' + members + '\n</Members>'));
}
x = x.replace(udtBlock(x, 'Tracking_Perform_Station'), udtBlock(chassis, 'Tracking_Perform_Station'));
// per-nest station results: one slot per station (count + 1), not the template's 21 (Jason 2026-10-05)
x = x.replace(udtBlock(x, 'Tracking_Part_Assy_Stat'), udtBlock(x, 'Tracking_Part_Assy_Stat').replace(/(Name="Station" DataType="Tracking_Process_Op_Result" Dimension=")21/, '$1' + (STATION_QTY + 1)));
if (!new RegExp('Name="Station" DataType="Tracking_Process_Op_Result" Dimension="' + (STATION_QTY + 1) + '"').test(udtBlock(x, 'Tracking_Part_Assy_Stat'))) fail('Part_Assy_Stat Station dimension not applied');
// every Tracking_Part_Assy_Stat tag (the ZeroPartAssyStat constants) gets data built to the new size
const opResultL5K = '[' + Array(STATION_QTY + 1).fill('[0]').join(',') + ']';
const partAssyL5K = '[0,' + opResultL5K + ",0,[0,'" + '$00'.repeat(82) + "'\n\t\t]]";
const partAssyDec = '<Structure DataType="Tracking_Part_Assy_Stat">\n<DataValueMember Name="Good" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Bad" DataType="BOOL" Value="0"/>\n<DataValueMember Name="PartLoaded" DataType="BOOL" Value="0"/>\n<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="' + (STATION_QTY + 1) + '">\n' + Array.from({ length: STATION_QTY + 1 }, (_, i) => '<Element Index="[' + i + ']">\n<Structure DataType="Tracking_Process_Op_Result">\n<DataValueMember Name="Attempt" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Success" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Failure" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Lockout" DataType="BOOL" Value="0"/>\n</Structure>\n</Element>').join('\n') + '\n</ArrayMember>\n<DataValueMember Name="FailureType" DataType="INT" Radix="Decimal" Value="0"/>\n<StructureMember Name="FailureMessage" DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[]]>\n</DataValueMember>\n</StructureMember>\n</Structure>';
function resizePartAssyTags(body) {
  return body.replace(/<Tag Name="([^"]+)"([^>]*DataType="Tracking_Part_Assy_Stat"[^>]*)>[\s\S]*?<\/Tag>/g, (m, name, attrs) => '<Tag Name="' + name + '"' + attrs + '>\n<Data Format="L5K">\n<![CDATA[' + partAssyL5K + ']]>\n</Data>\n<Data Format="Decorated">\n' + partAssyDec + '\n</Data>\n</Tag>');
}
log.push('Tracking UDTs: Nest[' + (NEST_QTY + 1) + '] Station[' + (STATION_QTY + 1) + ']; NestNumA/NestNumB; OpStatus and PerformData per side (A/B)');

// ═══ 4. the station pairs ═══════════════════════════════════════════════════
const STATIONS = [
  // S01's incoming nests are not at station 12 - a linear loop has more nests than stations - they are the pair one
  // index upstream of station 1, which the indexer publishes as Station[0].NestNumA/B (Jason 2026-10-05)
  { src: 'S01_PartLoad', base: 'S01_PartLoad', staNum: 1, staNumPre: 0, list: 'S01 Part Load: ', words: 'Part Load' },
  { src: 'S18_RejectUnload', base: 'S11_RejectUnload', staNum: 11, staNumPre: 10, list: 'S11 Reject Unload: ', words: 'Reject Unload' },
  { src: 'S19_GoodUnload', base: 'S12_GoodUnload', staNum: 12, staNumPre: 10, list: 'S12 Good Unload: ', words: 'Good Unload' },
];
function cloneStation(st, side) {
  const name = st.base + side;
  let b = srcBodies[st.src];
  b = b.replace(new RegExp('(<Program\\b[^>]*?\\sName=")' + st.src + '"'), '$1' + name + '"');
  b = b.replace(/\\S00_IndexerSP\./g, '\\S00_IndexerNoSP.');
  b = b.replace(/MOVE\(\d+,StaNum\) MOVE\(\d+,StaNumPre\)/, 'MOVE(' + st.staNum + ',StaNum) MOVE(' + st.staNumPre + ',StaNumPre)');
  b = b.replace(/Station\[(StaNum|StaNumPre)\]\.NestNum(?![A-Za-z])/g, 'Station[$1].NestNum' + side);
  b = b.replace(/Station\[StaNum\]\.OpStatus\.([A-Za-z]+)(?![A-Za-z])/g, 'Station[StaNum].OpStatus.$1' + side);
  b = b.replace(/Station\[StaNum\]\.PerformData\.([A-Za-z]+)(?![A-Za-z])/g, 'Station[StaNum].PerformData.$1' + side);
  b = b.replace(/station 17 is final inspection/g, 'station ' + st.staNumPre + ' is final inspection');
  // alarm list: the side in front of every message, so the operator knows which half
  const list = tagXml(b, 'AlarmList');
  const vals = [...list.matchAll(/<DataValueMember Name="DATA"[^>]*>\s*<!\[CDATA\['([^']*)'\]\]>/g)].map((m) => m[1]);
  b = replaceTag(b, 'AlarmList', stringArrayTag('AlarmList', vals.map((v) => (v ? side + ' - ' + v : '')), 10));
  // description
  const sideWord = side === 'A' ? 'left nest (A)' : 'right nest (B)';
  if (/<Program\b[^>]*>\s*<Description>/.test(b)) b = b.replace(/(<Program\b[^>]*>\s*<Description>\s*<!\[CDATA\[)[\s\S]*?(\]\]>)/, '$1' + st.words + ' - ' + sideWord + '$2');
  else b = b.replace(/(<Program\b[^>]*>)/, '$1\n<Description>\n<![CDATA[' + st.words + ' - ' + sideWord + ']]>\n</Description>');
  return b;
}
const newPrograms = [];
for (const st of STATIONS) for (const side of ['A', 'B']) newPrograms.push({ name: st.base + side, xml: cloneStation(st, side) });
// insert after the indexer program, schedule after it too
{
  const idx = programBody('S00_IndexerNoSP') || fail('indexer missing');
  x = x.replace(idx, idx + '\n' + newPrograms.map((p) => p.xml).join('\n'));
  x = x.replace(/(<ScheduledProgram Name="S00_IndexerNoSP"\s*\/>)/, '$1\n' + newPrograms.map((p) => '<ScheduledProgram Name="' + p.name + '"/>').join('\n'));
}
log.push('station programs: ' + newPrograms.map((p) => p.name).join(', '));
const ALL_STATIONS = newPrograms.map((p) => p.name);

// cross-program references: expand the source names into A and B, strip the removed programs
const removedRe = new RegExp('(XIC|XIO)\\(\\\\(?:' + REMOVED.map(esc).join('|') + ')\\.[A-Za-z0-9_.\\[\\]]+\\)\\s*', 'g');
function expandRefs(t) {
  for (const st of STATIONS) t = t.replace(new RegExp('(XIC|XIO)\\(\\\\' + st.src + '\\.([A-Za-z0-9_]+)\\)', 'g'), '$1(\\' + st.base + 'A.$2)$1(\\' + st.base + 'B.$2)');
  return t.replace(removedRe, '').replace(/\s+/g, ' ').trim();
}

// ═══ 5. S00_IndexerNoSP ═════════════════════════════════════════════════════
{
  let b = programBody('S00_IndexerNoSP');
  // tags: NestsPerIndex, i_EmptyNestA/B, lists, complete times
  b = replaceTag(b, 'i_EmptyNest', scalarTag('i_EmptyNestA', 'BOOL', 0, 'Last Station Left Nest (A) Is Empty', 'Usage="Input" Constant="false"') + '\n' + scalarTag('i_EmptyNestB', 'BOOL', 0, 'Last Station Right Nest (B) Is Empty', 'Usage="Input" Constant="false"'));
  b = addTags(b, [scalarTag('NestsPerIndex', 'REAL', NESTS_PER_INDEX + '.0', 'Nests Moved Per Index', 'Constant="true"')]);
  b = replaceTag(b, 'StationCompleteTimes', scalarArrayTag('StationCompleteTimes', 'REAL', STATION_QTY + 1));
  b = replaceTag(b, 'ActuatorsSafeList', stringArrayTag('ActuatorsSafeList', ['', 'Station 1 A', 'Station 1 B', 'Station 11 A', 'Station 11 B', 'Station 12 A', 'Station 12 B'], 10));
  b = replaceTag(b, 'AlarmList', stringArrayTag('AlarmList', ['', 'Actuators NOT Safe For Index Start - ', 'Waiting For Index To Start', 'Waiting For Index To Complete', 'Last Station Empty Nest Sensor A Blocked', 'Last Station Empty Nest Sensor B Blocked', 'Waiting For Indexer To Stop'], 10));
  replaceProgram('S00_IndexerNoSP', b);
  // R01
  editRoutine('S00_IndexerNoSP', 'R01_Inputs', (rungs) => rungs.map((r) => {
    const t = rungText(r);
    if (/^MOD\(iq_IndexerAxis\.ActualPosition,1\.0,DialPosRmndr\)/.test(t)) return setRungComment(setRungText(r, t.replace('MOD(iq_IndexerAxis.ActualPosition,1.0,DialPosRmndr)', 'MOD(iq_IndexerAxis.ActualPosition,NestsPerIndex,DialPosRmndr)').replace('SUB(1.0,OnStationTolNests,OnStaTol1Minus)', 'SUB(NestsPerIndex,OnStationTolNests,OnStaTol1Minus)')), 'Indexer On Station - the remainder of the position over NestsPerIndex');
    if (/OTE\(StationsComplete\)/.test(t) || /OTE\(ActuatorsSafe\)/.test(t)) return setRungText(r, expandRefs(t));
    if (/OTE\(Pause\)/.test(t)) return setRungText(r, '[XIC(\\S01_PartLoadA.q_Pause) MOVE(1,PauseReason) ,XIC(\\S01_PartLoadB.q_Pause) MOVE(2,PauseReason) ]OTE(Pause);');
    if (/OpStatus\.SingleStep\)OTE\(SS\)/.test(t)) return setRungText(r, t.replace('OpStatus.SingleStep)', 'OpStatus.SingleStepA)'));   // the indexer is one machine: its station-0 bit is the A bit
    return r;
  }));
  // R02 state 13: both leaving nests empty
  editRoutine('S00_IndexerNoSP', 'R02_StateTransitions', (rungs) => rungs.map((r) => (/MOVE\(13,Control\.StateReg\)/.test(rungText(r)) ? setRungText(r, rungText(r).replace('[XIC(i_EmptyNest) ,XIO(p_OnStation) ]', '[XIC(i_EmptyNestA) XIC(i_EmptyNestB) ,XIO(p_OnStation) ]')) : r)));
  // R03 complete times: one rung per program
  editRoutine('S00_IndexerNoSP', 'R03_StateLogic', (rungs) => {
    const keep = rungs.filter((r) => !/StationCompleteTimes\[/.test(rungText(r)));
    const onsBits = [7, 8, 9, 24, 25, 26];                      // the template's own six complete-time one-shots
    const times = [];
    for (const st of STATIONS) for (const side of ['A', 'B']) times.push(newRung(times.length === 0 ? 'Record Ok To Index For Each Station ***Used to Determine Stations With Longest Cycle Times***' : '', 'XIC(\\' + st.base + side + '.q_StationComplete)ONS(ONS.' + onsBits[times.length] + ')DIV(CycleTimer.ACC,1000,StationCompleteTimes[' + st.staNum + ']);'));
    return keep.concat(times);
  });
  // R04 move targets
  editRoutine('S00_IndexerNoSP', 'R04_IndexerServo', (rungs) => rungs.map((r) => {
    let t = rungText(r); if (!/DialPosRmndr/.test(t)) return r;
    t = t.replace(/SUB\(1\.0,DialPosRmndr,IndexerAxisMotionParameters\.Position\)/g, 'SUB(NestsPerIndex,DialPosRmndr,IndexerAxisMotionParameters.Position)').replace(/CPT\(IndexerAxisMotionParameters\.Position,1\.0 \+ \(1\.0-DialPosRmndr\)\)/g, 'CPT(IndexerAxisMotionParameters.Position,NestsPerIndex + (NestsPerIndex-DialPosRmndr))');
    return setRungText(r, t);
  }));
  // R10 nest numbers: left nest per station two nests apart, right nest = left + 1
  {
    let b2 = programBody('S00_IndexerNoSP');
    b2 = setST(b2, 'R10_CalcDialStationNestNums', [
      '//Nest numbers for every station: one index moves NestsPerIndex nests, a station spans two nests (A left, B right)',
      '//Station[0] is the pair one index upstream of station 1 - the nests arriving next, which S01 reads as its incoming nests',
      'NewNestNum := ((TRUNC(iq_IndexerAxis.ActualPosition + OnStationTolNests) + (\\Tracking.p_NestQty - 1)) MOD \\Tracking.p_NestQty) + 1;',
      'IF (\\Tracking.p_Data.Station[1].NestNumA = NewNestNum) THEN',
      '\tNestsShiftedPulse := 0;',
      'ELSE',
      '\t\\Tracking.p_Data.Station[1].NestNumA := NewNestNum;',
      '\tNestsShiftedPulse := 1;',
      'END_IF;',
      'FOR StationNum := 0 TO \\Tracking.p_StationQty by 1 DO',
      '\t\\Tracking.p_Data.Station[StationNum].NestNumA := (NewNestNum - 1 - ' + NESTS_PER_INDEX + '*(StationNum - 1) + ' + NESTS_PER_INDEX + '*\\Tracking.p_NestQty) MOD \\Tracking.p_NestQty + 1;',
      '\t\\Tracking.p_Data.Station[StationNum].NestNumB := (\\Tracking.p_Data.Station[StationNum].NestNumA MOD \\Tracking.p_NestQty) + 1;',
      'END_FOR;',
    ]);
    replaceProgram('S00_IndexerNoSP', b2);
  }
  // R20: actuators-safe lists over the six programs; two empty-nest alarms
  editRoutine('S00_IndexerNoSP', 'R20_Alarms', (rungs) => rungs.map((r) => {
    const t = rungText(r);
    if (/CONCAT\(ActuatorsSafeMessageA,ActuatorsSafeList\[1\]/.test(t)) {
      const alarmN = (/OTE\(Alarm\[(\d+)\]\.Active\)/.exec(t) || [])[1];
      const legs = []; let i = 1;
      for (const st of STATIONS) for (const side of ['A', 'B']) legs.push('XIO(\\' + st.base + side + '.q_ActuatorsSafe) CONCAT(ActuatorsSafeMessageA,ActuatorsSafeList[' + (i++) + '],Alarm[' + alarmN + '].Message)');
      const nt = t.replace(/\[XIO\(\\S01_PartLoad\.q_ActuatorsSafe\)[\s\S]*Alarm\[\d+\]\.Message\) (?=\]|,MOVE)/, '[' + legs.join(' ,') + ' ');
      if (/\\S0[3-9]_|\\S1[089]_/.test(nt)) fail('actuators-safe list not fully rewritten: ' + nt.slice(0, 200));
      return setRungText(r, nt);
    }
    if (/OTE\(Alarm\[4\]\.Active\)/.test(t) && /AlwaysOff/.test(t)) return setRungComment(setRungText(r, '[[XIC(Status.State[10]) ,XIC(Status.State[37]) ] MOVE(5000,Control.FaultTime) XIC(Status.TimeoutFlt) XIC(p_OnStation) XIO(i_EmptyNestA) ,XIC(Alarm[4].Active) XIO(FaultReset) ][OTE(Alarm[4].Active) ,ONS(ONS.18) CONCAT(g_StationList[StaNum],AlarmList[4],Alarm[4].Message) ];'), 'Last Station Empty Nest Sensor A Blocked');
    if (/OTE\(Alarm\[5\]\.Active\)/.test(t)) return setRungComment(setRungText(r, t.replace('XIO(i_EmptyNest)', 'XIO(i_EmptyNestB)')), 'Last Station Empty Nest Sensor B Blocked');
    return r;
  }));
  log.push('S00_IndexerNoSP: NestsPerIndex = ' + NESTS_PER_INDEX + ' in on-station, auto and manual move; R10 fills NestNumA/NestNumB; i_EmptyNestA/B; polls over the six programs');
}

// ═══ 6. Tracking program ════════════════════════════════════════════════════
{
  let b = programBody('Tracking') || fail('Tracking');
  // p_Data: regenerate from the template's own Nest element + a Station element built to the new UDT
  {
    const old = tagXml(b, 'p_Data');
    const l5k = cdataOf((/<Data Format="L5K">([\s\S]*?)<\/Data>/.exec(old) || [])[1]).trim();
    // L5K: [[nest...],[station...]] - take the first nest element by bracket matching
    const inner = l5k.slice(1, -1);                      // [nests],[stations]
    const nestsArr = (() => { let d = 0, i = 0; for (; i < inner.length; i++) { if (inner[i] === '[') d++; else if (inner[i] === ']') { d--; if (d === 0) break; } } return inner.slice(0, i + 1); })();
    const nestElem = (() => { const s = nestsArr.slice(1); let d = 0, i = 0; for (; i < s.length; i++) { if (s[i] === '[') d++; else if (s[i] === ']') { d--; if (d === 0) break; } } return s.slice(0, i + 1); })();
    // the nest element's per-station result array shrinks with the UDT (21 -> STATION_QTY + 1)
    const nestElemSized = nestElem.replace(/\[(?:\[0\],){20}\[0\]\]/, opResultL5K);
    if (nestElemSized === nestElem) fail('nest L5K element: 21-slot station array not found');
    const stationElemL5K = '[[0,0],0,0,[0,0,0,0.00000000e+000,0,0,0,0,0,0,0.00000000e+000,0,0,0]]';
    const newL5K = '[[' + Array(NEST_QTY + 1).fill(nestElemSized).join(',') + '],[' + Array(STATION_QTY + 1).fill(stationElemL5K).join(',') + ']]';
    const dec = (/<Data Format="Decorated">([\s\S]*?)<\/Data>/.exec(old) || [])[1];
    // the first Nest element, whole: Element tags nest (PartStatus.Station[] inside), so match by depth
    const nestDec = (() => {
      const start = dec.indexOf('<Element Index="[0]">', dec.indexOf('<ArrayMember Name="Nest"'));
      if (start < 0) fail('nest element');
      const re = /<Element\b|<\/Element>/g; re.lastIndex = start; let d = 0, m;
      while ((m = re.exec(dec))) { d += m[0] === '</Element>' ? -1 : 1; if (d === 0) return dec.slice(start, m.index + '</Element>'.length); }
      fail('nest element end');
    })();
    const nestDecSized = nestDec.replace(/<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="21">[\s\S]*?<\/ArrayMember>/, (m) => {
      const els = [...m.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<\/Element>/g)].filter((e) => +e[1] <= STATION_QTY).map((e) => e[0]);
      if (els.length !== STATION_QTY + 1) fail('nest decorated element: station array not 21');
      return '<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="' + (STATION_QTY + 1) + '">\n' + els.join('\n') + '\n</ArrayMember>';
    });
    if (nestDecSized === nestDec) fail('nest decorated element: station array not found');
    const bits = ['Lockout', 'Bypass', 'SingleStep', 'DryRun', 'SingleCycle', 'SingleTrigger', 'SingleDisableTracking', 'SingleClearTracking'];
    const perf = (s) => ['Attempts', 'Successes', 'Failures'].map((n) => '<DataValueMember Name="' + n + s + '" DataType="DINT" Radix="Decimal" Value="0"/>').join('\n') + '\n<DataValueMember Name="Efficiency' + s + '" DataType="REAL" Radix="Float" Value="0.0"/>\n<DataValueMember Name="FaultCount' + s + '" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="HMIColorStatus' + s + '" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="HMI_Reset' + s + '" DataType="BOOL" Value="0"/>';
    const stationDec = '<Structure DataType="Tracking_Station">\n<StructureMember Name="OpStatus" DataType="Tracking_Station_Op_Status">\n' + ['A', 'B'].flatMap((s) => bits.map((n) => '<DataValueMember Name="' + n + s + '" DataType="BOOL" Value="0"/>')).join('\n') + '\n</StructureMember>\n<DataValueMember Name="NestNumA" DataType="DINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="NestNumB" DataType="DINT" Radix="Decimal" Value="0"/>\n<StructureMember Name="PerformData" DataType="Tracking_Perform_Station">\n' + perf('A') + '\n' + perf('B') + '\n</StructureMember>\n</Structure>';
    const elems = (tpl, n, isNest) => Array.from({ length: n }, (_, i) => isNest ? tpl.replace(/^<Element Index="\[0\]">/, '<Element Index="[' + i + ']">') : '<Element Index="[' + i + ']">\n' + tpl + '\n</Element>').join('\n');
    const newDec = '<Structure DataType="Tracking_Data">\n<ArrayMember Name="Nest" DataType="Tracking_Nest" Dimensions="' + (NEST_QTY + 1) + '">\n' + elems(nestDecSized, NEST_QTY + 1, true) + '\n</ArrayMember>\n<ArrayMember Name="Station" DataType="Tracking_Station" Dimensions="' + (STATION_QTY + 1) + '">\n' + elems(stationDec, STATION_QTY + 1, false) + '\n</ArrayMember>\n</Structure>';
    const head = (/<Tag Name="p_Data"[^>]*>/.exec(old) || [])[0];
    b = b.replace(old, head + '\n<Data Format="L5K">\n<![CDATA[' + newL5K + ']]>\n</Data>\n<Data Format="Decorated">\n' + newDec + '\n</Data>\n</Tag>');
  }
  b = replaceTag(b, 'ResetTimersA', scalarArrayTag('ResetTimersA', 'DINT', NEST_QTY + 1));
  b = replaceTag(b, 'ResetTimersB', scalarArrayTag('ResetTimersB', 'DINT', STATION_QTY + 1));
  b = addTags(b, [scalarTag('IncrementFailureB', 'BOOL', 0), scalarTag('IncrementSuccessB', 'BOOL', 0), scalarTag('FailureNestNumB', 'DINT', 0), scalarTag('SuccessNestNumB', 'DINT', 0), scalarTag('Side', 'DINT', 0), udtTag('NestPerformanceC', 'NestPerformance'), udtTag('NestPerformanceD', 'NestPerformance')]);
  // R05: both nests of every station
  b = setST(b, 'R05_PartOverallStatus', [
    '//Overall part status for the nest under each side (A left, B right) of every station',
    'FOR StationNum := 1 TO p_StationQty BY 1 DO',
    'FOR Side := 0 TO 1 BY 1 DO',
    'NestSuccess := 0;', 'NestFailure := 0;',
    'IF Side = 0 THEN', 'MyNestNum := p_Data.Station[StationNum].NestNumA;', 'ELSE', 'MyNestNum := p_Data.Station[StationNum].NestNumB;', 'END_IF;',
    '//Check Stations Before and up to the current one',
    'For StationNum2 := 0 to StationNum By 1 Do',
    'IF p_Data.Nest[MyNestNum].PartStatus.PartLoaded THEN',
    'IF (p_Data.Nest[MyNestNum].PartStatus.Station[StationNum2].Failure) THEN', 'NestFailure := 1;', 'NestSuccess := 0;', 'EXIT;',
    'ELSIF (p_Data.Nest[MyNestNum].PartStatus.Station[StationNum2].Success) THEN', 'NestFailure := 0;', 'NestSuccess := 1;', 'EXIT;',
    'else', 'NestFailure := 0;', 'NestSuccess := 0;', 'End_if;', 'End_if;', 'End_for;',
    'If (NestSuccess) Then', 'p_Data.Nest[MyNestNum].PartStatus.Bad := 0;', 'p_Data.Nest[MyNestNum].PartStatus.Good := 1;',
    'ELSIf (NestFailure) Then', 'p_Data.Nest[MyNestNum].PartStatus.Bad := 1;', 'p_Data.Nest[MyNestNum].PartStatus.Good := 0;',
    'Else', 'p_Data.Nest[MyNestNum].PartStatus.Bad := 0;', 'p_Data.Nest[MyNestNum].PartStatus.Good := 0;', 'End_if;',
    'End_for;', 'End_for;',
  ]);
  // R06: per-side station performance resets (chassis form, with the Production reset-all term kept)
  {
    const ch = programBody('Tracking', chassis) || fail('chassis Tracking');
    const st = (/<Routine Name="R06_ResetStationPerformance"[^>]*>\s*<STContent>([\s\S]*?)<\/STContent>/.exec(ch) || [])[1] || fail('chassis R06');
    const lines = [...st.matchAll(/<Line Number="\d+">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1]).map((l) => l.replace('TimerD.TimerEnable := HMI_Momentary.1;', 'TimerD.TimerEnable := HMI_Momentary.1 OR \\Production.p_HMI_ResetAllCounts;'));
    b = setST(b, 'R06_ResetStationPerformance', lines);
  }
  replaceProgram('Tracking', b);
  editRoutine('Tracking', 'R01_Inputs', (rungs) => rungs.map((r) => {
    const t = rungText(r);
    if (/OTE\(IncrementFailure\)/.test(t)) return setRungComment(setRungText(r, '[XIC(\\S11_RejectUnloadA.q_PartUnloaded) OTE(IncrementFailure) ,XIC(\\S11_RejectUnloadB.q_PartUnloaded) OTE(IncrementFailureB) ];'), 'Reject Unload Triggers - A And B');
    if (/MOVE\(p_Data\.Station\[18\]/.test(t)) return setRungComment(setRungText(r, 'MOVE(p_Data.Station[11].NestNumA,FailureNestNum)MOVE(p_Data.Station[11].NestNumB,FailureNestNumB);'), 'Nest Numbers At The Reject Unload Station');
    if (/OTE\(IncrementSuccess\)/.test(t)) return setRungComment(setRungText(r, '[XIC(\\S12_GoodUnloadA.q_PartUnloaded) OTE(IncrementSuccess) ,XIC(\\S12_GoodUnloadB.q_PartUnloaded) OTE(IncrementSuccessB) ];'), 'Good Unload Triggers - A And B');
    if (/MOVE\(p_Data\.Station\[19\]/.test(t)) return setRungComment(setRungText(r, 'MOVE(p_Data.Station[12].NestNumA,SuccessNestNum)MOVE(p_Data.Station[12].NestNumB,SuccessNestNumB);'), 'Nest Numbers At The Good Unload Station');
    return r;
  }));
  editRoutine('Tracking', 'R02_Logic', (rungs) => {
    const out = [];
    for (const r of rungs) {
      const t = rungText(r);
      if (/XIC\(IncrementFailure\)/.test(t)) { out.push(setRungComment(r, 'Update Nest Performance At Reject Unload Station A')); out.push(newRung('Update Nest Performance At Reject Unload Station B', t.replace(/IncrementFailure/g, 'IncrementFailureB').replace('ONS(ONS.0)', 'ONS(ONS.2)').replace('NestPerformanceA', 'NestPerformanceC').replace(/FailureNestNum/g, 'FailureNestNumB'))); continue; }
      if (/XIC\(IncrementSuccess\)/.test(t)) { out.push(setRungComment(r, 'Update Nest Performance At Good Unload Station A')); out.push(newRung('Update Nest Performance At Good Unload Station B', t.replace(/IncrementSuccess/g, 'IncrementSuccessB').replace('ONS(ONS.1)', 'ONS(ONS.3)').replace('NestPerformanceB', 'NestPerformanceD').replace(/SuccessNestNum/g, 'SuccessNestNumB'))); continue; }
      out.push(r);
    }
    return out;
  });
  // the A side is named A, never bare (Jason 2026-10-02); the nest-performance instances say what they count
  {
    let b2 = programBody('Tracking');
    const renames = [['IncrementFailure', 'IncrementFailureA'], ['IncrementSuccess', 'IncrementSuccessA'], ['FailureNestNum', 'FailureNestNumA'], ['SuccessNestNum', 'SuccessNestNumA']];
    for (const [from, to] of renames) b2 = b2.replace(new RegExp('(?<![A-Za-z0-9_])' + from + '(?![A-Za-z0-9_])', 'g'), to);
    for (const [from, to] of [['NestPerformanceA', 'NestPerformanceRejectA'], ['NestPerformanceC', 'NestPerformanceRejectB'], ['NestPerformanceB', 'NestPerformanceGoodA'], ['NestPerformanceD', 'NestPerformanceGoodB']]) b2 = b2.replace(new RegExp('(?<![A-Za-z0-9_])' + from + '(?![A-Za-z0-9_])', 'g'), '\u0000' + to);
    b2 = b2.replace(/\u0000/g, '');
    replaceProgram('Tracking', b2);
  }
  log.push('Tracking: p_Data regenerated (Nest[' + (NEST_QTY + 1) + '], Station[' + (STATION_QTY + 1) + ']); four unload triggers (IncrementFailureA/B, IncrementSuccessA/B, FailureNestNumA/B, SuccessNestNumA/B, NestPerformanceRejectA/B, NestPerformanceGoodA/B); R05 walks both nests of every station; R06 resets per side');
}

// ═══ 7. Supervisor, Alarms, Production, HMI, Map programs ═══════════════════
editRoutine('Supervisor', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/OTE\(AllSMInAuto\)|OTE\(MachineStopped\)|OTE\(StartOK\)/.test(t)) return setRungText(r, expandRefs(t));
  if (/OTE\(HornOverride\)/.test(t)) return setRungText(r, 'XIC(\\S00_IndexerNoSP.q_PauseRestart)OTE(HornOverride);');
  return r;
}));
{
  const modRe = new RegExp('(?<![A-Za-z0-9_])(' + removedModNames.map(esc).join('|') + ')(?![A-Za-z0-9_])');
  let eip = 0;
  editRoutine('Supervisor', 'R20_Alarms', (rungs) => rungs.filter((r) => !(/AOI_EIPStatus\(/.test(rungText(r)) && modRe.test(rungText(r)))).map((r) => (/AOI_EIPStatus\(/.test(rungText(r)) ? setRungText(r, rungText(r).replace(/EQ\(EIPStatusCount,\d+\)/, 'EQ(EIPStatusCount,' + (eip++) + ')')) : r)));
  editRoutine('Supervisor', 'R15_EIPMonitor', (rungs) => rungs.map((r) => (/GE\(EIPStatusCount,/.test(rungText(r)) ? setRungText(r, 'GE(EIPStatusCount,' + eip + ')MOVE(0,EIPStatusCount);') : r)));
  let b = programBody('Supervisor'); for (const m of removedModNames) b = dropTagIn(b, m + 'EIP'); replaceProgram('Supervisor', b);
  log.push('Supervisor: ' + eip + ' EIP nodes monitored');
}
editRoutine('Alarms', 'R01_Logic', (rungs) => rungs.map((r) => (/OTE\(p_NoMachineFaults\)|OTE\(p_NoMachineWarnings\)/.test(rungText(r)) ? setRungText(r, expandRefs(rungText(r))) : r)));
// Production: both unload sides count, each with its own nest
function countRung(kind, sideA, sideB) { return kind === 'good'
  ? '[XIC(\\S12_GoodUnloadA.q_PartUnloaded) ONS(ONS.0) [ADD(ProductionData.Good,1,ProductionData.Good) ,XIC(\\Supervisor.EnableBatchCount) ADD(\\Supervisor.BatchCount,1,\\Supervisor.BatchCount) ] ,XIC(\\S12_GoodUnloadB.q_PartUnloaded) ONS(ONS.9) [ADD(ProductionData.Good,1,ProductionData.Good) ,XIC(\\Supervisor.EnableBatchCount) ADD(\\Supervisor.BatchCount,1,\\Supervisor.BatchCount) ] ];'
  : '[XIC(\\S11_RejectUnloadA.q_PartUnloaded) ONS(ONS.1) [ADD(ProductionData.Reject,1,ProductionData.Reject) ,MOVE(\\Tracking.p_Data.Station[11].NestNumA,RejectNestNum) MOVE(\\Tracking.p_Data.Nest[RejectNestNum].PartStatus.FailureType,ProductionRejectFailureType) SIZE(ProductionData.FailureTypeCounts[0],0,ProductionArraySize) ,LT(ProductionRejectFailureType,ProductionArraySize) ADD(ProductionData.FailureTypeCounts[ProductionRejectFailureType],1,ProductionData.FailureTypeCounts[ProductionRejectFailureType]) ] ,XIC(\\S11_RejectUnloadB.q_PartUnloaded) ONS(ONS.10) [ADD(ProductionData.Reject,1,ProductionData.Reject) ,MOVE(\\Tracking.p_Data.Station[11].NestNumB,RejectNestNum) MOVE(\\Tracking.p_Data.Nest[RejectNestNum].PartStatus.FailureType,ProductionRejectFailureType) SIZE(ProductionData.FailureTypeCounts[0],0,ProductionArraySize) ,LT(ProductionRejectFailureType,ProductionArraySize) ADD(ProductionData.FailureTypeCounts[ProductionRejectFailureType],1,ProductionData.FailureTypeCounts[ProductionRejectFailureType]) ] ];'; }
editRoutine('Production', 'R01_ProductionData', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/ADD\(ProductionData\.Good,1/.test(t)) return setRungComment(setRungText(r, countRung('good')), 'Production Data Good Parts - A And B');
  if (/ADD\(ProductionData\.Reject,1/.test(t)) return setRungComment(setRungText(r, countRung('reject')), 'Reject Parts - A And B, Each With Its Own Nest');
  if (/S00_IndexerSP\.q_Paused/.test(t)) return setRungText(r, t.replace('S00_IndexerSP', 'S00_IndexerNoSP'));
  return r;
}));
editRoutine('Production', 'R02_ShiftData', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/ADD\(ShiftData\[p_CurrentShift\]\.Good,1/.test(t)) return setRungComment(setRungText(r, '[XIC(\\S12_GoodUnloadA.q_PartUnloaded) ONS(ONS.6) ,XIC(\\S12_GoodUnloadB.q_PartUnloaded) ONS(ONS.11) ]ADD(ShiftData[p_CurrentShift].Good,1,ShiftData[p_CurrentShift].Good);'), 'Good Parts - A And B');
  if (/ADD\(ShiftData\[p_CurrentShift\]\.Reject,1/.test(t)) return setRungComment(setRungText(r, '[XIC(\\S11_RejectUnloadA.q_PartUnloaded) ONS(ONS.7) MOVE(\\Tracking.p_Data.Station[11].NestNumA,RejectNestNum) ,XIC(\\S11_RejectUnloadB.q_PartUnloaded) ONS(ONS.12) MOVE(\\Tracking.p_Data.Station[11].NestNumB,RejectNestNum) ][ADD(ShiftData[p_CurrentShift].Reject,1,ShiftData[p_CurrentShift].Reject) ,MOVE(\\Tracking.p_Data.Nest[RejectNestNum].PartStatus.FailureType,ShiftRejectFailureType) SIZE(ShiftData[p_CurrentShift].FailureTypeCounts[0],0,ShiftArraySize) ,LT(ShiftRejectFailureType,ShiftArraySize) ADD(ShiftData[p_CurrentShift].FailureTypeCounts[ShiftRejectFailureType],1,ShiftData[p_CurrentShift].FailureTypeCounts[ShiftRejectFailureType]) ];'), 'Reject Parts - A And B');
  if (/S00_IndexerSP\.q_Paused/.test(t)) return setRungText(r, t.replace('S00_IndexerSP', 'S00_IndexerNoSP'));
  return r;
}));
// HMI: nest indicator array and the cleanout rung over every nest
{
  let b = programBody('HMI'); b = replaceTag(b, 'HMI_NestIndicator', scalarArrayTag('HMI_NestIndicator', 'DINT', NEST_QTY + 1)); replaceProgram('HMI', b);
  editRoutine('HMI', 'R03_CleanoutMode', (rungs) => rungs.map((r) => (/OTL\(q_CleanoutModeStopTrig\)/.test(rungText(r)) ? setRungText(r, 'XIC(\\Supervisor.q_MachineRunning)XIC(q_CleanoutModeEnabled)' + Array.from({ length: NEST_QTY }, (_, i) => 'XIO(\\Tracking.p_Data.Nest[' + (i + 1) + '].PartStatus.PartLoaded)').join('') + 'ONS(ONS.2)OTL(q_CleanoutModeStopTrig);') : r)));
}
// Map programs: the valve bank is the only EtherNet/IP device left to map
editRoutine('MapInputs', 'R01_Logic', () => [newRung('Map Ethernet IP Inputs Using CPS Instruction - General Devices', 'CPS(vb01_MainMachine:I,vb01_MainMachine_IN,1);')]);
editRoutine('MapOutputs', 'R01_Logic', () => [newRung('Map Ethernet IP Outputs Using CPS Instruction - General Devices', 'CPS(vb01_MainMachine_OUT,vb01_MainMachine:O,1);')]);
for (const p of ['MapInputs', 'MapOutputs']) { let b = programBody(p); for (const t of [...b.matchAll(/<Tag Name="([^"]+)"/g)].map((m) => m[1])) b = dropTagIn(b, t); replaceProgram(p, b); }
// g_StationList sized to the stations
x = x.replace(tagXml(x.slice(0, x.indexOf('<Programs>')), 'g_StationList'), stringArrayTag('g_StationList', ['S00 Indexer: ', 'S01 Part Load: ', '', '', '', '', '', '', '', '', '', 'S11 Reject Unload: ', 'S12 Good Unload: '], STATION_QTY + 1, 'Class="Standard" TagType="Base"'));

// ═══ 8. StateMachine skeleton: the current single-step block, A side ═════════
{
  const s01 = programBody('S01_PartLoadA') || fail('S01_PartLoadA');
  const r01 = rungList(getRoutine(s01, 'R01_Inputs'));
  const pick = (re) => r01.find((r) => re.test(rungText(r))) || fail('S01A R01 rung not found: ' + re);
  const blk = { autoIdle: pick(/OTE\(AutoIdle\)/), running: pick(/OTE\(CycleRunning\)/), stopping: pick(/OTE\(CycleStopping\)/), lockout: pick(/OTE\(Lockout\)/), dryRun: pick(/OTE\(DryRun\)/), ss: pick(/OTE\(SS\);/), sdt: pick(/OTE\(SingleDisableTracking\)/), otu1: pick(/OTU\(\\Tracking\.p_Data\.Station\[StaNum\]\.OpStatus\.SingleCycleA\)/), otu2: pick(/OTU\(\\Tracking\.p_Data\.Station\[StaNum\]\.OpStatus\.SingleStepA\)/), scL: pick(/OTL\(SingleCycle\)/), scU: pick(/OTU\(SingleCycle\)/), ssOk: pick(/OTE\(SS_OK\)/) };
  editRoutine('StateMachine', 'R01_Inputs', (rungs) => {
    const out = [newRung('Station number - set this to your station (A and B programs share it)', 'MOVE(0,StaNum);')];
    for (const r of rungs) {
      const t = rungText(r);
      if (/OTE\(CycleRunning\)/.test(t)) { out.push(blk.running); continue; }
      if (/OTE\(CycleStopping\)/.test(t)) { out.push(blk.stopping); continue; }
      if (/OTE\(SafetyOK\)/.test(t)) { out.push(r, blk.autoIdle); continue; }
      if (/OTE\(Lockout\)/.test(t)) { out.push(blk.lockout); continue; }
      if (/OTE\(DryRun\)/.test(t)) { out.push(blk.dryRun); continue; }
      if (/OTE\(SS\);/.test(t)) { out.push(blk.ss, blk.sdt, blk.otu1, blk.otu2, blk.scL, blk.scU); continue; }
      if (/OTE\(SS_OK\)/.test(t)) { out.push(blk.ssOk); continue; }
      out.push(r);
    }
    return out;
  });
  let b = programBody('StateMachine');
  const s01tag = (n) => tagXml(s01, n) || fail('S01A tag ' + n);
  b = addTags(b, ['AutoIdle', 'StaNum', 'SingleCycle', 'SingleDisableTracking'].filter((n) => !tagXml(b, n)).map(s01tag));
  b = dropTagIn(b, 'HMI_Toggle');
  replaceProgram('StateMachine', b);
  log.push('StateMachine: single-step block from S01_PartLoadA (A bits), HMI_Toggle form removed');
}

// ═══ 8b. every ZeroPartAssyStat constant rebuilt to the 13-slot Part_Assy_Stat ══
{
  const before = (x.match(/DataType="Tracking_Part_Assy_Stat"[^>]*>/g) || []).length;
  for (const p of [...x.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1])) { const b = programBody(p); if (/DataType="Tracking_Part_Assy_Stat"/.test(b)) replaceProgram(p, resizePartAssyTags(b)); }
  log.push('Tracking_Part_Assy_Stat: Station[' + (STATION_QTY + 1) + ']; ' + before + ' tag(s) of that type rebuilt');
}

// ═══ 9. AOIs / UDTs nothing uses any more ═══════════════════════════════════
{
  const removedAoi = [], removedUdt = []; let changed = true;
  const KEEP_TYPES = new Set(['AOI_RangeCheck', 'AOI_TorqueHome', 'AOI_Debounce', 'ConsecFails', 'StationPerformance', 'MovingAverage']);   // SDC standard types the next station needs
  const usedElsewhere = (name, others) => new RegExp('(?<![A-Za-z0-9_])' + esc(name) + '(?![A-Za-z0-9_])').test(others.slice(others.indexOf('<Programs>'))) || new RegExp('DataType="' + esc(name) + '"').test(others.slice(0, others.indexOf('<Programs>')).replace(/<AddOnInstructionDefinition[\s\S]*?<\/AddOnInstructionDefinition>/g, '').replace(/<DataType\b[\s\S]*?<\/DataType>/g, '')) || new RegExp('DataType="' + esc(name) + '"').test(others.slice(0, others.indexOf('<Programs>')).match(/<AddOnInstructionDefinition[\s\S]*?<\/AddOnInstructionDefinition>|<DataType\b[\s\S]*?<\/DataType>/g)?.join('') || '');
  while (changed) {
    changed = false;
    for (const m of [...x.matchAll(/<AddOnInstructionDefinition\b[^>]*\bName="([^"]+)"[\s\S]*?<\/AddOnInstructionDefinition>\s*/g)]) { if (KEEP_TYPES.has(m[1])) continue; const others = x.replace(m[0], ''); if (!usedElsewhere(m[1], others)) { x = others; removedAoi.push(m[1]); changed = true; } }
    for (const m of [...x.matchAll(/<DataType\b[^>]*\bName="([^"]+)"[\s\S]*?<\/DataType>\s*/g)]) { if (KEEP_TYPES.has(m[1])) continue; const others = x.replace(m[0], ''); if (!usedElsewhere(m[1], others)) { x = others; removedUdt.push(m[1]); changed = true; } }
  }
  log.push('AOIs removed: ' + (removedAoi.join(', ') || 'none') + '\n  UDTs removed: ' + (removedUdt.join(', ') || 'none'));
}

// ═══ 10. write + report ═════════════════════════════════════════════════════
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, NAME + '.L5X');
fs.writeFileSync(outFile, x, 'utf8');
if (fs.readFileSync(SRC, 'utf8') !== original) fail('the template changed on disk during the run');
console.log('2UP linear indexer template\n');
for (const l of log) console.log('  ' + l);
console.log('\n  programs: ' + [...x.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  scheduled: ' + [...x.matchAll(/<ScheduledProgram Name="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  modules:   ' + [...x.matchAll(/<Module\b[^>]*\bName="([^"]+)"[^>]*\bCatalogNumber="([^"]+)"/g)].map((m) => m[1] + ' ' + m[2]).join(', '));
console.log('  dangling \\Prog. refs: ' + ([...new Set([...x.slice(x.indexOf('<Programs>')).matchAll(/\\([A-Za-z0-9_]+)\./g)].map((m) => m[1]))].filter((p) => !new RegExp('<Program\\b[^>]*?\\sName="' + p + '"').test(x)).join(', ') || 'none'));
console.log('\n  wrote ' + outFile + '  (' + x.length + ' bytes, from ' + original.length + ')');
