/**
 * compiledSequence.js — client helpers for the JARVIS v1.1 Build-time
 * compiled sequence (pipeline inversion).
 *
 * Endpoints consumed (owned by the server/agentGenerator side — this file
 * only CALLS them, defensively):
 *   POST /api/jarvis/compile           { filename, smId, corrections? }
 *   POST /api/jarvis/compile/approve   { filename, smId, approved }
 *   GET  /api/jarvis/ir?filename&smId&source=compiled
 *   GET  /api/jarvis/pretranslated?filename&smId   (MAY NOT EXIST YET —
 *        feature-detected by content-type; vite/express fall through to the
 *        SPA index.html for unknown routes, so a non-JSON response = absent)
 *
 * IMPORTANT store-consistency rule: the compile/approve endpoints write
 * sm.compiledSequence into the project FILE on the server, but the client's
 * in-memory project doesn't know — and the store auto-saves the in-memory
 * project 2s after any change, which would CLOBBER the server's write.
 * Every successful compile/approve must therefore be mirrored into the
 * store immediately (mirrorCompiledSequence / mirrorApproved below).
 */

import { useDiagramStore } from '../store/useDiagramStore.js';

/** A station is compilable when it has a spec AND drawn logic. */
export function canCompile(sm) {
  return !!(sm && sm.machineSpec && (sm.nodes ?? []).length > 0);
}

/** Why a station can't compile yet — for disabled-button hints. */
export function compileBlockReason(sm) {
  if (!sm) return 'No station selected';
  const noSpec = !sm.machineSpec;
  const noNodes = (sm.nodes ?? []).length === 0;
  if (noSpec && noNodes) return 'Needs a spec and drawn logic first';
  if (noSpec) return 'Needs a station spec first (right panel → Create spec)';
  if (noNodes) return 'Needs drawn logic first';
  return null;
}

/** Write a fresh compiledSequence into the in-memory store SM (no history —
 *  this mirrors a server-side write, it is not a user diagram edit). */
export function mirrorCompiledSequence(smId, compiledSequence) {
  useDiagramStore.setState((s) => ({
    project: {
      ...s.project,
      stateMachines: (s.project?.stateMachines ?? []).map((m) =>
        m.id === smId ? { ...m, compiledSequence } : m
      ),
    },
  }));
}

/** Mirror an approve/revoke into the in-memory store SM. */
export function mirrorApproved(smId, approved) {
  useDiagramStore.setState((s) => ({
    project: {
      ...s.project,
      stateMachines: (s.project?.stateMachines ?? []).map((m) =>
        m.id === smId && m.compiledSequence
          ? {
              ...m,
              compiledSequence: {
                ...m.compiledSequence,
                approved: approved === true,
                approvedAt: approved === true ? new Date().toISOString() : null,
              },
            }
          : m
      ),
    },
  }));
}

/** GET the compiled sequence for one station.
 *  → { status: 'ok', data } | { status: 'none' } | { status: 'error', error } */
export async function fetchCompiledIr(filename, smId) {
  try {
    const r = await fetch(
      `/api/jarvis/ir?filename=${encodeURIComponent(filename)}&smId=${encodeURIComponent(smId)}&source=compiled`
    );
    if (r.status === 404) return { status: 'none' };
    if (!r.ok) {
      let msg = `Request failed (${r.status})`;
      try { msg = (await r.json()).error ?? msg; } catch { /* keep */ }
      return { status: 'error', error: msg };
    }
    return { status: 'ok', data: await r.json() };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

// ── Pretranslation (background code pre-build after approval) ──────────────
// The endpoint is being added by the backend side; until it lands, unknown
// /api routes fall through to the SPA's index.html. Feature-detect by
// content-type so the UI degrades to "not available" instead of erroring.

let pretranslatedSupported = null; // null = unknown, true/false once probed

/** GET pretranslation status for one station.
 *  → null (endpoint absent / errored) | the JSON payload.
 *  Callers should treat { ready: true, fresh: !== false } as "instant". */
export async function fetchPretranslated(filename, smId) {
  if (pretranslatedSupported === false) return null;
  try {
    const r = await fetch(
      `/api/jarvis/pretranslated?filename=${encodeURIComponent(filename)}&smId=${encodeURIComponent(smId)}`
    );
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    if (!isJson) { pretranslatedSupported = false; return null; }
    pretranslatedSupported = true;
    if (!r.ok) return null; // endpoint exists; this station just isn't ready
    return await r.json();
  } catch {
    return null;
  }
}

/** Is a pretranslated payload "code already built, Generate = instant"? */
export function isPretranslatedReady(p) {
  return !!p && p.ready === true && p.fresh !== false && p.stale !== true;
}

// ── Corrections support (edit-by-explaining) ───────────────────────────────
// The compile endpoint may not accept { corrections } yet — today it ignores
// unknown body fields, which would silently burn a compile without applying
// the notes. We detect support from the compile RESPONSE: a corrections-aware
// backend acknowledges them (meta.correctionsApplied / correctionsApplied).
// Verdict is remembered for the session; while unknown we stay optimistic
// (the box shows) but flag the first unacknowledged result honestly.

let correctionsSupport = 'unknown'; // 'unknown' | 'yes' | 'no'

export function getCorrectionsSupport() { return correctionsSupport; }

/** Inspect a compile response body for a corrections acknowledgment.
 *  Only meaningful when corrections were actually sent with the request. */
export function noteCorrectionsAck(responseBody) {
  const acked =
    responseBody?.correctionsApplied === true ||
    responseBody?.meta?.correctionsApplied === true ||
    typeof responseBody?.meta?.corrections === 'string';
  correctionsSupport = acked ? 'yes' : 'no';
  return acked;
}
