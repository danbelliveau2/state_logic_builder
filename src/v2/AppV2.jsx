/**
 * AppV2 — v2 application shell (SDC Engineer-centered workflow).
 *
 * Layout (CSS grid, see v2.css):
 *   ┌──────────────── TopBarV2 (48px) ────────────────┐
 *   │ Stations (260px) │  Canvas + view switcher │ Context (300px) │
 *   └──────────────────────────────────────────────────┘
 *
 * Everything below the shell is REUSED from the classic app:
 *   - useDiagramStore  — same store, same localStorage key, same server API
 *   - Canvas           — full React Flow canvas incl. Normal/Recovery toggle,
 *                        undo/redo keyboard shortcuts (Ctrl+Z / Ctrl+Y are
 *                        wired inside Canvas on window, so v2 gets them free)
 *   - Modals           — JarvisGenerateModal, SpecEditorModal,
 *                        ProjectPickerModal, plus the store-flag modals below
 *
 * Pages (Dan's two-pill model, Aug 23): Spec Sheet | Diagram. The Diagram is
 * ONE page — the mechanical canvas by default, an ON-PAGE "Controls detail"
 * toggle flips to the compiled flowchart (ControlsFlowView), the sub-bar
 * carries Approve and ✨ Generate, and fresh results land in place as the
 * GenerationResultCard. History lives in the SDC Engineer pill. The view state
 * lives in useV2Shell so the compile modal can land the user on the controls
 * detail after a compile finishes.
 */

import { useEffect, useLayoutEffect, useRef, useCallback, Component } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../components/Canvas.jsx';
import { CreateStationPage } from '../components/jarvis/CreateStationPage.jsx';
import { consumeResumeRequest, ensureStationSheetDraft, requestResumeDraft } from '../components/jarvis/createStationDrafts.js';
import { AddDeviceModal } from '../components/modals/AddDeviceModal.jsx';
import { ActionModal } from '../components/modals/ActionModal.jsx';
import { ProjectManagerModal } from '../components/modals/ProjectManagerModal.jsx';
import { RecipeManagerModal } from '../components/modals/RecipeManagerModal.jsx';
import { VersionBadge } from '../components/VersionBadge.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { initStandardsLibrary } from '../lib/standardsLibrary.js';
import { exportProjectJSON } from '../lib/projectApi.js';
import { TopBarV2 } from './TopBarV2.jsx';
import { NewBuildBar } from './NewBuildBar.jsx';
import { StationsPanel } from './StationsPanel.jsx';
import { TREE_WIDTH } from './FeatureTreeV2.jsx';
import { StartScreen } from './StartScreen.jsx';
import { ControlsFlowView } from './ControlsFlowView.jsx';
import { GenerationResultCard } from './GenerationResultCard.jsx';
import { DiagramSubBar } from './DiagramSubBar.jsx';
import { CompileSequenceModal } from './CompileSequenceModal.jsx';
import { ServoValuesTable } from './ServoValuesTable.jsx';
import { StationBanner } from './StationBanner.jsx';
import { ProjectHomePage } from './ProjectHomePage.jsx';
import { JarvisGenerateModal } from '../components/modals/JarvisGenerateModal.jsx';
import { useV2Shell } from './useV2Shell.js';
import './projectHome.css';

// ── Error Boundary (same behavior as classic App) ───────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) {
    console.error('AppV2 crash caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, maxWidth: 600, margin: '60px auto', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ color: '#b83c3c', fontSize: 22 }}>Something went wrong</h1>
          <p style={{ color: '#5a6a7e', marginTop: 8 }}>
            The v2 shell crashed during rendering. Try refreshing, or open the
            classic app at <a href="/">/</a> — projects are shared between both.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 20px', background: '#1574C4', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >Reload</button>
          <pre style={{ marginTop: 20, padding: 16, background: '#1e293b', color: '#f87171', borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 300 }}>
            {this.state.error?.toString()}
            {'\n\n'}
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// SCOPED BOUNDARY (Dan's shell crash, 2026-08-30): a render exception in ONE
// surface must never take the whole shell down — the sheet shows an inline
// error card, the rest of the app keeps working, HIS DRAFT DATA IS SAFE
// (drafts persist on every change; a crash loses nothing).
class SurfaceBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(`[${this.props.label}] render crash:`, error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: '40px auto', fontFamily: 'system-ui, sans-serif', border: '1px solid #d4a0a0', borderRadius: 8, background: '#fdf7f7' }}>
        <div style={{ fontWeight: 800, color: '#b83c3c', fontSize: 15 }}>This page hit a rendering error</div>
        <div style={{ fontSize: 12.5, color: '#5a6a7e', margin: '6px 0 12px' }}>
          Your draft is saved — nothing is lost. Reload to pick up where you left off.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '7px 18px', background: '#1574C4', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >Reload</button>
        <pre style={{ marginTop: 12, padding: 10, background: '#1e293b', color: '#f87171', borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 160 }}>
          {String(this.state.error)}
        </pre>
      </div>
    );
  }
}

// (The view switcher, Spec Sheet|Diagram toggle, Normal|Recovery, and the
//  star all live in the persistent StationBanner now — Dan: "on a banner
//  that STAYS no matter what you're looking at". See StationBanner.jsx.)

// (The bottom flow-guidance bar is gone — its stage logic became THE one
//  two-pill banner (StationBanner); Generate lives on the Diagram sub-bar.)

export function AppV2() {
  const store = useDiagramStore();
  const {
    showNewSmModal,
    showAddDeviceModal,
    showEditDeviceModal,
    showActionModal,
    showProjectManager,
    showRecipeManager,
  } = store;

  // View lives in the v2 shell store so the compile modal can land the user
  // on the Diagram page's Controls detail when a compile finishes.
  const view = useV2Shell(s => s.view);

  // ── Station banner / sheet state ─────────────────────────────────────────
  // (Normal|Recovery is gone from the v2 UI — Dan; Canvas keeps its own local
  // recovery state untouched.) sheetLinkedSmId marks the embedded
  // built-station sheet (vs the full-viewport "+ New" fresh-draft flow) and
  // is cleared whenever the sheet closes.
  const sheetLinkedSmId = useV2Shell(s => s.sheetLinkedSmId);
  // Fresh "+ Add Station" create flow (full-viewport page). While it's open
  // the station banner + diagram sub-bar hide — there IS no station context.
  const freshCreateOpen = showNewSmModal && !sheetLinkedSmId;
  // Shared Generate-modal mount — opened from the top-right pipeline button
  // (the old mount rode inside the removed Build ▾ menu).
  const generateOpen = useV2Shell(s => s.generateOpen);
  useEffect(() => {
    // TWO-STORE GAP GUARD (Dan's reload trap, 2026-08-31): every open-sheet
    // path sets the shell's sheetLinkedSmId (one store) then openNewSmModal
    // (another store) — this cleanup used to fire IN the gap and wipe the
    // linkage, so the sheet mounted full-viewport with no banner and no way
    // back. Clear only if still inconsistent a tick later.
    if (!showNewSmModal && useV2Shell.getState().sheetLinkedSmId) {
      const t = setTimeout(() => {
        if (!useDiagramStore.getState().showNewSmModal && useV2Shell.getState().sheetLinkedSmId) {
          useV2Shell.getState().setSheetLinkedSmId(null);
        }
      }, 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [showNewSmModal]);

  // Clean-slate start screen (all project tabs closed).
  const home = useV2Shell(s => s.home);
  const leaveHome = useV2Shell(s => s.leaveHome);
  const currentFilename = useDiagramStore(s => s.currentFilename);
  // Auto-leave home the moment any project opens (picker, recent list,
  // file import, create) — currentFilename is the single source of truth.
  useEffect(() => {
    if (home && currentFilename) leaveHome();
  }, [home, currentFilename, leaveHome]);

  // ── PROJECT HOME navigation (Dan, Aug 24) ────────────────────────────────
  // Landing view: opening/switching a project lands on the project home —
  // the machine overview with the stations grid. Picking a station anywhere
  // (left tree, home card) leaves the home for that station. Refs seed from
  // the mount values so a reload mid-project honors the ?page deep link
  // instead of forcing home.
  const projectHomeOpen = useV2Shell(s => s.projectHomeOpen);
  const activeSmId = useDiagramStore(s => s.activeSmId);
  const navRef = useRef({ filename: currentFilename, smId: activeSmId });
  // useLayoutEffect (not useEffect) so the old project's station-scoped state
  // is cleared BEFORE the browser paints the new project — otherwise the old
  // station's embedded sheet flashes (or sticks — Dan's Aug 24 screenshot:
  // "Magnet Dial v3" opened showing the previous project's ServoPNP sheet).
  useLayoutEffect(() => {
    const prev = navRef.current;
    navRef.current = { filename: currentFilename, smId: activeSmId };
    if (currentFilename && prev.filename !== currentFilename) {
      // PROJECT SWITCH/CREATE — the shell's station-scoped state all belongs
      // to the OLD project; none of it may survive into the new one:
      //  - sheetLinkedSmId: a foreign SM id would keep the embedded sheet
      //    mounted with the old station's spec (the leak in Dan's screenshot)
      //  - pending draft-resume handoff (sessionStorage): a foreign draftId
      //  - showNewSmModal: keeps CreateStationPage (fresh OR embedded)
      //    mounted across the switch — its component state and autosave
      //    would write the old project's draft under the NEW project's key.
      //    (createNewProject sets it true for the classic shell; v2 lands on
      //    the Project Home instead — same as StartScreen's create path.)
      //  - view: reset the Diagram page to the Sequence view.
      consumeResumeRequest();
      const shell = useV2Shell.getState();
      if (shell.sheetLinkedSmId) shell.setSheetLinkedSmId(null);
      shell.setView('mech');
      if (useDiagramStore.getState().showNewSmModal) {
        useDiagramStore.setState({ showNewSmModal: false });
      }
      shell.openProjectHome();
    } else if (activeSmId && prev.smId !== activeSmId && useV2Shell.getState().projectHomeOpen) {
      useV2Shell.getState().closeProjectHome();
    }
  }, [currentFilename, activeSmId]);

  // (declared BEFORE the landing effect below — dep arrays evaluate at
  // render; a later declaration is the TDZ crash class.)
  const smCount = useDiagramStore(s => s.project?.stateMachines?.length ?? 0);

  // CASCADE PROJECTS LAND ON THE SHEET (Dan, 2026-08-31: reload dropped him
  // on the classic canvas again). App open / reload / tab switch: a project
  // with cascade-built stations lands on the STATION SHEET (single station)
  // or the machine homepage (multiple). The classic canvas opens ONLY by an
  // explicit navigation this session — never as a restored default. Classic
  // v1-era projects (no cascadeState anywhere) are untouched.
  const landedRef = useRef(null);
  useEffect(() => {
    if (!currentFilename || home) return;
    if (landedRef.current === currentFilename) return;
    const proj = useDiagramStore.getState().project;
    if (!proj?.stateMachines) return; // not restored yet — effect re-runs
    landedRef.current = currentFilename;
    const cascadeSms = proj.stateMachines.filter(sm => sm?.machineSpec?.cascadeState);
    try { window.__slbCascadeProject = cascadeSms.length > 0; } catch { /* gate hint */ }
    if (!cascadeSms.length) return;
    const shell = useV2Shell.getState();
    if (cascadeSms.length === 1 && proj.stateMachines.length === 1) {
      const sm = cascadeSms[0];
      try {
        const draft = ensureStationSheetDraft(useDiagramStore.getState(), sm);
        requestResumeDraft(draft.draftId);
        shell.setSheetLinkedSmId(sm.id);
        useDiagramStore.getState().openNewSmModal();
        shell.closeProjectHome();
      } catch { shell.openProjectHome(); }
    } else {
      shell.openProjectHome();
    }
  }, [currentFilename, home, smCount]);

  // ZERO-STATION / NO-SELECTION LANDING (Dan, 2026-08-26): the classic canvas
  // empty state is dead in v2 — a project with no station selected (reload
  // included) lands on PROJECT HOME, where the draft-continue cards live.
  useEffect(() => {
    if (!currentFilename || home || showNewSmModal) return;
    if (activeSmId && smCount > 0) return;
    if (!useV2Shell.getState().projectHomeOpen) useV2Shell.getState().openProjectHome();
  }, [currentFilename, home, showNewSmModal, activeSmId, smCount]);

  // Bootstrap — identical to classic App so both entries share behavior.
  useEffect(() => {
    store.deduplicateAutoVisionParams();
    store.initializeProjects();
    initStandardsLibrary();
  }, []);

  // Ctrl+S save (replicates Toolbar's handleSaveProject: JSON download +
  // background server save). Ctrl+Z / Ctrl+Y live inside Canvas already.
  const handleSave = useCallback(async () => {
    const { project, serverAvailable, saveCurrentProject } = useDiagramStore.getState();
    exportProjectJSON(project);
    if (serverAvailable) {
      try { await saveCurrentProject(); }
      catch (err) { console.warn('Server save failed (JSON download still succeeded):', err.message); }
    }
  }, []);
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <div className="v2-app">
          <TopBarV2 />
          {home ? (
            <StartScreen />
          ) : (
            <>
              {/* THE persistent station row — badge+name, the three-stop
                  pill (Spec Sheet | Diagram), star. Stays
                  put on every page; the content flips beneath it.
                  Hidden on the PROJECT HOME — that page is machine-level,
                  no station context (its crumb lives on the banner) — and
                  while the FRESH-CREATE flow is open (Dan, Aug 24: a new
                  station has no station context; the create page and its
                  ‹ Back own the screen — never a mashup with a banner). */}
              {!projectHomeOpen && !freshCreateOpen && <StationBanner />}
              {/* Diagram page's ONE slim sub-row — in-flow (never overlaps):
                  Sequence|Controls detail toggle, compiled meta, legend (when
                  it fits), and the single small Approve/Compile control.
                  Dan: "the diagram page is the diagram." */}
              {!projectHomeOpen && !freshCreateOpen && (view === 'mech' || view === 'controls') && <DiagramSubBar />}
              <div className="v2-body-wrap">
                <div
                  className="v2-body v2-body--context-collapsed"
                  style={{ '--v2-tree-width': `${TREE_WIDTH}px` }}
                >
                  <StationsPanel />
                  {/* Page 2 (Mechanical) is the canvas, kept mounted so the
                      viewport survives flips — state numbers hidden (CSS)
                      and controls-domain nodes (waits/decisions) filtered
                      out at render time because "the mechanical view is
                      just a sequence". */}
                  <main className={`v2-center${view === 'mech' ? ' v2-center--mech' : ''}`}>
                    <Canvas hideHeader mechanicalView={view === 'mech'} />
                    {/* Controls detail — SAME page, more nodes/edges: the
                        compiled flowchart overlays the canvas AREA ONLY, so
                        the stations panel, SDC Engineer pill dock, and every other
                        piece of page chrome stays exactly where the Sequence
                        view has it (true view parity — Dan, Aug 22). */}
                    {view === 'controls' && (
                      <div className="v2-center-overlay" data-testid="controls-overlay">
                        <ControlsFlowView />
                      </div>
                    )}
                    {/* PROJECT HOME — the machine overview (stations grid,
                        + Add Station, notes). Overlays the canvas AREA ONLY
                        (same pattern as Controls detail) so the canvas stays
                        mounted and the stations panel keeps working. */}
                    {projectHomeOpen && (
                      <div className="v2-phome-overlay" data-testid="project-home-overlay">
                        <ProjectHomePage />
                      </div>
                    )}
                    {/* Fresh generation results land IN PLACE on the diagram
                        page (Dan, Aug 23: "grab it right where you made it") —
                        history lives in the SDC Engineer pill. */}
                    {!projectHomeOpen && <GenerationResultCard />}
                  </main>
                  {/* Right-side Program Properties panel removed — Dan,
                      Aug 22 2026: unused, asked repeatedly. Node/edge
                      properties remain reachable in the classic app. */}
                </div>
                {/* (The Code Generation page is retired — Generate lives on
                    the Diagram sub-bar; history lives in the SDC Engineer pill.) */}
                {/* Page 1 — the EMBEDDED built-station spec sheet, above all
                    covers; the pill never moves when flipping. */}
                {/* key = project + station identity: a project switch (or a
                    sheet flip to another station) force-remounts the page so
                    its component state can never leak across either boundary. */}
                {showNewSmModal && sheetLinkedSmId && (
                  <SurfaceBoundary label="sheet"><CreateStationPage embedded key={`sheet:${currentFilename ?? ''}:${sheetLinkedSmId}`} /></SurfaceBoundary>
                )}
              </div>
            </>
          )}
        </div>

        {/* Store-flag modals — same set the classic App mounts, so canvas
            interactions (add device, edit action…) keep working in v2. */}
        {/* v2 uses the describe-first Create Station flow as a FULL-VIEWPORT
            page (round-2 rework — was CreateStationModal): overlays the whole
            shell on showNewSmModal, no outside-click dismissal, draft
            autosave, SDC ENGINEER summary loop. "start blank instead" inside it
            still reaches the classic NewStateMachineModal. */}
        {/* Full-viewport create page — ONLY for fresh "+ New" drafts; a
            built station's sheet renders embedded below the banner above. */}
        {showNewSmModal && !home && !sheetLinkedSmId && (
          <SurfaceBoundary label="create"><CreateStationPage key={`fresh:${currentFilename ?? ''}`} /></SurfaceBoundary>
        )}
        {(showAddDeviceModal || showEditDeviceModal) && <AddDeviceModal />}
        {showActionModal && <ActionModal />}
        {showProjectManager && <ProjectManagerModal />}
        {showRecipeManager && <RecipeManagerModal />}
        {/* Compile-sequence modal — self-gates on useV2Shell.compileFor. */}
        <CompileSequenceModal />
        {/* Generate modal — shared mount for the top-right pipeline button. */}
        {generateOpen && !home && (
          <JarvisGenerateModal onClose={() => useV2Shell.getState().closeGenerate()} />
        )}
        {/* Servo values table — self-gates on useV2Shell.servoTableFor. */}
        <ServoValuesTable />
        <VersionBadge />
        <NewBuildBar />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
