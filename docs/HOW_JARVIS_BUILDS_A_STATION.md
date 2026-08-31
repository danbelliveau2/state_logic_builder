# How Jarvis Builds a Station

> **The operating document.** This is the end-to-end process a station goes through,
> written so that both humans and agents follow the same page. The code exists to
> serve this process — not the other way around.
>
> **Operating principle (Dan's directive):** code does **PLUMBING** (persistence,
> routing, rendering) and **CHECKING** (geometry, import-sim, validators, diffs).
> **THINKING** lives in agents plus written knowledge. When a behavior needs to
> change, we change a knowledge doc or a prompt — not a rule branch in JavaScript.

---

## The knowledge stack (what the agents read)

| Document | Role | Owner |
|---|---|---|
| `src/lib/agentGenerator/meKnowledge.md` | Standing ME-facing knowledge: device taxonomy, standing SDC facts, the self-answer question policy, "Learned from the MEs" (append-only) | Grows from ME corrections |
| `src/lib/agentGenerator/generationRules.md` | The 19 enforced generation rules — LAW. Template wins on conflict. | CE reviews (Jason) → rules |
| `jarvis-knowledge/concepts/*.md` | Engineering concepts (servo motion, coordination, pneumatics, alarms, anti-patterns, station archetypes…) — the *understanding*, concepts-not-rules | Distilled from templates + reviews |
| SDC V4.2 standard templates | The authoritative *example* of every idiom. New standards = law; old projects = reference only. | Controls team |
| `jarvis-knowledge/` (questions, sources, curriculum, buildScores) | Learning state: what's been asked, answered, studied, scored | Pipeline |
| `docs/SDC_PROGRAMMING_STANDARD_DRAFT.md`, `docs/architecture.md` | Human-facing standard + app schema reference | Team |

**The hierarchy of authority when generating:** template family first → other seen
SDC code → SDC-style freedom, explicitly flagged as "PROPOSED NON-STANDARD PATTERN"
for decision review. (The two-altitude framing: *logic* altitude thinks freely;
*expression* altitude speaks SDC.)

---

## The human reference process — Jason's 14 steps

Jason Perry described his own process (2026-08-26, via Dan; verbatim in
`jarvis-knowledge/concepts/how-jason-writes-code.md`). The pipeline is judged
against it — each step maps to a stage of the loop below:

| # | Jason's step | Pipeline stage | Status |
|---|---|---|---|
| 1 | Read Project Release | — | **GAP: no ingestion path.** Roadmap: spec-sheet reference-material intake for the release package. |
| 2 | Read customer URS | — | **GAP: no ingestion path.** Roadmap: URS upload as spec-sheet reference material, studied pre-write. |
| 3 | Review device and I/O list with ME | DESCRIBE (spec author, device taxonomy) | Covered |
| 4 | Review machine and station operation with ME | DESCRIBE + ASK (corrections chat) | Covered |
| 5 | Review station state logic diagrams | PROPOSE + APPROVE (compiled sequence review) | Covered |
| 6 | Select appropriate SDC Standards template | STUDY (template family selection) | Covered |
| 7 | Follow SDC standard program structure | WRITE-ONCE (template merge) + CHECK | Covered |
| 8 | Follow SDC standard naming convention | `tagNaming.js` + validators | Covered |
| 9 | Organize programs by station with numbering | codegen program naming (S{nn}_) | Covered |
| 10 | Organize subroutines properly | template routine layout (R01/R02/R03/R20…) | Covered |
| 11 | Descriptive rung and tag comments | state-map generation + reviewer comment discipline | Covered (reviewer enforces action-naming, not mechanics prose) |
| 12 | Write easy to follow logic | internal review ("would a reviewing CE flag it") | Covered |
| 13 | All required interlocks (e.g. Z retracted before X moves) | permissives + compiled-IR cross-validation | Covered (X-traverse permissive pattern, servo-motion.md) |
| 14 | All SDC standard data + avoid unnecessary stoppages | template L5 boilerplate; warnings/retries doctrine (alarms.md) | Covered |

Until the step-1/2 intakes exist, the ME's description is the proxy for
project-level requirements — the study prompt and the internal reviewer cite
these steps when judging whether a build understood enough before writing.

---

## The loop

```
DESCRIBE → STUDY → ASK → PROPOSE → APPROVE → WRITE-ONCE → CHECK → DELIVER → LEARN
```

Each step below states: who acts, what knowledge governs it, what artifact it
produces, and what the code's job is (plumbing/checking only).

### 1. DESCRIBE — the ME says what the machine does

- **Who:** the mechanical engineer, in plain language (typed or dictated) on the
  Create Station surface.
- **Knowledge:** `meKnowledge.md` — device taxonomy (what counts as a device, what
  never does: valves, EOAT assemblies, timers), standing SDC facts.
- **Agent:** the spec author summarizes the description into a structured station
  spec — devices, sequence intent, outcome rules, cross-station relationships.
  It captures IO/valve details when mentioned, never demands them.
- **Code's job:** capture text/audio, persist the draft, render the live checklist.
  No heuristics deciding what the ME "meant" — the agent decides, the doc governs.
- **Artifact:** the machine spec (part of the project JSON).

### 2. STUDY — Jarvis reads before it writes

- **Agent:** pre-write study over the relevant template family, concepts, and any
  uploaded SDC exemplars for the mechanisms this station needs.
- **Knowledge:** `jarvis-knowledge/concepts/` + the V4.2 templates. The
  **ask-for-examples doctrine** applies: if NO template, exemplar, or concept
  shows the needed pattern, Jarvis does not invent alone — it files an
  `example-request` question with its best-guess approach attached
  (solutions-first). The team uploads a real SDC example; Jarvis trains on it
  and continues on learned ground.
- **Code's job:** serve the knowledge files and template extracts into the prompt
  (cached stable prefix); store uploaded exemplars.

### 3. ASK — only what genuinely passes the self-answer test

- **Knowledge:** the question policy in `meKnowledge.md`. Before asking anything:
  *"Can I generate correct logic without this answer?"* If a standard, a default,
  or physics answers it — decide, note the decision for CE review, don't ask.
  No quota, no cap; zero questions is fine, ten real ones are fine.
  "You decide" is a complete answer — record it, never re-ask.
- **Non-standard requests:** if the ME asks for something contradicting a standard,
  flag it, build it their way, and note it for CE review. Never argue.
- **Code's job:** the question queue (routing, persistence, UI). Not deciding
  what to ask.
- **Artifact:** questions + recorded decisions/reviewFlags on the spec.

### 4. PROPOSE — the compiled sequence (thinking happens HERE, once)

- **Agent:** `compileSequence` — ONE high-effort reasoning call over the diagram
  IR + machine spec + meKnowledge + concepts + template notes. Output: the
  complete compiled sequence — real grid state numbers (base 4, +3; Rule 3, with
  inline renumbering per Rule 17), concrete SDC-tag condition text on every
  transition, every wait with success/partner-failure/timeout exits (Rule 11 —
  no exitless waits, ever), handshakes with set/clear states, retry counters
  (prime directive: machines that stop less), and CE review flags.
- **Code's job (checking):** `validateCompiledIR` mechanically enforces the state
  grid and no-exitless-waits; `renumberInlineOnGrid` enforces flow-order
  numbering. These stay deterministic forever.
- **Artifact:** `sm.compiledSequence` (`POST /api/jarvis/compile`).

### 5. APPROVE — a human signs the thinking

- **Who:** the engineer reviews the compiled sequence (state-by-state, in the
  ME's own words), edits if needed, and approves
  (`POST /api/jarvis/compile/approve`).
- **Approval is the contract.** Everything downstream is *translation* of the
  approved IR — no redesign allowed. Un-approving marks downstream builds stale.
- **Code's job:** persistence of the approval, staleness tracking, review UI.

### 6. WRITE-ONCE — translation, then background pre-translation

- **Agent:** translation-mode generation. The model authors a **JSON edit plan**
  against the selected V4.2 template — it never writes L5X itself. Effort medium;
  the approved IR is authoritative.
- **Code's job (plumbing + checking):** the deterministic **merge engine** copies
  the template verbatim (UTF-8 BOM + CRLF preserved), applies the plan with
  exact-match assertions, renames, renumbers rungs, keeps L5K/Decorated data in
  sync, injects the authoritative STATE MAP comment, and caps description
  lengths. On approval the server pre-translates in the background so the
  engineer's later "generate" returns in under a second at $0 new spend
  (`meta.mode='pretranslated'`).
- **Knowledge:** `generationRules.md` Rules 1–19 govern every idiom (routine
  chain, SS_OK gating, part tracking, handshakes, alarms, placeholders, naming,
  mnemonic family, motion trigger shape, R02 order, axis letters, alarm
  derivation).

### 7. CHECK — deterministic gates, fed back until clean

- **Code's job (checking — never agentic):**
  - `validator.js` — XML/identifier/state checks, Studio 5000 import limits
    (Rule 12: 512-char descriptions, 40-char names), mnemonic family (Rule 13),
    motion coverage (Rule 14), R02 order (Rule 15), motion trigger shape
    (Rule 16), sandwich-signature renumbering (Rule 17), alarm/position
    cross-check (Rule 19).
  - Cross-validation against the approved compiled IR (the approval contract):
    every action evidenced at its state; no device commanded where the IR has
    no action; state labels match tag and rung comments.
  - `importSimValidator.js` — simulates the Studio 5000 import.
- **Failures feed back to the model** as repair rounds, up to the attempt cap.
  A file that doesn't pass every gate is not delivered. Negative tests (doctored
  files) keep the validators honest.

### 8. DELIVER — the artifact and its receipts

- Saved L5X + `ir.json` under `generated/<project>/`; program Description stamped
  `Generated by JARVIS v{version} ({date})`; `meta` carries jarvisVersion, mode,
  validation results, and the real-token cost estimate (cost is reported for
  visibility, never optimized at the expense of quality).
- The CE imports, reviews the flagged decisions and `*Replace` placeholders
  (Rule 8 — unknowable conditions compile as placeholders, never guesses),
  and commissions.

### 9. LEARN — every correction becomes knowledge, once

- **ME corrections** → appended to "Learned from the MEs" in `meKnowledge.md`.
  A genuinely new fact may be asked once, ever — then it's knowledge.
- **CE review findings** (the Jason loop) → distilled into concepts
  (`jarvis-knowledge/concepts/`) as *understanding*, plus a numbered rule in
  `generationRules.md` **only when it must be a hard validation gate**, plus a
  validator check with a doctored-file negative test.
- **Version discipline:** every pipeline behavior change bumps `JARVIS_VERSION`,
  adds a `docs/JARVIS_VERSIONS.md` row, and gets benchmarked
  (`scripts/jarvisBenchmark.cjs`). The version log is the lab notebook.

---

## What is never agentic (the honest floor)

These stay deterministic code, permanently:

1. **The merge engine** — byte-exact template copying, plan application, BOM/CRLF,
   L5K sync. Determinism here is why the output imports.
2. **Import simulation and all validators** — a checker that "thinks" can be
   sweet-talked; gates must be mechanical.
3. **Save/load identity** — project JSON round-trip, IDs, undo history.
4. **Tag-name construction** (`tagNaming.js`) — the *choice* of names is standard
   (knowledge); the string assembly must be deterministic so re-generation is
   stable.
5. **Geometry** — edge routing, clearance, step-number DFS, canvas rendering.
6. **State-grid arithmetic** — renumbering, reserved-number enforcement.

---

## Where each step lives today

| Step | Agent code (thin) | Knowledge | Deterministic code |
|---|---|---|---|
| Describe | `specAuthor.js` | `meKnowledge.md` | CreateStationPage capture/persist |
| Study | `preWriteStudy.js` | concepts/, templates, sources | knowledge file serving |
| Ask | `questionRouter.js` | question policy | question queue persistence |
| Propose | `coordinationAuthor.js` | concepts/, rules, meKnowledge | `validateCompiledIR`, `renumberInlineOnGrid` |
| Approve | — (human) | — | approval/staleness persistence |
| Write-once | `client.js` + `promptBuilder.js` | `generationRules.md`, template | `mergeEngine.js` |
| Check | `internalReviewer.js` (pre-Jason pass), `diagramReviewer.js`, `verifyLoop.js`, repair-round feedback | rules as gate specs | `validator.js`, `importSimValidator.js`, `templatePatterns.js` (invariants derived from templates) |
| Deliver | — | — | file save, stamping, cost meta |
| Learn | `correctionLearner.js` | meKnowledge appendix, concepts | version log, benchmarks |

Any code outside those three columns — heuristics deciding intent, hardcoded
sequence templates, rule engines guessing what the ME meant — is a candidate for
deletion per `docs/SIMPLIFICATION_PLAN.md`.
