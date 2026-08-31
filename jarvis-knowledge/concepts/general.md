# General — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Seeded by the correction-learning loop — deepen into full engineer's-
understanding prose as the concept matures.

## Learned from corrections
- (2026-08-24, from Dan's correction of build b_mt3bnrp3_7yxhic [import-failure lesson — Jarvis self-diagnosis]) L5K aggregate initializers are balanced-bracket structures: the closing-bracket depth at the tail must exactly equal the opening depth (element-close + array-close + the `]]>` CDATA delimiter). Count brackets structurally, never by eye — one missing 0x5D invalidates the whole aggregate.
- (2026-08-24, from Dan's correction of build b_mt3bnrp3_7yxhic [import-failure lesson — Jarvis self-diagnosis]) When editing content near a CDATA or aggregate boundary, preserve the template's terminator region byte-for-byte and never reflow or merge the delimiter line onto adjacent tags; structural delimiters are not cosmetic whitespace.
- (2026-08-24, from Dan's correction of build b_mt3bnrp3_7yxhic [import-failure lesson — Jarvis self-diagnosis]) The Decorated block agreeing element-by-element does not validate the L5K block; they are independent encodings and each must be independently balanced, so verifying one gives no assurance about the other.
- (2026-08-25, from Jason's correction of build b_mt7qbdtl_7i0izo) Rung comments should name the physical action or destination the state performs ('Move Z Axis To Retract Position') rather than describe segment mechanics or justify implementation choices; commentary that explains why a state was omitted from a list becomes stale when the design changes.
- (2026-08-25, from the fix loop (tuition)'s correction of build Test_Project_v2 / ServoPNP [tuition]) Before writing any updateRung, resolve the anchor against the FULL template extract, not just the rung being changed: an anchor is only valid if it appears exactly once in the whole routine. Array-element references like AlarmList[i], Alarm[i].Active, or Positions[i] are the classic trap — the same index appears in both the servo-alarm block and the station-alarm block of R20 (ServoAlarmList[0] rungs and AlarmList[0] rungs both contain the literal 'AlarmList[0]' because one string is a substring of the other). Substring containment, not just repetition, is what makes an anchor ambiguous.
- (2026-08-25, from the fix loop (tuition)'s correction of build Test_Project_v2 / ServoPNP [tuition]) When targeting one rung out of a repeated family (per-index alarm rungs, per-state staging branches, per-axis boilerplate), pick an anchor that is unique by CONSTRUCTION rather than hoping it is unique: use the rung's distinguishing operand (e.g. 'ONS(ONS.11)' or the specific Status.State[n] list) or pin it up front with nearComment. Cheap insurance costs nothing; an ambiguous anchor costs a whole fix round.
- (2026-08-25, from diagram review of MagnetLoad) A wait state whose compiled intent has TWO real outcomes must draw both exits: state 34 (Wait For Pick Head To Take Magnet) was drawn single-exit, silently dropping the Pick-Abandoned failure path the intent defines. Review branching against the intent, not just the drawn edges.

## Banner Q4X IO-Link Laser Sensor — Data Map Reference (2026-08-29)

When a station uses a Banner Q4X IO-Link laser distance sensor, its IO-Link interface has a fixed shape worth knowing at PLC-integration time:

- **Process Data In (cyclic, device→master, 16 bits, ~2.7ms)**: bit layout is distance (13-bit, in tenths of a mm), stability bit (0=no target/marginal, 1=stable), and two output-channel state bits (ch1/ch2 active/inactive). This is the only cyclic data — there is no Process Data Out; all configuration is acyclic.
- **Acyclic parameters** (read/written by index/subindex, not the process image): setpoints (BDC1/BDC2 SP1/SP2), switch logic, hysteresis, response speed, gain, teach offset mode, delay mode/timers, pushbutton lockout, and diagnostic status (measurement value, excess gain %, stability, laser fault status). These map to IO-Link master acyclic read/write blocks, not standard IO tags.
- **Teach-in sequence**: write a Standard Command code to index 2 (e.g. 65=single value teach, 67/68=two-value teach TP1/TP2, 71/72=dynamic teach start/stop, 79=exit teach), then poll index 59 (Teach State + TP1/TP2-taught bits) to confirm completion — this is the standard pattern for programmatically teaching a Q4X without the local display.
- **Model-dependent ranges**: setpoint/offset/window value ranges scale with the specific Q4X variant (100/110/300/310/600/610mm) — same parameter index across models, different valid mm range; don't hardcode one model's range as universal.
- **Events**: two IO-Link event codes are defined — 0x6320 parameter error, 0x8d00 laser fault (laser shut down for safety) — these are natural candidates to surface as station alarms when a Q4X drives a fault condition.

This is vendor-datasheet knowledge, not a controls-judgment pattern — relevant only when a station's device table includes a Q4X IO-Link sensor and JARVIS needs to map its process data / parameters into PLC tags and alarms.

_Source: Q4X IO-Link Data Reference Guide 198185.pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## SICK AFX60 encoder AOI — async CIP-parameter pattern (vendor reference) (2026-08-30)

When a station uses a SICK AFS60/AFM60 absolute encoder (e.g. on a rotary table or non-servo axis needing absolute position beyond normal cyclic I/O), device configuration/diagnostic parameters — position limits, preset value, temperature, warnings, speed limits — are NOT part of the encoder's cyclic process data. They're read/written through the vendor's SICK_AFX60 AOI using non-cyclic CIP Generic messaging (Get/Set Attribute Single).

Key mechanics worth remembering if this device shows up on a station:
- The AOI is asynchronous: it must be called every PLC scan until it reports done (bReadDone/bWriteDone) — this is a different execution model than SDC's normal one-shot rung logic.
- One GetMessage and one SetMessage MSG instance per encoder, each configured once (Class/Instance/Attribute = 1, pointer to the encoder's data-structure array) — do not reuse the same MSG instance for multiple simultaneous commands (a common vendor error: 'Invalid attribute/class read out' = MSG instance reused).
- Parameter selection is bitwise: set bits in GetData.Selection / SetData.Selection (or ReadAll) before triggering bRead/bWrite; multiple parameters can be batched in one rising edge.
- Error reporting is layered (module error / message error / extended message error packed into one DINT) — useful vocabulary for diagnosing comms faults on this device family.
- Default AOI timeout is 5000ms — a vendor-side setting, not to be confused with SDC's own Control.FaultTime standard, which is separate and still applies at the station level.

_Source: AFX60_AOI_EN.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Third-party smart-device parameter access via vendor CIP Generic AOI (SICK AFX60 example) (2026-08-30)

Some smart sensors/encoders (e.g. SICK AFS60/AFM60 absolute encoders on EtherNet/IP) ship a vendor AOI for reading/writing device configuration and diagnostic parameters — separate from the device's cyclic I/O data. Pattern to recognize when a station uses one of these:

- The AOI runs as an **asynchronous, multi-scan ST routine** — it must be called every scan until its Done/Error outputs settle; it is not a one-shot instruction.
- Uses **CIP Generic explicit messaging** (MSG instructions configured as Get/Set Attribute Single) rather than the device's normal cyclic produced/consumed data — this is for accessing param data the standard I/O tree doesn't expose.
- Parameter access is **selection-bitmask driven**: a Selection sub-structure flags which parameters to read/write in a given pass, and only flagged parameters populate/consume their value fields.
- Read and write sides are independent triggers (rising-edge bRead/bWrite) with their own Done/Error/Errorcode outputs; errors latch until the next triggered action.
- Typical timeout default for this class of async vendor messaging: 5000ms — same order as SDC's own fault-timer default, worth using as the default if the vendor doesn't otherwise dictate.

This is a vendor-integration reference, not an SDC design pattern — file the specific device's AOI details here only if/when a station actually integrates that device; otherwise this is dormant reference knowledge.

_Source: AFX60_AOI_DE.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SICK AFx Absolute Encoder Integration (EtherNet/IP + Web Server) (2026-08-30)

When a station uses a SICK AFS60/AFM60 EtherNet/IP absolute encoder (a standalone absolute position feedback device, not a servo-drive-integrated encoder), SDC's controls integration follows the vendor's ladder-routine pattern rather than a custom AOI:

- The vendor ships a matched L5X ladder routine keyed to the encoder's configured Assembly Object instance (101WS/103WS use one file, 102WS uses another) — pick the file matching the instance set in the module's EDS configuration.
- Import it as a component, then integrate it into MainRoutine as a SubRoutine via JSR — this is how the encoder's config gets bridged into the PLC scan, not a native instruction.
- Encoder parameters live in two places that mirror each other: PLC Controller Tags (`SickAFxWS_Enc1_GetData` for read, `SickAFxWS_Enc1_SetData` for write) and the encoder's built-in web server Parameterization page. Either side can change values; the web browser needs a manual refresh to reflect PLC-side edits.
- Multiple encoders on one project each require their own import pass with a unique Final Name and renamed Tag References (e.g. `...Enc1...` → `...Enc2...`) — the vendor routine is not multi-instance-aware out of the box.
- A toggle-bit Init step (SickAFxWS_Enc1_Init_GetSet) closes/reopens the connection so configuration can be written from either the PLC or the web UI.
- Changing the encoder's preset (position) value takes effect the instant Enter is pressed — treat like any live position write: check for machine hazard first.

_Source: 8014213_Installation_LadderRoutine_AFxEtherNetIP_en.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SICK AFX60 absolute encoder — acyclic parameter AOI (2026-08-30)

When a station uses a SICK AFS60/AFM60 EtherNet/IP absolute encoder and needs device parameters beyond the standard cyclic process data (position/velocity limits, preset value, temperature, warnings, operating-time diagnostics), SDC integrates via the vendor-supplied `SICK_AFX60` Add-On Instruction rather than custom messaging:
- Uses CIP Generic explicit messages (Get Attribute Single / Set Attribute Single) under the hood — async, spans multiple scans, must be called every scan until done.
- Edge-triggered `bRead`/`bWrite` inputs select and execute a read or write of whichever parameters are flagged `1` in the `GetData.Selection` / `SetData.Selection` sub-structures (or `ReadAll` for everything).
- Completion/error reported via `bReadDone`/`bWriteDone` and `bReadError`/`bWriteError` + 32-bit error codes (block error, MSG error, extended MSG error).
- Default timeout 5000 ms is this AOI's vendor default, not an SDC standard — don't conflate with `Control.FaultTime`.
- This is a niche, device-specific mechanism (absolute encoder parameterization) — not part of the standard servo/motion or sensor device patterns; only relevant if a station actually carries this SICK encoder model.

_Source: AFX60_AOI_DE.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Modbus TCP Server AOI (Rockwell) — implementation rules (2026-08-30)

When a station or machine needs to expose Modbus TCP slave data (e.g. to a SCADA/MES client), SDC uses Rockwell's Modbus TCP Server AOI rather than hand-rolled socket code. Key mechanics to respect:

- **Import method matters**: the AOI ships as a Rung Import (.L5X). It MUST be added via Import Rungs — never Copy/Paste, never dragged in from the Instructions toolbar. Those paths strip the pre-configured MSG instruction parameters and leave the AOI non-functional. Tag renaming (prefix swap) is only safe during the import's Find/Replace step, not after.
- **Instance limits**: only one Server AOI instance per CompactLogix controller (5370/5380/5480). ControlLogix (1756) can host one instance per 1756-EN2T(R) module used, but each instance needs its own independent set of data tags.
- **Task rate**: run the AOI in a Periodic task at 10ms (default/recommended). Slower rates reduce Modbus performance; faster rates load the controller more. The server needs 2 periodic scans to service each Modbus transaction.
- **Performance is a formula, not a guess**: worst-case delay to a client ≈ (sum of active transactions across all connected clients) × 2 scans × periodic task rate. E.g. two clients with 3 and 4 active transactions at 10ms task rate ≈ 140ms worst-case delay.
- **Memory budgeting**: ~123KB for the first instance, ~40KB per additional instance (5570-family baseline) — worth checking against small CompactLogix memory budgets (some start at 384KB).
- **Config surface**: Ref_Connection parameter needs LocalSlot (EN2T slot, or L8xE controller slot, or 0 for CompactLogix 5370/5380/5480) and LocalAddress (blank unless CompactLogix 5380/5480 Dual-IP). Toggle Inp_Enable off/on after changing any connection parameter live. Standard Modbus TCP port 502.
- **Monitoring**: Sts_EN (enabled), Sts_Waiting (listening), Sts_Accepted (client connected & servicing), Sts_Faulted (a MSG instruction faulted), Sts_ActiveConnections (client count). Actual Modbus data lives under Ref_ModbusData, split into coil/discrete-input/input-register/holding-register regions the host application reads/writes freely.
- **Coexistence caveat**: Server and Client AOIs can share a program, but server traffic can cause temporary client disconnects (shared Logix Sockets object). In a Redundancy system, expect ≥5s Modbus comm loss on controller switchover.

_Source: Modbus TCP Server - AOI based code for ControlLogix v 2.02.00.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Modbus TCP Server AOI integration (Rockwell, when a station must act as a Modbus TCP slave) (2026-08-30)

When an SDC station needs to expose PLC data to an external Modbus TCP master (e.g. a plant SCADA, a customer's line controller), Rockwell's Modbus TCP Server AOI is the standard mechanism — key implementation rules to enforce:

- **Rung Import only.** The AOI ships as a pre-configured rung with MSG instructions already wired up. Copy/paste or adding it via the Instructions toolbar silently strips that MSG configuration and produces a non-functional AOI. Always import via Import Rungs → select the .L5X → rename tags via Find/Replace in the import dialog (never rename after import).
- **Instance limits.** Only one server instance per CompactLogix (5370/5380/5480). ControlLogix (1756) may run one instance per 1756-EN2T(R) module, each with its own independent set of data tags — don't share Ref_ModbusData across instances.
- **Task placement.** Put the AOI in a Periodic task, 10ms recommended. Faster increases controller load; slower increases Modbus response latency. Latency formula: (sum of active transactions across all connected clients) × 2 scans × periodic rate — useful for estimating whether a Modbus-polled station can meet a customer's response-time spec.
- **EtherNet/IP module linkage.** Ref_Connection parameters (.LocalSlot, .LocalAddress) must point at the local Logix-Sockets-capable EN2T(R)/embedded port; CompactLogix always uses LocalSlot 0. Changing these parameters live requires a Inp_Enable reset-then-set cycle.
- **Data mapping.** Ref_ModbusData exposes four independent regions (0xxxx coils, 1xxxx discrete inputs, 3xxxx input registers, 4xxxx holding registers) that the station's own logic reads/writes freely — this is the integration point where SDC application tags get mapped to Modbus addresses for the external master.
- **Redundancy caveat.** Expect ≥5s Modbus comms loss after a ControlLogix redundancy switchover attributable to this AOI alone — factor into any failover-timing analysis for a redundant station.

_Source: Modbus TCP Server - AOI based code for ControlLogix v 2.02.00.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Modbus TCP Client AOI (Rockwell) — integration notes (2026-08-30)

When a station or supervisor talks Modbus TCP to a third-party device (VFD, scale, PLC, etc.) via the Rockwell Modbus TCP Client AOI, the following are implementation-critical, not optional tuning:

- **Rung Import ONLY** — implement via Import Rungs using the supplied .L5X. Copy/paste or adding via the Instructions toolbar strips the pre-configured Message instruction data and makes the AOI non-functional. Tag renaming happens only during the import's Find/Replace step, never after.
- **Periodic task**: run the AOI in a periodic task at 10ms (or slower). Faster rates buy performance at a real controller-load cost.
- **Memory footprint**: ~93KB for the first AOI instance, ~20KB per additional instance (L5570 baseline) — a real constraint on small CompactLogix controllers starting around 384KB.
- **Data format**: standard Modbus big-endian (MSB first).
- **Function codes supported**: bit-level 01 (read coils), 02 (read discrete inputs), 05 (write single coil), 15 (write multiple coils); word-level 03 (read holding registers), 04 (read input registers), 06 (write single holding register), 16 (write multiple holding registers). Local address range 0-1023 per transaction; server address range 0-65535 (extended from a 0-9999 cap in AOI versions before 2.2.0).
- **PollInterval floor**: 80ms minimum per transaction; the practical floor scales with the number of enabled transactions (roughly 80/130/220/300/380ms for 1-5 transactions on an L7x at a 10ms periodic task). Too-aggressive settings first show as Sts_Overlap (transaction not completing before next trigger), then Sts_Overload (persistent overlap — must slow the PollInterval) when marginal becomes chronic.
- **Status/diagnostics**: Sts_EN (enabled), Sts_Connected (TCP accepted — does NOT prove active data flow, check per-transaction status), Sts_Faulted (a Message instruction faulted), Sts_Overlap, Sts_Overload. Per-transaction TransStatus: 0=success, 1=in process, 2=retry, -1=exception.
- **Multi-instance rules**: multiple Client AOI instances per controller are fine; each needs its own backing tags and Message instructions, but the '_Data' tag structure can be shared across instances. A Client and Server AOI can coexist in one program, but Server activity can cause temporary Client disconnects (shared Logix Sockets object). In a redundancy system, expect ≥5s of Modbus comms loss after a controller switchover.

_Source: Modbus TCP Client - AOI based code for ControlLogix v 2.02.00.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## VFD network control: hardwired functions can survive 'network enable' (2026-08-30)

When integrating any Ethernet-fieldbus VFD (e.g. Lenze i550 via EtherNet/IP/PROFINET/EtherCAT) under PLC network control, don't assume the network control word owns 100% of the drive: some safety/critical functions (inverter enable, run/stop, quick stop, fault reset, DC brake) can remain gated by local hardwired inputs or parameters even after 'network enable' is asserted, unless an explicit 'network control enable request' bit is also set. Always check the drive's control-word truth table for which bits are actually processed under network control before wiring PLC logic that assumes full network ownership — a lesson generalizable beyond this specific inverter.

_Source: EthernetBus_i550_Lenze_en_2015_12_14_V0.1.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._
- (2026-08-31, from diagram review of MidBaseLoad — MidBaseLoad) Escapement_Finger_2 is declared as a device but is never actuated in any node — no Extend, no Retract, anywhere in the 18-state sequence. This is the same broken-shape defect as a declared handshake signal with no producer/consumer: a physical actuator with zero commanded rows is dead on the diagram, and an escapement that only ever moves one of its two fingers is very likely missing the alternating-finger singulation logic real escapements need. Correct shape: Either add the Escapement_Finger_2 Extend/Retract rows at the correct points in the singulation sequence (paired/alternating with Finger_1 as the mechanism requires), or remove the device if it truly isn't used and document why.

## EE Hardware Selection Standards (2026-08-31)

SDC's default hardware stack for new builds (per EE Process and Standards):

- **PLC platform**: Allen-Bradley by default. Safety functionality on AB projects uses Compact GuardLogix or GuardLogix.
- **Safety expansion**: Banner safety expansion relays, wired in bipolar mode — not Omron safety relays.
- **Non-AB safety**: Keyence safety PLCs only on non-AB projects (e.g. First Solar). Guard door switches standardize on Keyence GS-M51P.
- **On-machine IO**: SMC EX600 is the primary platform, not IO-Link-first — the EX600's own IO-Link module covers IO-Link device needs.
- **24VDC power**: Puls CP series (CP5.241/5A, CP10.241/10A, CP20.241/20A most common).
- **Circuit breakers**: Noark.
- **Servo drives**: AB 5300 or 5500 series standard. 5100 series allowed case-by-case — e.g. an already-purchased PLC out of motion axes, cost reduction on many repeated simple-motion applications, or repeat jobs.

Duplicate machines or exceptions may grandfather older hardware standards, but new builds should default to the above.

_Source: EE Hardware Specification Regulations.docx (network: EE Process and Standards Documents), ingested 2026-08-31 by the inbox librarian._
- (2026-08-31, from the fix loop (tuition)'s correction of build PNP_ServoX- PneumaticZ / MidBasePickAndPlace [tuition]) renameTag rewrites rung text and tag declarations, but the merge engine protects some declaration classes (physical IO parameters with i_/q_ prefixes among them) from being renamed. A rename that silently succeeds in rungs but not in the declaration produces an undeclared-identifier error that only shows up after merge. Before planning any rename of a parameter-class tag, treat the declaration as unrenameable: use addTag for the new name, rewrite the referencing rungs explicitly, and leave the old declaration alone. Renames are safe for local program tags (AOI backing instances, timers, RangeCheck instances); they are not a general-purpose refactor across parameter declarations.
- (2026-08-31, from the fix loop (tuition)'s correction of build PNP_ServoX- PneumaticZ / MidBasePickAndPlace [tuition]) Every destructive tag operation must be treated as having a blast radius beyond its named target — a removeTag can take the adjacent declaration with it, so removing a template tag can break unrelated boilerplate (a Single-Step ONS bit, a debounce instance) that no rung of the plan ever touched. Removal is only warranted for a genuine unused DEVICE (its routine, axis, HMI and motion tags); a spare scalar the template declares and nobody references costs nothing and must be left in place. Scope deletions to devices, never to tidying up stray tags.
