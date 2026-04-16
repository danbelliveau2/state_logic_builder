/**
 * DrawingConnectionLine.jsx — Custom connection line for click-to-draw routing.
 *
 * RULES:
 *   1. When no waypoints have been placed yet (initial drag from handle):
 *      the line is AXIS-LOCKED — straight down from a bottom handle,
 *      straight sideways from a side handle. No diagonal, no L-shape.
 *
 *   2. Once waypoints exist: orthogonal corners between placed waypoints,
 *      and the live segment (last waypoint → cursor) is axis-locked to
 *      whichever axis the last segment ended on.
 */

import { useDiagramStore } from '../../store/useDiagramStore.js';

/**
 * Build an orthogonal SVG path string from an array of {x, y} points.
 * Between consecutive points that are not axis-aligned, inserts a bend
 * (vertical first, then horizontal) to keep all segments orthogonal.
 */
function buildOrthogonalPath(points) {
  if (points.length < 2) return '';

  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    if (prev.x === curr.x || prev.y === curr.y) {
      parts.push(`L ${curr.x} ${curr.y}`);
    } else {
      parts.push(`L ${prev.x} ${curr.y}`);
      parts.push(`L ${curr.x} ${curr.y}`);
    }
  }
  return parts.join(' ');
}

export function DrawingConnectionLine({
  fromX,
  fromY,
  fromPosition,   // React Flow Position enum: 'top' | 'bottom' | 'left' | 'right'
  toX,
  toY,
}) {
  const drawingWaypoints = useDiagramStore(s => s._drawingWaypoints);
  const wps = drawingWaypoints ?? [];

  // ── Fixed path: source → placed waypoints (orthogonal corners) ──────────
  const fixedPoints = [{ x: fromX, y: fromY }, ...wps];
  const fixedPathD = wps.length > 0 ? buildOrthogonalPath(fixedPoints) : '';

  // ── Live segment: last anchor → cursor (AXIS-LOCKED) ───────────────────
  // The live segment extends only along the axis that makes sense:
  //   - If no waypoints: determined by the source handle direction
  //     Bottom → vertical (straight down/up)
  //     Left/Right → horizontal (straight sideways)
  //   - If waypoints exist: determined by the last waypoint's relationship
  //     to its predecessor — the live segment continues on the alternate axis.
  const anchor = wps.length > 0 ? wps[wps.length - 1] : { x: fromX, y: fromY };

  let liveX, liveY;
  if (wps.length === 0) {
    // No waypoints yet — axis-lock based on handle direction
    const isHorizontalHandle = fromPosition === 'left' || fromPosition === 'right';
    if (isHorizontalHandle) {
      // Side handle → horizontal only (keep anchor Y)
      liveX = toX;
      liveY = anchor.y;
    } else {
      // Bottom/Top handle → vertical only (keep anchor X)
      liveX = anchor.x;
      liveY = toY;
    }
  } else {
    // Waypoints exist — determine which axis the last placed segment was on
    const prev = wps.length >= 2 ? wps[wps.length - 2] : { x: fromX, y: fromY };
    const lastWp = wps[wps.length - 1];
    const lastSegWasHorizontal = Math.abs(prev.y - lastWp.y) < 1;
    if (lastSegWasHorizontal) {
      // Last segment was horizontal → live segment should be vertical
      liveX = anchor.x;
      liveY = toY;
    } else {
      // Last segment was vertical → live segment should be horizontal
      liveX = toX;
      liveY = anchor.y;
    }
  }

  const livePathD = `M ${anchor.x} ${anchor.y} L ${liveX} ${liveY}`;

  return (
    <g>
      {/* Committed orthogonal path through placed waypoints */}
      {fixedPathD && (
        <path
          d={fixedPathD}
          fill="none"
          stroke="#0072B5"
          strokeWidth={2}
          strokeDasharray="6 3"
        />
      )}

      {/* Live axis-locked line from last anchor to cursor */}
      <path
        d={livePathD}
        fill="none"
        stroke="#0072B5"
        strokeWidth={2}
        strokeDasharray="6 3"
        opacity={0.7}
      />

      {/* Render dots at each placed waypoint */}
      {wps.map((wp, i) => (
        <circle
          key={i}
          cx={wp.x}
          cy={wp.y}
          r={4}
          fill="#0072B5"
          stroke="white"
          strokeWidth={1.5}
        />
      ))}
    </g>
  );
}
