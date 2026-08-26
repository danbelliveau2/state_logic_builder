/**
 * PathDiagram — the MOTION PATH panel (Dan, 2026-08-24: "show me a diagram of
 * what each point is, an easy way like I did. Why can't we generate a diagram
 * for a pick and place that shows the moves and the points?").
 *
 * Pure geometry, no model call: the PNP path drawn as an SVG side view
 * (X horizontal, Z vertical) straight from the sheet's LIVE servo values —
 * it re-renders as values change, so a wrong number is visible immediately.
 * This picture is the proof gate: Dan approves it before code.
 *
 * THE PATH IS ONE SQUARE INVERTED-U (Dan's correction, Aug 24 — the first
 * offset rendering read as "two separate things with different retract
 * heights"): down at Pick, up to THE single Retract height, traverse across
 * at that height unchanged, down at Place. Blending is ONLY rounding the
 * corners of that square — at each retract-level corner the arc starts on the
 * vertical leg at blend-distance before the vertex and ends on the horizontal
 * leg at the same distance after it (SYMMETRIC, like a rounded 45° corner).
 * Pick point, Place point, Retract height never move. The theoretical sharp
 * corners stay visible as a light dashed square under the actual rounded path.
 *
 * Speed per segment: Fast blue (#0072B5), Slow amber (#d97706) — the fast/slow
 * split at the transition points reads the same up and down (fast above the
 * transition, slow below). Gripper events marked; wait-for-part at start when
 * the sequence has one. Geometric-sanity errors (geometrySanity.js) draw the
 * offending point RED with the plain sentence under the diagram.
 *
 * X and Z are drawn to independent scales so wildly different spans both read.
 */

import { axisGeometryIssues } from '../../lib/geometrySanity.js';

const FAST = '#0072B5';
const SLOW = '#d97706';
const ERR = '#dc2626';
const INK = 'var(--color-text)';
const MUTED = 'var(--color-text-muted)';
const LIGHT = 'var(--color-text-light)';
const GHOST = '#c3cad4'; // theoretical square corners

const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalize one device's rows to {key → {name, value}} (sheet valueMm or
 *  built-SM defaultValue). */
function rowsOf(device) {
  const map = new Map();
  for (const p of device?.positions ?? []) {
    if (!p?.name) continue;
    const v = num(p.valueMm ?? p.value ?? p.defaultValue);
    map.set(normKey(p.name), { name: String(p.name), value: v });
  }
  return map;
}

/** ROTARY / DIAL axes (Dan's Magnet Dial round, 2026-08-25): a dial-index
 *  servo never draws the PNP inverted-U — it gets the dial glyph instead.
 *  Detected from motionType, or the axis's own words when untagged. */
export function isRotaryAxisDevice(d) {
  if (!/servo/i.test(String(d?.type ?? ''))) return false;
  const mt = String(d?.motionType ?? '').toLowerCase();
  if (mt === 'rotary') return true;
  if (mt === 'linear') return false;
  return /\b(dial|rotary|indexer|index table)\b/i.test(
    `${d?.displayName ?? ''} ${d?.name ?? ''} ${d?.purpose ?? ''}`);
}

/** Fixture count + index increment for a dial axis — reads both shapes
 *  (sheet rows: fixtureCount/indexIncrementDeg; built SM: the Index position
 *  row's heads + defaultValue). */
function dialModelOf(d) {
  const idxRow = (d?.positions ?? []).find(
    (p) => p?.type === 'index' || /^index(increment|angle|distance)?$/i.test(String(p?.name ?? '').trim()));
  const n = num(d?.fixtureCount) ?? num(idxRow?.heads);
  const inc = num(d?.indexIncrementDeg)
    ?? (n ? Math.round((360 / n) * 100) / 100
      : num(idxRow?.valueMm ?? idxRow?.defaultValue ?? idxRow?.value));
  // Rotation direction (Dan, 2026-08-25: "his dial draws backwards") —
  // declared on the card, riding on the device / its Index row. Default CW.
  const dirRaw = String(d?.rotationDirection ?? idxRow?.rotationDirection ?? 'cw').toLowerCase();
  return { n: n && n >= 2 ? Math.round(n) : null, inc, ccw: dirRaw === 'ccw' };
}

/**
 * Find the PNP pair among a device list (sheet rows or built-SM devices) and
 * pull the named values. Returns { ok, missing[], … } — missing lists what
 * still needs a value before the picture can draw. Rotary/dial axes are
 * excluded — they draw as dial glyphs, never as a PNP leg.
 */
export function extractPnpModel(devices) {
  const axes = (devices ?? []).filter((d) =>
    /servo/i.test(String(d?.type ?? '')) && !isRotaryAxisDevice(d));
  if (axes.length < 2) return { ok: false, missing: [], reason: axes.length ? 'one linear servo axis — a pick-and-place path needs two' : null };

  const scored = axes.map((d) => ({ d, rows: rowsOf(d), name: String(d.displayName || d.name || '') }));
  const vertical = scored.find((a) => a.rows.has('retract'))
    ?? scored.find((a) => /vert|(^|[^a-z])z/i.test(a.name));
  const horizontal = scored.find((a) => a !== vertical && a.rows.has('pick') && a.rows.has('place'))
    ?? scored.find((a) => a !== vertical && /horiz|(^|[^a-z])x/i.test(a.name))
    ?? scored.find((a) => a !== vertical);
  if (!vertical || !horizontal) return { ok: false, missing: [], reason: 'could not tell the vertical axis from the horizontal one' };

  const missing = [];
  const need = (axis, key, label) => {
    const r = axis.rows.get(key);
    if (r && r.value !== null) return r.value;
    missing.push(`${axis.name} · ${label}`);
    return null;
  };
  const opt = (axis, key) => {
    const r = axis.rows.get(key);
    return r && r.value !== null ? r.value : null;
  };
  const xPick = need(horizontal, 'pick', 'Pick');
  const xPlace = need(horizontal, 'place', 'Place');
  const zRetract = need(vertical, 'retract', 'Retract');
  const zPick = need(vertical, 'pick', 'Pick');
  const zPlace = need(vertical, 'place', 'Place');
  const zPickT = opt(vertical, 'picktransition');
  const zPlaceT = opt(vertical, 'placetransition');
  // Corner blends: Pick{Level}Blend / Place{Level}Blend (level usually Retract)
  let bPick = null;
  let bPlace = null;
  for (const [, r] of vertical.rows) {
    const m = r.name.match(/^(Pick|Place)(.+)Blend$/i);
    if (!m || r.value === null) continue;
    if (/^pick$/i.test(m[1])) bPick = r.value;
    else bPlace = r.value;
  }

  if (missing.length) return { ok: false, missing, vertical: vertical.name, horizontal: horizontal.name };
  return {
    ok: true,
    vertical: vertical.name,
    horizontal: horizontal.name,
    verticalRows: [...vertical.rows.values()],
    horizontalRows: [...horizontal.rows.values()],
    xPick, xPlace, zRetract, zPick, zPlace, zPickT, zPlaceT, bPick, bPlace,
  };
}

/** Does the sequence start by waiting on a part? (Standard PNP assumption.) */
function waitsForPart(sequence) {
  const first = String((sequence ?? [])[0] ?? '');
  const all = (sequence ?? []).map(String).join(' ');
  return /part.?present|wait.*part|part.*(arriv|in nest)/i.test(first) ||
    /part.?present/i.test(all);
}

function Dot({ x, y, err, r = 4.5 }) {
  return <circle cx={x} cy={y} r={r} fill={err ? ERR : '#1f2937'} stroke="#fff" strokeWidth="1.5" />;
}

/** DIAL GLYPH (Dan's Magnet Dial round): a rotary axis draws as a simple
 *  dial — circle, N fixture ticks, index arrow with the increment in ° —
 *  never the PNP inverted-U. Unknown fixture count → one plain ask line
 *  pointing at the axis card's Fixtures field. */
function DialGlyph({ device }) {
  const name = String(device.displayName || device.name || 'Dial');
  const { n, inc, ccw } = dialModelOf(device);
  if (!n) {
    return (
      <div
        data-testid={`motion-dial-waiting-${name}`}
        style={{ fontSize: 12, color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8', borderRadius: 6, padding: '7px 10px', marginTop: 4 }}
      >
        {name} is a rotary dial — set <b>Fixtures (nests)</b> on its card and the dial draws itself.
      </div>
    );
  }
  const cx = 80;
  const cy = 78;
  const R = 54;
  const step = (2 * Math.PI) / n;
  const pt = (k, r = R) => [cx + r * Math.sin(k * step), cy - r * Math.cos(k * step)];
  const ticks = Array.from({ length: n }, (_, k) => pt(k));
  // Index arrow: an arc from fixture 0 toward the NEXT fixture in the dial's
  // declared rotation direction (Dan, 2026-08-25 — his dial drew backwards).
  const dirSign = ccw ? -1 : 1;
  const [ax, ay] = pt(0.12 * dirSign, R + 11);
  const [bx, by] = pt(0.88 * dirSign, R + 11);
  const sweep = ccw ? 0 : 1;
  // Arrowhead from the arc's end tangent so it points the travel direction.
  const thEnd = 0.88 * dirSign * step;
  const tX = Math.cos(thEnd) * dirSign;
  const tY = Math.sin(thEnd) * dirSign;
  const hp1 = [bx - tX * 9 + -tY * 4.5, by - tY * 9 + tX * 4.5];
  const hp2 = [bx - tX * 9 - -tY * 4.5, by - tY * 9 - tX * 4.5];
  const incText = `${inc ?? Math.round((360 / n) * 100) / 100}°`;
  return (
    <div data-testid={`motion-dial-${name}`} style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 2 }}>
      <svg viewBox="0 0 160 156" style={{ width: 130, height: 127, flexShrink: 0 }} data-testid="motion-dial-svg">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#9ca3af" strokeWidth="1.6" />
        <circle cx={cx} cy={cy} r={5} fill="none" stroke="#9ca3af" strokeWidth="1.4" />
        {ticks.map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r={4} fill={k === 0 ? '#1f2937' : 'none'} stroke="#1f2937" strokeWidth="1.4" />
        ))}
        {/* index arrow between adjacent fixtures — honors CW/CCW */}
        <path
          data-testid={`motion-dial-arrow-${ccw ? 'ccw' : 'cw'}`}
          d={`M ${ax} ${ay} A ${R + 11} ${R + 11} 0 0 ${sweep} ${bx} ${by}`}
          fill="none" stroke={FAST} strokeWidth="2.2" strokeLinecap="round"
        />
        <path
          d={`M ${hp1[0]} ${hp1[1]} L ${bx} ${by} L ${hp2[0]} ${hp2[1]}`}
          fill="none" stroke={FAST} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
      <div style={{ fontSize: 12, color: INK, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700 }}>{name}</div>
        <div style={{ color: MUTED }} data-testid={`motion-dial-summary-${name}`}>
          rotary dial — {n} fixtures × {incText} per index · {ccw ? 'CCW' : 'CW'}
        </div>
      </div>
    </div>
  );
}

/**
 * The panel. Props:
 *   devices  — sheet device rows OR built-SM devices (both position shapes ok)
 *   sequence — sheet sequence lines (for the wait-for-part note); optional
 */
export function PathDiagram({ devices, sequence, onPointClick }) {
  const model = extractPnpModel(devices);
  // Rotary/dial axes draw as dial glyphs — device-aware, never the wrong
  // "a PNP path needs two" message for a dial station.
  const rotaries = (devices ?? []).filter(isRotaryAxisDevice);
  const dialJsx = rotaries.map((d, i) => <DialGlyph key={d.id ?? d.name ?? i} device={d} />);
  // One click from the picture to the value (Dan, Aug 24): clicking a point's
  // label focuses the matching sheet row.
  const click = (axisName, rowName) => onPointClick ? { onClick: () => onPointClick(axisName, rowName), style: { cursor: 'pointer' } } : {};

  const shell = (children) => (
    <div
      data-testid="motion-path-panel"
      style={{
        marginTop: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 8, padding: '12px 16px 14px', width: '100%', boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: MUTED, textTransform: 'uppercase' }}>
          Motion path
        </span>
        {model.ok && (
          <span style={{ fontSize: 10.5, color: LIGHT }}>
            drawn from the live values below — X and Z to independent scales
          </span>
        )}
      </div>
      {children}
    </div>
  );

  if (!model.ok) {
    // Dial-only station: the dial glyph IS the motion picture.
    if (model.reason === null && !model.missing?.length) {
      return rotaries.length ? shell(<>{dialJsx}</>) : null; // no drawable motion — no panel
    }
    return shell(
      <>
        {dialJsx}
        <div data-testid="motion-path-waiting" style={{ fontSize: 12, color: '#6b5513', background: '#fdf6e3', border: '1px solid #e6d9a8', borderRadius: 6, padding: '7px 10px', marginTop: rotaries.length ? 8 : 0 }}>
          {model.missing?.length
            ? <>The path draws itself once these have values: <b>{model.missing.join(', ')}</b></>
            : <>Can't draw the pick-and-place path yet — {model.reason}.</>}
        </div>
      </>
    );
  }

  const { xPick, xPlace, zRetract, zPick, zPlace, zPickT, zPlaceT, bPick, bPlace } = model;

  // Geometric sanity on the values feeding this picture.
  const xTravelMm = Math.abs(xPlace - xPick) || null;
  const issues = [
    ...axisGeometryIssues(model.vertical, model.verticalRows.map((r) => ({ name: r.name, value: r.value })), {}, { xTravelMm }),
    ...axisGeometryIssues(model.horizontal, model.horizontalRows.map((r) => ({ name: r.name, value: r.value })), {}, { xTravelMm }),
  ];
  const errKeys = new Set(issues.map((i) => normKey(i.rowName)));
  const isErr = (name) => errKeys.has(normKey(name));

  // ── Layout ────────────────────────────────────────────────────────────────
  const W = 900;
  const H = 340;
  const mL = 190; // left label rail (pick side)
  const mR = 190; // right label rail (place side)
  const mT = 58;
  const mB = 64;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;

  // X: linear over the two X positions.
  const xLo = Math.min(xPick, xPlace);
  const xSpan = Math.max(Math.abs(xPlace - xPick), 1);
  const X = (v) => mL + ((v - xLo) / xSpan) * plotW;

  // Z: THE single Retract height at the top; deepest working point at bottom.
  const zCandidates = [zPick, zPlace, zPickT, zPlaceT].filter((v) => v !== null);
  const zFar = zCandidates.reduce((a, v) => (Math.abs(v - zRetract) > Math.abs(a - zRetract) ? v : a), zCandidates[0]);
  const zSpan = Math.max(Math.abs(zFar - zRetract), 1);
  const Y = (v) => mT + (Math.abs(v - zRetract) / zSpan) * plotH;

  const PX = X(xPick);
  const PLX = X(xPlace);
  const sign = PLX >= PX ? 1 : -1;
  const yR = Y(zRetract);
  const yP = Y(zPick);
  const yPL = Y(zPlace);
  const yPT = zPickT !== null ? Y(zPickT) : null;
  const yPLT = zPlaceT !== null ? Y(zPlaceT) : null;

  // Blend insets in px. THE SHAPE MUST READ TRUE (Dan, Aug 24 round 5):
  // equal blend values are a SYMMETRIC quarter-round, so both legs of a
  // corner use ONE common pixel scale (the Z scale) — locally deviating from
  // X's global scale is fine; the visual truth of the shape beats local
  // scale fidelity. Unequal values stay visibly asymmetric in the right
  // direction because both corners share the same scale.
  const zPx = (mm) => (Math.abs(mm) / zSpan) * plotH;
  const clamp = (v, max) => Math.max(4, Math.min(v, max));
  const bPickZ = bPick !== null ? clamp(zPx(bPick), plotH / 3) : 0;
  const bPickX = bPick !== null ? clamp(zPx(bPick), plotW / 4) : 0;
  const bPlaceZ = bPlace !== null ? clamp(zPx(bPlace), plotH / 3) : 0;
  const bPlaceX = bPlace !== null ? clamp(zPx(bPlace), plotW / 4) : 0;

  const wait = waitsForPart(sequence);

  // Centered labels near the viewBox edges shift inward so no name/value is
  // ever cut off (Dan, Aug 24 round 3 — "PlaceTrans…" was clipped).
  const clampX = (cx, half) => Math.max(half + 4, Math.min(cx, W - half - 4));

  // ── LABEL RAILS (Dan, Aug 24 round 4): the Z point labels stack COLLIMATED
  // on the left (pick side) and right (place side) — one entry per height,
  // dotted leader to the point, readable top-to-bottom like a table. ────────
  const zDir = Math.sign(zFar - zRetract) || 1;
  const railRows = (entries) => {
    const rows = entries.filter(Boolean).sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const r of rows) {
      r.ly = Math.max(r.y, prev + 15); // de-overlap: labels never collide
      prev = r.ly;
    }
    return rows;
  };
  const leftRail = railRows([
    { y: yR, text: `Retract ${zRetract}`, row: 'Retract', bold: true },
    bPick !== null
      ? { y: yR + bPickZ, text: `Blend end ${zRetract + zDir * bPick}`, row: 'PickRetractBlend', muted: true }
      : { y: yR + 16, text: 'PickRetractBlend — set this', row: 'PickRetractBlend', need: true },
    yPT !== null && { y: yPT, text: `Pick speed transition ${zPickT}`, row: 'PickTransition' },
    { y: yP, text: `Pick ${zPick}`, row: 'Pick', bold: true },
  ]);
  const rightRail = railRows([
    bPlace !== null
      ? { y: yR + bPlaceZ, text: `Blend end ${zRetract + zDir * bPlace}`, row: 'PlaceRetractBlend', muted: true }
      : { y: yR + 16, text: 'PlaceRetractBlend — set this', row: 'PlaceRetractBlend', need: true },
    yPLT !== null && { y: yPLT, text: `Place speed transition ${zPlaceT}`, row: 'PlaceTransition' },
    { y: yPL, text: `Place ${zPlace}`, row: 'Place', bold: true },
  ]);
  const railEntry = (r, side) => {
    const err = r.need || isErr(r.row);
    const railX = side === 'left' ? mL - 14 : W - mR + 14;
    const vertX = side === 'left' ? PX : PLX;
    return (
      <g key={`${side}-${r.row}`}>
        <line x1={side === 'left' ? mL - 10 : W - mR + 10} y1={r.ly} x2={vertX} y2={r.y}
          stroke={err ? ERR : '#b7c0cb'} strokeWidth="1" strokeDasharray="2 3" />
        <text x={railX} y={r.ly + 4} textAnchor={side === 'left' ? 'end' : 'start'} fontSize="12"
          fontWeight={r.bold || err ? 700 : 600}
          fill={err ? ERR : r.muted ? MUTED : INK}
          {...(err && r.need ? { textDecoration: 'underline' } : {})}
          {...click(model.vertical, r.row)}
          data-testid={`motion-rail-${r.row}`}>
          {r.text}
        </text>
      </g>
    );
  };

  const seg = (x1, y1, x2, y2, color, extra = {}) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="3" strokeLinecap="round" {...extra} />
  );
  // Tiny direction chevrons BESIDE the one path line (the path itself is one
  // square — arrows only annotate travel direction, they never split it).
  const chevron = (x, y, dir, color) => {
    const d = {
      down: `M ${x - 4} ${y - 6} L ${x} ${y} L ${x + 4} ${y - 6}`,
      up: `M ${x - 4} ${y + 6} L ${x} ${y} L ${x + 4} ${y + 6}`,
      right: `M ${x - 6} ${y - 4} L ${x} ${y} L ${x - 6} ${y + 4}`,
      left: `M ${x + 6} ${y - 4} L ${x} ${y} L ${x + 6} ${y + 4}`,
    }[dir];
    return <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
  };

  return shell(
    <>
      {dialJsx}
      {/* SIZE (Dan, Aug 24: "way too big"): the drawing is capped — it never
          dwarfs the sheet — and rescales LIVE as values change (the whole SVG
          recomputes from the live rows on every render). */}
      <div style={{ width: '100%', maxWidth: 780, margin: '0 auto', overflow: 'visible' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: 340, display: 'block' }} data-testid="motion-path-svg">
          {/* THE single Retract height */}
          <line x1={mL - 10} y1={yR} x2={W - mR + 10} y2={yR} stroke="#9ca3af" strokeWidth="1" strokeDasharray="5 5" />

          {/* LABEL RAILS — Z points collimated left (pick side) and right
              (place side), dotted leaders to each height (Dan, round 4). */}
          {leftRail.map((r) => railEntry(r, 'left'))}
          {rightRail.map((r) => railEntry(r, 'right'))}

          {/* Theoretical SQUARE (sharp corners) — light dashed, under the
              actual rounded path. One square inverted-U, nothing offset. */}
          <path
            d={`M ${PX} ${yP} L ${PX} ${yR} L ${PLX} ${yR} L ${PLX} ${yPL}`}
            fill="none" stroke={GHOST} strokeWidth="1.4" strokeDasharray="4 4"
          />

          {/* ── THE ACTUAL PATH — one square inverted-U with rounded corners ──
              Vertical at Pick (colored fast above / slow below the transition),
              rounded pick corner, traverse at Retract height, rounded place
              corner, vertical at Place. Same line both directions. */}
          {/* Pick vertical: slow below the transition, fast above (up to where rounding starts) */}
          {yPT !== null
            ? <>
                {seg(PX, yP, PX, yPT, SLOW)}
                {seg(PX, yPT, PX, yR + bPickZ, FAST)}
              </>
            : seg(PX, yP, PX, yR + bPickZ, FAST)}
          {/* Pick corner arc: starts blend-distance BEFORE the vertex on the
              vertical leg, ends blend-distance AFTER it on the horizontal leg */}
          <path
            d={`M ${PX} ${yR + bPickZ} Q ${PX} ${yR} ${PX + bPickX * sign} ${yR}`}
            fill="none" stroke={FAST} strokeWidth="3" strokeLinecap="round"
          />
          {/* Traverse at THE Retract height */}
          {seg(PX + bPickX * sign, yR, PLX - bPlaceX * sign, yR, FAST)}
          {/* Place corner arc */}
          <path
            d={`M ${PLX - bPlaceX * sign} ${yR} Q ${PLX} ${yR} ${PLX} ${yR + bPlaceZ}`}
            fill="none" stroke={FAST} strokeWidth="3" strokeLinecap="round"
          />
          {/* Place vertical */}
          {yPLT !== null
            ? <>
                {seg(PLX, yR + bPlaceZ, PLX, yPLT, FAST)}
                {seg(PLX, yPLT, PLX, yPL, SLOW)}
              </>
            : seg(PLX, yR + bPlaceZ, PLX, yPL, FAST)}

          {/* Direction chevrons (annotations beside the one path) */}
          {chevron(PX - 10, (Math.max(yPT ?? yR, yR) + yP) / 2, 'down', yPT !== null ? SLOW : FAST)}
          {chevron(PX + 10, ((yR + bPickZ) + (yPT ?? yP)) / 2, 'up', FAST)}
          {chevron((PX + PLX) / 2, yR - 10, sign > 0 ? 'right' : 'left', FAST)}
          {chevron(PLX + 10, ((yPLT ?? yR) + yPL) / 2, 'down', yPLT !== null ? SLOW : FAST)}

          {/* ── Blend start/end dots on BOTH legs of each corner — the values
              and "set this" asks live on the label rails (Dan, round 4). ── */}
          {bPick !== null ? (
            <>
              <Dot x={PX} y={yR + bPickZ} r={3.5} err={isErr('PickRetractBlend')} />
              <Dot x={PX + bPickX * sign} y={yR} r={3.5} err={isErr('PickRetractBlend')} />
              <text x={PX + bPickX * sign + 10 * sign} y={yR - 8} textAnchor={sign > 0 ? 'start' : 'end'} fontSize="10.5" fontWeight="600" fill={isErr('PickRetractBlend') ? ERR : MUTED} {...click(model.vertical, 'PickRetractBlend')} data-testid="motion-blend-pick">
                PickRetractBlend {bPick} mm
              </text>
            </>
          ) : (
            <circle cx={PX} cy={yR} r={5} fill="none" stroke={ERR} strokeWidth="2" strokeDasharray="2 2" data-testid="motion-blend-pick-missing" />
          )}
          {bPlace !== null ? (
            <>
              <Dot x={PLX - bPlaceX * sign} y={yR} r={3.5} err={isErr('PlaceRetractBlend')} />
              <Dot x={PLX} y={yR + bPlaceZ} r={3.5} err={isErr('PlaceRetractBlend')} />
              <text x={PLX - bPlaceX * sign - 10 * sign} y={yR - 8} textAnchor={sign > 0 ? 'end' : 'start'} fontSize="10.5" fontWeight="600" fill={isErr('PlaceRetractBlend') ? ERR : MUTED} {...click(model.vertical, 'PlaceRetractBlend')} data-testid="motion-blend-place">
                PlaceRetractBlend {bPlace} mm
              </text>
            </>
          ) : (
            <circle cx={PLX} cy={yR} r={5} fill="none" stroke={ERR} strokeWidth="2" strokeDasharray="2 2" data-testid="motion-blend-place-missing" />
          )}

          {/* ── Speed-transition dots (labels live on the rails) ── */}
          {yPT !== null && <Dot x={PX} y={yPT} err={isErr('PickTransition')} />}
          {yPLT !== null && <Dot x={PLX} y={yPLT} err={isErr('PlaceTransition')} />}

          {/* ── Pick / Place points: Z values live on the rails; the point
              label carries the X position + the gripper event. ── */}
          <Dot x={PX} y={yP} r={5.5} err={isErr('Pick')} />
          <text x={clampX(PX, 60)} y={yP + 20} textAnchor="middle" fontSize="12" fontWeight="800" fill={isErr('Pick') ? ERR : INK} {...click(model.horizontal, 'Pick')}>
            Pick · X {xPick}
          </text>
          <text x={clampX(PX, 60)} y={yP + 34} textAnchor="middle" fontSize="10.5" fill={MUTED}>gripper closes</text>

          <Dot x={PLX} y={yPL} r={5.5} err={isErr('Place')} />
          <text x={clampX(PLX, 60)} y={yPL + 20} textAnchor="middle" fontSize="12" fontWeight="800" fill={isErr('Place') ? ERR : INK} {...click(model.horizontal, 'Place')}>
            Place · X {xPlace}
          </text>
          <text x={clampX(PLX, 60)} y={yPL + 34} textAnchor="middle" fontSize="10.5" fill={MUTED}>gripper opens</text>

          {/* Wait-for-part at cycle start */}
          {wait && (
            <text x={PX} y={yR - 42} textAnchor="middle" fontSize="10.5" fill={MUTED}>
              cycle starts: wait for part at Pick
            </text>
          )}

          {/* Legend */}
          <g transform={`translate(${mL - 70}, ${H - 14})`} fontSize="11">
            <line x1="0" y1="-4" x2="26" y2="-4" stroke={FAST} strokeWidth="3" strokeLinecap="round" />
            <text x="32" y="0" fill={MUTED}>Fast</text>
            <line x1="72" y1="-4" x2="98" y2="-4" stroke={SLOW} strokeWidth="3" strokeLinecap="round" />
            <text x="104" y="0" fill={MUTED}>Slow</text>
            <line x1="148" y1="-4" x2="174" y2="-4" stroke={GHOST} strokeWidth="1.4" strokeDasharray="4 4" />
            <text x="180" y="0" fill={MUTED}>square corner (un-blended) — the arc between the dots is the blend</text>
          </g>
        </svg>
      </div>
      {issues.length > 0 && (
        <div data-testid="motion-path-errors" style={{ marginTop: 6 }}>
          {issues.map((it, i) => (
            <div key={i} style={{ fontSize: 12, color: ERR, fontWeight: 600, lineHeight: 1.5 }}>
              ⚠ {it.axisName}: {it.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
