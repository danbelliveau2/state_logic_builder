# Anti-patterns — what WRONG looks like (pre-standard SDC projects)

> CONCEPTS, NOT RULES — and these are NEGATIVE examples. The projects cited
> here live in `plc-reference/training-material/Examples NOT Following SDC
> Standard/` and are **NEVER style authority** — they exist so Jarvis
> recognizes and refuses these shapes. The leads confirmed: when old
> reference code conflicts with the new standard, the old way NEVER wins
> (CONTROLS_LEADS_QUESTIONS #27, Jason Perry, 2026-08-20).

Corpus: `_1028_Diamond_041024.L5X`, `_1086_Steris_Cable.L5X`,
`_990_Beckett_011224.L5X`, `_998_Diamond_GM_SecTermInsert_RevB.L5X` —
real shipped SDC machines, designated anti-pattern training by the leads.

## 1. Entering the same state from many rungs

The leads' #1 "generated code wrong" is endemic: 1028 Diamond has 26 routines
that move to one state from multiple rungs (`A01Aging/A01Aging_SM_SUB`: state
30 written from 3 rungs, state 60/62 from several); 998 Diamond GM has 18
(`DiodeFeedCut/StateLogic`: state 10 from SIX rungs). The standard: a state is
entered from exactly ONE rung — multiple entry paths are parallel branches on
that rung (PLC Std §19, CONTROLS #1). Scattered writes hide priority order and
let the last-scan write silently win.

## 2. No numbering headroom — +1/+2 state spacing

Old projects space states by 1 or 2 (1028: 632 of ~700 adjacent gaps are
+1/+2; the aging cell runs 4,6,8,10,12…36 then 48,50,57,58,59). Every mid-debug
insertion then renumbers or zig-zags — 1028 shows the scar tissue (state 35
wedged between 34 and 36, 11/13 wedged into S01). The standard's +3 spacing
exists to absorb insertions; active states stay 4–99 (PLC Std §19, CONTROLS #2).

## 3. Transitions and state logic in one routine

998 concentrates transitions in `StateLogic`; 1086 mixes state moves into
mechanism routines; 1028 is the extreme — one 53-rung `A01Aging_SM_SUB` holds
transitions, the state engine call, solenoid coils, robot handshaking,
debounce AOIs, cycle-time math, failure-code counters and the alarm JSR. The
standard separates R02_StateTransitions (decisions) from R03_StateLogic
(actions); R03 contains NO servo control (CONTROLS #1, #12).

## 4. Multiple state machines per program

990 Beckett: `MainProgram` hosts FOUR state machines; `S01BottomShell` four
more. The standard: one state machine per program; asynchronous sequences get
their own programs (PLC Std §3). The `{Name}_SM` UDT-wrapper style that enables
this stacking is itself non-standard — a standard program owns ONE
`Control`/`Status` pair.

## 5. Naming that hides the machine flow

1028 mixes prefixes (`A01Aging`, `r01AgingLoad`, `S01Barcode`) and suffixes
(`*_SM_SUB`, 48 × `Alarms_SUB`); 1086 has no station numbering at all
(`Main`, `Motion`, `Reel`); 998 uses capability names without `S{nn}_`/`P{nn}_`
and routines without `Rxx_`. The standard: `S{nn}_`/`P{nn}_` programs ordered
upstream→downstream, `Rxx_` routines (PLC Std §4–5).

## 6. Missing standard machinery

990 has ZERO ProgramAlarmHandler instances — alarms hand-rolled per program.
1028 *does* call `ProgramAlarmHandler` in every `Alarms_SUB` (the machinery
exists), but each alarm is a hand-built seal-in
`[cond , XIC(Alarm[n].Active) XIO(FaultReset_PB)]OTE(Alarm[n].Active)` repeated
verbatim ~500 times — the handler is fed, the detection is copy-paste. 998
keeps 23 `ManualControl` routines; the standard puts manual motion in the
per-axis servo routines and manual pneumatics on `Status.State[1]` branches
(CONTROLS #20). Latch bookkeeping via scattered `OTL/OTU(Control.Bit[n])` (990)
replaces coil-first R03 logic with adjacent unlatches (PLC Std §11, §20).

## 7. Copy-paste station clones instead of one parameterized station

1028 runs ten aging positions as ten hand-cloned programs: `A01Aging_SM_SUB` …
`A10Aging_SM_SUB` are the same ~53 rungs with every tag hand-edited
(`A01_ProbesExt_SOL`→`A02_…`, `StationStatus[31]`→`[32]`,
`HMI_Data.StationData.Station31`→`Station32`). The clones have already drifted:
seen in _1028_Diamond_041024.L5X: A01/A03 order the rungs
"Sensor Timers → Test Running → Clear Tracking" while A02/A10 order them
"Clear Tracking → Sensor Timers → Test Running" — proof that a field fix landed
in some copies and not others. A defect here costs ten edits and a diff review;
that is exactly the cost the standard's one-station-shape-per-program plus
shared AOI/UDT structure is meant to remove. When N identical cells exist, the
standard answer is one program shape driven by an instance index, not N files.

## 8. Dead-code switches and personal debug tags left live

1028 disables logic in the field by prefixing a rung with a permanently false
contact rather than deleting it: `XIC(MachineBasic.AlwaysOff)` gates whole
alarms ("Part Present Stuck On High"), whole verify rungs (S08 boot-load
verify), even a Supervisor fault path. The inverse, `XIC(MachineBasic.AlwaysOn)`,
wraps rungs that need no condition at all. Worse, a personal debug tag ships in
production logic: seen in _1028_Diamond_041024.L5X: `XIO(debug_Monica)` sits in
the S02 bushing-load transitions, the r03 flipper conveyor rung and the S08 air
puff — a named engineer's toggle is a live process condition. The standard keeps
bypass intent explicit and owned (HMI bypass/lockout tags per station), and a
rung that must not run is deleted, not smothered.

## 9. Programs writing into another program's Control/Status

Ownership boundaries are absent. `A01Aging` writes the robot's outputs
(`r01AgingLoad_OUT.UserWord[1]`, `UserOut[3].1`) and the shared tracking array
`StationStatus[31]`; `r01AgingLoad` writes back into every aging cell's engine —
seen in _1028_Diamond_041024.L5X: `RES(A01Control_SM.Control.Timer[2])` …
`RES(A10Control_SM.Control.Timer[2])` on one clear-tracking rung, reaching into
ten other state machines' timer accumulators. `Indexer` JSRs a
`StationStatus_SUB` that shifts all 40 heads' data. The standard shape: a
program owns its `Control`/`Status`; other programs READ status and REQUEST via
dedicated interface bits — nobody resets someone else's timer.

## 10. Magic numbers carrying process meaning

Two flavours in 1028. Failure codes are bare literals moved inline —
`MOVE(140,StationStatus[31].FailureType)` (safety stop), 141 (pre-test signal),
142/143/144 (arc/5V/14V timeouts) — with the 140→`FCCounts[0]` mapping and its
reset rung re-typed in every one of the ten clones. And HMI buttons carry deep
process meaning by index: `Button[147]` is pre-op mode, `[146]` boot bypass,
`[145]` aging lockout, `[179]` coil-load pick-vs-vision — tested in dozens of
rungs across twenty programs with no named alias. Reading intent requires an
HMI drawing. The standard names the concept (descriptive tags / enumerated
failure UDT members) so a rung reads as the machine, not as an index.

## Legacy device evidence (unverified against standard)

SDC has no standard example yet for some devices in 1028; recorded as evidence
ONLY, not as style: a Telesis laser marker is driven over EIP by writing a
message-type char (`V` = set variable data, `V?` = read it back) plus payload
into the output words, then incrementing a message-ID word to execute
(`(ID+1) MOD 10`), waiting for the echoed ID plus an `ACK`, and — notably —
re-reading each of the three mark lines and string-comparing before triggering
the mark. An Applied Motion stepper is driven by AMP_* AOIs that hold a command
bit ~1.3 × RPI to guarantee one EtherNet/IP cycle. Keyence probe values arrive
as DINTs scaled `/10000`. Epson robots are mapped word-for-word by
`Epson_Robot_V2_0` into `_IN`/`_OUT` UDTs, then handshaken with UserIn/UserOut
bits and InsideBox zone bits.

## How to use this file

These patterns are DETECTORS, not vocabulary. If generated code starts to
resemble any numbered item, that is a defect even if a real SDC machine once
shipped that way. Constructs found ONLY in this corpus (`_SM` UDT wrappers,
`*_SUB` suffixes, `AlwaysOff` gating, `debug_<name>` tags) must never be cited
as "seen SDC code" in the lookup hierarchy — the corpus is excluded from step 2
by design.

## Leftover debug code before shipping (2026-08-31)

Before a machine ships, unused tags, debug bits, AFI (Always False) instructions, and other temporary debug code left in from commissioning must be removed — code that was fine to add during debug becomes an anti-pattern if it survives into the as-shipped program.

_Source: EE Debug and Testing Process.docx (network: EE Process and Standards Documents), ingested 2026-08-31 by the inbox librarian._
