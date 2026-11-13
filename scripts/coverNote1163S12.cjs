'use strict';
// coverNote1163S12.cjs — cover-note fragments, intake and the document for 1163 v0.15 (L2S12 / L2S13 Y site tube insert).
//   node scripts/coverNote1163S12.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.15', SHORT = 'Nov 13';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const rep = (s, a, b, what) => { must(s.split(a).length === 2, 'anchor not found once: ' + what); return s.replace(a, () => b); };
const STA = [12, 13];
const P = (n, k) => 'L2_S' + n + '_' + k;
const NEW = STA.flatMap((n) => [P(n, 'InsertRobot'), P(n, 'YSiteGripper'), P(n, 'Dispenser')]);

const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8'), f = fs.readFileSync(frontF, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
const l5x = fs.readFileSync(D + '/' + M + '.L5X', 'utf8');
must(l5x.includes('<Program Name="L2_S12_InsertRobot"') && l5x.includes('<Program Name="L2_S13_Dispenser"'), 'delivered file carries L2S12 / L2S13');
const PCS = l5x.split('<ParameterConnection ').length - 1;
const addRow = (label, text) => { const re = new RegExp('(<tr><td>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</td><td>[a-z]*</td><td>)([\\s\\S]*?)(</td></tr>)'); must(re.test(h), 'input row ' + label); h = h.replace(re, (m, a, body, c) => a + body + ' ' + text + c); };

// ── head ──
if (!h.includes('<tr><td>0.15</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.15</td><td>' + SHORT + '</td><td><b>L2S12 / L2S13 Y Site Tube Insert</b>: two more Epson LS4-C SCARA stations in the L2S6 form, one nest each (S12 downstream, S13 upstream), the clear tube into the Y site. Three programs per station: <code>L2_S1n_InsertRobot</code> (Jason&rsquo;s v0.13 S06 program with the station, the nest gate and the Y site words changed, proved by normalization), <code>L2_S1n_YSiteGripper</code> (gripper Z and gripper: lowers onto the Y site, closes to locate it, holds through the insertion, opens before it lifts &ndash; the Y site is never lifted out of its nest), <code>L2_S1n_Dispenser</code> (the S06 dispenser). Hardware: <code>rob07</code> / <code>rob08</code> (.73 / .75, the rob03 form); VB6 as shipped (in 8 / out 8): sensors DXPC2 1.2&ndash;1.5, load cells AXA bytes 2&ndash;5, dispensers DMPF in 6 / out 2, the six off-manifold valves on the EX600-DYPE out 0.0&ndash;1.3. Indexer stations-complete / pause take the two robots, actuators-safe the robots and the grippers, StationCompleteTimes[12&ndash;13]; Supervisor polls six more programs, EIP nodes 33&ndash;34 (Alarm[34]&ndash;[35], array 37); Alarms roll-up; MapInputs / MapOutputs; <code>g_L2StationList[12&ndash;13]</code>; ' + PCS + ' parameter connections. The 31 other programs are byte-identical to 0.14. Built by <code>scripts/build1163S12.cjs</code>; shape checker 0, import simulation PASS, regression pass.</td><td>Jason, Nov 13: &ldquo;Very similar to L2S6&ndash;L2S9: one robot, one dispenser, and some pneumatic cylinders. L2S12 processes the downstream nest, L2S13 the upstream nest. Tube Nest Opener is controlled by the robot state machine. We are not lifting the y site at this station. We simply extend down, close the gripper (locating the y site), insert the tube, then open gripper and retract the vertical.&rdquo; Asks 1&ndash;4 (DYPE two bits per valve, AXA CH0 / CH1, DMPF nibbles, VB6 byte order) confirmed; the clear tube; the rest on assumptions.</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>0.15</td>'), 'head row 0.15');
  addRow('1 Walkthrough transcript', 'L2S12 / L2S13: none; Jason&rsquo;s description (Nov 13) and the L2S6 form.');
  addRow('4 Controls BOM', 'L2S12 / L2S13 (Nov 13 workbook): Epson RLS4C401ST8 + RC800A + EtherNet/IP option per station, ISA-5LB / IN-UVI load cells, D-M9PSAPC retracted sensors on VB6 IN 2 CH2&ndash;CH5, robot gripper valve on the robot&rsquo;s own OUT0/1; no rows yet for the DYPE valves or the dispensers.');
  addRow('5 I/O list', 'L2S12 / L2S13: sensors from the BOM I/O assignment; valves from Jason&rsquo;s VB6 valve order (EX600-DYPE outputs 1&ndash;6: S12 tube nest opener, gripper Z, gripper; S13 4&ndash;6), two bits each; load cells AXA CH0 / CH1 and dispensers DMPF nibbles 0 / 4 confirmed by Jason (Nov 13).');
  addRow('6 Pneumatic drawings', 'VB6 manifold layout (Nov 13: SY3000 16 stations for S10 / S11, 8x SY3200, 6x SY3300; EX600 2x DXPC, AXA, DYPE, DMPF).');
  addRow('8 Example per station', 'S12 / S13: the delivered L2S6 programs (Jason&rsquo;s v0.13 S06).');
  addRow('9 Ethernet device list', 'IP tab Nov 13: L2S12 / L2S13 robot EIP .73 / .75 (programming .72 / .74), VB6 .93.');
  h = rep(h, 'L2_S09_Dispenser</b>, Production', 'L2_S09_Dispenser, ' + NEW.join(', ') + '</b>, Production', 'head controller programs');
  h = rep(h, '<b>vb05_MainAssembly</b> .92 (EX600-SEN7, generic SINT in 12 / out 6);', '<b>vb05_MainAssembly</b> .92 (EX600-SEN7, generic SINT in 12 / out 6); <b>L2S12 / L2S13</b>: <b>rob07_L2S12Robot</b> .73, <b>rob08_L2S13Robot</b> .75 (the rob03 form) on VB6;', 'head hardware');
  h = rep(h, 'S8 / S9 the clear tube into the top port. <b>L2S10 (EJ)</b>', 'S8 / S9 the clear tube into the top port. <b>L2S12 / L2S13</b> are the same stations once more for the Y site (S12 downstream, S13 upstream): the robot picks the clear tube from the nest, applies solvent and inserts it into the Y site, which a vertical slide with a gripper holds in its nest for the insertion; the Y site is never lifted. <b>L2S10 (EJ)</b>', 'head platform');
  h = rep(h, 'The dispenser follows the robot (request at Box 3, tube out when Box 3 drops). ', 'The dispenser follows the robot (request at Box 3, tube out when Box 3 drops). Y site insert (S12 / S13): the robot and dispenser programs are the S6 form; the gripper program lowers onto the Y site, closes to locate it, presents it, and once the tube is in and the robot has backed out opens and lifts. ', 'head modes');
  h = rep(h, 'the force window are assumptions in the Asks; nothing has run on hardware.</td></tr>', 'the force window are assumptions in the Asks; nothing has run on hardware. S12 / S13: 6 &ndash; the S6 form on Jason&rsquo;s I/O answers; the gripper timing, the Y site force window and Nick&rsquo;s program for these robots are assumptions in the Asks.</td></tr>', 'head logic');
}

// ── back ──
if (!b.includes('<tr><td>55</td>')) {
  b = rep(b, 'The gripper and dispenser programs read their station&rsquo;s OpStatus only.', 'The gripper and dispenser programs read their station&rsquo;s OpStatus only. L2S12 / L2S13 write Station[12] / Station[13] the same way (B on S12, A on S13; FailureType 121&ndash;124 / 131&ndash;134) and gate on Station[11] on their nest side; the Y site has no record of its own.', 'back tracking');
  b = rep(b, 'the twelve L2S6&ndash;L2S9 programs, L2_S10_BlueTubeCoiler', 'the twelve L2S6&ndash;L2S9 programs, the six L2S12 / L2S13 programs, L2_S10_BlueTubeCoiler', 'back alarms');
  b = rep(b, '<code>g_L2StationList[6]</code>&ndash;<code>[9]</code> = &ldquo;L2S0n Tube Insert: &rdquo;.', '<code>g_L2StationList[6]</code>&ndash;<code>[9]</code> = &ldquo;L2S0n Tube Insert: &rdquo;; <code>[12]</code>, <code>[13]</code> = &ldquo;L2S1n Y Site Insert: &rdquo;.', 'back station list');
  b = rep(b, 'map each of the four robots (rob03&ndash;rob06)', 'map each of the six robots (rob03&ndash;rob08)', 'back map epson');
  b = rep(b, '294 parameter connections', PCS + ' parameter connections', 'back pcs');
  b = rep(b, 'Polls twenty-seven state machines', 'Polls thirty-three state machines', 'back supervisor polls');
  b = rep(b, 'EIP monitor counts 33 nodes,', 'EIP monitor counts 35 nodes, Alarm[34]&ndash;[35] = the L2S12 / L2S13 robots (nodes 33&ndash;34), the array grown to 37;', 'back supervisor nodes');
  const asks = [
    ['53', 'Robot programs for S12 / S13 (Nick): the S6 contract as built &ndash; <code>UserWord[0]</code> 2 PICK, 4 GETGLUE, 3 INSERT, 100 SAFEHOME; Proceed <code>UserOut[0].5</code>, InsertStop <code>.6</code>; InsideBox 1 Safe For Index, 2 TubePick, 3 GluePos, 4 the Y site insert depth, 5 HomePos. Confirm the boxes and the bit numbers.', 'Nick'],
    ['54', 'Y site gripper timing: the gripper opens only once the robot has backed out of the Y site (Box 4 dropped) after the insertion, and initialization opens the gripper before Z retracts so a located Y site is never pulled out of its nest. Z extended by a 300 ms delay, gripper 100 ms, 60 s wait for the insertion. Say if the gripper should release as soon as the robot lets go.', 'Jason'],
    ['55', 'Force window for the Y site insertion: the S6 seeds (engage 0.3 lb, limit 4.0 lb, zero 2048 counts, 0.0024 lb / count; no force = sealed fault, over force or stopped short = reject, three consecutive = fault). Set the real values on the HMI.', 'Jason / Caleb'],
  ].map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n');
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks + '\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>55</td>'), 'back asks');
  b = rep(b, '<code>scripts/build1163S6.cjs</code>, <code>scripts/lib/s6/</code>, <code>scripts/coverNote1163S6.cjs</code>.', '<code>scripts/build1163S6.cjs</code>, <code>scripts/lib/s6/</code>, <code>scripts/coverNote1163S6.cjs</code>. <code>AI Inputs\\L2S12\\</code>: <code>1163 Master Electrical.xlsm</code> (Nov 13), <code>VB6 valve order.txt</code>, <code>VB6.pdf</code> (Nov 13); <code>plan\\L2S12_readiness_2026-11-13.md</code>, <code>L2S12_proposal_2026-11-13.md</code>, <code>L2S12_plan.json</code>; <code>scripts/build1163S12.cjs</code>, <code>scripts/lib/s12/gripper.cjs</code>, <code>scripts/coverNote1163S12.cjs</code>.', 'back referenced');
}

// ── front ──
if (!f.includes('Y site insert')) {
  f = rep(f, '<tr><td class="k">Index</td>', '<tr><td class="k">Y site insert</td><td><b>L2S12 / L2S13</b>, one nest each: the S6 cycle again with the clear tube into the Y site; the gripper slide lowers onto the Y site and closes to locate it (never lifting it), the robot inserts, the gripper opens and lifts.</td></tr>\n<tr><td class="k">Index</td>', 'front y site insert');
  f = rep(f, 'L2S6&ndash;L2S9 (robot Safe For Index box, tube nest closed, gripper Z up, cap nest closed) and L2S10', 'L2S6&ndash;L2S9 (robot Safe For Index box, tube nest closed, gripper Z up, cap nest closed), L2S12 / L2S13 (robot Safe For Index box, tube nest closed, gripper Z up) and L2S10', 'front index');
}

// ── meta ──
const side = { 12: ['B', 'downstream'], 13: ['A', 'upstream'] };
const rob = { 12: 'rob07 (.73)', 13: 'rob08 (.75)' };
const pts = { 12: ['1.2', '1.3', 'bytes 2&ndash;3 (AXA CH0)', 'DMPF in 6.0&ndash;6.3 / out 2.0&ndash;2.3', 'DYPE 0.0 / 0.1', 'DYPE 0.2 / 0.3', 'DYPE 0.4 / 0.5'], 13: ['1.4', '1.5', 'bytes 4&ndash;5 (AXA CH1)', 'DMPF in 6.4&ndash;6.7 / out 2.4&ndash;2.7', 'DYPE 0.6 / 0.7', 'DYPE 1.0 / 1.1', 'DYPE 1.2 / 1.3'] };
for (const n of STA) {
  const [ab, nest] = side[n], [sOpen, sZ, lc, dmpf, vOpen, vZ, vGrip] = pts[n], sn = 'L2S' + n;
  meta[P(n, 'InsertRobot')] = {
    title: sn + ' &ndash; Y site insert robot (Epson LS4-C SCARA), ' + nest + ' nest',
    does: 'Picks the clear tube from the ' + nest + ' nest, applies solvent at the station&rsquo;s dispenser and inserts it into the Y site held by the gripper slide; judges the insertion from the load cell. Station ' + n + ' tracking on nest ' + ab + '; a nest with no part, without the Station[11] result or locked out idles.',
    devices: 'Robot &ndash; Epson RLS4C401ST8 on RC800A, ' + rob[n] + ', EtherNet/IP generic module (in 100 / out 150, 32 INT), AOI_Epson_IN / OUT &middot; Tube Nest Opener &ndash; VB6 ' + vOpen + ', retracted sensor VB6 IN ' + sOpen + ', extended by 100 ms delay &middot; Load Cell &ndash; Flintec ISA-5LB through Omega IN-UVI into EX600-AXA, VB6 ' + lc,
    notes: 'The L2S06 robot program (Jason&rsquo;s v0.13) with StaNum ' + n + ', StaNumPre 11, NestNumIncoming from Station[' + (n - 1) + '], FailureType ' + n + '1&ndash;' + n + '4 and the Y site words; everything else as L2S06: PICK (2) &rarr; robot at TubePick with the gripper closed &rarr; tube nest opens &rarr; Proceed &rarr; GETGLUE (4) &rarr; dispense &rarr; Proceed &rarr; Y site presented &rarr; INSERT (3) with the force watch &rarr; judge at cycle complete. Boxes 1 Safe For Index, 2 TubePick, 3 GluePos, 4 the Y site insert depth, 5 HomePos. Handshakes: p_CycleStarted (7&ndash;37), p_RobotClearOfYSite (not Box 4), p_TubeInserted (40 or initializing), p_DispenseRequest, p_TubeOutOfDispenser.',
    extra: { Form: 'L2_S06_InsertRobot (Jason, v0.13)', Logic: '6 &ndash; the S6 form on Jason&rsquo;s Nov 13 I/O answers; Nick&rsquo;s program for this robot and the Y site force window are assumptions', Referenced: 'L2S12_proposal_2026-11-13.md, L2S12_plan.json, 1163_L2S6-S9_Robot_Handshakes.docx', Ask: '53, 55' },
  };
  meta[P(n, 'YSiteGripper')] = {
    title: sn + ' &ndash; Y site gripper slide, ' + nest + ' nest',
    does: 'Runs in parallel with the robot: lowers onto the Y site in its nest, closes to locate it, holds it through the insertion, and once the tube is in and the robot has backed out opens and lifts. The Y site is never lifted.',
    devices: 'Gripper Z Slide &ndash; VB6 ' + vZ + ', retracted sensor VB6 IN ' + sZ + ', extended by 300 ms delay &middot; Y Site Gripper &ndash; VB6 ' + vGrip + ', delay-confirmed (100 ms)',
    notes: 'No part tracking; reads Station[' + n + '].OpStatus Lockout / DryRun / SingleStep ' + ab + '. Starts on the robot&rsquo;s p_CycleStarted, publishes p_YSitePresented (Z down, gripper closed), opens on p_TubeInserted with the robot clear of the Y site (not Box 4). Initialization opens the gripper first, then retracts Z. q_ActuatorsSafe = Z up. Pneumatic faults in the TubeFeed device form (Z extend / retract, 5 s), gripper close / open by state (3 s), tube insertion wait 60 s.',
    extra: { Form: 'L2_S06_SoftCapGripper less the nest opener and the held-cap memory (S03 pneumatics)', Logic: '7 &ndash; sequence per Jason&rsquo;s Nov 13 description; delays are the S6 defaults', Referenced: 'L2S12_proposal_2026-11-13.md', Ask: '54' },
  };
  meta[P(n, 'Dispenser')] = {
    title: sn + ' &ndash; Solvent dispenser (Marposs Dosaset DST503)',
    does: 'Enters PLC mode at every boot, then for each dip holds START while the robot has the tube in the bushing (500 ms minimum), drops it once the robot has left (Box 3 off), and waits for READY after the wheel turn.',
    devices: 'Dosaset DST503-ET &ndash; EX600-DMPF ' + dmpf + ' (IN1, IN2, START, RESET out; OUT1, OUT2, READY, ALARMS in)',
    notes: 'The L2S06 dispenser program re-pointed to this station&rsquo;s robot. HMI_AdapterPosition 1&ndash;4, echo checked. Reads Station[' + n + '].OpStatus of its side.',
    extra: { Form: 'L2_S06_Dispenser (the L2_S04_DispenserUpstream form)', Logic: '7', Referenced: 'DST Manual ch. 13 and 15', Ask: '' },
  };
}
if (meta.Supervisor) meta.Supervisor.does = 'Template form. Polls both indexers and the thirty-one station programs for auto, stopped and start-OK; horn override from either indexer&rsquo;s pause restart; thirty-five EIP nodes monitored (L2 and L1 indexer drives; L2S01 and L2S02 each two feed drives, four payout VFDs, valve bank, micrometer; four S04 drives; five S10 drives, VB6; the four L2S6&ndash;L2S9 robots and VB5; the L2S12 / L2S13 robots).';
if (meta.L2_S00_IndexerNoSP) meta.L2_S00_IndexerNoSP.notes = meta.L2_S00_IndexerNoSP.notes + ' L2S12 / L2S13: the two robot programs in the stations-complete and pause rungs (reasons 12, 13), the robots and the gripper slides in the actuators-safe rung, StationCompleteTimes[12], [13].';

// ── intake ──
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
cfg.programs = '^(L[12]_S00_|L2_S0[12469]_|L2_S1[023]_|Supervisor$)'; cfg.shapeLintPrograms = '^(L2_S(01|02|04|06|07|08|09|10|12|13)_|L1_S00_|L1_Tracking$)';
cfg.title = '1163 Haemonetics - L1 Indexer and Tracking, L2 Indexer, L2S01 (EA) Blue Tube Load, L2S02 Clear Tube Load, L2S04 (EC) Spike and Cap Load, L2S6-L2S9 (EE / EH) Tube Insert, L2S10 (EJ) Blue Tube Coiler, L2S12 / L2S13 Y Site Insert';
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
