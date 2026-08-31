/**
 * DescribeSurface — the shared "Explain this station" surface.
 *
 * One big free-form textarea + image drag-drop / clipboard paste (CAD
 * screenshots, Snipping Tool captures), used by SpecEditorModal
 * (re-describe an existing station) and CreateStationPage (describe-first
 * station creation). Extracted so the flows can't drift apart.
 *
 * Controlled: the parent owns `description` and `images` state. Images are
 * downscaled client-side (imageUtils.downscaleImage) before being stored as
 * { name, base64, mediaType, previewUrl }.
 *
 * Clipboard paste: a WINDOW-level 'paste' listener (mounted while this
 * surface is mounted) catches Ctrl+V anywhere on the page — including when
 * focus is inside the textarea. When the clipboard holds image items the
 * event is preventDefault-ed so no junk text lands in the textarea, and the
 * images go through the same downscale path as drag-drop.
 *
 * Voice dictation lives in the exported useDictation hook + MicButton so
 * other inputs (e.g. the summary "changes" box on CreateStationPage) reuse
 * the exact same implementation.
 *
 * SDC palette only — standard form classes + CSS tokens.
 */

import { useEffect, useRef, useState } from 'react';
import { downscaleImage } from '../../lib/imageUtils.js';

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export const MAX_DESCRIBE_IMAGES = 6;

const C = {
  primary: 'var(--color-primary)',
  primaryBg: '#e8f0fa',
  border: 'var(--color-border)',
  muted: 'var(--color-text-muted)',
  light: 'var(--color-text-light)',
  danger: 'var(--color-danger)',
};

/**
 * Voice dictation (Web Speech API) — reusable hook.
 *
 * Interim-text choice: interim (not-yet-final) speech is kept in LOCAL state
 * and rendered by the caller as a non-editable light-gray ghost strip. It is
 * never written into the controlled value, so it can never corrupt the
 * user's typed text and coverage checklists only ever see committed (final)
 * results. Final results are inserted at the textarea caret (or appended at
 * the end when unfocused) through the normal onChange path.
 *
 * @param {object} opts
 * @param {string} opts.value                  current controlled text value
 * @param {(next:string)=>void} opts.onChange  controlled setter
 * @param {React.RefObject} opts.textareaRef   ref to the target textarea
 * @param {()=>void} [opts.onEnd]              called when the USER toggles dictation off
 */
export function useDictation({ value, onChange, textareaRef, onEnd = null }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState(null);
  const recognitionRef = useRef(null);    // live SpeechRecognition instance
  const wantListeningRef = useRef(false); // user toggle intent (survives auto-end)
  // Fresh values for use inside recognition callbacks (avoid stale closures)
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Supported? (checked per render so a late polyfill/test hook still works)
  const speechSupported = typeof window !== 'undefined' && !!getSpeechRecognition();

  /** Insert a final transcript chunk at the caret (or end) via the normal setter. */
  function insertFinalTranscript(text) {
    const chunk = text.trim();
    if (!chunk) return;
    const current = valueRef.current ?? '';
    const ta = textareaRef.current;
    // Insert at caret if the textarea is focused, else append at the end.
    const at = (ta && document.activeElement === ta) ? ta.selectionStart : current.length;
    const before = current.slice(0, at);
    const after = current.slice(at);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const tail = after && !/^\s/.test(after) ? ' ' : '';
    const next = before + lead + chunk + tail + after;
    onChangeRef.current(next);
    // Restore caret just after the inserted text on next frame
    if (ta && document.activeElement === ta) {
      const pos = (before + lead + chunk).length;
      requestAnimationFrame(() => { try { ta.setSelectionRange(pos, pos); } catch { /* noop */ } });
    }
  }

  function startRecognition() {
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) insertFinalTranscript(res[0].transcript);
        else interimText += res[0].transcript;
      }
      setInterim(interimText);
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicError('Microphone blocked — allow mic access for this site to dictate.');
        wantListeningRef.current = false;
        setListening(false);
        setInterim('');
      }
      // 'no-speech' / 'aborted' etc.: onend handles restart while toggled on
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setInterim('');
      if (wantListeningRef.current) {
        // Chrome stops spontaneously after silence — restart while toggled on
        try { startRecognition(); } catch { setListening(false); wantListeningRef.current = false; }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      wantListeningRef.current = false;
    }
  }

  function toggleDictation() {
    if (wantListeningRef.current) {
      wantListeningRef.current = false;
      setListening(false);
      setInterim('');
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
      onEndRef.current?.();
    } else {
      setMicError(null);
      wantListeningRef.current = true;
      startRecognition();
    }
  }

  // FLUSH-ON-SEND (Dan's eaten dictation, 2026-08-28: he hit Send while the
  // tail of his speech was still INTERIM ghost text — Send saw an empty/short
  // value and the message died at a validation hint). flushInterim commits
  // the pending interim into the value RIGHT NOW, aborts the in-flight
  // utterance so it can't double-insert when it finalizes, and returns the
  // flushed text so the caller can dispatch with it synchronously.
  const interimRef = useRef('');
  interimRef.current = interim;
  function flushInterim() {
    const pending = String(interimRef.current ?? '').trim();
    if (!pending) return '';
    setInterim('');
    interimRef.current = '';
    // Abort (not stop): drop the utterance so its final result never fires;
    // onend restarts recognition while the mic toggle stays on.
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    insertFinalTranscript(pending);
    return pending;
  }

  // Stop cleanly on unmount (page/modal close)
  useEffect(() => () => {
    wantListeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    recognitionRef.current = null;
  }, []);

  return { listening, interim, micError, speechSupported, toggleDictation, flushInterim };
}

/** The mic toggle button — shared styling for every dictation-enabled input. */
export function MicButton({ listening, supported, onToggle, testId = 'dictate-btn' }) {
  return (
    <button
      type="button"
      className="icon-btn"
      data-testid={testId}
      disabled={!supported}
      onClick={onToggle}
      title={!supported
        ? 'Voice input needs Chrome/Edge'
        : listening ? 'Stop dictation' : 'Dictate (voice to text)'}
      style={{
        border: `1px solid ${listening ? C.danger : C.border}`,
        color: listening ? C.danger : C.muted,
        background: listening ? '#fdf3f3' : 'transparent',
        opacity: supported ? 1 : 0.4,
        cursor: supported ? 'pointer' : 'not-allowed',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
    </button>
  );
}

/** Pulsing "Listening…" indicator (shared with the changes input). */
export function ListeningIndicator() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, color: C.danger, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: C.danger,
        animation: 'sdc-mic-pulse 1.2s ease-in-out infinite',
      }} />
      Listening…
    </span>
  );
}

export function DescribeSurface({
  description,
  onDescriptionChange,
  images,
  onImagesChange,
  label = 'Explain this station like you would to a new engineer.',
  hint = null,            // optional node rendered under the label
  placeholder,
  rows = 12,
  autoFocus = true,
  error = null,
  errorTitle = 'Extraction failed:',
  onDictationEnd = null,  // called when the user toggles dictation OFF
  showTextarea = true,    // false = images-only mode ("Add pictures" step)
  syncStates = null,      // { [img._hash]: 'saving'|'saved'|'error' } — per-image server sync badge
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const { listening, interim, micError, speechSupported, toggleDictation } = useDictation({
    value: description,
    onChange: onDescriptionChange,
    textareaRef,
    onEnd: onDictationEnd,
  });

  // Fresh refs for the window-level paste listener (avoid stale closures)
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onImagesChangeRef = useRef(onImagesChange);
  onImagesChangeRef.current = onImagesChange;

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => f && f.type && f.type.startsWith('image/'));
    if (!files.length) return;
    try {
      const processed = await Promise.all(files.slice(0, MAX_DESCRIBE_IMAGES).map(downscaleImage));
      onImagesChangeRef.current([...imagesRef.current, ...processed].slice(0, MAX_DESCRIBE_IMAGES));
    } catch (e) { alert(e.message); }
  }

  // ── Clipboard paste (Snipping Tool etc.) — page-wide while mounted ──────
  useEffect(() => {
    function onPaste(e) {
      const items = [...(e.clipboardData?.items || [])]
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'));
      if (!items.length) return; // plain text paste — leave it alone
      // Image paste must never dump junk text into a focused textarea.
      e.preventDefault();
      const files = items.map(it => it.getAsFile()).filter(Boolean)
        .map((f, i) => (f.name ? f : new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type })));
      addFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // addFiles reads through refs — safe with an empty dep list
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {showTextarea && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ fontSize: 14, flex: 1, marginBottom: 0 }}>{label}</label>
            {listening && <ListeningIndicator />}
            <MicButton listening={listening} supported={speechSupported} onToggle={toggleDictation} />
            <style>{'@keyframes sdc-mic-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }'}</style>
          </div>
          {hint}
          {micError && (
            <div style={{ fontSize: 11, color: C.danger, margin: '4px 0 2px' }}>{micError}</div>
          )}
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textareaRef}
              className="form-input form-textarea"
              autoFocus={autoFocus}
              rows={rows}
              style={{ lineHeight: 1.55, fontFamily: 'inherit', resize: 'vertical' }}
              value={description}
              onChange={e => onDescriptionChange(e.target.value)}
              placeholder={placeholder
                ?? 'Just talk — SDC ENGINEER pulls the spec out of what you write.\n\ne.g. "This station feeds magnets to the pick. There\'s a vertical shuttle that raises the stack, a horizontal shuttle that slides one magnet over coin-changer style…"'}
            />
            {listening && interim && (
              <div
                data-testid="dictate-interim"
                style={{
                  position: 'absolute', left: 1, right: 1, bottom: 1,
                  padding: '4px 10px', pointerEvents: 'none',
                  fontSize: 12, fontStyle: 'italic', color: C.light,
                  background: 'rgba(255,255,255,0.88)',
                  borderRadius: '0 0 6px 6px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {interim}
              </div>
            )}
          </div>
        </>
      )}

      <label className="form-label" style={{ marginTop: showTextarea ? 12 : 0 }}>
        Pictures (optional — CAD screenshots, layout sketches, Snipping Tool captures)
      </label>
      <div
        data-testid="describe-image-drop"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? C.primary : '#cbd5e1'}`,
          background: dragOver ? C.primaryBg : 'var(--color-sidebar)',
          borderRadius: 8, padding: images.length ? 10 : 18,
          textAlign: 'center', cursor: 'pointer', fontSize: 12, color: C.muted,
          display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center',
        }}
      >
        {images.length === 0 && (
          <span>
            Drag &amp; drop, click to browse, or <strong>paste (Ctrl+V)</strong> a screenshot
            (max {MAX_DESCRIBE_IMAGES}, auto-resized)
          </span>
        )}
        {images.map((img, i) => {
          // Per-image sync state — silent loss is impossible when every
          // thumbnail says whether the server has it (Dan, Aug 24).
          const sync = syncStates && img._hash ? syncStates[img._hash] : null;
          const badge = sync === 'saved'
            ? { text: '✓ saved', bg: '#e9f5ec', fg: '#2f6b3c', bd: '#bfe0c8', title: 'Saved on the server with the station' }
            : sync === 'error'
              ? { text: '! retrying', bg: '#fdf6e3', fg: '#8a3b3b', bd: '#d4a0a0', title: 'Not saved yet — retrying automatically' }
              : sync === 'saving'
                ? { text: '⟳ saving', bg: '#fdf6e3', fg: '#6b5513', bd: '#e6d9a8', title: 'Saving to the server…' }
                : null;
          const isImg = String(img.mediaType || '').startsWith('image/');
          return (
          <div key={img._hash ?? i} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            {isImg ? (
            <img
              src={img.previewUrl} alt={img.name} title={img.name}
              style={{ width: 88, height: 66, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }}
            />
            ) : (
              // Non-image reference file (added on the sheet) — compact chip
              <span title={img.name} style={{
                display: 'inline-flex', alignItems: 'center', maxWidth: 160, height: 24,
                border: `1px solid ${C.border}`, borderRadius: 6, padding: '0 8px',
                fontSize: 11, color: C.muted, background: '#fff',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{img.name}</span>
            )}
            {badge && (
              <span
                data-testid={`img-sync-${sync}-${i}`}
                title={badge.title}
                style={{
                  position: 'absolute', left: 3, bottom: 3, fontSize: 8.5, fontWeight: 700,
                  lineHeight: 1, padding: '2px 5px', borderRadius: 3, whiteSpace: 'nowrap',
                  background: badge.bg, color: badge.fg, border: `1px solid ${badge.bd}`,
                }}
              >{badge.text}</span>
            )}
            <button
              onClick={() => onImagesChange(images.filter((_, j) => j !== i))}
              title="Remove"
              style={{
                position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                borderRadius: '50%', border: 'none', background: '#334155', color: '#fff',
                fontSize: 11, lineHeight: 1, cursor: 'pointer',
              }}
            >×</button>
          </div>
          );
        })}
        {images.length > 0 && images.length < MAX_DESCRIBE_IMAGES && (
          <span style={{ fontSize: 20, color: C.light, padding: '0 10px' }}>
            ＋ <span style={{ fontSize: 11 }}>drop / paste more</span>
          </span>
        )}
      </div>
      <input
        ref={fileInputRef} type="file" accept="image/*" multiple
        style={{ display: 'none' }}
        onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
      />

      {error && (
        <div style={{
          marginTop: 12, background: '#f5eeee', border: '1px solid #d4a0a0',
          borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.danger,
        }}>
          <strong>{errorTitle}</strong> {error}
        </div>
      )}
    </>
  );
}
