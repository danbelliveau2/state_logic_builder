#!/usr/bin/env node
'use strict';
/**
 * buildV53EpsonPNP.cjs — SoftwareStandardization V5.3 (Jason, 2026-10-29):
 *   S08_EpsonRobotPNP, the Fanuc PNP station re-targeted to an Epson robot, built from V5.2 and job 1146.
 *
 *   node scripts/buildV53EpsonPNP.cjs [--src <V5.2 L5X>] [--ex <1146 L5X>] [--out <L5X>]
 *
 *   1. UDTs Epson_Robot_Status / Epson_Robot_Control copied from 1146.
 *   2. Epson_Robot_V2_0 split into AOI_Epson_IN (module :I -> Status) and AOI_Epson_OUT (Control -> module :O).
 *   3. Module rob03_EpsonPNP (generic ETHERNET-MODULE, in 100 / out 150, 32 INT each, config 1 size 0), controller
 *      tags rob03_EpsonPNPStatus / rob03_EpsonPNPControl / EpsonPNPInputs / EpsonPNPOutputs, MapInputs / MapOutputs rungs.
 *   4. S08_EpsonRobotPNP = S08_FanucRobotPNP with the Fanuc signals carried onto the Epson map (command word
 *      UserWord[0] out / echo in, UserIn[0] / UserOut[0] bits, InsideBox zones), motors-on init step, one more alarm.
 *   5. Scheduled, polled by Supervisor, rolled up by Alarms, EIP-loss alarm; V5.2 defects fixed (S08 Fanuc connected
 *      to rob02 tags, rob02 EIP-loss alarm added).
 *
 *   SUPERSEDED 2026-10-29: Jason corrected the output in Studio (stop / start / continue / reset rungs, q_StartOK,
 *   InsideBox4 safe home, Alarm[2] Not Used, init-state comments) - his file is the V5.3 template
 *   (Deliveries\SoftwareStandardization V5.3\SoftwareStandardization.L5X, _history\ has both). Copy the Epson form
 *   from that file (playbook 7e); this script reproduces only the first delivery.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'X:/Electrical Dept/Standards - Software/Allen Bradley/Projects/SDC Standard Template/V5.2 - In Progress/SoftwareStandardization.L5X');
const EX = flag('ex', 'C:/1146 Alcon/_1146_AlconNewRegisters.L5X');
const OUT = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/SoftwareStandardization V5.3/SoftwareStandardization.L5X');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const log = [];
let x = fs.readFileSync(SRC, 'utf8');
const a = fs.readFileSync(EX, 'utf8');
const original = x;

// ── helpers (build2UPIndexer / build1163 forms) ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, p, q) => p + t + q);
const setRungComment = (r, c) => /<Comment>/.test(r) ? r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, p, q) => p + c + q) : r.replace(/(<Rung\b[^>]*>)/, '$1\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>');
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
function programBody(name) { const m = progRe(name).exec(x); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = progRe(name).exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(body)) fail('routine not found: ' + rn);
  return body.replace(re, (m, p, inner, q) => p + '\n' + renumber(rungs.join('\n')) + '\n' + q);
}
function editBodyRoutine(body, rn, fn) { const rungs = rungList(getRoutine(body, rn) || fail('no routine ' + rn)); return putRungs(body, rn, fn(rungs)); }
function editRoutine(prog, rn, fn) { let b = programBody(prog) || fail('no program ' + prog); b = editBodyRoutine(b, rn, fn); replaceProgram(prog, b); }
function tagXml(body, name) { return (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0]; }
function dropTagIn(body, name) { const t = tagXml(body, name); if (!t) fail('tag not found: ' + name); return body.replace(t, ''); }
function replaceTag(body, name, xml) { const old = tagXml(body, name); if (!old) fail('tag not found: ' + name); return body.replace(old, xml); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const insertBefore = (hay, marker, text, what) => { const i = hay.indexOf(marker); if (i < 0) fail('marker not found: ' + what); return hay.slice(0, i) + text + hay.slice(i); };
const insertAfter = (hay, marker, text, what) => { const i = hay.indexOf(marker); if (i < 0) fail('marker not found: ' + what); const j = i + marker.length; return hay.slice(0, j) + text + hay.slice(j); };
const countOf = (hay, s) => hay.split(s).length - 1;
const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');

// STRING[n] tags (82-char STRING)
const l5kStr = (s) => '[' + s.length + ",'" + s + '$00'.repeat(82 - s.length) + "']";
const decStr = (i, s) => '<Element Index="[' + i + ']">\n<Structure DataType="STRING">\n<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>\n<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">\n<![CDATA[' + (s ? "'" + s + "'" : '') + ']]>\n</DataValueMember>\n</Structure>\n</Element>';
function stringArrayTag(name, values, dims) {
  const vals = Array.from({ length: dims }, (_, i) => values[i] || '');
  return '<Tag Name="' + name + '" TagType="Base" DataType="STRING" Dimensions="' + dims + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[[' + vals.map(l5kStr).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="' + dims + '">\n' + vals.map((v, i) => decStr(i, v)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
}
function stringValues(body, name) { const t = tagXml(body, name); const l5k = cdataOf((/<Data Format="L5K">([\s\S]*?)<\/Data>/.exec(t) || [])[1]); return [...l5k.matchAll(/\[(\d+),'([^']*)'/g)].map((m) => m[2].replace(/\$00/g, '').slice(0, +m[1])); }

// UDT zero data (L5K + Decorated) from a DataType block
function udtMembers(udt) {
  return [...udt.matchAll(/<Member Name="([^"]+)" DataType="([^"]+)" Dimension="(\d+)" Radix="([^"]*)" Hidden="(true|false)"/g)]
    .map((m) => ({ name: m[1], type: m[2], dim: +m[3], radix: m[4], hidden: m[5] === 'true' }));
}
function udtZero(udt) {
  const ms = udtMembers(udt);
  const l5k = [], dec = [];
  for (const m of ms) {
    if (m.type === 'BIT') { dec.push('<DataValueMember Name="' + m.name + '" DataType="BOOL" Value="0"/>'); continue; }
    const z = m.type === 'REAL' ? '0.00000000e+000' : '0';
    if (m.dim) {
      l5k.push('[' + Array(m.dim).fill(z).join(',') + ']');
      if (!m.hidden) dec.push('<ArrayMember Name="' + m.name + '" DataType="' + m.type + '" Dimensions="' + m.dim + '" Radix="' + (m.type === 'REAL' ? 'Float' : 'Decimal') + '">\n' + Array.from({ length: m.dim }, (_, i) => '<Element Index="[' + i + ']" Value="' + (m.type === 'REAL' ? '0.0' : '0') + '"/>').join('\n') + '\n</ArrayMember>');
    } else {
      l5k.push(z);
      if (!m.hidden) dec.push('<DataValueMember Name="' + m.name + '" DataType="' + m.type + '" Radix="' + (m.type === 'REAL' ? 'Float' : 'Decimal') + '" Value="' + (m.type === 'REAL' ? '0.0' : '0') + '"/>');
    }
  }
  return { l5k: '[' + l5k.join(',') + ']', dec: dec.join('\n') };
}
const udtOf = (src, name) => (new RegExp('<DataType Name="' + name + '"[^>]*>[\\s\\S]*?</DataType>').exec(src) || [null])[0];
function udtTag(name, type, usage, comments, zero) {
  const cm = comments.length ? '<Comments>\n' + comments.map(([op, c]) => '<Comment Operand="' + op + '">\n<![CDATA[' + c + ']]>\n</Comment>').join('\n') + '\n</Comments>\n' : '';
  return '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '"' + (usage ? ' Usage="' + usage + '"' : '') + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n' + cm + '<Data Format="L5K">\n<![CDATA[' + zero.l5k + ']]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="' + type + '">\n' + zero.dec + '\n</Structure>\n</Data>\n</Tag>';
}
const aoiTag = (name, type, l5k, enableOut) => '<Tag Name="' + name + '" TagType="Base" DataType="' + type + '" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n<Data Format="Decorated">\n<Structure DataType="' + type + '">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="' + enableOut + '"/>\n</Structure>\n</Data>\n</Tag>';

// ═══ 1. UDTs ════════════════════════════════════════════════════════════════
const udtStatus = udtOf(a, 'Epson_Robot_Status') || fail('1146 UDT Epson_Robot_Status');
const udtControl = udtOf(a, 'Epson_Robot_Control') || fail('1146 UDT Epson_Robot_Control');
must(!udtOf(x, 'Epson_Robot_Status'), 'V5.2 already has Epson_Robot_Status');
x = insertBefore(x, '<DataType Name="Fanuc_Robot_Control"', udtControl + '\n' + udtStatus + '\n', 'Fanuc_Robot_Control UDT');
const zStatus = udtZero(udtStatus), zControl = udtZero(udtControl);
// self-check against the 1146 tags: same member sequence in the decorated form
const shape = (dec) => dec.replace(/ Value="[^"]*"/g, '').replace(/\s+/g, '');
const exIn = (/<Structure DataType="Epson_Robot_Status">([\s\S]*?)<\/Structure>/.exec(tagXml(a, 'r01_PnP_IN')) || [])[1];
const exOut = (/<Structure DataType="Epson_Robot_Control">([\s\S]*?)<\/Structure>/.exec(tagXml(a, 'r01_PnP_OUT')) || [])[1];
must(shape(exIn) === shape(zStatus.dec), 'Epson_Robot_Status decorated form differs from 1146');
must(shape(exOut) === shape(zControl.dec), 'Epson_Robot_Control decorated form differs from 1146');
log.push('UDTs: Epson_Robot_Status, Epson_Robot_Control (from 1146)');

// ═══ 2. AOIs: split Epson_Robot_V2_0 ════════════════════════════════════════
const aoiEpson = (/<AddOnInstructionDefinition [^>]*Name="Epson_Robot_V2_0"[^>]*>[\s\S]*?<\/AddOnInstructionDefinition>/.exec(a) || [null])[0] || fail('1146 AOI Epson_Robot_V2_0');
const aoiFanucIn = (/<AddOnInstructionDefinition [^>]*Name="AOI_Fanuc_IN"[^>]*>[\s\S]*?<\/AddOnInstructionDefinition>/.exec(x) || [null])[0] || fail('V5.2 AOI_Fanuc_IN');
const enableParams = (/<Parameters>\s*([\s\S]*?<\/Parameter>\s*<Parameter Name="EnableOut"[\s\S]*?<\/Parameter>)/.exec(aoiFanucIn) || [])[1] || fail('EnableIn/EnableOut parameters');
const errMask = (/<LocalTag Name="ErrorCodeMask"[\s\S]*?<\/LocalTag>/.exec(aoiEpson) || [null])[0] || fail('ErrorCodeMask local tag');
const eRungs = rungList(getRoutine(aoiEpson, 'Logic') || fail('Epson Logic routine'));
must(eRungs.length === 52, 'Epson AOI rung count ' + eRungs.length);
const inRungs = eRungs.slice(0, 37).map((r) => r.replace(/ControllerModuleTag_Inputs/g, 'ModuleTag').replace(/RobotInputsTag/g, 'InputTag'));
const outRungs = eRungs.slice(37).map((r) => r.replace(/ControllerModuleTag_Outputs/g, 'ModuleTag').replace(/RobotOutputsTag/g, 'OutputTag'));
must(!/ModuleTag_|InputsTag|OutputsTag/.test(inRungs.join('') + outRungs.join('')), 'AOI rung rename incomplete');
function aoiDef(name, desc, note, params, locals, rungs) {
  return '<AddOnInstructionDefinition Name="' + name + '" Class="Standard" Revision="1.0" Vendor="Steven Douglas Corp." ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="' + NOW + '" CreatedBy="STEVENDOUGLAS\\jperry" EditedDate="' + NOW + '"\n EditedBy="STEVENDOUGLAS\\jperry" SoftwareRevision="v37.00">\n<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n<RevisionNote>\n<![CDATA[' + note + ']]>\n</RevisionNote>\n<Parameters>\n' + enableParams + '\n' + params + '\n</Parameters>\n' + (locals ? '<LocalTags>\n' + locals + '\n</LocalTags>\n' : '') + '<Routines>\n<Routine Name="Logic" Type="RLL">\n<RLLContent>\n' + renumber(rungs.join('\n')) + '\n</RLLContent>\n</Routine>\n</Routines>\n</AddOnInstructionDefinition>';
}
const aoiIn = aoiDef('AOI_Epson_IN', 'Epson Robot Input Mapping', '1.0 Split from Epson_Robot_V2_0 - robot outputs to PLC status',
  '<Parameter Name="ModuleTag" TagType="Base" DataType="AB:ETHERNET_MODULE_INT_64Bytes:I:0" Usage="InOut" Required="true" Visible="true" Constant="false"/>\n<Parameter Name="InputTag" TagType="Base" DataType="Epson_Robot_Status" Usage="InOut" Required="true" Visible="true" Constant="false"/>', errMask, inRungs);
const aoiOut = aoiDef('AOI_Epson_OUT', 'Epson Robot Output Mapping', '1.0 Split from Epson_Robot_V2_0 - PLC control to robot inputs',
  '<Parameter Name="ModuleTag" TagType="Base" DataType="AB:ETHERNET_MODULE_INT_64Bytes:O:0" Usage="InOut" Required="true" Visible="true" Constant="false"/>\n<Parameter Name="OutputTag" TagType="Base" DataType="Epson_Robot_Control" Usage="InOut" Required="true" Visible="true" Constant="false"/>', '', outRungs);
x = insertBefore(x, '<AddOnInstructionDefinition Name="AOI_FanucRecipe"', aoiIn + '\n' + aoiOut + '\n', 'AOI_FanucRecipe');
log.push('AOIs: AOI_Epson_IN (' + inRungs.length + ' rungs, ErrorCodeMask), AOI_Epson_OUT (' + outRungs.length + ' rungs)');

// ═══ 3. module, controller tags, mapping ════════════════════════════════════
let mod = (/<Module Name="r01_PnP"[^>]*>[\s\S]*?<\/Module>/.exec(a) || [null])[0] || fail('1146 module r01_PnP');
mod = mod.replace('Name="r01_PnP"', 'Name="rob03_EpsonPNP"').replace(/Address="[^"]*"/, 'Address="10.1.60.72"')
  .replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="{' + crypto.randomUUID().toUpperCase() + '}"')
  .replace(/(<OutputTag[^>]*>\s*<!\[CDATA\[)[\s\S]*?(\]\]>)/, (m, p, q) => p + '[[' + Array(32).fill('0').join(',') + ']]' + q);
must(/InputCxnPoint="100" OutputCxnPoint="150" OutputSize="64" InputSize="64"/.test(mod), 'module connection 100/150 64/64');
must(/ConfigSize="0"/.test(mod), 'module config size 0');
const fanucMod = (/<Module Name="rob02_FanucPNP"[^>]*>[\s\S]*?<\/Module>/.exec(x) || [null])[0] || fail('V5.2 module rob02_FanucPNP');
x = insertAfter(x, fanucMod, '\n' + mod, 'rob02_FanucPNP module');
log.push('module rob03_EpsonPNP: ETHERNET-MODULE at 10.1.60.72, in 100 / out 150, 32 INT each, config 1 size 0 (1146 form)');

const statusComments = [
  ['.USERIN[0].0', 'Program Done'], ['.USERIN[0].1', 'Invalid Program Command'], ['.USERIN[0].3', 'At Safe Home Position'],
  ['.USERIN[0].6', 'Gripper Closed'], ['.USERWORD[0]', 'Program Command Echo'],
  ['.INSIDEBOX1', 'Robot Inside Indexer Zone'], ['.INSIDEBOX2', 'Robot At Pick Position'], ['.INSIDEBOX3', 'Robot At Place Position'],
];
const controlComments = [
  ['.USEROUT[0].4', 'Machine In Manual Mode'], ['.USEROUT[0].5', 'In Auto Confirm'], ['.USEROUT[0].7', 'Program Stop'],
  ['.USERWORD[0]', 'Program Command 2 Pick 3 Place 100 Safe Home'],
];
const ctrlTags = [
  udtTag('rob03_EpsonPNPStatus', 'Epson_Robot_Status', '', [], zStatus),
  udtTag('rob03_EpsonPNPControl', 'Epson_Robot_Control', '', [], zControl),
  aoiTag('EpsonPNPInputs', 'AOI_Epson_IN', '[1,32767]', 0),
  aoiTag('EpsonPNPOutputs', 'AOI_Epson_OUT', '[1]', 0),
].join('\n');
const fanucStatusTag = tagXml(x, 'rob02_FanucPNPStatus') || fail('controller tag rob02_FanucPNPStatus');
x = insertAfter(x, fanucStatusTag, '\n' + ctrlTags, 'rob02_FanucPNPStatus tag');
log.push('controller tags: rob03_EpsonPNPStatus, rob03_EpsonPNPControl, EpsonPNPInputs, EpsonPNPOutputs');

editRoutine('MapInputs', 'R01_Logic', (rungs) => {
  const i = rungs.findIndex((r) => /AOI_Fanuc_IN\(FanucPNPInputs/.test(rungText(r)));
  must(i >= 0, 'MapInputs Fanuc PNP rung');
  rungs.splice(i + 1, 0, newRung('Map Ethernet IP Inputs Using CPS Instruction - S08 Epson Robot PNP', 'AOI_Epson_IN(EpsonPNPInputs,rob03_EpsonPNP:I,rob03_EpsonPNPStatus);'));
  return rungs;
});
editRoutine('MapOutputs', 'R01_Logic', (rungs) => {
  const i = rungs.findIndex((r) => /AOI_Fanuc_OUT\(FanucPNPOutputs/.test(rungText(r)));
  must(i >= 0, 'MapOutputs Fanuc PNP rung');
  rungs.splice(i + 1, 0, newRung('Map Ethernet IP Outputs Using CPS Instruction - S08 Epson Robot PNP', 'AOI_Epson_OUT(EpsonPNPOutputs,rob03_EpsonPNP:O,rob03_EpsonPNPControl);'));
  return rungs;
});
log.push('MapInputs / MapOutputs: AOI_Epson_IN / AOI_Epson_OUT rungs after the Fanuc PNP rungs');

// ═══ 4. program S08_EpsonRobotPNP ═══════════════════════════════════════════
let b = programBody('S08_FanucRobotPNP') || fail('program S08_FanucRobotPNP');
b = b.replace('Name="S08_FanucRobotPNP"', 'Name="S08_EpsonRobotPNP"');
// tags
b = replaceTag(b, 'i_RobotStatus', udtTag('i_RobotStatus', 'Epson_Robot_Status', 'Input', statusComments, zStatus));
b = replaceTag(b, 'q_RobotControl', udtTag('q_RobotControl', 'Epson_Robot_Control', 'Output', controlComments, zControl));
b = dropTagIn(b, 'i_RobotEDAIn');
b = dropTagIn(b, 'q_RobotEDAOut');
const alarms = stringValues(b, 'AlarmList');
must(alarms[12] === 'Waiting For Place Program To Complete', 'AlarmList[12] = ' + alarms[12]);
alarms[13] = 'Waiting For Robot Motors To Turn On';
const alarmTagNew = stringArrayTag('AlarmList', alarms, 15);
{ // self-check the STRING[] writer against the file's own form
  const norm = (s) => s.replace(/\s+/g, '');
  const ref = tagXml(b, 'AlarmList');
  must(norm(stringArrayTag('AlarmList', stringValues(b, 'AlarmList'), 15)) === norm(ref), 'stringArrayTag form differs from the template');
}
b = replaceTag(b, 'AlarmList', alarmTagNew);
b = b.replace(/(<Tag Name="HMI_Hold"[\s\S]*?<Comment Operand="\.1">\s*<!\[CDATA\[Stop Robot Program\]\]>\s*<\/Comment>)/, '$1\n<Comment Operand=".2">\n<![CDATA[Turn Robot Motors On]]>\n</Comment>\n<Comment Operand=".3">\n<![CDATA[Turn Robot Motors Off]]>\n</Comment>');
must(countOf(b, 'Turn Robot Motors On') === 1, 'HMI_Hold comments');

// signal map (Fanuc -> Epson), applied to every rung
const MAP = [
  [/i_RobotEDAIn\.R60/g, 'i_RobotStatus.UserWord[0]'],
  [/q_RobotEDAOut\.R50/g, 'q_RobotControl.UserWord[0]'],
  [/i_RobotStatus\.UserIn1\.(\d)/g, 'i_RobotStatus.UserIn[0].$1'],
  [/i_RobotStatus\.UserIn5\.6/g, 'i_RobotStatus.UserIn[0].6'],
  [/i_RobotStatus\.UserIn5\.7/g, 'i_RobotStatus.AutoMode'],
  [/i_RobotStatus\.Fault\b/g, 'i_RobotStatus.Error'],
  [/i_RobotStatus\.TP\b/g, 'i_RobotStatus.TeachMode'],
  [/q_RobotControl\.UserOut5\.(\d)/g, 'q_RobotControl.UserOut[0].$1'],
  [/q_RobotControl\.CycleStop\b/g, 'q_RobotControl.StopCmd'],
  [/q_RobotControl\.FaultReset\b/g, 'q_RobotControl.Reset'],
];
const mapText = (t) => MAP.reduce((s, [re, to]) => s.replace(re, to), t);
for (const rn of ['R01_Inputs', 'R02_StateTransitions', 'R03_StateLogic', 'R20_Alarms']) b = editBodyRoutine(b, rn, (rungs) => rungs.map((r) => setRungText(r, mapText(rungText(r)))));

// R01: position feedback from the robot's InsideBox zones
b = editBodyRoutine(b, 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  if (/OTE\(AtPick\)/.test(t)) return setRungComment(setRungText(r, 'XIC(i_RobotStatus.InsideBox2)OTE(AtPick);'), 'At Pick Position - InsideBox2 Set In The Robot');
  if (/OTE\(AtPlace\)/.test(t)) return setRungComment(setRungText(r, 'XIC(i_RobotStatus.InsideBox3)OTE(AtPlace);'), 'At Place Position - InsideBox3 Set In The Robot');
  return r;
}));
// R02: init 100 motors on -> 103 start program -> 106 trigger safe home -> 109 wait -> 124
b = editBodyRoutine(b, 'R02_StateTransitions', (rungs) => {
  const out = [];
  for (const r of rungs) {
    const t = rungText(r);
    if (/MOVE\(100,Control\.StateReg\)/.test(t)) {
      out.push(setRungComment(r, 'State 100: Initialize Turn Robot Motors On'));
      out.push(newRung('State 103: Initialize Start Robot Program', 'XIC(Status.State[100])XIC(i_RobotStatus.MotorOn)MOVE(103,Control.StateReg);'));
    } else if (/MOVE\(103,Control\.StateReg\)/.test(t)) {
      out.push(setRungComment(setRungText(r, 'XIC(Status.State[103])XIC(i_RobotStatus.Running)EQ(i_RobotStatus.UserWord[0],0)XIC(i_RobotStatus.UserIn[0].0)XIO(i_RobotStatus.UserIn[0].3)MOVE(106,Control.StateReg);'), 'State 106: Initialize Trigger Safe Home Program'));
    } else if (/MOVE\(106,Control\.StateReg\)/.test(t)) {
      out.push(setRungComment(setRungText(r, 'XIC(Status.State[106])EQ(i_RobotStatus.UserWord[0],100)XIO(i_RobotStatus.UserIn[0].0)MOVE(109,Control.StateReg);'), 'State 109: Wait For Safe Home Program Complete'));
    } else if (/MOVE\(124,Control\.StateReg\)/.test(t)) {
      out.push(setRungText(r, '[XIC(Status.State[103]) XIC(i_RobotStatus.Running) ,XIC(Status.State[109]) ]EQ(i_RobotStatus.UserWord[0],0)XIC(i_RobotStatus.UserIn[0].0)XIC(i_RobotStatus.UserIn[0].3)MOVE(124,Control.StateReg);'));
    } else out.push(r);
  }
  must(out.length === rungs.length + 1, 'R02 restructure');
  return out;
});
// R03: no Fanuc safety handshake; motors on/off; start/continue; safe home trigger in 106; command word
b = editBodyRoutine(b, 'R03_StateLogic', (rungs) => {
  const out = [];
  for (const r of rungs) {
    const t = rungText(r);
    if (/IMSTP/.test(t)) continue;
    if (/OTE\(q_ActuatorsSafe\)/.test(t)) { out.push(setRungComment(setRungText(r, 'XIO(i_RobotStatus.InsideBox1)OTE(q_ActuatorsSafe);'), 'Actuators Safe For Index - Robot Clear Of Indexer Zone - InsideBox1 Set In The Robot')); continue; }
    if (/OTE\(q_RobotControl\.Start\)/.test(t)) {
      out.push(newRung('Motors On To Robot', '[XIO(Status.State[1]) XIC(Status.State[100]) ,XIC(Status.State[1]) XIC(HMI_Hold.2) ]XIO(i_RobotStatus.MotorOn)OTE(q_RobotControl.SetMotorsOn);'));
      out.push(newRung('Motors Off To Robot', 'XIC(Status.State[1])XIC(HMI_Hold.3)XIC(i_RobotStatus.MotorOn)OTE(q_RobotControl.SetMotorsOff);'));
      out.push(setRungText(r, '[XIO(Status.State[1]) XIC(Status.State[103]) ,XIC(Status.State[1]) XIC(HMI_Hold.0) ]XIC(g_MachineBasic.Flash250msPD)[XIC(i_RobotStatus.Paused) OTE(q_RobotControl.ContinueCmd) ,XIO(i_RobotStatus.Paused) OTE(q_RobotControl.StartCmd) ];'));
      continue;
    }
    if (/MOVE\(100,q_RobotControl\.UserWord\[0\]\)/.test(t)) { out.push(setRungText(r, t.replace('XIC(Status.State[103])', 'XIC(Status.State[106])'))); continue; }
    if (/^NE\(i_RobotStatus\.UserWord\[0\],0\)MOVE\(0,q_RobotControl\.UserWord\[0\]\);$/.test(t)) { out.push(setRungComment(r, 'Clear Command Word')); continue; }
    out.push(r);
  }
  must(out.length === rungs.length + 1, 'R03 restructure ' + out.length + ' vs ' + rungs.length);
  return out;
});
// R20: states moved by the motors-on step; one more waiting-for alarm
b = editBodyRoutine(b, 'R20_Alarms', (rungs) => {
  const out = [];
  for (const r of rungs) {
    const t = rungText(r);
    if (/Alarm\[4\]\.Active\)|Alarm\[5\]\.Active\)/.test(t) && /Status\.State\[100\]/.test(t)) { out.push(setRungText(r, t.replace(/Status\.State\[100\]/g, 'Status.State[103]'))); continue; }
    if (/Alarm\[7\]\.Active\)/.test(t)) { out.push(setRungText(r, t.replace('Status.State[103]', 'Status.State[106]'))); continue; }
    if (/Alarm\[8\]\.Active\)/.test(t)) { out.push(setRungText(r, t.replace('Status.State[106]', 'Status.State[109]'))); continue; }
    if (/^ProgramAlarmHandler\(/.test(t)) out.push(newRung('Waiting For Robot Motors To Turn On', '[XIC(Status.State[100]) MOVE(5000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[13].Active) XIO(FaultReset) ][OTE(Alarm[13].Active) ,ONS(ONS.29) CONCAT(g_StationList[StaNum],AlarmList[13],Alarm[13].Message) ];'));
    out.push(r);
  }
  must(out.length === rungs.length + 1, 'R20 restructure');
  return out;
});
// nothing Fanuc left
for (const bad of ['UserIn1', 'UserIn5', 'UserOut5', 'RobotEDA', 'CURPOS', 'IMSTP', 'SFSPD', 'Fanuc', 'R50', 'R60', 'RemoteStart']) must(countOf(b, bad) === 0, 'leftover ' + bad);
must(countOf(b, 'ONS.29)') === 1, 'ONS.29 used once');
const fanucBody = programBody('S08_FanucRobotPNP');
x = insertAfter(x, fanucBody, '\n' + b, 'S08_FanucRobotPNP program');
x = insertAfter(x, '<ScheduledProgram Name="S08_FanucRobotPNP"/>', '\n<ScheduledProgram Name="S08_EpsonRobotPNP"/>', 'ScheduledProgram S08');
log.push('program S08_EpsonRobotPNP: ' + ['R01_Inputs', 'R02_StateTransitions', 'R03_StateLogic', 'R20_Alarms'].map((rn) => rn + ' ' + rungList(getRoutine(b, rn)).length).join(', '));

// ═══ 5. polls, roll-up, EIP, connections, defects ═══════════════════════════
editRoutine('Supervisor', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  for (const q of ['q_AutoMode', 'q_AutoStopped', 'q_StartOK']) if (t.includes('XIC(\\S08_FanucRobotPNP.' + q + ')')) return setRungText(r, t.replace('XIC(\\S08_FanucRobotPNP.' + q + ')', 'XIC(\\S08_FanucRobotPNP.' + q + ')XIC(\\S08_EpsonRobotPNP.' + q + ')'));
  return r;
}));
must(countOf(programBody('Supervisor'), '\\S08_EpsonRobotPNP.') === 3, 'Supervisor polls');
editRoutine('Alarms', 'R01_Logic', (rungs) => rungs.map((r) => {
  const t = rungText(r);
  for (const q of ['q_AlarmActive', 'q_WarningActive']) if (t.includes('XIO(\\S08_FanucRobotPNP.' + q + ')')) return setRungText(r, t.replace('XIO(\\S08_FanucRobotPNP.' + q + ')', 'XIO(\\S08_FanucRobotPNP.' + q + ')XIO(\\S08_EpsonRobotPNP.' + q + ')'));
  return r;
}));
must(countOf(programBody('Alarms'), '\\S08_EpsonRobotPNP.') === 2, 'Alarms roll-up');
// EIP-loss alarms (rob02 was missing in V5.2) and the node count
{
  let s = programBody('Supervisor');
  const eip = tagXml(s, 'rob01_FlexFeederEIP') || fail('Supervisor tag rob01_FlexFeederEIP');
  s = insertAfter(s, eip, '\n' + eip.replace(/rob01_FlexFeederEIP/g, 'rob02_FanucPNPEIP') + '\n' + eip.replace(/rob01_FlexFeederEIP/g, 'rob03_EpsonPNPEIP'), 'EIP tag');
  s = editBodyRoutine(s, 'R20_Alarms', (rungs) => {
    const i = rungs.findIndex((r) => /^ProgramAlarmHandler\(/.test(rungText(r)));
    must(i >= 0 && /EQ\(EIPStatusCount,10\)/.test(rungText(rungs[i - 1])), 'Supervisor R20 shape');
    rungs.splice(i, 0,
      newRung('Loss Of S08 Fanuc Robot EIP', '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,11) AOI_EIPStatus(rob02_FanucPNPEIP,rob02_FanucPNP) XIO(rob02_FanucPNPEIP.ComOK) ,XIC(Alarm[12].Active) XIO(q_FaultReset) ]OTE(Alarm[12].Active);'),
      newRung('Loss Of S08 Epson Robot EIP', '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,12) AOI_EIPStatus(rob03_EpsonPNPEIP,rob03_EpsonPNP) XIO(rob03_EpsonPNPEIP.ComOK) ,XIC(Alarm[13].Active) XIO(q_FaultReset) ]OTE(Alarm[13].Active);'));
    return rungs;
  });
  s = editBodyRoutine(s, 'R15_EIPMonitor', (rungs) => rungs.map((r) => /GE\(EIPStatusCount,11\)/.test(rungText(r)) ? setRungText(r, rungText(r).replace('GE(EIPStatusCount,11)', 'GE(EIPStatusCount,13)')) : r));
  must(countOf(s, 'GE(EIPStatusCount,13)') === 1, 'EIP node count');
  replaceProgram('Supervisor', s);
}
log.push('Supervisor: polls, EIP-loss alarms for rob02_FanucPNP (12) and rob03_EpsonPNP (13), node count 11 -> 13; Alarms roll-up');
// parameter connections: S08 Fanuc -> rob02 (V5.2 defect), S08 Epson -> rob03
for (const [from, to] of [['rob01_FlexFeederControl"', 'rob02_FanucPNPControl"'], ['rob01_FlexFeederEDAOut"', 'rob02_FanucPNPEDAOut"']]) {
  const pc = '<ParameterConnection EndPoint1="\\S08_FanucRobotPNP.' + (from.includes('Control') ? 'q_RobotControl' : 'q_RobotEDAOut') + '" EndPoint2="' + from;
  must(countOf(x, pc) === 1, 'connection ' + pc);
  x = x.replace(pc, pc.replace(from, to));
}
for (const [from, to, ep] of [['rob01_FlexFeederEDAIn', 'rob02_FanucPNPEDAIn', 'i_RobotEDAIn'], ['rob01_FlexFeederStatus', 'rob02_FanucPNPStatus', 'i_RobotStatus']]) {
  const pc = '<ParameterConnection EndPoint1="' + from + '" EndPoint2="\\S08_FanucRobotPNP.' + ep + '"';
  must(countOf(x, pc) === 1, 'connection ' + pc);
  x = x.replace(pc, pc.replace(from, to));
}
const pcFanuc = (/<ParameterConnection EndPoint1="\\S08_FanucRobotPNP\.q_RobotControl"[^>]*>/.exec(x) || [null])[0] || fail('S08 connection');
x = insertAfter(x, pcFanuc, '\n<ParameterConnection EndPoint1="\\S08_EpsonRobotPNP.q_RobotControl" EndPoint2="rob03_EpsonPNPControl"/>', 'S08 connection');
const pcIn = (/<ParameterConnection EndPoint1="rob02_FanucPNPStatus" EndPoint2="\\S08_FanucRobotPNP\.i_RobotStatus"[^>]*>/.exec(x) || [null])[0] || fail('S08 status connection');
x = insertAfter(x, pcIn, '\n<ParameterConnection EndPoint1="rob03_EpsonPNPStatus" EndPoint2="\\S08_EpsonRobotPNP.i_RobotStatus"/>', 'S08 status connection');
must(countOf(x, '\\S08_FanucRobotPNP.') >= 4 && countOf(x, 'EndPoint2="rob01_FlexFeederControl"') === 1, 'S10 keeps rob01');
log.push('connections: S08 Fanuc re-pointed to rob02_FanucPNP tags; S08 Epson to rob03_EpsonPNPStatus / Control');

// ═══ write ══════════════════════════════════════════════════════════════════
must(fs.readFileSync(SRC, 'utf8') === original, 'the source changed on disk during the run');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, x);
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'applyStateEngine.cjs'), OUT], { stdio: 'inherit' }); // current State_Engine_128Max (PLAYBOOK 7d)
x = fs.readFileSync(OUT, 'utf8');
console.log('SoftwareStandardization V5.3 - S08_EpsonRobotPNP\n');
for (const l of log) console.log('  ' + l);
console.log('\n  programs: ' + [...x.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  scheduled: ' + [...x.matchAll(/<ScheduledProgram Name="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  AOIs: ' + [...x.matchAll(/<AddOnInstructionDefinition [^>]*Name="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  modules: ' + [...x.matchAll(/<Module\b[^>]*\bName="([^"]+)"[^>]*\bCatalogNumber="([^"]+)"/g)].map((m) => m[1] + ' ' + m[2]).join(', '));
console.log('  size: ' + original.length + ' -> ' + x.length + ' chars');
console.log('  written ' + OUT);
