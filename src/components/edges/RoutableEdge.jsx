/**
 * RoutableEdge.jsx — Orthogonal edge routing (auto-only).
 *
 * Every edge is auto-routed live from source/target positions. There is no
 * stored waypoint, no manualRoute, no segment drag. Forward edges follow
 * the perpendicular-out-of-handle rule via `computeAutoRoute`; loop-back
 * edges read `data.loopSide` to U-route around the chosen side.
 *
 * Visuals:
 *   - Visible orthogonal path (NO markerEnd — direction is shown by per-
 *     segment arrows).
 *   - One arrow per segment, in the middle. Tiny corner segments skipped.
 *   - Branch label pill on first segment (live from source's PickerV2
 *     `pickerConfig.edgeLabels`); legacy `Ready` placeholder dropped.
 *   - Vision / Check-result outcome label on the longest vertical segment.
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
  enforceNodeClearance,
  cleanWaypoints,
  findLongestVerticalSegment,
  NODE_WIDTH,
} from '../../lib/edgeRouting.js';

// ── Component ──────────────────────────────────────────────────────────────────

export function RoutableEdge({
  id,
  source,
  sourceX, sourceY,
  targetX, targetY,
  sourceHandleId: sourceHandle,  // React Flow v12 passes sourceHandleId, not sourceHandle
  data,
  label,                          // top-level edge label (fallback for data.outcomeLabel)
  style,
  selected,
}) {
  const { getNodes, screenToFlowPosition } = useReactFlow();
  const smId = useDiagramStore(s => s.activeSmId);
  const updateLoopParams = useDiagramStore(s => s.updateLoopParams);
  const pushHistory = useDiagramStore(s => s._pushHistory);

  const src = { x: sourceX, y: sourceY };
  const tgt = { x: targetX, y: targetY };

  // ── Determine waypoints ─────────────────────────────────────────────────
  const nodes = getNodes();
  let routeWps = computeAutoRoute(src, tgt, data, nodes, sourceHandle);
  // Skip node-clearance for loop-back edges — the user owns the rail
  // position via `loopOffset`. Clearance would push it away from
  // source/target nodes (25px minimum) and fight the drag.
  const isLoopBackForClearance = data?.loopSide === 'left' || data?.loopSide === 'right';
  if (!isLoopBackForClearance) {
    routeWps = enforceNodeClearance(routeWps, src, tgt, nodes, sourceHandle);
  }

  // Build the full orthogonal point sequence. cleanWaypoints merges any
  // collinear points so a visually-straight line never gets split into two
  // segments — otherwise each "segment" would render its own arrow on what
  // looks like one straight run.
  const fullPts  = cleanWaypoints(buildFullPath(src, routeWps, tgt));
  const segments = buildSegments(fullPts);
  const pathD    = pointsToSvg(fullPts);

  // ── Styles ──────────────────────────────────────────────────────────────
  // Branch edges (decision exits) are GRAY regardless of stored style.
  // Older edges have `style.stroke` baked in as green/red from when they
  // were created; we ignore that for branch edges and use neutral gray.
  const isBranchEdge = data?.isDecisionExit === true;
  const strokeColor = selected
    ? '#0072B5'
    : (isBranchEdge ? '#6b7280' : (style?.stroke ?? '#6b7280'));
  const strokeW     = selected ? 3 : (style?.strokeWidth ?? 2);

  // ── Loop-back drag handles ──────────────────────────────────────────────
  // Every BACKWARD edge (target above source) is parametric: shape comes
  // from three numbers (loopOffset, loopTopDrop, loopBottomDrop) and a
  // side flag (loopSide). We render thin invisible overlays on the
  // three adjustable segments; dragging one updates ONE number via the
  // store. Auto-route then redraws — same model as node drag. No stored
  // waypoints, no shape changes, axis-locked.
  const isBackwardEdge = targetY < sourceY - 30;
  const isLoopBack = isBackwardEdge;
  // Side defaults to whatever the auto-route picked: explicit `loopSide`
  // wins; otherwise target's X relative to source. We pin the side on
  // first drag so the rail can't flip across the source's mid-X.
  const loopGoRight = data?.loopSide === 'right'
                  || (data?.loopSide == null && targetX >= sourceX);
  const isSideHandleSrc = sourceHandle === 'exit-fail' || sourceHandle === 'exit-retry';

  const onLoopDrag = useCallback((e, paramKey, axis, sign) => {
    e.stopPropagation();
    e.preventDefault();
    pushHistory();
    const startScreen = { x: e.clientX, y: e.clientY };
    const startVal = Number(data?.[paramKey] ?? (paramKey === 'loopOffset' ? 60 : 40));
    // Pin loopSide on the first drag so the rail can't flip if user
    // drags it past the source's mid-X.
    const sideToPin = data?.loopSide ?? (loopGoRight ? 'right' : 'left');
    function onMove(ev) {
      const a = screenToFlowPosition(startScreen);
      const b = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const delta = axis === 'x' ? (b.x - a.x) : (b.y - a.y);
      const next = Math.max(0, Math.round(startVal + sign * delta));
      const updates = { [paramKey]: next };
      if (data?.loopSide == null) updates.loopSide = sideToPin;
      updateLoopParams(smId, id, updates);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [smId, id, data, updateLoopParams, pushHistory, screenToFlowPosition, loopGoRight]);

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

      {/* Visible orthogonal path. NO markerEnd — direction is shown by the
          per-segment arrows below (one in the middle of each segment). */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeW}
        style={{ pointerEvents: 'none' }}
      />

      {/* Direction arrows — one per segment, in the MIDDLE. */}
      {segments.map((seg, i) => {
        const MIN_SEGMENT_LEN = 24;
        const SIZE = 7;
        const WIDTH = 4;
        const segLen = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
        if (segLen < MIN_SEGMENT_LEN) return null;

        const BRANCH_HANDLES = new Set(['exit-pass', 'exit-fail', 'exit-retry']);
        const isBranchEdge2 = data?.isDecisionExit === true || BRANCH_HANDLES.has(sourceHandle);
        const hasSourcePill = i === 0 && isBranchEdge2 && sourceHandle !== 'exit-single';
        const PILL_CLEAR = 60;
        if (hasSourcePill && segLen < PILL_CLEAR + 14) return null;
        const tDist = hasSourcePill ? PILL_CLEAR : segLen * 0.5;

        const ux = (seg.b.x - seg.a.x) / segLen;
        const uy = (seg.b.y - seg.a.y) / segLen;
        const ax = seg.a.x + ux * tDist;
        const ay = seg.a.y + uy * tDist;
        const px = -uy, py = ux;
        const tip   = { x: ax + ux * SIZE,             y: ay + uy * SIZE };
        const baseL = { x: ax - ux * SIZE + px * WIDTH, y: ay - uy * SIZE + py * WIDTH };
        const baseR = { x: ax - ux * SIZE - px * WIDTH, y: ay - uy * SIZE - py * WIDTH };
        return (
          <polygon
            key={`arrow-${i}`}
            points={`${tip.x},${tip.y} ${baseL.x},${baseL.y} ${baseR.x},${baseR.y}`}
            fill={strokeColor}
            opacity={0.75}
            style={{ pointerEvents: 'none' }}
          />
        );
      })}

      {/* Loop-back drag overlays — only render when the edge is a loop-back.
          Each overlay is an invisible thicker stroke on top of one of the
          three adjustable segments. Dragging updates ONE numeric field
          (loopOffset / loopTopDrop / loopBottomDrop) via the store; the
          shape recomputes via auto-route on next render. Axis-locked
          cursors signal which direction each segment moves.
          Bottom-handle U → 5 segments; segments[1]=topH, [2]=sideRail, [3]=botH.
          Side-handle U   → 4 segments; segments[1]=sideRail, [2]=botH. */}
      {isLoopBack && (() => {
        const overlays = [];
        const mkOverlay = (seg, key, paramKey, axis, sign, cursor) => (
          <path
            key={key}
            d={`M ${seg.a.x} ${seg.a.y} L ${seg.b.x} ${seg.b.y}`}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            style={{ cursor, pointerEvents: 'stroke' }}
            onMouseDown={(e) => onLoopDrag(e, paramKey, axis, sign)}
          />
        );
        if (isSideHandleSrc) {
          // [1]=sideRail (X-drag), [2]=botH (Y-drag)
          if (segments[1]) overlays.push(mkOverlay(
            segments[1], 'loop-rail', 'loopOffset', 'x',
            loopGoRight ? 1 : -1, 'ew-resize',
          ));
          if (segments[2]) overlays.push(mkOverlay(
            segments[2], 'loop-bot', 'loopBottomDrop', 'y', -1, 'ns-resize',
          ));
        } else {
          // [1]=topH (Y-drag), [2]=sideRail (X-drag), [3]=botH (Y-drag)
          if (segments[1]) overlays.push(mkOverlay(
            segments[1], 'loop-top', 'loopTopDrop', 'y', 1, 'ns-resize',
          ));
          if (segments[2]) overlays.push(mkOverlay(
            segments[2], 'loop-rail', 'loopOffset', 'x',
            loopGoRight ? 1 : -1, 'ew-resize',
          ));
          if (segments[3]) overlays.push(mkOverlay(
            segments[3], 'loop-bot', 'loopBottomDrop', 'y', -1, 'ns-resize',
          ));
        }
        return overlays;
      })()}

      {/* Decision exit label pill — live from source state's PickerV2 config. */}
      {(() => {
        const BRANCH_HANDLES = new Set(['exit-pass', 'exit-fail', 'exit-retry']);
        const isBranch = data?.isDecisionExit === true || BRANCH_HANDLES.has(sourceHandle);
        if (!isBranch || sourceHandle === 'exit-single' || segments.length === 0) return null;

        const srcNode = getNodes().find(n => n.id === source);
        const branchAct = (srcNode?.data?.actions ?? [])
          .slice().reverse()
          .find(a => a?.pickerV2
            && a?.pickerConfig?.mode === 'decision'
            && a?.pickerConfig?.subAction === 'branch');
        const elabels = branchAct?.pickerConfig?.edgeLabels ?? [];
        const liveLabel = sourceHandle === 'exit-pass'  ? elabels[0]
                        : sourceHandle === 'exit-fail'  ? elabels[1]
                        : sourceHandle === 'exit-retry' ? elabels[elabels.length - 1]
                        : null;
        const stored = data?.outcomeLabel ?? data?.label ?? label ?? '';
        const cleaned = stored && stored !== 'Ready' ? stored : '';
        const rawLabel = liveLabel || cleaned;
        if (!rawLabel) return null;
        // Edge strokes stay gray; only the LABEL pill carries color so the
        // user can read the outcome at a glance:
        //   On / Pass / True  → green
        //   Off / Fail / False → red
        //   Retry              → amber
        //   anything else      → gray
        const labelText = rawLabel.includes('_') ? rawLabel.split('_')[0] : rawLabel;
        const lcLabel = labelText.toLowerCase();
        const bgColor =
          lcLabel === 'on' || lcLabel === 'pass' || lcLabel === 'true'  ? '#16a34a'
        : lcLabel === 'off' || lcLabel === 'fail' || lcLabel === 'false' ? '#dc2626'
        : lcLabel === 'retry'                                            ? '#f59e0b'
        : '#6b7280';
        const charW     = 6.5;
        const pillW     = Math.max(36, labelText.length * charW + 16);
        const pillH     = 18;
        const textColor = 'white';

        const isBottomHandle = sourceHandle === 'exit-pass' || sourceHandle == null;
        let lx, ly;
        if (isBottomHandle) {
          const seg = segments[0];
          const V_OFFSET = 36;
          lx = seg.a.x;
          ly = seg.a.y + V_OFFSET;
        } else {
          const seg = segments[0];
          const H_OFFSET = 36;
          if (seg.isH) {
            const dir = seg.b.x > seg.a.x ? 1 : -1;
            lx = seg.a.x + dir * H_OFFSET;
            ly = seg.a.y;
          } else {
            lx = seg.a.x;
            ly = (seg.a.y + seg.b.y) / 2;
          }
        }

        return (
          <g style={{ pointerEvents: 'none' }}>
            <rect x={lx - pillW / 2} y={ly - pillH / 2} width={pillW} height={pillH} rx={9} fill={bgColor} opacity={0.9} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fill={textColor} fontSize={10} fontWeight="600" style={{ userSelect: 'none' }}>{labelText}</text>
          </g>
        );
      })()}

      {/* Outcome label for vision / check-result edges. */}
      {(data?.conditionType === 'checkResult' || data?.conditionType === 'visionResult') && data?.outcomeLabel && !data?.isDecisionExit && segments.length > 0 && (() => {
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
    </>
  );
}
