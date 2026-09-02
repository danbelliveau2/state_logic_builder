/**
 * ServoValuesTable — the station-level SERVO VALUES table (Dan: "if there's
 * servo motors, there should be a table of servo values somewhere in the
 * builder that you can just go edit — and the tool will call that").
 *
 * One editable grid per station: Axis | Position name | Value (inline). A
 * "+ add named value" row per axis makes values like SafeClear/BlendStart
 * first-class named positions on the axis — not floating questions.
 * NO role tags on rows (Dan, Aug 24: "we know what the points are, we're
 * the ones that told you") — only proposed/needed STATE indicators remain.
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

import { Fragment, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { positionValueMissing } from './servoValues.js';
import { mapVerifyFlagsToServoRows, requiredServoRowsOf, bandRowLabel, plainServoRowLabel, isSpeedWindowName, orderServoDisplayRows, groupServoRows } from '../lib/servoBands.js';
import { axisGeometryIssues } from '../lib/geometrySanity.js';

const geomKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** One editable value cell — commits on blur/Enter; '' stays a genuine gap.
 *  Exported for reuse by the Create Station data sheet (draft servo table). */
export function ValueCell({ value, onCommit, testId, missingTone = 'amber' }) {
  const [draft, setDraft] = useState(value ?? '');
  const missing = draft === '' || draft === null || draft === undefined;
  // 'amber' = proposed/soft gap; 'required' = truly-needed value, RED and
  // unmistakable (Dan, Aug 24 — never confusable with role tags).
  const tone = missingTone === 'required'
    ? { border: '#fca5a5', bg: '#fef2f2' }
    : { border: '#c9a643', bg: '#fdf6e3' };
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
        border: `1px solid ${missing ? tone.border : 'var(--color-border)'}`,
        background: missing ? tone.bg : 'var(--color-surface)',
        borderRadius: 6, color: 'var(--color-text)', textAlign: 'right',
        fontFamily: 'Consolas, monospace',
      }}
      title={missing ? 'Missing — the mechanical team fills this in (counts as a readiness gap)' : ''}
    />
  );
}

/** One RED proposed-value row — a compiled *Verify band flag mapped onto this
 *  axis (Dan, Aug 23): SDC Engineer pre-fills an intelligent proposal from the axis
 *  geometry. Accepting = doing nothing; editing = typing. The red clears once
 *  the value is applied (Apply proposed values → re-compile). */
function ProposedRow({ row, draft, onDraft, unit = 'mm' }) {
  // Band rows arrive with a proposal; required-position rows (the compiled
  // code moves to a position the table doesn't have) arrive EMPTY — a genuine
  // blocker question until the ME types the value from the model.
  const hasProposal = row.proposedValue != null;
  const shown = draft !== undefined && draft !== ''
    ? draft
    : hasProposal ? String(row.proposedValue) : '';
  return (
    <>
      <tr data-testid={`servo-proposed-${row.deviceName}-${row.rowName}`}>
        {/* Plain-English label (Dan, Aug 24: "wideband? I don't know what
            that means") — the SM keeps the PLC-safe rowName. The rationale
            lives in the tooltip (no explainer lines, Aug 24 round 2). */}
        <td style={{ padding: '6px 10px 0 0', fontSize: 13, color: '#991b1b', fontWeight: 600, whiteSpace: 'nowrap' }} title={row.rationale ?? row.question ?? row.flag ?? ''}>
          {bandRowLabel(row)}
        </td>
        <td style={{ padding: '6px 10px 0 0' }}>
          <input
            data-testid={`servo-proposed-input-${row.deviceName}-${row.rowName}`}
            value={shown}
            inputMode="decimal"
            placeholder="—"
            onChange={e => onDraft(e.target.value)}
            style={{
              width: 90, boxSizing: 'border-box', fontSize: 13, padding: '5px 8px',
              border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 6,
              color: '#991b1b', textAlign: 'right', fontFamily: 'Consolas, monospace', fontWeight: 700,
            }}
            title={row.rationale ?? row.flag ?? row.question ?? ''}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-light)', marginLeft: 5 }}>{unit}</span>
        </td>
        <td style={{ padding: '6px 0 0' }}>
          <span title={row.rationale ?? row.question ?? ''} style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            background: '#fee2e2', color: '#991b1b', borderRadius: 3, padding: '1px 8px', whiteSpace: 'nowrap',
          }}>{hasProposal ? 'proposed' : 'needed'}</span>
        </td>
      </tr>
    </>
  );
}

function AxisSection({ smId, device, proposals = [], proposalDrafts, onProposalDraft }) {
  const updateDevice = useDiagramStore(s => s.updateDevice);
  const positions = device.positions ?? [];
  // ROTARY / DIAL axes think in degrees, never mm (Dan's Magnet Dial round).
  const unit = String(device.motionType ?? '').toLowerCase() === 'rotary' ? '°' : 'mm';
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  // Named positions + corner blends as single-line peer rows. *WideBand rows
  // no longer exist (Dan, Aug 24 round 3: speed windows are dead — the corner
  // blends are the only windows; transitions take strict MAM.PC + InPos);
  // legacy ones in old data are simply not rendered.
  const indexed = positions.map((p, i) => ({ p, i }));
  const visibleRows = orderServoDisplayRows(
    indexed.filter(({ p }) => !isSpeedWindowName(p?.name)), (r) => r.p?.name);
  const peerProposals = proposals.filter(r => !isSpeedWindowName(r.rowName));

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

  // GEOMETRIC SANITY (Dan, Aug 24: "PlaceTransition 450 is beyond Place 300"):
  // arithmetic-impossible values flag RED on the offending row, plain sentence
  // right under it, and count as blockers in the spec sheet's red strip.
  const geomByRow = new Map(
    axisGeometryIssues(
      device.displayName || device.name,
      positions.map(p => ({ name: p?.name, value: p?.defaultValue })),
      { minMm: device.travelMinMm, maxMm: device.travelMaxMm }
    ).map(g => [geomKey(g.rowName), g])
  );

  // HOME (Dan, Aug 24) — the ME-declared rest position of this axis. Stored
  // as positions[].isHome (the 'dynamic' servo-home convention) plus
  // homePositionName; the compile IR renders it so Home Conditions / init /
  // recovery use the DECLARED home.
  const normHome = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const homeName = device.homePositionName ?? positions.find(p => p?.isHome)?.name ?? null;
  function commitHome(name) {
    if (!name) return;
    updateDevice(smId, device.id, {
      homePositionName: name,
      positions: positions.map(p => ({ ...p, isHome: normHome(p.name) === normHome(name) })),
    });
  }

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
          {positions.length > 0 && (
            <tr data-testid={`servo-home-row-${device.name}`}>
              <td style={{ padding: '4px 10px 6px 0', fontSize: 13, color: 'var(--color-text)', width: '40%' }}>
                Home position
              </td>
              <td colSpan={2} style={{ padding: '4px 0 6px' }}>
                <select
                  data-testid={`servo-home-${device.name}`}
                  value={homeName ?? ''}
                  onChange={e => commitHome(e.target.value)}
                  style={{
                    fontSize: 13, padding: '4px 6px', border: '1px solid var(--color-border)',
                    borderRadius: 6, background: 'var(--color-surface)', color: 'var(--color-text)',
                    maxWidth: 170,
                  }}
                >
                  {homeName == null && <option value="">—</option>}
                  {positions.filter(p => p?.name).map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          )}
          {(() => {
          // GROUPED ROWS (Dan, Aug 24 round 5): Positions / Speed
          // transitions / Blends — headers only when there's something to
          // separate.
          const GroupHead = ({ label }) => (
            <tr>
              <td colSpan={3} style={{ padding: '8px 0 1px', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-light)' }}>{label}</td>
            </tr>
          );
          const renderValueRow = ({ p, i }) => {
            const geo = geomByRow.get(geomKey(p.name));
            return (
            <Fragment key={p.id || `${p.name}-${i}`}>
            <tr>
              <td style={{ padding: '4px 10px 4px 0', fontSize: 13, color: geo ? '#991b1b' : 'var(--color-text)', fontWeight: geo ? 700 : 400, width: '40%', whiteSpace: 'nowrap' }} title={geo ? geo.message : (p.name !== plainServoRowLabel(p.name) ? p.name : undefined)}>
                {plainServoRowLabel(p.name)}
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
                <span style={{ fontSize: 11, color: 'var(--color-text-light)', marginLeft: 5 }}>{unit}</span>
              </td>
              <td style={{ padding: '4px 0' }}>
                {geo && (
                  <span data-testid={`servo-geom-${device.name}-${p.name}`} title={geo.message} style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    background: '#fee2e2', color: '#991b1b', borderRadius: 3, padding: '1px 8px', whiteSpace: 'nowrap',
                  }}>impossible</span>
                )}
              </td>
            </tr>
            {geo && (
              <tr data-testid={`servo-geom-msg-${device.name}-${p.name}`}>
                <td colSpan={3} style={{ padding: '0 0 5px', fontSize: 11.5, color: '#991b1b', fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.45 }}>
                  ⚠ {geo.message}
                </td>
              </tr>
            )}
            </Fragment>
            );
          };
          const groups = groupServoRows(visibleRows, (r) => r.p?.name);
          const hasBlendGroup = groups.some(g => g.key === 'blends');
          // RED proposed rows — compiled band flags mapped onto this axis;
          // they live in the Blends group.
          const proposalsJsx = peerProposals.map(row => (
            <ProposedRow
              key={row.rowName}
              row={row}
              draft={proposalDrafts?.[`${row.deviceId}:${row.rowName}`]}
              onDraft={v => onProposalDraft?.(`${row.deviceId}:${row.rowName}`, v)}
              unit={unit}
            />
          ));
          return (
            <Fragment>
              {groups.map(g => (
                <Fragment key={g.key}>
                  {g.label && <GroupHead label={g.label} />}
                  {g.rows.map(renderValueRow)}
                  {g.key === 'blends' && proposalsJsx}
                </Fragment>
              ))}
              {!hasBlendGroup && peerProposals.length > 0 && (
                <Fragment>
                  <GroupHead label="Blends" />
                  {proposalsJsx}
                </Fragment>
              )}
            </Fragment>
          );
          })()}
          {/* SPEED WINDOWS ARE DEAD (Dan, Aug 24 round 3) — no advanced
              section: transitions take strict MAM.PC + InPos; the only
              windows are the two corner blends above. */}
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
  const updateDevice = useDiagramStore(s => s.updateDevice);
  const sm = useDiagramStore(s => (s.project?.stateMachines ?? []).find(m => m.id === smId));
  const [proposalDrafts, setProposalDrafts] = useState({});
  if (!smId || !sm) return null;

  const axes = (sm.devices ?? []).filter(d => d.type === 'ServoAxis');

  // EVERY servo point the code uses must be a visible row (Dan, Aug 23):
  // compiled *Verify band flags AND the compiled sequence's own required
  // points (move targets + wideband blend anchors) → red rows. Unresolved
  // only: once applied they exist as real named positions and the red is gone.
  const flagRows = mapVerifyFlagsToServoRows(sm).filter(r => !r.unmapped && !r.resolved);
  const requiredRows = requiredServoRowsOf(sm);
  const seenRow = new Set(flagRows.map(r => `${r.deviceId}:${r.rowName.toLowerCase()}`));
  const proposals = [
    ...flagRows,
    ...requiredRows.filter(r => !seenRow.has(`${r.deviceId}:${r.rowName.toLowerCase()}`)),
  ];
  const proposalsByDevice = new Map();
  for (const r of proposals) {
    if (!proposalsByDevice.has(r.deviceId)) proposalsByDevice.set(r.deviceId, []);
    proposalsByDevice.get(r.deviceId).push(r);
  }

  /** Write every proposed value as a first-class named position on its axis.
   *  (The re-compile kick is gone with the compile modal — 2026-09-02; the
   *  station sheet's Build reads the device values directly.) */
  function applyProposals() {
    const applied = [];
    for (const [deviceId, rows] of proposalsByDevice) {
      const device = axes.find(d => d.id === deviceId);
      if (!device) continue;
      const additions = rows.map(r => {
        const draft = proposalDrafts[`${r.deviceId}:${r.rowName}`];
        const n = Number(String(draft ?? '').trim());
        const value = Number.isFinite(n) && String(draft ?? '').trim() !== '' ? n : r.proposedValue;
        // Required-position rows without a typed value stay open — there is
        // nothing safe to apply for them.
        if (value == null) return null;
        applied.push({ ...r, value });
        return {
          id: (crypto.randomUUID ? crypto.randomUUID() : 'pos_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          name: r.rowName,
          defaultValue: value,
          moveType: 'Pos', type: 'position', isHome: false, isRecipe: false,
        };
      }).filter(Boolean);
      if (additions.length) {
        updateDevice(sm.id, deviceId, { positions: [...(device.positions ?? []), ...additions] });
      }
    }
    if (applied.length === 0) return;
    setProposalDrafts({});
    closeServoTable();
  }

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
              The mechanical team's position table. The station build reads these values directly;
              empty cells show as open asks on the station sheet.
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
          {axes.map(d => (
            <AxisSection
              key={d.id}
              smId={sm.id}
              device={d}
              proposals={proposalsByDevice.get(d.id) ?? []}
              proposalDrafts={proposalDrafts}
              onProposalDraft={(k, v) => setProposalDrafts(o => ({ ...o, [k]: v }))}
            />
          ))}
        </div>
        {proposals.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
            borderTop: '1px solid var(--color-border)', flexShrink: 0,
          }}>
            <span style={{ flex: 1, fontSize: 11, color: '#991b1b' }}>
              {proposals.length} red row{proposals.length === 1 ? '' : 's'} the code needs — the proposed values stand unless
              you change them; empty ones need the model's value.
            </span>
            <button
              type="button"
              data-testid="servo-apply-proposed-btn"
              onClick={applyProposals}
              style={{
                background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 700, padding: '6px 16px', cursor: 'pointer',
              }}
            >Apply values</button>
          </div>
        )}
      </div>
    </div>
  );
}
