/**
 * ManualDrawOverlay.jsx — Renders a dotted preview path during manual draw mode.
 *
 * After the user right-clicks a handle to enter manual draw mode,
 * this overlay renders the path from the source handle through all placed waypoints,
 * with a live segment to the current mouse position (ortho-snapped).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useDiagramStore } from '../../store/useDiagramStore.js';

/** Build an orthogonal SVG path from points (inserting corners where needed). */
function buildOrthoPath(points) {
  if (points.length < 2) return '';
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const alignedX = Math.abs(prev.x - curr.x) < 1;
    const alignedY = Math.abs(prev.y - curr.y) < 1;
    if (alignedX || alignedY) {
      parts.push(`L ${curr.x} ${curr.y}`);
    } else {
      const dx = Math.abs(curr.x - prev.x);
      const dy = Math.abs(curr.y - prev.y);
      if (dx > dy) {
        parts.push(`L ${curr.x} ${prev.y}`);
      } else {
        parts.push(`L ${prev.x} ${curr.y}`);
      }
      parts.push(`L ${curr.x} ${curr.y}`);
    }
  }
  return parts.join(' ');
}

export function ManualDrawOverlay() {
  const isDrawing = useDiagramStore(s => s._isDrawingConnection);
  const drawSource = useDiagramStore(s => s._drawingSource);
  const waypoints = useDiagramStore(s => s._drawingWaypoints);
  const { screenToFlowPosition, getNodes } = useReactFlow();
  const viewport = useViewport();

  // Use a ref to always have access to the latest screenToFlowPosition
  const s2fRef = useRef(screenToFlowPosition);
  s2fRef.current = screenToFlowPosition;

  const [mouseFlowPos, setMouseFlowPos] = useState(null);

  // Track mouse position — convert to flow coords using screenToFlowPosition
  useEffect(() => {
    if (!isDrawing || !drawSource) {
      setMouseFlowPos(null);
      return;
    }
    function onMove(e) {
      const pos = s2fRef.current({ x: e.clientX, y: e.clientY });
      setMouseFlowPos(pos);
    }
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [isDrawing, drawSource]);

  // Don't render if not in manual draw mode
  if (!isDrawing || !drawSource) return null;

  // Find source node position to get the handle position
  const nodes = getNodes();
  const sourceNode = nodes.find(n => n.id === drawSource.nodeId);
  if (!sourceNode) return null;

  // Compute source handle position
  const nodeW = sourceNode.measured?.width ?? 240;
  const nodeH = sourceNode.measured?.height ?? 80;
  let handleX = sourceNode.position.x + nodeW / 2;
  let handleY = sourceNode.position.y + nodeH;

  const handle = drawSource.handleId;
  if (handle === 'exit-pass') {
    handleX = sourceNode.position.x;
    handleY = sourceNode.position.y + nodeH / 2;
  } else if (handle === 'exit-fail') {
    handleX = sourceNode.position.x + nodeW;
    handleY = sourceNode.position.y + nodeH / 2;
  } else if (handle === 'exit-retry') {
    handleX = sourceNode.position.x + nodeW / 2;
    handleY = sourceNode.position.y + nodeH;
  }

  // Build the point sequence: source → waypoints → mouse
  const pts = [{ x: handleX, y: handleY }];
  if (waypoints && waypoints.length > 0) {
    pts.push(...waypoints);
  }

  // Add ortho-snapped mouse position as the last point
  if (mouseFlowPos && waypoints && waypoints.length > 0) {
    const last = waypoints[waypoints.length - 1];
    const dx = Math.abs(mouseFlowPos.x - last.x);
    const dy = Math.abs(mouseFlowPos.y - last.y);
    if (dx > dy) {
      pts.push({ x: mouseFlowPos.x, y: last.y });
    } else {
      pts.push({ x: last.x, y: mouseFlowPos.y });
    }
  } else if (mouseFlowPos) {
    pts.push(mouseFlowPos);
  }

  const pathD = buildOrthoPath(pts);

  // Render in flow coordinate space using viewport transform
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
        overflow: 'visible',
      }}
    >
      <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
        {/* Dotted preview path */}
        <path
          d={pathD}
          fill="none"
          stroke="#0072B5"
          strokeWidth={2 / viewport.zoom}
          strokeDasharray={`${6 / viewport.zoom} ${3 / viewport.zoom}`}
        />

        {/* Dots at placed waypoints */}
        {(waypoints ?? []).map((wp, i) => (
          <circle
            key={i}
            cx={wp.x}
            cy={wp.y}
            r={5 / viewport.zoom}
            fill="#0072B5"
            stroke="white"
            strokeWidth={2 / viewport.zoom}
          />
        ))}
      </g>

      {/* Hint text (in screen coords, at top center) */}
      <text
        x="50%"
        y={30}
        textAnchor="middle"
        fill="#0072B5"
        fontSize={13}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
        style={{ userSelect: 'none' }}
      >
        Manual Draw: Click to add corners · Click a node to connect · Enter to finish · Esc to cancel
      </text>
    </svg>
  );
}
