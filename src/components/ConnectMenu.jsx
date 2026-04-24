/**
 * ConnectMenu — Route direction picker, shown on handle hover.
 *
 * Two sections:
 *   NEW NODE (1 click — creates node + edge immediately):
 *     ↙  Down-Left   — new node below-left
 *     ↓  Down        — new node below, straight edge
 *     ↘  Down-Right  — new node below-right
 *
 *   CONNECT (click to activate, then click target node):
 *     ↓  Down        — connect forward (routing adapts to target position)
 *     ↰  Loop Left   — backward U-bend going left
 *     ↱  Loop Right  — backward U-bend going right
 *
 * Popup opens on hover over the handle dot, stays open while hovering the popup.
 * Closes automatically when mouse leaves both handle and popup (400ms delay).
 */

import { useRef, useEffect } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { NODE_WIDTH } from '../lib/edgeRouting.js';

// ── Shared hover timers (module-level, one menu open at a time) ───────────────

let _openTimer  = null;
let _closeTimer = null;

function _startCloseTimer() {
  clearTimeout(_closeTimer);
  _closeTimer = setTimeout(() => {
    _closeTimer = null;
    if (useDiagramStore.getState()._connectPreset) return;
    useDiagramStore.setState({ _connectMenuNodeId: null, _connectMenuHandleId: null });
  }, 400);
}

function _cancelClose() {
  clearTimeout(_closeTimer);
  _closeTimer = null;
}

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

    case 'connectDown': {
      if (isSideHandle) {
        return {
          waypoints: [
            { x: tgt.x, y: src.y },
          ],
          manualRoute: true,
        };
      }
      return { waypoints: [], manualRoute: false };
    }

    case 'connectDownLeft': {
      const midY = (src.y + tgt.y) / 2;
      if (isSideHandle) {
        return {
          waypoints: [
            { x: tgt.x, y: src.y },
          ],
          manualRoute: true,
        };
      }
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
        return {
          waypoints: [
            { x: tgt.x, y: src.y },
          ],
          manualRoute: true,
        };
      }
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

// ── Handle Hover Zone — detects hover on handles WITHOUT blocking drag ─────────

/**
 * Attaches mouseenter/mouseleave listeners directly to a handle DOM element.
 * - Hover (300 ms dwell) → opens ConnectMenu
 * - Mouse leaves handle → starts 400 ms close timer
 * - Mouse enters popup → cancels close timer (ConnectMenu calls _cancelClose)
 * - Drag → React Flow's native connection system works untouched
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

    function onEnter() {
      _cancelClose();
      clearTimeout(_openTimer);
      _openTimer = setTimeout(() => {
        _openTimer = null;
        useDiagramStore.setState({
          _connectMenuNodeId: nodeId,
          _connectMenuHandleId: handleId ?? null,
        });
      }, 120);
    }

    function onLeave() {
      clearTimeout(_openTimer);
      _openTimer = null;
      _startCloseTimer();
    }

    handle.addEventListener('mouseenter', onEnter);
    handle.addEventListener('mouseleave', onLeave);
    return () => {
      handle.removeEventListener('mouseenter', onEnter);
      handle.removeEventListener('mouseleave', onLeave);
    };
  }, [nodeId, handleSelector, handleId]);

  return <span ref={ref} style={{ display: 'none' }} />;
}

// ── Collision-free placement ─────────────────────────────────────────────────

function findClearPosition(desired, allNodes, newW, sourceNodeId) {
  const PAD  = 20;
  const newH = 100;

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

  for (let dy = 40; dy <= 800; dy += 40) {
    const c = { x: desired.x, y: desired.y + dy };
    if (!collides(c)) return c;
  }

  return desired;
}

// ── Popup positioning ─────────────────────────────────────────────────────────
// top: calc(100% + 8px) places popup 8px below the node's bottom edge.
const POPUP_STYLE = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: '50%',
  transform: 'translateX(-50%)',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectMenu({ nodeId, nodeType, exitCount, signalName, smId }) {
  const connectPreset = useDiagramStore(s => s._connectPreset);
  const showForNode   = useDiagramStore(s => s._connectMenuNodeId);
  const clickedHandleId = useDiagramStore(s => s._connectMenuHandleId);
  const isPickingTarget = connectPreset?.sourceNodeId === nodeId;
  const isVisible = showForNode === nodeId || isPickingTarget;

  if (!nodeId || !smId) return null;
  if (!isVisible) return null;

  const sourceHandle = clickedHandleId ?? null;

  // ── Actions ──────────────────────────────────────────────────────────

  function handleNewNode(direction) {
    const offsets = {
      down:      { x: 0,   y: 150 },
      downLeft:  { x: -80, y: 150 },
      downRight: { x: 80,  y: 150 },
    };
    const offset = offsets[direction] ?? offsets.down;

    const store = useDiagramStore.getState();
    const sm = (store.project?.stateMachines ?? []).find(s => s.id === smId);
    if (!sm) return;

    // Detect recovery-mode context: if the canvas is showing a recovery sequence,
    // lookups + mutations must target sm.recoverySeqs[*].nodes/edges, not sm.nodes.
    const recoverySeqId = store._activeRecoverySeqId ?? null;
    const activeSeq = recoverySeqId
      ? (sm.recoverySeqs ?? []).find(r => r.id === recoverySeqId)
      : null;
    const isRecovery = !!activeSeq;
    const sourceNodes = isRecovery ? activeSeq.nodes : sm.nodes;

    const fromNode = sourceNodes.find(n => n.id === nodeId);
    if (!fromNode) return;

    const srcW = fromNode.measured?.width ?? fromNode.width ?? 240;
    const newW = 240;

    const desired = {
      x: fromNode.position.x + (srcW - newW) / 2 + offset.x,
      y: fromNode.position.y + (fromNode.measured?.height ?? fromNode.height ?? 80) + offset.y,
    };

    const position = findClearPosition(desired, sourceNodes, newW, nodeId);

    store._pushHistory();
    let newNodeId;
    if (isRecovery) {
      newNodeId = store.addRecoveryNode(smId, recoverySeqId, { position });
      if (!newNodeId) return;
      store.addRecoveryEdge(
        smId,
        recoverySeqId,
        {
          source: nodeId,
          sourceHandle: sourceHandle,
          target: newNodeId,
          targetHandle: null,
        },
        { conditionType: 'ready', label: 'Ready' }
      );
    } else {
      newNodeId = store.addNode(smId, { position });
      if (!newNodeId) return;
      store.addEdge(
        smId,
        {
          source: nodeId,
          sourceHandle: sourceHandle,
          target: newNodeId,
          targetHandle: null,
        },
        { conditionType: 'ready', label: 'Ready' }
      );
    }

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
        style={POPUP_STYLE}
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
      style={POPUP_STYLE}
      onMouseEnter={_cancelClose}
      onMouseLeave={_startCloseTimer}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* New Node section */}
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

      {/* Connect to existing node — straight down, loop left, loop right */}
      <div className="connect-menu__section">
        <div className="connect-menu__section-label">Connect</div>
        <div className="connect-menu__row">
          {/* Straight down (routing adapts to any target position) */}
          <button
            className="connect-menu__btn"
            title="Connect to existing node"
            onClick={() => handleLoop('connectDown', sourceHandle)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="3" x2="9" y2="15" />
              <polyline points="5,11 9,15 13,11" />
            </svg>
          </button>
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
