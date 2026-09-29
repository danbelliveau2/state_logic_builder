---
name: sdc-sequence-of-operation
description: Generate the Sequence of Operation document for a machine - one table per state machine, every state, what happens in it and what moves it on, read out of the L5X. Use on every new job alongside the cover note, or when asked to describe how a machine sequences.
---

Format is `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §6b. A deliverable on every new job (Jason, 2026-09-29).

## Generate it, don't write it

```
node scripts/sequenceOfOperation.cjs <file.L5X> --out <out.html> [--meta headers.json] [--programs "<regex>"]
powershell scripts/html2docx.ps1 -Html <out.html> -Docx <out.docx>
```

The script reads every program that has an `R02_StateTransitions` routine and builds the tables from the file itself:

- **What happens** = the rung comment on the rung that moves *to* that state, with the `State nn:` prefix stripped. The grey sub-line = the comments of the R03 rungs that state enables (`XIC(Status.State[n])`), capped at 5.
- **On** = the transition rung's own logic, rendered **for one source state at a time**. A transition rung usually gates several source states in parallel branch legs; rendering the whole rung mixes them and turns an OR into an apparent AND. The script prunes the other states' legs first. Don't "simplify" this back.
- Terms every rung carries (`SS_OK`, `CycleRunning`, `Initialized`, `SafetyOK`) are dropped; the blended-move idiom collapses to `X at Pick (or inside the wide window when blending)`.

## What you supply

Only the station headers, through `--meta`: `{ "<Program>": { title, does, devices, notes, extra } }`. Keep them factual — device names and part numbers from the BOM or the cover note, positions from the code. Programs with no entry still get a table. Meta key order sets section order. Save the JSON in `build-inputs\out\` so the document regenerates.

`--programs` is a regex on the program name; default covers `S01_`, `P01_`, `D01`, `Supervisor`. Pass it for a file that names them differently.

## Ships

`Deliveries\<job>\<job>_<Machine>_SequenceOfOperation.docx`, next to the cover note. HTML and meta JSON in `build-inputs\out\`.

## Two things that bite

- **The page count `html2docx.ps1` prints is wrong.** It reported 17 for an 18-page file. If you quote a number, export a PDF and count its pages.
- **Word's HTML import ignores `@page`**, so margins come out at 1 inch, and `page-break-before` on an empty `<div>` produces no break at all. Put the break on a real paragraph (the station `<h2>`) and set the margins through `PageSetup` after opening.

## It reads the code, so it finds things

Building it for 1131 surfaced a real defect: S07 state 67 (verify grip at the gauge) had no success exit — only a fault-timer path. Any state whose every exit depends on the state timer is worth a look; so is a verify state with one exit where its twin has two.
