/**
 * AppV2 — v2 application shell (SDC Engineer-centered workflow).
 *
 * Layout (CSS grid, see v2.css):
 *   ┌──────────────── TopBarV2 (48px) ────────────────┐
 *   │ Stations (340px) │  the STATION SHEET / project home / classic card │
 *   └──────────────────────────────────────────────────┘
 *
 * ONE DOOR (Dan, 2026-09-02 — "we revamped this — there's no use for this
 * page anymore. I want the v2 app to always show the right things"; law:
 * meKnowledge 2026-08-26 FLOW REPLACEMENT = PREDECESSOR DELETION):
 *   - EVERY station opens the cascade STATION SHEET (CreateStationPage
 *     embedded: SectionBar stack, flows, chat pill). openStation.js is the
 *     only opener; legacy-shaped stations are migrated on open; pure v1
 *     canvas work renders as the read-only ClassicStationCard.
 *   - EVERY "+ New" / "Add Station" opens the sheet's describe-first INPUTS.
 *   - The classic canvas, the Spec Sheet|Diagram pill, the Diagram sub-bar
 *     (Sequence|Controls detail, ⚙ Compile, ✨ Generate), the controls-flow
 *     overlay, the in-place generation card, the compile modal, the Generate
 *     modal mount and the canvas modals are DELETED from this bundle. The
 *     classic canvas lives ONLY at /classic.html (frozen).
 *
 * Reused from the classic app below the shell: useDiagramStore (same store,
 * same localStorage key, same server API) and the project-level modals.
 */

import { useEffect, useLayoutEffect, useRef, useCallback, Component } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { CreateStationPage } from '../components/jarvis/CreateStationPage.jsx';
import { consumeResumeRequest } from '../components/jarvis/createStationDrafts.js';
import { ProjectManagerModal } from '../components/modals/ProjectManagerModal.jsx';
import { VersionBadge } from '../components/VersionBadge.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { initStandardsLibrary } from '../lib/standardsLibrary.js';
import { exportProjectJSON } from '../lib/projectApi.js';
import { TopBarV2 } from './TopBarV2.jsx';
import { NewBuildBar } from './NewBuildBar.jsx';
import { StationsPanel } from './StationsPanel.jsx';
import { TREE_WIDTH } from './FeatureTreeV2.jsx';
import { StartScreen } from './StartScreen.jsx';
import { ServoValuesTable } from './ServoValuesTable.jsx';
import { StationBanner } from './StationBanner.jsx';
import { ProjectHomePage } from './ProjectHomePage.jsx';
import { ClassicStationCard } from './ClassicStationCard.jsx';
import { isClassicStation, openStationSheet } from './openStation.js';
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
            The v2 shell crashed during rendering. Try refreshing — your drafts are saved.
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

export function AppV2() {
  const store = useDiagramStore();
  const { showNewSmModal, showProjectManager } = store;

  // sheetLinkedSmId marks the embedded built-station sheet (vs the
  // full-viewport "+ New" fresh-draft flow) and is cleared whenever the
  // sheet closes.
  const sheetLinkedSmId = useV2Shell(s => s.sheetLinkedSmId);
  // Fresh "+ Add Station" create flow (full-viewport page). While it's open
  // the station banner hides — there IS no station context.
  const freshCreateOpen = showNewSmModal && !sheetLinkedSmId;
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
      consumeResumeRequest();
      const shell = useV2Shell.getState();
      if (shell.sheetLinkedSmId) shell.setSheetLinkedSmId(null);
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
  const activeSm = useDiagramStore(s =>
    (s.project?.stateMachines ?? []).find(m => m.id === s.activeSmId) ?? null);

  // LANDING (Dan, 2026-08-31: reload dropped him on the classic canvas; 2026-
  // 09-02: it did again, on a stray legacy station). App open / reload / tab
  // switch: a project with ONE station lands on that station (its sheet, or
  // the classic card), otherwise on the machine homepage. Every project —
  // there is no "classic project" landing anymore.
  const landedRef = useRef(null);
  useEffect(() => {
    if (!currentFilename || home) return;
    if (landedRef.current === currentFilename) return;
    const proj = useDiagramStore.getState().project;
    if (!proj?.stateMachines) return; // not restored yet — effect re-runs
    landedRef.current = currentFilename;
    const shell = useV2Shell.getState();
    if (proj.stateMachines.length === 1) {
      try { openStationSheet(proj.stateMachines[0]); } catch { shell.openProjectHome(); }
    } else {
      shell.openProjectHome();
    }
  }, [currentFilename, home, smCount]);

  // ZERO-STATION / NO-SELECTION LANDING (Dan, 2026-08-26): a project with no
  // station selected (reload included) lands on PROJECT HOME, where the
  // draft-continue cards live.
  useEffect(() => {
    if (!currentFilename || home || showNewSmModal) return;
    if (activeSmId && smCount > 0) return;
    if (!useV2Shell.getState().projectHomeOpen) useV2Shell.getState().openProjectHome();
  }, [currentFilename, home, showNewSmModal, activeSmId, smCount]);

  // ONE DOOR (2026-09-02): a selected station with nothing on screen — no
  // sheet, no home, no fresh draft — always resolves to its sheet (or the
  // classic card, which renders in place below). There is no other view.
  useEffect(() => {
    if (!currentFilename || home || projectHomeOpen || showNewSmModal) return;
    if (!activeSm || isClassicStation(activeSm)) return;
    try { openStationSheet(activeSm); } catch (e) { console.error('[one-door] open failed:', e); }
  }, [currentFilename, home, projectHomeOpen, showNewSmModal, activeSm?.id, activeSm?.machineSpec?.cascadeState]);

  // Bootstrap — identical to classic App so both entries share behavior.
  useEffect(() => {
    store.deduplicateAutoVisionParams();
    store.initializeProjects();
    initStandardsLibrary();
  }, []);

  // Ctrl+S save (replicates Toolbar's handleSaveProject: JSON download +
  // background server save).
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

  const classicOnScreen = !projectHomeOpen && !freshCreateOpen && !!activeSm && isClassicStation(activeSm)
    && !(showNewSmModal && sheetLinkedSmId);

  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <div className="v2-app">
          <TopBarV2 />
          {home ? (
            <StartScreen />
          ) : (
            <>
              {/* THE persistent station row — "‹ project" crumb + S## + name.
                  Hidden on the PROJECT HOME (machine-level, no station
                  context) and while the FRESH-CREATE flow is open (a new
                  station has no station context; the create page and its
                  ‹ Back own the screen). */}
              {!projectHomeOpen && !freshCreateOpen && <StationBanner />}
              <div className="v2-body-wrap">
                <div
                  className="v2-body v2-body--context-collapsed"
                  style={{ '--v2-tree-width': `${TREE_WIDTH}px` }}
                >
                  <StationsPanel />
                  <main className="v2-center" data-testid="v2-center">
                    {/* PROJECT HOME — the machine overview (stations grid,
                        + Add Station, notes). */}
                    {projectHomeOpen && (
                      <div className="v2-phome-overlay" data-testid="project-home-overlay">
                        <ProjectHomePage />
                      </div>
                    )}
                    {/* CLASSIC STATION — v1 canvas work: read-only card, the
                        canvas itself lives only at /classic.html. */}
                    {classicOnScreen && <ClassicStationCard sm={activeSm} />}
                  </main>
                </div>
                {/* THE STATION SHEET — embedded below the banner. key =
                    project + station identity: a project switch (or a flip
                    to another station) force-remounts the page so its
                    component state can never leak across either boundary. */}
                {showNewSmModal && sheetLinkedSmId && (
                  <SurfaceBoundary label="sheet"><CreateStationPage embedded key={`sheet:${currentFilename ?? ''}:${sheetLinkedSmId}`} /></SurfaceBoundary>
                )}
              </div>
            </>
          )}
        </div>

        {/* Full-viewport create page — ONLY for fresh "+ New" drafts; a
            built station's sheet renders embedded below the banner above. */}
        {showNewSmModal && !home && !sheetLinkedSmId && (
          <SurfaceBoundary label="create"><CreateStationPage key={`fresh:${currentFilename ?? ''}`} /></SurfaceBoundary>
        )}
        {showProjectManager && <ProjectManagerModal />}
        {/* Servo values table — self-gates on useV2Shell.servoTableFor. */}
        <ServoValuesTable />
        <VersionBadge />
        <NewBuildBar />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
