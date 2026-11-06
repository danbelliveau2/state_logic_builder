#!/usr/bin/env node
'use strict';
/**
 * apply1163_v010.cjs — 1163 v0.10: L2S04 (EC) reworked on Jason's returned copy of v0.9.1 (the _v0.9.1_returned stamp).
 *
 *   node scripts/apply1163_v010.cjs [--dry]
 *
 *   Rebuilds the four L2S04 programs from scripts/lib/s4 (restart by situation, Z to the dispense height before X, permissives by zone,
 *   blade extend fault, oscillation confirmed, force defaults, dispenser START held through a fault, Jason's two rules from the return)
 *   and swaps them into his file; adds the two funnel-opened inputs (VB1 DXPC IN4 CH1 / CH2). Everything else in his copy stays as he exported it.
 *   Then gates, deliver, stamp. Cover note: scripts/coverNote1163S4.cjs.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, programBody, insertBefore, countOf, rungList, rungText, setRungText, newRung, getRoutine, putRungs, tagXml, replaceTagIn } = H;
const ESC = require('./lib/s4/escapement.cjs');
const PNP = require('./lib/s4/pnp.cjs');
const DISP = require('./lib/s4/dispenser.cjs');

const ROOT = path.join(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', H_ = D + '/_history';
const BASE = H_ + '/1163_Haemonetics_v0.9.1_returned_2026-11-06.L5X';
const V54 = path.join(ROOT, 'plc-reference/training-material/SDC Standard Templates/SoftwareStandardization.L5X');
const M = '1163_Haemonetics', VERSION = '0.10.1';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const PROGDIR = path.join(ROOT, 'generated', '1163', 'build', 'programs');
const STA = 4, STAPRE = 3, PREFIX = 'L2S04 Spike And Cap: ';
const SIDES = ['Upstream', 'Downstream'];
let x = fs.readFileSync(BASE, 'utf8');
const v = fs.readFileSync(V54, 'utf8');
const S01 = programBody(x, 'L2_S01_TubeFeedUpstream') || fail('L2_S01_TubeFeedUpstream');
const TRK = programBody(x, 'L2_Tracking') || fail('L2_Tracking');
const IDXB = programBody(x, 'L2_S00_IndexerNoSP') || fail('L2_S00_IndexerNoSP');
const S05 = programBody(v, 'S05_ServoPNP') || fail('V5.4 S05_ServoPNP');
const replaceProgram = (name, body) => { const m = H.progRe(name).exec(x) || fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); };

// ═══ 1. the four programs, rebuilt ═══════════════════════════════════════════
const progs = [
  [ESC.PROG, ESC.build({ S01, S05, PREFIX, STA })],
  [PNP.PROG, PNP.build({ S01, S05, TRK, IDXB, PREFIX, STA, STAPRE })],
  ...SIDES.map((side) => { const d = DISP.build({ S01, PREFIX, STA, side }); return [d.PROG, d.xml]; }),
];
fs.mkdirSync(PROGDIR, { recursive: true });
for (const [name, xml] of progs) {
  must(countOf(x, '<Program Name="' + name + '"') === 1, name + ' present once in the base');
  replaceProgram(name, xml);
  fs.writeFileSync(path.join(PROGDIR, name + '.xml'), xml);
}
const NEW = progs.map(([n]) => n);
console.log('programs rebuilt: ' + NEW.join(', '));

// ═══ 2. funnel-opened inputs: VB1 DXPC IN4 CH1 / CH2 = byte 3 bits 1 / 2 (Jason 2026-11-06; IN4 CH0 = rotary Downstream retracted) ═══
const VB = 'vb01_MainAssembly', IN = (byte, bit) => VB + '_IN.Data[' + byte + '].' + bit;
const P = '\\' + PNP.PROG + '.';
const pcs = [[IN(3, 1), P + 'i_FunnelGripperUpstreamOpened'], [IN(3, 2), P + 'i_FunnelGripperDownstreamOpened']];
for (const [a, b] of pcs) { must(!x.includes('EndPoint1="' + a + '"'), 'point already connected: ' + a); must(!x.includes('EndPoint2="' + b + '"'), 'already connected: ' + b); }
x = insertBefore(x, '</ParameterConnections>', pcs.map(([a, b]) => '<ParameterConnection EndPoint1="' + a + '" EndPoint2="' + b + '"/>').join('\n') + '\n', '</ParameterConnections>');
console.log('parameter connections added: ' + pcs.length);

// ═══ 2b. L2_S10 nest opener faults in the TubeFeed device form (Jason 2026-11-06: pneumatic devices with sensors fault like TubeFeed) ═══
const S10 = 'L2_S10_BlueTubeCoiler';
{
  const PFX = 'L2S10 Tube Coil: ';
  let b = programBody(x, S10) || fail(S10);
  const list = [...tagXml(b, 'AlarmList').matchAll(/<!\[CDATA\['([^']*)'\]\]>/g)].map((m) => m[1]);
  must(list.length === 23 && list[5] === 'Waiting For Nest Opener Upstream To Retract' && list[6] === 'Waiting For Nest Opener Downstream To Retract', 'S10 alarm list as expected: ' + list.length);
  const msgs = [...list, 'Waiting For Nest Opener Upstream To Extend', 'Waiting For Nest Opener Downstream To Extend'];
  b = replaceTagIn(b, 'Alarm', H.alarmArrayTag('Alarm', PFX, msgs, 25));
  b = replaceTagIn(b, 'AlarmList', H.stringArrayTag('AlarmList', msgs, 25));
  must(!tagXml(b, 'AlarmTimerNestOpenerUpstreamRetracted'), 'S10 alarm timers absent');
  b = insertBefore(b, '</Tags>', SIDES.flatMap((s) => ['Retracted', 'Extended'].map((d) => H.alarmTimerTag('AlarmTimerNestOpener' + s + d))).join('\n') + '\n', 'S10 tags end');
  const rungs = rungList(getRoutine(b, 'R20_Alarms') || fail('S10 R20'));
  const idx = (n) => rungs.findIndex((r) => rungText(r).includes('OTE(Alarm[' + n + '].Active)'));
  const i5 = idx(5), i6 = idx(6);
  must(i5 >= 0 && i6 === i5 + 1, 'S10 nest opener rungs 5 / 6');
  const dev = (n, s, dir, cmd) => H.deviceAlarm(n, 'Lockout' + s, 'q_' + cmd + 'NestOpener' + s, 'NestOpener' + s + dir, 'AlarmTimerNestOpener' + s + dir, 'AlarmONS.' + n);
  rungs[i5] = setRungText(rungs[i5], dev(5, 'Upstream', 'Retracted', 'Retract'));
  rungs[i6] = setRungText(rungs[i6], dev(6, 'Downstream', 'Retracted', 'Retract'));
  rungs.splice(i6 + 1, 0, newRung(msgs[23], dev(23, 'Upstream', 'Extended', 'Extend')), newRung(msgs[24], dev(24, 'Downstream', 'Extended', 'Extend')));
  b = putRungs(b, 'R20_Alarms', rungs);
  for (const t of ['q_ExtendNestOpenerUpstream', 'NestOpenerDownstreamExtended', 'LockoutUpstream']) must(tagXml(b, t), 'S10 tag ' + t);
  replaceProgram(S10, b);
  fs.writeFileSync(path.join(PROGDIR, S10 + '.xml'), b);
  console.log('L2_S10: nest opener faults in the device form, alarms 23 / 24 added (array 25)');
}

// ═══ 3. write + gates ════════════════════════════════════════════════════════
const NOW = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + NOW.toDateString().replace(/^(\w+) (\w+) (\d+) (\d+)$/, '$1 $2 $3') + ' ' + NOW.toTimeString().slice(0, 8) + ' ' + NOW.getFullYear() + '"');
for (const n of NEW) must(countOf(x, '<Program Name="' + n + '"') === 1 && countOf(x, '<ScheduledProgram Name="' + n + '"/>') === 1, n + ' scheduled once');
fs.mkdirSync(path.join(ROOT, 'generated/1163/out'), { recursive: true });
const OUTFILE = path.join(ROOT, 'generated/1163/out/1163_v' + VERSION + '.L5X');
fs.writeFileSync(OUTFILE, x);
console.log('wrote ' + OUTFILE + ' (' + x.length + ' chars)');

const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lint = run(['scripts/shapeLint.cjs', ...[...NEW, S10].map((n) => path.join(PROGDIR, n + '.xml'))]);
console.log('- shape lint: ' + (lint.code === 0 ? '0 findings' : 'FINDINGS') + '\n' + lint.out.trim().split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
const eng = run(['scripts/applyStateEngine.cjs', OUTFILE, '--out', OUTFILE]);
console.log('- state engine + template AOIs: ' + eng.out.trim().split('\n').slice(-2).join(' | '));
must(eng.code === 0, 'applyStateEngine');
const vres = run(['scripts/validate1160.cjs', OUTFILE, '--baseline', BASE, '--json', OUTFILE.replace(/\.L5X$/, '.validate.json')]);
const verdict = (vres.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
console.log('- import simulation: ' + verdict + ' - ' + ((vres.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim()));
if (!/PASS/.test(verdict)) console.log(vres.out.split('\n').filter((l) => /error|ERROR|NEW/.test(l)).slice(0, 60).join('\n'));
const g = run(['scripts/regressStudioImport1163.cjs']);
console.log('- regression: ' + (g.code === 0 ? 'pass' : 'FAIL') + ' - ' + g.out.trim().split('\n').pop());
must(lint.code === 0 && /PASS/.test(verdict) && g.code === 0, 'a gate failed; nothing delivered');
if (DRY) { console.log('--dry: nothing delivered'); process.exit(0); }

// ═══ 4. deliver + stamp ══════════════════════════════════════════════════════
fs.copyFileSync(OUTFILE, D + '/' + M + '.L5X');
fs.copyFileSync(OUTFILE, H_ + '/' + M + '_v' + VERSION + '_' + ISO + '.L5X');
fs.copyFileSync(OUTFILE.replace(/\.L5X$/, '.validate.json'), D + '/' + M + '.validate.json');
console.log('delivered ' + D + '/' + M + '.L5X, stamped _v' + VERSION + '_' + ISO + '\ndone: v' + VERSION + ' (cover note: node scripts/coverNote1163S4.cjs)');
