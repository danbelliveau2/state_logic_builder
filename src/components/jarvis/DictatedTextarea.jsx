/**
 * DictatedTextarea — "anywhere you're typing, you should always have the
 * ability to type or talk" (Dan).
 *
 * A controlled textarea with the shared voice-dictation affordance overlaid
 * at its top-right: MicButton toggle, a pulsing red dot while listening, and
 * a light-gray ghost strip for interim (not-yet-final) speech. Final speech
 * goes through the normal onChange path via useDictation, exactly like the
 * describe box — so any consumer gets talk-or-type by default just by using
 * this component instead of a bare <textarea>.
 *
 * The mic-control overlay swallows mousedown (preventDefault) so clicking the
 * mic never steals focus from the textarea — commit-on-blur consumers stay
 * safe. SDC palette only.
 */

import { useLayoutEffect, useRef } from 'react';
import { useDictation, MicButton } from './DescribeSurface.jsx';

const C = {
  border: 'var(--color-border)',
  danger: 'var(--color-danger)',
  light: 'var(--color-text-light)',
};

// Layout-affecting style keys migrate from the textarea onto the wrapper so
// the mic overlay (positioned against the wrapper) always sits INSIDE the
// visible box. Bug fixed here (Dan, Aug 23): a fixed-width textarea inside the
// full-width wrapper left the mic floating half-outside the input.
const LAYOUT_KEYS = [
  'width', 'minWidth', 'maxWidth', 'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'alignSelf', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
];

export function DictatedTextarea({
  value,
  onChange,               // (nextString) => void
  micTestId = 'dictate-btn',
  containerStyle = {},
  style = {},
  autoGrow = true,        // prose inputs must SHOW everything written (Dan, Aug 24) — never a one-line scroll
  ...textareaProps        // rows, placeholder, data-testid, className, autoFocus, …
}) {
  const textareaRef = useRef(null);
  const { listening, interim, micError, speechSupported, toggleDictation, flushInterim } = useDictation({
    value: value ?? '',
    onChange,
    textareaRef,
  });

  // FLUSH-ON-SEND seam (Dan's eaten dictation, 2026-08-28): senders call
  // el.__flushDictation() before reading the value so an in-flight interim
  // transcript can never be lost between the mic and the Send click.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) el.__flushDictation = flushInterim;
  });

  // Auto-expand to fit the content (standing UI rule, meKnowledge 2026-08-24).
  useLayoutEffect(() => {
    if (!autoGrow) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, autoGrow]);

  const layoutStyle = {};
  const innerStyle = {};
  for (const [k, v] of Object.entries(style)) {
    if (LAYOUT_KEYS.includes(k)) layoutStyle[k] = v;
    else innerStyle[k] = v;
  }
  const sized = 'width' in layoutStyle || 'flex' in layoutStyle || 'flexGrow' in layoutStyle;

  return (
    <div style={{ position: 'relative', ...layoutStyle, ...containerStyle }}>
      <textarea
        ref={textareaRef}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        {...textareaProps}
        style={{
          ...innerStyle,
          ...(sized ? { width: '100%', boxSizing: 'border-box' } : {}),
          ...(autoGrow ? { overflowY: 'hidden', resize: 'none' } : {}),
          paddingRight: 54,
          minHeight: 34, // never shorter than the mic overlay (26px btn + inset)
        }}
      />
      {/* Mic controls — top-right INSIDE the input, matching the describe box.
          preventDefault on mousedown keeps focus (and blur-commit flows) intact. */}
      <div
        onMouseDown={e => e.preventDefault()}
        style={{ position: 'absolute', top: 4, right: 6, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {listening && (
          <span
            data-testid={`${micTestId}-pulse`}
            style={{
              width: 8, height: 8, borderRadius: '50%', background: C.danger,
              animation: 'sdc-mic-pulse 1.2s ease-in-out infinite', flexShrink: 0,
            }}
          />
        )}
        <MicButton
          listening={listening}
          supported={speechSupported}
          onToggle={toggleDictation}
          testId={micTestId}
        />
      </div>
      {listening && interim && (
        <div
          data-testid={`${micTestId}-interim`}
          style={{
            position: 'absolute', left: 1, right: 1, bottom: 1,
            padding: '2px 8px', pointerEvents: 'none',
            fontSize: 11, fontStyle: 'italic', color: C.light,
            background: 'rgba(255,255,255,0.88)',
            borderRadius: '0 0 6px 6px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {interim}
        </div>
      )}
      {micError && (
        <div style={{ fontSize: 10, color: C.danger, marginTop: 2 }}>{micError}</div>
      )}
      <style>{'@keyframes sdc-mic-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }'}</style>
    </div>
  );
}
