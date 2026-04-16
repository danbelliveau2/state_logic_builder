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

import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { OUTCOME_COLORS } from '../../lib/outcomeColors.js';
import {
  buildFullPath,
  buildSegments,
  pointsToSvg,
  computeAutoRoute,
  adjustTerminalRuns,
  canDragSegment,
  applySegmentDrag,
  cleanWaypoints,
  findLabelSegment,
  findLongestVerticalSegment,
} from '../../lib/edgeRouting.js';

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
    routeWps = adjustTerminalRuns(storedWaypoints, src, tgt, sourceHandle);
  } else {
    routeWps = computeAutoRoute(src, tgt, data, getNodes());
  }

  // Build the full orthogonal point sequence
  const fullPts  = buildFullPath(src, routeWps, tgt);
  const segments = buildSegments(fullPts);
  const pathD    = pointsToSvg(fullPts);

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

    function onMove(ev) {
      const flow0 = screenToFlowPosition({ x: startX, y: startY });
      const flow1 = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = flow1.x - flow0.x;
      const dy = flow1.y - flow0.y;
      const wps = applySegmentDrag(dragWps, seg, dx, dy);
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
        const bestSeg = findLabelSegment(segments);

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
        const { segment: labelSeg } = findLongestVerticalSegment(segments);

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
        // First/last segments are locked to node handles — not draggable
        if (!canDragSegment(seg, fullPts.length)) return null;

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
