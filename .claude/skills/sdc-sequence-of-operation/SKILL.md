---
name: sdc-sequence-of-operation
description: Generate the Sequence of Operation section of the cover note - one table per state machine, every state, what happens in it and what moves it on, read out of the L5X. Use when producing or updating a cover note (/sdc-cover-note), or when asked to describe how a machine sequences.
---

Format is `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §6b. Since 2026-09-29 this is the **second half of the cover note**, not a separate document (Jason). `/sdc-cover-note` owns the order; this skill owns the generator.

## Generate it, don't write it

```
node scripts/sequenceOfOperation.cjs <file.L5X> --out <out.html> --head head.html --meta meta.json [--front front.html] [--back back.html] [--foot "<last line>"] [--programs "<regex>"]
```

- `--head` - the cover note's first three sections (revision history, what I was given, machine). With it, the script opens a **Sequence of operation** section on a new page and demotes its own sub-headings one level.
- `--meta` - `{ "<Program>": { title, does, devices, notes, extra } }`. `extra` is free rows, in order: use it for Form · Deviation · Logic · Referenced · ▲ Ask. Key order sets section order. Programs with no entry still get a table.
- `--front` - the machine flow, after the shared-states table. `--back` - Services, Asks, Referenced, after the last station. `--foot` - the last line.
- `--programs` - regex on program names; the default covers `S01_`, `P01_`, `D01`, `Supervisor`. Every program with an `R02_StateTransitions` routine that matches gets a section - so both Supervisors of a two-machine controller appear on their own.

Then `scripts/html2docx.ps1`. Everything passed in lives in `build-inputs\out\` so the whole document regenerates from the L5X.

## How the tables are read out of the file

- **What happens** = the rung comment on the rung that moves *to* that state, `State nn:` prefix stripped. The grey sub-line = comments of the R03 rungs the state enables (`XIC(Status.State[n])`), capped at 5; an opening provenance clause ("REPLACES live rung 17.") is dropped, the behaviour kept.
- **On** = the transition rung's logic, rendered **for one source state at a time**. A transition rung usually gates several source states in parallel branch legs; rendering the whole rung mixes them and turns an OR into an apparent AND. The script prunes the other states' legs first. Don't "simplify" this back.
- Terms every rung carries (`SS_OK`, `CycleRunning`, `Initialized`, `SafetyOK`) are dropped; the blended-move idiom collapses to `(X at Pick, or inside the wide window when blending)`.
- Mode exits (0-3) are noise in the sequence table and are dropped there, but are the real exits from 124 and 127, so the initialization table keeps them.

## It reads the code, so it finds things

Building it for 1131 surfaced a real defect: S07 state 67 (verify grip at the gauge) had no success exit - only a fault-timer path. Any state whose every exit depends on the state timer is worth a look; so is a verify state with one exit where its twin has two. Put what it finds in a section of the cover note, not just in chat.

## Two things that bite

- The page count `html2docx.ps1` prints is wrong. Export a PDF and count its pages if the number matters.
- Word's HTML import ignores `@page` (set margins through `PageSetup` after opening) and needs the page break on a real paragraph, not an empty `<div>`.
