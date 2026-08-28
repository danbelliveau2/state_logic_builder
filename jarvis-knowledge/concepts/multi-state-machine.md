# Multi-state-machine stations — how SDC decomposes concurrency

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Sources: "PLC Software Standardization, Rev2" §Program Structure (Jason
Perry / Tim Wilmot — the design authority per Dan's 2026-08-21 ruling);
Jason Perry's questionnaire answers (CONTROLS #23, cross-station
handshakes); the ShowRoomFlexFeeder exemplar (P01_Robot + P02_Conveyor —
two programs because two asynchronous processes); Dan, 2026-08-25 (the
Magnet Dial round: "there's multiple State machines inside this one
station — I want all the code for the interactions between them").

## The asynchrony test — the standard's own words

The CE bible's Program Structure section says, verbatim:

- "Complicated stations should be broken down into simpler multiple programs."
- "Asynchronous sequences should be separated into multiple programs."
- "Each program must have no more than one state machine."

The test is TIME OVERLAP: if two sequences of one station can be doing
work AT THE SAME MOMENT — the shuttle stripping the next magnet off the
stack WHILE the robot takes the presented magnet from the pick head, the
dial indexing WHILE a downstream head retracts — they are asynchronous
sequences, and each one is its own state machine in its own program. A
single program with two interleaved sequences (one Step variable trying
to describe two mechanisms' progress, or two state variables in one
program) violates the hard rule and is an ARCHITECTURE-LEVEL defect —
the same severity as a wrong rung shape, judged before any rung is read.

The counter-test also matters: sequences that merely ALTERNATE (A always
finishes before B starts, strictly serialized by the mechanism itself)
are one sequence and stay one state machine. Decomposition is driven by
real concurrency, not by device count. And when a machine is
cam-synchronized, stations may have NO state machine at all (the chassis
archetype — see station-archetypes.md); the asynchrony test only applies
where sequences exist.

## Typical dial-station decomposition

A rotary dial (indexer) station family almost always decomposes the same
way — the dial's whole purpose is that positions work concurrently:

1. **Index / ownership SM** — owns the dial axis: waits for every head's
   `q_StationComplete`-class signal (the indexer template's
   `q_WaitStationsComplete` gate), verifies actuators-safe from all
   heads, indexes, then announces fixture ownership back. SDC has
   existing servo dial indexer logic to reuse (ME, Aug 2026) — the
   S00_IndexerSP / S00_IndexerNoSP templates are its shape.
2. **Load-side SM(s)** — the mechanism that feeds parts onto the dial
   (a strip shuttle, an escapement, a load PNP). Runs its own cycle:
   re-arms and prepares the NEXT part while the rest of the station
   works on the current one — that overlap is exactly why it is separate.
3. **Unload / interface SM(s)** — the mechanism that presents or removes
   parts (a pick head presenting to a robot, an unload PNP). Owns the
   external handshake conversation (robot-in-position / robot-clear).

Each SM gets the full per-station skeleton sized to its role: R00_Main,
R01_Inputs, R02_StateTransitions, R03_StateLogic, servo routines only
where that SM owns an axis, R20_Alarms. Small SMs are legitimately
small — a three-state handshake machine still gets its own program;
"too small to be a program" is not an SDC concept.

## Handshakes between the machines

Inter-SM signals are PARAMETERS, not controller tags (CONTROLS #23:
"input/public/output parameters; some wired as connections, some as
direct references"; the bible's Tag Structure section: "Parameters must
be used for physical inputs and outputs, as well as program handshakes").
The idiom:

- The producing SM declares a `p_`/`q_` output parameter, latched and
  cleared at specific states of ITS sequence (`p_MagnetReady` set when
  the pick head presents, cleared when the robot confirms taken).
- The consuming SM reads it as an input parameter or a
  `\ProgramName.p_Signal` direct reference in a wait state's transition.
- EVERY handshake exists on BOTH sides: a set/clear on the producer and
  a consuming wait/transition on the consumer. A signal only one side
  knows about is a compile defect.
- Robot/external-device conversations follow the FlexFeeder shape
  (station-archetypes.md): status UDT bits + registers, thin PLC states,
  every wait time-bounded.

The supervisor conversation does not multiply: each SM independently
carries the standard supervisor plumbing (states 0–3, lockout, HMI
toggles) — but station-level composite signals (`q_StationComplete`,
`q_ActuatorsSafe` toward the dial supervisor) are owned by ONE
designated SM (usually the index/ownership SM), which ANDs the others'
contributions, so the machine supervisor still sees one station.

## Naming

Program names follow the station-prefix convention (bible §Program
Naming): `S{nn}_{Descriptive}` on indexing machines, `P{nn}_{Descriptive}`
for non-indexing processes. Within one physical station that decomposes,
the template family's own convention holds: the dial/indexer machine
takes the `S00_` slot (S00_IndexerSP / S00_IndexerNoSP are the
templates), and each head/process SM takes its station-position number
(S01_MagnetLoad, S02_PickHead …, upstream → downstream in the main task,
following the part). One SM per program, one program per SM — the names
make the decomposition legible to a CE scrolling the controller tree.

## What this means for the compile

When the ME's description or the machine's physics says sequences
overlap in time (or the ME explicitly asks for multiple state machines),
the compile MUST decompose: one planned state machine per asynchronous
sequence, each with its own complete state grid (4, 7, 10 … per machine
— state numbers are per-program), its own transitions and waits, and the
inter-SM handshake signals declared on both sides. Compiling a
concurrent station as one interleaved SM is not a style choice — it
violates "each program must have no more than one state machine" and is
held, never shipped (SUPREME LAW, Dan 2026-08-25: zero authority to
violate a known standard at any level; if the tooling cannot express the
decomposition, that is a blocking question, never a crammed workaround).

## Learned from corrections

- (2026-08-25, Dan — the Magnet Dial round) The Magnet Dial station was
  compiled as ONE state machine despite the ME explicitly asking for
  multiple SMs and the machine's real concurrency (shuttle strips the
  next magnet WHILE the robot takes from the pick head WHILE the dial
  coordinates). Root cause: the pipeline's single-SM-per-station schema
  assumption — the knowledge existed but the output shape couldn't
  express it. The asynchrony test is now a compile-time obligation and
  an architecture-level review check.

## Signal scope: same station vs other station (Dan, 2026-08-28)

Kind of an important distinction for generating good code — two scopes,
two mechanisms:

- **Same station** (another state machine in THIS station, e.g. the
  Escapement and the Pick and Place): program-to-program signals inside
  the station's own programs — `p_` output parameters set/cleared at the
  producing machine's own state transitions, consumed by
  `\ProgramName.p_Signal` direct reference. Never routed through the
  supervisor.
- **Other station** (a different station entirely, e.g. the Dial from a
  load station's point of view): the station's EXTERNAL interface —
  supervisor-visible signals (`q_StationComplete`-class outputs, dial-ready
  inputs). These cross the station boundary and are part of the station's
  contract with the machine supervisor, never a private program reference
  into another station's program.

Terminology: in sequences and ME-facing speech the word is **signal** —
"Wait for Dial's ready signal", "Signal part gripped". Never "handshake"
as a step word. Interactions live as LINES IN THE SEQUENCES (both sides),
never as a separate list — a separate list drifts.
