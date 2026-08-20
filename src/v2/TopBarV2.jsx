/**
 * TopBarV2 — v2 minimal top bar (48px).
 *
 * SDC logo · slim project tab strip · auto-save indicator · one "Build ▾"
 * button on the right.
 *
 * The tab strip is a slim v2 rebuild on the store's open-tabs state rather
 * than an import of ProjectTabBar: ProjectTabBar hard-wires the pinned
 * "★ Standards" tab + setActiveView('standards'), and v2 has no
 * StandardsView surface — importing it would render a dead tab. The
 * switch/close logic is the same three store actions.
 *
 * Build menu handlers replicate Toolbar's small export closures
 * (handleExportL5X / handleExportAllL5X / handleExportController /
 * file-load) because they are internal to Toolbar and Toolbar must not be
 * edited while another agent owns it.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { downloadL5X, downloadAllL5XAsZip, exportProjectJSON } from '../lib/l5xExporter.js';
import { downloadControllerL5X } from '../lib/controllerL5xExporter.js';
import { JarvisGenerateModal } from '../components/modals/JarvisGenerateModal.jsx';
import { JarvisPage } from '../components/jarvis/JarvisPage.jsx';
import { ProjectPickerModal } from '../components/modals/ProjectPickerModal.jsx';
import { useAutoSaveStatus } from './useAutoSaveStatus.js';
import { useV2Shell, closeAllProjectsToHome } from './useV2Shell.js';
import {
  DEFAULT_SCALE, currentScale, isMaxScale, isMinScale, readScale,
  scaleLabel, stepScale, subscribeScale, writeScale,
} from './appScale.js';

function SdcLogo() {
  // Same brand mark as the classic Toolbar.
  return (
    <svg viewBox="27 0 113 61" width="36" height="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M83.4835 60.1812C114.598 60.1812 139.822 46.7092 139.822 30.0906C139.822 13.472 114.598 0 83.4835 0C52.3689 0 27.1455 13.472 27.1455 30.0906C27.1455 46.7092 52.3689 60.1812 83.4835 60.1812Z" fill="#befa4f"/>
      <path d="M98.2318 40.056C99.5818 38.7032 100.647 37.0961 101.366 35.3287C102.085 33.5612 102.442 31.6689 102.418 29.7623C102.42 29.4749 102.44 29.1879 102.48 28.9033C102.906 22.9645 107.664 19.3373 116.269 19.3373C118.925 19.2905 121.573 19.6565 124.116 20.4222C124.234 20.4655 124.358 20.4879 124.483 20.4885C124.711 20.4971 124.934 20.4198 125.107 20.272C125.28 20.1242 125.39 19.9168 125.416 19.6914L125.808 15.907C125.802 15.7011 125.732 15.5019 125.61 15.336C125.487 15.17 125.317 15.045 125.121 14.9775C121.931 14.1319 118.639 13.7224 115.337 13.7602C102.413 13.7602 94.7509 19.6718 94.3365 28.9921C94.3281 29.1995 94.3202 29.6864 94.3077 30.006C94.2988 31.5338 93.9774 33.0438 93.3631 34.4439C92.1556 37.0574 89.8882 38.4515 87.0638 39.2035C85.1018 39.6805 83.0891 39.9198 81.0695 39.9161C79.6601 39.945 78.2495 39.9217 76.7669 39.9217V22.5684C76.761 22.3864 76.6827 22.2141 76.5493 22.0894C76.4159 21.9647 76.2383 21.8978 76.0554 21.9034H69.4401C69.2572 21.8978 69.0795 21.9647 68.9461 22.0894C68.8127 22.2141 68.7344 22.3864 68.7285 22.5684C68.7285 24.909 68.7285 27.2496 68.7285 29.5903C68.7285 34.4845 68.7287 39.3788 68.7291 44.2732C68.7408 44.6293 68.894 44.9662 69.1549 45.21C69.4159 45.4539 69.7634 45.5847 70.1211 45.5739C73.711 45.5752 77.3009 45.5842 80.8907 45.5715C84.434 45.638 87.9654 45.1427 91.3523 44.1041C93.3537 43.4806 95.2355 42.5266 96.9192 41.2822C96.9333 41.2699 96.9409 41.258 96.9555 41.246C97.409 40.8618 97.8345 40.4651 98.2318 40.056Z" fill="#1574C4"/>
      <path d="M92.3274 15.5056C88.7096 14.1184 84.8999 13.6997 81.0251 13.6836L53.574 13.6918L53.5636 13.6985C44.0479 13.7909 39.373 16.9175 39.373 22.4146C39.373 27.2423 42.6591 30.1871 50.7024 32.1137C57.2257 33.6859 59.0401 34.8592 59.0401 36.8967C59.0401 39.0224 57.1762 40.2183 51.6343 40.2183C47.6129 40.2183 44.2775 39.7752 41.3102 38.624C41.1849 38.5735 41.0524 38.5435 40.9175 38.5351C40.6875 38.5315 40.4645 38.6135 40.2921 38.7652C40.1197 38.9168 40.0104 39.127 39.9857 39.3546L39.5446 43.2741V43.3623C39.5601 43.5543 39.6307 43.7378 39.748 43.891C39.8654 44.0441 40.0245 44.1604 40.2064 44.226C43.9394 45.277 47.8042 45.7915 51.6834 45.7538C62.7673 45.7538 67.1814 42.5652 67.1814 36.5863C67.1814 31.8032 63.9447 29.0135 55.2633 26.7547C49.3779 25.2046 47.5143 24.0975 47.5143 22.1489C47.5143 20.4503 48.9675 19.357 54.0149 19.2696H78.5911V19.2563C81.3333 19.1576 84.077 19.4011 86.7584 19.981C89.4953 20.6527 91.7406 21.9166 93.0618 24.2673C93.1237 24.3774 93.1835 24.49 93.2414 24.605C93.2794 24.4871 93.3192 24.3696 93.3606 24.2523C94.1775 21.9791 95.4727 19.9058 97.1597 18.1711C95.6918 17.0472 94.0629 16.1487 92.3274 15.5056Z" fill="#1574C4"/>
      <path d="M125.661 39.7882C125.635 39.563 125.525 39.3557 125.352 39.2079C125.18 39.0601 124.957 38.9828 124.729 38.9915C124.596 38.992 124.463 39.0144 124.336 39.0577C121.797 39.8843 119.137 40.2808 116.465 40.2304C110.066 40.2304 105.642 38.3357 103.645 34.7709C103.593 34.6785 103.543 34.5849 103.495 34.4902C103.459 34.6103 103.422 34.73 103.384 34.8492C102.609 37.2409 101.293 39.4235 99.5371 41.2289C103.156 44.1665 108.551 45.8082 115.484 45.8082C118.818 45.8487 122.143 45.4392 125.367 44.5909C125.553 44.5293 125.717 44.4148 125.839 44.2614C125.961 44.108 126.036 43.9225 126.053 43.7277L125.661 39.7882Z" fill="#1574C4"/>
    </svg>
  );
}

// ── Slim tab strip on openTabs state ────────────────────────────────────────
function V2TabStrip() {
  const openTabs = useDiagramStore(s => s.openTabs) ?? [];
  const activeTabId = useDiagramStore(s => s.activeTabId);
  const projectName = useDiagramStore(s => s.project?.name);
  const currentFilename = useDiagramStore(s => s.currentFilename);
  const switchTab = useDiagramStore(s => s.switchTab);
  const closeTab = useDiagramStore(s => s.closeTab);
  const home = useV2Shell(s => s.home);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef(null);

  // Same synthesized-tab fallback as ProjectTabBar — but NOT on the clean-
  // slate start screen (home): there is genuinely no open project there.
  let tabs = openTabs;
  let effectiveActiveId = activeTabId;
  if (tabs.length === 0 && !home && currentFilename) {
    tabs = [{ id: '_current', filename: currentFilename, name: projectName || currentFilename || 'Current Project' }];
    effectiveActiveId = '_current';
  } else if (home) {
    tabs = [];
  }

  /** Close a tab. Closing the LAST one (or the synthesized current-project
   *  tab) → clean slate: save, drop everything, show the start screen. */
  async function handleClose(tab) {
    const isSynthetic = tab.id === '_current';
    const isLast = isSynthetic || openTabs.length <= 1;
    if (isLast) {
      // Skip store.closeTab here: closeAllProjectsToHome saves the current
      // project FIRST (closeTab would clear currentFilename before the save),
      // then drops all tabs and flips to the start screen.
      await closeAllProjectsToHome(useDiagramStore);
    } else {
      closeTab(tab.id);
    }
  }

  function handleFileOpen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const projectData = JSON.parse(reader.result);
        if (!projectData.name) projectData.name = file.name.replace(/\.json$/i, '');
        useDiagramStore.getState().openProjectFromFile(projectData, file.name);
      } catch (err) {
        alert(`Failed to load project file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="v2-tabs">
      {tabs.map(tab => {
        const isActive = tab.id === effectiveActiveId;
        const displayName = isActive
          ? (projectName || tab.name || tab.filename || 'Untitled')
          : (tab.name || tab.filename || 'Untitled');
        return (
          <div
            key={tab.id}
            className={`v2-tab${isActive ? ' v2-tab--active' : ''}`}
            onClick={() => { if (tab.id !== '_current' && !isActive) switchTab(tab.id); }}
            title={tab.filename || displayName}
          >
            <span className="v2-tab__name">{displayName}</span>
            <button
              className="v2-tab__close"
              data-testid={`tab-close-${displayName}`}
              onClick={(e) => { e.stopPropagation(); handleClose(tab); }}
              title={tabs.length > 1 ? 'Close tab' : 'Close project (clean slate)'}
            >✕</button>
          </div>
        );
      })}
      <button className="v2-tab__add" onClick={() => setPickerOpen(true)} title="Open project in new tab">+</button>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileOpen} />
      {pickerOpen && (
        <ProjectPickerModal
          mode="newTab"
          onClose={() => setPickerOpen(false)}
          onBrowseFile={() => fileInputRef.current?.click()}
        />
      )}
    </div>
  );
}

// ── Auto-save indicator ─────────────────────────────────────────────────────
function AutoSaveIndicator() {
  const status = useAutoSaveStatus();
  const meta = {
    idle:    { dot: '#8896a8', text: 'Auto-save on' },
    pending: { dot: '#c9a643', text: 'Saving…' },
    saved:   { dot: '#5a9a48', text: 'Saved' },
    local:   { dot: '#c9a643', text: 'Local only — server offline' },
  }[status] ?? { dot: '#8896a8', text: '' };
  return (
    <span className="v2-autosave" title="Project auto-saves to the server 2s after any change">
      <span className="v2-autosave__dot" style={{ background: meta.dot }} />
      {meta.text}
    </span>
  );
}

// ── Build ▾ menu ────────────────────────────────────────────────────────────
function BuildMenu() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const sm = store.getActiveSm();
  const sms = project?.stateMachines ?? [];
  const trackingFields = project?.partTracking?.fields ?? [];

  const [open, setOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const menuRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close on outside click / Esc (capture phase — same reasoning as the
  // classic toolbar popups: React Flow handlers can swallow bubbled clicks).
  useEffect(() => {
    if (!open) return;
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

  // ── Handlers replicated from Toolbar (see file header) ──
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

  // Server saves Jarvis output to generated/<clean project name>/ (server.js).
  const outputPath = `generated/${(project?.name ?? 'project').replace(/[^a-zA-Z0-9_\- ]/g, '').trim()}/`;

  async function copyOutputPath() {
    try {
      await navigator.clipboard.writeText(outputPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — path is still visible to copy manually */
    }
  }

  return (
    <div className="v2-build" ref={menuRef}>
      <button
        className={`v2-build__btn${open ? ' v2-build__btn--open' : ''}`}
        onClick={() => { setOpen(o => !o); setLegacyOpen(false); setOutputOpen(false); }}
      >
        Build ▾
      </button>
      {open && (
        <div className="v2-build__menu">
          <button
            className="v2-build__item v2-build__item--primary"
            disabled={!sm || (sm.nodes ?? []).length === 0}
            onClick={() => { setOpen(false); setGenerateOpen(true); }}
          >
            <span className="v2-build__item-label">✨ Generate with Jarvis…</span>
            <span className="v2-build__item-hint">AI L5X with live progress + validation</span>
          </button>

          <button
            className="v2-build__item"
            onClick={() => setOutputOpen(o => !o)}
          >
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
      {generateOpen && <JarvisGenerateModal onClose={() => setGenerateOpen(false)} />}
    </div>
  );
}

// ── App-wide UI scale control (− / 100% / +) ────────────────────────────────
// Same control as the other SDC Tools apps (estimate builder top bar,
// sdc-sheets sidebar footer). The % readout doubles as the reset. Steppers
// step from currentScale() (read off the DOM), not the rendered value — two
// fast clicks before a re-render must both land. No Ctrl+/− binding: those
// are the browser's, and browser zoom composes with this one.
function ScaleControl() {
  const scale = useSyncExternalStore(subscribeScale, readScale, () => DEFAULT_SCALE);
  return (
    <div className="v2-scale" data-testid="app-scale-control" title="App-wide UI scale — like the other SDC Tools apps">
      <button
        className="v2-scale__btn"
        data-testid="app-scale-minus"
        onClick={() => writeScale(stepScale(currentScale(), -1))}
        disabled={isMinScale(scale)}
        aria-label="Make the whole app smaller"
        title="Make the whole app smaller"
      >−</button>
      <button
        className="v2-scale__readout"
        data-testid="app-scale-readout"
        onClick={() => writeScale(DEFAULT_SCALE)}
        aria-label={`UI scale ${scaleLabel(scale)} — reset to 100%`}
        title="Reset to 100%"
      >{scaleLabel(scale)}</button>
      <button
        className="v2-scale__btn"
        data-testid="app-scale-plus"
        onClick={() => writeScale(stepScale(currentScale(), 1))}
        disabled={isMaxScale(scale)}
        aria-label="Make the whole app larger"
        title="Make the whole app larger"
      >+</button>
    </div>
  );
}

// ── Jarvis button (learning-being surface) ──────────────────────────────────
function JarvisButton() {
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(null);

  async function refreshCount() {
    try {
      const r = await fetch('/api/jarvis/questions');
      if (!r.ok) return;
      const qs = await r.json();
      setOpenCount(Array.isArray(qs) ? qs.filter(q => q.status === 'open').length : null);
    } catch {
      /* server offline — no badge, button still opens the page */
    }
  }
  useEffect(() => { refreshCount(); }, []);

  return (
    <>
      <button
        className="v2-jarvis__btn"
        data-testid="jarvis-open-btn"
        onClick={() => setOpen(true)}
        title="Jarvis — his questions for the controls team, knowledge, and track record"
      >
        Jarvis
        {openCount != null && openCount > 0 && (
          <span className="v2-jarvis__badge" data-testid="jarvis-topbar-badge">{openCount}</span>
        )}
      </button>
      {open && <JarvisPage onClose={() => { setOpen(false); refreshCount(); }} />}
    </>
  );
}

export function TopBarV2() {
  return (
    <header className="v2-topbar">
      <span className="v2-topbar__logo"><SdcLogo /></span>
      <span className="v2-topbar__title">State Logic <b>v2</b></span>
      <V2TabStrip />
      <div className="v2-topbar__spacer" />
      <AutoSaveIndicator />
      <ScaleControl />
      <JarvisButton />
      <BuildMenu />
    </header>
  );
}
