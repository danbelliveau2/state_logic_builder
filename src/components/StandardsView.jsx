import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { getStandards, deleteStandard } from '../lib/standardsLibrary.js';

export function StandardsView() {
  const store = useDiagramStore();
  const [templates, setTemplates] = useState(() => getStandards());
  const [search, setSearch] = useState('');
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newDesc, setNewDesc] = useState('');

  function refresh() {
    setTemplates(getStandards());
  }

  function handleOpen(template) {
    const smId = crypto.randomUUID();
    const projectData = {
      id: crypto.randomUUID(),
      name: template.name,
      isStandard: true, // hides start-condition pills, treats this project as a template
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

  function handleCreateNew() {
    const name = newName.trim();
    if (!name) return;
    const smName = name.replace(/[^A-Za-z0-9_]/g, '_');
    const smId = crypto.randomUUID();
    // Seed the standard with a Home state so the user isn't greeted with a
    // blank canvas and forced to click "+ Add State" just to begin.
    const homeNodeId = crypto.randomUUID();
    const homeNode = {
      id: homeNodeId,
      type: 'stateNode',
      position: { x: 400, y: 200 },
      data: {
        label: 'Home',
        isInitial: true,
        actions: [],
      },
    };
    const projectData = {
      id: crypto.randomUUID(),
      name,
      isStandard: true, // hides start-condition pills, treats this project as a template
      stateMachines: [{
        id: smId,
        name: smName,
        displayName: name,
        stationNumber: 1,
        description: newDesc.trim(),
        category: newCategory.trim(),
        nodes: [homeNode],
        edges: [],
        devices: [],
        recoverySeqs: [{ id: crypto.randomUUID(), name: 'Default', nodes: [], edges: [] }],
      }],
      signals: [],
      partTracking: { fields: [] },
      recipes: [],
    };
    store.openProjectFromFile(projectData, name);
    store.setActiveView('canvas');
    setNewFormOpen(false);
    setNewName('');
    setNewCategory('');
    setNewDesc('');
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
        <input
          className="standards-view__search"
          placeholder="Search by name, category, or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="standards-view__new-btn" onClick={() => setNewFormOpen(v => !v)}>
          + New Standard
        </button>
      </div>

      {newFormOpen && (
        <div className="standards-view__new-form">
          <div className="standards-view__new-form-title">Create a New Standard</div>
          <div className="standards-view__new-form-row">
            <label>
              <span>Name *</span>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Vision Station"
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleCreateNew(); }}
              />
            </label>
            <label>
              <span>Category</span>
              <input
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                placeholder="e.g. Vision, PnP, Check"
              />
            </label>
          </div>
          <label className="standards-view__new-form-desc">
            <span>Description</span>
            <textarea
              rows={2}
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Short summary of what this standard does"
            />
          </label>
          <div className="standards-view__new-form-btns">
            <button
              className="standards-view__new-form-create"
              disabled={!newName.trim()}
              onClick={handleCreateNew}
            >
              Create &amp; Open
            </button>
            <button
              className="standards-view__new-form-cancel"
              onClick={() => { setNewFormOpen(false); setNewName(''); setNewCategory(''); setNewDesc(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="standards-view__empty">
          {templates.length === 0
            ? 'No standards saved yet. Click "+ New Standard" above to create one, or click ★ on any state machine to save it here.'
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
