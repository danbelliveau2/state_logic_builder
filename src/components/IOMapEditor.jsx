/**
 * IOMapEditor — Machine-level device list + IO map + network topology.
 *
 * Three tabs:
 *   1. Device List — every device grouped by category with counts
 *   2. IO Map — every IO point grouped by type (DI, DO, AI, AO, Internal)
 *   3. Network — EtherNet/IP module topology, IP addressing, backplane layout
 *
 * All are auto-generated from the subjects defined across all state machines,
 * with manual overrides for network-specific fields (IP, catalog #, etc).
 */

import { useMemo, useState, useCallback } from 'react';
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
  digitalInput:  { label: 'Digital Inputs',  abbr: 'DI', color: '#5a9a48' },
  digitalOutput: { label: 'Digital Outputs', abbr: 'DO', color: '#1574C4' },
  analogInput:   { label: 'Analog Inputs',   abbr: 'AI', color: '#0072B5' },
  analogOutput:  { label: 'Analog Outputs',  abbr: 'AO', color: '#E8A317' },
  internal:      { label: 'Internal Tags',   abbr: 'INT', color: '#5a6a7e' },
};

const IO_ORDER = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput', 'internal'];

// Category display config — matches DEVICE_CATEGORIES keys
// Representative device type per category — used for the icon in section headers
const CATEGORY_META = {
  Pneumatic: { label: 'Pneumatic Devices', color: '#1574C4', iconType: 'PneumaticLinearActuator' },
  Servo:     { label: 'Servo Axes',        color: '#061d39', iconType: 'ServoAxis' },
  Robot:     { label: 'Robots',            color: '#1264a8', iconType: 'Robot' },
  Conveyor:  { label: 'Conveyors',         color: '#0072B5', iconType: 'Conveyor' },
  Vision:    { label: 'Vision Systems',    color: '#E8A317', iconType: 'VisionSystem' },
  Sensor:    { label: 'Sensors',           color: '#5a6a7e', iconType: 'DigitalSensor' },
  Logic:     { label: 'Timers & Parameters', color: '#8896a8', iconType: 'Timer' },
  Custom:    { label: 'Custom Devices',    color: '#5a6a7e', iconType: 'Custom' },
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

// ── Network device type → bus + IP range mapping ───────────────────────────

const NETWORK_DEVICE_MAP = {
  ServoAxis:      { bus: 'ethernet', rangeKey: 'servoDrive', prefix: 'sd' },
  VisionSystem:   { bus: 'ethernet', rangeKey: 'camera',     prefix: 'cam' },
  Robot:          { bus: 'ethernet', rangeKey: 'robot',      prefix: 'r' },
  Conveyor:       { bus: 'ethernet', rangeKey: 'vfd',        prefix: 'fd' },
};

// Device types that produce EtherNet/IP modules
const ETHERNET_DEVICE_TYPES = new Set(Object.keys(NETWORK_DEVICE_MAP));

// Chassis module types (for backplane dropdown)
const CHASSIS_MODULE_TYPES = [
  { value: 'DI',       label: 'Digital Input',        color: '#5a9a48' },
  { value: 'DO',       label: 'Digital Output',       color: '#1574C4' },
  { value: 'DI_SAFE',  label: 'Safety Digital Input',  color: '#5a9a48' },
  { value: 'DO_SAFE',  label: 'Safety Digital Output',  color: '#1574C4' },
  { value: 'AI',       label: 'Analog Input',          color: '#0072B5' },
  { value: 'AO',       label: 'Analog Output',         color: '#E8A317' },
  { value: 'TC',       label: 'Thermocouple',          color: '#E8A317' },
  { value: 'RTD',      label: 'RTD',                   color: '#E8A317' },
  { value: 'SERIAL',   label: 'Serial Comm',           color: '#5a6a7e' },
  { value: 'OTHER',    label: 'Other',                 color: '#8896a8' },
];

const CHASSIS_TYPE_META = {};
for (const t of CHASSIS_MODULE_TYPES) CHASSIS_TYPE_META[t.value] = t;

// Bus type display
const BUS_META = {
  ethernet:  { label: 'EtherNet/IP', color: '#1574C4', icon: '🌐' },
  iolink:    { label: 'IO-Link',     color: '#0072B5', icon: '🔗' },
  backplane: { label: 'Backplane',   color: '#061d39', icon: '📦' },
};

/**
 * Auto-discover network devices from SM device data.
 * Merges with manually-defined modules from networkConfig.
 */
function buildNetworkDevices(project) {
  const sms = project?.stateMachines ?? [];
  const netCfg = project?.networkConfig ?? {};
  const subnet = netCfg.subnet || '10.1.60';
  const ranges = netCfg.ipRanges ?? {};
  const manualModules = netCfg.modules ?? [];
  const chassis = netCfg.chassis ?? [];

  // Collect all networkable devices from SMs
  const discovered = [];
  const counterByRange = {};

  for (const sm of sms) {
    const stationLabel = `S${String(sm.stationNumber ?? 0).padStart(2, '0')}`;
    const devices = (sm.devices ?? []).filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId);

    for (const device of devices) {
      const mapping = NETWORK_DEVICE_MAP[device.type];
      if (!mapping) continue;

      const rangeKey = mapping.rangeKey;
      const range = ranges[rangeKey] ?? { start: 90, prefix: mapping.prefix };
      if (!counterByRange[rangeKey]) counterByRange[rangeKey] = 0;
      counterByRange[rangeKey]++;
      const offset = range.start + counterByRange[rangeKey] - 1;
      const autoIp = `${subnet}.${offset}`;
      const autoName = `${range.prefix}${String(counterByRange[rangeKey]).padStart(2, '0')}_${device.name}`;

      // Check if a manual module overrides this device
      const manual = manualModules.find(m => m.linkedDeviceId === device.id);

      discovered.push({
        id: manual?.id ?? `auto_${device.id}`,
        linkedDeviceId: device.id,
        name: manual?.name || autoName,
        catalogNumber: manual?.catalogNumber || '',
        ipAddress: manual?.ipAddress || autoIp,
        bus: manual?.bus || mapping.bus,
        parentModule: manual?.parentModule || 'Local',
        station: stationLabel,
        smName: sm.displayName ?? sm.name ?? '',
        deviceType: device.type,
        deviceName: device.displayName ?? device.name,
        description: manual?.description || '',
        rpiUs: manual?.rpiUs ?? 10000,
        isManual: !!manual,
        isAuto: true,
      });
    }
  }

  // Add any manual-only modules (not linked to a SM device)
  const linkedIds = new Set(discovered.map(d => d.linkedDeviceId));
  const manualOnly = manualModules
    .filter(m => !m.linkedDeviceId || !linkedIds.has(m.linkedDeviceId))
    .map(m => ({
      ...m,
      isManual: true,
      isAuto: false,
      station: m.station || '',
      smName: '',
      deviceName: m.deviceType || '',
    }));

  const allModules = [...discovered, ...manualOnly];

  // Sort: by bus, then by IP
  allModules.sort((a, b) => {
    if (a.bus !== b.bus) return (a.bus === 'ethernet' ? 0 : 1) - (b.bus === 'ethernet' ? 0 : 1);
    return (a.ipAddress || '').localeCompare(b.ipAddress || '', undefined, { numeric: true });
  });

  // Sort chassis by slot
  const sortedChassis = [...chassis].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

  return { allModules, sortedChassis, subnet, controllerIp: netCfg.controllerIp || `${subnet}.10` };
}

// ── Component ───────────────────────────────────────────────────────────────

export function IOMapEditor() {
  const project = useDiagramStore(s => s.project);
  const { deviceList, devicesByCategory, ioSections } = useMemo(() => buildAll(project), [project]);
  const [activeTab, setActiveTab] = useState('devices');

  // Network data
  const networkData = useMemo(() => buildNetworkDevices(project), [project]);
  const netModuleCount = networkData.allModules.length;
  const chassisCount = networkData.sortedChassis.length;

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
      {/* Sub-tabs: Device List | IO Map | Network */}
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
        <button
          className={`io-map__tab${activeTab === 'network' ? ' io-map__tab--active' : ''}`}
          onClick={() => setActiveTab('network')}
        >
          Network
          <span className="io-map__tab-count">{netModuleCount + chassisCount}</span>
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
              <span className="io-map__grand-total-item" style={{ color: '#5a9a48' }}>{deviceList.reduce((s, d) => s + d.io.di, 0)} DI</span>
              <span className="io-map__grand-total-item" style={{ color: '#aacee8' }}>{deviceList.reduce((s, d) => s + d.io.do, 0)} DO</span>
              <span className="io-map__grand-total-item" style={{ color: '#0072B5' }}>{deviceList.reduce((s, d) => s + d.io.ai, 0)} AI</span>
              <span className="io-map__grand-total-item" style={{ color: '#E8A317' }}>{deviceList.reduce((s, d) => s + d.io.ao, 0)} AO</span>
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

      {/* ── Network Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'network' && (
        <NetworkTab
          project={project}
          networkData={networkData}
        />
      )}
    </div>
  );
}

// ── Network Tab Component ───────────────────────────────────────────────────

function NetworkTab({ project, networkData }) {
  const store = useDiagramStore.getState;
  const netCfg = project?.networkConfig ?? {};
  const { allModules, sortedChassis, subnet, controllerIp } = networkData;
  const [editingId, setEditingId] = useState(null);
  const [showAddModule, setShowAddModule] = useState(false);
  const [showAddChassis, setShowAddChassis] = useState(false);

  // ── Subnet / Controller IP editors ──────────────────────────────────
  const handleSubnetChange = useCallback((val) => {
    store().updateNetworkConfig({ subnet: val });
  }, []);

  const handleControllerIpChange = useCallback((val) => {
    store().updateNetworkConfig({ controllerIp: val });
  }, []);

  // ── Group EtherNet/IP modules by device type ────────────────────────
  const ethernetModules = allModules.filter(m => m.bus === 'ethernet');
  const iolinkModules = allModules.filter(m => m.bus === 'iolink');

  // Group by rangeKey for display
  const ethernetByType = {};
  for (const mod of ethernetModules) {
    const mapping = NETWORK_DEVICE_MAP[mod.deviceType];
    const key = mapping?.rangeKey ?? 'generic';
    if (!ethernetByType[key]) ethernetByType[key] = [];
    ethernetByType[key].push(mod);
  }

  const RANGE_LABELS = {
    servoDrive: { label: 'Servo Drives', icon: 'ServoAxis', color: '#061d39' },
    camera: { label: 'Vision / Cameras', icon: 'VisionSystem', color: '#E8A317' },
    robot: { label: 'Robots', icon: 'Robot', color: '#1264a8' },
    vfd: { label: 'VFDs / Conveyors', icon: 'Conveyor', color: '#0072B5' },
    ioLink: { label: 'IO-Link Masters', icon: 'DigitalSensor', color: '#0072B5' },
    hmi: { label: 'HMI Panels', icon: 'Parameter', color: '#5a6a7e' },
    safety: { label: 'Safety Devices', icon: 'DigitalSensor', color: '#dc2626' },
    generic: { label: 'Other Devices', icon: 'Custom', color: '#8896a8' },
  };

  return (
    <>
      {/* ── Network Summary ──────────────────────────────────────────── */}
      <div className="io-map__summary">
        <div className="io-map__counts">
          <div className="io-map__count-badge" style={{ borderColor: '#1574C4' }}>
            <span className="io-map__count-num" style={{ color: '#1574C4' }}>{ethernetModules.length}</span>
            <span className="io-map__count-label">EtherNet/IP</span>
          </div>
          <div className="io-map__count-badge" style={{ borderColor: '#0072B5' }}>
            <span className="io-map__count-num" style={{ color: '#0072B5' }}>{iolinkModules.length}</span>
            <span className="io-map__count-label">IO-Link</span>
          </div>
          <div className="io-map__count-badge" style={{ borderColor: '#061d39' }}>
            <span className="io-map__count-num" style={{ color: '#061d39' }}>{sortedChassis.length}</span>
            <span className="io-map__count-label">Backplane</span>
          </div>
          <div className="io-map__count-badge io-map__count-badge--total">
            <span className="io-map__count-num">{ethernetModules.length + iolinkModules.length + sortedChassis.length}</span>
            <span className="io-map__count-label">Total</span>
          </div>
        </div>
      </div>

      {/* ── Subnet Configuration ─────────────────────────────────────── */}
      <div className="net__config-bar">
        <div className="net__config-field">
          <label className="net__config-label">Base Subnet</label>
          <input
            className="net__config-input"
            value={netCfg.subnet || '10.1.60'}
            onChange={e => handleSubnetChange(e.target.value)}
            placeholder="10.1.60"
          />
        </div>
        <div className="net__config-field">
          <label className="net__config-label">Controller IP</label>
          <input
            className="net__config-input"
            value={netCfg.controllerIp || '10.1.60.10'}
            onChange={e => handleControllerIpChange(e.target.value)}
            placeholder="10.1.60.10"
          />
        </div>
        <div className="net__config-field">
          <label className="net__config-label">Controller Slot</label>
          <input
            className="net__config-input net__config-input--narrow"
            type="number"
            value={netCfg.controllerSlot ?? 0}
            onChange={e => store().updateNetworkConfig({ controllerSlot: parseInt(e.target.value) || 0 })}
            min={0}
          />
        </div>
        <div className="net__ip-legend">
          <span className="net__ip-legend-title">IP Ranges:</span>
          {Object.entries(netCfg.ipRanges ?? {}).map(([key, range]) => {
            const meta = RANGE_LABELS[key];
            if (!meta) return null;
            return (
              <span key={key} className="net__ip-range-chip" style={{ borderColor: meta.color }}>
                <span style={{ color: meta.color, fontWeight: 700 }}>.{range.start}+</span>
                <span>{meta.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ── EtherNet/IP Modules ──────────────────────────────────────── */}
      <div className="io-map__section">
        <div className="io-map__section-header" style={{ borderLeftColor: '#1574C4' }}>
          <span className="io-map__section-title">
            <span style={{ fontSize: 16 }}>🌐</span>
            EtherNet/IP Devices
          </span>
          <span className="io-map__section-count" style={{ color: '#1574C4' }}>{ethernetModules.length}</span>
          <button className="net__add-btn" onClick={() => setShowAddModule(true)} title="Add manual module">+ Add</button>
        </div>

        {ethernetModules.length === 0 && !showAddModule && (
          <div className="io-map__empty" style={{ padding: '16px 20px' }}>
            <p>No EtherNet/IP devices detected.</p>
            <p style={{ color: '#64748b', fontSize: 12 }}>
              Add servo axes, vision systems, or robots to your state machines — they will appear here automatically with auto-assigned IPs.
            </p>
          </div>
        )}

        {ethernetModules.length > 0 && (
          <table className="io-map__table">
            <thead>
              <tr>
                <th className="io-map__th" style={{ width: 32 }}>#</th>
                <th className="io-map__th" style={{ width: 130 }}>Module Name</th>
                <th className="io-map__th" style={{ width: 120 }}>IP Address</th>
                <th className="io-map__th" style={{ width: 140 }}>Catalog Number</th>
                <th className="io-map__th io-map__th--station">Station</th>
                <th className="io-map__th">Device</th>
                <th className="io-map__th" style={{ width: 70 }}>RPI (ms)</th>
                <th className="io-map__th" style={{ width: 60 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ethernetModules.map((mod, i) => {
                const mapping = NETWORK_DEVICE_MAP[mod.deviceType];
                const rangeLabel = RANGE_LABELS[mapping?.rangeKey ?? 'generic'];
                const isEditing = editingId === mod.id;

                return (
                  <tr key={mod.id} className={`io-map__row${isEditing ? ' net__row--editing' : ''}`}>
                    <td className="io-map__td io-map__td--num">{i + 1}</td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={mod.name}
                          onChange={e => {
                            if (mod.isManual || mod.isAuto) {
                              const mods = [...(netCfg.modules ?? [])];
                              const existing = mods.find(m => m.id === mod.id);
                              if (existing) {
                                store().updateNetworkModule(mod.id, { name: e.target.value });
                              } else {
                                store().addNetworkModule({ ...mod, id: undefined, linkedDeviceId: mod.linkedDeviceId, name: e.target.value });
                              }
                            }
                          }} />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {mod.deviceType && <DeviceIcon type={mod.deviceType} size={14} />}
                          <code className="net__module-name">{mod.name}</code>
                        </span>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input net__inline-input--ip" value={mod.ipAddress}
                          onChange={e => _saveModField(store, netCfg, mod, 'ipAddress', e.target.value)} />
                      ) : (
                        <code className="net__ip">{mod.ipAddress}</code>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={mod.catalogNumber} placeholder="e.g. 2198-H025-ERS2"
                          onChange={e => _saveModField(store, netCfg, mod, 'catalogNumber', e.target.value)} />
                      ) : (
                        <span className="net__catalog">{mod.catalogNumber || <span className="io-map__zero">—</span>}</span>
                      )}
                    </td>
                    <td className="io-map__td io-map__td--station">
                      {mod.station && <span className="io-map__station-badge">{mod.station}</span>}
                    </td>
                    <td className="io-map__td" style={{ fontSize: 11, color: '#5a6a7e' }}>
                      {mod.deviceName || mod.deviceType || '—'}
                    </td>
                    <td className="io-map__td" style={{ textAlign: 'center', fontSize: 11 }}>
                      {isEditing ? (
                        <input className="net__inline-input net__inline-input--narrow" type="number"
                          value={Math.round((mod.rpiUs ?? 10000) / 1000)}
                          onChange={e => _saveModField(store, netCfg, mod, 'rpiUs', (parseInt(e.target.value) || 10) * 1000)} />
                      ) : (
                        <span>{Math.round((mod.rpiUs ?? 10000) / 1000)}</span>
                      )}
                    </td>
                    <td className="io-map__td" style={{ textAlign: 'center' }}>
                      <button
                        className="net__edit-btn"
                        onClick={() => setEditingId(isEditing ? null : mod.id)}
                        title={isEditing ? 'Done' : 'Edit'}
                      >
                        {isEditing ? '✓' : '✎'}
                      </button>
                      {mod.isManual && !mod.isAuto && (
                        <button className="net__delete-btn" onClick={() => store().deleteNetworkModule(mod.id)} title="Remove">✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Add manual module form */}
        {showAddModule && (
          <AddModuleForm
            onAdd={(data) => { store().addNetworkModule(data); setShowAddModule(false); }}
            onCancel={() => setShowAddModule(false)}
            subnet={subnet}
          />
        )}
      </div>

      {/* ── Backplane / Chassis Layout ───────────────────────────────── */}
      <div className="io-map__section">
        <div className="io-map__section-header" style={{ borderLeftColor: '#061d39' }}>
          <span className="io-map__section-title">
            <span style={{ fontSize: 16 }}>📦</span>
            Backplane / Chassis Layout
          </span>
          <span className="io-map__section-count" style={{ color: '#061d39' }}>{sortedChassis.length}</span>
          <button className="net__add-btn" onClick={() => setShowAddChassis(true)} title="Add chassis module">+ Add</button>
        </div>

        {sortedChassis.length === 0 && !showAddChassis && (
          <div className="io-map__empty" style={{ padding: '16px 20px' }}>
            <p>No backplane modules defined.</p>
            <p style={{ color: '#64748b', fontSize: 12 }}>
              Add DI/DO/AI/AO/Safety modules to define the local chassis layout. Slot 0 is typically the controller.
            </p>
          </div>
        )}

        {/* Controller (always slot 0) */}
        <div className="net__chassis-visual">
          <div className="net__chassis-slot net__chassis-slot--controller">
            <div className="net__chassis-slot-num">0</div>
            <div className="net__chassis-slot-label">CPU</div>
            <div className="net__chassis-slot-cat" style={{ fontSize: 8 }}>{controllerIp}</div>
          </div>
          {sortedChassis.map(slot => {
            const meta = CHASSIS_TYPE_META[slot.type] ?? CHASSIS_TYPE_META.OTHER;
            return (
              <div key={slot.id} className="net__chassis-slot" style={{ borderTopColor: meta.color }}>
                <div className="net__chassis-slot-num">{slot.slot}</div>
                <div className="net__chassis-slot-label" style={{ color: meta.color }}>{slot.type}</div>
                <div className="net__chassis-slot-cat" title={slot.catalogNumber}>{slot.name || slot.catalogNumber || '—'}</div>
              </div>
            );
          })}
        </div>

        {sortedChassis.length > 0 && (
          <table className="io-map__table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th className="io-map__th" style={{ width: 48 }}>Slot</th>
                <th className="io-map__th" style={{ width: 80 }}>Type</th>
                <th className="io-map__th" style={{ width: 120 }}>Name</th>
                <th className="io-map__th" style={{ width: 150 }}>Catalog Number</th>
                <th className="io-map__th">Description</th>
                <th className="io-map__th" style={{ width: 60 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedChassis.map(slot => {
                const meta = CHASSIS_TYPE_META[slot.type] ?? CHASSIS_TYPE_META.OTHER;
                const isEditing = editingId === slot.id;
                return (
                  <tr key={slot.id} className={`io-map__row${isEditing ? ' net__row--editing' : ''}`}>
                    <td className="io-map__td" style={{ textAlign: 'center', fontWeight: 700 }}>
                      {isEditing ? (
                        <input className="net__inline-input net__inline-input--narrow" type="number" value={slot.slot ?? 0}
                          onChange={e => store().updateChassisModule(slot.id, { slot: parseInt(e.target.value) || 0 })} min={0} />
                      ) : slot.slot}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <select className="net__inline-select" value={slot.type}
                          onChange={e => store().updateChassisModule(slot.id, { type: e.target.value })}>
                          {CHASSIS_MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      ) : (
                        <span className="net__type-badge" style={{ background: meta.color }}>{meta.label}</span>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={slot.name || ''} placeholder="e.g. DI_1"
                          onChange={e => store().updateChassisModule(slot.id, { name: e.target.value })} />
                      ) : (
                        <code>{slot.name || '—'}</code>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={slot.catalogNumber || ''} placeholder="e.g. 5069-IB16/A"
                          onChange={e => store().updateChassisModule(slot.id, { catalogNumber: e.target.value })} />
                      ) : (
                        <span className="net__catalog">{slot.catalogNumber || '—'}</span>
                      )}
                    </td>
                    <td className="io-map__td" style={{ fontSize: 11, color: '#5a6a7e' }}>
                      {isEditing ? (
                        <input className="net__inline-input" value={slot.description || ''} placeholder="Description"
                          onChange={e => store().updateChassisModule(slot.id, { description: e.target.value })} />
                      ) : (slot.description || '—')}
                    </td>
                    <td className="io-map__td" style={{ textAlign: 'center' }}>
                      <button className="net__edit-btn" onClick={() => setEditingId(isEditing ? null : slot.id)}
                        title={isEditing ? 'Done' : 'Edit'}>
                        {isEditing ? '✓' : '✎'}
                      </button>
                      <button className="net__delete-btn" onClick={() => store().deleteChassisModule(slot.id)} title="Remove">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Add chassis module form */}
        {showAddChassis && (
          <AddChassisForm
            onAdd={(data) => { store().addChassisModule(data); setShowAddChassis(false); }}
            onCancel={() => setShowAddChassis(false)}
            nextSlot={(sortedChassis.length > 0 ? Math.max(...sortedChassis.map(s => s.slot ?? 0)) + 1 : 1)}
          />
        )}
      </div>

      {/* ── IP Address Map (read-only summary) ───────────────────────── */}
      {(ethernetModules.length > 0 || sortedChassis.length > 0) && (
        <div className="io-map__section">
          <div className="io-map__section-header" style={{ borderLeftColor: '#5a6a7e' }}>
            <span className="io-map__section-title">
              <span style={{ fontSize: 16 }}>📋</span>
              IP Address Summary
            </span>
          </div>
          <div className="net__ip-summary">
            <div className="net__ip-row net__ip-row--header">
              <span className="net__ip-addr">{controllerIp}</span>
              <span className="net__ip-name">Controller (PLC)</span>
              <span className="net__ip-type-badge" style={{ background: '#061d39' }}>CPU</span>
            </div>
            {ethernetModules.map(mod => {
              const mapping = NETWORK_DEVICE_MAP[mod.deviceType];
              const rl = RANGE_LABELS[mapping?.rangeKey ?? 'generic'];
              return (
                <div key={mod.id} className="net__ip-row">
                  <span className="net__ip-addr">{mod.ipAddress}</span>
                  <span className="net__ip-name">{mod.name}</span>
                  {mod.station && <span className="io-map__station-badge" style={{ fontSize: 9 }}>{mod.station}</span>}
                  {mod.catalogNumber && <span className="net__catalog" style={{ fontSize: 10 }}>{mod.catalogNumber}</span>}
                  <span className="net__ip-type-badge" style={{ background: rl?.color ?? '#8896a8' }}>{rl?.label ?? mod.deviceType}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ── Helper: save a field on a module (auto-promote to manual if needed) ─────

function _saveModField(store, netCfg, mod, field, value) {
  const modules = netCfg.modules ?? [];
  const existing = modules.find(m => m.id === mod.id);
  if (existing) {
    store().updateNetworkModule(mod.id, { [field]: value });
  } else {
    // Auto-discovered module being edited for the first time — create manual override
    store().addNetworkModule({
      linkedDeviceId: mod.linkedDeviceId,
      name: mod.name,
      catalogNumber: mod.catalogNumber,
      ipAddress: mod.ipAddress,
      bus: mod.bus,
      parentModule: mod.parentModule,
      station: mod.station,
      deviceType: mod.deviceType,
      description: mod.description,
      rpiUs: mod.rpiUs,
      [field]: value,
    });
  }
}

// ── Add Module Form ─────────────────────────────────────────────────────────

function AddModuleForm({ onAdd, onCancel, subnet }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState(`${subnet}.`);
  const [catalog, setCatalog] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="net__add-form">
      <div className="net__add-form-title">Add EtherNet/IP Module</div>
      <div className="net__add-form-fields">
        <input className="net__add-input" value={name} onChange={e => setName(e.target.value)} placeholder="Module name (e.g. cam03_S06Inspect)" />
        <input className="net__add-input" value={ip} onChange={e => setIp(e.target.value)} placeholder="IP address" />
        <input className="net__add-input" value={catalog} onChange={e => setCatalog(e.target.value)} placeholder="Catalog # (optional)" />
        <select className="net__add-input" value={deviceType} onChange={e => setDeviceType(e.target.value)}>
          <option value="">Device type...</option>
          <option value="servoDrive">Servo Drive</option>
          <option value="camera">Camera / Vision</option>
          <option value="robot">Robot</option>
          <option value="vfd">VFD / Conveyor</option>
          <option value="ioLink">IO-Link Master</option>
          <option value="hmi">HMI Panel</option>
          <option value="safety">Safety Device</option>
          <option value="generic">Other</option>
        </select>
        <input className="net__add-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" />
      </div>
      <div className="net__add-form-actions">
        <button className="net__add-form-btn net__add-form-btn--save" disabled={!name || !ip}
          onClick={() => onAdd({ name, ipAddress: ip, catalogNumber: catalog, bus: 'ethernet', deviceType, description: desc })}>
          Add Module
        </button>
        <button className="net__add-form-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Add Chassis Form ────────────────────────────────────────────────────────

function AddChassisForm({ onAdd, onCancel, nextSlot }) {
  const [slot, setSlot] = useState(nextSlot);
  const [name, setName] = useState('');
  const [type, setType] = useState('DI');
  const [catalog, setCatalog] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="net__add-form">
      <div className="net__add-form-title">Add Backplane Module</div>
      <div className="net__add-form-fields">
        <input className="net__add-input net__add-input--narrow" type="number" value={slot} onChange={e => setSlot(parseInt(e.target.value) || 0)} placeholder="Slot #" min={0} />
        <select className="net__add-input" value={type} onChange={e => setType(e.target.value)}>
          {CHASSIS_MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input className="net__add-input" value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. DI_1)" />
        <input className="net__add-input" value={catalog} onChange={e => setCatalog(e.target.value)} placeholder="Catalog # (e.g. 5069-IB16/A)" />
        <input className="net__add-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" />
      </div>
      <div className="net__add-form-actions">
        <button className="net__add-form-btn net__add-form-btn--save"
          onClick={() => onAdd({ slot, name, type, catalogNumber: catalog, description: desc })}>
          Add Module
        </button>
        <button className="net__add-form-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
