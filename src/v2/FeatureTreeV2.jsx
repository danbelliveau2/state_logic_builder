/**
 * FeatureTreeV2 — the SDC FEATURE TREE (v2 left panel).
 *
 * Replicates the estimate builder's SolidWorks-style feature tree
 * (C:\Claude_Sandbox\SDC_Estimate_Builder\src\components\FeatureTree.jsx):
 * every row is `caret + type-colored square + name + dotted leader +
 * right-aligned mono value`; large parents (14px), small children (10px);
 * quiet amber badges for incompleteness, red square on a real problem —
 * never modal.
 *
 * State Logic's levels (adapting Machine→Section→Station→band→line):
 *   Root: the MACHINE (project name + job #)      → right-value: station count
 *   ├─ Machine   (quoting tally lives here)       → right-value: IO count
 *                (estimate nature lives in the hover tooltip, not a ~ prefix)
 *   ├─ Stations  (+ New action on the row)        → right-value: station count
 *   │   ├─ S## station (square colored by state:  → right-value: node count
 *   │   │   amber = no spec · red = last Jarvis build failed validation ·
 *   │   │   green ✓ = spec + drawn · blue = spec, nothing drawn yet)
 *   │   │   ├─ Spec line (✓ / —, opens SpecEditorModal)
 *   │   │   └─ devices (DeviceIcon + name + muted type subtext)
 *   │   └─ Drafts (unfinished Create-Station drafts — they ARE stations
 *   │      in progress, so they live in the Stations section, not per station)
 *   └─ Documents (opens the drawer)               → right-value: doc count
 *   (No Jarvis node — Dan: "questions about Jarvis don't go on the tree";
 *    the machine structure only. Jarvis lives in the top bar.)
 *
 * THE TREE IS MASTER: clicking a station drives the canvas (setActiveSm);
 * expansion state is an openKeys Set ('station:{id}' keys) mirrored both
 * ways — selecting a station anywhere ensure-opens its node (never
 * toggle-closes it).
 */

import { useEffect, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DeviceIcon } from '../components/DeviceIcons.jsx';
import { DEVICE_TYPES } from '../lib/deviceTypes.js';
import { computeMachineTotals } from '../lib/machineTotals.js';
import { SpecEditorModal } from '../components/modals/SpecEditorModal.jsx';
import { DocumentsDrawer } from './DocumentsDrawer.jsx';
import {
  draftsKeyFor, loadDrafts, deleteDraft, onDraftsChanged,
  requestResumeDraft, draftLabel, timeAgo,
} from '../components/jarvis/createStationDrafts.js';

/** Fixed tree width — the canvas needs the larger share in State Logic
 *  (the estimate builder uses 460; its center pane is cards, ours is a
 *  full React Flow canvas). AppV2 feeds this into the grid via CSS var. */
export const TREE_WIDTH = 340;

// SDC palette accents (same node colors as the estimate builder's tree so a
// station "looks identical in both apps" — ecosystem reference §E.2).
const NAVY = '#061d39';
const BLUE = '#1574C4';
const TEAL = '#129182';
const AMBER = '#b45309';
const AMBER_BG = '#fdf4e3';
const AMBER_BORDER = '#e8b64c';
const RED = '#c81e1e';
const GREEN = '#5a9a48';

// ── Row anatomy primitives (mirrors FeatureTree.jsx) ────────────────────────

/** Dotted leader — fills the space between a name and its right value. */
function Leader() {
  return <span className="v2-tree__leader" />;
}

function Caret({ open }) {
  return (
    <svg
      className={`v2-tree__caret${open ? ' v2-tree__caret--open' : ''}`}
      fill="currentColor" viewBox="0 0 20 20" width="10" height="10"
    >
      <path d="M7 5l6 5-6 5V5z" />
    </svg>
  );
}

/** Type/status-colored square. `check` renders a tiny ✓ inside (green state). */
function Square({ color, check = false }) {
  return (
    <span className="v2-tree__square" style={{ background: color }}>
      {check ? '✓' : ''}
    </span>
  );
}

/** Right-aligned mono value. */
function Value({ children, small = false }) {
  if (children == null || children === '') return null;
  return <span className={`v2-tree__value${small ? ' v2-tree__value--small' : ''}`}>{children}</span>;
}

// ── Data helpers ─────────────────────────────────────────────────────────────

/** Latest Jarvis build per SM name for this project → true when it FAILED
 *  validation. Best-effort: server offline ⇒ empty map (no red squares). */
function useBuildFailures(projectName) {
  const [failed, setFailed] = useState(() => new Set());
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/jarvis/builds');
        if (!r.ok) return;
        const builds = await r.json();
        if (!alive || !Array.isArray(builds)) return;
        const latest = new Map(); // sm name → last build for this project (array is oldest first)
        for (const b of builds) {
          if (b && b.project === projectName && b.sm) latest.set(b.sm, b);
        }
        const bad = new Set();
        for (const [sm, b] of latest) if (b.validationOk === false) bad.add(sm);
        setFailed(bad);
      } catch { /* server offline — quiet */ }
    })();
    return () => { alive = false; };
  }, [projectName]);
  return failed;
}

/** Attached-document count for the Documents node value. */
function useDocCount(currentFilename, bump) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!currentFilename) { setCount(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(currentFilename)}/docs`);
        if (!r.ok) return;
        const docs = await r.json();
        if (alive && Array.isArray(docs)) setCount(docs.length);
      } catch { /* quiet */ }
    })();
    return () => { alive = false; };
  }, [currentFilename, bump]);
  return count;
}

/** Station status → { color, check, hint } (quiet badges, never modal). */
function stationStatus(sm, buildFailed) {
  const hasSpec = !!sm.machineSpec;
  const drawn = (sm.nodes ?? []).length > 0;
  if (buildFailed) return { color: RED, check: false, hint: 'Last Jarvis build FAILED validation' };
  if (!hasSpec) return { color: AMBER_BORDER, check: false, hint: 'Incomplete — no machine spec yet' };
  if (drawn) return { color: GREEN, check: true, hint: 'Spec saved + logic drawn' };
  return { color: BLUE, check: false, hint: 'Spec saved — nothing drawn yet' };
}

// ── Nodes ────────────────────────────────────────────────────────────────────

function StationTreeNode({ sm, open, active, buildFailed, onRowClick, onCaretClick, onOpenSpec, onOpenDevice }) {
  const nodeCount = (sm.nodes ?? []).length;
  const devices = sm.devices ?? [];
  const status = stationStatus(sm, buildFailed);
  const name = sm.displayName ?? sm.name ?? '(unnamed)';
  return (
    <div>
      <div
        className={`v2-tree__row${active ? ' v2-tree__row--active' : ''}`}
        data-testid={`tree-station-${sm.name}`}
        role="button" tabIndex={0}
        onClick={onRowClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onRowClick(); }}
        title={`${status.hint}${sm.description ? `\n${sm.description}` : ''}`}
      >
        <button
          className="v2-tree__caret-btn"
          onClick={(e) => { e.stopPropagation(); onCaretClick(); }}
          title={open ? 'Collapse' : 'Expand'}
          tabIndex={-1}
        >
          <Caret open={open} />
        </button>
        <Square color={status.color} check={status.check} />
        <span className="v2-tree__snum">S{String(sm.stationNumber ?? 0).padStart(2, '0')}</span>
        <span className={`v2-tree__name${status.color === RED ? ' v2-tree__name--problem' : ''}`}>{name}</span>
        <Leader />
        <Value>{nodeCount}</Value>
      </div>
      {open && (
        <div className="v2-tree__children" data-testid={`tree-station-children-${sm.name}`}>
          {/* Spec line — ✓ / — , opens SpecEditorModal for THIS station */}
          <div
            className="v2-tree__row v2-tree__row--small"
            data-testid={`tree-spec-${sm.name}`}
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onOpenSpec(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenSpec(); } }}
            title={sm.machineSpec ? 'Machine spec saved — click to review/edit' : 'No machine spec yet — click to write one'}
          >
            <span className="v2-tree__dot">·</span>
            <span className="v2-tree__name-small">Spec</span>
            <Leader />
            <Value small>
              {sm.machineSpec
                ? <span style={{ color: GREEN, fontWeight: 700 }}>✓</span>
                : <span style={{ color: AMBER, fontWeight: 700 }}>—</span>}
            </Value>
          </div>
          {devices.length === 0 && (
            <div className="v2-tree__empty-leaf">No devices declared.</div>
          )}
          {/* Devices — icon + full name + muted type subtext (kept from the
              old rows); right value intentionally blank. */}
          {devices.map(d => {
            const typeInfo = DEVICE_TYPES[d.type];
            return (
              <div
                key={d.id}
                className="v2-tree__row v2-tree__row--small v2-tree__device"
                role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onOpenDevice(d.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenDevice(d.id); } }}
                title={`Edit ${d.displayName ?? d.name}`}
              >
                <span className="v2-tree__device-icon"><DeviceIcon type={d.type} size={14} /></span>
                <span className="v2-tree__device-info">
                  <span className="v2-tree__device-name">{d.displayName ?? d.name ?? '(unnamed)'}</span>
                  <span className="v2-tree__device-type">{typeInfo?.label ?? d.type ?? ''}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── The tree ─────────────────────────────────────────────────────────────────

export function FeatureTreeV2() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const activeSmId = useDiagramStore(s => s.activeSmId);
  const currentFilename = useDiagramStore(s => s.currentFilename);

  // Expansion state — openKeys Set, 'station:{id}' style keys.
  const [openKeys, setOpenKeys] = useState(() => new Set(['stations']));
  const isOpen = (key) => openKeys.has(key);
  const toggle = (key) => setOpenKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const ensureOpen = (...keys) => setOpenKeys(prev => {
    if (keys.every(k => prev.has(k))) return prev;
    const next = new Set(prev);
    keys.forEach(k => next.add(k));
    return next;
  });

  // MIRROR: selecting a station ANYWHERE (canvas pill, tree, elsewhere)
  // ensure-opens its node — never toggle-closes.
  useEffect(() => {
    if (activeSmId) ensureOpen('stations', `station:${activeSmId}`);
  }, [activeSmId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overlays owned by the tree.
  const [specOpen, setSpecOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  // Unfinished Create-Station drafts for THIS project (localStorage isn't
  // reactive — refresh on the drafts module's change event + project swap).
  const draftsKey = draftsKeyFor(store);
  const [drafts, setDrafts] = useState(() => loadDrafts(draftsKey));
  useEffect(() => {
    setDrafts(loadDrafts(draftsKey));
    return onDraftsChanged(() => setDrafts(loadDrafts(draftsKey)));
  }, [draftsKey]);

  const buildFailures = useBuildFailures(project?.name);
  const docCount = useDocCount(currentFilename, docsOpen);

  const sms = [...(project?.stateMachines ?? [])]
    .sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999));
  const totals = computeMachineTotals(project);
  const noSpecCount = sms.filter(sm => !sm.machineSpec).length;

  function clickStation(sm) {
    if (sm.id !== activeSmId) {
      // Drives the center pane; the mirror effect ensure-opens the node.
      store.setActiveSm(sm.id);
      ensureOpen('stations', `station:${sm.id}`);
    } else {
      toggle(`station:${sm.id}`);
    }
  }

  function openSpecFor(sm) {
    if (sm.id !== activeSmId) store.setActiveSm(sm.id); // modal reads active SM
    setSpecOpen(true);
  }

  function openDevice(sm, deviceId) {
    if (sm.id !== activeSmId) store.setActiveSm(sm.id);
    store.openEditDeviceModal(deviceId);
  }

  function resumeDraft(draftId) {
    requestResumeDraft(draftId);
    store.openNewSmModal();
  }
  function discardDraft(e, d) {
    e.stopPropagation();
    if (!window.confirm(`Discard the draft "${draftLabel(d)}"? Its explanation, summary and pictures will be deleted.`)) return;
    deleteDraft(draftsKey, d.draftId);
  }

  // Machine tally lines (the old footer block, now this node's detail).
  // Third element = breakdown key — a tally row with contributors expands to
  // list them (Dan: "it's hard to understand what those items specifically are").
  const bd = totals.breakdown ?? {};
  const tallyItems = [
    ['Stations', totals.stations, 'stations'],
    ['Servo motors', totals.servos, 'servos'],
    ['Standard motors', totals.standardMotors, 'standardMotors'],
    ['Pneumatic actuators', totals.pneumaticActuators, 'pneumaticActuators'],
    ['Valves', totals.valves, 'valves'],
    ['Sensors', totals.sensors, 'sensors'],
    ['Vision systems', totals.vision, 'vision'],
    ['Robots', totals.robots, 'robots'],
    // IO split in/out — Dan expected inputs vs outputs separated.
    ['Inputs', totals.ioIn, 'inputs'],
    ['Outputs', totals.ioOut, 'outputs'],
  ];

  return (
    <div className="v2-tree" data-testid="feature-tree">
      {/* Root: THE MACHINE */}
      <div className="v2-tree__root" data-testid="tree-root" title={currentFilename || undefined}>
        <Square color={NAVY} />
        <span className="v2-tree__root-name">
          {project?.name ?? 'Untitled'}
          {project?.jobNumber ? <span className="v2-tree__job"> · #{project.jobNumber}</span> : null}
        </span>
        {noSpecCount > 0 && (
          <span
            className="v2-tree__badge-amber"
            data-testid="tree-incomplete-badge"
            title={`${noSpecCount} station${noSpecCount !== 1 ? 's' : ''} without a machine spec — open the station and click its Spec line`}
          >
            incomplete: {noSpecCount} no spec
          </span>
        )}
        <Leader />
        <Value>{sms.length}</Value>
      </div>

      <div className="v2-tree__indent">
        {/* Machine — quoting tally node */}
        <div
          className={`v2-tree__row${isOpen('machine') ? ' v2-tree__row--open' : ''}`}
          data-testid="tree-machine"
          role="button" tabIndex={0}
          onClick={() => toggle('machine')}
          onKeyDown={(e) => { if (e.key === 'Enter') toggle('machine'); }}
          title={
            'Machine totals (estimated from device types) — live counts across all stations.\n' +
            '• Valves ≈ 1 per pneumatic actuator (double-solenoid standard) + vacuum generators\n' +
            `• IO ≈ ${totals.ioIn} in + ${totals.ioOut} out\n` +
            '• Stations with an explicit spec IO list use those counts instead'
          }
        >
          <button className="v2-tree__caret-btn" tabIndex={-1}><Caret open={isOpen('machine')} /></button>
          <Square color={TEAL} />
          <span className="v2-tree__name v2-tree__name--bold">Machine</span>
          <Leader />
          <Value>{totals.ioTotal} IO</Value>
        </div>
        {isOpen('machine') && (
          <div className="v2-tree__children" data-testid="machine-totals">
            {tallyItems.map(([label, value, bdKey]) => {
              const contributors = bd[bdKey] ?? [];
              const expandable = contributors.length > 0;
              const key = `tally:${bdKey}`;
              const open = expandable && isOpen(key);
              return (
                <div key={label}>
                  <div
                    className={`v2-tree__row v2-tree__row--small${expandable ? '' : ' v2-tree__row--static'}`}
                    data-testid={`tally-${bdKey}`}
                    role={expandable ? 'button' : undefined}
                    tabIndex={expandable ? 0 : undefined}
                    onClick={expandable ? () => toggle(key) : undefined}
                    onKeyDown={expandable ? (e) => { if (e.key === 'Enter') toggle(key); } : undefined}
                    title={expandable ? `Click to see what the ${value} ${label.toLowerCase()} specifically are` : undefined}
                    style={expandable ? { cursor: 'pointer' } : undefined}
                  >
                    {expandable ? (
                      <button className="v2-tree__caret-btn" tabIndex={-1}><Caret open={open} /></button>
                    ) : (
                      <span className="v2-tree__dot">·</span>
                    )}
                    <span className="v2-tree__name-small">{label}</span>
                    <Leader />
                    <Value small>{value}</Value>
                  </div>
                  {open && (
                    <div className="v2-tree__children" data-testid={`tally-children-${bdKey}`}>
                      {contributors.map((c, i) => (
                        <div
                          key={i}
                          className="v2-tree__row v2-tree__row--small v2-tree__row--static"
                          title={`${c.name} (${c.station}) — ${c.detail}`}
                          style={{ paddingLeft: 14 }}
                        >
                          <span className="v2-tree__dot">·</span>
                          <span className="v2-tree__device-info" style={{ minWidth: 0 }}>
                            <span className="v2-tree__device-name">
                              {c.name} <span style={{ color: '#8896a8', fontWeight: 400 }}>({c.station})</span>
                            </span>
                            <span className="v2-tree__device-type">{c.detail}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Stations section */}
        <div
          className={`v2-tree__row${isOpen('stations') ? ' v2-tree__row--open' : ''}`}
          data-testid="tree-stations"
          role="button" tabIndex={0}
          onClick={() => toggle('stations')}
          onKeyDown={(e) => { if (e.key === 'Enter') toggle('stations'); }}
        >
          <button className="v2-tree__caret-btn" tabIndex={-1}><Caret open={isOpen('stations')} /></button>
          <Square color={BLUE} />
          <span className="v2-tree__name v2-tree__name--bold">Stations</span>
          <button
            className="v2-tree__add"
            data-testid="new-station-btn"
            title="Add a new station to this project (describe it to Jarvis)"
            onClick={(e) => { e.stopPropagation(); store.openNewSmModal(); }}
          >
            + New
          </button>
          <Leader />
          <Value>{sms.length}</Value>
        </div>
        {isOpen('stations') && (
          <div className="v2-tree__children v2-tree__children--stations">
            {sms.length === 0 && drafts.length === 0 && (
              <div className="v2-tree__empty-leaf" data-testid="stations-empty">
                No stations yet — click “+ New” to describe the first one.
              </div>
            )}
            {sms.map(sm => (
              <StationTreeNode
                key={sm.id}
                sm={sm}
                open={isOpen(`station:${sm.id}`)}
                active={sm.id === activeSmId}
                buildFailed={buildFailures.has(sm.name)}
                onRowClick={() => clickStation(sm)}
                onCaretClick={() => toggle(`station:${sm.id}`)}
                onOpenSpec={() => openSpecFor(sm)}
                onOpenDevice={(deviceId) => openDevice(sm, deviceId)}
              />
            ))}
            {/* Drafts — unfinished stations belong in the Stations section */}
            {drafts.length > 0 && (
              <div data-testid="stations-drafts-row">
                <div
                  className={`v2-tree__row${isOpen('drafts') ? ' v2-tree__row--open' : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => toggle('drafts')}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggle('drafts'); }}
                  title="Unfinished Create-Station drafts for this project"
                >
                  <button className="v2-tree__caret-btn" tabIndex={-1}><Caret open={isOpen('drafts')} /></button>
                  <Square color={AMBER_BORDER} />
                  <span className="v2-tree__name">Drafts</span>
                  <Leader />
                  <Value>{drafts.length}</Value>
                </div>
                {isOpen('drafts') && (
                  <div className="v2-tree__children">
                    {drafts.map(d => (
                      <div
                        key={d.draftId}
                        className="v2-tree__row v2-tree__row--small"
                        data-testid={`stations-draft-${d.draftId}`}
                        role="button" tabIndex={0}
                        onClick={() => resumeDraft(d.draftId)}
                        onKeyDown={(e) => { if (e.key === 'Enter') resumeDraft(d.draftId); }}
                        title="Resume this unfinished station draft"
                      >
                        <span className="v2-tree__dot">✎</span>
                        <span className="v2-tree__name-small v2-tree__name-small--strong">{draftLabel(d)}</span>
                        <Leader />
                        <Value small>{timeAgo(d.savedAt)}</Value>
                        <button
                          className="v2-tree__discard"
                          data-testid={`stations-draft-discard-${d.draftId}`}
                          onClick={(e) => discardDraft(e, d)}
                          title="Discard this draft"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Documents — opens the per-project drawer */}
        <div
          className="v2-tree__row"
          data-testid="docs-open-btn"
          role="button" tabIndex={0}
          onClick={() => setDocsOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') setDocsOpen(true); }}
          title="Project documents — Jarvis reads these for context when building stations"
        >
          <span className="v2-tree__caret-spacer" />
          <Square color="#8896a8" />
          <span className="v2-tree__name">Documents</span>
          <Leader />
          <Value>{docCount ?? ''}</Value>
        </div>

      </div>

      {specOpen && <SpecEditorModal onClose={() => setSpecOpen(false)} />}
      {docsOpen && <DocumentsDrawer onClose={() => setDocsOpen(false)} />}
    </div>
  );
}
