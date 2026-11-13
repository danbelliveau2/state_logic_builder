#!/usr/bin/env node
'use strict';
/**
 * twin1163_v013.cjs — 1163 v0.13: Jason's corrected copy of v0.12 (2026-11-13) is the lineage. His L2_S06_InsertRobot edits roll out
 * to L2_S07 / S08 / S09_InsertRobot; his R01 rung 0 on all four robots (NestNumIncoming from the station before this one) stays as he has it.
 *
 *   node scripts/twin1163_v013.cjs [--in <file.L5X>] [--out <file.L5X>] [--dump <dir>]      (default: the delivery, in place; --dump writes the three programs for shapeLint)
 *
 * S06 edits rolled out (every one proven by normalizing S07-S09 against S06 afterwards):
 *   tags      Work removed; AtHome added; AlarmTimerTubeNestOpenerExtended / Retracted 1 s; i_RobotStatus / q_RobotControl operand comments (Box 1 / 4 / 5, In 596-598)
 *   R01       "..., 5 home" comment; XIC(InsideBox5)OTE(AtHome) after AtInsert; Initialized on AtHome
 *   R02       state 7 on CycleStationA (not Work); states 106 / 112 on AtHome
 *   R03       the Work seal-in rung gone; Engaged / OverForce / judge rungs no longer gated on Work
 *   R20       Waiting For Part In Nest, the four result alarms no longer gated on Work
 */
const fs = require('fs');
const path = require('path');
const H = require('./lib/l5xBuild.cjs');
const { fail, must, rungList, rungText, setRungText, setRungComment, programBody, getRoutine, putRungs, tagXml, replaceTagIn, progRe, rep1, countOf } = H;

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const IN = argOf('in', 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X');
const OUT = argOf('out', IN);
const DUMP = argOf('dump', '');
const src = fs.readFileSync(IN, 'utf8');
let x = src;
const EOL = src.includes('\r\n') ? '\r\n' : '\n';

const REF = 'L2_S06_InsertRobot';
const ref = programBody(x, REF) || fail('no ' + REF);
const STATIONS = [{ sta: 7, pre: 4, cap: true }, { sta: 8, pre: 6, cap: false }, { sta: 9, pre: 7, cap: false }];
const S6 = { sta: 6, pre: 4, cap: true };
const prog = (c) => 'L2_S0' + c.sta + '_InsertRobot';

// ── the lineage check: this is Jason's S06 ───────────────────────────────────
const refRungs = (rn) => rungList(getRoutine(ref, rn) || fail(REF + '/' + rn));
const findRung = (rungs, pred, what) => { const i = rungs.findIndex(pred); must(i >= 0 && rungs.findIndex((r, j) => j > i && pred(r, j)) < 0, what + ': expected exactly one rung'); return i; };
must(!tagXml(ref, 'Work') && tagXml(ref, 'AtHome'), 'S06: Work gone, AtHome present');
const refAtHomeRung = refRungs('R01_Inputs')[findRung(refRungs('R01_Inputs'), (r) => rungText(r) === 'XIC(i_RobotStatus.InsideBox5)OTE(AtHome);', 'S06 AtHome rung')];
const refPosComment = ((refRungs('R01_Inputs')[findRung(refRungs('R01_Inputs'), (r) => rungText(r) === 'XIC(i_RobotStatus.InsideBox2)OTE(AtPick);', 'S06 AtPick rung')].match(/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || '').trim();
must(/5 home$/.test(refPosComment), 'S06 positions comment ends "5 home": ' + refPosComment);
must(rungText(refRungs('R01_Inputs')[0]) === '[MOVE(6,StaNum) MOVE(4,StaNumPre) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNumB,NestNumCurrent) MOVE(\\L2_Tracking.p_Data.Station[5].NestNumB,NestNumIncoming) ];', 'S06 rung 0 as Jason has it');
must(!/\bWork\b/.test(ref), 'S06 has no Work token left');
const stripComments = (t) => t.replace(/<Comment Operand="[^"]+">\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Comment>\s*/g, '').replace(/<Comments>\s*<\/Comments>\s*/g, '').replace(/\s+/g, ' ');
const refStatus = tagXml(ref, 'i_RobotStatus') || fail('S06 i_RobotStatus'), refControl = tagXml(ref, 'q_RobotControl') || fail('S06 q_RobotControl');
must(countOf(refStatus, 'Robot Safe For Index (Out 543)') === 1 && countOf(refStatus, 'Robot At Home Position (Out 547)') === 1 && countOf(refControl, 'Insert Stop, Over Force (In 598)') === 1, 'S06 robot tag comments as Jason wrote them');
const refTimer = (n) => { const t = tagXml(ref, n) || fail('S06 ' + n); must(t.includes('[0,1000,0]') && t.includes('Value="1000"'), 'S06 ' + n + ' 1 s'); return t; };
const refTimers = { AlarmTimerTubeNestOpenerExtended: refTimer('AlarmTimerTubeNestOpenerExtended'), AlarmTimerTubeNestOpenerRetracted: refTimer('AlarmTimerTubeNestOpenerRetracted') };
const refAtHomeTag = tagXml(ref, 'AtHome');

// ── one station ──────────────────────────────────────────────────────────────
const drop = (t, ins, what) => { must(countOf(t, ins) === 1, what + ': ' + ins + ' exactly once'); return t.replace(ins + ' ', '').replace(ins, '').replace(/\s{2,}/g, ' ').replace(/\(\s/g, '(').replace(/\s\)/g, ' )'); };
const swap = (t, from, to, what) => rep1(t, from, to, what);
const log = [];
for (const c of STATIONS) {
  const P = prog(c);
  let b = programBody(x, P) || fail('no ' + P);
  const before = b;
  must(rungText(rungList(getRoutine(b, 'R01_Inputs'))[0]) === '[MOVE(' + c.sta + ',StaNum) MOVE(' + c.pre + ',StaNumPre) ,MOVE(\\L2_Tracking.p_Data.Station[StaNum].NestNum' + (c.sta % 2 ? 'A' : 'B') + ',NestNumCurrent) MOVE(\\L2_Tracking.p_Data.Station[' + (c.sta - 1) + '].NestNum' + (c.sta % 2 ? 'A' : 'B') + ',NestNumIncoming) ];', P + ' rung 0 as Jason has it (kept)');
  // tags
  const work = tagXml(b, 'Work') || fail(P + ' Work tag');
  must(countOf(b, work + EOL) === 1, P + ' Work tag followed by EOL');
  b = b.replace(work + EOL, '');
  const atInsert = tagXml(b, 'AtInsert') || fail(P + ' AtInsert');
  must(!tagXml(b, 'AtHome'), P + ' AtHome absent before');
  b = rep1(b, atInsert, refAtHomeTag + EOL + atInsert, P + ' AtHome before AtInsert');
  for (const [n, t] of Object.entries(refTimers)) { const old = tagXml(b, n) || fail(P + ' ' + n); must(old.replace('[0,5000,0]', '[0,1000,0]').replace('Value="5000"', 'Value="1000"') === t, P + ' ' + n + ' differs from S06 beyond the preset'); b = replaceTagIn(b, n, t); }
  for (const [n, t] of [['i_RobotStatus', refStatus], ['q_RobotControl', refControl]]) { const old = tagXml(b, n) || fail(P + ' ' + n); must(stripComments(old) === stripComments(t), P + ' ' + n + ' differs from S06 beyond the comments'); b = replaceTagIn(b, n, t); }
  // R01
  b = putRungs(b, 'R01_Inputs', ((r) => {
    const i = findRung(r, (g) => rungText(g) === 'XIC(i_RobotStatus.InsideBox2)OTE(AtPick);', P + ' AtPick');
    must(/4 insert$/.test(((r[i].match(/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || '').trim()), P + ' positions comment');
    r[i] = setRungComment(r[i], refPosComment);
    const j = findRung(r, (g) => rungText(g) === 'XIC(i_RobotStatus.InsideBox4)OTE(AtInsert);', P + ' AtInsert');
    r.splice(j + 1, 0, refAtHomeRung);
    const k = findRung(r, (g) => /OTE\(Initialized\);$/.test(rungText(g)), P + ' Initialized');
    r[k] = setRungText(r[k], swap(rungText(r[k]), 'XIC(i_RobotStatus.InsideBox5)', 'XIC(AtHome)', P + ' Initialized'));
    return r;
  })(rungList(getRoutine(b, 'R01_Inputs'))));
  // R02
  b = putRungs(b, 'R02_StateTransitions', ((r) => {
    const s7 = findRung(r, (g) => rungText(g).includes('MOVE(7,Control.StateReg)'), P + ' state 7');
    r[s7] = setRungText(r[s7], swap(rungText(r[s7]), 'XIC(Work)', 'XIC(CycleStationA)', P + ' state 7'));
    const s106 = findRung(r, (g) => rungText(g).includes('MOVE(106,Control.StateReg)'), P + ' state 106');
    r[s106] = setRungText(r[s106], swap(rungText(r[s106]), 'XIO(i_RobotStatus.InsideBox5)', 'XIO(AtHome)', P + ' state 106'));
    const s112 = findRung(r, (g) => rungText(g).includes('MOVE(112,Control.StateReg)'), P + ' state 112');
    r[s112] = setRungText(r[s112], swap(rungText(r[s112]), 'XIC(i_RobotStatus.InsideBox5)', 'XIC(AtHome)', P + ' state 112'));
    return r;
  })(rungList(getRoutine(b, 'R02_StateTransitions'))));
  // R03
  b = putRungs(b, 'R03_StateLogic', ((r) => {
    const w = findRung(r, (g) => /OTE\(Work\);$/.test(rungText(g)), P + ' Work rung');
    r.splice(w, 1);
    for (const [pred, what] of [[(t) => /OTL\(Engaged\);$/.test(t), 'Engaged'], [(t) => /OTL\(OverForce\);$/.test(t), 'OverForce'], [(t) => t.includes('ONS(ONS.5)'), 'judge success'], [(t) => t.includes('ONS(ONS.6)'), 'judge failure']]) {
      const i = findRung(r, (g) => pred(rungText(g)), P + ' ' + what);
      r[i] = setRungText(r[i], drop(rungText(r[i]), 'XIC(Work)', P + ' ' + what));
    }
    return r;
  })(rungList(getRoutine(b, 'R03_StateLogic'))));
  // R20
  b = putRungs(b, 'R20_Alarms', ((r) => {
    const a1 = findRung(r, (g) => rungText(g).includes('MOVE(30000,Control.FaultTime)'), P + ' alarm 1');
    r[a1] = setRungText(r[a1], drop(rungText(r[a1]), 'XIO(Work)', P + ' alarm 1'));
    for (const n of [1, 2, 3, 4]) {
      const i = findRung(r, (g) => rungText(g).includes('FailureType,' + c.sta + n + ')'), P + ' result alarm ' + n);
      r[i] = setRungText(r[i], drop(rungText(r[i]), 'XIC(Work)', P + ' result alarm ' + n));
    }
    return r;
  })(rungList(getRoutine(b, 'R20_Alarms'))));
  must(!/\bWork\b/.test(b), P + ' no Work token left');
  must(countOf(b, 'OTE(AtHome)') === 1 && countOf(b, '(AtHome)') === 4, P + ' AtHome used four times');
  must(b !== before, P + ' changed');
  const m = progRe(P).exec(x);
  x = x.slice(0, m.index) + b + x.slice(m.index + m[0].length);
  log.push(P + ': Work gone, AtHome added, nest opener alarm timers 1 s, robot tag comments, ' + ['R01', 'R02', 'R03', 'R20'].join(' / ') + ' edited');
}

// ── proof 1: S07-S09 equal S06 once names, numbers, the nest side and the failure codes are normalized ──
const norm = (s, c) => {
  const ab = c.sta % 2 ? 'A' : 'B';
  let t = s.replace(/\s+/g, '');
  t = t.split('L2_S0' + c.sta + '_').join('L2_S0#_').split('L2S0' + c.sta).join('L2S0#');
  t = t.replace('MOVE(' + c.sta + ',StaNum)', 'MOVE(#,StaNum)').replace('MOVE(' + c.pre + ',StaNumPre)', 'MOVE(#,StaNumPre)');
  t = t.replace(/(NestNum|Lockout|DryRun|SingleStep|SingleCycle|SingleTrigger|SingleDisableTracking|SingleClearTracking|Attempts|Successes|Failures|Efficiency|HMIColorStatus)[AB]\b/g, '$1#');
  t = t.replace('Station[' + (c.sta - 1) + '].NestNum#,NestNumIncoming', 'Station[#].NestNum#,NestNumIncoming');
  t = t.replace(new RegExp('(MOVE\\(|FailureType,)' + c.sta + '([1-4])(?=[,)])', 'g'), '$1#$2');
  if (c.cap) t = t.split('[XIC(\\L2_Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[16].Success),XIC(\\L2_Tracking.p_Data.Nest[NestNumCurrent].PartStatus.Station[16].Lockout)]').join('').replace('andthesoftcaprecord', '');
  return t;
};
const refN = norm(programBody(x, REF), S6);
for (const c of STATIONS) {
  const n = norm(programBody(x, prog(c)), c);
  if (n !== refN) { let i = 0; while (i < n.length && n[i] === refN[i]) i++; fail(prog(c) + ' differs from S06 beyond names and points at ' + i + ':\n  S06: ' + refN.slice(Math.max(0, i - 120), i + 160) + '\n  S0' + c.sta + ': ' + n.slice(Math.max(0, i - 120), i + 160)); }
}
log.push('proof: S07 / S08 / S09 InsertRobot identical to Jason\'s S06 except names, station numbers, nest side and failure codes');

// ── proof 2: nothing else moved ──────────────────────────────────────────────
{
  const names = [...src.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
  const edited = new Set(STATIONS.map(prog));
  for (const n of names) if (!edited.has(n)) must(programBody(x, n) === programBody(src, n), 'program changed: ' + n);
  const outside = (s) => s.slice(0, s.indexOf('<Programs>')) + s.slice(s.indexOf('</Programs>'));
  must(outside(x) === outside(src), 'something outside <Programs> changed');
  log.push('untouched: ' + (names.length - edited.size) + ' programs and everything outside <Programs> byte-identical to the input');
}

fs.writeFileSync(OUT, x);
if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); for (const c of STATIONS) fs.writeFileSync(path.join(DUMP, prog(c) + '.xml'), programBody(x, prog(c))); }
console.log('written ' + OUT + ' (' + x.length + ' chars)');
for (const l of log) console.log('  - ' + l);
