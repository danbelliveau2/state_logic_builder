/**
 * IoMapView — Full-canvas I/O map view, alternative to the diagram.
 *
 * Reads `getProjectIoMap` (same data the L5X exporter emits and the header
 * popup uses), groups by SM with toggle for All / Inputs / Outputs.
 * Read-only — anything that needs to change is changed at the device.
 */

import { useMemo, useState } from 'react';
import { getProjectIoMap, IO_SECTION_ORDER, IO_SECTION_META } from '../lib/getProjectIoMap.js';

export function IoMapView({ project }) {
  const ioMap = useMemo(() => getProjectIoMap(project), [project]);
  const [grouping, setGrouping] = useState('bySm');
  const [search, setSearch] = useState('');

  const matches = (e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.tagName.toLowerCase().includes(q)
      || e.deviceName.toLowerCase().includes(q)
      || (e.description || '').toLowerCase().includes(q);
  };

  const renderRow = (e) => {
    const meta = IO_SECTION_META[e.section];
    return (
      <tr key={`${e.smId}-${e.tagName}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 3,
            background: meta.color, color: '#fff', fontSize: 9, fontWeight: 700,
            letterSpacing: '0.03em',
          }}>{meta.abbr}</span>
        </td>
        <td style={{ padding: '4px 12px', fontFamily: 'Consolas, monospace', fontSize: 12, color: '#0f172a', fontWeight: 500 }}>
          {e.tagName}
        </td>
        <td style={{ padding: '4px 8px', fontSize: 11, color: '#64748b' }}>
          {e.dataType}
        </td>
        <td style={{ padding: '4px 8px', fontSize: 11, color: '#475569' }}>
          {e.station}
        </td>
        <td style={{ padding: '4px 8px', fontSize: 11, color: '#475569' }}>
          {e.deviceName}
        </td>
        <td style={{ padding: '4px 8px', fontSize: 11, color: '#94a3b8' }}>
          {e.description}
        </td>
      </tr>
    );
  };

  const renderTable = (rows) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
      <thead>
        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
          <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em' }}>TYPE</th>
          <th style={{ padding: '6px 12px', textAlign: 'left',   fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em' }}>TAG</th>
          <th style={{ padding: '6px 8px', textAlign: 'left',    fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em' }}>DATA TYPE</th>
          <th style={{ padding: '6px 8px', textAlign: 'left',    fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em' }}>STATION</th>
          <th style={{ padding: '6px 8px', textAlign: 'left',    fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em' }}>DEVICE</th>
          <th style={{ padding: '6px 8px', textAlign: 'left',    fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em' }}>DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(renderRow)}
      </tbody>
    </table>
  );

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#fff',
      overflow: 'auto',
      padding: '0 0 24px 0',
      zIndex: 5,
    }}>
      {/* Sticky header — toggle + search */}
      <div style={{
        position: 'sticky', top: 0,
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: 12,
        zIndex: 10,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>I/O Map</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {ioMap.flat.length} tags · auto-derived from devices used in state machines · matches L5X output
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[
            { key: 'bySm',    label: 'By SM' },
            { key: 'inputs',  label: 'Inputs' },
            { key: 'outputs', label: 'Outputs' },
            { key: 'all',     label: 'All' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setGrouping(t.key)}
              style={{
                padding: '4px 10px',
                fontSize: 11, fontWeight: 700,
                background: grouping === t.key ? '#0072B5' : '#f1f5f9',
                color: grouping === t.key ? '#fff' : '#475569',
                border: '1px solid ' + (grouping === t.key ? '#0072B5' : '#cbd5e1'),
                borderRadius: 4, cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search tag, device, description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: 220,
            fontSize: 12, padding: '4px 8px',
            border: '1px solid #cbd5e1', borderRadius: 4,
          }}
        />
      </div>

      {/* Body */}
      <div style={{ padding: '12px 24px' }}>
        {ioMap.flat.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
            No devices yet. Add devices in any state machine to populate the I/O map.
          </div>
        )}

        {grouping === 'bySm' && ioMap.bySm.map(sm => {
          const all = IO_SECTION_ORDER.flatMap(k => sm.sections[k] ?? []).filter(matches);
          if (all.length === 0) return null;
          return (
            <div key={sm.smId} style={{ marginBottom: 24 }}>
              <div style={{
                padding: '6px 0',
                fontSize: 13, fontWeight: 700, color: '#0f172a',
                borderBottom: '2px solid #0072B5',
                marginBottom: 4,
              }}>
                {sm.station} — {sm.smName}
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: '#64748b' }}>
                  ({all.length} tags)
                </span>
              </div>
              {renderTable(all)}
            </div>
          );
        })}
        {grouping === 'inputs'  && renderTable([
          ...ioMap.bySection.digitalInput,
          ...ioMap.bySection.analogInput,
        ].filter(matches))}
        {grouping === 'outputs' && renderTable([
          ...ioMap.bySection.digitalOutput,
          ...ioMap.bySection.analogOutput,
        ].filter(matches))}
        {grouping === 'all'     && renderTable(ioMap.flat.filter(matches))}
      </div>
    </div>
  );
}
