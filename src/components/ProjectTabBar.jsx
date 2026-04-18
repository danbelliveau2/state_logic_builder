/**
 * ProjectTabBar — Horizontal tab strip for multiple open projects.
 *
 * Shows a tab for each open project. Click to switch, X to close.
 * Middle-click or Ctrl+click opens in a new tab (wired from ProjectManagerModal).
 * The "+" button opens the project manager to select another project.
 */

import { useDiagramStore } from '../store/useDiagramStore.js';

export function ProjectTabBar() {
  const openTabs = useDiagramStore(s => s.openTabs);
  const activeTabId = useDiagramStore(s => s.activeTabId);
  const switchTab = useDiagramStore(s => s.switchTab);
  const closeTab = useDiagramStore(s => s.closeTab);
  const openProjectManager = useDiagramStore(s => s.openProjectManager);

  // Don't render if no tabs yet (before initialization)
  if (!openTabs || openTabs.length === 0) return null;

  // Only show the bar if there's more than 1 tab (or always show for discoverability)
  // We'll always show it so users know the feature exists
  return (
    <div className="project-tabs">
      <div className="project-tabs__list">
        {openTabs.map(tab => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`project-tabs__tab${isActive ? ' project-tabs__tab--active' : ''}`}
              onClick={() => switchTab(tab.id)}
              title={tab.filename || tab.name}
            >
              <span className="project-tabs__tab-name">
                {tab.name || tab.filename || 'Untitled'}
              </span>
              {openTabs.length > 1 && (
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
        onClick={() => openProjectManager()}
        title="Open another project"
      >
        +
      </button>
    </div>
  );
}
