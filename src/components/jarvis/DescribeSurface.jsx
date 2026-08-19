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

import { useRef, useState } from 'react';
import { downscaleImage } from '../../lib/imageUtils.js';

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
      <label className="form-label" style={{ fontSize: 14 }}>{label}</label>
      {hint}
      <textarea
        className="form-input form-textarea"
        autoFocus={autoFocus}
        rows={rows}
        style={{ lineHeight: 1.55, fontFamily: 'inherit', resize: 'vertical' }}
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        placeholder={placeholder
          ?? 'Just talk — JARVIS pulls the spec out of what you write.\n\ne.g. "This station feeds magnets to the pick. There\'s a vertical shuttle that raises the stack, a horizontal shuttle that slides one magnet over coin-changer style…"'}
      />

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
