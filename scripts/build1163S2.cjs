#!/usr/bin/env node
'use strict';
/**
 * build1163S2.cjs — 1163 v0.11: L2S02 Clear Tube Load on the v0.10.1 stamp.
 *
 *   node scripts/build1163S2.cjs [--dry]
 *
 *   L2S02 is L2S01 on its own devices (Jason, 2026-11-11): the four L2_S01 programs are cloned to L2_S02 (StaNum 2, tube length 13.5 in),
 *   the hardware is cloned from its L2S01 twin by the Master Electrical IP tab (sd04 / sd05 + a04 / a05, fd05-fd08, mm02, vb02 50 / 50,
 *   HSC2 in slot 7), and Supervisor, Alarms, MapInputs / MapOutputs and the schedule take the new programs. Every other program stays as stamped.
 *   Then gates, deliver, stamp. Cover note: scripts/coverNote1163S2.cjs.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, newRung, programBody, getRoutine, putRungs, tagXml, replaceTagIn, insertBefore, countOf, rep1, guid, moduleXml, l5kStr, strElemDec, alarmElemL5K, alarmElemDec } = H;

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H_ = D + '/_history';
const BASE = H_ + '/1163_Haemonetics_v0.10.1_2026-11-06.L5X';
const M = '1163_Haemonetics', VERSION = '0.11';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const STA = 2, PREFIX = 'L2S02 Tube Load: ', SUBNET = '10.68.167.';
const TUBE_MM = 342.9;                                   // 13.5 in clear tube (Jason, 2026-11-11); L2S01 = 29 in blue tube, 736.6
const SIDES = ['Upstream', 'Downstream'];
const SRC = ['L2_S01_TubeFeedUpstream', 'L2_S01_DereelerUpstream', 'L2_S01_TubeFeedDownstream', 'L2_S01_DereelerDownstream'];
const NEW = SRC.map((n) => n.replace('L2_S01_', 'L2_S02_'));
const log = [];
const base = fs.readFileSync(BASE, 'utf8');
let x = base;
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); const m = H.progRe(prog).exec(x); x = x.slice(0, m.index) + b + x.slice(m.index + m[0].length); };
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const f32 = (n) => Math.fround(n).toExponential(8).replace(/e([+-])(\d+)$/, (m, s, d) => 'e' + s + d.padStart(3, '0'));

// ═══ hardware map: L2S01 device -> its L2S02 twin (Master Electrical IP tab 2026-11-11, BOM I/O ASSIGNMENT, VB2 layout 2026-11-02) ═══
const DRIVES = [['sd02_L2S01FeedUpstream', 'sd04_L2S02FeedUpstream', '23', 'a02_L2S01FeedUpstream', 'a04_L2S02FeedUpstream', 'Loss Of L2S02 Upstream Feed Servo EIP'],
  ['sd03_L2S01FeedDownstream', 'sd05_L2S02FeedDownstream', '24', 'a03_L2S01FeedDownstream', 'a05_L2S02FeedDownstream', 'Loss Of L2S02 Downstream Feed Servo EIP']];
const VFDS = [['fd01_L2S01PayoutUpstreamA', 'fd05_L2S02PayoutUpstreamA', '54', 'Loss Of L2S02 Upstream Payout A VFD EIP'], ['fd02_L2S01PayoutUpstreamB', 'fd06_L2S02PayoutUpstreamB', '55', 'Loss Of L2S02 Upstream Payout B VFD EIP'],
  ['fd03_L2S01PayoutDownstreamA', 'fd07_L2S02PayoutDownstreamA', '56', 'Loss Of L2S02 Downstream Payout A VFD EIP'], ['fd04_L2S01PayoutDownstreamB', 'fd08_L2S02PayoutDownstreamB', '57', 'Loss Of L2S02 Downstream Payout B VFD EIP']];
const MM = ['mm01_L2S01Micrometer', 'mm02_L2S02Micrometer', '81', 'Loss Of L2S02 Micrometer EIP'];
// VB2: EX600-SEN7 with 5 DXPC, LAB1, DYPE, 14 valve stations - in 50 / out 50 (Jason, 2026-11-11).
// In: [0-4] DXPC IN1-5, [5-48] LAB1. Out: [0-43] LAB1, [44-45] DYPE, [46-49] coils. VB1 has 4 DXPC and a DMPF byte ahead of the coils.
const VB1 = 'vb01_MainAssembly', VB = 'vb02_MainAssembly', VB_IP = '91', VB_IN = 50, VB_OUT = 50, VB_EIP = 'Loss Of VB2 Valve Bank EIP';
const HSC_FROM = 'Local:6:', HSC_TO = 'Local:7:';        // HSC2, slot 7 (BOM "PLC MOD 7 CH0 / CH1"); already in the hardware tree

// ═══ 1. programs: the L2S01 four, re-pointed ═════════════════════════════════
fs.mkdirSync(PROGDIR, { recursive: true });
{
  const cloned = [];
  SRC.forEach((src, i) => {
    let b = programBody(x, src) || fail(src);
    must(!programBody(x, NEW[i]), 'program already present: ' + NEW[i]);
    b = b.split('L2_S01_').join('L2_S02_').split('L2S01 Tube Load: ').join(PREFIX);
    b = rep1(b, 'MOVE(1,StaNum);', 'MOVE(' + STA + ',StaNum);', NEW[i] + ' StaNum');
    if (/TubeFeed/.test(src)) {
      const t = tagXml(b, 'HMI_TubeLength') || fail('HMI_TubeLength');
      must(t.includes('<![CDATA[7.36599976e+002]]>') && t.includes('Value="736.6"'), 'HMI_TubeLength seed 736.6');
      b = b.replace(t, t.replace('7.36599976e+002', f32(TUBE_MM)).replace('Value="736.6"', 'Value="' + TUBE_MM + '"'));
    }
    must(!/L2S01|L2_S01/.test(b) && !b.includes('736.6'), NEW[i] + ' carries no L2S01 name or length');
    must(countOf(b, PREFIX) === countOf(programBody(x, src), 'L2S01 Tube Load: '), NEW[i] + ' alarm prefixes');
    cloned.push(b);
    fs.writeFileSync(path.join(PROGDIR, NEW[i] + '.xml'), b);
    log.push('program ' + NEW[i] + ': ' + rungList(b).length + ' rungs, ' + (b.match(/<Tag Name=/g) || []).length + ' tags');
  });
  const last = programBody(x, SRC[3]);
  x = x.replace(last, last + '\n' + cloned.join('\n'));
}

// ═══ 2. modules + controller tags ════════════════════════════════════════════
{
  const mods = [];
  const cloneMod = (from, to, ip) => { const m = moduleXml(x, from); must(countOf(m, from) === 1, from + ' named once in its module'); return m.replace('Name="' + from + '"', 'Name="' + to + '"').replace(/Address="[^"]*" Type="Ethernet"/, 'Address="' + SUBNET + ip + '" Type="Ethernet"').replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="' + guid() + '"'); };
  const cloneTag = (from, to) => { const t = tagXml(x, from) || fail('tag ' + from); return t.replace('<Tag Name="' + from + '"', '<Tag Name="' + to + '"'); };
  const after = (name, text) => { const t = tagXml(x, name) || fail('tag ' + name); x = x.replace(t, t + '\n' + text); };

  // feed drives + axes (2198-C1004-ERS single phase, TLP-A070-040, 200:15, belt 50.927 - the L2S01 axes as Studio returned them)
  const maxAxisId = Math.max(...[...x.matchAll(/AxisID="(\d+)"/g)].map((m) => +m[1]));
  const axes = DRIVES.map(([sdFrom, sdTo, ip, aFrom, aTo], i) => {
    must(/,33619968,/.test(moduleXml(x, sdFrom)), sdFrom + ' is single phase');
    mods.push(cloneMod(sdFrom, sdTo, ip));
    let ax = cloneTag(aFrom, aTo);
    ax = rep1(ax, 'MotionModule="' + sdFrom + ':Ch1"', 'MotionModule="' + sdTo + ':Ch1"', aTo + ' motion module');
    return ax.replace(/ AxisID="\d+"/, ' AxisID="' + (maxAxisId + 1 + i) + '"');
  });
  after('a03_L2S01FeedDownstream', axes.join('\n'));
  const ids = [...x.matchAll(/AxisID="(\d+)"/g)].map((m) => m[1]);
  must(new Set(ids).size === ids.length, 'duplicate AxisID');

  // payout VFDs (PowerFlex 525-EENET) + their buffer tags
  const fdTags = [];
  for (const [from, to, ip] of VFDS) { mods.push(cloneMod(from, to, ip)); fdTags.push(cloneTag(from + '_IN', to + '_IN'), cloneTag(from + '_OUT', to + '_OUT')); }
  after('fd04_L2S01PayoutDownstreamB_OUT', fdTags.join('\n'));

  // micrometer (LS-9501P + CB-EP100, DINT 312 / 124)
  mods.push(cloneMod(MM[0], MM[1], MM[2]));
  after(MM[0] + '_OUT', cloneTag(MM[0] + '_IN', MM[1] + '_IN') + '\n' + cloneTag(MM[0] + '_OUT', MM[1] + '_OUT'));

  // valve bank VB2: vb01 (54 / 52) cloned and resized
  const elems = (n) => Array.from({ length: n }, (_, i) => '<Element Index="[' + i + ']" Value="0"/>').join('\n');
  const resize = (block, n) => block
    .replace(/<Data Format="L5K">\s*<!\[CDATA\[\[\[[0-9,\s]*\]\]\]\]>\s*<\/Data>/, '<Data Format="L5K">\n<![CDATA[[[' + Array(n).fill('0').join(',') + ']]]]>\n</Data>')
    .replace(/<ArrayMember Name="Data" DataType="SINT" Dimensions="\d+" Radix="Decimal">[\s\S]*?<\/ArrayMember>/, '<ArrayMember Name="Data" DataType="SINT" Dimensions="' + n + '" Radix="Decimal">\n' + elems(n) + '\n</ArrayMember>');
  const TI = 'AB:ETHERNET_MODULE_SINT_' + VB_IN + 'Bytes:I:0', TO = 'AB:ETHERNET_MODULE_SINT_' + VB_OUT + 'Bytes:O:0';
  let m = cloneMod(VB1, VB, VB_IP);
  m = m.replace(/<Description>\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Description>/, '<Description>\n<![CDATA[EX600 with (5) 8 Point Digital Input Modules ]]>\n</Description>');
  m = rep1(m, 'PrimCxnInputSize="54"', 'PrimCxnInputSize="' + VB_IN + '"', 'vb02 input size');
  m = rep1(m, 'PrimCxnOutputSize="52"', 'PrimCxnOutputSize="' + VB_OUT + '"', 'vb02 output size');
  m = rep1(m, 'OutputSize="52" InputSize="54"', 'OutputSize="' + VB_OUT + '" InputSize="' + VB_IN + '"', 'vb02 connection sizes');
  m = m.split('AB:ETHERNET_MODULE_SINT_54Bytes:I:0').join(TI).split('AB:ETHERNET_MODULE_SINT_52Bytes:O:0').join(TO);
  m = m.replace(/<InputTag[\s\S]*?<\/InputTag>/, (s) => resize(s, VB_IN)).replace(/<OutputTag[\s\S]*?<\/OutputTag>/, (s) => resize(s, VB_OUT));
  must(countOf(m, 'Dimensions="' + VB_IN + '"') === 2 && !/Dimensions="5[24]"/.test(m) && !/SINT_5[24]Bytes/.test(m), 'vb02 data arrays resized');
  mods.push(m);
  const vbIn = resize(cloneTag(VB1 + '_IN', VB + '_IN').split('AB:ETHERNET_MODULE_SINT_54Bytes:I:0').join(TI), VB_IN);
  const vbOut = resize(cloneTag(VB1 + '_OUT', VB + '_OUT').split('AB:ETHERNET_MODULE_SINT_52Bytes:O:0').join(TO), VB_OUT);
  for (const [t, n] of [[vbIn, VB_IN], [vbOut, VB_OUT]]) must(countOf(t, '<Element Index=') === n && countOf(t, 'Bytes:') === 2 && (/\[\[([0-9,]*)\]\]/.exec(t)[1].split(',').length === n), 'vb02 buffer tag ' + n + ' bytes');
  after(VB1 + '_OUT', vbIn + '\n' + vbOut);

  x = insertBefore(x, '</Modules>', mods.join('\n') + '\n', '</Modules>');
  must(/<Module Name="HSC2"[\s\S]*?<Port Id="1" Address="7" Type="ICP"/.test(x), 'HSC2 in slot 7');
  log.push('modules: sd04 / sd05 (single phase), fd05-fd08, mm02 (.81), vb02 (.91, in ' + VB_IN + ' / out ' + VB_OUT + '); axes a04 / a05; HSC2 slot 7 already present');
}

// ═══ 3. g_L2StationList[2] ═══════════════════════════════════════════════════
{
  const gl = tagXml(x, 'g_L2StationList') || fail('g_L2StationList');
  const names = [...gl.matchAll(/<Element Index="\[(\d+)\]">[\s\S]*?<!\[CDATA\[(?:'([^']*)')?\]\]>/g)].map((m) => m[2] || '');
  must(names.length === 17 && names[STA] === '' && names[1] === 'L2S01 Tube Load: ', 'g_L2StationList elements');
  names[STA] = PREFIX;
  const head = gl.slice(0, gl.indexOf('<Data Format="L5K">'));
  x = replaceTagIn(x, 'g_L2StationList', head + '<Data Format="L5K">\n<![CDATA[[' + names.map((s) => l5kStr(s, 82)).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="STRING" Dimensions="17">\n' + names.map((s, i) => strElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>');
}

// ═══ 4. MapInputs / MapOutputs (CPS of whole blocks only) ════════════════════
for (const [prog, dir] of [['MapInputs', 'Inputs'], ['MapOutputs', 'Outputs']]) editRoutine(prog, 'R01_Logic', (r) => {
  const cps = (mod) => dir === 'Inputs' ? 'CPS(' + mod + ':I,' + mod + '_IN,1)' : 'CPS(' + mod + '_OUT,' + mod + ':O,1)';
  const g = r.findIndex((rg) => rungText(rg).includes(cps('vb06_MainAssembly')));
  const f = r.findIndex((rg) => rungText(rg).includes(cps(VFDS[0][0])));
  must(g >= 0 && f === r.length - 1, prog + ' rungs');
  r[g] = setRungText(r[g], rep1(rungText(r[g]), ',' + cps('vb06_MainAssembly'), ',' + cps(VB) + ' ,' + cps(MM[1]) + ' ,' + cps('vb06_MainAssembly'), prog + ' general devices'));
  return [...r, newRung('Map Ethernet IP ' + dir + ' Using CPS Instruction - L2S02 Payout VFDs', '[' + VFDS.map(([, to]) => cps(to)).join(' ,') + ' ];')];
});

// ═══ 5. supervisor, alarms, schedule ═════════════════════════════════════════
const afterLast = (t, q) => { const a = 'XIC(\\' + SRC[3] + '.' + q + ')'; return rep1(t, a, a + NEW.map((n) => 'XIC(\\' + n + '.' + q + ')').join(''), 'Supervisor ' + q); };
editRoutine('Supervisor', 'R01_Inputs', (r) => r.map((rg) => {
  const t = rungText(rg);
  if (/OTE\(AllSMInAuto\);$/.test(t)) return setRungText(rg, afterLast(t, 'q_AutoMode'));
  if (/OTE\(MachineStopped\);$/.test(t)) return setRungText(rg, afterLast(t, 'q_AutoStopped'));
  if (/OTE\(StartOK\);$/.test(t)) return setRungText(rg, afterLast(t, 'q_StartOK'));
  return rg;
}));
for (const n of NEW) must(countOf(programBody(x, 'Supervisor'), '\\' + n + '.q_') === 3, 'Supervisor polls ' + n + ' three times');
const eipNodes = [...DRIVES.map(([, sd, , , , msg]) => [sd + 'EIP', sd, msg]), ...VFDS.map(([, fd, , msg]) => [fd.replace('_L2S02', '_') + 'EIP', fd, msg]), [VB + 'EIP', VB, VB_EIP], [MM[1] + 'EIP', MM[1], MM[3]]];
const NODE0 = 20, ALARM0 = 21, ALARM_N = 30;
editRoutine('Supervisor', 'R15_EIPMonitor', (r) => r.map((rg) => rungText(rg) === 'GE(EIPStatusCount,' + NODE0 + ')MOVE(0,EIPStatusCount);' ? setRungText(rg, 'GE(EIPStatusCount,' + (NODE0 + eipNodes.length) + ')MOVE(0,EIPStatusCount);') : rg));
must(programBody(x, 'Supervisor').includes('GE(EIPStatusCount,' + (NODE0 + eipNodes.length) + ')'), 'EIP node count ' + (NODE0 + eipNodes.length));
editRoutine('Supervisor', 'R20_Alarms', (r) => {
  const i = r.findIndex((rg) => rungText(rg).includes('EQ(EIPStatusCount,' + (NODE0 - 1) + ') AOI_EIPStatus('));
  must(i > 0 && !r.some((rg) => rungText(rg).includes('EQ(EIPStatusCount,' + NODE0 + ')')), 'Supervisor R20 last EIP rung');
  const add = eipNodes.map(([tag, mod, msg], j) => newRung(msg + ' Communications', '[XIC(g_MachineBasic.PowerUpCP) EQ(EIPStatusCount,' + (NODE0 + j) + ') AOI_EIPStatus(' + tag + ',' + mod + ') XIO(' + tag + '.ComOK) ,XIC(Alarm[' + (ALARM0 + j) + '].Active) XIO(q_FaultReset) ]OTE(Alarm[' + (ALARM0 + j) + '].Active);'));
  return [...r.slice(0, i + 1), ...add, ...r.slice(i + 1)];
});
{
  let sup = programBody(x, 'Supervisor');
  const eipTpl = tagXml(sup, 'sd01_IndexerEIP') || fail('Supervisor sd01_IndexerEIP');
  for (const [tag] of eipNodes) must(!tagXml(sup, tag), 'Supervisor tag free: ' + tag);
  sup = sup.replace(eipTpl, eipTpl + '\n' + eipNodes.map(([tag]) => eipTpl.replace('Name="sd01_IndexerEIP"', 'Name="' + tag + '"')).join('\n'));
  let al = tagXml(sup, 'Alarm') || fail('Supervisor Alarm');
  must(al.includes('Dimensions="25"'), 'Supervisor Alarm[25]');
  const oldDec = [...al.matchAll(/<Element Index="\[\d+\]">[\s\S]*?<\/Element>/g)].map((m) => m[0]);
  must(oldDec.length === 25, 'Supervisor Alarm decorated elements');
  const msgs = Array.from({ length: ALARM_N }, (_, i) => i < 25 ? (/<!\[CDATA\['([^']*)'\]\]>/.exec(oldDec[i]) || [, ''])[1] : '');
  eipNodes.forEach(([, , msg], j) => { must(msgs[ALARM0 + j] === '', 'Supervisor Alarm[' + (ALARM0 + j) + '] free'); msgs[ALARM0 + j] = msg + ' Communications'; });
  const head = al.slice(0, al.indexOf('<Data Format="L5K">')).replace('Dimensions="25"', 'Dimensions="' + ALARM_N + '"');
  al = head + '<Data Format="L5K">\n<![CDATA[[' + msgs.map(alarmElemL5K).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="AlarmData" Dimensions="' + ALARM_N + '">\n' + msgs.map((s, i) => alarmElemDec(i, s)).join('\n') + '\n</Array>\n</Data>\n</Tag>';
  sup = replaceTagIn(sup, 'Alarm', al);
  replaceProgram('Supervisor', sup);
  log.push('Supervisor: four programs polled, ' + eipNodes.length + ' EIP-loss alarms (' + ALARM0 + '-' + (ALARM0 + eipNodes.length - 1) + '), Alarm[' + ALARM_N + '], node count ' + (NODE0 + eipNodes.length));
}
editRoutine('Alarms', 'R01_Logic', (r) => r.map((rg) => {
  const t = rungText(rg);
  const add = (q) => { const a = 'XIO(\\' + SRC[3] + '.' + q + ')'; return setRungText(rg, rep1(t, a, a + NEW.map((n) => 'XIO(\\' + n + '.' + q + ')').join(''), 'Alarms ' + q)); };
  if (t.endsWith('OTE(p_NoMachineFaults);')) return add('q_AlarmActive');
  if (t.endsWith('OTE(p_NoMachineWarnings);')) return add('q_WarningActive');
  return rg;
}));
for (const n of NEW) must(countOf(programBody(x, 'Alarms'), '\\' + n + '.q_') === 2, 'Alarms roll-up ' + n);
x = rep1(x, '<ScheduledProgram Name="' + SRC[3] + '"/>', '<ScheduledProgram Name="' + SRC[3] + '"/>' + NEW.map((n) => '\n<ScheduledProgram Name="' + n + '"/>').join(''), 'MainTask schedule');

// ═══ 6. parameter connections: every L2S01 connection, re-pointed to the L2S02 device ═══
{
  const point = (e) => {
    let m;
    if (e.startsWith('\\L2_S01_')) return e.replace('\\L2_S01_', '\\L2_S02_');
    if ((m = /^vb01_MainAssembly_IN\.Data\[(\d+)\](.*)$/.exec(e))) { const b = +m[1]; must(b <= 2 || (b >= 6 && b <= 13), 'VB1 input byte ' + b); return VB + '_IN.Data[' + (b <= 2 ? b : b + 1) + ']' + m[2]; }   // LAB1 starts one byte later (5th DXPC)
    if ((m = /^vb01_MainAssembly_OUT\.Data\[(\d+)\](.*)$/.exec(e))) { const b = +m[1]; must(b >= 47 && b <= 49, 'VB1 output byte ' + b); return VB + '_OUT.Data[' + (b - 1) + ']' + m[2]; }                    // no DMPF byte ahead of the coils
    if ((m = /^fd0([1-4])_L2S01(Payout\w+)$/.exec(e))) return 'fd0' + (+m[1] + 4) + '_L2S02' + m[2];
    if (e.startsWith(MM[0] + '_IN.')) return e.replace(MM[0], MM[1]);
    for (const [, , , aFrom, aTo] of DRIVES) if (e === aFrom) return aTo;
    if (e.startsWith(HSC_FROM)) return e.replace(HSC_FROM, HSC_TO);
    return fail('unmapped endpoint: ' + e);
  };
  const src = [...x.matchAll(/<ParameterConnection EndPoint1="([^"]+)" EndPoint2="([^"]+)"\/>/g)].filter((m) => m[1].startsWith('\\L2_S01_') || m[2].startsWith('\\L2_S01_'));
  must(src.length === 64, 'L2S01 parameter connections: ' + src.length);
  const pcs = src.map((m) => [point(m[1]), point(m[2])]);
  const ends = pcs.flat();
  must(new Set(ends).size === ends.length, 'duplicate endpoint');
  for (const e of ends) must(!x.includes('EndPoint1="' + e + '"') && !x.includes('EndPoint2="' + e + '"'), 'endpoint already connected: ' + e);
  for (const e of ends.filter((s) => !s.startsWith('\\'))) { const root = e.split(/[.[]/)[0]; must(root.startsWith('Local:7:') || countOf(x, '<Tag Name="' + root + '"') === 1, 'endpoint tag exists: ' + root); }
  x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
  log.push('parameter connections: ' + pcs.length);
}

// ═══ 7. proof: every program that is not polled or mapped stays as stamped (Jason 2026-11-06) ═══
{
  const EDITED = new Set(['Supervisor', 'Alarms', 'MapInputs', 'MapOutputs']);
  const names = [...base.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) if (!EDITED.has(n)) must(programBody(x, n) === programBody(base, n), 'program changed: ' + n);
  for (const n of ['a02_L2S01FeedUpstream', 'a03_L2S01FeedDownstream', VB1 + '_IN', VB1 + '_OUT']) must(tagXml(x, n) === tagXml(base, n), 'tag changed: ' + n);
  for (const n of ['sd02_L2S01FeedUpstream', 'fd01_L2S01PayoutUpstreamA', VB1, MM[0], 'HSC1', 'HSC2']) must(moduleXml(x, n) === moduleXml(base, n), 'module changed: ' + n);
  log.push('untouched: ' + (names.length - EDITED.size) + ' programs byte-identical to the stamp, L2S01 hardware unchanged');
}

// ═══ 8. write + gates ════════════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
for (const n of NEW) must(countOf(x, '<Program Name="' + n + '"') === 1 && countOf(x, '<ScheduledProgram Name="' + n + '"/>') === 1, n + ' scheduled once');
for (const [, sd, , , a] of DRIVES) must(countOf(x, '<Tag Name="' + a + '"') === 1 && countOf(x, '<Module Name="' + sd + '"') === 1, a);
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
fs.mkdirSync(path.join(PROGDIR, '..', 'controller'), { recursive: true });
fs.writeFileSync(path.join(PROGDIR, '..', 'controller', 'Tasks.xml'), (/<Tasks>[\s\S]*?<\/Tasks>/.exec(x) || [''])[0]);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);

const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', ...NEW.map((n) => path.join(PROGDIR, n + '.xml'))]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict) || process.argv.includes('--verbose')) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW|warn/i.test(l)).slice(0, 80).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');
if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 9. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION + ' (cover note: node scripts/coverNote1163S2.cjs)');
