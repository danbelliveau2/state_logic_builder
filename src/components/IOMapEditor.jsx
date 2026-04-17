/**
 * IOMapEditor — Machine-level device list + IO map generated from all SM devices.
 *
 * Two sections:
 *   1. Device List — every device grouped by category with counts
 *   2. IO Map — every IO point grouped by type (DI, DO, AI, AO, Internal)
 *
 * Both are auto-generated from the subjects defined across all state machines.
 */

import { useMemo, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { getDeviceTags } from '../lib/tagNaming.js';
import { DEVICE_TYPES, DEVICE_CATEGORIES } from '../lib/deviceTypes.js';
import { buildProgramName } from '../lib/tagNaming.js';
import { DeviceIcon } from './DeviceIcons.jsx';

// ── IO point classification ─────────────────────────────────────────────────

function classifyTag(tag) {
  const u = tag.usage;
  const dt = tag.dataType;
  if (u === 'Input' && (dt === 'REAL' || dt === 'INT' || dt === 'DINT')) return 'analogInput';
  if (u === 'Input') return 'digitalInput';
  if (u === 'Output' && (dt === 'REAL' || dt === 'INT' || dt === 'DINT')) return 'analogOutput';
  if (u === 'Output') return 'digitalOutput';
  return 'internal';
}

const IO_SECTION_META = {
  digitalInput:  { label: 'Digital Inputs',  abbr: 'DI', color: '#22c55e' },
  digitalOutput: { label: 'Digital Outputs', abbr: 'DO', color: '#3b82f6' },
  analogInput:   { label: 'Analog Inputs',   abbr: 'AI', color: '#a855f7' },
  analogOutput:  { label: 'Analog Outputs',  abbr: 'AO', color: '#f59e0b' },
  internal:      { label: 'Internal Tags',   abbr: 'INT', color: '#6b7280' },
};

const IO_ORDER = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput', 'internal'];

// Category display config — matches DEVICE_CATEGORIES keys
// Representative device type per category — used for the icon in section headers
const CATEGORY_META = {
  Pneumatic: { label: 'Pneumatic Devices', color: '#1574c4', iconType: 'PneumaticLinearActuator' },
  Servo:     { label: 'Servo Axes',        color: '#061d39', iconType: 'ServoAxis' },
  Robot:     { label: 'Robots',            color: '#7c3aed', iconType: 'Robot' },
  Conveyor:  { label: 'Conveyors',         color: '#0891b2', iconType: 'Conveyor' },
  Vision:    { label: 'Vision Systems',    color: '#fa9150', iconType: 'VisionSystem' },
  Sensor:    { label: 'Sensors',           color: '#aacee8', iconType: 'DigitalSensor' },
  Logic:     { label: 'Timers & Parameters', color: '#9ca3af', iconType: 'Timer' },
  Custom:    { label: 'Custom Devices',    color: '#6b7280', iconType: 'Custom' },
};

// ── Build device list + IO map from project data ────────────────────────────

function buildAll(project) {
  const sms = project?.stateMachines ?? [];
  const deviceList = [];
  const ioSections = {};
  for (const key of IO_ORDER) ioSections[key] = [];

  for (const sm of sms) {
    const stationLabel = `S${String(sm.stationNumber ?? 0).padStart(2, '0')}`;
    const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unknown');
    const smName = sm.displayName ?? sm.name ?? '';
    const devices = (sm.devices ?? []).filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId);

    for (const device of devices) {
      const typeInfo = DEVICE_TYPES[device.type];
      const tags = getDeviceTags(device);

      // Count IO per device
      let di = 0, dout = 0, ai = 0, ao = 0;
      for (const tag of tags) {
        const cls = classifyTag(tag);
        if (cls === 'digitalInput') di++;
        else if (cls === 'digitalOutput') dout++;
        else if (cls === 'analogInput') ai++;
        else if (cls === 'analogOutput') ao++;
      }

      deviceList.push({
        id: device.id,
        name: device.displayName ?? device.name,
        type: device.type,
        typeLabel: typeInfo?.label ?? device.type,
        category: typeInfo?.category ?? 'Custom',
        station: stationLabel,
        smName,
        program: programName,
        smId: sm.id,
        sensorArrangement: device.sensorArrangement ?? '',
        io: { di, do: dout, ai, ao },
      });

      // IO map entries
      for (const tag of tags) {
        const section = classifyTag(tag);
        ioSections[section].push({
          tagName: tag.name,
          dataType: tag.dataType,
          description: tag.description,
          deviceName: device.displayName ?? device.name,
          deviceType: typeInfo?.label ?? device.type,
          station: stationLabel,
          program: programName,
          smId: sm.id,
          deviceId: device.id,
          usage: tag.usage,
          preMs: tag.preMs,
        });
      }
    }
  }

  // Sort IO sections by station then tag name
  for (const key of IO_ORDER) {
    ioSections[key].sort((a, b) => {
      if (a.station !== b.station) return a.station.localeCompare(b.station);
      return a.tagName.localeCompare(b.tagName);
    });
  }

  // Sort device list by station then name
  deviceList.sort((a, b) => {
    if (a.station !== b.station) return a.station.localeCompare(b.station);
    return a.name.localeCompare(b.name);
  });

  // Group devices by category — split Vision out from Sensor
  const IO_CATEGORIES = {
    Pneumatic: ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator'],
    Servo:     ['ServoAxis'],
    Robot:     ['Robot'],
    Conveyor:  ['Conveyor'],
    Vision:    ['VisionSystem'],
    Sensor:    ['DigitalSensor', 'AnalogSensor'],
    Logic:     ['Timer', 'Parameter'],
    Custom:    ['Custom'],
  };
  const devicesByCategory = {};
  for (const [cat, types] of Object.entries(IO_CATEGORIES)) {
    const devs = deviceList.filter(d => types.includes(d.type));
    if (devs.length > 0) devicesByCategory[cat] = devs;
  }
  // Ungrouped
  const allGroupedTypes = Object.values(IO_CATEGORIES).flat();
  const ungrouped = deviceList.filter(d => !allGroupedTypes.includes(d.type));
  if (ungrouped.length > 0) devicesByCategory['Custom'] = [...(devicesByCategory['Custom'] ?? []), ...ungrouped];

  return { deviceList, devicesByCategory, ioSections };
}

// ── Component ───────────────────────────────────────────────────────────────

export function IOMapEditor() {
  const project = useDiagramStore(s => s.project);
  const { deviceList, devicesByCategory, ioSections } = useMemo(() => buildAll(project), [project]);
  const [activeTab, setActiveTab] = useState('devices');

  // IO counts
  const ioCounts = {};
  for (const key of IO_ORDER) ioCounts[key] = ioSections[key].length;
  const totalIO = ioCounts.digitalInput + ioCounts.digitalOutput + ioCounts.analogInput + ioCounts.analogOutput;

  // Device category counts
  const catCounts = {};
  for (const [cat, devs] of Object.entries(devicesByCategory)) catCounts[cat] = devs.length;
  const totalDevices = deviceList.length;

  return (
    <div className="io-map-editor">
      {/* Sub-tabs: Device List | IO Map */}
      <div className="io-map__tabs">
        <button
          className={`io-map__tab${activeTab === 'devices' ? ' io-map__tab--active' : ''}`}
          onClick={() => setActiveTab('devices')}
        >
          Device List
          <span className="io-map__tab-count">{totalDevices}</span>
        </button>
        <button
          className={`io-map__tab${activeTab === 'io' ? ' io-map__tab--active' : ''}`}
          onClick={() => setActiveTab('io')}
        >
          IO Map
          <span className="io-map__tab-count">{totalIO}</span>
        </button>
      </div>

      {/* ── Device List Tab ──────────────────────────────────────────────── */}
      {activeTab === 'devices' && (
        <>
          {/* Category summary badges */}
          <div className="io-map__summary">
            <div className="io-map__counts">
              {Object.entries(devicesByCategory).map(([cat, devs]) => {
                const meta = CATEGORY_META[cat] ?? CATEGORY_META.Custom;
                return (
                  <div key={cat} className="io-map__count-badge" style={{ borderColor: meta.color }}>
                    <span className="io-map__count-num" style={{ color: meta.color }}>{devs.length}</span>
                    <span className="io-map__count-label">{meta.label}</span>
                  </div>
                );
              })}
              <div className="io-map__count-badge io-map__count-badge--total">
                <span className="io-map__count-num">{totalDevices}</span>
                <span className="io-map__count-label">Total</span>
              </div>
            </div>
          </div>

          {totalDevices === 0 && (
            <div className="io-map__empty">
              <p>No devices found in any state machine.</p>
              <p style={{ color: '#64748b', fontSize: 13 }}>
                Add subjects to your state machines, then come back here to see the device list.
              </p>
            </div>
          )}

          {/* Device tables by category */}
          {Object.entries(devicesByCategory).map(([cat, devs]) => {
            const meta = CATEGORY_META[cat] ?? CATEGORY_META.Custom;
            return (
              <div key={cat} className="io-map__section">
                <div className="io-map__section-header" style={{ borderLeftColor: meta.color }}>
                  <span className="io-map__section-title">
                    <DeviceIcon type={meta.iconType} size={20} color={meta.color} />
                    {meta.label}
                  </span>
                  <span className="io-map__section-count" style={{ color: meta.color }}>{devs.length}</span>
                </div>

                <table className="io-map__table">
                  <thead>
                    <tr>
                      <th className="io-map__th io-map__th--num">#</th>
                      <th className="io-map__th io-map__th--device">Device Name</th>
                      <th className="io-map__th">Type</th>
                      <th className="io-map__th io-map__th--station">Station</th>
                      <th className="io-map__th" style={{ width: 70 }}>SM</th>
                      <th className="io-map__th" style={{ width: 40, textAlign: 'center' }}>DI</th>
                      <th className="io-map__th" style={{ width: 40, textAlign: 'center' }}>DO</th>
                      <th className="io-map__th" style={{ width: 40, textAlign: 'center' }}>AI</th>
                      <th className="io-map__th" style={{ width: 40, textAlign: 'center' }}>AO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devs.map((d, i) => (
                      <tr key={`${d.id}-${d.smId}`} className="io-map__row">
                        <td className="io-map__td io-map__td--num">{i + 1}</td>
                        <td className="io-map__td io-map__td--tag">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <DeviceIcon type={d.type} size={16} />
                            <code>{d.name}</code>
                          </span>
                        </td>
                        <td className="io-map__td io-map__td--type" style={{ fontSize: 12, color: '#475569' }}>{d.typeLabel}</td>
                        <td className="io-map__td io-map__td--station">
                          <span className="io-map__station-badge">{d.station}</span>
                        </td>
                        <td className="io-map__td" style={{ fontSize: 11, color: '#64748b' }}>{d.smName}</td>
                        <td className="io-map__td io-map__td--io">{d.io.di || <span className="io-map__zero">—</span>}</td>
                        <td className="io-map__td io-map__td--io">{d.io.do || <span className="io-map__zero">—</span>}</td>
                        <td className="io-map__td io-map__td--io">{d.io.ai || <span className="io-map__zero">—</span>}</td>
                        <td className="io-map__td io-map__td--io">{d.io.ao || <span className="io-map__zero">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Category IO totals */}
                  <tfoot>
                    <tr className="io-map__totals-row">
                      <td colSpan={5} className="io-map__td io-map__td--totals-label">Subtotal</td>
                      <td className="io-map__td io-map__td--io io-map__td--totals">{devs.reduce((s, d) => s + d.io.di, 0) || '—'}</td>
                      <td className="io-map__td io-map__td--io io-map__td--totals">{devs.reduce((s, d) => s + d.io.do, 0) || '—'}</td>
                      <td className="io-map__td io-map__td--io io-map__td--totals">{devs.reduce((s, d) => s + d.io.ai, 0) || '—'}</td>
                      <td className="io-map__td io-map__td--io io-map__td--totals">{devs.reduce((s, d) => s + d.io.ao, 0) || '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}

          {/* Grand total */}
          {totalDevices > 0 && (
            <div className="io-map__grand-total">
              <span className="io-map__grand-total-label">Machine Total</span>
              <span className="io-map__grand-total-item" style={{ color: '#22c55e' }}>{deviceList.reduce((s, d) => s + d.io.di, 0)} DI</span>
              <span className="io-map__grand-total-item" style={{ color: '#3b82f6' }}>{deviceList.reduce((s, d) => s + d.io.do, 0)} DO</span>
              <span className="io-map__grand-total-item" style={{ color: '#a855f7' }}>{deviceList.reduce((s, d) => s + d.io.ai, 0)} AI</span>
              <span className="io-map__grand-total-item" style={{ color: '#f59e0b' }}>{deviceList.reduce((s, d) => s + d.io.ao, 0)} AO</span>
            </div>
          )}
        </>
      )}

      {/* ── IO Map Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'io' && (
        <>
          {/* IO summary badges */}
          <div className="io-map__summary">
            <div className="io-map__counts">
              {IO_ORDER.filter(k => k !== 'internal').map(key => {
                const meta = IO_SECTION_META[key];
                return (
                  <div key={key} className="io-map__count-badge" style={{ borderColor: meta.color }}>
                    <span className="io-map__count-num" style={{ color: meta.color }}>{ioCounts[key]}</span>
                    <span className="io-map__count-label">{meta.abbr}</span>
                  </div>
                );
              })}
              <div className="io-map__count-badge io-map__count-badge--total">
                <span className="io-map__count-num">{totalIO}</span>
                <span className="io-map__count-label">Total IO</span>
              </div>
            </div>
          </div>

          {totalIO === 0 && ioCounts.internal === 0 && (
            <div className="io-map__empty">
              <p>No IO points found.</p>
              <p style={{ color: '#64748b', fontSize: 13 }}>
                Add subjects to your state machines, then come back here to see the IO map.
              </p>
            </div>
          )}

          {IO_ORDER.map(key => {
            const items = ioSections[key];
            if (items.length === 0) return null;
            const meta = IO_SECTION_META[key];

            return (
              <div key={key} className="io-map__section">
                <div className="io-map__section-header" style={{ borderLeftColor: meta.color }}>
                  <span className="io-map__section-title">{meta.label}</span>
                  <span className="io-map__section-count" style={{ color: meta.color }}>{items.length}</span>
                </div>

                <table className="io-map__table">
                  <thead>
                    <tr>
                      <th className="io-map__th io-map__th--num">#</th>
                      <th className="io-map__th io-map__th--tag">Tag Name</th>
                      <th className="io-map__th io-map__th--type">Type</th>
                      <th className="io-map__th io-map__th--station">Station</th>
                      <th className="io-map__th io-map__th--device">Device</th>
                      <th className="io-map__th io-map__th--desc">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={`${item.tagName}-${item.smId}-${i}`} className="io-map__row">
                        <td className="io-map__td io-map__td--num">{i + 1}</td>
                        <td className="io-map__td io-map__td--tag"><code>{item.tagName}</code></td>
                        <td className="io-map__td io-map__td--type">{item.dataType}</td>
                        <td className="io-map__td io-map__td--station">
                          <span className="io-map__station-badge">{item.station}</span>
                        </td>
                        <td className="io-map__td io-map__td--device">{item.deviceName}</td>
                        <td className="io-map__td io-map__td--desc">{item.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
