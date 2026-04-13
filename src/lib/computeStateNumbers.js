/**
 * computeStateNumbers.js — Shared utility for computing sequential state numbers.
 *
 * DFS from the initial node, following edges, assigning state numbers at +3 intervals.
 * VisionInspect nodes consume 5 sub-state slots (+12 total).
 * Fault nodes are always 127.
 *
 * Returns { stateMap: Map<nodeId, number>, visionSubStepsMap: Map<nodeId, number[]> }
 */

export function computeStateNumbers(nodes, edges, devices) {
  if (!nodes || nodes.length === 0) return { stateMap: new Map(), visionSubStepsMap: new Map() };

  const stateMap = new Map();
  const visionSubStepsMap = new Map();

  // Find initial node
  const initial = nodes.find(n => n.data?.isInitial);
  if (!initial) {
    // Fallback: just number by Y position
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
    let step = 1;
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

  // Assign state numbers (fault nodes are always 127 — skip in sequence)
  let currentStep = -2;
  for (const n of ordered) {
    if (n.data?.isFault) {
      stateMap.set(n.id, 127);
      continue;
    }
    if (n.data?.isInitial) {
      stateMap.set(n.id, 1);
      currentStep = 1;
      continue;
    }

    currentStep += 3;
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
