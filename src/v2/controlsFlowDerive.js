/**
 * controlsFlowDerive.js — derive the Controls Diagram (the REAL code's
 * flowchart) from a station's compiled sequence IR.
 *
 * Dan: "the actual flowchart for the real PLC code… all the controls stuff,
 * the decisions, the waits, retries, fault recovery, part tracking — and it
 * doubles as a tool for anybody to look at and decide what changes we want
 * to make."
 *
 * PURE derivation — computed on view from sm.compiledSequence.ir, NEVER
 * stored, never touches the drawn mechanical diagram. Output is a node/edge
 * set for the dedicated read-only React Flow instance in ControlsFlowView.
 *
 * Layout: main sequence down the CENTER column (flow order, so synthesized
 * confirm states sit exactly where they run); fault/recovery as its own
 * column to the RIGHT (127 → 2 → init 100 → 103/106 branch → 124), with
 * resume edges crossing back into the main sequence. Template states that
 * exist only in transitions (2, 100, 103, 106, 124, 127) are synthesized
 * into stub nodes here.
 */

// ── Geometry ────────────────────────────────────────────────────────────────
// 240 = the mechanical StateNode's hard width cap — TRUE VIEW PARITY (Dan,
// Aug 22): the controls detail renders the SAME node components at the SAME
// size, so the column width must match the mechanical diagram exactly.
export const CF_NODE_W = 240;
const COL_GAP = 260; // between main column right edge and recovery column
const V_GAP = 78; // vertical gap between stacked nodes (room for edge labels)
const SIB_GAP = 40; // gap between side-by-side branch siblings

import { computeStateNumbers } from '../lib/computeStateNumbers.js';

// Canonical template-state ordering for the recovery column (top → bottom).
const TEMPLATE_ORDER = [127, 2, 100, 103, 106, 124, 99, 0, 1, 3];

// ── Condition text → plain form ─────────────────────────────────────────────

/** Split "rung text — human note" into { rung, note }. */
function splitNote(text) {
  const s = String(text ?? '');
  const i = s.indexOf('—');
  if (i === -1) return { rung: s.trim(), note: '' };
  return { rung: s.slice(0, i).trim(), note: s.slice(i + 1).trim() };
}

/**
 * Condense raw R02 rung text into a plain, readable condition:
 *   - MOVE/OTL/OTU/OTE writes stripped (they're effects, not conditions)
 *   - XIC(x) → x, XIO(x) → NOT x
 *   - "[a ,b]" parallel branches → "(a OR b)"
 *   - noise terms (SS_OK, the from-state XIC, Status./Control. prefixes) dropped
 */
export function summarizeCondition(conditionText, fromState) {
  let s = String(conditionText ?? '');
  // Strip the leading "*Replace …:" / "*Verify …:" marker (flagged separately).
  s = s.replace(/^\*\w+[^:]*:\s*/, '');
  s = splitNote(s).rung;
  s = s.replace(/MOVE\([^()]*\)/g, '');
  s = s.replace(/OT[LUE]\([^()]*\)/g, '');
  s = s.replace(/XIC\(([^()]*)\)/g, '$1 ');
  s = s.replace(/XIO\(([^()]*)\)/g, 'NOT $1 ');
  s = s.replace(/Status\.|Control\./g, '');
  s = s.replace(/\bSS_OK\b/g, '');
  if (fromState != null) {
    s = s.replace(new RegExp(`\\bState\\[${fromState}\\]`, 'g'), '');
  }
  s = s.replace(/\bNOT\s*(?=[,\]]|$)/g, ''); // NOT left dangling by a strip
  // Protect tag indexes ([55], [10]) so the branch-bracket pass below only
  // sees the rung's REAL parallel-branch brackets.
  s = s.replace(/\[(\d+)\]/g, '⟦$1⟧');
  // Parallel branches "[a ,b]" → "(a OR b)"; innermost first, loop for nesting.
  for (let guard = 0; guard < 6; guard++) {
    const next = s.replace(/\[([^[\]]*)\]/g, (m, inner) => {
      const parts = inner
        .split(/\s*,\s*/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (parts.length === 0) return '';
      if (parts.length === 1) return parts[0];
      return `(${parts.join(' OR ')})`;
    });
    if (next === s) break;
    s = next;
  }
  s = s.replace(/⟦(\d+)⟧/g, '[$1]');
  s = s.replace(/\(\s*\)/g, ''); // groups emptied by the write-strips
  s = s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  s = s.replace(/^[,·\s]+|[,·\s]+$/g, '');
  // Inside OR-groups: ANDed terms joined with " + ", branches with " OR ".
  s = s.replace(/\(([^()]*)\)/g, (m, inner) =>
    `(${inner
      .split(/\s+OR\s+/)
      .map((br) => br.trim().split(/\s+/).join(' + '))
      .join('  OR  ')})`
  );
  // Top level: ANDed terms joined with " · " (paren-aware, NOT kept attached).
  const terms = [];
  let depth = 0;
  let curTok = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) {
      if (curTok) { terms.push(curTok); curTok = ''; }
    } else {
      curTok += ch;
    }
  }
  if (curTok) terms.push(curTok);
  const merged = [];
  for (let i = 0; i < terms.length; i++) {
    if (terms[i] === 'NOT' && terms[i + 1]) merged.push(`NOT ${terms[++i]}`);
    else merged.push(terms[i]);
  }
  return merged.join(' · ');
}

/** Part-tracking / handshake side effects written on the transition rung. */
function transitionEffects(conditionText) {
  const s = String(conditionText ?? '');
  const fx = [];
  const re = /OT([LU])\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tag = m[2].replace(/Status\.|Control\./g, '');
    fx.push(`${tag} ${m[1] === 'L' ? '↑' : '↓'}`);
  }
  return fx;
}

// ── Action lines per state ──────────────────────────────────────────────────

function actionLine(a, deviceByName) {
  const { rung, note } = splitNote(a.detail);
  const title = a.detail || '';
  const dev = a.deviceName || a.device || '';
  const p = a.params ?? {};
  // Structured fields ride along so the view can render the MECHANICAL
  // diagram's node look (device icon, POS/SPEED rows, operation colors) —
  // Dan, Aug 22: "match the look and feel of the nodes themselves".
  const liveDev = (deviceByName instanceof Map ? deviceByName.get(dev) : null) ?? null;
  const base = {
    op: a.operation || '',
    device: liveDev?.displayName ?? liveDev?.name ?? dev,
    deviceType: liveDev?.type ?? null,
    positionName: p.positionName ?? null,
    speedProfile: p.speedProfile ?? null,
    advance: p.advance ?? null,
  };
  switch (a.operation) {
    case 'ServoMove': {
      const pos = p.positionName ? ` → ${p.positionName}` : '';
      const spd = p.speedProfile ? ` · ${p.speedProfile}` : '';
      const adv = p.advance === 'wideband' ? ' · wideband exit' : '';
      return { ...base, icon: '⤳', text: `${dev}${pos}${spd}${adv}`, title };
    }
    case 'Engage':
      return { ...base, icon: '✊', text: `${base.device} — close (grip)`, title };
    case 'Disengage':
      return { ...base, icon: '✋', text: `${base.device} — open (release)`, title };
    case 'Wait': {
      const short = note || rung;
      return { ...base, icon: '⏳', text: short.length > 78 ? `${short.slice(0, 75)}…` : short, title };
    }
    case 'SetSignal':
    case 'ClearSignal': {
      // detail leads with the tag or the OTL/OTU instruction — pull the tag.
      const m = /OT([LU])\(([^()]*)\)/.exec(rung) ?? /^([\w.]+)/.exec(rung);
      let text;
      if (m && m.length === 3) text = `${m[2].replace(/Status\.|Control\./g, '')} ${m[1] === 'L' ? '↑' : '↓'}`;
      else text = (m?.[1] ?? rung).replace(/Status\.|Control\./g, '');
      if (a.operation === 'ClearSignal' && !/[↑↓]/.test(text)) text += ' ↓';
      if (a.operation === 'SetSignal' && !/[↑↓]/.test(text)) text += ' ↑';
      return { ...base, icon: '⚡', text, title };
    }
    default: {
      const short = note || rung || a.operation;
      return { ...base, icon: '·', text: `${a.operation}${dev ? ` — ${dev}` : ''}${short && short !== a.operation ? `: ${short.slice(0, 60)}` : ''}`, title };
    }
  }
}

// ── Node height estimates (initial layout only — the view re-stacks with
//    MEASURED heights once React Flow has rendered, so these just need to be
//    in the right ballpark) ──────────────────────────────────────────────────
function estimateHeight(data) {
  let h = 48; // header (number + label, may wrap)
  if ((data.label ?? '').length > 34) h += 16;
  for (const a of data.actions ?? []) {
    // Servo rows render the mechanical POS/SPEED grid — taller than a line.
    h += a.op === 'ServoMove' && (a.positionName || a.speedProfile) ? 44 : 26;
  }
  if (data.chips?.length) h += 26;
  if (data.timeout) h += 24;
  return Math.max(h, 58);
}

/** Estimate for a REAL drawn node rendered through StateNode/DecisionNode. */
function estimateRealHeight(drawn, chips, timeout) {
  const d = drawn.data ?? {};
  let h = 40; // header
  if (drawn.type === 'decisionNode') h = 96;
  else if (d.isComplete) h += 44;
  else if (d.isInitial) h += 44 + 24 * Math.max(1, (d.actions ?? []).length || 2);
  else {
    for (const a of d.actions ?? []) {
      h += a.operation === 'ServoMove' ? 58 : 32;
    }
    if ((d.actions ?? []).length === 0) h += 30;
  }
  if (chips?.length) h += 26;
  if (timeout) h += 24;
  return Math.max(h, 64);
}

// ── Main derivation ─────────────────────────────────────────────────────────

/**
 * @param {object} ir — sm.compiledSequence.ir
 * @param {object} sm — the station (drawn nodes are reused for TRUE parity:
 *   a compiled state whose nodeId matches a drawn node renders the REAL
 *   StateNode/DecisionNode component with that node's own data)
 * @returns {{ nodes: any[], edges: any[], stats: object, meta: object }}
 */
export function deriveControlsFlow(ir, sm) {
  const drawnById = new Map((sm?.nodes ?? []).map((n) => [n.id, n]));
  // The compile keeps every drawn state's ASSIGNED number (contract), but its
  // recorded nodeId is often the model's own label ("state4"), not the drawn
  // id — so the authoritative drawn↔compiled match is the STATE NUMBER,
  // computed with the canvas's own DFS. nodeId match is kept as a fast path.
  const drawnByNum = new Map();
  try {
    const { stateMap } = computeStateNumbers(sm?.nodes ?? [], sm?.edges ?? [], sm?.devices ?? []);
    for (const [nodeId, num] of stateMap) {
      const n = drawnById.get(nodeId);
      if (n && !drawnByNum.has(num)) drawnByNum.set(num, n);
    }
  } catch { /* fall back to cards */ }
  const usedDrawn = new Set();
  const states = ir?.states ?? [];
  const transitions = ir?.transitions ?? [];
  const waits = ir?.waits ?? [];
  const handshakes = ir?.handshakes ?? [];

  const realByNum = new Map(states.map((s) => [s.stateNumber, s]));

  // Device lookup (name OR displayName) for icons/colors on action rows.
  const deviceByName = new Map();
  for (const d of ir?.devices ?? []) {
    if (d?.name) deviceByName.set(d.name, d);
    if (d?.displayName) deviceByName.set(d.displayName, d);
  }

  // ── Synthesize template-state stubs from transitions ──
  const templateByNum = new Map();
  for (const t of transitions) {
    for (const [num, label] of [
      [t.fromState ?? t.from, t.fromLabel],
      [t.toState ?? t.to, t.toLabel],
    ]) {
      if (num == null || realByNum.has(num) || templateByNum.has(num)) continue;
      templateByNum.set(num, {
        stateNumber: num,
        label: (label ?? `State ${num}`).replace(/\s*\(template[^)]*\)\s*/i, ''),
        template: true,
      });
    }
  }

  // ── Main-column flow order: walk the sequence transitions from initial ──
  const initial = states.find((s) => s.isInitial) ?? states[0];
  const order = [];
  const visited = new Set();
  let cur = initial?.stateNumber;
  let guard = 0;
  while (cur != null && !visited.has(cur) && guard++ < states.length + 8) {
    visited.add(cur);
    order.push(cur);
    const next = transitions.find(
      (t) =>
        (t.fromState ?? t.from) === cur &&
        (t.toState ?? t.to) !== cur &&
        (t.kind === 'sequence' || t.kind === 'wait') &&
        realByNum.has(t.toState ?? t.to) &&
        !visited.has(t.toState ?? t.to)
    );
    cur = next ? (next.toState ?? next.to) : null;
  }
  // Anything unreachable in the walk still gets drawn (numeric order).
  for (const s of [...states].sort((a, b) => a.stateNumber - b.stateNumber)) {
    if (!visited.has(s.stateNumber)) order.push(s.stateNumber);
  }

  // ── Per-state decorations ──
  const waitByNum = new Map(waits.map((w) => [w.stateNumber, w]));
  const timeoutByNum = new Map();
  for (const t of transitions) {
    const from = t.fromState ?? t.from;
    if (t.kind === 'timeout' && from === (t.toState ?? t.to)) {
      const { note } = splitNote(t.conditionText);
      timeoutByNum.set(from, {
        label: t.outcomeLabel ?? 'Timeout',
        text: note || summarizeCondition(t.conditionText, from),
        title: t.conditionText ?? '',
      });
    }
  }
  const setChips = new Map(); // stateNumber -> chips
  for (const h of handshakes) {
    if (h.setAtState != null) {
      const list = setChips.get(h.setAtState) ?? [];
      list.push({ kind: 'hs-out', text: `⇒ ${h.signal.split(' ')[0]}`, title: h.purpose ?? h.signal });
      setChips.set(h.setAtState, list);
    }
  }

  function buildChips(stateNumber, real, tpl) {
    const chips = [];
    if (real?.synthesized) chips.push({ kind: 'confirm', text: 'confirm (synthesized)', title: 'Synthesized by the compile: trigger/wait split between same-axis segments' });
    if (tpl) chips.push({ kind: 'template', text: 'template', title: 'SDC template state — always emitted, not drawn by the ME' });
    const w = waitByNum.get(stateNumber);
    if (w) chips.push({ kind: 'hs-in', text: `⇐ ${w.partner ?? w.source ?? 'handshake'}`, title: `${w.signal}${w.exits ? `\n${w.exits.map((x) => `→ ${x.toState}: ${x.when}`).join('\n')}` : ''}` });
    for (const c of setChips.get(stateNumber) ?? []) chips.push(c);
    // Part-tracking / signal latches written INSIDE the state's actions
    // (OTL/OTU in the detail text) — surfaced as chips so "part gripped /
    // part started" reads at a glance.
    const acts = real?.actions ?? [];
    for (const a of acts) {
      const re = /OT([LU])\(([^()]*)\)/g;
      let m;
      while ((m = re.exec(String(a.detail ?? ''))) !== null) {
        const tag = m[2].replace(/Status\.|Control\./g, '');
        if (/^p_|Part|PT_/i.test(tag)) {
          chips.push({ kind: m[1] === 'L' ? 'pt-on' : 'pt-off', text: `${tag} ${m[1] === 'L' ? '↑' : '↓'}`, title: a.detail ?? tag });
        }
      }
    }
    return chips;
  }

  /** Build one flow node (real drawn component when possible). */
  function buildNode(stateNumber, lane) {
    const real = realByNum.get(stateNumber);
    const tpl = templateByNum.get(stateNumber);
    const s = real ?? tpl;
    const chips = buildChips(stateNumber, real, tpl);
    const timeout = timeoutByNum.get(stateNumber) ?? null;

    let drawn = real
      ? (real.nodeId && drawnById.get(real.nodeId)) || drawnByNum.get(stateNumber) || null
      : null;
    if (drawn && usedDrawn.has(drawn.id)) drawn = null; // never duplicate a node id
    if (drawn) usedDrawn.add(drawn.id);
    if (drawn) {
      // TRUE PARITY: the actual drawn node, rendered through the REAL
      // StateNode/DecisionNode component (CFRealNode wrapper adds edge
      // handles + the compiled-layer chips).
      const estH = estimateRealHeight(drawn, chips, timeout);
      return {
        id: drawn.id,
        type: 'cfReal',
        data: {
          nodeType: drawn.type,
          nodeData: { ...drawn.data, stateNumber, stepNumber: stateNumber },
          stateNumber,
          lane,
          synthesized: false,
          chips,
          timeout,
          _estH: estH,
        },
        width: CF_NODE_W,
        draggable: false, connectable: false, selectable: false,
      };
    }

    const data = {
      stateNumber,
      label: s?.label ?? `State ${stateNumber}`,
      isInitial: real?.isInitial === true,
      isComplete: real?.isComplete === true,
      synthesized: real?.synthesized === true,
      template: !!tpl,
      actions: (real?.actions ?? []).map((a) => actionLine(a, deviceByName)),
      chips,
      timeout,
      lane,
    };
    data._estH = estimateHeight(data);
    return {
      id: `s${stateNumber}`,
      type: 'cfState',
      data,
      width: CF_NODE_W,
      draggable: false, connectable: false, selectable: false,
    };
  }

  // ── Layout: main column ──
  const nodes = [];
  const posByNum = new Map();
  const idByNum = new Map();
  let y = 0;
  for (const num of order) {
    const node = buildNode(num, 'main');
    const h = node.data._estH;
    node.position = { x: 0, y };
    nodes.push(node);
    posByNum.set(num, { x: 0, y, h });
    idByNum.set(num, node.id);
    y += h + V_GAP;
  }

  // ── Layout: recovery / template column (right side) ──
  const recovX = CF_NODE_W + COL_GAP;
  const templateNums = [...templateByNum.keys()];
  templateNums.sort((a, b) => {
    const ia = TEMPLATE_ORDER.indexOf(a);
    const ib = TEMPLATE_ORDER.indexOf(b);
    return (ia === -1 ? 900 + a : ia) - (ib === -1 ? 900 + b : ib);
  });
  // Group branch siblings (states entered from the SAME single template state)
  const entryOf = (num) => transitions
    .filter((t) => (t.toState ?? t.to) === num)
    .map((t) => t.fromState ?? t.from)
    .sort()
    .join(',');
  const rows = [];
  for (const num of templateNums) {
    const prevRow = rows[rows.length - 1];
    if (
      prevRow &&
      prevRow.length === 1 &&
      entryOf(num) !== '' &&
      entryOf(num) === entryOf(prevRow[0]) &&
      templateByNum.has(Number(entryOf(num).split(',')[0]))
    ) {
      prevRow.push(num); // side-by-side branch (e.g. init 103 / 106)
    } else {
      rows.push([num]);
    }
  }
  let ry = 0;
  for (const row of rows) {
    let rowH = 0;
    row.forEach((num, i) => {
      const node = buildNode(num, 'recovery');
      const h = node.data._estH;
      const x = recovX + i * (CF_NODE_W + SIB_GAP);
      node.position = { x, y: ry };
      nodes.push(node);
      posByNum.set(num, { x, y: ry, h });
      idByNum.set(num, node.id);
      rowH = Math.max(rowH, h);
    });
    ry += rowH + V_GAP;
  }

  // ── Edges ──
  const edges = [];
  const KIND_STYLE = {
    sequence: { stroke: '#6b7280', dash: null },
    wait: { stroke: '#1574C4', dash: null },
    timeout: { stroke: '#b45309', dash: '5 4' },
    recovery: { stroke: '#d97706', dash: '6 4' },
  };
  transitions.forEach((t, idx) => {
    const from = t.fromState ?? t.from;
    const to = t.toState ?? t.to;
    if (from == null || to == null) return;
    if (from === to) return; // self-loop timeouts render as node badges
    const a = posByNum.get(from);
    const b = posByNum.get(to);
    if (!a || !b) return;

    const style = KIND_STYLE[t.kind] ?? KIND_STYLE.sequence;
    const { note } = splitNote(t.conditionText);
    const crossColumn = Math.abs(a.x - b.x) > CF_NODE_W + SIB_GAP / 2;
    const backward = !crossColumn && b.y < a.y;

    // "*Replace supervisor next-pick request: …" → the placeholder's subject.
    const starMatch = /^\s*\*\w+\s+([^:]{4,80}):/.exec(t.conditionText ?? '');

    // Label: outcome/branch name first; wait edges name the signal being
    // waited on; cross-column resume edges prefer the human note (short
    // semantics); everything else shows the condensed condition.
    let label;
    const outcome = t.outcomeLabel ?? t.label;
    if (t.kind === 'wait') {
      const what = starMatch?.[1] ?? shortNote(note) ?? '';
      label = outcome ? `${outcome} — ${what || summarizeCondition(t.conditionText, from)}` : (what || summarizeCondition(t.conditionText, from));
    } else if (outcome) label = outcome;
    else if (crossColumn) label = shortNote(note) || summarizeCondition(t.conditionText, from);
    else label = summarizeCondition(t.conditionText, from);
    if (label && label.length > 120) label = `${label.slice(0, 117)}…`;
    const fx = transitionEffects(t.conditionText);
    if (fx.length && label) label += `  ⟪${fx.join(', ')}⟫`;

    const flagged = /^\s*\*/.test(t.conditionText ?? '');
    if (flagged) label = `⚠ ${label}`;

    let sourceHandle;
    let targetHandle;
    if (crossColumn) {
      if (b.x > a.x) { sourceHandle = 'out-right'; targetHandle = 'in-left'; }
      else { sourceHandle = 'out-left'; targetHandle = 'in-right'; }
    } else if (backward) {
      sourceHandle = 'out-left';
      targetHandle = 'in-left';
    } else {
      sourceHandle = 'out-bottom';
      targetHandle = 'in-top';
    }

    edges.push({
      id: `t-${from}-${to}-${idx}`,
      source: idByNum.get(from),
      target: idByNum.get(to),
      sourceHandle,
      targetHandle,
      type: 'cfEdge',
      data: {
        text: label,
        full: t.conditionText ?? '',
        kind: t.kind ?? 'sequence',
        flagged,
        offset: backward || crossColumn ? 28 : 16,
      },
      style: { stroke: style.stroke, strokeWidth: t.kind === 'recovery' ? 1.8 : 2, ...(style.dash ? { strokeDasharray: style.dash } : {}) },
      markerEnd: { type: 'arrowclosed', color: style.stroke },
    });
  });

  return {
    nodes,
    edges,
    stats: {
      states: states.length,
      synthesized: states.filter((s) => s.synthesized).length,
      templateStates: templateByNum.size,
      transitions: transitions.length,
    },
    // Layout meta so the view can RE-STACK with MEASURED node heights once
    // React Flow has rendered the real components (estimates only bootstrap).
    meta: {
      mainOrder: order.map((num) => idByNum.get(num)),
      recovRows: rows.map((row) => row.map((num) => idByNum.get(num))),
      recovX,
    },
  };
}

/**
 * Re-stack node positions using real measured heights (falls back to the
 * derive-time estimate). Same algorithm as the initial layout: main column
 * stacked down x=0, recovery rows stacked down x=meta.recovX.
 */
export function restackPositions(nodes, meta, heightOf) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map();
  let y = 0;
  for (const id of meta.mainOrder) {
    const n = byId.get(id);
    if (!n) continue;
    pos.set(id, { x: 0, y });
    y += heightOf(n) + V_GAP;
  }
  let ry = 0;
  for (const row of meta.recovRows) {
    let rowH = 0;
    row.forEach((id, i) => {
      const n = byId.get(id);
      if (!n) return;
      pos.set(id, { x: meta.recovX + i * (CF_NODE_W + SIB_GAP), y: ry });
      rowH = Math.max(rowH, heightOf(n));
    });
    ry += rowH + V_GAP;
  }
  return nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id) } : n));
}

/** First clause of the transition's human note, tightly capped. */
function shortNote(note) {
  if (!note) return '';
  let s = note.split(/[;.]/)[0].trim();
  if (s.length > 54) s = `${s.slice(0, 51)}…`;
  return s;
}
