#!/usr/bin/env node
'use strict';
/**
 * apply1163_v016.cjs — 1163 v0.16: Jason's returned v0.15 (2026-11-16) is the lineage. He added StateDurationHistory DINT[10] and the
 * fifth State_Engine_128Max argument to the six S12 / S13 programs. This script, on his file:
 *   1. L2_S12_Dispenser: the tag he typed as StateHistoryDuration becomes StateDurationHistory (tag and call), the name every other program uses.
 *   2. The six gripper programs (L2_S06-S09_SoftCapGripper, L2_S12 / S13_YSiteGripper) regenerated with the wait split in two states:
 *      one waiting for TubeInserted (a one-scan handshake), the next waiting for RobotClearOfCap / RobotClearOfYSite (Jason, 2026-11-16).
 *      Proof per program: the returned program equals the pre-split generator (pinned at commit 67a4cd2) in content, so the split is the only change.
 *   3. applyStateEngine (per-program 5.1 check), then the gates: shape lint on the eight programs, import simulation against the input, regression.
 *
 *   node scripts/apply1163_v016.cjs [--in <file.L5X>] [--out <file.L5X>] [--dump <dir>]     (default: the delivery, in place - returnIntake --apply)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, programBody, tagXml, countOf } = H;
const GRIP6 = require('./lib/s6/gripper.cjs');
const GRIP12 = require('./lib/s12/gripper.cjs');

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163';
const argOf = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const IN = argOf('in', D + '/1163_Haemonetics.L5X'), OUT = argOf('out', IN);
const DUMP = argOf('dump', path.join(ROOT, 'generated/1163/build/programs'));
const PIN = '67a4cd2';   // the generators as they shipped v0.15 (pre-split)
const log = [];
const src = fs.readFileSync(IN, 'utf8');
let x = src;
const sn = (n) => 'L2S' + String(n).padStart(2, '0');
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };

// ── 1. the mistyped tag ──────────────────────────────────────────────────────
{
  const P = 'L2_S12_Dispenser';
  let b = programBody(x, P) || fail(P);
  must(countOf(b, 'StateHistoryDuration') === 2 && !b.includes('StateDurationHistory'), P + ': StateHistoryDuration typed twice (tag + call), the standard name absent');
  b = b.split('StateHistoryDuration').join('StateDurationHistory');
  replaceProgram(P, b);
  log.push(P + ': StateHistoryDuration -> StateDurationHistory (tag and call)');
}

// ── 2. the eight grippers ────────────────────────────────────────────────────
const S01 = programBody(x, 'L2_S01_TubeFeedUpstream') || fail('L2_S01_TubeFeedUpstream');
must(tagXml(S01, 'StateDurationHistory'), 'S01 carries StateDurationHistory (5.1)');
const STATIONS = [
  { sta: 6, ab: 'B', robot: 'rob03_L2S06Robot', kind: 'SoftCapGripper', lib: GRIP6, prefix: 'L2S06 Tube Insert: ' },
  { sta: 7, ab: 'A', robot: 'rob04_L2S07Robot', kind: 'SoftCapGripper', lib: GRIP6, prefix: 'L2S07 Tube Insert: ' },
  { sta: 8, ab: 'B', robot: 'rob05_L2S08Robot', kind: 'SoftCapGripper', lib: GRIP6, prefix: 'L2S08 Tube Insert: ' },
  { sta: 9, ab: 'A', robot: 'rob06_L2S09Robot', kind: 'SoftCapGripper', lib: GRIP6, prefix: 'L2S09 Tube Insert: ' },
  { sta: 12, ab: 'B', robot: 'rob07_L2S12Robot', kind: 'YSiteGripper', lib: GRIP12, prefix: 'L2S12 Y Site Insert: ' },
  { sta: 13, ab: 'A', robot: 'rob08_L2S13Robot', kind: 'YSiteGripper', lib: GRIP12, prefix: 'L2S13 Y Site Insert: ' },
];
for (const c of STATIONS) { const s = String(c.sta).padStart(2, '0'); c.robotProg = 'L2_S' + s + '_InsertRobot'; c.gripperProg = 'L2_S' + s + '_' + c.kind; c.dispenserProg = 'L2_S' + s + '_Dispenser'; }

// the pre-split generators, pinned
const OLD = path.join(ROOT, 'generated/1163/build/oldlib_' + PIN);
for (const f of ['lib/l5xBuild.cjs', 'lib/s4/common.cjs', 'lib/s6/gripper.cjs', 'lib/s12/gripper.cjs']) {
  const g = spawnSync('git', ['show', PIN + ':scripts/' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 << 20 });
  must(g.status === 0 && g.stdout.length > 100, 'git show ' + PIN + ':scripts/' + f);
  fs.mkdirSync(path.join(OLD, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(OLD, f), g.stdout);
}
const OLD6 = require(path.join(OLD, 'lib/s6/gripper.cjs')), OLD12 = require(path.join(OLD, 'lib/s12/gripper.cjs'));

// content shape: tags, descriptions, operand comments, strings, presets (sorted) + rungs in order (a Studio export re-wraps data and sorts its own way)
const shape = (body) => {
  const tags = [...body.matchAll(/<Tag Name="([^"]+)"[^>]*?DataType="([^"]+)"([^>]*?)>/g)].map((m) => 'TAG ' + m[1] + ' ' + m[2] + (/Dimensions="(\d+)"/.exec(m[3]) ? ' [' + /Dimensions="(\d+)"/.exec(m[3])[1] + ']' : '') + (/Usage="(\w+)"/.exec(m[3]) ? ' ' + /Usage="(\w+)"/.exec(m[3])[1] : ''));
  const descs = [...body.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => 'DESC ' + m[1].trim());
  const ops = [...body.matchAll(/<Comment Operand="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => 'OP ' + m[1] + ' ' + m[2].trim());
  const strs = [...body.matchAll(/\[\d+,'([^']*?)(?:\$00)*'/g)].map((m) => 'STR ' + m[1]);
  const timers = [...body.matchAll(/<Tag Name="([^"]+)"[^>]*DataType="TIMER"[\s\S]*?Name="PRE"[^>]*Value="(\d+)"/g)].map((m) => 'PRE ' + m[1] + ' ' + m[2]);
  const rungs = [];
  for (const r of body.matchAll(/<Routine Name="([^"]+)"[\s\S]*?<\/Routine>/g)) for (const rg of rungList(r[0])) rungs.push('RUNG ' + r[1] + ' | ' + ((/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(rg) || [, ''])[1]).replace(/\s+/g, ' ').trim() + ' | ' + rungText(rg));
  return [...[...tags, ...descs, ...ops, ...strs, ...timers].sort(), ...rungs.map((l) => l.replace(/\s+/g, ''))];
};
const pre51 = (lines) => lines.filter((l) => l !== 'TAG StateDurationHistory DINT [10]').map((l) => l.replace(',StateHistory,StateDurationHistory)', ',StateHistory)'));
const diffAt = (a, b) => { const i = a.findIndex((l, k) => l !== b[k]); return i >= 0 ? i : (a.length !== b.length ? Math.min(a.length, b.length) : -1); };

const DUMPED = [];
for (const c of STATIONS) {
  const P = c.gripperProg;
  const cur = programBody(x, P) || fail(P);
  const old = (c.lib === GRIP6 ? OLD6 : OLD12).build({ S01, cfg: c });
  must(old.PROG === P, 'old generator program name ' + P);
  // proof: the returned program is the pre-split generator output (plus the 5.1 history tag and argument)
  const a = pre51(shape(cur)), b = pre51(shape(old.xml));
  const i = diffAt(a, b);
  if (i >= 0) fail(P + ': the returned program differs from the pre-split generator at line ' + (i + 1) + ':\n  returned: ' + (a[i] || '(end)') + '\n  generator: ' + (b[i] || '(end)'));
  const neu = c.lib.build({ S01, cfg: c });
  must(neu.PROG === P && tagXml(neu.xml, 'StateDurationHistory') && neu.xml.includes('State_Engine_128Max(StateEngine,Control,Status,StateHistory,StateDurationHistory);'), P + ': new program carries the 5.1 form');
  // what changed: rungs only, named
  const ra = shape(cur).filter((l) => l.startsWith('RUNG')), rb = shape(neu.xml).filter((l) => l.startsWith('RUNG'));
  const gone = ra.filter((l) => !rb.includes(l)).length, added = rb.filter((l) => !ra.includes(l)).length;
  const states = [...neu.xml.matchAll(/<Comment Operand="\.STATE\[(\d+)\]">\s*<!\[CDATA\[([^\]]*)\]\]>/g)].filter((m) => +m[1] >= 4 && +m[1] < 99).map((m) => m[1] + ' ' + m[2]);
  replaceProgram(P, neu.xml);
  fs.mkdirSync(DUMP, { recursive: true });
  const f = path.join(DUMP, P + '.xml'); fs.writeFileSync(f, neu.xml); DUMPED.push(f);
  log.push(P + ': proved = pre-split generator; split applied - ' + rungList(cur).length + ' -> ' + rungList(neu.xml).length + ' rungs (' + gone + ' rewritten, ' + added + ' new); states ' + states.join(', '));
}

// ── 3. everything else untouched ─────────────────────────────────────────────
{
  const names = [...src.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  const EDITED = new Set(['L2_S12_Dispenser', ...STATIONS.map((c) => c.gripperProg)]);
  for (const n of names) if (!EDITED.has(n)) must(programBody(x, n) === programBody(src, n), 'program changed: ' + n);
  must(x.replace(/<Programs>[\s\S]*<\/Programs>/, '') === src.replace(/<Programs>[\s\S]*<\/Programs>/, ''), 'outside <Programs> byte-identical');
  log.push('untouched: ' + (names.length - EDITED.size) + ' programs and everything outside <Programs> byte-identical to the input');
}
fs.writeFileSync(OUT, x);
console.log('wrote ' + OUT);
for (const l of log) console.log('  - ' + l);

// ── 4. gates ─────────────────────────────────────────────────────────────────
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const eng = run(['scripts/applyStateEngine.cjs', OUT, '--out', OUT]);
console.log('- state engine: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const lint = run(['scripts/shapeLint.cjs', ...DUMPED]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-12).map((l) => '    ' + l).join('\n'));
const vres = run(['scripts/validate1160.cjs', OUT, '--baseline', IN, '--json', path.join(ROOT, 'generated/1163/out/apply_v0.16.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation vs the input: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict)) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW|warn/i.test(l)).slice(0, 40).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed');

// ── 5. cover note meta: the gripper notes say it in two steps now ───────────
{
  const metaF = D + '/build-inputs/out/1163_CoverNote_meta.json';
  const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
  for (const c of STATIONS) {
    const m = meta[c.gripperProg] || fail('meta ' + c.gripperProg);
    if (c.kind === 'SoftCapGripper') m.notes = m.notes.replace('places on p_TubeInserted with the robot clear of the cap (not Box 4).', 'waits for p_TubeInserted (one scan), then in the next state for the robot clear of the cap (not Box 4), then places.');
    else m.notes = m.notes.replace('opens on p_TubeInserted with the robot clear of the Y site (not Box 4).', 'waits for p_TubeInserted (one scan), then in the next state for the robot clear of the Y site (not Box 4), then opens.');
    must(/one scan/.test(m.notes), 'meta notes updated: ' + c.gripperProg);
  }
  fs.writeFileSync(metaF, JSON.stringify(meta, null, 2));
  console.log('- cover note meta: six gripper notes updated');
}
console.log('done');
