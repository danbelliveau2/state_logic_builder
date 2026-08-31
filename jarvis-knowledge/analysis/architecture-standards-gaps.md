# Architecture-level standards — what the pipeline can express, enforce, or must HOLD on

2026-08-25, after Dan's Magnet Dial challenge ("how could you not follow the
standards?"). Root cause of that incident: the SM-decomposition rule existed in
knowledge, but the compile SCHEMA couldn't express multiple state machines and
the reviewer's checklist stopped at rung/program level — so the pipeline
crammed a concurrent station into one SM. This document is the sweep for the
NEXT collision: every machine/architecture-level rule in the ingested standards
(PLC Software Standardization Rev2; V4.2 SoftwareStandardization.L5X program
set; ChassisStandard; FlexFeeder/Chassis exemplars; EE Recipe Handler), audited
as: **rule → can the pipeline express it? → enforced where? → gap →
disposition**.

Under the SUPREME LAW (Dan, 2026-08-25), every "cannot express" row is a HOLD
trigger until capability lands — never a silent workaround. Dispositions:
LIVE (expressed + enforced), GUARDED (inability guard holds the build),
REVIEWER (caught by the internal review's architecture pass), ROADMAP
(capability work, listed, no hold needed because the situation can't currently
arise or the standard is satisfied externally), or QUESTION (genuine ambiguity
for the leads — none filed this pass).

## Level: machine architecture (Program Structure section)

| Rule | Express? | Enforced | Gap / disposition |
|---|---|---|---|
| Asynchronous sequences = separate programs; one SM per program | YES (new: compile `stateMachines[]` decomposition, per-machine grids/waits/handshakes) | compile OUTPUT_SPEC mandate + `validateCompiledIR` multi checks + reviewer architecture pass | **LIVE** (compile side). Emission of N programs: **GUARDED** — promptBuilder throws HOLD on `multiSm` compiled IRs until multi-program emission lands (see multi-program-emission-plan.md) |
| Each station/linear process has its own program; programs ordered upstream→downstream in the main task | Partially — pipeline emits one program per generate; main-task ordering is a controller-assembly concern | Not enforced (no controller assembly in the Jarvis pipeline; V4.2 controller project provides the task) | **ROADMAP** — programAssembler (emission plan step 2) must schedule programs following the part; decided-and-recorded: load side → dial → downstream heads |
| Program naming S{nn}_/P{nn}_, descriptive; dial/indexer takes S00_ (template family) | YES (`programName` per machine) | `validateCompiledIR` (error when missing, warning off-pattern) + reviewer pass | **LIVE** |
| Supervisor program, min states (Safety Stopped/Manual/Auto Idle/Auto Running/Cycle Stopping/Cycle Stopped); possibly >1 supervisor | NO — pipeline generates station programs only | Not enforced; satisfied externally (the V4.2 controller project the station imports into already carries Supervisor) | **ROADMAP** — supervisor generation/verification when controller-level assembly lands. Legacy `supervisorL5xExporter.js` exists outside the Jarvis pipeline; do not conflate |
| Standard aux programs: Alarms, HMI, MapInputs, MapOutputs, Production, Recipe, SafetyProgram, Tracking, StateMachine (V4.2 program set); one Alarms+HMI per Supervisor | NO (import-from-X-drive programs; not generated) | Not enforced; satisfied by the V4.2 controller project | **ROADMAP** — controller assembly must carry them through unchanged; assembler must verify their presence, never regenerate them |
| Cam-synchronized (chassis) stations have NO state machine — angle-window logic instead | NO — selectTemplate knows only 4 SM templates; a cam station would get an SM skeleton forced onto it | Reviewer architecture pass now names it; concepts (station-archetypes.md) teach it | **REVIEWER + ROADMAP** — no cam/chassis device type exists yet so the case can't be described in the app; when it can, compile needs a chassis archetype or a HOLD guard on cam-synchronized specs |
| Code-stuck-in-run: Supervisor forces Cycle Stopped after 10s timer | NO (supervisor-side logic) | Template's supervisor carries it | **ROADMAP** (assembly verification) |

## Level: program / handshakes (Tag Structure, I/O Parameters, CONTROLS #23)

| Rule | Express? | Enforced | Gap / disposition |
|---|---|---|---|
| Program handshakes are PARAMETERS (p_/i_/q_), never ad-hoc controller tags; local tags by default; controller tags only for global interest | YES (handshakes[] with direction/partner/set/clear; conditionText `\Program.p_` idiom) | compile spec + `validateCrossMachineHandshakes` (both sides must exist) + reviewer pass; mergeEngine refuses controller-tag edits | **LIVE** at plan level; RUNG-level both-sides verification is emission work (plan step 3/4) |
| Physical IO always parameters, verb-first outputs / state-past-tense inputs | YES | tagNaming conventions + reviewer + validator | LIVE (pre-existing) |
| Network device / CIP axis naming (sd/vb/io/cam/rob/fd/gd + a{NN}_) | Partially (controller-scope; pipeline doesn't author axes) | Template carries; reviewer style pass | LIVE-by-template |

## Level: fault recovery

| Rule | Express? | Enforced | Gap / disposition |
|---|---|---|---|
| Fault = 127; no standard recovery path (per-machine judgment); init/resume part-in-hand skeleton non-droppable; init-with-part general rule (#16) | YES (compile states/transitions; concepts/coordination.md) | compile validation (exitless waits, flow order) + reviewer | LIVE. NOTE: Dan's Magnet Dial spec says "this is a dial so no fault recovery and initialization and all that stuff" — that reads as an intended DEVIATION/scope statement; the compile must treat it per the deviation handshake (state the standard once, confirm, record), never silently drop init |
| Faulted station → fault state; others complete to known position (controlled stop) | Station side YES; supervisor side NO | Template R02 override block | LIVE-by-template |

## Level: part tracking / production data

| Rule | Express? | Enforced | Gap / disposition |
|---|---|---|---|
| Attempt/Success OTLs on commit/confirm rungs (\Tracking.p_Data.Nest[...]) | YES (template notes carry the idiom) | Reviewer; COMMON_NOTES | LIVE |
| Tracking program itself; nest data (attempts/good/reject/efficiency, unload-time update); station data + Bypass/Lockout controls with success-bit semantics and warning messages | NO (machine-level Tracking/Production programs are imported, not generated) | Not enforced in pipeline | **ROADMAP** — assembly verification; station-side lockout/bypass semantics ARE expressible and should get a validator check (lockout ⇒ success bit set; bypass/lockout ⇒ warning message present) |
| Production data (OEE, cycle times, MovingAverage) | NO (standard program from X drive) | Template/controller project | ROADMAP (assembly verification) |
| Failure-type codes (station number + failure number), tallied + written into nest tracking | Partially (compile can plan states/actions; no schema field for failure codes) | Not enforced | **ROADMAP** — add failure-type declarations to the compile schema for verify/vision stations; until then the reviewer must flag a verify station without failure codes ("really needed" — Dan 2026-08-21) |

## Level: vision / verify stations

| Rule | Express? | Enforced | Gap / disposition |
|---|---|---|---|
| Verify station: consecutive-failures counter (default 3, HMI-settable), fault at preset, reset on pass/fault | YES (states/counters expressible) | Not mechanically enforced; reviewer knows (meKnowledge 2026-08-21: must be generated) | **ROADMAP** — add a verify-station validator check (counter + exhaustion transition present) |
| Verification sensor ON=pass; OFF must be detected each cycle; stuck-ON ⇒ fault | YES | Not mechanically enforced | ROADMAP (same check) |
| Bypass toggle: trigger still fires, result ignored, success bit set | YES | Not enforced | ROADMAP |

## Level: rung (for completeness — already covered)

One-move-per-state, MAM trigger shape, R02 ascending + override block, mnemonic
family, wideband/blend idioms, L5K/Decorated grammar: LIVE — validator.js,
importSimValidator.js (mandatory gate), compile validation, reviewer. The
architecture pass was the missing altitude; it is now in the reviewer SYSTEM.

## Leads questions filed this pass

None. Every gap above is capability work (roadmap) or already dispositioned by
a recorded decision; no genuine standards ambiguity surfaced. (The
per-program-files vs full-controller export question is tracked in
multi-program-emission-plan.md with a decided default — per-program partial
imports first — and only becomes a leads question if practice contradicts it.)
