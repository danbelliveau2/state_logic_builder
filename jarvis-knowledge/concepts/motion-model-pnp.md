# The 2-axis PNP motion model — THE definitive reference

> CONCEPTS, NOT RULES — but this file is also the AUTHORITY for PNP motion
> geometry. It supersedes the scattered lessons on transitions, blends, and
> named points (servo-motion.md points here for PNP motion). Sources: Dan's
> hand sketch of the pick-place path (2026-08-24), his rulings resolving
> Jason Perry's v5 review (2026-08-24), and the canonical-rows enumeration
> (agentic corrections doctrine, 2026-08-24).
>
> Written because the questions kept recurring ("why is this so complicated?
> what do you need?") and a compile INVENTED an X-axis PlaceTransition at 450
> on an axis whose Place is 300 — geometric nonsense. Consolidated once, here.

## The path

A standard 2-axis pick-and-place traces an inverted U, over and over:

```
 Retract height ─●━━━━━━━━━━ traverse (X, fast) ━━━━━━━━━●─ Retract height
              ⌒ blend (symmetric arc                 blend ⌒
              │  over the square corner)             fast (Z) │
              │ fast (Z)                                      │
              ● PickTransition                 PlaceTransition ●
              │ slow (Z)                             slow (Z) │
              ● Pick  (gripper closes)   (gripper opens) Place ●
```

ONE square inverted-U: down at Pick, up to THE single Retract height,
traverse across at that height unchanged, down at Place, up, return the same
way. That's the whole machine. Every named point below exists to describe
THIS path — and no other points exist. The only thing that ever softens the
square is the symmetric corner rounding described under Blends.

## Canonical points — X axis (the horizontal traverse)

**Pick, Place. Optionally Home. Nothing else.**

- `Pick` — the X position over the pick nest.
- `Place` — the X position over the place nest.
- `Home` is OPTIONAL and normally ABSENT: the standard PNP horizontal axis
  has NO home position (Jason's v5 review, items 8/10; Dan's ruling: the
  controls answer wins). Initialization parks the axis AT PICK (empty) or at
  the place side (carrying). Init's exit posture IS the cycle's start posture.
- **NO transition points on X for this pattern — EVER** (Dan, 2026-08-24,
  final ruling). X never does a precision approach — it stops over a nest
  while Z is safely up at retract level, and it **decelerates naturally on
  its accel/decel settings**; that is the whole deceleration story. There is
  nothing to approach slowly and nothing to stage a speed change against.
- **NO speed-change points on X.** X runs FAST, always. Its speed changes
  ONLY if the ME explicitly says so — and then it's the ME's stated point,
  never an invented one.

The invented "XAxis PlaceTransition 450" defect violated all of this at
once: a transition on an axis that has none, past the target it would
supposedly approach (Place 300). Arithmetic alone refutes it: a transition
lies strictly BETWEEN the approach and the target. `geometrySanity.js`
now enforces exactly that.

## Canonical points — Z axis (the vertical precision axis)

**Seven visible rows, in this order (Dan's enumeration — nothing else):**

1. `Retract` — the travel level; where Z rests and traverses happen.
2. `PickTransition` — displayed to MEs as **"Pick speed transition"**: where
   Z switches fast→slow on the way down to Pick (and slow→fast on the way
   up). Strictly between Retract and Pick.
3. `Pick` — the working depth at the pick nest. Gripper closes here.
4. `PickRetractBlend` — a DISTANCE (mm): how far from the retract-level
   corner above Pick the path starts/stops rounding.
5. `PlaceTransition` — displayed as **"Place speed transition"**: fast/slow
   switch on the way down to Place. Strictly between Retract and Place.
6. `Place` — the working depth at the place nest. Gripper opens here.
7. `PlaceRetractBlend` — the corner distance above Place. Independent of the
   pick-side value — the two corners may differ geometrically.

**SPEED WINDOWS DO NOT EXIST as ME-facing values** (Dan, 2026-08-24, final
ruling: "the blend start/end IS the window"). There are NO
`{Pos}TransitionWideBand` rows, no "advanced" rows, no ME-visible windows of
any kind besides the two corner blends — the seven rows above are everything
the ME sees. In the code (Jason's corrected file, 2026-08-25), the transition
point is a named Positions[i] slot with its own RangeCheck instance, and
passing it MID-FLIGHT is detected on that instance's `.InPosWide` (standard
internal wide default — plumbing, never a row); the speed change is an MCD
on the in-flight move, and **the axis never stops at a transition point**.
Strict arrival — `{Axis}_MAM.PC` + `.InPos` — is reserved for the stroke's
FINAL target (Pick, Place, Retract). Z has exactly TWO speed-transition
points (Pick, Place); X has NONE, ever, for this pattern.

## The speed model

Per stroke on Z: **fast to the transition point, slow transition→target;
slow target→transition, fast to retract.** Pick and Place transitions are
independent values. X is always fast. Speeds themselves are HMI values
(SDC defaults prefill: Fast 1000 mm/s, Slow 100 mm/s); the transition
POSITIONS are mechanical-model facts the ME supplies — from the sheet's
tables, never asked at compile.

**How a stroke compiles (the MCD model — Jason's corrected file, 2026-08-25;
supersedes the two-segment model):** each Z stroke is ONE MAM commanded at
stroke start, targeted at the FINAL position, plus an MCD that retunes
speed/accel/decel in flight at the transition point. In states (corrected
file, down-stroke): "Move Z Axis To Pick Position" (MAM fires fast, exits on
`MAM.IP`) → "Wait for ZAxis at pick transition" (exits on
`ZAxisPickTransition.InPosWide`) → "ZAxis slow down to pick" (MCD fires,
exits on strict `MAM.PC + ZAxisPick.InPos`). Up-strokes mirror it: MAM
starts slow leaving the nest, MCD to fast at the transition. Never compile a
stroke as two MAM segments — re-triggering MAM at the transition decelerates
to zero, costs cycle time, and jerks the mechanism. Rung shapes, the MCD
rung's exact pattern, and state granularity: servo-motion.md.

## Blends — SYMMETRIC corner rounding, never "after complete" chains

The path is ONE square inverted-U — down at Pick, up to THE single Retract
height, traverse across at that height unchanged, down at Place. Pick point,
Place point, and the Retract height NEVER move. **Blending is ONLY rounding
the corners of that square** (Dan's sketch, restated 2026-08-24): at each
retract-level corner the arc starts on the incoming leg at blend-distance
BEFORE the corner vertex and ends on the outgoing leg at the SAME distance
after it — symmetric, measured from the vertex along BOTH legs, like a
rounded 45° corner. `PickRetractBlend` is that one distance for the corner
above Pick; `PlaceRetractBlend` for the corner above Place — independent
values because the two corners may differ geometrically, but each is a single
number applied to both of its own legs.

In the code the blends are **wideband early state-advance** at those two
corners — the early advance fires at blend-distance from the corner on the
INCOMING leg (the InPosWide deadband anchored at the corner's Retract level
equals the blend distance):

- Pick-side corner (exit): as Z rises out of Pick and enters the blend zone
  (within `PickRetractBlend` mm of Retract), the state advances early —
  `[Z_MAM.PC + ZRetract.InPos , Z_MAM.IP + ZRetract.InPosWide]` — and the X
  traverse STARTS while Z finishes its move on its own. The blend value IS
  the InPosWide deadband anchored at Retract on the pick side.
- Place-side corner (approach): the traverse's exit condition uses the place
  value, so Z starts down inside the zone as X finishes.

Blending lives ONLY in the transition condition between move states. It is
NEVER expressed by stacking moves in one state, never by "after complete"
chains, never by corner-delay timers or sub-step counters (the one-move-per-
state law, servo-motion.md).

**Blend size limits (Dan's rule, 2026-08-24 — authoritative):** the arc
extends blend-distance from the retract-level corner along each leg, so the
only physical limits are the legs themselves:
- **Z-leg:** blend ≤ (that side's speed transition − Retract). The rounding
  may not extend past the speed-change point — EQUAL is allowed ("the gap
  could be zero — ideally the fastest motion is close to zero gap, clearance
  permitting").
- **X-leg:** blend ≤ the X travel between Pick and Place (can't round past
  the far point).
Nothing else constrains blends. Bigger blends are GOOD (faster cycle) — a
large-but-legal value gets no warning of any kind.

### The cross-axis corner blend wide band — VERIFIED ANSWER (Jason confirmed v7 correct, 2026-08-26)

A corner's blend distance is ONE ME-owned number, but the corner has two legs
on two axes. Where does the value live in code? **Answered from the verified
work** (SDCServoPNP_JARVIS_v7.L5X, confirmed correct by Jason Perry
2026-08-26 — plc-reference/verified/): the traversing axis's target
RangeCheck takes its wide band by **direct cross-axis reference to the
corner's blend row in the owning axis's HMI parameter array** — no mirrored
slot, no invented position row on the traversing axis. Verified rung (v7
R04 Axis Position Monitor):

```
AOI_RangeCheck(XAxisPlace, HMI_XAxis.Parameters.Positions[1], 0.5,
               HMI_XAxis.Status.ActualPosition,
               HMI_ZAxis.Parameters.Positions[6])   ← PlaceRetractBlend, Z-owned
```

The same Positions[6] value also feeds the Z-side corner instance
(`ZAxisPlaceRetractBlend`, anchored on the Retract slot), so the corner has
exactly one HMI-tunable number and both legs read it. The place-side
descent gate consumes it in R02: state "Move X Axis To Place" exits on
`[XAxis_MAM.PC + XAxisPlace.InPos , XAxis_MAM.IP + XAxisPlace.InPosWide]` —
Z starts down once X is inside the blend band of Place, mid-flight.
Comment the rung with where the value comes from; it is standard now, not a
flagged proposal.

Where releasing/gripping happens, there is NO blend: gripper actions take
strict `MAM.PC + InPos` **on every axis whose position matters there** — the
release transition verifies X AND Z strictly at Place (cross-axis
verification lives at the consequence point, never stacked on intermediate
blend states; Jason, 2026-08-25). A part released 5 mm above the nest is a
defect.

## The X-traverse permissive (Jason Perry ruling, 2026-08-25)

The horizontal axis's motion permissive under this model is **Z Axis Homed
AND Z Actual Position at/above a safe position set at startup** — one
ordered compare against a startup-set `ZAxisSafePosition` tag (seeded at
first scan from Retract + the larger corner blend), NOT an OR of
parked-band/blend RangeCheck bits. Every sanctioned overlap window (both
corner blends, the place-side descent start) is inside the safe zone by
construction, so no enumeration can develop gaps. Mind the polarity: where Z
increases downward, at/above = `LE`. Full pattern: servo-motion.md,
"Permissives when axes legitimately move together."

## THE GENERALIZATION — how to think about any station's motion

- **Transition points exist on the axis that does the PRECISION APPROACH**
  (the one whose stroke ends at something it could hit or seat into). For a
  PNP that is Z, at Pick and at Place — one transition per approached target.
- **Blend zones exist at PATH CORNERS between axes** — one independent
  distance per corner, named `{Corner}{Level}Blend` by the corner they round.
- **Never invent points the ME didn't imply.** The ME's model defines the
  points; the sheet's tables carry their values. A point the code wants that
  the sheet doesn't have is a visible red row/question — NEVER a silently
  fabricated number. Arithmetic sanity is mechanical: a transition between
  its approach and target, a blend within its Z-leg and X-leg limits, nothing
  outside the axis envelope (`src/lib/geometrySanity.js`, wired into the
  sheet, the servo table, the motion-path diagram, and compile validation).

## Rest postures (one concept, not four fixes)

X rests at Pick (or Place-side when carrying — init state 106). Z homes and
rests at Retract. Grippers rest at Disengaged. No X-home rows, no
move-to-home states, no alarms referencing positions that don't exist.

## SUPERSESSION NOTES — what changed and when

1. **2026-08-25 (Jason's corrected file): the two-segment speed model died.**
   Earlier versions of this file said the speed change was confirmed by
   strict arrival at the transition point, "then the next staged segment
   fires." Current doctrine: one MAM per stroke to the final target, MCD for
   the in-flight profile change, transition points detected mid-flight on
   `.InPosWide`. Dan's ME-facing ruling (no window rows, 7 canonical Z rows,
   no X transitions ever) is untouched by this — it stands in full.
2. **2026-08-24 (Dan's final geometry round): speed-window rows and any
   "advanced"/wideband rows were removed** — the corner blends are the only
   ME-owned windows, with Dan's leg-limit sizing rule (implemented in
   `geometrySanity.js`). Earlier "blend under half the smallest gap" guidance
   is dead.
3. **2026-08-24 (Jason v5 items 8/10, Dan's resolution): X home removed** —
   pick and place only; init parks at pick/place-side.
