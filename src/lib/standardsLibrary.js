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

/** Key used to remember whether we've already tried to seed this browser.
 *  Prevents re-importing the seed file every reload (which would overwrite
 *  the user's local edits with whatever shipped with the app). */
const SEED_FLAG_KEY = 'sdc_standards_library_seeded';

/** On first launch in a fresh browser, pull `/standards-seed.json` shipped
 *  with the app (served out of `public/`) and stuff its entries into
 *  localStorage. Idempotent — once seeded, never runs again for this origin
 *  unless the user clears storage. Safe to call unconditionally on app mount.
 *
 *  Strategy:
 *    - If SEED_FLAG_KEY is already set → skip (user has seen the seed once).
 *    - If localStorage already has standards → mark seeded, skip.
 *    - Else fetch /standards-seed.json and write whatever we get.
 *  Any network / parse error silently no-ops; the app just starts empty.
 */
export async function seedStandardsIfEmpty() {
  try {
    if (localStorage.getItem(SEED_FLAG_KEY)) return; // already processed
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && JSON.parse(existing).length > 0) {
      localStorage.setItem(SEED_FLAG_KEY, '1');
      return;
    }
    const res = await fetch('/standards-seed.json', { cache: 'no-cache' });
    if (!res.ok) { localStorage.setItem(SEED_FLAG_KEY, '1'); return; }
    const seed = await res.json();
    if (Array.isArray(seed) && seed.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    }
    localStorage.setItem(SEED_FLAG_KEY, '1');
  } catch {
    // Fetch failed (offline, no seed file, etc.) — leave storage alone.
    // Don't set the flag so a future reload gets another chance.
  }
}

/** Export the full library as a JSON Blob download. Called by the Export
 *  button in StandardsView. The resulting file is drop-in compatible with
 *  `public/standards-seed.json` — commit it to ship a default library. */
export function exportStandardsLibrary() {
  const standards = getStandards();
  const json = JSON.stringify(standards, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `standards-library-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return standards.length;
}

/** Import a JSON library from a File object (e.g. from <input type="file">).
 *  Mode:
 *    - 'replace' — wipes the current library and installs the imported one
 *    - 'merge'   — appends imported entries, skipping any with duplicate ids
 *  Returns { added, total } counts, or null on parse error. */
export async function importStandardsLibrary(file, mode = 'merge') {
  if (!file) return null;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    let merged;
    if (mode === 'replace') {
      merged = parsed;
    } else {
      const existing = getStandards();
      const seen = new Set(existing.map(s => s.id));
      const added = parsed.filter(s => s?.id && !seen.has(s.id));
      merged = [...existing, ...added];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return { added: merged.length - (mode === 'replace' ? 0 : getStandards().length - merged.length), total: merged.length };
  } catch {
    return null;
  }
}
