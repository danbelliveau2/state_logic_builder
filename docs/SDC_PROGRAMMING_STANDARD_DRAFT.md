# SDC PLC Programming Standard — Draft for Critique
> Written by the AI code-generation agent from the V4.2 standard templates (S00_IndexerSP/NoSP, S01_PartLoad, S05_ServoPNP) and the template revision history.
> **Purpose: critique this.** Anything wrong, missing, or overstated here is a gap in what the agent believes — correct it and the generated code follows.

## 1. Architecture
- One program per station: `S{nn}_{Name}`. Context programs shared machine-wide: **Supervisor, Alarms, Tracking, Recipe** (V4.2).
- Routines per station: `R00_Main` (JSRs only) → `R01_Inputs` → `R02_StateTransitions` → `R03_StateLogic` → `R04/R05_{Axis}Servo` (one per axis) → `R20_Alarms`.
- Axes are program-scope `iq_{Axis}` InOut parameters bound to controller axes via ParameterConnections.

## 2. State engine
- `State_Engine_128Max(StateEngine, Control, Status, StateHistory)`; transitions are `MOVE(n, Control.StateReg)`; logic reads one-hot `Status.State[n]`.
- State map: **0** Safety Stop · **1** Manual · **2** Auto not ready · **3** Auto ready · **4–31** sequence in steps of 3 (4 = first wait/run state) · **99** Lockout · **100–124** init/recovery · **127** Faulted.
- Safety stop and fault snapshot the restartable state: `ONS + LIMIT(4, StateReg, 98) + MOVE(StateReg, RestartState)`. State 2 is the recovery hub.

## 3. State transitions (R02)
- One commented rung per target state. Ordering is sequence-first; mode/safety overrides live at the bottom of the routine so they win the scan.
- **Every sequence transition is gated `XIC(SS_OK)`** (single-step).
- Transition conditions test **confirmations, not commands**: servo = `{Axis}_MAM.PC + {Position}.InPos`; pneumatic = derived position bits; sensorless devices = delay timer `.DN`.
- Timers live in R01_Inputs; R02 tests only `.DN`. No TON instructions inside transition rungs.
- **Wideband early advance** where safe: `[PC + InPos , IP + InPosWide]` lets the next motion start before the previous fully settles. Not used when the next action physically requires the position (e.g., descending onto a nest).
- DryRun bypasses part-dependent conditions; PartStarted jump states where applicable.

## 4. State logic (R03)
- Deliberately thin: status bits, part-started latch, device outputs. **No motion instructions here.**
- Canonical output shape (seal-in, OTE not OTL):
  `[auto: set-state OR self-hold-unless-clear-state] OR [State[1] manual: HMI_Momentary set/clear] → OTE(q_Output)`
- Part tracking: latch `Attempt` when the pick/process confirms, `Success` when the place/process completes, into `\Tracking.p_Data.Nest[NestNum].PartStatus.Station[StaNum]`.

## 5. Servo axes (R04/R05 — the fixed per-axis module)
- The ~22-rung template per axis: Ready → AutoEnable → Permissive → MSO → MSF → fault reset (MAFR/MASR) → jog (MAJ) → inch → home request/confirm/execute (MAH or AOI_TorqueHome) → manual param staging → auto param staging → single MAM → quick-stop MAS on permissive loss → torque limits → feedback mapping → computed max accel/decel (CPT from MaxVelocity) → position monitors.
- Positions live in `HMI_{Axis}.Parameters.Positions[n]` — stable indices, never reshuffled. Position confirmation via `AOI_RangeCheck` (`.InPos` / `.InPosWide`).
- The MAM is gated: `ServoActionStatus + AxisHomedStatus + {Axis}Permissive`. **Cross-axis permissives are mandatory** (e.g., X may not move unless Z is at Clear, sensor + range-check confirmed).

## 6. Pneumatic devices (R01 derivations)
- 2-sensor: `XIC(sensor) XIO(oppositeSensor) XIC(output) XIO(oppositeOutput) → OTE(AxisMoved)`.
- 1-sensor: sensed direction as above; blind direction inferred: `XIO(sensor) + outputs + TON`.
- Sensorless (grippers, retainers): output + delay timer → derived `Opened/Closed` bits. All downstream logic uses derived bits, never raw sensors.
- `AOI_Debounce` on DigitalSensor inputs (not pneumatic position sensors).

## 7. Faults, alarms, warnings (R20)
- Sequence timeouts use the state engine: `[state] MOVE(ms, Control.FaultTime) + XIC(Status.TimeoutFlt)`, latched until FaultReset.
- Pneumatic motions get per-direction watchdogs (output-on/confirm-off) plus misconfiguration checks (both sensors true).
- Two banks: `ServoAlarm[]` (drive fault w/ `DTOS+CONCAT` fault code, lost-home, quickstop-cause) and `Alarm[]` (sequence). Two `ProgramAlarmHandler` instances; outputs OR'd.
- Runtime messages station-prefixed: `CONCAT(g_StationList[StaNum], AlarmList[n], Alarm[n].Message)`.
- "Waiting for part" style conditions are **warnings** driving `q_Pause`, not faults (V4.0 change).
- Spare alarm slots held with `XIC(g_MachineBasic.AlwaysOff)` so indices stay stable.

## 8. Machine coordination
- Station → indexer contract: `q_StationComplete` (cycle done), `q_ActuatorsSafe` (clear to index), `q_Pause` (hold dial, no fault).
- Indexer: dwell = AND of all stations' complete bits; index = incremental MAM; on-station = MOD-based nest math within tolerance; shot pin fully interlocked both directions (pin moves only on-station at rest; index only with pin retracted+confirmed).
- Supervisor supplies `q_ManualMode, q_SafetyOK, q_FaultReset, q_CycleStartLatch, q_CycleStopped`.

## 9. Naming
| Prefix | Meaning | Example |
|---|---|---|
| `q_` | output/command | `q_CloseGripper` |
| `i_` | physical input | `i_PartPresent` |
| `p_` | published value/signal | `p_CycleTime` |
| `iq_` | InOut parameter (axes) | `iq_XAxis` |
| `HMI_` | HMI-facing structure | `HMI_XAxis` |
| `a{nn}_` | controller-scope axis | `a02_S01PNPXAxis` |
| `{Axis}_{Instr}` | motion instruction tag | `XAxis_MAM`, `ZAxis_MSO` |
Full words, no abbreviations. Range-check instances named for the position: `XAxisPick`, `ZAxisClear`.

## 10. Application-specific insertion points
Template code marks every spot an engineer must complete with `XIC(g_MachineBasic.AlwaysOff)` placeholders and `*Replace always off bits with real conditions` comments. Generated code follows the same idiom — a generated program is a **starting point a CE reviews and completes**, never a black box.

---

# Questions for the Controls Leads
*The agent generates from the templates above. These are the gaps it can't resolve from the files alone.*

1. **Jason's finding first**: he saw an action commanded in the wrong state (Z move in the gripper-close state) in the generated PnP. Which rung exactly? The agent's self-checks compare code against the diagram — this case becomes a permanent automated check.
2. What's the **acceptance test** for generated code — what makes you trust it enough to run on a machine, beyond importing clean?
3. **Wideband policy**: which transitions may early-advance, in one rule? (Current guess: only when the next motion can't collide with the settling axis.)
4. **Manual servo speeds**: manual/jog rungs read `Accel[0]/Decel[0]` (shared with auto) in the template. Intentional, or should manual have its own indices?
5. **Init-with-part**: templates re-enter mid-sequence when a part is already gripped at power-up (124 + GripperClosed). What's the general rule for choosing the re-entry state on any new station?
6. **Fault vs warning**: the rule for which conditions fault (stop) vs warn (`q_Pause`)? "Waiting for upstream" = warning — what else?
7. **`q_ActuatorsSafe`**: the precise definition per station type. All actuators home? Or a defined safe subset per application?
8. **Homing**: when torque-home (`AOI_TorqueHome`) vs `MAH`? Who decides, and what marks a station as needing homing before auto?
9. **HMI_Toggle vs Tracking OpStatus**: V4.2 sources Lockout/DryRun/SS from `\Tracking...OpStatus`. Is HMI_Toggle officially dead in new programs?
10. **Where should the agent ask vs. decide?** Before generating, it asks a short list (devices, transitions, timeouts, handshakes). What must ALWAYS be asked, and what may it default?

**Also requested**: export the context programs (Supervisor, Alarms, Tracking, Recipe, MainTask) as L5X to the same template folder — station templates reference them, but the agent hasn't seen their contents.
