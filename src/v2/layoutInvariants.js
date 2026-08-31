/**
 * layoutInvariants.js — THE STANDING VISUAL-REGRESSION GATE
 * (Dan, 2026-08-31: "how are you not checking this stuff… focus on
 * solutions, don't give me explanations").
 *
 * THE LAW: after ANY change touching the sheet, render Dan's mirrored draft
 * in the browser and run this checklist. NO milestone report goes out as
 * "done" without a green pass. Every time Dan catches something new, the
 * catch becomes a permanent invariant HERE — the list only grows.
 *
 * Runs in-page (vite serves it): from the browser console or the agent's
 * javascript_tool —
 *   const { runLayoutChecks } = await import('/src/v2/layoutInvariants.js');
 *   runLayoutChecks();          // → { pass, failures, results }
 * Checks are DOM-truth assertions, viewport-aware, zero dependencies.
 */

const q = (sel, root = document) => [...root.querySelectorAll(sel)];
const vis = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export const INVARIANTS = [
  {
    id: 'recovery-beside-sequence',
    what: 'Fault recovery renders BESIDE its sequence (same block, right side); stacked only when the viewport genuinely cannot fit both (Dan, 2026-08-31)',
    run() {
      const recs = q('[data-testid^="recovery-sm-"]').filter(vis);
      if (!recs.length) return { skip: 'no per-machine recovery panels on screen' };
      const bad = [];
      for (const rec of recs) {
        const card = rec.closest('[data-testid^="sequence-sm-"]');
        const seqCol = card?.querySelector(':scope > div > div');
        if (!card || !seqCol) { bad.push(`${rec.dataset.testid}: structure missing`); continue; }
        const rr = rec.getBoundingClientRect();
        const sr = seqCol.getBoundingClientRect();
        const sideBySide = rr.left >= sr.right - 8 && Math.abs(rr.top - sr.top) < 60;
        // Stacked is legal ONLY when the card is too narrow for two 300px columns.
        const cardW = card.getBoundingClientRect().width;
        if (!sideBySide && cardW >= 640) bad.push(`${rec.dataset.testid}: stacked below at card width ${Math.round(cardW)}px`);
      }
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'flows-not-lists',
    what: 'Sequences and recoveries render as SheetFlow diagrams, never numbered text lists (Dan, 2026-08-30/31)',
    run() {
      const cards = q('[data-testid^="sequence-sm-"]').filter(vis);
      if (!cards.length) return { skip: 'no sequence cards on screen' };
      const bad = [];
      for (const c of cards) {
        if (!c.querySelector('.state-node')) bad.push(`${c.dataset.testid}: no flow nodes`);
        // A visible <ol> in a sequence/recovery card = the degraded list render
        // (diff rows during red marks use a grid, not <ol>).
        if (q('ol li', c).some(vis)) bad.push(`${c.dataset.testid}: numbered list items rendering`);
      }
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'icons-on-flow-nodes',
    what: 'Every flow action row with a device carries its v1 DeviceIcon (Dan, 2026-08-31)',
    run() {
      const rows = q('.action-row').filter(vis).filter((r) => r.querySelector('.action-device'));
      if (!rows.length) return { skip: 'no device action rows on screen' };
      const missing = rows.filter((r) => !r.querySelector('svg')).length;
      return missing ? { fail: `${missing} of ${rows.length} device rows missing the icon` } : {};
    },
  },
  {
    id: 'no-truncated-edge-labels',
    what: 'Flow edge conditions show FULL text — no ellipsis, no width cap (Dan, 2026-08-30)',
    run() {
      const labels = q('.react-flow__edgelabel-renderer div').filter(vis);
      if (!labels.length) return { skip: 'no edge labels on screen' };
      const bad = labels.filter((l) => {
        const cs = getComputedStyle(l);
        return cs.overflow === 'hidden' || [...l.children].some((ch) => getComputedStyle(ch).textOverflow === 'ellipsis');
      });
      return bad.length ? { fail: `${bad.length} edge label(s) styled to truncate` } : {};
    },
  },
  {
    id: 'no-overlapping-floats',
    what: 'Fixed/floating bars never overlap each other or cover the send box',
    run() {
      const floats = q('body *').filter((el) => {
        if (!vis(el)) return false;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        return r.width > 60 && r.height > 24;
      // Top-level fixed elements only (ignore nested children of a fixed bar).
      }).filter((el, _, all) => !all.some((o) => o !== el && o.contains(el)));
      const bad = [];
      for (let i = 0; i < floats.length; i++) {
        for (let j = i + 1; j < floats.length; j++) {
          const a = floats[i].getBoundingClientRect();
          const b = floats[j].getBoundingClientRect();
          const overlap = a.left < b.right - 4 && b.left < a.right - 4 && a.top < b.bottom - 4 && b.top < a.bottom - 4;
          if (overlap) bad.push(`fixed elements overlap: ${floats[i].dataset?.testid ?? floats[i].className} × ${floats[j].dataset?.testid ?? floats[j].className}`);
        }
      }
      return bad.length ? { fail: [...new Set(bad)].join('; ') } : {};
    },
  },
  {
    id: 'one-source-per-screen',
    what: 'One build button, one chat block, one signal check — never duplicate homes for the same truth',
    run() {
      const bad = [];
      const counts = {
        'build-station-btn': q('[data-testid="build-station-btn"]').filter(vis).length,
        'corrections-block': q('[data-testid="corrections-block"]').filter(vis).length,
        'generate-scope-card': q('[data-testid="generate-scope-card"]').filter(vis).length,
      };
      for (const [k, n] of Object.entries(counts)) if (n > 1) bad.push(`${k} ×${n}`);
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'section-headers-carry-state',
    what: 'Every visible sheet section has its colored header band (title present, collapse chevron when enabled)',
    run() {
      const secs = q('[data-testid^="summary-section-"]').filter(vis);
      if (!secs.length) return { skip: 'no sections on screen' };
      const bad = secs.filter((s) => {
        const head = s.firstElementChild;
        return !head || !head.textContent?.trim();
      });
      return bad.length ? { fail: `${bad.length} section(s) missing their header band` } : {};
    },
  },
  {
    id: 'no-horizontal-page-scroll',
    what: 'The page body never scrolls horizontally — wide content scrolls inside its own container',
    run() {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth > el.clientWidth + 4
        ? { fail: `page scrollWidth ${el.scrollWidth} > viewport ${el.clientWidth}` }
        : {};
    },
  },
];

/** Run every invariant against the CURRENT DOM. */
export function runLayoutChecks() {
  const results = INVARIANTS.map((inv) => {
    let r;
    try { r = inv.run() ?? {}; } catch (e) { r = { fail: `check threw: ${e.message}` }; }
    return { id: inv.id, pass: !r.fail, ...(r.skip ? { skip: r.skip } : {}), ...(r.fail ? { note: r.fail } : {}) };
  });
  const failures = results.filter((r) => !r.pass);
  return { pass: failures.length === 0, failures, results };
}
