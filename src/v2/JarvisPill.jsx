/**
 * JarvisPill — THE way into the SDC Engineer tool.
 *
 * v4 (Dan, Aug 24): RELOCATED to the TOP BAR's right side as a compact
 * SQUARE chip (app-wide square rule) — green dot + "SDC Engineer" + open-question
 * count. In-flow in the header, so it can never overlap content at any
 * width. The old floating / stations-panel-docked pill is gone. Same click
 * target: opens the merged SDC Engineer page (generations grid + questions +
 * knowledge + track record).
 *
 * v5 (Dan, 2026-08-31): STUCK = LOUD. A held build must announce itself the
 * moment the hold fires — it may never sit silent. The pill polls the
 * question queue (10 s); a NEW open hold question (source 'generation')
 * raises an unmissable banner line under the top bar: "I'm stuck — N
 * question(s) in the Questions tab." The banner stays until opened or
 * dismissed (seen-set in localStorage, survives reload).
 */

import { useEffect, useState } from 'react';
import { JarvisPage } from '../components/jarvis/JarvisPage.jsx';

const SEEN_KEY = 'jarvis.seenHoldQuestions';

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500))); } catch { /* private mode */ }
}

export function JarvisPill() {
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(null);
  const [stuck, setStuck] = useState(null); // { ids:[...], sample:string } | null

  async function refreshCount() {
    try {
      const r = await fetch('/api/jarvis/questions');
      if (!r.ok) return;
      const qs = await r.json();
      if (!Array.isArray(qs)) return;
      const openQs = qs.filter(q => q.status === 'open');
      setOpenCount(openQs.length);
      // STUCK = LOUD: a build hold files its questions instantly — any open
      // hold question Dan hasn't seen raises the banner.
      const holds = openQs.filter(q => q.source === 'generation');
      // First run on this machine: the backlog of old open hold questions is
      // NOT "stuck right now" — seed them as seen; only NEW holds alert.
      if (localStorage.getItem(SEEN_KEY) == null) {
        saveSeen(new Set(holds.map(q => q.id)));
        return;
      }
      const seen = loadSeen();
      const fresh = holds.filter(q => !seen.has(q.id));
      if (fresh.length) {
        setStuck({ ids: holds.map(q => q.id), sample: String(fresh[0].question || '').slice(0, 160) });
      } else if (!holds.length) {
        setStuck(null); // all hold questions answered/dismissed — stand down
      }
    } catch { /* server offline — no badge, chip still opens the page */ }
  }
  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 10000);
    return () => clearInterval(t);
  }, []);

  function markStuckSeen() {
    if (!stuck) return;
    const seen = loadSeen();
    for (const id of stuck.ids) seen.add(id);
    saveSeen(seen);
    setStuck(null);
  }

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
      {stuck && !open && (
        <div className="v2-stuck-banner" data-testid="stuck-banner" role="alert">
          <span className="v2-stuck-banner__pause" aria-hidden="true">⏸</span>
          <span className="v2-stuck-banner__text">
            <strong>I&#39;m stuck</strong> — a build is holding on {stuck.ids.length} question{stuck.ids.length === 1 ? '' : 's'} in the Questions tab.
            <span className="v2-stuck-banner__sample"> &ldquo;{stuck.sample}&rdquo;</span>
          </span>
          <button
            type="button" className="btn btn--xs btn--primary" data-testid="stuck-banner-open"
            onClick={() => { markStuckSeen(); setOpen(true); }}
          >Answer it</button>
          <button
            type="button" className="btn btn--xs btn--secondary" data-testid="stuck-banner-dismiss"
            onClick={markStuckSeen}
          >Later</button>
        </div>
      )}
      {open && <JarvisPage onClose={() => { setOpen(false); refreshCount(); }} />}
    </>
  );
}
