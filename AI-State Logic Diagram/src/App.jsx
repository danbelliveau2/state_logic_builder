/**
 * App - Root component.
 * Layout: Toolbar (top) | DeviceSidebar (left) | Canvas (center) | PropertiesPanel (right)
 */

import { ReactFlowProvider } from '@xyflow/react';
import { Toolbar } from './components/Toolbar.jsx';
import { DeviceSidebar } from './components/DeviceSidebar.jsx';
import { Canvas } from './components/Canvas.jsx';
import { PropertiesPanel } from './components/PropertiesPanel.jsx';
import { NewStateMachineModal } from './components/modals/NewStateMachineModal.jsx';
import { AddDeviceModal } from './components/modals/AddDeviceModal.jsx';
import { ActionModal } from './components/modals/ActionModal.jsx';
import { useDiagramStore } from './store/useDiagramStore.js';

export function App() {
  const store = useDiagramStore();
  const {
    showNewSmModal,
    showAddDeviceModal,
    showEditDeviceModal,
    showActionModal,
  } = store;

  return (
    <ReactFlowProvider>
      <div className="app-layout">
        <Toolbar />
        <div className="app-body">
          <DeviceSidebar />
          <Canvas />
          <PropertiesPanel />
        </div>
      </div>

      {showNewSmModal && <NewStateMachineModal />}
      {(showAddDeviceModal || showEditDeviceModal) && <AddDeviceModal />}
      {showActionModal && <ActionModal />}
    </ReactFlowProvider>
  );
}
