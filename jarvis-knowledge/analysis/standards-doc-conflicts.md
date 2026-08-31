# Standards-document conflicts — for Dan to adjudicate

> **ADJUDICATED 2026-08-21 per Dan's authority ruling** (recorded in
> `src/lib/agentGenerator/meKnowledge.md`): the CE-authored standards documents
> are the design authority — "use the document those guys generated, whatever
> it says." Where a document contradicts Dan's relayed statements or the app's
> legacy conventions, the document wins. Document-vs-TEMPLATE conflicts (both
> CE-authored) remain OPEN questions for the leads. Per-conflict status below.

Logged by the standards ingestion run, 2026-08-21. Sources compared:
`plc-reference/standards-docs/EE Process and Standards Documents/PLC Software
Standardization, Rev2` ("the doc", 2026-05-06), the V4.2 templates in
`plc-reference/standard/`, CLAUDE.md / docs/architecture.md (the app's rule
engine docs), and jarvis-knowledge concepts. Nothing below was silently
resolved; concepts cite the doc only where doc and templates agree.

## C1 — Sequence start state: 4 (doc + templates) vs 1 (app docs / l5xExporter)

**RESOLVED 2026-08-21 — adopt the document.** Sequence states start at 4,
spaced +3; 0 = Safety Stop, 1 = Manual, 2 = Auto Idle Not Ready, 3 = Auto Idle
Ready. Implemented: `computeStateNumbers.js` default start is now 4 (UI now
matches the legacy exporter, which already put the first flowchart state at 4
via `advanceStep`); CLAUDE.md / docs/architecture.md wording corrected;
`ir.js` already used STATE_BASE = 4 — no change needed there.

The doc (§19) and ALL V4.2 templates agree: states 0/1/2/3 are Safety
Stop / Manual / Auto Idle Not Ready / Auto Idle Ready, and the working
sequence starts at **state 4**, spaced +3 (4, 7, 10, …). Template state maps
confirm (S01_PartLoad, S05_ServoPNP: 0 1 2 3 4 7 10 … 99 100 103 106 124 127).
CLAUDE.md and docs/architecture.md instead say "Step — base 1, increment +3
(1, 4, 7, 10...)" with 1–3 merely "reserved", and the legacy l5xExporter
numbers diagram steps from 1. **The diagram/UI numbering and the old rule
engine disagree with the standard.** Jarvis's agent-path concepts already
follow the templates (state 2 idle, sequence from 4); the app-side step
numbering needs a decision: renumber, or map diagram-step→StateReg at
compile.

## C2 — What is state 127? (doc says 124 = init complete; app docs say 127)

**RESOLVED 2026-08-21 — by the controls leads (Jason Perry, 8/20/26,
CONTROLS_LEADS_QUESTIONS answer #17): on fault, "State machine goes into
state 127."** 127 IS the fault state; 124 = initialization complete. There is
no standard recovery path out of 127 — "completely dependent on
machine/station conditions" (engineer/agent judgment per station). The same
questionnaire (#2) also fixes the sequence ceiling: **active sequence states
are 4–99** — state assignments beyond 99 are a defect the leads called out
in generated code. App docs' "127 = cycle-ready" wording was stale.

The doc's standard-state list ends at "State 124 – Initialization Complete"
and never mentions 127. CLAUDE.md/architecture.md call 127 the
"init-complete / cycle-ready gate". The V4.2 templates use 127 as the
FAULT/RESTART state (R02: fault ONS + LIMIT(4,StateReg,99) → MOVE 127;
concepts/alarms.md documents this). Three meanings in circulation. Template
behavior (127 = fault/recovery entry, 124 = init complete/known safe) looks
authoritative; the app docs' description of 127 appears stale. Needs Dan's
confirmation before anything "cleans up" either side.

## C3 — ProgramAlarmHandler version: doc mandates "3.0 a", X drive ships 3.1

**OPEN — version question stays queued for the leads** (2026-08-21).

Doc §11: "must contain the ProgramAlarmHandler AOI, version 3.0 a". The X
drive standard folder contains `ProgramAlarmHandler v3.1.L5X` (Revision 3.1,
alongside an older unversioned copy), while the V4.2 full template embeds
Revision 3.0. Which is current for new projects — 3.1 standalone or the
3.0 embedded in V4.2? (The Revision History notes an AlarmHandler timestamp
fix on 2026-05-29 inside V4.0; version stamps may lag fixes.) Question filed.

## C4 — Servo routine naming: doc generic vs template per-axis (minor)

**SELF-RESOLVED** — doc §20 itself mandates per-axis split; §5's single name
is an unrevised example. Per-axis routines (R04_XAxisServo, …) stand.

Doc §5 lists a single "R04_StateLogicServo"; the templates (and the app) use
one routine PER AXIS: R04_XAxisServo, R05_ZAxisServo. Doc §20 itself says the
servo routine "is always split out on a per axis basis", so the §5 name reads
as an unrevised example. Following templates; no action expected — noted for
completeness.

## C5 — Verify-station machinery the generator doesn't emit yet (gap, not conflict)

**RESOLVED 2026-08-21 — MUST be generated.** Dan: "they're really needed."
Everything the standard requires per verify station (consecutive-failures
counter with fault, stuck-ON detection, bypass toggle, lockout warnings,
failure-type codes into nest tracking) is queued as CAPABILITY WORK for the
generation pipeline. Not yet implemented as of this adjudication.

Doc §23/§28 REQUIRES per-verify-station: consecutive-failures counter
(default 3, HMI-settable) with its fault, stuck-ON detection fault, bypass
toggle (result ignored, success bit forced), lockout warning messages, and
failure-type codes (station# + failure#) written into nest tracking. Neither
the legacy exporter nor the Jarvis pipeline generates these today. Also note
doc: verification sensors are ALWAYS wired ON = pass — the app's generic
"Verify Off" decision mode is fine for interlocks but a verification
station's pass condition must be an ON.

## C6 — Doc supervisor-state names vs app "reserved 1–3" (same root as C1)

**RESOLVED 2026-08-21 — stale wording fixed.** CLAUDE.md "Step Counter" and
docs/architecture.md now name states 0-3 per Rev2 §19 (Safety Stop / Manual /
Auto Idle Not Ready / Auto Idle Ready) and cite the doc.

Doc's Supervisor minimum mode list (Safety Stopped, Manual, Auto Idle, Auto
Running, Cycle Stopping, Cycle Stopped) and the per-station states 0–3 give
real meanings to numbers CLAUDE.md calls "reserved for future SDC use".
CLAUDE.md wording should eventually be corrected — flagged rather than edited
because CLAUDE.md is Dan's ground-truth file.

## Between-document notes (no contradictions found)

- Pneumatic guide, servo guidelines, sensor list, and the PLC doc are
  mutually consistent and consistent with meKnowledge defaults (retract-only
  sensing, delay timers, HMI-adjustable motion values).
- Hardware Specification Regulations: EX600 (not IO-Link) is the primary
  on-machine IO platform — matches the pneumatic guide's EX600-first stance;
  EX260/IO-Link is the exception when an IO-Link solution is already present.
