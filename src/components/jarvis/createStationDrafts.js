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

import { DEVICE_TYPES } from '../../lib/deviceTypes.js';

const RESUME_KEY = 'jarvis.resumeDraftId';
const CHANGE_EVENT = 'jarvis-drafts-changed';

export function draftsKeyFor(store) {
  const projectKey = store.currentFilename || store.project?.name || 'default';
  return `jarvis.createStationDrafts.${projectKey}`;
}

export function newDraftId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** FNV-1a over an image's base64 payload — the image's content identity for
 *  union-by-hash merging (same function as server.js sheetImgHash). Images
 *  NEVER get silently dropped; merges are additive, keyed by this. */
export function imgHash(b64) {
  const s = String(b64 || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + '_' + s.length.toString(36);
}

/** Union two image lists by content hash — `base` order first, additions
 *  appended. Never drops anything. */
export function unionImages(base, extra) {
  const out = [];
  const seen = new Set();
  for (const img of [...(base ?? []), ...(extra ?? [])]) {
    if (!img || typeof img.base64 !== 'string' || !img.base64) continue;
    const h = imgHash(img.base64);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(img);
  }
  return out;
}

function notifyChanged() {
  // Deferred: saveDraft/deleteDraft may run during a component's render
  // (e.g. CreateStationPage's embedded self-heal) — a synchronous dispatch
  // would setState in listeners mid-render. A macrotask keeps it safe.
  try { setTimeout(() => window.dispatchEvent(new CustomEvent(CHANGE_EVENT)), 0); } catch { /* noop */ }
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
  // A draft stamped for ANOTHER project never renders here — re-file it
  // into its own bucket (never deleted; its project's page shows it).
  const strays = arr.filter(d => d && d.projectKey && d.projectKey !== key);
  if (strays.length) {
    try {
      for (const d of strays) {
        const other = JSON.parse(localStorage.getItem(d.projectKey) || '[]');
        if (!other.some(x => x.draftId === d.draftId)) {
          other.push(d);
          localStorage.setItem(d.projectKey, JSON.stringify(other));
        }
      }
      arr = arr.filter(d => !(d && d.projectKey && d.projectKey !== key));
      localStorage.setItem(key, JSON.stringify(arr));
    } catch { /* storage unavailable — filter below still hides them */ }
  }
  return arr
    .filter(d => d && d.v === 1 && d.draftId)
    .filter(d => !d.projectKey || d.projectKey === key)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/** Upsert one draft (by draftId). Returns false when storage failed. */
export function saveDraft(key, draft) {
  if (!draft || !draft.draftId) return false;
  try {
    // PROJECT-SCOPED DRAFTS (Dan, 2026-09-01: other projects' drafts showed
    // on Magnet Dial v3's homepage): every draft carries its owning bucket.
    draft = { ...draft, projectKey: key };
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

/** Read a pending resume request WITHOUT clearing it — safe to call during
 *  render (StrictMode double-invokes render; a destructive read there loses
 *  the request on the second pass). Pair with consumeResumeRequest() in a
 *  mount effect to clear. */
export function peekResumeRequest() {
  try { return sessionStorage.getItem(RESUME_KEY) || null; } catch { return null; }
}

/** CreateStationPage mount: read + clear any pending resume request. */
export function consumeResumeRequest() {
  try {
    const id = sessionStorage.getItem(RESUME_KEY);
    if (id) sessionStorage.removeItem(RESUME_KEY);
    return id || null;
  } catch { return null; }
}

// ── Remount resilience (Dan, Aug 24: an HMR reload mid-dictation remounted
// CreateStationPage and blanked the form) ────────────────────────────────────
// The FRESH create page marks which draft it has open (refreshed on every
// autosave). A remount — HMR, error-boundary recovery, shell re-key — within
// this window silently resumes that exact draft. Explicit exits (← Back,
// Build, Open the Station) clear the marker, so "+ New Station" still ALWAYS
// opens blank (Dan's rule at the top of this file is untouched: this resumes
// only a draft that was open moments ago and never closed).
const ACTIVE_KEY = 'jarvis.activeFreshDraft';
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

export function markActiveFreshDraft(key, draftId) {
  try { sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ key, draftId, at: Date.now() })); } catch { /* noop */ }
}

export function clearActiveFreshDraft() {
  try { sessionStorage.removeItem(ACTIVE_KEY); } catch { /* noop */ }
}

/** The draftId to silently resume after a remount — only when the marker
 *  belongs to THIS project's draft store and is fresh (≤10 min). */
export function peekActiveFreshDraft(key) {
  try {
    const m = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || 'null');
    if (!m || m.key !== key || !m.draftId) return null;
    if (Date.now() - (Number(m.at) || 0) > ACTIVE_WINDOW_MS) return null;
    return m.draftId;
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

// ── Station Specs — the living data sheet for a BUILT station ───────────────
//
// "Station Specs" on the canvas must ALWAYS open the full developed sheet
// (summary phase: device cards with values, servo tables, IO lists) — never
// the raw describe phase (Dan, Aug 2026: "I want the full thing").
//
// A station built since drafts-persist-with-smId has its linked draft ready.
// Older stations get their sheet RECONSTRUCTED from the built SM itself
// (machineSpec.sourceDescription / devicePurposes / outcomeRules /
// relationships / io + the devices' sensor arrangements, timers, positions,
// speed profiles + the drawn sequence), optionally adopting the RICHEST
// matching stale draft from earlier attempts; matching stale drafts are then
// absorbed (deleted) so they never show as "unfinished drafts" again.

const PNEUMATIC_TYPES = ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper'];
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function isStructured(s) {
  return !!s && typeof s === 'object'
    && Array.isArray(s.devices) && Array.isArray(s.sequence)
    && Array.isArray(s.failureHandling) && Array.isArray(s.interactions);
}
function hasContent(s) {
  return isStructured(s)
    && (s.devices.length > 0 || s.sequence.length > 0
      || s.failureHandling.length > 0 || s.interactions.length > 0);
}

/** Build a structured sheet summary from a BUILT state machine. */
export function reconstructSummaryFromSm(sm) {
  const spec = (sm.machineSpec && typeof sm.machineSpec === 'object') ? sm.machineSpec : {};
  const purposes = (spec.devicePurposes && typeof spec.devicePurposes === 'object') ? spec.devicePurposes : {};

  const devices = (sm.devices ?? []).map(d => {
    const displayName = d.displayName || d.name;
    const out = {
      name: displayName,
      type: d.type,
      purpose: purposes[d.name] ?? purposes[displayName] ?? (DEVICE_TYPES[d.type]?.label ?? ''),
    };
    if (PNEUMATIC_TYPES.includes(d.type)) {
      if (d.sensorArrangement) out.sensorArrangement = d.sensorArrangement;
      const isGrip = d.type === 'PneumaticGripper';
      const ext = isGrip ? d.engageTimerMs : d.extTimerMs;
      const ret = isGrip ? d.disengageTimerMs : d.retTimerMs;
      const delays = {};
      if (ext != null) delays.extendMs = Number(ext);
      if (ret != null) delays.retractMs = Number(ret);
      if (Object.keys(delays).length) out.delays = delays;
      if (d.strokeMm != null) out.strokeMm = d.strokeMm;
    }
    if (d.type === 'ServoAxis') {
      out.positions = (d.positions ?? []).map(p => ({
        name: p.name,
        ...(p.defaultValue != null && p.defaultValue !== '' ? { valueMm: Number(p.defaultValue) } : {}),
      }));
      const speeds = {};
      for (const sp of d.speedProfiles ?? []) {
        if (/fast/i.test(sp.name) && Number(sp.speed) > 0) speeds.fastMmS = Number(sp.speed);
        if (/slow/i.test(sp.name) && Number(sp.speed) > 0) speeds.slowMmS = Number(sp.speed);
      }
      if (Object.keys(speeds).length) out.speeds = speeds;
    }
    return out;
  });

  const ordered = (sm.nodes ?? [])
    .filter(n => n.type !== 'decisionNode')
    .sort((a, b) => ((a.position?.y ?? 0) - (b.position?.y ?? 0)) || ((a.position?.x ?? 0) - (b.position?.x ?? 0)));
  const sequence = ordered
    .filter(n => !n.data?.isInitial && !n.data?.isComplete)
    .map(n => n.data?.label)
    .filter(Boolean);

  const failureHandling = (Array.isArray(spec.outcomeRules) ? spec.outcomeRules : [])
    .map(r => ({
      when: r.trigger ?? r.when ?? '',
      then: r.response ?? r.then ?? '',
      ...(r.retryCount != null && r.retryCount !== '' ? { retries: r.retryCount } : {}),
      ...(String(r.escalation ?? '').trim() ? { whenExhausted: r.escalation } : {}),
    }))
    .filter(f => f.when || f.then);

  const interactions = (Array.isArray(spec.relationships) ? spec.relationships : [])
    .map(r => ({
      station: r.withSmName ?? r.station ?? '',
      how: [r.kind, r.detail ?? r.how ?? r.description].filter(Boolean).join(' — '),
    }))
    .filter(x => x.station || x.how);

  const io = (spec.io && typeof spec.io === 'object') ? spec.io : undefined;
  return { devices, sequence, failureHandling, interactions, ...(io ? { io } : {}) };
}

/** Merge the built SM's device truth into a sheet summary's device rows —
 *  fills only what's MISSING on the sheet (the ME's sheet entries win),
 *  appends devices the sheet doesn't know. `recon` is the SM-derived
 *  summary from reconstructSummaryFromSm.
 *
 *  DEVICE IDENTITY (the ServoPNP double-gripper incident, Aug 2026): exact
 *  normalized name first, then contains-fuzz (Gripper / Part_Gripper /
 *  PartGripper are the SAME device), then — when the sheet holds exactly ONE
 *  unmatched device of the same type — union into that card. The SM merge
 *  must NEVER introduce a same-type twin next to an existing unmatched card;
 *  a fuzzy match also adopts the SM's canonical name so the next open
 *  matches exactly. */
/** Merge one sheet row's fields into another (kept row's values win). */
function unionDeviceRow(keep, extra) {
  if (!keep.type && extra.type) keep.type = extra.type;
  if (!keep.purpose && extra.purpose) keep.purpose = extra.purpose;
  if (keep.sensorArrangement == null && extra.sensorArrangement) keep.sensorArrangement = extra.sensorArrangement;
  if (keep.strokeMm == null && extra.strokeMm != null) keep.strokeMm = extra.strokeMm;
  if (extra.delays) keep.delays = { ...extra.delays, ...(keep.delays ?? {}) };
  if (extra.speeds) keep.speeds = { ...extra.speeds, ...(keep.speeds ?? {}) };
  if (extra.positions?.length) {
    const positions = (keep.positions ?? []).map(p => ({ ...p }));
    for (const sp of extra.positions) {
      const pr = positions.find(p => normName(p.name) === normName(sp.name));
      if (!pr) positions.push({ ...sp });
      else if ((pr.valueMm == null || pr.valueMm === '') && sp.valueMm != null) pr.valueMm = sp.valueMm;
    }
    keep.positions = positions;
  }
  return keep;
}

/** SELF-HEAL for ALREADY-DUPLICATED twins (Dan's live browser state, Aug 24:
 *  a sheet holding BOTH "Gripper" and "Part_Gripper"). The SM-merge below
 *  only PREVENTS new twins — this pass collapses twins the sheet already
 *  carries: rows whose normalized names contain each other (same type, or a
 *  type missing) are ONE device. The more specific name wins; every filled
 *  field survives the merge. */
export function dedupeSheetDevices(rows) {
  const out = [];
  for (const r of rows ?? []) {
    const k = normName(r?.name);
    const hit = k ? out.find(o => {
      const ok = normName(o.name);
      if (!ok) return false;
      if ((o.type ?? null) && (r.type ?? null) && o.type !== r.type) return false;
      return ok === k || ok.includes(k) || k.includes(ok);
    }) : null;
    if (!hit) { out.push({ ...r }); continue; }
    if (k.length > normName(hit.name).length) hit.name = r.name; // specific name wins
    unionDeviceRow(hit, r);
  }
  return out;
}

function mergeSmDevices(summary, recon) {
  const rows = dedupeSheetDevices(summary.devices ?? []);
  const claimed = new Set(); // row indexes already bound to an SM device
  const findRowFor = (smDev) => {
    const key = normName(smDev.name);
    let i = rows.findIndex((r, j) => !claimed.has(j) && normName(r.name) === key);
    if (i === -1) {
      i = rows.findIndex((r, j) => {
        if (claimed.has(j)) return false;
        const k = normName(r.name);
        return !!k && (k.includes(key) || key.includes(k));
      });
    }
    if (i === -1 && smDev.type) {
      const sameType = rows
        .map((r, j) => ({ r, j }))
        .filter(({ r, j }) => !claimed.has(j) && (r.type ?? null) === smDev.type);
      if (sameType.length === 1) i = sameType[0].j;
    }
    if (i === -1) return null;
    claimed.add(i);
    return { row: rows[i], exact: normName(rows[i].name) === key };
  };
  for (const smDev of recon.devices) {
    const hit = findRowFor(smDev);
    if (!hit) { rows.push({ ...smDev }); continue; }
    const { row, exact } = hit;
    // Canonical identity: the diagram references the SM device — a fuzzy
    // match renames the card to the SM's display name (values untouched).
    if (!exact && smDev.name) row.name = smDev.name;
    if (!row.type) row.type = smDev.type;
    if (!row.purpose && smDev.purpose) row.purpose = smDev.purpose;
    if (row.sensorArrangement == null && smDev.sensorArrangement) row.sensorArrangement = smDev.sensorArrangement;
    if (row.strokeMm == null && smDev.strokeMm != null) row.strokeMm = smDev.strokeMm;
    if (smDev.delays) row.delays = { ...smDev.delays, ...(row.delays ?? {}) };
    if (smDev.speeds) row.speeds = { ...smDev.speeds, ...(row.speeds ?? {}) };
    if (smDev.positions?.length) {
      const positions = (row.positions ?? []).map(p => ({ ...p }));
      for (const sp of smDev.positions) {
        const pr = positions.find(p => normName(p.name) === normName(sp.name));
        if (!pr) positions.push({ ...sp });
        else if ((pr.valueMm == null || pr.valueMm === '') && sp.valueMm != null) pr.valueMm = sp.valueMm;
      }
      // MIGRATED corner blends (Dan's sketch, Aug 24): drop a legacy
      // {Level}WideBand sheet row once the axis carries both corner rows —
      // its value already seeded Pick/Place{Level}Blend.
      const smNames = new Set(smDev.positions.map(p => normName(p.name)));
      row.positions = positions.filter(p => {
        const m = String(p?.name ?? '').match(/^(.+)WideBand$/i);
        return !(m && !/transition/i.test(m[1]) && !smNames.has(normName(p.name))
          && smNames.has(normName(`Pick${m[1]}Blend`)) && smNames.has(normName(`Place${m[1]}Blend`)));
      });
    }
  }
  return { ...summary, devices: rows };
}

/**
 * Find-or-build the linked living data sheet for a built SM, ALWAYS in the
 * summary phase. Adopts the richest matching stale (unlinked) draft when the
 * linked one is missing/raw, merges the SM's device truth in, persists, and
 * absorbs the matching stale drafts. Returns the draft to resume.
 */
export function ensureStationSheetDraft(storeState, sm) {
  const key = draftsKeyFor(storeState);
  const all = loadDrafts(key);
  const linked = all.find(d => d.smId === sm.id) ?? null;
  const smNames = new Set([normName(sm.name), normName(sm.displayName)].filter(Boolean));
  const stale = all.filter(d => !d.smId && smNames.has(normName(d.name)));

  if (linked && hasContent(linked.summary) && linked.phase === 'summary') {
    // The SM is the device authority: a device added to the built station
    // (e.g. a nest PartPresent sensor) surfaces on the living sheet the next
    // time it opens — fills only what's MISSING, the ME's sheet entries win.
    const withSm = mergeSmDevices(linked.summary, reconstructSummaryFromSm(sm));
    const summaryChanged = JSON.stringify(withSm.devices) !== JSON.stringify(linked.summary.devices);
    // Absorb twins — but NEVER their pictures (Aug 24 loss: a CAD image
    // pasted into a twin draft was deleted with it). Their images merge into
    // the linked sheet, and their draftIds are remembered so hydration also
    // pulls their SERVER image sets.
    if (stale.length || summaryChanged) {
      const absorbed = new Set([...(linked.absorbedDraftIds ?? []), ...stale.map(d => d.draftId)]);
      const merged = {
        ...linked,
        savedAt: Date.now(),
        summary: withSm,
        images: unionImages(linked.images, stale.flatMap(d => d.images ?? [])),
        absorbedDraftIds: [...absorbed],
      };
      saveDraft(key, merged);
      for (const d of stale) deleteDraft(key, d.draftId);
      return merged;
    }
    return linked;
  }

  // Richest source wins: score stale candidates on developed content.
  const score = (d) => {
    let n = 0;
    if (hasContent(d.summary)) {
      n += 100 + d.summary.devices.length * 5 + d.summary.sequence.length * 2
        + d.summary.failureHandling.length + d.summary.interactions.length;
    }
    n += Math.min(String(d.description || '').length / 40, 20);
    if (d.images?.length) n += 5;
    return n;
  };
  const best = stale.slice().sort((a, b) => score(b) - score(a))[0] ?? null;

  const recon = reconstructSummaryFromSm(sm);
  const base = (best && hasContent(best.summary)) ? best.summary
    : (linked && hasContent(linked.summary)) ? linked.summary
    : recon;
  const summary = mergeSmDevices(base, recon);

  const spec = sm.machineSpec ?? {};
  const draft = {
    draftId: linked?.draftId ?? newDraftId(),
    v: 1,
    savedAt: Date.now(),
    smId: sm.id,
    name: sm.displayName || sm.name || best?.name || '',
    station: sm.stationNumber ?? best?.station ?? 1,
    description: String(linked?.description || '').trim()
      || String(best?.description || '').trim()
      || spec.sourceDescription || sm.description || '',
    // ADDITIVE image merge — the linked sheet's, plus every stale twin's
    // (pictures are spec and persist forever; nothing is ever dropped here).
    images: unionImages(linked?.images, stale.flatMap(d => d.images ?? [])),
    absorbedDraftIds: [...new Set([
      ...(linked?.absorbedDraftIds ?? []),
      ...stale.map(d => d.draftId),
    ])],
    phase: 'summary',
    summary,
    questions: (best?.questions?.length ? best.questions : spec.pendingQuestions) ?? [],
    nonStandardFlags: (best?.nonStandardFlags?.length ? best.nonStandardFlags : spec.nonStandardFlags) ?? [],
    jarvisCoverage: best?.jarvisCoverage ?? linked?.jarvisCoverage ?? null,
    summarizeCost: best?.summarizeCost ?? linked?.summarizeCost ?? 0,
  };
  saveDraft(key, draft);
  for (const d of stale) deleteDraft(key, d.draftId); // absorbed into the sheet
  return draft;
}
