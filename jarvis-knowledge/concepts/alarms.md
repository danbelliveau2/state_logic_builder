# Alarms & faults — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Seeded by the correction-learning loop — deepen into full engineer's-
understanding prose as the concept matures.

## Fault vs warning: severity decides whether the machine gets out
*(learned from internal review of v3, 2026-08-21)*

Two severities, two completely different machine behaviors. An alarm with no
Severity move is a FAULT: it sets `AlarmActive`, which drives `q_AlarmActive`,
which R02's fault rung turns into state 127 — the sequence is abandoned and
recovery runs. `MOVE(1,{Alarm}.Severity)` makes it a WARNING: it sets
`WarningActive` only, feeds `q_Pause`, and the sequence HOLDS where it is,
ready to continue. Severity is therefore not a cosmetic ranking — it is the
choice between "exit the sequence through 127" and "stand still and wait,"
and (see the scoreboard section) it also decides whether the condition can
ever be counted as a downtime cause.

The standard's judgment call (S05 R20): a condition is a WARNING only when
standing still is the correct response — the wait can legitimately resolve
itself or the operator can feed it (rung 10 "Waiting For Part Present",
Severity 1, generous 10000 ms), or it is a notice attached to a stop that
already happened (rung 4 quickstop warning). Everything that requires a
human to intervene before the cycle can be correct is a FAULT: the five
motion timeouts (rungs 5–9, no Severity move), and both "Loss Of Absolute
Position Reference" rungs (1 and 3) — an axis not homed is a fault, full
stop, because `AxisHomedStatus` gates every auto MAM, so an unhomed axis
means the sequence CANNOT proceed and no amount of waiting fixes it. Coding
a not-homed exit as a Severity-1 warning strands the machine: WarningActive
never raises q_AlarmActive, 127 is never entered, the "go home the axes in
manual" path the sequence promised does not exist (the v3 blocker).

Shape notes that ride with this: alarm rungs are single-purpose — one wait
per rung, owning its own `MOVE(n,Control.FaultTime)` and its own message, so
the FaultTime written is always the one for the state actually waiting and
the operator learns exactly which move failed. Mixing a non-timeout
condition into a timeout rung breaks both (its FaultTime MOVE only executes
on the other branch). The template's verbatim shape is
`[[state branch] MOVE(t,Control.FaultTime) XIC(Status.TimeoutFlt) ,
XIC(Alarm[i].Active) XIO(FaultReset)] [OTE(Alarm[i].Active) , ONS
CONCAT(g_StationList[StaNum],AlarmList[i],Alarm[i].Message)]`: the FaultTime
MOVE lives INSIDE the state branch, the alarm seals itself in until
FaultReset (so the first cause survives for the blame scan), and the message
is composed ONCE on the rising edge from the global station list plus the
local text — never rebuilt every scan. Every device rung also opens
`XIO(Lockout)`. Not-homed-at-start needs no invented rung: the
loss-of-reference servo alarm shape (`XIO(iq_{Axis}.AxisHomedStatus)` +
PowerUpCP gate) is the standard's existing answer.

## Detect the failure, don't just time the state (V3.0 onward)
*(Revision History ingests 2026-08-30/09-01, consolidated; confirmed in
SoftwareStandardization.L5X V4.2)*

Since template V3.0 discrete output faults are derived from the ACTUAL state
of outputs and inputs — "I commanded extend and the extended feedback never
came" (`XIC(q_ExtendZAxis) XIO(ZAxisExtended)` plus its own TON, S01/S18/S19
R20) — with the per-state fault timer left as the backstop. A
device-conditioned rung names the broken actuator no matter which state
asked for the move, and it also catches the contradiction cases the state
timer can never see: both extend and retract commanded at once, or both end
sensors made (the "Sensors/Outputs Misconfigured" rung). Servo axes keep the
state-timer form because the milestone, not the device, is what is being
waited on. Alongside this: part starvation is a WARNING (Severity 1), a
servo quickstop gets its own warning-class alarm, and TopAlarms keeps top-5
since reset and top-5 per shift.

## The machine-level alarm spine (\Alarms + \Supervisor)
*(seen in Alarms.L5X: R01_Logic, the whole program; \Supervisor R02 in
SoftwareStandardization.L5X)*

The Alarms program is not a station — it is the machine's alarm bus, and it
is only ~15 rungs doing five jobs. Every station's alarm work lands here, so
a CE should read it as the contract the station rungs are written against.

**1. Roll-up (rungs 2 and 4).** `p_NoMachineFaults` is one long series of
XIOs, one per program that owns an alarm handler — and it includes the
non-station programs: `XIO(\Supervisor.q_AlarmActive)
XIO(\StateMachine.q_AlarmActive) XIO(\S03_PartLoad.q_AlarmActive)
XIO(\S05_ServoPNP.q_AlarmActive)`. A twin rung builds `p_NoMachineWarnings`.
This list is hand-maintained: adding a station means editing BOTH rungs, and
a program left off is invisible to the machine stop and to the andon history
— the same silent-hang failure as a wait with no alarm rung, one level up.
Supervisor inverts p_NoMachineFaults into `q_MachineFaultActive`, which drops
`q_CycleStartLatch` and sets `q_MachineStopReason = 1`.

**2. Self-clearing the active list (rung 5).** `p_Active` is a fixed
16-element AlarmData array that the ProgramAlarmHandler instances publish
into. On first scan, and on the one-shot of "no faults AND no warnings," the
program COPs an empty AlarmData into p_Active[0] and fans it across the other
15. Intent: a download can leave stale entries in a retained aggregate, and
the list is only safe to wipe when nothing is genuinely active. Consequence:
the wipe needs a fully clean machine, so a chattering warning will hold a
corrupted list on screen until it clears.

**3. Blame (rung 13).** On the rising edge of running-AND-faulted, sixteen
unrolled branches scan p_Active in index order and COP the FIRST entry that
is `.Active` AND `Severity = 0` into `AlarmStop`, then pulse
`AlarmStopTrigger` into the TopAlarms AOI. Three consequences: (a) severity
decides whether an alarm can ever be named the stop reason — and therefore
whether it is ever counted in the downtime Pareto — since warnings are
skipped entirely; (b) index order is blame order, which is why device alarm
rungs seal in as `[condition , XIC(Alarm[i].Active) XIO(FaultReset)]` —
holding the ORIGINAL cause until a reset instead of decaying into the last
symptom; (c) sixteen slots is the machine-wide *concurrent* ceiling, so alarm
rungs that fire in swarms (one per sensor, one per partner) crowd out the
real first cause — a reason to compose offenders into one message rather than
spend indices.

**4. HMI coupling (rungs 7–8).** Faults interrupt, warnings only inform: the
popup-90 force is gated on `p_NoMachineFaults` going false, so a Severity-1
warning never steals the operator's screen. The auto-close is stricter — it
waits on a DelayClose TON with faults AND warnings clear before writing 9999
(close popup) or 8888 (nav back from the all-alarms screen 91). That
asymmetry is deliberate: don't nag on a warning, but don't dismiss the alarm
screen while anything is still standing.

**5. History and the scoreboard (rungs 10–12).** `HistSize`/`DispSize` are
captured with SIZE on first scan, and every page/scroll computation is MOD
arithmetic over those two numbers, so resizing `p_History` or the display
window needs no logic edit. The last rung calls TopAlarms(…,
\Production.p_CurrentShift, …, 3) — top-5 since reset and top-5 per shift
across three shifts. What that AOI actually counts is the next section.

## The scoreboard counts STOPS, and it counts them by message text
*(seen in TopAlarms.L5X: parameter list + TopAlarmsDT / AlarmHistory UDTs)*

TopAlarms takes ONE `AlarmData` InOut — the `AlarmStop` record R13 just
blamed — plus the `AlarmStopTrigger` pulse. It is not scanning the active
list. So the whole statistics layer is built from first-cause stoppages: one
count = one machine stop = one named culprit. That closes the chain of
ownership — the station writes conditions, ProgramAlarmHandler writes the
record, \Alarms R13 decides blame, TopAlarms keeps score — and it is the
third and most consequential effect of severity. A condition mis-coded as a
Severity-1 warning is not just "pause instead of 127"; it is permanently
invisible to the people reading the Pareto to decide what to fix next.

`TopAlarmsDT` is `{Message:STRING, AlarmCount:DINT}` — identity for the
statistics is the **message text**, not ProgramID/AlarmID. Judgment falls out
of that directly: the station prefix is a data key, not decoration (it is
what keeps two stations' "Waiting For X Axis To Extend" in separate rows);
rewording a message mid-campaign silently splits one bucket into two; and a
composed CONCAT fragments *on purpose* — the indexer's "…Actuators Not Safe -
S05 Servo PNP" earns a row per offending partner, which is exactly the
diagnostic you want. The flip side: never CONCAT genuinely variable data
(a position value, a part serial, a count) into an alarm message. Every
occurrence becomes a unique row and the top-5 degenerates into five
singletons that say nothing.

Two windows, two InOuts. `TopAlarms` accumulates since the operator's `Reset`
— the campaign Pareto, what to engineer out. `TopShiftAlarms` is indexed by
`CurrentShift` and dimensioned by `NumberOfShifts`, which separates a
shift-shaped problem (material lot, operator technique, tooling wear late in
the shift) from a machine-shaped one. Neither is the audit trail: `p_History`
keeps the full chronological record and is not what Reset clears.

Message length, refined: `AlarmData.Message` is STRING100, but
`TopAlarmsDT.Message` and `AlarmHistory.Message` are plain STRING (82). So
the practical ceiling for text that must survive into history and the
scoreboard is **82 characters**, not 100 — and over-long messages don't just
lose their tail, they can COLLIDE, merging two alarms that share their first
82 characters into one statistics bucket. Compose so the discriminating part
(the offender, the axis, the target) lands early, not after a long prefix.

## The handler AOI is the boundary: the station writes conditions, the AOI writes the record
*(seen in ProgramAlarmHandler.L5X: parameter list + AlarmData / CPU_TimeDate /
STRING100 UDTs; agrees with the earlier v3.1 ingest)*

One instance per alarm ARRAY, and its parameters draw the division of labor
exactly. InOuts are the five things the handler must reach into:
`PublicProgramIDTag` (INT), `LocalAlarmsArrayTag` (the station's own
`Alarm[]` or `ServoAlarm[]`), `AlarmActiveArrayTag` (the machine-wide
`\Alarms.p_Active[16]`), `AlarmHistoryArrayTag` (`p_History`),
`ControllerTimeClockTag` (the single CPU_TimeDate instance fed by
CPU_TimeDate_wJulian). Outputs: `AlarmActiveTag`, `WarningActiveTag`,
`ActiveAlarmArrayIndex`, `ActiveAlarmDuration`, `MyProgramID`.

The fault output is literally named **`AlarmActiveTag`** (this file's own
parameter list; earlier prose here called it FaultActiveTag). That naming is
why "alarm" in SDC speech means *fault* and warnings always get said out
loud: Severity 0 entries raise AlarmActiveTag, Severity 1 entries raise
WarningActiveTag only, the station wires the pair to
`q_AlarmActive`/`q_WarningActive`, and the whole two-severity machine
behavior at the top of this file falls out of which of those two bits the AOI
sets. There is no third output and no severity 2 — the severity field is an
INT, but the handler only distinguishes 0 from non-0.

So a station rung owns only three fields of an AlarmData entry: `.Active`
(the sealed-in condition), `.Severity` (fault vs warning) and `.Message`
(fit it to the 82-character survivable length above). Everything that turns
that into a *record* belongs to the AOI: `ProgramID` stamped from the
program's public ID tag, `TimeStamp`, `Count` on each rising edge,
`Duration` while active, publishing the entry into the 16-slot active array,
copying to history unless `DoNotSaveToHistory` (the flag for standing
status-type warnings such as Bypass), and zeroing a count on
`HMI_ResetCount`. Corollary: never hand-write TimeStamp/Count/Duration in a
station rung and never write `p_Active` directly — the handler being the only
writer is what makes the blame scan and the top-5 statistics trustworthy.

Four mechanism consequences worth carrying:
- **TimeStamp is a LINT of microseconds, not a DT.** The handler copies the
  clock UDT's `UTCMicroseconds` (also LINT) straight into the record, so all
  age/ordering math downstream is plain integer arithmetic and the HMI does
  the human formatting. Don't compare it to a DT literal or feed it to
  instructions expecting a DT; `Count` and `Duration` are DINTs for the same
  reason (cheap to compare, cheap to display).
- **Identity is the pair `ProgramID` + `AlarmID`**; `Group` is only a filter.
  CONFLICT — needs Dan/leads ruling: earlier prose here claimed reusing an
  AlarmID across stations breaks tooling. The interface says otherwise — each
  program stamps its own ProgramID (the Alarms program is 0), so AlarmIDs are
  scoped per program, which is why every station's array legitimately starts
  at Alarm[0]. Note the statistics layer sidesteps both fields and keys on
  message text, so the station prefix is what really disambiguates.
- **`Active`, `DoNotSaveToHistory` and `HMI_ResetCount` are bits packed into a
  hidden SINT** (`ZZZZZZZZZZAlarmData8`), so an AlarmData moves as one atomic
  record under COP. That is what lets `\Alarms` R05 clear the whole active
  list by COPing an empty AlarmData, R13 carry a first-cause entry's flags
  into `AlarmStop` with it, and TopAlarms take that whole record as one InOut.
  You never clear an entry by poking a field — you clear the condition and let
  the handler retire it.
- **`ActiveAlarmArrayIndex` / `ActiveAlarmDuration` are per-INSTANCE.** A
  station with a servo block runs two handlers, so two index/duration pairs
  and two Alarm/Warning bits ORed into `q_AlarmActive`/`q_WarningActive` —
  the same two-namespaces fact as the ServoAlarm/Alarm index lesson below,
  seen from the instance side.

## Fault times are per-milestone values, and messages can name the culprit

- **5000 ms is a default, not a constant.** In the V4.2 indexer alone: 1000 ms
  for "Waiting For Index To Start" (a MAM either takes the command or it
  doesn't), 2000 ms for "Waiting For Indexer To Stop" (a quickstop decel),
  3000 ms per shot-pin stroke, 5000 ms for index-complete and for the
  actuators-safe wait (a partner station may legitimately still be finishing
  a motion), 10000 ms for the part-present idle warning. Each is derived from
  the motion profile of the thing being waited on (CONTROLS #16).
- **Compose the offender into the message when the cause is "one of N
  partners."** The indexer's actuators-not-safe alarm CONCATs the station
  prefix, the condition, and then a branch per station selecting
  `ActuatorsSafeList[i]` for whichever `q_ActuatorsSafe` is low — the operator
  reads "S00 Indexer: Actuators Not Safe - S05 Servo PNP" and walks to the
  right station. One rung beats N nearly identical rungs, it keeps the alarm
  index space small (p_Active holds only 16), and it gives the scoreboard a
  per-offender row. The same trick names a DRIVE fault: S05 DTOSes
  `iq_XAxis.AxisFault` and CONCATs the number onto the station text — the
  fault code is bounded enumeration, not free-running data, so it does not
  shatter the Pareto.
- **Warning first, fault after the machine has finished reacting.** The same
  condition appears twice on the indexer: Alarm[7] is Severity 1, raised on
  entry to the stop state 31 with the composed message; Alarm[8] is a FAULT
  at state 34 on a 3000 ms timer, its message simply MOVEd from Alarm[7].
  While the dial is still decelerating, an actuator out of place is a
  warning; if it is STILL out of place once everything has stopped, it is a
  fault. That is the general escalation shape — not two conditions, one
  condition read at two moments. (It is also why the FAULT half carries the
  same text: the stop that gets counted is the fault.)
- **Non-timeout alarm sources.** A verify station faults on CONSECUTIVE
  failures (`GE(ConsecFails.Count, ConsecFails.Setpoint)`, the counter
  cleared by a pass and by the alarm itself) — one bad part is data written
  to part tracking, a run of them is a machine problem. `Bypass` active is a
  standing warning with no timer at all, so the operator cannot forget the
  station is switched off. Both live on a station with no state machine,
  which is the proof that alarm coverage is owned by the station, not by the
  state engine.

## What the CE standards document adds (PLC Software Standardization, Rev2 §11, §21)

The department's written standard confirms and sharpens the template
behavior (`plc-reference/standards-docs/EE Process and Standards Documents/`):

- **Discrete-action alarms watch the DEVICE, not the state** (the mechanism
  above): a cylinder-not-retracted alarm is conditioned on the state of the
  output and the input — never on "we are in state N too long."
- **A locked-out station must not alarm while the cycle runs** — its waits
  will never complete by design (every S01/S18/S19 device rung opens with
  `XIO(Lockout)`).
- **Warnings and retries exist to reduce stoppages** — the document states
  the intent outright (§21), matching Dan's prime directive: machines that
  stop less.
- **Message format**: station prefix + condition + operator action —
  "S01 Part Load: Waiting For X Axis To Extend", "S20 Box Close: Box Jam
  Detected, Remove Box From Machine" (§11). The prefix is also the statistics
  key, since alarms from every program land in one machine-wide list.
- **Machinery**: one handler instance per alarm array (see above); one
  CPU_TimeDate_wJulian instance per project feeding `g_CPUDateTime`; Alarms +
  HMI programs imported per Supervisor (HMI first).

## The leads' definition of a warning (Jason Perry, 2026-08-20, JARVIS_QUESTIONS_FOR_LEADS #17)

"A warning is a condition where the machine continues to run, but the
operator is alerted to a condition that may eventually cause the machine to
stop." Canonical examples: low parts level in a feeder hopper, low fluid
level, starved conditions like "Waiting For Upstream." This confirms the
severity mechanics above and gives the judgment test in the leads' own
words: if the machine can keep running while a human tends to it, it's a
warning; if the cycle cannot be correct until someone intervenes, it's a
fault (state 127 — CONTROLS_LEADS_QUESTIONS #17). Per-device mandatory
faults (CONTROLS #16): servo = axis fault + loss of absolute position
reference + waiting-to-reach-position; pneumatic = per sensor count; all
fault timeouts are application values from motion profiles, not constants.

## Alarm partitioning across a fast/slow servo stroke
*(template: S05_ServoPNP.L5X R20 rungs 5–9; also SDCServoPNP_JARVIS_v7,
Jason-confirmed 2026-08-26)*

What both shapes agree on, and what actually matters: an alarm names the
MILESTONE a state is waiting on, one rung per milestone, every waiting state
in exactly one rung, and the FaultTime comes from that milestone's motion
profile (3000 ms for a servo destination stroke, 10000 ms for the
part-present idle warning).

In the TEMPLATE the fast/slow stroke is TWO states and ONE alarm covers both:
state 7 commands the fast MAM and exits on `ZAxis_MAM.IP` +
`ZAxisPick.InPosWide` — the WIDE deadband of the destination's own
RangeCheck, not a separately taught transition point — and state 10 issues
the MCD to slow speed and exits on `.PC` + strict `InPos`. Both are waiting
to reach pick, so Alarm[2] "Waiting For Z Axis To Extend To Pick" covers 7
and 10. Alarm[4] "Waiting For Z Axis To Retract" folds further, covering
16/19/37/40 AND the init stroke 100, because they all end at the same taught
position. X gets one rung per direction (extend 22 + 106, retract 43 + 103).
So the index space is per TAUGHT POSITION per axis, not per state — which is
also why an alarm may only name a declared `Positions[i]` slot.

CONFLICT — needs Dan/leads ruling: v7 compiled a THREE-state stroke with a
separate `{Pos}Transition` RangeCheck instance and its own
"Waiting For … Speed Transition" alarms at 5000 ms, and Jason passed it. The
template has neither that instance nor those alarms. Best reading: a
separately taught transition point is an application choice for long strokes,
and the alarm list follows the POSITION list — trigger the speed change off
the destination's wide band (template) and there is no separate milestone, so
there must be no separate alarm; teach a real transition point and it earns
one. Do not add transition alarms to a two-state stroke; do not strip them
from a three-state one.

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Alarm messages are operator instructions, not fault labels. Write them as condition plus required recovery action ('Absolute Position Reference Lost - Rehome Required') so the person at the HMI knows what to do without consulting the print or a controls engineer.
- (2026-08-24, from Dan's correction of build b_mt3bnrp3_7yxhic [import-failure lesson — Jarvis self-diagnosis]) A Studio 'Data type mismatch' on an aggregate Data property usually signals a shape/arity failure from a delimiter error, not a bad element value — inspect brackets and dimensions first, not the string contents.
- (2026-08-24, from Jason Perry's review of v5 — SDCServoPNP_JARVIS_v5, build b_mt3bnrp3_7yxhic) The alarm list is derived from what exists: no alarm may reference a position the axis does not have (v5's "Waiting For Horizontal Axis To Reach Home Position" — horizontal PNP axes have no home). Every "Waiting To Reach X" alarm must name a declared Positions[i] slot with its RangeCheck instance.
- (2026-08-24, from Jason Perry's review of v5) One idle-wait warning per cycle start, named for the real condition: with state 4 = Wait For Part Present, the template's single "Waiting For Part Present" Severity-1 warning is the shape — an additional "Waiting For Cycle Start" warning on the same idle (v5's Alarm 9) alarms the station's normal resting condition and is removed, not tuned.
- (2026-08-25, from the fix loop (tuition)'s correction of build Test_Project_v2 / ServoPNP [tuition]) Template routines that carry two parallel alarm blocks (ServoAlarm[i]/ServoAlarmList[i] and Alarm[i]/AlarmList[i]) share an index space and a naming prefix relationship. Treat the servo block and the station block as separate namespaces when planning edits, and never assume a bracketed index alone identifies which block you are in.
- (2026-08-31, from the fix loop (tuition)'s correction of build PNP_ServoX- PneumaticZ / MidBaseEscapement [tuition]) A station whose only waits are on a partner's signals must plan the alarm coverage for those waits at the same moment it plans the waits themselves — each wait state needs either its own timeout rung or membership in a shared per-milestone rung with a FaultTime, and a wait that holds a part while the partner is late is a Severity-1 warning feeding q_Pause, not a fault. Deciding the wait conditions in the pre-write pass without simultaneously deciding which R20 rung covers them is what leaves an exitless wait in the first plan.

## Third-party device AOI error codes as alarm sources (2026-08-29)

When a station integrates a vendor AOI-driven device (e.g. Balluff BIS M-4006
RFID head), the AOI's own hex ErrorCode/DN/ER/IP status bits are the direct
source for that device's station-prefixed alarm messages — don't invent
parallel fault logic. Map 1:1 into alarm text: tag not in range, read/write
error, tag removed mid-operation, CRC mismatch, comms/cable break, command
timeout, command not supported. Each vendor AOI instance is per-physical-
device (never shared), so alarms are tagged per-instance (station+device
prefix) the same way any other per-device fault is — which also gives the
scoreboard one row per head rather than a merged "RFID error" bucket.

_Source: BIS_M_4006-034_V5 AOI User Manual.pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._
