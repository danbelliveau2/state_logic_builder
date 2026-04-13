/**
 * Device Library — localStorage persistence for reusable custom device types.
 * Cross-project: not tied to Zustand store. Devices saved here can be
 * imported into any project via the library picker.
 */

const STORAGE_KEY = 'sdc-statelogic-device-library';

let _id = Date.now();
const libUid = () => `custlib_${(_id++).toString(36)}`;

/** Load all library entries. Returns [{ id, label, icon, category, createdAt, updatedAt, definition }] */
export function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save (add or update) a custom device type to the library. Returns the entry. */
export function saveToLibrary(definition, existingId = null) {
  const lib = loadLibrary();
  const now = new Date().toISOString();

  if (existingId) {
    const idx = lib.findIndex(e => e.id === existingId);
    if (idx >= 0) {
      lib[idx] = { ...lib[idx], label: definition.label, definition, updatedAt: now };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
      return lib[idx];
    }
  }

  const entry = {
    id: libUid(),
    label: definition.label || 'Custom Device',
    icon: definition.icon || '🔧',
    category: 'Custom',
    createdAt: now,
    updatedAt: now,
    definition,
  };
  lib.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  return entry;
}

/** Remove a library entry by id. */
export function removeFromLibrary(id) {
  const lib = loadLibrary().filter(e => e.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}

/** Export the entire library as a JSON string (for file download). */
export function exportLibrary() {
  return JSON.stringify(loadLibrary(), null, 2);
}

/** Import library entries from a JSON string. Merges by id; new entries are added. */
export function importLibrary(json) {
  try {
    const incoming = JSON.parse(json);
    if (!Array.isArray(incoming)) return 0;
    const lib = loadLibrary();
    let added = 0;
    for (const entry of incoming) {
      if (!entry.id || !entry.definition) continue;
      const idx = lib.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        lib[idx] = entry; // overwrite
      } else {
        lib.push(entry);
        added++;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
    return added;
  } catch {
    return 0;
  }
}
