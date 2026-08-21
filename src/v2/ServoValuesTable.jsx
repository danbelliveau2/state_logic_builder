/**
 * ServoValuesTable — the station-level SERVO VALUES table (Dan: "if there's
 * servo motors, there should be a table of servo values somewhere in the
 * builder that you can just go edit — and the tool will call that").
 *
 * One editable grid per station: Axis | Position name | Value (inline) |
 * Role tag (auto-inferred: home/pick/place/transition/safe-clear). A
 * "+ add named value" row per axis makes values like SafeClear/BlendStart
 * first-class named positions on the axis — not floating questions.
 *
 * Edits persist through the store's updateDevice (history push → undoable);
 * empty values render amber and count as the readiness gaps the Code grid's
 * status column shows. The IR serializes device.positions via the device
 * `extras` passthrough (ir.js), so compile/generate pick up new values with
 * no further wiring — the tool genuinely calls this table.
 *
 * Gated on useV2Shell.servoTableFor (smId). Opened from: the Code grid's
 * "⚠ Servo positions needed" warning, the stations tree, and the flow bar's
 * compile-stage hint.
 */

import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { inferPositionRole, positionValueMissing } from './servoValues.js';

const ROLE_COLORS = {
  home:        { bg: '#e8f0fa', fg: '#1574C4' },
  pick:        { bg: '#e6f4ea', fg: '#3d7a2f' },
  place:       { bg: '#e6f4ea', fg: '#3d7a2f' },
  transition:  { bg: '#f3e8fa', fg: '#7a3da8' },
  'safe-clear':{ bg: '#fdf6e3', fg: '#7a6220' },
};

function RoleTag({ pos }) {
  const role = inferPositionRole(pos);
  if (!role) return null;
  const c = ROLE_COLORS[role] ?? { bg: '#eef1f5', fg: '#5a6a7e' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      background: c.bg, color: c.fg, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap',
    }}>{role}</span>
  );
}

/** One editable value cell — commits on blur/Enter; '' stays a genuine gap. */
function ValueCell({ value, onCommit, testId }) {
  const [draft, setDraft] = useState(value ?? '');
  const missing = draft === '' || draft === null || draft === undefined;
  function commit() {
    const trimmed = String(draft).trim();
    if (trimmed === '') { onCommit(null); return; }
    const n = Number(trimmed);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(value ?? ''); // reject non-numeric, restore
  }
  return (
    <input
      data-testid={testId}
      value={draft}
      inputMode="decimal"
      placeholder="—"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{
        width: 90, boxSizing: 'border-box', fontSize: 13, padding: '5px 8px',
        border: `1px solid ${missing ? '#c9a643' : 'var(--color-border)'}`,
        background: missing ? '#fdf6e3' : 'var(--color-surface)',
        borderRadius: 6, color: 'var(--color-text)', textAlign: 'right',
        fontFamily: 'Consolas, monospace',
      }}
      title={missing ? 'Missing — the mechanical team fills this in (counts as a readiness gap)' : ''}
    />
  );
}

function AxisSection({ smId, device }) {
  const updateDevice = useDiagramStore(s => s.updateDevice);
  const positions = device.positions ?? [];
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  function commitPosition(idx, newVal) {
    const next = positions.map((p, i) => (i === idx ? { ...p, defaultValue: newVal } : p));
    updateDevice(smId, device.id, { positions: next });
  }

  function addNamed() {
    const name = newName.trim().replace(/\s+/g, '_');
    if (!name) return;
    const val = String(newValue).trim();
    const n = Number(val);
    const entry = {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'pos_' + Date.now().toString(36)),
      name,
      defaultValue: val !== '' && Number.isFinite(n) ? n : null,
      moveType: 'Pos', type: 'position', isHome: false, isRecipe: false,
    };
    updateDevice(smId, device.id, { positions: [...positions, entry] });
    setNewName(''); setNewValue('');
  }

  const gapCount = positions.filter(positionValueMissing).length;

  return (
    <div style={{ marginBottom: 18 }} data-testid={`servo-axis-${device.name}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
          {device.displayName || device.name}
        </div>
        {positions.length === 0 && (
          <span style={{ fontSize: 11, color: '#7a6220', background: '#fdf6e3', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>
            no positions defined yet
          </span>
        )}
        {gapCount > 0 && (
          <span style={{ fontSize: 11, color: '#7a6220', fontWeight: 600 }}>
            {gapCount} value{gapCount === 1 ? '' : 's'} missing
          </span>
        )}
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {positions.map((p, i) => (
            <tr key={p.id || `${p.name}-${i}`}>
              <td style={{ padding: '4px 10px 4px 0', fontSize: 13, color: 'var(--color-text)', width: '40%' }}>
                {p.name}
                {p.moveType && p.moveType !== 'Pos' && (
                  <span style={{ fontSize: 10, color: 'var(--color-text-light)', marginLeft: 6 }}>({p.moveType})</span>
                )}
              </td>
              <td style={{ padding: '4px 10px 4px 0' }}>
                <ValueCell
                  value={p.defaultValue}
                  testId={`servo-value-${device.name}-${p.name}`}
                  onCommit={(v) => commitPosition(i, v)}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-light)', marginLeft: 5 }}>mm</span>
              </td>
              <td style={{ padding: '4px 0' }}><RoleTag pos={p} /></td>
            </tr>
          ))}
          {/* + add named value — SafeClear / BlendStart etc. become first-class positions */}
          <tr>
            <td style={{ padding: '6px 10px 2px 0' }}>
              <input
                data-testid={`servo-add-name-${device.name}`}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="+ add named value (e.g. BlendStart)"
                onKeyDown={e => { if (e.key === 'Enter') addNamed(); }}
                style={{
                  width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 8px',
                  border: '1px dashed var(--color-border)', borderRadius: 6,
                  background: 'transparent', color: 'var(--color-text)',
                }}
              />
            </td>
            <td style={{ padding: '6px 10px 2px 0' }}>
              <input
                data-testid={`servo-add-value-${device.name}`}
                value={newValue}
                inputMode="decimal"
                onChange={e => setNewValue(e.target.value)}
                placeholder="—"
                onKeyDown={e => { if (e.key === 'Enter') addNamed(); }}
                style={{
                  width: 90, boxSizing: 'border-box', fontSize: 12, padding: '5px 8px',
                  border: '1px dashed var(--color-border)', borderRadius: 6,
                  background: 'transparent', textAlign: 'right', fontFamily: 'Consolas, monospace',
                }}
              />
            </td>
            <td style={{ padding: '6px 0 2px' }}>
              <button
                data-testid={`servo-add-btn-${device.name}`}
                disabled={!newName.trim()}
                onClick={addNamed}
                style={{
                  background: newName.trim() ? 'var(--color-primary)' : 'var(--color-border)',
                  color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px',
                  fontSize: 11, fontWeight: 700, cursor: newName.trim() ? 'pointer' : 'default',
                }}
              >Add</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ServoValuesTable() {
  const smId = useV2Shell(s => s.servoTableFor);
  const closeServoTable = useV2Shell(s => s.closeServoTable);
  const sm = useDiagramStore(s => (s.project?.stateMachines ?? []).find(m => m.id === smId));
  if (!smId || !sm) return null;

  const axes = (sm.devices ?? []).filter(d => d.type === 'ServoAxis');

  return (
    <div
      data-testid="servo-values-table"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeServoTable(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1300, background: '#00000080',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: 'var(--color-bg)', borderRadius: 10, width: 640, maxWidth: '92vw',
        maxHeight: '84vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
          borderBottom: '1px solid var(--color-border)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
              Servo values — {sm.displayName || sm.name}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-light)', marginTop: 2 }}>
              The mechanical team's position table. Compile and Generate read these values directly;
              empty cells show as readiness gaps in the Code grid.
            </div>
          </div>
          <button
            data-testid="servo-table-close"
            onClick={closeServoTable}
            style={{
              marginLeft: 'auto', background: 'none', border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)', borderRadius: 6, padding: '5px 12px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >Close</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 18px' }}>
          {axes.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--color-text-light)' }}>
              This station has no servo axes.
            </div>
          )}
          {axes.map(d => <AxisSection key={d.id} smId={sm.id} device={d} />)}
        </div>
      </div>
    </div>
  );
}
