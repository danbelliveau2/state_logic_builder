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
as disorder even when the flow is correct. Side paths and synthesized states
take the next free grid numbers and their rungs sit at their NUMERIC position
(the indexer's recovery states 31/34/37/40/42 do exactly this). After the
sequence rungs comes the override block in template order: lockout 99, the
init states ascending (100 → 124), restart logic, fault 127, manual 1, safety
stop 0, then the State_Engine call and the cycle timer. The override block is
last on purpose — the LAST write to Control.StateReg wins the scan, so faults
and safety override the sequence no matter what it decided.

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Before copying a permissive branch onto a second axis in the same rung, ask what physically goes wrong if that axis is still moving. If the answer is a mispick, a crash, or a part dropped off-target, there is no wide-window shortcut — the shortcut only buys cycle time and it costs position integrity.
