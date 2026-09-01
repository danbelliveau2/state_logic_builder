/**
 * regressReflexLane.cjs — DAN'S NO-OP ACCEPTANCE CASE (2026-09-01): the
 * message "rename the machines to <the names they already have>" must come
 * back "already exactly your names — nothing to change" in SECONDS.
 * HARD LATENCY ASSERTION: < 8s against the live API, no diffs, ME-explicit
 * names untouched. Plus one real rename to prove the lane edits too.
 *
 * Run: node scripts/regressReflexLane.cjs   (exit 0 = pass; needs API key)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runReflexTurn } = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'reflexTurn.js'));

const draft = {
  name: 'Magnet Dial',
  summary: { devices: [
    { displayName: 'Magnet Dial Index', type: 'ServoAxis' },
    { displayName: 'Pick Head', type: 'PneumaticLinearActuator', sensorArrangement: 'Ret only' },
  ] },
  smProposal: { stateMachines: [
    { name: 'Dial Index', oneLiner: 'indexes the dial', nameByME: false },
    { name: 'Magnet Shuttle', oneLiner: 'strips and stages magnets' },
    { name: 'Magnetic Pick', oneLiner: 'picks the magnet', nameByME: true },
    { name: 'Magnet Load Robot', oneLiner: 'hands off to the robot', nameByME: true },
  ] },
  deviceTombstones: [],
  chatThread: [],
};

async function main() {
  const failures = [];
  const times = [];

  // ── A. THE NO-OP (Dan's acceptance case) — 3 runs for an honest spread ──
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await runReflexTurn({
      draft, cascadePosition: { approvedMachineNames: [] },
      message: 'Rename the state machines to Dial Index, Magnet Shuttle, Magnetic Pick and Magnet Load Robot.',
    });
    const ms = Date.now() - t0;
    times.push(ms);
    if (!r.handled) { failures.push(`A${i}: escalated instead of no-op (${r.reason})`); continue; }
    if ((r.result.diffs ?? []).length) failures.push(`A${i}: no-op produced ${r.result.diffs.length} diff(s)`);
    if (ms >= 8000) failures.push(`A${i}: ${ms}ms >= 8s hard limit`);
    console.log(`A${i}. no-op: ${ms}ms — "${String(r.result.reply).slice(0, 90)}" ($${r.meta.costUSD}, ${r.meta.model})`);
  }
  times.sort((a, b) => a - b);
  console.log(`   latency spread: ${times.join(' / ')} ms (median ${times[1] ?? times[0]}ms)`);

  // ── B. A REAL rename edits through the same lane ─────────────────────────
  {
    const t0 = Date.now();
    const r = await runReflexTurn({
      draft, cascadePosition: { approvedMachineNames: [] },
      message: 'Rename Magnet Shuttle to Magnet Feed Shuttle.',
    });
    const ms = Date.now() - t0;
    if (!r.handled) failures.push(`B: escalated (${r.reason})`);
    else {
      const names = r.result.draft?.smProposal?.stateMachines?.map(m => m.name) ?? [];
      if (!names.includes('Magnet Feed Shuttle')) failures.push(`B: rename not applied — ${names.join(', ')}`);
      if (!names.includes('Magnetic Pick')) failures.push('B: ME-explicit sibling clobbered');
      if (!(r.result.diffs ?? []).length) failures.push('B: rename produced no diff');
      console.log(`B. real rename: ${ms}ms, diffs ${(r.result.diffs ?? []).length} — ${names.join(' | ')}`);
    }
  }

  // ── C. STRUCTURAL must escalate ──────────────────────────────────────────
  {
    const r = await runReflexTurn({
      draft, cascadePosition: { approvedMachineNames: [] },
      message: 'Split the shuttle machine into a feed machine and a strip machine, and rework the recovery so a jammed magnet homes everything.',
    });
    if (r.handled) failures.push('C: structural request did NOT escalate');
    else console.log(`C. structural: escalated (${r.reason}) — correct`);
  }

  if (failures.length) { console.error('\nFAILURES:\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\nReflex-lane regression PASS.');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
