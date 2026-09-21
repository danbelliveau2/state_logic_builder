#!/usr/bin/env node
'use strict';
/**
 * syncSharedFolder.cjs — publish the shared brain to the common folder everyone points their Claude at:
 *   X:\Electrical Dept\SDC Engineer\Playbook\      ← docs/sdc-engineer/*.md + the team documents (docx)
 *   X:\Electrical Dept\SDC Engineer\.claude\skills\ ← .claude/skills/sdc-*
 *   X:\Electrical Dept\SDC Engineer\CLAUDE.md       ← Jason's file, untouched except one appended section (idempotent)
 * Run at the end of every session that changed a rule, a skill or a document:  node scripts/syncSharedFolder.cjs
 * Never writes into Knowledge\ or Examples\ (Jason's).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SHARE = process.argv[2] || 'X:/Electrical Dept/SDC Engineer';
if (!fs.existsSync(SHARE)) { console.error('share not reachable: ' + SHARE); process.exit(1); }
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); return path.relative(SHARE, dst); };
const done = [];
// Playbook + start-here + team documents. LIVE files are mastered on the share (people edit them there; mergeLessons
// mirrors them back) — seeded only when the share lacks them, never overwritten.
const LIVE = ['DEVIATIONS.csv', 'TEAM-LESSONS.md'];
for (const f of fs.readdirSync(path.join(ROOT, 'docs/sdc-engineer'))) {
  if (LIVE.includes(f) && fs.existsSync(path.join(SHARE, 'Playbook', f))) { done.push(`Playbook/${f} (live on the share, kept)`); continue; }
  done.push(copy(path.join(ROOT, 'docs/sdc-engineer', f), path.join(SHARE, 'Playbook', f)));
}
for (const f of ['SDC_Engineer_Station_Walkthrough_Checklist_v1.docx', 'SDC_Engineer_Build_Inputs_v1.docx', 'SDC_Engineer_For_The_Team_v1.docx']) {
  const src = path.join(ROOT, 'SDC Engineer Deliveries', f); if (fs.existsSync(src)) done.push(copy(src, path.join(SHARE, 'Playbook', f)));
}
// Standalone scripts (no repo dependencies) so readiness, lessons merge and session extraction run from the share alone
for (const f of ['buildReadiness.cjs', 'logDeviation.cjs', 'mergeLessons.cjs', 'syncSharedFolder.cjs', 'html2docx.ps1', 'experiments/extractSession.cjs', 'experiments/splitL5x.cjs']) {
  const src = path.join(ROOT, 'scripts', f); if (fs.existsSync(src)) done.push(copy(src, path.join(SHARE, 'Scripts', path.basename(f))));
}
// Templates the readiness check and the build reference
for (const f of ['ChassisStandard_2UP_2026-09-17.L5X', 'ChassisStandard.L5X', 'SoftwareStandardization.L5X']) {
  const src = path.join(ROOT, 'plc-reference/training-material/SDC Standard Templates', f); if (fs.existsSync(src)) done.push(copy(src, path.join(SHARE, 'Templates', f)));
}
// Skills
const skills = path.join(ROOT, '.claude/skills');
for (const d of fs.readdirSync(skills).filter((d) => d.startsWith('sdc-'))) done.push(copy(path.join(skills, d, 'SKILL.md'), path.join(SHARE, '.claude/skills', d, 'SKILL.md')));
// CLAUDE.md: append one section if missing (Jason's content stays byte for byte)
const claude = path.join(SHARE, 'CLAUDE.md');
const marker = '## Building a machine\'s code here (everyone)';
let c = fs.existsSync(claude) ? fs.readFileSync(claude, 'utf8') : '';
if (!c.includes(marker)) {
  c = c.replace(/\s*$/, '\n') + `
${marker}

- Read \`Playbook\\PLAYBOOK.md\` first, then \`Knowledge\\SDC-Engineer-Knowledge.md\` → \`## Engineer additions\`. Both are binding.
- The tool is the repo clone at \`C:\\SDC-StateLogic\` (pull first). Skills in \`.claude\\skills\` here: /sdc-readiness → /sdc-build → /sdc-review → /sdc-cover-note; /sdc-learn-return for anything the CE sends back.
- Playbook and skills are synced from the repo — edit them there. Deliveries go to \`Deliveries\\<job>\\\`.
`;
  fs.writeFileSync(claude, c); done.push('CLAUDE.md (section appended)');
} else done.push('CLAUDE.md (section present)');
fs.mkdirSync(path.join(SHARE, 'Deliveries'), { recursive: true });
fs.mkdirSync(path.join(SHARE, 'Lessons'), { recursive: true });
console.log(`synced to ${SHARE}:\n  ` + done.join('\n  '));
