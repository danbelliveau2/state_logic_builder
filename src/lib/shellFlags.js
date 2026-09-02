/**
 * shellFlags.js — which shell is this bundle running in?
 *
 * The v3 entry (src/v2/main.jsx, served at /) stamps
 * `document.documentElement.dataset.shell = 'v3'` before first render.
 * Shared v1 components (DecisionNode, StateNode) read this to enable
 * v3-ONLY behavior without touching classic (/classic.html never sets it).
 * Pure DOM read — no React, no store.
 */
export function isV3Shell() {
  return typeof document !== 'undefined' && document.documentElement?.dataset?.shell === 'v3';
}
