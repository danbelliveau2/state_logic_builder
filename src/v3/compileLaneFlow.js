/**
 * compileLaneFlow.js — v3 PHASE B: the AI first draft onto the canvas, in
 * DAN'S SHAPE. The sheet's approved structured steps (or the buildFlowModel
 * item list built from them) → v1 canvas nodes/edges for ONE machine, in the
 * ME-facing sequence grammar (meKnowledge → SEQUENCE GRAMMAR, Dan 2026-09-02,
 * from his original Magnet_Shuttle drawing + his same-day retry ruling):
 *
 *   (a) TWO node kinds only. ACTION nodes fire device operations (v1
 *       StateNode with action rows: Extend / Retract / SetOn …). CHECK nodes
 *       observe a sensor/signal and react (v1 DecisionNode: verify mode when
 *       the check gates the line — On/Off selectable, single continue exit,
 *       Retry loop; decide mode when the sheet drew a genuine two-way fork —
 *       On and Off both drawn).
 *   (b) RETRY IS CONFIGURED, NOT DRAWN. The Check carries `retryEnabled`,
 *       `retryMax` (SDC standard 3) and `retryTargetNodeId` — the step to go
 *       back to; the loop edge draws itself (exit-retry → that step,
 *       `data.autoRetryLoop`), the v1 U-route routes it. Redo steps the sheet
 *       approved before the loop point stay drawn on the retry path.
 *   (c) RETRY EXHAUSTED → INITIALIZATION, always. Nothing is drawn for it —
 *       codegen generates the counter + the jump to the init block from the
 *       check's retry config. No exhaustion lane, no stack-change lane.
 *   (d) Waits on other machines are their own WAIT nodes (DecisionNode, wait).
 *   (e) Simultaneous actions group in ONE node (concurrent advance rows).
 *   (f) Loops are real drawn loops (back edges the v1 U-route draws).
 *
 * Diagram laws honored (root CLAUDE.md §4/§5 + Dan's branch rules):
 *   - every edge `type: 'routableEdge'`
 *   - StateNode target → targetHandle null; DecisionNode target → 'input'
 *   - continue exits the BOTTOM (exit-single / exit-pass), a fork's alternate
 *     the RIGHT (exit-fail), Retry the LEFT (exit-retry); labels are just the
 *     vocabulary — On / Off / Retry
 *   - ONE initial node; at most ONE "Cycle Complete" per machine
 *
 * Pure logic — no React, no store. Consumed by sequenceSm.js (first-open
 * migration + "Redraft from sheet") and by scripts/regenV3Sequence.mjs.
 */

let _n = 0;
const uid = () => `id_${Date.now().toString(36)}_${(++_n).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export const RETRY_DEFAULT = 3; // SDC standard — never asked

const OP_OF = [
  [/^extend$/i, 'Extend'],
  [/^retract$/i, 'Retract'],
  [/^engage$|^close$|^grip$/i, 'Engage'],
  [/^disengage$|^open$|^release$/i, 'Disengage'],
  [/^servo ?move$|^move$/i, 'ServoMove'],
  [/^index$/i, 'ServoIndex'],
  [/^set ?on$|^set$|^raise$/i, 'SetOn'],
  [/^set ?off$|^clear$|^reset$/i, 'SetOff'],
];
function opOf(verb) {
  for (const [re, op] of OP_OF) if (re.test(String(verb ?? '').trim())) return op;
  return null;
}

// Sensor vocabulary: which polarity a Check title asks for.
const OFF_WORDS = /\b(gone|clear|cleared|empty|absent|removed|taken|away|off|missing|released|open)\b/i;
// A nested "Third failed strip?" decide is the sheet's way of saying "this
// check retries N times" — we read the count and DON'T draw the decide.
const COUNT_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, twice: 2, thrice: 3 };
function retryCountOf(title) {
  const t = String(title ?? '').toLowerCase();
  const m = t.match(/\b(\d+)\b/);
  if (m) return Number(m[1]);
  for (const [w, n] of Object.entries(COUNT_WORDS)) if (t.includes(w)) return n;
  return RETRY_DEFAULT;
}
const isRetryCountDecide = (title) => /\b(fail|failed|retry|retries|attempt|attempts|tries|third|second|\d+(st|nd|rd|th))\b/i.test(String(title ?? ''));

// Grid geometry — the law layout re-spaces everything; these only seed it.
const COL_X = 380;
const STATE_H = 120;
const DEC_H = 96;
const GAP_Y = 100;
const MAIN_X = 220;
const TOP_Y = 80;

const SENSOR_TYPES = new Set(['DigitalSensor', 'AnalogSensor', 'Parameter', 'Robot', 'VisionSystem']);

/**
 * Structured sheet steps → the item shape compileLaneFlow reads. Mirrors
 * CreateStationPage.buildFlowModel's grid-mode output for structured steps
 * ({ action, target, detail, counterpart, deviceId }) so the offline
 * regenerate script and the in-app path compile the SAME thing.
 */
export function stepsToModel(steps) {
  const items = [];
  for (const raw of steps ?? []) {
    if (!raw) continue;
    if (typeof raw === 'string') {
      const [verb, ...rest] = raw.trim().split(/\s+/);
      const it = normLine(verb, rest.join(' '), raw);
      if (it) items.push(it);
      continue;
    }
    const verb = String(raw.action ?? '').trim();
    const target = String(raw.target ?? '').trim();
    const it = normLine(verb, target, `${verb} ${target}`.trim(), raw);
    if (it) items.push(it);
  }
  return { items };
}
function normLine(verb, rest, line, raw = {}) {
  const v = String(verb ?? '').toLowerCase();
  if (v === 'home' || v === 'repeat' || v === 'rejoin' || v === 'yes' || v === 'no') return null;
  if (v === 'decide') return { decide: { title: rest.replace(/\?+\s*$/, '') + '?', detail: raw.detail ?? '' }, deviceId: raw.deviceId ?? null, line };
  if (v === 'loop') return { loopEnd: { label: rest.replace(/^(no|yes)\s*[:—-]\s*/i, (m, w) => `${w.toLowerCase()} — `).trim() }, line };
  if (v === 'wait') {
    const what = rest.replace(/^for\s+/i, '').replace(/\s+signal$/i, '');
    const m = what.match(/^(.+?)'s\s+(.+)$/);
    return { verb: 'Wait', title: m ? m[2] : what, counterpart: raw.counterpart || (m ? m[1] : ''), line };
  }
  if (v === 'signal') {
    const m = rest.match(/^(.+?)\s+to\s+(.+)$/i);
    return { verb: 'Signal', title: m ? m[1] : rest, counterpart: raw.counterpart || (m ? m[2] : ''), line };
  }
  if (v === 'hold') return { verb: 'Hold', title: rest, line };
  const [dev0, ...dd] = rest.split(' — ');
  return {
    verb, device: String(dev0 ?? '').trim(), detail: raw.detail || dd.join(' — ').trim(),
    deviceId: raw.deviceId ?? null, title: `${verb} ${String(dev0 ?? '').trim()}`.trim(),
    // GROUP HINTS (Dan, 2026-09-02 — his v1 multi-action node): 'thenAfterComplete'
    // joins the previous action node, starting after it completes;
    // 'concurrent' joins it starting at the same moment.
    group: raw.group === 'thenAfterComplete' || raw.thenAfterComplete === true ? 'thenAfterComplete'
      : (raw.group === 'concurrent' || raw.concurrent === true || /\b(same time|concurrent|simultaneous)/i.test(String(raw.detail ?? ''))) ? 'concurrent'
      : null,
    line,
  };
}

/** Normalize a buildFlowModel item or a stepsToModel item to one internal kind. */
function kindOf(it) {
  if (!it) return null;
  if (it.decide) return 'decide';
  if (it.loopEnd) return 'loop';
  if (it.verb === 'Wait') return 'wait';
  if (it.verb === 'Signal') return 'signal';
  if (it.verb === 'Hold') return 'hold';
  return 'action';
}
const waitTitle = (it) => String(it.title ?? '').replace(/^wait\s*[—–-]\s*/i, '').replace(/^wait\s+for\s+/i, '').trim();
const signalTitle = (it) => String(it.title ?? '').replace(/^signal\s*[—–-]\s*/i, '').trim();
const counterpartOf = (it) => it.counterpart ?? it.tag?.counterpart ?? String(it.detail ?? '').replace(/^to\s+/i, '') ?? '';

/**
 * @param model   { items } from buildFlowModel(...) or stepsToModel(...)
 * @param opts    { devices: SM devices[], machineName, isPrimary }
 * @returns { nodes, edges }
 */
export function compileLaneFlow(model, { devices = [], machineName = '', isPrimary = true } = {}) {
  const nodes = [];
  const edges = [];

  // ── Device resolution (the sheet's device tables win; ids first).
  const devById = new Map(devices.map((d) => [d.id, d]));
  const devByKey = new Map();
  for (const d of devices) for (const k of [nk(d.displayName), nk(d.name)]) if (k && !devByKey.has(k)) devByKey.set(k, d);
  const findDev = (name, id = null) => {
    if (id && devById.has(id)) return devById.get(id);
    const k = nk(name);
    if (!k) return null;
    if (devByKey.has(k)) return devByKey.get(k);
    for (const [key, d] of devByKey) if (key.includes(k) || k.includes(key)) return d;
    return null;
  };
  const CORE_STOP = new Set(['cylinder', 'slide', 'axis', 'sensor', 'gripper', 'vacuum', 'generator', 'actuator', 'at', 'in', 'is', 'the', 'a']);
  const coreWords = (s) => words(s).filter((w) => !CORE_STOP.has(w) && w.length > 1);
  /** The sensor/signal a Check observes: explicit id → PHYSICAL sensor by word
   *  overlap → the lone digital sensor → a Parameter/flag by word overlap.
   *  A Check observes the world (Dan's grammar); flags are what controls
   *  derives from it, so they only win when no sensor fits. */
  const findSubject = (title, id = null) => {
    if (id && devById.has(id)) return devById.get(id);
    const tw = coreWords(title);
    const bestOf = (list) => {
      let best = null; let bestScore = 0;
      for (const d of list) {
        const dw = coreWords(d.displayName ?? d.name);
        const score = dw.filter((w) => tw.includes(w)).length;
        if (score > bestScore) { best = d; bestScore = score; }
      }
      return best;
    };
    const physical = devices.filter((d) => SENSOR_TYPES.has(d.type) && d.type !== 'Parameter');
    const hit = bestOf(physical);
    if (hit) return hit;
    const digital = physical.filter((d) => d.type === 'DigitalSensor');
    if (digital.length === 1) return digital[0];
    return bestOf(devices.filter((d) => d.type === 'Parameter'));
  };
  /** The v1 sensor-input ref for a device (mirrors lib/availableInputs.js). */
  const sensorInputOf = (d) => {
    const name = d.displayName ?? d.name;
    if (d.type === 'DigitalSensor') return { ref: `${d.id}:sensor`, tag: `i_${d.name}`, label: name, group: 'Sensors' };
    if (d.type === 'Parameter') return { ref: `${d.id}:param`, tag: `p_${d.name}`, label: name, group: 'Parameters' };
    if (d.type === 'AnalogSensor') {
      const sp = (d.setpoints ?? [])[0];
      return { ref: `${d.id}:${sp?.id ?? sp?.name ?? 'sp'}`, tag: `${d.name}${sp?.name ?? ''}RC.InPos`, label: sp ? `${name} - ${sp.name}` : name, group: 'Analog Sensors' };
    }
    return { ref: `${d.id}:sensor`, tag: `i_${d.name}`, label: name, group: 'Sensors' };
  };

  // ── Node factories
  const stateNode = (label, { x, y, actions = [], isInitial = false, isComplete = false, description = null }) => {
    const n = {
      id: uid(), type: 'stateNode', position: { x, y },
      data: { label, actions, isInitial, isComplete, ...(description ? { description } : {}) },
    };
    nodes.push(n);
    return n;
  };
  /**
   * A CHECK node — Dan's grammar: observe + react. `fork` = the sheet drew a
   * genuine two-way branch (decide mode, On and Off both drawn); otherwise it
   * gates the line (verify mode, one continue exit) and RETRY is configured
   * on the node: `retryEnabled`, `retryMax`, `retryTargetNodeId` (set once
   * the target exists — see setRetryTarget); exhaustion → initialization is
   * implicit (codegen), nothing drawn.
   */
  const checkNode = (title, subject, { x, y, condition = 'On', fork = false, retry = false, retryCount = RETRY_DEFAULT }) => {
    const inp = sensorInputOf(subject);
    const other = condition === 'On' ? 'Off' : 'On';
    const mode = fork ? 'decide' : 'verify';
    const n = {
      id: uid(), type: 'decisionNode', position: { x: x + 20, y },
      data: {
        label: `Check ${inp.label}`,
        signalId: `sensor_${inp.ref}`,
        signalName: inp.label, signalSource: inp.group, signalSmName: null, signalType: 'sensor',
        decisionType: 'signal',
        nodeMode: mode,
        exitCount: fork ? 2 : 1,
        // verify: exit1 = the picked polarity; decide: On first (fork labels).
        exit1Label: fork ? 'On' : condition, exit2Label: fork ? 'Off' : other,
        exitLabelsCustomized: false,
        conditionType: condition === 'Off' ? 'off' : 'on',
        sensorRef: inp.ref, sensorTag: inp.tag, sensorInputType: 'bool',
        conditions: [{ ref: inp.ref, tag: inp.tag, label: inp.label, inputType: 'bool', conditionType: condition === 'Off' ? 'off' : 'on', signalType: 'sensor', group: inp.group }],
        retryEnabled: !!retry,
        retryMax: retry ? retryCount : undefined,
        retryTargetNodeId: null,
        retryOnExhausted: 'initialize',
        ptEnabled: false,
        autoOpenPopup: false,
        ...(title ? { sheetTitle: title } : {}),
      },
    };
    nodes.push(n);
    return n;
  };
  /** A WAIT node — a wait on another machine / signal (v1 DecisionNode, wait mode). */
  const waitNode = (what, source, { x, y }) => {
    const n = {
      id: uid(), type: 'decisionNode', position: { x: x + 20, y },
      data: {
        label: `Wait ${what}`,
        decisionType: 'signal', signalName: what, signalSource: source, signalType: 'condition',
        nodeMode: 'wait', exitCount: 1, exit1Label: 'On', exit2Label: 'Off',
        conditionType: 'on',
        conditions: [{ signalName: what, signalSource: source, signalType: 'condition', sensorState: 'on' }],
        conditionLogic: 'AND',
        autoOpenPopup: false,
      },
    };
    nodes.push(n);
    return n;
  };
  /** Fallback decide (no sensor resolvable) — nothing the ME approved is lost. */
  const decideFallback = (title, { x, y }) => {
    const n = {
      id: uid(), type: 'decisionNode', position: { x: x + 20, y },
      data: {
        decisionType: 'signal', signalName: title, signalSource: '', signalType: 'condition',
        nodeMode: 'decide', exitCount: 2, exit1Label: 'Yes', exit2Label: 'No', autoOpenPopup: false,
      },
    };
    nodes.push(n);
    return n;
  };
  const isCheck = (n) => n?.type === 'decisionNode' && (n.data.nodeMode === 'verify' || n.data.nodeMode === 'decide');
  const isActionNode = (n) => n?.type === 'stateNode' && !n.data.isInitial && !n.data.isComplete && (n.data.actions ?? []).length > 0;

  const link = (from, to, { sourceHandle = null, label = '', exit = null, extra = null } = {}) => {
    const e = {
      id: uid(), source: from.id, target: to.id,
      sourceHandle,
      targetHandle: to.type === 'decisionNode' ? 'input' : null,
      type: 'routableEdge',
      data: {
        conditionType: label || exit ? 'custom' : 'trigger',
        label: exit ? exit : label,
        ...(exit ? {
          isDecisionExit: true,
          exitColor: sourceHandle === 'exit-retry' ? 'retry' : sourceHandle === 'exit-fail' ? 'fail' : 'pass',
          outcomeLabel: exit,
        } : {}),
        ...(extra ?? {}),
      },
    };
    edges.push(e);
    return e;
  };
  const hOf = (n) => (n.type === 'decisionNode' ? DEC_H : STATE_H);
  /** The onward handle out of a node's PRIMARY (continue) path. */
  const primaryExit = (n) => {
    if (!n) return null;
    if (n.type === 'decisionNode') return n.data.exitCount === 1 ? 'exit-single' : 'exit-pass';
    return null;
  };
  /** The label on that continue edge: a fork's first outcome; none on a
   *  single-exit wait/verify (CLAUDE.md #23 — exit-single edges carry no label). */
  const primaryLabel = (n) => (n?.type === 'decisionNode' && n.data.exitCount === 2 ? n.data.exit1Label : null);

  /** Device action step → legacy action row. */
  const actionOf = (it) => {
    const op = opOf(it.verb);
    const dev = findDev(it.device, it.deviceId);
    if (!op || !dev) return null;
    return {
      id: uid(), deviceId: dev.id, operation: op,
      ...(op === 'ServoMove' && it.detail ? { positionName: String(it.detail) } : {}),
      ...(op === 'ServoIndex' && it.detail ? { indexLabel: String(it.detail) } : {}),
    };
  };

  /**
   * Place one plain step as a node at (x, y). Returns { node, merged } — merged
   * when a concurrent action joined the previous node instead (law (e)).
   */
  const placeStep = (it, x, y, prevNode) => {
    const kind = kindOf(it);
    if (kind === 'wait') return { node: waitNode(waitTitle(it), counterpartOf(it), { x, y }) };
    if (kind === 'signal') {
      // SIGNALS ARE NOT DEVICES (Dan, 2026-09-02): an outgoing signal is a v1
      // STATE SIGNAL (p_ output, SIGNALS panel) — TRUE while the machine is in
      // the step that follows. Nothing is drawn; sequenceSm files it.
      pendingSignals.push({ name: String(signalTitle(it)).replace(/\s+/g, '_'), counterpart: counterpartOf(it) });
      return { node: null, merged: true };
    }
    if (kind === 'hold') return { node: stateNode(`Hold — ${String(it.title ?? '').replace(/^hold\s*[—–-]?\s*/i, '')}`, { x, y }) };
    const act = actionOf(it);
    const grp = it.group ?? (it.concurrent ? 'concurrent' : null);
    if (act && grp && isActionNode(prevNode) && (prevNode.data.actions ?? []).every((a) => !a.pickerV2)) {
      // Law (e): the v1 multi-action node — this action joins the previous
      // node; the previous row's advance condition says when this one starts.
      const prevActs = prevNode.data.actions;
      prevActs[prevActs.length - 1].advanceCondition = { type: grp === 'concurrent' ? 'none' : 'onComplete' };
      prevActs.push(act);
      return { node: prevNode, merged: true };
    }
    return { node: stateNode(String(it.title ?? it.line ?? '').trim() || 'Step', { x, y, actions: act ? [act] : [] }) };
  };
  /** Outgoing signals waiting for the node they belong to (state signals). */
  const pendingSignals = [];
  const signals = [];
  const bindSignals = (node) => {
    if (!node) return;
    for (const sgn of pendingSignals.splice(0)) {
      signals.push({ name: sgn.name, stateNodeId: node.id, stateName: node.data.label ?? '', reachedMode: 'in', description: sgn.counterpart ? `to ${sgn.counterpart}` : '' });
    }
  };

  // ── Split the item list into MAIN + LANES at each loopEnd (the sheet's
  //    lane-grid rule: main runs to its first Loop; each later Loop closes
  //    one lane).
  const items = (model?.items ?? []).filter((it) => it && !it.branch);
  const segs = [];
  let cur = [];
  for (const it of items) { cur.push(it); if (kindOf(it) === 'loop') { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const main = segs[0] ?? [];
  const laneSegs = segs.slice(1);

  // Pre-scan: each main decide's lane decides its shape. A lane that redoes
  // steps and loops back (or carries a nested "third failed?" count decide)
  // is a RETRY; anything after that nested decide (the sheet's exhaustion /
  // stack-change lane) is NOT drawn — exhaustion → initialization (law (c)).
  const mainDecideCount = main.filter((it) => kindOf(it) === 'decide').length;
  const level1 = laneSegs.slice(0, mainDecideCount);
  const laneShape = (seg) => {
    const body = (seg ?? []).filter((it) => kindOf(it) !== 'loop');
    const loopEnd = (seg ?? []).find((it) => kindOf(it) === 'loop')?.loopEnd ?? null;
    const nestedIdx = body.findIndex((it) => kindOf(it) === 'decide');
    const nested = nestedIdx >= 0 ? body[nestedIdx] : null;
    const redo = nestedIdx >= 0 ? body.slice(0, nestedIdx) : body;
    const retry = (!!nested && isRetryCountDecide(nested.decide.title)) || (!nested && !!loopEnd);
    return { body, loopEnd, nested, redo, retry, retryCount: nested ? retryCountOf(nested.decide.title) : RETRY_DEFAULT };
  };

  // ── The initial node (Home never draws as a step — it IS this node).
  const init = stateNode('Home', { x: MAIN_X, y: TOP_Y, isInitial: true });
  let y = TOP_Y + STATE_H + GAP_Y;
  let prev = init;
  const mainNodes = [];        // ordered main-line nodes (loop-target candidates)
  const mainChecks = [];       // { node, y, shape } in order
  let mainLoop = null;
  let decideIdx = 0;

  for (const it of main) {
    const kind = kindOf(it);
    if (kind === 'loop') { mainLoop = it.loopEnd; continue; }
    if (kind === 'decide') {
      const seg = level1[decideIdx++] ?? null;
      const shape = laneShape(seg);
      const subject = findSubject(it.decide.title, it.deviceId);
      let n;
      if (subject) {
        const condition = OFF_WORDS.test(it.decide.title) ? 'Off' : 'On';
        const fork = !!seg && !shape.retry; // a real two-way branch the sheet drew
        n = checkNode(it.decide.title, subject, { x: MAIN_X, y, condition, fork, retry: shape.retry, retryCount: shape.retryCount });
      } else {
        n = decideFallback(it.decide.title, { x: MAIN_X, y });
      }
      bindSignals(n);
      link(prev, n, { sourceHandle: primaryExit(prev), exit: primaryLabel(prev) });
      mainChecks.push({ node: n, y, shape });
      mainNodes.push({ node: n, it });
      prev = n;
      y += hOf(n) + GAP_Y;
      continue;
    }
    const { node: n, merged } = placeStep(it, MAIN_X, y, prev);
    if (merged) continue;
    bindSignals(n);
    link(prev, n, { sourceHandle: primaryExit(prev), exit: primaryLabel(prev), label: it.cond ?? '' });
    mainNodes.push({ node: n, it });
    prev = n;
    y += hOf(n) + GAP_Y;
  }
  const lastMain = prev;
  bindSignals(lastMain); // a trailing signal belongs to the last step

  // ── Loop-target resolution: the plain-words loop point names a main step
  //    ("back to Extend Horizontal Shuttle", "shuttle out again", "back to the
  //    pick wait"). Word overlap against each main node's verb + device +
  //    title; ties go to the LATEST candidate (closest above the loop).
  const SYN = { out: 'extend', present: 'extend', up: 'extend', in: 'retract', back: 'retract', down: 'retract', home: 'retract' };
  const LOOP_STOP = new Set(['no', 'yes', 'back', 'to', 'the', 'a', 'again', 'loop', 'and', 'then', 'go', 'goes', 'return', 'returns']);
  const nodeTokens = (entry) => {
    const t = new Set();
    const { node, it } = entry;
    for (const w of words(it?.title)) t.add(w);
    for (const w of words(it?.device)) t.add(w);
    if (kindOf(it) === 'wait') { t.add('wait'); for (const w of words(waitTitle(it))) t.add(w); }
    if (kindOf(it) === 'decide') { t.add('check'); for (const w of words(it.decide?.title)) t.add(w); }
    for (const a of node.data.actions ?? []) {
      const d = devById.get(a.deviceId);
      for (const w of words(d?.displayName ?? d?.name)) t.add(w);
      for (const w of words(a.operation)) t.add(w);
    }
    return t;
  };
  const resolveTarget = (label) => {
    let txt = String(label ?? '').toLowerCase().replace(/^(no|yes)\s*[—–:-]\s*/, '');
    const explicit = txt.match(/back to\s+(?:the\s+)?(.+)$/)?.[1] ?? null;
    if (explicit) txt = explicit;
    const raw = words(txt).filter((w) => !LOOP_STOP.has(w));
    const toks = raw.map((w) => SYN[w] ?? w);
    if (!toks.length) return null;
    if (/\b(setup|set up|start|beginning|top|new cycle|first step)\b/.test(txt) && !explicit) {
      return mainNodes[0]?.node ?? null;
    }
    let best = null; let bestScore = 0;
    for (const entry of mainNodes) {
      const nt = nodeTokens(entry);
      const score = toks.filter((w) => nt.has(w)).length + (raw.some((w) => nt.has(w) && !SYN[w]) ? 0.5 : 0);
      if (score >= bestScore && score > 0) { best = entry.node; bestScore = score; }
    }
    if (!best && /\b(setup|stack)\b/.test(txt)) return mainNodes[0]?.node ?? null;
    return best;
  };

  // ── The main next-cycle loop (law (f)) — or, with no loop, Cycle Complete.
  let cycleComplete = null;
  const ensureComplete = () => {
    if (!cycleComplete) cycleComplete = stateNode('Cycle Complete', { x: MAIN_X, y, isComplete: true });
    return cycleComplete;
  };
  if (mainLoop) {
    const tgt = resolveTarget(mainLoop.label) ?? mainNodes[0]?.node ?? null;
    if (tgt && lastMain !== init) {
      link(lastMain, tgt, { sourceHandle: primaryExit(lastMain), exit: primaryLabel(lastMain), label: mainLoop.label ?? '' });
    } else if (isPrimary) {
      link(lastMain, ensureComplete(), { sourceHandle: primaryExit(lastMain), exit: primaryLabel(lastMain) });
    }
  } else if (isPrimary && lastMain !== init) {
    link(lastMain, ensureComplete(), { sourceHandle: primaryExit(lastMain), exit: primaryLabel(lastMain) });
  }

  // ── Each Check's lane.
  for (const { node: check, y: cy, shape } of mainChecks) {
    if (!shape || (!shape.body.length && !shape.loopEnd)) continue;
    const loopTgt = shape.loopEnd ? resolveTarget(shape.loopEnd.label) : null;

    if (isCheck(check) && shape.retry) {
      // RETRY — configured on the check, the loop edge draws itself. Redo
      // steps the sheet approved before the loop point stay drawn (left
      // lane), then return to the named step; with none, the retry goes
      // straight back to that step.
      const rx = MAIN_X - COL_X;
      let ly = cy + STATE_H + GAP_Y;
      let bprev = null;
      for (const it of shape.redo) {
        // A Hold that only re-presents before looping back to a WAIT is the
        // wait itself — re-waiting IS the hold (no PLC action to draw).
        if (kindOf(it) === 'hold' && loopTgt?.type === 'decisionNode' && shape.redo.length === 1) continue;
        const { node: n, merged } = placeStep(it, rx, ly, bprev);
        if (merged) continue;
        if (bprev) link(bprev, n, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev) });
        // The first redo node is where the retry goes back to.
        if (!check.data.retryTargetNodeId) check.data.retryTargetNodeId = n.id;
        bprev = n;
        ly += hOf(n) + GAP_Y;
      }
      const firstRedo = check.data.retryTargetNodeId ? nodes.find((n) => n.id === check.data.retryTargetNodeId) : null;
      const target = firstRedo ?? loopTgt ?? mainNodes[0]?.node ?? null;
      if (target) {
        check.data.retryTargetNodeId = target.id;
        // The self-drawn retry loop (Dan: no hand-drawing loops).
        link(check, target, { sourceHandle: 'exit-retry', exit: 'Retry', extra: { autoRetryLoop: true } });
        if (bprev && loopTgt) link(bprev, loopTgt, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev), label: shape.loopEnd?.label ?? '' });
        else if (bprev) link(bprev, mainNodes[0]?.node ?? check, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev), label: shape.loopEnd?.label ?? '' });
      }
      // Exhausted → initialization: implicit, nothing drawn (law (c)).
      continue;
    }

    // A genuine two-way fork: the alternate lane on the right, ending where
    // its loop point says (or at a plain-words cap so nothing is lost).
    const altLabel = check.type === 'decisionNode' ? check.data.exit2Label : 'No';
    const x = MAIN_X + COL_X;
    let ly = cy + STATE_H + GAP_Y;
    let bprev = null;
    for (const it of shape.body) {
      if (kindOf(it) === 'decide') {
        const subject = findSubject(it.decide.title, it.deviceId);
        const n = subject
          ? checkNode(it.decide.title, subject, { x, y: ly, condition: OFF_WORDS.test(it.decide.title) ? 'Off' : 'On', fork: true })
          : decideFallback(it.decide.title, { x, y: ly });
        if (bprev) link(bprev, n, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev) });
        else link(check, n, { sourceHandle: 'exit-fail', exit: altLabel });
        bprev = n; ly += hOf(n) + GAP_Y;
        continue;
      }
      const { node: n, merged } = placeStep(it, x, ly, bprev);
      if (merged) continue;
      if (bprev) link(bprev, n, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev) });
      else link(check, n, { sourceHandle: 'exit-fail', exit: altLabel });
      bprev = n; ly += hOf(n) + GAP_Y;
    }
    if (shape.loopEnd) {
      const wordsLbl = String(shape.loopEnd.label ?? '').trim();
      if (loopTgt) {
        if (bprev) link(bprev, loopTgt, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev), label: wordsLbl });
        else link(check, loopTgt, { sourceHandle: 'exit-fail', exit: altLabel, label: wordsLbl });
      } else {
        const cap = stateNode(wordsLbl || 'rejoins the cycle', { x, y: ly });
        if (bprev) link(bprev, cap, { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev) });
        else link(check, cap, { sourceHandle: 'exit-fail', exit: altLabel });
      }
    } else if (bprev && isPrimary) {
      link(bprev, ensureComplete(), { sourceHandle: primaryExit(bprev), exit: primaryLabel(bprev) });
    }
  }

  // Cycle Complete sits at the bottom of the main column.
  if (cycleComplete) {
    const maxY = Math.max(...nodes.filter((n) => n !== cycleComplete).map((n) => n.position.y + hOf(n)));
    cycleComplete.position = { x: MAIN_X, y: maxY + GAP_Y };
  }

  return { nodes, edges, signals };
}
