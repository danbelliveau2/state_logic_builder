/**
 * Toolbar - Top application bar.
 * Project name, SM tabs, export, save/load.
 */

import { useRef } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { downloadL5X, exportProjectJSON } from '../lib/l5xExporter.js';
import { buildProgramName } from '../lib/tagNaming.js';

export function Toolbar() {
  const store = useDiagramStore();
  const { project, activeSmId } = store;
  const sms = project.stateMachines ?? [];
  const sm = store.getActiveSm();
  const fileInputRef = useRef(null);

  function handleExportL5X() {
    if (!sm) return alert('No state machine selected.');
    if (sm.nodes.length === 0) return alert('No states defined. Add at least one state before exporting.');
    try {
      downloadL5X(sm);
    } catch (err) {
      alert(`Export error: ${err.message}`);
      console.error(err);
    }
  }

  function handleExportAllL5X() {
    for (const s of sms) {
      if (s.nodes.length > 0) {
        try { downloadL5X(s); } catch (e) { console.error(e); }
      }
    }
  }

  function handleSaveProject() {
    exportProjectJSON(project);
  }

  function handleLoadProject() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!loaded.stateMachines) throw new Error('Invalid project file');
        store.loadProject(loaded);
      } catch (err) {
        alert(`Failed to load project: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const programName = sm ? buildProgramName(sm.stationNumber, sm.name) : null;

  return (
    <header className="toolbar">
      {/* Logo / Brand */}
      <div className="toolbar__brand">
        <span className="toolbar__logo">⚡</span>
        <span className="toolbar__title">SDC State Logic Builder</span>
      </div>

      {/* SM tabs */}
      <div className="toolbar__tabs">
        {sms.map(s => (
          <button
            key={s.id}
            className={`sm-tab${s.id === activeSmId ? ' sm-tab--active' : ''}`}
            onClick={() => store.setActiveSm(s.id)}
            title={buildProgramName(s.stationNumber, s.name)}
          >
            <span className="sm-tab__station">S{String(s.stationNumber).padStart(2, '0')}</span>
            <span className="sm-tab__name">{s.displayName ?? s.name}</span>
            <button
              className="sm-tab__close"
              title="Delete state machine"
              onClick={e => {
                e.stopPropagation();
                if (confirm(`Delete state machine "${s.displayName ?? s.name}"?`)) {
                  store.deleteStateMachine(s.id);
                }
              }}
            >×</button>
          </button>
        ))}
        <button
          className="sm-tab sm-tab--add"
          onClick={store.openNewSmModal}
          title="New state machine"
        >
          + New
        </button>
      </div>

      {/* Right actions */}
      <div className="toolbar__actions">
        {programName && (
          <span className="toolbar__program-name mono">{programName}</span>
        )}

        <button
          className="btn btn--primary"
          onClick={handleExportL5X}
          disabled={!sm}
          title="Export current state machine to L5X"
        >
          ↓ Export L5X
        </button>

        {sms.length > 1 && (
          <button
            className="btn btn--secondary"
            onClick={handleExportAllL5X}
            title="Export all state machines as separate L5X files"
          >
            ↓ Export All
          </button>
        )}

        <div className="toolbar__divider" />

        <button
          className="btn btn--ghost"
          onClick={handleSaveProject}
          title="Save project as JSON"
        >
          💾 Save
        </button>
        <button
          className="btn btn--ghost"
          onClick={handleLoadProject}
          title="Load project from JSON"
        >
          📂 Load
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
    </header>
  );
}
