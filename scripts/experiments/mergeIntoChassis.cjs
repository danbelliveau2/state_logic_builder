#!/usr/bin/env node
'use strict';
/**
 * mergeIntoChassis.cjs — EXPERIMENT (2026-09-15)
 *
 * QUESTION: can an existing generated station program (MidBaseLoad v1.4.1,
 * Jason-reviewed, two programs) be folded into the SDC chassis CONTROLLER
 * template (ChassisStandard_1UP.L5X) with the shipped mergePrograms() as-is, and
 * does the result pass simulateImport + validateL5X?  Groundwork for the
 * job-1160 whole-machine build (16 stations on the chassis).
 *
 * Two assemblies are produced from the SAME inputs so the report separates
 * "mergePrograms defect" from "true semantic gap":
 *   A. AS-IS   — mergePrograms(base, station, name) per target program.
 *   B. CORRECTED — a minimal programAssembler sketch (local to this script):
 *      strips Use="Target", carries the REAL controller-scope tags, does not
 *      carry Use="Context" stub programs into a controller export, carries
 *      ParameterConnections, schedules the stations in the station block of
 *      MainTask (after the last S##_ program, before Production).
 *
 * Nothing under src/ is touched.  Outputs → generated/_experiments/.
 *
 * Run:  node scripts/experiments/mergeIntoChassis.cjs
 *       [--station=<path.L5X>] [--base=<path.L5X>] [--out=<dir>]
 *       [--renumber=NN]   rename S01_X → SNN_X (program names + \refs only)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { mergePrograms, targetProgramNameOf, asciiFoldL5x } =
  require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'multiProgram.js'));
const { validateL5X } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'validator.js'));
const { simulateImport } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'importSimValidator.js'));
const { XMLValidator } = require('fast-xml-parser');

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BASE_PATH = path.resolve(ROOT, argOf('base', 'plc-reference/training-material/SDC Standard Templates/ChassisStandard_1UP.L5X'));
const STATION_PATH = path.resolve(ROOT, argOf('station', 'SDC Engineer Deliveries/MidBaseLoad__sdce_v1.4.1__2026-08-31_1845.L5X'));
const OUT_DIR = path.resolve(ROOT, argOf('out', 'generated/_experiments'));
const RENUMBER = argOf('renumber', null);
const LABEL = argOf('label', path.basename(STATION_PATH).split('__')[0] || 'Station');

// The station's sheet devices (both machines) — drives validateL5X's tag-level
// device audit; same list regressImportRejections.cjs uses for this file.
const DEVICES = [
  { name: 'Escapement_Finger_1', type: 'PneumaticLinearActuator' },
  { name: 'Escapement_Shuttle', type: 'PneumaticLinearActuator' },
  { name: 'Shuttle_Gripper', type: 'PneumaticGripper' },
  { name: 'Nest_Part_Present', type: 'DigitalSensor' },
  { name: 'X_Axis', type: 'ServoAxis' },
  { name: 'Vertical_Slide', type: 'PneumaticLinearActuator' },
  { name: 'PNP_Gripper', type: 'PneumaticGripper' },
];
const DEVICE_OPTS = { deviceNames: DEVICES.map((d) => d.name), devices: DEVICES };

// ── helpers ─────────────────────────────────────────────────────────────────
const stripBom = (s) => s.replace(/^﻿/, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const attrOf = (open, name) => (open.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] ?? null;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
// Export-shape noise: Program-target exports (ExportOptions="…Dependencies…")
// wrap each UDT/AOI with a <Dependencies> block and carry their own edit stamps.
const stripMeta = (s) => norm(s.replace(/<Dependencies>[\s\S]*?<\/Dependencies>/g, '').replace(/\b(CreatedDate|EditedDate|CreatedBy|EditedBy|SoftwareRevision)="[^"]*"/g, ''));
const cap = (arr, n = 60) => (arr.length > n ? [...arr.slice(0, n), `…(+${arr.length - n} more)`] : arr);
const multisetDiff = (a, b) => { // a − b, by string
  const counts = new Map(); for (const x of b) counts.set(x, (counts.get(x) || 0) + 1);
  return a.filter((x) => { const c = counts.get(x) || 0; if (c > 0) { counts.set(x, c - 1); return false; } return true; });
};
const stationPrefixOf = (name) => (name.match(/^S(\d{2})_/) || [])[1] ?? null;

function parseTagDecls(sectionXml) {
  const out = new Map(); // name → { dataType, usage, cls, use, open, block }
  for (const m of sectionXml.matchAll(/<Tag\s+([^>]*?)(\/?)>/g)) {
    const attrs = m[1];
    const name = attrOf(attrs, 'Name');
    if (!name) continue;
    let block = m[0];
    if (m[2] !== '/') {
      const close = sectionXml.indexOf('</Tag>', m.index);
      if (close > 0) block = sectionXml.slice(m.index, close + 6);
    }
    out.set(name, {
      dataType: attrOf(attrs, 'DataType'), usage: attrOf(attrs, 'Usage'),
      cls: attrOf(attrs, 'Class'), use: attrOf(attrs, 'Use'), open: m[0], block,
    });
  }
  return out;
}
function ctrlTagsSection(xml) {
  const progsStart = xml.indexOf('<Programs');
  const slice = progsStart > 0 ? xml.slice(0, progsStart) : xml;
  const m = slice.match(/<Tags(?:\s[^>]*)?>[\s\S]*?<\/Tags>/);
  return m ? { xml: m[0], open: m[0].match(/<Tags[^>]*>/)[0], start: m.index, end: m.index + m[0].length } : null;
}
function crossRefsOf(body) {
  const refs = new Map(); // "\Prog.tag" → count
  for (const t of body.matchAll(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g)) {
    for (const r of t[1].matchAll(/\\([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const k = `\\${r[1]}.${r[2]}`; refs.set(k, (refs.get(k) || 0) + 1);
    }
  }
  return refs;
}
function programsOf(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Program\s([^>]*)>([\s\S]*?)<\/Program>/g)) {
    const open = m[1]; const body = m[2];
    const tagsM = body.match(/<Tags(?:\s[^>]*)?>[\s\S]*?<\/Tags>/);
    out.push({
      name: attrOf(open, 'Name'), use: attrOf(open, 'Use'), cls: attrOf(open, 'Class'),
      hasRoutines: /<Routine\s/.test(body),
      routines: [...body.matchAll(/<Routine\s[^>]*\bName="([^"]+)"/g)].map((r) => r[1]),
      tags: tagsM ? parseTagDecls(tagsM[0]) : new Map(),
      crossRefs: crossRefsOf(body),
      block: m[0], start: m.index, end: m.index + m[0].length,
    });
  }
  return out;
}
function namedBlocks(xml, tag) {
  const out = new Map();
  for (const m of xml.matchAll(new RegExp(`<${tag}\\s([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'))) {
    const name = attrOf(m[1], 'Name'); if (!name) continue;
    out.set(name, { open: m[1], body: m[2], block: m[0], revision: attrOf(m[1], 'Revision'), use: attrOf(m[1], 'Use') });
  }
  return out;
}
function tasksOf(xml) {
  return [...xml.matchAll(/<Task\s([^>]*)>([\s\S]*?)<\/Task>/g)].map((m) => ({
    name: attrOf(m[1], 'Name'), type: attrOf(m[1], 'Type'), cls: attrOf(m[1], 'Class'),
    programs: [...m[2].matchAll(/<ScheduledProgram\s+Name="([^"]+)"/g)].map((s) => s[1]),
  }));
}
const paramConnsOf = (xml) => [...xml.matchAll(/<ParameterConnection\s+EndPoint1="([^"]+)"\s+EndPoint2="([^"]+)"\s*\/>/g)].map((m) => ({ ep1: m[1], ep2: m[2] }));
const modulesOf = (xml) => new Set([...xml.matchAll(/<Module\s[^>]*\bName="([^"]+)"/g)].map((m) => m[1]));
function renameProgram(xml, from, to) {
  const f = esc(from);
  return xml
    .replace(new RegExp(`(<Program\\s[^>]*\\bName=")${f}(")`, 'g'), `$1${to}$2`)
    .replace(new RegExp(`(<ScheduledProgram\\s+Name=")${f}(")`, 'g'), `$1${to}$2`)
    .replace(new RegExp(`\\\\${f}\\.`, 'g'), `\\${to}.`)
    .replace(new RegExp(`(TargetName=")${f}(")`), `$1${to}$2`);
}
/** Resolve a "\Prog.tag" reference against a merged file. */
function resolveCrossRef(ref, programs) {
  const m = ref.match(/^\\([^.]+)\.(.+)$/); if (!m) return { status: 'unparsed' };
  const [, prog, tag] = m;
  const hits = programs.filter((p) => p.name === prog);
  if (!hits.length) return { status: 'missing-program', prog, tag };
  const real = hits.find((p) => p.use !== 'Context' && p.hasRoutines);
  if (!real) return { status: 'context-stub-only', prog, tag };
  const decl = real.tags.get(tag);
  if (!decl) return { status: 'missing-tag', prog, tag };
  if (!decl.usage) return { status: 'not-a-parameter', prog, tag, dataType: decl.dataType };
  return { status: 'ok', prog, tag, usage: decl.usage, dataType: decl.dataType };
}
function runValidators(xml, label) {
  const t0 = Date.now();
  const wf = XMLValidator.validate(xml);
  const sim = simulateImport(xml);
  const valPlain = validateL5X(xml, {});
  const valDev = validateL5X(xml, DEVICE_OPTS);
  return {
    label, ms: Date.now() - t0,
    wellFormed: wf === true ? true : `${wf.err.msg} (line ${wf.err.line})`,
    simulateImport: { ok: sim.ok, errors: sim.errors ?? [], warnings: sim.warnings ?? [] },
    validateL5X: { ok: valPlain.ok, errors: valPlain.errors ?? [], warnings: valPlain.warnings ?? [] },
    validateL5X_withDevices: { ok: valDev.ok, errors: valDev.errors ?? [], warnings: valDev.warnings ?? [] },
  };
}
const summarizeVal = (v) => `${v.label}: wellFormed=${v.wellFormed === true} sim=${v.simulateImport.ok ? 'PASS' : 'FAIL'}(${v.simulateImport.errors.length}) `
  + `validateL5X=${v.validateL5X.ok ? 'PASS' : 'FAIL'}(${v.validateL5X.errors.length}e/${v.validateL5X.warnings.length}w) `
  + `withDevices=${v.validateL5X_withDevices.ok ? 'PASS' : 'FAIL'}(${v.validateL5X_withDevices.errors.length}e/${v.validateL5X_withDevices.warnings.length}w) [${v.ms}ms]`;

// ── load ────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const base = stripBom(fs.readFileSync(BASE_PATH, 'utf8'));
let other = asciiFoldL5x(stripBom(fs.readFileSync(STATION_PATH, 'utf8')));

const report = {
  experiment: 'mergeIntoChassis', date: new Date().toISOString(),
  inputs: { base: BASE_PATH, station: STATION_PATH, renumber: RENUMBER, label: LABEL },
  findings: [],
};
const finding = (severity, title, detail) => { report.findings.push({ severity, title, ...(detail ? { detail } : {}) }); };

// ── 1. base survey ──────────────────────────────────────────────────────────
const baseProgs = programsOf(base);
const baseCtrl = ctrlTagsSection(base);
const baseCtrlTags = baseCtrl ? parseTagDecls(baseCtrl.xml) : new Map();
const baseDTs = namedBlocks(base, 'DataType');
const baseAOIs = namedBlocks(base, 'AddOnInstructionDefinition');
const baseTasks = tasksOf(base);
const baseAllTagNames = new Set([...base.matchAll(/<Tag\s+[^>]*Name="([^"]+)"/g)].map((m) => m[1]));
const baseRoot = base.match(/<RSLogix5000Content\s[^>]*>/)[0];
const baseCtrlOpen = base.match(/<Controller\s[^>]*>/)[0];
report.base = {
  targetType: attrOf(baseRoot, 'TargetType'), containsContext: attrOf(baseRoot, 'ContainsContext'),
  controller: { name: attrOf(baseCtrlOpen, 'Name'), processor: attrOf(baseCtrlOpen, 'ProcessorType'), majorRev: attrOf(baseCtrlOpen, 'MajorRev') },
  programs: baseProgs.map((p) => `${p.name}${p.cls === 'Safety' ? ' (Safety)' : ''}`),
  tasks: baseTasks,
  controllerTags: [...baseCtrlTags.keys()],
  dataTypes: [...baseDTs.keys()], aois: [...baseAOIs.keys()],
  modules: [...modulesOf(base)].length,
  parameterConnections: paramConnsOf(base),
};
// Chassis-native pattern: what the chassis's own station programs reference.
const nativeS01 = baseProgs.find((p) => /^S01_/.test(p.name));
const chassisStatusUdt = baseDTs.get('Chassis_Status');
report.base.chassisNativePattern = {
  program: nativeS01?.name ?? null,
  crossRefs: nativeS01 ? [...nativeS01.crossRefs.keys()].sort() : [],
  chassisProgramParams: [...(baseProgs.find((p) => p.name === 'Chassis')?.tags ?? new Map()).entries()].filter(([, d]) => d.usage).map(([n, d]) => `${n}:${d.usage}`),
  chassisStatusMembers: chassisStatusUdt ? [...chassisStatusUdt.body.matchAll(/<Member\s+Name="([^"]+)"\s+DataType="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`) : [],
};

// ── 2. station survey ───────────────────────────────────────────────────────
const otherProgs0 = programsOf(other);
const otherRoot = other.match(/<RSLogix5000Content\s[^>]*>/)[0];
const otherTargets0 = otherProgs0.filter((p) => p.use === 'Target').map((p) => p.name);
if (!otherTargets0.length) { console.error('No Use="Target" programs in the station file'); process.exit(2); }

// Collisions + renames (exact-name collision → rename; --renumber → SNN_ prefix).
const renames = [];
for (const t of otherTargets0) {
  let to = t;
  if (RENUMBER) to = to.replace(/^S\d{2}_/, `S${String(RENUMBER).padStart(2, '0')}_`);
  if (baseProgs.some((p) => p.name === to)) to = `${to}_${LABEL}`;
  if (to !== t) renames.push({ from: t, to });
}
for (const r of renames) other = renameProgram(other, r.from, r.to);
const otherProgs = programsOf(other);
const otherTargets = otherProgs.filter((p) => p.use === 'Target');
const otherContexts = otherProgs.filter((p) => p.use === 'Context');
const otherCtrl = ctrlTagsSection(other);
const otherCtrlTags = otherCtrl ? parseTagDecls(otherCtrl.xml) : new Map();
const otherDTs = namedBlocks(other, 'DataType');
const otherAOIs = namedBlocks(other, 'AddOnInstructionDefinition');
const otherConns = paramConnsOf(other);

const exactCollisions = otherTargets0.filter((n) => baseProgs.some((p) => p.name === n));
const prefixCollisions = otherTargets.map((p) => ({
  program: p.name, prefix: stationPrefixOf(p.name),
  chassisProgramsWithSamePrefix: baseProgs.filter((b) => stationPrefixOf(b.name) && stationPrefixOf(b.name) === stationPrefixOf(p.name)).map((b) => b.name),
})).filter((c) => c.chassisProgramsWithSamePrefix.length);

report.station = {
  targetType: attrOf(otherRoot, 'TargetType'), containsContext: attrOf(otherRoot, 'ContainsContext'), targetName: attrOf(otherRoot, 'TargetName'),
  targetPrograms: otherTargets.map((p) => ({ name: p.name, routines: p.routines, localTags: p.tags.size, params: [...p.tags.entries()].filter(([, d]) => d.usage).map(([n, d]) => `${n}:${d.usage}`), crossRefs: [...p.crossRefs.keys()].sort() })),
  contextPrograms: otherContexts.map((p) => ({ name: p.name, referencedTags: [...p.tags.keys()] })),
  controllerTagsOpenTag: otherCtrl?.open ?? null,
  controllerTags: [...otherCtrlTags.entries()].map(([n, d]) => `${n}:${d.dataType}${d.cls ? '' : ' (no Class attr — hoisted?)'}`),
  dataTypes: [...otherDTs.keys()], aois: [...otherAOIs.keys()],
  parameterConnections: otherConns,
  hasModulesSection: /<Modules[\s>]/.test(other),
  renames, exactCollisions, prefixCollisions,
};
if (exactCollisions.length) finding('info', `Exact program-name collisions renamed: ${exactCollisions.join(', ')}`, renames);
if (prefixCollisions.length) finding('warn', `Station-number prefix collision: ${prefixCollisions.map((c) => `${c.program} vs ${c.chassisProgramsWithSamePrefix.join('/')}`).join('; ')}`,
  'Chassis template already owns S01/S02/S03/S18/S19/S20. Job 1160 needs an authoritative station-number map; program names AND tag names (a03_S01PNPXAxis, sd03_S01PNPXAxis) carry the number.');

// Pre-merge overlap analysis (what dedupe-by-name will silently keep from the base).
const bodyDiff = (a, b) => (norm(a.block) === norm(b.block) ? 'identical' : stripMeta(a.block) === stripMeta(b.block) ? 'export-shape/metadata-only' : 'DIFFERS');
report.overlap = {
  dataTypes: [...otherDTs.keys()].filter((n) => baseDTs.has(n)).map((n) => ({ name: n, body: bodyDiff(baseDTs.get(n), otherDTs.get(n)) })),
  aois: [...otherAOIs.keys()].filter((n) => baseAOIs.has(n)).map((n) => ({ name: n, body: bodyDiff(baseAOIs.get(n), otherAOIs.get(n)), revision: `${baseAOIs.get(n).revision} vs ${otherAOIs.get(n).revision}` })),
  controllerTags: [...otherCtrlTags.keys()].filter((n) => baseCtrlTags.has(n)).map((n) => ({ name: n, body: bodyDiff(baseCtrlTags.get(n), otherCtrlTags.get(n)) })),
  // mergePrograms dedupes controller tags against EVERY <Tag Name= in the base (program scope included):
  ctrlTagsShadowedByBaseProgramScope: [...otherCtrlTags.keys()].filter((n) => !baseCtrlTags.has(n) && baseAllTagNames.has(n)),
  // station controller tags that are ALSO local in one of its own programs:
  ctrlTagsAlsoLocalInStation: [...otherCtrlTags.keys()].filter((n) => otherTargets.some((p) => p.tags.has(n))),
};
const dtDiff = report.overlap.dataTypes.filter((d) => d.body === 'DIFFERS');
const aoiDiff = report.overlap.aois.filter((d) => d.body === 'DIFFERS');
if (dtDiff.length) finding('warn', `Shared DataTypes whose bodies DIFFER (base body kept silently): ${dtDiff.map((d) => d.name).join(', ')}`);
if (aoiDiff.length) finding('warn', `Shared AOIs whose bodies DIFFER (base body kept silently): ${aoiDiff.map((d) => `${d.name} [${d.revision}]`).join(', ')}`);
{
  const shapeOnly = [...report.overlap.dataTypes, ...report.overlap.aois].filter((d) => d.body === 'export-shape/metadata-only').map((d) => d.name);
  if (shapeOnly.length) finding('info', `Shared UDT/AOI definitions differ only in export shape (<Dependencies> block, EditedDate): ${shapeOnly.join(', ')} — members/params/rungs identical; dedupe-by-name keeping the chassis body is safe here. The assembler still needs a body-compare gate: same name + different logic must be a hard stop, not a silent keep.`);
}
if (report.overlap.ctrlTagsShadowedByBaseProgramScope.length) {
  const owners = (n) => baseProgs.filter((p) => p.tags.has(n)).map((p) => `${p.name}.${n}${p.tags.get(n).usage ? `:${p.tags.get(n).usage}` : ''}`).join(', ');
  finding('error', `Station controller tags DROPPED by mergePrograms because a chassis PROGRAM-scope tag has the same name: ${report.overlap.ctrlTagsShadowedByBaseProgramScope.join(', ')}`,
    `dedupe key is every <Tag Name= in the base, not controller scope — owners: ${report.overlap.ctrlTagsShadowedByBaseProgramScope.map(owners).join('; ')}`);
}

// Replicate mergePrograms step 2's capture to show WHAT it actually sweeps.
// The regex /<Controller[\s\S]*?<Tags>[\s\S]*?<\/Tags>/ needs a PLAIN <Tags>;
// a Program-target export opens its controller section as <Tags Use="Context">,
// so the span runs from <Controller> to the first plain </Tags> — i.e. through
// the real controller tags, every context stub's <Tag Use="Reference">, and the
// FIRST target program's local tags. Every <Tag> in that span is then added
// unless its NAME appears anywhere in the base (program scope included).
{
  const capM = other.match(/<Controller[\s\S]*?<Tags>[\s\S]*?<\/Tags>/);
  const swept = { realCtrl: 0, ctxReference: 0, ctxReferenceWouldLeak: [], programLocal: 0, programLocalOwner: null, programLocalWouldLeak: [] };
  if (capM) {
    const progsStart = other.indexOf('<Programs');
    const tagsPos = capM.index + capM[0].lastIndexOf('<Tags>');
    const owner = progsStart > 0 && tagsPos > progsStart ? otherProgs.filter((p) => p.start < tagsPos).pop() : null;
    swept.programLocalOwner = owner?.name ?? null;
    // Step 1 appends the target program BEFORE step 2 builds its dedupe set, so
    // the owner's own locals are "already in the base" — the local-tag leak is
    // self-neutralized by ordering (accidentally, not by design).
    for (const m of capM[0].matchAll(/<Tag\s[\s\S]*?<\/Tag>|<Tag\s[^>]*\/>/g)) {
      const open = m[0].match(/<Tag\s[^>]*>/)[0]; const name = attrOf(open, 'Name'); const pos = capM.index + m.index;
      if (pos < progsStart && otherCtrlTags.has(name)) swept.realCtrl++;
      else if (attrOf(open, 'Use') === 'Reference') { swept.ctxReference++; if (!baseAllTagNames.has(name)) swept.ctxReferenceWouldLeak.push(name); }
      else if (pos > progsStart) { swept.programLocal++; if (!baseAllTagNames.has(name) && !(owner?.tags.has(name))) swept.programLocalWouldLeak.push(name); }
    }
  }
  report.overlap.mergeProgramsStep2 = {
    controllerTagsOpenTag: otherCtrl?.open ?? null,
    spanEndsIn: swept.programLocalOwner ? `program "${swept.programLocalOwner}" <Tags>` : 'controller <Tags>',
    ...swept,
  };
  if (swept.programLocalOwner) finding('error', `mergePrograms step 2 sweeps <Controller>…first plain </Tags>: ${swept.realCtrl} real controller tags + ${swept.ctxReference} context <Tag Use="Reference"> stubs + ${swept.programLocal} PROGRAM-local tags of "${swept.programLocalOwner}", deduped against EVERY tag name in the file (program scope included)`,
    `Local-tag leak: ${swept.programLocalWouldLeak.length} (self-neutralized only because step 1 appends the program before step 2 dedupes). `
    + `Context reference stubs (<Tag Use="Reference">, no DataType) that would land in controller scope: ${swept.ctxReferenceWouldLeak.join(', ') || 'none here — q_WaitStationsComplete blocked only because step 1b carried the S00_IndexerSP stub first'}. `
    + `The dedupe key (any <Tag Name= in the file) is what does damage: see the DROPPED finding.`);
}

// ── 3A. AS-IS merge via mergePrograms ───────────────────────────────────────
let mergedA = base;
const mergeLog = [];
for (const p of otherTargets) {
  const t0 = Date.now();
  try {
    const real = targetProgramNameOf(other, p.name);
    mergedA = mergePrograms(mergedA, other, p.name);
    mergeLog.push({ program: p.name, resolvedTarget: real, ok: true, ms: Date.now() - t0, sizeAfter: mergedA.length });
  } catch (e) { mergeLog.push({ program: p.name, ok: false, error: String(e.message || e) }); }
}
report.mergeAsIs = { log: mergeLog };

function analyzeMerged(xml, tag) {
  const progs = programsOf(xml);
  const ctrl = ctrlTagsSection(xml);
  const ctrlTags = ctrl ? parseTagDecls(ctrl.xml) : new Map();
  const tasks = tasksOf(xml);
  const conns = paramConnsOf(xml);
  const mods = modulesOf(xml);
  const newProgs = progs.filter((p) => !baseProgs.some((b) => b.name === p.name));
  const addedCtrl = [...ctrlTags.keys()].filter((n) => !baseCtrlTags.has(n));
  const ctrlDupes = (() => { const seen = new Map(); for (const m of (ctrl?.xml ?? '').matchAll(/<Tag\s+[^>]*?Name="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1); return [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n); })();
  const main = tasks.find((t) => t.name === 'MainTask');
  // Cross refs from the NEW programs, resolved against the merged file.
  const refResolution = [];
  for (const p of newProgs.filter((p) => p.hasRoutines)) {
    for (const [ref, count] of p.crossRefs) refResolution.push({ from: p.name, ref, count, ...resolveCrossRef(ref, progs) });
  }
  // InOut parameters of new programs without a ParameterConnection.
  const unconnectedInOut = [];
  for (const p of newProgs.filter((p) => p.hasRoutines)) {
    for (const [n, d] of p.tags) if (d.usage === 'InOut' && !conns.some((c) => c.ep1 === `\\${p.name}.${n}` || c.ep2 === `\\${p.name}.${n}`)) unconnectedInOut.push(`\\${p.name}.${n} (${d.dataType})`);
  }
  // Axis tags: does their MotionModule exist as a <Module>?
  const axisTags = [];
  for (const [n, d] of ctrlTags) if (d.dataType === 'AXIS_CIP_DRIVE') {
    const mm = attrOf(d.block, 'MotionModule'); const mg = attrOf(d.block, 'MotionGroup');
    axisTags.push({ tag: n, motionModule: mm, moduleExists: mm ? mods.has(mm.split(':')[0]) : null, motionGroup: mg, groupExists: mg ? ctrlTags.has(mg) : null, addedByMerge: !baseCtrlTags.has(n) });
  }
  // Program-local tags of new programs that ALSO exist at controller scope (shadowing).
  const shadowed = [];
  for (const p of newProgs.filter((p) => p.hasRoutines)) for (const n of p.tags.keys()) if (ctrlTags.has(n) && !baseCtrlTags.has(n)) shadowed.push(`${p.name}.${n}`);
  return {
    tag, bytes: xml.length,
    programs: progs.map((p) => `${p.name}${p.use ? ` [Use=${p.use}]` : ''}${p.hasRoutines ? '' : ' (no routines)'}`),
    programsAdded: newProgs.map((p) => `${p.name}${p.use ? ` [Use=${p.use}]` : ''}${p.hasRoutines ? '' : ' (stub)'}`),
    useAttrsRemaining: { programTarget: (xml.match(/<Program\s[^>]*Use="Target"/g) || []).length, programContext: (xml.match(/<Program\s[^>]*Use="Context"/g) || []).length, tagsContext: (xml.match(/<Tags\s+Use="Context"/g) || []).length, tagReference: (xml.match(/<Tag\s+Use="Reference"/g) || []).length, paramConnsContext: (xml.match(/<ParameterConnections\s+Use="Context"/g) || []).length },
    tasks,
    mainTaskOrder: main ? main.programs.map((n, i) => `${i}:${n}${baseProgs.some((b) => b.name === n) ? '' : ' (NEW)'}`) : [],
    controllerTags: { before: baseCtrlTags.size, after: ctrlTags.size, added: cap(addedCtrl, 80), addedCount: addedCtrl.length, duplicates: ctrlDupes,
      addedWithoutClassAttr: addedCtrl.filter((n) => !ctrlTags.get(n).cls).length,
      stationRealCtrlTagsMissing: [...otherCtrlTags.keys()].filter((n) => !ctrlTags.has(n)) },
    dataTypes: { before: baseDTs.size, after: namedBlocks(xml, 'DataType').size, added: [...namedBlocks(xml, 'DataType').keys()].filter((n) => !baseDTs.has(n)) },
    aois: { before: baseAOIs.size, after: namedBlocks(xml, 'AddOnInstructionDefinition').size, added: [...namedBlocks(xml, 'AddOnInstructionDefinition').keys()].filter((n) => !baseAOIs.has(n)) },
    parameterConnections: conns, stationConnectionsMissing: otherConns.filter((c) => !conns.some((k) => k.ep1 === c.ep1 && k.ep2 === c.ep2)),
    unconnectedInOut, axisTags, programLocalShadowingCtrl: cap(shadowed, 40), programLocalShadowingCtrlCount: shadowed.length,
    crossRefs: { ok: refResolution.filter((r) => r.status === 'ok').map((r) => `${r.ref}`), problems: refResolution.filter((r) => r.status !== 'ok') },
  };
}
report.mergeAsIs.analysis = analyzeMerged(mergedA, 'as-is');

// ── 3B. CORRECTED assembly (programAssembler sketch, local to this script) ─
function assembleCorrected(baseXml, stationXml, targets) {
  let out = baseXml;
  const notes = [];
  const sProgs = programsOf(stationXml);
  // 1. Program blocks, Use="Target" stripped, appended before </Programs>.
  const blocks = [];
  for (const name of targets) {
    const p = sProgs.find((q) => q.name === name && q.use === 'Target');
    if (!p) throw new Error(`corrected: target program ${name} not found`);
    blocks.push(p.block.replace(/^<Program\s+Use="Target"\s*/, '<Program '));
  }
  out = out.replace(/<\/Programs>/, `${blocks.join('\n')}\n</Programs>`);
  notes.push(`programs appended: ${targets.join(', ')} (Use="Target" stripped)`);
  // 2. Context stubs are NOT carried. Referenced programs missing from the base are reported.
  const baseNames = new Set(programsOf(baseXml).map((p) => p.name));
  const missingCtx = sProgs.filter((p) => p.use === 'Context' && !baseNames.has(p.name)).map((p) => `${p.name} (${[...p.tags.keys()].join(', ')})`);
  if (missingCtx.length) notes.push(`context programs the station expects but the chassis lacks (NOT carried — semantic gap): ${missingCtx.join('; ')}`);
  // 3. Controller tags: the station's REAL controller section, deduped against base CONTROLLER scope only.
  const sCtrl = ctrlTagsSection(stationXml);
  const sCtrlTags = sCtrl ? parseTagDecls(sCtrl.xml) : new Map();
  const bCtrl = ctrlTagsSection(out);
  const bCtrlTags = bCtrl ? parseTagDecls(bCtrl.xml) : new Map();
  const addTags = [...sCtrlTags.entries()].filter(([n]) => !bCtrlTags.has(n)).map(([, d]) => d.block.replace(/\sUse="[^"]*"/, ''));
  if (addTags.length && bCtrl) out = out.slice(0, bCtrl.end - '</Tags>'.length) + addTags.join('\n') + '\n</Tags>' + out.slice(bCtrl.end);
  notes.push(`controller tags added: ${addTags.length} (${[...sCtrlTags.keys()].filter((n) => !bCtrlTags.has(n)).join(', ')})`);
  // 4. DataTypes + AOIs dedupe by name (base body wins) — same policy as mergePrograms.
  for (const [tag, closer] of [['DataType', '</DataTypes>'], ['AddOnInstructionDefinition', '</AddOnInstructionDefinitions>']]) {
    const have = namedBlocks(out, tag); const want = namedBlocks(stationXml, tag);
    const adds = [...want.entries()].filter(([n]) => !have.has(n)).map(([, b]) => b.block.replace(/\sUse="[^"]*"/, ''));
    if (adds.length) out = out.replace(closer, `${adds.join('\n')}\n${closer}`);
    notes.push(`${tag} added: ${adds.length}`);
  }
  // 5. ParameterConnections carried (Use="Context" dropped).
  const haveConns = paramConnsOf(out);
  const addConns = paramConnsOf(stationXml).filter((c) => !haveConns.some((k) => k.ep1 === c.ep1 && k.ep2 === c.ep2));
  if (addConns.length) {
    const lines = addConns.map((c) => `<ParameterConnection EndPoint1="${c.ep1}" EndPoint2="${c.ep2}"/>`).join('\n');
    out = /<\/ParameterConnections>/.test(out) ? out.replace(/<\/ParameterConnections>/, `${lines}\n</ParameterConnections>`)
      : out.replace(/<\/Tasks>/, `</Tasks>\n<ParameterConnections>\n${lines}\n</ParameterConnections>`);
  }
  notes.push(`parameter connections carried: ${addConns.length}`);
  // 6. Schedule in MainTask's station block: after the last S##_ entry (else after Chassis), sorted by name.
  out = out.replace(/<Task\s([^>]*Name="MainTask"[^>]*)>([\s\S]*?)<\/Task>/, (whole, open, body) => {
    const sched = [...body.matchAll(/<ScheduledProgram\s+Name="([^"]+)"\s*\/>/g)].map((m) => m[1]).filter((n) => !targets.includes(n));
    let idx = -1; sched.forEach((n, i) => { if (/^S\d{2}_/.test(n)) idx = i; });
    if (idx < 0) idx = sched.indexOf('Chassis');
    const merged = [...sched.slice(0, idx + 1), ...[...targets].sort(), ...sched.slice(idx + 1)];
    return `<Task ${open}>\n<ScheduledPrograms>\n${merged.map((n) => `<ScheduledProgram Name="${n}"/>`).join('\n')}\n</ScheduledPrograms>\n</Task>`;
  });
  notes.push('scheduled in MainTask station block (after last S##_ program, before Production)');
  return { xml: asciiFoldL5x(out), notes, missingCtx };
}
const corrected = assembleCorrected(base, other, otherTargets.map((p) => p.name));
report.assembleCorrected = { notes: corrected.notes, analysis: analyzeMerged(corrected.xml, 'corrected') };

// ── 4. validators ───────────────────────────────────────────────────────────
const vBase = runValidators(base, 'ChassisStandard (base alone)');
const vStation = runValidators(other, `${LABEL} (station alone)`);
const vA = runValidators(mergedA, 'A. as-is mergePrograms');
const vB = runValidators(corrected.xml, 'B. corrected assembly');
const introduced = (v) => ({
  errors: multisetDiff(v.validateL5X.errors, vBase.validateL5X.errors),
  warnings: multisetDiff(v.validateL5X.warnings, vBase.validateL5X.warnings),
  errorsWithDevices: multisetDiff(v.validateL5X_withDevices.errors, vBase.validateL5X_withDevices.errors),
  simErrors: multisetDiff(v.simulateImport.errors, vBase.simulateImport.errors),
});
// validateL5X's Rule 16/17 checks (checkMotionTriggerShape, flow order) build
// their state graph from EVERY /R02/ rung in the file regardless of program —
// on a multi-program controller they pair one station's states with another
// program's MAM list. Station alone passes, base alone has its own; anything
// NEW of that class on the merged file is a cross-program artifact.
const classify = (e) => (/^(Flow order|Motion trigger shape)/.test(e) ? 'validator-artifact (file-wide Rule 16/17 check mixes programs)'
  : /Program reference \\S00_IndexerSP/.test(e) ? 'semantic-gap (template family)'
    : /Phantom output tag|Unused device emitted|Wrong tag family/.test(e) ? 'validator-artifact (device audit is per-station)'
      : 'merge-introduced');
const classified = (v) => introduced(v).errors.map((e) => ({ class: classify(e), error: e.slice(0, 160) }));
report.validation = {
  base: vBase, station: vStation, asIs: vA, corrected: vB,
  introducedByMerge: { asIs: introduced(vA), corrected: introduced(vB) },
  introducedClassified: { asIs: classified(vA), corrected: classified(vB) },
  inheritedFromBase: { errors: vBase.validateL5X.errors.length, warnings: vBase.validateL5X.warnings.length,
    unknownMnemonics: [...new Set(vBase.validateL5X.errors.map((e) => (e.match(/Unknown instruction "([^"]+)"/) || [])[1]).filter(Boolean))],
    deviceAuditErrorsOnChassisPrograms: vBase.validateL5X_withDevices.errors.length - vBase.validateL5X.errors.length },
};

// ── 5. findings ─────────────────────────────────────────────────────────────
const A = report.mergeAsIs.analysis, B = report.assembleCorrected.analysis;
if (vBase.validateL5X.errors.length) finding('warn', `Chassis base ALONE fails validateL5X: ${vBase.validateL5X.errors.length} errors — mnemonic whitelist lacks ${report.validation.inheritedFromBase.unknownMnemonics.join(', ')}; ${vBase.validateL5X.warnings.length} warnings (chassis programs use states off the 4/7/10 grid). Inherited by every merge; not a merge defect.`);
if (report.validation.inheritedFromBase.deviceAuditErrorsOnChassisPrograms > 0) finding('warn', `validateL5X device audit (opts.devices) is per-STATION: run against a whole controller it flags ${report.validation.inheritedFromBase.deviceAuditErrorsOnChassisPrograms} chassis-program q_/iq_ tags as phantoms. The assembler must validate per program with that program's sheet, not the whole file with one device list.`);
{
  const art = report.validation.introducedClassified.corrected.filter((c) => /file-wide/.test(c.class)).length;
  if (art) finding('warn', `validateL5X is single-program-minded: ${art} of the errors it adds on the merged file are Rule 16/17 cross-program artifacts (R02 rungs of all programs pooled into one state graph — e.g. MidBaseLoad states 10/13 vs the chassis R06_CamServo MAM list). The assembler must validate each program as a slice, or the validator needs per-program grouping.`);
}
if (A.programsAdded.some((p) => /Use=Context/.test(p))) finding('error', `Use="Context" stub programs carried into a TargetType="Controller" file: ${A.programsAdded.filter((p) => /Use=Context/.test(p)).join(', ')}`, 'A controller export has no context; the stub is a program with no routines. Studio treats the reference as a real (empty) program at best, rejects the Use attribute at worst.');
if (A.useAttrsRemaining.programTarget) finding('error', `${A.useAttrsRemaining.programTarget} <Program Use="Target"> attributes survive in the controller file (plus ${A.useAttrsRemaining.tagsContext} <Tags Use="Context">, ${A.useAttrsRemaining.tagReference} <Tag Use="Reference">).`);
if (A.stationConnectionsMissing.length) finding('error', `ParameterConnections not carried by mergePrograms: ${A.stationConnectionsMissing.map((c) => `${c.ep1} <-> ${c.ep2}`).join('; ')}`, `InOut parameters left unconnected: ${A.unconnectedInOut.join(', ')} — an unconnected program InOut parameter is a verify error in Studio.`);
{
  const newIdx = A.mainTaskOrder.filter((s) => /NEW/.test(s));
  if (newIdx.length) finding('warn', `Scheduled at the END of MainTask (after Production/Alarms/HMI): ${newIdx.join(', ')}`, 'Chassis template runs Supervisor → Tracking → Chassis → S##_ stations → Production → Alarms → HMI. Stations appended after HMI scan one pass late relative to Production/Alarms.');
}
for (const r of B.crossRefs.problems) finding('error', `Cross-program reference ${r.ref} from ${r.from}: ${r.status}`, r.status === 'missing-program' || r.status === 'context-stub-only'
  ? `The station was generated against the S00_IndexerSP template family; the chassis exposes the indexer through the "Chassis" program (${report.base.chassisNativePattern.chassisProgramParams.join(', ')}) and Chassis_Status {${report.base.chassisNativePattern.chassisStatusMembers.slice(0, 12).join(', ')}…}. Needs a template-family adapter, not a merge.`
  : undefined);
for (const a of B.axisTags.filter((t) => t.addedByMerge)) if (a.moduleExists === false) finding('error', `Axis tag ${a.tag} references MotionModule "${a.motionModule}" — no such <Module> in the chassis (station export has no <Modules> section).`, 'The assembler must add the station\'s drive <Module> blocks (catalog, IP, slot) from a per-station hardware list; the axis-to-module binding fails import otherwise.');
if (B.programLocalShadowingCtrlCount) finding('warn', `${B.programLocalShadowingCtrlCount} program-local tags in the station ALSO exist at controller scope after the corrected merge (hoisted handshake/alarm tags shadowed by locals).`, cap(B.programLocalShadowingCtrl, 12));
if (report.overlap.ctrlTagsAlsoLocalInStation.length) finding('warn', `Station file itself declares ${report.overlap.ctrlTagsAlsoLocalInStation.length} tags at BOTH controller and program scope (v1.4.1 hoisting leftover).`, cap(report.overlap.ctrlTagsAlsoLocalInStation, 12));
finding('info', `16-station scaling: controller-scope names are one flat namespace. Station-local tag names (${[...otherCtrlTags.keys()].filter((n) => !/^(a\d\d_|g_|MotionGroup)/.test(n)).slice(0, 5).join(', ')}, …) hoisted to controller scope WILL collide across stations with same-named devices; dedupe-by-name then silently binds two stations to one tag.`,
  'Assembler rule: handshakes live as Public/Output program parameters referenced \\S##_Prog.p_X (the chassis-native pattern); controller scope holds only a##_S##…, g_*, MotionGroup and shared globals; every station-owned controller tag carries the S## prefix.');

// ── 6. write ────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1_$2');
const outA = path.join(OUT_DIR, `${LABEL}_into_ChassisStandard__A_asis__${stamp}.L5X`);
const outB = path.join(OUT_DIR, `${LABEL}_into_ChassisStandard__B_corrected__${stamp}.L5X`);
const outR = path.join(OUT_DIR, `mergeIntoChassis__${LABEL}__${stamp}.report.json`);
fs.writeFileSync(outA, mergedA, 'utf8');
fs.writeFileSync(outB, corrected.xml, 'utf8');
report.outputs = { asIs: outA, corrected: outB, report: outR };
// Trim the giant lists before writing.
for (const v of [report.validation.base, report.validation.station, report.validation.asIs, report.validation.corrected]) {
  for (const k of ['validateL5X', 'validateL5X_withDevices', 'simulateImport']) { v[k].errors = cap(v[k].errors, 40); v[k].warnings = cap(v[k].warnings, 25); }
}
for (const k of ['asIs', 'corrected']) for (const f of Object.keys(report.validation.introducedByMerge[k])) report.validation.introducedByMerge[k][f] = cap(report.validation.introducedByMerge[k][f], 40);
report.base.controllerTags = cap(report.base.controllerTags, 40);
fs.writeFileSync(outR, JSON.stringify(report, null, 2), 'utf8');

// ── 7. console summary ──────────────────────────────────────────────────────
const line = (s = '') => console.log(s);
line(`mergeIntoChassis — ${LABEL} → ${report.base.controller.name} (${report.base.targetType}, ${report.base.controller.processor} v${report.base.controller.majorRev})`);
line(`base programs: ${report.base.programs.length} | station targets: ${otherTargets.map((p) => p.name).join(', ')} | context stubs in station: ${otherContexts.map((p) => p.name).join(', ')}`);
line(`renames: ${renames.length ? renames.map((r) => `${r.from}→${r.to}`).join(', ') : 'none (no exact collision)'} | prefix collisions: ${prefixCollisions.map((c) => `${c.program}~${c.chassisProgramsWithSamePrefix.join('/')}`).join(', ') || 'none'}`);
line(`mergePrograms step 2 sweeps: ${JSON.stringify(report.overlap.mergeProgramsStep2)}`);
line();
line('A. AS-IS mergePrograms:');
line(`   programs ${baseProgs.length} → ${A.programs.length} (added: ${A.programsAdded.join(', ')})`);
line(`   MainTask: ${A.mainTaskOrder.join(' ')}`);
line(`   ctrl tags ${A.controllerTags.before} → ${A.controllerTags.after} (+${A.controllerTags.addedCount}; ${A.programLocalShadowingCtrlCount} shadow program-locals; real station ctrl tags missing: ${A.controllerTags.stationRealCtrlTagsMissing.join(', ') || 'none'})`);
line(`   DataTypes ${A.dataTypes.before} → ${A.dataTypes.after} (+${A.dataTypes.added.join(', ') || '0'}) | AOIs ${A.aois.before} → ${A.aois.after} (+${A.aois.added.join(', ') || '0'})`);
line(`   Use attrs left: ${JSON.stringify(A.useAttrsRemaining)} | ParameterConnections missing: ${A.stationConnectionsMissing.length} | unconnected InOut: ${A.unconnectedInOut.join(', ') || 'none'}`);
line(`   cross-ref problems: ${A.crossRefs.problems.map((r) => `${r.ref}=${r.status}`).join('; ') || 'none'}`);
line();
line('B. CORRECTED assembly:');
for (const n of corrected.notes) line(`   - ${n}`);
line(`   MainTask: ${B.mainTaskOrder.join(' ')}`);
line(`   ctrl tags ${B.controllerTags.before} → ${B.controllerTags.after} (+${B.controllerTags.added.join(', ')})`);
line(`   Use attrs left: ${JSON.stringify(B.useAttrsRemaining)} | ParameterConnections: ${B.parameterConnections.length} | unconnected InOut: ${B.unconnectedInOut.join(', ') || 'none'}`);
line(`   axis tags: ${B.axisTags.filter((t) => t.addedByMerge).map((t) => `${t.tag}→${t.motionModule} module=${t.moduleExists}`).join('; ')}`);
line(`   cross-ref problems: ${B.crossRefs.problems.map((r) => `${r.ref}=${r.status}`).join('; ') || 'none'}`);
line();
line('VALIDATION:');
for (const v of [vBase, vStation, vA, vB]) line(`   ${summarizeVal(v)}`);
line(`   introduced by A (validateL5X errors − base): ${report.validation.introducedByMerge.asIs.errors.length}`);
for (const e of report.validation.introducedByMerge.asIs.errors.slice(0, 12)) line(`      · ${e}`);
line(`   introduced by B (validateL5X errors − base): ${report.validation.introducedByMerge.corrected.errors.length}`);
for (const e of report.validation.introducedByMerge.corrected.errors.slice(0, 12)) line(`      · ${e}`);
line(`   introduced by B, with device audit: ${report.validation.introducedByMerge.corrected.errorsWithDevices.length}`);
for (const e of report.validation.introducedByMerge.corrected.errorsWithDevices.slice(0, 8)) line(`      · ${e}`);
line('   classification of B-introduced errors:');
for (const c of report.validation.introducedClassified.corrected) line(`      [${c.class}] ${c.error.slice(0, 110)}`);
line();
line('FINDINGS:');
for (const f of report.findings) line(`   [${f.severity}] ${f.title}`);
line();
line(`wrote ${outA}\nwrote ${outB}\nwrote ${outR}`);
