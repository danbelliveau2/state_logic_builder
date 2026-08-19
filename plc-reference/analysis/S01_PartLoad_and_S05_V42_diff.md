# SDC Standard Template Analysis — S01_PartLoad (Pneumatic PNP) + S05_ServoPNP V4.2 Diff

> Source files:
> - `C:\SDC-StateLogic\plc-reference\standard\S01_PartLoad.L5X` (export 2026-08-18, SoftwareRevision 37.00, controller context `SoftwareStandardization`)
> - `C:\SDC-StateLogic\plc-reference\standard\S05_ServoPNP.L5X` (NEW, V4.2, export 2026-08-18)
> - `C:\SDC-StateLogic\SDC_PNP_Test\S05_ServoPNP.L5X` (OLD, export 2026-04-23)
>
> All rung text quoted verbatim from the L5X `<Text>` CDATA.

---

# SECTION 1 — S01_PartLoad: Two-Axis Pneumatic PNP with Gripper

## 1.1 Program & Routines

Program: `S01_PartLoad` (Target, MainRoutineName `R00_Main`). Context programs referenced: `Alarms`, `HMI`, `S00_IndexerSP`, `Supervisor`, `Tracking`.

| Routine | Type | Rungs |
|---|---|---|
| R00_Main | RLL | 4 (JSR calls) |
| R01_Inputs | RLL | 22 (rungs 0–21) |
| R02_StateTransitions | RLL | 24 (rungs 0–23) |
| R03_StateLogic | RLL | 16 (rungs 0–15) |
| R20_Alarms | RLL | 8 (rungs 0–7) |

R00_Main calls in order: `JSR(R01_Inputs,0)` → `JSR(R02_StateTransitions,0)` → `JSR(R03_StateLogic,0)` → `JSR(R20_Alarms,0)`. (No R04/R05 — no servos in the pneumatic template.)

## 1.2 Program Tags by Category

**Alarm infrastructure**
- `Alarm` — AlarmData[10]; `AlarmList` — STRING[10] (message bodies, station prefix concatenated at runtime)
- `AlarmTimerXAxisExtended`, `AlarmTimerXAxisRetracted`, `AlarmTimerXAxisMisconfigured`, `AlarmTimerZAxisExtended`, `AlarmTimerZAxisRetracted` — TIMER (PRE = 3000 for motion timeouts, 50 for Misconfigured)
- `ProgramFaultHandler` — ProgramAlarmHandler (AOI backing tag)
- `q_AlarmActive`, `q_WarningActive` — BOOL

**State engine**
- `Control` — StateLogicControl; `Status` — StateLogicStatus; `StateEngine` — State_Engine_128Max; `StateHistory` — SINT
- `FaultState`, `RestartState`, `SafetyStopState` — DINT; `UseRestartLogic` — BOOL; `ONS` — DINT (one-shot bit bank)

**Physical inputs (`i_`)**
- `i_PartPresent`, `i_XAxisExtended`, `i_XAxisRetracted`, `i_ZAxisRetracted` — BOOL
  (NOTE: Z axis has only ONE sensor — retracted. X axis has two. Gripper has NONE.)

**Solenoid outputs (`q_`)**
- `q_ExtendXAxis`, `q_RetractXAxis`, `q_ExtendZAxis`, `q_RetractZAxis`, `q_CloseGripper`, `q_OpenGripper` — BOOL

**Derived/conditioned position bits + delay timers**
- `XAxisExtended`, `XAxisRetracted`, `ZAxisExtended`, `ZAxisRetracted` — BOOL
- `ZAxisExtendedDelay` — TIMER (PRE=150; needed because Z has no extended sensor)
- `GripperOpened`, `GripperClosed` — BOOL; `OpenGripperDelay`, `CloseGripperDelay` — TIMER (PRE=100 each; gripper is sensorless)
- `PartPresentDebounce` — AOI_Debounce (100/100 ms)

**Supervisor / mode interface**
- `ManualMode`, `SafetyOK`, `FaultReset`, `CycleRunning`, `CycleStopping`, `CycleStopped`, `HMI_LocalManualOverride` — BOOL
- `Lockout`, `DryRun`, `SS`, `SS_OK`, `LocalSSONS` — BOOL
- `q_AutoMode`, `q_AutoStopped`, `q_StartOK`, `q_ActuatorsSafe`, `q_Pause`, `q_StationComplete` — BOOL (outputs to Supervisor/Indexer)
- `HMI_Momentary` — DINT (manual push-buttons, auto-cleared), `HMI_MomentaryOnPrevScan` — BOOL

**Part tracking / station**
- `StaNum`, `StaNumPre`, `NestNumCurrent`, `NestNumIncoming` — DINT
- `CycleStationA`, `CycleStationB`, `PartStarted`, `Initialized` — BOOL
- `StationPerformance` — StationPerformance (AOI backing tag)
- `CycleTimer` — TIMER (PRE=1000000, RTO), `p_CycleTime` — REAL
- `OkManExtendX`, `OkManRetractX` — BOOL (manual-mode interlock helpers)

## 1.3 AOIs / UDTs Used

| Definition | Kind | Revision |
|---|---|---|
| `AOI_Debounce` | AOI | 1.0 |
| `ProgramAlarmHandler` | AOI | 3.0a (edited 2026-05-29) |
| `State_Engine_128Max` | AOI | 5.0 (edited 2025-08-25) |
| `StationPerformance` | AOI | 1.0 (created 2026-03-30) — ST logic: counts Attempts/Successes on rising edges, `Failures := Attempts - Successes`, `Efficiency := (Successes*10000/Attempts)/100`, HMIColorStatus 3/2/1 vs PerformLow/PerformHigh |
| `AlarmData`, `CPU_TimeDate`, `MachineBasic`, `StateLogicControl`, `StateLogicStatus`, `STRING100` | UDT | — |

Controller-scope context tags referenced: `g_CPUDateTime`, `g_MachineBasic` (`.AlwaysOn`/`.AlwaysOff`/`.PowerUpCP`), `g_StationList` (STRING[21] station-name prefixes), `g_PresetStationPerformLow` (75.0), `g_PresetStationPerformHigh` (95.0).

## 1.4 Full State Map (from `Status.STATE[n]` comments + R02 rung comments)

| State | Meaning |
|---|---|
| 0 | Emergency Stop (Safety Stop) |
| 1 | Manual Mode |
| 2 | Auto Mode Idle Not Ready |
| 3 | Auto Mode Idle Ready |
| 4 | Start Of Sequence, Wait For Part Present |
| 7 | Extend Z Axis (pick) |
| 10 | Close Gripper |
| 13 | Retract Z Axis |
| 16 | Extend X Axis |
| 19 | Wait For Index Complete |
| 22 | Extend Z Axis (place) |
| 25 | Open Gripper |
| 28 | Retract Z Axis |
| 31 | Retract X Axis |
| 50 | Cycle Complete |
| 99 | Lockout |
| 100 | Initialization Retract Z Axis |
| 103 | Initialization Retract X Axis (empty return) |
| 106 | Initialization Extend X Axis (carrying part) |
| 124 | Initialization Complete |
| 127 | Faulted |

Note the base pattern: sequence steps at 4, 7, 10, ... (+3 per state). States 0–3 are mode states (E-stop / Manual / Idle NotReady / Idle Ready), NOT part of the +3 chain. 50 = cycle complete, 99 = lockout, 100–124 init, 127 = faulted.

### R02_StateTransitions — every rung verbatim

Rung 0 (`Start Of State Machine`): `NOP();`

Rung 1 — **State 2: Auto mode idle not ready** (funnel state, entered from E-stop/manual/lockout/fault recovery or loss of Initialized):
```
[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[99]) XIO(CycleRunning) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);
```

Rung 2 — **State 3: Auto mode idle ready**:
```
[[XIC(Status.State[2]) ,XIC(CycleStopped) ] XIC(Initialized) ,[XIC(Status.State[4]) ,XIC(Status.State[19]) ,XIC(Status.State[31]) XIC(XAxisRetracted) ,XIC(Status.State[124]) ] XIO(CycleRunning) ]MOVE(3,Control.StateReg);
```

Rung 3 — **State 4: Start of sequence, wait for part present**:
```
[[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[124]) ] XIC(GripperOpened) ,XIC(Status.State[31]) XIC(XAxisRetracted) ]XIC(CycleRunning)MOVE(4,Control.StateReg);
```

Rung 4 — **State 7: Extend z axis** (DryRun bypasses the sensor):
```
XIC(Status.State[4])[XIC(PartPresentDebounce.On) ,XIC(DryRun) ]XIC(SS_OK)MOVE(7,Control.StateReg);
```

Rung 5 — **State 10: Close gripper** (pneumatic move-complete = derived position bit):
```
XIC(Status.State[7])XIC(ZAxisExtended)XIC(SS_OK)MOVE(10,Control.StateReg);
```

Rung 6 — **State 13: Retract z axis** (also restart path from State 2 with part in gripper):
```
[XIC(Status.State[10]) ,XIC(Status.State[2]) XIO(Initialized) XIC(PartStarted) XIC(CycleRunning) ]XIC(GripperClosed)XIC(SS_OK)MOVE(13,Control.StateReg);
```

Rung 7 — **State 16: Extend x axis**:
```
XIC(Status.State[13])XIC(ZAxisRetracted)XIC(SS_OK)MOVE(16,Control.StateReg);
```

Rung 8 — **State 19: Wait for index complete**:
```
[[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[124]) ] XIC(GripperClosed) XIC(CycleRunning) ,XIC(Status.State[16]) XIC(XAxisExtended) ]MOVE(19,Control.StateReg);
```

Rung 9 — **State 22: Extend z axis** (place; latches part-tracking Attempt at the commit point):
```
XIC(Status.State[19])XIC(\S00_IndexerSP.q_WaitStationsComplete)XIC(CycleStationA)XIC(SS_OK)MOVE(22,Control.StateReg)OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt);
```

Rung 10 — **State 25: Open gripper**:
```
XIC(Status.State[22])XIC(ZAxisExtended)XIC(SS_OK)MOVE(25,Control.StateReg);
```

Rung 11 — **State 28: Retract z axis** (latches PartLoaded + Success when gripper confirms open):
```
XIC(Status.State[25])XIC(GripperOpened)XIC(SS_OK)MOVE(28,Control.StateReg)[OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.PartLoaded) ,OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Success) ];
```

Rung 12 — **State 31: Retract x axis**:
```
XIC(Status.State[28])XIC(ZAxisRetracted)XIC(SS_OK)MOVE(31,Control.StateReg);
```

Rung 13 — **State 99: Lockout**:
```
XIC(CycleRunning)XIC(Lockout)MOVE(99,Control.StateReg);
```

Rung 14 — **State 100: Start of initialization sequence, retract z axis**:
```
XIC(Status.State[2])XIO(Initialized)XIO(PartStarted)XIC(CycleRunning)XIC(SS_OK)MOVE(100,Control.StateReg);
```

Rung 15 — **State 103: Initialization retract x axis** (gripper open = empty):
```
XIC(Status.State[100])XIC(ZAxisRetracted)XIC(GripperOpened)XIC(SS_OK)MOVE(103,Control.StateReg);
```

Rung 16 — **State 106: Initialization extend x axis** (gripper closed = carrying part):
```
XIC(Status.State[100])XIC(ZAxisRetracted)XIC(GripperClosed)XIC(SS_OK)MOVE(106,Control.StateReg);
```

Rung 17 — **State 124: Initialization complete**:
```
[XIC(Status.State[103]) XIC(XAxisRetracted) ,XIC(Status.State[106]) XIC(XAxisExtended) ]MOVE(124,Control.StateReg);
```

Rung 18 — **Restart Logic** (engineer-authored, dormant behind AlwaysOff):
```
XIC(Status.State[2])XIC(UseRestartLogic)XIC(CycleRunning)XIC(g_MachineBasic.AlwaysOff)MOVE(RestartState,FaultState);
```

Rung 19 — **State 127: Fault** (captures the faulted state once, then forces 127; LIMIT 4..99 = only capture while in the running sequence):
```
XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];
```

Rung 20 — **State 1: Manual Mode**: `XIC(ManualMode)MOVE(1,Control.StateReg);`

Rung 21 — **State 0: Safety Stop** (also first-scan; captures interrupted state):
```
[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];
```

Rung 22 — State engine AOI call: `State_Engine_128Max(StateEngine,Control,Status,StateHistory);`

Rung 23 — **Cycle Time**:
```
[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];
```

## 1.5 The Pneumatic Axis Pattern

### A. R01 — sensor conditioning ("Mapped/debounced inputs")

**Single-sensor axis (Z: only `i_ZAxisRetracted` exists).** Extended is INFERRED: sensor off + extend commanded + retract not commanded + settle delay (150 ms):
```
XIO(i_ZAxisRetracted)XIC(q_ExtendZAxis)XIO(q_RetractZAxis)TON(ZAxisExtendedDelay,?,?)XIC(ZAxisExtendedDelay.DN)OTE(ZAxisExtended);
```
Retracted uses the real sensor, still cross-checked against outputs (no delay):
```
XIC(i_ZAxisRetracted)XIC(q_RetractZAxis)XIO(q_ExtendZAxis)OTE(ZAxisRetracted);
```

**Two-sensor axis (X).** Each direction requires: its sensor ON, the opposite sensor OFF, its solenoid ON, the opposite solenoid OFF — no delay timer needed:
```
XIC(i_XAxisExtended)XIO(i_XAxisRetracted)XIC(q_ExtendXAxis)XIO(q_RetractXAxis)OTE(XAxisExtended);
XIC(i_XAxisRetracted)XIO(i_XAxisExtended)XIC(q_RetractXAxis)XIO(q_ExtendXAxis)OTE(XAxisRetracted);
```

**Digital sensor debounce (part present):**
```
AOI_Debounce(PartPresentDebounce,i_PartPresent,100,100);
```

**Sensorless gripper (2-solenoid): position = commanded output + fixed delay (100 ms):**
```
XIC(q_OpenGripper)XIO(q_CloseGripper)TON(OpenGripperDelay,?,?)XIC(OpenGripperDelay.DN)OTE(GripperOpened);
XIC(q_CloseGripper)XIO(q_OpenGripper)TON(CloseGripperDelay,?,?)XIC(CloseGripperDelay.DN)OTE(GripperClosed);
```

**Initialized (known-safe posture — Z up, and either empty@retract or carrying@extend):**
```
XIO(PartStarted)XIC(i_ZAxisRetracted)[XIC(GripperOpened) XIC(i_XAxisRetracted) XIO(i_XAxisExtended) ,XIC(GripperClosed) XIC(i_XAxisExtended) XIO(i_XAxisRetracted) ]OTE(Initialized);
```

### B. R03 — solenoid output pattern (state-driven seal-in, dual auto/manual)

Every actuator output follows one canonical shape: **(NOT manual: [set states, OR seal-in unless a clear state]) OR (manual: [HMI momentary set, OR seal-in unless opposite momentary])**. Outputs are OTE (not latched) — the seal-in branch keeps them on across states. X axis extend/retract verbatim:
```
[XIO(Status.State[1]) [XIC(Status.State[16]) ,XIC(Status.State[106]) ,XIC(q_ExtendXAxis) XIO(Status.State[31]) XIO(Status.State[103]) ] ,XIC(Status.State[1]) [XIC(OkManExtendX) ,XIC(q_ExtendXAxis) XIO(OkManRetractX) ] ]OTE(q_ExtendXAxis);
[XIO(Status.State[1]) [XIC(Status.State[31]) ,XIC(Status.State[103]) ,XIC(q_RetractXAxis) XIO(Status.State[16]) XIO(Status.State[106]) ] ,XIC(Status.State[1]) [XIC(OkManRetractX) ,XIC(q_RetractXAxis) XIO(OkManExtendX) ] ]OTE(q_RetractXAxis);
```
Manual X moves are interlocked on Z being up (`X Axis Control` rung):
```
XIC(Status.State[1])XIC(ZAxisRetracted)[XIC(HMI_Momentary.0) OTE(OkManExtendX) ,XIC(HMI_Momentary.1) OTE(OkManRetractX) ];
```
Z axis (manual moves interlocked on X being at a known position):
```
[XIO(Status.State[1]) [XIC(Status.State[7]) ,XIC(Status.State[22]) ,XIC(q_ExtendZAxis) XIO(Status.State[13]) XIO(Status.State[28]) XIO(Status.State[100]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.2) [XIC(XAxisExtended) ,XIC(XAxisRetracted) ] ,XIC(q_ExtendZAxis) XIO(HMI_Momentary.3) ] ]OTE(q_ExtendZAxis);
[XIO(Status.State[1]) [XIC(Status.State[13]) ,XIC(Status.State[28]) ,XIC(Status.State[100]) ,XIC(q_RetractZAxis) XIO(Status.State[7]) XIO(Status.State[22]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.3) ,XIC(q_RetractZAxis) [XIO(HMI_Momentary.2) ,XIO(XAxisExtended) ,XIO(XAxisRetracted) ] ] ]OTE(q_RetractZAxis);
```

### C. Pneumatic move state vs servo move state (R02/R03)

| Aspect | Pneumatic (S01) | Servo (S05) |
|---|---|---|
| R03 "move" action | OTE the solenoid via seal-in pattern (`q_ExtendZAxis` etc.) in R03_StateLogic itself | R03 has NO axis outputs; state bits gate MAM instructions in dedicated R04/R05_{axis}Servo routines |
| R02 move-complete condition | Derived position bit (sensor + output cross-check, optionally + delay), e.g. `XIC(ZAxisExtended)` | `XIC({Axis}_MAM.PC)` AND `XIC({Axis}{Pos}.InPos)` (position-window AOI), e.g. `XIC(Status.State[16])[XIC(XAxis_MAM.PC) XIC(XAxisExtend.InPos) ,XIC(XAxis_MAM.IP) XIC(XAxisExtend.InPosWide) ]` |
| Timeout supervision | Dedicated per-direction TON alarm timers (3000 ms) in R20 watching `q_ output ON & confirm OFF` | `MOVE(3000,Control.FaultTime)` per move state + `Status.TimeoutFlt` from State_Engine |
| Extra failure mode | "Sensors/Outputs Misconfigured" alarms (both solenoids or both sensors on) | Axis fault / not-homed / quickstop ServoAlarms |

## 1.6 Gripper Handling (sensorless variant shown)

This template's gripper has **no sensors** — `GripperOpened`/`GripperClosed` are inferred from commanded solenoids + 100 ms delay timers (rungs quoted in 1.5-A). All sequence transitions use the derived `GripperOpened`/`GripperClosed` bits, never raw timers. R03 gripper control follows the same seal-in shape as the axes:
```
[XIO(Status.State[1]) [XIC(Status.State[10]) ,XIC(q_CloseGripper) XIO(Status.State[25]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.4) ,XIC(q_CloseGripper) XIO(HMI_Momentary.5) ] ]OTE(q_CloseGripper);
[XIO(Status.State[1]) [XIC(Status.State[25]) ,XIC(q_OpenGripper) XIO(Status.State[10]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.5) ,XIC(q_OpenGripper) XIO(HMI_Momentary.4) ] ]OTE(q_OpenGripper);
```
If the gripper HAD sensors, the pattern would match the X-axis two-sensor conditioning instead (sensor + output cross-check, no delay). No gripper timeout alarms exist in this template (the delay IS the confirm).

## 1.7 Alarm Patterns & Control.FaultTime Usage

Two distinct alarm shapes in R20_Alarms:

**Shape 1 — state-engine timeout via Control.FaultTime** (used only for the wait-for-part state; severity 1 = warning, message built once via ONS + CONCAT of station prefix):
```
XIC(Status.State[4])MOVE(10000,Control.FaultTime)XIC(Status.TimeoutFlt)[OTE(Alarm[0].Active) ,ONS(ONS.5) MOVE(1,Alarm[0].Severity) CONCAT(g_StationList[StaNum],AlarmList[0],Alarm[0].Message) ];
```
This alarm also pauses the indexer (R03): `XIC(Alarm[0].Active)OTE(q_Pause);`

**Shape 2 — dedicated motion-watchdog TON (3000 ms), self-holding until FaultReset** (used for all pneumatic motions; note it watches output-vs-confirm mismatch continuously, independent of state):
```
XIO(Lockout)[XIC(q_ExtendXAxis) XIO(XAxisExtended) TON(AlarmTimerXAxisExtended,?,?) XIC(AlarmTimerXAxisExtended.DN) ,XIC(Alarm[1].Active) XIO(FaultReset) ][OTE(Alarm[1].Active) ,ONS(ONS.6) CONCAT(g_StationList[StaNum],AlarmList[1],Alarm[1].Message) ];
```
Same shape for X retract (Alarm[2]), Z extend (Alarm[4]), Z retract (Alarm[5]).

**Misconfiguration alarms (50 ms TON — both outputs on, or both sensors on):**
```
XIO(Lockout)[[XIC(q_RetractXAxis) XIC(q_ExtendXAxis) ,XIC(i_XAxisExtended) XIC(i_XAxisRetracted) ] TON(AlarmTimerXAxisMisconfigured,?,?) XIC(AlarmTimerXAxisMisconfigured.DN) ,XIC(Alarm[3].Active) XIO(FaultReset) ][OTE(Alarm[3].Active) ,ONS(ONS.8) CONCAT(g_StationList[StaNum],AlarmList[3],Alarm[3].Message) ];
```
Z misconfigured (Alarm[6]) checks only both-outputs (Z has one sensor). NOTE: the Z misconfigured rung reuses `AlarmTimerXAxisMisconfigured` — looks like a copy/paste artifact in the standard itself.

Handler call (last rung):
```
ProgramAlarmHandler(ProgramFaultHandler,\Alarms.p_ProgramID,Alarm,\Alarms.p_Active,\Alarms.p_History,g_CPUDateTime,q_AlarmActive,q_WarningActive);
```
Alarm messages: `Alarm` array pre-seeded with full "S01 Part Load: ..." strings; `AlarmList` holds the suffix-only strings and the runtime CONCAT prepends `g_StationList[StaNum]` — so the station prefix is data-driven.

Default severity is fault (blocks via `q_AlarmActive` → state 127); `MOVE(1,Alarm[n].Severity)` downgrades to warning (Alarm[0] only).

## 1.8 Engineer Placeholder Comments (verbatim)

R01_Inputs rung 8:
```
Logic inputs

*Replace always off bits with real conditions
```
R01_Inputs rung 16: `Dry run logic (can add supervisor dry run condition if needed as parallel branch)`

R02_StateTransitions rung 18:
```
Restart Logic

*Use the part status at this station to determine a course of action here. 
For instance, no attempt made, no part present, no success or failure status at this station indicates initialization is in order. If an attempt was made with no success or failure, restart at last state may be in order.
Also, you do not always need to go into the state you left. Some cases require you to go into the prior state to restart a particular portion of the sequence.
```
R02_StateTransitions rung 23:
```
Cycle Time

**Limit Instruction Low & High Limits Populated WIth Range Of States In Which Station Is Running (Example, PNP Is Picking & Placing A Part)
**Cycle Complete State Shown As Example
```
R03_StateLogic rung 0:
```
Output Status to Supervisor

*Replace always off with real conditions
```
R03_StateLogic rung 5:
```
Set the part started bit once the process gets to a point where if interrupted you want to resume or perform some other operation upon restart. Use states and/or part tracking to set this bit. Fill in additional conditions to clear this bit if necessary.
```

Other notable R01/R03 boilerplate rungs (Supervisor wiring, HMI momentary auto-clear, actuators-safe, station complete):
```
XIC(\Supervisor.q_ManualMode)XIO(HMI_LocalManualOverride)OTE(ManualMode);
XIC(\Supervisor.q_SafetyOK)OTE(SafetyOK);
XIC(\Supervisor.q_FaultReset)OTE(FaultReset);
XIC(\Supervisor.q_CycleStartLatch)OTE(CycleRunning);
XIO(\Supervisor.q_CycleStartLatch)OTE(CycleStopping);
XIC(\Supervisor.q_CycleStopped)ONS(ONS.0)XIO(Status.State[2])XIO(Status.State[3])OTE(CycleStopped);
XIC(\Tracking.p_Data.Station[StaNum].OpStatus.Lockout)XIO(ManualMode)OTE(Lockout);
XIC(\Tracking.p_Data.Station[StaNum].OpStatus.DryRun)OTE(DryRun);
XIC(\Tracking.p_Data.Station[StaNum].OpStatus.SingleStep)OTE(SS);
[XIO(SS) ,XIC(LocalSSONS) ONS(ONS.1) ]OTE(SS_OK);
XIC(HMI_MomentaryOnPrevScan)MOVE(0,HMI_Momentary);
NE(HMI_Momentary,0)OTE(HMI_MomentaryOnPrevScan);
[XIC(XAxisRetracted) ,XIC(ZAxisRetracted) ]OTE(q_ActuatorsSafe);
XIO(\Tracking.p_Data.Nest[NestNumCurrent].OpStatus.Lockout)XIO(\HMI.q_CleanoutModeEnabled)[XIO(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt) OTE(CycleStationA) ,OTE(CycleStationB) ];
XIC(\S00_IndexerSP.q_WaitStationsComplete)[XIC(CycleStationB) [XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Success) ,XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Failure) ,XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Lockout) ] ,XIO(CycleStationB) ]OTE(q_StationComplete);
XIC(\S00_IndexerSP.q_WaitStationsComplete)XIC(Status.State[99])XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.PartLoaded)OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Lockout);
XIC(g_MachineBasic.AlwaysOn)StationPerformance(StationPerformance,\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt,\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Success,g_PresetStationPerformLow,g_PresetStationPerformHigh,\Tracking.p_Data.Station[StaNum].PerformData.Attempts,\Tracking.p_Data.Station[StaNum].PerformData.Successes,\Tracking.p_Data.Station[StaNum].PerformData.Failures,\Tracking.p_Data.Station[StaNum].PerformData.Efficiency,\Tracking.p_Data.Station[StaNum].PerformData.HMIColorStatus);
```

---

# SECTION 2 — S05_ServoPNP V4.2 (NEW) vs Old Export: Semantic Diff

Direction convention below: **OLD** = `SDC_PNP_Test\S05_ServoPNP.L5X` (Apr 2026), **NEW** = `plc-reference\standard\S05_ServoPNP.L5X` (V4.2, Aug 2026). State map is UNCHANGED (identical to S01's table plus "Extend Z Axis To Pick/Place Position" wording). Routine list unchanged (R00, R01, R02, R03, R04_XAxisServo, R05_ZAxisServo, R20).

## 2.1 New tags (NEW only)

- `StaNum`, `StaNumPre`, `NestNumCurrent`, `NestNumIncoming` (DINT) — station/nest identity
- `CycleStationA`, `CycleStationB` (BOOL) — first-attempt vs re-cycle decision
- `GripperOpened`, `GripperClosed` (BOOL) — named gripper confirms (were raw `OpenGripperDelay.DN`/`CloseGripperDelay.DN` in OLD)
- `q_ActuatorsSafe`, `q_Pause`, `q_StationComplete` (BOOL) — indexer interface outputs
- `AlarmList` (STRING[10]), `ServoAlarmList` (STRING[…]) — suffix-only message bodies for runtime CONCAT
- `StationPerformance` (StationPerformance AOI backing tag)
- `ZAxisQuickstopMessageA`/`ZAxisQuickstopMessageB` replace single `ZAxisQuickstopMessage` (double CONCAT: station prefix + reason)
- Controller scope: `g_StationList` STRING[21], `g_PresetStationPerformLow`=75.0, `g_PresetStationPerformHigh`=95.0 (constants)

**Removed tag:** `HMI_Toggle` (DINT) — Lockout/DryRun/SS no longer come from an HMI toggle word.

## 2.2 New/changed AOIs

- **StationPerformance 1.0 added** (NEW only) — attempts/successes/failures/efficiency/HMI color; called at end of R03.
- **ProgramAlarmHandler 3.0a logic fix**: timestamp copy changed
  OLD: `COP(ControllerTimeClockTag, LocalAlarmsArrayTag[DataIndex].TimeStamp, 1);`
  NEW: `COP(ControllerTimeClockTag.UTCMicroseconds, LocalAlarmsArrayTag[DataIndex].TimeStamp, 1);`

## 2.3 R01_Inputs changes

**Added Nest & Station Numbers rung (NEW, rung 0):**
```
[MOVE(5,StaNum) MOVE(4,StaNumPre) ,MOVE(\Tracking.p_Data.Station[StaNum].NestNum,NestNumCurrent) MOVE(\Tracking.p_Data.Station[StaNumPre].NestNum,NestNumIncoming) ];
```
**Gripper confirms now named bits** (matches S01 pattern):
OLD: `XIC(q_OpenGripper)XIO(q_CloseGripper)TON(OpenGripperDelay,?,?);`
NEW: `XIC(q_OpenGripper)XIO(q_CloseGripper)TON(OpenGripperDelay,?,?)XIC(OpenGripperDelay.DN)OTE(GripperOpened);` (same for Close/GripperClosed). All downstream uses of `OpenGripperDelay.DN`/`CloseGripperDelay.DN` in R01/R02/R03 replaced by `GripperOpened`/`GripperClosed`.

**Lockout/DryRun/SS source moved from HMI toggle word to part-tracking OpStatus:**
OLD:
```
XIC(HMI_Toggle.0)OTE(Lockout);
XIC(HMI_Toggle.1)OTE(DryRun);
XIC(HMI_Toggle.2)OTE(SS);
```
NEW:
```
XIC(\Tracking.p_Data.Station[StaNum].OpStatus.Lockout)XIO(ManualMode)OTE(Lockout);
XIC(\Tracking.p_Data.Station[StaNum].OpStatus.DryRun)OTE(DryRun);
XIC(\Tracking.p_Data.Station[StaNum].OpStatus.SingleStep)OTE(SS);
```
**Added Cycle Station rung (NEW)** — PNP variant keys off upstream station success on the INCOMING nest (different from S01's nest-lockout/cleanout version):
```
[XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.PartLoaded) [XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNumPre].Success) ,XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNumPre].Lockout) ] ,XIC(DryRun) ][XIO(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt) OTE(CycleStationA) ,OTE(CycleStationB) ];
```

## 2.4 R02_StateTransitions changes

**State 22 transition no longer a placeholder — now wired to indexer + part tracking (the big one):**
OLD: `XIC(Status.State[19])[XIC(g_MachineBasic.AlwaysOff) ,XIC(DryRun) ]XIC(g_MachineBasic.AlwaysOff)XIC(SS_OK)MOVE(22,Control.StateReg);`
NEW: `XIC(Status.State[19])XIC(\S00_IndexerSP.q_WaitStationsComplete)XIC(CycleStationA)XIC(SS_OK)MOVE(22,Control.StateReg)OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Attempt);`

**State 28 now latches Success:**
OLD: `XIC(Status.State[25])XIC(OpenGripperDelay.DN)XIC(SS_OK)MOVE(28,Control.StateReg);`
NEW: `XIC(Status.State[25])XIC(GripperOpened)XIC(SS_OK)MOVE(28,Control.StateReg)OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Success);`

All other R02 differences are the `OpenGripperDelay.DN → GripperOpened` / `CloseGripperDelay.DN → GripperClosed` substitution (states 4, 13, 19, 103, 106).

## 2.5 R03_StateLogic changes

**Manual-mode gate fixed from State[4] to State[1] in the gripper output rungs** (OLD gated manual gripper on "wait for part present" — a bug; Manual Mode is State 1):
OLD: `[XIO(Status.State[4]) [XIC(Status.State[10]) ,XIC(q_CloseGripper) XIO(Status.State[25]) ] ,XIC(Status.State[4]) [XIC(HMI_Momentary.0) ,...`
NEW: `[XIO(Status.State[1]) [XIC(Status.State[10]) ,XIC(q_CloseGripper) XIO(Status.State[25]) ] ,XIC(Status.State[1]) [XIC(HMI_Momentary.0) ,XIC(q_CloseGripper) XIO(HMI_Momentary.1) ] ]OTE(q_CloseGripper);`

**Added rungs (NEW):**
- Actuators Safe For Index (servo version — homed + retract InPos + not at any work position):
```
[XIC(iq_XAxis.AxisHomedStatus) XIC(XAxisRetract.InPos) XIO(XAxisExtend.InPos) ,XIC(iq_ZAxis.AxisHomedStatus) XIC(ZAxisRetract.InPos) XIO(ZAxisPick.InPos) XIO(ZAxisPlace.InPos) ]OTE(q_ActuatorsSafe);
```
- Pause Request To Indexer: `XIC(Alarm[5].Active)OTE(q_Pause);`
- Set Part Tracking If Station Is Locked Out: `XIC(\S00_IndexerSP.q_WaitStationsComplete)XIC(Status.State[99])XIC(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.PartLoaded)OTL(\Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[StaNum].Lockout);`
- Station Complete (identical shape to S01's, quoted in §1.8)
- StationPerformance AOI call (identical shape to S01's, quoted in §1.8)

## 2.6 R04/R05 Servo routine changes (identical edits per axis)

**MAS quickstop now uses real decel instead of "% of Maximum":**
OLD: `...MAS(iq_XAxis,XAxis_MAS_All,All,Yes,90,% of Maximum,Yes,90,% of Maximum);`
NEW: `...MAS(iq_XAxis,XAxis_MAS_All,All,Yes,HMI_XAxis.Status.MaxDecel,Units per sec2,Yes,10,% of Time);`

**Max accel/decel now CALCULATED from max speed instead of GSV'd from the drive.** New rung comment: "Retrieve the maximum speed value from the axis and calculate max accel and decel.  The max velocity is 85% of full speed.  Equation is based upon 100% speed at a 30ms accel/decel time." (OLD comment: "Retrieve the max values from the drive and adjust them for your application if necessary with math instructions")
OLD: `XIC(S:FS)GSV(Axis,iq_XAxis,MaximumAcceleration,HMI_XAxis.Status.MaxAccel)GSV(Axis,iq_XAxis,MaximumDeceleration,HMI_XAxis.Status.MaxDecel)GSV(Axis,iq_XAxis,MaximumSpeed,HMI_XAxis.Status.MaxVelocity);`
NEW: `XIC(S:FS)GSV(Axis,iq_XAxis,MaximumSpeed,HMI_XAxis.Status.MaxVelocity)CPT(HMI_XAxis.Status.MaxAccel,(HMI_XAxis.Status.MaxVelocity/0.85)/0.03)MOVE(HMI_XAxis.Status.MaxAccel,HMI_XAxis.Status.MaxDecel);`

**Manual move parameters now include Accel/Decel** (NEW adds the two extra MOVEs into MotionParameters):
NEW: `XIC(SafetyOK)XIC(Status.State[1])[[MOVE(HMI_XAxis.Parameters.ManualSpeed,XAxisMotionParameters.Speed) ,MOVE(HMI_XAxis.Parameters.Accel[0],XAxisMotionParameters.Accel) ,MOVE(HMI_XAxis.Parameters.Decel[0],XAxisMotionParameters.Decel) ] ,XIC(XAxisPermissive) [...] OTE(XAxisManMoveTrig) ];`

**Inch MAM rung condition order rearranged** (inch selection branch moved before the permissive contacts; logic-equivalent, cosmetic).

## 2.7 R20_Alarms changes

**Every alarm now builds its message at runtime with a station prefix** (`CONCAT(g_StationList[StaNum], AlarmList[n]/ServoAlarmList[n], Alarm.Message)` + ONS), matching S01. Examples:
OLD: `XIO(Lockout)XIC(g_MachineBasic.PowerUpCP)XIO(iq_XAxis.AxisHomedStatus)OTE(ServoAlarm[1].Active);`
NEW: `XIO(Lockout)XIC(g_MachineBasic.PowerUpCP)XIO(iq_XAxis.AxisHomedStatus)[OTE(ServoAlarm[1].Active) ,ONS(ONS.6) CONCAT(g_StationList[StaNum],ServoAlarmList[1],ServoAlarm[1].Message) ];`

Axis-fault alarms now double-CONCAT (prefix + fault code):
NEW: `XIO(Lockout)NE(iq_XAxis.AxisFault,0)[OTE(ServoAlarm[0].Active) ,ONS(ONS.5) DTOS(iq_XAxis.AxisFault,XAxisFault) CONCAT(g_StationList[StaNum],ServoAlarmList[0],XAxisFaultMessage) CONCAT(XAxisFaultMessage,XAxisFault,ServoAlarm[0].Message) ];`

Quickstop alarm likewise uses the A/B message pair:
NEW: `[XIC(XAxis_MAS_All.EN) ONS(ONS.29) ,XIC(ServoAlarm[4].Active) XIO(FaultReset) ][OTE(ServoAlarm[4].Active) ,XIO(ZAxisRetract.InPos) XIO(ZAxisRetract.InPosWide) CONCAT(g_StationList[StaNum],ZAxisQuickstopMessageA,ZAxisQuickstopMessageB) CONCAT(ZAxisQuickstopMessageB,ZAxisQuickstopReason,ServoAlarm[4].Message) ,MOVE(1,ServoAlarm[4].Severity) ];`

**New Alarm[5] added — "Waiting For Part Present"** (10 s Control.FaultTime, severity 1, drives q_Pause):
```
XIC(Status.State[4])MOVE(10000,Control.FaultTime)XIC(Status.TimeoutFlt)[OTE(Alarm[5].Active) ,ONS(ONS.14) MOVE(1,Alarm[5].Severity) CONCAT(g_StationList[StaNum],AlarmList[5],Alarm[5].Message) ];
```
Existing move-state timeout alarms keep `MOVE(3000,Control.FaultTime)` + `Status.TimeoutFlt` per state group (states 16/106 → Alarm[0], 31/103 → Alarm[1], 7 → Alarm[2], 22 → Alarm[3], 13/28/100 → Alarm[4]); each gained the ONS+CONCAT message build. ONS bit indices renumbered (5–14 vs old 29–31).

## 2.8 Axis configuration (AXIS_CIP_DRIVE) changes

- Axis tags renumbered: `a02_S01PNPXAxis`/`a03_S01PNPZAxis` → **`a03_S01PNPXAxis`/`a04_S01PNPZAxis`** (motion modules `sd03_`/`sd04_`; ParameterConnections updated to match).
- `ApplicationType`: `Custom` → **`Point-to-Point`**
- `TorqueLowPassFilterBandwidth`: `0.0` → **`1571.344`**
- `GainTuningConfigurationBits`: `16#0013` → **`16#0113`**
- (Dependency context) `Tracking` program with `p_Data` reference added to NEW's context section.

## 2.9 Summary of intent

V4.2 brings S05_ServoPNP into line with the S01 station framework: part-tracking-driven Lockout/DryRun/SS (HMI_Toggle removed), StaNum/NestNum plumbing, CycleStationA/B first-attempt logic, Attempt/Success/Lockout latching at the same sequence points as S01 (state 22 = Attempt, state 28 = Success), indexer interface outputs (q_ActuatorsSafe/q_Pause/q_StationComplete), StationPerformance metrics, station-prefixed runtime alarm messages, plus servo-specific improvements (computed max accel/decel at 85%/30 ms rule, real-units MAS quickstop, manual accel/decel params) and a fixed manual-mode gate (State[1], not State[4]) on gripper outputs.
