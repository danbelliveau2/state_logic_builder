/**
 * DocumentsDrawer — per-project document dump (v1 simple).
 *
 * Modal listing the files attached to the CURRENT project. Upload by
 * browse / drag-drop / paste; download and delete per file. Files live
 * server-side in projects/_docs/<projectBasename>/ via:
 *   GET/POST   /api/projects/:filename/docs
 *   GET/DELETE /api/projects/:filename/docs/:docname
 *
 * SDC Engineer does NOT read these yet — the purpose note below sets that
 * expectation honestly (consumption is a later milestone).
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Read a File/Blob to raw base64 (no data: prefix). */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function DocumentsDrawer({ onClose }) {
  const currentFilename = useDiagramStore(s => s.currentFilename);
  const projectName = useDiagramStore(s => s.project?.name);

  const [docs, setDocs] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const base = currentFilename
    ? `/api/projects/${encodeURIComponent(currentFilename)}/docs`
    : null;

  async function refresh() {
    if (!base) return;
    try {
      const r = await fetch(base);
      if (!r.ok) throw new Error(`List failed (${r.status})`);
      setDocs(await r.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { refresh(); }, [currentFilename]);

  // Escape closes
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function uploadFiles(fileList) {
    if (!base || !fileList?.length) return;
    setBusy(true);
    try {
      for (const file of fileList) {
        if (file.size > 25 * 1024 * 1024) {
          alert(`${file.name}: too large (max 25 MB)`);
          continue;
        }
        const base64 = await fileToBase64(file);
        const r = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, base64 }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert(`${file.name}: upload failed — ${err.error ?? r.status}`);
        }
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(name) {
    if (!base) return;
    if (!confirm(`Delete "${name}" from this project's documents?`)) return;
    const r = await fetch(`${base}/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(`Delete failed: ${err.error ?? r.status}`);
    }
    await refresh();
  }

  // Paste-to-upload (files or pasted images)
  useEffect(() => {
    function onPaste(e) {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        // Pasted screenshots come in as "image.png" — timestamp them so
        // repeated pastes don't overwrite each other.
        const named = files.map(f => f.name && f.name !== 'image.png'
          ? f
          : new File([f], `pasted_${Date.now()}.png`, { type: f.type }));
        uploadFiles(named);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [currentFilename]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal v2-docs" data-testid="docs-drawer">
        <div className="modal__header">
          <span>Documents — {projectName ?? 'Project'}</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body v2-docs__body">
          <p className="v2-docs__purpose">
            Project documents — SDC Engineer reads these for context when building stations.
          </p>

          {!currentFilename && (
            <div className="v2-docs__empty">
              This project isn't saved on the server yet — save it first to attach documents.
            </div>
          )}

          {currentFilename && (
            <>
              <div
                className={`v2-docs__drop${dragOver ? ' v2-docs__drop--over' : ''}`}
                data-testid="docs-dropzone"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  uploadFiles(Array.from(e.dataTransfer?.files ?? []));
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                {busy ? 'Uploading…' : 'Drop files here, click to browse, or paste (Ctrl+V)'}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
              />

              {error && <div className="v2-docs__error">Couldn't load documents: {error}</div>}

              <div className="v2-docs__list" data-testid="docs-list">
                {docs.length === 0 && !error && (
                  <div className="v2-docs__empty">No documents attached yet.</div>
                )}
                {docs.map(d => (
                  <div key={d.name} className="v2-docs__item">
                    <a
                      className="v2-docs__name"
                      href={`${base}/${encodeURIComponent(d.name)}`}
                      download={d.name}
                      title={`Download ${d.name}`}
                    >{d.name}</a>
                    <span className="v2-docs__meta">{fmtSize(d.size)} · {fmtDate(d.mtime)}</span>
                    <button
                      className="v2-docs__delete"
                      title="Delete document"
                      onClick={() => handleDelete(d.name)}
                    >🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
