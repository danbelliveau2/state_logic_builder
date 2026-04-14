/**
 * Canvas - React Flow diagram editor for state logic diagrams.
 * Features:
 *   - onConnectEnd: drag handle to empty canvas → create node + auto-connect
 *   - addNodeWithAutoConnect: shared helper for + button and sidebar drop
 *   - Ctrl+D (or Cmd+D): duplicate the currently selected node
 *   - Auto-generated verify conditions on edges via buildVerifyLabel
 */

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  useReactFlow,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { StateNode } from './nodes/StateNode.jsx';
import { DecisionNode } from './nodes/DecisionNode.jsx';
import { RoutableEdge } from './edges/RoutableEdge.jsx';
import { DrawingConnectionLine } from './edges/DrawingConnectionLine.jsx';
import { ManualDrawOverlay } from './edges/ManualDrawOverlay.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { buildVerifyLabel } from '../lib/conditionBuilder.js';
import { computeStateNumbers } from '../lib/computeStateNumbers.js';

const nodeTypes = { stateNode: StateNode, decisionNode: DecisionNode };
const edgeTypes = { routableEdge: RoutableEdge };

/** Build edge condition data from the source node's actions */
function getVerifyEdgeData(sm, sourceNodeId) {
  if (!sm) return { conditionType: 'ready', label: 'Ready' };
  const sourceNode = (sm.nodes ?? []).find(n => n.id === sourceNodeId);

  // Initial/Home node → Ready condition
  if (sourceNode?.data?.isInitial) {
    return { conditionType: 'ready', label: 'Ready' };
  }

  const devices = sm.devices ?? [];
  if (!sourceNode || (sourceNode.data?.actions ?? []).length === 0) {
    return { conditionType: 'ready', label: 'Ready' };
  }

  // CheckResults branching: auto-assign outcome to this edge
  const actions = sourceNode.data?.actions ?? [];
  const checkAction = actions.find(a => {
    const dev = devices.find(d => d.id === a.deviceId);
    return dev?.type === 'CheckResults';
  });
  if (checkAction) {
    const checkDevice = devices.find(d => d.id === checkAction.deviceId);
    const outcomes = checkDevice?.outcomes ?? [];

    // SINGLE CONDITION: linear verify (no branching)
    if (outcomes.length === 1) {
      const outcome = outcomes[0];
      const label = outcome.label || 'Verify';
      return {
        conditionType: 'verify',
        label,
        conditions: [{
          tag: outcome.label,
          state: outcome.condition === 'off' || outcome.condition === 'outOfRange' ? 'Off' : 'On',
          role: 'verify-input',
          deviceId: checkDevice.id,
          outcomeId: outcome.id,
          inputRef: outcome.inputRef,
          condition: outcome.condition,
        }],
      };
    }

    // 2+ OUTCOMES: branching — auto-assign next unused outcome
    const existingEdges = (sm.edges ?? []).filter(e => e.source === sourceNodeId);
    const usedOutcomeIds = new Set(
      existingEdges
        .filter(e => e.data?.conditionType === 'checkResult')
        .map(e => e.data?.outcomeId)
    );
    const nextOutcome = outcomes.find(o => !usedOutcomeIds.has(o.id));
    if (nextOutcome) {
      const outcomeIdx = outcomes.indexOf(nextOutcome);
      const edgeLabel = nextOutcome.label || `Branch ${outcomeIdx + 1}`;
      return {
        conditionType: 'checkResult',
        deviceId:      checkDevice.id,
        outcomeId:     nextOutcome.id,
        outcomeLabel:  edgeLabel,
        outcomeIndex:  outcomeIdx,
        label:         edgeLabel,
        inputRef:      nextOutcome.inputRef,
        condition:     nextOutcome.condition,
        paramDeviceId: nextOutcome.paramDeviceId,
        paramScope:    nextOutcome.paramScope,
        crossSmId:     nextOutcome.crossSmId,
      };
    }
    return { conditionType: 'ready', label: 'Ready' };
  }

  // VisionInspect branching: auto-assign outcome to this edge
  const visionAction = actions.find(a => {
    const dev = devices.find(d => d.id === a.deviceId);
    return dev?.type === 'VisionSystem' && (a.operation === 'VisionInspect' || a.operation === 'Inspect') && a.outcomes?.length >= 2;
  });
  if (visionAction) {
    const outcomes = visionAction.outcomes;
    const existingEdges = (sm.edges ?? []).filter(e => e.source === sourceNodeId);
    const usedOutcomeIds = new Set(
      existingEdges
        .filter(e => e.data?.conditionType === 'visionResult')
        .map(e => e.data?.outcomeId)
    );
    const nextOutcome = outcomes.find(o => !usedOutcomeIds.has(o.id));
    if (nextOutcome) {
      const outcomeIdx = outcomes.indexOf(nextOutcome);
      const edgeLabel = nextOutcome.label || `Branch ${outcomeIdx + 1}`;
      return {
        conditionType: 'visionResult',
        outcomeId: nextOutcome.id,
        outcomeLabel: edgeLabel,
        outcomeIndex: outcomeIdx,
        label: edgeLabel,
      };
    }
    return { conditionType: 'ready', label: 'Ready' };
  }

  const { label, conditions } = buildVerifyLabel(sourceNode, devices);
  if (!label) return { conditionType: 'ready', label: 'Ready' };
  return { conditionType: 'verify', label, conditions };
}

// Viewport storage per SM (persists across tab lifetime, not in localStorage)
const smViewports = {};

export function Canvas() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition, setCenter, getViewport, setViewport, fitView, getNodes } = useReactFlow();
  const [selectMode, setSelectMode] = useState(false);
  const prevSmIdRef = useRef(null);

  // ── Straighten selected nodes (align centers to median center X) ────────────
  const straightenSelected = useCallback(() => {
    if (!sm) return;
    const selected = getNodes().filter(n => n.selected);
    if (selected.length < 2) return;
    // Compute center X for each node, find the median
    const centers = selected.map(n => {
      const w = n.measured?.width ?? n.width ?? 240;
      return { id: n.id, centerX: n.position.x + w / 2, width: w, y: n.position.y };
    });
    const sorted = [...centers].sort((a, b) => a.centerX - b.centerX);
    const medianCenterX = sorted[Math.floor(sorted.length / 2)].centerX;
    store._pushHistory();
    const changes = centers
      .filter(c => Math.abs(c.centerX - medianCenterX) > 0.5)
      .map(c => ({
        id: c.id,
        type: 'position',
        position: { x: medianCenterX - c.width / 2, y: c.y },
      }));
    if (changes.length > 0) store.onNodesChange(sm.id, changes);
  }, [sm, store, getNodes]);

  // ── Viewport persistence per SM ──────────────────────────────────────────
  // Save viewport when switching away from an SM, restore when switching to one
  useEffect(() => {
    const currentSmId = sm?.id;
    const prevSmId = prevSmIdRef.current;

    // Save previous SM's viewport before switching
    if (prevSmId && prevSmId !== currentSmId) {
      try { smViewports[prevSmId] = getViewport(); } catch (_) { /* not mounted yet */ }
    }

    // Always fitView when switching to a new SM — show the whole sequence
    if (currentSmId && currentSmId !== prevSmId) {
      setTimeout(() => fitView({ padding: 0.2, duration: 250, maxZoom: 1 }), 50);
    }

    prevSmIdRef.current = currentSmId;
  }, [sm?.id]);

  // Save viewport on every pan/zoom change
  const onMoveEnd = useCallback((_event, viewport) => {
    if (sm?.id) {
      smViewports[sm.id] = viewport;
    }
  }, [sm?.id]);

  // ── Ref for finalizeManualDraw (assigned after definition below) ──────────
  const finalizeDrawRef = useRef(null);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      // Enter: finalize manual draw mode
      if (e.key === 'Enter') {
        const { _isDrawingConnection, _drawingSource } = useDiagramStore.getState();
        if (_isDrawingConnection && _drawingSource && finalizeDrawRef.current) {
          e.preventDefault();
          finalizeDrawRef.current();
          return;
        }
      }
      // Escape: cancel manual draw mode
      if (e.key === 'Escape') {
        const { _isDrawingConnection, _drawingSource } = useDiagramStore.getState();
        if (_isDrawingConnection && _drawingSource) {
          e.preventDefault();
          useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+D: duplicate selected node
      if (mod && e.key === 'd') {
        e.preventDefault();
        const { activeSmId, selectedNodeId } = useDiagramStore.getState();
        if (activeSmId && selectedNodeId) {
          useDiagramStore.getState().duplicateNode(activeSmId, selectedNodeId);
        }
      }
      // Ctrl+Z: undo
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useDiagramStore.getState().undo();
      }
      // Ctrl+Y or Ctrl+Shift+Z: redo
      if (mod && (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useDiagramStore.getState().redo();
      }
      // Delete / Backspace: delete selected node or edge
      // Skip if focus is inside an input/textarea/contenteditable (user is typing)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement?.tagName;
        const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
        if (!isEditing) {
          const { activeSmId, selectedNodeId, selectedEdgeId } = useDiagramStore.getState();
          if (activeSmId && selectedNodeId) {
            useDiagramStore.getState().deleteNode(activeSmId, selectedNodeId);
          } else if (activeSmId && selectedEdgeId) {
            useDiagramStore.getState().deleteEdge(activeSmId, selectedEdgeId);
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Capture pre-drag snapshot for undo ────────────────────────────────────
  const onNodeDragStart = useCallback(() => {
    useDiagramStore.getState()._pushHistory();
  }, []);

  // ── Snap-to-vertical on drag stop ──────────────────────────────────────────
  // When a node is dropped within 25px of a connected node's X, snap it to align
  const onNodeDragStop = useCallback((event, node) => {
    const currentSm = useDiagramStore.getState().getActiveSm();
    if (!currentSm) return;

    const SNAP_THRESHOLD = 50; // px in flow coordinates — strong snap keeps nodes in column

    // Find connected nodes (parent + child via edges)
    const connectedNodeIds = new Set();
    for (const e of (currentSm.edges ?? [])) {
      if (e.source === node.id) connectedNodeIds.add(e.target);
      if (e.target === node.id) connectedNodeIds.add(e.source);
    }

    // Snap to closest connected node's center X if within threshold
    // Use measured width to compute center, since nodes can have different widths
    const nodeW = node.measured?.width ?? node.width ?? 240;
    const nodeCenterX = node.position.x + nodeW / 2;

    let snapCenterX = null;
    let minDist = SNAP_THRESHOLD;
    for (const nId of connectedNodeIds) {
      const connected = (currentSm.nodes ?? []).find(n => n.id === nId);
      if (!connected) continue;
      const connW = connected.measured?.width ?? connected.width ?? 240;
      const connCenterX = connected.position.x + connW / 2;
      const dist = Math.abs(nodeCenterX - connCenterX);
      if (dist < minDist) {
        minDist = dist;
        snapCenterX = connCenterX;
      }
    }

    if (snapCenterX !== null) {
      const newX = snapCenterX - nodeW / 2;
      if (Math.abs(newX - node.position.x) > 0.5) {
        useDiagramStore.getState().onNodesChange(currentSm.id, [{
          type: 'position',
          id: node.id,
          position: { x: newX, y: node.position.y },
        }]);
      }
    }
  }, []);

  // ── Invert scroll-zoom so it matches other apps (scroll up = zoom in) ─────
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    let isSynthetic = false;
    function handleWheel(e) {
      if (isSynthetic) return;           // let our synthetic event pass through
      if (e.ctrlKey || e.metaKey) return; // don't touch pinch-zoom
      e.stopPropagation();
      e.preventDefault();
      // Dispatch a new wheel event with inverted deltaY to the original target
      isSynthetic = true;
      e.target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: -e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      }));
      isSynthetic = false;
    }
    el.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', handleWheel, { capture: true });
  }, []);

  // ── Shared helper: add a node and auto-connect from previously selected ───
  const addNodeWithAutoConnect = useCallback((opts = {}) => {
    if (!sm) return null;

    const prevSelectedId = useDiagramStore.getState().selectedNodeId;
    const smNodes = sm.nodes ?? [];

    // Determine which node we'll connect from
    const connectFromId =
      prevSelectedId ??
      (smNodes.length > 0 ? smNodes[smNodes.length - 1].id : null);

    // Default position: straight below source node (center-aligned); branch → offset right
    if (!opts.position && connectFromId) {
      const sourceNode = smNodes.find(n => n.id === connectFromId);
      if (sourceNode) {
        const existingOutEdges = (sm.edges ?? []).filter(e => e.source === connectFromId);
        // Center-align: compute source center, then offset new node so its center matches
        const srcW = sourceNode.measured?.width ?? sourceNode.width ?? 240;
        const newW = 240; // default new node width before render
        const centerAlignedX = sourceNode.position.x + (srcW - newW) / 2;
        if (existingOutEdges.length > 0) {
          // Branch: offset to the right
          opts = { ...opts, position: {
            x: sourceNode.position.x + 300,
            y: sourceNode.position.y + 200,
          }};
        } else {
          // Straight below source — center-aligned
          opts = { ...opts, position: {
            x: centerAlignedX,
            y: sourceNode.position.y + 200,
          }};
        }
      }
    }

    const newNodeId = store.addNode(sm.id, opts);
    if (!newNodeId) return null;

    // Auto-connect from source node
    if (connectFromId && connectFromId !== newNodeId) {
      const edgeCond = getVerifyEdgeData(sm, connectFromId);
      store.addEdge(
        sm.id,
        { source: connectFromId, sourceHandle: null, target: newNodeId, targetHandle: null },
        edgeCond
      );
    }

    // Signal the new node to auto-open its inline action picker
    store.setOpenPickerOnNode(newNodeId);

    // Scroll viewport to show the new node
    const finalOpts = opts;
    if (finalOpts.position) {
      setTimeout(() => {
        setCenter(finalOpts.position.x + 120, finalOpts.position.y + 40, { zoom: getViewport().zoom, duration: 300 });
      }, 50);
    }

    return newNodeId;
  }, [sm, store, setCenter, getViewport]);

  // ── Node / Edge change handlers ────────────────────────────────────────────
  const onNodesChange = useCallback((changes) => {
    if (!sm) return;
    store.onNodesChange(sm.id, changes);
  }, [sm, store]);

  const onEdgesChange = useCallback((changes) => {
    if (!sm) return;
    store.onEdgesChange(sm.id, changes);
  }, [sm, store]);

  // ── Connection handlers ────────────────────────────────────────────────────

  /** Enter drawing mode when a connection drag begins */
  const onConnectStart = useCallback(() => {
    useDiagramStore.setState({ _isDrawingConnection: true, _drawingWaypoints: [] });
  }, []);

  // Build decision/vision-exit edge data when dragging from a decision/vision node's pass/fail/single handle
  const getDecisionExitData = useCallback((sourceNodeId, sourceHandle) => {
    if (!sm || !sourceHandle) return null;
    const sourceNode = sm.nodes.find(n => n.id === sourceNodeId);
    if (!sourceNode) return null;

    // Only handle exit handles from decisionNode or stateNode with vision exits
    const isDecision = sourceNode.type === 'decisionNode';
    const isVisionExit = sourceNode.type === 'stateNode' && sourceNode.data?.visionExitMode;
    if (!isDecision && !isVisionExit) return null;

    const handle = sourceHandle;

    // Single-exit: green pass styling for decision nodes, plain for vision
    if (handle === 'exit-single') {
      if (isDecision) {
        const sigName = sourceNode.data?.signalName ?? '';
        return {
          conditionType: 'ready',
          label: sourceNode.data?.exit1Label || `Ready`,
          outcomeLabel: sourceNode.data?.exit1Label || `Ready`,
          isDecisionExit: true,
          exitColor: 'pass',
        };
      }
      return { conditionType: isVisionExit ? 'visionResult' : 'ready' };
    }

    // Retry exit: amber colored with "Retry_Fail" label
    if (handle === 'exit-retry') {
      const sigName = sourceNode.data?.signalName ?? '';
      const label = `Retry_Fail_${sigName}`;
      return {
        conditionType: 'ready',
        label,
        outcomeLabel: label,
        isDecisionExit: true,
        exitColor: 'retry',
      };
    }

    // Pass / Fail exits: colored with label
    if (handle !== 'exit-pass' && handle !== 'exit-fail') return null;
    const isPass = handle === 'exit-pass';

    if (isVisionExit) {
      // Vision node: use job name from VisionInspect action
      const visionAction = (sourceNode.data?.actions ?? []).find(a => a.operation === 'VisionInspect' || a.operation === 'Inspect');
      const jobName = visionAction?.jobName ?? '';
      const label = isPass ? `Pass_${jobName}` : `Fail_${jobName}`;
      return {
        conditionType: 'visionResult',
        label,
        outcomeLabel: label,
        isDecisionExit: true,
        exitColor: isPass ? 'pass' : 'fail',
      };
    }

    // Decision node
    const sigName = sourceNode.data?.signalName ?? '';
    const label = isPass ? `Pass_${sigName}` : `Fail_${sigName}`;
    return {
      conditionType: 'ready',
      label,
      outcomeLabel: label,
      isDecisionExit: true,
      exitColor: isPass ? 'pass' : 'fail',
    };
  }, [sm]);

  const onConnect = useCallback((connection) => {
    if (!sm) return;
    // Grab any waypoints placed during the click-to-draw connection
    const drawingWps = useDiagramStore.getState()._drawingWaypoints;
    // Check if this is a decision exit edge — if so, use decision styling instead of verify data
    const decExitData = getDecisionExitData(connection.source, connection.sourceHandle);
    const edgeCond = decExitData ?? getVerifyEdgeData(sm, connection.source);
    // Merge drawing waypoints into the edge data — mark as manual route so they persist
    if (drawingWps && drawingWps.length > 0) {
      edgeCond.waypoints = drawingWps;
      edgeCond.manualRoute = true;
    }
    const edgeId = store.addEdge(sm.id, connection, edgeCond);
    // Don't open transition modal for decision exit edges — they're auto-configured
    if (!decExitData) {
      store.setSelectedEdge(edgeId);
      store.openTransitionModal(edgeId);
    }
    // Clear drawing state
    useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
  }, [sm, store, getDecisionExitData]);

  /**
   * Drag a source handle to empty canvas space → create new node + auto-connect.
   * Also clears click-to-draw state.
   */
  /**
   * onConnectEnd — when the user releases a handle drag on empty canvas,
   * enter "manual draw mode" instead of immediately creating a node.
   * The user can then click multiple times to add ortho-snapped waypoints.
   * Press Enter to finalize (creates a node at the endpoint), or
   * click on an existing node to connect to it. Escape cancels.
   */
  const onConnectEnd = useCallback((event, connectionState) => {
    const drawingWps = useDiagramStore.getState()._drawingWaypoints;

    // If it connected to a node normally, clear drawing state and we're done
    if (connectionState.toNode) {
      useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
      return;
    }
    if (!sm) {
      useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
      return;
    }

    const fromNode = connectionState.fromNode;
    if (!fromNode) {
      useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
      return;
    }

    const fromHandle = connectionState.fromHandle?.id ?? null;
    const cursorFlow = screenToFlowPosition({
      x: event.clientX ?? event.touches?.[0]?.clientX ?? 0,
      y: event.clientY ?? event.touches?.[0]?.clientY ?? 0,
    });

    // ── Shift held OR Draw Path toggle active → enter manual draw mode ────
    const drawPathModeActive = useDiagramStore.getState()._drawPathMode;
    if (event.shiftKey || drawPathModeActive) {
      const firstWp = { x: cursorFlow.x, y: cursorFlow.y };
      useDiagramStore.setState({
        _isDrawingConnection: true,
        _drawingSource: { nodeId: fromNode.id, handleId: fromHandle },
        _drawingWaypoints: [firstWp],
      });
      return;
    }

    // ── Normal mode: create a new node and connect immediately ────────────
    useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });

    const existingOutEdges = (sm.edges ?? []).filter(e => e.source === fromNode.id);
    // Center-align new node on source when dropping straight down
    const srcW = fromNode.measured?.width ?? fromNode.width ?? 240;
    const newW = 240;
    const centerAlignedX = fromNode.position.x + (srcW - newW) / 2;
    const position = {
      x: existingOutEdges.length > 0 ? cursorFlow.x : centerAlignedX,
      y: cursorFlow.y,
    };

    const newNodeId = store.addNode(sm.id, { position });
    if (!newNodeId) return;

    const decExitData = getDecisionExitData(fromNode.id, fromHandle);
    const edgeCond = decExitData ?? getVerifyEdgeData(sm, fromNode.id);
    if (drawingWps && drawingWps.length > 0) {
      edgeCond.waypoints = drawingWps;
      edgeCond.manualRoute = true;
    }
    store.addEdge(
      sm.id,
      {
        source: fromNode.id,
        sourceHandle: fromHandle,
        target: newNodeId,
        targetHandle: null,
      },
      edgeCond
    );

    store.setOpenPickerOnNode(newNodeId);
  }, [sm, store, screenToFlowPosition, getDecisionExitData]);

  /**
   * Finalize manual draw: create edge (and optionally a new target node).
   * Called when user presses Enter or clicks a node during draw mode.
   */
  const finalizeManualDraw = useCallback((targetNodeId = null) => {
    const { _drawingSource, _drawingWaypoints } = useDiagramStore.getState();
    if (!_drawingSource || !sm) {
      useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
      return;
    }

    const fromNodeId = _drawingSource.nodeId;
    const fromHandle = _drawingSource.handleId;
    const wps = _drawingWaypoints ?? [];

    let actualTarget = targetNodeId;

    // If no target node specified, create a new node at the last waypoint position
    if (!actualTarget && wps.length > 0) {
      const lastWp = wps[wps.length - 1];
      const fromNode = sm.nodes.find(n => n.id === fromNodeId);
      const existingOutEdges = (sm.edges ?? []).filter(e => e.source === fromNodeId);
      const position = {
        x: existingOutEdges.length > 0 ? lastWp.x : (fromNode?.position?.x ?? lastWp.x),
        y: lastWp.y,
      };
      actualTarget = store.addNode(sm.id, { position });
      if (!actualTarget) {
        useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
        return;
      }
      store.setOpenPickerOnNode(actualTarget);
    } else if (!actualTarget) {
      // No waypoints and no target — just cancel
      useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
      return;
    }

    // Build edge data
    const decExitData = getDecisionExitData(fromNodeId, fromHandle);
    const edgeCond = decExitData ?? getVerifyEdgeData(sm, fromNodeId);

    // Include waypoints as manual route
    if (wps.length > 0) {
      edgeCond.waypoints = wps;
      edgeCond.manualRoute = true;
    }

    const edgeId = store.addEdge(
      sm.id,
      {
        source: fromNodeId,
        sourceHandle: fromHandle,
        target: actualTarget,
        targetHandle: null,
      },
      edgeCond
    );

    // Open transition modal for non-decision edges
    if (!decExitData && edgeId) {
      store.setSelectedEdge(edgeId);
      store.openTransitionModal(edgeId);
    }

    // Clear drawing state
    useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
  }, [sm, store, getDecisionExitData]);

  // Assign ref so keyboard handler can call finalizeManualDraw
  finalizeDrawRef.current = finalizeManualDraw;

  // ── Click handlers ────────────────────────────────────────────────────────
  const onNodeClick = useCallback((event, node) => {
    // If we're in manual draw mode, clicking a node completes the connection to it
    const isDrawing = useDiagramStore.getState()._isDrawingConnection;
    const drawSource = useDiagramStore.getState()._drawingSource;
    if (isDrawing && drawSource) {
      // Don't connect to the source node itself
      if (node.id !== drawSource.nodeId) {
        finalizeManualDraw(node.id);
        return;
      }
    }
    store.setSelectedNode(node.id);
  }, [store, finalizeManualDraw]);

  const onEdgeClick = useCallback((event, edge) => {
    store.setSelectedEdge(edge.id);
  }, [store]);

  const onEdgeDoubleClick = useCallback((event, edge) => {
    store.setSelectedEdge(edge.id);
    store.openTransitionModal(edge.id);
  }, [store]);

  const onPaneClick = useCallback((event) => {
    // If we're in drawing-connection mode (handle drag), add an ortho-snapped waypoint
    const isDrawing = useDiagramStore.getState()._isDrawingConnection;
    if (isDrawing) {
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      useDiagramStore.setState(s => {
        const prev = s._drawingWaypoints;
        // Snap to orthogonal: alternate V/H from the last waypoint (or source)
        // Even-index clicks (0, 2, 4…) snap to vertical (keep prev X, use click Y)
        // Odd-index clicks (1, 3, 5…) snap to horizontal (use click X, keep prev Y)
        // But first click just records raw position as the first corner
        if (prev.length === 0) {
          return { _drawingWaypoints: [{ x: flowPos.x, y: flowPos.y }] };
        }
        const last = prev[prev.length - 1];
        // Determine orientation: if the dominant movement is horizontal, snap to horizontal first
        const dx = Math.abs(flowPos.x - last.x);
        const dy = Math.abs(flowPos.y - last.y);
        if (dx > dy) {
          // Horizontal move → add corner at (clickX, lastY)
          return { _drawingWaypoints: [...prev, { x: flowPos.x, y: last.y }] };
        } else {
          // Vertical move → add corner at (lastX, clickY)
          return { _drawingWaypoints: [...prev, { x: last.x, y: flowPos.y }] };
        }
      });
      return; // Don't clear selection while drawing
    }
    store.clearSelection();
    useDiagramStore.setState(s => ({ _closePickerSignal: s._closePickerSignal + 1 }));
  }, [store, screenToFlowPosition]);

  // ── Drag-from-sidebar drop ────────────────────────────────────────────────
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    if (!sm) return;

    const label = event.dataTransfer.getData('application/state-node-label');
    if (!label && event.dataTransfer.getData('application/state-node') !== 'true') return;

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNodeWithAutoConnect({ position, ...(label ? { label } : {}) });
  }, [sm, addNodeWithAutoConnect, screenToFlowPosition]);

  // Compute state numbers and inject into node data
  // (hooks must always run — React forbids hooks after an early return)
  const devices = sm?.devices ?? [];
  const smEdges = sm?.edges ?? [];
  const smNodes = sm?.nodes ?? [];
  const { stateMap: stateNumberMap, visionSubStepsMap } = useMemo(
    () => sm ? computeStateNumbers(smNodes, smEdges, devices) : { stateMap: new Map(), visionSubStepsMap: new Map() },
    [sm, smNodes, smEdges, devices]
  );

  const nodes = useMemo(() => {
    if (!sm) return [];
    return smNodes.map(n => {
      // DecisionNode: inject stateNumber (same sequence as state nodes)
      if (n.type === 'decisionNode') {
        return {
          ...n,
          data: {
            ...n.data,
            stateNumber: stateNumberMap.get(n.id) ?? 0,
          },
        };
      }

      const visionSubSteps = visionSubStepsMap.get(n.id);
      // Inject visionSubSteps into each Inspect action for rendering
      let actions = n.data?.actions;
      if (visionSubSteps && actions) {
        actions = actions.map(a => {
          const dev = devices.find(d => d.id === a.deviceId);
          if (dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect')) {
            return { ...a, visionSubSteps };
          }
          return a;
        });
      }
      return {
        ...n,
        data: {
          ...n.data,
          stateNumber: stateNumberMap.get(n.id) ?? 0,
          ...(actions !== n.data?.actions ? { actions } : {}),
        },
      };
    });
  }, [sm, smNodes, stateNumberMap, visionSubStepsMap, devices]);

  // Always use RoutableEdge; show labels only on branch edges (vision/check results).
  // Edges sourced from OR targeting a decisionNode use 'straight' type for natural routing.
  const edges = useMemo(() => {
    if (!sm) return [];
    // Build a fast lookup map for nodes by id
    const nodesById = {};
    for (const n of smNodes) nodesById[n.id] = n;

    return smEdges.map(e => {
      const isBranch = e.data?.conditionType === 'visionResult' || e.data?.conditionType === 'checkResult';
      const sourceNode = nodesById[e.source];
      const targetNode = nodesById[e.target];
      // Ensure edges going TO a decision node always target the 'input' handle
      let targetHandle = e.targetHandle;
      if (targetNode?.type === 'decisionNode' && !targetHandle) {
        targetHandle = 'input';
      }

      // Decision exit edges (pass/fail): colored label — exit-single is plain gray
      const isDecisionExit = e.data?.isDecisionExit === true && e.sourceHandle !== 'exit-single';
      if (isDecisionExit) {
        const isPass = e.data?.exitColor === 'pass';
        // Only force targetHandle='input' if targeting a decisionNode; stateNodes use default (null)
        const decTargetHandle = targetNode?.type === 'decisionNode' ? 'input' : (e.targetHandle ?? null);
        const color = isPass ? '#16a34a' : '#dc2626';
        return {
          ...e,
          targetHandle: decTargetHandle,
          type: 'routableEdge',
          label: e.sourceHandle === 'exit-single' ? '' : (e.data?.outcomeLabel ?? ''),
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: color, rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          style: { stroke: color, strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color },
        };
      }

      // All other edges (including loop-backs TO decision nodes) use routableEdge
      return {
        ...e,
        targetHandle,
        type: 'routableEdge',
        label: isBranch ? (e.data?.outcomeLabel ?? e.data?.label ?? '') : '',
      };
    });
  }, [sm, smEdges, smNodes]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!sm) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty__content">
          <div className="canvas-empty__icon">&#x26A1;</div>
          <h2>No State Machine Selected</h2>
          <p>Create a new state machine to begin building your sequence logic.</p>
          <button className="btn btn--primary btn--lg" onClick={store.openNewSmModal}>
            + New State Machine
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-wrapper" ref={reactFlowWrapper}>
      {/* SM title header on canvas */}
      {sm && (
        <div className="canvas-sm-title">
          <span className="canvas-sm-title__number">S{String(sm.stationNumber ?? 0).padStart(2, '0')}</span>
          <span className="canvas-sm-title__name">{sm.name || 'Untitled'}</span>
        </div>
      )}
      <ManualDrawOverlay />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        connectOnClick={false}
        connectionLineComponent={DrawingConnectionLine}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onMoveEnd={onMoveEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.05}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        defaultEdgeOptions={{
          type: 'routableEdge',
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
        }}
        deleteKeyCode={null}
        selectionOnDrag={selectMode}
        selectionMode={SelectionMode.Partial}
        panOnDrag={selectMode ? [1, 2] : true}
        proOptions={{ hideAttribution: true }}
      >
        {/* No grid — machine image background on wrapper is the only bg */}
        <Controls position="top-right" style={{ top: 50, right: 10 }} showInteractive={false} />
        <MiniMap
          style={{ bottom: 16, right: 16 }}
          nodeColor={(n) => {
            if (n.type === 'decisionNode') return n.data?.decisionType === 'vision' ? '#f59e0b' : '#0072B5';
            return n.data?.isInitial ? '#5a9a48' : '#4a89b8';
          }}
          maskColor="rgba(255,255,255,0.7)"
        />

        {/* Missing Home Node banner */}
        {sm && (sm.nodes ?? []).length > 0 && !(sm.nodes ?? []).some(n => n.data?.isInitial) && (
          <div className="canvas-missing-home">
            <span>⚠ No Home node</span>
            <button className="btn btn--sm btn--primary" onClick={() => store.addHomeNode(sm.id)}>
              + Add Home Node
            </button>
          </div>
        )}

        {/* Floating buttons — add state + renumber + draw path */}
        <div className="canvas-add-btn">
          <div className="canvas-tool">
            <button
              className="btn btn--circle btn--primary"
              onClick={() => addNodeWithAutoConnect()}
              title="Add new state step (Ctrl+D duplicates selected)"
            >
              +
            </button>
            <span className="canvas-tool__label">Add State</span>
          </div>
          <div className="canvas-tool">
            <button
              className="btn btn--circle btn--ghost canvas-renumber-btn"
              onClick={() => {
                if (sm) store.onNodesChange(sm.id, []);
              }}
              title="Renumber states (follows edge connections)"
            >
              #
            </button>
            <span className="canvas-tool__label">Renumber</span>
          </div>
          <div className="canvas-tool">
            <DrawPathToggle />
            <span className="canvas-tool__label">Draw Path</span>
          </div>
        </div>

        {/* Bottom toolbar — Select + Straighten */}
        <div className="canvas-select-toggle">
          <button
            className={`btn btn--sm canvas-select-btn${selectMode ? ' canvas-select-btn--active' : ''}`}
            onClick={() => setSelectMode(m => !m)}
            title={selectMode ? 'Selection mode ON — drag to select nodes. Click to exit.' : 'Click to enter selection mode (drag to select multiple nodes)'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="14" height="14" strokeDasharray="3 2" rx="1" />
              <path d="M11 7L13 14L10.5 11.5L8 14L6 7" fill="currentColor" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span>{selectMode ? 'Select ON' : 'Select'}</span>
          </button>
          <button
            className="btn btn--sm canvas-select-btn"
            onClick={straightenSelected}
            title="Align selected nodes vertically (same X position)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="1" x2="8" y2="15" />
              <polyline points="4,5 8,1 12,5" />
              <polyline points="4,11 8,15 12,11" />
              <circle cx="4" cy="8" r="1.5" fill="currentColor" />
              <circle cx="12" cy="8" r="1.5" fill="currentColor" />
            </svg>
            <span>Straighten</span>
          </button>
        </div>
      </ReactFlow>
      {/* Machine watermark — sits on top of React Flow pane, pointer-events: none so you can still click through */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'url(/bg-machine.jpg)',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center center',
        backgroundSize: 'cover',
        opacity: 0.25,
        pointerEvents: 'none',
        zIndex: 1,
      }} />
    </div>
  );
}

// ── Draw Path toggle button (floating on canvas) ───────────────────────────
function DrawPathToggle() {
  const active = useDiagramStore(s => s._drawPathMode);
  const toggle = () => useDiagramStore.setState(s => ({ _drawPathMode: !s._drawPathMode }));
  return (
    <button
      className={`btn btn--circle ${active ? 'btn--primary' : 'btn--ghost'}`}
      onClick={toggle}
      title={active
        ? 'Draw Path mode ON — drag off a node handle, click to place waypoints, click a target node to finish. Click again to exit.'
        : 'Draw Path: drag off a handle then click waypoints to manually route a connection (same as holding Shift).'}
      style={{ fontSize: 14 }}
    >
      {'\u270E'}
    </button>
  );
}
