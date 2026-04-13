/**
 * DeviceLibraryPicker — modal for browsing, importing, and selecting
 * saved custom device types from the cross-project library.
 */

import { useState, useEffect } from 'react';
import { loadLibrary, removeFromLibrary, importLibrary, exportLibrary } from '../../lib/deviceLibrary.js';

export function DeviceLibraryPicker({ onSelect, onClose }) {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setEntries(loadLibrary());
  }, []);

  const filtered = entries.filter(e =>
    !search || e.label.toLowerCase().includes(search.toLowerCase())
  );

  function handleSelect(entry) {
    onSelect(entry.definition);
    onClose();
  }

  function handleDelete(id) {
    removeFromLibrary(id);
    setEntries(loadLibrary());
  }

  function handleExport() {
    const json = exportLibrary();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'device-library.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const added = importLibrary(ev.target.result);
        setEntries(loadLibrary());
        if (added > 0) alert(`Imported ${added} new device(s).`);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 520, maxHeight: '80vh' }}>
        <div className="modal__header">
          <span>Device Library</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search + actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search library..."
              style={{ flex: 1 }}
              autoFocus
            />
            <button type="button" className="btn btn--sm btn--ghost" onClick={handleImport}>Import</button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={handleExport}>Export</button>
          </div>

          {/* Library list */}
          {filtered.length === 0 ? (
            <div className="props-empty" style={{ padding: 24 }}>
              {entries.length === 0
                ? 'No devices saved to library yet. Save a custom device from the Add Subject modal to start building your library.'
                : 'No matches found.'}
            </div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 400, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filtered.map(entry => (
                <div
                  key={entry.id}
                  className="library-entry"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 6,
                    border: '1px solid #e5e7eb', cursor: 'pointer',
                    background: '#fff',
                  }}
                  onClick={() => handleSelect(entry)}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <span style={{ fontSize: 22 }}>{entry.icon || '🔧'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.label}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>
                      {(entry.definition?.outputs?.length ?? 0)} outputs, {(entry.definition?.inputs?.length ?? 0)} inputs, {(entry.definition?.operations?.length ?? 0)} ops
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm icon-btn--danger"
                    onClick={e => { e.stopPropagation(); handleDelete(entry.id); }}
                    title="Remove from library"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
