const STORAGE_KEY = 'sdc_standards_library';

export function getStandards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Create a new library entry. Returns the generated id so callers can link
 *  the live project to the entry for subsequent auto-updates. */
export function saveStandard({ name, description, category, nodes, edges, devices }) {
  const id = crypto.randomUUID();
  const standards = getStandards();
  standards.push({
    id,
    name,
    description: description || '',
    category: category || '',
    savedAt: new Date().toISOString(),
    nodes: JSON.parse(JSON.stringify(nodes ?? [])),
    edges: JSON.parse(JSON.stringify(edges ?? [])),
    devices: JSON.parse(JSON.stringify(devices ?? [])),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(standards));
  return id;
}

/** Update an existing library entry in place. Returns true if found, false
 *  otherwise. Used by the auto-save wiring on standards-linked project tabs. */
export function updateStandard(id, { name, description, category, nodes, edges, devices }) {
  if (!id) return false;
  const standards = getStandards();
  const idx = standards.findIndex(s => s.id === id);
  if (idx === -1) return false;
  const prev = standards[idx];
  standards[idx] = {
    ...prev,
    name: name ?? prev.name,
    description: description ?? prev.description,
    category: category ?? prev.category,
    savedAt: new Date().toISOString(),
    nodes: nodes !== undefined ? JSON.parse(JSON.stringify(nodes)) : prev.nodes,
    edges: edges !== undefined ? JSON.parse(JSON.stringify(edges)) : prev.edges,
    devices: devices !== undefined ? JSON.parse(JSON.stringify(devices)) : prev.devices,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(standards));
  return true;
}

export function deleteStandard(id) {
  const updated = getStandards().filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/** Deep-clone an existing standard into a brand-new library row and return
 *  the new id. The clone defaults to "{orig} (Copy)" — caller typically
 *  puts the new row into inline-rename mode so the user can rename on the
 *  spot. All nodes/edges/devices get fresh UUIDs so the two entries are
 *  fully independent (editing one never mutates the other). */
export function duplicateStandard(id) {
  const standards = getStandards();
  const source = standards.find(s => s.id === id);
  if (!source) return null;

  // Build an old→new id map so edge source/target references point at the
  // clone's own nodes, not the original's.
  const idMap = new Map();
  const nodesClone = (source.nodes ?? []).map(n => {
    const newId = crypto.randomUUID();
    idMap.set(n.id, newId);
    return { ...JSON.parse(JSON.stringify(n)), id: newId };
  });
  const edgesClone = (source.edges ?? []).map(e => ({
    ...JSON.parse(JSON.stringify(e)),
    id: crypto.randomUUID(),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }));
  const devicesClone = (source.devices ?? []).map(d => ({
    ...JSON.parse(JSON.stringify(d)),
    id: crypto.randomUUID(),
  }));

  const newId = crypto.randomUUID();
  standards.push({
    id: newId,
    name: `${source.name} (Copy)`,
    description: source.description || '',
    category: source.category || '',
    savedAt: new Date().toISOString(),
    nodes: nodesClone,
    edges: edgesClone,
    devices: devicesClone,
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(standards));
  return newId;
}

/** Rename a standard in place. Thin wrapper around updateStandard. */
export function renameStandard(id, newName) {
  if (!id || !newName?.trim()) return false;
  return updateStandard(id, { name: newName.trim() });
}
