/**
 * DesignSystemEditor — Visual design system reference & editor.
 *
 * Shows live previews of every visual element in the app:
 *   - Color palette with editable swatches
 *   - Node shapes gallery (live SVG polygons)
 *   - Device icons gallery
 *   - Operation badge colors
 *   - Edge & handle previews
 *   - Typography scale
 *   - Station type colors
 *   - Decision node mode colors
 *
 * All values are live — editing a color updates the swatch instantly.
 * Values are stored in project.designTheme for persistence.
 */

import { useState, useMemo, useEffect } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DeviceIcon, DEVICE_ICON_COLORS } from './DeviceIcons.jsx';

// ── Data: mirrors the app's actual values ────────────────────────────────────

const BRAND_COLORS = [
  { key: 'primary',      label: 'Primary Blue',       defaultVal: '#1574C4', css: '--color-primary',   desc: 'Toolbar, buttons, active tabs, links' },
  { key: 'primaryHover', label: 'Primary Hover',      defaultVal: '#1264a8', css: '--color-primary-h', desc: 'Hover state for primary elements' },
  { key: 'mediumBlue',   label: 'Medium Blue',        defaultVal: '#0072B5', css: '',                  desc: 'Wait mode, selected edges, deep accents' },
  { key: 'darkNavy',     label: 'Dark Navy',          defaultVal: '#061d39', css: '',                  desc: 'Grand totals, dark backgrounds' },
  { key: 'lightBlue',    label: 'Light Blue',         defaultVal: '#aacee8', css: '',                  desc: 'Passive operations, light accents' },
  { key: 'navy',         label: 'Navy',               defaultVal: '#1e3a5f', css: '',                  desc: 'Gradient dark end, state signal bg' },
];

const STATUS_COLORS = [
  { key: 'success',    label: 'Success Green',   defaultVal: '#5a9a48', css: '--color-success',  desc: 'Initial/complete nodes, good parts, DI' },
  { key: 'danger',     label: 'Danger Red',      defaultVal: '#b83c3c', css: '--color-danger',   desc: 'Delete buttons, danger actions' },
  { key: 'warning',    label: 'Warning Amber',   defaultVal: '#c9a643', css: '--color-warning',  desc: 'Warning indicators' },
  { key: 'verify',     label: 'Verify Amber',    defaultVal: '#E8A317', css: '',                 desc: 'Verify mode, vision category, AO' },
];

const TEXT_COLORS = [
  { key: 'text',       label: 'Primary Text',    defaultVal: '#231f20', css: '--color-text',       desc: 'Main body text, headings' },
  { key: 'textMuted',  label: 'Muted Text',      defaultVal: '#5a6a7e', css: '--color-text-muted', desc: 'Secondary text, labels' },
  { key: 'textLight',  label: 'Light Text',      defaultVal: '#8896a8', css: '--color-text-light', desc: 'Tertiary text, placeholders' },
];

const BG_COLORS = [
  { key: 'bg',        label: 'App Background',  defaultVal: '#f0f2f5', css: '--color-bg',      desc: 'Main canvas background' },
  { key: 'surface',   label: 'Surface',         defaultVal: '#ffffff', css: '--color-surface',  desc: 'Cards, panels, modals' },
  { key: 'sidebar',   label: 'Sidebar',         defaultVal: '#f8fafc', css: '--color-sidebar',  desc: 'Left sidebar, section bg' },
  { key: 'border',    label: 'Border',          defaultVal: '#e2e8f0', css: '--color-border',   desc: 'All standard borders' },
];

const EDGE_COLORS = [
  { key: 'edgePass',     label: 'Pass / True',    defaultVal: '#16a34a', desc: 'Pass/true branch edges' },
  { key: 'edgeFail',     label: 'Fail / False',   defaultVal: '#dc2626', desc: 'Fail/false branch edges' },
  { key: 'edgeRetry',    label: 'Retry',           defaultVal: '#f59e0b', desc: 'Retry branch edges' },
  { key: 'edgeSelected', label: 'Selected',        defaultVal: '#0072B5', desc: 'Currently selected edge' },
  { key: 'edgeDefault',  label: 'Default',         defaultVal: '#6b7280', desc: 'Normal unselected edge' },
];

const DECISION_MODES = [
  { key: 'waitFill',    label: 'Wait – Fill',    defaultVal: '#0072B5', desc: 'Decision node Wait mode' },
  { key: 'waitBorder',  label: 'Wait – Border',  defaultVal: '#005a91', desc: '' },
  { key: 'decideFill',  label: 'Decide – Fill',  defaultVal: '#7c3aed', desc: 'Decision node Decide mode' },
  { key: 'decideBorder',label: 'Decide – Border', defaultVal: '#6d28d9', desc: '' },
  { key: 'verifyFill',  label: 'Verify – Fill',  defaultVal: '#E8A317', desc: 'Decision node Verify mode' },
  { key: 'verifyBorder',label: 'Verify – Border', defaultVal: '#b87d0f', desc: '' },
];

const STATION_TYPES = [
  { key: 'stLoad',    label: 'Load',    defaultVal: '#1574C4' },
  { key: 'stProcess', label: 'Process', defaultVal: '#7B2D8E' },
  { key: 'stVerify',  label: 'Verify',  defaultVal: '#E8A317' },
  { key: 'stReject',  label: 'Reject',  defaultVal: '#DC2626' },
  { key: 'stUnload',  label: 'Unload',  defaultVal: '#5BB0D8' },
  { key: 'stIndexer', label: 'Indexer', defaultVal: '#0d9488' },
  { key: 'stFeed',    label: 'Feed',    defaultVal: '#ca8a04' },
  { key: 'stRobot',   label: 'Robot',   defaultVal: '#9333ea' },
  { key: 'stEmpty',   label: 'Empty',   defaultVal: '#94a3b8' },
];

const OPERATION_BADGES = [
  { op: 'Extend',       color: '#1574c4', cat: 'Active',    light: false },
  { op: 'Engage',       color: '#1574c4', cat: 'Active',    light: false },
  { op: 'VacOn',        color: '#1574c4', cat: 'Active',    light: false },
  { op: 'ServoMove',    color: '#1574c4', cat: 'Active',    light: false },
  { op: 'SetOn',        color: '#1574c4', cat: 'Active',    light: false },
  { op: 'WaitOn',       color: '#1574c4', cat: 'Active',    light: false },
  { op: 'Retract',      color: '#aacee8', cat: 'Passive',   light: true },
  { op: 'Disengage',    color: '#aacee8', cat: 'Passive',   light: true },
  { op: 'VacOff',       color: '#aacee8', cat: 'Passive',   light: true },
  { op: 'ServoIndex',   color: '#aacee8', cat: 'Passive',   light: true },
  { op: 'SetOff',       color: '#aacee8', cat: 'Passive',   light: true },
  { op: 'WaitOff',      color: '#aacee8', cat: 'Passive',   light: true },
  { op: 'SetValue',     color: '#befa4f', cat: 'Parameter', light: true },
  { op: 'ServoIncr',    color: '#befa4f', cat: 'Parameter', light: true },
  { op: 'VerifyValue',  color: '#d9d9d9', cat: 'Sensor',    light: true },
  { op: 'Check',        color: '#d9d9d9', cat: 'Sensor',    light: true },
  { op: 'VisionInspect',color: '#ffde51', cat: 'Vision',    light: true },
];

const DEVICE_ICON_LIST = [
  { type: 'PneumaticLinearActuator', label: 'Linear Actuator',  shape: 'rect' },
  { type: 'PneumaticRotaryActuator', label: 'Rotary Actuator',  shape: 'pentagon' },
  { type: 'PneumaticGripper',        label: 'Gripper',          shape: 'hexagon' },
  { type: 'PneumaticVacGenerator',   label: 'Vacuum Generator', shape: 'octagon' },
  { type: 'ServoAxis',               label: 'Servo Axis',       shape: 'decagon' },
  { type: 'Robot',                    label: 'Robot',            shape: 'rounded' },
  { type: 'Conveyor',                label: 'Conveyor',         shape: 'rounded' },
  { type: 'Timer',                    label: 'Timer',            shape: 'dodecagon' },
  { type: 'DigitalSensor',           label: 'Digital Sensor',   shape: 'poly14' },
  { type: 'AnalogSensor',            label: 'Analog Sensor',    shape: 'poly14' },
  { type: 'Parameter',               label: 'Parameter',        shape: 'pill' },
  { type: 'VisionSystem',            label: 'Vision System',    shape: 'rect' },
  { type: 'Custom',                  label: 'Custom Device',    shape: 'rounded' },
];

const TYPOGRAPHY_SCALE = [
  { size: 8,  weight: 400, label: 'XS — Fine print, footnotes' },
  { size: 9,  weight: 600, label: 'XS — Badge labels, metadata' },
  { size: 10, weight: 700, label: 'SM — Station badges, state numbers' },
  { size: 11, weight: 600, label: 'SM — Form labels, secondary body' },
  { size: 12, weight: 400, label: 'Body — Table cells, descriptions' },
  { size: 13, weight: 400, label: 'Body — Menu items, buttons' },
  { size: 14, weight: 400, label: 'Base — Default body text (root)' },
  { size: 16, weight: 700, label: 'Heading SM — Section headings' },
  { size: 20, weight: 700, label: 'Heading MD — Modal titles' },
  { size: 22, weight: 800, label: 'Heading LG — Major headings' },
];

const HANDLE_TYPES = [
  { id: 'target',      label: 'Target (input)', color: '#64748b', desc: 'Top of node, no grow on hover' },
  { id: 'exit-pass',   label: 'Pass Exit',      color: '#5a9a48', desc: 'Green dot, bottom-left' },
  { id: 'exit-fail',   label: 'Fail Exit',      color: '#ef4444', desc: 'Red dot, bottom-right' },
  { id: 'exit-single', label: 'Single Exit',    color: '#6b7280', desc: 'Gray dot, bottom center' },
  { id: 'exit-retry',  label: 'Retry Exit',     color: '#f59e0b', desc: 'Amber dot, right side' },
];

// ── Mini shape builder (simplified from StateNode) ───────────────────────────
const CORNER_PX = 14;
function buildShapePoints(shape, w, h) {
  const c = CORNER_PX;
  const cx = Math.min(c, w * 0.15);
  const cy = Math.min(c, h * 0.15);
  switch (shape) {
    case 'rect':      return `0,0 ${w},0 ${w},${h} 0,${h}`;
    case 'pentagon':  return `${cx},0 ${w-cx},0 ${w},${h*0.62} ${w/2},${h} 0,${h*0.62}`;
    case 'hexagon':   return `${cx},0 ${w-cx},0 ${w},${h/2} ${w-cx},${h} ${cx},${h} 0,${h/2}`;
    case 'octagon':   return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${cy}`;
    case 'decagon':   return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${h/2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h/2} 0,${cy}`;
    case 'dodecagon': {
      const cy2 = cy * 2.5;
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${cy2} ${w},${h-cy2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h-cy2} 0,${cy2} 0,${cy}`;
    }
    case 'poly14': {
      const cy2 = cy * 2.2;
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${cy2} ${w},${h/2} ${w},${h-cy2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h-cy2} 0,${h/2} 0,${cy2} 0,${cy}`;
    }
    case 'poly16': {
      const cy2 = cy * 1.8;
      const cy3 = cy * 3;
      return `${cx},0 ${w-cx},0 ${w},${cy} ${w},${cy2} ${w},${cy3} ${w},${h-cy3} ${w},${h-cy2} ${w},${h-cy} ${w-cx},${h} ${cx},${h} 0,${h-cy} 0,${h-cy2} 0,${h-cy3} 0,${cy3} 0,${cy2} 0,${cy}`;
    }
    default: return null;
  }
}

// ── Reusable sub-components ──────────────────────────────────────────────────

function ColorSwatch({ color, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 4, background: color,
      border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
    }} />
  );
}

function ColorRow({ item, value, onChange }) {
  return (
    <div className="ds__color-row">
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="ds__color-picker"
      />
      <ColorSwatch color={value} size={28} />
      <div className="ds__color-info">
        <div className="ds__color-name">{item.label}</div>
        {item.desc && <div className="ds__color-desc">{item.desc}</div>}
      </div>
      <code className="ds__color-hex">{value.toUpperCase()}</code>
      {item.css && <code className="ds__color-css">{item.css}</code>}
    </div>
  );
}

function Section({ title, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ds__section">
      <div className="ds__section-header" onClick={() => setOpen(!open)}>
        <span className="ds__section-chevron" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
        <span className="ds__section-title">{title}</span>
        {subtitle && <span className="ds__section-subtitle">{subtitle}</span>}
      </div>
      {open && <div className="ds__section-body">{children}</div>}
    </div>
  );
}

function MiniNodeShape({ shape, w = 100, h = 50, fillColor = '#fff', borderColor = '#1574C4' }) {
  const points = buildShapePoints(shape, w, h);
  if (!points) {
    // Rounded rect
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <rect x="1" y="1" width={w - 2} height={h - 2} rx="8" ry="8"
          fill={fillColor} stroke={borderColor} strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polygon points={points} fill={fillColor} stroke={borderColor} strokeWidth="2"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MiniPillShape({ w = 100, h = 40, fillColor = '#fff', borderColor = '#1574C4' }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <rect x="1" y="1" width={w - 2} height={h - 2} rx={h / 2} ry={h / 2}
        fill={fillColor} stroke={borderColor} strokeWidth="2" />
    </svg>
  );
}

/** Number input that tolerates in-progress typing (empty, below-min, etc.)
 *  without snapping back to the last committed value. Only commits valid
 *  numbers in range. Reverts to last good value on blur if draft is junk. */
function SpacingNumberInput({ value, onCommit, min, max, step }) {
  const [draft, setDraft] = useState(String(value));
  // When the underlying value changes from outside (Reset button, etc.),
  // sync the draft so the field displays the new value.
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={e => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => {
        const n = Number(draft);
        if (!Number.isFinite(n) || n < min || n > max) {
          setDraft(String(value));
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
      }}
      onFocus={e => e.currentTarget.select()}
      style={{
        width: 90, padding: '6px 8px', fontSize: 14, fontWeight: 600,
        border: '1px solid #cbd5e1', borderRadius: 4, textAlign: 'right',
      }}
    />
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DesignSystemEditor() {
  const project = useDiagramStore(s => s.project);
  const theme = project?.designTheme ?? {};

  // Read a themed value, falling back to the default
  function tv(key, defaultVal) {
    return theme[key] ?? defaultVal;
  }

  // Update a single theme key
  function setThemeVal(key, val) {
    const store = useDiagramStore.getState();
    const current = store.project?.designTheme ?? {};
    const next = { ...current, [key]: val };
    store.updateProjectField('designTheme', next);
  }

  return (
    <div className="ds-editor">
      <div className="ds__intro">
        <h2 className="ds__main-title">Design System Reference</h2>
        <p className="ds__main-desc">
          Visual reference for every color, shape, icon, and typography style used in the app.
          Edit any value — changes are saved to the project file.
        </p>
      </div>

      {/* ── BRAND COLORS ────────────────────────────────────────────────── */}
      <Section title="Brand Colors" subtitle={`${BRAND_COLORS.length} values`}>
        {BRAND_COLORS.map(c => (
          <ColorRow key={c.key} item={c} value={tv(c.key, c.defaultVal)}
            onChange={v => setThemeVal(c.key, v)} />
        ))}
      </Section>

      {/* ── STATUS COLORS ───────────────────────────────────────────────── */}
      <Section title="Status Colors" subtitle={`${STATUS_COLORS.length} values`}>
        {STATUS_COLORS.map(c => (
          <ColorRow key={c.key} item={c} value={tv(c.key, c.defaultVal)}
            onChange={v => setThemeVal(c.key, v)} />
        ))}
      </Section>

      {/* ── TEXT COLORS ─────────────────────────────────────────────────── */}
      <Section title="Text Colors" subtitle={`${TEXT_COLORS.length} values`}>
        {TEXT_COLORS.map(c => (
          <ColorRow key={c.key} item={c} value={tv(c.key, c.defaultVal)}
            onChange={v => setThemeVal(c.key, v)} />
        ))}
        <div className="ds__text-preview">
          <span style={{ color: tv('text', '#231f20'), fontSize: 14 }}>Primary text looks like this</span>
          <span style={{ color: tv('textMuted', '#5a6a7e'), fontSize: 13 }}>Muted text looks like this</span>
          <span style={{ color: tv('textLight', '#8896a8'), fontSize: 12 }}>Light text looks like this</span>
        </div>
      </Section>

      {/* ── BACKGROUND COLORS ───────────────────────────────────────────── */}
      <Section title="Background Colors" subtitle={`${BG_COLORS.length} values`}>
        {BG_COLORS.map(c => (
          <ColorRow key={c.key} item={c} value={tv(c.key, c.defaultVal)}
            onChange={v => setThemeVal(c.key, v)} />
        ))}
        <div className="ds__bg-preview">
          <div className="ds__bg-chip" style={{ background: tv('bg', '#f0f2f5') }}>App BG</div>
          <div className="ds__bg-chip" style={{ background: tv('surface', '#ffffff'), border: `1px solid ${tv('border', '#e2e8f0')}` }}>Surface</div>
          <div className="ds__bg-chip" style={{ background: tv('sidebar', '#f8fafc'), border: `1px solid ${tv('border', '#e2e8f0')}` }}>Sidebar</div>
        </div>
      </Section>

      {/* ── EDGE COLORS ─────────────────────────────────────────────────── */}
      <Section title="Edge Colors" subtitle="Connection lines between nodes">
        {EDGE_COLORS.map(c => (
          <div key={c.key} className="ds__edge-row">
            <input type="color" value={tv(c.key, c.defaultVal)} onChange={e => setThemeVal(c.key, e.target.value)} className="ds__color-picker" />
            <svg width="80" height="24" viewBox="0 0 80 24">
              <line x1="4" y1="12" x2="60" y2="12" stroke={tv(c.key, c.defaultVal)}
                strokeWidth={c.key === 'edgeSelected' ? 3 : 2} strokeLinecap="round" />
              <polygon points="60,6 72,12 60,18" fill={tv(c.key, c.defaultVal)} />
            </svg>
            <div className="ds__color-info">
              <div className="ds__color-name">{c.label}</div>
              {c.desc && <div className="ds__color-desc">{c.desc}</div>}
            </div>
            <code className="ds__color-hex">{tv(c.key, c.defaultVal).toUpperCase()}</code>
          </div>
        ))}
      </Section>

      {/* ── DECISION NODE MODES ─────────────────────────────────────────── */}
      <Section title="Decision Node Modes" subtitle="Wait / Decide / Verify colors">
        <div className="ds__decision-gallery">
          {[
            { mode: 'Wait',   fillKey: 'waitFill',   borderKey: 'waitBorder',   emoji: '⏳' },
            { mode: 'Decide', fillKey: 'decideFill', borderKey: 'decideBorder', emoji: '⚡' },
            { mode: 'Verify', fillKey: 'verifyFill', borderKey: 'verifyBorder', emoji: '✓' },
          ].map(m => {
            const fill = tv(m.fillKey, DECISION_MODES.find(d => d.key === m.fillKey)?.defaultVal);
            const border = tv(m.borderKey, DECISION_MODES.find(d => d.key === m.borderKey)?.defaultVal);
            return (
              <div key={m.mode} className="ds__decision-card">
                <div className="ds__decision-node" style={{ background: fill, border: `2px solid ${border}` }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{m.emoji} {m.mode}:</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>SensorName</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>Check: ON</span>
                </div>
                <div className="ds__decision-controls">
                  <label className="ds__mini-label">
                    Fill
                    <input type="color" value={fill} onChange={e => setThemeVal(m.fillKey, e.target.value)} className="ds__color-picker" />
                    <code>{fill.toUpperCase()}</code>
                  </label>
                  <label className="ds__mini-label">
                    Border
                    <input type="color" value={border} onChange={e => setThemeVal(m.borderKey, e.target.value)} className="ds__color-picker" />
                    <code>{border.toUpperCase()}</code>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── STATION TYPE COLORS ─────────────────────────────────────────── */}
      <Section title="Station Type Colors" subtitle="Machine configuration badge colors">
        <div className="ds__station-gallery">
          {STATION_TYPES.map(st => {
            const val = tv(st.key, st.defaultVal);
            return (
              <div key={st.key} className="ds__station-chip">
                <input type="color" value={val} onChange={e => setThemeVal(st.key, e.target.value)} className="ds__color-picker" />
                <div className="ds__station-badge" style={{ background: val }}>{st.label}</div>
                <code className="ds__color-hex">{val.toUpperCase()}</code>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── DEVICE ICONS + NODE SHAPES ──────────────────────────────────── */}
      <Section title="Device Icons & Node Shapes" subtitle={`${DEVICE_ICON_LIST.length} device types`}>
        <div className="ds__device-gallery">
          {DEVICE_ICON_LIST.map(d => {
            const iconColor = DEVICE_ICON_COLORS[d.type] ?? '#9ca3af';
            return (
              <div key={d.type} className="ds__device-card">
                <div className="ds__device-icon-box">
                  <DeviceIcon type={d.type} size={36} />
                </div>
                <div className="ds__device-shape-box">
                  {d.shape === 'pill'
                    ? <MiniPillShape w={90} h={40} borderColor={iconColor} />
                    : <MiniNodeShape shape={d.shape} w={90} h={50} borderColor={iconColor} />}
                </div>
                <div className="ds__device-label">{d.label}</div>
                <div className="ds__device-meta">
                  <ColorSwatch color={iconColor} size={14} />
                  <code style={{ fontSize: 9 }}>{iconColor}</code>
                </div>
                <div className="ds__device-shape-label">{d.shape}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── OPERATION BADGE COLORS ──────────────────────────────────────── */}
      <Section title="Operation Badge Colors" subtitle="Action badges on state nodes">
        <div className="ds__op-gallery">
          {OPERATION_BADGES.map(op => (
            <div key={op.op} className="ds__op-badge-row">
              <div className="ds__op-badge" style={{
                background: op.color,
                color: op.light ? '#231f20' : '#fff',
                border: `1px solid ${op.color}`,
              }}>
                {op.op}
              </div>
              <ColorSwatch color={op.color} size={20} />
              <code style={{ fontSize: 10, color: '#5a6a7e' }}>{op.color}</code>
              <span className="ds__op-cat">{op.cat}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── HANDLES ─────────────────────────────────────────────────────── */}
      <Section title="Connection Handles" subtitle="Node connection points" defaultOpen={false}>
        <div className="ds__handle-gallery">
          {HANDLE_TYPES.map(h => (
            <div key={h.id} className="ds__handle-row">
              <div className="ds__handle-dot" style={{ background: h.color, border: '2px solid #fff', boxShadow: `0 0 0 1px ${h.color}44, 0 1px 3px rgba(0,0,0,0.2)` }} />
              <div className="ds__handle-dot ds__handle-dot--hover" style={{ background: h.color, border: '2px solid #fff', boxShadow: `0 0 0 6px ${h.color}33, 0 1px 3px rgba(0,0,0,0.25)` }} />
              <div className="ds__color-info">
                <div className="ds__color-name">{h.label}</div>
                <div className="ds__color-desc">{h.desc}</div>
              </div>
              <ColorSwatch color={h.color} size={20} />
              <code className="ds__color-hex">{h.color}</code>
            </div>
          ))}
        </div>
      </Section>

      {/* ── TYPOGRAPHY ──────────────────────────────────────────────────── */}
      <Section title="Typography Scale" subtitle="Font sizes, weights, and families" defaultOpen={false}>
        <div className="ds__typo-info">
          <div className="ds__typo-font">
            <strong>Primary:</strong> Montserrat, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif
          </div>
          <div className="ds__typo-font" style={{ fontFamily: 'Consolas, Menlo, Monaco, monospace' }}>
            <strong>Code:</strong> Consolas, Menlo, Monaco, monospace
          </div>
        </div>
        <div className="ds__typo-scale">
          {TYPOGRAPHY_SCALE.map(t => (
            <div key={`${t.size}-${t.weight}`} className="ds__typo-row">
              <div className="ds__typo-meta">
                <span className="ds__typo-size">{t.size}px</span>
                <span className="ds__typo-weight">w{t.weight}</span>
              </div>
              <div className="ds__typo-sample" style={{ fontSize: t.size, fontWeight: t.weight }}>
                {t.label}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── CANVAS SPACING (EDITABLE) ───────────────────────────────────── */}
      <Section title="Canvas Spacing" subtitle="Visual gap between stacked nodes">
        <div className="ds__canvas-spacing">
          <div className="ds__canvas-spacing-row">
            <div className="ds__canvas-spacing-info">
              <div className="ds__color-name">Vertical Node Gap</div>
              <div className="ds__color-desc">
                Visual gap (in pixels) between the <strong>bottom of one node</strong> and the
                <strong> top of the next</strong>. Independent of node height — tall Home nodes
                with many actions get the same visual gap as short nodes. Default 80.
              </div>
            </div>
            <div className="ds__canvas-spacing-controls">
              <SpacingNumberInput
                value={Number(tv('verticalNodeSpacing', 80))}
                onCommit={n => setThemeVal('verticalNodeSpacing', n)}
                min={20}
                max={300}
                step={5}
              />
              <span style={{ fontSize: 12, color: '#5a6a7e' }}>px</span>
              <button
                onClick={() => setThemeVal('verticalNodeSpacing', 80)}
                style={{
                  fontSize: 11, padding: '4px 10px', border: '1px solid #cbd5e1',
                  background: '#f8fafc', borderRadius: 4, cursor: 'pointer',
                }}
              >
                Reset to 80
              </button>
            </div>
          </div>
          <div className="ds__canvas-spacing-preview">
            {/* Visual preview: three stacked boxes with the chosen gap (scaled) */}
            {(() => {
              const px = Number(tv('verticalNodeSpacing', 80));
              const scale = 0.5;
              const gap = Math.max(4, Math.round(px * scale));
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap, alignItems: 'flex-start' }}>
                  {[
                    { label: 'Home (tall)', h: 60 },
                    { label: 'Step (short)', h: 28 },
                    { label: 'Step (short)', h: 28 },
                  ].map((b, i) => (
                    <div
                      key={i}
                      style={{
                        width: 120, height: b.h, borderRadius: 6,
                        background: '#fff', border: '2px solid #1574C4',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, color: '#1574C4', fontWeight: 600,
                      }}
                    >
                      {b.label}
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={{ fontSize: 11, color: '#8896a8', marginTop: 8 }}>
              Gap stays constant regardless of node height. Live: {Number(tv('verticalNodeSpacing', 80))}px
            </div>
          </div>
        </div>
      </Section>

      {/* ── SPACING & LAYOUT ────────────────────────────────────────────── */}
      <Section title="Spacing & Layout" subtitle="Dimensions, radii, shadows" defaultOpen={false}>
        <div className="ds__spacing-grid">
          <div className="ds__spacing-group">
            <div className="ds__spacing-group-title">Layout Dimensions</div>
            <div className="ds__spacing-item"><span>Toolbar Height</span><code>52px</code></div>
            <div className="ds__spacing-item"><span>Sidebar Width</span><code>220px</code></div>
            <div className="ds__spacing-item"><span>Properties Panel</span><code>280px</code></div>
            <div className="ds__spacing-item"><span>Node Width (State)</span><code>240–340px</code></div>
            <div className="ds__spacing-item"><span>Node Width (Decision)</span><code>240px</code></div>
          </div>
          <div className="ds__spacing-group">
            <div className="ds__spacing-group-title">Border Radius</div>
            <div className="ds__radius-gallery">
              {[{ r: 3, l: 'Small' }, { r: 6, l: 'Default (--radius)' }, { r: 10, l: 'Large (--radius-lg)' }, { r: 20, l: 'Pill' }].map(v => (
                <div key={v.r} className="ds__radius-chip">
                  <div style={{ width: 48, height: 32, borderRadius: v.r, border: '2px solid #1574C4', background: '#fff' }} />
                  <div style={{ fontSize: 10 }}>{v.r}px</div>
                  <div style={{ fontSize: 9, color: '#8896a8' }}>{v.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="ds__spacing-group">
            <div className="ds__spacing-group-title">Shadows</div>
            {[
              { label: 'Small', shadow: '0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)' },
              { label: 'Medium', shadow: '0 4px 6px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.05)' },
              { label: 'Large', shadow: '0 10px 24px rgba(0,0,0,.12)' },
            ].map(s => (
              <div key={s.label} className="ds__shadow-chip">
                <div style={{ width: 80, height: 40, borderRadius: 6, background: '#fff', boxShadow: s.shadow }} />
                <div style={{ fontSize: 10 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div className="ds__spacing-group">
            <div className="ds__spacing-group-title">Gap Scale</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {[2, 4, 6, 8, 10, 12, 16, 20].map(g => (
                <div key={g} style={{ textAlign: 'center' }}>
                  <div style={{ width: g, height: 24, background: '#1574C4', borderRadius: 1 }} />
                  <div style={{ fontSize: 9, color: '#8896a8', marginTop: 2 }}>{g}px</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
