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
Note from 1086: standard *machinery* (ProgramAlarmHandler,
`State_Engine_128Max_V4_3`, `Control`/`Status` UDTs, safety AOIs) can all be
present and the program still be an anti-pattern — the shape is what matters.
990 is the same lesson at scale: it has a real state-engine AOI, real
Control/Status UDTs, HMI/servo/OEE AOIs — and 20-odd state machines crammed
into a handful of programs.

## 1. Entering the same state from many rungs

The leads' #1 "generated code wrong" is endemic: 1028 Diamond has 26 routines
that move to one state from multiple rungs (`A01Aging/A01Aging_SM_SUB`: state
30 written from 3 rungs, state 60/62 from several); 998 Diamond GM has 18
(`DiodeFeedCut/StateLogic`: state 10 from SIX rungs). 1086 does it in a motion
program — seen in _1086_Steris_Cable.L5X: `Pullers` writes state 5 from three
rungs (servo-enable done, rotary-dispense done, manual-mode exit) and state 7
from two, so the priority between "auto restart" and "leave manual" is decided
by rung order nobody documented. 990 does it in almost every station: seen in
_990_Beckett_011224.L5X: `UnloadRobot_SM_SUB` writes state 20 from two rungs
and state 50 from two more, `TfrConveyor` writes state 11 from rungs 8 and 10,
`PackRobot` writes state 12 from rungs 7 and 14 and state 60 from rungs 14 and
18 — and rung 14 also carries an `AlwaysOff` dead leg to state 60, so reading
which rung actually wins needs both rung order AND the dead-code audit. The
standard: a state is entered from exactly ONE rung — multiple entry paths are
parallel branches on that rung (PLC Std §19, CONTROLS #1).

## 2. No numbering headroom — +1/+2 state spacing

Old projects space states by 1 or 2 (1028: 632 of ~700 adjacent gaps are
+1/+2; the aging cell runs 4,6,8,10,12…36 then 48,50,57,58,59). 990 is
uniformly +2 (4,6,8,10…) with 50/60/61/62/63 reserved as complete/wait/
lockout/cyclestop/faulted, and it shows the second cost of tight spacing:
the engine is `State_Engine_64Max_v3_5`, so the ceiling is 64. `S17Control`
spends a move-start/move-complete PAIR of states on every path point
(8/9, 10/11 … 28/29) and consumes states 4–46 for one XY path — a path point
added in the field has nowhere to go. Every mid-debug insertion then renumbers
or zig-zags — 1028 shows the scar tissue (state 35 wedged between 34 and 36).
The standard's +3 spacing exists to absorb insertions; active states stay 4–99
(PLC Std §19, CONTROLS #2), and a repeated motion step is a parameterized
point index, not N hand-written state pairs.

## 3. Transitions and state logic in one routine

998 concentrates transitions in `StateLogic`; 1086 mixes state moves into
mechanism routines; 1028 and 990 are the extreme. 1028's 53-rung
`A01Aging_SM_SUB` holds transitions, the engine call, solenoid coils, robot
handshaking, debounce AOIs, cycle-time math and the alarm JSR. 990 makes that
the house style: every `{Name}_SM_SUB` routine is transitions, then the
`State_Engine` call, then actions, motion, sensor debounce, cylinder coils,
ALMD faults and a fault OR-tree — `Indexer_SM_SUB` is 98 rungs,
`S17Control_SM_SUB` 75, `UnloadRobot_SM_SUB` 74. The standard separates
R02_StateTransitions (decisions) from R03_StateLogic (actions); R03 contains
NO servo control (CONTROLS #1, #12). See §11.

## 4. Multiple state machines per program

990 Beckett is the worst case in the corpus: its main `MainProgram` JSRs
TWELVE state machines (Supervisor, Indexer, PressControl, S08, S09, S10, S13,
S14, S15, S16, S17, S18) plus Counts, OEE, ComFaults, SafetyFaults and
ProductionData; the packaging program hosts four more (TfrConveyor, Unload
robot, Pack robot, BoxShift, LaserInspect) and each feeder program hosts three
(station, conveyor, gantry, incline). `S01BottomShell` adds four more. The
standard: one state machine per program; asynchronous sequences get their own
programs (PLC Std §3). The `{Name}_SM` UDT-wrapper + `_SM_SUB` routine style
that enables this stacking is itself non-standard — a standard program owns
ONE `Control`/`Status` pair, and program ordering (not JSR ordering inside one
routine) is what shows the machine flow.

## 5. Naming that hides the machine flow

1028 mixes prefixes (`A01Aging`, `r01AgingLoad`, `S01Barcode`) and suffixes
(`*_SM_SUB`, 48 × `Alarms_SUB`); 998 uses capability names without `S{nn}_`/
`P{nn}_` and routines without `Rxx_`. 990 numbers stations well in tags
(`S15HoldDownExt_SOL`) but not in programs — four different programs are each
named `MainRoutine` with a routine also called `MainRoutine`, so a
cross-reference tells you the tag, not the station; the same is true in 1086
(three programs named `Logic`). The standard: `S{nn}_`/`P{nn}_` programs
ordered upstream→downstream, `Rxx_` routines (PLC Std §4–5).

## 6. Missing standard machinery — or fed by hand

No project in the corpus lets the alarm handler do the work. 990 has ZERO
ProgramAlarmHandler instances; instead every fault is a bare `ALARM_DIGITAL`
tag with an index for a name (`Indexer_1`…`Indexer_29`, `Com_1`…`Com_32`,
`S15Control_1`…`_15`) driven by a hand-built seal-in
`[cond , XIC(Alarm_n.InAlarm) XIO(FaultReset_PB)] ALMD(Alarm_n,…)`, and each
machine ends with a hand-typed OR-tree of all its `.InAlarm` bits into
`Status.Faulted` — 29 branches for the indexer, then 28 more in Supervisor to
OR every machine's `Faulted`. Comm monitoring is the same disease twice: 32
hand-cloned `AOI_EIPStatus` calls on one rung, then 32 hand-cloned
`XIO(...ComOK) ALMD(Com_n)` branches on the next, then a 32-branch OR — an
array and a FOR would be three rungs, and the hand indexing already drifted
(`Com_25` for the shot pin sits between the cameras). 1028 and 1086 *do* call
`ProgramAlarmHandler` but still hand-build ~500 seal-ins, and 1086 mirrors
each into the HMI copy by hand until two detections collide on `Fault[28]`.
998 keeps 23 `ManualControl` routines; the standard puts manual motion in the
per-axis servo routines and manual pneumatics on `Status.State[1]` branches
(CONTROLS #20). Latch bookkeeping via scattered `OTL/OTU(Control.Bit[n])`
(990, everywhere) replaces coil-first R03 logic with adjacent unlatches
(PLC Std §11, §20).

## 7. Copy-paste station clones instead of one parameterized station

1028 runs ten aging positions as ten hand-cloned programs: `A01Aging_SM_SUB` …
`A10Aging_SM_SUB` are the same ~53 rungs with every tag hand-edited. The clones
have drifted: seen in _1028_Diamond_041024.L5X: A01/A03 order the rungs
"Sensor Timers → Test Running → Clear Tracking" while A02/A10 order them
"Clear Tracking → Sensor Timers → Test Running" — a field fix landed in some
copies and not others. 990 clones at program scale: `S01BottomShell` and
`S05TopShell` are the same feeder shape (robot SM + conveyor SM + gantry SM +
incline SM) copied with BS→TS renames, and they have already diverged — the TS
gantry lost the `Debug` branches and the bin-layer timer table the BS gantry
still carries, and TS rung 33 selects 5000 ms in BOTH legs of a LIM comparison
that no longer means anything. A defect costs N edits and a diff review; that
is the cost the standard's one-station-shape-per-program plus shared AOI/UDT
structure removes.

## 8. Dead-code switches and debug left live at ship

1028 disables logic in the field by prefixing a rung with a permanently false
contact rather than deleting it: `XIC(MachineBasic.AlwaysOff)` gates whole
alarms, whole verify rungs, even a Supervisor fault path. 990 uses the same
`MachineBasic.AlwaysOn/AlwaysOff` pair but escalates it into the state
machines themselves: seen in _990_Beckett_011224.L5X: the gantry chooses its
next state with `[XIC(AlwaysOff) MOV(12,StateReg) , XIC(AlwaysOn) MOV(13,…)]`,
so state 12 and the whole "move to intermediate position" leg are unreachable
but still fully coded and still faulted on; indexer rung 5 ORs `XIC(AlwaysOn)`
into a real interlock (`XIO(Control.Bit[7])`) so the interlock does nothing;
six Indexer dial-check alarms and the entire Supervisor level-1 fault state
(state 7) are `AlwaysOff`-gated. `MachineBasic.AlwaysOn` is also used as a
no-condition rung wrapper on dozens of rungs where a plain unconditional rung
is meant — noise that hides the real `AlwaysOff` kills. 1086 shows how
dangerous it gets: one `XIC(AlwaysOff)` disables ALL FOUR `EIPCommStatus`
calls, and state 15's outfeed move is `XIC(AlwaysOff) MAM(...)` — a state that
pretends to move. `AFI()` does the same job in 1086 and in 990's
`AOI_TorqueHome` (the disable-before-home step is AFI'd out of a shipped AOI).

Personal/debug tags ship as live process conditions: 1028's `XIO(debug_Monica)`
sits in S02 transitions; 1086's `DebugREMOVE.0/.1` clear E-stop words in the
SAFETY program; 990's `Debug` is an OR alternative to `CycleStartLatch` in the
BS gantry (an HMI bit can start an auto cycle) and `OFFTestBit`/`TS_OFFTestBit`
gate the MSF/MSO that park the gantry X servo. Before a machine ships, unused
tags, debug bits, AFI'd rungs and always-false gates must be deleted, not
smothered: code that was fine during commissioning becomes an anti-pattern the
moment it ships (_EE Debug and Testing Process.docx_, 2026-08-31). Bypass that
must exist is explicit and owned — HMI bypass/lockout tags per station,
visible on a screen (990 does have these, `HMI_Data.StationStatus[n].Bypass/
Lockout/ForceOn`; that is the right shape, and it is exactly why the
`AlwaysOff` gates are inexcusable).

## 9. Programs writing into another program's Control/Status

Ownership boundaries are absent. `A01Aging` (1028) writes the robot's outputs
and `RES(A01Control_SM.Control.Timer[2])` … `RES(A10…)` on one rung, reaching
into ten other engines' accumulators. 1086 does it with bare controller-scope
bits (`Laser_Cut_1` latched by one program, consumed and echoed by another).
990 does it with named machines, which makes it easier to see and no better:
the Indexer routine latches `Supervisor_SM.Control.Bit[5/6/7]` (cleanout mode)
and `ComFaults_SUB`/`SafetyFaults_SUB` drive `Supervisor_SM.Control.Bit[20/21]`;
the TS incline conveyor unlatches `BSGantry_SM.Control.Bit[7]`; the pack robot
latches `BoxShift_SM.Control.Bit[1]`; `TfrConveyor` does
`RES(UnloadRobot_SM.Control.Counter[0])`; and Supervisor rung 43 writes
`S01/S05/S07/S08Control_SM.Control.Counter[0].PRE` (retry limits for four other
stations) off a debug toggle. Shared actuators follow: `S16NestLiftExt_SOL` is
coiled from a rung that reads both `S15Control_SM` and `S16Control_SM` states,
so neither machine owns the lift. The standard shape: a program owns its
`Control`/`Status`; others READ status and REQUEST via dedicated interface
bits — nobody resets someone else's timer, counter preset or cycle bit.

## 10. Magic numbers carrying process meaning

1028 moves bare failure codes inline (140/141/142…) and gives HMI buttons deep
meaning by index. 1086 is the same across a whole machine
(`HMI_Data.Control.Button[5..29]`, popup sentinels 9999/8888). 990 is the
largest instance: one flat `HMI_Data.Control.Button[0..159]` array carries
every manual command and mode on the machine — `[18/19]` S15 hold-down,
`[61]` press trigger, `[84]` jog override, `[92]` batch-count enable,
`[99]` daily-count-reset arm, `[102]` cleanout, `[113/114]` box kicker,
`[152..159]` the laser stop/keyswitch/start/shutter — with no alias and no
comment. Alongside it `HMI_Data.Control.DINT_SP[0]` holds a *station number*
(7/15/16/17/25) that unlocks that station's single-cycle transition, and
`DINT_SP[7]` a station number for the audit function, so a station's entry
condition depends on an untyped setpoint. Recipe values are compared as string
literals in ladder — `EQU(Recipe.Running.BS,'11810')` locks out the part pusher
for 3-inch parts. Reading intent requires an HMI drawing and a part-number
list. The standard names the concept (descriptive tags / enumerated members /
recipe-driven parameters, not literals) so a rung reads as the machine.

## 11. Motion, outputs and manual mode written into the state rungs

seen in _1086_Steris_Cable.L5X: `Pullers/Pullers` is one 68-rung routine that
is simultaneously transitions, state actions, servo motion, alarm mirroring and
pneumatic coils. MAM/MAG/MAS/MAH/MAFR and SSV torque-limit writes fire inside
`XIC(Status.State[n])` branches, and the laser-cut latch is keyed off an
accumulator window (`LIMIT(2600,MotionTimers[1].ACC,2700)`) instead of a motion
status. Manual jogging owns states inside the auto machine (42, 53, 55).
990 is better factored — `AOI_AxisBasic`/`AOI_AxisBasicTorque`/`AOI_K5100Basic`
do own enable, home, jog and inch — but the station routines still hold the
MAM/MAS/MCLM/MCS calls, the position-parameter MOVs per state, and the
torque/position scaling math inline (`MUL(…,16.67,…)` deg/s→RPM, `*(20000/36)`
for the stepper) rather than in a per-axis routine. Standard: R02 decides, R03
acts with no servo instructions, per-axis servo routines own the motion
instructions and manual jog, manual pneumatics hang off `Status.State[1]`
(CONTROLS #1, #12, #20).

Half-built states ship too: 1086 state 16/17 contain only
`MOV(next,Control.StateReg)` and nothing writes 25; 990's `S18Control` has no
state 8 writer yet alarms on "Waiting For Laser Marking To Complete" in state
8, and `Indexer` state 42 is only reachable through an `AlwaysOff` rung.
Pass-through and orphan steps read as machine behaviour that does not exist.

## 12. Duplicate HMI/production data and dead OEE members

1086 carries two parallel copies of the same concept (`HMI_Data.Status
.Production` and `HMI_Status.Production`) and one rung uses both, so the bar
graph is computed from a counter that never moves; its OEE members only ever
receive constants. 990 goes to three: the SAME two events
(`UnloadRobot_SM.Control.Bit[6]` good, `[7]` reject) increment
`HMI_Data.Status.TotalParts/GoodParts`, `OEEDataBlock[1].TotalParts/GoodParts`
and `ProductionData[0].Good/Reject` in three different routines, each with its
own reset button and its own efficiency CPT — so "how many parts did we make"
has three answers that drift the moment one reset is pressed. Per-station
counts are duplicated again into `HMI_Data.StationData` *and*
`StationDataCounts[1].StationCount` on the same rung, and into
`HMI_Data.HeadData[headnumber]` a third time. The efficiency CPTs divide
Successes/Attempts with no zero guard (the `AOI_OEE` instance right next to
them does guard) — a fresh machine computes 0/0 every scan. The hour-shift is
23 chained `COP(OEEDataBlock[n],OEEDataBlock[n+1],1)` instructions where a
reverse FOR/COP over the array belongs. The standard shape: one production
data instance per machine, computed in one place, guarded division, arrays
iterated; a production/OEE member is either computed every cycle or absent.

## Legacy device evidence (unverified against standard)

SDC has no standard example yet for some devices; recorded as evidence ONLY,
not as style. **Telesis laser marker over EIP** — 1028 and 990 agree, and 990
adds the full shape: output word `Data[3]` is a message ID bumped
`(ID+1) MOD 10` to execute; `Data[4..]` carries ASCII message type (`V` set
variable, `V?` read back, `P`/80 load pattern-file path) then payload;
`Data[2].0` triggers the mark. Inputs: `Data[10]` echoes the ID, `Data[12]`
must equal ACK, `Data[13..]` returns the read-back string (compare to what was
sent before triggering), `Data[6].4` = ready, `Data[8].1` = busy/idle. The
laser *head* is brought up by discrete outputs in a timed chain — stop →
keyswitch → start → shutter open with 250/1500/2000/5000 ms dwells — with
emission/ready/fault discretes as the confirmations. **Recipe storage on a
controller CompactFlash card** (990 `MainRoutine/ascii2uni` + `Recipe_SaveLoad`)
is done with 12 MSG instances against the file-manager object: 0x52 open,
0x53 seek, 0x4f read, 0x50 write, 0x54 close, 0x55 delete, 0x56 mkdir,
0x57 rename, 0x58 find-first, 0x59 find-next, 0x5a free-search, 0x3 detect
card; paths are UTF-16 (ASCII doubled via FAL), payload chunked at 460 bytes,
and a `step` register plus a 500 ms flush delay sequences it. Whether SDC wants
recipes on the controller at all is a Dan/leads call — see questions.
**Applied Motion steppers** via AMP_* AOIs holding a command bit ~1.3 × RPI
(both 1028 and 990). **Kinetix 5100 as a non-motion-group axis** (990 shot pin)
via `raC_Dvc_K5100_*` AOIs with an assembly UDT, degrees→counts ×1000 and
deg/s→RPM ×16.67 done in ladder. **Keyence probe amplifier**: DINT per head,
scaled `/10000` in 1028 but `/100000` in 990 — scaling is per model/resolution,
so neither number is canonical; read the amplifier config, do not copy either.
**Fanuc robots** are wrapped properly in both (AOI_FanucFFInputs/Outputs +
AOI_FanucRecipe handshake, recipe number echoed and ACKed) — the wrapper AOI
is the one shape in this corpus worth studying, though 990 still reaches around
it to raw `r04Unload_IN.Input[7].2` bits in the unload/pack programs.
Epson robots (1028) are mapped word-for-word into `_IN`/`_OUT` UDTs.

## How to use this file

These patterns are DETECTORS, not vocabulary. If generated code starts to
resemble any numbered item, that is a defect even if a real SDC machine once
shipped that way. Constructs found ONLY in this corpus (`_SM` UDT wrappers,
`*_SUB` suffixes, `AlwaysOn`/`AlwaysOff`/`AFI()` gating, `Debug`/`OFFTestBit`/
`debug_<name>`/`DebugREMOVE` tags, flat `Button[n]` command arrays) must never
be cited as "seen SDC code" in the lookup hierarchy — the corpus is excluded
from step 2 by design.
