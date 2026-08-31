/**
 * mechanicalFilter.js — hide controls-domain "furniture" from the
 * Mechanical Diagram view (v2 five-page shell).
 *
 * Dan: the mechanical view is JUST the ME-described sequence — waits,
 * decisions and other controls-domain nodes belong on the Controls Diagram
 * (the compiled code's flowchart), not here. The nodes STAY in the store and
 * in compile/codegen; this filter is a pure render-time view transform, the
 * same way state numbers are hidden by CSS in the mech view.
 *
 * A node is "controls domain" when:
 *   - it's a decisionNode (wait / verify / decide — all controls concepts), or
 *   - it's a stateNode whose EVERY action is a wait-type action (the
 *     describe-first builder emits waits as stateNodes with a `_decision`
 *     pseudo-device action, e.g. "Wait for Next Pick Signal").
 *
 * Hidden nodes are spliced out of the edge graph: each incoming×outgoing
 * edge pair becomes one bridge edge (auto-routed — stored waypoints of the
 * originals are dropped) so the sequence reads continuously. Chains of
 * hidden nodes resolve because splices are applied sequentially.
 *
 * Pure module — no React, no store (lib/ rules).
 */

const WAIT_OPERATIONS = new Set(['Wait', 'WaitSmOutput', 'WaitRefPos', 'WaitSignal']);

/** Is this drawn node a controls-domain node (hidden in the mech view)? */
export function isControlsDomainNode(node) {
  if (!node) return false;
  if (node.type === 'decisionNode') return true;
  if (node.type === 'stateNode') {
    const acts = node.data?.actions ?? [];
    if (acts.length === 0) return false;
    return acts.every(
      (a) =>
        a?.deviceId === '_decision' ||
        a?.nodeMode === 'wait' ||
        WAIT_OPERATIONS.has(a?.operation)
    );
  }
  return false;
}

/**
 * Filter render-ready node/edge arrays for the Mechanical view.
 * Returns the SAME array references when nothing is hidden (no re-render churn).
 */
export function filterMechanicalView(nodes, edges) {
  const hiddenIds = [];
  for (const n of nodes) if (isControlsDomainNode(n)) hiddenIds.push(n.id);
  if (hiddenIds.length === 0) return { nodes, edges };

  const hiddenSet = new Set(hiddenIds);
  const keptNodes = nodes.filter((n) => !hiddenSet.has(n.id));

  let work = edges;
  for (const id of hiddenIds) {
    const inc = work.filter((e) => e.target === id && e.source !== id);
    const out = work.filter((e) => e.source === id && e.target !== id);
    const rest = work.filter((e) => e.source !== id && e.target !== id);
    const bridges = [];
    const seen = new Set();
    for (const i of inc) {
      for (const o of out) {
        if (i.source === o.target) continue; // never synthesize a self-loop
        const key = `${i.source}|${i.sourceHandle ?? ''}|${o.target}|${o.targetHandle ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bridges.push({
          ...i,
          id: `mech-${i.id}-${o.id}`,
          target: o.target,
          targetHandle: o.targetHandle ?? null,
          selected: false,
          // Drop stored waypoints so the bridge auto-routes between its NEW
          // endpoints instead of detouring through the hidden node's shape.
          data: {
            ...(i.data ?? {}),
            waypoints: undefined,
            manualRoute: false,
            _mechBridge: true,
          },
        });
      }
    }
    work = rest.concat(bridges);
  }
  return { nodes: keptNodes, edges: work };
}
