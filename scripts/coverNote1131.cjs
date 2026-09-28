#!/usr/bin/env node
'use strict';
// coverNote1131.cjs — merge the 1131 cover-note skeleton with the station blocks and asks; prints the page/word count after html2docx.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const G = path.join(ROOT, 'generated/1131');
const ver = process.argv[2] || 'v0.1';
let html = fs.readFileSync(path.join(G, 'CoverNote_v0.1.html'), 'utf8');
const blocks = fs.readFileSync(path.join(G, '_station_blocks.html'), 'utf8');
const asks = [
  ['1', 'Export the infeed-side assembly PDFs (1131-D/G/J/K-000, CB-000 carriage, CD-000 cup array) - the infeed devices were taken from John\'s code, not from drawings', 'ME Mike Gast (B. Mack / J. Peoples)'],
  ['2', 'Cart shuttle: gripper #1/#2 roles and handoff, one-way stops, stop count (sheet 3 vs code 5), exit-tunnel cart blocking the next pull', 'ME Mike Gast / John Stanko'],
  ['3', 'Sampling rule confirmed as built: first tile after a thickness (recipe) change, then every Recipe.DintB (30) tiles; infeed pause Recipe.DintC (4500 ms); out-of-spec sample holds the infeed until retrieved', 'ME Mike Gast'],
  ['4', 'Motors per axis: code VPL-B1303F / B1306F / B1003T / B1153E / B0752M vs BOM MPL rows and VPL-B0632T for the camera axis (build keeps John\'s strings); travels and soft limits for a01/a02/a04', 'EE + ME; Jason updates the motion database'],
  ['5', 'Timesavers grinder link: MSG paths and data (grinder ready, dust collector ready, speed Hz, thickness offset); nothing crosses today (D008)', 'John Stanko -> Jason Perry; customer via Mike Gast'],
  ['6', 'Safety hygiene in the verbatim programs (D007): LCBypass = 1, unconditional mute enable, Local:2:I.Pt05 double use, Safety_Debug_Infeed branch, unloader STO not door-gated, operator bypass energizes VFD safety outputs', 'Jason Perry + EE (risk assessment)'],
  ['7', 'I/O sheet vs code: loader tab card types and 1-/0-based bits, gripper-closed reeds unwired, vb03 gripper / middle-stop bit swaps, air pressure vs surge point (io01:4:I.3), door-closed polarity, stack-light Reset/Start order per side', 'EE'],
  ['8', 'Pick on the fly by MAG gearing in S07 - accept as SDC form (ratio HMI, ungear by MAS Gear, permissive gates the MAG like a MAM)', 'CE Jason Perry'],
  ['9', 'One Supervisor / Alarms / HMI for two operator stations; PanelView popup handshake kept for the Ignition Perspective HMI or dropped', 'CE Jason Perry'],
  ['10', 'Gauge: analog channels in mm, recipe bands per thickness, one out-of-process tile stops the machine or three in a row (built: three)', 'EE / ME / Jason Perry'],
  ['11', 'Production: shifts 07:30 / 15:30 / 23:30, 480 min planned, ideal cycle 3.0 s; what counts as paused', 'ME Mike Gast (customer)'],
];
html = html.replace('__STATION_BLOCKS__', blocks)
  .replace('__ASKS__', asks.map(([n, a, w]) => `<tr><td>${n}</td><td>${a}</td><td>${w}</td></tr>`).join('\n'))
  .replace('__MACHINE_LOGIC__', '7 &mdash; every program in SDC standard form on John Stanko\'s import-proven hardware layer; import simulation passes; the machine sequence is John\'s commissioned behaviour restated, with the transcript\'s sampling rule; nothing has run on the hardware yet.')
  .replace(/v0\.1(?= &ndash; Sep 29 2026)/, ver).replace(/PLC program v0\.1<\/title>/, `PLC program ${ver}</title>`);
const out = path.join(G, `1131_TarkettTileGrinder_CoverNote_${ver}.html`);
fs.writeFileSync(out, html, 'utf8');
console.log('wrote', path.relative(ROOT, out), html.length, 'bytes; placeholders left:', (html.match(/__[A-Z_]+__/g) || []).length);
