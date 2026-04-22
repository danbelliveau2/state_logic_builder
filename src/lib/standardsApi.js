/**
 * Standards API — fetch wrapper for the shared standards library.
 *
 * The server-backed library lives at `/api/standards` and is a single
 * JSON array of standards shared across every client hitting the same
 * server. See server.js for the backing file + auto-backup behavior.
 *
 * Endpoints:
 *   GET    /api/standards        → array of standards
 *   POST   /api/standards        → replace entire library (body: array)
 *   POST   /api/standards/:id    → upsert single standard (body: object)
 *   DELETE /api/standards/:id    → remove single standard by id
 */

const API_BASE = '/api/standards';

/** Fetch the entire library from the server. Throws on network or HTTP error
 *  so callers can differentiate offline-mode from an empty library. */
export async function fetchStandards() {
  const res = await fetch(API_BASE, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to list standards: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Server returned non-array');
  return data;
}

/** Replace the entire library. Used for bulk import / factory reset flows. */
export async function replaceStandards(arr) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arr, null, 2),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to replace standards: ${res.status}`);
  }
  return res.json();
}

/** Create-or-update a single standard by id. The server uses the id in the
 *  URL path as authoritative — the body's id field is ignored if mismatched. */
export async function upsertStandard(id, standard) {
  if (!id) throw new Error('upsertStandard requires an id');
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(standard, null, 2),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to upsert standard: ${res.status}`);
  }
  return res.json();
}

/** Remove a single standard by id. 404 (already deleted) is swallowed so
 *  callers don't have to special-case the common race where two clients
 *  delete the same row. */
export async function deleteStandardById(id) {
  if (!id) throw new Error('deleteStandardById requires an id');
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (res.status === 404) return { ok: true, alreadyGone: true };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete standard: ${res.status}`);
  }
  return res.json();
}

/** Quick health probe — is the standards endpoint reachable? Used by the
 *  library loader on boot to decide between server mode and cache mode. */
export async function isStandardsApiAvailable() {
  try {
    const res = await fetch(API_BASE, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
