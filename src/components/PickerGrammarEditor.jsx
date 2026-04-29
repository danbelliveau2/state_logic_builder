/**
 * PickerGrammarEditor — Editable grammar table for the universal picker.
 *
 * Lives in Project Setup (Setup tab → "Picker Grammar"). Displays the
 * pickerGrammar.js table as an editable grid. Changes save automatically
 * to localStorage under `sdc.pickerGrammar.v1`. The InlinePicker and
 * DecisionEditPopup read this same data so the grammar stays consistent.
 *
 * Features:
 *  - Click any cell to edit it
 *  - Add a new row via the "+ Add row" button at the bottom
 *  - Remove a row via the trash icon in the leftmost column
 *  - Reset to shipped defaults via "Reset to Defaults"
 *  - Export to CSV for offline editing or sharing
 *
 * The row schema and column metadata both come from `lib/pickerGrammar.js`.
 */

import { useState, useEffect, useRef, Fragment } from 'react';
import {
  DEFAULT_GRAMMAR,
  GRAMMAR_COLUMNS,
  GRAMMAR_CATEGORIES,
  loadGrammar,
  saveGrammar,
  resetGrammar,
} from '../lib/pickerGrammar.js';

export function PickerGrammarEditor() {
  const [rows, setRows] = useState(() => loadGrammar());
  const [editing, setEditing] = useState(null); // { rowId, key } | null
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  // ── Click-and-drag panning ───────────────────────────────────────────────
  // The grammar table is wider than most viewports. Rather than force the
  // user to reach for a scrollbar (which on a long table requires scrolling
  // vertically to even reach), we let them grab any empty cell area and drag
  // to pan in either direction. Excel-grid feel.
  //
  // Skip-targets: anything that's already an interactive element (button,
  // input, textarea, the pill body, the +add button, the row × button).
  // Otherwise typing into a cell would trigger a drag mid-edit.
  const scrollRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, scrollLeft, scrollTop }
  const [isDragging, setIsDragging] = useState(false);

  const isDragSkipTarget = (el) => {
    if (!el) return true;
    return !!el.closest('button, input, textarea, [contenteditable="true"]');
  };

  const onScrollMouseDown = (e) => {
    if (e.button !== 0) return;            // left button only
    if (isDragSkipTarget(e.target)) return; // don't hijack interactive clicks
    const c = scrollRef.current;
    if (!c) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: c.scrollLeft,
      scrollTop: c.scrollTop,
    };
    setIsDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const c = scrollRef.current;
      const d = dragRef.current;
      if (!c || !d) return;
      c.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
      c.scrollTop = d.scrollTop - (e.clientY - d.startY);
    };
    const onUp = () => {
      dragRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // Auto-save on every change
  useEffect(() => {
    saveGrammar(rows);
  }, [rows]);

  // Auto-focus + select the editor input when it mounts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (typeof inputRef.current.select === 'function') {
        inputRef.current.select();
      }
    }
  }, [editing]);

  function startEdit(rowId, key, currentValue) {
    setEditing({ rowId, key });
    setDraft(currentValue ?? '');
  }

  function commitEdit() {
    if (!editing) return;
    setRows(prev => prev.map(r =>
      r.id === editing.rowId ? { ...r, [editing.key]: draft } : r
    ));
    setEditing(null);
    setDraft('');
  }

  // Pill-cell mutator. Updates a single field on a row without going through
  // the single-input editor flow. Used by <PillCell> for its own add/delete/
  // inline-edit interactions so each pill is independent.
  function updateCell(rowId, key, nextValue) {
    setRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, [key]: nextValue } : r
    ));
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }

  function handleKeyDown(e, multiline) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && (!multiline || (e.ctrlKey || e.metaKey))) {
      // Enter commits for single-line; Ctrl/Cmd+Enter commits for multiline.
      e.preventDefault();
      commitEdit();
    }
  }

  function addRow(categoryId = 'misc') {
    const newId = `row_${Date.now().toString(36)}`;
    const blank = { id: newId, category: categoryId };
    GRAMMAR_COLUMNS.forEach(c => {
      blank[c.key] = '';
    });
    setRows(prev => [...prev, blank]);
    // If the section is collapsed, expand it so the new row is visible
    setCollapsedCategories(s => ({ ...s, [categoryId]: false }));
    // Immediately open the family cell for editing
    setTimeout(() => startEdit(newId, 'family', ''), 50);
  }

  // ── Section collapse state ───────────────────────────────────────────────
  // Each category renders as its own collapsible group. Default: all expanded.
  // Click the section header chevron to collapse/expand. Each section has its
  // own "+ Add row" button; bottom-of-page "Add row" still works (defaults to
  // Misc).
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const toggleCategory = (catId) => {
    setCollapsedCategories(s => ({ ...s, [catId]: !s[catId] }));
  };

  function removeRow(id) {
    if (!confirm('Remove this row?')) return;
    setRows(prev => prev.filter(r => r.id !== id));
  }

  function handleReset() {
    if (!confirm('Reset to shipped defaults? This wipes all your edits.')) return;
    resetGrammar();
    setRows(DEFAULT_GRAMMAR.map(r => ({ ...r })));
  }

  function exportCsv() {
    // One CSV column per grammar field. v5 schema: id, category, family,
    // subject, detail, actions, inputs, notes.
    const headers = ['id', 'category', ...GRAMMAR_COLUMNS.map(c => c.key)];
    const escape = (v) => {
      const s = String(v ?? '');
      // Quote if contains comma, quote, or newline; escape internal quotes
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PickerGrammar.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div style={{ padding: '16px 20px', maxWidth: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
          Picker Grammar
        </h2>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Auto-saved to localStorage. Drives both InlinePicker and DecisionEditPopup.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={exportCsv} style={btnStyle('default')}>⤓ Export CSV</button>
          <button onClick={handleReset} style={btnStyle('warn')}>↺ Reset to Defaults</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#475569', marginBottom: 8, lineHeight: 1.5 }}>
        One row per subject family. The picker has two top-level modes:
        <strong> Action</strong> (the node fires something) and
        <strong> Decision</strong> (the node observes an input — sub-actions
        <em> Wait / Check / Branch</em>). <strong>ACTIONS</strong> lists the
        fire-actions a subject offers in Action mode (Extend, Move Absolute,
        Trigger, …). <strong>INPUTS</strong> lists the states a subject can be
        observed in for Decision mode (Extended, On, Pass, …); Wait / Check /
        Branch all read from this same list. Empty ACTIONS = subject is
        read-only (sensors, signals — Action mode unavailable). Empty INPUTS =
        Decision mode unavailable (rare). <strong>SUBJECT</strong> is what the
        leftmost picker pill displays; <strong>DETAIL</strong> is a pill list
        of categories the DETAIL pill draws from in Action mode (empty =
        hide DETAIL). Click a section header to collapse.
        <strong> Click + drag</strong> any empty cell area to pan. Enter
        commits a text edit; Escape cancels.
      </div>

      <div
        ref={scrollRef}
        onMouseDown={onScrollMouseDown}
        style={{
          border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'auto',
          background: '#fff', maxHeight: 'calc(100vh - 200px)',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: isDragging ? 'none' : 'auto',
        }}
      >
        <table style={{
          borderCollapse: 'collapse', fontSize: 12, width: '100%',
          tableLayout: 'fixed',
        }}>
          <colgroup>
            <col style={{ width: 32 }} />
            {GRAMMAR_COLUMNS.map(c => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
              <th style={hdrStyle}></th>
              {GRAMMAR_COLUMNS.map(c => (
                <th key={c.key} style={hdrStyle}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRAMMAR_CATEGORIES.map(cat => {
              const catRows = rows.filter(r => (r.category || 'misc') === cat.id);
              const collapsed = !!collapsedCategories[cat.id];
              const totalCols = GRAMMAR_COLUMNS.length + 1; // +1 for the leftmost × column
              return (
                <Fragment key={cat.id}>
                  <tr
                    style={{
                      background: cat.color,
                      color: '#fff',
                      borderBottom: '1px solid rgba(255,255,255,0.25)',
                      position: 'sticky',
                      // Sticks just below the column-header row (which is also sticky).
                      top: 26,
                      zIndex: 1,
                    }}
                  >
                    <td colSpan={totalCols} style={{ padding: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 10px',
                      }}>
                        <button
                          onClick={() => toggleCategory(cat.id)}
                          title={collapsed ? 'Expand section' : 'Collapse section'}
                          style={sectionToggleStyle}
                        >
                          {collapsed ? '▶' : '▼'}
                        </button>
                        <span style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}>
                          {cat.label}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          background: 'rgba(255,255,255,0.22)',
                          padding: '1px 6px', borderRadius: 8,
                        }}>
                          {catRows.length} {catRows.length === 1 ? 'row' : 'rows'}
                        </span>
                        <button
                          onClick={() => addRow(cat.id)}
                          title={`Add a new row in ${cat.label}`}
                          style={sectionAddStyle}
                        >+ Add row</button>
                      </div>
                    </td>
                  </tr>
                  {!collapsed && catRows.length === 0 && (
                    <tr>
                      <td colSpan={totalCols} style={{
                        padding: '6px 14px', fontSize: 11, fontStyle: 'italic',
                        color: '#94a3b8', background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                      }}>
                        No rows in this section yet — click <strong>+ Add row</strong> above.
                      </td>
                    </tr>
                  )}
                  {!collapsed && catRows.map((row, idx) => (
                    <tr key={row.id} style={{
                      background: idx % 2 === 0 ? '#fff' : '#fafbfc',
                      borderBottom: '1px solid #e2e8f0',
                    }}>
                      <td style={{ ...cellStyle, textAlign: 'center', padding: 0 }}>
                        <button
                          onClick={() => removeRow(row.id)}
                          title="Remove row"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#94a3b8', fontSize: 14, padding: 4,
                            width: '100%', height: '100%',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                          onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                        >×</button>
                      </td>
                      {GRAMMAR_COLUMNS.map(col => {
                        const isEditing = editing && editing.rowId === row.id && editing.key === col.key;
                        // Pill columns render their own UI — don't open a single-input
                        // editor on cell click. The pill list manages add/delete/edit
                        // for each option independently.
                        if (col.pills) {
                          return (
                            <td key={col.key} style={{ ...cellStyle, cursor: 'default' }}>
                              <PillCell
                                value={row[col.key]}
                                separator={col.separator || ','}
                                placeholder={col.placeholder}
                                onChange={(next) => updateCell(row.id, col.key, next)}
                              />
                            </td>
                          );
                        }
                        return (
                          <td
                            key={col.key}
                            style={cellStyle}
                            onClick={() => !isEditing && startEdit(row.id, col.key, row[col.key])}
                          >
                            {isEditing ? (
                              col.multiline ? (
                                <textarea
                                  ref={inputRef}
                                  value={draft}
                                  onChange={e => setDraft(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={e => handleKeyDown(e, true)}
                                  style={inputStyle(true)}
                                  rows={3}
                                />
                              ) : (
                                <input
                                  ref={inputRef}
                                  type="text"
                                  value={draft}
                                  onChange={e => setDraft(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={e => handleKeyDown(e, false)}
                                  style={inputStyle(false)}
                                />
                              )
                            ) : (
                              <span style={{
                                whiteSpace: col.multiline ? 'pre-wrap' : 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                display: 'block',
                                color: row[col.key] ? '#0f172a' : '#cbd5e1',
                                fontStyle: row[col.key] ? 'normal' : 'italic',
                              }}>
                                {row[col.key] || '(empty — click to edit)'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
        Use a section's <strong>+ Add row</strong> button (in the colored header) to
        add a row to that category.
      </div>

      <details style={{ marginTop: 16, fontSize: 12, color: '#475569' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#1e293b' }}>
          About this table — what each column means
        </summary>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          <p>
            This is the <strong>universal picker grammar</strong>. Both the state-node
            "+ Add action" inline picker and the decision-node config popup read from
            this table so the same subject offers the same options everywhere.
          </p>
          <ul style={{ paddingLeft: 18, margin: '6px 0' }}>
            <li><strong>Family</strong> — row label, just for engineers reading the table.</li>
            <li><strong>SUBJECT</strong> — what the picker's leftmost pill displays.
              <code>Device name</code> = use the device's display name; quoted text =
              show that literal string.</li>
            <li><strong>DETAIL</strong> — pill list of categories the DETAIL pill draws
              from in <em>Action</em> mode. Most subjects have one (e.g. Servo →
              <em> Position name</em>); Robot has two (<em>Sequence #</em> or
              <em> Signal name</em>). Leave empty to hide the DETAIL pill entirely
              (cylinders, sensors). In <em>Decision</em> mode, DETAIL is populated by
              the chosen sub-action: Wait → input state, Check → PT field, Branch →
              setpoint name (or empty for binary on/off — branches auto-spawn from
              INPUTS).</li>
            <li><strong>ACTIONS</strong> — pill list of fire-actions the subject can
              perform in <em>Action</em> mode (Extend, Retract, Move Absolute, Trigger,
              Set, …). The picker offers these as the ACTION pill choices.
              <em> Empty</em> = subject is read-only (sensors, signals, timers) —
              Action mode is unavailable.</li>
            <li><strong>INPUTS</strong> — pill list of states the subject can be
              OBSERVED in (Extended, At Position, Pass / Fail, On / Off, In Tolerance,
              …). Used in <em>Decision</em> mode for all three sub-actions
              (<em>Wait</em>, <em>Check</em>, <em>Branch</em>) — they share this same
              list. The picker shows INPUTS as an info chip beside the subject so the
              engineer always sees what shape of input the subject exposes. Empty =
              Decision mode unavailable (rare).</li>
            <li><strong>Notes</strong> — engineering notes / SDC-standard references.</li>
          </ul>
          <p>
            <strong>Mental model:</strong> the picker forks at the very first step into
            <em> Action</em> or <em>Decision</em> mode. Action filters subjects to those
            with a non-empty ACTIONS column; Decision filters to those with a non-empty
            INPUTS column. Wait, Check, and Branch are the three Decision sub-actions —
            they all read the same INPUTS list and only differ in what the picker does
            with the answer (Wait blocks until true; Check logs to a PT field and
            advances; Branch auto-spawns one outgoing edge per INPUTS state).
          </p>
          <p>
            Source file: <code>src/lib/pickerGrammar.js</code> (DEFAULT_GRAMMAR).
            Overrides: <code>localStorage["sdc.pickerGrammar.v1"]</code>. Older saves
            auto-migrate to the current schema on load.
          </p>
        </div>
      </details>
    </div>
  );
}

// ── PillCell ───────────────────────────────────────────────────────────────
// Renders a list-like field (DETAIL categories, ACTIONS fire-actions, INPUTS
// observable states) as one pill per row, stacked vertically. Each pill has
// a × delete button. A "+ add" button at the bottom appends a new pill
// (input swap → Enter commits, Escape cancels). Click a pill body to
// inline-edit its text (Enter commits, blur commits, Escape cancels). Empty
// edit on commit deletes the pill.
//
// Storage: items joined by `${separator} ` for human readability; on read
// the separator is the only delimiter that matters (whitespace is trimmed).
function PillCell({ value, separator, placeholder, onChange }) {
  const sep = separator || ',';
  const items = String(value ?? '')
    .split(sep)
    .map(s => s.trim())
    .filter(Boolean);

  const [editingIdx, setEditingIdx] = useState(null); // null | number | 'new'
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingIdx !== null && inputRef.current) {
      inputRef.current.focus();
      if (typeof inputRef.current.select === 'function') {
        inputRef.current.select();
      }
    }
  }, [editingIdx]);

  // Re-join with separator + space so the wire format matches the parsed view.
  // Single-char separators ('·', ',') get a trailing space for readability.
  const joinFmt = sep === '·' ? ' · ' : `${sep} `;

  const commit = () => {
    const trimmed = draft.trim();
    if (editingIdx === 'new') {
      if (trimmed) onChange([...items, trimmed].join(joinFmt));
    } else if (typeof editingIdx === 'number') {
      const next = [...items];
      if (trimmed) next[editingIdx] = trimmed;
      else next.splice(editingIdx, 1); // empty = delete
      onChange(next.join(joinFmt));
    }
    setEditingIdx(null);
    setDraft('');
  };

  const cancel = () => { setEditingIdx(null); setDraft(''); };

  const removeAt = (i) => {
    const next = items.filter((_, idx) => idx !== i);
    onChange(next.join(joinFmt));
  };

  const startEditPill = (i, current) => {
    setEditingIdx(i);
    setDraft(current);
  };

  const startAdd = () => {
    setEditingIdx('new');
    setDraft('');
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
      {items.map((it, i) => (
        editingIdx === i ? (
          <input
            key={`edit-${i}`}
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKey}
            style={pillInputStyle}
          />
        ) : (
          <span key={`pill-${i}`} style={pillStyle}>
            <span
              onClick={() => startEditPill(i, it)}
              style={{ cursor: 'pointer', flex: 1, padding: '0 2px' }}
              title="Click to edit"
            >
              {it}
            </span>
            <button
              onClick={() => removeAt(i)}
              title="Delete this option"
              style={pillDeleteStyle}
            >×</button>
          </span>
        )
      ))}
      {editingIdx === 'new' ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          placeholder={placeholder || 'New option'}
          style={pillInputStyle}
        />
      ) : (
        <button
          onClick={startAdd}
          title="Add a new option"
          style={pillAddStyle}
        >+ add</button>
      )}
      {items.length === 0 && editingIdx === null && (
        <span style={{ fontSize: 10, color: '#cbd5e1', fontStyle: 'italic' }}>
          (empty)
        </span>
      )}
    </div>
  );
}

// ── Inline styles ──────────────────────────────────────────────────────────

const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  background: '#eef2ff',
  border: '1px solid #c7d2fe',
  borderRadius: 12,
  padding: '1px 2px 1px 8px',
  fontSize: 11,
  fontWeight: 600,
  color: '#3730a3',
  maxWidth: '100%',
};

const pillDeleteStyle = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
  padding: '0 4px',
  lineHeight: 1,
  borderRadius: 8,
};

const pillAddStyle = {
  background: '#fff',
  border: '1px dashed #cbd5e1',
  borderRadius: 12,
  padding: '1px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: '#64748b',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// Section-header chevron toggle (transparent button on colored header bar).
const sectionToggleStyle = {
  background: 'rgba(255,255,255,0.18)',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 700,
  padding: '1px 6px',
  borderRadius: 3,
  lineHeight: 1.2,
  fontFamily: 'inherit',
};

// Per-section "+ Add row" button (right side of header bar).
const sectionAddStyle = {
  marginLeft: 'auto',
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(255,255,255,0.6)',
  color: '#0f172a',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 10px',
  borderRadius: 10,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const pillInputStyle = {
  width: '100%',
  border: '1px solid #3b82f6',
  borderRadius: 12,
  padding: '1px 8px',
  fontSize: 11,
  fontFamily: 'inherit',
  color: '#0f172a',
  background: '#fff',
  boxShadow: '0 0 0 2px rgba(59,130,246,0.18)',
  outline: 'none',
  boxSizing: 'border-box',
};

const hdrStyle = {
  padding: '5px 6px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#475569',
  textAlign: 'left',
  borderRight: '1px solid #e2e8f0',
  position: 'sticky',
  top: 0,
  background: '#f1f5f9',
  zIndex: 1,
};

const cellStyle = {
  padding: '3px 6px',
  fontSize: 11,
  color: '#0f172a',
  verticalAlign: 'top',
  borderRight: '1px solid #e2e8f0',
  cursor: 'pointer',
  lineHeight: 1.35,
};

function inputStyle(multiline) {
  return {
    width: '100%',
    border: '1px solid #3b82f6',
    borderRadius: 3,
    padding: multiline ? '4px 6px' : '2px 6px',
    fontSize: 12,
    fontFamily: 'inherit',
    color: '#0f172a',
    background: '#fff',
    boxShadow: '0 0 0 2px rgba(59,130,246,0.18)',
    outline: 'none',
    resize: multiline ? 'vertical' : 'none',
    minHeight: multiline ? 60 : undefined,
  };
}

function btnStyle(variant) {
  const base = {
    padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    border: '1px solid', transition: 'all .15s',
  };
  if (variant === 'warn') return {
    ...base,
    background: '#fff', color: '#dc2626', borderColor: '#fca5a5',
  };
  if (variant === 'add') return {
    ...base,
    background: '#0072B5', color: '#fff', borderColor: '#005a8f',
  };
  return {
    ...base,
    background: '#fff', color: '#0f172a', borderColor: '#cbd5e1',
  };
}
