/**
 * compileLaneFlow.js — v3 ONE-TIME MIGRATION: the sheet's structured
 * sequence (the buildFlowModel item list — Decide/Loop lane grid, Waits,
 * Signals, Holds, device actions) → v1 canvas nodes/edges for ONE machine.
 *
 * Dan (2026-09-02, v3 decision): the SM's nodes/edges ARE the sequence. This
 * compile runs once, the first time a machine's SEQUENCE section opens in
 * v3; afterwards the canvas is authoritative and this is never re-run.
 *
 * Diagram laws honored (root CLAUDE.md + Dan's branch rules):
 *   - every edge `type: 'routableEdge'`
 *   - StateNode target → targetHandle null; DecisionNode target → 'input'
 *   - decide: primary/continue exits the BOTTOM (`exit-pass`), the "no" lane
 *     exits the RIGHT (`exit-fail`); labels are just Yes / No
 *   - lanes sit in their own column right of the main line; a second-level
 *     lane (retry exhausted) sits one column farther right
 *   - a lane's plain-words loop point ("back to Extend Horizontal Shuttle")
 *     becomes a return edge to the step it names when that step resolves;
 *     otherwise the lane ends in a plain-words terminal node so nothing the
 *     engineer approved is lost (he edits from there on the canvas)
 *   - ONE initial node; the primary machine gets ONE "Cycle Complete"
 *
 * Pure logic — no React, no store.
 */

let _n = 0;
const uid = () => `id_${Date.now().toString(36)}_${(++_n).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const OP_OF = [
  [/^extend$/i, 'Extend'],
  [/^retract$/i, 'Retract'],
  [/^engage$|^close$|^grip$/i, 'Engage'],
  [/^disengage$|^open$|^release$/i, 'Disengage'],
  [/^servo ?move$|^move$/i, 'ServoMove'],
  [/^index$/i, 'ServoIndex'],
];
function opOf(verb) {
  for (const [re, op] of OP_OF) if (re.test(String(verb ?? '').trim())) return op;
  return null;
}

// Grid geometry — v1-readable pitch (Dan: gap ≈ 100px, lanes one column out).
const COL_X = 340;
const STATE_H = 120;
const DEC_H = 96;
const GAP_Y = 100;
const MAIN_X = 220;
const TOP_Y = 80;

/**
 * @param model   buildFlowModel(...) output — { items: [...] }
 * @param opts    { devices: SM devices[], machineName, isPrimary }
 * @returns { nodes, edges }
 */
export function compileLaneFlow(model, { devices = [], machineName = '', isPrimary = true } = {}) {
  const nodes = [];
  const edges = [];
  const devByKey = new Map();
  for (const d of devices) {
    for (const k of [nk(d.displayName), nk(d.name)]) if (k && !devByKey.has(k)) devByKey.set(k, d);
  }
  const findDev = (name) => {
    const k = nk(name);
    if (!k) return null;
    if (devByKey.has(k)) return devByKey.get(k);
    for (const [key, d] of devByKey) if (key.includes(k) || k.includes(key)) return d;
    return null;
  };

  const stateNode = (label, { x, y, actions = [], isInitial = false, isComplete = false, description = null }) => {
    const n = {
      id: uid(), type: 'stateNode', position: { x, y },
      data: { label, actions, isInitial, isComplete, ...(description ? { description } : {}) },
    };
    nodes.push(n);
    return n;
  };
  const decideNode = (title, { x, y, exitCount = 2, mode = 'decide', source = '' }) => {
    const n = {
      id: uid(), type: 'decisionNode', position: { x: x + 20, y },
      data: {
        decisionType: 'signal', signalName: title, signalSource: source, signalType: 'condition',
        nodeMode: mode, exitCount,
        exit1Label: mode === 'decide' ? 'Yes' : 'Pass', exit2Label: mode === 'decide' ? 'No' : 'Fail',
      },
    };
    nodes.push(n);
    return n;
  };
  const link = (from, to, { sourceHandle = null, label = '', exit = null } = {}) => {
    edges.push({
      id: uid(), source: from.id, target: to.id,
      sourceHandle,
      targetHandle: to.type === 'decisionNode' ? 'input' : null,
      type: 'routableEdge',
      data: {
        conditionType: label ? 'custom' : 'trigger',
        label,
        ...(exit ? { isDecisionExit: true, exitColor: exit === 'No' ? 'fail' : 'pass', outcomeLabel: exit } : {}),
      },
    });
  };
  const hOf = (n) => (n.type === 'decisionNode' ? DEC_H : STATE_H);

  /** One flow item → a node at (x, y). Returns the node. */
  const itemNode = (it, x, y) => {
    if (it.decide) return decideNode(it.decide.title, { x, y, mode: 'decide', exitCount: 2 });
    if (it.verb === 'Wait') {
      // A wait is a real node on the lane grid (Dan, 2026-09-01): a single-
      // exit WAIT pill — the v1 shape for "wait for X, then continue".
      const what = String(it.title ?? '').replace(/^wait\s*[—–-]\s*/i, '');
      return decideNode(what, { x, y, mode: 'wait', exitCount: 1, source: it.tag?.counterpart ?? '' });
    }
    if (it.verb === 'Signal' || it.verb === 'Hold') {
      return stateNode(String(it.title ?? it.line ?? it.verb), { x, y, ...(it.detail ? { description: it.detail } : {}) });
    }
    const op = opOf(it.verb);
    const dev = findDev(it.device);
    const actions = op && dev ? [{
      id: uid(), deviceId: dev.id, operation: op,
      ...(op === 'ServoMove' && it.detail ? { positionName: String(it.detail) } : {}),
    }] : [];
    return stateNode(String(it.title ?? it.line ?? '').trim() || 'Step', { x, y, actions });
  };
  const exitOf = (n) => (n.type === 'decisionNode'
    ? (n.data.exitCount === 1 ? 'exit-single' : 'exit-pass')
    : null);

  // ── Split the item list into MAIN + LANES at each loopEnd (SheetFlow rule).
  const items = (model?.items ?? []).filter((it) => it && !it.branch);
  const segs = [];
  let cur = [];
  for (const it of items) { cur.push(it); if (it.loopEnd) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const main = segs[0] ?? [];
  const laneSegs = segs.slice(1);

  // ── The initial node (Home never draws as a step — it IS this node).
  const init = stateNode(isPrimary ? 'Home / Initial' : `${machineName || 'Machine'} — Home`, {
    x: MAIN_X, y: TOP_Y, isInitial: true,
  });
  let y = TOP_Y + STATE_H + GAP_Y;
  let prev = init;
  let pendingExit = null;   // 'Yes' rides the edge out of a decide
  let pendingCond = null;   // a non-grid wait folded onto the next edge
  const mainSteps = [];     // { node, title } for loop-target resolution
  const mainDecides = [];   // { node, y, consumed }
  let mainLoop = null;

  for (const it of main) {
    if (it.loopEnd) { mainLoop = { ...it.loopEnd, from: prev }; continue; }
    const n = itemNode(it, MAIN_X, y);
    link(prev, n, {
      sourceHandle: exitOf(prev),
      label: pendingCond ?? (it.decide?.cond ?? it.cond ?? ''),
      exit: pendingExit,
    });
    pendingCond = null;
    pendingExit = it.decide ? 'Yes' : null;
    if (it.decide) mainDecides.push({ node: n, y, consumed: false });
    else mainSteps.push({ node: n, title: String(it.title ?? '') });
    prev = n;
    y += hOf(n) + GAP_Y;
  }

  const resolveTarget = (label) => {
    const tt = String(label ?? '').match(/back to\s+(?:the\s+)?(.+)$/i)?.[1]?.trim().toLowerCase();
    if (!tt) return null;
    const hit = mainSteps.find((s) => s.title.toLowerCase().includes(tt) || tt.includes(s.title.toLowerCase()));
    return hit?.node ?? null;
  };

  // The main next-cycle loop: a return edge to the step the label names;
  // the primary machine ends the drawn cycle at ONE Cycle Complete.
  if (isPrimary) {
    const done = stateNode('Cycle Complete', { x: MAIN_X, y, isComplete: true });
    link(prev, done, { sourceHandle: exitOf(prev), exit: pendingExit, label: mainLoop?.cond ?? '' });
    y += STATE_H + GAP_Y;
  } else if (mainLoop && prev !== init) {
    const tgt = resolveTarget(mainLoop.label) ?? init;
    link(prev, tgt, { sourceHandle: exitOf(prev), exit: pendingExit, label: mainLoop.label ?? '' });
  }

  // ── Lanes: "no" off each main decide in order, then second-level lanes
  //    (retry exhausted) fed by the lane decides still dangling.
  const colBottom = {};
  const dangling = [];
  for (const seg of laneSegs) {
    const body = seg.filter((x) => !x.loopEnd);
    const loopEnd = seg.find((x) => x.loopEnd)?.loopEnd ?? null;
    if (!body.length && !loopEnd) continue;
    let feeders; let level;
    const mfree = mainDecides.find((d) => !d.consumed);
    if (mfree) {
      mfree.consumed = true;
      feeders = [{ node: mfree.node, y: mfree.y, exit: 'No' }];
      level = 1;
    } else if (dangling.length) {
      feeders = dangling.splice(0).map((d) => ({ node: d.node, y: d.y, exit: 'Yes' }));
      level = 2;
    } else {
      feeders = [{ node: prev, y: Math.max(TOP_Y, y - STATE_H - GAP_Y), exit: null }];
      level = 1;
    }
    const x = MAIN_X + level * COL_X;
    const feedMaxY = Math.max(...feeders.map((f) => f.y));
    let ly = colBottom[level] === undefined
      ? feedMaxY + DEC_H + GAP_Y
      : Math.max(feedMaxY + DEC_H + GAP_Y, colBottom[level] + GAP_Y);
    let bprev = null;
    let first = true;
    let laneExit = null;
    for (const it of body) {
      const n = itemNode(it, x, ly);
      if (first) {
        for (const f of feeders) {
          link(f.node, n, {
            sourceHandle: f.node.type === 'decisionNode' ? 'exit-fail' : null,
            exit: f.exit, label: it.decide?.cond ?? it.cond ?? '',
          });
        }
        first = false;
      } else {
        link(bprev, n, { sourceHandle: exitOf(bprev), exit: laneExit, label: it.decide?.cond ?? it.cond ?? '' });
      }
      laneExit = it.decide ? 'Yes' : null;
      if (it.decide) dangling.push({ node: n, y: ly });
      bprev = n;
      ly += hOf(n) + GAP_Y;
    }
    if (loopEnd) {
      const tgt = resolveTarget(loopEnd.label);
      const words = String(loopEnd.label ?? '').trim();
      if (tgt && bprev) {
        // A drawn return to the named step (the v1 U-route draws it).
        link(bprev, tgt, { sourceHandle: exitOf(bprev), exit: laneExit, label: words });
      } else {
        // Plain-words branch end — the loop point stays visible as a node
        // the engineer can rewire on the canvas.
        const cap = stateNode(words || 'rejoins the cycle', { x, y: ly });
        if (bprev) link(bprev, cap, { sourceHandle: exitOf(bprev), exit: laneExit, label: loopEnd.cond ?? '' });
        else for (const f of feeders) link(f.node, cap, { sourceHandle: f.node.type === 'decisionNode' ? 'exit-fail' : null, exit: f.exit });
        ly += STATE_H + GAP_Y;
      }
    }
    colBottom[level] = ly - GAP_Y;
  }

  return { nodes, edges };
}
