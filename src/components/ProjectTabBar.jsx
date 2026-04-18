/**
 * ProjectTabBar — Horizontal tab strip for multiple open projects.
 *
 * Shows a tab for each open project. Click to switch, X to close.
 * The "+" button opens a file picker to load a .json project file into a new tab.
 */

import { useRef } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';

export function ProjectTabBar() {
  const openTabs = useDiagramStore(s => s.openTabs) ?? [];
  const activeTabId = useDiagramStore(s => s.activeTabId);
  const projectName = useDiagramStore(s => s.project?.name);
  const currentFilename = useDiagramStore(s => s.currentFilename);
  const switchTab = useDiagramStore(s => s.switchTab);
  const closeTab = useDiagramStore(s => s.closeTab);
  const fileInputRef = useRef(null);

  // Build effective tab list — if openTabs is empty, synthesize one from current project
  let tabs = openTabs;
  let effectiveActiveId = activeTabId;
  if (tabs.length === 0) {
    tabs = [{
      id: '_current',
      filename: currentFilename,
      name: projectName || currentFilename || 'Current Project',
      snapshot: null,
    }];
    effectiveActiveId = '_current';
  }

  // Handle file selection — load JSON into a new tab
  function handleFileOpen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const projectData = JSON.parse(reader.result);
        if (!projectData.name) projectData.name = file.name.replace(/\.json$/i, '');
        const store = useDiagramStore.getState();
        store.openProjectFromFile(projectData, file.name);
      } catch (err) {
        alert(`Failed to load project file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }

  return (
    <div className="project-tabs">
      <div className="project-tabs__list">
        {tabs.map(tab => {
          const isActive = tab.id === effectiveActiveId;
          const displayName = isActive
            ? (projectName || tab.name || tab.filename || 'Untitled')
            : (tab.name || tab.filename || 'Untitled');
          return (
            <div
              key={tab.id}
              className={`project-tabs__tab${isActive ? ' project-tabs__tab--active' : ''}`}
              onClick={() => { if (tab.id !== '_current') switchTab(tab.id); }}
              title={tab.filename || displayName}
            >
              <span className="project-tabs__tab-name">
                {displayName}
              </span>
              {tabs.length > 1 && (
                <button
                  className="project-tabs__tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  title="Close tab"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        className="project-tabs__add"
        onClick={() => fileInputRef.current?.click()}
        title="Open project file in new tab"
      >
        <span className="project-tabs__add-icon">+</span>
        <span className="project-tabs__add-label">Open Project</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileOpen}
      />
    </div>
  );
}
