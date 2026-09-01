/**
 * AppFlowTab — "App flow": the layers of how the create-station pipeline is
 * ACTUALLY constructed, stage by stage (Dan, 2026-08-28: "I need to
 * understand the layers of how this is currently constructed, and then we
 * can work together on how to improve them... how you're thinking, how
 * you're checking, what information you're pulling when").
 *
 * ⚠ HONESTY CONTRACT: this page documents what IS, hand-written from the
 * real wiring (CreateStationPage.jsx, smDecomposer.js, specAuthor.js,
 * agentGenerator pipeline). When the pipeline changes, UPDATE THIS PAGE in
 * the same commit and note it in whatsNew.js — a stale flow page is worse
 * than none. It is shown to Jason and the leads, not just Dan.
 *
 * Style laws: plain SDC speech, second person, no jargon walls, narrow
 * readable column, no parenthetical habit.
 */

const C = {
  primary: 'var(--color-primary)',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  surface: 'var(--color-surface)',
};

// Row labels inside every stage card — Dan's framing, kept verbatim.
const ROWS = [
  ['do', 'What I do'],
  ['loads', 'What SDC Engineer loads'],
  ['think', 'The thinking'],
  ['check', 'The check'],
  ['back', 'What comes back'],
  ['moves', 'Your two moves'],
];

/* The knowledge sources named ONCE, plainly, then referenced by the stages. */
const SOURCES = [
  ['Standing knowledge', 'The laws and every ruling you’ve ever filed — dated, append-only. When you answer a question once, the answer lives here forever.'],
  ['Shipped-work precedents', 'A compact digest of our shipped projects — real device names, station patterns, who owned what. Harvested offline from the good corpus, not guessed.'],
  ['Station archetype notes', 'What a dial station, an escapement, a pick and place, a feeder bowl each look like at SDC — the thousand-bowl facts.'],
  ['Verified exemplars', 'Builds a controls lead confirmed correct. Top-rank reference at Generate time.'],
  ['Your sheet so far', 'The devices, positions, and sequences already on this draft — dictated words resolve against these real names.'],
  ['This draft’s chat', 'Everything you’ve said this session, plus the change log — so a correction round knows the whole conversation.'],
];

const STAGES = [
  {
    n: '1', title: 'You explain the station',
    rows: {
      do: 'You paste reference material — pictures, a BOM — and dictate or type your explanation of the station. Hit submit. You can come back and edit this explanation at any point in the walk; an edit re-runs the thinking and reconciles with what you already approved.',
      loads: 'Standing knowledge, shipped-work precedents, station archetype notes, and your sheet’s device names ride into the call — by construction, every time. SKILLS LOAD BY RELEVANCE (Dan, 2026-09-01): only the knowledge modules the turn touches ride (servo mentioned → servo motion; pneumatics → pneumatics; a dial machine → indexing patterns) plus the core grammar — see the Skills tab for every module and its triggers. On a revision it also carries the current proposal so nothing you approved gets rebuilt from scratch.',
      think: 'The decomposer answers one question: how does this station split into state machines, the SDC way — what truly runs at the same time. A purely sequential station is one machine; real overlap in time is what earns a second one.',
      check: 'Before anything renders, a second, independent pass checks the split: is each machine justified by real asynchrony, are the names natural SDC speech, is every device you mentioned owned by somebody. It gets one bounce to fix what it finds. On later rounds it also verifies your feedback was actually applied — and it is never allowed to rename a machine you approved.',
      back: 'The split proposal: each machine’s name, what it owns, its draft sequence, and one or two sentences of reasoning spoken to you. Internal reviewer notes never print.',
      moves: 'Approve locks the split and opens the first machine’s devices step. Or talk back in the chat — your words re-enter the same engine with the proposal riding along; what you didn’t touch carries forward verbatim, and the changes show as a live diff on the card with a one-line receipt.',
    },
  },
  {
    n: '2', title: 'The state-machine proposal',
    rows: {
      do: 'You read the breakup — how many machines, what each owns, why they must run separately — and approve it or argue with it, in this one place.',
      loads: 'Same load as stage one. Arguing sends your words plus the standing proposal back through the decomposer, never a lighter path.',
      think: 'On an argument round the engine re-thinks the whole split against your words: merge, split, rename, reassign — whatever your reasoning demands.',
      check: 'Same checker, same one bounce. Approved machine names are locked identities from here on.',
      back: 'The revised proposal with a receipt naming what changed.',
      moves: 'Approve — the walk begins at machine one. Or keep arguing; every round is the full engine.',
    },
  },
  {
    n: '3', title: 'Devices — one machine at a time',
    rows: {
      do: 'You review which devices this machine owns, with their types. Rename or reassign right there.',
      loads: 'Shipped-work precedents and archetype notes — device placement is decided from what SDC has actually built, with the evidence named.',
      think: 'An assignment agent decides each device’s home. Precedent-backed placements are made confidently and cite the shipped pattern — a feeder bowl belongs to the feeding machine because every dial station we’ve shipped does it that way.',
      check: 'A checker pass audits every ownership claim and every cited precedent. A claim the knowledge doesn’t support is a violation.',
      back: 'Each device on its machine, and where the call was precedent-backed, the citation. Where there is no precedent, SDC Engineer says so plainly — I searched our shipped work and standards and found no example — and asks you once. Your answer files as dated doctrine and is never asked again.',
      moves: 'Approve locks this machine’s devices and reveals its sequence step. Or move a device by saying so — an explicit move is your directive; the engine records it as ME-decided.',
    },
  },
  {
    n: '4', title: 'Sequence',
    rows: {
      do: 'You read the machine’s sequence — one action per line, nothing else. Timing values and settings live on the device sheet, not in the lines.',
      loads: 'The full load, plus this draft’s chat history — a garbled dictated word resolves against the sheet’s real names from context, never from an alias table.',
      think: 'A correction re-thinks this machine’s whole sequence against your words. Approval with comments is approval plus edits — every comment must land.',
      check: 'The checker verifies each of your edits actually shows up in the revision, the SDC way. A missing edit is named precisely and bounced once.',
      back: 'The updated sequence with a live diff on the card: removed lines struck through, new or changed lines highlighted, until you click got it. One-line receipt in the chat. If something you asked for was honored somewhere other than a visible line — say, folded into a device parameter — SDC Engineer tells you where it went. Your request never silently vanishes.',
      moves: 'Approve reveals this machine’s interactions step. Or correct — same engine, same diff. Feedback about a machine you haven’t walked yet is stored silently; you find it applied when the walk arrives.',
    },
  },
  {
    n: '5', title: 'Interactions',
    rows: {
      do: 'You review the signals between this machine and the others — who signals whom, and when. Nothing is stored separately here: the sequence is the single source, and this step is a lens over it.',
      loads: 'The multi-machine concept notes: at SDC the producing machine sets and clears its signals at its own state transitions.',
      think: 'Which sequence lines talk to a counterpart, and the scope of each — another machine in this same station is program-to-program signaling inside the station; a different station entirely goes through the station’s external interface. That distinction drives the generated code.',
      check: 'Both sides of every signal must exist — a wait with no setter, or a setter nobody waits on, is a violation.',
      back: 'The signal lines tagged in the sequence with their counterpart and scope, and the grouped review list derived from them — complete and correct?',
      moves: 'Approve reveals fault recovery. Or correct the sequence — the lens follows it, because it is derived from it.',
    },
  },
  {
    n: '6', title: 'Initialization',
    rows: {
      do: 'You review what this machine does when a step faults — what retracts, what disengages, where it lands. It renders in the same block as the sequence, side by side: the cycle in order, and how it recovers. Always its own approve step, for every machine.',
      loads: 'Standing knowledge and the archetype notes — recovery follows the shipped init patterns: retract vertical, then travel, land in a known safe state.',
      think: 'A safe path home from every stage of the cycle, part-in-gripper and empty handled separately.',
      check: 'Same checker discipline.',
      back: 'The recovery outline. Approving it finishes this machine — the walk moves to the next machine and repeats stages three through six.',
      moves: 'Approve, or correct. When the last machine’s recovery is approved, the station is done. Never before.',
    },
  },
  {
    n: '7', title: 'Accept the station — or generate it now',
    rows: {
      do: 'The real workflow: stations get built and ACCEPTED one after another; code generates for the whole machine at the end. At the end of a walk you choose — accept the station and move to the next (it banks, no code yet), or generate this station’s code now for testing.',
      think: 'Accepting is your call, not a model call.',
      back: 'An accepted station is banked. When every station is accepted, the machine-level Generate takes the overall structure you specify, the bill of materials, and the cross-station signals already tagged in the sequences (this is where those tags pay off — they wire up across programs) and emits the whole machine’s code in one build, so everything interacts correctly. Machine-level generate is on the roadmap; station-level generate is what runs today. A finished station can also be reopened later with “Add features”: you describe the addition, only the affected steps reopen showing a diff against the accepted state, you walk just the deltas, and the addition files into the station’s permanent explanation — dated — so the record always reads as what the station is now.',
      moves: 'Accept and move on, or generate for testing.',
    },
  },
  {
    n: '8', title: 'Build station code',
    rows: {
      do: 'You hit Build Station. The approved flow IS the diagram (already on the sheet) — this stage is only about code: it compiles the state numbering, tags, and init pattern from the same structured steps you approved on the cards; nothing new is invented here.',
      loads: 'Everything: the approved spec in full, standing knowledge, precedents, the verified exemplar library, and the SDC template patterns.',
      think: 'A study pass reads everything before a line is written — the plan for every state on the SDC number grid, every transition condition, waits, retries, cross-machine signals, recovery. Then the code is written once against that plan, not iterated into shape. Every structural choice cites the SDC template pattern it follows or declares itself an extension.',
      check: 'Internal review rounds walk the output against Jason’s process — each finding traces to the step it violates — and the file is validated for import before you ever see it.',
      back: 'The diagram and the L5X, plus the record of how it was planned. Anything only you can know — positions, mechanical intent — was asked during the walk, not invented here.',
      moves: 'Two lanes: Accept Station banks the sheet and returns you to the machine homepage to add the next station — code for the whole machine builds at the end; or Build Station Code builds this station alone now. Corrections after a build are analyzed into lessons, not just patched.',
    },
  },
  {
    n: '9', title: 'Verify — and SDC Engineer learns',
    rows: {
      do: 'A controls lead runs the code, scores it, files corrections or confirms it.',
      loads: '—',
      think: 'Each correction is analyzed for the general lesson behind it.',
      check: 'A lesson only files when the correction actually supports it.',
      back: 'Corrections become filed doctrine in the standing knowledge — dated, permanent. A verified build becomes a top-rank exemplar the next Generate studies first.',
      moves: 'This is the loop: every station you build makes the next one better.',
    },
  },
];

function StageCard({ s }) {
  return (
    <div
      data-testid={`appflow-stage-${s.n}`}
      style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '14px 16px', marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{
          fontSize: 12, fontWeight: 800, color: '#fff', background: C.primary,
          borderRadius: 4, padding: '1px 8px', flexShrink: 0,
        }}>{s.n}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{s.title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '148px 1fr', gap: '7px 14px' }}>
        {ROWS.map(([k, label]) => (
          s.rows[k] && s.rows[k] !== '—' ? (
            <div key={k} style={{ display: 'contents' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, paddingTop: 1 }}>{label}</div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{s.rows[k]}</div>
            </div>
          ) : null
        ))}
      </div>
    </div>
  );
}

export function AppFlowTab() {
  return (
    <div data-testid="jarvis-appflow-tab" style={{ maxWidth: 780 }}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        <b style={{ color: C.text }}>How the create-station pipeline is built, layer by layer.</b>{' '}
        This is the actual current wiring — what you do, what SDC Engineer pulls in,
        how he thinks, how he checks himself, and what your approval fires.
        When the pipeline changes, this page changes with it.
      </div>

      {/* THE SOURCES — named once, plainly */}
      <div
        data-testid="appflow-sources"
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 14 }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 8 }}>
          What SDC Engineer pulls from — the six sources
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '6px 14px' }}>
          {SOURCES.map(([name, what]) => (
            <div key={name} style={{ display: 'contents' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text, paddingTop: 1 }}>{name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{what}</div>
            </div>
          ))}
        </div>
      </div>

      {STAGES.map(s => <StageCard key={s.n} s={s} />)}

      {/* THE MEMORY MODEL — honest */}
      <div
        data-testid="appflow-memory"
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginTop: 4, marginBottom: 10 }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>The memory model — how this actually works</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.65 }}>
          A model call knows only what rides in with it — nothing else. So
          SDC Engineer does not remember projects the way you do. Instead, shipped
          projects are distilled offline into compact knowledge — the
          precedent digest, the archetype notes, the standing laws — and that
          distillate is physically carried on every single call, cached so it
          costs almost nothing. When we say SDC Engineer learned something, we mean
          the distillate grew: your ruling was filed, a correction became a
          lesson, a verified build became an exemplar. That is the whole
          mechanism — no magic, and it is why filing your answers matters.
          And it is ONE brain: the sheet walk and code generation think from
          the same single knowledge base — a lesson from a code fix rides
          the next sheet conversation, and a ruling you file on the sheet
          rides the next build. There is no sheet-side copy of anything.
          The conversation IS the real harness now — the same engine behind
          the chat Dan compares it to (the Claude Agent SDK), embedded in the
          server with ONLY the station tools: it can read the sheet, the
          knowledge, and the shipped code, and edit station data — it has no
          file system, no shell, no reach into the app. Turns bill like that
          chat's turns: roughly 25¢ to $1.50 each (capped at $2), on the top
          reasoning tier — correctness over cost, his call. One session per
          draft, so the thread genuinely remembers.
          {' '}The growth loop is audited to stay ONE store: questions and
          answers land in the questions queue, rulings in the standing-laws
          file, code-fix lessons in the concept docs — one writer each; every
          engine door (chat, split gate, corrections, codegen) reads the same
          three, plus the same precedent digest through the same loader. The
          intake queues (pending laws, app suggestions) and the build ledger
          are queues and metrics, not knowledge — nothing thinks from them.
        </div>
      </div>

      {/* ONE ENGINE, EVERY DOOR — the honest version map (Phase 3) */}
      <div
        data-testid="appflow-engines"
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>One engine, every door — what runs on what</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.65 }}>
          <b>Draft chat</b> — the embedded Claude Code engine (Agent SDK), one
          session per draft, station tools only.{' '}
          <b>The machine split</b> — the same engine as a decompose gate: the
          split arrives as a typed proposal with an identity lock (approved
          machine names survive corrections verbatim) and its own domain
          reviewer.{' '}
          <b>Built-station corrections</b> — the same engine; the built sheet
          rides in as the machines it describes and the edits land back on it.{' '}
          <b>Code generation</b> — the same engine writes the code, with
          read-only eyes on the real reference folders: the standard templates,
          the engineer-verified exemplars, the concept lessons, the shipped
          files. Every objective gate is unchanged and non-negotiable: the edit
          plan schema, the deterministic template merge, byte-level validation
          with a full import simulation, the cross-check against your approved
          sequence, and one adversarial internal review before anything is
          called ready.{' '}
          <b>Still one-shot by design</b> — the first "Done explaining"
          extraction and the Resubmit of in-place sheet edits: mechanical
          restatements, not conversations.{' '}
          <b>Studying ahead</b> — from your devices approval onward, every
          approval quietly runs the pre-write study on the sheet so far;
          anything the code will need surfaces as a numbered question DURING
          the walk, so Generate starts with nothing left to ask. No code is
          written until you hit Generate.{' '}
          <b>The optional CE lane</b> — a controls engineer can flip the chat
          to CE and state controls intent for the station (how a signal is
          set and cleared, latching vs event, logic preferences); it files
          into the sheet's Controls notes, attributed and dated, and guides
          that station's code with authority between Dan's words and generic
          precedent — never above SDC standards or the ME's approved
          mechanical content. Absent, the build runs exactly as today. A rule
          meant for every station graduates through the pending-laws queue
          instead.
        </div>
      </div>

      {/* THE THREE TIERS — what a chat message may change */}
      <div
        data-testid="appflow-tiers"
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>The three tiers — what a message can change</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.65 }}>
          <b>Station data</b> — devices, sequences, recovery, questions: applied
          through the fenced tools, receipts computed from the real changes.{' '}
          <b>Doctrine</b> — a rule about how the engineer should think ("sequences
          always use real device names"): filed as a standing law, dated and
          attributed; Dan's activate immediately, anyone else's wait in a queue
          here for his approval and don't take effect until approved.{' '}
          <b>App changes</b> — how things render, new panels, new features: the
          engine can't change the app and never fakes it with data — it says so
          and files the ask (verbatim, with its reading) for Dan's review;
          accepted ones flow to the dev loop. That boundary is what makes the
          tool safe to hand to every engineer before it's polished — the worst
          case is a pending suggestion.
        </div>
      </div>

      {/* ASK vs DECIDE */}
      <div
        data-testid="appflow-ask-decide"
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px' }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>When SDC Engineer asks vs. when he decides</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.65 }}>
          Precedent-backed means he decides — confidently, citing the shipped
          work or the standard that backs the call. No precedent means he asks,
          says plainly that he searched our shipped work and found nothing, and
          proposes his best answer for you to confirm. Either way your answer
          files as dated doctrine: asked once, ever. Mechanical questions —
          positions, geometry — are always yours; controls decisions are his.
        </div>
      </div>
    </div>
  );
}
