/**
 * ProjectHomePage — the PROJECT HOME (Dan, Aug 24: "Where do I add another
 * station? There needs to be a project home page — the details of that
 * project, overall what's going on for that machine — and then you go into
 * the spec sheets for the individual stations.")
 *
 * ONE compact screen, center pane only (the StationsPanel tree stays on the
 * left for quick switching — this page is the overview, not a replacement):
 *
 *   ┌─ project name (click to rename) · #job (editable) ─────────────┐
 *   │  machine summary line (stations · servos · sensors · IO)       │
 *   │  machine notes (persist on the project)                        │
 *   │  STATIONS grid — one card per station:                         │
 *   │    S## badge · name · pipeline glance (Described → Diagrammed  │
 *   │    → Compiled → Generated w/ last build label + score) · red   │
 *   │    blockers badge · click → that station's Spec Sheet          │
 *   │  + Add Station card → the describe-first Create Station flow   │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Entry points: the "‹ project" crumb on the StationBanner, landing view
 * when a project opens (AppV2 effect), deep link /v2.html?page=home.
 *
 * Structured for growth: when multi-station generation matures this page
 * grows scope controls — keep the header / notes / grid sections separable.
 */

import { useEffect, useMemo, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useV2Shell } from './useV2Shell.js';
import { computeMachineTotals } from '../lib/machineTotals.js';
import { ensureStationSheetDraft, requestResumeDraft, draftsKeyFor, loadDrafts, onDraftsChanged, draftLabel, timeAgo } from '../components/jarvis/createStationDrafts.js';
import { draftCascadeStepNote, signalPairsOf } from '../components/jarvis/cascadeModel.js';
import { heldBuildsOf, needsCount } from './stationNeeds.js';
import { buildLabel } from './buildMeta.js';
import { fmtET, fmtETFull } from './fmtTime.js';
import { smLabelOf } from '../lib/stationModel.js';
import './projectHome.css';

// ── Pipeline glance (per-station stage logic — same signals the tree and
//    compiledSequence helpers use: spec → nodes → compiledSequence → build) ──

function stationStages(sm, latestBuild) {
  return [
    { id: 'described', label: 'Described', done: !!sm.machineSpec },
    { id: 'diagrammed', label: 'Diagrammed', done: (sm.nodes ?? []).length > 0 },
    {
      id: 'compiled',
      label: sm.compiledSequence?.approved ? 'Compiled ✓ approved' : 'Compiled',
      done: !!sm.compiledSequence,
    },
    { id: 'generated', label: 'Generated', done: !!latestBuild },
  ];
}

/** One-line plain-English status: the first thing the station still needs. */
function stageCaption(stages) {
  const next = stages.find(s => !s.done);
  if (!next) return 'Code generated';
  return {
    described: 'Needs a description',
    diagrammed: 'Needs a diagram',
    compiled: 'Ready to compile',
    generated: 'Ready to generate',
  }[next.id];
}

// Score is out of 100: ≥70 green, ≥40 amber, <40 red.
function scoreColor(score) {
  if (score == null) return 'var(--color-text-light)';
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return '#a07c14';
  return 'var(--color-danger)';
}

// ── Header: editable name + job number + summary line ──────────────────────

function ProjectHeader({ project }) {
  const serverAvailable = useDiagramStore(s => s.serverAvailable);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [jobDraft, setJobDraft] = useState(project?.jobNumber ?? '');
  useEffect(() => { setJobDraft(project?.jobNumber ?? ''); }, [project?.jobNumber]);

  async function commitName() {
    setEditingName(false);
    const next = nameDraft.trim();
    if (!next || next === project?.name) return;
    const s = useDiagramStore.getState();
    if (s.serverAvailable && s.currentFilename && !s.project?.isStandard) {
      // renameProject handles the filename move + save.
      await s.renameProject(s.currentFilename, next);
    } else {
      useDiagramStore.setState(st => ({ project: { ...st.project, name: next } }));
    }
  }

  function commitJob() {
    const next = jobDraft.trim();
    if (next === (project?.jobNumber ?? '')) return;
    useDiagramStore.setState(st => ({ project: { ...st.project, jobNumber: next } }));
  }

  return (
    <div className="v2-phome__head">
      {editingName ? (
        <input
          className="v2-phome__name-input"
          data-testid="home-project-name-input"
          value={nameDraft}
          autoFocus
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') setEditingName(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="v2-phome__name"
          data-testid="home-project-name"
          title={serverAvailable ? 'Click to rename the project' : 'Project name (server offline — rename unavailable)'}
          onClick={() => { setNameDraft(project?.name ?? ''); setEditingName(true); }}
        >
          {project?.name ?? 'Untitled'}
          <span className="v2-phome__name-pen">✎</span>
        </button>
      )}
      <span className="v2-phome__job">
        <span className="v2-phome__job-hash">#</span>
        <input
          className="v2-phome__job-input"
          data-testid="home-project-job"
          placeholder="job #"
          value={jobDraft}
          onChange={e => setJobDraft(e.target.value)}
          onBlur={commitJob}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          title="Job number — saves with the project"
        />
      </span>
    </div>
  );
}

// ── One station card ────────────────────────────────────────────────────────

function StationCard({ sm, latestBuild, blockers, onOpen }) {
  const stages = stationStages(sm, latestBuild);
  const caption = stageCaption(stages);
  const score = latestBuild?.score;
  const failed = latestBuild?.validationOk === false;
  return (
    <button
      type="button"
      className="v2-phome__card"
      data-testid={`home-station-card-${sm.name}`}
      onClick={onOpen}
      title={`Open the ${sm.displayName ?? sm.name} Spec Sheet`}
    >
      <div className="v2-phome__card-top">
        <span className="v2-phome__snum">S{String(sm.stationNumber ?? 0).padStart(2, '0')}</span>
        {/* PROJECT → STATION → STATE MACHINES: a card is one state machine, so
            it names its STATION first when the station holds several. */}
        <span className="v2-phome__sname">
          {sm.stationName ? `${sm.stationName} · ${smLabelOf(sm)}` : (sm.displayName ?? sm.name ?? 'Untitled')}
        </span>
        {blockers > 0 && (
          <span
            className="v2-phome__blockers"
            data-testid={`home-blockers-${sm.name}`}
            title={`${blockers} open question${blockers === 1 ? '' : 's'} blocking code generation — they're on the Spec Sheet`}
          >{blockers}</span>
        )}
      </div>
      {/* AT-A-GLANCE NUMBERS (Dan, 2026-08-31): state machines + devices by
          family — one quiet line, cards stay clean. */}
      {(() => {
        const smCount = (sm.machineSpec?.smSplit?.length ?? 0) || 1;
        const devs = sm.devices ?? [];
        const fam = { servo: 0, pneumatic: 0, sensor: 0, other: 0 };
        for (const d of devs) {
          const t = String(d.type ?? '');
          if (/servo|axis/i.test(t)) fam.servo++;
          else if (/pneumatic|gripper|cylinder|slide|escapement/i.test(t)) fam.pneumatic++;
          else if (/sensor/i.test(t)) fam.sensor++;
          else fam.other++;
        }
        const bits = [
          `${smCount} state machine${smCount === 1 ? '' : 's'}`,
          fam.servo > 0 && `${fam.servo} servo${fam.servo === 1 ? '' : 's'}`,
          fam.pneumatic > 0 && `${fam.pneumatic} pneumatic${fam.pneumatic === 1 ? '' : 's'}`,
          fam.sensor > 0 && `${fam.sensor} sensor${fam.sensor === 1 ? '' : 's'}`,
          fam.other > 0 && `${fam.other} other`,
        ].filter(Boolean);
        return (
          <div data-testid={`home-station-stats-${sm.name}`} style={{ fontSize: 10.5, color: 'var(--color-text-muted)', margin: '2px 0 4px' }}>
            {bits.join(' · ')}
          </div>
        );
      })()}
      <div className="v2-phome__stages">
        {stages.map(st => (
          <span
            key={st.id}
            className={`v2-phome__stage${st.done ? ' v2-phome__stage--done' : ''}`}
            title={st.label}
          >
            {st.done ? '✓ ' : ''}{st.label.split(' ')[0]}
          </span>
        ))}
      </div>
      <div className="v2-phome__card-foot">
        <span className="v2-phome__caption">{caption}</span>
        {latestBuild && (
          <span
            className="v2-phome__build"
            style={{ color: failed ? 'var(--color-danger)' : 'var(--color-primary)' }}
            title={`Last build ${fmtETFull(latestBuild.at)}${failed ? ' — validation FAILED' : ''}`}
          >
            {failed ? '✗ ' : ''}{buildLabel(latestBuild)} · {fmtET(latestBuild.at)}
            {score != null && (
              <b style={{ color: scoreColor(score), marginLeft: 5 }}>{score} / 100</b>
            )}
          </span>
        )}
      </div>
    </button>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function ProjectHomePage() {
  const project = useDiagramStore(s => s.project);

  // Machine notes — persist on the project (auto-save picks it up). Local
  // draft while typing, committed on blur so the 2s auto-save isn't spammed.
  const [notes, setNotes] = useState(project?.notes ?? '');
  useEffect(() => { setNotes(project?.notes ?? ''); }, [project?.notes]);
  function commitNotes() {
    if ((project?.notes ?? '') === notes) return;
    useDiagramStore.setState(st => ({ project: { ...st.project, notes } }));
  }

  // ONE generations fetch for the whole grid (latest build + held-build
  // blockers per station) — not a poll per card.
  const [builds, setBuilds] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/jarvis/generations')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (alive && d) setBuilds(d.builds ?? []); })
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [project?.name]);

  const sms = useMemo(
    () => [...(project?.stateMachines ?? [])]
      .sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999)),
    [project?.stateMachines]
  );
  const totals = useMemo(() => computeMachineTotals(project), [project]);

  const perStation = useMemo(() => {
    const map = new Map();
    for (const sm of sms) {
      const rows = builds
        .filter(b => b && b.sm === sm.name && (!project?.name || !b.project || b.project === project.name))
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      const held = heldBuildsOf(builds.filter(b => !project?.name || !b.project || b.project === project.name), sm.name);
      map.set(sm.id, { latest: rows[0] ?? null, blockers: needsCount(sm, held) });
    }
    return map;
  }, [sms, builds, project?.name]);

  const totalBlockers = [...perStation.values()].reduce((n, v) => n + v.blockers, 0);

  // DRAFT-AWARE CONTINUATION (Dan, 2026-08-26: "as soon as you start editing,
  // it exists — you select it and continue; you never hit New to get back
  // into something"). Unfinished drafts (incl. drafts whose station was
  // deleted) surface HERE as the primary action.
  const [drafts, setDrafts] = useState([]);
  useEffect(() => {
    const key = draftsKeyFor(useDiagramStore.getState());
    const load = () => setDrafts(loadDrafts(key).filter(d =>
      !d.smId || !(useDiagramStore.getState().project?.stateMachines ?? []).some(s => s.id === d.smId)));
    load();
    return onDraftsChanged(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.name]);
  function continueDraft(d) {
    requestResumeDraft(d.draftId);
    useDiagramStore.getState().openNewSmModal(); // full-viewport create page resumes the cascade
  }

  function openStationSheet(sm) {
    const store = useDiagramStore.getState();
    if (sm.id !== store.activeSmId) store.setActiveSm(sm.id);
    const draft = ensureStationSheetDraft(useDiagramStore.getState(), sm);
    requestResumeDraft(draft.draftId);
    useV2Shell.getState().setSheetLinkedSmId(sm.id);
    useDiagramStore.getState().openNewSmModal();
    useV2Shell.getState().closeProjectHome();
  }

  function addStation() {
    // The describe-first Create Station flow — full-viewport page. Home stays
    // open underneath: cancel returns here; a created station switches
    // activeSmId, which lands the user on the new station (AppV2 effect).
    useDiagramStore.getState().openNewSmModal();
  }

  if (!project) return null;

  // THE CHAT IS REACHABLE EVERYWHERE (Dan, 2026-08-31): the docked pill on
  // the homepage opens the newest draft's sheet with the chat panel open.
  // Hidden while a full-viewport surface (the sheet) overlays — that surface
  // carries its own pill.
  const surfaceUp = useDiagramStore(s => s.showNewSmModal);
  const chatTarget = drafts[0] ?? null;
  const chatPill = chatTarget && !surfaceUp && (
    <button
      type="button"
      data-testid="chat-pill"
      onClick={() => {
        try { localStorage.setItem('jarvis.chatPanelOpen', '1'); } catch { /* private mode */ }
        continueDraft(chatTarget);
      }}
      title={`Open the chat on ${draftLabel(chatTarget)}`}
      style={{
        position: 'fixed', right: 16, bottom: 14, zIndex: 60,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: '#061d39', color: '#fff', border: '1px solid #0d2b52',
        borderRadius: 6, padding: '8px 16px', fontSize: 12.5, fontWeight: 800,
        cursor: 'pointer', boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
      }}
    >
      Chat — SDC Engineer
    </button>
  );

  const summaryBits = [
    `${totals.stations} station${totals.stations !== 1 ? 's' : ''}`,
    totals.servos > 0 && `${totals.servos} servo${totals.servos !== 1 ? 's' : ''}`,
    totals.robots > 0 && `${totals.robots} robot${totals.robots !== 1 ? 's' : ''}`,
    totals.vision > 0 && `${totals.vision} vision`,
    totals.sensors > 0 && `${totals.sensors} sensor${totals.sensors !== 1 ? 's' : ''}`,
    (totals.ioIn > 0 || totals.ioOut > 0) && `${totals.ioIn} in / ${totals.ioOut} out IO`,
  ].filter(Boolean);

  return (
    <div className="v2-phome" data-testid="project-home">
      {chatPill}
      <div className="v2-phome__inner">
        <ProjectHeader project={project} />
        <div className="v2-phome__summary" data-testid="home-summary">
          {summaryBits.join(' · ')}
          {totalBlockers > 0 && (
            <span className="v2-phome__summary-blockers">
              {' '}· {totalBlockers} open question{totalBlockers !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <textarea
          className="v2-phome__notes"
          data-testid="home-notes"
          placeholder="Machine notes — anything project-wide worth remembering (saves with the project)"
          value={notes}
          rows={2}
          onChange={e => setNotes(e.target.value)}
          onBlur={commitNotes}
        />

        {/* PICK UP WHERE YOU LEFT OFF — the PRIMARY action when drafts exist
            (Dan, 2026-08-26). Clicking resumes the cascade where it sat. */}
        {drafts.length > 0 && (
          <>
            <div className="v2-phome__section">Pick up where you left off</div>
            <div className="v2-phome__grid">
              {drafts.map(d => (
                <button
                  key={d.draftId}
                  type="button"
                  className="v2-phome__card"
                  data-testid={`home-draft-${d.draftId}`}
                  onClick={() => continueDraft(d)}
                  title="Resume this station draft — the cascade continues exactly where it left off"
                  style={{
                    textAlign: 'left', cursor: 'pointer',
                    border: '1px solid #a8c8e8', borderLeft: '4px solid var(--color-primary)',
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--color-text)' }}>
                    {draftLabel(d)}
                  </div>
                  <div style={{ fontSize: 11.5, color: d.stationAccepted ? '#2f6b3c' : 'var(--color-text-muted)', margin: '2px 0 6px' }}>
                    {d.stationAccepted ? '✓' : 'draft ·'} {draftCascadeStepNote(d)} · {timeAgo(d.savedAt)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>{d.stationAccepted ? 'Open sheet →' : 'Continue →'}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* THE MACHINE SIGNAL MAP (Dan, 2026-08-30): the cross-station
            handshakes, growing as stations are accepted. */}
        {(() => {
          const acceptedMachines = drafts
            .filter(d => d.stationAccepted)
            .flatMap(d => d.smProposal?.stateMachines ?? []);
          const builtMachines = sms.flatMap(sm => (sm.machineSpec?.smSplit ?? []));
          const pairs = signalPairsOf([...acceptedMachines, ...builtMachines]);
          const accepted = drafts.filter(d => d.stationAccepted).length;
          return (
            <>
              <div className="v2-phome__section">Machine signal map</div>
              <div className="v2-phome__card" data-testid="home-signal-map" style={{ marginBottom: 14 }}>
                {pairs.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                    Grows as stations are accepted — every cross-station handshake lands here.
                  </div>
                ) : pairs.map((p, i) => (
                  <div key={i} data-testid={`home-signal-${i}`} style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-text)' }}>
                    <span style={{ fontWeight: 700 }}>{p.signal}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}> — {p.from} → {p.to}</span>
                    {!p.matched && <span style={{ marginLeft: 8, fontSize: 10.5, color: '#8a3b3b' }}>no matching wait yet</span>}
                  </div>
                ))}
                {/* MACHINE-LEVEL BUILD — unlocks when every station is
                    accepted; wired to the multi-program build when it lands. */}
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    data-testid="home-build-machine"
                    disabled
                    title="Builds one program per station machine, handshakes wired — lands with the multi-program build. Accept every station to arm it."
                    style={{
                      fontSize: 12.5, fontWeight: 800, padding: '7px 16px', borderRadius: 6,
                      border: '1px solid var(--color-border)', background: 'var(--color-sidebar)',
                      color: 'var(--color-text-muted)', cursor: 'not-allowed',
                    }}
                  >
                    Build Machine Code — {accepted + sms.length} of {drafts.length + sms.length} stations accepted
                  </button>
                  <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>coming — the whole machine builds once every station is accepted</span>
                </div>
              </div>
            </>
          );
        })()}

        {/* BOM SLOT (Dan, 2026-08-30): registration now; ingestion (seeding
            the station list from the BOM) builds later. */}
        <div className="v2-phome__section">Bill of materials</div>
        <div className="v2-phome__card" data-testid="home-bom-slot" style={{ marginBottom: 14 }}>
          {project.bomFile ? (
            <div style={{ fontSize: 12, color: 'var(--color-text)' }}>
              <span style={{ fontWeight: 700 }}>{project.bomFile.name}</span>
              <span style={{ color: 'var(--color-text-muted)' }}> — registered {String(project.bomFile.at ?? '').slice(0, 10)}. Station seeding from the BOM is coming.</span>
            </div>
          ) : (
            <label style={{ fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'underline' }}>Register the machine's BOM</span>
              <span>— seeds the station list once BOM ingestion lands</span>
              <input
                type="file"
                data-testid="home-bom-input"
                accept=".csv,.xlsx,.xls,.pdf"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  useDiagramStore.setState(st => ({ project: { ...st.project, bomFile: { name: f.name, at: new Date().toISOString() } } }));
                }}
              />
            </label>
          )}
        </div>

        <div className="v2-phome__section">Stations</div>
        <div className="v2-phome__grid">
          {sms.map(sm => {
            const info = perStation.get(sm.id) ?? { latest: null, blockers: 0 };
            return (
              <StationCard
                key={sm.id}
                sm={sm}
                latestBuild={info.latest}
                blockers={info.blockers}
                onOpen={() => openStationSheet(sm)}
              />
            );
          })}
          <button
            type="button"
            className="v2-phome__card v2-phome__card--add"
            data-testid="home-add-station"
            onClick={addStation}
            title="Describe a new station to Jarvis — the describe-first Create Station flow"
          >
            <span className="v2-phome__add-plus">＋</span>
            <span className="v2-phome__add-label">Add Station</span>
            <span className="v2-phome__add-hint">describe it to Jarvis</span>
          </button>
        </div>
      </div>
    </div>
  );
}
