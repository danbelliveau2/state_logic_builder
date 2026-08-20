# Jason Feedback Analysis — Z-Axis "Wrong State" Red-Crosses (R05_ZAxisServo, V42)

**File reviewed:** `SDC_PNP_Test/S01_ServoPNP_AI_Generated_V42.L5X`
**Feedback:** Jason red-crossed the `Status.State[19]` and `Status.State[25]` branches in rung 14 (auto position staging) and rung 15 (MAM command) of R05_ZAxisServo, reading them as "Wait For Index Complete" and "Open Gripper" — states where the Z axis must not move.

---

## VERDICT: (B) — WRONG LABELS, not wrong logic. The generated logic is provably correct; the labels Jason saw are the *legacy template's* state map, not this file's.

The twist: the mislabels are **not in the generated file at all**. The generated L5X's own `Status.STATE[]` comments are correct and match its logic. The labels Jason cited ("Wait For Index Complete" on 19, "Open Gripper" on 25) are, verbatim, the state descriptions from the legacy SDC reference template `SDC_PNP_Test/S05_ServoPNP.L5X`, whose state numbering assigns different meanings to 19 and 25. Jason reviewed the AI file's state numbers through the legacy map — most likely because he imported the program into a Studio 5000 project that already carried the legacy `Status` tag descriptions (on import collision, Studio 5000 keeps the existing tag's operand comments), or because he cross-referenced the legacy printout.

## Evidence

### 1. Generated file rung 14 (R05_ZAxisServo "Auto Mode", staging) — exact Text

```
XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,ZAxisMotionParameters.MoveType) ,MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMotionParameters.Decel) ,XIC(Status.State[7]) MOVE(HMI_ZAxis.Parameters.Positions[1],ZAxisMotionParameters.Position) ,XIC(Status.State[19]) MOVE(HMI_ZAxis.Parameters.Positions[2],ZAxisMotionParameters.Position) ,[XIC(Status.State[13]) ,XIC(Status.State[25]) ,XIC(Status.State[100]) ] MOVE(HMI_ZAxis.Parameters.Positions[0],ZAxisMotionParameters.Position) ];
```

Staging: 7 → Positions[1] (Pick), 19 → Positions[2] (Place), 13/25/100 → Positions[0] (Clear). `AOI_RangeCheck` in rung 21 confirms the position index meanings: `ZAxisClear = Positions[0]`, `ZAxisPick = Positions[1]`, `ZAxisPlace = Positions[2]`.

### 2. Generated file rung 15 ("Axis Motion Command", MAM) — exact Text

```
XIC(SafetyOK)[XIC(Status.State[1]) XIC(ZAxisManMoveTrig) ,XIO(Status.State[1]) [XIC(Status.State[7]) ,XIC(Status.State[13]) ,XIC(Status.State[19]) ,XIC(Status.State[25]) ,XIC(Status.State[100]) ] ]XIC(iq_ZAxis.ServoActionStatus)XIC(iq_ZAxis.AxisHomedStatus)XIC(ZAxisPermissive)MAM(iq_ZAxis,ZAxis_MAM,...);
```

Z is commanded in exactly {7, 13, 19, 25, 100} — precisely the diagram's Z-motion states, and no others.

### 3. Generated file's own `Status` tag comments (lines 3805–3834) — states 16–28

```
.STATE[16]  Move X Axis To Place Position
.STATE[19]  Move Z Axis To Place Position
.STATE[22]  Open Gripper
.STATE[25]  Move Z Axis To Clear Position
.STATE[28]  Move X Axis To Pick Position
```

Correct — 19 and 25 ARE Z-move states in this program.

### 4. R02 transition comments agree (lines 5218–5251)

- Rung 8: `State 19: Move z axis to place position` — entered from `State[16] + XAxis_MAM.PC + XAxisPlace.InPos`
- Rung 9: `State 22: Open gripper` — entered from `State[19] + ZAxis_MAM.PC + ZAxisPlace.InPos`
- Rung 10: `State 25: Move z axis to clear position` — entered from `State[22] + GripperOpened`

The transition *conditions* prove the semantics: state 22 is only entered once Z has completed the move to Place — so state 19 is unambiguously the Z-to-Place motion state.

### 5. Diagram cross-check (`projects/SDC_Servo_PNP.json`)

Node order → DFS states: 4 Wait-index, 7 ServoMove:Pick (Z), 10 Engage gripper, 13 ServoMove:Clear (Z), 16 ServoMove:Place (X), 19 ServoMove:Place (Z), 22 Disengage gripper, 25 ServoMove:Clear (Z), 28 ServoMove:Pick (X), 31 complete. **Identical to the generated file.**

### 6. The source of Jason's labels — legacy template `S05_ServoPNP.L5X` (lines 3112–3140)

```
.STATE[4]   Start Of Sequence, Wait For Part Present
.STATE[7]   Extend Z Axis To Pick Position
.STATE[10]  Close Gripper
.STATE[13]  Retract Z Axis
.STATE[16]  Extend X Axis
.STATE[19]  Wait For Index Complete      ← Jason's label for 19
.STATE[22]  Extend Z Axis To Place Position
.STATE[25]  Open Gripper                 ← Jason's label for 25
.STATE[28]  Retract Z Axis
.STATE[31]  Retract X Axis
```

The legacy sequence puts its index-wait MID-sequence at 19 (between X-extend and Z-place) and has no start-of-sequence index-wait; the AI diagram puts it at state 4. From state 19 onward the two maps are shifted by one action. Both of Jason's red-cross labels match the legacy map exactly, and neither appears at those operands in the generated file.

### 7. X axis (R04_XAxisServo) — same pattern, also correct

Staging: `[State[16], State[106]] → Positions[1]` (Place), `[State[28], State[103]] → Positions[0]` (Pick). MAM gated on `{16, 28, 103, 106}` — exactly the diagram's X-motion states.

## Would the current validator have caught it?

`src/lib/agentGenerator/validator.js → validateAgainstDiagram` (lines 526–621), traced:

- **Check (b), lines 595–618 — the wrong-state-command guard:** extracts commands per rung via `OT[EL](q_*)`, `MAM(iq_*`, and `MOVE(HMI_*.Parameters.Positions`, resolves each to a device, and errors if any `XIC(Status.State[n])` in that rung names a sequence-grid state (4–97, `(n-4)%3===0`) whose diagram node has no action for that device. **If this had been defect (A) — Z genuinely staged/commanded in a non-Z state — this check catches it**, for both the staging rung (Positions MOVE) and the MAM rung. It correctly passes here because 7/13/19/25 all carry Z actions in the diagram (100 is skipped as init "template law").
- **No comment/label check exists.** Nothing compares `<Comment Operand=".STATE[n]">` tag descriptions or R02 rung comments against the diagram state labels. Worse, rung comments are folded into the device-evidence blob (line 558, `blob = normIdent(r.text + ' ' + r.comment)`), so a wrong comment naming a device could *satisfy* evidence check (a2) that the logic alone would fail. **If this had been defect (B)-in-file (shifted comments), the validator would NOT have caught it.**
- The actual defect — a reviewer-environment label collision — is outside any file validator's reach, but it is preventable at generation/handoff time (below).

## The fix

1. **No code defect to fix in this file** — the correct response to Jason is a side-by-side of rung 15's entry conditions vs. the two state maps (section 4 above proves 19 = Z-to-Place).
2. **Generation/handoff (mergeEngine + export packaging):** the generated program reuses the legacy program/tag names (`Status`, UDT `StateLogicStatus`) while assigning different meanings to the same state numbers. On import into a project that already holds a legacy-commented `Status` tag, Studio 5000 keeps the existing descriptions and the new logic is displayed under old labels. Either (a) emit a state-map cross-reference comment on R02 rung 0 (currently a bare `NOP()` with comment "Start Of State Machine" — put the full numbered state list there so the map travels inside the routine, immune to tag-comment collisions), and/or (b) ship a one-page state map with every generated file sent for review.
3. **Validator (cheap, closes the in-file variant of this class):** add a check that every `Comment Operand=".STATE[n]"` on the `Status` tag, and every R02 `State n:` rung comment, matches diagram state n's label/action; and stop counting rung comments as device evidence in check (a2) (validate text and comment separately).

## Do current v1.0.2+ checks already prevent it?

- Defect class **A** (wrong-state servo command): **yes** — check (b) covers OTE/OTL, MAM, and Positions staging on sequence-grid states.
- Defect class **B** (mislabeled state comments in the file): **no** — comments are never validated, and are even trusted as evidence.
- This incident's actual mechanism (label collision in the reviewer's project): **no**, and no file validator can — mitigate at generation/handoff per fix #2.

## Proposed meKnowledge / generationRules lines

1. "State comments and branch labels must be generated from the state map, never copied from reference L5X files; every `.STATE[n]` comment and R02 rung comment names state n's actual diagram action, and the validator rejects any comment that disagrees with the state map."
2. "Servo staging and MAM state lists may only contain sequence states whose diagram node commands that axis (plus template-law init states) — enforced by validateAgainstDiagram check (b); never hand-edit these lists."
3. "Every generated program embeds its full state map as the comment on R02 rung 0, because legacy SDC templates assign different meanings to the same state numbers (e.g. legacy 19 = Wait For Index Complete vs. generated 19 = Z to Place) and Studio 5000 keeps a colliding project's existing tag descriptions on import."
