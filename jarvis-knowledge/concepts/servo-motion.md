# Servo motion — how SDC thinks about it

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
> V4.2 standard templates; (4) Dan's geometry rulings (corner blends, canonical
> points — these stand, they are compatible with MCD); (5) the derived template
> inventory. Where an older statement in this file's history conflicted with a
> newer authority, the newer one won — see SUPERSESSION NOTES at the bottom.

Distilled from the four V4.2 standard templates (S05_ServoPNP two-axis PNP,
S00_IndexerSP / S00_IndexerNoSP dial indexers, the shot pin axis), Jason
Perry's CE reviews (v5 review 2026-08-24, corrected file 2026-08-25), and
Dan's geometry rulings. Rungs quoted below are the concept made concrete —
the concept generalizes to stations no template covers, because SDC uses
"similar concepts and standards" across ALL servo use, not just PNPs.

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
  state gives it a fresh false→true edge.
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
per-state "speed profile" rungs.

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

Never blend into a state whose action requires the position to be truly
reached: releasing a part 5 mm above the nest is a defect, not smoothness.
Waits, grips, releases, and process operations take strict arrival;
travel-to-travel corners take the wideband OR.

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
shot pin's is "dial on-station and not moving." None of these is "the"
permissive shape — the physics is.

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
  axes with no hard stop, e.g. the indexing dial — Jason #19/#21).
  `AxisHomedStatus` then gates every auto MAM — an unhomed axis never
  auto-moves. Homing lives in R04/R05 rungs 9–11 and is DISTINCT from
  initialization (states 100–124).
- Init/recovery (states 100–127) always sequences the vulnerable axis to
  safety FIRST — for a PNP: Z up to retract before any horizontal motion —
  then branches on what the machine is holding (part held → toward place;
  empty → toward pick). Recovery is the same sequence every time regardless
  of cause.
- `GSV MaximumSpeed` at first scan derives max accel/decel per axis
  (velocity/0.85 over the axis's characteristic time); the quickstop MAS
  uses those maxima, not the tuned profile values.

## Rotary / index axes (dials, MAPC)

The same concepts wear rotary units: positions are DEGREES, index increment
= 360° / fixture count; the dial is a single-profile axis (no MCD) whose
consecutive index strokes use the trigger/wait split. On the SDC chassis,
MAPC electronic camming replicates a mechanical cam — cam servo turns 360°,
dial servo indexes one nest per cam revolution, MAPC drives the dial inside
a defined cam angle range. MAG gearing = slave follows a master position
(tracking parts down a conveyor); ratios are FIXED, computed from mechanics,
never tuned empirically. MAG/MAPC are triggered from the state sequence like
any motion. MAR is not standard (as-needed high-speed registration only).
SDC has existing servo dial indexer logic — copy it and update to current
standards rather than writing new.

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
degrees. Dan (2026-08-25): "we use a ton of servos with similar concepts
everywhere" — the PNP is the worked example, not the boundary. Any station's
precision-approach axis gets transition points + MCD; any inter-axis path
corner may blend; any simple traverse or dial stays single-profile.

## The hardware the code rides on (SDC_Motors_Cables_Drives_Guidelines Rev2)

Standard SDC axes are Rockwell: **TLP motors + Kinetix 5300** for standard
PNPs, ball-screw/belt axes, simple rotary, and the indexing-ring shot pin;
**VPL motors + Kinetix 5500** for camming/gearing, chassis CAM & dial axes,
indexing-ring main drives, servo presses, and high-speed coordinated motion.
Codegen-relevant consequences:

- **Multiturn absolute encoders are the standard** — axes normally keep
  position through a power cycle, which is why the homing story is
  "confirm/rehome on loss of reference" rather than "home every start". The
  TLP caveat: battery-backed encoder — a dead battery + power cycle loses
  position, so the Loss-Of-Absolute-Position-Reference alarm is a real
  event, not paranoia.
- **Holding brake is required for vertical loads** — EXCEPT the standard SDC
  PNP vertical axis, which runs brakeless in standard applications.
- **Torque limits are a debug instrument** (EE Debug and Testing Process):
  start at 50%, finish ~20% over observed max — keep the template's torque
  monitoring/setting and quickstop blocks; commissioning depends on them.
- Motion parameters are HMI-entered during debug — everything motion-numeric
  is operator-adjustable, never hardcoded.

## Answers from the controls leads (Jason Perry, 2026-08-20, questionnaires in plc-reference/training-material/)

- **Motion mode decision tree (#1–#3)**: MAM point-to-point = move A→B with a
  defined profile. Blending = rounding corners when two or more axes control
  one mechanism. MAG/MAPC/MAR — see the rotary section above.
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
- **Mandatory servo faults (CONTROLS #16)**: axis fault, loss of absolute
  position reference, and waiting-to-reach-commanded-position timeouts.

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
- (2026-08-25, from diagram review of ServoPNP) A PNP diagram whose Z strokes are flat single-speed moves with no PickTransition/PlaceTransition rows and no corner-blend edges violates the mandatory 2-axis PNP motion model at the DIAGRAM level — the transition/blend structure must be visible in the drawn states/edges, not first appear at codegen.

## Quickstop-on-safety-drop, torque monitoring, manual-mode accel/decel, wideband deadband location (2026-08-30)

- Servo axes carry standard quick-stop logic: if the axis is in motion and its permissive or safety condition drops out, it issues a quick stop rather than an uncontrolled fault-stop — this is baseline servo safety behavior for every axis, not something to ask about per station.
- Torque monitoring/setting logic is a standard part of the servo datatype/logic — servo axes are expected to monitor and set torque limits, not just position/speed.
- Accel and decel values are loaded into the drive during MANUAL mode moves too (inch/jog), not just auto sequence moves — a fix history entry ('servo inch move was inching more than once when button pushed') also confirms inch/jog moves must be edge-triggered, one move per button press.
- The wideband deadband used for the InPosWide/wideband blending pattern lives as a parameter on AOI_RangeCheck itself — confirms the wideband pattern is implemented at the RangeCheck-instance level, consistent with the per-corner AOI_RangeCheck instancing already established for PNP blend corners.

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SICK AFX60 absolute encoder integration (EtherNet/IP) (2026-08-30)

If a station uses a SICK AFS60/AFM60 EtherNet/IP absolute encoder (e.g. for external position feedback separate from a servo drive's own encoder), device parameters are NOT read over cyclic I/O — they're accessed via the vendor's `SICK_AFX60` AOI using asynchronous CIP Generic messaging (MSG instructions wrapped inside the AOI).

- Call is asynchronous/multi-scan: the AOI must be called every scan until `bReadDone`/`bWriteDone` completes.
- Reads and writes are triggered independently by rising edges on `bRead`/`bWrite`; both can run concurrently.
- Which parameters to read/write is selected via bit flags in `stData.GetData.Selection` / `stData.SetData.Selection` (a `ReadAll` bit selects everything).
- Writable params: PresetValue, PositionLowLimit/HighLimit, MinVelocitySetpoint/MaxVelocitySetpoint, TemperatureValueFormat — each with a valid-range error code if written out of bounds.
- Readable params include serial number, resolution, preset, position/velocity limits, warnings, temperature, encoder runtime/uptime, max velocity since commissioning.
- Vendor's recommended timeout is 5000ms (their own default, not derived from an SDC standard — coincidentally matches SDC's Control.FaultTime default).
- Requires one-time manual configuration of the GetMessage (Get Attribute Single) and SetMessage (Set Attribute Single) MSG parameters (Class 1, Instance 1, Attribute 1) pointing at the encoder's EtherNet/IP path — this is vendor plumbing, not something to templatize into the SDC device model.

_Source: AFX60_AOI_DE.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SICK AFS60/AFM60 absolute encoder integration (vendor ladder routine) (2026-08-30)

When a station uses a SICK AFS60/AFM60 absolute rotary encoder over EtherNet/IP (e.g. dial/indexer position feedback), position/parameter access to the encoder is NOT built from scratch — SICK ships a ready-made L5X ladder routine (`SickAFx_A101WS_A103WS_FB_Enc1_GetSet.L5X` or `..._A102WS_...` depending on the assembly instance selected in the module config) that is imported into the project and called as a JSR SubRoutine from MainRoutine.

- Each encoder instance needs its own import pass with a unique **Final Name** for the routine and unique renamed **Tag References** (e.g. `Enc1` → `Enc2`) — multiple encoders in one project are not auto-deduplicated by the import tool.
- Runtime interface is two Controller Tag nodes: `SickAFxWS_EncN_GetData` (read encoder parameters) and `SickAFxWS_EncN_SetData` (write them) — same tags the web server reads/writes, so PLC-side and web-server-side edits are mutually visible (with a browser refresh needed on the web side).
- A Toggle Bit on `SickAFxWS_EncN_Init_GetSet` closes the connection to allow configuration from either the PLC or the web server.
- Changing a preset/position value on this encoder is a safety-relevant act (warning in the vendor doc to check for machine hazard before changing preset) — treat any preset-write logic for this encoder type with the same caution as a homing/position-override operation.

This is a vendor mechanism, not an SDC-authored pattern — file it as "how this specific hardware is wired in," useful if a station spec calls for a SICK absolute encoder.

_Source: 8014213_Installation_LadderRoutine_AFxEtherNetIP_en.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## IPA Move Function Blocks Are Non-Blocking (2026-08-30)

IPA move-related function blocks (jog/move/position commands) do not block — issuing a new move request while one is in progress simply supersedes it rather than queuing or erroring. PLC sequence logic must be written with this in mind: never assume a prior move command has completed just because the rung fired; gate the next move on the axis's actual in-position/motion status bits, not on rung execution order.

_Source: Change Log Ver5.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Homing to a Hard Stop (Torque + Position-Error Limit Technique) (2026-08-30)

To home an IPA-driven axis against a mechanical hard stop without damaging it: (1) lower the torque limit via IPA_SetTorqueLimit so the motor can't force through the stop, (2) set the position error limit via IPA_SetPositionErrorLimit higher than the longest possible travel so the drive doesn't fault on the expected stall, (3) command a move slightly beyond the longest possible travel in the direction of the hard stop, (4) in PLC logic, monitor the actual position feedback and detect when it stops changing, then issue IPA_MoveStop to halt motion at that hard limit. This is the standard SDC pattern for hard-stop homing on IPA axes, distinct from EOT (end-of-travel) homing modes (16,17,19,22,27,30) — switching an axis from an EOT homing mode back to a non-EOT mode requires a full IPA project re-download via ACR-View, not a live parameter change.

_Source: Change Log Ver5.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## PROG2 / PROG3 Special Operations Hook (2026-08-30)

The IPA reserves PROG2 and PROG3 as user-authored program slots for special/custom axis operations that don't fit the standard move FBs. They're written and downloaded to the IPA via ACR-View, then triggered from PLC code with IPA_Run_Prog2 / IPA_Run_Prog3. Use this when a station needs axis behavior outside the standard move/home/jog FB set.

_Source: Change Log Ver5.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SICK AFS60/AFM60 absolute encoder — non-cyclic parameter access via SICK_AFX60 AOI (2026-08-30)

When a station uses a SICK AFS60/AFM60 absolute encoder over EtherNet/IP (rather than as feedback on a native servo axis), device parameters (position limits, preset value, speed limits, temperature format, etc.) are NOT part of the normal cyclic I/O — they're read/written through the vendor's SICK_AFX60 Add-On Instruction using non-cyclic CIP Generic messaging.

- The AOI needs one GetMessage (Get Attribute Single) and one SetMessage (Set Attribute Single) MSG instance configured once (Class 1/Instance 1/Attribute 1, pointed at the encoder's arrReadRecord/arrWriteRecord).
- Usage pattern: set a Selection bitfield (or ReadAll) for which parameters you want, rising-edge bRead/bWrite, poll bReadDone/bWriteDone, check bReadError/bWriteError + error code on failure.
- This is an async, multi-scan operation (spans several PLC cycles) — call it every scan until done, same as any long-running MSG-based routine.
- Relevant if a build uses a SICK absolute encoder needing runtime reconfiguration of preset/position limits/speed limits rather than a factory-set config — otherwise this AOI is irrelevant to normal servo axis motion (handled by the drive's own AXIS/MAM structure, not this).

_Source: AFX60_AOI_EN.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SICK AFX60 Absolute Encoder — AOI Integration Pattern (reference) (2026-08-30)

When a station uses a SICK AFS60/AFM60 EtherNet/IP absolute encoder, device parameters (preset value, position low/high limits, velocity min/max setpoints, temperature format, plus read-only diagnostics like serial number, resolution, warnings, temperature, running/motion time) are accessed through the vendor `SICK_AFX60` AOI, not through standard cyclic I/O tags.

- **Mechanism**: acyclic CIP-Generic messaging. Two MESSAGE instances are wired to the AOI's `GetMessage` (Get Attribute Single) and `SetMessage` (Set Attribute Single) InOut parameters, both configured Class 1 / Instance 1 / Attribute 1, pathed to the encoder's EtherNet/IP node.
- **Call shape**: this AOI is asynchronous — its Logic routine spans multiple PLC scans. It must be called every scan until it finishes; it is never a fire-and-forget single-rung call.
- **Trigger pattern**: rising edge on `bRead` reads every device parameter flagged `1` in `stData.GetData.Selection` (or all of them via `ReadAll`); rising edge on `bWrite` writes every parameter flagged in `stData.SetData.Selection` using the values staged in `stData.SetData`. Completion is signaled by `bReadDone`/`bWriteDone`; read and write operations are independent and may run concurrently.
- **Timeout & errors**: `iTimeout` defaults to 5000ms — exceeding it sets `bReadError`/`bWriteError` and a diagnostic error code (`iReadErrorcode`/`iWriteErrorcode`). Error codes stack block-internal codes (invalid parameter selection, out-of-range write value) with passthrough Studio 5000 MSG-instruction error/extended-error codes.
- **When this applies**: only relevant for stations with SICK absolute encoders read over EtherNet/IP for parameter configuration (not standard cyclic position feedback, which comes through normal I/O mapping) — file as a reference pattern, not a new servo standard.

_Source: AFX60_AOI_DE.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## IPA Motion Controller: Non-Blocking Moves & Hard-Stop Homing (2026-08-30)

- **Non-blocking move FBs**: IPA move-related function blocks (e.g. move commands) are NOT blocking — issuing a new move request interrupts/supersedes one already in progress. PLC sequencing logic must be written expecting this; never assume a prior move fully completes before a subsequent request can take over.
- **Hard-stop homing technique**: to home against a mechanical hard stop without damage — (1) lower the torque limit via IPA_SetTorqueLimit to a safe value, (2) raise the position error limit via IPA_SetPositionErrorLimit above the longest possible travel, (3) command a move in the homing direction for a distance just beyond max travel, (4) monitor actual position in the PLC; when it stops changing (motor stalled against the stop), issue IPA_MoveStop to halt and establish that as the home reference.
- **EOT homing mode switch caveat**: if using an End-of-Travel homing mode (modes 16, 17, 19, 22, 27, 30) and later switching back to a non-EOT homing mode, the IPA project must be re-downloaded via ACR-View — the mode change alone won't take effect otherwise.
- **PROG2/PROG3 custom slots**: the IPA firmware reserves PROG2 and PROG3 for special/custom operations. These are authored and downloaded via ACR-View, then invoked from PLC logic via IPA_Run_Prog2 / IPA_Run_Prog3.
- **Version lockstep**: the AOI version and the IPA project version must always match — mismatches cause functional problems, not just cosmetic ones.

_Source: Change Log Ver5.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## IPA Servo Drive: Non-Blocking Moves, Hard-Stop Homing, Custom Progs (2026-08-30)

- **IPA move FBs are non-blocking.** Issuing a new move request while one is in progress does not queue — it supersedes/interrupts the current move. PLC sequencing logic must account for this: don't assume a move command is 'safe' to fire mid-motion without meaning to abort the prior one.
- **Homing to a mechanical hard stop** (no home sensor) is a supported pattern: (1) lower the torque limit via `IPA_SetTorqueLimit` to a safe value that won't damage the mechanism on contact, (2) raise the position-error limit via `IPA_SetPositionErrorLimit` above the longest possible travel so the drive doesn't fault on the stall, (3) command a move in the homing direction for a distance beyond the longest possible travel, (4) in PLC logic, monitor actual position and when it stops changing (stalled against the stop), issue `IPA_MoveStop` to halt motion there and treat that as the home reference.
- **EOT homing mode switch-back requires a re-download.** If a station uses home-to-EOT modes (16,17,19,22,27,30) and later needs to revert to a non-EOT homing mode, the IPA project must be re-downloaded via ACR-View — a mode-only parameter change is not sufficient.
- **PROG2/PROG3** are IPA-side custom motion programs written and downloaded through ACR-View for special operations the standard FB set doesn't cover; the PLC triggers them with `IPA_Run_Prog2` / `IPA_Run_Prog3`. Useful escape hatch for non-standard axis behavior without inventing new PLC-side motion logic.

_Source: Change Log Ver5.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Quick-stop and torque monitoring on permissive/safety drop (2026-08-30)

- When a servo axis is actively in motion and its permissive or a safety input drops out, the standard is a **quick stop** (controlled deceleration) rather than an abrupt kill or waiting for a fault timeout — protects mechanics and avoids slam-stops mid-move.
- Servo axes also carry **torque monitoring and torque-limit setting logic** as a standard part of the servo datatype/parameters — not just position/speed.
- Accel/decel values are loaded even in manual/inch mode (not just auto), so jogging respects the same motion profile limits as auto sequencing.

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## ACR Controller — EtherNet/IP Class 1 Parameter Mapping (OS x.30+) (2026-08-30)

Some ACR-family motion controllers (OS x.30 update 3 and higher) can host their own Class 1 EIP connection mapping instead of relying on the PLC scanner's Forward Open to supply configuration data. Before the PLC establishes the Class 1 connection, set on the ACR:

- `P37434` — number of parameter groups in use (max 16).
- Per group, 4 sequential parameters define the mapping: **start parameter**, **number of parameters**, **direction**, **data type** (Group 0 = P37440–P37443, Group 1 = P37444–P37447, ... Group 15 = P37500–P37503 — each group is a fixed 4-parameter block).

Rules/limits:
- Max 16 groups, max 8 parameters per group, max 100 total parameters across all groups.
- Data type: 1 = DINT, 2 = Real.
- Direction: 0 = ACR→PLC, 1 = PLC→ACR.

Useful when integrating an ACR controller's Class 1 I/O directly against a PLC scanner where the PLC-side EDS/config doesn't carry explicit Class 1 data — the mapping lives on the ACR side instead.

_Source: EIP_parameters.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## ACR Controller EtherNet/IP Class 1 Setup (parameter-based, no PLC-side config) (2026-08-30)

When integrating an ACR-brand motion controller over EtherNet/IP (ACR OS x.30 update 3+), the Class 1 I/O connection data mapping can be defined entirely on the ACR side instead of relying on configuration data in the PLC's Forward Open request.

- Set `P37434` = number of parameter groups (0–16 max).
- For each group N, four parameters define the mapping: start parameter, number of parameters (max 8/group), direction, data type. Groups are laid out at fixed offsets starting `P37440` (Group 0: P37440–P37443, Group 1: P37444–P37447, ... Group 15: P37500–P37503 — each group is a 4-parameter block, +4 per group index).
- Direction: `0` = ACR→PLC, `1` = PLC→ACR.
- Data type: `1` = DINT, `2` = Real.
- Hard ceiling: 100 total parameters across all groups combined, even though 16 groups × 8 params/group would allow 128 — don't assume the per-group max multiplies out freely.
- This configuration must be committed on the ACR controller BEFORE the PLC establishes its Class 1 connection — it's a one-time controller-side setup step, not something toggled at runtime from ladder logic.

_Source: EIP_parameters.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## IPA Drive Commissioning: EtherNet/IP JOG Conflict (2026-08-30)

When an IPA drive/controller is connected to the PLC over EtherNet/IP, the PLC continuously writes 0 to the drive's JOG register as part of normal cyclic I/O. This holds JOG at zero and prevents manual jogging from ACR-View (the drive's native commissioning tool) while the connection is live.

**Practical rule:** to jog an IPA axis manually during commissioning or troubleshooting, either disconnect the PLC's EtherNet/IP connection or halt the PLC program first — otherwise the PLC's zero-write overrides any jog command sent from ACR-View.

_Source: Config_EIP.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Parker IPA drives — a separate EtherNet/IP AOI platform (not native MAM) (2026-08-30)

Some servo hardware SDC may encounter (Parker IPA drive controllers) is **not** a native Logix motion axis. It connects over EtherNet/IP as a generic CIP adapter, and motion is commanded through Parker's own Add-On Instruction set rather than the standard MAM (Motion Axis Move) rung. If a station specifies Parker IPA drives, the SDC MAM/wideband servo standard does not directly apply — this is a different command architecture, not a deviation from it.

Key architecture:
- **Two connection types**: Class 1 (cyclic, UDP-based, periodic parameter exchange configured as up to 16 groups of parameters, each group up to 8 consecutive P-parameters, DINT or REAL, one direction each) and Class 3 (on-demand TCP request/response — reads, writes, AND/OR mask ops on individual parameters).
- **IPA_AxisManager is mandatory** and must be wired to run every scan for any IPA axis — it does the underlying data exchange; other IPA AOIs won't work without it. It exposes Enabled, Faulted, AxisKill (KAMR), Moving, Ready, Homing, TorqueDisabled, and a Clock heartbeat bit for connection health.
- **Motion AOIs are direct-parameter, not table-referenced**: IPA_Move takes Absolute flag, Position, Velocity, Accel, Decel, Jerk as call inputs — there's no equivalent of SDC's HMI ServoOverall position-table indexing baked into the AOI; if SDC wants HMI-driven positions on an IPA axis, that indirection has to be built in the calling rung, not assumed from the platform.
- **Fault/kill model differs from native axis faults**: KAMR (Kill All Motion Request) is a LATCHED emergency-stop-style condition — once set (via IPA_SetKAMR or certain faults), no new motion is possible until IPA_FaultReset explicitly clears it. Some IPA faults are themselves latched at the drive and need a power cycle, not just FaultReset.
- **Homing is mode-coded, not point-to-point**: IPA_Home takes a HomeMode (0–30) encoding direction, backup-and-final-approach direction, and which switch edge is used, plus separate hard-EOT (end-of-travel) modes that require an IPA reconfiguration download if switched to/from.
- **AOI completion pattern is EN/DN/ER** (execute/done/error) per call, which is the general Studio 5000 AOI convention — but note this is fundamentally a request/response messaging pattern over the network, not a motion-planner MAM, so timing and retry behavior around these calls needs its own state-machine handling distinct from the InPos/InPosWide wideband pattern used for native axes.

_Source: EthernetIP_IPA_B.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Quick-stop, torque monitoring, and manual-mode accel/decel loading (2026-08-30)

Template v3.0 added standard servo safety/quality behaviors that should be assumed present on any SDC servo axis going forward:
- Quick-stop logic fires when the axis is in motion and its permissive or safety condition drops out mid-move — the axis doesn't just lose its move command, it actively decelerates/stops rather than coasting or faulting hard.
- Torque monitoring and setting logic was added to servo logic — axes report/limit torque, not just position and speed.
- (v3.0, 05/04/26) Accel/decel parameters are loaded even in manual/inch mode, not just auto sequence mode — a separate defect class from auto-mode motion (inch moves were also fixed for double-firing on a single button push, v4.1 07/08/26).

These are template-standard behaviors now, not station-specific asks — never ask an ME whether a servo axis needs quick-stop-on-permissive-drop or torque limiting; it's baseline.

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## VFD speed-only actuators (Lenze i550) vs. true servo axes (2026-08-30)

Not every motor-driven actuator in an SDC machine is a positioned servo axis — some are VFD-driven, speed-only actuators (e.g. Lenze i550 over EtherNet/IP via the `i550_ActuatorSpeed` AOI). These have no position loop: control is enable/run/velocity(RPM)/direction/quickstop, and status is ready/enabled/warning/error/actual-velocity/speed-zero. Don't model these as `HMI_{name}` ServoOverall position axes — they're a different device class (fixed or HMI-adjustable RPM setpoint, no Positions[N] table).

Network-control commissioning requires four drive parameters set TRUE/network before the AOI will take control: P201:1=5 (setpoint source = network), P400:1=1 (enable), P400:2=1 (run), P400:37=1 (activate network control). These are one-time drive parameterization, done either via explicit MSG at startup or hand-set in EasyStarter — not per-cycle logic.

Known integration gotcha: Lenze's EDS files embed a revision date in the AOI's linked PDU data type. Updating to a newer EDS without also updating that embedded date on the AOI produces a 'false data type' error that looks like a real fault but is just a stale EDS-to-AOI date mismatch — check/sync the date before assuming a real problem.

When multiple i550 parameters must be written by explicit messaging, don't fire them all at once — the drive/PLC have a limited number of concurrent CIP connections. Use a sequencing pattern (SDC's `i550ExplicitMSGHandler` AOI): one edge-triggered `xSend` input steps through each parameter (Instance/Attribute/Source Length/Value_Out) one at a time via a shared external MESSAGE instruction, raising `xDone` only after all writes complete. Re-arm requires a fresh false→true edge on xSend.

_Source: i550i5Protec_ActuatorSpeed_AOI_documentation_3.0.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Commissioning torque limits and slow/running speed setpoints (2026-08-31)

During machine debug, servo torque limits are staged, not set once: start torque limit at 50% of max as an initial safe value. If torque faults occur during debug, investigate root cause and raise the limit as necessary. Once the machine is running in full auto and meeting cycle time, set the final torque limit to approximately 20% over the max value actually observed in operation — this becomes the production limit.

Automatic-mode speed commissioning also uses two distinct named setpoints, not just one live-tuned value: a 'slow speed' profile used throughout debug/dry-run testing, and the 'running speed' profile used once the sequence is proven. Both should be easy to toggle between (e.g. via HMI or mode select) so a tech can drop back to slow speed to re-verify a sequence without re-entering every parameter by hand. This is in addition to the standard HMI-adjustable per-axis speed/accel/decel — it's a commissioning workflow convention layered on top of that standard, not a replacement for it.

_Source: EE Debug and Testing Process.docx (network: EE Process and Standards Documents), ingested 2026-08-31 by the inbox librarian._

## Motor/Drive Hardware Selection Standards (2026-08-31)

- **TLP motors + Kinetix 5300 drives**: SDC default for simple point-to-point motion — standard PNP axes, ball screw/belt drives, simple rotary axes (e.g. gripper 0–180°), indexing ring shot-pin axis. Cost-effective, lower performance, no CIP Safety. Requires SEPARATE power and feedback cables (AB 2090-CTPW-.../2090-CTFB-...).
- **VPL motors + Kinetix 5500 drives**: for complex/coordinated motion beyond point-to-point — dial/CAM axes, indexing ring main drive, servo press, high-speed coordinated motion. Higher cost, supports CIP Safety/software STO, uses a SINGLE hybrid cable (AB or Lutze, Lutze preferred), power-sharing across multi-axis configs.
- **High-flex cable required** wherever the motor is in continuous motion (e.g. vertical PNP axis).
- **Encoder standard: multiturn absolute**, always — position is retained across power cycles (no incremental-style re-home-to-datum needed). TLP's absolute encoder is battery-backed — if the battery dies and power cycles, position IS lost (a real failure mode worth knowing when diagnosing a 'lost position' fault, distinct from a wiring/feedback fault).
- **Holding brake rule**: required for any vertical-load axis EXCEPT SDC's standard PNP vertical axis, which does not require one for standard payloads (heavy payloads still need a case-by-case calc). This is the one standing exception to 'vertical load → brake.'
- **Motion Analyzer** is the standard sizing tool; keep load:motor inertia ratio ≤10:1.
- **PLC/axis-count selection**: CIP Motion-enabled CompactLogix (5069-L310/320/330ERM) covers 4/8/16 axes; beyond 16 axes, move to ControlLogix (1756-L81/82/83E). Relevant when scoping a machine's total axis count against controller choice.
- **Design discipline**: minimize motor/drive type variation on a machine; reuse an already-used drive size for new axes where possible; consult electrical engineering before deviating from these defaults.

_Source: SDC_Motors_Cables_Drives_Guildelines_Rev 2.docx (network: Standards - Elect Design), ingested 2026-08-31 by the inbox librarian._
