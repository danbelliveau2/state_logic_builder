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

## Robot station (FlexFeeder P01_Robot) — the robot IS the sequence partner

A Fanuc-robot station has NO servo routine; the state machine converses with
the robot over EtherNet/IP through two structures:

- `i_RobotStatus` — status UDT: `.Running`, `.Paused`, `.Fault`, and
  general-purpose `UserIn` words (`UserIn1.0`, `UserIn1.4`, `UserIn5.6` …)
  that the robot program sets as step/handshake flags.
- `i_RobotEDAIn.R{n}` — robot REGISTERS (numeric): transitions compare them
  with EQ (`EQ(i_RobotEDAIn.R60,0)`, `…,4`, `…,100`) — the register value
  encodes which robot program step is active or acknowledged.

The PLC-side states are thin: request work, watch register+bits progress,
time-bound each phase with the per-state `StateTimer[n]` TON, and treat
`.Paused`/`.Fault` as branch conditions (P01_Robot R02 rungs 4–13). Init
(100→103→106→124) is the same conversation: command the robot home via
registers, confirm via UserIn bits. Cycle-complete is a robot bit
(`UserIn5.6`) — even the cycle timer keys on it. Robot vision guidance
(Flex Feeder) lives on the robot; the PLC only gates the pick window
(`InConvPickWindow`).

## Cam-driven chassis stations (ShowRoomChassis) — no state machine at all

The chassis machine splits control in two:

- ONE `Chassis` program owns the mechanism: cam axis runs CONTINUOUSLY
  (MAJ during auto states, MCD to change speed live via HMI toggle, MAM only
  for setup/point moves), and the dial follows by MAPC electronic camming —
  the cam profile is BUILT AT RUNTIME (`DIV(360.0,p_SetupNestQty,NestSpacing)`
  filling `CamProfileArray`), one nest per cam revolution. Its routine set is
  wider than a station's (R02_PositionCalcs, R04_StateTransitions,
  R05_StateLogic, R06_CamServo, R07_DialServo, R10_OilPump, R11_CycleTime).
- Station programs (S01_PartLoad, S03_ThicknessCheck, S19_PartUnload) have
  NO state machine — just R01_Inputs / R02_Logic / R20_Alarms. Actions fire
  inside CAM-ANGLE WINDOWS via the `Chassis_CamPos_Check` AOI against global
  engage/disengage angles (`g_ActuatorEngageAngleS1`), with part-tracking
  OTLs on `\Tracking.p_Data.Nest[...]` in the same rungs. The cam's angle is
  the sequencer; stations are synchronized listeners.

Judgment: when a machine is cam-synchronized, do NOT force the state-machine
skeleton onto its stations — the chassis archetype replaces R02/R03 with
angle-window logic, and lockout/part-tracking semantics ride on Tracking
OpStatus exactly like stated in the standard.

## Servo conveyor (FlexFeeder P02_Conveyor)

A conveyor axis mixes MAJ (continuous run) with MAM (indexed/positioning
moves) in one R04_ConveyorServo routine, plus MAH homing — the axis-module
boilerplate holds; only the motion-trigger rungs differ (per the leads'
boilerplate map, JARVIS_QUESTIONS #4). Its init is the reduced 100→124 pair —
init states are a menu sized to the recovery problem, not a fixed ladder.

## Feeding: vibratory bowls, escapements, nests (Dan, 2026-08-28)

SDC has shipped vibratory-bowl feeding on a thousand machines — this is
never a novel arrangement. The pattern: a **vibratory feeder bowl** (with
its inline track) supplies an **escapement** that singulates one part into a
**pick nest**; a part-present sensor at the nest gates the consumer. In a
multi-state-machine station the bowl, escapement fingers/shuttle, and the
nest sensor are ALL **part of the state machine that includes the escapement** — never part of the
pick-and-place/consumer machine (which only reads the nest's part-present
handshake). Bowl control is auto-on while the station runs, off on
fault/lockout — a bowl is part of the feeding state machine even when the ME
mentions it while describing the pick. FlexFeeder is the shipped exemplar of
feeder-side ownership (SDC voice: a device is "part of a state machine"; machines "own" devices; nothing is ever "commanded by a machine"); the same split held on every escapement station since.
