#!/usr/bin/env node
'use strict';
/**
 * apply1131ReviewB.cjs - job 1131 v0.5, part B: Justin Stanko's vision maths, belt tracking and
 * XZ permissive network, transplanted verbatim (Jason, 2026-09-29, items 6 and 8).
 *
 * Rung TEXT is copied from Justin's file through a rename map - never retyped. Tag DECLARATIONS
 * are copied as XML blocks so their initial values (belt reference heights, zone positions,
 * rollover, calibration constants) come with them.
 *
 *   S02  P02 R03 r9-r16, r18, r19 (X/Y from the camera with the line fallback, the laser pixel
 *        calibration block, in-range, ready/unlatch) + the camera bypass input. My restructured
 *        maths, clamps and ready rung go. Results bridge to the existing p_ outputs.
 *   S06  P05 R03 r8-r19, r24, r26 (belt accumulator with rollover, camera-pass pick position,
 *        sensor-trip fallback, DeltaCounts, lag reset, unlatch, unpickable) + NoPartsPresent.
 *   S07  P06 R06_ConveyorTracking whole (per-slot belt counters, FIFO, live tile X, gear gate);
 *        P06 X/Z permissive network (zones, direction bits, clearForward/Reverse, stack height
 *        from the lasers). Gearing gates on GearableRangeReached instead of my window.
 *   S03  P04 X/Z permissive network (ZAboveBelt, XPast*, ABS command, cart-safe, camera-retracted
 *        interlock); publishes what S02 needs (pick nominal, tile gripped, laser distance).
 *   S01  consumes the camera's ABSOLUTE cart-Y target the way P01 did; publishes the cart-safe
 *        bit and the Y pick position. S09 publishes cart-safe. S08 publishes the gauge permissive.
 *
 *   node scripts/apply1131ReviewB.cjs [--build-dir generated/1131/build]
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const BUILD = path.resolve(flag('build-dir', 'generated/1131/build'));
const PROGS = path.join(BUILD, 'programs'), CTRL = path.join(BUILD, 'controller');
const JUSTIN = flag('justin', 'N:/1131_Tarkett_Tile Grinder Automatic Loader and Unloader/1131 Electrical/1131 Software/PLC/Tarkett_Tile_Grinder_092826.L5X');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');
const prog = (n) => path.join(PROGS, n + '.xml');
const log = [];
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const J = read(JUSTIN);

// ── rung / tag helpers ────────────────────────────────────────────────────
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, a, b) => a + t + b);
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, a, b) => a + (n++) + b); };
function getRoutine(x, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(x); return m ? m[1] : null; }
function putRungs(x, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(x)) fail('routine not found: ' + rn);
  return x.replace(re, (m, a, body, c) => a + '\n' + renumber(rungs.join('\n')) + '\n' + c);
}
function editRoutine(x, rn, fn) { const rungs = rungList(getRoutine(x, rn) || fail('no routine ' + rn)); return putRungs(x, rn, fn(rungs)); }
function dropTag(x, name) {
  const open = new RegExp('<Tag Name="' + name + '"[^>]*?(/?)>').exec(x);
  if (!open) return null;
  if (open[1] === '/') return x.replace(open[0], '');
  return x.replace(new RegExp('<Tag Name="' + name + '"[^>]*>[\\s\\S]*?</Tag>\\s*'), '');
}
function mustDrop(x, name, where) { const y = dropTag(x, name); if (y === null) fail('tag not found: ' + name + ' in ' + where); return y; }
function addTags(x, blocks) { return x.replace(/<\/Tags>/, blocks.join('\n') + '\n</Tags>'); }   // first </Tags> = program tags
function hasTag(x, name) { return new RegExp('<Tag Name="' + name + '"').test(x); }
/** A rung that removes N rungs matching pred, asserting the count. */
function dropRungs(x, rn, pred, expect, where) {
  let n = 0;
  x = editRoutine(x, rn, (rungs) => rungs.filter((r) => { const g = pred(rungText(r), r); if (g) n++; return !g; }));
  if (n !== expect) fail(where + '/' + rn + ': expected to drop ' + expect + ' rung(s), dropped ' + n);
  return x;
}
/** Insert rungs after the rung whose text matches pred (or at the end when pred is null). */
function insertRungs(x, rn, pred, rungs, where) {
  let hit = 0;
  x = editRoutine(x, rn, (list) => {
    if (!pred) return list.concat(rungs);
    const out = [];
    for (const r of list) { out.push(r); if (pred(rungText(r))) { hit++; out.push(...rungs); } }
    return out;
  });
  if (pred && hit !== 1) fail(where + '/' + rn + ': insertion anchor matched ' + hit + ' rung(s)');
  return x;
}
function replaceRungText(x, rn, pred, text, where) {
  let n = 0;
  x = editRoutine(x, rn, (rungs) => rungs.map((r) => { if (!pred(rungText(r))) return r; n++; return setRungText(r, text); }));
  if (n !== 1) fail(where + '/' + rn + ': replace anchor matched ' + n + ' rung(s)');
  return x;
}
function addRoutine(x, name, rungs) {
  if (new RegExp('<Routine\\b[^>]*\\bName="' + name + '"').test(x)) fail('routine exists: ' + name);
  const block = '<Routine Name="' + name + '" Type="RLL">\n<RLLContent>\n' + renumber(rungs.join('\n')) + '\n</RLLContent>\n</Routine>\n';
  // SDC order: R00 .. R06, then R20_Alarms last
  if (/<Routine\b[^>]*\bName="R20_Alarms"/.test(x)) return x.replace(/(<Routine\b[^>]*\bName="R20_Alarms")/, block + '$1');
  return x.replace(/<\/Routines>/, block + '</Routines>');
}

// ── Justin's file: rung text and tag blocks ──────────────────────────────
const jprog = (p) => { const m = new RegExp('<Program\\b[^>]*?\\sName="' + p + '"[\\s\\S]*?</Program>').exec(J); if (!m) fail('Justin program not found: ' + p); return m[0]; };
function jrung(p, rn, n) {
  const body = getRoutine(jprog(p), rn) || fail('Justin routine not found: ' + p + '/' + rn);
  for (const r of rungList(body)) { const num = +(/\bNumber="(\d+)"/.exec(r) || [])[1]; if (num === n) return { c: cdataOf((/<Comment>([\s\S]*?)<\/Comment>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim(), t: rungText(r) }; }
  fail('Justin rung not found: ' + p + '/' + rn + ' r' + n);
}
/** Copy a tag declaration from Justin's program. as: 'local' strips Usage; 'public' sets Public; 'keep'. */
function jtag(p, name, opts = {}) {
  const body = jprog(p);
  const m = new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body);
  if (!m) fail('Justin tag not found: ' + p + '.' + name);
  let t = m[0];
  if (opts.rename) t = t.replace(/^<Tag Name="[^"]+"/, '<Tag Name="' + opts.rename + '"');
  const as = opts.as || 'local';
  if (as === 'local') t = t.replace(/^(<Tag [^>]*?) Usage="[^"]*"/, '$1');
  if (as === 'public') t = /Usage="/.test(t.split('>')[0]) ? t.replace(/^(<Tag [^>]*?) Usage="[^"]*"/, '$1 Usage="Public"') : t.replace(/^<Tag ([^>]*?)( Constant=)/, '<Tag $1 Usage="Public"$2');
  return ascii(t);                      // his descriptions carry em dashes; CDATA must stay ASCII
}
const jctrlTag = (name) => { const ctrl = J.slice(J.indexOf('<Tags>', J.indexOf('</AddOnInstructionDefinitions>')), J.indexOf('<Programs>')); const m = new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(ctrl); if (!m) fail('Justin controller tag not found: ' + name); return m[0]; };
/** New plain tag. */
// both data formats, as a Studio export carries them - the validator flags a tag with only one
const decorated = (dt) => '<Data Format="Decorated">\n<DataValue DataType="' + dt + '" Radix="' + (dt === 'REAL' ? 'Float' : 'Decimal') + '" Value="' + (dt === 'REAL' ? '0.0' : '0') + '"/>\n</Data>\n';
const newTag = (name, dt, usage, desc) => '<Tag Name="' + name + '" TagType="Base" DataType="' + dt + '" Radix="' + (dt === 'REAL' ? 'Float' : 'Decimal') + '"' + (usage ? ' Usage="' + usage + '"' : '') + ' Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n' + (desc ? '<Description>\n<![CDATA[' + desc + ']]>\n</Description>\n' : '') + '<Data Format="L5K">\n<![CDATA[' + (dt === 'REAL' ? '0.0' : '0') + ']]>\n</Data>\n' + decorated(dt) + '</Tag>';
/** Ordered word-boundary renames; longer names first so a prefix never clobbers a longer name. */
function rename(text, map) {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('(?<![A-Za-z0-9_])' + esc + '(?![A-Za-z0-9_])', 'g'), map[k]);
  }
  return text;
}
// the assembler wants ASCII inside CDATA; Justin's comments carry em dashes and curly quotes
const ascii = (s) => s.replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, '->').replace(/°/g, ' deg');
const jr = (p, rn, n, map) => { const r = jrung(p, rn, n); return newRung(ascii(r.c), rename(r.t, map || {})); };
const noRef = (x, names, where) => { for (const n of names) if (new RegExp('(?<![A-Za-z0-9_])' + n + '(?![A-Za-z0-9_])').test(x)) fail(where + ': a reference to ' + n + ' survives'); };

// ═════════════════════════════════════════════════════════════════════════
// B1. S02_InfeedVision - Justin's P02 vision maths
// ═════════════════════════════════════════════════════════════════════════
{
  const P = 'P02_Camera_Infeed', W = 'S02_InfeedVision';
  let x = read(prog(W));
  // my maths, clamps and ready rung go
  x = dropRungs(x, 'R03_StateLogic', (t) => /CPT\(CornerXMillimeters|CPT\(CartYMillimeters|NEG\(HMI_CartYOffsetLimit|MOVE\(\w+,p_PickXPosition\)|MOVE\(\w+,p_CartYOffset\)|OTE\(p_PickDataReady\)/.test(t), 6, W);
  for (const t of ['CornerXMillimeters', 'CartYMillimeters', 'CartYOffsetMinimum', 'HMI_CartYOffset', 'HMI_CartYOffsetLimit', 'HMI_PickXMaximum', 'HMI_PickXMinimum', 'HMI_PickXNominal', 'HMI_PickXOffset', 'HMI_ScaleMmPerPixel', 'HMI_ScaleMmPerPixelY', 'p_CartYOffset']) x = mustDrop(x, t, W);
  const map = {
    'i_CamXPositionPixels': 'i_CornerXPixels', 'i_CamYPositionPixels': 'i_CornerYPixels',
    '\\P01_InfeedCartTransfer.q_YPickPositionforCamera': '\\S01_InfeedCart.p_YPickPositionForCamera',
    '\\P04_InfeedServoPNP.q_XPickPositionforCamera': '\\S03_InfeedGantry.p_XPickPositionForCamera',
    '\\P04_InfeedServoPNP.q_PartGripped': '\\S03_InfeedGantry.p_TileGripped',
    'i_GantryClear': '\\S03_InfeedGantry.p_GantryClearOfCamera',
    'q_PickDataReady': 'p_PickDataReady',
    'ONS.6': 'ONS.7',                                            // ONS.6 is taken in my S02
  };
  // his r10 fires once on Pass in his results state; mine stores in 16 after waiting in 13 - either way, once
  const r10 = jrung(P, 'R03_StateLogic', 10);
  const rungs = [
    jr(P, 'R03_StateLogic', 9, map),
    newRung(r10.c, rename(r10.t, map).replace('[XIC(Status.State[13]) XIC(cam01_InfeedCamera_IN.Status.Pass) ONS(ONS.7)', '[[XIC(Status.State[13]) ,XIC(Status.State[16]) ] XIC(cam01_InfeedCamera_IN.Status.Pass) ONS(ONS.7)')),
    jr(P, 'R03_StateLogic', 11, map), jr(P, 'R03_StateLogic', 12, map), jr(P, 'R03_StateLogic', 13, map),
    jr(P, 'R03_StateLogic', 14, map), jr(P, 'R03_StateLogic', 15, map), jr(P, 'R03_StateLogic', 16, map),
    jr(P, 'R03_StateLogic', 18, map), jr(P, 'R03_StateLogic', 19, map),
    newRung('Camera results to the stations that read them', 'MOVE(q_ServoPickPosX,p_PickXPosition)MOVE(q_internalServoPickPosY,p_CartYPickPosition);'),
    newRung('Laser distance from the gantry for the pixel calibration', 'MOVE(\\S03_InfeedGantry.p_LaserDistance,i_VisionCal_LaserReading);'),
  ];
  if (!/State\[16\]/.test(rungText(rungs[1]))) fail(W + ': the results gate was not widened');
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(q_CameraGoToRun\)/.test(t), rungs, W);
  x = insertRungs(x, 'R01_Inputs', (t) => /OTE\(HMI_MomentaryOnPrevScan\)/.test(t), [jr(P, 'R01_Inputs', 11)], W);
  const tags = ['cameraLineXPositionMM', 'cameraLineYPositionMM', 'CameraYPositionMM', 'hmi_cameraLineX_Offset', 'hmi_cameraLineY_Offset', 'hmi_camerax_HiLim', 'hmi_camerax_LowLim', 'hmi_cameraX_Offset', 'hmi_CameraYOffset', 'hmi_cameray_HiLim', 'hmi_cameray_lowLim', 'I_XPickPositionfromHMI', 'i_yPickPositionfromHMI', 'p_VisionCal_Intercept', 'p_VisionCal_MaxLaser', 'p_VisionCal_MinLaser', 'p_VisionCal_Slope', 'VisionCal_LaserClamped', 'VisionCal_LaserReading', 'VisionCal_mmPerPixel', 'VisionCal_mmPerPixelNeg', 'VisionCal_OutOfRange', 'VisionCal_pxPerMM', 'XlinePositionFromCamera', 'XPositionFromCamera', 'XPositionOffsetAll', 'YlinePositionFromCamera', 'YPositionFromCamera', 'YPositionOffsetAll', 'q_internalServoPickPosX', 'q_ServoPickPosX', 'Bypass', 'HMI_CameraBypassEnable', 'i_VisionCal_LaserReading']
    .map((n) => jtag(P, n, { as: 'local' }));
  tags.push(jtag(P, 'q_internalServoPickPosY', { as: 'public' }), jtag(P, 'q_partresultsinrange', { as: 'public' }));
  tags.push(jctrlTag('cameraXPositionMM').replace(/ Class="Standard"/, ''));       // his was controller-scope; only S02 uses it
  tags.push(newTag('p_CartYPickPosition', 'REAL', 'Public', 'Cart Y target from the camera'));
  x = addTags(x, tags);
  noRef(x, ['CornerXMillimeters', 'CartYMillimeters', 'HMI_ScaleMmPerPixel', 'p_CartYOffset'], W);
  write(prog(W), x);
  log.push('S02  P02 R03 r9-r16/r18/r19 + bypass in; 6 rungs and 12 tags of mine out; 37 tags in');
}

// ═════════════════════════════════════════════════════════════════════════
// B2. S03_InfeedGantry - P04 permissive network; publishes for S02
// ═════════════════════════════════════════════════════════════════════════
{
  const P = 'P04_InfeedServoPNP', W = 'S03_InfeedGantry';
  let x = read(prog(W));
  const map = { '\\P10_InfeedServoCamera.q_XAxisRetracted': '\\S02_InfeedVision.p_CameraRetracted', 'i_CartSafeforGantryZMotion': '\\S01_InfeedCart.p_CartSafeForGantryZMotion', 'i_cartinprocess': '\\S01_InfeedCart.p_CartInPickPosition', 'q_GantryClearOfCart': 'p_GantryClearOfCart' };
  x = replaceRungText(x, 'R04_XAxisServo', (t) => /OTE\(XAxisPermissive\)/.test(t), rename(jrung(P, 'R04_XAxisServo', 2).t, map), W);
  x = insertRungs(x, 'R04_XAxisServo', (t) => /OTE\(XAxisPermissive\)/.test(t), [jr(P, 'R04_XAxisServo', 20), jr(P, 'R04_XAxisServo', 27), jr(P, 'R04_XAxisServo', 28), jr(P, 'R04_XAxisServo', 29)], W);
  x = replaceRungText(x, 'R05_ZAxisServo', (t) => /OTE\(ZAxisPermissive\)/.test(t), rename(jrung(P, 'R05_ZAxisServo', 2).t, map), W);
  x = insertRungs(x, 'R05_ZAxisServo', (t) => /OTE\(ZAxisPermissive\)/.test(t), [jr(P, 'R05_ZAxisServo', 32)], W);
  x = dropRungs(x, 'R05_ZAxisServo', (t) => /ADD\(HMI_ZAxis\.Parameters\.Positions\[2\],10,ZAxisSafePosition\)/.test(t), 1, W);
  x = replaceRungText(x, 'R03_StateLogic', (t) => /OTE\(p_GantryClearOfCart\)/.test(t), rename(jrung(P, 'R03_StateLogic', 30).t, map), W);
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(p_InfeedCartFinished\)/.test(t), [
    newRung('Tile gripped for the vision station', 'XIC(TileGripped)OTE(p_TileGripped);'),
    newRung('Nominal X pick position for the vision station', 'MOVE(HMI_XAxis.Parameters.Positions[3],p_XPickPositionForCamera);'),
    newRung('Laser distance for the vision pixel calibration', 'MOVE(InfeedStackHeightLaser.Distance,p_LaserDistance);'),
  ], W);
  for (const t of ['ZAxisSafePosition', 'HMI_BeltClearX', 'HMI_CartHandleClearZ']) if (hasTag(x, t)) x = mustDrop(x, t, W);
  x = addTags(x, ['ZAboveBelt', 'ZAxis_BeltreferencePos', 'XPastBelt', 'XPastCart', 'XpastBelt_Pos', 'XpastCart_Pos', 'XABSCommandFWD', 'XABSCommandREV', 'xABSCommandZero', 'AbsoluteMoveNextPosition', 'CartHandleHeight', 'GantryClearofCartHeight']
    .map((n) => jtag(P, n)).concat([newTag('p_TileGripped', 'BOOL', 'Public'), newTag('p_XPickPositionForCamera', 'DINT', 'Public'), newTag('p_LaserDistance', 'DINT', 'Public')]));
  noRef(x, ['ZAxisSafePosition', 'HMI_BeltClearX', 'HMI_CartHandleClearZ'], W);
  write(prog(W), x);
  log.push('S03  P04 X/Z permissives + ZAboveBelt, XPast*, ABS command, gantry-clear-of-cart in; publishes p_TileGripped, p_XPickPositionForCamera, p_LaserDistance');
}

// ═════════════════════════════════════════════════════════════════════════
// B3a. S06_OutfeedVision - P05 vision maths and belt accumulator
// ═════════════════════════════════════════════════════════════════════════
{
  const P = 'P05_Camera_Outfeed', W = 'S06_OutfeedVision';
  let x = read(prog(W));
  x = dropRungs(x, 'R03_StateLogic', (t) => /CPT\(LeadingEdgeXMillimeters|MOVE\(LeadingEdgeXMillimeters,p_PickXPosition\)|MOVE\(\\S05_OutfeedConveyor\.p_BeltPosition,p_BeltPositionAtTrigger\)|OTE\(p_PickDataReady\)|OTE\(p_TileUnpickable\)/.test(t), 5, W);
  for (const t of ['HMI_LeadingEdgeOffset', 'HMI_ScaleMmPerPixel', 'LeadingEdgeXMillimeters', 'p_BeltPositionAtTrigger']) x = mustDrop(x, t, W);
  const map = { 'a03_UnloaderConveyor': 'a03_OutfeedBeltAxis', 'q_PickDataReady': 'p_PickDataReady', 'q_ServoPickPosX': 'p_PickXPosition', 'q_UnpickablePart': 'p_TileUnpickable',
    'i_CamXPosition': 'i_LeadingEdgeXPixels', 'i_BeltPresentInImage': 'i_BeltInImage', 'i_Sensor_camerabottom': 'i_TileAtCameraBottom', 'i_Sensor_cameratop': 'i_TileAtCameraTop', 'i_Sensor_cameramiddle': 'i_TileAtCameraMiddle', 'ONS.6': 'ONS.7' };
  x = insertRungs(x, 'R01_Inputs', (t) => /OTE\(CameraTrigger\)/.test(t), [jr(P, 'R01_Inputs', 9, map), jr(P, 'R01_Inputs', 10, map)], W);
  const rungs = [
    newRung('No part in the results when the locate tool returns no X, cleared after the trigger cycle', 'XIC(Status.State[13])EQ(i_LeadingEdgeXPixels,0)ONS(ONS.15)OTL(NoPartsDetected);'),
    ...[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 26].map((n) => jr(P, 'R03_StateLogic', n, map)),
  ];
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(q_CameraGoToRun\)/.test(t), rungs, W);
  x = addTags(x, ['CameraTriggerBeltPos', 'ConveyorDeltaScan', 'ConveyorPrevPos', 'ConveyorTravelTotal', 'DeltaCounts', 'CameraResetFromEncoderValue', 'LengthofPartMM', 'p_ConveyorRollover', 'p_LeadingEdgeStartofBeltmm', 'p_processingLagMS', 'p_SensorFallbackPickX', 'p_SensorFallbackTravel', 'internalServoPickPosX', 'OutfeedcameraXPositionMM', 'NoPartsDetected', 'NoPartsfromSensor', 'NoPartsPresent', 'SensorFallbackFired', 'SensorPartPending', 'SensorTravelSinceTrip', 'SensorTripBeltPos', 'SensorTripONS', 'UnpickablePartONS']
    .map((n) => jtag(P, n)));
  noRef(x, ['LeadingEdgeXMillimeters', 'p_BeltPositionAtTrigger', 'HMI_ScaleMmPerPixel'], W);
  write(prog(W), x);
  log.push('S06  P05 R03 r8-r19/r24/r26 + NoPartsPresent in; 5 rungs and 4 tags of mine out; 23 tags in');
}

// ═════════════════════════════════════════════════════════════════════════
// B3b. S07_OutfeedGantry - P06 tracking (R06) and permissive network
// ═════════════════════════════════════════════════════════════════════════
{
  const P = 'P06_OutfeedServoPNP', W = 'S07_OutfeedGantry';
  let x = read(prog(W));
  const map = { 'a03_UnloaderConveyor': 'a03_OutfeedBeltAxis', 'i_CameraTrigger': '\\S06_OutfeedVision.p_PickDataReady', 'i_PickPositionFromCamera': '\\S06_OutfeedVision.p_PickXPosition',
    'PartGripped': 'TileGripped', 'ZAxisRetractRC': 'ZAxisRetract', 'ZAxisInspectionRC': 'ZAxisGaugePlace', 'ZAxisapproachRangeCheck': 'ZAxisPlaceTransition',
    'I_InspectionPermissive': '\\S08_ThicknessGauge.p_InspectionPermissive', 'i_CartSafeforGantryZMotion': '\\S09_OutfeedCart.p_CartSafeForGantryZMotion',
    'i_analogSensor2': 'i_StackHeight2', 'i_analogSensor': 'i_StackHeight1', 'ONS.11': 'ONS.13', 'Status.State[25]': 'Status.State[22]' };
  // tracking routine, whole. His ServoOverall carries Parameters.Accel / .Decel as scalars; ours are
  // arrays, and an expression cannot take a bare array - r11 failed the Studio import that way.
  const indexAccel = (r) => r.replace(/(HMI_[XZ]Axis\.Parameters\.(?:Accel|Decel))(?![\[\w])/g, '$1[0]');
  x = addRoutine(x, 'R06_ConveyorTracking', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => indexAccel(jr(P, 'R06_ConveyorTracking', n, map))));
  x = insertRungs(x, 'R00_Main', (t) => /JSR\(R05_ZAxisServo/.test(t), [newRung('', 'JSR(R06_ConveyorTracking,0);')], W);
  // my window tracking out
  x = dropRungs(x, 'R01_Inputs', (t) => /OTE\(BeltTravel\)|,BeltTravel\)|CPT\(TrackedTileX/.test(t), 2, W);
  x = editRoutine(x, 'R04_XAxisServo', (rungs) => rungs.map((r) => {
    const t = rungText(r);
    if (/AOI_RangeCheck\(XAxisGearable,/.test(t)) return setRungText(r, t.replace(/ ,AOI_RangeCheck\(XAxisGearable,[^)]*\)/, ''));
    if (/MAG\(iq_XAxis/.test(t)) return setRungText(r, t.replace('XIC(XAxisGearable.InPosWide)', 'XIC(GearableRangeReached)'));
    return r;
  }));
  for (const t of ['BeltTravel', 'TrackedTileX', 'HMI_BeltUnwindLength', 'HMI_GearWindow', 'HMI_PickLeadOffset', 'XAxisGearable']) x = mustDrop(x, t, W);
  x = insertRungs(x, 'R04_XAxisServo', (t) => /AOI_RangeCheck\(XAxisPick,/.test(t), [newRung('Gearable range check on the tracked tile', 'XIC(g_MachineBasic.AlwaysOn)AOI_RangeCheck(XAxisGearableRC,GearTravelTarget,25.4,iq_XAxis.ActualPosition,50);')], W);
  // permissive network
  x = replaceRungText(x, 'R04_XAxisServo', (t) => /OTE\(XAxisPermissive\)/.test(t), rename(jrung(P, 'R04_XAxisServo', 2).t, map), W);
  x = insertRungs(x, 'R04_XAxisServo', (t) => /OTE\(XAxisPermissive\)/.test(t), [3, 4, 5, 6, 7, 21, 24, 25, 26].map((n) => jr(P, 'R04_XAxisServo', n, map)), W);
  x = replaceRungText(x, 'R05_ZAxisServo', (t) => /OTE\(ZAxisPermissive\)/.test(t), rename(jrung(P, 'R05_ZAxisServo', 2).t, map), W);
  x = insertRungs(x, 'R05_ZAxisServo', (t) => /OTE\(ZAxisPermissive\)/.test(t), [26, 27].map((n) => jr(P, 'R05_ZAxisServo', n, map)), W);
  x = dropRungs(x, 'R05_ZAxisServo', (t) => /ADD\(HMI_ZAxis\.Parameters\.Positions\[2\],10,ZAxisSafePosition\)/.test(t), 1, W);
  // my ungear rung tested Z against a belt-safe height of my own; Justin's test for the same thing is ZAboveBelt
  x = editRoutine(x, 'R04_XAxisServo', (rungs) => rungs.map((r) => { const t = rungText(r); return /MAS\(iq_XAxis,XAxis_MAS_Gear,Gear/.test(t) ? setRungText(r, t.replace('LE(HMI_ZAxis.Status.ActualPosition,ZAxisBeltSafePosition)', 'XIC(ZAboveBelt)')) : r; }));
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(p_CartFull\)/.test(t), [jr(P, 'R03_StateLogic', 22, map)], W);
  x = insertRungs(x, 'R01_Inputs', (t) => /OTE\(TileGripped\)/.test(t), [29, 30, 31, 32, 33].map((n) => jr(P, 'R01_Inputs', n, map)), W);
  for (const t of ['ZAxisSafePosition', 'ZAxisBeltSafePosition']) if (hasTag(x, t)) x = mustDrop(x, t, W);
  const tagsLocal = ['XEndofBeltPosition', 'XPlacePosition', 'XOverTablePosition', 'XStartofInspectionPosition', 'XStartofSensorPosition', 'XEndofGearing', 'ZAxis_BeltreferencePos', 'ZBeltSetpoint1', 'ZAxisInspectionRCUpperLim', 'ZAxisInspectionRCLowerLim', 'XpastBelt_Pos', 'XpastCart_Pos', 'HMIZPickOffset', 'StackHeightCalculation', 'StackHeightCalculation2', 'StackHeightSensorSum', 'StackHeightSensorAvg', 'oldSensorValue', 'oldSensorValue2', 'SensorZPlacePosition', 'SensorZoffsetPosition', 'ZAboveBelt', 'ZAxisAboveStackHeight', 'XPastBelt', 'XPastCart', 'XABSCommandFWD', 'XABSCommandREV', 'xABSCommandZero', 'AbsoluteMoveNextPosition', 'XCommandFWD', 'XCommandREV', 'xCommandZero', 'XAxisclearForward', 'XAxisclearReverse', 'XmotionerrorFWD', 'XMotionErrorRev', 'LaserDistanceRangeCheck', 'LaserDistanceFirstinStackRangeCheck',
    'XAxisGearableRC', 'GearTravelTarget', 'GearableRangeReached', 'PartGrippedONS', 'RolloverPopONS', 'ReturnGearCaptureONS', 'r_Zero', 'StoredConveyorPositions', 'ConveyorStoredPickQueue', 'StoredCameraPicks', 'CameraStoredPickQueue', 'LastPickPosition', 'LastCameraPick', 'PickQueue_Delta', 'PickQueue_AdjustedPos', 'Gantry_Distance_Remaining', 'Expected_Pick_Position', 'Time_To_Arrive', 'p_BeltToGantryScale', 'PickQueue_Full', 'p_Centerline_toBelt', 'p_Distancetocenterof_part', 'p_processingLag', 'ReturnPickGearEngagePos', 'ReturnPickGearReady', 'p_ReturnPickGearLead', 'ReturnPickDistToGo', 'RampTimeLoss', 'p_ReturnPickMarginFactor', 'ReturnPickTarget', 'p_ReturnPickMaxX', 'ConveyorDeltaScan', 'ConveyorPrevPos', 'p_ConveyorRollover'];
  x = addTags(x, tagsLocal.map((n) => jtag(P, n)));
  noRef(x, ['TrackedTileX', 'BeltTravel', 'XAxisGearable', 'ZAxisSafePosition', 'ZAxisBeltSafePosition', 'p_BeltPositionAtTrigger'], W);
  write(prog(W), x);
  // p_HMIGearingOffset was controller-scope in his file
  const cf = path.join(CTRL, 'ControllerTags.xml'); let c = read(cf);
  if (!hasTag(c, 'p_HMIGearingOffset')) { c = c.replace(/<\/Tags>\s*$/, jctrlTag('p_HMIGearingOffset') + '\n</Tags>\n'); write(cf, c); }
  log.push('S07  P06 R06_ConveyorTracking whole (12 rungs) + X/Z permissive network (18 rungs) + laser stack height in; window tracking out; 76 tags in; gearing gates on GearableRangeReached');
}

// ═════════════════════════════════════════════════════════════════════════
// B4. S01 / S09 / S08 - what the transplants read
// ═════════════════════════════════════════════════════════════════════════
{
  const W = 'S01_InfeedCart'; let x = read(prog(W));
  // the camera now hands an absolute cart-Y target: align to it, the way P01 did
  x = replaceRungText(x, 'R02_StateTransitions', (t) => /MOVE\(43,Control\.StateReg\)/.test(t), 'XIC(Status.State[40])XIC(\\S02_InfeedVision.p_PickDataReady)XIO(YAxisAlign.InPos)XIC(SS_OK)MOVE(43,Control.StateReg);', W);
  x = editRoutine(x, 'R02_StateTransitions', (rungs) => rungs.map((r) => { const t = rungText(r); return /MOVE\(46,Control\.StateReg\)/.test(t) ? setRungText(r, t.replace('EQ(\\S02_InfeedVision.p_CartYOffset,0.0)', 'XIC(YAxisAlign.InPos)')) : r; }));
  x = replaceRungText(x, 'R04_YAxisServo', (t) => /,YAxisAlignTarget\)/.test(t) && /ONS\(ONS\.23\)/.test(t), 'MOVE(\\S02_InfeedVision.p_CartYPickPosition,YAxisAlignTarget);', W);
  x = editRoutine(x, 'R04_YAxisServo', (rungs) => rungs.map((r) => (/MOVE\(\\S02_InfeedVision\.p_CartYPickPosition,YAxisAlignTarget\)/.test(rungText(r)) ? r.replace(/<!\[CDATA\[Align target[^\]]*\]\]>/, '<![CDATA[Align target is the cart Y position from the camera]]>') : r)));
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(p_CartClear\)/.test(t), [
    newRung('Cart is safe for gantry Z motion when both lifts are lowered or the cart axis is still', '[XIC(EntryGripperLiftLowered) XIC(MiddleGripperLiftLowered) ,LT(HMI_YAxis.Status.ActualVelocity,2) GT(HMI_YAxis.Status.ActualVelocity,-2) ]OTE(p_CartSafeForGantryZMotion);'),
    newRung('Cart Y pick position for the vision station', 'MOVE(HMI_YAxis.Parameters.Positions[2],p_YPickPositionForCamera);'),
  ], W);
  x = addTags(x, [newTag('p_CartSafeForGantryZMotion', 'BOOL', 'Public'), newTag('p_YPickPositionForCamera', 'DINT', 'Public')]);
  noRef(x, ['p_CartYOffset'], W);
  write(prog(W), x);
  log.push('S01  aligns to the camera\'s absolute cart-Y target (P01 form); publishes p_CartSafeForGantryZMotion, p_YPickPositionForCamera');
}
{
  const W = 'S09_OutfeedCart'; let x = read(prog(W));
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(p_CartClear\)/.test(t), [newRung('Cart is safe for gantry Z motion when both lifts are lowered or the cart axis is still', '[XIC(EntryGripperLiftLowered) XIC(MiddleGripperLiftLowered) ,LT(HMI_YAxis.Status.ActualVelocity,2) GT(HMI_YAxis.Status.ActualVelocity,-2) ]OTE(p_CartSafeForGantryZMotion);')], W);
  x = addTags(x, [newTag('p_CartSafeForGantryZMotion', 'BOOL', 'Public')]);
  write(prog(W), x);
  log.push('S09  publishes p_CartSafeForGantryZMotion (P08 form)');
}
{
  const W = 'S08_ThicknessGauge'; let x = read(prog(W));
  for (const t of ['Probe4CarriageRetracted', 'q_RaiseProbe1', 'q_RaiseProbe4']) if (!hasTag(x, t)) fail(W + ': expected tag ' + t);
  x = insertRungs(x, 'R03_StateLogic', (t) => /OTE\(p_GaugeClear\)/.test(t), [newRung('Gantry may enter the gauge zone while the carriage is retracted and every probe is raised', 'XIC(Probe4CarriageRetracted)XIC(q_RaiseProbe1)XIC(q_RaiseProbe2)XIC(q_RaiseProbe3)XIC(q_RaiseProbe4)OTE(p_InspectionPermissive);')], W);
  x = addTags(x, [newTag('p_InspectionPermissive', 'BOOL', 'Public')]);
  write(prog(W), x);
  log.push('S08  publishes p_InspectionPermissive (P09 r26 form)');
}

// tidy-up: the v0.4 split created EitherHalfRunning with L5K data only
{
  const f = prog('Supervisor_Loader'); let x = read(f);
  const m = /<Tag Name="EitherHalfRunning"[^>]*>[\s\S]*?<\/Tag>/.exec(x);
  if (m && !/Format="Decorated"/.test(m[0])) { x = x.replace(m[0], m[0].replace(/<\/Tag>$/, decorated('BOOL') + '</Tag>')); write(f, x); log.push('Supervisor_Loader  EitherHalfRunning given its Decorated data'); }
}

console.log('1131 v0.5 part B\n');
for (const l of log) console.log('  ' + l);
