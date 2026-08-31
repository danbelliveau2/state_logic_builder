/**
 * BuildScoreRow — the compact "score this build" control (Dan: every build
 * gets scored by the person who ran it).
 *
 * Scores are OUT OF 100 (Dan: "more fun, more level of detail"). The shared
 * <ScorePicker> lives here: a typed number input (digits only, Enter commits)
 * plus one-click quick-pick chips (25/50/75/90/100). Color thresholds:
 * ≥70 green · ≥40 amber · <40 red (scoreColor100).
 *
 * BuildScoreRow itself = ScorePicker + optional comment (talk-or-type via
 * DictatedTextarea) + who + Save. POSTs /api/jarvis/builds/:id/score and hands
 * the updated build back through onScored. Used by JarvisGenerateModal's
 * completion view. ScorePicker/scoreColor100 are also used by JarvisPage's
 * InlineScore and ReviewSection. SDC palette only.
 */

import { useEffect, useState } from 'react';
import { DictatedTextarea } from './DictatedTextarea.jsx';

const C = {
  primary: 'var(--color-primary)',
  primaryBg: '#e8f0fa',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  light: 'var(--color-text-light)',
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
  warning: '#a07c14',
  surface: 'var(--color-surface)',
};

/** One-click quick-pick values — the common scores. Typed input covers the rest. */
export const QUICK_SCORES = [25, 50, 75, 90, 100];

/** Score color on the /100 scale: ≥70 green, ≥40 amber, <40 red, null muted. */
export function scoreColor100(s) {
  if (s == null) return C.light;
  return s >= 70 ? C.success : s >= 40 ? C.warning : C.danger;
}

export const SCORE_SCALE_HINT = 'Score out of 100 — 1 = unusable, 100 = ship it untouched';

/**
 * ScorePicker — number input (digits only; Enter or blur commits) + quick-pick
 * chips. onPick(n) fires with a valid integer 1-100; invalid input just shows
 * a red border and never commits.
 */
export function ScorePicker({ value, onPick, testIdBase, autoFocus = false }) {
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => { setText(value != null ? String(value) : ''); }, [value]);

  const trimmed = text.trim();
  const n = /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : NaN;
  const valid = Number.isInteger(n) && n >= 1 && n <= 100;

  function commit() {
    if (valid && n !== value) onPick(n);
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }} title={SCORE_SCALE_HINT}>
      <input
        value={text}
        autoFocus={autoFocus}
        onChange={e => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
        onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        inputMode="numeric"
        placeholder="1-100"
        data-testid={testIdBase ? `${testIdBase}-input` : undefined}
        style={{
          width: 52, fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '4px 6px',
          border: `1px solid ${trimmed && !valid ? C.danger : C.border}`, borderRadius: 6,
          color: valid ? scoreColor100(n) : C.text, background: C.surface,
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, whiteSpace: 'nowrap' }}>/ 100</span>
      {QUICK_SCORES.map(q => {
        const active = value === q;
        return (
          <button
            key={q}
            type="button"
            data-testid={testIdBase ? `${testIdBase}-${q}` : undefined}
            onClick={() => onPick(q)}
            title={`Score ${q} / 100`}
            style={{
              minWidth: 30, height: 24, borderRadius: 6, fontSize: 11, fontWeight: 700, padding: '0 5px',
              border: `1px solid ${active ? C.primary : C.border}`,
              background: active ? C.primary : C.surface,
              color: active ? '#fff' : scoreColor100(q),
              cursor: 'pointer',
            }}
          >{q}</button>
        );
      })}
    </span>
  );
}

export function BuildScoreRow({ buildId, onScored }) {
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const canSave = score != null && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/jarvis/builds/${encodeURIComponent(buildId)}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim(), scoredBy: who.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onScored?.(data.build);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div data-testid={`score-row-${buildId}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <ScorePicker value={score} onPick={setScore} testIdBase={`score-pick-${buildId}`} />
      <DictatedTextarea
        rows={1}
        value={comment}
        onChange={setComment}
        placeholder="Comment (optional)…"
        micTestId={`score-mic-${buildId}`}
        data-testid={`score-comment-${buildId}`}
        containerStyle={{ flex: 1, minWidth: 200 }}
        className="form-input"
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'none', fontSize: 12,
          padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: 6,
          fontFamily: 'inherit', color: C.text, background: C.surface, lineHeight: 1.4,
        }}
      />
      <input
        value={who}
        onChange={e => setWho(e.target.value)}
        placeholder="Your name"
        data-testid={`score-who-${buildId}`}
        style={{ width: 90, fontSize: 12, padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: C.surface }}
      />
      <button
        type="button"
        data-testid={`score-save-${buildId}`}
        disabled={!canSave}
        onClick={save}
        style={{
          background: canSave ? C.primary : C.border, color: '#fff', border: 'none',
          borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700,
          cursor: canSave ? 'pointer' : 'default',
        }}
      >{busy ? 'Saving…' : 'Save'}</button>
      {error && <span style={{ color: C.danger, fontSize: 11 }}>{error}</span>}
    </div>
  );
}
