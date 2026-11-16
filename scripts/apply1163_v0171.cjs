#!/usr/bin/env node
'use strict';
/**
 * apply1163_v0171.cjs — 1163 v0.17.1 on the v0.17 stamp: per-side results gates on the two coilers (Jason, 2026-11-16).
 *
 *   node scripts/apply1163_v0171.cjs [--dry]
 *
 *   "Station 14 upstream is dependent on the result of station 13. Station 14 downstream is dependent on the result of station 12.
 *    Station 10 upstream dependent on station 8 result. Station 10 downstream dependent on station 9 result."
 *   L2_S10_BlueTubeCoiler and L2_S14_ClearTubeCoiler: StaNumPre becomes StaNumPreUpstream / StaNumPreDownstream (S10: 8 / 9; S14: 13 / 12);
 *   each head's cycle-station rung gates on its own results station; NestNumIncoming reads Station[StaNum-1] as on the S06 form.
 *   Everything else as stamped. Then gates, deliver, stamp, cover note.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, programBody, getRoutine, putRungs, tagXml, countOf, rep1 } = H;

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H_ = D + '/_history', B = D + '/build-inputs', OUT = B + '/out';
const BASE = H_ + '/1163_Haemonetics_v0.17_2026-11-16.L5X';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.17.1', SHORT = 'Nov 16';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const STATIONS = [
  { prog: 'L2_S10_BlueTubeCoiler', sta: 10, pre: 9, up: 8, down: 9 },
  { prog: 'L2_S14_ClearTubeCoiler', sta: 14, pre: 13, up: 13, down: 12 },
];
const log = [];
const base = fs.readFileSync(BASE, 'utf8');
let x = base;
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };
const T = '\\L2_Tracking.p_Data.';

// ═══ 1. the two coilers ══════════════════════════════════════════════════════
for (const c of STATIONS) {
  let b = programBody(x, c.prog) || fail(c.prog);
  must(countOf(b, 'StaNumPre') === 8, c.prog + ' StaNumPre used eight times (tag, rung 0 x3, two gates x2): ' + countOf(b, 'StaNumPre'));
  // tags: StaNumPre -> StaNumPreUpstream, StaNumPreDownstream
  const old = tagXml(b, 'StaNumPre') || fail('StaNumPre tag');
  const mk = (name, desc) => old.replace('<Tag Name="StaNumPre"', '<Tag Name="' + name + '"').replace(/(<Tag [^>]*>\n)/, '$1' + H.descXml(desc));
  b = b.replace(old, mk('StaNumPreDownstream', 'Results Station, Downstream') + '\n' + mk('StaNumPreUpstream', 'Results Station, Upstream'));
  // R01 rung 0: station numbers, incoming nests from the station physically before this one
  const r = rungList(getRoutine(b, 'R01_Inputs'));
  const r0 = 'MOVE(' + c.sta + ',StaNum) MOVE(' + c.pre + ',StaNumPre) ,MOVE(' + T + 'Station[StaNum].NestNumA,NestNumCurrentUpstream) MOVE(' + T + 'Station[StaNumPre].NestNumA,NestNumIncomingUpstream) ,MOVE(' + T + 'Station[StaNum].NestNumB,NestNumCurrentDownstream) MOVE(' + T + 'Station[StaNumPre].NestNumB,NestNumIncomingDownstream)';
  must(rungText(r[0]) === '[' + r0 + ' ];', c.prog + ' R01 rung 0 as stamped');
  r[0] = setRungText(r[0], '[MOVE(' + c.sta + ',StaNum) MOVE(' + c.up + ',StaNumPreUpstream) MOVE(' + c.down + ',StaNumPreDownstream) ,MOVE(' + T + 'Station[StaNum].NestNumA,NestNumCurrentUpstream) MOVE(' + T + 'Station[' + (c.sta - 1) + '].NestNumA,NestNumIncomingUpstream) ,MOVE(' + T + 'Station[StaNum].NestNumB,NestNumCurrentDownstream) MOVE(' + T + 'Station[' + (c.sta - 1) + '].NestNumB,NestNumIncomingDownstream) ];');
  // cycle-station gates per side
  for (const [i, side] of [[36, 'Upstream'], [37, 'Downstream']]) {
    const t = rungText(r[i]);
    must(t.startsWith('[XIC(' + T + 'Nest[NestNumCurrent' + side + '].PartStatus.PartLoaded) [XIC(' + T + 'Nest[NestNumCurrent' + side + '].PartStatus.Station[StaNumPre].Success) ,XIC(' + T + 'Nest[NestNumCurrent' + side + '].PartStatus.Station[StaNumPre].Lockout) ]'), c.prog + ' gate rung ' + i);
    must(countOf(t, 'Station[StaNumPre]') === 2, c.prog + ' gate rung ' + i + ' reads StaNumPre twice');
    r[i] = setRungText(r[i], t.split('Station[StaNumPre]').join('Station[StaNumPre' + side + ']'));
  }
  b = putRungs(b, 'R01_Inputs', r);
  must(!/StaNumPre[^UD]/.test(b.replace(/StaNumPre(Upstream|Downstream)/g, '')), c.prog + ' no bare StaNumPre left');
  must(countOf(b, 'StaNumPreUpstream') === 4 && countOf(b, 'StaNumPreDownstream') === 4, c.prog + ' new tags: tag, MOVE, Success, Lockout');
  replaceProgram(c.prog, b);
  fs.mkdirSync(PROGDIR, { recursive: true });
  fs.writeFileSync(path.join(PROGDIR, c.prog + '.xml'), b);
  log.push(c.prog + ': upstream head gates on Station[' + c.up + '], downstream on Station[' + c.down + ']; incoming nests from Station[' + (c.sta - 1) + ']');
}
// proof: S14 still equals S10 once names and numbers are normalized
{
  const f32 = (n) => Math.fround(n).toExponential(8).replace(/e([+-])(\d+)$/, (m, s, d) => 'e' + s + d.padStart(3, '0'));
  const norm = (s, c, pick, cs, ct, revs, rot, z) => s.replace('<Program Name="L2_S' + c.sta + '_', '<Program Name="L2_S##_').split('L2S' + c.sta + ' Tube Coil: ').join('L2S## Tube Coil: ')
    .replace('MOVE(' + c.sta + ',StaNum) MOVE(' + c.up + ',StaNumPreUpstream) MOVE(' + c.down + ',StaNumPreDownstream)', 'MOVE(#,StaNum) MOVE(#,StaNumPreUpstream) MOVE(#,StaNumPreDownstream)')
    .split('Station[' + (c.sta - 1) + '].NestNum').join('Station[#].NestNum').split('MOVE(' + c.sta + '1,\\L2_Tracking').join('MOVE(#1,\\L2_Tracking')
    .split(f32(pick)).join('#PICK').split('Value="' + pick + '"').join('Value="#PICK"')
    .split(f32(cs)).join('#CS').split('Value="' + cs + '"').join('Value="#CS"').split(f32(ct)).join('#CT').split('Value="' + ct + '"').join('Value="#CT"')
    .split(f32(revs)).join('#R').split('Value="' + revs + '"').join('Value="#R"').split(f32(rot)).join('#ROT').split('Value="' + rot + '"').join('Value="#ROT"')
    .split(f32(z)).join('#Z').split('Value="-' + z + '"').join('Value="-#Z"').split('Value="' + z + '"').join('Value="#Z"');
  const a = norm(programBody(x, STATIONS[0].prog).replace('<Program Name="L2_S10_BlueTubeCoiler"', '<Program Name="L2_S10_'), STATIONS[0], 765.5, 775.5, 725.5, 3.08, 1108.57, 12.936);
  const b = norm(programBody(x, STATIONS[1].prog).replace('<Program Name="L2_S14_ClearTubeCoiler"', '<Program Name="L2_S14_'), STATIONS[1], 383.1, 393.1, 343.1, 1.456, 524.16, 6.115);
  if (a !== b) { let i = 0; while (a[i] === b[i]) i++; fail('S14 differs from S10 beyond names and numbers at offset ' + i + ':\n  S10: ' + a.slice(i - 60, i + 80) + '\n  S14: ' + b.slice(i - 60, i + 80)); }
  log.push('L2_S14_ClearTubeCoiler still identical to L2_S10_BlueTubeCoiler except names and numbers');
}
// proof: every other program stays as stamped
{
  const EDITED = new Set(STATIONS.map((c) => c.prog));
  const names = [...base.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) if (!EDITED.has(n)) must(programBody(x, n) === programBody(base, n), 'program changed: ' + n);
  must(x.replace(/<Programs>[\s\S]*<\/Programs>/, '') === base.replace(/<Programs>[\s\S]*<\/Programs>/, '').replace(/ExportDate="[^"]*"/, (m) => m), 'nothing outside the programs changed');
  log.push('untouched: ' + (names.length - EDITED.size) + ' programs and everything outside <Programs> byte-identical to the stamp');
}

// ═══ 2. write + gates ════════════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', ...STATIONS.map((c) => path.join(PROGDIR, c.prog + '.xml'))]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-20).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict) || process.argv.includes('--verbose')) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW|warn/i.test(l)).slice(0, 80).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');
if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 3. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);

// ═══ 4. cover note ═══════════════════════════════════════════════════════════
{
  const rep = (s, a, b, what) => { must(s.split(a).length === 2, 'anchor not found once: ' + what); return s.replace(a, () => b); };
  const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
  let h = fs.readFileSync(headF, 'utf8'), bk = fs.readFileSync(backF, 'utf8');
  const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
  if (!h.includes('<tr><td>0.17.1</td>')) {
    h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.17.1</td><td>' + SHORT + '</td><td>Per-side results gates on the two coilers: <code>StaNumPre</code> becomes <code>StaNumPreUpstream</code> / <code>StaNumPreDownstream</code> and each head&rsquo;s cycle-station rung gates on its own results station &ndash; L2S10 upstream on Station[8], downstream on Station[9]; L2S14 upstream on Station[13], downstream on Station[12]. The incoming nests read Station[StaNum&minus;1] as on the S06 form. Two programs changed by <code>scripts/apply1163_v0171.cjs</code>, S14 still proved equal to S10; shape checker 0, import simulation PASS, regression pass.</td><td>Jason, Nov 16: &ldquo;Station 14 upstream is dependent on the result of station 13. Station 14 downstream is dependent on the result of station 12. Station 10 upstream dependent on station 8 result. Station 10 downstream dependent on station 9 result.&rdquo;</td></tr>\n</table>\n<h2>What I was given</h2>');
    must(h.includes('<tr><td>0.17.1</td>'), 'head row 0.17.1');
  }
  if (!bk.includes('<tr><td>59</td>')) {
    bk = rep(bk, 'L2S14 writes Station[14] on both nest sides like L2S10 (Attempt at 7, Success at 43, Lockout at the index, FailureType 141 on a tube released by a restart) and gates on Station[13].', 'L2S14 writes Station[14] on both nest sides like L2S10 (Attempt at 7, Success at 43, Lockout at the index, FailureType 141 on a tube released by a restart). Per-side results gates (Jason, Nov 16): L2S10 upstream head on Station[8], downstream on Station[9]; L2S14 upstream on Station[13], downstream on Station[12].', 'back tracking');
    const asks = [['59', 'Per-side gates as you said them: L2S10 upstream (nest A) on Station[8], downstream (nest B) on Station[9]; L2S14 upstream on Station[13], downstream on Station[12]. As built, S8 and S12 write their results on nest B (downstream) and S9 and S13 on nest A (upstream), so the S14 pair matches and the S10 pair is crossed: nest A never carries a Station[8] result, so the S10 upstream head would wait at state 4 for a result that does not come. Either the S10 numbers are the other way round (upstream 9, downstream 8) or the S8 / S9 nest sides are &ndash; say which and the one MOVE changes.', 'Jason']]
      .map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n');
    bk = bk.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks + '\n</table>\n<h2>Referenced</h2>');
    must(bk.includes('<tr><td>59</td>'), 'back asks');
    bk = rep(bk, '<code>scripts/coverNote1163S14.cjs</code>.', '<code>scripts/coverNote1163S14.cjs</code>, <code>scripts/apply1163_v0171.cjs</code>.', 'back referenced');
  }
  const m10 = meta['L2_S10_BlueTubeCoiler'] || fail('meta S10'), m14 = meta['L2_S14_ClearTubeCoiler'] || fail('meta S14');
  m10.notes = rep(m10.notes, 'StaNum 10, StaNumPre 9;', 'StaNum 10; results gates per head: upstream (nest A) on Station[8], downstream (nest B) on Station[9] (Jason, Nov 16; see ask 59), incoming nests from Station[9];', 'meta S10 notes');
  m14.notes = rep(m14.notes, 'StaNum 14, StaNumPre 13;', 'StaNum 14; results gates per head: upstream (nest A) on Station[13], downstream (nest B) on Station[12] (Jason, Nov 16), incoming nests from Station[13];', 'meta S14 notes');
  m14.extra.Ask = '56, 57, 58, 59'; m10.extra.Ask = (m10.extra.Ask ? m10.extra.Ask + ', ' : '') + '59';
  fs.writeFileSync(headF, h); fs.writeFileSync(backF, bk); fs.writeFileSync(metaF, JSON.stringify(meta, null, 2));
  const cfg = JSON.parse(fs.readFileSync(B + '/intake.json', 'utf8'));
  const html = OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.html';
  const s = run(['scripts/sequenceOfOperation.cjs', D + '/' + M + '.L5X', '--out', html, '--head', headF, '--meta', metaF, '--front', frontF, '--back', backF, '--foot', 'If a device or step is wrong, fix the code, not this sheet.', '--programs', cfg.programs, '--title', cfg.title, '--subtitle', 'Cover note and sequence of operation - v' + VERSION]);
  console.log(s.out.trim().split('\n').slice(-2).join('\n')); must(s.code === 0, 'sequenceOfOperation');
  const docx = D + '/' + M + '_CoverNote.docx';
  const w = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (B + '/w8_convert.ps1').replace(/\//g, '\\'), '-Html', html.replace(/\//g, '\\'), '-Docx', docx.replace(/\//g, '\\'), '-Pdf', (OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.pdf').replace(/\//g, '\\')], { encoding: 'utf8' });
  const wout = (w.stdout || '') + (w.stderr || '');
  console.log(wout.trim().split('\n').slice(-2).join('\n'));
  must(/saved /.test(wout), 'cover note conversion failed (is Word open?)');
  fs.copyFileSync(docx, H_ + '/' + M + '_CoverNote_v' + VERSION + '_' + ISO + '.docx');
  console.log('cover note stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION);
}
