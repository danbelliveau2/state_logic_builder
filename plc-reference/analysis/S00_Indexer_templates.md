# SDC Standard Template Analysis — S00 Indexer Programs

Source files:
- `C:\SDC-StateLogic\plc-reference\standard\S00_IndexerNoSP.L5X` — servo indexing ring **without** shot pin (5,103 lines)
- `C:\SDC-StateLogic\plc-reference\standard\S00_IndexerSP.L5X` — servo indexing ring **with** servo shot pin (6,060 lines)

Both are `Use="Target"` Program exports (`MainRoutineName="R00_Main"`) with controller context (DataTypes, AOIs, controller tags, sibling-program references, ParameterConnections). The dial position is expressed in **nests** (1.0 = one station pitch); "on station" means the fractional part of `iq_IndexerAxis.ActualPosition` is within `OnStationTolNests` (constant, default `0.001`) of an integer.

---

## 1. Program / Routine Inventory

### S00_IndexerNoSP
| Routine | Type | Rungs/Lines | Purpose |
|---|---|---|---|
| R00_Main | RLL | 6 | JSR chain: R01→R02→R03→R04→R10→R20 |
| R01_Inputs | RLL | 16 | Station #, on-station calc, stations-complete, actuators-safe, pause, Supervisor input mapping, single-step, HMI momentary clear |
| R02_StateTransitions | RLL | 20 | State transition MOVEs into `Control.StateReg` + `State_Engine_128Max` call + cycle-time capture |
| R03_StateLogic | RLL | 12 | Outputs to Supervisor (`q_*`) + per-station cycle-time recording |
| R04_IndexerServo | RLL | 21 | Full servo axis block for indexer (MSO/MSF/MAFR/MASR/MAJ/MAS/Inch/MAH/TorqueHome/MAM/GSV) |
| R10_CalcDialStationNestNums | ST | 14 lines | Computes `NestNum` for every station in `\Tracking.p_Data` from dial position |
| R20_Alarms | RLL | 15 | Servo alarms + station alarms + 2× ProgramAlarmHandler + q_AlarmActive/q_WarningActive |

### S00_IndexerSP
| Routine | Type | Rungs/Lines | Purpose |
|---|---|---|---|
| R00_Main | RLL | 7 | Same JSR chain **plus `JSR(R05_ShotPinServo,0)`** between R04 and R10 |
| R01_Inputs | RLL | 18 | Adds shot-pin debounced input rung + `ShotPinSafe` rung; `Initialized` also requires pin extended |
| R02_StateTransitions | RLL | 22 | Adds State 7 (Retract Shot Pin) and State 19 (Extend Shot Pin) |
| R03_StateLogic | RLL | 12 | Same, but `q_StartOK` also requires shot pin axis enabled + homed |
| R04_IndexerServo | RLL | 21 | **Byte-identical rung text to NoSP R04** (verified by diff) |
| R05_ShotPinServo | RLL | 22 | Full servo axis block for shot pin + AOI_RangeCheck position monitors |
| R10_CalcDialStationNestNums | ST | 14 lines | Identical to NoSP |
| R20_Alarms | RLL | 17 | Adds shot-pin servo alarms (ServoAlarm[2],[3]) and Alarm[0]/Alarm[4] pin timeout alarms |

---

## 2. Program-Scope Tags by Category

### Common to both files

**State engine / control-status**
- `Control : StateLogicControl` (`StateReg`, `EnaFaultDetect`, `EnaTransitionTimer`, `FaultTime`, `TransitionTime`)
- `Status : StateLogicStatus` (`State[128?] BOOL`, `PreviousState`, `StateChangeOccurred_OS`, `TimeoutFlt`, `TransitionTimerDone`)
- `StateEngine : State_Engine_128Max`, `StateHistory : SINT[10]`
- `FaultState`, `RestartState`, `SafetyStopState : DINT` — snapshot of state at fault/safety-stop
- `Initialized`, `ManualMode`, `SafetyOK`, `FaultReset`, `CycleRunning`, `CycleStopping`, `CycleStopped`, `Pause`, `PauseReason : DINT`, `StationsComplete`, `SS`, `SS_OK`, `LocalSSONS`, `ONS : DINT` (bit pool)

**Supervisor-facing outputs (q_) and published (p_)**
- `q_StartOK`, `q_AutoMode`, `q_AutoStopped`, `q_WaitStationsComplete`, `q_Paused`, `q_PauseRestart`, `q_AlarmActive`, `q_WarningActive`
- `p_OnStation` (dial on station), `p_CycleTime : REAL`

**Inputs (i_)**
- `i_EmptyNest : BOOL` — "Last Station Nest Is Empty" (checked before index)

**Timers**
- `StationsCompleteDelay`, `State34Delay`, `State40Delay`, `CycleTimer` (RTO), `IndexerAxisEnableDelay`, `IndexerAxisHomeConfirmDelay`

**Indexer servo/motion**
- `iq_IndexerAxis : AXIS_CIP_DRIVE` (InOut, ParameterConnection to controller `a01_Indexer`)
- `HMI_IndexerAxis : ServoOverall` (Control/Status/Parameters incl. `Positions[]`, `AutoSpeed[]`, `Accel[]`, `Decel[]`, `JogSpeed`, `ManualSpeed`, `InchAmount`, `TorquePos/Neg`)
- `IndexerAxis_MSO/_MSF/_MAFR/_MASR/_MAJ/_MAS_Jog/_MAS_All/_Inch/_MAH/_MAM : MOTION_INSTRUCTION`
- `IndexerAxisReady`, `IndexerAxisPermissive`, `IndexerAxisAutoEnable`, `IndexerAxisHomeRequested`, `IndexerAxisHomeConfimed` *(sic)*, `IndexerAxisHomeSelect`, `IndexerAxisManMoveTrig`, `IndexerAxisJogDirection`, `IndexerAxisInchAmount`, `IndexerAxisMotionParameters : MAMParam`, `IndexerAxisONS : DINT`, `IndexerAxisTorqueHome : AOI_TorqueHome`, `IndexerAxisFault/FaultMessage : STRING`

**Dial math**
- `DialPosRmndr : REAL`, `OnStationTolNests : REAL` (Constant), `OnStaTol1Minus : REAL`, `NewNestNum : DINT`, `StationNum : INT`, `StaNum : DINT`, `NestsShiftedPulse : BOOL`

**Alarms**
- `Alarm : AlarmData[10]`, `AlarmList : STRING[10]`, `AlarmActive`, `WarningActive`, `ProgramFaultHandler : ProgramAlarmHandler`
- `ServoAlarm : AlarmData[6]`, `ServoAlarmList : STRING[6]`, `ServoAlarmActive`, `ServoWarningActive`, `ServoFaultHandler : ProgramAlarmHandler`
- `ActuatorsSafe`, `ActuatorsSafeList : STRING[10]` (`'Shot Pin','Station 1','Station 3','Station 4','Station 5','Station 18','Station 19'`), `ActuatorsSafeMessageA : STRING`

**HMI / misc**
- `HMI_LocalManualOverride`, `HMI_Momentary : DINT`, `HMI_MomentaryOnPrevScan`
- `MovingAverageA/B : MovingAverage` (25- and 100-cycle averages of `p_CycleTime`)
- `StationCompleteTimes : REAL[21]` — per-station elapsed time at station-complete

### SP-only additional tags
- `iq_ShotPinAxis : AXIS_CIP_DRIVE` (ParameterConnection to controller `a02_ShotPin`)
- `HMI_ShotPinAxis : ServoOverall`
- Complete second motion-instruction family: `ShotPinAxis_MSO/_MSF/_MAFR/_MASR/_MAJ/_MAS_Jog/_MAS_All/_Inch/_MAH/_MAM`
- `ShotPinAxisReady/Permissive/AutoEnable/EnableDelay/HomeRequested/HomeConfimed/HomeConfirmDelay/HomeSelect/ManMoveTrig/JogDirection/InchAmount/MotionParameters/ONS/TorqueHome/Fault/FaultMessage`
- `ShotPinAxisExtend : AOI_RangeCheck`, `ShotPinAxisRetract : AOI_RangeCheck` — servo-position window monitors
- `i_ShotPinRetracted : BOOL` — "Shot Pin Is Retracted" physical sensor
- `ShotPinExtended : BOOL` + `ShotPinExtendedDelay : TIMER` — debounced inverse of the retracted sensor
- `ShotPinSafe : BOOL`

---

## 3. AOIs and UDTs

**UDTs (both files):** `AlarmData` (ProgramID, AlarmID, Severity, Group, Message:STRING100, TimeStamp, Count, Duration, Active, DoNotSaveToHistory, HMI_ResetCount), `CPU_TimeDate`, `MachineBasic`, `MAMParam` (MoveType, Position, Speed, Accel, Decel), `ServoMomentary`, `ServoOverall`, `ServoParameters`, `ServoStatus`, `StateLogicControl`, `StateLogicStatus`, `STRING100`.

**AOIs:**
| AOI | NoSP | SP | Use |
|---|---|---|---|
| `State_Engine_128Max` (rev 5.0) | yes | yes | State engine — consumes `Control.StateReg`, drives `Status.State[n]` bits, transition timer, timeout fault |
| `ProgramAlarmHandler` (rev 3.0a) | yes ×2 | yes ×2 | One instance for ServoAlarm[], one for Alarm[] |
| `AOI_TorqueHome` (rev 1.0) | yes | yes | Home-to-hard-stop by torque |
| `MovingAverage` (rev 1.0) | yes ×2 | yes ×2 | Cycle-time averaging (25 / 100 cycles) |
| `AOI_RangeCheck` (rev 0.1) | — | **yes** | Shot-pin servo position window (`InPos` output) |

---

## 4. State Map

State numbering here is **not** the flowchart-station 1/4/7 scheme — the indexer program is a hand-built supervisor-style machine. States used (`Status.State[n]`):

### Shared states (both files)
| State | Meaning (verbatim rung comment) | Entered from |
|---|---|---|
| 0 | `State 0: Safety Stop` | Any state when `XIO(SafetyOK)` or first scan `S:FS`; snapshots `SafetyStopState`/`RestartState` via `LIMIT(4,Control.StateReg,98/99)` |
| 1 | `State 1: Manual Mode` | Any state when `ManualMode` |
| 2 | `State 2: Auto mode idle not ready` | 0+SafetyOK, 1+!ManualMode, 3/CycleStopped+!Initialized, 127+!q_AlarmActive |
| 3 | `State 3: Auto mode idle ready` | 2/CycleStopped+Initialized, or 4/40/42+!CycleRunning |
| 4 | `State 4: Wait For All Stations Complete` | 3+Initialized+CycleRunning, 22 (cycle loop), 42 after 2000 ms transition timer |
| 10 | `State 10: Check Actuators In Safe Position` | (NoSP: from 4+StationsComplete or 2-recovery; SP: from 7 after pin retracted) |
| 13 | `State 13: Trigger Index` | 10+ActuatorsSafe or 37 (restart), gated by `i_EmptyNest` OR already off-station, `SS_OK` |
| 16 | `State 16: Wait For Index Complete` | 13 + `IndexerAxis_MAM.IP` + off station |
| 22 | `State 22: Index Complete` | (NoSP: 16+`MAM.PC`+on-station; SP: 19 after pin extended) — loops back to 4 |
| 31 | `State 31: Actuators NOT Safe During Index - Wait For Indexer Motion Stop` | 13 or 16 when `XIO(ActuatorsSafe)` |
| 34 | `State 34: Check If Actuators Safe After Stop` | 31 + `MAS_All.PC` + not moving |
| 37 | `State 37: Restart Ok` | 34 + ActuatorsSafe + State34Delay.DN → re-enters 13 |
| 40 | `State 40: Paused` | 4 + !StationsComplete + Pause |
| 42 | `State 42: Pause Restart` | 40 + !Pause + State40Delay.DN → back to 4 after 2000 ms |
| 127 | `State 127: Fault` | `q_AlarmActive`; snapshots `FaultState`/`RestartState` |

### SP-only states
| State | Meaning | Notes |
|---|---|---|
| 7 | `State 7: Retract Shot Pin` | Replaces NoSP's direct 4→10 edge; commands shot-pin servo to retract position |
| 19 | `State 19: Extend Shot Pin` | Replaces NoSP's direct 16→22 edge; commands shot-pin servo to extend position |

**Sequence flow, NoSP:** `... 3 → 4 (wait stations) → 10 (check safe) → 13 (trigger index) → 16 (index in process) → 22 (complete) → 4 ...`
**Sequence flow, SP:** `... 3 → 4 → 7 (retract pin) → 10 → 13 → 16 → 19 (extend pin) → 22 → 4 ...`
**Interrupt flows (both):** unsafe-during-index `13/16 → 31 → 34 → 37 → 13`; pause `4 → 40 → 42 → 4`; fault `any → 127 → 2`; safety `any → 0 → 2`; manual `any → 1 → 2`.

### Key transition rungs verbatim (SP, superset)

State 2 (idle not ready — the universal recovery hub):
```
[XIC(Status.State[0]) XIC(SafetyOK) ,XIC(Status.State[1]) XIO(ManualMode) ,[XIC(Status.State[3]) ,XIC(CycleStopped) ] XIO(Initialized) ,XIC(Status.State[127]) XIO(q_AlarmActive) ]MOVE(2,Control.StateReg);
```

State 4 (wait for all stations complete — note 2000 ms transition timer from pause restart):
```
[XIC(Status.State[3]) XIC(Initialized) ,XIC(Status.State[22]) ,XIC(Status.State[42]) MOVE(2000,Control.TransitionTime) XIC(Status.TransitionTimerDone) ]XIC(CycleRunning)MOVE(4,Control.StateReg);
```

State 13 (trigger index — empty-nest OR off-station gate):
```
[XIC(Status.State[10]) XIC(ActuatorsSafe) ,XIC(Status.State[37]) ][XIC(i_EmptyNest) ,XIO(p_OnStation) ]XIC(SS_OK)MOVE(13,Control.StateReg);
```

State 127 (fault — snapshot restartable state first, LIMIT keeps it within run range 4..99):
```
XIC(q_AlarmActive)[ONS(ONS.2) LIMIT(4,Control.StateReg,99) MOVE(Control.StateReg,FaultState) MOVE(Control.StateReg,RestartState) ,MOVE(127,Control.StateReg) ];
```

State 0 (safety stop — same snapshot pattern, limit 4..98):
```
[XIO(SafetyOK) ,XIC(S:FS) ][ONS(ONS.3) LIMIT(4,Control.StateReg,98) MOVE(Control.StateReg,SafetyStopState) MOVE(Control.StateReg,RestartState) ,MOVE(0,Control.StateReg) ];
```

State engine call + cycle time (last rungs of R02):
```
State_Engine_128Max(StateEngine,Control,Status,StateHistory);
[XIC(Status.State[4]) ONS(ONS.4) DIV(CycleTimer.ACC,1000,p_CycleTime) RES(CycleTimer) ,LIMIT(4,Control.StateReg,98) RTO(CycleTimer,?,?) ];
MovingAverage(MovingAverageA,p_CycleTime,25);
MovingAverage(MovingAverageB,p_CycleTime,100);
```

---

## 5. Indexer Device Pattern

### On-station detection (R01)
Dial position modulo 1.0 nest; on-station if remainder within tolerance of 0 or 1:
```
MOD(iq_IndexerAxis.ActualPosition,1.0,DialPosRmndr)[LE(DialPosRmndr,OnStationTolNests) ,SUB(1.0,OnStationTolNests,OnStaTol1Minus) GE(DialPosRmndr,OnStaTol1Minus) ]OTE(p_OnStation);
```

### Index command (R04 rung 14, Auto Mode) — target = distance to next integer nest, direction-aware:
```
XIC(SafetyOK)XIO(Status.State[1])[MOVE(1,IndexerAxisMotionParameters.MoveType) ,MOVE(HMI_IndexerAxis.Parameters.AutoSpeed[0],IndexerAxisMotionParameters.Speed) ,MOVE(HMI_IndexerAxis.Parameters.Accel[0],IndexerAxisMotionParameters.Accel) ,MOVE(HMI_IndexerAxis.Parameters.Decel[0],IndexerAxisMotionParameters.Decel) ,XIC(Status.State[13]) [[XIO(p_OnStation) ,XIC(p_OnStation) LE(DialPosRmndr,OnStationTolNests) ] SUB(1.0,DialPosRmndr,IndexerAxisMotionParameters.Position) ,XIC(p_OnStation) GE(DialPosRmndr,OnStaTol1Minus) CPT(IndexerAxisMotionParameters.Position,1.0 + (1.0-DialPosRmndr)) ] ];
```
Note `MoveType = 1` (incremental) and S-Curve profile in the MAM (rung 15):
```
XIC(SafetyOK)[XIC(Status.State[1]) XIC(IndexerAxisManMoveTrig) ,XIO(Status.State[1]) XIC(Status.State[13]) ]XIC(iq_IndexerAxis.ServoActionStatus)XIC(iq_IndexerAxis.AxisHomedStatus)XIC(IndexerAxisPermissive)MAM(iq_IndexerAxis,IndexerAxis_MAM,IndexerAxisMotionParameters.MoveType,IndexerAxisMotionParameters.Position,IndexerAxisMotionParameters.Speed,Units per sec,IndexerAxisMotionParameters.Accel,Units per sec2,IndexerAxisMotionParameters.Decel,Units per sec2,S-Curve,75,75,% of Time,Disabled,0,0,None,0,0);
```

### Index-complete detection
Two-stage: motion started (`MAM.IP` and physically off-station) → 16; motion done (`MAM.PC` and back on-station) → 22 (NoSP) / 19 (SP):
```
XIC(Status.State[13])XIC(IndexerAxis_MAM.IP)XIO(p_OnStation)MOVE(16,Control.StateReg);
[XIC(Status.State[16]) XIC(IndexerAxis_MAM.PC) ,XIC(Status.State[2]) XIO(Initialized) XIC(CycleRunning) ]XIC(p_OnStation)XIC(SS_OK)MOVE(22,Control.StateReg);   (NoSP)
```

### Dwell handling
There is no explicit dwell timer. Dwell = State 4 "Wait For All Stations Complete": every station program must raise `q_StationComplete`, debounced by `StationsCompleteDelay`:
```
XIC(Status.State[4])TON(StationsCompleteDelay,?,?)XIC(StationsCompleteDelay.DN)XIC(\S01_PartLoad.q_StationComplete)XIC(\S03_PartLoad.q_StationComplete)XIC(\S04_PartVerify.q_StationComplete)XIC(\S05_ServoPNP.q_StationComplete)XIC(\S18_RejectUnload.q_StationComplete)XIC(\S19_GoodUnload.q_StationComplete)ONS(ONS.6)OTE(StationsComplete);
```
The only timed dwells are `State34Delay` (settle after abort stop), `State40Delay` (pause debounce), and the 2000 ms `Control.TransitionTime` on the 42→4 pause-restart edge.

### Safety abort during index (both files)
Permissive drop mid-index → 31, hard stop with max decel:
```
XIO(iq_IndexerAxis.MotionStatus.0)[XIO(IndexerAxisPermissive) ,XIO(SafetyOK) ]MAS(iq_IndexerAxis,IndexerAxis_MAS_All,All,Yes,HMI_IndexerAxis.Status.MaxDecel,Units per sec2,Yes,10,% of Time);
```
Indexer axis permissive (NoSP and SP identical):
```
XIC(ActuatorsSafe)OTE(IndexerAxisPermissive);
```

### Standard servo-axis rung set (R04 = R05 pattern, used verbatim for both axes)
0. Ready: `XIC(MotionGroup.GroupSynced)XIO(iq_X.SafeTorqueOffActiveInhibit)OTE(XReady)`
1. Auto-enable one-shot after `SafetyOK && Ready` + enable delay
2. Permissive (application-specific — see comment in §8)
3. `MSO` enable (manual HMI Enable in State 1, or auto-enable)
4. `MSF` disable (State 1 + HMI Disable)
5. Fault reset: `MAFR` if not shutdown, `MASR` if shutdown
6-7. `MAJ` jog + `MAS(Jog)` stop on button release (State 1 only)
8. Inch via incremental `MAM` (State 1 only)
9-12. Home request / confirm / `MAH` or `AOI_TorqueHome(…,25.0,100.0,5.0,25.0,0.5,1)` / HMI home status echo
13. Manual move trigger + manual parameters
14. Auto parameters (per-state target position selection)
15. Auto/manual `MAM` — always gated `ServoActionStatus + AxisHomedStatus + Permissive`
16. `MAS(All)` on permissive/safety loss
17-18. Torque limit set from HMI
19. Actual position/velocity/torque echo to HMI
20. `GSV MaximumSpeed` on first scan, compute MaxAccel/MaxDecel (`/0.85/0.1` indexer, `/0.85/0.03` shot pin)

### Shot-pin choreography (SP only)

**Debounced pin-extended signal (R01 rung 1)** — only one sensor exists (retracted); extended = NOT retracted for the debounce time:
```
XIO(i_ShotPinRetracted)TON(ShotPinExtendedDelay,?,?)XIC(ShotPinExtendedDelay.DN)OTE(ShotPinExtended);
```

**ShotPinSafe (R01 rung 4)** — sensor AND servo window AND no motion:
```
XIC(i_ShotPinRetracted)XIC(ShotPinAxisRetract.InPos)XIO(iq_ShotPinAxis.MoveStatus)XIO(iq_ShotPinAxis.JogStatus)OTE(ShotPinSafe);
```

**ActuatorsSafe includes the pin (R01 rung 5):**
```
XIC(ShotPinSafe)XIC(\S01_PartLoad.q_ActuatorsSafe)...XIC(\S19_GoodUnload.q_ActuatorsSafe)OTE(ActuatorsSafe);
```

**Initialized requires pin engaged (R01 rung 13):**
```
XIC(p_OnStation)XIC(ShotPinExtended)XIC(ShotPinAxisExtend.InPos)OTE(Initialized);
```
(NoSP is just `XIC(p_OnStation)OTE(Initialized);`)

**Retract before index — State 7 entry and exit:**
```
[XIC(Status.State[4]) XIC(StationsComplete) ,XIC(Status.State[2]) XIO(Initialized) XIO(p_OnStation) XIC(CycleRunning) ]XIC(SS_OK)MOVE(7,Control.StateReg);
XIC(Status.State[7])XIC(i_ShotPinRetracted)XIC(ShotPinAxisRetract.InPos)XIC(SS_OK)MOVE(10,Control.StateReg);
```

**Extend after index — State 19 entry and exit:**
```
[XIC(Status.State[16]) XIC(IndexerAxis_MAM.PC) ,XIC(Status.State[2]) XIO(Initialized) XIC(CycleRunning) ]XIC(p_OnStation)XIC(SS_OK)MOVE(19,Control.StateReg);
XIC(Status.State[19])XIC(ShotPinExtended)XIC(ShotPinAxisExtend.InPos)XIC(SS_OK)MOVE(22,Control.StateReg);
```

**Shot-pin axis permissive (R05 rung 2)** — pin may only move when dial is on station and indexer is not moving:
```
XIC(p_OnStation)XIO(iq_IndexerAxis.JogStatus)XIO(iq_IndexerAxis.MoveStatus)OTE(ShotPinAxisPermissive);
```

**Position selection (R05 rung 14, Auto Mode)** — `Positions[0]` = extend, `Positions[1]` = retract, absolute move (`MoveType = 0`), Trapezoidal:
```
XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,ShotPinAxisMotionParameters.MoveType) ,MOVE(HMI_ShotPinAxis.Parameters.AutoSpeed[0],ShotPinAxisMotionParameters.Speed) ,MOVE(HMI_ShotPinAxis.Parameters.Accel[0],ShotPinAxisMotionParameters.Accel) ,MOVE(HMI_ShotPinAxis.Parameters.Decel[0],ShotPinAxisMotionParameters.Decel) ,XIC(Status.State[19]) MOVE(HMI_ShotPinAxis.Parameters.Positions[0],ShotPinAxisMotionParameters.Position) ,XIC(Status.State[7]) MOVE(HMI_ShotPinAxis.Parameters.Positions[1],ShotPinAxisMotionParameters.Position) ];
```

**Motion command fires in both states 7 and 19 (R05 rung 15):**
```
XIC(SafetyOK)[XIC(Status.State[1]) XIC(ShotPinAxisManMoveTrig) ,XIO(Status.State[1]) [XIC(Status.State[7]) ,XIC(Status.State[19]) ] ]XIC(iq_ShotPinAxis.ServoActionStatus)XIC(iq_ShotPinAxis.AxisHomedStatus)XIC(ShotPinAxisPermissive)MAM(iq_ShotPinAxis,ShotPinAxis_MAM,...,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);
```

**Servo position window monitors (R05 rung 21)** — `AOI_RangeCheck(instance, target, ±0.1 window, actual, debounce)`; the `InPos` bits are the interlock complement to the physical sensor:
```
[AOI_RangeCheck(ShotPinAxisExtend,HMI_ShotPinAxis.Parameters.Positions[0],0.1,HMI_ShotPinAxis.Status.ActualPosition,5) ,AOI_RangeCheck(ShotPinAxisRetract,HMI_ShotPinAxis.Parameters.Positions[1],0.1,HMI_ShotPinAxis.Status.ActualPosition,5) ];
```

Interlock summary: index can only start with pin retracted (sensor + servo window, via ShotPinSafe→ActuatorsSafe→State 10 gate and IndexerAxisPermissive); pin can only move on-station with the indexer at rest (ShotPinAxisPermissive); cycle can only be considered Initialized with pin extended.

---

## 6. Shot-Pin Delta (SP vs NoSP)

| Aspect | NoSP | SP |
|---|---|---|
| Sequence states | 4→10→13→16→22 | 4→**7**→10→13→16→**19**→22 |
| Extra routine | — | `R05_ShotPinServo` (22 rungs, mirrors R04) |
| Extra JSR in R00 | — | `JSR(R05_ShotPinServo,0)` |
| Extra R01 rungs | — | debounce `ShotPinExtended`; `ShotPinSafe`; `ActuatorsSafe` includes `ShotPinSafe`; `Initialized` requires pin extended; `MOVE(0,StaNum)` gated by `XIC(S:FS)` (NoSP runs it every scan) |
| q_StartOK | indexer enabled+homed | + shot pin axis enabled+homed |
| Extra tags | — | ~40: full `ShotPinAxis*` servo family, `HMI_ShotPinAxis`, `iq_ShotPinAxis`, `i_ShotPinRetracted`, `ShotPinExtended(+Delay)`, `ShotPinSafe`, 2× `AOI_RangeCheck` |
| ServoAlarm usage | [0] drive fault, [1] home loss | + [2] `'Shot Pin Axis Servo Drive Fault'`, [3] `'Shot Pin Axis Loss Of Absolute Home Position'` |
| Alarm usage | [0] unused, [4] unused | [0] `'Waiting For Shot Pin To Retract'` (3000 ms in State 7), [4] `'Waiting For Shot Pin To Extend'` (3000 ms in State 19) |
| ActuatorsSafe alarm breakdown | stations only | adds `XIO(ShotPinSafe) → ActuatorsSafeList[0] 'Shot Pin'` branch |
| Controller tags / connections | `a01_Indexer` only | + `a02_ShotPin`; second ParameterConnection |
| AOIs | — | + `AOI_RangeCheck` |

Alarm timeout pattern (identical structure across all timeout alarms — state bit sets `Control.FaultTime`, `Status.TimeoutFlt` latches the alarm until `FaultReset`):
```
[XIC(Status.State[19]) MOVE(3000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[4].Active) XIO(FaultReset) ][OTE(Alarm[4].Active) ,ONS(ONS.18) CONCAT(g_StationList[StaNum],AlarmList[4],Alarm[4].Message) ];
```
FaultTime values used: State 7/19 = 3000, State 10 = 5000, State 13 = 1000, State 16 = 5000, State 31 = 2000, State 34 = 3000, empty-nest = 5000.

---

## 7. Cross-Program Interface

**Inputs consumed from `\Supervisor`:** `q_ManualMode`, `q_SafetyOK`, `q_FaultReset`, `q_CycleStartLatch`, `q_CycleStopped` — mapped 1:1 onto local `ManualMode/SafetyOK/FaultReset/CycleRunning/CycleStopping/CycleStopped` in R01. (The indexer's own `q_*` tags are the return path read by Supervisor.)

**Inputs consumed from station programs** (`\S01_PartLoad`, `\S03_PartLoad`, `\S04_PartVerify`, `\S05_ServoPNP`, `\S18_RejectUnload`, `\S19_GoodUnload`): `q_StationComplete`, `q_ActuatorsSafe`, and `q_Pause` (S01/S03/S05 only). This is the station handshake contract: every station must publish these.

**`\Alarms` program:** `p_ProgramID`, `p_Active`, `p_History` — passed into both `ProgramAlarmHandler` calls:
```
ProgramAlarmHandler(ProgramFaultHandler,\Alarms.p_ProgramID,Alarm,\Alarms.p_Active,\Alarms.p_History,g_CPUDateTime,AlarmActive,WarningActive);
```

**`\Tracking` program:** `p_Data` (`.Station[n].NestNum`, `.Station[StaNum].OpStatus.SingleStep`), `p_NestQty`. R10 recomputes every station's NestNum from dial position:
```
NewNestNum := ((TRUNC(iq_IndexerAxis.ActualPosition + OnStationTolNests) + (\Tracking.p_NestQty - 1)) MOD \Tracking.p_NestQty) + 1;
\Tracking.p_Data.Station[StationNum].NestNum := (NewNestNum - StationNum + \Tracking.p_NestQty) MOD \Tracking.p_NestQty + 1;
```

**Controller-scope tags referenced:** `a01_Indexer` / `a02_ShotPin` (AXIS_CIP_DRIVE), `MotionGroup` (MOTION_GROUP, `.GroupSynced`), `g_CPUDateTime : CPU_TimeDate`, `g_MachineBasic : MachineBasic` (`.PowerUpCP`, `.AlwaysOff`), `g_StationList : STRING[?]` (station-name prefix for alarm messages).

**ParameterConnections:**
```
NoSP: \S00_IndexerNoSP.iq_IndexerAxis  <->  a01_Indexer
SP:   \S00_IndexerSP.iq_IndexerAxis    <->  a01_Indexer
      \S00_IndexerSP.iq_ShotPinAxis    <->  a02_ShotPin
```

---

## 8. Engineer Instruction Comments (application-specific insertion points)

All verbatim; these mark places a generator/engineer must customize:

1. R01 "Logic inputs" rung (both files):
```
Logic inputs

*Replace always off bits with real conditions
```
(In these templates the Supervisor mappings are already real; the note flags that this block is where placeholder `g_MachineBasic.AlwaysOff`-style bits get replaced on a new project.)

2. R04/R05 permissive rung (both files, both axes):
```
Axis Motion Permissive (Add more conditions if necessary. Permissive should be based on the physical state of itself potentially interfering devices)
```

3. R02 Last Cycle Time rung (both files):
```
Last Cycle Time

**Limit Instruction Low & High Limits Populated WIth Range Of States In Which Station Is Running (Example, PNP Is Picking & Placing A Part)
**Cycle Complete State Shown As Example
```

4. R03 station-time recording header (both files):
```
Record Ok To Index For Each Station
***Used to Determine Stations With Longest Cycle Times***
```

5. R04/R05 homing parameter guide (both files, both axes):
```
Home Select = 0 is for Immediate Home (Example, servo indexer)
Home Select = 1 is for Home To Torque (Example, PNP)

Homing Torque = Start at 25%, Increase In 5% Increments If Not Enough
Run Torque = Normal Running Torque Of Axis
Homing Speed = Homing Speed in units/s
Overtorque Limit = Set The Same As Homing Torque
Home Offset Distance = Distance Moved Off Of Hard Stop When Homing Complete
Home Direction = 0 Is Positive, 1 Is Negative
```

6. R04/R05 GSV rung note (parameterized per axis — 100 ms vs 30 ms):
```
Retrieve the maximum speed value from the axis and calculate max accel and decel.  The max velocity is 85% of full speed.  Equation is based upon 100% speed at a 100ms accel/decel time.
```
(Shot-pin variant says `...at a 30ms accel/decel time.` and divides by 0.03.)

7. "Not Used" alarm placeholders (NoSP rungs 2 & 6 of R20) — spare alarm slots kept alive with the always-off bit:
```
XIC(g_MachineBasic.AlwaysOff)OTE(Alarm[0].Active);
XIC(g_MachineBasic.AlwaysOff)OTE(Alarm[4].Active);
```
In SP these two slots are consumed by the shot-pin retract/extend timeout alarms — i.e., the alarm-array indices are stable across variants and spares are reserved with `AlwaysOff`.

8. Station-list strings (`ActuatorsSafeList`, `g_StationList`) are data-driven insertion points: `'Shot Pin','Station 1','Station 3','Station 4','Station 5','Station 18','Station 19'` — must be edited to match the actual station lineup, in the same order as the XIO branch chain in the ActuatorsSafe alarm rungs.
