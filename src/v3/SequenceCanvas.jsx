/**
 * SequenceCanvas.jsx — v3: the v1 CANVAS as the SEQUENCE section of the
 * station sheet, per machine (Dan, 2026-09-02).
 *
 *  - One source of truth: the machine's SM nodes/edges ARE the sequence. On
 *    first open the approved structured steps migrate ONCE into canvas
 *    nodes/edges (sequenceSm.ensureMachineSm); after that the canvas is
 *    authoritative.
 *  - Fully interactive v1 editing: StateNode/DecisionNode/RoutableEdge,
 *    ConnectMenu, branches, retries, straighten/re-space/QA — everything
 *    Canvas.jsx already does. The device sidebar edits the SAME sm.devices
 *    the sheet's device cards render (onDevicesChanged → sheet merge).
 *  - Sized generously: the section grows with the diagram's extent; pan/zoom
 *    inside. React Flow math stays exact under the app scale because
 *    .canvas-wrapper is the un-zoom island (v2.css).
 *  - "Expand ↗" opens the same canvas full-window (portal overlay) with the
 *    device sidebar + properties panel; closing returns to the sheet with the
 *    edits intact (same store, same SM).
 *  - The canvas reads the store's ACTIVE SM (Canvas/StateNode/DeviceSidebar
 *    all key off activeSmId), so exactly ONE machine's canvas is live at a
 *    time; the other machines show a one-click "Open canvas" placeholder.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Canvas } from '../components/Canvas.jsx';
import { DeviceSidebar } from '../components/DeviceSidebar.jsx';
import { PropertiesPanel } from '../components/PropertiesPanel.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ensureMachineSm, findMachineSm } from './sequenceSm.js';
import { layoutBranchDiagram, applyBranchLayout, estimateNodeWidth } from '../lib/branchLayout.mjs';
import './v3.css';

// READABLE-FIRST (Dan, 2026-09-01 lane-render supersession): default node
// size is v1-readable (zoom 1), the section GROWS vertically with the diagram
// — never fit-shrunk. Width pans inside the canvas when it is wider.
function extentHeight(nodes) {
  const ys = (nodes ?? []).map((n) => n.position?.y ?? 0);
  if (!ys.length) return 520;
  const span = Math.max(...ys) - Math.min(...ys);
  return Math.max(520, span + 420);
}

/** FIRST-OPEN MEASURED RE-LAYOUT: the migration laid the diagram out on
 *  estimated node heights; once THIS canvas has measured the real nodes
 *  (Home Conditions is tall), run the same column re-layout the canvas's
 *  Re-layout button runs — from inside this provider, so the measurements
 *  are this canvas's own — ONCE, then stamp it so it never re-runs. */
function MeasuredRelayout({ smId, enabled }) {
  const { getViewport } = useReactFlow();
  useEffect(() => {
    if (!enabled || !smId) return undefined;
    let tries = 0;
    let lastSig = null;
    // RENDERED boxes, not RF's `measured` — the Home node's entry pills and
    // Home Conditions rows extend the drawn box past what RF records, and
    // that is exactly the height the next node must clear.
    const sample = () => {
      const zoom = getViewport().zoom || 1;
      const m = new Map();
      for (const el of document.querySelectorAll('.v3-seq .react-flow__node[data-id]')) {
        const r = el.getBoundingClientRect();
        m.set(el.getAttribute('data-id'), { h: r.height / zoom, w: r.width / zoom });
      }
      return m;
    };
    const tick = () => {
      const dims = sample();
      const measured = dims.size > 0 && [...dims.values()].every((d) => d.h > 0);
      // Node content mounts in stages (Home Conditions rows, entry pills) —
      // wait until two consecutive samples agree before trusting heights.
      const sig = [...dims.values()].map((d) => Math.round(d.h)).join(',');
      const stable = measured && sig === lastSig;
      lastSig = sig;
      if (!stable && tries++ < 24) { t = setTimeout(tick, 250); return; }
      const s = useDiagramStore.getState();
      const cur = s.project?.stateMachines?.find((m) => m.id === smId);
      if (!cur) return;
      try {
        const layout = layoutBranchDiagram(cur.nodes ?? [], cur.edges ?? [], {
          getHeight: (n) => dims.get(n.id)?.h ?? 80,
          getWidth: (n) => dims.get(n.id)?.w ?? estimateNodeWidth(n),
        });
        const applied = layout.changed ? applyBranchLayout(cur.nodes ?? [], cur.edges ?? [], layout) : { nodes: cur.nodes, edges: cur.edges };
        s.updateStateMachine(smId, {
          nodes: applied.nodes, edges: applied.edges,
          machineSpec: { ...(cur.machineSpec ?? {}), v3: { ...(cur.machineSpec?.v3 ?? {}), measuredLayoutAt: new Date().toISOString() } },
        });
      } catch (e) {
        console.warn('[v3] measured re-layout skipped:', e);
      }
    };
    let t = setTimeout(tick, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smId, enabled]);
  return null;
}

/** After Canvas's own fitView (50ms timer on SM switch), pin the viewport at
 *  zoom 1 with the diagram's top-left in view — readable by default. */
function ReadableZoom({ smId, nodes, layoutStamp = null }) {
  const { setViewport } = useReactFlow();
  useEffect(() => {
    const xs = (nodes ?? []).map((n) => n.position?.x ?? 0);
    const ys = (nodes ?? []).map((n) => n.position?.y ?? 0);
    if (!xs.length) return undefined;
    const t = setTimeout(() => {
      // 120px of headroom: the Home node's entry pills draw ABOVE its box.
      setViewport({ x: 60 - Math.min(...xs), y: 140 - Math.min(...ys), zoom: 1 }, { duration: 0 });
    }, 600);
    return () => clearTimeout(t);
    // Re-pin when the machine changes or the first-open measured layout
    // lands (it re-fits the canvas) — never on every node drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smId, layoutStamp]);
  return null;
}

export function SequenceCanvas({
  smId = null, draftId, entry, model, sheetDevices, stationName, stationNumber, isPrimary = true,
  onDevicesChanged = null, testId = 'v3-sequence-canvas', autoActivate = false,
}) {
  const project = useDiagramStore((s) => s.project);
  const activeSmId = useDiagramStore((s) => s.activeSmId);
  const setActiveSm = useDiagramStore((s) => s.setActiveSm);
  const [expanded, setExpanded] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  // Resolve (create + migrate on first open) in an effect — never a store
  // write during render.
  const found = findMachineSm(project, { smId, draftId, machineKey: entry?.key });
  const resolvedId = found?.id ?? null;
  const ensuringRef = useRef(false);
  useEffect(() => {
    if (resolvedId && (found?.machineSpec?.canvasAuthoritative || (found?.edges?.length ?? 0) > 0)) return;
    if (ensuringRef.current) return;
    ensuringRef.current = true;
    try {
      ensureMachineSm({ smId, draftId, entry, model, sheetDevices, stationName, stationNumber, isPrimary });
    } catch (e) {
      console.error('[v3] sequence migration failed:', e);
    } finally {
      ensuringRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId, entry?.key, draftId]);

  const sm = found;
  const isActive = !!resolvedId && activeSmId === resolvedId;
  // The sheet filtered to THIS machine (its chip selected) → its canvas is
  // the live one without an extra click.
  useEffect(() => {
    if (autoActivate && resolvedId && activeSmId !== resolvedId) setActiveSm(resolvedId);
  }, [autoActivate, resolvedId, activeSmId, setActiveSm]);
  const nodeCount = sm?.nodes?.length ?? 0;
  const edgeCount = sm?.edges?.length ?? 0;
  const height = useMemo(() => extentHeight(sm?.nodes), [sm?.nodes]);

  // Two-way devices: sidebar/modal edits on sm.devices flow back to the
  // sheet's device cards.
  const prevDevicesRef = useRef(sm?.devices);
  useEffect(() => {
    if (!sm) return;
    if (prevDevicesRef.current === undefined) { prevDevicesRef.current = sm.devices; return; }
    if (prevDevicesRef.current !== sm.devices) {
      prevDevicesRef.current = sm.devices;
      if (onDevicesChanged) onDevicesChanged(sm);
    }
  }, [sm?.devices, sm, onDevicesChanged]);

  const needsMeasuredLayout = !!sm?.machineSpec?.v3?.migratedAt && !sm?.machineSpec?.v3?.measuredLayoutAt;

  // Esc closes the full-window canvas.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const activate = () => { if (resolvedId && !isActive) setActiveSm(resolvedId); };
  const title = entry?.name ?? sm?.displayName ?? 'Sequence';

  const bar = (
    <div className="v3-seq__bar" data-testid={`${testId}-bar`}>
      <b>{title}</b>
      <span>{nodeCount} state{nodeCount === 1 ? '' : 's'} · {edgeCount} edge{edgeCount === 1 ? '' : 's'}</span>
      {sm?.machineSpec?.v3?.migratedAt && (
        <span title={`Migrated once from the approved steps ${sm.machineSpec.v3.migratedAt}; the canvas is the sequence now`} style={{ color: '#5a6a7e' }}>
          · canvas is the source
        </span>
      )}
      <span className="v3-seq__spacer" />
      {isActive && !expanded && (
        <button type="button" className="v3-seq__btn" onClick={() => setShowDevices((v) => !v)} data-testid={`${testId}-devices-toggle`}>
          {showDevices ? 'Hide devices' : 'Devices'}
        </button>
      )}
      {!isActive && (
        <button type="button" className="v3-seq__btn v3-seq__btn--primary" onClick={activate} data-testid={`${testId}-open`}>
          Open canvas
        </button>
      )}
      {isActive && !expanded && (
        <button type="button" className="v3-seq__btn v3-seq__btn--primary" onClick={() => setExpanded(true)} data-testid={`${testId}-expand`}>
          Expand ↗
        </button>
      )}
    </div>
  );

  if (!resolvedId) {
    return (
      <div className="v3-seq" data-testid={testId}>
        {bar}
        <div className="v3-seq__placeholder">Preparing the canvas…</div>
      </div>
    );
  }

  return (
    <div className="v3-seq" data-testid={testId} data-sm-id={resolvedId} data-active={isActive ? 'true' : 'false'}>
      {bar}
      {!isActive && (
        <div className="v3-seq__placeholder">
          <span>{nodeCount} states drawn — open this machine's canvas to edit.</span>
          <button type="button" className="v3-seq__btn v3-seq__btn--primary" onClick={activate}>Open canvas</button>
        </div>
      )}
      {isActive && !expanded && (
        <div className="v3-seq__body" style={{ height }} onMouseDownCapture={activate}>
          <ReactFlowProvider>
            {showDevices && <DeviceSidebar />}
            <Canvas hideHeader />
            <ReadableZoom smId={resolvedId} nodes={sm?.nodes} layoutStamp={sm?.machineSpec?.v3?.measuredLayoutAt ?? null} />
            <MeasuredRelayout smId={resolvedId} enabled={needsMeasuredLayout} />
          </ReactFlowProvider>
        </div>
      )}
      {isActive && expanded && (
        <div className="v3-seq__placeholder">
          <span>Editing full-window — close it to return here. Edits are live in this sheet.</span>
        </div>
      )}
      {isActive && expanded && createPortal(
        <div className="v3-seq-full" data-testid="v3-canvas-expanded">
          <div className="v3-seq-full__bar">
            <b>{stationName ? `${stationName} — ` : ''}{title}</b>
            <span style={{ opacity: 0.8 }}>sequence canvas · {nodeCount} states</span>
            <span className="v3-seq__spacer" />
            <button type="button" className="v3-seq__btn" onClick={() => setExpanded(false)} data-testid="v3-canvas-collapse">
              Close ↙ back to the sheet
            </button>
          </div>
          <div className="v3-seq-full__body">
            <ReactFlowProvider>
              <DeviceSidebar />
              <Canvas hideHeader />
              <PropertiesPanel />
            </ReactFlowProvider>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
