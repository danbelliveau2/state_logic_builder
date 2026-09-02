/**
 * openStation.js — THE ONE DOOR into a station (Dan, 2026-09-02: "we
 * revamped this — there's no use for this page anymore. I want the v2 app
 * to always show the right things").
 *
 * Law (meKnowledge 2026-08-26, FLOW REPLACEMENT = PREDECESSOR DELETION): the
 * v2 shell has exactly ONE way to look at a station — the cascade STATION
 * SHEET (SectionBar stack, flows, chat pill) — and exactly ONE way to start a
 * station — the sheet's describe-first INPUTS section. The classic canvas
 * page, the Spec Sheet|Diagram pill, Compile/Generate on stations, the
 * summarize-era intake form and the SpecEditorModal are DELETED from the v2
 * bundle (not hidden). The classic canvas lives only at /classic.html.
 *
 * Every station-opening path in v2 (feature tree row, home card, landing
 * effect, device row) calls openStationSheet(); every "+ New" / "Add Station"
 * path calls openFreshStationDraft(). Nothing else may open a station view.
 *
 * Station shapes:
 *   - cascade   — machineSpec.cascadeState present → the sheet, as is.
 *   - legacy    — no cascadeState, but not hand-drawn canvas work (undrawn, or
 *                 a summarize-era sheet with a sourceDescription) → MIGRATED
 *                 on open: cascadeState stamped (empty walk), name/number/
 *                 devices carried over by ensureStationSheetDraft → the sheet.
 *   - classic   — no cascadeState, hand-drawn nodes/edges, no describe-first
 *                 sheet → a read-only "classic station" card pointing at
 *                 /classic.html (isClassicStation). Never the canvas here.
 */

import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { stationOfSm, primarySmOf } from '../lib/stationModel.js';
import { ensureStationSheetDraft, requestResumeDraft, consumeResumeRequest, loadDrafts, draftsKeyFor } from '../components/jarvis/createStationDrafts.js';

/** v3 (2026-09-02): an SM record created by the sheet's SEQUENCE canvas for a
 *  still-unbuilt draft points back at that draft (machineSpec.v3.draftId).
 *  Opening such a station opens THE DRAFT — never a reconstructed twin sheet. */
function v3DraftIdOf(sm, storeState) {
  const id = sm?.machineSpec?.v3?.draftId;
  if (!id) return null;
  try {
    return loadDrafts(draftsKeyFor(storeState)).some(d => d.draftId === id && !d.smId) ? id : null;
  } catch { return null; }
}

/** Hand-drawn v1 canvas work with no describe-first sheet behind it. */
export function isClassicStation(sm) {
  if (!sm) return false;
  if (sm.machineSpec?.cascadeState) return false;
  const drawn = (sm.edges?.length ?? 0) > 0 || (sm.nodes?.length ?? 0) > 1;
  if (!drawn) return false;
  // A summarize-era build carries the ME's original words — it has a sheet
  // to migrate into the cascade. Pure canvas work does not.
  return !String(sm.machineSpec?.sourceDescription ?? '').trim();
}

/** Stamp a legacy-shaped SM into the cascade shape: an EMPTY walk (no step
 *  approved yet), everything else carried over. Idempotent. */
export function migrateSmToCascade(smId) {
  const st = useDiagramStore.getState();
  const sm = (st.project?.stateMachines ?? []).find(s => s.id === smId);
  if (!sm || sm.machineSpec?.cascadeState) return sm ?? null;
  const migrated = {
    ...sm,
    machineSpec: {
      ...(sm.machineSpec ?? {}),
      cascadeState: { steps: {}, migratedFromLegacy: new Date().toISOString() },
    },
  };
  // Direct state write (not an undoable user edit): a one-time shape
  // migration on open; auto-save persists it like any project change.
  useDiagramStore.setState(s => ({
    project: {
      ...s.project,
      stateMachines: (s.project?.stateMachines ?? []).map(m => (m.id === smId ? migrated : m)),
    },
  }));
  return migrated;
}

/**
 * Open a station in the v2 shell. Returns 'sheet' or 'classic'.
 * ONE sheet per STATION — a multi-SM station opens on its primary SM and
 * breaks out per machine inside the sheet.
 */
export function openStationSheet(sm) {
  if (!sm) return null;
  const store = useDiagramStore.getState();
  const shell = useV2Shell.getState();
  if (sm.id !== store.activeSmId) store.setActiveSm(sm.id);
  if (isClassicStation(sm)) {
    // The read-only classic card renders in the center pane (AppV2).
    consumeResumeRequest();
    if (shell.sheetLinkedSmId) shell.setSheetLinkedSmId(null);
    if (useDiagramStore.getState().showNewSmModal) useDiagramStore.getState().closeNewSmModal();
    shell.closeProjectHome();
    return 'classic';
  }
  const v3Draft = v3DraftIdOf(sm, useDiagramStore.getState());
  if (v3Draft) {
    // The station's machines live on the (unbuilt) draft's sheet — resume it
    // as the full-viewport sheet, exactly like Continue on the home card.
    consumeResumeRequest();
    requestResumeDraft(v3Draft);
    if (shell.sheetLinkedSmId) shell.setSheetLinkedSmId(null);
    if (!useDiagramStore.getState().showNewSmModal) useDiagramStore.getState().openNewSmModal();
    shell.closeProjectHome();
    return 'sheet';
  }
  const station = stationOfSm(useDiagramStore.getState().project, sm.id);
  let sheetSm = primarySmOf(station) ?? sm;
  if (!sheetSm.machineSpec?.cascadeState) sheetSm = migrateSmToCascade(sheetSm.id) ?? sheetSm;
  const draft = ensureStationSheetDraft(useDiagramStore.getState(), sheetSm);
  requestResumeDraft(draft.draftId);
  shell.setSheetLinkedSmId(sheetSm.id);
  useDiagramStore.getState().openNewSmModal();
  shell.closeProjectHome();
  return 'sheet';
}

/**
 * "+ New" / "Add Station": the describe-first sheet, fresh draft, full
 * viewport — over the PROJECT HOME (so ‹ Back lands on the home, never on a
 * half-closed station). Works from anywhere, including from inside another
 * station's open sheet (the old call was a no-op there: showNewSmModal was
 * already true).
 */
export function openFreshStationDraft() {
  const store = useDiagramStore.getState();
  const shell = useV2Shell.getState();
  consumeResumeRequest(); // never resume a linked sheet into the fresh page
  shell.openProjectHome();
  if (shell.sheetLinkedSmId) shell.setSheetLinkedSmId(null);
  if (store.showNewSmModal) store.closeNewSmModal();
  // Next tick: the embedded sheet unmounts first, then the fresh page mounts
  // (a same-tick flip would keep CreateStationPage's component state alive).
  setTimeout(() => {
    const s = useDiagramStore.getState();
    if (!s.showNewSmModal) s.openNewSmModal();
  }, 0);
}
