# SDC V4.2 L5X Generation Rules

These rules are LAW. The template L5X included in the prompt is the authoritative
example of every idiom below — when a rule and the template appear to disagree,
follow the template. Older project exports are reference only and must NOT be
imitated where they conflict with these rules.

Each `## Rule N` heading below is one enforced rule. The prompt builder counts
these headings, so keep the `## Rule N —` format when editing.

> **Model selection:** the default generation model is `claude-opus-5`.
> `claude-fable-5` is the quality escalation path for hard stations (set
> `JARVIS_MODEL=claude-fable-5` in `.env`) — paying more for a station that
> imports clean and runs right is always the correct trade.

## Prime directive: machines that stop less

SDC's #1 company goal. Generated code must RECOVER, not fault:

- Retry transient failures (typically 3 attempts) before raising a fault —
  a gripper that missed once gets re-commanded, not a faulted machine.
- Emit auto-recovery sequences where the physics allow it (e.g. robot crash
  detection → move up to a safe height, reset, retry the motion, continue).
- Wait-for-upstream conditions get a WARNING plus `q_Pause` — never a hard
  fault. The dial being late is not an emergency.
- Hard faults are reserved for genuinely unsafe or unrecoverable conditions
  (lost axis home, safety circuit, physical crash without a safe retreat).
- When compiling a diagram, actively consider "how does this station keep
  running when X goes wrong" for every state — the retry/recovery paths the
  diagram does not draw still belong in the program where the template
  provides an idiom for them.

## Generation tiers

Identify which tier a request is, scope the output to that tier, and never
present a lower tier's output as a higher tier's completeness:

1. **Sequence / station code** — one state machine → one Target program
   (this is what a single flowchart compiles to; context programs are
   referenced, not generated).
2. **Multi-SM integration** — several SMs coordinating via signals and
   handshakes (`p_*` outputs, `q_StationComplete`/`q_ActuatorsSafe`/`q_Pause`,
   `\OtherProgram.tag` references); the cross-program interfaces must line up
   pairwise across the generated programs.
3. **Full machine code** — Supervisor / Alarms / Tracking / Recipe / MainTask,
   reject handling, part tracking write logic; requires generating or
   modifying the context programs themselves.

## Rule 1 — Output format

The finished export is ONE complete Studio 5000 Program-scoped L5X
(`TargetType="Program"`, `ContainsContext="true"`) produced by applying a
surgical edit plan to the selected SDC V4.2 standard template. The template's
controller context (DataTypes, AddOnInstructionDefinitions, controller Tags),
context Programs (`Supervisor`, `Alarms`, `Tracking`, ...), and boilerplate
are law and pass through unchanged. Every tag, AOI, UDT, and context program
referenced by any rung MUST be declared in the file — new program tags are
declared with addTag. Do not invent instructions — use only standard Logix
mnemonics and the AOIs declared in the template.

## Rule 2 — Routine set and JSR chain

Target program uses `MainRoutineName="R00_Main"`. R00_Main is only JSR calls, in
order: R01_Inputs → R02_StateTransitions → R03_StateLogic → (R04/R05 per servo
axis, one routine per axis, matching the template's servo routine verbatim with
axis names substituted) → R20_Alarms. Copy the template's R01 boilerplate order:
HMI_Toggle decode (.0=Lockout, .1=DryRun, .2=SS), SS_OK derivation,
HMI_Momentary auto-clear, sensor conditioning/debounce, CPU time call.

## Rule 3 — State numbering

Sequence states compiled from the flowchart are numbered 4, 7, 10, 13, ... 31
(base 4, increment +3). Reserved: 0 = powerup, 1–3 = SDC reserved (states 2 and
3 are the auto-idle-not-ready / auto-idle-ready pair, copied from the
template), 99 = lockout, 100–126 = station-type init block (copied from the
template), 127 = cycle-ready gate. State transitions are written in
R02_StateTransitions as one rung per destination state:
`XIC(Status.State[current]) <conditions> MOVE(dest,Control.StateReg);`
Never MOVE a value outside the legal set {0,1,2,3, 4..97 step 3, 99, 100..127}.
R03_StateLogic drives outputs with OTL/OTU (or OTE) qualified by
`XIC(Status.State[n])`.

## Rule 4 — SS_OK gating

Every automatic state-advance rung in R02 that moves the sequence forward
through flowchart states must include `XIC(SS_OK)` so Single-Step mode
(HMI_Toggle.2) can hold the machine between states. Init-block and
fault/lockout transitions follow the template (some are not SS-gated —
match the template exactly).

## Rule 5 — V4.2 part tracking (Attempt / Success latching)

At the state transition where the station has committed to working on the part
(e.g. gripper confirmed closed on a pick), latch the Attempt bit on the SAME
rung as the MOVE:
`...MOVE(n,Control.StateReg)OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt);`
At the transition where the station's work is confirmed complete, latch
`...Success` the same way. Use `\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].{Attempt|Success|Lockout}`
exactly as the template does. `StaNum` and `NestNumCurrent` are program tags
declared and computed per the template.

## Rule 6 — Station handshake outputs

R03 must produce the three-output handshake to the Supervisor/Indexer, copied
from the template idiom:
- `OTE(q_ActuatorsSafe)` — true only when every actuator is in a dial-safe
  position (axes homed + at clear positions, cylinders retracted, no motion).
- `OTE(q_Pause)` — station requests the cycle to hold.
- `OTE(q_StationComplete)` — station has finished its work for this index
  (typically latched at cycle-complete state and cleared on index).

## Rule 7 — Alarm idiom

R20_Alarms calls the `ProgramAlarmHandler` AOI exactly as the template does.
Per-state fault timers use `Control.FaultTime`: preset with
`MOVE(5000,Control.FaultTime)` (5000 ms default) and override per-state only
where the template does. Every alarm message string is prefixed with the
station identifier (e.g. `S01: Gripper failed to close`). Alarm message data
lives in the L5K-format alarm arrays exactly like the template — LEN values
must match the actual string content.

## Rule 8 — Engineer placeholders

Any condition the diagram cannot supply (index-complete from the dial, part
present from an upstream sensor, application-specific interlocks) must be
emitted as a compiling placeholder, never omitted and never guessed:
`[XIC(g_MachineBasic.AlwaysOff) ,XIC(DryRun) ]` in the rung, plus a rung
comment beginning with `*Replace` telling the controls engineer exactly what
real signal belongs there.

## Rule 9 — Tag naming (SDC standard, full words)

- Pneumatic solenoids: `q_Extend{Name}` / `q_Retract{Name}`; gripper:
  `q_Close{Name}` / `q_Open{Name}`; sensors `i_{Name}Extended` etc.
- Delay timers: `{Name}ExtendDelay` / `{Name}RetractDelay`.
- Servo axes: controller-scope `a{NN}_S{station}{Name}` AXIS_CIP_DRIVE,
  program `iq_{Name}` InOut, `HMI_{Name}` (ServoOverall UDT), motion instances
  `MSO_`, `MSF_`, `MAFR_`, `MASR_`, `MAJ_`, `MAS_Jog`, `MAH_`, `MAM_Auto`.
- SM outputs/signals: `p_{SignalName}`. Digital sensors: `i_{Name}` +
  `{Name}Debounce` AOI instance.
No abbreviations. Match the template's names for all boilerplate tags
(`Control`, `Status`, `SS_OK`, `DryRun`, `Lockout`, `Initialized`,
`CycleRunning`, ...).

## Rule 10 — Comments and traceability

Every R02 rung gets a comment `State N: <plain-English description>` derived
from the flowchart node label. Rungs containing placeholders additionally carry
the `*Replace ...` note (Rule 8). Do not strip or paraphrase template comments
on copied boilerplate.

## Rule 11 — Machine Spec is authoritative intent (no exitless waits)

When the IR carries a `MACHINE SPEC` section, its outcome rules and
relationships are AUTHORITATIVE mechanical intent — the mechanical engineer
authored WHAT must happen; you synthesize HOW: the signals, waits, exits,
retry counters, and cross-station handshakes that realize them.

- Every outcome rule must have a reachable path in the generated program:
  the trigger condition detected (or an engineer placeholder per Rule 8),
  the response performed, the retry count enforced with a counter, and the
  escalation reachable when retries are exhausted.
- Every wait you create MUST have an exit for every partner failure mode
  the spec declares PLUS a timeout path (Control.FaultTime alarm coverage in
  R20 at minimum). A wait whose condition can never be forced by a fault or
  timeout path is a defect — no exitless waits, ever.
- Reciprocal declarations from partner stations describe the other side of
  each handshake — the `p_*` / `q_*` interface you emit must be consistent
  with what the partner declares it provides or consumes. Where the partner
  program is not being generated in this run, reference its side with an
  engineer placeholder per Rule 8.
- The spec's plain-language text goes into rung comments and alarm messages
  (station-prefixed per Rule 7) so the running machine speaks the ME's words.
