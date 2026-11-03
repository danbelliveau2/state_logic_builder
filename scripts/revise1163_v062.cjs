'use strict';
// 1163 v0.6.2 - Tracking R05_PartOverallStatus: the ELSE branch of the station scan no longer clears NestSuccess /
// NestFailure (Jason, 2026-11-03: "Good is meant to stay on from the first success until a failure, the ELSE branch
// should not touch the bits"). The bits are cleared once before the scan; Success sets Good and continues, Failure
// sets Bad and exits, no result changes nothing. Base: the v0.6.1 stamp. Then gates, deliver, stamp, cover note.
// usage: node scripts/revise1163_v062.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const BASE = H + '/1163_Haemonetics_v0.6.1_2026-11-03.L5X';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.6.2';
const ISO = new Date().toISOString().slice(0, 10), SHORT = 'Nov 3';
const DRY = process.argv.includes('--dry');
const must = (c, m) => { if (!c) { console.error('!! ' + m); process.exit(1); } };

let x = fs.readFileSync(BASE, 'utf8');
const prog = (n) => { const m = x.match(new RegExp('<Program Name="' + n + '"[\\s\\S]*?</Program>')); must(m, 'program ' + n); return m[0]; };
{
  const p = prog('L2_Tracking');
  const r = p.match(/<Routine Name="R05_PartOverallStatus"[\s\S]*?<\/Routine>/); must(r, 'R05');
  const lines = [...r[0].matchAll(/<Line Number="\d+">\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>)?\s*<\/Line>/g)].map((m) => m[1] || '');
  const iS = lines.findIndex((l) => /^\s*NestSuccess := 1;\s*$/.test(l));
  must(iS > 0, 'R05: NestSuccess := 1');
  must(/^\s*else\s*$/i.test(lines[iS + 1]) && /^\s*NestFailure := 0;\s*$/.test(lines[iS + 2]) && /^\s*NestSuccess := 0;\s*$/.test(lines[iS + 3]) && /^\s*End_if;\s*$/i.test(lines[iS + 4]), 'R05: ELSE branch shape after the Success branch');
  lines.splice(iS + 1, 3);   // else / NestFailure := 0 / NestSuccess := 0
  must(lines.filter((l) => /^\s*NestSuccess := 0;\s*$/.test(l)).length === 2, 'R05: NestSuccess := 0 left twice (init + Failure branch)');
  const nr = r[0].replace(/<STContent>[\s\S]*<\/STContent>/, '<STContent>\n' + lines.map((l, i) => '<Line Number="' + i + '">\n<![CDATA[' + l + ']]>\n</Line>').join('\n') + '\n</STContent>');
  x = x.replace(p, p.replace(r[0], nr));
}
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' bytes)');

const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const v = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (v.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' — ' + ((v.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
const e = run(['scripts/applyStateEngine.cjs', OUTFILE, '--check']);
console.log('- state engine: ' + (e.code === 0 ? 'current' : 'BEHIND') + ' — ' + e.out.trim().split('\n')[0]);
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' — ' + g.out.trim().split('\n').pop());
must(/PASS/.test(verdict) && e.code === 0 && g.code === 0, 'a gate failed; nothing delivered');
if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);

const headF = OUT + '/' + JOB + '_CoverNote_head.html';
let h = fs.readFileSync(headF, 'utf8');
if (!h.includes('<tr><td>' + VERSION + '</td>')) {
  const row = '<tr><td>' + VERSION + '</td><td>' + SHORT + '</td><td>Tracking R05_PartOverallStatus: a station with no result no longer clears the nest&rsquo;s Good / Bad during the scan, so Good holds from the first Success until a Failure. Nothing else changed.</td><td>Jason, ' + SHORT + ': &ldquo;Good is meant to stay on from the first success until a failure, the ELSE branch should not touch the bits.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>';
  must(/<\/table>\r?\n<h2>What I was given<\/h2>/.test(h), 'head table end');
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, row);
  fs.writeFileSync(headF, h);
}
const backF = OUT + '/' + JOB + '_CoverNote_back.html';
let b = fs.readFileSync(backF, 'utf8');
if (!b.includes('(0.6.2, Jason)')) {
  b = b.replace(/<tr><td>18<\/td><td>[\s\S]*?<\/td><td>&ndash;<\/td><\/tr>/, '<tr><td>18</td><td>Closed: R05 scans every station at or before the nest&rsquo;s position; Good holds from the first Success until a Failure, which exits the scan (0.6.2, Jason).</td><td>&ndash;</td></tr>');
  must(b.includes('(0.6.2, Jason)'), 'ask 18 row');
  fs.writeFileSync(backF, b);
}
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (!c.includes('(0.6.2)')) { c = c.trimEnd() + '\nJason 2026-11-03 (0.6.2): R05 ELSE branch does not touch Good / Bad; Good holds from the first Success until a Failure.\n'; fs.writeFileSync(cf, c); }
console.log('fragments + contract updated');

const cfg = JSON.parse(fs.readFileSync(B + '/intake.json', 'utf8'));
const html = OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.html';
const s = run(['scripts/sequenceOfOperation.cjs', D + '/' + M + '.L5X', '--out', html, '--head', headF, '--meta', OUT + '/' + JOB + '_CoverNote_meta.json', '--front', OUT + '/' + JOB + '_CoverNote_front.html', '--back', backF, '--foot', 'If a device or step is wrong, fix the code, not this sheet.', '--programs', cfg.programs, '--title', cfg.title, '--subtitle', 'Cover note and sequence of operation - v' + VERSION]);
console.log(s.out.trim().split('\n').pop()); must(s.code === 0, 'sequenceOfOperation');
const docx = D + '/' + M + '_CoverNote.docx';
const w = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (B + '/w8_convert.ps1').replace(/\//g, '\\'), '-Html', html.replace(/\//g, '\\'), '-Docx', docx.replace(/\//g, '\\'), '-Pdf', (OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.pdf').replace(/\//g, '\\')], { encoding: 'utf8' });
const wout = (w.stdout || '') + (w.stderr || '');
console.log(wout.trim().split('\n').slice(-2).join('\n'));
must(/saved /.test(wout), 'cover note conversion failed (is Word open?)');
fs.copyFileSync(docx, H + '/' + M + '_CoverNote_v' + VERSION + '_' + ISO + '.docx');
console.log('cover note stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION);
