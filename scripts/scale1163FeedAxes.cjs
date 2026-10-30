#!/usr/bin/env node
'use strict';
/**
 * scale1163FeedAxes.cjs — 1163 v0.4.5 (Jason, 2026-10-30): the L2S01 feed axes carry a 10:1 gearbox that 1117 did not have.
 *
 *   node scripts/scale1163FeedAxes.cjs [--src <L5X>] [--out <L5X>]
 *
 *   a02_L2S01FeedUpstream / a03_L2S01FeedDownstream: TransmissionRatioInput 20 -> 200 (output stays 15, belt 50.927 mm), so
 *   one motor rev = 12.0 mm of tube instead of 120 mm. The derived limits Studio computed on the 0.4.4 import are scaled by 1/10:
 *   MaximumSpeed, MaximumAcceleration / Deceleration, their jerks, AccelerationLimit / DecelerationLimit.
 *   Applied to Jason's 0.4.4 export (the delivery lineage); everything else untouched.
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/_history/1163_Haemonetics_v0.4.4_returned_2026-10-30.L5X');
const OUT = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
let x = fs.readFileSync(SRC, 'utf8');
const log = [];
const SCALED = ['MaximumSpeed', 'MaximumAcceleration', 'MaximumDeceleration', 'MaximumAccelerationJerk', 'MaximumDecelerationJerk', 'AccelerationLimit', 'DecelerationLimit'];
for (const axis of ['a02_L2S01FeedUpstream', 'a03_L2S01FeedDownstream']) {
  const re = new RegExp('<Tag Name="' + axis + '"[\\s\\S]*?</Tag>');
  const m = re.exec(x) || fail('axis tag ' + axis);
  let t = m[0];
  must(/ TransmissionRatioInput="20"/.test(t) && / TransmissionRatioOutput="15"/.test(t) && / ActuatorDiameter="50.927"/.test(t), axis + ' carries the 1117 belt scaling (20:15, 50.927 mm)');
  t = t.replace(' TransmissionRatioInput="20"', ' TransmissionRatioInput="200"');
  const changed = [];
  for (const k of SCALED) {
    const r = new RegExp(' ' + k + '="([^"]*)"');
    const mm = r.exec(t) || fail(axis + ' attribute ' + k);
    const v = Number(mm[1]) / 10;
    must(Number.isFinite(v) && v > 0, axis + ' ' + k + ' value ' + mm[1]);
    t = t.replace(r, ' ' + k + '="' + String(Number(v.toPrecision(8))) + '"');
    changed.push(k + ' ' + mm[1] + ' -> ' + String(Number(v.toPrecision(8))));
  }
  x = x.slice(0, m.index) + t + x.slice(m.index + m[0].length);
  log.push(axis + ': TransmissionRatioInput 200 (10:1 gearbox x 20:15 belt); ' + changed.join(', '));
}
const d = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + d.toDateString().replace(/ \d{4}$/, '') + ' ' + d.toTimeString().slice(0, 8) + ' ' + d.getFullYear() + '"');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, x);
console.log('wrote ' + OUT);
for (const l of log) console.log('  - ' + l);
