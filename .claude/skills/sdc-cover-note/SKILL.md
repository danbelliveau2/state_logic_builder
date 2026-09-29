---
name: sdc-cover-note
description: Produce the ONE document that travels with a delivered L5X - revision history, inputs received and the machine block first, then the sequence of operation for every state machine, then services, asks and references. Use after any delivery, when asked for the cover note, or when asked how a machine sequences.
---

Format is `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §6 and §6b. One document per job (Jason, 2026-09-29): the cover note and the sequence of operation are not two files.

## Order, always

1. **Revision history** - every version: what changed, why, who asked.
2. **What I was given** - the nine inputs, have / partial / no, the gap.
3. **Machine** - platform, controller and task list, axes, hardware, modes, deviations (grid ID, status, who), logic 1-10.
4. **Sequence of operation** - how to read, the shared states, machine flow, then one section per state machine (`/sdc-sequence-of-operation` generates these).
5. **Services** - the programs that are not state machines.
6. **Asks** - numbered, who answers.
7. **Referenced**, then the last line: *fix the code, not this sheet.*

## What you write, what is generated

You write 1-3 as an HTML fragment (`--head`), the machine flow (`--front`), and 5-7 (`--back`), plus a `--meta` JSON with each station's header rows: Does · Devices (name - part number - purpose, full words) · Notes · Form · Deviation (only if any) · Logic n + reasons · Referenced · ▲ Ask. No agents.

The state tables are generated from the L5X. There is no numbered Sequence line per station any more - the table is the sequence.

```
node scripts/sequenceOfOperation.cjs <file.L5X> --out <out.html> --head head.html --meta meta.json --front front.html --back back.html --foot "If a device or step is wrong, fix the code, not this sheet." --programs "^(S\d\d_|Supervisor_)"
powershell scripts/html2docx.ps1 -Html <out.html> -Docx <job>_<Machine>_CoverNote.docx
```

Ship `Deliveries\<job>\<job>_<Machine>_CoverNote.docx`; the head / front / back / meta go in `build-inputs\out\` so the whole document regenerates. Stamp the superseded `.docx` into `_history\`. Keep every earlier revision row as written; add the new one. Ratings change only when code changes.

## Three traps

- **Page count.** `html2docx.ps1` prints Word's count from a headless instance and it is wrong - 17 for an 18-page file, 1 for a 27-page one. If you quote a number, export a PDF and count its pages; otherwise quote the word count only.
- **Margins and breaks.** Word's HTML import ignores `@page`, so set margins through `PageSetup` after opening; a `page-break-before` on an empty `<div>` produces no break - put it on the section `<h2>`.
- **Updating a note whose source is gone.** Round-trip the `.docx` through Word filtered HTML (`SaveAs2` format 10). It is faithful - word and table counts come back identical - but its export declares `charset=unicode`; saving your edit as UTF-8 without changing that to `charset=utf-8` mojibakes every en dash in the whole document, including text you never touched. Read the converted `.docx` back and check for the `â€` sequence before shipping. Match edit targets whitespace-tolerantly, one table cell at a time, and expect ASCII apostrophes.
