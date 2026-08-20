# Alarms & faults — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Seeded by the correction-learning loop — deepen into full engineer's-
understanding prose as the concept matures.

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Alarm messages are operator instructions, not fault labels. Write them as condition plus required recovery action ('Absolute Position Reference Lost - Rehome Required') so the person at the HMI knows what to do without consulting the print or a controls engineer.
