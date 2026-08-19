/**
 * CreateStationPage — describe-first station creation, as a FULL PAGE.
 *
 * Round-2 rework of CreateStationModal (which this supersedes) after Dan's
 * real-world test:
 *   1. Full-viewport page, not a popup: opaque, fills the app, NO
 *      overlay-click dismissal. Explicit "← Back" in the header, with a
 *      confirm when there's content (nothing is ever lost — see 2).
 *   2. Never lose work: the whole draft (name, number, description, images,
 *      phase, summary) autosaves ~1s-debounced to
 *      localStorage['jarvis.createStationDraft.{projectKey}'] and is
 *      silently restored next time the page opens. Cleared only after a
 *      successful Build or explicit "Discard draft". Stored images are
 *      capped at ~4MB total base64 (oldest dropped, with a notice).
 *   3. Clipboard paste: DescribeSurface mounts a window-level paste
 *      listener, so Ctrl+V of a Snipping Tool capture lands as a thumbnail
 *      no matter where focus is (and never dumps junk into the textarea).
 *   4. "Done explaining →" summary loop: POST /api/jarvis/summarize returns
 *      a cleaned restatement (editable working text), per-checklist-item
 *      coverage verdicts (which REPLACE the local heuristics from then on),
 *      and 2-4 follow-up questions. The engineer types OR dictates
 *      corrections -> "Apply changes" re-summarizes -> iterate -> add
 *      pictures -> Build. Build then runs on the SUMMARY (+ the original
 *      appended as reference). The old direct path (heuristic-gated Build
 *      straight from the raw text) still works if Done explaining is never
 *      clicked.
 *
 * Build inserts the drawn SM into the CURRENT project via store actions and
 * then extracts the spec — identical to the modal's pipeline.
 * "start blank instead" keeps the classic NewStateMachineModal path.
 * SDC palette only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';
import { COVERAGE_ITEMS, assessCoverage } from '../../lib/coverageChecklist.js';
import { DescribeSurface, useDictation, MicButton, ListeningIndicator } from './DescribeSurface.jsx';
import { NewStateMachineModal } from '../modals/NewStateMachineModal.jsx';
import { SpecEditorModal } from '../modals/SpecEditorModal.jsx';

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

// ── Draft persistence (never lose work) ─────────────────────────────────────

const DRAFT_IMAGE_BASE64_CAP = 4 * 1024 * 1024; // ~4MB of base64 chars

function draftKeyFor(store) {
  const projectKey = store.currentFilename || store.project?.name || 'default';
  return `jarvis.createStationDraft.${projectKey}`;
}

function loadDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return null;
    return d;
  } catch { return null; }
}

/** Serialize the draft, capping stored images at ~4MB base64 total
 *  (oldest dropped first). Returns { json, droppedImages }. */
function serializeDraft(draft) {
  const imgs = [];
  let total = 0;
  // newest-first keep, then restore original order
  for (let i = draft.images.length - 1; i >= 0; i--) {
    const img = draft.images[i];
    const len = (img.base64 || '').length;
    if (total + len > DRAFT_IMAGE_BASE64_CAP) break; // this and everything older is dropped
    total += len;
    imgs.unshift({ name: img.name, base64: img.base64, mediaType: img.mediaType });
  }
  const droppedImages = draft.images.length - imgs.length;
  const json = JSON.stringify({ ...draft, v: 1, savedAt: Date.now(), images: imgs });
  return { json, droppedImages };
}

// ── Insert helpers (unchanged from the modal) ───────────────────────────────

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

// ── Checklist rendering ─────────────────────────────────────────────────────

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

function ChecklistPanel({ scores, messages, hasOtherSms, sourceLabel }) {
  return (
    <div style={{
      width: 244, flexShrink: 0, position: 'sticky', top: 12,
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
          message={messages[item.key]}
          optional={item.optionalWhenAlone && !hasOtherSms}
        />
      ))}
      <div style={{ fontSize: 10, color: C.light, marginTop: 4, lineHeight: 1.4 }}>
        {sourceLabel}
      </div>
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function CreateStationPage() {
  const store = useDiagramStore();
  const sms = store.project?.stateMachines ?? [];
  const otherSms = sms; // the new SM doesn't exist yet — every SM is "other"
  const hasOtherSms = sms.length > 0;
  const draftKey = draftKeyFor(store);

  // Restore the draft ONCE, synchronously, before first paint of the fields.
  const draftRef = useRef(undefined);
  if (draftRef.current === undefined) draftRef.current = loadDraft(draftKey);
  const draft = draftRef.current;

  // mode: 'describe' | 'blank' (old form-first flow)
  const [mode, setMode] = useState('describe');
  // phase: 'input' | 'summarizing' | 'summary' | 'building' | 'review' | 'specFailed'
  const [phase, setPhase] = useState(() =>
    (draft && draft.phase === 'summary' && draft.summary) ? 'summary' : 'input');
  const [name, setName] = useState(draft?.name ?? '');
  const [station, setStation] = useState(() => {
    if (draft?.station) return String(draft.station);
    const next = sms.reduce((m, s) => Math.max(m, Number(s.stationNumber) || 0), 0) + 1;
    return String(next);
  });
  const [description, setDescription] = useState(draft?.description ?? '');
  const [images, setImages] = useState(() =>
    (draft?.images ?? []).map(img => ({
      ...img,
      previewUrl: `data:${img.mediaType};base64,${img.base64}`,
    })));
  const [draftNote, setDraftNote] = useState(!!draft);
  const [draftImagesDropped, setDraftImagesDropped] = useState(0);

  // Summary loop state
  const [summary, setSummary] = useState(draft?.summary ?? '');
  const [jarvisCoverage, setJarvisCoverage] = useState(draft?.jarvisCoverage ?? null);
  const [questions, setQuestions] = useState(draft?.questions ?? []);
  const [changes, setChanges] = useState('');
  const [applying, setApplying] = useState(false);
  const [summarizeCost, setSummarizeCost] = useState(draft?.summarizeCost ?? 0);
  const [pulseDone, setPulseDone] = useState(false);

  const [error, setError] = useState(null);
  const [pct, setPct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [reviewInitial, setReviewInitial] = useState(null);
  const [specFailMsg, setSpecFailMsg] = useState('');

  // ── Live checklist — LOCAL heuristics, debounced ~1.5s (input phase) ─────
  const [coverage, setCoverage] = useState(() => assessCoverage(draft?.description ?? ''));
  const otherSmNames = useMemo(() => sms.map(s => s.displayName ?? s.name), [sms]);
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

  // ── Draft autosave (debounced ~1s) ───────────────────────────────────────
  const buildSucceededRef = useRef(false);
  useEffect(() => {
    if (phase === 'building' || phase === 'review' || phase === 'specFailed') return;
    const t = setTimeout(() => {
      if (buildSucceededRef.current) return;
      const hasContent = description.trim() || images.length || summary.trim() || name.trim();
      try {
        if (!hasContent) {
          localStorage.removeItem(draftKey);
          return;
        }
        const { json, droppedImages } = serializeDraft({
          name, station, description, images,
          phase: phase === 'summary' || phase === 'summarizing' ? 'summary' : 'input',
          summary, jarvisCoverage, questions, summarizeCost,
        });
        localStorage.setItem(draftKey, json);
        setDraftImagesDropped(droppedImages);
      } catch {
        // Quota exceeded — retry the draft without images so the TEXT survives.
        try {
          const { json } = serializeDraft({
            name, station, description, images: [],
            phase: phase === 'summary' ? 'summary' : 'input',
            summary, jarvisCoverage, questions, summarizeCost,
          });
          localStorage.setItem(draftKey, json);
          setDraftImagesDropped(images.length);
        } catch { /* storage entirely unavailable — nothing more we can do */ }
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [name, station, description, images, phase, summary, jarvisCoverage, questions, summarizeCost, draftKey]);

  function clearDraft() {
    try { localStorage.removeItem(draftKey); } catch { /* noop */ }
  }

  function handleDiscardDraft() {
    if (!window.confirm('Discard this draft? The explanation, summary and pictures will be deleted.')) return;
    clearDraft();
    buildSucceededRef.current = false;
    setName(''); setDescription(''); setImages([]);
    setSummary(''); setJarvisCoverage(null); setQuestions([]); setChanges('');
    setSummarizeCost(0); setError(null); setDraftNote(false); setDraftImagesDropped(0);
    setPhase('input');
  }

  // ── Gating ───────────────────────────────────────────────────────────────
  const applicable = COVERAGE_ITEMS.filter(i => !(i.optionalWhenAlone && !hasOtherSms));
  // Once a Jarvis summary exists AND we're in the summary phase, Jarvis's
  // verdicts replace the local heuristics. Heuristics keep running for the
  // live-typing (input) phase.
  const usingJarvisVerdicts = phase === 'summary' && !!jarvisCoverage;
  const effScores = usingJarvisVerdicts
    ? Object.fromEntries(COVERAGE_ITEMS.map(i => [i.key, jarvisCoverage[i.key]?.score ?? 0]))
    : coverage.scores;
  const effMessages = usingJarvisVerdicts
    ? Object.fromEntries(COVERAGE_ITEMS.map(i => [i.key, jarvisCoverage[i.key]?.missing || undefined]))
    : coverage.messages;
  const covered = applicable.filter(i => effScores[i.key] === 2).length;
  const allCovered = covered === applicable.length;

  const preview = name ? buildProgramName(station || 1, name.replace(/[^a-zA-Z0-9_]/g, '')) : '—';
  const canBuild = !!name.trim()
    && !!(usingJarvisVerdicts ? summary.trim() : description.trim())
    && allCovered;

  // ── Summarize loop ───────────────────────────────────────────────────────
  async function callSummarize({ priorSummary = '', corrections = '' } = {}) {
    const res = await fetch('/api/jarvis/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: description.trim(),
        images: images.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
        checklist: coverage.scores,
        sm: { name: name.trim().replace(/\s+/g, ''), displayName: name.trim() || 'New Station' },
        otherSms: otherSms.map(s => ({ name: s.name, displayName: s.displayName ?? s.name })),
        priorSummary,
        corrections,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Summarize request failed (${res.status})`);
    setSummary(data.summary);
    setJarvisCoverage(data.coverage);
    setQuestions(data.questions ?? []);
    setSummarizeCost(c => Number((c + (Number(data.meta?.costUSD) || 0)).toFixed(4)));
  }

  async function handleDoneExplaining() {
    if (!description.trim()) return;
    setError(null);
    setPhase('summarizing');
    try {
      await callSummarize();
      setPhase('summary');
    } catch (e) {
      setError(e.message);
      setPhase('input');
    }
  }

  async function handleApplyChanges() {
    if (!changes.trim()) return;
    setError(null);
    setApplying(true);
    try {
      await callSummarize({ priorSummary: summary, corrections: changes.trim() });
      setChanges('');
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  // Corrections input dictation (reuses the DescribeSurface implementation)
  const changesRef = useRef(null);
  const changesDictation = useDictation({
    value: changes,
    onChange: setChanges,
    textareaRef: changesRef,
  });

  // ── Build (same pipeline as the modal) ───────────────────────────────────
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
    const returnPhase = usingJarvisVerdicts ? 'summary' : 'input';
    setPhase('building');
    setError(null);
    const cleanName = name.trim().replace(/\s+/g, '');
    const stationNumber = Number(station) || 1;
    const prog = startStagedProgress();
    let smId = null;
    // Once a summary exists, IT is the build input — the raw explanation
    // rides along as reference so nothing the engineer said is lost.
    const desc = usingJarvisVerdicts
      ? `${summary.trim()}\n\n---\nOriginal explanation (reference only — the summary above is authoritative):\n\n${description.trim()}`
      : description.trim();
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
      // The station now exists in the project — the draft has served its
      // purpose (this holds even if the spec call below fails).
      buildSucceededRef.current = true;
      clearDraft();

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
      setPhase(returnPhase);
    }
  }

  // ── Back / leave ─────────────────────────────────────────────────────────
  function handleBack() {
    if (phase === 'building' || phase === 'summarizing') return;
    const hasContent = description.trim() || images.length > 0 || summary.trim();
    if (hasContent && !window.confirm('Your explanation is saved as a draft — leave anyway?')) return;
    store.closeNewSmModal();
  }

  // ── Old blank flow, kept for edge cases ─────────────────────────────────
  if (mode === 'blank') return <NewStateMachineModal />;

  // ── Review: reuse SpecEditorModal's review phase on the new (active) SM ──
  if (phase === 'review' && reviewInitial) {
    return <SpecEditorModal initial={reviewInitial} onClose={() => store.closeNewSmModal()} />;
  }

  const busy = phase === 'building' || phase === 'summarizing';
  const inSummary = phase === 'summary';

  return (
    <div
      data-testid="create-station-page"
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 18px', background: '#fff', borderBottom: `1px solid ${C.border}`,
      }}>
        <button
          type="button"
          data-testid="create-station-back"
          onClick={handleBack}
          disabled={busy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '5px 12px', fontSize: 12, fontWeight: 600,
            color: busy ? C.light : C.muted, cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Create Station</span>
        {inSummary && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: C.primary, background: C.primaryBg,
            border: `1px solid ${C.primaryBorder}`, borderRadius: 10, padding: '2px 9px',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            JARVIS summary — review &amp; refine
          </span>
        )}
        <span style={{
          marginLeft: 'auto', fontSize: 10, color: C.light,
          fontFamily: 'Consolas, monospace', whiteSpace: 'nowrap',
        }} title="Program name (L5X)">
          {preview}
        </span>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto', padding: '16px 24px 40px' }}>

          {draftNote && (
            <div
              data-testid="draft-restored-note"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
                background: C.primaryBg, border: `1px solid ${C.primaryBorder}`,
                borderRadius: 6, padding: '7px 12px', fontSize: 12, color: C.text,
              }}
            >
              <span style={{ flex: 1 }}>Draft restored from your last session.</span>
              <button
                type="button"
                onClick={handleDiscardDraft}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 11, color: C.danger, textDecoration: 'underline',
                }}
              >Discard draft</button>
              <button
                type="button"
                onClick={() => setDraftNote(false)}
                title="Dismiss"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: C.muted, lineHeight: 1, padding: '0 2px',
                }}
              >✕</button>
            </div>
          )}
          {draftImagesDropped > 0 && (
            <div style={{
              marginBottom: 12, fontSize: 11, color: '#6b5513',
              background: '#fdf6e3', border: '1px solid #e6d9a8',
              borderRadius: 6, padding: '6px 12px',
            }}>
              Draft too large for local storage — the oldest {draftImagesDropped} image{draftImagesDropped > 1 ? 's are' : ' is'} not
              kept in the draft (everything else is safe).
            </div>
          )}

          {/* Tiny top row: name + number */}
          {(phase === 'input' || phase === 'summarizing' || inSummary) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
              <div style={{ flex: 1, maxWidth: 340 }}>
                <label className="form-label" style={{ marginTop: 0 }}>Station Name *</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. MagnetFeed"
                  disabled={busy}
                />
              </div>
              <div style={{ width: 110 }}>
                <label className="form-label" style={{ marginTop: 0 }}>Number *</label>
                <input
                  className="form-input"
                  type="number" min="1" max="99"
                  value={station}
                  onChange={e => setStation(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          )}

          {/* ══ INPUT phase — raw explanation + heuristic checklist ══ */}
          {(phase === 'input' || phase === 'summarizing') && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <DescribeSurface
                  description={description}
                  onDescriptionChange={setDescription}
                  images={images}
                  onImagesChange={setImages}
                  rows={13}
                  autoFocus={false}
                  error={error}
                  errorTitle="Request failed:"
                  onDictationEnd={() => setPulseDone(true)}
                />

                {/* Action row */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => setMode('blank')}
                    disabled={busy}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 11, color: C.light, textDecoration: 'underline', marginRight: 'auto',
                    }}
                  >
                    start blank instead
                  </button>
                  {(description.trim() || images.length > 0) && (
                    <button
                      type="button"
                      onClick={handleDiscardDraft}
                      disabled={busy}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        fontSize: 11, color: C.muted, textDecoration: 'underline',
                      }}
                    >
                      Discard draft
                    </button>
                  )}
                  <button
                    className="btn btn--secondary"
                    onClick={handleBuild}
                    disabled={!canBuild || busy}
                    title={allCovered
                      ? 'Build straight from the raw explanation (skips the summary review)'
                      : 'Complete the checklist to build'}
                  >
                    Build without summary
                  </button>
                  <button
                    className="btn btn--primary"
                    data-testid="done-explaining-btn"
                    onClick={handleDoneExplaining}
                    disabled={!description.trim() || busy}
                    style={{
                      fontSize: 14, padding: '9px 22px',
                      transition: 'box-shadow 0.35s ease, opacity 0.35s ease',
                      boxShadow: pulseDone && description.trim() && !busy
                        ? `0 0 0 4px ${C.primaryBg}, 0 0 14px 2px ${C.primaryBorder}`
                        : description.trim() && !busy ? `0 0 0 3px ${C.primaryBg}` : 'none',
                      animation: pulseDone && description.trim() && !busy
                        ? 'sdc-mic-pulse 1.6s ease-in-out 3' : 'none',
                    }}
                  >
                    {phase === 'summarizing' ? 'JARVIS is reading…' : 'Done explaining →'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: C.light, marginTop: 8, textAlign: 'right', lineHeight: 1.5 }}>
                  JARVIS restates your explanation cleanly, marks what's still
                  missing, and asks a few questions — then you Build from the reviewed summary.
                </div>
              </div>

              <ChecklistPanel
                scores={effScores}
                messages={effMessages}
                hasOtherSms={hasOtherSms}
                sourceLabel="Checks off live as you type — nothing is sent until Done explaining or Build."
              />
            </div>
          )}

          {/* ══ SUMMARY phase — Jarvis restatement, corrections loop, pictures, Build ══ */}
          {inSummary && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label className="form-label" style={{ fontSize: 14, marginTop: 0 }}>
                  JARVIS's understanding — edit anything that's wrong
                </label>
                <textarea
                  className="form-input form-textarea"
                  data-testid="summary-textarea"
                  rows={16}
                  style={{ lineHeight: 1.55, fontFamily: 'inherit', resize: 'vertical' }}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                />

                {questions.length > 0 && (
                  <div style={{
                    marginTop: 12, border: `1px solid ${C.primaryBorder}`, background: C.primaryBg,
                    borderRadius: 8, padding: '10px 14px',
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: C.primary,
                      letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4,
                    }}>
                      Anything to change?
                    </div>
                    {questions.map((q, i) => (
                      <div key={i} style={{ fontSize: 12, color: C.text, lineHeight: 1.5, padding: '2px 0' }}>
                        {i + 1}. {q}
                      </div>
                    ))}
                  </div>
                )}

                {/* Corrections input — type OR talk */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                  <label className="form-label" style={{ flex: 1, marginBottom: 0, marginTop: 0 }}>
                    Changes — answer the questions or correct anything (type or dictate)
                  </label>
                  {changesDictation.listening && <ListeningIndicator />}
                  <MicButton
                    listening={changesDictation.listening}
                    supported={changesDictation.speechSupported}
                    onToggle={changesDictation.toggleDictation}
                    testId="changes-dictate-btn"
                  />
                  <style>{'@keyframes sdc-mic-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }'}</style>
                </div>
                {changesDictation.micError && (
                  <div style={{ fontSize: 11, color: C.danger, margin: '4px 0 2px' }}>{changesDictation.micError}</div>
                )}
                <div style={{ position: 'relative' }}>
                  <textarea
                    ref={changesRef}
                    className="form-input form-textarea"
                    data-testid="changes-textarea"
                    rows={3}
                    style={{ lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }}
                    value={changes}
                    onChange={e => setChanges(e.target.value)}
                    placeholder='e.g. "The retry count is 3, not 2 — and after the third miss it faults and calls the operator."'
                  />
                  {changesDictation.listening && changesDictation.interim && (
                    <div style={{
                      position: 'absolute', left: 1, right: 1, bottom: 1,
                      padding: '3px 10px', pointerEvents: 'none',
                      fontSize: 12, fontStyle: 'italic', color: C.light,
                      background: 'rgba(255,255,255,0.88)', borderRadius: '0 0 6px 6px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {changesDictation.interim}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    className="btn btn--secondary"
                    data-testid="apply-changes-btn"
                    onClick={handleApplyChanges}
                    disabled={!changes.trim() || applying}
                  >
                    {applying ? 'JARVIS is revising…' : 'Apply changes'}
                  </button>
                </div>

                {/* Add pictures (paste / drag) */}
                <div style={{ marginTop: 6 }}>
                  <DescribeSurface
                    description=""
                    onDescriptionChange={() => {}}
                    images={images}
                    onImagesChange={setImages}
                    showTextarea={false}
                  />
                </div>

                {error && (
                  <div style={{
                    marginTop: 12, background: '#f5eeee', border: '1px solid #d4a0a0',
                    borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.danger,
                  }}>
                    <strong>Request failed:</strong> {error}
                  </div>
                )}

                {/* Action row */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18 }}>
                  <button
                    type="button"
                    onClick={() => { setError(null); setPhase('input'); }}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 11, color: C.muted, textDecoration: 'underline', marginRight: 'auto',
                    }}
                  >
                    ‹ back to my raw explanation
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 11, color: C.muted, textDecoration: 'underline',
                    }}
                  >
                    Discard draft
                  </button>
                  {!allCovered && (
                    <span style={{ fontSize: 11, color: C.muted }}>
                      {covered} of {applicable.length} covered — answer what's missing, then Apply changes
                    </span>
                  )}
                  <button
                    className="btn btn--primary"
                    data-testid="build-station-btn"
                    onClick={handleBuild}
                    disabled={!canBuild}
                    title={allCovered ? undefined : "JARVIS's checklist verdicts gate the build"}
                    style={{
                      fontSize: 14, padding: '9px 22px',
                      transition: 'background 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease',
                      boxShadow: canBuild ? `0 0 0 3px ${C.primaryBg}` : 'none',
                    }}
                  >
                    Build Station
                  </button>
                </div>
              </div>

              <div>
                <ChecklistPanel
                  scores={effScores}
                  messages={effMessages}
                  hasOtherSms={hasOtherSms}
                  sourceLabel="JARVIS's verdict from your explanation — this gates the Build."
                />
                <div style={{
                  fontSize: 10, color: C.light, marginTop: 8, textAlign: 'right',
                  fontFamily: 'Consolas, monospace',
                }}>
                  summary cost so far: ${summarizeCost.toFixed(4)}
                </div>
              </div>
            </div>
          )}

          {/* ══ BUILDING ══ */}
          {phase === 'building' && (
            <div style={{ padding: '60px 40px', maxWidth: 640, margin: '0 auto' }}>
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
                Two extractions run from your explanation: the drawn station
                sequence (devices, states, branches) and the station spec
                (purpose, failure handling, relationships).
              </div>
            </div>
          )}

          {/* ══ SPEC FAILED ══ */}
          {phase === 'specFailed' && (
            <div style={{ padding: '30px 0', maxWidth: 640, margin: '0 auto' }}>
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn--primary" onClick={() => store.closeNewSmModal()}>
                  Open the Station
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
