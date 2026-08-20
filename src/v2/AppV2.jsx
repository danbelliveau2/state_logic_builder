/**
 * AppV2 — v2 application shell (Jarvis-centered workflow).
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
 * View switcher: "Mechanical" is the canvas as-is; "Full Controls" renders
 * the station's Build-time compiled sequence (CompiledControlsView) — or an
 * honest banner + inline Compile button when none exists yet. The view state
 * lives in useV2Shell so the Build menu can land the user on Full Controls
 * after a compile finishes.
 */

import { useEffect, useState, useCallback, Component } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../components/Canvas.jsx';
import { CreateStationPage } from '../components/jarvis/CreateStationPage.jsx';
import { AddDeviceModal } from '../components/modals/AddDeviceModal.jsx';
import { ActionModal } from '../components/modals/ActionModal.jsx';
import { ProjectManagerModal } from '../components/modals/ProjectManagerModal.jsx';
import { RecipeManagerModal } from '../components/modals/RecipeManagerModal.jsx';
import { VersionBadge } from '../components/VersionBadge.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { initStandardsLibrary } from '../lib/standardsLibrary.js';
import { exportProjectJSON } from '../lib/l5xExporter.js';
import { TopBarV2 } from './TopBarV2.jsx';
import { StationsPanel } from './StationsPanel.jsx';
import { TREE_WIDTH } from './FeatureTreeV2.jsx';
import { ContextPanelV2 } from './ContextPanelV2.jsx';
import { StartScreen } from './StartScreen.jsx';
import { CompiledControlsView } from './CompiledControlsView.jsx';
import { CompileSequenceModal } from './CompileSequenceModal.jsx';
import { useV2Shell } from './useV2Shell.js';

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

// ── View switcher (house style: canvas-mode-toggle pill) ────────────────────
// Rendered INSIDE the canvas's SM title pill via Canvas's `headerExtra` slot,
// so the switcher and the "S01 … Normal|Recovery" header are ONE row — the
// floating version overlapped the pill (Dan round-2 feedback #1).
function ViewSwitcher({ view, onChange }) {
  return (
    <div className="canvas-mode-toggle v2-view-switcher--inline" data-testid="v2-view-switcher">
      <button
        className={`canvas-mode-btn${view === 'mechanical' ? ' canvas-mode-btn--active' : ''}`}
        onClick={() => onChange('mechanical')}
        title="Mechanical view — the flowchart as drawn"
      >Mechanical</button>
      <button
        className={`canvas-mode-btn${view === 'controls' ? ' canvas-mode-btn--active' : ''}`}
        onClick={() => onChange('controls')}
        title="Full Controls view — the compiled sequence: states, transitions, waits, handshakes"
      >Full Controls</button>
    </div>
  );
}

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

  // View lives in the v2 shell store so the Build menu / compile modal can
  // land the user on Full Controls when a compile finishes.
  const view = useV2Shell(s => s.view);
  const setView = useV2Shell(s => s.setView);
  const [contextCollapsed, setContextCollapsed] = useState(false);

  // Clean-slate start screen (all project tabs closed).
  const home = useV2Shell(s => s.home);
  const leaveHome = useV2Shell(s => s.leaveHome);
  const currentFilename = useDiagramStore(s => s.currentFilename);
  // Auto-leave home the moment any project opens (picker, recent list,
  // file import, create) — currentFilename is the single source of truth.
  useEffect(() => {
    if (home && currentFilename) leaveHome();
  }, [home, currentFilename, leaveHome]);

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
            <div
              className={`v2-body${contextCollapsed ? ' v2-body--context-collapsed' : ''}`}
              style={{ '--v2-tree-width': `${TREE_WIDTH}px` }}
            >
              <StationsPanel />
              <main className="v2-center">
                {/* Mechanical = the React Flow canvas (view switcher rides
                    inside the canvas SM-title pill via headerExtra so header
                    elements never overlap). Full Controls = the compiled
                    sequence view, which mirrors the same header row and hosts
                    the same switcher in the same spot. */}
                {view === 'controls' ? (
                  <CompiledControlsView
                    headerExtra={<ViewSwitcher view={view} onChange={setView} />}
                  />
                ) : (
                  <Canvas headerExtra={<ViewSwitcher view={view} onChange={setView} />} />
                )}
              </main>
              <ContextPanelV2
                collapsed={contextCollapsed}
                onToggle={() => setContextCollapsed(c => !c)}
              />
            </div>
          )}
        </div>

        {/* Store-flag modals — same set the classic App mounts, so canvas
            interactions (add device, edit action…) keep working in v2. */}
        {/* v2 uses the describe-first Create Station flow as a FULL-VIEWPORT
            page (round-2 rework — was CreateStationModal): overlays the whole
            shell on showNewSmModal, no outside-click dismissal, draft
            autosave, JARVIS summary loop. "start blank instead" inside it
            still reaches the classic NewStateMachineModal. */}
        {showNewSmModal && !home && <CreateStationPage />}
        {(showAddDeviceModal || showEditDeviceModal) && <AddDeviceModal />}
        {showActionModal && <ActionModal />}
        {showProjectManager && <ProjectManagerModal />}
        {showRecipeManager && <RecipeManagerModal />}
        {/* Compile-sequence modal — self-gates on useV2Shell.compileFor. */}
        <CompileSequenceModal />
        <VersionBadge />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
