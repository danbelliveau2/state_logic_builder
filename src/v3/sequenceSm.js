/**
 * sequenceSm.js — v3: the machine on the sheet ↔ its STATE MACHINE record.
 *
 * ONE SOURCE OF TRUTH (Dan, 2026-09-02): a machine's sequence IS its SM's
 * nodes/edges on the v1 canvas. This module resolves the SM for a sheet
 * machine, creating it on first open and running the ONE-TIME migration of
 * the approved structured steps into canvas nodes/edges. After that the
 * canvas is authoritative (`machineSpec.canvasAuthoritative`), and codegen
 * reads the diagram (the v7 path) — never the structured copy.
 *
 * Linkage: built stations carry `entry.smId` (real SM records). Fresh drafts
 * (no station built yet) get SM records stamped `machineSpec.v3 = { draftId,
 * machineKey }` and a shared `stationId = draft:<draftId>` so the four
 * machines of a station group as ONE station in the tree.
 */

import { useDiagramStore } from '../store/useDiagramStore.js';
import { compileLaneFlow, stepsToModel } from './compileLaneFlow.js';
import { layoutBranchDiagram, applyBranchLayout, estimateNodeWidth } from '../lib/branchLayout.mjs';
import { classifyDeviceRole } from '../lib/deviceTypes.js';

/** SIGNALS / COUNTERS ARE NOT DEVICES (Dan, 2026-09-02): cross-machine
 *  signals live in the SIGNALS panel (v1 state signals / p_ outputs) and the
 *  retry counter is a codegen artifact of the check's retry config — neither
 *  is ever a row in sm.devices. */
export const isRealDevice = (d) => { const r = classifyDeviceRole(d); return r !== 'signal' && r !== 'counter'; };

/** File the compiler's outgoing signals as v1 STATE SIGNALS on the project
 *  (upsert by name for this SM — a redraft re-binds, never duplicates). */
function applyCompiledSignals(store, smId, compiledSignals, nodes) {
  if (!compiledSignals?.length) return;
  const project = store.project;
  const sm = project?.stateMachines?.find((s) => s.id === smId);
  if (!sm) return;
  const existing = project.signals ?? [];
  const next = [...existing];
  for (const sg of compiledSignals) {
    const node = nodes.find((n) => n.id === sg.stateNodeId);
    const rec = {
      name: sg.name, description: sg.description ?? '', type: 'state', axes: [],
      smId, smName: sm.displayName ?? sm.name, stateNodeId: sg.stateNodeId,
      stateName: node?.data?.label ?? sg.stateName ?? '', reachedMode: sg.reachedMode ?? 'in',
    };
    const i = next.findIndex((x) => x.type === 'state' && x.smId === smId && String(x.name).toLowerCase() === sg.name.toLowerCase());
    if (i >= 0) next[i] = { ...next[i], ...rec };
    else next.push({ id: `id_${Math.random().toString(36).slice(2, 10)}`, ...rec });
  }
  useDiagramStore.setState((s) => ({ project: { ...s.project, signals: next } }));
}

/** v3 state-node width (v3.css `.v3-seq .state-node`): wide enough that the
 *  full verb + full device display name always show at zoom 1 (Dan,
 *  2026-09-02: "you don't see the whole word, you don't see the whole
 *  name"). Classic keeps its 240px cap. */
export const V3_STATE_NODE_W = 320;

/** First-open layout on the v1 column law (center-aligned columns, uniform
 *  gap, loop rails) — the same pass the canvas's Re-layout button runs. */
export function lawLayout(nodes, edges) {
  try {
    const layout = layoutBranchDiagram(nodes, edges, {
      getHeight: (n) => (n.type === 'decisionNode' ? 96 : 120),
      getWidth: (n) => (n.type === 'stateNode' ? V3_STATE_NODE_W : estimateNodeWidth(n)),
    });
    if (!layout.changed) return { nodes, edges };
    return applyBranchLayout(nodes, edges, layout);
  } catch (e) {
    console.warn('[v3] law layout skipped:', e);
    return { nodes, edges };
  }
}

/**
 * PHASE B — REDRAFT FROM THE SHEET (Dan, 2026-09-02): recompile a machine's
 * canvas from its approved steps in the v1 grammar (compileLaneFlow), keeping
 * the drawing the engineer had as a dated backup on the record
 * (`machineSpec.v3.redraftBackups`). Clears the measured-layout stamp so the
 * canvas re-runs its one-time measured re-layout on the new nodes.
 * @returns {boolean} true when the SM was redrafted
 */
export function redraftMachineSm({ smId, model = null, steps = null, isPrimary = true, machineName = '' }) {
  const store = useDiagramStore.getState();
  const sm = store.project?.stateMachines?.find((s) => s.id === smId);
  if (!sm) return false;
  // Structured steps carry the group hints; the flow model is the fallback.
  const useModel = (steps?.length ? stepsToModel(steps) : null) ?? model;
  if (!useModel) return false;
  const devices = (sm.devices ?? []).filter(isRealDevice);
  const compiled = compileLaneFlow(useModel, { devices, machineName: machineName || sm.displayName || sm.name, isPrimary });
  const { nodes, edges } = lawLayout(compiled.nodes, compiled.edges);
  const now = new Date().toISOString();
  const prevV3 = sm.machineSpec?.v3 ?? {};
  const backups = [...(prevV3.redraftBackups ?? []), { at: now, nodes: sm.nodes ?? [], edges: sm.edges ?? [] }].slice(-3);
  store.updateStateMachine(smId, {
    devices,
    nodes,
    edges,
    machineSpec: {
      ...(sm.machineSpec ?? {}),
      canvasAuthoritative: true,
      canvasAuthoritativeAt: now,
      v3: { ...prevV3, migratedAt: now, migratedFrom: 'sheet-structured-steps', redraftedAt: now, measuredLayoutAt: undefined, redraftBackups: backups },
    },
  });
  applyCompiledSignals(useDiagramStore.getState(), smId, compiled.signals, nodes);
  return true;
}

const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const PNEUMATIC = new Set(['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator']);

/** Find the SM record that backs this sheet machine, or null. */
export function findMachineSm(project, { smId = null, draftId = null, machineKey = null } = {}) {
  const sms = project?.stateMachines ?? [];
  if (smId) { const hit = sms.find((s) => s.id === smId); if (hit) return hit; }
  if (draftId && machineKey) {
    return sms.find((s) => s.machineSpec?.v3?.draftId === draftId && s.machineSpec?.v3?.machineKey === machineKey) ?? null;
  }
  return null;
}

/** Sheet device rows → SM device records (the sheet's tables WIN). */
function smDevicesFromSheet(sheetDevices, ownedNames) {
  const owned = (ownedNames ?? []).map(nk).filter(Boolean);
  const claims = (row) => {
    if (!owned.length) return true;
    const k = nk(row.displayName ?? row.name);
    return owned.some((o) => o === k || o.includes(k) || k.includes(o));
  };
  return (sheetDevices ?? []).filter((d) => d && d.name && claims(d) && isRealDevice(d)).map((d) => {
    const out = {
      id: d.devId || `id_${Math.random().toString(36).slice(2, 10)}`,
      name: String(d.name).replace(/[^A-Za-z0-9_]/g, ''),
      displayName: d.displayName ?? d.name,
      type: d.type || 'Custom',
    };
    if (PNEUMATIC.has(out.type)) {
      if (d.sensorArrangement) out.sensorArrangement = d.sensorArrangement;
      if (d.homeState) out.homePosition = d.homeState;
      if (d.strokeMm != null) out.strokeMm = d.strokeMm;
      const ext = d.delays?.extendMs; const ret = d.delays?.retractMs;
      if (out.type === 'PneumaticGripper') {
        if (ext != null) out.engageTimerMs = Number(ext);
        if (ret != null) out.disengageTimerMs = Number(ret);
      } else {
        if (ext != null) out.extTimerMs = Number(ext);
        if (ret != null) out.retTimerMs = Number(ret);
      }
    }
    if (out.type === 'ServoAxis' && Array.isArray(d.positions)) {
      out.positions = d.positions.map((p, i) => ({
        id: `pos_${i}`, name: p.name, defaultValue: p.valueMm ?? p.value ?? '',
      }));
    }
    return out;
  });
}

/** True when the SM has never been drawn (nothing but an optional Home). */
function isUndrawn(sm) {
  return (sm?.edges?.length ?? 0) === 0 && (sm?.nodes?.length ?? 0) <= 1;
}

/**
 * Resolve — creating + migrating on first open — the SM for a sheet machine.
 * @param {object} p
 * @param {string|null} p.smId        built-station SM id (entry.smId)
 * @param {string}      p.draftId     the sheet draft id
 * @param {object}      p.entry       the machine entry { key, name, oneLiner, deviceNames }
 * @param {object}      p.model       buildFlowModel(...) output for this machine
 * @param {Array}       p.sheetDevices summary.devices
 * @param {string}      p.stationName
 * @param {number}      p.stationNumber
 * @param {boolean}     p.isPrimary
 * @returns {string} the SM id
 */
export function ensureMachineSm({ smId = null, draftId, entry, model, steps = null, sheetDevices, stationName, stationNumber, isPrimary = true }) {
  const store = useDiagramStore.getState();
  const existing = findMachineSm(store.project, { smId, draftId, machineKey: entry?.key });
  if (existing && (existing.machineSpec?.canvasAuthoritative || !isUndrawn(existing))) {
    if (!existing.machineSpec?.canvasAuthoritative) {
      // Hand-drawn already — the canvas is the truth from here on.
      store.updateStateMachine(existing.id, {
        machineSpec: { ...(existing.machineSpec ?? {}), canvasAuthoritative: true, canvasAuthoritativeAt: new Date().toISOString() },
      });
    }
    return existing.id;
  }

  let id = existing?.id ?? null;
  if (!id) {
    id = store.addStateMachine({
      name: String(entry?.name ?? 'Machine').replace(/[^A-Za-z0-9_]/g, '') || 'Machine',
      stationNumber: Number(stationNumber) || 1,
      description: entry?.oneLiner ?? '',
    });
  }
  const sm = useDiagramStore.getState().project.stateMachines.find((s) => s.id === id);
  const devices = (sm?.devices?.length ? sm.devices.filter(isRealDevice) : smDevicesFromSheet(sheetDevices, entry?.deviceNames));
  const useSteps = steps ?? entry?.sequenceSteps ?? null;
  const compiled = compileLaneFlow((useSteps?.length ? stepsToModel(useSteps) : null) ?? model, { devices, machineName: entry?.name ?? '', isPrimary });
  const { nodes, edges } = lawLayout(compiled.nodes, compiled.edges);
  const now = new Date().toISOString();
  useDiagramStore.getState().updateStateMachine(id, {
    displayName: entry?.name ?? sm?.displayName,
    smName: entry?.name ?? sm?.smName,
    ...(existing ? {} : { stationId: `draft:${draftId}`, stationName: stationName ?? entry?.name }),
    devices,
    nodes,
    edges,
    machineSpec: {
      version: 1,
      ...(sm?.machineSpec ?? {}),
      cascadeState: sm?.machineSpec?.cascadeState ?? { steps: {}, v3: true },
      ...(entry?.oneLiner ? { purpose: entry.oneLiner } : {}),
      canvasAuthoritative: true,
      canvasAuthoritativeAt: now,
      v3: { draftId, machineKey: entry?.key ?? null, migratedAt: now, migratedFrom: 'sheet-structured-steps' },
    },
  });
  applyCompiledSignals(useDiagramStore.getState(), id, compiled.signals, nodes);
  return id;
}
