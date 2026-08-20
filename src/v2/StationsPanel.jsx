/**
 * StationsPanel — v2 left panel: thin wrapper around the SDC FEATURE TREE.
 *
 * The panel body is FeatureTreeV2 (SolidWorks-style tree replicating the
 * estimate builder's FeatureTree.jsx — see that file's header for the
 * anatomy and levels). This wrapper keeps the panel chrome:
 *   - header strip ("Machine Structure" — same wording as the estimate app)
 *   - footer: slim project switcher row reusing ProjectPickerModal
 *
 * Documents, Drafts, machine totals, + New Station and the station/device
 * rows all live INSIDE the tree now.
 */

import { useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ProjectPickerModal } from '../components/modals/ProjectPickerModal.jsx';
import { FeatureTreeV2 } from './FeatureTreeV2.jsx';

export function StationsPanel() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef(null);

  // Browser file fallback for the project picker (same logic as Toolbar's
  // handleFileChange — replicated because Toolbar keeps it internal).
  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!loaded.stateMachines) throw new Error('Invalid project file');
        store.importProject(loaded);
      } catch (err) {
        alert(`Failed to load project: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <aside className="v2-stations">
      <div className="v2-stations__header v2-stations__header--tree">
        <span className="v2-stations__title">Machine Structure</span>
        <span className="v2-stations__title-hint">click = show on canvas</span>
      </div>

      <div className="v2-stations__list v2-stations__list--tree">
        <FeatureTreeV2 />
      </div>

      {/* Footer: project switcher */}
      <div className="v2-stations__project">
        <button
          className="v2-stations__project-btn"
          onClick={() => setPickerOpen(true)}
          title="Switch project"
        >
          <span className="v2-stations__project-label">PROJECT</span>
          <span className="v2-stations__project-name">
            {project?.name ?? 'Untitled'}
            {project?.jobNumber ? ` · #${project.jobNumber}` : ''}
          </span>
          <span className="v2-stations__project-chev">⇄</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {pickerOpen && (
        <ProjectPickerModal
          mode="currentTab"
          suppressNewSmModal
          onClose={() => setPickerOpen(false)}
          onBrowseFile={() => fileInputRef.current?.click()}
        />
      )}
    </aside>
  );
}
