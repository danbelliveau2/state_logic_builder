/**
 * initCoverage.js — INIT-TIME STATE-SPACE COMPLETENESS (Dan, 2026-08-31:
 * "ALL scenarios must be covered, and the CE brain must CHECK coverage
 * exhaustively, not sample it" — after Jason spotted the uncovered
 * "not initialized AND gripper closed" power-up case).
 *
 * Deterministic, model-free. Per GRIPPER on the sheet (the branch-defining
 * devices), against its machine's APPROVED initialization branches and the
 * standard template moves (SDCStandardPNP 100 → 103/106 → 124):
 *   - open at power-up          → the empty path (template 103 shape)
 *   - closed, part KNOWN        → the carrying path (template 106 shape)
 *   - closed, part UNKNOWN      → NOT answered by the templates on a
 *     sensorless gripper — an uncovered scenario with a few-words policy
 *     question + the template citation. A HOLD, never a guess.
 * Slides mid-stroke are answered by the template's retract-first move when
 * ANY initialization exists; a machine with motion devices and NO
 * initialization at all is uncovered.
 */

const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);

const SIGNAL_TYPES = /parameter|signal|smoutput/i;
const isGripper = (d) => !SIGNAL_TYPES.test(String(d?.type ?? '')) && (/gripper/i.test(String(d?.type ?? '')) || /gripper/i.test(String(d?.displayName ?? d?.name ?? '')));
const isMotion = (d) => !SIGNAL_TYPES.test(String(d?.type ?? '')) && /linear|slide|cylinder|actuator|servo|axis/i.test(String(d?.type ?? ''));
const gripSensorless = (d) => /no sensors|timer only/i.test(String(d?.sensorArrangement ?? ''));

/** Fuzzy device↔machine link: owned-name token overlap, then sequence text. */
function machineOf(machines, dev) {
  const dw = new Set(words(dev.displayName ?? dev.name));
  let best = null; let bestScore = 0;
  for (const m of machines) {
    let score = 0;
    for (const n of (m.ownedDeviceNames ?? m.deviceNames ?? [])) {
      const a = nk(n); const b = nk(dev.displayName ?? dev.name);
      if (a && b && (a === b)) score = Math.max(score, 1);
      else if (a && b && (a.includes(b) || b.includes(a))) score = Math.max(score, 0.8);
      else {
        const ow = words(n);
        const hit = ow.filter(w => dw.has(w) || b.includes(w)).length;
        score = Math.max(score, hit / Math.max(1, ow.length));
      }
    }
    // OWNERSHIP WINS over sequence text (the sheet can have naming drift —
    // both machines saying "ShuttleGripper"); sequence text is a weak
    // fallback only.
    const seqText = nk((m.sequence ?? []).join(' '));
    if (score < 0.6 && seqText.includes(nk(dev.displayName ?? dev.name))) score = Math.max(score, 0.55);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= 0.6 ? best : null;
}

/** The machine's gripper-decision branches ({carrying, empty} paths). */
function gripPathsOf(machine) {
  for (const it of (machine?.faultRecoverySteps ?? [])) {
    if (it && typeof it === 'object' && it.decision && /gripp|carry|part/i.test(String(it.decision))) {
      const yes = (it.branches ?? []).find(b => /^y|gripp|carry|part/i.test(String(b.label)));
      const no = (it.branches ?? []).find(b => /^n|empty|open|not/i.test(String(b.label)));
      return { decision: String(it.decision), carrying: yes ?? null, empty: no ?? null };
    }
  }
  return { decision: null, carrying: null, empty: null };
}

/** Does anything on this machine tell the code whether a part is held when
 *  the gripper is closed at POWER-UP? A gripper open/closed sensor does not;
 *  a part-present sensor AT THE GRIPPER would. Conservative: only a sensor
 *  whose name says part+grip counts. */
function partKnownAtPowerUp(devices, grip) {
  // An approved carrying branch is the POLICY; "known enough" means the
  // machine has SOME evidence to branch on: any gripper sensor, or any
  // part/present sensor on the machine. Truly blind = a no-sensor gripper
  // on a machine with no part sensing (the Jason case).
  if (!gripSensorless(grip)) return true;
  return (devices ?? []).some((d) => /sensor/i.test(String(d?.type ?? ''))
    && /part|present/i.test(String(d?.displayName ?? d?.name ?? '')));
}

function checkInitCoverage({ machines = [], devices = [] } = {}) {
  const covered = [];
  const uncovered = [];
  const realDevices = (devices ?? []).filter(d => !SIGNAL_TYPES.test(String(d?.type ?? '')));

  const assignedGrippers = new Map(); // machine name -> gripper
  const grippers = realDevices.filter(isGripper);
  const links = grippers.map(g => ({ g, m: machineOf(machines, g) }));
  for (const l of links) if (l.m) assignedGrippers.set(l.m.name, l.g);
  for (const l of links.filter(x => !x.m)) {
    // Naming drift fallback: attach to a machine that grips in its sequence
    // but has no gripper of its own yet.
    l.m = machines.find(mm => !assignedGrippers.has(mm.name)
      && /(engage|close|grip)/i.test((mm.sequence ?? []).join(' '))) ?? null;
    if (l.m) assignedGrippers.set(l.m.name, l.g);
  }
  for (const { g, m } of links) {
    const gName = g.displayName ?? g.name;
    const mName = m?.name ?? '(unassigned machine)';
    const { carrying, empty } = m ? gripPathsOf(m) : { carrying: null, empty: null };

    // OPEN at power-up — the empty path.
    if (empty) covered.push({ machine: mName, scenario: `power-up with ${gName} open`, path: `approved "No" branch (SDCStandardPNP 103 empty-return shape)` });
    else uncovered.push({
      machine: mName, scenario: `power-up with ${gName} open`,
      question: `Power-up with ${gName} open — go home and start at pick?`,
      proposedSolution: 'Standard empty path: retract first, home, rejoin at pick (SDCStandardPNP 100→103).',
      citation: 'SDCStandardPNP 103',
    });

    // CLOSED at power-up.
    const machDevices = m ? realDevices.filter(d => d === g || machineOf([m], d)) : [g];
    const known = partKnownAtPowerUp(machDevices, g);
    if (carrying && known) {
      covered.push({ machine: mName, scenario: `power-up with ${gName} closed on a part`, path: `approved "Yes" branch (SDCStandardPNP 106 carry-forward shape)` });
    } else if (carrying && !known) {
      // THE JASON CASE: closed, part UNKNOWN — templates answer known
      // carry-vs-empty only; the policy is the engineer's.
      uncovered.push({
        machine: mName, scenario: `power-up with ${gName} closed — part unknown`,
        question: `Power-up with ${gName} closed and no way to know if it holds a part — treat as carrying (finish to place), or open at safe height and treat as empty?`,
        proposedSolution: 'The shipped init templates branch on a KNOWN gripper state (SDCStandardPNP 100→106 carrying / 100→103 empty); closed-with-unknown-part is not in them. Common safe default: open at safe height over a scrap-safe spot, run the empty path — your call.',
        citation: 'SDCStandardPNP 100/103/106 — known carry/empty only',
      });
    } else {
      uncovered.push({
        machine: mName, scenario: `power-up with ${gName} closed`,
        question: `Power-up with ${gName} closed — what does initialization do?`,
        proposedSolution: 'The SDCStandardPNP 106 carry-forward shape is the standard when a part could be held.',
        citation: 'SDCStandardPNP 106',
      });
    }
  }

  // Machines with motion devices but no initialization at all.
  for (const m of machines) {
    const owned = realDevices.filter(d => machineOf([m], d));
    const motion = owned.filter(d => isMotion(d) && !isGripper(d));
    if (motion.length && !(m.faultRecovery ?? []).length && !(m.faultRecoverySteps ?? []).length) {
      uncovered.push({
        machine: m.name, scenario: 'power-up with motion devices in unknown positions',
        question: `No initialization is defined for ${m.name} — what brings ${motion.map(d => d.displayName ?? d.name).join(', ')} home safely?`,
        proposedSolution: 'The standard shape: retract the vertical/feed motion first, then return laterals (SDCStandardPNP 100).',
        citation: 'SDCStandardPNP 100',
      });
    } else if (motion.length) {
      covered.push({ machine: m.name, scenario: 'power-up with slides/axes mid-stroke', path: 'retract-first standard move (SDCStandardPNP 100) + approved branches' });
    }
  }
  return { covered, uncovered };
}

module.exports = { checkInitCoverage };
