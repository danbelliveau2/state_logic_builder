#!/usr/bin/env node
'use strict';
/**
 * revise1163EA.cjs — 1163 v0.4 (Jason, 2026-10-30): applied to his Studio export of v0.3.1 (vb01 54/52 SINT, mm01 312/124 DINT).
 *
 *   node scripts/revise1163EA.cjs [--src <L5X>] [--out <L5X>]
 *
 *   1. MapInputs maps whole blocks with CPS only: the unpack rung (COP of dancer words and micrometer values) is gone.
 *   2. Dancer distances: UDT Banner_Q4X_PDI + AOI_BannerQ4X_PD (ST, from the Schneider Banner_Q4X_PD_v4 snippet) decode the
 *      two IO-Link process-data bytes per port in MapInputs; the Dereeler reads i_DancerA/B of the UDT type (Measurement_Value mm).
 *   3. Micrometer values are input parameters: i_MicrometerX/Y connect to mm01_L2S01Micrometer_IN.Data[25..28] (OUT1..OUT4,
 *      CB-EP100 monitor data bytes 100-115); MicrometerCountsPerMm 100 (display unit code 1 = 0.01 mm).
 *   4. Buffer tags match the module sizes (SINT 54/52, DINT 312/124); vb01_DancerDistance and mm01_L2S01MicrometerValue removed.
 *   5. VB1 byte map from Jason: DXPC x4 [0-3], LAB1 [4-47] (dancers at LAB1 bytes 2/3, 4/5, 6/7, 8/9 = 6-13), AXA [48-51],
 *      DMPF [52], pad [53]; outputs LAB1 [0-43], DYPE [44-45], DMPF [46], valves [47-50], pad [51].
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'C:/1163 AI Code/_1163_Haemonetics.L5X');
const OUT = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const log = [];
let x = fs.readFileSync(SRC, 'utf8');
must(/Name="vb01_MainAssembly"[\s\S]*?PrimCxnInputSize="54"/.test(x) && /DINT_312Bytes:I:0/.test(x), 'source is not the export with the 54/52 and 312/124 module sizes');

// ── helpers ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
function programBody(name) { const m = progRe(name).exec(x); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = progRe(name).exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) { const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)'); must(re.test(body), 'routine not found: ' + rn); return body.replace(re, (m, p, inner, q) => p + '\n' + renumber(rungs.join('\n')) + '\n' + q); }
function editRoutine(prog, rn, fn) { let b = programBody(prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); replaceProgram(prog, b); }
function tagXml(body, name) { return (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0]; }
function replaceTagIn(body, name, xml) { const old = tagXml(body, name); must(old, 'tag not found: ' + name); return body.replace(old, xml); }
function dropTagIn(body, name) { const old = tagXml(body, name); must(old, 'tag not found: ' + name); return body.replace(old + '\n', '').replace(old, ''); }
const insertBefore = (hay, marker, text, what) => { const i = hay.indexOf(marker); must(i >= 0, 'marker not found: ' + what); return hay.slice(0, i) + text + hay.slice(i); };
const countOf = (hay, s) => hay.split(s).length - 1;
const zeros = (n) => Array(n).fill('0').join(',');
const elems = (n, v) => Array.from({ length: n }, (_, i) => '<Element Index="[' + i + ']" Value="' + v + '"/>').join('\n');

// ═══ 1. UDT Banner_Q4X_PDI + AOI_BannerQ4X_PD ═════════════════════════════
const UDT = 'Banner_Q4X_PDI', AOI = 'AOI_BannerQ4X_PD';
must(!x.includes('Name="' + UDT + '"') && !x.includes('Name="' + AOI + '"'), 'UDT / AOI already present');
const udtXml = '<DataType Name="' + UDT + '" Family="NoFamily" Class="User">\n<Description>\n<![CDATA[Banner Q4X IO-Link Process Data]]>\n</Description>\n<Members>\n' +
  '<Member Name="Channel_1_Output_State" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[0 = Inactive, 1 = Active]]>\n</Description>\n</Member>\n' +
  '<Member Name="Channel_2_Output_State" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[0 = Inactive, 1 = Active]]>\n</Description>\n</Member>\n' +
  '<Member Name="Sensor_Stability" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[0 = No Target Or Marginal, 1 = Stable]]>\n</Description>\n</Member>\n' +
  '<Member Name="Measurement_Value" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[Distance From Sensor Face mm]]>\n</Description>\n</Member>\n' +
  '</Members>\n</DataType>\n';
x = insertBefore(x, '<DataType Name="ConsecFails"', udtXml, 'DataType ConsecFails');
const udtL5k = '[0,0,0,0.00000000e+000]';
const udtDec = '<Structure DataType="' + UDT + '">\n<DataValueMember Name="Channel_1_Output_State" DataType="SINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Channel_2_Output_State" DataType="SINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Sensor_Stability" DataType="SINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Measurement_Value" DataType="REAL" Radix="Float" Value="0.0"/>\n</Structure>';

const dd = (l5k, decValue) => '<DefaultData Format="L5K">\n<![CDATA[' + l5k + ']]>\n</DefaultData>\n<DefaultData Format="Decorated">\n' + decValue + '\n</DefaultData>';
const param = (name, type, usage, radix, desc, l5k, decValue) => '<Parameter Name="' + name + '" TagType="Base" DataType="' + type + '" Usage="' + usage + '" Radix="' + radix + '" Required="true" Visible="true" ExternalAccess="Read/Write">\n<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n' + dd(l5k, decValue) + '\n</Parameter>';
const local = (name, type, radix, desc, l5k, decValue) => '<LocalTag Name="' + name + '" DataType="' + type + '" Radix="' + radix + '" ExternalAccess="None">\n<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n' + dd(l5k, decValue) + '\n</LocalTag>';
const dv = (type, radix, v) => '<DataValue DataType="' + type + '" Radix="' + radix + '" Value="' + v + '"/>';
const ST = [
  '(* Byte assignment, with optional swap *)', 'IF Byte_Swap THEN', '    Data_Byte_1 := SINT0;', '    Data_Byte_0 := SINT1;', 'ELSE', '    Data_Byte_0 := SINT0;', '    Data_Byte_1 := SINT1;', 'END_IF;', '',
  '(* Unsigned copies of the two bytes *)', 'Byte0 := Data_Byte_0;', 'IF Byte0 < 0 THEN', '    Byte0 := Byte0 + 256;', 'END_IF;', 'Byte1 := Data_Byte_1;', 'IF Byte1 < 0 THEN', '    Byte1 := Byte1 + 256;', 'END_IF;', '',
  '(* Single-bit status flags from Data_Byte_1 *)', 'PROCESS_DATA.Channel_1_Output_State := Byte1 AND 16#01;', 'PROCESS_DATA.Channel_2_Output_State := (Byte1 AND 16#02) / 2;', 'PROCESS_DATA.Sensor_Stability := (Byte1 AND 16#04) / 4;', '',
  '(* 13-bit raw measurement: Data_Byte_1 bits 7:3 are bits 4:0, Data_Byte_0 is bits 12:5 *)', 'Raw_Measurement := (Byte1 AND 16#F8) / 8 + Byte0 * 32;', '',
  '(* Scale to mm, the sensor reports tenths of a mm *)', 'PROCESS_DATA.Measurement_Value := Raw_Measurement / 10.0;',
];
const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
const aoiXml = '<AddOnInstructionDefinition Name="' + AOI + '" Class="Standard" Revision="1.0" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="' + NOW + '" CreatedBy="SDC" EditedDate="' + NOW + '" EditedBy="SDC" SoftwareRevision="v38.00">\n' +
  '<Description>\n<![CDATA[Banner Q4X IO-Link process data decode]]>\n</Description>\n<Parameters>\n' +
  '<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">\n<Description>\n<![CDATA[Enable Input - System Defined Parameter]]>\n</Description>\n</Parameter>\n' +
  '<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">\n<Description>\n<![CDATA[Enable Output - System Defined Parameter]]>\n</Description>\n</Parameter>\n' +
  param('SINT0', 'SINT', 'Input', 'Decimal', 'Raw IO-Link process data byte 0', '0', dv('SINT', 'Decimal', '0')) + '\n' +
  param('SINT1', 'SINT', 'Input', 'Decimal', 'Raw IO-Link process data byte 1', '0', dv('SINT', 'Decimal', '0')) + '\n' +
  param('Byte_Swap', 'BOOL', 'Input', 'Decimal', 'TRUE = swap SINT0 and SINT1 before decoding', '0', dv('BOOL', 'Decimal', '0')) + '\n' +
  '<Parameter Name="PROCESS_DATA" TagType="Base" DataType="' + UDT + '" Usage="InOut" Required="true" Visible="true" Constant="false">\n<Description>\n<![CDATA[Decoded process data]]>\n</Description>\n</Parameter>\n' +
  '</Parameters>\n<LocalTags>\n' +
  local('Data_Byte_0', 'SINT', 'Decimal', 'Process data byte 0', '0', dv('SINT', 'Decimal', '0')) + '\n' + local('Data_Byte_1', 'SINT', 'Decimal', 'Process data byte 1', '0', dv('SINT', 'Decimal', '0')) + '\n' +
  local('Raw_Measurement', 'DINT', 'Decimal', 'Raw 13-bit measurement', '0', dv('DINT', 'Decimal', '0')) + '\n' + local('Byte0', 'DINT', 'Decimal', 'Unsigned byte 0', '0', dv('DINT', 'Decimal', '0')) + '\n' + local('Byte1', 'DINT', 'Decimal', 'Unsigned byte 1', '0', dv('DINT', 'Decimal', '0')) + '\n' +
  '</LocalTags>\n<Routines>\n<Routine Name="Logic" Type="ST">\n<STContent>\n' + ST.map((l, i) => '<Line Number="' + i + '">\n<![CDATA[' + l + ']]>\n</Line>').join('\n') + '\n</STContent>\n</Routine>\n</Routines>\n</AddOnInstructionDefinition>\n';
x = insertBefore(x, '<AddOnInstructionDefinition Name="AOI_Debounce"', aoiXml, 'AOI_Debounce');
log.push('UDT ' + UDT + ', AOI ' + AOI + ' (ST, ' + ST.length + ' lines)');

// ═══ 2. controller tags ═══════════════════════════════════════════════════
const ctrlTag = (name, type, extra, body) => '<Tag Name="' + name + '" Class="Standard" TagType="Base" DataType="' + type + '"' + extra + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n' + body + '\n</Tag>';
const dataBlock = (l5k, dec) => '<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n<Data Format="Decorated">\n' + dec + '\n</Data>';
const bufferTag = (name, elemType, nBytes, nElems, dir) => ctrlTag(name, 'AB:ETHERNET_MODULE_' + elemType + '_' + nBytes + 'Bytes:' + dir + ':0', '', dataBlock('[[' + zeros(nElems) + ']]', '<Structure DataType="AB:ETHERNET_MODULE_' + elemType + '_' + nBytes + 'Bytes:' + dir + ':0">\n<ArrayMember Name="Data" DataType="' + elemType + '" Dimensions="' + nElems + '" Radix="Decimal">\n' + elems(nElems, '0') + '\n</ArrayMember>\n</Structure>'));
const VB = 'vb01_MainAssembly', MM = 'mm01_L2S01Micrometer';
x = replaceTagIn(x, VB + '_IN', bufferTag(VB + '_IN', 'SINT', 54, 54, 'I'));
x = replaceTagIn(x, VB + '_OUT', bufferTag(VB + '_OUT', 'SINT', 52, 52, 'O'));
x = replaceTagIn(x, MM + '_IN', bufferTag(MM + '_IN', 'DINT', 312, 78, 'I'));
x = replaceTagIn(x, MM + '_OUT', bufferTag(MM + '_OUT', 'DINT', 124, 31, 'O'));
x = dropTagIn(x, 'vb01_DancerDistance');
x = dropTagIn(x, 'mm01_L2S01MicrometerValue');
const DANCERS = [['UpstreamA', 6], ['UpstreamB', 8], ['DownstreamA', 10], ['DownstreamB', 12]];   // first byte of each IO-Link port's pair
const dancerTags = DANCERS.map(([d]) => ctrlTag('vb01_Dancer' + d, UDT, '', dataBlock(udtL5k, udtDec)) + '\n' +
  ctrlTag('Dancer' + d + 'Inputs', AOI, '', dataBlock('[1,0,0,0,0,0,0,0]', '<Structure DataType="' + AOI + '">\n<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>\n<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>\n<DataValueMember Name="SINT0" DataType="SINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="SINT1" DataType="SINT" Radix="Decimal" Value="0"/>\n<DataValueMember Name="Byte_Swap" DataType="BOOL" Value="0"/>\n</Structure>'))).join('\n');
{ const m = /<\/Tags>\s*<Programs>/.exec(x) || fail('controller tags end'); x = x.slice(0, m.index) + dancerTags + '\n' + x.slice(m.index); }
log.push('buffers SINT 54/52, DINT 312/124; 4 dancer UDT tags + 4 AOI tags; DancerDistance / MicrometerValue tags removed');

// ═══ 3. MapInputs: CPS whole blocks, AOI per dancer ═══════════════════════
editRoutine('MapInputs', 'R01_Logic', (r) => {
  must(r.length === 3 && /^\[COP\(/.test(rungText(r[2])), 'MapInputs R01 rung 2 is the unpack rung');
  const aoi = DANCERS.map(([d, b]) => AOI + '(Dancer' + d + 'Inputs,' + VB + '_IN.Data[' + b + '],' + VB + '_IN.Data[' + (b + 1) + '],0,vb01_Dancer' + d + ')').join(' ,');
  return [r[0], r[1], newRung('Map Ethernet IP Inputs Using CPS Instruction - L2S01 Dancer Distances (IO-Link)', '[' + aoi + ' ];')];
});
log.push('MapInputs rung 2: four ' + AOI + ' calls');

// ═══ 4. Dereeler programs: i_DancerA/B of the UDT type, mm from the AOI ═══
for (const side of ['Upstream', 'Downstream']) {
  const p = 'L2_S01_Dereeler' + side;
  let b = programBody(p) || fail('no program ' + p);
  for (const k of ['A', 'B']) {
    b = replaceTagIn(b, 'i_Dancer' + k, '<Tag Name="i_Dancer' + k + '" TagType="Base" DataType="' + UDT + '" Usage="Input" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Description>\n<![CDATA[Dancer ' + k + ' Distance Sensor]]>\n</Description>\n' + dataBlock(udtL5k, udtDec) + '\n</Tag>');
  }
  const old = 'DIV(i_DancerA,10.0,DancerADistance)DIV(i_DancerB,10.0,DancerBDistance);';
  must(countOf(b, old) === 1, p + ' dancer rung');
  b = b.replace(old, 'MOVE(i_DancerA.Measurement_Value,DancerADistance)MOVE(i_DancerB.Measurement_Value,DancerBDistance);');
  b = b.replace('<![CDATA[Dancer arm distance, larger as the arm drops]]>', '<![CDATA[Dancer arm distance from the IO-Link sensors, larger as the arm drops]]>');
  replaceProgram(p, b);
}
// TubeFeed: micrometer scale = display unit code 1 (0.01 mm) -> 100 counts per mm
for (const side of ['Upstream', 'Downstream']) {
  const p = 'L2_S01_TubeFeed' + side;
  let b = programBody(p) || fail('no program ' + p);
  const t = tagXml(b, 'MicrometerCountsPerMm'); must(t, p + ' MicrometerCountsPerMm');
  const t2 = t.replace(/<!\[CDATA\[1\.00000000e\+005\]\]>/, '<![CDATA[1.00000000e+002]]>').replace(/Value="100000\.0"/, 'Value="100.0"');
  must(t2 !== t && !/100000/.test(t2), p + ' MicrometerCountsPerMm seed');
  replaceProgram(p, b.replace(t, t2));
}
log.push('Dereeler i_DancerA/B -> ' + UDT + '; TubeFeed MicrometerCountsPerMm 100');

// ═══ 5. parameter connections ═════════════════════════════════════════════
{
  const m = /<ParameterConnections>([\s\S]*?)<\/ParameterConnections>/.exec(x) || fail('ParameterConnections');
  let pcs = [...m[1].matchAll(/<ParameterConnection [^>]*\/>/g)].map((q) => q[0]);
  const before = pcs.length;
  pcs = pcs.filter((p) => !/vb01_DancerDistance\[|mm01_L2S01MicrometerValue\[/.test(p));
  must(before - pcs.length === 8, 'eight dancer / micrometer connections removed');
  // VB1 inputs: DXPC units are bytes 0-2 (were 25-27); valve coils are bytes 47-49 (were 0-2)
  pcs = pcs.map((p) => p.replace(/vb01_MainAssembly_IN\.Data\[(25|26|27)\]/, (s, n) => 'vb01_MainAssembly_IN.Data[' + (Number(n) - 25) + ']').replace(/vb01_MainAssembly_OUT\.Data\[([012])\]/, (s, n) => 'vb01_MainAssembly_OUT.Data[' + (Number(n) + 47) + ']'));
  must(!/vb01_MainAssembly_IN\.Data\[2[5-7]\]/.test(pcs.join()) && pcs.filter((p) => /_OUT\.Data\[4[789]\]/.test(p)).length === 20, 'VB1 byte map re-pointed');
  const add = [
    ['vb01_DancerUpstreamA', '\\L2_S01_DereelerUpstream.i_DancerA'], ['vb01_DancerUpstreamB', '\\L2_S01_DereelerUpstream.i_DancerB'],
    ['vb01_DancerDownstreamA', '\\L2_S01_DereelerDownstream.i_DancerA'], ['vb01_DancerDownstreamB', '\\L2_S01_DereelerDownstream.i_DancerB'],
    [MM + '_IN.Data[25]', '\\L2_S01_TubeFeedUpstream.i_MicrometerX'], [MM + '_IN.Data[26]', '\\L2_S01_TubeFeedUpstream.i_MicrometerY'],
    [MM + '_IN.Data[27]', '\\L2_S01_TubeFeedDownstream.i_MicrometerX'], [MM + '_IN.Data[28]', '\\L2_S01_TubeFeedDownstream.i_MicrometerY'],
  ].map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>');
  x = x.slice(0, m.index) + '<ParameterConnections>\n' + pcs.concat(add).join('\n') + '\n</ParameterConnections>' + x.slice(m.index + m[0].length);
  log.push('parameter connections: ' + (pcs.length + add.length) + ' (8 replaced, VB1 bytes re-pointed)');
}

// ═══ 6. write ═════════════════════════════════════════════════════════════
must(!/vb01_DancerDistance|mm01_L2S01MicrometerValue/.test(x), 'old buffer names still referenced');
const d = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + d.toDateString().replace(/ \d{4}$/, '') + ' ' + d.toTimeString().slice(0, 8) + ' ' + d.getFullYear() + '"');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, x);
console.log('wrote ' + OUT + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);
