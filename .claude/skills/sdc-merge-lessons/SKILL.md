---
name: sdc-merge-lessons
description: Daily merge of every engineer's lessons into the team memory through the standards gate — run the merge, judge the waiting lines against the playbook, knowledge file and template, publish. Use once a day or when asked to merge or review lessons.
---

1. `node scripts/mergeLessons.cjs` — moves `[standard]` lines into `Playbook\TEAM-LESSONS.md`, parks `[deviation]` and untagged lines in `Playbook\LESSONS-FOR-REVIEW.md`, applies Dan's `APPROVED:` / `REJECTED:` marks.
2. Read the waiting lines. For each, check against `PLAYBOOK.md`, the CE's `## Engineer additions` and the template. Write one line under it: `  check: <agrees with … | conflicts with … | cannot tell>`. Do not approve; Dan approves.
3. A `[standard]` line that actually conflicts with a rule: move it from TEAM-LESSONS to the review file with the conflict named. The gate is only as good as this step.
4. Rules confirmed across two jobs or approved by Dan: add to `PLAYBOOK.md` in one line.
5. `node scripts/syncSharedFolder.cjs`. Report: lines merged, lines waiting, lines moved by approval, and any `[standard]` line you demoted.
