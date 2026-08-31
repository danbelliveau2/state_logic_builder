# Vision systems — how SDC thinks about them

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

> **STATUS: DRAFT SCAFFOLD.** This file is assembled from the legacy builder's
> vision handling (pre-standard), the 1116 Molex analysis, and Dan's framing —
> it has NOT yet been taught by the controls leads. Vision is exactly where
> the old rule set "got so crazy": the same camera family shows up in many
> application modes and the rules multiplied instead of the understanding.
> Sections tagged **⟶ ASK THE LEADS** are open questions already seeded in
> the Jarvis question queue. Treat everything here as the best current sketch,
> not settled standard.

## TAUGHT BY THE LEADS (Jason Perry, 2026-08-20, JARVIS_QUESTIONS_FOR_LEADS #6–#11)

The answered questionnaire (`plc-reference/training-material/`) settles most
of the ASK-THE-LEADS tags below — where a section conflicts with this block,
THIS block wins:

- **Standard camera family is KEYENCE.** Trigger via EtherNet/IP; hardwire
  the trigger only for high-speed applications (a conveyor app runs a
  beam-break sensor at 0 ms debounce with the trigger delay entered in the
  camera configuration, not in PLC dwell logic).
- **The handshake is a SIX-step sequence**, not the legacy four-sub-state
  skeleton: 1 wait for demand → 2 check trigger ready → 3 trigger camera →
  4 wait for results → 5 store results → 6 **acknowledge results**. Store and
  acknowledge are real steps the legacy shape lacked. This anatomy holds for
  all modes (answer #10 points job-select/coordinate modes back to it).
- **Coordinates vs pass/fail**: coordinates (an offset OR the absolute
  target to move to) are sent only when the application needs vision
  GUIDANCE of a servo or robot. Verification stations get pass/fail.
  Imaging during motion is a real SDC pattern (Flex Feeder: Fanuc robot
  vision guidance).
- **Result data lives in a standard vision-IO UDT** — convention exists but
  is NOT yet in the standard template; expect it to land there.
- **Retry philosophy**: consecutive-failures counters for ALL inspection
  types (HMI-settable preset). Most verify stations do NOT retry the
  camera; only a camera controlling a process (e.g. box-close verification)
  may add a retry.

## What vision does at SDC

Three intents, and the intent decides the structure:

1. **Verify** — a boolean gate on the process: "is the part located / oriented
   / present / brazed correctly?" Result is pass/fail, consumed by the state
   machine (branch or fault) and usually written into part tracking. This is
   the overwhelmingly common case — in 1116 Molex, five of the sixteen dial
   stations are vision-only verify stations.
2. **Inspect with data** — the job also returns numeric outputs (X_Offset,
   PartCount, temperature…) that get stored, not just judged. Molex stored
   `Location_Verify_Inspect_X_Offset` (REAL, mm) alongside the boolean result
   in the nest-indexed part-tracking record.
3. **Guide** — coordinates are fed forward to correct a motion (offset a
   servo/robot target). The legacy builder never modeled this; it exists in
   real SDC machines. **⟶ ASK THE LEADS**: when do we send coordinates vs.
   just pass/fail, and what receives them?

The engineer's first question about any camera is therefore not "what tags
does it get" but **"who consumes the result, and is the result a bit, a
number, or a correction?"** Everything downstream (states, storage, part
tracking, fault philosophy) follows from that.

## The interface the PLC sees (legacy convention — pre-standard)

The camera is a device with a handshake, not a magic sensor. The legacy
builder's tag set captures the shape of that handshake:

- `q_Trigger{Cam}` — PLC asks for an acquisition
- `i_{Cam}TrigRdy` — camera says it can accept a trigger
- `i_{Cam}ResultReady` — camera says evaluation is done
- `i_{Cam}InspPass` (and per-job `q_Pass_{JobName}`) — the verdict
- `{Cam}TrigDwell` TON — settle time before/around the trigger
- `{Cam}SearchTimeout` — bound on a continuous-search loop

This is a **generic four-wire handshake** (ready → trigger → result-ready →
verdict) and it is the part most likely to generalize. What does NOT
generalize from this file: the physical transport (hardwired IO vs.
EtherNet/IP assembly vs. explicit messaging), job selection, and image vs.
evaluation timing. **⟶ ASK THE LEADS**: per camera family (Cognex/Keyence/
other), how do we actually trigger and acquire — and is "result ready" one
signal or an acquisition-complete + evaluation-complete pair?

## The 4-sub-state skeleton (known convention, historical reference)

The legacy exporter compiles every Vision Inspect node into **four sub-states
at +3 spacing** (N, N+3, N+6, N+9). The step labels tell the story:

1. **Verify Trigger Ready** — wait `i_{Cam}TrigRdy`; don't fire a trigger the
   camera can't take.
2. **Wait Timer** — `{Cam}TrigDwell` settle dwell (part/lighting/motion
   settle) before the trigger.
3. **Trigger** — assert `q_Trigger{Cam}`, wait `i_{Cam}ResultReady`.
4. **Check Results** — branch on the verdict: pass path, fail path, or (in
   continuous-search mode) loop back to sub-state 1 until match or
   `{Cam}SearchTimeout`.

Read this as **trigger → acquire → evaluate → result** made explicit in the
state machine, which is the underlying concept: an inspection is a sequence
with handshakes, never a single rung. The fixed count of 4 and the fixed +3
spacing are legacy conveniences, not physics — a coordinate-feedback or
job-select inspection plausibly needs different states. **⟶ ASK THE LEADS**:
the state structure per mode.

## Motion overlap during exposure

The reason "Wait Timer" exists: the image must be taken with the scene
stable (or deterministically moving). The judgment call is the same one as
servo blending, inverted — **what motion is allowed while the camera is
exposing?** A dial must be locked (shot pin seated / IndexComplete) before a
dial-mounted part is imaged; a flying-trigger application deliberately images
during motion. The legacy builder had no model for this at all — verify
stations just gated on IndexComplete upstream. **⟶ ASK THE LEADS**: the
actual overlap rules (what may move during exposure, and how the settle time
is chosen vs. the fixed 50 ms default).

## Jobs and results storage

- A camera runs named **jobs**; Molex convention was one job per station,
  named `{Station}_Inspect`, camera named `{Station}Cam`. One-camera-one-job
  is the simple case; multi-job cameras need job selection (mechanism
  unknown — **⟶ ASK THE LEADS**).
- **Part-tracking linkage is the canonical result store.** Each vision job
  auto-generates `{deviceName}_Pass` / `{deviceName}_Fail` signals (computed,
  not stored in `project.signals[]`), and its boolean result — plus any
  numeric outputs — is written into the nest-indexed PartTracking record at
  the station's dial position, shifted on IndexComplete, and consumed at
  reject/unload positions one or more indexes later. The verdict's real
  consumer is usually **not the inspecting station** — it's a downstream
  sort. In Molex only 2 of 4 vision jobs were PT-linked; generation should
  link every one.
- Where result data lives beyond part tracking (raw assembly buffers?
  per-job UDTs? HMI display copies?) is not established. **⟶ ASK THE
  LEADS**: result data storage conventions.

## Failure philosophy

Two legitimately different responses to a failed inspection, chosen by
process intent, not by rule:

- **Record and route** — the part is bad, the machine is fine: write FAILURE
  to part tracking, continue the cycle, let the reject station remove it.
  This is the Molex dial pattern.
- **Retry / search** — the result may be wrong (part settling, lighting,
  timing): re-trigger, bounded by `{Cam}SearchTimeout`; only after the bound
  is exhausted does it become a fault or a recorded failure.

When each applies, how many retries, and when a failed inspection should
**fault the station** rather than route the part — unknown. **⟶ ASK THE
LEADS**: retry/fault philosophy on failed inspections.

## What varies per application vs. what (probably) never varies

Never varies (high confidence): an inspection is a handshake sequence, never
one rung; never trigger before ready; every verify result lands in part
tracking, keyed to the part/nest, consumed downstream; the verdict branch is
an explicit state decision.

Varies per application: the intent (verify / data / guide); trigger and
acquisition transport per camera family; the settle/overlap rules; job count
and selection; number of sub-states; retry-vs-route-vs-fault on failure;
which numeric outputs are stored and where.

Everything in the second list is exactly where the old rule set exploded —
which is why this file must grow as understanding (from the leads' answers),
not as more rules.

## HR-X (Keyence-style barcode/2D reader) EtherNet/IP handshake pattern (2026-08-29)

When integrating a barcode/2D-code reader like the HR-X over EtherNet/IP:

- **Ready check**: before triggering a read, confirm the reader isn't busy/erroring (already reading, system busy, system error) via its status word — same idea as any vision system's ready bit.
- **Trigger → Read Complete → Clear handshake**: PLC sets trigger, reader captures/decodes/retries internally, then sets a `Read Complete` bit once result data is valid. PLC must acknowledge by pulsing a `Read Complete Clear` bit (set true after Complete goes true, set back false after Complete drops) — a request/acknowledge pair, not a one-shot.
- **Two data-transfer modes, pick per station need**:
  - *Handshake Disable*: reader pushes result data automatically the instant a read completes — no retrieval logic required, simplest case, use when the PLC just needs the latest read with no queuing.
  - *Handshake Enable*: reader buffers/queues result data internally (supports multiple pending reads with a pending count) and only sends it when the PLC actively requests it via a Retrieve/Latch bit; transfer completes on a Strobe bit, then PLC drops Latch. Use when reads can outpace PLC consumption or exact read-to-data correlation matters.
- **Note**: in Enable mode, Result Data can update even after a *failed* read (result reflects the failure) — don't assume Result Data validity implies read success; always gate on the success/failure bit, not just Complete/Available.

_Source: EtherNetIPSampleProgramGuide(CompactLogix).pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## Barcode/2D-code reader handshake pattern (HR-X / EtherNet-IP smart readers) (2026-08-29)

Some code readers (e.g. Keyence HR-X family) expose a device-side 'Data Handshake' setting with two very different PLC-interaction shapes — worth recognizing when integrating any barcode/2D reader over EtherNet/IP, not just this exact model:

**Handshake Disable (simple case):** the reader auto-pushes result data the instant a read completes; the PLC-side pattern is a simple ack/clear pulse — see `Read Complete` go true, pulse `Read Complete Clear` true then false, done. No retrieval request needed. Data is only valid/updated at that transition.

**Handshake Enable (queued/backlog case):** reads can complete faster than the PLC drains them, so the device queues results internally. PLC must explicitly request each result: raise a Latch bit, device responds with a Strobe pulse carrying fresh data, PLC drops Latch. Update-count / ready-count words let the PLC detect a backlog (reads completed but not yet retrieved) — useful when read rate can outpace PLC scan/retrieval rate.

**Gotcha:** in handshake-enabled mode, `Read Complete`/`Result Data` update on a FAILED read too — completion ≠ success. Read success must be checked from its own dedicated success bit, never inferred from 'data updated.'

**Ready gate:** readers expose a ready/busy status (already reading, busy, error) that must be true before triggering a new read — same busy-interlock pattern SDC already applies to camera/vision triggers elsewhere; treat a smart-code-reader like any other vision device with a trigger/ready/result handshake, just with an extra optional queuing layer if the vendor's handshake mode is enabled.

_Source: EtherNetIPSampleProgramGuide(CompactLogix).pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## RFID data-carrier readers (Balluff BIS M-4006 AOI) (2026-08-29)

RFID read/write heads (e.g. Balluff BIS M-4006-*) are a distinct identification-device type alongside vision systems — they belong in the station's device list, not as plumbing.

- One Studio 5000 AOI instance (`BMC_AOI_PROC_BISM4006`) per physical reader; never share instance data across readers.
- Fixed 128-byte cyclic I/O per reader (Input assembly 100, Output assembly 101) plus a 4-byte Config assembly (CRC, dynamic mode, auto-read vs type/serial, slow-tag detection) that only reloads on download or power-cycle — treat as commissioning-time config, not per-cycle logic.
- Two InOut tags are required: **Carrier** (the read/write data buffer, sized ≥ the bytes actually read/written — default UDT holds 2000 bytes) and **Interface** (command/status setup).
- Job status mirrors the servo/actuator status pattern SDC already uses: OK (reader system ready), IP (in process), DN (done, no error), ER + ErrorCode (faulted, hex code from a fixed vendor table). Wire station fault/retry logic to ER/ErrorCode the same way other devices feed FaultTime/alarm text.
- Vendor error codes (00–36 hex, AF, FF) are fixed and documented — read carrier removed, CRC mismatch, wrong command, timeout, address out of range, etc. Map these into station alarm text rather than inventing new codes.

_Source: BIS_M_4006-034_V5 AOI User Manual.pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## Barcode/2D code readers (EtherNet/IP) — trigger/handshake pattern (2026-08-30)

Barcode/2D code scanners (e.g. Keyence SR-reader family) integrate over EtherNet/IP using the same trigger→busy→complete→clear shape SDC already uses for cameras — treat them as the same device class (a `VisionSystem`/reader device), not a new taxonomy entry.

**Standard cycle:**
1. Check reader Ready (and not Busy/Error) before triggering.
2. Set TriggerInput true to start the read; false cancels it.
3. Reader internally captures → decodes → retries → generates result data.
4. Reader raises ReadComplete (or ReadFailure) once result data is valid/failed.
5. PLC reads ResultData, then pulses ReadCompleteClear true→false to re-arm the reader for the next trigger — never leave Clear latched or the reader won't accept the next trigger.
6. On failure the result-data tag is overwritten with a literal "ERROR" value — don't assume stale/last-good data persists on failure; must be explicitly checked.

**Two configuration modes (device-level setting, capture in the device table like any other config):**
- **Handshake Disable** — simplest; reader auto-pushes result data the instant the read completes. Default for single-reader, no-race stations.
- **Handshake Enable** — reader queues results in an internal buffer; PLC must explicitly request each result via a RetrieveResultData/ResultDataLatch bit, and the reader responds with a ResultDataStrobe when the tag is actually updated (latch→strobe→drop-latch, a generic explicit-request pattern). Enable this mode only when reads can outpace PLC consumption (buffering/pending-count matters) — otherwise Disable is simpler and sufficient.

_Source: EtherNetIPSampleProgramGuide(CompactLogix).pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Barcode/2D Code Reader (SR-Reader) EtherNet/IP Handshake Pattern (2026-08-30)

Some vision-adjacent devices are code readers (e.g. Keyence SR-Reader family) on EtherNet/IP rather than a full vision-system smart camera. Their PLC interaction is a fixed 4-step sequence, distinct from typical vision-trigger/result handling:

1. **Check Ready** — read Busy/Error attribute bits before triggering; reader isn't ready if already reading, busy, or faulted.
2. **Request Start Reading** — set a level-triggered Trigger/Read-Request bit true to start; setting it false cancels the in-progress read. (Reading Mode = Single, Timing Mode = Level Trigger is the standard config — the trigger must be held, it's not a pulse.)
3. **Detect Read Complete** — reader sets Read Complete true once Result Data is populated (success OR failure — a separate Read Failure bit distinguishes which; on failure Result Data is populated with an ERROR value, not left stale).
4. **Access Result Data** — behavior forks on the reader's Data Handshake setting:
   - **Handshake Disable**: reader auto-pushes Result Data the instant Read Complete fires — no extra PLC request needed, just read the tag.
   - **Handshake Enable**: reader queues results in an internal buffer; PLC must pulse a Retrieve/Latch request bit to pull one result at a time. A Result Data Available bit signals a queued result exists; Update/Ready Count attributes expose backlog (results read but not yet retrieved) so the PLC can detect it's falling behind.

**Read Complete Clear is a required acknowledge, not optional cleanup**: after seeing Read Complete go true, the PLC must set Read Complete Clear true, then set it false once Read Complete drops false — this re-arms the reader for the next trigger. A station that never pulses Clear will only ever get one successful read.

This is the reference pattern for any barcode/DataMatrix code-reader integration coming in over EtherNet/IP — use it as the starting shape rather than treating the reader like a generic discrete-trigger vision camera.

_Source: EtherNetIPSampleProgramGuide(CompactLogix).pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## OMRON FZ/FJ series EtherNet/IP EDS version gotchas (2026-08-30)

- When integrating an OMRON FZ/FJ series vision controller over EtherNet/IP, the EDS file version installed in the EtherNet/IP config tool (e.g. Network Configurator) must match the device's firmware version — EDS v1.03 requires FZ/FJ firmware v4.20 or later; older firmware needs the corresponding older EDS file (available from OMRON), and mismatched pairs will not communicate on the network.
- If a station's vision config changes between single-camera and dual/multi-camera EtherNet/IP mode, the I/O connection sizes may not update correctly in place — remove the FZ_Series device from the network configuration and re-add it fresh rather than editing it live, or connection 1 (secondary camera) can silently fail to set even though connection 0 looks fine.
- Don't delete/reinstall the FZ Series EDS file while the EtherNet/IP config tool is open — it can trigger an unintended auto-install; cancel out and use the tool's own EDS install/update menu flow instead.

_Source: readme.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## FANUC 2D iRPickTool / iRVision Commissioning Standards (2026-08-31)

SDC's standard for 2D fixed-camera, line-tracked pick-and-place on a FANUC robot (iRPickTool + iRVision, GPM locator).

- **Exposure discipline**: Snap Tool exposure must NEVER exceed 10ms (motion blur degrades locator scores even on slow belts). Belts faster than 100mm/sec require exposure down to 1ms, compensating with a wider aperture (re-verify focus — depth of field shrinks) and, ideally, strobed rather than continuous lighting.
- **Calibration**: grid-pattern camera calibration against a flat dot grid at pick height; SDC target residual < 0.3mm. High residual is the #1 cause of off-angle/off-center picks — recalibrate before touching anything else.
- **GPM model orientation IS the 0° reference**: teach the part model oriented exactly as the gripper should approach it. Never compensate an angle error downstream in the robot's Reference Pos — that masks the real defect and causes angle drift as belt speed changes. Root-cause order for pick-angle problems: (1) vision calibration residual, (2) vision model orientation, (3) Tracking Frame, (4) Reference Pos teach — in that order, never skip ahead.
- **Near-symmetric parts** (e.g. subtle logo, chamfered square) can lock onto secondary features at rotated offsets — tighten angle search range, raise score threshold, weight the locator on the unique asymmetric feature.
- **SDC defaults**: GPM Score Threshold = 70 (raise for false picks, lower cautiously for missed good parts); Duplicate Tolerance (on the conveyor object) = 10mm; sensor Trigger Distance = 50-80% of camera FOV in the belt-travel direction (smaller → duplicate detections, larger → blind zones where parts pass uncaptured).
- **Naming**: vision process = SDC_STANDARD (2D single-view, GPM locator); camera calibration = CAL_CONV<n>.
- **Acceptance criteria** used at commissioning: detection rate ≥99%, pick success ≥98% at full belt speed, discard rate ≤1%, cycle time within ±5% of design target.

_Source: SDC_2D_iRPickTool_Setup_Procedure.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## FANUC iRPickTool 2D Conveyor Pick — Commissioning Rules (2026-08-31)

## iRPickTool 2D line-tracking commissioning (SDC-STD-PICK-2D-001)

**Node model (fixed hierarchy):** Workcell → Grippers(GRIPPERn/ZONEn) → Robots(ROBOTn) → Trays(TRAYn) → Conveyors(CONVn, child SENSn = camera trigger, child CSTNn = pick station) → Fix Stations(FSTNn). Vision process is always named `SDC_STANDARD` (GPM locator). Pick op = `OP_CS_CSTNn`, place op = `OP_FS_FSTNn`.

**Exposure is the #1 lever for tracked-belt vision, and it's a hard ceiling, not a tuning knob:** never exceed 10ms exposure on any 2D iRPickTool app (motion blur degrades locator scores even on slow belts). For belt speed >100mm/sec, drop exposure to 1ms and open the aperture to compensate (re-verify focus — depth of field shrinks). Tune exposure with the belt running at production speed, not static — static parts always look fine.

**Pick-angle troubleshooting has a strict causal order — never skip ahead to a workaround:**
1. Vision model orientation (the GPM "teach" pose becomes the 0° reference the gripper approaches at — teach it with the part oriented exactly as the gripper should grip it)
2. Calibration residual (<0.3mm target; a high residual converts to world-space angle error)
3. Symmetry confusion (near-symmetric parts match at 90°/180° offsets — tighten angle range, raise score, weight the asymmetric feature)
4. Tracking Frame staleness (skews with belt speed if wrong — re-teach via SET TRK FRM)
5. NEVER compensate any of the above by hand-tweaking Reference Pos — it masks the true error and the pick will drift as belt speed changes; only teach Reference Pos after vision/calibration/frame are confirmed clean.

**Trigger Distance (SENS1) sizing:** set to 50–80% of the camera's field-of-view in the belt-travel direction. Too small → duplicate detections (also cross-checked against CONV1 Duplicate Tolerance, default 10mm). Too large → blind zones where parts pass uncaptured.

**SDC default values worth knowing without re-deriving:** GPM score threshold 70; calibration residual target <0.3mm; Approach Offset Z = -50mm (pick and place); Dynamic Error Adjustment 30.000 (engineering-change-only); Skip Outbound Motion enabled (FLAG=1); Part Presence Check — SDC recommends ENABLING it even though the tool default is disabled, so a missed vacuum pick doesn't carry a phantom part downstream.

**Acceptance criteria for a commissioned 2D pick cell:** calibration residual <0.3mm; vision detection rate ≥99%; pick success rate ≥98% at full belt speed; discard rate ≤1%; cycle time within ±5% of design target.

_Source: SDC_2D_iRPickTool_Setup_Procedure.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._
