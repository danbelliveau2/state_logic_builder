/**
 * FilesMenu — "Files ▾": the output folder + legacy exporters, moved OUT of
 * the top bar's Build ▾ menu (which is gone — Dan: one action button total)
 * and INTO the Jarvis/code page, because they're about output files and
 * that's where the files live.
 *
 * Contents (verbatim from the old BuildMenu, minus Compile/Generate which
 * belong to the top-right pipeline button):
 *   📁 Open output folder  — shows + copies the generated/<project>/ path
 *   Legacy ▾               — rule-based exporters + project file load
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { downloadL5X, downloadAllL5XAsZip } from '../lib/l5xExporter.js';
import { downloadControllerL5X } from '../lib/controllerL5xExporter.js';

export function FilesMenu() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const sm = store.getActiveSm();
  const sms = project?.stateMachines ?? [];
  const trackingFields = project?.partTracking?.fields ?? [];

  const [open, setOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false); setLegacyOpen(false); setOutputOpen(false);
      }
    }
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); setLegacyOpen(false); setOutputOpen(false); } }
    document.addEventListener('mousedown', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleExportL5X() {
    if (!sm) return alert('No state machine selected.');
    if ((sm.nodes ?? []).length === 0) return alert('No states defined. Add at least one state before exporting.');
    try {
      downloadL5X(sm, sms, trackingFields, project?.machineConfig ?? null);
    } catch (err) {
      alert(`Export error: ${err.message}`);
      console.error(err);
    }
  }
  async function handleExportAllL5X() {
    const exportable = sms.filter(s => (s.nodes ?? []).length > 0);
    if (exportable.length === 0) return alert('No state machines with states to export.');
    try {
      await downloadAllL5XAsZip(sms, trackingFields, project);
    } catch (err) {
      alert(`Export error: ${err.message}`);
      console.error(err);
    }
  }
  function handleExportController() {
    const exportable = sms.filter(s => (s.nodes ?? []).length > 0);
    if (exportable.length === 0) return alert('No state machines with states to export.');
    try {
      downloadControllerL5X(project);
    } catch (err) {
      alert(`Export error: ${err.message}`);
      console.error(err);
    }
  }
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

  const outputPath = `generated/${(project?.name ?? 'project').replace(/[^a-zA-Z0-9_\- ]/g, '').trim()}/`;
  async function copyOutputPath() {
    try {
      await navigator.clipboard.writeText(outputPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — path is still visible to copy manually */ }
  }

  return (
    <div className="v2-build" ref={menuRef} style={{ marginLeft: 'auto' }}>
      <button
        className={`v2-build__btn${open ? ' v2-build__btn--open' : ''}`}
        data-testid="files-menu-btn"
        onClick={() => { setOpen(o => !o); setLegacyOpen(false); setOutputOpen(false); }}
        title="Output folder + legacy exporters"
      >
        Files ▾
      </button>
      {open && (
        <div className="v2-build__menu">
          <button className="v2-build__item" onClick={() => setOutputOpen(o => !o)}>
            <span className="v2-build__item-label">📁 Open output folder</span>
            <span className="v2-build__item-hint">Where generated L5X files land</span>
          </button>
          {outputOpen && (
            <div className="v2-build__output">
              <code>{outputPath}</code>
              <button className="v2-build__copy" onClick={copyOutputPath}>
                {copied ? 'Copied ✓' : 'Copy path'}
              </button>
              <div className="v2-build__output-note">Relative to the app folder (where START_APP.bat runs).</div>
            </div>
          )}

          <div className="v2-build__sep" />

          <button className="v2-build__item" onClick={() => setLegacyOpen(o => !o)}>
            <span className="v2-build__item-label">Legacy {legacyOpen ? '▴' : '▾'}</span>
            <span className="v2-build__item-hint">Rule-based exporter + file load</span>
          </button>
          {legacyOpen && (
            <div className="v2-build__sub">
              <button className="v2-build__item" disabled={!sm} onClick={() => { setOpen(false); handleExportL5X(); }}>
                <span className="v2-build__item-label">↓ Export L5X (legacy)</span>
              </button>
              <button className="v2-build__item" onClick={() => { setOpen(false); handleExportAllL5X(); }}>
                <span className="v2-build__item-label">↓ Export All (ZIP)</span>
              </button>
              <button className="v2-build__item" onClick={() => { setOpen(false); handleExportController(); }}>
                <span className="v2-build__item-label">↓ Export Controller</span>
              </button>
              <button className="v2-build__item" onClick={() => { setOpen(false); fileInputRef.current?.click(); }}>
                <span className="v2-build__item-label">📂 Load from file…</span>
              </button>
            </div>
          )}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  );
}
