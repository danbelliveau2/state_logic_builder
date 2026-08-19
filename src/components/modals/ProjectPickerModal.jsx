/**
 * ProjectPickerModal — In-app project picker.
 *
 * Lists server projects (GET /api/projects) sorted by last-modified,
 * newest first. Click a project to open it. A secondary "Browse file..."
 * option falls back to the native file dialog for JSON files that live
 * outside the server's projects/ folder (e.g. network job folders).
 *
 * Props:
 *   mode          'newTab'     → clicking a project opens it in a new tab
 *                 'currentTab' → clicking a project loads it in the current tab
 *   onClose       () => void   — close the modal
 *   onBrowseFile  () => void   — trigger the caller's native file-dialog fallback
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

export function ProjectPickerModal({ mode = 'newTab', onClose, onBrowseFile }) {
  const currentFilename = useDiagramStore(s => s.currentFilename);
  const serverAvailable = useDiagramStore(s => s.serverAvailable);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listProjects();
        if (cancelled) return;
        list.sort((a, b) => b.lastModified - a.lastModified);
        setProjects(list);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
