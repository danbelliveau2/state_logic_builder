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
export function computeAutoRoute(src, tgt, edgeData, allNodes, sourceHandle) {
  const isBackward     = tgt.y < src.y - 30;
  const isSideways     = Math.abs(src.x - tgt.x) > 10;
  const isDecisionExit = edgeData?.isDecisionExit === true;
  // Only true side handles (exit-pass / exit-fail) get L-bend routing.
  // Bottom handles (exit-single, exit-retry, null) route like normal edges.
  const isSideHandleExit = isDecisionExit
    && (sourceHandle === 'exit-pass' || sourceHandle === 'exit-fail');

  // Side-handle decision exits (pass/fail): route depends on target position.
  //   Forward (target below): simple L-bend → horizontal out, vertical down
  //   Backward (target above): U-bend → horizontal out (handle direction),
  //     vertical up past target, horizontal across, vertical down into target
  if (isSideHandleExit) {
    const isPassHandle = edgeData?.exitColor === 'pass';  // pass = left handle
    if (isBackward) {
      // U-bend from side handle going backward (target is above)
      // Route outward from the handle side, then up, across, and down
      const DROP  = 40;
      const PAD   = 60;
      // Determine which side to route around based on handle direction
      // Pass (left handle) → go left; Fail (right handle) → go right
      let sideX;
      if (isPassHandle) {
        // Go left — find left boundary of diagram
        let leftBound = Infinity;
        for (const n of allNodes) { leftBound = Math.min(leftBound, n.position?.x ?? 0); }
        if (!isFinite(leftBound)) leftBound = Math.min(src.x, tgt.x);
        sideX = leftBound - PAD;
      } else {
        // Go right — find right boundary of diagram
        let rightBound = -Infinity;
        for (const n of allNodes) { rightBound = Math.max(rightBound, (n.position?.x ?? 0) + NODE_WIDTH); }
        if (!isFinite(rightBound)) rightBound = Math.max(src.x, tgt.x) + NODE_WIDTH;
        sideX = rightBound + PAD;
      }
      return [
        { x: sideX, y: src.y },          // horizontal out to side
        { x: sideX, y: tgt.y - DROP },    // vertical up past target
        { x: tgt.x, y: tgt.y - DROP },    // horizontal across to target X
      ];
    }
    // Forward side-handle exit: simple L-bend
    return [{ x: tgt.x, y: src.y }];
  }

  // Backward edges: U-bend wrapping around diagram edge
  if (isBackward) {
    return computeBackwardWaypoints(src, tgt, allNodes);
  }

  // Forward offset: Z-bend (down to midpoint, over, down)
  if (isSideways) {
    const midY = (src.y + tgt.y) / 2;
    return [
      { x: src.x, y: midY },
      { x: tgt.x, y: midY },
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
export function adjustTerminalRuns(waypoints, src, tgt, sourceHandle) {
  if (!waypoints || waypoints.length === 0) return waypoints;

  const wps  = waypoints.map(wp => ({ ...wp }));
  const orig = waypoints; // untouched reference for comparisons
  const isSideHandle = sourceHandle === 'exit-pass' || sourceHandle === 'exit-fail';

  // ── Source end ──
  if (isSideHandle) {
    // Side handle → horizontal first segment → shift Y of first horizontal run
    const origY = orig[0].y;
    for (let i = 0; i < wps.length - 1; i++) {
      if (i === 0 || Math.abs(orig[i].y - origY) < 2) {
        wps[i] = { ...wps[i], y: src.y };
      } else break;
    }
  } else {
    // Bottom handle → vertical first segment → shift X of first vertical run
    const origX = orig[0].x;
    for (let i = 0; i < wps.length - 1; i++) {
      if (i === 0 || Math.abs(orig[i].x - origX) < 2) {
        wps[i] = { ...wps[i], x: src.x };
      } else break;
    }
    // Also track Y of the first horizontal run (source departure).
    // For a U-route: wp[0]=(srcX, srcY+D), wp[1]=(sideX, srcY+D)
    // When source moves, these Y values should track src.y + offset.
    if (wps.length >= 2) {
      const origDepY = orig[0].y;
      const origSrcY = origDepY; // first wp Y was originally relative to source
      const deltaY = src.y - (orig.length >= 2 ? orig[0].y - (orig[0].y - src.y) : src.y);
      // Simpler: compute original offset from source, apply to new source Y
      // Original offset = orig[0].y - originalSrcY. But we don't have originalSrcY.
      // Instead: shift all wps sharing the same Y as wp[0] by how much wp[0] moved.
      const yShift = wps[0].y - orig[0].y; // how much wp[0] already moved (0 for bottom handle)
      if (Math.abs(yShift) < 1) {
        // Bottom handle: wp[0].x was shifted but Y didn't change yet.
        // Nothing to do — Y is fine for bottom handle source departure.
      }
    }
  }

  // ── Target end: shift last vertical run ──
  // Walk backward: consecutive wps sharing X with the last wp form
  // the vertical drop into the target. They all shift to targetX.
  // Stop at index 1 so we don't collide with source-adjusted wp[0].
  const origLastX = orig[orig.length - 1].x;
  for (let i = wps.length - 1; i >= 1; i--) {
    if (Math.abs(orig[i].x - origLastX) < 2) {
      wps[i] = { ...wps[i], x: tgt.x };
    } else break;
  }

  // Single-waypoint L-bend (side handle): adjust both coordinates
  if (wps.length === 1 && isSideHandle) {
    wps[0] = { ...wps[0], x: tgt.x };
  }

  return wps;
}

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
  const srcIsPassHandle   = sourceHandle === 'exit-pass';
  const srcIsFailHandle   = sourceHandle === 'exit-fail';
  const srcIsBottomHandle = !srcIsPassHandle && !srcIsFailHandle; // null, exit-single, exit-retry

  const lastSegIdx = result.length - 2; // segment index for wp[last-1]→wp[last]

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
          // Default (non-owner): corridor-gated closer-side push
          const distLeft = segX - nx;
          const distRight = (nx + nw) - segX;
          newX = distLeft < distRight ? nx - PAD : nx + nw + PAD;
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
          // Default (non-owner): corridor-gated closer-side push
          const distTop = segY - ny;
          const distBot = (ny + nh) - segY;
          newY = distTop < distBot ? ny - PAD : ny + nh + PAD;
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
export function canDragSegment(seg, totalPoints) {
  const isFirstSeg = seg.ptIdxA === 0;
  const isLastSeg = seg.ptIdxB === totalPoints - 1;
  return !isFirstSeg && !isLastSeg;
}

/**
 * Apply a drag delta to a segment's waypoints.
 * Horizontal segments move vertically (change Y).
 * Vertical segments move horizontally (change X).
 *
 * @param {Array} dragWps — materialized waypoint array (fullPts without src/tgt)
 * @param {Object} seg — segment metadata from buildSegments
 * @param {number} dx — horizontal drag delta in flow coordinates
 * @param {number} dy — vertical drag delta in flow coordinates
 * @returns {Array} new waypoint array with drag applied
 */
export function applySegmentDrag(dragWps, seg, dx, dy) {
  const wps = dragWps.map(w => ({ ...w }));
  const wpIdxA = seg.ptIdxA - 1; // -1 because fullPts[0] = src
  const wpIdxB = seg.ptIdxB - 1;

  if (seg.isH) {
    // Horizontal segment → drag vertically
    if (wpIdxA >= 0 && wpIdxA < wps.length) wps[wpIdxA] = { ...wps[wpIdxA], y: dragWps[wpIdxA].y + dy };
    if (wpIdxB >= 0 && wpIdxB < wps.length) wps[wpIdxB] = { ...wps[wpIdxB], y: dragWps[wpIdxB].y + dy };
  } else {
    // Vertical segment → drag horizontally
    if (wpIdxA >= 0 && wpIdxA < wps.length) wps[wpIdxA] = { ...wps[wpIdxA], x: dragWps[wpIdxA].x + dx };
    if (wpIdxB >= 0 && wpIdxB < wps.length) wps[wpIdxB] = { ...wps[wpIdxB], x: dragWps[wpIdxB].x + dx };
  }

  return wps;
}

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
export function computeSegmentAxes(handlePos, waypoints, tgtPos) {
  if (!waypoints || waypoints.length === 0) return { firstSegmentAxis: 'vertical', lastSegmentAxis: 'vertical' };

  // First segment: handle → wp[0]
  const wp0 = waypoints[0];
  const dx0 = Math.abs(handlePos.x - wp0.x);
  const dy0 = Math.abs(handlePos.y - wp0.y);
  let firstSegmentAxis;
  if (dx0 < ALIGN_THRESHOLD && dy0 >= ALIGN_THRESHOLD) firstSegmentAxis = 'vertical';
  else if (dy0 < ALIGN_THRESHOLD && dx0 >= ALIGN_THRESHOLD) firstSegmentAxis = 'horizontal';
  else firstSegmentAxis = dy0 >= dx0 ? 'vertical' : 'horizontal';

  // Last segment: wp[last] → target
  // Best method: compare last waypoint with actual target position
  const wpLast = waypoints[waypoints.length - 1];
  let lastSegmentAxis;
  if (tgtPos) {
    const dxL = Math.abs(wpLast.x - tgtPos.x);
    const dyL = Math.abs(wpLast.y - tgtPos.y);
    if (dxL < ALIGN_THRESHOLD && dyL >= ALIGN_THRESHOLD) lastSegmentAxis = 'vertical';
    else if (dyL < ALIGN_THRESHOLD && dxL >= ALIGN_THRESHOLD) lastSegmentAxis = 'horizontal';
    else lastSegmentAxis = dxL <= dyL ? 'vertical' : 'horizontal';
  } else {
    // Fallback: infer from waypoint pattern (less reliable)
    if (waypoints.length >= 2) {
      const wpPrev = waypoints[waypoints.length - 2];
      const sameX = Math.abs(wpPrev.x - wpLast.x) < ALIGN_THRESHOLD;
      // If prev→last is vertical (share X), last→tgt is probably horizontal, and vice versa
      lastSegmentAxis = sameX ? 'horizontal' : 'vertical';
    } else {
      lastSegmentAxis = firstSegmentAxis === 'vertical' ? 'horizontal' : 'vertical';
    }
  }

  return { firstSegmentAxis, lastSegmentAxis };
}

// ── Label Placement ──────────────────────────────────────────────────────────

/**
 * Find the best segment for placing a label (the longest one).
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
