import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { getStandards, deleteStandard } from '../lib/standardsLibrary.js';

export function StandardsView() {
  const store = useDiagramStore();
  const [templates, setTemplates] = useState(() => getStandards());
  const [search, setSearch] = useState('');

  function refresh() {
    setTemplates(getStandards());
  }

  function handleOpen(template) {
    const smId = crypto.randomUUID();
    const projectData = {
      id: crypto.randomUUID(),
      name: template.name,
      stateMachines: [{
        id: smId,
        name: template.name,
        displayName: template.name,
        stationNumber: 1,
        description: template.description || '',
        nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
        edges: JSON.parse(JSON.stringify(template.edges ?? [])),
        devices: JSON.parse(JSON.stringify(template.devices ?? [])),
        recoverySeqs: [{ id: crypto.randomUUID(), name: 'Default', nodes: [], edges: [] }],
      }],
      signals: [],
      partTracking: { fields: [] },
      recipes: [],
    };
    store.openProjectFromFile(projectData, template.name);
    store.setActiveView('canvas');
  }

  function handleDelete(id) {
    if (!window.confirm('Remove this standard from the library?')) return;
    deleteStandard(id);
    refresh();
  }

  function handleNewStandard() {
    const smId = crypto.randomUUID();
    const projectData = {
      id: crypto.randomUUID(),
      name: 'New Standard',
      stateMachines: [{
        id: smId,
        name: 'New_Standard',
        displayName: 'New Standard',
        stationNumber: 1,
        description: '',
        nodes: [],
        edges: [],
        devices: [],
        recoverySeqs: [{ id: crypto.randomUUID(), name: 'Default', nodes: [], edges: [] }],
      }],
      signals: [],
      partTracking: { fields: [] },
      recipes: [],
    };
    store.openProjectFromFile(projectData, 'New Standard');
    store.setActiveView('canvas');
  }

  const filtered = templates.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="standards-view">
      <div className="standards-view__header">
        <h2 className="standards-view__title">Standards Library</h2>
        <button className="standards-view__new-btn" onClick={handleNewStandard}>
          + New Standard
        </button>
        <input
          className="standards-view__search"
          placeholder="Search by name, category, or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="standards-view__empty">
          {templates.length === 0
            ? 'No standards saved yet. Click ★ on any state machine to add it here.'
            : 'No results match your search.'}
        </div>
      ) : (
        <div className="standards-view__list">
          {filtered.map(t => (
            <div key={t.id} className="standards-card">
              <div className="standards-card__body">
                {t.category && (
                  <span className="standards-card__category">{t.category}</span>
                )}
                <div className="standards-card__name">{t.name}</div>
                {t.description && (
                  <div className="standards-card__desc">{t.description}</div>
                )}
              </div>
              <div className="standards-card__actions">
                <button className="standards-card__open" onClick={() => handleOpen(t)}>
                  Open
                </button>
                <button className="standards-card__delete" onClick={() => handleDelete(t.id)} title="Remove from library">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
