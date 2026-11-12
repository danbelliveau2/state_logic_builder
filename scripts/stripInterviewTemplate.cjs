#!/usr/bin/env node
'use strict';
/**
 * stripInterviewTemplate.cjs - the CE interview test file (Jason, 2026-10-01).
 *
 * Reads Templates\SoftwareStandardizationNew.L5X (never written) and produces a stripped copy:
 *   keep     MapInputs, Supervisor, Tracking, StateMachine, S00_IndexerSP, Production, Alarms, HMI,
 *            MapOutputs, SafetyProgram
 *   remove   every other program, its ParameterConnections, its schedule entry, the AOIs / UDTs
 *            only it used, the station axes a03-a05, every EtherNet/IP module and its buffer tags
 *            except the Indexer's two Kinetix drives (MotionGroup, a01, a02, sd01, sd02 stay -
 *            Jason 2026-10-01)
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
 *
 *   --v2  the read-then-fill-in test (Jason, 2026-11-11, after Hailey's trial run): keeps S01_PartLoad and
 *         S05_ServoPNP with their R02 transition conditions and R03 / R04 / R05 state ties blanked to
 *         AlwaysOff (the candidate fills them), S19_GoodUnload complete as the reading exercise (its
 *         outfeed placeholder becomes a real i_OutfeedReady input), the S05 drives and axes, and every
 *         poll of those three stations. Default output: Deliveries\CE Interview Test v2\SoftwareStandardization_CETest_v2.L5X
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);
const V2 = has('v2');                                                      // read-then-fill-in test (see header)
const SRC = flag('src', 'X:/Electrical Dept/SDC Engineer/Templates/SoftwareStandardizationNew.L5X');
const OUT_DIR = flag('out', V2 ? 'X:/Electrical Dept/SDC Engineer/Deliveries/CE Interview Test v2' : 'X:/Electrical Dept/SDC Engineer/Deliveries/CE Interview Test');
const NAME = flag('name', V2 ? 'SoftwareStandardization_CETest_v2' : 'SoftwareStandardization_CETest');
const KEEP_SAFETY_RACK = has('keep-safety-rack');                          // keep the 1734 rack Zone 2 lives on
const fail = (m) => { console.error('  !! ' + m); process.exit(1); };
const log = [];

const KEEP = new Set(['MapInputs', 'Supervisor', 'Tracking', 'StateMachine', 'S00_IndexerSP', 'Production', 'Alarms', 'HMI', 'MapOutputs', 'SafetyProgram']);
// the controller, its local safety cards, and the Indexer's two drives (Jason 2026-10-01: MotionGroup,
// a01, a02, sd01, sd02 stay - S00_IndexerSP cannot lose its axes)
const KEEP_MODULES = new Set(['Local', 'SIN1', 'SOUT1', 'sd01_Indexer', 'sd02_ShotPin']);
const KEEP_CTL_TAGS = new Set(['MotionGroup', 'a01_Indexer', 'a02_ShotPin']);
if (KEEP_SAFETY_RACK) for (const n of ['io01_MainMachine', 'io01_SIN2', 'io1_SOUT2']) KEEP_MODULES.add(n);
// v2: the two build stations, the reading station, and the servo station's drives and axes
const V2_BUILD = ['S01_PartLoad', 'S05_ServoPNP'], V2_READ = 'S19_GoodUnload';
if (V2) {
  for (const p of [...V2_BUILD, V2_READ]) KEEP.add(p);
  // the Z axis (a04, sd04, iq_ZAxis, R05_ZAxisServo) is the candidate's to add (Jason, 2026-11-12);
  // the strip pipeline removes the module, the axis tag, their ParameterConnection and the Supervisor EIP rung
  for (const m of ['sd03_S01PNPXAxis']) KEEP_MODULES.add(m);
  for (const t of ['a03_S01PNPXAxis']) KEEP_CTL_TAGS.add(t);
}
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
    if (KEEP_CTL_TAGS.has(name)) return m;
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
// ParameterConnections that name a removed module or a removed axis (the Indexer's a01 / a02 stay)
const removedAxes = removedCtlTags.filter((t) => /:AXIS_/.test(t)).map((t) => t.split(':')[0]);
x = x.replace(/<ParameterConnection[^>]*>\s*/g, (m) => (removedModNames.some((n) => m.includes(n + ':') || m.includes(n + '_')) || removedAxes.some((a) => m.includes('"' + a + '"')) ? '' : m));

// ═══ 3. bare the kept programs ══════════════════════════════════════════════
const remRe = new RegExp('\\\\(' + REMOVED_PROGS.join('|') + ')\\.');
// Supervisor polls: strip removed terms; the Indexer stays in them
for (const rn of ['R01_Inputs']) editRoutine('Supervisor', rn, (rungs) => rungs.map((r) => {
  const t = rungText(r); if (!remRe.test(t)) return r;
  let nt = stripRemovedTerms(t);
  if (/^OTE\(/.test(nt) || /^\s*OTE/.test(nt)) nt = AOFF + nt;          // nothing left in series
  return setRungText(r, nt);
}));
// Supervisor EIP monitor: only the kept modules' loss-of-EIP alarms stay; the wrap follows the node count
const modRe = new RegExp('(?<![A-Za-z0-9_])(' + removedModNames.join('|') + ')(?![A-Za-z0-9_])');
let eipNodes = 0;
editRoutine('Supervisor', 'R20_Alarms', (rungs) => rungs.filter((r) => !(/AOI_EIPStatus\(/.test(rungText(r)) && modRe.test(rungText(r)))).map((r) => {
  if (!/AOI_EIPStatus\(/.test(rungText(r))) return r;
  return setRungText(r, rungText(r).replace(/EQ\(EIPStatusCount,\d+\)/, 'EQ(EIPStatusCount,' + (eipNodes++) + ')'));
}));
editRoutine('Supervisor', 'R15_EIPMonitor', (rungs) => rungs.map((r) => (/GE\(EIPStatusCount,/.test(rungText(r)) ? setRungText(r, 'GE(EIPStatusCount,' + Math.max(eipNodes, 1) + ')MOVE(0,EIPStatusCount);') : r)));
log.push('Supervisor EIP monitor: ' + eipNodes + ' node(s) kept, wrap at ' + Math.max(eipNodes, 1));
{ let b = programBody('Supervisor'); for (const m of removedModNames) b = dropTagIn(b, m + 'EIP'); replaceProgram('Supervisor', b); }
// Indexer polls and per-station complete times
editRoutine('S00_IndexerSP', 'R01_Inputs', (rungs) => rungs.map((r) => {
  const t = rungText(r); if (!remRe.test(t)) return r;
  let nt = stripRemovedTerms(t);
  if (/^\s*OTE/.test(nt)) nt = AON + nt;                                   // "all stations complete / safe" with no stations
  return V2 ? setRungText(r, nt) : setRungComment(setRungText(r, nt), rungComment(r) + ' - add your station');
}));
editRoutine('S00_IndexerSP', 'R03_StateLogic', (rungs) => rungs.filter((r) => !(remRe.test(rungText(r)) && /StationCompleteTimes\[/.test(rungText(r)))));
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

// ═══ 4b. v2: blank the candidate rungs, finish the reading station ══════════
if (V2) {
  const REPLACE = ' *Replace always off with real conditions';
  const mark = (r) => (rungComment(r) && !rungComment(r).includes('Replace always off') ? setRungComment(r, rungComment(r) + REPLACE) : r);
  const stateOf = (t) => { const m = /MOVE\((\d+),Control\.StateReg\)/.exec(t); return m ? Number(m[1]) : null; };
  // S05's Z speed-change states (fast approach / slow finish, slow retreat / fast finish) are given,
  // and its two blending options go altogether (Jason, 2026-11-11): the parameters i_DisableCornerRounding /
  // i_DisableZSpeedTransition, the bits DisableCornerRounding / DisableZSpeedTransition, their R01 rungs,
  // and every term that read them - the speed change is simply always on
  // Later the same day: ONE speed for Z, no MCD, and the four speed-change states leave the sequence
  // altogether, so S05 runs the same 4..31 grid as S01 and every transition is the candidate's.
  const SPEED_STATES = [10, 19, 31, 40];
  const RENUMBER = { 13: 10, 16: 13, 22: 16, 25: 19, 28: 22, 34: 25, 37: 28, 43: 31 };
  const BLEND_RE = /Disable(CornerRounding|ZSpeedTransition)/;
  const isSequenceState = (n) => n !== null && ((n >= 4 && n <= 96 && (n - 4) % 3 === 0) || [100, 103, 106, 124].includes(n));
  /** Drop every branch leg that carries a `term`, inline a group left with one leg, then drop bare terms. */
  const dropLegAware = (text, term, what) => {
    // mask array subscripts (Status.State[4], Alarm[0]) so only branch brackets are seen; a subscript
    // follows an identifier character and never holds an instruction
    let t = text;
    for (let guard = 0; guard < 8; guard++) { const n = t.replace(/(\w)\[([^\[\]()]*)\]/g, '$1⦃$2⦄'); if (n === t) break; t = n; }
    const unmask = (s) => s.replace(/⦃/g, '[').replace(/⦄/g, ']');
    for (let guard = 0; guard < 8; guard++) {
      const next = t.replace(/\[([^\[\]]*)\]/g, (m, inner) => {
        if (!inner.includes('(')) return m;
        const legs = inner.split(/\s,\s*/).map((l) => l.trim()).filter((l) => l.length);
        const kept = legs.filter((l) => !term.test(unmask(l)));
        if (kept.length === legs.length) return m;
        if (kept.length === 0) fail('a branch had only ' + what + ' legs: ' + unmask(m));
        return kept.length === 1 ? kept[0] : '[' + kept.join(' ,') + ' ]';
      });
      if (next === t) break;
      t = next;
    }
    t = unmask(t).replace(new RegExp(term.source + '\\s*', 'g'), '').replace(/\s+/g, ' ');
    if (/,\s*,|\[\s*,|,\s*\]/.test(t)) fail('an empty branch leg was left after dropping ' + what + ' terms: ' + t);
    return t;
  };
  // Auto Mode: only the state bits that pick a position go; the speed branches stay as the example
  const blankPositionBits = (t) => t
    .replace(/(\[(?:XIC\(Status\.State\[\d+\]\)\s*,?\s*)+\]|XIC\(Status\.State\[\d+\]\))\s*(?=MOVE\(HMI_[XZ]Axis\.Parameters\.Positions\[)/g, AOFF + ' ')
    .replace(/\s+/g, ' ');
  // the Z Auto Mode rung: the "fast when the speed change is disabled" leg goes whole, the XIO term goes
  const dropSpeedOption = (t) => t
    .replace(/\[(\[XIC\(Status\.State\[7\]\) ,XIC\(Status\.State\[28\]\) ,XIC\(Status\.State\[100\]\) \]) ,\[XIC\(Status\.State\[16\]\) ,XIC\(Status\.State\[37\]\) \] XIC\(DisableZSpeedTransition\) \]/, '$1')
    .replace(/XI[CO]\(DisableZSpeedTransition\)\s*/g, '')
    .replace(/\s+/g, ' ');
  // R02: everything before the MOVE goes; what follows it (the tracking latches) stays
  const blankTransition = (t) => AOFF + t.slice(t.indexOf('MOVE('));
  // R03: only the coils stay
  const blankOutput = (t) => { const outs = [...t.matchAll(/OTE\([A-Za-z0-9_.\[\]]+\)/g)].map((m) => m[0]); return AOFF + (outs.length === 1 ? outs[0] : '[' + outs.join(' ,') + ' ]') + ';'; };
  // R04 / R05: every state bit but State[1] (manual) goes, singly or as a whole branch group
  const blankStateBits = (t) => t
    .replace(/\[((?:XIC\(Status\.State\[\d+\]\)\s*,?\s*)+)\]/g, (m, inner) => (/State\[1\]/.test(inner) ? m : AOFF))
    .replace(/XIC\(Status\.State\[(\d+)\]\)/g, (m, n) => (n === '1' ? m : AOFF))
    .replace(/\s+/g, ' ');
  const count = {};
  const tally = (p) => { count[p] = (count[p] || 0) + 1; };
  // ── S05 first: one Z speed, no MCD, speed-change states out, sequence renumbered to 4..31 ──
  {
    const p = 'S05_ServoPNP';
    const pb0 = programBody(p) || fail('v2 build station missing: ' + p);
    const routines = (pb) => [...pb.matchAll(/<Routine\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]);
    const goneTerm = new RegExp('XI[CO]\\(Status\\.State\\[(?:' + SPEED_STATES.join('|') + ')\\]\\)');
    const num = (n) => String(RENUMBER[n] ?? n);
    // the four transitions and the MCD rung go; the Z Auto Mode rung takes the X axis form (one speed)
    editRoutine(p, 'R02_StateTransitions', (rungs) => rungs.filter((r) => !SPEED_STATES.includes(stateOf(rungText(r)))));
    editRoutine(p, 'R05_ZAxisServo', (rungs) => rungs.filter((r) => !/MCD\(/.test(rungText(r))).map((r) => {
      if (!/^Auto Mode/.test(rungComment(r))) return r;
      const pos = [...rungText(r).matchAll(/(\[(?:XIC\(Status\.State\[\d+\]\)\s*,?\s*)+\]|XIC\(Status\.State\[\d+\]\)) (MOVE\(HMI_ZAxis\.Parameters\.Positions\[\d\],ZAxisMotionParameters\.Position\))/g)].map((m) => m[1] + ' ' + m[2]);
      if (pos.length !== 3) fail('S05 Z Auto Mode: expected 3 position branches, found ' + pos.length);
      const t = 'XIC(SafetyOK)XIO(Status.State[1])[MOVE(0,ZAxisMotionParameters.MoveType) ,MOVE(HMI_ZAxis.Parameters.AutoSpeed[0],ZAxisMotionParameters.Speed) ,MOVE(HMI_ZAxis.Parameters.Accel[0],ZAxisMotionParameters.Accel) ,MOVE(HMI_ZAxis.Parameters.Decel[0],ZAxisMotionParameters.Decel) ,' + pos.join(' ,') + ' ];';
      return setRungComment(setRungText(r, t), 'Auto Mode');
    }));
    // every rung: legs and terms naming a gone state go, then one-pass renumbering of logic and comments
    for (const rn of routines(pb0)) editRoutine(p, rn, (rungs) => rungs.map((r) => {
      let t = rungText(r);
      if (goneTerm.test(t)) t = dropLegAware(t, goneTerm, 'removed-state');
      if (SPEED_STATES.includes(stateOf(t))) fail(p + '/' + rn + ': a rung still enters a removed state: ' + t);
      t = t.replace(/Status\.State\[(\d+)\]/g, (m, n) => 'Status.State[' + num(n) + ']').replace(/MOVE\((\d+),Control\.StateReg\)/g, (m, n) => 'MOVE(' + num(n) + ',Control.StateReg)');
      const c0 = rungComment(r);
      const c = c0.replace(/^State (\d+):\s*/, (m, n) => 'State ' + num(n) + ': ').replace(/\s*\((fast approach|slow retreat)\)/g, '');
      r = setRungText(r, t);
      return c !== c0 ? setRungComment(r, c) : r;
    }));
    // Status.State[n] operand comments follow the states; the MCD tags go
    let pb = programBody(p);
    for (const n of SPEED_STATES) pb = pb.replace(new RegExp('<Comment Operand="\\.STATE\\[' + n + '\\]">[\\s\\S]*?</Comment>\\s*'), '');
    pb = pb.replace(/Operand="\.STATE\[(\d+)\]"/g, (m, n) => 'Operand=".STATE[' + num(n) + ']"');
    pb = pb.replace(/(<Comment Operand="\.STATE\[\d+\]">\s*<!\[CDATA\[[^\]]*?)\s*\((Fast Approach|Slow Retreat)\)/g, '$1');
    for (const t of ['ZAxis_MCD', 'ZAxisMCDSpeed', 'ZAxisMCDAccel', 'ZAxisMCDDecel']) pb = dropTagIn(pb, t);
    replaceProgram(p, pb);
    if (/MCD/.test(programBody(p))) fail('S05: MCD still present');
    const targets = [...new Set(rungList(getRoutine(programBody(p), 'R02_StateTransitions')).map((r) => stateOf(rungText(r))).filter((n) => n !== null))].sort((a, b) => a - b);
    log.push(p + ': Z one speed, MCD removed, states ' + SPEED_STATES.join('/') + ' removed, sequence renumbered; R02 targets now ' + targets.join(' '));
  }
  for (const p of V2_BUILD) {
    const b = programBody(p) || fail('v2 build station missing: ' + p);
    editRoutine(p, 'R02_StateTransitions', (rungs) => rungs.map((r) => (isSequenceState(stateOf(rungText(r))) ? (tally(p), mark(setRungText(r, blankTransition(rungText(r))))) : r)));
    const coils = p === 'S05_ServoPNP' ? /OTE\((q_ActuatorsSafe|q_CloseGripper|q_OpenGripper)\)/ : /OTE\((q_ActuatorsSafe|OkMan(Extend|Retract)X|q_(Extend|Retract)[XZ]Axis|q_(Close|Open)Gripper)\)/;
    editRoutine(p, 'R03_StateLogic', (rungs) => rungs.map((r) => (coils.test(rungText(r)) ? (tally(p), mark(setRungText(r, blankOutput(rungText(r))))) : r)));
    // R01: one derived input per station is the candidate's, its twin stays as the worked example
    // (Jason, 2026-11-11: S01 shows the X axis, candidate does Z; S05 shows GripperOpened, candidate does GripperClosed)
    const inputs = p === 'S05_ServoPNP' ? /OTE\(GripperClosed\)/ : /OTE\(ZAxis(Extended|Retracted)\)/;
    editRoutine(p, 'R01_Inputs', (rungs) => rungs.map((r) => (inputs.test(rungText(r)) ? (tally(p), mark(setRungText(r, blankOutput(rungText(r))))) : r)));
    // the candidate declares the timer behind that input too (Jason, 2026-11-11)
    for (const t of (p === 'S05_ServoPNP' ? ['CloseGripperDelay'] : ['ZAxisExtendedDelay'])) {
      let pb = programBody(p);
      if (!new RegExp('<Tag Name="' + t + '"').test(pb)) fail(p + ': timer tag not found: ' + t);
      pb = dropTagIn(pb, t);
      if (new RegExp('(?<![A-Za-z0-9_])' + t + '(?![A-Za-z0-9_])').test(pb)) fail(p + ': ' + t + ' is still referenced after blanking');
      replaceProgram(p, pb);
    }
    for (const rn of [...b.matchAll(/<Routine\b[^>]*\bName="(R0[45]_[A-Za-z]+Servo)"/g)].map((m) => m[1]))
      editRoutine(p, rn, (rungs) => rungs.map((r) => {
        const c = rungComment(r), t = rungText(r);
        if (/^Auto Mode/.test(c)) { tally(p); return mark(setRungText(r, blankPositionBits(/DisableZSpeedTransition/.test(t) ? dropSpeedOption(t) : t))); }
        if (/^Axis Motion Command/.test(c)) { tally(p); return mark(setRungText(r, blankStateBits(t))); }
        return r;
      }));
    if (p === 'S05_ServoPNP') {
      // the blending options: setter rungs, every remaining term (the given speed-change transitions), the tags
      let pb = programBody(p);
      // a branch leg that starts with the option (the template's "or blended entry" legs) goes whole;
      // a bare series term goes alone; a group left with one leg is inlined
      const dropBlendTerms = (text) => dropLegAware(text, /XI[CO]\(Disable(?:CornerRounding|ZSpeedTransition)\)/, 'blending-option');
      for (const rn of [...pb.matchAll(/<Routine\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]))
        editRoutine(p, rn, (rungs) => rungs.filter((r) => !/OTE\(Disable(CornerRounding|ZSpeedTransition)\)/.test(rungText(r)))
          .map((r) => (BLEND_RE.test(rungText(r)) ? setRungText(r, dropBlendTerms(rungText(r))) : r)));
      pb = programBody(p);
      for (const t of ['i_DisableCornerRounding', 'i_DisableZSpeedTransition', 'DisableCornerRounding', 'DisableZSpeedTransition']) pb = dropTagIn(pb, t);
      replaceProgram(p, pb);
      const left = [...programBody(p).matchAll(/[^\n]*Disable(?:CornerRounding|ZSpeedTransition)[^\n]*/g)].map((m) => m[0].trim().slice(0, 120));
      if (left.length) fail(p + ': blending option still referenced:\n      ' + left.join('\n      '));
      if (BLEND_RE.test(x.replace(programBody(p), ''))) fail('a blending option of ' + p + ' is referenced outside it');
      log.push(p + ': blending options removed (2 parameters, 2 bits, their R01 rungs)');
      // Z axis: the candidate adds a04 / sd04, the iq_ZAxis parameter + connection, R05_ZAxisServo and its JSR
      // (Jason, 2026-11-12). The Z program-scope tags stay. Rungs that read the axis outside R05 become candidate rungs
      // (R03 q_StartOK, R04 XAxisPermissive); the two Z alarm rungs go (alarms are out of scope).
      editRoutine(p, 'R00_Main', (rungs) => rungs.filter((r) => !/JSR\(R05_ZAxisServo/.test(rungText(r))));
      editRoutine(p, 'R03_StateLogic', (rungs) => rungs.map((r) => {
        const t = rungText(r); if (!/OTE\(q_StartOK\)/.test(t)) return r;
        const z = 'XIC(iq_ZAxis.ServoActionStatus)XIC(iq_ZAxis.AxisHomedStatus)';
        if (!t.includes(z)) fail(p + ': q_StartOK rung does not read the Z axis as expected');
        tally(p); return mark(setRungText(r, t.replace(z, AOFF)));
      }));
      editRoutine(p, 'R04_XAxisServo', (rungs) => rungs.map((r) => {
        const t = rungText(r); if (!/OTE\(XAxisPermissive\)/.test(t)) return r;
        tally(p); return mark(setRungText(r, AOFF + 'OTE(XAxisPermissive);'));
      }));
      editRoutine(p, 'R20_Alarms', (rungs) => rungs.filter((r) => !/iq_ZAxis/.test(rungText(r))));
      pb = programBody(p);
      pb = pb.replace(/<Routine\b[^>]*\bName="R05_ZAxisServo"[\s\S]*?<\/Routine>\s*/, '');
      pb = dropTagIn(pb, 'iq_ZAxis');
      replaceProgram(p, pb);
      const zLeft = [...programBody(p).matchAll(/[^\n]*(?:iq_ZAxis|R05_ZAxisServo)[^\n]*/g)].map((m) => m[0].trim().slice(0, 120));
      if (zLeft.length) fail(p + ': Z axis still referenced:\n      ' + zLeft.join('\n      '));
      count[p] -= 2; // the R05 Auto Mode / Axis Motion Command rungs were tallied before the routine went
      log.push(p + ': Z axis removed (R05_ZAxisServo, its JSR, iq_ZAxis, the two Z alarm rungs); q_StartOK and XAxisPermissive blanked');
    }
  }
  // S19: the outfeed placeholder becomes a real input so the station reads as finished
  {
    let b = programBody(V2_READ) || fail('v2 reading station missing: ' + V2_READ);
    const form = (/<Tag Name="i_ZAxisRetracted"[\s\S]*?<\/Tag>/.exec(b) || [])[0] || fail('S19 i_ZAxisRetracted tag not found');
    if (!/<Tag Name="i_OutfeedReady"/.test(b)) b = b.replace(form, form + '\n' + form.replace('i_ZAxisRetracted', 'i_OutfeedReady').replace('Z Axis Is Retracted', 'Outfeed Ready For Part'));
    replaceProgram(V2_READ, b);
    let fixed = 0;
    editRoutine(V2_READ, 'R02_StateTransitions', (rungs) => rungs.map((r) => {
      const t = rungText(r); if (!(/XIC\(Status\.State\[19\]\)/.test(t) && t.includes(AOFF))) return r;
      fixed++;
      return setRungComment(setRungText(r, t.replace(AOFF, 'XIC(i_OutfeedReady)')), rungComment(r).replace(/\s*\*\*\*Replace AlwaysOff.*$/, ''));
    }));
    if (fixed !== 1) fail('S19 outfeed placeholder: expected 1 rung, found ' + fixed);
    // the candidate reads the rungs, not the comments (Jason, 2026-11-12)
    let blanked = 0;
    editRoutine(V2_READ, 'R02_StateTransitions', (rungs) => rungs.map((r, i) => {
      const m = /^State (\d+):/.exec(rungComment(r));
      if (i < 4 || i > 17 || !m) return r;
      blanked++; return setRungComment(r, 'State ' + m[1] + ':');
    }));
    if (blanked !== 14) fail('S19 R02 rung comments: expected 14 blanked, got ' + blanked);
    let sb = programBody(V2_READ), dropped = 0;
    sb = sb.replace(/<Comment Operand="\.STATE\[(\d+)\]">\s*<!\[CDATA\[[\s\S]*?\]\]>\s*<\/Comment>\s*/g, (m, k) => (Number(k) >= 7 && Number(k) <= 124 ? (dropped++, '') : m));
    if (dropped !== 15) fail('S19 state descriptions: expected 15 removed, got ' + dropped);
    replaceProgram(V2_READ, sb);
    log.push(V2_READ + ': R02 rungs 4-17 comments reduced to "State N:", state descriptions 7-124 removed');
  }
  // the S05 drives and axes carry the program's number (Jason, 2026-11-12): a03_S05PNPXAxis / sd03_S05PNPXAxis
  { const hits = (x.match(/S01PNP(?=[XZ]Axis)/g) || []).length; x = x.replace(/S01PNP(?=[XZ]Axis)/g, 'S05PNP'); if (hits < 6) fail('v2: expected the 6 S01PNP axis/drive names, found ' + hits); log.push('v2: S01PNP[XZ]Axis renamed S05PNP (' + hits + ' places)'); }
  for (const gone of ['a04_S05PNPZAxis', 'sd04_S05PNPZAxis', 'a04_S01PNPZAxis', 'sd04_S01PNPZAxis', 'S01PNP', 'iq_ZAxis', 'R05_ZAxisServo']) {
    const hit = new RegExp('(?<![A-Za-z0-9_])' + gone + '(?![A-Za-z0-9_])').exec(x);
    if (hit) fail('v2: ' + gone + ' still in the file near: ' + x.slice(Math.max(0, hit.index - 80), hit.index + 80).replace(/\s+/g, ' '));
  }
  log.push('v2 candidate rungs blanked: ' + Object.entries(count).map(([p, n]) => p + ' ' + n).join(', ') + '; S19_GoodUnload completed with i_OutfeedReady');
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
    for (const rn of ['R02_Logic', 'R03_Outputs']) editRoutine('SafetyProgram', rn, (rungs) => rungs.filter((r) => !z2out.test(rungText(r))).map((r) => {
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
