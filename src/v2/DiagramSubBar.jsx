/**
 * DiagramSubBar — the Diagram page's ONE slim sub-row, IN-FLOW below the
 * StationBanner (never floats over content, so it cannot overlap anything at
 * any width):
 *
 *   [ Sequence | Controls detail ]  compiled date · counts  (legend | ⓘ) … [Approve]
 *
 * Dan (Aug 22, hard rejection of the plan panel): "the diagram page is the
 * diagram" — this row and the diagram are ALL the page carries. The approve
 * control is the single small action; questions live on the SPEC SHEET;
 * assumptions/standards live with the build on the SDC Engineer page.
 *
 * Legend chips render only when the row has room (CSS media query — hidden
 * under 1400px, replaced by an ⓘ with the legend as its tooltip).
 */

import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { canCompile, compileBlockReason, mirrorApproved } from './compiledSequence.js';
import { fmtET } from './fmtTime.js';

const LEGEND_TIP =
  'Controls detail legend:\n• blue = main sequence\n• dashed gray = synthesized confirm\n• amber = fault / init / recovery\n• blue edges = wait / handshake';

// ── Slim approve — the ONE control on the page ──────────────────────────────
function SlimApprove({ sm }) {
  const filename = useDiagramStore((s) => s.currentFilename);
  const openCompile = useV2Shell((s) => s.openCompile);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const cs = sm?.compiledSequence ?? null;
  const approved = cs?.approved === true;

  async function setApproved(next) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/jarvis/compile/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, smId: sm.id, approved: next }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Approve failed (${r.status})`);
      mirrorApproved(sm.id, d?.approved === true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!sm) return null;

  if (!cs) {
    const ok = canCompile(sm);
    return (
      <button
        type="button"
        className="v2-diagbar__action v2-diagbar__action--compile"
        data-testid="diagbar-compile-btn"
        disabled={!ok}
        title={ok
          ? 'Compile the sequence — SDC Engineer thinks the full sequence through once (~4 min)'
          : (compileBlockReason(sm) ?? 'Draw or build the station first')}
        onClick={() => ok && openCompile(sm.id)}
      >⚙ Compile</button>
    );
  }

  return (
    <span className="v2-diagbar__approve-wrap">
      {err && <span className="v2-diagbar__err" title={err}>!</span>}
      {approved ? (
        <span className="v2-diagbar__approved" data-testid="diagbar-approved" title="Approved — Generate runs as a fast translation. Click ✕ to revoke.">
          ✓ Approved
          <button
            type="button"
            className="v2-diagbar__revoke"
            data-testid="diagbar-revoke-btn"
            disabled={busy}
            title="Revoke approval"
            onClick={() => setApproved(false)}
          >✕</button>
        </span>
      ) : (
        <button
          type="button"
          className="v2-diagbar__action v2-diagbar__action--approve"
          data-testid="diagbar-approve-btn"
          disabled={busy}
          title="I agree with this sequence — SDC Engineer pre-builds the code so Generate is instant"
          onClick={() => setApproved(true)}
        >{busy ? 'Saving…' : '✓ Approve'}</button>
      )}
    </span>
  );
}

// ── The bar ─────────────────────────────────────────────────────────────────
export function DiagramSubBar() {
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const view = useV2Shell((s) => s.view);
  const setView = useV2Shell((s) => s.setView);

  if (!sm) return null;

  const cs = sm.compiledSequence ?? null;
  const ir = cs?.ir ?? null;
  const stats = ir
    ? { states: (ir.states ?? []).length, transitions: (ir.transitions ?? []).length }
    : null;

  return (
    <div className="v2-diagbar" data-testid="diagram-subbar">
      <div className="v2-diagtoggle v2-diagtoggle--inflow" data-testid="diagram-detail-toggle">
        <button
          type="button"
          data-testid="diagtoggle-seq"
          className={`v2-diagtoggle__btn${view === 'mech' ? ' v2-diagtoggle__btn--active' : ''}`}
          title="The sequence as the machine moves — no state numbers, no waits"
          onClick={() => setView('mech')}
        >Sequence</button>
        <button
          type="button"
          data-testid="diagtoggle-controls"
          className={`v2-diagtoggle__btn${view === 'controls' ? ' v2-diagtoggle__btn--active' : ''}`}
          title="The compiled code's flowchart — every state, waits, retries, and the recovery path"
          onClick={() => setView('controls')}
        >Controls detail</button>
      </div>
      {/* Controls detail is tabled (Dan, Aug 23) — kept for the controls team,
          never a gate, never the landing view. */}
      <span
        className="v2-diagbar__meta"
        data-testid="diagbar-experimental-tag"
        style={{ fontSize: 10, color: 'var(--color-text-light)', fontStyle: 'italic' }}
      >experimental — for controls team review</span>

      {view === 'controls' && cs && (
        <span className="v2-diagbar__meta" data-testid="diagbar-meta">
          {cs.compiledAt && <span>compiled {fmtET(cs.compiledAt)}</span>}
          {stats && <span>{stats.states} states · {stats.transitions} transitions</span>}
        </span>
      )}

      {view === 'controls' && ir && (
        <>
          <span className="v2-diagbar__legend" data-testid="diagbar-legend">
            <span className="v2-cf__leg v2-cf__leg--main">main sequence</span>
            <span className="v2-cf__leg v2-cf__leg--confirm">synthesized confirm</span>
            <span className="v2-cf__leg v2-cf__leg--recovery">fault / init / recovery</span>
            <span className="v2-cf__leg v2-cf__leg--wait">wait / handshake</span>
          </span>
          <span className="v2-diagbar__legend-tip" data-testid="diagbar-legend-tip" title={LEGEND_TIP}>ⓘ</span>
        </>
      )}

      <span className="v2-diagbar__spacer" />
      <SlimApprove sm={sm} />
      {/* ✨ Generate — right next to Approve (Dan, Aug 23: review the diagram
          → approve → generate, right there; the Code Generation page is gone).
          Opens the existing cost-honest generate window; multi-station scope
          chips live inside the window itself. */}
      <button
        type="button"
        className="v2-diagbar__action v2-diagbar__action--generate"
        data-testid="diagbar-generate-btn"
        title={cs?.approved === true
          ? 'Generate the station code — approved sequence, fast translation'
          : 'Generate the station code — the generate window confirms the spend before anything runs'}
        onClick={() => useV2Shell.getState().openGenerate()}
      >✨ Generate</button>
    </div>
  );
}
