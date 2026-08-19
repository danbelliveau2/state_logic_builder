# 1116 Molex — Machine Structure Analysis

**Source:** `C:\SDC-StateLogic\projects\1116_Molex.json` (155 KB) — analyzed 2026-08-19
**Machine:** Brazing Machine, customer Molex, project 1116
**Type:** `indexing` dial — **90 stations / 90 nests**, target cycle time **0.675 s**
**Why it matters:** Recent, real, full supervisor-level dial machine. Best available reference for how a complete SDC machine decomposes into station SMs.

---

## 1. The 15 State Machines

| # | SM Name | Station | Nodes | Edges | Devices | Purpose (inferred) |
|---|---------|---------|-------|-------|---------|--------------------|
| 1 | Robot_Load | 1 | 1 | 0 | 1 (Robot) | Robot part-load handshake — **stub** (single "Wait for Index Complete" node, unfinished) |
| 2 | Part_Load | 1 | 5 | 4 | 2 (Pneumatic cyl, Timer) | Head-opener cylinder cycle to load part into nest (Extend → dwell → Retract) |
| 3 | Part_Locate | 4 | 7 | 6 | 3 (Gripper, Pneumatic cyl, ServoAxis) | Physically locate/seat part: vertical cyl down, grip, servo push to Work, return |
| 4 | Location_Verify | 6 | 3 | 2 | 1 (Vision) | Camera inspection — part location verify (X_Offset output) |
| 5 | Reject_1_Unload | 7 | 5 | 4 | 2 (Pneumatic cyl, Timer) | Eject parts failing Location_Verify (head-opener cylinder cycle) |
| 6 | Barrel_Verify | 17 | 3 | 2 | 1 (Vision) | Camera inspection — barrel feature verify |
| 7 | Reject2_Unload | 21 | 5 | 4 | 2 (Pneumatic cyl, Timer) | Eject parts failing Barrel_Verify (copy of Reject_1_Unload) |
| 8 | Heater | 28 | 4 | 3 | 1 (Gripper) | Braze heater station — gripper clamps part during heating |
| 9 | Temperature_Verify | 55 | 4 | 3 | 1 (Vision) | Camera/thermal inspection — temperature verify post-heat |
| 10 | Wire_Feed | 56 | 7 | 6 | 4 (3× ServoAxis, Timer) | 3-axis braze wire feed: X/Z position, Feed axis increments along seam, WireMelt dwell |
| 11 | WireFeed_Verify | 61 | 4 | 3 | 1 (Vision) | Camera inspection — wire feed / braze joint verify |
| 12 | GoodPart_Unload1 | 72 | 6 | 5 | 2 (Pneumatic cyl, Timer) | Unload good parts, lane 1 (copy of Reject_1_Unload + IndexComplete wait) |
| 13 | GoodPart_Unload2 | 76 | 6 | 5 | 2 (Pneumatic cyl, Timer) | Unload good parts, lane 2 (copy) |
| 14 | RejectPart_Unload | 84 | 5 | 4 | 2 (Pneumatic cyl, Timer) | Final catch-all reject unload |
| 15 | Dial_Indexer | 99 | 4 | 3 | 1 (ServoAxis, rotary) | Auto-generated indexer — waits for AllStationsReady, ServoIndex, publishes IndexComplete |

Typical station SM: **3–7 nodes, 2–6 edges, 1–4 devices.** Largest process SMs (Part_Locate, Wire_Feed) top out at 7 nodes.

## 2. Machine Topology & Coordination

### Dial layout (90-position dial, 14 occupied stations, 76 empty)

```
Stn 1   Part_Load (load)        — Part_Load + Robot_Load SMs
Stn 4   Part_Locate (process)
Stn 6   Location_Verify (verify)
Stn 7   Reject1_Unload (unload)
Stn 17  Barrel_Verify (verify)
Stn 21  Reject2_Unload (unload)
Stn 28  Heater (process)
Stn 43  Heater2 (process)       — declared in machineConfig, NO SM built (empty smIds)
Stn 55  Temperature_Verify (verify)
Stn 56  Wire_Feed (load)        — smIds lists TWO ids; one ("id_mnvp8bts") is DANGLING (deleted SM)
Stn 61  WireFeed_Verify (verify)
Stn 72  GoodPart_Unload1 (unload)
Stn 76  GoodPart_Unload2 (unload)
Stn 84  RejectPart_Unload (unload)
(Dial_Indexer carries pseudo-station 99)
```

Process narrative: load → locate/seat → verify location → early reject → verify barrel → early reject → heat (×2 planned) → verify temperature → feed braze wire → verify braze → unload good (2 lanes) → final reject.

**Station-type roster:** 2 load, 3 process (1 unbuilt), 5 verify (all vision), 5 unload (1 good-reject split into reject-early ×2, good ×2, final reject ×1), 1 infrastructure (indexer).

### Cross-SM coordination — the entire project-level signal set is just TWO signals

| Signal | Type | Anchors | Produced by | Consumed by |
|--------|------|---------|-------------|-------------|
| `AllStationsReady` | **condition** (builtIn, auto-generated) | TRUE when ALL station SMs at Cycle Complete | Every station SM (implicitly, by reaching Cycle Complete) | Dial_Indexer (single-exit wait decision before ServoIndex) |
| `IndexComplete` | **state** (`reachedMode: 'reached'`, anchored to Dial_Indexer's Cycle Complete node by stable `stateNodeId`, not step number) | TRUE when Step >= Cycle Complete step of Dial_Indexer | Dial_Indexer | Heater, Temperature_Verify, WireFeed_Verify, GoodPart_Unload1, GoodPart_Unload2, Robot_Load (single-exit wait decision as first node after Home) |

This is the canonical dial handshake: **stations → AllStationsReady → indexer indexes → IndexComplete → stations start next cycle.** No station-to-station signals exist; everything is mediated by the indexer. Notably, some SMs (Part_Load, Part_Locate, both vision-only Verify stations at 6/17, Reject unloads) do NOT gate on IndexComplete in the diagram — likely relying on template-level barrier or simply left inconsistent by the author.

## 3. Device Census (28 devices)

| Type | Count | Instances |
|------|-------|-----------|
| PneumaticLinearActuator | 7 | HeadOpenerCylinder (×6 clones: base, 2, 3, 32, 5), Part_LocateVertical_Cylinder |
| Timer | 7 | ExtendAddedDelay (×5 clones), WireMelt, (Part_Load's) |
| ServoAxis | 5 | Part_LocatePart_Push (linear, Home/Push), Wire_FeedX (Start/Along_Seam), Wire_FeedZ (Top_of_Part/Retract), Wire_FeedFeed (Feed), DialIndexer (**rotary**, Index) |
| VisionSystem | 4 | Location_VerifyCam, Barrel_VerifyCam, Temperature_VerifyCam, WireFeed_VerifyCam — one job each, named `{Station}_Inspect` |
| PneumaticGripper | 2 | Part_LocatePart_Gripper, HeaterGripper |
| Robot | 1 | LoadRobot (FANUC-style DI/DO interface: CycleRunning, StopLoop, ResetPR101, PrgDone, InvalidPrgCmd, TimeoutFault, position registers) |

**Naming conventions observed:**
- Device names prefixed with owning SM/station: `Part_LocateVertical_Cylinder`, `Wire_FeedX`, `Temperature_VerifyCam`.
- Cloned SMs get numeric-suffix device names (`HeadOpenerCylinder2/3/32/5`) but keep the same displayName — the copy tool suffixes tag stems for uniqueness.
- Vision job = `{StationName}_Inspect`; camera = `{StationName}Cam` / display `{Station_Name} Camera`.
- Servo positions are process-semantic (`Work`, `Home`, `Push`, `Top_of_Part`, `Along_Seam`, `Start`, `Feed`, `Retract`, `Index`).
- Edge verify conditions use standards-profile tags: `i_{name}Ext/Ret`, `{name}ExtDelay`, servo `iq_MAM.PC` + `{Pos}RC.In_Range`.
- standardsProfile: SDC Standard — PascalCase, `i_`/`q_`/`p_`/`g_` prefixes, R00–R04 + R20 routine names, `State_Engine_128Max`, `ProgramAlarmHandler`, `CPU_TimeDate_wJulian`, `MovingAverage` cycle-time AOI.

## 4. Part Tracking & Recipes

`partTracking.fields` — 3 fields, ALL auto-linked from vision devices:

| Field | Type | Source |
|-------|------|--------|
| `Location_Verify_Inspect` | boolean | Location_Verify camera job result |
| `Location_Verify_Inspect_X_Offset` | real (mm) | Vision output `X_Offset` from same job |
| `Temperature_Verify_Inspect` | boolean | Temperature_Verify camera job result |

Notable gap: Barrel_Verify and WireFeed_Verify jobs are NOT part-tracking-linked — the unload/reject routing implied by the station layout would need their pass/fail fields too. `recipes: []`, `recipeOverrides: {}` — no recipe usage on this project.

## 5. Patterns Worth Learning (tier-2 / tier-3 generation)

1. **One SM per occupied station, one station type per SM** — no multi-station SMs. Exception: a load station can carry TWO SMs (mechanism SM + robot handshake SM at station 1).
2. **SM size is small**: 3–7 nodes. Verify stations are a fixed 3–4-node template (Home → [Wait IndexComplete] → Vision Inspect → Cycle Complete). Cylinder-cycle stations are a fixed 5-node template (Home → Extend → Wait dwell → Retract → Cycle Complete).
3. **Clone-and-rename is the dominant authoring idiom**: 6 of 15 SMs are literal copies of Reject_1_Unload (descriptions still say "Copy of Reject_1_Unload"). Tier-3 generation should emit these as parameterized instances of one unload template.
4. **The only handshake idiom is the two-signal indexer barrier** (AllStationsReady condition + IndexComplete state signal). State signals anchor to `stateNodeId` (stable UUID), `reachedMode: 'reached'`.
5. **IndexComplete gating is inconsistent** — only 6 of 14 station SMs have the wait-decision; the rest start free-running. A generator should insert it uniformly (or the runtime template must impose the barrier).
6. **machineConfig is the machine-level source of truth**: 90 station slots each with `{number, name, type: load|process|verify|unload|empty, smIds, bypass, lockout}`. It admits declared-but-unbuilt stations (Heater2 @43) and can hold **dangling smIds** (station 56 references a deleted SM id `id_mnvp8bts`) — generators must validate smIds against stateMachines.
7. **Verify → downstream reject pairing**: each early verify station has a dedicated reject unload a few positions downstream (6→7, 17→21), with final good/reject sorting at the end of the dial (72/76 good, 84 reject). Pass/fail routing is positional (part rides the dial), not diagrammed as branches.
8. **Edge conditions are verify-lists**, e.g. `i_XRet=Off` + `XExtDelay=250`, or servo `iq_MAM.PC=On` + `{Pos}RC.In_Range=On` — the standard motion-complete idiom.
9. **Nest count = station count (90/90)**; sub-second target cycle (0.675 s) explains many empty positions (dwell/cooling between heat and verify: 28→55 is 27 positions of cooling).

## 6. What This Implies for Jarvis (tier-3 generation for a full dial machine)

Beyond the per-station programs, tier-3 must produce:

1. **The indexer SM/program itself** — auto-generated from machineConfig: rotary servo, ServoIndex action, AllStationsReady wait, IndexComplete publication. It is infrastructure, not authored per-project.
2. **The AllStationsReady aggregation logic** — an AND across every non-bypassed station SM's Cycle Complete, honoring per-station `bypass` and `lockout` flags in machineConfig (both exist per slot and must appear in the generated condition).
3. **Uniform IndexComplete start-gating** injected into every station SM (the human author applied it inconsistently — the generator must not copy that inconsistency).
4. **Nest-indexed part tracking** — 90 nests: a PartTracking array indexed by nest, shifted on IndexComplete, with vision results written at each verify station's dial position and consumed at reject/unload positions. The reject stations only make sense with "this nest failed Location_Verify" data arriving 1+ index later — that shift register is pure infrastructure Jarvis must emit.
5. **Pass/fail → unload routing logic**: good/reject sorting at stations 72/76/84 reads accumulated PT fields; currently only 2 of 4 vision jobs are PT-linked — generation should auto-link every vision job result into part tracking.
6. **Robot interface program** — the Robot_Load SM is a stub here; a real generator must emit the full FANUC handshake (CycleRunning/StopLoop/PrgDone/fault signals, PR register reset) as a standard block.
7. **Machine-level supervisor**: cycle start/stop, dry-run/single-step decode, cycle-time monitoring (`MovingAverage` AOI is in the standards profile), alarm rollup across ~15 programs (`{station} {stationName}: {message}` format).
8. **Validation pass**: dangling smIds, declared-but-empty stations (Heater2), un-gated SMs, and unlinked vision jobs all exist in this real project — Jarvis should detect and either fix or flag each.
9. **Scale expectation**: a full machine of this class ≈ 15 programs, ~28 devices, ~65 nodes total. Per-station logic is small and template-shaped; the value (and complexity) is in the coordination layer — indexer, barrier, nest tracking, sorting — which is exactly what the flowcharts DON'T show.
