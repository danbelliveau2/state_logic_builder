/**
 * buildMeta — tiny shared helpers for generated-build rows
 * (used by the Code Generation page and the SDC Engineer page grid).
 */

/** Version label from the build's filename — Dan: "v4 findable by name".
 *  "ServoPNP__jarvis_v1.2.0__2026-08-21_v4_SHIP.L5X" → "v4_SHIP". */
export function buildLabel(row) {
  const base = String(row?.filePath || '').split(/[\\/]/).pop() || '';
  const m = /_(v\d+[A-Za-z0-9_]*)\.L5X$/i.exec(base);
  return m ? m[1] : '—';
}
