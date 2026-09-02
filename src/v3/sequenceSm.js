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
import { compileLaneFlow } from './compileLaneFlow.js';
import { layoutBranchDiagram, applyBranchLayout } from '../lib/branchLayout.mjs';

/** First-open layout on the v1 column law (center-aligned columns, uniform
 *  gap, loop rails) — the same pass the canvas's Re-layout button runs. */
function lawLayout(nodes, edges) {
  try {
    const layout = layoutBranchDiagram(nodes, edges, {
      getHeight: (n) => (n.type === 'decisionNode' ? 96 : 120),
    });
    if (!layout.changed) return { nodes, edges };
    return applyBranchLayout(nodes, edges, layout);
  } catch (e) {
    console.warn('[v3] law layout skipped:', e);
    return { nodes, edges };
  }
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
  return (sheetDevices ?? []).filter((d) => d && d.name && claims(d)).map((d) => {
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
export function ensureMachineSm({ smId = null, draftId, entry, model, sheetDevices, stationName, stationNumber, isPrimary = true }) {
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
  const devices = (sm?.devices?.length ? sm.devices : smDevicesFromSheet(sheetDevices, entry?.deviceNames));
  const compiled = compileLaneFlow(model, { devices, machineName: entry?.name ?? '', isPrimary });
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
  return id;
}
