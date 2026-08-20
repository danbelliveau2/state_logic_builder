/**
 * CreateStationPage — describe-first station creation, as a FULL PAGE.
 *
 * Round-2 rework of CreateStationModal (which this supersedes) after Dan's
 * real-world test:
 *   1. Full-viewport page, not a popup: opaque, fills the app, NO
 *      overlay-click dismissal. Explicit "← Back" in the header, with a
 *      confirm when there's content (nothing is ever lost — see 2).
 *   2. Never lose work: the whole draft (name, number, description, images,
 *      phase, summary) autosaves ~1s-debounced to the per-project MULTI-draft
 *      store (createStationDrafts.js). The page ALWAYS opens blank — no
 *      silent restore (Dan). Unfinished drafts are listed in a banner here
 *      and in StationsPanel's "Drafts (N)" row; resume is an explicit click.
 *      A draft clears only after a successful Build or explicit "Discard
 *      draft". Stored images are capped at ~4MB total base64 per draft
 *      (oldest dropped, with a notice).
 *   3. Clipboard paste: DescribeSurface mounts a window-level paste
 *      listener, so Ctrl+V of a Snipping Tool capture lands as a thumbnail
 *      no matter where focus is (and never dumps junk into the textarea).
 *   4. "Done explaining →" summary loop: POST /api/jarvis/summarize/stream
 *      (SSE — real 0-100% progress driving a ProgressRing; plain POST kept
 *      as fallback) returns a STRUCTURED restatement — four scannable
 *      sections (devices / sequence / failure handling / interactions),
 *      each rendered as an editable card with its coverage verdict in the
 *      header (verdicts REPLACE the local heuristics from then on) — plus
 *      2-4 questions back to the engineer. The engineer types OR dictates
 *      corrections -> "Apply changes" re-summarizes -> iterate -> add
 *      pictures -> Build. Build then runs on the SERIALIZED summary (+ the
 *      original appended as reference). The old direct path (heuristic-gated
 *      Build straight from the raw text) still works if Done explaining is
 *      never clicked. Summarize cost is capped per station draft
 *      (JARVIS_SUMMARIZE_MAX_COST_USD, default $5) — never by input length.
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
import { DeviceIcon } from '../DeviceIcons.jsx';
import { ProgressRing } from './ProgressRing.jsx';
import { NewStateMachineModal } from '../modals/NewStateMachineModal.jsx';
import {
  draftsKeyFor, loadDrafts, saveDraft, deleteDraft, newDraftId,
  consumeResumeRequest, draftLabel, timeAgo,
} from './createStationDrafts.js';

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

/** Transient house-style toast, appended straight to document.body so it
 *  survives this page unmounting (Build closes the page immediately — Dan:
 *  "we just verified it all", so post-build there is NO second review layer,
 *  just the canvas plus this notice). */
function showTransientToast(message) {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'station-built-toast');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', bottom: '26px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 2000, maxWidth: '540px',
    background: '#fff', color: 'var(--color-text)',
    border: '1px solid #a8c8e8', borderLeft: '4px solid var(--color-primary)',
    borderRadius: '8px', boxShadow: '0 4px 18px rgba(0,0,0,0.16)',
    padding: '10px 16px', fontSize: '12.5px', fontWeight: '600', lineHeight: '1.5',
    opacity: '1', transition: 'opacity 0.6s ease',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 5400);
  setTimeout(() => { el.remove(); }, 6100);
}

// ── Draft persistence (never lose work; multi-draft, no silent restore) ─────
//
// Storage + resume handoff live in createStationDrafts.js. This page ALWAYS
// opens blank; unfinished drafts show as a banner and are resumed explicitly
// (Dan: "I hit new station, I should get a new station").

const DRAFT_IMAGE_BASE64_CAP = 4 * 1024 * 1024; // ~4MB of base64 chars

/** Build the persisted draft payload, capping stored images at ~4MB base64
 *  total (oldest dropped first). Returns { payload, droppedImages }. */
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
  const payload = { ...draft, v: 1, savedAt: Date.now(), images: imgs };
  return { payload, droppedImages };
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

// ── Structured summary helpers ──────────────────────────────────────────────
//
// summarizeDescription now returns a STRUCTURED summary:
//   { devices:[{name,purpose}], sequence:[string],
//     failureHandling:[{when,then,retries?,whenExhausted?}],
//     interactions:[{station,how}] }
// The UI renders it as four scannable section cards; Build (and priorSummary
// on Apply changes) consume the serialized text form.

function isStructuredSummary(s) {
  return !!s && typeof s === 'object'
    && Array.isArray(s.devices) && Array.isArray(s.sequence)
    && Array.isArray(s.failureHandling) && Array.isArray(s.interactions);
}

function summaryHasContent(s) {
  return isStructuredSummary(s)
    && (s.devices.length > 0 || s.sequence.length > 0
      || s.failureHandling.length > 0 || s.interactions.length > 0);
}

/** Optional station-IO capture (summary.io) — present only when the ME
 *  mentioned sensors / valves / IO counts. Never gates anything. */
function ioHasContent(io) {
  return !!io && typeof io === 'object'
    && ((Array.isArray(io.sensors) && io.sensors.length > 0)
      || (Array.isArray(io.valveFunctions) && io.valveFunctions.length > 0)
      || !!String(io.ioNotes || '').trim());
}

/** One display/edit line per item of a section. */
function sectionToLines(key, items) {
  switch (key) {
    case 'devices':
      return items.map(d => `${d.name}${d.purpose ? ` — ${d.purpose}` : ''}`);
    case 'sequence':
      return items.slice();
    case 'failureHandling':
      return items.map(f => {
        let then = f.then || '';
        const extras = [];
        if (f.retries) extras.push(`retries: ${f.retries}`);
        if (f.whenExhausted) extras.push(`when exhausted: ${f.whenExhausted}`);
        if (extras.length) then += `${then ? ' ' : ''}(${extras.join('; ')})`;
        return f.when ? `${f.when} → ${then}` : then;
      });
    case 'interactions':
      return items.map(x => (x.station ? `${x.station}: ${x.how}` : x.how));
    default:
      return [];
  }
}

/** Parse edited textarea lines back into a section's items. Tolerant —
 *  a line that doesn't match the pattern still survives as text. */
function linesToSection(key, text) {
  const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
  switch (key) {
    case 'devices':
      return lines.map(l => {
        const m = l.split(/\s+—\s+|\s+-\s+/);
        return { name: m[0].trim(), purpose: m.slice(1).join(' - ').trim() };
      });
    case 'sequence':
      return lines.map(l => l.replace(/^\d+[.)]\s*/, ''));
    case 'failureHandling':
      return lines.map(l => {
        const m = l.split(/\s*(?:->|→)\s*/);
        return { when: m[0].trim(), then: m.slice(1).join(' → ').trim() };
      });
    case 'interactions':
      return lines.map(l => {
        const i = l.indexOf(':');
        return i === -1
          ? { station: '', how: l }
          : { station: l.slice(0, i).trim(), how: l.slice(i + 1).trim() };
      });
    default:
      return [];
  }
}

/** Serialize the structured summary to labeled text — the Build input and
 *  the priorSummary sent with Apply changes. */
function summaryToText(s) {
  if (!isStructuredSummary(s)) return '';
  const block = (title, lines, numbered = false) =>
    `${title}\n${lines.length
      ? lines.map((l, i) => (numbered ? `${i + 1}. ${l}` : `- ${l}`)).join('\n')
      : '(not described yet)'}`;
  const blocks = [
    block('DEVICES', sectionToLines('devices', s.devices)),
    block('SEQUENCE', sectionToLines('sequence', s.sequence), true),
    block('FAILURE HANDLING', sectionToLines('failureHandling', s.failureHandling)),
    block('STATION INTERACTIONS', sectionToLines('interactions', s.interactions)),
  ];
  if (ioHasContent(s.io)) {
    const lines = [
      ...(s.io.sensors ?? []).map(x => `sensor: ${x.name}${x.type ? ` (${x.type})` : ''}${x.purpose ? ` — ${x.purpose}` : ''}`),
      ...(s.io.valveFunctions ?? []).map(v => `valve: ${v}`),
      ...(String(s.io.ioNotes || '').trim() ? [String(s.io.ioNotes).trim()] : []),
    ];
    blocks.push(block('IO & PNEUMATICS (optional capture)', lines));
  }
  return blocks.join('\n\n');
}

/** Device-type guess for the "Devices I heard" icons — same visual language
 *  as the classic sidebar (DeviceIcons.jsx). Prefers the model-returned
 *  `type` (exact deviceTypes.js string); falls back to keywords so older
 *  stored summaries still get icons. */
function guessDeviceType(d) {
  if (d?.type && typeof d.type === 'string') return d.type;
  const t = `${d?.name ?? ''} ${d?.purpose ?? ''}`.toLowerCase();
  if (/gripper|jaw|chuck|finger/.test(t)) return 'PneumaticGripper';
  if (/vision|camera|inspect/.test(t)) return 'VisionSystem';
  if (/robot/.test(t)) return 'Robot';
  if (/servo|axis|indexer|\bdial\b/.test(t)) return 'ServoAxis';
  if (/vacuum|suction|venturi|\bcup\b/.test(t)) return 'PneumaticVacGenerator';
  if (/rotary|rotate|swivel/.test(t)) return 'PneumaticRotaryActuator';
  if (/conveyor|belt/.test(t)) return 'Conveyor';
  if (/analog|pressure|force|temperature|measure/.test(t)) return 'AnalogSensor';
  if (/sensor|switch|photo ?eye|prox|presence|detect/.test(t)) return 'DigitalSensor';
  if (/cylinder|slide|shuttle|lift|stamp|press|clamp|stopper|escapement|pusher|actuator/.test(t)) return 'PneumaticLinearActuator';
  return 'Custom';
}

// Section cards: how each summary section renders + edits.
const SUMMARY_SECTIONS = [
  { key: 'devices', covKey: 'devices', title: 'Devices I heard', editHint: 'one per line:  Name — what it is for' },
  { key: 'sequence', covKey: 'sequence', title: 'Sequence', editHint: 'one step per line, in order' },
  { key: 'failureHandling', covKey: 'failures', title: 'What can go wrong', editHint: 'one per line:  when it happens → what to do' },
  { key: 'interactions', covKey: 'interactions', title: 'Interactions with other stations', editHint: 'one per line:  Station: the interaction' },
];

/** Corrections text for "Resubmit to Jarvis" after in-place edits: every
 *  section that differs from the last-summarized baseline is restated in
 *  full, marked as the engineer's exact wording. */
function buildEditCorrections(baseline, current) {
  const parts = [];
  for (const section of SUMMARY_SECTIONS) {
    const before = sectionToLines(section.key, baseline?.[section.key] ?? []);
    const after = sectionToLines(section.key, current?.[section.key] ?? []);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    parts.push(
      `${section.title.toUpperCase()} — I edited this section; it now reads exactly:\n`
      + (after.length ? after.map(l => `- ${l}`).join('\n') : '(nothing — I removed everything here)')
    );
  }
  if (!parts.length) return '';
  return 'I edited the summary IN PLACE. The sections below now read exactly as I wrote them — '
    + 'keep my wording and content, re-verify coverage, and update anything that depends on them:\n\n'
    + parts.join('\n\n');
}

// ── SSE-over-fetch (POST /api/jarvis/summarize/stream) ──────────────────────

/** Minimal SSE reader over a fetch Response body. Calls onEvent(event, data)
 *  per event; resolves when the stream closes. */
async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let dataStr = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (dataStr) {
        try { onEvent(event, JSON.parse(dataStr)); } catch { /* skip bad frame */ }
      }
    }
  }
}

/** Summarize with REAL progress: streams the SSE endpoint, falling back to
 *  the plain POST (no live progress) if the stream endpoint isn't available.
 *  onProgress(pct, stage) — stage: 'sent'|'reading'|'writing'|'done'. */
async function summarizeRequest(payload, onProgress) {
  let res = null;
  try {
    res = await fetch('/api/jarvis/summarize/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { res = null; }

  const isSse = !!res && res.ok
    && (res.headers.get('content-type') || '').includes('text/event-stream')
    && !!res.body;

  if (isSse) {
    let result = null;
    let err = null;
    await readSse(res, (event, data) => {
      if (event === 'progress') onProgress?.(data.pct, data.stage);
      else if (event === 'done') result = data;
      else if (event === 'error') err = new Error(data.error || 'Summarize failed');
    });
    if (err) throw err;
    if (!result || !result.ok) throw new Error(result?.error || 'Summarize stream ended without a result');
    onProgress?.(100, 'done');
    return result;
  }

  // The stream endpoint answered with a real (non-SSE) error — surface it.
  if (res && !res.ok && res.status !== 404 && res.status !== 405) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Summarize request failed (${res.status})`);
  }

  // Fallback: plain POST (older server) — no live progress.
  const res2 = await fetch('/api/jarvis/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res2.json().catch(() => ({}));
  if (!res2.ok || !data.ok) throw new Error(data.error || `Summarize request failed (${res2.status})`);
  onProgress?.(100, 'done');
  return data;
}

// Honest stage lines for the summarize progress ring.
const SUMMARIZE_STAGE_TEXT = {
  sent: 'JARVIS is reading your explanation…',
  reading: 'JARVIS is reading your explanation…',
  writing: 'Writing the summary…',
  done: 'Done',
};

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

// ── Summary section card ────────────────────────────────────────────────────
//
// One compact, scannable card per summary section. The header carries the
// section's checklist verdict (✓ / what's missing) so understanding and
// coverage read together. Every line is DIRECTLY editable — click any line
// and it becomes an input (no edit button, no edit mode; Dan: "you shouldn't
// have to hit edit — it should be editable automatically"). Enter/blur
// commits, Escape cancels, an emptied line is removed, "+ add a line"
// appends. Any change bubbles up and the page shows the sticky
// "Resubmit to Jarvis" bar.

/** Bare line input: Enter/blur commits (onDone(value)), Escape cancels
 *  (onDone(null)). Enter/Escape resolve directly (not via blur() — focusout
 *  is unreliable when the window lacks OS focus); the ref guards the
 *  follow-up unmount blur from double-firing. */
function LineInput({ initial, placeholder, onDone, testId }) {
  const [val, setVal] = useState(initial);
  const doneRef = useRef(false);
  const finish = (v) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(v);
  };
  return (
    <input
      className="form-input"
      data-testid={testId}
      style={{ fontSize: 12, padding: '3px 8px', margin: '1px 0', width: '100%', boxSizing: 'border-box' }}
      value={val}
      placeholder={placeholder}
      autoFocus
      onChange={e => setVal(e.target.value)}
      onBlur={() => finish(val)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(val); }
        else if (e.key === 'Escape') { finish(null); }
      }}
    />
  );
}

/** Click-to-type wrapper: renders the formatted line; a click swaps it for a
 *  LineInput pre-filled with the line's text form. No edit button, ever. */
function EditableLine({ line, onCommit, children, testId }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <LineInput
        initial={line}
        testId={testId ? `${testId}-input` : undefined}
        onDone={v => { setEditing(false); if (v !== null) onCommit(v); }}
      />
    );
  }
  return (
    <div
      data-testid={testId}
      title="Click to edit"
      onClick={() => setEditing(true)}
      style={{ cursor: 'text', borderRadius: 4, margin: '0 -6px', padding: '0 6px' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f2f6fb'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </div>
  );
}

function SummarySection({ section, items, cov, optional, onChange }) {
  const [adding, setAdding] = useState(false);
  const lines = sectionToLines(section.key, items);
  const score = cov?.score ?? 0;

  /** Commit an edited line i: unchanged → no-op (preserves rich fields like
   *  device type / retries), emptied → line removed, else re-parsed. */
  const commitLine = (i, text) => {
    const t = String(text).trim();
    if (t === lines[i]) return;
    const next = items.slice();
    if (!t) {
      next.splice(i, 1);
    } else {
      const parsed = linesToSection(section.key, t)[0];
      if (section.key === 'devices' && items[i]?.type && parsed && parsed.name === items[i].name) {
        parsed.type = items[i].type;
      }
      next[i] = parsed;
    }
    onChange(next);
  };
  const commitAdd = (text) => {
    const t = String(text).trim();
    if (!t) return;
    onChange([...items, ...linesToSection(section.key, t)]);
  };

  // Header carries ONLY a short status chip; the full verdict text renders
  // as a muted line UNDER the header (never crammed into the header row).
  const optionalEmpty = optional && items.length === 0;
  const chip = score === 2 ? (
    <span data-testid={`summary-chip-${section.key}`} style={{
      fontSize: 10, fontWeight: 700, color: C.success, whiteSpace: 'nowrap',
      background: '#e9f5ec', border: '1px solid #bfe0c8', borderRadius: 10, padding: '1px 8px',
    }}>✓ covered</span>
  ) : optionalEmpty ? (
    <span data-testid={`summary-chip-${section.key}`} style={{
      fontSize: 10, color: C.light, whiteSpace: 'nowrap',
      border: `1px solid ${C.border}`, borderRadius: 10, padding: '1px 8px',
    }}>optional</span>
  ) : (
    <span data-testid={`summary-chip-${section.key}`} style={{
      fontSize: 10, fontWeight: 700, color: '#6b5513', whiteSpace: 'nowrap',
      background: '#fdf6e3', border: '1px solid #e6d9a8', borderRadius: 10, padding: '1px 8px',
    }}>△ thin</span>
  );
  const verdictText = score === 2 || optionalEmpty
    ? ''
    : [score === 1 ? 'mentioned briefly' : 'not covered', cov?.missing || '']
      .filter(Boolean).join(' — ');

  return (
    <div
      data-testid={`summary-section-${section.key}`}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
        padding: '10px 14px', marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: verdictText ? 2 : 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.text,
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          {section.title}
          {optional && <span style={{ fontWeight: 400, textTransform: 'none', color: C.light }}> (optional — no other stations yet)</span>}
        </span>
        {chip}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: C.light }}>click any line to edit</span>
      </div>

      {verdictText && (
        <div
          data-testid={`summary-verdict-${section.key}`}
          style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.45, marginBottom: 6 }}
        >
          {verdictText}
        </div>
      )}

      {items.map((item, i) => (
        <EditableLine
          key={i}
          line={lines[i]}
          onCommit={t => commitLine(i, t)}
          testId={`summary-line-${section.key}-${i}`}
        >
          {section.key === 'devices' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.text, lineHeight: 1.55, padding: '2px 0' }}>
              <span style={{ flexShrink: 0, display: 'inline-flex' }} data-testid="device-row-icon">
                <DeviceIcon type={guessDeviceType(item)} size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 700 }}>{item.name}</span>
                {item.purpose && <span style={{ color: C.muted }}> — {item.purpose}</span>}
              </span>
            </div>
          ) : section.key === 'sequence' ? (
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: C.text, lineHeight: 1.55, padding: '1px 0' }}>
              <span style={{ color: C.muted, fontWeight: 700, width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
              <span>{item}</span>
            </div>
          ) : section.key === 'failureHandling' ? (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55, padding: '1px 0' }}>
              <span style={{ fontWeight: 600 }}>{item.when}</span>
              {(item.then || item.retries || item.whenExhausted) && <span style={{ color: C.muted }}> → </span>}
              <span>{item.then}</span>
              {(item.retries || item.whenExhausted) && (
                <span style={{ color: C.muted }}>
                  {' ('}
                  {[item.retries ? `retries: ${item.retries}` : null,
                    item.whenExhausted ? `when exhausted: ${item.whenExhausted}` : null]
                    .filter(Boolean).join('; ')}
                  {')'}
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55, padding: '1px 0' }}>
              {item.station && <span style={{ fontWeight: 700 }}>{item.station}: </span>}
              <span>{item.how}</span>
            </div>
          )}
        </EditableLine>
      ))}

      {adding ? (
        <LineInput
          initial=""
          placeholder={section.editHint}
          testId={`summary-add-${section.key}-input`}
          onDone={v => { setAdding(false); if (v !== null) commitAdd(v); }}
        />
      ) : (
        <div
          data-testid={`summary-add-${section.key}`}
          onClick={() => setAdding(true)}
          title={section.editHint}
          style={{
            fontSize: 11, color: C.light, cursor: 'text', paddingTop: 3,
            fontStyle: items.length === 0 ? 'italic' : 'normal',
          }}
        >
          {items.length === 0 ? '(not described yet — optional, click to add)' : '+ add a line (optional)'}
        </div>
      )}
    </div>
  );
}

// ── "Not SDC standard" callout (nonStandardFlags) ───────────────────────────
//
// Amber card listing every place the engineer's description contradicts an
// SDC standard. Jarvis flags and PROCEEDS — never a gate, never a refusal.
// Flags persist into machineSpec.nonStandardFlags on Build.

function NonStandardCard({ flags }) {
  if (!Array.isArray(flags) || flags.length === 0) return null;
  return (
    <div
      data-testid="nonstandard-callout"
      style={{
        border: '1px solid #e6d9a8', background: '#fdf6e3',
        borderRadius: 8, padding: '10px 14px', marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#6b5513',
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          △ Not SDC standard
        </span>
      </div>
      {flags.map((f, i) => (
        <div key={i} data-testid="nonstandard-flag" style={{ fontSize: 12, color: C.text, lineHeight: 1.55, padding: '3px 0' }}>
          <div>
            <span style={{ fontWeight: 700 }}>{f.what}</span>
            {f.severity === 'warning' && (
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#8a3b3b',
                background: '#f5eeee', border: '1px solid #d4a0a0',
                borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap',
              }}>warning</span>
            )}
          </div>
          <div style={{ color: '#6b5513' }}>SDC standard: {f.standard}</div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#6b5513', fontStyle: 'italic', marginTop: 4 }}>
        Jarvis built it your way — flagged for controls review.
      </div>
    </div>
  );
}

// ── IO & Pneumatics card (optional capture — no coverage, never gates) ──────
//
// Rendered ONLY when the summary carries an `io` object (the ME mentioned
// sensors / valves / IO counts). Feeds the machine's valve-bank and IO-bank
// layout; persisted into machineSpec.io on Build.

function IoCard({ io }) {
  if (!ioHasContent(io)) return null;
  const sensors = Array.isArray(io.sensors) ? io.sensors : [];
  const valves = Array.isArray(io.valveFunctions) ? io.valveFunctions : [];
  const notes = String(io.ioNotes || '').trim();
  return (
    <div
      data-testid="summary-section-io"
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
        padding: '10px 14px', marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.text,
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          IO &amp; Pneumatics
        </span>
        <span style={{
          fontSize: 10, color: C.light, whiteSpace: 'nowrap',
          border: `1px solid ${C.border}`, borderRadius: 10, padding: '1px 8px',
        }}>captured — feeds valve/IO layout</span>
      </div>
      {sensors.map((x, i) => (
        <div key={`s${i}`} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.text, lineHeight: 1.55, padding: '2px 0' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex' }}>
            <DeviceIcon type={/analog|pressure|force/i.test(`${x.type ?? ''} ${x.name ?? ''}`) ? 'AnalogSensor' : 'DigitalSensor'} size={15} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{x.name}</span>
            {x.type && <span style={{ color: C.light }}> ({x.type})</span>}
            {x.purpose && <span style={{ color: C.muted }}> — {x.purpose}</span>}
          </span>
        </div>
      ))}
      {valves.map((v, i) => (
        <div key={`v${i}`} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.text, lineHeight: 1.55, padding: '2px 0' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex' }}>
            <DeviceIcon type="PneumaticLinearActuator" size={15} />
          </span>
          <span style={{ minWidth: 0 }}>{v}</span>
        </div>
      ))}
      {notes && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 4 }}>{notes}</div>
      )}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function CreateStationPage() {
  const store = useDiagramStore();
  const sms = store.project?.stateMachines ?? [];
  const otherSms = sms; // the new SM doesn't exist yet — every SM is "other"
  const hasOtherSms = sms.length > 0;
  const draftKey = draftsKeyFor(store);

  // ALWAYS open blank — no silent restore. The only exception: an explicit
  // resume request (StationsPanel "Drafts" row) consumed once, synchronously,
  // before first paint of the fields.
  const initRef = useRef(undefined);
  if (initRef.current === undefined) {
    const resumeId = consumeResumeRequest();
    const resumed = resumeId
      ? loadDrafts(draftKey).find(d => d.draftId === resumeId) ?? null
      : null;
    initRef.current = { draft: resumed, draftId: resumed?.draftId ?? newDraftId() };
  }
  const draft = initRef.current.draft;
  const draftIdRef = useRef(initRef.current.draftId);

  // Structured summaries only — a pre-rework draft with a string summary
  // falls back to the input phase (the raw explanation is preserved).
  const draftSummary = isStructuredSummary(draft?.summary) ? draft.summary : null;

  // mode: 'describe' | 'blank' (old form-first flow)
  const [mode, setMode] = useState('describe');
  // phase: 'input' | 'summarizing' | 'summary' | 'building' | 'specFailed'
  const [phase, setPhase] = useState(() =>
    (draft && draft.phase === 'summary' && draftSummary) ? 'summary' : 'input');
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
  // Unfinished drafts in THIS project (excluding the one being edited) —
  // listed in a banner on the fresh page, resumed only by explicit click.
  const [otherDrafts, setOtherDrafts] = useState(() =>
    loadDrafts(draftKey).filter(d => d.draftId !== draftIdRef.current));
  const [draftImagesDropped, setDraftImagesDropped] = useState(0);

  // Summary loop state (summary is the STRUCTURED object, or null)
  const [summary, setSummary] = useState(draftSummary);
  const [jarvisCoverage, setJarvisCoverage] = useState(draft?.jarvisCoverage ?? null);
  const [questions, setQuestions] = useState(draft?.questions ?? []);
  // Non-standard requests Jarvis flagged (description contradicts an SDC
  // standard) — rendered as the amber callout, persisted into machineSpec.
  const [nonStandardFlags, setNonStandardFlags] = useState(draft?.nonStandardFlags ?? []);
  // In-place edit tracking: baseline = the summary as Jarvis last returned
  // it; ANY inline edit sets dirty and raises the sticky Resubmit bar.
  const [dirty, setDirty] = useState(false);
  const baselineRef = useRef(draftSummary);
  const [changes, setChanges] = useState('');
  const [applying, setApplying] = useState(false);
  // Standing rules JARVIS just learned from the engineer's answers —
  // only facts the model explicitly returned AND the server recorded.
  const [learnedNotes, setLearnedNotes] = useState([]);
  // Question-loop guards: how many Apply-changes rounds have run (after 2,
  // JARVIS is told to ask ZERO new questions) and the full Q&A history
  // (sent with every re-summarize so nothing is ever re-asked).
  const [qaRounds, setQaRounds] = useState(0);
  const [qaHistory, setQaHistory] = useState([]);
  const [summarizeCost, setSummarizeCost] = useState(draft?.summarizeCost ?? 0);
  // Per-station-draft summarize cost ceiling ($). Server reports the real
  // configured value in meta.maxCostUSD; 5 is the documented default.
  const [summarizeCostCap, setSummarizeCostCap] = useState(5);
  const [pulseDone, setPulseDone] = useState(false);
  // Real summarize progress (drives the ProgressRing during
  // 'summarizing' and during Apply changes)
  const [sumPct, setSumPct] = useState(0);
  const [sumStage, setSumStage] = useState('sent');

  const [error, setError] = useState(null);
  const [pct, setPct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [specFailMsg, setSpecFailMsg] = useState('');

  // ── "Nothing is ever silently disabled" (Dan, live-blocked 2026-08) ──────
  // Dan sat with 4/4 coverage and a disabled Build and "didn't know how to
  // move forward" — the empty NAME field was gating hasBuildInput invisibly.
  // Rule now: every not-ready control says WHY, adjacent, and a click is
  // never a dead end — it focuses the offending field and shows the reason.
  const nameRef = useRef(null);
  const [buildHint, setBuildHint] = useState(null);      // reason shown next to Build / Done explaining
  const [nameAttention, setNameAttention] = useState(false); // red-ish outline + hint on the name field
  const [applyHint, setApplyHint] = useState(null);      // reason shown next to Apply changes

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
    if (phase === 'building' || phase === 'specFailed') return;
    const t = setTimeout(() => {
      if (buildSucceededRef.current) return;
      const hasContent = description.trim() || images.length || summaryHasContent(summary) || name.trim();
      if (!hasContent) {
        deleteDraft(draftKey, draftIdRef.current);
        return;
      }
      const { payload, droppedImages } = serializeDraft({
        draftId: draftIdRef.current,
        name, station, description, images,
        phase: phase === 'summary' || phase === 'summarizing' ? 'summary' : 'input',
        summary, jarvisCoverage, questions, nonStandardFlags, summarizeCost,
      });
      if (saveDraft(draftKey, payload)) {
        setDraftImagesDropped(droppedImages);
      } else {
        // Quota exceeded — retry the draft without images so the TEXT survives.
        const { payload: textOnly } = serializeDraft({
          draftId: draftIdRef.current,
          name, station, description, images: [],
          phase: phase === 'summary' ? 'summary' : 'input',
          summary, jarvisCoverage, questions, nonStandardFlags, summarizeCost,
        });
        if (saveDraft(draftKey, textOnly)) setDraftImagesDropped(images.length);
        /* else: storage entirely unavailable — nothing more we can do */
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [name, station, description, images, phase, summary, jarvisCoverage, questions, nonStandardFlags, summarizeCost, draftKey]);

  function clearDraft() {
    deleteDraft(draftKey, draftIdRef.current);
  }

  function handleDiscardDraft() {
    if (!window.confirm('Discard this draft? The explanation, summary and pictures will be deleted.')) return;
    clearDraft();
    buildSucceededRef.current = false;
    draftIdRef.current = newDraftId();
    setName(''); setDescription(''); setImages([]);
    setSummary(null); setJarvisCoverage(null); setQuestions([]); setChanges('');
    setNonStandardFlags([]); setDirty(false); baselineRef.current = null;
    setQaRounds(0); setQaHistory([]); setLearnedNotes([]);
    setSummarizeCost(0); setError(null); setDraftImagesDropped(0);
    setOtherDrafts(loadDrafts(draftKey).filter(d => d.draftId !== draftIdRef.current));
    setPhase('input');
  }

  /** Explicit resume of an unfinished draft (banner chip / StationsPanel). */
  function resumeDraft(d) {
    draftIdRef.current = d.draftId;
    const s = isStructuredSummary(d.summary) ? d.summary : null;
    setName(d.name ?? '');
    if (d.station) setStation(String(d.station));
    setDescription(d.description ?? '');
    setImages((d.images ?? []).map(img => ({
      ...img,
      previewUrl: `data:${img.mediaType};base64,${img.base64}`,
    })));
    setSummary(s);
    baselineRef.current = s;
    setDirty(false);
    setJarvisCoverage(d.jarvisCoverage ?? null);
    setQuestions(d.questions ?? []);
    setNonStandardFlags(d.nonStandardFlags ?? []);
    setSummarizeCost(Number(d.summarizeCost) || 0);
    setQaRounds(0); setQaHistory([]); setChanges(''); setError(null);
    setLearnedNotes([]); setDraftImagesDropped(0);
    setOtherDrafts(loadDrafts(draftKey).filter(x => x.draftId !== d.draftId));
    setPhase(d.phase === 'summary' && s ? 'summary' : 'input');
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
  // Coverage NEVER blocks the Build (v2.0.3): with real input, Build is always
  // clickable. Thin coverage just adds one confirm — Jarvis fills the gaps with
  // SDC-standard assumptions and flags them for review. Open questions never
  // gate either: Jarvis decides them per SDC standards and notes them.
  const hasBuildInput = !!name.trim()
    && !!(usingJarvisVerdicts ? summaryHasContent(summary) : description.trim());

  // The moment a missing requirement is satisfied, its callout goes away —
  // calm, no lingering red.
  useEffect(() => {
    if (name.trim()) setNameAttention(false);
    if (hasBuildInput) setBuildHint(null);
  }, [name, hasBuildInput]);
  useEffect(() => {
    if (changes.trim()) setApplyHint(null);
  }, [changes]);

  /** Focus the raw-explanation textarea (DescribeSurface owns it — reach it
   *  by its stable class inside this page). */
  function focusDescription() {
    document.querySelector('[data-testid="create-station-page"] textarea.form-textarea')?.focus();
  }

  /** What still blocks a Build, in Dan-plain words — null when buildable. */
  function buildBlocker() {
    if (!name.trim()) return { field: 'name', message: 'Name your station to build' };
    if (!(usingJarvisVerdicts ? summaryHasContent(summary) : description.trim())) {
      return { field: 'description', message: 'Describe the station first' };
    }
    return null;
  }

  /** Hovering a not-ready Build shows the reason right away (and points at
   *  the name field when that's the blocker). */
  function handleBuildHover() {
    if (busy || applying) return;
    const blocker = buildBlocker();
    if (!blocker) return;
    setBuildHint(blocker.message);
    if (blocker.field === 'name') setNameAttention(true);
  }

  // Cost gate: the limit is money, never the user's explanation length.
  const overSummarizeBudget = summarizeCost >= summarizeCostCap;
  const budgetMessage = `This station's summary work has reached the $${summarizeCostCap.toFixed(2)} ceiling — raise JARVIS_SUMMARIZE_MAX_COST_USD in .env to continue`;

  // ── Summarize loop (streams real progress) ───────────────────────────────
  async function callSummarize({ priorSummary = '', corrections = '' } = {}) {
    setSumPct(0);
    setSumStage('sent');
    const data = await summarizeRequest({
      description: description.trim(),
      images: images.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
      checklist: coverage.scores,
      sm: { name: name.trim().replace(/\s+/g, ''), displayName: name.trim() || 'New Station' },
      otherSms: otherSms.map(s => ({ name: s.name, displayName: s.displayName ?? s.name })),
      priorSummary,
      corrections,
      round: qaRounds,
      qaHistory,
      priorCoverage: jarvisCoverage,
    }, (pct, stage) => {
      setSumPct(pct);
      setSumStage(stage);
    });
    if (!isStructuredSummary(data.summary)) {
      throw new Error('Server returned an unstructured summary — restart the API server (server.js / specAuthor.js changed)');
    }
    setSummary(data.summary);
    baselineRef.current = data.summary;
    setDirty(false);
    setJarvisCoverage(data.coverage);
    setQuestions(data.questions ?? []);
    setNonStandardFlags(Array.isArray(data.nonStandardFlags) ? data.nonStandardFlags : []);
    const recorded = (Array.isArray(data.learnedFacts) ? data.learnedFacts : [])
      .filter(f => f && f.recorded === true && f.fact)
      .map(f => String(f.fact));
    if (recorded.length) setLearnedNotes(notes => [...notes, ...recorded.filter(f => !notes.includes(f))]);
    setSummarizeCost(c => Number((c + (Number(data.meta?.costUSD) || 0)).toFixed(4)));
    const cap = Number(data.meta?.maxCostUSD);
    if (Number.isFinite(cap) && cap > 0) setSummarizeCostCap(cap);
  }

  async function handleDoneExplaining() {
    if (!description.trim()) return;
    if (overSummarizeBudget) { setError(budgetMessage); return; }
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
    if (applying) return;
    if (!changes.trim()) {
      // Never a silent no-op — say what's needed and put the cursor there.
      setApplyHint('Type or dictate an answer or correction first');
      changesRef.current?.focus();
      return;
    }
    if (overSummarizeBudget) { setError(budgetMessage); return; }
    setError(null);
    setApplying(true);
    // Record this round's Q&A BEFORE the call so the prompt's history and
    // round budget include it (state updates land for the next render;
    // the payload uses the local values below).
    const answered = { questions: questions.slice(), answer: changes.trim() };
    try {
      await callSummarize({
        priorSummary: summaryToText(summary),
        corrections: changes.trim(),
      });
      setQaHistory(h => [...h, answered]);
      setQaRounds(n => n + 1);
      setChanges('');
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  /** Sticky-bar Resubmit: re-run summarize with the in-place edits sent as
   *  corrections (same pipeline as Apply changes). */
  async function handleResubmitEdits() {
    if (applying) return;
    if (overSummarizeBudget) { setError(budgetMessage); return; }
    const corrections = buildEditCorrections(baselineRef.current, summary);
    if (!corrections) { baselineRef.current = summary; setDirty(false); return; }
    setError(null);
    setApplying(true);
    try {
      await callSummarize({ priorSummary: summaryToText(summary), corrections });
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  /** Sticky-bar dismiss: the edits stand as-is, no re-extraction. */
  function handleKeepEdits() {
    baselineRef.current = summary;
    setDirty(false);
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

  /** The ONLY Build entry point. Never blocked by coverage — thin coverage
   *  gets one confirm, then builds. (The old `if (!canBuild) return;` guard
   *  silently ate clicks whenever coverage was < 4/4 — the "blocked at 3 of 4"
   *  bug.) And never a dead end: Build is ALWAYS clickable — a click with a
   *  missing requirement focuses the offending field and says what's needed
   *  (Dan got blocked live by the silently-gating empty name field). */
  function handleBuildClick() {
    if (busy || applying) return;
    const blocker = buildBlocker();
    if (blocker) {
      setBuildHint(blocker.message);
      if (blocker.field === 'name') {
        setNameAttention(true);
        nameRef.current?.focus();
      } else {
        focusDescription();
      }
      return;
    }
    setBuildHint(null);
    if (!allCovered && !window.confirm(
      'Some areas are thin — Jarvis will fill gaps with SDC-standard assumptions and flag them for review. Build?'
    )) return;
    handleBuild();
  }

  /** Done explaining, same rule: clicking with nothing typed focuses the
   *  explanation box and says so — never a silent no-op. */
  function handleDoneExplainingClick() {
    if (busy) return;
    if (!description.trim()) {
      setBuildHint('Describe the station first');
      focusDescription();
      return;
    }
    setBuildHint(null);
    handleDoneExplaining();
  }

  async function handleBuild() {
    if (!hasBuildInput) return;
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
      ? `${summaryToText(summary)}\n\n---\nOriginal explanation (reference only — the summary above is authoritative):\n\n${description.trim()}`
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
        // if the spec extraction below fails. Open questions never gate the
        // build — they ride along as pendingQuestions for CE review.
        machineSpec: {
          version: 1, sourceDescription: desc,
          ...(ioHasContent(summary?.io) ? { io: summary.io } : {}),
          ...(questions.length ? { pendingQuestions: questions.slice() } : {}),
          ...(nonStandardFlags.length ? { nonStandardFlags: nonStandardFlags.map(f => ({ ...f })) } : {}),
        },
      });
      // Hand open questions to Jarvis's question queue (best effort — the
      // pendingQuestions copy above guarantees nothing is lost either way).
      // The diagram extraction's own open questions go to the queue too —
      // there is no post-build review layer to show them in (Dan: "we just
      // verified it all").
      const queuedQuestions = [...questions, ...(dData.openQuestions ?? [])];
      for (const q of queuedQuestions) {
        fetch('/api/jarvis/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            context: `Create Station "${name.trim()}" — built with this question open; Jarvis decided per SDC standards.`,
            source: 'create-station',
          }),
        }).catch(() => { /* queue endpoint unavailable — pendingQuestions has it */ });
      }
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
        machineSpec: {
          ...sData.spec, sourceDescription: desc,
          ...(ioHasContent(summary?.io) ? { io: summary.io } : {}),
          ...(questions.length ? { pendingQuestions: questions.slice() } : {}),
          ...(nonStandardFlags.length ? { nonStandardFlags: nonStandardFlags.map(f => ({ ...f })) } : {}),
        },
      });

      prog.stop();
      setPct(100);

      // ── 5. Done — land on the canvas, NO second review layer. ───────────
      // The summary loop (or the engineer's raw explanation on the direct
      // path) WAS the review. Spec-extraction questions join the queue with
      // the rest; the spec itself is saved above and reachable any time via
      // Jarvis ▾ → Station Spec.
      const specQuestions = sData.questions ?? [];
      for (const q of specQuestions) {
        fetch('/api/jarvis/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            context: `Create Station "${name.trim()}" — spec extraction question; Jarvis decided per SDC standards.`,
            source: 'create-station',
          }),
        }).catch(() => { /* queue endpoint unavailable */ });
      }
      const nQuestions = queuedQuestions.length + specQuestions.length;
      showTransientToast(
        nQuestions > 0
          ? `Station built — spec saved. ${nQuestions} open question${nQuestions === 1 ? '' : 's'} went to Jarvis's queue.`
          : 'Station built — spec saved.'
      );
      store.closeNewSmModal();
      return;
    } catch (e) {
      prog.stop();
      setError(e.message);
      setPhase(returnPhase);
    }
  }

  // ── Back / leave ─────────────────────────────────────────────────────────
  function handleBack() {
    if (phase === 'building' || phase === 'summarizing') return;
    const hasContent = description.trim() || images.length > 0 || summaryHasContent(summary);
    if (hasContent && !window.confirm('Your explanation is saved as a draft — leave anyway?')) return;
    store.closeNewSmModal();
  }

  // ── Old blank flow, kept for edge cases ─────────────────────────────────
  if (mode === 'blank') return <NewStateMachineModal />;

  // (No post-build review layer — a successful Build closes this page and
  //  lands on the canvas with a toast. Jarvis ▾ → Station Spec opens the
  //  saved spec later.)

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
          title={busy ? 'Wait for the current step to finish — nothing is lost, your draft is saved' : undefined}
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

          {phase === 'input' && otherDrafts.length > 0 && (
            <div
              data-testid="unfinished-drafts-banner"
              style={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                marginBottom: 12, background: C.primaryBg,
                border: `1px solid ${C.primaryBorder}`,
                borderRadius: 6, padding: '7px 12px', fontSize: 12, color: C.text,
              }}
            >
              <span>
                {otherDrafts.length} unfinished draft{otherDrafts.length > 1 ? 's' : ''} in
                this project:
              </span>
              {otherDrafts.map(d => (
                <button
                  key={d.draftId}
                  type="button"
                  data-testid={`resume-draft-${d.draftId}`}
                  onClick={() => resumeDraft(d)}
                  title="Resume this draft"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#fff', border: `1px solid ${C.primaryBorder}`,
                    borderRadius: 12, padding: '2px 10px', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, color: C.primary,
                  }}
                >
                  {draftLabel(d)}
                  <span style={{ fontWeight: 400, color: C.muted }}>· {timeAgo(d.savedAt)}</span>
                </button>
              ))}
              <span style={{ color: C.muted }}>— resume one or keep starting fresh.</span>
              <button
                type="button"
                onClick={() => setOtherDrafts([])}
                title="Dismiss (drafts stay in the Stations panel)"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto',
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
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ flex: 1, maxWidth: 340 }}>
                <label className="form-label" style={{ marginTop: 0 }}>
                  Station Name <span title="required" style={{ color: C.danger }}>*</span>
                  {!name.trim() && (
                    <span
                      data-testid="name-needed-tag"
                      style={{
                        marginLeft: 8, fontSize: 10, fontWeight: 600, textTransform: 'none',
                        letterSpacing: 0, borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap',
                        color: nameAttention ? C.danger : C.muted,
                        background: nameAttention ? '#f5eeee' : 'var(--color-sidebar)',
                        border: `1px solid ${nameAttention ? '#d4a0a0' : C.border}`,
                      }}
                    >
                      needed to build
                    </span>
                  )}
                </label>
                <input
                  ref={nameRef}
                  className="form-input"
                  data-testid="station-name-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. MagnetFeed"
                  disabled={busy}
                  style={nameAttention && !name.trim()
                    ? { borderColor: C.danger, boxShadow: '0 0 0 2px rgba(200,80,80,0.18)' }
                    : undefined}
                />
                {nameAttention && !name.trim() && (
                  <div data-testid="name-required-hint" style={{ fontSize: 10.5, color: C.danger, marginTop: 3 }}>
                    required — name your station to build
                  </div>
                )}
              </div>
              <div style={{ width: 110 }}>
                <label className="form-label" style={{ marginTop: 0 }}>
                  Number <span title="required" style={{ color: C.danger }}>*</span>
                </label>
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

                {/* Action row — real progress ring while JARVIS summarizes */}
                {phase === 'summarizing' ? (
                  <div
                    data-testid="summarize-progress"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                      gap: 14, marginTop: 16, minHeight: 76,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                      {SUMMARIZE_STAGE_TEXT[sumStage] ?? 'Working…'}
                    </div>
                    <ProgressRing pct={sumPct} size={76} subLabel="" />
                  </div>
                ) : (
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
                  {buildHint && (
                    <span data-testid="build-hint" style={{ fontSize: 11.5, fontWeight: 600, color: C.danger, whiteSpace: 'nowrap' }}>
                      {buildHint}
                    </span>
                  )}
                  <button
                    className="btn btn--secondary"
                    data-testid="build-without-summary-btn"
                    onClick={handleBuildClick}
                    onMouseEnter={handleBuildHover}
                    disabled={busy}
                    title={hasBuildInput
                      ? (allCovered
                        ? 'Build straight from the raw explanation (skips the summary review)'
                        : 'Build straight from the raw explanation — thin areas are filled with SDC standards and flagged')
                      : (buildBlocker()?.message ?? '')}
                  >
                    Build without summary
                  </button>
                  <button
                    className="btn btn--primary"
                    data-testid="done-explaining-btn"
                    onClick={handleDoneExplainingClick}
                    onMouseEnter={() => { if (!description.trim() && !busy) setBuildHint('Describe the station first'); }}
                    title={description.trim() ? undefined : 'Describe the station first'}
                    disabled={busy}
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
                    Done explaining →
                  </button>
                </div>
                )}
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
                  This is what JARVIS is seeing so far — check each section, edit anything wrong
                </label>
                {summary && SUMMARY_SECTIONS.map(section => (
                  <SummarySection
                    key={section.key}
                    section={section}
                    items={summary[section.key]}
                    cov={jarvisCoverage ? jarvisCoverage[section.covKey] : null}
                    optional={section.key === 'interactions' && !hasOtherSms}
                    onChange={items => {
                      setSummary(s => ({ ...s, [section.key]: items }));
                      setDirty(true);
                    }}
                  />
                ))}
                {summary && <IoCard io={summary.io} />}
                <NonStandardCard flags={nonStandardFlags} />

                {questions.length > 0 && (
                  <div style={{
                    marginTop: 12, border: `1px solid ${C.primaryBorder}`, background: C.primaryBg,
                    borderRadius: 8, padding: '10px 14px',
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: C.primary,
                      letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4,
                    }}>
                      Questions
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
                {overSummarizeBudget && (
                  <div style={{
                    marginTop: 8, fontSize: 11, color: '#6b5513',
                    background: '#fdf6e3', border: '1px solid #e6d9a8',
                    borderRadius: 6, padding: '6px 12px',
                  }}>
                    {budgetMessage}. Building from the current summary still works.
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  {applying && (
                    <div
                      data-testid="apply-changes-progress"
                      style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        {SUMMARIZE_STAGE_TEXT[sumStage] ?? 'Working…'}
                      </span>
                      <ProgressRing pct={sumPct} size={44} subLabel="" />
                    </div>
                  )}
                  {applyHint && !applying && (
                    <span data-testid="apply-hint" style={{ fontSize: 11.5, fontWeight: 600, color: C.danger, whiteSpace: 'nowrap' }}>
                      {applyHint}
                    </span>
                  )}
                  <button
                    className="btn btn--secondary"
                    data-testid="apply-changes-btn"
                    onClick={handleApplyChanges}
                    onMouseEnter={() => { if (!changes.trim() && !applying) setApplyHint('Type or dictate an answer or correction first'); }}
                    disabled={applying || overSummarizeBudget}
                    title={overSummarizeBudget
                      ? budgetMessage
                      : (changes.trim() ? undefined : 'Type or dictate an answer or correction first')}
                  >
                    Apply changes
                  </button>
                </div>

                {/* Standing rules JARVIS learned from the engineer's answers */}
                {learnedNotes.length > 0 && (
                  <div
                    data-testid="jarvis-learned-note"
                    style={{
                      marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 10,
                      border: `1px solid ${C.primaryBorder}`, background: C.primaryBg,
                      borderRadius: 8, padding: '8px 12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {learnedNotes.map((fact, i) => (
                        <div key={i} style={{ fontSize: 12, color: C.text, lineHeight: 1.5, padding: '1px 0' }}>
                          <strong>Jarvis learned:</strong> {fact} — won't ask again.
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={() => setLearnedNotes([])}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: C.muted, fontSize: 14, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}

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
                    <span data-testid="coverage-note" style={{ fontSize: 11, color: C.muted }}>
                      {covered} of {applicable.length} covered — Jarvis will fill the gap{applicable.length - covered > 1 ? 's' : ''} and flag {applicable.length - covered > 1 ? 'them' : 'it'}
                    </span>
                  )}
                  {allCovered && questions.length > 0 && (
                    <span data-testid="open-questions-note" style={{ fontSize: 11, color: C.muted }}>
                      {questions.length} open question{questions.length === 1 ? '' : 's'} — Jarvis will
                      decide these per SDC standards and note them for review.
                    </span>
                  )}
                  {buildHint && (
                    <span data-testid="build-hint" style={{ fontSize: 11.5, fontWeight: 600, color: C.danger, whiteSpace: 'nowrap' }}>
                      {buildHint}
                    </span>
                  )}
                  <button
                    className="btn btn--primary"
                    data-testid="build-station-btn"
                    onClick={handleBuildClick}
                    onMouseEnter={handleBuildHover}
                    disabled={applying}
                    title={hasBuildInput
                      ? (allCovered ? undefined : 'Thin areas are filled with SDC-standard assumptions and flagged for review')
                      : (buildBlocker()?.message ?? '')}
                    style={{
                      fontSize: 14, padding: '9px 22px',
                      transition: 'background 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease',
                      boxShadow: hasBuildInput && !applying ? `0 0 0 3px ${C.primaryBg}` : 'none',
                    }}
                  >
                    Build Station
                  </button>
                </div>

                {/* Sticky edits bar — any inline edit raises it; Resubmit
                    re-runs summarize with the edits as corrections, the
                    dismiss keeps the edits without re-extraction. */}
                {dirty && !applying && (
                  <div
                    data-testid="resubmit-bar"
                    style={{
                      position: 'sticky', bottom: 10, zIndex: 5,
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: '#fff', border: `1px solid ${C.primaryBorder}`,
                      boxShadow: '0 3px 14px rgba(0,0,0,0.13)',
                      borderRadius: 8, padding: '8px 14px', marginTop: 12,
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text }}>
                      You've made edits — Resubmit to Jarvis
                      {overSummarizeBudget && (
                        <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: '#6b5513', marginTop: 2 }}>
                          Resubmit is paused at the ${summarizeCostCap.toFixed(2)} summary ceiling — "keep my edits as-is" still works.
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      data-testid="keep-edits-btn"
                      onClick={handleKeepEdits}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        fontSize: 11, color: C.muted, textDecoration: 'underline', whiteSpace: 'nowrap',
                      }}
                    >
                      keep my edits as-is
                    </button>
                    <button
                      className="btn btn--primary"
                      data-testid="resubmit-btn"
                      onClick={handleResubmitEdits}
                      disabled={applying || overSummarizeBudget}
                      title={overSummarizeBudget ? budgetMessage : 'Re-runs the summary with your edits as corrections'}
                      style={{ fontSize: 12, padding: '6px 16px' }}
                    >
                      Resubmit
                    </button>
                  </div>
                )}
              </div>

              <div>
                <ChecklistPanel
                  scores={effScores}
                  messages={effMessages}
                  hasOtherSms={hasOtherSms}
                  sourceLabel="JARVIS's verdict from your explanation — thin areas never block the Build; they're filled with SDC standards and flagged."
                />
                <div style={{
                  fontSize: 11, color: overSummarizeBudget ? '#6b5513' : C.muted,
                  fontWeight: 600, marginTop: 8, textAlign: 'right',
                  fontFamily: 'Consolas, monospace',
                }}>
                  summary cost so far: ${summarizeCost.toFixed(4)} of ${summarizeCostCap.toFixed(2)} ceiling
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
