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
