'use strict';
// coverNote1163S2.cjs — cover-note fragments, contract, plan, station examples and intake for 1163 v0.11 (L2S02), then the document.
//   node scripts/coverNote1163S2.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.11', SHORT = 'Nov 12';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const rep = (s, a, b, what) => { must(s.split(a).length === 2, 'anchor not found once: ' + what); return s.replace(a, () => b); };
const TU = 'L2_S02_TubeFeedUpstream', TD = 'L2_S02_TubeFeedDownstream', DU = 'L2_S02_DereelerUpstream', DD = 'L2_S02_DereelerDownstream';
const S1 = (n) => n.replace('L2_S02_', 'L2_S01_');

const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8'), f = fs.readFileSync(frontF, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
const l5x = fs.readFileSync(D + '/' + M + '.L5X', 'utf8');
must(l5x.includes('<Program Name="' + TU + '"'), 'delivered file carries L2S02');
const PCS = l5x.split('<ParameterConnection ').length - 1;

// ── head ──
if (!h.includes('<tr><td>0.11</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.11</td><td>' + SHORT + '</td><td><b>L2S02 Clear Tube Load</b> (13.5&Prime; clear tube): the four L2S01 programs cloned to <code>' + TU + '</code> / <code>Downstream</code> and <code>' + DU + '</code> / <code>Downstream</code>, StaNum 2, <code>HMI_TubeLength</code> 342.9 mm, every other value as L2S01. Hardware cloned from its L2S01 twin by the IP tab: <code>sd04_L2S02FeedUpstream</code> / <code>sd05_L2S02FeedDownstream</code> (.23 / .24) with axes a04 / a05, payout VFDs fd05&ndash;fd08 (.54&ndash;.57), <code>mm02_L2S02Micrometer</code> (.81), <code>vb02_MainAssembly</code> (.91, in 50 / out 50), encoders on HSC2 (<code>Local:7</code>). Supervisor polls and eight EIP-loss alarms (21&ndash;28, array 30, 28 nodes); Alarms roll-up; MapInputs / MapOutputs; <code>g_L2StationList[2]</code>; 64 parameter connections. The 16 other programs and the L2S01 hardware are byte-identical to 0.10.1. L2S01 is the 29&Prime; <b>blue</b> tube (earlier notes said clear). Built by <code>scripts/build1163S2.cjs</code>; shape checker 0, import simulation PASS, regression pass.</td><td>Jason, Nov 11: &ldquo;L2S2 is exactly the same as L2S1. The devices controlling the station are what changes per the BOM and IP address list.&rdquo; Base 0.10.1; VB2 stations 1&ndash;10 in the VB1 order; VB2 50 / 50; &ldquo;L2S1 is the 29&Prime; blue tube. L2S2 is the 13&Prime; clear tube&rdquo; then &ldquo;13.5&Prime;&rdquo;; mm02 outputs as mm01.</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>0.11</td>'), 'head row 0.11');
  h = rep(h, '<b>L2S01 (EA) Long Clear Tube Load.</b>', '<b>L2S01 (EA) Blue Tube Load.</b>', 'head 0.3 station name');
  h = rep(h, '(VB1 IN n CHn, IO-Link CH0&ndash;3, PLC MOD 6 CH0/CH1).', '(VB1 IN n CHn, IO-Link CH0&ndash;3, PLC MOD 6 CH0/CH1). L2S02 (Nov 11 workbook): the same parts on VB2 IN 1 CH0 &ndash; IN 3 CH1, IO-Link CH0&ndash;3, PLC MOD 7 CH0/CH1.', 'head input 4');
  h = rep(h, 'VB1 unit sizes and order from Jason (Oct 30).', 'VB1 unit sizes and order from Jason (Oct 30). L2S02: no I/O-list rows given; valve stations 1&ndash;10 in the VB1 order and VB2 50 / 50 from Jason (Nov 11).', 'head input 5');
  h = rep(h, 'VB1 manifold layout (SMC); no circuit drawing.', 'VB1 manifold layout (SMC); no circuit drawing. VB2 manifold layout (Nov 2: 5x DXPC, LAB1, DYPE, 14 stations).', 'head input 6');
  h = rep(h, '<b>L2S01 (EA)</b>, a two-lane tube feeder with no nest.', '<b>L2S01 (EA)</b>, a two-lane feeder for the 29&Prime; blue tube with no nest.', 'head platform S01');
  h = rep(h, 'for the L2S01 pick and place (not designed yet). ', 'for the L2S01 pick and place (not designed yet). <b>L2S02</b> is the same two-lane feeder for the 13.5&Prime; clear tube on its own drives, valve bank, micrometer and encoder card. ', 'head platform S02');
  h = rep(h, 'L2_S01_DereelerDownstream, L2_S10_BlueTubeCoiler,', 'L2_S01_DereelerDownstream, ' + [TU, DU, TD, DD].join(', ') + ', L2_S10_BlueTubeCoiler,', 'head controller programs');
  h = rep(h, '(generic DINT, in 312 / out 124, instances 100 / 101); <b>sd21_L1Indexer</b>', '(generic DINT, in 312 / out 124, instances 100 / 101); <b>L2S02</b>, each cloned from its L2S01 twin: <b>sd04_L2S02FeedUpstream</b> .23, <b>sd05_L2S02FeedDownstream</b> .24, <b>fd05</b>&ndash;<b>fd08</b> (.54&ndash;.57), <b>vb02_MainAssembly</b> .91 (in 50 / out 50), <b>mm02_L2S02Micrometer</b> .81; <b>sd21_L1Indexer</b>', 'head hardware');
  h = rep(h, 'on HSC1 (slot 6, addressed <code>Local:6</code>) CH0 / CH1.', 'on HSC1 (slot 6, addressed <code>Local:6</code>) CH0 / CH1. <b>L2S02</b>: <code>a04_L2S02FeedUpstream</code>, <code>a05_L2S02FeedDownstream</code> on sd04 / sd05, the a02 / a03 axes cloned (same motor, scaling and limits, own AxisID); encoder wheels on HSC2 (<code>Local:7</code>) CH0 / CH1.', 'head axes');
  h = rep(h, '(a04&ndash;a09 reserved for L2S2 / L2S4)', '(a15&ndash;a20 reserved for L2S11 / L2S14)', 'head reserved axes');
  h = rep(h, '(736.6 mm = 29&Prime;)', '(736.6 mm = 29&Prime; on L2S01, 342.9 mm = 13.5&Prime; on L2S02)', 'head modes length');
}

// ── back ──
if (!b.includes('<tr><td>45</td>')) {
  b = rep(b, 'L2S01 reads Station[1].OpStatus (LockoutA, DryRunA, SingleStepA) and writes nothing &ndash; a feeder has no nest.', 'L2S01 and L2S02 read Station[1] / Station[2].OpStatus (LockoutA, DryRunA, SingleStepA) and write nothing &ndash; a feeder has no nest.', 'back tracking');
  b = rep(b, 'the four L2S01 programs L2_S10_BlueTubeCoiler', 'the four L2S01 programs, the four L2S02 programs, L2_S10_BlueTubeCoiler', 'back alarms');
  b = rep(b, 'the prefix on every L2S01 alarm message.', 'the prefix on every L2S01 alarm message; <code>g_L2StationList[2]</code> = &ldquo;L2S02 Tube Load: &rdquo;.', 'back station list');
  b = rep(b, 'CPS of vb01_MainAssembly, vb06_MainAssembly, mm01_L2S01Micrometer and the four PowerFlex 525 drives', 'CPS of vb01_MainAssembly, vb02_MainAssembly, vb06_MainAssembly, mm01_L2S01Micrometer, mm02_L2S02Micrometer and the eight PowerFlex 525 drives', 'back map');
  b = rep(b, '135 parameter connections', PCS + ' parameter connections', 'back pcs');
  b = rep(b, 'Polls eleven state machines', 'Polls fifteen state machines', 'back supervisor polls');
  b = rep(b, 'EIP monitor counts 20 nodes,', 'EIP monitor counts 28 nodes, Alarm[21]&ndash;[28] = the L2S02 devices (two feed drives, four payout VFDs, VB2, micrometer; nodes 20&ndash;27), the array grown to 30;', 'back supervisor nodes');
  const asks = [
    ['45', 'L2S02 values are L2S01&rsquo;s except the tube length (342.9 mm = 13.5&Prime;): prime 100 mm, back-out 300 mm, length tolerance 2 mm, dancer 100 / 300 / 380 mm, payout 30 Hz, diameter and ovality limits open, servo speeds zero. Give the clear-tube values where they differ (asks 4, 5, 6 apply to both stations).', 'Ian / Jason'],
    ['46', 'VB2: 50 / 50 and stations 1&ndash;10 in the VB1 order are Jason&rsquo;s (Nov 11). Inputs from the BOM: IN 1 = byte 0, IO-Link bytes 5&ndash;48 (dancers 7&ndash;14), coils from byte 46. No I/O-list rows or valve tags (EB n) were given for L2S02; the IO-Link byte order is as ask 1.', 'Jason'],
    ['47', 'sd04 / sd05, fd05&ndash;fd08, mm02 and vb02 are the L2S01 modules cloned (catalog, revision, single phase, RPI); a04 / a05 carry the a02 motor data Studio loaded. Confirm against the hardware. <code>StagingEmpty</code> is AlwaysOn on L2S02 as well until its pick and place exists (ask 9).', 'Jason'],
  ].map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n');
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks + '\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>47</td>'), 'back asks');
  b = rep(b, '<code>scripts/build1163S4.cjs</code>, <code>scripts/coverNote1163S4.cjs</code>.', '<code>scripts/build1163S4.cjs</code>, <code>scripts/coverNote1163S4.cjs</code>. <code>AI Inputs\\L2S2\\</code>: <code>1163 Master Electrical.xlsm</code> (Nov 11: BOM, IP Addresses, IO), <code>VB2.pdf</code>; <code>scripts/build1163S2.cjs</code>, <code>scripts/coverNote1163S2.cjs</code>.', 'back referenced');
}

// Jason, Nov 12: the L2S02 I/O was given - inputs in the Master Electrical BOM, valve assignments confirmed. Ask 46 closed.
b = b.replace(/<tr><td>46<\/td>[\s\S]*?<\/tr>/, () => '<tr><td>46</td><td>Closed: the VB2 I/O is defined &ndash; inputs from the Master Electrical BOM I/O assignment (IN 1 CH0 &ndash; IN 3 CH1, IO-Link CH0&ndash;3), valve stations 1&ndash;10 in the VB1 order and 50 / 50 confirmed by Jason (Nov 11).</td><td>&ndash;</td></tr>');
must(b.includes('<tr><td>46</td><td>Closed:'), 'ask 46 closed');
h = h.split('L2S02: no I/O-list rows given; valve stations 1&ndash;10 in the VB1 order and VB2 50 / 50 from Jason (Nov 11).').join('L2S02: inputs from the Master Electrical BOM I/O assignment; valve stations 1&ndash;10 in the VB1 order and VB2 50 / 50 confirmed by Jason (Nov 11).');
must(!h.includes('no I/O-list rows given'), 'head input 5 corrected');
if (meta[TU]) { meta[TU].extra.Ask = '45, 47'; meta[DU].extra.Ask = '45'; }

// ── front ──
if (!f.includes('L2S02')) {
  f = rep(f, 'Within a lane the two spools', '<b>L2S02</b> is the same pair of feeders for the 13.5&Prime; clear tube (L2S01 feeds the 29&Prime; blue tube). Within a lane the two spools', 'front lanes');
  f = rep(f, 'L2S01 has no nest and does not gate the index;', 'L2S01 and L2S02 have no nest and do not gate the index;', 'front index');
}

// ── meta ──
const sw = (s, pairs) => pairs.reduce((t, [a, c]) => { must(t.includes(a), 'meta anchor: ' + a); return t.split(a).join(c); }, s);
meta[S1(TU)].does = meta[S1(TU)].does.replace('length of clear tube', 'length of blue tube');
if (!meta[TU]) {
  const s = meta[S1(TU)];
  meta[TU] = {
    title: 'L2S02 Upstream &ndash; Tube feed, cut and measure',
    does: sw(s.does, [['29&Prime; length of blue tube', '13.5&Prime; length of clear tube']]),
    devices: sw(s.devices, [['valve EA1', 'VB2 station 1'], ['valve EA3', 'VB2 station 3'], ['valve EA5', 'VB2 station 5'], ['valves EA7 / EA8', 'VB2 stations 7 / 8'], ['(sd02)', '(sd04)'], ['HSC1 (Local:6)', 'HSC2 (Local:7)'], ['mm01_L2S01Micrometer', 'mm02_L2S02Micrometer']]),
    notes: sw(s.notes, [['StaNum 1,', 'StaNum 2,'], ['Station[1]', 'Station[2]'], ['HMI_TubeLength 736.6 mm', 'HMI_TubeLength 342.9 mm']]),
    extra: { Form: 'L2_S01_TubeFeedUpstream cloned by script, devices re-pointed', Deviation: s.extra.Deviation, Logic: '7 &ndash; the L2S01 logic unchanged; values other than the tube length copied', Referenced: 'NAMES_CONTRACT_L2S01_EA.md (L2S02 section), L2S02_plan.json', Ask: '45, 46, 47' },
  };
  const d = meta[S1(DU)];
  meta[DU] = {
    title: 'L2S02 Upstream &ndash; Dereeler, spools A and B',
    does: d.does,
    devices: sw(d.devices, [['(fd01 / fd02)', '(fd05 / fd06)'], ['IO-Link on VB1 ports 1 / 2', 'IO-Link on VB2 ports 1 / 2 (bytes 7&ndash;10)']]),
    notes: d.notes,
    extra: { Form: 'L2_S01_DereelerUpstream cloned by script, devices re-pointed', Deviation: d.extra.Deviation, Logic: '7 &ndash; dancer direction and distances assumed', Ask: '45, 46' },
  };
  meta[TD] = { title: 'L2S02 Downstream &ndash; Tube feed, cut and measure', does: 'Twin of ' + TU + ': VB2 stations 2 / 4 / 6 / 9 / 10, VB2 inputs IN2 / IN3, feed axis on sd05, encoder HSC2 (Local:7) CH1, micrometers mm02_L2S02Micrometer_IN.Data[27] / [28] (OUT3 / OUT4).', extra: { Form: 'L2_S01_TubeFeedDownstream cloned by script', Logic: '7' } };
  meta[DD] = { title: 'L2S02 Downstream &ndash; Dereeler, spools A and B', does: 'Twin of ' + DU + ': payout motors on fd07 / fd08, dancers on VB2 IO-Link ports 3 / 4 (bytes 11&ndash;14).', extra: { Form: 'L2_S01_DereelerDownstream cloned by script', Logic: '7' } };
}
if (meta.Supervisor) meta.Supervisor.does = 'Template form. Polls both indexers and the thirteen station programs for auto, stopped and start-OK; horn override from either indexer&rsquo;s pause restart; twenty-eight EIP nodes monitored (L2 and L1 indexer drives; L2S01 and L2S02 each two feed drives, four payout VFDs, valve bank, micrometer; four S04 drives; five S10 drives, VB6).';

// ── contract, plan, examples, intake ──
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (!c.includes('## L2S02 Clear Tube Load')) c = c.trimEnd() + '\n\n## L2S02 Clear Tube Load (0.11, Jason 2026-11-11)\nL2S01 on its own devices; programs cloned by `scripts/build1163S2.cjs`, parameters and handshakes as L2S01. Tubes: L2S01 = 29 in blue, L2S02 = 13.5 in clear.\n| Item | Name |\n|---|---|\n| Programs | `' + [TU, DU, TD, DD].join('`, `') + '` |\n| StaNum | 2 (reads `\\L2_Tracking.p_Data.Station[2].OpStatus`), no nest tracking; `g_L2StationList[2]` = "L2S02 Tube Load: " |\n| Drives / axes | `sd04_L2S02FeedUpstream` .23, `sd05_L2S02FeedDownstream` .24 (2198-C1004-ERS single phase); `a04_L2S02FeedUpstream`, `a05_L2S02FeedDownstream` = a02 / a03 cloned |\n| VFDs | `fd05_L2S02PayoutUpstreamA` .54, `fd06_L2S02PayoutUpstreamB` .55, `fd07_L2S02PayoutDownstreamA` .56, `fd08_L2S02PayoutDownstreamB` .57 |\n| Valve bank | `vb02_MainAssembly` .91 (EX600-SEN7: 5x DXPC, LAB1, DYPE, 14 valve stations; generic SINT in 50 / out 50, instances 100 / 150) |\n| Micrometer | `mm02_L2S02Micrometer` .81; Data[25] / [26] Upstream X / Y, [27] / [28] Downstream X / Y |\n| Encoders | HSC2 slot 7: `Local:7:I.PresentValue[0]` Upstream, `[1]` Downstream; reset `Local:7:O.ResetCounter.0 / .1` |\n| VB2 inputs | bytes 0-4 DXPC IN1-5, same channels as VB1: Upstream 0.0-1.0, Downstream 1.1-2.1 · LAB1 bytes 5-48: dancers Upstream A 7-8, B 9-10, Downstream A 11-12, B 13-14 · IN 3 CH2 onward belongs to the L2S4 soft cap |\n| VB2 outputs | bytes 0-43 LAB1 · 44-45 DYPE (VB4) · coils 46-49, station n: A = bit 2n-2, B = 2n-1 · st1 cutter Upstream 46.0 / 46.1 · st2 cutter Downstream 46.2 / 46.3 · st3 selector Upstream 46.4 / 46.5 · st4 selector Downstream 46.6 / 46.7 · st5 inserter Upstream 47.0 / 47.1 · st6 inserter Downstream 47.2 / 47.3 · st7 / st8 gripper A / B Upstream 47.4-47.7 · st9 / st10 gripper A / B Downstream 48.0-48.3 |\n| Seeds | HMI_TubeLength 342.9 mm; every other value as L2S01 |\n| Supervisor | EIP nodes 20-27 = sd04, sd05, fd05-fd08, vb02, mm02; Alarm[21]-[28]; node count 28; Alarm[30] |\n\nJason 2026-11-11: build on v0.10.1 · VB2 stations 1-10 in the VB1 EA1-EA10 order · VB2 50 / 50 as derived · mm02 OUT1-OUT4 as mm01 · everything else as L2S01.\n';
c = c.replace('| Tubes / spools | A = I/O-list LT', '| Tube | 29 in blue (Jason 2026-11-11; earlier notes said clear) |\n| Tubes / spools | A = I/O-list LT');
const planF = B + '/plan/L2S01_EA_plan.json';
let plan1 = fs.readFileSync(planF, 'utf8').replace('L2S01 (EA) Long Clear Tube Load', 'L2S01 (EA) Blue Tube Load (29 in)');
const plan2 = { job: '1163', station: 'L2S02 Clear Tube Load (13.5 in)', baseline: '1163_Haemonetics_v0.10.1_2026-11-06.L5X', same_as: 'L2S01 (L2S01_EA_plan.json): devices, steps and tracking identical (Jason 2026-11-11)',
  devices: { drives: 'sd04 / sd05 (.23 / .24), axes a04 / a05', vfds: 'fd05-fd08 (.54-.57)', valve_bank: 'vb02_MainAssembly .91, in 50 / out 50', micrometer: 'mm02_L2S02Micrometer .81', encoders: 'HSC2 slot 7 CH0 / CH1' },
  seeds: { HMI_TubeLength: 342.9 }, assumptions: ['every other seed as L2S01', 'modules cloned from the L2S01 twins'], questions_open: ['Ian / Jason: clear-tube distances and limits where they differ from L2S01'] };
const exF = B + '/plan/station-examples.json';
const ex = JSON.parse(fs.readFileSync(exF, 'utf8'));
for (const k of [TU, DU, TD, DD]) ex[k] = ex[k] || { example: S1(k) + ' (job file, Jason-corrected) cloned by script', reference: 'Jason 2026-11-11: L2S2 is exactly the same as L2S1' };
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
cfg.programs = '^(L[12]_S00_|L2_S0[124]_|L2_S10_|Supervisor$)'; cfg.shapeLintPrograms = '^(L2_S(01|02|04|10)_|L1_S00_|L1_Tracking$)';
cfg.title = '1163 Haemonetics - L1 Indexer and Tracking, L2 Indexer, L2S01 (EA) Blue Tube Load, L2S02 Clear Tube Load, L2S04 (EC) Spike and Cap Load, L2S10 (EJ) Blue Tube Coiler';
if (DRY) { console.log('--dry: fragments computed, nothing written (' + PCS + ' parameter connections)'); process.exit(0); }
fs.writeFileSync(headF, h); fs.writeFileSync(backF, b); fs.writeFileSync(frontF, f); fs.writeFileSync(metaF, JSON.stringify(meta, null, 2));
fs.writeFileSync(cf, c); fs.writeFileSync(planF, plan1); fs.writeFileSync(B + '/plan/L2S02_plan.json', JSON.stringify(plan2, null, 2) + '\n');
fs.writeFileSync(exF, JSON.stringify(ex, null, 2) + '\n'); fs.writeFileSync(cfgF, JSON.stringify(cfg, null, 2) + '\n');
console.log('fragments, contract, plans, station examples, intake updated');

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
