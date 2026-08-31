/**
 * JarvisDescribeModal — Describe-your-station (text + pictures -> diagram draft).
 *
 * Big textarea + drag-and-drop image area (CAD screenshots). Images are
 * downscaled client-side to max 1568px long edge before base64 so requests
 * stay sane. Generate posts to POST /api/jarvis/diagram; while the (single)
 * request runs, a staged progress bar keeps the user informed. On success:
 * summary + the model's clarifying questions + "Open Draft" which loads the
 * saved draft project in a new tab via the existing store action.
 */

import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { downscaleImage } from '../../lib/imageUtils.js';

const MAX_IMAGES = 6;

// Staged progress while the single POST runs — honest about being staged:
// each stage advances on a timer, capped below the next stage boundary.
const STAGES = [
  { until: 15, label: 'Sending description to SDC ENGINEER…', ms: 1200 },
  { until: 75, label: 'SDC ENGINEER is authoring your station diagram…', ms: 90000 },
  { until: 90, label: 'Validating the draft project…', ms: 15000 },
];

export function JarvisDescribeModal({ onClose }) {
  const [description, setDescription] = useState('');
  const [images, setImages] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  // phase: 'input' | 'running' | 'done' | 'failed'
  const [phase, setPhase] = useState('input');
  const [pct, setPct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false);
  const fileInputRef = useRef(null);
  const timersRef = useRef([]);

  useEffect(() => () => timersRef.current.forEach(clearInterval), []);

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    try {
      const processed = await Promise.all(files.slice(0, MAX_IMAGES).map(downscaleImage));
      setImages(prev => [...prev, ...processed].slice(0, MAX_IMAGES));
    } catch (e) {
      alert(e.message);
    }
  }

  function startStagedProgress() {
    let current = 0;
    let stageIdx = 0;
    setStageLabel(STAGES[0].label);
    const tick = setInterval(() => {
      const stage = STAGES[Math.min(stageIdx, STAGES.length - 1)];
      const step = (stage.until - current) * (200 / stage.ms) + 0.05;
      current = Math.min(current + step, stage.until - 0.5);
      if (current >= stage.until - 1 && stageIdx < STAGES.length - 1) {
        stageIdx++;
        setStageLabel(STAGES[stageIdx].label);
      }
      setPct(current);
    }, 200);
    timersRef.current.push(tick);
    return () => clearInterval(tick);
  }

  async function handleGenerate() {
    if (!description.trim()) return;
    setPhase('running');
    setError(null);
    const stopProgress = startStagedProgress();
    try {
      const res = await fetch('/api/jarvis/diagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          images: images.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      stopProgress();
      if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setPct(100);
      setStageLabel('Draft ready');
      setResult(data);
      setPhase('done');
    } catch (e) {
      stopProgress();
      setError(e.message);
      setPhase('failed');
    }
  }

  async function handleOpenDraft() {
    if (!result?.filename) return;
    setOpening(true);
    try {
      await useDiagramStore.getState().openInNewTab(result.filename);
      onClose();
    } catch (e) {
      setOpening(false);
      alert('Could not open draft: ' + e.message);
    }
  }

  const running = phase === 'running';

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="modal" style={{ width: 620, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span>🎙 Describe Your Station (SDC ENGINEER)</span>
          <button className="icon-btn" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal__body" style={{ overflow: 'auto' }}>
          {phase === 'input' || phase === 'failed' ? (
            <>
              <label className="form-label">How does the station work?</label>
              <textarea
                className="form-input"
                autoFocus
                rows={8}
                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={'Talk through how the station works…\n\ne.g. "A pick-and-place with an X axis and Z axis. The Z drops to the pick nest, gripper closes on the part, Z retracts, X slides over to the fixture, Z drops, gripper opens, then everything returns home. There\'s a part-present sensor in the nest."'}
              />

              <label className="form-label" style={{ marginTop: 12 }}>
                Pictures (optional — CAD screenshots, layout sketches)
              </label>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--color-primary)' : '#cbd5e1'}`,
                  background: dragOver ? '#e8f0fa' : '#f8fafc',
                  borderRadius: 8, padding: images.length ? 10 : 22,
                  textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#64748b',
                  display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center',
                }}
              >
                {images.length === 0 && <span>Drag & drop images here, or click to browse (max {MAX_IMAGES}, auto-resized)</span>}
                {images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                    <img
                      src={img.previewUrl} alt={img.name} title={img.name}
                      style={{ width: 88, height: 66, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }}
                    />
                    <button
                      onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                      title="Remove"
                      style={{
                        position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                        borderRadius: '50%', border: 'none', background: '#334155', color: '#fff',
                        fontSize: 11, lineHeight: 1, cursor: 'pointer',
                      }}
                    >×</button>
                  </div>
                ))}
                {images.length > 0 && images.length < MAX_IMAGES && (
                  <span style={{ fontSize: 20, color: '#94a3b8', padding: '0 10px' }}>＋</span>
                )}
              </div>
              <input
                ref={fileInputRef} type="file" accept="image/*" multiple
                style={{ display: 'none' }}
                onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
              />

              {error && (
                <div style={{
                  marginTop: 12, background: '#fef2f2', border: '1px solid #fca5a5',
                  borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#991b1b',
                }}>
                  <strong>Draft generation failed:</strong> {error}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Progress / result */}
              <div style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{stageLabel}</span>
                  <span>{Math.floor(pct)}%</span>
                </div>
                <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: phase === 'done' ? 'var(--color-success)' : 'var(--color-primary)',
                    transition: 'width 0.25s ease',
                  }} />
                </div>
              </div>

              {result && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6,
                    padding: '10px 14px', fontSize: 12, color: '#166534',
                  }}>
                    <strong>✓ Draft created:</strong>{' '}
                    <span style={{ fontFamily: 'Consolas, monospace' }}>{result.filename}</span>
                    {typeof result.meta?.costUSD === 'number' && (
                      <span style={{ color: '#64748b' }}> · ${result.meta.costUSD.toFixed(2)}</span>
                    )}
                  </div>

                  {result.summary && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                      {result.summary}
                    </div>
                  )}

                  {(result.openQuestions?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                        ❓ SDC ENGINEER wants to clarify — review these before trusting the draft:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                        {result.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    </div>
                  )}

                  {(result.fixups?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
                      Auto-fixups applied: {result.fixups.join('; ')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px' }}>
          {phase === 'done' ? (
            <>
              <button className="btn btn--secondary" onClick={onClose}>Close</button>
              <button
                className="btn btn--primary"
                onClick={handleOpenDraft}
                disabled={opening}
              >
                {opening ? 'Opening…' : '📂 Open Draft'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn--secondary" onClick={onClose} disabled={running}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={handleGenerate}
                disabled={running || !description.trim()}
              >
                {running ? 'Generating…' : 'Generate Draft'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
