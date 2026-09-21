# Station archetypes beyond the four templates — the ShowRoom exemplars

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Source: `plc-reference/training-material/Examples Following SDC Standard/`
— ShowRoomChassis.L5X and ShowRoomFlexFeeder.L5X, designated GOLD exemplars
by the leads (full-controller exports; the pattern-inventory deriver only
parses single-program exports, so their shapes are documented here with
citations instead). They follow the standard: same R02 override block, fault
LIMIT(4,…,99)→127, init 100/103/106/124, states 0–3, +3 spacing, State
Engine, MovingAverage cycle time.

## The dial indexer station (S00_IndexerSP / S00_IndexerNoSP)
*(seen in SoftwareStandardization.L5X — the V4.2 template's own indexer;
deepened by MagnetDial_description_by_Dan.txt)*

The indexer is a STATION program, not the supervisor: same R01/R02/R03/R04
skeleton, same override block, its own R20. What makes it its own archetype:

- **`Initialized` is a posture, and the posture is "on station"**: the test is
  the axis position MODULO the index increment, inside a tolerance —
  `MOD(iq_IndexerAxis.ActualPosition,1.0)` in the template, where the axis is
  scaled one unit per nest, and `MOD(pos,36.0)` on a dial scaled in DEGREES
  (Dan: rotary indexer positions are degrees, increment = 360 / fixture
  count). Same mechanism, different unit — the remainder IS the on-station
  test and `increment − remainder` is the next index target, so the dial
  always finishes on a fixture boundary even if it was stopped mid-index.
  The SP variant also ANDs shot-pin extended.
- **Two variants, one flow**: NoSP runs 4 → 10 → 13 → 16 → 22; SP inserts 7
  (retract shot pin) before the safe check and 19 (extend shot pin) before
  index-complete. The shot pin is a second servo axis with its own R05 and
  its own permissive (`p_OnStation` + indexer not jogging/moving) — the
  mutual interlock between pin and dial lives in the two permissives, not in
  extra states.
- **31/34/37 is the canonical SIDE path** (coordination.md's excursion rule
  in the flesh): actuators go unsafe mid-index → the permissive drops → the
  standard MAS rung quickstops the dial → 31 waits for the stop, 34 re-checks
  safety, 37 restarts and re-enters the main flow at 13.
- **40/42 is pause**, entered from state 4 when a station raises q_Pause and
  stations are NOT complete; 42 is a 2000 ms restart transition back to 4.
  Pause is starvation, not fault — the indexer simply does not index, and
  `q_Paused` feeds the Production program's paused-minutes accumulator.
- **Demand/search index is the stack-fed MODE**: when each fixture carries a
  stack of material rather than a part, the release is a request from the
  consumer SM ("this stack is spent / bad, give me the next one") instead of
  an ANDed StationComplete, and the index becomes a SEARCH — keep indexing
  while the upstream stack-present sensor reads empty, counting fixtures. The
  counter is what turns "skip empties forever" into a bounded search: at
  fixture-count indexes with nothing found, flag reject and fault — that is
  the one condition on such a machine that legitimately stops it. Without the
  counter an empty dial spins silently and nobody is paged.
- **CONFLICT — needs Dan/leads ruling**: the V4.2 indexer ships the full
  override block (lockout 99, init 100–124), yet Dan scoped the magnet-dial
  build "this is a dial so no fault recovery and initialization and all that
  stuff" (seen in MagnetDial_description_by_Dan.txt). Best reading: on a dial
  whose satellite mechanisms are pneumatic and never hold a part across a
  stop, the init BLOCK collapses the way the cam chassis's does — the dial's
  home is COMPUTED from the MOD remainder, not driven to — so the directive
  bans synthesizing part-in-hand resume paths that cannot exist, not the
  override block itself. Do not delete 99/100–124 from an indexer on this
  reading alone.
- **The indexer is also the machine's cycle-time instrument**: R03 stamps
  `CycleTimer.ACC` into `StationCompleteTimes[n]` as each station reports
  complete, so the slowest station on the dial is visible without a trace.

## Stack-stripping load station (Magnet Dial) — retract-only sensing, material recovery
*(seen in MagnetDial_description_by_Dan.txt — Dan's dictation, 2026-08-26)*

A coin-changer escapement working off a stack held in the dial fixture:
hold-down presses the stack (and STAYS extended for the whole stack), the
vertical shuttle raises a bar whose pocket has captured one magnet, the top
retainer extends OVER it, the horizontal shuttle strips it off the stack, the
retainer retracts, and a magnet-in-place sensor qualifies the pick. Three
durable ideas beyond the feeding pattern below:

- **Ordering interlocks come from physics and must be stated as states**: the
  top retainer MUST be extended before the horizontal moves or the magnet
  flips up and sticks to the tooling. That is a sequential dependency — its
  own state, its own transition condition — never packed into the strip step.
- **Retract-sensor-only actuation** (all four shuttle cylinders): HOME posture
  is provable, WORK posture is not. So an extend state confirms on the state
  timer plus, where one exists, the PROCESS consequence — the strip's real
  proof is magnet-in-place, the pick's is vacuum verify. Every such extend
  still needs its "Waiting For …" timeout alarm, because the timer is the only
  evidence there is; and `q_ActuatorsSafe`-style clear-of-dial checks must be
  built from the RETRACT sensors, the only trustworthy bits on the mechanism.
- **The verify sensor is the part memory**: a magnet dropped after pick is
  diagnosed by RE-READING — still in the shuttle pocket → retry the pick;
  gone → go get another (coordination.md's gripper-as-memory idea with a
  vacuum sensor doing the remembering). Retry ladders escalate to material
  recovery, not to 127 (coordination.md, CONTROLS #9).

## Sensor-verify station (S04_PartVerify) — the third no-state-machine shape

Alongside the cam stations, the template ships a station with R01/R02/R20 and
no state machine at all: two debounced sensors (part present + top clear),
read ONCE per index on a delay off `q_WaitStationsComplete`, latching
Success/Failure into part tracking and incrementing a consecutive-failure
counter. `q_ActuatorsSafe` is hard-on. The judgment: when a station's whole
job is a read that happens at a known moment in someone else's sequence, the
state machine is ceremony — the verify one-shot plus part tracking IS the
station, and its only alarms are the consecutive-failure fault and the
bypass-active warning.

## Robot station (FlexFeeder P01_Robot) — the PLC supervises a robot PROGRAM
*(seen in ShowRoomFlexFeeder.L5X)*

A Fanuc-robot station has NO servo routine; its state machine is a
conversation with the robot's own program over two EtherNet/IP assemblies
that the Map programs copy with CPS inside `AOI_Fanuc_IN` / `AOI_Fanuc_OUT`:
the 24-byte UI/UO assembly → `Fanuc_Robot_Status` (`.Ready/.Running/.Paused/
.Fault/.TP`, `UserIn1..5` bit words, `UserWord1..6`) and
`Fanuc_Robot_Control` (`IMSTP/SFSPD/Enable/Hold/Start/RemoteStart/CycleStop/
FaultReset`, `UserOut1..5`); plus a large EDA assembly → `ROBOT_INPUT2_T`
(PLC→robot `R50..R59`, PR101+) and `ROBOT_OUTPUT2_T` (robot→PLC `R60..R69`,
`CURPOS_G1`, `CURJPOS_G1`). Station logic touches ONLY those UDTs.

- **Command / echo / clear is the whole dialogue.** The station MOVEs a
  program code into `R50` (4 = PK Main, 100 = Safe Home), the robot answers
  the same code in `R60`, and a standing rung clears `R50` as soon as
  `R60 <> 0`; `R60 = 0` plus not-busy (`UserIn1.0`) is "idle, ready for the
  next command." Every handshake state therefore tests a register value AND a
  bit, and every one carries a "Waiting For …" timeout alarm (1000 ms for
  handshakes, 10 s for the home move).
- **Fanuc UI commands are PULSED, not held**: Start, RemoteStart, CycleStop
  and FaultReset are all ANDed with `g_MachineBasic.Flash250msPD`, while
  `IMSTP`/`SFSPD`/`Enable` are held continuously and `Hold` is the pause line.
- **One state covers the entire production run**: 4 check program running →
  7 start (`Start`) or 10 resume (`RemoteStart`, chosen on `.Paused`) → 13
  trigger main program (R50 = 4) → **16 Running**, where the robot picks for
  hours. Cycle stop splits on where the robot IS: at a cycle boundary
  (`UserIn5.6`) → 37 pause (drop Hold); mid-cycle → 34 stop program. You stop
  a robot at a point ITS program defines, not on the PLC's scan.
- **Recovery excursion with location-based classification**: a collision-guard
  trip (`UserIn1.5`) INSIDE `InConvPickWindow` → 25 abort → 28 fault reset →
  31 delay → re-enter the flow at 7; the identical trip outside the window is
  a hard alarm. Same event, two responses, decided by geometry the PLC derives
  from `CURPOS_G1` LIMITs.
- **Init is the same conversation**: 100 start program → 103 trigger safe home
  (R50 = 100) → 106 wait `R60 = 100` → 124 confirm `R60 = 0` + home-posture
  bit. `Initialized` is a robot-REPORTED posture (`UserIn1.3`, or paused +
  `UserIn1.4`) — the robot owns its own position memory, so the PLC asks.
- Cycle time, part counts and good-part counts all key off robot bits
  (`UserIn5.6`, banner-state latches); part-family selection runs through
  `AOI_FanucRecipe` and is blocked while the machine runs.
- When the robot takes a part FROM a PLC mechanism rather than a nest, the
  handoff is the mirror of this: "part in position" out, "robot in position"
  in, release, then "robot clear" before the mechanism retracts — the retract
  gates on CLEAR, never on the release (MagnetDial_description_by_Dan.txt).
  Dan counts such a robot as one of the station's state machines when its own
  sequence continues past the handoff (it also loads an indexing conveyor).
- The showroom's debug scaffolding (`debug_Cyclerunning` ORed into
  CycleRunning, `debug_supervisor` in series with the Air-OK alarm) is demo
  plumbing — never copy it into a job.

## Conveyor group (FlexFeeder P02_Conveyor) — a run/stop utility machine
*(seen in ShowRoomFlexFeeder.L5X)*

Three conveyors in one program: a Kinetix servo **process** conveyor
(continuous `MAJ`, stopped with `MAS Jog`; `Initialized` is hard-on and init
collapses to 100→124 because nothing homes) plus **incline** and **return**
Lenze VFDs, CPS-mapped into `LenzeInput`/`LenzeOutput` UDTs
(`NetControl`/`NetSetpoint`/`Speed` written every scan, `RunReverse` per
state, `Reset` on fault reset). Its sequence has no part cycle at all: 4 wait
robot running & not pick-tool-stop → 7 start process MAJ → 10 delay → 13
start incline → 16 **Running** → 19 stop incline+process → 25 stopped. The
durable idea is the **staged order** — start the receiving conveyor before the
feeding one and stop them in reverse, with the delay as its own state and each
stage's own confirmation (`.RunningReverse`, `.AtReference`, `MAJ.IP`,
`MAS.PC`) as its own transition and its own timeout alarm. Vision lights and
the vibratory feeder are outputs of THIS machine (states 7–16), not the
robot's — feeder-side ownership again.

Servo boilerplate the application does not need (homing, MAM auto moves,
manual position moves) is KEPT and disabled with `g_MachineBasic.AlwaysOff`
plus a comment saying why ("No Homing Required For Flex Feeder Process
Conveyor. Logic Left In For Standardization") — the axis module is a fixed
shape; neuter what you don't use so the next CE finds every rung where he
expects it. Alarms split into a servo handler (drive-fault text built by
DTOS/CONCAT of `AxisFault`) and a station handler, ORed into `q_AlarmActive`.

## The cam-driven chassis machine — one mechanism program, N listener stations
*(THE authority is now the template itself: ChassisStandard.L5X — Chassis,
S01_PartLoad, S02_ProbeCheck, S03_PartLoad, S18_RejectUnload, S19_GoodUnload,
S20_EmptyNest, HMI, Production, Alarms, SafetyProgram; ShowRoomChassis is the
same shape as a shipped example)*

Control splits in two and the split is the archetype:

- **ONE `Chassis` program owns the mechanism**: cam axis runs continuously on
  MAJ, the dial follows by MAPC off a runtime-built cam profile, and the whole
  machine's timing lives in that program's Setup tags. Its routine set is
  wider than a station's (R01_Inputs, R02_PositionCalcs, R04_StateTransitions,
  R05_StateLogic, R06_CamServo, R07_DialServo, R10_OilPump, R11_CycleTime,
  R20_Alarms) and its state machine is about the MECHANISM's condition, not a
  part: 4 servos on → 7 evaluate posture → 10/13/16/19/22 resync excursion →
  25 engage camming → 28 ready → 31/34 auto jog/jogging → 37 immediate stop /
  40 controlled stop → 43 paused → 46 restart delay → 49/52/55 manual jog →
  58/61/64/67/70 hand-crank mode → 73 immediate stop before camming →
  76 faulted-stop-all-motion → 79 disable servos → 127 faulted → 0 safety.
  Note what is ABSENT: no init block 100–124, no lockout 99, `Initialized`
  hard-off. That is not sloppiness — a mechanism program has no part in hand
  and no "home posture" to drive to; its recovery is RESYNC (servo-motion.md),
  which must live IN the sequence because it is only lawful before camming is
  engaged. Fault is two-stage (76 stop motion → 79 disable → 127) because
  disabling a cammed pair before it is stopped drops a loaded dial.
  Runtime hours, the 30-min/30-s oil-pump duty cycle (with a 15 s no-flow
  warning) and the cam-angle-triggered cycle timer all ride here too — the
  mechanism owns its own maintenance instrumentation.
- **Station programs have NO state machine** — R01_Inputs / R02_Logic /
  R20_Alarms only. R01 mirrors the supervisor bits and debounces sensors
  (`Initialized` is AlwaysOff, deliberately). R02 is fixed in order: load
  `StaNum`/`StaNumPre`, load `NestNumCurrent`/`NestNumIncoming` from
  `\Tracking.p_Data.Station[…].NestNum`, build `CycleStation`, then ONE rung
  per cam window, then the actuator control rung, then `StationPerformance`.
  The cam's angle is the sequencer; stations are synchronized listeners.

The judgment calls that make or break such a station:

- **INCOMING vs CURRENT nest.** An action whose cam window falls DURING the
  index writes tracking against `NestNumIncoming` (the nest arriving under the
  head — a gripper closes on the part while the dial is still moving); an
  action after the index completes uses `NestNumCurrent`. Every such rung in
  the template carries that reasoning in its comment, and the station's
  `CycleStation` must qualify the SAME nest it writes. Get it backwards and
  the machine silently credits the neighbouring part — the defect that never
  shows up until reject analysis.
- **`CycleStation` is the qualification, and it is per-nest, per-station**:
  SafetyOK + CycleRunning + not station Lockout + not nest Lockout +
  (predecessor `.Success`, OR `PartLoaded` + predecessor `.Lockout`) +
  `FailureType = 0` where the op only applies to good parts + `XIO(...
  Station[StaNum].Attempt)`. A locked-out station still OTLs `.Lockout` into
  the nest so downstream stations know the step was skipped, not failed. The
  showroom's process-check station abbreviates this to safety + running + the
  two lockouts; the TEMPLATE's fuller form is the authority whenever an
  upstream step can fail.
- **Timing advance is a speed-compensated window, and it is opt-in per rung.**
  `Chassis_CamPos_Check` corrects the trigger angle by a parabolic function of
  machine velocity (advance = `SQRT(0.865·v − 86.5)` degrees above 100 deg/s)
  and fires a one-shot inside a fixed −2°/+5° wrap-aware window. Turn it ON
  (`EnableTimingAdvance = 1`) for ACTUATOR commands — valve/gripper/vacuum
  engage and disengage — so a faster machine fires earlier and the part is
  still acted on at the same physical place. Leave it OFF for pure sensor
  READS (probe checks), where the true angle is the point of the measurement.
- **Failure attribution is a numeric code plus a string, written at the
  station**: `FailureType` is station-derived (station × 10 + a per-mode
  digit) and `FailureMessage` is a station string; both ride in the nest to
  the unload station, which counts them into
  `ProductionData.FailureTypeCounts[type]` (size the array last-station × 10 +
  9). The unload stations are the only part counters, and the reject station
  COPs an empty `Tracking_Part_Assy_Stat` over the nest a few degrees after
  release to zero the nest for its next trip.
- **Shipped station variants** (use them as the vocabulary): pneumatic gripper
  load with part-present verify (S01), probe/sensor process check that also
  verifies the probe RETRACTED at a second angle (S02), vacuum load with a
  release-pulse and a vacuum-didn't-drop fault (S03), reject unload (S18),
  good unload (S19), and the **empty-nest check** (S20 — same probe shape but
  the fault is "Part Detected In Nest" at a single consecutive failure,
  because a part left in a nest wrecks the next load). The 20-nest showroom
  machine recombines the same vocabulary — vacuum load at S01, thickness/probe
  check at S03, and ONE unload at S19 doing good AND reject off
  `FailureType` — which is the pattern to copy when there is no reject chute.
  Station numbers are dial POSITIONS, so the unused numbers between them are
  geometry, not omissions.
- **Machine modes a chassis needs that a PNP does not**: hand crank (states
  58–70, brake released via SSV, fault if the crank is inserted while
  running), cycle-start auto jog (supervisor 14/16 → chassis 31/34, with an
  HMI standard/fast speed toggle published back as
  `StandardSpeed_Active`/`FastSpeed_Active`), and cleanout/run-out mode
  (coordination.md).

Safety on this platform is CIP Safety in a separate `SafetyProgram`: dual
channel E-stop with manual reset (falling edge of the reset PB), guard door on
a TOF debounce with AUTOMATIC restart flagged "risk assessment may require
manual", `SO.SafeTorqueOff` per drive plus an air-dump valve on E-stop, and
two bits out to the supervisor (`Safe_q_Status`, `Safe_q_Reset`).

## The machine-services programs — Alarms, HMI, Production, Tracking
*(seen in ShowRoomChassis.L5X: Alarms R01_Logic, HMI R01/R03, Production
R01/R02, Tracking R01/R02)*

A chassis or dial controller also ships four NON-sequencing programs that are
as standard as the stations, each a fixed shape rather than a design:

- **Alarms** is aggregator and historian (coordination.md) plus the PV5500
  display plumbing: popup 90 raised on the first fault, popup 90 / screen 91
  closed on a debounce when the last alarm clears (9999 = close popup,
  8888 = nav-back), and a paged history window driven by a
  `DisplayListControl` — page/scroll moves a pointer, one COP renders the
  visible slice. The active list is COP-cleared on first scan because a
  download can leave it corrupt.
- **HMI** owns screen ARBITRATION, not content: one popup at a time with a
  queue, a resend when a screen change hides the current popup, and a TON that
  unsticks `p_ReplaceScreenNum` if the panel never acknowledges. It also owns
  modes that are pure operator intent — cleanout/run-out, nest indicators.
- **Production** owns counts, minutes, per-shift records and OEE;
  **Tracking** owns the nest/station data the stations write into and updates
  nest performance and nest-to-nest deviation at the unload station only.

The judgment: none of these programs may reach into a sequence. They read
published `q_` bits and the tracking UDT and publish facts back — which is
exactly why a station's alarm list, counters and screen numbers can be local
decisions inside a machine-level contract.

## Cam-driven multi-hub variant (SDC Flex Chassis platform, e.g. Job 098)

Same archetype, more mechanism: one camshaft driven by the turret servo drives
THREE hubs (P&P/upper, press-verify/middle, shot-pin/lower) through followers
and levers on Modified Sine profiles. Hub position is therefore NOT a
PLC-commanded axis — it is a mechanical function of camshaft angle, so the PLC
reads the angle and correlates it against the ME's timing diagram instead of
commanding extends and retracts. The safety consequence follows: whether it is
safe to index is answered by the cam design, not by a software permissive on
hub position — on the Normal Speed Flex Chassis the shot pin is mechanically
guaranteed retracted across the whole ~47°–111° index window while the upper
and middle hubs are deliberately allowed to begin rising in its tail. Ask the
ME for the timing diagram; do not invent an interlock the cam already enforces.
(Software still needs the index-permissive array for the DISCRETE actuators
that enter a nest — see coordination.md.)

## Feeding: vibratory bowls, escapements, nests (Dan, 2026-08-28)

SDC has shipped vibratory-bowl feeding on a thousand machines — never a novel
arrangement. The pattern: a **vibratory feeder bowl** (with its inline track)
supplies an **escapement** that singulates one part into a **pick nest**; a
part-present sensor at the nest gates the consumer. In a multi-state-machine
station the bowl, escapement fingers/shuttle and the nest sensor are ALL part
of the state machine that includes the ESCAPEMENT — never part of the
pick-and-place/consumer machine, which only reads the nest handshake. Bowl
control is auto-on while the station runs, off on fault/lockout. FlexFeeder is
the shipped exemplar of feeder-side ownership — bowl, vision lights and belts
live in the conveyor SM while the robot SM only relays those bits onto robot
DO words (SDC voice: a device is "part of a state machine"; machines "own"
devices; nothing is ever "commanded by a machine"). The stack-strip section
above is the same split with the dial fixture as the source instead of a bowl.

## Flex Feeder Primary configuration (2026-09-05)

**Flex Feeder Primary** is the shippable version of the showroom pair: a Fanuc
SCARA with Fanuc vision and encoder tracking a moving belt, a TLP motor on a
Kinetix 5300 for the process conveyor, and two Lenze VFDs for incline and
return. Program split matches the exemplar — conveyor sequencing in
`S10_FlexFeederConveyor.L5X`, robot sequencing in `S10_FlexFeedRobot.L5X`:
two sequence programs feeding one physical station, not one monolithic S10.
Standard `MapInputs`/`MapOutputs` are trimmed to rung 1 each (the rest is for
hardware this configuration doesn't have) — treat the remainder as N/A, not
missing.

_Source: SDC Flex Feeder Primary.txt (network: SDC Engineer), ingested 2026-09-05 by the inbox librarian._
