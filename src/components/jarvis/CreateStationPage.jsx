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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';
import { COVERAGE_ITEMS, assessCoverage } from '../../lib/coverageChecklist.js';
import { DescribeSurface } from './DescribeSurface.jsx';
import { downscaleImage } from '../../lib/imageUtils.js';
import { DictatedTextarea } from './DictatedTextarea.jsx';
import { SpecQuestionsSection, BlockingShell, ExtraBlockerRow } from './SpecQuestionsSection.jsx';
import { GenerationScopeNote } from './GenerationScopeNote.jsx';
import { useV2Shell } from '../../v2/useV2Shell.js';
import { SheetFlow } from '../../v2/SheetFlow.jsx';
import { DeviceIcon, DEVICE_ICON_COLORS } from '../DeviceIcons.jsx';
import { DEVICE_TYPES, classifyDeviceRole } from '../../lib/deviceTypes.js';
import { getDeviceTags } from '../../lib/tagNaming.js';
import { ValueCell } from '../../v2/ServoValuesTable.jsx';
import { PathDiagram } from './PathDiagram.jsx';
import { smDecompositionOf, stationSmDecompositionOf, groupDevicesBySm, smSplitApprovalOf, approvedSmDecompositionOf, signalSourceOf, unclaimedHandshakesOf, splitDecompositionOf, compiledDecompositionOf } from './smGrouping.js';
import { cascadeStepsOf, deriveCascade, deriveInteractionLines, checkHandshakes, KIND_SECTION, KIND_NOUN } from './cascadeModel.js';
import { stationSmsOf } from '../../lib/stationModel.js';
import { isRealQuestion } from '../../v2/stationNeeds.js';
import { sheetGeometryIssues, axisGeometryIssues } from '../../lib/geometrySanity.js';
import { requiredServoRowsOf, mapVerifyFlagsToServoRows, bandRowLabel, plainServoRowLabel, isSpeedWindowName, orderServoDisplayRows, groupServoRows } from '../../lib/servoBands.js';
import { ProgressRing } from './ProgressRing.jsx';
import { appendChangeLog, ChangeLogPanel, classifyEditRequest, classChipLabel, localChangeLogOf } from './stationChangeLog.jsx';
import { NewStateMachineModal } from '../modals/NewStateMachineModal.jsx';
import {
  draftsKeyFor, loadDrafts, saveDraft, deleteDraft, newDraftId,
  consumeResumeRequest, peekResumeRequest, draftLabel, timeAgo,
  imgHash, ensureStationSheetDraft,
  markActiveFreshDraft, clearActiveFreshDraft, peekActiveFreshDraft,
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

// ── Level of code generation (Dan, Aug 24) ──────────────────────────────────
// Not "notes" — the BUILD-LEVEL INTENT: 2-3 presets that map onto the
// pipeline's real scope contract (machineSpec.generationScope, consumed by
// lib/agentGenerator/generationScope.js renderGenerationScopeText) + a free
// talk/type line (machineSpec.purpose) for specifics. Only presets that map
// to real pipeline behavior today — no aspirational options.
const SCOPE_GEN_BASE = [
  'station sequence logic',
  'servo motion commands',
  'device commands & verification',
  'state transitions',
  'basic sequence faults/retries needed for the sequence',
];
const SCOPE_NOTYET_BASE = [
  'machine-level part tracking',
  'upstream/downstream coordination beyond defined IO',
  'overall machine initialization',
  'machine-wide fault manager',
  'production/OEE logic',
  'supervisor sequencing outside this station',
];
const GEN_LEVELS = [
  {
    id: 'proving',
    label: 'Sequence & fault recovery — proving the logic',
    title: 'Standalone / test build: prove the sequence and the fault recovery; machine-level extras stay quietly deferred',
    scope: {
      generate: ['a standalone PROVING build — sequence & fault-recovery focus', ...SCOPE_GEN_BASE],
      notYet: SCOPE_NOTYET_BASE,
    },
  },
  {
    id: 'standard',
    label: 'Full station — standard build',
    title: 'The default: the full station file with the standard SDC scope contract',
    scope: null, // null → the pipeline default (normalizeGenerationScope)
  },
  {
    id: 'hooks',
    label: 'Full station + machine hooks',
    title: 'Interactions are live: also generate the coordination signals with the defined peer stations',
    scope: {
      generate: [...SCOPE_GEN_BASE,
        'coordination signals with the defined peer stations (the sheet’s interactions)'],
      notYet: SCOPE_NOTYET_BASE.filter(x =>
        !/upstream\/downstream coordination|supervisor sequencing/.test(x)),
    },
  },
];
const genLevelOf = (id) => GEN_LEVELS.find(l => l.id === id) ?? GEN_LEVELS[1];

/** The "Level of code generation" field: preset chips + the free specifics
 *  line. Shared by the input and summary phases. Readable measure (≤900px). */
function GenerationLevelField({ level, onLevel, purpose, onPurpose, disabled, savedTick }) {
  return (
    <div style={{ marginBottom: 12, maxWidth: 900 }}>
      <label className="form-label" style={{ marginTop: 0 }}>
        Level of code generation
        <SaveTick state={savedTick} testId="gen-level-savetick" />
      </label>
      <div data-testid="gen-level-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {GEN_LEVELS.map(l => {
          const on = l.id === level;
          return (
            <button
              key={l.id}
              type="button"
              data-testid={`gen-level-${l.id}`}
              onClick={() => onLevel(l.id)}
              disabled={disabled}
              title={l.title}
              style={{
                ...chipBase, cursor: disabled ? 'default' : 'pointer',
                fontSize: 11, padding: '3px 12px',
                color: on ? '#fff' : C.muted,
                background: on ? C.primary : 'var(--color-sidebar)',
                border: `1px solid ${on ? C.primary : C.border}`,
              }}
            >{on ? '✓ ' : ''}{l.label}</button>
          );
        })}
      </div>
      <DictatedTextarea
        value={purpose}
        onChange={v => onPurpose(v.replace(/\n/g, ' '))}
        rows={1}
        data-testid="build-purpose-input"
        micTestId="build-purpose-mic"
        placeholder="specifics — type or talk"
        className="form-input"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, resize: 'none', lineHeight: 1.5, paddingTop: 7, paddingBottom: 7, paddingLeft: 10 }}
      />
    </div>
  );
}

// ── SAVE-STATE TICKS (Dan, 2026-08-25: "did it take?" is never a question) ──
// Every prose input on the sheet shows a subtle ⟳ while its value awaits the
// debounced autosave and a brief ✓ saved once it lands — same visual spirit
// as the image chips. Driven by ONE savedPulse the autosave effect bumps.

/** Per-field save state: null | 'saving' | 'saved'. `value` is the field's
 *  current value (string — stringify structures); `savedPulse` bumps when the
 *  debounced autosave actually landed. */
function useSaveTick(value, savedPulse) {
  const [state, setState] = useState(null);
  const first = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pending.current = true;
    setState('saving');
  }, [value]);
  useEffect(() => {
    if (!savedPulse || !pending.current) return undefined;
    pending.current = false;
    setState('saved');
    const t = setTimeout(() => setState(null), 1600);
    return () => clearTimeout(t);
  }, [savedPulse]);
  return state;
}

/** The tick itself — quiet, inline with the field's label. `onDark` for the
 *  colored section headers. */
function SaveTick({ state, onDark = false, testId }) {
  if (!state) return null;
  const saved = state === 'saved';
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 10, fontWeight: 600, marginLeft: 8, whiteSpace: 'nowrap',
        textTransform: 'none', letterSpacing: 0,
        color: onDark
          ? (saved ? '#b7f0c3' : 'rgba(255,255,255,0.65)')
          : (saved ? 'var(--color-success)' : C.light),
      }}
    >{saved ? '✓ saved' : '⟳ saving…'}</span>
  );
}

/** "State machines you're expecting (optional)" — the ME proposes the SM
 *  decomposition (Dan, 2026-08-25). Free talk/type line, raw text persisted on
 *  machineSpec.expectedStateMachines. GUIDANCE, not command: the compile
 *  weighs it against the asynchrony test — agrees or counters WITH the
 *  reasoning shown — never silently ignores it, never blindly obeys it. */
/** One small SM pill — used for both the ME's expected machines and Jarvis's
 *  proposed ones. */
function SmPill({ label, note, tone = 'neutral', testId }) {
  const tones = {
    neutral: { color: C.text, bg: 'var(--color-sidebar)', border: C.border },
    proposed: { color: '#1d4ed8', bg: '#e8f0fa', border: '#a8c8e8' },
    approved: { color: '#2f6b3c', bg: '#e9f5ec', border: '#bfe0c8' },
  }[tone] ?? { color: C.text, bg: 'var(--color-sidebar)', border: C.border };
  return (
    <span
      data-testid={testId}
      title={note || undefined}
      style={{
        ...chipBase, fontSize: 11, padding: '2px 10px',
        color: tones.color, background: tones.bg, border: `1px solid ${tones.border}`,
      }}
    >{label}</span>
  );
}

/** RETIRED (Dan, 2026-08-25): "State machines you're expecting" is gone as an
 *  input — Jarvis proposes from the overall description and the ME argues with
 *  the PROPOSAL. Kept only as a reference for the pills styling. */
// eslint-disable-next-line no-unused-vars
function ExpectedSmsField({ value, onChange, pills = [], disabled, savedTick }) {
  // PILLS, NOT THE PARAGRAPH (Dan, 2026-08-25): once the extraction has
  // distilled the dictation into expected-SM pills, the pills ARE the display;
  // the raw transcript (still the editing surface) collapses under a small
  // "what you said" expander. No pills yet → the plain input, as before.
  const [showRaw, setShowRaw] = useState(false);
  const hasPills = (pills?.length ?? 0) > 0;
  const input = (
    <DictatedTextarea
      value={value}
      onChange={v => onChange(v.replace(/\n/g, ' '))}
      rows={1}
      disabled={disabled}
      data-testid="expected-sms-input"
      micTestId="expected-sms-mic"
      placeholder="e.g. dial indexer SM, magnet shuttle SM, magnet pick SM, maybe robot?"
      className="form-input"
      style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, resize: 'none', lineHeight: 1.5, paddingTop: 7, paddingBottom: 7, paddingLeft: 10 }}
    />
  );
  return (
    <div style={{ marginBottom: 12, maxWidth: 900 }}>
      <label className="form-label" style={{ marginTop: 0 }}>
        State machines you're expecting
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: C.light, marginLeft: 6 }}>
          optional — Jarvis weighs it and agrees or counters with his reasoning
        </span>
        <SaveTick state={savedTick} testId="expected-sms-savetick" />
      </label>
      {hasPills ? (
        <>
          <div data-testid="expected-sms-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {pills.map((p, i) => (
              <SmPill key={i} label={p.name} note={p.note} testId={`expected-sms-pill-${i}`} />
            ))}
          </div>
          <button
            type="button"
            data-testid="expected-sms-raw-toggle"
            onClick={() => setShowRaw(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 10.5, color: C.light, marginTop: 3,
            }}
          >{showRaw ? '▾ what you said' : '▸ what you said'}</button>
          {showRaw && <div style={{ marginTop: 3 }}>{input}</div>}
        </>
      ) : input}
    </div>
  );
}

/** "Jarvis needs from the model:" — the station's OPEN MECHANICAL-domain
 *  questions from the Jarvis queue, surfaced HERE on the spec sheet because
 *  they belong to the ME (positions, clearances, heights live in the
 *  mechanical model — never on a controls surface; 2026-08-22 ServoPNP
 *  incident). Renders nothing when the model has answered everything. */
function ModelNeedsPanel({ smName, smDisplayName, sm = null }) {
  const [items, setItems] = useState(null);
  // Same premise test as questionRouter.closeStaleQuestionsForStation (that
  // file is CommonJS/server-side — the regex is duplicated here on purpose).
  const STALE_PREMISE = /placeholder|default position values|values are (placeholders|defaults)|give real (travel|position)|real travel and transition-point values/i;
  const posMissing = (p) => p?.defaultValue === null || p?.defaultValue === undefined || p?.defaultValue === '';
  const tablesFilled = (() => {
    const servos = (sm?.devices ?? []).filter(d => d.type === 'ServoAxis');
    return servos.length > 0 && servos.every(d =>
      Array.isArray(d.positions) && d.positions.length > 0 && d.positions.every(p => !posMissing(p)));
  })();
  useEffect(() => {
    let alive = true;
    (async () => {
      // VIEW-SIDE stale hygiene (Dan, Aug 24): a filled sheet must never
      // DISPLAY a request it already answers — close stale placeholder-value
      // questions via the API before listing (same rule as the compile pass).
      if (sm && tablesFilled) {
        try {
          await fetch('/api/jarvis/questions/close-stale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sm: {
                name: sm.name, displayName: sm.displayName,
                devices: (sm.devices ?? []).map(d => ({ type: d.type, positions: d.positions })),
              },
            }),
          });
        } catch { /* the render-side filter below still hides it */ }
      }
      try {
        const r = await fetch('/api/jarvis/questions');
        const qs = r.ok ? await r.json() : [];
        if (!alive) return;
        const names = [smName, smDisplayName].filter(Boolean);
        setItems((Array.isArray(qs) ? qs : []).filter(q =>
          q && q.status === 'open' && q.domain === 'mechanical' &&
          names.some(n =>
            String(q.context || '').includes(n) || String(q.buildRef || '').includes(n)) &&
          // Belt-and-braces: even if the close API is unavailable, a stale
          // placeholder-values question never renders once the tables hold
          // real values.
          !(tablesFilled && STALE_PREMISE.test(String(q.question || '')))));
      } catch { if (alive) setItems([]); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smName, smDisplayName, sm, tablesFilled]);
  if (!items || items.length === 0) return null;
  return (
    <div
      data-testid="model-needs-panel"
      style={{
        marginBottom: 12, background: C.primaryBg,
        border: `1px solid ${C.primaryBorder}`, borderRadius: 6,
        padding: '8px 12px', fontSize: 12, color: C.text,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        Needed from the mechanical model:
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
        {items.map(q => (
          <li key={q.id} data-testid={`model-need-${q.id}`}>{q.question}</li>
        ))}
      </ul>
      <div style={{ marginTop: 4, fontSize: 11, color: C.muted }}>
        Fill the device / position tables below (or extend the description) — the tables
        are the answer source.
      </div>
    </div>
  );
}

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

/** Merge the STATION DATA SHEET (summary.devices) into the freshly drafted
 *  SM devices so the tables the ME just filled actually reach the station:
 *  pneumatic sensorArrangement + delay timers, servo positions (name +
 *  defaultValue mm) and Fast/Slow speed profiles. Matched by normalized
 *  name (either direction contains the other). */
function applySheetToDrafted(devices, sheetDevices) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const findSheet = (dev) => (sheetDevices ?? []).find(sd => {
    const a = norm(sd.name);
    const b = norm(dev.name);
    const c = norm(dev.displayName);
    if (!a) return false;
    return a === b || a === c || b.includes(a) || a.includes(b) || (c && (c.includes(a) || a.includes(c)));
  });
  return (devices ?? []).map(dev => {
    const sd = findSheet(dev);
    if (!sd) return dev;
    const out = { ...dev };
    if (PNEUMATIC_SHEET_TYPES.includes(dev.type)) {
      out.sensorArrangement = effSensorArrangement({ ...sd, type: dev.type });
      // HOME STATE: declared-or-default, always explicit on the built device
      // (the exporter's Home Conditions read device.homePosition op values).
      out.homePosition = effHomeState({ ...sd, type: dev.type }).value;
      if (sd.strokeMm != null) out.strokeMm = sd.strokeMm;
      const delays = effDelays({ ...sd, type: dev.type });
      if (dev.type === 'PneumaticGripper') {
        out.engageTimerMs = delays.extendMs;
        out.disengageTimerMs = delays.retractMs;
      } else {
        out.extTimerMs = delays.extendMs;
        out.retTimerMs = delays.retractMs;
      }
    }
    if (dev.type === 'ServoAxis' && (isRotarySheetAxis(sd) || dev.motionType === 'rotary')) {
      // ROTARY / DIAL persistence (Dan's Magnet Dial round, 2026-08-25):
      // fixtures + derived increment land on the SM the way the store's dial
      // template stores them — motionType 'rotary' and an Index position row
      // (moveType 'Idx', heads = fixture count, defaultValue = degrees).
      out.motionType = 'rotary';
      const n = Number(sd.fixtureCount);
      if (Number.isFinite(n) && n >= 2) {
        const inc = effIndexIncrement(sd).value ?? Math.round((360 / n) * 10000) / 10000;
        const rows = (out.positions ?? dev.positions ?? []).map(p => ({ ...p }));
        const idxRow = rows.find(p => p?.type === 'index' || /^index$/i.test(String(p?.name ?? '')));
        if (idxRow) {
          idxRow.name = idxRow.name || 'Index';
          idxRow.type = 'index';
          idxRow.moveType = 'Idx';
          idxRow.defaultValue = inc;
          idxRow.value = inc;
          idxRow.heads = Math.round(n);
        } else {
          rows.push({
            id: uid(), name: 'Index', type: 'index', moveType: 'Idx',
            defaultValue: inc, value: inc, heads: Math.round(n),
            isHome: false, isRecipe: false,
          });
        }
        out.positions = rows;
        // Ride-alongs for the sheet round-trip (inert to the exporter).
        out.fixtureCount = Math.round(n);
        if (sd.indexIncrementDeg != null) out.indexIncrementDeg = sd.indexIncrementDeg;
      }
      // Rotation direction (Dan, 2026-08-25) — always explicit on the built axis.
      out.rotationDirection = effDirection(sd);
    }
    if (dev.type === 'ServoAxis' && (sd.positions ?? []).length) {
      const existing = (out.positions ?? dev.positions ?? []).map(p => ({ ...p }));
      const byName = new Map(existing.map(p => [norm(p.name), p]));
      for (const p of sd.positions) {
        const val = posValueMissing(p) ? null : Number(p.valueMm);
        const hit = byName.get(norm(p.name));
        if (hit) {
          if (val !== null) { hit.defaultValue = val; hit.value = val; }
        } else {
          existing.push({
            id: uid(), name: String(p.name).replace(/\s+/g, '_'),
            defaultValue: val, value: val ?? 0,
            moveType: 'Pos', type: 'position',
            isHome: /home/i.test(p.name), isRecipe: false,
          });
        }
      }
      // HOME POSITION: the declared (or intelligently defaulted) home row is
      // marked isHome on the built axis — servo home is 'dynamic' in
      // deviceTypes.js, resolved from positions[].isHome. homePositionName
      // rides along for the IR / sheet round-trip (inert to the exporter).
      const homeName = effHomePosition({ ...sd, type: 'ServoAxis' }).value;
      if (homeName) {
        out.homePositionName = existing.find(p => norm(p.name) === norm(homeName))?.name ?? homeName;
        for (const p of existing) p.isHome = norm(p.name) === norm(homeName);
      }
      out.positions = existing;
      const sp = (dev.speedProfiles ?? []).map(x => ({ ...x }));
      const upsertSpeed = (label, speed) => {
        if (speed == null) return;
        const hit = sp.find(x => norm(x.name) === norm(label));
        if (hit) hit.speed = speed;
        else sp.push({ name: label, speed, accel: 5000, decel: 5000 });
      };
      // Speeds are ALWAYS filled (SDC standard 1000/100 prefill; ME-stated wins).
      const eff = effSpeeds(sd);
      upsertSpeed('Fast', eff.fastMmS);
      upsertSpeed('Slow', eff.slowMmS);
      // Extra named speeds from the sheet ("+ add speed") ride along too.
      for (const x of sd.speedProfiles ?? []) {
        if (x?.name && x.mmS != null) upsertSpeed(x.name, x.mmS);
      }
      if (sp.length) out.speedProfiles = sp;
    }
    return out;
  });
}

// Staged progress while the two POSTs run (honest about being staged —
// each stage creeps toward its cap; real events jump it forward).
const STAGES = [
  { until: 10, label: 'Sending your explanation…', ms: 1500 },
  { until: 62, label: 'Drawing the station sequence…', ms: 90000 },
  { until: 70, label: 'Placing the station in this project…', ms: 3000 },
  { until: 92, label: 'Extracting the station spec…', ms: 30000 },
];
// Rebuild wording (Dan, Aug 24): proper phrases, never truncated fragments —
// the deliberate "push the sheet downstream" step reads like one.
const REBUILD_STAGES = [
  { until: 10, label: 'Sending your sheet…', ms: 1500 },
  { until: 62, label: 'Rebuilding the sequence from your sheet…', ms: 90000 },
  { until: 70, label: 'Updating the station in this project…', ms: 3000 },
  { until: 92, label: 'Refreshing the station spec…', ms: 30000 },
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

/** SDC device-name style (Dan, Aug 24): first letter of EVERY word
 *  capitalized — XAxis, ZAxis, PartGripper. Applied when a device name is
 *  committed (typed or edited) and by the extraction server-side; existing
 *  devices on a live station are never renamed silently. */
/** BREVITY LAW on cards (Dan, 2026-08-25: rung text in a signal card): one
 *  short sentence max — the full text lives in the tooltip. */
function cardOneLiner(text, max = 90) {
  const t = String(text ?? '').trim();
  if (!t) return { line: '', full: '' };
  // First sentence-ish fragment: stop at '. ', ' - ' before rung/tag noise.
  let line = t.split(/(?<=[.!?])\s+/)[0];
  const dash = line.indexOf(' - ');
  if (dash > 20) line = line.slice(0, dash);
  if (line.length > max) line = `${line.slice(0, max - 1).trimEnd()}…`;
  return { line, full: t };
}

function capDeviceName(s) {
  const t = String(s ?? '').trim();
  if (!t) return t;
  return t.replace(/(^|[\s_-]+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// ── Apply receipt (Dan, Aug 24: "I hit apply changes and idk what actually
//    changed") — the model reports changesMade sentences (the card); this
//    client diff finds WHICH rows/cards changed (the 2s amber flashes).
//    Nothing silent: zero model sentences + zero diffs = an explicit
//    "nothing changed" line on the card. ─────────────────────────────────────

/** Diff two structured summaries. Returns { rows:[{key,index}] } against the
 *  NEXT summary plus fallback one-line sentences when the model gave none. */
function diffSummaryChanges(prev, next) {
  const rows = [];
  const sentences = [];
  if (!isStructuredSummary(prev) || !isStructuredSummary(next)) return { rows, sentences };
  const SECTION_WORD = { sequence: 'Sequence step', failureHandling: 'Fault recovery step' };
  for (const key of ['sequence', 'failureHandling', 'interactions']) {
    const a = sectionToLines(key, prev[key] ?? []);
    const b = sectionToLines(key, next[key] ?? []);
    b.forEach((line, i) => {
      if (!a.includes(line)) {
        rows.push({ key, index: i });
        sentences.push({
          section: key,
          text: key === 'interactions'
            ? `Interaction updated: ${line}`
            : `${SECTION_WORD[key]} ${i + 1}: ${line}`,
        });
      }
    });
    if (a.length > b.length) {
      sentences.push({ section: key, text: `${a.length - b.length} line${a.length - b.length === 1 ? '' : 's'} removed from ${key === 'failureHandling' ? 'fault recovery' : key}` });
    }
  }
  // Devices: header line AND sheet fields (sensors, delays, positions…) count.
  // KEY-ORDER-INSENSITIVE compare — an agentic round-trip reorders JSON keys;
  // that is not a change and must never fabricate an "updated" receipt line.
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  };
  const prevDevs = prev.devices ?? [];
  (next.devices ?? []).forEach((d, i) => {
    const hit = findByName(prevDevs, d.name);
    if (!hit) {
      rows.push({ key: 'devices', index: i });
      sentences.push({ section: 'devices', text: `Device added: ${d.name}` });
    } else if (stable(hit) !== stable(d)) {
      rows.push({ key: 'devices', index: i });
      sentences.push({ section: 'devices', text: `${d.name} updated` });
    }
  });
  for (const q of prevDevs) {
    if (!findByName(next.devices ?? [], q.name)) {
      sentences.push({ section: 'devices', text: `Device removed: ${q.name}` });
    }
  }
  return { rows, sentences };
}

/** 2s amber flash on the changed rows/cards — cheap DOM styling keyed off
 *  the same testids the rows already carry (same pattern as goToBlocker). */
function flashSummaryRows(rows) {
  if (!rows.length) return;
  setTimeout(() => {
    for (const r of rows) {
      const ids = r.key === 'devices'
        ? [`sheet-servo-${r.index}`, `sheet-pneumatic-${r.index}`, `sheet-device-${r.index}`]
        : r.key === 'interactions'
          ? [`interaction-how-${r.index}`]
          : [`summary-line-${r.key}-${r.index}`];
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) continue;
        const prevBg = el.style.background;
        el.style.transition = 'background 0.45s ease';
        el.style.background = '#fdeeb5';
        setTimeout(() => { el.style.background = prevBg || ''; }, 2000);
        break;
      }
    }
  }, 200);
}

/** One turn in the Corrections chat (Dan, Aug 24: corrections is a chat with
 *  Jarvis — the same layer that generates the code). ME turns right-aligned
 *  SDC-blue; Jarvis turns left with the computed what-changed bullets. */
function ChatTurn({ turn, idx, onRetry = null }) {
  const me = turn?.role === 'me';
  return (
    <div
      data-testid={`chat-turn-${idx}`}
      style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start', padding: '2px 0' }}
    >
      <div style={{
        maxWidth: '78%', fontSize: 12, lineHeight: 1.5, borderRadius: 8, padding: '6px 10px',
        ...(me
          ? { background: C.primaryBg, border: `1px solid ${C.primaryBorder}`, color: C.text }
          : turn?.error
            ? { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b' }
            : turn?.reading
              // The spoken READING — visibly lighter than a receipt (it lands
              // before the edits do; Dan can catch a misread here).
              ? { background: '#f6f8fb', border: '1px dashed #b8c4d0', color: C.muted, fontStyle: 'italic' }
              : { background: '#f4faf4', border: '1px solid #b7d9b0', color: C.text }),
      }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: me ? C.primary : '#2f6b2f', marginBottom: 2 }}>
          {me ? 'You' : 'SDC Engineer'}
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{turn?.text}</div>
        {!me && turn?.error && turn?.retryText && onRetry && (
          <button
            type="button"
            data-testid={`chat-retry-${idx}`}
            onClick={onRetry}
            style={{
              marginTop: 5, cursor: 'pointer', fontSize: 11.5, fontWeight: 800,
              color: '#fff', background: '#b91c1c', border: 'none', borderRadius: 5, padding: '3px 14px',
            }}
          >Retry</button>
        )}
        {!me && (turn?.items?.length ?? 0) > 0 && (
          <div style={{ marginTop: 4 }}>
            {turn.items.map((c, i) => (
              <div
                key={i}
                data-testid={`chat-receipt-item-${idx}-${i}`}
                style={{ fontSize: 11.5, lineHeight: 1.5, padding: '1px 0', color: c.warn ? '#92400e' : C.text }}
              >
                • {c.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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

// ── STATION DATA SHEET — draft device tables (Dan, Aug 2026) ───────────────
//
// The review screen IS the station data sheet: servo axes get their named-
// position table (values in mm, from the mechanical model — a PREREQUISITE
// for generate), pneumatics get the old AddDeviceModal-style sensor/timer
// setup with SDC defaults prefilled and tagged "(default)", and the IO
// section derives real i_/q_ tag lists from the tables live. Extraction
// fills what the ME's words stated; defaults cover the rest.

const PNEUMATIC_SHEET_TYPES = ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper'];

function sheetType(d) {
  const t = d?.type && DEVICE_TYPES[d.type] ? d.type : guessDeviceType(d);
  return DEVICE_TYPES[t] ? t : 'Custom';
}
const isPneumaticSheet = (d) => PNEUMATIC_SHEET_TYPES.includes(sheetType(d));
const isServoSheet = (d) => sheetType(d) === 'ServoAxis';

/** SDC default sensor arrangement when the ME said nothing (meKnowledge:
 *  retract-only for cylinders — never extend-only; closed-only for grippers). */
function defaultArrangementFor(type) {
  return type === 'PneumaticGripper' ? '1-sensor (Closed only)' : '1-sensor (Ret only)';
}

/** Stroke-based SDC delay default: grippers 250ms; <100mm stroke → 1s;
 *  >100mm → 5s (safe default). Unknown stroke → 1s (typical small cylinder —
 *  type the stroke and the default updates live). */
function defaultDelayMs(d) {
  if (sheetType(d) === 'PneumaticGripper') return 250;
  const s = Number(d?.strokeMm);
  if (Number.isFinite(s) && s > 0) return s < 100 ? 1000 : 5000;
  return 1000;
}

const effSensorArrangement = (d) => d.sensorArrangement ?? defaultArrangementFor(sheetType(d));
function effDelays(d) {
  const def = defaultDelayMs(d);
  return {
    extendMs: d.delays?.extendMs ?? def,
    retractMs: d.delays?.retractMs ?? def,
    extendIsDefault: d.delays?.extendMs == null,
    retractIsDefault: d.delays?.retractMs == null,
  };
}

const posValueMissing = (p) => p?.valueMm === null || p?.valueMm === undefined || p?.valueMm === '';

/** SDC standard servo speeds — ALWAYS prefilled (meKnowledge: Fast 1000 mm/s,
 *  Slow 100 mm/s; the ME never has to fill speeds, only override them). */
const SPEED_DEFAULTS = { fastMmS: 1000, slowMmS: 100 };
function effSpeeds(d) {
  return {
    fastMmS: d.speeds?.fastMmS ?? SPEED_DEFAULTS.fastMmS,
    slowMmS: d.speeds?.slowMmS ?? SPEED_DEFAULTS.slowMmS,
    fastIsDefault: d.speeds?.fastMmS == null,
    slowIsDefault: d.speeds?.slowMmS == null,
  };
}

// ── ROTARY / DIAL AXES (Dan's Magnet Dial round, 2026-08-25) ────────────────
// A dial-index servo thinks in FIXTURES and DEGREES, never mm: the card leads
// with "Fixtures (nests)" (red-needed when unknown) and DERIVES the index
// increment as 360/N in degrees (editable override for non-uniform dials).
// Detected from the extracted motionType, or from the axis's own words when
// the model didn't tag it. Never an "IndexIncrement — mm" row.
const isRotarySheetAxis = (d) => {
  const mt = String(d?.motionType ?? '').toLowerCase();
  if (mt === 'rotary') return true;
  if (mt === 'linear') return false;
  return /\b(dial|rotary|indexer|index table)\b/i.test(`${d?.name ?? ''} ${d?.purpose ?? ''}`);
};
/** Effective index increment (°): explicit override wins; else 360/fixtures. */
function effIndexIncrement(d) {
  const o = Number(d?.indexIncrementDeg);
  if (Number.isFinite(o) && o > 0) return { value: o, derived: false };
  const n = Number(d?.fixtureCount);
  if (Number.isFinite(n) && n >= 2) {
    return { value: Math.round((360 / n) * 10000) / 10000, derived: true };
  }
  return { value: null, derived: true };
}
const fixturesMissing = (d) => !(Number(d?.fixtureCount) >= 2);
/** Dial rotation direction (Dan, 2026-08-25: "his dial draws backwards") —
 *  declared on the card, default CW. Drives the PathDiagram dial glyph and
 *  rides onto the built axis. */
const effDirection = (d) =>
  (String(d?.rotationDirection ?? '').toLowerCase() === 'ccw' ? 'ccw' : 'cw');
/** Index rows never render as plain position rows on a rotary card — the
 *  Fixtures + derived-increment rows own that data. */
const isIndexRowName = (name) => /^index(increment|angle|distance)?$/i.test(String(name ?? '').trim());

// ── HOME per device (Dan, Aug 24) — "the key piece of information: what is
//    the home position of every device; something the ME knows from how they
//    designed the station." Declared on the device card, carried into the
//    built SM (applySheetToDrafted) and into the compile IR so Home
//    Conditions / init / recovery use the DECLARED home, never inference. ──

/** Pneumatic home-state options — SM-canonical op values (deviceTypes.js
 *  homePositions), ME-facing labels per Dan (Retracted/Extended,
 *  Disengaged/Engaged). */
function pneumaticHomeOptions(type) {
  return type === 'PneumaticGripper'
    ? [{ value: 'Disengage', label: 'Disengaged' }, { value: 'Engage', label: 'Engaged' }]
    : [{ value: 'Retract', label: 'Retracted' }, { value: 'Extend', label: 'Extended' }];
}

/** Effective pneumatic home: explicit d.homeState, else SDC default
 *  (cylinder → Retract, gripper → Disengage/open). */
function effHomeState(d) {
  const type = sheetType(d);
  const options = pneumaticHomeOptions(type);
  const explicit = options.some(o => o.value === d.homeState) ? d.homeState : null;
  const def = DEVICE_TYPES[type]?.defaultHomePosition ?? options[0].value;
  return { value: explicit ?? def, isDefault: explicit == null, options };
}

/** Servo home default: a row literally named Home wins; else vertical axes →
 *  Retract (safe height); else horizontal PNP axes → Pick ("none — rests at
 *  pick/place": init leaves X at pick; Dan, Aug 24 round 3); else a single
 *  obvious position homes there. */
function defaultServoHome(d) {
  const names = (d.positions ?? []).map(p => String(p?.name ?? '')).filter(Boolean);
  const home = names.find(n => /^home$/i.test(n)) ?? names.find(n => /home/i.test(n));
  if (home) return home;
  if (VERTICAL_AXIS_HINT.test(`${d.name || ''} ${d.purpose || ''}`)) {
    const ret = names.find(n => /retract/i.test(n));
    if (ret) return ret;
  }
  const pick = names.find(n => /^pick$/i.test(n));
  if (pick) return pick;
  return names.length === 1 ? names[0] : null;
}

/** Effective servo home: explicit d.homePosition when it names one of the
 *  axis's rows, else the intelligent default above (null when unguessable). */
function effHomePosition(d) {
  const names = (d.positions ?? []).map(p => String(p?.name ?? '')).filter(Boolean);
  const explicit = d.homePosition
    ? names.find(n => normKey(n) === normKey(d.homePosition)) ?? null
    : null;
  return { value: explicit ?? defaultServoHome(d), isDefault: explicit == null };
}

/** Compact home select — a normal aligned row value (NARROW CARDS rule:
 *  label sits immediately next to its value; no chips). */
function HomeSelect({ value, options, onChange, testId }) {
  return (
    <select
      data-testid={testId}
      value={value ?? ''}
      onChange={e => onChange(e.target.value || undefined)}
      // ZERO OVERLAP (Dan's screenshot, 2026-08-25): the select fills its own
      // cell and never paints into the value column — long position names
      // truncate inside the control instead of widening the table.
      style={{
        fontSize: 12.5, padding: '3px 6px', border: `1px solid ${C.border}`,
        borderRadius: 6, background: '#fff', color: C.text,
        width: '100%', minWidth: 0, maxWidth: 170, boxSizing: 'border-box',
      }}
    >
      {value == null && <option value="">—</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
      ))}
    </select>
  );
}

/** Per-type verb pair — SINGLE SOURCE: deviceTypes.js operations (gripper =
 *  Engage/Disengage, cylinder = Extend/Retract — never hand-written).
 *  [0] pairs with delays.extendMs, [1] with delays.retractMs. */
function sheetVerbs(type) {
  const ops = DEVICE_TYPES[type]?.operations ?? [];
  return [ops[0]?.value ?? 'Extend', ops[1]?.value ?? 'Retract'];
}

// Sensor checkboxes ↔ sensorArrangement — the old AddDeviceModal interaction
// (per-direction checkboxes; both unchecked = no sensors / timer only).
// Stored strings stay the canonical deviceTypes.js options so tagNaming,
// the extraction, and the defaults all keep agreeing.
// a = the [0] verb's sensor (Extend / Engage-closed), b = the [1] verb's.
function parseSensorChecks(type, arr) {
  const s = String(arr ?? '').toLowerCase();
  if (type === 'PneumaticGripper') {
    return {
      // Never key on bare '1-sensor' for BOTH boxes — '1-sensor (Open only)'
      // must check ONLY b. (The old bare-'1-sensor' → a rule made the Open
      // checkbox a dead click on sensorless grippers: open-only mapped to
      // 'No sensors', which parsed back to unchecked — Dan's Aug 23 bug.)
      a: s.includes('2-sensor') || s.includes('closed') || s.includes('engaged')
        || (s.includes('1-sensor') && !s.includes('open') && !s.includes('disengaged')),
      b: s.includes('2-sensor') || s.includes('open') || s.includes('disengaged'),
    };
  }
  return {
    a: s.includes('2-sensor') || s.includes('ext only'),
    b: s.includes('2-sensor') || (s.includes('1-sensor') && !s.includes('ext only')),
  };
}
function checksToArrangement(type, a, b) {
  if (type === 'PneumaticGripper') {
    if (a && b) return '2-sensor (Closed + Open)';
    if (a) return '1-sensor (Closed only)';
    if (b) return '1-sensor (Open only)'; // fully independent per direction (Dan, Aug 23)
    return 'No sensors';
  }
  if (a && b) return '2-sensor (Ext + Ret)';
  if (b) return '1-sensor (Ret only)';
  if (a) return '1-sensor (Ext only)';
  return 'No sensors';
}

/** Draft-device → the shape tagNaming.getDeviceTags expects, with the sheet's
 *  effective (stated-or-default) sensor arrangement applied. */
function pseudoDeviceFor(d) {
  const type = sheetType(d);
  if (!DEVICE_TYPES[type]) return null;
  const name = String(d.name || '').replace(/[^a-zA-Z0-9]/g, '') || 'Device';
  const dev = { id: name, name, displayName: d.name || name, type };
  if (isPneumaticSheet(d)) dev.sensorArrangement = effSensorArrangement(d);
  if (type === 'ServoAxis') {
    dev.positions = (d.positions ?? []).map(p => ({ name: p.name, value: p.valueMm ?? 0 }));
  }
  return dev;
}

/** Inputs and Outputs lists, derived live from the device tables via the
 *  central tagNaming (never hardcode i_/q_ prefixes). */
function deriveIoLists(devices) {
  const inputs = [];
  const outputs = [];
  for (const d of devices ?? []) {
    const dev = pseudoDeviceFor(d);
    if (!dev) continue;
    let tags = [];
    try { tags = getDeviceTags(dev); } catch { tags = []; }
    for (const t of tags) {
      const row = { tag: t.name, device: d.name, description: t.description };
      if (t.usage === 'Input') inputs.push(row);
      else if (t.usage === 'Output') outputs.push(row);
    }
  }
  return { inputs, outputs };
}

/** A question whose answer is TABULAR DATA never renders as prose (Dan) —
 *  the data sheet's tables with their empty cells ARE that question. Detects
 *  servo position/value asks, pneumatic sensor-arrangement asks, and delay-
 *  timer value asks; genuinely non-tabular questions (geometry intent,
 *  failure behavior, feeds/consumes) pass through untouched. */
function isTabularQuestion(q) {
  const s = String(q).toLowerCase();
  const servoValues =
    /(position|point|height|coordinate)/.test(s)
    && /(servo|axis|axes|pick|place|home|transition|vertical|horizontal|z\b)/.test(s)
    && /(mm|value|number|table|fill|confirm|provide|list|name the|what are)/.test(s);
  const pneumaticSetup =
    /(sensor|reed|prox)/.test(s)
    && /(cylinder|gripper|slide|shuttle|lift|pneumatic|actuator|rotary)/.test(s)
    && /(have|has|arrangement|configur|setup|which|what|confirm|equipped|fitted)/.test(s);
  const timerValues =
    /(delay|timer|dwell)/.test(s)
    && /(ms|millisecond|second|value|setting|how long|what.*(time|duration))/.test(s);
  return servoValues || pneumaticSetup || timerValues;
}

// ── Sheet prefill + reconcile (Dan: "Build everything you can, I fill out
//    anything extra") ─────────────────────────────────────────────────────────
//
// 1. Every servo axis gets its named-position ROWS pre-created — from the
//    extraction when it sent them, otherwise derived here from the sequence
//    (SDC standard PnP shapes: vertical → Retract, PickTransition, Pick,
//    PlaceTransition, Place; horizontal → Home, Pick, Place). The ME only
//    fills mm values; "+ add named value" is for the rare extra.
// 2. ONE SOURCE OF TRUTH: when the heard-device line itself says "no sensors"
//    / "timer only", the card's sensorArrangement is forced to match — an
//    explicit statement from the ME always beats the SDC default, and the
//    device line, the pneumatic card, and the IO list must never disagree.

const VERTICAL_AXIS_HINT = /vert|(^|[^a-z])z([^a-z]|$)|lift|elevat|raise|lower/i;
const NO_SENSOR_WORDS = /no\s*sensors?|sensor-?less|timer[- ]only|only\s+(a\s+)?timer|no\s+reeds?|no\s+prox/i;

function inferredPositionsFor(d, sequence) {
  const seq = (sequence ?? []).join(' ').toLowerCase();
  const vertical = VERTICAL_AXIS_HINT.test(`${d.name || ''} ${d.purpose || ''}`);
  const out = [vertical ? 'Retract' : 'Home'];
  const picks = /pick|grab|grip/.test(seq);
  const places = /place|drop|put|deposit|release/.test(seq);
  if (picks) { if (vertical) out.push('PickTransition'); out.push('Pick'); }
  if (places) { if (vertical) out.push('PlaceTransition'); out.push('Place'); }
  return out;
}

/** Pre-build the data-sheet rows and reconcile explicit ME statements —
 *  applied to EVERY summary before it reaches state (fresh, resumed, or
 *  re-summarized). Idempotent. */
function withSheetPrefill(s) {
  if (!isStructuredSummary(s)) return s;
  let changed = false;
  const devices = s.devices.map(d => {
    let next = d;
    const clone = () => { if (next === d) next = { ...d }; };
    // DEVICE LINKS (Dan, 2026-08-30): every device row carries a STABLE id
    // (devId) so sequence/recovery steps can reference the device, not a
    // name string — renames follow for free. Assigned once, never changes.
    if (!next.devId) {
      clone();
      next.devId = 'dev_' + Math.random().toString(36).slice(2, 10);
      changed = true;
    }
    if (isServoSheet(d) && !isRotarySheetAxis(d) && !(d.positions?.length)) {
      clone();
      next.positions = inferredPositionsFor(d, s.sequence).map(n => ({ name: n }));
      changed = true;
    }
    if (isPneumaticSheet(d)) {
      // The ME's words on the device line beat the SDC DEFAULT — but never an
      // explicit sheet value. Overriding a set arrangement here was the other
      // half of the dead-checkbox bug (Dan, Aug 23): every prefill pass
      // (resume, section edit, apply) snapped a just-checked sensor back to
      // 'No sensors' because the purpose text still said "no sensors".
      const text = `${d.name || ''} ${d.purpose || ''}`;
      if (NO_SENSOR_WORDS.test(text) && d.sensorArrangement == null) {
        clone();
        next.sensorArrangement = 'No sensors';
        changed = true;
      }
    }
    return next;
  });
  return changed ? { ...s, devices } : s;
}

// ── Non-destructive value merge (Dan, Aug 24 — the ServoPNP wipe) ────────────
//
// A fresh extraction returns device/position NAMES — the ME didn't re-speak
// the numbers — so a resummarize / apply-changes result must NEVER replace
// values already on the sheet. ONE shared utility applied on every path where
// new model output meets an existing sheet: filled values are preserved
// unless the new summary explicitly states a different value; rows the
// extraction dropped are KEPT when they hold data; extraction-new rows ADD.
// (Third instance of this bug class — gripper config, images, now servo
// values. Standing law: the ME's explicit data beats everything; closing =
// converting, never vanishing.)

const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Exact normalized match first; contains-match (rename fuzz) as fallback. */
function findByName(list, name, getName = (x) => x?.name) {
  const key = normKey(name);
  if (!key) return undefined;
  const exact = list.find(x => normKey(getName(x)) === key);
  if (exact) return exact;
  return list.find(x => {
    const k = normKey(getName(x));
    return !!k && (k.includes(key) || key.includes(k));
  });
}

/** Merge one prev sheet device's VALUES into its freshly extracted twin. */
function mergeDeviceValues(prev, next) {
  const out = { ...next };
  const prevPos = prev.positions ?? [];
  const merged = (next.positions ?? []).map(p => {
    const hit = findByName(prevPos, p.name);
    if (hit && posValueMissing(p) && !posValueMissing(hit)) return { ...p, valueMm: hit.valueMm };
    return p;
  });
  // KEEP filled rows the extraction dropped — data never vanishes silently.
  for (const q of prevPos) {
    if (!posValueMissing(q) && !findByName(merged, q.name)) merged.push({ ...q });
  }
  if (merged.length) out.positions = merged;
  // Scalar / config fields: a stated value survives a silent extraction.
  // (home included: extraction may propose one when the ME's words state it,
  //  but an ME-set home is never clobbered by extraction silence.)
  for (const key of ['strokeMm', 'sensorArrangement', 'homePosition', 'homeState',
    'motionType', 'fixtureCount', 'indexIncrementDeg', 'rotationDirection']) {
    if (out[key] == null && prev[key] != null) out[key] = prev[key];
  }
  for (const key of ['speeds', 'delays']) {
    if (prev[key] && !next[key]) out[key] = { ...prev[key] };
    else if (prev[key] && next[key]) {
      out[key] = {
        ...prev[key],
        ...Object.fromEntries(Object.entries(next[key]).filter(([, v]) => v != null)),
      };
    }
  }
  if (prev.speedProfiles?.length) {
    const sp = (next.speedProfiles ?? []).slice();
    for (const q of prev.speedProfiles) if (!findByName(sp, q.name)) sp.push({ ...q });
    out.speedProfiles = sp;
  }
  return out;
}

/** Merge an existing sheet's values into a freshly extracted summary. */
function mergeSheetValues(prevSummary, nextSummary) {
  if (!isStructuredSummary(prevSummary) || !isStructuredSummary(nextSummary)) return nextSummary;
  const prevDevs = prevSummary.devices ?? [];
  const usedPrev = new Set();
  const devices = (nextSummary.devices ?? []).map(d => {
    const remaining = prevDevs.filter((q, j) => !usedPrev.has(j));
    const hit = findByName(remaining, d.name);
    if (!hit) return d;
    usedPrev.add(prevDevs.indexOf(hit));
    return mergeDeviceValues(hit, d);
  });
  // Whole devices the extraction dropped: KEEP them when they hold ME data
  // (an unwanted card still has its inline ✕ — nothing vanishes silently).
  prevDevs.forEach((q, j) => {
    if (usedPrev.has(j)) return;
    const holdsData = (q.positions ?? []).some(p => !posValueMissing(p))
      || q.speeds != null || q.delays != null || q.sensorArrangement != null
      || q.strokeMm != null || (q.speedProfiles?.length ?? 0) > 0
      || q.homePosition != null || q.homeState != null
      || q.fixtureCount != null || q.indexIncrementDeg != null
      || q.rotationDirection != null;
    if (holdsData) devices.push(q);
  });
  return { ...nextSummary, devices };
}

/** Rehydrate a linked sheet's values from the BUILT SM's devices — the SM is
 *  the authority for values the ME already committed (wipe recovery: a sheet
 *  that lost values self-heals from the station on load). Unfilled sheet rows
 *  the built axis doesn't know are dropped — if the compile genuinely needs
 *  that point it resurfaces as a proposed band row with a value. */
function hydrateSummaryFromSm(s, sm) {
  if (!isStructuredSummary(s) || !sm) return s;
  const smDevs = sm.devices ?? [];
  const devices = (s.devices ?? []).map(d => {
    const smDev = findByName(smDevs, d.name, (x) => x?.displayName ?? x?.name)
      ?? findByName(smDevs, d.name);
    if (!smDev) return d;
    const next = { ...d };
    if (isServoSheet(d) && smDev.type === 'ServoAxis') {
      const smPos = (smDev.positions ?? []).filter(p => p?.name);
      const smValOf = (p) => {
        const v = p?.defaultValue ?? p?.value;
        return (v === null || v === undefined || v === '') ? null : Number(v);
      };
      let positions = (d.positions ?? []).map(p => {
        if (!posValueMissing(p)) return p;
        const hit = findByName(smPos, p.name);
        const v = hit ? smValOf(hit) : null;
        return v !== null ? { ...p, valueMm: v } : p;
      });
      if (smPos.length) {
        // HYDRATE GUARD (Dan, Aug 24 round 3 — "nobody ever asked for X
        // transitions"): the SM table IS the ME's table (sheet edits write
        // through), so a sheet row the SM doesn't declare is a compile echo —
        // drop it, filled or not; it can never re-add itself. Exact-name
        // match only (the contains-fuzz once made PickTransitionWideBand
        // look like PickTransition). *WideBand rows are dead outright —
        // speed windows no longer exist; the corner blends are the only
        // windows in the system.
        const declared = new Set(smPos.map(q => normKey(q.name)));
        positions = positions.filter(p =>
          declared.has(normKey(p.name)) && !/WideBand$/i.test(String(p?.name ?? '')));
        for (const q of smPos) {
          const v = smValOf(q);
          // EXACT-name check when re-adding SM rows: the contains-fallback
          // made "PickTransitionWideBand" look like "PickTransition" and the
          // committed window row silently vanished from the sheet display.
          if (v !== null && !positions.some(p => normKey(p.name) === normKey(q.name))) {
            positions.push({ name: q.name, valueMm: v });
          }
        }
        // ROW ORDER follows the built axis (Dan, Aug 24 round 2 — the card
        // reads in the axis's own order; sheet-only rows keep their relative
        // place at the end). Stable sort.
        const orderIdx = new Map(smPos.map((p, i) => [normKey(p.name), i]));
        positions = positions
          .map((p, i) => ({ p, i }))
          .sort((a, b) =>
            ((orderIdx.get(normKey(a.p.name)) ?? (1000 + a.i)) - (orderIdx.get(normKey(b.p.name)) ?? (1000 + b.i))))
          .map(x => x.p);
      }
      // ROTARY round-trip (Dan's Magnet Dial round): motionType + fixture
      // count self-heal from the built axis (its Index row carries heads +
      // the increment); Index rows never render as plain position rows.
      if (smDev.motionType === 'rotary' || isRotarySheetAxis(d)) {
        if (next.motionType == null) next.motionType = 'rotary';
        const idxRow = smPos.find(p => p?.type === 'index' || isIndexRowName(p?.name));
        const heads = Number(idxRow?.heads);
        if (next.fixtureCount == null && Number.isFinite(heads) && heads >= 2) {
          next.fixtureCount = Math.round(heads);
        }
        const smInc = smValOf(idxRow);
        const derived = effIndexIncrement(next).value;
        if (next.indexIncrementDeg == null && smInc !== null
          && (derived === null || Math.abs(smInc - derived) > 0.001)) {
          next.indexIncrementDeg = smInc;
        }
        if (next.rotationDirection == null && smDev.rotationDirection) {
          next.rotationDirection = smDev.rotationDirection;
        }
        positions = positions.filter(p => !isIndexRowName(p?.name));
      }
      next.positions = positions;
      const speeds = { ...(d.speeds ?? {}) };
      const extraProfiles = (d.speedProfiles ?? []).slice();
      for (const sp of smDev.speedProfiles ?? []) {
        const v = Number(sp?.speed);
        if (!Number.isFinite(v)) continue;
        const k = normKey(sp.name);
        if (k === 'fast') { if (speeds.fastMmS == null && v !== SPEED_DEFAULTS.fastMmS) speeds.fastMmS = v; }
        else if (k === 'slow') { if (speeds.slowMmS == null && v !== SPEED_DEFAULTS.slowMmS) speeds.slowMmS = v; }
        else if (!findByName(extraProfiles, sp.name)) extraProfiles.push({ name: sp.name, mmS: v });
      }
      if (Object.keys(speeds).length) next.speeds = speeds;
      if (extraProfiles.length) next.speedProfiles = extraProfiles;
      // Home self-heals from the station too (never overrides an ME-set one).
      if (next.homePosition == null) {
        const hp = smDev.homePositionName ?? smPos.find(p => p?.isHome)?.name;
        if (hp) next.homePosition = hp;
      }
    }
    if (isPneumaticSheet(d)) {
      if (next.homeState == null && smDev.homePosition != null) next.homeState = smDev.homePosition;
      if (next.sensorArrangement == null && smDev.sensorArrangement != null) next.sensorArrangement = smDev.sensorArrangement;
      if (next.strokeMm == null && smDev.strokeMm != null) next.strokeMm = smDev.strokeMm;
      const ext = smDev.extTimerMs ?? smDev.engageTimerMs;
      const ret = smDev.retTimerMs ?? smDev.disengageTimerMs;
      if (next.delays?.extendMs == null && ext != null) next.delays = { ...(next.delays ?? {}), extendMs: ext };
      if (next.delays?.retractMs == null && ret != null) next.delays = { ...(next.delays ?? {}), retractMs: ret };
    }
    return next;
  });
  const out = { ...s, devices };
  // Expected-SM pills self-heal from the station (never invented client-side).
  if (!(out.expectedStateMachines?.length) && (sm.machineSpec?.expectedSmPills?.length)) {
    out.expectedStateMachines = sm.machineSpec.expectedSmPills;
  }
  return out;
}

// Section cards: how each summary section renders + edits.
// (Dan, Aug 23: ONE Devices section — the heard-list merged into the device
// cards; "What can go wrong" reads "Fault recovery".)
// Colored identity headers — the SDC estimate-builder trio (dark navy /
// light blue / green). Fault recovery renders INSIDE the Sequence section as
// the second sequence (Dan, Aug 24) — it has no card of its own.
// ORDER = render order: Interactions FIRST — it's initial info the ME gives
// Jarvis, so it lives in the INPUT band above the review sections (Dan,
// Aug 24 two-band restructure).
const SUMMARY_SECTIONS = [
  { key: 'interactions', covKey: 'interactions', title: 'Interactions', color: '#475569', headerNote: 'signals with the machine’s other stations', editHint: 'one per line:  Station: the interaction' },
  { key: 'devices', covKey: 'devices', title: 'Devices', color: '#061d39', headerNote: 'what the station actuates and senses', editHint: 'Name — what it is for' },
  { key: 'sequence', covKey: 'sequence', title: 'Sequence', color: '#334155', headerNote: 'the cycle in order — and how it recovers', editHint: 'one step per line, in order' },
  { key: 'failureHandling', covKey: 'failures', title: 'Fault recovery', renderInside: 'sequence', editHint: 'one step per line, in order:  when → what to do' },
];

// ── Device-type GROUPS laid out ACROSS the page (Dan, Aug 24) ────────────────
// A Servos column and a Pneumatics column side by side — table-like — each
// group header labeled and tinted with its DeviceIcons accent; cards inside
// are tight and only as big as their content. Columns wrap gracefully at
// narrow widths (CSS grid auto-fit).
// THE CLASSIC TAXONOMY (Dan, 2026-08-25: "Other devices" lumping sensors,
// signals, and counters is wrong) — groups key off the ONE shared model
// (deviceTypes classifyDeviceRole) so sheet/diagram/compile/codegen agree on
// what's a signal vs a device vs a counter.
// Count-aware labels (Dan, 2026-08-27): "SERVO AXIS (1)" singular, "SERVO
// AXES (2)" plural — category words (Pneumatics) stay as they are.
const SHEET_DEVICE_GROUPS = [
  { key: 'servos', label: 'Servo axes', singular: 'Servo axis', color: DEVICE_ICON_COLORS.ServoAxis, match: r => r === 'servo' },
  { key: 'pneumatics', label: 'Pneumatics', color: DEVICE_ICON_COLORS.PneumaticGripper, match: r => r === 'pneumatic' },
  { key: 'sensors', label: 'Sensors', singular: 'Sensor', color: DEVICE_ICON_COLORS.DigitalSensor, match: r => r === 'sensor' },
  { key: 'signals', label: 'Signals', singular: 'Signal', color: DEVICE_ICON_COLORS.Signal, match: r => r === 'signal' },
  { key: 'counters', label: 'Counters & values', color: '#0f766e', match: r => r === 'counter' },
  { key: 'other', label: 'Other devices', singular: 'Other device', color: DEVICE_ICON_COLORS.Custom, match: () => true },
];
/** The role the taxonomy assigns a SHEET row (guessed type applied first). */
function sheetRoleOf(d) {
  return classifyDeviceRole({ ...d, type: sheetType(d) });
}
/** Type-group pre-indexed rows ([{d, i}] — ORIGINAL indexes preserved so the
 *  card callbacks keep pointing at summary.devices[i]). Used directly by the
 *  SM-grouped rendering (Dan, 2026-08-25). */
function groupSheetDeviceRows(rows) {
  const groups = SHEET_DEVICE_GROUPS.map(g => ({ ...g, items: [] }));
  for (const row of rows ?? []) {
    const role = sheetRoleOf(row.d);
    (groups.find(g => g.match(role)) ?? groups[groups.length - 1]).items.push(row);
  }
  // SIGNALS ARE NOT DEVICES (Dan, 2026-08-30): devices = devices; signals are
  // the controls layer, auto-generated from the sequence's events — they get
  // NO cards on the sheet. The data keeps them (codegen + the handshake check
  // read the sequence's Signal steps); a signal that can't derive from an
  // event is a chat question, not a card.
  return groups.filter(g => g.items.length > 0 && g.key !== 'signals');
}
function groupSheetDevices(devices) {
  return groupSheetDeviceRows((devices ?? []).map((d, i) => ({ d, i })));
}

// ── Coverage verdicts — covered / needs (Dan, Aug 23: "thin" is dead) ────────
//
// The specAuthor now emits per-section either covered:true or
// needs:[{question, proposedSolution, blocking}]. Older stored drafts carry
// the legacy {score, missing} shape — normalize both here so every renderer
// sees ONE shape: { covered:boolean, needs:[] }.
function normVerdict(c) {
  if (!c || typeof c !== 'object') return null;
  if ('covered' in c || Array.isArray(c.needs)) {
    const needs = (Array.isArray(c.needs) ? c.needs : [])
      .map(n => ({
        question: String(n?.question ?? '').trim(),
        proposedSolution: String(n?.proposedSolution ?? '').trim(),
        blocking: n?.blocking === true,
        // Device attribution (Dan, 2026-08-27): route the question to the
        // named device's machine — by ref, never by string luck.
        ...(n?.device ? { device: String(n.device).trim() } : {}),
      }))
      .filter(n => n.question);
    return { covered: needs.length === 0 && c.covered !== false, needs };
  }
  if (Number(c.score) === 2) return { covered: true, needs: [] };
  const missing = String(c.missing ?? '').trim();
  return {
    covered: !missing && Number(c.score) !== 0 && Number(c.score) !== 1,
    needs: missing ? [{ question: missing, proposedSolution: '', blocking: false }] : [],
  };
}

/** Normalize a whole coverage object (or null). */
function normCoverage(cov) {
  if (!cov || typeof cov !== 'object') return null;
  const out = {};
  for (const k of ['devices', 'sequence', 'failures', 'interactions']) {
    out[k] = normVerdict(cov[k]) ?? { covered: false, needs: [] };
  }
  return out;
}

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

/** THE AGENT LOOP transport (Dan approved 2026-08-28): POSTs the turn, streams
 *  `state` activity labels live, resolves with the `done` payload
 *  { reply, diffs, draft, asks, notes, capped, meta }. */
async function agentTurnRequest(payload, onState, onReading) {
  // STUCK-FOREVER IS IMPOSSIBLE (Dan, 2026-08-30): the server heartbeats
  // every 5s even mid-model-call. 15s of silence = connection lost → say so
  // and RE-ATTACH (the turn keeps running server-side; the finished result
  // is fetchable at /agent-turn/last). Only a failed re-attach is a dead
  // turn. Every turn ends in receipt | reading | failure-with-Retry.
  const turnStart = Date.now();
  const ctrl = new AbortController();
  let lastEvent = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastEvent > 15000) { clearInterval(watchdog); ctrl.abort(); }
  }, 3000);
  try {
    const res = await fetch('/api/jarvis/agent-turn/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const isSse = res.ok && (res.headers.get('content-type') || '').includes('text/event-stream') && !!res.body;
    if (!isSse) {
      const data = await res.json().catch(() => ({}));
      // A 200-but-not-a-stream answer = this tab is older than the server.
      // Never tell him to hard-reload in words — offer the bar (Dan).
      if (res.ok) window.__slbOfferReload?.('The app updated underneath this tab.');
      throw new Error(data.error || (res.ok ? 'this tab is out of date — use the Reload bar below' : `Agent turn failed (${res.status})`));
    }
    let result = null; let err = null;
    await readSse(res, (event, data) => {
      lastEvent = Date.now();
      if (event === 'state') onState?.(data.label);
      else if (event === 'reading') onReading?.(data.text); // his catch-the-misread-early moment
      else if (event === 'done') result = data;
      else if (event === 'error') err = new Error(data.error || 'Agent turn failed');
      // 'ping' just refreshes lastEvent
    });
    if (err) throw err;
    if (!result || !result.ok) throw new Error(result?.error || 'Agent turn ended without a result');
    return result;
  } catch (e) {
    if (e?.name !== 'AbortError') throw e;
    // Connection lost mid-turn — the turn is still running on the server.
    onState?.('connection lost — the turn is still running on the server; reconnecting…');
    if (payload.draftId) {
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline) {
        await new Promise(ok => setTimeout(ok, 5000));
        try {
          const r2 = await fetch(`/api/jarvis/agent-turn/last?draftId=${encodeURIComponent(payload.draftId)}`);
          const d2 = await r2.json().catch(() => null);
          if (d2?.ok && d2.at >= turnStart && d2.result?.ok) return d2.result;
        } catch { /* keep polling until the deadline */ }
      }
    }
    throw new Error('that turn died — the connection dropped and the result never landed');
  } finally {
    clearInterval(watchdog);
  }
}

/** RECEIPT FROM DIFFS ONLY (the law): one plain line composed from the typed
 *  edits the server actually applied — the model's narration never rides. */
function receiptFromAgentDiffs(diffs = []) {
  if (!diffs.length) return '';
  const parts = [];
  const byMachine = new Map();
  const recByMachine = new Map(); // recovery is ITS OWN clause — the P0 where
  let tagOnly = 0;                // "11 changes to the sequence" were recovery
  for (const d of diffs) {
    if (/^recovery\./.test(d.op)) {
      recByMachine.set(d.machine, (recByMachine.get(d.machine) ?? 0) + 1);
    } else if (/^sequence\./.test(d.op)) {
      byMachine.set(d.machine, (byMachine.get(d.machine) ?? 0) + 1);
      if (/set_tag|clear_tag/.test(d.op)) tagOnly += 1;
    }
  }
  for (const [m, n] of byMachine) {
    parts.push(`${n} change${n === 1 ? '' : 's'} to ${m}'s sequence${tagOnly && n === tagOnly ? ' (tags only — no lines touched)' : ''}, shown on its card`);
  }
  for (const [m, n] of recByMachine) {
    parts.push(`${m}'s fault recovery updated (${n} line${n === 1 ? '' : 's'}) — shown in its FAULT RECOVERY panel`);
  }
  const removed = diffs.filter(d => d.op === 'device.remove');
  for (const d of removed) {
    parts.push(`removed ${d.device}${(d.closedQuestions?.length ?? 0) ? ` (its ${d.closedQuestions.length === 1 ? 'open question' : 'questions'} closed)` : ''}`);
  }
  for (const d of diffs.filter(x => x.op === 'device.add')) parts.push(`added ${d.after}${d.machine ? ` to ${d.machine}` : ''}`);
  for (const d of diffs.filter(x => x.op === 'device.rename' || x.op === 'machine.rename')) parts.push(`renamed ${d.before} → ${d.after}`);
  for (const d of diffs.filter(x => x.op === 'device.reassign')) parts.push(`moved ${d.device} to ${d.after}`);
  for (const d of diffs.filter(x => x.op === 'value.set')) parts.push(`set ${d.device} ${d.field} = ${d.after}`);
  const closed = diffs.filter(x => x.op === 'question.close').length;
  if (closed) parts.push(`closed ${closed} question${closed === 1 ? '' : 's'}`);
  const filedCtrl = diffs.filter(x => x.op === 'controls.note').length;
  if (filedCtrl) parts.push(`filed ${filedCtrl === 1 ? 'it' : `${filedCtrl} notes`} to Controls information — on the sheet`);
  const asked = diffs.filter(x => x.op === 'question.ask').length;
  if (asked) parts.push(`${asked} new question${asked === 1 ? '' : 's'} for you`);
  return parts.length ? `Done — ${parts.join('; ')}.` : '';
}

/** Per-machine sequence diff (for the live card highlight) between two
 *  proposal snapshots — same pairing logic as the gate rounds. */
// One tab-instance identity — echo suppression on the live draft channel.
const CLIENT_ID = 'c_' + Math.random().toString(36).slice(2, 10);

function computeProposalSeqDiff(oldMs = [], newMs = [], field = 'sequence') {
  const overlap = (a, b) => {
    const A = new Set(wordsOf(a)); const B = new Set(wordsOf(b));
    const inter = [...A].filter(x => B.has(x)).length;
    return inter / Math.max(1, Math.min(A.size, B.size));
  };
  const nk = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const oldByKey = new Map(oldMs.map(m => [nk(m.name), m]));
  const diffByKey = {};
  for (const m of newMs) {
    const k = nk(m.name);
    const oldSeq = (oldByKey.get(k)?.sequence ?? []).map(x => stripParens(x));
    const newSeq = (m.sequence ?? []).map(x => stripParens(x));
    let removed = oldSeq.filter(x => !newSeq.includes(x));
    let added = newSeq.filter(x => !oldSeq.includes(x));
    const changed = [];
    for (const r0 of [...removed]) {
      const match = added.find(a2 => overlap(r0, a2) >= 0.6);
      if (match) { changed.push([r0, match]); removed = removed.filter(x => x !== r0); added = added.filter(x => x !== match); }
    }
    if (removed.length || added.length || changed.length) {
      diffByKey[k] = { removed, added, changed, machine: m.name, oldSeq };
    }
  }
  return diffByKey;
}

// Honest stage lines for the summarize progress ring.
const SUMMARIZE_STAGE_TEXT = {
  sent: 'Reading your explanation…',
  reading: 'Reading your explanation…',
  writing: 'Writing the summary…',
  done: 'Done',
};

// ── "Explanation" — horizontal coverage strip (Dan, Aug 24) ─────────────────
//
// The checklist Dan keeps ("the checkboxes checking off as you fill them in
// are the point") — now a full-width strip under the blocking bar, not a
// right rail. STANDING RULE: it GROWS vertically to show everything (wraps
// to more rows) — never an internal scrollbar, on this or any panel.
// Titled "Explanation" (Dan, Aug 24): it measures EXPLANATION coverage —
// the red "Blocking code generation" bar above it is the separate authority
// for missing values/questions, so all-green here + red blockers above is
// two different measures, not a contradiction.

function CoverageItem({ item, score, message, optional }) {
  const checked = score === 2;
  const partial = score === 1;
  return (
    <div style={{
      display: 'flex', gap: 7, alignItems: 'flex-start',
      flex: '0 1 auto', minWidth: 170, maxWidth: 330, padding: '2px 0',
    }}>
      <span style={{
        width: 17, height: 17, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: `2px solid ${checked ? C.success : partial ? C.primaryBorder : C.border}`,
        background: checked ? C.success : partial ? C.primaryBg : 'transparent',
        color: checked ? '#fff' : partial ? C.primary : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, lineHeight: 1,
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
            {message ?? item.hint}
          </div>
        )}
      </div>
    </div>
  );
}

function NeedsStrip({ scores, messages, hasOtherSms, sourceLabel }) {
  return (
    <div
      data-testid="needs-strip"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '6px 24px',
        border: `1px solid ${C.border}`, borderRadius: 8,
        background: 'var(--color-sidebar)', padding: '8px 14px', marginBottom: 12,
      }}
    >
      <span
        title={sourceLabel}
        style={{
          fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.05em',
          textTransform: 'uppercase', paddingTop: 3, whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        Explanation
      </span>
      {COVERAGE_ITEMS.map(item => (
        <CoverageItem
          key={item.key}
          item={item}
          score={scores[item.key]}
          message={messages[item.key]}
          optional={item.optionalWhenAlone && !hasOtherSms}
        />
      ))}
    </div>
  );
}

// (SyntheticSignalGroup DELETED — Dan, 2026-08-30: signals are not devices;
//  they get no cards on the sheet. Signal steps stay in the sequence DATA —
//  codegen and the handshake check derive every signal from its event.)

/** Quiet zone header — a subtle band label with a rule (Dan, Aug 24: the
 *  sheet reads as INPUTS then STATION (the review band) — plain words, no
 *  addressing anyone by name). */
function BandHeader({ label, note, first = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: `${first ? 4 : 22}px 0 8px` }}>
      <span style={{
        fontSize: 10.5, fontWeight: 800, color: C.muted, letterSpacing: '0.09em',
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>{label}</span>
      {note && <span style={{ fontSize: 10.5, color: C.light, whiteSpace: 'nowrap' }}>{note}</span>}
      <span style={{ flex: 1, borderBottom: `1px solid ${C.border}`, transform: 'translateY(-3px)' }} />
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

// Square SDC chip look (Dan, Aug 23: match the app-stack chips — small
// radius, flat — not rounded pills).
const chipBase = {
  fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  borderRadius: 3, padding: '1px 8px',
};

/** One advisory need under a section header — the CE-style confirm chip:
 *  "I see X; I plan to handle it this way — agree?" */
function NeedRow({ need, agreed, onAgree, testId }) {
  return (
    <div data-testid={testId} style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, margin: '2px 0 6px',
      background: '#fdf6e3', border: '1px solid #e6d9a8', borderRadius: 4, padding: '5px 9px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: '#6b5513', lineHeight: 1.45 }}>{need.question}</div>
        {need.proposedSolution && (
          <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            Proposed: {need.proposedSolution}
          </div>
        )}
      </div>
      {agreed ? (
        <span style={{ ...chipBase, color: C.success, background: '#e9f5ec', border: '1px solid #bfe0c8', flexShrink: 0 }}>✓ agreed</span>
      ) : (
        <button
          type="button"
          data-testid={testId ? `${testId}-agree` : undefined}
          onClick={onAgree}
          title={need.proposedSolution ? 'Go with the proposed answer' : 'Acknowledge — decided per SDC standards'}
          style={{
            ...chipBase, cursor: 'pointer', flexShrink: 0,
            color: '#6b5513', background: '#fff', border: '1px solid #e6d9a8',
          }}
        >✓ Agree</button>
      )}
    </div>
  );
}

/** Small colored sub-heading inside a section (Main sequence / Fault recovery). */
function SubHead({ children, color = 'var(--color-text-muted)' }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, color, letterSpacing: '0.05em',
      textTransform: 'uppercase', margin: '2px 0 5px', paddingBottom: 2,
      borderBottom: `2px solid ${color}`,
    }}>{children}</div>
  );
}

/** One editable line list for a summary section — extracted so the Sequence
 *  card can render TWO of them (Main sequence + Fault recovery) side by side.
 *  Editability is a hover/cursor affordance — no instructional labels
 *  (Dan, Aug 24: kill the chrome). */
function SectionLines({ sectionKey, items, onChange, editHint, preserveRich = false, testKey, readOnly = false }) {
  const [adding, setAdding] = useState(false);
  const key = testKey ?? sectionKey;
  const lines = sectionToLines(sectionKey, items);
  const numbered = sectionKey === 'sequence' || sectionKey === 'failureHandling';

  const commitLine = (i, text) => {
    const t = String(text).trim();
    if (t === lines[i]) return;
    const next = items.slice();
    if (!t) {
      next.splice(i, 1);
    } else {
      const parsed = linesToSection(sectionKey, t)[0];
      // Devices carry rich data-sheet fields — an inline edit must never wipe them.
      next[i] = preserveRich ? { ...items[i], ...parsed } : parsed;
    }
    onChange(next);
  };
  const commitAdd = (text) => {
    const t = String(text).trim();
    if (!t) return;
    onChange([...items, ...linesToSection(sectionKey, t)]);
  };

  // READ-ONLY PROJECTION (Dan's design ruling, 2026-08-25): outputs are never
  // hand-sculpted — the lines render plainly, no click-to-edit, no add row.
  // Changes flow through the section-Edit → propose → approve loop instead.
  const Wrap = readOnly
    ? ({ children, testId }) => <div data-testid={testId}>{children}</div>
    : EditableLine;

  return (
    <>
      {items.map((item, i) => (
        <Wrap
          key={i}
          line={lines[i]}
          onCommit={t => commitLine(i, t)}
          testId={`summary-line-${key}-${i}`}
        >
          {sectionKey === 'devices' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.text, lineHeight: 1.55, padding: '2px 0' }}>
              <span style={{ flexShrink: 0, display: 'inline-flex' }} data-testid="device-row-icon">
                <DeviceIcon type={guessDeviceType(item)} size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                {/* No description on display (Dan, Aug 24) — tooltip only. */}
                <span style={{ fontWeight: 700 }} title={item.purpose || undefined}>{item.name}</span>
              </span>
            </div>
          ) : numbered ? (
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: C.text, lineHeight: 1.55, padding: '1px 0' }}>
              <span style={{ color: C.muted, fontWeight: 700, width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
              {sectionKey === 'failureHandling' ? (
                // Ordered recovery step — "condition → action", UNIFORM weight
                // (Dan, Aug 24: no mixed bold, whatever the extraction wrote).
                <span style={{ minWidth: 0 }}>
                  <span>{item.when}</span>
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
                </span>
              ) : (
                <span>{item}</span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55, padding: '1px 0' }}>
              {item.station && <span style={{ fontWeight: 700 }}>{item.station}: </span>}
              <span>{item.how}</span>
            </div>
          )}
        </Wrap>
      ))}
      {!readOnly && (adding ? (
        <LineInput
          initial=""
          placeholder={editHint}
          testId={`summary-add-${key}-input`}
          onDone={v => { setAdding(false); if (v !== null) commitAdd(v); }}
        />
      ) : (
        <div
          data-testid={`summary-add-${key}`}
          onClick={() => setAdding(true)}
          title={editHint}
          style={{ fontSize: 11, color: C.light, cursor: 'text', paddingTop: 3 }}
        >
          {sectionKey === 'failureHandling' ? '+ add a step' : '+ add'}
        </div>
      ))}
    </>
  );
}

/** ONE CONSISTENT STACK (Dan, 2026-08-31): every sheet region is a section
 *  bar with the SAME anatomy — dark SDC band, chevron, uppercase title,
 *  "N … — click to expand" when folded, status slot on the right. Built to
 *  match the DEVICES/SEQUENCE header he likes; no odd-one-out styling. */
function SectionBar({ title, color = '#061d39', note = null, foldedNote = null, status = null, collapsed, onToggle, children, testId, maxWidth = undefined, marginBottom = 10 }) {
  return (
    <div data-testid={testId} style={{ maxWidth, marginBottom, border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        title={collapsed ? 'expand' : 'collapse'}
        style={{ display: 'flex', alignItems: 'baseline', gap: 10, cursor: 'pointer', background: color, padding: '5px 14px' }}
      >
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>{collapsed ? '▸' : '▾'}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</span>
        {(collapsed ? (foldedNote ?? note) : note) && (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {collapsed ? (foldedNote ?? note) : note}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {status ? <span onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>{status}</span> : null}
      </div>
      {!collapsed && children != null && <div style={{ padding: '8px 14px 10px' }}>{children}</div>}
    </div>
  );
}

function SummarySection({ section, items, cov, optional, onChange, agreedNeeds, onAgreeNeed, renderBody, savedTick, reviewBar, topPanel, dimmed = false, collapsed = false, onToggleCollapse = null, onOpenQuestions = null }) {
  // SILENCE = COVERED (Dan, Aug 24: "if it's not covered, you're going to
  // ask — so of course it's covered"). No verdict chips at all — a section
  // shows real content, or real NEEDS as NeedRow questions. Nothing else.
  const optionalEmpty = optional && items.length === 0;
  // "None" IS AN INPUT (Dan, Aug 24) — never a dead label: clicking it opens
  // the free-text flow even in a single-station project (note a future /
  // external interaction). Once a line exists, optionalEmpty turns false and
  // the normal editable lines render.
  const [noneEditing, setNoneEditing] = useState(false);
  const needs = (cov?.needs ?? []).filter(n => !n.blocking); // blockers live in the strip

  return (
    <div
      data-testid={`summary-section-${section.key}`}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
        marginBottom: 10, overflow: 'hidden',
        // QUEUED PREVIEW (Dan, 2026-08-26): everything he said is extracted
        // up-front — later cascade steps stay visible, just visibly queued.
        ...(dimmed ? { opacity: 0.62 } : {}),
      }}
    >
      {/* Colored identity header — SDC palette, estimate-builder style. The
          header explains; the body never re-explains. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        background: section.color ?? '#061d39', padding: '5px 14px',
        ...(onToggleCollapse ? { cursor: 'pointer' } : {}),
      }}
        {...(onToggleCollapse ? { onClick: onToggleCollapse, title: collapsed ? 'expand' : 'collapse' } : {})}
      >
        {onToggleCollapse && (
          <span data-testid={`section-collapse-${section.key}`} style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>{collapsed ? '▸' : '▾'}</span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 800, color: '#fff',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          {section.title}
        </span>
        {collapsed ? (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)' }}>
            {items.length} line{items.length === 1 ? '' : 's'} — click to expand
          </span>
        ) : section.headerNote && (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)' }}>{section.headerNote}</span>
        )}
        <SaveTick state={savedTick} onDark testId={`section-savetick-${section.key}`} />
        <span style={{ flex: 1 }} />
        {reviewBar}
      </div>
      {collapsed ? null : (<>
      <div style={{ padding: '8px 14px 10px' }}>
      {topPanel}

      {/* QUESTIONS LIVE IN THE CHAT (Dan, 2026-08-31): no yellow cards on
          sections — just a tiny chip that jumps to the chat's Questions tab. */}
      {!optionalEmpty && needs.filter(n => !agreedNeeds?.has(`${section.covKey}:${n.question}`)).length > 0 && (
        <button
          type="button"
          data-testid={`section-questions-chip-${section.key}`}
          onClick={() => onOpenQuestions?.()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6,
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 4,
            padding: '2px 10px', fontSize: 10.5, fontWeight: 700, color: C.muted, cursor: 'pointer',
          }}
        >
          {needs.filter(n => !agreedNeeds?.has(`${section.covKey}:${n.question}`)).length} question{needs.filter(n => !agreedNeeds?.has(`${section.covKey}:${n.question}`)).length === 1 ? '' : 's'} — in the chat →
        </button>
      )}

      {optionalEmpty ? (
        noneEditing ? (
          <>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
              No other stations in this project yet — describe a future or
              external interaction (one per line:  Station: the interaction).
            </div>
            <SectionLines
              sectionKey={section.key}
              items={items}
              onChange={onChange}
              editHint={section.editHint}
            />
          </>
        ) : (
          // No other stations in the project: the section reads "None" — but
          // it's an INPUT, so clicking it opens the free-text explain flow.
          <div
            data-testid="interactions-none"
            onClick={() => setNoneEditing(true)}
            title="No other stations in this project yet — click to describe a future or external interaction"
            style={{
              fontSize: 12, color: C.muted, cursor: 'text',
              display: 'inline-flex', alignItems: 'baseline', gap: 8,
            }}
          >
            <span>None</span>
            <span style={{ fontSize: 10.5, color: C.light, textDecoration: 'underline' }}>edit</span>
          </div>
        )
      ) : renderBody ? renderBody() : (
        <SectionLines
          sectionKey={section.key}
          items={items}
          onChange={onChange}
          editHint={section.editHint}
          preserveRich={section.key === 'devices'}
        />
      )}

      {/* Per-section change boxes are GONE (Dan, Aug 24): corrections live in
          the ONE Corrections/Changes box — Jarvis routes them to the section
          they name. Inline click-to-edit on every line covers direct fixes. */}
      </div>
      </>)}
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
                borderRadius: 3, padding: '1px 8px', whiteSpace: 'nowrap',
              }}>warning</span>
            )}
          </div>
          <div style={{ color: '#6b5513' }}>SDC standard: {f.standard}</div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#6b5513', fontStyle: 'italic', marginTop: 4 }}>
        Built your way — flagged for controls review.
      </div>
    </div>
  );
}

// ── Station data sheet cards ─────────────────────────────────────────────────

/** Small "(default)" tag — the value is the SDC default, not something the
 *  ME stated; editing the field replaces it with a stated value. */
function DefaultTag() {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 600, color: C.light, whiteSpace: 'nowrap',
      border: `1px solid ${C.border}`, borderRadius: 3, padding: '0px 6px', marginLeft: 5,
    }}>default</span>
  );
}

/** Numeric field that commits on blur/Enter — '' clears back to undefined
 *  (which means "use the default" for delay/stroke fields). */
function NumField({ value, onCommit, width = 76, placeholder = '—', testId, unit, disabled = false, title }) {
  const [draft, setDraft] = useState(value ?? '');
  // Re-sync when the underlying value changes from outside (e.g. a stroke
  // edit changes the delay defaults shown). Previous-prop-in-STATE pattern —
  // a ref here breaks under StrictMode's double render (ref mutation
  // persists across the discarded pass and swallows the resync).
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    if (String(draft) !== String(value ?? '')) setDraft(value ?? '');
  }
  function commit() {
    const t = String(draft).trim();
    if (t === '') { onCommit(undefined); return; }
    const n = Number(t);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(value ?? '');
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <input
        data-testid={testId}
        value={draft}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{
          width, boxSizing: 'border-box', fontSize: 12.5, padding: '4px 8px',
          border: `1px solid ${C.border}`, background: disabled ? 'var(--color-sidebar)' : '#fff',
          borderRadius: 6, color: C.text, textAlign: 'right',
          fontFamily: 'Consolas, monospace',
          cursor: disabled ? 'not-allowed' : undefined,
        }}
      />
      {unit && <span style={{ fontSize: 10.5, color: C.light, marginLeft: 4 }}>{unit}</span>}
    </span>
  );
}

/** Shared device-card shell — the OLD APP's device-card visual language
 *  (`.device-item` in index.css / the Stations panel rows): white card, thin
 *  border, 3px device-colored LEFT border, icon at left, name stacked over
 *  the muted type label. Field content renders below in a compact grid. */
function SheetDeviceCard({ type, name, purpose, onHeaderCommit, onRemove, chips, note, children, testId }) {
  const tdef = DEVICE_TYPES[type];
  // Accent = the DeviceIcons palette (servo orange, gripper purple, …) so the
  // card, its icon, and its group header all agree (Dan, Aug 24).
  const accent = DEVICE_ICON_COLORS[type] ?? tdef?.color ?? '#9ca3af';
  // RENAME = JUST THE NAME (Dan, 2026-08-27: clicking the name surfaced a
  // description field — gone). The edit box carries ONLY the name; the
  // purpose text stays stored (it feeds the prompts) and lives in the
  // tooltip, untouched by a rename.
  const headerLine = String(name ?? '');
  // ZERO OVERLAP at any name length (Dan's screenshot, 2026-08-25): the name
  // ellipsizes inside its own flex cell (full name in the tooltip), chips
  // never shrink, and the card clips — nothing paints over anything.
  const headerContent = (
    <div style={{ fontSize: 12.5, color: '#1e293b', lineHeight: 1.35, padding: '1px 0', minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span
        title={name ? `${name}${purpose ? ` — ${purpose}` : ''}` : undefined}
        style={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >{name}</span>
      {onHeaderCommit && (
        <span
          aria-hidden="true"
          title="Rename — click the name; your wording wins everywhere (sequence, diagram, tags)"
          style={{ fontSize: 10, color: C.light, flexShrink: 0 }}
        >✎</span>
      )}
    </div>
  );
  return (
    <div
      data-testid={testId}
      style={{
        background: '#fff', border: '1px solid #e2e8f0',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6, marginBottom: 8, padding: '6px 10px 7px',
        transition: 'box-shadow 0.15s', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: children ? 5 : 0, minWidth: 0 }}>
        <span style={{ flexShrink: 0, display: 'inline-flex' }}><DeviceIcon type={type} size={18} /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          {onHeaderCommit ? (
            <EditableLine line={headerLine} onCommit={onHeaderCommit} testId={testId ? `${testId}-header` : undefined}>
              {headerContent}
            </EditableLine>
          ) : headerContent}
        </div>
        {chips && <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{chips}</span>}
        {note && (
          <span style={{
            fontSize: 10, color: C.light, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1,
          }}>{note}</span>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label="Remove device"
            title="Remove this device"
            data-testid={testId ? `${testId}-remove` : undefined}
            onClick={onRemove}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: C.light, fontSize: 13, lineHeight: 1, padding: '0 2px', flexShrink: 0,
            }}
          >✕</button>
        )}
      </div>
      {children}
    </div>
  );
}

/** "+ add a device" line under the device cards (Name — what it is for). */
function DeviceAddLine({ onAdd }) {
  const [adding, setAdding] = useState(false);
  if (adding) {
    return (
      <LineInput
        initial=""
        placeholder="Name — what it is for"
        testId="sheet-device-add-input"
        onDone={v => { setAdding(false); if (v !== null) onAdd(v); }}
      />
    );
  }
  return (
    <div
      data-testid="sheet-device-add"
      onClick={() => setAdding(true)}
      title="Name — what it is for"
      style={{ fontSize: 11, color: C.light, cursor: 'text', paddingTop: 3 }}
    >
      + add a device
    </div>
  );
}

/** SERVO VALUES table for one DRAFT axis (device exists only in the summary —
 *  no SM yet). Same anatomy as ServoValuesTable: Position | Value (mm),
 *  "+ add named value" row — then Fast/Slow SPEED ROWS in the same table
 *  (values aligned in the position value column, Dan Aug 24), ALWAYS
 *  prefilled with the SDC standard (1000/100 mm/s, tagged default), plus
 *  "+ add speed" for extra named speeds (speedProfiles). Pre-populated with
 *  the named positions inferred from the sequence; values stay empty
 *  unless the ME's words stated them. Empty position values are Build
 *  blockers; speeds never are — they're always filled. */
function ServoDraftCard({ device, idx, onPatch, headerProps, bandRows = [], onCommitBand }) {
  const positions = device.positions ?? [];
  const speeds = effSpeeds(device);
  const speedProfiles = device.speedProfiles ?? [];
  const [newName, setNewName] = useState('');
  const [newSpeedName, setNewSpeedName] = useState('');
  // ROTARY / DIAL card (Dan's Magnet Dial round, 2026-08-25): fixture-count
  // first, degrees not mm — never an "IndexIncrement — mm" row.
  const rotary = isRotarySheetAxis(device);
  const posUnit = rotary ? '°' : 'mm';
  const speedUnit = rotary ? '°/s' : 'mm/s';
  // CARD ROWS (Dan, Aug 24 round 2): named positions + corner blends ONLY,
  // each a single never-wrapping line. *WideBand rows no longer exist (round
  // 3: speed windows are dead — the corner blends are the only windows);
  // any legacy one in old data is simply not rendered. Rotary: Index rows are
  // owned by the Fixtures + derived-increment rows, never plain positions.
  const indexed = positions.map((p, i) => ({ p, i }));
  const visibleRows = orderServoDisplayRows(
    indexed.filter(({ p }) => !isSpeedWindowName(p?.name) && !(rotary && isIndexRowName(p?.name))),
    (r) => r.p?.name);
  const peerBandRows = bandRows.filter(r => !isSpeedWindowName(r.rowName));
  // Advanced rows never count toward "values needed" — they are defaults the
  // compile owns, not asks for the ME.
  const missing = visibleRows.filter(({ p }) => posValueMissing(p)).length + peerBandRows.length
    + (rotary && fixturesMissing(device) ? 1 : 0);
  // GEOMETRIC SANITY (Dan, Aug 24): arithmetic-impossible values flag RED on
  // the offending row with the plain sentence right under it.
  const geomKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const geomByRow = new Map(
    axisGeometryIssues(device.name, positions.map(p => ({ name: p?.name, value: p?.valueMm })))
      .map(g => [geomKey(g.rowName), g])
  );
  // NO role tags on servo rows (Dan, Aug 24: "we know what the points are,
  // we're the ones that told you") — proposed/needed STATE indicators only.

  function patchSpeed(key, v) {
    const next = { ...(device.speeds ?? {}) };
    if (v === undefined) delete next[key]; else next[key] = v;
    onPatch({ speeds: Object.keys(next).length ? next : undefined });
  }

  /** Additional named speeds (beyond Fast/Slow) — persist as speedProfiles
   *  [{name, mmS}]; an emptied value removes the profile. */
  function patchSpeedProfile(i, v) {
    const next = v === undefined
      ? speedProfiles.filter((_, j) => j !== i)
      : speedProfiles.map((x, j) => (j === i ? { ...x, mmS: v } : x));
    onPatch({ speedProfiles: next.length ? next : undefined });
  }
  function addSpeed() {
    const nm = newSpeedName.trim().replace(/\s+/g, '_');
    if (!nm) return;
    onPatch({ speedProfiles: [...speedProfiles, { name: nm }] });
    setNewSpeedName('');
  }

  function commitValue(i, v) {
    onPatch({
      positions: positions.map((p, j) => {
        if (j !== i) return p;
        const next = { ...p };
        if (v === null || v === undefined) delete next.valueMm; else next.valueMm = v;
        return next;
      }),
    });
  }
  function addNamed() {
    const nm = newName.trim().replace(/\s+/g, '_');
    if (!nm) return;
    onPatch({ positions: [...positions, { name: nm }] });
    setNewName('');
  }

  // No status chips on device cards (Dan, Aug 24: silence = fine). A missing
  // value is a real need — it lives in the blocking strip / Build-waiting
  // list, and the empty cell IS the question.
  const chips = missing > 0 ? (
    <span data-testid={`sheet-servo-missing-${idx}`} style={{
      fontSize: 10, fontWeight: 700, color: '#6b5513', whiteSpace: 'nowrap',
      background: '#fdf6e3', border: '1px solid #e6d9a8', borderRadius: 3, padding: '1px 8px',
    }}>{missing} value{missing === 1 ? '' : 's'} needed</span>
  ) : null;

  return (
    <SheetDeviceCard
      type="ServoAxis"
      name={device.name}
      purpose={device.purpose}
      chips={chips}
      testId={`sheet-servo-${idx}`}
      {...headerProps}
    >
      {positions.length === 0 && !rotary && (
        <div style={{ fontSize: 11.5, color: '#6b5513', marginBottom: 6 }}>
          No positions yet — list the named positions this axis moves to.
        </div>
      )}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {/* ROTARY DIAL rows come FIRST (fixture-count-first, Dan): Fixtures
              (nests) — red-needed until known — then the DERIVED index
              increment in degrees (360/N; typing over = override). */}
          {rotary && (() => {
            const inc = effIndexIncrement(device);
            const needFix = fixturesMissing(device);
            return (
              <Fragment>
                <tr data-testid={`sheet-servo-fixtures-row-${idx}`}>
                  <td style={{
                    padding: '2px 8px 2px 0', fontSize: 12, width: '42%', whiteSpace: 'nowrap',
                    color: needFix ? '#991b1b' : C.text, fontWeight: needFix ? 700 : 400,
                  }}>Fixtures (nests)</td>
                  <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
                    <ValueCell
                      value={needFix ? '' : device.fixtureCount}
                      testId={`sheet-servo-fixtures-${idx}`}
                      onCommit={v => onPatch({
                        fixtureCount: v == null ? undefined : Math.max(2, Math.round(v)),
                      })}
                      missingTone="required"
                    />
                  </td>
                  <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>
                    {needFix && (
                      <span data-testid={`sheet-servo-fixtures-needed-${idx}`} style={{
                        ...chipBase, color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5',
                      }}>needed</span>
                    )}
                  </td>
                </tr>
                <tr data-testid={`sheet-servo-increment-row-${idx}`}>
                  <td
                    title={inc.derived
                      ? 'Derived: 360° / fixtures. Type a value to override (non-uniform dials).'
                      : 'Your override — clear it to go back to the derived 360° / fixtures.'}
                    style={{ padding: '2px 8px 2px 0', fontSize: 12, width: '42%', whiteSpace: 'nowrap', color: C.text }}
                  >
                    Index increment
                    {inc.derived && inc.value !== null && (
                      <span style={{ fontSize: 10, color: C.light, marginLeft: 6 }}>
                        (= 360 / {device.fixtureCount})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
                    <ValueCell
                      key={`inc-${inc.value ?? ''}-${inc.derived}`}
                      value={inc.value ?? ''}
                      testId={`sheet-servo-increment-${idx}`}
                      onCommit={v => onPatch({ indexIncrementDeg: v == null ? undefined : v })}
                    />
                    <span style={{ fontSize: 11, color: C.light, marginLeft: 5 }}>°</span>
                  </td>
                  <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>
                    {!inc.derived && (
                      <span data-testid={`sheet-servo-increment-override-${idx}`} style={{
                        ...chipBase, color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8',
                      }}>override</span>
                    )}
                  </td>
                </tr>
                {/* DIRECTION (Dan, 2026-08-25: his dial drew backwards) —
                    CW/CCW select; the motion-path dial glyph honors it. */}
                <tr data-testid={`sheet-servo-direction-row-${idx}`}>
                  <td style={{ padding: '2px 8px 2px 0', fontSize: 12, width: '42%', whiteSpace: 'nowrap', color: C.text }}>
                    Direction
                    {!device.rotationDirection && <DefaultTag />}
                  </td>
                  <td colSpan={2} style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>
                    <select
                      data-testid={`sheet-servo-direction-${idx}`}
                      value={effDirection(device)}
                      onChange={e => onPatch({ rotationDirection: e.target.value })}
                      style={{
                        fontSize: 12.5, padding: '3px 6px', border: `1px solid ${C.border}`,
                        borderRadius: 6, background: '#fff', color: C.text,
                      }}
                    >
                      <option value="cw">CW (clockwise)</option>
                      <option value="ccw">CCW (counter-clockwise)</option>
                    </select>
                  </td>
                </tr>
              </Fragment>
            );
          })()}
          {/* HOME — the ME declares where this axis rests when the station is
              home. Defaults intelligently (a row named Home; vertical →
              Retract); the code's Home Conditions / init / recovery use the
              DECLARED home, never inference. */}
          {positions.length > 0 && (() => {
            const home = effHomePosition(device);
            // One line, SDC-blue accent (Dan, Aug 24) — symmetric with the
            // position rows, label never wraps.
            return (
              <tr data-testid={`sheet-servo-home-row-${idx}`} style={{ background: '#eef5fc' }}>
                {/* label WRAPS instead of pushing into the select's column —
                    no-overlap rule (Dan circled this one, 2026-08-25). */}
                <td style={{ padding: '3px 8px 3px 0', fontSize: 12, width: '42%', color: C.primary, fontWeight: 700 }}>
                  Home position{home.isDefault && <DefaultTag />}
                </td>
                <td colSpan={2} style={{ padding: '3px 0' }}>
                  <HomeSelect
                    value={home.value}
                    options={positions.filter(p => p?.name).map(p => ({ value: p.name }))}
                    onChange={v => onPatch({ homePosition: v })}
                    testId={`sheet-servo-home-${idx}`}
                  />
                </td>
              </tr>
            );
          })()}
          {(() => {
          // GROUPED ROWS (Dan, Aug 24 round 5): Positions, then Speed
          // transitions, then Blends — micro-headers only when the axis has
          // something to separate (X stays a plain two-row card).
          const GroupHead = ({ label }) => (
            <tr>
              <td colSpan={3} style={{ padding: '7px 0 1px', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.light }}>{label}</td>
            </tr>
          );
          const renderValueRow = ({ p, i }) => {
            // Truly-needed empty value = RED + BOLD (Dan, Aug 24) — a genuine
            // gap the model must fill, unmistakably distinct from role tags
            // and from amber proposed rows.
            const needed = posValueMissing(p);
            const geo = geomByRow.get(geomKey(p.name));
            return (
              <Fragment key={`${p.name}-${i}`}>
              <tr>
                <td
                  title={geo ? geo.message : (p.name !== plainServoRowLabel(p.name) ? p.name : undefined)}
                  style={{
                    padding: '2px 8px 2px 0', fontSize: 12, width: '42%', whiteSpace: 'nowrap',
                    color: (needed || geo) ? '#991b1b' : C.text, fontWeight: (needed || geo) ? 700 : 400,
                  }}>{plainServoRowLabel(p.name)}</td>
                {/* value + unit ALWAYS inline — never wrapping to its own line */}
                <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
                  <ValueCell
                    value={needed ? '' : p.valueMm}
                    testId={`sheet-servo-value-${idx}-${p.name}`}
                    onCommit={v => commitValue(i, v)}
                    missingTone="required"
                  />
                  <span style={{ fontSize: 11, color: C.light, marginLeft: 5 }}>{posUnit}</span>
                </td>
                <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>
                  {needed && (
                    <span data-testid={`sheet-servo-needed-${idx}-${p.name}`} style={{
                      ...chipBase, color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5',
                    }}>needed</span>
                  )}
                  {!needed && geo && (
                    <span data-testid={`sheet-servo-geom-${idx}-${p.name}`} title={geo.message} style={{
                      ...chipBase, color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5',
                    }}>impossible</span>
                  )}
                </td>
              </tr>
              {geo && (
                <tr data-testid={`sheet-servo-geom-msg-${idx}-${p.name}`}>
                  <td colSpan={3} style={{ padding: '0 0 4px', fontSize: 11.5, color: '#991b1b', fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.45 }}>
                    ⚠ {geo.message}
                  </td>
                </tr>
              )}
              </Fragment>
            );
          };
          // Derived servo points the code USES that have no value yet —
          // blend anchors as VISIBLE proposed rows (NO INVISIBLE POSITIONS —
          // meKnowledge 2026-08-23). Committing a value makes it a real
          // named position on the axis.
          const renderBandRow = (r) => {
            // PROPOSED rows are amber with an explicit "✓ agree" checkbox
            // (Dan, Aug 24): checking commits Jarvis's proposed value through
            // the same persistence path as typing it — the tag then clears
            // because the row becomes a real named position. A band row with
            // NO proposal is a genuine need — red, like the empty cells.
            const hasProposal = r.proposedValue != null;
            return (
              <tr key={`band-${r.rowName}`} data-testid={`sheet-servo-band-${idx}-${r.rowName}`}>
                <td
                  title={r.rationale ?? r.flag}
                  style={{
                    padding: '2px 8px 2px 0', fontSize: 12, width: '42%', whiteSpace: 'nowrap',
                    color: hasProposal ? '#6b5513' : '#991b1b',
                    fontWeight: hasProposal ? 400 : 700,
                  }}
                >{bandRowLabel(r)}</td>
                <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
                  <ValueCell
                    value={r.proposedValue ?? ''}
                    testId={`sheet-servo-band-value-${idx}-${r.rowName}`}
                    onCommit={v => onCommitBand?.(r, v)}
                    missingTone={hasProposal ? 'amber' : 'required'}
                  />
                  <span style={{ fontSize: 11, color: C.light, marginLeft: 5 }}>{posUnit}</span>
                </td>
                <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>
                  {hasProposal ? (
                    <label
                      title={r.rationale ?? 'Check to go with the proposed value'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                        ...chipBase, color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8',
                        padding: '2px 8px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        data-testid={`sheet-servo-band-agree-${idx}-${r.rowName}`}
                        onChange={() => onCommitBand?.(r, r.proposedValue)}
                        style={{ margin: 0 }}
                      />
                      ✓ agree {r.proposedValue}
                    </label>
                  ) : (
                    <span style={{ ...chipBase, color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5' }}>needed</span>
                  )}
                </td>
              </tr>
            );
          };
          const groups = groupServoRows(visibleRows, (r) => r.p?.name);
          const hasBlendGroup = groups.some(g => g.key === 'blends');
          return (
            <Fragment>
              {groups.map(g => (
                <Fragment key={g.key}>
                  {g.label && <GroupHead label={g.label} />}
                  {g.rows.map(renderValueRow)}
                  {g.key === 'blends' && peerBandRows.map(renderBandRow)}
                </Fragment>
              ))}
              {!hasBlendGroup && peerBandRows.length > 0 && (
                <Fragment>
                  <GroupHead label="Blends" />
                  {peerBandRows.map(renderBandRow)}
                </Fragment>
              )}
            </Fragment>
          );
          })()}
          {/* SPEED WINDOWS ARE DEAD (Dan, Aug 24 round 3: "the blend
              start/end IS the window — I don't understand this advanced
              section"). No advanced expander: transitions take strict
              MAM.PC + InPos; the only windows are the two corner blends. */}
          <tr>
            <td style={{ padding: '5px 10px 2px 0' }}>
              <input
                data-testid={`sheet-servo-add-${idx}`}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="+ add named value"
                onKeyDown={e => { if (e.key === 'Enter') addNamed(); }}
                onBlur={() => { if (newName.trim()) addNamed(); }}
                style={{
                  width: '100%', boxSizing: 'border-box', fontSize: 11.5, padding: '4px 8px',
                  border: `1px dashed ${C.border}`, borderRadius: 6, background: 'transparent', color: C.text,
                }}
              />
            </td>
            <td colSpan={2} />
          </tr>
          {/* SPEEDS as ROWS in the SAME table (Dan, Aug 24: value boxes
              aligned in the position value column — never a cramped strip).
              SDC standard, always prefilled, operator-adjustable in the HMI. */}
          <tr>
            <td colSpan={3} style={{ paddingTop: 6 }}>
              <div
                title="SDC standard — operator-adjustable in the HMI"
                style={{
                  fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
                  letterSpacing: '0.04em', borderTop: `1px dashed ${C.border}`, paddingTop: 5,
                }}
              >Speeds</div>
            </td>
          </tr>
          <tr data-testid={`sheet-servo-speed-row-fast-${idx}`}>
            <td style={{ padding: '2px 8px 2px 0', fontSize: 12, width: '42%', color: C.text }}>
              Fast{speeds.fastIsDefault && <DefaultTag />}
            </td>
            <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
              <NumField
                value={speeds.fastMmS}
                unit={speedUnit}
                width={90}
                testId={`sheet-servo-fast-${idx}`}
                onCommit={v => patchSpeed('fastMmS', v)}
              />
            </td>
            <td style={{ padding: '2px 0' }} />
          </tr>
          <tr data-testid={`sheet-servo-speed-row-slow-${idx}`}>
            <td style={{ padding: '2px 8px 2px 0', fontSize: 12, width: '42%', color: C.text }}>
              Slow{speeds.slowIsDefault && <DefaultTag />}
            </td>
            <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
              <NumField
                value={speeds.slowMmS}
                unit={speedUnit}
                width={90}
                testId={`sheet-servo-slow-${idx}`}
                onCommit={v => patchSpeed('slowMmS', v)}
              />
            </td>
            <td style={{ padding: '2px 0' }} />
          </tr>
          {speedProfiles.map((sp, i) => (
            <tr key={`speed-${sp.name}-${i}`} data-testid={`sheet-servo-speed-row-${idx}-${sp.name}`}>
              <td style={{ padding: '2px 8px 2px 0', fontSize: 12, width: '42%', color: C.text }}>{sp.name}</td>
              <td style={{ padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
                <NumField
                  value={sp.mmS}
                  unit={speedUnit}
                  width={90}
                  testId={`sheet-servo-speed-${idx}-${sp.name}`}
                  onCommit={v => patchSpeedProfile(i, v)}
                />
              </td>
              <td style={{ padding: '2px 0' }} />
            </tr>
          ))}
          <tr>
            <td style={{ padding: '3px 10px 2px 0' }}>
              <input
                data-testid={`sheet-servo-add-speed-${idx}`}
                value={newSpeedName}
                onChange={e => setNewSpeedName(e.target.value)}
                placeholder="+ add speed"
                onKeyDown={e => { if (e.key === 'Enter') addSpeed(); }}
                onBlur={() => { if (newSpeedName.trim()) addSpeed(); }}
                style={{
                  width: '100%', boxSizing: 'border-box', fontSize: 11.5, padding: '4px 8px',
                  border: `1px dashed ${C.border}`, borderRadius: 6, background: 'transparent', color: C.text,
                }}
              />
            </td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </SheetDeviceCard>
  );
}

/** PNEUMATIC setup for one draft device — the old AddDeviceModal interaction:
 *  per-direction SENSOR CHECKBOXES (both unchecked = no sensors / timer only),
 *  optional stroke, per-verb delay timers (dimmed when that direction has a
 *  sensor, exactly like the old modal). Verb names come from deviceTypes.js —
 *  gripper = Engage/Disengage, cylinder = Extend/Retract — never hand-written.
 *  Speech-stated values arrive filled from the extraction; everything else
 *  shows the SDC default, tagged, and stays editable. */
function PneumaticDraftCard({ device, idx, onPatch, headerProps }) {
  const type = sheetType(device);
  const isGrip = type === 'PneumaticGripper';
  const [verbA, verbB] = sheetVerbs(type);          // [Extend|Engage, Retract|Disengage]
  const arrangement = effSensorArrangement(device);
  const arrangementIsDefault = device.sensorArrangement == null;
  const home = effHomeState(device);
  const checks = parseSensorChecks(type, arrangement);
  const delays = effDelays(device);

  function toggleSensor(key, on) {
    const next = { ...checks, [key]: on };
    onPatch({ sensorArrangement: checksToArrangement(type, next.a, next.b) });
  }
  function patchDelay(key, v) {
    const next = { ...(device.delays ?? {}) };
    if (v === undefined) delete next[key]; else next[key] = Math.round(v);
    onPatch({ delays: Object.keys(next).length ? next : undefined });
  }

  // Old-modal ordering: home direction first for cylinders (Retract), engage
  // first for grippers. Each row: [checkbox key, verb, testid suffix].
  const sensorRows = isGrip
    ? [['a', verbA, 'a'], ['b', verbB, 'b']]
    : [['b', verbB, 'b'], ['a', verbA, 'a']];

  const DelayField = ({ verb, delayKey, hasSensor, testId }) => (
    <div style={hasSensor ? { opacity: 0.4 } : undefined}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginBottom: 3 }}>
        {verb} delay{!hasSensor && delays[`${delayKey}IsDefault`] && <DefaultTag />}
      </div>
      <NumField
        value={delays[delayKey]}
        unit="ms"
        testId={testId}
        disabled={hasSensor}
        title={hasSensor ? `Not needed — the ${verb.toLowerCase()} sensor handles verification` : undefined}
        onCommit={v => patchDelay(delayKey, v)}
      />
    </div>
  );

  return (
    <SheetDeviceCard
      type={type}
      name={device.name}
      purpose={device.purpose}
      testId={`sheet-pneumatic-${idx}`}
      {...headerProps}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'flex-end' }}>
        {/* HOME STATE — where this device rests when the station is home
            (SDC default: cylinder Retracted, gripper Disengaged/open).
            One inline row, SDC-blue accent (Dan, Aug 24). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: '#eef5fc', padding: '3px 6px', borderRadius: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.primary, whiteSpace: 'nowrap' }}>
            Home state{home.isDefault && <DefaultTag />}
          </span>
          <HomeSelect
            value={home.value}
            options={home.options}
            onChange={v => onPatch({ homeState: v })}
            testId={`sheet-pneumatic-home-${idx}`}
          />
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginBottom: 3 }}>
            Sensors{arrangementIsDefault && <DefaultTag />}
          </div>
          <div className="sensor-checkbox-group" data-testid={`sheet-pneumatic-sensors-${idx}`} data-arrangement={arrangement}>
            {sensorRows.map(([key, verb, suffix]) => (
              <label key={key} className="form-checkbox-row" style={{ fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  data-testid={`sheet-pneumatic-sensor-${suffix}-${idx}`}
                  checked={checks[key]}
                  onChange={e => toggleSensor(key, e.target.checked)}
                />
                <span>{isGrip ? `${verb}d` : verb} sensor</span>
              </label>
            ))}
          </div>
        </div>
        {!isGrip && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginBottom: 3 }}>Stroke (optional)</div>
            <NumField
              value={device.strokeMm}
              unit="mm"
              testId={`sheet-pneumatic-stroke-${idx}`}
              onCommit={v => onPatch({ strokeMm: v })}
            />
          </div>
        )}
        <DelayField verb={verbA} delayKey="extendMs" hasSensor={checks.a} testId={`sheet-pneumatic-extend-${idx}`} />
        <DelayField verb={verbB} delayKey="retractMs" hasSensor={checks.b} testId={`sheet-pneumatic-retract-${idx}`} />
      </div>
    </SheetDeviceCard>
  );
}

/** INPUTS & OUTPUTS — DERIVED, demoted (Dan, Aug 23): a collapsed secondary
 *  strip at the BOTTOM of the sheet. Generated from the device tables via the
 *  central tagNaming — there is nothing here for the ME to fill out. */
function IoDerivedCard({ devices, ioNotes, reviewBar, topPanel, collapsed = null, onToggleCollapse = null }) {
  // Starts OPEN (Dan, Aug 24): collapsible for tidiness, but visible by
  // default so nobody misses that it exists. When the sheet-wide collapse
  // state drives it (Dan, 2026-08-30: collapsible everything, per-draft),
  // the controlled props win over the local toggle.
  const [openLocal, setOpenLocal] = useState(true);
  const open = collapsed == null ? openLocal : !collapsed;
  const setOpen = (fn) => (onToggleCollapse ? onToggleCollapse() : setOpenLocal(fn));
  const { inputs, outputs } = deriveIoLists(devices);
  if (!inputs.length && !outputs.length) return null;
  const List = ({ title, rows, testId }) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
        {title} ({rows.length})
      </div>
      {rows.map((r, i) => (
        <div key={i} data-testid={`${testId}-${i}`} style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ fontFamily: 'Consolas, monospace', color: C.text }}>{r.tag}</span>
          <span style={{ color: C.light }}> — {r.device}</span>
        </div>
      ))}
      {rows.length === 0 && <div style={{ fontSize: 11, color: C.light, fontStyle: 'italic' }}>none</div>}
    </div>
  );
  return (
    <div
      data-testid="summary-section-io"
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
        marginTop: 12, marginBottom: 10, overflow: 'hidden',
      }}
    >
      {/* Proper section header (slate — derived, quieter than the main trio) */}
      <div
        data-testid="io-derived-toggle"
        onClick={() => setOpen(v => !v)}
        title={open ? 'Collapse' : 'Show the derived tag lists'}
        style={{
          display: 'flex', alignItems: 'baseline', gap: 10, cursor: 'pointer',
          background: '#475569', padding: '5px 14px',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {open ? '▾' : '▸'} Inputs &amp; Outputs ({inputs.length + outputs.length})
        </span>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)' }}>
          derived from the devices
        </span>
        <span style={{ flex: 1 }} />
        {reviewBar && <span onClick={e => e.stopPropagation()}>{reviewBar}</span>}
      </div>
      {open && (
        <div style={{ padding: '8px 14px 10px' }}>
          {topPanel}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <List title="Inputs" rows={inputs} testId="io-input" />
            <List title="Outputs" rows={outputs} testId="io-output" />
          </div>
          {String(ioNotes || '').trim() && (
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 6 }}>{String(ioNotes).trim()}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** REFERENCE MATERIAL (Dan, Aug 24) — ONE references area at the TOP of the
 *  sheet: drop ANYTHING (pictures, .L5X code, PDFs/docs — "whatever you
 *  want") plus the past-job reference LINE — free talk/type text ("this
 *  station on this specific job, and what we're actually referencing"),
 *  persisted on machineSpec.referenceJobs as {text}. Items render as
 *  compact chips/thumbnails with the live sync badge and an ✕. Everything
 *  persists in the same server-side store as pictures; images feed the
 *  extraction, and dropped code/doc files ALSO register into the training
 *  intake (POST /api/jarvis/examples) — a dropped L5X is reference code
 *  handed over to study, not just a stored file. (The compiled "Standards
 *  used" citations are an OUTPUT — they render at the bottom of the STATION
 *  band via StandardsUsedLine, not here.) */
function ReferenceMaterialSection({ items, onItemsChange, syncStates, sm, referenceText, onReferenceTextChange, referenceSavedTick }) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // BOM AS A REFERENCE INPUT (Dan, 2026-08-26 — Jason's step 3, the device &
  // I/O list): a bill of materials is an explicit intake. Detected by
  // extension/name; it SEEDS the device proposals at the next Build. Full
  // spreadsheet parsing is the ingest pipeline's job — the file is registered
  // with a bom topic so that pipeline can pick it up (stubbed until then).
  const isBomFile = (name) =>
    /\.(xlsx?|csv)$/i.test(String(name ?? ''))
    || /\b(bom|bill.?of.?materials?)\b/i.test(String(name ?? ''));

  async function addFiles(fileList) {
    const files = [...(fileList ?? [])].filter(Boolean).slice(0, 20);
    const out = [];
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) {
        alert(`${f.name} is over the 25MB per-file cap`);
        continue;
      }
      try {
        if (f.type && f.type.startsWith('image/')) {
          out.push(await downscaleImage(f));
        } else {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          const base64 = btoa(bin);
          out.push({ name: f.name, mediaType: f.type || 'application/octet-stream', base64 });
          // Dropped code/docs are reference material to STUDY — register into
          // the training/example intake (best effort; the file persists with
          // the sheet either way).
          fetch('/api/jarvis/examples', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: f.name, base64,
              topic: isBomFile(f.name) ? 'sheet-bom-device-list' : 'sheet-reference-material',
              sm: sm?.displayName ?? sm?.name ?? null,
            }),
          }).catch(() => { /* intake offline — the sheet still holds the file */ });
        }
      } catch (e) { alert(e.message); }
    }
    if (out.length) onItemsChange(prev => [...prev, ...out]);
  }

  // Page-wide Ctrl+V paste of screenshots (the sheet's ONE paste surface).
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    function onPaste(e) {
      const its = [...(e.clipboardData?.items || [])]
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'));
      if (!its.length) return;
      e.preventDefault();
      addFilesRef.current(its.map(it => it.getAsFile()).filter(Boolean)
        .map((f, i) => (f.name ? f : new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }))));
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const extLabel = (it) => {
    const m = String(it.name || '').match(/\.([a-z0-9]{1,5})$/i);
    return (m ? m[1] : 'file').toUpperCase();
  };
  const badgeFor = (it) => {
    const sync = syncStates && it._hash ? syncStates[it._hash] : null;
    if (sync === 'saved') return { text: '✓', fg: '#2f6b3c', title: 'Saved on the server with the station' };
    if (sync === 'error') return { text: '!', fg: '#8a3b3b', title: 'Not saved yet — retrying automatically' };
    if (sync === 'saving') return { text: '⟳', fg: '#6b5513', title: 'Saving…' };
    return null;
  };

  return (
    <div
      data-testid="summary-section-references"
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
        marginBottom: 12, overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        background: '#64748b', padding: '5px 14px',
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Reference material
        </span>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.78)' }}>
          drop anything — pictures, code, specs, a bill of materials (xlsx/csv/pdf) — it's studied for this build
        </span>
      </div>
      <div
        data-testid="reference-drop"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        style={{
          padding: '8px 14px 10px',
          background: dragOver ? C.primaryBg : '#fff',
          transition: 'background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {items.map((it, i) => {
            const isImg = String(it.mediaType || '').startsWith('image/');
            const badge = badgeFor(it);
            return (
              <div key={it._hash ?? i} style={{ position: 'relative' }}>
                {isImg ? (
                  <img
                    src={it.previewUrl ?? `data:${it.mediaType};base64,${it.base64}`}
                    alt={it.name} title={it.name}
                    style={{ width: 148, height: 106, objectFit: 'cover', borderRadius: 5, border: `1px solid ${C.border}`, display: 'block' }}
                  />
                ) : (
                  <span
                    data-testid={`reference-file-${i}`}
                    title={it.name}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 210,
                      border: `1px solid ${C.border}`, borderRadius: 5, padding: '5px 22px 5px 8px',
                      fontSize: 11.5, color: C.text, background: 'var(--color-sidebar)',
                    }}
                  >
                    <span style={{
                      ...chipBase, color: '#fff', background: '#64748b', border: 'none',
                      fontSize: 9, padding: '1px 5px',
                    }}>{extLabel(it)}</span>
                    {isBomFile(it.name) && (
                      <span
                        data-testid={`reference-bom-chip-${i}`}
                        title="Bill of materials — seeds the device & I/O proposals at the next Build (full spreadsheet parsing lands with the ingest pipeline)"
                        style={{ ...chipBase, color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8', fontSize: 9, padding: '1px 5px' }}
                      >BOM</span>
                    )}
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                  </span>
                )}
                {badge && (
                  <span title={badge.title} style={{
                    position: 'absolute', left: 3, bottom: 3, fontSize: 9, fontWeight: 800,
                    lineHeight: 1, padding: '1px 4px', borderRadius: 3,
                    background: 'rgba(255,255,255,0.92)', color: badge.fg, border: `1px solid ${C.border}`,
                  }}>{badge.text}</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${it.name}`}
                  title="Remove"
                  onClick={() => onItemsChange(prev => prev.filter((x, j) => (x._hash ?? j) !== (it._hash ?? i)))}
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 16, height: 16,
                    borderRadius: '50%', border: 'none', background: '#334155', color: '#fff',
                    fontSize: 10, lineHeight: 1, cursor: 'pointer', padding: 0,
                  }}
                >×</button>
              </div>
            );
          })}
        </div>
        {/* Drop zone + the past-job reference line — TOGETHER, on the LEFT
            (Dan, Aug 24). The reference is FREE TEXT, talk or type: which
            station, on which job, and what about it — never just a name. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginTop: items.length ? 8 : 0 }}>
          <button
            type="button"
            data-testid="reference-browse"
            onClick={() => fileInputRef.current?.click()}
            title="Drop files anywhere on this box, paste (Ctrl+V) a screenshot, or click to browse"
            style={{
              border: `1.5px dashed ${dragOver ? C.primary : '#cbd5e1'}`, borderRadius: 5,
              background: 'transparent', color: C.muted, fontSize: 11.5,
              padding: '6px 12px', cursor: 'pointer', flexShrink: 0,
            }}
          >＋ drop / paste / browse</button>
          <input
            ref={fileInputRef} type="file" multiple
            style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <DictatedTextarea
            value={referenceText ?? ''}
            onChange={onReferenceTextChange}
            rows={1}
            data-testid="reference-job-input"
            micTestId="reference-job-mic"
            placeholder="Referencing a past job? which station, which job, and what about it"
            style={{
              // Readable measure — prose inputs never run the full monitor
              // width (Dan, Aug 24).
              flex: 1, minWidth: 260, maxWidth: 900, boxSizing: 'border-box', fontSize: 11.5,
              paddingTop: 6, paddingBottom: 6, paddingLeft: 8,
              border: `1px dashed ${C.border}`, borderRadius: 5, resize: 'none',
              lineHeight: 1.45, fontFamily: 'inherit', color: C.text, background: 'transparent',
            }}
          />
          <SaveTick state={referenceSavedTick} testId="reference-savetick" />
        </div>
      </div>
    </div>
  );
}

/** THE SM DECOMPOSITION AS AN APPROVAL ARTIFACT (Dan, 2026-08-25):
 *  the ME's expected pills on one side, Jarvis's PROPOSED machines (name +
 *  oneLiner + owned devices) on the other, an agree/counter one-liner when
 *  they differ, and Approve. Approved (machineSpec.smSplitApproval) → the
 *  split is THE authority (grouping, diagrams, per-program codegen). Inline
 *  rename clears approval (Jarvis tweaks → re-approve); move/merge/split goes
 *  through the corrections chat. Expectation with no proposal yet → one line
 *  saying the proposal comes at the next Build/compile (the loop is always
 *  visible — Dan hit a sheet where his expectation changed nothing). */
// ONE TRUTH (Dan's three-truths screenshot, 2026-08-25): the panel shows ONE
// versioned decomposition at a time — cards, prose and count from the SAME
// source. `versionLabel` + `awaitingApproval` describe a newer compiled
// proposal; `approvedStamp` appears ONLY when the DISPLAYED decomposition is
// the approved one; `inconsistent` renders the error state instead of ever
// mixing contradicting truths.
function SmDecompositionSection({ decomp, approval, expectedPills, expectationRaw, expectedCount, reasoning, onApprove, onRename, onEditViaChat, onCounter, busy, versionLabel, awaitingApproval, approvedStamp, supersededNote, inconsistent, onRepropose, chatMode = false }) {
  const [renaming, setRenaming] = useState(null); // entry key being renamed
  const [counter, setCounter] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const hasExpectation = (expectedPills?.length ?? 0) > 0 || !!expectationRaw;
  if (!decomp?.length && !hasExpectation) return null;
  const approved = approvedStamp === true && approval?.approved === true;

  // HARD RENDER GUARD: a proposal whose reasoning and machine list disagree
  // NEVER renders as truth — the mismatch is an error state and a re-propose.
  if (inconsistent && decomp?.length) {
    return (
      <div data-testid="sheet-state-machines" style={{
        marginTop: 10, border: '1px solid #fca5a5', borderRadius: 8,
        background: '#fef2f2', padding: '10px 14px', maxWidth: 900,
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#991b1b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
          State machines
        </div>
        <div data-testid="sm-split-inconsistent" style={{ fontSize: 12, color: '#991b1b', fontWeight: 600, lineHeight: 1.5 }}>
          Jarvis's proposal is inconsistent — his reasoning says {inconsistent.claimed} machines
          but the proposal carries {inconsistent.actual}. Not rendering the contradiction — re-proposing.
        </div>
        <button
          type="button"
          data-testid="sm-split-repropose-btn"
          onClick={onRepropose}
          disabled={busy}
          style={{
            marginTop: 6, background: 'var(--color-primary)', color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 12, fontWeight: 700, padding: '5px 16px', cursor: 'pointer',
          }}
        >{busy ? 'Working…' : 'Re-propose now'}</button>
      </div>
    );
  }

  if (!decomp?.length) {
    return (
      <div data-testid="sheet-state-machines" style={{ marginTop: 10 }}>
        <div style={{
          fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.06em',
          textTransform: 'uppercase', marginBottom: 3,
        }}>State machines</div>
        {(expectedPills?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: C.muted }}>you expect:</span>
            {expectedPills.map((p, i) => <SmPill key={i} label={p.name} note={p.note} />)}
          </div>
        )}
        <div data-testid="sheet-state-machines-pending" style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>
          Jarvis proposes the state machines at the next Build / compile — your expectation rides along.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="sheet-state-machines" style={{
      marginTop: 10, border: `1px solid ${approved ? '#bfe0c8' : C.primaryBorder}`,
      borderRadius: 8, background: '#fff', padding: '8px 12px 10px', maxWidth: 900,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          State machines ({decomp.length})
        </span>
        {/* ONE stamp, matching the ONE displayed source — never mixed. */}
        {approved ? (
          <span data-testid="sm-split-approved-chip" style={{ ...chipBase, color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #bfe0c8' }}>
            ✓ approved{approval.by ? ` by ${approval.by}` : ''}{approval.at ? ` · ${new Date(approval.at).toLocaleDateString()}` : ''}
          </span>
        ) : (
          <span data-testid="sm-split-proposed-chip" style={{ ...chipBase, color: '#1d4ed8', background: '#e8f0fa', border: '1px solid #a8c8e8' }}>
            {versionLabel ? `${versionLabel} — ${decomp.length} state machines` : 'proposed'}{awaitingApproval ? ' — awaiting approval' : ''}
          </span>
        )}
        {supersededNote && (
          <span data-testid="sm-split-superseded-note" style={{ fontSize: 10.5, color: C.light }}>
            {supersededNote}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!approved && (
          <button
            type="button"
            data-testid="sm-split-approve-btn"
            onClick={onApprove}
            style={{
              background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
              fontSize: 12, fontWeight: 700, padding: '4px 16px', cursor: 'pointer',
            }}
          >Approve</button>
        )}
      </div>
      {/* YOUR COUNT vs JARVIS'S — Dan expected ~4 machines and got 2; the
          disagreement is stated plainly so he can argue with it. */}
      {(expectedPills?.length ?? 0) > 0 && (
        <div data-testid="sm-split-expected-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: C.muted }}>you expect:</span>
          {expectedPills.map((p, i) => <SmPill key={i} label={p.name} note={p.note} />)}
        </div>
      )}
      {(expectedCount ?? 0) > 0 && expectedCount !== decomp.length && (
        <div data-testid="sm-split-counter-note" style={{ fontSize: 11, color: '#6b5513', marginBottom: 5 }}>
          You expected {expectedCount} state machines — Jarvis proposes {decomp.length}
          {reasoning ? '.' : ' (per-machine reasoning below).'}
        </div>
      )}
      {!!expectationRaw && (
        <div style={{ marginBottom: 5 }}>
          <button
            type="button"
            data-testid="sm-split-raw-toggle"
            onClick={() => setShowRaw(v => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.light }}
          >{showRaw ? '▾ what you said' : '▸ what you said'}</button>
          {showRaw && (
            <div data-testid="sm-split-raw" style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 3, maxWidth: 760 }}>
              {expectationRaw}
            </div>
          )}
        </div>
      )}
      {reasoning && (
        <div data-testid="sm-split-reasoning" style={{ fontSize: 11, color: '#6b5513', marginBottom: 5, lineHeight: 1.45 }}>
          {reasoning}
        </div>
      )}
      {/* RADICAL CARD BREVITY (Dan's format verbatim, 2026-08-26): a card is
          the NAME (click it to rename — ✎ says so) + ONE line of devices.
          Nothing else — the why/reasoning lives in the ONE shared sentence
          above; a tiny muted step count rides the header for free. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 14px', alignItems: 'start' }}>
        {decomp.map((e) => (
          <div key={e.key} data-testid={`sm-split-card-${e.key}`} style={{
            border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', minWidth: 0,
          }}>
            {renaming === e.key ? (
              <LineInput
                initial={e.name}
                testId={`sm-split-rename-${e.key}`}
                onDone={v => {
                  setRenaming(null);
                  const t = String(v ?? '').trim();
                  if (v !== null && t && t !== e.name) onRename?.(e, t);
                }}
              />
            ) : (
              <div
                title="Click the name to rename it — renaming re-opens approval"
                onClick={() => setRenaming(e.key)}
                onMouseEnter={ev => { ev.currentTarget.style.background = '#f2f6fb'; }}
                onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}
                style={{
                  fontSize: 12.5, fontWeight: 700, color: C.text, cursor: 'text',
                  display: 'flex', alignItems: 'baseline', gap: 6,
                  borderRadius: 4, margin: '0 -4px', padding: '0 4px',
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{e.name}</span>
                <span aria-hidden style={{ fontSize: 10, color: C.light, flexShrink: 0 }}>✎</span>
                {(e.sequence?.length ?? 0) > 0 && (
                  <span
                    data-testid={`sm-split-seq-${e.key}`}
                    title={e.sequence.join('\n')}
                    style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 400, color: C.light, whiteSpace: 'nowrap', flexShrink: 0 }}
                  >{e.sequence.length} steps</span>
                )}
              </div>
            )}
            {(e.deviceNames?.length ?? 0) > 0 && (
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 2, overflowWrap: 'anywhere' }}>
                {e.deviceNames.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ARGUE WITH IT — Approve, or say what you want instead. In chat mode
          (the cascade's ONE conversation channel, Dan 2026-08-26) the counter
          box is gone: talking happens in the chat above and applies to this
          proposal by default. */}
      {chatMode ? (
        <div data-testid="sm-split-chat-note" style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
          Not how you'd split it? Say it in the chat above — it applies to this proposal and Jarvis re-proposes.
        </div>
      ) : (
      <div style={{ marginTop: 8, maxWidth: 760 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>
          Not how you'd split it? Tell Jarvis what you want instead — he re-proposes.
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <DictatedTextarea
            value={counter}
            onChange={setCounter}
            rows={2}
            disabled={busy}
            data-testid="sm-split-counter-input"
            micTestId="sm-split-counter-mic"
            placeholder="e.g. no — I want the dial indexer separate; shuttle and pick split"
            className="form-input"
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', fontSize: 12.5, resize: 'vertical', lineHeight: 1.5, padding: '7px 10px' }}
          />
          <button
            type="button"
            data-testid="sm-split-counter-send"
            disabled={busy || !counter.trim()}
            onClick={async () => {
              const t = counter.trim();
              if (!t) return;
              // NEVER eat the text (Dan's vanished-on-Send bug, 2026-08-25):
              // the box keeps his words until a receipt confirms the round
              // landed; a failure leaves them right there with the error line.
              const ok = await onCounter?.(t);
              if (ok !== false) setCounter('');
            }}
            style={{
              background: (busy || !counter.trim()) ? '#c6d4e4' : 'var(--color-primary)',
              color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
              padding: '8px 14px', cursor: (busy || !counter.trim()) ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >{busy ? 'Working…' : 'Send to Jarvis'}</button>
        </div>
      </div>
      )}
      <div style={{ fontSize: 10.5, color: C.light, marginTop: 5 }}>
        Rename inline —{' '}
        <button
          type="button"
          data-testid="sm-split-edit-chat"
          onClick={onEditViaChat}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.primary, textDecoration: 'underline' }}
        >move, merge, or split by describing it in the chat</button>
        {approved ? ' · any change re-opens approval.' : '.'}
      </div>
    </div>
  );
}

/** "Standards used (N)" — an OUTPUT ("that's what you USED"), not reference
 *  material (Dan, Aug 24). Lives at the BOTTOM of the STATION band with the
 *  derived IO strip, same quiet derived styling. Collapsed by default;
 *  expands to short bullets — never scrolls, never truncates. */
function StandardsUsedLine({ sm }) {
  // Starts OPEN (Dan, Aug 24) — collapsible, but discoverable by default.
  const [open, setOpen] = useState(true);
  const cited = [...new Set(
    (sm?.compiledSequence?.ir?.templateConformance ?? [])
      .map(c => String(c?.citation ?? '').trim()).filter(Boolean)
  )];
  if (!cited.length) return null;
  return (
    <div data-testid="reference-cited" style={{ marginTop: 8, marginBottom: 10 }}>
      <button
        type="button"
        data-testid="reference-cited-toggle"
        onClick={() => setOpen(v => !v)}
        title={open ? 'Collapse' : 'Show the standards this build worked from'}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 11, fontWeight: 700, color: C.muted,
        }}
      >
        {open ? '▾' : '▸'} Standards used ({cited.length})
      </button>
      {open && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
          {cited.map((c, i) => <li key={i} data-testid={`reference-cited-${i}`}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── REVIEW & EDIT mode (Dan's flow, 2026-08-25: Build → review each section →
//    scoped edit → PROPOSED diff → approve → move on → approve the whole) ────

/** Compact per-section review cluster: quiet ✓ when reviewed; "Edit" opens the
 *  scoped edit surface; "✓ mark reviewed" approves the section as-is. */
function SectionReviewControls({ sectionKey, reviewed, editOpen, onEdit, onMarkReviewed, onDark = false, stampLabel = '✓ reviewed', queued = false }) {
  const base = { fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: '1px 9px', cursor: 'pointer' };
  return (
    <span data-testid={`section-review-${sectionKey}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {reviewed && (
        <span
          data-testid={`section-reviewed-${sectionKey}`}
          title="Approved — any edit re-opens it"
          style={{ fontSize: 10.5, fontWeight: 800, color: onDark ? '#c9ecd2' : '#2f6b3c', whiteSpace: 'nowrap' }}
        >{stampLabel}</span>
      )}
      {!reviewed && queued && (
        <span
          data-testid={`section-queued-${sectionKey}`}
          title="In the cascade queue — it comes up after the steps before it"
          style={{ fontSize: 10.5, fontWeight: 700, color: onDark ? 'rgba(255,255,255,0.75)' : C.light, whiteSpace: 'nowrap' }}
        >up next</span>
      )}
      <button
        type="button"
        data-testid={`section-edit-btn-${sectionKey}`}
        onClick={onEdit}
        title="Review this section — say what should change and why; Jarvis proposes, you approve"
        style={{
          ...base,
          color: onDark ? '#fff' : C.primary,
          background: editOpen ? (onDark ? 'rgba(255,255,255,0.22)' : C.primaryBg) : 'transparent',
          border: `1px solid ${onDark ? 'rgba(255,255,255,0.45)' : C.primaryBorder}`,
        }}
      >{editOpen ? 'Close' : 'Edit'}</button>
      {!reviewed && !!onMarkReviewed && (
        <button
          type="button"
          data-testid={`section-mark-reviewed-${sectionKey}`}
          onClick={onMarkReviewed}
          title="This section is right as it stands — mark it reviewed and move on"
          style={{
            ...base,
            color: onDark ? '#fff' : '#2f6b3c',
            background: 'transparent',
            border: `1px solid ${onDark ? 'rgba(255,255,255,0.45)' : '#bfe0c8'}`,
          }}
        >✓</button>
      )}
    </span>
  );
}

/** The scoped edit surface: the section's content stays right below; this
 *  panel is ONE talk/type box ("what should change and why") → Send → the
 *  PROPOSED change as an old→new diff → Approve / Reject & retry. */
function SectionEditPanel({ section, text, onText, busy, proposal, onSend, onApprove, onReject, sumStage, sumPct }) {
  const isLines = ['interactions', 'sequence', 'failureHandling'].includes(section.key);
  const prevLines = proposal && isLines ? sectionToLines(section.key, proposal.prev?.[section.key] ?? []) : [];
  const nextLines = proposal && isLines ? sectionToLines(section.key, proposal.next?.[section.key] ?? []) : [];
  const inSection = proposal ? proposal.diff.sentences.filter(s =>
    s.section === section.key || (section.key === 'sequence' && s.section === 'failureHandling')) : [];
  const elsewhere = proposal ? proposal.diff.sentences.filter(s => !inSection.includes(s)) : [];
  const clsLabel = proposal?.classInfo?.class
    ? classChipLabel({ class: proposal.classInfo.class, replanned: proposal.classInfo.replanned })
    : null;
  return (
    <div
      data-testid={`section-edit-panel-${section.key}`}
      style={{
        border: `1px solid ${C.primaryBorder}`, borderLeft: `4px solid ${C.primary}`,
        background: '#f7fafd', borderRadius: 8, padding: '8px 12px 10px', margin: '2px 0 10px',
      }}
    >
      {!proposal && (
        <>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
            Reviewing <b>{section.title}</b> — what should change, and why?
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <DictatedTextarea
              value={text}
              onChange={onText}
              rows={2}
              disabled={busy}
              data-testid={`section-edit-input-${section.key}`}
              micTestId={`section-edit-mic-${section.key}`}
              placeholder="type or talk"
              className="form-input"
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', fontSize: 12.5, resize: 'vertical', lineHeight: 1.5, padding: '7px 10px' }}
            />
            <button
              type="button"
              data-testid={`section-edit-send-${section.key}`}
              disabled={busy || !text.trim()}
              onClick={onSend}
              style={{
                background: (busy || !text.trim()) ? '#c6d4e4' : 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
                padding: '8px 14px', cursor: (busy || !text.trim()) ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}
            >{busy ? 'Working…' : 'Send'}</button>
          </div>
          {busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: C.text }}>{SUMMARIZE_STAGE_TEXT[sumStage] ?? 'Working…'}</span>
              <ProgressRing pct={sumPct} size={34} subLabel="" />
            </div>
          )}
        </>
      )}
      {proposal && (
        <div data-testid={`section-proposal-${section.key}`}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: C.primary, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Proposed change</span>
            {clsLabel && (
              <span data-testid={`section-proposal-class-${section.key}`} style={{ ...chipBase, color: '#1d4ed8', background: '#e8f0fa', border: '1px solid #a8c8e8' }}>{clsLabel}</span>
            )}
            <span style={{ fontSize: 10.5, color: C.light, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{proposal.rawText}”</span>
          </div>
          {/* old → new, brevity: line sections diff side by side; rich sections
              (devices/io) speak in computed sentences. */}
          {isLines && (prevLines.join('\n') !== nextLines.join('\n')) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '4px 16px', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: C.light, textTransform: 'uppercase', letterSpacing: '0.06em' }}>was</div>
                {prevLines.map((l, i) => (
                  <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: nextLines.includes(l) ? C.muted : '#991b1b', textDecoration: nextLines.includes(l) ? 'none' : 'line-through' }}>{i + 1}. {l}</div>
                ))}
                {prevLines.length === 0 && <div style={{ fontSize: 11.5, color: C.light, fontStyle: 'italic' }}>(empty)</div>}
              </div>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: C.light, textTransform: 'uppercase', letterSpacing: '0.06em' }}>now</div>
                {nextLines.map((l, i) => (
                  <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: prevLines.includes(l) ? C.muted : '#166534', fontWeight: prevLines.includes(l) ? 400 : 700 }}>{i + 1}. {l}</div>
                ))}
                {nextLines.length === 0 && <div style={{ fontSize: 11.5, color: C.light, fontStyle: 'italic' }}>(empty)</div>}
              </div>
            </div>
          )}
          {(!isLines || inSection.length > 0) && (
            <div style={{ marginBottom: 6 }}>
              {(inSection.length ? inSection : proposal.diff.sentences).slice(0, 12).map((s, i) => (
                <div key={i} style={{ fontSize: 11.5, lineHeight: 1.55, color: C.text }}>• {s.text}</div>
              ))}
              {proposal.diff.sentences.length === 0 && (
                <div style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>Nothing would change — the sheet already matches that.</div>
              )}
            </div>
          )}
          {elsewhere.length > 0 && (
            <div data-testid={`section-proposal-elsewhere-${section.key}`} style={{ fontSize: 11, color: '#92400e', marginBottom: 6 }}>
              also touches: {[...new Set(elsewhere.map(s => s.section))].join(', ')} — shown in the receipt if you approve
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              data-testid={`section-proposal-approve-${section.key}`}
              onClick={onApprove}
              disabled={busy}
              style={{
                background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 700, padding: '6px 18px', cursor: 'pointer',
              }}
            >Approve</button>
            <button
              type="button"
              data-testid={`section-proposal-reject-${section.key}`}
              onClick={onReject}
              disabled={busy}
              title="Drops the proposal — your words stay in the box; adjust and Send again"
              style={{
                background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
                fontSize: 12, fontWeight: 600, color: C.muted, padding: '6px 14px', cursor: 'pointer',
              }}
            >Reject — retry</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** COMPILE FINDINGS, PINNED (Dan, 2026-08-25: the modal said "self-check
 *  flagged 3 issues" then vanished — "I don't know what to do"). The findings
 *  persist on compiledSequence.selfCheck and pin here until the next compile;
 *  each line links to its best-guess home; the next step is explicit. */
function CompileFindingsPinned({ sm, devices, onGo }) {
  const sc = sm?.compiledSequence?.selfCheck;
  const errors = (sc?.errors ?? []).map(String).filter(Boolean);
  if (!errors.length || sm?.compiledSequence?.approved === true) return null;
  const homeOf = (msg) => {
    const t = normKey(msg);
    const di = (devices ?? []).findIndex(d => {
      const k = normKey(d?.name ?? '');
      return k && k.length >= 4 && t.includes(k);
    });
    if (di !== -1) return { target: `sheet-servo-${di}`, fallback: 'summary-section-devices' };
    if (/sequence|state|transition|step/i.test(msg)) return { target: 'summary-section-sequence' };
    return { target: 'summary-section-devices' };
  };
  return (
    <div
      data-testid="compile-findings-pinned"
      style={{
        marginBottom: 12, background: '#fdf6e3', border: '1px solid #e8b64c',
        borderRadius: 8, padding: '8px 12px',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: '#7a6220', marginBottom: 4 }}>
        Last compile self-check flagged {errors.length} issue{errors.length === 1 ? '' : 's'}
      </div>
      {errors.map((e, i) => {
        const h = homeOf(e);
        return (
          <div key={i} style={{ fontSize: 12, color: '#6b5513', lineHeight: 1.5, marginBottom: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            •{' '}
            <button
              type="button"
              data-testid={`compile-finding-${i}`}
              onClick={() => onGo(h)}
              title="Take me to the section"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: '#6b5513', textDecoration: 'underline', textAlign: 'left' }}
            >{e}</button>
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, color: '#7a6220', marginTop: 4 }}>
        Next step: review each section below (Edit or ✓), then <b>Looks good — build the code</b>.
      </div>
    </div>
  );
}

// ── PROPOSE → APPROVE CASCADE surfaces (Dan, 2026-08-26) ─────────────────────
// The guided review: a progress rail says where you are, ONE proposal is
// active at a time with ONE response place (Approve + talk back), approved
// steps lock ✓ into the outputs below, and editing a locked step re-opens it.

// What each step needs from the ME — the guide's per-step "what information
// you need to continue" line (Dan, 2026-08-26).
const STEP_INFO_NEEDED = {
  smSplit: 'how the station breaks down — agree with the split or say yours',
  devices: 'every device confirmed + names right + servo values filled',
  sequence: 'the cycle in order — agree or correct it',
  recovery: 'what happens on a failure — agree or correct it',
  interactions: 'who it talks to (or standalone) — agree',
};

/** THE STEP-BY-STEP GUIDE (side, sticky): how this is going to go and, per
 *  step, what information Jarvis needs to continue. Replaces the rail. */
function CascadeGuide({ steps, hasExplanation, allApproved, onJump }) {
  if (!steps?.length) return null;
  const tone = {
    approved: '#2f6b3c', active: 'var(--color-primary)', reconfirm: '#92400e', pending: C.light,
  };
  const mark = { approved: '✓', active: '●', reconfirm: '⟳', pending: '○' };
  const row = (key, icon, color, label, info, { bold = false, clickable = null, testId } = {}) => (
    <div
      key={key}
      data-testid={testId}
      onClick={clickable ?? undefined}
      title={info ? `Needs: ${info}` : undefined}
      style={{ padding: '3px 0', cursor: clickable ? 'pointer' : 'default', borderBottom: `1px solid var(--color-sidebar)` }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ color, fontSize: 10, flexShrink: 0, width: 11, textAlign: 'center' }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: bold ? 800 : 600, color: bold ? C.text : color, lineHeight: 1.4, minWidth: 0 }}>{label}</span>
      </div>
      {bold && info && (
        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.45, margin: '1px 0 2px 17px' }}>
          needs: {info}
        </div>
      )}
    </div>
  );
  return (
    <div
      data-testid="cascade-guide"
      style={{
        position: 'sticky', top: 8, width: 200, flexShrink: 0,
        border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
        padding: '8px 12px 10px',
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
        How this goes
      </div>
      {row('explain', hasExplanation ? '✓' : '●', hasExplanation ? tone.approved : tone.active,
        'You explain the station', 'pictures + your words — devices, sequence, recovery, challenges',
        { bold: !hasExplanation })}
      {steps.map(s => row(s.key, mark[s.status], tone[s.status],
        s.label, STEP_INFO_NEEDED[s.kind] ?? '',
        {
          bold: s.status === 'active',
          clickable: s.status === 'pending' ? null : () => onJump?.(s),
          testId: `cascade-guide-${s.key}`,
        }))}
      {row('generate', allApproved ? '●' : '○', allApproved ? tone.active : tone.pending,
        'Accept or build', allApproved ? 'accept the station, or build its code now' : 'unlocks when every step is agreed',
        { bold: allApproved })}
    </div>
  );
}

// Tolerant name matching (module scope — grouping AND attribution use it):
// camelCase/space/underscore/digit token decomposition + normalized substring.
const wordsOf = (s) => String(s ?? '')
  // Full camel split, leading caps included: 'ZSlide' → 'Z Slide',
  // 'PnPGripper' → 'PnP Gripper' (the 'ZSlide' one-token miss re-orphaned
  // VerticalSlide — 2026-08-27).
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase().split(/[^a-z0-9]+/)
  .filter(t => t.length >= 3 || /^\d+$/.test(t));
const nameMatchesText = (name, text) => {
  const nk = normKey(name);
  if (nk.length >= 4 && normKey(text).includes(nk)) return true;
  const nw = wordsOf(name);
  const tw = new Set(wordsOf(text));
  return nw.length > 0 && nw.every(w => tw.has(w));
};

// SEQUENCE LINES ARE THE ACTION ONLY (Dan, 2026-08-28): parenthetical
// annotations never render — values live on the device sheet.
const stripParens = (l) => String(typeof l === 'string' ? l : l?.text ?? '')
  .replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
const stripSeqItem = (x) => (typeof x === 'string' ? stripParens(x) : { ...x, text: stripParens(x) });
// DEVICE-IDENTITY KEY (Dan's Finger-2 P0, 2026-08-28): the sheet says
// "EscapementFinger2", the proposal says "Escapement Finger Two" — same
// device. normKey + digits spelled out makes them one key.
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const devKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  .replace(/[0-9]/g, (ch) => NUM_WORDS[+ch]);
// ONE WORD (Dan, 2026-08-28): stored lines from before the terminology
// ruling render normalized — "handshake" never reaches the screen. The
// engine rewrites the stored text properly at the next gate.
const normalizeSeqLine = (l) => stripParens(l)
  .replace(/\bhandshakes\b/gi, 'signals').replace(/\bhandshake\b/gi, 'signal')
  // ONE VOCABULARY (Dan, 2026-08-28): grippers ENGAGE/DISENGAGE — "Open/
  // Close gripper" is not SDC terminology. Stored lines render corrected;
  // the engine rewrites the stored text at the next gate.
  .replace(/^close\b(?=.*gripper)/i, 'Engage').replace(/^open\b(?=.*gripper)/i, 'Disengage');
// One client-side step composer (mirrors the server's stepText).
function composeStepClient(s) {
  if (typeof s === 'string') return s;
  if (!s) return '';
  if (s.raw) return s.raw;
  const a = String(s.action ?? '').toLowerCase();
  if (a === 'wait') {
    const tgt = String(s.target ?? '').replace(/\s*\bsignal\b\s*$/i, '');
    return s.counterpart ? `Wait for ${s.counterpart}'s ${tgt} signal`
      : `Wait for ${s.target}${s.detail ? ` — ${s.detail}` : ''}`;
  }
  if (a === 'signal' && s.counterpart) return `Signal ${s.target} to ${s.counterpart}`;
  if (a === 'home') return `Home: ${[s.target, s.detail].filter(Boolean).join(' — ') || 'initial position'}`;
  if (a === 'repeat') return 'Repeat';
  if (a === 'signal') return `Signal ${s.target}${s.detail ? ` — ${s.detail}` : ''}`;
  return `${s.action}${s.target ? ` ${s.target}` : ''}${s.detail ? ` — ${s.detail}` : ''}`.trim();
}
// TITLE CASE LAW (Dan, 2026-08-30): named things — devices, named positions,
// signals — capitalize the first letter of every word, everywhere they
// appear. Existing inner caps survive ("XAxis" stays "XAxis").
const titleCaseName = (s) => String(s ?? '').replace(/(^|[\s\-/])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
// RECOVERY AS A BRANCHING FLOW (Dan, 2026-08-30) — client-side flatten,
// mirroring smDecomposer.flattenRecoveryItems (strings = derived view).
function flattenRecoveryClient(items, composeStep) {
  const lineOf = (s) => (typeof s === 'string' ? s : composeStep(s));
  const out = [];
  for (const it of (items ?? [])) {
    if (it && typeof it === 'object' && it.decision) {
      out.push(`◇ ${String(it.decision).trim()}`);
      for (const b of (it.branches ?? [])) for (const s of (b.steps ?? [])) out.push(`${String(b.label ?? '?').trim()}: ${lineOf(s)}`);
    } else if (it != null) out.push(lineOf(it));
  }
  return out.filter(Boolean);
}
// ACTION-TYPE COLUMN (Dan, 2026-08-28: "same breakdown as the state machine
// diagram — type first, then the object"). The engine emits canonical line
// shapes, so this split is exact, not fuzzy. Tagged interaction lines drop
// the counterpart from the text — the tag column carries it.
function splitSeqLine(txt, tagged) {
  const t = String(txt ?? '').trim();
  let m;
  if (tagged && (m = t.match(/^wait\s+for\s+.+?['’]s\s+(.*)$/i))) return { type: 'Wait', rest: m[1] };
  if (tagged && (m = t.match(/^(?:signal|set)\s+(.*?)\s+to\s+[A-Za-z0-9 '’.&-]+$/i))) return { type: 'Signal', rest: m[1] };
  if ((m = t.match(/^home\s*:?\s*(.*)$/i))) return { type: 'Home', rest: m[1] };
  if ((m = t.match(/^wait\s+(?:for\s+)?(.*)$/i))) return { type: 'Wait', rest: m[1] };
  // ONE VOCABULARY (Dan, 2026-08-28): the operation set is the diagram's.
  // "Servo Move" is two words; a legacy bare "Move X Axis…" reads as servo.
  if ((m = t.match(/^servo\s+move\s*(.*)$/i))) return { type: 'Servo Move', rest: m[1] };
  if ((m = t.match(/^move\s+(.*)$/i)) && /axis/i.test(m[1])) return { type: 'Servo Move', rest: m[1] };
  m = t.match(/^([A-Za-z]+)\s*(.*)$/);
  return m
    ? { type: m[1].charAt(0).toUpperCase() + m[1].slice(1), rest: m[2] }
    : { type: '', rest: t };
}
// ── THE INLINE FLOW VIEW (Dan, 2026-08-30: the sequence IS a diagram — the
// ME view, simple on purpose: no state numbers, no tag names). Steps flow
// down as compact nodes; decisions branch with labeled paths and rejoin —
// the same shapes the diagram + codegen use. ────────────────────────────────
// (FlowMini family DELETED — SheetFlow (src/v2/SheetFlow.jsx) renders the
// sheet flows in the REAL v1 visual language. Dan, 2026-08-30.)
const BRANCH_LABEL_STYLE_UNUSED = null; // (kept name-free; branch styling lives in SheetFlow)
/** A wait line → its EDGE-CONDITION phrase ("Wait — Part Gripped").
 *  Wording is Dan's (2026-08-30): "Wait — …", not "when …". */
function condPhraseOf(line) {
  const t = normalizeSeqLine(line);
  let m = t.match(/^wait\s+for\s+.+?['’]s\s+(.+?)\s*(?:signal)?\s*$/i);
  if (m) return `Wait — ${titleCaseName(m[1])}`;
  m = t.match(/^wait\s+(?:for\s+)?(.*?)(?:\s+—.*)?$/i);
  return m ? `Wait — ${titleCaseName(m[1])}` : null;
}
/**
 * V1 CONVENTIONS (Dan, 2026-08-30): actions on nodes, conditions on edges.
 * Home never draws; waits become edge conditions; outgoing signals aren't
 * drawn (data intact for codegen + the deadlock check). Items carry parsed
 * {title, verb, device, detail} for the v1-shell nodes.
 */
/** THE DEGRADE GUARD (Dan, 2026-08-31): recovery data that arrives as flat
 *  prefixed strings ("◇ Gripper Engaged?", "Yes: …", "No: …") is parsed BACK
 *  into the structured {decision, branches} shape — the Y flow must never
 *  silently degrade to a numbered list. Deterministic: prefixes are ours. */
function restructureRecoveryLines(lines) {
  const ls = (lines ?? []).map(String).filter(Boolean);
  if (!ls.some(l => /^◇/.test(l) || /^(yes|no)\s*:/i.test(l))) return null;
  const items = [];
  let i = 0;
  while (i < ls.length) {
    const l = ls[i];
    if (/^◇/.test(l) || (/\?\s*$/.test(l) && /^(is|are|does|has|have|gripp|part|check)/i.test(l))) {
      const decision = l.replace(/^◇\s*/, '').replace(/\?+\s*$/, '');
      i++;
      const branches = [];
      while (i < ls.length) {
        const m = ls[i].match(/^([A-Za-z][\w /-]{0,24})\s*:\s*(.+)$/);
        if (!m) break;
        let br = branches.find(b => b.label === m[1]);
        if (!br) { br = { label: m[1], steps: [] }; branches.push(br); }
        br.steps.push(m[2].trim());
        i++;
      }
      if (branches.length) { items.push({ decision, branches }); continue; }
      items.push(l); continue;
    }
    items.push(l);
    i++;
  }
  return items.some(x => x && typeof x === 'object' && x.decision) ? items : null;
}

function buildFlowModel(structured, flatLines, composeStep, tagOf, devices = null) {
  const srcItems = (Array.isArray(structured) && structured.some(x => x && typeof x === 'object' && x.decision))
    ? structured
    : (restructureRecoveryLines(flatLines) ?? (flatLines ?? []).map(String));
  // DEVICE ICONS ON FLOW NODES (Dan, 2026-08-31): resolve each step's device
  // type so the node can carry the v1 icon + type color.
  const devList = Array.isArray(devices) ? devices : [];
  const dk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const devTypeOf = (deviceId, nameText) => {
    let d = deviceId ? devList.find(x => x?.devId === deviceId) : null;
    if (!d && nameText) {
      const k = dk(nameText);
      d = devList.find(x => { const xk = dk(x?.displayName ?? x?.name); return xk && (xk === k || xk.includes(k) || k.includes(xk)); });
    }
    return d?.type ?? null;
  };
  const walk = (items) => {
    const out = { items: [], repeat: false, endCond: null };
    let cond = null; let tag = null;
    for (const raw of items) {
      if (raw && typeof raw === 'object' && raw.decision) {
        out.items.push({
          branch: {
            decision: titleCaseName(String(raw.decision).replace(/\?+\s*$/, '')) + '?',
            cond, tag,
            branches: (raw.branches ?? []).map(b => {
              const lines = (b.steps ?? []).map(s => (typeof s === 'string' ? s : composeStep(s)));
              // Walk the RAW steps (objects keep deviceId for the icon).
              const inner = walk(b.steps ?? []);
              return {
                label: b.label,
                items: inner.items,
                endCond: inner.endCond,
                rejoins: lines.some(l => /rejoin|back to|loop/i.test(String(l))),
                faults: lines.some(l => /fault/i.test(String(l))),
              };
            }),
          },
        });
        cond = null; tag = null;
        continue;
      }
      const line = typeof raw === 'string' ? raw : composeStep(raw);
      const { type, rest } = splitSeqLine(normalizeSeqLine(line), false);
      if (/^home$/i.test(type)) continue; // device cards state home
      if (/^repeat$/i.test(type)) { out.repeat = true; continue; }
      if (/^wait$/i.test(type)) {
        const p = condPhraseOf(line);
        cond = cond && p ? `${cond} & ${p.replace(/^when /, '')}` : (p ?? cond);
        tag = tagOf(line) ?? tag;
        continue;
      }
      if (/^signal$/i.test(type)) continue; // in the data, not the drawing
      // Rejoin markers ARE the dotted rejoin edge, never a node (gate catch,
      // 2026-08-31: they rendered as icon-less "device" rows).
      if (/^rejoin/i.test(type) || /^rejoin/i.test(line)) continue;
      const [dev0, ...dd] = String(rest).split(' — ');
      out.items.push({
        line, cond, tag,
        verb: type,
        device: String(dev0 ?? '').trim(),
        detail: dd.join(' — ').trim(),
        title: `${type} ${String(dev0 ?? '').trim()}`.trim(),
        devType: devTypeOf(typeof raw === 'object' ? raw?.deviceId : null, String(dev0 ?? '').trim()),
      });
      cond = null; tag = null;
    }
    if (cond) out.endCond = cond;
    return out;
  };
  return walk(srcItems);
}
// Subtle color per FAMILY (Dan, 2026-08-28): motion vs wait vs signal vs
// home — the type column itself is the clarity.
const SEQ_TYPE_COLORS = {
  Wait: '#1574C4', Signal: '#0e7490',
  Home: '#8a94a6', Repeat: '#8a94a6',
  Extend: '#7c5c10', Retract: '#7c5c10', Engage: '#7c5c10', Disengage: '#7c5c10',
  'Servo Move': '#7c5c10', Move: '#7c5c10', Index: '#7c5c10',
};

/** LIVE DIFF rows for a sequence card (Dan, 2026-08-28): the new sequence
 *  with added/changed lines marked, removed lines struck through in place. */
function seqDiffRows(newSeq, diff) {
  const rows = (newSeq ?? []).map(t => {
    const t0 = stripParens(t);
    if (!diff) return { t: t0 };
    if (diff.added.includes(t0)) return { t: t0, added: true };
    const chg = (diff.changed ?? []).find(([, n]) => n === t0);
    if (chg) return { t: t0, changed: true, was: chg[0] };
    return { t: t0 };
  });
  if (diff) {
    for (const r of (diff.removed ?? [])) {
      const oldIdx = (diff.oldSeq ?? []).indexOf(r);
      rows.splice(Math.min(oldIdx < 0 ? rows.length : oldIdx, rows.length), 0, { t: r, removed: true });
    }
  }
  return rows;
}

/** NUMBERED-ANSWER PARSER (Dan, 2026-08-27): "1 — yes; 2 — actually there's
 *  a track-full sensor" → [{n, q, answer}] against the active step's
 *  numbered questions. Null when the text isn't numbered-answer shaped
 *  (the message then flows down the normal corrections path). */
function parseNumberedAnswers(text, questions) {
  const re = /(?:^|[;\n])\s*(?:q\s*)?(\d{1,2})\s*[-—–:.)]\s*/gi;
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ n: Number(m[1]), start: m.index + m[0].length, matchStart: m.index });
  if (!hits.length) return null;
  // Must START as a numbered answer — "retry 3 times" mid-sentence is prose.
  if (text.slice(0, hits[0].matchStart).trim()) return null;
  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const answer = text.slice(hits[i].start, i + 1 < hits.length ? hits[i + 1].matchStart : undefined).trim();
    const q = questions[hits[i].n - 1];
    if (q && answer) out.push({ n: hits[i].n, q, answer });
  }
  return out.length ? out : null;
}

/** THE STEP IS THE SECTION (Dan, 2026-08-27): the active section's header
 *  carries the step — "Step N of M · Approve" — one surface, no duplicate
 *  card. Renders inside the section's dark header (SummarySection reviewBar
 *  slot). */
function CascadeStepBar({ step, stepNo, stepCount, needsCount = 0, valuesCount = 0, busy, onApprove }) {
  const reconfirm = step.reconfirm === true;
  return (
    <span data-testid={`cascade-stepbar-${step.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{
        ...chipBase, color: '#fff', background: 'rgba(255,255,255,0.16)',
        border: '1px solid rgba(255,255,255,0.5)',
      }}>
        Step {stepNo} of {stepCount}
      </span>
      {/* Interactions review = the sequence card's tag column (Dan,
          2026-08-28) — one prompt sentence here, never a second list. */}
      {step.kind === 'interactions' && (
        <span data-testid={`cascade-stepbar-hint-${step.key}`} style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
          check the tagged signal lines — complete?
        </span>
      )}
      {(needsCount > 0 || valuesCount > 0) && (
        <span data-testid={`cascade-stepbar-needs-${step.key}`} style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
          {[needsCount > 0 ? `${needsCount} to answer` : null, valuesCount > 0 ? `${valuesCount} value${valuesCount === 1 ? '' : 's'} needed` : null]
            .filter(Boolean).join(' · ')}
        </span>
      )}
      <button
        type="button"
        data-testid={`cascade-approve-${step.key}`}
        onClick={onApprove}
        disabled={busy}
        title={reconfirm
          ? 'An upstream step changed since you approved this — re-confirm it'
          : 'Approve this step — it locks in and the next proposal opens'}
        style={{
          background: '#fff', color: 'var(--color-primary)', border: 'none', borderRadius: 4,
          fontSize: 12, fontWeight: 800, padding: '3px 16px', cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >{reconfirm ? 'Re-confirm' : 'Approve'}</button>
    </span>
  );
}

/** NUMBERED QUESTIONS (Dan, 2026-08-27): Q1/Q2/… at the TOP of the active
 *  section — their ONE home. Each carries Jarvis's proposal + Agree; the chat
 *  understands numbered answers ("1 — yes; 2 — actually …"). Value-asks ride
 *  as jump links, counted in the header's needs line. */
function StepQuestionsPanel({ step, needs = [], valueAsks = [], onAgreeNeed, onFocusChat, pendingNote = null }) {
  if (!needs.length && !valueAsks.length && !pendingNote) return null;
  return (
    <div data-testid={`cascade-step-needs-${step.key}`} style={{ margin: '0 0 8px' }}>
      {pendingNote && (
        <div data-testid={`cascade-assign-pending-${step.key}`} style={{ fontSize: 11, color: C.muted, margin: '2px 0 4px' }}>
          ⟳ {pendingNote}
        </div>
      )}
      {needs.map((n, i) => (
        <div key={`n${i}`} style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, margin: '2px 0',
          background: '#fdf6e3', border: '1px solid #e6d9a8', borderRadius: 4, padding: '5px 9px',
        }}>
          <span
            data-testid={`cascade-qnum-${step.key}-${i + 1}`}
            style={{
              flexShrink: 0, fontSize: 10, fontWeight: 800, color: '#fff',
              background: '#b45309', borderRadius: 4, padding: '1px 6px', marginTop: 1,
            }}
          >Q{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: '#6b5513', lineHeight: 1.45 }}>{n.question}</div>
            {/* THE GRID Dan described (2026-08-30): Question | what the
                shipped-work search found | the proposal | Agree. */}
            {n.evidence && (
              <div data-testid={`cascade-q-evidence-${step.key}-${i + 1}`} style={{ fontSize: 11, color: '#0f4c81', lineHeight: 1.4, marginTop: 2 }}>
                <b style={{ fontSize: 9.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>From our shipped examples: </b>
                {n.evidence}
              </div>
            )}
            {n.proposedSolution && (
              <div style={{ fontSize: 11, fontStyle: 'italic', color: C.muted, lineHeight: 1.4, marginTop: 2 }}>
                <b style={{ fontSize: 9.5, letterSpacing: '0.04em', textTransform: 'uppercase', fontStyle: 'normal' }}>My proposal: </b>
                {n.proposedSolution}
              </div>
            )}
            {n.unattributed && (
              <div data-testid={`cascade-q-unattributed-${step.key}-${i + 1}`} style={{ fontSize: 10, color: C.light, lineHeight: 1.4 }}>
                not sure which machine this belongs to — your answer will tell me.
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid={`cascade-need-agree-${step.key}-${i}`}
            onClick={() => onAgreeNeed?.(n)}
            title="Go with Jarvis's proposal — recorded, never re-asked"
            style={{
              ...chipBase, cursor: 'pointer', color: '#2f6b3c', background: '#e9f5ec',
              border: '1px solid #bfe0c8', flexShrink: 0,
            }}
          >✓ Agree</button>
        </div>
      ))}
      {valueAsks.map((v, i) => (
        <div key={`v${i}`} style={{ fontSize: 11.5, lineHeight: 1.5, margin: '2px 0' }}>
          •{' '}
          <button
            type="button"
            data-testid={`cascade-valueask-${step.key}-${i}`}
            onClick={v.onClick}
            title="Take me to the table"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: '#92400e', textDecoration: 'underline', textAlign: 'left' }}
          >{v.label}</button>
        </div>
      ))}
      {needs.length > 0 && (
        <div style={{ fontSize: 10.5, color: C.light, marginTop: 3 }}>
          Answer by number in the{' '}
          <button
            type="button"
            data-testid={`cascade-chat-link-${step.key}`}
            onClick={onFocusChat}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.primary, textDecoration: 'underline' }}
          >chat</button>
          {' '}— e.g. “1 — yes; 2 — actually there's a track-full sensor” — or ✓ Agree each.
        </div>
      )}
    </div>
  );
}

/** "Jarvis is proposing the state machines…" — live elapsed-based progress
 *  while the auto-kicked compile runs (Dan, 2026-08-26: send → GO). */
function SmProposalWait({ startedAt, typicalS = 45 }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, (now - (startedAt ?? now)) / 1000);
  const pct = Math.min(95, (elapsed / typicalS) * 100);
  return (
    <div data-testid="sm-propose-progress" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 2px' }}>
      <ProgressRing pct={pct} size={44} subLabel="" />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
          Proposing the state machines… {Math.floor(elapsed)}s
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {elapsed > 60
            ? 'taking longer than usual — it hard-stops with a Retry at 2 minutes, never a frozen bar'
            : 'he reads your explanation and splits the station by what must run asynchronously — typically ~30s'}
        </div>
      </div>
    </div>
  );
}

/** The SM toggle on the sheet: flip which state machine's outputs show
 *  (devices / sequence / recovery). Syncs with the banner's SM chips and the
 *  diagram via store.setActiveSm when the machines exist as records. */
function SmOutputToggle({ entries, selected, onSelect }) {
  if ((entries?.length ?? 0) < 2) return null;
  const chip = (key, label, title, testId) => {
    const on = selected === key;
    return (
      <button
        key={key}
        type="button"
        data-testid={testId}
        onClick={() => onSelect(key)}
        title={title}
        style={{
          // SQUARE LAW (Dan, 2026-08-27): app chips are square, never pills.
          fontSize: 11, fontWeight: on ? 700 : 500, padding: '2px 10px',
          borderRadius: 4, cursor: on ? 'default' : 'pointer',
          color: on ? '#fff' : '#33506e',
          background: on ? 'var(--color-primary)' : '#fff',
          border: `1px solid ${on ? 'var(--color-primary)' : '#c6d4e4'}`,
        }}
      >{label}</button>
    );
  };
  return (
    <div data-testid="sheet-sm-toggle" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '0 0 10px' }}>
      <span style={{ fontSize: 11, color: C.muted }}>Showing:</span>
      {chip('all', 'All state machines', 'Overview — every machine\'s devices, sequences and recovery', 'sheet-sm-chip-all')}
      {entries.map(e => chip(
        e.key, e.name,
        e.smId
          ? `Show only ${e.name}'s devices, sequence and recovery — the banner and the diagram follow`
          : `Show only ${e.name}'s devices, sequence and recovery`,
        `sheet-sm-chip-${e.key}`
      ))}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

// embedded: v2 renders a BUILT station's sheet inside the shell's content
// area, below the persistent StationBanner (which owns the Spec Sheet|Diagram
// toggle) — instead of the full-viewport overlay used by fresh "+ New" drafts.
export function CreateStationPage({ embedded = false }) {
  const store = useDiagramStore();
  const sms = store.project?.stateMachines ?? [];
  const otherSms = sms; // the new SM doesn't exist yet — every SM is "other"
  const hasOtherSms = sms.length > 0;
  // Draft-store key, FROZEN at mount (Dan's Aug 24 cross-project leak: a
  // project switch under a still-mounted page recomputed this key, and the
  // 1s autosave then wrote the OLD project's draft — old smId and all — into
  // the NEW project's draft store, where it rendered as a foreign station's
  // sheet). A draft belongs to the project it was authored in; every
  // load/save/delete on this page uses the mount-time key. The v2 shell also
  // remounts this page on any project change (keyed mount in AppV2), so in
  // v2 the frozen key and the live key are always the same.
  const draftKeyRef = useRef(null);
  if (draftKeyRef.current === null) draftKeyRef.current = draftsKeyFor(store);
  const draftKey = draftKeyRef.current;

  // ALWAYS open blank — no silent restore. The only exception: an explicit
  // resume request (StationsPanel "Drafts" row / "Station Specs" on the
  // canvas) peeked synchronously before first paint of the fields and
  // CLEARED in a mount effect (a destructive read during render loses the
  // request under StrictMode's double render).
  const initRef = useRef(undefined);
  if (initRef.current === undefined) {
    const resumeId = peekResumeRequest();
    let resumed = resumeId
      ? loadDrafts(draftKey).find(d => d.draftId === resumeId) ?? null
      : null;
    // EMBEDDED SELF-HEAL (Dan, Aug 24 hijack bug): an embedded mount is
    // ALWAYS a built station's living sheet. If the one-shot resume handoff
    // is gone (already consumed, remount, hot-reload), rebuild the linked
    // sheet draft from the SM itself — NEVER fall into a blank "Create
    // Station" form underneath the station banner.
    if (embedded && (!resumed || !resumed.smId)) {
      const shellSmId = useV2Shell.getState().sheetLinkedSmId;
      const shellSm = shellSmId ? sms.find(s => s.id === shellSmId) : null;
      if (shellSm) resumed = ensureStationSheetDraft(store, shellSm);
    }
    // FRESH-PAGE REMOUNT RESILIENCE (Dan, Aug 24: an HMR reload mid-dictation
    // remounted this page and blanked the form). The autosave marks the draft
    // this page has open; a remount within ~10 minutes silently resumes it —
    // no banner, no blank form, the user never notices. "+ New Station always
    // opens blank" is preserved: every explicit exit clears the marker, so
    // only a remount can reach this path, and the marker is project-keyed so
    // it can never resume another project's draft.
    if (!embedded && !resumed) {
      const activeId = peekActiveFreshDraft(draftKey);
      if (activeId) resumed = loadDrafts(draftKey).find(d => d.draftId === activeId) ?? null;
    }
    initRef.current = { draft: resumed, draftId: resumed?.draftId ?? newDraftId() };
  }
  const draft = initRef.current.draft;
  const draftIdRef = useRef(initRef.current.draftId);
  useEffect(() => { consumeResumeRequest(); }, []);
  // The station this sheet belongs to (set at Build; carried on the draft).
  // Present => this page is the station's LIVING data sheet: Build becomes
  // "Rebuild station" and REPLACES the SM instead of adding a new one.
  // SELF-HEAL (Dan's MidBaseLoad restart, 2026-08-26): a draft linked to a
  // station that no longer exists in the project becomes an UNLINKED draft
  // again — description + images intact, Build recreates the station.
  const smExists = (id) => !!id && (store.project?.stateMachines ?? []).some(s => s.id === id);
  const [linkedSmId, setLinkedSmId] = useState(smExists(draft?.smId) ? draft.smId : null);

  // The project's OTHER stations (machine-aware interactions, Dan Aug 24):
  // a linked sheet excludes ITSELF — a one-station project is standalone.
  const peerSms = sms.filter(s => s.id !== linkedSmId);
  const peerNames = peerSms.map(s => s.displayName ?? s.name);
  const hasPeers = peerSms.length > 0;

  // Structured summaries only — a pre-rework draft with a string summary
  // falls back to the input phase (the raw explanation is preserved).
  // A linked sheet REHYDRATES its values from the built SM on load — the SM
  // is the authority for committed values (self-heal after any sheet wipe).
  const draftSummary = isStructuredSummary(draft?.summary)
    ? withSheetPrefill(hydrateSummaryFromSm(draft.summary, draft?.smId ? sms.find(s => s.id === draft.smId) : null))
    : null;

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
      _hash: img._hash ?? imgHash(img.base64),
      previewUrl: `data:${img.mediaType};base64,${img.base64}`,
    })));
  // Server image files this sheet absorbed from twin drafts — hydration pulls
  // these too, then merges everything into THIS draft's server file.
  const absorbedIdsRef = useRef(draft?.absorbedDraftIds ?? []);
  // Unfinished drafts in THIS project (excluding the one being edited) —
  // listed in a banner on the fresh page, resumed only by explicit click.
  const [otherDrafts, setOtherDrafts] = useState(() =>
    // Sheets linked to a built station (smId) are living specs, not
    // "unfinished drafts" — they never show in the resume banner. A draft
    // whose station was DELETED is an unfinished draft again (self-heal).
    loadDrafts(draftKey).filter(d => d.draftId !== draftIdRef.current
      && (!d.smId || !smExists(d.smId))));
  const [draftImagesDropped, setDraftImagesDropped] = useState(0);

  // Summary loop state (summary is the STRUCTURED object, or null)
  const [summary, setSummary] = useState(draftSummary);
  const [jarvisCoverage, setJarvisCoverage] = useState(() => normCoverage(draft?.jarvisCoverage ?? null));
  const [questions, setQuestions] = useState(draft?.questions ?? []);
  // Needs the ME clicked "Agree" on (keys `${covKey}:${question}`) — a local
  // acknowledgment, never a paid re-summarize (accepting = doing nothing).
  const [agreedNeeds, setAgreedNeeds] = useState(() => new Set(draft?.agreedNeeds ?? []));
  // Level of code generation (Dan, Aug 24): the preset id — persists on
  // machineSpec.generationPreset and writes machineSpec.generationScope.
  const [genLevel, setGenLevel] = useState(() =>
    draft?.genLevel
    ?? (draft?.smId ? sms.find(s => s.id === draft.smId)?.machineSpec?.generationPreset : null)
    ?? 'standard');
  // Build purpose (Dan, Aug 23): optional one-liner that changes how Jarvis
  // approaches the build — persists on machineSpec.purpose. Now the free
  // "specifics" line under the Level of code generation presets.
  const [purpose, setPurpose] = useState(() =>
    draft?.purpose
    ?? (draft?.smId ? sms.find(s => s.id === draft.smId)?.machineSpec?.purpose : '')
    ?? '');
  // ME's expected SM decomposition (Dan, 2026-08-25): optional free text —
  // persists raw on machineSpec.expectedStateMachines; the compile weighs it
  // against the asynchrony test (agrees or counters with reasoning).
  const [expectedSms, setExpectedSms] = useState(() =>
    draft?.expectedSms
    ?? (draft?.smId ? sms.find(s => s.id === draft.smId)?.machineSpec?.expectedStateMachines : '')
    ?? '');
  // Past-job reference (Dan, Aug 24): FREE talk/type text — which station, on
  // which job, and what we're actually referencing (never just a name).
  // Persists on machineSpec.referenceJobs as [{text, at}]; legacy {name}
  // entries fold into the initial text.
  const referenceJobsText = (jobs) =>
    (Array.isArray(jobs) ? jobs : []).map(j => j?.text ?? j?.name).filter(Boolean).join('\n');
  const [referenceText, setReferenceText] = useState(() =>
    draft?.referenceText
    ?? (draft?.smId ? referenceJobsText(sms.find(s => s.id === draft.smId)?.machineSpec?.referenceJobs) : '')
    ?? '');
  // Non-standard requests Jarvis flagged (description contradicts an SDC
  // standard) — rendered as the amber callout, persisted into machineSpec.
  const [nonStandardFlags, setNonStandardFlags] = useState(draft?.nonStandardFlags ?? []);
  // THE OPTIONAL CE LANE (Dan, 2026-08-30): station-scoped controls intent,
  // filed conversationally (CE toggle + chat → file_controls_note), rendered
  // in the inputs area, rides into codegen between Dan's words and precedent.
  const [controlsNotes, setControlsNotes] = useState(draft?.controlsNotes ?? []);
  // In-place edit tracking: baseline = the summary as Jarvis last returned
  // it; ANY inline edit sets dirty and raises the sticky Resubmit bar.
  const [dirty, setDirty] = useState(false);
  const baselineRef = useRef(draftSummary);
  // Corrections: ONE high-level talk/type box (Dan, Aug 24 — the per-section
  // boxes are gone). Jarvis routes each correction to the section it names
  // implicitly; direct fixes happen inline on the lines themselves.
  const [changes, setChanges] = useState('');
  const [applying, setApplying] = useState(false);
  // THE AGENT LOOP's live activity line ("reading the sheet…") — Dan
  // approved the loop build 2026-08-28; docs/jarvis-agent-loop-design.md.
  const [agentState, setAgentState] = useState(null);
  // KNOW YOUR AUDIENCE (Dan, 2026-08-30): ME | CE — whoever sits at the
  // machine. Per-browser, default ME. Rides every loop turn's voice contract.
  const [audience, setAudience] = useState(() => {
    try { return localStorage.getItem('jarvis.audience') === 'CE' ? 'CE' : 'ME'; } catch { return 'ME'; }
  });
  // ELAPSED, NOT PERCENT (Dan, 2026-08-30: "0% reads as dead") — percent is
  // meaningless for an agent loop; the narration + a ticking clock is the
  // honest signal. Ticks client-side so there is always visible motion.
  const [agentElapsed, setAgentElapsed] = useState(0);
  const agentStartRef = useRef(null);
  useEffect(() => {
    if (!agentState) { agentStartRef.current = null; setAgentElapsed(0); return undefined; }
    if (!agentStartRef.current) agentStartRef.current = Date.now();
    const t = setInterval(() => setAgentElapsed(Math.floor((Date.now() - agentStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [agentState ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // Standing rules JARVIS just learned from the engineer's answers —
  // only facts the model explicitly returned AND the server recorded.
  const [learnedNotes, setLearnedNotes] = useState([]);
  // Question-loop guards: how many Apply-changes rounds have run (after 2,
  // JARVIS is told to ask ZERO new questions) and the full Q&A history
  // (sent with every re-summarize so nothing is ever re-asked).
  const [qaRounds, setQaRounds] = useState(0);
  // ── Corrections CHAT (Dan, Aug 24: "corrections becomes a chat interface —
  // and it's Jarvis, the same layer generating the code"). ONE persisted
  // history: chatThread [{role:'me'|'jarvis', text, items?, questions?, at}].
  // qaHistory (the prompt's asked-and-answered discipline) is DERIVED from it
  // on restore — never a second stored history.
  const [chatThread, setChatThread] = useState(() =>
    Array.isArray(draft?.chatThread) ? draft.chatThread : []);
  const [qaHistory, setQaHistory] = useState(() =>
    (Array.isArray(draft?.chatThread) ? draft.chatThread : [])
      .filter(t => t?.role === 'me' && t.text)
      .map(t => ({ questions: t.questions ?? [], answer: t.text })));
  // CHAT THREADS ARE THE SCROLL EXCEPTION (Dan, 2026-08-25: "that's one where
  // you can scroll"): the thread caps at ~5-6 turns tall with internal scroll,
  // expandable to full height. Everything else on the sheet still grows.
  const [threadExpanded, setThreadExpanded] = useState(false);
  const threadRef = useRef(null);
  useEffect(() => {
    // Capped view keeps the newest turns in sight — scroll pinned to bottom.
    if (!threadExpanded && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [chatThread, threadExpanded]);
  const [summarizeCost, setSummarizeCost] = useState(draft?.summarizeCost ?? 0);
  // Per-station-draft summarize cost ceiling ($). Server reports the real
  // configured value in meta.maxCostUSD; 25 is the loop-era default (Dan,
  // 2026-08-30: opus turns run ~$0.25–1.50 each and "act and answer
  // questions correctly — that's all I care about"; $5 stranded a draft
  // mid-walk with a disabled Send).
  const [summarizeCostCap, setSummarizeCostCap] = useState(25);
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

  // ── Apply receipt + sheet-ahead flag (Dan, Aug 24) ───────────────────────
  // Receipt: the "What changed" card after every Apply — the model's
  // changesMade sentences (client diff as fallback), dismissible, replaced
  // by the next Apply. NOTHING SILENT: an apply that changed nothing says so.
  const [applyReceipt, setApplyReceipt] = useState(null); // { items:[{section,text}], at }
  // Sheet-ahead: the sheet iterates freely (apply, fix values, edit devices)
  // and Rebuild happens ONCE, deliberately, when everything is right — so no
  // nagging next-step strip; just a quiet persistent chip ("Sheet updated
  // since last build — Rebuild when ready"). Set on any sheet change after
  // the last build, cleared by a successful Rebuild, persists with the draft.
  const [sheetAhead, setSheetAhead] = useState(() => draft?.sheetAhead === true);
  const markSheetAhead = () => { if (linkedSmId) setSheetAhead(true); };

  // SAVE-STATE TICKS (Dan, 2026-08-25): one pulse from the debounced autosave
  // drives every field's ⟳ / ✓ saved indicator.
  const [savedPulse, setSavedPulse] = useState(0);

  // ── REVIEW & EDIT mode (Dan's flow, 2026-08-25): after a Build, each sheet
  // section gets an Edit affordance → scoped edit → PROPOSED diff → approve →
  // quiet ✓ → "N of M sections reviewed" → "Looks good — build the code". ────
  const [sectionEditKey, setSectionEditKey] = useState(null);   // open edit surface
  const [sectionEditText, setSectionEditText] = useState('');   // persists until a receipt confirms
  const [sectionProposal, setSectionProposal] = useState(null); // { key, title, rawText, data, agentic, prev, next, diff, classInfo }
  const [proposalBusy, setProposalBusy] = useState(false);
  // Reviewed marks persist on machineSpec.sectionReviews for built stations;
  // fresh drafts keep them locally (they reset with the draft, correctly).
  const [localReviews, setLocalReviews] = useState({});

  // ── PROPOSE → APPROVE CASCADE (Dan, 2026-08-26) ──────────────────────────
  // Which SM's outputs the sheet shows ('all' | decomposition entry key) —
  // synced with the banner chips + diagram via store.setActiveSm when the
  // machines exist as records. Cascade approvals persist per station on
  // machineSpec.cascadeState; fresh drafts keep them locally.
  const [sheetSmKey, setSheetSmKey] = useState('all');
  // FLOW ONLY (Dan, 2026-08-30): the sequence card IS the flow diagram —
  // no list toggle. Diff detail rows appear transiently while change marks
  // are up; ✓ got it returns the flow.
  const [localCascade, setLocalCascade] = useState(draft?.cascadeLocal ?? null);
  // EXPLANATION → SEND → GO (Dan, 2026-08-26): submitting the explanation
  // auto-kicks the SM proposal (build + compile). This tracks the run so the
  // step-1 card shows live progress / a retry with the reason.
  const [proposeRun, setProposeRun] = useState(null); // {stage:'compile',startedAt} | {stage:'error',msg}
  const autoKickRef = useRef(false); // one auto-run per mount
  // THE DECOMPOSE-ONLY PROPOSAL (Dan, 2026-08-26): step 1's result lives on
  // the DRAFT — no station/diagram exists until the Generate step.
  // { stateMachines:[{name,oneLiner,ownedDeviceNames,why,sequence}], reasoning, at }
  const [smProposal, setSmProposal] = useState(draft?.smProposal ?? null);
  const splitCounterRef = useRef(''); // a chat counter to the draft proposal rides the re-decompose
  const reviewingKeyRef = useRef(null); // which machine the feedback round was about
  // LIVE DIFF (Dan, 2026-08-28): a correction shows IN the sequence card —
  // removed lines struck through, added/changed highlighted — until "got it".
  const [seqDiff, setSeqDiff] = useState(null); // { byKey: {k:{removed,added,changed,machine}}, at }
  // THE LOOP CONTRACT, ALL ARTIFACTS (Dan, 2026-08-30: tell → do → RED on
  // the page → look → "✓ got it" or feedback): recovery + device marks ride
  // the same highlight-until-acknowledged pattern as the sequence diff.
  const [recDiff, setRecDiff] = useState(null);   // { byKey: {k:{removed,added,changed,machine}}, at }
  const [devChanged, setDevChanged] = useState(null); // { names: [], at }
  const clearAllMarks = () => { setSeqDiff(null); setRecDiff(null); setDevChanged(null); };
  const anyMarks = !!(seqDiff || recDiff || devChanged);
  // Server-draft sync bookkeeping (server = source of truth).
  const lastServerRevRef = useRef(0);
  // EDITABLE EXPLANATION (Dan, 2026-08-28): re-enterable after the cascade
  // starts; applying an edit is a gate event through the same engine.
  const [explEditing, setExplEditing] = useState(false);
  // EXPLANATION LAYERS (Dan, 2026-08-30, the change-order model): additions
  // are dated LAYERS under the original — "Layer 2: what we're adding" —
  // never inline rewrites. Each layer is a gate event; the stack reads as
  // history (original intent, then each change-order in order).
  const [explLayers, setExplLayers] = useState(() => (Array.isArray(draft?.explanationLayers) ? draft.explanationLayers : []));
  const [explAddingLayer, setExplAddingLayer] = useState(false);
  const [explLayerDraft, setExplLayerDraft] = useState('');
  // COLLAPSIBLE INPUTS (Dan, 2026-08-30): remembered per draft; defaults to
  // collapsed once step 1 is approved (set by the effect below).
  const [inputsCollapsed, setInputsCollapsed] = useState(false);
  const inputsPrefLoadedRef = useRef(null);
  useEffect(() => {
    const id = draftIdRef.current;
    if (!id || inputsPrefLoadedRef.current === id) return;
    inputsPrefLoadedRef.current = id;
    try {
      const stored = localStorage.getItem(`jarvis.inputsCollapsed.${id}`);
      if (stored != null) { setInputsCollapsed(stored === '1'); return; }
    } catch { /* private mode */ }
    // No stored choice: auto-collapse once the walk is underway.
    setInputsCollapsed((localCascade?.steps && Object.values(localCascade.steps).some(r => r?.approved === true)) ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  // COLLAPSIBLE EVERYTHING (Dan, 2026-08-30): every sheet section collapses
  // like the inputs do; the choice persists per draft. {sectionKey: true}.
  const [collapsedSections, setCollapsedSections] = useState({});
  const collapsePrefLoadedRef = useRef(null);
  useEffect(() => {
    const id = draftIdRef.current;
    if (!id || collapsePrefLoadedRef.current === id) return;
    collapsePrefLoadedRef.current = id;
    try {
      const stored = localStorage.getItem(`jarvis.sheetCollapsed.${id}`);
      if (stored) setCollapsedSections(JSON.parse(stored) || {});
    } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const writeCollapsed = (next) => {
    setCollapsedSections(next);
    try { localStorage.setItem(`jarvis.sheetCollapsed.${draftIdRef.current}`, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const toggleSectionCollapse = (key) => writeCollapsed({ ...collapsedSections, [key]: !collapsedSections[key] });
  // ONE CONSISTENT STACK (Dan, 2026-08-31): expand/collapse-all governs EVERY
  // bar — inputs, controls information, chat, change log and build included.
  // changeLog defaults collapsed, so expand-all writes it explicitly false.
  const setAllSectionsCollapsed = (on) => {
    writeCollapsed(on
      ? { interactions: true, devices: true, sequence: true, io: true, controlsNotes: true, chat: true, changeLog: true, build: true }
      : { changeLog: false });
    setInputsCollapsed(on);
    try { localStorage.setItem(`jarvis.inputsCollapsed.${draftIdRef.current}`, on ? '1' : '0'); } catch { /* private mode */ }
  };
  // Per-key fold default: change log starts folded; everything else open.
  const secFolded = (key) => (collapsedSections[key] ?? (key === 'changeLog'));

  const fullExplanation = useMemo(() => [
    description,
    ...explLayers.map((L, i) => `\n\n--- CHANGE-ORDER LAYER ${i + 2} (added ${new Date(L.at).toISOString().slice(0, 10)}) ---\n${L.text}`),
  ].join(''), [description, explLayers]);
  const [explDraft, setExplDraft] = useState('');
  // NO UNASSIGNED, EVER (Dan, 2026-08-27: "you know what goes to what —
  // assign them and I'll tell you if it's right or wrong"). Jarvis COMMITS a
  // machine for every device; committed guesses persist here (name-keyed) so
  // a refresh keeps them, and fallback guesses ask a numbered question on
  // their machine's own devices step.
  const [deviceAssignments, setDeviceAssignments] = useState(draft?.deviceAssignments ?? {});
  // STATION ACCEPT (Dan, 2026-08-28): stations are accepted one after
  // another; code generates for the WHOLE MACHINE at the end. {by, at}.
  const [stationAccepted, setStationAccepted] = useState(draft?.stationAccepted ?? null);
  // ONE collapsible chat (Dan, 2026-08-26): the thread tucks away on demand.
  const [chatCollapsed, setChatCollapsed] = useState(false);
  // QUESTIONS LIVE IN THE CHAT (Dan, 2026-08-31): 'chat' | 'questions'.
  const [chatTab, setChatTab] = useState('chat');

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

  // Embedded (v2) sheets: tell the shell when we're mid-work so the banner's
  // Spec Sheet|Diagram toggle blocks the flip WITH a reason instead of
  // silently killing a build/summarize/apply in flight.
  useEffect(() => {
    if (!embedded) return undefined;
    const b = phase === 'building' || phase === 'summarizing' || applying;
    useV2Shell.getState().setSheetBusy(b);
    return () => useV2Shell.getState().setSheetBusy(false);
  }, [embedded, phase, applying]);

  // ── Draft autosave (debounced ~1s) ───────────────────────────────────────
  // A draft linked to a built station (linkedSmId) is that station's LIVING
  // data sheet — it is never auto-deleted and keeps saving after Build so
  // the sheet → diagram → sheet round-trip is lossless.
  const buildDraftPayload = ({ withImages = true, phaseOverride = null } = {}) => serializeDraft({
    draftId: draftIdRef.current,
    name, station, description,
    images: withImages ? images : [],
    phase: phaseOverride ?? ((phase === 'summary' || phase === 'summarizing') ? 'summary' : 'input'),
    summary, jarvisCoverage, questions, nonStandardFlags, summarizeCost,
    purpose, genLevel, expectedSms, referenceText, controlsNotes, agreedNeeds: [...agreedNeeds], sheetAhead,
    // Corrections chat — persisted capped (last 40 turns) so the sheet's
    // conversation survives reopen without bloating localStorage.
    chatThread: chatThread.slice(-40),
    ...(localCascade ? { cascadeLocal: localCascade } : {}),
    ...(smProposal ? { smProposal } : {}),
    ...(stationAccepted ? { stationAccepted } : {}),
    ...(explLayers.length ? { explanationLayers: explLayers } : {}),
    ...(Object.keys(deviceAssignments ?? {}).length ? { deviceAssignments } : {}),
    ...(absorbedIdsRef.current.length ? { absorbedDraftIds: absorbedIdsRef.current } : {}),
    ...(linkedSmId ? { smId: linkedSmId } : {}),
  });
  const persistDraftNow = (extra = {}) => {
    const { payload, droppedImages } = buildDraftPayload();
    const merged = { ...payload, ...extra };
    // SERVER = SOURCE OF TRUTH (Dan, 2026-08-30; grew out of the 2026-08-27
    // mirror): every save posts with the rev it was based on. A 409 means
    // someone else (an agent turn, another tab) wrote meanwhile — merge with
    // the standing policy (HIS manual inputs win; engine artifacts take the
    // newer server copy; the longer chat wins) and re-post once.
    try {
      const { images: _mirrorImgs, ...mirror } = merged;
      const post = (draftObj, baseRev) => fetch('/api/jarvis/sheet-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draftIdRef.current, draft: draftObj, baseRev, clientId: CLIENT_ID }),
      });
      post(mirror, lastServerRevRef.current).then(async (r) => {
        if (r.ok) {
          const d = await r.json().catch(() => null);
          if (d?.rev) lastServerRevRef.current = d.rev;
          return;
        }
        if (r.status !== 409) return;
        const c = await r.json().catch(() => null);
        if (!c?.draft) return;
        const server = c.draft;
        const mergedDraft = {
          ...server,
          // His manual inputs win:
          name: mirror.name, station: mirror.station, description: mirror.description,
          summary: mirror.summary, explanationLayers: mirror.explanationLayers,
          purpose: mirror.purpose, genLevel: mirror.genLevel, expectedSms: mirror.expectedSms,
          referenceText: mirror.referenceText, sheetAhead: mirror.sheetAhead,
          ...(mirror.stationAccepted ? { stationAccepted: mirror.stationAccepted } : {}),
          // The longer conversation wins:
          chatThread: (server.chatThread?.length ?? 0) > (mirror.chatThread?.length ?? 0) ? server.chatThread : mirror.chatThread,
        };
        const r2 = await post(mergedDraft, c.rev);
        const d2 = r2.ok ? await r2.json().catch(() => null) : null;
        if (d2?.rev) lastServerRevRef.current = d2.rev;
      }).catch(() => {});
    } catch { /* the store write is retried on the next autosave */ }
    if (saveDraft(draftKey, merged)) {
      setDraftImagesDropped(droppedImages);
      return true;
    }
    const { payload: textOnly } = buildDraftPayload({ withImages: false });
    if (saveDraft(draftKey, { ...textOnly, ...extra })) {
      setDraftImagesDropped(images.length);
      return true;
    }
    return false; /* storage entirely unavailable */
  };
  // RELOAD-SAFE (Dan, 2026-08-30): the new-build bar flushes the pending
  // autosave through this hook before it reloads — a reload never loses a
  // keystroke (localStorage save is synchronous; the mirror rides after).
  useEffect(() => {
    window.__slbFlushDraft = () => { try { persistDraftNow(); } catch { /* best effort */ } };
    return () => { delete window.__slbFlushDraft; };
  });
  useEffect(() => {
    if (phase === 'building' || phase === 'specFailed') return;
    const t = setTimeout(() => {
      const hasContent = description.trim() || images.length || summaryHasContent(summary) || name.trim();
      if (!hasContent && !linkedSmId) {
        deleteDraft(draftKey, draftIdRef.current);
        if (!embedded) clearActiveFreshDraft(); // nothing left to resume
        return;
      }
      // Save-state ticks: the pulse fires only when the save actually landed.
      if (persistDraftNow()) setSavedPulse(Date.now());
      // Refresh the remount-resilience marker (fresh pages only — embedded
      // sheets already self-heal from sheetLinkedSmId).
      if (!embedded) markActiveFreshDraft(draftKey, draftIdRef.current);
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, station, description, images, phase, summary, jarvisCoverage, questions, nonStandardFlags, summarizeCost, purpose, genLevel, expectedSms, referenceText, controlsNotes, agreedNeeds, sheetAhead, chatThread, localCascade, smProposal, deviceAssignments, draftKey, linkedSmId]);

  // ── Pictures persist FOREVER — hardened after the Aug 24 SECOND loss ─────
  // The server copy is authoritative and its merge is ADDITIVE (union by
  // content hash) — the client can never clobber it. An image only leaves
  // the set via the user's explicit ✕ (sent as `removed` hashes). Sync runs
  // ~400ms after any change, RETRIES on failure, is FLUSHED (never
  // cancelled) on unmount/page-flip, uploads a paste that landed while
  // hydration was still in flight, and every thumbnail wears its live sync
  // state (⟳ saving / ✓ saved / ! retrying) so silent loss is impossible.
  const [imgSync, setImgSync] = useState({});    // hash -> 'saving'|'saved'|'error'
  const hydratedRef = useRef(false);             // server sets pulled at least once
  const syncTimerRef = useRef(null);
  const syncBusyRef = useRef(false);
  const syncAgainRef = useRef(false);
  const syncDirtyRef = useRef(false);            // unsent change exists
  const imagesLatestRef = useRef(images);
  imagesLatestRef.current = images;
  const removedHashesRef = useRef(new Set());    // explicit ✕ not yet acked by the server
  const firstImagesRenderRef = useRef(true);

  const withHash = (img) => (img._hash ? img : { ...img, _hash: imgHash(img.base64) });

  /** The ONLY path user actions take to change the image set: records every
   *  explicit removal by hash so the server's additive merge can honor the ✕
   *  (anything NOT in `removed` is never dropped, by design). */
  function changeImages(next) {
    setImages(prev => {
      const arr = (typeof next === 'function' ? next(prev) : next).map(withHash);
      const kept = new Set(arr.map(i => i._hash));
      for (const img of prev) {
        const h = img._hash ?? imgHash(img.base64);
        if (!kept.has(h)) removedHashesRef.current.add(h);
      }
      return arr;
    });
  }

  /** Push the current set up (additive merge + explicit removals) and adopt
   *  anything the server holds that this client doesn't. Retries itself. */
  async function runImageSync(attempt = 0) {
    if (!hydratedRef.current) { syncDirtyRef.current = true; return; } // hydration's finally re-runs
    if (syncBusyRef.current) { syncAgainRef.current = true; return; }
    const imgs = imagesLatestRef.current.map(withHash);
    const removed = [...removedHashesRef.current];
    if (!imgs.length && !removed.length) { syncDirtyRef.current = false; return; }
    syncBusyRef.current = true;
    setImgSync(s => {
      const n = { ...s };
      for (const i of imgs) if (n[i._hash] !== 'saved') n[i._hash] = 'saving';
      return n;
    });
    let failed = false;
    try {
      const r = await fetch('/api/jarvis/sheet-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: draftIdRef.current,
          images: imgs.map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
          removed,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) throw new Error(d?.error ?? `Image save failed (${r.status})`);
      for (const h of (Array.isArray(d.removedAck) ? d.removedAck : removed)) {
        removedHashesRef.current.delete(h);
      }
      // Adopt server extras (another tab, an absorbed twin's set) — but never
      // re-adopt an image whose removal is still in flight (✕ then a quick
      // second change used to resurrect the removed thumbnail).
      const serverImages = (Array.isArray(d.images) ? d.images : []).map(withHash);
      setImages(local => {
        const have = new Set(local.map(i => i._hash ?? imgHash(i.base64)));
        const missing = serverImages.filter(i => !have.has(i._hash) && !removedHashesRef.current.has(i._hash));
        if (!missing.length) return local;
        return [...local, ...missing.map(img => ({
          ...img, previewUrl: `data:${img.mediaType};base64,${img.base64}`,
        }))];
      });
      const savedHashes = Array.isArray(d.hashes) && d.hashes.length
        ? d.hashes : serverImages.map(i => i._hash);
      setImgSync(Object.fromEntries(savedHashes.map(h => [h, 'saved'])));
      syncDirtyRef.current = false;
    } catch {
      failed = true;
    }
    syncBusyRef.current = false;
    if (failed) {
      setImgSync(s => {
        const n = { ...s };
        for (const i of imgs) if (n[i._hash] !== 'saved') n[i._hash] = 'error';
        return n;
      });
      if (attempt < 4) setTimeout(() => runImageSync(attempt + 1), 1500 * (attempt + 1));
      return;
    }
    if (syncAgainRef.current) { syncAgainRef.current = false; runImageSync(); }
  }
  const runImageSyncRef = useRef(runImageSync);
  runImageSyncRef.current = runImageSync;

  // Any image change → sync soon. The timer deliberately has NO cleanup —
  // it must survive re-renders AND unmount (a page flip right after a paste
  // used to cancel the upload; now it fires anyway).
  useEffect(() => {
    if (firstImagesRenderRef.current) { firstImagesRenderRef.current = false; return; }
    syncDirtyRef.current = true;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => runImageSyncRef.current(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);
  // Unmount = FLUSH, never cancel: anything unsent goes up immediately.
  useEffect(() => () => {
    if (syncDirtyRef.current || removedHashesRef.current.size) {
      clearTimeout(syncTimerRef.current);
      runImageSyncRef.current();
    }
  }, []);

  /** Pull the server's image sets for a draft (plus every absorbed twin's),
   *  union anything localStorage dropped, then push the merged set back up
   *  so THIS draft's server file becomes the complete authoritative copy. */
  function hydrateImages(draftId) {
    const ids = [...new Set([draftId, ...absorbedIdsRef.current])];
    Promise.all(ids.map(id =>
      fetch(`/api/jarvis/sheet-images?draftId=${encodeURIComponent(id)}`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)))
      .then(results => {
        const server = results
          .flatMap(d => (Array.isArray(d?.images) ? d.images : []))
          .filter(i => i && typeof i.base64 === 'string' && i.base64)
          .map(withHash);
        if (server.length) {
          setImgSync(s => ({ ...s, ...Object.fromEntries(server.map(i => [i._hash, 'saved'])) }));
          setImages(local => {
            const have = new Set(local.map(i => i._hash ?? imgHash(i.base64)));
            const seen = new Set();
            const missing = server.filter(i => {
              if (have.has(i._hash) || seen.has(i._hash) || removedHashesRef.current.has(i._hash)) return false;
              seen.add(i._hash);
              return true;
            });
            if (!missing.length) return local;
            setDraftImagesDropped(0); // they're back
            return [
              ...missing.map(img => ({ ...img, previewUrl: `data:${img.mediaType};base64,${img.base64}` })),
              ...local,
            ];
          });
        }
      })
      .finally(() => {
        hydratedRef.current = true;
        // One consolidating up-sync: uploads a pre-hydration paste, merges
        // absorbed twins' images into this draft's file, marks everything ✓.
        runImageSyncRef.current();
      });
  }
  useEffect(() => { hydrateImages(draftIdRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function clearDraft() {
    deleteDraft(draftKey, draftIdRef.current);
    fetch(`/api/jarvis/sheet-images?draftId=${encodeURIComponent(draftIdRef.current)}`, { method: 'DELETE' })
      .catch(() => { /* best effort */ });
  }

  function handleDiscardDraft() {
    if (!window.confirm('Discard this draft? The explanation, summary and pictures will be deleted.')) return;
    clearDraft();
    setLinkedSmId(null);
    draftIdRef.current = newDraftId();
    absorbedIdsRef.current = [];
    removedHashesRef.current = new Set();
    setImgSync({});
    setName(''); setDescription(''); setImages([]);
    setSummary(null); setJarvisCoverage(null); setQuestions([]); setChanges('');
    setNonStandardFlags([]); setDirty(false); baselineRef.current = null;
    setPurpose(''); setExpectedSms(''); setAgreedNeeds(new Set());
    setSheetAhead(false); setApplyReceipt(null); setLocalCascade(null);
    setSmProposal(null); setProposeRun(null);
    setDeviceAssignments({}); setStationAccepted(null);
    setExplLayers([]); setExplAddingLayer(false); setExplLayerDraft('');
    setQaRounds(0); setQaHistory([]); setLearnedNotes([]);
    setSummarizeCost(0); setError(null); setDraftImagesDropped(0);
    setOtherDrafts(loadDrafts(draftKey).filter(d => d.draftId !== draftIdRef.current && (!d.smId || !smExists(d.smId))));
    setPhase('input');
  }

  /** Explicit resume of an unfinished draft (banner chip / StationsPanel). */
  function resumeDraft(d) {
    draftIdRef.current = d.draftId;
    setLinkedSmId(smExists(d.smId) ? d.smId : null);
    setLocalCascade(d.cascadeLocal ?? null);
    setSmProposal(d.smProposal ?? null);
    setDeviceAssignments(d.deviceAssignments ?? {});
    setProposeRun(null);
    autoKickRef.current = false; // a resumed draft auto-runs too (Dan)
    const s = isStructuredSummary(d.summary)
      ? withSheetPrefill(hydrateSummaryFromSm(d.summary, d.smId ? sms.find(x => x.id === d.smId) : null))
      : null;
    setName(d.name ?? '');
    if (d.station) setStation(String(d.station));
    setDescription(d.description ?? '');
    setImages((d.images ?? []).map(img => ({
      ...img,
      _hash: img._hash ?? imgHash(img.base64),
      previewUrl: `data:${img.mediaType};base64,${img.base64}`,
    })));
    absorbedIdsRef.current = d.absorbedDraftIds ?? [];
    removedHashesRef.current = new Set();
    setImgSync({});
    setSummary(s);
    baselineRef.current = s;
    setDirty(false);
    setJarvisCoverage(normCoverage(d.jarvisCoverage ?? null));
    setQuestions(d.questions ?? []);
    setNonStandardFlags(d.nonStandardFlags ?? []);
    setSummarizeCost(Number(d.summarizeCost) || 0);
    setPurpose(d.purpose ?? (d.smId ? sms.find(x => x.id === d.smId)?.machineSpec?.purpose : '') ?? '');
    setExpectedSms(d.expectedSms ?? (d.smId ? sms.find(x => x.id === d.smId)?.machineSpec?.expectedStateMachines : '') ?? '');
    setGenLevel(d.genLevel ?? (d.smId ? sms.find(x => x.id === d.smId)?.machineSpec?.generationPreset : null) ?? 'standard');
    setReferenceText(d.referenceText
      ?? (d.smId ? referenceJobsText(sms.find(x => x.id === d.smId)?.machineSpec?.referenceJobs) : '')
      ?? '');
    setAgreedNeeds(new Set(d.agreedNeeds ?? []));
    setSheetAhead(d.sheetAhead === true);
    setApplyReceipt(null);
    hydratedRef.current = false;
    hydrateImages(d.draftId);
    setQaRounds(0); setQaHistory([]); setChanges(''); setError(null);
    setLearnedNotes([]); setDraftImagesDropped(0);
    // THE CONVERSATION SURVIVES RESUME (Finger-2 P0 follow-on, 2026-08-28):
    // this setter was missing — the persist effect then saved [] over the
    // stored thread, silently WIPING the draft's chat history on resume.
    setChatThread(Array.isArray(d.chatThread) ? d.chatThread : []);
    setStationAccepted(d.stationAccepted ?? null);
    setControlsNotes(Array.isArray(d.controlsNotes) ? d.controlsNotes : []);
    setExplLayers(Array.isArray(d.explanationLayers) ? d.explanationLayers : []);
    setExplAddingLayer(false); setExplLayerDraft('');
    reconciledDraftRef.current = null; // re-run the load reconcile for this draft
    setOtherDrafts(loadDrafts(draftKey).filter(x => x.draftId !== d.draftId && (!x.smId || !smExists(x.smId))));
    setPhase(d.phase === 'summary' && s ? 'summary' : 'input');
  }

  // ── Gating ───────────────────────────────────────────────────────────────
  const applicable = COVERAGE_ITEMS.filter(i => !(i.optionalWhenAlone && !hasPeers));
  // Once a Jarvis summary exists AND we're in the summary phase, Jarvis's
  // covered/needs verdicts replace the local heuristics. Heuristics keep
  // running for the live-typing (input) phase.
  const usingJarvisVerdicts = phase === 'summary' && !!jarvisCoverage;
  /** A need the ME already agreed to is settled — Jarvis's proposal stands. */
  const needKey = (covKey, n) => `${covKey}:${n.question}`;
  const openNeedsOf = (covKey) =>
    (jarvisCoverage?.[covKey]?.needs ?? []).filter(n => !agreedNeeds.has(needKey(covKey, n)));
  const sectionSettled = (covKey) =>
    !!jarvisCoverage?.[covKey] && (jarvisCoverage[covKey].covered || openNeedsOf(covKey).length === 0);
  const effScores = usingJarvisVerdicts
    ? Object.fromEntries(COVERAGE_ITEMS.map(i => [i.key, sectionSettled(i.key) ? 2 : 1]))
    : coverage.scores;
  const effMessages = usingJarvisVerdicts
    ? Object.fromEntries(COVERAGE_ITEMS.map(i => {
      const open = openNeedsOf(i.key);
      return [i.key, open.length ? `${open.length} need${open.length === 1 ? '' : 's'} listed on the section` : undefined];
    }))
    : coverage.messages;
  const covered = applicable.filter(i => effScores[i.key] === 2).length;
  const allCovered = covered === applicable.length;
  // All still-open needs across sections, split by whether they genuinely
  // block code generation (strip) or just want a confirm (section chips).
  const allOpenNeeds = usingJarvisVerdicts
    ? COVERAGE_ITEMS.flatMap(i => openNeedsOf(i.key).map(n => ({ ...n, covKey: i.key })))
    : [];
  // THE THREE SHAPES (Dan, 2026-08-25): a "blocking" need that isn't actually
  // a question renders as a quiet NOTE (✓-agree, never counted, never red) —
  // classified HERE, independent of the pipeline's own categorization.
  const blockingNeeds = allOpenNeeds.filter(n => n.blocking && isRealQuestion(n.question));
  const blockingNoteNeeds = allOpenNeeds.filter(n => n.blocking && !isRealQuestion(n.question));
  // (advisory needs render as section chips — no separate count needed)

  /** BLOCKERS CREATE THEIR FIELDS (Dan: "vacuum off release timer — where
   *  would I even put that?"): a value-ask naming a device gets an inline
   *  field right on the blocker; saving persists it to that device. */
  function valueFieldForNeed(need) {
    const q = String(need.question ?? '');
    if (!/\b(timer|delay|time(?:out)?|ms|milliseconds?|seconds?)\b/i.test(q)) return null;
    const qn = normKey(q);
    let hit = null;
    (summary?.devices ?? []).forEach((d, i) => {
      const k = normKey(d?.name ?? '');
      if (k && k.length >= 4 && qn.includes(k) && (!hit || k.length > hit.k.length)) hit = { d, i, k };
    });
    if (!hit) return null;
    const label = q.length > 60 ? `${q.slice(0, 57)}…` : q;
    return {
      deviceLabel: hit.d.name,
      unit: 'ms',
      placeholder: 'ms',
      onApply: (num) => {
        // The field lands on the device (rides the sheet into every next
        // round) and the blocker clears — recorded, never re-asked.
        const dev = summary?.devices?.[hit.i];
        const l = q.toLowerCase();
        const secs = /\b(seconds?|secs?)\b/.test(l) && num < 100; // ME said seconds
        const ms = secs ? Math.round(num * 1000) : num;
        const isGripper = sheetType(dev) === 'PneumaticGripper';
        const retractish = /(retract|return|off\b|release|disengage|open|vent)/.test(l);
        const extendish = /(extend|advance|on\b|engage|close|grip|clamp)/.test(l);
        if (PNEUMATIC_SHEET_TYPES.includes(sheetType(dev)) && (retractish || extendish)) {
          const delays = { ...(dev.delays ?? {}) };
          if (retractish) delays.retractMs = ms; else delays.extendMs = ms;
          updateSheetDevice(hit.i, { delays });
        } else {
          updateSheetDevice(hit.i, {
            timers: [...(dev.timers ?? []).filter(t => normKey(t?.name) !== normKey(label)), { name: q, ms }],
          });
        }
        setAgreedNeeds(s => new Set([...s, needKey(need.covKey, need)]));
        setQaHistory(h => [...h, { questions: [need.question], answer: `${ms} ms — set on the ${dev.name} device.` }]);
        setChatThread(t => [...t, {
          role: 'me',
          text: `${need.question}\n→ ${ms} ms — saved onto ${dev.name}`,
          questions: [need.question], at: Date.now(),
        }]);
        if (linkedSmId) appendChangeLog(linkedSmId, { what: `${dev.name}: ${q} = ${ms} ms`, class: 'value' });
      },
    };
  }

  /** "✓ Agree" on a need: free, local — record it as answered so no future
   *  re-summarize re-asks it; Jarvis's proposal stands. */
  function agreeNeed(section, need) {
    setAgreedNeeds(s => new Set([...s, needKey(section.covKey, need)]));
    setQaHistory(h => [...h, { questions: [need.question], answer: 'Go with your proposed solution.' }]);
  }

  /** Inline answer on a BLOCKING question (Dan's Magnet Dial round,
   *  2026-08-25: "do I respond to them?" — yes, right there). The box comes
   *  PREFILLED with Jarvis's proposal: an untouched Answer = one-click accept
   *  (free, recorded); typing over = override, sent down the SAME corrections
   *  pipeline as the chat (answer lands in knowledge, blocker clears,
   *  receipt shows what changed). */
  async function answerNeed(need, text) {
    const t = String(text ?? '').trim();
    const proposal = String(need.proposedSolution ?? '').trim();
    // Answered is answered — the blocker clears immediately either way.
    setAgreedNeeds(s => new Set([...s, needKey(need.covKey, need)]));
    if (!t || t === proposal) {
      setQaHistory(h => [...h, { questions: [need.question], answer: 'Go with your proposed solution.' }]);
      setChatThread(th => [...th, {
        role: 'me',
        text: `${need.question}\n→ Go with your proposed solution.`,
        questions: [need.question], at: Date.now(),
      }]);
      return;
    }
    await sendCorrections(
      `Answer to your blocking question "${need.question}": ${t}`
      + '\nFold this answer into the sheet where it applies and leave everything else exactly as it was.',
      `${need.question}\n→ ${t}`,
      [need.question]
    );
  }

  // Purpose + generation level persist on machineSpec (linked sheets:
  // write-through, debounced so typing doesn't spam undo history). The
  // preset writes machineSpec.generationScope — the pipeline's real scope
  // contract — plus generationPreset for round-tripping the chip selection.
  useEffect(() => {
    if (!linkedSmId) return undefined;
    const smNow = store.project?.stateMachines?.find(s => s.id === linkedSmId);
    if (!smNow) return undefined;
    const spec = smNow.machineSpec ?? {};
    if (String(spec.purpose ?? '') === purpose.trim()
      && String(spec.expectedStateMachines ?? '') === expectedSms.trim()
      && String(spec.generationPreset ?? 'standard') === genLevel) return undefined;
    const t = setTimeout(() => {
      const lvl = genLevelOf(genLevel);
      store.updateStateMachine(linkedSmId, {
        machineSpec: {
          ...(smNow.machineSpec ?? { version: 1 }),
          purpose: purpose.trim(),
          // ME's expected SM decomposition (Dan, 2026-08-25) — raw text; the
          // compile weighs it against the asynchrony test.
          expectedStateMachines: expectedSms.trim(),
          ...(controlsNotes.length ? { controlsNotes } : {}),
          generationPreset: genLevel,
          // null clears an earlier preset back to the pipeline default.
          generationScope: lvl.scope ?? null,
        },
      });
      // Understanding-affecting fields move the sheet ahead of the build
      // (Dan, 2026-08-25): Rebuild is the one commit point where Jarvis
      // re-thinks with the new info.
      markSheetAhead();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purpose, genLevel, expectedSms, linkedSmId]);

  const preview = name ? buildProgramName(station || 1, name.replace(/[^a-zA-Z0-9_]/g, '')) : '—';
  // Coverage NEVER blocks the Build (v2.0.3): with real input, Build is always
  // clickable. Thin coverage just adds one confirm — Jarvis fills the gaps with
  // SDC-standard assumptions and flags them for review. Open questions never
  // gate either: Jarvis decides them per SDC standards and notes them.
  const hasBuildInput = !!name.trim()
    && !!(usingJarvisVerdicts ? summaryHasContent(summary) : description.trim());

  // ── Station data sheet state (summary phase) ─────────────────────────────
  // Tabular-data questions never render as prose (Dan): the tables with their
  // empty cells ARE those questions. Only genuinely non-tabular questions
  // (geometry intent, failure behavior, interactions) stay in the block.
  const visibleQuestions = useMemo(() => questions.filter(q => !isTabularQuestion(q)), [questions]);
  const tabularQuestionCount = questions.length - visibleQuestions.length;

  /** Patch one draft device's data-sheet fields (undefined values delete the
   *  key → back to "(default)"). Persisted by the draft autosave; does NOT
   *  raise the Resubmit bar — table values are machine data, not a change to
   *  what Jarvis understood. */
  function updateSheetDevice(idx, patch) {
    setSummary(s => ({
      ...s,
      devices: s.devices.map((d, i) => {
        if (i !== idx) return d;
        const next = { ...d };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete next[k]; else next[k] = v;
        }
        return next;
      }),
    }));
    markSheetAhead(); // a table/config value changed → sheet is ahead of the build
    touchSection('devices'); // an edit re-opens the section's review
    // HOME write-through on linked sheets (same authority path as band rows):
    // the SM device is the value authority, so a declared home lands on it
    // immediately — servo as positions[].isHome (+ homePositionName),
    // pneumatic as the canonical homePosition op value.
    // SERVO VALUE write-through on linked sheets (Dan, Aug 24 — the diagram,
    // the sheet rows, and the station must be ONE live-linked set of values):
    // typing/clearing a position value on the sheet card lands on the SM
    // device immediately. A cleared cell clears the SM value too — otherwise
    // the sheet⇄SM merge resurrects abandoned placeholders on the next open.
    if (linkedSmId && 'positions' in patch) {
      const sheetDev = summary?.devices?.[idx];
      const smNow = store.project?.stateMachines?.find(s => s.id === linkedSmId);
      const smDev = sheetDev && smNow
        ? (findByName(smNow.devices ?? [], sheetDev.name, x => x?.displayName ?? x?.name)
          ?? findByName(smNow.devices ?? [], sheetDev.name))
        : null;
      if (smDev && smDev.type === 'ServoAxis') {
        const byKey = new Map((patch.positions ?? []).filter(p => p?.name).map(p => [normKey(p.name), p]));
        const next = (smDev.positions ?? []).map(p => {
          const sp = byKey.get(normKey(p.name));
          if (!sp) return p;
          byKey.delete(normKey(p.name));
          const raw = sp.valueMm;
          const v = (raw === undefined || raw === null || raw === '') ? null : Number(raw);
          const val = Number.isFinite(v) ? v : null;
          // Sync the legacy `value` field too — a stale `value` left behind
          // resurrects cleared numbers via hydrate's defaultValue ?? value.
          return { ...p, defaultValue: val, ...('value' in p ? { value: val } : {}) };
        });
        for (const [, sp] of byKey) {
          const raw = sp.valueMm;
          const v = (raw === undefined || raw === null || raw === '') ? null : Number(raw);
          next.push({
            id: (crypto.randomUUID ? crypto.randomUUID() : 'pos_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
            name: sp.name,
            defaultValue: Number.isFinite(v) ? v : null,
            moveType: 'Pos', type: 'position', isHome: false, isRecipe: false,
          });
        }
        store.updateDevice(linkedSmId, smDev.id, { positions: next });
      }
    }
    if (linkedSmId && ('homePosition' in patch || 'homeState' in patch)) {
      const sheetDev = summary?.devices?.[idx];
      const smNow = store.project?.stateMachines?.find(s => s.id === linkedSmId);
      const smDev = sheetDev && smNow
        ? (findByName(smNow.devices ?? [], sheetDev.name, x => x?.displayName ?? x?.name)
          ?? findByName(smNow.devices ?? [], sheetDev.name))
        : null;
      if (smDev) {
        if (patch.homeState) {
          store.updateDevice(linkedSmId, smDev.id, { homePosition: patch.homeState });
        }
        if (patch.homePosition && smDev.type === 'ServoAxis') {
          store.updateDevice(linkedSmId, smDev.id, {
            homePositionName: patch.homePosition,
            positions: (smDev.positions ?? []).map(p =>
              ({ ...p, isHome: normKey(p.name) === normKey(patch.homePosition) })),
          });
        }
      }
    }
  }

  /** Edit a device card's header line ("Name — purpose"): empty removes the
   *  device, otherwise name/purpose merge over the rich sheet fields (type,
   *  sensors, positions, speeds survive). Understanding changed → dirty. */
  function commitDeviceHeader(idx, text) {
    const t = String(text).trim();
    const oldName = String(summary?.devices?.[idx]?.name ?? '');
    let newName = null;
    setSummary(s => {
      const devices = s.devices.slice();
      // READ-ONLY OUTPUT: an emptied header is a no-op, never a delete —
      // removing a device is a structural change (tell Jarvis instead).
      if (!t) return s;
      {
        const parsed = linesToSection('devices', t)[0];
        // SDC name style on commit (Dan, Aug 24): XAxis, PartGripper —
        // applies to the edited entry only, never renames untouched devices.
        parsed.name = capDeviceName(parsed.name);
        // RENAME = JUST THE NAME (Dan, 2026-08-27): the header edit carries
        // only the name — a rename must never wipe the stored purpose.
        if (!String(parsed.purpose ?? '').trim()) delete parsed.purpose;
        devices[idx] = { ...devices[idx], ...parsed };
        newName = parsed.name;
      }
      return withSheetPrefill({ ...s, devices });
    });
    setDirty(true);
    markSheetAhead();
    touchSection('devices');
    touchCascade('devices'); // a locked devices step re-opens on content edits
    // RENAME CASCADES (Dan, 2026-08-25: "sometimes I just want to change the
    // wording of device names" — one rename, everywhere consistent). Jarvis's
    // proposed standard names stand at extraction; the ME's rename WINS after.
    if (newName && oldName && newName !== oldName) renameDeviceEverywhere(oldName, newName);
  }

  /** Rename a device BY NAME (the cascade devices step's inline rename —
   *  naming is part of that step's review; Dan, 2026-08-26). Rides the exact
   *  commitDeviceHeader path so the rename cascades everywhere. */
  function renameDeviceByName(oldName, newName) {
    const idx = (summary?.devices ?? []).findIndex(d => normKey(d?.name) === normKey(oldName)
      || normKey(d?.displayName) === normKey(oldName));
    if (idx === -1) { renameDeviceEverywhere(oldName, newName); return; }
    const d = summary.devices[idx];
    commitDeviceHeader(idx, `${newName}${d?.purpose ? ` — ${d.purpose}` : ''}`);
  }

  /** Cascade one device rename: sheet text (sequence / fault recovery lines),
   *  the built SM's device record (displayName + tag base — tagNaming derives
   *  every i_/q_/p_ tag from the name at export), the diagram's node labels,
   *  and the persisted split's deviceNames. One change-log line records it. */
  function renameDeviceEverywhere(oldName, newName) {
    const spacedOld = oldName.replace(/_/g, ' ');
    const camelSpacedOld = oldName.replace(/([a-z0-9])([A-Z])/g, '$1 $2'); // ZSlide → Z Slide
    const patterns = [oldName, spacedOld, camelSpacedOld].filter((v, i, a) => v && a.indexOf(v) === i);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replaceIn = (line) => {
      let out = String(line ?? '');
      for (const pat of patterns) {
        out = out.replace(new RegExp(esc(pat), 'gi'), newName);
      }
      return out;
    };
    // 1. Sheet text: sequence + fault recovery lines that name the device.
    setSummary(s => ({
      ...s,
      sequence: (s.sequence ?? []).map(l => (typeof l === 'string' ? replaceIn(l) : { ...l, text: replaceIn(l?.text) })),
      failureHandling: (s.failureHandling ?? []).map(l => (typeof l === 'string' ? replaceIn(l) : { ...l, text: replaceIn(l?.text) })),
    }));
    // 1a. Persisted assignments follow the rename (key = normalized name).
    setDeviceAssignments(prev => {
      const oldK = normKey(oldName);
      if (!prev || !(oldK in prev)) return prev;
      const next = { ...prev };
      next[normKey(newName)] = next[oldK];
      delete next[oldK];
      return next;
    });
    // 1b. OWNERSHIP SURVIVES RENAMES (Dan's live bug, 2026-08-27: renaming
    // ZSlide made the card vanish — the machine filter matched the OLD name).
    // The draft proposal's ownedDeviceNames update atomically with the rename.
    setSmProposal(p => {
      if (!p?.stateMachines?.length) return p;
      return {
        ...p,
        stateMachines: p.stateMachines.map(m => ({
          ...m,
          ownedDeviceNames: (m.ownedDeviceNames ?? []).map(replaceIn),
          sequence: (m.sequence ?? []).map(replaceIn),
        })),
      };
    });
    if (!linkedSmId) return;
    const smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId);
    if (!smNow) return;
    // 2. The SM device record — tag names regenerate from `name` at export.
    const smDev = findByName(smNow.devices ?? [], oldName, x => x?.displayName ?? x?.name)
      ?? findByName(smNow.devices ?? [], oldName);
    if (smDev) {
      store.updateDevice(linkedSmId, smDev.id, {
        displayName: newName,
        name: newName.replace(/[^A-Za-z0-9_]/g, ''),
      });
    }
    // 3. Diagram node labels that carry the old wording.
    const nodes = (smNow.nodes ?? []).map(n => {
      const label = String(n?.data?.label ?? '');
      const next = replaceIn(label);
      return next !== label ? { ...n, data: { ...n.data, label: next } } : n;
    });
    if (nodes.some((n, i) => n !== (smNow.nodes ?? [])[i])) {
      store.updateStateMachine(linkedSmId, { nodes });
    }
    // 4. The persisted split's owned-device names.
    const fresh = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId);
    const spec = fresh?.machineSpec;
    if (spec && Array.isArray(spec.smSplit) && spec.smSplit.length) {
      const smSplit = spec.smSplit.map(e => (e && typeof e === 'object' ? {
        ...e,
        ...(Array.isArray(e.deviceNames) ? { deviceNames: e.deviceNames.map(replaceIn) } : {}),
        ...(Array.isArray(e.sequence) ? { sequence: e.sequence.map(l => (typeof l === 'string' ? replaceIn(l) : l)) } : {}),
        ...(Array.isArray(e.faultRecovery) ? { faultRecovery: e.faultRecovery.map(l => (typeof l === 'string' ? replaceIn(l) : l)) } : {}),
      } : e));
      store.updateStateMachine(linkedSmId, { machineSpec: { ...spec, smSplit } });
    }
    appendChangeLog(linkedSmId, { what: `renamed ${oldName} → ${newName}`, class: 'rename' });
    showTransientToast(`Renamed ${oldName} → ${newName} — sequence, diagram and tags follow`);
  }

  function removeDevice(idx) {
    setSummary(s => withSheetPrefill({ ...s, devices: s.devices.filter((_, i) => i !== idx) }));
    setDirty(true);
    markSheetAhead();
    touchSection('devices');
    touchCascade('devices');
  }
  function addDevice(text) {
    const t = String(text).trim();
    if (!t) return;
    const added = linesToSection('devices', t)
      .map(d => ({ ...d, name: capDeviceName(d.name) })); // SDC name style on entry
    setSummary(s => withSheetPrefill({ ...s, devices: [...s.devices, ...added] }));
    setDirty(true);
    markSheetAhead();
    touchSection('devices');
    touchCascade('devices');
  }

  // ── Derived servo points (blend/wideband anchors) on the SHEET ───────────
  // NO INVISIBLE POSITIONS: every servo point the compiled code uses shows as
  // a visible row in its axis card. Rows the code needs but the table lacks a
  // value for render as amber "proposed" rows; committing writes a real named
  // position on the SM device AND onto the sheet card.
  const linkedSm = linkedSmId ? sms.find(s => s.id === linkedSmId) : null;

  // Per-field save ticks (Dan, 2026-08-25) — structures stringified so array
  // identity churn can't fake an edit.
  const expectedSmsTick = useSaveTick(expectedSms, savedPulse);
  const purposeTick = useSaveTick(`${purpose}|${genLevel}`, savedPulse);
  const referenceTick = useSaveTick(referenceText, savedPulse);
  const interactionsTick = useSaveTick(
    JSON.stringify(summary?.interactions ?? []), savedPulse);

  // SM-AWARE SHEET (Dan, 2026-08-25): the station's known SM decomposition
  // (applied split / compiled multi-SM) or null → render exactly as today.
  // ONE SHEET PER STATION (Dan's structural ruling, 2026-08-25): a station can
  // hold several state machines. When it does, those SM RECORDS are the
  // decomposition — no approval gate, they already exist — and the sheet
  // breaks devices/sequences out per machine off them.
  const stationSms = stationSmsOf(store.project, linkedSm);
  const stationDecomp = useMemo(
    () => stationSmDecompositionOf(stationSms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.project, linkedSmId]
  );
  const proposedDecomp = useMemo(
    () => smDecompositionOf(linkedSm, summary?.devices ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkedSm, summary]
  );
  const smDecomp = stationDecomp ?? proposedDecomp;
  // APPROVAL ARTIFACT (Dan, 2026-08-25): only the APPROVED split is the
  // authority for grouping / diagrams / codegen; a mere proposal renders in
  // the State Machines section for Approve. Real station SMs bypass it.
  const smApproval = smSplitApprovalOf(linkedSm);
  const approvedSmDecomp = stationDecomp ?? (smApproval?.approved ? proposedDecomp : null);
  // The ME's expected pills — extraction-distilled (never the raw paragraph).
  const expectedSmPills = summary?.expectedStateMachines
    ?? linkedSm?.machineSpec?.expectedSmPills ?? [];
  // Jarvis's agree/counter one-liner: the compile's reviewFlag naming the
  // expectation difference (per the asynchrony-test rule). Graceful absent.
  const smSplitReasoning = useMemo(() => {
    const flags = linkedSm?.compiledSequence?.ir?.reviewFlags ?? [];
    return flags.map(String).find(f => /expect/i.test(f)) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSm]);

  // ── ONE TRUTH for the SM PANEL (Dan's three-truths screenshot, 2026-08-25:
  // header said 2 approved, prose claimed 4, pills said 4 — never again).
  // The panel displays exactly ONE versioned source: the NEWEST proposal
  // supersedes an older approval for DISPLAY (the old approval lives in the
  // change log); cards, count and prose all come from that same source. ─────
  const panelModel = useMemo(() => {
    const splitD = splitDecompositionOf(linkedSm, summary?.devices ?? null);
    const compiledD = compiledDecompositionOf(linkedSm);
    const compiledAtMs = Date.parse(String(linkedSm?.compiledSequence?.compiledAt ?? '')) || 0;
    const splitAtMs = Date.parse(String(linkedSm?.machineSpec?.smSplitAppliedAt
      ?? linkedSm?.machineSpec?.smSplitApproval?.at ?? '')) || 0;
    const useCompiled = !!compiledD && (!splitD || compiledAtMs > splitAtMs);
    const decomp = useCompiled ? compiledD : (splitD ?? stationDecomp);
    if (!decomp?.length) return { decomp: null };
    // Reasoning ONLY from the same source (the compile's flag) — a split
    // display never borrows a different compile's prose.
    const reasoning = useCompiled ? smSplitReasoning : null;
    // Consistency guard: the reasoning's own machine count must match the
    // payload it rode in with (the root-cause bug: prose said four, list had 2).
    let inconsistent = null;
    // The compile route's own guard flags a persistent mismatch explicitly.
    const serverFlag = linkedSm?.compiledSequence?.ir?.inconsistentDecomposition;
    if (useCompiled && serverFlag?.claimed) {
      inconsistent = { claimed: serverFlag.claimed, actual: serverFlag.actual ?? decomp.length };
    }
    if (useCompiled && !inconsistent && reasoning) {
      const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const m = reasoning.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:state\s*machines?|programs?|machines?)\b/i);
      const claimed = m ? (Number(m[1]) || WORDS[m[1].toLowerCase()] || 0) : 0;
      if (claimed >= 2 && claimed !== decomp.length) inconsistent = { claimed, actual: decomp.length };
    }
    const logged = localChangeLogOf(linkedSm).filter(e => /^Decomposition v\d+ approved/.test(e.what)).length;
    // A pre-changelog approval (Magnet Dial's) still counts as one version.
    const priorApprovals = logged > 0 ? logged : (smApproval?.approved ? 1 : 0);
    return {
      decomp,
      useCompiled,
      reasoning,
      inconsistent,
      // The displayed proposal's version: one past the recorded approvals.
      versionLabel: useCompiled ? `Proposal v${priorApprovals + 1}` : null,
      awaitingApproval: useCompiled,
      // Approved stamp ONLY when the displayed decomposition IS the approved one.
      approvedStamp: !useCompiled && smApproval?.approved === true,
      supersededNote: useCompiled && smApproval?.approved
        ? `supersedes the approved split of ${smApproval.at ? new Date(smApproval.at).toLocaleDateString() : 'earlier'} — recorded in the change log`
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSm, summary, stationDecomp, smApproval, smSplitReasoning]);

  /** THE ME'S COUNT, from whatever he actually said (Dan expected ~4 and got
   *  2 — the sheet must state the disagreement, not hide it). Pills win; the
   *  fallback is a rough read of the dictation: each "state machine" mentioned,
   *  plus the robot when he counted it in without the words. */
  const expectedSmCount = useMemo(() => {
    if ((expectedSmPills?.length ?? 0) > 0) return expectedSmPills.length;
    const raw = String(expectedSms ?? '').trim()
      || String(linkedSm?.machineSpec?.expectedStateMachines ?? '').trim();
    if (!raw) return 0;
    const mentions = (raw.match(/state\s?machines?\b/gi) ?? []).length;
    if (!mentions) return 0;
    const robotCounted = /\brobot\b/i.test(raw)
      && !/\brobot\b[^.]{0,40}state\s?machine/i.test(raw);
    return mentions + (robotCounted ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedSmPills, expectedSms, linkedSm]);

  /** "No — I want the dial indexer separate; shuttle and pick split."
   *  The counter rides the SAME agentic corrections path as every other
   *  correction and comes back as a RE-PROPOSAL (never a client-side merge). */
  async function sendSmSplitCounter(text) {
    const t = String(text ?? '').trim();
    if (!t) return false;
    const framed =
      'Correction to the STATE MACHINE decomposition. The engineer disagrees with '
      + `the proposed split (Jarvis proposed ${smDecomp?.length ?? 0}: `
      + `${(smDecomp ?? []).map(e => e.name).join(', ')}). He wants:\n${t}\n`
      + 'Re-propose the state machines accordingly — name each machine, the devices it '
      + 'owns, its sequence, and ONE line saying why it must run asynchronously from '
      + 'the others. Leave every other section of the sheet exactly as it was.';
    // Returns false on failure so the counter box KEEPS the ME's words
    // (the vanished-on-Send fix, 2026-08-25).
    return sendCorrections(framed, t, []);
  }

  /** Approve the decomposition: persist machineSpec.smSplitApproval (a
   *  SIBLING key of smSplit — JSON drops properties set on arrays) and
   *  materialize smSplit from the compiled proposal when the split agent
   *  hasn't persisted one yet. Approved = THE authority. */
  function approveSmSplit() {
    assignGateRef.current = true; // gate: machines exist → place the devices
    // Approve WHAT'S DISPLAYED — the panel's ONE-truth source (never a stale
    // smSplit hijacking the approval of the fresh proposal).
    const displayed = panelModel.decomp ?? smDecomp;
    if (!linkedSmId || !(displayed?.length) || panelModel.inconsistent) return;
    const smNow = store.project?.stateMachines?.find(x => x.id === linkedSmId);
    if (!smNow) return;
    const spec = smNow.machineSpec ?? { version: 1 };
    // The split materializes from the displayed decomposition — including each
    // machine's own recovery sequence, so the sheet reorganizes IMMEDIATELY
    // with per-SM sequences + per-SM recovery columns.
    const split = displayed.map(e => ({
      name: e.name, oneLiner: e.oneLiner, deviceNames: e.deviceNames,
      sequence: e.sequence,
      ...(e.faultRecovery?.length ? { faultRecovery: e.faultRecovery } : {}),
      // THE WALK IS THE SPEC (2026-08-31): structured steps carry verbatim.
      ...(e.sequenceSteps ? { sequenceSteps: e.sequenceSteps } : {}),
      ...(e.faultRecoverySteps ? { faultRecoverySteps: e.faultRecoverySteps } : {}),
      ...(e.why ? { why: e.why } : {}),
      ...(e.handshakes?.length ? { handshakes: e.handshakes } : {}),
    }));
    store.updateStateMachine(linkedSmId, {
      machineSpec: {
        ...spec,
        smSplit: split,
        smSplitAppliedAt: new Date().toISOString(),
        smSplitApproval: { approved: true, by: 'ME', at: new Date().toISOString() },
      },
    });
    // The approval is a version-control event: "Decomposition vN approved".
    const logged = localChangeLogOf(smNow).filter(e => /^Decomposition v\d+ approved/.test(e.what)).length;
    const version = 1 + (logged > 0 ? logged : (smApproval?.approved ? 1 : 0));
    appendChangeLog(linkedSmId, {
      what: `Decomposition v${version} approved — ${displayed.length} state machines`,
      class: 'approval',
    });
    setSectionReviewed('stateMachines', true);
  }

  /** Re-propose the decomposition: the compile modal opens PRE-FILLED at its
   *  confirm step (explicit Start — a compile costs real money). Triggered by
   *  the inconsistency guard and available on the error card. */
  function reproposeSmSplit(note) {
    if (!linkedSmId) return;
    useV2Shell.getState().openCompile(linkedSmId,
      String(note ?? '').trim()
      || 'Your previous proposal was internally inconsistent (the reasoning and the stateMachines list disagreed on the machine count). Re-propose the state machine decomposition consistently — the reasoning, the machine list and the count must agree.');
  }

  // AUTO RE-PROPOSE on an inconsistent proposal — once per compile output
  // (sessionStorage guard), lands on the compile modal's explicit-start step.
  useEffect(() => {
    if (!panelModel.inconsistent || !linkedSmId) return;
    const key = `sdc-repropose-${linkedSmId}-${linkedSm?.compiledSequence?.compiledAt ?? ''}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* storage unavailable — still show the manual button */ return; }
    reproposeSmSplit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelModel.inconsistent, linkedSmId]);

  /** Inline rename on a split entry — the edit RE-OPENS approval (Jarvis
   *  tweaks -> re-approve). Move/merge/split goes through the corrections
   *  chat (the agentic path), never client-side merge rules. */
  function renameSmSplitEntry(entry, newName) {
    if (!linkedSmId) return;
    const smNow = store.project?.stateMachines?.find(x => x.id === linkedSmId);
    if (!smNow) return;
    const spec = smNow.machineSpec ?? { version: 1 };
    const base = (Array.isArray(spec.smSplit) && spec.smSplit.length)
      ? spec.smSplit
      : (smDecomp ?? []).map(e => ({
        name: e.name, oneLiner: e.oneLiner, deviceNames: e.deviceNames,
        sequence: e.sequence,
        ...(e.handshakes?.length ? { handshakes: e.handshakes } : {}),
      }));
    const split = base.map(x =>
      normKey(x?.name ?? x?.programName) === entry.key ? { ...x, name: newName } : x);
    store.updateStateMachine(linkedSmId, {
      machineSpec: {
        ...spec,
        smSplit: split,
        smSplitApproval: { approved: false, by: '', at: '' },
      },
    });
    markSheetAhead();
    setSectionReviewed('stateMachines', false); // any edit re-opens approval
    appendChangeLog(linkedSmId, { what: `renamed state machine ${entry.name} → ${newName}`, class: 'rename' });
  }

  const derivedBandRows = useMemo(() => {
    if (!linkedSm) return [];
    const out = [];
    const seen = new Set();
    for (const r of [
      ...requiredServoRowsOf(linkedSm).filter(r => r.kind === 'band'),
      ...mapVerifyFlagsToServoRows(linkedSm).filter(r => !r.unmapped && !r.resolved),
    ]) {
      const k = `${r.deviceId}:${String(r.rowName).toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSm]);
  const normId = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const bandRowsFor = (sheetDev) => derivedBandRows.filter(r => {
    if (normId(r.deviceName) !== normId(sheetDev.name)) return false;
    // Already a sheet row (answered or not)? Then THAT row owns the ask —
    // an empty sheet row is the red "you set this" cell; a second derived
    // row for the same point is exactly the redundant-row defect (Dan).
    const p = (sheetDev.positions ?? []).find(x => normId(x.name) === normId(r.rowName));
    return !p;
  });
  // Past-job reference text persists on machineSpec.referenceJobs (linked
  // sheets: debounced write-through, same pattern as purpose). ONE {text}
  // entry holds the whole free-text line.
  useEffect(() => {
    if (!linkedSmId) return undefined;
    const smNow = store.project?.stateMachines?.find(s => s.id === linkedSmId);
    if (!smNow) return undefined;
    const current = referenceJobsText(smNow.machineSpec?.referenceJobs);
    if (current === referenceText.trim()) return undefined;
    const t = setTimeout(() => {
      store.updateStateMachine(linkedSmId, {
        machineSpec: {
          ...(smNow.machineSpec ?? { version: 1 }),
          referenceJobs: referenceText.trim() ? [{ text: referenceText.trim(), at: Date.now() }] : [],
        },
      });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceText, linkedSmId]);

  function commitBandRow(row, v) {
    const num = Number(v);
    if (v == null || v === '' || !Number.isFinite(num)) return;
    // 1. Real persistence on the SM device (same path as ServoValuesTable).
    const smNow = store.project?.stateMachines?.find(s => s.id === linkedSmId);
    const dev = smNow?.devices?.find(d => d.id === row.deviceId);
    if (dev) {
      const positions = dev.positions ?? [];
      const i = positions.findIndex(p => normId(p.name) === normId(row.rowName));
      const next = i !== -1
        ? positions.map((p, j) => (j === i ? { ...p, defaultValue: num, value: num } : p))
        : [...positions, {
          id: (crypto.randomUUID ? crypto.randomUUID() : 'pos_' + Date.now().toString(36)),
          name: row.rowName, defaultValue: num, value: num,
          moveType: 'Pos', type: 'position', isHome: false, isRecipe: false,
        }];
      store.updateDevice(linkedSmId, dev.id, { positions: next });
    }
    // 2. Mirror onto the sheet card as a visible named row.
    setSummary(s => ({
      ...s,
      devices: (s.devices ?? []).map(d => {
        if (normId(d.name) !== normId(row.deviceName)) return d;
        const ps = (d.positions ?? []).slice();
        const i = ps.findIndex(p => normId(p.name) === normId(row.rowName));
        if (i !== -1) ps[i] = { ...ps[i], valueMm: num };
        else ps.push({ name: row.rowName, valueMm: num });
        return { ...d, positions: ps };
      }),
    }));
    markSheetAhead();
  }

  // ── Machine-aware interactions (Dan, Aug 24) ─────────────────────────────
  // Chips of the project's OTHER stations toggle an interaction entry; each
  // selected station gets a talk-through box explaining the interaction.
  const normStation = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const interactionFor = (nm) =>
    (summary?.interactions ?? []).findIndex(x => normStation(x.station) === normStation(nm));
  function toggleInteractionStation(nm) {
    const idx = interactionFor(nm);
    setSummary(s => {
      const list = (s.interactions ?? []).slice();
      if (idx === -1) list.push({ station: nm, how: '' });
      else list.splice(idx, 1);
      return { ...s, interactions: list };
    });
    setDirty(true);
    markSheetAhead();
    touchCascade('interactions');
  }
  function updateInteraction(i, patch) {
    setSummary(s => ({
      ...s,
      interactions: (s.interactions ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)),
    }));
    setDirty(true);
    markSheetAhead();
    touchCascade('interactions');
  }
  function removeInteraction(i) {
    setSummary(s => ({ ...s, interactions: (s.interactions ?? []).filter((_, j) => j !== i) }));
    setDirty(true);
    markSheetAhead();
    touchCascade('interactions');
  }
  // Interactions persist on machineSpec.relationships (linked sheets:
  // debounced write-through, same pattern as purpose).
  useEffect(() => {
    if (!linkedSmId || !summary) return undefined;
    const t = setTimeout(() => {
      const smNow = store.project?.stateMachines?.find(s => s.id === linkedSmId);
      if (!smNow) return;
      const rels = (summary.interactions ?? [])
        .filter(x => String(x.station ?? '').trim() || String(x.how ?? '').trim())
        .map(x => ({ withSmName: String(x.station ?? '').trim(), detail: String(x.how ?? '').trim() }));
      const cur = (smNow.machineSpec?.relationships ?? [])
        .map(r => ({ withSmName: String(r.withSmName ?? r.station ?? '').trim(), detail: String(r.detail ?? r.how ?? '').trim() }));
      if (JSON.stringify(cur) === JSON.stringify(rels)) return;
      store.updateStateMachine(linkedSmId, {
        machineSpec: { ...(smNow.machineSpec ?? { version: 1 }), relationships: rels },
      });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.interactions, linkedSmId]);

  /** Everything that still blocks a Build on the DATA SHEET, in Dan-plain
   *  words. Each entry is clickable — it takes you to the thing to fix. */
  function sheetBlockers() {
    const list = [];
    if (!name.trim()) list.push({ key: 'name', label: 'Name your station' });
    if (!summaryHasContent(summary)) list.push({ key: 'description', label: 'Describe the station first' });
    (summary?.devices ?? []).forEach((d, i) => {
      if (!isServoSheet(d)) return;
      // ROTARY DIAL: the ask is the fixture count, never a position list.
      if (isRotarySheetAxis(d)) {
        if (fixturesMissing(d)) {
          list.push({
            key: `servo-${i}`,
            label: `${d.name}: how many fixtures (nests) around the dial?`,
            target: `sheet-servo-${i}`,
          });
        }
        const miss = (d.positions ?? []).filter(p => !isIndexRowName(p?.name)).filter(posValueMissing);
        if (miss.length) {
          list.push({
            key: `servo-vals-${i}`,
            label: `${d.name}: ${miss.length} value${miss.length === 1 ? '' : 's'} needed (°)`,
            target: `sheet-servo-${i}`,
          });
        }
        return;
      }
      const ps = d.positions ?? [];
      if (ps.length === 0) {
        list.push({ key: `servo-${i}`, label: `List the ${d.name} positions`, target: `sheet-servo-${i}` });
      } else {
        const miss = ps.filter(posValueMissing);
        if (miss.length) {
          list.push({
            key: `servo-${i}`,
            label: `${d.name}: ${miss.length} position value${miss.length === 1 ? '' : 's'} needed`,
            target: `sheet-servo-${i}`,
          });
        }
      }
    });
    return list;
  }
  /** Take the user to a blocker's fix — focus the field or scroll to the
   *  table and flash it. Never a dead end. */
  function goToBlocker(b) {
    if (b.key === 'name') {
      setNameAttention(true);
      nameRef.current?.focus();
      return;
    }
    if (b.key === 'description') { focusDescription(); return; }
    if (b.target) {
      const el = document.querySelector(`[data-testid="${b.target}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.4s ease';
        el.style.boxShadow = `0 0 0 3px ${C.primaryBg}, 0 0 10px 2px ${C.primaryBorder}`;
        setTimeout(() => { el.style.boxShadow = 'none'; }, 1600);
      }
    }
  }

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
  // Plain words, no env-var speak to the engineer (Dan, 2026-08-30).
  const budgetMessage = `This station's AI planning budget ($${summarizeCostCap.toFixed(2)}) is used up — the ceiling is adjustable in the server settings`;

  // ── Summarize loop (streams real progress) ───────────────────────────────
  // SPLIT in two (Review & Edit mode, Dan 2026-08-25): requestSummarize runs
  // the model and returns the result WITHOUT touching the sheet — the scoped
  // section edits render it as a PROPOSED diff first; commitSummarizeResult
  // is the one place a returned sheet actually lands (approve = commit).
  async function requestSummarize({ priorSummary = '', corrections = '' } = {}) {
    setSumPct(0);
    setSumStage('sent');
    // AGENTIC corrections (Dan, Aug 24: "corrections inside the app have to
    // be an agentic layer"): a corrections round sends Jarvis the COMPLETE
    // current sheet state and trusts the returned sheet as the merge — no
    // client-side keep-rules fighting the model (the double-gripper
    // resurrection). The prompt carries the standing laws as guidance.
    const agentic = !!String(corrections).trim() && isStructuredSummary(summary);
    const data = await summarizeRequest({
      description: description.trim(),
      images: images.filter(i => String(i.mediaType || '').startsWith('image/')).map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
      checklist: coverage.scores,
      sm: {
        name: name.trim().replace(/\s+/g, ''), displayName: name.trim() || 'New Station',
        // Deviation handshake: already-approved deviations ride along so
        // Jarvis honors them silently and never re-asks.
        approvedDeviations: (linkedSmId
          ? store.project?.stateMachines?.find(x => x.id === linkedSmId)?.machineSpec?.approvedDeviations
          : null) ?? [],
      },
      otherSms: otherSms.map(s => ({ name: s.name, displayName: s.displayName ?? s.name })),
      priorSummary,
      // Complete structured sheet — serialized into priorSummary too so an
      // un-restarted older server still sees every value verbatim.
      ...(agentic ? { sheetState: summary, priorSummary: JSON.stringify(summary, null, 1) } : {}),
      corrections,
      round: qaRounds,
      qaHistory,
      priorCoverage: jarvisCoverage,
      // FULL CONTEXT ON EVERY CHAT TURN (Dan, 2026-08-28): the chat is the
      // SAME engine as the build — it sees the conversation, where he is in
      // the cascade, and the recent actions.
      chatHistory: chatThread.slice(-20).map(t => ({ role: t.role, text: String(t.text ?? '').slice(0, 300) })),
      cascadePosition: cascade.activeStep ? {
        activeLabel: cascade.activeStep.label,
        approved: cascade.steps.filter(s => s.status === 'approved').map(s => s.label),
      } : null,
      changeLog: localChangeLogOf(linkedSm).slice(0, 12).map(e => e.what).filter(Boolean),
    }, (pct, stage) => {
      setSumPct(pct);
      setSumStage(stage);
    });
    if (!isStructuredSummary(data.summary)) {
      throw new Error('Server returned an unstructured summary — restart the API server (server.js / specAuthor.js changed)');
    }
    // Cost is spent the moment the round runs — counted here, commit or not.
    setSummarizeCost(c => Number((c + (Number(data.meta?.costUSD) || 0)).toFixed(4)));
    const cap = Number(data.meta?.maxCostUSD);
    if (Number.isFinite(cap) && cap > 0) setSummarizeCostCap(cap);
    return { data, agentic };
  }

  /** Land a summarize result on the sheet + store — the ONE commit point. */
  function commitSummarizeResult(data, agentic) {
    // NON-AGENTIC rounds stay NON-DESTRUCTIVE via mergeSheetValues (a fresh
    // extraction never clobbers filled values). AGENTIC rounds take the
    // model's returned sheet AS the merge — an explicit removal must WIN,
    // never be resurrected by keep-logic. Both paths re-anchor to the built
    // SM's committed values (hydrateSummaryFromSm — fills, never adds).
    let smNow = linkedSmId ? store.project?.stateMachines?.find(x => x.id === linkedSmId) : null;
    // DEVIATION HANDSHAKE (Dan, Aug 24): a confirmed deviation is RECORDED on
    // machineSpec.approvedDeviations ({what, reason, approvedBy, at}) and the
    // station reflects it — single speed strips the *Transition rows, no
    // blending strips the *Blend rows — BEFORE hydrate, so the guard can't
    // re-add them from the SM.
    if (linkedSmId && smNow && Array.isArray(data.approvedDeviations) && data.approvedDeviations.length) {
      const prev = smNow.machineSpec?.approvedDeviations ?? [];
      const merged = [...prev];
      for (const d of data.approvedDeviations) {
        if (d?.what && !merged.some(x => normKey(x.what) === normKey(d.what))) {
          merged.push({ what: String(d.what), reason: String(d.reason || ''), approvedBy: 'ME', at: Date.now() });
        }
      }
      store.updateStateMachine(linkedSmId, {
        machineSpec: { ...(smNow.machineSpec ?? { version: 1 }), approvedDeviations: merged },
      });
      const stripRes = merged.flatMap(d => {
        const w = String(d.what).toLowerCase();
        const out = [];
        if (/single.?speed|no (speed )?transition/.test(w)) out.push(/Transition$/i);
        if (/no blend|without blend|square corner/.test(w)) out.push(/Blend$/i);
        return out;
      });
      if (stripRes.length) {
        for (const dev of (smNow.devices ?? []).filter(x => x.type === 'ServoAxis')) {
          const next = (dev.positions ?? []).filter(p => !stripRes.some(re => re.test(String(p?.name ?? ''))));
          if (next.length !== (dev.positions ?? []).length) {
            store.updateDevice(linkedSmId, dev.id, { positions: next });
          }
        }
      }
      // FRESH state after the store writes (CLAUDE.md §6: the hook snapshot
      // is a stale closure — reading through it re-added the stripped rows).
      smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId) ?? smNow;
    }
    // REVERT path: an agentic round that RESTORES canonical rows (transitions
    // /blends) the SM no longer declares means the ME went back to standard —
    // land the rows on the SM (else the hydrate guard would drop them) and
    // clear the matching recorded deviation so the compile stops honoring it.
    if (agentic && linkedSmId && smNow) {
      const canon = /(Pick|Place)(Transition|RetractBlend)$/i;
      let deviations = smNow.machineSpec?.approvedDeviations ?? [];
      let devChanged = false;
      for (const sd of (data.summary?.devices ?? []).filter(x => /servo/i.test(String(x?.type ?? '')))) {
        const smDev = findByName(smNow.devices ?? [], sd.name, x => x?.displayName ?? x?.name)
          ?? findByName(smNow.devices ?? [], sd.name);
        if (!smDev || smDev.type !== 'ServoAxis') continue;
        const missing = (sd.positions ?? []).filter(p => p?.name && canon.test(p.name)
          && !(smDev.positions ?? []).some(q => normKey(q.name) === normKey(p.name)));
        if (!missing.length) continue;
        store.updateDevice(linkedSmId, smDev.id, {
          positions: [...(smDev.positions ?? []), ...missing.map(p => ({
            id: (crypto.randomUUID ? crypto.randomUUID() : 'pos_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
            name: p.name, defaultValue: (p.valueMm ?? null),
            moveType: 'Pos', type: 'position', isHome: false, isRecipe: false,
          }))],
        });
        const hasT = missing.some(m => /Transition$/i.test(m.name));
        const hasB = missing.some(m => /Blend$/i.test(m.name));
        deviations = deviations.filter(d => {
          const w = String(d.what).toLowerCase();
          if (hasT && /single.?speed|no (speed )?transition/.test(w)) { devChanged = true; return false; }
          if (hasB && /no blend|without blend|square corner/.test(w)) { devChanged = true; return false; }
          return true;
        });
      }
      if (devChanged) {
        store.updateStateMachine(linkedSmId, {
          machineSpec: { ...(smNow.machineSpec ?? { version: 1 }), approvedDeviations: deviations },
        });
      }
      smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId) ?? smNow;
    }
    const prevSummary = summary;
    const mergedNext = agentic ? data.summary : mergeSheetValues(summary, data.summary);
    const prefilled = withSheetPrefill(hydrateSummaryFromSm(mergedNext, smNow));
    setSummary(prefilled);
    // CHAT EDITS FOLLOW THE RENAME LAW (Dan, 2026-08-27): an agentic round
    // may rename/replace devices — assignments keyed to names that left the
    // sheet are PRUNED; new names re-resolve by signal and re-persist. Stale
    // keys were the second-vanish's accomplice.
    setDeviceAssignments(prev => {
      if (!prev || !Object.keys(prev).length) return prev;
      const live = new Set((prefilled.devices ?? []).map(x => normKey(x?.name)));
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => live.has(k)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    baselineRef.current = prefilled;
    setDirty(false);
    setJarvisCoverage(normCoverage(data.coverage));
    setQuestions(data.questions ?? []);
    setNonStandardFlags(Array.isArray(data.nonStandardFlags) ? data.nonStandardFlags : []);
    const recorded = (Array.isArray(data.learnedFacts) ? data.learnedFacts : [])
      .filter(f => f && f.recorded === true && f.fact)
      .map(f => String(f.fact));
    if (recorded.length) setLearnedNotes(notes => [...notes, ...recorded.filter(f => !notes.includes(f))]);
    return { data, prevSummary, nextSummary: prefilled };
  }

  async function callSummarize(args = {}) {
    const { data, agentic } = await requestSummarize(args);
    return commitSummarizeResult(data, agentic);
  }

  /** After an Apply / Resubmit lands: build the RECEIPT from the COMPUTED
   *  diff of prev vs the sheet that actually landed — never from model
   *  claims (the double-gripper receipt lie: the model said "removed", the
   *  merge resurrected it, the receipt lied). Model sentences only ANNOTATE:
   *  a claim with no corroborating diff is flagged "could not apply"; a diff
   *  the model never mentioned is flagged unexplained. Never silent. */
  function receiptAfterApply({ data, prevSummary, nextSummary }) {
    const diff = diffSummaryChanges(prevSummary, nextSummary);
    const model = Array.isArray(data?.changesMade) ? data.changesMade.filter(c => c && c.text) : [];
    const diffSections = new Set(diff.sentences.map(s => s.section));
    // Truth first: every computed change is a receipt line.
    const items = diff.sentences.slice(0, 20).map(s => ({
      ...s,
      // A real change the model never explained on a corrections round where
      // it DID explain others — surface it, the ME may not have asked for it.
      ...(model.length && !model.some(c => c.section === s.section)
        ? { warn: true, text: `${s.text} — ⚠ Jarvis didn't mention this change` }
        : {}),
    }));
    // Model claims that did NOT survive into the landed sheet: flag honestly —
    // UNLESS the round routed to a re-compile (structural claims legitimately
    // land at compile time, not in the sheet diff; flagging them "could not
    // apply" was the changelog lie of 2026-08-25).
    const recompiling = !!data?.routing?.recompile;
    const diffableKeys = new Set(['sequence', 'failureHandling', 'interactions', 'devices']);
    for (const c of model) {
      if (diffSections.has(c.section)) continue;
      if (recompiling && !diffableKeys.has(c.section)) {
        items.push({ section: c.section, text: `${c.text} → lands at the re-compile` });
      } else if (recompiling) {
        items.push({ section: c.section, warn: true, text: `${c.text} — not in the sheet yet; the re-compile carries it` });
      } else {
        items.push({ section: c.section, warn: true, text: `⚠ could not apply — tell me again: "${c.text}"` });
      }
    }
    setApplyReceipt({ items, at: Date.now() });
    flashSummaryRows(diff.rows);
    if (items.length || diff.rows.length) markSheetAhead();
    // A landed correction re-opens the cascade steps of the sections it
    // ACTUALLY changed (computed diff, never claims) — downstream approved
    // steps queue for re-confirm (Dan's cascade rule).
    const SUMMARY_KIND = { devices: 'devices', sequence: 'sequence', failureHandling: 'recovery', interactions: 'interactions' };
    for (const sec of new Set(diff.sentences.map(s => s.section))) {
      if (SUMMARY_KIND[sec]) touchCascade(SUMMARY_KIND[sec]);
    }
    return items;
  }

  async function handleDoneExplaining() {
    if (!description.trim()) return;
    if (overSummarizeBudget) { setError(budgetMessage); return; }
    setError(null);
    setPhase('summarizing');
    try {
      await callSummarize();
      // EXPLANATION → SEND → GO (Dan, 2026-08-26): the SM proposal kicks off
      // automatically — the auto-run effect fires once the summary lands.
      setPhase('summary');
    } catch (e) {
      setError(e.message);
      setPhase('input');
    }
  }

  /** THE SM-PROPOSAL RUN — DECOMPOSE-ONLY (Dan, 2026-08-26: "just explain the
   *  state machines it thinks and let me edit and chat"). One cheap, fast
   *  call: explanation (+ refs + his expectation) → the breakup proposal.
   *  NOTHING is drawn, built, or compiled here — that is the Generate step,
   *  the LAST step, after every approval. A stall can never freeze: the
   *  request hard-aborts at 120s and surfaces Retry with the reason. */
  async function kickProposal(descOverride = null) {
    // (descOverride: an explanation edit re-thinks against the NEW text
    // before the state update lands — Dan, 2026-08-28.)
    // Layers ride every gate round: original + each dated change-order.
    const descText = String(descOverride ?? fullExplanation).trim();
    if (busy || applying || proposeRun?.stage === 'compile') return;
    if (!descText) {
      setProposeRun({ stage: 'error', msg: 'There is no explanation yet — describe the station first' });
      return;
    }
    setProposeRun({ stage: 'compile', startedAt: Date.now() });
    try {
      // PHASE 2 (Dan, 2026-08-30: "Why not? What are we waiting for?"): the
      // decompose gate runs the SAME embedded SDK engine as the chat — with
      // the decompose doctrine block and a typed propose_split tool. The
      // one-shot /api/jarvis/decompose door is DELETED.
      const gateMessage = [
        splitCounterRef.current
          ? `ENGINEER'S CORRECTION to your previous proposal${(smProposal?.stateMachines?.length ?? 0) ? ` (${smProposal.stateMachines.map(m => m.name).join(', ')})` : ''}: ${splitCounterRef.current}\nRevise via propose_split — his correction wins; carry the untouched content forward verbatim.`
          : 'Propose the state-machine split for this station from the explanation below, via ONE propose_split call.',
        ((summary?.expectedStateMachines ?? []).map(p => p?.name).filter(Boolean).join(', ') || expectedSms.trim())
          ? `\nThe engineer expects (guidance — agree or counter with reasoning): ${(summary?.expectedStateMachines ?? []).map(p => p?.name).filter(Boolean).join(', ') || expectedSms.trim()}`
          : '',
        peerSms.length ? `\nOther stations in this machine: ${peerSms.map(s => s.displayName ?? s.name).join(', ')}` : '',
        `\n# THE ENGINEER'S EXPLANATION\n${descText}`,
      ].filter(Boolean).join('\n');
      const d = await agentTurnRequest({
        message: gateMessage,
        gate: 'decompose',
        audience,
        speaker: (() => { try { return localStorage.getItem('jarvis.speaker') || 'Dan'; } catch { return 'Dan'; } })(),
        draftId: draftIdRef.current,
        clientId: CLIENT_ID,
        draft: {
          name: name.trim(), description: descText,
          summary, jarvisCoverage,
          // Correction rounds revise the CURRENT proposal (rides in draft).
          smProposal: splitCounterRef.current && smProposal?.stateMachines?.length ? smProposal : (smProposal ?? null),
          agreedNeeds: [...agreedNeeds], deviceAssignments,
          chatThread: chatThread.slice(-24).map(t => ({ role: t.role, text: String(t.text ?? '').slice(0, 300) })),
        },
        cascadePosition: {
          approvedMachineNames: (cascade.steps.find(s => s.kind === 'smSplit')?.status === 'approved'
            ? (smProposal?.stateMachines ?? []).map(m => m.name) : []),
        },
      }, label => setProposeRun(p => (p?.stage === 'compile' ? { ...p, label } : p)));
      const proposed = d.draft?.smProposal?.stateMachines;
      if (!Array.isArray(proposed) || !proposed.length) {
        throw new Error(String(d.reply ?? '').trim() || 'The engine returned no split — retry');
      }
      setSmProposal({
        stateMachines: proposed,
        reasoning: d.draft?.smProposal?.reasoning ?? '',
        at: Date.now(),
        costUSD: d.meta?.costUSD ?? null,
      });
      setSummarizeCost(c => Number((c + (Number(d.meta?.costUSD) || 0)).toFixed(4)));
      // The reading + notes speak like any turn (never-silent guard applies).
      for (const noteText of (d.notes ?? [])) {
        setChatThread(t => [...t, { role: 'jarvis', text: noteText, at: Date.now() }]);
      }
      setProposeRun(null);
      assignGateRef.current = true; // gate: proposal landed → place the devices
      if (splitCounterRef.current) {
        splitCounterRef.current = '';
        const focusKey = reviewingKeyRef.current;
        reviewingKeyRef.current = null;
        // COMPUTED, SCOPED, VISUAL (Dan, 2026-08-28): per-machine diff with
        // reworded-line pairing; the WALKED machine gets one receipt line +
        // the live diff on its card; other machines stay SILENT — he finds
        // their content already updated when the walk arrives. Reviewer/
        // checker notes are layer-internal and NEVER print.
        const overlap = (a, b) => {
          const A = new Set(wordsOf(a)); const B = new Set(wordsOf(b));
          const inter = [...A].filter(x => B.has(x)).length;
          return inter / Math.max(1, Math.min(A.size, B.size));
        };
        const diffByKey = {};
        const oldByKey = new Map((smProposal?.stateMachines ?? []).map(m => [normKey(m.name), m]));
        for (const m of proposed) {
          const k = normKey(m.name);
          const oldSeq = (oldByKey.get(k)?.sequence ?? []).map(x => stripParens(x));
          const newSeq = (m.sequence ?? []).map(x => stripParens(x));
          let removed = oldSeq.filter(x => !newSeq.includes(x));
          let added = newSeq.filter(x => !oldSeq.includes(x));
          const changed = [];
          for (const r0 of [...removed]) {
            const match = added.find(a2 => overlap(r0, a2) >= 0.6);
            if (match) { changed.push([r0, match]); removed = removed.filter(x => x !== r0); added = added.filter(x => x !== match); }
          }
          if (removed.length || added.length || changed.length) {
            diffByKey[k] = { removed, added, changed, machine: m.name, oldSeq };
          }
        }
        setSeqDiff(Object.keys(diffByKey).length ? { byKey: diffByKey, at: Date.now() } : null);
        // ATOMIC DEVICE REMOVAL (Dan's Finger-2 P0, 2026-08-28): the engine
        // dropping a device from the proposal edits ONLY the proposal — the
        // device CARDS render from sheet devices[], and open questions live
        // in coverage. One apply, ALL artifacts: a device owned by the OLD
        // proposal, owned nowhere in the NEW one, and mentioned in no new
        // sequence line is REMOVED — sheet row deleted, its questions
        // auto-closed (standing stale-questions rule), assignment record
        // pruned. Anything still mentioned in a sequence is NOT removed.
        const oldOwnedKeys = new Set((smProposal?.stateMachines ?? []).flatMap(m => m.ownedDeviceNames ?? []).map(devKey));
        const newOwnedKeys = new Set((proposed ?? []).flatMap(m => m.ownedDeviceNames ?? []).map(devKey));
        const newProse = (proposed ?? [])
          .flatMap(m => [...(m.sequence ?? []), ...(m.faultRecovery ?? [])]).map(devKey).join('|');
        const droppedKeys = [...oldOwnedKeys].filter(k => k && !newOwnedKeys.has(k) && !newProse.includes(k));
        const matchesDropped = (nm) => {
          const k = devKey(nm);
          return !!k && droppedKeys.some(g => k === g || k.includes(g) || g.includes(k));
        };
        const removedDevNames = (summary?.devices ?? [])
          .map(dv => String(dv?.displayName ?? dv?.name ?? ''))
          .filter(matchesDropped);
        if (removedDevNames.length) {
          setSummary(s => withSheetPrefill({
            ...s,
            devices: (s.devices ?? []).filter(dv => !matchesDropped(dv?.displayName ?? dv?.name ?? '')),
          }));
          setDirty(true);
          // Auto-close the removed device's open questions — a question
          // whose subject no longer exists is stale by definition.
          const qMatchesRemoved = (n) => {
            if (n?.device && matchesDropped(n.device)) return true;
            const qk = devKey(n?.question ?? '');
            return removedDevNames.some(nm => {
              const k = devKey(nm);
              // full key, or the name's distinctive tail ("fingertwo")
              return qk.includes(k) || (k.length > 8 && qk.includes(k.slice(-8)));
            });
          };
          setAgreedNeeds(prev => {
            const next = new Set(prev);
            for (const covKey of Object.keys(jarvisCoverage ?? {})) {
              for (const n of (jarvisCoverage?.[covKey]?.needs ?? [])) {
                if (qMatchesRemoved(n)) next.add(`${covKey}:${n.question}`);
              }
            }
            return next;
          });
          setDeviceAssignments(prev => {
            const next = { ...(prev ?? {}) };
            for (const nm of Object.keys(next)) { if (matchesDropped(nm)) delete next[nm]; }
            return next;
          });
        }
        const cur = focusKey ? diffByKey[focusKey] : null;
        const curCount = cur ? cur.removed.length + cur.added.length + cur.changed.length : 0;
        // RECEIPTS ARE COMPUTED FROM THE ACTUAL DIFF ONLY (Dan, 2026-08-28):
        // every clause below comes from a comparison this client just made —
        // never from the model's narration of what it meant to do.
        const removedClause = removedDevNames.length
          ? ` Removed ${removedDevNames.join(' and ')} from the devices — its open questions closed.`
          : '';
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: cur && curCount
            ? `Done — ${curCount} change${curCount === 1 ? '' : 's'} to ${cur.machine}, shown on its sequence card.${removedClause}`
            : Object.keys(diffByKey).length || removedDevNames.length
              ? `Done — updated.${removedClause}`
              : 'I read that as approving the proposal as-is — nothing changed. Did I miss an edit?',
          at: Date.now(),
        }]);
        // (notes already posted above — SDK notes ride note_to_engineer and
        // are checker-reviewed server-side; the old one-shot noteToEngineer
        // guard died with the one-shot path.)
      }
      if (linkedSmId) appendChangeLog(linkedSmId, {
        what: `State-machine proposal — ${proposed.length} machine${proposed.length === 1 ? '' : 's'}`,
        class: 'section', costUSD: d.meta?.costUSD ?? null,
      });
    } catch (e) {
      clearTimeout(timer);
      setProposeRun({
        stage: 'error',
        msg: e?.name === 'AbortError'
          ? 'Timed out after 2 minutes — the model took too long'
          : e.message,
      });
    }
  }

  // (The auto-run-everywhere effect lives BELOW the cascade derivation — its
  //  dependency list needs `cascade` initialized. Dan, 2026-08-26 round 2.)

  /** The ONE Corrections box, framed so Jarvis routes it: the ME's wording
   *  names its target section implicitly — apply it there, touch nothing else. */
  function combinedCorrections(msgText = changes) {
    const body = String(msgText ?? '').trim();
    if (!body) return '';
    // STEP-AWARE CHAT (Dan, 2026-08-26): the ONE chat is the conversation
    // channel — a message while a cascade step is active applies to that
    // step by default (routing by content still wins when he names another).
    const step = cascadeLive && !(cascade.activeStep?.kind === 'smSplit' && !cascade.activeStep?.hasProposal)
      ? cascade.activeStep : null;
    const stepFrame = step
      ? (step.kind === 'smSplit'
        ? `The engineer is currently reviewing the STATE MACHINE decomposition proposal${(smDecomp?.length ?? 0) ? ` (Jarvis proposed ${smDecomp.length}: ${(smDecomp ?? []).map(e => e.name).join(', ')})` : ''} — a correction about the split re-proposes it. `
        : `The engineer is currently reviewing ${step.smKey && step.smKey !== 'station' ? `the ${step.smName} state machine's ` : "the station's "}${KIND_NOUN[step.kind] ?? step.kind} — corrections default there unless they clearly name another section. `)
      : '';
    // OTHER-MACHINE CONTENT IS STORED SILENTLY (Dan, 2026-08-28): apply it
    // where it belongs; he sees it when the walk reaches that machine.
    return `${stepFrame}Corrections from the engineer — each names its target section implicitly; `
      + 'apply each to the section(s) it targets and leave every untouched section exactly as it was. '
      + 'Anything concerning a machine OTHER than the one he is reviewing: apply it there quietly — '
      + `he reviews that machine later and should find it already reflected:\n${body}`;
  }

  /** Land the cursor in the ONE chat (the step cards link here). */
  function focusChat() {
    const el = document.querySelector('[data-testid="changes-textarea"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  }
  const hasAnyChanges = !!changes.trim();

  /** "FeederBowl belongs to the Escapement" — detect an explicit device→
   *  machine reassignment in a chat message. Fires only when EXACTLY one
   *  device and one machine match unambiguously; anything fuzzier flows down
   *  the normal corrections path. */
  function parseReassignmentIntent(text) {
    const entries = smChipEntries ?? [];
    if (entries.length < 2) return null;
    if (!/\bbelongs?\b|\bmove\b|\bgoes\b|\bshould (be|go|live)\b|\bis part of\b|\bput\b/i.test(text)) return null;
    const devs = summary?.devices ?? [];
    const devHits = devs.filter(d => nameMatchesText(d?.name ?? '', text));
    if (devHits.length !== 1) return null;
    const deviceName = String(devHits[0].name);
    const dTok = new Set(wordsOf(deviceName));
    const tTok = wordsOf(text);
    const scoreOf = (e) => wordsOf(e.name).filter(w => w.length >= 4 && !dTok.has(w) && tTok.includes(w)).length;
    let best = null;
    for (const e of entries) {
      const s = scoreOf(e);
      if (s > 0 && (!best || s > best.s)) best = { e, s };
    }
    if (!best) return null;
    if (entries.some(e => e !== best.e && scoreOf(e) === best.s)) return null; // ambiguous
    return { deviceName, machineKey: best.e.key, machineName: best.e.name };
  }

  /** THE AGENT LOOP TURN (Dan approved 2026-08-28 — the one door for fresh-
   *  draft chat): sends the message + draft snapshot; the server agent reads
   *  through tools, applies typed diff-returning edits, gets checked, and the
   *  applied draft comes back. Receipt is composed from the diffs HERE. */
  async function runAgentChatTurn(msg, { isRetry = false, displayText = null, qList = null } = {}) {
    if (applying) return false;
    console.log('[chat] dispatched: agent loop' + (isRetry ? ' (retry)' : '') + (linkedSmId ? ' (linked sheet)' : ''));
    // LINKED SHEETS RIDE THE SAME LOOP (Phase 2, Dan 2026-08-30): a built
    // station's sheet corrections run the SDK engine too. The sheet's split
    // (machineSpec.smSplit) — or, unsplit, the station sequence/recovery —
    // rides as a pseudo-proposal so the same typed ops edit it; results map
    // back below. The one-shot summarize-corrections dispatch is deleted.
    const linkedSplit = linkedSmId ? (linkedSm?.machineSpec?.smSplit ?? null) : null;
    const proposalForTurn = !linkedSmId ? smProposal : {
      stateMachines: (Array.isArray(linkedSplit) && linkedSplit.length
        ? linkedSplit.map(e => ({
            name: e?.name ?? '', oneLiner: e?.oneLiner ?? '', why: e?.why ?? '',
            ownedDeviceNames: [...(e?.deviceNames ?? [])],
            sequence: [...(e?.sequence ?? [])], faultRecovery: [...(e?.faultRecovery ?? [])],
          }))
        : [{
            name: (name ?? '').trim() || 'Station', oneLiner: '', why: '',
            ownedDeviceNames: (summary?.devices ?? []).map(d => d?.name).filter(Boolean),
            sequence: [...(summary?.sequence ?? [])], faultRecovery: [...(summary?.failureHandling ?? [])],
          }]),
    };
    const oldMachines = (proposalForTurn?.stateMachines ?? []).map(m => ({
      name: m.name, sequence: [...(m.sequence ?? [])], faultRecovery: [...(m.faultRecovery ?? [])],
    }));
    // OPTIMISTIC, ALWAYS (Dan, 2026-08-30: box-refill "looks like an unsent
    // draft"): his message lives in the chat from the moment he sends; a
    // retry re-runs THAT message without duplicating it.
    if (!isRetry) setChatThread(t => [...t, { role: 'me', text: displayText ?? msg, ...(qList?.length ? { questions: qList } : {}), at: Date.now() }]);
    setChanges('');
    setApplying(true);
    setAgentState('thinking…');
    try {
      const approvedMachineNames = linkedSmId
        ? (smApproval?.approved ? (proposalForTurn?.stateMachines ?? []).map(m => m.name) : [])
        : (cascade.steps.find(s => s.kind === 'smSplit')?.status === 'approved'
          ? (smProposal?.stateMachines ?? []).map(m => m.name)
          : []);
      const d = await agentTurnRequest({
        message: msg,
        audience, // ME (default) | CE — the loop's voice contract
        // TIER 2/3 attribution (Dan's boundary design): who's speaking.
        // Dan's laws activate immediately; anyone else's queue pending.
        speaker: (() => { try { return localStorage.getItem('jarvis.speaker') || 'Dan'; } catch { return 'Dan'; } })(),
        draftId: draftIdRef.current, // reconnect key: /agent-turn/last
        clientId: CLIENT_ID, // echo suppression on the live draft channel
        draft: {
          name: name.trim(), description: fullExplanation.trim(),
          summary, smProposal: proposalForTurn, jarvisCoverage, controlsNotes,
          agreedNeeds: [...agreedNeeds], deviceAssignments,
          chatThread: chatThread.slice(-24).map(t => ({ role: t.role, text: String(t.text ?? '').slice(0, 300) })),
        },
        // THE GUIDE's walk state (Dan, 2026-08-30: "leads you through what is
        // happening and what to do next") — the rail knows; the engineer
        // speaks it: current step, its open questions, the NEXT step, and
        // how much walk remains.
        cascadePosition: cascade.activeStep ? (() => {
          const idx = cascade.steps.findIndex(s => s.key === cascade.activeStep.key);
          const next = idx >= 0 ? cascade.steps.slice(idx + 1).find(s => s.status !== 'approved') : null;
          let openQuestions = [];
          try { openQuestions = needsForStep(cascade.activeStep).map(n => n.question).slice(0, 6); } catch { /* guide only */ }
          return {
            activeStep: { kind: cascade.activeStep.kind, smKey: cascade.activeStep.smKey, label: cascade.activeStep.label },
            openQuestionsOnStep: openQuestions,
            nextStep: next ? { kind: next.kind, label: next.label } : null,
            stepsRemaining: cascade.steps.filter(s => s.status !== 'approved').length,
            approved: cascade.steps.filter(s => s.status === 'approved').map(s => s.label),
            approvedMachineNames,
          };
        })() : { approvedMachineNames, allApproved: cascade.allApproved },
      }, label => setAgentState(label),
      // THE READING, LIVE (Dan, 2026-08-30): the model's one-sentence reading
      // of his request posts to the chat BEFORE the edits land — the
      // catch-the-misread-early moment.
      readingText => setChatThread(t => [...t, { role: 'jarvis', text: readingText, reading: true, at: Date.now() }]));
      // Land the applied draft — the server edited a working copy through
      // typed ops; the client stays the storage authority.
      if (d.draft) {
        if (d.draft.summary) setSummary(withSheetPrefill(d.draft.summary));
        if (!linkedSmId && d.draft.smProposal?.stateMachines) {
          setSmProposal(p => ({ ...(p ?? {}), stateMachines: d.draft.smProposal.stateMachines, at: Date.now() }));
        }
        if (d.draft.jarvisCoverage) setJarvisCoverage(normCoverage(d.draft.jarvisCoverage));
        if (Array.isArray(d.draft.agreedNeeds)) setAgreedNeeds(new Set(d.draft.agreedNeeds));
        if (d.draft.deviceAssignments) setDeviceAssignments(d.draft.deviceAssignments);
        if (Array.isArray(d.draft.controlsNotes)) setControlsNotes(d.draft.controlsNotes);
        setDirty(true);
      }
      // LINKED SHEET MAP-BACK (Phase 2): the pseudo-proposal's edits land in
      // the built station's real home — machineSpec.smSplit when the sheet is
      // split, the station sequence/recovery otherwise. Manual store edits
      // stay the ME's; this writes only what the turn's diffs changed.
      if (linkedSmId && d.draft?.smProposal?.stateMachines?.length) {
        const ms = d.draft.smProposal.stateMachines;
        const smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId);
        const spec = smNow?.machineSpec;
        if (smNow && Array.isArray(spec?.smSplit) && spec.smSplit.length) {
          const byName = new Map(ms.map(m => [String(m.name ?? '').trim().toLowerCase(), m]));
          const nextSplit = spec.smSplit.map(e => {
            const m = byName.get(String(e?.name ?? '').trim().toLowerCase());
            return m ? {
              ...e,
              name: m.name,
              ...(Array.isArray(m.ownedDeviceNames) ? { deviceNames: m.ownedDeviceNames } : {}),
              sequence: [...(m.sequence ?? [])],
              ...(m.faultRecovery?.length ? { faultRecovery: [...m.faultRecovery] } : {}),
            } : e;
          });
          store.updateStateMachine(linkedSmId, { machineSpec: { ...spec, smSplit: nextSplit } });
        } else if (ms.length === 1) {
          const m = ms[0];
          setSummary(s => withSheetPrefill({
            ...(d.draft.summary ?? s),
            sequence: [...(m.sequence ?? [])],
            failureHandling: [...(m.faultRecovery ?? [])],
          }));
        }
        markSheetAhead();
      }
      // Live marks — the loop contract's RED, on every artifact the turn
      // touched (sequence, recovery, devices), until "✓ got it".
      const newMs = d.draft?.smProposal?.stateMachines ?? [];
      const diffByKey = computeProposalSeqDiff(oldMachines, newMs, 'sequence');
      setSeqDiff(Object.keys(diffByKey).length ? { byKey: diffByKey, at: Date.now() } : null);
      const recByKey = computeProposalSeqDiff(oldMachines, newMs, 'faultRecovery');
      setRecDiff(Object.keys(recByKey).length ? { byKey: recByKey, at: Date.now() } : null);
      const devNames = [...new Set((d.diffs ?? []).filter(x => /^device\./.test(x.op))
        .map(x => x.device ?? x.after ?? x.before).filter(Boolean))];
      setDevChanged(devNames.length ? { names: devNames, at: Date.now() } : null);
      // THE SPEAKING LAYER (Dan, 2026-08-30): the spoken paragraph is the
      // model's reply — his terms, his content, ball location. The COMPUTED
      // receipt (from the diffs, unfakeable) attaches as the folded change
      // list under it — ground truth adjacent, never recited.
      const receipt = receiptFromAgentDiffs(d.diffs ?? []);
      // The change log stays the built station's version-control view: one
      // line per applied turn (was the summarize path's job pre-Phase 2).
      if (linkedSmId && receipt) {
        appendChangeLog(linkedSmId, {
          what: receipt,
          class: (d.diffs ?? []).some(x => x.op === 'split.propose') ? 'replan'
            : (d.diffs ?? []).some(x => /^(sequence|recovery)\./.test(x.op)) ? 'section' : 'value',
          costUSD: Number(d.meta?.costUSD) || null,
        });
      }
      const spoken = String(d.reply ?? '').trim()
        || (receipt ? 'Done — the changes are on the cards below.' : '');
      setChatThread(t => [...t, {
        role: 'jarvis',
        text: spoken || 'Done.',
        ...(receipt ? { items: [{ text: receipt }] } : {}),
        at: Date.now(),
      }]);
      for (const noteText of (d.notes ?? [])) {
        setChatThread(t => [...t, { role: 'jarvis', text: noteText, at: Date.now() }]);
      }
      // ONE COMMUNICATION STREAM (Dan, 2026-08-30): questions live in the
      // chat too — the history holds them AND their answers. The step panel
      // keeps the compact cards with Agree; both are views of the SAME
      // question objects.
      for (const a of (d.asks ?? [])) {
        setChatThread(t => [...t, {
          role: 'jarvis',
          text: `Question for you: ${a.question}`
            + (a.evidence ? `\nFrom our shipped examples: ${a.evidence}` : '')
            + (a.proposedSolution ? `\nMy proposal: ${a.proposedSolution}` : '')
            + '\nAgree on the step card, or just answer here.',
          at: Date.now(),
        }]);
      }
      setSummarizeCost(c => Number((c + (Number(d.meta?.costUSD) || 0)).toFixed(4)));
    } catch (e) {
      // HONEST FAILURE, RETRY IN PLACE (Dan, 2026-08-30): his message stays
      // in the chat; the failure line sits under it with a Retry that
      // re-runs THAT message. The box never repopulates. Raw API JSON never
      // renders — the server already translated it to plain words.
      setChatThread(t => [...t, {
        role: 'jarvis',
        text: `That didn't go through — ${e.message}.`,
        error: true, retryText: msg, at: Date.now(),
      }]);
      return false;
    } finally {
      setApplying(false);
      setAgentState(null);
    }
    return true;
  }

  async function handleApplyChanges() {
    // NEVER SILENT AT THE UI LAYER (Dan's eaten repost, 2026-08-28): every
    // early exit states itself inline; every dispatch logs its branch.
    if (applying) {
      setApplyHint('A round is already running — it lands in a few seconds; Send again after.');
      console.warn('[chat] send blocked: a round is already applying');
      return;
    }
    // FLUSH DICTATION FIRST: commit any interim ghost text into the message
    // BEFORE reading it (the eaten-message branch: Send raced the recognizer,
    // saw an empty value, and died at the validation hint).
    const flushed = document.querySelector('[data-testid="changes-textarea"]')?.__flushDictation?.() ?? '';
    const msg = `${(changes ?? '').trim()}${flushed ? `${(changes ?? '').trim() ? ' ' : ''}${flushed}` : ''}`.trim();
    // EXPLICIT REASSIGNMENT (Dan, 2026-08-27: "how would I say it shouldn't
    // be here?" — like this): atomic, instant, free. The ME's word lands as
    // an explicit assignment that outranks every signal, the device moves
    // machines, and the receipt says so.
    if (cascadeLive && msg) {
      const move = parseReassignmentIntent(msg);
      if (move) {
        console.log('[chat] dispatched: explicit device move');
        // ONE ENGINE (Dan, 2026-08-28: "the chat has to be the same engine
        // that builds the stations"): the ME's ruling goes THROUGH the
        // assignment thinker+checker with his word as a directive that
        // outranks precedent — then the sheet updates and the receipt cites
        // the checked result. His placement stands even offline (fallback).
        const raw = msg;
        const prior = deviceAssignments?.[normKey(move.deviceName)];
        const wasNoPrecedent = prior && typeof prior === 'object' && prior.by === 'agent' && prior.precedent === false;
        setChatThread(t => [...t, { role: 'me', text: raw, at: Date.now() }]);
        setChanges('');
        setApplying(true);
        let engineEvidence = '';
        let engineFlag = '';
        try {
          const dev = (summary?.devices ?? []).find(x => normKey(x?.name) === normKey(move.deviceName));
          const entries = smChipEntries ?? [];
          const r = await fetch('/api/jarvis/assign-devices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(90000),
            body: JSON.stringify({
              devices: [{ name: move.deviceName, type: dev ? sheetType(dev) : 'unknown', purpose: dev?.purpose ?? '' }],
              machines: entries.map(e => ({ name: e.name, key: e.key, ownedDeviceNames: e.deviceNames ?? [], sequence: e.sequence ?? [] })),
              description: description.trim(),
              directives: [`${move.deviceName} is part of the state machine that includes the ${move.machineName} — the engineer ruled it.`],
              smName: name.trim() || null,
            }),
          });
          const d = await r.json().catch(() => null);
          const a = d?.ok ? (d.assignments ?? []).find(x => normKey(x.device) === normKey(move.deviceName)) : null;
          engineEvidence = a?.evidence ?? '';
          const viol = (d?.checked?.violations ?? [])[0];
          if (viol) engineFlag = ` (flagged for review: ${viol})`;
        } catch { /* the ME's word stands regardless — engine adds evidence only */ }
        setDeviceAssignments(prev => ({ ...(prev ?? {}), [normKey(move.deviceName)]: { key: move.machineKey, by: 'ME', evidence: engineEvidence } }));
        if (wasNoPrecedent) {
          const dev = (summary?.devices ?? []).find(x => normKey(x?.name) === normKey(move.deviceName));
          fetch('/api/jarvis/learn-ownership', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fact: `DEVICE OWNERSHIP (ME ruling on ${name.trim() || 'a station'}): a ${dev?.type ?? 'device'} like "${move.deviceName}" is part of the state machine that includes the ${move.machineName}.`,
              who: 'ME',
            }),
          }).catch(() => {});
        }
        setApplying(false);
        setChatThread(t => [...t, {
          role: 'jarvis',
          text: `Moved ${move.deviceName} to ${move.machineName}.`
            + (engineEvidence ? ` ${engineEvidence}` : '')
            + engineFlag
            + (wasNoPrecedent ? ' Recorded as standing doctrine — this will never be asked again.' : ''),
          at: Date.now(),
        }]);
        if (linkedSmId) appendChangeLog(linkedSmId, { what: `moved ${move.deviceName} → ${move.machineName}${wasNoPrecedent ? ' (ruling recorded as doctrine)' : ''}`, class: 'value' });
        return;
      }
    }
    // BARE AGREEMENT (Dan's "agree" P0, 2026-08-30): a plain ack resolves
    // against the CONVERSATION — the open question(s) on the step he's
    // looking at — exactly like clicking Agree. Zero-judgment mechanical
    // fast path: instant, free, and it GUIDES (says what closed and what's
    // next, straight from the rail).
    if (cascadeLive && msg && activeStepNeeds.length
      && /^(yes|yep|yeah|ok(ay)?|agreed?|correct|sounds good|go (with (that|it|yours))|fine|approved?)[.! ]*$/i.test(msg)) {
      console.log('[chat] dispatched: bare agreement → agree all open step questions');
      for (const n of activeStepNeeds) {
        setAgreedNeeds(s => new Set([...s, needKey(n.covKey, n)]));
        setQaHistory(h => [...h, { questions: [n.question], answer: 'Go with your proposed solution.' }]);
      }
      const stepIdx = cascade.steps.findIndex(s => s.key === cascade.activeStep?.key);
      const next = stepIdx >= 0 ? cascade.steps.slice(stepIdx + 1).find(s => s.status !== 'approved') : null;
      const qWord = activeStepNeeds.length === 1 ? 'that question' : `all ${activeStepNeeds.length} open questions`;
      setChatThread(t => [...t,
        { role: 'me', text: msg, at: Date.now() },
        {
          role: 'jarvis',
          text: `Agreed — ${qWord} on ${cascade.activeStep?.label ?? 'this step'} closed with my proposal${activeStepNeeds.length === 1 ? '' : 's'} standing. `
            + `Nothing else open here — hit Approve on the step card${next ? `; next up is ${next.label}` : ' and the station is done'}.`,
          at: Date.now(),
        }]);
      setChanges('');
      return;
    }
    // THE AGENT LOOP IS THE ONE DOOR for fresh-draft chat (Dan approved the
    // build 2026-08-28; flow-replacement law: the one-shot decompose-
    // correction and summarize-correction dispatches for drafts are DELETED
    // in this same change). Numbered pure-agrees keep their zero-judgment
    // free path below; everything else an ME says on a draft runs the loop.
    if (!linkedSmId && phase === 'summary' && msg
      && !(activeStepNeeds.length && parseNumberedAnswers(msg, activeStepNeeds))) {
      // The ONE exception kept: a re-split argument while the smSplit step is
      // up still re-enters the decompose gate engine (that is a GATE event —
      // the whole-proposal rethink; loop ops edit content, not the split).
      if (smProposal && cascadeLive && cascade.activeStep?.kind === 'smSplit') {
        if (proposeRun?.stage === 'compile') {
          setApplyHint('Still working on the previous round — send again when it lands.');
          console.warn('[chat] send blocked: proposal round in flight');
          return;
        }
        console.log('[chat] dispatched: split argument → decompose gate');
        reviewingKeyRef.current = null;
        splitCounterRef.current = msg;
        setChatThread(th => [...th, { role: 'me', text: msg, at: Date.now() }]);
        setChanges('');
        setApplying(true);
        try { await kickProposal(); } finally { setApplying(false); }
        return;
      }
      await runAgentChatTurn(msg);
      return;
    }
    // NUMBERED ANSWERS (Dan, 2026-08-27): "1 — yes; 2 — actually there's a
    // track-full sensor" routes each answer to its Q-number on the active
    // step, in ONE corrections round. Agree-ish answers just record.
    if (cascadeLive && activeStep && activeStepNeeds.length && msg) {
      const parsed = parseNumberedAnswers(msg, activeStepNeeds);
      if (parsed) {
        console.log('[chat] dispatched: numbered answers');
        const raw = msg;
        const agreeish = /^(yes|yep|yeah|ok(ay)?|agreed?|correct|go (with (that|it)|ahead)|sounds good|fine)\.?$/i;
        const corrections = [];
        for (const { n, q, answer } of parsed) {
          setAgreedNeeds(s => new Set([...s, needKey(q.covKey, q)]));
          if (agreeish.test(answer)) {
            setQaHistory(h => [...h, { questions: [q.question], answer: 'Go with your proposed solution.' }]);
          } else {
            corrections.push(`Q${n} "${q.question}" — the engineer answers: ${answer}`);
            setQaHistory(h => [...h, { questions: [q.question], answer }]);
          }
        }
        if (!corrections.length) {
          // Pure agrees — free, recorded, no round.
          setChatThread(t => [...t,
            { role: 'me', text: raw, at: Date.now() },
            { role: 'jarvis', text: 'Recorded — going with the proposed answers.', at: Date.now() }]);
          setChanges('');
          return;
        }
        const scope = activeStep.smKey && activeStep.smKey !== 'station'
          ? `the ${activeStep.smName} state machine's ${KIND_NOUN[activeStep.kind] ?? activeStep.kind}`
          : `the station's ${KIND_NOUN[activeStep.kind] ?? activeStep.kind}`;
        const framed = `Answers to your numbered questions on ${scope}:\n${corrections.join('\n')}\n`
          + 'Fold each answer in where it applies and leave everything else exactly as it was.';
        if (!linkedSmId) {
          // Fresh drafts: the agent loop is the one door.
          await runAgentChatTurn(framed);
          return;
        }
        await sendCorrections(framed, raw, parsed.map(p => p.q.question), () => setChanges(''));
        return;
      }
    }
    const corrections = combinedCorrections(msg);
    if (!corrections) {
      // Empty box: just put the cursor there — a chat box needs no lecture.
      console.warn('[chat] send blocked: empty message');
      document.querySelector('[data-testid="changes-textarea"]')?.focus();
      return;
    }
    console.log('[chat] dispatched: corrections engine');
    await sendCorrections(corrections, msg, questions.slice(), () => setChanges(''));
  }

  /** THE one corrections pipeline (Dan's Magnet Dial round, 2026-08-25:
   *  inline blocking-question answers ride the SAME path as the chat) —
   *  runs summarize with the correction text, records Q&A, threads the
   *  turn, and computes the receipt. `rawText` is what the ME said (shown in
   *  the thread); `corrections` is the framed pipeline text. */
  /** ONE DOOR (Phase 2, Dan 2026-08-30): every corrections round — fresh
   *  draft or built station — runs the SDK agent loop. This wrapper keeps the
   *  historical signature for its callers (question answers, split counters,
   *  cascade talkback) and adds the Q&A-round bookkeeping the summarize path
   *  used to do. The one-shot summarize-corrections dispatch is DELETED;
   *  callSummarize survives only for initial extraction and Resubmit-edits
   *  (mechanical restatements, not conversations). */
  async function sendCorrections(corrections, rawText, qList, onApplied) {
    if (applying) return false;
    if (overSummarizeBudget) { setError(budgetMessage); return false; }
    setError(null);
    setApplyReceipt(null); // the incoming apply replaces the last receipt
    const ok = await runAgentChatTurn(corrections, { displayText: rawText, qList: qList ?? [] });
    if (ok) {
      setQaHistory(h => [...h, { questions: qList, answer: corrections }]);
      setQaRounds(n => n + 1);
      onApplied?.();
    }
    return ok;
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
    setApplyReceipt(null);
    try {
      const applied = await callSummarize({ priorSummary: summaryToText(summary), corrections });
      receiptAfterApply(applied);
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
    markSheetAhead(); // the kept edits put the sheet ahead of the build
  }

  // ── REVIEW & EDIT handlers (Dan's flow, 2026-08-25) ──────────────────────
  const sectionReviews = (linkedSmId
    ? (linkedSm?.machineSpec?.sectionReviews ?? {})
    : localReviews);
  const isReviewed = (key) => !!sectionReviews[key];

  function setSectionReviewed(key, on = true) {
    if (!linkedSmId) {
      setLocalReviews(r => {
        const next = { ...r };
        if (on) next[key] = { at: new Date().toISOString(), by: 'ME' };
        else delete next[key];
        return next;
      });
      return;
    }
    const smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId);
    if (!smNow) return;
    const spec = smNow.machineSpec ?? { version: 1 };
    const reviews = { ...(spec.sectionReviews ?? {}) };
    if (on) reviews[key] = { at: new Date().toISOString(), by: 'ME' };
    else delete reviews[key];
    store.updateStateMachine(linkedSmId, { machineSpec: { ...spec, sectionReviews: reviews } });
  }

  /** Any content edit re-opens its section's review — approve governs a state
   *  of the section, never a stale one. */
  function touchSection(key) {
    if (isReviewed(key)) setSectionReviewed(key, false);
  }

  // ── THE CASCADE (Dan, 2026-08-26): derive the ordered steps from the data
  // the sheet already holds, overlay the recorded approvals, get ONE active
  // step. Approvals persist on machineSpec.cascadeState (sibling of smSplit);
  // the SM-breakup step keys off the EXISTING smSplitApproval — never copied.
  // THE DRAFT'S DECOMPOSE-ONLY PROPOSAL as decomposition entries — same
  // shape smGrouping produces, so the whole cascade machinery reads it.
  const draftProposalEntries = useMemo(() => {
    const list = smProposal?.stateMachines ?? [];
    if (!list.length) return null;
    return list.map(m => ({
      key: normKey(m.name), smId: null,
      name: m.name, oneLiner: m.oneLiner ?? '', why: m.why ?? '',
      deviceNames: m.ownedDeviceNames ?? [], sequence: m.sequence ?? [],
      // THE FINGER-RECOVERY P0 (Dan, 2026-08-30): this was hardcoded [] — the
      // engine drafted his recovery into smProposal and the panel never saw
      // it. The proposal's per-machine recovery IS the panel's data.
      faultRecovery: m.faultRecovery ?? [], handshakes: [],
      // Structured steps ride to the render (flow view + branch shapes).
      sequenceSteps: m.sequenceSteps ?? null,
      faultRecoverySteps: m.faultRecoverySteps ?? null,
    }));
  }, [smProposal]);
  // Fresh drafts record the breakup approval in the cascade state itself
  // (no station exists to carry the artifact until Generate).
  const draftSplitApproved = !linkedSmId && localCascade?.steps?.smSplit?.approved === true;
  const cascadeSteps = useMemo(() => cascadeStepsOf({
    decomp: panelModel.decomp ?? smDecomp ?? draftProposalEntries,
    // A NEWER proposal awaiting approval previews ITS machines as the
    // pending per-SM steps (Dan's Magnet Dial round: the fresh 4-SM proposal
    // is what he's approving — the rail must show those four, not the two
    // older records). Outputs still group by the APPROVED authority.
    approvedEntries: panelModel.awaitingApproval ? null
      : (approvedSmDecomp ?? (draftSplitApproved ? draftProposalEntries : null)),
    summary,
    hasPeers,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [panelModel, smDecomp, approvedSmDecomp, draftProposalEntries, draftSplitApproved, summary, hasPeers]);
  const cascade = useMemo(() => deriveCascade(cascadeSteps, {
    state: linkedSmId ? (linkedSm?.machineSpec?.cascadeState ?? null) : localCascade,
    // Real station SM records are FACT — the breakup step is approved by
    // existence; a mere proposal needs the smSplitApproval artifact. Either
    // way, a NEWER compiled proposal awaiting approval RE-OPENS the breakup
    // step: the cascade lands the ME right there.
    smApprovalApproved: !panelModel.awaitingApproval
      && (stationDecomp ? true : smApproval?.approved === true),
    legacyReviews: sectionReviews,
    smSplitFromRecs: !linkedSmId, // drafts approve the split in cascade state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cascadeSteps, linkedSmId, linkedSm, localCascade, smApproval, stationDecomp, sectionReviews, panelModel]);

  /** Approve / rename the DRAFT's proposed split (no station yet — the
   *  approval records in cascade state and rides into Generate's machineSpec). */
  function approveDraftSplit() {
    assignGateRef.current = true; // gate: machines exist → place the devices
    writeCascade(c => ({
      ...c,
      steps: { ...c.steps, smSplit: { approved: true, by: 'ME', at: new Date().toISOString() } },
    }));
  }
  function renameDraftSplitEntry(entry, newName) {
    // Natural names, spaces kept ("Mid Base Escapement") — PascalCase is the
    // PLC program name, derived at Generate (Dan, 2026-08-26).
    const t = String(newName ?? '').trim().replace(/\s+/g, ' ');
    if (!t) return;
    setSmProposal(p => (p ? {
      ...p,
      stateMachines: p.stateMachines.map(m => (normKey(m.name) === entry.key ? { ...m, name: t } : m)),
    } : p));
    writeCascade(c => ({ ...c, steps: { ...c.steps, smSplit: { approved: false } } }));
  }

  function writeCascade(mut) {
    if (!linkedSmId) { setLocalCascade(c => mut({ ...(c ?? {}), steps: { ...(c?.steps ?? {}) } })); return; }
    const smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId);
    if (!smNow) return;
    const spec = smNow.machineSpec ?? { version: 1 };
    const cur = spec.cascadeState ?? {};
    store.updateStateMachine(linkedSmId, {
      machineSpec: { ...spec, cascadeState: mut({ ...cur, steps: { ...(cur.steps ?? {}) } }) },
    });
  }

  // PRE-BUILD SIGNAL CHECK (P0, 2026-08-30 — SUPREME LAW: never knowingly
  // emit hanging code without a blocking question). The can-hang-forever
  // class (unmatched cross-machine waits, deadlocks) BLOCKS the build by
  // default; "build anyway" is the explicit secondary. Advisory classes
  // (dead signal, fault-window) stay carry-as-is.
  const pregenFindings = useMemo(() => {
    if ((smProposal?.stateMachines?.length ?? 0) < 2) return { hang: [], advisory: [] };
    try {
      const all = checkHandshakes(smProposal.stateMachines)
        .filter(f => ![...agreedNeeds].some(k => String(k).includes(f.plain.slice(0, 60))));
      return {
        hang: all.filter(f => f.kind === 'unmatched-wait' || f.kind === 'deadlock').slice(0, 4),
        advisory: all.filter(f => f.kind !== 'unmatched-wait' && f.kind !== 'deadlock').slice(0, 4),
      };
    } catch { return { hang: [], advisory: [] }; }
  }, [smProposal, agreedNeeds]);

  /** THE BUILD ACTION (blockers list + hang gate + the button) — ONE render
   *  used from two homes: inside the Build card's build lane (cascade drafts,
   *  align 'left') and the page-bottom action row (linked sheets, align
   *  'right'). Dan, 2026-08-30: the button lives IN the card, stacked under
   *  Accept — never orphaned at the page bottom next to Discard. */
  const renderBuildAction = (align = 'right') => {
    const list = sheetBlockers();
    const ready = list.length === 0;
    const right = align === 'right';
    // CODE BUILD IN FLIGHT / DONE / FAILED — the turn contract's visible
    // state (P0, 2026-08-31: a click must never be silent).
    if (linkedSmId && codeBuild) {
      if (codeBuild.error) {
        return (
          <div data-testid="code-build-error" style={{ fontSize: 12, color: '#8a3b3b' }}>
            That didn't go through — {codeBuild.error}{' '}
            <button type="button" data-testid="code-build-retry" onClick={handleBuildCode}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'underline' }}>Retry</button>
          </div>
        );
      }
      if (!codeBuild.done) {
        return (
          <div data-testid="code-build-progress" style={{ fontSize: 12, color: C.text, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>Building station code — {Math.round(codeBuild.pct ?? 0)}%</b>
              {codeBuild.stalled && <span style={{ fontSize: 10.5, color: '#6b5513' }}>quiet — the writer is reasoning; still connected</span>}
            </div>
            <div style={{ height: 5, background: 'var(--color-sidebar)', borderRadius: 3, margin: '4px 0' }}>
              <div style={{ height: 5, width: `${Math.min(codeBuild.pct ?? 0, 100)}%`, background: 'var(--color-primary)', borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>{codeBuild.detail ?? '…'}</div>
          </div>
        );
      }
      // done — one green line + the next action stays available below.
    }
    return (
      <>
        {!ready && (
          <div data-testid="build-blockers" style={{ textAlign: right ? 'right' : 'left' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Build is waiting on
            </div>
            {list.map(b => (
              <button
                key={b.key}
                type="button"
                data-testid={`build-blocker-${b.key}`}
                onClick={() => goToBlocker(b)}
                title="Take me there"
                style={{
                  display: 'block', marginLeft: right ? 'auto' : 0, background: 'none', border: 'none',
                  padding: '1px 0', cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                  color: C.danger, textDecoration: 'underline', whiteSpace: 'nowrap',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
        {/* THE HANG GATE (SUPREME LAW): can-hang findings make the primary
            "Fix these first"; build-anyway is the explicit secondary. */}
        {ready && pregenFindings.hang.length > 0 ? (
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', gap: 3 }}>
            <button
              className="btn btn--primary"
              data-testid="build-station-btn"
              onClick={() => document.querySelector('[data-testid="pregen-handshake-findings"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              disabled={applying}
              title="The signal check found waits that can never be satisfied — fix or Agree them first"
              style={{ fontSize: 14, padding: '9px 22px', background: '#8a3b3b', borderColor: '#8a3b3b' }}
            >
              Fix these first — {pregenFindings.hang.length} signal finding{pregenFindings.hang.length === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              data-testid="build-anyway-btn"
              onClick={handleBuildClick}
              disabled={applying}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: C.muted, textDecoration: 'underline' }}
            >
              build anyway — the code carries these as-is
            </button>
          </span>
        ) : (
          <button
            className="btn btn--primary"
            data-testid="build-station-btn"
            onClick={linkedSmId ? handleBuildCode : handleBuildClick}
            disabled={applying}
            aria-disabled={!ready}
            title={ready
              ? (linkedSmId ? 'Writes the station\'s L5X — validated, import-simulated, reviewed, cover-noted'
                : allCovered ? undefined : 'Open needs go with their proposed answers, noted for review')
              : `Not ready yet: ${list.map(b => b.label).join(' · ')}`}
            style={{
              fontSize: 14, padding: '9px 22px',
              transition: 'background 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease, filter 0.35s ease',
              opacity: ready ? 1 : 0.5,
              filter: ready ? 'none' : 'grayscale(0.7)',
              cursor: ready ? 'pointer' : 'not-allowed',
              boxShadow: ready && !applying ? `0 0 0 3px ${C.primaryBg}` : 'none',
            }}
          >
            {/* BUTTON TRUTH (Dan, 2026-08-31): "Rebuild" only after a real
                code build with artifacts exists — never before. */}
            {linkedSmId && hasCodeBuild ? 'Rebuild Station Code' : 'Build Station Code'}
          </button>
        )}
      </>
    );
  };

  /** Approve the active step — it LOCKS into the outputs (✓-stamped,
   *  changelogged) and the cascade advances. SM breakup rides the existing
   *  approveSmSplit path (one approval artifact, never two). */
  function approveCascadeStep(step) {
    if (!step) return;
    // HANDSHAKE CHECK GATES THE APPROVAL (Dan, 2026-08-30: findings live in
    // the walk, not the Build card). At sequence/interaction approvals the
    // signal graph runs FIRST: a can-never-satisfy finding (unmatched wait,
    // ordering deadlock — the station would fault on timeout every cycle)
    // posts as a numbered chat question and the step CANNOT check off while
    // it's open. Advisory findings (dead signal) post after approval,
    // non-blocking.
    let advisoryAfter = [];
    if ((step.kind === 'sequence' || step.kind === 'interactions') && smProposal?.stateMachines?.length >= 2) {
      try {
        const all = checkHandshakes(smProposal.stateMachines);
        const notAgreed = f => ![...agreedNeeds].some(k => String(k).includes(f.plain.slice(0, 60)));
        const posted = new Set((jarvisCoverage?.interactions?.needs ?? []).map(n => String(n.question)));
        const hang = all.filter(f => (f.kind === 'unmatched-wait' || f.kind === 'deadlock') && notAgreed(f)).slice(0, 4);
        advisoryAfter = all.filter(f => f.kind !== 'unmatched-wait' && f.kind !== 'deadlock' && notAgreed(f) && !posted.has(f.plain)).slice(0, 3);
        if (hang.length) {
          const fresh = hang.filter(f => !posted.has(f.plain));
          if (fresh.length) {
            setJarvisCoverage(cov => {
              const next = { ...(cov ?? {}) };
              next.interactions = { ...(next.interactions ?? {}) };
              next.interactions.needs = [
                ...(next.interactions.needs ?? []),
                ...fresh.map(f => ({
                  question: f.plain,
                  proposedSolution: f.proposal,
                  evidence: 'Computed from the signal graph — every cross-machine wait paired with its setter, cycles simulated in order.',
                  blocking: true,
                })),
              ];
              return next;
            });
            setChatThread(t => [...t, {
              role: 'jarvis',
              text: `Before this step can check off — the signal check found ${fresh.length === 1 ? 'a handshake that would fault every cycle' : `${fresh.length} handshakes that would fault every cycle`}:\n${fresh.map((f, i) => `Q${i + 1}. ${f.plain}\n   My proposal: ${f.proposal}`).join('\n')}\n\nAnswer here or Agree on the cards, then approve the step.`,
              at: Date.now(),
            }]);
          }
          setApplyHint(`Signal check: ${hang.length} handshake question${hang.length === 1 ? '' : 's'} must be answered (or agreed) before this step checks off.`);
          return; // the step does NOT check off while a can-never-satisfy finding is open
        }
      } catch (e) { console.warn('[handshake-check] skipped:', e.message); }
    }
    setSeqDiff(null); // the highlights served their purpose
    advanceRef.current = true; // auto-advance: the next step opens immediately
    assignGateRef.current = true; // gate: an approve re-runs placement for anything still pending
    if (step.kind === 'smSplit' && step.hasProposal) { approveSmSplit(); return; }
    writeCascade(c => ({
      ...c,
      steps: { ...c.steps, [step.key]: { approved: true, by: 'ME', at: new Date().toISOString() } },
    }));
    if (linkedSmId) appendChangeLog(linkedSmId, { what: `${step.label} approved — locked on the sheet`, class: 'approval' });
    if (advisoryAfter.length) {
      setJarvisCoverage(cov => {
        const next = { ...(cov ?? {}) };
        next.interactions = { ...(next.interactions ?? {}) };
        next.interactions.needs = [
          ...(next.interactions.needs ?? []),
          ...advisoryAfter.map(f => ({
            question: f.plain,
            proposedSolution: f.proposal,
            evidence: 'Computed from the signal graph — every cross-machine wait paired with its setter.',
            blocking: false,
          })),
        ];
        return next;
      });
      setChatThread(t => [...t, {
        role: 'jarvis',
        text: `One more look at the machines' signals (advisory — the step is approved):\n${advisoryAfter.map((f, i) => `Q${i + 1}. ${f.plain}\n   My proposal: ${f.proposal}`).join('\n')}\n\nAgree on the cards, or answer here.`,
        at: Date.now(),
      }]);
    }
    // CONTINUOUS STUDY (Phase 3, Dan 2026-08-30): from the devices step
    // onward, every approval runs the pre-write readiness study on the sheet
    // SO FAR — codegen-blocking questions surface as numbered questions
    // DURING the walk, so Generate starts with zero questions left. Fire and
    // forget: his walk never waits on it. No code is written.
    if (['devices', 'sequence', 'recovery', 'interactions'].includes(step.kind) && !studiedStepsRef.current.has(step.key)) {
      studiedStepsRef.current.add(step.key);
      (async () => {
        try {
          const ms = smProposal?.stateMachines ?? [];
          const sheetText = [
            `Devices: ${(summary?.devices ?? []).map(d => `${d.name}${d.type ? ` (${d.type})` : ''}`).join(', ') || '(none)'}`,
            ...ms.map(m => [
              `## ${m.name}`,
              'Sequence:', ...(m.sequence ?? []).map((l, i) => `${i + 1}. ${l}`),
              ...(m.faultRecovery?.length ? ['Recovery:', ...m.faultRecovery.map(l => `- ${l}`)] : []),
            ].join('\n')),
          ].join('\n\n');
          const priorQuestions = [
            ...[...agreedNeeds],
            ...Object.values(jarvisCoverage ?? {}).flatMap(sec => (sec?.needs ?? []).map(n => n.question)),
            ...qaHistory.flatMap(h => h.questions ?? []),
          ].map(String).filter(Boolean);
          const r = await fetch('/api/jarvis/study-step', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station: name, stepLabel: step.label, sheetText, priorQuestions }),
          });
          if (!r.ok) return;
          const d = await r.json();
          const fresh = (d.questions ?? []).slice(0, 3);
          if (!fresh.length) return;
          const covKey = step.kind === 'recovery' ? 'failures' : step.kind;
          setJarvisCoverage(cov => {
            const next = { ...(cov ?? {}) };
            next[covKey] = { ...(next[covKey] ?? {}) };
            next[covKey].needs = [
              ...(next[covKey].needs ?? []),
              ...fresh.map(q => ({
                question: String(q.question ?? ''),
                proposedSolution: String(q.proposedSolution ?? ''),
                evidence: 'Pre-write study on the approved sheet — asked now so Generate starts with nothing open.',
                blocking: false,
              })),
            ];
            return next;
          });
          setChatThread(t => [...t, {
            role: 'jarvis',
            text: `Studying ahead for the code while you walk — ${fresh.length === 1 ? 'one thing' : `${fresh.length} things`} I'll need before Generate:\n`
              + fresh.map((q, i) => `Q${i + 1}. ${q.question}${q.proposedSolution ? `\n   My proposal: ${q.proposedSolution}` : ''}`).join('\n')
              + '\n\nAgree on the cards, or answer here.',
            at: Date.now(),
          }]);
        } catch (e) { console.warn('[continuous-study] skipped:', e.message); }
      })();
    }
  }

  /** A content edit under an approved step re-opens it and marks every
   *  approved step DOWNSTREAM for re-confirm (Dan's rule). Re-opens ALL
   *  approved steps of the kind — a correction can't say which SM it hit. */
  function touchCascade(kind) {
    if (!kind || !linkedSmId) return;
    const hits = cascade.steps.filter(s => s.kind === kind && s.kind !== 'smSplit' && s.status === 'approved');
    if (!hits.length) return;
    const firstIdx = cascade.steps.findIndex(s => s.key === hits[0].key);
    writeCascade(c => {
      const steps = { ...c.steps };
      for (const h of hits) steps[h.key] = { ...(steps[h.key] ?? {}), approved: false, reconfirm: false, by: 'ME', at: new Date().toISOString() };
      for (const d of cascade.steps.slice(firstIdx + 1)) {
        if (d.status === 'approved' && d.kind !== 'smSplit' && !hits.some(h => h.key === d.key)) {
          steps[d.key] = { ...(steps[d.key] ?? {}), approved: true, reconfirm: true };
        }
      }
      return { ...c, steps };
    });
  }

  /** A cascade talk-back rides THE one corrections pipeline, framed with the
   *  step's scope. Returns false on failure so the box keeps the ME's words. */
  async function sendCascadeTalkback(step, text) {
    const t = String(text ?? '').trim();
    if (!t) return false;
    const scope = step.smKey && step.smKey !== 'station'
      ? `the ${step.smName} state machine's ${KIND_NOUN[step.kind] ?? step.kind}`
      : `the station's ${KIND_NOUN[step.kind] ?? step.kind}`;
    const framed =
      `Cascade review — the engineer is responding to your proposal for ${scope}. He wants:\n${t}\n`
      + 'Apply it there and leave every other section exactly as it was.';
    return sendCorrections(framed, t, []);
  }

  /** Jump from a rail chip to the step's home on the sheet (selecting its SM
   *  first so the target exists on the filtered outputs). */
  function jumpToCascadeStep(step) {
    if (step.smKey && step.smKey !== 'station') selectSheetSm(step.smKey);
    const target = step.kind === 'smSplit' ? 'sheet-state-machines'
      : step.kind === 'devices' ? (step.smKey && step.smKey !== 'station' ? `sheet-sm-group-${step.smKey}` : 'summary-section-devices')
        : step.kind === 'sequence' ? (step.smKey && step.smKey !== 'station' ? `sequence-sm-${step.smKey}` : 'summary-section-sequence')
          : step.kind === 'recovery' ? (step.smKey && step.smKey !== 'station' ? `sequence-sm-${step.smKey}` : 'sequence-recovery')
            : 'summary-section-interactions';
    // Defer one frame so a just-changed SM filter has rendered the target.
    requestAnimationFrame(() => {
      goToBlocker({ target });
      if (!document.querySelector(`[data-testid="${target}"]`)) {
        goToBlocker({ target: `summary-section-${KIND_SECTION[step.kind] === 'failureHandling' ? 'sequence' : (KIND_SECTION[step.kind] ?? 'devices')}` });
      }
    });
  }

  // ── SM TOGGLE (Dan, 2026-08-26): the sheet's outputs show the SELECTED
  // machine; selection syncs BOTH WAYS with the banner chips + the diagram
  // (store.activeSmId) whenever the machines exist as records.
  const smChipEntries = approvedSmDecomp ?? (draftSplitApproved ? draftProposalEntries : null);
  function selectSheetSm(key) {
    setSheetSmKey(key);
    const e = (smChipEntries ?? []).find(x => x.key === key);
    if (e?.smId) store.setActiveSm?.(e.smId); // banner + diagram follow
  }
  const prevActiveSmRef = useRef(store.activeSmId);
  useEffect(() => {
    // Banner chip clicked (activeSmId changed elsewhere) → the sheet follows.
    if (store.activeSmId === prevActiveSmRef.current) return;
    prevActiveSmRef.current = store.activeSmId;
    const hit = (smChipEntries ?? []).find(e => e.smId === store.activeSmId);
    if (hit && sheetSmKey !== hit.key) setSheetSmKey(hit.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activeSmId]);

  // WALK FOLLOWS THE STEP (Dan, 2026-08-27): the sheet auto-filters to the
  // active step's machine, and an Approve scrolls the next step's section
  // into view — the cascade advances immediately, one surface at a time.
  const advanceRef = useRef(false);
  // CONTINUOUS STUDY: step keys already studied this session (one run each).
  const studiedStepsRef = useRef(new Set());
  const prevStepKeyRef = useRef(null);
  useEffect(() => {
    // (phase-based live check — `cascadeLive` is declared further down.)
    const step = phase === 'summary' && cascade.steps.length ? cascade.activeStep : null;
    const key = step?.key ?? null;
    if (key === prevStepKeyRef.current) return;
    prevStepKeyRef.current = key;
    if (!step) return;
    // Auto-filter the outputs to the machine being walked.
    if (step.smKey && step.smKey !== 'station' && sheetSmKey !== step.smKey) {
      selectSheetSm(step.smKey);
    }
    // After an Approve, land on the next step's section.
    if (advanceRef.current) {
      advanceRef.current = false;
      const host = hostSectionOf(step.kind);
      const target = step.kind === 'smSplit' ? 'cascade-smsplit-step' : (host ? `summary-section-${host}` : null);
      if (target) requestAnimationFrame(() => goToBlocker({ target }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cascade]);

  // AUTO-RUN EVERYWHERE (Dan, 2026-08-26 round 2: "Get the proposal" died —
  // an explanation without a proposal has unambiguous intent, resume
  // included). Fires once per mount when the summary is up and step 1 has no
  // proposal yet; never re-runs when a proposal (any size) already exists;
  // a failure parks on the Retry-with-reason state, never a loop.
  useEffect(() => {
    if (autoKickRef.current || phase !== 'summary' || applying || proposeRun) return;
    const step = cascade.activeStep;
    if (!step || step.kind !== 'smSplit' || step.hasProposal) return;
    if (linkedSm?.compiledSequence?.ir) return; // a one-machine proposal exists
    if (!description.trim()) return;
    autoKickRef.current = true;
    kickProposal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cascade, proposeRun, applying]);

  // ── STRICT REVEAL (Dan, 2026-08-26): steps below the current one are
  // HIDDEN entirely — not previews. Jarvis keeps the full extraction
  // internally; only the reveal is gated. ──────────────────────────────────
  const stepStateOf = (kind, smKey = null) => {
    const s = cascade.steps.find(x => x.kind === kind && (smKey == null || x.smKey === smKey));
    return s ? s.status : null;
  };
  /** A step's content shows when the step is up (active) or already settled
   *  (approved / re-confirm). Kinds with no step aren't gated. */
  const stepRevealed = (kind, smKey = null) => {
    if (!cascadeLive) return true;
    const st = stepStateOf(kind, smKey);
    return st === null || st !== 'pending';
  };
  /** Settled = approved / re-confirm (the ACTIVE step's content for these
   *  kinds lives in the step card, not the section — no duplication). */
  const stepSettled = (kind, smKey = null) => {
    if (!cascadeLive) return true;
    const st = stepStateOf(kind, smKey);
    return st === null || st === 'approved' || st === 'reconfirm';
  };
  /** Section-level reveal. Devices reveals when its step is UP (the tables
   *  are that step's working surface); sequence/recovery show settled steps
   *  only (the card carries the active one); interactions reveals when up
   *  (the chips are its editing surface). */
  const sectionRevealed = (sectionKey) => {
    if (!cascadeLive) return true;
    // MACHINE-AWARE (Dan, 2026-08-28: "I shouldn't see the sequence yet —
    // I haven't approved the devices"): with a machine selected, only THAT
    // machine's steps count. On the Escapement's view, the PnP's settled
    // sequence step must not reveal the section — it is ABSENT until the
    // Escapement's own walk reaches it. "All" keeps station-wide reveal.
    const scoped = (steps) => (sheetSmKey !== 'all' ? steps.filter(s => s.smKey === sheetSmKey || s.smKey === 'station') : steps);
    // A section with NO step of its own stays hidden until everything is
    // agreed (strict: nothing about a later stage appears early).
    if (sectionKey === 'devices') {
      const hosted = scoped(cascade.steps.filter(s => s.kind === 'devices'));
      return hosted.length ? hosted.some(s => s.status !== 'pending') : cascade.allApproved;
    }
    if (sectionKey === 'sequence') {
      // THE STEP IS THE SECTION (Dan, 2026-08-27): the active sequence /
      // recovery step renders AS the section — reveal on active too.
      const hosted = scoped(cascade.steps.filter(s => s.kind === 'sequence' || s.kind === 'recovery'));
      return hosted.length ? hosted.some(s => s.status !== 'pending') : cascade.allApproved;
    }
    if (sectionKey === 'interactions') {
      // INTERACTIONS ARE SEQUENCE LINES (Dan, 2026-08-28): during the walk the
      // stored station-level card never shows — the Interactions step is a
      // LENS derived from each machine's sequence, on its sequence card. The
      // stored editor already drifted from the sequence once; never again.
      return false;
    }
    return true;
  };
  // ── STEP-SCOPED QUESTIONS (Dan, 2026-08-26: "questions surface WITH their
  // step" — nothing about a later step appears early). ─────────────────────
  const covOfKind = { devices: 'devices', sequence: 'sequence', recovery: 'failures', interactions: 'interactions' };
  /** EVERY DEVICE HAS A MACHINE — AGENTIC, NOT A RULE SET (Dan, 2026-08-28:
   *  "Why is it a guess? Aren't you using our standards, our history, our
   *  code examples?"). Deterministic layers handle only the CERTAIN cases:
   *    0. the ME said so (explicit move — outranks everything),
   *    1. an exact/contained ownedDeviceNames claim (rename-safe),
   *    2. the AGENT's recorded decision (evidence-cited; precedent:false
   *       carries the searched-and-found-nothing question).
   *  Everything else goes to ONE batched agentic call (assign-devices) that
   *  decides like an SDC CE from precedents + concepts + standing knowledge.
   *  The token-ladder / persisted-auto / silent-fallback guessing is DELETED.
   *  Returns { map, pendingAgent, noPrecedent, evidenceByIdx }. */
  const devAssign = useMemo(() => {
    const entries = smChipEntries ?? panelModel.decomp ?? smDecomp ?? null;
    const map = new Map();
    const pendingAgent = new Set();   // awaiting the agentic decision
    const noPrecedent = new Set();    // agent searched — no SDC example: asks
    const evidenceByIdx = new Map();
    const groups = groupDevicesBySm(entries, summary?.devices ?? []);
    for (const g of groups) for (const { i } of g.devices) map.set(i, g.sm?.key ?? null);
    if (!entries || entries.length < 2) return { map, pendingAgent, noPrecedent, evidenceByIdx };
    (summary?.devices ?? []).forEach((d, i) => {
      const nm = String(d?.displayName ?? d?.name ?? '');
      const rec = deviceAssignments?.[normKey(nm)];
      // Legacy string values were the dead guessing era — ignored entirely.
      const recObj = rec && typeof rec === 'object' ? rec : null;
      // 0. THE ME SAID SO.
      if (recObj?.by === 'ME' && entries.some(e => e.key === recObj.key)) { map.set(i, recObj.key); return; }
      // 1. Owned-name claim (from groupDevicesBySm above).
      if (map.get(i)) return;
      // 2. The agent's recorded, evidence-cited decision.
      if (recObj?.by === 'agent' && entries.some(e => e.key === recObj.key)) {
        map.set(i, recObj.key);
        evidenceByIdx.set(i, recObj.evidence ?? '');
        if (recObj.precedent === false) noPrecedent.add(i);
        return;
      }
      // 3. LAST-KNOWN HOME (Dan's third-vanish, 2026-08-28): a legacy
      //    assignment keeps the device RENDERING exactly where it was — the
      //    render NEVER depends on a live model call. The agentic pass only
      //    ever REFINES it in the background.
      const legacyKey = typeof rec === 'string' && entries.some(e => e.key === rec) ? rec : null;
      if (legacyKey) {
        map.set(i, legacyKey);
        pendingAgent.add(i); // refine quietly; the device stays put meanwhile
        return;
      }
      // 4. Truly unknown → interim home on the last machine (the one-home
      //    invariant), visibly marked pending until the agent decides.
      map.set(i, entries[entries.length - 1].key);
      pendingAgent.add(i);
    });
    return { map, pendingAgent, noPrecedent, evidenceByIdx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedSmDecomp, panelModel, smDecomp, summary, smProposal, localCascade, deviceAssignments]);
  const devSmKeyByIdx = devAssign.map;

  // THE AGENTIC ASSIGNMENT CALL — one cheap batched round for everything the
  // certain layers couldn't place. The receipt cites the precedent per
  // device; no-precedent devices ask on their step. Once per device-set.
  const agentRunRef = useRef('');
  const agentAttemptsRef = useRef({}); // signature -> attempts (cap 2; never a red spam loop)
  // GATE-DRIVEN, NEVER BACKGROUND (Dan, 2026-08-28): the thinker/checker pair
  // runs at the cascade gates only — explanation submitted, split approved,
  // each step Approve. Nothing model-driven fires while he sits on a step.
  const assignGateRef = useRef(false);
  const [assignBusy, setAssignBusy] = useState(false);
  useEffect(() => {
    if (!assignGateRef.current) return;
    if (phase !== 'summary' || !devAssign.pendingAgent.size) { assignGateRef.current = false; return; }
    const entries = smChipEntries ?? [];
    if (entries.length < 2) return;
    const devs = summary?.devices ?? [];
    const pendIdx = [...devAssign.pendingAgent];
    const sig = pendIdx.map(i => normKey(devs[i]?.name)).filter(Boolean).sort().join('|');
    if (!sig || agentRunRef.current === sig) return;
    if ((agentAttemptsRef.current[sig] ?? 0) >= 2) { assignGateRef.current = false; return; } // gave up quietly — last-known homes stand
    assignGateRef.current = false; // the gate token is consumed by this run
    agentRunRef.current = sig;
    agentAttemptsRef.current[sig] = (agentAttemptsRef.current[sig] ?? 0) + 1;
    (async () => {
      setAssignBusy(true);
      try {
        const r = await fetch('/api/jarvis/assign-devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            devices: pendIdx.map(i => ({ name: devs[i]?.name, type: sheetType(devs[i] ?? {}), purpose: devs[i]?.purpose ?? '' })),
            machines: entries.map(e => ({ name: e.name, key: e.key, ownedDeviceNames: e.deviceNames ?? [], sequence: e.sequence ?? [] })),
            description: description.trim(),
            smName: name.trim() || null,
          }),
        });
        const text = await r.text();
        let d = null;
        try { d = JSON.parse(text); } catch { /* non-JSON — named below */ }
        // HONEST FAILURE REASONS (Dan's "(200)" spam, 2026-08-28): a 200 that
        // isn't JSON is a stale server build answering with the app page.
        if (!d) throw new Error(`the API answered with something that isn't JSON (status ${r.status}) — a stale server build; restart the API`);
        if (!r.ok || !d.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        const byName = {};
        for (const a of (d.assignments ?? [])) {
          byName[normKey(a.device)] = { key: a.machineKey, by: 'agent', evidence: a.evidence ?? '', precedent: a.precedent === true };
        }
        // A device the agent skipped still gets a record — as a no-precedent
        // ask, never a silent hole (the one-home invariant).
        for (const i of pendIdx) {
          const k = normKey(devs[i]?.name);
          if (k && !byName[k]) byName[k] = { key: entries[entries.length - 1].key, by: 'agent', evidence: 'no decision returned', precedent: false };
        }
        setDeviceAssignments(prev => {
          const next = { ...(prev ?? {}) };
          for (const [k, v] of Object.entries(byName)) {
            const cur = next[k];
            if (cur && typeof cur === 'object' && cur.by === 'ME') continue; // the ME's word stands
            next[k] = v;
          }
          return next;
        });
        const placed = (d.assignments ?? []).filter(a => a.precedent);
        const unknown = (d.assignments ?? []).filter(a => !a.precedent);
        setChatThread(t => [...t, {
          role: 'jarvis',
          text: [
            placed.length ? `Placed from our shipped work: ${placed.map(a => `${a.device} → ${a.machine} — ${a.evidence}`).join('; ')}.` : null,
            unknown.length ? `No SDC example found for ${unknown.map(a => a.device).join(', ')} — asking on the step.` : null,
          ].filter(Boolean).join(' '),
          at: Date.now(),
        }]);
        if (linkedSmId) {
          for (const a of placed) {
            appendChangeLog(linkedSmId, { what: `${a.device} → ${a.machine} — ${a.evidence}`, class: 'value', costUSD: d.meta?.costUSD ?? null });
          }
        }
      } catch (e) {
        // NEVER a render consequence, NEVER a spam loop: devices keep their
        // last-known homes; one quiet retry, then one honest line and stop.
        const attempts = agentAttemptsRef.current[sig] ?? 1;
        if (attempts >= 2) {
          setChatThread(t => [...t, {
            role: 'jarvis',
            text: `Couldn't check our shipped work for device placement — ${e.message}. The devices stay where they are; I'll try again after the next sheet change.`,
            error: true, at: Date.now(),
          }]);
        }
        agentRunRef.current = ''; // the cap gates the retries
        assignGateRef.current = true; // one quiet retry rides the same gate
      } finally {
        setAssignBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devAssign, phase]);

  // NEVER-SILENT WATCHDOG (Dan, 2026-08-28: "when I say something, it
  // happens" — a user message with no visible consequence within seconds is
  // a hard bug BY DEFINITION). If his last chat turn sits 6s with nothing
  // visibly running and no reply, say so inline and auto-file the bug.
  const applyingWdRef = useRef(applying); applyingWdRef.current = applying;
  const proposeWdRef = useRef(proposeRun); proposeWdRef.current = proposeRun;
  const assignWdRef = useRef(assignBusy); assignWdRef.current = assignBusy;
  const chatLenWdRef = useRef(chatThread.length); chatLenWdRef.current = chatThread.length;
  useEffect(() => {
    const last = chatThread[chatThread.length - 1];
    if (!last || last.role !== 'me') return undefined;
    const seen = chatThread.length;
    const t = setTimeout(() => {
      if (chatLenWdRef.current > seen) return; // a reply landed
      if (applyingWdRef.current || assignWdRef.current || proposeWdRef.current?.stage === 'compile') return; // visibly running
      console.error('[chat] WATCHDOG: a message produced no visible consequence within 6s');
      fetch('/api/jarvis/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'BUG auto-report: a chat message produced no visible consequence within 6s (send-path watchdog)',
          context: String(last.text ?? '').slice(0, 200),
          source: 'auto-invariant',
        }),
      }).catch(() => {});
      setChatThread(x => [...x, {
        role: 'jarvis',
        text: "Your message didn't produce a response — that's a bug on my side and it has been reported.",
        error: true, retryText: String(last.text ?? ''), at: Date.now(),
      }]);
    }, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatThread]);
  // ── ROBUST MACHINE ATTRIBUTION (Dan's live MidBaseLoad round, 2026-08-27:
  // every escapement question rendered on the Pick And Place step; the old
  // rule leaked every UNMATCHED question onto the CURRENT step). Rules now:
  //   1. by REF: the need's `device` field (specAuthor names the device a
  //      question is about) → that device's machine.
  //   2. by tolerant text: normalized substring both directions + camelCase/
  //      space/underscore token containment ("escapement finger 2" ↔
  //      "EscapementFinger2"). Longest matching device name wins.
  //   3. unmatched → the FURTHEST-FUTURE step of the kind — NEVER the current
  //      step unless matched (an alias like "Belco bowl" for FeederBowl can't
  //      be guessed; it waits on the last machine wearing "which machine?").
  /** The machine (entry key) a need belongs to, or null when unattributable. */
  function needOwnerKey(n, entries) {
    const claimOf = (devName) => {
      if (!String(devName ?? '').trim()) return null;
      for (const e of entries) {
        for (const dn of (e.deviceNames ?? [])) {
          if (normKey(dn) === normKey(devName) || nameMatchesText(dn, devName) || nameMatchesText(devName, dn)) return e.key;
        }
      }
      // Sheet-device fallback — the grouped sheet knows every row's machine.
      const idx = (summary?.devices ?? []).findIndex(d =>
        normKey(d?.name) === normKey(devName) || nameMatchesText(d?.name ?? '', devName) || nameMatchesText(devName, d?.name ?? ''));
      return idx !== -1 ? (devSmKeyByIdx.get(idx) ?? null) : null;
    };
    // 1. Explicit device ref wins.
    if (n.device) {
      const k = claimOf(n.device);
      if (k) return k;
    }
    // 2. Tolerant text scan — longest matching device name wins.
    let best = null;
    const consider = (devName, key) => {
      if (!devName || !key) return;
      if (nameMatchesText(devName, n.question) && (!best || String(devName).length > best.len)) {
        best = { key, len: String(devName).length };
      }
    };
    for (const e of entries) for (const dn of (e.deviceNames ?? [])) consider(dn, e.key);
    (summary?.devices ?? []).forEach((d, i) => consider(d?.displayName ?? d?.name, devSmKeyByIdx.get(i)));
    return best?.key ?? null;
  }
  /** The active step's open questions — a need belonging to another machine
   *  waits for THAT machine's step; unattributable needs ride the LAST step
   *  of the kind (never an earlier one). */
  function needsForStep(step) {
    const covKey = covOfKind[step.kind];
    if (!covKey || !jarvisCoverage) return [];
    const open = (jarvisCoverage[covKey]?.needs ?? [])
      .filter(n => !agreedNeeds.has(`${covKey}:${n.question}`))
      .map(n => ({ ...n, covKey }));
    if (!step.smKey || step.smKey === 'station') return open;
    const entries = smChipEntries ?? panelModel.decomp ?? smDecomp ?? [];
    if (entries.length < 2) return open;
    const kindSteps = cascade.steps.filter(s => s.kind === step.kind);
    const isLastOfKind = kindSteps.length > 0 && kindSteps[kindSteps.length - 1].key === step.key;
    const routed = open
      .map(n => ({ ...n, _owner: needOwnerKey(n, entries) }))
      .filter(n => n._owner === step.smKey || (n._owner === null && isLastOfKind))
      .map(({ _owner, ...n }) => (_owner === null ? { ...n, unattributed: true } : n));
    // NO-PRECEDENT ASKS (Dan, 2026-08-28): a precedent-backed placement is
    // CONFIDENT — no question, the receipt cites the evidence. Only a device
    // the search genuinely found nothing for asks — and the question SHOWS
    // the search, on the step where the device sits.
    if (step.kind === 'devices') {
      for (const i of devAssign.noPrecedent) {
        if (devAssign.map.get(i) !== step.smKey) continue;
        const dn = String((summary?.devices ?? [])[i]?.name ?? '');
        if (!dn) continue;
        const q = `I searched our shipped work and standards — no example of a ${dn} on any station. Where does it belong?`;
        if (agreedNeeds.has(`devices:${q}`)) continue;
        routed.push({
          question: q,
          proposedSolution: devAssign.evidenceByIdx.get(i)
            || `My best read: keep it on ${step.smName} — name the right machine in the chat ("${dn} belongs to …") and I move it AND record the ruling`,
          blocking: false, covKey: 'devices',
        });
      }
    }
    return routed;
  }
  /** The active devices step's value-asks (servo tables, geometry) — only
   *  the step's own SM's devices. */
  function valueAsksForStep(step) {
    if (step.kind !== 'devices') return [];
    const ownIdx = (i) => {
      if (!step.smKey || step.smKey === 'station') return true;
      const k = devSmKeyByIdx.get(i);
      return k == null || k === step.smKey;
    };
    const out = sheetBlockers()
      .filter(b => /^servo/.test(b.key))
      .filter(b => { const m = String(b.target ?? '').match(/sheet-servo-(\d+)/); return m ? ownIdx(+m[1]) : true; })
      .map(b => ({ label: b.label, onClick: () => goToBlocker(b) }));
    for (const g of sheetGeometryIssues(summary?.devices)) {
      const di = (summary?.devices ?? []).findIndex(d => (d?.name || '') === g.axisName);
      if (di !== -1 && !ownIdx(di)) continue;
      out.push({
        label: `${g.axisName}: ${g.message}`,
        onClick: () => goToBlocker({ target: di >= 0 ? `sheet-servo-${di}` : 'summary-section-devices' }),
      });
    }
    return out;
  }

  // RECONCILE ON LOAD (Dan's Finger-2 P0, 2026-08-28): before the atomic-
  // removal fix, an engine round could drop a device from the proposal while
  // its sheet row (and open question) survived. On load: if the ME explicitly
  // asked to remove a device in this draft's chat, AND the current proposal
  // neither owns nor mentions it, the removal finally LANDS — sheet row out,
  // questions closed, one honest chat line. Both conditions required: an
  // explicit directive alone or an unowned device alone never deletes.
  const reconciledDraftRef = useRef(null);
  useEffect(() => {
    if (phase !== 'summary' || !smProposal?.stateMachines?.length) return;
    if (reconciledDraftRef.current === (draftIdRef.current ?? draftKey)) return;
    reconciledDraftRef.current = draftIdRef.current ?? draftKey;
    // MISAPPLY REPAIR (Dan, 2026-08-28, one-time): tag-only feedback got read
    // as line deletions — Home, the part-clear wait, and Repeat were struck
    // from the Escapement sequence he never asked to change. Fingerprinted
    // tightly to that exact damaged state; restores the three steps with an
    // honest line. (The tags he DID ask removed are gone via the canonical
    // tag derivation — no data change needed for those.)
    {
      const esc = smProposal.stateMachines.find(m => /escapement/i.test(m?.name ?? ''));
      const seq = (esc?.sequence ?? []).map(x => String(x));
      const damaged = esc
        && seq[0] === 'Retract Escapement Finger 1 to release the stopped part into the shuttle nest'
        && !seq.some(l => /part-clear/i.test(l)) && !seq.some(l => /^repeat\b/i.test(l))
        && !seq.some(l => /^home\b/i.test(l))
        && seq.some(l => /^retract escapement shuttle/i.test(l))
        && chatThread.some(t => t?.role === 'jarvis' && /Done — 3 changes to Mid-?Base Escapement/i.test(t?.text ?? ''));
      if (damaged) {
        const restored = [
          'Home: Escapement Shuttle retracted and aligned with track, Shuttle Gripper open, Escapement Finger 1 extended holding the next part at the stop',
          ...seq.slice(0, seq.findIndex(l => /^retract escapement shuttle/i.test(l))),
        ];
        restored.push("Wait for Mid-Base Pick and Place's part-clear signal");
        restored.push(...seq.filter(l => /^retract escapement shuttle/i.test(l)));
        restored.push('Repeat');
        setSmProposal(p => ({
          ...p,
          stateMachines: p.stateMachines.map(m => (m === esc || m?.name === esc.name
            ? { ...m, sequence: restored } : m)),
        }));
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: 'Put back 3 steps I struck out by mistake — you asked me to remove two interaction tags, not the steps. Home, the part-clear wait, and Repeat are restored; only the tags are gone.',
          at: Date.now(),
        }]);
      }
    }
    // Q2 REPAIR (Dan, 2026-08-30, one-time): his two-part answer closed only
    // Q1 — the second half ("For question two, no. Well, we always check…
    // the next station will be a check station… in this case, we don't have
    // that") answered the dial-landing question and the turn never consumed
    // it. Tightly fingerprinted; closes with his answer and says so once.
    {
      const q2 = 'Any check that the part actually landed on the dial fixture?';
      const q2Key = Object.keys(jarvisCoverage ?? {})
        .map(k => ({ k, n: (jarvisCoverage?.[k]?.needs ?? []).find(x => x?.question === q2) }))
        .find(x => x.n);
      const answered = chatThread.some(t => t?.role === 'me'
        && /for question two[\s\S]*next station will be a check station/i.test(String(t.text ?? '')));
      if (q2Key && answered && !agreedNeeds.has(`${q2Key.k}:${q2}`)) {
        setAgreedNeeds(prev => new Set([...prev, `${q2Key.k}:${q2}`]));
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: 'Q2 — taken from your earlier answer: no landing check at this station; SDC usually verifies at the next check station, and this machine doesn\'t have one. Filed and closed.',
          at: Date.now(),
        }]);
      }
    }
    // ESCAPEMENT RECOVERY REPAIR (Dan, 2026-08-30, one-time): his full
    // recovery dictation ("check to see if you're gripped… if no part or not
    // gripped, open up, reset, and go back") hit the 400, and the resend got
    // consumed by the Q1/Q2 answers — the recovery content dropped. Applied
    // here from his own words in the thread; the starved-feed lines stay.
    {
      const esc2 = smProposal.stateMachines.find(m => /escapement/i.test(m?.name ?? ''));
      const saidIt = chatThread.some(t => t?.role === 'me'
        && /for the escapement[\s\S]{0,40}the recovery/i.test(String(t.text ?? ''))
        && /gripped/i.test(String(t.text ?? '')));
      const missing = esc2 && !(esc2.faultRecovery ?? []).some(l => /gripped/i.test(String(l)));
      if (saidIt && missing) {
        const starved = (esc2.faultRecovery ?? []).filter(l => /part present|starved|fault/i.test(String(l)));
        const recovered = [
          'Check Shuttle Gripper and Nest Part Present — gripped with a part → finish forward; no part or not gripped → reset to home',
          'Extend Escapement Shuttle — gripped with a part but not at the load position: move to the load position',
          'Signal part ready for pick to Mid-Base Pick and Place — gripped with a part at the load position: hold, ready for pick',
          'Disengage Shuttle Gripper — no part or not gripped',
          'Retract Escapement Shuttle — back to the feeder-bowl alignment',
          'Extend Escapement Finger 1 — finger down, holding the queue: home position',
          ...starved,
        ];
        setSmProposal(p => ({
          ...p,
          stateMachines: p.stateMachines.map(m => (/escapement/i.test(m?.name ?? '')
            ? { ...m, faultRecovery: recovered } : m)),
        }));
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: 'Your Escapement recovery from earlier is on its FAULT RECOVERY panel now — gripped with a part: finish forward to the load position and hold ready; no part or not gripped: gripper open, shuttle back to the feeder bowl, finger down — which is also home. The starved-feed handling stays. (That message got dropped when its resend went to the two questions — fixed on my side.)',
          at: Date.now(),
        }]);
      }
    }
    // OUTGOING-SIGNAL RESTORE (P0, 2026-08-30): the 11-change rewrite of the
    // Pick and Place sequence dropped its outgoing handshake signals — the
    // part-gripped signal lost its counterpart pairing (unpairable phrasing)
    // and the part-clear signal step vanished entirely. Both machines
    // deadlock: PnP stuck on the gripper-open wait, Escapement on
    // part-gripped. SIGNALS ARE LEGAL DATA STEPS even though the flow render
    // doesn't draw them as nodes. Tightly fingerprinted; restores his
    // approved shape and red-marks the card.
    {
      const pnp = smProposal.stateMachines.find(m => /pick.?and.?place/i.test(m?.name ?? ''));
      const esc2 = smProposal.stateMachines.find(m => /escapement/i.test(m?.name ?? ''));
      const seqP = (pnp?.sequence ?? []).map(String);
      const grippedIdx = seqP.findIndex(l => /^signal\s+escapement:?\s*part\s*gripped\s*$/i.test(l));
      const clearMissing = esc2 && (esc2.sequence ?? []).some(l => /part-?\s*clear/i.test(String(l)))
        && !seqP.some(l => /^signal\b.*part\s*-?\s*clear/i.test(l));
      if (pnp && esc2 && grippedIdx >= 0 && clearMissing) {
        const escName = esc2.name;
        const lines = [...seqP];
        const steps = (pnp.sequenceSteps ?? []).map(s => (s && typeof s === 'object' ? { ...s } : s));
        // 1. Re-pair the part-gripped signal (canonical interaction shape —
        //    "Signal X to <machine>" is what the deadlock check pairs on).
        lines[grippedIdx] = `Signal part gripped to ${escName}`;
        if (steps[grippedIdx]) steps[grippedIdx] = { ...steps[grippedIdx], action: 'Signal', target: 'part gripped', detail: '', counterpart: escName };
        // 2. Restore the part-clear signal right after the clear-height
        //    retract (first Retract after the gripper-open wait).
        const waitIdx = lines.findIndex(l => /^wait\b/i.test(l) && /gripper\s*open/i.test(l));
        let retractIdx = -1;
        for (let i = Math.max(waitIdx, 0); i < lines.length; i++) { if (/^retract\b/i.test(lines[i])) { retractIdx = i; break; } }
        const insertAt = (retractIdx >= 0 ? retractIdx : Math.max(waitIdx, grippedIdx)) + 1;
        lines.splice(insertAt, 0, `Signal part clear to ${escName}`);
        steps.splice(insertAt, 0, { action: 'Signal', target: 'part clear', detail: '', counterpart: escName });
        const oldMs2 = smProposal.stateMachines.map(m => ({ name: m.name, sequence: [...(m.sequence ?? [])], faultRecovery: [...(m.faultRecovery ?? [])] }));
        const patched = smProposal.stateMachines.map(m => (m === pnp ? { ...m, sequence: lines, sequenceSteps: steps } : m));
        setSmProposal(p => ({
          ...p,
          stateMachines: (p.stateMachines ?? []).map(m => (/pick.?and.?place/i.test(m?.name ?? '') ? { ...m, sequence: lines, sequenceSteps: steps } : m)),
          at: Date.now(),
        }));
        try {
          const byKey = computeProposalSeqDiff(oldMs2, patched, 'sequence');
          if (Object.keys(byKey).length) setSeqDiff({ byKey, at: Date.now() });
        } catch { /* red marks are best-effort */ }
        setDirty(true);
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: `Restored ${pnp.name}'s two outgoing handshake signals that an earlier rewrite dropped: "Signal part gripped to ${escName}" right after the grip, and "Signal part clear to ${escName}" right after the retract to clear height. Without them ${escName} waits forever at its part-gripped and part-clear steps. Marked red on the card — hit ✓ got it once you've looked.`,
          at: Date.now(),
        }]);
      }
    }
    // HANDOFF REPAIR (P0, Dan 2026-08-31): builds before today dropped the
    // approved recoveries/steps on the draft→station handoff (the smSplit
    // mapping carried only name/devices/sequence) — FAULT RECOVERY panels
    // read "Nothing drafted yet" on a fully-walked station. Fingerprint: a
    // linked station whose smSplit entry lacks recovery while the draft's
    // matching machine has it → mirror the approved content in, verbatim.
    if (linkedSmId) {
      try {
        const smNow = useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId);
        const spec = smNow?.machineSpec;
        if (smNow && Array.isArray(spec?.smSplit) && spec.smSplit.length) {
          const byName = new Map(smProposal.stateMachines.map(m => [normKey(m?.name ?? ''), m]));
          let repaired = 0;
          const nextSplit = spec.smSplit.map(e => {
            const m = byName.get(normKey(e?.name ?? ''));
            if (!m) return e;
            const needsRec = (m.faultRecovery?.length ?? 0) > 0 && !(e.faultRecovery?.length);
            const needsSteps = m.sequenceSteps && !e.sequenceSteps;
            // STRUCTURE, NOT PREFIXED STRINGS (Dan, 2026-08-31): recovery
            // lines without the {decision, branches} shape degrade the Y
            // flow to a list — carry/derive the structure whenever missing.
            const needsRecSteps = !e.faultRecoverySteps
              && (m.faultRecoverySteps?.some?.(x => x && typeof x === 'object' && x.decision)
                || restructureRecoveryLines(e.faultRecovery ?? []));
            if (!needsRec && !needsSteps && !needsRecSteps) return e;
            repaired++;
            return {
              ...e,
              ...(needsRec ? { faultRecovery: [...m.faultRecovery] } : {}),
              ...(needsSteps ? { sequenceSteps: m.sequenceSteps } : {}),
              ...(needsRecSteps || needsRec ? {
                faultRecoverySteps: (m.faultRecoverySteps?.some?.(x => x && typeof x === 'object' && x.decision)
                  ? m.faultRecoverySteps
                  : restructureRecoveryLines((needsRec ? m.faultRecovery : e.faultRecovery) ?? [])) ?? undefined,
              } : {}),
            };
          });
          if (repaired) {
            store.updateStateMachine(linkedSmId, { machineSpec: { ...spec, smSplit: nextSplit } });
            setChatThread(th => [...th, {
              role: 'jarvis',
              text: `Carried your approved fault recoveries onto the built station — the handoff had dropped them (${repaired} machine${repaired === 1 ? '' : 's'} repaired, content verbatim from what you approved). The FAULT RECOVERY panels read them now.`,
              at: Date.now(),
            }]);
          }
        }
      } catch (e) { console.warn('[handoff-repair] skipped:', e.message); }
    }
    // DEVICE-LINK MIGRATION (Dan, 2026-08-30: "Z"/"X" shorthand — "the
    // sequence can't be different names, it's got to be based on the
    // devices always"): every action line resolves to a REAL device row
    // (devId link) and re-renders with the device's CURRENT name. Shorthand
    // resolves via the machine's devices + motion words; anything genuinely
    // unresolvable files a question — never a silent guess.
    {
      const devices = (summary?.devices ?? []).filter(dv => dv?.devId);
      const resolveDevice = (targetText) => {
        const tk = devKey(targetText);
        if (!tk) return null;
        let hit = devices.find(dv => { const k = devKey(dv.displayName ?? dv.name); return k === tk || k.includes(tk) || tk.includes(k); });
        if (hit) return hit;
        const low = ` ${String(targetText).toLowerCase()} `;
        if (/[^a-z]z[^a-z]|z ?slide|vertical/.test(low)) {
          hit = devices.find(dv => /vertical|z ?slide/i.test(String(dv.displayName ?? dv.name)));
        } else if (/[^a-z]x[^a-z]|x ?axis|horizontal/.test(low)) {
          hit = devices.find(dv => /x ?axis|horizontal/i.test(String(dv.displayName ?? dv.name)));
        }
        return hit ?? null;
      };
      const MOTION = /^(extend|retract|engage|disengage|servo move|move|index)$/i;
      const parseLine = (l) => {
        const { type, rest } = splitSeqLine(normalizeSeqLine(l), false);
        const [target, ...d2] = String(rest).split(' — ');
        return { action: type, target: (target ?? '').trim(), detail: d2.join(' — ').trim() };
      };
      const compose = (s) => {
        const a = String(s.action ?? '').toLowerCase();
        if (a === 'wait') return `Wait for ${s.target}${s.detail ? ` — ${s.detail}` : ''}`;
        if (a === 'home') return `Home: ${[s.target, s.detail].filter(Boolean).join(' — ') || 'initial position'}`;
        if (a === 'repeat') return 'Repeat';
        if (a === 'signal') return `Signal ${s.target}${s.detail ? ` — ${s.detail}` : ''}`;
        return `${s.action}${s.target ? ` ${s.target}` : ''}${s.detail ? ` — ${s.detail}` : ''}`.trim();
      };
      const unresolved = [];
      let anyChange = false;
      const oldMs = smProposal.stateMachines.map(m => ({ name: m.name, sequence: [...(m.sequence ?? [])], faultRecovery: [...(m.faultRecovery ?? [])] }));
      const nextMs = smProposal.stateMachines.map(m => {
        const migrateList = (lines, steps) => {
          const outLines = []; const outSteps = [];
          (lines ?? []).forEach((l, i) => {
            const prior = Array.isArray(steps) && steps[i] && typeof steps[i] === 'object' ? { ...steps[i] } : parseLine(l);
            const s = prior.raw ? parseLine(prior.raw) : prior;
            // Device-first shorthand ("Z extend down to pick", "X to place
            // position"): the letter IS the device; re-shape to verb-first.
            if (/^[zx]$/i.test(s.action ?? '') ) {
              const dev = resolveDevice(s.action);
              if (dev) {
                const m2 = String(s.target ?? '').match(/^(extend|retract|move|down|up|to)\b\s*(.*)$/i);
                const verb = (m2?.[1] ?? '').toLowerCase();
                s.detail = [m2 ? m2[2] : s.target, s.detail].filter(Boolean).join(' — ');
                s.action = verb === 'retract' ? 'Retract'
                  : (verb === 'extend' || verb === 'down') ? 'Extend'
                    : /axis/i.test(String(dev.displayName ?? dev.name)) ? 'Servo Move' : 'Extend';
                s.target = String(dev.displayName ?? dev.name);
                s.deviceId = dev.devId;
                anyChange = true;
              }
            }
            const isMotion = MOTION.test(s.action ?? '');
            // Interaction lines (counterpart-shaped) and non-device lines
            // never resolve against devices.
            const isSignalLine = /^(signal|home|repeat)$/i.test(s.action ?? '') || Boolean(s.counterpart)
              || /^wait\s+for\s+.+?['’]s\s/i.test(String(l))
              || /^◇/.test(String(l)) || /^[A-Za-z][A-Za-z ]{0,12}:\s/.test(String(l)); // decision/branch flat lines
            if (!s.deviceId && !isSignalLine && s.target) {
              const dev = resolveDevice(s.target);
              if (dev) {
                const cur = String(dev.displayName ?? dev.name);
                if (devKey(s.target) !== devKey(cur) || !s.deviceId) anyChange = true;
                s.deviceId = dev.devId;
                // Waits keep sensor phrasing; motion targets become the name.
                s.target = isMotion ? cur : String(s.target).replace(/^z\b|z ?slide|vertical slide/i, cur).replace(/^x\b|x ?axis/i, cur);
                if (isMotion) s.target = cur;
              } else if (isMotion) {
                unresolved.push({ machine: m.name, line: l });
              }
            } else if (s.deviceId) {
              const dev = devices.find(dv => dv.devId === s.deviceId);
              if (dev && devKey(s.target) !== devKey(dev.displayName ?? dev.name)) {
                s.target = String(dev.displayName ?? dev.name);
                anyChange = true;
              }
            }
            // DETAIL RULES BY DEVICE TYPE (Dan, 2026-08-30): a pneumatic
            // action IS the whole statement — no trailing clause; Servo Move
            // keeps its NAMED POSITION, Title Case. Waits title-case their
            // named object.
            const linkedDev = s.deviceId ? devices.find(dv => dv.devId === s.deviceId) : null;
            if (linkedDev && /^(extend|retract|engage|disengage)$/i.test(s.action ?? '') && isPneumaticSheet(linkedDev) && s.detail) {
              s.detail = ''; anyChange = true;
            }
            if (/^servo move$/i.test(s.action ?? '') && s.detail) {
              const tc = titleCaseName(s.detail.replace(/^to\s+/i, ''));
              if (tc !== s.detail) { s.detail = tc; anyChange = true; }
            }
            if (/^wait$/i.test(s.action ?? '') && !isSignalLine && s.target) {
              const tc = titleCaseName(s.target);
              if (tc !== s.target) { s.target = tc; anyChange = true; }
            }
            const line2 = s.counterpart
              ? l // interaction lines keep their canonical two-shape text
              : compose(s);
            if (line2 !== l) anyChange = true;
            outLines.push(line2); outSteps.push(s);
          });
          return { outLines, outSteps };
        };
        const seqR = migrateList(m.sequence, m.sequenceSteps);
        // Structured (branching) recoveries are already device-linked and
        // flatten to multi-line-per-item — the line migration must NOT walk
        // them (item/line misalignment crashed the render, 2026-08-30).
        const recStructured = (m.faultRecoverySteps ?? []).some(x => x && typeof x === 'object' && x.decision);
        const recR = recStructured
          ? { outLines: m.faultRecovery ?? [], outSteps: m.faultRecoverySteps }
          : migrateList(m.faultRecovery, m.faultRecoverySteps);
        return {
          ...m,
          sequence: seqR.outLines, sequenceSteps: seqR.outSteps,
          faultRecovery: recR.outLines, faultRecoverySteps: recR.outSteps,
        };
      });
      if (anyChange) {
        setSmProposal(p => ({ ...p, stateMachines: nextMs }));
        setDirty(true);
        const sd = computeProposalSeqDiff(oldMs, nextMs, 'sequence');
        if (Object.keys(sd).length) setSeqDiff({ byKey: sd, at: Date.now() });
        const rd = computeProposalSeqDiff(oldMs, nextMs, 'faultRecovery');
        if (Object.keys(rd).length) setRecDiff({ byKey: rd, at: Date.now() });
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: 'Linked every sequence and recovery line to its real device — shorthand like "Z" and "X" now reads as the device itself (Vertical Slide, X Axis) and follows any rename automatically. The reworded lines are highlighted; ✓ got it clears them.',
          at: Date.now(),
        }]);
      }
      for (const u of unresolved.slice(0, 3)) {
        setJarvisCoverage(cov => {
          const next = { ...(cov ?? {}) };
          next.devices = { ...(next.devices ?? {}) };
          const q = `The line "${u.line}" on ${u.machine} names a device I can't find on the sheet. Which device is it?`;
          if (!(next.devices.needs ?? []).some(n => n.question === q)) {
            next.devices.needs = [...(next.devices.needs ?? []), { question: q, evidence: 'Found while linking sequence lines to real devices — no matching device row.', blocking: false }];
          }
          return next;
        });
      }
    }
    // RECOVERY RE-FIT ONTO THE SHIPPED TEMPLATE (Dan, 2026-08-30): prose
    // recoveries with inline "if"s re-shape onto the SDCStandardPNP home
    // pattern — retract vertical → BRANCH on gripper (carry-forward vs
    // empty-return) → known safe state. Content preserved; shape becomes
    // the same branching flow the diagram + codegen use. One-time per
    // machine (fingerprint: inline-if prose, no structure yet).
    {
      const devs2 = (summary?.devices ?? []).filter(dv => dv?.devId);
      const findDev = (re) => devs2.find(dv => re.test(String(dv.displayName ?? dv.name)));
      const needsRefit = (m) => (m.faultRecovery ?? []).some(l => /—\s*if |if gripper|gripped with a part|no part or not gripped/i.test(String(l)))
        && !(m.faultRecoverySteps ?? []).some(x => x && typeof x === 'object' && x.decision);
      const oldMs2 = smProposal.stateMachines.map(m => ({ name: m.name, faultRecovery: [...(m.faultRecovery ?? [])] }));
      let refitAny = false;
      const nextMs2 = smProposal.stateMachines.map(m => {
        if (!needsRefit(m)) return m;
        const vert = findDev(/vertical|z ?slide|pneumatic cylinder/i);
        const x = findDev(/x ?axis|horizontal/i);
        const shuttle = findDev(/escapement ?shuttle$|shuttle$/i) ?? findDev(/shuttle/i);
        const gripper = findDev(/shuttle ?gripper/i) ?? findDev(/gripper/i);
        const finger = findDev(/finger ?(1|one)/i);
        let items = null;
        if (/pick/i.test(m.name) && vert && x) {
          items = [
            { action: 'Retract', target: String(vert.displayName ?? vert.name), deviceId: vert.devId },
            {
              decision: 'Gripper Engaged?',
              branches: [
                { label: 'Yes', steps: [
                  { action: 'Servo Move', target: String(x.displayName ?? x.name), detail: 'Place Position', deviceId: x.devId },
                  { action: 'Wait', target: 'Dial Ready Signal' },
                  'Rejoin the normal place flow',
                ] },
                { label: 'No', steps: [
                  { action: 'Servo Move', target: String(x.displayName ?? x.name), detail: 'Pick Position', deviceId: x.devId },
                  'Rejoin the normal pick flow',
                ] },
              ],
            },
          ];
        } else if (/escapement/i.test(m.name) && shuttle && gripper) {
          const starved = (m.faultRecovery ?? []).filter(l => /part present|starved|fault the station|no part feeds/i.test(String(l)) && !/gripped/i.test(String(l)));
          items = [
            {
              decision: 'Gripped With A Part?',
              branches: [
                { label: 'Yes', steps: [
                  { action: 'Extend', target: String(shuttle.displayName ?? shuttle.name), deviceId: shuttle.devId },
                  { action: 'Signal', target: 'Part Ready For Pick' },
                  'Hold — Ready For Pick',
                ] },
                { label: 'No', steps: [
                  { action: 'Disengage', target: String(gripper.displayName ?? gripper.name), deviceId: gripper.devId },
                  { action: 'Retract', target: String(shuttle.displayName ?? shuttle.name), deviceId: shuttle.devId },
                  ...(finger ? [{ action: 'Extend', target: String(finger.displayName ?? finger.name), deviceId: finger.devId }] : []),
                  'Home',
                ] },
              ],
            },
            ...starved,
          ];
        }
        if (!items) return m;
        refitAny = true;
        return { ...m, faultRecoverySteps: items, faultRecovery: flattenRecoveryClient(items, composeStepClient) };
      });
      if (refitAny) {
        setSmProposal(p => ({ ...p, stateMachines: nextMs2 }));
        setDirty(true);
        const rd2 = computeProposalSeqDiff(oldMs2, nextMs2, 'faultRecovery');
        if (Object.keys(rd2).length) setRecDiff({ byKey: rd2, at: Date.now() });
        setChatThread(th => [...th, {
          role: 'jarvis',
          text: 'Re-shaped the recoveries onto our shipped home pattern (the standard PNP init: retract the vertical motion, branch on the gripper — carrying finishes forward, empty returns) — same content, drawn as branches now, like the diagram. The changed panels are marked; ✓ got it clears them.',
          at: Date.now(),
        }]);
      }
    }
    const ownedKeys = new Set(smProposal.stateMachines.flatMap(m => m.ownedDeviceNames ?? []).map(devKey));
    const prose = smProposal.stateMachines
      .flatMap(m => [...(m.sequence ?? []), ...(m.faultRecovery ?? [])]).map(devKey).join('|');
    const spellNums = (t) => String(t ?? '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase().replace(/[0-9]/g, (ch) => ` ${NUM_WORDS[+ch]}`);
    const meText = chatThread.filter(t => t?.role === 'me').map(t => spellNums(t.text)).join(' … ');
    const askedToRemove = (nm) => {
      const words = spellNums(nm).split(/[^a-z]+/).filter(w => w.length > 1);
      if (!words.length) return false;
      const tail = words.slice(-2).join('[^a-z]{0,3}');
      return new RegExp(`(drop|remove|delete|get rid of|lose|don't need|do not need|without the)[^.!?]{0,60}${tail}`, 'i').test(meText);
    };
    const gone = (summary?.devices ?? [])
      .map(dv => String(dv?.displayName ?? dv?.name ?? ''))
      .filter(nm => {
        const k = devKey(nm);
        return k && !ownedKeys.has(k) && ![...ownedKeys].some(o => o.includes(k) || k.includes(o))
          && !prose.includes(k) && askedToRemove(nm);
      });
    if (!gone.length) return;
    const isGone = (nm) => gone.some(g => devKey(g) === devKey(nm));
    setSummary(s => withSheetPrefill({
      ...s,
      devices: (s.devices ?? []).filter(dv => !isGone(dv?.displayName ?? dv?.name ?? '')),
    }));
    setDirty(true);
    setAgreedNeeds(prev => {
      const next = new Set(prev);
      for (const covKey of Object.keys(jarvisCoverage ?? {})) {
        for (const n of (jarvisCoverage?.[covKey]?.needs ?? [])) {
          const qk = devKey(n?.question ?? '');
          if ((n?.device && isGone(n.device)) || gone.some(nm => { const k = devKey(nm); return qk.includes(k) || (k.length > 8 && qk.includes(k.slice(-8))); })) {
            next.add(`${covKey}:${n.question}`);
          }
        }
      }
      return next;
    });
    setDeviceAssignments(prev => {
      const next = { ...(prev ?? {}) };
      for (const nm of Object.keys(next)) { if (isGone(nm)) delete next[nm]; }
      return next;
    });
    setChatThread(th => [...th, {
      role: 'jarvis',
      text: `Cleaned up: ${gone.join(' and ')} — you asked me to drop ${gone.length === 1 ? 'it' : 'them'} and the proposal did, but the sheet row survived. It's out now and its open question is closed.`,
      at: Date.now(),
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, smProposal, draftKey]);

  // ── LIVE DRAFT SYNC (Dan, 2026-08-30: the 7-line recovery he couldn't
  // see): the server is the source of truth; this page SUBSCRIBES. Any
  // write from anywhere — an agent turn, a repair, another tab — renders
  // here within ~1s, its changes marked RED until "✓ got it". This tab's
  // own writes echo back with our CLIENT_ID and only advance the rev. ────
  const adoptServerDraftRef = useRef(null);
  adoptServerDraftRef.current = (draft, rev, updatedBy) => {
    if (!draft || typeof draft !== 'object') return;
    const oldMachines = (smProposal?.stateMachines ?? []).map(m => ({
      name: m.name, sequence: [...(m.sequence ?? [])], faultRecovery: [...(m.faultRecovery ?? [])],
    }));
    const newMachines = draft.smProposal?.stateMachines ?? [];
    // Land the state (the same setters every apply path uses).
    if (isStructuredSummary(draft.summary)) setSummary(withSheetPrefill(draft.summary));
    if (draft.smProposal?.stateMachines) setSmProposal(p => ({ ...(p ?? {}), stateMachines: draft.smProposal.stateMachines, at: Date.now() }));
    if (draft.jarvisCoverage) setJarvisCoverage(normCoverage(draft.jarvisCoverage));
    if (Array.isArray(draft.agreedNeeds)) setAgreedNeeds(new Set(draft.agreedNeeds));
    if (draft.deviceAssignments) setDeviceAssignments(draft.deviceAssignments);
    if (Array.isArray(draft.explanationLayers)) setExplLayers(draft.explanationLayers);
    if (draft.stationAccepted) setStationAccepted(draft.stationAccepted);
    setChatThread(t => ((draft.chatThread?.length ?? 0) > t.length ? draft.chatThread : t));
    if (draft.cascadeLocal) setLocalCascade(draft.cascadeLocal);
    lastServerRevRef.current = Number(rev) || lastServerRevRef.current;
    // THE RED (the loop contract): mark exactly what changed.
    if (newMachines.length) {
      const sd = computeProposalSeqDiff(oldMachines, newMachines, 'sequence');
      if (Object.keys(sd).length) setSeqDiff({ byKey: sd, at: Date.now() });
      const rd = computeProposalSeqDiff(oldMachines, newMachines, 'faultRecovery');
      if (Object.keys(rd).length) setRecDiff({ byKey: rd, at: Date.now() });
      const oldDevs = new Set((summary?.devices ?? []).map(x => normKey(x?.displayName ?? x?.name)));
      const changedDevs = (draft.summary?.devices ?? [])
        .map(x => String(x?.displayName ?? x?.name ?? ''))
        .filter(nm => !oldDevs.has(normKey(nm)));
      const removedDevs = (summary?.devices ?? [])
        .map(x => String(x?.displayName ?? x?.name ?? ''))
        .filter(nm => !(draft.summary?.devices ?? []).some(y => normKey(y?.displayName ?? y?.name) === normKey(nm)));
      const names = [...changedDevs, ...removedDevs];
      if (names.length) setDevChanged({ names, at: Date.now() });
    }
    console.log(`[draft-sync] adopted server rev ${rev} (by ${updatedBy ?? '?'})`);
  };
  useEffect(() => {
    const id = draftIdRef.current;
    if (!id || phase !== 'summary') return undefined;
    let es = null;
    let dead = false;
    (async () => {
      // MIGRATION-SAFE INITIAL RECONCILE: adopt the server copy only when a
      // non-client writer (an agent) has something newer than this tab's
      // state — his manual edits always win otherwise.
      try {
        const r = await fetch(`/api/jarvis/sheet-draft?draftId=${encodeURIComponent(id)}`);
        const d = await r.json().catch(() => null);
        if (d?.ok) {
          const localSavedAt = Number(draft?.savedAt) || 0;
          if (d.draft && d.updatedBy === 'agent' && Number(d.updatedAt) > localSavedAt) {
            adoptServerDraftRef.current?.(d.draft, d.rev, d.updatedBy);
          } else {
            lastServerRevRef.current = Number(d.rev) || 0;
          }
        }
      } catch { /* subscribe anyway; the next event carries the rev */ }
      if (dead) return;
      es = new EventSource(`/api/jarvis/draft-events?draftId=${encodeURIComponent(id)}&clientId=${CLIENT_ID}`);
      es.addEventListener('hello', (ev) => {
        try {
          const h = JSON.parse(ev.data);
          if (Number(h.rev) > lastServerRevRef.current) {
            // Missed writes while unsubscribed — pull once.
            fetch(`/api/jarvis/sheet-draft?draftId=${encodeURIComponent(id)}`).then(r2 => r2.json()).then(d2 => {
              if (d2?.ok && d2.draft && Number(d2.rev) > lastServerRevRef.current && d2.updatedBy !== 'client') {
                adoptServerDraftRef.current?.(d2.draft, d2.rev, d2.updatedBy);
              } else if (d2?.rev) lastServerRevRef.current = Number(d2.rev);
            }).catch(() => {});
          }
        } catch { /* hello is advisory */ }
      });
      es.addEventListener('draft', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.clientId === CLIENT_ID) { lastServerRevRef.current = Math.max(lastServerRevRef.current, Number(d.rev) || 0); return; }
          if (Number(d.rev) > lastServerRevRef.current && d.draft) {
            adoptServerDraftRef.current?.(d.draft, d.rev, d.updatedBy);
          }
        } catch { /* skip malformed */ }
      });
    })();
    return () => { dead = true; try { es?.close(); } catch { /* closing */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, draftKey]);

  // ONE COMMUNICATION STREAM (Dan, 2026-08-30): when a step's questions
  // surface, they ALSO post into the chat as one Jarvis turn — the history
  // holds question and answer together. The step cards stay (same objects).
  const postedStepQsRef = useRef(new Set());
  useEffect(() => {
    // NOTE: `cascadeLive` is declared further down — referencing it here (or
    // in the deps) is a TDZ render crash (took the shell down 2026-08-30).
    if (phase !== 'summary' || !cascade.steps.length || !cascade.activeStep) return;
    // NEVER POST BELOW AN ANSWER (Dan, 2026-08-30: the questions posted
    // directly under the message that answered them): while a turn is in
    // flight, that turn owns these questions — it closes what his message
    // answers; only what SURVIVES it posts.
    if (applying) return;
    const step = cascade.activeStep;
    if (postedStepQsRef.current.has(step.key)) return;
    let needs = [];
    try { needs = needsForStep(step); } catch (_) { return; }
    if (!needs.length) return;
    postedStepQsRef.current.add(step.key);
    const q1 = String(needs[0].question ?? '').slice(0, 60);
    const text = `Questions on ${step.label}:\n`
      + needs.map((n, i) => `Q${i + 1}. ${n.question}`
        + (n.evidence ? `\n   From our shipped examples: ${n.evidence}` : '')
        + (n.proposedSolution ? `\n   My proposal: ${n.proposedSolution}` : '')).join('\n')
      + '\n\nAgree on the cards, or just answer here ("1 — yes; 2 — …").';
    setChatThread(t => (q1 && t.some(x => String(x?.text ?? '').includes(q1))
      ? t
      : [...t, { role: 'jarvis', text, at: Date.now() }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cascade.activeStep?.key, jarvisCoverage, agreedNeeds, applying]);

  function openSectionEdit(key) {
    if (sectionEditKey === key) { setSectionEditKey(null); setSectionProposal(null); return; }
    setSectionEditKey(key);
    setSectionProposal(null);
    setSectionEditText('');
  }

  /** Scoped edit → the classifier route (when the server-side edit-classifier
   *  agent has landed — class chip + routing) alongside the summarize pipeline
   *  as the graceful fallback and the proposal source. NOTHING commits here:
   *  the result renders as a PROPOSED old→new diff awaiting Approve. */
  async function sendSectionEdit(section) {
    const text = sectionEditText.trim();
    if (!text || proposalBusy || applying) return;
    if (overSummarizeBudget) { setError(budgetMessage); return; }
    setError(null);
    setProposalBusy(true);
    try {
      const framed =
        `SCOPED EDIT — the engineer is reviewing the ${section.title} section and wants this change `
        + `(his words, with the why): ${text}\n`
        + 'Apply it ONLY where it belongs and leave every other section exactly as it was.';
      const [cls, req] = await Promise.all([
        classifyEditRequest({
          smId: linkedSmId, section: section.key, instruction: text,
          filename: useDiagramStore.getState().currentFilename ?? null,
        }),
        requestSummarize({ priorSummary: summaryToText(summary), corrections: framed }),
      ]);
      // Preview what commit WOULD land — same merge+hydrate path, no commit.
      const mergedNext = req.agentic ? req.data.summary : mergeSheetValues(summary, req.data.summary);
      const smNow = linkedSmId ? useDiagramStore.getState().project?.stateMachines?.find(x => x.id === linkedSmId) : null;
      const next = withSheetPrefill(hydrateSummaryFromSm(mergedNext, smNow));
      setSectionProposal({
        key: section.key, title: section.title, rawText: text,
        data: req.data, agentic: req.agentic,
        prev: summary, next,
        diff: diffSummaryChanges(summary, next),
        classInfo: cls && typeof cls === 'object' ? cls : null,
      });
      // The text stays in state until Approve lands it — reject keeps it too.
    } catch (e) {
      setError(e.message); // input keeps the ME's words — retry is one click
    } finally {
      setProposalBusy(false);
    }
  }

  /** Approve = the one commit: sheet lands, receipt computed, rows flash,
   *  section marked reviewed (quiet ✓), change-log line appended. */
  function approveSectionProposal() {
    const p = sectionProposal;
    if (!p) return;
    const applied = commitSummarizeResult(p.data, p.agentic);
    setQaHistory(h => [...h, { questions: [], answer: p.rawText }]);
    setQaRounds(n => n + 1);
    const items = receiptAfterApply(applied);
    setChatThread(t => [...t,
      { role: 'me', text: `[${p.title}] ${p.rawText}`, at: Date.now() },
      {
        role: 'jarvis',
        text: items.length ? 'Applied — here is what actually changed:' : 'Nothing changed — the sheet already matched that.',
        items, at: Date.now(),
      }]);
    if (linkedSmId) {
      const cls = p.classInfo?.class
        ?? (p.diff.sentences.length && p.diff.sentences.every(s => s.section === 'devices') ? 'value' : 'section');
      appendChangeLog(linkedSmId, {
        what: `[${p.title}] ${p.rawText}`,
        class: cls,
        replanned: p.classInfo?.replanned ?? null,
        costUSD: Number(p.data?.meta?.costUSD) || null,
      });
    }
    setSectionProposal(null);
    setSectionEditText('');
    setSectionEditKey(null);
    setSectionReviewed(p.key, true);
  }

  /** Reject & retry: the proposal drops; the ME's words STAY in the box. */
  function rejectSectionProposal() {
    setSectionProposal(null);
  }

  // The reviewable sections PRESENT on this sheet (the progress line's M).
  // Review mode lives on BUILT stations (after a Build) — Dan's flow.
  const reviewEnabled = phase === 'summary' && !!linkedSmId;
  const reviewPerSm = (approvedSmDecomp ?? []).filter(e => (e.sequence?.length ?? 0) > 0);
  const reviewPerSmRecovery = reviewPerSm.length >= 2 && reviewPerSm.some(e => (e.faultRecovery?.length ?? 0) > 0);
  const reviewIo = deriveIoLists(summary?.devices ?? []);
  const reviewSections = !reviewEnabled ? [] : [
    { key: 'interactions', title: 'Interactions' },
    { key: 'devices', title: 'Devices' },
    { key: 'sequence', title: 'Sequence' },
    // Fault recovery reviews on its own only when it renders as its own
    // column; in per-SM mode each machine's recovery rides with Sequence.
    ...(!reviewPerSmRecovery ? [{ key: 'failureHandling', title: 'Fault recovery' }] : []),
    ...((reviewIo.inputs.length + reviewIo.outputs.length) > 0 ? [{ key: 'io', title: 'Inputs & Outputs' }] : []),
    ...((smDecomp?.length ?? 0) >= 2 ? [{ key: 'stateMachines', title: 'State machines' }] : []),
  ];
  // CASCADE-AWARE done-ness: a section is done when every cascade step it
  // hosts is approved; sections with no cascade step (IO) keep the legacy
  // reviewed mark. Without a cascade (no steps), everything is legacy.
  // STRICT PROGRESSIVE DISCLOSURE (Dan, 2026-08-26): the cascade governs the
  // whole summary phase — fresh drafts included, not just built stations.
  const cascadeLive = phase === 'summary' && cascade.steps.length > 0;
  // Derived IO reveals once every devices step is agreed.
  const ioRevealed = !cascadeLive
    || cascade.steps.filter(s => s.kind === 'devices').every(s => s.status === 'approved');
  const sectionIsDone = (key) => {
    if (cascadeLive) {
      const hosted = cascade.steps.filter(s => KIND_SECTION[s.kind] === key);
      if (hosted.length) return hosted.every(s => s.status === 'approved');
    }
    return key === 'stateMachines' ? (smApproval?.approved === true || isReviewed(key)) : isReviewed(key);
  };
  /** All of a section's cascade steps still queued (not yet up) → "up next". */
  const sectionQueued = (key) => {
    if (!cascadeLive) return false;
    const hosted = cascade.steps.filter(s => KIND_SECTION[s.kind] === key);
    return hosted.length > 0 && hosted.every(s => s.status === 'pending');
  };
  const reviewedCount = cascadeLive
    ? cascade.approvedCount
    : reviewSections.filter(s => sectionIsDone(s.key)).length;
  const allReviewed = cascadeLive
    ? cascade.allApproved
    : reviewSections.length > 0 && reviewedCount === reviewSections.length;

  /** The per-section header cluster + the open edit surface, wired. */
  // THE STEP IS THE SECTION (Dan, 2026-08-27): which SECTION hosts a step
  // kind — recovery renders inside the sequence section's recovery column.
  const hostSectionOf = (kind) =>
    kind === 'devices' ? 'devices'
      // Interactions host on the SEQUENCE section (Dan, 2026-08-28): the
      // review surface IS the sequence card's tag column — the old
      // interactions section is hidden during the walk, so the step bar
      // (Step N of M · Approve) must live where the content lives.
      : kind === 'sequence' || kind === 'recovery' || kind === 'interactions' ? 'sequence'
        : null;
  const activeStep = cascadeLive ? cascade.activeStep : null;
  const activeHostSection = activeStep ? hostSectionOf(activeStep.kind) : null;
  const activeStepNeeds = activeStep && activeStep.kind !== 'smSplit' ? needsForStep(activeStep) : [];
  const activeStepValues = activeStep && activeStep.kind !== 'smSplit' ? valueAsksForStep(activeStep) : [];

  const reviewBarFor = (key, title, onDark = false) => {
    // The ACTIVE step's section header carries the step itself — number,
    // needs count, Approve. One surface, no duplicate card (Dan, 2026-08-27).
    if (activeHostSection === key && activeStep) {
      return (
        <CascadeStepBar
          step={activeStep}
          stepNo={cascade.steps.findIndex(s => s.key === activeStep.key) + 1}
          stepCount={cascade.steps.length}
          needsCount={activeStepNeeds.length}
          valuesCount={activeStepValues.length}
          busy={applying}
          onApprove={() => approveCascadeStep(activeStep)}
        />
      );
    }
    if (!reviewEnabled || !reviewSections.some(s => s.key === key)) return null;
    // Cascade sections approve in ONE place — the active section header — so
    // the per-section ✓ hides (Edit stays: the scoped-edit loop is law).
    const hostedByCascade = cascadeLive && cascade.steps.some(s => KIND_SECTION[s.kind] === key);
    return (
      <SectionReviewControls
        sectionKey={key}
        reviewed={sectionIsDone(key)}
        editOpen={sectionEditKey === key}
        onEdit={() => openSectionEdit(key)}
        onMarkReviewed={hostedByCascade ? null : () => setSectionReviewed(key, true)}
        onDark={onDark}
        stampLabel={hostedByCascade ? '✓ approved' : '✓ reviewed'}
        queued={sectionQueued(key)}
      />
    );
  };

  /** The active step's numbered questions — rendered at the TOP of the
   *  hosting section (their ONE home; never duplicated anywhere else). */
  const stepPanelFor = (key) => {
    if (activeHostSection !== key || !activeStep) return null;
    return (
      <StepQuestionsPanel
        step={activeStep}
        needs={activeStepNeeds}
        valueAsks={activeStepValues}
        onAgreeNeed={(n) => agreeNeed({ covKey: n.covKey }, n)}
        onFocusChat={focusChat}
        pendingNote={activeStep.kind === 'devices' && assignBusy && devAssign.pendingAgent.size > 0
          ? `checking our shipped work for ${devAssign.pendingAgent.size} device placement${devAssign.pendingAgent.size === 1 ? '' : 's'}…`
          : null}
      />
    );
  };
  const editPanelFor = (key, title) => {
    if (sectionEditKey !== key) return null;
    const section = { key, title };
    return (
      <SectionEditPanel
        section={section}
        text={sectionEditText}
        onText={setSectionEditText}
        busy={proposalBusy}
        proposal={sectionProposal?.key === key ? sectionProposal : null}
        onSend={() => sendSectionEdit(section)}
        onApprove={approveSectionProposal}
        onReject={rejectSectionProposal}
        sumStage={sumStage}
        sumPct={sumPct}
      />
    );
  };

  // (Corrections dictation now lives inside DictatedTextarea — overall box at
  //  the top of the sheet + one slim scoped input per section card.)

  // ── Build (same pipeline as the modal) ───────────────────────────────────
  function startStagedProgress(stages = STAGES) {
    let current = 0;
    let stageIdx = 0;
    setStageLabel(stages[0].label);
    const tick = setInterval(() => {
      const stage = stages[Math.min(stageIdx, stages.length - 1)];
      const step = (stage.until - current) * (200 / stage.ms) + 0.04;
      current = Math.min(current + step, stage.until - 0.5);
      setPct(current);
    }, 200);
    timersRef.current.push(tick);
    return {
      jumpTo(idx, floor) {
        stageIdx = idx;
        current = Math.max(current, floor);
        setStageLabel(stages[idx].label);
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
    // DATA SHEET (summary) phase: the blocker list next to the button is the
    // gate (Dan: grayed out, telling you what to do). A click while blocked
    // is never silent — it takes you to the first thing to fix.
    if (usingJarvisVerdicts) {
      const list = sheetBlockers();
      if (list.length) { goToBlocker(list[0]); return; }
    } else {
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
    }
    setBuildHint(null);
    if (!allCovered && !window.confirm(
      usingJarvisVerdicts && allOpenNeeds.length
        ? `${allOpenNeeds.length} open need${allOpenNeeds.length === 1 ? '' : 's'} on the sheet — the proposed answers stand and are noted for review. Build?`
        : 'Some sections are not covered yet — the gaps are decided per SDC standards and noted for review. Build?'
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

  // ── BUILD STATION CODE — the REAL codegen (P0, Dan 2026-08-31: his click
  // did nothing visible because this button never reached /api/generate;
  // codegen only lived on the Diagram page cascade stations no longer have).
  // Turn contract: immediate visible state, heartbeat, honest failure with
  // retry — the same SSE progress machinery the pipeline already emits. ────
  const [codeBuild, setCodeBuild] = useState(null); // {pct, stage, detail, error, done, stalled}
  const codeBuildEsRef = useRef(null);
  const [hasCodeBuild, setHasCodeBuild] = useState(false);
  useEffect(() => {
    if (!linkedSmId || !linkedSm?.name) return;
    fetch('/api/jarvis/generations').then(r => (r.ok ? r.json() : null)).then(d => {
      if (d) setHasCodeBuild((d.builds ?? []).some(b => b?.sm === linkedSm.name));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSmId]);
  async function handleBuildCode() {
    if (codeBuild && !codeBuild.error && !codeBuild.done) return; // one at a time
    const smIdNow = linkedSmId;
    if (!smIdNow) return;
    // Never silent: a blocked click takes you to the first thing to fix.
    if (usingJarvisVerdicts) {
      const list = sheetBlockers();
      if (list.length) { goToBlocker(list[0]); return; }
    }
    setCodeBuild({ pct: 1, stage: 'save', detail: 'building station code — saving the project…', error: null, done: null });
    try {
      // The generator reads the project FILE — push the live state first.
      await useDiagramStore.getState().saveCurrentProject();
    } catch { /* generator will still read the last save */ }
    const filename = useDiagramStore.getState().currentFilename;
    if (!filename) {
      setCodeBuild({ pct: 0, stage: 'error', error: 'The project has no server file yet — save the project once, then retry.', done: null });
      return;
    }
    setCodeBuild({ pct: 3, stage: 'start', detail: 'building station code — connecting to the writer…', error: null, done: null });
    const es = new EventSource(`/api/generate/stream?filename=${encodeURIComponent(filename)}&smId=${encodeURIComponent(smIdNow)}`);
    codeBuildEsRef.current = es;
    let lastEvent = Date.now();
    const watchdog = setInterval(() => {
      const quiet = Date.now() - lastEvent;
      if (quiet > 20000) setCodeBuild(c => (c && !c.done && !c.error ? { ...c, stalled: true } : c));
      if (quiet > 90000) {
        clearInterval(watchdog); es.close();
        setCodeBuild(c => (c && !c.done ? { ...c, error: 'The build stream went quiet for 90 s — the server may have restarted. Retry to reconnect.' } : c));
      }
    }, 5000);
    const bump = () => { lastEvent = Date.now(); };
    es.addEventListener('ping', () => { bump(); setCodeBuild(c => (c ? { ...c, stalled: false } : c)); });
    es.addEventListener('progress', (ev) => {
      bump();
      try {
        const d = JSON.parse(ev.data);
        setCodeBuild(c => ({ ...(c ?? {}), pct: d.pct ?? c?.pct ?? 0, stage: d.stage, detail: d.detail ?? c?.detail, stalled: false, error: null }));
      } catch { /* keep last */ }
    });
    es.addEventListener('done', (ev) => {
      clearInterval(watchdog); es.close(); codeBuildEsRef.current = null;
      let d = {}; try { d = JSON.parse(ev.data); } catch { /* below */ }
      const held = !!d.held;
      setCodeBuild({ pct: 100, stage: 'done', done: d, error: null });
      setHasCodeBuild(v => v || !held);
      appendChangeLog(smIdNow, {
        what: held ? `Code build HELD — ${d.held?.questions?.length ?? 0} question(s) for you`
          : `Station code built${d.ok ? '' : ' — validation reported errors'}${d.internalReview?.verdict ? ` · review: ${d.internalReview.verdict}` : ''}`,
        class: 'build', costUSD: Number(d.meta?.costEstimate?.totalUSD) || null,
      });
      setChatThread(t => [...t, {
        role: 'jarvis',
        text: held
          ? `The code build is HELD — I need ${d.held?.questions?.length ?? 'a few'} answer(s) before it can finish:\n${(d.held?.questions ?? []).map((q, i) => `Q${i + 1}. ${q.question}${q.proposedSolution ? `\n   My proposal: ${q.proposedSolution}` : ''}`).join('\n')}`
          : d.ok
            ? `Station code is built${d.internalReview?.verdict === 'ship' ? ' — internal review says ship' : d.internalReview ? ` — internal review: ${d.internalReview.verdict}, findings listed in the cover note` : ''}. The L5X and its reviewer cover note are saved with the build record.`
            : 'The code build finished but validation reported errors — the build record has the report. Nothing ships in this state.',
        at: Date.now(),
      }]);
    });
    es.addEventListener('error', (ev) => {
      if (codeBuildEsRef.current !== es) return; // superseded
      clearInterval(watchdog); es.close(); codeBuildEsRef.current = null;
      let msg = 'Connection to the build server was lost.';
      if (ev?.data) { try { msg = JSON.parse(ev.data).error || msg; } catch { /* transport */ } }
      setCodeBuild(c => ({ ...(c ?? {}), error: msg, done: null }));
    });
  }

  // GENERATE — THE LAST STEP (Dan, 2026-08-26): this is the ONLY place a
  // diagram is ever drawn, and it is reachable ONLY after every cascade step
  // is agreed (the legacy build-first create path is DELETED, not disabled).
  async function handleBuild() {
    if (!hasBuildInput) return;
    const returnPhase = usingJarvisVerdicts ? 'summary' : 'input';
    setPhase('building');
    setError(null);
    const cleanName = name.trim().replace(/\s+/g, '');
    const stationNumber = Number(station) || 1;
    // THE APPROVED FLOW IS THE DIAGRAM (Dan, 2026-08-31): a walked draft's
    // structured steps compile into the canvas deterministically — no model
    // re-draw, no drift from what he approved. The model draw survives only
    // for non-cascade paths (no structured proposal to compile from).
    const compiledDraw = !linkedSmId && (smProposal?.stateMachines?.length ?? 0) > 0;
    const stages = (linkedSmId ? REBUILD_STAGES : STAGES).map(s =>
      compiledDraw && /^(Drawing the station sequence|Rebuilding the sequence)/.test(s.label)
        ? { ...s, label: 'Compiling your approved flow…', ms: 1200 }
        : s);
    const prog = startStagedProgress(stages);
    let smId = null;
    // Once a summary exists, IT is the build input — the raw explanation
    // rides along as reference so nothing the engineer said is lost.
    const desc = usingJarvisVerdicts
      ? `${summaryToText(summary)}\n\n---\nOriginal explanation (reference only — the summary above is authoritative):\n\n${description.trim()}`
      : description.trim();
    try {
      // ── 1. The diagram — COMPILED from the approved flow when a walked
      // proposal exists (deterministic, instant, drift-free); the model draw
      // survives only for paths with no structured steps to compile from. ──
      prog.jumpTo(1, 8);
      let dData;
      if (compiledDraw) {
        const { compileApprovedFlow } = await import('../../lib/compileApprovedFlow.js');
        dData = {
          ok: true,
          sm: compileApprovedFlow({
            machines: smProposal.stateMachines,
            sheetDevices: summary?.devices ?? [],
            stationName: cleanName,
            displayName: name.trim(),
            stationNumber,
          }),
        };
      } else {
        const dRes = await fetch('/api/jarvis/diagram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: desc,
            images: images.filter(i => String(i.mediaType || '').startsWith('image/')).map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
            station: {
              name: cleanName,
              displayName: name.trim(),
              stationNumber,
              otherSms: otherSms.map(s => ({ name: s.name, displayName: s.displayName ?? s.name })),
            },
          }),
        });
        dData = await dRes.json().catch(() => ({}));
        if (!dRes.ok || !dData.ok) throw new Error(dData.error || `Diagram request failed (${dRes.status})`);
      }

      // ── 2. Insert into the CURRENT project via store actions ────────────
      prog.jumpTo(2, 63);
      const drafted = remapSmIds(dData.sm);
      // The data sheet the ME just reviewed/filled WINS over whatever the
      // diagram extraction guessed for device setup — merge it in.
      const draftedDevices = usingJarvisVerdicts
        ? applySheetToDrafted(drafted.devices ?? [], summary?.devices ?? [])
        : (drafted.devices ?? []);
      // Rebuild of an existing station REPLACES its SM in place (same smId —
      // signals/references keep working); first Build creates it.
      const existingSm = linkedSmId
        ? store.project?.stateMachines?.find(s => s.id === linkedSmId)
        : null;
      if (existingSm) {
        smId = existingSm.id;
        store.updateStateMachine(smId, {
          name: cleanName,
          stationNumber,
          description: drafted.description ?? existingSm.description ?? '',
        });
        store.setActiveSm?.(smId);
      } else {
        smId = store.addStateMachine({
          name: cleanName,
          stationNumber,
          description: drafted.description ?? '',
        });
      }
      store.updateStateMachine(smId, {
        displayName: name.trim(),
        devices: draftedDevices,
        nodes: drafted.nodes ?? [],
        edges: drafted.edges ?? [],
        // Station exists from this moment — description saved with it even
        // if the spec extraction below fails. Open questions never gate the
        // build — they ride along as pendingQuestions for CE review.
        // (Tabular-data questions are excluded: the data sheet answered them.)
        machineSpec: {
          version: 1, sourceDescription: desc,
          // The cascade's APPROVED breakup + approvals ride into the station
          // (Dan, 2026-08-26: the split was agreed BEFORE anything was drawn).
          ...(draftSplitApproved && draftProposalEntries?.length ? {
            // THE WALK IS THE SPEC (P0, Dan 2026-08-31): the ENTIRE approved
            // content carries verbatim — recoveries and structured steps
            // included. Dropping them here left built stations with empty
            // FAULT RECOVERY panels.
            smSplit: draftProposalEntries.map(e => ({
              name: e.name, oneLiner: e.oneLiner, deviceNames: e.deviceNames,
              sequence: e.sequence, ...(e.why ? { why: e.why } : {}),
              ...(e.faultRecovery?.length ? { faultRecovery: e.faultRecovery } : {}),
              ...(e.sequenceSteps ? { sequenceSteps: e.sequenceSteps } : {}),
              ...(e.faultRecoverySteps ? { faultRecoverySteps: e.faultRecoverySteps } : {}),
            })),
            smSplitAppliedAt: new Date().toISOString(),
            smSplitApproval: { approved: true, by: 'ME', at: new Date().toISOString() },
          } : {}),
          ...(localCascade ? { cascadeState: localCascade } : {}),
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          ...(expectedSms.trim() ? { expectedStateMachines: expectedSms.trim() } : {}),
          ...(summary?.expectedStateMachines?.length ? { expectedSmPills: summary.expectedStateMachines } : {}),
          ...(controlsNotes.length ? { controlsNotes } : {}),
          generationPreset: genLevel,
          ...(genLevelOf(genLevel).scope ? { generationScope: genLevelOf(genLevel).scope } : {}),
          ...(referenceText.trim() ? { referenceJobs: [{ text: referenceText.trim(), at: Date.now() }] } : {}),
          ...(ioHasContent(summary?.io) ? { io: summary.io } : {}),
          ...(visibleQuestions.length ? { pendingQuestions: visibleQuestions.slice() } : {}),
          ...(nonStandardFlags.length ? { nonStandardFlags: nonStandardFlags.map(f => ({ ...f })) } : {}),
        },
      });
      // Hand open questions to Jarvis's question queue (best effort — the
      // pendingQuestions copy above guarantees nothing is lost either way).
      // The diagram extraction's own open questions go to the queue too —
      // there is no post-build review layer to show them in (Dan: "we just
      // verified it all").
      const queuedQuestions = [...visibleQuestions, ...(dData.openQuestions ?? [])]
        .filter(q => !isTabularQuestion(q));
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
      if (draftedDevices.some(d => d.type === 'VisionSystem')) {
        store.syncVisionPartTracking?.(smId);
      }
      // The station now exists — the draft becomes its LIVING data sheet
      // (Dan: two pages, back and forth, lossless). Link it to the SM and
      // persist synchronously (the page closes right after; the debounced
      // autosave would be cancelled by unmount).
      setLinkedSmId(smId);
      // The build just consumed the sheet — diagram & code now match it.
      setSheetAhead(false);
      setApplyReceipt(null);
      persistDraftNow({ smId, phase: usingJarvisVerdicts ? 'summary' : 'input', sheetAhead: false });

      // ── 3. The spec — THE WALK IS THE SPEC (Dan, 2026-08-31): a walked
      // draft's sheet was built by his approvals; re-deriving it from prose
      // re-asked settled questions (Finger 2, starved feed…) — the same
      // redundancy as the diagram redraw. Walked drafts skip the extraction
      // entirely; the approved content rides in smSplit/cascadeState below.
      prog.jumpTo(3, 71);
      const drawnSteps = (drafted.nodes ?? [])
        .map(n => n.data?.label || '')
        .filter(Boolean);
      let sData = null;
      if (compiledDraw) {
        sData = { ok: true, questions: [], spec: { version: 1, source: 'walked-draft' } };
      } else
      try {
        const sRes = await fetch('/api/jarvis/spec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: desc,
            images: images.filter(i => String(i.mediaType || '').startsWith('image/')).map(i => ({ name: i.name, base64: i.base64, mediaType: i.mediaType })),
            sm: {
              id: smId,
              name: cleanName,
              displayName: name.trim(),
              devices: draftedDevices.map(d => ({
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
          ...(draftSplitApproved && draftProposalEntries?.length ? {
            // THE WALK IS THE SPEC (P0, Dan 2026-08-31): the ENTIRE approved
            // content carries verbatim — recoveries and structured steps
            // included. Dropping them here left built stations with empty
            // FAULT RECOVERY panels.
            smSplit: draftProposalEntries.map(e => ({
              name: e.name, oneLiner: e.oneLiner, deviceNames: e.deviceNames,
              sequence: e.sequence, ...(e.why ? { why: e.why } : {}),
              ...(e.faultRecovery?.length ? { faultRecovery: e.faultRecovery } : {}),
              ...(e.sequenceSteps ? { sequenceSteps: e.sequenceSteps } : {}),
              ...(e.faultRecoverySteps ? { faultRecoverySteps: e.faultRecoverySteps } : {}),
            })),
            smSplitAppliedAt: new Date().toISOString(),
            smSplitApproval: { approved: true, by: 'ME', at: new Date().toISOString() },
          } : {}),
          ...(localCascade ? { cascadeState: localCascade } : {}),
          // The ME's own build-purpose line wins over the extraction's guess.
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          ...(expectedSms.trim() ? { expectedStateMachines: expectedSms.trim() } : {}),
          ...(summary?.expectedStateMachines?.length ? { expectedSmPills: summary.expectedStateMachines } : {}),
          ...(controlsNotes.length ? { controlsNotes } : {}),
          generationPreset: genLevel,
          ...(genLevelOf(genLevel).scope ? { generationScope: genLevelOf(genLevel).scope } : {}),
          ...(referenceText.trim() ? { referenceJobs: [{ text: referenceText.trim(), at: Date.now() }] } : {}),
          ...(ioHasContent(summary?.io) ? { io: summary.io } : {}),
          ...(visibleQuestions.length ? { pendingQuestions: visibleQuestions.slice() } : {}),
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
      const specQuestions = (sData.questions ?? []).filter(q => !isTabularQuestion(q));
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
          ? `Station built — spec saved. ${nQuestions} open question${nQuestions === 1 ? '' : 's'} went to the question queue.`
          : 'Station built — spec saved.'
      );
      clearActiveFreshDraft(); // explicit exit — never auto-resume after Build
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
    // A built station's sheet round-trips freely — no confirm, nothing lost.
    if (!linkedSmId) {
      const hasContent = description.trim() || images.length > 0 || summaryHasContent(summary);
      if (hasContent && !window.confirm('Your explanation is saved as a draft — leave anyway?')) return;
    }
    clearActiveFreshDraft(); // explicit exit — "+ New Station" reopens blank
    store.closeNewSmModal();
  }

  // ── Old blank flow, kept for edge cases ─────────────────────────────────
  if (mode === 'blank') return <NewStateMachineModal />;

  // (No post-build review layer — a successful Build closes this page and
  //  lands on the canvas with a toast. Jarvis ▾ → Station Spec opens the
  //  saved spec later.)

  const busy = phase === 'building' || phase === 'summarizing';
  const inSummary = phase === 'summary';

  // ── THE ONE CHAT (Dan, 2026-08-26): the conversation channel — he says
  // something, Jarvis responds, fixes happen. Collapsible so the long thread
  // gets out of the way (the sanctioned scroll exception applies inside).
  // Rendered right below the inputs in cascade mode; in the legacy spot
  // otherwise. Step response boxes are gone — a message while a step is
  // active applies to that step by default (combinedCorrections frames it).
  const chatBlock = (
    <SectionBar
      testId="corrections-block"
      title="Chat"
      color="#475569"
      note="ask, correct, change — he applies it and shows what actually changed"
      foldedNote={`${chatThread.length} turn${chatThread.length === 1 ? '' : 's'}${allOpenNeeds.length ? ` · ${allOpenNeeds.length} open question${allOpenNeeds.length === 1 ? '' : 's'}` : ''} — click to expand`}
      collapsed={secFolded('chat')}
      onToggle={() => toggleSectionCollapse('chat')}
    >
      {/* BREATHING ROOM (Dan, 2026-08-31): the tab row gets its own band —
          padded, ruled off — so the thread scrolls under a clean boundary. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        {/* QUESTIONS LIVE IN THE CHAT (Dan, 2026-08-31): two tabs — the
            thread, and the open questions (answer inline or by number). */}
        <span style={{ display: 'inline-flex', gap: 4, flex: 1, alignItems: 'center', minWidth: 0 }}>
          {[
            { id: 'chat', label: 'Chat' },
            { id: 'questions', label: `Questions (${allOpenNeeds.length})` },
          ].map(tb => (
            <button
              key={tb.id}
              type="button"
              data-testid={`chat-tab-${tb.id}`}
              onClick={() => setChatTab(tb.id)}
              style={{
                ...chipBase, cursor: 'pointer', fontWeight: 800, fontSize: 11.5, padding: '4px 14px', lineHeight: 1.4, flexShrink: 0,
                color: chatTab === tb.id ? '#fff' : (tb.id === 'questions' && allOpenNeeds.length ? '#8a3b3b' : C.muted),
                background: chatTab === tb.id ? 'var(--color-primary)' : 'var(--color-sidebar)',
                border: `1px solid ${chatTab === tb.id ? 'var(--color-primary)' : C.border}`,
              }}
            >{tb.label}</button>
          ))}
          <span style={{ fontWeight: 400, fontSize: 11, color: C.muted, marginLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            ask, correct, change — he applies it and shows what actually changed
          </span>
        </span>
        {/* KNOW YOUR AUDIENCE (Dan, 2026-08-30): who's at the machine — the
            engineer speaks mechanical to an ME (no tags, no PLC-speak) and
            full controls to a CE. Per-browser, default ME. */}
        <span data-testid="audience-toggle" style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
          {['ME', 'CE'].map(a => (
            <button
              key={a}
              type="button"
              data-testid={`audience-${a}`}
              title={a === 'ME' ? 'Mechanical engineer — plain machine talk, no controls vocabulary' : 'Controls engineer — tags, routines, rung logic welcome'}
              onClick={() => { setAudience(a); try { localStorage.setItem('jarvis.audience', a); } catch { /* private mode */ } }}
              style={{
                ...chipBase, cursor: 'pointer', fontWeight: 800, fontSize: 10.5, padding: '2px 9px',
                color: audience === a ? '#fff' : C.muted,
                background: audience === a ? 'var(--color-primary)' : 'var(--color-sidebar)',
                border: `1px solid ${audience === a ? 'var(--color-primary)' : C.border}`,
              }}
            >{a}</button>
          ))}
        </span>
        {chatThread.length > 0 && (
          <button
            type="button"
            data-testid="chat-collapse-toggle"
            onClick={() => setChatCollapsed(v => !v)}
            title={chatCollapsed ? 'Show the conversation' : 'Tuck the conversation away — the box below still sends'}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: C.muted, flexShrink: 0 }}
          >{chatCollapsed ? `▸ history (${chatThread.length})` : '▾ hide history'}</button>
        )}
      </div>
      {/* QUESTIONS TAB — the ONE home for open questions: numbered, with the
          proposal; Agree inline or answer by number in the box below.
          Answered ones collapse into a done list. */}
      {chatTab === 'questions' && (
        <div data-testid="chat-questions-tab" style={{ marginBottom: 8 }}>
          {allOpenNeeds.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted }}>Nothing open — every question is answered or agreed.</div>
          ) : allOpenNeeds.map((n, i) => (
            <div key={i} data-testid={`chat-question-${i}`} style={{ padding: '5px 0', borderBottom: `1px dashed ${C.border}`, fontSize: 12, lineHeight: 1.55 }}>
              <div><b>Q{i + 1}.</b> {n.question}</div>
              {n.proposedSolution && <div style={{ color: C.muted }}>My proposal: {n.proposedSolution}</div>}
              <div style={{ marginTop: 2, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  type="button"
                  data-testid={`chat-question-agree-${i}`}
                  onClick={() => agreeNeed({ covKey: n.covKey }, n)}
                  style={{ ...chipBase, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, padding: '2px 10px', color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #7fb08c' }}
                >✓ Agree — go with the proposal</button>
                <span style={{ fontSize: 10.5, color: C.light }}>or answer in the box: “{i + 1} — your answer”</span>
              </div>
            </div>
          ))}
          {[...agreedNeeds].length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11, color: C.muted, cursor: 'pointer' }}>
                answered / agreed ({[...agreedNeeds].length})
              </summary>
              {[...agreedNeeds].map((k, i) => (
                <div key={i} style={{ fontSize: 11, color: C.light, lineHeight: 1.5, padding: '1px 0' }}>
                  ✓ {String(k).replace(/^[a-z]+:/i, '')}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      {chatTab === 'chat' && chatThread.length > 0 && !chatCollapsed && (
        <div data-testid="corrections-thread" style={{ marginBottom: 8 }}>
          {/* THE SCROLL EXCEPTION (Dan, 2026-08-25): capped ~5-6 turns tall,
              internal scroll pinned to the newest; expandable below. */}
          <div
            ref={threadRef}
            data-testid="corrections-thread-scroll"
            style={threadExpanded ? {} : { maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}
          >
            {chatThread.map((t, i) => (
              <ChatTurn
                key={`t-${i}`} turn={t} idx={i}
                onRetry={t?.retryText && !applying && i === chatThread.length - 1
                  ? () => runAgentChatTurn(t.retryText, { isRetry: true })
                  : null}
              />
            ))}
          </div>
          {chatThread.length > 2 && (
            <button
              type="button"
              data-testid="corrections-thread-expand"
              onClick={() => setThreadExpanded(v => !v)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 10.5, color: C.light, marginTop: 2,
              }}
            >{threadExpanded ? '▴ collapse the thread' : `▾ expand all ${chatThread.length} turns`}</button>
          )}
        </div>
      )}
      <DictatedTextarea
        value={changes}
        onChange={setChanges}
        rows={linkedSmId ? 3 : 2}
        className="form-input form-textarea"
        data-testid="changes-textarea"
        micTestId="changes-dictate-btn"
        placeholder="type or talk"
        style={{ lineHeight: 1.5, fontFamily: 'inherit', fontSize: 12.5 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 6 }}>
        {applying && (
          <div
            data-testid="apply-changes-progress"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <span data-testid="agent-state-label" style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
              {agentState ?? SUMMARIZE_STAGE_TEXT[sumStage] ?? 'Working…'}
            </span>
            {agentState ? (
              // Loop turns: narration + elapsed clock — never a percent
              // (0% reads as dead; Dan, 2026-08-30).
              <span data-testid="agent-elapsed" style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                {agentElapsed}s
              </span>
            ) : (
              <ProgressRing pct={sumPct} size={44} subLabel="" />
            )}
          </div>
        )}
        {applyHint && !applying && (
          <span data-testid="apply-hint" style={{ fontSize: 11.5, fontWeight: 600, color: C.danger, whiteSpace: 'nowrap' }}>
            {applyHint}
          </span>
        )}
        {/* No instructions on the chat box (Dan, 2026-08-28): the focus IS
            the walked machine — self-evident from where he is. */}
        <span style={{ flex: 1 }} />
        <button
          className="btn btn--primary"
          data-testid="apply-changes-btn"
          onClick={handleApplyChanges}
          disabled={applying || overSummarizeBudget}
          title={overSummarizeBudget ? budgetMessage : undefined}
        >
          Send
        </button>
      </div>
      {overSummarizeBudget && (
        <div style={{
          marginTop: 6, fontSize: 11, color: '#6b5513',
          background: '#fdf6e3', border: '1px solid #e6d9a8',
          borderRadius: 6, padding: '6px 12px',
        }}>
          {budgetMessage}. Building from the current summary still works.
        </div>
      )}
    </SectionBar>
  );

  return (
    <div
      data-testid="create-station-page"
      style={{
        // Embedded (v2 built-station sheet): fill the shell's content area
        // BELOW the persistent StationBanner. Full-viewport otherwise.
        ...(embedded
          ? { position: 'absolute', inset: 0, zIndex: 60 }
          : { position: 'fixed', inset: 0, zIndex: 900 }),
        background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* (The "updates on the sheet" card DOCKS in the right rail with the
          step guide — never a floating overlay covering content; only the
          one-shot reload bar may overlay. Dan, 2026-08-30.) */}
      {/* ── Header ── */}
      <div style={{
        height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 18px', background: '#fff', borderBottom: `1px solid ${C.border}`,
      }}>
        {/* THE station navigation (Dan): one segmented toggle, identical on
            both pages — Spec Sheet first, Diagram second. No "back" on a
            built station's sheet; you toggle. Fresh (unbuilt) drafts keep a
            plain ← Back to leave the create flow, and the toggle shows
            Diagram visibly disabled — the sheet creates the diagram. */}
        {!linkedSmId && (
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
        )}
        {/* (Spec Sheet | Diagram toggle DELETED — Dan, 2026-08-31: "it's
            just one sheet — station sheet". The flow IS on the sheet; the
            classic canvas stays reachable for v1-era stations via their
            own banner.) */}
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
          {linkedSmId ? `Station Sheet — ${name.trim() || 'Station'}` : 'Station Sheet'}
        </span>
        {inSummary && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: C.primary, background: C.primaryBg,
            border: `1px solid ${C.primaryBorder}`, borderRadius: 3, padding: '2px 9px',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            Station data sheet — review &amp; fill
          </span>
        )}
        {/* Quiet persistent STATE chip (Dan, Aug 24): the sheet iterates
            freely; Rebuild happens once, when ready. No nagging — just the
            fact that the sheet is ahead of the diagram & code. */}
        {inSummary && linkedSmId && sheetAhead && (
          <span
            data-testid="sheet-ahead-chip"
            title="Corrections/values changed on this sheet since the diagram & code were last built. Rebuild station (bottom of the sheet) pushes the sheet downstream when you're ready."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 10.5, fontWeight: 600, color: '#6b5513',
              background: '#fdf6e3', border: '1px solid #e6d9a8',
              borderRadius: 12, padding: '2px 10px', whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706', flexShrink: 0 }} />
            Sheet updated — Rebuild has Jarvis re-think with the new info
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
        {/* Fluid full-width (Dan, Aug 24): the sheet fills the page and
            grows/shrinks with the window — density comes from the sections'
            internal multi-column grids, not from a fixed strip. Generous
            bottom padding on the sheet so the final sections (IO) can scroll
            up to center-screen (Dan, Aug 24). */}
        <div style={{ width: '100%', boxSizing: 'border-box', padding: inSummary ? '14px 28px 45vh' : '14px 28px 40px' }}>

          {/* Never on a Station Specs visit (linkedSmId) — that's spec view,
              not the new-station flow. */}
          {phase === 'input' && !linkedSmId && otherDrafts.length > 0 && (
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
                <span
                  key={d.draftId}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: '#fff', border: `1px solid ${C.primaryBorder}`,
                    borderRadius: 12, padding: '2px 6px 2px 10px',
                  }}
                >
                  <button
                    type="button"
                    data-testid={`resume-draft-${d.draftId}`}
                    onClick={() => resumeDraft(d)}
                    title="Resume this draft"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 11, fontWeight: 600, color: C.primary,
                    }}
                  >
                    {draftLabel(d)}
                    <span style={{ fontWeight: 400, color: C.muted }}>· {timeAgo(d.savedAt)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard the ${draftLabel(d)} draft`}
                    data-testid={`discard-draft-${d.draftId}`}
                    title="Discard this draft permanently"
                    onClick={() => {
                      if (!window.confirm(`Discard the "${draftLabel(d)}" draft? This can't be undone.`)) return;
                      deleteDraft(draftKey, d.draftId);
                      setOtherDrafts(list => list.filter(x => x.draftId !== d.draftId));
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: C.muted, fontSize: 12, lineHeight: 1, padding: '0 2px',
                    }}
                  >×</button>
                </span>
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
              kept locally, but every picture stays saved with the station on the server.
            </div>
          )}

          {/* Living spec sheet only: open mechanical-domain questions for this
              station — the ME's list, fed by the same question API. Hidden
              while the cascade runs (questions surface WITH their step). */}
          {linkedSmId && !(cascadeLive && !cascade.allApproved) && (
            <ModelNeedsPanel
              smName={sms.find(s => s.id === linkedSmId)?.name ?? name.trim()}
              smDisplayName={name.trim() || null}
              sm={sms.find(s => s.id === linkedSmId) ?? null}
            />
          )}

          {/* QUESTION HOME + BLOCKING STRIP (Dan, Aug 22/23): ALWAYS visible
              at the top of the sheet — green "nothing blocking" at zero, red
              with every item when something blocks: held builds' questions
              (with proposed solutions), value asks, required servo points,
              sheet gaps, and blocking specAuthor needs. */}
          {(() => {
            if (!inSummary && !linkedSmId) return null;
            // NO "Blocking code generation" BEFORE the generate step exists
            // (Dan, 2026-08-26): while the cascade runs, every ask surfaces
            // WITH its step ("To agree on X, I need: …") — the strip returns
            // only once everything is agreed and generation is the stage.
            if (cascadeLive && !cascade.allApproved) return null;
            // Fault recovery lives inside the Sequence card now.
            const covToSection = { devices: 'devices', sequence: 'sequence', failures: 'sequence', interactions: 'interactions' };
            const extras = [
              ...(inSummary ? sheetBlockers().map(b => ({
                key: b.key, label: b.label, onClick: () => goToBlocker(b),
              })) : []),
              // GEOMETRIC SANITY (Dan, Aug 24: "PlaceTransition 450 vs Place
              // 300 — geometric nonsense"): impossible values are blockers,
              // stated as plain sentences, clicking jumps to the axis card.
              ...(inSummary ? sheetGeometryIssues(summary?.devices).map((g, i) => ({
                key: `geom-${i}`,
                label: `${g.axisName}: ${g.message}`,
                onClick: () => {
                  const idx = (summary?.devices ?? []).findIndex(d => (d?.name || '') === g.axisName);
                  goToBlocker({ target: idx >= 0 ? `sheet-servo-${idx}` : 'summary-section-devices' });
                },
              })) : []),
              // INLINE ANSWERS on blocking questions (Dan's Magnet Dial
              // round): each gets a prefilled answer box + Answer button —
              // accept in one click or type over to override. Value-asks that
              // name a device CREATE their field right here (no orphan asks).
              ...blockingNeeds.map((n, i) => ({
                key: `need-${i}`,
                label: n.question,
                proposal: n.proposedSolution || undefined,
                field: valueFieldForNeed(n) ?? undefined,
                onClick: () => goToBlocker({ target: `summary-section-${covToSection[n.covKey] ?? 'devices'}` }),
                onAnswer: (text) => answerNeed(n, text),
              })),
              // STATEMENTS ARE NOTES (Dan, 2026-08-25): quiet, ✓-agree, never
              // in the red count — rendered outside the shell.
              ...blockingNoteNeeds.map((n, i) => ({
                key: `note-${i}`,
                kind: 'note',
                label: n.question,
                proposal: n.proposedSolution || undefined,
                onAgree: () => agreeNeed({ covKey: n.covKey }, n),
              })),
            ];
            if (linkedSmId) {
              return <SpecQuestionsSection smId={linkedSmId} extraItems={extras} />;
            }
            // Notes never count, never sit inside the red shell (three-shapes
            // rule, Dan 2026-08-25) — same defense as SpecQuestionsSection.
            const asks = extras.filter(it => it.kind !== 'note');
            const notes = extras.filter(it => it.kind === 'note');
            return (
              <>
                <BlockingShell count={asks.length} readyText="Nothing blocking — ready to build">
                  {asks.map(it => <ExtraBlockerRow key={it.key} it={it} />)}
                </BlockingShell>
                {notes.map(it => <ExtraBlockerRow key={it.key} it={it} />)}
              </>
            );
          })()}

          {/* COMPILE FINDINGS, PINNED (Dan, 2026-08-25: the modal's "flagged
              3 issues" vanished with it — "I don't know what to do"). They
              persist here until the next compile / approval; each links to
              its home; the next step is explicit. */}
          {inSummary && linkedSm && (
            <CompileFindingsPinned
              sm={linkedSm}
              devices={summary?.devices ?? []}
              onGo={(h) => {
                goToBlocker({ target: h.target });
                if (h.fallback && !document.querySelector(`[data-testid="${h.target}"]`)) {
                  goToBlocker({ target: h.fallback });
                }
              }}
            />
          )}

          {/* "What's needed" — horizontal strip under the blocking bar (Dan,
              Aug 24): checkmarks fill as sections complete; it GROWS to show
              everything, never scrolls. */}
          {(phase === 'input' || phase === 'summarizing' || (inSummary && !cascadeLive)) && (
            <NeedsStrip
              scores={effScores}
              messages={effMessages}
              hasOtherSms={hasPeers}
              sourceLabel={usingJarvisVerdicts
                ? 'Explanation coverage — covered for THIS build, or its needs are listed on the section. Open needs never block the Build.'
                : 'Checks off live as you type — nothing is sent until Done explaining or Build.'}
            />
          )}

          {/* Tiny top row: name + number — CREATE flow only. A built station
              was named at creation; its header already names it (Dan, Aug 24). */}
          {!linkedSmId && (phase === 'input' || phase === 'summarizing' || inSummary) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ flex: 1, maxWidth: 340 }}>
                <label className="form-label" style={{ marginTop: 0 }}>
                  Station Name <span title="required" style={{ color: C.danger }}>*</span>
                  {!name.trim() && (
                    <span
                      data-testid="name-needed-tag"
                      style={{
                        marginLeft: 8, fontSize: 10, fontWeight: 600, textTransform: 'none',
                        letterSpacing: 0, borderRadius: 3, padding: '1px 8px', whiteSpace: 'nowrap',
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
                  Station Number <span title="required" style={{ color: C.danger }}>*</span>
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
          {/* (The "Level of code generation" form is GONE from the sheet —
              Dan, 2026-08-26: "it just gets lost in here". The scope choice
              moved to the GENERATE step's card, asked at the moment of
              generation. Internal default stays the standard full station.) */}

          {/* ══ INPUT phase — raw explanation, full width (the "What's
              needed" strip above replaces the old right rail) ══ */}
          {(phase === 'input' || phase === 'summarizing') && (
            <div>
              <div style={{ minWidth: 0 }}>
                <DescribeSurface
                  description={description}
                  onDescriptionChange={setDescription}
                  // WHAT TO COVER (Dan's list, 2026-08-26) — the explanation
                  // hints name the cascade's own inputs.
                  hint={(
                    <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 6 }}>
                      Cover: <b>how the station breaks down</b> (state machines) · <b>the devices</b> ·{' '}
                      <b>the sequence</b> · <b>fault recovery</b> · <b>the challenges</b>
                    </div>
                  )}
                  images={images}
                  onImagesChange={changeImages}
                  syncStates={imgSync}
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
                  {/* ("Build without summary" is DELETED — Dan's one-door law,
                      2026-08-26: nothing draws before the cascade approvals;
                      Generate is the last step.) */}
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
                  Your explanation comes back as a clean summary with anything
                  missing marked — then you Build from the reviewed summary.
                </div>
              </div>
            </div>
          )}

          {/* ══ SUMMARY phase — TWO BANDS (Dan, Aug 24): INPUT (what you give
              Jarvis: reference material, notes, interactions, corrections)
              then REVIEW (the station: devices, sequence, IO). Full page
              width — no right rail. ══ */}
          {inSummary && (
            <div style={cascadeLive ? { display: 'flex', gap: 18, alignItems: 'flex-start' } : undefined}>
              <div style={{ minWidth: 0, flex: 1 }}>
                {/* COLLAPSIBLE INPUTS (Dan, 2026-08-30): deep in the walk the
                    inputs fold to one line — remembered per draft; auto-
                    collapses once step 1 is approved; + Add a layer stays
                    reachable from the collapsed line. */}
                {cascadeLive ? (
                  /* UNIFORM BAR (Dan, 2026-08-31): same anatomy as every
                     other section — dark band, chevron, folded note. */
                  <SectionBar
                    testId="inputs-band-header"
                    title="Inputs"
                    color="#1574C4" /* SDC light blue — MEs are blue (Dan, 2026-08-31) */
                    foldedNote={`${images.length ? `${images.length} file${images.length === 1 ? '' : 's'} · ` : ''}explanation${explLayers.length ? ` · ${explLayers.length} layer${explLayers.length === 1 ? '' : 's'}` : ''} — click to expand`}
                    collapsed={inputsCollapsed}
                    onToggle={() => {
                      const next = !inputsCollapsed;
                      setInputsCollapsed(next);
                      try { localStorage.setItem(`jarvis.inputsCollapsed.${draftIdRef.current}`, next ? '1' : '0'); } catch { /* private mode */ }
                    }}
                    status={inputsCollapsed ? (
                      <button
                        type="button"
                        data-testid="inputs-add-layer-collapsed"
                        onClick={() => {
                          setInputsCollapsed(false);
                          try { localStorage.setItem(`jarvis.inputsCollapsed.${draftIdRef.current}`, '0'); } catch { /* private mode */ }
                          setExplLayerDraft(''); setExplAddingLayer(true);
                        }}
                        style={{ ...chipBase, cursor: 'pointer', fontWeight: 800, fontSize: 10, color: '#fff', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.4)' }}
                      >+ Add a layer</button>
                    ) : null}
                    marginBottom={inputsCollapsed ? 10 : 6}
                  />
                ) : (
                  <BandHeader first label="Inputs" />
                )}

                {/* REFERENCE MATERIAL — drop anything (pictures / code /
                    docs) + the engineer's named past-job references. */}
                {!(cascadeLive && inputsCollapsed) && (
                <ReferenceMaterialSection
                  items={images}
                  onItemsChange={changeImages}
                  syncStates={imgSync}
                  sm={linkedSm}
                  referenceText={referenceText}
                  onReferenceTextChange={setReferenceText}
                  referenceSavedTick={referenceTick}
                />
                )}

                {/* THE EXPLANATION NEVER DISAPPEARS (Dan, 2026-08-26) — but
                    it CAN fold (Dan, 2026-08-30): one header line when he's
                    deep in the walk, one click to reopen. */}
                {cascadeLive && !inputsCollapsed && description.trim() && (
                  <div
                    data-testid="sheet-explanation"
                    style={{
                      border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff',
                      marginBottom: 12, overflow: 'hidden',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, background: '#64748b', padding: '5px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Your explanation
                      </span>
                      <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.78)' }}>
                        {explEditing ? 'add or rewrite — Jarvis re-thinks and reconciles with what you approved' : ''}
                      </span>
                      <span style={{ flex: 1 }} />
                      {/* EDITABLE (Dan, 2026-08-28: "maybe I thought about
                          things differently"). The edit is a GATE event:
                          the same engine re-thinks against the new text and
                          reconciles — approved steps stand unless the new
                          text contradicts them, shown as diffs, never a
                          silent rebuild. */}
                      {!explEditing && !explAddingLayer && (
                        <>
                          {/* CHANGE-ORDER LAYERS (Dan, 2026-08-30): adding to
                              a station is a dated LAYER under the original —
                              like a change quote on a job — never an inline
                              rewrite. The primary action. */}
                          <button
                            type="button"
                            data-testid="explanation-add-layer-btn"
                            onClick={() => { setExplLayerDraft(''); setExplAddingLayer(true); }}
                            style={{
                              ...chipBase, cursor: 'pointer', fontWeight: 800, color: '#0f4c81',
                              background: '#fff', border: '1px solid #fff',
                            }}
                          >+ Add a layer</button>
                          <button
                            type="button"
                            data-testid="explanation-edit-btn"
                            title="fix typos or dictation slips in the original — additions belong in a layer"
                            onClick={() => { setExplDraft(description); setExplEditing(true); }}
                            style={{
                              ...chipBase, cursor: 'pointer', color: '#fff',
                              background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.5)',
                            }}
                          >✎ fix wording</button>
                        </>
                      )}
                    </div>
                    {explEditing ? (
                      <div style={{ padding: '8px 14px 10px', maxWidth: 900 }}>
                        <DictatedTextarea
                          value={explDraft}
                          onChange={setExplDraft}
                          rows={8}
                          data-testid="explanation-edit-input"
                          micTestId="explanation-edit-mic"
                          className="form-input"
                          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, lineHeight: 1.6 }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <button
                            type="button"
                            data-testid="explanation-edit-apply"
                            disabled={applying || !explDraft.trim()}
                            onClick={async () => {
                              const flushedTail = document.querySelector('[data-testid="explanation-edit-input"]')?.__flushDictation?.() ?? '';
                              const nextText = `${explDraft.trim()}${flushedTail ? ` ${flushedTail}` : ''}`.trim();
                              if (!nextText || nextText === description.trim()) { setExplEditing(false); return; }
                              setDescription(nextText);
                              setExplEditing(false);
                              setChatThread(th => [...th, { role: 'me', text: '(revised my explanation)', at: Date.now() }]);
                              if (smProposal?.stateMachines?.length) {
                                // GATE: re-think + RECONCILE against the new text.
                                reviewingKeyRef.current = cascade.activeStep?.smKey ?? null;
                                splitCounterRef.current =
                                  'The engineer REVISED his explanation (the new full text is above). Reconcile: '
                                  + 'everything he already approved stays unless the new text contradicts it; apply '
                                  + 'exactly what the revision changes, carry the rest forward verbatim.';
                                console.log('[chat] dispatched: explanation revision → decompose engine');
                                setApplying(true);
                                try { await kickProposal(nextText); } finally { setApplying(false); }
                              }
                            }}
                            style={{
                              background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
                              fontSize: 12, fontWeight: 700, padding: '5px 16px', cursor: 'pointer',
                            }}
                          >Apply — Jarvis re-thinks</button>
                          <button
                            type="button"
                            data-testid="explanation-edit-cancel"
                            onClick={() => setExplEditing(false)}
                            style={{
                              background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
                              fontSize: 12, color: C.muted, padding: '5px 12px', cursor: 'pointer',
                            }}
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: '8px 14px 10px', fontSize: 12, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxWidth: 900, overflowWrap: 'anywhere' }}>
                        {description}
                      </div>
                    )}
                    {/* THE LAYER STACK — readable history: original intent,
                        then each change-order in order (Dan, 2026-08-30). */}
                    {explLayers.map((L, li) => (
                      <div key={li} data-testid={`explanation-layer-${li + 2}`} style={{ borderTop: `1px solid ${C.border}` }}>
                        <div style={{ background: '#eef3f8', padding: '3px 14px', fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#0f4c81' }}>
                          Layer {li + 2} — added {new Date(L.at).toLocaleDateString()}
                        </div>
                        <div style={{ padding: '6px 14px 8px', fontSize: 12, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxWidth: 900, overflowWrap: 'anywhere' }}>
                          {L.text}
                        </div>
                      </div>
                    ))}
                    {explAddingLayer && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 14px 10px', maxWidth: 900 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#0f4c81', marginBottom: 4 }}>
                          Layer {explLayers.length + 2} — what are we adding or changing?
                        </div>
                        <DictatedTextarea
                          value={explLayerDraft}
                          onChange={setExplLayerDraft}
                          rows={5}
                          data-testid="explanation-layer-input"
                          micTestId="explanation-layer-mic"
                          className="form-input"
                          placeholder="describe the addition or change — like a change order on the job"
                          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, lineHeight: 1.6 }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <button
                            type="button"
                            data-testid="explanation-layer-apply"
                            disabled={applying || !explLayerDraft.trim()}
                            onClick={async () => {
                              const tail = document.querySelector('[data-testid="explanation-layer-input"]')?.__flushDictation?.() ?? '';
                              const text = `${explLayerDraft.trim()}${tail ? ` ${tail}` : ''}`.trim();
                              if (!text) { setExplAddingLayer(false); return; }
                              const layerNo = explLayers.length + 2;
                              const nextLayers = [...explLayers, { text, at: Date.now() }];
                              setExplLayers(nextLayers);
                              setExplAddingLayer(false); setExplLayerDraft('');
                              setDirty(true);
                              setChatThread(th => [...th, { role: 'me', text: `(added change-order Layer ${layerNo}) ${text}`, at: Date.now() }]);
                              if (smProposal?.stateMachines?.length) {
                                // GATE (the add-features mechanism): think the
                                // DELTA the layer describes; approved content
                                // stands unless the layer touches it.
                                reviewingKeyRef.current = cascade.activeStep?.smKey ?? null;
                                splitCounterRef.current =
                                  `The engineer added CHANGE-ORDER LAYER ${layerNo} — a dated addition on top of the original `
                                  + 'explanation (the full layered text is above). Think the DELTA: apply exactly what the layer '
                                  + 'adds or changes, reopen/edit only what it touches, carry everything else — including all '
                                  + 'approved content — forward verbatim.';
                                console.log('[chat] dispatched: change-order layer → decompose gate');
                                const nextFull = [description,
                                  ...nextLayers.map((L, i) => `\n\n--- CHANGE-ORDER LAYER ${i + 2} (added ${new Date(L.at).toISOString().slice(0, 10)}) ---\n${L.text}`)].join('');
                                setApplying(true);
                                try { await kickProposal(nextFull); } finally { setApplying(false); }
                              }
                            }}
                            style={{
                              background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
                              fontSize: 12, fontWeight: 700, padding: '5px 16px', cursor: 'pointer',
                            }}
                          >Add Layer {explLayers.length + 2} — Jarvis thinks the delta</button>
                          <button
                            type="button"
                            data-testid="explanation-layer-cancel"
                            onClick={() => { setExplAddingLayer(false); setExplLayerDraft(''); }}
                            style={{
                              background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
                              fontSize: 12, color: C.muted, padding: '5px 12px', cursor: 'pointer',
                            }}
                          >Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* THE OPTIONAL CE LANE (Dan, 2026-08-30): station-scoped
                    controls intent. Fills conversationally — flip the chat
                    toggle to CE and talk; the engine files each statement
                    here (attributed, dated, edited via chat like everything
                    else). Codegen authority: between Dan's words and generic
                    precedent — never above SDC standards or the ME's
                    approved mechanical content. Absent = build as today.
                    ALWAYS VISIBLE (Dan re-asked, 2026-08-31): it carries its
                    own fold — never hidden inside the inputs fold. */}
                <SectionBar
                  testId="controls-notes-section"
                  title="Controls information"
                  color="#5a9a48" /* SDC green — CEs are green (Dan, 2026-08-31) */
                  note="optional"
                  foldedNote={controlsNotes.length ? `${controlsNotes.length} note${controlsNotes.length === 1 ? '' : 's'} — click to expand` : 'optional'}
                  collapsed={secFolded('controlsNotes')}
                  onToggle={() => toggleSectionCollapse('controlsNotes')}
                >
                  {/* Empty state = ONE quiet line (Dan, 2026-08-31) — and a real
                      body so the chevron visibly expands. */}
                  {controlsNotes.length === 0 ? (
                    <div data-testid='controls-notes-empty' style={{ fontSize: 11.5, color: C.light }}>enter information in the chat — it files here.</div>
                  ) : controlsNotes.map((n, i) => (
                    <div key={i} data-testid={`controls-note-${i}`} style={{ fontSize: 12, color: C.text, lineHeight: 1.6, padding: '2px 0' }}>
                      {n.text}
                      <span style={{ fontSize: 10.5, color: C.light }}> — {n.by ?? 'CE'}, {String(n.at ?? '').slice(0, 10)}</span>
                    </div>
                  ))}
                </SectionBar>

                {/* (Level of code generation moved to the GENERATE step —
                    Dan, 2026-08-26. The chooser renders with the Generate
                    card once every step is agreed.) */}
                {!cascadeLive && (
                  <GenerationLevelField
                    level={genLevel} onLevel={setGenLevel}
                    purpose={purpose} onPurpose={setPurpose}
                    disabled={busy} savedTick={purposeTick}
                  />
                )}

                {/* THE ONE CHAT — right below the inputs (Dan, 2026-08-26):
                    the conversation channel; a message applies to the active
                    step by default. Collapsible. */}
                {cascadeLive && chatBlock}

                {/* STATE MACHINES — folded INTO the cascade's step-1 card
                    (Dan, 2026-08-26); the standalone section renders only in
                    legacy (no-cascade) mode. ONE truth: cards, count, prose
                    and stamp all from the ONE displayed source (panelModel). */}
                {!cascadeLive && <SmDecompositionSection
                  decomp={panelModel.decomp ?? smDecomp}
                  approval={smApproval}
                  expectedPills={expectedSmPills}
                  expectationRaw={expectedSms.trim()}
                  expectedCount={expectedSmCount}
                  reasoning={panelModel.reasoning}
                  onApprove={approveSmSplit}
                  onRename={renameSmSplitEntry}
                  onEditViaChat={() => document.querySelector('[data-testid="changes-textarea"]')?.focus()}
                  onCounter={sendSmSplitCounter}
                  busy={applying}
                  versionLabel={panelModel.versionLabel}
                  awaitingApproval={panelModel.awaitingApproval}
                  approvedStamp={panelModel.approvedStamp}
                  supersededNote={panelModel.supersededNote}
                  inconsistent={panelModel.inconsistent}
                  onRepropose={() => reproposeSmSplit()}
                  chatMode={cascadeLive}
                />}

                {/* THE CASCADE'S CURRENT STEP (Dan, 2026-08-26): everything
                    below follows the conversation order; steps not reached
                    yet are HIDDEN entirely (the side guide lists them). */}
                {cascadeLive && (
                  <>
                    <BandHeader label="Station" note="the guided review — approve each step, it locks in below" />
                    {/* COLLAPSIBLE EVERYTHING (Dan, 2026-08-30): one-click fold for the whole sheet. */}
                    <div style={{ display: 'flex', gap: 12, margin: '-4px 0 8px' }}>
                      <button type="button" data-testid="sheet-expand-all" onClick={() => setAllSectionsCollapsed(false)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.muted, textDecoration: 'underline' }}>expand all</button>
                      <button type="button" data-testid="sheet-collapse-all" onClick={() => setAllSectionsCollapsed(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.muted, textDecoration: 'underline' }}>collapse all</button>
                    </div>
                    {(() => {
                      const step = cascade.activeStep;
                      if (!step) return null; // all approved — the green card below closes it
                      if (step.kind === 'smSplit') {
                        // STEP 1 — the SM breakup, everything IN this card
                        // (Dan, 2026-08-26): the proposal folds in here with
                        // his expectation; NO Approve before a proposal
                        // exists; the auto-kicked run shows live progress or
                        // a retry with the reason.
                        return (
                          <div
                            data-testid="cascade-smsplit-step"
                            style={{
                              border: `1px solid ${C.primaryBorder}`, borderLeft: `4px solid ${C.primary}`,
                              background: '#fff', borderRadius: 8, padding: '10px 14px 12px',
                              margin: '0 0 12px', maxWidth: 900,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 800, color: C.primary, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                Step 1 — state machines
                              </span>
                              <span style={{ fontSize: 10.5, color: C.light }}>
                                step {cascade.steps.findIndex(s => s.key === step.key) + 1} of {cascade.steps.length}
                              </span>
                            </div>
                            {step.hasProposal ? (
                              (panelModel.decomp ?? smDecomp) ? (
                                <SmDecompositionSection
                                  decomp={panelModel.decomp ?? smDecomp}
                                  approval={smApproval}
                                  expectedPills={expectedSmPills}
                                  expectationRaw={expectedSms.trim()}
                                  expectedCount={expectedSmCount}
                                  reasoning={panelModel.reasoning}
                                  onApprove={approveSmSplit}
                                  onRename={renameSmSplitEntry}
                                  onEditViaChat={focusChat}
                                  onCounter={sendSmSplitCounter}
                                  busy={applying}
                                  versionLabel={panelModel.versionLabel}
                                  awaitingApproval={panelModel.awaitingApproval}
                                  approvedStamp={panelModel.approvedStamp}
                                  supersededNote={panelModel.supersededNote}
                                  inconsistent={panelModel.inconsistent}
                                  onRepropose={() => reproposeSmSplit()}
                                  chatMode
                                />
                              ) : (
                                // THE DRAFT'S DECOMPOSE-ONLY PROPOSAL — the
                                // same panel, fed from the draft (no station
                                // exists yet; approval records in the cascade).
                                <SmDecompositionSection
                                  decomp={draftProposalEntries}
                                  approval={draftSplitApproved ? { approved: true, by: 'ME', at: localCascade?.steps?.smSplit?.at ?? '' } : null}
                                  expectedPills={expectedSmPills}
                                  expectationRaw={expectedSms.trim()}
                                  expectedCount={expectedSmCount}
                                  reasoning={smProposal?.reasoning || null}
                                  onApprove={approveDraftSplit}
                                  onRename={renameDraftSplitEntry}
                                  onEditViaChat={focusChat}
                                  onCounter={null}
                                  busy={applying}
                                  versionLabel={draftSplitApproved ? null : 'Proposal'}
                                  awaitingApproval={!draftSplitApproved}
                                  approvedStamp={draftSplitApproved}
                                  supersededNote={null}
                                  inconsistent={null}
                                  onRepropose={() => { setSmProposal(null); kickProposal(); }}
                                  chatMode
                                />
                              )
                            ) : proposeRun?.stage === 'compile' ? (
                              <>
                                {(expectedSmPills?.length ?? 0) > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                                    <span style={{ fontSize: 11, color: C.muted }}>from your explanation:</span>
                                    {expectedSmPills.map((p, i) => <SmPill key={i} label={p.name} note={p.note} />)}
                                  </div>
                                )}
                                <SmProposalWait startedAt={proposeRun.startedAt} />
                              </>
                            ) : proposeRun?.stage === 'error' ? (
                              <>
                                <div data-testid="sm-propose-error" style={{ fontSize: 12, color: C.danger, lineHeight: 1.5, marginBottom: 6 }}>
                                  The proposal run didn't go through — {proposeRun.msg}
                                </div>
                                <button
                                  type="button"
                                  data-testid="sm-propose-retry"
                                  onClick={kickProposal}
                                  style={{
                                    background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
                                    fontSize: 12, fontWeight: 700, padding: '5px 16px', cursor: 'pointer',
                                  }}
                                >Retry</button>
                              </>
                            ) : linkedSm?.compiledSequence?.ir ? (
                              // The compile came back with ONE machine — that
                              // IS a proposal (of one); Approve is legitimate.
                              <>
                                {(expectedSmPills?.length ?? 0) > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                                    <span style={{ fontSize: 11, color: C.muted }}>from your explanation:</span>
                                    {expectedSmPills.map((p, i) => <SmPill key={i} label={p.name} note={p.note} />)}
                                  </div>
                                )}
                                <div data-testid="sm-propose-single" style={{ fontSize: 12, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>
                                  Jarvis proposes <b>ONE state machine</b> — the whole station runs as a single
                                  sequence. Not what you meant? Say it in the chat and he re-proposes.
                                </div>
                                <button
                                  type="button"
                                  data-testid="cascade-approve-smSplit"
                                  onClick={() => approveCascadeStep(step)}
                                  disabled={applying}
                                  style={{
                                    background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
                                    fontSize: 12, fontWeight: 700, padding: '5px 18px', cursor: 'pointer',
                                  }}
                                >Approve</button>
                              </>
                            ) : (
                              // NO BUTTON, EVER (Dan, 2026-08-26 round 2): an
                              // explanation without a proposal auto-runs — this
                              // state exists only for the instant before the
                              // auto-run effect fires (or with no explanation).
                              <>
                                {(expectedSmPills?.length ?? 0) > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                                    <span style={{ fontSize: 11, color: C.muted }}>from your explanation:</span>
                                    {expectedSmPills.map((p, i) => <SmPill key={i} label={p.name} note={p.note} />)}
                                  </div>
                                )}
                                <div data-testid="sm-propose-starting" style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                                  {description.trim()
                                    ? 'Starting — Jarvis proposes how this station breaks into state machines…'
                                    : 'Explain the station first — the proposal starts by itself when you\'re done.'}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      }
                      // THE STEP IS THE SECTION (Dan, 2026-08-27): non-smSplit
                      // steps render nothing here — the hosting section below
                      // carries the step bar, questions, and Approve.
                      return null;
                    })()}
                    {/* SM TOGGLE — flip which machine's outputs show; banner
                        chips + diagram follow (setActiveSm). */}
                    <SmOutputToggle entries={smChipEntries} selected={sheetSmKey} onSelect={selectSheetSm} />
                  </>
                )}

                {summary && (cascadeLive
                  ? [...SUMMARY_SECTIONS.filter(s => !s.renderInside)].sort((a, b) =>
                    (a.key === 'interactions' ? 1 : 0) - (b.key === 'interactions' ? 1 : 0))
                  : SUMMARY_SECTIONS.filter(s => !s.renderInside)
                ).map(section => (
                  // INPUT-band prose sections keep the readable measure: the
                  // whole Interactions card lines up with Level of code
                  // generation and Corrections (Dan's markup, Aug 24) instead
                  // of running the full monitor width.
                  <div key={section.key}>
                    {/* STRICT REVEAL (Dan, 2026-08-26): a section not reached
                        in the cascade is HIDDEN — not a preview. The data is
                        all extracted and kept; only the reveal is gated. */}
                    {sectionRevealed(section.key) && <SummarySection
                      section={section}
                      items={summary[section.key]}
                      // ONE HOME for questions (Dan, 2026-08-27): while this
                      // section hosts the active step, its needs render ONLY
                      // in the numbered panel — never twice.
                      cov={activeHostSection === section.key ? null : (jarvisCoverage ? jarvisCoverage[section.covKey] : null)}
                      optional={section.key === 'interactions' && !hasPeers}
                      agreedNeeds={agreedNeeds}
                      onAgreeNeed={agreeNeed}
                      savedTick={section.key === 'interactions' ? interactionsTick : undefined}
                      reviewBar={reviewBarFor(section.key, section.title, true)}
                      topPanel={<>{stepPanelFor(section.key)}{editPanelFor(section.key, section.title)}</>}
                      dimmed={sectionQueued(section.key)}
                      collapsed={!!collapsedSections[section.key]}
                      onToggleCollapse={() => toggleSectionCollapse(section.key)}
                      onOpenQuestions={() => {
                        setChatTab('questions');
                        document.querySelector('[data-testid="corrections-block"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      onChange={items => {
                        // withSheetPrefill keeps the device line, the device
                        // card, and the IO list agreeing (ME's words win).
                        setSummary(s => withSheetPrefill({ ...s, [section.key]: items }));
                        setDirty(true);
                        markSheetAhead();
                        touchSection(section.key); // an edit re-opens its review
                        touchCascade(section.key === 'failureHandling' ? 'recovery' : section.key);
                      }}
                      {...(section.key === 'devices' ? {
                        // ONE Devices section (Dan, Aug 23): the heard-list IS
                        // the cards — header = name + purpose, editable; the
                        // per-type tables ride inside each card.
                        renderBody: () => (
                          <>
                            {/* THE LOOP CONTRACT (Dan, 2026-08-30): device
                                changes from a turn mark RED here until he
                                acknowledges — same pattern as the cards. */}
                            {devChanged && (
                              <div
                                data-testid="devices-changed-strip"
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                                  background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
                                  padding: '5px 10px', marginBottom: 8, fontSize: 12, color: '#991b1b',
                                }}
                              >
                                <b>changed this turn:</b> {devChanged.names.join(', ')}
                                <button
                                  type="button"
                                  data-testid="devices-changed-gotit"
                                  onClick={() => setDevChanged(null)}
                                  style={{
                                    ...chipBase, cursor: 'pointer',
                                    color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #bfe0c8',
                                  }}
                                >✓ got it</button>
                              </div>
                            )}
                            {/* GROUPS AS COLUMNS across the page (Dan, Aug 24:
                                Servo Axes and Pneumatics side by side when
                                width allows — no dead right-side space).
                                Cards flow inside each group; groups wrap at
                                narrow widths. */}
                            <div
                              data-testid="sheet-device-groups"
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
                                gap: '4px 18px', alignItems: 'start',
                              }}
                            >
                              {(() => {
                                // NO UNASSIGNED, EVER (Dan, 2026-08-27):
                                // every device row renders under the machine
                                // Jarvis COMMITTED for it (devAssign — claims
                                // → persisted assignment → name semantics →
                                // fallback with a numbered question). Single-
                                // SM stations render exactly as today.
                                const smGroups = (() => {
                                  if (!smChipEntries?.length) {
                                    return groupDevicesBySm(null, summary.devices);
                                  }
                                  const groups = smChipEntries.map(e => ({ sm: e, devices: [] }));
                                  (summary.devices ?? []).forEach((d, i) => {
                                    const k = devSmKeyByIdx.get(i);
                                    (groups.find(g => g.sm.key === k) ?? groups[groups.length - 1]).devices.push({ d, i });
                                  });
                                  // RENDER INVARIANT (Dan, 2026-08-27): every
                                  // device has exactly ONE render home.
                                  const total = groups.reduce((n, g) => n + g.devices.length, 0);
                                  if (total !== (summary.devices ?? []).length) {
                                    console.error('[cascade] RENDER INVARIANT VIOLATED — grouped', total, 'of', (summary.devices ?? []).length, 'devices');
                                  }
                                  return groups;
                                })();
                                const multiSm = smGroups.some(sg => sg.sm != null);
                                // SM TOGGLE (Dan, 2026-08-26): a selected
                                // machine shows ONLY its own devices — the
                                // overview shows everything.
                                // STRICT SCOPE (Dan, 2026-08-28): a selected
                                // machine NEVER shows another machine's content
                                // — no fallback to "all" when the filter comes
                                // up empty.
                                const visibleSmGroups = (sheetSmKey !== 'all'
                                  ? smGroups.filter(g => g.sm?.key === sheetSmKey)
                                  : smGroups)
                                  // STRICT REVEAL: an SM whose devices step
                                  // hasn't come up yet stays hidden entirely.
                                  .filter(g => stepRevealed('devices', g.sm?.key ?? 'station'));
                                // (shownNames / "also owns" removed — Dan,
                                // 2026-08-27: one identifier per header.)
                                // (Handshake SIGNALS rows removed — Dan,
                                // 2026-08-30: signals are not devices.)
                                return visibleSmGroups.flatMap((sg, sgi) => {
                                const smHeader = multiSm ? (
                                  <div
                                    key={`smh-${sgi}`}
                                    data-testid={`sheet-sm-group-${sg.sm ? sg.sm.key : 'unassigned'}`}
                                    style={{
                                      gridColumn: '1 / -1', display: 'flex', alignItems: 'baseline', gap: 8,
                                      margin: sgi === 0 ? '0' : '12px 0 0',
                                    }}
                                  >
                                    {/* ONE IDENTIFIER, no duplicated prose
                                        (Dan, 2026-08-27): the machine header
                                        is the NAME — the oneLiner and the
                                        "also owns" list are gone (ownership
                                        is rename-safe now; the description
                                        already lives on the proposal). */}
                                    <span style={{ fontSize: 11, fontWeight: 800, color: C.primary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                      {sg.sm ? sg.sm.name : 'Unassigned'}
                                    </span>
                                  </div>
                                ) : null;
                                const cards = groupSheetDeviceRows(sg.devices).map(g => (
                                <div key={`sm${sgi}-${g.key}`} style={{ minWidth: 0 }}>
                                  <div
                                    data-testid={`sheet-device-group-${g.key}`}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 6,
                                      margin: '4px 0 6px', paddingBottom: 2,
                                      borderBottom: `2px solid ${g.color}`,
                                    }}
                                  >
                                    <span style={{
                                      fontSize: 10, fontWeight: 800, color: g.color,
                                      letterSpacing: '0.05em', textTransform: 'uppercase',
                                    }}>{g.items.length === 1 && g.singular ? g.singular : g.label}</span>
                                    <span style={{ fontSize: 10, color: C.light }}>({g.items.length})</span>
                                  </div>
                                  <div style={{
                                    // NARROW CARDS standing rule: inside a wide
                                    // group, cards flow across — never stretch.
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                                    gap: '0 14px', alignItems: 'start',
                                  }}>
                                  {g.items.map(({ d, i }) => {
                                    // READ-ONLY OUTPUT (Dan's ruling, 2026-08-25):
                                    // rename stays (deterministic, cascades);
                                    // add/remove devices flow through the
                                    // Edit→propose→approve loop or corrections.
                                    const headerProps = {
                                      onHeaderCommit: t => commitDeviceHeader(i, t),
                                    };
                                    if (isServoSheet(d)) {
                                      return (
                                        <ServoDraftCard
                                          key={`d${i}`} device={d} idx={i}
                                          onPatch={p => updateSheetDevice(i, p)}
                                          headerProps={headerProps}
                                          bandRows={bandRowsFor(d)}
                                          onCommitBand={commitBandRow}
                                        />
                                      );
                                    }
                                    if (isPneumaticSheet(d)) {
                                      return <PneumaticDraftCard key={`d${i}`} device={d} idx={i} onPatch={p => updateSheetDevice(i, p)} headerProps={headerProps} />;
                                    }
                                    // CLASSIC TAXONOMY cards (Dan, 2026-08-25):
                                    // signals show their SOURCE SM (from -> to +
                                    // meaning, classic live-linking rules);
                                    // counters read as values, not devices.
                                    const role = sheetRoleOf(d);
                                    if (role === 'signal') {
                                      const src = signalSourceOf(d.displayName ?? d.name, {
                                        decomp: smDecomp,
                                        ir: linkedSm?.compiledSequence?.ir,
                                        sms,
                                        selfName: name.trim() || 'this station',
                                      });
                                      // ZERO-OVERLAP + BREVITY (Dan's screenshot,
                                      // 2026-08-25): the from/to routing gets its
                                      // OWN row under the name — never a header
                                      // chip on top of a long signal name — and
                                      // the meaning is ONE short sentence (full
                                      // prose in the tooltip, never rung text).
                                      const meaning = cardOneLiner(src?.purpose || d.purpose);
                                      return (
                                        <SheetDeviceCard
                                          key={`d${i}`}
                                          type={sheetType(d)}
                                          name={d.name}
                                          purpose={d.purpose}
                                          testId={`sheet-signal-${i}`}
                                          {...headerProps}
                                        >
                                          {(src?.from || src?.to) && (
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                                              {src?.from && (
                                                <span data-testid={`sheet-signal-from-${i}`} style={{ ...chipBase, color: '#1d4ed8', background: '#e8f0fa', border: '1px solid #a8c8e8', whiteSpace: 'nowrap' }}>
                                                  from {src.from}
                                                </span>
                                              )}
                                              {src?.to && (
                                                <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>→ {src.to}</span>
                                              )}
                                            </div>
                                          )}
                                          {meaning.line && (
                                            <div title={meaning.full !== meaning.line ? meaning.full : undefined} style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {meaning.line}
                                            </div>
                                          )}
                                        </SheetDeviceCard>
                                      );
                                    }
                                    if (role === 'counter') {
                                      return (
                                        <SheetDeviceCard
                                          key={`d${i}`}
                                          type={sheetType(d)}
                                          name={d.name}
                                          purpose={d.purpose}
                                          testId={`sheet-counter-${i}`}
                                          chips={(
                                            <span style={{ ...chipBase, color: '#0f766e', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>value</span>
                                          )}
                                          {...headerProps}
                                        >
                                          {d.purpose ? (
                                            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{d.purpose}</div>
                                          ) : null}
                                        </SheetDeviceCard>
                                      );
                                    }
                                    return (
                                      <SheetDeviceCard
                                        key={`d${i}`}
                                        type={sheetType(d)}
                                        name={d.name}
                                        purpose={d.purpose}
                                        testId={`sheet-device-${i}`}
                                        {...headerProps}
                                      />
                                    );
                                  })}
                                  </div>
                                </div>
                                ));
                                // (Synthetic SIGNALS rows removed — Dan,
                                // 2026-08-30: signals are not devices; no
                                // cards. The data keeps them.)
                                return smHeader ? [smHeader, ...cards] : cards;
                                });
                              })()}
                            </div>
                            {/* (DeviceAddLine removed — devices are added by
                                telling Jarvis, never by hand-sculpting the
                                output; Dan's ruling 2026-08-25.) */}
                            {/* MOTION PATH (Dan, Aug 24: "show me a diagram of
                                what each point is") — the PNP inverted-U drawn
                                to scale from the LIVE servo values above; the
                                proof gate before code. Full width, grows,
                                never scrolls. */}
                            <PathDiagram
                              // STRICT SCOPE (Dan, 2026-08-28): a selected
                              // machine's motion path draws from ITS devices
                              // and ITS sequence — never the pick-and-place
                              // path on the Escapement view.
                              devices={sheetSmKey !== 'all'
                                ? (summary.devices ?? []).filter((_, di2) => devSmKeyByIdx.get(di2) === sheetSmKey)
                                : summary.devices}
                              sequence={sheetSmKey !== 'all'
                                ? ((smChipEntries ?? []).find(e2 => e2.key === sheetSmKey)?.sequence ?? [])
                                : summary.sequence}
                              onPointClick={(axisName, rowName) => {
                                // One click from the picture to the value:
                                // focus the matching row's input on the sheet.
                                const di = (summary?.devices ?? []).findIndex(d => (d?.name || '') === axisName);
                                if (di === -1) return;
                                const el = document.querySelector(`[data-testid="sheet-servo-value-${di}-${rowName}"]`)
                                  ?? document.querySelector(`[data-testid="sheet-servo-band-value-${di}-${rowName}"]`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  el.focus();
                                }
                              }}
                            />
                          </>
                        ),
                      } : section.key === 'sequence' ? {
                        // TWO sequences, same visual language, side by side
                        // when there's room (Dan, Aug 24): the main cycle and
                        // the fault-recovery sequence — numbered if-then steps.
                        renderBody: () => {
                          const failSec = SUMMARY_SECTIONS.find(s => s.key === 'failureHandling');
                          const failCov = jarvisCoverage ? normVerdict(jarvisCoverage.failures) : null;
                          const failNeeds = (failCov?.needs ?? []).filter(n => !n.blocking);
                          // SM-AWARE SEQUENCES (Dan, 2026-08-25): when the
                          // decomposition carries per-SM sequences, one
                          // numbered column PER SM replaces the single main
                          // column (same visual language); fault recovery is
                          // per-SM when the data provides it, shared (and
                          // still editable) otherwise. Handshake signals get
                          // one small shared strip. Single-SM: exactly today.
                          const perSmAll = (smChipEntries ?? []).filter(e => (e.sequence?.length ?? 0) > 0)
                            // ONE SURFACE (Dan, 2026-08-27): the ACTIVE
                            // machine's column renders here too — the step
                            // IS the section; only unreached ones hide.
                            .filter(e => stepRevealed('sequence', e.key));
                          // SM TOGGLE (Dan, 2026-08-26): the selected machine's
                          // sequence/recovery column only; overview = all.
                          // STRICT SCOPE (Dan, 2026-08-28): the selected
                          // machine's column ONLY — never a fallback to every
                          // machine (that leak rendered the PnP sequence on
                          // the Escapement view). Empty = the section hides
                          // (sectionRevealed is machine-aware).
                          const perSm = sheetSmKey !== 'all'
                            ? perSmAll.filter(e => e.key === sheetSmKey)
                            : perSmAll;
                          // Handshakes live in the SIGNALS device group now
                          // (one concept, never a separate strip — Dan).
                          const anyPerSmRecovery = perSmAll.some(e => (e.faultRecovery?.length ?? 0) > 0);
                          const recoveryCol = (
                            <div style={{ minWidth: 0 }} data-testid="sequence-recovery">
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <SubHead color="#b45309">Fault recovery</SubHead>
                                <span style={{ flex: 1 }} />
                                {reviewBarFor('failureHandling', 'Fault recovery')}
                              </div>
                              {editPanelFor('failureHandling', 'Fault recovery')}
                              {(activeHostSection === 'sequence' ? [] : failNeeds).map((n, i) => (
                                <NeedRow
                                  key={i}
                                  need={n}
                                  agreed={agreedNeeds?.has(`failures:${n.question}`)}
                                  onAgree={() => agreeNeed(failSec, n)}
                                  testId={`summary-need-failureHandling-${i}`}
                                />
                              ))}
                              {/* READ-ONLY projection (Dan's ruling, 2026-08-25):
                                  structural text changes flow through Edit →
                                  propose → approve or the corrections box. */}
                              <SectionLines
                                sectionKey="failureHandling"
                                items={(summary.failureHandling ?? []).map(stripSeqItem)}
                                editHint={failSec.editHint}
                                readOnly
                                onChange={() => {}}
                              />
                            </div>
                          );
                          if ((smChipEntries?.length ?? 0) >= 2) {
                            return (
                              <>
                                <div style={{
                                  display: 'grid',
                                  // 1fr (not a 620px cap): each machine card holds its
                                  // sequence AND recovery side by side (Dan, 2026-08-31).
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
                                  gap: '6px 20px', alignItems: 'start',
                                }}>
                                  {perSm.map((e, ei) => {
                                    // INTERACTIONS ARE SEQUENCE LINES (Dan, 2026-08-28): derived
                                    // at render, never stored. Two scopes, two colors — another
                                    // machine in THIS station vs another station entirely.
                                    const ix = deriveInteractionLines((e.sequence ?? []).map(x => normalizeSeqLine(x)), {
                                      selfName: e.name,
                                      // ALL the station's machines — not just the revealed
                                      // columns (a hidden machine is still a counterpart).
                                      sameMachines: (smChipEntries ?? []).filter(o => o.key !== e.key).map(o => o.name).filter(Boolean),
                                      // The Dial is a standing counterpart on dial machines
                                      // even when no "Dial" station exists in the project.
                                      otherStations: [...new Set([...peerNames, 'Dial'])],
                                    });
                                    const ixByText = new Map();
                                    (e.sequence ?? []).forEach((ln, i2) => {
                                      const info = ix.byLine.get(i2);
                                      if (info) ixByText.set(normalizeSeqLine(ln), info);
                                    });
                                    const scopeStyle = (scope) => scope === 'sameStation'
                                      ? { color: '#075985', background: '#e0f2fe', border: '1px solid #bae6fd' }
                                      : { color: '#6b21a8', background: '#f3e8ff', border: '1px solid #e9d5ff' };
                                    const tagOfLine = (line) => ixByText.get(normalizeSeqLine(line)) ?? null;
                                    return (
                                    <div key={e.key} style={{ minWidth: 0 }} data-testid={`sequence-sm-${e.key}`}>
                                    {/* RECOVERY BESIDE THE SEQUENCE (Dan, 2026-08-31 — layout
                                        invariant #1): same block, right side; auto-fit collapses
                                        to stacked only when the viewport can't hold both. */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '6px 24px', alignItems: 'start' }}>
                                    <div style={{ minWidth: 0 }}>
                                      <SubHead color="#1574C4">{e.name} sequence</SubHead>
                                      {/* LIVE DIFF (Dan, 2026-08-28): a correction shows right
                                          here — removed struck, added/changed highlighted —
                                          parenthetical annotations never render. */}
                                      {/* ALIGNED TAG COLUMN (Dan, 2026-08-28): sequence text
                                          left, interaction tag right — all tags on one
                                          vertical line regardless of line length. The arrow
                                          is the direction: ← incoming wait, → outgoing set. */}
                                      {/* THE FLOW VIEW, ONLY (Dan, 2026-08-30: "the sequence
                                          IS a diagram" — no list toggle). Changes ring the
                                          flow RED until ✓ got it; the diff detail rows render
                                          only while marks are up, then the flow returns. */}
                                      {!seqDiff?.byKey?.[e.key] ? (
                                        <SheetFlow
                                          model={buildFlowModel(e.sequenceSteps, e.sequence, composeStepClient, tagOfLine, summary?.devices)}
                                          mode="seq"
                                        />
                                      ) : (
                                      <div style={{
                                        display: 'grid', gridTemplateColumns: 'auto auto 1fr auto',
                                        columnGap: 10, rowGap: 2, alignItems: 'baseline',
                                        fontSize: 12, lineHeight: 1.55, color: C.text,
                                      }}>
                                        {seqDiffRows(e.sequence, seqDiff?.byKey?.[e.key] ?? null).map((r, li) => {
                                          const txt = normalizeSeqLine(r.t);
                                          const info = ixByText.get(txt) ?? null;
                                          const { type, rest } = splitSeqLine(txt, !!info);
                                          const rowStyle = r.removed
                                            ? { textDecoration: 'line-through', color: '#991b1b', opacity: 0.75 }
                                            : (r.added || r.changed)
                                              ? { background: '#fef9c3', borderRadius: 3 }
                                              : undefined;
                                          return (
                                          <Fragment key={li}>
                                            <span style={{ ...rowStyle, color: C.muted, fontSize: 11 }}>{li + 1}.</span>
                                            <span
                                              data-testid={`seq-type-${e.key}-${li}`}
                                              style={{
                                                ...rowStyle,
                                                fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
                                                textTransform: 'uppercase',
                                                color: r.removed ? '#991b1b' : (SEQ_TYPE_COLORS[type] ?? C.text),
                                              }}
                                            >{type}</span>
                                            <span
                                              data-testid={r.removed ? `seq-removed-${e.key}-${li}` : r.added ? `seq-added-${e.key}-${li}` : undefined}
                                              title={r.changed ? `was: ${normalizeSeqLine(r.was)}` : undefined}
                                              style={rowStyle}
                                            >{rest}</span>
                                            {info && !r.removed ? (
                                              <span
                                                data-testid={`seq-ix-tag-${e.key}-${li}`}
                                                title={info.scope === 'sameStation'
                                                  ? `Signal with ${info.counterpart} — another machine in this station (program-to-program)`
                                                  : `Signal with ${info.counterpart} — a different station (this station's external interface)`}
                                                style={{
                                                  ...scopeStyle(info.scope), fontSize: 9.5, fontWeight: 700,
                                                  borderRadius: 4, padding: '0px 6px', justifySelf: 'start',
                                                  whiteSpace: 'nowrap',
                                                }}
                                              >{type === 'Wait' ? '←' : '→'} {info.counterpart}</span>
                                            ) : <span />}
                                          </Fragment>
                                          );
                                        })}
                                      </div>
                                      )}
                                      {seqDiff?.byKey?.[e.key] && (
                                        <button
                                          type="button"
                                          data-testid={`seq-diff-gotit-${e.key}`}
                                          onClick={() => setSeqDiff(null)}
                                          style={{
                                            ...chipBase, cursor: 'pointer', marginTop: 3,
                                            color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #bfe0c8',
                                          }}
                                        >✓ got it</button>
                                      )}
                                      {/* NO SECOND LIST (Dan, 2026-08-28: "you're already
                                          putting that in the sequence — why have another row
                                          below?"): the interactions review IS this card's tag
                                          column; the step bar carries the one prompt line. */}
                                    </div>
                                      {stepRevealed('recovery', e.key) && (
                                        <div style={{ minWidth: 0 }} data-testid={`recovery-sm-${e.key}`}>
                                        {(e.faultRecovery?.length ?? 0) > 0 || recDiff?.byKey?.[e.key] ? (
                                          <>
                                            <SubHead color="#b45309">Fault recovery</SubHead>
                                            {/* RECOVERY IS A BRANCHING FLOW (Dan, 2026-08-30):
                                                structured recoveries draw as a small branch
                                                diagram; changes ring RED until ✓ got it. */}
                                            {((e.faultRecoverySteps ?? []).some(x => x && typeof x === 'object' && x.decision) || restructureRecoveryLines(e.faultRecovery)) ? (
                                              <div style={recDiff?.byKey?.[e.key]
                                                ? { border: '2px solid #fca5a5', borderRadius: 8, padding: '6px 8px', background: '#fffafa' }
                                                : undefined}>
                                                <SheetFlow
                                                  model={buildFlowModel(e.faultRecoverySteps, e.faultRecovery, composeStepClient, tagOfLine, summary?.devices)}
                                                  mode="recovery"
                                                  lane="recovery"
                                                />
                                              </div>
                                            ) : (
                                            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.55, color: C.text }}>
                                              {seqDiffRows(e.faultRecovery ?? [], recDiff?.byKey?.[e.key] ?? null).map((r, li) => (
                                                <li
                                                  key={li}
                                                  data-testid={r.removed ? `rec-removed-${e.key}-${li}` : r.added ? `rec-added-${e.key}-${li}` : undefined}
                                                  style={r.removed
                                                    ? { textDecoration: 'line-through', color: '#991b1b', opacity: 0.75 }
                                                    : (r.added || r.changed)
                                                      ? { background: '#fef9c3', borderRadius: 3 }
                                                      : undefined}
                                                >{stripParens(r.t)}</li>
                                              ))}
                                            </ol>
                                            )}
                                            {recDiff?.byKey?.[e.key] && (
                                              <button
                                                type="button"
                                                data-testid={`rec-diff-gotit-${e.key}`}
                                                onClick={() => setRecDiff(null)}
                                                style={{
                                                  ...chipBase, cursor: 'pointer', marginTop: 3,
                                                  color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #bfe0c8',
                                                }}
                                              >✓ got it</button>
                                            )}
                                          </>
                                        ) : (
                                          /* RECOVERY IS A STEP, ALWAYS (Dan, 2026-08-28): the step
                                             exists even when no content was drafted — say so
                                             honestly instead of hiding the review. */
                                          <div data-testid={`recovery-empty-${e.key}`} style={{ marginTop: 8 }}>
                                            <SubHead color="#b45309">Fault recovery</SubHead>
                                            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                                              Nothing drafted yet — describe in the chat how {e.name || 'this machine'} gets
                                              home safe from a mid-cycle fault (part in the gripper vs empty), or
                                              Approve to accept none.
                                            </div>
                                          </div>
                                        )}
                                        </div>
                                      )}
                                    </div>
                                    </div>
                                    );
                                  })}
                                  {/* Shared recovery only when no machine carries its own —
                                      revealed once any recovery step is reached. */}
                                  {!anyPerSmRecovery
                                    && cascade.steps.some(s => s.kind === 'recovery' && s.status !== 'pending')
                                    && recoveryCol}
                                </div>
                              </>
                            );
                          }
                          return (
                            <>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 620px))',
                              gap: '6px 20px', alignItems: 'start',
                            }}>
                              {stepRevealed('sequence', 'station') && (
                              <div style={{ minWidth: 0 }} data-testid="sequence-main">
                                <SubHead color="#1574C4">Main sequence</SubHead>
                                {/* READ-ONLY projection (Dan's ruling): the
                                    output is never hand-sculpted out of sync
                                    with what Jarvis would regenerate. */}
                                <SectionLines
                                  sectionKey="sequence"
                                  items={(summary.sequence ?? []).map(stripSeqItem)}
                                  editHint={section.editHint}
                                  readOnly
                                  onChange={() => {}}
                                />
                              </div>
                              )}
                              {stepRevealed('recovery', 'station') && recoveryCol}
                            </div>
                            </>
                          );
                        },
                      } : section.key === 'interactions' && hasPeers ? {
                        // MACHINE-AWARE (Dan, Aug 24): chips of the project's
                        // other stations — pick who you interact with, then
                        // talk through each one. Persists on machineSpec.
                        renderBody: () => (
                          <>
                            <div
                              data-testid="interaction-station-chips"
                              style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '2px 0 8px' }}
                            >
                              <span style={{ fontSize: 11, color: C.muted }}>
                                What stations are you interacting with?
                              </span>
                              {peerNames.map(nm => {
                                const on = interactionFor(nm) !== -1;
                                return (
                                  <button
                                    key={nm}
                                    type="button"
                                    data-testid={`interaction-chip-${nm}`}
                                    onClick={() => toggleInteractionStation(nm)}
                                    title={on ? `Remove the ${nm} interaction` : `Add an interaction with ${nm}`}
                                    style={{
                                      ...chipBase, cursor: 'pointer',
                                      color: on ? '#fff' : C.muted,
                                      background: on ? C.primary : 'var(--color-sidebar)',
                                      border: `1px solid ${on ? C.primary : C.border}`,
                                    }}
                                  >{on ? '✓ ' : ''}{nm}</button>
                                );
                              })}
                            </div>
                            {(summary.interactions ?? []).map((it, i) => (
                              <div
                                key={i}
                                data-testid={`interaction-row-${i}`}
                                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}
                              >
                                <span style={{ fontSize: 12, fontWeight: 700, color: C.text, paddingTop: 5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {it.station || '(which station?)'}:
                                </span>
                                <DictatedTextarea
                                  value={it.how ?? ''}
                                  onChange={v => updateInteraction(i, { how: v.replace(/\n/g, ' ') })}
                                  rows={1}
                                  data-testid={`interaction-how-${i}`}
                                  micTestId={`interaction-how-mic-${i}`}
                                  placeholder="explain the interaction — type or talk"
                                  style={{
                                    flex: 1, minWidth: 0, boxSizing: 'border-box', fontSize: 12,
                                    paddingTop: 4, paddingBottom: 4, paddingLeft: 8,
                                    border: `1px solid ${C.border}`, borderRadius: 6,
                                    resize: 'none', lineHeight: 1.4, fontFamily: 'inherit', color: C.text,
                                  }}
                                />
                                <button
                                  type="button"
                                  aria-label="Remove interaction"
                                  title="Remove this interaction"
                                  data-testid={`interaction-remove-${i}`}
                                  onClick={() => removeInteraction(i)}
                                  style={{
                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                    color: C.light, fontSize: 13, lineHeight: 1, padding: '5px 2px 0', flexShrink: 0,
                                  }}
                                >✕</button>
                              </div>
                            ))}
                            {(summary.interactions ?? []).length === 0 && (
                              <div data-testid="interactions-none" style={{ fontSize: 12, color: C.muted }}>None</div>
                            )}
                          </>
                        ),
                      } : {})}
                    />}
                    {/* ONE quiet scope line under Interactions (Dan, Aug 23):
                        standalone build = full station file, stubs quiet,
                        nothing to configure. */}
                    {section.key === 'interactions' && linkedSmId && sectionRevealed('interactions') && (
                      <GenerationScopeNote smId={linkedSmId} hasOtherSms={hasPeers} />
                    )}
                    {/* Interactions closes the INPUT band: the Corrections
                        box comes next (shown once a summary exists), then the
                        REVIEW band header before Devices / Sequence / IO. */}
                    {/* LEGACY (no cascade): the chat + Station band header
                        stay in their old spot. In cascade mode both moved up
                        with the inputs (strict order, Dan 2026-08-26). */}
                    {section.key === 'interactions' && !cascadeLive && (
                      <>
                        {chatBlock}
                        <BandHeader label="Station" note="review and correct" />
                        {/* COLLAPSIBLE EVERYTHING (Dan, 2026-08-30): one-click fold for the whole sheet. */}
                        <div style={{ display: 'flex', gap: 12, margin: '-4px 0 8px' }}>
                          <button type="button" data-testid="sheet-expand-all" onClick={() => setAllSectionsCollapsed(false)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.muted, textDecoration: 'underline' }}>expand all</button>
                          <button type="button" data-testid="sheet-collapse-all" onClick={() => setAllSectionsCollapsed(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10.5, color: C.muted, textDecoration: 'underline' }}>collapse all</button>
                        </div>
                        {reviewSections.length > 0 && (
                          <div
                            data-testid="review-progress-line"
                            style={{ fontSize: 11.5, fontWeight: 600, color: allReviewed ? '#2f6b3c' : C.muted, margin: '-2px 0 8px' }}
                          >
                            {allReviewed ? '✓ ' : ''}{reviewedCount} of {reviewSections.length} sections reviewed
                            {!allReviewed && <span style={{ fontWeight: 400, color: C.light }}> — Edit a section to change it, ✓ to approve it as-is</span>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
                <NonStandardCard flags={nonStandardFlags} />

                {(visibleQuestions.length > 0 || tabularQuestionCount > 0) && !(cascadeLive && !cascade.allApproved) && (
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
                    {visibleQuestions.map((q, i) => (
                      <div key={i} style={{ fontSize: 12, color: C.text, lineHeight: 1.5, padding: '2px 0' }}>
                        {i + 1}. {q}
                      </div>
                    ))}
                    {tabularQuestionCount > 0 && (
                      <div data-testid="tabular-questions-note" style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', paddingTop: 3 }}>
                        {tabularQuestionCount} data question{tabularQuestionCount === 1 ? '' : 's'} became
                        fill-in table{tabularQuestionCount === 1 ? '' : 's'} above — the empty cells are the question.
                      </div>
                    )}
                  </div>
                )}


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
                          <strong>Learned:</strong> {fact} — won't be asked again.
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

                {/* INPUTS & OUTPUTS — derived, at the bottom (Dan, Aug 23).
                    Reveals once every devices step is agreed (strict order). */}
                {summary && ioRevealed && (
                  <IoDerivedCard
                    devices={summary.devices}
                    ioNotes={summary.io?.ioNotes}
                    reviewBar={reviewBarFor('io', 'Inputs & Outputs', true)}
                    topPanel={editPanelFor('io', 'Inputs & Outputs')}
                    collapsed={!!collapsedSections.io}
                    onToggleCollapse={() => toggleSectionCollapse('io')}
                  />
                )}

                {/* (STATE MACHINES panel moved to the TOP of the sheet —
                    Dan, 2026-08-25: review artifacts he acts on belong up
                    top, not buried under devices.) */}

                {/* STANDARDS USED — an output of the build, so it closes the
                    STATION band next to the derived IO (Dan, Aug 24). */}
                <StandardsUsedLine sm={linkedSm} />

                {/* CHANGE LOG — Dan's version control view: one line per
                    applied change (when · what · class chip · cost), newest
                    first, merged with the classifier agent's API when live. */}
                {/* CHANGE LOG — uniform section bar, collapsed by default
                    (Dan, 2026-08-31): the data unchanged, no floating log
                    line above the build card. */}
                {linkedSm && (localChangeLogOf(linkedSm)?.length ?? 0) > 0 ? (
                  <SectionBar
                    testId="changelog-section"
                    title="Change log"
                    color="#475569"
                    foldedNote={`${localChangeLogOf(linkedSm).length} entr${localChangeLogOf(linkedSm).length === 1 ? 'y' : 'ies'} — click to expand`}
                    collapsed={secFolded('changeLog')}
                    onToggle={() => toggleSectionCollapse('changeLog')}
                  >
                    <ChangeLogPanel sm={linkedSm} bare />
                  </SectionBar>
                ) : null}

                {/* (The "✓ all steps approved" banner is DELETED — Dan,
                    2026-08-31: the rail already says it; one stack, no
                    floating announcements.) */}

                {error && (
                  <div style={{
                    marginTop: 12, background: '#f5eeee', border: '1px solid #d4a0a0',
                    borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.danger,
                  }}>
                    <strong>Request failed:</strong> {error}
                  </div>
                )}

                {/* GENERATE STEP — the scope is a moment-of-generation choice
                    (Dan, 2026-08-26: never a standing form on the sheet).
                    Renders only when the cascade is fully agreed, right above
                    the spend button. */}
                {cascadeLive && cascade.allApproved && (
                  <SectionBar
                    testId="generate-scope-card"
                    title="Build station code"
                    color="#061d39"
                    foldedNote="click to expand"
                    status={pregenFindings.hang.length === 0 && (smProposal?.stateMachines?.length ?? 0) >= 2 ? (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #7fb08c', borderRadius: 3, padding: '1px 8px' }}>ready</span>
                    ) : pregenFindings.hang.length > 0 ? (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#8a3b3b', background: '#fdf2f2', border: '1px solid #d4a0a0', borderRadius: 3, padding: '1px 8px' }}>{pregenFindings.hang.length} signal finding{pregenFindings.hang.length === 1 ? '' : 's'}</span>
                    ) : null}
                    collapsed={secFolded('build')}
                    onToggle={() => toggleSectionCollapse('build')}
                  >
                    {/* SIGNAL CHECK LIVES IN THE WALK (Dan, 2026-08-30) — a
                        can-never-satisfy finding blocks its approval step, so
                        this card shows at most one green line. The red block
                        below is a LAST-RESORT guard only, if a finding
                        somehow appears post-approval. */}
                    {pregenFindings.hang.length > 0 ? (
                      <div data-testid="pregen-handshake-findings" style={{
                        background: '#fdf2f2', border: '1px solid #d4a0a0', borderRadius: 6,
                        padding: '7px 11px', marginBottom: 8, fontSize: 11.5, color: '#8a3b3b', lineHeight: 1.5,
                      }}>
                        <b>Signal check:</b>
                        {pregenFindings.hang.map((f, i) => <div key={`h${i}`}>• {f.plain}</div>)}
                        <div style={{ color: C.muted, marginTop: 2 }}>
                          These would fault on timeout every cycle, so the build is held — answer in the chat (or Agree on the step cards), or build anyway below and the code carries them as-is.
                        </div>
                      </div>
                    ) : ((smProposal?.stateMachines?.length ?? 0) >= 2 && pregenFindings.advisory.length === 0 && (
                      <div data-testid="pregen-handshake-clean" style={{ fontSize: 11.5, color: '#2f6b3c', marginBottom: 8 }}>
                        ✓ signal handshakes check clean
                      </div>
                    ))}
                    {/* STATION ACCEPT (Dan, 2026-08-28): his real workflow —
                        stations are accepted one after another; code
                        generates for the WHOLE MACHINE at the end. Two
                        choices here: generate now (testing) or accept and
                        move on. Accepted stations bank for the machine-level
                        generate (roadmap — multi-program emission). */}
                    {stationAccepted ? (
                      <div
                        data-testid="station-accepted-banner"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                          background: '#e9f5ec', border: '1px solid #bfe0c8', borderRadius: 6,
                          padding: '6px 10px', fontSize: 12, color: '#2f6b3c',
                        }}
                      >
                        <span style={{ fontWeight: 800 }}>✓ Station accepted</span>
                        <span style={{ color: '#4a7c59' }}>
                          banked for the machine build — code for the whole machine builds
                          once every station is accepted. Building below is still available
                          for this station alone.
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="accept-station-btn"
                        onClick={() => {
                          // TWO STACKED LANES (Dan, 2026-08-30): Accept banks
                          // the station and returns to the machine homepage —
                          // the next station gets added there; code for the
                          // whole machine builds at the end.
                          const rec = { by: 'ME', at: Date.now() };
                          setStationAccepted(rec);
                          persistDraftNow({ stationAccepted: rec });
                          showTransientToast(`${name.trim() || 'Station'} accepted — banked for the machine build. Add the next station here.`);
                          if (!linkedSmId) clearActiveFreshDraft(); // no auto-resume; the home card reopens it
                          store.closeNewSmModal();
                          useV2Shell.getState().setSheetLinkedSmId(null);
                          useV2Shell.getState().openProjectHome();
                        }}
                        style={{
                          ...chipBase, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, padding: '8px 16px',
                          display: 'block', marginBottom: 10,
                          color: '#2f6b3c', background: '#e9f5ec', border: '1px solid #7fb08c',
                        }}
                      >✓ Accept Station — build with the machine later</button>
                    )}
                    {/* THE BUILD LANE — button + its note, nested together
                        (the note belongs to the build, not to Accept). */}
                    <div data-testid="build-lane" style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 10 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
                        or build this station's code now:
                      </div>
                      <div style={{ marginBottom: 8 }}>{renderBuildAction('left')}</div>
                      <DictatedTextarea
                        value={purpose}
                        onChange={v => setPurpose(v.replace(/\n/g, ' '))}
                        rows={1}
                        data-testid="generate-scope-specifics"
                        micTestId="generate-scope-specifics-mic"
                        placeholder="anything specific about this build (optional — rides into the build)"
                        className="form-input"
                        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, resize: 'none', lineHeight: 1.5, paddingTop: 6, paddingBottom: 6, paddingLeft: 10 }}
                      />
                    </div>
                  </SectionBar>
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
                  {!allCovered && !cascadeLive && (
                    <span data-testid="coverage-note" style={{ fontSize: 11, color: C.muted }}>
                      {covered} of {applicable.length} covered — the proposed answers stand on the open needs, noted for review
                    </span>
                  )}
                  {allCovered && visibleQuestions.length > 0 && !cascadeLive && (
                    <span data-testid="open-questions-note" style={{ fontSize: 11, color: C.muted }}>
                      {visibleQuestions.length} open question{visibleQuestions.length === 1 ? '' : 's'} — decided
                      per SDC standards and noted for review.
                    </span>
                  )}
                  {/* BUILD lives IN the card for cascade drafts (Dan,
                      2026-08-30: stacked under Accept, never orphaned down
                      here next to Discard). This row keeps it only for
                      non-cascade sheets (linked stations), plus the gated
                      note while the walk is unfinished. */}
                  {(() => {
                    if (cascadeLive && !cascade.allApproved) {
                      return (
                        <span data-testid="build-gated-note" style={{ fontSize: 11, color: C.muted }}>
                          Build code unlocks when every step is agreed — {cascade.approvedCount} of {cascade.steps.length} agreed.
                        </span>
                      );
                    }
                    if (cascadeLive && cascade.allApproved) return null; // the card owns both lanes
                    return renderBuildAction('right');
                  })()}
                </div>

                {/* Sticky edits bar — LEGACY summarize-era drafts ONLY (Dan,
                    2026-08-31: on a walked draft "the walk is the spec" —
                    there is no summary to update; edits flow through the
                    engine like everything else. A vague "you've made edits"
                    is banned; the dirty flag on walked drafts is bookkeeping
                    for the persist effect, never a call to action). */}
                {dirty && !applying && !cascadeLive && !(smProposal?.stateMachines?.length) && (
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
                      You've made edits — resubmit to update the summary
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
              {/* THE STEP-BY-STEP GUIDE (Dan, 2026-08-26): how this is going
                  to go and what each step needs — sticky at the side. The
                  UPDATES card docks here too (Dan, 2026-08-30: never a
                  floating overlay covering content — only the one-shot
                  reload bar may overlay). */}
              {cascadeLive && (
                <div style={{ position: 'sticky', top: 10, flexShrink: 0, width: 200 }}>
                  {anyMarks && (
                    <div
                      data-testid="updates-pill"
                      style={{
                        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8,
                        background: '#061d39', color: '#fff', borderRadius: 10,
                        padding: '8px 12px', fontSize: 13, fontWeight: 600,
                      }}
                    >
                      <span style={{ flexBasis: '100%' }}>Updates on the sheet.</span>
                      <button
                        type="button"
                        data-testid="updates-pill-show"
                        onClick={() => {
                          const find = () => document.querySelector('[data-testid="devices-changed-strip"]')
                            ?? document.querySelector('[data-testid^="seq-diff-gotit-"], [data-testid^="rec-diff-gotit-"]')
                            ?? document.querySelector('[data-testid^="sequence-sm-"]');
                          const el = find();
                          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
                          // The marked card may be hidden by the machine
                          // filter — widen to All, then scroll to it.
                          selectSheetSm('all');
                          setTimeout(() => find()?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
                        }}
                        style={{ background: '#ffde51', color: '#061d39', border: 'none', borderRadius: 6, padding: '5px 11px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
                      >Show</button>
                      <button
                        type="button"
                        data-testid="updates-pill-gotit"
                        onClick={clearAllMarks}
                        style={{ background: 'none', color: 'rgba(255,255,255,0.75)', border: 'none', padding: 0, fontWeight: 600, cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline' }}
                      >✓ got it</button>
                    </div>
                  )}
                  <CascadeGuide
                    steps={cascade.steps}
                    hasExplanation={!!description.trim()}
                    allApproved={cascade.allApproved}
                    onJump={jumpToCascadeStep}
                  />
                </div>
              )}
            </div>
          )}
          {inSummary && (
            <div style={{
              fontSize: 11, color: overSummarizeBudget ? '#6b5513' : C.muted,
              fontWeight: 600, marginTop: 8, textAlign: 'right',
              fontFamily: 'Consolas, monospace',
            }}>
              summary cost so far: ${summarizeCost.toFixed(4)} of ${summarizeCostCap.toFixed(2)} ceiling
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
                Generating the station from everything you agreed — the drawn
                sequence and the saved spec. This only ever runs after the
                cascade approvals.
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
                <button className="btn btn--primary" onClick={() => { clearActiveFreshDraft(); store.closeNewSmModal(); }}>
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
