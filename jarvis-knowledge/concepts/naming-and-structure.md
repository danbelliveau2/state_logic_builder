# Naming & program structure — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Source: "PLC Software Standardization, Rev2" (2026-05-06, Jason Perry / Tim
Wilmot) in `plc-reference/standards-docs/` — the CE department's own guide.
**Authority (Dan's ruling, 2026-08-21): the CE documents are the design
authority** — "use the document those guys generated, whatever it says";
where a document contradicts Dan's relayed statements or the app's legacy
conventions, the document wins. Document-vs-TEMPLATE disagreements (both
CE-authored) are the one remaining flag-don't-guess case — file them in
`jarvis-knowledge/analysis/standards-doc-conflicts.md` for the leads.

## Programs mirror the part's journey

The main task is organized upstream → downstream, following the part (§3).
One Supervisor program owns mode switching (minimum states: Safety Stopped,
Manual, Auto Idle, Auto Running, Cycle Stopping, Cycle Stopped). Each station
gets its own program; complicated or asynchronous stations are SPLIT into
multiple programs, because the hard rule is **one state machine per program**.
A station that needs two independent sequences is two programs, not one
program with two interleaved state variables.

Program names: `S{nn}_{Descriptive}` for indexing-machine stations
(S01_PartLoad), `P{nn}_{Descriptive}` for non-indexing processes
(P01_WireFeed). Routines: `Rxx_` prefix so they sort in logic-flow order —
R00_Main (JSRs only), R01_Inputs, R02_StateTransitions, R03_StateLogic,
R04+ per-axis servo routines, R20_Alarms.

## Tags: scope prefixes, PascalCase, locality

PascalCase, no data-type prefixes on Allen-Bradley (§6). Scope prefixes:
`g_` controller/global, `p_` public parameter, `i_` input parameter, `q_`
output parameter, `iq_` InOut. Local program tags have NO prefix
(`XAxisExtendedDebounce`, a local TIMER). The intent (§7): default to LOCAL
tags; parameters are for physical IO and program handshakes; controller tags
only for genuinely global values. Aliases are avoided (can't change without
a download); InOut only where forced (AOIs, CIP axis refs). AOI backing tags
get no prefix — just a descriptive name.

Physical IO is always a parameter: `i_XAxisExtended`, `q_ExtendXAxis`,
`q_CloseGripper` (§8) — verb-first for outputs, state-past-tense for sensor
inputs.

Network devices (§9): prefix + sequential number + station description —
`sd02_S01PNPXAxis` (servo drive), `vb01_BoxErector` (valve bank), `io`, `cam`,
`rob`, `fd` (VFD), `gd` (generic 3rd party). CIP motion axes (§10):
`a02_S01PNPXAxis`.

## State logic shape (what the document adds to the templates)

- Standard states every station carries (§19): 0 Safety Stop, 1 Manual,
  2 Auto Idle Not Ready, 3 Auto Idle Ready, 99 Lockout, 100 init start,
  124 init complete — and the working sequence starts at state 4, spaced
  +3 per step (4, 7, 10 …) to leave room for debug insertions.
  **RESOLVED, unambiguous (Dan's ruling, 2026-08-21, conflicts file C1):**
  this IS the numbering — sequence states start at 4; states 0-3 are the
  fixed supervisor-mode states above and are never assigned to sequence
  steps. The app's old "home = state 1" convention is retired; the UI and
  `computeStateNumbers` now number the home/initial node 4. (State 127's
  meaning — doc vs templates — is still OPEN, C2; interim = templates.)
- ONE state transition per rung; every condition for entering that state
  sits in series/parallel ahead of the single transition (§19).
- Transitions decide, State Logic acts: all in-state actions live in
  R03 (§19/§20). R03 prefers coils over latches; where a latch is genuinely
  simpler, its unlatch lives in the adjacent rung (§20).
- Optimize the COUNT of states: as few transitions as clarity allows,
  never convoluted merges to save a state (§19).

## Axis names are machine directions, not descriptions
*(Jason Perry review of v5 — SDCServoPNP_JARVIS_v5, 2026-08-24, item 1)*

A servo axis's program identity is its **single-letter machine direction**:
`XAxis` (horizontal traverse), `ZAxis` (vertical), `YAxis`, `RAxis` (rotary) —
exactly as the templates name them (S05's R04_XAxisServo / R05_ZAxisServo,
`HMI_XAxis`, `a02_S01PNPXAxis`). Descriptive words are how the ME *talks*
("the horizontal axis", "the lift"); the letter is how the code *names*. v5
carried the ME's words into the code (`HorizontalAxis`/`VerticalAxis` in
routine names, HMI tags, parameters, alarms) and Jason's first line was the
rename. The reason is fleet-wide readability: every SDC program a CE opens
has an X and a Z; "which one is HorizontalAxis" is a question the convention
exists to make impossible. Map the ME's description to the letter once, at
naming time, and use the letter everywhere — routines, HMI_ tags,
MotionParameters, RangeCheck instances, alarm text.

## State 4 is "Start Of Sequence, Wait For Part Present"
*(Jason Perry review of v5, 2026-08-24, item 4)*

The first sequence state has a standard name and a standard meaning: state 4
= **"Start Of Sequence, Wait For Part Present"**. It is not a generic
"home / wait for supervisor cycle start" — for a station that processes
parts, the thing that starts a cycle is a PART ARRIVING (the part-present
sensor, read in R01), and the state's name says so. The supervisor's
run/stop machinery lives in states 0–3 and the override block, not in the
first sequence state's semantics.

## R03 rungs are written in the template's exact format
*(Jason Perry review of v5, 2026-08-24, item 7)*

R03_StateLogic rung formatting is template vocabulary, not free prose: Jason
flagged v5's R03 rungs 3, 6, 7 as "incorrectly formatted" and the fix he gave
was "the S05_ServoPNP template has the proper formatting — copy it." At the
expression altitude there is no such thing as an equivalent-but-differently-
shaped R03 rung: branch order, coil-vs-latch choice, condition ordering, and
comment placement come from the matching template rung. When writing an R03
rung, find the template rung doing the same job and reproduce its exact
format with the station's tags substituted.

## Debug facilities are part of the program, not an afterthought

Every state machine locally implements (§22): lockout, bypass (reject
suppression), single-step (per station and per machine cycle), dry run,
manual-override-to-auto per station, and debug trigger bits. They're driven
by local logical inputs derived in R01 (Manual Mode, Safety OK, Fault Reset,
Cycle Running/Stopping/Stopped, Initialized, Lockout, Dry Run, Single Step)
so something other than the Supervisor can drive the station during debug.
Temporary debug bits live in one global LINT `g_Debug` and are removed —
along with unused tags and temp code — before FAT.

## L5X tag-data format (L5K + Decorated) — import-critical grammar

*(Added 2026-08-24 after the second import failure at Jason's desk — build
b_mt3bnrp3_7yxhic, Test_Project_v2/ServoPNP v4 SHIP. Studio 5000 rejected
`Tag[@Name='AlarmList']/Data` with "Data type mismatch". Reference shape:
`plc-reference/standard/S05_ServoPNP.L5X` AlarmList.)*

Every tag carries its value twice, in two independent encodings that must BOTH
be structurally valid and agree element-by-element:

- **`<Data Format="L5K">`** — a CDATA value literal in L5K grammar. A
  `STRING[N]` tag serializes as `[ [LEN,'body'], ... ×N ]`: the outer `[`
  opens the array, each element is a `[LEN,'body']` pair, the body is padded
  with `$00` to the type's buffer (82 chars for built-in STRING), and legal
  escapes are only `$XX` (two hex), `$$`, `$'`, `$T`, `$L`, `$N`, `$P`, `$R`.
  At the tail of a STRING array the byte sequence is FOUR right-brackets:
  element `]` + array `]` + the CDATA delimiter `]]>` — the template keeps
  this terminator on its own line (`\t\t]]]]>` then `</Data>` on the next).
- **`<Data Format="Decorated">`** — the XML rendering: `<Array DataType=
  "STRING" Dimensions="N">` of `<Element>` structures, each with
  `LEN` (DINT/Decimal) and `DATA` (STRING, Radix="ASCII") members whose text
  equals the L5K body's first LEN chars.

Jarvis's own diagnosis of the failure (verbatim, 2026-08-24): "I emitted only
`]]]`, which the XML scanner splits as one content `]` plus the earliest `]]>`
CDATA terminator, meaning the last element closes but the OUTERMOST array is
never closed — the aggregate literal is left unbalanced/unterminated. Studio's
L5K parser therefore cannot resolve the value into a shape that conforms to a
10-element STRING array; because the parsed aggregate's structure/arity
doesn't match the tag's declared type it reports 'Data type mismatch' on the
Data property (a shape error, not a per-element value error), even though
every LEN and every $00 pad byte was individually correct."

Import-consistency is now MECHANICALLY GATED: `importSimValidator.js`
(`simulateImport`, wired as a mandatory step inside `validator.validateL5X`)
parses every tag's L5K literal with a real bracket-balancing parser against
DataType/Dimensions, cross-checks Decorated element-by-element, enforces legal
$-escapes, $00 padding to buffer size, and ASCII-only rung/tag-data CDATA — on
every generation and on the pretranslated serve path. A file that fails the
gate never leaves the pipeline. The gate is enforcement; the understanding
above is why the grammar is shaped this way.

## Learned from corrections
- (2026-08-24, from Jason Perry's review of v5 — SDCServoPNP_JARVIS_v5, build b_mt3bnrp3_7yxhic) Axis names in code are single-letter machine directions (XAxis, ZAxis), never the ME's descriptive words (HorizontalAxis, VerticalAxis) — the description maps to the letter at naming time and the letter is used in every routine name, HMI tag, parameter, and alarm message.
- (2026-08-24, from Jason Perry's review of v5) The first sequence state is state 4 = "Start Of Sequence, Wait For Part Present" — its standard name and standard meaning; a part-processing station's cycle starts on the part-present sensor, not on generic supervisor plumbing.
- (2026-08-24, from Jason Perry's review of v5) R03 rung formatting is not free-form: write each R03 rung in the S05 template's exact rung format (branch order, coil/latch choice, comment placement) with the station's tags substituted — "the template has the proper formatting, copy it."

## BISM4006 UDT family — core tag set + sized COMP carrier (2026-08-30)

For BISM4006-style RFID/carrier read-write interfacing, SDC's tag structure has two layers:

- **Fixed core set** (always present): `BMC_UDT_BISM4006_Command`, `_Config`, `_InHeader`, `_Interface`, `_OutHeader`, plus the shared `BMC_UDT_CORE_Sequence` and `BMC_UDT_CORE_XferIndex`. These don't vary by station.
- **One variable COMP carrier** chosen per station to match the actual user-data payload size needed, selected from a fixed family (`BMC_UDT_COMP_BISMxx01` through `BISMxx20`), each pairing a `_UserData` (or `_RW_Data`) UDT with a `_DEFS_UserData_{size}byte` definition. Sizes span 112 bytes to 64 kilobytes.
- **Default**: `BISMxx02` / 2000-byte user data — pick this unless the station's actual RFID/carrier payload is known to need more or less.
- Naming embeds a revision/format suffix (`_3617US`, `_3917US`, `_4318US`) tracking generation, independent of the byte-size suffix — treat mismatched suffix families as non-interchangeable even when byte counts coincide.

_Source: Revision Notes.txt (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._
- (2026-08-31, from Jason's correction of build b_mth8wwzq_ucjbmc) NO UNUSED DEVICES, EVER (Jason 2026-08-31): the emitted device set equals the sheet's device set EXACTLY. A template/exemplar device the station does not have (the S05 Z servo) is DELETED from the output — no tags, no UDTs, no axis blocks, no NOP routines, no 'unused — delete at integration' comments. Template baggage never ships.
