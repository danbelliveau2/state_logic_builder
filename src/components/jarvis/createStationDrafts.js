/**
 * createStationDrafts — per-project MULTI-draft store for CreateStationPage.
 *
 * localStorage['jarvis.createStationDrafts.{projectKey}'] = [
 *   { draftId, v: 1, savedAt, name, station, description, images, phase,
 *     summary, jarvisCoverage, questions, nonStandardFlags, summarizeCost }
 * ]
 *
 * Dan's rule: "+ New Station" ALWAYS opens blank — no silent restore, ever.
 * Unfinished drafts are LISTED (banner on the fresh page + "Drafts (N)" row
 * in StationsPanel) and resumed explicitly. The legacy single-draft key
 * (jarvis.createStationDraft.{projectKey}) is migrated on first read.
 *
 * Resume handoff between StationsPanel and CreateStationPage rides in
 * sessionStorage and is consumed once on page mount.
 */

const RESUME_KEY = 'jarvis.resumeDraftId';
const CHANGE_EVENT = 'jarvis-drafts-changed';

export function draftsKeyFor(store) {
  const projectKey = store.currentFilename || store.project?.name || 'default';
  return `jarvis.createStationDrafts.${projectKey}`;
}

export function newDraftId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function notifyChanged() {
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch { /* noop */ }
}

/** Subscribe to draft-store changes (returns an unsubscribe fn). */
export function onDraftsChanged(fn) {
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}

/** Load every draft for a project key (newest saved first), migrating the
 *  legacy single-draft key when present. */
export function loadDrafts(key) {
  let arr;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    arr = Array.isArray(parsed) ? parsed : [];
  } catch { arr = []; }
  // One-time migration of the legacy single-draft key.
  try {
    const legacyKey = key.replace('createStationDrafts', 'createStationDraft');
    const legacyRaw = legacyKey !== key ? localStorage.getItem(legacyKey) : null;
    if (legacyRaw) {
      try {
        const d = JSON.parse(legacyRaw);
        if (d && d.v === 1) arr = [...arr, { draftId: newDraftId(), ...d }];
      } catch { /* unreadable legacy draft — drop it */ }
      localStorage.removeItem(legacyKey);
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch { /* storage unavailable */ }
  return arr
    .filter(d => d && d.v === 1 && d.draftId)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/** Upsert one draft (by draftId). Returns false when storage failed. */
export function saveDraft(key, draft) {
  if (!draft || !draft.draftId) return false;
  try {
    const arr = loadDrafts(key);
    const i = arr.findIndex(d => d.draftId === draft.draftId);
    if (i === -1) arr.push(draft); else arr[i] = draft;
    localStorage.setItem(key, JSON.stringify(arr));
    notifyChanged();
    return true;
  } catch {
    return false;
  }
}

export function deleteDraft(key, draftId) {
  try {
    const arr = loadDrafts(key).filter(d => d.draftId !== draftId);
    if (arr.length) localStorage.setItem(key, JSON.stringify(arr));
    else localStorage.removeItem(key);
    notifyChanged();
  } catch { /* noop */ }
}

/** StationsPanel → CreateStationPage: resume this draft on next mount. */
export function requestResumeDraft(draftId) {
  try { sessionStorage.setItem(RESUME_KEY, draftId); } catch { /* noop */ }
}

/** CreateStationPage mount: read + clear any pending resume request. */
export function consumeResumeRequest() {
  try {
    const id = sessionStorage.getItem(RESUME_KEY);
    if (id) sessionStorage.removeItem(RESUME_KEY);
    return id || null;
  } catch { return null; }
}

/** Display label for a draft chip/row. */
export function draftLabel(d) {
  const name = String(d?.name || '').trim();
  if (name) return name;
  const words = String(d?.description || '').trim().split(/\s+/).slice(0, 4).join(' ');
  return words || '(untitled draft)';
}

/** Compact "10 min ago / yesterday" stamp. */
export function timeAgo(ts) {
  const ms = Date.now() - (Number(ts) || 0);
  if (!Number.isFinite(ms) || ms < 0 || !ts) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
