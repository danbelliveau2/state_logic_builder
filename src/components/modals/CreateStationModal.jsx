/**
 * CreateStationModal — describe-first station creation ("Create Station").
 *
 * Replaces the form-first New State Machine flow. The engineer gives the
 * station a name + number (tiny, top), then EXPLAINS the station in the
 * shared DescribeSurface (same surface as SpecEditorModal). A live
 * checklist on the right scores the explanation with LOCAL heuristics
 * (lib/coverageChecklist.js — debounced ~1.5s, zero API calls) so they can
 * see what a complete explanation still needs.
 *
 * Build runs BOTH extractions from the one description:
 *   1. POST /api/jarvis/diagram (station mode) -> ONE SM's devices/nodes/
 *      edges, drawn to Dan's layout rules — inserted into the CURRENT
 *      project via store actions (ids remapped to fresh uids).
 *   2. POST /api/jarvis/spec (with the freshly inserted devices as context)
 *      -> machineSpec, saved immediately with sourceDescription.
 * Then SpecEditorModal opens straight in its review phase (initial prop),
 * clarifying questions from BOTH extractions on top, with the drawn
 * station visible on the canvas behind it.
 *
 * "start blank instead" keeps the old NewStateMachineModal path for edge
 * cases. SDC palette only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';
import { COVERAGE_ITEMS, assessCoverage } from '../../lib/coverageChecklist.js';
import { DescribeSurface } from '../jarvis/DescribeSurface.jsx';
import { NewStateMachineModal } from './NewStateMachineModal.jsx';
import { SpecEditorModal } from './SpecEditorModal.jsx';

// SDC palette shorthands (src/index.css tokens)
const C = {
  primary: 'var(--color-primary)',
  primaryBg: '#e8f0fa',
  primaryBorder: '#a8c8e8',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  light: 'var(--color-text-light)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
};

const uid = () => `id_${crypto.randomUUID()}`;

/** Give every device/node/edge in a drafted SM fresh globally-unique ids
 *  (model drafts use short ids like "n1"/"d1" that could collide across
 *  SMs — device ids are looked up project-wide). Quoted-token replacement
 *  keeps every cross-reference (action deviceId, edge source/target, edge
 *  data deviceId) consistent. */
function remapSmIds(sm) {
  const map = new Map();
  for (const d of sm.devices ?? []) map.set(d.id, uid());
  for (const n of sm.nodes ?? []) map.set(n.id, uid());
  for (const e of sm.edges ?? []) map.set(e.id, uid());
  let json = JSON.stringify(sm);
  for (const [oldId, newId] of map) {
    json = json.split(`"${oldId}"`).join(`"${newId}"`);
  }
  return JSON.parse(json);
}

// Staged progress while the two POSTs run (honest about being staged —
// each stage creeps toward its cap; real events jump it forward).
const STAGES = [
  { until: 10, label: 'Sending your explanation to JARVIS…', ms: 1500 },
  { until: 62, label: 'JARVIS is drawing the station sequence…', ms: 90000 },
  { until: 70, label: 'Placing the station in this project…', ms: 3000 },
  { until: 92, label: 'JARVIS is extracting the station spec…', ms: 30000 },
];

function CoverageItem({ item, score, message, optional }) {
  const checked = score === 2;
  const partial = score === 1;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0' }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: `2px solid ${checked ? C.success : partial ? C.primaryBorder : C.border}`,
        background: checked ? C.success : partial ? C.primaryBg : 'transparent',
        color: checked ? '#fff' : partial ? C.primary : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        transition: 'background 0.25s, border-color 0.25s',
      }}>✓</span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, lineHeight: 1.35,
          color: checked ? C.text : partial ? C.text : C.muted,
        }}>
          {item.label}
          {optional && (
            <span style={{ fontWeight: 400, fontSize: 10, color: C.light }}> (optional — no other stations yet)</span>
          )}
        </div>
        {checked ? (
          <div style={{ fontSize: 10, color: C.success, lineHeight: 1.4 }}>covered</div>
        ) : (
          <div style={{ fontSize: 10, color: partial ? C.muted : C.light, lineHeight: 1.4 }}>
            {partial && <span style={{ fontStyle: 'italic' }}>mentioned briefly — </span>}
            {message ?? item.hint}
          </div>
        )}
      </div>
    </div>
  );
}

export function CreateStationModal() {
  const store = useDiagramStore();
  const sms = store.project?.stateMachines ?? [];
  const otherSms = sms; // the new SM doesn't exist yet — every SM is "other"
  const hasOtherSms = sms.length > 0;

  // mode: 'describe' | 'blank' (old form-first flow)
  const [mode, setMode] = useState('describe');
  // phase: 'input' | 'building' | 'review' | 'specFailed'
  const [phase, setPhase] = useState('input');
  const [name, setName] = useState('');
  const [station, setStation] = useState(() => {
    const next = sms.reduce((m, s) => Math.max(m, Number(s.stationNumber) || 0), 0) + 1;
    return String(next);
  });
  const [description, setDescription] = useState('');
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [pct, setPct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [reviewInitial, setReviewInitial] = useState(null);
  const [specFailMsg, setSpecFailMsg] = useState('');

  // Live checklist — LOCAL heuristics only, debounced ~1.5s of idle typing.
  const [coverage, setCoverage] = useState(() => assessCoverage(''));
  const scores = coverage.scores;
  const otherSmNames = useMemo(
    () => sms.map(s => s.displayName ?? s.name),
    [sms],
  );
  useEffect(() => {
    if (!description.trim()) {
      setCoverage(assessCoverage(''));
      return;
    }
    const t = setTimeout(() => {
      setCoverage(assessCoverage(description, { otherSmNames }));
    }, 1500);
    return () => clearTimeout(t);
  }, [description, otherSmNames]);

  const timersRef = useRef([]);
  useEffect(() => () => timersRef.current.forEach(clearInterval), []);

  // The checklist GATES Build: every required item must be fully checked
  // (partial = not satisfied). "Interacts with other stations" drops out of
  // the gate (and the denominator) when the project has no other stations.
  const applicable = COVERAGE_ITEMS.filter(i => !(i.optionalWhenAlone && !hasOtherSms));
  const covered = applicable.filter(i => scores[i.key] === 2).length;
  const allCovered = covered === applicable.length;

  const preview = name ? buildProgramName(station || 1, name.replace(/[^a-zA-Z0-9_]/g, '')) : '—';
  const canBuild = !!name.trim() && !!description.trim() && allCovered;

  function startStagedProgress() {
    let current = 0;
    let stageIdx = 0;
    setStageLabel(STAGES[0].label);
    const tick = setInterval(() => {
      const stage = STAGES[Math.min(stageIdx, STAGES.length - 1)];
      const step = (stage.until - current) * (200 / stage.ms) + 0.04;
      current = Math.min(current + step, stage.until - 0.5);
      setPct(current);
    }, 200);
    timersRef.current.push(tick);
    return {
      jumpTo(idx, floor) {
        stageIdx = idx;
        current = Math.max(current, floor);
        setStageLabel(STAGES[idx].label);
      },
      stop() { clearInterval(tick); },
    };
  }

  async function handleBuild() {
    if (!canBuild) return;
    setPhase('building');
    setError(null);
    const cleanName = name.trim().replace(/\s+/g, '');
    const stationNumber = Number(station) || 1;
    const prog = startStagedProgress();
    let smId = null;
    let desc = description.trim();
    try {
      // ── 1. Draw the station (one SM, Dan's layout rules) ────────────────
      prog.jumpTo(1, 8);
      const dRes = await fetch('/api/jarvis/diagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: desc,
          images: images.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
          station: {
            name: cleanName,
            displayName: name.trim(),
            stationNumber,
            otherSms: otherSms.map(s => ({ name: s.name, displayName: s.displayName ?? s.name })),
          },
        }),
      });
      const dData = await dRes.json().catch(() => ({}));
      if (!dRes.ok || !dData.ok) throw new Error(dData.error || `Diagram request failed (${dRes.status})`);

      // ── 2. Insert into the CURRENT project via store actions ────────────
      prog.jumpTo(2, 63);
      const drafted = remapSmIds(dData.sm);
      smId = store.addStateMachine({
        name: cleanName,
        stationNumber,
        description: drafted.description ?? '',
      });
      store.updateStateMachine(smId, {
        displayName: name.trim(),
        devices: drafted.devices ?? [],
        nodes: drafted.nodes ?? [],
        edges: drafted.edges ?? [],
        // Station exists from this moment — description saved with it even
        // if the spec extraction below fails.
        machineSpec: { version: 1, sourceDescription: desc },
      });
      if ((drafted.devices ?? []).some(d => d.type === 'VisionSystem')) {
        store.syncVisionPartTracking?.(smId);
      }

      // ── 3. Extract the spec against the freshly inserted devices ────────
      prog.jumpTo(3, 71);
      const drawnSteps = (drafted.nodes ?? [])
        .map(n => n.data?.label || '')
        .filter(Boolean);
      let sData = null;
      try {
        const sRes = await fetch('/api/jarvis/spec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: desc,
            images: images.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
            sm: {
              id: smId,
              name: cleanName,
              displayName: name.trim(),
              devices: (drafted.devices ?? []).map(d => ({
                id: d.id, name: d.name, displayName: d.displayName, type: d.type,
                sensorArrangement: d.sensorArrangement,
              })),
              drawnSteps,
            },
            otherSms: otherSms.map(s => ({ id: s.id, name: s.name, displayName: s.displayName ?? s.name })),
            existingSpec: null,
          }),
        });
        sData = await sRes.json().catch(() => ({}));
        if (!sRes.ok || !sData.ok) throw new Error(sData.error || `Spec request failed (${sRes.status})`);
      } catch (specErr) {
        // Station is drawn and saved — spec can be re-run later from
        // Jarvis ▾ -> Station Spec. Don't throw the whole build away.
        prog.stop();
        setSpecFailMsg(specErr.message);
        setPhase('specFailed');
        return;
      }

      // ── 4. Save machineSpec (sourceDescription included) ────────────────
      store.updateStateMachine(smId, {
        machineSpec: { ...sData.spec, sourceDescription: desc },
      });

      prog.stop();
      setPct(100);
      const totalCost =
        (Number(dData.meta?.costUSD) || 0) + (Number(sData.meta?.costUSD) || 0);
      setReviewInitial({
        spec: sData.spec,
        proposedDevices: sData.proposedDevices ?? [],
        unmentionedDeviceIds: sData.unmentionedDeviceIds ?? [],
        questions: [
          ...(dData.openQuestions ?? []),
          ...(sData.questions ?? []),
        ],
        meta: { ...(sData.meta ?? {}), costUSD: totalCost },
      });
      setPhase('review');
    } catch (e) {
      prog.stop();
      setError(e.message);
      setPhase('input');
    }
  }

  function handleClose() {
    if (phase === 'building') return;
    store.closeNewSmModal();
  }

  // ── Old blank flow, kept for edge cases ────────────────────────────────
  if (mode === 'blank') return <NewStateMachineModal />;

  // ── Review: reuse SpecEditorModal's review phase on the new (active) SM ─
  if (phase === 'review' && reviewInitial) {
    return <SpecEditorModal initial={reviewInitial} onClose={() => store.closeNewSmModal()} />;
  }

  const building = phase === 'building';

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" style={{ width: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span>Create Station</span>
          <button className="icon-btn" onClick={handleClose} disabled={building}>✕</button>
        </div>

        <div className="modal__body" style={{ overflow: 'auto', padding: '14px 20px' }}>

          {phase === 'input' && (
            <>
              {/* Tiny top row: name + number */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ marginTop: 0 }}>Station Name *</label>
                  <input
                    className="form-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. MagnetFeed"
                  />
                </div>
                <div style={{ width: 110 }}>
                  <label className="form-label" style={{ marginTop: 0 }}>Number *</label>
                  <input
                    className="form-input"
                    type="number" min="1" max="99"
                    value={station}
                    onChange={e => setStation(e.target.value)}
                  />
                </div>
                <div style={{
                  fontSize: 10, color: C.light, paddingBottom: 8, whiteSpace: 'nowrap',
                  fontFamily: 'Consolas, monospace',
                }} title="Program name (L5X)">
                  {preview}
                </div>
              </div>

              {/* Describe surface + live checklist */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DescribeSurface
                    description={description}
                    onDescriptionChange={setDescription}
                    images={images}
                    onImagesChange={setImages}
                    rows={11}
                    autoFocus={false}
                    error={error}
                    errorTitle="Build failed:"
                  />
                </div>

                <div style={{
                  width: 232, flexShrink: 0, position: 'sticky', top: 0,
                  border: `1px solid ${C.border}`, borderRadius: 8,
                  background: 'var(--color-sidebar)', padding: '10px 14px',
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: C.muted,
                    letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2,
                  }}>
                    A complete explanation covers
                  </div>
                  {COVERAGE_ITEMS.map(item => (
                    <CoverageItem
                      key={item.key}
                      item={item}
                      score={scores[item.key]}
                      message={coverage.messages[item.key]}
                      optional={item.optionalWhenAlone && !hasOtherSms}
                    />
                  ))}
                  <div style={{ fontSize: 10, color: C.light, marginTop: 4, lineHeight: 1.4 }}>
                    Checks off live as you type — nothing is sent until you Build.
                  </div>
                </div>
              </div>
            </>
          )}

          {phase === 'building' && (
            <div style={{ padding: '30px 8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: C.text }}>{stageLabel}</span>
                <span>{Math.floor(pct)}%</span>
              </div>
              <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct}%`, background: C.primary,
                  transition: 'width 0.25s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: C.light, marginTop: 10, lineHeight: 1.5 }}>
                Two extractions run from your one explanation: the drawn station
                sequence (devices, states, branches) and the station spec
                (purpose, failure handling, relationships).
              </div>
            </div>
          )}

          {phase === 'specFailed' && (
            <div style={{ padding: '8px 0' }}>
              <div style={{
                background: C.primaryBg, border: `1px solid ${C.primaryBorder}`,
                borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.text, marginBottom: 10,
              }}>
                <strong>Station drawn and created.</strong> The sequence is on the canvas
                and your explanation is saved with the station.
              </div>
              <div style={{
                background: '#fdf6e3', border: '1px solid #e6d9a8',
                borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#6b5513',
              }}>
                Spec extraction failed: {specFailMsg}
                <div style={{ marginTop: 4 }}>
                  Run it later from <strong>Jarvis ▾ → Station Spec</strong> — your
                  explanation is already filled in there.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 20px' }}>
          {phase === 'input' && (
            <>
              <button
                type="button"
                onClick={() => setMode('blank')}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 11, color: C.light, textDecoration: 'underline', marginRight: 'auto',
                }}
              >
                start blank instead
              </button>
              {!allCovered && (
                <span style={{ fontSize: 11, color: C.muted }}>
                  {covered} of {applicable.length} covered — complete the checklist to build
                </span>
              )}
              <button className="btn btn--secondary" onClick={handleClose}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={handleBuild}
                disabled={!canBuild}
                title={allCovered ? undefined : 'Complete the checklist to build'}
                style={{
                  transition: 'background 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease',
                  boxShadow: canBuild ? `0 0 0 3px ${C.primaryBg}` : 'none',
                }}
              >
                Build Station
              </button>
            </>
          )}
          {phase === 'building' && (
            <button className="btn btn--secondary" style={{ marginLeft: 'auto' }} disabled>
              Building…
            </button>
          )}
          {phase === 'specFailed' && (
            <button className="btn btn--primary" style={{ marginLeft: 'auto' }} onClick={() => store.closeNewSmModal()}>
              Open the Station
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
