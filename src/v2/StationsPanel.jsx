/**
 * StationsPanel — v2 left panel.
 *
 * Ordered list of the current project's state machines ("stations").
 * Each row: station number badge + name + status hint (spec ✓ / node count)
 * + a chevron that expands the station's DEVICES (name + type; click a
 * device → activates that station and opens the device editor). The
 * selected station auto-expands; everything else defaults collapsed.
 *
 * "+ New Station" opens the describe-first Create Station page via the
 * store flag (showNewSmModal → CreateStationPage rendered in AppV2).
 *
 * Footer: "Documents" (per-project document dump drawer) + slim project
 * switcher row reusing ProjectPickerModal.
 */

import { useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ProjectPickerModal } from '../components/modals/ProjectPickerModal.jsx';
import { DeviceIcon } from '../components/DeviceIcons.jsx';
import { DEVICE_TYPES } from '../lib/deviceTypes.js';
import { computeMachineTotals } from '../lib/machineTotals.js';
import { DocumentsDrawer } from './DocumentsDrawer.jsx';

/** Compact machine-wide device tally for quoting (estimates). */
function MachineTotals({ project }) {
  const t = computeMachineTotals(project);
  if (t.stations === 0) return null;
  // Line categories mirror the SDC quoting sheet.
  const items = [
    ['Stations', t.stations],
    ['Servo motors', t.servos],
    ['Standard motors', t.standardMotors],
    ['Pneumatic actuators', t.pneumaticActuators],
    ['Valves', `~${t.valves}`],
    ['Sensors', t.sensors],
    ['Vision systems', t.vision],
    ['Robots', t.robots],
    ['IO points', `~${t.ioTotal}`],
  ];
  return (
    <div
      className="v2-totals"
      data-testid="machine-totals"
      title={
        'Machine totals (quoting estimate)\n' +
        'Live counts across all stations.\n' +
        '• Valves ≈ 1 per pneumatic actuator (double-solenoid standard) + vacuum generators\n' +
        `• IO ≈ ${t.ioIn} in + ${t.ioOut} out — pneumatic: sensors per arrangement + 2 solenoid outputs; ` +
        'digital/analog sensor 1 in; vision 3 in + 1 out; robot = its declared signals; servo axes 0 (network drive)\n' +
        '• Stations with an explicit spec IO list use those counts instead'
      }
    >
      <div className="v2-totals__title">Machine totals <span>(quoting estimate)</span></div>
      <div className="v2-totals__grid">
        {items.map(([label, value]) => (
          <span key={label} className="v2-totals__item">
            <span className="v2-totals__label">{label}</span>
            <b>{value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export function StationsPanel() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const activeSmId = useDiagramStore(s => s.activeSmId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  // Manual expand/collapse overrides; the ACTIVE station auto-expands unless
  // the user explicitly collapsed it.
  const [expandOverrides, setExpandOverrides] = useState({});
  const fileInputRef = useRef(null);

  const sms = [...(project?.stateMachines ?? [])]
    .sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999));

  function isExpanded(sm) {
    const o = expandOverrides[sm.id];
    if (o != null) return o;
    return sm.id === activeSmId;
  }

  function toggleExpand(smId, current) {
    setExpandOverrides(prev => ({ ...prev, [smId]: !current }));
  }

  function openDevice(sm, deviceId) {
    if (sm.id !== activeSmId) store.setActiveSm(sm.id);
    store.openEditDeviceModal(deviceId);
  }

  // Browser file fallback for the project picker (same logic as Toolbar's
  // handleFileChange — replicated because Toolbar keeps it internal).
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

  return (
    <aside className="v2-stations">
      <div className="v2-stations__header">
        <span className="v2-stations__title">Stations</span>
        <button
          className="v2-stations__new"
          data-testid="new-station-btn"
          title="Add a new station to this project (describe it to Jarvis)"
          onClick={() => store.openNewSmModal()}
        >
          + New Station
        </button>
      </div>

      <div className="v2-stations__list">
        {sms.length === 0 && (
          <div className="v2-stations__empty" data-testid="stations-empty">
            No stations yet.<br />Click “+ New Station” to describe the first one.
          </div>
        )}
        {sms.map(sm => {
          const nodeCount = (sm.nodes ?? []).length;
          const devices = sm.devices ?? [];
          const hasSpec = !!sm.machineSpec;
          const active = sm.id === activeSmId;
          const expanded = isExpanded(sm);
          return (
            <div key={sm.id} className="v2-station-wrap">
              <div
                className={`v2-station${active ? ' v2-station--active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => store.setActiveSm(sm.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') store.setActiveSm(sm.id); }}
                title={sm.description || (sm.displayName ?? sm.name)}
              >
                <span className="v2-station__num">
                  S{String(sm.stationNumber ?? 0).padStart(2, '0')}
                </span>
                <span className="v2-station__body">
                  <span className="v2-station__name">{sm.displayName ?? sm.name ?? '(unnamed)'}</span>
                  <span className="v2-station__hint">
                    {hasSpec && <span className="v2-station__spec" title="Has a saved machine spec">✓ spec</span>}
                    <span title="Drawn state nodes">{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
                    <span title="Declared devices">{devices.length} device{devices.length !== 1 ? 's' : ''}</span>
                  </span>
                </span>
                <button
                  className={`v2-station__chev${expanded ? ' v2-station__chev--open' : ''}`}
                  title={expanded ? 'Hide devices' : 'Show devices'}
                  onClick={(e) => { e.stopPropagation(); toggleExpand(sm.id, expanded); }}
                >▾</button>
              </div>
              {expanded && (
                <div className="v2-station__devices" data-testid={`station-devices-${sm.name}`}>
                  {devices.length === 0 && (
                    <div className="v2-station__devices-empty">No devices declared.</div>
                  )}
                  {/* Same row anatomy as the classic subject library
                      (DeviceSidebar): type icon + full name + muted type
                      label subtext. Names never truncate the type carries
                      the icon; the name gets the space. */}
                  {devices.map(d => {
                    const typeInfo = DEVICE_TYPES[d.type];
                    return (
                      <button
                        key={d.id}
                        className="v2-device"
                        title={`Edit ${d.displayName ?? d.name}`}
                        onClick={() => openDevice(sm, d.id)}
                      >
                        <span className="v2-device__icon"><DeviceIcon type={d.type} size={18} /></span>
                        <span className="v2-device__info">
                          <span className="v2-device__name">{d.displayName ?? d.name ?? '(unnamed)'}</span>
                          <span className="v2-device__type">{typeInfo?.label ?? d.type ?? ''}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: machine totals + documents + project switcher */}
      <MachineTotals project={project} />
      <div className="v2-stations__project">
        <button
          className="v2-stations__docs-btn"
          data-testid="docs-open-btn"
          onClick={() => setDocsOpen(true)}
          title="Project documents — Jarvis reads these for context when building stations"
        >
          <span className="v2-stations__docs-icon">🗎</span>
          Documents
        </button>
        <button
          className="v2-stations__project-btn"
          onClick={() => setPickerOpen(true)}
          title="Switch project"
        >
          <span className="v2-stations__project-label">PROJECT</span>
          <span className="v2-stations__project-name">
            {project?.name ?? 'Untitled'}
            {project?.jobNumber ? ` · #${project.jobNumber}` : ''}
          </span>
          <span className="v2-stations__project-chev">⇄</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {pickerOpen && (
        <ProjectPickerModal
          mode="currentTab"
          suppressNewSmModal
          onClose={() => setPickerOpen(false)}
          onBrowseFile={() => fileInputRef.current?.click()}
        />
      )}
      {docsOpen && <DocumentsDrawer onClose={() => setDocsOpen(false)} />}
    </aside>
  );
}
