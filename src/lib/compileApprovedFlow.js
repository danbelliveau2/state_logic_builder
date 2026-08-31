/**
 * compileApprovedFlow.js — THE DETERMINISTIC DIAGRAM COMPILE (Dan,
 * 2026-08-31: "the approved SheetFlow IS the diagram").
 *
 * The old Build stage 1 re-DREW the station with a model pass from the raw
 * prose — redundant spend and a drift risk: the drawn diagram could differ
 * from the flow the engineer just approved. For cascade-walked drafts the
 * structured steps ARE the diagram, so this compiles them into the canvas
 * schema deterministically: same data, zero model calls, zero drift.
 *
 * Output matches the diagramAuthor sm contract the Build inserter expects:
 *   { name, displayName, stationNumber, devices[], nodes[], edges[] }
 * Diagram laws honored (root CLAUDE.md): every edge type 'routableEdge';
 * StateNode targets targetHandle null; DecisionNode targets 'input';
 * decision exits exit-pass/exit-fail with isDecisionExit + exitColor; ONE
 * initial node; ONE "Cycle Complete" isComplete terminal.
 *
 * Layout: one column per machine (multi-SM stations draw side by side),
 * steps stacked down; waits become the FOLLOWING edge's condition label
 * (actions on nodes, conditions on edges — v1 conventions); Home/Repeat
 * never draw (Home = the initial node; Repeat = the loop back edge).
 */

let _n = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(++_n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const OP_MAP = [
  [/^extend$/i, 'Extend'],
  [/^retract$/i, 'Retract'],
  [/^engage$|^close$|^grip$/i, 'Engage'],
  [/^disengage$|^open$|^release$/i, 'Disengage'],
  [/^servo ?move$|^move$/i, 'ServoMove'],
  [/^index$/i, 'ServoIndex'],
];
function opOf(action) {
  for (const [re, op] of OP_MAP) if (re.test(String(action ?? '').trim())) return op;
  return null;
}

/** @param machines [{name, sequenceSteps, sequence}] — the APPROVED proposal
 *  @param sheetDevices summary.devices (devId/name/type…)
 *  @returns the drafted sm object (ids remapped by the caller as usual) */
export function compileApprovedFlow({ machines, sheetDevices, stationName, displayName, stationNumber }) {
  const devices = (sheetDevices ?? []).map((d) => ({
    id: d.devId || uid('dev'),
    name: String(d.name ?? '').replace(/\s+/g, ''),
    displayName: d.displayName ?? d.name ?? '',
    type: d.type || 'Custom',
    ...(d.sensorArrangement ? { sensorArrangement: d.sensorArrangement } : {}),
  }));
  const devByKey = new Map(devices.map((d) => [String(d.displayName || d.name).toLowerCase().replace(/[^a-z0-9]/g, ''), d]));
  const findDev = (target, deviceId) => {
    if (deviceId) { const hit = devices.find((d) => d.id === deviceId); if (hit) return hit; }
    const k = String(target ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k) return null;
    for (const [key, d] of devByKey) if (key === k || key.includes(k) || k.includes(key)) return d;
    return null;
  };

  const COL_W = 520;
  const ROW_H = 150;
  const nodes = [];
  const edges = [];

  (machines ?? []).forEach((m, mi) => {
    const x = 220 + mi * COL_W;
    let y = 80;
    const steps = Array.isArray(m.sequenceSteps) && m.sequenceSteps.length
      ? m.sequenceSteps
      : (m.sequence ?? []).map((l) => ({ action: String(l).split(' ')[0], target: String(l), raw: l }));

    // The initial node — Home never draws as a step; it IS this node.
    const home = steps.find((s) => /^home$/i.test(s?.action ?? ''));
    const init = {
      id: uid('n'), type: 'stateNode', position: { x, y },
      data: {
        label: mi === 0 ? 'Home / Initial' : `${m.name} — Home`,
        actions: [], isInitial: mi === 0, isComplete: false,
        ...(home?.detail || home?.target ? { description: [home?.target, home?.detail].filter(Boolean).join(' — ') } : {}),
      },
    };
    nodes.push(init);
    y += ROW_H;

    let prev = init;
    let pendingCond = null; // wait folded onto the NEXT edge (v1 convention)
    const link = (from, to, extra = {}) => {
      edges.push({
        id: uid('e'), source: from.id, target: to.id,
        sourceHandle: extra.sourceHandle ?? null,
        targetHandle: to.type === 'decisionNode' ? 'input' : null,
        type: 'routableEdge',
        data: {
          conditionType: pendingCond ? 'custom' : 'trigger',
          label: pendingCond ? `Wait — ${pendingCond}` : '',
          ...(extra.data ?? {}),
        },
      });
      pendingCond = null;
    };

    for (const s of steps) {
      const a = String(s?.action ?? '').trim();
      if (!a || /^(home|repeat)$/i.test(a)) continue;
      if (/^wait$/i.test(a)) {
        pendingCond = [s.target, s.counterpart ? `(${s.counterpart})` : ''].filter(Boolean).join(' ').trim();
        continue;
      }
      if (s && typeof s === 'object' && s.decision) {
        // Decision → the pill; first branch continues the column, second exits right.
        const dn = {
          id: uid('n'), type: 'decisionNode', position: { x: x + 20, y },
          data: {
            decisionType: 'signal', signalName: String(s.decision), signalSource: '',
            signalType: 'condition', exitCount: Math.min((s.branches ?? []).length, 2) || 1,
            exit1Label: s.branches?.[0]?.label ?? 'Pass', exit2Label: s.branches?.[1]?.label ?? 'Fail',
          },
        };
        nodes.push(dn); link(prev, dn); y += ROW_H;
        let branchPrev = dn;
        (s.branches ?? []).forEach((b, bi) => {
          let bx = bi === 0 ? x : x + 300;
          let by = y;
          let p2 = dn;
          for (const bs of (b.steps ?? [])) {
            const op = opOf(bs?.action);
            const dev = findDev(bs?.target, bs?.deviceId);
            const bn = {
              id: uid('n'), type: 'stateNode', position: { x: bx, y: by },
              data: {
                label: [bs?.action, bs?.target].filter(Boolean).join(' '),
                actions: op && dev ? [{ id: uid('a'), deviceId: dev.id, operation: op }] : [],
                isInitial: false, isComplete: false,
              },
            };
            nodes.push(bn);
            edges.push({
              id: uid('e'), source: p2.id, target: bn.id,
              sourceHandle: p2 === dn ? (bi === 0 ? 'exit-pass' : 'exit-fail') : null,
              targetHandle: null, type: 'routableEdge',
              data: p2 === dn
                ? { conditionType: 'trigger', label: '', isDecisionExit: true, exitColor: bi === 0 ? 'pass' : 'fail', outcomeLabel: b.label ?? (bi === 0 ? 'Pass' : 'Fail') }
                : { conditionType: 'trigger', label: '' },
            });
            p2 = bn; by += ROW_H;
          }
          if (bi === 0) { branchPrev = p2; y = by; }
        });
        prev = branchPrev;
        continue;
      }
      const op = opOf(a);
      const dev = findDev(s?.target, s?.deviceId);
      const n = {
        id: uid('n'), type: 'stateNode', position: { x, y },
        data: {
          label: /^signal$/i.test(a)
            ? `Signal ${String(s?.target ?? '').trim()}`
            : [a, s?.target].filter(Boolean).join(' ') + (s?.detail && op === 'ServoMove' ? ` — ${s.detail}` : ''),
          actions: op && dev ? [{
            id: uid('a'), deviceId: dev.id, operation: op,
            ...(op === 'ServoMove' && s?.detail ? { positionName: String(s.detail) } : {}),
          }] : [],
          isInitial: false, isComplete: false,
        },
      };
      nodes.push(n); link(prev, n);
      prev = n; y += ROW_H;
    }

    if (mi === 0) {
      // ONE Cycle Complete terminal (diagram law) on the primary machine.
      const done = {
        id: uid('n'), type: 'stateNode', position: { x, y },
        data: { label: 'Cycle Complete', actions: [], isInitial: false, isComplete: true },
      };
      nodes.push(done); link(prev, done);
    } else if (prev !== init) {
      // Secondary machines loop back to their own home (Repeat).
      link(prev, init);
    }
  });

  return {
    name: stationName, displayName: displayName ?? stationName, stationNumber,
    devices, nodes, edges,
  };
}
