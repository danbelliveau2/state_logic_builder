/**
 * StationsPanel — v2 left panel.
 *
 * Ordered list of the current project's state machines ("stations").
 * Each row: station number badge + name + a small status hint
 * (has spec ✓ / drawn node count). Click selects the SM on the canvas.
 *
 * "+ New Station" opens the classic new-SM flow via the store
 * (store.openNewSmModal -> NewStateMachineModal rendered in AppV2).
 *
 * Bottom: slim project switcher row reusing ProjectPickerModal
 * (standalone — store + /api/projects only, no Toolbar context needed).
 */

import { useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ProjectPickerModal } from '../components/modals/ProjectPickerModal.jsx';

export function StationsPanel() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const activeSmId = useDiagramStore(s => s.activeSmId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef(null);

  const sms = [...(project?.stateMachines ?? [])]
    .sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999));

  // Browser file fallback for the project picker (same logic as Toolbar's
  // handleFileChange — replicated here because Toolbar keeps it as an
  // internal closure and must not be edited).
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
      <div className="v2-stations__header">
        <span className="v2-stations__title">Stations</span>
        <button
          className="v2-stations__new"
          title="Add a new station to this project"
          onClick={() => {
            // TODO(v2 integration point): the describe-first CreateStationModal
            // (being built separately) will mount here — replace
            // openNewSmModal() with the new describe-first flow once it lands.
            // Do NOT import CreateStationModal yet; the classic new-SM modal
            // is rendered by AppV2 when showNewSmModal is set.
            store.openNewSmModal();
          }}
        >
          + New Station
        </button>
      </div>

      <div className="v2-stations__list">
        {sms.length === 0 && (
          <div className="v2-stations__empty">
            No stations yet.<br />Click “+ New Station” to add the first one.
          </div>
        )}
        {sms.map(sm => {
          const nodeCount = (sm.nodes ?? []).length;
          const hasSpec = !!sm.machineSpec;
          const active = sm.id === activeSmId;
          return (
            <button
              key={sm.id}
              className={`v2-station${active ? ' v2-station--active' : ''}`}
              onClick={() => store.setActiveSm(sm.id)}
              title={sm.description || (sm.displayName ?? sm.name)}
            >
              <span className="v2-station__num">
                S{String(sm.stationNumber ?? 0).padStart(2, '0')}
              </span>
              <span className="v2-station__body">
                <span className="v2-station__name">{sm.displayName ?? sm.name ?? '(unnamed)'}</span>
                <span className="v2-station__hint">
                  {hasSpec && <span className="v2-station__spec" title="Has a saved machine spec">✓ spec</span>}
                  <span title="Drawn state nodes">{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Slim project switcher row */}
      <div className="v2-stations__project">
        <button
          className="v2-stations__project-btn"
          onClick={() => setPickerOpen(true)}
          title="Switch project"
        >
          <span className="v2-stations__project-label">PROJECT</span>
          <span className="v2-stations__project-name">
            {project?.name ?? 'Untitled'}
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
          onClose={() => setPickerOpen(false)}
          onBrowseFile={() => fileInputRef.current?.click()}
        />
      )}
    </aside>
  );
}
