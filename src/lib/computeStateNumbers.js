/**
 * computeStateNumbers.js — Shared utility for computing sequential state numbers.
 *
 * DFS from the initial node, following edges, assigning state numbers at +3 intervals.
 * VisionInspect nodes consume 5 sub-state slots (+12 total).
 * Fault nodes are always 127.
 *
 * Options:
 *   - startAt:      first step number (default 1 main, 100 recovery)
 *   - completeStep: if provided, any node with data.isComplete (OR whose label
 *                   is "Cycle Complete", as a legacy safety net) gets exactly
 *                   this number and is skipped by the sequential counter. Used
 *                   for recovery sequences where "Cycle Complete" is always 124
 *                   (the initialize/recovery-complete step in the PLC).
 *
 * Returns { stateMap: Map<nodeId, number>, visionSubStepsMap: Map<nodeId, number[]> }
 */

// A node is the recovery terminal "Cycle Complete" when either:
//   - it carries the explicit `isComplete: true` flag (preferred / new records)
//   - its label reads "Cycle Complete" (legacy records built before the flag
//     was wired up through the recovery picker — still must snap to step 124)
function isCycleCompleteNode(n) {
  if (n?.data?.isComplete) return true;
  const label = String(n?.data?.label ?? '').trim().toLowerCase();
  return label === 'cycle complete';
}

export function computeStateNumbers(nodes, edges, devices, options = {}) {
  if (!nodes || nodes.length === 0) return { stateMap: new Map(), visionSubStepsMap: new Map() };

  const startAt = options.startAt ?? 1;
  const completeStep = options.completeStep; // e.g. 124 for recovery
  const stateMap = new Map();
  const visionSubStepsMap = new Map();

  // Find initial node
  const initial = nodes.find(n => n.data?.isInitial);
  if (!initial) {
    // Fallback: just number by Y position
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
    let step = startAt;
    for (const n of sorted) {
      stateMap.set(n.id, step);
      step += 3;
    }
    return { stateMap, visionSubStepsMap };
  }

  // DFS from initial node, following edges
  const visited = new Set();
  const ordered = [];

  function dfs(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if (node) ordered.push(node);
    // Sort outgoing edges by target node X position (left-to-right)
    const outEdges = (edges ?? [])
      .filter(e => e.source === nodeId)
      .sort((a, b) => {
        const na = nodes.find(n => n.id === a.target);
        const nb = nodes.find(n => n.id === b.target);
        return (na?.position?.x ?? 0) - (nb?.position?.x ?? 0);
      });
    for (const e of outEdges) {
      dfs(e.target);
    }
  }

  dfs(initial.id);

  // Append any unreachable nodes (sorted by Y position)
  const unreached = nodes
    .filter(n => !visited.has(n.id))
    .sort((a, b) => a.position.y - b.position.y);
  ordered.push(...unreached);

  // Assign state numbers (fault nodes are always 127 — skip in sequence;
  // recovery cycle-complete is always `completeStep` (124) when provided — skip too)
  let currentStep = startAt - 3;
  for (const n of ordered) {
    if (n.data?.isFault) {
      stateMap.set(n.id, 127);
      continue;
    }
    if (completeStep !== undefined && isCycleCompleteNode(n)) {
      stateMap.set(n.id, completeStep);
      continue;
    }
    if (n.data?.isInitial) {
      stateMap.set(n.id, startAt);
      currentStep = startAt;
      continue;
    }

    currentStep += 3;
    // Skip `completeStep` in the sequential counter so a busy recovery flow
    // can't collide with the reserved complete number.
    if (completeStep !== undefined && currentStep === completeStep) currentStep += 3;
    stateMap.set(n.id, currentStep);

    // Check if this node has a VisionSystem Inspect action
    const actions = n.data?.actions ?? [];
    const hasVisionInspect = actions.some(a => {
      const dev = (devices ?? []).find(d => d.id === a.deviceId);
      return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
    });

    if (hasVisionInspect) {
      visionSubStepsMap.set(n.id, [currentStep, currentStep + 3, currentStep + 6, currentStep + 9, currentStep + 12]);
      currentStep += 12; // consumed 4 extra slots (5 total sub-states including PT update)
    }
  }

  return { stateMap, visionSubStepsMap };
}
