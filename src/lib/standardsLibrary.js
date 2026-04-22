/**
 * Standards Library — server-backed, shared across every client pointed at
 * the same server. localStorage is used ONLY as an offline cache so the UI
 * always has something to render instantly; the server (and through it, the
 * shared file on disk) is the source of truth.
 *
 * Sync model:
 *   - On boot, the app calls `initStandardsLibrary()`, which probes the
 *     server and, if reachable, pulls the library and overwrites the cache.
 *   - All mutating operations (save/update/delete) update the cache AND
 *     fire off a POST/DELETE to the server. If the server is reachable,
 *     the shared file is updated and every other client sees it on their
 *     next refresh. If the server is unreachable, the cache is still
 *     updated so the local app keeps working — the change will be pushed
 *     up next time we talk to the server (not yet auto, but the new Sync
 *     button in StandardsView triggers a manual merge push).
 *   - Synchronous getters (`getStandards`) return the cache — same shape
 *     and timing as before, so existing callers don't need to become async.
 */

import * as api from './standardsApi.js';

const STORAGE_KEY = 'sdc_standards_library';
const SEEDED_FLAG_KEY = 'sdc_standards_library_seeded'; // legacy — cleared on boot

/** Listeners notified whenever the cache changes (server pull or local mutation). */
const changeListeners = new Set();
function notifyChanged() {
  for (const fn of changeListeners) {
    try { fn(); } catch (_) { /* listener errors shouldn't break the app */ }
  }
}

/** Subscribe to cache-changed events. Returns an unsubscribe fn. Used by the
 *  StandardsView to rerender when a background refresh lands. */
export function subscribeStandards(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** In-memory flag set once boot-sync has succeeded at least once this session.
 *  Used by the UI to show a "shared library" vs "offline — cached" indicator. */
let serverReachable = false;
export function isStandardsServerReachable() { return serverReachable; }

// ── Cache helpers ──────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(arr) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('[standardsLibrary] cache write failed:', e?.message);
  }
  notifyChanged();
}

// ── Boot sync ──────────────────────────────────────────────────────────────

/** Called once on app mount. Probes the server and pulls the shared library
 *  into the local cache. Returns true if the pull succeeded, false if we're
 *  running offline. Safe to call multiple times. */
export async function initStandardsLibrary() {
  // Clean up the legacy seed flag — the old fetch-seed flow is gone. Leaving
  // it set doesn't hurt anything but it's pointless state.
  try { localStorage.removeItem(SEEDED_FLAG_KEY); } catch (_) {}

  try {
    const fresh = await api.fetchStandards();
    // CRITICAL: flip the reachability flag BEFORE writeCache, because
    // writeCache → notifyChanged → subscribers read `isStandardsServerReachable()`
    // synchronously. If the flag is still false at that moment, the UI will
    // show "Offline" even though the fetch just succeeded.
    serverReachable = true;
    writeCache(fresh);
    console.info('[standardsLibrary] synced from server —', fresh.length, 'standards');
    return true;
  } catch (err) {
    // Server unreachable — keep running with whatever's in the cache.
    console.warn('[standardsLibrary] offline mode — using cached library:', err?.message);
    serverReachable = false;
    notifyChanged(); // still notify so the UI can reflect the offline state
    return false;
  }
}

/** Manually pull the latest library from the server and update the cache.
 *  Used by the "Refresh" button in StandardsView and after import flows.
 *  Returns the fresh array on success, null on failure. */
export async function refreshStandardsFromServer() {
  try {
    const fresh = await api.fetchStandards();
    serverReachable = true;   // flip BEFORE writeCache — see init() for rationale
    writeCache(fresh);
    return fresh;
  } catch (err) {
    console.warn('[standardsLibrary] refresh failed:', err?.message);
    serverReachable = false;
    notifyChanged();
    return null;
  }
}

// ── Synchronous reads (return cache) ───────────────────────────────────────

export function getStandards() {
  return readCache();
}

// ── Mutations (cache + fire-and-forget to server) ──────────────────────────

/** Create a new library entry. Returns the generated id so callers can
 *  link the live project to the entry for subsequent auto-updates. */
export function saveStandard({ name, description, category, nodes, edges, devices }) {
  const id = crypto.randomUUID();
  const entry = {
    id,
    name,
    description: description || '',
    category: category || '',
    savedAt: new Date().toISOString(),
    nodes: JSON.parse(JSON.stringify(nodes ?? [])),
    edges: JSON.parse(JSON.stringify(edges ?? [])),
    devices: JSON.parse(JSON.stringify(devices ?? [])),
  };

  const current = readCache();
  current.push(entry);
  writeCache(current);

  // Fire-and-forget server write. If this fails (offline), the cache still
  // has the change and the UI looks right; the user can re-sync manually.
  api.upsertStandard(id, entry).catch(err => {
    console.warn('[standardsLibrary] server save failed (keeping local):', err?.message);
    serverReachable = false;
  });

  return id;
}

/** Update an existing library entry in place. Returns true if found. */
export function updateStandard(id, { name, description, category, nodes, edges, devices }) {
  if (!id) return false;
  const current = readCache();
  const idx = current.findIndex(s => s.id === id);
  if (idx === -1) return false;
  const prev = current[idx];
  const next = {
    ...prev,
    name: name ?? prev.name,
    description: description ?? prev.description,
    category: category ?? prev.category,
    savedAt: new Date().toISOString(),
    nodes: nodes !== undefined ? JSON.parse(JSON.stringify(nodes)) : prev.nodes,
    edges: edges !== undefined ? JSON.parse(JSON.stringify(edges)) : prev.edges,
    devices: devices !== undefined ? JSON.parse(JSON.stringify(devices)) : prev.devices,
  };
  current[idx] = next;
  writeCache(current);

  api.upsertStandard(id, next).catch(err => {
    console.warn('[standardsLibrary] server update failed (keeping local):', err?.message);
    serverReachable = false;
  });

  return true;
}

export function deleteStandard(id) {
  const updated = readCache().filter(t => t.id !== id);
  writeCache(updated);

  api.deleteStandardById(id).catch(err => {
    console.warn('[standardsLibrary] server delete failed (keeping local):', err?.message);
    serverReachable = false;
  });
}

/** Deep-clone an existing standard into a brand-new library row and return
 *  the new id. All nodes/edges/devices get fresh UUIDs so the two entries
 *  are fully independent (editing one never mutates the other). */
export function duplicateStandard(id) {
  const current = readCache();
  const source = current.find(s => s.id === id);
  if (!source) return null;

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
  const copy = {
    id: newId,
    name: `${source.name} (Copy)`,
    description: source.description || '',
    category: source.category || '',
    savedAt: new Date().toISOString(),
    nodes: nodesClone,
    edges: edgesClone,
    devices: devicesClone,
  };
  current.push(copy);
  writeCache(current);

  api.upsertStandard(newId, copy).catch(err => {
    console.warn('[standardsLibrary] server duplicate failed (keeping local):', err?.message);
    serverReachable = false;
  });

  return newId;
}

/** Rename a standard in place. Thin wrapper around updateStandard. */
export function renameStandard(id, newName) {
  if (!id || !newName?.trim()) return false;
  return updateStandard(id, { name: newName.trim() });
}

// ── Legacy seed API (no-op now) ────────────────────────────────────────────

/** Kept as a no-op alias for existing bootstrap call-sites. The real boot
 *  step is `initStandardsLibrary()` — App.jsx imports that instead now. */
export async function seedStandardsIfEmpty() {
  // Intentionally empty. The old fetch-a-local-JSON-seed flow has been
  // replaced by the server-backed sync in initStandardsLibrary.
}

// ── Export / Import (still useful for offline migration / backups) ─────────

/** Export the full library as a JSON Blob download. Useful for one-off
 *  backups or for handing a library file to a teammate who doesn't have
 *  network access to the shared share. */
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

/** Import a JSON library from a File object. Both modes push the result
 *  up to the server so the imported entries are instantly visible to every
 *  other client.
 *    - 'replace' — wipes the shared library and installs the imported one
 *    - 'merge'   — appends imported entries, skipping duplicate ids
 *  Returns { added, total } counts, or null on parse error. */
export async function importStandardsLibrary(file, mode = 'merge') {
  if (!file) return null;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;

    let merged;
    let added;
    if (mode === 'replace') {
      merged = parsed;
      added  = parsed.length;
    } else {
      const existing = readCache();
      const seen = new Set(existing.map(s => s.id));
      const incoming = parsed.filter(s => s?.id && !seen.has(s.id));
      merged = [...existing, ...incoming];
      added  = incoming.length;
    }

    writeCache(merged);

    // Push the merged array to the server so everyone else sees the new
    // entries. If this fails (offline), the local cache is still correct.
    try {
      await api.replaceStandards(merged);
      serverReachable = true;
    } catch (err) {
      console.warn('[standardsLibrary] server import push failed:', err?.message);
      serverReachable = false;
    }

    return { added, total: merged.length };
  } catch {
    return null;
  }
}
