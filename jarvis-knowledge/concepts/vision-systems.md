# Vision systems — how SDC thinks about them

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

> **STATUS: DRAFT SCAFFOLD.** Assembled from the legacy builder's vision
> handling (pre-standard), the 1116 Molex analysis, and Dan's framing — not
> yet fully taught by the controls leads. Vision is exactly where the old
> rule set "got so crazy": the same camera family shows up in many
> application modes and the rules multiplied instead of the understanding.
> Sections tagged **⟶ ASK THE LEADS** are open questions already in the
> Jarvis question queue.

## TAUGHT BY THE LEADS (Jason Perry, 2026-08-20, JARVIS_QUESTIONS_FOR_LEADS #6–#11)

Where a section below conflicts with this block, THIS block wins:

- **Standard camera family is KEYENCE.** Trigger via EtherNet/IP; hardwire
  the trigger only for high-speed applications (a conveyor app runs a
  beam-break sensor at 0 ms debounce with the trigger delay entered in the
  camera configuration, not in PLC dwell logic).
- **The handshake is a SIX-step sequence**, not the legacy four-sub-state
  skeleton: 1 wait for demand → 2 check trigger ready → 3 trigger camera →
  4 wait for results → 5 store results → 6 **acknowledge results**. Store and
  acknowledge are real steps the legacy shape lacked; the anatomy holds for
  all modes (answer #10 points job-select/coordinate modes back to it).
- **Coordinates vs pass/fail**: coordinates (an offset OR the absolute
  target) are sent only when the application needs vision GUIDANCE of a servo
  or robot. Verification stations get pass/fail. Imaging during motion is a
  real SDC pattern (Flex Feeder: Fanuc robot vision guidance).
- **Result data lives in a standard vision-IO UDT** — convention exists but
  is NOT yet in the standard template; expect it to land there.
- **Retry philosophy**: consecutive-failures counters for ALL inspection
  types (HMI-settable preset). Most verify stations do NOT retry the camera;
  only a camera controlling a process (e.g. box-close verification) may retry.

## Where cameras sit in SDC's hardware palette

A camera is one entry in a fixed electrical palette the EE department
maintains, and that palette is *why* the vision family is standardized at all.
Seen in EE Hardware Specification Regulations.extracted.md: Allen-Bradley is
the default PLC, every AB project runs Compact GuardLogix, on-machine IO is
SMC EX600, and Keyence is the stocked sensing vendor — one vendor family the
EE dept specs, spares and already knows how to wire. The camera reaches the
PLC as an EtherNet/IP network device (`cam01_...` per §9 naming) on the same
network as the drives and IO nodes.

Two boundaries worth holding:

- **Keyence for sensing ≠ Keyence for control.** Keyence safety PLCs are
  permitted *only* on non-AB projects (First Solar). A verdict from a camera
  is process data into a GuardLogix standard task; it is never a safety
  function — safety comes from the safety task and Banner expansion relays.
- **The grandfather clause explains the fleet.** "Duplicate machines or other
  exceptions may grandfather in old standards" — that is why Cognex and OMRON
  FZ/FJ cameras still appear on repeat builds. When a sheet names one, mirror
  the sheet: a legitimate grandfathered device, not an error to upgrade
  silently — and not a precedent for a greenfield machine, which gets Keyence.

## What vision does at SDC

Three intents, and the intent decides the structure:

1. **Verify** — a boolean gate on the process: "is the part located /
   oriented / present / brazed correctly?" Result is pass/fail, consumed by
   the state machine (branch or fault) and written into part tracking. This is
   the overwhelmingly common case — in 1116 Molex, five of sixteen dial
   stations are vision-only verify stations.
2. **Inspect with data** — the job also returns numeric outputs (X_Offset,
   PartCount, temperature…) that get stored, not just judged. Molex stored
   `Location_Verify_Inspect_X_Offset` (REAL, mm) alongside the boolean result
   in the nest-indexed part-tracking record.
3. **Guide** — coordinates are fed forward to correct a motion (offset a
   servo/robot target). Real on SDC machines; the legacy builder never modeled
   it.

The engineer's first question about any camera is therefore not "what tags
does it get" but **"who consumes the result, and is the result a bit, a
number, or a correction?"** Everything downstream (states, storage, part
tracking, fault philosophy) follows from that.

## The interface the PLC sees (legacy convention — pre-standard)

The camera is a device with a handshake, not a magic sensor:

- `q_Trigger{Cam}` — PLC asks for an acquisition
- `i_{Cam}TrigRdy` — camera says it can accept a trigger
- `i_{Cam}ResultReady` — camera says evaluation is done
- `i_{Cam}InspPass` (and per-job `q_Pass_{JobName}`) — the verdict
- `{Cam}TrigDwell` TON — settle time before/around the trigger
- `{Cam}SearchTimeout` — bound on a continuous-search loop

This **generic ready → trigger → result-ready → verdict handshake** is the
part that generalizes. What does NOT generalize: the physical transport
(hardwired IO vs EtherNet/IP assembly vs explicit messaging), job selection,
and image-vs-evaluation timing.

## The 4-sub-state skeleton (historical reference)

The legacy exporter compiled every Vision Inspect node into four sub-states at
+3 spacing: **Verify Trigger Ready** → **Wait Timer** (`{Cam}TrigDwell`
settle) → **Trigger** (assert, wait result-ready) → **Check Results** (pass,
fail, or loop until match or `{Cam}SearchTimeout`). Read it as *trigger →
acquire → evaluate → result* made explicit in the state machine — that is the
durable idea; an inspection is a sequence with handshakes, never a single
rung. The fixed count of 4 is legacy convenience; the leads' six-step anatomy
above supersedes it.

## Motion overlap during exposure

The reason "Wait Timer" exists: the image must be taken with the scene stable
(or deterministically moving). The judgment call mirrors servo blending,
inverted — **what motion is allowed while the camera is exposing?** A dial must
be locked (shot pin seated / IndexComplete) before a dial-mounted part is
imaged; a flying-trigger application deliberately images during motion.
**⟶ ASK THE LEADS**: the actual overlap rules and how settle time is chosen
vs. the fixed 50 ms default.

## Robot-hosted vision — what stays with the PLC
*(seen in ShowRoomFlexFeeder.L5X)*

On a flex feeder the camera, the job and the guidance math live on the Fanuc
controller; the PLC never sees a trigger, a result, or a coordinate. What it
still owns is the process AROUND the image, and that ownership is instructive:
the **vision lights** and the **vibratory feeder** are PLC outputs belonging to
the CONVEYOR state machine (P02 drives `q_VisionLights` / `q_VibratoryFeeder`
in its running states), while the robot program merely relays those bits onto
robot DO words (`UserOut1.1` / `UserOut1.3`) so the robot's own logic can see
them. Illumination is **continuous while the machine runs**, not pulsed per
acquisition — a belt-tracking feeder images constantly, so no settle/dwell
concept exists at all. The PLC's contribution to guidance quality is
geometric instead: it derives `InConvPickWindow` from the robot's reported
`CURPOS_G1` X/Y with two LIMITs and uses it only to CLASSIFY faults — a
collision-guard trip inside the pick window is a recoverable abort/reset/
restart excursion, the same trip outside it is a hard alarm. Judgment: when
vision belongs to the robot, do not model a handshake that doesn't exist —
model the utilities, the window and the fault classification.

## Jobs and results storage

- A camera runs named **jobs**; Molex convention was one job per station,
  `{Station}_Inspect` on `{Station}Cam`. Multi-job cameras need job selection
  (mechanism still open).
- **Part-tracking linkage is the canonical result store.** Each vision job
  auto-generates `{deviceName}_Pass` / `_Fail` signals (computed), and its
  boolean plus any numeric outputs are written into the nest-indexed
  PartTracking record at the station's dial position, shifted on
  IndexComplete, and consumed at reject/unload one or more indexes later. The
  verdict's real consumer is usually **not the inspecting station** — it's a
  downstream sort. In Molex only 2 of 4 jobs were PT-linked; generation should
  link every one.

## Failure philosophy

Two legitimate responses, chosen by process intent, not by rule:

- **Record and route** — the part is bad, the machine is fine: write FAILURE
  to part tracking, continue the cycle, let the reject station remove it. The
  Molex dial pattern.
- **Retry / search** — the result may be wrong (part settling, lighting,
  timing): re-trigger, bounded by `{Cam}SearchTimeout`; only after the bound is
  exhausted does it fault or record a failure.

## Code readers are cameras with a queue (Keyence HR-X / SR families, EtherNet/IP)

Barcode/DataMatrix readers are the **same device class** as a smart camera —
trigger/ready/result handshake over EtherNet/IP — plus one extra optional
layer: an internal result queue. Do not invent a separate taxonomy for them.

The cycle: (1) check Ready — not already reading, busy, or errored; (2) set
TriggerInput true to start (level-triggered, held, not pulsed — setting it
false cancels the read); (3) the reader captures/decodes/retries internally;
(4) it raises **ReadComplete** when result data is valid — *or* failed;
(5) the PLC consumes ResultData; (6) the PLC pulses **ReadCompleteClear**
true, then false once Complete drops. Clear is a required acknowledge that
re-arms the reader — a station that never pulses it gets exactly one read.

Two device-level **Data Handshake** modes, captured in the device table like
any other config:

- **Disable** (default, simplest): the reader auto-pushes result data the
  instant a read completes. Use when there's one reader and no race.
- **Enable** (queued): the reader buffers results and the PLC pulls each one —
  raise a Retrieve/Latch bit, the reader answers with a Strobe when the tag is
  actually updated, then drop Latch. An Available bit plus update/ready-count
  words expose backlog. Enable only when reads can outpace PLC consumption or
  exact read-to-data correlation matters.

**Completion ≠ success.** On a failed read, ReadComplete still fires and
ResultData is overwritten (literal "ERROR" on the SR family) — never infer
success from "data updated"; gate on the dedicated success/failure bit.

_Source: EtherNetIPSampleProgramGuide(CompactLogix).pdf (network: Standards -
Software), ingested 2026-08-29/30 by the inbox librarian._

## RFID data-carrier readers (Balluff BIS M-4006 AOI)

RFID read/write heads are a distinct identification-device type alongside
vision — they belong in the station's device list, not as plumbing.

- One AOI instance (`BMC_AOI_PROC_BISM4006`) per physical reader; never share
  instance data across readers.
- Fixed 128-byte cyclic I/O per reader (Input assembly 100, Output 101) plus a
  4-byte Config assembly (CRC, dynamic mode, auto-read vs type/serial,
  slow-tag detection) that only reloads on download or power-cycle — treat it
  as commissioning-time config, not per-cycle logic.
- Two InOut tags required: **Carrier** (read/write data buffer, sized ≥ bytes
  actually used; default UDT holds 2000) and **Interface** (command/status).
- Job status mirrors the servo/actuator status pattern: OK / IP / DN / ER +
  ErrorCode. Wire fault/retry logic to ER/ErrorCode the way other devices feed
  FaultTime/alarm text; map the fixed vendor codes (00–36 hex, AF, FF — carrier
  removed, CRC mismatch, wrong command, timeout, address out of range) into
  station alarm text rather than inventing new codes.

_Source: BIS_M_4006-034_V5 AOI User Manual.pdf, ingested 2026-08-29._

## OMRON FZ/FJ EtherNet/IP gotchas (grandfathered machines)

- The EDS version installed in the config tool must match device firmware —
  EDS v1.03 needs FZ/FJ firmware v4.20+; mismatched pairs simply won't
  communicate.
- Changing a station between single- and dual-camera EtherNet/IP mode does not
  reliably resize the I/O connections in place: delete the FZ_Series device
  from the network config and re-add it, or connection 1 (second camera)
  silently fails while connection 0 looks fine.
- Don't delete/reinstall the FZ EDS while the config tool is open — use the
  tool's own EDS install/update flow.

_Source: readme.txt (network: Standards - Software), ingested 2026-08-30._

## FANUC 2D iRPickTool / iRVision commissioning (SDC-STD-PICK-2D-001)

Robot-integrated vision: the camera belongs to the robot controller, not the
PLC device list, but the commissioning judgment is SDC's.

**Node model (fixed hierarchy):** Workcell → Grippers (GRIPPERn/ZONEn) →
Robots (ROBOTn) → Trays (TRAYn) → Conveyors (CONVn, child SENSn = camera
trigger, child CSTNn = pick station) → Fix Stations (FSTNn). Vision process is
always `SDC_STANDARD` (2D single-view, GPM locator); camera calibration
`CAL_CONV<n>`; pick op `OP_CS_CSTNn`, place op `OP_FS_FSTNn`.

**Exposure is a hard ceiling, not a tuning knob:** never exceed 10 ms on any
2D iRPickTool app — motion blur degrades locator scores even on slow belts.
Above 100 mm/sec belt speed, drop to 1 ms and open the aperture to compensate
(re-verify focus; depth of field shrinks), ideally with strobed lighting. Tune
with the belt at production speed — static parts always look fine.

**Pick-angle troubleshooting has a strict causal order; never skip ahead:**
(1) vision model orientation — the GPM teach pose *is* the 0° reference, so
teach the part exactly as the gripper should grip it; (2) calibration residual
(<0.3 mm target — high residual converts directly to world-space angle error
and is the #1 cause of off-angle picks); (3) symmetry confusion — near-
symmetric parts lock onto secondary features at 90°/180°, so tighten angle
range, raise score, weight the asymmetric feature; (4) Tracking Frame
staleness (re-teach via SET TRK FRM); (5) **never** compensate by hand-tweaking
Reference Pos — it masks the defect and drifts with belt speed.

**Trigger Distance (SENSn):** 50–80% of the camera FOV in the belt-travel
direction. Too small → duplicate detections (cross-check CONVn Duplicate
Tolerance, default 10 mm); too large → blind zones where parts pass uncaptured.

**SDC defaults:** GPM score threshold 70 (raise for false picks, lower
cautiously for missed good parts); Approach Offset Z = −50 mm pick and place;
Dynamic Error Adjustment 30.000 (engineering-change-only); Skip Outbound
Motion enabled (FLAG=1); Part Presence Check ENABLED even though the tool
defaults it off, so a missed vacuum pick doesn't carry a phantom part
downstream.

**Acceptance criteria:** calibration residual <0.3 mm, detection rate ≥99%,
pick success ≥98% at full belt speed, discard ≤1%, cycle time within ±5% of
design target.

_Source: SDC_2D_iRPickTool_Setup_Procedure.docx, ingested 2026-08-31._

## What varies per application vs. what (probably) never varies

Never varies: an inspection is a handshake sequence, never one rung; never
trigger before ready; the result is acknowledged, not just read; every verify
result lands in part tracking keyed to the part/nest and is consumed
downstream; the verdict branch is an explicit state decision.

Varies: the intent (verify / data / guide); who hosts the camera (PLC vs
robot); camera family (Keyence standard, Cognex/OMRON grandfathered);
transport and trigger mode; settle/overlap rules; job count and selection;
retry-vs-route-vs-fault; which numerics are stored. That second list is
exactly where the old rule set exploded — which is why this file grows as
understanding, not as more rules.
