---
name: sdc-readiness
description: Check whether a machine job has the nine standard inputs before any code build — produces the readiness report (have / missing / verdict). Use when someone says "build <job>", "are we ready to build", or drops a job folder.
---

Read `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §3 and §5 first.

1. Job folder: `N:\<job>\`. Plan folder (may not exist yet for a new job): `X:\Electrical Dept\SDC Engineer\Deliveries\<job>\build-inputs\plan`. For 1160 that is `Deliveries\1160\build-inputs\plan`. If there is no plan yet, pass the job's transcript with `--transcript` and omit `--plan`.
2. Run (all on one line):
   `node "X:\Electrical Dept\SDC Engineer\Scripts\buildReadiness.cjs" --job "<job folder>" --plan "<plan folder>" --examples "X:\Electrical Dept\SDC Engineer\Examples" --template "X:\Electrical Dept\SDC Engineer\Templates\ChassisStandard_2UP_2026-09-17.L5X" --station-examples "<plan folder>\station-examples.json" --out "<plan folder>\..\out\readiness.md"`
   The script also looks for the transcript inside the plan folder, so `--transcript` is only needed when the transcript lives somewhere else.
3. Confirm the file matches by hand (the patterns are loose); correct the table.
4. Show the report in chat as a table: input · have/partial/no · gap. End with the verdict: BUILD · BUILD ON ASSUMPTIONS (list them) · WAIT FOR (item, person).
5. Do not start a build from this skill. Readiness is the gate.
