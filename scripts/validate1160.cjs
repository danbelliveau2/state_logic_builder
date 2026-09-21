#!/usr/bin/env node
'use strict';
/**
 * validate1160.cjs — JOB 1160 IMPORT GATE (2026-09-16)
 *
 * Runs the shipped validators on an assembled controller file and reports
 * only what is NEW against the pristine ChassisStandard.L5X baseline:
 *   - simulateImport (importSimValidator.js ~395): L5K/Decorated tag data, ASCII
 *   - validateL5X  (validator.js ~903): rung resolution, states, Rule 13/15/16/17, ParameterConnections,
 *     import limits, and the device audit (deviceNames/devices DERIVED from the assembled i_/q_/iq_ tags —
 *     the sheet of a whole controller is the union of every program's devices)
 *   - module I/O ParameterConnection endpoints (Local:3:I.Pt00.Data) resolved against <Modules> here (R2, 2026-09-16):
 *     slot = upstream Port Address, PtNN member in the I/O connection tag, .Data = BOOL, type-checked against the parameter
 *
 * The mergeIntoChassis experiment showed validateL5X is single-program-minded (Rule 16/17 pool every
 * program's R02 rungs into one state graph) and its mnemonic whitelist lacks SIZE/TRUNC/MCCP/MAPC, so
 * every NEW finding is CLASSIFIED (blocking vs advisory artifact) and each program that is new or changed
 * vs the baseline is ALSO validated as a slice (its routines alone, every declaration kept).
 *
 * Run:  node scripts/validate1160.cjs generated/1160/out/1160_v0.1.L5X [--baseline <pristine.L5X>] [--json <out.json>] [--no-slices]
 * Exit: 0 = importable by these gates (sim PASS, no blocking new errors); 1 = blocking findings; 2 = usage/read error.
 * Writes <file>.validate.json (or --json) + a short human summary.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { validateL5X, detectCompareFamily } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'validator.js'));
const { simulateImport } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'importSimValidator.js'));

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const argOf = (k, d) => { const i = argv.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`)); if (i < 0) return d; const a = argv[i]; if (a.includes('=')) return a.slice(a.indexOf('=') + 1); const n = argv[i + 1]; return n && !n.startsWith('--') ? n : true; };
const FILE = positional[0] ? path.resolve(ROOT, positional[0]) : null;
if (!FILE) { console.error('usage: node scripts/validate1160.cjs <assembled.L5X> [--baseline <pristine.L5X>] [--json <out.json>] [--no-slices]'); process.exit(2); }
const BASELINE = path.resolve(ROOT, String(argOf('baseline', 'plc-reference/training-material/SDC Standard Templates/ChassisStandard.L5X')));
const JSON_OUT = argOf('json', null) ? path.resolve(ROOT, String(argOf('json'))) : FILE.replace(/\.l5x$/i, '') + '.validate.json';
const SLICES = !(argOf('no-slices', false) === true);
const relRoot = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// ── helpers ─────────────────────────────────────────────────────────────────
const stripBom = (s) => s.replace(/^﻿/, '');
const attrOf = (open, name) => (open.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1] ?? null;
const multisetDiff = (a, b) => { const c = new Map(); for (const x of b) c.set(x, (c.get(x) || 0) + 1); return a.filter((x) => { const k = c.get(x) || 0; if (k > 0) { c.set(x, k - 1); return false; } return true; }); };
const cap = (arr, n = 40) => (arr.length > n ? [...arr.slice(0, n), `...(+${arr.length - n} more)`] : arr);
const readL5x = (p) => { try { return stripBom(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function programsOf(xml) {
  const ps = xml.indexOf('<Programs>'), pe = xml.lastIndexOf('</Programs>');
  const sec = ps >= 0 && pe > ps ? xml.slice(ps, pe) : '';
  return [...sec.matchAll(/<Program\s([^>]*)>([\s\S]*?)<\/Program>/g)].map((m) => ({ name: attrOf(' ' + m[1], 'Name'), block: m[0], body: m[2], start: ps + m.index }));
}
// Name is usually the FIRST attribute of <Module …> — prepend a space so `\sName=` matches it.
const moduleNamesOf = (xml) => { const s = xml.indexOf('<Modules>'), e = xml.indexOf('</Modules>'); return new Set(s >= 0 && e > s ? [...xml.slice(s, e).matchAll(/<Module\s([^>]*)>/g)].map((m) => attrOf(' ' + m[1], 'Name')).filter(Boolean) : []); };

// ── Module I/O ParameterConnection endpoints (v0.1 lint R2, 2026-09-16) ──────
// validator.js resolves a bare <ParameterConnection> endpoint only as a controller tag, so the ShowRoomChassis way of
// wiring local 5069 points (Local:3:I.Pt00.Data <-> \Supervisor.i_CycleStart) came back as 'controller tag "Local:3:I"
// is not declared'. Those endpoints are resolved HERE against <Modules>, the same way assemble1160 does: a card whose
// ParentModule is the parent and whose upstream Port Address is the slot, whose I|O|C connection tag carries the PtNN
// member, whose .Data leaf is BOOL — then the data-type check the shipped validator skipped is finished against the
// program-side parameter. Only a genuinely unresolvable endpoint stays an error.
const MODULE_IO_EP = /^([A-Za-z_][A-Za-z0-9_]*):(\d+):([IOC])((?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)*)$/;
const MODULE_IO_UNDECLARED = /^ParameterConnection "([^"]+)" <-> "([^"]+)": controller tag "([^"]+)" is not declared/;
function moduleIoIndexOf(xml) {
  const s = xml.indexOf('<Modules>'), e = xml.indexOf('</Modules>');
  const mods = [];
  if (!(s >= 0 && e > s)) return mods;
  for (const m of xml.slice(s, e).matchAll(/<Module\s([^>]*)>([\s\S]*?)<\/Module>/g)) {
    const open = ' ' + m[1], body = m[2];
    const port = body.match(/<Port\s[^>]*Upstream="true"[^>]*>/) || body.match(/<Port\s[^>]*>/);
    const sec = (tag) => { const a = body.indexOf(`<${tag}`), b = body.indexOf(`</${tag}>`); return a >= 0 && b > a ? body.slice(a, b) : null; };
    mods.push({ name: attrOf(open, 'Name'), catalog: attrOf(open, 'CatalogNumber'), parent: attrOf(open, 'ParentModule'), address: port ? attrOf(' ' + port[0], 'Address') : null, I: sec('InputTag'), O: sec('OutputTag'), C: sec('ConfigTag') });
  }
  return mods;
}
function programTagIndexOf(xml) {
  const idx = new Map(); // programName → Map(tagName → { dataType, usage })
  for (const p of programsOf(xml)) {
    const t = p.body.match(/<Tags(?:\s[^>]*)?>[\s\S]*?<\/Tags>/);
    const map = new Map();
    if (t) for (const m of t[0].matchAll(/<Tag\s([^>]*?)\/?>/g)) { const a = ' ' + m[1]; const n = attrOf(a, 'Name'); if (n) map.set(n, { dataType: attrOf(a, 'DataType'), usage: attrOf(a, 'Usage') }); }
    idx.set(p.name, map);
  }
  return idx;
}
/** null = not a module I/O endpoint; { err } = unresolvable; { decl: { dataType, module } } = resolved. */
function resolveModuleIoEndpoint(ep, mods) {
  const m = ep.match(MODULE_IO_EP);
  if (!m) return null;
  const [, parent, slot, conn, rest] = m;
  const mod = mods.find((x) => x.parent === parent && x.address === slot && x.name !== parent);
  if (!mod) return { err: `module I/O endpoint ${parent}:${slot}:${conn} — no <Module> with ParentModule="${parent}" whose upstream Port Address is ${slot}` };
  const member = (rest.match(/^\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || null;
  if (!member) return { err: `module I/O endpoint ${ep} names the whole connection — connect one member (e.g. .Pt00.Data)` };
  const sec = mod[conn];
  if (!sec) return { err: `module ${mod.name} (${mod.catalog}) has no ${conn === 'I' ? 'Input' : conn === 'O' ? 'Output' : 'Config'} connection tag` };
  const sm = sec.match(new RegExp(`<StructureMember\\s+Name="${member}"([^>]*)>([\\s\\S]*?)<\\/StructureMember>`));
  if (!sm) return { err: `module ${mod.name} (${mod.catalog}) ${conn} connection has no member "${member}" — a point the card does not have` };
  const leaf = (rest.match(/\.([A-Za-z_][A-Za-z0-9_]*)(?:\[\d+\])?$/) || [])[1];
  if (leaf === member) return { decl: { dataType: attrOf(' ' + sm[1], 'DataType'), module: mod.name } };
  const dv = sm[2].match(new RegExp(`<DataValueMember\\s+Name="${leaf}"\\s+DataType="([^"]+)"`));
  if (!dv) return { err: `module ${mod.name} (${mod.catalog}) ${conn}.${member} has no member "${leaf}"` };
  return { decl: { dataType: dv[1], module: mod.name } };
}
/** Rewrites validator.js's "controller tag Local:N:X is not declared" findings: dropped when the module endpoint resolves
 *  and types agree, replaced by the specific defect otherwise. `stats` (optional) collects resolved/unresolved endpoints. */
function resolveModuleIoConnections(xml, errors, stats = null) {
  if (!errors.some((e) => MODULE_IO_UNDECLARED.test(e))) return errors;
  const mods = moduleIoIndexOf(xml);
  const progs = programTagIndexOf(xml);
  const out = [];
  for (const e of errors) {
    const m = e.match(MODULE_IO_UNDECLARED);
    if (!m) { out.push(e); continue; }
    const [, ep1, ep2, root] = m;
    const ep = ep1 === root || ep1.startsWith(`${root}.`) ? ep1 : ep2;
    const other = ep === ep1 ? ep2 : ep1;
    const r = resolveModuleIoEndpoint(ep, mods);
    if (!r) { out.push(e); continue; } // not a module I/O shape — the validator was right
    const label = `ParameterConnection "${ep1}" <-> "${ep2}"`;
    if (r.err) { out.push(`${label}: ${r.err} — Studio 5000 cancels the whole import on this`); if (stats) stats.unresolved.push(`${ep}: ${r.err}`); continue; }
    const om = other.match(/^\\([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
    const od = om ? (progs.get(om[1]) || new Map()).get(om[2]) : null;
    if (od && od.dataType && r.decl.dataType && od.dataType !== r.decl.dataType) {
      out.push(`${label}: incompatible data types (${od.dataType} vs ${r.decl.dataType}) — Studio rejects the connection`);
      if (stats) stats.unresolved.push(`${ep}: ${od.dataType} vs ${r.decl.dataType}`);
      continue;
    }
    if (stats) stats.resolved.push(`${ep} = ${r.decl.module} ${r.decl.dataType}${od ? ` <-> ${other} ${od.dataType}` : ''}`);
  }
  return out;
}
/** validateL5X with module I/O ParameterConnection endpoints resolved. */
function validateResolved(xml, opts, stats = null) {
  const r = validateL5X(xml, opts);
  const errors = resolveModuleIoConnections(xml, r.errors, stats);
  return { ...r, errors, ok: r.ok || errors.length === 0 };
}
// Diff key: validator messages embed a "first seen in …" location that moves with program order — strip it so a
// reordered program (Tasks order vs the template's alphabetical export) never shows as a NEW finding.
const normMsg = (s) => s.replace(/\s*\(first seen in [^)]*\)/, '').replace(/\s+/g, ' ').trim();
const multisetDiffNorm = (a, b) => { const c = new Map(); for (const x of b) { const k = normMsg(x); c.set(k, (c.get(k) || 0) + 1); } return a.filter((x) => { const k = normMsg(x); const n = c.get(k) || 0; if (n > 0) { c.set(k, n - 1); return false; } return true; }); };
// Real Logix instructions the shipped validator's whitelist does not know (its "Unknown instruction" is an artifact for these).
const VALIDATOR_VOCAB_GAP = new Set(['PID', 'CROUT', 'SIZE', 'TRUNC', 'MCCP', 'MAPC', 'MDAC', 'MCSV', 'MAW', 'MDW', 'MAR', 'MDR', 'MAAT', 'MRAT', 'MAHD', 'MRHD', 'MDO', 'MDF', 'MATC', 'MDCC',
  'SQRT', 'XPY', 'LN', 'LOG', 'SIN', 'COS', 'TAN', 'ASN', 'ACS', 'ATN', 'DEG', 'RAD', 'TOD', 'FRD', 'FAL', 'FSC', 'AVE', 'SRT', 'STD', 'BSL', 'BSR', 'FFL', 'FFU', 'LFL', 'LFU', 'DDT', 'FBC', 'SQI', 'SQO', 'SQL',
  'PID', 'ALMD', 'ALMA', 'CTUD', 'TONR', 'TOFR', 'RTOR', 'OSRI', 'OSFI', 'BTDT', 'UPPER', 'LOWER', 'DTR', 'FOR', 'BRK', 'MCR', 'BAND', 'BOR', 'BXOR', 'BNOT',
  // GuardLogix safety instructions (SafetyProgram)
  'CROUT', 'ROUT', 'RIN', 'DCS', 'DCST', 'DCSTL', 'DCSTM', 'DCM', 'DCSRT', 'DCA', 'DCAF', 'DCI', 'ENPEN', 'EPMS', 'ESTOP', 'FPMS', 'FSBM', 'LC', 'SMAT', 'THRS', 'THRSE', 'TSAM', 'TSSM', 'CBCM', 'CBIM', 'CBSSM', 'CPM', 'CSM', 'MVMT', 'SFX']);

/** Devices implied by the file's own i_/q_/iq_/HMI_ tags (AOI definitions excluded). */
function deriveDevices(xml) {
  const aoiS = xml.indexOf('<AddOnInstructionDefinitions'), aoiE = xml.indexOf('</AddOnInstructionDefinitions>');
  const scope = aoiS >= 0 && aoiE > aoiS ? xml.slice(0, aoiS) + xml.slice(aoiE) : xml;
  const devices = new Map(); // name → type
  const setType = (name, type, force = false) => { if (!name) return; if (!devices.has(name) || force) devices.set(name, type); };
  for (const m of scope.matchAll(/<Tag\s([^>]*?)\/?>/g)) {
    const attrs = ' ' + m[1];
    const name = attrOf(attrs, 'Name'); const dt = attrOf(attrs, 'DataType') || '';
    if (!name) continue;
    let mm;
    if ((mm = name.match(/^q_(Extend|Retract)([A-Za-z0-9_]+)$/))) setType(mm[2], 'PneumaticLinearActuator', true);
    else if ((mm = name.match(/^q_(Close|Open|Vent|Engage|Disengage)([A-Za-z0-9_]+)$/))) setType(mm[2], 'PneumaticGripper', true);
    else if ((mm = name.match(/^i_([A-Za-z0-9_]+?)(Extended|Retracted|Closed|Opened|Open|Lowered|Raised|Up|Down|Engaged|Disengaged)$/))) setType(mm[1], 'PneumaticLinearActuator');
    else if ((mm = name.match(/^iq_([A-Za-z0-9_]+)$/)) && /AXIS_CIP_DRIVE|AXIS_VIRTUAL/.test(dt)) setType(mm[1], 'ServoAxis', true);
    else if ((mm = name.match(/^HMI_([A-Za-z0-9_]+)$/)) && dt === 'ServoOverall') setType(mm[1], 'ServoAxis', true);
    else if ((mm = name.match(/^a\d\d_([A-Za-z0-9_]+)$/)) && /AXIS_CIP_DRIVE|AXIS_VIRTUAL/.test(dt)) setType(mm[1].replace(/^S\d\d/, ''), 'ServoAxis', true);
    else if ((mm = name.match(/^i_([A-Za-z0-9_]+)$/))) setType(mm[1], 'DigitalSensor');
    else if ((mm = name.match(/^q_([A-Za-z0-9_]+)$/))) setType(mm[1], 'DigitalOutput');
  }
  const list = [...devices.entries()].map(([name, type]) => ({ name, type }));
  return { deviceNames: list.map((d) => d.name), devices: list };
}

const ARTIFACT_CLASSES = new Set(['cross-program-artifact', 'validator-vocabulary', 'module-ref']);
function classify(msg, moduleNames) {
  if (/^(Flow order|Motion trigger shape|R02 (rung )?order)/i.test(msg)) return 'cross-program-artifact';
  // Module I/O ParameterConnection endpoints (Local:3:I.Pt00.Data) are resolved against <Modules> before classification
  // (resolveModuleIoConnections) — any ParameterConnection finding that reaches here is a real defect.
  const unk = msg.match(/^Unknown instruction "([^"]+)"/);
  if (unk && VALIDATOR_VOCAB_GAP.has(unk[1])) return 'validator-vocabulary';
  const und = msg.match(/^Undeclared identifier "([^"]+)"/);
  if (und && (moduleNames.has(und[1]) || und[1] === 'Local')) return 'module-ref';
  if (/^Unknown instruction/.test(msg)) return 'unknown-instruction';
  if (/ParameterConnection|Program reference \\/.test(msg)) return 'import-fatal';
  if (/^XML not well-formed|^Not an L5X|import simulation crashed|Data type mismatch|L5K/.test(msg)) return 'import-fatal';
  if (/^Undeclared identifier/.test(msg)) return 'import-undefined-tag';
  if (/Phantom output tag|Unused device emitted|Wrong tag family|Unused\/delete-me/.test(msg)) return 'device-audit';
  if (/Compare mnemonic/.test(msg)) return 'rule-13-compare-family';
  if (/Illegal state number/.test(msg)) return 'state-grid';
  if (/Non-ASCII/.test(msg)) return 'ascii';
  return 'standard';
}

// ── load ────────────────────────────────────────────────────────────────────
const target = readL5x(FILE);
if (target === null) { console.error(`cannot read ${FILE}`); process.exit(2); }
const base = readL5x(BASELINE);
const report = {
  tool: 'validate1160', date: new Date().toISOString(), file: relRoot(FILE), bytes: Buffer.byteLength(target, 'utf8'),
  baseline: base === null ? null : relRoot(BASELINE), ok: false, exitCode: 1,
  devices: null, simulateImport: null, validateL5X: null, newVsBaseline: null, perProgram: [], summary: {},
};
if (base === null) console.warn(`warning: baseline ${relRoot(BASELINE)} unreadable — reporting ALL findings (nothing subtracted)`);

const compareFamily = base ? detectCompareFamily(base) : 'short';
const devT = deriveDevices(target);
const devB = base ? deriveDevices(base) : { deviceNames: [], devices: [] };
report.devices = { derived: devT.devices.length, byType: devT.devices.reduce((o, d) => { o[d.type] = (o[d.type] || 0) + 1; return o; }, {}), sample: cap(devT.deviceNames, 30) };
const modNames = moduleNamesOf(target);
const moduleIo = { resolved: [], unresolved: [] }; // ParameterConnection endpoints resolved against <Modules> (R2)

// ── run ─────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const simT = simulateImport(target);
const plainT = validateResolved(target, { compareFamily }, moduleIo);
const devsT = validateResolved(target, { compareFamily, deviceNames: devT.deviceNames, devices: devT.devices });
const simB = base ? simulateImport(base) : { ok: true, errors: [], warnings: [] };
const plainB = base ? validateResolved(base, { compareFamily }) : { ok: true, errors: [], warnings: [] };
const devsB = base ? validateResolved(base, { compareFamily, deviceNames: devB.deviceNames, devices: devB.devices }) : { ok: true, errors: [], warnings: [] };

report.simulateImport = { ok: simT.ok, errors: simT.errors, warnings: cap(simT.warnings, 40), newErrors: multisetDiff(simT.errors, simB.errors), newWarnings: multisetDiff(simT.warnings, simB.warnings) };
report.parameterConnections = { moduleIoResolved: moduleIo.resolved, moduleIoUnresolved: moduleIo.unresolved };
report.validateL5X = {
  compareFamily,
  plain: { ok: plainT.ok, errors: plainT.errors.length, warnings: plainT.warnings.length },
  withDevices: { ok: devsT.ok, errors: devsT.errors.length, warnings: devsT.warnings.length },
  baseline: base ? { plain: { errors: plainB.errors.length, warnings: plainB.warnings.length }, withDevices: { errors: devsB.errors.length, warnings: devsB.warnings.length }, sim: { errors: simB.errors.length } } : null,
};
const newErrPlain = multisetDiffNorm(plainT.errors, plainB.errors);
const newWarnPlain = multisetDiffNorm(plainT.warnings, plainB.warnings);
const newErrDev = multisetDiffNorm(devsT.errors, devsB.errors);
const newWarnDev = multisetDiffNorm(devsT.warnings, devsB.warnings);
const classed = (list) => list.map((e) => ({ class: classify(e, modNames), error: e }));
report.newVsBaseline = {
  errors: classed(newErrPlain), warnings: newWarnPlain,
  deviceAuditErrors: classed(multisetDiffNorm(newErrDev, newErrPlain)), deviceAuditWarnings: multisetDiffNorm(newWarnDev, newWarnPlain),
};

// ── per-program slices (new or changed programs only) ──────────────────────
// A slice keeps EVERY declaration (so \Prog.tag refs resolve) and only this program's routines,
// so Rule 15/16/17 see one state machine. Whole-file findings (descriptions, tag data, connections)
// are subtracted via the EMPTY slice (no routines anywhere) — each program shows only what its
// own rungs add.
if (SLICES) {
  const progsT = programsOf(target);
  const progsB = base ? programsOf(base) : [];
  const baseByName = new Map(progsB.map((p) => [p.name, norm(p.block)]));
  const sliceFor = (name) => {
    let out = target;
    for (const p of progsT) if (p.name !== name) out = out.replace(p.block, p.block.replace(/<Routines>[\s\S]*?<\/Routines>/, '<Routines/>'));
    return out;
  };
  const empty = validateResolved(sliceFor(null), { compareFamily, deviceNames: devT.deviceNames, devices: devT.devices });
  const noise = (s) => /^No MOVE\(n, Control\.StateReg\)|^No rung logic/.test(s);
  report.perProgram.push({ program: '(whole-file, no routines)', status: 'file-level', errors: classed(multisetDiffNorm(empty.errors, devsB.errors).filter((e) => !noise(e))), warnings: cap(multisetDiffNorm(empty.warnings, devsB.warnings).filter((w) => !noise(w)), 40) });
  for (const p of progsT) {
    const status = !baseByName.has(p.name) ? 'new' : baseByName.get(p.name) === norm(p.block) ? 'unchanged' : 'changed';
    if (status === 'unchanged') { report.perProgram.push({ program: p.name, status }); continue; }
    const v = validateResolved(sliceFor(p.name), { compareFamily, deviceNames: devT.deviceNames, devices: devT.devices });
    const errs = multisetDiffNorm(multisetDiffNorm(v.errors, empty.errors), devsB.errors).filter((e) => !noise(e));
    const warns = multisetDiffNorm(multisetDiffNorm(v.warnings, empty.warnings), devsB.warnings).filter((w) => !noise(w));
    report.perProgram.push({ program: p.name, status, errors: classed(errs), warnings: cap(warns, 25) });
  }
}
report.summary.ms = Date.now() - t0;

// ── verdict ─────────────────────────────────────────────────────────────────
const blocking = [
  ...report.newVsBaseline.errors.filter((e) => !ARTIFACT_CLASSES.has(e.class)),
  ...report.newVsBaseline.deviceAuditErrors.filter((e) => !ARTIFACT_CLASSES.has(e.class)),
];
const advisory = [...report.newVsBaseline.errors, ...report.newVsBaseline.deviceAuditErrors].filter((e) => ARTIFACT_CLASSES.has(e.class));
const sliceBlocking = report.perProgram.flatMap((p) => (p.errors || []).filter((e) => !ARTIFACT_CLASSES.has(e.class)).map((e) => ({ program: p.program, ...e })));
report.summary = {
  ...report.summary,
  simOk: simT.ok, simErrors: simT.errors.length,
  newErrors: report.newVsBaseline.errors.length, newWarnings: report.newVsBaseline.warnings.length,
  newDeviceAuditErrors: report.newVsBaseline.deviceAuditErrors.length,
  blocking: blocking.length, advisoryArtifacts: advisory.length,
  sliceBlocking: sliceBlocking.length,
  programs: report.perProgram.reduce((o, p) => { o[p.status] = (o[p.status] || 0) + 1; return o; }, {}),
};
report.ok = simT.ok && blocking.length === 0;
report.exitCode = report.ok ? 0 : 1;
fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');

// ── human summary ───────────────────────────────────────────────────────────
const L = (s = '') => console.log(s);
L(`validate1160 ${relRoot(FILE)} (${report.bytes} bytes) vs baseline ${report.baseline ?? 'NONE'} [${report.summary.ms} ms]`);
L(`  simulateImport: ${simT.ok ? 'PASS' : 'FAIL'} (${simT.errors.length} errors, ${simT.warnings.length} warnings; new vs baseline: ${report.simulateImport.newErrors.length}e/${report.simulateImport.newWarnings.length}w)`);
L(`  validateL5X:    ${plainT.errors.length}e/${plainT.warnings.length}w plain, ${devsT.errors.length}e/${devsT.warnings.length}w with ${devT.devices.length} derived devices (baseline ${plainB.errors.length}e/${plainB.warnings.length}w, ${devsB.errors.length}e/${devsB.warnings.length}w)`);
L(`  module I/O ParameterConnection endpoints: ${moduleIo.resolved.length} resolved against <Modules>, ${moduleIo.unresolved.length} unresolved`);
for (const u of moduleIo.unresolved.slice(0, 10)) L(`    unresolved: ${u.slice(0, 170)}`);
L(`  NEW vs baseline: ${newErrPlain.length} errors (${blocking.length} blocking, ${advisory.length} validator artifacts), ${newWarnPlain.length} warnings, ${report.newVsBaseline.deviceAuditErrors.length} device-audit errors`);
for (const e of report.newVsBaseline.errors.slice(0, 30)) L(`    [${e.class}] ${e.error.slice(0, 170)}`);
if (report.newVsBaseline.errors.length > 30) L(`    ...(+${report.newVsBaseline.errors.length - 30} more in the JSON)`);
for (const e of report.newVsBaseline.deviceAuditErrors.slice(0, 15)) L(`    [device-audit:${e.class}] ${e.error.slice(0, 170)}`);
for (const w of newWarnPlain.slice(0, 15)) L(`    warning: ${w.slice(0, 170)}`);
if (newWarnPlain.length > 15) L(`    ...(+${newWarnPlain.length - 15} more warnings in the JSON)`);
for (const e of report.simulateImport.errors.slice(0, 15)) L(`    [sim] ${e.slice(0, 170)}`);
if (SLICES) {
  L(`  per-program slices: ${JSON.stringify(report.summary.programs)}`);
  for (const p of report.perProgram) {
    if (p.status === 'unchanged') continue;
    const nb = (p.errors || []).filter((e) => !ARTIFACT_CLASSES.has(e.class)).length;
    if (!(p.errors || []).length && !(p.warnings || []).length) { L(`    ${p.program} (${p.status}): clean`); continue; }
    L(`    ${p.program} (${p.status}): ${(p.errors || []).length} errors (${nb} blocking), ${(p.warnings || []).length} warnings`);
    for (const e of (p.errors || []).slice(0, 8)) L(`       [${e.class}] ${e.error.slice(0, 150)}`);
    for (const w of (p.warnings || []).slice(0, 4)) L(`       warning: ${w.slice(0, 150)}`);
  }
}
L(`  VERDICT: ${report.ok ? 'PASS — no blocking findings beyond the pristine baseline' : 'FAIL — fix the blocking findings before import'}`);
L(`  wrote ${relRoot(JSON_OUT)}`);
process.exit(report.exitCode);
