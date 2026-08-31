/**
 * VersionBadge — always-visible build badge (bottom-right) + what's-new panel.
 *
 * Reads src/lib/whatsNew.js (UPDATE THAT FILE WITH EVERY CHANGE BATCH).
 * Mounted once at the root of BOTH shells (classic App.jsx and v2 AppV2.jsx).
 *
 * - Badge sits above every overlay (full-page takeovers, modals, portaled
 *   popups — highest app z-index is 100000, we use 2000000).
 * - Pointer events are isolated: the fixed wrapper is pointer-events:none,
 *   only the badge/panel themselves are clickable, so nothing behind is blocked.
 * - "Hard reset" does a full reload with a cache-bust query param, preserving
 *   the current shell (pathname), so users pick up the newest deployed code.
 */

import { useEffect, useRef, useState } from 'react';
import { UI_BUILD, BUILT_AT, SHIPPED, IN_PROGRESS } from '../lib/whatsNew.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso) {
  // '2026-08-19' → 'Aug 19' (string parse — avoids timezone off-by-one)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export function VersionBadge() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Escape + click-outside close the panel (badge itself always stays).
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  function hardReset() {
    // Full reload with cache-bust; pathname preserved so the current shell
    // (classic / or /v2.html) reloads itself on the newest code.
    window.location.href = window.location.pathname + '?r=' + Date.now();
  }

  const latest = SHIPPED[0];
  const older = SHIPPED.slice(1);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        // THE CORNER STACK (Dan, 2026-08-31, third and final ruling): the
        // badge is pinned at the very bottom-right corner; the chat pill
        // sits DIRECTLY ABOVE it; the open chat card above the pill.
        right: 12,
        bottom: 12,
        zIndex: 2000000,
        pointerEvents: 'none',           // wrapper never blocks the app
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        fontFamily: 'inherit',
      }}
    >
      {open && (
        <div
          style={{
            pointerEvents: 'auto',
            width: 340,
            maxHeight: '70vh',
            overflowY: 'auto',
            background: 'var(--color-surface, #ffffff)',
            border: '1px solid var(--color-border, #e2e8f0)',
            borderRadius: 'var(--radius-lg, 10px)',
            boxShadow: 'var(--shadow-lg, 0 10px 24px rgba(0,0,0,.12))',
            padding: '14px 16px',
            color: 'var(--color-text, #231f20)',
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {/* Header: current build + hard reset */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              You&rsquo;re on {UI_BUILD}
            </div>
            <button
              onClick={hardReset}
              title="Reloads the app to the newest code"
              style={{
                background: 'var(--color-primary, #1574C4)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius, 6px)',
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              &#10227; Hard reset
            </button>
          </div>
          <div style={{ color: 'var(--color-text-muted, #5a6a7e)', fontSize: 11, marginTop: 2 }}>
            Built {shortDate(BUILT_AT)}
          </div>

          {/* Latest changes */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.04em',
                color: 'var(--color-success, #5a9a48)',
              }}
            >
              Latest changes (you have these)
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {(latest?.items || []).map((line, i) => (
                <li key={i} style={{ marginBottom: 3 }}>{line}</li>
              ))}
            </ul>
            {older.map(rel => (
              <details key={rel.version} style={{ marginTop: 6 }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--color-text-muted, #5a6a7e)',
                    fontWeight: 600,
                  }}
                >
                  {rel.version} &middot; {shortDate(rel.date)}
                </summary>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {rel.items.map((line, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{line}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          {/* In progress */}
          {IN_PROGRESS.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border, #e2e8f0)', paddingTop: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  color: 'var(--color-warning, #c9a643)',
                }}
              >
                Being worked on now (not in your build yet)
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--color-text-muted, #5a6a7e)' }}>
                {IN_PROGRESS.map((line, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Badge — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? 'Close what’s new' : 'What’s new in this build'}
        style={{
          pointerEvents: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--color-surface, #ffffff)',
          color: 'var(--color-text-muted, #5a6a7e)',
          border: '1px solid var(--color-border, #e2e8f0)',
          // Square-pill rule (Dan, 2026-08-31: called the round one out).
          borderRadius: 4,
          padding: '4px 11px',
          fontSize: 11.5,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,.1))',
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-primary, #1574C4)',
            flex: 'none',
          }}
        />
        {UI_BUILD} &middot; {shortDate(BUILT_AT)}
      </button>
    </div>
  );
}
