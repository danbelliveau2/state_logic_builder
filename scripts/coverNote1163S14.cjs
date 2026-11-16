'use strict';
// coverNote1163S14.cjs — cover-note fragments, intake and the document for 1163 v0.17 (L2S14 Clear Tube Coiler).
//   node scripts/coverNote1163S14.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.17', SHORT = 'Nov 16';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const rep = (s, a, b, what) => { must(s.split(a).length === 2, 'anchor not found once: ' + what); return s.replace(a, () => b); };
const NEW = 'L2_S14_ClearTubeCoiler';

const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8'), f = fs.readFileSync(frontF, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
const l5x = fs.readFileSync(D + '/' + M + '.L5X', 'utf8');
must(l5x.includes('<Program Name="' + NEW + '"') && l5x.includes('<Module Name="sd20_L2S14Horizontal"'), 'delivered file carries L2S14');
const PCS = l5x.split('<ParameterConnection ').length - 1;
const addRow = (label, text) => { const re = new RegExp('(<tr><td>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</td><td>[a-z]*</td><td>)([\\s\\S]*?)(</td></tr>)'); must(re.test(h), 'input row ' + label); h = h.replace(re, (m, a, body, c) => a + body + ' ' + text + c); };
const addCell = (doc, label, text) => { const re = new RegExp('(<tr><td class="k"><b>' + label + '</b></td><td>)([\\s\\S]*?)(</td></tr>)'); must(re.test(doc), 'machine row ' + label); return doc.replace(re, (m, a, body, c) => a + body + ' ' + text + c); };

// ── head ──
if (!h.includes('<tr><td>0.17</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.17</td><td>' + SHORT + '</td><td><b>L2S14 (EL) Clear Tube Coiler</b>: L2S10 on its own devices. <code>L2_S14_ClearTubeCoiler</code> is the stamped <code>L2_S10_BlueTubeCoiler</code> (Jason&rsquo;s lineage) cloned by script with StaNum 14 / StaNumPre 13, FailureType 141 and the &ldquo;L2S14 Tube Coil: &rdquo; prefix, proved identical to L2S10 in every other byte. Drives <code>sd16</code>&ndash;<code>sd20</code> (.35&ndash;.39) and axes <code>a16</code>&ndash;<code>a20</code> are the sd10&ndash;sd14 / a10&ndash;a14 twins (single phase, same motors and scaling, own AxisIDs) and connect to the five InOut parameters. The fourteen pneumatic parameters (spike and coil grippers, nest openers, nest-opener retracted sensors) are declared and <b>not connected</b>: the valve bank is not defined. Positions extrapolated from the tube length (13.5&Prime; clear vs 29&Prime; blue): place 50.0 and the 10 mm pre-tension stay, pick 765.5 &rarr; 383.1, coil travel 343.1 mm = 1.46 turns at &Oslash; 75. Indexer stations-complete / actuators-safe / pause take the program (reason 14), StationCompleteTimes[14]; Supervisor polls it, EIP nodes 35&ndash;39 (Alarm[37]&ndash;[41], array 42); Alarms roll-up; <code>g_L2StationList[14]</code>; ' + PCS + ' parameter connections. The 39 other programs and the L2S10 hardware are byte-identical to 0.16. Built by <code>scripts/build1163S14.cjs</code>; shape checker 0, import simulation PASS, regression pass.</td><td>Jason, Nov 16: &ldquo;L2S14 performs the exact same function as L2S10. All that changes is device addressing. Define the required input / output parameters for the station, but do not make the connections, as that valve bank has yet to be defined. The station coils the clear tube. The tube is 13.5&Prime; compared to 29&Prime;, so extrapolate the positions from that info.&rdquo; Updated Master Electrical (Nov 16).</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>0.17</td>'), 'head row 0.17');
  addRow('1 Walkthrough transcript', 'L2S14: none; Jason&rsquo;s instruction (Nov 16) and the EJ walkthrough through the L2S10 program.');
  addRow('3 Station description sheet', 'EL rows 132&ndash;136 (budget-era): two rotary theta heads with grippers and push-off, head openers, load verify, &ldquo;coiled 2 revolutions, placed on top of the blue coil&rdquo;.');
  addRow('4 Controls BOM', 'L2S14 (Nov 16 workbook, 1163-EL): five 2198-C1004-ERS (1602DR / 1642DR, 1702DR / 1742DR, 1802DR), TLP-A070-040-DJA32A rotary / horizontal, DJA34A brake vertical; no sensors or valves for S14.');
  addRow('5 I/O list', 'L2S14: none; VB8 (.94) is the transfer conveyor&rsquo;s bank. The pneumatic parameters are declared unconnected.');
  addRow('6 Pneumatic drawings', 'L2S14: none (valve bank not defined).');
  addRow('8 Example per station', 'S14: the delivered L2S10 program (Jason&rsquo;s lineage, v0.16).');
  addRow('9 Ethernet device list', 'IP tab Nov 16: L2S14 Rotary Left / Right, Vertical Left / Right, Horizontal = devices 22&ndash;26 at .35&ndash;.39 (a16&ndash;a20); device 21 L2S11 Horizontal .34 (a15, reserved); Transfer Conveyor .40, VB8 .94.');
  h = rep(h, 'L2_S13_Dispenser</b>, Production', 'L2_S13_Dispenser, ' + NEW + '</b>, Production', 'head controller programs');
  h = rep(h, '<b>rob08_L2S13Robot</b> .75 (the rob03 form) on VB6;', '<b>rob08_L2S13Robot</b> .75 (the rob03 form) on VB6; <b>L2S14</b>: <b>sd16_L2S14RotaryUpstream</b> .35, <b>sd17_L2S14RotaryDownstream</b> .36, <b>sd18_L2S14VerticalUpstream</b> .37, <b>sd19_L2S14VerticalDownstream</b> .38, <b>sd20_L2S14Horizontal</b> .39 (the sd10&ndash;sd14 drives cloned, single phase); no valve bank yet;', 'head hardware');
  h = addCell(h, 'Axes', '<b>L2S14</b>: <code>a16_L2S14RotaryUpstream</code> / <code>a17_L2S14RotaryDownstream</code> (10:1, deg, unlimited), <code>a18_L2S14VerticalUpstream</code> / <code>a19_L2S14VerticalDownstream</code> (10 mm screw, brake), <code>a20_L2S14Horizontal</code> (20 mm screw) on sd16&ndash;sd20: the a10&ndash;a14 axes cloned with their motor data and scaling, own AxisIDs.');
  h = addCell(h, 'Platform', '<b>L2S14 (EL)</b> is the same gantry once more for the 13.5&Prime; clear tube: two heads on a shared X axis coil the tube from each nest and lay the coil on top of the blue coil.');
  h = addCell(h, 'Modes', 'Clear tube coil (S14): the L2S10 cycle unchanged on the S14 devices.');
  h = addCell(h, 'Logic', 'S14: 6 &ndash; L2S10&rsquo;s form byte for byte; the extrapolated pick position, the coil diameter and pitch for the clear tube and the unconnected pneumatics are in the Asks.');
}

// ── back ──
if (!b.includes('<tr><td>58</td>')) {
  b = addCell(b, 'L2_Tracking', 'L2S14 writes Station[14] on both nest sides like L2S10 (Attempt at 7, Success at 43, Lockout at the index, FailureType 141 on a tube released by a restart) and gates on Station[13].');
  b = rep(b, 'L2_S10_BlueTubeCoiler and the four L2S04 programs', 'L2_S10_BlueTubeCoiler, L2_S14_ClearTubeCoiler and the four L2S04 programs', 'back alarms');
  b = rep(b, '= &ldquo;L2S1n Y Site Insert: &rdquo;.</td></tr>', '= &ldquo;L2S1n Y Site Insert: &rdquo;; <code>[14]</code> = &ldquo;L2S14 Tube Coil: &rdquo;.</td></tr>', 'back station list');
  b = rep(b, '334 parameter connections', PCS + ' parameter connections', 'back pcs');
  b = rep(b, 'Polls thirty-three state machines', 'Polls thirty-four state machines', 'back supervisor polls');
  b = rep(b, 'EIP monitor counts 35 nodes,', 'EIP monitor counts 40 nodes, Alarm[37]&ndash;[41] = the five L2S14 drives (nodes 35&ndash;39), the array grown to 42;', 'back supervisor nodes');
  const asks = [
    ['56', 'L2S14 positions are extrapolated from the tube length: place 50.0 (from the homing block) and the 10 mm pre-tension stay, pick = 50 + 715.5 &times; 13.5 / 29 = 383.1, so the coil travel is 343.1 mm = 1.46 turns at the L2S10 coil diameter 75 mm and pitch 4.2 mm. The binder says the clear tube coils 2 revolutions on top of the blue coil, which at this length means a midline of about 54.6 mm. Set <code>HMI_XAxis</code> pick, <code>HMI_CoilDiameter</code> and <code>HMI_CoilPitch</code> (the clear tube&rsquo;s OD) for the real coil; Z pick / place / coil start / retract are 0 as on L2S10.', 'Jason / Vipin'],
    ['57', 'The S14 valve bank is not defined, so the fourteen pneumatic parameters (<code>q_Close / OpenSpikeGripper</code>, <code>q_Close / OpenCoilGripper</code>, <code>q_Extend / RetractNestOpener</code> per side, <code>i_NestOpenerUpstream / DownstreamRetracted</code>) are declared and not connected. Until they are wired the nest-opener retracted inputs read 0 and initialization waits at Close Nests (state 106, 5 s alarm). Give the bank (name, IP, assembly sizes, station order) and the connections follow the L2S10 map.', 'Jason'],
    ['58', 'sd16&ndash;sd20 are sd10&ndash;sd14 cloned (catalog, revision, single phase 240 V, RPI) and a16&ndash;a20 carry the a10&ndash;a14 motor data; the brake motors are written by database name as on L2S10 (ask 20) &ndash; re-select them in Studio and confirm the hardware against the drawings.', 'Jason'],
  ].map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n');
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks + '\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>58</td>'), 'back asks');
  b = rep(b, '<code>scripts/coverNote1163S12.cjs</code>.', '<code>scripts/coverNote1163S12.cjs</code>. <code>AI Inputs\\L2S14\\</code>: <code>1163 Master Electrical.xlsm</code> (Nov 16); <code>plan\\L2S14_readiness_2026-11-16.md</code>, <code>L2S14_plan.json</code>; <code>scripts/build1163S14.cjs</code>, <code>scripts/coverNote1163S14.cjs</code>.', 'back referenced');
}

// ── front ──
if (!f.includes('Clear tube coil')) {
  f = rep(f, '<tr><td class="k">Index</td>', '<tr><td class="k">Clear tube coil</td><td><b>L2S14</b>: the L2S10 cycle on the 13.5&Prime; clear tube &ndash; each head picks the tube from its nest, coils it over a 343 mm X pass (1.46 turns at &Oslash; 75) and lays the coil on top of the blue coil; pneumatics declared, not yet wired.</td></tr>\n<tr><td class="k">Index</td>', 'front clear tube coil');
  f = rep(f, 'and L2S10 (both Z retracted, nests closed)', 'L2S10 and L2S14 (both Z retracted, nests closed)', 'front index');
}

// ── meta ──
meta[NEW] = {
  title: 'L2S14 &ndash; Clear tube coiler, two heads on a shared X axis (L2S10 on its own devices)',
  does: 'Picks the 13.5&Prime; clear tube from each nest, forms the coil around the 3-jaw gripper while the X axis carries the head to place, and lays the coil on top of the blue coil. One program: the X axis is shared, the Upstream head works nest A and the Downstream head nest B; a side with no part or locked out stays retracted and the other coils alone. The L2S10 program byte for byte on the S14 devices.',
  devices: 'X Axis &ndash; TLP-A070-040-DJA32A on 2198-C1004-ERS (sd20, .39), 20 mm screw, shared gantry &middot; Z Axis Upstream / Downstream &ndash; TLP-A070-040-DJA34A brake motor on sd18 / sd19 (.37 / .38), 10 mm screw &middot; R Axis Upstream / Downstream (rotary coiling head) &ndash; TLP-A070-040-DJA32A on sd16 / sd17 (.35 / .36), 10:1 gearbox, degrees &middot; Spike Gripper Upstream / Downstream, Coil Gripper Upstream / Downstream, Nest Opener Upstream / Downstream (retracted sensor) &ndash; parameters declared, valve bank not defined, nothing connected',
  notes: 'StaNum 14, StaNumPre 13; nest A (Upstream) and nest B (Downstream) tracked per side as L2S10; Attempt at state 7, Success at 43 (spike gripper opened at place), Lockout on a locked-out side at the index, Failure 141 on a tube released by a restart. Positions extrapolated from the tube length: X pick 383.1 (= 50 + 715.5 &times; 13.5 / 29), place 50.0, pre-tension 10 mm, coil start 393.1, coil travel 343.1 mm = 1.46 turns at HMI_CoilDiameter 75 and HMI_CoilPitch 4.2 (the L2S10 seeds; the binder says 2 revolutions). Cams, initialization, q_ActuatorsSafe, fault times and alarms as L2S10. The nest-opener retracted inputs read 0 until the valve bank is wired, so initialization waits at Close Nests.',
  extra: { Form: 'L2_S10_BlueTubeCoiler (Jason&rsquo;s lineage, v0.16) cloned by scripts/build1163S14.cjs', Logic: '6 &ndash; L2S10&rsquo;s form; pick position, coil diameter / pitch and the unconnected pneumatics are assumptions', Referenced: 'NAMES_CONTRACT_L2S01_EA.md (L2S14 section), L2S14_readiness_2026-11-16.md, L2S14_plan.json', Ask: '56, 57, 58' },
};
if (meta.Supervisor) meta.Supervisor.does = 'Template form. Polls both indexers and the thirty-two station programs for auto, stopped and start-OK; horn override from either indexer&rsquo;s pause restart; forty EIP nodes monitored (L2 and L1 indexer drives; L2S01 and L2S02 each two feed drives, four payout VFDs, valve bank, micrometer; four S04 drives; five S10 drives, VB6; the four L2S6&ndash;L2S9 robots and VB5; the L2S12 / L2S13 robots; five S14 drives).';
if (meta.L2_S00_IndexerNoSP) meta.L2_S00_IndexerNoSP.notes = meta.L2_S00_IndexerNoSP.notes + ' L2S14: in the stations-complete, actuators-safe and pause rungs (reason 14), StationCompleteTimes[14].';

// ── intake ──
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
cfg.programs = '^(L[12]_S00_|L2_S0[12469]_|L2_S1[0234]_|Supervisor$)'; cfg.shapeLintPrograms = '^(L2_S(01|02|04|06|07|08|09|10|12|13|14)_|L1_S00_|L1_Tracking$)';
cfg.title = '1163 Haemonetics - L1 Indexer and Tracking, L2 Indexer, L2S01 (EA) Blue Tube Load, L2S02 Clear Tube Load, L2S04 (EC) Spike and Cap Load, L2S6-L2S9 (EE / EH) Tube Insert, L2S10 (EJ) Blue Tube Coiler, L2S12 / L2S13 Y Site Insert, L2S14 (EL) Clear Tube Coiler';
if (DRY) { console.log('--dry: fragments computed, nothing written (' + PCS + ' parameter connections)'); process.exit(0); }
fs.writeFileSync(headF, h); fs.writeFileSync(backF, b); fs.writeFileSync(frontF, f); fs.writeFileSync(metaF, JSON.stringify(meta, null, 2));
fs.writeFileSync(cfgF, JSON.stringify(cfg, null, 2) + '\n');
console.log('fragments, meta, intake updated');

// ── document ──
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const html = OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.html';
const s = run(['scripts/sequenceOfOperation.cjs', D + '/' + M + '.L5X', '--out', html, '--head', headF, '--meta', metaF, '--front', frontF, '--back', backF, '--foot', 'If a device or step is wrong, fix the code, not this sheet.', '--programs', cfg.programs, '--title', cfg.title, '--subtitle', 'Cover note and sequence of operation - v' + VERSION]);
console.log(s.out.trim().split('\n').slice(-3).join('\n')); must(s.code === 0, 'sequenceOfOperation');
const docx = D + '/' + M + '_CoverNote.docx';
const w = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (B + '/w8_convert.ps1').replace(/\//g, '\\'), '-Html', html.replace(/\//g, '\\'), '-Docx', docx.replace(/\//g, '\\'), '-Pdf', (OUT + '/' + JOB + '_CoverNote_v' + VERSION + '.pdf').replace(/\//g, '\\')], { encoding: 'utf8' });
const wout = (w.stdout || '') + (w.stderr || '');
console.log(wout.trim().split('\n').slice(-2).join('\n'));
must(/saved /.test(wout), 'cover note conversion failed (is Word open?)');
fs.copyFileSync(docx, H + '/' + M + '_CoverNote_v' + VERSION + '_' + ISO + '.docx');
console.log('cover note stamped _v' + VERSION + '_' + ISO);
