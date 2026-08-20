/**
 * appScale.js — app-wide UI scaling for the v2 shell.
 *
 * Same mechanism as the other SDC Tools apps:
 *   - sdc-sheets (src/lib/app-zoom.ts): CSS `zoom` on <html> driven by a
 *     `--app-scale` custom property — zoom participates in layout, so sticky
 *     headers, frozen panes and hit-testing all stay aligned (their DEVLOG
 *     verified this live; `transform: scale()` breaks all three).
 *   - SDC Estimate Builder (App.jsx useZoom): document.documentElement.style.zoom,
 *     persisted in localStorage, − / % / + stepper in the TopBar.
 *
 * This module is the sdc-sheets shape (custom property + snap/step helpers +
 * useSyncExternalStore-compatible read/subscribe) with the Estimate Builder's
 * placement (top-bar stepper). v2.css contains `html { zoom: var(--app-scale) }`
 * plus the /var(--app-scale) viewport correction on .v2-app; v2.css is only
 * loaded by the v2 entry, so the classic shell is untouched.
 *
 * The ONE thing CSS zoom does not compensate: viewport units. 100vh resolves
 * against the unzoomed viewport and is then scaled, so `height: 100vh` renders
 * scale×viewport. .v2-app therefore uses calc(100vh / var(--app-scale, 1)).
 */

/** Offered levels, smallest first. First/last ARE the limits. */
export const SCALE_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

export const DEFAULT_SCALE = 1;
export const SCALE_VAR = '--app-scale';
/** Versioned so a future change of units can't be misread as a scale factor. */
export const SCALE_KEY = 'sdc-statelogic-app-scale-v1';
const EVENT = 'sdc-app-scale-change';

/** Nearest offered level; anything unusable lands on the default. */
export function snapScale(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_SCALE;
  let best = SCALE_STEPS[0];
  for (const s of SCALE_STEPS) {
    if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  }
  return best;
}

/** One step out (-1) or in (+1), clamped. Index-based — the steps are uneven. */
export function stepScale(current, delta) {
  const from = SCALE_STEPS.indexOf(snapScale(current));
  const next = Math.min(SCALE_STEPS.length - 1, Math.max(0, from + delta));
  return SCALE_STEPS[next];
}

export function isMinScale(s) { return snapScale(s) === SCALE_STEPS[0]; }
export function isMaxScale(s) { return snapScale(s) === SCALE_STEPS[SCALE_STEPS.length - 1]; }

export function scaleLabel(s) { return `${Math.round(snapScale(s) * 100)}%`; }

export function readScale() {
  try {
    const raw = window.localStorage.getItem(SCALE_KEY);
    return raw == null ? DEFAULT_SCALE : snapScale(raw);
  } catch {
    return DEFAULT_SCALE; // storage blocked — not worth a blank page
  }
}

/**
 * The level ON SCREEN right now, read off the document rather than a React
 * closure — two fast clicks before a re-render must not both step from the
 * same stale value (the sdc-sheets stepper bug class).
 */
export function currentScale() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(SCALE_VAR).trim();
  return raw ? snapScale(raw) : readScale();
}

/** Put a scale on screen: one custom property on <html>; CSS does the rest. */
export function applyScale(s) {
  document.documentElement.style.setProperty(SCALE_VAR, String(snapScale(s)));
}

/** Apply, persist, notify the control(s). */
export function writeScale(s) {
  const next = snapScale(s);
  applyScale(next);
  try { window.localStorage.setItem(SCALE_KEY, String(next)); } catch { /* session-only */ }
  window.dispatchEvent(new Event(EVENT));
}

/** For useSyncExternalStore. `storage` covers the same app in another tab. */
export function subscribeScale(onChange) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Pre-paint restore — call before the React root renders (v2 main.jsx). */
export function initAppScale() {
  applyScale(readScale());
}
