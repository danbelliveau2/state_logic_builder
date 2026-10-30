#!/usr/bin/env node
'use strict';
/**
 * revise1163EA_v05.cjs — 1163 v0.5 (Jason, 2026-10-30): applied to his export of v0.4.5 (HSC mapped as Local:6, MAM.PC / MAJ.IP exits).
 *
 *   node scripts/revise1163EA_v05.cjs [--src <L5X>] [--out <L5X>]
 *
 *   Both TubeFeed programs (Upstream / Downstream are mirror images):
 *   1. Tube load block, one action per state: 49 extend inserter (InserterExtended) -> 52 open the active gripper
 *      (ActiveGripperOpened) -> 55 jog until the tube reaches the encoder wheel (MAJ.IP, TubeInDrive) -> 58 stop the drive
 *      (MAJ.IP off) -> 61 prime (MAM.PC) -> 19. Was: 49 extend + jog, 52 stop + open, 55 prime.
 *   2. The active gripper opens when the inserter is extended on it (was: when the air spring sensor was made).
 *   3. Selector verified before the sequence starts: SelectorAtActiveTube (sensors agree with q_ActiveTubeB) gates 4 -> 7;
 *      alarm 'Selector Not At Active Tube' when it does not within the state 4 timeout.
 *   4. Alarms 19 'Waiting For Inserter To Extend' (timer), 20 'Waiting For Gripper To Open' (state 52), 21 selector (state 4);
 *      Alarm / AlarmList grow 20 -> 24.
 *   5. q_FeedIdle, R04 jog / stop / prime states and the alarm states follow the new numbers.
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SRC = flag('src', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/_history/1163_Haemonetics_v0.4.5_returned_2026-10-30.L5X');
const OUT = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X');
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const must = (c, m) => { if (!c) fail(m); };
const log = [];
let x = fs.readFileSync(SRC, 'utf8');
must(/EndPoint2="Local:6:O\.ResetCounter\.0"/.test(x) && /TransmissionRatioInput="200"/.test(x), 'source is not the 0.4.5 export (Local:6 HSC, 200:15 axes)');

// ── helpers ──
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, p, q) => p + (n++) + q); };
const progRe = (name) => new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>');
function programBody(name) { const m = progRe(name).exec(x); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = progRe(name).exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) { const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)'); must(re.test(body), 'routine not found: ' + rn); return body.replace(re, (m, p, inner, q) => p + '\n' + renumber(rungs.join('\n')) + '\n' + q); }
function editRoutine(prog, rn, fn) { let b = programBody(prog) || fail('no program ' + prog); b = putRungs(b, rn, fn(rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)))); replaceProgram(prog, b); }
function tagXml(body, name) { return (new RegExp('<Tag Name="' + name + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(body) || [''])[0]; }
const insertBefore = (hay, marker, text, what) => { const i = hay.indexOf(marker); must(i >= 0, 'marker not found: ' + what); return hay.slice(0, i) + text + hay.slice(i); };
const pad00 = (n) => '$00'.repeat(n);
const NL = x.includes('\r\n') ? '\r\n' : '\n'; // Studio exports are CRLF
// edit one rung in a list: find by predicate (unique), rewrite comment and/or text
function edit(rungs, prog, pred, what, { comment, text }) {
  const hits = rungs.map((r, i) => (pred(rungText(r), r) ? i : -1)).filter((i) => i >= 0);
  must(hits.length === 1, prog + ': ' + what + ' matched ' + hits.length + ' rungs');
  let r = rungs[hits[0]];
  if (comment !== undefined) {
    const nr = /<Comment>/.test(r) ? r.replace(/<Comment>\r?\n<!\[CDATA\[[\s\S]*?\]\]>\r?\n<\/Comment>/, '<Comment>\n<![CDATA[' + comment + ']]>\n</Comment>') : r.replace('<Text>', '<Comment>\n<![CDATA[' + comment + ']]>\n</Comment>\n<Text>');
    must(nr !== r, prog + ': ' + what + ' comment not replaced'); r = nr;
  }
  if (text !== undefined) {
    const nr = r.replace(/<Text>\r?\n<!\[CDATA\[[\s\S]*?\]\]>\r?\n<\/Text>/, '<Text>\n<![CDATA[' + (typeof text === 'function' ? text(rungText(rungs[hits[0]])) : text) + ']]>\n</Text>');
    must(nr !== r, prog + ': ' + what + ' text not replaced'); r = nr;
  }
  rungs[hits[0]] = r;
  return hits[0];
}
const sub = (from, to) => (t) => { must(t.includes(from), 'rung text lacks "' + from + '": ' + t); return t.split(from).join(to); };

const STATION = 'L2S01 Tube Load: ';
const NEW_ALARMS = [[19, 'Waiting For Inserter To Extend'], [20, 'Waiting For Gripper To Open'], [21, 'Selector Not At Active Tube']];
const DIM_OLD = 20, DIM_NEW = 24;

for (const side of ['Upstream', 'Downstream']) {
  const prog = 'L2_S01_TubeFeed' + side;
  let b = programBody(prog) || fail('no program ' + prog);

  // ═══ tags ═══
  // AlarmTimerInserterExtended: same form as the retract timer
  const tRet = tagXml(b, 'AlarmTimerInserterRetracted'); must(tRet, prog + ' AlarmTimerInserterRetracted');
  must(!tagXml(b, 'AlarmTimerInserterExtended'), prog + ' AlarmTimerInserterExtended already present');
  b = insertBefore(b, tRet, tRet.replace('AlarmTimerInserterRetracted', 'AlarmTimerInserterExtended') + '\n', prog + ' timer insert');
  // SelectorAtActiveTube: same form as SelectorExtended
  const tSel = tagXml(b, 'SelectorExtended'); must(tSel, prog + ' SelectorExtended');
  must(!tagXml(b, 'SelectorAtActiveTube'), prog + ' SelectorAtActiveTube already present');
  b = insertBefore(b, tSel, tSel.replace('"SelectorExtended"', '"SelectorAtActiveTube"') + '\n', prog + ' selector tag insert');

  // Alarm: AlarmData[20] -> [24], fill [19..21]
  {
    const old = tagXml(b, 'Alarm'); must(old && / Dimensions="20"/.test(old), prog + ' Alarm[20]');
    let t = old.replace(/ Dimensions="20"/g, ' Dimensions="24"');
    const emptyL5k = "[0,0,0,0,[0,'" + pad00(100) + "'" + NL + "\t\t],0,0,0,0]";
    must(t.split(emptyL5k).length === 2, prog + ' Alarm L5K has one empty element');
    const l5k = (msg) => { const s = STATION + msg; return "[0,0,0,0,[" + s.length + ",'" + s + pad00(100 - s.length) + "'" + NL + "\t\t],0,0,0,0]"; };
    t = t.replace(emptyL5k, NEW_ALARMS.map(([, m]) => l5k(m)).concat([emptyL5k, emptyL5k]).join(','));
    const e19 = /<Element Index="\[19\]">[\s\S]*?<\/Element>/.exec(t) || fail(prog + ' Alarm element [19]');
    const emptyLen = '<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="0"/>' + NL + '<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII">' + NL + '<![CDATA[]]>';
    must(e19[0].includes(emptyLen), prog + ' Alarm [19] is empty');
    const dec = (i, msg) => { const s = STATION + msg; return e19[0].replace('Index="[19]"', 'Index="[' + i + ']"').replace(emptyLen, '<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="' + s.length + '"/>' + NL + '<DataValueMember Name="DATA" DataType="STRING100" Radix="ASCII">' + NL + '<![CDATA[\'' + s + '\']]>'); };
    t = t.replace(e19[0], NEW_ALARMS.map(([i, m]) => dec(i, m)).concat([22, 23].map((i) => e19[0].replace('Index="[19]"', 'Index="[' + i + ']"'))).join(NL));
    b = b.replace(old, t);
  }
  // AlarmList: STRING[20] -> [24]
  {
    const old = tagXml(b, 'AlarmList'); must(old && / Dimensions="20"/.test(old), prog + ' AlarmList[20]');
    let t = old.replace(/ Dimensions="20"/g, ' Dimensions="24"');
    const emptyL5k = "[0,'" + pad00(82) + "'" + NL + "\t\t]";
    must(t.split(emptyL5k).length === 2, prog + ' AlarmList L5K has one empty element');
    t = t.replace(emptyL5k, NEW_ALARMS.map(([, m]) => "[" + m.length + ",'" + m + pad00(82 - m.length) + "'" + NL + "\t\t]").concat([emptyL5k, emptyL5k]).join(','));
    const e19 = /<Element Index="\[19\]">[\s\S]*?<\/Element>/.exec(t) || fail(prog + ' AlarmList element [19]');
    must(e19[0].includes('<![CDATA[]]>'), prog + ' AlarmList [19] is empty');
    const dec = (i, msg) => e19[0].replace('Index="[19]"', 'Index="[' + i + ']"').replace('Radix="Decimal" Value="0"/>', 'Radix="Decimal" Value="' + msg.length + '"/>').replace('<![CDATA[]]>', '<![CDATA[\'' + msg + '\']]>');
    t = t.replace(e19[0], NEW_ALARMS.map(([i, m]) => dec(i, m)).concat([22, 23].map((i) => e19[0].replace('Index="[19]"', 'Index="[' + i + ']"'))).join(NL));
    b = b.replace(old, t);
  }
  replaceProgram(prog, b);

  // ═══ R01: selector verified against the active tube ═══
  editRoutine(prog, 'R01_Inputs', (rungs) => {
    const i = edit(rungs, prog, (t) => t.endsWith('OTE(SelectorRetracted);'), 'SelectorRetracted rung', {});
    rungs.splice(i + 1, 0, newRung('Selector at the staging position of the active tube', '[XIO(q_ActiveTubeB) XIC(i_SelectorRetracted) XIO(i_SelectorExtended) ,XIC(q_ActiveTubeB) XIC(i_SelectorExtended) XIO(i_SelectorRetracted) ]OTE(SelectorAtActiveTube);'));
    return rungs;
  });

  // ═══ R02: tube load block re-sequenced, selector gate on state 7 ═══
  editRoutine(prog, 'R02_StateTransitions', (rungs) => {
    edit(rungs, prog, (t) => t.includes('MOVE(7,Control.StateReg)'), 'state 7', {
      comment: 'State 7: Selector at the active tube and tube in the drive, reset the payout encoder',
      text: sub('XIC(StagingEmpty)XIC(TubeInDrive)', 'XIC(StagingEmpty)XIC(SelectorAtActiveTube)XIC(TubeInDrive)'),
    });
    edit(rungs, prog, (t) => t.includes('MOVE(19,Control.StateReg)'), 'state 19', { text: sub('XIC(Status.State[55]) XIC(FeedAxis_MAM.PC)', 'XIC(Status.State[61]) XIC(FeedAxis_MAM.PC)') });
    edit(rungs, prog, (t) => t.includes('MOVE(49,Control.StateReg)'), 'state 49', { comment: 'State 49: Extend the inserter' });
    edit(rungs, prog, (t) => t.includes('MOVE(52,Control.StateReg)'), 'state 52', {
      comment: 'State 52: Open the active gripper',
      text: 'XIC(Status.State[49])XIC(InserterExtended)XIC(SS_OK)MOVE(52,Control.StateReg);',
    });
    const i55 = edit(rungs, prog, (t) => t.includes('MOVE(55,Control.StateReg)'), 'state 55', {
      comment: 'State 55: Jog the drive until the tube reaches the encoder wheel',
      text: 'XIC(Status.State[52])XIC(ActiveGripperOpened)XIC(SS_OK)MOVE(55,Control.StateReg);',
    });
    rungs.splice(i55 + 1, 0,
      newRung('State 58: Stop the drive, tube at the encoder wheel', 'XIC(Status.State[55])XIC(FeedAxisAuto_MAJ.IP)XIC(TubeInDrive)MOVE(58,Control.StateReg);'),
      newRung('State 61: Prime feed past the cutter', 'XIC(Status.State[58])XIO(FeedAxisAuto_MAJ.IP)XIC(SS_OK)MOVE(61,Control.StateReg)OTL(PrimeCycle);'));
    return rungs;
  });

  // ═══ R03: feed idle states, grippers follow the inserter ═══
  editRoutine(prog, 'R03_StateLogic', (rungs) => {
    edit(rungs, prog, (t) => t.endsWith('OTE(q_FeedIdle);'), 'q_FeedIdle', { text: sub('XIO(Status.State[40])XIO(Status.State[49])XIO(Status.State[55])', 'XIO(Status.State[40])XIO(Status.State[55])XIO(Status.State[58])XIO(Status.State[61])') });
    edit(rungs, prog, (t) => t.endsWith('OTE(q_CloseTubeAGripper);'), 'close A', { comment: 'Tube A Gripper Control: closed at staging, open once the inserter is extended on it', text: sub('[XIC(q_ActiveTubeB) ,XIO(i_TubeAInDrive) ]', '[XIC(q_ActiveTubeB) ,XIO(InserterExtended) ]') });
    edit(rungs, prog, (t) => t.endsWith('OTE(q_OpenTubeAGripper);'), 'open A', { text: sub('XIO(q_ActiveTubeB) XIC(i_TubeAInDrive) ]', 'XIO(q_ActiveTubeB) XIC(InserterExtended) ]') });
    edit(rungs, prog, (t) => t.endsWith('OTE(q_CloseTubeBGripper);'), 'close B', { text: sub('[XIO(q_ActiveTubeB) ,XIO(i_TubeBInDrive) ]', '[XIO(q_ActiveTubeB) ,XIO(InserterExtended) ]') });
    edit(rungs, prog, (t) => t.endsWith('OTE(q_OpenTubeBGripper);'), 'open B', { text: sub('XIC(q_ActiveTubeB) XIC(i_TubeBInDrive) ]', 'XIC(q_ActiveTubeB) XIC(InserterExtended) ]') });
    return rungs;
  });

  // ═══ R04: jog in 55, stop in 58, prime in 61 ═══
  editRoutine(prog, 'R04_FeedAxisServo', (rungs) => {
    edit(rungs, prog, (t) => t.includes('MOVE(HMI_PrimeLength,FeedAxisMotionParameters.Position)'), 'auto parameters', { text: sub('XIC(Status.State[55]) MOVE(HMI_PrimeLength', 'XIC(Status.State[61]) MOVE(HMI_PrimeLength') });
    edit(rungs, prog, (t) => t.includes('MAM(iq_FeedAxis,FeedAxis_MAM,'), 'MAM', { text: sub(',XIC(Status.State[55]) ]', ',XIC(Status.State[61]) ]') });
    edit(rungs, prog, (t) => t.includes('MAJ(iq_FeedAxis,FeedAxisAuto_MAJ,'), 'auto MAJ', { comment: 'Auto Jog Axis: pull the tube to the encoder wheel after inserting', text: sub('XIC(Status.State[49])', 'XIC(Status.State[55])') });
    edit(rungs, prog, (t) => t.includes('MAS(iq_FeedAxis,FeedAxisAuto_MAS,'), 'auto MAS', { text: sub('XIC(Status.State[52])', 'XIC(Status.State[58])') });
    return rungs;
  });

  // ═══ R20: alarm states + three new alarms ═══
  editRoutine(prog, 'R20_Alarms', (rungs) => {
    edit(rungs, prog, (t) => t.includes('AlarmList[8]'), 'alarm 8', { text: sub('XIC(Status.State[49])', 'XIC(Status.State[55])') });
    edit(rungs, prog, (t) => t.includes('AlarmList[13]'), 'alarm 13', { text: sub('XIC(Status.State[55])', 'XIC(Status.State[61])') });
    edit(rungs, prog, (t) => t.includes('AlarmList[14]'), 'alarm 14', { text: sub('XIC(Status.State[52])', 'XIC(Status.State[58])') });
    const i7 = edit(rungs, prog, (t) => t.includes('AlarmList[7]'), 'alarm 7', {});
    rungs.splice(i7 + 1, 0, newRung('Waiting For Inserter To Extend', '[XIO(Lockout) XIC(q_ExtendInserter) XIO(InserterExtended) TON(AlarmTimerInserterExtended,?,?) XIC(AlarmTimerInserterExtended.DN) ,XIC(Alarm[19].Active) XIO(FaultReset) ][OTE(Alarm[19].Active) ,ONS(ONS.27) CONCAT(g_StationList[StaNum],AlarmList[19],Alarm[19].Message) ];'));
    const i14 = edit(rungs, prog, (t) => t.includes('AlarmList[14]'), 'alarm 14 (again)', {});
    rungs.splice(i14 + 1, 0, newRung('Waiting For Gripper To Open', '[XIC(Status.State[52]) MOVE(3000,Control.FaultTime) XIC(Status.TimeoutFlt) ,XIC(Alarm[20].Active) XIO(FaultReset) ][OTE(Alarm[20].Active) ,ONS(ONS.28) CONCAT(g_StationList[StaNum],AlarmList[20],Alarm[20].Message) ];'));
    const i18 = edit(rungs, prog, (t) => t.includes('AlarmList[18]'), 'alarm 18', {});
    rungs.splice(i18 + 1, 0, newRung('Selector Not At Active Tube', 'XIC(Status.State[4])MOVE(10000,Control.FaultTime)XIC(Status.TimeoutFlt)XIO(SelectorAtActiveTube)[OTE(Alarm[21].Active) ,ONS(ONS.29) CONCAT(g_StationList[StaNum],AlarmList[21],Alarm[21].Message) ];'));
    return rungs;
  });

  // ═══ checks ═══
  b = programBody(prog);
  for (const s of ['ONS.27', 'ONS.28', 'ONS.29']) must(b.split('ONS(' + s + ')').length === 2, prog + ' ' + s + ' used once');
  must(!/i_Tube[AB]InDrive\)[^;]*OTE\(q_(Open|Close)Tube/.test(b), prog + ' grippers no longer keyed on the air spring');
  for (const n of [49, 52, 55, 58, 61]) must(b.includes('MOVE(' + n + ',Control.StateReg)'), prog + ' state ' + n + ' present');
  must(/Dimensions="24"[\s\S]*Dimensions="24"/.test(tagXml(b, 'Alarm')) && / Dimensions="24"/.test(tagXml(b, 'AlarmList')), prog + ' alarm arrays 24');
  log.push(prog + ': states 49 extend / 52 open gripper / 55 jog / 58 stop / 61 prime; SelectorAtActiveTube gates state 7; alarms 19-21; grippers follow the inserter');
}

// ═══ write ═══
const d = new Date();
x = x.replace(/ExportDate="[^"]*"/, 'ExportDate="' + d.toDateString().replace(/ \d{4}$/, '') + ' ' + d.toTimeString().slice(0, 8) + ' ' + d.getFullYear() + '"');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, x);
console.log('wrote ' + OUT + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);
