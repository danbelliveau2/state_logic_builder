/**
 * CompileSequenceModal — "Compile sequence (SDC Engineer)" (SDC ENGINEER v1.1 pipeline
 * inversion: the thinking happens ONCE, at Build time).
 *
 * Flow: confirm step (what/cost/time, corrections preview when re-compiling
 * with notes) → explicit Start (a click, never an effect — StrictMode
 * double-fires effects and this call costs real money) → staged-honest
 * progress (the endpoint is ONE POST with no stream, so the ring advances on
 * elapsed-vs-typical time, holds at 94% rather than faking completion, and
 * the labels say exactly that) → done card (cost, validation, questions) and
 * the shell lands on the Diagram page's Controls detail.
 *
 * Store-consistency: on success the server has written sm.compiledSequence
 * into the project FILE; we mirror the canonical record (refetched via
 * GET ir?source=compiled) into the in-memory store so the 2s auto-save
 * doesn't clobber it. Mirroring runs in the promise handler, which survives
 * the modal unmounting — closing mid-run abandons the UI, not the result.
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ProgressRing } from '../components/jarvis/ProgressRing.jsx';
import { useV2Shell } from './useV2Shell.js';
import {
  fetchCompiledIr,
  mirrorCompiledSequence,
  noteCorrectionsAck,
} from './compiledSequence.js';
import { ensureStationSheetDraft, requestResumeDraft } from '../components/jarvis/createStationDrafts.js';
import { stationOfSm, primarySmOf } from '../lib/stationModel.js';

const TYPICAL_S = 240; // ~4 min typical compile — the honest baseline

/** Kicks the compile POST and ALWAYS lands the result in the store, whether
 *  or not the modal is still mounted. Returns the run's result object.
 *  EXPORTED (Dan, 2026-08-26): the spec sheet's cascade auto-kicks the SM
 *  proposal right after the explanation is submitted — same engine, no modal. */
export async function runCompile({ filename, smId, corrections }) {
  const body = { filename, smId };
  if (corrections && corrections.trim()) body.corrections = corrections.trim();
  const r = await fetch('/api/jarvis/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) throw new Error(data?.error ?? `Compile failed (${r.status})`);

  // Corrections acknowledgment — only meaningful when we sent some.
  const correctionsAcked = body.corrections ? noteCorrectionsAck(data) : null;

  // SELF-CHECK FINDINGS PERSIST (Dan, 2026-08-25: "Compiled — flagged 3
  // issues" vanished with the modal). They ride on compiledSequence.selfCheck
  // and pin at the top of the spec sheet until approval / the next compile.
  const selfCheck = {
    ok: data?.ok === true || data?.validation?.ok === true,
    errors: (data?.validation?.errors ?? []).map(String),
  };

  // Mirror the CANONICAL record (server-side compiledAt, approved:false)
  // into the in-memory store so auto-save can't clobber the server's write.
  const canon = await fetchCompiledIr(filename, smId);
  if (canon.status === 'ok') {
    mirrorCompiledSequence(smId, {
      ir: canon.data.ir,
      compiledAt: canon.data.compiledAt,
      jarvisVersion: canon.data.jarvisVersion,
      approved: canon.data.approved === true, // fresh compile → false
      cost: canon.data.cost,
      questions: canon.data.questions ?? [],
      selfCheck,
    });
  } else {
    // Fallback mirror from the compile response itself.
    mirrorCompiledSequence(smId, {
      ir: data.ir,
      compiledAt: new Date().toISOString(),
      jarvisVersion: data.meta?.compilerVersion ?? null,
      approved: false,
      cost: data.cost ?? null,
      questions: data.questions ?? [],
      selfCheck,
    });
  }
  useV2Shell.getState().bumpCompiled();
  return { data, correctionsAcked };
}

export function CompileSequenceModal() {
  const compileFor = useV2Shell((s) => s.compileFor);
  const closeCompile = useV2Shell((s) => s.closeCompile);
  const setView = useV2Shell((s) => s.setView);

  const smId = compileFor?.smId ?? null;
  const corrections = compileFor?.corrections ?? '';
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === smId)
  );
  const isRecompile = !!sm?.compiledSequence?.ir;

  // phase: 'confirm' | 'running' | 'done' | 'failed'
  const [phase, setPhase] = useState('confirm');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { data, correctionsAcked }
  const startRef = useRef(null);
  const mountedRef = useRef(true);
  // Set true in the effect BODY — StrictMode dev double-mount runs the
  // cleanup once (false) and the body again; a bare cleanup-only effect
  // would leave the ref stuck false and swallow the result UI.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Elapsed ticker while running.
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Publish live progress to the shell so the banner's pipeline button can
  // say "Compiling… n%" (cleared when not running / on unmount).
  useEffect(() => {
    const shell = useV2Shell.getState();
    if (phase === 'running') {
      shell.setCompilePct(Math.min(94, (elapsed / TYPICAL_S) * 94));
    } else {
      shell.setCompilePct(null);
    }
    return () => useV2Shell.getState().setCompilePct(null);
  }, [phase, elapsed]);

  if (!compileFor || !sm) return null;

  const stationLabel = sm.displayName ?? sm.name;

  async function handleStart() {
    setPhase('running');
    setError(null);
    startRef.current = Date.now();
    try {
      // The compile endpoint reads the project FILE — save first so it sees
      // the spec/diagram exactly as drawn right now.
      await useDiagramStore.getState().saveCurrentProject();
      const filename = useDiagramStore.getState().currentFilename;
      if (!filename) throw new Error('Project has no server filename — is the server running?');
      const out = await runCompile({ filename, smId, corrections });
      if (!mountedRef.current) return; // result already mirrored + bumped
      setResult(out);
      setPhase('done');
      setView('mech'); // land on the Sequence view (Dan, Aug 23: never auto-land on controls detail)
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message);
      setPhase('failed');
    }
  }

  function handleClose() {
    if (phase === 'running') {
      const ok = window.confirm(
        'SDC Engineer is still compiling. Closing this window hides the progress, but the compile keeps running on the server and the result will appear on the Diagram page when it finishes. Close anyway?'
      );
      if (!ok) return;
    }
    closeCompile();
  }

  // Staged-honest ring: advances on elapsed vs the ~4 min typical, holds at
  // 94% when a run outlives the estimate (never fakes completion).
  const pct = phase === 'done' ? 100 : Math.min(94, (elapsed / TYPICAL_S) * 94);
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const d = result?.data;
  const validationOk = d?.ok === true || d?.validation?.ok === true;
  const vErrors = d?.validation?.errors ?? [];
  const questions = d?.questions ?? [];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && phase !== 'running') handleClose(); }}>
      <style>{'@keyframes jarvisPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.7); } }'}</style>
      <div className="modal" style={{ width: 560, maxHeight: '84vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span>⚙ Compile sequence (SDC Engineer)</span>
          <button className="icon-btn" onClick={handleClose}>✕</button>
        </div>

        <div className="modal__body" style={{ overflow: 'auto' }} data-testid="compile-modal-body">
          {/* ── Confirm step ── */}
          {phase === 'confirm' && (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                {isRecompile ? 'Re-compile' : 'Compile'} {stationLabel}
              </div>
              <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.6, margin: '0 0 10px' }}>
                SDC Engineer reads the station spec and the drawn diagram, and thinks
                through the FULL sequence once — every state, transition, wait
                and handshake — so you can review and approve it before any
                code is generated. Approved sequences make Generate a fast,
                near-mechanical translation.
              </p>
              {corrections.trim() && (
                <div data-testid="compile-corrections-preview" style={{
                  background: '#f0f7ff', border: '1px solid #b7d5f2', borderRadius: 6,
                  padding: '8px 10px', fontSize: 12, color: '#0f172a', marginBottom: 10,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: '#1574C4', marginBottom: 4 }}>
                    Your change notes (sent with this compile)
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{corrections.trim()}</div>
                </div>
              )}
              {isRecompile && (
                <div style={{
                  background: '#fdf6e3', border: '1px solid #e8b64c', borderRadius: 6,
                  padding: '6px 10px', fontSize: 11, color: '#7a6220', marginBottom: 10,
                }}>
                  Re-compiling replaces the current compiled sequence and
                  clears its approval — you'll review and approve again.
                </div>
              )}
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Typically ~4 min · roughly $0.50–1 per compile
              </div>
            </>
          )}

          {/* ── Running / done / failed ── */}
          {phase !== 'confirm' && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ flexShrink: 0 }}>
                <ProgressRing pct={pct} failed={phase === 'failed'} size={104} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{stationLabel}</div>
                <div data-testid="compile-stage-line" style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {phase === 'running' && (
                    <span aria-hidden="true" style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--color-primary, #1574C4)',
                      animation: 'jarvisPulse 1.4s ease-in-out infinite',
                    }} />
                  )}
                  <span>
                    {phase === 'failed' ? 'Compile failed'
                      : phase === 'done' ? 'Compiled'
                      : elapsed > TYPICAL_S
                        ? 'Still reasoning — running past the typical time (that’s fine; complex stations take longer)'
                        : 'SDC Engineer is reasoning through the full sequence — one deliberate pass, nothing streams back until it’s done'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  Elapsed {mmss} · typically ~4 min
                  {typeof d?.cost === 'number' && <span> · Cost ${d.cost.toFixed(2)}</span>}
                </div>
              </div>
            </div>
          )}

          {phase === 'failed' && (
            <div style={{
              marginTop: 12, background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#991b1b',
            }}>
              <strong>Compile failed:</strong> {error}
            </div>
          )}

          {phase === 'done' && (
            <div style={{ marginTop: 14 }} data-testid="compile-done-card">
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                borderRadius: 6, fontSize: 13, fontWeight: 700,
                background: validationOk ? '#f0fdf4' : '#fdf6e3',
                border: `1px solid ${validationOk ? '#86efac' : '#e8b64c'}`,
                color: validationOk ? '#166534' : '#7a6220',
              }}>
                {validationOk
                  ? '✓ Sequence compiled and self-checked'
                  : `Compiled — self-check flagged ${vErrors.length} issue${vErrors.length === 1 ? '' : 's'}`}
              </div>
              {vErrors.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: '#7a6220', maxHeight: 100, overflow: 'auto' }}>
                  {vErrors.map((e, i) => <li key={i}>{String(e)}</li>)}
                </ul>
              )}
              {questions.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#7a6220' }}>
                  {questions.length} open question{questions.length === 1 ? '' : 's'} for the leads' queue — on the SDC Engineer page.
                </div>
              )}
              {result?.correctionsAcked === false && (
                <div data-testid="corrections-not-acked" style={{
                  marginTop: 8, background: '#fdf6e3', border: '1px solid #e8b64c',
                  borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#7a6220',
                }}>
                  Heads up: this compiler version didn't confirm it used your
                  change notes. If the sequence doesn't reflect them, make the
                  change in the spec or diagram and re-compile.
                </div>
              )}
              <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
                Next: <b>Review &amp; approve</b> takes you to the spec sheet —
                any flagged issues stay pinned at the top there, each section
                has its Edit / ✓, and &ldquo;Looks good — build the code&rdquo;
                closes it out. (These findings don&rsquo;t vanish with this
                window.)
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px' }}>
          {phase === 'confirm' && (
            <>
              <button className="btn btn--secondary" onClick={handleClose}>Cancel</button>
              <button className="btn btn--primary" data-testid="compile-start" onClick={handleStart}>
                {isRecompile ? 'Re-compile sequence' : 'Compile sequence'}
              </button>
            </>
          )}
          {phase === 'running' && (
            <button className="btn btn--secondary" onClick={handleClose}>Hide (keeps running)</button>
          )}
          {phase === 'done' && (
            <button
              className="btn btn--secondary"
              data-testid="compile-view-sequence"
              onClick={() => { closeCompile(); setView('mech'); }}
            >
              View compiled sequence
            </button>
          )}
          {(phase === 'done' || phase === 'failed') && (
            <button
              className="btn btn--primary"
              data-testid="compile-close"
              onClick={() => {
                if (phase !== 'done') { closeCompile(); return; }
                // LAND, DON'T STRAND (Dan, 2026-08-25: the modal closed and he
                // didn't know what to do): done → the Review & Edit surface —
                // the spec sheet — with the self-check findings pinned at the
                // top and the next step explicit (review → approve).
                closeCompile();
                const st = useDiagramStore.getState();
                const station = stationOfSm(st.project, smId);
                const sheetSm = primarySmOf(station)
                  ?? st.project?.stateMachines?.find((m) => m.id === smId);
                if (!sheetSm) return;
                const draft = ensureStationSheetDraft(st, sheetSm);
                requestResumeDraft(draft.draftId);
                useV2Shell.getState().setSheetLinkedSmId(sheetSm.id);
                st.openNewSmModal();
              }}
            >
              {phase === 'done' ? 'Review & approve →' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
