/**
 * smGrouping.js — the station sheet's SM-aware organization (Dan, 2026-08-25:
 * once the state machines are known, the sheet organizes by SM — devices
 * grouped under SM sub-headers, one numbered sequence per SM, a small shared
 * handshake strip). Pure logic, no React, no store.
 *
 * DATA SOURCES (tolerant by design — "read from whatever the split agent
 * persists"; coordinate on shape via the project file):
 *   1. sm.machineSpec.smSplit — the applied SM split (another agent lands it;
 *      e.g. Magnet Dial → S01_MagnetLoad + S02_MagnetPickHead). Accepted entry
 *      fields, all optional except a name-ish one:
 *        name | programName | smName          → the machine's name
 *        oneLiner | purpose | description     → one-line ownership statement
 *        deviceNames | devices | deviceIds    → owned devices (strings, {name},
 *                                               or ids resolved via sm.devices)
 *        sequence | steps                     → numbered steps (strings or {text})
 *        faultRecovery | failureHandling      → per-SM recovery steps
 *        handshakes                           → [{signal, direction, partner, purpose}]
 *   2. sm.compiledSequence.ir.stateMachines — a multi-SM compile: ownership is
 *      DERIVED from each machine's ServoMove/actuate actions (deviceName),
 *      sequence lines from its state labels, handshakes carried per machine.
 *
 * machineSpec.expectedStateMachines (the ME's raw dictated expectation) is
 * deliberately NOT parsed for grouping — free speech is guidance for the
 * compile, not a structure. Unknown / single-SM → null: the sheet renders
 * exactly as today (no headers, no columns).
 */

const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const str = (v) => String(v ?? '').trim();
const arr = (v) => (Array.isArray(v) ? v : []);

/** One tolerant line: accepts a string, {text}, {label}, or a state object. */
function lineOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x.trim();
  return str(x.text ?? x.label ?? x.step ?? '');
}

/** Tolerant device-name list: strings, {name}/{displayName}, or ids. */
function deviceNamesOf(entry, smDevices) {
  const byId = new Map(arr(smDevices).map((d) => [d.id, d.displayName || d.name]));
  const raw = arr(entry.deviceNames).length ? entry.deviceNames
    : arr(entry.devices).length ? entry.devices
      : arr(entry.deviceIds).length ? entry.deviceIds : [];
  return raw
    .map((x) => {
      if (typeof x === 'string') return byId.get(x) ?? x; // id or name
      return str(x?.displayName ?? x?.name);
    })
    .map(str)
    .filter(Boolean);
}

function normalizeSplitEntry(entry, smDevices) {
  const name = str(entry.name ?? entry.programName ?? entry.smName);
  if (!name) return null;
  const seq = arr(entry.sequence).length ? entry.sequence : arr(entry.steps);
  const fault = arr(entry.faultRecovery).length ? entry.faultRecovery : arr(entry.failureHandling);
  return {
    key: normKey(name),
    name,
    oneLiner: str(entry.oneLiner ?? entry.purpose ?? entry.description),
    // WHY IT'S SEPARATE — the asynchrony reasoning per machine, so the ME can
    // argue with the split instead of just accepting a count (Dan, 2026-08-25).
    why: str(entry.why ?? entry.reason ?? entry.asynchrony ?? entry.whySeparate),
    deviceNames: deviceNamesOf(entry, smDevices),
    sequence: seq.map(lineOf).filter(Boolean),
    faultRecovery: fault.map(lineOf).filter(Boolean),
    // STRUCTURED SHAPES CARRY VERBATIM (Dan, 2026-08-31: the recovery
    // Y-branch flow degraded to a numbered list because this normalize
    // dropped the structure — never serialize to prefixed strings).
    ...(Array.isArray(entry.sequenceSteps) ? { sequenceSteps: entry.sequenceSteps } : {}),
    ...(Array.isArray(entry.faultRecoverySteps) ? { faultRecoverySteps: entry.faultRecoverySteps } : {}),
    handshakes: arr(entry.handshakes).map((h) => ({
      signal: str(h?.signal), direction: str(h?.direction) || 'out',
      partner: str(h?.partner), purpose: str(h?.purpose),
    })).filter((h) => h.signal),
  };
}

// PER-SM RECOVERY (Dan, 2026-08-25: each SM shows its OWN recovery sequence).
// Compiled states carry no 'recovery' kind — the excursion states are
// recognized by their labels; the main cycle keeps everything else.
const RECOVERY_LABEL_RE = /\b(retr(y|ies)|recover\w*|abandon\w*|fault\w*|reject\w*|dropped|exhausted|bad stack)\b/i;

/** Partition state labels into { sequence, faultRecovery } — recovery
 *  excursions after the main flow, in their own column. */
export function partitionRecoveryLabels(labels) {
  const sequence = [];
  const faultRecovery = [];
  for (const l of labels) {
    (RECOVERY_LABEL_RE.test(l) ? faultRecovery : sequence).push(l);
  }
  return { sequence, faultRecovery };
}

/** Derive one entry from a compiled multi-SM machine: owned devices from its
 *  actions, sequence lines from its state labels (main flow order). */
function entryFromCompiledMachine(m) {
  const name = str(m.name ?? m.programName);
  if (!name) return null;
  const deviceNames = [];
  const seen = new Set();
  const states = arr(m.states);
  for (const st of states) {
    for (const a of arr(st.actions)) {
      const dn = str(a.deviceName ?? a.device);
      if (dn && !seen.has(normKey(dn))) { seen.add(normKey(dn)); deviceNames.push(dn); }
    }
  }
  // Brevity law: state labels ARE the one-line steps. Recovery excursions
  // split into the per-SM fault-recovery column (Dan, 2026-08-25).
  const { sequence, faultRecovery } = partitionRecoveryLabels(
    states.map((s) => str(s.label)).filter(Boolean));
  return {
    key: normKey(name),
    name,
    oneLiner: str(m.oneLiner),
    deviceNames,
    sequence,
    faultRecovery,
    handshakes: arr(m.handshakes).map((h) => ({
      signal: str(h?.signal), direction: str(h?.direction) || 'out',
      partner: str(h?.partner), purpose: str(h?.purpose),
    })).filter((h) => h.signal),
  };
}

/**
 * The station's known SM decomposition, normalized — or null when unknown or
 * single-SM (the sheet then renders exactly as today).
 * @param {object} sm       the built SM (linked sheet) — may be null
 * @param {Array}  sheetDevices  summary.devices (draft sheets have no SM)
 */
/** The APPLIED split alone (machineSpec.smSplit), normalized — or null. */
export function splitDecompositionOf(sm, sheetDevices = null) {
  if (!sm) return null;
  const smDevices = (sm.devices ?? sheetDevices ?? []);
  const split = arr(sm.machineSpec?.smSplit)
    .map((e) => (e && typeof e === 'object' ? normalizeSplitEntry(e, smDevices) : null))
    .filter(Boolean);
  return split.length >= 2 ? split : null;
}

/** The COMPILED proposal alone (compiledSequence.ir), normalized — or null.
 *  ONE TRUTH source for the SM panel: cards, count and prose all come from
 *  this single compile output (Dan's three-truths screenshot, 2026-08-25). */
export function compiledDecompositionOf(sm) {
  const ir = sm?.compiledSequence?.ir;
  if (!(ir?.multiSm && arr(ir.stateMachines).length >= 2)) return null;
  const entries = ir.stateMachines.map(entryFromCompiledMachine).filter(Boolean);
  return entries.length >= 2 ? entries : null;
}

export function smDecompositionOf(sm, sheetDevices = null) {
  if (!sm) return null;
  const split = splitDecompositionOf(sm, sheetDevices) ?? [];
  const compiled = compiledDecompositionOf(sm) ?? [];
  // A NEWER compile supersedes a stale applied split (Dan's Magnet Dial round:
  // the old 2-way split kept winning over the fresh 4-machine proposal — the
  // ME must see, and approve, what SDC Engineer actually proposes NOW). Tolerant
  // timestamps: missing dates keep the split's authority.
  const splitAt = Date.parse(str(sm.machineSpec?.smSplitAppliedAt)) || 0;
  const compiledAt = Date.parse(str(sm.compiledSequence?.compiledAt)) || 0;
  const compiledIsNewer = compiled.length >= 2 && splitAt > 0 && compiledAt > splitAt
    && sm.machineSpec?.smSplitApproval?.approved !== true; // an APPROVED split stays authority until re-approved
  if (split.length >= 2 && !compiledIsNewer) {
    // Per-SM recovery backfill: split entries persisted without faultRecovery
    // borrow their machine's recovery excursions from the compile (name match).
    return split.map((e) => {
      if (e.faultRecovery.length) return e;
      const hit = compiled.find((c) => c.key === e.key
        || c.key.includes(e.key) || e.key.includes(c.key));
      if (hit?.faultRecovery?.length) return { ...e, faultRecovery: hit.faultRecovery };
      // Last resort: the entry's own sequence lines may carry excursions.
      const p = partitionRecoveryLabels(e.sequence);
      return p.faultRecovery.length ? { ...e, sequence: p.sequence, faultRecovery: p.faultRecovery } : e;
    });
  }
  if (compiled.length >= 2) return compiled;
  if (split.length >= 2) return split;
  return null; // unknown or single-SM — no grouping
}

/**
 * Partition device rows (sheet summary.devices OR built sm.devices) under the
 * decomposition. Matching: exact normalized name, then contains either way
 * (sheet "MagnetDial" ↔ split "Magnet Dial Servo"). Devices no machine claims
 * land in ONE trailing unassigned bucket ({ sm: null }).
 * @returns [{ sm: entry|null, devices: [{ d, i }] }]  (input order preserved)
 */
export function groupDevicesBySm(decomp, devices) {
  const indexed = (devices ?? []).map((d, i) => ({ d, i }));
  if (!decomp || decomp.length < 2) return [{ sm: null, devices: indexed }];
  const groups = decomp.map((sm) => ({ sm, devices: [] }));
  const unassigned = [];
  const claim = (name) => {
    const k = normKey(name);
    if (!k) return null;
    for (const g of groups) {
      for (const dn of g.sm.deviceNames) {
        const dk = normKey(dn);
        if (dk === k) return g;
      }
    }
    for (const g of groups) {
      for (const dn of g.sm.deviceNames) {
        const dk = normKey(dn);
        if (dk && (dk.includes(k) || k.includes(dk))) return g;
      }
    }
    return null;
  };
  for (const row of indexed) {
    const g = claim(row.d?.displayName ?? row.d?.name);
    (g ? g.devices : unassigned).push(row);
  }
  const out = groups.filter((g) => g.devices.length > 0);
  if (unassigned.length) out.push({ sm: null, devices: unassigned });
  // All devices unassigned → the split names don't map; render as today.
  return out.length === 1 && out[0].sm === null ? [{ sm: null, devices: indexed }] : out;
}

// ── THE STATION'S REAL STATE MACHINES (Dan's structural ruling, 2026-08-25) ──
// "This is ONE station. One station can have multiple state machines." Once a
// station holds several SM RECORDS, they are FACT, not a proposal: the ONE
// station spec sheet groups devices per SM and prints one sequence column per
// SM straight off those records. No approval gate — approval governs a
// PROPOSED split, never machines that already exist.

/** Fallback sequence for an SM with no persisted split entry: its state node
 *  labels in flow order (top-to-bottom is the drawn order). */
function sequenceFromNodes(sm) {
  return arr(sm?.nodes)
    .filter((n) => n?.type === 'stateNode')
    .slice()
    .sort((a, b) => {
      const an = a.data?.stepNumber ?? a.data?.stateNumber;
      const bn = b.data?.stepNumber ?? b.data?.stateNumber;
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return (a.position?.y ?? 0) - (b.position?.y ?? 0);
    })
    .map((n) => str(n.data?.label))
    .filter(Boolean);
}

/**
 * The station's decomposition built from its REAL SM records.
 * @param {Array} stationSms every SM record of ONE station (see lib/stationModel)
 * @returns entries (same shape as smDecompositionOf) or null when < 2 machines
 */
export function stationSmDecompositionOf(stationSms) {
  const list = arr(stationSms);
  if (list.length < 2) return null;
  // Split entries persisted anywhere on the station carry the per-SM sequence,
  // devices, handshakes and reasoning SDC Engineer compiled — match them by name.
  const splitEntries = [];
  for (const s of list) {
    for (const e of arr(s.machineSpec?.smSplit)) {
      const n = e && typeof e === 'object' ? normalizeSplitEntry(e, s.devices) : null;
      if (n && !splitEntries.some((x) => x.key === n.key)) splitEntries.push(n);
    }
  }
  return list.map((sm) => {
    const name = str(sm.smName) || str(sm.displayName) || str(sm.name);
    const key = normKey(name);
    const match = splitEntries.find((e) => e.key === key)
      ?? splitEntries.find((e) => e.key && (e.key.includes(key) || key.includes(e.key)));
    const own = arr(sm.devices).map((d) => str(d.displayName ?? d.name)).filter(Boolean);
    // PER-SM RECOVERY: each machine's own recovery excursions split out of
    // its drawn node labels (Dan, 2026-08-25) — persisted entry wins.
    const p = partitionRecoveryLabels(sequenceFromNodes(sm));
    return {
      key: key || normKey(sm.id),
      smId: sm.id,
      name,
      oneLiner: match?.oneLiner || str(sm.machineSpec?.purpose),
      why: match?.why ?? '',
      deviceNames: own.length ? own : (match?.deviceNames ?? []),
      sequence: p.sequence.length ? p.sequence : (match?.sequence ?? []),
      faultRecovery: (match?.faultRecovery?.length ? match.faultRecovery : p.faultRecovery),
      handshakes: match?.handshakes ?? [],
    };
  });
}

// ── APPROVAL (Dan, 2026-08-25: the SM decomposition is an approval artifact) ─
// CONTRACT with the split/build-guard agent: approval persists as
// machineSpec.smSplitApproval = { approved: true|false, by, at } — a SIBLING
// key of machineSpec.smSplit (never a property on the array itself: JSON
// serialization drops array properties). Only the APPROVED split is authority:
// sheet grouping, per-SM diagrams, per-program codegen. Any edit clears it.

/** The station's split approval, or null when never approved/recorded. */
export function smSplitApprovalOf(sm) {
  const a = sm?.machineSpec?.smSplitApproval;
  if (!a || typeof a !== 'object') return null;
  return { approved: a.approved === true, by: str(a.by) || 'ME', at: str(a.at) };
}

/** The decomposition ONLY when the ME has approved it — the sheet's grouping,
 *  the diagrams, and codegen key off THIS, never off a mere proposal. */
export function approvedSmDecompositionOf(sm, sheetDevices = null) {
  return smSplitApprovalOf(sm)?.approved ? smDecompositionOf(sm, sheetDevices) : null;
}

// ── SIGNAL SOURCES (classic live-linking rules — Dan, 2026-08-25) ────────────
// A signal row on the sheet shows which SM it comes FROM, exactly like the
// classic app (displayName, source SM, group). Sources searched in order:
// the decomposition's handshakes, the compiled ir's handshakes, then every
// OTHER SM's smOutputs / smSplit handshakes across the project.

const sigKey = (s) => normKey(String(s ?? '').replace(/^(p|i|q)_/i, ''));

/** Resolve one signal name to { signal, from, to, purpose } or null. */
export function signalSourceOf(name, { decomp = null, ir = null, sms = [], selfName = '' } = {}) {
  const k = sigKey(name);
  if (!k) return null;
  for (const e of decomp ?? []) {
    for (const h of e.handshakes ?? []) {
      if (sigKey(h.signal) !== k) continue;
      const outbound = /out/i.test(h.direction || 'out');
      return {
        signal: h.signal,
        from: outbound ? e.name : (h.partner || selfName),
        to: outbound ? (h.partner || '') : e.name,
        purpose: h.purpose || '',
      };
    }
  }
  for (const h of arr(ir?.handshakes)) {
    if (!h?.signal || sigKey(h.signal) !== k) continue;
    const self = selfName || ir.displayName || ir.smName || 'this station';
    const outbound = /out/i.test(h.direction || 'out');
    return {
      signal: h.signal,
      from: outbound ? self : (h.partner || ''),
      to: outbound ? (h.partner || '') : self,
      purpose: h.purpose || '',
    };
  }
  for (const s of sms ?? []) {
    const smName = s.displayName || s.name || '';
    for (const o of arr(s.smOutputs)) {
      if (sigKey(o?.name) === k) return { signal: o.name, from: smName, to: '', purpose: o.description || '' };
    }
    for (const e of arr(s.machineSpec?.smSplit)) {
      for (const h of arr(e?.handshakes)) {
        if (sigKey(h?.signal) !== k) continue;
        const outbound = /out/i.test(h.direction || 'out');
        return {
          signal: h.signal,
          from: outbound ? (e.name || smName) : (h.partner || ''),
          to: outbound ? (h.partner || '') : (e.name || smName),
          purpose: h.purpose || '',
        };
      }
    }
  }
  return null;
}

/** Handshake signals with NO device/signal row on the sheet — the SIGNALS
 *  group renders them as read-only rows so handshakes live in ONE place
 *  (never a separate strip; Dan, 2026-08-25). */
export function unclaimedHandshakesOf(decomp, ir, claimedNames = []) {
  const claimed = new Set((claimedNames ?? []).map(sigKey).filter(Boolean));
  return sharedHandshakesOf(decomp, ir).filter((r) => !claimed.has(sigKey(r.signal)));
}

/** The shared handshake strip: every p_* signal between the planned machines,
 *  deduped by signal name — one line each ({ signal, from, to, purpose }).
 *  Falls back to the compiled ir's top-level handshakes when entries carry
 *  none. Empty array when nothing is known. */
export function sharedHandshakesOf(decomp, ir = null) {
  const rows = [];
  const seen = new Set();
  const push = (h, owner) => {
    const k = normKey(h.signal);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const outbound = /out/i.test(h.direction ?? 'out');
    rows.push({
      signal: h.signal,
      from: outbound ? owner : (h.partner || '?'),
      to: outbound ? (h.partner || '?') : owner,
      purpose: h.purpose || '',
    });
  };
  for (const e of decomp ?? []) {
    for (const h of e.handshakes ?? []) push(h, e.name);
  }
  if (rows.length === 0 && ir) {
    for (const h of arr(ir.handshakes)) {
      if (h?.signal) push({ ...h }, ir.displayName || ir.smName || 'this station');
    }
  }
  return rows;
}
