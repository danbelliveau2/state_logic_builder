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
import { saveStandard } from '../lib/standardsLibrary.js';
import { computeStateNumbers } from '../lib/computeStateNumbers.js';
import { computeExitLabels, computeSegmentAxes, computeAutoRoute } from '../lib/edgeRouting.js';
import { OUTCOME_COLORS } from '../lib/outcomeColors.js';
import { computePresetWaypoints } from './ConnectMenu.jsx';

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

/**
 * Compute the position of a source handle for axis-preservation math.
 * Mirrors the layout of StateNode's / DecisionNode's handles.
 */
function getSourceHandlePos(fromNode, handleId) {
  const nodeW = fromNode.measured?.width  ?? fromNode.width  ?? 240;
  const nodeH = fromNode.measured?.height ?? fromNode.height ?? 80;
  let x = fromNode.position.x + nodeW / 2;
  let y = fromNode.position.y + nodeH;
  if (handleId === 'exit-pass') {
    x = fromNode.position.x;
    y = fromNode.position.y + nodeH / 2;
  } else if (handleId === 'exit-fail') {
    x = fromNode.position.x + nodeW;
    y = fromNode.position.y + nodeH / 2;
  } else if (handleId === 'exit-retry') {
    x = fromNode.position.x + nodeW / 2;
    y = fromNode.position.y + nodeH;
  }
  return { x, y };
}

// computeSegmentAxes imported from edgeRouting.js
// Local call sites resolve handle positions via getSourceHandlePos() first.

export function Canvas() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition, setCenter, getViewport, setViewport, fitView, getNodes } = useReactFlow();
  const [selectMode, setSelectMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [activeRecoverySeqId, setActiveRecoverySeqId] = useState(null);
  const [starFormOpen, setStarFormOpen] = useState(false);
  const [starName, setStarName] = useState('');
  const [starDesc, setStarDesc] = useState('');
  const [starCategory, setStarCategory] = useState('');
  // Computed early so callbacks below can reference without TDZ
  const activeRecoverySeq = recoveryMode
    ? (sm?.recoverySeqs ?? []).find(r => r.id === activeRecoverySeqId) ?? (sm?.recoverySeqs ?? [])[0] ?? null
    : null;
  const activeSeqId = activeRecoverySeq?.id ?? null;
  const prevSmIdRef = useRef(null);
  // Timestamp of the most recent onConnectEnd — used to suppress the pane-click
  // that React Flow fires on the SAME mouseup as the drag-release. Without this
  // guard, a single drag-release produces two waypoints (one at the corner from
  // onConnectEnd, one at the click position from onPaneClick).
  const lastConnectEndAt = useRef(0);

  // ── Straighten selected nodes (align centers to median center X) ─────────────
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

    // Reset recovery mode when switching SMs
    if (currentSmId && currentSmId !== prevSmId) {
      setRecoveryMode(false);
      setActiveRecoverySeqId(null);
      useDiagramStore.setState({ _activeRecoverySeqId: null });
    }

    prevSmIdRef.current = currentSmId;
  }, [sm?.id]);

  // Sync recovery seq ID into store so RoutableEdge's updateEdgeWaypoints routes correctly
  useEffect(() => {
    useDiagramStore.setState({ _activeRecoverySeqId: recoveryMode ? activeRecoverySeqId : null });
  }, [recoveryMode, activeRecoverySeqId]);

  // Auto-select first recovery seq when entering recovery mode
  useEffect(() => {
    if (recoveryMode && sm && !activeRecoverySeqId) {
      const firstSeq = (sm.recoverySeqs ?? [])[0];
      if (firstSeq) setActiveRecoverySeqId(firstSeq.id);
    }
  }, [recoveryMode, sm, activeRecoverySeqId]);

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
      // Escape: cancel connect menu, connect preset, or manual draw mode
      if (e.key === 'Escape') {
        const { _isDrawingConnection, _drawingSource, _connectPreset, _connectMenuNodeId } = useDiagramStore.getState();
        if (_connectMenuNodeId) {
          e.preventDefault();
          useDiagramStore.setState({ _connectMenuNodeId: null, _connectMenuHandleId: null, _connectPreset: null });
          return;
        }
        if (_connectPreset) {
          e.preventDefault();
          useDiagramStore.setState({ _connectPreset: null });
          return;
        }
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
          const { activeSmId, selectedNodeId, selectedEdgeId, _activeRecoverySeqId } = useDiagramStore.getState();
          if (activeSmId && selectedNodeId) {
            if (_activeRecoverySeqId) {
              useDiagramStore.getState().deleteRecoveryNode(activeSmId, _activeRecoverySeqId, selectedNodeId);
            } else {
              useDiagramStore.getState().deleteNode(activeSmId, selectedNodeId);
            }
          } else if (activeSmId && selectedEdgeId) {
            if (_activeRecoverySeqId) {
              useDiagramStore.getState().deleteRecoveryEdge(activeSmId, _activeRecoverySeqId, selectedEdgeId);
            } else {
              useDiagramStore.getState().deleteEdge(activeSmId, selectedEdgeId);
            }
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

  // ── Scroll-wheel zoom: direct viewport control (scroll up = zoom in) ──────
  // We disable React Flow's built-in zoomOnScroll and drive the viewport
  // ourselves. Keeps zoom step small, direction predictable, anchors at the
  // mouse pointer. Ignore .nowheel subtrees (picker menus, node popups).
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    function handleWheel(e) {
      // Let elements opt out (popups/menus/scroll areas)
      if (e.target.closest && e.target.closest('.nowheel')) return;
      e.preventDefault();

      const vp = getViewport();
      // Scroll up (deltaY < 0) → zoom out; one click ~= 10% zoom
      const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1;
      const nextZoom = Math.max(0.05, Math.min(2, vp.zoom * factor));

      // Keep the point under the mouse fixed during zoom
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Flow coord under mouse: (mx - vp.x) / vp.zoom
      // Solve for new vp.x/y so that same flow coord stays under (mx, my):
      const flowX = (mx - vp.x) / vp.zoom;
      const flowY = (my - vp.y) / vp.zoom;
      const nextX = mx - flowX * nextZoom;
      const nextY = my - flowY * nextZoom;
      setViewport({ x: nextX, y: nextY, zoom: nextZoom });
    }
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [getViewport, setViewport]);

  // ── Shared helper: add a node and auto-connect from previously selected ───
  const addNodeWithAutoConnect = useCallback((opts = {}) => {
    if (!sm) return null;

    const prevSelectedId = useDiagramStore.getState().selectedNodeId;
    const curSeqId = useDiagramStore.getState()._activeRecoverySeqId;
    const isRecovery = recoveryMode && !!curSeqId;
    const activeSeq = isRecovery
      ? (sm.recoverySeqs ?? []).find(r => r.id === curSeqId) ?? null
      : null;
    const currentNodes = isRecovery ? (activeSeq?.nodes ?? []) : (sm.nodes ?? []);
    const currentEdges = isRecovery ? (activeSeq?.edges ?? []) : (sm.edges ?? []);

    // Determine which node we'll connect from
    const connectFromId =
      prevSelectedId ??
      (currentNodes.length > 0 ? currentNodes[currentNodes.length - 1].id : null);

    // Default position: straight below source node (center-aligned); branch → offset right
    if (!opts.position && connectFromId) {
      const sourceNode = currentNodes.find(n => n.id === connectFromId);
      if (sourceNode) {
        const existingOutEdges = currentEdges.filter(e => e.source === connectFromId);
        const srcW = sourceNode.measured?.width ?? sourceNode.width ?? 240;
        const newW = 240;
        const centerAlignedX = sourceNode.position.x + (srcW - newW) / 2;
        if (existingOutEdges.length > 0) {
          opts = { ...opts, position: { x: sourceNode.position.x + 300, y: sourceNode.position.y + 200 } };
        } else {
          opts = { ...opts, position: { x: centerAlignedX, y: sourceNode.position.y + 200 } };
        }
      }
    }

    const newNodeId = isRecovery
      ? store.addRecoveryNode(sm.id, curSeqId, opts)
      : store.addNode(sm.id, opts);
    if (!newNodeId) return null;

    // Auto-connect from source node
    if (connectFromId && connectFromId !== newNodeId) {
      const edgeCond = getVerifyEdgeData(isRecovery ? { ...sm, nodes: currentNodes, edges: currentEdges } : sm, connectFromId);
      if (isRecovery) {
        store.addRecoveryEdge(sm.id, curSeqId,
          { source: connectFromId, sourceHandle: null, target: newNodeId, targetHandle: null },
          edgeCond
        );
      } else {
        store.addEdge(sm.id,
          { source: connectFromId, sourceHandle: null, target: newNodeId, targetHandle: null },
          edgeCond
        );
      }
    }

    store.setOpenPickerOnNode(newNodeId);

    const finalOpts = opts;
    if (finalOpts.position) {
      setTimeout(() => {
        setCenter(finalOpts.position.x + 120, finalOpts.position.y + 40, { zoom: getViewport().zoom, duration: 300 });
      }, 50);
    }

    return newNodeId;
  }, [sm, store, setCenter, getViewport, recoveryMode]);

  // ── Node / Edge change handlers ────────────────────────────────────────────
  const onNodesChange = useCallback((changes) => {
    if (!sm) return;
    if (recoveryMode && activeSeqId) {
      store.onRecoveryNodesChange(sm.id, activeSeqId, changes);
    } else {
      store.onNodesChange(sm.id, changes);
    }
  }, [sm, store, recoveryMode, activeSeqId]);

  const onEdgesChange = useCallback((changes) => {
    if (!sm) return;
    if (recoveryMode && activeSeqId) {
      store.onRecoveryEdgesChange(sm.id, activeSeqId, changes);
    } else {
      store.onEdgesChange(sm.id, changes);
    }
  }, [sm, store, recoveryMode, activeSeqId]);

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

    // Multi-outcome exits (exit-0, exit-1, exit-2, ...)
    const multiMatch = handle.match(/^exit-(\d+)$/);
    if (multiMatch) {
      const idx = parseInt(multiMatch[1], 10);
      const labels = sourceNode.data?.outcomeLabels ?? [];
      const label = labels[idx] ?? `Option ${idx + 1}`;
      const color = OUTCOME_COLORS[idx % OUTCOME_COLORS.length];
      return {
        conditionType: 'ready',
        label,
        outcomeLabel: label,
        isDecisionExit: true,
        exitColor: 'multi',
        outcomeIndex: idx,
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

    // Decision node — derive label from current node config (mode, conditionType, etc.)
    const computedLabels = computeExitLabels(sourceNode.data ?? {});
    let label;
    if (computedLabels) {
      label = isPass ? computedLabels.exit1 : computedLabels.exit2;
    } else {
      const sigName = sourceNode.data?.signalName ?? '';
      label = isPass ? `Pass_${sigName}` : `Fail_${sigName}`;
    }
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
    const curSeqId = useDiagramStore.getState()._activeRecoverySeqId;
    const isRecovery = recoveryMode && !!curSeqId;
    const activeSeq = isRecovery ? (sm.recoverySeqs ?? []).find(r => r.id === curSeqId) : null;
    const currentNodes = isRecovery ? (activeSeq?.nodes ?? []) : (sm.nodes ?? []);
    // Grab any waypoints placed during the click-to-draw connection
    const drawingWps = useDiagramStore.getState()._drawingWaypoints;
    // Check if this is a decision exit edge — if so, use decision styling instead of verify data
    const decExitData = getDecisionExitData(connection.source, connection.sourceHandle);
    const smForVerify = isRecovery ? { ...sm, nodes: currentNodes, edges: activeSeq?.edges ?? [] } : sm;
    const edgeCond = decExitData ?? getVerifyEdgeData(smForVerify, connection.source);
    const fromNode = currentNodes.find(n => n.id === connection.source);
    const toNode   = currentNodes.find(n => n.id === connection.target);
    if (drawingWps && drawingWps.length > 0) {
      edgeCond.waypoints = drawingWps;
      edgeCond.manualRoute = true;
      const handlePos = getSourceHandlePos(fromNode, connection.sourceHandle);
      const tgtPos = toNode ? { x: (toNode.position?.x ?? 0) + (toNode.measured?.width ?? 240) / 2, y: toNode.position?.y ?? 0 } : null;
      const { firstSegmentAxis, lastSegmentAxis } = computeSegmentAxes(handlePos, drawingWps, tgtPos);
      edgeCond.firstSegmentAxis = firstSegmentAxis;
      edgeCond.lastSegmentAxis  = lastSegmentAxis;
    } else if (fromNode && toNode) {
      const handlePos = getSourceHandlePos(fromNode, connection.sourceHandle);
      const tgtPos = { x: (toNode.position?.x ?? 0) + (toNode.measured?.width ?? 240) / 2, y: toNode.position?.y ?? 0 };
      const autoWps = computeAutoRoute(handlePos, tgtPos, edgeCond, currentNodes, connection.sourceHandle);
      if (autoWps && autoWps.length > 0) {
        edgeCond.waypoints = autoWps;
        edgeCond.manualRoute = true;
        const { firstSegmentAxis, lastSegmentAxis } = computeSegmentAxes(handlePos, autoWps, tgtPos);
        edgeCond.firstSegmentAxis = firstSegmentAxis;
        edgeCond.lastSegmentAxis  = lastSegmentAxis;
      }
    }
    const edgeId = isRecovery
      ? store.addRecoveryEdge(sm.id, curSeqId, connection, edgeCond)
      : store.addEdge(sm.id, connection, edgeCond);
    if (!decExitData) {
      store.setSelectedEdge(edgeId);
      store.openTransitionModal(edgeId);
    }
    useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
  }, [sm, store, getDecisionExitData, recoveryMode]);

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
      // Ortho-snap the first waypoint to the CORNER between the source
      // handle and the release cursor — not the raw cursor. Otherwise the
      // waypoint sits off-grid and the next click kinks through it.
      const nodeW = fromNode.measured?.width  ?? fromNode.width  ?? 240;
      const nodeH = fromNode.measured?.height ?? fromNode.height ?? 80;
      let handleX = fromNode.position.x + nodeW / 2;
      let handleY = fromNode.position.y + nodeH;
      if (fromHandle === 'exit-pass') {
        handleX = fromNode.position.x;
        handleY = fromNode.position.y + nodeH / 2;
      } else if (fromHandle === 'exit-fail') {
        handleX = fromNode.position.x + nodeW;
        handleY = fromNode.position.y + nodeH / 2;
      } else if (fromHandle === 'exit-retry') {
        handleX = fromNode.position.x + nodeW / 2;
        handleY = fromNode.position.y + nodeH;
      }
      // Determine first segment axis from the HANDLE DIRECTION, not mouse position.
      // Side handles (exit-pass = left, exit-fail = right) always exit horizontally.
      // Bottom handles (default, exit-single, exit-retry) always exit vertically.
      const isSideHandle = fromHandle === 'exit-pass' || fromHandle === 'exit-fail';
      const firstWp = isSideHandle
        ? { x: cursorFlow.x, y: handleY }   // horizontal-first → corner at (cursorX, handleY)
        : { x: handleX, y: cursorFlow.y };  // vertical-first   → corner at (handleX, cursorY)
      useDiagramStore.setState({
        _isDrawingConnection: true,
        _drawingSource: { nodeId: fromNode.id, handleId: fromHandle },
        _drawingWaypoints: [firstWp],
      });
      // Block the pane-click that fires on this same mouseup from adding a
      // second, off-axis waypoint.
      lastConnectEndAt.current = Date.now();
      return;
    }

    // ── Normal mode: create a new node and connect immediately ────────────
    useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });

    const curSeqId2 = useDiagramStore.getState()._activeRecoverySeqId;
    const isRecovery2 = !!curSeqId2;
    const activeSeq2 = isRecovery2 ? (sm.recoverySeqs ?? []).find(r => r.id === curSeqId2) : null;
    const currentEdges2 = isRecovery2 ? (activeSeq2?.edges ?? []) : (sm.edges ?? []);

    const existingOutEdges = currentEdges2.filter(e => e.source === fromNode.id);
    const srcW = fromNode.measured?.width ?? fromNode.width ?? 240;
    const newW = 240;
    const centerAlignedX = fromNode.position.x + (srcW - newW) / 2;
    const position = {
      x: existingOutEdges.length > 0 ? cursorFlow.x : centerAlignedX,
      y: cursorFlow.y,
    };

    const newNodeId = isRecovery2
      ? store.addRecoveryNode(sm.id, curSeqId2, { position })
      : store.addNode(sm.id, { position });
    if (!newNodeId) return;

    const decExitData = getDecisionExitData(fromNode.id, fromHandle);
    const currentNodes2 = isRecovery2 ? (activeSeq2?.nodes ?? []) : (sm.nodes ?? []);
    const smForVerify2 = isRecovery2 ? { ...sm, nodes: currentNodes2, edges: currentEdges2 } : sm;
    const edgeCond = decExitData ?? getVerifyEdgeData(smForVerify2, fromNode.id);
    if (drawingWps && drawingWps.length > 0) {
      edgeCond.waypoints = drawingWps;
      edgeCond.manualRoute = true;
      const handlePos = getSourceHandlePos(fromNode, fromHandle);
      const tgtPos = { x: position.x + newW / 2, y: position.y };
      const { firstSegmentAxis, lastSegmentAxis } = computeSegmentAxes(handlePos, drawingWps, tgtPos);
      edgeCond.firstSegmentAxis = firstSegmentAxis;
      edgeCond.lastSegmentAxis  = lastSegmentAxis;
    }
    if (isRecovery2) {
      store.addRecoveryEdge(sm.id, curSeqId2,
        { source: fromNode.id, sourceHandle: fromHandle, target: newNodeId, targetHandle: null },
        edgeCond
      );
    } else {
      store.addEdge(sm.id,
        { source: fromNode.id, sourceHandle: fromHandle, target: newNodeId, targetHandle: null },
        edgeCond
      );
    }

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

    const curSeqId3 = useDiagramStore.getState()._activeRecoverySeqId;
    const isRecovery3 = !!curSeqId3;
    const activeSeq3 = isRecovery3 ? (sm.recoverySeqs ?? []).find(r => r.id === curSeqId3) : null;
    const currentNodes3 = isRecovery3 ? (activeSeq3?.nodes ?? []) : (sm.nodes ?? []);
    const currentEdges3 = isRecovery3 ? (activeSeq3?.edges ?? []) : (sm.edges ?? []);

    let actualTarget = targetNodeId;

    if (!actualTarget && wps.length > 0) {
      const lastWp = wps[wps.length - 1];
      const fromNode = currentNodes3.find(n => n.id === fromNodeId);
      const existingOutEdges = currentEdges3.filter(e => e.source === fromNodeId);
      const position = {
        x: existingOutEdges.length > 0 ? lastWp.x : (fromNode?.position?.x ?? lastWp.x),
        y: lastWp.y,
      };
      actualTarget = isRecovery3
        ? store.addRecoveryNode(sm.id, curSeqId3, { position })
        : store.addNode(sm.id, { position });
      if (!actualTarget) {
        useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
        return;
      }
      store.setOpenPickerOnNode(actualTarget);
    } else if (!actualTarget) {
      useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
      return;
    }

    const decExitData = getDecisionExitData(fromNodeId, fromHandle);
    const smForVerify3 = isRecovery3 ? { ...sm, nodes: currentNodes3, edges: currentEdges3 } : sm;
    const edgeCond = decExitData ?? getVerifyEdgeData(smForVerify3, fromNodeId);

    const fromNode = currentNodes3.find(n => n.id === fromNodeId);
    const toNode   = currentNodes3.find(n => n.id === actualTarget);
    if (wps.length > 0) {
      edgeCond.waypoints = wps;
      edgeCond.manualRoute = true;
      const handlePos = getSourceHandlePos(fromNode, fromHandle);
      const tgtPos = toNode ? { x: (toNode.position?.x ?? 0) + (toNode.measured?.width ?? 240) / 2, y: toNode.position?.y ?? 0 } : null;
      const { firstSegmentAxis, lastSegmentAxis } = computeSegmentAxes(handlePos, wps, tgtPos);
      edgeCond.firstSegmentAxis = firstSegmentAxis;
      edgeCond.lastSegmentAxis  = lastSegmentAxis;
    } else if (fromNode && toNode) {
      const handlePos = getSourceHandlePos(fromNode, fromHandle);
      const tgtPos = { x: (toNode.position?.x ?? 0) + (toNode.measured?.width ?? 240) / 2, y: toNode.position?.y ?? 0 };
      const autoWps = computeAutoRoute(handlePos, tgtPos, edgeCond, currentNodes3, fromHandle);
      if (autoWps && autoWps.length > 0) {
        edgeCond.waypoints = autoWps;
        edgeCond.manualRoute = true;
        const { firstSegmentAxis, lastSegmentAxis } = computeSegmentAxes(handlePos, autoWps, tgtPos);
        edgeCond.firstSegmentAxis = firstSegmentAxis;
        edgeCond.lastSegmentAxis  = lastSegmentAxis;
      }
    }

    const edgeId = isRecovery3
      ? store.addRecoveryEdge(sm.id, curSeqId3,
          { source: fromNodeId, sourceHandle: fromHandle, target: actualTarget, targetHandle: null },
          edgeCond
        )
      : store.addEdge(sm.id,
          { source: fromNodeId, sourceHandle: fromHandle, target: actualTarget, targetHandle: null },
          edgeCond
        );

    if (!decExitData && edgeId) {
      store.setSelectedEdge(edgeId);
      store.openTransitionModal(edgeId);
    }

    useDiagramStore.setState({ _isDrawingConnection: false, _drawingWaypoints: [], _drawingSource: null });
  }, [sm, store, getDecisionExitData]);

  // Assign ref so keyboard handler can call finalizeManualDraw
  finalizeDrawRef.current = finalizeManualDraw;

  // ── Click handlers ────────────────────────────────────────────────────────

  /**
   * Complete a Connect Menu preset connection.
   * Called when _connectPreset is active and user clicks a target node.
   */
  const finalizePresetConnect = useCallback((targetNodeId) => {
    const preset = useDiagramStore.getState()._connectPreset;
    if (!preset || !sm) return;

    const { sourceNodeId, sourceHandle, routeType } = preset;
    if (targetNodeId === sourceNodeId) return; // can't connect to self

    const curSeqId4 = useDiagramStore.getState()._activeRecoverySeqId;
    const isRecovery4 = !!curSeqId4;
    const activeSeq4 = isRecovery4 ? (sm.recoverySeqs ?? []).find(r => r.id === curSeqId4) : null;
    const currentNodes4 = isRecovery4 ? (activeSeq4?.nodes ?? []) : (sm.nodes ?? []);

    const fromNode = currentNodes4.find(n => n.id === sourceNodeId);
    const toNode = currentNodes4.find(n => n.id === targetNodeId);
    if (!fromNode || !toNode) return;

    const srcPos = getSourceHandlePos(fromNode, sourceHandle);
    const tgtNodeW = toNode.measured?.width ?? toNode.width ?? 240;
    const tgtPos = { x: toNode.position.x + tgtNodeW / 2, y: toNode.position.y };

    const { waypoints, manualRoute } = computePresetWaypoints(
      routeType, srcPos, tgtPos, sourceHandle, currentNodes4
    );

    const decExitData = getDecisionExitData(sourceNodeId, sourceHandle);
    const smForVerify4 = isRecovery4 ? { ...sm, nodes: currentNodes4, edges: activeSeq4?.edges ?? [] } : sm;
    const edgeCond = decExitData ?? getVerifyEdgeData(smForVerify4, sourceNodeId);

    if (waypoints.length > 0) {
      edgeCond.waypoints = waypoints;
      edgeCond.manualRoute = manualRoute;
      const { firstSegmentAxis, lastSegmentAxis } = computeSegmentAxes(srcPos, waypoints, tgtPos);
      edgeCond.firstSegmentAxis = firstSegmentAxis;
      edgeCond.lastSegmentAxis = lastSegmentAxis;
    }

    const tgtHandle = toNode.type === 'decisionNode' ? 'input' : null;

    const edgeId = isRecovery4
      ? store.addRecoveryEdge(sm.id, curSeqId4,
          { source: sourceNodeId, sourceHandle, target: targetNodeId, targetHandle: tgtHandle },
          edgeCond
        )
      : store.addEdge(sm.id,
          { source: sourceNodeId, sourceHandle, target: targetNodeId, targetHandle: tgtHandle },
          edgeCond
        );

    useDiagramStore.setState({ _connectPreset: null, _connectMenuNodeId: null, _connectMenuHandleId: null });
    store.clearSelection();

    if (!decExitData && edgeId) {
      store.setSelectedEdge(edgeId);
      store.openTransitionModal(edgeId);
    }
  }, [sm, store, getDecisionExitData]);

  const onNodeClick = useCallback((event, node) => {
    // If Connect Menu preset is active, complete the connection
    const preset = useDiagramStore.getState()._connectPreset;
    if (preset) {
      if (node.id !== preset.sourceNodeId) {
        finalizePresetConnect(node.id);
        return;
      }
    }

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
  }, [store, finalizeManualDraw, finalizePresetConnect]);

  const onEdgeClick = useCallback((event, edge) => {
    // If Connect Menu preset is active, connect to the edge's target node
    const preset = useDiagramStore.getState()._connectPreset;
    if (preset && edge.target && edge.target !== preset.sourceNodeId) {
      finalizePresetConnect(edge.target);
      return;
    }

    // If we're in manual draw mode, clicking an existing edge terminates
    // the connection into that edge's target node. This gives the user a
    // bigger hit target — the incoming "branch" of a node counts as the node.
    const isDrawing = useDiagramStore.getState()._isDrawingConnection;
    const drawSource = useDiagramStore.getState()._drawingSource;
    if (isDrawing && drawSource && edge.target && edge.target !== drawSource.nodeId) {
      finalizeManualDraw(edge.target);
      return;
    }
    store.setSelectedEdge(edge.id);
  }, [store, finalizeManualDraw, finalizePresetConnect]);

  const onEdgeDoubleClick = useCallback((event, edge) => {
    store.setSelectedEdge(edge.id);
    store.openTransitionModal(edge.id);
  }, [store]);

  const onPaneClick = useCallback((event) => {
    // Close connect menu / preset on pane click
    const { _connectPreset, _connectMenuNodeId } = useDiagramStore.getState();
    if (_connectMenuNodeId || _connectPreset) {
      useDiagramStore.setState({ _connectMenuNodeId: null, _connectMenuHandleId: null, _connectPreset: null });
      return;
    }

    // If we're in drawing-connection mode (handle drag), add an ortho-snapped waypoint
    const isDrawing = useDiagramStore.getState()._isDrawingConnection;
    if (isDrawing) {
      // Drop the pane-click that fires simultaneously with onConnectEnd — the
      // drag-release already planted the first waypoint at the ortho corner.
      if (Date.now() - lastConnectEndAt.current < 250) {
        return;
      }
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
  const smEdges = recoveryMode ? (activeRecoverySeq?.edges ?? []) : (sm?.edges ?? []);
  const smNodes = recoveryMode ? (activeRecoverySeq?.nodes ?? []) : (sm?.nodes ?? []);
  const { stateMap: stateNumberMap, visionSubStepsMap } = useMemo(
    () => sm ? computeStateNumbers(smNodes, smEdges, devices, recoveryMode ? { startAt: 100 } : {}) : { stateMap: new Map(), visionSubStepsMap: new Map() },
    [sm, smNodes, smEdges, devices, recoveryMode]
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

      // Decision exit edges (pass/fail/multi): colored label — exit-single is plain gray
      const isDecisionExit = e.data?.isDecisionExit === true && e.sourceHandle !== 'exit-single';
      if (isDecisionExit) {
        const isPass = e.data?.exitColor === 'pass';
        const isMulti = e.data?.exitColor === 'multi';
        // Only force targetHandle='input' if targeting a decisionNode; stateNodes use default (null)
        const decTargetHandle = targetNode?.type === 'decisionNode' ? 'input' : (e.targetHandle ?? null);

        // Color: multi-outcome uses OUTCOME_COLORS palette, otherwise pass=green fail=red
        let color;
        if (isMulti) {
          const idx = e.data?.outcomeIndex ?? 0;
          color = OUTCOME_COLORS[idx % OUTCOME_COLORS.length];
        } else {
          color = isPass ? '#16a34a' : '#dc2626';
        }

        // ── Live label: always derive from the source decision node's current
        //    config so labels stay in sync even if edge data is stale.
        let liveLabel = e.data?.outcomeLabel ?? '';
        if (sourceNode?.type === 'decisionNode' && e.sourceHandle !== 'exit-single') {
          const sn = sourceNode.data ?? {};
          // Multi-outcome: live label from stored outcomeLabels array
          if (isMulti && sn.outcomeLabels) {
            const idx = e.data?.outcomeIndex ?? 0;
            if (idx < sn.outcomeLabels.length) liveLabel = sn.outcomeLabels[idx];
          } else {
            const computedLabels = computeExitLabels(sn);
            if (computedLabels) {
              if (e.sourceHandle === 'exit-pass')  liveLabel = computedLabels.exit1;
              if (e.sourceHandle === 'exit-fail')  liveLabel = computedLabels.exit2;
              // Retry branch label stays as stored
            }
          }
        }

        return {
          ...e,
          targetHandle: decTargetHandle,
          type: 'routableEdge',
          // Pass live label through BOTH label prop and data.outcomeLabel so
          // RoutableEdge's pill renderer always shows the correct text.
          data: { ...(e.data ?? {}), outcomeLabel: liveLabel },
          label: e.sourceHandle === 'exit-single' ? '' : liveLabel,
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
        <div className={`canvas-sm-title${recoveryMode ? ' canvas-sm-title--recovery' : ''}`}>
          <span className="canvas-sm-title__number">S{String(sm.stationNumber ?? 0).padStart(2, '0')}</span>
          <span className="canvas-sm-title__name">{sm.name || 'Untitled'}</span>
          {/* Normal / Recovery toggle */}
          <div className="canvas-mode-toggle">
            <button
              className={`canvas-mode-btn${!recoveryMode ? ' canvas-mode-btn--active' : ''}`}
              onClick={() => setRecoveryMode(false)}
            >Normal</button>
            <button
              className={`canvas-mode-btn${recoveryMode ? ' canvas-mode-btn--active canvas-mode-btn--recovery' : ''}`}
              onClick={() => setRecoveryMode(true)}
            >Recovery</button>
          </div>
          {/* Recovery variant selector */}
          {recoveryMode && (sm.recoverySeqs ?? []).length > 1 && (
            <select
              className="canvas-recovery-seq-select"
              value={activeRecoverySeqId ?? ''}
              onChange={e => setActiveRecoverySeqId(e.target.value)}
            >
              {(sm.recoverySeqs ?? []).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
          {/* Save to Standards */}
          <button
            className="canvas-star-btn"
            title="Save to Standards Library"
            onClick={() => {
              setStarName(sm.name || '');
              setStarDesc('');
              setStarCategory('');
              setStarFormOpen(v => !v);
            }}
          >★</button>
        </div>
      )}
      {/* Star save form — floats below the header */}
      {starFormOpen && sm && (
        <div className="canvas-star-form">
          <div className="canvas-star-form__title">Save to Standards Library</div>
          <input
            className="canvas-star-form__input"
            placeholder="Name"
            value={starName}
            onChange={e => setStarName(e.target.value)}
          />
          <input
            className="canvas-star-form__input"
            placeholder="Category (optional)"
            value={starCategory}
            onChange={e => setStarCategory(e.target.value)}
          />
          <textarea
            className="canvas-star-form__input canvas-star-form__textarea"
            placeholder="Description (optional)"
            value={starDesc}
            onChange={e => setStarDesc(e.target.value)}
            rows={2}
          />
          <div className="canvas-star-form__btns">
            <button
              className="canvas-star-form__save"
              disabled={!starName.trim()}
              onClick={() => {
                saveStandard({
                  name: starName.trim(),
                  description: starDesc.trim(),
                  category: starCategory.trim(),
                  nodes: sm.nodes ?? [],
                  edges: sm.edges ?? [],
                  devices: sm.devices ?? [],
                });
                setStarFormOpen(false);
              }}
            >Save</button>
            <button className="canvas-star-form__cancel" onClick={() => setStarFormOpen(false)}>
              Cancel
            </button>
          </div>
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
        zoomOnScroll={false}
        zoomOnPinch={true}
        panOnScroll={false}
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
                if (sm) {
                  const curSeqId = useDiagramStore.getState()._activeRecoverySeqId;
                  if (curSeqId) store.onRecoveryNodesChange(sm.id, curSeqId, []);
                  else store.onNodesChange(sm.id, []);
                }
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
