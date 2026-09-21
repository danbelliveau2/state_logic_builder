#!/usr/bin/env node
'use strict';
/**
 * mergeLessons.cjs — fold every engineer's lessons into the team memory and the deviation grid.
 *
 *   Lessons\<person>\*.md        each session appends: "- YYYY-MM-DD [standard] <lesson> — <name>"
 *                                or                   "- YYYY-MM-DD [deviation] <lesson> | conflicts with: <rule> — <name>"
 *   Playbook\TEAM-LESSONS.md     the master every session reads — [standard] lines; untagged lines sit in their own
 *                                section until the daily merge tags them
 *   Playbook\DEVIATIONS.csv      the live grid (Excel). [deviation] lines become rows, Status Open. Humans set
 *                                Status Approved / Denied, Decided by, Note. Rows are never deleted. A deviation never
 *                                blocks a build (Dan, 2026-09-21).
 *   Playbook\deviations-inbox\   rows parked by logDeviation.cjs while Excel held the grid — folded in here
 *
 *   node scripts/mergeLessons.cjs [shareRoot]     (daily, then syncSharedFolder.cjs)
 */
const fs = require('fs');
const path = require('path');
const SHARE = process.argv[2] || 'X:/Electrical Dept/SDC Engineer';
const LESSONS = path.join(SHARE, 'Lessons');
const PB = path.join(SHARE, 'Playbook');
const TEAM = path.join(PB, 'TEAM-LESSONS.md'), GRID = path.join(PB, 'DEVIATIONS.csv'), INBOX = path.join(PB, 'deviations-inbox');
const REPO = path.resolve(__dirname, '..', 'docs/sdc-engineer');          // exists only when run from the repo clone
const MIRROR = fs.existsSync(REPO) ? REPO : null;                          // from the share (Scripts\) there is no repo: share is the master, nothing to mirror
const STATE = path.join(PB, '.state');                                     // last merged grid, to date status changes wherever the merge runs
const HEADER = ['ID', 'Date', 'Job', 'Station', 'Deviation', 'Conflicts with', 'Asked by', 'Logged by', 'Built in', 'Status', 'Decided by', 'Decided on', 'Note'];
const today = new Date().toISOString().slice(0, 10);
fs.mkdirSync(LESSONS, { recursive: true }); fs.mkdirSync(PB, { recursive: true });
const read = (p, seed) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : seed;

// ── csv (Excel-safe: CRLF, quotes, ASCII) ──
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}
const ascii = (v) => String(v == null ? '' : v).replace(/[\u2014\u2013]/g, '-').replace(/\u2192/g, '->').replace(/\u2264/g, '<=').replace(/\u2265/g, '>=').replace(/\u00d7/g, 'x').replace(/\u00b7/g, ';').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s*\r?\n\s*/g, ' ').trim();
const cell = (v) => { v = ascii(v); return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const toCsv = (rows) => '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const norm = (s) => ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── team lessons ──
let team = read(TEAM, MIRROR ? read(path.join(MIRROR, 'TEAM-LESSONS.md'), '# Team lessons\n') : '# Team lessons\n');
const teamLines = new Set(team.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')));

// ── grid: share is the master; the repo copy is yesterday's mirror (used to date status changes) ──
const csvAt = (p) => p && fs.existsSync(p) ? parseCsv(fs.readFileSync(p, 'utf8')) : null;
const grid = csvAt(GRID) || csvAt(MIRROR && path.join(MIRROR, 'DEVIATIONS.csv')) || [HEADER];
if (!grid.length || grid[0][0] !== 'ID') grid.unshift(HEADER);
const prev = csvAt(path.join(STATE, 'DEVIATIONS.last-merge.csv')) || csvAt(MIRROR && path.join(MIRROR, 'DEVIATIONS.csv')) || [HEADER];
const prevStatus = new Map(prev.slice(1).map((r) => [r[0], (r[9] || '').trim()]));
const col = (name) => HEADER.indexOf(name);
let maxId = 0; const seen = new Set();
const noteId = (r) => { const m = /^D(\d+)$/i.exec(r[0] || ''); if (m) maxId = Math.max(maxId, +m[1]); };
for (const r of grid.slice(1)) { while (r.length < HEADER.length) r.push(''); noteId(r); seen.add(norm(r[col('Deviation')])); }
const newId = () => 'D' + String(++maxId).padStart(3, '0');
const added = [];
const addRow = (r) => {
  while (r.length < HEADER.length) r.push('');
  if (seen.has(norm(r[col('Deviation')]))) return false;
  if (!/^D\d+$/i.test(r[0]) || grid.slice(1).some((g) => g[0] === r[0])) r[0] = newId(); else noteId(r);
  if (!r[col('Status')]) r[col('Status')] = 'Open';
  grid.push(r); seen.add(norm(r[col('Deviation')])); added.push(r); return true;
};

// 1. parked rows from sessions that found the grid open in Excel
let parked = 0;
if (fs.existsSync(INBOX)) for (const f of fs.readdirSync(INBOX).sort()) {
  if (!/\.csv$/i.test(f)) continue;
  for (const r of parseCsv(fs.readFileSync(path.join(INBOX, f), 'utf8')).slice(1)) if (addRow(r)) parked++;
  fs.unlinkSync(path.join(INBOX, f));
}

// 2. new lines from every person's folder or file
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.md$/i.test(e.name)) out.push(p); } return out; };
const newStandard = [], newUntagged = [], newDeviation = [];
for (const f of walk(LESSONS).sort()) {
  const who = path.relative(LESSONS, f).split(path.sep)[0].replace(/\.md$/i, '');
  for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
    let l = raw.trim(); if (!l.startsWith('- ')) continue;
    if (!/ — \S/.test(l)) l = `${l} — ${who}`;
    if (/\[deviation\]/i.test(l) || /conflicts with/i.test(l)) {
      const m = /^- (\d{4}-\d\d-\d\d)?\s*(?:\[deviation\])?\s*(.*?)(?:\|\s*conflicts with:\s*(.*?))?\s*(?: — (.*))?$/i.exec(l.replace(/\[deviation\]/i, '[deviation]'));
      const text = (m && m[2] || l).trim(), rule = (m && m[3] || '').trim(), by = (m && m[4] || who).trim();
      const job = (/\b(\d{4})\b/.exec(text + ' ' + by) || [])[1] || '', station = (/\b(S\d\d)\b/.exec(text) || [])[1] || '';
      if (addRow([null, (m && m[1]) || today, job, station, text, rule, '', by, '', 'Open', '', '', 'from ' + who + "'s lessons"])) newDeviation.push(grid[grid.length - 1]);
      continue;
    }
    if (teamLines.has(l)) continue;
    teamLines.add(l);
    if (/\[standard\]/i.test(l)) newStandard.push(l);
    else newUntagged.push(l.replace(/^- (\d{4}-\d\d-\d\d)?\s*/, (h) => `${h}[untagged] `));
  }
}
if (newStandard.length) team = team.replace(/\s*$/, '\n') + `\n## Merged ${today}\n${newStandard.join('\n')}\n`;
if (newUntagged.length) {
  const marker = '## Untagged (not yet checked against the standard; the daily merge tags them)';
  if (!team.includes(marker)) team = team.replace(/\s*$/, '\n') + `\n${marker}\n`;
  team = team.replace(/\s*$/, '\n') + newUntagged.join('\n') + '\n';
}

// 3. status hygiene: normalise the word, date a decision the day the merge first sees it
const changes = [];
for (const r of grid.slice(1)) {
  const s = (r[col('Status')] || 'Open').trim().toLowerCase();
  r[col('Status')] = /^appr/.test(s) ? 'Approved' : /^(den|rej)/.test(s) ? 'Denied' : 'Open';
  const was = prevStatus.get(r[0]);
  if (was !== undefined && was !== r[col('Status')]) { if (!r[col('Decided on')]) r[col('Decided on')] = today; changes.push(`${r[0]}: ${was || 'Open'} -> ${r[col('Status')]}${r[col('Decided by')] ? ' by ' + r[col('Decided by')] : ''}`); }
}

// 4. write the share (master), remember this state, mirror to the repo when there is one
const csv = toCsv(grid);
fs.writeFileSync(GRID, csv); fs.writeFileSync(TEAM, team);
fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(path.join(STATE, 'DEVIATIONS.last-merge.csv'), csv);
if (MIRROR) { fs.writeFileSync(path.join(MIRROR, 'DEVIATIONS.csv'), csv); fs.writeFileSync(path.join(MIRROR, 'TEAM-LESSONS.md'), team); }
console.log(`merged: ${newStandard.length} standard line(s) -> TEAM-LESSONS; ${newUntagged.length} untagged line(s) to sort; ${newDeviation.length + parked} deviation row(s) -> DEVIATIONS.csv (${parked} from the inbox); status changes: ${changes.length}`);
for (const l of newStandard) console.log('  ' + l.slice(0, 170));
for (const l of newUntagged) console.log('  ' + l.slice(0, 170));
for (const r of added) console.log(`  ${r[0]} ${r[col('Job')]} ${r[col('Station')]} ${ascii(r[col('Deviation')]).slice(0, 120)}`);
for (const c of changes) console.log('  ' + c);
