# How Jason writes code — the 14-step process

> Attributed: **Jason Perry, 2026-08-26 (via Dan)** — the senior controls
> engineer's own description of his process, verbatim. This is the human
> process Jarvis's pipeline exists to reproduce; when judging a build, cite
> which of these steps a finding traces to. Pipeline mapping:
> `docs/HOW_JARVIS_BUILDS_A_STATION.md`.

## The steps (verbatim)

1. Read Project Release to gain understanding of project
2. Read customer URS for machine requirements
3. Review device and I/O list with ME
4. Review machine and station operation with ME
5. Review station state logic diagrams
6. Select appropriate SDC Standards template
7. Follow SDC standard program structure
8. Follow SDC standard naming convention
9. Organize programs by station with appropriate numbering
10. Organize subroutines properly (inputs in inputs routine, transitions in
    state transitions, outputs in outputs, etc.)
11. Use descriptive rung and tag comments
12. Write easy to follow logic
13. Write logic accounting for all required interlocks (e.g. Z retracted
    before X moves)
14. Write logic including all SDC standard data (production, shift, nest,
    station, top alarms) + logic avoiding unnecessary machine stoppages

## How Jarvis uses this

- **Study phase (steps 1-6):** understanding before writing — the pre-write
  study (exemplars, spec, diagrams, template selection) is Jarvis's version
  of Jason's steps 1-6. Steps 3-4 are the describe/spec conversation with
  the ME; step 5 is the approved compiled sequence; step 6 is template
  family selection.
- **Write phase (steps 7-14):** every one of these is a checkable property
  of the output file. The reviewer should be able to point at any finding
  and say which step it violates: a tag named off-convention breaks step 8;
  an input debounce living in R03 breaks step 10; a justification-prose rung
  comment breaks step 11 (descriptive means naming the physical action, not
  the mechanics); a missing Z-before-X interlock breaks step 13; a missing
  StationPerformance/TopAlarms hookup or a fault where a warning belongs
  breaks step 14.
- Step 14's second half is Dan's prime directive stated by the CE lead:
  **write logic avoiding unnecessary machine stoppages** — warnings and
  retries exist for this (alarms.md).

## Known pipeline gaps (honest — flagged as roadmap)

Two of Jason's inputs have NO ingestion path in Jarvis today:

- **Step 1 — Project Release:** Jarvis never sees the project release
  package. Roadmap: a reference-material intake on the spec sheet where the
  ME attaches the release (or the relevant extract) so the study phase reads
  the same project context Jason does.
- **Step 2 — Customer URS:** same gap — machine requirements arrive only as
  the ME's description. Roadmap: URS upload as spec-sheet reference
  material, studied in the pre-write phase, with requirements traced to
  states/interlocks.

Until those intakes exist, the ME's describe-phase narrative is the proxy
for both — which makes steps 3-4 (the ME conversation) carry extra weight,
and makes it Jarvis's job to ASK when project-level context is clearly
missing rather than pretend the description is the whole requirement set.
