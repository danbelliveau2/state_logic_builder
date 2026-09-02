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
import { create } from 'zustand';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Canvas } from '../components/Canvas.jsx';
import { DeviceSidebar } from '../components/DeviceSidebar.jsx';
import { PropertiesPanel } from '../components/PropertiesPanel.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ensureMachineSm, findMachineSm, redraftMachineSm } from './sequenceSm.js';
import { layoutBranchDiagram, applyBranchLayout, estimateNodeWidth } from '../lib/branchLayout.mjs';
import './v3.css';

/** Which SM is open full-window — HOISTED out of the per-machine instance
 *  (Dan, 2026-09-02 Phase A feedback: switch machines ON the canvas). The
 *  sheet filters its machine columns by sheetSmKey, so a switch unmounts the
 *  instance that opened the overlay; the flag must outlive it. Whichever
 *  instance resolves to this id renders the overlay. */
export const useV3Ui = create((set) => ({
  expandedSmId: null,
  setExpandedSmId: (id) => set({ expandedSmId: id ?? null }),
}));

/** Machine chips — the station's machines, the live one highlighted. */
function MachineSwitcher({ machines, activeKey, onPick, dark = false, testId }) {
  if ((machines?.length ?? 0) < 2) return null;
  return (
    <div className={`v3-sw${dark ? ' v3-sw--dark' : ''}`} data-testid={testId} role="tablist" aria-label="State machine">
      {dark && <span className="v3-sw__label">Machine:</span>}
      {machines.map((m) => {
        const on = m.key === activeKey;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={on}
            className={`v3-sw__chip${on ? ' v3-sw__chip--on' : ''}`}
            data-testid={`${testId}-${m.key}`}
            data-selected={on ? 'true' : 'false'}
            title={on ? `${m.name} — on the canvas now` : `Switch the canvas to ${m.name} (edits here are kept)`}
            onClick={() => { if (!on) onPick(m); }}
          >{m.name}</button>
        );
      })}
    </div>
  );
}

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
      for (const el of document.querySelectorAll('.v3-seq .react-flow__node[data-id], .v3-seq-full .react-flow__node[data-id]')) {
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
  smId = null, draftId, entry, model, steps = null, sheetDevices, stationName, stationNumber, isPrimary = true,
  onDevicesChanged = null, testId = 'v3-sequence-canvas', autoActivate = false,
  // The station's machines for the on-canvas switcher:
  // [{ key, name, smId, entry, getModel(), isPrimary }] + the sheet-chip sync.
  machines = null, onSelectMachine = null,
}) {
  const project = useDiagramStore((s) => s.project);
  const activeSmId = useDiagramStore((s) => s.activeSmId);
  const setActiveSm = useDiagramStore((s) => s.setActiveSm);
  const expandedSmId = useV3Ui((s) => s.expandedSmId);
  const setExpandedSmId = useV3Ui((s) => s.setExpandedSmId);
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
      ensureMachineSm({ smId, draftId, entry, model, steps, sheetDevices, stationName, stationNumber, isPrimary });
    } catch (e) {
      console.error('[v3] sequence migration failed:', e);
    } finally {
      ensuringRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId, entry?.key, draftId]);

  const sm = found;
  const isActive = !!resolvedId && activeSmId === resolvedId;
  const expanded = !!resolvedId && expandedSmId === resolvedId;
  const setExpanded = (v) => setExpandedSmId(v ? resolvedId : null);

  // SWITCH MACHINES ON THE CANVAS: resolve (create + migrate on first open,
  // exactly as the sheet does) SYNCHRONOUSLY, then make it live, keep the
  // overlay open on it, and sync the sheet's machine chip — so the instance
  // that mounts under the new filter finds its SM on its first render (no
  // flash back to the sheet). Edits persist: same store, same SM records.
  const switchTo = (m) => {
    if (!m || m.key === entry?.key) return;
    let id = m.smId ?? findMachineSm(useDiagramStore.getState().project, { draftId, machineKey: m.key })?.id ?? null;
    try {
      id = ensureMachineSm({
        smId: m.smId ?? null, draftId, entry: m.entry ?? m, model: m.getModel ? m.getModel() : m.model, steps: m.entry?.sequenceSteps ?? null,
        sheetDevices, stationName, stationNumber, isPrimary: !!m.isPrimary,
      });
    } catch (e) {
      console.error('[v3] machine switch migration failed:', e);
    }
    if (!id) return;
    setActiveSm(id);
    if (expanded) setExpandedSmId(id);
    if (onSelectMachine) onSelectMachine(m.key);
  };
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
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setExpandedSmId(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const activate = () => { if (resolvedId && !isActive) setActiveSm(resolvedId); };
  const title = entry?.name ?? sm?.displayName ?? 'Sequence';

  // PHASE B — the AI first draft in Dan's shape, on demand: recompile from
  // the sheet's approved steps; the current drawing is kept as a backup.
  const redraft = () => {
    if (!resolvedId) return;
    const n = sm?.nodes?.length ?? 0;
    if (n > 1 && !window.confirm(`Redraft "${title}" from the sheet's approved steps?\n\nThe ${n} states drawn now are kept as a backup on the record (Undo also works).`)) return;
    try {
      redraftMachineSm({ smId: resolvedId, model, steps: steps ?? entry?.sequenceSteps ?? null, isPrimary, machineName: title });
    } catch (e) {
      console.error('[v3] redraft failed:', e);
    }
  };

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
        <MachineSwitcher machines={machines} activeKey={entry?.key} onPick={switchTo} testId={`${testId}-switch`} />
      )}
      {isActive && !expanded && (
        <button type="button" className="v3-seq__btn" onClick={() => setShowDevices((v) => !v)} data-testid={`${testId}-devices-toggle`}>
          {showDevices ? 'Hide devices' : 'Devices'}
        </button>
      )}
      {isActive && !expanded && (
        <button
          type="button"
          className="v3-seq__btn"
          onClick={redraft}
          data-testid={`${testId}-redraft`}
          title="Recompile this machine's canvas from the sheet's approved steps in the v1 grammar (Action / Check with Retry / Wait). Your current drawing is kept as a backup on the record."
        >
          Redraft from sheet
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
            {/* THE WAY BACK — top-left, always visible, unmistakable (Dan). */}
            <button
              type="button"
              className="v3-seq-full__back"
              onClick={() => setExpandedSmId(null)}
              title="Back to the station sheet (Esc) — your edits are already on the sheet"
              data-testid="v3-canvas-collapse"
            >
              ← Back to sheet <kbd>Esc</kbd>
            </button>
            <b>{stationName ? `${stationName} — ` : ''}{title}</b>
            <span style={{ opacity: 0.8 }}>sequence canvas · {nodeCount} states</span>
            <MachineSwitcher machines={machines} activeKey={entry?.key} onPick={switchTo} dark testId="v3-canvas-switch" />
            <span className="v3-seq__spacer" />
            <button type="button" className="v3-seq__btn" onClick={redraft} data-testid="v3-canvas-redraft" title="Recompile this machine's canvas from the sheet's approved steps (current drawing kept as a backup)">
              Redraft from sheet
            </button>
            <button type="button" className="v3-seq__btn" onClick={() => setExpandedSmId(null)} data-testid="v3-canvas-close">
              Close ↙
            </button>
          </div>
          <div className="v3-seq-full__body">
            <ReactFlowProvider>
              <DeviceSidebar />
              <Canvas hideHeader />
              <PropertiesPanel />
              {/* Readable-first here too: a machine opened FIRST from the
                  full-window switcher gets the same zoom-1 pin and one-time
                  measured re-layout the inline canvas gets. */}
              <ReadableZoom smId={resolvedId} nodes={sm?.nodes} layoutStamp={sm?.machineSpec?.v3?.measuredLayoutAt ?? null} />
              <MeasuredRelayout smId={resolvedId} enabled={needsMeasuredLayout} />
            </ReactFlowProvider>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
