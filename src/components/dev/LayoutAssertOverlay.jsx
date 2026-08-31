/**
 * LayoutAssertOverlay — the layout law, asserted on the LIVE canvas.
 *
 * Toggled from the canvas bottom bar ("QA" button). Every check runs against
 * what is ACTUALLY RENDERED — the SVG path `d` of every edge and the DOM
 * bounding boxes of every node child — not against stored positions. If it
 * passes here, it passes on the user's screen, because it IS the user's
 * screen. Built after a remote harness pronounced a layout clean that the
 * user's live session rendered broken (stale React Flow measurements after
 * HMR; width-dependent node types) — assertions now live where the pixels are.
 *
 * LAWS ASSERTED (red dot = violation, badge lists counts):
 *   E1  no diagonal segments — every segment axis-aligned
 *   E2  bottom exits leave VERTICALLY, >= MIN_STUB px, side exits leave
 *       HORIZONTALLY, >= MIN_STUB px (perpendicular-stub law)
 *   E3  entry into the target is VERTICAL, >= MIN_STUB px (unless the edge is
 *       a tagged merge-trim, which deliberately ends at the column)
 *   E4  the entry lands at the target's RENDERED top-center (±3px) — catches
 *       corner entries from stale width measurements
 *   E5  the exit leaves the source's RENDERED handle point (±3px)
 *   E6  no bend within MIN_STUB px of ANY node face
 *   N1  every painted node child sits inside the node's shape bounds
 *       (rounded/pill radius and SVG polygon respected)
 */

import { useEffect, useState, useCallback } from 'react';
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react';
import { MIN_STUB } from '../../lib/edgeRouting.js';

const EPS = 0.75;         // axis-alignment tolerance (px, flow coords)
const ANCHOR_TOL = 3;     // handle/center anchoring tolerance (px)

function distToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRounded(px, py, b, r) {
  const rr = Math.min(r, b.w / 2, b.h / 2);
  if (px < b.l - 0.5 || px > b.l + b.w + 0.5 || py < b.t - 0.5 || py > b.t + b.h + 0.5) return false;
  const cx = px < b.l + rr ? b.l + rr : px > b.l + b.w - rr ? b.l + b.w - rr : px;
  const cy = py < b.t + rr ? b.t + rr : py > b.t + b.h - rr ? b.t + b.h - rr : py;
  if (cx === px && cy === py) return true;
  return Math.hypot(px - cx, py - cy) <= rr + 0.75;
}

// Deliberately-outside elements (badges, handles, popups, drag affordances).
const SKIP_SEL = '.state-node__step-num, .decision-node__step-num, .state-node__drag-handle,'
  + ' .state-node__add-btn, .react-flow__handle, .pt-badge, .state-node__shape-bg,'
  + ' .node-popup, .decision-popup, .node-drag-handle';

/** Collect violations from the LIVE DOM. Returns { marks, rects, rows }. */
function collectViolations(rf) {
  const marks = [];   // { x, y, why }  (flow coords)
  const rects = [];   // { x, y, w, h, why } (flow coords) — node-containment
  const rows = [];    // per-edge / per-node assertion rows (for console table)

  // RF's own math — accounts for the container offset, the RF transform, AND
  // (post-fix) the canvas sitting at 1:1. Never hand-roll this conversion:
  // a hand-rolled version silently broke under the app-scale CSS zoom.
  const toFlow = (sx, sy) => rf.screenToFlowPosition({ x: sx, y: sy }, { snapToGrid: false });
  const appScale = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-scale')) || 1;

  const nodes = rf.getNodes();
  const nodeRects = nodes.map(n => {
    // The RENDERED geometry wins over React Flow's belief — position from the
    // DOM transform, size from offsetWidth/Height. This is the whole point:
    // when RF's measurements go stale (HMR mid-session, fonts, resize misses),
    // edges anchor to RF's belief while the node paints elsewhere — the user
    // sees corner entries. Asserting against RF state would pass; asserting
    // against pixels fails, correctly.
    const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
    let x = n.position.x, y = n.position.y;
    const m = el && (el.style.transform || '').match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/);
    if (m) { x = +m[1]; y = +m[2]; }
    const w = el?.offsetWidth || n.measured?.width || 240;
    const h = el?.offsetHeight || n.measured?.height || 80;
    return { id: n.id, x, y, w, h, el };
  });
  const rectById = new Map(nodeRects.map(r => [r.id, r]));
  const edgesById = new Map(rf.getEdges().map(e => [e.id, e]));

  // ── Edge assertions (E1–E6) ────────────────────────────────────────────
  for (const edgeEl of document.querySelectorAll('.react-flow__edge')) {
    const id = edgeEl.getAttribute('data-id');
    const meta = edgesById.get(id) || {};
    const p = edgeEl.querySelector('path');
    if (!p) continue;
    const pts = [...(p.getAttribute('d') || '').matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)]
      .map(m => ({ x: +m[1], y: +m[2] }));
    if (pts.length < 2) continue;

    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      const axis = dx <= EPS ? 'V' : dy <= EPS ? 'H' : 'DIAG';
      segs.push({ a, b, axis, len: axis === 'V' ? dy : axis === 'H' ? dx : Math.hypot(dx, dy) });
    }
    const handle = meta.sourceHandle ?? null;
    const isSide = handle === 'exit-fail' || handle === 'exit-retry';
    const isTrim = meta.data?._trimLastSegment === true;
    const src = rectById.get(meta.source);
    const tgt = rectById.get(meta.target);
    const fails = [];

    // E1 diagonals
    for (const s of segs) {
      if (s.axis === 'DIAG' && s.len > 2) {
        fails.push('diagonal');
        marks.push({ x: s.a.x, y: s.a.y, why: `${id}: diagonal segment` });
      }
    }
    // E2 perpendicular exit stub
    const f = segs[0];
    if (f) {
      const wantAxis = isSide ? 'H' : 'V';
      if (f.axis !== wantAxis) {
        fails.push('exit-not-perpendicular');
        marks.push({ x: f.a.x, y: f.a.y, why: `${id}: ${isSide ? 'side' : 'bottom'} exit has no ${isSide ? 'horizontal' : 'vertical'} run` });
      } else if (f.len < MIN_STUB) {
        fails.push(`exit-stub ${Math.round(f.len)}<${MIN_STUB}`);
        marks.push({ x: f.b.x, y: f.b.y, why: `${id}: exit stub ${Math.round(f.len)}px` });
      }
    }
    // E3 vertical entry stub
    const l = segs[segs.length - 1];
    if (l && !isTrim) {
      if (l.axis !== 'V') {
        fails.push('entry-not-vertical');
        marks.push({ x: l.b.x, y: l.b.y, why: `${id}: entry not vertical` });
      } else if (l.len < MIN_STUB) {
        fails.push(`entry-stub ${Math.round(l.len)}<${MIN_STUB}`);
        marks.push({ x: l.b.x, y: l.b.y, why: `${id}: entry stub ${Math.round(l.len)}px` });
      }
    }
    // E4 entry at RENDERED top-center of target
    if (tgt && !isTrim) {
      const cx = tgt.x + tgt.w / 2;
      const end = pts[pts.length - 1];
      if (Math.abs(end.x - cx) > ANCHOR_TOL || Math.abs(end.y - tgt.y) > ANCHOR_TOL + 2) {
        fails.push(`entry-off-center dx=${Math.round(end.x - cx)}`);
        marks.push({ x: end.x, y: end.y, why: `${id}: enters ${Math.round(end.x - cx)}px off ${meta.target} top-center` });
      }
    }
    // E5 exit at RENDERED handle point of source
    if (src) {
      const start = pts[0];
      const hx = handle === 'exit-fail' ? src.x + src.w
               : handle === 'exit-retry' ? src.x
               : src.x + src.w / 2;
      const hy = isSide ? src.y + src.h / 2 : src.y + src.h;
      if (Math.abs(start.x - hx) > ANCHOR_TOL || Math.abs(start.y - hy) > ANCHOR_TOL) {
        fails.push(`exit-off-handle dx=${Math.round(start.x - hx)},dy=${Math.round(start.y - hy)}`);
        marks.push({ x: start.x, y: start.y, why: `${id}: leaves ${Math.round(start.x - hx)},${Math.round(start.y - hy)}px off ${meta.source} handle` });
      }
    }
    // E6 bend clearance
    for (const b of pts.slice(1, -1)) {
      for (const r of nodeRects) {
        const d = distToRect(b, r);
        if (d < MIN_STUB - 0.5) {
          fails.push(`bend ${Math.round(d)}px from ${r.id}`);
          marks.push({ x: b.x, y: b.y, why: `${id}: bend ${Math.round(d)}px from ${r.id}` });
          break;
        }
      }
    }
    rows.push({ kind: 'edge', id, src: meta.source, tgt: meta.target, handle: handle || 'bottom', pass: fails.length === 0, fails: fails.join('; ') });
  }

  // ── Node containment (N1) ──────────────────────────────────────────────
  for (const nr of nodeRects) {
    if (!nr.el) continue;
    const shapeEl = nr.el.querySelector('.state-node') || nr.el.firstElementChild;
    if (!shapeEl) continue;
    const sb = shapeEl.getBoundingClientRect();
    if (sb.width < 4) continue;
    const box = { l: sb.left, t: sb.top, w: sb.width, h: sb.height };
    const svgPoly = shapeEl.querySelector('.state-node__shape-bg polygon');
    let poly = null, radius = 0;
    if (svgPoly) {
      const vb = svgPoly.ownerSVGElement.viewBox.baseVal;
      const sx = sb.width / (vb.width || 1), sy = sb.height / (vb.height || 1);
      poly = svgPoly.getAttribute('points').trim().split(/\s+/).map(pt => {
        const c = pt.split(',').map(Number);
        return [sb.left + c[0] * sx, sb.top + c[1] * sy];
      });
    } else {
      // getBoundingClientRect is scaled by EVERYTHING (RF zoom, CSS zoom,
      // ancestor transforms); computed border-radius is unscaled CSS px.
      // Derive the node's actual pixel factor from its own rect/offsetWidth
      // ratio — robust to any stack of scales, present or future.
      const pxFactor = shapeEl.offsetWidth > 0 ? sb.width / shapeEl.offsetWidth : 1;
      radius = (parseFloat(getComputedStyle(shapeEl).borderTopLeftRadius) || 0) * pxFactor;
    }
    const contains = (px, py) => poly ? pointInPoly(px, py, poly) : inRounded(px, py, box, radius);

    const offenders = [];
    for (const el of shapeEl.querySelectorAll('*')) {
      if (el.closest(SKIP_SEL)) continue;
      if (el.ownerSVGElement || el.tagName === 'svg') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position === 'fixed' || cs.position === 'absolute') continue;
      let anc = el.parentElement, overlaid = false;
      while (anc && anc !== shapeEl) {
        const ap = getComputedStyle(anc).position;
        if (ap === 'absolute' || ap === 'fixed') { overlaid = true; break; }
        anc = anc.parentElement;
      }
      if (overlaid) continue;
      const paints = cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
        || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0
        || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!paints) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const P = 1.0;
      const corners = [[r.left + P, r.top + P], [r.right - P, r.top + P],
                       [r.left + P, r.bottom - P], [r.right - P, r.bottom - P]];
      if (corners.some(c => !contains(c[0], c[1]))) {
        offenders.push((el.textContent || '').trim().slice(0, 24));
        const a = toFlow(r.left, r.top), b = toFlow(r.right, r.bottom);
        rects.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y,
                     why: `${nr.id}: "${(el.textContent || '').trim().slice(0, 24)}" outside shape` });
      }
    }
    rows.push({ kind: 'node', id: nr.id, w: nr.w, h: nr.h, pass: offenders.length === 0, fails: offenders.join(' | ') });
  }

  // TRUTHFULNESS GUARD: asserting zero edges while the graph HAS edges is not
  // a pass — it means React Flow hasn't rendered them (unmeasured handles,
  // mid-mount). Count it as a violation so the badge can never show green on
  // an empty assertion.
  const expectedEdges = rf.getEdges().filter(e => !e.hidden).length;
  const assertedEdges = rows.filter(r => r.kind === 'edge').length;
  if (assertedEdges < expectedEdges) {
    rows.push({ kind: 'edge', id: '(unrendered)', pass: false,
      fails: `only ${assertedEdges}/${expectedEdges} edges rendered — nothing to assert on the rest` });
    marks.push({ x: 0, y: 0, why: `${expectedEdges - assertedEdges} edges not rendered` });
  }

  return { marks, rects, rows, appScale };
}

/** Plain-text report — pasteable into a chat/issue verbatim. */
function buildReport(r) {
  const lines = [];
  lines.push(`LayoutAssert report — ${new Date().toISOString()}`);
  lines.push(`app-scale: ${Math.round((r.appScale ?? 1) * 100)}% | url: ${location.pathname}`);
  const eRows = r.rows.filter(x => x.kind === 'edge');
  const nRows = r.rows.filter(x => x.kind === 'node');
  lines.push(`edges: ${eRows.filter(x => x.pass).length}/${eRows.length} pass | nodes: ${nRows.filter(x => x.pass).length}/${nRows.length} pass`);
  for (const x of r.rows) {
    if (!x.pass) lines.push(`FAIL ${x.kind} ${x.id}${x.src ? ` (${x.src}->${x.tgt}, ${x.handle})` : ''}: ${x.fails}`);
  }
  if (r.rows.every(x => x.pass)) lines.push('ALL ASSERTIONS PASS');
  return lines.join('\n');
}

export function LayoutAssertOverlay() {
  const rf = useReactFlow();
  const [result, setResult] = useState({ marks: [], rects: [], rows: [] });
  // Re-run whenever the graph or viewport meaningfully changes.
  const nodesTick = useStore(s => s.nodes);
  const edgesTick = useStore(s => s.edges);

  const run = useCallback(() => {
    try {
      const r = collectViolations(rf);
      setResult(r);
      const fails = r.rows.filter(x => !x.pass);
      // The table IS the report — visible in devtools on the user's machine,
      // and persisted on window so a later session/agent can retrieve it.
      // eslint-disable-next-line no-console
      console.table(r.rows.map(x => ({ kind: x.kind, id: x.id, pass: x.pass, fails: x.fails })));
      if (fails.length) console.warn('[LayoutAssert] VIOLATIONS:', fails);
      window.__layoutAssertReport = buildReport(r);
    } catch (err) {
      console.warn('[LayoutAssert] failed:', err);
    }
  }, [rf]);

  const copyReport = useCallback(() => {
    const text = buildReport(result);
    navigator.clipboard?.writeText(text).then(
      () => console.info('[LayoutAssert] report copied to clipboard'),
      () => console.warn('[LayoutAssert] clipboard blocked — report is on window.__layoutAssertReport')
    );
  }, [result]);

  useEffect(() => {
    const t = setTimeout(run, 400); // let RF paint first
    return () => clearTimeout(t);
  }, [run, nodesTick, edgesTick]);

  // Re-assert when the geometry context changes without a graph change:
  // app-scale stepper (dispatches 'sdc-app-scale-change'), window resize.
  useEffect(() => {
    let t;
    const kick = () => { clearTimeout(t); t = setTimeout(run, 500); };
    window.addEventListener('sdc-app-scale-change', kick);
    window.addEventListener('resize', kick);
    return () => {
      clearTimeout(t);
      window.removeEventListener('sdc-app-scale-change', kick);
      window.removeEventListener('resize', kick);
    };
  }, [run]);

  const failCount = result.marks.length + result.rects.length;

  return (
    <>
      <ViewportPortal>
        <svg style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 3000 }}>
          {result.rects.map((r, i) => (
            <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h}
              fill="rgba(220,38,38,0.15)" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3">
              <title>{r.why}</title>
            </rect>
          ))}
          {result.marks.map((m, i) => (
            <g key={`m${i}`}>
              <circle cx={m.x} cy={m.y} r={7} fill="rgba(220,38,38,0.25)" stroke="#dc2626" strokeWidth={2} />
              <circle cx={m.x} cy={m.y} r={2} fill="#dc2626" />
              <title>{m.why}</title>
            </g>
          ))}
        </svg>
      </ViewportPortal>
      {/* Screen-fixed status badge + copy-report */}
      <div style={{
        position: 'absolute', top: 10, right: 12, zIndex: 3001,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{
          pointerEvents: 'none',
          background: failCount ? '#dc2626' : '#16a34a', color: '#fff',
          borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700,
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        }}>
          {failCount ? `LAYOUT: ${failCount} violation${failCount > 1 ? 's' : ''} (red marks)` : 'LAYOUT: all assertions pass'}
          {result.appScale && Math.abs(result.appScale - 1) > 0.001 ? ` @ ${Math.round(result.appScale * 100)}% UI` : ''}
        </div>
        <button
          onClick={copyReport}
          title="Copy the full assertion report (per-edge / per-node rows) to the clipboard — paste it wherever the findings need to go."
          style={{
            background: '#334155', color: '#fff', border: 'none', borderRadius: 6,
            padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          }}
        >Copy report</button>
      </div>
    </>
  );
}
