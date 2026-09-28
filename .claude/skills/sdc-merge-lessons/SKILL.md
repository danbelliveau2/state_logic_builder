---
name: sdc-merge-lessons
description: Daily merge of every engineer's lessons into the team memory and the deviation grid — run the merge, tag the untagged lines, check the grid's new rows and status changes, publish. Use once a day or when asked to merge or review lessons or deviations.
---

1. `node scripts/mergeLessons.cjs` — `[standard]` lines → `Playbook\TEAM-LESSONS.md`; `[deviation]` lines and parked inbox rows → `Playbook\DEVIATIONS.csv` (Status Open); untagged lines → the Untagged section of TEAM-LESSONS. It prints new rows and every Status change (Open → Approved / Denied, by whom).
2. Untagged lines: check each against `PLAYBOOK.md`, the CE's `## Engineer additions` and the template. Tag it `[standard]` and move it into the dated merged section, or log it as a deviation row and delete the line. Leave nothing in Untagged.
3. A `[standard]` line that actually conflicts with a rule: remove it from TEAM-LESSONS and log it as a deviation row with the conflict named. The memory bank is only as good as this step.
4. Grid: never approve or deny; the controls manager does. For a new Open row you may add a one-line `check:` in Note (agrees with … | conflicts with … | cannot tell). A row that turned Denied: list the jobs whose code carries it; the next build of that job goes back to the standard form.
5. Rules confirmed across two jobs, or Approved rows that hold everywhere: add to `PLAYBOOK.md` in one line.
6. `node scripts/syncSharedFolder.cjs` (it never overwrites the live grid or TEAM-LESSONS on the share). Report: lines merged, lines tagged, rows added, status changes.
