/**
 * BuildScoreRow — the compact "score this build" control (Dan: every build
 * gets scored by the person who ran it).
 *
 * 1-10 selector + optional comment (talk-or-type via DictatedTextarea) +
 * who + Save. POSTs /api/jarvis/builds/:id/score and hands the updated build
 * back through onScored. Used by JarvisGenerateModal's completion view and
 * inline in JarvisPage's Track record table. SDC palette only.
 */

import { useState } from 'react';
import { DictatedTextarea } from './DictatedTextarea.jsx';

const C = {
  primary: 'var(--color-primary)',
  primaryBg: '#e8f0fa',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  danger: 'var(--color-danger)',
  surface: 'var(--color-surface)',
};

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
      <div style={{ display: 'flex', gap: 2 }} title="1 = unusable, 10 = ship it untouched">
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
          const active = score === n;
          return (
            <button
              key={n}
              type="button"
              data-testid={`score-pick-${n}-${buildId}`}
              onClick={() => setScore(n)}
              style={{
                width: 24, height: 24, borderRadius: 4, fontSize: 11, fontWeight: 700,
                border: `1px solid ${active ? C.primary : C.border}`,
                background: active ? C.primary : C.surface,
                color: active ? '#fff' : C.muted,
                cursor: 'pointer', padding: 0,
              }}
            >{n}</button>
          );
        })}
      </div>
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
