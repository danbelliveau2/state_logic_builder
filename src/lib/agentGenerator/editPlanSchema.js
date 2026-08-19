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
 *   "operations": [ <op>, ... ]             // applied strictly in order
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
      if (!['BOOL', 'DINT', 'REAL', 'TIMER'].includes(op.dataType)) {
        return `addTag: unsupported dataType "${op.dataType}" (BOOL | DINT | REAL | TIMER)`;
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
    optional: {},
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
   Declare a new program tag (BOOL | DINT | REAL | TIMER). "value" presets a
   scalar (or TIMER preset, e.g. {"value":2000} sets .PRE).

6. {"op":"setTagData","tag":"CloseGripperDelay","member":"PRE","value":250,"oldValue":100}
   Change one numeric member of an existing program tag. Keeps the L5K and
   Decorated data in sync. member examples: "PRE", "Parameters.AutoSpeed[0]".

7. {"op":"setStringData","tag":"AlarmList","oldText":"Waiting For Part Present","newText":"Waiting For Index Complete"}
   Rewrite one string value (alarm message, HMI status message). oldText must
   be the EXACT current text (shown in the template extracts). LEN fields and
   $00 padding are recomputed automatically. The new text must fit the
   existing string buffer.

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
