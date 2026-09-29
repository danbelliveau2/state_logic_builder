'use strict';
/** The merge guard, on a throwaway share tree - the real grid is never touched. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(require('os').tmpdir(), 'sdc-mergetest');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'Lessons', 'tester'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'Playbook'), { recursive: true });

const HEAD = 'ID,Date,Job,Station,Deviation,Conflicts with,Asked by,Logged by,Built in,Status,Decided by,Decided on,Note';
fs.writeFileSync(path.join(ROOT, 'Playbook', 'DEVIATIONS.csv'),
  '﻿' + HEAD + '\r\n'
  + 'D010,2026-09-29,1131,,"Two independent halves in one controller: a loader and an unloader, each with its own Supervisor, Alarms and HMI program",'
  + '"the SDC standard project form has one Supervisor per controller",Jason,jperry,,Approved,Jason Perry,2026-09-29,\r\n', 'utf8');
fs.writeFileSync(path.join(ROOT, 'Playbook', 'TEAM-LESSONS.md'), '# Team lessons\n', 'utf8');

fs.writeFileSync(path.join(ROOT, 'Lessons', 'tester', 'lessons.md'), [
  '# tester',
  // 1. names an existing row -> must NOT open a new one
  '- 2026-09-29 [deviation] The two supervisor / alarm / HMI is not our standard, but was a requirement for this project. That is the reason on D010. | conflicts with: the standard form — Tester',
  // 2. a genuine new deviation -> must open a row
  '- 2026-09-29 [deviation] S15 uses a 24 V relay where the standard calls for a contactor | conflicts with: the standard output form — Tester',
  // 3. paraphrases D010 without naming it - too different to dedupe, so it DOES open a row,
  //    which is exactly the case the overlap warning exists for
  '- 2026-09-29 [deviation] A loader and an unloader in one controller, each carrying its own Supervisor, its own Alarms and its own HMI program, independently | conflicts with: the standard form — Tester',
  // 4. plain standard line
  '- 2026-09-29 [standard] Keep the servo points the machine already runs on — Tester',
  // 5. names a row that does NOT exist -> still a real deviation
  '- 2026-09-29 [deviation] Something new that mentions D999 which is not in the grid | conflicts with: the standard — Tester',
].join('\n') + '\n', 'utf8');

const out = execFileSync(process.execPath,
  [path.resolve(__dirname, '..', 'mergeLessons.cjs'), ROOT],
  { encoding: 'utf8' });
console.log(out);

const grid = fs.readFileSync(path.join(ROOT, 'Playbook', 'DEVIATIONS.csv'), 'utf8');
const ids = [...grid.matchAll(/^D\d{3}/gm)].map((m) => m[0]);
const team = fs.readFileSync(path.join(ROOT, 'Playbook', 'TEAM-LESSONS.md'), 'utf8');

const checks = [
  ['line naming D010 opened no row', !/two supervisor \/ alarm \/ HMI/.test(grid)],
  ['...and landed in TEAM-LESSONS instead', /two supervisor \/ alarm \/ HMI/.test(team)],
  ['genuine new deviation opened a row', /24 V relay/.test(grid)],
  ['paraphrase of D010 opened a row AND was flagged',
    /carrying its own Supervisor/.test(grid) && /CHECK:/.test(out) && /D010 <-/.test(out)],
  ['plain [standard] line went to TEAM-LESSONS', /Keep the servo points/.test(team)],
  ['unknown ID D999 still treated as a deviation', /mentions D999/.test(grid)],
  ['rows: D010 plus the 3 new rows', ids.length === 4],
  ['redirected line is tagged [standard], not [untagged]', /\[standard\] The two supervisor/.test(team)],
];
let bad = 0;
for (const [what, pass] of checks) { if (!pass) bad++; console.log((pass ? '  ok    ' : '  FAIL  ') + what); }
console.log('\n  grid ids: ' + ids.join(', '));
console.log('  ' + (bad ? bad + ' FAILING' : 'all ' + checks.length + ' checks pass'));
process.exit(bad ? 1 : 0);
