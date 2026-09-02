/**
 * StationBanner — the persistent station row: "‹ project" crumb + S## + name.
 *
 * 2026-09-02 (one-door law, Dan: "we revamped this — there's no use for this
 * page anymore"): the Spec Sheet|Diagram pill, the SM chips (they switched
 * the CANVAS), the Save-to-Standards star (it saved canvas nodes/edges) and
 * the cascade-redirect effect are DELETED with the classic surfaces. The
 * sheet IS the station; AppV2 + openStation.js own opening it. This row is
 * only the way back to the project home and the station's identity.
 */

import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { stationOfSm } from '../lib/stationModel.js';

export function StationBanner() {
  const store = useDiagramStore();
  const sm = useDiagramStore(s =>
    (s.project?.stateMachines ?? []).find(m => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const showNewSmModal = useDiagramStore(s => s.showNewSmModal);
  const sheetLinkedSmId = useV2Shell(s => s.sheetLinkedSmId);
  const sheetBusy = useV2Shell(s => s.sheetBusy);

  if (!sm) return null;

  const station = stationOfSm(store.project, sm.id);
  const sheetOpen = showNewSmModal && !!sheetLinkedSmId;
  const blocked = sheetOpen && sheetBusy;
  const projectName = store.project?.name ?? 'Project';

  // "‹ project" crumb → the PROJECT HOME (machine overview + stations grid).
  // Leaving the sheet mid-build is blocked — never silently kill a run.
  function goProjectHome() {
    if (blocked) return;
    if (sheetOpen) store.closeNewSmModal();
    useV2Shell.getState().openProjectHome();
  }

  return (
    <div className="v2-station-banner" data-testid="station-banner">
      <button
        type="button"
        className="v2-banner-crumb"
        data-testid="banner-project-crumb"
        onClick={goProjectHome}
        title={blocked
          ? 'Wait for the current step to finish — nothing is lost'
          : `Back to the ${projectName} project home — all stations, machine overview`}
        style={blocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        <span className="v2-banner-crumb__chev">‹</span>
        {projectName}
      </button>
      <span className="v2-station-banner__num">
        S{String(station?.stationNumber ?? sm.stationNumber ?? 0).padStart(2, '0')}
      </span>
      <span
        className="v2-station-banner__name"
        data-testid="banner-station-name"
        title={station?.stationName ?? sm.displayName ?? sm.name}
      >
        {station?.stationName ?? sm.displayName ?? sm.name ?? 'Untitled'}
      </span>
      <span className="v2-station-banner__spacer" />
    </div>
  );
}
