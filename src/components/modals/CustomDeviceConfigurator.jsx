/**
 * CustomDeviceConfigurator — inline UI for building a custom device definition.
 * Renders inside AddDeviceModal when type === 'Custom'.
 * Manages outputs, inputs, operations, complement pairs, and analog I/O.
 */

import { useState, useCallback } from 'react';

let _uid = Date.now();
const uid = () => `cdi_${(_uid++).toString(36)}`;

const DEFAULT_OUTPUT = { id: '', name: '', tagPattern: 'q_{name}' };
const DEFAULT_INPUT  = { id: '', name: '', tagPattern: 'i_{name}', dataType: 'BOOL' };
const DEFAULT_ANALOG = { id: '', name: '', tagPattern: '{name}', dataType: 'REAL', direction: 'input' };

const OP_ICONS = ['▶','⏹','⬆','⬇','↻','⚡','🔥','❄','💨','🔧','⚙','📦','🏷','✂','🔄'];

// ── Small reusable section ───────────────────────────────────────────────────

function SectionHeader({ title, onAdd, addLabel }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
      <label className="form-label" style={{ margin: 0 }}>{title}</label>
      {onAdd && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={onAdd} style={{ fontSize: 12 }}>
          + {addLabel || 'Add'}
        </button>
      )}
    </div>
  );
}

function RemoveBtn({ onClick }) {
  return (
    <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" onClick={onClick} title="Remove">✕</button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function CustomDeviceConfigurator({ value, onChange }) {
  const def = value || { outputs: [], inputs: [], operations: [], complementPairs: [], analogIO: [] };

  const update = useCallback((field, val) => {
    onChange({ ...def, [field]: val });
  }, [def, onChange]);

  // ── Outputs ──────────────────────────────────────────────────────────────
  function addOutput() {
    update('outputs', [...def.outputs, { ...DEFAULT_OUTPUT, id: uid() }]);
  }
  function updateOutput(idx, field, val) {
    const next = def.outputs.map((o, i) => {
      if (i !== idx) return o;
      const updated = { ...o, [field]: val };
      // Auto-build tagPattern from name
      if (field === 'name' && val) {
        updated.tagPattern = `q_{name}${val.replace(/\s+/g, '')}`;
      }
      return updated;
    });
    update('outputs', next);
  }
  function removeOutput(idx) {
    update('outputs', def.outputs.filter((_, i) => i !== idx));
  }

  // ── Inputs ──────────────────────────────────────────────────────────────
  function addInput() {
    update('inputs', [...def.inputs, { ...DEFAULT_INPUT, id: uid() }]);
  }
  function updateInput(idx, field, val) {
    const next = def.inputs.map((o, i) => {
      if (i !== idx) return o;
      const updated = { ...o, [field]: val };
      if (field === 'name' && val) {
        updated.tagPattern = `i_{name}${val.replace(/\s+/g, '')}`;
      }
      return updated;
    });
    update('inputs', next);
  }
  function removeInput(idx) {
    update('inputs', def.inputs.filter((_, i) => i !== idx));
  }

  // ── Analog I/O ──────────────────────────────────────────────────────────
  function addAnalog() {
    update('analogIO', [...(def.analogIO || []), { ...DEFAULT_ANALOG, id: uid() }]);
  }
  function updateAnalog(idx, field, val) {
    const next = (def.analogIO || []).map((o, i) => {
      if (i !== idx) return o;
      const updated = { ...o, [field]: val };
      if (field === 'name' && val) {
        updated.tagPattern = `${val.replace(/\s+/g, '')}_{name}`;
      }
      return updated;
    });
    update('analogIO', next);
  }
  function removeAnalog(idx) {
    update('analogIO', (def.analogIO || []).filter((_, i) => i !== idx));
  }

  // ── Operations ──────────────────────────────────────────────────────────
  function addOperation() {
    const name = `Op${(def.operations?.length ?? 0) + 1}`;
    update('operations', [...(def.operations || []), {
      id: uid(),
      label: name,
      value: name,
      icon: '⚙',
      outputsToEnergize: [],
      inputToVerify: '',
      timerSuffix: '',
      defaultTimerMs: 500,
    }]);
  }
  function updateOperation(idx, field, val) {
    const next = (def.operations || []).map((o, i) => {
      if (i !== idx) return o;
      const updated = { ...o, [field]: val };
      // Keep value in sync with label (PascalCase)
      if (field === 'label') {
        updated.value = val.replace(/[^a-zA-Z0-9]/g, '');
      }
      return updated;
    });
    update('operations', next);
  }
  function removeOperation(idx) {
    update('operations', (def.operations || []).filter((_, i) => i !== idx));
  }
  function toggleOutputInOp(opIdx, outputName) {
    const next = (def.operations || []).map((o, i) => {
      if (i !== opIdx) return o;
      const current = o.outputsToEnergize || [];
      const has = current.includes(outputName);
      return { ...o, outputsToEnergize: has ? current.filter(n => n !== outputName) : [...current, outputName] };
    });
    update('operations', next);
  }

  // ── Complement Pairs ────────────────────────────────────────────────────
  function addPair() {
    update('complementPairs', [...(def.complementPairs || []), { id: uid(), primary: '', opposing: '' }]);
  }
  function updatePair(idx, field, val) {
    const next = (def.complementPairs || []).map((p, i) => i === idx ? { ...p, [field]: val } : p);
    update('complementPairs', next);
  }
  function removePair(idx) {
    update('complementPairs', (def.complementPairs || []).filter((_, i) => i !== idx));
  }

  // Icon picker state
  const [iconPickerOp, setIconPickerOp] = useState(null);

  const outputNames = def.outputs.map(o => o.name).filter(Boolean);
  const inputNames  = def.inputs.map(i => i.name).filter(Boolean);
  const opValues    = (def.operations || []).map(o => o.value).filter(Boolean);

  return (
    <div className="custom-device-cfg">

      {/* ── Outputs ─────────────────────────────────────────────────────── */}
      <SectionHeader title="Outputs (solenoids, drives, etc.)" onAdd={addOutput} addLabel="Output" />
      {def.outputs.length === 0 && <div className="form-hint">No outputs defined yet</div>}
      {def.outputs.map((out, idx) => (
        <div key={out.id || idx} className="custom-device-cfg__row">
          <input
            className="form-input"
            value={out.name}
            onChange={e => updateOutput(idx, 'name', e.target.value)}
            placeholder="Output name (e.g. Heat)"
            style={{ flex: 1 }}
          />
          <input
            className="form-input mono"
            value={out.tagPattern}
            onChange={e => updateOutput(idx, 'tagPattern', e.target.value)}
            placeholder="q_{name}Heat"
            style={{ flex: 1, fontSize: 11 }}
          />
          <RemoveBtn onClick={() => removeOutput(idx)} />
        </div>
      ))}

      {/* ── Inputs ──────────────────────────────────────────────────────── */}
      <SectionHeader title="Inputs (sensors, feedback, etc.)" onAdd={addInput} addLabel="Input" />
      {def.inputs.length === 0 && <div className="form-hint">No inputs defined yet</div>}
      {def.inputs.map((inp, idx) => (
        <div key={inp.id || idx} className="custom-device-cfg__row">
          <input
            className="form-input"
            value={inp.name}
            onChange={e => updateInput(idx, 'name', e.target.value)}
            placeholder="Input name (e.g. TempOK)"
            style={{ flex: 1 }}
          />
          <input
            className="form-input mono"
            value={inp.tagPattern}
            onChange={e => updateInput(idx, 'tagPattern', e.target.value)}
            placeholder="i_{name}TempOK"
            style={{ flex: 1, fontSize: 11 }}
          />
          <select
            className="form-select"
            value={inp.dataType}
            onChange={e => updateInput(idx, 'dataType', e.target.value)}
            style={{ width: 80 }}
          >
            <option value="BOOL">BOOL</option>
            <option value="REAL">REAL</option>
          </select>
          <RemoveBtn onClick={() => removeInput(idx)} />
        </div>
      ))}

      {/* ── Analog I/O ──────────────────────────────────────────────────── */}
      <SectionHeader title="Analog I/O (optional)" onAdd={addAnalog} addLabel="Analog" />
      {(def.analogIO || []).map((aio, idx) => (
        <div key={aio.id || idx} className="custom-device-cfg__row">
          <input
            className="form-input"
            value={aio.name}
            onChange={e => updateAnalog(idx, 'name', e.target.value)}
            placeholder="Name (e.g. Temperature)"
            style={{ flex: 1 }}
          />
          <select
            className="form-select"
            value={aio.direction}
            onChange={e => updateAnalog(idx, 'direction', e.target.value)}
            style={{ width: 85 }}
          >
            <option value="input">Input</option>
            <option value="output">Output</option>
          </select>
          <input
            className="form-input mono"
            value={aio.tagPattern}
            onChange={e => updateAnalog(idx, 'tagPattern', e.target.value)}
            placeholder="{name}Temp"
            style={{ flex: 1, fontSize: 11 }}
          />
          <RemoveBtn onClick={() => removeAnalog(idx)} />
        </div>
      ))}

      {/* ── Operations ──────────────────────────────────────────────────── */}
      <SectionHeader title="Operations" onAdd={addOperation} addLabel="Operation" />
      {(def.operations || []).length === 0 && <div className="form-hint">Define what this device can do (e.g. Start, Stop, Heat, Cool)</div>}
      {(def.operations || []).map((op, idx) => (
        <div key={op.id || idx} className="custom-device-cfg__op-card">
          <div className="custom-device-cfg__row">
            {/* Icon picker */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="icon-btn"
                style={{ fontSize: 18, width: 32, height: 32 }}
                onClick={() => setIconPickerOp(iconPickerOp === idx ? null : idx)}
                title="Pick icon"
              >
                {op.icon || '⚙'}
              </button>
              {iconPickerOp === idx && (
                <div className="custom-device-cfg__icon-picker">
                  {OP_ICONS.map(ic => (
                    <button
                      key={ic}
                      type="button"
                      className="icon-btn"
                      style={{ fontSize: 16, width: 28, height: 28 }}
                      onClick={() => { updateOperation(idx, 'icon', ic); setIconPickerOp(null); }}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="form-input"
              value={op.label}
              onChange={e => updateOperation(idx, 'label', e.target.value)}
              placeholder="Operation label"
              style={{ flex: 1 }}
            />
            <RemoveBtn onClick={() => removeOperation(idx)} />
          </div>
          {/* Outputs to energize */}
          {outputNames.length > 0 && (
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 36 }}>
              <span className="form-hint" style={{ marginRight: 4, lineHeight: '24px' }}>Energize:</span>
              {outputNames.map(oName => (
                <label key={oName} className="checkbox-label" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={(op.outputsToEnergize || []).includes(oName)}
                    onChange={() => toggleOutputInOp(idx, oName)}
                  />
                  {oName}
                </label>
              ))}
            </div>
          )}
          {/* Input to verify */}
          <div style={{ marginTop: 4, display: 'flex', gap: 8, paddingLeft: 36, alignItems: 'center' }}>
            <span className="form-hint" style={{ whiteSpace: 'nowrap' }}>Verify input:</span>
            <select
              className="form-select"
              value={op.inputToVerify || ''}
              onChange={e => updateOperation(idx, 'inputToVerify', e.target.value)}
              style={{ flex: 1, fontSize: 12 }}
            >
              <option value="">None (no sensor verify)</option>
              {inputNames.map(iName => (
                <option key={iName} value={iName}>{iName}</option>
              ))}
            </select>
          </div>
          {/* Timer */}
          {op.inputToVerify && (
            <div style={{ marginTop: 4, display: 'flex', gap: 8, paddingLeft: 36, alignItems: 'center' }}>
              <span className="form-hint" style={{ whiteSpace: 'nowrap' }}>Timer suffix:</span>
              <input
                className="form-input mono"
                value={op.timerSuffix || ''}
                onChange={e => updateOperation(idx, 'timerSuffix', e.target.value)}
                placeholder="e.g. HeatDelay"
                style={{ flex: 1, fontSize: 11 }}
              />
              <input
                className="form-input"
                type="number"
                min="0"
                step="100"
                value={op.defaultTimerMs ?? 500}
                onChange={e => updateOperation(idx, 'defaultTimerMs', Number(e.target.value))}
                style={{ width: 80 }}
                title="Default timer preset (ms)"
              />
              <span className="form-hint">ms</span>
            </div>
          )}
        </div>
      ))}

      {/* ── Complement Pairs ────────────────────────────────────────────── */}
      {opValues.length >= 2 && (
        <>
          <SectionHeader title="Complement Pairs (optional)" onAdd={addPair} addLabel="Pair" />
          <div className="form-hint">Link opposing operations (like Extend/Retract) for proper OTE/complement logic</div>
          {(def.complementPairs || []).map((pair, idx) => (
            <div key={pair.id || idx} className="custom-device-cfg__row" style={{ marginTop: 4 }}>
              <select
                className="form-select"
                value={pair.primary || ''}
                onChange={e => updatePair(idx, 'primary', e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Primary op...</option>
                {opValues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>↔</span>
              <select
                className="form-select"
                value={pair.opposing || ''}
                onChange={e => updatePair(idx, 'opposing', e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Opposing op...</option>
                {opValues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <RemoveBtn onClick={() => removePair(idx)} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
