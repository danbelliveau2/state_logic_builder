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
  recovery: 'initialization',
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
  const matchCandidate = (nameText) => {
    const nw = new Set(words(nameText));
    return candidates.find((c) => c.distinct.some((w) => nw.has(w))) ?? null;
  };
  // ONLY THE TWO CANONICAL SHAPES ARE INTERACTIONS (Dan's Finger-tag
  // misapply, 2026-08-28): a wait ON another machine's signal, or a signal
  // TO another machine. A motion that merely names a machine ("Extend
  // Shuttle to present the part to X") is a motion; Home lines never tag.
  const interactionOf = (line) => {
    const t = String(line ?? '').trim();
    let m = t.match(/^wait\s+for\s+(.+?)['’]s\b.*\bsignal\b/i);
    if (m) return matchCandidate(m[1]);
    m = t.match(/^(?:signal|set)\b.*?\bto\s+([A-Za-z0-9 '’.&-]+?)\s*$/i);
    if (m) return matchCandidate(m[1]);
    return null;
  };
  const byLine = new Map();
  const groupMap = new Map();
  (sequence ?? []).forEach((line, i) => {
    const hit = interactionOf(line);
    if (!hit) return;
    byLine.set(i, { counterpart: hit.name, scope: hit.scope });
    const k = `${hit.scope}:${hit.name}`;
    if (!groupMap.has(k)) groupMap.set(k, { counterpart: hit.name, scope: hit.scope, lines: [] });
    groupMap.get(k).lines.push(String(line));
  });
  return { byLine, groups: [...groupMap.values()] };
}

/**
 * HANDSHAKE DEADLOCK CHECK (coordinator, 2026-08-30 — runs at sequence/
 * interaction approvals and before Generate): pairs every cross-machine
 * WAIT with its setter and verifies reachability/ordering by simulating
 * the machines round-robin. Pure, instant, no model. Findings in plain
 * words; the caller turns them into numbered questions.
 */
// NOTE: agentLoopSdk.js carries a minimal CJS mirror of rule 1 (unmatchedWaits)
// as the engine's can-hang guard — keep the two parsers in step.
export function checkHandshakes(machines = []) {
  const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const sigKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[0-9]/g, (c) => NUMW[+c])
    .replace(/signal$/, '');
  const keysMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const nk = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Parse each machine's sequence into events.
  const ms = machines.map((m) => {
    const events = (m.sequence ?? []).map((l, i) => {
      const t = String(l);
      let mm = t.match(/^wait\s+for\s+(.+?)['’]s\s+(.+?)\s*(?:signal)?\s*$/i);
      if (mm) return { type: 'wait', from: mm[1], sig: sigKey(mm[2]), i, line: t };
      mm = t.match(/^(?:signal|set)\s+(.+?)\s+to\s+([A-Za-z0-9 '’.&-]+?)\s*$/i);
      if (mm) return { type: 'set', to: mm[2], sig: sigKey(mm[1]), i, line: t };
      return { type: 'other', i, line: t };
    });
    return { name: m.name, key: nk(m.name), events, recovery: (m.faultRecovery ?? []).map(String) };
  });
  const findings = [];
  // SPEAK WHAT THE ME SEES (Dan, 2026-08-30): findings reference the wait's
  // flow name ("Wait — Part-Gripped") and its neighboring visible steps —
  // NEVER internal step indices (waits render as edge labels, so "step 10"
  // matches nothing on his screen). And SDC truth: standard code gives every
  // wait a fault timeout — nothing "waits forever"; an unsatisfiable wait
  // faults on timeout every cycle.
  const flowName = (raw) => {
    let mm = String(raw).match(/^wait\s+for\s+.+?['’]s\s+(.+?)\s*(?:signal)?\s*$/i);
    if (!mm) mm = String(raw).match(/^wait\s+(?:for\s+)?(.+?)\s*(?:signal)?\s*$/i);
    return (mm ? mm[1] : String(raw)).trim();
  };
  const near = (m, i) => {
    let p = i - 1; while (p >= 0 && m.events[p].type === 'wait') p--;
    let n = i + 1; while (n < m.events.length && m.events[n].type === 'wait') n++;
    const before = p >= 0 ? m.events[p].line : null;
    const after = n < m.events.length ? m.events[n].line : null;
    if (before && after) return `between "${before}" and "${after}"`;
    if (after) return `before "${after}"`;
    if (before) return `after "${before}"`;
    return 'in its flow';
  };
  // 1+2: unmatched waits / setters (cross-machine only).
  for (const m of ms) {
    for (const w of m.events.filter((e) => e.type === 'wait')) {
      const partner = ms.find((x) => x !== m && (keysMatch(nk(w.from), x.key) || keysMatch(x.key, nk(w.from))));
      if (!partner) continue; // waits on Dial/other stations — outside this station's graph
      const setter = partner.events.find((e) => e.type === 'set' && keysMatch(e.sig, w.sig));
      if (!setter) {
        findings.push({
          kind: 'unmatched-wait',
          plain: `${m.name}'s "Wait — ${flowName(w.line)}" (${near(m, w.i)}) can never be satisfied — ${partner.name} never signals it. The station would fault on timeout every cycle.`,
          proposal: `Add the matching Signal step to ${partner.name}'s sequence, or drop the wait.`,
        });
      }
    }
    for (const s of m.events.filter((e) => e.type === 'set')) {
      const partner = ms.find((x) => x !== m && (keysMatch(nk(s.to), x.key) || keysMatch(x.key, nk(s.to))));
      if (!partner) continue;
      const waiter = partner.events.find((e) => e.type === 'wait' && keysMatch(e.sig, s.sig));
      if (!waiter) {
        findings.push({
          kind: 'unused-set',
          plain: `${m.name}'s "${s.line}" (${near(m, s.i)}) is never waited on by ${partner.name} — a dead signal, or ${partner.name} is missing the wait.`,
          proposal: `Add the wait on ${partner.name}'s side, or remove the signal step.`,
        });
      }
    }
  }
  // 3: round-robin simulation → circular waits / ordering deadlocks.
  {
    const ptr = ms.map(() => 0);
    const set = new Set();
    let guard = 0;
    for (;;) {
      let progressed = false;
      ms.forEach((m, mi) => {
        while (ptr[mi] < m.events.length) {
          const ev = m.events[ptr[mi]];
          if (ev.type === 'wait') {
            const partner = ms.find((x) => x !== m && (keysMatch(nk(ev.from), x.key) || keysMatch(x.key, nk(ev.from))));
            if (partner && ![...set].some((k) => keysMatch(k, ev.sig))) break; // blocked in-station
          }
          if (ev.type === 'set') set.add(ev.sig);
          ptr[mi] += 1;
          progressed = true;
        }
      });
      const allDone = ptr.every((p, i) => p >= ms[i].events.length);
      if (allDone) break;
      if (!progressed) {
        const blocked = ms.filter((m, mi) => ptr[mi] < m.events.length)
          .map((m) => {
            const mi = ms.indexOf(m);
            const ev = m.events[ptr[mi]];
            return `${m.name} at its "${ev.type === 'wait' ? `Wait — ${flowName(ev.line)}` : ev.line}" (${near(m, ev.i)})`;
          });
        findings.push({
          kind: 'deadlock',
          plain: `The machines deadlock running their cycles in order: ${blocked.join('; ')} — each is waiting on a signal the other hasn't reached yet. Every cycle would fault on timeout there.`,
          proposal: 'Reorder the waits/signals so each wait\'s setter runs earlier in the counterpart\'s cycle.',
        });
        break;
      }
      if (++guard > 500) break;
    }
  }
  // (The former rule 4 "fault-window" class is DELETED — Dan, 2026-08-30:
  //  SDC standard code gives every wait a fault timeout, faults run the
  //  recovery, and the cycle restart re-establishes the handshakes. The
  //  standard pattern handles a partner faulting mid-handshake — it is not
  //  a finding. Only unsatisfiable waits and ordering deadlocks are real.)
  return findings;
}

/** THE MACHINE SIGNAL MAP (Dan's homepage, 2026-08-30): every cross-machine
 *  handshake pair across the given machines — [{from, to, signal, matched}].
 *  Same parse as checkHandshakes; grows as stations accept. */
export function signalPairsOf(machines = []) {
  const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const sigKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[0-9]/g, (c) => NUMW[+c]).replace(/signal$/, '');
  const nk = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const keysMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const ms = (machines ?? []).filter(m => m?.name).map((m) => ({
    name: m.name, key: nk(m.name),
    sets: [], waits: [],
  }));
  for (const m of ms) {
    const src = (machines.find(x => x?.name === m.name)?.sequence ?? []).map(String);
    for (const t of src) {
      let mm = t.match(/^(?:signal|set)\s+(.+?)\s+to\s+([A-Za-z0-9 '’.&-]+?)\s*$/i);
      if (mm) { m.sets.push({ sig: sigKey(mm[1]), label: mm[1].trim(), to: mm[2].trim() }); continue; }
      mm = t.match(/^wait\s+for\s+(.+?)['’]s\s+(.+?)\s*(?:signal)?\s*$/i);
      if (mm) m.waits.push({ sig: sigKey(mm[2]), label: mm[2].trim(), from: mm[1].trim() });
    }
  }
  const pairs = [];
  for (const m of ms) {
    for (const s of m.sets) {
      const partner = ms.find(x => x !== m && (keysMatch(nk(s.to), x.key) || keysMatch(x.key, nk(s.to))));
      const matched = !!partner && partner.waits.some(w => keysMatch(w.sig, s.sig));
      pairs.push({ from: m.name, to: partner?.name ?? s.to, signal: s.label, matched });
    }
  }
  return pairs;
}

/** Home/tree label for an unfinished draft: where its cascade sits (Dan,
 *  2026-08-26: "MidBaseLoad — draft · at step 1 · Continue"). */
export function draftCascadeStepNote(draft) {
  if (draft?.stationAccepted) return 'accepted — banks for the machine build';
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
    // RECOVERY IS A STEP, ALWAYS (Dan, 2026-08-28: his 7-step walk had no
    // recovery anywhere — the hasRec gate silently dropped it when the
    // proposal carried no recovery content). The step exists whether or not
    // content does; empty content is the step's problem, not a reason to
    // skip the review.
    void hasRec;
    steps.push({ key: `recovery:${e.key}`, kind: 'recovery', smKey: e.key, smName: e.name ?? '', label: single ? 'Initialization' : `${e.name} initialization` });
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
