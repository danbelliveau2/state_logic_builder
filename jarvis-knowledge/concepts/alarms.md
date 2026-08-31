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
choice between "exit the sequence through 127" and "stand still and wait."

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
on the other branch). Not-homed-at-start needs no invented rung: the
loss-of-reference servo alarm shape (`XIO(iq_{Axis}.AxisHomedStatus)` +
PowerUpCP gate) is the standard's existing answer.

## What the CE standards document adds (PLC Software Standardization, Rev2 §11, §21)

The department's written standard confirms and sharpens the template
behavior (`plc-reference/standards-docs/EE Process and Standards Documents/`):

- **Discrete-action alarms watch the DEVICE, not the state**: a
  cylinder-not-retracted alarm is conditioned on the state of the output and
  the input — never on "we are in state N too long." The alarm is about the
  actuator failing, and it must say so regardless of which state asked for
  the move. (This is why V3.0 of the template rewrote all output faults this
  way — Revision History, 2026-04-17.)
- **A locked-out station must not alarm while the cycle runs** — its waits
  will never complete by design.
- **Warnings and retries exist to reduce stoppages** — the document states
  the intent outright (§21), matching Dan's prime directive: machines that
  stop less. Template V4.1 demoting "Waiting For Part" faults to warnings is
  this principle applied.
- **Message format**: station prefix + condition + operator action —
  "S01 Part Load: Waiting For X Axis To Extend", "S20 Box Close: Box Jam
  Detected, Remove Box From Machine" (§11). The station prefix is not
  decoration; alarms from every program land in one machine-wide list.
- **Machinery**: one ProgramAlarmHandler per program's R20; one
  CPU_TimeDate_wJulian instance per project feeding the controller tag
  `CPUDateTime` that every handler instance consumes; Alarms + HMI programs
  imported per Supervisor (HMI first). TopAlarms (V2.2+) keeps top-5 alarms
  since reset and per shift.

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

## Alarm partitioning across the MCD 3-state stroke — VERIFIED ANSWER (Jason confirmed v7 correct, 2026-08-26)

A fast/slow servo stroke compiles to three states (MAM-command state exiting
on `MAM.IP`, transition-band wait exiting on `{Pos}Transition.InPosWide`, MCD
speed-change state exiting on strict arrival). **Answered from the verified
work** (SDCServoPNP_JARVIS_v7.L5X R20, confirmed correct by Jason Perry
2026-08-26): the partition is **two alarms per stroke, by milestone**:

1. **The MAM-command state and the MCD state share the DESTINATION-ARRIVAL
   alarm** ("Waiting For {Axis} To Reach {Target} Position") — both are
   waiting on the same final move. Verified: Alarm[2] "Reach Pick Position"
   covers states 7 + 13; Alarm[3] "Reach Place Position" covers 31 + 37;
   Alarm[4] "Reach Retract Position" covers 19 + 25 + 43 + 49 + 100 (both
   retract strokes and the init stroke fold onto one destination rung).
2. **The transition-band wait states get their own per-TRANSITION-POINT
   alarm** ("Waiting For {Axis} To Reach {Pick|Place} Speed Transition") —
   one rung per named transition point, shared by BOTH directions through
   it. Verified: Alarm[6] covers states 10 + 22 (descend + rise through
   PickTransition); Alarm[7] covers 34 + 46.

Every message names the milestone the state is actually waiting on, and no
state appears in two rungs. Verified FaultTimes: **3000 ms** on
destination-arrival rungs, **5000 ms** on transition-band rungs, 10000 ms on
the part-present idle warning. (An earlier first-pass draft folded the
MAM-command states into the transition alarms — wrong: a timeout there means
the final move never started, and the operator would read a milestone the
axis wasn't waiting on.)

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Alarm messages are operator instructions, not fault labels. Write them as condition plus required recovery action ('Absolute Position Reference Lost - Rehome Required') so the person at the HMI knows what to do without consulting the print or a controls engineer.
- (2026-08-24, from Dan's correction of build b_mt3bnrp3_7yxhic [import-failure lesson — Jarvis self-diagnosis]) A Studio 'Data type mismatch' on an aggregate Data property usually signals a shape/arity failure from a delimiter error, not a bad element value — inspect brackets and dimensions first, not the string contents.
- (2026-08-24, from Jason Perry's review of v5 — SDCServoPNP_JARVIS_v5, build b_mt3bnrp3_7yxhic) The alarm list is derived from what exists: no alarm may reference a position the axis does not have (v5's "Waiting For Horizontal Axis To Reach Home Position" — horizontal PNP axes have no home). Every "Waiting To Reach X" alarm must name a declared Positions[i] slot with its RangeCheck instance.
- (2026-08-24, from Jason Perry's review of v5) One idle-wait warning per cycle start, named for the real condition: with state 4 = Wait For Part Present, the template's single "Waiting For Part Present" Severity-1 warning is the shape — an additional "Waiting For Cycle Start" warning on the same idle (v5's Alarm 9) alarms the station's normal resting condition and is removed, not tuned.
- (2026-08-25, from the fix loop (tuition)'s correction of build Test_Project_v2 / ServoPNP [tuition]) Template routines that carry two parallel alarm blocks (ServoAlarm[i]/ServoAlarmList[i] and Alarm[i]/AlarmList[i]) share an index space and a naming prefix relationship. Treat the servo block and the station block as separate namespaces when planning edits, and never assume a bracketed index alone identifies which block you are in.

## Third-party device AOI error codes as alarm sources (2026-08-29)

When a station integrates a vendor AOI-driven device (e.g. Balluff BIS M-4006 RFID read/write head), the AOI's own hex ErrorCode/DN/ER/IP status bits are the direct source for that device's station-prefixed alarm messages — don't invent parallel fault logic. Typical categories worth mapping 1:1 into alarm text: tag not in range, read/write error, tag removed mid-operation, CRC mismatch, communication/cable break to the read head, command timeout, and command-not-supported. Each vendor AOI instance is per-physical-device (never shared), so alarms should be tagged per-instance the same way any other per-device fault is (station+device-prefixed), using the AOI's native ErrorCode rather than re-deriving fault conditions from raw I/O.

_Source: BIS_M_4006-034_V5 AOI User Manual.pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## Fault detection: output/input state vs. timeout, and starvation as a warning (2026-08-30)

- SDC's alarm standard evolved away from pure state-timeout faulting: alarm routines now derive output faults from the actual state of outputs and inputs (did the output achieve the expected input state) rather than solely 'did this state take too long.' Servo quickstop warnings are layered in alongside this where a quickstop occurred.
- Part-starvation ('Waiting For Part') is standard as a WARNING, not a fault, on load/PNP-style stations (seen on S01_PartLoad, S03_PartLoad, S05_ServoPNP) — the machine should not hard-fault just because it's waiting to be fed; this matches the 'machines that stop less' philosophy already known for retries.
- TopAlarms AOI: alarm handling tracks the top 5 alarms since last reset AND the top 5 alarms per shift, plus logic to store which alarm actually stopped the machine (q_MachineStopReason on the Supervisor) — this is the standard alarm-history mechanism to reach for when a station/machine needs 'what's been faulting on me' reporting.

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Output/input-state-based faulting, warning vs. fault, and TopAlarms (2026-08-30)

- Fault detection is not purely state-timeout based: SDC alarm routines also fault directly off the **actual state of outputs and inputs** (e.g., an output commanded on but its sensor never confirming) — faster and more specific than waiting for the generic per-state fault timer to expire. Fault timers remain the backstop; output/input-state checks are an additional, more targeted layer.
- Not every stall is a fault: 'Waiting For Part' conditions on part-load/PNP stations are **warnings**, not faults — they don't stop the machine, just flag that it's waiting. This mirrors the standing rule that transient/expected empty conditions shouldn't nuisance-stop the line.
- The alarm system keeps a **TopAlarms** AOI: top-5 alarms since last reset and top-5 alarms per shift, plus logic to store which alarm actually stopped the machine (for diagnostics/andon).

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Output-state-based fault detection (v3.0) + fault-vs-warning judgment (2026-08-30)

Starting in template v3.0, output faults are generated from the actual state of outputs and inputs rather than purely from state-timeout expiry — the alarm routine checks whether an output achieved its expected input state, not just whether time ran out. Standard per-state fault timers (5000 ms) remain the backstop, but this is a template-level deepening: detect the fault condition directly when possible, use the timeout as the fallback/backstop.

Separately, the template family made an explicit judgment call: 'Waiting For Part' conditions on S01_PartLoad, S03_PartLoad, and S05_ServoPNP were downgraded from FAULTS to WARNINGS — waiting on an upstream part is normal starvation, not a stoppable machine condition. This is the standard reasoning to apply when classifying any new alarm: does the condition mean something is broken (fault, stops the machine) or just that the station is waiting on something external and normal (warning, does not stop the machine).

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._
- (2026-08-31, from the fix loop (tuition)'s correction of build PNP_ServoX- PneumaticZ / MidBaseEscapement [tuition]) A station whose only waits are on a partner's signals must plan the alarm coverage for those waits at the same moment it plans the waits themselves — each wait state needs either its own timeout rung or membership in a shared per-milestone rung with a FaultTime, and a wait that holds a part while the partner is late is a Severity-1 warning feeding q_Pause, not a fault. Deciding the wait conditions in the pre-write pass without simultaneously deciding which R20 rung covers them is what leaves an exitless wait in the first plan.
