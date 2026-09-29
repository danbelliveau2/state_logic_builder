---
name: sdc-cover-note
description: Write the one-document cover note that travels with a delivered L5X (revision history, inputs received, machine block, station blocks with numbered sequence, logic rating and asks). Use after any delivery or when asked for the cover note.
---

Format is `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §6. Write it yourself from the build facts; no agents.

- Title: job, machine, program version, date.
- Revision history: every version — what changed, why, who asked.
- What I was given: the nine inputs, have / partial / no, the gap.
- One line: Logic = confidence the sequence is right, 1–10, with reasons. Deviation rows appear only where a station departs from the SDC standard: grid ID from `Playbook\DEVIATIONS.csv`, its status (Open / Approved / Denied), who asked for it.
- Machine block, then one block per station: Programs · Devices (name – part number – purpose, full words) · Sequence (numbered steps, exceptions as a trailing bullet) · Deviation (if any) · Logic n + reasons · Referenced · ▲ Ask inline with who answers.
- Last line: if a device or step is wrong, fix the code, not this sheet.
- Ratings change only when code changes.
- Produce HTML → Word with `scripts/html2docx.ps1 -Html <file> -Docx <file>` (Word COM). Portrait; a station block never splits across a page.
- The page count that script prints is **not reliable** — it came back 17 for an 18-page file (2026-09-29). Word's HTML import also drops the `@page` rule, so set the margins after opening. If you quote a page count, get it from a PDF export and count the pages; otherwise quote the word count only.
- The sequence of operation (§6b) is a separate deliverable on every new job — `/sdc-sequence-of-operation`.

## Updating an existing cover note

When the HTML source is gone, round-trip the delivered `.docx`: open it in Word, `SaveAs2` format 10 (filtered HTML), edit that, convert back. The round trip is faithful — word count and table count come back identical.

Two traps, both hit on 1131 v0.4:
- Word's filtered HTML is **UTF-16 and declares `charset=unicode`**. If you save your edited copy as UTF-8, change that declaration to `charset=utf-8` first, or Word reads the bytes as 1252 and every en dash and curly quote in the *whole* document becomes mojibake — including text you never touched. Check the converted `.docx` for the `â€` sequence before shipping.
- Word breaks text runs across line breaks and table cells. Match targets whitespace-tolerantly (`split(/\s+/).join('\s+')`), keep each target inside one cell, and don't assume apostrophes are curly — they are often plain ASCII.

Keep every earlier revision row as written; add the new one. Stamp the superseded `.docx` into `_history\`.
