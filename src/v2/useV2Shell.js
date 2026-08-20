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

  // ── Center view: 'mechanical' (React Flow canvas) | 'controls' (compiled
  // sequence). Lives here (not AppV2 local state) so the Build menu can land
  // the user on Full Controls after a compile finishes.
  view: 'mechanical',
  setView: (view) => set({ view }),

  // ── Compile-sequence modal (JARVIS v1.1 Build-time compile).
  // compileFor = { smId, corrections } | null. Opened from the Build menu,
  // the Full Controls empty state, and the edit-by-explaining loop.
  compileFor: null,
  openCompile: (smId, corrections = '') => set({ compileFor: { smId, corrections } }),
  closeCompile: () => set({ compileFor: null }),

  // Monotonic counter — bumped when a compile lands so CompiledControlsView
  // refetches without prop-drilling from the modal.
  compiledBump: 0,
  bumpCompiled: () => set((s) => ({ compiledBump: s.compiledBump + 1 })),
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
