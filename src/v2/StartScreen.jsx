/**
 * StartScreen — v2 clean-slate welcome screen.
 *
 * Shown when no project is open (all tabs closed / "close project").
 * Big actions: "+ New Project" (name + optional job number → empty project
 * with ZERO stations) and "Open Project" (recent list + full picker).
 *
 * A PROJECT contains STATIONS: creating a project lands the user in the
 * shell with the empty stations panel prompting "+ New Station" — it does
 * NOT auto-open the create-station page (the store's createNewProject sets
 * showNewSmModal for the classic shell; we clear it here).
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { listProjects } from '../lib/projectApi.js';
import { ProjectPickerModal } from '../components/modals/ProjectPickerModal.jsx';
import { useV2Shell } from './useV2Shell.js';

function relativeTime(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

export function StartScreen() {
  const serverAvailable = useDiagramStore(s => s.serverAvailable);
  const leaveHome = useV2Shell(s => s.leaveHome);

  const [recent, setRecent] = useState([]);
  const [recentError, setRecentError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [jobNumber, setJobNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef(null);

  function handleFileOpen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const projectData = JSON.parse(reader.result);
        if (!projectData.stateMachines) throw new Error('Invalid project file');
        if (!projectData.name) projectData.name = file.name.replace(/\.json$/i, '');
        useDiagramStore.getState().openProjectFromFile(projectData, file.name);
        leaveHome();
      } catch (err) {
        alert(`Failed to load project file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function refreshRecent() {
    try {
      const list = await listProjects();
      list.sort((a, b) => b.lastModified - a.lastModified);
      setRecent(list.slice(0, 8));
      setRecentError(null);
    } catch (err) {
      setRecentError(err.message);
    }
  }
  useEffect(() => { refreshRecent(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const store = useDiagramStore.getState();
      await store.createNewProject(trimmed);
      // createNewProject auto-opens the classic New-SM modal; v2 lands on the
      // empty stations panel instead ("+ New Station" opens the describe page).
      useDiagramStore.setState({ showNewSmModal: false });
      const s = useDiagramStore.getState();
      // Only proceed if the project actually opened (duplicate-name path
      // may have been cancelled inside createNewProject).
      if (s.currentFilename) {
        if (jobNumber.trim()) {
          useDiagramStore.setState(st => ({ project: { ...st.project, jobNumber: jobNumber.trim() } }));
          try { await useDiagramStore.getState().saveCurrentProject(); } catch { /* auto-save will retry */ }
        }
        leaveHome();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleOpenRecent(filename) {
    const store = useDiagramStore.getState();
    await store.switchProject(filename);
    if (useDiagramStore.getState().currentFilename) leaveHome();
  }

  return (
    <div className="v2-start">
      <div className="v2-start__card">
        <div className="v2-start__brand">SDC State Logic <b>v2</b></div>
        <h1 className="v2-start__title">Start a project</h1>
        <p className="v2-start__sub">A project holds a machine's stations. Create one, then add stations by describing them to SDC Engineer.</p>

        {!serverAvailable && (
          <div className="v2-start__warn">
            Project server offline — launch with START_APP.bat to create or open server projects.
          </div>
        )}

        <div className="v2-start__actions">
          {!formOpen ? (
            <button
              className="v2-start__btn v2-start__btn--primary"
              data-testid="start-new-project"
              onClick={() => setFormOpen(true)}
            >＋ New Project</button>
          ) : (
            <form className="v2-start__form" onSubmit={handleCreate}>
              <input
                className="v2-start__input"
                data-testid="start-project-name"
                placeholder="Project name (e.g. Stamper Machine)"
                value={name}
                autoFocus
                onChange={e => setName(e.target.value)}
              />
              <input
                className="v2-start__input v2-start__input--job"
                data-testid="start-project-job"
                placeholder="Job # (optional)"
                value={jobNumber}
                onChange={e => setJobNumber(e.target.value)}
              />
              <div className="v2-start__form-btns">
                <button
                  type="submit"
                  className="v2-start__btn v2-start__btn--primary"
                  data-testid="start-create-btn"
                  disabled={!name.trim() || creating || !serverAvailable}
                >{creating ? 'Creating…' : 'Create project'}</button>
                <button type="button" className="v2-start__btn" onClick={() => setFormOpen(false)}>Cancel</button>
              </div>
            </form>
          )}
          <button
            className="v2-start__btn"
            data-testid="start-open-project"
            onClick={() => setPickerOpen(true)}
          >Open Project…</button>
        </div>

        <div className="v2-start__recent">
          <div className="v2-start__recent-title">Recent projects</div>
          {recentError && <div className="v2-start__recent-empty">Couldn't load list: {recentError}</div>}
          {!recentError && recent.length === 0 && (
            <div className="v2-start__recent-empty">No projects on the server yet.</div>
          )}
          {recent.map(p => (
            <button
              key={p.filename}
              className="v2-start__recent-item"
              onClick={() => handleOpenRecent(p.filename)}
              title={p.filename}
            >
              <span className="v2-start__recent-name">{p.name}</span>
              <span className="v2-start__recent-meta">
                {p.smCount} station{p.smCount !== 1 ? 's' : ''} · {relativeTime(p.lastModified)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileOpen}
      />
      {pickerOpen && (
        <ProjectPickerModal
          mode="currentTab"
          suppressNewSmModal
          onClose={() => { setPickerOpen(false); refreshRecent(); }}
          onBrowseFile={() => fileInputRef.current?.click()}
        />
      )}
    </div>
  );
}
