# Coordination & handshakes — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Seeded by the correction-learning loop — deepen into full engineer's-
understanding prose as the concept matures.

## R02 is read top-to-bottom by a human and scanned top-to-bottom by the PLC

R02_StateTransitions has a fixed reading order, and it is law (see the
STRUCTURAL FIDELITY law in servo-motion.md): sequence-state rungs first, in
ASCENDING state-number order — a CE finds "State 22" by scrolling to where 22
belongs numerically, so a rung for state 34 spliced between 19 and 22 reads
as disorder even when the flow is correct. Genuine SIDE paths (recovery
excursions) take the next free grid numbers and their rungs sit at their
NUMERIC position (the indexer's recovery states 31/34/37/40/42 do exactly
this); mid-flow synthesized states are renumbered INLINE instead — see the
next section (Jason Perry review of v5, 2026-08-24). After the
sequence rungs comes the override block in template order: lockout 99, the
init states ascending (100 → 124), restart logic, fault 127, manual 1, safety
stop 0, then the State_Engine call and the cycle timer. The override block is
last on purpose — the LAST write to Control.StateReg wins the scan, so faults
and safety override the sequence no matter what it decided.

## Synthesized states are renumbered INLINE — the flow itself ascends
*(Jason Perry review of v5 — SDCServoPNP_JARVIS_v5, 2026-08-24, item 6)*

Numeric rung order is necessary but not sufficient. v5's R02 was perfectly
ascending rung-by-rung, and Jason still flagged it: the compile had appended
its synthesized confirm states at the next free numbers (52/55/58/61), so
the FLOW ran 10 → 52 → back to 13. A CE reading the sequence follows the
transitions, and a main flow whose numbers jump forward and back is
"out of order state transitions" no matter how tidily the rungs are laid out.

The law: **when a state is synthesized into the middle of the flow (a
confirm/wait state between two segments of a stroke, a splice of any kind),
it takes its FLOW position on the +3 grid and every downstream state shifts
up** — the sequence reads 10 → 13 → 16, never 10 → 52 → 13. State numbers
are cheap (the grid exists precisely so states can be inserted); reader
trust is not. Appending at high numbers is only correct for genuine SIDE
paths that leave the main flow — the indexer's recovery states 31/34/37 sit
after the main sequence because they are excursions off it, not steps of it.
The test: walking the MAIN flow's transitions from start of sequence to
cycle complete, state numbers must be strictly ascending; only loop-backs
(retry, next-cycle) and excursions onto side paths may go numerically
backward. This is mechanically enforced: the compiler renumbers inline after
compile, and the validators reject a main flow that jumps forward past a
lower-numbered state it later returns to.

## The cycle starts on Part Present — that is state 4's job
*(Jason Perry review of v5, 2026-08-24, items 3/4)*

For a part-processing station, the standard cycle start is the PART
ARRIVING: a part-present sensor read (and debounced) in R01, consumed by
state 4 — the standard first sequence state, named "Start Of Sequence, Wait
For Part Present". v5 waited on abstract supervisor plumbing instead and had
no part-present input at all; Jason flagged both ends of that (R01 missing
the sensor, R02 state 4 misnamed). The supervisor's run/idle machinery
(states 0–3, CycleRunning) says whether the station MAY cycle; the part
says WHEN a cycle actually begins. Waiting for a part is the normal resting
condition of a running station — which is also why the template's
"Waiting For Part Present" alarm is a Severity-1 warning on a generous
timer, never a fault, and why a second "waiting for cycle start" warning on
the same idle is redundant.

## Resume and init: the part-in-hand skeleton is non-droppable
*(learned from internal review of v3, 2026-08-21)*

A station stops mid-cycle for a hundred reasons — cycle stop, fault, safety
drop — and when it does, it may be HOLDING A PART. The standard's whole
init/resume design exists to guarantee there is a lawful way forward from
both possibilities, and every leg of it is load-bearing. The S05 skeleton:

- **`Initialized` is a POSTURE statement with two legitimate rest postures**
  (R01 rung 11): Z parked at Retract AND (gripper open + X at its
  empty-side position, OR gripper closed + X at its carrying-side position).
  Narrow it to the empty posture only and a machine standing safely with a
  part in the gripper is declared "not initialized" forever.
- **Init entry is gated on NOT carrying** (R02: state 2 + not Initialized +
  `XIO(PartStarted)` → 100). Init drives axes home; you don't do that
  holding a part until the sequence has decided where the part goes.
- **The resume branch is the carrying counterpart** (R02 rung 6, second
  branch): state 2 + not Initialized + `PartStarted` + CycleRunning +
  GripperClosed re-enters the SEQUENCE at the retract-and-carry state — the
  part rides back into the normal flow toward place, no init at all.
- **Inside init, posture branches again**: 100 (Z to retract) exits to 103
  (gripper open → return empty) or 106 (gripper closed → carry toward
  place); both merge at 124 (known safe); 124 exits to start-of-sequence
  when empty or to the place-side state when carrying (R02 rungs 3 and 8
  both carry a `Status.State[124]` branch, split on gripper state).

The judgment: these legs are one mechanism, not a menu. Drop the resume
branch while keeping `XIO(PartStarted)` on init entry and the station
deadlocks in state 2 with a part in hand — init refuses it, the sequence
can't be re-entered, no alarm explains it (the exact v3 blocker). The
gripper's commanded state is the ONLY memory of the part across a stop, so
every one of these branches keys on GripperClosed/GripperOpened. A new
station may re-derive WHERE the carrying path re-enters (that's logic
altitude), but both postures must have a path in Initialized, in init, and
out of state 2 — always.

## State granularity — simultaneous shares a state; sequential never does
*(Dan, 2026-08-25 — "check how the motions split up"; the CE standard's
state-machine model: a state is ONE condition of the machine, and R03 fires
every OTL/OTU of a step at state ENTRY)*

The rule, written once, THE authority for diagram authoring and review:

- **Actions share ONE state ONLY when they are SIMULTANEOUS** — parallel,
  non-conflicting actuations genuinely commanded at the same instant (the
  classic case: all-retract-together at end of cycle; a gripper close and a
  vacuum-on that truly start together). In the generated code every action
  row of a state fires on the same scan at state entry — that is what
  "same state" MEANS, so the diagram may only draw it where the machine
  really does it.
- **Any sequential dependency is a SEPARATE state — no exceptions.**
  "After complete", "then", a delay-timer between two actuations, a sensor
  wait gating the next actuation — each of those IS a state transition, and
  it must appear as one: its own node, its own edge, its own row in the
  state map, its own rung in R02. An `advanceCondition: onComplete`/`timer`
  chain between actuation rows inside one node hides a transition from the
  diagram, the state numbering, the fault timers (one 5000 ms window ends up
  covering N motions), and single-step mode (SS_OK steps states, not rows).
  Concurrent rows (`advanceCondition: none`) are the only multi-actuation
  packing that is ever legal, and only when physically simultaneous.
- **Servo strokes follow the MCD model** (servo-motion.md /
  motion-model-pnp.md): one ServoMove per state, always; a fast/slow stroke
  is its MAM state + transition-wait + MCD slow state; blends live only on
  the connecting edges. Never stacked rows, never sub-steps.
- **Consistency is itself a rule.** The same physical pattern must resolve
  to the same state shape everywhere in a diagram: a diagram that packs one
  retract-pair into a single state and splits an identical pair two nodes
  later is wrong even if each choice alone were defensible — mixed
  granularity is Dan's exact complaint, and it reads as disorder to every
  CE who scans the state map.
- Waits/verifies/decides embedded as decision ROWS are reads, not
  actuations — a wait row before an actuation row is legal (the wait gates
  state work), but a wait row BETWEEN two actuation rows is the same hidden
  transition and splits the same way.

## Answers from the controls leads (Jason Perry, 2026-08-20, questionnaires in plc-reference/training-material/)

- **Active sequence states are 4–99, hard ceiling** (CONTROLS #2): the leads
  named "state assignments beyond state 99" a defect in generated code. 99 is
  lockout, 100–124 init, 127 fault — a sequence that needs more room must be
  restructured, never numbered past 99.
- **A state is entered from exactly ONE rung** (CONTROLS #1): multiple paths
  into state N are parallel branches ON that one rung — "moves to the same
  state in multiple rungs" is on the leads' top-5 wrongs list, alongside
  outputs/servo moves triggered in the wrong states and out-of-order states.
- **Fault = state 127, recovery is judgment** (CONTROLS #17): there is NO
  standard recovery path out of 127 — it is designed per machine/station
  conditions (the leads' own example of a judgment call: post-E-stop recovery
  has several compliant shapes; choose for robustness and simplicity).
- **Init-with-part, the general rule** (#16): initialize to a known location,
  THEN check part-gripped: gripped → enter the place sequence; empty → enter
  the pick sequence. (Confirms the S05 skeleton above and generalizes it.)
- **Timers in transitions** (CONTROLS #8): the State Engine AOI's built-in
  state timer is the default transition timer; define a new TON only for
  specific conditions (TON preferred — needs no reset).
- **Retries** (CONTROLS #9): a retry is a counter plus a standard backward
  transition ("state 20, counter below max, check failed → go back to start
  of sequence"); at counter max, transition to the necessary (fault/route)
  state.
- **q_ActuatorsSafe** (#18): a defined safe SUBSET of actuators per
  application — not "all actuators home."
- **Cross-station handshakes** (CONTROLS #23): input/public/output
  parameters; some wired as connections, some as direct references.
- **HMI_Toggle is alive** (#20): used for any toggle on/off buttons a
  station needs (alongside V4.2's \Tracking OpStatus sourcing).
- **Acceptance test** (#13): engineering audit of every line — the gold
  standard is the SDC standard template; when old reference code conflicts
  with the new standard, the old way NEVER wins (CONTROLS #27).

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Before copying a permissive branch onto a second axis in the same rung, ask what physically goes wrong if that axis is still moving. If the answer is a mispick, a crash, or a part dropped off-target, there is no wide-window shortcut — the shortcut only buys cycle time and it costs position integrity.
- (2026-08-24, from Jason Perry's review of v5 — SDCServoPNP_JARVIS_v5, build b_mt3bnrp3_7yxhic) Synthesized/confirm states are renumbered INLINE on the +3 grid with downstream states pushed up — the main flow's state numbers must be strictly ascending from start of sequence to cycle complete (10→13→16, never 10→52→13); appending at high numbers is only for genuine side paths (recovery excursions), and loop-backs (retry, next cycle) are the only sanctioned backward transitions.
- (2026-08-24, from Jason Perry's review of v5) A part-processing station's cycle start is the part-present sensor: read and debounced in R01, consumed by state 4 "Start Of Sequence, Wait For Part Present" — supervisor run/idle machinery decides whether the station MAY cycle, the part decides WHEN a cycle begins.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) State transition rungs should only test what is new since the previous state. Conditions already proven by entry into the predecessor state (initialized, gripper state, axis in position, cycle running) are redundant and make the sequence brittle — factor shared terms into common branches instead of repeating them in each path.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) Verify the coordinated position of all axes at the state where the consequence occurs (e.g., just before gripper release), not at every intermediate blend state; premature cross-axis interlocks stall blended motion.
- (2026-08-25, from diagram review of MagnetLoad/MagnetPickHead/ServoPNP — first DIAGRAM CHECK run) Mixed state granularity is the dominant live-diagram defect: 8 states across the three SMs chain 2-4 actuation/signal rows with after-complete advances inside one node (MagnetLoad 7/37/40, MagnetPickHead 16/19/25/28/31) — each chain hides real state transitions and, in MagnetLoad state 7, deleted the shuttle-retracted safety gate before the dial index. Simultaneous rows must be marked concurrent; sequential rows split into states — no exceptions.
- (2026-08-25, from diagram review of MagnetPickHead) A declared inter-SM handshake Parameter with NEITHER a producer nor a consumer anywhere (Pick_Head_Clear) is the broken-handshake defect in diagram form — every handshake device must appear as a set/clear in one SM and a wait/decision in another, or be removed.

## Robot cell command/ack handshake (Fanuc R[]-register dispatch) (2026-08-28)

For robot cells (Fanuc TP/LS, distinct from PLC/servo-axis ladder stations), SDC's standard supervisor-to-robot handshake is a shared-register command dispatch, not discrete per-move I/O:

- PLC writes an integer command code to `R[50]` (e.g. 1=pick, 2/3/4=select among place destinations, 100=go to safe home). The command code IS the destination selector — there's no separate 'which place' input; the PLC decides that and encodes it in the number.
- The robot's active subroutine, on completion, writes `R[60] = R[50]` as its ack.
- The robot's master loop is simply `WAIT (R[60] <> R[50])` — it blocks until a new command differs from the last ack, then dispatches (CALL) the matching sub.
- Standard companion registers: `R[41]` = override (EDA), `DO[8]` = station handshake pulse, `DI[40]` = cycle stop, `DI[39]` = station fault (mapped into `R[1]`), grip/ungrip go through `CALL GRIP`/`CALL UNGRIP` subs (which drive RO[1]/RO[2]) rather than direct RO writes.
- Position registers (PR[]) follow a fixed numbering convention: PR[4]/PR[5] are scratch (temp offset / zero offset, PR[4]=PR[5] at init), PR[14] is a shared clear/home position, then sequential approach/target PR pairs per destination (pick = PR[15]/16, place N = PR[17+2(N-1)]/[18+2(N-1)]). Adding a destination just extends the PR range upward — this job's 4 stations used PR[14]-PR[22] instead of the usual PR[14]-PR[20].

This is the robot-world analog of the dial/supervisor handshake (q_ActuatorsSafe/q_Pause/q_StationComplete) used in PLC-native stations — same 'supervisor commands, station acks' shape, expressed in Fanuc registers instead of UDT bits.

_Source: JOB_9999.md (network: Standards - Software), ingested 2026-08-28 by the inbox librarian._

## Robot-cell PLC↔robot handshake standard (Job 1325) (2026-08-29)

SDC's standard pattern for a PLC coordinating an external robot arm (as opposed to another PLC station or a dial) uses a numeric command/ack register pair over EtherNet/IP rather than the usual q_StationComplete-style boolean handshake:

- **Command/ack**: PLC writes an action code into R[50] (e.g. 1=pick, 2=place, 100=safehome). The robot's main loop dispatches on R[50], and each called subroutine echoes R[60]=R[50] when it finishes. PLC blocks with WAIT R[60]<>R[50]. This numeric echo-back is the robot-side equivalent of q_StationComplete.
- **Readiness poll**: before each critical move, the robot pulses a handshake DO (0.5s) toward the station/dial, then polls a dedicated 'ready' DI (e.g. DI[5] station ready, DI[6] dial nest ready, DI[7] dial indexed away) before proceeding — same pulse-then-poll shape SDC uses elsewhere for cross-device readiness.
- **Fault channel**: a single fault register (R[1]) is driven by an external fault DI; any nonzero value aborts the robot program to a dedicated abort label. This is the robot analog of a station's fault-timer/alarm path, but implemented as a shared numeric register instead of per-state timers.
- **Position register template is fixed**: PR[1] Home/Perch, PR[2] LPOS, PR[3] JPOS, PR[4] temp offset (auto-set from PR[5] at init), PR[5] all-zero reference — these five are standard scaffolding present in every robot program; only PR[6] and up are station-specific teach points (approach/pick, approach/place).
- **Gripper timing carries over**: robot-side gripper open/close still uses SDC's standard ~0.25s engage/disengage dwell, confirming the gripper delay convention is device-class-general, not PLC-specific.

_Source: JOB_1325.md (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._
- (2026-08-31, from diagram review of MidBaseLoad — MidBaseLoad) MidBaseLoad interleaves two physically-asynchronous mechanisms in one linear sequence: the Escapement (Escapement_Finger_1/2, Escapement_Shuttle, Shuttle_Gripper, Nest_Part_Present — the load-side feed) and the Pick-and-Place (X_Axis, Vertical_Slide, PNP_Gripper — the transfer to the dial). This is exactly the classic dial-station shape (feeder/escapement feeds a nest, PNP carries to dial) that the doctrine says decomposes into separate SMs specifically BECAUSE the escapement should be re-arming/stripping the next part while the PNP carries the current part to the dial and returns (n12-n17). As drawn, the escapement cannot start prepping the next part until the whole PNP round-trip (wait-for-dial, move-to-place, extend, release, retract, move-to-pick) completes — real concurrency is architecturally impossible. One program, one interleaved sequence, two asynchronous mechanisms = architecture-level violation of 'each program must have no more than one state machine.' Correct shape: Split into two programs/SMs: an Escapement SM owning Escapement_Finger_1/2, Escapement_Shuttle, Shuttle_Gripper, Nest_Part_Present (feeds/re-arms the pick nest continuously) and a PickAndPlace SM owning X_Axis, Vertical_Slide, PNP_Gripper (transfers nest→dial). Add a device-linked handshake signal each way (e.g. a 'part ready at nest' signal set by Escapement/consumed by PickAndPlace as a wait, and a 'nest clear' signal so Escapement can re-arm as soon as PickAndPlace has lifted the part).
