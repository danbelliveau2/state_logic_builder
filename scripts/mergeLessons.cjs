#!/usr/bin/env node
'use strict';
/**
 * mergeLessons.cjs — fold every engineer's lessons into the team memory, THROUGH the standards gate.
 *
 *   Lessons\<person>\*.md           each session appends: "- YYYY-MM-DD [standard] <lesson> — <name>"
 *                                   or                   "- YYYY-MM-DD [deviation] <lesson> | conflicts with: <rule> — <name>"
 *   Playbook\TEAM-LESSONS.md        the master — only [standard] lines and APPROVED deviations enter
 *   Playbook\LESSONS-FOR-REVIEW.md  deviations and untagged lines wait here; Dan prefixes a line with
 *                                   APPROVED: or REJECTED: — the next merge moves it
 *   Playbook\LESSONS-REJECTED.md    rejected lines, kept so nobody re-learns them
 *
 *   node scripts/mergeLessons.cjs [shareRoot]     (daily, then syncSharedFolder.cjs)
 */
const fs = require('fs');
const path = require('path');
const SHARE = process.argv[2] || 'X:/Electrical Dept/SDC Engineer';
const LESSONS = path.join(SHARE, 'Lessons');
const PB = path.join(SHARE, 'Playbook');
const TEAM = path.join(PB, 'TEAM-LESSONS.md'), REVIEW = path.join(PB, 'LESSONS-FOR-REVIEW.md'), REJECTED = path.join(PB, 'LESSONS-REJECTED.md');
const REPO = path.resolve(__dirname, '..', 'docs/sdc-engineer');
const today = new Date().toISOString().slice(0, 10);
fs.mkdirSync(LESSONS, { recursive: true }); fs.mkdirSync(PB, { recursive: true });
const read = (p, seed) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : seed;
let team = read(TEAM, read(path.join(REPO, 'TEAM-LESSONS.md'), '# Team lessons\n'));
let review = read(REVIEW, '# Lessons for review\n\nDeviations from the standard and untagged lessons wait here. Dan: put `APPROVED:` or `REJECTED:` at the start of a line; the next merge moves it. Approved lines enter TEAM-LESSONS marked approved; rejected lines go to LESSONS-REJECTED so nobody re-learns them.\n');
let rejected = read(REJECTED, '# Rejected lessons\n\nSaid, checked, not the SDC standard. Kept so it is not learned again.\n');
const lines = (t) => t.split('\n').map((l) => l.trim());
const known = new Set([...lines(team), ...lines(review), ...lines(rejected)].filter((l) => l.startsWith('- ') || /^(APPROVED|REJECTED):/.test(l)).map((l) => l.replace(/^(APPROVED|REJECTED):\s*/, '')));

// 1. process Dan's marks in the review file
const keep = []; const toTeam = []; const toRejected = [];
for (const raw of review.split('\n')) {
  const l = raw.trim();
  if (/^APPROVED:\s*/.test(l)) toTeam.push(l.replace(/^APPROVED:\s*/, '') + ` (approved by Dan ${today})`);
  else if (/^REJECTED:\s*/.test(l)) toRejected.push(l.replace(/^REJECTED:\s*/, '') + ` (rejected ${today})`);
  else keep.push(raw);
}
review = keep.join('\n');

// 2. collect new lines from every person's folder or file
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.md$/i.test(e.name)) out.push(p); } return out; };
const newStandard = [], newReview = [];
for (const f of walk(LESSONS).sort()) {
  const who = path.relative(LESSONS, f).split(path.sep)[0].replace(/\.md$/i, '');
  for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
    let l = raw.trim(); if (!l.startsWith('- ')) continue;
    if (!/ — \S/.test(l)) l = `${l} — ${who}`;
    if (known.has(l) || known.has(l.replace(/ \((approved|rejected)[^)]*\)$/, ''))) continue;
    known.add(l);
    if (/\[standard\]/i.test(l) && !/conflicts with/i.test(l)) newStandard.push(l);
    else newReview.push(/\[(standard|deviation)\]/i.test(l) ? l : l.replace(/^- (\d{4}-\d\d-\d\d)?\s*/, (m) => `${m}[untagged — check against the standard] `));
  }
}
const teamAdds = [...toTeam, ...newStandard];
if (teamAdds.length) team = team.replace(/\s*$/, '\n') + `\n## Merged ${today}\n${teamAdds.join('\n')}\n`;
if (newReview.length) review = review.replace(/\s*$/, '\n') + `\n## Waiting since ${today}\n${newReview.join('\n')}\n`;
if (toRejected.length) rejected = rejected.replace(/\s*$/, '\n') + `\n## ${today}\n${toRejected.join('\n')}\n`;
for (const [p, t] of [[TEAM, team], [REVIEW, review], [REJECTED, rejected]]) { fs.writeFileSync(p, t); fs.writeFileSync(path.join(REPO, path.basename(p)), t); }
console.log(`merged: ${newStandard.length} standard line(s) → TEAM-LESSONS; ${newReview.length} line(s) → LESSONS-FOR-REVIEW; approvals moved: ${toTeam.length} in, ${toRejected.length} rejected`);
for (const l of [...newStandard, ...newReview]) console.log('  ' + l.slice(0, 170));
