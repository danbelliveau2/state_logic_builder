/**
 * SpecEditorModal — "Station Spec" (Machine Spec v2 flow: talk first).
 *
 * Dan's flow (v1 form rejected — no fields, no dropdowns up front):
 *   1. DESCRIBE — one large free-form textarea ("Explain this station like you
 *      would to a new engineer") + a light checklist hint + image drag-drop
 *      (CAD screenshots). Room left for future voice input.
 *   2. EXTRACT — POST /api/jarvis/spec. JARVIS extracts machineSpec (purpose,
 *      devicePurposes, outcomeRules, relationships) AND a devices delta:
 *      proposed new devices (typed via deviceTypes vocabulary) + configured
 *      devices the text never mentioned.
 *   3. REVIEW — the four sections rendered with inline click-to-edit,
 *      proposed devices as accept/reject rows, JARVIS's clarifying questions
 *      at the top. Save Spec persists machineSpec (+ accepted devices via
 *      store.addDevice).
 *   4. RE-DESCRIBE — back to the text, append more, re-extract. Merge keeps
 *      manual edits where the new extraction doesn't contradict; on conflict
 *      the newest extraction wins and the field is flagged.
 *
 * Storage unchanged: sm.machineSpec via store.updateStateMachine (adds
 * sourceDescription so the text round-trips). SDC palette only — standard
 * modal / btn / form classes, no special branding color.
 */

import { useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { computeStateNumbers } from '../../lib/computeStateNumbers.js';
import { DEVICE_TYPES } from '../../lib/deviceTypes.js';
import { DescribeSurface } from '../jarvis/DescribeSurface.jsx';

const REL_KINDS = [
  { value: 'feeds',          label: 'Feeds parts to' },
  { value: 'consumes',       label: 'Receives parts from' },
  { value: 'requests-index', label: 'Asks for a dial index from' },
  { value: 'signals',        label: 'Tells something to' },
  { value: 'custom',         label: 'Other interaction with' },
];

const uid = () => crypto.randomUUID();

// SDC palette shorthands (from src/index.css tokens)
const C = {
  primary: 'var(--color-primary)',      // #1574C4
  primaryBg: '#e8f0fa',                 // light-blue tint used across device UI
  primaryBorder: '#a8c8e8',
  border: 'var(--color-border)',        // #e2e8f0
  text: 'var(--color-text)',            // #231f20
  muted: 'var(--color-text-muted)',     // #5a6a7e
  light: 'var(--color-text-light)',     // #8896a8
  warning: 'var(--color-warning)',      // #c9a643
  danger: 'var(--color-danger)',        // #b83c3c
  success: 'var(--color-success)',      // #5a9a48
};

/** Model result -> editable local draft (stable row ids, all fields present). */
function resultToDraft(spec, prevSequence = []) {
  return {
    version: 1,
    purpose: spec?.purpose ?? '',
    devicePurposes: { ...(spec?.devicePurposes ?? {}) },
    sequence: prevSequence, // authored elsewhere / drawn — carried through untouched
    outcomeRules: (spec?.outcomeRules ?? []).map(r => ({
      id: r.id ?? uid(),
      trigger: r.trigger ?? '',
      response: r.response ?? '',
      retryCount: r.retryCount ?? '',
      escalation: r.escalation ?? '',
    })),
    relationships: (spec?.relationships ?? []).map(r => ({
      id: r.id ?? uid(),
      withSmId: r.withSmId ?? '',
      withSmName: r.withSmName ?? '',
      kind: r.kind ?? 'feeds',
      description: r.description ?? '',
    })),
  };
}

/** Trim the draft back into the stored shape (drop empty rows, blank strings). */
function draftToSpec(draft) {
  const devicePurposes = {};
  for (const [id, txt] of Object.entries(draft.devicePurposes)) {
    if ((txt ?? '').trim()) devicePurposes[id] = txt.trim();
  }
  return {
    version: 1,
    purpose: draft.purpose.trim(),
    devicePurposes,
    sequence: draft.sequence ?? [],
    outcomeRules: draft.outcomeRules
      .filter(r => r.trigger.trim() || r.response.trim())
      .map(r => ({
        id: r.id,
        trigger: r.trigger.trim(),
        response: r.response.trim(),
        ...(String(r.retryCount).trim() !== '' && !Number.isNaN(Number(r.retryCount))
          ? { retryCount: Number(r.retryCount) } : {}),
        escalation: r.escalation.trim(),
      })),
    relationships: draft.relationships
      .filter(r => r.withSmId || r.description.trim())
      .map(r => ({ id: r.id, withSmId: r.withSmId, withSmName: r.withSmName, kind: r.kind, description: r.description.trim() })),
  };
}

/** Crude text similarity for merging re-extracted rules onto edited ones. */
function similarText(a, b) {
  const words = s => new Set(String(s).toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return false;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.min(wa.size, wb.size) >= 0.5;
}

/**
 * Merge a fresh extraction onto the edited draft.
 * Rule: keep manual edits where the new extraction doesn't contradict them;
 * on conflict prefer the NEW extraction and flag the field.
 * Returns { draft, flags: Set<pathString> }.
 */
function mergeExtraction(prevDraft, editedPaths, newSpec) {
  const flags = new Set();
  const draft = resultToDraft(newSpec, prevDraft.sequence);

  // Purpose (scalar)
  if (editedPaths.has('purpose')) {
    if (!draft.purpose.trim()) draft.purpose = prevDraft.purpose;
    else if (draft.purpose.trim() !== prevDraft.purpose.trim()) flags.add('purpose');
  }

  // Device purposes (keyed by stable device id)
  for (const [id, prevTxt] of Object.entries(prevDraft.devicePurposes)) {
    const p = `devicePurposes.${id}`;
    const newTxt = draft.devicePurposes[id] ?? '';
    if (editedPaths.has(p)) {
      if (!newTxt.trim()) draft.devicePurposes[id] = prevTxt;
      else if (newTxt.trim() !== prevTxt.trim()) flags.add(p);
    } else if (!newTxt.trim() && prevTxt.trim()) {
      draft.devicePurposes[id] = prevTxt; // new extraction silent — keep what we had
    }
  }

  // Outcome rules — new extraction is the base; edited old rules either map to
  // a similar new rule (flag if it differs) or are appended (kept).
  for (const old of prevDraft.outcomeRules) {
    const wasEdited = ['trigger', 'response', 'retryCount', 'escalation']
      .some(f => editedPaths.has(`outcomeRules.${old.id}.${f}`));
    if (!wasEdited) continue;
    const match = draft.outcomeRules.find(n => similarText(n.trigger, old.trigger));
    if (match) {
      if (match.trigger.trim() !== old.trigger.trim() || match.response.trim() !== old.response.trim()
        || String(match.retryCount) !== String(old.retryCount) || match.escalation.trim() !== old.escalation.trim()) {
        flags.add(`outcomeRules.${match.id}`);
      }
    } else {
      draft.outcomeRules.push({ ...old });
    }
  }

  // Relationships — keyed loosely by target SM + kind.
  for (const old of prevDraft.relationships) {
    const wasEdited = ['kind', 'withSmId', 'description'].some(f => editedPaths.has(`relationships.${old.id}.${f}`));
    if (!wasEdited) continue;
    const match = draft.relationships.find(n => n.withSmId && n.withSmId === old.withSmId);
    if (match) {
      if (match.kind !== old.kind || match.description.trim() !== old.description.trim()) {
        flags.add(`relationships.${match.id}`);
      }
    } else {
      draft.relationships.push({ ...old });
    }
  }

  return { draft, flags };
}

// ── Inline click-to-edit ─────────────────────────────────────────────────────
function InlineText({ value, placeholder, onCommit, flagged, multiline, style }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  const commit = () => { setEditing(false); if ((val ?? '') !== (value ?? '')) onCommit(val); };
  if (editing) {
    const shared = {
      className: 'form-input',
      autoFocus: true,
      value: val,
      onChange: e => setVal(e.target.value),
      onBlur: commit,
      onKeyDown: e => {
        if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); }
      },
      style: { fontSize: 12, padding: '4px 8px', ...style },
    };
    return multiline
      ? <textarea {...shared} rows={2} className="form-input form-textarea" />
      : <input {...shared} />;
  }
  const empty = !(value ?? '').trim();
  return (
    <span
      onClick={() => { setVal(value ?? ''); setEditing(true); }}
      title="Click to edit"
      style={{
        display: 'block', fontSize: 12, lineHeight: 1.5, cursor: 'text',
        color: empty ? C.light : C.text,
        fontStyle: empty ? 'italic' : 'normal',
        padding: '4px 8px', borderRadius: 4,
        border: `1px dashed ${flagged ? C.warning : 'transparent'}`,
        background: flagged ? '#fdf6e3' : 'transparent',
        ...style,
      }}
      onMouseEnter={e => { if (!flagged) e.currentTarget.style.border = `1px dashed ${C.primaryBorder}`; }}
      onMouseLeave={e => { if (!flagged) e.currentTarget.style.border = '1px dashed transparent'; }}
    >
      {empty ? (placeholder ?? 'Click to add') : value}
      {flagged && (
        <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: C.warning, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          re-extracted
        </span>
      )}
    </span>
  );
}

// ── Section chrome (SDC blue, matches app numbering style) ──────────────────
function Section({ number, title, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: C.primary, color: '#fff', fontSize: 12, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{number}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</span>
      </div>
      {hint && <div style={{ fontSize: 11, color: C.muted, margin: '0 0 8px 30px' }}>{hint}</div>}
      <div style={{ marginLeft: 30 }}>{children}</div>
    </div>
  );
}

const smallLabel = { fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase' };
const removeBtnStyle = {
  background: 'none', border: 'none', color: C.light, cursor: 'pointer',
  fontSize: 15, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
};
const addBtnStyle = {
  fontSize: 12, fontWeight: 600, color: C.primary,
  background: C.primaryBg, border: `1px dashed ${C.primaryBorder}`, borderRadius: 4,
  padding: '5px 12px', cursor: 'pointer', marginTop: 6,
};
const selectStyle = {
  fontSize: 12, padding: '4px 8px', border: `1px solid ${C.border}`,
  borderRadius: 4, background: '#fff', color: C.text,
};

/**
 * @param {object}  props
 * @param {Function} props.onClose
 * @param {object}  [props.initial]  A spec-extraction result to review
 *   immediately (from the Create Station build flow): { spec,
 *   proposedDevices, unmentionedDeviceIds, questions, meta }. When given,
 *   the modal opens straight in the review phase.
 */
export function SpecEditorModal({ onClose, initial = null }) {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const sms = store.project?.stateMachines ?? [];
  const devices = sm?.devices ?? [];
  const otherSms = sms.filter(s => s.id !== sm?.id);

  // phase: 'describe' | 'running' | 'review'
  const [phase, setPhase] = useState(initial ? 'review' : 'describe');
  const [description, setDescription] = useState(() => sm?.machineSpec?.sourceDescription ?? '');
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);

  const [draft, setDraft] = useState(() =>            // editable spec draft
    initial ? resultToDraft(initial.spec, sm?.machineSpec?.sequence ?? []) : null);
  const [proposals, setProposals] = useState(() =>    // [{...proposal, accepted}]
    initial ? (initial.proposedDevices ?? []).map(p => ({ ...p, accepted: true })) : []);
  const [unmentioned, setUnmentioned] = useState(initial?.unmentionedDeviceIds ?? []); // device ids
  const [questions, setQuestions] = useState(initial?.questions ?? []);
  const [meta, setMeta] = useState(initial?.meta ?? null);
  const [flags, setFlags] = useState(new Set());      // conflict-flagged paths
  const editedPathsRef = useRef(new Set());           // manual edits since extraction

  // Drawn sequence context — same DFS the canvas uses.
  const drawnSteps = useMemo(() => {
    if (!sm || (sm.nodes ?? []).length === 0) return [];
    try {
      const { stateMap } = computeStateNumbers(sm.nodes, sm.edges ?? []);
      return [...sm.nodes]
        .map(n => ({
          num: stateMap.get?.(n.id) ?? stateMap[n.id] ?? null,
          label: n.data?.label
            || (n.type === 'decisionNode'
                ? `Wait for ${n.data?.signalSource ?? n.data?.signalName ?? 'condition'}`
                : n.id),
        }))
        .sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9))
        .map(s => s.label);
    } catch { return (sm.nodes ?? []).map(n => n.data?.label || n.id); }
  }, [sm]);

  if (!sm) return null;

  function patchDraft(path, updater) {
    editedPathsRef.current.add(path);
    setFlags(prev => { if (!prev.has(path)) return prev; const n = new Set(prev); n.delete(path); return n; });
    setDraft(d => updater(d));
  }

  async function handleExtract() {
    if (!description.trim()) return;
    setPhase('running');
    setError(null);
    const isReExtract = draft !== null;
    try {
      const res = await fetch('/api/jarvis/spec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          images: images.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
          sm: {
            id: sm.id,
            name: sm.name,
            displayName: sm.displayName ?? sm.name,
            devices: devices.map(d => ({
              id: d.id, name: d.name, displayName: d.displayName, type: d.type,
              sensorArrangement: d.sensorArrangement,
            })),
            drawnSteps,
          },
          otherSms: otherSms.map(s => ({ id: s.id, name: s.name, displayName: s.displayName ?? s.name })),
          existingSpec: sm.machineSpec ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);

      if (isReExtract) {
        const { draft: merged, flags: newFlags } = mergeExtraction(draft, editedPathsRef.current, data.spec);
        setDraft(merged);
        setFlags(newFlags);
      } else {
        setDraft(resultToDraft(data.spec, sm.machineSpec?.sequence ?? []));
        setFlags(new Set());
      }
      editedPathsRef.current = new Set();
      // Re-extraction refreshes proposals too; previously accepted names stay accepted.
      setProposals(prev => (data.proposedDevices ?? []).map(p => ({
        ...p,
        accepted: prev.find(x => x.name === p.name)?.accepted ?? true,
      })));
      setUnmentioned(data.unmentionedDeviceIds ?? []);
      setQuestions(data.questions ?? []);
      setMeta(data.meta ?? null);
      setPhase('review');
    } catch (e) {
      setError(e.message);
      setPhase('describe');
    }
  }

  function handleSave() {
    const spec = draftToSpec(draft);
    // Create accepted proposed devices via the existing store action, and
    // carry each one's extracted purpose into devicePurposes.
    for (const p of proposals) {
      if (!p.accepted) continue;
      const t = DEVICE_TYPES[p.type] ?? {};
      const newId = store.addDevice(sm.id, {
        type: p.type,
        name: p.name,
        displayName: p.displayName || p.name,
        sensorArrangement: p.sensorArrangement ?? t.defaultSensorArrangement,
        homePosition: t.homePositions ? t.defaultHomePosition : undefined,
        extTimerMs: 500, retTimerMs: 500,
        engageTimerMs: 250, disengageTimerMs: 250,
        timerMs: 1000,
      });
      if (newId && p.purpose) spec.devicePurposes[newId] = p.purpose;
    }
    store.updateStateMachine(sm.id, {
      machineSpec: { ...spec, sourceDescription: description.trim() },
    });
    onClose();
  }

  function handleClose() {
    if (phase === 'running') return;
    // In the Create Station flow (initial provided) the spec was already
    // saved at build time — closing the review loses only unsaved edits.
    if (phase === 'review' && !initial && !confirm('Discard the extracted spec without saving?')) return;
    onClose();
  }

  const devById = new Map(devices.map(d => [d.id, d]));

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" style={{ width: 780, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span>Station Spec — {sm.displayName ?? sm.name}</span>
          <button className="icon-btn" onClick={handleClose} disabled={phase === 'running'}>✕</button>
        </div>

        <div className="modal__body" style={{ overflow: 'auto', padding: '16px 20px' }}>

          {/* ── DESCRIBE ─────────────────────────────────────────────────── */}
          {phase === 'describe' && (
            <DescribeSurface
              description={description}
              onDescriptionChange={setDescription}
              images={images}
              onImagesChange={setImages}
              error={error}
              hint={(
                <div style={{
                  fontSize: 11, color: C.muted, background: 'var(--color-sidebar)',
                  border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', marginBottom: 8,
                }}>
                  Cover: what the devices are and what each is for&ensp;•&ensp;what the
                  station does step by step&ensp;•&ensp;what can go wrong and what should
                  happen&ensp;•&ensp;which stations it works with.
                </div>
              )}
            />
          )}

          {/* ── RUNNING ──────────────────────────────────────────────────── */}
          {phase === 'running' && (
            <div style={{ padding: '36px 12px', textAlign: 'center' }}>
              <div style={{
                width: 34, height: 34, margin: '0 auto 14px',
                border: `4px solid ${C.primaryBg}`, borderTopColor: C.primary,
                borderRadius: '50%', animation: 'spin 0.9s linear infinite',
              }} />
              <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                JARVIS is reading your explanation…
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                Extracting devices, sequence intent, failure handling, and station relationships.
              </div>
            </div>
          )}

          {/* ── REVIEW ───────────────────────────────────────────────────── */}
          {phase === 'review' && draft && (
            <>
              {questions.length > 0 && (
                <div style={{
                  border: '1px solid #e6d9a8', background: '#fdf6e3', borderRadius: 6,
                  padding: '10px 14px', marginBottom: 14,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8a6d1a', marginBottom: 4 }}>
                    JARVIS wants to clarify — edit the fields below, or Re-describe with more detail:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#6b5513', lineHeight: 1.6 }}>
                    {questions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}

              <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                Everything below was extracted from your explanation — click any value to correct it.
                {typeof meta?.costUSD === 'number' && <span> · extraction ${meta.costUSD.toFixed(2)}</span>}
              </div>

              {/* 1 — Devices */}
              <Section
                number={1}
                title="Devices"
                hint="What JARVIS understood each device is for. Click a purpose to edit."
              >
                {devices.map(d => (
                  <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
                    <span style={{
                      flexShrink: 0, width: 170, fontSize: 12, fontWeight: 600, color: C.text,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingTop: 4,
                    }} title={`${d.displayName ?? d.name} (${d.type})`}>
                      {d.displayName ?? d.name}
                      <span style={{ display: 'block', fontSize: 9, fontWeight: 400, color: C.light }}>{d.type}</span>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InlineText
                        value={draft.devicePurposes[d.id] ?? ''}
                        placeholder={unmentioned.includes(d.id) ? 'not mentioned in your explanation — click to add' : 'click to add purpose'}
                        flagged={flags.has(`devicePurposes.${d.id}`)}
                        onCommit={v => patchDraft(`devicePurposes.${d.id}`,
                          dd => ({ ...dd, devicePurposes: { ...dd.devicePurposes, [d.id]: v } }))}
                      />
                    </div>
                    {unmentioned.includes(d.id) && !(draft.devicePurposes[d.id] ?? '').trim() && (
                      <span style={{
                        flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                        color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999,
                        padding: '2px 8px', marginTop: 5, textTransform: 'uppercase',
                      }}>not mentioned</span>
                    )}
                  </div>
                ))}

                {proposals.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={smallLabel}>New devices JARVIS found in your explanation</div>
                    {proposals.map((p, i) => (
                      <div key={p.name} style={{
                        display: 'flex', gap: 8, alignItems: 'center', marginTop: 5,
                        border: `1px solid ${p.accepted ? C.primaryBorder : C.border}`,
                        background: p.accepted ? C.primaryBg : 'var(--color-sidebar)',
                        borderRadius: 6, padding: '6px 10px',
                        opacity: p.accepted ? 1 : 0.6,
                      }}>
                        <span style={{ flexShrink: 0, width: 162, fontSize: 12, fontWeight: 600, color: C.text }}>
                          {p.displayName || p.name}
                          <span style={{ display: 'block', fontSize: 9, fontWeight: 400, color: C.muted }}>
                            {p.type}{p.sensorArrangement ? ` · ${p.sensorArrangement}` : ''}
                          </span>
                        </span>
                        <span style={{ flex: 1, fontSize: 11, color: C.muted, minWidth: 0 }}>{p.purpose}</span>
                        <button
                          className={`btn btn--xs ${p.accepted ? 'btn--primary' : 'btn--secondary'}`}
                          onClick={() => setProposals(prev => prev.map((x, j) => j === i ? { ...x, accepted: true } : x))}
                        >Add</button>
                        <button
                          className={`btn btn--xs ${p.accepted ? 'btn--secondary' : 'btn--primary'}`}
                          onClick={() => setProposals(prev => prev.map((x, j) => j === i ? { ...x, accepted: false } : x))}
                        >Skip</button>
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: C.light, marginTop: 3, fontStyle: 'italic' }}>
                      Added devices are created on this station when you Save.
                    </div>
                  </div>
                )}
              </Section>

              {/* 2 — Purpose */}
              <Section number={2} title="What the station does" hint="One sentence for the whole station.">
                <InlineText
                  value={draft.purpose}
                  placeholder="click to add the station purpose"
                  flagged={flags.has('purpose')}
                  multiline
                  onCommit={v => patchDraft('purpose', dd => ({ ...dd, purpose: v }))}
                />
                {drawnSteps.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={smallLabel}>Sequence — from your drawing (used as-is)</div>
                    <div style={{
                      marginTop: 4, border: `1px solid ${C.border}`, borderRadius: 6,
                      background: 'var(--color-sidebar)', padding: '6px 10px',
                      maxHeight: 140, overflow: 'auto',
                    }}>
                      {drawnSteps.map((label, i) => (
                        <div key={i} style={{ fontSize: 12, color: C.text, padding: '2px 0', display: 'flex', gap: 8 }}>
                          <span style={{ color: C.light, width: 20, flexShrink: 0, textAlign: 'right' }}>{i + 1}.</span>
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {/* 3 — Outcome rules */}
              <Section
                number={3}
                title="What can go wrong"
                hint="Each rule: when it happens, what to do, how many tries, what to do when tries run out."
              >
                {draft.outcomeRules.length === 0 && (
                  <div style={{ fontSize: 12, color: C.light, fontStyle: 'italic', marginBottom: 4 }}>
                    Nothing extracted — Re-describe with failure handling, or add one below.
                  </div>
                )}
                {draft.outcomeRules.map(r => {
                  const ruleFlag = flags.has(`outcomeRules.${r.id}`);
                  return (
                    <div key={r.id} style={{
                      border: `1px solid ${ruleFlag ? C.warning : C.border}`, borderRadius: 6,
                      padding: '8px 10px', marginBottom: 8, background: ruleFlag ? '#fdf6e3' : 'var(--color-sidebar)',
                      position: 'relative',
                    }}>
                      <button style={{ ...removeBtnStyle, position: 'absolute', top: 4, right: 4 }} title="Remove"
                        onClick={() => patchDraft(`outcomeRules.${r.id}.removed`,
                          dd => ({ ...dd, outcomeRules: dd.outcomeRules.filter(x => x.id !== r.id) }))}>×</button>
                      {ruleFlag && (
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.warning, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          re-extracted — replaced your earlier edit
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', rowGap: 2, columnGap: 8, alignItems: 'start' }}>
                        <div style={{ ...smallLabel, paddingTop: 6 }}>When</div>
                        <InlineText value={r.trigger} placeholder="click to describe the trigger"
                          onCommit={v => patchDraft(`outcomeRules.${r.id}.trigger`,
                            dd => ({ ...dd, outcomeRules: dd.outcomeRules.map(x => x.id === r.id ? { ...x, trigger: v } : x) }))} />
                        <div style={{ ...smallLabel, paddingTop: 6 }}>Do</div>
                        <InlineText value={r.response} placeholder="click to describe the response"
                          onCommit={v => patchDraft(`outcomeRules.${r.id}.response`,
                            dd => ({ ...dd, outcomeRules: dd.outcomeRules.map(x => x.id === r.id ? { ...x, response: v } : x) }))} />
                        <div style={{ ...smallLabel, paddingTop: 6 }}>Tries</div>
                        <InlineText value={String(r.retryCount ?? '')} placeholder="no retry count stated"
                          style={{ maxWidth: 120 }}
                          onCommit={v => patchDraft(`outcomeRules.${r.id}.retryCount`,
                            dd => ({ ...dd, outcomeRules: dd.outcomeRules.map(x => x.id === r.id ? { ...x, retryCount: v } : x) }))} />
                        <div style={{ ...smallLabel, paddingTop: 6 }}>Then</div>
                        <InlineText value={r.escalation} placeholder="what to do when the tries run out"
                          onCommit={v => patchDraft(`outcomeRules.${r.id}.escalation`,
                            dd => ({ ...dd, outcomeRules: dd.outcomeRules.map(x => x.id === r.id ? { ...x, escalation: v } : x) }))} />
                      </div>
                    </div>
                  );
                })}
                <button style={addBtnStyle}
                  onClick={() => patchDraft('outcomeRules.added',
                    dd => ({ ...dd, outcomeRules: [...dd.outcomeRules, { id: uid(), trigger: '', response: '', retryCount: '', escalation: '' }] }))}>
                  + Add something that could go wrong
                </button>
              </Section>

              {/* 4 — Relationships */}
              <Section
                number={4}
                title="Works with these stations"
                hint="Resolved against the stations in this project."
              >
                {draft.relationships.length === 0 && (
                  <div style={{ fontSize: 12, color: C.light, fontStyle: 'italic', marginBottom: 4 }}>
                    No interactions extracted.
                  </div>
                )}
                {draft.relationships.map(r => {
                  const relFlag = flags.has(`relationships.${r.id}`);
                  const unresolved = !r.withSmId;
                  return (
                    <div key={r.id} style={{
                      display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6,
                      ...(relFlag ? { background: '#fdf6e3', borderRadius: 6, padding: '4px 6px', border: `1px solid ${C.warning}` } : {}),
                    }}>
                      <select
                        style={{ ...selectStyle, width: 168, flexShrink: 0 }}
                        value={r.kind}
                        onChange={e => patchDraft(`relationships.${r.id}.kind`,
                          dd => ({ ...dd, relationships: dd.relationships.map(x => x.id === r.id ? { ...x, kind: e.target.value } : x) }))}
                      >
                        {REL_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                      <select
                        style={{ ...selectStyle, width: 150, flexShrink: 0, ...(unresolved ? { borderColor: C.warning } : {}) }}
                        value={r.withSmId}
                        onChange={e => {
                          const target = otherSms.find(s => s.id === e.target.value);
                          patchDraft(`relationships.${r.id}.withSmId`,
                            dd => ({
                              ...dd,
                              relationships: dd.relationships.map(x => x.id === r.id
                                ? { ...x, withSmId: e.target.value, withSmName: target ? (target.displayName ?? target.name) : '' }
                                : x),
                            }));
                        }}
                      >
                        <option value="">{unresolved && r.withSmName ? `? ${r.withSmName}` : '— pick station —'}</option>
                        {otherSms.map(s => <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>)}
                      </select>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <InlineText value={r.description} placeholder="click to describe the interaction"
                          onCommit={v => patchDraft(`relationships.${r.id}.description`,
                            dd => ({ ...dd, relationships: dd.relationships.map(x => x.id === r.id ? { ...x, description: v } : x) }))} />
                      </div>
                      <button style={removeBtnStyle} title="Remove"
                        onClick={() => patchDraft(`relationships.${r.id}.removed`,
                          dd => ({ ...dd, relationships: dd.relationships.filter(x => x.id !== r.id) }))}>×</button>
                    </div>
                  );
                })}
                <button style={addBtnStyle}
                  onClick={() => patchDraft('relationships.added',
                    dd => ({ ...dd, relationships: [...dd.relationships, { id: uid(), withSmId: '', withSmName: '', kind: 'feeds', description: '' }] }))}>
                  + Add an interaction
                </button>
              </Section>
            </>
          )}
        </div>

        <div className="modal__footer" style={{ display: 'flex', gap: 8, padding: '12px 20px' }}>
          {phase === 'review' && (
            <button className="btn btn--secondary" style={{ marginRight: 'auto' }}
              onClick={() => setPhase('describe')}>
              ← Re-describe
            </button>
          )}
          <button className="btn btn--secondary" style={phase === 'review' ? {} : { marginLeft: 'auto' }}
            onClick={handleClose} disabled={phase === 'running'}>Cancel</button>
          {phase === 'describe' && (
            <button className="btn btn--primary" onClick={handleExtract} disabled={!description.trim()}>
              {draft ? 'Re-extract Spec' : 'Extract Spec'}
            </button>
          )}
          {phase === 'review' && (
            <button className="btn btn--primary" onClick={handleSave}>
              Save Spec
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
