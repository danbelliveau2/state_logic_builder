/**
 * JarvisGenerateModal — AI (SDC ENGINEER) L5X generation with live progress.
 *
 * Flow (Dan's ask, Aug 2026): the modal opens to a SCOPE step first —
 * "What are you generating?" — instead of auto-starting on the active
 * station. (Auto-start was a deliberate earlier choice; it's superseded by
 * multi-station reality: a machine can have many stations and Dan may want
 * one, several, or the whole machine.)
 *
 * Tiers (SDC official taxonomy):
 *   Tier 1 — Station sequence code (DEFAULT): one L5X per selected station,
 *            imports standalone into any Studio 5000 project. Multi-select =
 *            sequential pipeline runs, one L5X each.
 *   Tier 2 — Multi-station integration (early): every station is selected;
 *            coordination (spec relationships → handshakes) is compiled into
 *            each station's prompt via the IR. No machine-level supervisor.
 *   Tier 3 — Full machine code: in development, disabled.
 *
 * After Start the per-station flow is the ORIGINAL pipeline, unchanged:
 * save project (pipeline reads by filename), open SSE to
 * GET /api/generate/stream, progress events drive the ring, `done` carries
 * the full result, closing the EventSource aborts the model stream
 * server-side. Multi-station runs the same flow sequentially. Cancel stops
 * after aborting the in-flight station and skips the rest.
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';
import { ProgressRing } from '../jarvis/ProgressRing.jsx';
import { BuildScoreRow } from '../jarvis/BuildScoreRow.jsx';
import { JarvisPage } from '../jarvis/JarvisPage.jsx';
// Pretranslation status (v2.1.0 pipeline inversion) — pure helpers, no v2 UI.
// The endpoint may not exist yet; fetchPretranslated feature-detects and
// returns null, so this modal degrades to the normal flow silently.
import { fetchPretranslated, isPretranslatedReady } from '../../v2/compiledSequence.js';

const STAGE_LABELS = {
  start: 'Loading project',
  ir: 'Building intermediate representation',
  prompt: 'Assembling prompt',
  model: 'Model writing edit plan',
  merge: 'Merging into SDC template',
  validate: 'Validating program',
  repair: 'Self-repair round',
  done: 'Complete',
};

// initialSelectedIds: preselect stations in the scope picker (the Code
// Generation page passes its selection through so nothing is re-picked).
export function JarvisGenerateModal({ onClose, initialSelectedIds = null }) {
  const store = useDiagramStore();
  const project = store.project;
  const activeSm = store.getActiveSm();
  const sms = project?.stateMachines ?? [];

  // phase: 'scope' | 'running' | 'done' | 'failed' | 'cancelled'
  const [phase, setPhase] = useState('scope');

  // ── Scope step state ──
  const [tier, setTier] = useState(1); // 1 = station sequence, 2 = multi-station integration
  const [selectedIds, setSelectedIds] = useState(() =>
    new Set(initialSelectedIds?.length ? initialSelectedIds : (activeSm ? [activeSm.id] : [])));
  const [avgCost, setAvgCost] = useState(null); // { avg, n } from benchmark history
  const [avgDuration, setAvgDuration] = useState(null); // avg seconds per station from history
  // smId -> pretranslation payload (code pre-built after approval). Only
  // populated when the backend endpoint exists (feature-detected).
  const [pretransById, setPretransById] = useState({});

  // ── Run state ──
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState('start');
  const [statusLines, setStatusLines] = useState([]);
  const [error, setError] = useState(null); // current-station hard failure
  const [elapsed, setElapsed] = useState(0);
  const [runList, setRunList] = useState([]);  // SMs captured at Start, in project order
  const [runIndex, setRunIndex] = useState(0); // which station is in flight
  const [outcomes, setOutcomes] = useState([]); // [{ sm, status: 'done'|'failed'|'cancelled'|'skipped', result?, error? }]
  const [scored, setScored] = useState({});     // buildId -> scored build
  const [streamedTokens, setStreamedTokens] = useState(0); // real content tokens (0 = silent reasoning phase)
  const [stalled, setStalled] = useState(false); // no SSE events (not even keepalives) for >90s
  const [codeOpen, setCodeOpen] = useState(false); // "See all generated code →" (Generated code grid)

  const esRef = useRef(null);
  const cancelRef = useRef(false);
  const resolveRef = useRef(null); // resolves the in-flight station when cancelled
  const startRef = useRef(null);
  const doneRef = useRef(false);
  const lastEventRef = useRef(null); // last SSE event of ANY kind (progress/ping) — stall detection

  // Benchmark history → per-station cost hint (free GET; static fallback text).
  useEffect(() => {
    fetch('/api/jarvis/builds')
      .then(r => (r.ok ? r.json() : []))
      .then(arr => {
        const costs = (Array.isArray(arr) ? arr : [])
          .map(b => b.costUSD).filter(c => typeof c === 'number' && c > 0);
        if (costs.length) {
          setAvgCost({ avg: costs.reduce((a, b) => a + b, 0) / costs.length, n: costs.length });
        }
        const durations = (Array.isArray(arr) ? arr : [])
          .map(b => b.durationS).filter(d => typeof d === 'number' && d > 30);
        if (durations.length) {
          setAvgDuration(durations.reduce((a, b) => a + b, 0) / durations.length);
        }
      })
      .catch(() => {});
  }, []);

  // Pretranslation probe — only stations with an APPROVED compiled sequence
  // can have pre-built code. Free GETs; silently absent until the backend
  // endpoint lands (fetchPretranslated feature-detects non-JSON responses).
  useEffect(() => {
    const filename = useDiagramStore.getState().currentFilename;
    if (!filename) return;
    let alive = true;
    const candidates = sms.filter(s => s.compiledSequence?.approved === true);
    candidates.forEach(s => {
      fetchPretranslated(filename, s.id).then(p => {
        if (alive && p) setPretransById(prev => ({ ...prev, [s.id]: p }));
      });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed timer (runs only once generation starts)
  useEffect(() => {
    if (phase === 'scope') return;
    const t = setInterval(() => {
      if (!doneRef.current && startRef.current) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        // Stall detection: the server pings every 15s even while the model is
        // silently reasoning — >90s of NOTHING means the connection is suspect.
        setStalled(lastEventRef.current != null && Date.now() - lastEventRef.current > 90000);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => { cancelRef.current = true; esRef.current?.close(); }, []);

  const pushStatus = (line) => setStatusLines(prev => {
    if (prev.length && prev[prev.length - 1] === line) return prev;
    return [...prev.slice(-80), line];
  });

  const costHint = avgCost
    ? `~$${avgCost.avg.toFixed(2)} per station (avg of ${avgCost.n} builds)`
    : '~$1–3 per station';

  // ── Scope helpers ──
  const allIds = sms.map(s => s.id);
  const pickableSms = sms; // empty stations shown but disabled in the picker
  const effectiveIds = tier === 2 ? allIds.filter(id => (sms.find(s => s.id === id)?.nodes ?? []).length > 0)
    : [...selectedIds];
  const selectedSms = sms.filter(s => effectiveIds.includes(s.id));
  const nSelected = selectedSms.length;

  function toggleStation(id) {
    if (tier !== 1) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── The per-station pipeline — the ORIGINAL flow, unchanged downstream ──
  // Returns a promise resolving { status, result?, error? }. Never rejects.
  function runStation(sm, filename) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolveRef.current = null; resolve(v); } };
      // Cancel resolves 'cancelled'; the dead-stream Retry button resolves
      // 'retry' — the run loop re-runs the same station on a fresh SSE.
      resolveRef.current = (status = 'cancelled') => settle({ status });

      const programName = buildProgramName(sm.stationNumber, sm.name);
      pushStatus(`Starting SDC ENGINEER generation for ${programName}…`);
      const es = new EventSource(
        `/api/generate/stream?filename=${encodeURIComponent(filename)}&smId=${encodeURIComponent(sm.id)}`
      );
      esRef.current = es;
      lastEventRef.current = Date.now();
      setStreamedTokens(0);
      setStalled(false);

      es.addEventListener('progress', (ev) => {
        lastEventRef.current = Date.now();
        setStalled(false);
        try {
          const d = JSON.parse(ev.data);
          setPct(d.pct);
          setStage(d.stage);
          if (d.detail) {
            pushStatus(d.detail);
            // Real content tokens streaming (the pipeline only appends this
            // once actual output deltas arrive — silence before it = the
            // model's reasoning phase, which streams nothing).
            const m = /~([\d,]+) tokens streamed/.exec(d.detail);
            if (m) setStreamedTokens(parseInt(m[1].replace(/,/g, ''), 10) || 0);
          }
        } catch (_) {}
      });
      // Server keepalive — proves the connection is alive while the model
      // reasons silently. No UI text; just resets the stall clock.
      es.addEventListener('ping', () => {
        lastEventRef.current = Date.now();
        setStalled(false);
      });
      es.addEventListener('done', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          setPct(100);
          pushStatus(d.ok ? `${programName}: generation complete.` : `${programName}: finished — validation reported errors.`);
          es.close();
          settle({ status: 'done', result: d });
        } catch (e) {
          es.close();
          settle({ status: 'failed', error: 'Could not parse result: ' + e.message });
        }
      });
      es.addEventListener('error', (ev) => {
        // Server-sent error event carries data; transport errors don't.
        let msg;
        if (ev.data) {
          try { msg = JSON.parse(ev.data).error; } catch { msg = 'Generation failed.'; }
        } else {
          msg = 'Connection to the generation server was lost.';
        }
        es.close();
        if (!cancelRef.current) settle({ status: 'failed', error: msg });
        else settle({ status: 'cancelled' });
      });
    });
  }

  // ── Start — kicks off the sequential run over the selected stations ──
  async function handleStart() {
    const list = selectedSms;
    if (!list.length) return;
    cancelRef.current = false;
    doneRef.current = false;
    startRef.current = Date.now();
    setRunList(list);
    setOutcomes([]);
    setPhase('running');

    let filename;
    try {
      pushStatus('Saving project to server…');
      await store.saveCurrentProject();
      filename = useDiagramStore.getState().currentFilename;
      if (!filename) throw new Error('Project has no server filename — save the project first (server must be running).');
    } catch (e) {
      setError(e.message);
      setPhase('failed');
      doneRef.current = true;
      return;
    }

    const acc = [];
    for (let i = 0; i < list.length; i++) {
      const sm = list[i];
      if (cancelRef.current) {
        acc.push({ sm, status: 'skipped' });
        setOutcomes([...acc]);
        continue;
      }
      setRunIndex(i);
      setPct(0);
      setStage('start');
      setError(null);
      if (list.length > 1) pushStatus(`— Station ${i + 1} of ${list.length}: ${sm.displayName ?? sm.name} —`);
      let out = await runStation(sm, filename);
      // Dead-stream recovery: "Retry generation" re-runs this station on a
      // fresh connection (the aborted attempt was already paid for; the
      // retry is the one-click way to not lose the whole run).
      while (out.status === 'retry' && !cancelRef.current) {
        setPct(0);
        setStage('start');
        pushStatus(`Retrying ${sm.displayName ?? sm.name} on a fresh connection…`);
        out = await runStation(sm, filename);
      }
      acc.push({ sm, ...out });
      setOutcomes([...acc]);
      if (out.status === 'failed') setError(out.error);
    }

    doneRef.current = true;
    if (cancelRef.current) {
      setPhase('cancelled');
      const doneCount = acc.filter(o => o.status === 'done').length;
      pushStatus(`Cancelled — ${doneCount} of ${list.length} station${list.length === 1 ? '' : 's'} completed.`);
    } else if (acc.some(o => o.status === 'failed')) {
      setPhase('failed');
    } else {
      setPhase('done');
      pushStatus(list.length > 1 ? `All ${list.length} stations generated.` : 'Generation complete.');
    }
  }

  function handleCancel() {
    cancelRef.current = true;
    esRef.current?.close(); // server aborts the SDK stream on close
    pushStatus('Cancel requested — stopping after the current station.');
    resolveRef.current?.(); // release the in-flight await
  }

  // Dead-stream recovery: abort the dead connection and re-run the SAME
  // station on a fresh SSE. Only offered when the stall warning is showing.
  function handleRetry() {
    setStalled(false);
    esRef.current?.close();
    pushStatus('Dead stream — retrying this station…');
    resolveRef.current?.('retry');
  }

  function downloadResult(sm, result) {
    if (!result?.l5x) return;
    const smName = result.meta?.smName || sm?.name || 'StateMachine';
    const blob = new Blob([result.l5x], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${buildProgramName(sm?.stationNumber ?? 1, smName)}_SDCEngineer.L5X`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const running = phase === 'running';
  const scoping = phase === 'scope';
  const finished = phase === 'done' || phase === 'failed' || phase === 'cancelled';
  const currentSm = runList[runIndex] ?? null;
  const currentProgram = currentSm ? buildProgramName(currentSm.stationNumber, currentSm.name) : '—';
  const totalCost = outcomes.reduce((a, o) => a + (o.result?.meta?.costEstimate?.totalUSD ?? 0), 0);

  // Cross-station signals SDC Engineer authored (Tier 2 post-run note) — from each
  // result's IR waits: entries tied to a partner SM or handshake conditions.
  const crossSignals = tier === 2 && finished
    ? outcomes.flatMap(o => (o.result?.ir?.waits ?? [])
        .filter(w => w.partner || w.mode === 'handshake')
        .map(w => ({ station: o.sm.displayName ?? o.sm.name, ...w })))
    : [];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      {/* Activity pulse — "alive" (reasoning) must look different from "stalled" */}
      <style>{'@keyframes jarvisPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.7); } }'}</style>
      <div className="modal" style={{ width: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span>✨ Generate with SDC ENGINEER</span>
          <button className="icon-btn" onClick={() => { if (running) handleCancel(); onClose(); }}>✕</button>
        </div>

        {/* ═══════════ SCOPE STEP ═══════════ */}
        {scoping && (
          <div className="modal__body" style={{ overflow: 'auto' }} data-testid="jarvis-scope-step">
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>
              What are you generating?
            </div>

            {/* Tier 1 — Station sequence code */}
            <div
              data-testid="tier-1"
              onClick={() => setTier(1)}
              style={{
                border: `2px solid ${tier === 1 ? 'var(--color-primary, #1574C4)' : '#e2e8f0'}`,
                borderRadius: 8, padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
                background: tier === 1 ? '#f0f7ff' : '#fff',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}>
                <input type="radio" name="jarvis-tier" checked={tier === 1} onChange={() => setTier(1)} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Station sequence code</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#1574C4', background: '#e0efff', borderRadius: 4, padding: '1px 6px' }}>Tier 1</span>
              </label>
              <div style={{ fontSize: 11, color: '#475569', margin: '4px 0 0 24px' }}>
                One station program — imports standalone into any Studio 5000 project.
                Check several to generate each in turn (one L5X per station).
              </div>
              {tier === 1 && (
                <div data-testid="station-picker" style={{ margin: '8px 0 0 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {pickableSms.map(s => {
                    const empty = (s.nodes ?? []).length === 0;
                    return (
                      <label
                        key={s.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: empty ? '#94a3b8' : '#0f172a', cursor: empty ? 'not-allowed' : 'pointer' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          data-testid={`station-check-${s.id}`}
                          disabled={empty}
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleStation(s.id)}
                        />
                        <span style={{ fontWeight: s.id === activeSm?.id ? 700 : 400 }}>
                          {s.displayName ?? s.name}
                          <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 11 }}>
                            {buildProgramName(s.stationNumber, s.name)}{empty ? ' — no logic drawn' : ''}
                            {s.id === activeSm?.id ? ' · active' : ''}
                          </span>
                          {isPretranslatedReady(pretransById[s.id]) ? (
                            <span data-testid={`instant-tag-${s.id}`} style={{
                              marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#166534',
                              background: '#f0fdf4', border: '1px solid #86efac',
                              borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
                            }}>✓ code built — instant</span>
                          ) : s.compiledSequence?.approved ? (
                            <span data-testid={`translation-tag-${s.id}`} style={{
                              marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#1574C4',
                              background: '#e0efff', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
                            }} title="Approved compiled sequence — Generate translates it instead of reasoning from scratch (~2.5 min, ~$0.95)">approved → translation</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                  <div data-testid="cost-hint" style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    Cost: {costHint}
                  </div>
                  {/* Instant path — every selected station has pre-built code
                      from its approved sequence: Start = immediate download. */}
                  {nSelected > 0 && selectedSms.every(s => isPretranslatedReady(pretransById[s.id])) && (
                    <div data-testid="instant-note" style={{
                      marginTop: 6, fontSize: 11, fontWeight: 700, color: '#166534',
                      background: '#f0fdf4', border: '1px dashed #86efac',
                      borderRadius: 6, padding: '5px 10px',
                    }}>
                      ✓ Code already built from your approved sequence{nSelected > 1 ? 's' : ''} — instant
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tier 2 — Multi-station integration */}
            <div
              data-testid="tier-2"
              onClick={() => setTier(2)}
              style={{
                border: `2px solid ${tier === 2 ? 'var(--color-primary, #1574C4)' : '#e2e8f0'}`,
                borderRadius: 8, padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
                background: tier === 2 ? '#f0f7ff' : '#fff',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}>
                <input type="radio" name="jarvis-tier" checked={tier === 2} onChange={() => setTier(2)} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Multi-station integration</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#1574C4', background: '#e0efff', borderRadius: 4, padding: '1px 6px' }}>Tier 2</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 6px' }}>early</span>
              </label>
              <div style={{ fontSize: 11, color: '#475569', margin: '4px 0 0 24px' }}>
                Generates every selected station PLUS compiles their coordination
                (handshakes from the spec relationships).
              </div>
              {tier === 2 && (
                <div style={{ margin: '6px 0 0 24px', fontSize: 11, color: '#92400e' }}>
                  All {effectiveIds.length} stations with logic will be generated.
                  Coordination is compiled into each station; a machine-level supervisor is not included.
                  <div style={{ color: '#64748b', marginTop: 2 }}>Cost: {costHint}</div>
                </div>
              )}
            </div>

            {/* Tier 3 — Full machine code (disabled) */}
            <div
              data-testid="tier-3"
              aria-disabled="true"
              style={{
                border: '2px dashed #e2e8f0', borderRadius: 8, padding: '10px 12px',
                background: '#f8fafc', opacity: 0.7, cursor: 'not-allowed',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'not-allowed' }}>
                <input type="radio" name="jarvis-tier" disabled checked={false} readOnly />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>Full machine code</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', background: '#e2e8f0', borderRadius: 4, padding: '1px 6px' }}>Tier 3</span>
              </label>
              <div style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0 24px' }}>
                Supervisor, tracking, alarms, recipes — in development.
                Use Export Controller (legacy) meanwhile.
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ RUN / RESULT VIEW (original flow, per station) ═══════════ */}
        {!scoping && (
          <div className="modal__body" style={{ overflow: 'auto' }}>
            {/* Job summary */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
              <div style={{ flexShrink: 0 }}>
                <ProgressRing pct={pct} failed={phase === 'failed' || phase === 'cancelled'} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                  {currentSm?.displayName ?? currentSm?.name ?? 'No SM'}
                  <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 8, fontSize: 12 }}>{currentProgram}</span>
                </div>
                {runList.length > 1 && (
                  <div data-testid="overall-progress" style={{ fontSize: 12, color: '#475569', marginTop: 2, fontWeight: 600 }}>
                    Station {Math.min(runIndex + 1, runList.length)} of {runList.length}: {currentSm?.displayName ?? currentSm?.name}…
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                  {tier === 2 ? 'Multi-station integration (Tier 2)' : `Station sequence code (Tier 1) — ${runList.length} station${runList.length === 1 ? '' : 's'}`}
                </div>
                <div data-testid="stage-line" style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {running && (
                    <span aria-hidden="true" style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--color-primary, #1574C4)',
                      animation: 'jarvisPulse 1.4s ease-in-out infinite',
                    }} />
                  )}
                  <span>
                    {phase === 'cancelled' ? 'Cancelled'
                      : phase === 'failed' ? 'Failed'
                      : phase === 'done' ? 'Complete'
                      : (stage === 'model' || stage === 'repair')
                        ? (streamedTokens > 0
                            ? `Writing the edit plan — ${streamedTokens.toLocaleString()} tokens`
                            : 'SDC Engineer is reasoning through the sequence — the slow, important part (typically 3–6 min before writing starts)')
                        : (STAGE_LABELS[stage] ?? stage)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Elapsed {mmss}
                  <span> · {avgDuration
                    ? `typical station: ~${Math.max(1, Math.round(avgDuration / 60))} min total`
                    : 'typical station: 5–8 min total'}</span>
                  {totalCost > 0 && <span> · Cost ${totalCost.toFixed(2)}</span>}
                </div>
                {running && stalled && (
                  <div data-testid="stall-note" style={{
                    marginTop: 6, fontSize: 11, fontWeight: 600, color: '#92400e',
                    background: '#fef3c7', border: '1px solid #fde68a',
                    borderRadius: 6, padding: '4px 8px',
                  }}>
                    Connection may be stalled — no events for over 90 seconds (the server pings every 15s, so this stream is likely dead). Retry generation reconnects and re-runs this station; Cancel &amp; clean up stops the run.
                  </div>
                )}
              </div>
            </div>

            {/* Live status log */}
            <div style={{
              background: '#0f172a', color: '#cbd5e1', borderRadius: 6,
              fontFamily: 'Consolas, monospace', fontSize: 11, lineHeight: 1.6,
              padding: '8px 10px', maxHeight: 140, overflow: 'auto',
            }}
              ref={el => { if (el) el.scrollTop = el.scrollHeight; }}
            >
              {statusLines.map((l, i) => <div key={i}>{l}</div>)}
            </div>

            {/* Error (hard failure) */}
            {error && (
              <div style={{
                marginTop: 12, background: '#fef2f2', border: '1px solid #fca5a5',
                borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#991b1b',
              }}>
                <strong>Generation failed:</strong> {error}
              </div>
            )}

            {/* Per-station results — validation, saved path, score row */}
            {outcomes.filter(o => o.result || o.status !== 'done').map((o, idx) => {
              const result = o.result;
              const errors = result?.validation?.errors ?? [];
              const warnings = result?.validation?.warnings ?? [];
              const label = o.sm.displayName ?? o.sm.name;
              if (!result) {
                return (
                  <div key={o.sm.id} data-testid="station-result" style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12,
                    background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b',
                  }}>
                    {label} — {o.status === 'skipped' ? 'skipped (cancelled before start)'
                      : o.status === 'cancelled' ? 'cancelled mid-run'
                      : `failed: ${o.error ?? 'unknown error'}`}
                  </div>
                );
              }
              return (
                <div key={o.sm.id} data-testid="station-result" style={{ marginTop: 12 }}>
                  {outcomes.length > 1 && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                      {label} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({idx + 1} of {runList.length})</span>
                    </div>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6,
                    background: result.ok ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${result.ok ? '#86efac' : '#fca5a5'}`,
                    fontSize: 13, fontWeight: 700,
                    color: result.ok ? '#166534' : '#991b1b',
                  }}>
                    {result.ok ? '✓ Validation passed' : `✕ Validation failed — ${errors.length} error${errors.length === 1 ? '' : 's'}`}
                    <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 'auto', color: '#64748b' }}>
                      {result.meta?.attempts?.length ?? 1} attempt(s) · {warnings.length} warning(s)
                    </span>
                    {result.l5x && (
                      <button className="btn btn--secondary" style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => downloadResult(o.sm, result)}>
                        ↓ Save L5X
                      </button>
                    )}
                  </div>

                  {errors.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: '#991b1b', maxHeight: 120, overflow: 'auto' }}>
                      {errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}

                  {/* Where the file landed */}
                  {result.savedPath && (
                    <div style={{
                      marginTop: 10, background: '#f8fafc', border: '1px solid #e2e8f0',
                      borderRadius: 6, padding: '8px 12px', fontSize: 11,
                    }}>
                      <div style={{ fontWeight: 700, color: '#475569', marginBottom: 2 }}>Saved on this machine</div>
                      <div style={{ fontFamily: 'Consolas, monospace', color: '#0f172a', wordBreak: 'break-all', userSelect: 'all' }}>
                        {result.savedPath}
                      </div>
                    </div>
                  )}

                  {/* Score this build — every build gets scored by whoever ran it */}
                  {result.buildId && (
                    <div data-testid="station-score-row" style={{
                      marginTop: 10, background: '#f8fafc', border: '1px solid #e2e8f0',
                      borderRadius: 6, padding: '8px 12px',
                    }}>
                      {scored[result.buildId] ? (
                        <div data-testid="score-saved-note" style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>
                          ✓ Scored {scored[result.buildId].score} / 100 — saved to SDC Engineer's track record
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                            Score this build out of 100 (1 = unusable, 100 = ship it untouched)
                          </div>
                          <BuildScoreRow
                            buildId={result.buildId}
                            onScored={(b) => setScored(prev => ({ ...prev, [result.buildId]: b }))}
                          />
                        </>
                      )}
                    </div>
                  )}

                  {/* Review notes (*Replace items) */}
                  {(result.reviewNotes?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                        ⚠ Engineer review items ({result.reviewNotes.length})
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#78350f', maxHeight: 120, overflow: 'auto' }}>
                        {result.reviewNotes.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Tier 2 post-run note — cross-station signals SDC Engineer authored */}
            {finished && tier === 2 && (
              <div data-testid="cross-station-note" style={{
                marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#78350f',
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Cross-station signals SDC Engineer authored ({crossSignals.length})
                </div>
                {crossSignals.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {crossSignals.map((w, i) => (
                      <li key={i}>
                        {w.station} state {w.stateNumber}: waits on <strong>{w.signal ?? 'Ready'}</strong>
                        {w.partner ? ` from ${w.partner}` : ''} ({w.mode})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div>No cross-station waits found in the compiled IRs.</div>
                )}
                <div style={{ marginTop: 4, color: '#92400e' }}>
                  Coordination is compiled into each station; a machine-level supervisor is not included.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px' }}>
          {scoping && (
            <>
              <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
              <button
                className="btn btn--primary"
                data-testid="scope-start"
                disabled={nSelected === 0}
                onClick={handleStart}
              >
                Generate {nSelected} station{nSelected === 1 ? '' : 's'}
              </button>
            </>
          )}
          {running && (
            <>
              <button className="btn btn--secondary" onClick={handleCancel} data-testid="cancel-btn">
                {stalled ? 'Cancel & clean up' : 'Cancel Generation'}
              </button>
              {stalled && (
                <button className="btn btn--primary" onClick={handleRetry} data-testid="retry-btn">
                  Retry generation
                </button>
              )}
            </>
          )}
          {finished && (
            <>
              <button
                data-testid="see-all-generated-code"
                onClick={() => setCodeOpen(true)}
                title="Open the Generated code grid — every build: download, review, upload the corrected version"
                style={{
                  background: 'none', border: 'none', color: '#1574C4', fontSize: 12,
                  fontWeight: 600, cursor: 'pointer', textDecoration: 'underline',
                  marginRight: 'auto', padding: 0,
                }}
              >See all generated code →</button>
              <button className="btn btn--secondary" onClick={onClose}>Close</button>
            </>
          )}
        </div>
        {codeOpen && <JarvisPage onClose={() => setCodeOpen(false)} />}
      </div>
    </div>
  );
}
