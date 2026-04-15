/**
 * PartTrackingPanel.jsx — Collapsed pill + portaled expandable table.
 *
 * Rendered inside HomeConfigPills on the home node (right under the Start
 * Conditions pills). Collapsed = pill button matching Start Conditions style.
 * Expanded = portaled floating card with the full table.
 *
 * Rows are auto-derived from SUBJECTS (devices), not decision nodes:
 *   - Cycle Complete (overall StationResult)
 *   - Vision Inspect actions (BOOL result + one REAL row per numeric data output)
 *   - Analog sensor Check Range actions (BOOL per setpoint)
 * and may be appended with user-added custom rows. Rows sort by state number.
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { derivePartTrackingTable } from '../lib/partTracking.js';
import { computeStateNumbers } from '../lib/computeStateNumbers.js';

// ── Collapsed pill button ──────────────────────────────────────────────

export function PartTrackingPill({ sm }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const btnRef = useRef(null);

  const rows = useMemo(() => {
    if (!sm) return [];
    const { stateMap } = computeStateNumbers(sm.nodes ?? [], sm.edges ?? [], sm.devices ?? []);
    return derivePartTrackingTable(sm, stateMap);
  }, [sm]);

  const enabledCount = rows.filter(r => r.enabled).length;

  function handleClick(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    setOpen(v => !v);
  }

  return (
    <>
      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <button
          ref={btnRef}
          onClick={handleClick}
          title="Part Tracking writes for this state machine"
          style={{
            fontSize: 14,
            fontWeight: 700,
            padding: '6px 16px',
            borderRadius: 999,
            border: '2px solid #6366f1',
            background: '#eef2ff',
            color: '#4338ca',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            lineHeight: 1.2,
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>Part Tracking</span>
          <span style={{
            background: '#4338ca',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: 999,
            minWidth: 18,
            textAlign: 'center',
          }}>{enabledCount}</span>
          <span style={{ fontSize: 11 }}>▾</span>
        </button>
      </div>
      {open && menuPos && createPortal(
        <PtTableOverlay
          sm={sm}
          rows={rows}
          anchor={menuPos}
          onClose={() => setOpen(false)}
        />,
        document.body
      )}
    </>
  );
}

// ── Expanded overlay table (portaled) ──────────────────────────────────

function PtTableOverlay({ sm, rows, anchor, onClose }) {
  const ref = useRef(null);
  const togglePt = useDiagramStore(s => s.togglePartTrackingRow);
  const setSelectedNode = useDiagramStore(s => s.setSelectedNode);
  const addCustomRow = useDiagramStore(s => s.addPartTrackingCustomRow);
  const updateCustomRow = useDiagramStore(s => s.updatePartTrackingCustomRow);
  const deleteCustomRow = useDiagramStore(s => s.deletePartTrackingCustomRow);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    // Slight delay so the opening click doesn't immediately close
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc, true);
    };
  }, [onClose]);

  // Available target state nodes for the "Set At State" picker
  const stateChoices = useMemo(() => {
    const { stateMap } = computeStateNumbers(sm.nodes ?? [], sm.edges ?? [], sm.devices ?? []);
    return (sm.nodes ?? [])
      .filter(n => n.type === 'stateNode')
      .map(n => ({
        nodeId: n.id,
        state: stateMap.get(n.id),
        label: n.data?.label ?? (n.data?.isComplete ? 'Cycle Complete' : n.data?.isInitial ? 'Home' : 'State'),
      }))
      .filter(c => c.state != null)
      .sort((a, b) => a.state - b.state);
  }, [sm]);

  return (
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: anchor.top,
        left: anchor.left,
        transform: 'translateX(-50%)',
        minWidth: 520,
        maxWidth: 640,
        maxHeight: '70vh',
        overflowY: 'auto',
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
        zIndex: 100000,
        fontSize: 12,
      }}
    >
      <div style={{
        padding: '8px 12px',
        background: '#6366f1',
        color: '#fff',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span>Part Tracking</span>
        <span style={{ flex: 1, fontWeight: 400, opacity: 0.85 }}>
          — auto-writes for <b style={{ fontFamily: 'ui-monospace, monospace' }}>
            S{String(sm.stationNumber ?? 0).padStart(2, '0')}_{sm.name}
          </b>
        </span>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', padding: 0 }}
          title="Close"
        >
          ×
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
            <th style={thStyle}></th>
            <th style={{ ...thStyle, textAlign: 'center', width: 50 }}>State</th>
            <th style={thStyle}>Subject</th>
            <th style={thStyle}>Field</th>
            <th style={{ ...thStyle, textAlign: 'center', width: 110 }}>Value</th>
            <th style={{ ...thStyle, width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: 16, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center' }}>
                No PT writes yet. Add decision nodes, a Cycle Complete, or a custom row below.
              </td>
            </tr>
          ) : rows.map(row => (
            <PtRow
              key={row.id}
              row={row}
              stateChoices={stateChoices}
              onToggle={() => togglePt(sm.id, row.fieldName, !row.enabled)}
              onJumpToState={() => row.setAtNodeId && setSelectedNode(row.setAtNodeId)}
              onEditCustom={(updates) => updateCustomRow(sm.id, row.id, updates)}
              onDeleteCustom={() => deleteCustomRow(sm.id, row.id)}
            />
          ))}
        </tbody>
      </table>

      {/* Add custom row footer */}
      <div style={{
        padding: '8px 12px',
        background: '#f8fafc',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <button
          onClick={() => addCustomRow(sm.id, { fieldName: `Custom_${(sm.partTrackingOverrides?.customRows?.length ?? 0) + 1}` })}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            border: '1px dashed #94a3b8',
            borderRadius: 6,
            background: '#fff',
            color: '#475569',
            cursor: 'pointer',
          }}
          title="Add a manual PT row"
        >
          + Add custom row
        </button>
        <span style={{ fontSize: 10, color: '#94a3b8', flex: 1 }}>
          Auto rows come from vision results, vision data outputs, probe range checks, and Cycle Complete. Uncheck to skip.
        </span>
      </div>
    </div>
  );
}

const thStyle = {
  padding: '6px 10px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#475569',
  textAlign: 'left',
};

const tdStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'middle',
};

// ── Single row ─────────────────────────────────────────────────────────

function PtRow({ row, stateChoices, onToggle, onJumpToState, onEditCustom, onDeleteCustom }) {
  const disabled = !row.enabled;
  const isNumeric = row.dataType === 'real';
  const valueColor =
    row.writeValue === 'TRUE' ? '#059669' :
    row.writeValue === 'FALSE' ? '#dc2626' :
    isNumeric ? '#0891b2' :
    '#6366f1';
  const isCustom = row.kind === 'custom';
  const isStationResult = row.kind === 'stationResult';
  const [editingName, setEditingName] = useState(false);

  return (
    <tr style={{ opacity: disabled ? 0.45 : 1, background: isCustom ? '#fefce8' : 'transparent' }}>
      {/* Checkbox */}
      <td style={{ ...tdStyle, width: 28 }}>
        <input
          type="checkbox"
          checked={row.enabled}
          onChange={onToggle}
          title={row.enabled ? 'Enabled' : 'Disabled — skipped in L5X'}
          style={{ cursor: 'pointer' }}
        />
      </td>

      {/* State number pill — click to jump */}
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        {isCustom ? (
          <select
            value={row.setAtNodeId ?? ''}
            onChange={e => onEditCustom({ setAtNodeId: e.target.value || null })}
            style={{ fontSize: 10, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            <option value="">—</option>
            {stateChoices.map(c => (
              <option key={c.nodeId} value={c.nodeId}>{c.state}: {c.label}</option>
            ))}
          </select>
        ) : row.setAtState != null ? (
          <button
            onClick={onJumpToState}
            style={{
              minWidth: 26,
              padding: '2px 8px',
              borderRadius: 10,
              background: '#e0e7ff',
              color: '#3730a3',
              fontWeight: 700,
              fontSize: 11,
              border: 'none',
              cursor: 'pointer',
            }}
            title="Jump to this node on the canvas"
          >
            {row.setAtState}
          </button>
        ) : (
          <span style={{ color: '#cbd5e1' }}>—</span>
        )}
      </td>

      {/* Subject: name (big), type (small gray) */}
      <td style={tdStyle}>
        <div style={{ fontWeight: 600, color: '#334155', fontSize: 11 }}>
          {row.subjectName}
        </div>
        {row.subjectType && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
            {row.subjectType}
          </div>
        )}
      </td>

      {/* Field name */}
      <td style={tdStyle}>
        {isCustom && editingName ? (
          <input
            autoFocus
            defaultValue={row.fieldName}
            onBlur={e => { onEditCustom({ fieldName: e.target.value }); setEditingName(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onEditCustom({ fieldName: e.currentTarget.value }); setEditingName(false); }
              if (e.key === 'Escape') setEditingName(false);
            }}
            style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', padding: '2px 4px', border: '1px solid #6366f1', borderRadius: 4, width: '100%' }}
          />
        ) : (
          <>
            <div
              style={{
                fontWeight: 700,
                color: '#1e293b',
                fontSize: 12,
                fontFamily: 'ui-monospace, monospace',
                textDecoration: disabled ? 'line-through' : 'none',
                cursor: isCustom ? 'text' : 'default',
              }}
              onClick={() => isCustom && setEditingName(true)}
              title={isCustom ? 'Click to rename' : (row._sourceTag ?? row.fieldName)}
            >
              {row.fieldName}
            </div>
            {isNumeric && row._sourceTag && (
              <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>
                ← {row._sourceTag}
              </div>
            )}
          </>
        )}
      </td>

      {/* Value */}
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        {isCustom ? (
          <select
            value={row.writeValue}
            onChange={e => onEditCustom({ writeValue: e.target.value })}
            style={{ fontSize: 10, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            <option value="Success / Reject">Success / Reject</option>
            <option value="TRUE">TRUE (always)</option>
            <option value="FALSE">FALSE (always)</option>
          </select>
        ) : (
          <span style={{
            fontSize: 10,
            color: valueColor,
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}>
            {row.writeValue}
          </span>
        )}
      </td>

      {/* Delete (custom only) */}
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        {isCustom && (
          <button
            onClick={onDeleteCustom}
            style={{
              background: 'transparent', border: 'none', color: '#dc2626',
              cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
            }}
            title="Delete custom row"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}
