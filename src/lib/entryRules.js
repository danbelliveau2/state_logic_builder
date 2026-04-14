/**
 * Entry Rule — gates whether a station's sequence runs based on part tracking.
 *
 * Applied to the home/initial state node of each SM.
 * L5X generator emits the corresponding transition-gating rungs in R02.
 *
 * Values:
 *   'ifGood'   — run only if no upstream reject (default for most stations)
 *   'ifReject' — run only if part is already rejected (reject chute, etc.)
 *   'always'   — run every cycle regardless (load, indexer, feed)
 *   'custom'   — user-defined condition (not yet implemented, falls back to ifGood)
 *
 * If the home node's outgoing edge targets a DecisionNode, that decision node
 * takes precedence — the entry rule is treated as overridden.
 */

export const ENTRY_RULES = [
  {
    value: 'ifGood',   label: 'If Good Part', short: 'Good',
    color: '#5a9a48', bg: 'rgba(90,154,72,0.12)',  border: '#5a9a48',
    desc: 'Run this station only if the part is good. If rejected → skip straight to Cycle Complete.',
  },
  {
    value: 'ifReject', label: 'If Rejected',  short: 'Reject',
    color: '#dc2626', bg: 'rgba(220,38,38,0.12)',  border: '#dc2626',
    desc: 'Run this station only if the part is already rejected. If good → skip straight to Cycle Complete.',
  },
  {
    value: 'always',   label: 'Always',       short: 'Always',
    color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: '#64748b',
    desc: 'Run this station every cycle, regardless of part-tracking status.',
  },
];

export function getDefaultEntryRule(stationType) {
  switch (stationType) {
    case 'load':
    case 'indexer':
    case 'empty':
    case 'feed':
      return 'always';
    case 'reject':
      return 'ifReject';
    default:
      return 'ifGood';
  }
}

export function getEntryRuleMeta(value) {
  return ENTRY_RULES.find(r => r.value === value) ?? ENTRY_RULES[0];
}

/**
 * Derive station type for an SM via machineConfig lookup with name-pattern fallback.
 * Mirrors Toolbar.jsx::getSmStationType — kept local to avoid a component→lib dep.
 */
export function getSmStationType(sm, machineConfig) {
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
 * Resolve the effective entry rule for a home node:
 *   1. Explicit data.entryRule if set
 *   2. Default based on station type
 */
export function resolveEntryRule(homeNode, sm, machineConfig) {
  const explicit = homeNode?.data?.entryRule;
  if (explicit) return explicit;
  const stationType = getSmStationType(sm, machineConfig);
  return getDefaultEntryRule(stationType);
}

/**
 * Detect if the home node's first outgoing edge targets a BRANCHING decision node.
 * Only 2-exit decisions (real Pass/Fail branching) override the entry rule — a
 * single-exit "wait-on" decision is just a gate and doesn't make a part-tracking
 * choice, so the entry rule still applies.
 */
export function isEntryRuleOverridden(homeNodeId, sm) {
  if (!homeNodeId || !sm) return false;
  const outEdges = (sm.edges ?? []).filter(e => e.source === homeNodeId);
  if (outEdges.length === 0) return false;
  const firstTarget = outEdges[0].target;
  const targetNode = (sm.nodes ?? []).find(n => n.id === firstTarget);
  if (targetNode?.type !== 'decisionNode') return false;
  return (targetNode.data?.exitCount ?? 1) === 2;
}
