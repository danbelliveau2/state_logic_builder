# 1163 L1 indexer — tracking plan (agreed with Jason 2026-11-05, build next)

One machine. L1 builds a subassembly that loads onto L2. One Supervisor, Alarms, Production, HMI, cleanout.
Reference for two parts per nest: 1160 (`X:\Electrical Dept\SDC Engineer\Deliveries\1160\1160_YSiteAssembly.L5X`, ChassisStandard_2UP family).
Reference for the dial side: L2 on 1163 v0.7.6 (`L2_Tracking`, `L2_S00_IndexerNoSP`, `L2_S10_BlueTubeCoiler`).

## Layout — 18 nests, 8 active positions, position numbering, `Station[9]`

| Position | Program | Acts on |
|---|---|---|
| 0 | none | nest arriving next, `Station[0]`, S01 incoming |
| 1 | `L1_S01` | A (upstream) then B (downstream) of the current nest; latches `PartLoadedA/B` |
| 2 / 3 | `L1_S02` | B of nest at 2, A of nest at 3, ONE program (shared gantry) |
| 4 / 5 | `L1_S04` | B of nest at 4, A of nest at 5, ONE program |
| 6, 7 | none | empty |
| 8 | `L1_S08` robot unload | A and B, sorted good / reject per part; `i_EmptyNestA/B` here |
| 9–18 | none | in transit |

Each nest = one fixture, two parts: A = upstream, B = downstream (1160 meaning). On L2, A/B = two nests.

## UDTs

| UDT | `L2Tracking_*` (rename only, members as delivered) | `L1Tracking_*` (new) |
|---|---|---|
| `_Data` | Nest[65], Station[17] | Nest[19], Station[9] |
| `_Nest` | OpStatus, PartStatus, PerformData | same |
| `_Part_Assy_Stat` | Good, Bad, PartLoaded, Station[17], FailureType, FailureMessage | GoodA/B, BadA/B, PartLoadedA/B, FailureTypeA/B, FailureMessageA/B, Station[9]. NO Recycle, NO Sample |
| `_Process_Op_Result` | Attempt, Success, Failure, Lockout | AttemptA/B, SuccessA/B, FailureA/B, LockoutA/B |
| `_Station` | OpStatus, NestNumA, NestNumB, PerformData | same |
| shared, unprefixed | `Tracking_Station_Op_Status` (A/B + single step), `Tracking_Nest_Op_Status`, `Tracking_Perform_Nest`, `Tracking_Perform_Station` | |

Rename cost on L2: type names on `p_Data` and `ZeroPartAssyStat` only.

## Programs

| Program | Built from | Changes |
|---|---|---|
| `L1_Tracking` | `L2_Tracking` | L1 family; R05 = 1160's A/B version; good + reject triggers both from `L1_S08`, per part; unload station constant = 8 |
| `L1_S00_IndexerNoSP` | `L2_S00_IndexerNoSP` | `NestsPerIndex` 1; R10 below; `i_EmptyNestA/B` in the 10→13 index permissive + two nest-not-empty alarms; R03 `StationCompleteTimes[9]` rungs (template form `XIC(\L1_S0n.q_StationComplete)ONS DIV(CycleTimer.ACC,1000,StationCompleteTimes[n])`), one per station |
| `L2_S00_IndexerNoSP` | — | add the same R03 rung for S10 (escapements emit no `q_StationComplete`) |
| stations | L2_S10 shape | one `StaNum`, one `StaNumPre`; `NestNumCurrentUpstream = Station[StaNum].NestNumA`, `Downstream = NestNumB`; writes `Nest[Up].PartStatus.Station[StaNum].AttemptA/SuccessA`, `Nest[Down]...AttemptB/SuccessB` (1160 S05_PortLoad pattern); lockout / dry run / single step per side off `Station[StaNum].OpStatus.xA/xB`; `q_StationComplete` = both sides |
| `L1_S08` | robot rule | Cycle per side on `PartLoadedA/B`; destination from `GoodA/BadA`, `GoodB/BadB`; Attempt/Success off robot signals; nest record zeroed one state after both parts confirmed off |

## R10 — `L1_S00` `R10_CalcDialStationNestNums`

`NewNestNum := ((TRUNC(ActualPosition + OnStationTolNests) + (18 − 1)) MOD 18) + 1` (p_NestQty = 18)
`NestAt(p) = (NewNestNum − 1 − (p − 1) + 18) MOD 18 + 1`
`Station[n].NestNumA := NestAt(p_StationPositionA[n])`, `NestNumB := NestAt(p_StationPositionB[n])`, loop n = 0..8.

| Station | PosA (upstream) | PosB (downstream) | StaNumPre |
|---|---|---|---|
| 0 | 0 | 0 | — |
| 1 | 1 | 1 | 0 |
| 2 | 3 | 2 | 1 |
| 4 | 5 | 4 | 2 |
| 8 | 8 | 8 | 4 |

Nests circulate (linear loop); all numbers wrap MOD 18, same math as L2 without the 2× factor.

## Renames / shared programs

| Today | Becomes | Touches |
|---|---|---|
| five `Tracking_*` UDTs | `L2Tracking_*` | two tag declarations |
| `HMI_NestIndicator[65]` | `HMI_L2NestIndicator` + new `HMI_L1NestIndicatorA/B[19]` | HMI R02 loop, one per dial |
| `g_StationList[17]` | `g_L2StationList` + new `g_L1StationList[9]` | every L2 alarm CONCAT (~40 rungs, name only). Alternative: one shared list with L1 at an offset — Jason's call |
| `StationCompleteTimes` | no rename (program-scope per indexer) | |
| `g_Preset*Perform*` | shared | |
| HMI R03_CleanoutMode | one mode, both dials: add L1 `PartLoadedA/B` chain | |
| Production | one machine count at L2's exit; L1 contributes rejects only if wanted | |
| Supervisor / Alarms | add the four L1 programs to the existing chains | |

## Open at build start
- `g_StationList`: rename per dial or one offset list.
- Production: count L1 rejects or not.
- Station 6/7 stay empty; positions 2/3 and 4/5 are one program each (confirmed).
