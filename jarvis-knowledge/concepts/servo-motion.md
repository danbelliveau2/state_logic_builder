# Servo motion — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Distilled from the four V4.2 standard templates (S05_ServoPNP two-axis PNP,
S00_IndexerSP / S00_IndexerNoSP dial indexers, the shot pin axis) and from
Jason's CE reviews. Template rungs below are ILLUSTRATIONS of the concept —
the concept generalizes to stations no template covers.

## The core architecture: stage, then command

Every SDC servo axis in a station routine is driven by the same three-rung
spine, and everything else hangs off it:

1. **Staging rung ("Auto Mode")** — a MOVE-per-branch rung that, based on
   which `Status.State[n]` is active, loads `{Axis}MotionParameters`
   (.Position, .Speed, .Accel, .Decel, .MoveType) from the HMI parameter
   arrays (`HMI_{Axis}.Parameters.Positions[i]`, `.AutoSpeed[i]`, `.Accel[i]`,
   `.Decel[i]`). The staging rung is where the PROGRAM decides *which* HMI
   slot applies to *which* state; the VALUES in the slots always belong to the
   operator/CE in the HMI. That split is the whole point: sequence logic in
   the program, tuning in the HMI.
2. **Command rung ("Axis Motion Command")** — one MAM per axis, gated by the
   OR of every state in which this axis moves, plus `ServoActionStatus`,
   `AxisHomedStatus`, and the axis permissive. The MAM consumes whatever the
   staging rung loaded. One MAM instance serves all auto moves; manual mode
   shares it through `{Axis}ManMoveTrig`.
3. **Quickstop rung** — if the permissive or SafetyOK drops while the axis is
   in motion, `MAS` (stop all) at max decel. An axis must never keep moving
   into a condition that is no longer safe.

Why one MAM and a staging rung instead of a MAM per move: the state bits are
exclusive, so the staging rung is a clean truth table of the axis's whole
role in the sequence, and the CE can read "what does Z do and when" from two
rungs. When you add a move, you add a branch to each rung — you don't add
instructions.

## Speed profiles: why more than one speed exists

`AutoSpeed`, `Accel`, `Decel` are ARRAYS (dimension 5) in the ServoOverall
UDT. That's deliberate: real moves are not one speed. The universal pattern
is **fast travel / slow approach** — run fast through free air, slow down
before contacting or approaching anything that matters (a part, a nest, a
tool). The ME expresses this as a **transition point**: "fast to the
transition point, slow into pick; slow up out of pick to the transition
point, then fast." Pick and place each get their own transition point and
they are independent.

How it's implemented: **a physical stroke that changes speed is two staged
segments.** Each segment gets its own state (or sub-step within a state),
its own `Positions[i]` target (the transition point, then the final
position), and its own `AutoSpeed[i]/Accel[i]/Decel[i]` slot in the staging
rung. The index mapping is whatever the station declares — when the project
defines named speed profiles, the declared order defines the AutoSpeed
indices (document the mapping in the staging rung's comment); a station with
no profiles runs everything on index 0. The staging rung selects the profile
per state exactly the way it selects the position per state — parallel MOVE
branches keyed on `Status.State[n]`.

A single-speed axis is not a defect — an indexer dial or a horizontal
traverse that never approaches anything delicate legitimately runs one
profile (`AutoSpeed[0]`) for every move. The question to ask per axis: does
any of its strokes end at something it could hit or seat into? If yes, that
stroke has a transition point and two profiles. If the ME described fast/slow
or transition points, the generated logic MUST stage more than one
AutoSpeed index — describing speeds and then staging only `AutoSpeed[0]`
everywhere is the exact defect Jason red-flagged.

## Blending ("rounding the corner"): why and how

SDC "rounds corners" for cycle time and smoothness: the next motion starts
before the current move fully finishes, so two axes carve an arc instead of
a dead stop at the corner. The template mechanism is the **wideband
in-position transition**, built from `AOI_RangeCheck`:

- `AOI_RangeCheck({PosName}, HMI_{Axis}.Parameters.Positions[i], 0.5,
  HMI_{Axis}.Status.ActualPosition, 5)` continuously produces TWO bits per
  named position: `.InPos` (tight band, e.g. ±0.5) and `.InPosWide` (wide
  band — the last argument, e.g. 5, and this is where the ME's "start the
  next move when Z is within X mm" threshold lives).
- The R02 transition out of a move state carries both cases as an OR:

      [XIC(ZAxis_MAM.PC) XIC(ZAxisRetract.InPos) ,XIC(ZAxis_MAM.IP) XIC(ZAxisRetract.InPosWide) ]

  Read it as: advance when the move is complete AND tightly in position, OR
  while the move is still in process but already inside the wide band. The
  template's own rung comment says it: "Application dependent — add wideband
  positioning permissive to advance to next state before move finishes."
- Because the state advances early, the NEXT state's axis (a different axis)
  gets its MAM rung enabled and starts moving while the first axis finishes
  its commanded move on its own — that's the rounded corner. Nothing about
  the first move is altered; blending is purely a transition-condition
  choice.

**Judgment — when to blend and when not to.** Blend only where early motion
of the next axis is geometrically safe: Z rising toward retract can let X
start once Z is above the collision height (the wide band IS that clearance
threshold). Never blend into a state whose action requires the position to
be truly reached: the template requires strict `MAM.PC + InPos` before
opening the gripper at place, because releasing a part 5&nbsp;mm above the nest
is a defect, not smoothness. Waits, grips, releases, and process operations
take the tight condition; travel-to-travel corners take the wideband OR.

The same wideband idea also feeds **permissives across axes**: in S05 the X
axis permissive is `Z homed AND (ZRetract.InPos OR ZRetract.InPosWide)` — X
is simply never allowed to move unless Z is up (or close enough, per the
same clearance judgment). A permissive is the static form of the concept;
the blended transition is the dynamic form.

## Re-commanding and sub-steps

MAM is edge-triggered by its rung going false→true. The template gets its
re-trigger naturally because no two consecutive states command the same
axis. When one flowchart state genuinely contains two segments of the SAME
axis (fast-then-slow within one drawn state), split it into two staged
segments the same way the template splits states — separate state numbers on
the grid are the clean, template-shaped answer. A same-state sub-step
counter is a workaround that hides the motion structure from R02 and from
the state map; prefer real states.

## Homing and recovery philosophy

- Homing is operator-driven in Manual (state 1): request → confirm →
  `MAH` (machine home) or `AOI_TorqueHome` (torque-to-hardstop homing for
  axes without home switches). `AxisHomedStatus` then gates every auto MAM —
  an unhomed axis never auto-moves.
- Init/recovery (states 100–127) always sequences the vulnerable axis to
  safety FIRST — for a PNP: Z up to clear/retract before any horizontal
  motion — then branches on what the machine is holding (part held → go
  toward place; empty → go toward pick). Recovery is the same sequence every
  time regardless of what caused it.
- `GSV MaximumSpeed` at first scan derives max accel/decel per axis
  (velocity/0.85 over the axis's characteristic time); the quickstop MAS
  uses those maxima, not the tuned profile values.

## What varies per application vs. what never varies

Never varies: the stage/command/quickstop spine; HMI ownership of all
position/speed values; homed+permissive gating on every auto move; tight
InPos for process actions; state-keyed staging branches; one MAM per axis.

Varies per application (decide from the geometry and the ME's words): how
many speed profiles per axis and where the transition points are; which
corners blend and the wide-band clearance distances; which axis is the
"safety-first" recovery axis; whether an axis needs a permissive derived
from another axis's position; whether homing is MAH or torque-home.
