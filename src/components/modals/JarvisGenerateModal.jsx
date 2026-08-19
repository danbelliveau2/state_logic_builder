/**
 * JarvisGenerateModal — AI (JARVIS) L5X generation with live progress.
 *
 * Flow (Dan's ask): click Generate -> a wheel that counts 8% ... 100% ->
 * "here it is" -> the file path where it landed + a Save L5X download.
 *
 * The modal saves the current project to the server (the pipeline reads it
 * by filename), then opens an SSE connection to GET /api/generate/stream.
 * Progress events drive the ring; the `done` event carries the full result
 * (validation, review notes, cost, server-saved path). Cancel closes the
 * EventSource, which aborts the model stream server-side.
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';
import { ProgressRing } from '../jarvis/ProgressRing.jsx';

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

export function JarvisGenerateModal({ onClose }) {
  const store = useDiagramStore();
  const project = store.project;
  const sm = store.getActiveSm();
  const sms = project?.stateMachines ?? [];

  // phase: 'running' | 'done' | 'failed' | 'cancelled'
  const [phase, setPhase] = useState('running');
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState('start');
  const [statusLines, setStatusLines] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const esRef = useRef(null);
  const startRef = useRef(Date.now());
  const doneRef = useRef(false);

  const programName = sm ? buildProgramName(sm.stationNumber, sm.name) : '—';
  const tier = sms.length === 1 ? 'Station code (1 state machine)' : `Multi-SM project — generating active SM only (${sms.length} SMs total)`;

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => {
      if (!doneRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const pushStatus = (line) => setStatusLines(prev => {
    if (prev.length && prev[prev.length - 1] === line) return prev;
    return [...prev.slice(-80), line];
  });

  // Kick off generation on mount: save project (pipeline reads by filename),
  // then open the SSE stream.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!sm) throw new Error('No state machine selected.');
        pushStatus('Saving project to server…');
        await store.saveCurrentProject();
        const filename = useDiagramStore.getState().currentFilename;
        if (!filename) throw new Error('Project has no server filename — save the project first (server must be running).');
        if (cancelled) return;

        pushStatus(`Starting JARVIS generation for ${programName}…`);
        const es = new EventSource(
          `/api/generate/stream?filename=${encodeURIComponent(filename)}&smId=${encodeURIComponent(sm.id)}`
        );
        esRef.current = es;

        es.addEventListener('progress', (ev) => {
          try {
            const d = JSON.parse(ev.data);
            setPct(d.pct);
            setStage(d.stage);
            if (d.detail) pushStatus(d.detail);
          } catch (_) {}
        });
        es.addEventListener('done', (ev) => {
          doneRef.current = true;
          try {
            const d = JSON.parse(ev.data);
            setResult(d);
            setPct(100);
            setPhase(d.ok ? 'done' : 'failed');
            pushStatus(d.ok ? 'Generation complete.' : 'Finished — validation reported errors.');
          } catch (e) {
            setError('Could not parse result: ' + e.message);
            setPhase('failed');
          }
          es.close();
        });
        es.addEventListener('error', (ev) => {
          // Server-sent error event carries data; transport errors don't.
          if (ev.data) {
            try { setError(JSON.parse(ev.data).error); } catch { setError('Generation failed.'); }
          } else if (!doneRef.current) {
            setError('Connection to the generation server was lost.');
          }
          if (!doneRef.current) { doneRef.current = true; setPhase('failed'); }
          es.close();
        });
      } catch (e) {
        setError(e.message);
        setPhase('failed');
        doneRef.current = true;
      }
    })();
    return () => { cancelled = true; esRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCancel() {
    esRef.current?.close(); // server aborts the SDK stream on close
    doneRef.current = true;
    setPhase('cancelled');
    pushStatus('Cancelled by user.');
  }

  function handleDownload() {
    if (!result?.l5x) return;
    const smName = result.meta?.smName || sm?.name || 'StateMachine';
    const blob = new Blob([result.l5x], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${buildProgramName(sm?.stationNumber ?? 1, smName)}_JARVIS.L5X`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const running = phase === 'running';
  const cost = result?.meta?.costEstimate?.totalUSD;
  const errors = result?.validation?.errors ?? [];
  const warnings = result?.validation?.warnings ?? [];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="modal" style={{ width: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span>✨ Generate with JARVIS</span>
          <button className="icon-btn" onClick={() => { if (running) handleCancel(); onClose(); }}>✕</button>
        </div>

        <div className="modal__body" style={{ overflow: 'auto' }}>
          {/* Job summary */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ flexShrink: 0 }}>
              <ProgressRing pct={pct} failed={phase === 'failed' || phase === 'cancelled'} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                {sm?.displayName ?? sm?.name ?? 'No SM'}
                <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 8, fontSize: 12 }}>{programName}</span>
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{tier}</div>
              <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, marginTop: 8 }}>
                {phase === 'cancelled' ? 'Cancelled'
                  : phase === 'failed' ? 'Failed'
                  : phase === 'done' ? 'Complete'
                  : (STAGE_LABELS[stage] ?? stage)}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                Elapsed {mmss}
                {typeof cost === 'number' && <span> · Cost ${cost.toFixed(2)}</span>}
                {result?.meta?.model && <span> · {result.meta.model}</span>}
              </div>
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

          {/* Result — validation summary */}
          {result && (
            <div style={{ marginTop: 12 }}>
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
          )}
        </div>

        <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px' }}>
          {running ? (
            <button className="btn btn--secondary" onClick={handleCancel}>Cancel Generation</button>
          ) : (
            <>
              <button className="btn btn--secondary" onClick={onClose}>Close</button>
              {result?.l5x && (
                <button
                  className="btn btn--primary"
                  onClick={handleDownload}
                >
                  ↓ Save L5X
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
