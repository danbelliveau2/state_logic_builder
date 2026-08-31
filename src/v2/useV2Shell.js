/**
 * useV2Shell — tiny v2-only UI store (NOT persisted).
 *
 * `home` — the clean-slate start screen. True when the user closed the last
 * project tab (or explicitly closed out of a project). The main store still
 * holds the last project object in memory, so this flag is what actually
 * gates the shell between "start screen" and "workbench". AppV2 auto-leaves
 * home as soon as a project is opened/created (currentFilename becomes set).
 */

import { create } from 'zustand';

export const useV2Shell = create((set) => ({
  home: false,
  goHome: () => set({ home: true }),
  leaveHome: () => set({ home: false }),

  // ── PROJECT HOME page (Dan, Aug 24: "there needs to be a project home
  // page — the details of that project, overall what's going on for that
  // machine"). When true, the center pane shows ProjectHomePage (stations
  // grid + add-station) instead of the station banner/canvas. Opened by the
  // banner's "‹ project" crumb, when a project opens/switches (AppV2 effect),
  // or the ?page=home deep link. Closed by picking a station anywhere.
  projectHomeOpen: (() => {
    try { return new URLSearchParams(window.location.search).get('page') === 'home'; }
    catch { return false; }
  })(),
  openProjectHome: () => set({ projectHomeOpen: true }),
  closeProjectHome: () => set({ projectHomeOpen: false }),

  // ── Center PAGE — Dan's TWO-PILL model (Aug 23: the Code Generation page
  //    is GONE — Generate lives on the Diagram page's sub-bar; history lives
  //    in the SDC Engineer pill):
  //   'sheet'    — the station data sheet (rides on sheetLinkedSmId below)
  //   'mech'     — Diagram, Sequence view: canvas, NO state numbers, no
  //                controls-domain nodes (waits/decisions filtered), PT visible
  //   'controls' — Diagram, Controls-detail view: the compiled code's
  //                flowchart derived from sm.compiledSequence (read-only) —
  //                switched by the ON-PAGE toggle, not the banner
  // Lives here (not AppV2 local state) so the compile modal can land the
  // user on the controls detail when a compile finishes.
  // Boot page is deep-linkable: /v2.html?page=controls. Legacy ?page=review
  // and ?page=generate links map to the Sequence view.
  view: (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('page');
      return ['mech', 'controls'].includes(p) ? p : 'mech';
    } catch { return 'mech'; }
  })(),
  // Last Diagram sub-view — so the banner's Diagram pill returns you to the
  // sequence/controls view you were last in.
  lastDiagramView: 'mech',
  setView: (view) => set((s) => ({
    view,
    lastDiagramView: view === 'mech' || view === 'controls' ? view : s.lastDiagramView,
  })),

  // ── Compile-sequence modal (SDC ENGINEER v1.1 Build-time compile).
  // compileFor = { smId, corrections } | null. Opened from the Build menu,
  // the Full Controls empty state, and the edit-by-explaining loop.
  compileFor: null,
  openCompile: (smId, corrections = '') => set({ compileFor: { smId, corrections } }),
  closeCompile: () => set({ compileFor: null, compilePct: null }),

  // Live compile progress % (published by CompileSequenceModal while running)
  // so the banner's pipeline button can say "Compiling… n%". null = unknown.
  compilePct: null,
  setCompilePct: (compilePct) => set({ compilePct }),

  // Monotonic counter — bumped when a compile lands so the Diagram page
  // (flowchart + plan panel) re-derives without prop-drilling from the modal.
  compiledBump: 0,
  bumpCompiled: () => set((s) => ({ compiledBump: s.compiledBump + 1 })),

  // ── Generate modal (JarvisGenerateModal) — opened from the Diagram page's
  // sub-bar (✨ Generate next to Approve). The close bump lets the in-place
  // result card on the diagram page refresh the moment a run finishes.
  generateOpen: false,
  generateClosedBump: 0,
  openGenerate: () => set({ generateOpen: true }),
  closeGenerate: () => set((s) => ({ generateOpen: false, generateClosedBump: s.generateClosedBump + 1 })),

  // ── Station banner / embedded spec sheet (Dan: "the Spec Sheet | Diagram
  // toggle lives on a banner that STAYS; what you're looking at is just
  // below it"). sheetLinkedSmId = the built SM whose sheet is open EMBEDDED
  // below the banner (null → any open create page is the full-viewport fresh
  // draft flow). sheetBusy = the sheet is mid-build/summarize, so the banner
  // blocks the flip instead of silently killing the progress view.
  sheetLinkedSmId: null,
  setSheetLinkedSmId: (smId) => set({ sheetLinkedSmId: smId }),
  sheetBusy: false,
  setSheetBusy: (sheetBusy) => set({ sheetBusy }),

  // ── Servo values table (ServoValuesTable) — the station-level editable
  // grid of axis × named position values. Opened from the Code grid's
  // readiness warning, the feature tree, and the flow bar's compile hint.
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
