/**
 * PickerTestSubjectManager — minimal subject CRUD for the picker preview.
 *
 * Type a name, pick a type from the grammar, click Add. Done.
 * Click × to remove a subject.
 *
 * The picker's DETAIL field is free-text by default; if a subject needs
 * named values (e.g. Servo positions), edit `detailValues` directly in
 * localStorage or extend this component later.
 */

import { useState, useMemo } from 'react';
import { loadGrammar } from '../lib/pickerGrammar.js';
import { newSubjectId } from '../lib/pickerTestSubjects.js';

export function PickerTestSubjectManager({ subjects, onChange }) {
  const grammar = useMemo(() => loadGrammar(), []);
  const [name, setName] = useState('');
  const [type, setType] = useState(grammar[0]?.id || '');

  const grammarById = useMemo(() => {
    const m = {};
    grammar.forEach(g => { m[g.id] = g; });
    return m;
  }, [grammar]);

  function add() {
    const trimmed = name.trim();
    if (!trimmed || !type) return;
    const newSub = {
      id: newSubjectId(),
      name: trimmed,
      grammarRowId: type,
      detailValues: {},
    };
    onChange([...(subjects || []), newSub]);
    setName('');
  }

  function remove(id) {
    onChange((subjects || []).filter(s => s.id !== id));
  }

  function clearAll() {
    if (!subjects?.length) return;
    if (!confirm('Remove all subjects?')) return;
    onChange([]);
  }

  return (
    <div style={wrap}>
      <div style={hdr}>
        <strong style={{ fontSize: 13 }}>Subjects ({subjects?.length || 0})</strong>
        {subjects?.length > 0 && (
          <button onClick={clearAll} style={clearBtn} title="Remove all subjects">
            Clear all
          </button>
        )}
      </div>

      {/* Add row — always visible. Type first, then name. */}
      <div style={addRow}>
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          style={typeSelect}
        >
          {grammar.map(g => (
            <option key={g.id} value={g.id}>{g.family}</option>
          ))}
        </select>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Name (e.g. VerticalCylinder)"
          style={nameInput}
        />
        <button onClick={add} disabled={!name.trim()} style={addBtn(!!name.trim())}>
          + Add
        </button>
      </div>

      {/* List */}
      <div style={listWrap}>
        {(!subjects || subjects.length === 0) ? (
          <div style={empty}>
            No subjects yet. Type a name above and click <strong>+ Add</strong>.
          </div>
        ) : (
          subjects.map(s => {
            const g = grammarById[s.grammarRowId];
            return (
              <div key={s.id} style={row}>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{s.name}</span>
                <span style={typeChip}>{g?.family || '(unknown type)'}</span>
                <button onClick={() => remove(s.id)} style={delBtn} title="Remove">×</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

const wrap = {
  background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: 10,
};

const hdr = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
};

const addRow = {
  display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8,
};

const nameInput = {
  flex: '1 1 200px', padding: '4px 8px', fontSize: 12, fontFamily: 'inherit',
  border: '1px solid #cbd5e1', borderRadius: 4, color: '#0f172a', outline: 'none',
};

const typeSelect = {
  flex: '0 0 auto', padding: '4px 8px', fontSize: 12, fontFamily: 'inherit',
  border: '1px solid #cbd5e1', borderRadius: 4, color: '#0f172a',
  background: '#fff',
};

function addBtn(enabled) {
  return {
    padding: '4px 12px', fontSize: 12, fontWeight: 700,
    background: enabled ? '#0072B5' : '#cbd5e1',
    color: '#fff', border: 'none', borderRadius: 4,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit',
  };
}

const listWrap = {
  display: 'flex', flexDirection: 'column', gap: 3,
};

const row = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '4px 8px', background: '#f8fafc',
  border: '1px solid #e2e8f0', borderRadius: 4,
  fontSize: 12,
};

const typeChip = {
  fontSize: 10, fontWeight: 600, color: '#475569',
  background: '#fff', padding: '1px 8px', borderRadius: 10,
  border: '1px solid #e2e8f0',
};

const delBtn = {
  marginLeft: 'auto', padding: '0 8px', fontSize: 16, fontWeight: 700,
  background: 'none', color: '#94a3b8', border: 'none', cursor: 'pointer',
  borderRadius: 3, lineHeight: 1, fontFamily: 'inherit',
};

const empty = {
  fontSize: 11, color: '#94a3b8', fontStyle: 'italic',
  padding: '8px 10px', background: '#fafbfc',
  border: '1px dashed #e2e8f0', borderRadius: 4,
};

const clearBtn = {
  marginLeft: 'auto', padding: '2px 8px', fontSize: 10, fontWeight: 600,
  background: '#fff', color: '#dc2626', border: '1px solid #fca5a5',
  borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
};
