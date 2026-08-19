/**
 * DescribeSurface — the shared "Explain this station" surface.
 *
 * One big free-form textarea + image drag-drop (CAD screenshots), used by
 * both SpecEditorModal (re-describe an existing station) and
 * CreateStationModal (describe-first station creation). Extracted so the
 * two flows can't drift apart.
 *
 * Controlled: the parent owns `description` and `images` state. Images are
 * downscaled client-side (imageUtils.downscaleImage) before being stored as
 * { name, base64, mediaType, previewUrl }.
 *
 * SDC palette only — standard form classes + CSS tokens.
 */

import { useEffect, useRef, useState } from 'react';
import { downscaleImage } from '../../lib/imageUtils.js';

/**
 * Voice dictation (Web Speech API).
 *
 * Interim-text choice: interim (not-yet-final) speech is kept in LOCAL state
 * and rendered as a non-editable light-gray ghost strip overlaid at the
 * bottom of the textarea. It is never written into the controlled value, so
 * it can never corrupt the user's typed text and the coverage checklist only
 * ever sees committed (final) results. Final results are inserted at the
 * textarea caret (or appended at the end when unfocused) through the normal
 * onDescriptionChange path — so the checklist reacts live while dictating.
 */
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
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // ── Voice dictation state ─────────────────────────────────────────────
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState(null);
  const recognitionRef = useRef(null);   // live SpeechRecognition instance
  const wantListeningRef = useRef(false); // user toggle intent (survives auto-end)
  // Fresh values for use inside recognition callbacks (avoid stale closures)
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const onChangeRef = useRef(onDescriptionChange);
  onChangeRef.current = onDescriptionChange;

  // Supported? (checked per render so a late polyfill/test hook still works)
  const speechSupported = typeof window !== 'undefined' && !!getSpeechRecognition();

  /** Insert a final transcript chunk at the caret (or end) via the normal setter. */
  function insertFinalTranscript(text) {
    const chunk = text.trim();
    if (!chunk) return;
    const current = descriptionRef.current ?? '';
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
    } else {
      setMicError(null);
      wantListeningRef.current = true;
      startRecognition();
    }
  }

  // Stop cleanly on unmount (modal close)
  useEffect(() => () => {
    wantListeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    recognitionRef.current = null;
  }, []);

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    try {
      const processed = await Promise.all(files.slice(0, MAX_DESCRIBE_IMAGES).map(downscaleImage));
      onImagesChange([...images, ...processed].slice(0, MAX_DESCRIBE_IMAGES));
    } catch (e) { alert(e.message); }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label className="form-label" style={{ fontSize: 14, flex: 1, marginBottom: 0 }}>{label}</label>
        {listening && (
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
        )}
        <button
          type="button"
          className="icon-btn"
          data-testid="dictate-btn"
          disabled={!speechSupported}
          onClick={toggleDictation}
          title={!speechSupported
            ? 'Voice input needs Chrome/Edge'
            : listening ? 'Stop dictation' : 'Dictate (voice to text)'}
          style={{
            border: `1px solid ${listening ? C.danger : C.border}`,
            color: listening ? C.danger : C.muted,
            background: listening ? '#fdf3f3' : 'transparent',
            opacity: speechSupported ? 1 : 0.4,
            cursor: speechSupported ? 'pointer' : 'not-allowed',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        </button>
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
            ?? 'Just talk — JARVIS pulls the spec out of what you write.\n\ne.g. "This station feeds magnets to the pick. There\'s a vertical shuttle that raises the stack, a horizontal shuttle that slides one magnet over coin-changer style…"'}
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

      <label className="form-label" style={{ marginTop: 12 }}>
        Pictures (optional — CAD screenshots, layout sketches)
      </label>
      <div
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
          <span>Drag &amp; drop images here, or click to browse (max {MAX_DESCRIBE_IMAGES}, auto-resized)</span>
        )}
        {images.map((img, i) => (
          <div key={i} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <img
              src={img.previewUrl} alt={img.name} title={img.name}
              style={{ width: 88, height: 66, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }}
            />
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
        ))}
        {images.length > 0 && images.length < MAX_DESCRIBE_IMAGES && (
          <span style={{ fontSize: 20, color: C.light, padding: '0 10px' }}>＋</span>
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
