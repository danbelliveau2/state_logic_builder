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
      const vw = window.innerWidth; const vh = window.innerHeight;
      const floats = q('body *').filter((el) => {
        if (!vis(el)) return false;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        // Viewport-sized fixed containers are SURFACES (the sheet overlay,
        // the chat panel) — floats dock on top of them by design.
        if (r.width >= vw * 0.8 && r.height >= vh * 0.8) return false;
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
      // EXPLICIT PAIR (Dan, 2026-08-31: pill stacked on the badge): the chat
      // pill and the version badge must never collide — the pill owns
      // bottom-right, the badge owns bottom-left.
      const pill = q('[data-testid="chat-pill"]').filter(vis)[0];
      const badge = q('body *').filter(vis).find((el) => /^v\d+\.\d+\.\d+ ·/.test(el.textContent?.trim() ?? '') && getComputedStyle(el.parentElement ?? el).position === 'fixed');
      if (pill && badge) {
        const a = pill.getBoundingClientRect(); const b = badge.getBoundingClientRect();
        const hit = a.left < b.right + 8 && b.left < a.right + 8 && a.top < b.bottom + 8 && b.top < a.bottom + 8;
        if (hit) bad.push('chat pill collides with the version badge');
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
    id: 'chat-panel-reachable',
    what: 'The chat is reachable everywhere — the docked pill (or the open panel) is present on the sheet and the homepage (Dan, 2026-08-31)',
    run() {
      const sheet = q('[data-testid="create-station-page"]').some(vis);
      const home = q('[data-testid="project-home"]').some(vis);
      if (!sheet && !home) return { skip: 'neither sheet nor homepage on screen' };
      const pill = q('[data-testid="chat-pill"]').some(vis);
      const panel = q('[data-testid="chat-panel"]').some(vis);
      return (pill || panel) ? {} : { fail: `${sheet ? 'sheet' : 'homepage'} has neither the chat pill nor the open panel` };
    },
  },
  {
    id: 'no-in-page-chat-section',
    what: 'ONE door: the chat lives only in the slide-out panel — never as an in-page section (Dan, 2026-08-31)',
    run() {
      const blocks = q('[data-testid="corrections-block"]').filter(vis);
      if (!blocks.length) return {};
      const stray = blocks.filter((b) => !b.closest('[data-testid="chat-panel"]'));
      return stray.length ? { fail: `${stray.length} chat block(s) rendering in the page flow` } : {};
    },
  },
  {
    id: 'station-header-minimal',
    what: 'The sheet header is station number + name, period — no badge, no sheet-updated pill (Dan, 2026-08-31)',
    run() {
      const title = q('[data-testid="station-header-title"]')[0];
      if (!title || !vis(title)) return { skip: 'sheet header not on screen' };
      const bad = [];
      const body = document.body.innerText ?? '';
      if (/Station data sheet — review/i.test(body)) bad.push('"review & fill" badge rendering');
      if (q('[data-testid="sheet-ahead-chip"]').some(vis)) bad.push('sheet-updated pill rendering');
      if (!/^S\d{2} — .+/.test(title.textContent?.trim() ?? '') && title.textContent?.trim() !== 'Station Sheet') {
        bad.push(`header reads "${title.textContent?.trim()}"`);
      }
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'no-summarize-era-copy',
    what: 'No summarize-era surface copy reachable from the v2 shell ("clean summary", "resubmit to update the summary", "start blank instead") on walked/new-station views (Dan, 2026-08-31)',
    run() {
      const body = document.body.innerText ?? '';
      const bad = ['comes back as a clean summary', 'resubmit to update the summary', 'start blank instead']
        .filter((s) => body.includes(s));
      return bad.length ? { fail: `stale copy on screen: ${bad.join(' | ')}` } : {};
    },
  },
  {
    id: 'build-state-matches-records',
    what: 'The Build card\'s state agrees with the build records — never "held" on a done build, never a missing DONE row, button truth by artifacts (Dan, 2026-08-31)',
    async run() {
      const lane = q('[data-testid="build-lane"]')[0];
      if (!lane || !vis(lane)) return { skip: 'build lane not on screen' };
      let builds = [];
      try {
        const d = await fetch('/api/jarvis/generations').then((r) => (r.ok ? r.json() : null));
        builds = d?.builds ?? [];
      } catch { return { skip: 'generations API unreachable' }; }
      // Which station is this card for? Read the sheet title.
      const title = q('[data-testid="create-station-page"] span').map((s) => s.textContent).find((t) => /^Station Sheet — /.test(t ?? ''))?.replace('Station Sheet — ', '').trim();
      const mine = builds.filter((b) => b?.sm && title && b.sm.replace(/\s+/g, '') === title.replace(/\s+/g, ''));
      if (!mine.length) return { skip: 'no build records for this station' };
      const bad = [];
      const hasArtifact = mine.some((b) => b.savedPath || b.filePath || b.ok === true);
      const waitingHold = mine.some((b) => b.help?.status === 'waiting');
      const banner = q('[data-testid="build-held-banner"]').some(vis);
      if (banner && !waitingHold) bad.push('held banner shown but no waiting hold in the records');
      if (hasArtifact && !q('[data-testid^="build-attempt-"]').some((r) => /DONE — L5X ready/.test(r.textContent ?? ''))) bad.push('artifact exists but no DONE row renders');
      const btn = q('[data-testid="build-station-btn"]')[0]?.textContent ?? '';
      if (hasArtifact && !/^Rebuild/.test(btn)) bad.push(`artifact exists but button reads "${btn}"`);
      if (!hasArtifact && /^Rebuild/.test(btn)) bad.push('no artifact but button reads Rebuild');
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'uniform-section-bars',
    what: 'Every sheet region is one consistent section bar — same header anatomy (dark band, chevron, uppercase title), no odd-one-out (Dan, 2026-08-31)',
    run() {
      const barSel = ['[data-testid="inputs-band-header"]', '[data-testid="controls-notes-section"]', 
        '[data-testid^="summary-section-"]', '[data-testid="changelog-section"]', '[data-testid="generate-scope-card"]'];
      const bars = barSel.flatMap((s) => q(s)).filter(vis);
      if (bars.length < 3) return { skip: 'not enough section bars on screen' };
      const bad = [];
      const heights = [];
      for (const b of bars) {
        const head = b.firstElementChild;
        if (!head) { bad.push(`${b.dataset.testid}: no header band`); continue; }
        const cs = getComputedStyle(head);
        if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') bad.push(`${b.dataset.testid}: header band not tinted`);
        const title = [...head.querySelectorAll('span')].find((sp) => getComputedStyle(sp).textTransform === 'uppercase');
        if (!title) bad.push(`${b.dataset.testid}: no uppercase title`);
        heights.push(head.getBoundingClientRect().height);
      }
      const min = Math.min(...heights); const max = Math.max(...heights);
      if (max - min > 14) bad.push(`header heights vary ${Math.round(min)}–${Math.round(max)}px`);
      return bad.length ? { fail: [...new Set(bad)].join('; ') } : {};
    },
  },
  {
    id: 'bars-full-width',
    what: 'Every section bar spans the same full content width — no narrow odd-one-out (Dan, 2026-08-31)',
    run() {
      const sel = ['[data-testid="inputs-band-header"]', '[data-testid="controls-notes-section"]', 
        '[data-testid^="summary-section-"]', '[data-testid="changelog-section"]', '[data-testid="generate-scope-card"]'];
      const bars = sel.flatMap((s) => q(s)).filter(vis);
      if (bars.length < 3) return { skip: 'not enough bars on screen' };
      const widths = bars.map((b) => b.getBoundingClientRect().width);
      const min = Math.min(...widths); const max = Math.max(...widths);
      return max - min > 24
        ? { fail: `bar widths vary ${Math.round(min)}–${Math.round(max)}px (${bars[widths.indexOf(min)].dataset.testid} narrowest)` }
        : {};
    },
  },
  {
    id: 'role-colored-bars',
    what: 'INPUTS band is SDC blue (MEs are blue), CONTROLS INFORMATION is SDC green (CEs are green); the rest stay dark/gray so the role colors read intentionally (Dan, 2026-08-31)',
    run() {
      const bg = (sel) => { const el = q(sel).filter(vis)[0]; return el ? getComputedStyle(el.firstElementChild).backgroundColor : null; };
      const bad = [];
      const inputs = bg('[data-testid="inputs-band-header"]');
      if (inputs && inputs !== 'rgb(21, 116, 196)') bad.push(`INPUTS band ${inputs} ≠ SDC blue`);
      const ctrl = bg('[data-testid="controls-notes-section"]');
      if (ctrl && ctrl !== 'rgb(90, 154, 72)') bad.push(`CONTROLS INFORMATION band ${ctrl} ≠ SDC green`);
      // No OTHER bar may use the two role colors.
      const others = [ '[data-testid^="summary-section-"]', '[data-testid="changelog-section"]', '[data-testid="generate-scope-card"]']
        .flatMap((s) => q(s)).filter(vis);
      for (const b of others) {
        const c = getComputedStyle(b.firstElementChild).backgroundColor;
        if (c === 'rgb(21, 116, 196)' || c === 'rgb(90, 154, 72)') bad.push(`${b.dataset.testid} wears a role color (${c})`);
      }
      if (!inputs && !ctrl) return { skip: 'role bars not on screen' };
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'single-call-to-action',
    what: 'ONE call to action: the Build card is THE place — no banner build button, no resubmit footer on walked drafts (Dan, 2026-08-31)',
    run() {
      const bad = [];
      if (q('[data-testid="review-build-code-btn"]').some(vis)) bad.push('banner build button rendering');
      const card = q('[data-testid="generate-scope-card"]').some(vis);
      const walked = q('[data-testid^="sequence-sm-"]').some(vis);
      if ((card || walked) && q('[data-testid="resubmit-bar"]').some(vis)) bad.push('resubmit footer on a walked draft');
      return bad.length ? { fail: bad.join('; ') } : {};
    },
  },
  {
    id: 'controls-notes-reachable',
    what: 'The Controls notes section (the optional CE lane) is on the sheet — its own fold, never hidden by the inputs fold (Dan, 2026-08-31)',
    run() {
      const walked = q('[data-testid^="sequence-sm-"]').some(vis) || q('[data-testid="generate-scope-card"]').some(vis);
      if (!walked) return { skip: 'not a walked sheet' };
      return q('[data-testid="controls-notes-section"]').some(vis) ? {} : { fail: 'Controls notes section not visible' };
    },
  },
  {
    id: 'chat-tab-row-breathing',
    what: 'The chat tab row has its own padded band ruled off from the thread (Dan, 2026-08-31: cramped/clipped pills)',
    run() {
      const tab = q('[data-testid="chat-tab-chat"]')[0];
      if (!tab || !vis(tab)) return { skip: 'chat tabs not on screen' };
      const band = tab.closest('div[style*="border-bottom"], div');
      const row = tab.parentElement?.parentElement;
      const cs = row ? getComputedStyle(row) : null;
      const padded = cs && (parseFloat(cs.paddingBottom) >= 6 || parseFloat(cs.marginBottom) >= 6);
      const clipped = tab.scrollHeight > tab.clientHeight + 1;
      const bad = [];
      if (!padded) bad.push('tab row lacks bottom spacing');
      if (clipped) bad.push('tab pill vertically clipped');
      void band;
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

/** Run every invariant against the CURRENT DOM (async — some checks read the
 *  server's build records to compare against what the card claims). */
export async function runLayoutChecks() {
  const results = [];
  for (const inv of INVARIANTS) {
    let r;
    try { r = (await inv.run()) ?? {}; } catch (e) { r = { fail: `check threw: ${e.message}` }; }
    results.push({ id: inv.id, pass: !r.fail, ...(r.skip ? { skip: r.skip } : {}), ...(r.fail ? { note: r.fail } : {}) });
  }
  const failures = results.filter((r) => !r.pass);
  return { pass: failures.length === 0, failures, results };
}
