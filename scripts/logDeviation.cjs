#!/usr/bin/env node
'use strict';
/**
 * logDeviation.cjs — add one row to the live deviation grid, or list it.  (Dan, 2026-09-21: a deviation never
 * stops a build; flag it, log it, build it when the engineer says go; the controls manager approves or denies later.)
 *
 *   Playbook\DEVIATIONS.csv   the grid — opens in Excel. One row per deviation. Status: Open | Approved | Denied.
 *                             Humans edit Status / Decided by / Note. Nobody deletes rows.
 *
 *   node logDeviation.cjs --job 1160 --station S15 --what "stops after three rejects in a row" \
 *        --conflicts "template S18_RejectUnload has no consecutive-reject stop" --asked-by "Mark Ruane" [--built v1.6] [--note ...]
 *   node logDeviation.cjs --list [--job 1160] [--status Open]
 *
 * If Excel holds the grid open, the row is parked in Playbook\deviations-inbox\ and the daily merge adds it.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const SHARE = args.share || 'X:/Electrical Dept/SDC Engineer';
const GRID = path.join(SHARE, 'Playbook', 'DEVIATIONS.csv');
const INBOX = path.join(SHARE, 'Playbook', 'deviations-inbox');
const HEADER = ['ID', 'Date', 'Job', 'Station', 'Deviation', 'Conflicts with', 'Asked by', 'Logged by', 'Built in', 'Status', 'Decided by', 'Decided on', 'Note'];

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
const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const readGrid = () => fs.existsSync(GRID) ? parseCsv(fs.readFileSync(GRID, 'utf8')) : [HEADER];
const nextId = (rows) => {
  let max = 0;
  const scan = (r) => { const m = /^D(\d+)$/i.exec(r[0] || ''); if (m) max = Math.max(max, +m[1]); };
  rows.forEach(scan);
  if (fs.existsSync(INBOX)) for (const f of fs.readdirSync(INBOX)) if (/\.csv$/i.test(f)) parseCsv(fs.readFileSync(path.join(INBOX, f), 'utf8')).forEach(scan);
  return 'D' + String(max + 1).padStart(3, '0');
};

// ── list ──
if (args.list) {
  const rows = readGrid();
  const head = rows[0], body = rows.slice(1).filter((r) => (!args.job || args.job === true || r[2] === String(args.job)) && (!args.status || args.status === true || (r[9] || '').toLowerCase() === String(args.status).toLowerCase()));
  const show = ['ID', 'Job', 'Station', 'Deviation', 'Asked by', 'Status', 'Decided by'].map((h) => head.indexOf(h));
  console.log('| ' + show.map((i) => head[i]).join(' | ') + ' |');
  console.log('|' + show.map(() => '---').join('|') + '|');
  for (const r of body) console.log('| ' + show.map((i) => r[i] || '').join(' | ') + ' |');
  if (!body.length) console.log('(no rows)');
  process.exit(0);
}

// ── log ──
if (!args.what || !args.conflicts) { console.error('usage: --job <n> --station <Snn> --what <deviation> --conflicts <rule> [--asked-by <who>] [--built <version>] [--note <text>] [--by <user>] | --list [--job n] [--status Open]'); process.exit(2); }
const rows = readGrid();
const id = nextId(rows);
const row = [id, new Date().toISOString().slice(0, 10), args.job === true ? '' : (args.job || ''), args.station === true ? '' : (args.station || ''), args.what, args.conflicts, args['asked-by'] === true ? '' : (args['asked-by'] || ''), args.by === true ? '' : (args.by || os.userInfo().username), args.built === true ? '' : (args.built || ''), 'Open', '', '', args.note === true ? '' : (args.note || '')];
try {
  if (!fs.existsSync(GRID)) { fs.mkdirSync(path.dirname(GRID), { recursive: true }); fs.writeFileSync(GRID, '\uFEFF' + toCsv([HEADER])); }
  const cur = fs.readFileSync(GRID, 'utf8');
  fs.appendFileSync(GRID, (/\r?\n$/.test(cur) ? '' : '\r\n') + toCsv([row]));
  console.log(`Deviation from the standard, logged as ${id}: ${ascii(args.what)}. Conflicts with: ${ascii(args.conflicts)}. Say go and I build it that way.`);
} catch (e) {
  fs.mkdirSync(INBOX, { recursive: true });
  const f = path.join(INBOX, `${new Date().toISOString().replace(/[:.]/g, '-')}-${row[7]}.csv`);
  fs.writeFileSync(f, '\uFEFF' + toCsv([HEADER, row]));
  console.log(`Deviation from the standard, ${id} (grid is open in Excel; parked in ${path.relative(SHARE, f)}, the daily merge adds it): ${ascii(args.what)}. Conflicts with: ${ascii(args.conflicts)}. Say go and I build it that way.`);
}
