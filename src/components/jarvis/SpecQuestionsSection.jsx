/**
 * SpecQuestionsSection — "Blocking code generation (N)" (Dan, Aug 23): the
 * spec sheet's one red section, listing ONLY what genuinely blocks code
 * generation — each item with SDC Engineer's proposed solution and a talk-or-type
 * answer. The banner's red pill count IS this count.
 *
 * What does NOT appear here (Dan's rulings, Aug 23 live review):
 *   - Servo band *Verify flags — those are VALUES: red proposed rows in the
 *     Servo values table with an intelligent pre-fill (servoBands.js).
 *     Accepting = doing nothing, so they never block.
 *   - *Replace stub notes — SDC Engineer's own standalone-build decisions; one
 *     quiet line in the interactions section (GenerationScopeSection.jsx).
 *
 * Sources (both graceful when absent):
 *   1. Held builds — build.help.questions (code generation paused) →
 *      answers + Continue (POST /api/jarvis/builds/:id/continue).
 *   2. Unmapped *Verify value asks — literal fill-ins + Apply values
 *      (re-compile). Mapped ones live in the servo table instead.
 */

import { useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { useV2Shell } from '../../v2/useV2Shell.js';
import { valueFlagsOf, noteFlagsOf, needsCount, useHeldBuilds, requiredPositionAsksOf, isRealQuestion, geometryBlockersOf } from '../../v2/stationNeeds.js';
import { DictatedTextarea } from './DictatedTextarea.jsx';

// ── THE THREE BLOCKER SHAPES (Dan, 2026-08-25) — enforced at render ─────────
// (1) VALUE ask → the real field, homed on its device (never a naked box);
// (2) QUESTION → proposal prefilled; (3) everything else → quiet NOTE with a
// ✓-agree, excluded from the red count. The renderer classifies independently
// of the pipeline (defense in depth).

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find the device a value ask belongs to — its name (or spaced variant)
 *  appears in the ask's text. → { device } | null. */
export function deviceHomeForAsk(sm, text) {
  const t = norm(text);
  if (!t) return null;
  let best = null;
  for (const d of sm?.devices ?? []) {
    for (const cand of [d.displayName, d.name]) {
      const k = norm(cand);
      if (k && k.length >= 4 && t.includes(k)) {
        if (!best || k.length > best.k.length) best = { device: d, k };
      }
    }
  }
  return best ? { device: best.device } : null;
}

/** Persist a ms-value onto its home device (timers): recognizable directions
 *  land on the standard delay fields, anything else on customTimers. */
function persistTimerOnDevice(smId, device, label, ms) {
  const st = useDiagramStore.getState();
  const l = String(label).toLowerCase();
  const isGripper = device.type === 'PneumaticGripper';
  const retractish = /(retract|return|off\b|release|disengage|open|vent)/.test(l);
  const extendish = /(extend|advance|on\b|engage|close|grip|clamp)/.test(l);
  if (/pneumatic/i.test(device.type) && (retractish || extendish)) {
    const key = retractish
      ? (isGripper ? 'disengageTimerMs' : 'retTimerMs')
      : (isGripper ? 'engageTimerMs' : 'extTimerMs');
    st.updateDevice(smId, device.id, { [key]: ms });
    return key;
  }
  const timers = (device.customTimers ?? []).filter((x) => norm(x?.name) !== norm(label));
  st.updateDevice(smId, device.id, { customTimers: [...timers, { name: label, ms }] });
  return 'customTimers';
}

/** ✓-agree on a note flag: persisted on machineSpec.acknowledgedFlags so it
 *  never returns (survives recompiles that re-emit the same flag text). */
function acknowledgeFlag(smId, fullText) {
  const st = useDiagramStore.getState();
  const sm = st.project?.stateMachines?.find((m) => m.id === smId);
  if (!sm) return;
  const spec = sm.machineSpec ?? { version: 1 };
  const list = spec.acknowledgedFlags ?? [];
  if (list.includes(fullText)) return;
  st.updateStateMachine(smId, {
    machineSpec: { ...spec, acknowledgedFlags: [...list, fullText] },
  });
}

/** Robot-handshake asks ARE signal lists (Dan: render them as the signal rows
 *  they are, one-liner meanings) — extract p_/i_/q_ tokens from a question. */
export function signalRowsOf(text) {
  const s = String(text ?? '');
  if (!/(robot|handshake|interface)/i.test(s)) return [];
  const seen = new Set();
  const rows = [];
  for (const m of s.matchAll(/\b([piq]_[A-Za-z0-9_.[\]]+)\b/g)) {
    const sig = m[1];
    if (seen.has(sig)) continue;
    seen.add(sig);
    // Meaning: the clause the token sits in — first sentence fragment after it.
    const tail = s.slice(m.index + sig.length).match(/^[^.;\n]{0,90}/)?.[0] ?? '';
    rows.push({ signal: sig, meaning: tail.replace(/^[\s:—–-]+/, '').trim() });
  }
  return rows.length >= 2 ? rows : [];
}

/** Compact signal rows under a handshake ask — the rows ARE the ask. */
function SignalRows({ rows, testId }) {
  if (!rows.length) return null;
  return (
    <div data-testid={testId} style={{ margin: '3px 0 2px' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, lineHeight: 1.6, minWidth: 0 }}>
          <span style={{ fontFamily: 'Consolas, monospace', color: 'var(--color-text)', whiteSpace: 'nowrap', flexShrink: 0 }}>{r.signal}</span>
          {r.meaning && <span style={{ color: 'var(--color-text-muted)', minWidth: 0, overflowWrap: 'anywhere' }}>— {r.meaning}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The blocking strip's SHELL — ALWAYS visible at the top of the sheet (Dan,
 * Aug 23: he couldn't find the zero state because it was absent). Green when
 * nothing blocks; red with the items when something does.
 */
export function BlockingShell({ count, readyText = 'Nothing blocking — ready to generate', children }) {
  if (!count) {
    return (
      <div
        data-testid="spec-blocking-zero"
        style={{
          marginBottom: 12, background: '#e9f5ec', border: '1px solid #bfe0c8',
          borderRadius: 6, padding: '7px 12px',
          fontSize: 12, fontWeight: 700, color: '#2f6b3c',
        }}
      >
        ✓ {readyText}
      </div>
    );
  }
  return (
    <div
      data-testid="spec-questions-section"
      style={{
        marginBottom: 12, background: '#fef2f2', border: '1px solid #fca5a5',
        borderRadius: 6, padding: '8px 12px',
      }}
    >
      <div data-testid="spec-blocking-header" style={{ fontSize: 12, fontWeight: 800, color: '#991b1b', marginBottom: 6 }}>
        Blocking code generation ({count})
      </div>
      {children}
    </div>
  );
}

/** Addressee chip: SDC Engineer's opinion of who answers this question. */
function addresseeLabel(a) {
  const s = String(a ?? '').toLowerCase();
  if (!s) return null;
  if (/\bme\b|mech/.test(s)) return 'for the ME';
  if (/ce|controls/.test(s)) return 'controls question';
  return String(a);
}

/**
 * Example-request blocker (Dan, Aug 23): SDC Engineer asks for a real SDC example
 * of something he has no good reference for. Renders a file-drop (.L5X /
 * .docx / images) posting JSON {filename, base64, topic, sm} to
 * POST /api/jarvis/examples (trainer-agent endpoint). 404 → quiet fallback
 * pointing at plc-reference/training-queue/. Clears when the pipeline marks
 * the blocker resolved; until then it counts in the red pill like any blocker.
 */
function ExampleRequestBlock({ q, smName, idx }) {
  const [state, setState] = useState('idle'); // idle | busy | done | offline
  const [err, setErr] = useState(null);
  const inputRef = { current: null };

  async function upload(file) {
    if (!file) return;
    setState('busy');
    setErr(null);
    try {
      const buf = await file.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      const r = await fetch('/api/jarvis/examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64: btoa(bin), topic: q.topic ?? null, sm: smName ?? null }),
      });
      if (r.status === 404) { setState('offline'); return; }
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Upload failed (${r.status})`);
      setState('done');
    } catch (e) {
      setErr(e.message);
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div data-testid={`spec-example-done-${idx}`} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-success)', marginTop: 3 }}>
        ✓ Got it — training on it. This clears once the pipeline has taken it in.
      </div>
    );
  }
  if (state === 'offline') {
    return (
      <div data-testid={`spec-example-offline-${idx}`} style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>
        Example intake coming online — drop the file in <code>plc-reference/training-queue/</code> meanwhile.
      </div>
    );
  }
  return (
    <div
      data-testid={`spec-example-drop-${idx}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}
      onClick={() => inputRef.current?.click()}
      style={{
        marginTop: 4, border: '1.5px dashed #fca5a5', borderRadius: 6, padding: '8px 12px',
        fontSize: 11.5, color: '#991b1b', cursor: 'pointer', background: '#fff',
      }}
    >
      {state === 'busy' ? 'Uploading…' : 'Drop an example here (.L5X, .docx, or a picture) — or click to pick one'}
      <input
        ref={(el) => { inputRef.current = el; }}
        type="file"
        accept=".L5X,.l5x,.docx,image/*"
        style={{ display: 'none' }}
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 10.5, marginTop: 2 }}>{err}</div>}
    </div>
  );
}

function HeldBuildCard({ build, onResumed }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [resumed, setResumed] = useState(false);
  const questions = build.help?.questions ?? [];
  // STATEMENTS ARE NOT QUESTIONS (Dan, Aug 24): a held item that isn't a
  // question renders as a quiet note, never as a blocking ask.
  const isQ = (q) => isRealQuestion(q?.question ?? q?.text);
  const realQuestions = questions.filter(isQ);

  async function cont() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(build.id)}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: questions.map((q, i) => ({
            question: q.question,
            addressee: q.addressee ?? null,
            proposedSolution: q.proposedSolution ?? null,
            // The proposal is PREFILLED in the box; an untouched box means
            // "go with your proposal". Notes get an acknowledgement.
            answer: !isQ(q)
              ? 'Noted.'
              : (answers[i] ?? q.proposedSolution ?? '').trim() || 'Go with your proposed solution.',
          })),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Continue failed (${r.status})`);
      setResumed(true);
      onResumed?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (resumed) {
    return (
      <div data-testid="spec-help-resumed" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-success)', margin: '4px 0' }}>
        ✓ Answers sent — SDC Engineer is continuing the build.
      </div>
    );
  }

  return (
    <div data-testid={`spec-help-${build.id}`} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
        {realQuestions.length > 0
          ? `⏸ Code generation is paused on ${realQuestions.length === 1 ? 'this question' : 'these questions'}:`
          : '⏸ Code generation is paused — SDC Engineer left these notes:'}
      </div>
      {questions.map((q, i) => (
        // FULL TEXT ALWAYS (Dan's no-truncate law): questions wrap and grow —
        // never ellipsize, never clip.
        isQ(q) ? (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {addresseeLabel(q.addressee) && (
              <span style={{ fontSize: 9.5, fontWeight: 800, background: '#fee2e2', color: '#991b1b', borderRadius: 6, padding: '0 6px', marginRight: 6, whiteSpace: 'nowrap' }}>
                {addresseeLabel(q.addressee)}
              </span>
            )}
            {q.question ?? q.text}
          </div>
          {/* Robot-handshake asks render as the signal rows they are. */}
          <SignalRows rows={signalRowsOf(q.question ?? q.text)} testId={`spec-help-signals-${i}`} />
          {q.kind === 'example-request' ? (
            <ExampleRequestBlock q={q} smName={build.sm} idx={i} />
          ) : (
          // SDC Engineer's proposal PREFILLED in the box (Dan, Aug 24: his proposal
          // in the input, never an empty demand) — edit it or leave it.
          <DictatedTextarea
            value={answers[i] ?? q.proposedSolution ?? ''}
            onChange={(v) => setAnswers((o) => ({ ...o, [i]: v }))}
            rows={1}
            placeholder="Your answer"
            micTestId={`spec-help-mic-${i}`}
            data-testid={`spec-help-answer-${i}`}
            className="form-input"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, marginTop: 3, resize: 'vertical' }}
          />
          )}
        </div>
        ) : (
        <div key={i} data-testid={`spec-help-note-${i}`} style={{
          marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45,
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          background: 'var(--color-sidebar)', borderRadius: 6, padding: '5px 9px',
        }}>
          <span style={{ fontWeight: 700, marginRight: 6 }}>Note</span>
          {q.question ?? q.text}
          {q.proposedSolution && <div style={{ fontStyle: 'italic', marginTop: 2 }}>SDC Engineer's take: {q.proposedSolution}</div>}
        </div>
        )
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          data-testid="spec-help-continue-btn"
          disabled={busy}
          onClick={cont}
          style={{
            background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
            fontSize: 12, fontWeight: 700, padding: '5px 16px', cursor: 'pointer',
          }}
        >{busy ? 'Sending…' : 'Continue the build'}</button>
        {err && <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>{err}</span>}
      </div>
    </div>
  );
}

function ValueAsks({ sm }) {
  const [vals, setVals] = useState({});
  const blanks = valueFlagsOf(sm);
  if (blanks.length === 0) return null;

  // NO CAP, NO SCROLL (Dan's law): every ask renders, the panel grows.
  const shown = blanks;
  const filled = shown.map((b, i) => ({ b, v: (vals[i] ?? '').trim() })).filter((x) => x.v);

  function apply() {
    if (filled.length === 0) return;
    // BLOCKERS CREATE THEIR FIELDS (Dan: "where would I even put that?") —
    // a homed ms-value lands on its device NOW (delay field / customTimers),
    // then rides the re-compile like any other committed value.
    for (const { b, v } of filled) {
      const home = deviceHomeForAsk(sm, b.full);
      const n = Number(v);
      if (home && /^ms$/i.test(b.unit || '') && Number.isFinite(n)) {
        persistTimerOnDevice(sm.id, home.device, b.label, n);
      }
    }
    // (The re-compile kick is gone with the compile modal — 2026-09-02. The
    //  values now live on the devices; the sheet's Build reads them.)
    setVals({});
  }

  return (
    <div data-testid="spec-value-asks" style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
        {blanks.length} value{blanks.length === 1 ? '' : 's'} SDC Engineer couldn't derive — fill what you know:
      </div>
      {shown.map((b, i) => {
        const home = deviceHomeForAsk(sm, b.full);
        return (
        <div
          key={i}
          title={b.full}
          data-testid={`spec-blank-${i}`}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5, minWidth: 0 }}
        >
          {/* FULL TEXT, WRAPS (no-truncate law) — never ellipsized. */}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--color-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.45 }}>
            {b.label}
            {home && (
              <span
                data-testid={`spec-blank-home-${i}`}
                title={`This value gets its field on the ${home.device.displayName ?? home.device.name} device the moment you apply it`}
                style={{ display: 'block', fontSize: 10.5, color: 'var(--color-text-muted)' }}
              >→ lands on {home.device.displayName ?? home.device.name}</span>
            )}
          </span>
          <DictatedTextarea
            value={vals[i] ?? ''}
            onChange={(v) => setVals((o) => ({ ...o, [i]: v.replace(/\n/g, ' ') }))}
            rows={1}
            placeholder={b.defaultVal != null ? `default ${b.defaultVal}${b.unit ? ` ${b.unit}` : ''}` : b.unit || 'value'}
            micTestId={`spec-blank-mic-${i}`}
            data-testid={`spec-blank-input-${i}`}
            style={{ width: 150, flexShrink: 0, fontSize: 12, resize: 'none', border: '1px solid var(--color-border)', borderRadius: 6, paddingTop: 4, paddingBottom: 4, paddingLeft: 8 }}
          />
          {b.unit && <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>{b.unit}</span>}
        </div>
        );
      })}
      <button
        type="button"
        data-testid="spec-blanks-apply-btn"
        disabled={filled.length === 0}
        title={filled.length === 0 ? 'Fill at least one value first' : 'Re-compile the sequence with these values applied'}
        onClick={apply}
        style={{
          marginTop: 4, background: filled.length ? 'var(--color-primary)' : 'var(--color-border)',
          color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
          padding: '5px 14px', cursor: filled.length ? 'pointer' : 'default',
        }}
      >Apply value{filled.length === 1 ? '' : 's'} (re-compile)</button>
    </div>
  );
}

/** GEOMETRIC SANITY errors (Dan, Aug 24: "PlaceTransition 450 vs Place 300 —
 *  geometric nonsense") — arithmetic-impossible axis values, stated as plain
 *  sentences, pointing at the servo table where the offending row is red. */
function GeometryBlockers({ sm }) {
  const openServoTable = useV2Shell((s) => s.openServoTable);
  const issues = geometryBlockersOf(sm);
  if (issues.length === 0) return null;
  return (
    <div data-testid="spec-geometry-blockers" style={{ marginTop: 4 }}>
      {issues.map((g, i) => (
        <div key={`${g.axisName}:${g.rowName}:${i}`} style={{ fontSize: 12, color: '#991b1b', fontWeight: 600, lineHeight: 1.5, marginBottom: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          ⚠ {g.axisName}: {g.message}{' '}
          <button
            type="button"
            data-testid={`spec-geometry-open-${i}`}
            onClick={() => openServoTable(sm.id)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: '#991b1b', fontWeight: 800, fontSize: 12, textDecoration: 'underline',
            }}
          >fix it in the servo table</button>
        </div>
      ))}
    </div>
  );
}

/** Decide-and-record STATEMENTS from the compile — quiet notes, ✓-agree,
 *  never in the red count, never an input box (Dan, 2026-08-25: the two
 *  synthesized-names / assumed-default flags rendered as blockers with naked
 *  value boxes — a statement is a note, period). */
function FlagNotes({ sm }) {
  const notes = noteFlagsOf(sm);
  if (!notes.length) return null;
  return (
    <div data-testid="spec-flag-notes" style={{ marginTop: 8, marginBottom: 12 }}>
      {notes.map((p, i) => (
        <div
          key={i}
          data-testid={`spec-flag-note-${i}`}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4,
            background: 'var(--color-sidebar)', borderRadius: 6, padding: '5px 9px',
            fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.5,
          }}
        >
          <span style={{ minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            <span style={{ fontWeight: 700, marginRight: 6 }}>Note</span>{p.label}
          </span>
          <button
            type="button"
            data-testid={`spec-flag-note-agree-${i}`}
            title="Noted — SDC Engineer's decision stands; this note won't come back"
            onClick={() => acknowledgeFlag(sm.id, p.full)}
            style={{
              flexShrink: 0, background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 6, padding: '1px 10px', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)',
            }}
          >✓ agree</button>
        </div>
      ))}
    </div>
  );
}

/** Required positions the compiled code moves to that the axis table doesn't
 *  have — genuine blockers pointing straight at the servo table. */
function RequiredPositionAsks({ sm }) {
  const openServoTable = useV2Shell((s) => s.openServoTable);
  const asks = requiredPositionAsksOf(sm);
  if (asks.length === 0) return null;
  return (
    <div data-testid="spec-required-positions" style={{ marginTop: 4 }}>
      {asks.map((r, i) => (
        <div key={`${r.deviceId}:${r.rowName}`} style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5, marginBottom: 4 }}>
          {r.question}{' '}
          <button
            type="button"
            data-testid={`spec-required-pos-open-${i}`}
            onClick={() => openServoTable(sm.id)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: '#991b1b', fontWeight: 800, fontSize: 12, textDecoration: 'underline',
            }}
          >open the servo table</button>
        </div>
      ))}
    </div>
  );
}

/**
 * One extra-blocker line. When the item carries onAnswer (a blocking
 * question with SDC Engineer's proposed solution — Dan's Magnet Dial round,
 * 2026-08-25), it renders an INLINE answer box PREFILLED with the proposal
 * plus a per-question Answer button: accepting = one click, typing over =
 * override. Both ride the sheet's corrections pipeline via onAnswer.
 * Exported so CreateStationPage's pre-link BlockingShell renders the same row.
 */
export function ExtraBlockerRow({ it }) {
  const [val, setVal] = useState(it.proposal ?? '');
  const [fieldVal, setFieldVal] = useState('');
  const [busy, setBusy] = useState(false);

  // Shape (3): a NOTE — quiet, ✓-agree, no input, no red (Dan, 2026-08-25).
  if (it.kind === 'note') {
    return (
      <div
        data-testid={`spec-extra-note-${it.key}`}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4,
          background: 'var(--color-sidebar)', borderRadius: 6, padding: '5px 9px',
          fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.5,
        }}
      >
        <span style={{ minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <span style={{ fontWeight: 700, marginRight: 6 }}>Note</span>{it.label}
          {it.proposal && <span style={{ fontStyle: 'italic' }}> — SDC Engineer's take: {it.proposal}</span>}
        </span>
        {it.onAgree && (
          <button
            type="button"
            data-testid={`spec-extra-note-agree-${it.key}`}
            title="Noted — the decision stands"
            onClick={it.onAgree}
            style={{
              flexShrink: 0, background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 6, padding: '1px 10px', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)',
            }}
          >✓ agree</button>
        )}
      </div>
    );
  }

  const label = it.onClick ? (
    <button
      type="button"
      data-testid={`spec-extra-blocker-${it.key}`}
      onClick={it.onClick}
      title="Take me there"
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        color: '#991b1b', fontWeight: 700, fontSize: 12, textDecoration: 'underline', textAlign: 'left',
      }}
    >{it.label}</button>
  ) : (
    <span data-testid={`spec-extra-blocker-${it.key}`} style={{ fontWeight: 700, color: '#991b1b' }}>{it.label}</span>
  );

  // Shape (1): a VALUE ask WITH ITS FIELD — the blocker creates the field
  // right here and persists it to the right device on save (Dan: "vacuum off
  // release timer — where would I even put that?"). Never a homeless box.
  const fieldRow = it.field ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }} data-testid={`spec-extra-field-${it.key}`}>
      <input
        data-testid={`spec-extra-field-input-${it.key}`}
        value={fieldVal}
        inputMode="decimal"
        placeholder={it.field.placeholder ?? '—'}
        onChange={(e) => setFieldVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{
          width: 84, boxSizing: 'border-box', fontSize: 12.5, padding: '4px 8px',
          border: '1px solid var(--color-border)', borderRadius: 6, textAlign: 'right',
          fontFamily: 'Consolas, monospace',
        }}
      />
      {it.field.unit && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{it.field.unit}</span>}
      <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
        → saves onto <b>{it.field.deviceLabel}</b>
      </span>
      <button
        type="button"
        data-testid={`spec-extra-field-save-${it.key}`}
        disabled={busy || !Number.isFinite(Number(fieldVal)) || fieldVal === ''}
        title={`Create this field on ${it.field.deviceLabel} and clear the blocker`}
        onClick={async () => {
          const n = Number(fieldVal);
          if (!Number.isFinite(n)) return;
          setBusy(true);
          try { await it.field.onApply(n); } finally { setBusy(false); }
        }}
        style={{
          background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
          fontSize: 12, fontWeight: 700, padding: '4px 14px', cursor: 'pointer', flexShrink: 0,
        }}
      >{busy ? 'Saving…' : 'Save'}</button>
    </div>
  ) : null;

  const sigRows = signalRowsOf(it.label);

  if (!it.onAnswer) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5, marginBottom: 4 }}>
        {label}
        <SignalRows rows={sigRows} testId={`spec-extra-signals-${it.key}`} />
        {it.proposal && (
          <div style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
            SDC Engineer proposes: {it.proposal}
          </div>
        )}
        {fieldRow}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5, marginBottom: 8 }}>
      {label}
      <SignalRows rows={sigRows} testId={`spec-extra-signals-${it.key}`} />
      {fieldRow}
      {/* SDC Engineer's proposal PREFILLED — an untouched Answer accepts it. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 3 }}>
        <DictatedTextarea
          value={val}
          onChange={setVal}
          rows={1}
          placeholder="Your answer"
          micTestId={`spec-extra-answer-mic-${it.key}`}
          data-testid={`spec-extra-answer-${it.key}`}
          className="form-input"
          containerStyle={{ flex: 1, minWidth: 0 }}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, resize: 'vertical' }}
        />
        <button
          type="button"
          data-testid={`spec-extra-answer-btn-${it.key}`}
          disabled={busy}
          title={val.trim() === String(it.proposal ?? '').trim()
            ? 'Go with the proposed answer'
            : 'Send your answer — SDC Engineer folds it into the sheet'}
          onClick={async () => {
            setBusy(true);
            try { await it.onAnswer(val); } finally { setBusy(false); }
          }}
          style={{
            background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6,
            fontSize: 12, fontWeight: 700, padding: '5px 14px', cursor: 'pointer', flexShrink: 0,
          }}
        >{busy ? 'Sending…' : 'Answer'}</button>
      </div>
    </div>
  );
}

/**
 * extraItems: additional blockers the sheet itself knows about (name missing,
 * servo tables incomplete, blocking specAuthor needs) — each
 * { key, label, proposal?, onClick?, onAnswer? }. They count toward the
 * strip's number; items with onAnswer render the inline prefilled answer box.
 */
export function SpecQuestionsSection({ smId, extraItems = [], readyText }) {
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === smId) ?? null
  );
  const [resumeBump, setResumeBump] = useState(0);
  const heldBuilds = useHeldBuilds(sm?.name, resumeBump);

  if (!sm) return null;
  // THREE SHAPES, enforced here too: extra items marked kind:'note' render
  // quietly OUTSIDE the red shell and never count (Dan, 2026-08-25).
  const extraAsks = extraItems.filter((it) => it.kind !== 'note');
  const extraNotes = extraItems.filter((it) => it.kind === 'note');
  const n = needsCount(sm, heldBuilds) + extraAsks.length;

  return (
    <>
      <BlockingShell count={n} readyText={readyText}>
        {heldBuilds.map((b) => (
          <HeldBuildCard key={b.id} build={b} onResumed={() => setResumeBump((k) => k + 1)} />
        ))}
        <GeometryBlockers sm={sm} />
        <RequiredPositionAsks sm={sm} />
        <ValueAsks sm={sm} />
        {extraAsks.map((it) => <ExtraBlockerRow key={it.key} it={it} />)}
      </BlockingShell>
      {extraNotes.map((it) => <ExtraBlockerRow key={it.key} it={it} />)}
      <FlagNotes sm={sm} />
    </>
  );
}
