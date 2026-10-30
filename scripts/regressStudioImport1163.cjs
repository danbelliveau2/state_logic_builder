#!/usr/bin/env node
'use strict';
/**
 * regressStudioImport1163.cjs — Jason's Studio 5000 import of 1163 v0.3 (2026-10-30) as a permanent fixture.
 *
 *   Studio said:  Error   "Failed to set the 'AxisID' property (Duplicate Axis ID has been found)"  (a03_L2S01FeedDownstream)
 *                 Warning "The data for 'vb01_MainAssembly:I' will not be imported (Format of data element inside an array
 *                          is invalid. Use 'Element' formatting.)"  (and :O, and mm01_L2S01Micrometer:I)
 *   The import simulator passed that file. It must now FAIL on v0.3 with both classes and stay clean on v0.3.1.
 *
 *   Fixtures (share): Deliveries\1163\_history\1163_Haemonetics_v0.3_2026-10-30.L5X (bad), _v0.3.1_ (good).
 *   Run: node scripts/regressStudioImport1163.cjs   (exit 0 = pass)
 */
const fs = require('fs');
const path = require('path');
const { simulateImport } = require(path.join(__dirname, '..', 'src', 'lib', 'agentGenerator', 'importSimValidator.js'));
const H = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/_history/';
const BAD = H + '1163_Haemonetics_v0.3_2026-10-30.L5X', GOOD = H + '1163_Haemonetics_v0.3.1_2026-10-30.L5X';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
for (const f of [BAD, GOOD]) if (!fs.existsSync(f)) { console.error('fixture missing: ' + f); process.exit(2); }

const bad = simulateImport(fs.readFileSync(BAD, 'utf8'));
const dupAxis = bad.errors.filter((e) => /Duplicate Axis ID/.test(e));
const arrWarn = bad.warnings.filter((w) => /Use 'Element' formatting/.test(w));
check(dupAxis.length === 1 && /a03_L2S01FeedDownstream/.test(dupAxis[0]), 'v0.3: duplicate AxisID on a03_L2S01FeedDownstream is an error (' + dupAxis.length + ')');
check(arrWarn.length === 3 && arrWarn.filter((w) => /vb01_MainAssembly/.test(w)).length === 2 && arrWarn.filter((w) => /mm01_L2S01Micrometer/.test(w)).length === 1, 'v0.3: vb01 :I/:O and mm01 :I array data warned (' + arrWarn.length + ')');

const good = simulateImport(fs.readFileSync(GOOD, 'utf8'));
check(!good.errors.some((e) => /Duplicate Axis ID/.test(e)), 'v0.3.1: no duplicate AxisID');
check(!good.warnings.some((w) => /Use 'Element' formatting/.test(w)), 'v0.3.1: connection data arrays sized');
check(good.ok, 'v0.3.1: import simulation PASS (' + good.errors.length + ' errors)');
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
