/**
 * Toolbar - Top application bar.
 * Project name, SM dropdown (with reorder), recipe dropdown, export, save/load.
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { downloadL5X, downloadAllL5XAsZip, exportProjectJSON } from '../lib/l5xExporter.js';
import { downloadControllerL5X } from '../lib/controllerL5xExporter.js';
import { buildProgramName } from '../lib/tagNaming.js';
import { getProjectIoMap, IO_SECTION_ORDER, IO_SECTION_META } from '../lib/getProjectIoMap.js';
import { ProjectPickerModal } from './modals/ProjectPickerModal.jsx';
import { JarvisGenerateModal } from './modals/JarvisGenerateModal.jsx';
import { JarvisDescribeModal } from './modals/JarvisDescribeModal.jsx';
import { SpecEditorModal } from './modals/SpecEditorModal.jsx';

// ── Reorderable list popup ──────────────────────────────────────────────────────
function ReorderPopup({ items, labelFn, onReorder, onClose, title }) {
  const dragIdx = useRef(null);
  const overIdx = useRef(null);
  const [, forceUpdate] = useState(0);

  function handleDragStart(i) { dragIdx.current = i; }
  function handleDragOver(e, i) {
    e.preventDefault();
    if (overIdx.current !== i) { overIdx.current = i; forceUpdate(n => n + 1); }
  }
  function handleDrop() {
    if (dragIdx.current !== null && overIdx.current !== null && dragIdx.current !== overIdx.current) {
      onReorder(dragIdx.current, overIdx.current);
    }
    dragIdx.current = null;
    overIdx.current = null;
    forceUpdate(n => n + 1);
  }

  return (
    <div className="reorder-popup__backdrop" onClick={onClose}>
      <div className="reorder-popup" onClick={e => e.stopPropagation()}>
        <div className="reorder-popup__header">
          <span className="reorder-popup__title">{title}</span>
          <button className="reorder-popup__close" onClick={onClose}>×</button>
        </div>
        <div className="reorder-popup__hint">Drag to reorder</div>
        <div className="reorder-popup__list">
          {items.map((item, i) => (
            <div
              key={item.id ?? i}
              className={`reorder-popup__item${overIdx.current === i ? ' reorder-popup__item--over' : ''}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={handleDrop}
              onDragEnd={() => { dragIdx.current = null; overIdx.current = null; forceUpdate(n => n + 1); }}
            >
              <span className="reorder-popup__grip">⠿</span>
              <span className="reorder-popup__label">{labelFn(item, i)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Station type color map (matches MachineConfigEditor STATION_TYPES) ─────
const STATION_TYPE_COLORS = {
  load:    '#1574C4',
  process: '#7B2D8E',
  verify:  '#E8A317',
  reject:  '#DC2626',
  unload:  '#5BB0D8',
  indexer: '#0d9488',
  feed:    '#ca8a04',
  robot:   '#9333ea',
  empty:   '#94a3b8',
};

// Derive a station type for an SM by: (1) machineConfig station lookup,
// (2) machineConfig station with matching stationNumber, (3) name-pattern fallback.
function getSmStationType(sm, machineConfig) {
  if (!sm) return null;
  const stations = machineConfig?.stations ?? [];
  const byId = stations.find(st => (st.smIds ?? []).includes(sm.id));
  if (byId?.type) return byId.type;
  const byNum = stations.find(st => st.number === sm.stationNumber);
  if (byNum?.type) return byNum.type;
  const n = (sm.displayName ?? sm.name ?? '').toLowerCase();
  if (/unload/.test(n)) return 'unload';
  if (/reject/.test(n)) return 'reject';
  if (/load/.test(n))   return 'load';
  if (/verify|inspect|check|test/.test(n)) return 'verify';
  if (/index|dial/.test(n))  return 'indexer';
  if (/feed/.test(n))   return 'feed';
  if (/robot/.test(n))  return 'robot';
  if (/process/.test(n)) return 'process';
  return null;
}

// ── I/O Map quick-look popup ────────────────────────────────────────────────
// Drawer-style popup anchored under the I/O button. Same data the L5X
// exporter uses (`getProjectIoMap` reads `getDeviceTags` for every device).
// Layout: SM selector on top + side-by-side INPUTS card (left) and OUTPUTS
// card (right) so both columns are visible without toggling. Internal tags
// (debounce / delay timers — confusing for non-PLC users) hidden by
// default; "Show internal" toggle reveals them.
function IoMapPopup({ project, activeSmId, onClose }) {
  const ioMap = useMemo(() => getProjectIoMap(project), [project]);
  const [search, setSearch] = useState('');
  const [showInternal, setShowInternal] = useState(false);
  // SM filter — defaults to the canvas's active SM so the engineer sees
  // "what's on this machine" first. Switch to '__all__' to see everything
  // wired across the whole project.
  const [smFilter, setSmFilter] = useState(activeSmId || '__all__');

  const filterBySm = (e) => smFilter === '__all__' || e.smId === smFilter;
  const matches = (e) => {
    if (!filterBySm(e)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return e.tagName.toLowerCase().includes(q)
      || e.deviceName.toLowerCase().includes(q)
      || (e.description || '').toLowerCase().includes(q);
  };

  const inputs   = useMemo(() => [...ioMap.bySection.digitalInput, ...ioMap.bySection.analogInput].filter(matches), [ioMap, search, smFilter]);
  const outputs  = useMemo(() => [...ioMap.bySection.digitalOutput, ...ioMap.bySection.analogOutput].filter(matches), [ioMap, search, smFilter]);
  const internal = useMemo(() => ioMap.bySection.internal.filter(matches), [ioMap, search, smFilter]);
  const sms = project?.stateMachines ?? [];

  const renderRow = (e) => {
    const meta = IO_SECTION_META[e.section];
    return (
      <div
        key={`${e.smId}-${e.tagName}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '34px 1fr',
          alignItems: 'center', gap: 6,
          padding: '4px 8px',
          borderBottom: '1px solid #f1f5f9',
          fontSize: 11,
        }}
        title={`${e.tagName} (${e.dataType}) — ${e.description}\n${e.station} · ${e.deviceName}`}
      >
        <span style={{
          padding: '1px 5px', borderRadius: 3, textAlign: 'center',
          background: meta.color, color: '#fff', fontSize: 9, fontWeight: 700,
        }}>{meta.abbr}</span>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontFamily: 'Consolas, monospace', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {e.tagName}
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {e.station} · {e.deviceName}
          </div>
        </div>
      </div>
    );
  };

  const renderColumn = (title, color, rows) => (
    <div style={{
      flex: 1, minWidth: 0,
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '6px 10px',
        background: color,
        color: '#fff',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>{title}</span>
        <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.85 }}>{rows.length}</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 480 }}>
        {rows.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
            None
          </div>
        )}
        {rows.map(renderRow)}
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 1000,
        width: 720,
        maxHeight: 640,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>I/O Map</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {inputs.length + outputs.length} tags · auto-derived from devices
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: 'none', border: 'none',
            fontSize: 18, cursor: 'pointer', color: '#64748b', padding: '0 4px',
            lineHeight: 1,
          }}
          title="Close"
        >×</button>
      </div>

      {/* SM filter + search row — defaults to active SM. Switch to "All
          state machines" to see every tag in the project at once. */}
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
        background: '#f8fafc',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
          STATE MACHINE
        </span>
        <select
          value={smFilter}
          onChange={e => setSmFilter(e.target.value)}
          style={{
            fontSize: 12, fontWeight: 600,
            padding: '5px 10px',
            border: '1px solid #cbd5e1', borderRadius: 4,
            background: '#fff', color: '#0f172a',
            minWidth: 220,
          }}
        >
          <option value="__all__">All state machines</option>
          {sms.map(sm => {
            const station = `S${String(sm.stationNumber ?? 0).padStart(2, '0')}`;
            return (
              <option key={sm.id} value={sm.id}>
                {station} — {sm.displayName ?? sm.name ?? '(unnamed)'}
              </option>
            );
          })}
        </select>
        <input
          type="text"
          placeholder="Search tag, device…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto', width: 200,
            fontSize: 12, padding: '5px 10px',
            border: '1px solid #cbd5e1', borderRadius: 4,
          }}
        />
      </div>

      {/* Side-by-side cards */}
      <div style={{
        flex: 1, padding: 12,
        display: 'flex', gap: 12,
        overflow: 'hidden',
      }}>
        {renderColumn('INPUTS',  '#5a9a48', inputs)}
        {renderColumn('OUTPUTS', '#1574C4', outputs)}
      </div>

      {/* Internal tags — hidden by default. Debounce / delay timers etc.
          aren't strictly I/O; they're program-internal helpers used by the
          AOIs. New users find them confusing because they don't match
          anything in the wiring. */}
      {internal.length > 0 && (
        <div style={{
          borderTop: '1px solid #e2e8f0',
          padding: '6px 14px',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: '#475569',
          flexShrink: 0,
        }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInternal}
              onChange={e => setShowInternal(e.target.checked)}
            />
            <span>Show internal helper tags ({internal.length})</span>
          </label>
          <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>
            — debounce / delay timers, not wired I/O
          </span>
        </div>
      )}
      {showInternal && internal.length > 0 && (
        <div style={{
          maxHeight: 160, overflow: 'auto',
          borderTop: '1px solid #e2e8f0',
          padding: 8,
        }}>
          {internal.map(renderRow)}
        </div>
      )}
      {inputs.length === 0 && outputs.length === 0 && internal.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          No devices yet. Add devices in any SM to populate the I/O map.
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const store = useDiagramStore();
  const { project, activeSmId, serverAvailable } = store;
  const sms = project.stateMachines ?? [];
  const sm = store.getActiveSm();
  const fileInputRef = useRef(null);
  const smDropdownRef = useRef(null);
  const recipeDropdownRef = useRef(null);

  const trackingFields = store.project?.partTracking?.fields ?? [];

  // Dropdown state
  const [smDropdownOpen, setSmDropdownOpen] = useState(false);
  const [syncPickerForSmId, setSyncPickerForSmId] = useState(null);
  const [recipeDropdownOpen, setRecipeDropdownOpen] = useState(false);
  const [smReorderOpen, setSmReorderOpen] = useState(false);
  const [recipeReorderOpen, setRecipeReorderOpen] = useState(false);
  // I/O quick-look popup
  const [ioPopupOpen, setIoPopupOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  // JARVIS AI modals + dropdown
  const [jarvisGenerateOpen, setJarvisGenerateOpen] = useState(false);
  const [jarvisDescribeOpen, setJarvisDescribeOpen] = useState(false);
  const [specEditorOpen, setSpecEditorOpen] = useState(false);
  const [jarvisMenuOpen, setJarvisMenuOpen] = useState(false);
  const ioPopupRef = useRef(null);
  const jarvisMenuRef = useRef(null);

  // Jarvis dropdown — close on outside click / Esc (capture phase, same
  // reasoning as the I/O popup below).
  useEffect(() => {
    if (!jarvisMenuOpen) return;
    function onClick(e) {
      if (jarvisMenuRef.current && !jarvisMenuRef.current.contains(e.target)) {
        setJarvisMenuOpen(false);
      }
    }
    function onKey(e) { if (e.key === 'Escape') setJarvisMenuOpen(false); }
    document.addEventListener('mousedown', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [jarvisMenuOpen]);

  // I/O popup — close on outside click and Esc. Uses CAPTURE phase so
  // React Flow / nested stopPropagation handlers can't swallow the click
  // before we see it (the previous version used non-capture which let
  // React Flow's pane handler eat the event, leaving the popup stuck open).
  useEffect(() => {
    if (!ioPopupOpen) return;
    function onClick(e) {
      if (ioPopupRef.current && !ioPopupRef.current.contains(e.target)) {
        setIoPopupOpen(false);
      }
    }
    function onKey(e) { if (e.key === 'Escape') setIoPopupOpen(false); }
    document.addEventListener('mousedown', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ioPopupOpen]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!smDropdownOpen && !recipeDropdownOpen) return;
    function handleClick(e) {
      if (smDropdownOpen && smDropdownRef.current && !smDropdownRef.current.contains(e.target)) {
        setSmDropdownOpen(false);
      }
      if (recipeDropdownOpen && recipeDropdownRef.current && !recipeDropdownRef.current.contains(e.target)) {
        setRecipeDropdownOpen(false);
      }
    }
    // Use setTimeout so the click that opened the dropdown doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handleClick); };
  }, [smDropdownOpen, recipeDropdownOpen]);

  function handleExportL5X() {
    if (!sm) return alert('No state machine selected.');
    if (sm.nodes.length === 0) return alert('No states defined. Add at least one state before exporting.');
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
      const stackLine = (err.stack ?? '').split('\n').find(l => l.includes('l5xExporter')) || err.stack?.split('\n')[1] || '';
      alert(`Export error: ${err.message}\n\nAt: ${stackLine.trim()}`);
      console.error(err);
    }
  }

  function handleExportController() {
    const exportable = sms.filter(s => (s.nodes ?? []).length > 0);
    if (exportable.length === 0) return alert('No state machines with states to export.');
    try {
      downloadControllerL5X(project);
    } catch (err) {
      const stackLine = (err.stack ?? '').split('\n').find(l => l.includes('Exporter')) || err.stack?.split('\n')[1] || '';
      alert(`Export error: ${err.message}\n\nAt: ${stackLine.trim()}`);
      console.error(err);
    }
  }

  // Track unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const projectRef = useRef(project);

  useEffect(() => {
    if (projectRef.current !== project && projectRef.current !== null) {
      setHasUnsavedChanges(true);
    }
    projectRef.current = project;
  }, [project]);

  // Keep window globals in sync so Electron's close handler can read them
  // without needing an async IPC round-trip at close time.
  useEffect(() => { window.__unsavedChanges__ = hasUnsavedChanges; }, [hasUnsavedChanges]);
  useEffect(() => { window.__currentProject__ = project; }, [project]);

  const handleSaveProject = useCallback(async () => {
    // Always download JSON file so the user has a local copy
    exportProjectJSON(project);
    setHasUnsavedChanges(false);

    // Also save to server if available (background, non-blocking)
    if (serverAvailable) {
      try {
        await store.saveCurrentProject();
      } catch (err) {
        console.warn('Server save failed (JSON download still succeeded):', err.message);
      }
    }
  }, [serverAvailable, project, store]);

  // Ctrl+S to save
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveProject();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveProject]);

  function handleBrowseFile() {
    // Electron: use native open dialog to get the real file path,
    // then cache it so Save can overwrite directly with no prompts.
    if (window.electronAPI?.openFile) {
      window.electronAPI.openFile().then(result => {
        if (!result.success) return;
        try {
          const loaded = JSON.parse(result.content);
          if (!loaded.stateMachines) throw new Error('Invalid project file');
          store.importProject(loaded);
          // Cache file path keyed by project ID so Save writes back to same location
          const key = `savePath_${loaded.id ?? loaded.name}`;
          localStorage.setItem(key, result.filePath);
        } catch (err) {
          alert(`Failed to load project: ${err.message}`);
        }
      });
      return;
    }
    // Browser fallback — FileReader (no path access, dialog still shown on Save)
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
        store.importProject(loaded);
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
        <span className="toolbar__logo" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <svg viewBox="27 0 113 61" width="40" height="22" xmlns="http://www.w3.org/2000/svg">
            <path d="M83.4835 60.1812C114.598 60.1812 139.822 46.7092 139.822 30.0906C139.822 13.472 114.598 0 83.4835 0C52.3689 0 27.1455 13.472 27.1455 30.0906C27.1455 46.7092 52.3689 60.1812 83.4835 60.1812Z" fill="#befa4f"/>
            <path d="M98.2318 40.056C99.5818 38.7032 100.647 37.0961 101.366 35.3287C102.085 33.5612 102.442 31.6689 102.418 29.7623C102.42 29.4749 102.44 29.1879 102.48 28.9033C102.906 22.9645 107.664 19.3373 116.269 19.3373C118.925 19.2905 121.573 19.6565 124.116 20.4222C124.234 20.4655 124.358 20.4879 124.483 20.4885C124.711 20.4971 124.934 20.4198 125.107 20.272C125.28 20.1242 125.39 19.9168 125.416 19.6914L125.808 15.907C125.802 15.7011 125.732 15.5019 125.61 15.336C125.487 15.17 125.317 15.045 125.121 14.9775C121.931 14.1319 118.639 13.7224 115.337 13.7602C102.413 13.7602 94.7509 19.6718 94.3365 28.9921C94.3281 29.1995 94.3202 29.6864 94.3077 30.006C94.2988 31.5338 93.9774 33.0438 93.3631 34.4439C92.1556 37.0574 89.8882 38.4515 87.0638 39.2035C85.1018 39.6805 83.0891 39.9198 81.0695 39.9161C79.6601 39.945 78.2495 39.9217 76.7669 39.9217V22.5684C76.761 22.3864 76.6827 22.2141 76.5493 22.0894C76.4159 21.9647 76.2383 21.8978 76.0554 21.9034H69.4401C69.2572 21.8978 69.0795 21.9647 68.9461 22.0894C68.8127 22.2141 68.7344 22.3864 68.7285 22.5684C68.7285 24.909 68.7285 27.2496 68.7285 29.5903C68.7285 34.4845 68.7287 39.3788 68.7291 44.2732C68.7408 44.6293 68.894 44.9662 69.1549 45.21C69.4159 45.4539 69.7634 45.5847 70.1211 45.5739C73.711 45.5752 77.3009 45.5842 80.8907 45.5715C84.434 45.638 87.9654 45.1427 91.3523 44.1041C93.3537 43.4806 95.2355 42.5266 96.9192 41.2822C96.9333 41.2699 96.9409 41.258 96.9555 41.246C97.409 40.8618 97.8345 40.4651 98.2318 40.056Z" fill="#1574C4"/>
            <path d="M92.3274 15.5056C88.7096 14.1184 84.8999 13.6997 81.0251 13.6836L53.574 13.6918L53.5636 13.6985C44.0479 13.7909 39.373 16.9175 39.373 22.4146C39.373 27.2423 42.6591 30.1871 50.7024 32.1137C57.2257 33.6859 59.0401 34.8592 59.0401 36.8967C59.0401 39.0224 57.1762 40.2183 51.6343 40.2183C47.6129 40.2183 44.2775 39.7752 41.3102 38.624C41.1849 38.5735 41.0524 38.5435 40.9175 38.5351C40.6875 38.5315 40.4645 38.6135 40.2921 38.7652C40.1197 38.9168 40.0104 39.127 39.9857 39.3546L39.5446 43.2741V43.3623C39.5601 43.5543 39.6307 43.7378 39.748 43.891C39.8654 44.0441 40.0245 44.1604 40.2064 44.226C43.9394 45.277 47.8042 45.7915 51.6834 45.7538C62.7673 45.7538 67.1814 42.5652 67.1814 36.5863C67.1814 31.8032 63.9447 29.0135 55.2633 26.7547C49.3779 25.2046 47.5143 24.0975 47.5143 22.1489C47.5143 20.4503 48.9675 19.357 54.0149 19.2696H78.5911V19.2563C81.3333 19.1576 84.077 19.4011 86.7584 19.981C89.4953 20.6527 91.7406 21.9166 93.0618 24.2673C93.1237 24.3774 93.1835 24.49 93.2414 24.605C93.2794 24.4871 93.3192 24.3696 93.3606 24.2523C94.1775 21.9791 95.4727 19.9058 97.1597 18.1711C95.6918 17.0472 94.0629 16.1487 92.3274 15.5056Z" fill="#1574C4"/>
            <path d="M125.661 39.7882C125.635 39.563 125.525 39.3557 125.352 39.2079C125.18 39.0601 124.957 38.9828 124.729 38.9915C124.596 38.992 124.463 39.0144 124.336 39.0577C121.797 39.8843 119.137 40.2808 116.465 40.2304C110.066 40.2304 105.642 38.3357 103.645 34.7709C103.593 34.6785 103.543 34.5849 103.495 34.4902C103.459 34.6103 103.422 34.73 103.384 34.8492C102.609 37.2409 101.293 39.4235 99.5371 41.2289C103.156 44.1665 108.551 45.8082 115.484 45.8082C118.818 45.8487 122.143 45.4392 125.367 44.5909C125.553 44.5293 125.717 44.4148 125.839 44.2614C125.961 44.108 126.036 43.9225 126.053 43.7277L125.661 39.7882Z" fill="#1574C4"/>
          </svg>
        </span>
        <span className="toolbar__title">SDC State Logic Builder</span>
      </div>

      {/* I/O Map quick-look — replaces the never-used project-folder button.
          Auto-derived from devices used across all SMs; same data the L5X
          exporter emits, so what's listed here matches Studio 5000 exactly.
          Project name still shows in the tab bar above; project switching
          lives in the project manager modal (rarely needed). */}
      <div style={{ position: 'relative' }} ref={ioPopupRef}>
        <button
          className="btn btn--ghost"
          onClick={() => setIoPopupOpen(o => !o)}
          title="I/O Map — every input / output the project will emit"
          style={{
            fontWeight: 700,
            fontSize: 15,
            padding: '8px 16px',
            letterSpacing: '0.04em',
            background: ioPopupOpen ? '#0072B5' : 'rgba(255,255,255,0.10)',
            color: '#fff',
            border: '1px solid ' + (ioPopupOpen ? '#0072B5' : 'rgba(255,255,255,0.25)'),
            borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>◉</span>
          <span>I/O</span>
        </button>
        {ioPopupOpen && (
          <IoMapPopup
            project={project}
            activeSmId={activeSmId}
            onClose={() => setIoPopupOpen(false)}
          />
        )}
      </div>
      <button
        className={`btn btn--ghost toolbar__setup-btn${store.activeView === 'projectSetup' ? ' toolbar__setup-btn--active' : ''}`}
        onClick={() => store.setActiveView(store.activeView === 'projectSetup' ? 'canvas' : 'projectSetup')}
        title="Project Setup — machine config & standards"
      >
        ⚙ Setup
      </button>
      {/* Jarvis dropdown — groups the Jarvis entry points (Describe, Station
          Spec) behind one button; the toolbar is width-crowded at 1280px. */}
      <div style={{ position: 'relative' }} ref={jarvisMenuRef}>
        <button
          className="btn btn--ghost"
          onClick={() => setJarvisMenuOpen(o => !o)}
          title="JARVIS — describe your station or explain it for the station spec"
          style={{
            fontWeight: 600,
            color: '#fff',
            background: jarvisMenuOpen ? '#0072B5' : 'rgba(255,255,255,0.10)',
            border: '1px solid ' + (jarvisMenuOpen ? '#0072B5' : 'rgba(255,255,255,0.25)'),
            borderRadius: 6,
          }}
        >
          ✨ Jarvis ▾
        </button>
        {jarvisMenuOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
            minWidth: 220, background: '#fff', border: '1px solid #cbd5e1',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            padding: 4, display: 'flex', flexDirection: 'column',
          }}>
            {[
              {
                icon: '🎙', label: 'Describe Station',
                hint: 'Talk through the station; JARVIS drafts the diagram',
                onClick: () => { setJarvisMenuOpen(false); setJarvisDescribeOpen(true); },
              },
              {
                icon: '📋', label: 'Station Spec',
                hint: 'Explain the station in your own words; JARVIS extracts the spec',
                onClick: () => { setJarvisMenuOpen(false); setSpecEditorOpen(true); },
                disabled: !sm,
              },
            ].map(item => (
              <button
                key={item.label}
                onClick={item.onClick}
                disabled={item.disabled}
                style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left',
                  background: 'none', border: 'none', borderRadius: 6,
                  padding: '8px 10px', cursor: item.disabled ? 'default' : 'pointer',
                  opacity: item.disabled ? 0.45 : 1,
                }}
                onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = '#e8f0fa'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ fontSize: 15, lineHeight: 1.2 }}>{item.icon}</span>
                <span>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{item.label}</span>
                  <span style={{ display: 'block', fontSize: 10, color: '#64748b' }}>{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="toolbar__divider" />

      {/* SM dropdown selector */}
      <div className="toolbar__sm-selector" ref={smDropdownRef}>
        <button
          className="toolbar__sm-active"
          onClick={() => setSmDropdownOpen(o => !o)}
          title={sm ? buildProgramName(sm.stationNumber, sm.name) : 'Select state machine'}
        >
          {sm ? (
            <>
              <span
                className="toolbar__sm-station"
                style={(() => {
                  const t = getSmStationType(sm, project.machineConfig);
                  return t && STATION_TYPE_COLORS[t] ? { background: STATION_TYPE_COLORS[t] } : undefined;
                })()}
              >S{String(sm.stationNumber).padStart(2, '0')}</span>
              <span className="toolbar__sm-name">{sm.displayName ?? sm.name}</span>
            </>
          ) : (
            <span style={{ color: '#8896a8' }}>No SM</span>
          )}
        </button>

        {smDropdownOpen && (
          <div className="toolbar__sm-dropdown">
            {[...sms].sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999)).map((s, i) => {
              const smType = getSmStationType(s, project.machineConfig);
              const smColor = smType ? STATION_TYPE_COLORS[smType] : null;
              return (
              <div key={s.id}>
                <div
                  className={`toolbar__sm-item${s.id === activeSmId ? ' toolbar__sm-item--active' : ''}`}
                  onClick={() => { store.setActiveSm(s.id); setSmDropdownOpen(false); }}
                >
                  <span
                    className="toolbar__sm-item-station"
                    style={smColor ? { background: smColor } : undefined}
                    title={smType ? smType.charAt(0).toUpperCase() + smType.slice(1) : undefined}
                  >S{String(s.stationNumber).padStart(2, '0')}</span>
                  <span className="toolbar__sm-item-name">{s.displayName ?? s.name}</span>
                  <button
                    className="toolbar__sm-item-action"
                    title="Overwrite this SM from another SM (keeps name/station number)"
                    onClick={e => {
                      e.stopPropagation();
                      setSyncPickerForSmId(syncPickerForSmId === s.id ? null : s.id);
                    }}
                    style={{ color: '#f59e0b', fontSize: 13 }}
                  >⟲</button>
                  <button
                    className="toolbar__sm-item-action"
                    title="Duplicate state machine"
                    onClick={e => {
                      e.stopPropagation();
                      store.duplicateStateMachine(s.id);
                      setSmDropdownOpen(false);
                    }}
                    style={{ color: '#60a5fa', fontSize: 13 }}
                  >⧉</button>
                  <button
                    className="toolbar__sm-item-delete"
                    title="Delete state machine"
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(`Delete state machine "${s.displayName ?? s.name}"?`)) {
                        store.deleteStateMachine(s.id);
                      }
                    }}
                  >×</button>
                </div>
                {syncPickerForSmId === s.id && (
                  <div className="toolbar__sm-sync-picker" onClick={e => e.stopPropagation()}>
                    <div className="toolbar__sm-sync-picker-title">
                      Overwrite <b>{s.displayName ?? s.name}</b> with content from:
                    </div>
                    {sms.filter(src => src.id !== s.id).length === 0 ? (
                      <div className="toolbar__sm-sync-picker-empty">No other SMs available</div>
                    ) : (
                      [...sms].filter(src => src.id !== s.id)
                        .sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999))
                        .map(src => (
                          <button
                            key={src.id}
                            className="toolbar__sm-sync-picker-item"
                            onClick={() => {
                              if (confirm(
                                `Overwrite "${s.displayName ?? s.name}" with the contents of "${src.displayName ?? src.name}"?\n\n` +
                                `This replaces all nodes, edges, devices, and outputs. The station name and number are kept. This can be undone with Ctrl+Z.`
                              )) {
                                store.overwriteStateMachineFrom(s.id, src.id);
                                setSyncPickerForSmId(null);
                                setSmDropdownOpen(false);
                              }
                            }}
                          >
                            <span className="toolbar__sm-item-station">S{String(src.stationNumber).padStart(2, '0')}</span>
                            <span>{src.displayName ?? src.name}</span>
                          </button>
                        ))
                    )}
                    <button
                      className="toolbar__sm-sync-picker-cancel"
                      onClick={() => setSyncPickerForSmId(null)}
                    >Cancel</button>
                  </div>
                )}
              </div>
              );
            })}
            <div className="toolbar__sm-dropdown-actions">
              <button
                className="toolbar__sm-dropdown-btn"
                onClick={() => { store.openNewSmModal(); setSmDropdownOpen(false); }}
              >+ New SM</button>
              <button
                className="toolbar__sm-dropdown-btn"
                onClick={() => { setSmReorderOpen(true); setSmDropdownOpen(false); }}
              >↕ Reorder</button>
            </div>
          </div>
        )}
      </div>

      {/* Recipe dropdown selector */}
      {(() => {
        const recipes = project.recipes ?? [];
        const variants = project.sequenceVariants ?? [];
        const activeRecipe = recipes.find(r => r.id === store.activeRecipeId);
        const isCustomSeq = activeRecipe?.customSequence || activeRecipe?.sequenceVariantId;
        return (
          <div className="toolbar__sm-selector" ref={recipeDropdownRef}>
            <button
              className="toolbar__sm-active"
              onClick={() => setRecipeDropdownOpen(o => !o)}
              title={activeRecipe ? activeRecipe.name : 'Select recipe'}
              style={isCustomSeq ? { borderColor: '#0072B5' } : undefined}
            >
              {activeRecipe ? (
                <span className="toolbar__sm-name">{activeRecipe.name}</span>
              ) : (
                <span style={{ color: '#8896a8' }}>{recipes.length > 0 ? 'Select Recipe' : 'No Recipes'}</span>
              )}
              <span className="toolbar__sm-chevron">{recipeDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {recipeDropdownOpen && (
              <div className="toolbar__sm-dropdown">
                {recipes.map(r => {
                  const isDefault = r.id === (project.defaultRecipeId ?? recipes[0]?.id);
                  const vName = r.sequenceVariantId
                    ? variants.find(v => v.id === r.sequenceVariantId)?.name
                    : null;
                  return (
                    <div
                      key={r.id}
                      className={`toolbar__sm-item${r.id === store.activeRecipeId ? ' toolbar__sm-item--active' : ''}`}
                      onClick={() => { store.setActiveRecipe(r.id); setRecipeDropdownOpen(false); }}
                    >
                      <span className="toolbar__sm-item-name">{r.name}</span>
                      {isDefault && (
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#f59e0b', color: '#fff', fontWeight: 700 }}>DEFAULT</span>
                      )}
                      {r.customSequence && (
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#0072B5', color: '#fff', fontWeight: 700 }}>{vName ?? 'CUSTOM'}</span>
                      )}
                    </div>
                  );
                })}
                <div className="toolbar__sm-dropdown-actions">
                  <button
                    className="toolbar__sm-dropdown-btn"
                    onClick={() => { store.openRecipeManager(); setRecipeDropdownOpen(false); }}
                  >Manage Recipes</button>
                  {recipes.length > 1 && (
                    <button
                      className="toolbar__sm-dropdown-btn"
                      onClick={() => { setRecipeReorderOpen(true); setRecipeDropdownOpen(false); }}
                    >↕ Reorder</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {/* Right actions */}
      <div className="toolbar__actions">
        <button className="toolbar__icon-btn" onClick={() => store.undo()} disabled={store._past.length === 0} title="Undo (Ctrl+Z)">↩</button>
        <button className="toolbar__icon-btn" onClick={() => store.redo()} disabled={store._future.length === 0} title="Redo (Ctrl+Y)">↪</button>
        <div className="toolbar__divider" />

        <button
          className="btn btn--primary"
          onClick={() => setJarvisGenerateOpen(true)}
          disabled={!sm || (sm.nodes ?? []).length === 0}
          title="Generate L5X with JARVIS AI — live progress, validation, and auto-save"
        >
          ✨ Generate (Jarvis)
        </button>

        <button
          className="btn btn--primary"
          onClick={handleExportL5X}
          disabled={!sm}
          title="Export current state machine to L5X (legacy rule-based exporter)"
        >
          ↓ Export L5X (legacy)
        </button>

        {sms.length > 1 && (
          <button
            className="btn btn--secondary"
            onClick={handleExportAllL5X}
            title="Export all state machines as separate L5X files (ZIP)"
          >
            ↓ Export All
          </button>
        )}

        <button
          className="btn btn--primary"
          onClick={handleExportController}
          title="Export complete PLC controller with all programs, supervisor, recipes, and main task"
          style={{ background: '#16a34a', borderColor: '#16a34a' }}
        >
          ↓ Export Controller
        </button>

        <div className="toolbar__divider" />

        <button
          className={`btn ${hasUnsavedChanges ? 'btn--warning' : 'btn--ghost'}`}
          onClick={handleSaveProject}
          title="Download project as JSON (Ctrl+S)"
          disabled={saving}
          style={hasUnsavedChanges ? { fontWeight: 'bold' } : {}}
        >
          {saving ? '⏳ Saving...' : hasUnsavedChanges ? '💾 Save *' : '💾 Save'}
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => setProjectPickerOpen(true)}
          title="Load project from JSON"
        >
          📂 Load
        </button>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {/* Project picker */}
      {projectPickerOpen && (
        <ProjectPickerModal
          mode="currentTab"
          onClose={() => setProjectPickerOpen(false)}
          onBrowseFile={handleBrowseFile}
        />
      )}

      {/* JARVIS modals */}
      {jarvisGenerateOpen && (
        <JarvisGenerateModal onClose={() => setJarvisGenerateOpen(false)} />
      )}
      {jarvisDescribeOpen && (
        <JarvisDescribeModal onClose={() => setJarvisDescribeOpen(false)} />
      )}
      {specEditorOpen && (
        <SpecEditorModal onClose={() => setSpecEditorOpen(false)} />
      )}

      {/* SM reorder popup */}
      {smReorderOpen && (
        <ReorderPopup
          items={sms}
          labelFn={s => `S${String(s.stationNumber).padStart(2, '0')} — ${s.displayName ?? s.name}`}
          onReorder={(from, to) => store.reorderStateMachines(from, to)}
          onClose={() => setSmReorderOpen(false)}
          title="Reorder State Machines"
        />
      )}

      {/* Recipe reorder popup */}
      {recipeReorderOpen && (
        <ReorderPopup
          items={project.recipes ?? []}
          labelFn={r => r.name}
          onReorder={(from, to) => store.reorderRecipes(from, to)}
          onClose={() => setRecipeReorderOpen(false)}
          title="Reorder Recipes"
        />
      )}

    </header>
  );
}
