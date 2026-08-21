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

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Alarm messages are operator instructions, not fault labels. Write them as condition plus required recovery action ('Absolute Position Reference Lost - Rehome Required') so the person at the HMI knows what to do without consulting the print or a controls engineer.
