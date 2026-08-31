/**
 * editPlanSchema.js — schema + validation for the JARVIS surgical edit plan.
 *
 * v1.0.1 architecture: the model no longer writes L5X. It authors a JSON
 * EDIT PLAN — a list of surgical operations against the chosen SDC standard
 * template — and the deterministic merge engine (mergeEngine.js) applies it.
 *
 * Plan shape:
 * {
 *   "programName": "S01_ServoPNP",          // optional — engine derives one if omitted
 *   "notes": "free text (ignored by engine)",
 *   "operations": [ <op>, ... ],            // applied strictly in order
 *   "structuralChanges": [                  // optional (translation mode):
 *     { "text": "one plain sentence",       //   declared deviations from the
 *       "irPatch": [ <irOp>, ... ] }        //   approved compiled sequence
 *   ]                                       //   (see coordinationAuthor.applyIrPatches)
 * }
 *
 * Operations (see OP_DOCS below for the model-facing documentation):
 *   renameTag            { op, from, to }
 *   updateRung           { op, routine, match, newText?, newComment?, occurrence?, nearComment? }
 *   spliceRungs          { op, routine, after?|atIndex?, remove?, insert?: [{comment?, text}], occurrence?, nearComment? }
 *   replaceRoutineRungs  { op, routine, rungs: [{comment?, text}] }
 *   addTag               { op, name, dataType, description?, value? }
 *   setTagData           { op, tag, member, value, oldValue? }
 *   setStringData        { op, tag, oldText, newText }
 *   setTagComment        { op, tag, operand, text?, remove? }
 *   setProgramDescription{ op, text }
 *
 * CommonJS, plain Node.
 */

const OPS = {
  renameTag: {
    required: { from: 'string', to: 'string' },
    optional: {},
  },
  updateRung: {
    required: { routine: 'string', match: 'string' },
    optional: { newText: 'string', newComment: 'string', occurrence: 'number', nearComment: 'string' },
    check(op) {
      if (op.newText === undefined && op.newComment === undefined) {
        return 'updateRung needs newText and/or newComment';
      }
      if (op.occurrence !== undefined && (!Number.isInteger(op.occurrence) || op.occurrence < 1)) {
        return 'updateRung "occurrence" must be a 1-based integer';
      }
      return null;
    },
  },
  spliceRungs: {
    required: { routine: 'string' },
    optional: { after: 'string', atIndex: 'number', remove: 'number', insert: 'array', occurrence: 'number', nearComment: 'string' },
    check(op) {
      if (op.after === undefined && op.atIndex === undefined) {
        return 'spliceRungs needs "after" (substring of an existing rung text/comment) or "atIndex"';
      }
      if (op.after !== undefined && op.atIndex !== undefined) {
        return 'spliceRungs takes "after" OR "atIndex", not both';
      }
      if (op.atIndex !== undefined && (op.occurrence !== undefined || op.nearComment !== undefined)) {
        return 'spliceRungs "occurrence"/"nearComment" only apply to an "after" anchor, not "atIndex"';
      }
      if (op.occurrence !== undefined && (!Number.isInteger(op.occurrence) || op.occurrence < 1)) {
        return 'spliceRungs "occurrence" must be a 1-based integer';
      }
      if (!op.remove && !(op.insert && op.insert.length)) {
        return 'spliceRungs needs remove > 0 and/or a non-empty insert list';
      }
      return checkRungList(op.insert);
    },
  },
  replaceRoutineRungs: {
    required: { routine: 'string', rungs: 'array' },
    optional: {},
    check(op) {
      if (!op.rungs.length) return 'replaceRoutineRungs needs at least one rung';
      return checkRungList(op.rungs);
    },
  },
  addTag: {
    required: { name: 'string', dataType: 'string' },
    optional: { description: 'string', value: 'any' },
    check(op) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(op.name)) return `addTag: invalid tag name "${op.name}"`;
      if (!['BOOL', 'DINT', 'REAL', 'TIMER', 'MOTION_INSTRUCTION', 'AOI_RangeCheck'].includes(op.dataType)) {
        return `addTag: unsupported dataType "${op.dataType}" (BOOL | DINT | REAL | TIMER | MOTION_INSTRUCTION | AOI_RangeCheck)`;
      }
      return null;
    },
  },
  setTagData: {
    required: { tag: 'string', member: 'string', value: 'any' },
    optional: { oldValue: 'any' },
  },
  setStringData: {
    required: { tag: 'string', oldText: 'string', newText: 'string' },
    optional: { index: 'number' },
    check(op) {
      if (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0)) {
        return 'setStringData "index" must be a 0-based integer array element index';
      }
      return null;
    },
  },
  setTagComment: {
    required: { tag: 'string', operand: 'string' },
    optional: { text: 'string', remove: 'boolean' },
    check(op) {
      if (op.text === undefined && !op.remove) return 'setTagComment needs text or remove:true';
      return null;
    },
  },
  setProgramDescription: {
    required: { text: 'string' },
    optional: {},
  },
};

function checkRungList(list) {
  if (list === undefined) return null;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || typeof r !== 'object') return `rung ${i} is not an object`;
    if (typeof r.text !== 'string' || r.text.trim() === '') return `rung ${i} needs non-empty "text"`;
    if (!r.text.trim().endsWith(';')) return `rung ${i} text must end with ";" — got: ${r.text.slice(-30)}`;
    if (r.comment !== undefined && typeof r.comment !== 'string') return `rung ${i} comment must be a string`;
  }
  return null;
}

function typeOk(v, t) {
  if (t === 'any') return v !== undefined;
  if (t === 'array') return Array.isArray(v);
  return typeof v === t;
}

/**
 * Validate a parsed edit plan. Returns { ok, errors: string[] }.
 * Structural only — template-dependent checks (does the routine exist, is the
 * tag protected) belong to the merge engine.
 */
function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, errors: ['Edit plan must be a JSON object'] };
  }
  if (plan.programName !== undefined) {
    if (typeof plan.programName !== 'string' || !/^S\d{2}_[A-Za-z][A-Za-z0-9_]*$/.test(plan.programName)) {
      errors.push(`programName must match S{NN}_{PascalName} — got ${JSON.stringify(plan.programName)}`);
    }
  }
  // Declared structural deviations from the approved compiled sequence
  // (Dan's escalation model: never silent divergence — a deliberate change is
  // declared with one plain sentence + the IR patch that keeps the diagram
  // truthful). Validated structurally here; op semantics belong to
  // coordinationAuthor.applyIrPatches.
  const IR_OPS = ['addState', 'removeState', 'updateState', 'addTransition', 'removeTransition', 'updateTransition'];
  if (plan.structuralChanges !== undefined) {
    if (!Array.isArray(plan.structuralChanges)) {
      errors.push('"structuralChanges" must be an array of { text, irPatch? }');
    } else {
      plan.structuralChanges.forEach((c, i) => {
        const where = `structuralChanges[${i}]`;
        if (!c || typeof c !== 'object') { errors.push(`${where}: not an object`); return; }
        if (typeof c.text !== 'string' || !c.text.trim()) {
          errors.push(`${where}: needs "text" — one plain sentence naming the change`);
        }
        if (c.irPatch !== undefined) {
          if (!Array.isArray(c.irPatch)) {
            errors.push(`${where}: "irPatch" must be an array of IR ops`);
          } else {
            c.irPatch.forEach((op, j) => {
              if (!op || typeof op !== 'object' || !IR_OPS.includes(op.op)) {
                errors.push(`${where}.irPatch[${j}]: unknown op "${op && op.op}" — allowed: ${IR_OPS.join(', ')}`);
              }
            });
          }
        }
      });
    }
  }
  if (!Array.isArray(plan.operations)) {
    errors.push('Edit plan needs an "operations" array');
    return { ok: false, errors };
  }
  plan.operations.forEach((op, i) => {
    const where = `operations[${i}]`;
    if (!op || typeof op !== 'object') { errors.push(`${where}: not an object`); return; }
    const def = OPS[op.op];
    if (!def) { errors.push(`${where}: unknown op "${op.op}" — allowed: ${Object.keys(OPS).join(', ')}`); return; }
    for (const [k, t] of Object.entries(def.required)) {
      if (!typeOk(op[k], t)) errors.push(`${where} (${op.op}): required field "${k}" missing or not a ${t}`);
    }
    for (const [k, v] of Object.entries(op)) {
      if (k === 'op') continue;
      if (!(k in def.required) && !(k in def.optional)) {
        errors.push(`${where} (${op.op}): unknown field "${k}"`);
      } else if (k in def.optional && v !== undefined && !typeOk(v, def.optional[k])) {
        errors.push(`${where} (${op.op}): field "${k}" must be a ${def.optional[k]}`);
      }
    }
    if (def.check && Object.entries(def.required).every(([k, t]) => typeOk(op[k], t))) {
      const msg = def.check(op);
      if (msg) errors.push(`${where} (${op.op}): ${msg}`);
    }
  });
  return { ok: errors.length === 0, errors };
}

/** Model-facing documentation of the plan format (embedded in the prompt). */
const PLAN_SCHEMA_DOC = `
Respond with ONE JSON object:

{
  "programName": "S01_ServoPNP",     // target program name, S{NN}_{PascalName}
  "notes": "anything you want to tell the reviewing engineer",
  "operations": [ ...operations, applied strictly in order... ]
}

Operations (put renameTag ops FIRST — they rewrite rung text globally, so
later operations must be written using the NEW names):

1. {"op":"renameTag","from":"XAxisExtend","to":"XAxisPlace"}
   Word-boundary rename of a program tag everywhere in the target program:
   declaration, rung text, rung comments, tag descriptions. Does NOT touch
   alarm/HMI message string VALUES (use setStringData for those).

2. {"op":"updateRung","routine":"R02_StateTransitions","match":"MOVE(7,Control.StateReg)",
    "newText":"XIC(Status.State[4])[XIC(g_MachineBasic.AlwaysOff) ,XIC(DryRun) ]XIC(SS_OK)MOVE(7,Control.StateReg);",
    "newComment":"State 7: Move z axis to pick position\\n\\n*Replace AlwaysOff bit with the real index-complete signal."}
   Rewrite one existing rung in place. "match" must be a substring that occurs
   in exactly ONE rung of that routine (searched in rung text, then comment).
   If a short anchor is unavoidably ambiguous, disambiguate with
   "occurrence": N (1-based, among the matching rungs in order) and/or
   "nearComment": "substring of the intended rung's comment". These also work
   on spliceRungs' "after" anchor.

3. {"op":"spliceRungs","routine":"R20_Alarms","after":"Alarm[5].Active",
    "insert":[{"comment":"Waiting For Gripper To Close",
               "text":"[XIC(Status.State[10]) MOVE(2000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[6].Active) XIO(FaultReset) ][OTE(Alarm[6].Active) ,ONS(ONS.15) CONCAT(g_StationList[StaNum],AlarmList[6],Alarm[6].Message) ];"}]}
   Insert (and/or remove) rungs. "after" = unique substring of the rung to
   insert after ("atIndex":0-based alternative; "remove":N deletes N rungs
   after that point before inserting). Rungs are renumbered automatically.

4. {"op":"replaceRoutineRungs","routine":"R02_StateTransitions","rungs":[{"comment":"...","text":"...;"}]}
   Replace ALL rungs of a routine. Prefer updateRung/spliceRungs — only use
   this when most of the routine changes anyway. You must re-emit every rung
   the routine still needs (including boilerplate you are not changing).

5. {"op":"addTag","name":"p_PartGripped","dataType":"BOOL",
    "description":"SM Output Signal: Part_Gripped - ON while a part is held"}
   Declare a new program tag (BOOL | DINT | REAL | TIMER | MOTION_INSTRUCTION
   | AOI_RangeCheck). "value" presets a scalar (or TIMER preset, e.g.
   {"value":2000} sets .PRE). MOTION_INSTRUCTION declares a motion control
   tag (e.g. ZAxis_MCD for the "Use MCD For Speed Changes" rung);
   AOI_RangeCheck declares a position-monitor instance backing tag (e.g.
   ZAxisPickTransition, ZAxisPickRetractBlend) — both emit the full
   Studio-format structure, zero-initialized.

6. {"op":"setTagData","tag":"CloseGripperDelay","member":"PRE","value":250,"oldValue":100}
   Change one numeric member of an existing program tag. Keeps the L5K and
   Decorated data in sync. member examples: "PRE", "Parameters.AutoSpeed[0]".

7. {"op":"setStringData","tag":"AlarmList","oldText":"Waiting For Part Present","newText":"Waiting For Index Complete"}
   Rewrite one string value (alarm message, HMI status message). oldText must
   be the EXACT current text (shown in the template extracts). LEN fields and
   $00 padding are recomputed automatically. The new text must fit the
   existing string buffer. For EMPTY or duplicate array elements, add
   "index": N (0-based element index, e.g. AlarmList[6] -> "index":6 with
   "oldText":"") — the write then targets exactly that element.

8. {"op":"setTagComment","tag":"Status","operand":".STATE[7]","text":"Move Z Axis To Pick Position"}
   Set (or with "remove":true delete) the comment on a tag member operand —
   used for the Status.STATE[n] state-name comments.

9. {"op":"setProgramDescription","text":"..."}
   Extra program description text (appended after the JARVIS version stamp).

HARD LIMITS (the merge engine refuses these — do not attempt):
- No operation may touch AOI definitions, UDT/DataType definitions,
  MotionGroup or axis (AXIS_CIP_DRIVE) configuration, controller-scope tags,
  or context programs (Supervisor, Tracking, Alarms, S00_*, ...). They are law.
- renameTag cannot rename boilerplate tags (Control, Status, SS_OK, DryRun,
  Lockout, Initialized, CycleRunning, ...), AOI names, or iq_/HMI_ servo tags.
- Every "match"/"after"/"oldText" must match exactly once — ambiguous or
  missing matches are hard errors and come back to you for correction
  (ambiguity errors list the matching rung numbers and comments; resolve with
  "occurrence"/"nearComment" on updateRung/spliceRungs).

STRUCTURAL CHANGES (translation mode only — never silent divergence): if
implementing the approved compiled sequence FORCES a structural change — a
state added/removed, a transition redirected or re-conditioned — you must
DECLARE it as a deliberate decision instead of quietly diverging:

  "structuralChanges": [
    { "text": "<ONE plain sentence: what changed and why>",
      "irPatch": [ {"op":"addState","state":{"stateNumber":34,"label":"Wait for gripper confirm","actions":[]}},
                   {"op":"updateTransition","fromState":31,"toState":37,"patch":{"toState":34}},
                   {"op":"addTransition","transition":{"fromState":34,"toState":37,"conditionText":"CloseGripperDelay.DN","kind":"sequence"}} ] }
  ]

The irPatch updates the approved sequence to match your code, so the diagram
stays truthful and validation checks your code against the PATCHED contract.
irPatch ops: addState {state}, removeState {stateNumber},
updateState {stateNumber, patch}, addTransition {transition},
removeTransition {fromState, toState}, updateTransition {fromState, toState, patch}.
Every declared change is flagged to the engineer for a quick approve — it does
not block the file. An UNDECLARED divergence from the approved sequence is a
defect and fails validation. Use this sparingly: the approved sequence is the
law; declare a change only when the template's rung shapes genuinely force it.

KEEP THE PLAN COMPACT: a typical station is 40-90 operations. Use the
shortest unique "match" strings, never restate rungs you are not changing,
omit "notes", and prefer updateRung over replaceRoutineRungs.

IF THE PLAN WILL NOT FIT in the output budget, SPLIT it instead of letting it
truncate: end the response early with VALID, complete JSON whose last
property is "toBeContinued": true. You will be asked to continue with the
remaining operations ({"operations":[...], "toBeContinued": true|false});
the "operations" arrays are concatenated in order before merging. Never emit
half-finished JSON — a truncated response is rejected.
`.trim();

module.exports = { OPS, validatePlan, PLAN_SCHEMA_DOC };
