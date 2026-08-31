# Multi-program L5X emission — capability plan (honest TODO)

Status 2026-08-25: **compile-side decomposition is LIVE** (coordinationAuthor
compiles a concurrent station into N state machines, each with its own grid,
transitions, waits, and both-sides handshake signals; validation enforces the
multi shape). **Emission is NOT built** — promptBuilder holds any generation
against a multi-SM approved sequence (SUPREME LAW inability guard: the standard
requires one program per state machine; emitting a crammed single program is
forbidden). This document is the plan to remove that hold.

## Target shape (evidence)

- The V4.2 SoftwareStandardization.L5X is a FULL-CONTROLLER export carrying
  many station programs side by side (Supervisor, S00_IndexerSP/NoSP,
  S01_PartLoad … S19_GoodUnload, plus Alarms/HMI/MapInputs/MapOutputs/
  Production/Recipe/SafetyProgram/Tracking). One `<Programs>` block, one
  `<Program>` element per SM, all sharing controller-scope tags/AOIs/UDTs.
- ShowRoomFlexFeeder.L5X is the decomposed-station exemplar: P01_Robot +
  P02_Conveyor — two asynchronous processes of one cell, two programs, each
  with the full R00–R20 skeleton sized to its role; handshakes as parameters.

## Plan (increments)

1. **Per-machine translation calls.** For a multi-SM compiled IR, run the
   existing translation prompt ONCE PER MACHINE: template selected per that
   machine's devices (dial SM → S00_Indexer*, servo head → S05_ServoPNP,
   pneumatic shuttle → S01_PartLoad), jobText = that machine's section of the
   compiled text (renderMachineSections output) + the decomposition header and
   the handshake table so every writer sees both sides. Each call yields one
   edit plan → mergeEngine → one single-program L5X (today's pipeline,
   unchanged per program).
2. **Program-level assembly.** New module (`programAssembler.js`): take N
   merged single-program L5X files + the compiled IR and produce ONE
   controller-level L5X — lift each file's `<Program Use="Target">` into a
   shared controller envelope (V4.2's controller skeleton), dedupe AOIs/UDTs/
   controller tags byte-identically (they come from the same template family;
   a non-identical duplicate is a hard error), set `Use="Target"` on the first
   program / `Use="Context"` appropriately or export as full-controller
   (`TargetType="Controller"`), and add each program to the MainTask schedule
   upstream → downstream (dial S00 first? NO — main-task order follows the
   PART: load side, dial, unload — confirm against V4.2's task order).
3. **Handshake wiring.** Inter-SM signals: each producer declares the
   parameter (`p_`/`q_`); consumers reference `\{ProgramName}.p_Signal`
   (direct reference — the FlexFeeder idiom) or wired connections. The
   compiled IR's handshakes[] table is the single source; the assembler
   verifies every signal appears in both programs' rung text.
4. **THE CHECK, per program + handshakes.** internalReviewer runs once per
   program (template = that program's family), plus one architecture pass over
   the assembled file (program list, naming, main-task order, handshake
   both-sides at the RUNG level). Any blocker anywhere = the whole build is
   'fix'.
5. **Import-sim gate.** VERIFIED 2026-08-25: importSimValidator's
   `extractTags` regex-walks every `<Tag>` in the whole document (program
   membership irrelevant) and the CDATA/ASCII checks are document-wide — the
   gate passes multi-program files as-is. Still add a multi-program fixture to
   its tests before first real emission.
6. **Cost/UX.** N translation calls ≈ N × today's generate cost; surface as
   one build with per-program progress. The diagram page joins compiled states
   to drawn nodes per machine via sourceNodeId (unchanged).

## Open items

- Whether SDC wants per-station single-program L5X files (one import each) or
  one controller-level file — V4.2 practice suggests full-controller for new
  machines, per-program partial imports for retrofits. Leads question filed
  only if both paths are demanded simultaneously; default: per-program partial
  L5X files first (smallest change, matches today's import flow), controller
  assembly second.
- Supervisor generation for multi-SM stations (the dial supervisor gate
  q_WaitStationsComplete) — the S00 indexer template already carries it; the
  assembler must not duplicate it.
