/**
 * ConnectMenu — Route direction picker on selected nodes.
 *
 * Two sections:
 *   NEW NODE (1 click — creates node + edge immediately):
 *     ↓  Down        — new node below, straight edge
 *     ↙  Down-Left   — new node below-left
 *     ↘  Down-Right  — new node below-right
 *
 *   CONNECT (2 clicks — loop to existing node):
 *     ↰  Loop Left   — pick target, U-bend going left
 *     ↱  Loop Right  — pick target, U-bend going right
 *     Route shape adapts: bottom handle starts vertical, side handle starts horizontal.
 */

import { useRef, useEffect } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { NODE_WIDTH } from '../lib/edgeRouting.js';

// ── Preset waypoint computation ───────────────────────────────────────────────

/**
 * Compute waypoints for a loop-back routing preset.
 */
export function computePresetWaypoints(preset, src, tgt, handleId, allNodes) {
  const DROP = 40;
  const PAD  = 60;

  let leftBound = Infinity, rightBound = -Infinity;
  for (const n of allNodes) {
    const x = n.position?.x ?? 0;
    leftBound  = Math.min(leftBound, x);
    rightBound = Math.max(rightBound, x + (n.measured?.width ?? NODE_WIDTH));
  }
  if (!isFinite(leftBound))  leftBound  = Math.min(src.x, tgt.x) - PAD;
  if (!isFinite(rightBound)) rightBound = Math.max(src.x, tgt.x) + NODE_WIDTH;

  const isSideHandle = handleId === 'exit-pass' || handleId === 'exit-fail';

  switch (preset) {
    case 'loopLeft': {
      const sideX = leftBound - PAD;
      if (isSideHandle) {
        // Side handle: horizontal out left → vertical to target → horizontal in
        return {
          waypoints: [
            { x: sideX, y: src.y },
            { x: sideX, y: tgt.y - DROP },
            { x: tgt.x, y: tgt.y - DROP },
          ],
          manualRoute: true,
        };
      }
      // Bottom handle: vertical down → horizontal left → vertical up → horizontal in → vertical down
      return {
        waypoints: [
          { x: src.x, y: src.y + DROP },
          { x: sideX,  y: src.y + DROP },
          { x: sideX,  y: tgt.y - DROP },
          { x: tgt.x,  y: tgt.y - DROP },
        ],
        manualRoute: true,
      };
    }

    case 'loopRight': {
      const sideX = rightBound + PAD;
      if (isSideHandle) {
        return {
          waypoints: [
            { x: sideX, y: src.y },
            { x: sideX, y: tgt.y - DROP },
            { x: tgt.x, y: tgt.y - DROP },
          ],
          manualRoute: true,
        };
      }
      return {
        waypoints: [
          { x: src.x, y: src.y + DROP },
          { x: sideX,  y: src.y + DROP },
          { x: sideX,  y: tgt.y - DROP },
          { x: tgt.x,  y: tgt.y - DROP },
        ],
        manualRoute: true,
      };
    }

    // ── Forward connections (target is below source) ──────────────────
    case 'connectDown': {
      if (isSideHandle) {
        // Side handle → horizontal out, then L-bend down to target
        return {
          waypoints: [
            { x: tgt.x, y: src.y },
          ],
          manualRoute: true,
        };
      }
      // Bottom handle: straight down — no waypoints needed
      return { waypoints: [], manualRoute: false };
    }

    case 'connectDownLeft': {
      const midY = (src.y + tgt.y) / 2;
      if (isSideHandle) {
        // Side handle: horizontal out left → vertical down to target
        return {
          waypoints: [
            { x: tgt.x, y: src.y },
          ],
          manualRoute: true,
        };
      }
      // Bottom handle: Z-bend — down to midpoint, left, down into target
      return {
        waypoints: [
          { x: src.x, y: midY },
          { x: tgt.x, y: midY },
        ],
        manualRoute: true,
      };
    }

    case 'connectDownRight': {
      const midY = (src.y + tgt.y) / 2;
      if (isSideHandle) {
        // Side handle: horizontal out right → vertical down to target
        return {
          waypoints: [
            { x: tgt.x, y: src.y },
          ],
          manualRoute: true,
        };
      }
      // Bottom handle: Z-bend — down to midpoint, right, down into target
      return {
        waypoints: [
          { x: src.x, y: midY },
          { x: tgt.x, y: midY },
        ],
        manualRoute: true,
      };
    }

    default:
      return { waypoints: [], manualRoute: false };
  }
}

// ── Handle Click Zone — detects clicks on handles WITHOUT blocking drag ───────

/**
 * Attaches mousedown/mouseup listeners directly to a handle DOM element.
 * - Short click (< 5 px movement, < 300 ms) → toggles ConnectMenu
 * - Drag → React Flow's native connection system works untouched
 * - Hover → native CSS :hover on .sdc-handle works (no overlay blocking it)
 *
 * Renders only a hidden <span> used as a DOM anchor to find the parent node.
 */
export function HandleClickZone({ nodeId, handleSelector, handleId }) {
  const ref = useRef(null);

  useEffect(() => {
    const nodeEl = ref.current?.closest('.react-flow__node');
    if (!nodeEl) return;
    const sel = handleSelector || '.sdc-handle.react-flow__handle-bottom';
    const handle = nodeEl.querySelector(sel);
    if (!handle) return;

    let downPos = null;
    let downTime = 0;

    function onDown(e) {
      downPos = { x: e.clientX, y: e.clientY };
      downTime = Date.now();
    }

    function onUp(e) {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      const elapsed = Date.now() - downTime;
      downPos = null;
      // Short click, not drag → toggle ConnectMenu
      if (moved < 5 && elapsed < 300) {
        const current = useDiagramStore.getState()._connectMenuNodeId;
        const opening = current !== nodeId;
        useDiagramStore.setState({
          _connectMenuNodeId: opening ? nodeId : null,
          // Remember WHICH handle was clicked so ConnectMenu uses the right source
          _connectMenuHandleId: opening ? (handleId ?? null) : null,
        });
      }
    }

    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      handle.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, [nodeId, handleSelector, handleId]);

  return <span ref={ref} style={{ display: 'none' }} />;
}

// ── Collision-free placement ─────────────────────────────────────────────────

/**
 * If the desired position overlaps an existing node, shift straight down
 * (keeping the same X) until clear.  Simple and predictable — the node
 * always stays close to where you asked for it.
 */
function findClearPosition(desired, allNodes, newW, sourceNodeId) {
  const PAD  = 20;   // min gap between nodes
  const newH = 100;  // height estimate for an empty node

  function collides(pos) {
    for (const n of allNodes) {
      if (n.id === sourceNodeId) continue;
      const nx = n.position?.x ?? 0;
      const ny = n.position?.y ?? 0;
      const nw = n.measured?.width  ?? n.width  ?? 240;
      const nh = n.measured?.height ?? n.height ?? 80;
      if (
        pos.x < nx + nw + PAD && pos.x + newW + PAD > nx &&
        pos.y < ny + nh + PAD && pos.y + newH + PAD > ny
      ) {
        return true;
      }
    }
    return false;
  }

  if (!collides(desired)) return desired;

  // Just shift down until clear — keep X exactly where user asked
  for (let dy = 40; dy <= 800; dy += 40) {
    const c = { x: desired.x, y: desired.y + dy };
    if (!collides(c)) return c;
  }

  return desired;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectMenu({ nodeId, nodeType, exitCount, signalName, smId }) {
  const connectPreset = useDiagramStore(s => s._connectPreset);
  const showForNode = useDiagramStore(s => s._connectMenuNodeId);
  const clickedHandleId = useDiagramStore(s => s._connectMenuHandleId);
  const isPickingTarget = connectPreset?.sourceNodeId === nodeId;
  const isVisible = showForNode === nodeId || isPickingTarget;

  if (!nodeId || !smId) return null;
  if (!isVisible) return null;

  const isDecision = nodeType === 'decisionNode';
  const hasSideHandles = isDecision
    && exitCount === 2
    && signalName
    && signalName !== 'Select Signal...';

  // Use the handle the user actually clicked — don't override with a different one
  const sourceHandle = clickedHandleId ?? null;

  // ── Actions ──────────────────────────────────────────────────────────

  function handleNewNode(direction) {
    // Calculate position offset based on direction
    const offsets = {
      down:      { x: 0,   y: 150 },
      downLeft:  { x: -80, y: 150 },
      downRight: { x: 80,  y: 150 },
    };
    const offset = offsets[direction] ?? offsets.down;

    const store = useDiagramStore.getState();
    const sm = (store.project?.stateMachines ?? []).find(s => s.id === smId);
    if (!sm) return;

    const fromNode = sm.nodes.find(n => n.id === nodeId);
    if (!fromNode) return;

    const srcW = fromNode.measured?.width ?? fromNode.width ?? 240;
    const newW = 240;

    const desired = {
      x: fromNode.position.x + (srcW - newW) / 2 + offset.x,
      y: fromNode.position.y + (fromNode.measured?.height ?? fromNode.height ?? 80) + offset.y,
    };

    // Nudge down if the spot overlaps an existing node
    const position = findClearPosition(desired, sm.nodes, newW, nodeId);


    store._pushHistory();
    const newNodeId = store.addNode(smId, { position });
    if (!newNodeId) return;

    // Build edge data — use the handle the user actually clicked
    let edgeCond = { conditionType: 'ready', label: 'Ready' };

    store.addEdge(
      smId,
      {
        source: nodeId,
        sourceHandle: sourceHandle,
        target: newNodeId,
        targetHandle: null,
      },
      edgeCond
    );

    store.setOpenPickerOnNode(newNodeId);
    useDiagramStore.setState({ _connectMenuNodeId: null, _connectMenuHandleId: null });
  }

  function handleLoop(direction, handleId) {
    useDiagramStore.setState({
      _connectPreset: {
        sourceNodeId: nodeId,
        sourceHandle: handleId,
        routeType: direction,
        smId,
      },
    });
  }

  function cancelConnect(e) {
    e.stopPropagation();
    useDiagramStore.setState({ _connectPreset: null, _connectMenuHandleId: null });
  }

  // ── Picking target mode ──────────────────────────────────────────────
  if (isPickingTarget) {
    return (
      <div
        className="connect-menu-popup"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -80,
          transform: 'translateX(-50%)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <span className="connect-menu__picking-label">Click target node</span>
        <button
          className="connect-menu__cancel"
          onClick={cancelConnect}
          onMouseDown={e => e.stopPropagation()}
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Normal mode — show direction options ──────────────────────────────
  return (
    <div
      className="connect-menu-popup"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: -80,
        transform: 'translateX(-50%)',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* New Node section — all SVG for consistent line weight */}
      <div className="connect-menu__section">
        <div className="connect-menu__section-label">New Node</div>
        <div className="connect-menu__row">
          <button
            className="connect-menu__btn"
            title="New node below-left"
            onClick={() => handleNewNode('downLeft')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="13" y1="5" x2="5" y2="13" />
              <polyline points="5,7 5,13 11,13" />
            </svg>
          </button>
          <button
            className="connect-menu__btn connect-menu__btn--primary"
            title="New node below"
            onClick={() => handleNewNode('down')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="3" x2="9" y2="15" />
              <polyline points="5,11 9,15 13,11" />
            </svg>
          </button>
          <button
            className="connect-menu__btn"
            title="New node below-right"
            onClick={() => handleNewNode('downRight')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="5" x2="13" y2="13" />
              <polyline points="7,13 13,13 13,7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Connect to existing node — pick direction, then click target */}
      <div className="connect-menu__section">
        <div className="connect-menu__section-label">Connect</div>
        <div className="connect-menu__row">
          {/* Down-left */}
          <button
            className="connect-menu__btn"
            title="Connect to node below-left"
            onClick={() => handleLoop('connectDownLeft', sourceHandle)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="13" y1="5" x2="5" y2="13" />
              <polyline points="5,7 5,13 11,13" />
            </svg>
          </button>
          {/* Straight down */}
          <button
            className="connect-menu__btn"
            title="Connect to node below"
            onClick={() => handleLoop('connectDown', sourceHandle)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="3" x2="9" y2="15" />
              <polyline points="5,11 9,15 13,11" />
            </svg>
          </button>
          {/* Down-right */}
          <button
            className="connect-menu__btn"
            title="Connect to node below-right"
            onClick={() => handleLoop('connectDownRight', sourceHandle)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="5" x2="13" y2="13" />
              <polyline points="7,13 13,13 13,7" />
            </svg>
          </button>
        </div>
        <div className="connect-menu__row">
          {/* Loop left (backward) */}
          <button
            className="connect-menu__btn"
            title="Loop back left"
            onClick={() => handleLoop('loopLeft', sourceHandle)}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="14,15 4,15 4,5 12,5" />
              <polyline points="10,7 12,5 10,3" />
            </svg>
          </button>
          {/* Loop right (backward) */}
          <button
            className="connect-menu__btn"
            title="Loop back right"
            onClick={() => handleLoop('loopRight', sourceHandle)}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6,15 16,15 16,5 8,5" />
              <polyline points="10,7 8,5 10,3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
