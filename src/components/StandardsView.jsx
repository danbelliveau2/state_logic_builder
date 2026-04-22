import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { getStandards, deleteStandard, saveStandard, duplicateStandard, renameStandard } from '../lib/standardsLibrary.js';

export function StandardsView() {
  const store = useDiagramStore();
  const [templates, setTemplates] = useState(() => getStandards());
  const [search, setSearch] = useState('');
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newDesc, setNewDesc] = useState('');
  // Inline-rename state: which card's name is being edited + the draft text
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');

  function refresh() {
    setTemplates(getStandards());
  }

  function handleOpen(template) {
    const smId = crypto.randomUUID();
    const projectData = {
      id: crypto.randomUUID(),
      name: template.name,
      isStandard: true, // hides start-condition pills, treats this project as a template
      standardId: template.id, // link back to library entry so edits auto-save
      stateMachines: [{
        id: smId,
        name: template.name,
        displayName: template.name,
        stationNumber: 1,
        description: template.description || '',
        category: template.category || '',
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

  function handleCopy(template) {
    const newId = duplicateStandard(template.id);
    if (!newId) return;
    refresh();
    // Immediately enter rename mode on the new row, with the suffix pre-selected
    setRenamingId(newId);
    setRenameDraft(`${template.name} (Copy)`);
  }

  function commitRename() {
    if (!renamingId) return;
    const name = renameDraft.trim();
    if (name) renameStandard(renamingId, name);
    setRenamingId(null);
    setRenameDraft('');
    refresh();
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
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

    // Save to the library IMMEDIATELY so the user never loses work. The
    // returned id links the live project to the library entry, and Canvas
    // auto-saves subsequent edits to the same row.
    const description = newDesc.trim();
    const category = newCategory.trim();
    const standardId = saveStandard({
      name,
      description,
      category,
      nodes: [homeNode],
      edges: [],
      devices: [],
    });

    const projectData = {
      id: crypto.randomUUID(),
      name,
      isStandard: true, // hides start-condition pills, treats this project as a template
      standardId, // link back to library entry for auto-save
      stateMachines: [{
        id: smId,
        name: smName,
        displayName: name,
        stationNumber: 1,
        description,
        category,
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
    refresh(); // so the new entry appears if the user navigates back
  }

  const filtered = templates.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Group filtered standards by category. Uncategorized entries go last.
  const grouped = (() => {
    const buckets = new Map();
    for (const t of filtered) {
      const cat = (t.category || '').trim() || 'Uncategorized';
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat).push(t);
    }
    return [...buckets.entries()].sort(([a], [b]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
  })();

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
        <div className="standards-view__groups">
          {grouped.map(([cat, items]) => (
            <div key={cat} className="standards-view__group">
              <div className="standards-view__group-title">
                {cat}
                <span className="standards-view__group-count">{items.length}</span>
              </div>
              <div className="standards-view__list">
                {items.map(t => (
                  <div
                    key={t.id}
                    className="standards-card standards-card--clickable"
                    onClick={() => {
                      // Clicking anywhere on the card opens it — except when
                      // renaming, or when the click was on a button inside the
                      // actions area (handled via stopPropagation below).
                      if (renamingId === t.id) return;
                      handleOpen(t);
                    }}
                    title="Click to open"
                  >
                    <div className="standards-card__body">
                      {renamingId === t.id ? (
                        <input
                          autoFocus
                          className="standards-card__name-input"
                          value={renameDraft}
                          onChange={e => setRenameDraft(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename();
                            else if (e.key === 'Escape') cancelRename();
                          }}
                          onBlur={commitRename}
                          onFocus={e => e.currentTarget.select()}
                          style={{
                            fontSize: 15, fontWeight: 700, padding: '4px 6px',
                            border: '1px solid #1574C4', borderRadius: 4,
                            width: '100%', boxSizing: 'border-box',
                          }}
                        />
                      ) : (
                        <div
                          className="standards-card__name"
                          title="Double-click to rename"
                          onDoubleClick={e => {
                            e.stopPropagation();
                            setRenamingId(t.id);
                            setRenameDraft(t.name);
                          }}
                        >
                          {t.name}
                        </div>
                      )}
                      {t.description && (
                        <div className="standards-card__desc">{t.description}</div>
                      )}
                    </div>
                    <div
                      className="standards-card__actions"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        className="standards-card__copy"
                        onClick={e => { e.stopPropagation(); handleCopy(t); }}
                        title="Duplicate this standard to a new editable row"
                      >
                        Copy
                      </button>
                      <button
                        className="standards-card__delete"
                        onClick={e => { e.stopPropagation(); handleDelete(t.id); }}
                        title="Remove from library"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
