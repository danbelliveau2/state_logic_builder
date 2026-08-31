/**
 * SheetFlow — the sheet's sequence/recovery drawn in the REAL v1 visual
 * language (Dan, 2026-08-30: "the nodes on the first version of this app
 * looked good, had all the right information — this doesn't look as good").
 *
 * A read-only React Flow instance whose nodes use the mechanical canvas's
 * OWN CSS shell (.state-node / .state-node__step-num / .action-row — same
 * classes, same typography, same 240px width) and whose edges are the
 * smoothstep-with-label rendering the Controls detail view uses. Content
 * rules stand (they're orthogonal to the visual): no wait/signal/home
 * nodes — waits are EDGE LABELS (native v1: conditions on edges) with the
 * counterpart as a small colored chip; one-row node text; sequences
 * side-branch (happy path straight, exception lane right, rejoining);
 * recoveries draw the Y.
 *
 * View only: no drag, no connect, fitView, light zoom. Reusable — this is
 * the base for the machine-level diagram later.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
// V1 ICONOGRAPHY ON FLOW NODES (Dan, 2026-08-31: "the color and the icon you
// could take from the old version") — same set the device cards use.
import { DeviceIcon, DEVICE_ICON_COLORS } from '../components/DeviceIcons.jsx';
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';

const NODE_W = 240;
const EST_H = 78;      // single-action node estimate (restack refines by fit)
const GAP_Y = 46;      // vertical gap carrying the edge + label
const LANE_X = 300;    // side-branch lane offset

// v1 mechanical palette (mirror of StateNode's private map).
const VERB_COLORS = {
  extend: '#1574c4', engage: '#1574c4', close: '#1574c4',
  retract: '#aacee8', disengage: '#aacee8', open: '#aacee8',
  'servo move': '#1574c4', move: '#1574c4', index: '#aacee8',
};
const verbColor = (v) => VERB_COLORS[String(v ?? '').toLowerCase()] ?? '#9ca3af';

function SFHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="in-top" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Left} id="in-left" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Right} id="in-right" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="out-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Left} id="out-left" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} id="out-right" style={{ opacity: 0, pointerEvents: 'none' }} />
    </>
  );
}

/** The v1 state-node shell, read-only: number badge, header title, one
 *  action row with the device pill in the device's verb color. */
function SFStateNode({ data }) {
  return (
    <div className="state-node" style={{ width: NODE_W, cursor: 'default' }}>
      <SFHandles />
      <div className="state-node__step-num" style={{ background: data.lane === 'recovery' ? '#b45309' : 'var(--color-primary)' }}>
        {data.n}
      </div>
      <div className="state-node__header">
        <span className="state-node__title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }} title={data.title}>
          {data.title}
        </span>
      </div>
      {(data.device || data.detail) && (
        <div className="state-node__body">
          <div className="action-row" style={{ '--device-color': verbColor(data.verb), whiteSpace: 'nowrap', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 4 }} title={`${data.verb} ${data.device}${data.detail ? ` — ${data.detail}` : ''}`}>
            {data.devType ? (
              <span style={{ display: 'inline-flex', flexShrink: 0, color: DEVICE_ICON_COLORS[data.devType] ?? '#64748b' }} title={data.devType}>
                <DeviceIcon type={data.devType} size={13} color={DEVICE_ICON_COLORS[data.devType] ?? '#64748b'} />
              </span>
            ) : null}
            {data.device ? <span className="action-device">{data.device}</span> : null}
            {data.detail ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11 }}>{data.detail}</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** The v1 decision pill (decide mode — purple, both paths equal). */
function SFDecisionNode({ data }) {
  return (
    <div
      className="decision-node"
      style={{
        width: NODE_W, boxSizing: 'border-box', cursor: 'default',
        border: '2.5px solid #7c3aed', borderRadius: 999, background: '#fff',
        padding: '8px 18px', textAlign: 'center',
        boxShadow: 'var(--shadow, 0 1px 4px rgba(0,0,0,0.12))',
      }}
    >
      <SFHandles />
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed' }}>Decide</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text, #1a2733)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflowEllipsis: 'ellipsis' }} title={data.title}>
        {data.title}
      </div>
    </div>
  );
}

/** Terminal fault marker (side-branch that doesn't rejoin). */
function SFFaultNode() {
  return (
    <div style={{
      width: 120, textAlign: 'center', border: '2px solid #d4a0a0', borderRadius: 8,
      background: '#fdf2f2', color: '#8a3b3b', fontWeight: 800, fontSize: 12, padding: '6px 10px',
    }}>
      <SFHandles />
      ✕ Fault
    </div>
  );
}

function SFEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, markerEnd }) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 10, offset: 16,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {(data?.text || data?.tag) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: '#fff', border: '1px solid var(--color-border, #d5dbe3)', borderRadius: 5,
              padding: '1px 7px', fontSize: 10.5, color: 'var(--color-text-muted, #5a6a7e)',
              // FULL CONDITION, ALWAYS READABLE (Dan, 2026-08-30: the cutoff
              // was the complaint) — the band grows to its content; no cap.
              whiteSpace: 'nowrap', pointerEvents: 'none',
              fontWeight: data?.branch ? 800 : 500,
              ...(data?.branch ? (/^(yes|on|pass|true)$/i.test(data.text)
                ? { color: '#2f6b3c', borderColor: '#7fb08c', background: '#e9f5ec' }
                : /^(no|off|fail|false)$/i.test(data.text)
                  ? { color: '#8a3b3b', borderColor: '#d4a0a0', background: '#fdf2f2' } : {}) : {}),
            }}
            title={data.full ?? data.text}
          >
            <span>{data.text}</span>
            {data.tag && (
              <span style={{
                fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '0 5px', flexShrink: 0,
                ...(data.tag.scope === 'sameStation'
                  ? { color: '#075985', background: '#e0f2fe', border: '1px solid #bae6fd' }
                  : { color: '#6b21a8', background: '#f3e8ff', border: '1px solid #e9d5ff' }),
              }}>← {data.tag.counterpart}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { sfState: SFStateNode, sfDecision: SFDecisionNode, sfFault: SFFaultNode };
const edgeTypes = { sfEdge: SFEdge };

/** model: buildFlowModel output — items: [{line, verb, device, detail,
 *  cond?, tag?} | {branch: {decision, cond?, tag?, branches: [{label,
 *  items, rejoins, faults}]}}]. mode 'seq' | 'recovery'. */
function deriveGraph(model, mode, lane) {
  const nodes = [];
  const edges = [];
  let idc = 0;
  let stepNo = 0;
  const nid = () => `sf${idc++}`;
  const edge = (a, b, { text = null, tag = null, branch = false, sh = 'out-bottom', th = 'in-top', dotted = false } = {}) => {
    edges.push({
      id: `e${a}-${b}-${edges.length}`, source: a, target: b, sourceHandle: sh, targetHandle: th,
      type: 'sfEdge',
      style: { stroke: 'var(--color-border, #b8c4d0)', strokeWidth: 1.6, ...(dotted ? { strokeDasharray: '5 4' } : {}) },
      markerEnd: 'url(#sf-arrow)',
      data: { text, tag, branch },
    });
  };
  const pushStep = (it, x, y) => {
    const id = nid();
    stepNo += 1;
    nodes.push({
      id, type: 'sfState', position: { x, y }, draggable: false, connectable: false, selectable: false,
      data: { n: stepNo, title: it.title, verb: it.verb, device: it.device, detail: it.detail, devType: it.devType ?? null, lane },
    });
    return id;
  };

  let prev = null;
  let prevMeta = null; // pending edge label for the NEXT connection
  let y = 0;
  const mainX = mode === 'recovery' ? 0 : 0;
  const items = model.items ?? [];
  items.forEach((it) => {
    if (it.branch) {
      const b = it.branch;
      const did = nid();
      nodes.push({
        id: did, type: 'sfDecision', position: { x: mainX, y }, draggable: false, connectable: false, selectable: false,
        data: { title: b.decision },
      });
      if (prev) edge(prev, did, { text: prevMeta?.cond ?? b.cond, tag: prevMeta?.tag ?? b.tag });
      prevMeta = null;
      y += EST_H + GAP_Y;
      const branchYStart = y;
      const laneOf = (bi) => (mode === 'recovery'
        ? (bi === 0 ? mainX - LANE_X / 1.6 : mainX + LANE_X / 1.6)
        : (bi === 0 ? mainX : mainX + LANE_X));
      let mainTail = null;
      let maxY = y;
      (b.branches ?? []).forEach((br, bi) => {
        let byy = branchYStart;
        let bprev = did;
        let first = true;
        (br.items ?? []).forEach((bit) => {
          if (bit.branch) return; // nested decisions: not drawn at this depth
          const x = laneOf(bi);
          const sid = pushStep(bit, x, byy);
          edge(bprev, sid, first
            ? {
              text: br.label, branch: true,
              sh: mode === 'recovery' ? (bi === 0 ? 'out-left' : 'out-right') : (bi === 0 ? 'out-bottom' : 'out-right'),
              th: 'in-top',
              tag: bit.cond ? bit.tag : null,
            }
            : { text: bit.cond, tag: bit.tag });
          bprev = sid;
          first = false;
          byy += EST_H + GAP_Y;
        });
        if (!br.items?.length) {
          // Empty branch: label-only edge to a fault/continue marker.
          bprev = did;
        }
        if (bi === 0) { mainTail = bprev === did ? did : bprev; }
        else if (br.faults && !br.rejoins) {
          const fid = nid();
          nodes.push({ id: fid, type: 'sfFault', position: { x: laneOf(bi) + 55, y: byy }, draggable: false, connectable: false, selectable: false, data: {} });
          edge(bprev, fid, {});
          byy += 60;
        } else if (bprev !== did) {
          // rejoin lane: dotted edge back to the main tail (or onward).
          br._tail = bprev;
        }
        maxY = Math.max(maxY, byy);
      });
      y = maxY;
      prev = mainTail ?? did;
      // side-branch rejoins connect to whatever main node comes NEXT.
      const rejoiners = (b.branches ?? []).slice(1).filter((br) => br._tail && (br.rejoins || !br.faults));
      if (rejoiners.length) prevMeta = { rejoiners };
      return;
    }
    const id = pushStep(it, mainX, y);
    if (prev) edge(prev, id, { text: it.cond, tag: it.tag });
    if (prevMeta?.rejoiners) {
      for (const br of prevMeta.rejoiners) edge(br._tail, id, { th: 'in-right', sh: 'out-bottom', dotted: true });
    }
    prevMeta = null;
    prev = id;
    y += EST_H + GAP_Y;
  });
  // Repeat: dotted loop edge from the last main node back to the first.
  if (model.repeat && nodes.length > 1 && prev) {
    const first = nodes.find((n) => n.type === 'sfState');
    if (first && first.id !== prev) {
      edge(prev, first.id, { sh: 'out-left', th: 'in-left', dotted: true, text: model.endCond ? `Wait — ${model.endCond}` : null });
    }
  }
  return { nodes, edges };
}

function SFInner({ model, mode, lane }) {
  const rf = useReactFlow();
  const graph = useMemo(() => deriveGraph(model, mode, lane), [model, mode, lane]);
  const wrapRef = useRef(null);
  const [sized, setSized] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const check = () => { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 50) setSized(true); };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // SYNCHRONOUS MEASUREMENT KICK (same fix as ControlsFlowView): RF defers
  // measurement through rAF, which never fires in hidden/background tabs —
  // nodes stay invisible and EDGES never draw. Measure via the store
  // directly until every node has dimensions, then fit.
  const storeApi = useStoreApi();
  useEffect(() => {
    if (!sized) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (tries > 40) { clearInterval(t); return; }
      const st = storeApi.getState();
      const wrapper = wrapRef.current;
      if (!wrapper) return;
      const unmeasured = [...st.nodeLookup.values()].filter((n) => !n.measured?.width);
      if (unmeasured.length > 0) {
        const updates = new Map();
        for (const n of unmeasured) {
          const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
          if (el) updates.set(n.id, { id: n.id, nodeElement: el, force: true });
        }
        if (updates.size > 0) st.updateNodeInternals(updates);
        return;
      }
      try { rf.fitView({ padding: 0.12, maxZoom: 1 }); } catch { /* unmounted */ }
      clearInterval(t);
    }, 120);
    return () => clearInterval(t);
  }, [sized, graph, rf, storeApi]);
  // Height sized to content estimate (bounded) — the card grows, no inner scroll.
  const estHeight = Math.min(760, Math.max(180, (graph.nodes.length ? Math.max(...graph.nodes.map(n => n.position.y)) : 0) * 0.62 + 160));
  return (
    <div ref={wrapRef} style={{ width: '100%', height: estHeight }}>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <marker id="sf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-border, #b8c4d0)" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.4}
      />
    </div>
  );
}

export function SheetFlow({ model, mode = 'seq', lane = 'main' }) {
  if (!model?.items?.length) return null;
  return (
    <ReactFlowProvider>
      <SFInner model={model} mode={mode} lane={lane} />
    </ReactFlowProvider>
  );
}
