---
name: sdc-cover-note
description: Write the one-document cover note that travels with a delivered L5X (revision history, inputs received, machine block, station blocks with numbered sequence, logic rating and asks). Use after any delivery or when asked for the cover note.
---

Format is `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §6. Write it yourself from the build facts; no agents.

- Title: job, machine, program version, date.
- Revision history: every version — what changed, why, who asked.
- What I was given: the nine inputs, have / partial / no, the gap.
- One line: Logic = confidence the sequence is right, 1–10, with reasons. Deviation rows appear only where a station departs from the SDC standard, with who asked for it.
- Machine block, then one block per station: Programs · Devices (name – part number – purpose, full words) · Sequence (numbered steps, exceptions as a trailing bullet) · Deviation (if any) · Logic n + reasons · Referenced · ▲ Ask inline with who answers.
- Last line: if a device or step is wrong, fix the code, not this sheet.
- Ratings change only when code changes.
- Produce HTML → Word with `scripts/html2docx.ps1 -Html <file> -Docx <file>` (Word COM). Portrait; a station block never splits across a page. Report the page and word count.
