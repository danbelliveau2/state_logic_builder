/**
 * SmOutputModal - Create/Edit an SM Output.
 * An SM Output is TRUE while the SM is in a specific state (activeNodeId),
 * FALSE otherwise. Generates an OTE rung in R03_StateLogic.
 */

import { useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';

export function SmOutputModal({ smId, output, onClose }) {
  const store = useDiagramStore();
  const sm = store.project?.stateMachines?.find(s => s.id === smId);
  const nodes = sm?.nodes ?? [];

  const [name, setName] = useState(output?.name ?? '');
  const [description, setDescription] = useState(output?.description ?? '');
  const [activeNodeId, setActiveNodeId] = useState(output?.activeNodeId ?? '');

  // Build a human-readable label for a node
  function nodeLabel(node) {
    const actions = node.data?.actions ?? [];
    const devices = sm?.devices ?? [];
    const firstAction = actions[0];
    const dev = firstAction ? devices.find(d => d.id === firstAction.deviceId) : null;
    const stepNum = node.data?.stepNumber ?? '?';
    if (dev) return `State ${stepNum}: ${dev.displayName} ${firstAction.operation ?? ''}`.trim();
    if (node.data?.label) return `State ${stepNum}: ${node.data.label}`;
    return `State ${stepNum}`;
  }

  function handleSave() {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!cleanName) return;
    const data = {
      name: cleanName,
      description: description.trim(),
      activeNodeId: activeNodeId || null,
    };
    if (output) {
      store.updateSmOutput(smId, output.id, data);
    } else {
      store.addSmOutput(smId, data);
    }
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 460 }}>
        <div className="modal__header">
          <h2 className="modal__title">{output ? 'Edit SM Output' : 'New SM Output'}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Name */}
          <div className="form-group">
            <label className="form-label">Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="PickComplete"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              className="form-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          {/* Active while in step */}
          <div className="form-group">
            <label className="form-label">Active while SM is in step:</label>
            <select
              className="form-input"
              value={activeNodeId}
              onChange={e => setActiveNodeId(e.target.value)}
            >
              <option value="">-- Not set --</option>
              {nodes.map(n => (
                <option key={n.id} value={n.id}>{nodeLabel(n)}</option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
              Output is TRUE only while the SM is in this state (OTE rung).
            </div>
          </div>

          {/* Tag preview */}
          {name.trim() && (
            <div style={{
              padding: '6px 10px', background: '#1e2937', borderRadius: 4,
              fontSize: 11, color: '#9ca3af', fontFamily: 'Consolas, monospace',
            }}>
              Tag: <span style={{ color: '#befa4f' }}>p_{name.trim().replace(/[^a-zA-Z0-9_]/g, '')}</span>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {output ? 'Save Changes' : 'Add SM Output'}
          </button>
        </div>
      </div>
    </div>
  );
}
