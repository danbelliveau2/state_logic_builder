/**
 * NewStateMachineModal - Create a new state machine / sequence program.
 */

import { useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';

// Tiny ID generator (match store pattern)
let _modalId = Date.now() + 900000;
const uid = () => `id_${(_modalId++).toString(36)}`;

export function NewStateMachineModal() {
  const store = useDiagramStore();
  const machineType = useDiagramStore(s => s.project?.machineConfig?.machineType);
  const isIndexing = machineType === 'indexing' || machineType === 'linear';
  const [name, setName] = useState('');
  const [station, setStation] = useState('');
  const [desc, setDesc] = useState('');
  const [addStartState, setAddStartState] = useState(true);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;

    const smId = store.addStateMachine({
      name: name.trim(),
      stationNumber: Number(station) || 1,
      description: desc.trim(),
    });

    if (addStartState) {
      if (isIndexing) {
        // For indexing machines: add a DecisionNode waiting on IndexComplete signal
        const sms = store.project?.stateMachines ?? [];
        const indexerSm = sms.find(sm => sm.name === 'Dial_Indexer' || sm.name === 'DialIndexer' || sm.name === 'Indexer');
        const cycleCompleteNode = indexerSm?.nodes?.find(n => n.data?.isComplete);

        // Ensure IndexComplete signal exists
        const signals = store.project?.signals ?? [];
        let indexSignal = signals.find(s => s.name === 'IndexComplete');
        if (!indexSignal && indexerSm && cycleCompleteNode) {
          store.addSignal({
            name: 'IndexComplete',
            description: 'TRUE when the indexer SM reaches Cycle Complete — used by station SMs to know indexing is done.',
            type: 'state',
            smId: indexerSm.id,
            stateNodeId: cycleCompleteNode.id,
            stateName: 'Cycle Complete',
            reachedMode: 'reached',
          });
          // Re-read after adding
          indexSignal = (store.project?.signals ?? []).find(s => s.name === 'IndexComplete');
        }

        // Create DecisionNode waiting on IndexComplete
        const decisionId = uid();
        store.addDecisionNode(smId, {
          id: decisionId,
          position: { x: 400, y: 100 },
          data: {
            label: 'Wait Index Complete',
            decisionType: 'signal',
            signalId: indexSignal?.id ?? null,
            signalName: 'IndexComplete',
            signalSource: indexerSm?.displayName ?? 'Dial_Indexer',
            signalSmName: indexerSm?.displayName ?? 'Dial_Indexer',
            signalType: 'state',
            exitCount: 1,
            exit1Label: 'Ready',
            autoOpenPopup: false,
            conditions: [{
              signalId: indexSignal?.id ?? null,
              signalName: 'IndexComplete',
              signalSource: indexerSm?.displayName ?? 'Dial_Indexer',
              signalType: 'state',
              sensorState: 'on',
            }],
            conditionLogic: 'AND',
          },
        });

        // Create first action state below and connect it
        const firstStateId = store.addNode(smId, { position: { x: 400, y: 340 } });

        if (firstStateId) {
          store.addEdge(smId, {
            source: decisionId,
            sourceHandle: 'exit-single',
            target: firstStateId,
            targetHandle: null,
          }, {
            conditionType: 'ready',
            label: 'Ready',
            isDecisionExit: true,
            exitColor: 'pass',
            outcomeLabel: 'Ready',
          });
        }
      } else {
        // Non-indexing: just add an empty initial state
        store.addNode(smId, { label: 'Home' });
      }
    }

    setName('');
    setStation('');
    setDesc('');
    store.closeNewSmModal();
  }

  const preview = name ? buildProgramName(station || 1, name) : '—';

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) store.closeNewSmModal(); }}>
      <div className="modal" style={{ width: 460 }}>
        <div className="modal__header">
          <span>New State Machine</span>
          <button className="icon-btn" onClick={store.closeNewSmModal}>✕</button>
        </div>

        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="form-label">Station Name *</label>
          <input
            className="form-input"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. PostCutterVerify"
          />
          <div className="form-hint">No spaces. PascalCase recommended.</div>

          <label className="form-label">Station Number *</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="99"
            value={station}
            onChange={e => setStation(e.target.value)}
            placeholder="e.g. 4"
          />

          <label className="form-label">Description</label>
          <input
            className="form-input"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="e.g. Post Cutter and Part Verify"
          />

          <div className="props-info-box" style={{ marginTop: 8 }}>
            <div className="props-info-box__label">Program Name (L5X)</div>
            <div className="props-info-box__value mono">{preview}</div>
          </div>

          <label className="form-checkbox-row">
            <input
              type="checkbox"
              checked={addStartState}
              onChange={e => setAddStartState(e.target.checked)}
            />
            <span>{isIndexing ? 'Add "Wait for Index Complete" decision node' : 'Add initial Home state'}</span>
          </label>

          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={store.closeNewSmModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim() || !station}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
