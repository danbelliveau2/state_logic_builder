/**
 * ProjectManagerModal — View, create, switch, rename, and delete projects.
 * Projects are stored as JSON files on the server in the projects/ folder.
 */

import { useState, useEffect } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { listProjects } from '../../lib/projectApi.js';

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function ProjectManagerModal() {
  const store = useDiagramStore();
  const currentFilename = useDiagramStore(s => s.currentFilename);
  const serverAvailable = useDiagramStore(s => s.serverAvailable);
  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [renamingFile, setRenamingFile] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  async function refreshList() {
    try {
      const list = await listProjects();
      list.sort((a, b) => b.lastModified - a.lastModified);
      setProjects(list);
    } catch (err) {
      console.error('Failed to list projects:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshList(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    await store.createNewProject(newName.trim());
    setNewName('');
    // Close modal so the user lands on the new (empty) project immediately
    store.closeProjectManager();
  }

  async function handleSwitch(filename) {
    if (filename === currentFilename) {
      store.closeProjectManager();
      return;
    }
    await store.switchProject(filename);
    // switchProject closes modal
  }

  async function handleOpenInNewTab(e, filename) {
    e.stopPropagation();
    await store.openInNewTab(filename);
    store.closeProjectManager();
  }

  async function handleDelete(filename, name) {
    if (!confirm(`Delete project "${name}"?\nThis will permanently remove the file from the server.`)) return;
    await store.deleteProjectFile(filename);
    await refreshList();
  }

  function handleRenameStart(e, filename, currentName) {
    e.stopPropagation();
    setRenamingFile(filename);
    setRenameValue(currentName);
  }

  async function handleRenameConfirm(oldFilename) {
    if (renameValue.trim()) {
      await store.renameProject(oldFilename, renameValue.trim());
    }
    setRenamingFile(null);
    setRenameValue('');
    await refreshList();
  }

  return (
    <div className="modal-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) store.closeProjectManager();
    }}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal__header">
          <span>📁 Projects</span>
          <button className="modal__close" onClick={store.closeProjectManager}>✕</button>
        </div>

        <div className="modal__body" style={{ padding: '16px 20px' }}>
          {/* Server offline warning */}
          {!serverAvailable && (
            <div style={{
              background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6,
              padding: '10px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.5,
              color: '#92400e',
            }}>
              <strong>⚠ Project server not running</strong><br />
              Project save/load/create requires the API server.
              Close the app and re-launch with <strong>START_APP.bat</strong> to enable project management.
            </div>
          )}

          {/* Create new project */}
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              className="form-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New project name..."
              style={{ flex: 1 }}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!newName.trim()}
              style={{ whiteSpace: 'nowrap' }}
            >
              + Create
            </button>
          </form>

          {/* Project list */}
          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af' }}>Loading projects...</div>
          )}

          {!loading && projects.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af' }}>
              No projects yet. Create one above.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
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
                  onClick={() => handleSwitch(p.filename)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renamingFile === p.filename ? (
                      <input
                        className="form-input"
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => handleRenameConfirm(p.filename)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameConfirm(p.filename);
                          if (e.key === 'Escape') { setRenamingFile(null); setRenameValue(''); }
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{ padding: '3px 6px', fontSize: 13, width: '100%' }}
                      />
                    ) : (
                      <>
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
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          {p.smCount} state machine{p.smCount !== 1 ? 's' : ''} · {formatDate(p.lastModified)}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {!isActive && (
                      <button
                        title="Open in new tab"
                        onClick={(e) => handleOpenInNewTab(e, p.filename)}
                        style={{
                          background: 'none', border: '1px solid #1574C4', borderRadius: 4,
                          padding: '3px 6px', cursor: 'pointer', fontSize: 11,
                          color: '#1574C4', fontWeight: 600,
                        }}
                      >+ Tab</button>
                    )}
                    <button
                      title="Rename"
                      onClick={(e) => handleRenameStart(e, p.filename, p.name)}
                      style={{
                        background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
                        padding: '3px 6px', cursor: 'pointer', fontSize: 12,
                      }}
                    >✏️</button>
                    <button
                      title="Delete"
                      onClick={() => handleDelete(p.filename, p.name)}
                      disabled={projects.length <= 1}
                      style={{
                        background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
                        padding: '3px 6px', cursor: 'pointer', fontSize: 12,
                        opacity: projects.length <= 1 ? 0.3 : 1,
                      }}
                    >🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
