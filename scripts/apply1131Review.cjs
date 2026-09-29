#!/usr/bin/env node
'use strict';
/**
 * apply1131Review.cjs - job 1131 v0.5, part A: the mechanical items of Jason's v0.4 review
 * (2026-09-29). Runs on the build tree split from the delivered v0.4.
 *
 *   2  Operator station handled as the template: i_CycleStart / i_CycleStop used directly in R02,
 *      the three local OTE tags removed; i_AirPressureOK goes into the StartOK string (Jason: it
 *      must - the template has no air-pressure input, so this is D-logged).
 *   3  No muting control in the MainTask: the S01 request bit and the Supervisor_Loader rung that
 *      wrote g_MuteInfeedLightcurtains go; the safety programs are untouched.
 *   4  The infeed stack laser is decoded where Justin decoded it - in the gantry's own R01 - not in
 *      MapInputs through a controller buffer. O1D100_Decode is his AOI and stays.
 *   7  Corner rounding only on stations blending two axes: stripped from S01 (Y), S02 (R), S09 (Y).
 *   +  S07 state 67 gets its success exit (the defect the sequence document turned up).
 *
 * Part B (Justin's vision maths and XZ permissive network, items 6 and 8) is a separate script.
 *
 *   node scripts/apply1131Review.cjs [--build-dir generated/1131/build]
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const BUILD = path.resolve(flag('build-dir', 'generated/1131/build'));
const PROGS = path.join(BUILD, 'programs'), CTRL = path.join(BUILD, 'controller');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');
const prog = (n) => path.join(PROGS, n + '.xml');
const log = [];
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };

// ── rung / tag helpers (same shape as split1131Halves.cjs) ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, a, b) => a + t + b);
const setRungComment = (r, c) => /<Comment>/.test(r)
  ? r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, a, b) => a + c + b)
  : r.replace(/(<Rung\b[^>]*>)/, '$1\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>');
const newRung = (c, t) => '<Rung Number="0" Type="N">\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, a, b) => a + (n++) + b); };
function getRoutine(x, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(x); return m ? m[1] : null; }
function putRungs(x, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(x)) fail('routine not found: ' + rn);
  return x.replace(re, (m, a, body, c) => a + '\n' + renumber(rungs.join('\n')) + '\n' + c);
}
function editRoutine(x, rn, fn) { const rungs = rungList(getRoutine(x, rn) || fail('no routine ' + rn)); return putRungs(x, rn, fn(rungs)); }
/** Remove one program tag. A self-closing <Tag .../> is removed alone; a block is removed through its </Tag>. */
function dropTag(x, name) {
  const open = new RegExp('<Tag Name="' + name + '"[^>]*?(/?)>').exec(x);
  if (!open) return null;
  if (open[1] === '/') return x.replace(open[0], '').replace(/\n\s*\n/, '\n');
  const re = new RegExp('<Tag Name="' + name + '"[^>]*>[\\s\\S]*?</Tag>\\s*');
  return x.replace(re, '');
}
function mustDrop(x, name, where) { const y = dropTag(x, name); if (y === null) fail('tag not found: ' + name + ' in ' + where); return y; }
const count = (x, re) => (x.match(re) || []).length;

// ── 2. operator station: template form, air pressure in StartOK ──────────
for (const half of ['Loader', 'Unloader']) {
  const f = prog('Supervisor_' + half); let x = read(f);
  let dropped = 0;
  x = editRoutine(x, 'R01_Inputs', (rungs) => rungs.filter((r) => {
    const t = rungText(r);
    const gone = /^XIC\(i_CycleStart\)OTE\(CycleStartPushbutton\);$/.test(t) || /^XIC\(i_CycleStop\)OTE\(CycleStopPushbutton\);$/.test(t) || /^XIC\(i_AirPressureOK\)OTE\(AirPressureOK\);$/.test(t);
    if (gone) dropped++;
    return !gone;
  }));
  if (dropped !== 3) fail('Supervisor_' + half + ': expected to drop 3 operator rungs, dropped ' + dropped);
  // drop the three local tags FIRST - after this the old names survive only in rung text
  for (const t of ['CycleStartPushbutton', 'CycleStopPushbutton', 'AirPressureOK']) x = mustDrop(x, t, 'Supervisor_' + half);
  x = x.replace(/\bCycleStartPushbutton\b/g, 'i_CycleStart').replace(/\bCycleStopPushbutton\b/g, 'i_CycleStop');
  x = x.replace(/\b(XIC|XIO)\(AirPressureOK\)/g, '$1(i_AirPressureOK)');
  let startOk = 0;
  x = editRoutine(x, 'R01_Inputs', (rungs) => rungs.map((r) => {
    const t = rungText(r);
    if (!/OTE\(StartOK\);$/.test(t)) return r;
    startOk++;
    if (/i_AirPressureOK/.test(t)) return r;
    return setRungComment(setRungText(r, t.replace(/OTE\(StartOK\);$/, 'XIC(i_AirPressureOK)OTE(StartOK);')),
      'Automatic mode start OK - every station ready and air pressure OK');
  }));
  if (startOk !== 1) fail('Supervisor_' + half + ': StartOK rung count ' + startOk);
  if (/\bCycleStartPushbutton\b|\bCycleStopPushbutton\b|\bAirPressureOK\b/.test(x)) fail('Supervisor_' + half + ': a local operator tag survives');
  write(f, x);
  log.push('2  Supervisor_' + half + ': 3 rungs and 3 tags gone; R02 uses i_CycleStart / i_CycleStop; i_AirPressureOK in StartOK');
}

// ── 3. no muting control in the MainTask ─────────────────────────────────
{
  let f = prog('Supervisor_Loader'); let x = read(f); let n = 0;
  x = editRoutine(x, 'R01_Inputs', (rungs) => rungs.filter((r) => { const g = /g_MuteInfeedLightcurtains/.test(rungText(r)); if (g) n++; return !g; }));
  if (n !== 1) fail('Supervisor_Loader: mute rung count ' + n);
  write(f, x);
  f = prog('S01_InfeedCart'); x = read(f); n = 0;
  x = editRoutine(x, 'R03_StateLogic', (rungs) => rungs.filter((r) => { const g = /OTE\(p_EntryLightCurtainMute\)/.test(rungText(r)); if (g) n++; return !g; }));
  if (n !== 1) fail('S01: mute request rung count ' + n);
  x = mustDrop(x, 'p_EntryLightCurtainMute', 'S01');
  if (/p_EntryLightCurtainMute/.test(x)) fail('S01: p_EntryLightCurtainMute survives');
  write(f, x);
  f = path.join(CTRL, 'ControllerTags.xml'); x = read(f);
  x = mustDrop(x, 'g_MuteInfeedLightcurtains', 'ControllerTags'); write(f, x);
  // the standard tag was the MainTask side of a safety tag map pair - the map entry must go with it,
  // or Studio refuses the SafetyTask ("Safety mapped tag does not exist"). The gs_ twin stays: the
  // safety programs are Justin's verbatim (D007) and no safety rung reads it.
  // <SafetyInfo> precedes <DataTypes> in a Studio export, so the split keeps it in 00_header.xml
  f = ['00_header.xml', 'SafetyInfo.xml'].map((n) => path.join(CTRL, n)).find((p) => fs.existsSync(p) && /<SafetyTagMap>/.test(read(p)));
  if (!f) fail('no controller piece carries <SafetyTagMap>');
  x = read(f);
  const before = x;
  x = x.replace(/,\s*g_MuteInfeedLightcurtains=gs_\w+/, '').replace(/g_MuteInfeedLightcurtains=gs_\w+\s*,\s*/, '');
  if (x === before) fail('SafetyInfo: the g_MuteInfeedLightcurtains map entry was not found');
  if (/g_MuteInfeedLightcurtains/.test(x)) fail('SafetyInfo: the map entry survives');
  write(f, x);
  for (const p of fs.readdirSync(PROGS)) if (/g_MuteInfeedLightcurtains|p_EntryLightCurtainMute/.test(read(path.join(PROGS, p)))) fail(p + ' still references the mute tags');
  log.push('3  mute request rungs (Supervisor_Loader, S01) and both tags gone; safety programs untouched');
}

// ── 4. the infeed laser decoded in S03 R01, as Justin did ─────────────────
{
  let f = prog('MapInputs'); let x = read(f); let n = 0;
  x = editRoutine(x, 'R01_Logic', (rungs) => rungs.filter((r) => { const g = /O1D100_Decode\(/.test(rungText(r)); if (g) n++; return !g; }));
  if (n !== 1) fail('MapInputs: laser rung count ' + n);
  const backing = /<Tag Name="InfeedStackHeightLaser"[^>]*>[\s\S]*?<\/Tag>/.exec(x);
  if (!backing) fail('MapInputs: O1D100 backing tag not found');
  x = mustDrop(x, 'InfeedStackHeightLaser', 'MapInputs'); write(f, x);

  f = path.join(CTRL, 'ControllerTags.xml'); x = read(f); x = mustDrop(x, 'io01_InfeedStackHeight_IN', 'ControllerTags'); write(f, x);
  f = path.join(CTRL, 'ParameterConnections.xml'); x = read(f);
  const before = x.split('\n').length;
  x = x.split(/\r?\n/).filter((l) => !/io01_InfeedStackHeight_IN/.test(l)).join('\n');
  if (x.split('\n').length !== before - 1) fail('ParameterConnections: expected one laser connection to drop');
  write(f, x);

  f = prog('S03_InfeedGantry'); x = read(f);
  if (!/<Tag Name="i_StackHeight"[^>]*Usage="Input"/.test(x)) fail('S03: i_StackHeight is not an Input parameter');
  x = x.replace(/(<Tag Name="i_StackHeight"[^>]*?) Usage="Input"/, '$1');            // becomes a local tag
  x = x.replace(/<\/Tags>/, backing[0] + '\n</Tags>');                                  // first </Tags> = the program's tags
  x = editRoutine(x, 'R01_Inputs', (rungs) => rungs.concat(newRung('Infeed stack height laser',
    'O1D100_Decode(InfeedStackHeightLaser,io01_InfeedPointIO:7:I.Ch0Data)MOVE(InfeedStackHeightLaser.Distance,i_StackHeight);')));
  write(f, x);
  log.push('4  O1D100_Decode moved from MapInputs into S03 R01_Inputs; buffer tag, connection and MapInputs rung gone');
}

// ── 7. corner rounding off the single-axis stations ──────────────────────
const BLEND = /\[XIC\((\w+)_MAM\.PC\) XIC\((\w+)\.InPos\) ,XIO\(DisableCornerRounding\) XIC\(\1_MAM\.IP\) XIC\(\2\.InPosWide\) \]/g;
for (const s of ['S01_InfeedCart', 'S02_InfeedVision', 'S09_OutfeedCart']) {
  const f = prog(s); let x = read(f); let n = 0, legs = 0;
  x = editRoutine(x, 'R01_Inputs', (rungs) => rungs.filter((r) => { const g = /OTE\(DisableCornerRounding\)/.test(rungText(r)); if (g) n++; return !g; }));
  if (n !== 1) fail(s + ': rounding enable rung count ' + n);
  x = editRoutine(x, 'R02_StateTransitions', (rungs) => rungs.map((r) => {
    const t = rungText(r); if (!/DisableCornerRounding/.test(t)) return r;
    const t2 = t.replace(BLEND, (m, ax, pos) => { legs++; return 'XIC(' + ax + '_MAM.PC)XIC(' + pos + '.InPos)'; });
    return setRungText(r, t2);
  }));
  for (const t of ['DisableCornerRounding', 'i_DisableCornerRounding']) x = mustDrop(x, t, s);
  if (/DisableCornerRounding/.test(x)) fail(s + ': a rounding reference survives');
  write(f, x);
  const pcf = path.join(CTRL, 'ParameterConnections.xml');
  write(pcf, read(pcf).split(/\r?\n/).filter((l) => !(l.includes('\\' + s + '.i_DisableCornerRounding'))).join('\n'));
  log.push('7  ' + s + ': rounding removed (' + legs + ' blend leg' + (legs === 1 ? '' : 's') + ' -> move complete and in position)');
}

// ── +. S07 state 67 success exit ──────────────────────────────────────────
{
  const f = prog('S07_OutfeedGantry'); let x = read(f); let n = 0;
  x = editRoutine(x, 'R02_StateTransitions', (rungs) => rungs.map((r) => {
    const t = rungText(r);
    if (t !== 'XIC(Status.State[37])XIC(BlowOffDelay.DN)XIC(SS_OK)MOVE(40,Control.StateReg);') return r;
    n++;
    return setRungComment(setRungText(r, '[XIC(Status.State[37]) XIC(BlowOffDelay.DN) ,XIC(Status.State[67]) [XIC(TileGripped) ,XIC(DryRun) ] ]XIC(SS_OK)MOVE(40,Control.StateReg);'),
      'State 40: Retract Z axis at the gauge after the release, or with the retrieved tile gripped');
  }));
  if (n !== 1) fail('S07: state-40 rung count ' + n);
  write(f, x);
  log.push('+  S07 state 67 -> 40 on TileGripped or DryRun (twin of the state 19 verify)');
}

console.log('1131 v0.5 part A\n');
for (const l of log) console.log('  ' + l);
