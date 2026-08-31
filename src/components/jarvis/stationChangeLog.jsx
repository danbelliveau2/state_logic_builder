/**
 * stationChangeLog.jsx — the per-station CHANGE LOG (Dan, 2026-08-25: "this is
 * my version control view"). One line per APPLIED change: when, what, a class
 * chip, cost. Collapsible, newest first.
 *
 * TWO SOURCES, merged (both tolerant):
 *   1. LOCAL — machineSpec.changeLog entries this client appends the moment a
 *      change actually lands (approved section edits, SM-split approval,
 *      device renames, applied corrections). Shape:
 *        { at: ISO, what, class: 'value'|'section'|'replan', replanned?, costUSD?, by? }
 *   2. SERVER — the edit-classifier agent's changeLog API (module not landed
 *      yet — feature-detected; a non-JSON/404 response = absent, quietly).
 *      GET /api/jarvis/changelog?filename&smId → { entries: [same shape] }
 *
 * CLASS ROUTING client: classifyEditRequest() posts a scoped edit to the
 * classifier route when it exists (POST /api/jarvis/edit/classify). Absent →
 * null, and the caller falls back to the standard agentic corrections path.
 */

import { useEffect, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';

const str = (v) => String(v ?? '').trim();

/** Local entries, tolerant, NEWEST FIRST. Reads BOTH shapes: this client's
 *  ({what, class, replanned, costUSD}) and the server classifier's
 *  (server.js appendChangeLog_: {what, class, scope, cost}). */
export function localChangeLogOf(sm) {
  return (sm?.machineSpec?.changeLog ?? [])
    .filter((e) => e && typeof e === 'object' && (e.what || e.text))
    .map((e) => {
      const cost = Number(e.costUSD ?? e.cost);
      return {
        at: str(e.at) || null,
        what: str(e.what ?? e.text),
        class: str(e.class ?? e.kind) || 'section',
        replanned: str(e.replanned ?? e.replannedSm ?? e.machine) || null,
        scope: str(e.scope) || null,
        costUSD: Number.isFinite(cost) ? cost : null,
        by: str(e.by) || 'ME',
      };
    })
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

/** Append one applied-change entry onto machineSpec.changeLog (persists with
 *  the project). Never throws — the log must never block the change itself. */
export function appendChangeLog(smId, entry) {
  try {
    const st = useDiagramStore.getState();
    const sm = st.project?.stateMachines?.find((m) => m.id === smId);
    if (!sm) return;
    const spec = sm.machineSpec ?? { version: 1 };
    st.updateStateMachine(smId, {
      machineSpec: {
        ...spec,
        changeLog: [
          ...(spec.changeLog ?? []),
          { at: new Date().toISOString(), by: 'ME', ...entry },
        ],
      },
    });
  } catch { /* the log never blocks the change */ }
}

/** The class chip's label — Dan's vocabulary. Covers this client's classes
 *  AND the server classifier's (value/section/structural-sm/decomposition/
 *  compile). */
export function classChipLabel(e) {
  if (e.class === 'value') return 'value — instant';
  if (e.class === 'replan' || e.class === 'structural-sm') {
    return e.replanned ? `re-planned ${e.replanned}` : 're-planned';
  }
  if (e.class === 'decomposition') return 'full compile';
  if (e.class === 'compile') return 'compile';
  if (e.class === 'rename') return 'rename';
  if (e.class === 'approval') return 'approval';
  return 'section';
}

const CHIP_TONES = {
  value: { color: '#0f766e', background: '#ecfdf5', border: '1px solid #a7f3d0' },
  section: { color: '#1d4ed8', background: '#e8f0fa', border: '1px solid #a8c8e8' },
  replan: { color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8' },
  'structural-sm': { color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8' },
  decomposition: { color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8' },
  compile: { color: '#475569', background: '#f1f5f9', border: '1px solid #cbd5e1' },
  rename: { color: '#475569', background: '#f1f5f9', border: '1px solid #cbd5e1' },
  approval: { color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #bfe0c8' },
};

// ── Edit-classifier agent (server-side; graceful while absent) ──────────────

let classifierSupported = null; // null = unknown, true/false once probed
let changelogApiSupported = null;

/** POST the scoped edit to the classifier route. → its JSON payload, or null
 *  when the route doesn't exist yet / errors (caller falls back). */
export async function classifyEditRequest(payload) {
  if (classifierSupported === false) return null;
  try {
    const r = await fetch('/api/jarvis/edit/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    if (!isJson || r.status === 404) { classifierSupported = false; return null; }
    classifierSupported = true;
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** GET the classifier agent's per-station change log. null when absent. */
export async function fetchServerChangeLog(filename, smId) {
  if (changelogApiSupported === false) return null;
  try {
    const r = await fetch(
      `/api/jarvis/changelog?filename=${encodeURIComponent(filename ?? '')}&smId=${encodeURIComponent(smId ?? '')}`
    );
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    if (!isJson || r.status === 404) { changelogApiSupported = false; return null; }
    changelogApiSupported = true;
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d?.entries) ? d.entries : Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

function fmtWhen(at) {
  const t = Date.parse(at);
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hm}`;
}

/**
 * The panel. Collapsible (starts open when it has entries), newest first,
 * one line per change: when · what · class chip · cost. Grows — the no-scroll
 * law applies (this is not a chat thread).
 */
// bare (Dan, 2026-08-31): entries only — the uniform SectionBar outside owns
// the header/fold; no inner toggle, no floating log line.
export function ChangeLogPanel({ sm, bare = false }) {
  const [open, setOpen] = useState(true);
  const [serverEntries, setServerEntries] = useState(null);
  const filename = useDiagramStore((s) => s.currentFilename);

  useEffect(() => {
    if (!sm?.id) return undefined;
    let alive = true;
    fetchServerChangeLog(filename, sm.id).then((e) => { if (alive && e) setServerEntries(e); });
    return () => { alive = false; };
  }, [sm?.id, filename, (sm?.machineSpec?.changeLog ?? []).length]);

  if (!sm) return null;
  const local = localChangeLogOf(sm);
  const seen = new Set(local.map((e) => `${e.at}|${e.what}`));
  const merged = [
    ...local,
    ...(serverEntries ?? [])
      .map((e) => ({
        at: str(e.at), what: str(e.what ?? e.text), class: str(e.class ?? e.kind) || 'section',
        replanned: str(e.replanned) || null,
        costUSD: Number.isFinite(Number(e.costUSD)) ? Number(e.costUSD) : null,
        by: str(e.by) || 'Jarvis',
      }))
      .filter((e) => e.what && !seen.has(`${e.at}|${e.what}`)),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));

  if (!merged.length) return null;

  return (
    <div data-testid="station-changelog" style={bare ? undefined : { marginTop: 10, marginBottom: 8 }}>
      {!bare && (
      <button
        type="button"
        data-testid="station-changelog-toggle"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Collapse' : 'Every change applied to this station — your version control view'}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
        }}
      >
        {open ? '▾' : '▸'} Change log ({merged.length})
      </button>
      )}
      {(bare || open) && (
        <div style={{ marginTop: 4 }}>
          {merged.map((e, i) => {
            const tone = CHIP_TONES[e.class] ?? CHIP_TONES.section;
            return (
              <div
                key={`${e.at}-${i}`}
                data-testid={`changelog-entry-${i}`}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11.5, lineHeight: 1.6, minWidth: 0 }}
              >
                <span style={{ color: 'var(--color-text-light)', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'Consolas, monospace', fontSize: 10.5 }}>
                  {fmtWhen(e.at)}
                </span>
                <span title={e.scope || undefined} style={{ color: 'var(--color-text)', minWidth: 0, overflowWrap: 'anywhere' }}>{e.what}</span>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, borderRadius: 6, padding: '0 7px',
                  whiteSpace: 'nowrap', flexShrink: 0, ...tone,
                }}>{classChipLabel(e)}</span>
                {e.costUSD != null && e.costUSD > 0 && (
                  <span style={{ color: 'var(--color-text-light)', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'Consolas, monospace', fontSize: 10.5 }}>
                    ${e.costUSD.toFixed(2)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
