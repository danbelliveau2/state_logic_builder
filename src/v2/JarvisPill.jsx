/**
 * JarvisPill — THE way into the SDC Engineer tool.
 *
 * v4 (Dan, Aug 24): RELOCATED to the TOP BAR's right side as a compact
 * SQUARE chip (app-wide square rule) — green dot + "SDC Engineer" + open-question
 * count. In-flow in the header, so it can never overlap content at any
 * width. The old floating / stations-panel-docked pill is gone. Same click
 * target: opens the merged SDC Engineer page (generations grid + questions +
 * knowledge + track record).
 */

import { useEffect, useState } from 'react';
import { JarvisPage } from '../components/jarvis/JarvisPage.jsx';

export function JarvisPill() {
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(null);

  async function refreshCount() {
    try {
      const r = await fetch('/api/jarvis/questions');
      if (!r.ok) return;
      const qs = await r.json();
      setOpenCount(Array.isArray(qs) ? qs.filter(q => q.status === 'open').length : null);
    } catch { /* server offline — no badge, chip still opens the page */ }
  }
  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <button
        type="button"
        className="v2-jarvis-chip"
        data-testid="jarvis-pill"
        onClick={() => setOpen(true)}
        title="SDC Engineer — generated code, his questions for the controls team, knowledge, and track record"
      >
        <span className="v2-jarvis-chip__dot" aria-hidden="true" />
        SDC Engineer
        {openCount != null && openCount > 0 && (
          <span className="v2-jarvis-chip__badge" data-testid="jarvis-pill-badge">{openCount}</span>
        )}
      </button>
      {open && <JarvisPage onClose={() => { setOpen(false); refreshCount(); }} />}
    </>
  );
}
