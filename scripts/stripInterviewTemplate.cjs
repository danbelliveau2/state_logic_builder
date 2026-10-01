#!/usr/bin/env node
'use strict';
/**
 * stripInterviewTemplate.cjs - the CE interview test file (Jason, 2026-10-01).
 *
 * Reads Templates\SoftwareStandardizationNew.L5X (never written) and produces a stripped copy:
 *   keep     MapInputs, Supervisor, Tracking, StateMachine, S00_IndexerSP, Production, Alarms, HMI,
 *            MapOutputs, SafetyProgram
 *   remove   every other program, its ParameterConnections, its schedule entry, the AOIs / UDTs
 *            only it used, the motion group and every axis, every EtherNet/IP module and its
 *            buffer tags
 *   bare     the kept programs' polls of the removed stations are stripped to what remains
 *            (S00_IndexerSP) or to the template's own AlwaysOff placeholder - the candidate wires
 *            their station in
 *   latest   StateMachine R01_Inputs takes the single-step block the template's own stations
 *            carry (AutoIdle, Lockout / DryRun / SingleStep off Station[StaNum].OpStatus,
 *            SingleCycle, SS_OK with p_OnStation) in place of the HMI_Toggle form
 *   safety   SafetyProgram stays, minus the rungs that read hardware no longer in the file; Zone 2
 *            and the air dump valve lived only on the 1734 rack and go with it
 *            (--keep-safety-rack keeps that rack - the one EtherNet/IP exception - and all of Zone 2)
 *
 *   node scripts/stripInterviewTemplate.cjs --out "<dir>" [--name SoftwareStandardization_CETest] [--keep-safety-rack]
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);
const SRC = flag('src', 'X:/Electrical Dept/SDC Engineer/Templates/SoftwareStandardizationNew.L5X');
const OUT_DIR = flag('out', 'X:/Electrical Dept/SDC Engineer/Deliveries/CE Interview Test');
const NAME = flag('name', 'SoftwareStandardization_CETest');
const KEEP_SAFETY_RACK = has('keep-safety-rack');                          // keep the 1734 rack Zone 2 lives on
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const log = [];

const KEEP = new Set(['MapInputs', 'Supervisor', 'Tracking', 'StateMachine', 'S00_IndexerSP', 'Production', 'Alarms', 'HMI', 'MapOutputs', 'SafetyProgram']);
const KEEP_MODULES = new Set(['Local', 'SIN1', 'SOUT1']);                 // the controller and its local safety cards
if (KEEP_SAFETY_RACK) for (const n of ['io01_MainMachine', 'io01_SIN2', 'io1_SOUT2']) KEEP_MODULES.add(n);
// AOIs / UDTs the two target station types need, kept even though no kept program uses them
const KEEP_TYPES_FOR_CANDIDATE = new Set(['AOI_Debounce', 'StationPerformance']);

let x = fs.readFileSync(SRC, 'utf8');
const original = x;

// ── helpers ─────────────────────────────────────────────────────────────────
const cdataOf = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : ''; };
const rungList = (body) => [...body.matchAll(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/g)].map((m) => m[0]);
const rungText = (r) => cdataOf((/<Text>([\s\S]*?)<\/Text>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const rungComment = (r) => cdataOf((/<Comment>([\s\S]*?)<\/Comment>/.exec(r) || [])[1]).replace(/\s+/g, ' ').trim();
const setRungText = (r, t) => r.replace(/(<Text>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Text>)/, (m, a, b) => a + t + b);
const setRungComment = (r, c) => /<Comment>/.test(r) ? r.replace(/(<Comment>\s*<!\[CDATA\[)[\s\S]*?(\]\]>\s*<\/Comment>)/, (m, a, b) => a + c + b) : r.replace(/(<Rung\b[^>]*>)/, '$1\n<Comment>\n<![CDATA[' + c + ']]>\n</Comment>');
const newRung = (c, t) => '<Rung Number="0" Type="N">\n' + (c ? '<Comment>\n<![CDATA[' + c + ']]>\n</Comment>\n' : '') + '<Text>\n<![CDATA[' + t + ']]>\n</Text>\n</Rung>';
const renumber = (body) => { let n = 0; return body.replace(/(<Rung\b[^>]*\bNumber=")\d+(")/g, (m, a, b) => a + (n++) + b); };
function programBody(name) { const m = new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>').exec(x); return m ? m[0] : null; }
function replaceProgram(name, body) { const m = new RegExp('<Program\\b[^>]*?\\sName="' + name + '"[\\s\\S]*?</Program>').exec(x); if (!m) fail('program not found: ' + name); x = x.slice(0, m.index) + body + x.slice(m.index + m[0].length); }
function getRoutine(body, rn) { const m = new RegExp('<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>([\\s\\S]*?)</RLLContent>').exec(body); return m ? m[1] : null; }
function putRungs(body, rn, rungs) {
  const re = new RegExp('(<Routine\\b[^>]*\\bName="' + rn + '"[\\s\\S]*?<RLLContent>)([\\s\\S]*?)(</RLLContent>)');
  if (!re.test(body)) fail('routine not found: ' + rn);
  return body.replace(re, (m, a, inner, c) => a + '\n' + renumber(rungs.join('\n')) + '\n' + c);
}
function editRoutine(prog, rn, fn) { let b = programBody(prog) || fail('no program ' + prog); const rungs = rungList(getRoutine(b, rn) || fail('no routine ' + prog + '/' + rn)); b = putRungs(b, rn, fn(rungs)); replaceProgram(prog, b); }
function dropTagIn(body, name) {
  const open = new RegExp('<Tag Name="' + name + '"[^>]*?(/?)>').exec(body);
  if (!open) return body;
  if (open[1] === '/') return body.replace(open[0], '');
  return body.replace(new RegExp('<Tag Name="' + name + '"[^>]*>[\\s\\S]*?</Tag>\\s*'), '');
}
/** Remove whole series terms of the form XIC(\Prog.tag) / XIO(\Prog.tag) for removed programs,
 *  and branch legs that are left with nothing but a removed-program term. Returns the new text and
 *  whether anything is left before the output. */
const REMOVED_PROGS = [];
const AOFF = 'XIC(g_MachineBasic.AlwaysOff)', AON = 'XIC(g_MachineBasic.AlwaysOn)';
function stripRemovedTerms(text) {
  const progAlt = REMOVED_PROGS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const termRe = new RegExp('(?:XIC|XIO)\\(\\\\(?:' + progAlt + ')\\.[A-Za-z0-9_.\\[\\]]+\\)', 'g');
  const termOne = new RegExp(termRe.source);
  // 1. innermost branches (they contain instructions, so a "(" - array subscripts never do):
  //    drop every leg that names a removed program; one leg left -> inline it; none -> AlwaysOff
  let t = text;
  for (let guard = 0; guard < 8; guard++) {
    const next = t.replace(/\[([^\[\]]*)\]/g, (m, inner) => {
      if (!inner.includes('(')) return m;                                   // array subscript
      const legs = inner.split(/\s,\s*/).map((l) => l.trim()).filter((l) => l.length);
      const kept = legs.filter((l) => !termOne.test(l));
      if (kept.length === legs.length) return m;
      if (kept.length === 0) return AOFF;
      if (kept.length === 1) return kept[0];
      return '[' + kept.join(' ,') + ' ]';
    });
    if (next === t) break;
    t = next;
  }
  // 2. series terms naming a removed program
  t = t.replace(termRe, ' ');
  return t.replace(/\s+/g, ' ').replace(/\s*;\s*$/, ';').trim();
}

// ═══ 1. programs ════════════════════════════════════════════════════════════
const allProgs = [...x.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]);
for (const p of allProgs) if (!KEEP.has(p)) REMOVED_PROGS.push(p);
for (const p of REMOVED_PROGS) {
  const m = new RegExp('<Program\\b[^>]*?\\sName="' + p + '"[\\s\\S]*?</Program>\\s*').exec(x);
  if (!m) fail('program vanished: ' + p);
  x = x.slice(0, m.index) + x.slice(m.index + m[0].length);
}
log.push('programs removed (' + REMOVED_PROGS.length + '): ' + REMOVED_PROGS.join(', '));
// schedule
for (const p of REMOVED_PROGS) x = x.replace(new RegExp('\\s*<ScheduledProgram Name="' + p + '"\\s*/>'), '');
// parameter connections naming a removed program
{
  const before = (x.match(/<ParameterConnection/g) || []).length;
  x = x.replace(/<ParameterConnection[^>]*>\s*/g, (m) => (REMOVED_PROGS.some((p) => m.includes('\\' + p + '.')) ? '' : m));
  log.push('parameter connections: ' + before + ' -> ' + (x.match(/<ParameterConnection/g) || []).length);
}

// ═══ 2. hardware: motion group, axes, EtherNet/IP modules ═══════════════════
const modules = [...x.matchAll(/<Module\b[^>]*\bName="([^"]+)"[^>]*\bCatalogNumber="([^"]+)"[\s\S]*?<\/Module>/g)].map((m) => ({ name: m[1], cat: m[2], xml: m[0] }));
const removedModules = modules.filter((m) => !KEEP_MODULES.has(m.name));
for (const m of removedModules) x = x.replace(m.xml, '');
x = x.replace(/<Module\b[^>]*\bName="([^"]+)"[^>]*\/>\s*/g, (m, n) => (KEEP_MODULES.has(n) ? m : ''));
log.push('modules removed (' + removedModules.length + '): ' + removedModules.map((m) => m.name + ' ' + m.cat).join(', '));
const ctlEnd = () => x.indexOf('<Programs>');
// controller-scope tags: axes, motion group, buffers of removed modules, data of removed programs
const removedModNames = removedModules.map((m) => m.name);
const ctlTagRe = /<Tag Name="([^"]+)"([^>]*?)(?:\/>|>[\s\S]*?<\/Tag>)\s*/g;
const removedCtlTags = [];
{
  const head = x.slice(0, ctlEnd()), tail = x.slice(ctlEnd());
  const newHead = head.replace(ctlTagRe, (m, name, attrs) => {
    const dt = (/DataType="([^"]+)"/.exec(attrs) || [])[1] || '';
    const byModule = removedModNames.some((mn) => name.startsWith(mn));
    const byAxis = /^(AXIS_CIP_DRIVE|AXIS_VIRTUAL|MOTION_GROUP)$/.test(dt);
    const byModuleType = /^(CC:|AB:|FANUC:)/.test(dt) && !/^(Local|SIN1|SOUT1)/.test(name) && !/5069/.test(dt);
    const byRecipe = /^Recipe/.test(name) || /^(Recipe_|STRING30$)/.test(dt);
    const byFanuc = /Fanuc|Robot|POSREG|ROBOT_/.test(dt) || /^rob0/.test(name);
    const byLenze = /Lenze/.test(dt) || /^fd0/.test(name);
    if (byModule || byAxis || byModuleType || byRecipe || byFanuc || byLenze) { removedCtlTags.push(name + ':' + dt); return ''; }
    return m;
  });
  x = newHead + tail;
}
log.push('controller tags removed (' + removedCtlTags.length + '): ' + removedCtlTags.join(', '));
// ParameterConnections that name a removed module or axis
x = x.replace(/<ParameterConnection[^>]*>\s*/g, (m) => (removedModNames.some((n) => m.includes(n + ':') || m.includes(n + '_')) || /\ba0\d_/.test(m) ? '' : m));

// ═══ 3. bare the kept programs ══════════════════════════════════════════════
const remRe = new RegExp('\\\\(' + REMOVED_PROGS.join('|') + ')\\.');
// Supervisor polls: strip removed terms; the Indexer stays in them
for (const rn of ['R01_Inputs']) editRoutine('Supervisor', rn, (rungs) => rungs.map((r) => {
  const t = rungText(r); if (!remRe.test(t)) return r;
  let nt = stripRemovedTerms(t);
  if (/^OTE\(/.test(nt) || /^\s*OTE/.test(nt)) nt = AOFF + nt;          // nothing left in series
  return setRungText(r, nt);
}));
// Supervisor EIP monitor: no EtherNet/IP nodes remain
editRoutine('Supervisor', 'R15_EIPMonitor', (rungs) => rungs.map((r) => (/GE\(EIPStatusCount,/.test(rungText(r)) ? setRungComment(setRungText(r, 'GE(EIPStatusCount,1)MOVE(0,EIPStatusCount);'), 'Wrap the node counter after the last EIP node - none in this file; set to your node count') : r)));
editRoutine('Supervisor', 'R20_Alarms', (rungs) => rungs.filter((r) => !/AOI_EIPStatus\(/.test(rungText(r))));
{ let b = programBody('Supervisor'); for (const m of removedModNames) b = dropTagIn(b, m + 'EIP'); replaceProgram('Supervisor', b); }
// Indexer polls and per-station complete times
editRoutine('S00_IndexerSP', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r); if (!remRe.test(t)) return r;
  let nt = stripRemovedTerms(t);
  if (/^\s*OTE/.test(nt)) nt = AON + nt;                                   // "all stations complete / safe" with no stations
  return setRungComment(setRungText(r, nt), rungComment(r) + ' - add your station');
}));
editRoutine('S00_IndexerSP', 'R03_StateLogic', (rungs) => rungs.filter((r) => !(remRe.test(rungText(r)) && /StationCompleteTimes\[/.test(rungText(r)))));
// no motion group in the file: the axis-ready rungs lose the GroupSynced term (the Indexer's axes
// are InOut parameters with nothing to connect to - reported below)
for (const rn of ['R04_IndexerServo', 'R05_ShotPinServo']) editRoutine('S00_IndexerSP', rn, (rungs) => rungs.map((r) => (/MotionGroup\./.test(rungText(r)) ? setRungText(r, rungText(r).replace(/XI[CO]\(MotionGroup\.[A-Za-z0-9_]+\)/g, '').trim()) : r)));
editRoutine('S00_IndexerSP', 'R20_Alarms', (rungs) => rungs.map((r) => (remRe.test(rungText(r)) ? setRungText(r, stripRemovedTerms(rungText(r))) : r)));
// Alarms roll-up
editRoutine('Alarms', 'R01_Logic', (rungs) => rungs.map((r) => (remRe.test(rungText(r)) ? setRungText(r, stripRemovedTerms(rungText(r))) : r)));
// Tracking and Production: the template's own placeholder form, as their comments say
for (const [prog, rn] of [['Tracking', 'R01_Inputs'], ['Production', 'R01_ProductionData'], ['Production', 'R02_ShiftData']]) {
  editRoutine(prog, rn, (rungs) => rungs.map((r) => {
    const t = rungText(r); if (!remRe.test(t)) return r;
    let nt = t.replace(new RegExp('XIC\\(\\\\(' + REMOVED_PROGS.join('|') + ')\\.[A-Za-z0-9_]+\\)', 'g'), AOFF);
    nt = nt.replace(/\\Tracking\.p_Data\.Station\[1[89]\]\.NestNum/g, '\\Tracking.p_Data.Station[StaNumReject].NestNum');
    return setRungText(r, nt);
  }));
}
if (/StaNumReject/.test(programBody('Production'))) {
  let b = programBody('Production');
  if (!/<Tag Name="StaNumReject"/.test(b)) b = b.replace(/<\/Tags>/, '<Tag Name="StaNumReject" TagType="Base" DataType="DINT" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">\n<Description>\n<![CDATA[Reject unload station number]]>\n</Description>\n<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n<Data Format="Decorated">\n<DataValue DataType="DINT" Radix="Decimal" Value="0"/>\n</Data>\n</Tag>\n</Tags>');
  replaceProgram('Production', b);
}
// Map programs: every rung mapped a removed module
for (const [prog, c] of [['MapInputs', 'Map EtherNet/IP inputs here with a CPS per node - none in this file'], ['MapOutputs', 'Map EtherNet/IP outputs here with a CPS per node - none in this file']]) {
  editRoutine(prog, 'R01_Logic', () => [newRung(c, 'NOP();')]);
  let b = programBody(prog); for (const t of [...b.matchAll(/<Tag Name="([^"]+)"/g)].map((m) => m[1])) b = dropTagIn(b, t); replaceProgram(prog, b);
}

// ═══ 4. StateMachine: the latest single-step block, from the template's own S03_PartLoad ════
{
  const s03 = (new RegExp('<Program\\b[^>]*?\\sName="S03_PartLoad"[\\s\\S]*?</Program>').exec(original) || [])[0] || fail('S03_PartLoad not in the source');
  const s03r01 = rungList(getRoutine(s03, 'R01_Inputs'));
  const pick = (re) => s03r01.find((r) => re.test(rungText(r))) || fail('S03 R01 rung not found: ' + re);
  const block = {
    autoIdle: pick(/OTE\(AutoIdle\)/), running: pick(/OTE\(CycleRunning\)/), stopping: pick(/OTE\(CycleStopping\)/),
    lockout: pick(/OTE\(Lockout\)/), dryRun: pick(/OTE\(DryRun\)/), ss: pick(/OTE\(SS\);/), sdt: pick(/OTE\(SingleDisableTracking\)/),
    otu1: pick(/OTU\(\\Tracking\.p_Data\.Station\[StaNum\]\.OpStatus\.SingleCycle\)/), otu2: pick(/OTU\(\\Tracking\.p_Data\.Station\[StaNum\]\.OpStatus\.SingleStep\)/),
    scL: pick(/OTL\(SingleCycle\)/), scU: pick(/OTU\(SingleCycle\)/), ssOk: pick(/OTE\(SS_OK\)/),
  };
  editRoutine('StateMachine', 'R01_Inputs', (rungs) => {
    const out = [newRung('Station number - set this to your station', 'MOVE(0,StaNum);')];
    for (const r of rungs) {
      const t = rungText(r);
      if (/OTE\(CycleRunning\)/.test(t)) { out.push(block.running); continue; }
      if (/OTE\(CycleStopping\)/.test(t)) { out.push(block.stopping); continue; }
      if (/OTE\(SafetyOK\)/.test(t)) { out.push(r, block.autoIdle); continue; }
      if (/OTE\(Lockout\)/.test(t)) { out.push(block.lockout); continue; }
      if (/OTE\(DryRun\)/.test(t)) { out.push(block.dryRun); continue; }
      if (/OTE\(SS\);/.test(t)) { out.push(block.ss, block.sdt, block.otu1, block.otu2, block.scL, block.scU); continue; }
      if (/OTE\(SS_OK\)/.test(t)) { out.push(block.ssOk); continue; }
      out.push(r);
    }
    return out;
  });
  // tags the block needs, copied from S03 (same UDT versions); HMI_Toggle goes - nothing reads it now
  let b = programBody('StateMachine');
  const s03tag = (n) => (new RegExp('<Tag Name="' + n + '"[^>]*?(?:/>|>[\\s\\S]*?</Tag>)').exec(s03) || [])[0] || fail('S03 tag not found: ' + n);
  const add = ['AutoIdle', 'StaNum', 'SingleCycle', 'SingleDisableTracking'].filter((n) => !new RegExp('<Tag Name="' + n + '"').test(b)).map(s03tag);
  b = b.replace(/<\/Tags>/, add.join('\n') + '\n</Tags>');
  if (!/HMI_Toggle/.test(b.replace(/<Tag Name="HMI_Toggle"[\s\S]*?<\/Tag>/, ''))) b = dropTagIn(b, 'HMI_Toggle');
  replaceProgram('StateMachine', b);
  log.push('StateMachine R01_Inputs: single-step block from S03_PartLoad (AutoIdle, Lockout, DryRun, SingleStep / SingleCycle, SS_OK with p_OnStation); HMI_Toggle form removed');
}

// ═══ 5. SafetyProgram: the rungs that read hardware no longer in the file ═════
{
  const b = programBody('SafetyProgram');
  const hw = new RegExp('(?<![A-Za-z0-9_])(' + removedModNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-z0-9_])');
  const dangling = [];
  for (const r of b.matchAll(/<Routine\b[^>]*\bName="([^"]+)"[\s\S]*?(?=<Routine\b|<\/Routines>)/g))
    for (const g of rungList(r[0])) if (hw.test(rungText(g))) dangling.push(r[1] + ': ' + rungComment(g).slice(0, 60) + ' | ' + rungText(g).slice(0, 90));
  // rungs on removed hardware go (the indexer drive's CIP-safety pair always; the 1734 rack's
  // unless --keep-safety-rack)
  for (const rn of [...new Set([...b.matchAll(/<Routine\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]))]) {
    editRoutine('SafetyProgram', rn, (rungs) => rungs.filter((r) => !hw.test(rungText(r))));
  }
  let zone2 = '';
  if (!KEEP_SAFETY_RACK) {
    // Zone 2 (door inputs, EDM, output CROUT) and the air dump valve lived only on that rack.
    // With no writer, GuardDoorZ2EDM would hold the E-stop reset off forever - Zone 2 goes with
    // its hardware: Zone 1 + E-stop + reset remain on the local 5069 safety cards.
    const z2out = /OTE\(GuardDoorZ2Output\)|TOF\(GuardDoorZ2OffDelay/;
    for (const rn of ['R02_Logic']) editRoutine('SafetyProgram', rn, (rungs) => rungs.filter((r) => !z2out.test(rungText(r))).map((r) => {
      const t = rungText(r); if (!/GuardDoorZ2/.test(t)) return r;
      return setRungText(r, t.replace(/XI[CO]\(GuardDoorZ2(?:EDM|Output|Input)\)/g, '').replace(/\s+/g, ' ').trim());
    }));
    zone2 = '\n      Zone 2 door + air dump valve removed with the rack (E-stop, Zone 1, reset stay on Local:1/Local:2)';
  }
  // tags that backed those rungs and nothing else
  let sb = programBody('SafetyProgram');
  const used = sb.replace(/<Tags>[\s\S]*?<\/Tags>/, '');
  for (const t of [...sb.matchAll(/<Tag Name="([^"]+)"/g)].map((m) => m[1])) if (!new RegExp('(?<![A-Za-z0-9_])' + t + '(?![A-Za-z0-9_])').test(used) && !/^Safe_q_/.test(t)) sb = dropTagIn(sb, t);
  replaceProgram('SafetyProgram', sb);
  log.push('SafetyProgram: ' + dangling.length + ' rung(s) reading removed hardware taken out, the rest verbatim:\n      ' + dangling.join('\n      ') + zone2);
}

// ═══ 6. AOIs and UDTs nothing left uses ═════════════════════════════════════
{
  const progsNow = x.slice(x.indexOf('<Programs>'));
  const ctlTagsNow = x.slice(0, x.indexOf('<Programs>')).replace(/<AddOnInstructionDefinition[\s\S]*?<\/AddOnInstructionDefinition>/g, '').replace(/<DataType\b[\s\S]*?<\/DataType>/g, '');
  const usedBy = (name) => new RegExp('(?<![A-Za-z0-9_])' + name + '(?![A-Za-z0-9_])').test(progsNow) || new RegExp('DataType="' + name + '"').test(ctlTagsNow);
  const removedAoi = [], removedUdt = [];
  // AOIs first (their LocalTags may use UDTs)
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of [...x.matchAll(/<AddOnInstructionDefinition\b[^>]*\bName="([^"]+)"[\s\S]*?<\/AddOnInstructionDefinition>\s*/g)]) {
      if (KEEP_TYPES_FOR_CANDIDATE.has(m[1])) continue;
      const others = x.replace(m[0], '');
      if (!new RegExp('(?<![A-Za-z0-9_])' + m[1] + '(?![A-Za-z0-9_])').test(others.slice(others.indexOf('<Programs>'))) && !new RegExp('DataType="' + m[1] + '"').test(others.slice(0, others.indexOf('<Programs>')).replace(/<AddOnInstructionDefinition[\s\S]*?<\/AddOnInstructionDefinition>/g, '').replace(/<DataType\b[\s\S]*?<\/DataType>/g, '')) && !new RegExp(m[1] + '\\(').test(others)) { x = others; removedAoi.push(m[1]); changed = true; }
    }
    for (const m of [...x.matchAll(/<DataType\b[^>]*\bName="([^"]+)"[\s\S]*?<\/DataType>\s*/g)]) {
      if (KEEP_TYPES_FOR_CANDIDATE.has(m[1])) continue;
      const others = x.replace(m[0], '');
      if (!new RegExp('DataType="' + m[1] + '"').test(others) && !new RegExp('(?<![A-Za-z0-9_])' + m[1] + '(?![A-Za-z0-9_])').test(others.slice(others.indexOf('<Programs>')))) { x = others; removedUdt.push(m[1]); changed = true; }
    }
  }
  log.push('AOIs removed (' + removedAoi.length + '): ' + removedAoi.join(', '));
  log.push('UDTs removed (' + removedUdt.length + '): ' + removedUdt.join(', '));
  log.push('kept for the candidate though unused now: ' + [...KEEP_TYPES_FOR_CANDIDATE].join(', '));
}

// ═══ 7. write, and report what remains ══════════════════════════════════════
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, NAME + '.L5X');
fs.writeFileSync(outFile, x, 'utf8');
if (fs.readFileSync(SRC, 'utf8') !== original) fail('the template changed on disk during the run');
console.log('CE interview test file\n');
for (const l of log) console.log('  ' + l);
console.log('\n  programs left: ' + [...x.matchAll(/<Program\b[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  modules left:  ' + [...x.matchAll(/<Module\b[^>]*\bName="([^"]+)"[^>]*\bCatalogNumber="([^"]+)"/g)].map((m) => m[1] + ' ' + m[2]).join(', '));
console.log('  AOIs left:     ' + [...x.matchAll(/<AddOnInstructionDefinition\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  UDTs left:     ' + [...x.matchAll(/<DataType\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]).join(', '));
console.log('  dangling \\Prog. refs: ' + [...new Set([...x.slice(x.indexOf('<Programs>')).matchAll(/\\([A-Za-z0-9_]+)\./g)].map((m) => m[1]))].filter((p) => !KEEP.has(p)).join(', ') || 'none');
console.log('\n  wrote ' + outFile + '  (' + x.length + ' bytes, from ' + original.length + ')');
