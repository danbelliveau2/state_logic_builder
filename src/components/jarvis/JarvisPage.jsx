/**
 * JarvisPage — the learning-being surface, as a FULL PAGE (same takeover
 * pattern as CreateStationPage: fixed, opaque, explicit ← Back, no
 * outside-click dismissal).
 *
 * Jarvis is a developing SDC controls engineer. He accumulates questions
 * while working; the controls team (Jason, Tim) answers them; answers become
 * permanent standing knowledge (meKnowledge.md "## Learned from the MEs").
 * His knowledge and track record are browsable here.
 *
 * Three sections:
 *   1. Generations (default) — THE REVIEW GRID (Dan's spec: "anything you
 *      generate should be aligned in a grid"). One row per generated build;
 *      a row expands to: ⬇ Download L5X, the review (what was good / what was
 *      bad — talk or text — score out of 100 + reviewer), and ⬆ Upload corrected
 *      version, which kicks the correction-learning loop (server diffs the
 *      files, one model call turns differences into lessons, high-confidence
 *      lessons land in jarvis-knowledge/concepts/*.md). Track record details
 *      (version history + benchmarks) live in a collapsible below the grid.
 *   2. Questions for Controls — open questions grouped by source, inline
 *      answer box + answerer name, Dismiss. Answering POSTs
 *      /api/jarvis/questions/:id/answer which ALSO appends the answer to
 *      meKnowledge.md, so the very next Jarvis prompt includes it.
 *   3. What Jarvis knows — read-only render of meKnowledge.md + the
 *      generationRules.md rule headings.
 *
 * All data comes from the API server (GET /api/jarvis/generations, /questions,
 * /knowledge, /trackrecord) so the page reflects what's actually on disk.
 * SDC palette only.
 */

import { useEffect, useMemo, useState } from 'react';
import { DictatedTextarea } from './DictatedTextarea.jsx';
import { ScorePicker, scoreColor100, SCORE_SCALE_HINT } from './BuildScoreRow.jsx';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { useV2Shell } from '../../v2/useV2Shell.js';
import { servoGaps, servoGapSummary } from '../../v2/servoValues.js';
import { fetchPretranslated, isPretranslatedReady, mirrorDecisionReviews } from '../../v2/compiledSequence.js';
import { FilesMenu } from '../../v2/FilesMenu.jsx';
import { fmtET, fmtETFull } from '../../v2/fmtTime.js';

const C = {
  primary: 'var(--color-primary)',
  primaryBg: '#e8f0fa',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  light: 'var(--color-text-light)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  surface: 'var(--color-surface)',
  sidebar: 'var(--color-sidebar)',
};

const SOURCE_META = {
  'create-station': { label: 'From describing stations', hint: 'Asked while an ME explained a station' },
  generation:       { label: 'From generating code',     hint: 'Asked while generating L5X' },
  training:         { label: 'From training',            hint: 'Asked while studying reference programs' },
  manual:           { label: 'Standards & reviews',      hint: 'Queued from standards drafts and code reviews' },
};
const SOURCE_ORDER = ['manual', 'create-station', 'generation', 'training'];

const ANSWERERS = ['Jason', 'Tim', 'Dan', 'Other'];

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

// ── Tiny markdown renderer (headings / bullets / bold / code) ───────────────
// Deliberately minimal — meKnowledge.md is simple structured text; no external
// markdown dependency.
function MdInline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.startsWith('`') && p.endsWith('`')) {
          return (
            <code key={i} style={{ fontFamily: 'Consolas, monospace', fontSize: '0.92em', background: C.primaryBg, borderRadius: 3, padding: '0 4px' }}>
              {p.slice(1, -1)}
            </code>
          );
        }
        return p;
      })}
    </>
  );
}

function MdLight({ md }) {
  const blocks = useMemo(() => {
    const out = [];
    let bullets = null;
    for (const raw of String(md).split('\n')) {
      const line = raw.trimEnd();
      const bullet = line.match(/^\s*-\s+(.*)$/);
      if (bullet) {
        if (!bullets) { bullets = []; out.push({ type: 'ul', items: bullets }); }
        bullets.push(bullet[1]);
        continue;
      }
      bullets = null;
      if (/^###\s/.test(line)) out.push({ type: 'h3', text: line.replace(/^###\s*/, '') });
      else if (/^##\s/.test(line)) out.push({ type: 'h2', text: line.replace(/^##\s*/, '') });
      else if (/^#\s/.test(line)) out.push({ type: 'h1', text: line.replace(/^#\s*/, '') });
      else if (/^>\s?/.test(line)) out.push({ type: 'quote', text: line.replace(/^>\s?/, '') });
      else if (line.trim()) out.push({ type: 'p', text: line });
    }
    return out;
  }, [md]);

  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>
      {blocks.map((b, i) => {
        if (b.type === 'h1') return <h2 key={i} style={{ fontSize: 17, fontWeight: 700, margin: '4px 0 10px', color: C.text }}><MdInline text={b.text} /></h2>;
        if (b.type === 'h2') return <h3 key={i} style={{ fontSize: 14, fontWeight: 700, margin: '18px 0 6px', color: C.primary }}><MdInline text={b.text} /></h3>;
        if (b.type === 'h3') return <h4 key={i} style={{ fontSize: 13, fontWeight: 700, margin: '12px 0 4px' }}><MdInline text={b.text} /></h4>;
        if (b.type === 'quote') return <div key={i} style={{ borderLeft: `3px solid ${C.border}`, paddingLeft: 10, color: C.muted, margin: '4px 0' }}><MdInline text={b.text} /></div>;
        if (b.type === 'ul') {
          return (
            <ul key={i} style={{ margin: '4px 0 8px', paddingLeft: 22 }}>
              {b.items.map((it, j) => <li key={j} style={{ margin: '3px 0' }}><MdInline text={it} /></li>)}
            </ul>
          );
        }
        return <p key={i} style={{ margin: '6px 0' }}><MdInline text={b.text} /></p>;
      })}
    </div>
  );
}

// ── Questions tab ────────────────────────────────────────────────────────────

function AnswerBox({ q, onAnswered, onDismissed }) {
  const [answer, setAnswer] = useState('');
  const [who, setWho] = useState('Jason');
  const [otherName, setOtherName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const answeredBy = who === 'Other' ? otherName.trim() : who;
  const canSubmit = answer.trim().length > 0 && answeredBy.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/jarvis/questions/${encodeURIComponent(q.id)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: answer.trim(), answeredBy }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onAnswered(data);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/jarvis/questions/${encodeURIComponent(q.id)}/dismiss`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onDismissed(data);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <DictatedTextarea
        data-testid={`answer-input-${q.id}`}
        micTestId={`answer-mic-${q.id}`}
        value={answer}
        onChange={setAnswer}
        placeholder="Type the answer Jarvis should learn — or hit the mic and talk…"
        rows={2}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px',
          fontSize: 13, fontFamily: 'inherit', color: C.text, background: C.surface,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <select
          value={who}
          onChange={e => setWho(e.target.value)}
          style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, color: C.text, background: C.surface }}
          title="Who is answering"
        >
          {ANSWERERS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {who === 'Other' && (
          <input
            value={otherName}
            onChange={e => setOtherName(e.target.value)}
            placeholder="Name"
            style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, width: 110 }}
          />
        )}
        <button
          data-testid={`answer-btn-${q.id}`}
          disabled={!canSubmit}
          onClick={submit}
          style={{
            background: canSubmit ? C.primary : C.border, color: '#fff', border: 'none',
            borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'default',
          }}
        >{busy ? 'Teaching Jarvis…' : 'Answer'}</button>
        <button
          onClick={dismiss}
          disabled={busy}
          style={{
            background: 'none', border: `1px solid ${C.border}`, color: C.muted,
            borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
          }}
          title="Remove without teaching Jarvis anything"
        >Dismiss</button>
        {error && <span style={{ color: C.danger, fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}

function QuestionCard({ q, onUpdate }) {
  const [justLearned, setJustLearned] = useState(false);

  return (
    <div
      data-testid={`question-${q.id}`}
      style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '12px 14px', marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{q.question}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: C.light, alignItems: 'center' }}>
        {q.context && (
          <span style={{ background: C.primaryBg, color: C.primary, borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>
            {q.context}
          </span>
        )}
        <span>asked {String(q.askedAt || '').slice(0, 10)}</span>
      </div>

      {q.status === 'open' && !justLearned && (
        <AnswerBox
          q={q}
          onAnswered={(data) => { setJustLearned(true); onUpdate(data.question); }}
          onDismissed={(data) => onUpdate(data.question)}
        />
      )}

      {(justLearned || q.status === 'answered') && (
        <div style={{ marginTop: 10 }}>
          {q.answer && (
            <div style={{ fontSize: 12.5, color: C.text, background: C.sidebar, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px' }}>
              <b>{q.answeredBy}:</b> {q.answer}
            </div>
          )}
          <div
            data-testid={`learned-note-${q.id}`}
            style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: C.success }}
          >
            ✓ Jarvis learned this — it's now part of his standing knowledge
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionsTab({ questions, onUpdate }) {
  const open = questions.filter(q => q.status === 'open');
  const answered = questions.filter(q => q.status === 'answered');
  const [showAnswered, setShowAnswered] = useState(false);

  const groups = SOURCE_ORDER
    .map(src => ({ src, meta: SOURCE_META[src], items: open.filter(q => (q.source || 'manual') === src) }))
    .filter(g => g.items.length > 0);
  // Any unexpected source values still render
  const known = new Set(SOURCE_ORDER);
  const other = open.filter(q => !known.has(q.source || 'manual'));
  if (other.length) groups.push({ src: 'other', meta: { label: 'Other', hint: '' }, items: other });

  return (
    <div>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 16px', lineHeight: 1.6 }}>
        Jarvis collects questions he can't resolve on his own while describing stations,
        generating code, and studying reference programs. Answer them here — every answer
        becomes a permanent line in his standing knowledge, applied to his very next job.
      </p>

      {groups.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: C.light, fontSize: 13 }}>
          No open questions — Jarvis has nothing pending for the controls team.
        </div>
      )}

      {groups.map(g => (
        <div key={g.src} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
              {g.meta.label}
            </div>
            <span style={{
              background: C.primary, color: '#fff', borderRadius: 999, fontSize: 10,
              fontWeight: 700, padding: '1px 7px',
            }}>{g.items.length}</span>
            {g.meta.hint && <span style={{ fontSize: 11, color: C.light }}>{g.meta.hint}</span>}
          </div>
          {g.items.map(q => <QuestionCard key={q.id} q={q} onUpdate={onUpdate} />)}
        </div>
      ))}

      {answered.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowAnswered(s => !s)}
            style={{ background: 'none', border: 'none', color: C.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >
            {showAnswered ? '▾' : '▸'} Answered ({answered.length})
          </button>
          {showAnswered && answered.map(q => <QuestionCard key={q.id} q={q} onUpdate={onUpdate} />)}
        </div>
      )}
    </div>
  );
}

// ── Knowledge tab ────────────────────────────────────────────────────────────

const LEARNED_HEADING_MD = '## Learned from the MEs';

// Keyword-based topic grouping for learned lines (v1 — Dan: "group things
// together — this is what I learned for the servo pick and place… for servo
// motors… for pneumatic valves"). First matching group wins.
const TOPIC_GROUPS = [
  { id: 'servo-pnp',  label: 'Servo pick-and-place',        test: l => /pick.{0,3}(and.{0,3})?place|\bpnp\b/.test(l) },
  { id: 'grippers',   label: 'Grippers',                    test: l => /gripper|\bgrip(ped|s)?\b|vacuum/.test(l) },
  { id: 'pneumatics', label: 'Pneumatic actuators & valves', test: l => /pneumatic|valve|solenoid|cylinder|actuator|shuttle|slide/.test(l) },
  { id: 'servo',      label: 'Servo motors',                test: l => /servo|\baxis\b|\baxes\b|motion|\bhome\b|speed|position/.test(l) },
  { id: 'recovery',   label: 'Recovery & motion standards', test: l => /recover|fault|e.?stop|lockout|alarm|\bsafe\b/.test(l) },
  { id: 'taxonomy',   label: 'Device taxonomy',             test: l => /\bdevices?\b|sensor|taxonomy|timer|debounce/.test(l) },
  { id: 'questions',  label: 'Question policy',             test: l => /question|\bask(ing|ed)?\b/.test(l) },
  { id: 'project',    label: 'Project-specific',            test: l => /project|station\s+\d/.test(l) },
];

function classifyLearned(rawLine) {
  const l = rawLine.toLowerCase();
  return TOPIC_GROUPS.find(g => g.test(l)) ?? { id: 'general', label: 'General' };
}

/** One learned fact: view with Edit / Remove, or inline edit (talk-or-type). */
function LearnedLine({ raw, onReload }) {
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const display = raw.replace(/^\s*-\s*/, '');

  async function put(newLine) {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/jarvis/knowledge/learned', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldLine: raw, newLine }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onReload?.();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (mode === 'edit') {
    return (
      <div style={{ margin: '4px 0 8px' }}>
        <DictatedTextarea
          data-testid={`learned-edit-input`}
          micTestId="learned-edit-mic"
          rows={2}
          value={text}
          onChange={setText}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12.5,
            border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px',
            fontFamily: 'inherit', color: C.text, background: C.surface, lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <button
            data-testid="learned-edit-save"
            disabled={busy || !text.trim()}
            onClick={() => put('- ' + text.trim())}
            style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >{busy ? 'Saving…' : 'Save'}</button>
          <button
            disabled={busy}
            onClick={() => { setMode('view'); setError(null); }}
            style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
          >Cancel</button>
          {error && <span style={{ color: C.danger, fontSize: 11 }}>{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="learned-line"
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0', fontSize: 12.5, lineHeight: 1.55, color: C.text }}
    >
      <span style={{ color: C.light, flexShrink: 0 }}>•</span>
      <span style={{ flex: 1, minWidth: 0 }}><MdInline text={display} /></span>
      <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          data-testid="learned-edit-btn"
          title="Adjust this learned fact"
          onClick={() => { setText(display); setMode('edit'); }}
          style={{ background: 'none', border: 'none', color: C.primary, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '0 2px' }}
        >Edit</button>
        <button
          data-testid="learned-remove-btn"
          title="Remove this learned fact permanently"
          disabled={busy}
          onClick={() => { if (confirm('Remove this learned fact from Jarvis permanently?\n\n' + display)) put(''); }}
          style={{ background: 'none', border: 'none', color: C.light, fontSize: 11, cursor: 'pointer', padding: '0 2px' }}
        >Remove</button>
      </span>
      {error && <span style={{ color: C.danger, fontSize: 11 }}>{error}</span>}
    </div>
  );
}

// ── "What Jarvis knows and where it came from" — the source manifest ────────
// Dan: "make sure you have access to all the right things and looking at the
// right places... then we'll see what's missing and what we need to fill you
// in on." One compact card per ingested source (jarvis-knowledge/sources.json
// via GET /api/jarvis/sources): name + location, an access chip, last-ingested
// date, and the bullet takeaways. Sources Jarvis CAN'T fully read render as
// attention items — the gaps are the point.

const ACCESS_CHIP = {
  'full-access':    { label: 'full access',    bg: '#e9f5ec', fg: 'var(--color-success)', border: '#bfe0c8' },
  'full access':    { label: 'full access',    bg: '#e9f5ec', fg: 'var(--color-success)', border: '#bfe0c8' },
  'copied-locally': { label: 'copied locally', bg: '#e8f0fa', fg: 'var(--color-primary)', border: '#a8c8e8' },
  'copied locally': { label: 'copied locally', bg: '#e8f0fa', fg: 'var(--color-primary)', border: '#a8c8e8' },
};
function accessChip(status) {
  const s = String(status || '').toLowerCase();
  return ACCESS_CHIP[s]
    ?? { label: s || 'unknown', bg: '#fdf6e3', fg: '#6b5513', border: '#e6d9a8', attention: true };
}

function KnowledgeSourcesPanel() {
  const [state, setState] = useState({ status: 'loading', sources: null });
  useEffect(() => {
    let alive = true;
    getJson('/api/jarvis/sources')
      .then(d => { if (alive) setState({ status: 'ok', sources: d.sources }); })
      .catch(() => { if (alive) setState({ status: 'error', sources: null }); });
    return () => { alive = false; };
  }, []);

  const sources = state.sources;
  return (
    <div style={{ marginBottom: 18 }} data-testid="knowledge-sources">
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: C.primary }}>
        What Jarvis knows — and where it came from
      </h3>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 10px', lineHeight: 1.5 }}>
        Every source Jarvis has ingested, with what he took from it. Amber chips are
        the gaps — places he can't fully see yet.
      </p>
      {state.status === 'loading' && (
        <div style={{ fontSize: 12, color: C.light }}>Loading the source manifest…</div>
      )}
      {(state.status === 'error' || (state.status === 'ok' && sources == null)) && (
        <div
          data-testid="sources-empty"
          style={{
            fontSize: 12, color: '#6b5513', background: '#fdf6e3',
            border: '1px solid #e6d9a8', borderRadius: 8, padding: '8px 12px',
          }}
        >
          No source manifest yet — the ingestion pipeline writes
          <code style={{ margin: '0 4px' }}>jarvis-knowledge/sources.json</code>
          as it catalogs what Jarvis reads. This panel fills in on its own.
        </div>
      )}
      {state.status === 'ok' && Array.isArray(sources) && sources.length === 0 && (
        <div data-testid="sources-empty" style={{ fontSize: 12, color: C.light }}>
          The manifest is empty — no sources cataloged yet.
        </div>
      )}
      {state.status === 'ok' && Array.isArray(sources) && sources.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
          {sources.map((s, i) => {
            const chip = accessChip(s.accessStatus);
            return (
              <div
                key={`${s.name}-${i}`}
                data-testid={`source-card-${i}`}
                style={{
                  background: C.surface,
                  border: `1px solid ${chip.attention ? '#e6d9a8' : C.border}`,
                  borderLeft: `3px solid ${chip.attention ? '#c9a643' : 'var(--color-primary)'}`,
                  borderRadius: 8, padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{s.name}</span>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, borderRadius: 999, padding: '1px 8px',
                    whiteSpace: 'nowrap', background: chip.bg, color: chip.fg, border: `1px solid ${chip.border}`,
                  }}>
                    {chip.attention ? '⚠ ' : ''}{chip.label}
                  </span>
                  <span style={{ flex: 1 }} />
                  {s.lastIngested && (
                    <span style={{ fontSize: 10, color: C.light, whiteSpace: 'nowrap' }}>
                      ingested {String(s.lastIngested).slice(0, 10)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: C.light, fontFamily: 'Consolas, monospace', marginBottom: 6, overflowWrap: 'anywhere' }}>
                  {s.location}
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {(s.takeaways ?? []).map((t2, j) => (
                    <li key={j} style={{ fontSize: 11.5, color: C.text, lineHeight: 1.5 }}>{t2}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Guide rails — the concept files, browsable AND editable (Dan, Aug 23:
// "these are my guide rails for this, for that — visual to us, we can edit
// and tweak and teach"). Saves via PUT /api/jarvis/concepts/:name; the server
// appends a file-level attribution line. ─────────────────────────────────────

function prettyConceptName(name) {
  return String(name).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function GuideRailCard({ concept, onSaved }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/jarvis/concepts/${encodeURIComponent(concept.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md: draft, editedBy: 'Dan' }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Save failed (${r.status})`);
      setEditing(false);
      onSaved(concept.name, d?.md ?? draft);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={`guiderail-${concept.name}`} style={{ marginBottom: 6 }}>
      <button
        data-testid={`guiderail-toggle-${concept.name}`}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
          background: C.sidebar, border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '6px 10px', fontSize: 12.5, fontWeight: 700, color: C.text, cursor: 'pointer',
        }}
      >
        <span style={{ color: C.muted, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        {prettyConceptName(concept.name)}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 400, color: C.light }}>
          {concept.mtime ? `updated ${fmtET(concept.mtime)}` : ''}
        </span>
      </button>
      {open && (
        <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '10px 14px' }}>
          {!editing ? (
            <>
              <MdLight md={concept.md} />
              <button
                data-testid={`guiderail-edit-${concept.name}`}
                className="btn btn--secondary"
                style={{ marginTop: 8, fontSize: 11.5, padding: '4px 14px' }}
                onClick={() => { setDraft(concept.md); setEditing(true); }}
              >✎ Edit</button>
            </>
          ) : (
            <>
              <DictatedTextarea
                value={draft}
                onChange={setDraft}
                rows={18}
                micTestId={`guiderail-mic-${concept.name}`}
                data-testid={`guiderail-editor-${concept.name}`}
                className="form-input"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, fontFamily: 'Consolas, monospace', lineHeight: 1.5, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <button
                  data-testid={`guiderail-save-${concept.name}`}
                  className="btn btn--primary"
                  disabled={busy || !draft.trim()}
                  style={{ fontSize: 11.5, padding: '4px 16px' }}
                  onClick={save}
                >{busy ? 'Saving…' : 'Save'}</button>
                <button
                  className="btn btn--secondary"
                  disabled={busy}
                  style={{ fontSize: 11.5, padding: '4px 14px' }}
                  onClick={() => setEditing(false)}
                >Cancel</button>
                {err && <span style={{ color: C.danger, fontSize: 11 }}>{err}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GuideRailsPanel() {
  const [concepts, setConcepts] = useState(null);
  useEffect(() => {
    fetch('/api/jarvis/concepts')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setConcepts(d?.concepts ?? []))
      .catch(() => setConcepts([]));
  }, []);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16 }} data-testid="guide-rails-panel">
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: C.primary }}>Guide rails (concepts)</h3>
      <div style={{ fontSize: 11.5, color: C.light, marginBottom: 10 }}>
        How SDC thinks, one topic per file — Jarvis consults these on every compile.
        Open a topic to read it; Edit to tweak and teach (saved straight back to the file).
      </div>
      {concepts === null && <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>}
      {concepts !== null && concepts.length === 0 && (
        <div style={{ color: C.light, fontSize: 13 }}>
          No concept files found (or the API isn't live yet) — they live in <code>jarvis-knowledge/concepts/</code>.
        </div>
      )}
      {(concepts ?? []).filter(c => c.name.toLowerCase() !== 'readme').map(c => (
        <GuideRailCard
          key={c.name}
          concept={c}
          onSaved={(name, md) => setConcepts(list => list.map(x => (x.name === name ? { ...x, md, mtime: new Date().toISOString() } : x)))}
        />
      ))}
    </div>
  );
}

function KnowledgeTab({ knowledge, onReload }) {
  const [collapsed, setCollapsed] = useState({});
  const [showStanding, setShowStanding] = useState(false);
  if (!knowledge) return <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>;
  const { meKnowledge, rulesHeadings } = knowledge;

  // Split standing sections from the editable learned lines.
  let standingMd = meKnowledge ?? '';
  let learnedRaw = [];
  if (meKnowledge) {
    const i = meKnowledge.indexOf(LEARNED_HEADING_MD);
    if (i !== -1) {
      standingMd = meKnowledge.slice(0, i);
      learnedRaw = meKnowledge.slice(i).split('\n').filter(l => l.trimStart().startsWith('- '));
    }
  }

  // Group learned lines by topic, in TOPIC_GROUPS order (General last).
  const groups = [];
  {
    const byId = new Map();
    for (const raw of learnedRaw) {
      const g = classifyLearned(raw);
      if (!byId.has(g.id)) byId.set(g.id, { id: g.id, label: g.label, items: [] });
      byId.get(g.id).items.push(raw);
    }
    for (const id of [...TOPIC_GROUPS.map(g => g.id), 'general']) {
      if (byId.has(id)) groups.push(byId.get(id));
    }
  }

  return (
    <div>
      <div style={{
        background: '#fdf6e3', border: `1px solid ${C.warning}`, color: '#7a6220',
        borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 16, lineHeight: 1.5,
      }}>
        Facts Jarvis <b>learned from the MEs</b> can be adjusted or removed below.
        Standing sections are maintained with the controls leads (<code>meKnowledge.md</code> /
        <code>generationRules.md</code>); new facts arrive by <b>answering his questions</b> (previous tab).
      </div>

      {/* Learned from the MEs — grouped by topic, editable */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: C.primary }}>Learned from the MEs</h3>
        <div style={{ fontSize: 11.5, color: C.light, marginBottom: 10 }}>
          Grouped by topic. Every line here rides into Jarvis's very next prompt — edits apply immediately.
        </div>
        {groups.length === 0 && (
          <div style={{ color: C.light, fontSize: 13 }}>
            Nothing learned yet — answers to Jarvis's questions land here.
          </div>
        )}
        {groups.map(g => {
          const isCollapsed = collapsed[g.id] === true;
          return (
            <div key={g.id} data-testid={`kgroup-${g.id}`} style={{ marginBottom: 6 }}>
              <button
                data-testid={`kgroup-toggle-${g.id}`}
                onClick={() => setCollapsed(c => ({ ...c, [g.id]: !isCollapsed }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
                  background: C.sidebar, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '6px 10px', fontSize: 12.5, fontWeight: 700, color: C.text, cursor: 'pointer',
                }}
              >
                <span style={{ color: C.muted, fontSize: 10 }}>{isCollapsed ? '▸' : '▾'}</span>
                {g.label}
                <span style={{
                  background: C.primary, color: '#fff', borderRadius: 999, fontSize: 10,
                  fontWeight: 700, padding: '1px 7px', marginLeft: 'auto',
                }}>{g.items.length}</span>
              </button>
              {!isCollapsed && (
                <div style={{ padding: '4px 10px 2px 14px' }}>
                  {g.items.map(raw => <LearnedLine key={raw} raw={raw} onReload={onReload} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Guide rails — browsable + editable concept files */}
      <GuideRailsPanel />

      {/* Standing knowledge — read-only */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <button
          data-testid="standing-toggle"
          onClick={() => setShowStanding(s => !s)}
          style={{ background: 'none', border: 'none', padding: 0, color: C.primary, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          {showStanding ? '▾' : '▸'} Standing knowledge (read-only)
        </button>
        <div style={{ fontSize: 11.5, color: C.light, margin: '2px 0 0' }}>
          Device taxonomy, standing SDC facts, question policy — maintained with the controls leads.
        </div>
        {showStanding && (
          standingMd.trim()
            ? <div style={{ marginTop: 8 }}><MdLight md={standingMd} /></div>
            : (
              <div style={{ color: C.light, fontSize: 13, padding: '10px 0' }}>
                Jarvis's ME-facing knowledge file (<code>meKnowledge.md</code>) doesn't exist yet.
                It's created the first time a question is answered or a lead seeds it.
              </div>
            )
        )}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: C.primary }}>Generation rules (headings)</h3>
        <div style={{ fontSize: 11.5, color: C.light, marginBottom: 10 }}>
          The law Jarvis generates L5X by — full text in <code>src/lib/agentGenerator/generationRules.md</code>.
        </div>
        {(rulesHeadings || []).length === 0
          ? <div style={{ color: C.light, fontSize: 13 }}>generationRules.md not found.</div>
          : (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.text }}>
              {rulesHeadings.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
      </div>
    </div>
  );
}

// ── Generations tab (the review grid — Dan's spec: "anything you generate
// should be aligned in a grid… what was good, what was bad — talk or text —
// the score… and a place to upload the real correct version") ────────────────

function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, padding: '6px 10px', borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap' };
const td = { fontSize: 12.5, color: C.text, padding: '7px 10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };

function modeLabel(b) {
  if (b.orphan) return '—';
  if (b.pretranslated || b.mode === 'pretranslated') return 'pretranslated';
  if (b.mode === 'translation') return 'translation';
  return 'authored';
}

/** The per-build review: What was good? / What was bad? (talk or text) +
 *  score out of 100 + reviewer + Save. Extends the score endpoint with
 *  goodNotes/badNotes. Prefilled when a review already exists. */
function ReviewSection({ build, onSaved }) {
  const [score, setScore] = useState(build.score ?? null);
  const [good, setGood] = useState(build.goodNotes || '');
  const [bad, setBad] = useState(build.badNotes || build.scoreComment || '');
  const [who, setWho] = useState(ANSWERERS.includes(build.scoredBy) ? build.scoredBy : (build.scoredBy ? 'Other' : 'Jason'));
  const [otherName, setOtherName] = useState(ANSWERERS.includes(build.scoredBy) ? '' : (build.scoredBy || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const reviewer = who === 'Other' ? otherName.trim() : who;
  const canSave = score != null && reviewer.length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(build.id)}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score,
          goodNotes: good.trim(),
          badNotes: bad.trim(),
          comment: bad.trim() || good.trim(), // legacy field stays populated
          scoredBy: reviewer,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSaved(true);
      onSaved?.(data.build);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const noteStyle = {
    width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12.5,
    border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px',
    fontFamily: 'inherit', color: C.text, background: C.surface, lineHeight: 1.5,
  };

  return (
    <div data-testid={`review-${build.id}`}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
        Review this build
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.success, marginBottom: 4 }}>What was good?</div>
          <DictatedTextarea
            rows={2} value={good} onChange={setGood}
            placeholder="What did Jarvis get right — talk or type…"
            data-testid={`review-good-${build.id}`} micTestId={`review-good-mic-${build.id}`}
            style={noteStyle}
          />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.danger, marginBottom: 4 }}>What was bad?</div>
          <DictatedTextarea
            rows={2} value={bad} onChange={setBad}
            placeholder="What was wrong or missing — talk or type…"
            data-testid={`review-bad-${build.id}`} micTestId={`review-bad-mic-${build.id}`}
            style={noteStyle}
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <ScorePicker value={score} onPick={setScore} testIdBase={`review-score-${build.id}`} />
        <select
          value={who} onChange={e => setWho(e.target.value)}
          title="Who is reviewing"
          style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, color: C.text, background: C.surface }}
        >
          {ANSWERERS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {who === 'Other' && (
          <input
            value={otherName} onChange={e => setOtherName(e.target.value)} placeholder="Name"
            style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, width: 110 }}
          />
        )}
        <button
          type="button" data-testid={`review-save-${build.id}`}
          disabled={!canSave} onClick={save}
          style={{
            background: canSave ? C.primary : C.border, color: '#fff', border: 'none',
            borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 700,
            cursor: canSave ? 'pointer' : 'default',
          }}
        >{busy ? 'Saving…' : 'Save review'}</button>
        {saved && <span data-testid={`review-saved-${build.id}`} style={{ color: C.success, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
        {error && <span style={{ color: C.danger, fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}

/** ⬆ Upload corrected version — file picker (.L5X), base64 POST, duplicate
 *  replaces only after confirm. */
function UploadCorrected({ build, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [who, setWho] = useState('Jason');
  const [otherName, setOtherName] = useState('');
  const uploadedBy = who === 'Other' ? otherName.trim() : who;

  async function post(base64, replace) {
    const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(build.id)}/corrected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, uploadedBy: uploadedBy || 'Unknown', replace }),
    });
    const data = await r.json().catch(() => ({}));
    return { r, data };
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) { setError('File too large (max 10MB)'); return; }
    setBusy(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(new Error('Could not read the file'));
        fr.readAsDataURL(file);
      });
      let { r, data } = await post(base64, false);
      if (r.status === 409 && data.needsConfirm) {
        const ok = confirm(
          `A corrected version by ${data.existing?.uploadedBy || '?'} (${String(data.existing?.at || '').slice(0, 10)}) already exists for this build.\n\nReplace it with this file? Jarvis will re-learn from the new diff.`
        );
        if (!ok) { setBusy(false); return; }
        ({ r, data } = await post(base64, true));
      }
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onUploaded?.(data.build);
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label
        data-testid={`upload-corrected-${build.id}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: C.primaryBg, border: `1px dashed ${C.primary}`, color: C.primary,
          borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >
        ⬆ Upload corrected version
        <input type="file" accept=".L5X,.l5x,.xml" disabled={busy} onChange={onPick} style={{ display: 'none' }} />
      </label>
      <span style={{ fontSize: 11, color: C.light }}>by</span>
      <select
        value={who} onChange={e => setWho(e.target.value)}
        style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 7px', fontSize: 12, color: C.text, background: C.surface }}
      >
        {ANSWERERS.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      {who === 'Other' && (
        <input
          value={otherName} onChange={e => setOtherName(e.target.value)} placeholder="Name"
          style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 7px', fontSize: 12, width: 100 }}
        />
      )}
      {busy && <span style={{ fontSize: 12, color: C.muted }}>Uploading…</span>}
      {error && <span data-testid={`upload-error-${build.id}`} style={{ color: C.danger, fontSize: 12 }}>{error}</span>}
    </div>
  );
}

/** Correction state on a build: analyzing spinner, honest failure, or the
 *  "Jarvis learned N things" expander with lessons + summary. */
function CorrectionStatus({ build, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);
  const corr = build.correction;
  if (!corr) return null;

  // Retry a failed analysis on the ALREADY-STORED corrected file — the
  // reviewer's red pen is persisted at upload; a failure never costs it.
  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(build.id)}/corrected/reanalyze`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (onUpdated && j.build) onUpdated(j.build); // flips the row to 'analyzing' → 4s poll takes over
    } catch (e) {
      setRetryError(e.message || String(e));
    } finally {
      setRetrying(false);
    }
  };

  if (corr.status === 'analyzing') {
    return (
      <div data-testid={`corr-analyzing-${build.id}`} style={{ fontSize: 12.5, color: C.primary, fontWeight: 600 }}>
        ⏳ Corrected version uploaded by {corr.uploadedBy} — Jarvis is studying the differences…
        <span style={{ color: C.light, fontWeight: 400 }}> (refreshes automatically)</span>
      </div>
    );
  }
  if (corr.status === 'failed') {
    return (
      <div data-testid={`corr-failed-${build.id}`} style={{ fontSize: 12.5, color: C.danger }}>
        ✗ Correction analysis failed: {corr.error || 'unknown error'}.
        <span style={{ color: C.muted }}> The corrected L5X is kept — nothing was lost.</span>
        <button
          type="button"
          data-testid={`corr-retry-${build.id}`}
          onClick={retry}
          disabled={retrying}
          style={{
            marginLeft: 8, background: C.surface, color: C.primary, border: `1px solid ${C.primary}`,
            borderRadius: 5, padding: '2px 10px', fontSize: 11.5, fontWeight: 700,
            cursor: retrying ? 'default' : 'pointer', opacity: retrying ? 0.6 : 1,
          }}
        >{retrying ? 'Retrying…' : '↻ Retry analysis'}</button>
        {retryError && <span style={{ marginLeft: 8, color: C.danger }}>Retry failed: {retryError}</span>}
      </div>
    );
  }
  // done
  const lessons = corr.lessons || [];
  return (
    <div data-testid={`corr-done-${build.id}`}>
      <button
        type="button"
        data-testid={`corr-view-${build.id}`}
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, color: C.success, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
      >
        ✓ Corrected version uploaded — Jarvis learned {corr.learnedCount ?? 0} thing{(corr.learnedCount ?? 0) === 1 ? '' : 's'} ({open ? 'hide' : 'view'})
      </button>
      {corr.queuedCount > 0 && (
        <span style={{ fontSize: 11.5, color: C.muted, marginLeft: 8 }}>
          + {corr.queuedCount} uncertain lesson{corr.queuedCount === 1 ? '' : 's'} sent to the leads to confirm
        </span>
      )}
      {open && (
        <div style={{ marginTop: 8, background: C.sidebar, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55, marginBottom: lessons.length ? 8 : 0 }}>
            <b>Summary:</b> {corr.summary}
          </div>
          {lessons.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0', fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '1px 7px', marginTop: 1,
                background: l.applied ? '#e6f4ea' : '#fdf6e3',
                color: l.applied ? C.success : '#7a6220' }}>
                {l.applied ? `learned → ${l.conceptFile || l.conceptArea}` : 'asked the leads'}
              </span>
              <span style={{ flex: 1 }}>{l.lesson}
                <span style={{ color: C.light, fontSize: 11 }}> ({Math.round((l.confidence || 0) * 100)}%)</span>
              </span>
            </div>
          ))}
          {corr.costUSD != null && (
            <div style={{ fontSize: 11, color: C.light, marginTop: 6 }}>
              Analysis: ${Number(corr.costUSD).toFixed(2)}
              {corr.diffStats ? ` — ${corr.diffStats.changedRungs} changed / ${corr.diffStats.addedRungs} added / ${corr.diffStats.removedRungs} removed rungs, ${corr.diffStats.tagChanges} tag changes` : ''}
              {corr.uploadedBy ? ` — corrected by ${corr.uploadedBy}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pre-delivery internal review (the "pre-Jason pass") ─────────────────────
// Jarvis's own adversarial review of the generated file against the template,
// run as the last pipeline stage. 'ship' = clean; 'fix' = NOT ready for
// external delivery — a human decides (never auto-regenerated).

const REVIEW_SEVERITY_COLOR = { blocker: 'danger', style: 'warning', note: 'muted' };

/** THE FINAL VERDICT of a build's review loop (Dan's stale-chip bug,
 *  2026-08-25: v7 showed a mid-loop "fix — 8 findings" while its recorded
 *  final verdict was ship). Priority: the build's top-level verdict (stamped
 *  at delivery) → the LAST reviewHistory round → the internalReview record.
 *  `stale` marks an internalReview snapshot older than the final verdict. */
function finalReviewOf(b) {
  const rounds = Array.isArray(b?.reviewHistory) ? b.reviewHistory : [];
  const last = rounds.length ? rounds[rounds.length - 1] : null;
  const verdict = b?.verdict ?? last?.verdict ?? b?.internalReview?.verdict ?? null;
  const stale = !!(b?.internalReview && verdict != null && b.internalReview.verdict !== verdict);
  return { verdict, rounds, last, stale };
}

/** Small grid-row chip — always the FINAL verdict, never a stale
 *  intermediate; the round count rides as a quiet suffix ("8 rounds → ship"). */
function InternalReviewChip({ ir, build = null }) {
  const fin = build ? finalReviewOf(build) : { verdict: ir?.verdict ?? null, rounds: [], stale: false };
  if (!ir && fin.verdict == null) return null;
  const verdict = fin.verdict;
  const failed = verdict == null; // review attempted but didn't complete
  const ship = verdict === 'ship';
  const unsure = verdict === 'unsure';
  const n = fin.stale ? (fin.last?.blockers ?? 0) : (ir?.findings || []).length;
  const nq = (ir?.standardsQuestions || []).length || (ir?.questionIds || []).length;
  const roundsNote = fin.rounds.length > 1 ? ` · ${fin.rounds.length} rounds` : '';
  const label = failed ? 'review failed'
    : ship ? `✓ internal review: ship${roundsNote}`
    : unsure ? `⏸ internal review: held — ${nq || 1} standards question${nq === 1 ? '' : 's'}`
    : `⚠ internal review: ${n} finding${n === 1 ? '' : 's'}${roundsNote}`;
  const title = failed ? `Internal review did not complete: ${ir?.error || 'unknown error'}`
    : ship ? `Jarvis reviewed this file the way a senior CE would — clean to send${fin.rounds.length > 1 ? ` (${fin.rounds.length} review/fix rounds → ship)` : ''}`
    : unsure ? 'Jarvis could not determine whether a structural choice meets SDC standards — build HELD; standards question(s) filed for the controls team (see the Questions queue)'
    : 'Jarvis\'s own review found issues — NOT ready for external delivery until a human decides';
  return (
    <span
      title={title}
      style={{
        marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap',
        background: failed ? C.sidebar : ship ? '#e6f4ea' : unsure ? '#fdf6e3' : '#fdecec',
        color: failed ? C.muted : ship ? C.success : unsure ? C.warning : C.danger,
      }}
    >{label}</span>
  );
}

/** THE ROUND TIMELINE (Dan's transparency demand, 2026-08-25): every recorded
 *  review round as one step line — "Round N · full/delta · verdict · note" —
 *  ending with the final verdict prominent. Renders what's actually persisted
 *  (older builds without reviewHistory just show their single record). */
function ReviewRoundTimeline({ build }) {
  const fin = finalReviewOf(build);
  if (!fin.rounds.length) return null;
  const verdictTone = (v) => v === 'ship' ? C.success : v === 'unsure' ? C.warning : C.danger;
  return (
    <div data-testid={`review-timeline-${build.id}`} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
        Review rounds ({fin.rounds.length})
      </div>
      {fin.rounds.map((r, i) => {
        const kind = /delta/i.test(String(r.round)) ? 'delta review' : 'full review';
        return (
          <div key={i} data-testid={`review-round-${build.id}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, lineHeight: 1.6, minWidth: 0 }}>
            <span style={{ color: C.light, fontFamily: 'Consolas, monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ color: C.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>{kind}</span>
            <span style={{ fontWeight: 700, color: verdictTone(r.verdict), whiteSpace: 'nowrap', flexShrink: 0 }}>{r.verdict}</span>
            {Number(r.blockers) > 0 && <span style={{ color: C.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>{r.blockers} blocker{r.blockers === 1 ? '' : 's'}</span>}
            {r.note && <span style={{ color: C.muted, minWidth: 0, overflowWrap: 'anywhere' }}>— {r.note}</span>}
          </div>
        );
      })}
      <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: verdictTone(fin.verdict) }}>
        {fin.rounds.length} round{fin.rounds.length === 1 ? '' : 's'} → {fin.verdict ?? 'no verdict'}
        {build.shippedAs ? ` · shipped as ${build.shippedAs}` : ''}
      </div>
    </div>
  );
}

/** Expanded-row section: FINAL-verdict banner + expandable findings list.
 *  A stale mid-loop internalReview snapshot is labeled as history, never
 *  presented as the build's state (Dan's v7 bug). */
function InternalReviewDetail({ ir, build = null }) {
  const [open, setOpen] = useState(false);
  if (!ir) return null;
  const fin = build ? finalReviewOf(build) : { verdict: ir.verdict ?? null, rounds: [], stale: false };
  const ship = fin.verdict === 'ship';
  const failed = fin.verdict == null;
  const unsure = fin.verdict === 'unsure';
  const findings = ir.findings || [];
  const missing = ir.missingVsTemplate || [];
  const questions = ir.standardsQuestions || [];
  const nq = questions.length || (ir.questionIds || []).length;
  const expandable = findings.length > 0 || missing.length > 0 || questions.length > 0;
  return (
    <div style={{
      border: `1px solid ${failed ? C.border : ship ? C.success : unsure ? C.warning : C.danger}`,
      borderRadius: 8, padding: '10px 14px',
      background: failed ? C.sidebar : ship ? '#f2faf4' : unsure ? '#fdf9ee' : '#fef7f7',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: failed ? C.muted : ship ? C.success : unsure ? C.warning : C.danger }}>
          {failed ? 'Internal review did not complete'
            : ship ? `✓ Internal review: ship — Jarvis put his name on it${fin.rounds.length > 1 ? ` (${fin.rounds.length} rounds → ship)` : ''}`
            : unsure ? `⏸ Internal review: unsure — ${ir.heldStatus || `held, ${nq || 1} standards question${nq === 1 ? '' : 's'} filed for the controls team`}`
            : '⚠ Internal review: fix — NOT ready for external delivery'}
        </span>
        {fin.stale && (
          <span data-testid="review-stale-note" style={{ fontSize: 10.5, color: C.muted }}>
            the findings below are a mid-loop snapshot — later rounds resolved them
          </span>
        )}
        {ir.costUSD != null && <span style={{ fontSize: 10.5, color: C.light }}>${Number(ir.costUSD).toFixed(2)}</span>}
        {expandable && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
            style={{ background: 'none', border: 'none', padding: 0, color: C.primary, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
          >{open ? '▾ hide details' : `▸ ${findings.length + missing.length + questions.length} item${findings.length + missing.length + questions.length === 1 ? '' : 's'}`}</button>
        )}
      </div>
      <div style={{ fontSize: 12, color: C.text, marginTop: 6 }}>
        {failed ? (ir.error || 'The review call failed — the build is kept, but treat it as UNREVIEWED, not clean.') : (ir.summary || '')}
      </div>
      {unsure && (
        <div style={{ fontSize: 11.5, color: C.warning, marginTop: 6, fontWeight: 600 }}>
          Unsure is not a violation — Jarvis hit a structural choice the standards knowledge doesn't answer.
          The build is HELD (not shipped, not guessed at) until the controls team answers the filed question{nq === 1 ? '' : 's'} in the Questions queue.
        </div>
      )}
      {!ship && !failed && !unsure && (
        <div style={{ fontSize: 11.5, color: C.danger, marginTop: 6, fontWeight: 600 }}>
          Jarvis never regenerates on his own verdict — review the findings and decide: fix and rebuild, or overrule.
        </div>
      )}
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {questions.length > 0 && (
            <div style={{ fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
                Standards questions filed (source: internal review)
              </div>
              {questions.map((q, i) => (
                <div key={i} style={{ marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, marginRight: 6 }}>{q.topic}:</span>{q.question}
                </div>
              ))}
            </div>
          )}
          {findings.map((f, i) => (
            <div key={i} style={{ fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px' }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                borderRadius: 999, padding: '1px 6px', marginRight: 8,
                background: f.severity === 'blocker' ? '#fdecec' : f.severity === 'style' ? '#fdf6e3' : C.sidebar,
                color: C[REVIEW_SEVERITY_COLOR[f.severity] || 'muted'],
              }}>{f.severity}</span>
              {f.routine && <span style={{ fontFamily: 'Consolas, monospace', fontSize: 11, color: C.muted, marginRight: 6 }}>{f.routine}</span>}
              <span>{f.finding}</span>
              {f.templateEvidence && (
                <div style={{ marginTop: 4, fontSize: 11, color: C.muted }}>
                  Template evidence: <span style={{ fontFamily: 'Consolas, monospace' }}>{f.templateEvidence}</span>
                </div>
              )}
            </div>
          ))}
          {missing.length > 0 && (
            <div style={{ fontSize: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
                Missing vs template
              </div>
              {missing.map((m, i) => <div key={i}>• {m}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Build insights — "Key assumptions" / "Key standards" (UI BREVITY LAW,
//    Dan 2026-08-22): a FEW one-sentence bullets, general idea only, NEVER
//    enumerations; each capped at ~15 words; anything non-informative is
//    dropped. Sources: build.writingNotes (assumptions) + the station's
//    compiled templateConformance (standards). Thumbs feed the existing
//    decisions/review path (reinforcement / deny-and-teach). ─────────────────

/** Condense one note to ≤15 words, general idea only; null = drop it. */
function condenseBullet(s) {
  let t = String(s ?? '').trim().replace(/^\*\s*\w+\s*(\([^)]*\))?\s*:?\s*/i, '');
  // Cut before enumerations/detail: colon lists, parentheticals, em-dash
  // tails, second sentences.
  t = t.split(/[:;(—]|\.\s/)[0].trim().replace(/[.,]$/, '');
  // NEVER enumerate specifics (state-number lists like "52/55/58/61").
  t = t.replace(/\b\d+(\s*[/,+]\s*\d+)+\b/g, '').replace(/\s{2,}/g, ' ').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 15) t = words.slice(0, 15).join(' ') + '…';
  if (!t || t.split(/\s+/).length < 3) return null; // not informative
  return t[0].toUpperCase() + t.slice(1);
}

function BuildInsights({ row }) {
  const filename = useDiagramStore(s => s.currentFilename);
  const sm = useDiagramStore(s =>
    (s.project?.stateMachines ?? []).find(m => m.name === row.sm || m.displayName === row.sm) ?? null
  );
  const cs = sm?.compiledSequence;
  const reviews = cs?.decisionReviews || [];
  const reviewFor = (text) => reviews.find(r => r.decisionText === text) || null;

  const dedupe = (arr) => [...new Set(arr)];
  const assumptions = dedupe(
    (row.writingNotes ?? [])
      .map(n => (typeof n === 'string' ? n : n?.text))
      .map(condenseBullet)
      .filter(Boolean)
  ).slice(0, 6);
  const standards = dedupe(
    (cs?.ir?.templateConformance ?? [])
      .map(c => condenseBullet(c?.decision))
      .filter(Boolean)
  ).slice(0, 6);

  if (assumptions.length === 0 && standards.length === 0) return null;

  const canReview = !!(sm && filename);
  async function review(decisionText, verdict, why) {
    if (!canReview) throw new Error('Open this build\'s project to review');
    const r = await fetch('/api/jarvis/decisions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, smId: sm.id, decisionText, verdict, why, reviewer: 'ME' }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    mirrorDecisionReviews(sm.id, data.decisionReviews);
  }

  const block = (label, items, testid) => items.length > 0 && (
    <div data-testid={testid} style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '2px 12px' }}>
        {items.map((t, i) => (
          canReview
            ? <DecisionLine key={i} text={t} review={reviewFor(t)} onReview={review} />
            : <div key={i} style={{ padding: '5px 0', fontSize: 12.5, color: C.text, borderBottom: `1px solid ${C.border}` }}>{t}</div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {block('Key assumptions', assumptions, `build-assumptions-${row.id}`)}
      {block('Key standards', standards, `build-standards-${row.id}`)}
    </div>
  );
}

/** Dossier blocks beyond assumptions/standards: rulings & lessons applied
 *  (build.notes), structural changes flagged (with approval state), and the
 *  held questions this build asked. One line each — brevity law. Sourced
 *  strictly from the recorded build; absent fields render nothing. */
function BuildDossierBlocks({ row }) {
  const rulings = String(row.notes || '')
    .split(/;\s*|\n/)
    .map(s => s.trim())
    .filter(Boolean);
  const changes = Array.isArray(row.structuralChanges) ? row.structuralChanges : [];
  const helpQs = row.help?.questions ?? [];
  if (!rulings.length && !changes.length && !helpQs.length) return null;
  const block = (label, testid, children) => (
    <div data-testid={testid} style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px' }}>
        {children}
      </div>
    </div>
  );
  const line = { padding: '4px 0', fontSize: 12, color: C.text, lineHeight: 1.5, borderBottom: `1px solid ${C.border}` };
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {rulings.length > 0 && block('Rulings & lessons applied', `build-rulings-${row.id}`,
        rulings.map((t, i) => <div key={i} style={line}>{t}</div>))}
      {changes.length > 0 && block('Structural changes flagged', `build-structchanges-${row.id}`,
        changes.map((c, i) => (
          <div key={i} style={line}>
            {c.text}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: c.approved ? C.success : C.warning }}>
              {c.approved ? `✓ approved${c.approvedBy ? ` by ${c.approvedBy}` : ''}` : 'awaiting approval'}
            </span>
          </div>
        )))}
      {helpQs.length > 0 && block(`Questions this build asked (${row.help?.status ?? ''})`, `build-helpqs-${row.id}`,
        helpQs.map((q, i) => (
          <div key={i} style={line}>
            {q.question}
            {q.proposedSolution && <span style={{ color: C.muted }}> — proposed: {q.proposedSolution}</span>}
          </div>
        )))}
    </div>
  );
}

/** One expanded grid row: download, review, upload-corrected, learning state. */
function GenerationDetail({ row, onUpdated }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {row.filePath ? (
          <a
            data-testid={`download-${row.id}`}
            href={`/api/jarvis/builds/${encodeURIComponent(row.id)}/file`}
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
              background: C.primary, color: '#fff', borderRadius: 6, padding: '6px 14px',
              fontSize: 12, fontWeight: 700,
            }}
          >⬇ Download L5X</a>
        ) : (
          <span style={{ fontSize: 12, color: C.light }}>No saved file on disk for this build.</span>
        )}
        {row.correction?.filePath && row.correction.status !== 'analyzing' && (
          <a
            href={`/api/jarvis/builds/${encodeURIComponent(row.id)}/file?which=corrected`}
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
              background: C.surface, color: C.primary, border: `1px solid ${C.primary}`,
              borderRadius: 6, padding: '5px 13px', fontSize: 12, fontWeight: 700,
            }}
          >⬇ Corrected version</a>
        )}
        {row.filePath && (
          <span style={{ fontSize: 11, color: C.light, fontFamily: 'Consolas, monospace' }}>
            {String(row.filePath).split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      {/* ── THE DOSSIER (Dan, 2026-08-25): what Jarvis knew, decided, and
          checked to make THIS file — all from what's already recorded on the
          build + compiledSequence; surfaced, never invented. ── */}

      {/* Key assumptions / standards — condensed, thumbs feed decisions/review */}
      <BuildInsights row={row} />

      {/* Rulings & lessons applied (build.notes — e.g. "X permissive per
          Jason 8/25"), structural changes flagged, held questions answered. */}
      <BuildDossierBlocks row={row} />

      {/* Round-by-round review timeline — ends with the final verdict. */}
      <ReviewRoundTimeline build={row} />

      {row.internalReview && <InternalReviewDetail ir={row.internalReview} build={row} />}

      {row.orphan ? (
        <div style={{ fontSize: 12, color: C.muted }}>
          This file predates build recording — download works, but reviews and corrected uploads
          need a recorded build (every new generation records one automatically).
        </div>
      ) : (
        <>
          <ReviewSection build={row} onSaved={onUpdated} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
              The real correct version — Jarvis learns from the diff
            </div>
            {row.correction && <div style={{ marginBottom: 8 }}><CorrectionStatus build={row} onUpdated={onUpdated} /></div>}
            {(!row.correction || row.correction.status !== 'analyzing') && (
              <UploadCorrected build={row} onUploaded={onUpdated} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Live in-flight work (from GET /api/jarvis/active) rendered as spinner rows
// at the top of the grid — Dan: "if it's generating at the time, it'll show
// you generating." Flips to a normal reviewable row on completion (the same
// 4s poll refreshes the grid).
const ACTIVE_TYPE_LABEL = {
  generation: 'Generating',
  pretranslation: 'Pre-building (approved sequence)',
  compile: 'Compiling sequence',
};

function fmtElapsed(startedAtIso, now) {
  const ms = now - new Date(startedAtIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ActiveRow({ w, now }) {
  return (
    <tr data-testid={`active-row-${w.id}`} style={{ background: C.primaryBg }}>
      <td style={{ ...td, width: 18 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
            border: `2px solid ${C.primary}`, borderTopColor: 'transparent',
            animation: 'jarvisActiveSpin 0.9s linear infinite',
          }}
        />
      </td>
      <td style={{ ...td, fontWeight: 700, color: C.primary }} colSpan={11}>
        {ACTIVE_TYPE_LABEL[w.type] || 'Working'} — {w.sm || 'station…'}
        {w.project ? ` (${w.project})` : ''}
        <span style={{ color: C.muted, fontWeight: 400 }}> — {fmtElapsed(w.startedAt, now)} elapsed</span>
        <span style={{ color: C.light, fontWeight: 400, fontSize: 11 }}> · appears below when done</span>
      </td>
    </tr>
  );
}

// ── Station pipeline — mission control (Dan: "give me a grid view of: the
// code compile status; any questions you need answered; any decisions you
// want a controls engineer's input on; and when it's done, the L5X right
// there, and next to it score it and provide feedback") ─────────────────────

/** Truncate a decision to its first clause for the one-line list. */
function firstClause(s) {
  const t = String(s).trim();
  const m = t.split(/(?<=[.;:])\s+|\s+—\s+/)[0] || t;
  return m.length > 110 ? m.slice(0, 110) + '…' : m;
}

/** Derive one station's pipeline status.
 *  → { key, label, tone: 'live'|'ok'|'warn'|'bad'|'muted', live? } */
function stationStatus(sm, activeList, pretrans, gaps) {
  const act = (activeList || []).find(w => w.sm === sm.name);
  if (act) {
    const label = act.type === 'compile' ? 'Compiling'
      : act.type === 'pretranslation' ? 'Building code'
      : 'Generating';
    return { key: 'live', label, tone: 'live', live: act };
  }
  const cs = sm.compiledSequence;
  const p = pretrans?.[sm.id];
  if (cs?.approved === true) {
    if (p && p.error) return { key: 'failed', label: `✗ Code build failed — ${String(p.error).slice(0, 80)}`, tone: 'bad' };
    if (isPretranslatedReady(p)) {
      if (p.ok === false) return { key: 'ready-warn', label: '⚠ Code built — validation reported errors', tone: 'warn' };
      // Pre-delivery internal review verdict gates "ready" — always the FINAL
      // verdict of the review loop, never a stale mid-loop record (Dan's v7).
      const fv = finalReviewOf(p).verdict;
      if (fv === 'fix') {
        const n = (p.internalReview?.findings || []).length;
        return { key: 'ready-review', label: `⚠ Code built — internal review: ${n || 'open'} finding${n === 1 ? '' : 's'}, not ready to send`, tone: 'warn' };
      }
      // 'unsure' = HELD: Jarvis couldn't determine whether a structural choice
      // meets SDC standards — questions filed, controls team answers first.
      if (fv === 'unsure') {
        const nq = (p.internalReview?.standardsQuestions || []).length || (p.internalReview?.questionIds || []).length || 1;
        return { key: 'ready-held', label: `⏸ Code built — ${p.internalReview?.heldStatus || `held — ${nq} standards question${nq === 1 ? '' : 's'} filed for the controls team`}`, tone: 'warn' };
      }
      return fv === 'ship'
        ? { key: 'ready', label: '✓ Code ready — internal review: ship', tone: 'ok' }
        : { key: 'ready', label: '✓ Code ready', tone: 'ok' };
    }
    return { key: 'approved', label: 'Approved — Generate builds the code', tone: 'muted' };
  }
  if (cs) return { key: 'awaiting-approve', label: 'Compiled — awaiting approve', tone: 'warn' };
  if (gaps.length > 0) return { key: 'servo-needed', label: `⚠ ${servoGapSummary(gaps)}`, tone: 'warn', servo: true };
  return { key: 'not-compiled', label: 'Not compiled', tone: 'muted' };
}

const STATUS_TONE = {
  live:  { color: C.primary, bg: C.primaryBg },
  ok:    { color: C.success, bg: '#e6f4ea' },
  warn:  { color: '#7a6220', bg: '#fdf6e3' },
  bad:   { color: C.danger, bg: '#fdecec' },
  muted: { color: C.muted, bg: C.sidebar },
};

/** ✓/✗ review controls for ONE decision line. */
function DecisionLine({ text, review, onReview }) {
  const [showFull, setShowFull] = useState(false);
  const [denying, setDenying] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const short = firstClause(text);
  const truncated = short !== text.trim();

  async function submit(verdict) {
    setBusy(true); setError(null);
    try {
      await onReview(text, verdict, verdict === 'denied' ? why.trim() : '');
      setDenying(false);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div style={{ padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: C.text }} title={text}>
          {showFull ? text : short}
          {truncated && (
            <button
              onClick={() => setShowFull(f => !f)}
              style={{ background: 'none', border: 'none', color: C.primary, fontSize: 11, cursor: 'pointer', padding: '0 4px' }}
            >{showFull ? 'less' : 'more'}</button>
          )}
        </span>
        {review ? (
          <span style={{
            flexShrink: 0, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px',
            background: review.verdict === 'good' ? '#e6f4ea' : '#fdecec',
            color: review.verdict === 'good' ? C.success : C.danger,
          }} title={review.verdict === 'denied' ? `${review.reviewer}: ${review.why}` : `Approved by ${review.reviewer}`}>
            {review.verdict === 'good' ? `✓ ${review.reviewer}` : `✗ denied — ${review.reviewer}`}
          </span>
        ) : (
          <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button
              disabled={busy}
              title="Good decision — recorded (reinforcement)"
              onClick={() => submit('good')}
              style={{ background: '#e6f4ea', border: `1px solid ${C.success}`, color: C.success, borderRadius: 5, width: 26, height: 22, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >✓</button>
            <button
              disabled={busy}
              title="Deny — tell Jarvis why (he learns from it)"
              onClick={() => setDenying(d => !d)}
              style={{ background: '#fdecec', border: `1px solid ${C.danger}`, color: C.danger, borderRadius: 5, width: 26, height: 22, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >✗</button>
          </span>
        )}
      </div>
      {denying && !review && (
        <div style={{ marginTop: 6 }}>
          <DictatedTextarea
            rows={2} value={why} onChange={setWhy}
            placeholder="Why is this wrong? Jarvis files this as a lesson — talk or type…"
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12,
              border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px',
              fontFamily: 'inherit', color: C.text, background: C.surface, lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <button
              disabled={busy || !why.trim()}
              onClick={() => submit('denied')}
              style={{ background: why.trim() ? C.danger : C.border, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >{busy ? 'Sending…' : 'Deny & teach'}</button>
            <button
              disabled={busy}
              onClick={() => { setDenying(false); setError(null); }}
              style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
            >Cancel</button>
            {error && <span style={{ color: C.danger, fontSize: 11 }}>{error}</span>}
          </div>
        </div>
      )}
      {error && !denying && <div style={{ color: C.danger, fontSize: 11, marginTop: 3 }}>{error}</div>}
    </div>
  );
}

function sectionHead(label) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, margin: '0 0 6px' }}>
      {label}
    </div>
  );
}

/** One station's expanded row: status detail → questions → decisions → code+review. */
function StationDetail({ sm, projectName, status, stationQuestions, onQuestionUpdate, latestBuild, onRowUpdated, gaps }) {
  const filename = useDiagramStore(s => s.currentFilename);
  const [reviewer, setReviewer] = useState('Jason');
  const cs = sm.compiledSequence;
  const flags = (cs?.ir?.reviewFlags || []).map(String);
  const reviews = cs?.decisionReviews || [];
  const reviewFor = (text) => reviews.find(r => r.decisionText === text) || null;

  async function reviewDecision(decisionText, verdict, why) {
    const r = await fetch('/api/jarvis/decisions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, smId: sm.id, decisionText, verdict, why, reviewer }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    mirrorDecisionReviews(sm.id, data.decisionReviews); // auto-save consistency
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1 — status detail */}
      <div>
        {sectionHead('Pipeline status')}
        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
          {status.label}
          {cs && <span style={{ color: C.light }}> — compiled {String(cs.compiledAt || '').slice(0, 16).replace('T', ' ')}{cs.approved ? `, approved` : ', not yet approved'}</span>}
        </div>
        {gaps.length > 0 && (
          <button
            data-testid={`station-servo-link-${sm.name}`}
            onClick={() => useV2Shell.getState().openServoTable(sm.id)}
            style={{ background: 'none', border: 'none', color: C.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, textDecoration: 'underline', marginTop: 4 }}
          >Open the servo values table → fill in what's known</button>
        )}
      </div>

      {/* 2 — open questions for this station, answerable inline */}
      {stationQuestions.length > 0 && (
        <div>
          {sectionHead(`Questions Jarvis needs answered (${stationQuestions.length})`)}
          {stationQuestions.map(q => <QuestionCard key={q.id} q={q} onUpdate={onQuestionUpdate} />)}
        </div>
      )}

      {/* 3 — decisions & assumptions: one short line each, ✓ / ✗-with-why */}
      {flags.length > 0 && (
        <div data-testid={`station-decisions-${sm.name}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {sectionHead(`Jarvis's decisions & assumptions (${flags.length})`)}
            <span style={{ fontSize: 11, color: C.light, marginLeft: 'auto' }}>reviewing as</span>
            <select
              value={reviewer} onChange={e => setReviewer(e.target.value)}
              style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 7px', fontSize: 11, color: C.text, background: C.surface }}
            >
              {ANSWERERS.filter(n => n !== 'Other').map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '4px 12px' }}>
            {flags.map((f, i) => (
              <DecisionLine key={i} text={f} review={reviewFor(f)} onReview={reviewDecision} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.light, marginTop: 4 }}>
            ✓ records the decision as good. ✗ asks why — the why is filed into Jarvis's concept
            knowledge, attributed to you.
          </div>
        </div>
      )}

      {/* 4 — the code + the full review loop (same block as the history grid) */}
      <div>
        {sectionHead('Code & feedback')}
        {latestBuild
          ? <GenerationDetail row={latestBuild} onUpdated={onRowUpdated} />
          : <div style={{ fontSize: 12.5, color: C.light }}>No generated file yet — it lands here the moment a build finishes.</div>}
      </div>
    </div>
  );
}

/** The mission-control grid: one row per station of the OPEN project. */
function StationPipeline({ active, gens, questions, onQuestionUpdate, onRowUpdated, now }) {
  const project = useDiagramStore(s => s.project);
  const filename = useDiagramStore(s => s.currentFilename);
  const [expandedId, setExpandedId] = useState(null);
  const [pretrans, setPretrans] = useState({}); // smId -> payload

  const sms = project?.stateMachines ?? [];
  const activeCount = (active || []).length;

  // Pretranslation status for approved stations — refetched when in-flight
  // work count changes (a finishing pre-build flips "building" → "code ready").
  useEffect(() => {
    if (!filename) return;
    let alive = true;
    sms.filter(s => s.compiledSequence?.approved === true).forEach(s => {
      fetchPretranslated(filename, s.id).then(p => {
        if (alive && p) setPretrans(prev => ({ ...prev, [s.id]: p }));
      });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, activeCount, sms.map(s => `${s.id}:${s.compiledSequence?.approved ? 1 : 0}:${s.compiledSequence?.compiledAt || ''}`).join('|')]);

  if (sms.length === 0) return null;

  const buildsFor = (sm) => (gens?.builds || [])
    .filter(b => b.sm === sm.name && (!project?.name || !b.project || b.project === project.name))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const openQuestionsFor = (sm) => (questions || []).filter(q =>
    q.status === 'open' &&
    (String(q.context || '').includes(sm.name) || (sm.displayName && String(q.context || '').includes(sm.displayName))));

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16, overflowX: 'auto' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>
        {project?.name || 'Current project'} — station pipeline
      </div>
      <div style={{ fontSize: 11.5, color: C.light, marginBottom: 10 }}>
        Live status per station: compile → approve → code. Open a row for Jarvis's questions,
        his decisions to approve or deny, and the file with its review.
      </div>
      <table data-testid="station-pipeline" style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={th}></th>
            <th style={th}>Station</th>
            <th style={th}>Status</th>
            <th style={th}>Questions</th>
            <th style={th}>Decisions</th>
            <th style={th}>Latest score /100</th>
          </tr>
        </thead>
        <tbody>
          {sms.map(sm => {
            const gaps = servoGaps(sm);
            const status = stationStatus(sm, active, pretrans, gaps);
            const tone = STATUS_TONE[status.tone];
            const builds = buildsFor(sm);
            const latest = builds[0] || null;
            const qs = openQuestionsFor(sm);
            const flags = (sm.compiledSequence?.ir?.reviewFlags || []);
            const reviewed = (sm.compiledSequence?.decisionReviews || []).length;
            const expanded = expandedId === sm.id;
            return [
              <tr
                key={sm.id}
                data-testid={`pipeline-row-${sm.name}`}
                onClick={() => setExpandedId(e => (e === sm.id ? null : sm.id))}
                style={{ cursor: 'pointer', background: expanded ? C.primaryBg : undefined }}
              >
                <td style={{ ...td, color: C.muted, fontSize: 10, width: 18 }}>{expanded ? '▾' : '▸'}</td>
                <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{sm.displayName || sm.name}</td>
                <td style={td}>
                  <span
                    data-testid={`pipeline-status-${sm.name}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '2px 10px',
                      background: tone.bg, color: tone.color, whiteSpace: 'nowrap',
                    }}
                  >
                    {status.tone === 'live' && (
                      <span aria-hidden style={{
                        display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                        border: `2px solid ${C.primary}`, borderTopColor: 'transparent',
                        animation: 'jarvisActiveSpin 0.9s linear infinite',
                      }} />
                    )}
                    {status.label}
                    {status.live && <span style={{ fontWeight: 400 }}>— {fmtElapsed(status.live.startedAt, now)} elapsed</span>}
                  </span>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {qs.length > 0
                    ? <span style={{ background: C.primary, color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 8px' }}>{qs.length} open</span>
                    : <span style={{ color: C.light }}>—</span>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {flags.length > 0
                    ? <span style={{ color: reviewed >= flags.length ? C.success : C.muted, fontSize: 12 }}>{reviewed}/{flags.length} reviewed</span>
                    : <span style={{ color: C.light }}>—</span>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700, color: latest?.score != null ? scoreColor100(latest.score) : C.light }}>
                  {latest?.score != null ? `${latest.score} / 100` : latest ? 'unscored' : '—'}
                </td>
              </tr>,
              expanded && (
                <tr key={`${sm.id}-detail`}>
                  <td style={{ ...td, background: C.sidebar, padding: '14px 16px' }} colSpan={6}>
                    <StationDetail
                      sm={sm}
                      projectName={project?.name}
                      status={status}
                      stationQuestions={qs}
                      onQuestionUpdate={onQuestionUpdate}
                      latestBuild={latest}
                      onRowUpdated={onRowUpdated}
                      gaps={gaps}
                    />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact one-glyph mode indicator (full word in the tooltip) — the MODE
 *  column was eating width Dan needs (no horizontal scroll). */
function modeGlyph(b) {
  const m = modeLabel(b);
  if (m === 'pretranslated') return { glyph: '⚡', title: 'pretranslated — instant from the approved sequence' };
  if (m === 'translation') return { glyph: '⇄', title: 'translation — from the approved sequence' };
  if (m === 'authored') return { glyph: '✎', title: 'authored — full generation' };
  return { glyph: '—', title: '' };
}

/** Click-to-score, right in the grid (Dan): the cell IS the control. Empty →
 *  "score it"; click → inline /100 picker (typed number, Enter commits, plus
 *  25/50/75/90/100 quick chips — existing POST /api/jarvis/builds/:id/score
 *  path, same /100 scale as the detail panel review). Scored → "N / 100",
 *  still click-to-change. */
export function InlineScore({ row, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const color = scoreColor100(row.score);

  async function setScore(n) {
    setBusy(true);
    try {
      const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(row.id)}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: n }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onUpdated?.(d.build ?? { ...row, score: n });
    } catch { /* row keeps its old score; the detail panel path still works */ }
    finally { setBusy(false); setOpen(false); }
  }

  if (row.orphan) return <span style={{ color: C.light }}>—</span>;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        data-testid={`quick-score-${row.id}`}
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        title={row.score != null
          ? `${row.score} / 100${row.scoredBy ? ` — ${row.scoredBy}` : ''} · click to change`
          : `Click to score this build — ${SCORE_SCALE_HINT}`}
        style={{
          background: row.score != null ? 'transparent' : C.primaryBg,
          border: row.score != null ? 'none' : `1px dashed ${C.primaryBorder ?? C.border}`,
          borderRadius: 8, padding: row.score != null ? 0 : '1px 8px',
          fontSize: row.score != null ? 12.5 : 10.5, fontWeight: 700,
          color: row.score != null ? color : C.primary, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {busy ? '…' : row.score != null ? `${row.score} / 100` : 'score it'}
      </button>
      {open && (
        <span
          data-testid={`quick-score-picker-${row.id}`}
          style={{
            position: 'absolute', top: '115%', right: 0, zIndex: 60,
            display: 'flex', alignItems: 'center', gap: 4, background: '#fff',
            border: `1px solid ${C.border}`, borderRadius: 8, padding: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)', whiteSpace: 'nowrap',
          }}
        >
          <ScorePicker value={row.score} onPick={setScore} testIdBase={`quick-score-${row.id}`} autoFocus />
        </span>
      )}
    </span>
  );
}

function GenerationsTab({ gens, track, active, questions, onQuestionUpdate, onRowUpdated, focusSmName = null }) {
  const [expandedId, setExpandedId] = useState(null);
  // Working (unnamed intermediate) builds collapse under a quiet expander.
  const [showWorking, setShowWorking] = useState(false);

  // "View code" landing: expand + scroll to this station's latest build once
  // the grid has loaded (one-shot).
  const [focusDone, setFocusDone] = useState(false);
  useEffect(() => {
    if (focusDone || !focusSmName || !gens) return;
    const hit = (gens.builds || [])
      .filter(b => b.sm === focusSmName)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
    if (!hit) { setFocusDone(true); return; }
    setExpandedId(hit.id);
    setShowWorking(true); // the latest build may be an unnamed intermediate
    setFocusDone(true);
    setTimeout(() => {
      document.querySelector(`[data-testid="gen-row-${hit.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }, [focusSmName, gens, focusDone]);
  const [showTrack, setShowTrack] = useState(false);
  // 1s ticker so the "2:31 elapsed" on in-progress rows counts live.
  const [now, setNow] = useState(() => Date.now());
  const hasActive = (active || []).length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasActive]);
  if (!gens) return <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>;

  const buildList = gens.builds || [];
  const rows = [...buildList, ...(gens.orphans || [])]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  // DELIVERED vs WORKING (Dan, 2026-08-25: "I've only had v4, v5, v6 — I
  // don't know what the rest are"): rows with a delivery label are the
  // primary list; unnamed intermediates collapse under a quiet expander.
  const deliveryLabelOf = (b) => b.label
    || (String(b.filePath || '').match(/_(v\d+(?:\/v\d+)?)_SHIP/i)?.[1] ?? null);
  const deliveredRows = rows.filter(b => deliveryLabelOf(b));
  const workingRows = rows.filter(b => !deliveryLabelOf(b));
  // The download question answers itself: the newest DELIVERED build wears
  // the "latest — in JARVIS Deliveries" tag.
  const latestDeliveredId = deliveredRows.length ? deliveredRows[0].id : null;

  // Avg score per Jarvis version — only versions that actually have scores.
  const avgByVersion = [];
  {
    const acc = new Map();
    for (const b of buildList) {
      if (b.score == null) continue;
      const v = b.jarvisVersion || '?';
      const e = acc.get(v) || { sum: 0, n: 0 };
      e.sum += b.score; e.n += 1;
      acc.set(v, e);
    }
    for (const [v, e] of [...acc.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      avgByVersion.push({ version: v, avg: e.sum / e.n, n: e.n });
    }
  }
  const corrected = buildList.filter(b => b.correction?.status === 'done').length;
  const learned = buildList.reduce((n, b) => n + (b.correction?.learnedCount || 0), 0);

  return (
    <div>
      <style>{'@keyframes jarvisActiveSpin { to { transform: rotate(360deg); } }'}</style>

      {/* Mission control — one row per station of the open project */}
      <StationPipeline
        active={active}
        gens={gens}
        questions={questions}
        onQuestionUpdate={onQuestionUpdate}
        onRowUpdated={onRowUpdated}
        now={now}
      />

      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 14px', lineHeight: 1.6 }}>
        Every program Jarvis has generated, in one grid. Open a row to download the L5X,
        review it (what was good, what was bad — talk or text — and a score out of 100), and
        upload the real correct version — Jarvis diffs it against his own output and learns.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Current version', value: track?.version ? `v${track.version}` : '—' },
          { label: 'Generations', value: rows.length },
          { label: 'Corrected & learned from', value: corrected },
          { label: 'Lessons learned', value: learned },
          ...avgByVersion.map(a => ({
            label: `Avg score v${a.version} (${a.n})`,
            value: `${Math.round(a.avg)} / 100`,
            testId: `avg-score-${a.version}`,
          })),
        ].map(s => (
          <div key={s.label} data-testid={s.testId} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.primary }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* No horizontal scroll (Dan): compact date, project truncates with a
          tooltip, MODE is one glyph, and the valuable columns — Jarvis
          version, duration, cost, score — stay prominent. */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <table data-testid="generations-grid" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={th}></th>
              <th style={th}>Name</th><th style={th}>Project</th><th style={th}>Jarvis</th>
              <th style={th}>Date (ET)</th><th style={th}>Dur</th><th style={th}>Cost</th>
              <th style={th}>L5X</th><th style={th}>Score /100</th>
            </tr>
          </thead>
          <tbody>
            {(active || []).map(w => <ActiveRow key={w.id} w={w} now={now} />)}
            {(() => {
            const renderRow = (row) => {
              const expanded = expandedId === row.id;
              const scoreColor = scoreColor100(row.score);
              return [
                <tr
                  key={row.id}
                  data-testid={`gen-row-${row.id}`}
                  onClick={() => setExpandedId(e => (e === row.id ? null : row.id))}
                  style={{ cursor: 'pointer', background: expanded ? C.primaryBg : undefined }}
                >
                  <td style={{ ...td, color: C.muted, fontSize: 10, width: 18 }}>{expanded ? '▾' : '▸'}</td>
                  {/* NAME (Dan, 2026-08-25): the human name of the build —
                      station + delivery label ("ServoPNP · v6"), never
                      filename jargon like v4_SHIP. Label comes from the
                      buildScores record; unlabeled builds show just the
                      station. */}
                  <td style={{ ...td, fontWeight: 700 }}>
                    {row.sm || '—'}
                    {deliveryLabelOf(row) && <span style={{ color: C.muted, fontWeight: 700 }}> · {deliveryLabelOf(row)}</span>}
                    {row.id === latestDeliveredId && (
                      <span
                        data-testid="latest-delivered-tag"
                        title={`The newest delivered version${row.shippedAs ? ` — ${row.shippedAs}` : ''} — the file lives in JARVIS Deliveries`}
                        style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                          borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap',
                          background: '#e8f0fa', color: C.primary,
                        }}
                      >latest — in JARVIS Deliveries</span>
                    )}
                    {row.correction && (
                      <span
                        title={row.correction.status === 'done' ? `Corrected by ${row.correction.uploadedBy} — Jarvis learned ${row.correction.learnedCount ?? 0}`
                          : row.correction.status === 'failed' ? `Analysis failed: ${row.correction.error || 'unknown error'} — open the row to retry`
                          : `Correction ${row.correction.status}`}
                        style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                          borderRadius: 999, padding: '1px 6px',
                          background: row.correction.status === 'done' ? '#e6f4ea' : row.correction.status === 'failed' ? '#fdecec' : C.primaryBg,
                          color: row.correction.status === 'done' ? C.success : row.correction.status === 'failed' ? C.danger : C.primary,
                        }}
                      >{row.correction.status === 'done' ? '✓ corrected' : row.correction.status === 'failed' ? 'analysis failed' : 'analyzing…'}</span>
                    )}
                    <InternalReviewChip ir={row.internalReview} build={row} />
                  </td>
                  <td style={{ ...td, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.project || ''}>
                    {row.project || '—'}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{row.jarvisVersion ? `v${row.jarvisVersion}` : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: C.muted }} title={fmtETFull(row.at)}>
                    {fmtET(row.at)}
                  </td>
                  {/* Dur: only meaningful when it actually took time (Dan) */}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{row.durationS ? fmtDuration(row.durationS * 1000) : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{row.costUSD != null ? `$${Number(row.costUSD).toFixed(2)}` : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    <a
                      data-testid={`gen-l5x-${row.id}`}
                      href={`/api/jarvis/builds/${encodeURIComponent(row.id)}/file`}
                      download
                      title={`Download the L5X${row.filePath ? ` — ${String(row.filePath).split(/[\\/]/).pop()}` : ''}`}
                      style={{ color: C.primary, fontWeight: 700, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}
                    >📄 L5X</a>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700, color: scoreColor }} data-testid={`gen-score-${row.id}`}>
                    <InlineScore row={row} onUpdated={onRowUpdated} />
                  </td>
                </tr>,
                expanded && (
                  <tr key={`${row.id}-detail`}>
                    <td style={{ ...td, background: C.sidebar, padding: '14px 16px' }} colSpan={9}>
                      <GenerationDetail row={row} onUpdated={onRowUpdated} />
                    </td>
                  </tr>
                ),
              ];
            };
            return [
              ...deliveredRows.map(renderRow),
              workingRows.length > 0 && (
                <tr key="working-expander">
                  <td style={{ ...td, borderBottom: 'none' }} colSpan={9}>
                    <button
                      type="button"
                      data-testid="working-builds-toggle"
                      onClick={() => setShowWorking(s => !s)}
                      title="Pretranslations, compiles and superseded attempts — the builds that never became a delivered version"
                      style={{ background: 'none', border: 'none', padding: '2px 0', color: C.muted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                    >
                      {showWorking ? '▾' : '▸'} {showWorking ? 'hide' : `+ ${workingRows.length}`} working build{workingRows.length === 1 ? '' : 's'}
                      <span style={{ fontWeight: 400, color: C.light }}> — intermediates, never delivered</span>
                    </button>
                  </td>
                </tr>
              ),
              ...(showWorking ? workingRows.map(renderRow) : []),
            ];
            })()}
            {rows.length === 0 && !hasActive && <tr><td style={td} colSpan={9}>No generations yet — the grid fills in as Jarvis builds stations.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px' }}>
        <button
          data-testid="trackrecord-toggle"
          onClick={() => setShowTrack(s => !s)}
          style={{ background: 'none', border: 'none', padding: 0, color: C.primary, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          {showTrack ? '▾' : '▸'} Track record — version history & benchmarks
        </button>
        {showTrack && <div style={{ marginTop: 10 }}><TrackRecordDetails track={track} /></div>}
      </div>
    </div>
  );
}

function TrackRecordDetails({ track }) {
  if (!track) return <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>;
  const { version, history = [], benchmarks = [] } = track;

  const rows = [...benchmarks].sort((a, b) => String(a.ranAt || '').localeCompare(String(b.ranAt || '')));

  return (
    <div>
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: C.primary }}>Version history</h3>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={th}>Version</th><th style={th}>Date</th><th style={th}>Changes</th></tr></thead>
          <tbody>
            {[...history].reverse().map(h => (
              <tr key={h.version}>
                <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>v{h.version}{h.version === version ? ' ●' : ''}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{h.date}</td>
                <td style={{ ...td, lineHeight: 1.5 }}>{h.changes}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td style={td} colSpan={3}>No version history available.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', color: C.primary }}>Benchmarks</h3>
        <div style={{ fontSize: 11.5, color: C.light, marginBottom: 10 }}>
          Every run in <code>benchmarks/</code> — fails included. "oldgen" rows are the
          pre-Jarvis rule-based exporter. ME builds live in the grid above.
        </div>
        <table data-testid="benchmark-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Version</th><th style={th}>Project / Station</th><th style={th}>Result</th>
              <th style={th}>Attempts</th><th style={th}>Duration</th><th style={th}>Cost</th>
              <th style={th}>Errors / Warnings</th><th style={th}>Ran</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(b => (
              <tr key={`bench-${b.file}`}>
                <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{b.version ? `v${b.version}` : 'oldgen'}</td>
                <td style={td}>{b.project}{b.smName ? ` / ${b.smName}` : ''}</td>
                <td style={{ ...td, fontWeight: 700, color: b.ok ? C.success : C.danger, whiteSpace: 'nowrap' }}>
                  {b.parseError ? 'unreadable' : (b.ok ? '✓ Pass' : '✗ Fail')}
                </td>
                <td style={td}>{b.attemptsUsed ?? '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDuration(b.durationMs)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{b.costUSD != null ? `$${b.costUSD.toFixed(2)}` : '—'}</td>
                <td style={td}>{b.errors ?? '—'} / {b.warnings ?? '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: C.muted }}>{String(b.ranAt || '').slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={td} colSpan={8}>No benchmark reports found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── "How Jarvis works" tab — REBUILT (Dan, 2026-08-26: "I'm asking how
//    Jarvis THINKS to generate good code — not how the app works"). The tab
//    is now the THINKING CONTRACT: Jason Perry's 14-step process VERBATIM
//    (jarvis-knowledge/concepts/how-jason-writes-code.md), one card per step
//    — the step, HOW Jarvis executes it, and WHAT INFORMATION it needs from
//    the ME. "If he follows the same structure a controls engineer uses,
//    there's a much higher success chance." The app-mechanics walkthrough is
//    demoted to a small secondary section below. ──────────────────────────────

// Jason's 14 steps, VERBATIM (Jason Perry, 2026-08-26, via Dan). `how` = the
// pipeline phase/mechanism that executes the step; `needs` = what the ME must
// have provided for the step to run (checked off from the spec sheet).
const JASON_STEPS = [
  {
    step: 'Read Project Release to gain understanding of project',
    how: 'HONEST GAP — no release intake exists yet: your explanation and Reference material stand in for it during the pre-write study, and Jarvis asks when project-level context is clearly missing.',
    needs: ['Project context in your explanation — or the release extract dropped into Reference material'],
    gap: true,
  },
  {
    step: 'Read customer URS for machine requirements',
    how: 'HONEST GAP — same: machine requirements arrive only through you until a URS intake lands; the describe conversation carries the extra weight.',
    needs: ['Machine requirements stated in the description — or the URS attached as reference'],
    gap: true,
  },
  {
    step: 'Review device and I/O list with ME',
    how: 'The spec extraction builds the device tables from your words; a dropped BOM (xlsx/csv) seeds them; the cascade\'s per-machine DEVICES steps are this review — approve or rename right there.',
    needs: ['Every device named (or a BOM attached)', 'Sensors per device — retract-only is the SDC default', 'IO details whenever you mention them'],
  },
  {
    step: 'Review machine and station operation with ME',
    how: 'The describe phase plus the cascade\'s SEQUENCE, RECOVERY and INTERACTIONS steps; corrections ride the chat and come back as receipts.',
    needs: ['The cycle, in order', 'What happens on a failure', 'How the station interacts with its neighbors (or "standalone")'],
  },
  {
    step: 'Review station state logic diagrams',
    how: 'The compile plans the complete sequence on the SDC number grid; you read the flowchart on the Diagram page and Approve — approve means "I agree with this sequence".',
    needs: ['Your Approve on the diagram'],
  },
  {
    step: 'Select appropriate SDC Standards template',
    how: 'Template-family selection in the pre-write study; every structural choice cites the template pattern it follows or declares itself an extension.',
    needs: [],
  },
  {
    step: 'Follow SDC standard program structure',
    how: 'The merge engine owns the template bytes — Jarvis never retypes SDC boilerplate; THE CHECK verifies the structure survived.',
    needs: [],
  },
  {
    step: 'Follow SDC standard naming convention',
    how: 'Every i_/q_/p_ tag derives from the device names at export (tagNaming rules); your renames win and cascade everywhere.',
    needs: ['Device names confirmed at the cascade\'s devices step'],
  },
  {
    step: 'Organize programs by station with appropriate numbering',
    how: 'S{nn}_ program naming from the station number — one program per state machine of the APPROVED breakup.',
    needs: ['Station number', 'The approved state-machine breakup'],
  },
  {
    step: 'Organize subroutines properly (inputs in inputs routine, transitions in state transitions, outputs in outputs, etc.)',
    how: 'The R00→R20 layout is generated per routine: inputs in R01, transitions in R02 (ascending state order), outputs in R03, servo in R04/R05, alarms in R20.',
    needs: [],
  },
  {
    step: 'Use descriptive rung and tag comments',
    how: 'Comments generate from the state map — R02 rung 0 embeds the full map; comments name the physical action, never the mechanics.',
    needs: ['Clear state wording — your sequence lines become the labels'],
  },
  {
    step: 'Write easy to follow logic',
    how: 'Template structural shapes are law; the reviewer flags anything a senior SDC controls engineer would squint at.',
    needs: [],
  },
  {
    step: 'Write logic accounting for all required interlocks (e.g. Z retracted before X moves)',
    how: 'Interlocks derive from the geometry you gave — positions, transition points and corner blends drive the Z-before-X style permissives and the wideband motion overlap.',
    needs: ['Every servo axis position table filled (mm) — a mechanical-team prerequisite', 'Blend / transition values where the path has them'],
  },
  {
    step: 'Write logic including all SDC standard data (production, shift, nest, station, top alarms) + logic avoiding unnecessary machine stoppages',
    how: 'The standard data blocks come from the CE standards documents; retries and warnings come before faults — the prime directive: machines that stop less.',
    needs: ['Retry counts, only when your description implies a retry'],
  },
];

const HOW_STEPS = [
  {
    icon: '📋',
    title: 'You fill out the Spec Sheet',
    body: 'Describe the station in plain words — talk or type. Jarvis reads it against his standing SDC knowledge (the device taxonomy, standing facts, and everything the MEs have taught him) and fills the spec’s tables: devices, named positions, sensors & timers. Anything only you can know — mechanical intent, geometry, positions — he asks right on the sheet, always with his own proposed answer.',
  },
  {
    icon: '🧠',
    title: 'Compile — Jarvis plans the sequence',
    body: 'One deep reasoning pass takes your drawn sequence, the spec’s tables, and the SDC template pattern notes, and plans the complete sequence: every state on the SDC number grid, real tag conditions on every transition, waits with all their exits, retries, fault recovery, handshakes. Every structural choice must cite the SDC template pattern it follows or declare itself an extension — that record is the "How I planned this" panel on the Diagram page.',
  },
  {
    icon: '✅',
    title: 'You approve',
    body: 'Read the flowchart and the plan, fill any values he flagged, click Approve. Approve means "I agree with this sequence" — Jarvis immediately pre-builds the code in the background, so Generate is near-instant when you get to it.',
  },
  {
    icon: '⚙️',
    title: 'Generate — Jarvis writes the code',
    body: 'Jarvis authors an edit plan against the SDC standard template, guided by the generation rules and targeted template extracts — the merge engine owns the template bytes, so he never retypes SDC boilerplate. Approved stations translate fast from their compiled sequence; unapproved ones go through the full reasoning lane. If he genuinely gets stuck he pauses the build and asks, with a proposed solution attached.',
  },
  {
    icon: '🔍',
    title: 'THE CHECK — every build, both lanes',
    body: 'Jarvis reviews the finished file the way a senior CE would: against the template family and the CE-authored standards documents. Findings land with the build. If writing the code changed the planned structure, the change is highlighted for your quick approve — never a silent divergence between diagram and code.',
  },
  {
    icon: '📦',
    title: 'Delivery',
    body: 'The L5X lands on the Code Generation page and in the Code grid — version, cost, validation, your score. Notes from writing ride along with the build. Genuinely general "how does SDC want this done" questions go to the leads’ queue, and what he learns is appended to his knowledge so no question is ever asked twice.',
  },
];

// "HOW A BUILD IS CHECKED" (Dan's transparency demand, 2026-08-25) — the
// review pipeline step-by-step, brevity law, one screen of cards.
const CHECK_STEPS = [
  {
    icon: '📐',
    title: 'Mechanical gates — free, instant',
    body: 'Geometry sanity, import simulation, flow/state-order, template conformance. Deterministic — no model, no cost. A hard failure stops the build before any review runs.',
  },
  {
    icon: '🔍',
    title: 'THE CHECK — one question',
    body: 'Would a senior SDC controls engineer sign this file? The whole build is reviewed against the CE standards documents, Jason\'s recorded lessons, and the template family\'s patterns.',
  },
  {
    icon: '⚖️',
    title: 'Three verdicts',
    body: 'ship — clean to send. fix — the findings go back to the writer and the loop runs again. unsure — the build HOLDS and a standards question is filed for the leads; Jarvis never guesses past a standard.',
  },
  {
    icon: '🔁',
    title: 'The loop, capped',
    body: 'Review → fix → re-review until ship, with a hard round cap so a build can never burn forever. Every round is recorded — a build\'s expanded row shows its full timeline ("8 rounds → ship"), and the row chip always shows the FINAL verdict.',
  },
  {
    icon: '📦',
    title: 'Delivery gate',
    body: 'Only a ship verdict earns a version label (v6, v7) and a file in JARVIS Deliveries. Everything else stays a working build — collapsed in the grid, never delivered.',
  },
];

function HowJarvisWorksTab({ onSeeKnowledge }) {
  const [showAppFlow, setShowAppFlow] = useState(false);
  return (
    <div data-testid="jarvis-how-tab">
      {/* THE THINKING CONTRACT (Dan, 2026-08-26): how Jarvis THINKS to
          generate good code — Jason's process, step for step. */}
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 4 }}>
        <b style={{ color: C.text }}>How Jarvis thinks — Jason Perry's 14-step process, verbatim.</b>{' '}
        Jarvis follows the same structure a senior SDC controls engineer uses;
        each card says how he executes the step and what it needs from you.
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 14 }}>
        Steps 1–6 are the study phase (understanding before writing);
        steps 7–14 are checkable properties of the output file — every review
        finding traces back to the step it violates.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {JASON_STEPS.map((s, i) => (
          <div
            key={i}
            data-testid={`jarvis-jason-step-${i + 1}`}
            style={{
              background: C.surface, border: `1px solid ${s.gap ? '#e8b64c' : C.border}`, borderRadius: 8,
              padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 800, color: '#fff', background: C.primary,
                borderRadius: 4, padding: '1px 7px', flexShrink: 0,
              }}>{i + 1}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text, lineHeight: 1.4 }}>
                {s.step}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: s.gap ? '#6b5513' : C.muted, lineHeight: 1.55 }}>
              <b style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: s.gap ? '#92400e' : C.muted }}>How Jarvis does it — </b>
              {s.how}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
              <b style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted }}>Needs from you</b>
              {s.needs.length === 0 ? (
                <div style={{ color: '#2f6b3c' }}>✓ Nothing — decided from SDC standards</div>
              ) : s.needs.map((n, j) => (
                <div key={j} style={{ color: C.text }}>☐ {n}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The app-mechanics walkthrough — DEMOTED to a secondary section
          (Dan: the thinking contract is the page; the app flow is a footnote). */}
      <div data-testid="jarvis-how-appflow" style={{ marginTop: 18 }}>
        <button
          type="button"
          data-testid="jarvis-how-appflow-toggle"
          onClick={() => setShowAppFlow(v => !v)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 12.5, fontWeight: 800, color: C.text,
          }}
        >{showAppFlow ? '▾' : '▸'} The app flow (where each step happens on screen)</button>
        {showAppFlow && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 10, marginTop: 8 }}>
            {HOW_STEPS.map((s, i) => (
              <div
                key={i}
                data-testid={`jarvis-how-step-${i}`}
                style={{
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{s.icon}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>
                    {i + 1}. {s.title}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{s.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* HOW A BUILD IS CHECKED — the review pipeline, one screen (Dan). */}
      <div data-testid="jarvis-how-checked" style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>
          How a build is checked
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 10 }}>
          {CHECK_STEPS.map((s, i) => (
            <div
              key={i}
              data-testid={`jarvis-check-step-${i}`}
              style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{i + 1}. {s.title}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: C.muted }}>
        The documents, templates, and lessons behind all of this are cataloged in{' '}
        <button
          type="button"
          data-testid="jarvis-how-see-knowledge"
          onClick={onSeeKnowledge}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: C.primary, fontWeight: 700, fontSize: 12, textDecoration: 'underline',
          }}
        >What Jarvis knows</button> — one card per ingested source.
      </div>
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'generations', label: 'Generated code' },
  { id: 'questions', label: 'Questions for Controls' },
  { id: 'knowledge', label: 'What Jarvis knows' },
  { id: 'how', label: 'How Jarvis works' },
];

// focusSmName: land on the generations grid with THIS station's latest build
// expanded and scrolled into view (the pipeline button's "View code" stage).
export function JarvisPage({ onClose, focusSmName = null }) {
  const [tab, setTab] = useState('generations');
  const [questions, setQuestions] = useState(null);
  const [knowledge, setKnowledge] = useState(null);
  const [track, setTrack] = useState(null);
  const [gens, setGens] = useState(null);
  const [active, setActive] = useState([]); // live in-flight work (GET /api/jarvis/active)
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    getJson('/api/jarvis/questions').then(setQuestions).catch(e => setLoadError(e.message));
  }, []);
  // Knowledge is re-fetched every time the tab is entered so a just-answered
  // question's learned line shows up immediately.
  useEffect(() => {
    if (tab === 'knowledge') getJson('/api/jarvis/knowledge').then(setKnowledge).catch(e => setLoadError(e.message));
    if (tab === 'generations' && !track) getJson('/api/jarvis/trackrecord').then(setTrack).catch(e => setLoadError(e.message));
    // The grid refreshes every time the tab is entered so a just-scored or
    // just-corrected build shows immediately.
    if (tab === 'generations') getJson('/api/jarvis/generations').then(setGens).catch(e => setLoadError(e.message));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live in-flight work — poll GET /api/jarvis/active every 4s while the grid
  // is showing so "Generating — Station X" rows appear/disappear on their own.
  useEffect(() => {
    if (tab !== 'generations') return;
    let alive = true;
    const load = () => getJson('/api/jarvis/active')
      .then(d => { if (alive) setActive(Array.isArray(d.active) ? d.active : []); })
      .catch(() => { if (alive) setActive([]); });
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [tab]);

  // While a correction analysis OR any live generation/compile/pretranslation
  // is running, poll the grid every 4s so the "analyzing…" row flips to
  // lessons and a finished in-progress row flips to its reviewable row
  // without a manual refresh.
  const analyzing = tab === 'generations'
    && ((gens?.builds || []).some(b => b.correction?.status === 'analyzing') || active.length > 0);
  useEffect(() => {
    if (!analyzing) return;
    const t = setInterval(() => {
      getJson('/api/jarvis/generations').then(setGens).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [analyzing]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function updateQuestion(updated) {
    setQuestions(qs => (qs || []).map(q => (q.id === updated.id ? updated : q)));
  }

  const openCount = (questions || []).filter(q => q.status === 'open').length;

  return (
    <div
      data-testid="jarvis-page"
      style={{
        // 1200 — above .modal-overlay (1000) so "See all generated code →"
        // from inside the Generate modal lands ON TOP of it, not under it.
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', height: 52,
        background: 'var(--color-toolbar)', flexShrink: 0,
        borderBottom: `1px solid var(--color-border-dark, ${C.border})`,
      }}>
        <button
          data-testid="jarvis-back"
          onClick={() => onClose?.()}
          style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '6px 14px', cursor: 'pointer',
          }}
        >← Back</button>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Jarvis</div>
        <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
          A developing SDC controls engineer — his code, questions, knowledge, and track record
        </div>
        {/* Output folder + legacy exporters — file stuff lives with the files
            (moved here from the removed top-bar Build ▾ menu). */}
        <FilesMenu />
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '10px 22px 0', background: C.sidebar,
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              data-testid={`jarvis-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: active ? C.surface : 'transparent',
                border: `1px solid ${active ? C.border : 'transparent'}`,
                borderBottom: active ? `1px solid ${C.surface}` : '1px solid transparent',
                marginBottom: -1,
                borderRadius: '8px 8px 0 0', padding: '9px 18px',
                fontSize: 13, fontWeight: active ? 700 : 600,
                color: active ? C.primary : C.muted, cursor: 'pointer',
              }}
            >
              {t.label}
              {t.id === 'questions' && questions != null && (
                <span
                  data-testid="jarvis-open-count"
                  style={{
                    background: openCount > 0 ? C.primary : C.border,
                    color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 7px',
                  }}
                >{openCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Body — generations gets the full width Dan's grid needs (no
          horizontal scroll); the prose-y tabs keep a readable measure. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px 40px' }}>
        <div style={{ maxWidth: tab === 'generations' ? 1280 : 900, margin: '0 auto' }}>
          {loadError && (
            <div style={{ background: '#fdecec', border: `1px solid ${C.danger}`, color: C.danger, borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 14 }}>
              Couldn't reach the Jarvis API: {loadError} — is the project server running?
            </div>
          )}
          {tab === 'questions' && (
            questions == null
              ? <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>
              : <QuestionsTab questions={questions} onUpdate={updateQuestion} />
          )}
          {tab === 'knowledge' && (
            <>
              <KnowledgeSourcesPanel />
              <KnowledgeTab
                knowledge={knowledge}
                onReload={() => getJson('/api/jarvis/knowledge').then(setKnowledge).catch(e => setLoadError(e.message))}
              />
            </>
          )}
          {tab === 'how' && (
            <HowJarvisWorksTab onSeeKnowledge={() => setTab('knowledge')} />
          )}
          {tab === 'generations' && (
            <GenerationsTab
              gens={gens}
              track={track}
              active={active}
              questions={questions}
              focusSmName={focusSmName}
              onQuestionUpdate={updateQuestion}
              onRowUpdated={(updated) => setGens(g => (g ? {
                ...g,
                builds: (g.builds || []).map(b => (b.id === updated.id ? updated : b)),
              } : g))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
