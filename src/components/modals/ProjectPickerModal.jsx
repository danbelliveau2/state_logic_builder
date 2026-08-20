/**
 * ProjectPickerModal — In-app project picker.
 *
 * Lists server projects (GET /api/projects) sorted by last-modified,
 * newest first. Click a project to open it. A secondary "Browse file..."
 * option falls back to the native file dialog for JSON files that live
 * outside the server's projects/ folder (e.g. network job folders).
 *
 * Also offers "New Project" at the top (name + optional job #) and a
 * per-project delete (trash icon, confirm dialog, DELETE /api/projects).
 *
 * Props:
 *   mode          'newTab'     → clicking a project opens it in a new tab
 *                 'currentTab' → clicking a project loads it in the current tab
 *   onClose       () => void   — close the modal
 *   onBrowseFile  () => void   — trigger the caller's native file-dialog fallback
 *   suppressNewSmModal  bool   — v2 shell: after creating a project, do NOT
 *                 auto-open the New-SM modal (v2 lands on its empty stations
 *                 panel instead). Classic callers omit it — behavior unchanged.
 */

import { useState, useEffect } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { listProjects } from '../../lib/projectApi.js';

/** "2h ago" style relative timestamp. */
function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function ProjectPickerModal({ mode = 'newTab', onClose, onBrowseFile, suppressNewSmModal = false }) {
  const currentFilename = useDiagramStore(s => s.currentFilename);
  const serverAvailable = useDiagramStore(s => s.serverAvailable);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newJob, setNewJob] = useState('');
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      const list = await listProjects();
      list.sort((a, b) => b.lastModified - a.lastModified);
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
  }, []);

  // Escape closes
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleOpen(filename) {
    const store = useDiagramStore.getState();
    onClose();
    if (mode === 'currentTab') {
      await store.switchProject(filename);
    } else {
      await store.openInNewTab(filename);
    }
  }

  function handleBrowse() {
    onClose();
    onBrowseFile?.();
  }

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const store = useDiagramStore.getState();
      await store.createNewProject(name);
      const after = useDiagramStore.getState();
      if (suppressNewSmModal) useDiagramStore.setState({ showNewSmModal: false });
      if (after.currentFilename && newJob.trim()) {
        useDiagramStore.setState(s => ({ project: { ...s.project, jobNumber: newJob.trim() } }));
        try { await useDiagramStore.getState().saveCurrentProject(); } catch { /* auto-save retries */ }
      }
      onClose();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e, p) {
    e.stopPropagation();
    if (!confirm(`Delete project "${p.name}" (${p.filename})?\n\nThis removes the file from the server. The last 5 auto-backups remain in projects/_backups.`)) return;
    try {
      const st = useDiagramStore.getState();
      const deletingCurrent = p.filename === st.currentFilename;
      // Drop any tab pointing at the doomed file FIRST — a lingering tab
      // snapshot (or switchTab's save-before-switch) would resurrect it.
      const tabs = (st.openTabs ?? []).filter(t => t.filename !== p.filename);
      if (tabs.length !== (st.openTabs ?? []).length) {
        useDiagramStore.setState(s => ({
          openTabs: tabs,
          activeTabId: tabs.some(t => t.id === s.activeTabId) ? s.activeTabId : null,
        }));
      }
      if (deletingCurrent) {
        // Detach before deleting: deleteProjectFile switches away, and both
        // switchProject and the auto-save derive-and-save path would write
        // the current project straight back to disk ("can't get rid of it").
        useDiagramStore.setState({ currentFilename: null });
      }
      await useDiagramStore.getState().deleteProjectFile(p.filename);
      if (deletingCurrent) {
        // deleteProjectFile only switches away when it was the current file;
        // we detached, so pick a successor ourselves.
        const remaining = await listProjects().catch(() => []);
        if (remaining.length > 0) {
          remaining.sort((a, b) => b.lastModified - a.lastModified);
          await useDiagramStore.getState().switchProject(remaining[0].filename);
        }
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
    await refresh();
  }

  return (
    <div className="modal-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="modal" style={{ width: 480 }}>
        <div className="modal__header">
          <span>📂 Open Project</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body" style={{ padding: '16px 20px' }}>
          {!serverAvailable && (
            <div style={{
              background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6,
              padding: '10px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.5,
              color: '#92400e',
            }}>
              <strong>⚠ Project server not running</strong><br />
              The project list requires the API server. Use "Browse file..." below,
              or re-launch with <strong>START_APP.bat</strong>.
            </div>
          )}

          {/* New Project — start a clean one right from the picker */}
          <div style={{ marginBottom: 12 }}>
            {!newOpen ? (
              <button
                data-testid="picker-new-project"
                onClick={() => setNewOpen(true)}
                disabled={!serverAvailable}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: serverAvailable ? '#1574C4' : '#94a3b8',
                  color: 'white', border: 'none', borderRadius: 6,
                  fontSize: 13, fontWeight: 700, cursor: serverAvailable ? 'pointer' : 'default',
                }}
              >＋ New Project</button>
            ) : (
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    data-testid="picker-new-name"
                    placeholder="Project name"
                    value={newName}
                    autoFocus
                    onChange={e => setNewName(e.target.value)}
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: 13 }}
                  />
                  <input
                    data-testid="picker-new-job"
                    placeholder="Job # (opt.)"
                    value={newJob}
                    onChange={e => setNewJob(e.target.value)}
                    style={{ width: 100, padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: 13 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setNewOpen(false)}
                    style={{ padding: '6px 12px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
                  >Cancel</button>
                  <button type="submit" data-testid="picker-create-btn" disabled={!newName.trim() || creating}
                    style={{ padding: '6px 14px', background: '#1574C4', color: 'white', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !newName.trim() || creating ? 0.5 : 1 }}
                  >{creating ? 'Creating…' : 'Create'}</button>
                </div>
              </form>
            )}
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af' }}>Loading projects...</div>
          )}

          {!loading && error && (
            <div style={{ textAlign: 'center', padding: 24, color: '#dc2626', fontSize: 12 }}>
              Failed to load project list: {error}
            </div>
          )}

          {!loading && !error && projects.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af' }}>
              No projects on the server yet.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
            {projects.map(p => {
              const isActive = p.filename === currentFilename;
              return (
                <div
                  key={p.filename}
                  className="project-list-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    background: isActive ? '#eff6ff' : '#f8fafc',
                    border: `1.5px solid ${isActive ? '#2563eb' : '#e2e8f0'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onClick={() => handleOpen(p.filename)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                      {isActive && (
                        <span style={{
                          fontSize: 9, padding: '1px 6px',
                          background: '#2563eb', color: 'white',
                          borderRadius: 3, fontWeight: 700, letterSpacing: '0.05em',
                          flexShrink: 0,
                        }}>
                          OPEN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      {p.filename} · {p.smCount} SM{p.smCount !== 1 ? 's' : ''} · {relativeTime(p.lastModified)}
                    </div>
                  </div>
                  <button
                    title={`Delete ${p.name}`}
                    data-testid={`picker-delete-${p.filename}`}
                    onClick={(e) => handleDelete(e, p)}
                    style={{
                      flexShrink: 0, background: 'none', border: 'none',
                      cursor: 'pointer', fontSize: 14, color: '#94a3b8',
                      padding: '4px 6px', borderRadius: 4,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                  >🗑</button>
                </div>
              );
            })}
          </div>

          {/* Native-dialog fallback for JSON files outside the projects folder */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Project JSON somewhere else?</span>
            <button
              className="btn"
              onClick={handleBrowse}
              onMouseDown={e => e.stopPropagation()}
              style={{
                background: 'none', border: '1px solid #cbd5e1', borderRadius: 6,
                padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: '#334155',
              }}
            >
              Browse file...
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
