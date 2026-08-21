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
can't be re-entered, no alarm explains it (the exact v3 blocker). The
gripper's commanded state is the ONLY memory of the part across a stop, so
every one of these branches keys on GripperClosed/GripperOpened. A new
station may re-derive WHERE the carrying path re-enters (that's logic
altitude), but both postures must have a path in Initialized, in init, and
out of state 2 — always.

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) Before copying a permissive branch onto a second axis in the same rung, ask what physically goes wrong if that axis is still moving. If the answer is a mispick, a crash, or a part dropped off-target, there is no wide-window shortcut — the shortcut only buys cycle time and it costs position integrity.
