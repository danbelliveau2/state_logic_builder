/**
 * RoutableEdge.jsx — Orthogonal edge routing
 *
 * ROUTING RULES:
 *   - Auto-route: computed live from source/target positions.
 *     Forward aligned → straight vertical
 *     Forward offset  → Z-bend at midY
 *     Decision exit   → L-bend (horizontal out, vertical down)
 *     Backward        → U-bend wrapping around diagram edge
 *
 * MANUAL ROUTING (click-to-draw waypoints):
 *   Waypoints are stored as ortho-snapped corner points.
 *   The path is: src → wp[0] → wp[1] → … → wp[n] → tgt
 *   Each consecutive pair should already be axis-aligned (same X or same Y).
 *   If not, we insert one auto-corner to keep things orthogonal.
 *
 * SEGMENT DRAG:
 *   Dragging a segment moves the underlying waypoint(s) — no new waypoints created.
 *   If two adjacent segments become collinear after drag, they merge (waypoint removed).
 */

import { useRef, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { OUTCOME_COLORS } from '../../lib/outcomeColors.js';

const NODE_WIDTH = 240;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Remove collinear waypoints (adjacent points on the same axis that can merge). */
function cleanWaypoints(pts) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    // Skip if same position as previous
    if (Math.abs(prev.x - curr.x) < 1 && Math.abs(prev.y - curr.y) < 1) continue;
    // Merge collinear: if prev, curr, and the one before prev are all on the same axis
    if (out.length >= 2) {
      const pp = out[out.length - 2];
      const sameX = Math.abs(pp.x - prev.x) < 1 && Math.abs(prev.x - curr.x) < 1;
      const sameY = Math.abs(pp.y - prev.y) < 1 && Math.abs(prev.y - curr.y) < 1;
      if (sameX || sameY) {
        out[out.length - 1] = curr; // Replace prev with curr (merge)
        continue;
      }
    }
    out.push(curr);
  }
  return out;
}

/**
 * Build the full point sequence from src → waypoints → tgt.
 * Ensures all segments are orthogonal by inserting corners where needed.
 */
function buildFullPath(src, waypoints, tgt) {
  const raw = [src, ...waypoints, tgt];
  const pts = [raw[0]];

  for (let i = 1; i < raw.length; i++) {
    const prev = pts[pts.length - 1];
    const curr = raw[i];
    const alignedX = Math.abs(prev.x - curr.x) < 1;
    const alignedY = Math.abs(prev.y - curr.y) < 1;

    if (alignedX || alignedY) {
      // Already orthogonal
      pts.push(curr);
    } else {
      // Need a corner — choose orientation based on context
      const isLast = i === raw.length - 1;
      if (isLast) {
        // Going to target: go horizontal first, then vertical into target
        pts.push({ x: curr.x, y: prev.y });
      } else {
        // Going to next waypoint: go vertical first, then horizontal
        pts.push({ x: prev.x, y: curr.y });
      }
      pts.push(curr);
    }
  }

  return pts;
}

/** Build segment metadata from a point array. */
function buildSegments(pts, waypointCount) {
  const segments = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    segments.push({
      a,
      b,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      isH: Math.abs(a.y - b.y) < 1,
      ptIdxA: i,
      ptIdxB: i + 1,
    });
  }
  return segments;
}

/** SVG "M … L … L …" from an array of {x,y} */
function pointsToSvg(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

// ── Auto-route computation ────────────────────────────────────────────────────

function computeBackwardWaypoints(src, tgt, allNodes) {
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

  const centerX = (leftBound + rightBound) / 2;
  const goRight = src.x > centerX;
  const sideX   = goRight ? rightBound + PAD : leftBound - PAD;

  return [
    { x: src.x, y: src.y + DROP },
    { x: sideX, y: src.y + DROP },
    { x: sideX, y: tgt.y - DROP },
    { x: tgt.x, y: tgt.y - DROP },
  ];
}

function computeAutoRoute(src, tgt, data, allNodes) {
  const isBackward     = tgt.y < src.y - 30;
  const isSideways     = Math.abs(src.x - tgt.x) > 10;
  const isDecisionExit = data?.isDecisionExit === true;
  const isSideHandleExit = isDecisionExit
    && (data?.exitColor === 'pass' || data?.exitColor === 'fail');

  // Side-handle decision exits (pass/fail): ALWAYS L-bend starting horizontal,
  // even when the target is above (backward). The auto-route recomputes fresh
  // every render so the shape tracks the node perfectly on drag.
  if (isSideHandleExit) {
    return [{ x: tgt.x, y: src.y }];
  }

  if (isBackward) {
    return computeBackwardWaypoints(src, tgt, allNodes);
  }

  if (isDecisionExit && data?.exitColor !== 'retry' && isSideways) {
    return [{ x: tgt.x, y: src.y }];
  }

  if (isSideways) {
    const midY = (src.y + tgt.y) / 2;
    return [
      { x: src.x, y: midY },
      { x: tgt.x, y: midY },
    ];
  }

  return [];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RoutableEdge({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourceHandleId: sourceHandle,  // React Flow v12 passes sourceHandleId, not sourceHandle
  data,
  style,
  markerEnd,
  selected,
}) {
  const { getNodes, screenToFlowPosition } = useReactFlow();
  const smId      = useDiagramStore(s => s.activeSmId);
  const updateWP  = useDiagramStore(s => s.updateEdgeWaypoints);
  const pushHistory = useDiagramStore(s => s._pushHistory);

  const storedWaypoints = Array.isArray(data?.waypoints) ? data.waypoints : [];
  const isManual = data?.manualRoute === true && storedWaypoints.length > 0;

  const src = { x: sourceX, y: sourceY };
  const tgt = { x: targetX, y: targetY };

  // ── Determine waypoints ─────────────────────────────────────────────────
  let routeWps;
  if (isManual) {
    // Manual routes are sacred: whatever the user drew, we render as-is.
    // Each segment is independently draggable via the segment-drag handler.
    // If an endpoint node moves far enough that the terminal waypoint no
    // longer lines up with the handle, buildFullPath inserts an auto-corner
    // (connector stub) — the drawn shape is preserved and the user can
    // re-drag a segment if they want to clean up the stub.
    //
    // One exception: an auto-generated decision exit (side handle) where
    // the user NEVER drew the first segment themselves — keep it anchored
    // horizontally to the source so it tracks side-handle movement.
    const isDecExit = data?.isDecisionExit === true;
    const isSideHandle = sourceHandle === 'exit-pass' || sourceHandle === 'exit-fail';
    routeWps = storedWaypoints.map((wp, i) => {
      // Side-handle decision exits: first waypoint ALWAYS stays locked to
      // sourceY so the first segment is horizontal — forward, backward,
      // any direction. The rest of the drawn shape is preserved as-is.
      if (i === 0 && isDecExit && isSideHandle) {
        return { ...wp, y: sourceY };
      }
      return wp;
    });
  } else {
    routeWps = computeAutoRoute(src, tgt, data, getNodes());
  }

  // Build the full orthogonal point sequence
  const fullPts  = buildFullPath(src, routeWps, tgt);
  const segments = buildSegments(fullPts, routeWps.length);
  const pathD    = pointsToSvg(fullPts);

  // ── Fresh waypoints from store ──────────────────────────────────────────
  const freshWps = useCallback(() => {
    const st = useDiagramStore.getState();
    const currentSm = (st.project?.stateMachines ?? []).find(s => s.id === smId);
    const edge = (currentSm?.edges ?? []).find(e => e.id === id);
    const wps = edge?.data?.waypoints;
    return Array.isArray(wps) ? [...wps] : [];
  }, [smId, id]);

  // ── Segment drag ────────────────────────────────────────────────────────
  // Dragging moves ONLY the dragged segment's waypoints. Adjacent segments
  // stretch/shrink because their shared corner point moved with the drag.
  // No new waypoints are ever created by a drag — the shape stays intact.
  // On mouse-up, collinear waypoints are merged.
  const onSegmentMouseDown = useCallback((e, seg, segIdx) => {
    e.stopPropagation();
    e.preventDefault();
    pushHistory();
    const startX = e.clientX;
    const startY = e.clientY;

    // ALWAYS materialize fullPts corners as the working waypoint array.
    // This is critical: stored waypoints may have fewer entries than fullPts
    // because buildFullPath inserts auto-corners when consecutive points
    // aren't axis-aligned. The segment's ptIdxA/ptIdxB reference fullPts
    // indices, so our drag array must match that indexing (minus src at [0]
    // and tgt at [end]).
    const dragWps = fullPts.slice(1, -1).map(p => ({ ...p }));

    // The segment's point indices in fullPts are seg.ptIdxA and seg.ptIdxB
    // Waypoint indices are ptIdx - 1 (since fullPts[0] = src)
    const wpIdxA = seg.ptIdxA - 1; // -1 = src (not a wp)
    const wpIdxB = seg.ptIdxB - 1; // dragWps.length = tgt (not a wp)

    function onMove(ev) {
      const flow0 = screenToFlowPosition({ x: startX, y: startY });
      const flow1 = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = flow1.x - flow0.x;
      const dy = flow1.y - flow0.y;
      const wps = dragWps.map(w => ({ ...w }));

      if (seg.isH) {
        // Horizontal segment → drag vertically (change Y of both endpoints)
        if (wpIdxA >= 0 && wpIdxA < wps.length) wps[wpIdxA] = { ...wps[wpIdxA], y: dragWps[wpIdxA].y + dy };
        if (wpIdxB >= 0 && wpIdxB < wps.length) wps[wpIdxB] = { ...wps[wpIdxB], y: dragWps[wpIdxB].y + dy };
      } else {
        // Vertical segment → drag horizontally (change X of both endpoints)
        if (wpIdxA >= 0 && wpIdxA < wps.length) wps[wpIdxA] = { ...wps[wpIdxA], x: dragWps[wpIdxA].x + dx };
        if (wpIdxB >= 0 && wpIdxB < wps.length) wps[wpIdxB] = { ...wps[wpIdxB], x: dragWps[wpIdxB].x + dx };
      }

      updateWP(smId, id, wps, true);
    }

    function onUp(ev) {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Clean up: merge collinear waypoints
      const st = useDiagramStore.getState();
      const currentSm = (st.project?.stateMachines ?? []).find(s => s.id === smId);
      const edge = (currentSm?.edges ?? []).find(e => e.id === id);
      const finalWps = edge?.data?.waypoints;
      if (Array.isArray(finalWps) && finalWps.length > 1) {
        const cleaned = cleanWaypoints(finalWps);
        if (cleaned.length !== finalWps.length) {
          updateWP(smId, id, cleaned, true);
        }
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [smId, id, screenToFlowPosition, updateWP, pushHistory, fullPts]);

  // ── Styles ──────────────────────────────────────────────────────────────
  const strokeColor = selected ? '#0072B5' : (style?.stroke ?? '#6b7280');
  const strokeW     = selected ? 3 : (style?.strokeWidth ?? 2);

  // ── Label helpers ──────────────────────────────────────────────────────
  const isBackward     = targetY < sourceY - 30;
  const isSidewaysEdge = Math.abs(sourceX - targetX) > 10;

  return (
    <>
      {/* Fat invisible hit area */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Visible orthogonal path */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeW}
        markerEnd={markerEnd}
        style={{ pointerEvents: 'none' }}
      />

      {/* Decision exit label pill */}
      {data?.isDecisionExit && data?.outcomeLabel && (() => {
        const isPass    = data.exitColor === 'pass';
        const isSingle  = data.exitColor === 'single';
        const isRetry   = data.exitColor === 'retry';
        const bgColor   = isRetry ? '#f59e0b' : isSingle ? '#6b7280' : isPass ? '#16a34a' : '#dc2626';
        const labelText = data.outcomeLabel;
        const charW     = 6.5;
        const pillW     = Math.max(80, labelText.length * charW + 20);
        const textColor = isRetry ? '#000' : 'white';

        // Find the longest segment for label placement
        let bestSeg = segments[0];
        let bestLen = 0;
        for (const seg of segments) {
          const len = seg.isH
            ? Math.abs(seg.b.x - seg.a.x)
            : Math.abs(seg.b.y - seg.a.y);
          if (len > bestLen) { bestLen = len; bestSeg = seg; }
        }

        if (bestSeg.isH) {
          // Horizontal label
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={bestSeg.mid.x - pillW / 2} y={bestSeg.mid.y - 10} width={pillW} height={20} rx={10} fill={bgColor} opacity={0.9} />
              <text x={bestSeg.mid.x} y={bestSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill={textColor} fontSize={11} fontWeight="600" style={{ userSelect: 'none' }}>{labelText}</text>
            </g>
          );
        } else {
          // Vertical label (rotated)
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={bestSeg.mid.x - 10} y={bestSeg.mid.y - pillW / 2} width={20} height={pillW} rx={10} fill={bgColor} opacity={0.9} />
              <text x={bestSeg.mid.x} y={bestSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill={textColor} fontSize={11} fontWeight="600" transform={`rotate(-90, ${bestSeg.mid.x}, ${bestSeg.mid.y})`} style={{ userSelect: 'none' }}>{labelText}</text>
            </g>
          );
        }
      })()}

      {/* Outcome label for branching edges (CheckResults + VisionInspect) */}
      {(data?.conditionType === 'checkResult' || data?.conditionType === 'visionResult') && data?.outcomeLabel && !data?.isDecisionExit && segments.length > 0 && (() => {
        // Find longest vertical segment for label
        let labelSeg = segments[segments.length > 1 ? 1 : 0];
        let bestLen = 0;
        for (const seg of segments) {
          if (!seg.isH) {
            const len = Math.abs(seg.b.y - seg.a.y);
            if (len > bestLen) { bestLen = len; labelSeg = seg; }
          }
        }
        if (bestLen === 0) labelSeg = segments[segments.length > 1 ? 1 : 0];

        const outcomeIdx = data.outcomeIndex ?? 0;
        const bgColor    = OUTCOME_COLORS[outcomeIdx % OUTCOME_COLORS.length];
        const labelText  = data.outcomeLabel;
        const charW      = 6.5;
        const pillW      = Math.max(80, labelText.length * charW + 20);
        const isVert     = !labelSeg.isH;

        return (
          <g style={{ pointerEvents: 'none' }}>
            {isVert ? (
              <>
                <rect x={labelSeg.mid.x - 10} y={labelSeg.mid.y - pillW / 2} width={20} height={pillW} rx={10} fill={bgColor} opacity={0.9} />
                <text x={labelSeg.mid.x} y={labelSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" transform={`rotate(-90, ${labelSeg.mid.x}, ${labelSeg.mid.y})`} style={{ userSelect: 'none' }}>{labelText}</text>
              </>
            ) : (
              <>
                <rect x={labelSeg.mid.x - pillW / 2} y={labelSeg.mid.y - 10} width={pillW} height={20} rx={10} fill={bgColor} opacity={0.9} />
                <text x={labelSeg.mid.x} y={labelSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" style={{ userSelect: 'none' }}>{labelText}</text>
              </>
            )}
          </g>
        );
      })()}

      {/* Segment drag overlays — show on selected edges */}
      {selected && segments.map((seg, i) => {
        // The FIRST segment (exits the source node) and LAST segment (enters
        // the target node) are locked — dragging them would introduce a jog
        // right at the node, which is never wanted.
        const isFirstSeg = seg.ptIdxA === 0;
        const isLastSeg  = seg.ptIdxB === fullPts.length - 1;
        if (isFirstSeg || isLastSeg) return null;

        const cursor  = seg.isH ? 'ns-resize' : 'ew-resize';
        const segPath = `M ${seg.a.x} ${seg.a.y} L ${seg.b.x} ${seg.b.y}`;
        return (
          <path
            key={`seg-${i}`}
            d={segPath}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            style={{ cursor, pointerEvents: 'stroke' }}
            onMouseDown={(e) => onSegmentMouseDown(e, seg, i)}
          />
        );
      })}
    </>
  );
}
