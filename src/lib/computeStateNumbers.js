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

  // Bypass/detour detection helper.
  // Returns true if there is a forward path from `fromId` to `toId` within
  // maxDepth hops. Used to detect the "skip branch" pattern where one exit of a
  // decision node is a short detour that rejoins the other exit's destination:
  //
  //   Decision ──On──► [detour node] ──► [merge node]
  //            └─Off──────────────────► [merge node]
  //
  // In this pattern canReachForward(detour, merge) = true but
  // canReachForward(merge, detour) = false, so the detour is visited first
  // and gets the lower state number — matching the left-to-right DFS intent.
  function canReachForward(fromId, toId, maxDepth = 15) {
    if (fromId === toId) return false;
    const queue = [fromId];
    const seen = new Set([fromId]);
    for (let depth = 0; depth < maxDepth && queue.length > 0; depth++) {
      const next = [];
      for (const id of queue) {
        const outs = (edges ?? []).filter(e => e.source === id);
        for (const e of outs) {
          if (e.target === toId) return true;
          if (!seen.has(e.target)) {
            seen.add(e.target);
            next.push(e.target);
          }
        }
      }
      queue.length = 0;
      queue.push(...next);
    }
    return false;
  }

  function dfs(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if (node) ordered.push(node);

    // Sort outgoing edges — detour branches before skip/direct branches, then
    // left-to-right by target X as the tie-breaker.
    //
    // Detour detection: if target A can reach target B (but not vice versa),
    // A is a detour to B — visit A first so detour states get lower numbers.
    // Only applies when both targets are unvisited (avoids re-sorting back-edges).
    const outEdges = (edges ?? [])
      .filter(e => e.source === nodeId)
      .sort((a, b) => {
        const na = nodes.find(n => n.id === a.target);
        const nb = nodes.find(n => n.id === b.target);
        if (!visited.has(a.target) && !visited.has(b.target)) {
          const aReachesB = canReachForward(a.target, b.target);
          const bReachesA = canReachForward(b.target, a.target);
          if (aReachesB && !bReachesA) return -1; // A is detour → visit first
          if (bReachesA && !aReachesB) return 1;  // B is detour → visit first
        }
        // Default: left-to-right by target X position
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

    // Check if this node has a VisionSystem Inspect action.
    //
    // Two recognition paths:
    //   1. Legacy v1 — `operation === 'VisionInspect'` on a VisionSystem device
    //   2. v2 vision-pair — pickerV2 action with grammarRowId='vision' AND a
    //      paired Decision row. The trigger half carries `pickerConfig.visionPair`
    //      so this lets a vision pair node consume the same 4-sub-state slot as
    //      the legacy node (Trigger / WaitBusy / WaitResult / Branch + PT update).
    //
    // Either match expands the node to 5 sub-state numbers and bumps the
    // sequential counter by 12 so the NEXT state lands at N+15 (matching SDC's
    // +3-per-state convention applied across 5 slots).
    const actions = n.data?.actions ?? [];
    const hasVisionInspect = actions.some(a => {
      // v1 detection
      const dev = (devices ?? []).find(d => d.id === a.deviceId);
      if (dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect')) return true;
      // v2 detection — vision pair (Trigger + Decision rows)
      if (a.pickerV2 && a.pickerConfig?.grammarRowId === 'vision' && a.pickerConfig?.visionPair) return true;
      return false;
    });

    if (hasVisionInspect) {
      visionSubStepsMap.set(n.id, [currentStep, currentStep + 3, currentStep + 6, currentStep + 9, currentStep + 12]);
      currentStep += 12; // consumed 4 extra slots (5 total sub-states including PT update)
    }
  }

  return { stateMap, visionSubStepsMap };
}
