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
and safety override the sequence no matter what it decided. A MECHANISM
program (the cam chassis) legitimately ships without lockout 99 and without
init 100–124 and with a two-stage fault (stop motion → disable → 127) — see
station-archetypes.md; the ordering law itself is unchanged.

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

## The dial contract — four signals, plus the part-tracking gate
*(seen in SoftwareStandardization.L5X: S00_IndexerSP with S01/S03/S04/S05/
S18/S19 — the V4.2 template's own dial machine)*

On a dial machine the indexer program (S00) is the coordination hub, and the
whole conversation is four signals, three of them ANDed across every station
in the indexer's R01:

- **`q_StationComplete`** (station → indexer): "I am done with this index."
  ANDed across all stations behind a debounce TON in state 4, one-shot into
  `StationsComplete`. This is what releases the index.
- **`q_ActuatorsSafe`** (station → indexer): the safe SUBSET (CONTROLS #18),
  ANDed into `ActuatorsSafe`, which is BOTH the state-10 permissive to start
  the index AND `IndexerAxisPermissive` — so if any station's actuator leaves
  safe mid-index, the standard MAS-on-permissive-loss rung quickstops the
  dial and the sequence diverts onto the 31/34/37 recovery excursion. One bit
  therefore does double duty: sequence gate and live motion permissive. On a
  servo station the term is built DOUBLE-SIDED per axis (seen in
  S05_ServoPNP.L5X R03 rung 3): axis homed + at the retract RangeCheck
  `.InPos` + NOT at any work position (`XIO(ZAxisPick.InPos)`
  `XIO(ZAxisPlace.InPos)`) — prove you are home and prove you are not
  anywhere dangerous, because one stale or overlapping deadband must not be
  able to declare the station clear on its own.
- **`q_Pause`** (station → indexer): drives the indexer's pause states, with a
  `PauseReason` code moved per station so the pause is attributable.
- **`q_WaitStationsComplete`** (indexer → stations): the dial is on station
  and waiting. This is the permission each station's WORK state gates on
  (S05 19 → 22, S04's verify one-shot, every q_StationComplete rung) — a
  station never infers "the dial has stopped" from its own timing.

The part-tracking gate rides alongside and is what keeps the dial at rate:
`CycleStationA` = this nest qualifies AND I have not attempted it
(`XIO(...Station[StaNum].Attempt)`); `CycleStationB` = the nest qualifies at
all. Work states latch `.Attempt` on entry and `.Success` at the state after
the release, and `q_StationComplete` is "CycleStationB and (Success or
Failure or Lockout)" OR "not CycleStationB" — a station with nothing to do
for this nest reports complete IMMEDIATELY. That is why every station
qualifies the nest off its PREDECESSOR's result
(`Station[StaNumPre].Success` / `.Lockout`) rather than a global part-good
bit, and why a locked-out station still writes `.Lockout` into the nest: the
downstream stations need to know the step was skipped, not failed.

**Stack-fed dial — the contract degenerates to demand-index** *(seen in
MagnetDial_description_by_Dan.txt)*: when a fixture holds a STACK rather than
a part (10 magnet stacks, stripped one at a time), the dial does not index per
cycle — it indexes when the CONSUMER says "this source is spent." The four
signals shrink to two: the consumer's demand for the next good stack, and the
dial's "on station and this stack qualifies." Part tracking shrinks with it —
Dan: "you don't need part tracking, really; all you need to know is if the
stack has magnets or not" — so the nest record is one qualification bit and a
strike/retry count, not a per-part result chain. The qualification is read one
position UPSTREAM (stack-present sensor at the fixture BEFORE the work
station): the predecessor-result rule in look-ahead form, so an empty fixture
is indexed THROUGH rather than stopped on and skipped.

## The cam-angle contract — on a chassis there is no station handshake
*(seen in ChassisStandard.L5X: Chassis R01 rungs 14–16, R20 rungs 23/25/28–31;
HMI R03_CleanoutMode; S01/S02/S03/S18/S19/S20 R02; Production R01/R02)*

On a cam-driven chassis the four-signal dial contract collapses: the stations
have no state machine, so they never say "complete" and the mechanism never
asks. **The cam angle IS the handshake** — every station reads
`\Chassis.ChassisStatus.CamPosDeg` and acts inside its own window. The only
things a station tells the chassis are (a) that it is CLEAR of the dial and
(b) that it is starved.

- **Clear-of-dial replaces `q_ActuatorsSafe`, and it is checked EARLY.**
  `IndexPermissiveStatus[n]` (one per device that enters a nest) ANDs into
  `ChassisControl.DialIndexPermsOK`, and the fault rung evaluates it from
  `SetupIndexPermsStartCheckPosDeg` — an angle deliberately set a little
  BEFORE index start, because a cam machine cannot stop instantly: the check
  must leave stopping distance at `FastStopDec` before the interference
  happens. A dedicated alarm exists purely to catch a mis-set check angle (it
  may never lie inside the index window) — the template guards its own setup
  data. Attribution is a SECOND `ProgramAlarmHandler` instance over an
  `AlarmIndexPerm` array, one alarm per permissive with its message built by
  CONCAT off a shared header, ORed into the same `q_AlarmActive`. The idea
  generalizes past cams: any AND-ed gate that stops a machine needs a
  per-contributor alarm array, or first shift spends an hour guessing which
  slow cylinder did it.
- **Starvation is still a pause, still attributable**: stations raise
  `q_PauseRequest` (S01/S03 off their no-part warning), the chassis ORs them
  into `PauseCondition` with a per-station `PauseReason`, and pause is a
  CONTROLLED stop parked at the startup cam angle (40 → 43 → 46 restart
  delay), never a fault — `q_Paused` feeds Production's paused-minutes
  accumulator exactly as on the indexer.
- **Cleanout mode is the run-out handshake**: the HMI program latches
  `q_CleanoutModeEnabled`, every station's `CycleStation` includes
  `XIO(\HMI.q_CleanoutModeEnabled)` so nothing new loads, and when all nests
  read not-`PartLoaded` the HMI raises `q_CleanoutModeStopTrig`, which the
  supervisor treats as an OPERATOR cycle stop (StopReason 0, not a fault).
  Emptying a dial is a MODE, not a manual procedure.
- **The nest reference must be the SAME in the qualification and in the
  action.** An action whose window falls during the index writes
  `NestNumIncoming` and its `CycleStation` qualifies
  `Nest[NestNumIncoming]` (seen in ShowRoomChassis.L5X: S01_PartLoad R02
  rungs 2/4); an action after the index uses `NestNumCurrent` in both
  (S03, S19). Mixing them credits the neighbouring part — the defect that
  only surfaces in reject analysis.
- **Result attribution reaches Production only through the unload stations**:
  `q_IncrementGood` and `q_IncrementReject` are the only part counters, and
  ONE station may carry both — the 20-nest showroom machine has no reject
  chute, so S19's release rung splits on `FailureType = 0` to fire good or
  reject at the same cam angle, then COPs an empty `Tracking_Part_Assy_Stat`
  over the nest ~50° later (seen in ShowRoomChassis.L5X: S19_PartUnload R02
  rungs 5/6). The failing station writes a numeric `FailureType` (station × 10
  + a per-mode digit: 11 at S01, 21 at S02/S03, 31 at S03) plus a
  `FailureMessage` string into the nest, and the counting station counts the
  code into `ProductionData.FailureTypeCounts[type]` — hence the template's
  sizing note, last-station × 10 + 9. Runtime/downtime/paused minutes and
  per-shift OEE (480 min planned) are computed twice, once for the run and
  once for `ShiftData[p_CurrentShift]`, with the shift decided on clock-hour
  boundaries and the new shift's record COP-cleared on the change pulse. On a
  machine with more than one SPEED MODE the OEE `IdealCycleTime` must follow
  the mode — the showroom stages `Ideal_CycleTime` from the chassis's
  `StandardSpeed_Active`/`FastSpeed_Active` bits (1.2 s vs 0.667 s) but still
  passes the 1.2 literal into the OEE AOI; pass the staged tag, or Performance
  lies every time the machine runs fast.

## The cycle starts on Part Present — that is state 4's job
*(Jason Perry review of v5, 2026-08-24, items 3/4)*

For a part-processing station, the standard cycle start is the PART
ARRIVING: a part-present sensor read (and debounced) in R01, consumed by
state 4 — the standard first sequence state, named "Start Of Sequence, Wait
For Part Present". v5 waited on abstract supervisor plumbing instead and had
no part-present input at all; Jason flagged both ends of that (R01 missing
the sensor, R02 state 4 misnamed). The supervisor's run/idle machinery
(states 0–3, CycleRunning) says whether the station MAY cycle; the part
says WHEN a cycle actually begins. On a dial, the same slot is filled by the
dial itself — S18/S19 name state 4 "wait for index complete" and gate on
`q_WaitStationsComplete` — but the shape is identical: one arrival condition,
one idle warning. Waiting for a part is the normal resting condition of a
running station — which is also why the template's "Waiting For Part Present"
alarm is a Severity-1 warning on a generous timer, never a fault, and why a
second "waiting for cycle start" warning on the same idle is redundant.

## Operator/debug modes ride INSIDE the transition rungs
*(seen in S05_ServoPNP.L5X: R01 rungs 16–25, R02 every sequence rung)*

Single-step and dry run are not separate sequences and not separate modes of
the state engine — each is ONE term added to rungs that already exist. That
is what keeps them honest: the debug path is the production path.

- **`SS_OK` is the advance permission.** It is ANDed into every SEQUENCE
  transition (4 → 7 → 10 → … → 43, and init 100/103/106) and into nothing
  else: states 2/3, lockout 99, fault 127, manual 1, safety 0, init-complete
  124 and the wait-for-index state 25 carry no SS_OK, because a fault, a
  safety drop, a posture completion or a partner's handshake must move the
  machine regardless of who is holding the step button. `SS_OK` is hard-TRUE
  whenever single-step/single-cycle is not selected (`XIO(SS)` branch), so
  normal running pays nothing for it. When it IS selected it is qualified on
  `\S00_IndexerSP.p_OnStation` — you never step a station while the dial is
  in motion — and it consumes a one-shot of the trigger. SingleStep and
  SingleCycle are mutually exclusive (each one-shot unlatches the other), and
  SingleCycle self-clears at state 4, on an alarm, or on leaving idle.
- **Debug must not lie to part tracking.** The `.Attempt` and `.Success` OTLs
  are gated `XIO(SingleDisableTracking)`, and `SingleClearTracking` COPs an
  empty `Tracking_Part_Assy_Stat` over the current nest behind a delay. A
  station stepped by hand writes real motion but optional history — decide
  which, don't leave a phantom good part in the nest record.
- **`DryRun` substitutes for the PART, in exactly two places**: the state-4
  advance (`PartPresentDebounce.On` OR `DryRun`) and the nest-qualification
  branch of `CycleStationA`/`B`. Nothing else changes — handshakes,
  permissives, alarms and motion are identical. That is precisely why dry run
  is trustworthy as a proving mode; a dry run that also bypasses interlocks
  or skips states proves nothing about the machine you are about to run.

## Blending is configurable per application, and the rung carries both exits
*(seen in S05_ServoPNP.L5X: R01 rungs 1–2, R02 rungs 3/9/10/16, R05 14–15)*

Two DINT application inputs (`i_DisableCornerRounding`,
`i_DisableZSpeedTransition`, compared `EQ …,1` into BOOLs) let the
commissioning engineer turn blending off per machine without touching the
sequence. Every affected transition therefore ships BOTH exits as parallel
branches: `[XIC(MAM.PC) XIC(Pos.InPos) , XIO(DisableCornerRounding)
XIC(MAM.IP) XIC(Pos.InPosWide)]` — strict arrival is always valid, the early
wide-band handoff only when rounding is allowed. The speed transition works
the same way: the MCD slow state is entered only `XIO(DisableZSpeedTransition)`
and R05's auto-mode rung hands the stroke the FAST profile when it is
disabled, so the stroke collapses from two states to one with no edit. Note
where the band comes from — the DESTINATION's own RangeCheck wide deadband,
not a separately taught transition point. Judgment: never write a transition
that has ONLY the wide-band exit, and never "clean up" by deleting the strict
branch; blending is the first thing turned off when a part slips or a nest
gets clipped, and the machine must still sequence when it is.

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
can't be re-entered, no alarm explains it (the exact v3 blocker).

There are TWO memories of the part and they do different jobs (seen in
S05_ServoPNP.L5X R03 rung 5): `PartStarted` is a sealed latch set at the
grip state and dropped once the place leg begins and on `PowerUpCP`, and it
decides WHETHER init may run; the gripper's commanded state (or, on a vacuum
head, the verify sensor — see station-archetypes.md, magnet pick head)
decides WHICH posture path is taken. That split is what makes a power cycle
with a part in the gripper recoverable: PartStarted is gone so init runs, but
100 branches to 106 on GripperClosed and 124 exits to the place-side wait,
never to state 4. A new station may re-derive WHERE the carrying path
re-enters (that's logic altitude), but both postures must have a path in
Initialized, in init, and out of state 2 — always.

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
  packing that is ever legal, and only when physically simultaneous. A
  PHYSICS ordering interlock (top retainer over the magnet before the strip
  cylinder moves, or the part flips and sticks) is exactly such a dependency:
  its own state, its own condition, never packed into the strike.
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
- **Retries, and where a retry ESCALATES** (CONTROLS #9): a retry is a
  counter plus a standard backward transition ("state 20, counter below max,
  check failed → go back to start of sequence"); at counter max you go to the
  *necessary* state — and on a material-fed machine that is usually NOT 127.
  The magnet dial escalates in three tiers (seen in
  MagnetDial_description_by_Dan.txt): re-strip a magnet up to 3 times →
  abandon that stack, retract everything clear and index to the next stack
  with material → fault only when a full REVOLUTION found nothing anywhere.
  Dan's words: "you don't want to stop the machine." Judgment: fault when the
  machine has run out of options, not when one attempt ran out of tries, and
  each tier's exhaustion must leave the mechanism in a posture the next tier
  can start from — hence "retract everything, get out of the way, THEN index."
- **q_ActuatorsSafe** (#18): a defined safe SUBSET of actuators per
  application — not "all actuators home."
- **Cross-station handshakes** (CONTROLS #23): input/public/output
  parameters; some wired as connections, some as direct references.
- **HMI_Toggle is alive** (#20): used for any toggle on/off buttons a
  station needs (alongside V4.2's \Tracking OpStatus sourcing).
- **Acceptance test** (#13): engineering audit of every line — the gold
  standard is the SDC standard template; when old reference code conflicts
  with the new standard, the old way NEVER wins (CONTROLS #27).

## Robot cells: command/ack over registers (Fanuc)
*(JOB_9999.md and JOB_1325.md, ingested 2026-08-28/29 — consolidated;
PLC side seen in ShowRoomFlexFeeder.L5X)*

When the partner is a robot arm rather than a PLC station or a dial, the
same "supervisor commands, station acks" shape is expressed in Fanuc
registers instead of UDT bits:

- **Command/ack**: the PLC writes an action code to `R[50]` (1=pick,
  2/3/4=place destination N, 100=safe home) — the code IS the destination
  selector, so adding a destination is a new number, not new I/O. The robot's
  master loop is `WAIT (R[60] <> R[50])`, dispatches CALL to the matching
  sub, and each sub echoes `R[60] = R[50]` on completion. That echo is the
  robot-side `q_StationComplete`. **From the PLC side** the same dialogue is
  three rungs: MOVE the code into `R50` in the requesting state, test
  `EQ(i_RobotEDAIn.R60, code)` in the next transition, and a standing rung
  that clears `R50` the moment `R60 <> 0` — so `R60 = 0` plus not-busy is the
  idle/ready condition and neither side ever leaves a stale command latched.
  Each such state also gets its own "Waiting For …" timeout alarm.
- **UI commands are pulsed, not held**: Start / RemoteStart / CycleStop /
  FaultReset are ANDed with the 250 ms flasher; `IMSTP`/`SFSPD`/`Enable` are
  held true and `Hold` is the pause line. Choosing WHICH stop matters — pause
  (drop Hold, resume with RemoteStart) when the robot reports it is at a
  cycle boundary, CycleStop when it is not.
- **Program/recipe selection is its own nested handshake** (`AOI_FanucRecipe`:
  prepare command → echo → recipe number → echo → Success, 10 s timeout),
  permitted only while the machine is not running — a robot's part family
  changes between runs, never mid-cycle.
- **Readiness poll**: before a critical move the robot pulses a handshake DO
  (~0.5 s) at the station/dial and then polls a dedicated ready DI (station
  ready, nest ready, dial indexed away) — the pulse-then-poll shape SDC uses
  for any cross-device readiness. A PLC-side pick head hands off the same way:
  "magnet in position" out, "robot in position" in, release, then "robot
  clear" before retracting — the retract is gated on CLEAR, not on the
  release, because the arm is still in the envelope.
- **Fault channel**: an external fault DI drives a single fault register
  `R[1]`; any nonzero value aborts the program to a dedicated abort label —
  the robot analog of q_AlarmActive → 127.
- **Fixed scaffolding**: `R[41]` override, `DO[8]` handshake pulse, `DI[40]`
  cycle stop, `CALL GRIP`/`CALL UNGRIP` subs (never direct RO writes), and
  the PR map — PR[1] home/perch, PR[2] LPOS, PR[3] JPOS, PR[4] temp offset
  set from PR[5] all-zero at init, PR[14] shared clear/home, then sequential
  approach/target PR pairs per destination (pick 15/16, place N 17+2(N-1)).
  Station-specific teach points start above the scaffolding and extend
  upward. Gripper open/close still uses the standard ~0.25 s dwell — that
  convention is device-class-general, not PLC-specific.

## Machine-level alarm aggregation, watchdogs and stop attribution
*(seen in ShowRoomChassis.L5X: Alarms R01_Logic, Supervisor R01/R02/R15/R20,
Chassis R20; ShowRoomFlexFeeder.L5X: Supervisor R15_EIPMonitor)*

Alarms flow UP through exactly two bits. Every program owns its own `Alarm`
array and `ProgramAlarmHandler` instance and publishes `q_AlarmActive` /
`q_WarningActive`; the ALARMS program ANDs the XIO of every program's pair
into `p_NoMachineFaults` / `p_NoMachineWarnings`, and the supervisor derives
`q_MachineFaultActive` from nothing but `XIO(\Alarms.p_NoMachineFaults)`.
Adding a station is therefore one contact in two rungs of Alarms — no other
program ever learns its name.

Alarm arrays are BLOCK-ALLOCATED by severity and never re-indexed: severity-0
faults occupy the low block, with `AlwaysOff` "Not Used" rungs holding empty
slots open, and severity-1 warnings start around index 30, each MOVEing 1 into
its own `.Severity` in its own rung. A program with more than one alarm CLASS
gets more arrays and more handler instances (the chassis has three: station,
servo, index-permissive) all ORed into the same `q_AlarmActive`. Alarm indices
are the operator's vocabulary and the history's identity — shifting one
silently renames every alarm already logged.

The alarm that stopped the machine is found by SCAN, not by wiring: on the
running→fault one-shot the Alarms program walks `p_Active[0..15]` and COPs the
FIRST severity-0 entry into `AlarmStop`, which the `TopAlarms` AOI buckets per
shift. Alongside it the supervisor MOVEs `q_MachineStopReason` on ENTRY to
Cycle Stopping (0 = operator cycle stop OR cleanout run-out, 1 = fault), and
Production buckets runtime/downtime minutes and OEE off that code. Both are
captured at the transition — by the time anyone looks, the fault may already
be reset.

Device-comms supervision belongs to the SUPERVISOR and is deliberately spread
across scans: every EtherNet/IP node gets an `AOI_EIPStatus` (GSV
EntryStatus, masked), a counter increments on the 100 ms pulse and rolls over
at the node count, and each node's loss alarm is gated on
`EQ(EIPStatusCount,n)` — one node per 100 ms, latched until fault reset, armed
only after `g_MachineBasic.PowerUpCP` so a booting network doesn't alarm on
itself. A drive's ComOK bit is also the gate on its "loss of absolute position
reference" alarm — a comms drop must not masquerade as a lost home.

Cycle start is a HELD button, and the hold IS the warning period:
`i_CycleStart` + `i_CycleStop` (NC, held true) + `StartOK` through a TON
sealed by its own `.EN` latches `q_CycleStartLatch`, while the timer's `.TT`
(`CycleStarting`) sounds the horn and flashes the start light through
`LightControl`. There is no separate "pre-start warning" mode to design.

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Before copying a permissive branch onto a second axis in the same rung, ask what physically goes wrong if that axis is still moving. If the answer is a mispick, a crash, or a part dropped off-target, there is no wide-window shortcut — the shortcut only buys cycle time and it costs position integrity.
- (2026-08-24, from Jason Perry's review of v5 — SDCServoPNP_JARVIS_v5, build b_mt3bnrp3_7yxhic) Synthesized/confirm states are renumbered INLINE on the +3 grid with downstream states pushed up — the main flow's state numbers must be strictly ascending from start of sequence to cycle complete (10→13→16, never 10→52→13); appending at high numbers is only for genuine side paths (recovery excursions), and loop-backs (retry, next cycle) are the only sanctioned backward transitions.
- (2026-08-24, from Jason Perry's review of v5) A part-processing station's cycle start is the part-present sensor: read and debounced in R01, consumed by state 4 "Start Of Sequence, Wait For Part Present" — supervisor run/idle machinery decides whether the station MAY cycle, the part decides WHEN a cycle begins.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) State transition rungs should only test what is new since the previous state. Conditions already proven by entry into the predecessor state (initialized, gripper state, axis in position, cycle running) are redundant and make the sequence brittle — factor shared terms into common branches instead of repeating them in each path.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) Verify the coordinated position of all axes at the state where the consequence occurs (e.g., just before gripper release), not at every intermediate blend state; premature cross-axis interlocks stall blended motion.
- (2026-08-25, from diagram review of MagnetLoad/MagnetPickHead/ServoPNP — first DIAGRAM CHECK run) Mixed state granularity is the dominant live-diagram defect: 8 states across the three SMs chain 2-4 actuation/signal rows with after-complete advances inside one node (MagnetLoad 7/37/40, MagnetPickHead 16/19/25/28/31) — each chain hides real state transitions and, in MagnetLoad state 7, deleted the shuttle-retracted safety gate before the dial index. Simultaneous rows must be marked concurrent; sequential rows split into states — no exceptions.
- (2026-08-25, from diagram review of MagnetPickHead) A declared inter-SM handshake Parameter with NEITHER a producer nor a consumer anywhere (Pick_Head_Clear) is the broken-handshake defect in diagram form — every handshake device must appear as a set/clear in one SM and a wait/decision in another, or be removed.
- (2026-08-31, from diagram review of MidBaseLoad; confirmed by MagnetDial_description_by_Dan.txt) Two physically-asynchronous mechanisms interleaved in ONE linear sequence is an architecture defect, not a drawing preference: MidBaseLoad's escapement (fingers/shuttle/gripper/nest sensor) could not re-arm the next part until the whole PNP round-trip finished, so real concurrency was impossible. Correct shape — an Escapement SM owning the feed devices and a PickAndPlace SM owning the transfer devices, joined by a handshake each way ("part ready at nest" out, "nest clear" back). Dan dictates the magnet dial the same way and for the same reason: "shuttle retracts and strips next magnet, then waits" happens WHILE the pick head is rotating to the robot, so shuttle and pick head are separate SMs joined by Magnet_Ready and a pick-head-clear bit.
