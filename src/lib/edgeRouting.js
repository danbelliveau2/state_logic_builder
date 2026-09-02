/**
 * edgeRouting.js — Single source of truth for all edge path computation.
 *
 * DESIGN PRINCIPLES:
 *   1. Default = straight down (vertical line, no bends)
 *   2. If nodes aren't aligned = Z-bend (down, over, down) — fewest lines possible
 *   3. Decision side-handle exits = L-bend (horizontal out, vertical to target)
 *   4. Drawn paths are sacred — shape is locked once drawn
 *   5. On node move: only first/last segments stretch. Middle is frozen.
 *   6. Segment drag: move one segment's axis. Shape doesn't change.
 *   7. No crazy auto-rerouting. Ever.
 *
 * EDGE DATA FIELDS (stored on edge.data):
 *   waypoints        — [{x,y}, ...] drawn corner points (empty = auto-route)
 *   manualRoute      — true if user drew this path
 *   isDecisionExit   — true for pass/fail/single/retry edges from decision nodes
 *   exitColor        — 'pass' | 'fail' | 'retry' | 'single'
 *   firstSegmentAxis — 'horizontal' | 'vertical' (axis of first segment when drawn)
 *   lastSegmentAxis  — 'horizontal' | 'vertical' (axis of last segment when drawn)
 *
 * TERMINOLOGY:
 *   src  — source handle position {x, y}
 *   tgt  — target handle position {x, y}
 *   wp   — waypoint (corner point between src and tgt)
 *   seg  — segment (line between two consecutive points)
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const NODE_WIDTH = 240;
const ALIGN_THRESHOLD = 1;   // px — points within this are "aligned"
// Minimum perpendicular run out of a handle before ANY bend is allowed.
// A bend closer than this to a node face reads as "the edge doesn't come out
// of the handle, it jogs off the node's corner" — Dan's #1 recurring complaint.
// Applies at BOTH ends: stub out of the source, stub into the target.
export const MIN_STUB = 20;

// ── Path Building ────────────────────────────────────────────────────────────

/**
 * Build the full orthogonal point sequence: src → waypoints → tgt.
 * Inserts auto-corners where consecutive points aren't axis-aligned.
 *
 * Corner insertion rule:
 *   - Going to target (last point): horizontal first, then vertical
 *   - Going to intermediate waypoint: vertical first, then horizontal
 *
 * This ensures edges always enter the target from above (vertical drop in).
 */
export function buildFullPath(src, waypoints, tgt) {
  const raw = [src, ...waypoints, tgt];
  const pts = [raw[0]];

  for (let i = 1; i < raw.length; i++) {
    const prev = pts[pts.length - 1];
    const curr = raw[i];
    const alignedX = Math.abs(prev.x - curr.x) < ALIGN_THRESHOLD;
    const alignedY = Math.abs(prev.y - curr.y) < ALIGN_THRESHOLD;

    if (alignedX || alignedY) {
      pts.push(curr);
    } else {
      const isLast = i === raw.length - 1;
      if (isLast) {
        // Going to target: horizontal first, then vertical into target
        pts.push({ x: curr.x, y: prev.y });
      } else {
        // Going to intermediate waypoint: vertical first, then horizontal
        pts.push({ x: prev.x, y: curr.y });
      }
      pts.push(curr);
    }
  }

  return pts;
}

/**
 * Build segment metadata from a point array.
 * Each segment has: start (a), end (b), midpoint, isHorizontal flag,
 * and indices into the fullPts array (for drag mapping).
 */
export function buildSegments(pts) {
  const segments = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    segments.push({
      a,
      b,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      isH: Math.abs(a.y - b.y) < ALIGN_THRESHOLD,
      ptIdxA: i,
      ptIdxB: i + 1,
    });
  }
  return segments;
}

/**
 * Convert point array to SVG path string: "M x y L x y L x y ..."
 */
export function pointsToSvg(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

// ── Auto-Route ───────────────────────────────────────────────────────────────
//
// Auto-route is used when there are NO stored waypoints.
// Priority order (first match wins):
//   1. Decision side-handle exit (pass/fail) → L-bend: horizontal out, vertical to target
//   2. Backward edge (target above source) → U-bend wrapping around diagram edge
//   3. Non-side decision exit with offset → L-bend: horizontal to target X, vertical down
//   4. Nodes offset horizontally → Z-bend (down to midY, over, down)
//   5. Nodes aligned vertically → straight line (no waypoints)

/**
 * Compute U-bend waypoints for a backward edge (target above source).
 * Routes around the left or right side of the diagram depending on
 * which side the source node is relative to the diagram center.
 *
 * @param {Object} src — source handle {x, y}
 * @param {Object} tgt — target handle {x, y}
 * @param {Array} allNodes — all React Flow node objects (for bounding box)
 * @returns {Array} 4 waypoints forming a U-shape
 */
/**
 * Which side does a backward (loop) edge's rail go on?
 *
 * HARD RULE: a SIDE-handle source always rails on the side its handle faces —
 * exit-fail (right handle) → right rail, exit-retry (left) → left rail —
 * regardless of stored loopSide or target position. Anything else makes the
 * first segment cross back THROUGH the source node ("edges must leave at the
 * connection points" — Dan). Bottom-handle loops keep the stored/derived side.
 * Exported so RoutableEdge's drag overlays agree with the route.
 */
export function backwardRailGoRight(sourceHandle, edgeData, srcX, tgtX) {
  if (sourceHandle === 'exit-fail') return true;
  if (sourceHandle === 'exit-retry') return false;
  if (edgeData?.loopSide === 'right') return true;
  if (edgeData?.loopSide === 'left') return false;
  return tgtX >= srcX;
}

export function computeBackwardWaypoints(src, tgt, allNodes) {
  const DROP = 40;
  const PAD  = 60;

  let leftBound  =  Infinity;
  let rightBound = -Infinity;
  for (const n of allNodes) {
    const x = n.position?.x ?? 0;
    leftBound  = Math.min(leftBound,  x);
    rightBound = Math.max(rightBound, x + NODE_WIDTH);
  }
  if (!isFinite(leftBound))  leftBound  = Math.min(src.x, tgt.x);
  if (!isFinite(rightBound)) rightBound = Math.max(src.x, tgt.x) + NODE_WIDTH;

  // Route in the direction the user drew: target left of source → go left
  const dx = tgt.x - src.x;
  let goRight;
  if (Math.abs(dx) > 20) {
    goRight = dx > 0;  // follow the horizontal direction of the connection
  } else {
    // Nearly aligned — pick the side with more room
    const spaceLeft  = src.x - leftBound;
    const spaceRight = rightBound - src.x;
    goRight = spaceRight > spaceLeft;
  }
  const sideX = goRight ? rightBound + PAD : leftBound - PAD;

  return [
    { x: src.x, y: src.y + DROP },
    { x: sideX, y: src.y + DROP },
    { x: sideX, y: tgt.y - DROP },
    { x: tgt.x, y: tgt.y - DROP },
  ];
}

/**
 * Compute auto-route waypoints for an edge with no stored waypoints.
 * Returns an array of waypoints (may be empty for straight lines).
 *
 * @param {Object} src — source handle {x, y}
 * @param {Object} tgt — target handle {x, y}
 * @param {Object} edgeData — edge.data (isDecisionExit, exitColor, etc.)
 * @param {Array} allNodes — all React Flow node objects (needed for backward U-route)
 * @param {string} sourceHandle — source handle id ('exit-pass', 'exit-fail', 'exit-single', etc.)
 */
export function computeAutoRoute(src, tgt, edgeData, allNodes, sourceHandle, snapStraightThreshold = 0) {
  const isBackward     = tgt.y < src.y - 30;
  // SNAP-TO-STRAIGHT — when X offset is below snapStraightThreshold, render
  // as a single straight line (slight diagonal), NOT a Z-bend. This eliminates
  // the visible kink for "nearly aligned" nodes (1-2px positional rounding
  // from auto-spawn).
  // CALLER CONTRACT:
  //   - At rest:  pass the user-configured threshold (default 20px).
  //   - In drag:  pass 0 — every pixel of offset must produce a perpendicular
  //               Z-bend so the source stub always exits perpendicularly,
  //               otherwise the user sees a diagonal stub at drag start.
  const isSideways     = Math.abs(src.x - tgt.x) > snapStraightThreshold;
  // Side handle = sourceHandle alone is sufficient. Don't gate on
  // isDecisionExit — older edges (SDC init template, manually wired)
  // may not have that flag, but if the source handle is exit-fail or
  // exit-retry the edge MUST exit perpendicular to the side face.
  // Locked-in rule (Branch Routing Reference): right handle = right
  // then down, left handle = left then down. NEVER down-first stub.
  const isSideHandleExit = sourceHandle === 'exit-fail' || sourceHandle === 'exit-retry';

  // Loop-back: user picked Loop Left / Loop Right in the connect popup,
  // which stored `loopSide` on edge data. For BACKWARD edges (target
  // above source), route around the chosen side. No frozen waypoints —
  // re-routes cleanly when nodes move.
  if (isBackward) {
    // Every backward edge is parametric. Three tunables read live from
    // edge data (defaults if unset):
    //   loopOffset    — how far past the node bounds the side rail sits
    //   loopTopDrop   — bottom-handle only: vertical drop before turning out
    //   loopBottomDrop — vertical drop above target before turning in
    // `loopSide` defaults to the side the target sits on relative to source;
    // first drag pins it so the rail can't flip across mid-X.
    const PAD      = edgeData?.loopOffset     ?? 60;
    const TOP_DROP = edgeData?.loopTopDrop    ?? 40;
    const BOT_DROP = edgeData?.loopBottomDrop ?? 40;
    const goRight = backwardRailGoRight(sourceHandle, edgeData, src.x, tgt.x);
    // Bounds — handle position determines which edge of the node `src.x` is.
    const srcCenterX = sourceHandle === 'exit-fail'  ? src.x - NODE_WIDTH / 2
                     : sourceHandle === 'exit-retry' ? src.x + NODE_WIDTH / 2
                     : src.x;
    const srcLeft  = srcCenterX - NODE_WIDTH / 2;
    const srcRight = srcCenterX + NODE_WIDTH / 2;
    // Target enters at top-center, so tgt.x IS the center.
    const tgtLeft  = tgt.x - NODE_WIDTH / 2;
    const tgtRight = tgt.x + NODE_WIDTH / 2;
    const sideX = goRight
      ? Math.max(srcRight, tgtRight) + PAD
      : Math.min(srcLeft,  tgtLeft)  - PAD;
    if (isSideHandleExit) {
      // Side handle: perpendicular out first. 3 waypoints, 4 segments.
      //   seg 0: src → (sideX, src.y)        — top horizontal (locked to src.y)
      //   seg 1: → (sideX, tgt.y - botDrop) — SIDE RAIL (drag X → loopOffset)
      //   seg 2: → (tgt.x, tgt.y - botDrop) — BOTTOM HORIZONTAL (drag Y → loopBottomDrop)
      //   seg 3: → tgt                      — final vertical (locked to tgt.x)
      return [
        { x: sideX, y: src.y },
        { x: sideX, y: tgt.y - BOT_DROP },
        { x: tgt.x, y: tgt.y - BOT_DROP },
      ];
    }
    // Bottom handle: perpendicular out (down), then over, up, in. 4 waypoints,
    // 5 segments.
    //   seg 0: src → (src.x, src.y + topDrop) — initial vertical (locked to src.x)
    //   seg 1: → (sideX, src.y + topDrop)     — TOP HORIZONTAL (drag Y → loopTopDrop)
    //   seg 2: → (sideX, tgt.y - botDrop)     — SIDE RAIL (drag X → loopOffset)
    //   seg 3: → (tgt.x, tgt.y - botDrop)     — BOTTOM HORIZONTAL (drag Y → loopBottomDrop)
    //   seg 4: → tgt                          — final vertical (locked to tgt.x)
    return [
      { x: src.x, y: src.y + TOP_DROP },
      { x: sideX, y: src.y + TOP_DROP },
      { x: sideX, y: tgt.y - BOT_DROP },
      { x: tgt.x, y: tgt.y - BOT_DROP },
    ];
  }

  // Side-handle decision exits (pass/fail): always L-bend (horizontal out
  // from the handle, then vertical to target). Works for forward AND
  // backward targets as long as the target is on the SAME side the handle
  // points (pass = left side, fail = right side) — which is the normal case.
  //
  // U-bend (route around the diagram) is only triggered when the target is
  // on the WRONG side of the handle (e.g. user dragged the fail child to the
  // left of the source). In that case we route locally around source+target
  // bounds — NOT diagram-wide bounds, which produced wildly long routes when
  // there were unrelated distant nodes.
  if (isSideHandleExit) {
    // Side-handle exits are SIMPLE: perpendicular out, then drop.
    //   exit-fail  (right) → horizontal RIGHT to tgt.x, then vertical DOWN to tgt
    //   exit-retry (left)  → horizontal LEFT  to tgt.x, then vertical DOWN to tgt
    // Two segments, one bend. The bend lands at the target's X column so
    // the second segment is a clean vertical drop into the target's top.
    const isLeftHandle = sourceHandle === 'exit-retry';
    const TOL = 20;
    const wrongSide = isLeftHandle
      ? (tgt.x > src.x + TOL)
      : (tgt.x + NODE_WIDTH < src.x - TOL);

    if (wrongSide) {
      // Target is on the WRONG side of this handle (e.g. user dragged the
      // alternate child across the source). We can't go "right then down"
      // because right takes us away from target — route around the local
      // source+target bounds, still keeping a perpendicular exit.
      // Parametric like every rail: branchLayout hands each rail its own
      // slot (loopOffset / loopBottomDrop) so two rails on one side never
      // share a line. Defaults unchanged for hand-placed edges.
      const DROP = edgeData?.loopBottomDrop ?? 40;
      const PAD  = edgeData?.loopOffset     ?? 60;
      const sideX = isLeftHandle
        ? Math.min(src.x, tgt.x) - PAD
        : Math.max(src.x, tgt.x) + NODE_WIDTH + PAD;
      return [
        { x: sideX, y: src.y },
        { x: sideX, y: tgt.y - DROP },
        { x: tgt.x, y: tgt.y - DROP },
      ];
    }
    // Normal case: simple L-bend. Right then down (or left then down).
    return [{ x: tgt.x, y: src.y }];
  }

  // (Backward edges handled above — every backward edge goes through
  //  the parametric loop-back code path, whether or not the user picked
  //  Loop Left / Loop Right explicitly.)

  // Forward offset: Z-bend (down to midpoint, over, down).
  // The horizontal segment's Y defaults to the midpoint between source and
  // target. The user can drag the horizontal segment up/down via the merge
  // overlay in RoutableEdge — that drag stores `mergeYOffset` on edge data
  // (a delta from midY in flow coords). Auto-route reads it here so the
  // shape recomputes from a single number, no stored waypoints.
  if (isSideways) {
    const midY = (src.y + tgt.y) / 2;
    const offset = Number(edgeData?.mergeYOffset ?? 0);
    // The horizontal jog must land in OPEN SPACE between the two nodes —
    // never within MIN_STUB of either node face. Without this clamp a small
    // residual X offset (e.g. two nodes of different width whose centers
    // don't match) produced a bend right at the source's bottom edge, which
    // reads as the edge not exiting the handle at all.
    const lo = src.y + MIN_STUB;
    const hi = tgt.y - MIN_STUB;
    // If the nodes are closer than 2*MIN_STUB apart there is no legal band;
    // the midpoint is then the least-bad choice (and the layout's GAP=50
    // guarantees this never happens for auto-laid-out diagrams).
    const railY = hi <= lo ? midY : Math.min(Math.max(midY + offset, lo), hi);
    return [
      { x: src.x, y: railY },
      { x: tgt.x, y: railY },
    ];
  }

  // Aligned: straight line (no waypoints)
  return [];
}

// ── Terminal Run Adjustment on Node Move ─────────────────────────────────────
//
// When a node moves, the source/target handle positions change.
// For manual routes, the drawn SHAPE is sacred. Middle segments never move.
// Terminal segments stretch by shifting entire vertical/horizontal "runs":
//
// SOURCE END: shift all consecutive waypoints sharing the same axis
//   as the first waypoint (vertical run shares X, horizontal shares Y).
//   This keeps the first segment connected to the source handle.
//
// TARGET END: shift all consecutive waypoints sharing X with the last
//   waypoint (the "last vertical drop" into the target). This keeps
//   the edge attached to the target as it moves left/right.
//
// Everything in between is frozen — that's the user's drawn shape.

/**
 * Adjust stored waypoints to track node movement.
 * Shifts terminal "runs" of consecutive axis-aligned waypoints while
 * preserving the frozen middle shape.
 *
 * @param {Array} waypoints — stored waypoint array (original, unmodified)
 * @param {Object} src — current source handle position {x, y}
 * @param {Object} tgt — current target handle position {x, y}
 * @param {string} sourceHandle — handle id ('exit-pass', 'exit-fail', or null)
 * @returns {Array} adjusted waypoint array
 */

// ── Node Clearance ──────────────────────────────────────────────────────────

/**
 * Push waypoint segments away from nodes they pass too close to.
 * Skips source/target nodes to preserve perpendicular handle stubs.
 * Runs on ALL edges — both manual-route and auto-route.
 */
export function enforceNodeClearance(wps, src, tgt, allNodes, sourceHandle = null) {
  if (!allNodes || !wps || wps.length < 2) return wps;

  const PAD = 25;
  const result = wps.map(wp => ({ ...wp }));

  // Identify which nodes own the source handle and which own the target handle.
  // The stub segments (first segment at src end, last segment at tgt end) must
  // stay perpendicular to their handle face, so those segments skip their own
  // owner node. MIDDLE segments still check against source/target — so if a
  // node is dragged across the middle of its own edge's route (e.g. the long
  // vertical of a U-loop), it correctly pushes that segment away.
  const srcNodeIds = new Set();
  const tgtNodeIds = new Set();
  for (const node of allNodes) {
    const nx = node.position?.x ?? 0;
    const ny = node.position?.y ?? 0;
    const nw = node.measured?.width ?? node.width ?? NODE_WIDTH;
    const nh = node.measured?.height ?? node.height ?? 80;
    if (src.x >= nx && src.x <= nx + nw && src.y >= ny - 5 && src.y <= ny + nh + 5) srcNodeIds.add(node.id);
    if (tgt.x >= nx && tgt.x <= nx + nw && tgt.y >= ny - 5 && tgt.y <= ny + nh + 5) tgtNodeIds.add(node.id);
  }

  // Handle-based push direction for OWNER-NODE pushes on stub-adjacent segments.
  // The closer-side heuristic used below for all other pushes is unstable here —
  // when the user drags the owner node fast, the segment can momentarily end up
  // in the upper half of the node's bounding box, flipping the "closer side"
  // from the bottom edge to the top edge and causing the segment to snap across
  // the node (running alongside its top edge — violation of the perpendicular
  // stub rule). A segment attached to a bottom handle is structurally always
  // BELOW its source, so force the push direction DOWN for that case. Same idea
  // for side handles (push outward from handle face) and for the target end
  // (top handle → last segment is above target → force UP).
  // v1.34: side handles are exit-fail (right) and exit-retry (left).
  // exit-pass moved to bottom — treated like other bottom handles for stub direction.
  const srcIsLeftHandle   = sourceHandle === 'exit-retry';
  const srcIsRightHandle  = sourceHandle === 'exit-fail';
  const srcIsSideHandle   = srcIsLeftHandle || srcIsRightHandle;
  const srcIsBottomHandle = !srcIsSideHandle; // null, exit-pass, exit-single
  // Aliases kept for reference within this function (used in the push-direction
  // logic below — historically named srcIsPassHandle / srcIsFailHandle).
  const srcIsPassHandle   = srcIsLeftHandle;
  const srcIsFailHandle   = srcIsRightHandle;

  const lastSegIdx = result.length - 2; // segment index for wp[last-1]→wp[last]

  // Owner-node rects — a clearance push must never relocate a segment INTO
  // the edge's own source/target node (e.g. a loop-back's top horizontal
  // pushed up off a mid-diagram node and into the source body). When the
  // closer-side push would do that, flip to the other side of the blocker.
  const ownerRects = [];
  for (const node of allNodes) {
    if (!srcNodeIds.has(node.id) && !tgtNodeIds.has(node.id)) continue;
    ownerRects.push({
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
      w: node.measured?.width ?? node.width ?? NODE_WIDTH,
      h: node.measured?.height ?? node.height ?? 80,
    });
  }
  const horizHitsOwner = (yPos, x1, x2) => ownerRects.some(r =>
    yPos > r.y && yPos < r.y + r.h && Math.max(x1, x2) > r.x && Math.min(x1, x2) < r.x + r.w);
  const vertHitsOwner = (xPos, y1, y2) => ownerRects.some(r =>
    xPos > r.x && xPos < r.x + r.w && Math.max(y1, y2) > r.y && Math.min(y1, y2) < r.y + r.h);

  // Stub axes — used by the collinearity check below to decide whether
  // pushing a stub-adjacent segment would break the perpendicular stub.
  const firstWp = result[0];
  const lastWp  = result[result.length - 1];
  const srcStubVert  = Math.abs(firstWp.x - src.x) <= 2;  // stub goes src → wp[0] vertically
  const srcStubHoriz = Math.abs(firstWp.y - src.y) <= 2;  // stub goes src → wp[0] horizontally
  const tgtStubVert  = Math.abs(lastWp.x  - tgt.x) <= 2;
  const tgtStubHoriz = Math.abs(lastWp.y  - tgt.y) <= 2;

  for (let i = 0; i < result.length - 1; i++) {
    // Determine segment axis from the INITIAL positions (axis can't change mid-loop).
    const initA = result[i], initB = result[i + 1];
    const isVert = Math.abs(initA.x - initB.x) <= 2;
    const isHoriz = Math.abs(initA.y - initB.y) <= 2;
    if (!isVert && !isHoriz) continue;

    // Per-segment skip rule: only skip the owner node when pushing this segment
    // WOULD actually break its perpendicular stub. That happens only when the
    // segment is COLLINEAR with the stub (same axis) — in that case a push
    // would shift the shared waypoint on the stub's axis, bending the stub.
    //
    // If the segment is perpendicular to the stub (e.g. stub goes straight
    // down out of a bottom handle and then the first waypoint segment turns
    // horizontal), pushing that perpendicular segment just lengthens/shortens
    // the stub — the stub stays perpendicular. Safe to let the owner node push.
    // This is what lets a source state, when dragged down, push its own
    // downward-exiting U-loop's bottom horizontal further down out of the way.
    const skipSrc = (i === 0) && (
      (srcStubVert && isVert) || (srcStubHoriz && isHoriz)
    );
    const skipTgt = (i === lastSegIdx) && (
      (tgtStubVert && isVert) || (tgtStubHoriz && isHoriz)
    );

    for (const node of allNodes) {
      const isSrcOwner = srcNodeIds.has(node.id);
      const isTgtOwner = tgtNodeIds.has(node.id);
      if (skipSrc && isSrcOwner) continue;
      if (skipTgt && isTgtOwner) continue;

      const nx = node.position?.x ?? 0;
      const ny = node.position?.y ?? 0;
      const nw = node.measured?.width ?? node.width ?? NODE_WIDTH;
      const nh = node.measured?.height ?? node.height ?? 80;

      // Is this an owner-push on a stub-adjacent segment? (bias direction)
      const biasSrc = isSrcOwner && (i === 0);
      const biasTgt = isTgtOwner && (i === lastSegIdx);

      // Live read: use the CURRENT segment position, not a snapshot captured
      // before prior pushes in this inner loop. Fixes a latent bug where two
      // nodes pushing the same segment could overwrite each other based on
      // stale segX/segY.
      if (isVert) {
        const segX = result[i].x;
        const segMinY = Math.min(result[i].y, result[i + 1].y);
        const segMaxY = Math.max(result[i].y, result[i + 1].y);
        if (segMaxY < ny || segMinY > ny + nh) continue;

        let newX = null;
        if (biasSrc && srcIsPassHandle) {
          // Left-side handle: seg 0 must stay LEFT of source node (stub points left)
          const maxX = nx - PAD;
          if (segX > maxX) newX = maxX;
        } else if (biasSrc && srcIsFailHandle) {
          // Right-side handle: seg 0 must stay RIGHT of source node
          const minX = nx + nw + PAD;
          if (segX < minX) newX = minX;
        } else if (segX > nx - PAD && segX < nx + nw + PAD) {
          // Default (non-owner): corridor-gated closer-side push — flipped
          // to the far side when the near side would land inside the edge's
          // own source/target node.
          const distLeft = segX - nx;
          const distRight = (nx + nw) - segX;
          const near = distLeft < distRight ? nx - PAD : nx + nw + PAD;
          const far  = distLeft < distRight ? nx + nw + PAD : nx - PAD;
          newX = vertHitsOwner(near, segMinY, segMaxY) && !vertHitsOwner(far, segMinY, segMaxY)
            ? far : near;
        }

        if (newX !== null) {
          result[i] = { ...result[i], x: newX };
          result[i + 1] = { ...result[i + 1], x: newX };
        }
      } else {
        const segY = result[i].y;
        const segMinX = Math.min(result[i].x, result[i + 1].x);
        const segMaxX = Math.max(result[i].x, result[i + 1].x);
        if (segMaxX < nx || segMinX > nx + nw) continue;

        let newY = null;
        if (biasSrc && srcIsBottomHandle) {
          // Bottom handle: seg 0 horizontal must stay BELOW source node — always,
          // regardless of whether it's currently inside the corridor or orphaned
          // above it after a fast drag. This is what stops the horizontal from
          // ever snapping across the top of its own source node.
          const minY = ny + nh + PAD;
          if (segY < minY) newY = minY;
        } else if (biasTgt) {
          // Top handle target: last seg horizontal must stay ABOVE target node
          const maxY = ny - PAD;
          if (segY > maxY) newY = maxY;
        } else if (segY > ny - PAD && segY < ny + nh + PAD) {
          // Default (non-owner): corridor-gated closer-side push — flipped
          // to the far side when the near side would land inside the edge's
          // own source/target node.
          const distTop = segY - ny;
          const distBot = (ny + nh) - segY;
          const near = distTop < distBot ? ny - PAD : ny + nh + PAD;
          const far  = distTop < distBot ? ny + nh + PAD : ny - PAD;
          newY = horizHitsOwner(near, segMinX, segMaxX) && !horizHitsOwner(far, segMinX, segMaxX)
            ? far : near;
        }

        if (newY !== null) {
          result[i] = { ...result[i], y: newY };
          result[i + 1] = { ...result[i + 1], y: newY };
        }
      }
    }
  }

  return result;
}

// ── Segment Drag ─────────────────────────────────────────────────────────────

/**
 * Check if a segment can be dragged.
 * First segment (exits source node) and last segment (enters target node)
 * are never draggable — they're locked to the node handles.
 */

/**
 * Remove collinear waypoints — adjacent points on the same axis that can merge.
 * Called after segment drag to clean up degenerate corners.
 */
export function cleanWaypoints(pts) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    // Skip if same position
    if (Math.abs(prev.x - curr.x) < ALIGN_THRESHOLD && Math.abs(prev.y - curr.y) < ALIGN_THRESHOLD) continue;
    // Merge collinear
    if (out.length >= 2) {
      const pp = out[out.length - 2];
      const sameX = Math.abs(pp.x - prev.x) < ALIGN_THRESHOLD && Math.abs(prev.x - curr.x) < ALIGN_THRESHOLD;
      const sameY = Math.abs(pp.y - prev.y) < ALIGN_THRESHOLD && Math.abs(prev.y - curr.y) < ALIGN_THRESHOLD;
      if (sameX || sameY) {
        out[out.length - 1] = curr;
        continue;
      }
    }
    out.push(curr);
  }
  return out;
}

// ── Axis Detection ───────────────────────────────────────────────────────────

/**
 * Deduce the axis of the first and last segments from handle/target positions and waypoints.
 * Used when storing a manually-drawn edge so adjustTerminalRuns knows which coordinate to lock.
 *
 * @param {Object} handlePos — source handle {x, y}
 * @param {Array} waypoints — drawn waypoint array
 * @param {Object} tgtPos — target handle {x, y} (optional — used for accurate last axis detection)
 */
export function findLabelSegment(segments) {
  let best = segments[0];
  let bestLen = 0;
  for (const seg of segments) {
    const len = seg.isH
      ? Math.abs(seg.b.x - seg.a.x)
      : Math.abs(seg.b.y - seg.a.y);
    if (len > bestLen) { bestLen = len; best = seg; }
  }
  return best;
}

/**
 * Find the longest vertical segment (for outcome labels).
 */
export function findLongestVerticalSegment(segments) {
  let best = segments[segments.length > 1 ? 1 : 0];
  let bestLen = 0;
  for (const seg of segments) {
    if (!seg.isH) {
      const len = Math.abs(seg.b.y - seg.a.y);
      if (len > bestLen) { bestLen = len; best = seg; }
    }
  }
  return { segment: best, hasVertical: bestLen > 0 };
}

// ── Live Exit Label Computation ──────────────────────────────────────────────

/**
 * Compute correct exit labels from a decision node's current config.
 * Always derives from the node's mode/conditionType/signalType — never stale.
 *
 * Returns { exit1, exit2 } or null if the node isn't configured yet.
 */
export function computeExitLabels(nodeData) {
  const { nodeMode, conditionType: ct, signalType: st, signalName: sn,
          sensorInputType: sit } = nodeData;
  if (!sn || sn === 'Select Signal...') return null;

  const isRange = sit === 'range' || ct === 'range';
  const isVision = st === 'visionJob';

  // Branch labels ALWAYS flow from the CONDITION, never from the mode.
  //   Vision job  → Pass / Fail    [ONLY place Pass/Fail appears — vision has
  //                                 named outcomes like "Link_Orient Pass"]
  //   Range       → InRange / OutOfRange
  //   Binary (everything else: sensor, signal, state, condition, partTracking,
  //           partResult, or unknown) → On / Off
  //           Verify+Off flips so exit1 = picked polarity = the "good" side.
  //
  // Rationale: Verify asserts a condition; Decide branches on a condition.
  // Neither mode creates a Pass/Fail concept — the CONDITION's own vocabulary
  // (On/Off, InRange/OutOfRange) is what branches are labelled with.
  let exit1, exit2;
  if (isVision) {
    exit1 = 'Pass'; exit2 = 'Fail';
  } else if (isRange) {
    exit1 = 'InRange'; exit2 = 'OutOfRange';
  } else {
    // Binary condition fallback — all non-vision, non-range conditions.
    if (nodeMode === 'verify' && ct === 'off') {
      exit1 = 'Off'; exit2 = 'On';
    } else {
      exit1 = 'On'; exit2 = 'Off';
    }
  }

  return { exit1, exit2 };
}
