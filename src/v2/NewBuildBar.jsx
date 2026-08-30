/**
 * NewBuildBar — the ONE reload affordance (Dan, 2026-08-30: "if there's an
 * advantage of doing a hard reset… it shows up at the bottom, I click it, it
 * does it"). Ported from the SDC Scheduler's new-build watcher
 * (Project_Scheduler public/app.js) with our build realities:
 *
 *  - Version source: /api/version (no-store) serving the whatsNew UI_BUILD
 *    the server currently has on disk vs the one THIS page loaded. A deploy
 *    bumps whatsNew → every stale open tab gets the bar. HMR still handles
 *    incremental edits; this covers the full-reload cases (the stale-tab $5
 *    banner that bit him today).
 *  - Generalized: `window.__slbOfferReload(message)` shows the same bar for
 *    any cause the app detects (self-heal wanting a clean re-render, a stale
 *    tab hitting new server routes). One bar, plain words, one button. Never
 *    tell him to hard-reload in chat — trigger this instead.
 *  - NO auto-reload (explicitly ruled out in the Scheduler — respected).
 *    Shows once per page load, no repeated nagging.
 *  - Draft safety: reload flushes the pending autosave first
 *    (window.__slbFlushDraft, registered by the create page; drafts also
 *    mirror server-side on every save).
 */

import { useEffect, useState } from 'react';
import { UI_BUILD } from '../lib/whatsNew.js';

export function NewBuildBar() {
  const [msg, setMsg] = useState(null); // null = hidden; shows once

  useEffect(() => {
    let shown = false;
    const offer = (message) => {
      if (shown) return;
      shown = true;
      setMsg(String(message || 'A newer version is available.'));
    };
    // THE one hook other code uses to offer a reload (plain words per cause).
    window.__slbOfferReload = offer;

    const check = async () => {
      if (shown) return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        const d = await r.json().catch(() => null);
        if (d?.uiBuild && d.uiBuild !== UI_BUILD) offer('A newer version is available.');
      } catch { /* offline / transient — ignore */ }
    };
    window.addEventListener('focus', check);
    const t = setInterval(check, 60000);
    check();
    return () => {
      window.removeEventListener('focus', check);
      clearInterval(t);
      if (window.__slbOfferReload === offer) delete window.__slbOfferReload;
    };
  }, []);

  if (!msg) return null;
  return (
    <div
      id="new-build-bar"
      data-testid="new-build-bar"
      style={{
        // Pixel-for-pixel the Scheduler's bar (Dan, 2026-08-30):
        // Project_Scheduler public/app.js:29125-29133.
        position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)',
        zIndex: 99999, background: '#061d39', color: '#fff', padding: '10px 14px',
        borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.3)',
        fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <span>{msg}</span>
      <button
        type="button"
        data-testid="new-build-reload"
        onClick={() => {
          // Drafts are safe: flush the pending autosave (sync localStorage +
          // best-effort server mirror), give the mirror POST a beat, reload.
          try { window.__slbFlushDraft?.(); } catch { /* best effort */ }
          setTimeout(() => window.location.reload(), 250);
        }}
        style={{
          background: '#ffde51', color: '#061d39', border: 'none', borderRadius: 6,
          padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 14,
        }}
      >Reload now</button>
    </div>
  );
}
