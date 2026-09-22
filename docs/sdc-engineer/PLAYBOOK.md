# SDC Engineer playbook — how a machine gets its PLC code

Shared brain for every SDC session. Read before any build. Rules here beat habit. Fewest words wins.

## 1. Laws (in order)
1. **Build SDC standard code.** The platform template first, then the CE's examples. Interpret them; never invent a form they lack (Jason, Dan).
2. **Same look and feel on every station.** Size, routines, tag forms, comment style match the closest example. No feature, timer, interlock, bypass constant or HMI setpoint the examples do not have.
3. **One program per state machine.** Two-up chassis: one program per nest side, A left, B right. A shared mechanism = one program.
4. **Readability.** Rung comment = one sentence. Tag description ≤ 30 chars. Nothing about the build in the ladder. Placeholder = `XIC(g_MachineBasic.AlwaysOff)` on a real rung.
5. **Decide like a controls engineer.** Seed values from the spec, defaults from the template, ownership of shared outputs. Record each as an assumption. Ask only what cannot be known: a missing I/O point, a wrong part, a module config no example carries, a standard program that does not exist. Name who answers.
6. **Fewest words.** Documents, comments, chat. Tables and phrases, never paragraphs.
7. **Quote before you conclude.** A finding without the verbatim rung is not a finding.
8. **Ratings move only when code moves.** Never relabel a column and bump a number.
9. **Cost discipline.** Documents: one writer (yourself), zero agents. Code: parallel builders + one lint, ≤ 2 fix rounds. A verifier per finding costs ~$2.50 each — estimate from the finding count. Report actuals.
10. **A CE confirmation is a law**, same as a correction. Write it down the same day.

## 2. Where things live
| What | Where | Shared? |
|---|---|---|
| This playbook, skills, scripts, validator | GitHub `danbelliveau2/state_logic_builder` (clone) | yes — pull |
| CE rules in his words | `X:\Electrical Dept\SDC Engineer\Knowledge\SDC-Engineer-Knowledge.md` → `## Engineer additions` | yes — read at every build start |
| Example programs | `X:\Electrical Dept\SDC Engineer\Examples\` | yes |
| CE session exports | `X:\Electrical Dept\SDC Engineer\Sessions\*.zip` → `node "X:\Electrical Dept\SDC Engineer\Scripts\extractSession.cjs"` | yes |
| Share-runnable scripts | `X:\Electrical Dept\SDC Engineer\Scripts\` (readiness, deviation log, lessons merge, session extract, L5X split, HTML→Word) | yes |
| Deviation grid (live, Excel) | `X:\Electrical Dept\SDC Engineer\Playbook\DEVIATIONS.csv` — one row per deviation, Status Open / Approved / Denied | yes — mastered on the share |
| Job working set | `X:\Electrical Dept\SDC Engineer\Deliveries\<job>\build-inputs\` (plan, contract, build programs, outputs) | yes |
| Templates | `plc-reference/training-material/SDC Standard Templates/` | yes |
| Job inputs | `N:\<job>\` (Mechanical, Electrical, Pneumatic, Documents) | yes, local PC only |
| Deliveries | `SDC Engineer Deliveries\<job>_<Machine>.L5X` + `_history\` stamps | per PC; send the file |
| Personal memory | `~/.claude/projects/...` | no — anything reusable goes here instead |

## 3. The nine inputs (standard SDC documents)
1 walkthrough transcript · 2 assembly drawings, ballooned · 3 station description sheet · 4 controls BOM · 5 I/O list · 6 pneumatic drawings · 7 timing diagram · 8 example program per station kind · 9 Ethernet device list.
Not needed: screenshots, a flowchart, a device list (build it from 2, 4, 5, 6). Values not in the documents are seeded and listed as assumptions.

## 4. Walkthrough checklist (five things to say per station — Dan, 2026-09-22)
1 what it does: one sentence, sides and sharing, most-like example or "new" · 2 devices: actuators and sensors with part numbers, which positions sensed; vision tools, pass/fail rule, trigger, result time; servo brand and family, positions, blended or point-to-point; RTD roles · 3 sequence: numbered steps with confirmation and angle or wait; good/bad, one reason each, where the bad part goes · 4 stop, fault, restart, clear-to-index; operator and HMI · 5 numbers and rules: station cycle time, values or "CE sets", customer rules.
Once per machine: cycle time target and index window, counts and side letters, servo brand and family, feeders on/off, safety outputs and STO, HMI writes, template version. Document: `Playbook\SDC_Engineer_Station_Walkthrough_Checklist_v2.docx`.

## 5. Process
1. **Readiness** — `node "X:\Electrical Dept\SDC Engineer\Scripts\buildReadiness.cjs" --job <N:\job> --plan <Deliveries\job\build-inputs\plan> --examples <X Examples> --template <X Templates\...L5X> --station-examples <plan\station-examples.json>` → report: have/missing, per-station example named, verdict BUILD / BUILD ON ASSUMPTIONS / WAIT. Show it. No code before this.
2. **Digest** — read the transcript, drawings, schematic, pneumatic, BOM; write the plan (one JSON per station: devices, steps, part tracking, questions) and a NAMES CONTRACT (programs, parameters others read, device points, angles, side mapping, CE rulings).
3. **Build** — one builder agent per program family, each returning 0 findings from the shape checker; twins A→B by script; assemble; import simulation; whole-file verify script. Deliver one growing L5X under one name; stamp a copy in `_history`.
4. **Review pass** (when the CE will not go rung by rung) — auditors by family, one skeptic per finding, fixers per program. Scope: standards and devices only.
5. **Cover note** — format in §6. Written by you. No agents.
6. **Return** — CE fixes the code, one line why per change, returns the whole file. Diff against the stamp; every change becomes a rule (knowledge file if the CE's, playbook if the process's). Nobody edits the cover note.

## 6. Cover note (one document)
Title · **Revision history** (version, date, what, why) · **What I was given** (nine inputs: have/partial/no, gap) · one line defining Logic · **Machine block** · **Station blocks**: Programs · Devices (name – part number – purpose) · Sequence (numbered) · Deviation (only if any: grid ID, status, who asked) · Logic 1–10 + reasons · Referenced · ▲ Ask inline · last line: fix the code, not this sheet. Portrait, a block never splits a page.

## 7. Chassis-specific rulings (Jason, Sep 2026)
- 2-UP template is the law. A = left, B = right. Escapements: no tracking, no CycleStation.
- MapInputs first. Tracking arrays = count + 1, sized with SIZE. Local modules addressed `Local:<slot>:I`.
- No Single Step / Single Cycle / AutoIdle on chassis stations. R01 = template block.
- Heat: one `HeatControl` program in a 1 s periodic task (setpoints + UPD, one PID rung per loop); station heat logic in MainTask. IY4 read direct, no scaling. Limit instruction is `LIMIT(` in v37.
- Feeders digital on/off. Cameras per S06_IV4Vision. Index permissive = clearance per axis, OR'd. Failure code = station × 10 + reason. Full-text failure messages.

## 8. Deviations never stop a build (Dan, 2026-09-21)
- A deviation = anything the engineer asks for that the template, the examples or this playbook lack.
- Say it once: `Deviation from the standard: <what>. Conflicts with: <rule>. Logging it as D0nn. Say go and I build it that way.` Log it: `node "X:\Electrical Dept\SDC Engineer\Scripts\logDeviation.cjs" --job <n> --station <Snn> --what "…" --conflicts "…" --asked-by "<who>"`. Build it on go. Name it in the cover note with its ID and status.
- The grid `Playbook\DEVIATIONS.csv` is the record. Anyone reads it (`logDeviation.cjs --list --job <n>`). The controls manager sets Status to Approved or Denied as time permits, with Decided by and a Note. Nobody deletes a row.
- At build start read the job's rows. Approved = build it, no go needed. Denied = build the standard form and say which ID was denied. Open = ask for go again.

## 9. Teaching it (every engineer, every session)
- When the engineer corrects you, confirms something worked, or states how SDC does things: append ONE dated line in their words to `X:\Electrical Dept\SDC Engineer\Lessons\<username>\lessons.md` immediately, tagged `[standard]` (agrees with playbook, knowledge file, template) or `[deviation] … | conflicts with: <rule>`. Own folder per person; never edit Knowledge\ or Examples\ (Jason's).
- Daily: `node scripts/mergeLessons.cjs` — `[standard]` lines → `Playbook\TEAM-LESSONS.md`; `[deviation]` lines → rows in `DEVIATIONS.csv` (Status Open); untagged lines → the Untagged section of TEAM-LESSONS, tagged by hand at the merge. Then `node scripts/syncSharedFolder.cjs`. Rules that hold across jobs move into this playbook by hand.
- Every session reads PLAYBOOK, TEAM-LESSONS, the job's deviation rows and Engineer additions first. The paste-in prompt is `Playbook\PROMPT.md`.

## 10. Gates
In the repo clone (they import the repo's validator): `node scripts/shapeLint1160.cjs` (per program, 0 findings) · `node scripts/assemble1160.cjs` · `node scripts/validate1160.cjs <out> --baseline <template>` (import sim 0 errors) · `node scripts/parseCheckChanged.cjs` for any script change. Copy the 1160 scripts for the next job and change the paths at the top.
