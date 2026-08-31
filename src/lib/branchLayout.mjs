/**
 * branchLayout.mjs — Column-aware layout for BRANCHING state diagrams.
 *
 * Single source of truth shared by:
 *   - Canvas.jsx one-shot `_autoLayout` re-space (ESM import, measured heights)
 *   - agentGenerator/diagramAuthor.js normalizeLayout (dynamic import(), estimated heights)
 *
 * .mjs extension is deliberate: the repo package.json has no "type" field, so
 * plain .js is CJS to Node — .mjs guarantees Node treats this as ESM so the
 * CJS server-side generator can `await import()` it. Vite imports .mjs fine.
 *
 * LAYOUT LAW (Dan's conventions — see CLAUDE.md + branch-routing memory):
 *   - Main flow reads as ONE vertical column (the spine).
 *   - exit-pass (primary) continues STRAIGHT DOWN in the source's column.
 *   - exit-fail (alternate) branch chain gets its own column a FULL LANE
 *     RIGHT (+420); exit-retry a full lane LEFT. Sub-branches (branch off a
 *     branch) go only HALF a lane further (+210).
 *   - A branch chain's nodes STACK in their own column, never staggered.
 *   - A branch head sits BELOW its source's bottom edge, so a side-handle
 *     exit always routes as a clean forward L-bend (right/left then down).
 *   - Constant GAP (50px) of EMPTY space between stacked nodes — pitch
 *     adapts to node height.
 *   - Merge targets (2+ incoming edges) get extra top clearance so return
 *     edges re-enter BETWEEN two nodes, never crammed against the top.
 *   - Loop-back rails hug the diagram (base offset 60) and STAGGER when
 *     several rails share a side + overlapping vertical span, so no two
 *     loops draw on the same line.
 */

export const LAYOUT = {
  GAP: 50,            // empty px between a node's bottom and the next node's top
  LANE: 420,          // main column → first branch column
  SUBLANE: 210,       // branch column → sub-branch column
  MERGE_EXTRA: 40,    // extra top clearance for a merge target
  LOOP_BASE: 60,      // first loop rail offset past node bounds
  LOOP_STEP: 28,      // stagger between overlapping rails on the same side
  DROP_BASE: 40,      // first loop bottom-drop above target
  DROP_STEP: 24,      // stagger between drops entering the same target
  NODE_W: 240,
};

const PRIMARY_HANDLES = new Set([null, undefined, 'exit-pass', 'exit-single']);

/**
 * Default width estimate when no measured width exists. THE CENTER LAW
 * APPLIES TO EVERY NODE TYPE — a column means every node's CENTER sits on
 * the column line regardless of its own width. StateNode is hard-capped at
 * 240px in CSS, but DecisionNode renders `max(240, exitCount*70)` when it
 * has more than 2 exits — positioning such a node as-if 240 puts its center
 * (and therefore its bottom/top handles) off the column line, and every edge
 * jogs at its face. Callers that HAVE real measured widths (Canvas) should
 * still pass getWidth; this estimator is the floor for the server-side
 * generator and any other estimate-based caller.
 */
export function estimateNodeWidth(node) {
  const m = node?.measured?.width;
  if (m > 0) return m;
  if (node?.type === 'decisionNode') {
    const ec = Number(node.data?.exitCount ?? 1);
    return ec > 2 ? Math.max(LAYOUT.NODE_W, ec * 70) : LAYOUT.NODE_W;
  }
  return LAYOUT.NODE_W;
}

/**
 * Compute a column-aware layout for one diagram.
 *
 * @param {Array} nodes  — store nodes (position, data, optional measured)
 * @param {Array} edges  — store edges (source, target, sourceHandle, data)
 * @param {Object} opts
 *   - getHeight(node) → px  (default: measured.height ?? 80)
 *   - gap, lane, subLane, mergeExtra … override LAYOUT constants
 * @returns {{
 *   positions: Map<nodeId, {x, y}>,       // every laid-out node
 *   edgeParams: Map<edgeId, Object>,      // FULL loop-param object per back
 *     // edge — apply by REPLACING the loop keys (loopOffset, loopTopDrop,
 *     // loopBottomDrop, loopSide) with exactly what's here (absent = remove).
 *   changed: boolean,
 * }}
 */
export function layoutBranchDiagram(nodes, edges, opts = {}) {
  const C = { ...LAYOUT, ...opts };
  const getH = opts.getHeight ?? ((n) => n.measured?.height ?? 80);
  // COLUMNS ARE CENTER-ALIGNED. `colX` below holds a column's CENTER x, never
  // a left edge — nodes in a column have different widths (a Decide pill is
  // wider than a SetOn row), and left-edge alignment misaligns their bottom/top
  // handles. That offset made every edge exit the bottom-center handle and
  // immediately jog sideways at the node face. Center-aligning makes the
  // primary spine a single straight vertical, no bends at all.
  const getW = opts.getWidth ?? estimateNodeWidth;
  const positions = new Map();
  const edgeParams = new Map();
  const result = { positions, edgeParams, changed: false };
  if (!Array.isArray(nodes) || nodes.length < 2 || !Array.isArray(edges)) return result;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const initial = nodes.find(n => n.data?.isInitial);
  if (!initial) return result;

  const outBySource = new Map();
  const inByTarget = new Map();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    (outBySource.get(e.source) ?? outBySource.set(e.source, []).get(e.source)).push(e);
    (inByTarget.get(e.target) ?? inByTarget.set(e.target, []).get(e.target)).push(e);
  }

  // Deterministic exploration order: primary exits first, then fail, then retry.
  const handleRank = (h) => PRIMARY_HANDLES.has(h ?? null) ? 0 : h === 'exit-fail' ? 1 : 2;
  for (const list of outBySource.values()) {
    list.sort((a, b) => handleRank(a.sourceHandle) - handleRank(b.sourceHandle));
  }

  // ── 1. Back-edge detection (DFS from initial; edge to a node on the
  //       current stack = back edge / loop). Non-back edges form the DAG
  //       used for column + layer assignment.
  const backEdges = new Set();
  {
    const state = new Map(); // 0=unvisited 1=on-stack 2=done
    const walk = (id) => {
      state.set(id, 1);
      for (const e of outBySource.get(id) ?? []) {
        const s = state.get(e.target) ?? 0;
        if (s === 1) backEdges.add(e.id);
        else if (s === 0) walk(e.target);
      }
      state.set(id, 2);
    };
    walk(initial.id);
  }
  const isForward = (e) => !backEdges.has(e.id);

  // ── 2. Column assignment (BFS over forward edges; first claim wins, and
  //       primary chains are explored before branches at every node).
  // Column keys are CENTERS. Seed from the initial node's current center so a
  // re-layout doesn't translate the whole diagram sideways.
  const mainX = (initial.position?.x ?? 300) + getW(initial) / 2;
  const colX = new Map([[initial.id, mainX]]);
  {
    const queue = [initial.id];
    const seen = new Set([initial.id]);
    while (queue.length) {
      const id = queue.shift();
      const x = colX.get(id);
      for (const e of outBySource.get(id) ?? []) {
        if (!isForward(e)) continue;
        if (!colX.has(e.target)) {
          if (PRIMARY_HANDLES.has(e.sourceHandle ?? null)) {
            colX.set(e.target, x);
          } else {
            const step = x === mainX ? C.LANE : C.SUBLANE;
            colX.set(e.target, e.sourceHandle === 'exit-retry' ? x - step : x + step);
          }
        }
        if (!seen.has(e.target)) { seen.add(e.target); queue.push(e.target); }
      }
    }
  }

  // Merge info: extra clearance when 2+ edges enter a node; back edges
  // entering the same target need staggered bottom drops, so clearance grows.
  const backInCount = new Map();
  for (const e of edges) {
    if (backEdges.has(e.id)) backInCount.set(e.target, (backInCount.get(e.target) ?? 0) + 1);
  }
  const mergeExtraFor = (id) => {
    const totalIn = (inByTarget.get(id) ?? []).length;
    if (totalIn < 2) return 0;
    // Clearance above a merge target must fit the DEEPEST staggered
    // bottom-drop of the loops entering it (drops go DROP_BASE, +STEP, …),
    // plus a little air. GAP already provides part of the room.
    const nBack = backInCount.get(id) ?? 0;
    const maxDrop = C.DROP_BASE + Math.max(0, nBack - 1) * C.DROP_STEP;
    return Math.max(C.MERGE_EXTRA, maxDrop + 12 - C.GAP);
  };

  // ── 3. Layering: longest-path Y over forward edges (Kahn), then per-column
  //       constant-gap compaction. Iterate until stable — a compaction push
  //       can invalidate a cross-column "below source" constraint.
  const laidOut = [...colX.keys()];
  const y = new Map([[initial.id, initial.position?.y ?? 80]]);
  const indeg = new Map(laidOut.map(id => [id, 0]));
  for (const e of edges) {
    if (!isForward(e) || !colX.has(e.source) || !colX.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const relaxForward = () => {
    const q = laidOut.filter(id => (indeg.get(id) ?? 0) === 0);
    const deg = new Map(indeg);
    while (q.length) {
      const id = q.shift();
      const n = byId.get(id);
      const base = (y.get(id) ?? 80) + getH(n) + C.GAP;
      for (const e of outBySource.get(id) ?? []) {
        if (!isForward(e) || !colX.has(e.target)) continue;
        const want = base + mergeExtraFor(e.target);
        if ((y.get(e.target) ?? -Infinity) < want) y.set(e.target, want);
        deg.set(e.target, deg.get(e.target) - 1);
        if (deg.get(e.target) === 0) q.push(e.target);
      }
    }
  };
  const compactColumns = () => {
    let moved = false;
    const cols = new Map();
    for (const id of laidOut) {
      const k = colX.get(id);
      (cols.get(k) ?? cols.set(k, []).get(k)).push(id);
    }
    for (const ids of cols.values()) {
      ids.sort((a, b) => (y.get(a) ?? 0) - (y.get(b) ?? 0));
      for (let i = 1; i < ids.length; i++) {
        const prev = ids[i - 1];
        const minY = (y.get(prev) ?? 0) + getH(byId.get(prev)) + C.GAP
          + mergeExtraFor(ids[i]);
        if ((y.get(ids[i]) ?? 0) < minY) { y.set(ids[i], minY); moved = true; }
      }
    }
    return moved;
  };
  relaxForward();
  for (let i = 0; i < 10; i++) {
    if (!compactColumns()) break;
    relaxForward();
  }

  // colX is the column CENTER — convert to a left-edge position per node using
  // that node's OWN width, so every node in a column shares a center line.
  for (const id of laidOut) {
    positions.set(id, {
      x: Math.round(colX.get(id) - getW(byId.get(id)) / 2),
      y: Math.round(y.get(id) ?? 80),
    });
  }
  // Nodes unreachable from the initial keep their stored position.
  for (const n of nodes) {
    if (!positions.has(n.id)) positions.set(n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 });
  }

  // ── 4. Loop-back LANES (Dan's law: every loop gets its OWN track; loops
  //       may go left OR right — pick per loop by congestion; multiple
  //       arrivals into one node stagger at distinct heights so each loop
  //       is individually traceable).
  //
  //       For every back edge we emit a FULL param object (loopSide,
  //       loopOffset, loopTopDrop, loopBottomDrop) computed against the
  //       final node rects, so the router draws exactly this geometry —
  //       horizontals land in clear bands BETWEEN nodes, rails hug the
  //       outermost node they pass, concentric loops nest inner→outer.
  const backList = edges.filter(e => backEdges.has(e.id));
  const posOf = (id) => positions.get(id) ?? byId.get(id).position;
  const rects = nodes.map(n => ({
    id: n.id, x: posOf(n.id).x, y: posOf(n.id).y,
    w: getW(n), h: getH(n),
  }));
  const hBlockers = (yy, x1, x2) => rects.filter(r =>
    yy > r.y - 12 && yy < r.y + r.h + 12
    && Math.max(x1, x2) > r.x - 4 && Math.min(x1, x2) < r.x + r.w + 4);

  // Geometry of one back edge as the router sees it (handle centers +
  // NODE_W-based bounds — mirrors computeAutoRoute exactly).
  const geoOf = (e) => {
    const s = byId.get(e.source), t = byId.get(e.target);
    const sp = posOf(e.source), tp = posOf(e.target);
    const sw = getW(s), tw = getW(t);
    const sideHandle = e.sourceHandle === 'exit-fail' ? 'right'
                     : e.sourceHandle === 'exit-retry' ? 'left' : null;
    const srcHx = sideHandle === 'right' ? sp.x + sw
                : sideHandle === 'left' ? sp.x
                : sp.x + sw / 2;
    const srcHy = sideHandle ? sp.y + getH(s) / 2 : sp.y + getH(s);
    const srcCx = sideHandle === 'right' ? srcHx - C.NODE_W / 2
                : sideHandle === 'left' ? srcHx + C.NODE_W / 2 : srcHx;
    return {
      sideHandle,
      srcHx, srcHy,
      srcLeft: srcCx - C.NODE_W / 2, srcRight: srcCx + C.NODE_W / 2,
      tgtX: tp.x + tw / 2, tgtY: tp.y,
      tgtLeft: tp.x + tw / 2 - C.NODE_W / 2, tgtRight: tp.x + tw / 2 + C.NODE_W / 2,
    };
  };

  // Side selection: side handles are FIXED to their face; bottom handles
  // pick the side whose two horizontals cross fewer node bodies, with a
  // load-balance nudge so lanes spread across both sides when equal.
  const sideLoad = { left: 0, right: 0 };
  const withGeo = backList.map(e => ({ e, g: geoOf(e) }));
  // Longest loops choose first (outermost tracks dominate the picture).
  withGeo.sort((a, b) =>
    (b.g.srcHy - b.g.tgtY) - (a.g.srcHy - a.g.tgtY));
  for (const item of withGeo) {
    const { g } = item;
    if (g.sideHandle) { item.side = g.sideHandle; sideLoad[item.side]++; continue; }
    const cost = (S) => {
      const railX = S === 'left' ? Math.min(g.srcLeft, g.tgtLeft) - C.LOOP_BASE
                                 : Math.max(g.srcRight, g.tgtRight) + C.LOOP_BASE;
      return hBlockers(g.srcHy + C.DROP_BASE, g.srcHx, railX).length
           + hBlockers(g.tgtY - C.DROP_BASE, railX, g.tgtX).length
           + 0.7 * sideLoad[S];
    };
    const cl = cost('left'), cr = cost('right');
    item.side = cl <= cr ? 'left' : 'right';
    sideLoad[item.side]++;
  }

  // Arrival stagger: loops entering the same target land at distinct
  // heights (inner/shortest loop closest to the node).
  const arrivalIdx = new Map();
  {
    const byTgt = new Map();
    for (const it of withGeo) {
      (byTgt.get(it.e.target) ?? byTgt.set(it.e.target, []).get(it.e.target)).push(it);
    }
    for (const list of byTgt.values()) {
      list.sort((a, b) => (a.g.srcHy - a.g.tgtY) - (b.g.srcHy - b.g.tgtY));
      list.forEach((it, i) => arrivalIdx.set(it.e.id, i));
    }
  }

  // Per-side unique tracks: inner (shortest) loop hugs closest, every loop
  // on a side gets its own offset slot — no two loops ever share a line.
  for (const S of ['left', 'right']) {
    const group = withGeo.filter(it => it.side === S);
    group.sort((a, b) => (a.g.srcHy - a.g.tgtY) - (b.g.srcHy - b.g.tgtY)); // inner first
    group.forEach((it, slot) => {
      const { e, g } = it;
      const params = { loopSide: S };
      // Bottom drop: staggered per target arrival, then lifted to a clear
      // band if a node blocks the approach horizontal.
      let botY = g.tgtY - (C.DROP_BASE + (arrivalIdx.get(e.id) ?? 0) * C.DROP_STEP);
      // Top drop (bottom-handle only): lowered to a clear band if a node
      // blocks the exit horizontal.
      let topY = g.srcHy + (g.sideHandle ? 0 : C.DROP_BASE);
      // Rail hugs the outermost node body in the vertical span it passes.
      const railFor = (t1, t2) => {
        const spanRects = rects.filter(r => r.y < Math.max(t1, t2) && r.y + r.h > Math.min(t1, t2));
        const lane = C.LOOP_BASE + slot * C.LOOP_STEP;
        if (S === 'left') {
          const bound = Math.min(g.srcLeft, g.tgtLeft, ...spanRects.map(r => r.x));
          return bound - lane;
        }
        const bound = Math.max(g.srcRight, g.tgtRight, ...spanRects.map(r => r.x + r.w));
        return bound + lane;
      };
      let railX = railFor(botY, topY);
      // Clear-band search (2 passes so the rail can adapt to the final spans).
      for (let pass = 0; pass < 2; pass++) {
        if (!g.sideHandle) {
          for (let i = 0; i < 8; i++) {
            const blk = hBlockers(topY, g.srcHx, railX).filter(r => topY < r.y + r.h + 12);
            if (blk.length === 0) break;
            topY = Math.max(...blk.map(r => r.y + r.h)) + 25;
          }
        }
        for (let i = 0; i < 8; i++) {
          const blk = hBlockers(botY, railX, g.tgtX).filter(r => r.id !== e.target);
          if (blk.length === 0) break;
          botY = Math.min(...blk.map(r => r.y)) - 25;
        }
        railX = railFor(botY, topY);
      }
      if (!g.sideHandle) params.loopTopDrop = Math.max(20, Math.round(topY - g.srcHy));
      params.loopBottomDrop = Math.max(20, Math.round(g.tgtY - botY));
      params.loopOffset = Math.max(40, Math.round(S === 'left'
        ? Math.min(g.srcLeft, g.tgtLeft) - railX
        : railX - Math.max(g.srcRight, g.tgtRight)));
      edgeParams.set(e.id, params);
    });
  }

  result.changed = true;
  return result;
}

/**
 * Apply a layoutBranchDiagram result to plain store-shaped nodes/edges.
 * Returns { nodes, edges } new arrays. Loop drag params on back edges are
 * REPLACED by the computed set (stale params from an older layout are the
 * main source of edges routed through nodes).
 */
export function applyBranchLayout(nodes, edges, layout) {
  const LOOP_KEYS = ['loopOffset', 'loopTopDrop', 'loopBottomDrop', 'loopSide', 'mergeYOffset'];
  const nextNodes = nodes.map(n => {
    const p = layout.positions.get(n.id);
    if (!p) return n;
    if (p.x === n.position?.x && p.y === n.position?.y) return n;
    return { ...n, position: { x: p.x, y: p.y } };
  });
  const nextEdges = edges.map(e => {
    const fresh = layout.edgeParams.get(e.id);
    const hasStale = e.data && LOOP_KEYS.some(k => e.data[k] != null);
    // Strip stale drag params from EVERY edge (a stale loopSide on a now-
    // forward edge would still disable node clearance), then apply the
    // freshly computed params to loop-backs.
    if (!fresh && !hasStale) return e;
    const data = { ...(e.data ?? {}) };
    for (const k of LOOP_KEYS) delete data[k];
    Object.assign(data, fresh ?? {});
    return { ...e, data };
  });
  return { nodes: nextNodes, edges: nextEdges };
}
