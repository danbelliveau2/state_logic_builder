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
 * LANE RENDER (Dan approved drawing, 2026-09-01): sequences whose model
 * carries Decide/Loop grid tokens draw as LANES — the main cycle straight
 * down on the left, decision pills in the main line, retry/exception
 * branches as lanes beside the main line (branch boxes + their own decide
 * pill), the second-level lane (stack change) farther right. Branch ends
 * are PLAIN-WORD caps ("no — shuttle out again", "back to new stack
 * setup") — never letters, never long routed return lines crossing
 * content. The far-left corridor carries ONLY the main next-cycle loop.
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
const DEC_H = 52;      // decision pill estimate
const CAP_H = 34;      // plain-word branch-end cap estimate
const GAP_Y = 46;      // vertical gap carrying the edge + label
const LANE_X = 300;    // side-branch lane offset (recovery Y / nested shape)
const COL_X = 330;     // lane column pitch (Dan approved drawing, 2026-09-01)
const LANE_VGAP = 40;  // vertical air between stacked lanes in one column

// v1 mechanical palette (mirror of StateNode's private map).
const VERB_COLORS = {
  extend: '#1574c4', engage: '#1574c4', close: '#1574c4',
  retract: '#aacee8', disengage: '#aacee8', open: '#aacee8',
  'servo move': '#1574c4', move: '#1574c4', index: '#aacee8',
};
const verbColor = (v) => VERB_COLORS[String(v ?? '').toLowerCase()] ?? '#9ca3af';

// Per-node height estimate: wrapped titles/details add a row each (WRAP,
// DON'T ELLIPSIZE — Dan, 2026-09-01). Layout steps by this, render measures.
const stepH = (it) => EST_H
  + (String(it?.title ?? '').length > 30 ? 16 : 0)
  + ((String(it?.device ?? '').length + String(it?.detail ?? '').length) > 34 ? 14 : 0);

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
  // TEAL IO NODES (Dan's reference drawing, 2026-09-01): Waits and Signals
  // on the lane grid are real nodes, tinted teal to read as coordination.
  const io = data.kind === 'io';
  return (
    <div className="state-node" style={{ width: NODE_W, cursor: 'default', ...(io ? { borderColor: '#0e7490', background: '#f0fbfc' } : {}) }}>
      <SFHandles />
      <div className="state-node__step-num" style={{ background: io ? '#0e7490' : data.lane === 'recovery' ? '#b45309' : 'var(--color-primary)' }}>
        {data.n}
      </div>
      <div className="state-node__header">
        {/* WRAP, DON'T ELLIPSIZE (Dan, 2026-09-01: "Retract Vertical Shuttle
            and Top …" lost its meaning) — titles wrap to two lines max. */}
        <span className="state-node__title" style={{ whiteSpace: 'normal', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.25 }} title={data.title}>
          {data.title}
        </span>
      </div>
      {(data.device || data.detail) && (
        <div className="state-node__body">
          <div className="action-row" style={{ '--device-color': verbColor(data.verb), whiteSpace: 'normal', overflow: 'hidden', display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 4 }} title={`${data.verb} ${data.device}${data.detail ? ` — ${data.detail}` : ''}`}>
            {data.devType ? (
              <span style={{ display: 'inline-flex', flexShrink: 0, color: DEVICE_ICON_COLORS[data.devType] ?? '#64748b', marginTop: 1 }} title={data.devType}>
                <DeviceIcon type={data.devType} size={13} color={DEVICE_ICON_COLORS[data.devType] ?? '#64748b'} />
              </span>
            ) : null}
            {data.device ? <span className="action-device">{data.device}</span> : null}
            {data.detail ? <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', fontSize: 11 }}>{data.detail}</span> : null}
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
      title={data.detail ? `${data.title} — ${data.detail}` : data.title}
    >
      <SFHandles />
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed' }}>Decide</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text, #1a2733)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

/** PLAIN-WORD branch-end cap (Dan approved drawing, 2026-09-01): "no —
 *  shuttle out again", "back to new stack setup" — the loop point is the
 *  LABEL, never a letter and never a long routed return line. */
function SFLoopCap({ data }) {
  return (
    <div style={{
      maxWidth: NODE_W - 20, display: 'inline-flex', alignItems: 'center', gap: 6,
      border: '1.5px dashed var(--color-border, #b8c4d0)', borderRadius: 999,
      background: 'var(--color-bg, #f6f8fa)', color: 'var(--color-text-muted, #5a6a7e)',
      fontWeight: 700, fontSize: 11.5, padding: '5px 12px', whiteSpace: 'nowrap',
    }} title={data.label}>
      <SFHandles />
      <span aria-hidden="true">↺</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.label}</span>
    </div>
  );
}

function SFEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, markerEnd }) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 10, offset: 16,
  });
  const branchWord = data?.branchLabel ?? (data?.branch ? data?.text : null);
  const pillStyle = branchWord
    ? (/^(yes|on|pass|true)$/i.test(branchWord)
      ? { color: '#2f6b3c', borderColor: '#7fb08c', background: '#e9f5ec' }
      : /^(no|off|fail|false)$/i.test(branchWord)
        ? { color: '#8a3b3b', borderColor: '#d4a0a0', background: '#fdf2f2' } : {})
    : {};
  const bandText = data?.branchLabel ? data?.text : (data?.branch ? null : data?.text);
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {(branchWord || bandText || data?.tag) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: '#fff', border: '1px solid var(--color-border, #d5dbe3)', borderRadius: 5,
              padding: '1px 7px', fontSize: 11.5, color: 'var(--color-text-muted, #5a6a7e)',
              // FULL CONDITION, ALWAYS READABLE (Dan, 2026-08-30: the cutoff
              // was the complaint) — the band grows to its content; no cap.
              whiteSpace: 'nowrap', pointerEvents: 'none',
              fontWeight: branchWord && !bandText ? 800 : 500,
              ...(branchWord && !bandText ? pillStyle : {}),
            }}
            title={data.full ?? bandText ?? branchWord}
          >
            {branchWord && bandText ? (
              <span style={{
                fontSize: 9.5, fontWeight: 800, borderRadius: 4, padding: '0 5px', flexShrink: 0,
                border: '1px solid', ...pillStyle,
              }}>{branchWord}</span>
            ) : null}
            <span>{bandText ?? branchWord}</span>
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

const nodeTypes = { sfState: SFStateNode, sfDecision: SFDecisionNode, sfFault: SFFaultNode, sfLoopCap: SFLoopCap };
const edgeTypes = { sfEdge: SFEdge };

/** model: buildFlowModel output — items: [{line, verb, device, detail,
 *  cond?, tag?} | {decide: {title, detail, cond, tag}} | {loopEnd: {label,
 *  cond, tag}} | {branch: {decision, cond?, tag?, branches: [{label,
 *  items, rejoins, faults}]}}]. mode 'seq' | 'recovery'. */
function deriveGraph(model, mode, lane) {
  const nodes = [];
  const edges = [];
  let idc = 0;
  let stepNo = 0;
  const nid = () => `sf${idc++}`;
  const edge = (a, b, { text = null, tag = null, branch = false, branchLabel = null, sh = 'out-bottom', th = 'in-top', dotted = false } = {}) => {
    edges.push({
      id: `e${a}-${b}-${edges.length}`, source: a, target: b, sourceHandle: sh, targetHandle: th,
      type: 'sfEdge',
      style: { stroke: 'var(--color-border, #b8c4d0)', strokeWidth: 1.6, ...(dotted ? { strokeDasharray: '5 4' } : {}) },
      markerEnd: 'url(#sf-arrow)',
      data: { text, tag, branch, branchLabel },
    });
  };
  const pushStep = (it, x, y) => {
    const id = nid();
    stepNo += 1;
    nodes.push({
      id, type: 'sfState', position: { x, y }, draggable: false, connectable: false, selectable: false,
      data: { n: stepNo, title: it.title, verb: it.verb, device: it.device, detail: it.detail, devType: it.devType ?? null, kind: it.kind ?? null, estH: stepH(it), lane },
    });
    return id;
  };

  let prev = null;
  let prevMeta = null; // pending edge label for the NEXT connection
  let y = 0;
  const mainX = mode === 'recovery' ? 0 : 0;
  const items = model.items ?? [];
  items.forEach((it) => {
    // Grid tokens outside the lane render (recovery fallback): a decide
    // draws as a pill in line; a loopEnd draws as a plain-word cap.
    if (it.decide) {
      const did = nid();
      nodes.push({
        id: did, type: 'sfDecision', position: { x: mainX, y }, draggable: false, connectable: false, selectable: false,
        data: { title: it.decide.title, detail: it.decide.detail },
      });
      if (prev) edge(prev, did, { text: it.decide.cond ?? prevMeta?.cond, tag: it.decide.tag ?? prevMeta?.tag });
      prevMeta = null;
      prev = did;
      y += DEC_H + GAP_Y;
      return;
    }
    if (it.loopEnd) {
      const cid = nid();
      nodes.push({
        id: cid, type: 'sfLoopCap', position: { x: mainX + 20, y }, draggable: false, connectable: false, selectable: false,
        data: { label: it.loopEnd.label },
      });
      if (prev) edge(prev, cid, { text: it.loopEnd.cond, tag: it.loopEnd.tag });
      prev = null;
      prevMeta = null;
      y += CAP_H + GAP_Y;
      return;
    }
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
          if (bit.branch || bit.decide || bit.loopEnd) return; // nested decisions: not drawn at this depth
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
          byy += stepH(bit) + GAP_Y;
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
    y += stepH(it) + GAP_Y;
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

/**
 * THE LANE RENDERER (Dan approved drawing, 2026-09-01). Draws models whose
 * items carry Decide/Loop grid tokens:
 *  - Segments split at each loopEnd. Segment 0 is the MAIN cycle; each
 *    later segment is a LANE.
 *  - Lanes attach to main-line decisions in order (the "no" path); once
 *    main decisions are consumed, the next lane is the SECOND-LEVEL lane
 *    (farther right), fed by every lane-internal decision still dangling
 *    (their "yes" path — retry exhausted).
 *  - Every lane ends in a PLAIN-WORD cap. The main loopEnd becomes the one
 *    left-corridor dotted edge, targeted at the step its label names.
 *  - No edge ever crosses a node: lane tops sit below their feeders, a
 *    second lane stacked in a column enters from the LEFT via the empty
 *    corridor, and second-level feeds travel above the (empty) column head.
 */
function deriveLaneGraph(model, lane) {
  const nodes = [];
  const edges = [];
  let idc = 0;
  let stepNo = 0;
  const nid = () => `sf${idc++}`;
  const edge = (a, b, { text = null, tag = null, branchLabel = null, sh = 'out-bottom', th = 'in-top', dotted = false } = {}) => {
    edges.push({
      id: `e${a}-${b}-${edges.length}`, source: a, target: b, sourceHandle: sh, targetHandle: th,
      type: 'sfEdge',
      style: { stroke: 'var(--color-border, #b8c4d0)', strokeWidth: 1.6, ...(dotted ? { strokeDasharray: '5 4' } : {}) },
      markerEnd: 'url(#sf-arrow)',
      data: { text, tag, branchLabel },
    });
  };
  const pushStep = (it, x, y) => {
    const id = nid();
    stepNo += 1;
    nodes.push({
      id, type: 'sfState', position: { x, y }, draggable: false, connectable: false, selectable: false,
      data: { n: stepNo, title: it.title, verb: it.verb, device: it.device, detail: it.detail, devType: it.devType ?? null, kind: it.kind ?? null, estH: stepH(it), lane },
    });
    return id;
  };
  const pushDecide = (d, x, y) => {
    const id = nid();
    nodes.push({
      id, type: 'sfDecision', position: { x, y }, draggable: false, connectable: false, selectable: false,
      data: { title: d.title, detail: d.detail },
    });
    return id;
  };

  const items = model.items ?? [];
  const segs = [];
  let cur = [];
  for (const it of items) { cur.push(it); if (it.loopEnd) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const main = segs[0] ?? [];
  const laneSegs = segs.slice(1);

  // ── the main cycle, straight down at x = 0
  let prev = null;
  let y = 0;
  let pendingBranch = null; // 'yes' rides the edge out of a decision
  let mainLoop = null;
  const mainDecides = [];
  const mainSteps = [];
  for (const it of main) {
    if (it.loopEnd) { mainLoop = { ...it.loopEnd, from: prev }; continue; }
    if (it.branch) continue; // nested shapes don't mix with the token grid
    if (it.decide) {
      const id = pushDecide(it.decide, 0, y);
      if (prev) edge(prev, id, { text: it.decide.cond, tag: it.decide.tag, branchLabel: pendingBranch });
      mainDecides.push({ id, y, consumed: false });
      prev = id;
      pendingBranch = 'yes';
      y += DEC_H + GAP_Y;
      continue;
    }
    const id = pushStep(it, 0, y);
    if (prev) edge(prev, id, { text: it.cond, tag: it.tag, branchLabel: pendingBranch });
    pendingBranch = null;
    mainSteps.push({ id, title: String(it.title ?? '') });
    prev = id;
    y += stepH(it) + GAP_Y;
  }
  // The main next-cycle loop — THE only left-corridor edge. Its target is
  // the step the plain-words label names ("back to Extend Horizontal
  // Shuttle" → that node), else the first step.
  if (mainLoop?.from && mainSteps.length) {
    const tt = String(mainLoop.label ?? '').match(/back to\s+(?:the\s+)?(.+)$/i)?.[1]?.trim().toLowerCase();
    const tgt = (tt && mainSteps.find((n) => n.title.toLowerCase().includes(tt) || tt.includes(n.title.toLowerCase()))) ?? mainSteps[0];
    if (tgt && tgt.id !== mainLoop.from) {
      edge(mainLoop.from, tgt.id, {
        sh: 'out-left', th: 'in-left', dotted: true,
        text: [mainLoop.cond, mainLoop.label].filter(Boolean).join(' · '),
      });
    }
  }

  // ── lanes: retry lanes beside the main line, second level farther right
  const colBottom = {};
  const dangling = []; // lane-internal decides whose "yes" awaits a target
  for (const seg of laneSegs) {
    const body = seg.filter((x) => !x.loopEnd && !x.branch);
    const loopEnd = seg.find((x) => x.loopEnd)?.loopEnd ?? null;
    if (!body.length && !loopEnd) continue;
    let feeders;
    let level;
    const mfree = mainDecides.find((d) => !d.consumed);
    if (mfree) {
      mfree.consumed = true;
      feeders = [{ id: mfree.id, y: mfree.y, label: 'no' }];
      level = 1;
    } else if (dangling.length) {
      feeders = dangling.splice(0).map((d) => ({ id: d.id, y: d.y, label: 'yes' }));
      level = 2;
    } else {
      feeders = prev ? [{ id: prev, y: Math.max(0, y - EST_H - GAP_Y), label: null }] : [];
      level = 1;
    }
    const x = level * COL_X;
    const firstInCol = colBottom[level] === undefined;
    const feedMaxY = feeders.length ? Math.max(...feeders.map((f) => f.y)) : 0;
    let ly = firstInCol
      ? feedMaxY + DEC_H + GAP_Y
      : Math.max(feedMaxY + DEC_H + GAP_Y, colBottom[level] + LANE_VGAP + GAP_Y);
    let bprev = null;
    let first = true;
    for (const it of body) {
      const id = it.decide ? pushDecide(it.decide, x, ly) : pushStep(it, x, ly);
      const meta = it.decide ?? it;
      if (first) {
        for (const f of feeders) {
          edge(f.id, id, {
            sh: 'out-right',
            th: firstInCol ? 'in-top' : 'in-left',
            branchLabel: f.label,
            text: meta.cond ?? null,
            tag: meta.tag ?? null,
          });
        }
        first = false;
      } else if (bprev) {
        edge(bprev, id, { text: meta.cond ?? null, tag: meta.tag ?? null });
      }
      if (it.decide) dangling.push({ id, y: ly });
      bprev = id;
      ly += (it.decide ? DEC_H : stepH(it)) + GAP_Y;
    }
    // Plain-word branch-end cap — the loop point is the label, never a
    // routed return line.
    if (loopEnd) {
      const cid = nid();
      nodes.push({
        id: cid, type: 'sfLoopCap', position: { x: x + 20, y: ly }, draggable: false, connectable: false, selectable: false,
        data: { label: loopEnd.label },
      });
      if (bprev) edge(bprev, cid, { text: loopEnd.cond, tag: loopEnd.tag });
      else for (const f of feeders) edge(f.id, cid, { sh: 'out-right', th: firstInCol ? 'in-top' : 'in-left', branchLabel: f.label });
      ly += CAP_H + GAP_Y;
    }
    colBottom[level] = ly - GAP_Y;
  }
  return { nodes, edges };
}

/** Natural (zoom-1) bounds of the derived graph, from the layout estimates. */
function graphBounds(graph) {
  let maxX = 0; let maxY = 0; let minX = 0;
  for (const n of graph.nodes) {
    const w = n.type === 'sfFault' ? 120 : n.type === 'sfLoopCap' ? 240 : NODE_W;
    const h = n.type === 'sfDecision' ? DEC_H : n.type === 'sfLoopCap' ? CAP_H : (n.data?.estH ?? EST_H);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
    minX = Math.min(minX, n.position.x);
  }
  // Left corridor (the drawn loop return) + label air on the right.
  return { w: Math.max(320, maxX - minX + 170), h: Math.max(140, maxY + 30) };
}

function SFInner({ model, mode, lane, storageKey }) {
  const rf = useReactFlow();
  const graph = useMemo(() => {
    const hasTokens = (model.items ?? []).some((it) => it?.decide || it?.loopEnd);
    return hasTokens ? deriveLaneGraph(model, lane) : deriveGraph(model, mode, lane);
  }, [model, mode, lane]);
  const bounds = useMemo(() => graphBounds(graph), [graph]);
  // READABLE FIRST (Dan, 2026-09-01: "where did our zoom go?"): default is
  // ACTUAL SIZE — v1-size nodes, the card grows vertically as needed and
  // scrolls horizontally in its own container when lanes exceed the width.
  // Never fit-shrunk to minuscule. Choice persists per draft/card.
  const LS_KEY = `slb.sheetflow.zoom.${storageKey ?? 'default'}`;
  const [view, setView] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
      if (v && typeof v.z === 'number') return { fit: !!v.fit, z: Math.min(2, Math.max(0.3, v.z)) };
    } catch { /* fresh default */ }
    return { fit: false, z: 1 };
  });
  const setViewPersist = (v) => {
    setView(v);
    try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* advisory */ }
  };
  const outerRef = useRef(null);
  const wrapRef = useRef(null);
  const [sized, setSized] = useState(false);
  const [outerW, setOuterW] = useState(0);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 50) { setOuterW(r.width); setSized(true); }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const z = view.fit ? Math.min(1, Math.max(0.3, ((outerW || 600) - 12) / bounds.w)) : view.z;
  // ctrl+scroll zoom (native non-passive listener — preventDefault needed).
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setViewPersist({ fit: false, z: Math.min(2, Math.max(0.3, (view.fit ? z : view.z) * (e.deltaY < 0 ? 1.15 : 0.87))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  // DETERMINISTIC VIEWPORT: the zoom is OURS, not fitView's guess — set it
  // explicitly whenever the effective zoom or graph changes (fitView reads
  // container dims through RF's own observer, which misses resizes in
  // hidden/background panes — the "no zoom" bug).
  useEffect(() => {
    if (!sized) return undefined;
    const apply = () => { try { rf.setViewport({ x: Math.round(130 * z), y: 10, zoom: z }, { duration: 0 }); } catch { /* unmounted */ } };
    const t1 = setTimeout(apply, 120);
    const t2 = setTimeout(apply, 450);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [z, bounds.w, bounds.h, sized, rf]);
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
      try { rf.fitView({ padding: 0.03, minZoom: 0.05, maxZoom: 2 }); } catch { /* unmounted */ }
      clearInterval(t);
    }, 120);
    return () => clearInterval(t);
  }, [sized, graph, rf, storeApi]);
  // ACTUAL-SIZE CANVAS: the inner surface is the graph at zoom z; the outer
  // container scrolls horizontally (its own overflow — never the page) and
  // GROWS vertically to whatever the sequence needs (no internal v-scroll).
  const innerW = view.fit ? '100%' : Math.max(Math.round(bounds.w * z), 300);
  const innerH = Math.max(160, Math.round(bounds.h * z) + 16);
  const btn = {
    border: '1px solid var(--color-border, #cbd5e1)', borderRadius: 5, background: '#fff',
    color: 'var(--color-text-muted, #5a6a7e)', fontSize: 11, fontWeight: 700,
    padding: '1px 7px', cursor: 'pointer', lineHeight: 1.6,
  };
  return (
    <div ref={outerRef} data-testid="sheetflow-scroller" data-zoom-mode={view.fit ? 'fit' : view.z === 1 ? 'default' : 'custom'} style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}>
      {/* Zoom controls (Dan, 2026-09-01: "where did our zoom go?") */}
      <div data-testid="sheetflow-zoom" style={{ position: 'sticky', left: 0, float: 'right', zIndex: 5, display: 'inline-flex', gap: 4, padding: '2px 2px 0 0' }}>
        <button type="button" style={btn} title="Zoom out" onClick={() => setViewPersist({ fit: false, z: Math.max(0.3, z * 0.8) })}>−</button>
        <button type="button" style={btn} title="Zoom in" onClick={() => setViewPersist({ fit: false, z: Math.min(2, z * 1.25) })}>+</button>
        <button type="button" style={{ ...btn, ...(view.fit ? { color: '#1574c4', borderColor: '#1574c4' } : {}) }} title="Fit the whole flow to the card width" onClick={() => setViewPersist({ fit: true, z: 1 })}>Fit</button>
        <button type="button" style={{ ...btn, ...(!view.fit && view.z === 1 ? { color: '#1574c4', borderColor: '#1574c4' } : {}) }} title="Actual size (scrolls sideways when wide)" onClick={() => setViewPersist({ fit: false, z: 1 })}>1:1</button>
      </div>
      <div ref={wrapRef} style={{ width: innerW, height: innerH }}>
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
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.03, minZoom: 0.05, maxZoom: 2 }}
          minZoom={0.05}
          maxZoom={2}
        />
      </div>
    </div>
  );
}

export function SheetFlow({ model, mode = 'seq', lane = 'main', storageKey = null }) {
  if (!model?.items?.length) return null;
  return (
    <ReactFlowProvider>
      <SFInner model={model} mode={mode} lane={lane} storageKey={storageKey} />
    </ReactFlowProvider>
  );
}
