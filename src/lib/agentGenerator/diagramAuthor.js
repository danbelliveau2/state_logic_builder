/**
 * diagramAuthor.js — "Describe your station" -> State Logic Builder project draft.
 *
 * authorDiagram({ description, images, onProgress, signal }):
 *   Sends the plain-English station description (plus optional CAD screenshots)
 *   to Claude with a condensed schema guide + the SDC LAYOUT RULES and gets
 *   back a complete State Logic Builder project JSON draft, a summary, and
 *   3-6 clarifying questions about ambiguities.
 *
 * The returned project is validated + normalized (ids, edge types, handle
 * rules, exactly one initial node per SM) before the caller saves it.
 *
 * CommonJS, plain Node — required lazily by server.js.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { costOfUsage, AiNotConfiguredError } = require('./client');
const { loadMeKnowledge } = require('./meKnowledge');

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
const MAX_TOKENS = parseInt(process.env.JARVIS_DIAGRAM_MAX_TOKENS, 10) || 32000;

const ROOT = path.join(__dirname, '..', '..', '..');
const EXAMPLE_PROJECT = path.join(ROOT, 'projects', 'SDC_Servo_PNP.json');

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

// ── Prompt pieces ────────────────────────────────────────────────────────────

const SCHEMA_GUIDE = `
# State Logic Builder project JSON — condensed schema

Top level:
{
  "id": "<uuid>", "name": "<PascalCase project name>",
  "stateMachines": [SM, ...],
  "signals": [], "partTracking": { "fields": [] }, "recipes": []
}

Each SM (one per station):
{
  "id": "<uuid>", "name": "<PascalCase, no spaces>", "displayName": "<same or friendlier>",
  "stationNumber": <int >=1>, "description": "<one line>",
  "devices": [Device...], "nodes": [Node...], "edges": [Edge...]
}

Device (type strings are EXACT — one of):
  PneumaticLinearActuator (ops: Extend, Retract; sensorArrangement: 'No sensors' | '1-sensor (Ret only)' | '2-sensor (Ext + Ret)')
  PneumaticRotaryActuator (ops: Extend, Retract; same sensorArrangement options)
  PneumaticGripper        (ops: Engage=close, Disengage=open; sensorArrangement: 'No sensors' | '1-sensor (Closed only)' | '2-sensor (Closed + Open)')
  PneumaticVacGenerator   (ops: VacOn, VacOff, VacOnEject)
  ServoAxis               (ops: ServoMove {positionName}, ServoIncr, ServoIndex; needs positions[] — see example)
  Timer                   (op: Wait)
  DigitalSensor           (ops: Verify, WaitOn, WaitOff)
  AnalogSensor            (no ops — referenced via verify decisions)
  VisionSystem            (op: Trigger; jobName)
  Robot                   (ops: RunSequence, SetOutput, WaitInput)
  Conveyor                (ops: Run, Stop)
  Parameter               (ops: SetOn, SetOff, WaitOn, WaitOff, SetValue)
Device shape: { "id": "id_x", "type": "<above>", "name": "PascalCaseNoSpaces", "displayName": "Friendly_Name",
  "sensorArrangement": "<option>", "homePosition": "<op value>", "extTimerMs": 500, "retTimerMs": 500,
  "engageTimerMs": 250, "disengageTimerMs": 250, "timerMs": 1000 }
ServoAxis additionally: "axisNumber": <n>, "motionType": "linear",
  "positions": [{ "name": "Pick", "defaultValue": 0, "moveType": "Pos", "isHome": true|false, "isRecipe": false, "type": "position" }],
  "speedProfiles": [{ "name": "Fast", "speed": 2500, "accel": 25000, "decel": 25000 }]

StateNode:
{ "id": "id_x", "type": "stateNode", "position": { "x": <int>, "y": <int> },
  "data": { "label": "<what this state does>", "actions": [Action...],
            "isInitial": true|false, "isComplete": true|false } }
- Exactly ONE node per SM has "isInitial": true (the Home / wait-to-start state, usually with no actions,
  label like "Wait for Start" or "Home / Initial").
- Exactly ONE terminal node has "isComplete": true with label "Cycle Complete" and no actions.
- NEVER emit an empty middle node (no label + no actions). Every state does something.

Action (a row inside a state):
{ "id": "id_x", "deviceId": "<device id>", "operation": "<op value for that device type>" }
- ServoMove additionally: "positionName": "<one of that device's positions>"
- ServoMove additionally: "speedProfile": "<one of that device's speedProfiles names, e.g. 'Fast' or 'Slow'>"
  — REQUIRED on every ServoMove when the device declares more than one speed profile (the ME must see
  which segment runs fast and which runs slow right on the canvas).
- SERVO GROUPING LAW (SDC template — S05_ServoPNP): EVERY ServoMove gets its OWN state node. NEVER put
  two ServoMove rows in one state — a MAM only fires on its rung's false->true edge at state entry, so a
  second move commanded in the same state NEVER EXECUTES. A stroke the spec calls fast-then-slow is TWO
  chained STATES: a 'Fast' move state to the transition position -> edge -> a 'Slow' move state to the
  final position. Overlap/blending between motions is expressed ONLY on the connecting edge (see
  "advance" below), never by stacking moves inside one state.
- ServoMove additionally (optional): "advance": "wideband" when this travel move blends into the next
  motion (rounded corner — the next state's axis may start once this axis is inside the clearance band).
  Omit for strict complete-then-go moves.
- STATE GRANULARITY LAW (Dan 2026-08-25 — concepts/coordination.md): actions share ONE state ONLY
  when SIMULTANEOUS — parallel non-conflicting actuations commanded at the same instant (e.g.
  all-retract-together), marked "advanceCondition": { "type": "none" } (concurrent). ANY sequential
  dependency between actuations ("after complete", "then", a timer between them) is a SEPARATE
  state — no exceptions; an after-complete chain inside one node hides a state transition from the
  state map, the fault timers, and single-step mode. A state holds at most ONE ServoMove plus rows
  genuinely simultaneous with it. The same physical pattern must resolve to the same state shape
  everywhere in the diagram — consistency is itself a rule. ("advanceCondition": { "type":
  "onComplete" } / { "type": "timer", "timerMs": 500 } exist in the schema but drawing them between
  actuation rows is a review blocker — split the state instead.)
- A check / wait / decision INSIDE a state is an embedded decision row:
  { "id": "id_x", "deviceId": "_decision", "nodeMode": "wait" | "decide" | "verify",
    "signalName": "<signal/sensor name>", "signalSource": "<device displayName>",
    "signalType": "condition", "conditionType": "sensorOn", "exitCount": 1,
    "exit1Label": "On", "exit2Label": "Off" }
  Use nodeMode "wait" (wait for true, single exit), "verify" (assert on/off, fault if wrong),
  "decide" (fork, 2 exits — must be the LAST row of the state; the state then branches).

Edge:
{ "id": "id_x", "source": "<node id>", "target": "<node id>",
  "sourceHandle": null, "targetHandle": null, "type": "routableEdge",
  "data": { "conditionType": "trigger", "label": "" } }
- type is ALWAYS "routableEdge".
- targetHandle is ALWAYS null for stateNode targets.
- Normal flow: sourceHandle null. Branching from a state whose last row is a 2-exit decision:
  primary/pass edge uses "sourceHandle": "exit-pass" and "data": { "isDecisionExit": true, "exitColor": "pass", "outcomeLabel": "Pass" };
  fail/alternate edge uses "sourceHandle": "exit-fail", "exitColor": "fail", "outcomeLabel": "Fail".
- Every non-complete node has at least one outgoing edge; every non-initial node has at least one incoming edge.
- The last state loops back to Cycle Complete node, or the Cycle Complete node ends the chain (no outgoing edge needed from it).
`;

const LAYOUT_RULES = `
# LAYOUT RULES (critical — the diagram must LOOK right)

- Node width is 240px. Lay the main flow in ONE vertical column at x=300.
- Constant GAP: exactly 50px of empty space between one node's bottom edge and the next node's top
  (SDC standard vertical density — compact; applies to every project, machine and station).
  Node heights are recomputed programmatically after you respond, so a rough cumulative estimate is
  enough — but keep the flow ORDER and COLUMN assignment exact.
- Branch lanes: the ALTERNATE branch of every 2-exit check leaves the node's RIGHT side
  (exit-fail handle) and its chain gets its own column a FULL LANE RIGHT: main column x + 420.
  Pass/primary continues STRAIGHT DOWN in the main column (exit-pass = bottom of node).
  This applies to retry chains too — a "no part, retry" chain is the check's exit-fail
  branch and goes RIGHT like any alternate. NEVER place an exit-fail target LEFT of its
  source: the edge physically leaves the right face and would cross back through the node.
- Sub-branches (a branch off a branch, e.g. retries-exhausted off a retry chain) go only
  HALF a lane further RIGHT: parent column x + 210. NEVER straight below the branch source —
  its edge also leaves the right side.
- A branch path's nodes STACK in their own column — never staggered.
- The FIRST node of a branch sits BELOW its source node's bottom edge (its own column,
  next row down) so the side exit routes as a clean L-bend: right, then down.
- Loop-backs / merges re-enter the main flow BETWEEN two nodes (the target node y leaves room above).
  Give any node that receives a merge edge ~40px extra top clearance.
- Rails (loop-back verticals) hug the nodes: they sit just past the widest node they pass (+50px), not far out.
- Zero node overlaps, ever.
- Keep the whole diagram compact and column-aligned — it must read as an even grid.
`;

const OUTPUT_SPEC = `
# Your response

Respond with ONLY one JSON object (no markdown fences, no prose):
{
  "project": { ...complete project JSON per the schema... },
  "summary": "<3-6 sentence plain-English summary of the station sequence you authored>",
  "openQuestions": ["<3-6 clarifying questions about ambiguities in the description>"]
}

Rules of engagement:
- Author the SDC-standard cycle for the described station: home/initial wait state, the working sequence,
  Cycle Complete terminal state.
- Use full-word PascalCase device names (SDC standard — no abbreviations).
- When the description is ambiguous, make the SDC-standard choice and raise it in openQuestions.
- State granularity: one state = one moment in time. Group only SIMULTANEOUS actuations (concurrent
  rows) into one state; every sequential step gets its own state. One ServoMove per state, always.
- ids: use short unique strings like "n1","n2","e1","d1" — they will be kept as-is.
`;

/** Load the reference example, stripped of render-only noise, for the prompt. */
function loadExampleProject() {
  try {
    const raw = JSON.parse(fs.readFileSync(EXAMPLE_PROJECT, 'utf8'));
    for (const sm of raw.stateMachines || []) {
      for (const n of sm.nodes || []) {
        delete n.measured; delete n.selected; delete n.dragging;
      }
      for (const e of sm.edges || []) {
        delete e.selected;
      }
    }
    delete raw._lastActiveSmId;
    return JSON.stringify(raw);
  } catch (e) {
    return null;
  }
}

function extractJson(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Model response contained no JSON object');
  }
  return JSON.parse(t.slice(start, end + 1));
}

// ── Validation / normalization ──────────────────────────────────────────────

let _uidN = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(_uidN++).toString(36)}`;

/**
 * Validate basic integrity and normalize the drafted project in place.
 * Throws with a readable message when the draft is structurally unusable.
 * Returns a list of non-fatal fixups applied (for the summary).
 */
function validateAndNormalizeProject(project) {
  const fixups = [];
  if (!project || typeof project !== 'object') throw new Error('Draft is not an object');
  if (!Array.isArray(project.stateMachines) || project.stateMachines.length === 0) {
    throw new Error('Draft has no stateMachines');
  }
  project.id = project.id || uid('proj');
  project.name = String(project.name || 'JarvisDraft').replace(/[^a-zA-Z0-9_\- ]/g, '');
  project.signals = Array.isArray(project.signals) ? project.signals : [];
  project.recipes = Array.isArray(project.recipes) ? project.recipes : [];
  project.partTracking = project.partTracking && typeof project.partTracking === 'object'
    ? project.partTracking : { fields: [] };

  project.stateMachines.forEach((sm, i) => {
    const where = `SM[${i}] "${sm?.name || '?'}"`;
    if (!sm || typeof sm !== 'object') throw new Error(`${where} is not an object`);
    sm.id = sm.id || uid('sm');
    sm.name = String(sm.name || `Station${i + 1}`).replace(/\s+/g, '');
    sm.displayName = sm.displayName || sm.name;
    sm.stationNumber = Number(sm.stationNumber) || (i + 1);
    sm.devices = Array.isArray(sm.devices) ? sm.devices : [];
    sm.nodes = Array.isArray(sm.nodes) ? sm.nodes : [];
    sm.edges = Array.isArray(sm.edges) ? sm.edges : [];
    if (sm.nodes.length === 0) throw new Error(`${where} has no nodes`);

    const deviceIds = new Set();
    for (const d of sm.devices) {
      d.id = d.id || uid('dev');
      deviceIds.add(d.id);
    }

    const nodeIds = new Set();
    let initialCount = 0;
    for (const n of sm.nodes) {
      n.id = n.id || uid('n');
      if (nodeIds.has(n.id)) throw new Error(`${where}: duplicate node id ${n.id}`);
      nodeIds.add(n.id);
      n.type = n.type === 'decisionNode' ? 'decisionNode' : 'stateNode';
      n.position = n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
        ? n.position : { x: 300, y: 100 };
      n.data = n.data && typeof n.data === 'object' ? n.data : {};
      n.data.actions = Array.isArray(n.data.actions) ? n.data.actions : [];
      if (n.data.isInitial) initialCount++;
      for (const a of n.data.actions) {
        a.id = a.id || uid('a');
        if (a.deviceId !== '_decision' && a.deviceId && !deviceIds.has(a.deviceId)) {
          throw new Error(`${where}: node "${n.data.label || n.id}" action references unknown device "${a.deviceId}"`);
        }
      }
    }
    if (initialCount === 0) {
      sm.nodes[0].data.isInitial = true;
      fixups.push(`${where}: no initial node — marked first node initial`);
    } else if (initialCount > 1) {
      let seen = false;
      for (const n of sm.nodes) {
        if (n.data.isInitial) {
          if (seen) n.data.isInitial = false;
          seen = true;
        }
      }
      fixups.push(`${where}: multiple initial nodes — kept the first`);
    }

    const nodeById = new Map(sm.nodes.map(n => [n.id, n]));
    sm.edges = sm.edges.filter((e, j) => {
      if (!e || !nodeById.has(e.source) || !nodeById.has(e.target)) {
        throw new Error(`${where}: edge[${j}] does not resolve (source "${e?.source}" -> target "${e?.target}")`);
      }
      return true;
    });
    for (const e of sm.edges) {
      e.id = e.id || uid('e');
      e.type = 'routableEdge'; // ALWAYS — never smoothstep/straight
      const tgt = nodeById.get(e.target);
      e.targetHandle = tgt.type === 'decisionNode' ? 'input' : null; // handle rules
      if (e.sourceHandle !== 'exit-pass' && e.sourceHandle !== 'exit-fail'
        && e.sourceHandle !== 'exit-retry' && e.sourceHandle !== 'exit-single') {
        e.sourceHandle = e.sourceHandle || null;
      }
      e.data = e.data && typeof e.data === 'object' ? e.data : {};
      if (!e.data.conditionType) e.data.conditionType = 'trigger';
    }
  });
  return fixups;
}

// ── Rule-based post-passes (deterministic — never left to the model) ────────

/**
 * SDC servo grouping law (template S05_ServoPNP, R04/R05 "Axis Motion
 * Command" rungs): one MAM per axis, fired on the rung's false->true edge at
 * state entry — a SECOND ServoMove commanded inside the same state never
 * executes. So every ServoMove must live in its OWN state; overlap/blending
 * is expressed only on the connecting edge.
 *
 * This pass enforces that regardless of what the model drew: any stateNode
 * holding 2+ ServoMove rows is split into a chain of states (first keeps the
 * node id/label so incoming edges stay valid; outgoing edges move to the
 * last node of the chain). A move's `advance: 'wideband'` intent is carried
 * onto the connecting edge. Returns fixup strings.
 */
function splitMultiServoMoveStates(project) {
  const fixups = [];
  for (const sm of project.stateMachines || []) {
    const devById = new Map((sm.devices || []).map(d => [d.id, d]));
    const isServoMove = (a) =>
      a && a.operation === 'ServoMove' && a.deviceId !== '_decision';
    const newNodes = [];
    for (const n of sm.nodes) {
      const actions = n.data?.actions || [];
      const moveCount = actions.filter(isServoMove).length;
      if (n.type !== 'stateNode' || moveCount <= 1) { newNodes.push(n); continue; }

      // Group rows: break BEFORE a ServoMove when the current group already
      // holds one. Non-motion rows stay grouped with the move they follow.
      const groups = [];
      let cur = [];
      for (const a of actions) {
        if (isServoMove(a) && cur.some(isServoMove)) { groups.push(cur); cur = []; }
        cur.push(a);
      }
      if (cur.length) groups.push(cur);

      const chain = groups.map((g, gi) => {
        if (gi === 0) {
          const mv0 = g.find(isServoMove);
          const dev0 = mv0 ? devById.get(mv0.deviceId) : null;
          const label0 = mv0
            ? `${dev0?.displayName ?? dev0?.name ?? 'Axis'} → ${mv0.positionName ?? '?'}${mv0.speedProfile ? ` (${mv0.speedProfile})` : ''}`
            : n.data.label;
          return { ...n, data: { ...n.data, label: label0 || n.data.label, actions: g } };
        }
        const mv = g.find(isServoMove);
        const dev = mv ? devById.get(mv.deviceId) : null;
        const label = mv
          ? `${dev?.displayName ?? dev?.name ?? 'Axis'} → ${mv.positionName ?? '?'}${mv.speedProfile ? ` (${mv.speedProfile})` : ''}`
          : `${n.data.label ?? 'State'} (cont.)`;
        return {
          id: uid('n'),
          type: 'stateNode',
          position: { x: n.position.x, y: n.position.y },
          data: { label, actions: g, isInitial: false, isComplete: false },
        };
      });

      const lastId = chain[chain.length - 1].id;
      // Outgoing edges of the original node now leave from the END of the chain.
      for (const e of sm.edges) {
        if (e.source === n.id) e.source = lastId;
      }
      // Chain edges: gate = the servo move's completion; wideband blend intent
      // moves onto the edge (and stays on the row for the "≈ blends" hint).
      for (let gi = 0; gi < chain.length - 1; gi++) {
        const gActs = chain[gi].data.actions;
        const gLast = gActs[gActs.length - 1];
        const wideband = gLast?.advance === 'wideband'
          || gActs.some(a => isServoMove(a) && a.advance === 'wideband');
        if (gLast && gLast.advanceCondition) delete gLast.advanceCondition;
        sm.edges.push({
          id: uid('e'),
          source: chain[gi].id,
          target: chain[gi + 1].id,
          sourceHandle: null,
          targetHandle: null,
          type: 'routableEdge',
          data: {
            conditionType: 'servoAtTarget',
            label: '',
            ...(wideband ? { advance: 'wideband' } : {}),
          },
        });
      }
      newNodes.push(...chain);
      fixups.push(`SM "${sm.name}": state "${n.data.label || n.id}" held ${moveCount} servo moves — split into ${chain.length} chained states (one MAM edge per move; SDC trigger law)`);
    }
    sm.nodes = newNodes;
  }
  return fixups;
}

/**
 * Height estimate for a drafted node as StateNode renders it (px).
 * Mirrors the real render: label header, per-row heights (servo move rows
 * are 3 lines + tag hints), "then after complete" chips between rows, and
 * the Home node's entry-rule pill block.
 */
function estimateNodeHeight(node) {
  if (node.type === 'decisionNode') return 96;
  const actions = node.data?.actions || [];
  let h = 42; // container padding + label line
  actions.forEach((a, i) => {
    if (a.deviceId === '_decision') h += 46;
    else if (a.operation === 'ServoMove') h += 80; // head + dest + speed + tag hints
    else h += 34; // single-line row + verify text
    if (i < actions.length - 1) h += 16; // advance-condition chip
  });
  if (node.data?.isInitial) h += 88; // Home Conditions / entry-rule pills
  return Math.max(h, 64);
}

/**
 * Deterministic layout — the model's positions are never trusted for
 * collision safety, lane discipline, or handle geometry. Runs the SHARED
 * column-aware algorithm (src/lib/branchLayout.mjs — same one Canvas re-runs
 * with real measured heights): main spine + branch lanes derived from the
 * edges' sourceHandles (exit-fail → right lane, sub-branch → half lane),
 * constant 50px gap from estimated heights, merge clearance, staggered loop
 * rails. Every node is flagged `data._autoLayout = true` so the client
 * refines spacing once REAL measured heights exist (Canvas clears the flag).
 *
 * branchLayout.mjs is ESM (this file is CJS) — loaded via dynamic import().
 */
let _branchLayoutMod = null;
async function loadBranchLayout() {
  if (!_branchLayoutMod) {
    const { pathToFileURL } = require('url');
    _branchLayoutMod = await import(
      pathToFileURL(path.join(__dirname, '..', 'branchLayout.mjs')).href
    );
  }
  return _branchLayoutMod;
}

async function normalizeLayout(project) {
  const { layoutBranchDiagram, applyBranchLayout } = await loadBranchLayout();
  for (const sm of project.stateMachines || []) {
    const layout = layoutBranchDiagram(sm.nodes || [], sm.edges || [], {
      getHeight: estimateNodeHeight,
    });
    if (!layout.changed) continue;
    const applied = applyBranchLayout(sm.nodes || [], sm.edges || [], layout);
    sm.nodes = applied.nodes.map(n => ({
      ...n,
      data: { ...(n.data || {}), _autoLayout: true },
    }));
    sm.edges = applied.edges;
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.description  Plain-English station description (required)
 * @param {Array<{name?:string, base64:string, mediaType:string}>} [opts.images]
 * @param {object} [opts.station]    Single-SM mode (Create Station flow):
 *   { name, stationNumber, otherSms: [{name, displayName}] }. The model
 *   authors exactly ONE state machine (for insertion into an existing
 *   project) instead of a whole project draft.
 * @param {(pct:number, stage:string, detail:string)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ project, summary, openQuestions, fixups, meta }>}
 */
async function authorDiagram({ description, images = [], station = null, onProgress = () => {}, signal = null } = {}) {
  if (!description || !String(description).trim()) {
    throw new Error('description is required');
  }
  const client = getClient();

  onProgress(10, 'prompt', 'Assembling schema guide and layout rules');
  const example = loadExampleProject();
  const meKnowledge = loadMeKnowledge();
  const system =
    'You are JARVIS, the SDC Automation station-diagram author. You convert a manufacturing ' +
    'engineer\'s plain-English (and pictured) description of an automation station into a ' +
    'State Logic Builder project JSON draft that follows SDC PLC standards exactly.\n\n' +
    (meKnowledge ? meKnowledge + '\n\n' : '') +
    SCHEMA_GUIDE + '\n' + LAYOUT_RULES + '\n' +
    (example ? `# Reference example (a real, correctly-formed project)\n${example}\n\n` : '') +
    OUTPUT_SPEC;

  const content = [];
  for (const img of images.slice(0, 8)) {
    if (!img || !img.base64) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
    });
  }
  let stationDirective = '';
  if (station && station.name) {
    const others = (station.otherSms || [])
      .map(s => `"${s.displayName || s.name}"`).join(', ');
    stationDirective =
      `IMPORTANT — SINGLE-STATION MODE: author exactly ONE state machine (stateMachines has exactly ` +
      `one entry) named "${String(station.name).replace(/\s+/g, '')}" with stationNumber ` +
      `${Number(station.stationNumber) || 1}. It will be inserted into an EXISTING project` +
      (others ? ` that already contains these stations: ${others}. Do not re-author those — ` +
        `only this one station. You may reference them in openQuestions.` : `.`) +
      `\n\n`;
  }
  content.push({
    type: 'text',
    text: stationDirective +
      'Station description from the engineer:\n\n' + String(description).trim() +
      (images.length ? `\n\n(${images.length} image(s) of the station/CAD are attached above.)` : ''),
  });

  onProgress(20, 'model', 'Model authoring the station diagram');
  const req = { model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content }] };
  if (/^claude-(fable|opus)-/.test(MODEL)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  let chars = 0;
  stream.on('text', (d) => {
    chars += d.length;
    const frac = Math.min((chars / 4) / 15000, 1);
    try { onProgress(20 + 60 * frac, 'model', `Model authoring the station diagram (~${Math.round(chars / 4).toLocaleString()} tokens)`); } catch (_) {}
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused the request: ' + (response.stop_details?.explanation || 'no reason given'));
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Model response truncated at ${MAX_TOKENS} tokens — try a shorter description or fewer images`);
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

  onProgress(85, 'validate', 'Parsing and validating the draft project');
  const parsed = extractJson(text);
  const project = parsed.project;
  const fixups = validateAndNormalizeProject(project);
  // Rule-based post-passes — never left to the model:
  fixups.push(...splitMultiServoMoveStates(project)); // one ServoMove per state (SDC trigger law)
  await normalizeLayout(project);                     // column-aware collision-free layout

  // Single-station mode: enforce exactly one SM with the requested identity.
  if (station && station.name) {
    if (project.stateMachines.length > 1) {
      project.stateMachines = [project.stateMachines[0]];
      fixups.push('single-station mode: model drew extra SMs — kept the first');
    }
    const sm = project.stateMachines[0];
    sm.name = String(station.name).replace(/[^a-zA-Z0-9_]/g, '') || sm.name;
    sm.displayName = station.displayName || station.name || sm.displayName;
    sm.stationNumber = Number(station.stationNumber) || sm.stationNumber;
  }

  const costUSD = response.usage ? costOfUsage(response.usage, MODEL) : 0;
  onProgress(95, 'validate', 'Draft validated');
  return {
    project,
    summary: String(parsed.summary || ''),
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.map(String) : [],
    fixups,
    meta: {
      model: response.model || MODEL,
      usage: response.usage || null,
      costUSD: Number(costUSD.toFixed(4)),
    },
  };
}

module.exports = {
  authorDiagram,
  validateAndNormalizeProject,
  splitMultiServoMoveStates,
  normalizeLayout,
  estimateNodeHeight,
};
