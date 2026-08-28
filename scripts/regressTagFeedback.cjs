/**
 * regressTagFeedback.cjs — regression for Dan's Finger-tag misapply
 * (2026-08-28): tag-level feedback must NEVER delete sequence lines.
 *
 * Sends Dan's VERBATIM dictated transcript as a correction round against
 * the exact 13-line Escapement proposal it damaged, then asserts:
 *   - 0 line deletions: Home, the part-clear wait, and Repeat all survive
 *   - the two tag removals landed: Home and the Extend-Shuttle motion have
 *     NO counterpart in sequenceSteps
 *   - the real interactions keep theirs (part-ready signal, part-gripped
 *     wait, gripper-open signal, part-clear wait)
 *
 * Run: node scripts/regressTagFeedback.cjs   (costs one decompose round)
 */
const { decompose } = require('../src/lib/agentGenerator/smDecomposer.js');

const DAN_TRANSCRIPT = 'for your interactions with the sequence I like number one being in the '
  + "home position I don't think you need to interact with the pick and place and then for like "
  + "number seven your signaling part ready so number 6 or you also need to interact they can please "
  + "I don't think so all the other ones look good";

const PROPOSAL = [
  {
    name: 'Mid-Base Pick and Place',
    oneLiner: 'Owns the X Axis, Vertical Slide, and gripper; picks the mid-base off the shuttle and places it on the dial.',
    ownedDeviceNames: ['X Axis', 'Vertical Slide', 'Mid-Base Gripper'],
    why: 'Carries/places while the Escapement re-arms — the cycles overlap.',
    sequence: [
      "Wait for Mid-Base Escapement's part-ready signal",
      'Extend Vertical Slide down to pick',
      'Close Mid-Base Gripper',
      'Signal part gripped to Mid-Base Escapement',
      "Wait for Mid-Base Escapement's shuttle-gripper-open signal",
      'Retract Vertical Slide to clear height',
      'Signal part clear to Mid-Base Escapement',
      'Move X Axis to place position',
      "Wait for Dial's ready signal",
      'Extend Vertical Slide down to place',
      'Open Mid-Base Gripper',
      'Retract Vertical Slide',
      'Repeat',
    ],
  },
  {
    name: 'Mid-Base Escapement',
    oneLiner: 'Singulates mid-base parts off the track and presents each to Pick and Place.',
    ownedDeviceNames: ['Escapement Finger 1', 'Escapement Shuttle', 'Shuttle Gripper', 'Nest Part Present'],
    why: 'Re-arms for the next part while Pick and Place is still carrying the current one.',
    sequence: [
      'Home: Escapement Shuttle retracted and aligned with track, Shuttle Gripper open, Escapement Finger 1 extended holding the next part at the stop',
      'Retract Escapement Finger 1 to release the stopped part into the shuttle nest',
      'Wait for Nest Part Present sensor',
      'Close Shuttle Gripper on the part',
      'Extend Escapement Finger 1 to stop the next part in line',
      'Extend Escapement Shuttle to present the part to Mid-Base Pick and Place',
      'Signal part ready for pick to Mid-Base Pick and Place',
      "Wait for Mid-Base Pick and Place's part-gripped signal",
      'Open Shuttle Gripper',
      'Signal shuttle gripper open to Mid-Base Pick and Place',
      "Wait for Mid-Base Pick and Place's part-clear signal",
      'Retract Escapement Shuttle to return for the next part',
      'Repeat',
    ],
  },
];

const DESCRIPTION = 'Mid-base load station on the dial machine: a track feeds mid-base parts to an '
  + 'escapement; finger one stops the stack; the shuttle gripper closes on the lead part and the '
  + 'shuttle extends to present it; a pick and place with an X axis and vertical slide picks it off '
  + 'the shuttle nest and places it on the dial. The two run concurrently.';

(async () => {
  const feedback = `(the engineer is reviewing "Mid-Base Escapement interactions") ${DAN_TRANSCRIPT}`;
  const out = await decompose({
    description: `${DESCRIPTION}\n\n# CORRECTION ROUND — the engineer's feedback on the proposal\n${feedback}`,
    currentProposal: PROPOSAL,
    sheetDevices: PROPOSAL.flatMap((m) => m.ownedDeviceNames.map((n) => ({ name: n }))),
  });
  const esc = out.stateMachines.find((m) => /escapement/i.test(m.name));
  const seq = esc?.sequence ?? [];
  const steps = esc?.sequenceSteps ?? [];
  const has = (re) => seq.some((l) => re.test(String(l)));
  const stepBy = (re) => steps.find((s) => re.test(`${s.action ?? ''} ${s.target ?? ''} ${s.detail ?? ''} ${s.raw ?? ''}`));

  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); };

  check('0 deletions: Home survives', has(/^home\b/i));
  check('0 deletions: part-clear wait survives', has(/part.?clear/i));
  check('0 deletions: Repeat survives', has(/^repeat\b/i));
  check('0 deletions: >= 13 lines', seq.length >= 13, `got ${seq.length}`);
  const homeStep = stepBy(/^home/i);
  check('tag removed: Home has no counterpart', !homeStep || !String(homeStep.counterpart ?? '').trim());
  const shuttleMove = stepBy(/extend.*shuttle/i) ?? stepBy(/shuttle.*present/i);
  check('tag removed: Extend-Shuttle motion has no counterpart', !shuttleMove || !String(shuttleMove.counterpart ?? '').trim());
  const partReady = stepBy(/part.?ready/i);
  check('kept: part-ready Signal keeps counterpart', !!partReady && /pick/i.test(String(partReady.counterpart ?? '')));
  const partClear = stepBy(/part.?clear/i);
  check('kept: part-clear Wait keeps counterpart', !!partClear && /pick/i.test(String(partClear.counterpart ?? '')));
  // ONE VOCABULARY (Dan, 2026-08-28): grippers engage/disengage, never open/close.
  check('vocabulary: no Open/Close gripper lines', !seq.some((l) => /^(open|close)\b.*gripper/i.test(String(l))));
  check('vocabulary: gripper uses Engage/Disengage', seq.some((l) => /^(engage|disengage)\b.*gripper/i.test(String(l))));

  let fail = 0;
  for (const r of results) {
    if (!r.ok) fail++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? ` (${r.extra})` : ''}`);
  }
  console.log(`\nEscapement sequence returned (${seq.length} lines):`);
  seq.forEach((l, i) => console.log(` ${i + 1}. ${l}`));
  console.log(`\ncost: $${out.meta?.costUSD ?? '?'}  checker: ${out.checked?.verdict ?? 'n/a'}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('regression errored:', e.message); process.exit(2); });
