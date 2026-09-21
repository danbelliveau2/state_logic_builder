'use strict';
// Diff-verify the S07 twins: every differing line must differ ONLY by side tokens (members, points, camera node, text).
const fs = require('fs');
const P = 'C:/SDC-StateLogic/generated/1160/build/programs/';
const A = fs.readFileSync(P + 'S07_PortCutA.xml', 'utf8').split('\n');
const B = fs.readFileSync(P + 'S07_PortCutB.xml', 'utf8').split('\n');
if (A.length !== B.length) { console.log('LINE COUNT DIFFERS', A.length, B.length); process.exit(1); }

const side = {
  A: { cam: 'cam06_LeftCutterPresent', ip: '192.168.1.36', sw: '1524PRX', cbl: '1524CBL', inx: 'IN5', pt: '13', slot: '9', tslot: '7', ext: 'Data[2].0', ret: 'Data[2].1', bits: '16/17', shr: 'Data[1].4', shrN: '12', swbit: 'Data[1].5', LT: 'LT', Nest: 'Left', NEST: 'LEFT', nest: 'left', M: 'A', twin: 'S07_PortCutB' },
  B: { cam: 'cam05_RightCutterPresent', ip: '192.168.1.35', sw: '1520PRX', cbl: '1520CBL', inx: 'IN4', pt: '12', slot: '8', tslot: '6', ext: 'Data[1].6', ret: 'Data[1].7', bits: '14/15', shr: 'Data[1].2', shrN: '10', swbit: 'Data[1].4', LT: 'RT', Nest: 'Right', NEST: 'RIGHT', nest: 'right', M: 'B', twin: 'S07_PortCutA' },
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function norm(s, k, swap) {
  const v = side[k];
  const R = (re, to) => { s = s.replace(re, to); };
  R(new RegExp(esc(v.cam), 'g'), 'CAM'); R(new RegExp(esc(v.ip), 'g'), 'IP'); R(new RegExp(v.sw, 'g'), 'SW'); R(new RegExp(v.cbl, 'g'), 'CBL');
  R(new RegExp(v.inx + ' = bank input point ' + v.pt), 'INX = bank input point PT'); R(new RegExp('bank input ' + v.pt + ' \\('), 'bank input PT (');
  R(new RegExp(v.LT + ' PIERCE', 'g'), 'XT PIERCE');
  R(new RegExp('vb01_UpperValveBank_IN\\.' + esc(v.swbit) + '\\)OTE\\(i_PierceExtended'), 'vb01_UpperValveBank_IN.SWBIT)OTE(i_PierceExtended');
  R(new RegExp('i_PierceExtended <- vb01_UpperValveBank_IN\\.' + esc(v.swbit) + ' bound'), 'i_PierceExtended <- vb01_UpperValveBank_IN.SWBIT bound');
  R(new RegExp('vb01_UpperValveBank_IN ' + esc(v.swbit) + ' - confirm'), 'vb01_UpperValveBank_IN SWBIT - confirm');
  R(new RegExp('vb01_UpperValveBank_OUT\\.' + esc(v.ext)), 'vb01_UpperValveBank_OUT.EXT'); R(new RegExp('vb01_UpperValveBank_OUT\\.' + esc(v.ret)), 'vb01_UpperValveBank_OUT.RET');
  R(new RegExp('bits ' + esc(v.bits) + ' = ' + esc(v.ext) + ' extend / ' + esc(v.ret) + ' retract'), 'bits BB = EXT extend / RET retract');
  R(new RegExp('vb02_TableValveBank_OUT\\.' + esc(v.shr)), 'vb02_TableValveBank_OUT.SHR'); R(new RegExp('bit ' + v.shrN + ' = ' + esc(v.shr) + '\\.'), 'bit NN = SHR.');
  R(new RegExp('slot ' + v.slot + '\\b', 'g'), 'slot SS'); R(new RegExp('slot ' + v.tslot + '\\b', 'g'), 'slot TT');
  R(new RegExp('\\b(Attempt|Success|Failure|Lockout|Bypass|PartLoaded|FailureType|FailureMessage|Attempts|Successes|Failures|Efficiency|HMIColorStatus|FaultCount)' + v.M + '\\b', 'g'), '$1M');
  R(new RegExp('Side ' + v.M + '\\b', 'g'), 'SIDE'); R(new RegExp('side ' + v.M + '\\b', 'g'), 'SIDE'); R(new RegExp('[Ss]ide-' + v.M + '\\b', 'g'), 'SIDE-');
  R(new RegExp('\\b' + v.M + ' alarms', 'g'), 'M alarms');
  // Program names: the own name / twin name swap (Program Name, "Twin of ..."), while the literal pair
  // "\S07_PortCutA and \S07_PortCutB" (Chassis consumers) is identical prose in both twins - try both readings.
  if (swap) { R(/S07_PortCutA/g, 'PROG_A'); R(/S07_PortCutB/g, 'PROG_B'); R(new RegExp('PROG_' + v.M + '\\b', 'g'), 'SELF'); R(new RegExp('PROG_' + (v.M === 'A' ? 'B' : 'A') + '\\b', 'g'), 'TWIN'); }
  R(new RegExp(v.NEST, 'g'), 'NEST'); R(new RegExp(v.Nest, 'g'), 'Nest'); R(new RegExp('\\b' + v.nest + '\\b', 'g'), 'nest');
  R(/Value="\d+"/g, 'LEN');
  return s;
}
let differing = 0, bad = 0;
for (let i = 0; i < A.length; i++) {
  if (A[i] === B[i]) continue;
  differing++;
  const ok = norm(A[i], 'A', true) === norm(B[i], 'B', true) || norm(A[i], 'A', false) === norm(B[i], 'B', false);
  if (!ok) { bad++; console.log(`UNEXPLAINED line ${i + 1}\n  A: ${A[i]}\n  B: ${B[i]}`); }
}
console.log(JSON.stringify({ lines: A.length, differing, unexplained: bad }));
process.exit(bad ? 1 : 0);
