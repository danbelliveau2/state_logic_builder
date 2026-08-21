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
import { JarvisPage } from '../components/jarvis/JarvisPage.jsx';
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
import { ServoValuesTable } from './ServoValuesTable.jsx';
import { servoGaps, servoGapSummary, servoGapDetail } from './servoValues.js';
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

// ── Flow-guidance bar — the "then what?" (Dan: "I reviewed the mechanical
// sequence, then what?"). One compact line at the bottom of the center pane,
// stage-aware from the active station's state:
//   drawn, not compiled   → Compile the controls
//   compiled, not approved→ Review Full Controls & Approve
//   approved              → Generate
// One line, one button, current stage highlighted. Hidden when there is
// nothing drawn yet (Create Station owns that part of the journey).
function FlowGuidanceBar() {
  const sm = useDiagramStore(s =>
    (s.project?.stateMachines ?? []).find(m => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const setView = useV2Shell(s => s.setView);

  // Does this station have any generated builds? Gates the small "view code →"
  // link on the Generate stage (opens the Generated code grid).
  const [hasBuilds, setHasBuilds] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const smName = sm?.name ?? null;
  useEffect(() => {
    if (!smName) { setHasBuilds(false); return; }
    let alive = true;
    fetch('/api/jarvis/generations')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d) return;
        setHasBuilds((d.builds || []).some(b => b.sm === smName));
      })
      .catch(() => { if (alive) setHasBuilds(false); });
    return () => { alive = false; };
  }, [smName]);

  if (!sm || (sm.nodes ?? []).length === 0) return null;
  const cs = sm.compiledSequence;
  const stage = !cs ? 'compile' : cs.approved !== true ? 'approve' : 'generate';

  // Servo readiness — a MECHANICAL prerequisite (position tables filled out
  // before compile). Soft gate: compile stays clickable, a confirm lists
  // what's missing (values sometimes genuinely defer to commissioning).
  const gaps = servoGaps(sm);
  const gapSummary = stage === 'compile' ? servoGapSummary(gaps) : null;
  function runCompileWithGate() {
    if (gaps.length > 0) {
      const ok = confirm(
        `Servo position values are still missing:\n\n${servoGapDetail(gaps)}\n\n` +
        'These normally come from the mechanical team before compile. Compile anyway?'
      );
      if (!ok) return;
    }
    useV2Shell.getState().openCompile(sm.id);
  }

  const steps = [
    { id: 'compile',  label: '⚙ Compile' },
    { id: 'approve',  label: '✓ Review & Approve' },
    { id: 'generate', label: '✨ Generate' },
  ];
  const stageIdx = steps.findIndex(x => x.id === stage);

  const prompt = stage === 'compile'
    ? 'Sequence look right?'
    : stage === 'approve'
      ? 'Controls are compiled —'
      : 'Sequence approved —';
  const action = stage === 'compile'
    ? { label: '⚙ Compile the controls (Jarvis, ~4 min)', run: runCompileWithGate }
    : stage === 'approve'
      ? { label: 'Review Full Controls & Approve', run: () => setView('controls') }
      : { label: 'Generate (fast — sequence already approved)', run: () => useV2Shell.getState().openGenerate() };

  return (
    <div
      data-testid="flow-guidance-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '5px 14px',
        background: '#061d39', color: '#dbe6f2',
        fontSize: 12, lineHeight: 1.2,
        borderTop: '1px solid #14304f',
        flex: 'none',
      }}
    >
      {/* Stage trail — done steps muted+checked, current highlighted */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        {steps.map((s2, i) => (
          <span key={s2.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: '#4a6584' }}>→</span>}
            <span style={{
              fontWeight: i === stageIdx ? 700 : 400,
              color: i < stageIdx ? '#5a9a48' : i === stageIdx ? '#fff' : '#7d93ab',
              background: i === stageIdx ? '#1574C4' : 'transparent',
              borderRadius: 4, padding: i === stageIdx ? '2px 8px' : '2px 0',
            }}>
              {i < stageIdx ? '✓ ' : ''}{s2.label}
            </span>
          </span>
        ))}
      </span>
      <span style={{ flex: 1 }} />
      {stage === 'generate' && hasBuilds && (
        <button
          data-testid="flow-guidance-view-code"
          onClick={() => setCodeOpen(true)}
          title="Open the Generated code grid — this station's builds, live progress, reviews"
          style={{
            background: 'none', border: 'none', color: '#8fc1f0', fontSize: 12,
            fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
            textDecoration: 'underline',
          }}
        >view code →</button>
      )}
      {codeOpen && <JarvisPage onClose={() => setCodeOpen(false)} />}
      {gapSummary && (
        <button
          data-testid="flow-guidance-servo-gap"
          onClick={() => useV2Shell.getState().openServoTable(sm.id)}
          title="Open the servo values table — fill in what the mechanical team knows"
          style={{
            background: 'none', border: 'none', color: '#e3c76b', fontSize: 12,
            fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
            textDecoration: 'underline',
          }}
        >⚠ {gapSummary}</button>
      )}
      <span style={{ color: '#9db2c8', whiteSpace: 'nowrap' }}>{prompt}</span>
      <button
        data-testid="flow-guidance-action"
        onClick={action.run}
        style={{
          background: '#1574C4', color: '#fff', border: 'none', borderRadius: 5,
          padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >{action.label} →</button>
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
                {/* Stage-aware "then what?" bar — compile → approve → generate */}
                <FlowGuidanceBar />
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
        {/* Servo values table — self-gates on useV2Shell.servoTableFor. */}
        <ServoValuesTable />
        <VersionBadge />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
