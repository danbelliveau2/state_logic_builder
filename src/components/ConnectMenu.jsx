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
      // SIDE HANDLES (exit-pass/exit-fail): delegate to auto-route.
      // Pre-computing waypoints with manualRoute:true was freezing the
      // routing in place — when the user dragged the source node, the stored
      // waypoints stayed at the old positions, producing parallel-to-edge
      // segments. Auto-route runs fresh on every render and respects the
      // perpendicular-out-of-side-handle rule.
      if (isSideHandle) {
        return { waypoints: [], manualRoute: false };
      }
      return { waypoints: [], manualRoute: false };
    }

    case 'connectDownLeft': {
      const midY = (src.y + tgt.y) / 2;
      if (isSideHandle) {
        return { waypoints: [], manualRoute: false };
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
        return { waypoints: [], manualRoute: false };
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
      }, 100);
    }

    function onLeave() {
      // Sticky popup: leaving the handle does NOT close the menu.
      // Once opened, it stays open until the user clicks an option or
      // clicks outside (handled at popup level via document mousedown).
      // Only abort the OPEN timer if we left before it fired.
      clearTimeout(_openTimer);
      _openTimer = null;
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
  const popupRef = useRef(null);

  // Sticky popup: once open, only close on explicit user action —
  //   - click an option (handled by individual onClick handlers)
  //   - click outside the popup AND outside any handle dot
  //   - Esc key
  // This removes the "popup closes while I'm reaching for an option"
  // problem that came from the auto-close-on-mouse-leave timer.
  useEffect(() => {
    if (!isVisible || isPickingTarget) return;
    const onDocMouseDown = (e) => {
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      // Don't close if clicking a handle dot (lets the user click another
      // handle to switch the open menu without an extra close-then-open).
      if (e.target?.closest?.('.react-flow__handle')) return;
      _cancelClose();
      useDiagramStore.setState({ _connectMenuNodeId: null, _connectMenuHandleId: null });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        useDiagramStore.setState({ _connectMenuNodeId: null, _connectMenuHandleId: null });
      }
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [isVisible, isPickingTarget]);

  if (!nodeId || !smId) return null;
  if (!isVisible) return null;

  const sourceHandle = clickedHandleId ?? null;

  // ── Actions ──────────────────────────────────────────────────────────

  function handleNewNode(direction) {
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

    // ── Decide position offset ────────────────────────────────────────────
    // Direct settings (Design tab → Branch Y / Branch X).
    // Alternate / retry land on the SAME ROW as the primary, X over.
    const isPassHandle  = sourceHandle === 'exit-pass';
    const isFailHandle  = sourceHandle === 'exit-fail';
    const isRetryHandle = sourceHandle === 'exit-retry';
    const v2BranchAction = (fromNode.data?.actions ?? [])
      .slice().reverse()
      .find(a => a?.pickerV2
        && a?.pickerConfig?.mode === 'decision'
        && a?.pickerConfig?.subAction === 'branch');
    const Y_OFF = Number(store.project?.designTheme?.branchYOffset ?? 200);
    const X_OFF = Number(store.project?.designTheme?.branchXOffset ?? 400);
    let offset;
    if (v2BranchAction) {
      if      (isPassHandle)  offset = { x: 0,        y: Y_OFF };
      else if (isFailHandle)  offset = { x: +X_OFF,   y: Y_OFF };
      else if (isRetryHandle) offset = { x: -X_OFF,   y: Y_OFF };
      else                    offset = { x: 0,        y: Y_OFF };
    } else if (isPassHandle) {
      // Legacy verify-mode source: pass handle is the LEFT side. Spawn left.
      offset = { x: -X_OFF, y: Y_OFF };
    } else if (isFailHandle) {
      offset = { x: +X_OFF, y: Y_OFF };
    } else {
      // Non-branch state with bottom handle — straight below at the same
      // distance branch primaries use (Branch Y setting).
      offset = { x: 0, y: Y_OFF };
    }

    const srcW = fromNode.measured?.width ?? fromNode.width ?? 240;
    const newW = 240;

    // Position is offset.x / offset.y added DIRECTLY to source's top-left.
    // Don't add nodeHeight — offset.y is the full distance to the child's
    // top, matching the Design-tab Branch Y setting (default 200).
    const desired = {
      x: fromNode.position.x + (srcW - newW) / 2 + offset.x,
      y: fromNode.position.y + offset.y,
    };

    const position = findClearPosition(desired, sourceNodes, newW, nodeId);

    // ── Decide edge data ──────────────────────────────────────────────────
    // For a branch-handle source on a state node with a v2 Branch action,
    // build proper decision-exit edge data so the new edge renders with
    // the correct color/label (matching the auto-spawn behavior). Falls
    // back to a plain "Ready" edge for non-branch sources.
    let edgeCond = { conditionType: 'ready', label: 'Ready' };
    if (v2BranchAction && (isPassHandle || isFailHandle || isRetryHandle)) {
      const labels = v2BranchAction.pickerConfig?.edgeLabels ?? [];
      const label = isPassHandle  ? (labels[0] ?? '')
                  : isFailHandle  ? (labels[1] ?? '')
                  : (labels[labels.length - 1] ?? 'Retry');
      edgeCond = {
        conditionType: 'custom',
        label,
        outcomeLabel: label,
        isDecisionExit: true,
        exitColor: isPassHandle  ? 'pass'
                 : isFailHandle  ? 'fail'
                 : 'retry',
      };
    }

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
        edgeCond
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
        edgeCond
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
      ref={popupRef}
      className="connect-menu-popup"
      style={POPUP_STYLE}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* New Node section — single Down option. Side-handle sources spawn
          at the configured (±X, +X) offset; bottom-handle straight below.
          User drags the node sideways after if they want offset. */}
      <div className="connect-menu__section">
        <div className="connect-menu__section-label">New Node</div>
        <div className="connect-menu__row">
          <button
            className="connect-menu__btn connect-menu__btn--primary"
            title="New node"
            onClick={() => handleNewNode('down')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="3" x2="9" y2="15" />
              <polyline points="5,11 9,15 13,11" />
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
