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

import { useRef } from 'react';
import { useDictation, MicButton } from './DescribeSurface.jsx';

const C = {
  border: 'var(--color-border)',
  danger: 'var(--color-danger)',
  light: 'var(--color-text-light)',
};

export function DictatedTextarea({
  value,
  onChange,               // (nextString) => void
  micTestId = 'dictate-btn',
  containerStyle = {},
  style = {},
  ...textareaProps        // rows, placeholder, data-testid, className, autoFocus, …
}) {
  const textareaRef = useRef(null);
  const { listening, interim, micError, speechSupported, toggleDictation } = useDictation({
    value: value ?? '',
    onChange,
    textareaRef,
  });

  return (
    <div style={{ position: 'relative', ...containerStyle }}>
      <textarea
        ref={textareaRef}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        {...textareaProps}
        style={{ ...style, paddingRight: 54 }}
      />
      {/* Mic controls — top-right INSIDE the input, matching the describe box.
          preventDefault on mousedown keeps focus (and blur-commit flows) intact. */}
      <div
        onMouseDown={e => e.preventDefault()}
        style={{ position: 'absolute', top: 5, right: 6, display: 'flex', alignItems: 'center', gap: 6 }}
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
