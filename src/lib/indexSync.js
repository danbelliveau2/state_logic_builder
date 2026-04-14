/**
 * Start Condition — controls when a station's sequence begins relative to the dial index.
 *
 * Applied to the home/initial state node of each SM.
 * L5X generator uses this to auto-emit (or skip) index-related gating
 * on the home → first-process-state transition.
 *
 * Values:
 *   'afterIndex'  — wait for index complete before running (default for most stations)
 *   'midIndex'    — start during index at a specified point (angle, encoder count, or time)
 *   'beforeIndex' — run immediately on cycle start, no index wait (load/feed/staging)
 *
 * Only applies to indexing/dial machines. Inline machines ignore this setting.
 */

export const START_CONDITIONS = [
  {
    value: 'afterIndex',  label: 'After Index',  short: 'After',
    color: '#1574c4', bg: 'rgba(21,116,196,0.12)',  border: '#1574c4',
    desc: 'Wait for the dial to finish indexing before running this station.',
  },
  {
    value: 'midIndex',    label: 'Mid Index',    short: 'Mid',
    color: '#aacee8', bg: 'rgba(170,206,232,0.2)',  border: '#7bb3d4',
    desc: 'Start during index at a specified point (angle or encoder position).',
  },
  {
    value: 'independent', label: 'Independent', short: 'Independent',
    color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: '#64748b',
    desc: 'Not tied to index — runs on its own timing. Used by feeders, heaters, auxiliary processes.',
  },
];

export function getDefaultIndexSync(stationType) {
  switch (stationType) {
    case 'load':
    case 'feed':
      return 'independent';
    default:
      return 'afterIndex';
  }
}

export function getStartConditionMeta(value) {
  return START_CONDITIONS.find(m => m.value === value) ?? START_CONDITIONS[0];
}

/**
 * Resolve the effective index-sync mode for a home node:
 *   1. Explicit data.indexSync if set
 *   2. Default based on station type
 */
export function resolveIndexSync(homeNode, sm, machineConfig) {
  const explicit = homeNode?.data?.indexSync;
  if (explicit) return explicit;
  const stationType = getSmStationType(sm, machineConfig);
  return getDefaultIndexSync(stationType);
}

// Local copy of getSmStationType (mirror of entryRules.js) to avoid coupling.
function getSmStationType(sm, machineConfig) {
  if (!sm) return null;
  const stations = machineConfig?.stations ?? [];
  const byId = stations.find(st => (st.smIds ?? []).includes(sm.id));
  if (byId?.type) return byId.type;
  const byNum = stations.find(st => st.number === sm.stationNumber);
  if (byNum?.type) return byNum.type;
  const n = (sm.displayName ?? sm.name ?? '').toLowerCase();
  if (/unload/.test(n)) return 'unload';
  if (/reject/.test(n)) return 'reject';
  if (/load/.test(n))   return 'load';
  if (/verify|inspect|check|test/.test(n)) return 'verify';
  if (/index|dial/.test(n))  return 'indexer';
  if (/feed/.test(n))   return 'feed';
  if (/robot/.test(n))  return 'robot';
  if (/process/.test(n)) return 'process';
  return null;
}

/**
 * True if the home node is followed (directly) by a user-drawn IndexComplete
 * wait-on decision node. When that's the case, the user has made the index wait
 * explicit in the diagram — the auto-wait and the badge are redundant, so we
 * mark the index-sync control as overridden.
 */
export function isIndexSyncOverridden(homeNodeId, sm) {
  if (!homeNodeId || !sm) return false;
  const outEdges = (sm.edges ?? []).filter(e => e.source === homeNodeId);
  if (outEdges.length === 0) return false;
  const firstTarget = outEdges[0].target;
  const targetNode = (sm.nodes ?? []).find(n => n.id === firstTarget);
  if (targetNode?.type !== 'decisionNode') return false;
  // Only wait-on-signal decisions (not branching pass/fail) count as explicit
  // index waits. Branching decisions are handled by the Entry Rule override.
  if ((targetNode.data?.exitCount ?? 1) !== 1) return false;
  const name = (targetNode.data?.signalName ?? '').toLowerCase();
  const src  = (targetNode.data?.signalSource ?? '').toLowerCase();
  return /index/.test(name) || /index/.test(src);
}
