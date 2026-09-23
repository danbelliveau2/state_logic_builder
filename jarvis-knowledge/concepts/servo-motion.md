# Servo motion — how SDC thinks about it

> **Naming note (2026-09-23):** the chassis template cited below as `ChassisStandard.L5X` is now `ChassisStandard_1UP.L5X`; the two-up variant is `ChassisStandard_2UP_*.L5X`. Citations keep the name used on the date they were written.

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)
>
> **PNP MOTION GEOMETRY: see [motion-model-pnp.md](motion-model-pnp.md) — THE
> authority for the 2-axis pick-and-place motion model** (canonical points per
> axis, the speed model, corner blends, and the generalization). This file is
> the authority on rung shapes, staging, the MCD speed-change mechanism, and
> the template laws.
>
> **AUTHORITY ORDER (Dan, 2026-08-25 — "servo motion is so important, make
> sure the guidelines are CORRECT"):** (1) Jason's corrected file
> (`generated/Test_Project_v2/ServoPNP__jarvis_v1.3.0__2026-08-24_v6_SHIP__corrected_by_Jason.L5X`
> — the freshest CE authority, and the source of the MCD architecture below);
> (2) his questionnaire answers (plc-reference/training-material/); (3) the
> V4.2 standard templates and the SDC Chassis Template; (4) Dan's geometry
> rulings (corner blends, canonical points — these stand, they are compatible
> with MCD); (5) the derived template inventory. Where an older statement in
> this file's history conflicted with a newer authority, the newer one won —
> see SUPERSESSION NOTES at the bottom.

Distilled from the V4.2 standard templates (S05_ServoPNP two-axis PNP,
S00_IndexerSP / S00_IndexerNoSP dial indexers, the shot pin axis), the SDC
Chassis Template's cam/dial pair, Jason Perry's CE reviews (v5 review
2026-08-24, corrected file 2026-08-25), and Dan's geometry rulings. Rungs
quoted below are the concept made concrete — the concept generalizes to
stations no template covers, because SDC uses "similar concepts and standards"
across ALL servo use, not just PNPs.

## The core architecture: stage, command, speed-change, quickstop

Every SDC servo axis in a station routine is driven by the same four-rung
motion spine, and everything else hangs off it:

1. **Staging rung ("Auto Mode")** — parallel MOVE branches that, keyed on
   which `Status.State[n]` is active, load `{Axis}MotionParameters`
   (.Position, .Speed, .Accel, .Decel, .MoveType) from the HMI parameter
   arrays (`HMI_{Axis}.Parameters.Positions[i]`, `.AutoSpeed[i]`, `.Accel[i]`,
   `.Decel[i]`). The staging rung is where the PROGRAM decides *which* HMI
   slot applies to *which* state; the VALUES in the slots always belong to the
   operator/CE in the HMI. That split is the whole point: sequence logic in
   the program, tuning in the HMI.
2. **Command rung ("Axis Motion Command")** — one MAM per axis, gated by the
   OR of every state in which this axis STARTS a move, plus
   `ServoActionStatus`, `AxisHomedStatus`, and the axis permissive. The MAM
   consumes whatever the staging rung loaded, and it is commanded **once per
   physical stroke, to the stroke's FINAL target** — never per speed segment.
   One MAM instance serves all auto moves; manual mode shares it through
   `{Axis}ManMoveTrig`.
3. **Speed-change rung ("Use MCD For Speed Changes")** — for a multi-speed
   axis only: an MCD that retunes the IN-FLIGHT move's speed/accel/decel at
   the transition points, without stopping. See the next section — this is
   the current SDC standard for fast/slow strokes (Jason's correction,
   2026-08-25).
4. **Quickstop rung** — if the permissive or SafetyOK drops while the axis is
   in motion, `MAS` (stop all) at max decel. An axis must never keep moving
   into a condition that is no longer safe.

Why one MAM and a staging rung instead of a MAM per move: the state bits are
exclusive, so the staging rung is a clean truth table of the axis's whole
role in the sequence, and the CE can read "what does Z do and when" from two
rungs. When you add a move, you add a branch to each rung — you don't add
instructions.

## One MAM per STROKE; MCD changes speed on the fly
*(Jason's correction of build b_mt7qbdtl_7i0izo, 2026-08-25 — the current
standard; supersedes the older two-staged-segments teaching)*

A **stroke** is one continuous physical motion to one final target (Z from
Retract down to Pick; Z from Pick up to Retract). A stroke that changes speed
along the way — fast through free air, slow for the precision approach — is
still **ONE MAM, commanded at stroke start, targeted at the FINAL position**.
The speed change at the transition point is done with **MCD (Motion Change
Dynamics)** while the move is in flight. Re-triggering MAM per segment is the
superseded pattern: it decelerates to zero at the transition point, costs
cycle time, and jerks the mechanism.

Jason's exact MCD rung (corrected file, R05_ZAxisServo rung 16, comment
"Use MCD For Speed Changes"):

    [[XIC(Status.State[13]) ,XIC(Status.State[37]) ] [MOVE(HMI_ZAxis.Parameters.AutoSpeed[1],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[1],ZAxisMCDAccel) ,MOVE(HMI_ZAxis.Parameters.Decel[1],ZAxisMCDDecel) ] ,[XIC(Status.State[25]) ,XIC(Status.State[49]) ] [MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMCDAccel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMCDDecel) ] ]MCD(iq_ZAxis,ZAxis_MCD,Move,Yes,ZAxisMCDSpeed,Yes,ZAxisMCDAccel,Yes,ZAxisMCDDecel,No,0,No,0,Units per sec,Units per sec2,Units per sec2,Units per sec3);

Read it: the speed-change states (13/37 = slow down into Pick/Place;
25/49 = speed back up toward Retract) stage the new profile and edge-fire the
MCD; the MAM commanded back at stroke start keeps running to its target with
the new dynamics. The mechanics that matter:

- **The MCD gets its own MOTION_INSTRUCTION control tag** (`ZAxis_MCD`) and
  its **own staging tags** (`ZAxisMCDSpeed`/`ZAxisMCDAccel`/`ZAxisMCDDecel`),
  separate from `{Axis}MotionParameters`, so the in-progress move's dynamics
  are changed without disturbing the original move command. (Known open
  question: the corrected rung stages Speed into `ZAxisMotionParameters.Speed`
  while the MCD reads `ZAxisMCDSpeed` — filed to the leads as
  `q_mcd_speed_staging`; until answered, stage speed into the MCD's own tag
  like accel/decel, and note the divergence from the corrected file.)
- **MCD is edge-fired by state entry** exactly like MAM — each speed-change
  state gives it a fresh false→true edge. On a CONTINUOUS motion (a jog) there
  is no state edge to use, so the chassis template guards it with a value
  compare instead — `NE(newSpeed, previousSpeed)` around the MCD, then latch
  the new value (Chassis R06 rung 14, `MCD(...,Jog,...)`). On a two-speed
  chassis that compare is fed by an HMI standard/fast toggle
  (`ChassisControl.Run.Vel` vs `ChassisControlFast.Vel`) and the SAME toggle
  is published as `StandardSpeed_Active`/`FastSpeed_Active` so Production can
  pick the matching OEE ideal cycle time (seen in ShowRoomChassis.L5X:
  Chassis R06 rungs 12/14/15/16) — a machine speed MODE is a machine-wide
  fact, not a servo-local one. MCD is therefore not a PNP-only instruction and
  not Move-only: it is *the* way SDC changes dynamics of anything in motion.
- **A down-stroke starts FAST and MCDs to slow at the transition point; an
  up-stroke starts SLOW (leaving the nest) and MCDs to fast at the transition
  point.** The staging rung stages the STARTING profile for the stroke's
  move state; the MCD rung stages the profile switch for the speed-change
  state. In the corrected file: Z move states 7/31 (down) start on
  AutoSpeed[0] Fast, 19/43 (up) start on AutoSpeed[1] Slow.
- **The transition point is detected mid-flight** via its own RangeCheck's
  `.InPosWide` — see "InPosWide vs InPos" below. Arrival is never confirmed
  at a transition point; the axis does not stop there.
- **When MCD is used vs separate moves:** MCD for a speed change WITHIN one
  stroke (same final target). Separate MAMs (separate move states) only when
  the TARGET itself changes — a genuinely different move. Jason's file
  answers this for the PNP; treat it as the general rule for any axis until
  the leads say otherwise (filed as `q_mcd_universality`).

## State granularity under MCD — what deserves a state

The corrected file settles what a fast/slow stroke looks like in R02. One Z
down-stroke (Retract → Pick) is THREE states:

| State | Name (Jason's comments) | What happens | Exit condition |
|---|---|---|---|
| 7 | "Move Z Axis To Pick Position" | MAM edge-fires (fast, target Pick) | `ZAxis_MAM.IP` — the move is underway |
| 10 | "Wait for ZAxis at pick transition" | nothing commanded — watching | `ZAxisPickTransition.InPosWide` — passing the point, still moving |
| 13 | "ZAxis slow down to pick" | MCD edge-fires (slow profile) | `ZAxis_MAM.PC` + `ZAxisPick.InPos` — strict arrival |

The up-stroke mirrors it (19 move slow → 22 wait → 25 MCD fast, exiting on
strict Retract arrival OR the corner-blend wideband). So:

- **Exactly ONE state per stroke commands the MAM** (it is the only state in
  the axis's MAM list for that stroke).
- **The wait state and the speed-change state are real states** — they cost
  nothing at runtime, keep the motion readable in R02, and give the MCD its
  edge. They are NOT in the MAM state list.
- **A speed-change state is not a "move"** — one-move-per-state means one
  MAM-commanding state per stroke; MCD states change dynamics, not targets.
- Synthesized wait/MCD states are renumbered INLINE on the +3 grid
  (coordination.md) — the flow reads 7 → 10 → 13, never 7 → 52 → 13.

The old shape — fast segment state (MAM to transition point) → wait →
slow segment state (second MAM to final) — is SUPERSEDED for speed changes.
The trigger/wait split itself survives, but only for genuinely separate
moves (below).

## Re-commanding: genuinely separate back-to-back moves on one axis

MAM executes only on its rung going false→true, and the state engine swaps
`Status.State[n]` bits atomically — there is NO scan where no state bit is
set. So if two CONSECUTIVE states both sit in one axis's MAM state list, the
rung never goes false between them and the second move NEVER EXECUTES — the
axis stalls at the first target until the fault timer trips. Per-state ONS
latches "solving" this are the invented-shape defect Jason rejected.

The template family's shape for genuinely separate moves — different targets,
e.g. the indexer's consecutive index strokes — is the **trigger-state /
wait-state split**: command the move in one state, confirm it in a following
state that is NOT in the axis's MAM list (the dial's MAM list contains only
state 13 "Trigger Index"; completion is detected in state 16 "Wait For Index
Complete"; re-entering 13 gives the next edge for free).

Scope note: this split is for SEPARATE MOVES ONLY. A speed change within one
stroke is NOT two moves — it is one MAM plus an MCD (previous section). Do
not compile a fast/slow stroke into two MAM segments.

## Speed profiles: why more than one speed exists

`AutoSpeed`, `Accel`, `Decel` are ARRAYS (dimension 5) in the ServoOverall
UDT. That's deliberate: real moves are not one speed. The universal pattern
is **fast travel / slow approach** — run fast through free air, slow down
before contacting or approaching anything that matters (a part, a nest, a
tool). The ME expresses this as a **transition point**: "fast to the
transition point, slow into pick; slow up out of pick to the transition
point, then fast." Pick and place each get their own transition point and
they are independent. In the code, the profile change is the MCD rung; the
index mapping is whatever the station declares (document it in the staging
rung's comment); a station with no profiles runs everything on index 0.

A single-speed axis is not a defect — an indexer dial, or the PNP's own X
traverse (which stops over a nest while Z is safely up, decelerating
naturally on its accel/decel settings), legitimately runs one profile
(`AutoSpeed[0]`) for every move, and needs no MCD rung at all. The question
to ask per axis: does any of its strokes end at something it could hit or
seat into? If yes, that stroke has a transition point, two profiles, and the
MCD rung. If the ME described fast/slow or transition points, the generated
logic MUST implement them — describing speeds and then running AutoSpeed[0]
everywhere is the exact defect Jason red-flagged.

## The staging rung: branch semantics and the two sanctioned shapes

The Auto Mode staging rung is not a case statement — it is a list of parallel
branches evaluated left to right in ONE scan, and every branch whose
conditions are true executes. When two branches write the same
`MotionParameters` member in the same scan, the LAST true branch wins.
What must NEVER exist is an unconditioned branch after a conditioned one
writing the same member — it silently defeats the override every scan (that
exact defect shipped in v3: the Z fast-profile branch sat unconditioned after
the state-keyed slow branch, so the axis ran fast into pick and place). When
you add a conditioned branch, ask of every branch below it: does anything
after me write the same member unconditionally? If yes, the rung is wrong
regardless of how right each branch looks alone.

Two shapes are on the table, both CE-evidenced:

- **Template shape (single-profile axis):** unconditioned defaults FIRST
  (`MOVE(0,MoveType)`, `AutoSpeed[0]`, `Accel[0]`, `Decel[0]`), then the
  state-keyed position branches — "this is what the axis does unless a state
  says otherwise." All four V4.2 templates and the corrected file's X rung 14
  use it. For an axis with one profile, this IS the rung, byte for byte
  (Jason's v5 item 9: diff the generated staging rung against the template's
  and treat any difference that is not a declared extension as an error).
- **Grouped-by-move shape (multi-profile axis, Jason's corrected file, Z
  rung 14):** `MOVE(0,MoveType)` unconditioned, then the fast-stroke states
  stage the fast set as one grouped branch, the slow-stroke states stage the
  slow set as another, then the per-state position selects — parameters
  grouped by which physical move they belong to, no default-then-override.
  Whether this generalizes beyond this station is with the leads
  (`q_mt8q11jc`); until answered, follow the corrected file for multi-profile
  axes and the template for single-profile axes.

Either way: position AND speed staging live in this ONE rung (plus the MCD
rung's own staging for mid-stroke changes) — never spread across separate
per-state "speed profile" rungs. On a rotary axis the same rung also stages
`MoveType` per branch (`RotaryPositive` / `RotaryNegative` / `RotaryShortest`)
— direction is part of the move definition, not a separate mechanism.

## Per-position RangeCheck instancing: a position is a fact, not a target

EVERY named position gets its own `AOI_RangeCheck` instance in the Axis
Position Monitor rung, always windowed on its own HMI slot
`HMI_{Axis}.Parameters.Positions[i]` — never on
`{Axis}MotionParameters.Position`. The corrected file's Z monitor rung has
SEVEN instances: `ZAxisPick`/`ZAxisPlace`/`ZAxisRetract` (the targets),
`ZAxisPickTransition`/`ZAxisPlaceTransition` (the speed-change points, wide
band at the standard default), and `ZAxisPickRetractBlend`/
`ZAxisPlaceRetractBlend` — one instance PER CORNER, anchored on the SHARED
Retract slot, each with its wide band equal to that corner's blend distance.

Why per-position instances instead of one generic "at target" check: each
instance is a continuously true/false FACT about where the axis physically
is, independent of what the sequence happens to be doing. Those facts are
consumed everywhere, not just in the transition that follows a move —
`Initialized` reads them, permissives read them, init and resume read them
with no move in flight at all. A single RangeCheck against
`MotionParameters.Position` is a moving-target window: it answers "am I near
whatever was staged last," which is residue, not intent. R02 transitions must
name the position instance they confirm (`XIC(ZAxisPick.InPos)`) so the rung
reads as the engineering statement it is: "Z is at Pick."

A COMPUTED position is still a position: the chassis template instances a
RangeCheck on each of its four derived cam angles (`DialStartIndexMinusOne`,
`DialEndIndexPlusOne`, `DialUnlockPos`, `SetupCamStartupPosDeg`) with the same
tight 0.2 / wide 5.0 pair. Where a window WRAPS 360°, though, RangeCheck can't
express it and SDC uses a reversed-limit `LIMIT(high, actual, low)` compare
instead (`CamInDialDwell`) — a rotary idiom worth recognising on sight.

## InPosWide vs InPos — mid-flight facts vs arrival facts

`AOI_RangeCheck({Pos}, Positions[i], tight, ActualPosition, wide)` produces
TWO bits, and they answer two different questions:

- **`.InPos` (tight band, e.g. ±0.5)** answers "has the axis ARRIVED here."
  It is only meaningful paired with `{Axis}_MAM.PC` — the strict-arrival
  condition `MAM.PC + {Pos}.InPos` confirms a move actually completed at its
  final target. Every consequence-bearing action (grip, release, process op,
  cycle-complete) sits behind strict arrival.
- **`.InPosWide` (wide band)** answers "is the axis PASSING THROUGH here,
  possibly still moving." Its two standard uses:
  1. **Transition-point detection** — the speed-change state is entered on
     `{Pos}Transition.InPosWide` while `MAM.IP` is still true; the axis never
     stops there. The wide value is the standard RangeCheck default — it is
     internal plumbing, NEVER an ME-facing row (Dan's "speed windows are
     dead" ruling stands: the ME sees 7 canonical Z rows and nothing else).
  2. **Corner-blend early advance** — `[{Axis}_MAM.PC XIC({Pos}.InPos) ,
     {Axis}_MAM.IP XIC({Corner}Blend.InPosWide)]`: advance when strictly
     arrived, OR while still moving but already inside the blend band. Here
     the wide value IS the ME's blend distance (motion-model-pnp.md).

**CONFLICT — needs Dan/leads ruling: the standard `AOI_RangeCheck`'s wide band
is ASYMMETRIC.** Its logic (seen in ChassisStandard.L5X and confirmed in
ShowRoomChassis.L5X: AOI_RangeCheck rungs 2–3) is `MaxWide = Value +
DeadbandWide` but `MinWide = Value − Deadband` — the LOW side of the "wide"
window uses the TIGHT deadband. So `.InPosWide` only widens on approach from
BELOW the target (rising position); an axis approaching from above sees
nothing but the tight band. Every blend and transition band we author assumes
a symmetric window, so on decreasing-position strokes (a Z whose Retract is
numerically below Pick, a reverse index) the early-advance simply won't fire
early and the corner silently stops dead. Until ruled on: check the DIRECTION
of every stroke whose band matters, and if it approaches from above, either
place the anchor value below the point of interest or flag the axis for a
leads decision — do not assume the wide band is centred. Never blend into a
state whose action requires the position to be truly reached: releasing a part
5 mm above the nest is a defect, not smoothness. Waits, grips, releases, and
process operations take strict arrival; travel-to-travel corners take the
wideband OR.

## Transition-condition minimalism — test only what is new
*(Jason's correction, 2026-08-25)*

A state transition rung tests only what is NEW since the previous state.
Conditions already proven by entry into the predecessor (initialized, gripper
state, axis in position, cycle running) are redundant and make the sequence
brittle — factor shared terms into common branches instead of repeating them
in each path. Corrected-file evidence: the wait→MCD transition is just
`XIC(Status.State[10]) XIC(ZAxisPickTransition.InPosWide) XIC(SS_OK)` —
nothing the flow already guarantees.

## Cross-axis verification: at the consequence, not every corner
*(Jason's correction, 2026-08-25)*

Verify the coordinated position of ALL axes at the state where the
consequence occurs — just before gripper release: `XAxis_MAM.PC +
XAxisPlace.InPos + ZAxis_MAM.PC + ZAxisPlace.InPos`; at cycle complete:
strict arrival at the full rest posture. Do NOT stack cross-axis interlocks
on every intermediate blend state — premature interlocks stall blended
motion. Blend states carry only their own axis's condition; the critical
point carries everybody's.

## Permissives when axes legitimately move together

The template comment on every permissive rung is the concept: "Permissive
should be based on the physical state of itself potentially interfering
devices." A permissive is a statement about GEOMETRY — what must be
physically true for this axis to move without hitting something — and each
template derives it from its own geometry: S05's X permissive is "Z homed
and parked in the Retract band"; the indexer dial's is `ActuatorsSafe`; the
shot pin's is "dial on-station and not moving"; the chassis cam's is simply
"dial axis homed" (the cam cannot move meaningfully unless its slave has a
reference). None of these is "the" permissive shape — the physics is.

The permissive is not a soft gate: the quickstop rung fires `MAS` at max
decel the instant the permissive drops mid-motion. So a permissive that is
too narrow doesn't just block a move — it ABORTS it mid-stroke. A sequence
that legitimately moves two axes in the same state cannot keep the
parked-band form: for simultaneous motion the permissive must express the
REAL clearance for that sequence.

**THE X-TRAVERSE PERMISSIVE PATTERN (Jason Perry ruling, 2026-08-25, Teams —
supersedes the parked-band/blend-bit branch forms AND his own corrected
file's place-arrival LE branch):** the horizontal traverse's permissive is

    XIC(iq_ZAxis.AxisHomedStatus) LE(HMI_ZAxis.Status.ActualPosition, ZAxisSafePosition) OTE(XAxisPermissive)

— **Z Axis homed AND Z actual position at/above a safe position set at
startup.** One ordered compare against a single startup-set safe-height tag,
not an OR of per-window RangeCheck bits. Why it's better: the permissive is a
continuous statement about the ONE thing that matters (is Z clear of the
interference zone), it cannot develop gaps between enumerated windows, and
every sanctioned overlap (both corner blends, the place-side descent start)
is inside it by construction. The safe value is machine geometry: seed it at
first scan (S:FS) from Retract plus the larger corner blend, adjustable in
Studio. Mind the polarity — on an axis where Z increases downward, "at/above
safe" is `LE`; on the opposite polarity it is `GE`. The quickstop-reason
logic in R20 must be the exact complement of the same compare. When a
state's motion set changes, re-derive every permissive that mentions the
axes involved; carried-over geometry quickstops good moves.

## Blending ("rounding the corner"): why and how

SDC rounds corners for cycle time and smoothness: the next axis's motion
starts before the current move fully finishes, so two axes carve an arc
instead of a dead stop at the corner. Geometry (symmetric corner model,
per-corner ME-owned blend distances, size limits) is in motion-model-pnp.md.
Mechanically it is PURELY a transition-condition choice — the wideband OR
shown above — plus the per-corner RangeCheck instances carrying the blend
distances as their wide bands. Nothing about the first move is altered, and
blending is NEVER expressed by stacking moves in one state, by "after
complete" chains, by corner-delay timers, or by sub-step counters.

Blend-start thresholds (Dan, 2026-08-20): blended moves never start
simultaneously — the second axis begins only once the first passes a defined
clearance threshold, and that blend-start point is NOT automatically the
speed-transition point. They are distinct named values: the transition point
is where the profile changes (MCD); the blend band is where the next axis may
start. When the ME hasn't given a blend value, ask (it is genuinely
unknowable mechanical intent) or flag *Verify for CE — never assume
peak-transition = safe-clear. Judgment on when to blend: only where early
motion of the next axis is geometrically safe; Jason's questionnaire answer
(#5/#14): where geometry allows blending, implement it — early-advance is
bounded only by possible collisions.

## STRUCTURAL FIDELITY — think freely about the logic, speak SDC in the rungs

Two altitudes (Dan, Aug 2026). LOGIC altitude — what states exist, what
conditions govern transitions, how recovery and retries work — is where your
reasoning is the product: think freely. EXPRESSION altitude — how that logic
is written into rungs — speaks the family's existing vocabulary. Lookup
hierarchy at the expression altitude: (1) Jason's corrected file and the
template family — if either shows the construct, use ITS shape, period;
(2) constructs seen in real SDC code fill gaps; (3) only when neither shows
it, build it in SDC's idiom and flag it "PROPOSED NON-STANDARD PATTERN: …"
for CE review — never ship an invented shape silently as if it were standard.

Shapes that never change:
- **One MAM per axis**, in the one "Axis Motion Command" rung:
  `XIC(SafetyOK)[XIC(Status.State[1]) XIC({Axis}ManMoveTrig) ,XIO(Status.State[1]) [state list] ]XIC(iq_{Axis}.ServoActionStatus)XIC(iq_{Axis}.AxisHomedStatus)XIC({Axis}Permissive)MAM(...)`.
  The auto branch is a plain OR list of the states in which the axis STARTS
  a stroke — never a latch bit, never per-state ONS trigger rungs, never
  OTL/OTU "AutoMoveTrig" machinery, never StateChanged one-scan droppers.
  (A mechanism axis may carry a SECOND, purpose-named MAM instance for a
  different job — the chassis cam has `CamAxisResync_MAM` for resync moves and
  `CamAxisCS_MAM` for the controlled stop. Separate JOB, separate control tag,
  each still one rung with its own state list.)
- **One MCD rung per multi-speed axis**, in Jason's exact shape above, with
  its own control tag and staging tags. No MCD rung on single-profile axes.
- **One Auto Mode staging rung per axis** (two sanctioned internal shapes —
  see the staging section).
- **Every named position gets its own `AOI_RangeCheck` instance** — targets,
  transition points, and one per blend corner. In-position tests are the
  RangeCheck `.InPos`/`.InPosWide` bits; ad-hoc `SUB`/`LT` position-error
  math is not a template shape.
- **R02 rung order**: sequence-state rungs in ASCENDING state-number order,
  then the override block in template order: lockout 99, init 100→124,
  restart logic, fault 127, manual 1, safety stop 0, the State_Engine call,
  cycle timer. Overrides come last because the LAST write to
  Control.StateReg wins the scan.

## Comment style
*(Jason's correction, 2026-08-25)*

Rung comments name the PHYSICAL action or destination the state performs —
"Move Z Axis To Retract Position", "ZAxis slow down to pick", "Use MCD For
Speed Changes" — never segment mechanics or justifications of implementation
choices. Commentary that explains why a state was omitted from a list goes
stale the moment the design changes. State comments are GENERATED from the
diagram's state map, never inherited from a template project.

## Horizontal PNP axes have NO home — pick and place only
*(Jason Perry review of v5, items 8/10; Dan: the controls answer wins)*

A standard PNP's horizontal traverse has exactly TWO named positions: pick
and place. There is no Home. Initialization leaves it AT PICK (empty) or at
the place side (carrying) — init's exit posture IS the cycle's start posture.
Consequences, one concept not four fixes: no `Home` Positions[] slot, no
`XAxisHome` RangeCheck, no home staging branch; no "move X to home" state at
cycle end (place→pick IS the return move); no "move X to pick" state at cycle
start (the axis is already there); no alarm may reference an X home. Rest
postures: X at pick (or place-side when carrying), Z at Retract, grippers at
Disengaged. Don't confuse this with HOMING (position reference): the axis
still has `AxisHomedStatus`, torque-home machinery, and the loss-of-reference
alarm — "no home position" means no named PARK target, not no reference.

## Homing and recovery philosophy

- Homing is operator-driven in Manual (state 1): request → confirm →
  `MAH` (machine home) or `AOI_TorqueHome` (torque-to-hardstop homing for
  axes without home switches — HomeSelect 1, the PNP's standard; MAH for
  axes with no hard stop, e.g. the indexing dial — Jason #19/#21). The
  request/confirm pair is a real two-step interlock (request latches and arms
  a confirm timer; only `HomeConfirm` fires the MAH) because homing moves an
  axis with no reference. `AxisHomedStatus` then gates every auto MAM — an
  unhomed axis never auto-moves. Homing lives in R04/R05 rungs 9–11 and is
  DISTINCT from initialization (states 100–124).
- Init/recovery (states 100–127) always sequences the vulnerable axis to
  safety FIRST — for a PNP: Z up to retract before any horizontal motion —
  then branches on what the machine is holding (part held → toward place;
  empty → toward pick). Recovery is the same sequence every time regardless
  of cause.
- `GSV MaximumSpeed` at first scan derives max accel/decel per axis
  (velocity/0.85 over the axis's characteristic time); the quickstop MAS
  uses those maxima, not the tuned profile values.

## Rotary / index axes, and camming a dial to a cam axis (MAPC)
*(seen in ChassisStandard.L5X: Chassis R02_PositionCalcs, R04, R06_CamServo,
R07_DialServo — the SDC chassis template's own cam/dial pair)*

The same concepts wear rotary units: positions are DEGREES, index increment
= 360° / fixture count; the dial is a single-profile axis whose consecutive
index strokes use the trigger/wait split. MAG gearing = slave follows a master
position (tracking parts down a conveyor); ratios are FIXED, computed from
mechanics, never tuned empirically. MAR is not standard. SDC has existing
servo dial indexer logic — copy it and update to current standards rather
than writing new.

On a chassis, the dial does not index on command at all — it **follows a
cam**, and that changes the whole recovery story:

- **The profile is BUILT AT RUNTIME and it encodes the timing diagram.**
  `MCCP` compiles a 4-point CAM array into `CamProfile`, then `MAPC` slaves
  the dial to the cam (Continuous, master = cam ActualPosition,
  Bi-Directional): [0] master 0 / slave 0, [1] master = `SetupDialIndexStart`
  / slave 0 / SegmentType 1 (cubic), [2] master = `SetupDialIndexEnd` /
  slave = `NestSpacing` (= 360 / NestQty), [3] master 360 / slave NestSpacing.
  The DWELL is the flat linear segments either side; the INDEX is the single
  cubic segment between the two setup angles. The whole machine's timing is
  therefore two numbers plus nest count — change nest quantity and the profile
  regenerates.
- **Camming may only be ENGAGED from a lawful posture, and that is why resync
  exists.** MAPC positions the slave RELATIVE to where it is, so engaging with
  the dial off-nest or the cam inside the index window leaves the dial
  permanently off-station. Hence `ChassisStatus.ResyncRequired` (state 7 sees
  not-on-station or not-in-dwell) and the resync excursion, which IS this
  machine's init: 10/13 move the CAM (MoveType `RotaryNegative` or
  `RotaryPositive`, chosen by which side of a forward/reverse boundary set 10%
  into the index window the cam sits — nearest direction, fewest degrees
  through the danger zone) to `DialUnlockPos`, the midpoint of the index window
  where the shot pin has released the dial; 16 moves the DIAL
  (`RotaryShortest`) to the nearest nest, with `TRUNC(DialPosNests)` + a
  0.1-nest bias deciding whether "nearest" is this nest or the next; 19/22 walk
  the cam back OUT of the index window to index-start − 1° or index-end + 1°;
  25 then MCCPs and MAPCs. Two states per direction, not one state with a
  computed sign, because the MoveType differs — direction is part of the move.
- **Position facts are wrap-aware compares, and on-station is a MOD.**
  `DialOnStation` = `MOD(DialPosNests, 1.0)` inside a tolerance that was itself
  converted from degrees to nests — the same fractional-remainder idiom as the
  V4.2 indexer. `CamInDialDwell` is a reversed-limit LIMIT (see the RangeCheck
  section). Both feed a standing "Cam & Dial NOT In Sync" fault that fires if
  the pair ever drifts while running.
- **Stop taxonomy is per-state, and it is three different stops.** Immediate
  stop and fault (37/73/76) MAS at `ChassisControl.FastStopDec`; a manual-jog
  stop (55) MAS at the jog decel; a CONTROLLED stop (40) is not a MAS at all —
  it is a MAM to `SetupCamStartupPosDeg` so the machine parks at a known cam
  angle with every actuator in a known posture, then 43 paused. Choose by what
  the mechanism must be true afterwards, not by urgency alone. A park-angle
  stop also has an ENTRY window: the state-40 rung wraps a compare that
  refuses the transition while the cam already sits in the short approach
  window just before the park angle (`SetupStartupStopChkSub` degrees wide),
  because a MAM to a target you are already braking into either overshoots or
  stops the mechanism mid-window — the chassis simply runs one more revolution,
  and `ChassisStatus.MovingStartStopPos` tells the operator that is what is
  happening (seen in ShowRoomChassis.L5X: Chassis R04 rung 14, with a 30 s
  "waiting for controlled stop" window to cover the extra revolution).
- **Brake and hand crank**: the cam axis's holding brake is driven by
  `SSV(Axis, iq_CamAxis, MechanicalBrakeControl, …)` — releasing it is a
  deliberate sequence (58 MSF → 61 release → 64 ready to hand crank → 67
  re-engage → 70 MSO), each step with its own 1000 ms timeout alarm, plus a
  fault if the crank is inserted while running. Never drive a brake from a
  bare output bit when the axis object owns it.
- **Every one of those states carries a "Waiting For …" timeout alarm** staged
  by MOVEing into `Control.FaultTime` inside the state's own rung (1000 ms for
  enables/brakes, 2000 for a jog stop, 10000 for resync moves, and as long as
  the park approach needs for the controlled stop) — the fault window is a
  property of the STEP, written where the step is.

## What varies per application vs. what never varies

Never varies: the stage/command/MCD/quickstop spine; one MAM per stroke with
MCD for in-stroke speed changes; HMI ownership of all position/speed values;
homed+permissive gating on every auto move; strict arrival for consequence
actions; per-position RangeCheck instancing; state-keyed staging branches.

Varies per application (decide from the geometry and the ME's words): how
many speed profiles per axis and where the transition points are; which
corners blend and the blend distances; which axis is the "safety-first"
recovery axis; whether an axis needs a permissive derived from another
axis's position; whether homing is MAH or torque-home; linear mm vs rotary
degrees; whether the axis is commanded (MAM) or cammed (MAPC). Dan
(2026-08-25): "we use a ton of servos with similar concepts everywhere" — the
PNP is the worked example, not the boundary.

## The hardware the code rides on
*(SDC_Motors_Cables_Drives_Guidelines Rev2; EE Debug and Testing Process;
TN-02172026-Job1125)*

Standard SDC axes are Rockwell: **TLP motors + Kinetix 5300** for standard
PNPs, ball-screw/belt axes, simple rotary, and the indexing-ring shot pin;
**VPL motors + Kinetix 5500** for camming/gearing, chassis CAM & dial axes,
indexing-ring main drives, servo presses, and high-speed coordinated motion
(5500 also gives CIP Safety / software STO, which is what the chassis
template's SafetyProgram writes to). High-flex cable wherever the motor moves
continuously; single hybrid cable on 5500, separate power+feedback on 5300;
Motion Analyzer for sizing with load:motor inertia ≤ 10:1; CIP-Motion
CompactLogix to 16 axes, ControlLogix beyond. Minimize drive-type variation on
a machine. Codegen-relevant consequences:

- **Multiturn absolute encoders are the standard** — axes normally keep
  position through a power cycle, which is why the homing story is
  "confirm/rehome on loss of reference" rather than "home every start". The
  TLP caveat: battery-backed encoder — a dead battery + power cycle loses
  position, so the Loss-Of-Absolute-Position-Reference alarm is a real event,
  not paranoia (and it is gated on the drive's EIP ComOK so a comms drop
  doesn't impersonate it).
- **Holding brake is required for vertical loads** — EXCEPT the standard SDC
  PNP vertical axis, which runs brakeless in standard applications.
- **Torque limits are a commissioning instrument**: monitoring/limiting is
  standard in the servo datatype (`TorqueLimitPositive/Negative` set from HMI
  parameters on demand); start at 50% of max, investigate torque faults during
  debug rather than just raising it, and set the production limit ~20% over the
  max actually observed in full auto. Debug also runs two named speed
  profiles — a slow speed for dry-run and the running speed — easy to toggle so
  a tech can re-verify a sequence at slow speed without retyping parameters.
- Manual/inch moves load the same accel/decel and must be edge-triggered (one
  move per button press); quick-stop on permissive/safety loss and
  `AOI_RangeCheck`'s wideband deadband are template-standard, never asks for
  the ME.
- Replication caution: don't copy manually-entered Commutation
  Alignment/Offset values from an older Studio 5000 project — a newer version
  may have a native motor profile, and stale manual values give
  `FLT S04 commutation not configured`. Delete and re-add the drive under the
  same name so it auto-detects.

## Non-Rockwell motion platforms (reference, not SDC standard)

When a job specifies hardware that is not a Logix motion axis, the MAM/
RangeCheck standard does not apply directly — it is a different command
architecture, not a deviation from ours. Recognise these and treat them as
vendor plumbing:

- **Parker IPA drives** (`EthernetIP_IPA_B.pdf`, `Change Log Ver5.txt`): a
  generic CIP adapter driven by Parker AOIs, not MAM. `IPA_AxisManager` must
  run every scan or nothing works. Move FBs are **non-blocking** — a new move
  request supersedes one in progress, so sequence on the axis's own
  moving/in-position status, never on rung order. `KAMR` is a latched
  kill-all-motion needing explicit `IPA_FaultReset` (some faults need a power
  cycle). Homing is mode-coded (0–30); switching to/from EOT modes
  (16,17,19,22,27,30) requires an ACR-View re-download. Hard-stop homing =
  lower torque limit, raise position-error limit above max travel, command
  past the stop, watch position stop changing, `IPA_MoveStop`. `PROG2`/`PROG3`
  are custom-program escape hatches triggered by `IPA_Run_Prog2/3`. AOI and IPA
  project versions must match. Commissioning gotcha: the PLC writes 0 to the
  JOG register cyclically, so ACR-View jogging needs the connection dropped or
  the PLC halted.
- **ACR motion controllers over EtherNet/IP** (`EIP_parameters.pdf`): Class 1
  mapping can live on the ACR side — `P37434` = group count (≤16), then a fixed
  4-parameter block per group starting `P37440` (start param, count ≤8,
  direction 0=ACR→PLC/1=PLC→ACR, type 1=DINT/2=REAL), ≤100 parameters total,
  committed BEFORE the PLC opens the Class 1 connection.
- **SICK AFS60/AFM60 absolute encoders** (`AFX60_AOI_*.pdf`, vendor ladder
  routine): cyclic I/O carries position; PARAMETERS (preset, position/velocity
  limits, diagnostics) go through the vendor `SICK_AFX60` AOI over acyclic CIP
  Generic — two MSG instances (Get/Set Attribute Single, Class 1/Inst 1/Attr 1),
  a Selection bitfield, rising-edge `bRead`/`bWrite`, poll
  `bReadDone`/`bWriteDone`, 5000 ms default timeout; multi-scan, so call it
  every scan. Alternatively SICK ships an importable ladder routine per encoder
  (unique Final Name and renamed tags per instance). Writing a PRESET is
  safety-relevant — treat it like a homing/position override.
- **Lenze i550 VFDs** (`i550_ActuatorSpeed` AOI): speed-only actuators, no
  position loop — enable/run/velocity/direction/quickstop and
  ready/enabled/warning/error/actual-velocity. Do NOT model them as
  `HMI_{name}` ServoOverall position axes. Network control needs P201:1=5,
  P400:1=1, P400:2=1, P400:37=1 set once (MSG at startup or EasyStarter).
  Explicit parameter writes must be SEQUENCED (`i550ExplicitMSGHandler`) —
  limited concurrent CIP connections. Stale EDS-to-AOI revision dates produce a
  "false data type" error that looks like a real fault.

## Answers from the controls leads (Jason Perry, 2026-08-20, questionnaires in plc-reference/training-material/)

- **Motion mode decision tree (#1–#3)**: MAM point-to-point = move A→B with a
  defined profile. Blending = rounding corners when two or more axes control
  one mechanism. MAG/MAPC/MAR — see the rotary/camming section above.
- **Axis-module boilerplate (#4)**: rungs 0, 1, 3–12, 16–20 NEVER change
  (only the axis name). The other rungs keep their shape but their
  manual/auto MOTION TRIGGERS are the application-dependent part.
- **Wideband sizing (#5, #14)**: worst-case clearance geometry plus margin;
  where geometry allows blending, implement it — no refused-corner class.
- **Manual accel/decel (#15)**: manual/jog reading Accel[0]/Decel[0] shared
  with auto is INTENTIONAL — do not give manual its own indices.
- **The servo move contract (CONTROLS #12, #15)**: R02 transitions confirm
  `{Axis}_MAM.PC` AND the RangeCheck `.InPos` bit — with a parallel branch
  for rounding moves. R03 contains NO servo control; R04/R05 own all motion
  instructions. A mixed servo+pneumatic state completes when BOTH the servo
  (.PC + InPos) and the pneumatic action are done.
- **Mandatory servo faults (CONTROLS #16)**: axis fault (message built by
  DTOS/CONCAT of `AxisFault` into a servo alarm array with its own handler),
  loss of absolute position reference, and waiting-to-reach-commanded-position
  timeouts.

## Learned from corrections
- (2026-08-20, from Dan's correction of build b_mt1p0xfg_gu145g — synthetic test correction) The [PC + InPos , IP + InPosWide] blended-branch pattern is a clearance permissive, not a universal transition template. Use it only for an axis that merely has to be out of the way (e.g., a vertical retract clearing an interference zone) so the next motion can overlap; the axis that actually establishes the working position for the next state must show a real .PC with the tight .InPos window before you transition.
- (2026-08-24, from Jason Perry's review of v5 — SDCServoPNP_JARVIS_v5, build b_mt3bnrp3_7yxhic) Horizontal PNP axes have NO home position — pick and place only; init leaves the axis at pick (empty) or place-side (carrying), so no Home Positions[] slot, no XAxisHome RangeCheck, no "move to home" state, and no alarm may reference an X home. Z rests at Retract; grippers at Disengaged.
- (2026-08-24, from Jason Perry's review of v5) Init's exit posture IS the sequence's start posture: with Initialized on and the gripper disengaged the PNP is already at the X pick position — a "move horizontal to pick" state at cycle start re-commands a held position and is a redundant state, not caution.
- (2026-08-24, from Jason Perry's review of v5) The R04/R05 Auto Mode staging rung is reproduced in the CE-evidenced format — for single-profile axes the template's exact rung 14; multi-profile axes follow the corrected file's grouped shape. Diff the generated staging rung against the authority before shipping.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) For a multi-speed profile on one axis (fast approach then slow final approach), don't re-trigger MAM for each segment. Issue one MAM to the target and use MCD to change speed/accel/decel on the fly at the blend point; this avoids decel-to-zero, cycle-time loss, and mechanical jerk.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) An MCD needs its own MOTION_INSTRUCTION control tag and its own speed/accel/decel staging tags, separate from the MAM parameter set, so the in-progress move's commanded parameters are changed without disturbing the original move command.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) Use a wide in-position window (.InPosWide) to detect that an axis has reached a blend/handoff point while still moving; reserve .PC with the tight .InPos window for confirming a move has actually completed at its final target.
- (2026-08-25, Jason Perry, Teams ruling on the v7 X-permissive question) THE X-traverse permissive is "Z Axis Homed AND Z Actual Position <= a safe position set at startup" — one ordered compare against a startup-set safe-height tag (ZAxisSafePosition, seeded at S:FS from Retract + the larger corner blend), replacing parked-band/blend-bit branch enumerations and the corrected file's own place-arrival LE branch. Mind axis polarity (LE where Z increases downward, GE otherwise); R20's quickstop reason is the exact complement of the same compare.
- (2026-08-25, Jason Perry, Teams — "your proposed fix will work") A transition-band wait exit MUST carry a parallel strict final-arrival branch — `[XIC({Pos}Transition.InPosWide) ,XIC({Axis}_MAM.PC) XIC({FinalPos}.InPos)]` — because a resume/recovery stroke can START beyond the band (Z aborted between Retract and the transition, then commanded to Retract) and a band-only exit then never fires: an unsatisfiable wait and a fault loop. Normal full strokes exit on the band first, so behavior is unchanged; only short resume strokes take the strict branch. Applies to every wait state whose exit condition is a mid-stroke band.
- (2026-08-25, from diagram review of ServoPNP) A PNP diagram whose Z strokes are flat single-speed moves with no PickTransition/PlaceTransition rows and no corner-blend edges violates the mandatory 2-axis PNP motion model at the DIAGRAM level — the transition/blend structure must be visible in the drawn states/edges, not first appear at codegen.
- (2026-08-31, from study of ChassisStandard.L5X) MCD is not Move-only and not PNP-only: a continuous jog's speed is changed live with `MCD(...,Jog,...)` guarded by a `NE(new,previous)` value compare instead of a state edge. And a mechanism axis may hold more than one MAM instance when the JOBS differ (resync move vs controlled stop) — one rung and one control tag per job.

## SUPERSESSION NOTES — what changed and when (history kept honest)

1. **Two-staged-segments speed changes (taught 2026-08-20/21) → SUPERSEDED
   2026-08-25 by MCD.** The old doctrine compiled a fast/slow stroke as two
   MAM segments (fast to the transition point as its own move state, then
   slow to the final target), using the trigger/wait split between them.
   Jason's corrected file replaced it: one MAM per stroke to the final
   target, MCD for the in-flight speed change. The trigger/wait split
   survives ONLY for genuinely separate moves (indexer).
2. **Strict arrival at transition points (Dan's "speed windows are dead"
   round, 2026-08-24) → mechanism superseded 2026-08-25.** The ME-facing
   half of that ruling STANDS (no window rows, no {Pos}TransitionWideBand
   values, 7 canonical Z rows). The code half — "arrival at a speed
   transition is strict MAM.PC + InPos, then the next staged segment fires"
   — described the two-segment world; under MCD the transition point is
   detected mid-flight via its RangeCheck `.InPosWide` (standard internal
   wide default) and the axis never stops there.
3. **"One servo move per state" (Dan, 2026-08-21) → reinterpreted under
   MCD.** The law's substance stands: one MAM-commanding state per stroke,
   never two moves in a state, blending only in transition conditions. What
   changed: a speed change is no longer a second "move", so a fast/slow
   stroke is one move state plus synthesized wait/MCD states — not two move
   states.
4. **Staging defaults-first as the only shape (v3 review, v5 item 9) →
   narrowed 2026-08-25.** Defaults-first remains the template law for
   single-profile axes; Jason's corrected file staged the multi-profile Z
   axis grouped-by-move with no speed defaults. Generality is with the leads
   (`q_mt8q11jc`).
5. **Blend size "under half the smallest gap" (early geometry note) →
   superseded 2026-08-24 by Dan's leg-limit rule** (Z-leg: blend ≤ transition
   − Retract, equal allowed; X-leg: ≤ pick↔place travel; bigger is better).
   `geometrySanity.js` implements the leg-limit rule.
6. **Symmetric wide band assumed everywhere → OPEN CONFLICT 2026-08-31.**
   `AOI_RangeCheck` widens only the HIGH side (`MinWide` uses the tight
   deadband). See the InPosWide section; awaiting a leads ruling.
