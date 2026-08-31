# CONCEPTS, NOT RULES

> **When Jarvis gets something wrong, deepen the understanding here; do not
> append a rule. — Dan, Aug 2026**

"How we use servo motors there is how we use servo motors in lots of places…
You have to understand the concepts, not the specific rules, because there are
too many unique scenarios. Understand the concepts and apply them to the
unique scenarios."

Every `.md` file in this directory (except this README) is loaded into the
Jarvis compile and translation prompts. Each file is written the way a senior
SDC controls engineer would explain the subject to a new hire: the mechanism,
the intent behind it, and the judgment calls — with template rungs used as
illustrations of the concept, never as a rulebook to transcribe. What varies
per application is called out explicitly.

Keep files small (they all ride in every prompt) and keep them about
understanding. Bare facts that are genuinely just facts (a mnemonic spelling,
a character limit) belong in `src/lib/agentGenerator/generationRules.md`.

## STRUCTURAL FIDELITY — the two altitudes (Jason's review + Dan's refinement, Aug 2026)

Jarvis works at two altitudes, and they have different freedoms. Think of the
authority hierarchy as GUIDE RAILS, not rules: template structure is the
immovable guide rail; expression is template-first; reasoning is free within
SDC constructs; and anything genuinely new is ask-before-invent — resolved at
design time, with the leads.

1. **LOGIC altitude — think freely.** What states exist, what conditions
   govern transitions, how recovery works, how retries escalate, what
   handshakes are needed: this is where Jarvis's reasoning is the product.
   Novel sequence logic for a novel station is exactly right.
2. **EXPRESSION altitude — speak SDC.** How that logic is written into rungs —
   trigger shapes, rung ordering, staging structure, routine layout — uses the
   template family's existing vocabulary. Concepts explain WHY the shapes
   exist so they can be applied to new stations; they are not an invitation to
   redesign the shapes themselves. Structure is the immovable guide rail.

At the expression altitude, the LOOKUP HIERARCHY (Dan, Aug 2026) — the guide
rails in order:

1. **Template sets FIRST** — they are the newest, latest-and-greatest
   statement of the standard. If the template family shows the construct
   (motion triggers, rung ordering, staging), use ITS shape, period. The four
   V4.2 templates are one family — the indexer, the PNP, the shot pin all
   answer each other's questions (e.g. the indexer's trigger/wait split IS the
   answer to back-to-back moves on one axis).
2. **Seen SDC code SECOND** — constructs learned from real SDC programs
   (training library, corrected files, full-machine uploads) fill gaps the
   templates don't show.
3. **SDC-style freedom LAST** — only when neither shows the construct: build
   it in SDC's idiom, and flag it through the proposal channel below.

## TEMPLATE CONSULTATION IS MANDATORY (Dan, Aug 2026)

Step 1 of the lookup hierarchy is now enforced machinery, not advice. The
incident that forced it: Jarvis compiled multi-move states when
S05_ServoPNP plainly does one servo move per state — because template
knowledge lived in hand-curated notes, Jarvis only knew the rules someone
had already been burned by (Jason's round 3 was the same failure: invented
structures where the template had the answer). Dan: "I shouldn't be telling
you to do that... put rules in place to look at this kind of stuff so I
don't have to keep telling you every single time."

The machinery (all three stages, none optional):

1. **Auto-derived pattern inventory** (`src/lib/agentGenerator/templatePatterns.js`)
   parses the template files in `plc-reference/standard/` themselves and
   extracts their structural invariants as data — one MAM per axis, one move
   per state, staging shape, transition condition families, R02 ordering,
   mnemonic family, init graph. Cached by file hash in
   `jarvis-knowledge/analysis/template-patterns.json`: **when a new template
   drops in, the inventory re-derives itself — no human curation.**
2. **Compile-time conformance contract**: every structural decision in a
   compiled sequence must cite the inventory pattern it follows, or declare
   the extension (`templateConformance` in the compile output). Uncited
   structural choices are a defect and fail compile validation.
3. **Enforcement**: `validator.js` checks one-move-per-state mechanically at
   the IR level and again at L5X level; the internal reviewer receives the
   inventory and blocks any undeclared structural divergence.

Enforceable invariants are STRUCTURAL shapes only. Template sample facts
(how many positions, which AutoSpeed indices) are observations — the
fast/slow + transition-point standard (Dan, 2026-08-21) is a standing
sanctioned extension that deliberately exceeds them. The guide-rails
framing above is unchanged: template first → seen SDC code → SDC-style
freedom; this section just makes step 1 enforceable instead of advisory.

**THE PROPOSAL CHANNEL.** When invention at the expression level genuinely
seems necessary, Jarvis may propose it — as a flagged DECISION
("PROPOSED NON-STANDARD PATTERN: … why the standard shapes don't cover this")
that surfaces in the ✓/✗ decision review — never shipped silently as if it
were standard. A CE ✓ turns the proposal into learned standard practice; an ✗
teaches. Invention becomes a conversation with the leads, not a surprise in
their import.

**THE CREDIBILITY PROTOCOL.** The controls team's culture is "one set of
changes, fixed right." Proposals, uncertainties, and open questions are
resolved with the leads BEFORE external delivery — through the decision
review, the questions queue, and the pre-delivery internal review — never
flagged inside delivered code. A file that leaves the building carries no
"maybe": everything questionable was already settled with a human.

## OFFICIAL STANDARDS DOCUMENTS — `plc-reference/standards-docs/` (ingested Aug 2026)

The CE department's written standards from `X:/Electrical Dept` live locally
in `plc-reference/standards-docs/` (originals + `.extracted.md` text
versions, X-drive folder structure preserved). They rank ALONGSIDE the
templates in the lookup hierarchy: **templates show HOW, the documents say
WHAT is mandatory.** Key sources: "PLC Software Standardization, Rev2" (the
CE bible), "Pneumatic Standardization Selection Guide, Rev2", the servo
motor/drive guidelines, the sensor standardization list, the standard
program/AOI L5X files (Alarms, HMI, Production, CycleTime, OEE, TopAlarms),
and the SDC Standard Template Revision History (the changelog of WHY the
templates evolved). Distilled understanding lands in these concept files,
each rule citing its source document + section.

A second ingestion point, `plc-reference/training-material/` (from
N:/AI Folder/CE Training Material, Aug 2026), holds the leads' ANSWERED
QUESTIONNAIRES (highest authority — the leads' own words), the ShowRoom
GOLD exemplars (chassis + flex feeder archetypes → station-archetypes.md),
and the "Examples NOT Following SDC Standard" anti-pattern corpus
(→ anti-patterns.md; never style authority, excluded from the lookup
hierarchy's "seen SDC code" step).

Ingestion convention: drop a new or revised standards document into
`plc-reference/standards-docs/` (mirroring its X-drive path) → it gets
studied on the next training run and its concepts distilled here. Conflicts
between a document and current beliefs are never silently resolved — they go
to `jarvis-knowledge/analysis/standards-doc-conflicts.md` for Dan to
adjudicate.

Concrete failures these guide rails exist to prevent (each failed lookup
step 1 — the family already had the answer): per-state ONS auto-move-trigger
latches instead of the template's single state-list MAM rung; R02 sequence
rungs spliced in flow order instead of ascending state order; separate
speed-profile rungs instead of branches in the one Auto Mode staging rung.

## THE GENERATION DOCTRINE — study → ask → write once → one review (Dan, 2026-08-25)

Dan's ruling, his sequence verbatim: "Look at the request. Use SDC standards.
Look at the references they gave you — pictures, L5X files, documents,
anything. Ask the engineers any questions BEFORE writing. Write the code based
on SDC standards. Maybe one review at the end. You don't get eight revisions —
you get one."

The 8-round fix loop was scaffolding, never the process. The flow is:

1. **STUDY** (pre-write, `preWriteStudy.js`): assemble the full working
   context deliberately — the approved plan, the COMPLETE closest
   engineer-corrected exemplar (rung-for-rung, not extracts), the station's
   studied reference material and its lessons, the concept docs, and every
   recorded decision/ruling for this build.
2. **ASK** (readiness pass): one cheap check before writing — "anything
   unresolved, ambiguous, or missing that would cause a defect?" Real gaps
   are asked NOW, as blocking questions with proposed solutions — never
   discovered mid-write. An empty list is the expected, honest answer.
3. **WRITE ONCE**: the translation call writes the FINAL file against that
   full context. There is no revision loop in the writer's world.
4. **ONE REVIEW** (THE CHECK, full-file): ship → done.

The fix loop still exists as a SAFETY NET (caps unchanged), but **revisions
are tuition, not process**: every fix round auto-files a lesson — "what
should the pre-write study have caught?" — through the correction learner
into these concept docs, so rounds trend to zero. The honest measure of the
doctrine is the **first-pass ship rate** (`firstPassShip` per build,
aggregated by the trackrecord API): can Jarvis create a correct file from
just the station description, with no prior version?
