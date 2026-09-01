/**
 * regressMeExplicitNames.cjs — THE CLOBBER CLASS (Dan, 2026-09-01, Magnet
 * Dial): manual rename → chat "add a machine" → the rename must SURVIVE.
 * ME-explicit names (nameByME) are immutable facts through every
 * propose_split; an add appends, it never regenerates siblings.
 *
 * Run: node scripts/regressMeExplicitNames.cjs   (exit 0 = pass)
 */
const path = require('path');
const { createTurnState, executeTool } = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'agentTools.js'));

const failures = [];
const mk = (draft) => createTurnState(draft, {}, { speaker: 'Dan' });

// Dan's draft after his pencil rename (nameByME stamped by the UI).
const state = mk({
  smProposal: { stateMachines: [
    { name: 'Dial Index', oneLiner: 'indexes the dial' },
    { name: 'Magnet Shuttle', oneLiner: 'strips and stages magnets' },
    { name: 'Magnetic Pick', oneLiner: 'picks the magnet', nameByME: true },
  ] },
});

// The engine's add-turn: model re-emits the FULL list from memory, with the
// drifted engine name for the renamed machine, plus the new machine.
const r = executeTool(state, 'propose_split', {
  stateMachines: [
    { name: 'Dial Index', oneLiner: 'indexes the dial' },
    { name: 'Magnet Shuttle', oneLiner: 'strips and stages magnets' },
    { name: 'Magnet Pick', oneLiner: 'picks the magnet' }, // ← drifted!
    { name: 'Magnet Load Robot', oneLiner: 'hands off to the robot' }, // the add
  ],
  reasoning: 'Added the robot interface machine.',
});
if (r && r.error) failures.push(`add turn errored: ${r.error}`);
const names = (state.draft.smProposal.stateMachines ?? []).map((m) => m.name);
if (!names.includes('Magnetic Pick')) failures.push(`ME-explicit name clobbered — names now: ${names.join(', ')}`);
if (names.includes('Magnet Pick')) failures.push('the drifted engine name shipped alongside');
if (!names.includes('Magnet Load Robot')) failures.push('the ADD did not land');
if (names.length !== 4) failures.push(`expected 4 machines, got ${names.length}`);
const pinned = state.draft.smProposal.stateMachines.find((m) => m.name === 'Magnetic Pick');
if (!pinned?.nameByME) failures.push('nameByME did not survive the re-proposal');

if (failures.length) { console.error('FAILURES:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('manual rename -> chat add -> rename survives: PASS (' + names.join(', ') + ')');
