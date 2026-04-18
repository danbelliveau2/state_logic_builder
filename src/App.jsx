/**
 * App - Root component.
 * Layout: Toolbar (top) | DeviceSidebar (left) | Canvas (center) | PropertiesPanel (right)
 */

import { useEffect, Component } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ProjectTabBar } from './components/ProjectTabBar.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { DeviceSidebar } from './components/DeviceSidebar.jsx';
import { Canvas } from './components/Canvas.jsx';
import { PropertiesPanel } from './components/PropertiesPanel.jsx';
import { ProjectSetup } from './components/ProjectSetup.jsx';
import { NewStateMachineModal } from './components/modals/NewStateMachineModal.jsx';
import { AddDeviceModal } from './components/modals/AddDeviceModal.jsx';
import { ActionModal } from './components/modals/ActionModal.jsx';
import { ProjectManagerModal } from './components/modals/ProjectManagerModal.jsx';
import { RecipeManagerModal } from './components/modals/RecipeManagerModal.jsx';
import { useDiagramStore } from './store/useDiagramStore.js';

// ── Error Boundary ─────────────────────────────────────────────────────────
// Catches React render crashes and shows an error instead of a blank page.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App crash caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40, maxWidth: 600, margin: '60px auto',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <h1 style={{ color: '#dc2626', fontSize: 22 }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', marginTop: 8 }}>
            The app crashed during rendering. Try refreshing the page.
            If the problem persists, clear localStorage and reload.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('sdc-state-logic-v1');
              window.location.reload();
            }}
            style={{
              marginTop: 16, padding: '8px 20px', background: '#2563eb',
              color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Clear Data &amp; Reload
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16, marginLeft: 8, padding: '8px 20px', background: '#64748b',
              color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Just Reload
          </button>
          <pre style={{
            marginTop: 20, padding: 16, background: '#1e293b', color: '#f87171',
            borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 300,
          }}>
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

// ── Main App ──────────────────────────────────────────────────────────────
export function App() {
  const store = useDiagramStore();
  const {
    showNewSmModal,
    showAddDeviceModal,
    showEditDeviceModal,
    showActionModal,
    showProjectManager,
    showRecipeManager,
    activeView,
  } = store;

  // Bootstrap: detect server and load/create initial project
  useEffect(() => {
    store.deduplicateAutoVisionParams();   // one-time cleanup of duplicate vision params
    store.initializeProjects();
  }, []);

  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <div className="app-layout">
          <ProjectTabBar />
          <Toolbar />
          {activeView === 'projectSetup' ? (
            <ProjectSetup />
          ) : (
            <div className="app-body">
              <DeviceSidebar />
              <Canvas />
              <PropertiesPanel />
            </div>
          )}
        </div>

        {showNewSmModal && <NewStateMachineModal />}
        {(showAddDeviceModal || showEditDeviceModal) && <AddDeviceModal />}
        {showActionModal && <ActionModal />}
        {showProjectManager && <ProjectManagerModal />}
        {showRecipeManager && <RecipeManagerModal />}
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
