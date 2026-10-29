#!/usr/bin/env node
'use strict';
/**
 * trimV53Epson.cjs — V5.3.2 (Jason, 2026-10-29): remove from the V5.3 template
 *   1. Epson_Robot_Status.CurrentProgram (UDT member no AOI rung writes) — member, hidden-host renumbering,
 *      L5K + Decorated data on every tag of the type;
 *   2. the ".USEROUT[0].5" operand comment "In Auto Confirm" on S08_EpsonRobotPNP.q_RobotControl (rung gone in 5.3.1).
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
x = x.replace(udtRe, (udt) => {
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
x = x.replace(/(<Tag Name="[^"]*"[^>]*DataType="Epson_Robot_Status"[^>]*>)([\s\S]*?)(<\/Tag>)/g, (m, open, body, close) => {
  const b2 = body.replace(/<!\[CDATA\[\[(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+),\[/, (mm, a, b, c, d, e, f, g, h) => { l5k++; return `<![CDATA[[${a},${b},${d},${e},${f},${g},${h},[`; });
  const b3 = b2.replace(new RegExp('<DataValueMember Name="CurrentProgram"[^>]*\\/>' + NL), () => { dec++; return ''; });
  return open + b3 + close;
});
must(l5k === 2 && dec === 2, `tag data edits: L5K ${l5k}, Decorated ${dec} (expected 2 and 2)`);
must(countOf(x, /CurrentProgram/g) === 0, 'CurrentProgram still referenced');

// ---- 2. "In Auto Confirm" operand comment
const cmtRe = new RegExp('<Comment Operand="\\.USEROUT\\[0\\]\\.5">' + NL + '<!\\[CDATA\\[In Auto Confirm\\]\\]>' + NL + '<\\/Comment>' + NL);
must(countOf(x, new RegExp(cmtRe.source, 'g')) === 1, 'USEROUT[0].5 comment count != 1');
x = x.replace(cmtRe, '');
must(!/USEROUT\[0\]\.5/.test(x), 'USEROUT[0].5 still present');

fs.writeFileSync(OUT, x);
console.log(`wrote ${OUT}: CurrentProgram removed (UDT + ${l5k} L5K + ${dec} Decorated), In Auto Confirm comment removed`);
