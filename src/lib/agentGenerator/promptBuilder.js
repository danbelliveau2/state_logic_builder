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
const { loadConcepts } = require('./meKnowledge');

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
  EQU/NEQ/LES/GRT/GEQ/LEQ spellings or vice versa; they import differently.`;

const TEMPLATE_NOTES = {
  'S05_ServoPNP.L5X': `
Two servo axes (X horizontal, Z vertical) + a 2-solenoid gripper.
- AOI_RangeCheck backing tags (XAxisExtend/XAxisRetract/ZAxisPick/ZAxisPlace/
  ZAxisRetract) define named positions. renameTag them to the flowchart's
  position names (e.g. XAxisExtend -> XAxisPlace); the RangeCheck call rung in
  each servo routine maps HMI_*.Parameters.Positions[i] indices to them.
- Servo routines (R04_XAxisServo / R05_ZAxisServo): the auto-move staging rung
  (MOVE(...Positions[i], ...MotionParameters.Position) selected by state) and
  the MAM trigger rung (list of XIC(Status.State[n])) are the two rungs that
  bind states to axis moves — retarget their state lists with updateRung.
- SPEED STAGING: AutoSpeed/Accel/Decel are arrays. The template ships every
  move on AutoSpeed[0], but when the compiled sequence has fast/slow segments
  the staging rung selects the profile per state exactly like it selects the
  position — parallel branches, e.g.:
  [ [XIC(Status.State[13]) ,XIC(Status.State[19]) ] [MOVE(HMI_ZAxis.Parameters.AutoSpeed[1],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[1],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[1],ZAxisMotionParameters.Decel) ] ,[MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMotionParameters.Decel) ] ]
  (slow states listed on the [1] branch, everything else falls to [0]).
  A fast-then-slow stroke is TWO states: fast to the transition-point
  Positions[i], slow to the final Positions[j].
- BLENDING (rounded corners): the R02 transition out of a travel move uses the
  wideband OR so the next state (the other axis) starts before the move
  finishes:
  [XIC(ZAxis_MAM.PC) XIC(ZAxisRetract.InPos) ,XIC(ZAxis_MAM.IP) XIC(ZAxisRetract.InPosWide) ]
  InPosWide comes from AOI_RangeCheck's wide deadband (last argument — the
  clearance threshold, e.g. 5-15mm). Use the wideband OR ONLY on
  travel-to-travel corners the spec blends; grips/releases/process actions
  require strict XIC(Axis_MAM.PC) XIC({Pos}.InPos).
- Gripper command rungs in R03 use the latch/seal idiom keyed to the close
  and open state numbers.
- q_ActuatorsSafe must be true only in dial-safe posture (axes homed, Z at
  clear/retract, X stationary).${COMMON_NOTES}`,
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

  const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
  const ruleCount = countRules(rulesText);

  const choice = selectTemplate(sm);
  const templatePath = path.join(STANDARD_DIR, choice.template);
  const templateXml = fs.readFileSync(templatePath, 'utf8');
  const extracts = buildTemplateExtracts(templateXml);
  const ctx = extractContextInfo(templateXml);
  const notes = TEMPLATE_NOTES[choice.template] || COMMON_NOTES;

  const stationNumber = options.stationNumber ?? ir.stationNumber ?? 1;

  const system = translation
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
       'change only what the flowchart requires, keep every idiom and all boilerplate.');

  const concepts = loadConcepts();

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
    jobText,
    ir,
    compiledIr,
    meta: {
      mode: translation ? 'translation' : 'authoring',
      projectName: projectJson.name,
      smId: ir.smId,
      smName: ir.smName,
      stationNumber,
      template: choice.template,
      templatePath,
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
