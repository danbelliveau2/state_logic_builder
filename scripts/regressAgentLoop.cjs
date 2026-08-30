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
// THE EMBEDDED HARNESS (Dan, 2026-08-30): fixtures run through the Claude
// Agent SDK engine — the hand-rolled loop is deleted (one-door law).
const { runAgentTurn } = require('../src/lib/agentGenerator/agentLoopSdk.js');
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

// FIXTURES=H,I node -r dotenv/config scripts/regressAgentLoop.cjs → run a subset
const ONLY = (process.env.FIXTURES ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);

(async () => {
  // ── A. the tag-misapply transcript ────────────────────────────────────────
  if (want('A')) {
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
  if (want('B')) {
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
  if (want('C')) {
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
  if (want('D')) {
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
  if (want('E')) {
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
  if (want('F')) {
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

  // ── G. multi-intent message (Dan's dropped Escapement recovery,
  //    2026-08-30): recovery description + open questions in ONE message —
  //    EVERY intent lands; nothing silently dropped. ─────────────────────────
  if (want('G')) {
    const draft = freshDraft();
    draft.jarvisCoverage = {
      failures: { needs: [{ question: 'What happens if no part feeds into the nest?', proposedSolution: 'Sit and wait on part-present.' }] },
    };
    const r = await runAgentTurn({
      draft,
      cascadePosition: { ...CASCADE, activeStep: { kind: 'recovery', smKey: 'midbaseescapement', label: 'Mid-Base Escapement recovery' } },
      message: "For the escapement, the recovery is: check to see if you're gripped. If you're gripped, then check if you're at the load station for the pick and place. If you are, you're good. If gripped and not at the load station, extend to the load station and be ready and waiting given you have a part — part plus gripped means ready for pick and place. If no part or not gripped, open up, reset, and go back — home position is gripper open, slide retracted to line up with the feeder bowl, and escapement finger down. And for your question, if no part feeds it just waits at home.",
    });
    const esc = r.draft.smProposal.stateMachines[0];
    check('G: recovery drafted with the gripper branch', (esc.faultRecovery ?? []).filter((l) => /gripp/i.test(l)).length >= 2, `${(esc.faultRecovery ?? []).length} lines`);
    check('G: home reset lands (gripper open + retract + finger)',
      (esc.faultRecovery ?? []).some((l) => /disengage/i.test(l)) && (esc.faultRecovery ?? []).some((l) => /retract/i.test(l)));
    check('G: the question in the SAME message also closed', (r.draft.agreedNeeds ?? []).some((k) => /no part feeds/i.test(k)));
    check('G: sequence untouched', !r.diffs.some((d) => /^sequence\.(insert|remove|reword)$/.test(d.op)));
    console.log(`G done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }

  // ── H. THE DECOMPOSE GATE (Phase 2, Dan 2026-08-30): his MidBaseLoad
  //    explanation VERBATIM → the gate proposes a 2-machine split via
  //    propose_split, domain-checked. ─────────────────────────────────────────
  const MIDBASE_EXPLANATION = "Okay, so this station loads a plastic component called a mid-base. Mid-base is fed through a vibratory feeder bowl, a Belco feeder. It's fed to the end of the track. We have an escapement, pneumatic escapement, and then ultimately it's a pick-and-place that places it onto a dial. So for the pick-and-place, as you can see from the picture, it's a servo X-axis and then a pneumatic Z, and then there's a gripper assembly on the end. The pneumatic Z is just an MXS slide, standard SDC slide. It's a pretty long one. It's 150 millimeter stroke, so let's say it's going to take— there's a retract sensor only, so when we do extend, we plan on it taking a second. The gripper on the end has no sensors. This timer is 250 milliseconds. And then obviously the servo X works, you know, just like any other servo that we've used. In this case, you know, we would want to use all our standard servo moves for the X-axis of a pick-and-place. As far as the escapement, it's a little bit of a complicated escapement. So there's two kind of like eightment stops on the end of the track, and then there's a gripper and a shuttle down below. So basically you have this another MXS slide on the bottom, and when it's extended— well, I guess we'll say when it's retracted, although it's technically the extended state of the cylinder, you can see it lines up with the track and both the escapement fingers from the track are up and out of the way. Part feeds through into the dead nest that is on our shuttle, escapement shuttle down below, and once it feeds in, there's a sensor that reads it, and then the gripper closes, and then once the gripper closes, escapement finger number one would extend, and then at that point, you would extend your bottom shuttle to get the part away from the track, and your escapement finger one is holding back the parts in the inline, and then you would move away. You'd set a command, say, Hey, now I'm ready for pick. You know, the pick-and-place would come down, pick that part up. The gripper would— the sequence there would be the gripper would grab the part, pick-and-place gripper would grab the part, then the shuttle gripper would open, pull it up, and once you're pulled up out of the way, then the shuttle can go back and get the next one. And then once you're back in position with the shuttle escapement shuttle, then you would retract the track escapement fingers so that the next part could feed out. Once it's fed out, sensor sees it, grab it, escapement fingers come back down. You pull it back out again, and off you go. For the pick-and-place too, you are loading into the dial. So once you grab the part, you retract up, wait for the dial to be ready, and then you zip over, come down, and drop the part off. My thinking here is you have two state machines, one for the pick-and-place and one for the escapement. But I'd like to hear your ideas or thoughts, and once you look at this, what you think is the best approach here.";
  if (want('H')) {
    const draft = { name: 'MidBaseLoad', description: MIDBASE_EXPLANATION, summary: { devices: [], sequence: [], failureHandling: [], interactions: [] }, agreedNeeds: [], chatThread: [] };
    const r = await runAgentTurn({
      draft, gate: 'decompose',
      cascadePosition: { approvedMachineNames: [] },
      message: 'Propose the machine split for this station from my explanation.',
    });
    const ms = r.draft.smProposal?.stateMachines ?? [];
    check('H: propose_split used', r.diffs.some((d) => d.op === 'split.propose'), r.diffs.map((d) => d.op).join(','));
    check('H: 2 machines', ms.length === 2, ms.map((m) => m.name).join(' | '));
    check('H: pick-and-place + escapement identified',
      ms.some((m) => /pick.?(and|&|n).?place|pnp/i.test(m.name)) && ms.some((m) => /escapement/i.test(m.name)),
      ms.map((m) => m.name).join(' | '));
    check('H: both machines carry sequences', ms.every((m) => (m.sequence?.length ?? 0) >= 5),
      ms.map((m) => `${m.name}:${m.sequence?.length ?? 0}`).join(' | '));
    check('H: handshakes both sides (gripped/clear signals paired)',
      ms.every((m) => (m.sequenceSteps ?? []).some((s) => String(s.counterpart ?? '').length > 0)),
      'counterpart tags per machine');
    console.log(`H done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }
  // ── I. IDENTITY LOCK on correction rounds: approved machine names survive
  //    a split correction VERBATIM (exact spelling). ─────────────────────────
  if (want('I')) {
    const draft = freshDraft();
    draft.description = MIDBASE_EXPLANATION;
    const r = await runAgentTurn({
      draft, gate: 'decompose',
      cascadePosition: { approvedMachineNames: ['Mid-Base Escapement', 'Mid-Base Pick and Place'] },
      message: 'On the split: the shuttle gripper interactions feel thin — re-propose with the pick handshake spelled out (part ready, part gripped, part clear) on both machines. Keep it two machines.',
    });
    const ms = r.draft.smProposal?.stateMachines ?? [];
    const names = ms.map((m) => m.name);
    check('I: still 2 machines', ms.length === 2, names.join(' | '));
    check('I: approved names survive EXACT', names.includes('Mid-Base Escapement') && names.includes('Mid-Base Pick and Place'), names.join(' | '));
    check('I: correction landed (handshake spelled out on both)',
      ms.every((m) => (m.sequence ?? []).filter((l) => /grip|ready|clear/i.test(l)).length >= 2),
      ms.map((m) => `${m.name}:${(m.sequence ?? []).filter((l) => /grip|ready|clear/i.test(l)).length}`).join(' | '));
    console.log(`I done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }

  // ── J. LINKED-SHEET CORRECTION (Phase 2): a built station's sheet rides as
  //    a single-machine pseudo-proposal (name = station, sequence/recovery
  //    from the sheet). Corrections must edit THAT shape through the same
  //    typed ops — no machine invention, devices intact. ─────────────────────
  if (want('J')) {
    const draft = {
      name: 'MidBaseLoad',
      description: 'Built station: mid-base load. The sheet is the living spec.',
      summary: {
        devices: [
          { name: 'EscapementFinger1' }, { name: 'ShuttleGripper' },
          { name: 'NestPartPresent', type: 'DigitalSensor' },
        ],
        sequence: [], failureHandling: [], interactions: [],
      },
      smProposal: {
        stateMachines: [{
          name: 'MidBaseLoad', oneLiner: '', why: '',
          ownedDeviceNames: ['Escapement Finger 1', 'Shuttle Gripper', 'Nest Part Present'],
          sequence: ESC_STEPS.map(stepText), sequenceSteps: JSON.parse(JSON.stringify(ESC_STEPS)),
          faultRecovery: [],
        }],
      },
      agreedNeeds: [], deviceAssignments: {}, chatThread: [],
    };
    const r = await runAgentTurn({
      draft,
      cascadePosition: { approvedMachineNames: ['MidBaseLoad'] },
      message: 'On the built sheet: the shuttle gripper should engage only AFTER escapement finger 1 extends to stop the next part — swap those two steps. Everything else stays.',
    });
    const m = r.draft.smProposal.stateMachines[0];
    const idxEngage = (m.sequence ?? []).findIndex((l) => /engage.*gripper/i.test(l));
    // (no detail-clause law: pneumatic lines may be just "Extend Escapement Finger 1")
    const idxFinger = (m.sequence ?? []).findIndex((l) => /extend.*finger 1/i.test(l));
    check('J: still one machine, name intact', r.draft.smProposal.stateMachines.length === 1 && m.name === 'MidBaseLoad',
      r.draft.smProposal.stateMachines.map((x) => x.name).join(' | '));
    check('J: the swap landed (finger extend before gripper engage)', idxFinger >= 0 && idxEngage > idxFinger,
      `finger@${idxFinger} engage@${idxEngage}`);
    check('J: line count unchanged', (m.sequence ?? []).length === 13, `got ${(m.sequence ?? []).length}`);
    check('J: devices untouched', r.draft.summary.devices.length === 3 && !r.diffs.some((d) => /^device\.(remove|rename)/.test(d.op)));
    console.log(`J done — $${r.meta.costUSD}, ${r.meta.toolCalls} calls, ${r.meta.ms}ms${r.meta.bounced ? ', bounced' : ''}`);
  }

  let fail = 0;
  for (const x of results) {
    if (!x.ok) fail++;
    console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.extra ? ` (${x.extra})` : ''}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('regression errored:', e.message); process.exit(2); });
