'use strict';
// apply1163_v081.cjs — 1163 v0.8.1 on the v0.8 stamp (Jason, 2026-11-06, after the L1 increment):
//   1. g_StationList -> g_L2StationList everywhere (name only; L1 already has g_L1StationList).
//   2. L2_S00_IndexerNoSP R03: the StationCompleteTimes rung for L2S10 (template form, ONS.7).
// Closes asks 33 and 34. Every other L2 rung stays byte-identical to the stamp (checked).
//   node scripts/apply1163_v081.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const BASE = H + '/1163_Haemonetics_v0.8_2026-11-06.L5X';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.8.1';
const ISO = new Date().toISOString().slice(0, 10), SHORT = 'Nov 6';
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const base = fs.readFileSync(BASE, 'utf8');
let x = base;

const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
const programBody = (src, name) => { const m = progRe(name).exec(src); return m ? m[0] : null; };
const replaceProgram = (name, body) => { const m = progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const getRoutine = (body, rn) => { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; };
const putRungs = (body, rn, rungs) => { const old = getRoutine(body, rn); must(old != null, 'routine ' + rn); return body.replace(old, '\n' + renumber(rungs.join('\n')) + '\n'); };
const editRoutine = (prog, rn, fn) => { let b = programBody(x, prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + rn)))); replaceProgram(prog, b); };
const rep1 = (src, from, to, what) => { const i = src.indexOf(from); must(i >= 0 && src.indexOf(from, i + 1) < 0, what + ': expected exactly once'); return src.slice(0, i) + to + src.slice(i + from.length); };
const countOf = (hay, s) => hay.split(s).length - 1;
const norm = (s) => s.replace(/\s+/g, '');

// ═══ 1. g_StationList -> g_L2StationList ═════════════════════════════════════
const n0 = (x.match(/\bg_StationList\b/g) || []).length;
must(n0 > 100 && countOf(x, '<Tag Name="g_StationList"') === 1, 'g_StationList count ' + n0);
x = x.replace(/\bg_StationList\b/g, 'g_L2StationList');
must(!/\bg_StationList\b/.test(x) && countOf(x, '<Tag Name="g_L2StationList"') === 1 && countOf(x, '<Tag Name="g_L1StationList"') === 1, 'rename');
console.log('g_StationList -> g_L2StationList: ' + n0 + ' occurrences');

// ═══ 2. L2_S00 R03: S10 station complete time ════════════════════════════════
const S00 = 'L2_S00_IndexerNoSP', S10 = 'L2_S10_BlueTubeCoiler';
must(!programBody(x, S00).includes('ONS(ONS.7)') && /<Tag Name="StationCompleteTimes" TagType="Base" DataType="REAL" Dimensions="17"/.test(programBody(x, S00)), 'L2_S00 ONS.7 / StationCompleteTimes[17]');
must(/<Tag Name="q_StationComplete"[^>]*Usage="Output"/.test(programBody(x, S10)), 'S10 q_StationComplete');
editRoutine(S00, 'R03_StateLogic', (r) => { must(r.length === 6 && rungText(r[5]) === 'XIC(Status.State[42])OTE(q_PauseRestart);', 'L2_S00 R03 shape');
  return [...r, newRung('Record Ok To Index For Each Station', 'XIC(\\' + S10 + '.q_StationComplete)ONS(ONS.7)DIV(CycleTimer.ACC,1000,StationCompleteTimes[10]);')]; });

// ═══ 3. checks: nothing else moved ═══════════════════════════════════════════
const back = (s) => s.replace(/g_L2StationList/g, 'g_StationList');
for (const p of [...base.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1])) {
  const a = programBody(base, p), b = back(programBody(x, p));
  if (p === S00) { must(norm(a.slice(0, a.indexOf('<Routine Name="R03_StateLogic"'))) === norm(b.slice(0, b.indexOf('<Routine Name="R03_StateLogic"'))) && norm(a.slice(a.indexOf('<Routine Name="R04_IndexerServo"'))) === norm(b.slice(b.indexOf('<Routine Name="R04_IndexerServo"'))), p + ' changed beyond R03'); continue; }
  must(norm(a) === norm(b), p + ' changed');
}
must(norm(back(x).replace(/<Program\b[\s\S]*<\/Programs>/, '')) === norm(base.replace(/<Program\b[\s\S]*<\/Programs>/, '')), 'controller scope changed beyond the name');
must(rungList(getRoutine(programBody(x, S00), 'R03_StateLogic')).length === 7, 'R03 rung count');
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
fs.mkdirSync(PROGDIR, { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
for (const p of [S10, 'L2_S01_TubeFeedUpstream']) fs.writeFileSync(path.join(PROGDIR, p + '.xml'), programBody(x, p));
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars); L2_S00 R03 now 7 rungs');

// ═══ 4. gates ════════════════════════════════════════════════════════════════
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', path.join(PROGDIR, S10 + '.xml'), path.join(PROGDIR, 'L2_S01_TubeFeedUpstream.xml')]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-6).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-1).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict)) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW/.test(l)).slice(0, 40).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');

// ═══ 5. fragments, meta, contract ════════════════════════════════════════════
const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8');
if (!h.includes('<tr><td>' + VERSION + '</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>' + VERSION + '</td><td>' + SHORT + '</td><td><code>g_StationList</code> renamed <code>g_L2StationList</code> everywhere (name only, beside <code>g_L1StationList</code>); L2_S00 R03 records L2S10&rsquo;s complete time in <code>StationCompleteTimes[10]</code> (template form, ONS.7). Nothing else moved.</td><td>Jason, ' + SHORT + ': &ldquo;add the L2_S00 StationCompleteTimes rung for S10 &hellip; original g_StationList name must be changed to g_L2StationList.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>' + VERSION + '</td>'), 'head row');
}
h = h.replace(/\bg_StationList\b/g, 'g_L2StationList');
b = b.replace(/\bg_StationList\b/g, 'g_L2StationList');
b = rep1(b, '<tr><td>33</td><td>L2 untouched today: the <code>StationCompleteTimes</code> rung for L2S10 in L2_S00 R03 (one rung, ONS.7) waits for the next L2 increment.</td>', '<tr><td>33</td><td>Closed (0.8.1): L2_S00 R03 rung 6 records L2S10&rsquo;s complete time in <code>StationCompleteTimes[10]</code>.</td>', 'ask 33');
b = rep1(b, '<tr><td>34</td><td><code>g_L2StationList</code> stays the L2 table (the machine-wide standard name); L1 has <code>g_L1StationList</code>[9]. Renaming the L2 table <code>g_L2StationList</code> is a name-only change across every L2 alarm CONCAT if wanted.</td>', '<tr><td>34</td><td>Closed (0.8.1): the L2 table is <code>g_L2StationList</code>[17], L1&rsquo;s is <code>g_L1StationList</code>[9]; every L2 alarm CONCAT follows the name.</td>', 'ask 34');
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
if (!/StationCompleteTimes\[10\]/.test(meta.L2_S00_IndexerNoSP.notes)) meta.L2_S00_IndexerNoSP.notes += ' R03 records L2S10&rsquo;s complete time in StationCompleteTimes[10].';
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8').replace(/\bg_StationList\b/g, 'g_L2StationList');
if (!c.includes('(0.8.1)')) c = c.trimEnd() + '\n| 0.8.1 | `g_L2StationList`[17] is the L2 station-name table (was g_StationList); L2_S00 R03 rung 6 = L2S10 StationCompleteTimes[10] |\n';

if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 6. deliver + stamp + cover note ═════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);
fs.writeFileSync(headF, h); fs.writeFileSync(backF, b); fs.writeFileSync(metaF, JSON.stringify(meta, null, 2)); fs.writeFileSync(cf, c);
const cfg = JSON.parse(fs.readFileSync(B + '/intake.json', 'utf8'));
const html = OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.html';
const s = run(['scripts/sequenceOfOperation.cjs', D + '/' + M + '.L5X', '--out', html, '--head', headF, '--meta', metaF, '--front', frontF, '--back', backF, '--foot', 'If a device or step is wrong, fix the code, not this sheet.', '--programs', cfg.programs, '--title', cfg.title, '--subtitle', 'Cover note and sequence of operation - v' + VERSION]);
console.log(s.out.trim().split('\n').pop()); must(s.code === 0, 'sequenceOfOperation');
const docx = D + '/' + M + '_CoverNote.docx';
const w = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (B + '/w8_convert.ps1').replace(/\//g, '\\'), '-Html', html.replace(/\//g, '\\'), '-Docx', docx.replace(/\//g, '\\'), '-Pdf', (OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.pdf').replace(/\//g, '\\')], { encoding: 'utf8' });
const wout = (w.stdout || '') + (w.stderr || '');
console.log(wout.trim().split('\n').slice(-2).join('\n'));
must(/saved /.test(wout), 'cover note conversion failed (is Word open?)');
fs.copyFileSync(docx, H + '/' + M + '_CoverNote_v' + VERSION + '_' + ISO + '.docx');
console.log('cover note stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION);
