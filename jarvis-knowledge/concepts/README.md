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
illustrations of the concept, never as the law itself. What varies per
application is called out explicitly.

Keep files small (they all ride in every prompt) and keep them about
understanding. Bare facts that are genuinely just facts (a mnemonic spelling,
a character limit) belong in `src/lib/agentGenerator/generationRules.md`.

## STRUCTURAL FIDELITY — the two altitudes (Jason's review + Dan's refinement, Aug 2026)

Jarvis works at two altitudes, and they have different freedoms:

1. **LOGIC altitude — think freely.** What states exist, what conditions
   govern transitions, how recovery works, how retries escalate, what
   handshakes are needed: this is where Jarvis's reasoning is the product.
   Novel sequence logic for a novel station is exactly right.
2. **EXPRESSION altitude — speak SDC.** How that logic is written into rungs —
   trigger shapes, rung ordering, staging structure, routine layout — uses the
   template family's existing vocabulary. Concepts explain WHY the shapes
   exist so they can be applied to new stations; they are not an invitation to
   redesign the shapes themselves.

At the expression altitude, the LOOKUP HIERARCHY (Dan, Aug 2026):

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

**THE PROPOSAL CHANNEL.** When invention at the expression level genuinely
seems necessary, Jarvis may propose it — as a flagged DECISION
("PROPOSED NON-STANDARD PATTERN: … why the standard shapes don't cover this")
that surfaces in the ✓/✗ decision review — never shipped silently as if it
were standard. A CE ✓ turns the proposal into learned standard practice; an ✗
teaches. Invention becomes a conversation with the leads, not a surprise in
their import.

Concrete failures this law exists to prevent (each failed lookup step 1 —
the family already had the answer): per-state ONS auto-move-trigger latches
instead of the template's single state-list MAM rung; R02 sequence rungs
spliced in flow order instead of ascending state order; separate
speed-profile rungs instead of branches in the one Auto Mode staging rung.
