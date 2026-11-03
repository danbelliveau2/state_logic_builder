'use strict';
// 1163 v0.6 - part tracking for station 4's two processes (Jason, 2026-11-03, scheme 1, D015).
//   Station number = tracking record. Physical position = where the indexer puts the nests. The 2UP template equates
//   them; this machine has two records at position 4 (station 4 spike and cap, station 16 soft cap), so:
//     - Tracking_Data.Station and Tracking_Part_Assy_Stat.Station 13 -> 17 (15 active stations + station 16), with
//       p_Data, ZeroPartAssyStat, g_StationList, ResetTimersB, StationCompleteTimes resized to match
//     - \L2_Tracking.p_StationPosition DINT[17]: identity, [16] = 4
//     - indexer R10 nest math and Tracking R05 overall status read the position, not the number
//   No station logic. Base: the v0.5.2 stamp. Then gates, deliver, stamp, cover note (same steps as returnIntake.cjs).
// usage: node scripts/revise1163_v06.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const BASE = H + '/1163_Haemonetics_v0.5.2_2026-10-30.L5X';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.6', DEV = 'D015';
const ISO = new Date().toISOString().slice(0, 10), SHORT = 'Nov 3';
const DRY = process.argv.includes('--dry');
const N = 17, SOFTCAP = 16, POS = 4;
const must = (c, m) => { if (!c) { console.error('!! ' + m); process.exit(1); } };
const count = (s, re) => (s.match(re) || []).length;

let x = fs.readFileSync(BASE, 'utf8');
const udt = (n) => { const m = x.match(new RegExp('<DataType Name="' + n + '"[\\s\\S]*?</DataType>')); must(m, 'UDT ' + n); return m[0]; };
const tag = (src, n) => { const m = src.match(new RegExp('<Tag Name="' + n + '"[\\s\\S]*?</Tag>')); must(m, 'tag ' + n); return m[0]; };
const prog = (n) => { const m = x.match(new RegExp('<Program Name="' + n + '"[\\s\\S]*?</Program>')); must(m, 'program ' + n); return m[0]; };
const rep1 = (src, from, to, what) => { const i = src.indexOf(from); must(i >= 0 && src.indexOf(from, i + 1) < 0, what + ': expected exactly once'); return src.slice(0, i) + to + src.slice(i + from.length); };

// ── 1. UDT dimensions ────────────────────────────────────────────────────────
x = x.replace(udt('Tracking_Data'), rep1(udt('Tracking_Data'), 'Name="Station" DataType="Tracking_Station" Dimension="13"', 'Name="Station" DataType="Tracking_Station" Dimension="' + N + '"', 'Tracking_Data.Station'));
x = x.replace(udt('Tracking_Part_Assy_Stat'), rep1(udt('Tracking_Part_Assy_Stat'), 'Name="Station" DataType="Tracking_Process_Op_Result" Dimension="13"', 'Name="Station" DataType="Tracking_Process_Op_Result" Dimension="' + N + '"', 'Part_Assy_Stat.Station'));

// ── 2. data blocks that carry the Station arrays ─────────────────────────────
const opResL5K = '[' + Array(N).fill('[0]').join(',') + ']';
const opResDec = (i) => '<Element Index="[' + i + ']">\n<Structure DataType="Tracking_Process_Op_Result">\n<DataValueMember Name="Attempt" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Success" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Failure" DataType="BOOL" Value="0"/>\n<DataValueMember Name="Lockout" DataType="BOOL" Value="0"/>\n</Structure>\n</Element>';
const opResArrDec = '<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="' + N + '">\n' + Array.from({ length: N }, (_, i) => opResDec(i)).join('\n') + '\n</ArrayMember>';
const widenOpRes = (src, expected, what) => {
  const re = /<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="13">[\s\S]*?<\/ArrayMember>/g;
  must(count(src, re) === expected, what + ': Station[13] decorated arrays ' + count(src, re) + ', expected ' + expected);
  return src.replace(re, opResArrDec);
};
// ZeroPartAssyStat (Tracking)
{
  const old = tag(x, 'ZeroPartAssyStat');
  const head = old.match(/<Tag Name="ZeroPartAssyStat"[^>]*>/)[0];
  const dec = widenOpRes(old.slice(old.indexOf('<Data Format="Decorated">')), 1, 'ZeroPartAssyStat');
  const l5k = "[0," + opResL5K + ",0,[0,'" + '$00'.repeat(82) + "']]";
  x = x.replace(old, head + '\n<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n' + dec);
}
// p_Data (Tracking): 65 nests x Station[17] results + Station[17] of Tracking_Station
{
  const old = tag(x, 'p_Data');
  const head = old.match(/<Tag Name="p_Data"[^>]*>/)[0];
  let l5k = old.slice(old.indexOf('<![CDATA[') + 9, old.indexOf(']]>')).replace(/\s+/g, '');
  const thirteen = '[' + Array(13).fill('[0]').join(',') + ']';
  must(count(l5k, /\[\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\],\[0\]\]/g) === 65, 'p_Data L5K: 65 nest result arrays');
  l5k = l5k.split(thirteen).join(opResL5K);
  const se = '[[0,0],0,0,[0,0,0,0.00000000e+000,0,0,0,0,0,0,0.00000000e+000,0,0,0]]';
  const tail13 = '],[' + Array(13).fill(se).join(',') + ']]';
  must(l5k.endsWith(tail13), 'p_Data L5K: Station[13] tail');
  l5k = l5k.slice(0, -tail13.length) + '],[' + Array(N).fill(se).join(',') + ']]';
  let dec = old.slice(old.indexOf('<Data Format="Decorated">'));
  dec = widenOpRes(dec, 65, 'p_Data');
  const stRe = /<ArrayMember Name="Station" DataType="Tracking_Station" Dimensions="13">([\s\S]*?)<\/ArrayMember>/;
  const st = dec.match(stRe); must(st, 'p_Data: Tracking_Station array');
  const el0 = st[1].match(/<Element Index="\[0\]">[\s\S]*?<\/Element>/); must(el0 && count(st[1], /<Element Index=/g) === 13, 'p_Data: Tracking_Station elements');
  const extra = Array.from({ length: N - 13 }, (_, k) => el0[0].replace('<Element Index="[0]">', '<Element Index="[' + (13 + k) + ']">')).join('\n');
  dec = dec.replace(stRe, (m, body) => '<ArrayMember Name="Station" DataType="Tracking_Station" Dimensions="' + N + '">' + body.replace(/\s*$/, '') + '\n' + extra + '\n</ArrayMember>');
  x = x.replace(old, head + '\n<Data Format="L5K">\n<![CDATA[' + l5k + ']]>\n</Data>\n' + dec);
}
// g_StationList (controller): four more empty names
{
  const old = tag(x, 'g_StationList');
  let t = old.replace('DataType="STRING" Dimensions="13"', 'DataType="STRING" Dimensions="' + N + '"');
  must(t !== old, 'g_StationList dims');
  const emptyL5K = "[0,'" + '$00'.repeat(82) + "']";
  t = t.replace(/\]\s*\]\]\]>/, ']' + (',' + emptyL5K).repeat(N - 13) + ']]]>');
  must(count(t, /\$00'\]/g) >= N - 13, 'g_StationList L5K tail');
  t = t.replace('<Array DataType="STRING" Dimensions="13">', '<Array DataType="STRING" Dimensions="' + N + '">');
  const el2 = t.match(/<Element Index="\[2\]">[\s\S]*?<\/Element>/)[0];
  must(/<!\[CDATA\[\]\]>/.test(el2), 'g_StationList element 2 is empty');
  const extra = Array.from({ length: N - 13 }, (_, k) => el2.replace('<Element Index="[2]">', '<Element Index="[' + (13 + k) + ']">')).join('\n');
  t = t.replace(/\n<\/Array>/, '\n' + extra + '\n</Array>');
  x = x.replace(old, t);
}
// scalar arrays sized to the station count
const scalarArray = (name, l5kZero, decZero) => {
  const old = tag(x, name);
  const head = old.match(/<Tag Name="[^"]+"[^>]*>/)[0].replace('Dimensions="13"', 'Dimensions="' + N + '"');
  must(head !== old.match(/<Tag Name="[^"]+"[^>]*>/)[0], name + ' dims');
  const type = head.match(/DataType="([^"]+)"/)[1], radix = head.match(/Radix="([^"]+)"/)[1];
  const t = head + '\n<Data Format="L5K">\n<![CDATA[[' + Array(N).fill(l5kZero).join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="' + type + '" Dimensions="' + N + '" Radix="' + radix + '">\n' + Array.from({ length: N }, (_, i) => '<Element Index="[' + i + ']" Value="' + decZero + '"/>').join('\n') + '\n</Array>\n</Data>\n</Tag>';
  x = x.replace(old, t);
};
scalarArray('ResetTimersB', '0', '0');
scalarArray('StationCompleteTimes', '0.00000000e+000', '0.0');

// ── 3. p_StationPosition on Tracking ─────────────────────────────────────────
{
  const pos = Array.from({ length: N }, (_, i) => i); pos[SOFTCAP] = POS;
  const t = '<Tag Name="p_StationPosition" TagType="Base" DataType="DINT" Dimensions="' + N + '" Radix="Decimal" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Description>\n<![CDATA[Physical position per station]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[[' + pos.join(',') + ']]]>\n</Data>\n<Data Format="Decorated">\n<Array DataType="DINT" Dimensions="' + N + '" Radix="Decimal">\n' + pos.map((v, i) => '<Element Index="[' + i + ']" Value="' + v + '"/>').join('\n') + '\n</Array>\n</Data>\n</Tag>';
  const q = tag(prog('L2_Tracking'), 'p_StationQty');
  x = rep1(x, q, q + '\n' + t, 'p_StationQty tag');
}

// ── 4. structured text: indexer R10 and Tracking R05 read the position ───────
const stLines = (routine) => [...routine.matchAll(/<Line Number="\d+">\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>)?\s*<\/Line>/g)].map((m) => m[1] || '');
const stBuild = (lines) => '<STContent>\n' + lines.map((l, i) => '<Line Number="' + i + '">\n<![CDATA[' + l + ']]>\n</Line>').join('\n') + '\n</STContent>';
const setST = (progName, routineName, edit) => {
  const p = prog(progName);
  const r = p.match(new RegExp('<Routine Name="' + routineName + '"[\\s\\S]*?</Routine>')); must(r, routineName);
  const lines = stLines(r[0]);
  const out = edit(lines);
  const nr = r[0].replace(/<STContent>[\s\S]*<\/STContent>/, stBuild(out));
  x = x.replace(p, p.replace(r[0], nr));
};
const editLine = (lines, re, to, what) => { const hits = lines.map((l, i) => re.test(l) ? i : -1).filter((i) => i >= 0); must(hits.length === 1, what + ': found ' + hits.length); lines[hits[0]] = lines[hits[0]].replace(re, to); };
setST('L2_S00_IndexerNoSP', 'R10_CalcDialStationNestNums', (lines) => {
  editLine(lines, /2\*\(StationNum - 1\)/, '2*(\\L2_Tracking.p_StationPosition[StationNum] - 1)', 'R10 position term');
  must(/^\/\/Station\[0\]/.test(lines[1]), 'R10 line 1 comment');
  lines.splice(2, 0, '//p_StationPosition gives each station number its physical position - station ' + SOFTCAP + ' (soft cap) shares position ' + POS + ' with station ' + POS);
  return lines;
});
setST('L2_Tracking', 'R05_PartOverallStatus', (lines) => {
  editLine(lines, /^(\s*)\/\/Check Stations Before and up to the current one/, '$1//Check stations at or before this one by physical position (p_StationPosition)', 'R05 comment');
  editLine(lines, /For StationNum2 := 0 to StationNum By 1 Do/, 'For StationNum2 := 0 to p_StationQty By 1 Do', 'R05 loop');
  editLine(lines, /IF p_Data\.Nest\[MyNestNum\]\.PartStatus\.PartLoaded THEN/, 'IF p_Data.Nest[MyNestNum].PartStatus.PartLoaded AND (p_StationPosition[StationNum2] <= p_StationPosition[StationNum]) THEN', 'R05 gate');
  return lines;
});

// ── 5. self-checks, write ────────────────────────────────────────────────────
must(count(x, /Dimension="13"/g) === 0 || !/Name="Station"[^>]*Dimension="13"/.test(x), 'a Station member still 13');
must(count(x, /<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="17">/g) === 66, 'decorated result arrays: ' + count(x, /<ArrayMember Name="Station" DataType="Tracking_Process_Op_Result" Dimensions="17">/g));
must(count(x, /p_StationPosition/g) === 1 + 1 + 1 + 2 + 1, 'p_StationPosition references: ' + count(x, /p_StationPosition/g));
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' bytes)');

// ── 6. gates ─────────────────────────────────────────────────────────────────
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

// ── 7. deliver + stamp ───────────────────────────────────────────────────────
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO);

// ── 8. cover note fragments + contract ───────────────────────────────────────
const headF = OUT + '/' + JOB + '_CoverNote_head.html';
let h = fs.readFileSync(headF, 'utf8');
if (!h.includes('<tr><td>' + VERSION + '</td>')) {
  const row = '<tr><td>' + VERSION + '</td><td>' + SHORT + '</td><td>Part tracking for station 4&rsquo;s two processes: Station arrays 13 &rarr; 17 (15 active stations + station 16, the soft-cap record at position 4); <code>p_StationPosition</code> on Tracking; indexer R10 nest math and Tracking R05 overall status read the position; <code>ResetTimersB</code>, <code>StationCompleteTimes</code>, <code>g_StationList</code> sized to match. No station logic.</td><td>Jason, ' + SHORT + ': &ldquo;I am onboard with your proposed solution (scheme 1). Please build a new version of 1163.&rdquo; ' + DEV + '.</td></tr>\n</table>\n<h2>What I was given</h2>';
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, row);
  h = rep1(h, '(64 nests, 12 stations)', '(64 nests, 15 active stations; Tracking arrays 0&ndash;16, station 16 = the soft-cap process at position 4, see Deviations)', 'head platform');
  h = rep1(h, 'conflicts with PLAYBOOK 7 (2-UP template, A = left, B = right).</td></tr>', 'conflicts with PLAYBOOK 7 (2-UP template, A = left, B = right). <b>' + DEV + '</b> (Open, Jason on board ' + SHORT + '): station 4 is two processes on the same nests, spike and cap on top and soft cap on the bottom, tracked independently &ndash; the soft cap is tracking station 16, placed at position 4 by <code>p_StationPosition</code>; the first downstream station gates on Station[4] and Station[16] in series &ndash; conflicts with the 2UP template, where a station number is its physical position in the indexer nest math.</td></tr>', 'head deviations');
  fs.writeFileSync(headF, h);
}
const backF = OUT + '/' + JOB + '_CoverNote_back.html';
let b = fs.readFileSync(backF, 'utf8');
if (!b.includes('p_StationPosition')) {
  b = rep1(b, 'The 2UP Tracking program renamed in the Oct 29 export, unchanged. L2S01', 'The 2UP Tracking program renamed in the Oct 29 export. Station arrays 0&ndash;16: 15 active stations plus station 16, the soft-cap record that shares position 4 with station 4 (' + DEV + '). <code>p_StationPosition</code> (public, identity except [16] = 4) maps a station number to its physical position; the indexer R10 nest math and Tracking R05 overall status read it, nothing else does. L2S01', 'back tracking row');
  const asks = '<tr><td>17</td><td>Reject and good unload station numbers on the 15-station machine: the template rungs still read Station[11] / [12] (Tracking R01 rungs 2 and 4, Production R01 / R02) and g_StationList[11] / [12] say S11 / S12.</td><td>Jason</td></tr>\n<tr><td>18</td><td>Tracking R05 scans a nest&rsquo;s stations upward and exits at the first one with a result, so a nest that passed station 1 reads Good after a later station fails. Template behaviour, left as is &ndash; intended?</td><td>Jason</td></tr>\n<tr><td>19</td><td>Names for station 4&rsquo;s two processes (g_StationList[4] / [16], program names) when those stations are built.</td><td>Jason</td></tr>\n</table>\n<h2>Referenced</h2>';
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks);
  must(b.includes('<tr><td>19</td>'), 'back asks');
  fs.writeFileSync(backF, b);
}
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (!c.includes('p_StationPosition')) {
  c = c.trimEnd() + '\n\n## Part tracking - station 4, two processes (' + VERSION + ', Jason 2026-11-03, ' + DEV + ')\nStation number = tracking record; physical position = where the indexer puts the nests. Station arrays 0-16 (15 active stations + station 16). Station 4 = spike and cap (top), station 16 = soft cap (bottom), both at position 4, both StaNumPre 3. `\\L2_Tracking.p_StationPosition[17]` maps number -> position (identity, [16] = 4); read by indexer R10 (nest numbers) and Tracking R05 (overall status) only. The first downstream station gates CycleStation on Station[4] and Station[16] (Success or Lockout) in series; every later station chains on its predecessor. FailureType 41-49 spike and cap, 161-169 soft cap. Reject / good unload numbers: ask 17.\n';
  fs.writeFileSync(cf, c);
}
console.log('fragments + contract updated');

// ── 9. cover note ────────────────────────────────────────────────────────────
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
