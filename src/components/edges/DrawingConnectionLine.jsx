/**
 * DrawingConnectionLine.jsx — Custom connection line for click-to-draw routing.
 *
 * While the user is dragging from a source handle and placing waypoints by
 * clicking on the canvas, this component renders an orthogonal SVG path
 * through: source → accumulated waypoints → current mouse position.
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
      // Already axis-aligned
      parts.push(`L ${curr.x} ${curr.y}`);
    } else {
      // Insert a bend: go vertical first, then horizontal
      parts.push(`L ${prev.x} ${curr.y}`);
      parts.push(`L ${curr.x} ${curr.y}`);
    }
  }
  return parts.join(' ');
}

export function DrawingConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
}) {
  const drawingWaypoints = useDiagramStore(s => s._drawingWaypoints);
  const allPoints = [
    { x: fromX, y: fromY },
    ...(drawingWaypoints ?? []),
    { x: toX, y: toY },
  ];

  const pathD = buildOrthogonalPath(allPoints);

  return (
    <g>
      <path
        d={pathD}
        fill="none"
        stroke="#0072B5"
        strokeWidth={2}
        strokeDasharray="6 3"
      />
      {/* Render dots at each placed waypoint */}
      {(drawingWaypoints ?? []).map((wp, i) => (
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
