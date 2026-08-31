/**
 * ControlsFlowView — the Diagram page's "Controls detail" layer: the REAL
 * PLC code's flowchart, derived on view from the station's compiled sequence
 * (sm.compiledSequence.ir).
 *
 * TRUE VIEW PARITY (Dan, Aug 22 — the #1 complaint): this view renders the
 * SAME StateNode / DecisionNode components as the mechanical canvas — not
 * lookalike CSS. A compiled state that maps to a drawn node (ir nodeId)
 * renders the actual component with the drawn node's own data (CFRealNode
 * wraps it read-only, adds this layer's edge handles + compiled chips).
 * Only states with NO drawn counterpart (synthesized confirms, template
 * init/fault states) use a fallback card — built from the mechanical
 * diagram's own CSS classes at the same 240px width and typography.
 *
 * The flowchart keeps its clean derived routing (Dan likes it): main
 * sequence down the center, fault/init/recovery in its own column, dotted
 * recovery edges, condition labels. Part-tracking latches surface as chips
 * (plus the drawn nodes' own signal-latch pills and PT badges, which come
 * free with the real components).
 *
 * Zoom/pan parity: same custom wheel handler as Canvas.jsx (pointer-anchored
 * small steps, .nowheel opt-out).
 *
 * READ-ONLY, COMPUTED, NEVER STORED. Renders INSIDE the same center pane as
 * the mechanical canvas (AppV2 overlays it over the canvas only — the
 * stations panel and every other piece of page chrome stays put).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { deriveControlsFlow, restackPositions, CF_NODE_W } from './controlsFlowDerive.js';
import { StateNode } from '../components/nodes/StateNode.jsx';
import { DecisionNode } from '../components/nodes/DecisionNode.jsx';
import { DeviceIcon } from '../components/DeviceIcons.jsx';
import { DEVICE_TYPES } from '../lib/deviceTypes.js';

// ── Operation colors — mirror of the mechanical palette (StateNode keeps its
//    map private) — used only by the fallback cards for synthesized states.
const OP_COLORS = {
  Extend: '#1574c4', Engage: '#1574c4', VacOn: '#1574c4',
  Retract: '#aacee8', Disengage: '#aacee8', VacOff: '#aacee8', VacOnEject: '#aacee8',
  SetOn: '#1574c4', SetOff: '#aacee8', WaitOn: '#1574c4', WaitOff: '#aacee8',
  SetValue: '#befa4f',
  VerifyValue: '#d9d9d9', Check: '#d9d9d9', Wait: '#d9d9d9',
  Inspect: '#ffde51', VisionInspect: '#ffde51',
  ServoMove: '#1574c4', ServoIncr: '#befa4f', ServoIndex: '#aacee8',
  SetSignal: '#1574c4', ClearSignal: '#aacee8',
};

function opColor(a) {
  if (OP_COLORS[a.op]) return OP_COLORS[a.op];
  if (a.deviceType && DEVICE_TYPES[a.deviceType]?.color) return DEVICE_TYPES[a.deviceType].color;
  return '#9ca3af';
}

// Six invisible edge-anchoring handles — shared by both node types so the
// derived edges (in-top / out-left / …) always find their anchors.
function EdgeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="in-top" className="v2-cf__handle" />
      <Handle type="target" position={Position.Left} id="in-left" className="v2-cf__handle" />
      <Handle type="target" position={Position.Right} id="in-right" className="v2-cf__handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="v2-cf__handle" />
      <Handle type="source" position={Position.Left} id="out-left" className="v2-cf__handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="v2-cf__handle" />
    </>
  );
}

// Compiled-layer chips + timeout strip (below the node card).
function CompiledExtras({ data }) {
  return (
    <>
      {data.chips?.length > 0 && (
        <div className="v2-cf__chips">
          {data.chips.map((c, i) => (
            <span className={`v2-cf__chip v2-cf__chip--${c.kind}`} key={i} title={c.title}>{c.text}</span>
          ))}
        </div>
      )}
      {data.timeout && (
        <div className="v2-cf__timeout" title={data.timeout.title}>
          ⏱ {data.timeout.label}: {data.timeout.text}
        </div>
      )}
    </>
  );
}

// ── REAL drawn node, read-only, inside this layer ───────────────────────────
function CFRealNode({ id, data }) {
  const Comp = data.nodeType === 'decisionNode' ? DecisionNode : StateNode;
  return (
    <div className={`v2-cfr v2-cfr--${data.lane}`} style={{ width: CF_NODE_W }}>
      <EdgeHandles />
      <div className="v2-cfr__inner">
        <Comp id={id} data={data.nodeData} selected={false} />
      </div>
      <CompiledExtras data={data} />
    </div>
  );
}

// ── Fallback card for synthesized / template states — the mechanical
//    diagram's OWN classes (state-node header/body, action-row pills) at the
//    same 240px width, so typography matches the real components exactly. ────
function CFActionRow({ a }) {
  const color = opColor(a);
  const icon = a.deviceType
    ? <DeviceIcon type={a.deviceType} size={14} />
    : <span className="action-icon">{a.icon}</span>;

  if (a.op === 'ServoMove' && (a.positionName || a.speedProfile)) {
    return (
      <div className="action-row action-row--servo" style={{ '--device-color': color }} title={a.title}>
        <div className="servo-move__head">
          {icon}
          <span className="action-device servo-move__device">{a.device}</span>
        </div>
        <div className="servo-move__grid">
          {a.positionName && (
            <>
              <span className="servo-move__lbl">POS</span>
              <span className="servo-move__line"><span className="servo-move__name">{a.positionName}</span></span>
            </>
          )}
          {a.speedProfile && (
            <>
              <span className="servo-move__lbl">SPEED</span>
              <span className="servo-move__line">
                <span className="servo-move__name">
                  {a.speedProfile}{a.advance === 'wideband' ? ' · blend exit' : ''}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="action-row" style={{ '--device-color': color }} title={a.title}>
      {icon}
      {a.device ? <span className="action-device">{a.device}</span> : null}
      <span className="v2-cf__action-text">{a.device && a.text.startsWith(a.device) ? a.text.slice(a.device.length).replace(/^\s*—\s*/, '') : a.text}</span>
    </div>
  );
}

function CFStateNode({ data }) {
  const cls = [
    'state-node v2-cfs',
    data.lane === 'recovery' ? 'v2-cfs--recovery' : '',
    data.synthesized ? 'v2-cfs--confirm' : '',
    data.template ? 'v2-cfs--template' : '',
    data.isInitial ? 'state-node--initial' : '',
    data.isComplete ? 'state-node--complete' : '',
  ].filter(Boolean).join(' ');

  const numBg = data.lane === 'recovery' ? '#b45309'
    : data.synthesized ? '#64748b'
    : (data.isInitial || data.isComplete) ? '#5a9a48'
    : 'var(--color-primary)';

  return (
    <div className={cls}>
      <EdgeHandles />
      <div className="state-node__step-num" style={{ background: numBg }}>
        {data.stateNumber}
      </div>
      <div className="state-node__header">
        <span className="state-node__title">{data.label}</span>
      </div>
      {data.actions.length > 0 && (
        <div className="state-node__body">
          {data.actions.map((a, i) => <CFActionRow a={a} key={i} />)}
        </div>
      )}
      <CompiledExtras data={data} />
    </div>
  );
}

// ── Edge — smoothstep path + wrapping HTML label with the full rung tooltip ─
function CFEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, markerEnd }) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 10,
    offset: data?.offset ?? 16,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {data?.text && (
        <EdgeLabelRenderer>
          <div
            className={`v2-cf__elabel v2-cf__elabel--${data.kind}${data.flagged ? ' v2-cf__elabel--flag' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={data.full}
          >
            {data.text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { cfState: CFStateNode, cfReal: CFRealNode };
const edgeTypes = { cfEdge: CFEdge };

// ── Inner flow — wheel zoom identical to Canvas.jsx + measured re-stack ─────
function CFFlow({ flow }) {
  const wrapperRef = useRef(null);
  const rf = useReactFlow();
  const storeApi = useStoreApi();
  const { getViewport, setViewport } = rf;
  const [nodes, setNodes] = useState(flow.nodes);
  const restackedFor = useRef(null);

  // Mount React Flow only once the wrapper has real dimensions — mounting
  // into a 0×0 container leaves RF on its 500×500 fallback with unmeasured
  // (invisible) nodes and no edges (RF error #004).
  const [sized, setSized] = useState(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return undefined;
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) setSized(true);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitDoneFor = useRef(null);
  useEffect(() => {
    setNodes(flow.nodes);
    restackedFor.current = null;
    fitDoneFor.current = null;
  }, [flow]);

  // Kick node measurement explicitly and SYNCHRONOUSLY. React Flow's own
  // measurement (and useUpdateNodeInternals) defers through
  // requestAnimationFrame, which never fires in hidden/background tabs —
  // nodes would stay visibility:hidden with no edges. Calling the store's
  // updateNodeInternals directly with the DOM elements measures
  // deterministically; once every node has real dimensions, the columns are
  // RE-STACKED with true heights and the view refits.
  useEffect(() => {
    if (!sized || fitDoneFor.current === flow) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (tries > 40) { clearInterval(t); return; }
      const st = storeApi.getState();
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const unmeasured = [...st.nodeLookup.values()].filter((n) => !n.measured?.width);
      if (unmeasured.length > 0) {
        const updates = new Map();
        for (const n of unmeasured) {
          const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
          if (el) updates.set(n.id, { id: n.id, nodeElement: el, force: true });
        }
        if (updates.size > 0) st.updateNodeInternals(updates);
        return; // verify on the next tick
      }
      // All measured. Restack once with true heights (setNodes resets RF's
      // measurements, so the next ticks re-measure), then fit and stop.
      if (restackedFor.current !== flow) {
        restackedFor.current = flow;
        const measured = new Map([...st.nodeLookup.entries()].map(([id, n]) => [id, n.measured?.height]));
        const heightOf = (n) => measured.get(n.id) ?? n.data?._estH ?? 100;
        setNodes((ns) => restackPositions(ns, flow.meta, heightOf));
        return;
      }
      if (fitDoneFor.current !== flow) {
        fitDoneFor.current = flow;
        try { rf.fitView({ padding: 0.15, maxZoom: 1 }); } catch { /* unmounted */ }
      }
      clearInterval(t);
    }, 120);
    return () => clearInterval(t);
  }, [sized, flow, nodes, storeApi, rf]);

  // Wheel zoom — byte-for-byte the mechanical canvas behavior.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return undefined;
    function handleWheel(e) {
      if (e.target.closest && e.target.closest('.nowheel')) return;
      e.preventDefault();
      const vp = getViewport();
      const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1;
      const nextZoom = Math.max(0.05, Math.min(2, vp.zoom * factor));
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const flowX = (mx - vp.x) / vp.zoom;
      const flowY = (my - vp.y) / vp.zoom;
      setViewport({ x: mx - flowX * nextZoom, y: my - flowY * nextZoom, zoom: nextZoom });
    }
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [getViewport, setViewport]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
      {sized && (
      <ReactFlow
        nodes={nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch
        panOnScroll={false}
        panOnDrag
        minZoom={0.05}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        {/* Same corners as the mechanical canvas: controls top-right,
            minimap bottom-right. */}
        <Controls position="top-right" style={{ top: 10, right: 10 }} showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            if (n.data?.lane === 'recovery') return '#d97706';
            if (n.data?.synthesized) return '#94a3b8';
            return '#4a89b8';
          }}
        />
      </ReactFlow>
      )}
    </div>
  );
}

// ── View ────────────────────────────────────────────────────────────────────
export function ControlsFlowView() {
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  // Re-derive when a compile lands (the modal mirrors the server write into
  // the store, but the bump also covers any path that doesn't).
  const compiledBump = useV2Shell((s) => s.compiledBump);

  const ir = sm?.compiledSequence?.ir ?? null;
  // STABLE memo deps — depending on `sm` itself would re-derive on every
  // store write (object identity churn), resetting React Flow's nodes
  // mid-measurement forever (nodes stay hidden, edges never draw). Only the
  // pieces the derivation actually reads gate it.
  const smNodes = sm?.nodes;
  const smEdges = sm?.edges;
  const smDevices = sm?.devices;

  const flow = useMemo(
    () => (ir ? deriveControlsFlow(ir, { nodes: smNodes, edges: smEdges, devices: smDevices }) : null),
    [ir, smNodes, smEdges, smDevices, compiledBump] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!flow) {
    return (
      <div className="v2-cf__empty" data-testid="cf-empty">
        <div className="v2-cc__banner v2-cc__banner--amber">
          No compiled sequence yet — ⚙ Compile (in the row above) draws the
          real code's flowchart here.
        </div>
      </div>
    );
  }

  return (
    <div className="v2-cf__canvas" data-testid="cf-canvas">
      <ReactFlowProvider>
        <CFFlow flow={flow} />
      </ReactFlowProvider>
    </div>
  );
}
