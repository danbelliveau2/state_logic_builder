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
 *   1. Questions for Controls (default) — open questions grouped by source,
 *      inline answer box + answerer name, Dismiss. Answering POSTs
 *      /api/jarvis/questions/:id/answer which ALSO appends the answer to
 *      meKnowledge.md, so the very next Jarvis prompt includes it.
 *   2. What Jarvis knows — read-only render of meKnowledge.md + the
 *      generationRules.md rule headings.
 *   3. Track record — jarvisVersion HISTORY + benchmark reports + generated
 *      file count. Honest, data-driven: fails show as fails.
 *
 * All data comes from the API server (GET /api/jarvis/questions, /knowledge,
 * /trackrecord) so the page reflects what's actually on disk.
 * SDC palette only.
 */

import { useEffect, useMemo, useState } from 'react';

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
      <textarea
        data-testid={`answer-input-${q.id}`}
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        placeholder="Type the answer Jarvis should learn…"
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

function KnowledgeTab({ knowledge }) {
  if (!knowledge) return <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>;
  const { meKnowledge, rulesHeadings } = knowledge;
  return (
    <div>
      <div style={{
        background: '#fdf6e3', border: `1px solid ${C.warning}`, color: '#7a6220',
        borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 16, lineHeight: 1.5,
      }}>
        Read-only. Corrections reach Jarvis by <b>answering his questions</b> (previous tab)
        or by the controls leads editing <code>meKnowledge.md</code> / <code>generationRules.md</code> directly.
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        {meKnowledge
          ? <MdLight md={meKnowledge} />
          : (
            <div style={{ color: C.light, fontSize: 13, padding: '10px 0' }}>
              Jarvis's ME-facing knowledge file (<code>meKnowledge.md</code>) doesn't exist yet.
              It's created the first time a question is answered or a lead seeds it.
            </div>
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

// ── Track record tab ─────────────────────────────────────────────────────────

function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, padding: '6px 10px', borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap' };
const td = { fontSize: 12.5, color: C.text, padding: '7px 10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };

function TrackRecordTab({ track }) {
  if (!track) return <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>;
  const { version, history = [], benchmarks = [], generatedCount = 0 } = track;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Current version', value: version ? `v${version}` : '—' },
          { label: 'Benchmark runs', value: benchmarks.length },
          { label: 'Passing', value: benchmarks.filter(b => b.ok).length },
          { label: 'Generated L5X files', value: generatedCount },
        ].map(s => (
          <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.primary }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', marginBottom: 16, overflowX: 'auto' }}>
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

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', overflowX: 'auto' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', color: C.primary }}>Benchmarks</h3>
        <div style={{ fontSize: 11.5, color: C.light, marginBottom: 10 }}>
          Every run in <code>benchmarks/</code> — fails included. "oldgen" rows are the pre-Jarvis rule-based exporter.
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
            {benchmarks.map(b => (
              <tr key={b.file}>
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
            {benchmarks.length === 0 && <tr><td style={td} colSpan={8}>No benchmark reports found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'questions', label: 'Questions for Controls' },
  { id: 'knowledge', label: 'What Jarvis knows' },
  { id: 'track', label: 'Track record' },
];

export function JarvisPage({ onClose }) {
  const [tab, setTab] = useState('questions');
  const [questions, setQuestions] = useState(null);
  const [knowledge, setKnowledge] = useState(null);
  const [track, setTrack] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    getJson('/api/jarvis/questions').then(setQuestions).catch(e => setLoadError(e.message));
  }, []);
  // Knowledge is re-fetched every time the tab is entered so a just-answered
  // question's learned line shows up immediately.
  useEffect(() => {
    if (tab === 'knowledge') getJson('/api/jarvis/knowledge').then(setKnowledge).catch(e => setLoadError(e.message));
    if (tab === 'track' && !track) getJson('/api/jarvis/trackrecord').then(setTrack).catch(e => setLoadError(e.message));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
        position: 'fixed', inset: 0, zIndex: 900,
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
          A developing SDC controls engineer — his questions, knowledge, and track record
        </div>
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

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px 40px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
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
          {tab === 'knowledge' && <KnowledgeTab knowledge={knowledge} />}
          {tab === 'track' && <TrackRecordTab track={track} />}
        </div>
      </div>
    </div>
  );
}
