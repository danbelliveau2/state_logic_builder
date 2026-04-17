/**
 * ProjectSetup - Container for project configuration views.
 * Two tabs: Machine Configuration and Standards Profile.
 */

import { useState } from 'react';
import { MachineConfigEditor } from './MachineConfigEditor.jsx';
import { StandardsProfileEditor } from './StandardsProfileEditor.jsx';
import { IOMapEditor } from './IOMapEditor.jsx';
import { DesignSystemEditor } from './DesignSystemEditor.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';

const TABS = [
  { id: 'machine', label: 'Machine Configuration' },
  { id: 'standards', label: 'Standards Profile' },
  { id: 'iomap', label: 'IO Map' },
  { id: 'design', label: 'Design System' },
];

export function ProjectSetup() {
  const [activeTab, setActiveTab] = useState('machine');
  const setActiveView = useDiagramStore(s => s.setActiveView);

  return (
    <div className="project-setup">
      <div className="project-setup__topbar">
        <button
          className="project-setup__back"
          onClick={() => setActiveView('canvas')}
          title="Back to canvas"
        >
          ← Back to Canvas
        </button>
        <div className="project-setup__tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`project-setup__tab${activeTab === tab.id ? ' project-setup__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="project-setup__content">
        {activeTab === 'machine' && <MachineConfigEditor />}
        {activeTab === 'standards' && <StandardsProfileEditor />}
        {activeTab === 'iomap' && <IOMapEditor />}
        {activeTab === 'design' && <DesignSystemEditor />}
      </div>
    </div>
  );
}
