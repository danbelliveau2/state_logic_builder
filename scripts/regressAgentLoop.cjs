/**
 * regressAgentLoop.cjs — the agent loop's regression fixtures (Dan's real
 * transcripts through the REAL loop; Phase 1 acceptance, 2026-08-28).
 *
 *   A. Tag-misapply transcript  → exactly 2 tag clears, 0 line deletions
 *   B. "get rid of finger 2"    → atomic device removal (row + ownership +
 *                                  question closed), nothing else deleted
 *   C. Answer-from-precedent    → open question closed with a citation,
 *                                  no engineer question filed for it
 *
 * Run: node -r dotenv/config scripts/regressAgentLoop.cjs   (3 paid turns)
 */
const { runAgentTurn } = require('../src/lib/agentGenerator/agentLoop.js');
const { stepText } = require('../src/lib/agentGenerator/smDecomposer.js');

const S = (action, target, detail, counterpart) => ({ action, target, detail: detail ?? '', counterpart: counterpart ?? '' });
const ESC_STEPS = [
  S('Home', '', 'Escapement Shuttle retracted, Shuttle Gripper disengaged, Escapement Finger 1 extended holding the next part at the stop', 'Mid-Base Pick and Place'),
  S('Retract', 'Escapement Finger 1', 'release the stopped part into the shuttle nest'),
  S('Wait', 'Nest Part Present sensor'),
  S('Engage', 'Shuttle Gripper', 'on the part'),
  S('Extend', 'Escapement Finger 1', 'stop the next part in line'),
  S('Extend', 'Escapement Shuttle', 'present the part to Mid-Base Pick and Place', 'Mid-Base Pick and Place'),
  S('Signal', 'part ready for pick', '', 'Mid-Base Pick and Place'),
  S('Wait', 'part-gripped', '', 'Mid-Base Pick and Place'),
  S('Disengage', 'Shuttle Gripper'),
  S('Signal', 'shuttle gripper open', '', 'Mid-Base Pick and Place'),
  S('Wait', 'part-clear', '', 'Mid-Base Pick and Place'),
  S('Retract', 'Escapement Shuttle', 'return for the next part'),
  S('Repeat', ''),
];

function freshDraft() {
  return {
    name: 'MidBaseLoad',
    summary: {
      devices: [
        { name: 'EscapementFinger1' }, { name: 'EscapementFinger2' },
        { name: 'ShuttleGripper' }, { name: 'NestPartPresent', type: 'DigitalSensor' },
      ],
      sequence: [], failureHandling: [], interactions: [],
    },
    smProposal: {
      stateMachines: [
        {
          name: 'Mid-Base Escapement',
          ownedDeviceNames: ['Escapement Finger 1', 'Escapement Finger 2', 'Shuttle Gripper', 'Nest Part Present'],
          sequence: ESC_STEPS.map(stepText), sequenceSteps: JSON.parse(JSON.stringify(ESC_STEPS)),
          faultRecovery: [],
        },
        {
          name: 'Mid-Base Pick and Place', ownedDeviceNames: ['X Axis'],
          sequence: ['Signal part gripped to Mid-Base Escapement'], faultRecovery: [],
        },
      ],
    },
    jarvisCoverage: {
      devices: {
        needs: [
          { question: 'Escapement finger 2 — when does it actuate relative to finger 1?' },
          { question: 'What debounce on/off time should the Nest Part Present sensor use?' },
        ],
      },
    },
    agreedNeeds: [], deviceAssignments: {}, chatThread: [],
  };
}
const CASCADE = {
  activeStep: { kind: 'interactions', smKey: 'midbaseescapement', label: 'Mid-Base Escapement interactions' },
  approved: [], approvedMachineNames: ['Mid-Base Escapement', 'Mid-Base Pick and Place'],
};

const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok, extra });

(async () => {
  // ── A. the tag-misapply transcript ────────────────────────────────────────
  {
    const r = await runAgentTurn({
      draft: freshDraft(), cascadePosition: CASCADE,
      message: "for your interactions with the sequence I like number one being in the home position I don't think you need to interact with the pick and place and then for like number seven your signaling part ready so number 6 or you also need to interact they can please I don't think so all the other ones look good",
    });
    const esc = r.draft.smProposal.stateMachines[0];
    const clears = r.diffs.filter((d) => d.op === 'sequence.clear_tag');
    check('A: 2 tag clears', clears.length === 2, `got ${clears.length}`);
    check('A: 0 line deletions', !r.diffs.some((d) => d.op === 'sequence.remove'), r.diffs.map((d) => d.op).join(','));
    check('A: 13 lines intact', esc.sequence.length === 13, `got ${esc.sequence.length}`);
    check('A: line 1 + 6 untagged, 7 still tagged',
      !esc.sequenceSteps[0].counterpart && !esc.sequenceSteps[5].counterpart && !!esc.sequenceSteps[6].counterpart);
    console.log(`A done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }
  // ── B. atomic device removal ──────────────────────────────────────────────
  {
    const r = await runAgentTurn({
      draft: freshDraft(),
      cascadePosition: { ...CASCADE, activeStep: { kind: 'devices', smKey: 'midbaseescapement', label: 'Mid-Base Escapement devices' } },
      message: "okay so finger one and finger too so that's when we run different parts so all they are is a stop so in this case you can just get rid of finger 2 we're not going to use that we're just just assume figure one",
    });
    const esc = r.draft.smProposal.stateMachines[0];
    check('B: sheet row gone', !r.draft.summary.devices.some((x) => /finger2/i.test(x.name)));
    check('B: ownership gone', !esc.ownedDeviceNames.some((n) => /finger (2|two)/i.test(n)));
    check('B: its question auto-closed', (r.draft.agreedNeeds ?? []).some((k) => /finger 2/i.test(k)));
    check('B: finger 1 untouched', r.draft.summary.devices.some((x) => /finger1/i.test(x.name)));
    check('B: used device.remove', r.diffs.some((d) => d.op === 'device.remove'));
    console.log(`B done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
    if (r.draft.summary.devices.some((x) => /finger2/i.test(x.name))) {
      console.log('B diffs (row survived):', JSON.stringify(r.diffs));
    }
  }
  // ── C. answer a question from shipped work, with citation ────────────────
  {
    const r = await runAgentTurn({
      draft: freshDraft(),
      cascadePosition: { ...CASCADE, activeStep: { kind: 'devices', smKey: 'midbaseescapement', label: 'Mid-Base Escapement devices' } },
      message: 'before I answer anything — can you answer any of your own open questions from our standards or shipped work? Take the ones you can and leave me only what you truly need me for.',
    });
    const closed = r.diffs.filter((d) => d.op === 'question.close');
    check('C: closed at least one question', closed.length >= 1, `closed ${closed.length}`);
    const debounceClosed = closed.some((d) => /debounce/i.test(d.before ?? ''));
    check('C: the debounce question (answerable from standards) closed', debounceClosed);
    const cited = closed.some((d) => String(d.answer ?? '').length > 10);
    check('C: with an answer/citation recorded', cited, JSON.stringify(closed.map((d) => d.answer)));
    // The computed receipt carries turns with diffs; the reply adds only
    // what diffs cannot say. Non-silent = reply OR diffs.
    check('C: never silent (reply or diffs)', !!String(r.reply ?? '').trim() || r.diffs.length > 0);
    console.log(`C done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }

  // ── D. parallel/batched edits — transcript validity under multi-tool turns
  //    (the malformed-transcript 400 Dan hit, 2026-08-30) ────────────────────
  {
    const r = await runAgentTurn({
      draft: freshDraft(), cascadePosition: CASCADE,
      message: 'three things at once: clear the tag on line 1, clear the tag on line 6, and rename the Shuttle Gripper to Nest Gripper',
    });
    check('D: multi-edit turn completed (no 400)', true);
    check('D: all three edits applied',
      r.diffs.filter((d) => d.op === 'sequence.clear_tag').length === 2
      && r.diffs.some((d) => d.op === 'device.rename' && /nest gripper/i.test(d.after ?? '')),
      r.diffs.map((d) => d.op).join(','));
    console.log(`D done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }
  // ── E. Dan's recovery sentence: recovery drafts, sequence untouched ───────
  {
    const draft = freshDraft();
    const seqBefore = JSON.stringify(draft.smProposal.stateMachines[0].sequence);
    const r = await runAgentTurn({
      draft,
      // His sentence is the PnP's recovery (Z + place/pick) — walk there.
      cascadePosition: { ...CASCADE, activeStep: { kind: 'recovery', smKey: 'midbasepickandplace', label: 'Mid-Base Pick and Place recovery' } },
      message: 'recovery is always retract z, then check gripper status if gripped move to place if not move to pick',
    });
    const esc = r.draft.smProposal.stateMachines[0];
    const recovered = r.draft.smProposal.stateMachines.find(m => (m.faultRecovery?.length ?? 0) >= 3);
    check('E: fault recovery drafted', !!recovered, recovered ? `${recovered.name}: ${recovered.faultRecovery.length} lines` : '0 lines everywhere');
    check('E: recovery ops used (not sequence ops)',
      r.diffs.some((d) => /^recovery\./.test(d.op)) && !r.diffs.some((d) => /^sequence\.(insert|remove|reword)$/.test(d.op)),
      r.diffs.map((d) => d.op).join(','));
    check('E: sequence untouched', JSON.stringify(esc.sequence) === seqBefore);
    console.log(`E done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }

  // ── F. Dan's two-part answer (2026-08-30): EVERY open question walks the
  //    WHOLE message; the reply is the speaking layer (no mechanics). ───────
  {
    const draft = freshDraft();
    draft.jarvisCoverage = {
      failures: {
        needs: [
          { question: 'What happens if no part feeds into the nest?', proposedSolution: 'Sit and wait on part-present (starved, no fault).' },
          { question: 'Any check that the part actually landed on the dial fixture?', proposedSolution: 'No place-side check.' },
        ],
      },
    };
    const r = await runAgentTurn({
      draft,
      cascadePosition: { ...CASCADE, activeStep: { kind: 'recovery', smKey: 'midbaseescapement', label: 'Mid-Base Escapement recovery' } },
      message: "Answer to question one. It would sit there and wait and eventually time out. But you should look at, do you have any examples of this in any of the code files you're training on? Maybe a 10-second wait, then if it doesn't have a part for 30 seconds it would fault. Or keep the machine live, send an HMI warning at 10 seconds, and fault a minute later. For question two, no. Well, we always check. But a lot of times, when we load, the next station will be a check station. In this case, we don't have that.",
    });
    const agreed = r.draft.agreedNeeds ?? [];
    check('F: Q1 closed from part one', agreed.some((k) => /no part feeds/i.test(k)));
    check('F: Q2 closed from part two', agreed.some((k) => /landed on the dial/i.test(k)));
    const reply = String(r.reply ?? '');
    check('F: speaking layer — no mechanics vocabulary',
      !/\b(tool|diff|cap|ops?|read-back|reopen)\b/i.test(reply) && !/\(\d+ lines?\)/.test(reply) && !/tags only/i.test(reply),
      reply.slice(0, 120));
    console.log(`F done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }

  let fail = 0;
  for (const x of results) {
    if (!x.ok) fail++;
    console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.extra ? ` (${x.extra})` : ''}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('regression errored:', e.message); process.exit(2); });
