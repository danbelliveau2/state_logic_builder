/**
 * GenerationResultCard — the compact IN-PLACE result card on the Diagram page
 * (Dan, Aug 23: the Code Generation page is gone — "grab it right where you
 * made it"). When a generation for the active station completes (the generate
 * window closes), this card appears bottom-right over the canvas:
 *
 *   station · version label · verdict · ⬇ Download L5X · score /100
 *
 * plus the two things the old page uniquely rendered:
 *   - structural changes (amber, "I agree — approve")
 *   - held-build pointer → answer on the Spec Sheet (QUESTION HOME)
 *
 * Shows for a FRESH build (last 30 min) or right after the generate window
 * closes; ✕ dismisses it for the session. Full history lives in the SDC Engineer
 * pill's generations grid — the single home for past builds.
 */

import { useEffect, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { InlineScore } from '../components/jarvis/JarvisPage.jsx';
import { ensureStationSheetDraft, requestResumeDraft } from '../components/jarvis/createStationDrafts.js';
import { fmtET, fmtETFull } from './fmtTime.js';
import { buildLabel } from './buildMeta.js';

const FRESH_MS = 30 * 60 * 1000;

function noteText(n) { return typeof n === 'string' ? n : String(n?.text ?? ''); }

function verdictOf(row) {
  const ir = row.internalReview;
  // FINAL verdict, never a stale mid-loop record (Dan's v7 bug, 2026-08-25):
  // the top-level verdict / last review round wins over internalReview.
  const rounds = Array.isArray(row.reviewHistory) ? row.reviewHistory : [];
  const fin = row.verdict ?? rounds[rounds.length - 1]?.verdict ?? ir?.verdict ?? null;
  const roundsNote = rounds.length > 1 ? ` (${rounds.length} rounds)` : '';
  if (row.validationOk === false) return { text: '✗ validation failed', color: 'var(--color-danger)' };
  if (fin && fin !== 'ship') {
    const n = fin === row.internalReview?.verdict ? (ir?.findings?.length ?? '') : '';
    return { text: `⚠ internal review: ${n || 'open'} finding${n === 1 ? '' : 's'}${roundsNote}`, color: '#a07c14' };
  }
  if (row.validationOk === true) return { text: '✓ validated' + (fin === 'ship' ? ` · review: ship${roundsNote}` : ''), color: 'var(--color-success)' };
  return { text: '—', color: 'var(--color-text-light)' };
}

/** Structure changed while writing — PROMINENT amber + quick approve
 *  (migrated from the retired Code Generation page). */
function StructuralChanges({ build, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const changes = (build?.structuralChanges ?? []).filter(c => noteText(c));
  if (changes.length === 0) return null;
  const pending = changes.filter(c => c?.approved !== true);

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(build.id)}/approve-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Approve failed (${r.status})`);
      const updated = d?.id ? d : d?.build?.id ? d.build
        : { ...build, structuralChanges: changes.map(c => ({ ...c, approved: true })) };
      onUpdated(updated);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="build-structural-changes"
      style={{
        marginTop: 8, background: '#fdf6e3', border: '1px solid #e8b64c', borderRadius: 6,
        padding: '7px 10px', fontSize: 11.5, color: '#6b4e0f', lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 11, color: '#92400e', marginBottom: 3 }}>
        ⚠ Structure changed while writing{pending.length === 0 ? ' (approved)' : ''}
      </div>
      {changes.map((c, i) => (
        <div key={i}>• {noteText(c)}{c?.approved === true ? ' ✓' : ''}</div>
      ))}
      {pending.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            data-testid="build-approve-changes-btn"
            disabled={busy}
            onClick={approve}
            style={{
              background: '#b45309', color: '#fff', border: 'none', borderRadius: 5,
              fontSize: 11, fontWeight: 700, padding: '4px 12px', cursor: 'pointer',
            }}
          >{busy ? 'Saving…' : 'I agree — approve'}</button>
          {err && <span style={{ color: 'var(--color-danger)', fontSize: 10.5 }}>{err}</span>}
        </div>
      )}
    </div>
  );
}

/** Held builds POINT at the Spec Sheet — QUESTION HOME (Dan, Aug 22). */
function HeldPointer({ build, onOpenSheet }) {
  const help = build?.help;
  const n = help?.questions?.length ?? 0;
  if (!help || help.status !== 'waiting' || n === 0) return null;
  return (
    <div data-testid="build-held-pointer" style={{ marginTop: 8, fontSize: 11.5, color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px' }}>
      ⏸ Paused on {n} question{n === 1 ? '' : 's'} —{' '}
      <button
        type="button"
        data-testid="build-held-open-sheet"
        onClick={onOpenSheet}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#991b1b', fontWeight: 800, fontSize: 11.5, textDecoration: 'underline' }}
      >answer on the Spec Sheet</button>
    </div>
  );
}

export function GenerationResultCard() {
  const store = useDiagramStore();
  const project = useDiagramStore(s => s.project);
  const sm = useDiagramStore(s =>
    (s.project?.stateMachines ?? []).find(m => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const generateOpen = useV2Shell(s => s.generateOpen);
  const generateClosedBump = useV2Shell(s => s.generateClosedBump);

  const [latest, setLatest] = useState(null);
  const [dismissedId, setDismissedId] = useState(null);
  // A generate window closed THIS session → show the latest build regardless
  // of age (a long run still lands its card the moment you close the window).
  const [bumpAtMount] = useState(generateClosedBump);

  useEffect(() => {
    if (!sm) { setLatest(null); return undefined; }
    let alive = true;
    fetch('/api/jarvis/generations')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d) return;
        const rows = (d.builds ?? [])
          .filter(b => b.sm === sm.name && (!project?.name || !b.project || b.project === project.name))
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        setLatest(rows[0] ?? null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [sm?.id, sm?.name, project?.name, generateClosedBump]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sm || !latest || generateOpen) return null;
  if (dismissedId === latest.id) return null;
  // Fresh results only — the full history lives in the SDC Engineer pill's grid.
  const age = Date.now() - new Date(latest.at ?? 0).getTime();
  const closedThisSession = generateClosedBump > bumpAtMount;
  if (!closedThisSession && (!Number.isFinite(age) || age > FRESH_MS)) return null;

  const v = verdictOf(latest);

  function openSheet() {
    const draft = ensureStationSheetDraft(useDiagramStore.getState(), sm);
    requestResumeDraft(draft.draftId);
    useV2Shell.getState().setSheetLinkedSmId(sm.id);
    store.openNewSmModal();
  }

  return (
    <div
      data-testid="generation-result-card"
      style={{
        position: 'absolute', right: 16, bottom: 16, zIndex: 40, width: 340,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderLeft: '3px solid var(--color-primary)', borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)', padding: '10px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text)' }}>{sm.displayName ?? sm.name}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-primary)', background: '#e8f0fa', borderRadius: 3, padding: '1px 8px' }} title={String(latest.filePath || '')}>
          {buildLabel(latest)}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--color-text-light)' }} title={fmtETFull(latest.at)}>{fmtET(latest.at)}</span>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="generation-result-dismiss"
          onClick={() => setDismissedId(latest.id)}
          title="Dismiss — it stays in the SDC Engineer pill's history"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1, padding: '0 2px' }}
        >✕</button>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: v.color, marginBottom: 6 }}>{v.text}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <a
          data-testid="generation-result-l5x"
          href={`/api/jarvis/builds/${encodeURIComponent(latest.id)}/file`}
          download
          style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none' }}
        >⬇ Download L5X</a>
        <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>Score /100:</span>
        <InlineScore row={latest} onUpdated={setLatest} />
      </div>
      <HeldPointer build={latest} onOpenSheet={openSheet} />
      <StructuralChanges build={latest} onUpdated={setLatest} />
    </div>
  );
}
