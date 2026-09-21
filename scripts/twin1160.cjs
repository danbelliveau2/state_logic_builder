#!/usr/bin/env node
'use strict';
/**
 * twin1160.cjs — JOB 1160 A/B TWIN GENERATOR + DIFF-VERIFY + LINT (2026-09-17, NAMES CONTRACT v2.1)
 *
 * Jason's two-up rule (generated/1160/build/NAMES_CONTRACT.md, rulings of 2026-09-17 11:58): one
 * station program per nest side, suffixed A and B — A = LEFT nest, B = RIGHT nest — identical except
 * the side members they touch, the side's I/O points and the 'Side A' / 'Side B' text. This script
 * makes the B (RIGHT) twin FROM the hand-authored A (LEFT) twin by a fixed substitution table, then
 * proves it:
 *
 *   1. B = subst(A)                       (written to generated/1160/build/programs/<B>.xml)
 *   2. diff A B                           every differing line is printed; a line may differ
 *                                         ONLY by the substitution table
 *   3. side-total check                   A carries no 'Right'/'RT' word, B carries no 'Left'/'LT' word
 *   4. lint A and B (Jason's rules):      ASCII-only CDATA, no Use= attributes, Description <= 512,
 *                                         STRING LEN == DATA length, rung numbering 0..n-1, balanced rungs,
 *                                         every operand root declared (program tag | controller tag |
 *                                         contract g_S## angle | \Prog.param to a contract program),
 *                                         R02_StateTransitions carries transitions only (listeners: R02_Logic)
 *
 * Controller-scope names come from generated/1160/build/controller/ControllerTags.xml when it exists,
 * otherwise from the 2-UP template ControllerTags + the v0 buffer tags + the contract's g_S## angle list.
 * Cross-program parameters resolve against build/programs, then the template ref piece, then (marked
 * 'xref-v0', non-blocking) the v0 program — re-verified at assembly.
 *
 * Run:  node scripts/author1160Twins.cjs   (emit the A twins)
 *       node scripts/twin1160.cjs          (write B twins, verify, lint)
 *       node scripts/twin1160.cjs --check  (verify + lint only; B must already exist)
 * Exit: 0 clean (only non-blocking notes), 1 findings.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROG_DIR = path.join(ROOT, 'generated/1160/build/programs');
const CTRL_DIR = path.join(ROOT, 'generated/1160/build/controller');
const REF_DIR = path.join(ROOT, 'generated/1160/ref/ChassisStandard_2UP');
const V0_DIR = path.join(ROOT, 'generated/1160/build_v0/programs');
const V0_CTRL = path.join(ROOT, 'generated/1160/build_v0/controller/ControllerTags.xml');
const CHECK_ONLY = process.argv.includes('--check');

// ── NAMES CONTRACT v2.1 — programs (MainTask order) and the shared angle tags ─
const CONTRACT_PROGRAMS = new Set([
  'Supervisor', 'Tracking', 'Chassis', 'MapInputs',
  'S01_YSiteEscapementA', 'S01_YSiteEscapementB', 'S01_YSiteLoadA', 'S01_YSiteLoadB',
  'S02_YVerifyA', 'S02_YVerifyB', 'S03_YSiteInspectA', 'S03_YSiteInspectB',
  'S05_PortLoad', 'S06_PortVerifyA', 'S06_PortVerifyB',
  'S07_PortCutA', 'S07_PortCutB', 'S08_YHeatB', 'S09_PortCloseB', 'S10_YHeatA', 'S11_PortCloseA',
  'S12_OpticalCheck', 'S13_PhysicalCheckA', 'S13_PhysicalCheckB',
  'S14_GoodUnloadA', 'S14_GoodUnloadB', 'S14_BinDiverter', 'S15_RejectUnload',
  'S16_EmptyNestA', 'S16_EmptyNestB', 'MapOutputs', 'Production', 'Alarms', 'HMI', 'SafetyProgram',
]);
// Contract section "Angle tags" — controller-scope REALs shared by A/B twins, seeds from the timing sheet
const CONTRACT_ANGLE_SEEDS = {
  g_S01_GripperCloseAngle: 50, g_S01_GripperOpenAngle: 230, g_S01_PartsPickedAngle: 142,
  g_S02_VerifyProcessAngle: 240, g_S02_VerifyOffAngle: 80, g_S03_InspectTriggerAngle: 200,
  g_S06_VerifyProcessAngle: 240, g_S07_PierceExtendAngle: 195, g_S07_PierceRetractAngle: 250, g_S07_PierceDeadlineAngle: 270,
  g_S07_CutterInspectAngle: 300, g_S12_InspectTriggerAngle: 200, g_S13_MeasureAngle: 150, g_S14_GripperCloseAngle: 230,
  g_S14_GripperOpenAngle: 50, g_S14_DropCheckAngle: 100, g_S15_AirBlastOnAngle: 150, g_S15_AirBlastOffAngle: 330,
  g_S16_VerifyProcessAngle: 240,
};
const CONTRACT_ANGLES = Object.keys(CONTRACT_ANGLE_SEEDS);
// Angles a twin uses that the contract's seed list does not name (reported as 'controller-tag-requested', non-blocking).
// 2026-09-17: S06/S16 off-proofs use the template's declared g_ProbeOffAngle (seed 60 = the v0 VerifyOffAngle seed), so this list is empty.
const REQUESTED_ANGLES = [];

// ── substitution tables: A (LEFT) -> B (RIGHT) ──────────────────────────────
const TWIN_NAMES = 'S01_YSiteLoad|S02_YVerify|S03_YSiteInspect|S06_PortVerify|S07_PortCut|S13_PhysicalCheck|S14_GoodUnload|S16_EmptyNest';
const TRACKING_MEMBERS = 'PartLoaded|Good|Bad|Recycled|Sample|FailureType|FailureMessage|RecycleCount|Attempt|Success|Failure|Lockout|Recycle|Bypass|Faulted|Warning|Attempts|Successes|Failures|Efficiency|HMIColorStatus|FaultCount|HMI_Reset';
const COMMON_SUBS = [
  [new RegExp(`\\b(${TWIN_NAMES})A\\b`, 'g'), '$1B'],           // program name
  [/S01_YSiteEscapementA/g, 'S01_YSiteEscapementB'],            // escapement twins (v2.2 ruling 3): program name and \S01_YSiteEscapementA.p_PartReady
  [new RegExp(`\\b(${TRACKING_MEMBERS})A\\b`, 'g'), '$1B'],     // 2-UP tracking members (never CamPosCheckA/B — not in the list)
  [/\bSide A\b/g, 'Side B'],                                    // alarm / comment text
  [/Left/g, 'Right'],                                           // side word in prose and tag descriptions
  [/\bLT\b/g, 'RT'],                                            // Hailey's schematic labels (LT-Y SITE, LT SEPTUM)
];
const TWINS = [
  {
    a: 'S01_YSiteEscapementA.xml', b: 'S01_YSiteEscapementB.xml',
    subs: [
      // vb02_TableValveBank bits, Left (A) -> Right (B). Input bit 3 and output bit 3 map to different Right bits,
      // so the input and output tables are qualified by the buffer they belong to (vb02_TableValveBank_IN / _OUT).
      [/_IN\.Data\[0\]\.1\b/g, '_IN.Data[0].0'],                          // part present fiber:     input 1 -> 0
      [/_IN\.Data\[0\]\.3\b/g, '_IN.Data[0].2'],                          // hold back retracted:    input 3 -> 2
      [/_IN\.Data\[0\]\.5\b/g, '_IN.Data[0].4'],                          // lift lowered:           input 5 -> 4
      [/_OUT\.Data\[0\]\.2\b/g, '_OUT.Data[0].0'], [/_OUT\.Data\[0\]\.3\b/g, '_OUT.Data[0].1'],   // hold back slot 2 -> slot 1 (extend / retract)
      [/_OUT\.Data\[0\]\.6\b/g, '_OUT.Data[0].4'], [/_OUT\.Data\[0\]\.7\b/g, '_OUT.Data[0].5'],   // lift slot 4 -> slot 3 (raise / lower)
      [/\bslot 2\b/g, 'slot 1'], [/\bslot 4\b/g, 'slot 3'],
      [/\binput 1\b/g, 'input 0'], [/\binput 3\b/g, 'input 2'], [/\binput 5\b/g, 'input 4'],
    ],
  },
  {
    a: 'S01_YSiteLoadA.xml', b: 'S01_YSiteLoadB.xml',
    subs: [
      [/Data\[0\]\.2\b/g, 'Data[0].0'], [/Data\[0\]\.3\b/g, 'Data[0].1'],   // vb01 slot 2 (A, Left gripper) -> slot 1 (B, Right gripper): bits 2n-2 / 2n-1
      [/\bslot 2\b/g, 'slot 1'],
      [/\bPauseReason 1\b/g, 'PauseReason 2'],                             // Chassis PauseCondition map: S01_YSiteLoadA 1, S01_YSiteLoadB 2
    ],
  },
  {
    a: 'S02_YVerifyA.xml', b: 'S02_YVerifyB.xml',
    subs: [
      [/Data\[0\]\.1\b/g, 'Data[0].0'], [/Data\[0\]\.3\b/g, 'Data[0].2'],   // vb01 inputs 1/3 (Left present/seated) -> 0/2 (Right)
      [/\binput 1\b/g, 'input 0'], [/\binput 3\b/g, 'input 2'],
      [/\bpoint 1\b/g, 'point 0'], [/\bpoint 3\b/g, 'point 2'],
      [/\bbit 1\b/g, 'bit 0'], [/\bbit 3\b/g, 'bit 2'],
      [/\b1447PEC\b/g, '1443PEC'], [/\b1447CBL\b/g, '1443CBL'],
      [/\b1455PEC\b/g, '1451PEC'], [/\b1455CBL\b/g, '1451CBL'],
    ],
  },
  {
    a: 'S06_PortVerifyA.xml', b: 'S06_PortVerifyB.xml',
    subs: [
      [/Data\[1\]\.3\b/g, 'Data[1].2'],                                     // vb01 input 11 (Left) -> 10 (Right)
      [/\binput 11\b/g, 'input 10'], [/\bpoint 3\b/g, 'point 2'], [/\bbit 3\b/g, 'bit 2'],
      [/\b1515PEC\b/g, '1511PEC'], [/\b1515CBL\b/g, '1511CBL'],
    ],
  },
  {
    a: 'S16_EmptyNestA.xml', b: 'S16_EmptyNestB.xml',
    subs: [
      [/Data\[1\]\.7\b/g, 'Data[1].6'],                                     // vb01 input 15 (Left) -> 14 (Right)
      [/\binput 15\b/g, 'input 14'], [/\bpoint 15\b/g, 'point 14'], [/\bIN7\b/g, 'IN6'], [/\bbit 7\b/g, 'bit 6'],
      [/\b1532PEC\b/g, '1528PEC'], [/\b1532CBL\b/g, '1528CBL'],
    ],
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const applySubs = (text, subs) => subs.reduce((t, [re, rep]) => t.replace(re, rep), text);
const tagDecls = (xml) => [...xml.matchAll(/<Tag\s+Name="([^"]+)"([^>]*)>/g)].map((m) => ({ name: m[1], usage: (m[2].match(/\sUsage="([^"]+)"/) || [])[1] || 'Local', dataType: (m[2].match(/\sDataType="([^"]+)"/) || [])[1] || '' }));
const cdatas = (xml) => [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => ({ text: m[1], index: m.index }));
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

const findings = [];
const fail = (file, rule, msg) => findings.push({ file, rule, msg });
const NON_BLOCKING = new Set(['xref-pending', 'xref-v0', 'controller-tag-requested']);

// controller-scope declarations
function controllerNames() {
  const names = new Set();
  const src = [];
  const built = path.join(CTRL_DIR, 'ControllerTags.xml');
  if (fs.existsSync(built)) { for (const t of tagDecls(read(built))) names.add(t.name); src.push(path.relative(ROOT, built).replace(/\\/g, '/')); }
  else {
    for (const t of tagDecls(read(path.join(REF_DIR, 'ControllerTags.xml')))) names.add(t.name);
    src.push('ref/ChassisStandard_2UP/ControllerTags.xml (build/controller/ControllerTags.xml not delivered yet)');
    if (fs.existsSync(V0_CTRL)) { for (const t of tagDecls(read(V0_CTRL))) if (/_(IN|OUT)$/.test(t.name)) names.add(t.name); src.push('build_v0 buffer tags (_IN/_OUT)'); }
    for (const a of CONTRACT_ANGLES) names.add(a); src.push('NAMES_CONTRACT angle seeds (g_S##_*Angle)');
  }
  return { names, src };
}
const CTRL = controllerNames();

// parameters of a referenced program: build/programs first, then the template ref piece, then v0 (flagged)
function programParams(prog) {
  const cands = [[path.join(PROG_DIR, `${prog}.xml`), false], [path.join(REF_DIR, `Program_${prog}.xml`), false], [path.join(V0_DIR, `${prog}.xml`), true]];
  for (const [f, viaV0] of cands) if (fs.existsSync(f)) {
    const xml = read(f);
    return { file: path.relative(ROOT, f).replace(/\\/g, '/'), viaV0, params: new Map(tagDecls(xml).map((t) => [t.name, t.usage])) };
  }
  return null;
}

// operand extraction: NAME(arg,arg,...) — the listeners have no nested parentheses inside instruction args
function operands(rungText) {
  const out = [];
  for (const m of rungText.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)/g)) {
    const instr = m[1];
    const args = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    args.forEach((arg, i) => {
      if (instr === 'JSR' && i === 0) return;
      if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(arg) || arg === '?' || /^'.*'$/.test(arg)) return;
      out.push({ instr, arg });
    });
  }
  return out;
}

function lint(file, xml, side) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // ASCII in CDATA
  for (const c of cdatas(xml)) { const bad = c.text.match(/[^\x09\x0A\x0D\x20-\x7E]/); if (bad) fail(rel, 'ascii', `non-ASCII char U+${bad[0].codePointAt(0).toString(16)} at line ${lineOf(xml, c.index)}`); }
  // Use= attributes
  for (const m of xml.matchAll(/<[A-Za-z][^>]*\sUse="([^"]+)"/g)) fail(rel, 'use-attribute', `Use="${m[1]}" at line ${lineOf(xml, m.index)}`);
  // Description <= 512
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Description>/g)) if (m[1].length > 512) fail(rel, 'description-length', `Description ${m[1].length} chars (> 512) at line ${lineOf(xml, m.index)}`);
  // STRING LEN == DATA
  for (const m of xml.matchAll(/<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="(\d+)"\/>\s*<DataValueMember Name="DATA" DataType="STRING[0-9]*" Radix="ASCII">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    const len = Number(m[1]); const data = m[2].replace(/^'/, '').replace(/'$/, '');
    if (len !== data.length) fail(rel, 'string-len', `LEN ${len} but DATA is ${data.length} chars ("${data}") at line ${lineOf(xml, m.index)}`);
    if (data.length > 82) fail(rel, 'string-len', `STRING literal ${data.length} chars (> 82) at line ${lineOf(xml, m.index)}`);
  }
  // side-total: the A twin must carry only Left/LT side words, the B twin only Right/RT (so subst(A) is the whole story)
  const strayRe = side === 'A' ? /\bRight\b|\bRT\b|\bright\b|\bleft\b|\bSide B\b|PartStatusRT|PartStatusLT|LockoutRT|LockoutLT/g : /Left|\bLT\b|\bright\b|\bleft\b|\bSide A\b|PartStatusRT|PartStatusLT|LockoutRT|LockoutLT/g;
  const stray = [...new Set((xml.match(strayRe) || []))];
  if (stray.length) fail(rel, 'side-words', `${side} twin carries the other side's words: ${stray.join(', ')}`);
  // program name matches file
  const progName = (xml.match(/<Program Name="([^"]+)"/) || [])[1];
  if (progName !== path.basename(file, '.xml')) fail(rel, 'program-name', `<Program Name="${progName}"> does not match the file name`);
  if (!CONTRACT_PROGRAMS.has(progName)) fail(rel, 'contract', `${progName} is not a NAMES CONTRACT v2.1 program`);
  // duplicate tags
  const tags = tagDecls(xml);
  const seen = new Set(); for (const t of tags) { if (seen.has(t.name)) fail(rel, 'duplicate-tag', `Tag ${t.name} declared twice`); seen.add(t.name); }
  if (!tags.some((t) => t.name === 'q_AlarmActive' && t.usage === 'Output') || !tags.some((t) => t.name === 'q_WarningActive' && t.usage === 'Output')) fail(rel, 'contract', 'every program declares Output BOOL q_AlarmActive and q_WarningActive');
  for (const t of tags) if (/^(i_|q_|iq_|p_)/.test(t.name) && t.usage === 'Local') fail(rel, 'parameter-usage', `${t.name} carries a parameter prefix but no Usage=`);
  const local = new Set(tags.map((t) => t.name));
  // routines / rungs
  const routines = [...xml.matchAll(/<Routine Name="([^"]+)"[^>]*>([\s\S]*?)<\/Routine>/g)];
  const usedCtrl = new Set(); const xrefs = new Map(); const undeclared = new Map();
  for (const r of routines) {
    const rungs = [...r[2].matchAll(/<Rung Number="(\d+)"[^>]*>([\s\S]*?)<\/Rung>/g)];
    rungs.forEach((rg, i) => { if (Number(rg[1]) !== i) fail(rel, 'rung-numbering', `${r[1]}: rung ${rg[1]} at position ${i}`); });
    if (r[1] === 'R02_StateTransitions') for (const rg of rungs) { const t = (rg[2].match(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || ''; if (/\bOTL\(|\bOTU\(|\bADD\(|\bCONCAT\(/.test(t)) fail(rel, 'r02-transitions-only', `${r[1]} rung ${rg[1]} carries a latch/counter/tracking write (Jason: transitions only)`); }
    for (const rg of rungs) {
      const text = (rg[2].match(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || '';
      if ((text.match(/\(/g) || []).length !== (text.match(/\)/g) || []).length || (text.match(/\[/g) || []).length !== (text.match(/\]/g) || []).length) fail(rel, 'rung-balance', `${r[1]} rung ${rg[1]}: unbalanced () or []`);
      if (!/;\s*$/.test(text)) fail(rel, 'rung-terminator', `${r[1]} rung ${rg[1]}: text does not end with ';'`);
      for (const { instr, arg } of operands(text)) {
        if (arg.startsWith('\\')) {
          const prog = arg.slice(1).split('.')[0]; const member = arg.slice(1 + prog.length + 1).split(/[.[]/)[0];
          if (!CONTRACT_PROGRAMS.has(prog)) { fail(rel, 'xref-program', `${r[1]} rung ${rg[1]}: ${arg} — "${prog}" is not a NAMES CONTRACT v2.1 program`); continue; }
          const key = `\\${prog}.${member}`; if (!xrefs.has(key)) xrefs.set(key, `${r[1]} rung ${rg[1]}`);
          continue;
        }
        const root = arg.split(/[.[]/)[0];
        if (local.has(root)) continue;
        if (/^S:/.test(root)) continue; // controller status flags (S:FS first scan) — template Tracking / Jason's escapements use them
        if (CTRL.names.has(root)) { usedCtrl.add(root); continue; }
        if (!undeclared.has(root)) undeclared.set(root, `${r[1]} rung ${rg[1]}: ${instr}(${arg})`);
      }
    }
  }
  for (const [root, where] of undeclared) fail(rel, REQUESTED_ANGLES.includes(root) ? 'controller-tag-requested' : 'undeclared-tag', `${root} is declared nowhere (program / controller / contract) — first use ${where}`);
  // cross-program parameter resolution
  for (const [key, where] of xrefs) {
    const [prog, member] = key.slice(1).split('.');
    const target = programParams(prog);
    if (!target) { fail(rel, 'xref-pending', `${key} (${where}) — program ${prog} not delivered yet (contract program; resolve at assembly)`); continue; }
    const usage = target.params.get(member);
    if (!usage) fail(rel, 'xref-missing', `${key} (${where}) — no tag ${member} in ${target.file}`);
    else if (!['Public', 'Output', 'Input', 'InOut'].includes(usage)) fail(rel, 'xref-not-parameter', `${key} (${where}) — ${member} in ${target.file} is ${usage}, not a parameter`);
    else if (target.viaV0) fail(rel, 'xref-v0', `${key} (${where}) — resolved against the v0 program ${target.file} (${usage}); the v2.1 program must keep this parameter`);
  }
  return { progName, tags: tags.length, routines: routines.map((r) => r[1]), usedCtrl: [...usedCtrl].sort(), xrefs: [...xrefs.keys()].sort() };
}

// ── run ──────────────────────────────────────────────────────────────────────
const manifest = { contract: 'NAMES_CONTRACT v2.1 (A = LEFT nest, B = RIGHT nest)', generatedAt: new Date().toISOString(), controllerScopeSource: CTRL.src, twins: [] };
for (const tw of TWINS) {
  const aFile = path.join(PROG_DIR, tw.a); const bFile = path.join(PROG_DIR, tw.b);
  if (!fs.existsSync(aFile)) { fail(tw.a, 'missing', 'A twin not found'); continue; }
  const aText = read(aFile);
  const subs = [...COMMON_SUBS, ...tw.subs];
  const bExpected = applySubs(aText, subs);
  if (!CHECK_ONLY) fs.writeFileSync(bFile, bExpected, 'utf8');
  if (!fs.existsSync(bFile)) { fail(tw.b, 'missing', 'B twin not found (run without --check to generate)'); continue; }
  const bText = read(bFile);
  if (bText !== bExpected) fail(tw.b, 'twin-drift', 'B twin differs from subst(A) — B was edited by hand; edit A and regenerate');
  // diff-verify: only substituted tokens may differ
  const al = aText.split('\n'); const bl = bText.split('\n');
  const diffs = [];
  if (al.length !== bl.length) fail(tw.b, 'twin-shape', `line count differs A=${al.length} B=${bl.length}`);
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] === bl[i]) continue;
    const ok = applySubs(al[i] || '', subs) === (bl[i] || '');
    diffs.push({ line: i + 1, a: al[i], b: bl[i], ok });
    if (!ok) fail(tw.b, 'twin-diff', `line ${i + 1} differs by more than the substitution table`);
  }
  const la = lint(aFile, aText, 'A'); const lb = lint(bFile, bText, 'B');
  manifest.twins.push({
    a: { file: path.relative(ROOT, aFile).replace(/\\/g, '/'), program: la.progName, tags: la.tags, routines: la.routines, controllerTagsUsed: la.usedCtrl, crossProgramRefs: la.xrefs },
    b: { file: path.relative(ROOT, bFile).replace(/\\/g, '/'), program: lb.progName, tags: lb.tags, routines: lb.routines, controllerTagsUsed: lb.usedCtrl, crossProgramRefs: lb.xrefs },
    diffLines: diffs.length,
    diff: diffs.map((d) => `L${d.line}${d.ok ? '' : ' !!'}: ${summarize(d.a, d.b)}`),
  });
}

function summarize(a, b) {
  // show only the changed tokens of a line pair, compactly
  const ta = a.split(/(\s+|[(),\[\]])/); const tb = b.split(/(\s+|[(),\[\]])/);
  const ch = [];
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) if (ta[i] !== tb[i]) ch.push(`${ta[i] ?? ''} -> ${tb[i] ?? ''}`);
  const s = ch.join(' | ');
  return s.length > 220 ? s.slice(0, 217) + '...' : s;
}

// controller-scope angle tags the twins need (for the controller builder), with the contract seeds
const usedAngles = new Set(manifest.twins.flatMap((t) => [...t.a.controllerTagsUsed, ...t.b.controllerTagsUsed]).filter((n) => /Angle$/.test(n)));
manifest.angleTagsRequired = [...usedAngles].sort().map((n) => ({ name: n, dataType: 'REAL', seed: CONTRACT_ANGLE_SEEDS[n] ?? null, source: CONTRACT_ANGLE_SEEDS[n] != null ? 'NAMES_CONTRACT v2.1 angle seeds — declare in build/controller/ControllerTags.xml' : 'template ControllerTags.xml (already declared)' }));
manifest.findings = findings;
manifest.blocking = findings.filter((f) => !NON_BLOCKING.has(f.rule)).length;
manifest.requestedControllerTags = REQUESTED_ANGLES;
const outFile = path.join(PROG_DIR, 'TWINS_MANIFEST.json');
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf8');

for (const t of manifest.twins) {
  console.log(`\n== ${t.a.program} / ${t.b.program}  (${t.a.tags} tags, routines ${t.a.routines.join(' ')})`);
  console.log(`   controller tags used: ${t.a.controllerTagsUsed.join(', ')}`);
  console.log(`   cross-program refs  : ${t.a.crossProgramRefs.join(', ')}`);
  console.log(`   A/B diff: ${t.diffLines} line(s)`);
  for (const d of t.diff) console.log(`     ${d}`);
}
console.log(`\ncontroller-scope names resolved from: ${CTRL.src.join(' + ')}`);
console.log(`angle tags required: ${manifest.angleTagsRequired.map((a) => `${a.name}${a.seed != null ? `=${a.seed}` : ' (template)'}`).join(', ')}`);
if (findings.length) {
  console.log(`\nFINDINGS (${findings.length}, ${manifest.blocking} blocking):`);
  for (const f of findings) console.log(`  [${f.rule}]${NON_BLOCKING.has(f.rule) ? ' (note)' : ''} ${f.file}: ${f.msg}`);
} else console.log('\nno findings');
console.log(`manifest: ${path.relative(ROOT, outFile).replace(/\\/g, '/')}`);
process.exit(manifest.blocking ? 1 : 0);
