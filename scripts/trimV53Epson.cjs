#!/usr/bin/env node
'use strict';
/**
 * trimV53Epson.cjs — V5.3.2 (Jason, 2026-10-29): remove from the V5.3 template
 *   1. Epson_Robot_Status.CurrentProgram (UDT member no AOI rung writes) — member, hidden-host renumbering,
 *      L5K + Decorated data on every tag of the type;
 *   2. the ".USEROUT[0].5" operand comment "In Auto Confirm" on S08_EpsonRobotPNP.q_RobotControl (rung gone in 5.3.1).
 *   3. (5.3.3) UserIn[0].3 "At Safe Home Position": Initialized rung reads InsideBox4 instead, comment removed.
 *   Each step skips when the file already has it, so the script can be re-run on any of the 5.3.x files.
 *
 *   node scripts/trimV53Epson.cjs <in.L5X> [--out <out.L5X>]
 */
const fs = require('fs');
const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith('--'));
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
if (!SRC) { console.error('usage: node scripts/trimV53Epson.cjs <in.L5X> [--out <out.L5X>]'); process.exit(2); }
const OUT = flag('out', SRC);
const must = (ok, msg) => { if (!ok) { console.error('FAIL: ' + msg); process.exit(1); } };
const countOf = (s, re) => (s.match(re) || []).length;

let x = fs.readFileSync(SRC, 'utf8');
const NL = '\\r?\\n';

// ---- 1. UDT Epson_Robot_Status
const udtRe = /<DataType Name="Epson_Robot_Status"[\s\S]*?<\/DataType>/;
must(udtRe.test(x), 'Epson_Robot_Status UDT not found');
const step12 = /CurrentProgram/.test(x);   // already trimmed (5.3.2) -> skip to step 3
if (step12) x = x.replace(udtRe, (udt) => {
  const memRe = new RegExp('<Member Name="CurrentProgram"[^>]*>[\\s\\S]*?<\\/Member>' + NL);
  must(memRe.test(udt), 'CurrentProgram member not found');
  udt = udt.replace(memRe, '');
  // hidden BIT hosts are named by their member index; everything after the removed member moves up one
  udt = udt.replace(/ZZZZZZZZZZEpson_Robo(\d+)/g, (m, n) => 'ZZZZZZZZZZEpson_Robo' + (Number(n) > 12 ? Number(n) - 1 : Number(n)));
  const hosts = [...udt.matchAll(/<Member Name="ZZZZZZZZZZEpson_Robo(\d+)"/g)].map((m) => Number(m[1]));
  must(hosts.join(',') === '0,9,12,17,26,35', 'hidden hosts after renumber: ' + hosts.join(','));
  return udt;
});

// ---- tag data on every tag of the type: L5K drops the 3rd scalar, Decorated drops the member line
let l5k = 0, dec = 0;
if (step12) x = x.replace(/(<Tag Name="[^"]*"[^>]*DataType="Epson_Robot_Status"[^>]*>)([\s\S]*?)(<\/Tag>)/g, (m, open, body, close) => {
  const b2 = body.replace(/<!\[CDATA\[\[(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),\[/, (mm, a, b, c, d, e, f, g, h) => { l5k++; return `<![CDATA[[${a},${b},${d},${e},${f},${g},${h},[`; });
  const b3 = b2.replace(new RegExp('<DataValueMember Name="CurrentProgram"[^>]*\\/>' + NL), () => { dec++; return ''; });
  return open + b3 + close;
});
if (step12) must(l5k === 2 && dec === 2, `tag data edits: L5K ${l5k}, Decorated ${dec} (expected 2 and 2)`);
must(countOf(x, /CurrentProgram/g) === 0, 'CurrentProgram still referenced');

// ---- 2. "In Auto Confirm" operand comment
const cmtRe = new RegExp('<Comment Operand="\\.USEROUT\\[0\\]\\.5">' + NL + '<!\\[CDATA\\[In Auto Confirm\\]\\]>' + NL + '<\\/Comment>' + NL);
if (step12) must(countOf(x, new RegExp(cmtRe.source, 'g')) === 1, 'USEROUT[0].5 comment count != 1');
x = x.replace(cmtRe, '');
must(!/USEROUT\[0\]\.5/.test(x), 'USEROUT[0].5 still present');

// ---- 3. (5.3.3, Jason) UserIn[0].3 "At Safe Home Position" is no longer used: safe home is InsideBox4 everywhere,
//         so the Initialized rung takes InsideBox4 and the operand comment goes.
const initRe = /XIC\(i_RobotStatus\.UserIn\[0\]\.0\)XIC\(i_RobotStatus\.UserIn\[0\]\.3\)OTE\(Initialized\);/g;
const step3 = /USERIN\[0\]\.3/.test(x);
if (step3) {
  must(countOf(x, initRe) === 1, 'Initialized rung with UserIn[0].3 count != 1');
  x = x.replace(initRe, 'XIC(i_RobotStatus.UserIn[0].0)XIC(i_RobotStatus.InsideBox4)OTE(Initialized);');
  const c3 = new RegExp('<Comment Operand="\\.USERIN\\[0\\]\\.3">' + NL + '<!\\[CDATA\\[At Safe Home Position\\]\\]>' + NL + '<\\/Comment>' + NL);
  must(countOf(x, new RegExp(c3.source, 'g')) === 1, 'USERIN[0].3 comment count != 1');
  x = x.replace(c3, '');
}
must(!/UserIn\[0\]\.3|USERIN\[0\]\.3/.test(x), 'UserIn[0].3 still present');

fs.writeFileSync(OUT, x);
console.log(`wrote ${OUT}: step 1-2 ${step12 ? 'applied' : 'already done'} (CurrentProgram, In Auto Confirm); step 3 ${step3 ? 'applied' : 'already done'} (UserIn[0].3 -> InsideBox4 in Initialized, comment removed)`);
