/**
 * StationBanner — the persistent station row hosting DAN'S PILL, centered.
 * Two-pill model (Aug 23): [ Spec Sheet | Diagram ].
 * One pill, click-through pages, the content flips beneath it.
 *
 *   1 Spec Sheet — the station data sheet (embedded) + Jarvis's questions
 *   2 Diagram    — ONE page: the clean sequence by default, an ON-PAGE
 *                  "Controls detail" toggle for the compiled flowchart, the
 *                  sub-bar's Approve + ✨ Generate, and the in-place result
 *                  card. (The Code Generation page is retired — history
 *                  lives in the Jarvis pill's generations grid.)
 *
 * High-contrast per Dan ("really hard to see"): white pill on the light
 * banner, bold labels, solid primary active state. Layout: station identity
 * left, pill dead-center (absolute), star right — the pill never moves
 * between pages.
 */

import { useEffect, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { ensureStationSheetDraft, requestResumeDraft } from '../components/jarvis/createStationDrafts.js';
import { saveStandard } from '../lib/standardsLibrary.js';
import { useHeldBuilds, needsCount } from './stationNeeds.js';
import { stationOfSm, primarySmOf, smLabelOf } from '../lib/stationModel.js';

// Dan's TWO-PILL model (Aug 23): the Code Generation page is GONE — Generate
// lives on the Diagram page's sub-bar next to Approve (review → approve →
// generate, right there); history lives in the Jarvis pill. The Diagram is
// ONE page (sequence view + an on-page "Controls detail" toggle).
const PAGES = [
  { id: 'sheet', label: 'Spec Sheet', title: 'The station data sheet — description, devices, servo values, sensors & timers, IO — and where Jarvis asks his questions' },
  { id: 'diagram', label: 'Diagram', title: 'The station\'s sequence — flip on Controls detail for the compiled code\'s flowchart, Approve, and ✨ Generate' },
];

export function StationBanner() {
  const store = useDiagramStore();
  const sm = useDiagramStore(s =>
    (s.project?.stateMachines ?? []).find(m => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const showNewSmModal = useDiagramStore(s => s.showNewSmModal);
  const isStandard = useDiagramStore(s => s.project?.isStandard === true);
  const standardId = useDiagramStore(s => s.project?.standardId);

  const view = useV2Shell(s => s.view);
  const setView = useV2Shell(s => s.setView);
  const sheetLinkedSmId = useV2Shell(s => s.sheetLinkedSmId);
  const sheetBusy = useV2Shell(s => s.sheetBusy);
  const setSheetLinkedSmId = useV2Shell(s => s.setSheetLinkedSmId);

  const [starFormOpen, setStarFormOpen] = useState(false);
  const [starName, setStarName] = useState('');
  const [starCategory, setStarCategory] = useState('');
  const [starDesc, setStarDesc] = useState('');

  // QUESTION HOME: open asks (value fill-ins + held builds) paint the Spec
  // Sheet pill red — the questions themselves live ON the sheet.
  const compiledBump = useV2Shell(s => s.compiledBump);
  const heldBuilds = useHeldBuilds(sm?.name, compiledBump);
  const openNeeds = sm ? needsCount(sm, heldBuilds) : 0;

  // CASCADE-BUILT STATIONS HAVE NO DIAGRAM PAGE (Dan, 2026-08-30): the
  // diagram lives on the sequence card — the sheet IS the station. If one
  // lands here with the sheet closed, open the sheet instead of showing the
  // orphaned diagram view. Classic stations are untouched.
  const cascadeBuilt = !!sm?.machineSpec?.cascadeState;
  const sheetOpenNow = showNewSmModal && !!sheetLinkedSmId;
  useEffect(() => {
    if (!sm || !cascadeBuilt || sheetOpenNow) return;
    const station0 = stationOfSm(useDiagramStore.getState().project, sm.id);
    const sheetSm0 = primarySmOf(station0) ?? sm;
    const draft = ensureStationSheetDraft(useDiagramStore.getState(), sheetSm0);
    requestResumeDraft(draft.draftId);
    setSheetLinkedSmId(sheetSm0.id);
    store.openNewSmModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascadeBuilt, sheetOpenNow, sm?.id]);

  if (!sm) return null;

  // PROJECT → STATION → STATE MACHINES (Dan, 2026-08-25): the banner names the
  // STATION; when the station holds several SMs, chips say which one is being
  // viewed and switch between them. The SPEC SHEET is ONE per station — it
  // always opens on the station's primary SM and breaks out per SM inside.
  const station = stationOfSm(store.project, sm.id);
  const stationSms = station?.sms ?? [sm];
  const sheetSm = primarySmOf(station) ?? sm;
  const multiSm = stationSms.length > 1;

  const sheetOpen = showNewSmModal && !!sheetLinkedSmId;
  const activePage = sheetOpen ? 'sheet' : 'diagram';



  function goTo(pageId) {
    if (pageId === activePage) return;
    if (pageId === 'sheet') {
      // ONE sheet per STATION — the station's primary SM owns it.
      const draft = ensureStationSheetDraft(useDiagramStore.getState(), sheetSm);
      requestResumeDraft(draft.draftId);
      setSheetLinkedSmId(sheetSm.id);
      store.openNewSmModal();
      return;
    }
    // Leaving the sheet: never silently kill a build/summarize in flight.
    if (sheetOpen && sheetBusy) return;
    if (sheetOpen) store.closeNewSmModal();
    // Diagram returns to whichever sub-view (sequence / controls detail)
    // the user was last in — the on-page toggle owns the flip.
    setView(useV2Shell.getState().lastDiagramView ?? 'mech');
  }

  // "‹ project" crumb → the PROJECT HOME (machine overview + stations grid).
  // Leaving the sheet mid-build is blocked the same way the pill blocks it.
  function goProjectHome() {
    if (sheetOpen && sheetBusy) return;
    if (sheetOpen) store.closeNewSmModal();
    useV2Shell.getState().openProjectHome();
  }

  const projectName = store.project?.name ?? 'Project';

  return (
    <div className="v2-station-banner" data-testid="station-banner">
      <button
        type="button"
        className="v2-banner-crumb"
        data-testid="banner-project-crumb"
        onClick={goProjectHome}
        title={sheetOpen && sheetBusy
          ? 'Wait for the current step to finish — nothing is lost'
          : `Back to the ${projectName} project home — all stations, machine overview`}
        style={sheetOpen && sheetBusy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
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

      {/* WHICH STATE MACHINE — a station can hold several; the chips say which
          one is on the canvas and switch between them. */}
      {multiSm && (
        <span
          className="v2-banner-sms"
          data-testid="banner-sm-chips"
          style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8, flexShrink: 0 }}
        >
          {stationSms.map(m => {
            const on = m.id === sm.id;
            return (
              <button
                key={m.id}
                type="button"
                data-testid={`banner-sm-${m.name}`}
                onClick={() => { if (!on) store.setActiveSm(m.id); }}
                title={on ? `Viewing the ${smLabelOf(m)} state machine` : `Switch to the ${smLabelOf(m)} state machine`}
                style={{
                  fontSize: 11, fontWeight: on ? 700 : 500, padding: '2px 9px',
                  borderRadius: 999, cursor: on ? 'default' : 'pointer',
                  color: on ? '#fff' : '#33506e',
                  background: on ? 'var(--color-primary)' : '#fff',
                  border: `1px solid ${on ? 'var(--color-primary)' : '#c6d4e4'}`,
                }}
              >{smLabelOf(m)}</button>
            );
          })}
        </span>
      )}

      {/* THE five-page pill — dead-center, never moves between pages.
          CASCADE-BUILT STATIONS LOSE THE DIAGRAM PILL (Dan, 2026-08-30):
          the diagram lives ON the sequence card now — the sheet IS the
          station. Classic v1-era stations (no cascade walk recorded) keep
          their Diagram page untouched. */}
      <div className="v2-pagenav" data-testid="page-pill" role="tablist">
        {PAGES.filter(p => !(p.id === 'diagram' && sm?.machineSpec?.cascadeState)).map(p => {
          const active = p.id === activePage;
          const blocked = p.id !== 'sheet' && sheetOpen && sheetBusy;
          const attn = p.id === 'sheet' && openNeeds > 0;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`page-${p.id}`}
              className={`v2-pagenav__btn${active ? ' v2-pagenav__btn--active' : ''}${attn ? ' v2-pagenav__btn--attn' : ''}`}
              title={blocked ? 'Wait for the current step to finish — nothing is lost'
                : attn ? `Jarvis is waiting on ${openNeeds} answer${openNeeds === 1 ? '' : 's'} — they're on the Spec Sheet`
                : p.title}
              aria-disabled={blocked}
              onClick={blocked ? undefined : () => goTo(p.id)}
              style={blocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {p.label}
              {attn && <span className="v2-pagenav__attn-badge" data-testid="sheet-attn-badge">{openNeeds}</span>}
            </button>
          );
        })}
      </div>

      <span className="v2-station-banner__spacer" />

      {/* Standards star — linked indicator, or save-to-library button + form */}
      {isStandard && standardId ? (
        <span
          className="v2-station-banner__linked"
          title="This tab is linked to the Standards Library. All edits are saved automatically."
        >★ Linked</span>
      ) : (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            className="canvas-star-btn"
            title="Save to Standards Library"
            onClick={() => {
              setStarName(sm.name || '');
              setStarDesc('');
              setStarCategory('');
              setStarFormOpen(v => !v);
            }}
          >★</button>
          {starFormOpen && (
            <div className="canvas-star-form" style={{ position: 'absolute', top: '110%', right: 0, left: 'auto', zIndex: 200 }}>
              <div className="canvas-star-form__title">Save to Standards Library</div>
              <input
                className="canvas-star-form__input"
                placeholder="Name"
                value={starName}
                onChange={e => setStarName(e.target.value)}
              />
              <input
                className="canvas-star-form__input"
                placeholder="Category (optional)"
                value={starCategory}
                onChange={e => setStarCategory(e.target.value)}
              />
              <textarea
                className="canvas-star-form__input canvas-star-form__textarea"
                placeholder="Description (optional)"
                value={starDesc}
                onChange={e => setStarDesc(e.target.value)}
                rows={2}
              />
              <div className="canvas-star-form__btns">
                <button
                  className="canvas-star-form__save"
                  disabled={!starName.trim()}
                  onClick={() => {
                    saveStandard({
                      name: starName.trim(),
                      description: starDesc.trim(),
                      category: starCategory.trim(),
                      nodes: sm.nodes ?? [],
                      edges: sm.edges ?? [],
                      devices: sm.devices ?? [],
                    });
                    setStarFormOpen(false);
                  }}
                >Save</button>
                <button className="canvas-star-form__cancel" onClick={() => setStarFormOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
