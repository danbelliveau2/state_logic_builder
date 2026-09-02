/**
 * useV2Shell — tiny v2-only UI store (NOT persisted).
 *
 * `home` — the clean-slate start screen. True when the user closed the last
 * project tab (or explicitly closed out of a project). The main store still
 * holds the last project object in memory, so this flag is what actually
 * gates the shell between "start screen" and "workbench". AppV2 auto-leaves
 * home as soon as a project is opened/created (currentFilename becomes set).
 *
 * (2026-09-02, one-door law: the Diagram page state — view / lastDiagramView,
 *  the compile modal, the Generate modal — is DELETED with the classic
 *  surfaces. The station sheet is the only station view; see openStation.js.)
 */

import { create } from 'zustand';

export const useV2Shell = create((set) => ({
  home: false,
  goHome: () => set({ home: true }),
  leaveHome: () => set({ home: false }),

  // ── PROJECT HOME page (Dan, Aug 24: "there needs to be a project home
  // page — the details of that project, overall what's going on for that
  // machine"). When true, the center pane shows ProjectHomePage (stations
  // grid + add-station) instead of the station banner/sheet. Opened by the
  // banner's "‹ project" crumb, when a project opens/switches (AppV2 effect),
  // or the ?page=home deep link. Closed by picking a station anywhere.
  projectHomeOpen: (() => {
    try { return new URLSearchParams(window.location.search).get('page') === 'home'; }
    catch { return false; }
  })(),
  openProjectHome: () => set({ projectHomeOpen: true }),
  closeProjectHome: () => set({ projectHomeOpen: false }),

  // ── Station sheet linkage. sheetLinkedSmId = the built SM whose sheet is
  // open EMBEDDED below the banner (null → any open create page is the
  // full-viewport fresh draft flow). sheetBusy = the sheet is mid-build, so
  // navigation blocks instead of silently killing the progress view.
  sheetLinkedSmId: null,
  setSheetLinkedSmId: (smId) => set({ sheetLinkedSmId: smId }),
  sheetBusy: false,
  setSheetBusy: (sheetBusy) => set({ sheetBusy }),

  // ── Servo values table (ServoValuesTable) — the station-level editable
  // grid of axis × named position values. Opened from the feature tree and
  // the sheet's value asks.
  servoTableFor: null, // smId | null
  openServoTable: (smId) => set({ servoTableFor: smId }),
  closeServoTable: () => set({ servoTableFor: null }),
}));

/**
 * Close out of the current project entirely → clean slate.
 * Saves the current project first (best-effort), drops all tabs, clears the
 * current-file pointer so nothing re-renders a ghost project, then flips the
 * shell to the start screen.
 */
export async function closeAllProjectsToHome(useDiagramStore) {
  const s = useDiagramStore.getState();
  if (s.serverAvailable && s.currentFilename && !s.project?.isStandard) {
    try { await s.saveCurrentProject(); } catch (e) { console.warn('Save before close failed:', e.message); }
  }
  useDiagramStore.setState({
    openTabs: [],
    activeTabId: null,
    currentFilename: null,
    activeSmId: null,
    selectedNodeId: null,
    selectedEdgeId: null,
    showNewSmModal: false,
  });
  useV2Shell.getState().goHome();
}
