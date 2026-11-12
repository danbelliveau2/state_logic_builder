'use strict';
// coverNote1163S6.cjs — cover-note fragments, intake and the document for 1163 v0.12 (L2S6-L2S9 Epson tube insert).
//   node scripts/coverNote1163S6.cjs [--dry]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163', B = D + '/build-inputs', OUT = B + '/out', H = D + '/_history';
const M = '1163_Haemonetics', JOB = '1163', VERSION = '0.12', SHORT = 'Nov 12';
const ISO = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const rep = (s, a, b, what) => { must(s.split(a).length === 2, 'anchor not found once: ' + what); return s.replace(a, () => b); };
const STA = [6, 7, 8, 9];
const P = (n, k) => 'L2_S0' + n + '_' + k;
const NEW = STA.flatMap((n) => [P(n, 'InsertRobot'), P(n, 'SoftCapGripper'), P(n, 'Dispenser')]);

const headF = OUT + '/' + JOB + '_CoverNote_head.html', backF = OUT + '/' + JOB + '_CoverNote_back.html', frontF = OUT + '/' + JOB + '_CoverNote_front.html', metaF = OUT + '/' + JOB + '_CoverNote_meta.json';
let h = fs.readFileSync(headF, 'utf8'), b = fs.readFileSync(backF, 'utf8'), f = fs.readFileSync(frontF, 'utf8');
const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
const l5x = fs.readFileSync(D + '/' + M + '.L5X', 'utf8');
must(l5x.includes('<Program Name="L2_S06_InsertRobot"') && l5x.includes('<Program Name="L2_S09_Dispenser"'), 'delivered file carries L2S6-L2S9');
const PCS = l5x.split('<ParameterConnection ').length - 1;
const addRow = (label, text) => { const re = new RegExp('(<tr><td>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</td><td>[a-z]*</td><td>)([\\s\\S]*?)(</td></tr>)'); must(re.test(h), 'input row ' + label); h = h.replace(re, (m, a, body, c) => a + body + ' ' + text + c); };

// ── head ──
if (!h.includes('<tr><td>0.12</td>')) {
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, '<tr><td>0.12</td><td>' + SHORT + '</td><td><b>L2S6&ndash;L2S9 (EE / EH) Tube Insert</b>: four Epson LS4-C SCARA stations, one nest each (S6 downstream, S7 upstream, S8 downstream, S9 upstream; blue tube into the lower port on S6 / S7, clear tube into the top port on S8 / S9 &ndash; a robot point, not PLC logic), three programs per station: <code>L2_S0n_InsertRobot</code> (robot, tube nest opener, load cell, Station[n] tracking), <code>L2_S0n_SoftCapGripper</code> (cap nest opener, gripper Z, gripper &ndash; lifts the soft cap as the funnel while the robot fetches solvent), <code>L2_S0n_Dispenser</code> (DST503, the L2S04 form). S7&ndash;S9 are S6 by the same builder with their own points (proved identical except names, station numbers, nest side and failure codes). Hardware: <code>rob03</code>&ndash;<code>rob06</code> (.65 / .67 / .69 / .71, the V5.4 Epson module form, UDTs and AOI_Epson_IN / OUT carried from V5.4), <code>vb05_MainAssembly</code> (.92, in 12 / out 6). Indexer stations-complete / pause take the four robots, actuators-safe the robots and the grippers, StationCompleteTimes[6&ndash;9]; Supervisor polls twelve more programs, EIP nodes 28&ndash;32 (Alarm[29]&ndash;[33], array 35); Alarms roll-up; MapInputs / MapOutputs; <code>g_L2StationList[6&ndash;9]</code>; ' + PCS + ' parameter connections. The 19 other programs are byte-identical to 0.11. Built by <code>scripts/build1163S6.cjs</code>; shape checker 0, import simulation PASS, regression pass.</td><td>Jason, Nov 12: three programs per station (robot with the tube nest opener; gripper Z / cap nest opener; dispenser) so the robot and the devices run in parallel; station 5 unused, results from station 4; PICK and GETGLUE wait at the location for a Proceed bit, INSERT one state; Nick&rsquo;s boxes shifted, Box 1 = Safe For Index (1 = safe); asks 5&ndash;10 yes; S9 tube nest opener on IN 2 CH2. Build S6 to S9.</td></tr>\n</table>\n<h2>What I was given</h2>');
  must(h.includes('<tr><td>0.12</td>'), 'head row 0.12');
  addRow('1 Walkthrough transcript', 'EE / EH walkthrough Nov 11 (Jason, Caleb Hunkus, Tim Wilmot, Hailey Rizor): stations 6&ndash;9 one process, devices, sequence, failure handling; Nick Parshall&rsquo;s robot commands and points (Teams, Nov 12).');
  addRow('2 Ballooned assembly drawings', 'EE: station screenshot (SCARA, dispenser, soft cap slide), no balloons.');
  addRow('3 Station description sheet', 'EE / EH: none; the walkthrough covers it.');
  addRow('4 Controls BOM', 'L2S6&ndash;L2S9 (Nov 12 workbook): Epson RLS4C401ST8 + RC800A + EtherNet/IP option per station, D-M9PSAPC retracted sensors on VB5 IN 1 CH0&ndash;IN 2 CH3, ISA-5LB / IN-UVI load cells on VB5 AIN 1 / 2, robot gripper valve on the robot&rsquo;s own OUT0/1.');
  addRow('5 I/O list', 'L2S6&ndash;L2S9: inputs from the BOM I/O assignment, valve stations from Jason&rsquo;s VB5 valve order (1&ndash;4 S6, 5&ndash;8 S7, 9&ndash;12 S8, 13&ndash;16 S9: cap nest opener, tube nest opener, gripper Z, gripper); DMPF nibbles per dispenser and VB5 12 / 6 confirmed by Jason (Nov 12).');
  addRow('6 Pneumatic drawings', 'VB5 manifold layout (Nov 2: SY3000 16 stations, 12x SY3300 closed centre, 4x SY3200; EX600 2x DXPC, 2x AXA, 2x DMPF).');
  addRow('8 Example per station', 'S6&ndash;S9: V5.4 S08_EpsonRobotPNP (Jason&rsquo;s Epson form), job L2_S04_SpikePNP (force judge, tracking), L2_S04 pneumatics and dispenser.');
  addRow('9 Ethernet device list', 'IP tab Nov 12: L2S6&ndash;L2S9 robot EIP .65 / .67 / .69 / .71 (programming ports .64&ndash;.70), VB5 .92.');
  h = rep(h, 'L2_S04_DispenserDownstream</b>, Production', 'L2_S04_DispenserDownstream, ' + NEW.join(', ') + '</b>, Production', 'head controller programs');
  h = rep(h, '<b>mm02_L2S02Micrometer</b> .81; <b>sd21_L1Indexer</b>', '<b>mm02_L2S02Micrometer</b> .81; <b>L2S6&ndash;L2S9</b>: <b>rob03_L2S06Robot</b> .65, <b>rob04_L2S07Robot</b> .67, <b>rob05_L2S08Robot</b> .69, <b>rob06_L2S09Robot</b> .71 (Epson RC800A, generic ETHERNET-MODULE in 100 / out 150, 32 INT, config 1 size 0, the V5.4 rob03 form), <b>vb05_MainAssembly</b> .92 (EX600-SEN7, generic SINT in 12 / out 6); <b>sd21_L1Indexer</b>', 'head hardware');
  h = rep(h, 'micrometer and encoder card. <b>L2S10 (EJ)</b>', 'micrometer and encoder card. <b>L2S6&ndash;L2S9 (EE / EH)</b> are four identical tube insert stations, each an Epson LS4-C SCARA working one nest (S6 downstream, S7 upstream, S8 downstream, S9 upstream): the robot picks the tube from the nest (the tube nest opens once it grips), carries it to the station&rsquo;s solvent dispenser, and inserts it into the soft cap that a vertical slide with a gripper has lifted out of the nest as a funnel; the load cell on the robot judges the insertion; the slide then places cap and tube back. S6 / S7 insert the blue tube into the lower port, S8 / S9 the clear tube into the top port. <b>L2S10 (EJ)</b>', 'head platform');
  h = rep(h, '<tr><td class="k"><b>Modes</b></td><td>', '<tr><td class="k"><b>Modes</b></td><td>Tube insert (S6&ndash;S9): the robot program waits for the index and a part on its nest, triggers PICK, waits for the robot at the tube (Box 2, gripper closed), opens the tube nest, raises Proceed and waits for the pick to finish; triggers GETGLUE, waits for the robot at the dispenser (Box 3), runs the dispenser (START held, 700 ms dwell), raises Proceed; waits for the soft cap presented, triggers INSERT and watches the force (InsertStop to the robot on over force), judges at cycle complete. Meanwhile the gripper program lowers onto the soft cap, grips, opens the cap nest, lifts (HoldingCap), presents it, and after the insertion lowers, closes the cap nest, opens and lifts. The dispenser follows the robot (request at Box 3, tube out when Box 3 drops). ', 'head modes');
  h = rep(h, 'STO on the main guard door until the macaroni safety I/O exists.</td></tr>', 'STO on the main guard door until the macaroni safety I/O exists. S6&ndash;S9: 6 &ndash; the Epson form is Jason&rsquo;s, the handshake form, boxes and program split his Nov 12 rulings; the Proceed / InsertStop bit numbers, Box 1 as the safe-for-index box, VB5 unit order and the force window are assumptions in the Asks; nothing has run on hardware.</td></tr>', 'head logic');
}

// ── back ──
if (!b.includes('<tr><td>48</td>')) {
  b = rep(b, 'write nothing &ndash; a feeder has no nest.', 'write nothing &ndash; a feeder has no nest. L2S6&ndash;L2S9 each write Station[6]&ndash;[9] on their own nest side (B on S6 / S8, A on S7 / S9): Attempt at PICK, Success from the force window at cycle complete, FailureType n1 no force (fault), n2 over force, n3 stopped short, n4 cycle unfinished at initialization; S6 / S7 gate on Station[4] and the soft cap record Station[16] in series, S8 on Station[6], S9 on Station[7]. The gripper and dispenser programs read their station&rsquo;s OpStatus only.', 'back tracking');
  b = rep(b, 'the four L2S02 programs, L2_S10_BlueTubeCoiler', 'the four L2S02 programs, the twelve L2S6&ndash;L2S9 programs, L2_S10_BlueTubeCoiler', 'back alarms');
  b = rep(b, '<code>g_L2StationList[2]</code> = &ldquo;L2S02 Tube Load: &rdquo;.', '<code>g_L2StationList[2]</code> = &ldquo;L2S02 Tube Load: &rdquo;; <code>g_L2StationList[6]</code>&ndash;<code>[9]</code> = &ldquo;L2S0n Tube Insert: &rdquo;.', 'back station list');
  b = rep(b, 'CPS of vb01_MainAssembly, vb02_MainAssembly, vb06_MainAssembly,', 'CPS of vb01_MainAssembly, vb02_MainAssembly, vb05_MainAssembly, vb06_MainAssembly,', 'back map');
  b = rep(b, 'and the eight PowerFlex 525 drives into controller buffers, whole blocks only, nothing else.', 'and the eight PowerFlex 525 drives into controller buffers, whole blocks only, nothing else; AOI_Epson_IN / AOI_Epson_OUT map each of the four robots (rob03&ndash;rob06) to its Status / Control tag, the V5.4 form.', 'back map epson');
  b = rep(b, '202 parameter connections', PCS + ' parameter connections', 'back pcs');
  b = rep(b, 'Polls fifteen state machines', 'Polls twenty-seven state machines', 'back supervisor polls');
  b = rep(b, 'EIP monitor counts 28 nodes,', 'EIP monitor counts 33 nodes, Alarm[29]&ndash;[33] = the L2S6&ndash;L2S9 robots and VB5 (nodes 28&ndash;32), the array grown to 35;', 'back supervisor nodes');
  const asks = [
    ['48', 'Robot contract for Nick: PLC &rarr; robot <code>UserWord[0]</code> 2 PICK, 4 GETGLUE, 3 INSERT, 100 SAFEHOME; echo in <code>UserWord[0]</code>, <code>UserIn[0].0</code> Program Done, <code>.1</code> Invalid Command, <code>.6</code> Gripper Closed; <code>UserOut[0].4</code> Machine In Manual, <code>.5</code> Proceed (PICK waits at TubePick with the gripper closed until it is high, then lifts and finishes; GETGLUE waits at GluePos until it is high, then leaves and finishes), <code>.6</code> InsertStop (halts the slow insert; INSERT releases and retreats to TubeClear on its own). InsideBox 1 = Safe For Index, 1 when safe (nest zone clear), 2 TubePick, 3 GluePos, 4 CapInsert, 5 HomePos. Confirm the bit numbers and Box 1.', 'Nick'],
    ['49', 'VB5 is in 12 / out 6 with the units in the SMC part-list order (DXPC1, DXPC2, AXA1, AXA2, DMPF1, DMPF2; coils from output byte 2). Set the real sizes in Studio if the assembly differs; the byte map is in the NAMES CONTRACT.', 'Jason'],
    ['50', 'Force window per station (HMI): engage 0.3 lb, limit 4.0 lb, zero 2048 counts, 0.0024 lb / count (the L2S04 seeds). Success = engaged, never over the limit, robot reached CapInsert (Box 4). No force = &ldquo;Tube Not Inserted, No Force&rdquo;, a sealed fault (Caleb: stop the machine); over force or stopped short = reject, the machine indexes; three consecutive = fault. The top-port stations (S8 / S9) may need their own values.', 'Jason / Caleb'],
    ['51', 'Robot safety: the SafetyProgram is untouched; the robots report EStopOn / SafeguardOn through their status and the PLC stops and resets them in the template form. Say which E-stop / guard relay pair (A&amp;B, C&amp;D) serves rob03&ndash;rob06 if the safety program is to name them.', 'Jason'],
    ['52', 'A tube left in a robot gripper at initialization goes to safe home closed and its nest fails (n4); the operator clears it from the pendant. The robot re-homes after every fault (Initialized needs HomePos), so a cycle interrupted by a fault is always judged n4 and the soft cap goes back to the nest.', 'Jason'],
  ].map(([n, t, w]) => '<tr><td>' + n + '</td><td>' + t + '</td><td>' + w + '</td></tr>').join('\n');
  b = b.replace(/<\/table>\r?\n<h2>Referenced<\/h2>/, asks + '\n</table>\n<h2>Referenced</h2>');
  must(b.includes('<tr><td>52</td>'), 'back asks');
  b = rep(b, '<code>scripts/build1163S2.cjs</code>, <code>scripts/coverNote1163S2.cjs</code>.', '<code>scripts/build1163S2.cjs</code>, <code>scripts/coverNote1163S2.cjs</code>. <code>AI Inputs\\L2S6\\</code>: <code>1163_ EE _ EH Walkthrough.docx</code>, <code>Epson Robot Points.png</code> (Nick), <code>Station Image.png</code>, <code>VB5 valve order.txt</code>, <code>VB5.pdf</code>, <code>1163 Master Electrical.xlsm</code> (Nov 12); <code>plan\\L2S06_EE_readiness_2026-11-12.md</code>, <code>L2S06_EE_proposal_2026-11-12.md</code> (rev 2), <code>L2S06_plan.json</code>; <code>scripts/build1163S6.cjs</code>, <code>scripts/lib/s6/</code>, <code>scripts/coverNote1163S6.cjs</code>.', 'back referenced');
}

// ── front ──
if (!f.includes('Tube insert')) {
  f = rep(f, '<tr><td class="k">Index</td>', '<tr><td class="k">Tube insert</td><td><b>L2S6&ndash;L2S9</b>, one nest each: the robot picks the tube (the tube nest opens once the gripper is closed), carries it to the dispenser for solvent, and inserts it into the soft cap that the gripper slide has lifted out of the nest as a funnel; the load cell judges the insertion; the slide places cap and tube back, closes the cap nest, opens and lifts. S6 / S7 the blue tube into the lower port, S8 / S9 the clear tube into the top port.</td></tr>\n<tr><td class="k">Index</td>', 'front tube insert');
  f = rep(f, 'pause when starved of spikes) and L2S10', 'pause when starved of spikes), L2S6&ndash;L2S9 (robot Safe For Index box, tube nest closed, gripper Z up, cap nest closed) and L2S10', 'front index');
}

// ── meta ──
const side = { 6: ['B', 'downstream', 'blue tube, lower port', 'Station[4] and Station[16]'], 7: ['A', 'upstream', 'blue tube, lower port', 'Station[4] and Station[16]'], 8: ['B', 'downstream', 'clear tube, top port', 'Station[6]'], 9: ['A', 'upstream', 'clear tube, top port', 'Station[7]'] };
const rob = { 6: 'rob03 (.65)', 7: 'rob04 (.67)', 8: 'rob05 (.69)', 9: 'rob06 (.71)' };
const pts = { 6: ['0.0 / 0.1 / 0.2', 'bytes 2&ndash;3 (AXA1 CH0)', 'DMPF1 in 10.0&ndash;10.3 / out 0.0&ndash;0.3', 'byte 2'], 7: ['0.3 / 0.4 / 0.5', 'bytes 4&ndash;5 (AXA1 CH1)', 'DMPF1 in 10.4&ndash;10.7 / out 0.4&ndash;0.7', 'byte 3'], 8: ['0.6 / 0.7 / 1.0', 'bytes 6&ndash;7 (AXA2 CH0)', 'DMPF2 in 11.0&ndash;11.3 / out 1.0&ndash;1.3', 'byte 4'], 9: ['1.1 / 1.2 / 1.3', 'bytes 8&ndash;9 (AXA2 CH1)', 'DMPF2 in 11.4&ndash;11.7 / out 1.4&ndash;1.7', 'byte 5'] };
for (const n of STA) {
  const [ab, nest, tube, gate] = side[n], [sens, lc, dmpf, coil] = pts[n], sn = 'L2S0' + n;
  meta[P(n, 'InsertRobot')] = {
    title: sn + ' &ndash; Tube insert robot (Epson LS4-C SCARA), ' + nest + ' nest',
    does: 'Picks the tube from the ' + nest + ' nest, applies solvent at the station&rsquo;s dispenser and inserts it into the soft cap held by the gripper slide (' + tube + '); judges the insertion from the load cell. Station ' + n + ' tracking on nest ' + ab + '; a nest with no part, without the upstream results (' + gate + ') or locked out idles.',
    devices: 'Robot &ndash; Epson RLS4C401ST8 on RC800A, ' + rob[n] + ', EtherNet/IP generic module (in 100 / out 150, 32 INT), AOI_Epson_IN / OUT &middot; Tube Nest Opener &ndash; VB5 ' + coil + ' bits 2 / 3, retracted sensor VB5 IN ' + sens.split(' / ')[1] + ', extended by 100 ms delay &middot; Load Cell &ndash; Flintec ISA-5LB through Omega IN-UVI into EX600-AXA, VB5 ' + lc,
    notes: 'StaNum ' + n + ', StaNumPre ' + (n <= 7 ? 4 : n - 2) + (n <= 7 ? ' (Station[16] soft cap in series)' : '') + '; Attempt at state 7, Success at 40 (engaged, never over the limit, Box 4 reached), FailureType ' + n + '1 no force (sealed fault, Caleb), ' + n + '2 over force, ' + n + '3 stopped short, ' + n + '4 cycle unfinished at initialization; ConsecFails fault (setpoint 3). Sequence: PICK (2) &rarr; robot at TubePick with the gripper closed &rarr; tube nest opens &rarr; Proceed (UserOut[0].5) &rarr; pick done &rarr; GETGLUE (4) &rarr; robot at GluePos &rarr; dispense (request to the dispenser, START held, 700 ms dwell) &rarr; Proceed &rarr; get glue done &rarr; soft cap presented &rarr; INSERT (3) with the force watch (InsertStop UserOut[0].6 on over force) &rarr; done &rarr; cycle complete (judge) &rarr; 4, or stop the robot program when the cycle stops. The tube nest closes once the robot has lifted the tube out. Boxes: 1 Safe For Index (q_ActuatorsSafe with the nest closed), 2 TubePick, 3 GluePos, 4 CapInsert, 5 HomePos. Handshakes: p_CycleStarted (7&ndash;37), p_RobotClearOfCap, p_TubeInserted (40 or initializing), p_DispenseRequest (25), p_TubeOutOfDispenser. Initialization: motors on, start program, SAFEHOME, close the tube nest; an unfinished cycle fails its nest (' + n + '4). Robot stop / start / continue / reset, manual triggers (HMI_Momentary 0&ndash;4) and motors (HMI_Hold) in the template form; alarms: robot faulted, invalid command, did not start, handshakes, waiting-for on every robot state and both nest opener directions (TubeFeed form), no-force fault, reject warnings, consecutive failures.',
    extra: { Form: 'V5.4 S08_EpsonRobotPNP (Jason&rsquo;s Epson form) + L2_S04_SpikePNP tracking and force judge + L2_S01 one-sensor cylinder; Jason&rsquo;s handshake form', Logic: '6 &ndash; sequence per the EE / EH walkthrough and Jason&rsquo;s Nov 12 rulings; the Proceed / InsertStop bits and Box 1 are for Nick to confirm', Referenced: 'L2S06_EE_proposal_2026-11-12.md (rev 2), L2S06_plan.json, Nick&rsquo;s robot points', Ask: '48, 50, 51, 52' },
  };
  meta[P(n, 'SoftCapGripper')] = {
    title: sn + ' &ndash; Soft cap gripper slide, ' + nest + ' nest',
    does: 'Runs in parallel with the robot: lowers onto the soft cap, grips it, opens the cap nest, lifts the cap out as the funnel for the insertion, and once the tube is in and the robot is clear lowers cap and tube back, closes the cap nest, opens and lifts.',
    devices: 'Soft Cap Nest Opener &ndash; VB5 ' + coil + ' bits 0 / 1, retracted sensor VB5 IN ' + sens.split(' / ')[0] + ' &middot; Gripper Z Slide &ndash; VB5 ' + coil + ' bits 4 / 5, retracted sensor VB5 IN ' + sens.split(' / ')[2] + ', extended by 300 ms delay &middot; Soft Cap Gripper &ndash; VB5 ' + coil + ' bits 6 / 7, delay-confirmed (100 ms)',
    notes: 'No part tracking; reads Station[' + n + '].OpStatus Lockout / DryRun / SingleStep ' + ab + '. Starts on the robot&rsquo;s p_CycleStarted, publishes p_SoftCapPresented (cap lifted, gripper closed, nest open), places on p_TubeInserted with the robot clear of the cap (not Box 4). HoldingCap survives every stop and re-commands the gripper; initialization never opens the gripper while it holds a cap (state 4 re-enters at 19 and the cap goes back to the nest once the robot has inserted or re-initialized). q_ActuatorsSafe = Z up and the cap nest closed. Pneumatic faults in the TubeFeed device form (Z extend / retract, nest open / close, 5 s), gripper close / open by state (3 s), tube insertion wait 60 s.',
    extra: { Form: 'L2_S04 pneumatics (S03 form): one-sensor cylinders, sensorless gripper, held-part memory', Logic: '7 &ndash; sequence per Caleb&rsquo;s walkthrough; delays are the Nov 12 defaults', Referenced: 'L2S06_EE_proposal_2026-11-12.md (rev 2)', Ask: '49' },
  };
  meta[P(n, 'Dispenser')] = {
    title: sn + ' &ndash; Solvent dispenser (Marposs Dosaset DST503)',
    does: 'Enters PLC mode at every boot, then for each dip holds START while the robot has the tube in the bushing (500 ms minimum), drops it once the robot has left (Box 3 off), and waits for READY after the wheel turn.',
    devices: 'Dosaset DST503-ET &ndash; EX600-DMPF ' + dmpf + ' (IN1, IN2, START, RESET out; OUT1, OUT2, READY, ALARMS in)',
    notes: 'The L2S04 dispenser program re-pointed to the robot (p_DispenseRequest, p_TubeOutOfDispenser); p_DispenseReady and p_DispenseComplete (START held its minimum, the robot may be told to proceed). START is held through a fault until the tube is out. HMI_AdapterPosition 1&ndash;4, echo checked. Reads Station[' + n + '].OpStatus of its side.',
    extra: { Form: 'L2_S04_DispenserUpstream (Jason-corrected) re-pointed', Logic: '7', Referenced: 'DST Manual ch. 13 and 15', Ask: '49' },
  };
}
if (meta.Supervisor) meta.Supervisor.does = 'Template form. Polls both indexers and the twenty-five station programs for auto, stopped and start-OK; horn override from either indexer&rsquo;s pause restart; thirty-three EIP nodes monitored (L2 and L1 indexer drives; L2S01 and L2S02 each two feed drives, four payout VFDs, valve bank, micrometer; four S04 drives; five S10 drives, VB6; the four L2S6&ndash;L2S9 robots and VB5).';
if (meta.L2_S00_IndexerNoSP) meta.L2_S00_IndexerNoSP.notes = meta.L2_S00_IndexerNoSP.notes + ' L2S6&ndash;L2S9: the four robot programs in the stations-complete and pause rungs (reasons 6&ndash;9), the robots and the gripper slides in the actuators-safe rung, StationCompleteTimes[6]&ndash;[9].';

// ── intake ──
const cfgF = B + '/intake.json';
const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
cfg.programs = '^(L[12]_S00_|L2_S0[12469]_|L2_S10_|Supervisor$)'; cfg.shapeLintPrograms = '^(L2_S(01|02|04|06|07|08|09|10)_|L1_S00_|L1_Tracking$)';
cfg.title = '1163 Haemonetics - L1 Indexer and Tracking, L2 Indexer, L2S01 (EA) Blue Tube Load, L2S02 Clear Tube Load, L2S04 (EC) Spike and Cap Load, L2S6-L2S9 (EE / EH) Tube Insert, L2S10 (EJ) Blue Tube Coiler';
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
