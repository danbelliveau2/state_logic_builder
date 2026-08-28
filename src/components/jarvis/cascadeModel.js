/**
 * cascadeModel.js — the spec sheet's PROPOSE → APPROVE CASCADE (Dan, 2026-08-26:
 * "I explain it, you propose, I approve or edit in ONE response place, it locks
 * into the outputs below, we move to the next thing").
 *
 * Pure logic, no React, no store. The page derives the ordered step list from
 * the structures it ALREADY persists (SM decomposition + summary — no data
 * migration), overlays the recorded approvals, and gets back exactly ONE
 * active step at a time.
 *
 * Step order (Dan's cascade):
 *   SM breakup → per SM: devices → sequence → recovery → … → interactions
 *
 * Approval sources, in authority order:
 *   - smSplit:  machineSpec.smSplitApproval — the EXISTING approval artifact,
 *               never duplicated here. Real station SM records = approved fact.
 *   - others:   machineSpec.cascadeState = { steps: { [key]: {approved, by,
 *               at, reconfirm} } } — a SIBLING key of smSplit (JSON drops
 *               properties set on arrays; same rule as smSplitApproval).
 *   - legacy:   machineSpec.sectionReviews seeds a kind's approval ONLY while
 *               cascadeState is still empty ("derive from existing approval
 *               stamps where possible" — Dan).
 *
 * reconfirm: an upstream step was re-opened AFTER this one was approved — the
 * step keeps its record but re-enters the queue for a one-click re-confirm.
 */

/** The sheet section each step kind lives in (review bars / jump targets). */
export const KIND_SECTION = {
  smSplit: 'stateMachines',
  devices: 'devices',
  sequence: 'sequence',
  recovery: 'failureHandling',
  interactions: 'interactions',
};

/** Plain noun per kind, for talk-back framing sent to Jarvis. */
export const KIND_NOUN = {
  smSplit: 'state machine breakup',
  devices: 'devices',
  sequence: 'sequence',
  recovery: 'fault recovery',
  // ONE WORD (Dan, 2026-08-28): "signal" — never "handshake" in step labels.
  interactions: 'signals with other machines',
};

/**
 * INTERACTIONS ARE SEQUENCE LINES (Dan, 2026-08-28: no duplicate surfaces —
 * the sequence is the single source; the walk's Interactions step is a
 * review LENS over it, nothing stored separately).
 *
 * Derives, for one machine's sequence, which lines talk to a counterpart and
 * the SCOPE of each ("kind of an important distinction for generating good
 * code" — Dan):
 *   sameStation  — another state machine in THIS station: program-to-program
 *                  signals inside the station's own programs.
 *   otherStation — a different station entirely: the station's external
 *                  interface (supervisor-visible p_ signals).
 *
 * @param sequence      string[] — the machine's sequence lines.
 * @param selfName      this machine's name (its own words never match).
 * @param sameMachines  names of the OTHER machines in this station.
 * @param otherStations names of the project's other stations.
 * @returns {{ byLine: Map<number,{counterpart,scope}>, groups: Array<{counterpart,scope,lines:string[]}> }}
 */
export function deriveInteractionLines(sequence, { selfName = '', sameMachines = [], otherStations = [] } = {}) {
  const words = (s) => String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const selfWords = new Set(words(selfName));
  // A counterpart matches on its DISTINCTIVE words — the ones not shared
  // with this machine's own name ("MidBase Escapement" vs "MidBase Pick and
  // Place" → "escapement"; the Dial station → "dial").
  const candidates = [
    ...sameMachines.map((n) => ({ name: n, scope: 'sameStation' })),
    ...otherStations.map((n) => ({ name: n, scope: 'otherStation' })),
  ].map((c) => ({ ...c, distinct: words(c.name).filter((w) => !selfWords.has(w)) }))
    .filter((c) => c.distinct.length > 0);
  const byLine = new Map();
  const groupMap = new Map();
  (sequence ?? []).forEach((line, i) => {
    const lw = new Set(words(line));
    // sameStation candidates first — the nearer counterpart wins a tie.
    const hit = candidates.find((c) => c.distinct.some((w) => lw.has(w)));
    if (!hit) return;
    byLine.set(i, { counterpart: hit.name, scope: hit.scope });
    const k = `${hit.scope}:${hit.name}`;
    if (!groupMap.has(k)) groupMap.set(k, { counterpart: hit.name, scope: hit.scope, lines: [] });
    groupMap.get(k).lines.push(String(line));
  });
  return { byLine, groups: [...groupMap.values()] };
}

/** Home/tree label for an unfinished draft: where its cascade sits (Dan,
 *  2026-08-26: "MidBaseLoad — draft · at step 1 · Continue"). */
export function draftCascadeStepNote(draft) {
  if (!draft || draft.phase !== 'summary' || !draft.summary) return 'still explaining';
  const recs = draft.cascadeLocal?.steps ?? {};
  const n = Object.values(recs).filter((r) => r?.approved === true && r?.reconfirm !== true).length;
  return `at step ${n + 1}`;
}

/**
 * The ordered step list.
 * @param decomp          the DISPLAYED decomposition (proposal or approved) —
 *                        its presence (>=2) creates the SM-breakup step and
 *                        names the pending per-SM steps before approval.
 * @param approvedEntries the APPROVED decomposition (authority) — per-SM step
 *                        content keys off this once it exists.
 * @param summary         the structured sheet (single-SM fallback content).
 * @param hasPeers        other stations exist → interactions step.
 */
export function cascadeStepsOf({ decomp = null, approvedEntries = null, summary = null, hasPeers = false } = {}) {
  const steps = [];
  const multi = (decomp?.length ?? 0) >= 2;
  // The breakup step ALWAYS exists (Dan's strict order, 2026-08-26): with a
  // proposal it's the approve-the-split step; without one (fresh draft /
  // never-compiled single) it's the "get the proposal" step — Build/compile
  // produces it, or the ME agrees the station runs as one machine.
  // A proposal of ONE is still a proposal (draft decompose can return one).
  steps.push({ key: 'smSplit', kind: 'smSplit', smKey: null, smName: '', label: 'State machines', hasProposal: (decomp?.length ?? 0) >= 1 });
  const entries = (approvedEntries?.length ?? 0) >= 2
    ? approvedEntries
    : multi
      ? decomp
      : [{ key: 'station', name: '', deviceNames: null, sequence: null, faultRecovery: null }];
  // PER-MACHINE WALK, ALL THE WAY THROUGH (Dan, 2026-08-27): one machine
  // completely — devices → sequence → interactions → fault recovery — then
  // the next. Exactly these 4 per machine + SM-breakup + Generate; never a
  // million steps.
  for (const e of entries) {
    const single = e.key === 'station';
    const hasDevices = single ? (summary?.devices?.length ?? 0) > 0 : (e.deviceNames?.length ?? 0) > 0;
    const hasSeq = single ? (summary?.sequence?.length ?? 0) > 0 : (e.sequence?.length ?? 0) > 0;
    const hasRec = single ? (summary?.failureHandling?.length ?? 0) > 0 : (e.faultRecovery?.length ?? 0) > 0 || (summary?.failureHandling?.length ?? 0) > 0;
    if (hasDevices) steps.push({ key: `devices:${e.key}`, kind: 'devices', smKey: e.key, smName: e.name ?? '', label: single ? 'Devices' : `${e.name} devices` });
    if (hasSeq) steps.push({ key: `sequence:${e.key}`, kind: 'sequence', smKey: e.key, smName: e.name ?? '', label: single ? 'Sequence' : `${e.name} sequence` });
    steps.push({ key: `interactions:${e.key}`, kind: 'interactions', smKey: e.key, smName: e.name ?? '', label: single ? 'Interactions' : `${e.name} interactions` });
    if (hasRec) steps.push({ key: `recovery:${e.key}`, kind: 'recovery', smKey: e.key, smName: e.name ?? '', label: single ? 'Fault recovery' : `${e.name} recovery` });
  }
  return steps;
}

/**
 * Overlay approvals → per-step status + the single active step.
 * status: 'approved' | 'active' | 'reconfirm' | 'pending'
 * The active step is the FIRST not-effectively-approved step (a reconfirm
 * step re-enters the queue at its own position).
 */
export function deriveCascade(steps, { state = null, smApprovalApproved = false, legacyReviews = null, smSplitFromRecs = false } = {}) {
  const recs = state?.steps ?? {};
  const hasAnyState = Object.keys(recs).length > 0;
  const legacy = (kind) => {
    if (hasAnyState || !legacyReviews) return false;
    const sec = KIND_SECTION[kind];
    return !!(sec && legacyReviews[sec]);
  };
  const annotated = steps.map((s) => {
    if (s.kind === 'smSplit') {
      // The artifact wins when a station exists; fresh DRAFTS (no artifact
      // possible yet) record the approval in the cascade state itself —
      // smSplitFromRecs says the caller allows that (Dan, 2026-08-26).
      const ok = smApprovalApproved
        || ((smSplitFromRecs || !s.hasProposal) && recs[s.key]?.approved === true);
      return { ...s, wasApproved: ok, reconfirm: false, effApproved: ok };
    }
    const rec = recs[s.key];
    const wasApproved = rec ? rec.approved === true : legacy(s.kind);
    const reconfirm = rec?.reconfirm === true && wasApproved;
    return { ...s, wasApproved, reconfirm, effApproved: wasApproved && !reconfirm };
  });
  const activeIdx = annotated.findIndex((s) => !s.effApproved);
  const out = annotated.map((s, i) => ({
    ...s,
    status: s.effApproved ? 'approved'
      : i === activeIdx ? 'active'
        : s.reconfirm ? 'reconfirm'
          : 'pending',
  }));
  return {
    steps: out,
    activeStep: activeIdx === -1 ? null : out[activeIdx],
    approvedCount: out.filter((s) => s.status === 'approved').length,
    allApproved: out.length > 0 && activeIdx === -1,
  };
}
