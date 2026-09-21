/**
 * promptBuilder.js — assembles the JARVIS v1.0.1 edit-plan request.
 *
 * v1.0.1 architecture: the model does NOT write L5X and does NOT receive the
 * full template. The merge engine owns the template bytes; the model receives
 * only what it must author against:
 *   1. Generation rules (generationRules.md — the law)
 *   2. The edit-plan schema + a worked example (the real V4.2 manual surgery)
 *   3. Template notes + targeted EXTRACTS of the selected template:
 *      routine rung listings (R00/R01/R02/R03/R20 full; servo routines
 *      filtered to state-referencing rungs), the program tag list, string
 *      data (alarm/status messages), and the Status.STATE[n] comments
 *   4. The state machine's Intermediate Representation (ir.js) with final
 *      state numbers assigned
 *
 * Prompt-caching layout: everything except the IR is stable per template, so
 * the caller places a cache_control breakpoint after the stable block and
 * appends the per-job IR after it (see client.js).
 *
 * CommonJS, plain Node — no Anthropic dependency here.
 */

const fs = require('fs');
const path = require('path');

const { PLAN_SCHEMA_DOC } = require('./editPlanSchema');
const { buildIR } = require('./ir');
const { loadConcepts, SUPREME_LAW } = require('./meKnowledge');
const { renderPatternInventory } = require('./templatePatterns');

const ROOT = path.join(__dirname, '..', '..', '..'); // -> repo root
const RULES_PATH = path.join(__dirname, 'generationRules.md');
const STANDARD_DIR = path.join(ROOT, 'plc-reference', 'standard');

/** Template selection, keyed on station character. */
const TEMPLATES = {
  servoPNP: { template: 'S05_ServoPNP.L5X', reason: 'servo axes present' },
  indexerSP: { template: 'S00_IndexerSP.L5X', reason: 'indexer device with shot pin' },
  indexerNoSP: { template: 'S00_IndexerNoSP.L5X', reason: 'indexer device without shot pin' },
  pneumatic: { template: 'S01_PartLoad.L5X', reason: 'pneumatic-only station' },
};

function isIndexerDevice(d) {
  const hay = `${d?.name || ''} ${d?.displayName || ''} ${d?.type || ''}`;
  return /index/i.test(hay);
}

function hasShotPin(sm) {
  const hay = (sm.devices || [])
    .map(d => `${d?.name || ''} ${d?.displayName || ''}`)
    .join(' ');
  return /shot\s*pin|shotpin/i.test(hay);
}

function selectTemplate(sm) {
  const devices = sm.devices || [];
  const isIndexOp = a => a && /servoindex|index/i.test(a.operation || '');
  const hasIndexer =
    devices.some(isIndexerDevice) ||
    (sm.nodes || []).some(n => (n.data?.actions || []).some(isIndexOp));
  if (hasIndexer) return hasShotPin(sm) ? TEMPLATES.indexerSP : TEMPLATES.indexerNoSP;

  const hasServo = devices.some(d => d?.type === 'ServoAxis' || d?.type === 'Servo');
  if (hasServo) return TEMPLATES.servoPNP;

  return TEMPLATES.pneumatic;
}

/** Count `## Rule N` headings so callers can report the rule count. */
function countRules(rulesText) {
  return (rulesText.match(/^## Rule \d+/gm) || []).length;
}

// ── Template extraction ──────────────────────────────────────────────────────

function targetProgramSlice(xml) {
  const m = /<Program Use="Target"[^>]*>/.exec(xml);
  if (!m) throw new Error('Template has no <Program Use="Target">');
  const end = xml.indexOf('</Program>', m.index);
  return xml.slice(m.index, end);
}

function extractRoutineRungs(progXml, routineName) {
  const rm = new RegExp(`<Routine Name="${routineName}"[^>]*>`).exec(progXml); // routine names are [A-Za-z0-9_]
  if (!rm) return null;
  const end = progXml.indexOf('</Routine>', rm.index);
  const section = progXml.slice(rm.index, end);
  const rungs = [];
  const re = /<Rung\b[^>]*>([\s\S]*?)<\/Rung>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const body = m[1];
    const cm = /<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/.exec(body);
    const tm = /<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/.exec(body);
    rungs.push({ comment: cm ? cm[1].trim() : null, text: tm ? tm[1].trim() : '' });
  }
  return rungs;
}

function listRoutineNames(progXml) {
  return [...progXml.matchAll(/<Routine Name="([^"]+)" Type="RLL"/g)].map(m => m[1]);
}

function renderRungs(name, rungs, filter) {
  const lines = [`### Routine ${name}${filter ? ' (state-referencing rungs only)' : ''}`];
  rungs.forEach((r, i) => {
    if (filter && !filter(r)) return;
    if (r.comment) lines.push(`rung ${i} // ${r.comment.replace(/\r?\n/g, ' | ')}`);
    else lines.push(`rung ${i}`);
    lines.push(`  ${r.text}`);
  });
  return lines.join('\n');
}

function extractTagList(progXml) {
  const tagsStart = progXml.indexOf('<Tags>');
  const tagsEnd = progXml.indexOf('</Tags>', tagsStart);
  const section = progXml.slice(tagsStart, tagsEnd);
  const out = [];
  const re = /<Tag Name="([^"]+)"[^>]*?DataType="([^"]+)"[^>]*?(?:Usage="([^"]+)")?[^>]*?(\/>|>)/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    out.push(`- ${m[1]} : ${m[2]}${m[3] ? ` (${m[3]})` : ''}`);
  }
  return out.join('\n');
}

/** Decoded quote-framed string values per tag (alarm/status message data). */
function extractStringData(progXml) {
  const lines = [];
  const tagRe = /<Tag Name="([^"]+)"[^>]*?>([\s\S]*?)<\/Tag>/g;
  let tm;
  while ((tm = tagRe.exec(progXml)) !== null) {
    const [, name, body] = tm;
    const texts = [];
    const sre = /<!\[CDATA\['((?:\$.|[^'$])*)'\]\]>/g;
    let sm;
    while ((sm = sre.exec(body)) !== null) {
      const t = sm[1].replace(/\$00/g, '').replace(/\$\$/g, '$').replace(/\$'/g, "'");
      if (t !== '') texts.push(t);
    }
    const unique = [...new Set(texts)];
    if (unique.length) {
      lines.push(`Tag ${name}:`);
      for (const t of unique) lines.push(`  "${t}"`);
    }
  }
  return lines.join('\n');
}

function extractStateComments(progXml) {
  const out = [];
  const re = /<Comment Operand="(\.STATE\[\d+\])">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(progXml)) !== null) out.push(`- Status${m[1]}: ${m[2].trim().replace(/\r?\n/g, ' | ')}`);
  return out.join('\n');
}

function extractContextInfo(xml) {
  const programs = [...xml.matchAll(/<Program Use="Context" Name="([^"]+)"/g)].map(m => m[1]);
  // Controller-scope tags = <Tags> before <Programs>
  const progsIdx = xml.indexOf('<Programs');
  const head = xml.slice(0, progsIdx === -1 ? xml.length : progsIdx);
  const ctlTags = [...head.matchAll(/<Tag Name="([^"]+)"/g)].map(m => m[1]);
  const aois = [...xml.matchAll(/<AddOnInstructionDefinition\b[^>]*\bName="([^"]+)"/g)].map(m => m[1]);
  return { programs, ctlTags, aois };
}

const STATE_RUNG_FILTER = r =>
  /Status\.State\[|AOI_RangeCheck|MAM\(|Control\.FaultTime/.test(r.text);

const CORE_ROUTINES = ['R00_Main', 'R01_Inputs', 'R02_StateTransitions', 'R03_StateLogic', 'R20_Alarms'];

function buildTemplateExtracts(templateXml) {
  const prog = targetProgramSlice(templateXml);
  const routineNames = listRoutineNames(prog);
  const parts = [];

  for (const name of routineNames) {
    const rungs = extractRoutineRungs(prog, name);
    if (!rungs) continue;
    const core = CORE_ROUTINES.includes(name);
    parts.push(renderRungs(name, rungs, core ? null : STATE_RUNG_FILTER));
  }

  parts.push('### Target program tags (name : type)', extractTagList(prog));
  const strings = extractStringData(prog);
  if (strings) parts.push('### String data (alarm / HMI status message texts — use these EXACT texts as setStringData oldText)', strings);
  const stateComments = extractStateComments(prog);
  if (stateComments) parts.push('### Status.STATE[n] comments (edit with setTagComment)', stateComments);

  return parts.join('\n\n');
}

// ── Template notes (condensed pattern summaries) ─────────────────────────────

const COMMON_NOTES = `
- READABILITY IS PART OF THE STANDARD (confirmed by Jason on the 1160 build,
  2026-09-18: "much easier to read"): every rung comment is ONE concise
  sentence about the machine; every tag description is at most 30
  characters; comments never carry build history, sources, dates, names,
  question numbers or "STUB"/"DECLARED EXTENSION" — a placeholder is the
  AlwaysOff form on a real rung. A program stays the size of its closest
  example (tags, rungs, latches); no feature, timer, interlock, bypass
  constant or HMI setpoint the examples do not have. Same look and feel on
  every station.
- States 0-3 (E-stop / Manual / Idle-NotReady / Idle-Ready), 99 (lockout),
  100-124 (init block), 127 (faulted) are template law: keep their rungs,
  only retarget the position/sensor conditions inside them where the
  flowchart renames positions.
- R02 idiom: one rung per destination state,
  XIC(Status.State[current]) <conditions> XIC(SS_OK) MOVE(dest,Control.StateReg);
  The "state 3 ready" and "state 4 first-step" rungs also fold in the
  init-complete (124) and cycle-restart paths — preserve that structure.
- Part tracking: OTL(...Attempt) on the SAME rung as the MOVE where the
  station commits to the part; OTL(...Success) where its work is confirmed.
- Alarm rungs (R20): one rung per waiting-condition,
  [[state refs] MOVE(t,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[i].Active) XIO(FaultReset) ][OTE(Alarm[i].Active) ,ONS(ONS.x) CONCAT(g_StationList[StaNum],AlarmList[i],Alarm[i].Message) ];
  Message text lives in AlarmList[i] — edit with setStringData.
- Unknown external conditions (index complete, part present from upstream):
  emit [XIC(g_MachineBasic.AlwaysOff) ,XIC(DryRun) ] plus a rung comment
  beginning with *Replace (never guess a real signal).
- Do NOT set servo speed/accel/position VALUES (HMI_*.Parameters.* numbers) —
  the controls engineer tunes them post-export; template zeros are intentional.
  The staging STRUCTURE (which Positions[i]/AutoSpeed[i] slot each state
  loads) is program logic and MUST implement the spec: a move the spec calls
  fast-then-slow stages two segments with two AutoSpeed indices.
- Instruction mnemonics: use EXACTLY the mnemonic family the template extracts
  use (V4.2/v37 exports use EQ/NE/LT/GT/GE/LE) — never substitute the
  EQU/NEQ/LES/GRT/GEQ/LEQ spellings or vice versa; they import differently.
- STRUCTURAL FIDELITY (two altitudes): sequence LOGIC is where your reasoning
  is the product — think freely. Rung EXPRESSION speaks SDC: trigger shapes,
  rung ordering, staging structure, routine layout use the template family's
  vocabulary. Lookup hierarchy: (1) template family shows the construct — use
  its shape, period; (2) constructs from real SDC code fill remaining gaps;
  (3) only when neither shows it, build in SDC's idiom and flag it as
  "PROPOSED NON-STANDARD PATTERN: …" for CE review — never ship an invented
  shape silently as standard.
- R02 RUNG ORDER LAW: sequence-state MOVE rungs appear in ASCENDING state-
  number order (synthesized/side-path states sit at their numeric position,
  like the indexer's 31/34/37 recovery states — never interleaved by flow,
  never appended at the end), followed by the override block in template
  order: lockout 99, init 100→124 ascending, restart logic, fault 127,
  manual 1, safety 0, State_Engine call, cycle timer. Last write to
  Control.StateReg wins the scan. Splice every new sequence rung at its
  numeric position.
- MOTION TRIGGER LAW: each axis keeps ONE auto MAM, inside the template's
  single "Axis Motion Command" rung — manual branch (Status.State[1] +
  {Axis}ManMoveTrig) OR'd with a plain XIC(Status.State[n]) list of the auto
  move states, gated by ServoActionStatus + AxisHomedStatus + {Axis}Permissive.
  NEVER per-state ONS trigger rungs, OTL/OTU move-trigger latches, sub-step
  counters, or StateChanged droppers. MAM only fires on rung false→true and
  state bits swap atomically, so two CONSECUTIVE states in one axis's list
  means the second move never executes: back-to-back DISTINCT moves on one
  axis use the indexer's trigger/wait split — the move state (in the list)
  exits to a wait/confirm state (NOT in the list), then the next move state.
  Fast/slow segments of ONE stroke are NOT two moves — ONE MAM to the final
  target plus the axis's "Use MCD For Speed Changes" rung keyed on the
  speed-change segment states, which are NOT in the MAM list (Jason
  2026-08-25). Position and speed-profile staging live as parallel branches
  in the ONE Auto Mode staging rung per axis — never as separate
  speed-profile rungs.`;

const TEMPLATE_NOTES = {
  'S05_ServoPNP.L5X': `
Two servo axes (X horizontal, Z vertical) + a 2-solenoid gripper, one
pick-place U per cycle on a dial: pick at X-retract, place at X-extend.
Every state number, tag name and rung shape below is READ FROM THE TEMPLATE —
retarget them, do not invent a different shape.

- TEMPLATE SEQUENCE (R02_StateTransitions, as shipped):
    4  wait for part present        22  extend X (travel to place)
    7  Z down to pick (fast)        25  wait for index complete
   10  Z slow-down anchor           28  Z down to place (fast)
   13  close gripper                31  Z slow-down anchor
   16  Z up off pick (slow)         34  open gripper
   19  Z speed-up anchor            37  Z up off place (slow)
                                    40  Z speed-up anchor
                                    43  retract X (travel to pick) -> 3 / 4
  Init: 100 (Z to retract) splits on the gripper — GripperOpened -> 103
  (empty return, X retract), GripperClosed -> 106 (carrying, X extend) —
  both -> 124 -> 127. Keep the split; a station that can hold a part through
  a fault needs both postures.

- NAMED POSITIONS — one AOI_RangeCheck instance per position, all five in the
  axis routines' RangeCheck call rung:
  AOI_RangeCheck(XAxisExtend,HMI_XAxis.Parameters.Positions[0],0.5,HMI_XAxis.Status.ActualPosition,5)
  AOI_RangeCheck(XAxisRetract,HMI_XAxis.Parameters.Positions[1],0.5,HMI_XAxis.Status.ActualPosition,5)
  AOI_RangeCheck(ZAxisPick,HMI_ZAxis.Parameters.Positions[0],0.5,HMI_ZAxis.Status.ActualPosition,10)
  AOI_RangeCheck(ZAxisPlace,HMI_ZAxis.Parameters.Positions[1],0.5,HMI_ZAxis.Status.ActualPosition,10)
  AOI_RangeCheck(ZAxisRetract,HMI_ZAxis.Parameters.Positions[2],0.5,HMI_ZAxis.Status.ActualPosition,10)
  Signature: (backing tag, commanded position, tight deadband, actual
  position, WIDE deadband) -> .InPos (tight) and .InPosWide (wide).
  renameTag the backing tags to the flowchart's position names (e.g.
  ZAxisPick -> ZAxisLoad); the Positions[i] index in this rung is what binds a
  name to an HMI position slot — keep indices stable, never reshuffle.
  The wide deadband is a LITERAL ARGUMENT here (5 on X, 10 on Z in the
  template) — it is the ONLY blend window this template has. A blend distance
  carried on the spec sheet for a position lands in THIS argument.

- ONE MAM PER AXIS. The "Axis Motion Command" rung holds a plain
  XIC(Status.State[n]) list of the auto move states:
    X (R04): 22, 43, 103, 106      Z (R05): 7, 16, 28, 37, 100
  The anchor states (10/19/31/40) are NOT in the list and never will be — they
  are speed changes inside a move that is already running. Retarget the lists
  with updateRung; never add a second MAM, never add a per-state trigger rung.

- AUTO STAGING RUNG (one per axis) stages position AND profile as parallel
  branches keyed on the MAM states. Z stages the fast profile (AutoSpeed[0])
  for the approach states 7/28/100 and the slow profile (AutoSpeed[1]) for the
  retreat states 16/37, with the DisableZSpeedTransition override folded into
  the same branch:
  XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,ZAxisMotionParameters.MoveType) ,[[XIC(Status.State[7]) ,XIC(Status.State[28]) ,XIC(Status.State[100]) ] ,[XIC(Status.State[16]) ,XIC(Status.State[37]) ] XIC(DisableZSpeedTransition) ] [MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMotionParameters.Decel) ] ,[XIC(Status.State[16]) ,XIC(Status.State[37]) ] XIO(DisableZSpeedTransition) [MOVE(HMI_ZAxis.Parameters.AutoSpeed[1],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[1],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[1],ZAxisMotionParameters.Decel) ] ,XIC(Status.State[7]) MOVE(HMI_ZAxis.Parameters.Positions[0],ZAxisMotionParameters.Position) ,XIC(Status.State[28]) MOVE(HMI_ZAxis.Parameters.Positions[1],ZAxisMotionParameters.Position) ,[XIC(Status.State[16]) ,XIC(Status.State[37]) ,XIC(Status.State[100]) ] MOVE(HMI_ZAxis.Parameters.Positions[2],ZAxisMotionParameters.Position) ];
  X stages one profile for all its states — the horizontal axis has no speed
  transition (no XAxisMCD* tags exist in the template).

- SPEED CHANGE = MCD, NEVER A SECOND MAM. The Z axis has ONE "Use MCD For
  Speed Changes" rung, keyed on the anchor states, with its own control tag
  (ZAxis_MCD) and its own staging tags (ZAxisMCDSpeed / ZAxisMCDAccel /
  ZAxisMCDDecel — never stage a speed change into
  {Axis}MotionParameters.Speed, that one belongs to the MAM):
  [[XIC(Status.State[10]) ,XIC(Status.State[31]) ] [MOVE(HMI_ZAxis.Parameters.AutoSpeed[1],ZAxisMCDSpeed) ,MOVE(HMI_ZAxis.Parameters.Accel[1],ZAxisMCDAccel) ,MOVE(HMI_ZAxis.Parameters.Decel[1],ZAxisMCDDecel) ] ,[XIC(Status.State[19]) ,XIC(Status.State[40]) ] [MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMCDSpeed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMCDAccel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMCDDecel) ] ]MCD(iq_ZAxis,ZAxis_MCD,Move,Yes,ZAxisMCDSpeed,Yes,ZAxisMCDAccel,Yes,ZAxisMCDDecel,No,0,No,0,Units per sec,Units per sec2,Units per sec2,Units per sec3);
  10/31 slow the move down on approach; 19/40 speed it back up on retreat.

- THE ANCHOR PAIR — this is the whole R02 pattern for a speed-changing move.
  Command state -> anchor state, mid-flight, on the wide window of the
  position the move is working around:
    XIC(Status.State[7])XIO(DisableZSpeedTransition)XIC(ZAxis_MAM.IP)XIC(ZAxisPick.InPosWide)XIC(SS_OK)MOVE(10,Control.StateReg);
  and the NEXT state accepts EITHER the command state or the anchor state, on
  the strict in-position:
    [XIC(Status.State[7]) ,XIC(Status.State[10]) ]XIC(ZAxis_MAM.PC)XIC(ZAxisPick.InPos)XIC(SS_OK)MOVE(13,Control.StateReg);
  That OR is what makes the anchor OPTIONAL — it is how the disable constant
  works without deleting rungs. Every rung downstream of an anchor must carry
  it.

- CORNER ROUNDING (travel-to-travel only). The transition out of a travel move
  ORs the strict test with a wideband test so the other axis starts before the
  move finishes:
    [XIC(ZAxis_MAM.PC) XIC(ZAxisRetract.InPos) ,XIO(DisableCornerRounding) XIC(ZAxis_MAM.IP) XIC(ZAxisRetract.InPosWide) ]
  In the template this appears on exactly four corners: 43->4 and 22->25 (X),
  16/19->22 and 37/40->43 (Z). Grips, releases and process actions are ALWAYS
  strict XIC({Axis}_MAM.PC) XIC({Pos}.InPos) — see states 13 and 34.

- THE TWO CONSTANTS — DIFFERENT JOBS, NOT A PAIR. Both are declared
  Usage="Input" Constant="true", DataType DINT, default 0, decoded in R01
  rungs 1-2:
    EQ(i_DisableCornerRounding,1)OTE(DisableCornerRounding);
    EQ(i_DisableZSpeedTransition,1)OTE(DisableZSpeedTransition);
  i_ plus Constant="true" is the SDC device for "the engineer must decide
  this" — it stands out as an unwired input parameter so it cannot be
  overlooked. Carry both into every generated servo PNP, defaulted 0.
    * DisableCornerRounding gates ONLY the wideband branch of the four corner
      rungs, both axes. Set to 1 and every corner waits for strict
      in-position. Changes no state numbers.
    * DisableZSpeedTransition gates the four anchor-entry rungs (10/19/31/40
      are then never entered) AND flips the retreat states 16/37 to the fast
      profile in the R05 staging rung. Z only.
  Never delete the anchor states or the wideband branches to "simplify" —
  these constants are the supported off switch.

- NEVER EMIT: PickRetractBlend, PlaceRetractBlend, {Level}WideBand,
  {Pos}TransitionWideBand, {Pos}TransitionRangeCheck. Those are spec-sheet row
  names from an older scheme, not PLC tags, and none of them appear in this
  template. The blend window is the AOI_RangeCheck wide-deadband argument; the
  transition point is an anchor state, not a position.

- Gripper command rungs in R03 use the latch/seal idiom keyed to the close and
  open state numbers (13 / 34), with the manual branch OR'd in on
  Status.State[1] + HMI_Momentary.0/.1. R01 derives GripperOpened /
  GripperClosed from the commanded solenoid plus its delay timer — a
  sensorless gripper tracks by commanded state.
- q_ActuatorsSafe (R03 "Actuators Safe For Index") is built from CLEARANCE,
  not motion state (Jason 2026-09-17): one PARALLEL branch per axis that can
  by itself take the head out of the dial's path, OR'd together, each branch
  proving that axis homed, at its clearing position and not at any working
  position:
    [XIC(iq_XAxis.AxisHomedStatus) XIC(XAxisRetract.InPos) XIO(XAxisExtend.InPos) ,XIC(iq_ZAxis.AxisHomedStatus) XIC(ZAxisRetract.InPos) XIO(ZAxisPick.InPos) XIO(ZAxisPlace.InPos) ]OTE(q_ActuatorsSafe)
  X retracted is away from the indexer, so Z may sit anywhere. Never AND every
  axis's home/retract bit — that is stricter than the standard and stalls a
  dial that is free to turn. Retarget the position tags; keep the OR shape.
- Part tracking: Attempt latches with the move into place (state 28), Success
  with the retreat after release (state 37), both gated
  XIO(SingleDisableTracking). Lockout latches in R03 on state 99.${COMMON_NOTES}`,
  'S01_PartLoad.L5X': `
Pneumatic-only PNP: X axis cylinder (2 sensors), Z axis cylinder (retract
sensor only + ZAxisExtendedDelay timer), sensorless gripper (Open/Close delay
timers), PartPresent digital sensor (AOI_Debounce).
- Solenoid command rungs in R03 use the latch/seal idiom keyed to state
  numbers (q_ExtendXAxis / q_RetractXAxis / q_ExtendZAxis / q_RetractZAxis /
  q_CloseGripper / q_OpenGripper).
- Sensor conditioning in R01 derives XAxisExtended/... bits; sensorless
  motions confirm via delay timers (TON) instead of sensors.
- Add tags (addTag) + R01 conditioning + R03 command rungs (spliceRungs) for
  devices the template does not have; keep the template naming style
  (q_Extend{Name}, i_{Name}Extended, {Name}ExtendDelay).${COMMON_NOTES}`,
  'S00_IndexerSP.L5X': `
Dial indexer with shot pin. Index cycle = shot pin retract -> servo index ->
shot pin extend; q_WaitStationsComplete gates the stations.${COMMON_NOTES}`,
  'S00_IndexerNoSP.L5X': `
Dial indexer without shot pin.${COMMON_NOTES}`,
};

// ── Worked example (from the real V4.2 manual surgery) ──────────────────────

const WORKED_EXAMPLE = `
# WORKED EXAMPLE (real surgery: S05_ServoPNP template -> S01 Servo PNP station)
The flowchart was: wait for index complete -> Z to pick -> close gripper ->
Z to clear -> X to place -> Z to place -> open gripper -> Z to clear ->
X to pick -> cycle complete. Positions renamed Extend/Retract -> Place/Pick/Clear.
An abbreviated (illustrative, not complete) plan:

{
  "programName": "S01_ServoPNP",
  "operations": [
    {"op":"renameTag","from":"XAxisExtend","to":"XAxisPlace"},
    {"op":"renameTag","from":"XAxisRetract","to":"XAxisPick"},
    {"op":"renameTag","from":"ZAxisRetract","to":"ZAxisClear"},
    {"op":"updateRung","routine":"R02_StateTransitions","match":"MOVE(7,Control.StateReg)",
     "newComment":"State 7: Move z axis to pick position\\n\\n*Replace AlwaysOff bit with the real index-complete / part-ready signal.",
     "newText":"XIC(Status.State[4])[XIC(g_MachineBasic.AlwaysOff) ,XIC(DryRun) ]XIC(SS_OK)MOVE(7,Control.StateReg);"},
    {"op":"updateRung","routine":"R02_StateTransitions","match":"MOVE(13,Control.StateReg)",
     "newComment":"State 13: Move z axis to clear position\\n\\nPick confirmed complete - latch part tracking Attempt for this station",
     "newText":"[XIC(Status.State[10]) ,XIC(Status.State[2]) XIO(Initialized) XIC(PartStarted) XIC(CycleRunning) ]XIC(GripperClosed)XIC(SS_OK)MOVE(13,Control.StateReg)OTL(\\\\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt);"},
    {"op":"updateRung","routine":"R05_ZAxisServo","match":"MOVE(HMI_ZAxis.Parameters.Positions[0],ZAxisMotionParameters.Position)",
     "newText":"XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,ZAxisMotionParameters.MoveType) ,MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMotionParameters.Decel) ,XIC(Status.State[7]) MOVE(HMI_ZAxis.Parameters.Positions[1],ZAxisMotionParameters.Position) ,XIC(Status.State[19]) MOVE(HMI_ZAxis.Parameters.Positions[2],ZAxisMotionParameters.Position) ,[XIC(Status.State[13]) ,XIC(Status.State[25]) ,XIC(Status.State[100]) ] MOVE(HMI_ZAxis.Parameters.Positions[0],ZAxisMotionParameters.Position) ];"},
    {"op":"setStringData","tag":"AlarmList","oldText":"Waiting For Part Present","newText":"Waiting For Index Complete"},
    {"op":"setTagData","tag":"CloseGripperDelay","member":"PRE","value":250,"oldValue":100},
    {"op":"setTagComment","tag":"Status","operand":".STATE[7]","text":"Move Z Axis To Pick Position"},
    {"op":"addTag","name":"p_PartGripped","dataType":"BOOL",
     "description":"SM Output Signal: Part_Gripped - ON while a part is held"},
    {"op":"spliceRungs","routine":"R03_StateLogic","after":"OTE(q_OpenGripper)",
     "insert":[{"comment":"SM Output Signal: Part_Gripped - ON while a part is held",
                "text":"[XIC(Status.State[13]) ,XIC(p_PartGripped) XIO(Status.State[25]) ]OTE(p_PartGripped);"}]},
    {"op":"spliceRungs","routine":"R20_Alarms","after":"AlarmList[5]",
     "insert":[{"comment":"Waiting For Gripper To Close",
                "text":"[XIC(Status.State[10]) MOVE(2000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[6].Active) XIO(FaultReset) ][OTE(Alarm[6].Active) ,ONS(ONS.15) CONCAT(g_StationList[StaNum],AlarmList[6],Alarm[6].Message) ];"},
               {"comment":"Waiting For Gripper To Open",
                "text":"[XIC(Status.State[22]) MOVE(2000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[7].Active) XIO(FaultReset) ][OTE(Alarm[7].Active) ,ONS(ONS.16) CONCAT(g_StationList[StaNum],AlarmList[7],Alarm[7].Message) ];"}]}
  ]
}`.trim();

// ── Entry point ──────────────────────────────────────────────────────────────

/** True when this SM carries an engineer-APPROVED compiled sequence (JARVIS
 *  v1.1 pipeline inversion) — generation then runs in TRANSLATION mode. */
function hasApprovedCompiledSequence(sm) {
  return Boolean(sm && sm.compiledSequence &&
    sm.compiledSequence.approved === true &&
    sm.compiledSequence.ir && sm.compiledSequence.ir.text);
}

/**
 * Build the edit-plan prompt for one state machine of a project.
 *
 * Two modes (meta.mode):
 *   'authoring'   — the model designs the station's logic from the diagram IR
 *                   (the original v1.0.x pipeline; unchanged byte-for-byte).
 *   'translation' — the SM carries an APPROVED compiled sequence
 *                   (sm.compiledSequence.approved === true): the thinking
 *                   already happened at Build time, was reviewed by the
 *                   engineer, and Generate is near-mechanical translation of
 *                   that sequence into the edit plan. The stable (cacheable)
 *                   prefix is identical in both modes.
 *
 * @returns {{ system, stableText, jobText, ir, compiledIr, meta }}
 *   stableText — per-template stable content (cacheable prefix)
 *   jobText    — per-job content (the IR + task instructions)
 *   compiledIr — the approved compiled IR in translation mode, else null
 */
function buildGenerationPrompt(projectJson, smId, options = {}) {
  const ir = buildIR(projectJson, smId);
  const sm = (projectJson.stateMachines || []).find(s => s.id === ir.smId);
  const translation = hasApprovedCompiledSequence(sm);
  const compiledIr = translation ? sm.compiledSequence.ir : null;

  // INABILITY GUARD (SUPREME LAW, Dan 2026-08-25): a compiled sequence that
  // decomposes into multiple state machines requires one PROGRAM per machine
  // (CE standard, Program Structure: "Each program must have no more than one
  // state machine"). Multi-program L5X emission is not built yet — emitting
  // the station as one crammed program would violate the standard, so the
  // ONLY legal move is to hold. See
  // jarvis-knowledge/analysis/multi-program-emission-plan.md.
  if (compiledIr && compiledIr.multiSm) {
    const n = (compiledIr.stateMachines || []).length;
    throw new Error(
      `HOLD — standard prevents generation: this station's approved sequence decomposes into ${n} ` +
      'state machines, and the SDC standard requires one program per state machine ' +
      '("Each program must have no more than one state machine" — PLC Software Standardization Rev2). ' +
      'Multi-program L5X emission is not built yet; generating a single crammed program would violate ' +
      'the standard, so the build is held. Capability plan: jarvis-knowledge/analysis/multi-program-emission-plan.md.');
  }

  const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
  const ruleCount = countRules(rulesText);

  const choice = selectTemplate(sm);
  const templatePath = path.join(STANDARD_DIR, choice.template);
  const templateXml = fs.readFileSync(templatePath, 'utf8');

  // DETERMINISTIC DEVICE PRE-PASS (Dan's Rockwell debrief, 2026-08-31):
  // device blocks are parameterized patterns — stamp them from the sheet
  // BEFORE the model writes (axis purge, gripper/sensor renames). The model
  // authors only flowchart logic + init/recovery. The writer reads and edits
  // the PRE-PASSED template file; the note tells it what is already done.
  // Gate: JARVIS_DEVICE_PREPASS=on|off (default on).
  let effTemplateXml = templateXml;
  let effTemplatePath = templatePath;
  let prepassNote = '';
  let prepassApplied = [];
  if (String(process.env.JARVIS_DEVICE_PREPASS || 'on').toLowerCase() !== 'off') {
    try {
      const { devicePrepass } = require('./devicePrepass.js');
      const pp = devicePrepass(templateXml, ir);
      if (pp.applied.length) {
        effTemplateXml = pp.xml;
        prepassNote = pp.note;
        prepassApplied = pp.applied;
        const ppDir = path.join(__dirname, '..', '..', '..', 'generated', '_prepass');
        fs.mkdirSync(ppDir, { recursive: true });
        effTemplatePath = path.join(ppDir, `${String(ir.smName ?? 'station').replace(/[^\w-]+/g, '_')}__${choice.template}`);
        fs.writeFileSync(effTemplatePath, pp.xml, 'utf8');
      }
    } catch (e) { prepassNote = ''; prepassApplied = [`prepass unavailable: ${e.message}`]; }
  }
  const extracts = buildTemplateExtracts(effTemplateXml);
  const ctx = extractContextInfo(effTemplateXml);
  const notes = TEMPLATE_NOTES[choice.template] || COMMON_NOTES;

  const stationNumber = options.stationNumber ?? ir.stationNumber ?? 1;

  const system = SUPREME_LAW + '\n\n' + (translation
    ? ('You are an SDC Automation controls engineer performing template surgery in ' +
       'TRANSLATION mode: the station\'s sequence was already compiled at Build time ' +
       'and APPROVED by the engineer. Every state, transition, and condition is ' +
       'already decided — do not redesign anything. You translate that approved ' +
       'sequence into a surgical JSON edit plan against the SDC V4.2 standard ' +
       'template. A deterministic merge engine applies your plan; you never write ' +
       'XML. The template is the law for idioms and boilerplate; the approved ' +
       'sequence is the law for logic.')
    : ('You are an SDC Automation controls engineer performing template surgery: ' +
       'you adapt an SDC V4.2 standard template L5X to a specific station flowchart ' +
       'by authoring a surgical JSON edit plan. A deterministic merge engine applies ' +
       'your plan to the template; you never write XML. The template is the law — ' +
       'change only what the flowchart requires, keep every idiom and all boilerplate.'));

  // RELEVANCE-LOADED KNOWLEDGE (Dan, 2026-09-01): the build's prompt carries
  // only the concept modules the STATION touches — device families on the
  // sheet + terms in the job — plus the always-core grammar modules. Falls
  // back to everything if the selector is unavailable.
  let concepts;
  try {
    const { loadSelectedConcepts } = require('./conceptSelector.js');
    const sel = loadSelectedConcepts({
      deviceTypes: (ir.devices ?? []).map((d) => String(d.type ?? '')),
      text: `${sm?.machineSpec?.sourceDescription ?? ''} ${sm?.displayName ?? sm?.name ?? ''} codegen rung routine`,
      machineNames: (sm?.machineSpec?.smSplit ?? []).map((m) => String(m?.name ?? '')),
    });
    concepts = sel.text || loadConcepts();
  } catch { concepts = loadConcepts(); }

  const stableText = [
    ...(concepts ? [
      '# ENGINEERING CONCEPTS (how SDC thinks — apply the concepts to this station\'s specifics)',
      'These are understanding, not templates: mechanism, intent, and judgment.',
      'Where the station differs from any template, reason from these concepts.',
      '',
      concepts,
      '',
    ] : []),
    '# GENERATION RULES (the law)',
    'These rules describe the CONTENT the finished program must have. You produce',
    'that content by editing the template with the operations defined below —',
    'ignore any wording about "emitting a complete L5X document"; the merge engine',
    'owns the file. Everything the rules require that the template does not',
    'already provide must come from your edit plan.',
    '',
    rulesText,
    '',
    '# EDIT PLAN FORMAT',
    PLAN_SCHEMA_DOC,
    '',
    WORKED_EXAMPLE,
    '',
    `# TEMPLATE — ${choice.template} (selected: ${choice.reason})`,
    `Context programs (referenced as \\Name, unchangeable): ${ctx.programs.join(', ') || '(none)'}`,
    `AOIs available: ${ctx.aois.join(', ')}`,
    `Controller-scope tags (unchangeable): ${ctx.ctlTags.join(', ')}`,
    '',
    renderPatternInventory(choice.template),
    '',
    '## TEMPLATE CONSULTATION CONTRACT (mandatory)',
    'For every STRUCTURAL decision your edit plan makes — state granularity, trigger',
    'shape, staging structure, transition condition form, rung ordering — you follow',
    'a pattern from the inventory above (or the template extracts below, which are',
    'the same law in full fidelity). In translation mode the approved compiled',
    'sequence\'s "Template conformance" section is the decided record: implement',
    'exactly the cited patterns and sanctioned extensions, nothing else. In',
    'authoring mode, a structural choice no inventory pattern covers must be an',
    'explicit extension: SDC-style, with a rung comment beginning',
    '"PROPOSED NON-STANDARD PATTERN:" naming why no template example exists.',
    'An uncited invented structure is a defect and will be bounced by review.',
    '',
    '## Template notes',
    notes,
    '',
    '## Template extracts (current contents you are editing)',
    extracts,
  ].join('\n');

  const jobText = translation
    ? [
      '# TASK — TRANSLATION MODE',
      `Translate the APPROVED compiled sequence below into station S${String(stationNumber).padStart(2, '0')} ("${ir.smName}").`,
      'The compiled sequence is AUTHORITATIVE — the engineer reviewed and approved',
      'it. Every state, transition, and condition is already decided: follow it',
      'exactly. Do NOT redesign, renumber, add, or remove states; do NOT second-',
      'guess conditions — implement each transition\'s conditionText as the rung',
      'condition it describes. Every compiled state needs its R02 transition rung,',
      'its R03/servo command logic, its Status.STATE[n] comment, and the alarm the',
      'template pattern calls for (waits get fault-timer alarms). Handshake signals',
      'listed in the sequence need their tags (addTag) and their latch/unlatch and',
      'consume rungs. Remove or retarget template rungs for states the sequence',
      'does not have. This is mechanical translation, not design.',
      'If the template\'s rung shapes genuinely FORCE a structural change vs this',
      'approved sequence, declare it in "structuralChanges" (one plain sentence +',
      'irPatch — see the edit plan format) so the diagram is updated to match and',
      'the engineer gets a quick approve. NEVER silently diverge.',
      '',
      compiledIr.text,
      '',
      '# OUTPUT',
      'Respond with ONLY the JSON edit plan object. No markdown fences, no prose',
      'before or after the JSON.',
    ].join('\n')
    : [
      '# TASK',
      `Adapt the template into station S${String(stationNumber).padStart(2, '0')} ("${ir.smName}")`,
      'from the flowchart below. Use the ASSIGNED STATE NUMBERS exactly as given.',
      'Every flowchart state needs its R02 transition rung, its R03/servo command',
      'logic, its Status.STATE[n] comment, and a matching alarm where the template',
      'pattern calls for one. Remove or retarget template rungs for states the',
      'flowchart does not have.',
      '',
      ir.text,
      '',
      '# OUTPUT',
      'Respond with ONLY the JSON edit plan object. No markdown fences, no prose',
      'before or after the JSON.',
    ].join('\n');

  return {
    system,
    stableText,
    jobText: jobText + (prepassNote ? '\n' + prepassNote : ''),
    ir,
    compiledIr,
    meta: {
      mode: translation ? 'translation' : 'authoring',
      projectName: projectJson.name,
      smId: ir.smId,
      smName: ir.smName,
      stationNumber,
      template: choice.template,
      templatePath: effTemplatePath,
      templateSourcePath: templatePath,
      devicePrepass: prepassApplied,
      templateReason: choice.reason,
      ruleCount,
      promptChars: stableText.length + jobText.length,
      stableChars: stableText.length,
      jobChars: jobText.length,
      systemChars: system.length,
    },
  };
}

module.exports = {
  buildGenerationPrompt, selectTemplate, countRules,
  hasApprovedCompiledSequence,
  // Distilled per-template pattern notes — reused by coordinationAuthor.js
  // (the Build-time compile step) so template knowledge lives in ONE place.
  TEMPLATE_NOTES, COMMON_NOTES,
};
