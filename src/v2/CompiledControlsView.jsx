/**
 * CompiledControlsView — the "Full Controls" view made REAL (v2.1.0).
 *
 * When the active station has a Build-time compiled sequence
 * (GET /api/jarvis/ir?source=compiled), this renders it as a clean read-only
 * structured view over the canvas area — v1 rendering, not React Flow nodes:
 *   · ordered state list (number, label, actions, each state's outgoing
 *     transitions with their real rung conditionText)
 *   · waits called out with their exits
 *   · handshakes and review-flags columns (flags in amber)
 *   · compiledAt / cost / compiler version + the APPROVE toggle — approval
 *     is the engineer's "I agree with this sequence" and flips Generate
 *     into translation mode (near-mechanical, fast, cheap)
 *   · edit-by-explaining: a dictated notes box that re-compiles with the
 *     notes attached (feature-detected — hidden if the compiler doesn't
 *     take notes yet)
 *
 * No compiled sequence → the honest banner plus an inline "Compile
 * sequence" button. Everything here consumes endpoints defensively; the
 * pretranslation status endpoint may not exist yet and is feature-detected.
 */

import { useEffect, useMemo, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DictatedTextarea } from '../components/jarvis/DictatedTextarea.jsx';
import { useV2Shell } from './useV2Shell.js';
import {
  canCompile,
  compileBlockReason,
  fetchCompiledIr,
  fetchPretranslated,
  getCorrectionsSupport,
  isPretranslatedReady,
  mirrorApproved,
} from './compiledSequence.js';

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Approve toggle ──────────────────────────────────────────────────────────
function ApproveControl({ filename, smId, approved, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function setApproved(next) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/jarvis/compile/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, smId, approved: next }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Approve failed (${r.status})`);
      // Mirror the server's write into the in-memory store so the 2s
      // auto-save can't clobber it.
      mirrorApproved(smId, d?.approved === true);
      onChanged(d?.approved === true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v2-cc__approve" data-testid="cc-approve">
      {approved ? (
        <div className="v2-cc__approved-box">
          <span className="v2-cc__approved-text" data-testid="cc-approved-text">
            ✓ Approved — Generate now runs as a fast translation of this sequence
          </span>
          <button
            className="v2-cc__revoke"
            data-testid="cc-revoke-btn"
            disabled={busy}
            onClick={() => setApproved(false)}
          >{busy ? '…' : 'Revoke'}</button>
        </div>
      ) : (
        <button
          className="v2-cc__approve-btn"
          data-testid="cc-approve-btn"
          disabled={busy}
          onClick={() => setApproved(true)}
        >
          {busy ? 'Saving…' : 'Approve — I agree with this sequence'}
        </button>
      )}
      {err && <div className="v2-cc__err">{err}</div>}
    </div>
  );
}

// ── One state card ──────────────────────────────────────────────────────────
function StateCard({ st, transitions, waitStates }) {
  const outs = transitions.filter((t) => (t.fromState ?? t.from) === st.stateNumber);
  const isWait = waitStates.has(st.stateNumber);
  return (
    <div className="v2-cc__state" data-testid={`cc-state-${st.stateNumber}`}>
      <div className="v2-cc__state-head">
        <span className="v2-cc__snum">{st.stateNumber}</span>
        <span className="v2-cc__sname">{st.label || st.nodeId}</span>
        {st.isInitial && <span className="v2-cc__tag v2-cc__tag--blue">initial</span>}
        {st.isComplete && <span className="v2-cc__tag v2-cc__tag--green">cycle complete</span>}
        {isWait && <span className="v2-cc__tag v2-cc__tag--wait">wait</span>}
        {st.synthesized && <span className="v2-cc__tag v2-cc__tag--amber" title="Added by Jarvis, not drawn by the ME">synthesized</span>}
      </div>
      {(st.actions ?? []).length > 0 && (
        <ul className="v2-cc__actions">
          {st.actions.map((a, i) => (
            <li key={i}>
              <b>{a.operation}</b>
              {(a.device || a.deviceName) && <span className="v2-cc__dev"> {a.device ?? a.deviceName}</span>}
              {a.detail && <span className="v2-cc__detail"> — {a.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {outs.length > 0 && (
        <div className="v2-cc__outs">
          {outs.map((t, i) => (
            <div className="v2-cc__out" key={i}>
              <div className="v2-cc__out-head">
                <span className="v2-cc__arrow">→</span>
                <span className="v2-cc__snum v2-cc__snum--to">{t.toState ?? t.to}</span>
                <span className="v2-cc__out-label">{t.toLabel}</span>
                {(t.label || t.outcomeLabel) && (
                  <span className={`v2-cc__tag ${
                    /fail|timeout/i.test(t.label ?? t.outcomeLabel ?? '') ? 'v2-cc__tag--amber' : 'v2-cc__tag--blue'
                  }`}>{t.label ?? t.outcomeLabel}</span>
                )}
                {t.kind && <span className="v2-cc__kind">{t.kind}</span>}
              </div>
              {t.conditionText && <code className="v2-cc__cond">{t.conditionText}</code>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────
export function CompiledControlsView({ headerExtra }) {
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const filename = useDiagramStore((s) => s.currentFilename);
  const compiledBump = useV2Shell((s) => s.compiledBump);
  const openCompile = useV2Shell((s) => s.openCompile);

  const [state, setState] = useState({ status: 'loading' }); // loading | ok | none | error
  const [approved, setApproved] = useState(false);
  const [pretrans, setPretrans] = useState(null);
  const [notes, setNotes] = useState('');

  const smId = sm?.id ?? null;

  useEffect(() => {
    let alive = true;
    if (!filename || !smId) { setState({ status: 'none' }); return; }
    setState({ status: 'loading' });
    fetchCompiledIr(filename, smId).then((res) => {
      if (!alive) return;
      if (res.status === 'ok') {
        setState({ status: 'ok', data: res.data });
        setApproved(res.data.approved === true);
      } else {
        setState(res);
        setApproved(false);
      }
    });
    return () => { alive = false; };
  }, [filename, smId, compiledBump]);

  // Pretranslation status (feature-detected) — worth showing once approved.
  useEffect(() => {
    let alive = true;
    setPretrans(null);
    if (!filename || !smId || !approved) return;
    fetchPretranslated(filename, smId).then((p) => { if (alive) setPretrans(p); });
    return () => { alive = false; };
  }, [filename, smId, approved, compiledBump]);

  const ir = state.status === 'ok' ? state.data.ir : null;
  const states = useMemo(
    () => [...(ir?.states ?? [])].sort((a, b) => (a.stateNumber ?? 0) - (b.stateNumber ?? 0)),
    [ir]
  );
  const waitStates = useMemo(
    () => new Set((ir?.waits ?? []).map((w) => w.stateNumber)),
    [ir]
  );

  const compilable = canCompile(sm);
  const blockReason = compileBlockReason(sm);
  const correctionsOk = getCorrectionsSupport() !== 'no';
  const instant = isPretranslatedReady(pretrans);

  return (
    <div className="v2-cc" data-testid="cc-view">
      {/* Header — mirrors the canvas SM-title pill row so the view switcher
          stays in the same place in both views. */}
      <div className="v2-cc__topbar">
        <span className="v2-cc__station">
          <span className="v2-cc__station-num">S{String(sm?.stationNumber ?? 0).padStart(2, '0')}</span>
          <b>{sm?.displayName ?? sm?.name ?? 'No station'}</b>
          <span className="v2-cc__mode">Full Controls — compiled sequence</span>
        </span>
        {headerExtra}
      </div>

      <div className="v2-cc__scroll">
        {state.status === 'loading' && (
          <div className="v2-cc__empty">Loading compiled sequence…</div>
        )}

        {state.status === 'error' && (
          <div className="v2-cc__banner v2-cc__banner--amber" data-testid="cc-error">
            Couldn't load the compiled sequence: {state.error}
          </div>
        )}

        {/* ── No compiled sequence yet — honest banner + inline compile ── */}
        {state.status === 'none' && (
          <div className="v2-cc__emptycard" data-testid="cc-empty">
            <div className="v2-cc__banner v2-cc__banner--amber">
              No compiled sequence yet — this view fills in when Jarvis
              compiles the station.
            </div>
            <p className="v2-cc__empty-sub">
              Compile makes Jarvis think through the full sequence ONCE — every
              state, transition, wait and handshake — so you review and approve
              the logic before any code is generated.
            </p>
            <button
              className="v2-cc__compile-btn"
              data-testid="cc-compile-btn"
              disabled={!compilable}
              title={blockReason ?? 'Compile this station'}
              onClick={() => openCompile(smId)}
            >⚙ Compile sequence (Jarvis)</button>
            {!compilable && blockReason && (
              <div className="v2-cc__empty-block">{blockReason}</div>
            )}
          </div>
        )}

        {/* ── Compiled sequence ── */}
        {state.status === 'ok' && ir && (
          <>
            {/* Meta + approve strip */}
            <div className="v2-cc__meta" data-testid="cc-meta">
              <div className="v2-cc__meta-facts">
                <span title={state.data.compiledAt ?? ''}>Compiled <b>{fmtWhen(state.data.compiledAt)}</b></span>
                {typeof state.data.cost === 'number' && <span>Cost <b>${state.data.cost.toFixed(2)}</b></span>}
                {state.data.jarvisVersion && <span>Compiler <b>v{state.data.jarvisVersion}</b></span>}
                <span><b>{states.length}</b> states · <b>{(ir.transitions ?? []).length}</b> transitions</span>
                <button
                  className="v2-cc__recompile"
                  data-testid="cc-recompile-btn"
                  onClick={() => openCompile(smId)}
                  title="Re-compile from the current spec + diagram (clears approval)"
                >↻ Re-compile</button>
              </div>
              <ApproveControl
                filename={filename}
                smId={smId}
                approved={approved}
                onChanged={setApproved}
              />
              {instant && (
                <div className="v2-cc__instant" data-testid="cc-instant-note">
                  Code is already built ✓ — Generate = instant download
                </div>
              )}
            </div>

            {ir.summary && <p className="v2-cc__summary">{ir.summary}</p>}

            {/* Open questions from the compile */}
            {(state.data.questions ?? []).length > 0 && (
              <div className="v2-cc__banner v2-cc__banner--amber" data-testid="cc-questions">
                <b>{state.data.questions.length} open question{state.data.questions.length === 1 ? '' : 's'} for the controls team:</b>
                <ul>
                  {state.data.questions.map((q, i) => (
                    <li key={i}>{typeof q === 'string' ? q : q.question ?? q.text ?? JSON.stringify(q)}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Review flags — amber, above the fold: read these before approving */}
            {(ir.reviewFlags ?? []).length > 0 && (
              <div className="v2-cc__flags" data-testid="cc-flags">
                <div className="v2-cc__flags-title">
                  ⚠ Review before approving ({ir.reviewFlags.length})
                </div>
                <ul>
                  {ir.reviewFlags.map((f, i) => <li key={i}>{String(f)}</li>)}
                </ul>
              </div>
            )}

            {/* Two columns: states (main) · waits + handshakes (side) */}
            <div className="v2-cc__grid">
              <div className="v2-cc__col-states">
                <div className="v2-cc__coltitle">Sequence — {states.length} states</div>
                {states.map((st) => (
                  <StateCard
                    key={st.nodeId ?? st.stateNumber}
                    st={st}
                    transitions={ir.transitions ?? []}
                    waitStates={waitStates}
                  />
                ))}
              </div>

              <div className="v2-cc__col-side">
                {(ir.waits ?? []).length > 0 && (
                  <div className="v2-cc__side-card" data-testid="cc-waits">
                    <div className="v2-cc__coltitle">Waits ({ir.waits.length})</div>
                    {ir.waits.map((w, i) => (
                      <div className="v2-cc__wait" key={i}>
                        <div className="v2-cc__wait-head">
                          <span className="v2-cc__snum">{w.stateNumber}</span>
                          <span className="v2-cc__wait-sig">{w.signal}</span>
                        </div>
                        <div className="v2-cc__wait-src">
                          {w.mode && <span className="v2-cc__tag v2-cc__tag--wait">{w.mode}</span>}
                          {w.source ?? w.partner ?? ''}
                        </div>
                        {(w.exits ?? []).map((x, j) => (
                          <div className="v2-cc__wait-exit" key={j}>
                            <span className="v2-cc__arrow">→</span>
                            <span className="v2-cc__snum v2-cc__snum--to">{x.toState}</span>
                            <span className="v2-cc__wait-when">{x.when}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {(ir.handshakes ?? []).length > 0 && (
                  <div className="v2-cc__side-card" data-testid="cc-handshakes">
                    <div className="v2-cc__coltitle">Handshakes ({ir.handshakes.length})</div>
                    {ir.handshakes.map((h, i) => (
                      <div className="v2-cc__hs" key={i}>
                        <div className="v2-cc__hs-head">
                          <span className={`v2-cc__hs-dir ${h.direction === 'out' ? 'v2-cc__hs-dir--out' : 'v2-cc__hs-dir--in'}`}>
                            {h.direction === 'out' ? '⇒' : '⇐'}
                          </span>
                          <code className="v2-cc__hs-sig">{h.signal}</code>
                          {h.partner && <span className="v2-cc__hs-partner">{h.partner}</span>}
                        </div>
                        {h.purpose && <div className="v2-cc__hs-purpose">{h.purpose}</div>}
                        {(h.setAtState != null || h.clearAtState != null) && (
                          <div className="v2-cc__hs-states">
                            {h.setAtState != null && <span>set @ {h.setAtState}</span>}
                            {h.clearAtState != null && <span>clear @ {h.clearAtState}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Edit-by-explaining loop ── */}
            <div className="v2-cc__edit" data-testid="cc-edit">
              <div className="v2-cc__coltitle">Change something?</div>
              {correctionsOk ? (
                <>
                  <p className="v2-cc__edit-sub">
                    Explain the change in your own words — type or talk — and
                    Jarvis re-compiles the sequence with your notes. Approval
                    clears on re-compile, so you review again.
                  </p>
                  <DictatedTextarea
                    value={notes}
                    onChange={setNotes}
                    rows={3}
                    placeholder="e.g. The hold-down must release BEFORE the shuttle retracts, and give the magnet check 4 retries instead of 3…"
                    micTestId="cc-notes-mic"
                    data-testid="cc-notes"
                    className="v2-cc__notes"
                  />
                  <div className="v2-cc__edit-actions">
                    <button
                      className="v2-cc__compile-btn"
                      data-testid="cc-apply-btn"
                      disabled={!notes.trim()}
                      onClick={() => { openCompile(smId, notes.trim()); setNotes(''); }}
                    >Apply changes (re-compile)</button>
                  </div>
                </>
              ) : (
                <p className="v2-cc__edit-sub" data-testid="cc-edit-fallback">
                  This compiler version doesn't take change notes yet —
                  re-compile picks up spec and diagram edits: make the change
                  there, then hit ↻ Re-compile above.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
