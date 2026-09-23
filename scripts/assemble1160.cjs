#!/usr/bin/env node
'use strict';
/**
 * assemble1160.cjs — JOB 1160 CONTROLLER ASSEMBLER (2026-09-16)
 *
 * Stitches the builders' pieces into ONE importable Studio 5000 controller
 * L5X and gates it against the defect classes the mergeIntoChassis
 * experiment (generated/_experiments/*.report.json) and Jason's real import
 * rejections (scripts/regressImportRejections.cjs) surfaced:
 *   - Use="Target"/"Context"/"Reference" attributes leaking from Program-target exports
 *   - ParameterConnections dropped / dangling (InOut axes unconnected)
 *   - controller-tag sweep grabbing program locals (we never sweep — pieces are explicit)
 *   - duplicate UDT/AOI/tag names (same name + different body is a HARD stop here, never a silent keep)
 *   - wrong schedule position (programs are emitted in Tasks order; the schedule is the builders' Tasks.xml)
 *   - cross-program \Prog.tag references to programs/parameters that do not exist or are not Public/Output/Input
 *   - module buffer tags (MapInputs/MapOutputs) that no <Module> backs
 *   - non-ASCII in CDATA, unbalanced XML, unbalanced rung text
 *   - a structure-typed tag indexed as an array (vb01_X_IN[1].2 — Studio wants vb01_X_IN.Data[1].2; v0.1 lint #1, import-fatal)
 *   - ParameterConnection module I/O endpoints (Local:3:I.Pt00.Data, ShowRoomChassis shape) resolved against Modules.xml: slot, member, BOOL
 *
 * INPUTS (all relative to the repo root unless --build-dir is given)
 *   generated/1160/build/controller/{00_header,DataTypes,Modules,AddOnInstructionDefinitions,ControllerTags,Tasks,ParameterConnections}.xml
 *   generated/1160/build/controller/EXTRA_TAGS.xml   (optional; bare <Tag> elements merged into ControllerTags)
 *   generated/1160/build/programs/*.xml              (one <Program> element per file; name read from the element, not the file)
 *   plc-reference/training-material/SDC Standard Templates/ChassisStandard_1UP.L5X  (trailing sections after </ParameterConnections>)
 *
 * OUTPUT
 *   generated/1160/out/<name>.L5X          (BOM + CRLF, Studio export shape)
 *   generated/1160/out/<name>.report.json  (manifest + hard failures + warnings + undeclared-tag audit)
 *
 * EXIT 0 = no hard failures; 1 = hard failures (the L5X is still written so it can be inspected — do NOT import it).
 *
 * Run:
 *   node scripts/assemble1160.cjs --name 1160_v0.1
 *   node scripts/assemble1160.cjs --name 1160_v0.1 --fallback-ref     (borrow missing CONTROLLER sections from generated/1160/ref/ChassisStandard, warned)
 *   node scripts/assemble1160.cjs --name rt --build-dir <dir> --out-dir <dir>   (self-test / alternate trees)
 *
 * Other builders write concurrently: every read is tolerant; a missing or
 * unreadable piece is REPORTED (manifest.inputs), never a crash.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let XMLValidator = null;
try { ({ XMLValidator } = require('fast-xml-parser')); } catch { XMLValidator = null; }

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (i < 0) return d;
  const a = argv[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  const nxt = argv[i + 1];
  return nxt && !nxt.startsWith('--') ? nxt : true;
};
const NAME = String(argOf('name', '1160_v0.0'));
const BUILD_DIR = path.resolve(ROOT, String(argOf('build-dir', 'generated/1160/build')));
const OUT_DIR = path.resolve(ROOT, String(argOf('out-dir', 'generated/1160/out')));
const REF_DIR = path.resolve(ROOT, String(argOf('ref-dir', 'generated/1160/ref/ChassisStandard')));
const TEMPLATE = path.resolve(ROOT, String(argOf('template', 'plc-reference/training-material/SDC Standard Templates/ChassisStandard_1UP.L5X')));
const FALLBACK_REF = argOf('fallback-ref', false) === true || argOf('fallback-ref', false) === 'true';
const QUIET = argOf('quiet', false) === true;

// ── NAMES CONTRACT v2.2 (generated/1160/build/NAMES_CONTRACT.md — binding; Jason's 2026-09-18 rulings: MapInputs first, escapement twins, heat in a 1 s periodic task) ──
const CONTRACT_MAIN_TASK = [
  'MapInputs', 'Supervisor', 'Tracking', 'Chassis',
  'S01_YSiteEscapementA', 'S01_YSiteEscapementB', 'S01_YSiteLoadA', 'S01_YSiteLoadB', 'S02_YVerifyA', 'S02_YVerifyB',
  'S03_YSiteInspectA', 'S03_YSiteInspectB', 'S05_PortLoad', 'S06_PortVerifyA', 'S06_PortVerifyB',
  'S07_PortCutA', 'S07_PortCutB', 'S08_YHeatB', 'S09_PortCloseB', 'S10_YHeatA', 'S11_PortCloseA',
  'S12_OpticalCheck', 'S13_PhysicalCheckA', 'S13_PhysicalCheckB',
  'S14_GoodUnloadA', 'S14_GoodUnloadB', 'S14_BinDiverter', 'S15_RejectUnload', 'S16_EmptyNestA', 'S16_EmptyNestB',
  'MapOutputs', 'Production', 'Alarms', 'HMI',
];
// Jason 2026-09-18 15:21: ONE program in HeatControlTask (R00_Main + R02_Logic: PID setpoints/UPD, PID S08, PID S10);
// the rest of the heat logic lives in S08_YHeatB / S10_YHeatA in MainTask.
const CONTRACT_HEAT_TASK = ['HeatControl'];
const CONTRACT_SAFETY_TASK = ['SafetyProgram'];
const CONTRACT_PROGRAMS = new Set([...CONTRACT_MAIN_TASK, ...CONTRACT_HEAT_TASK, ...CONTRACT_SAFETY_TASK]);
const CONTRACT_CONTROLLER = { name: 'SDC_1160_YSiteAssembly', processor: '5069-L320ERMS2', majorRev: '37' };

// ── Logix vocabulary (superset of validator.js — that whitelist lacked SIZE/TRUNC/MCCP/MAPC per the experiment) ──
const MNEMONICS = new Set([
  'XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF', 'OSRI', 'OSFI',
  'TON', 'TOF', 'RTO', 'RES', 'CTU', 'CTD', 'CTUD', 'TONR', 'TOFR', 'RTOR',
  'MOV', 'MOVE', 'MVM', 'COP', 'CPS', 'FLL', 'CLR', 'SWPB', 'BTD', 'BTDT',
  'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'NEG', 'ABS', 'SQR', 'SQRT', 'CPT', 'XPY', 'LN', 'LOG',
  'SIN', 'COS', 'TAN', 'ASN', 'ACS', 'ATN', 'DEG', 'RAD', 'TRUNC', 'TOD', 'FRD',
  'EQU', 'NEQ', 'GRT', 'GEQ', 'LES', 'LEQ', 'LIM', 'MEQ', 'CMP',
  'EQ', 'NE', 'GT', 'GE', 'LT', 'LE', 'LIMIT',
  'AND', 'OR', 'XOR', 'NOT', 'BAND', 'BOR', 'BXOR', 'BNOT',
  'JSR', 'RET', 'SBR', 'JMP', 'LBL', 'NOP', 'AFI', 'TND', 'UID', 'UIE', 'FOR', 'BRK', 'MCR', 'END',
  'GSV', 'SSV', 'MSG', 'IOT', 'EVENT', 'SIZE',
  'DTOS', 'STOD', 'RTOS', 'STOR', 'CONCAT', 'FIND', 'MID', 'DELETE', 'INSERT', 'UPPER', 'LOWER', 'DTR',
  'FAL', 'FSC', 'AVE', 'SRT', 'STD', 'BSL', 'BSR', 'FFL', 'FFU', 'LFL', 'LFU', 'DDT', 'FBC', 'SQI', 'SQO', 'SQL',
  'PID', 'ALMD', 'ALMA',
  // GuardLogix safety instructions (SafetyProgram)
  'CROUT', 'ROUT', 'RIN', 'DCS', 'DCST', 'DCSTL', 'DCSTM', 'DCM', 'DCSRT', 'DCA', 'DCAF', 'DCI', 'ENPEN', 'EPMS', 'ESTOP',
  'FPMS', 'FSBM', 'LC', 'SMAT', 'THRS', 'THRSE', 'TSAM', 'TSSM', 'CBCM', 'CBIM', 'CBSSM', 'CPM', 'CSM', 'MVMT', 'SFX',
  // Motion
  'MSO', 'MSF', 'MASD', 'MASR', 'MAFR', 'MAS', 'MAH', 'MAJ', 'MAM', 'MAG', 'MCD', 'MRP',
  'MAPC', 'MCCP', 'MDAC', 'MCSV', 'MAW', 'MDW', 'MAR', 'MDR', 'MAOC', 'MDOC', 'MAAT', 'MRAT',
  'MAHD', 'MRHD', 'MDO', 'MDF', 'MATC', 'MDCC', 'MGS', 'MGSD', 'MGSR', 'MGSP', 'MGPS',
  'MCLM', 'MCCM', 'MCCD', 'MCS', 'MCSD', 'MCSR', 'MCT', 'MCTP', 'MCTO', 'MCTPO', 'MCPM',
]);
const MOTION_INSTRUCTIONS = new Set([...MNEMONICS].filter((m) => /^M[ACDGRS]/.test(m) && m !== 'MOV' && m !== 'MOVE' && m !== 'MVM' && m !== 'MOD' && m !== 'MUL' && m !== 'MSG' && m !== 'MCR' && m !== 'MEQ' && m !== 'MID'));
const MOTION_ENUM_WORDS = new Set([
  'Forward', 'Reverse', 'Trapezoidal', 'S-Curve', 'Disabled', 'Enabled', 'None', 'Jog', 'Yes', 'No', 'All',
  'Move', 'Gear', 'Home', 'Tune', 'Test', 'Absolute', 'Incremental', 'Actual', 'Command', 'Programmed',
  'Immediate', 'Fast', 'Slow', 'Coarse', 'Fine', 'Unidirectional', 'Bidirectional', 'Rotary', 'Linear', 'DEC',
  'Pending', 'Once', 'Continuous', 'Persistent', 'Master', 'Slave', 'Time', 'Position', 'Cam', 'Unwind',
  'Merge', 'Torque', 'Speed', 'Current', 'Active', 'Passive', 'Coordinated', 'Velocity', 'Acceleration',
  'Deceleration', 'Real', 'Virtual', 'Same', 'Opposite', 'Actual Position', 'Unlatch', 'Latch', 'Both', 'Ramp',
  'Bi-directional', 'Uni-directional', 'Bi-Directional', 'Uni-Directional', 'Linear-Cam', 'Cubic',
]);
const SKIP_ARGS = { JSR: 'routine-first', SBR: 'all', RET: 'all', JMP: 'all', LBL: 'all', FOR: 'routine-first', GSV: new Set([0, 1, 2]), SSV: new Set([0, 1, 2]) };
// Safety-instruction enumerations written as bare words in neutral text (CROUT feedback type, DCS input type, …).
const SAFETY_ENUM_WORDS = new Set(['NEGATIVE', 'POSITIVE', 'EQUIVALENT', 'COMPLEMENTARY', 'MANUAL', 'AUTOMATIC', 'ENABLE_PENDANT', 'EMERGENCY_STOP', 'LIGHT_CURTAIN', 'SAFETY_MAT', 'TWO_HAND_RUN_STATION', 'TWO_HAND_RUN_STATION_ENHANCED', 'DUAL_CHANNEL', 'SINGLE_CHANNEL']);

// ── generic helpers ─────────────────────────────────────────────────────────
const stripBom = (s) => s.replace(/^﻿/, '');
const normEol = (s) => s.replace(/\r\n?/g, '\n');
const attrOf = (open, name) => (open.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1] ?? null;
const lineOf = (text, idx) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
const uniq = (arr) => [...new Set(arr)];
const cap = (arr, n = 40) => (arr.length > n ? [...arr.slice(0, n), `...(+${arr.length - n} more)`] : arr);
const relRoot = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function readText(file) {
  try {
    if (!fs.existsSync(file)) return { ok: false, reason: 'missing' };
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, reason: 'not-a-file' };
    const raw = fs.readFileSync(file, 'utf8');
    return { ok: true, text: normEol(stripBom(raw)), bytes: st.size, mtime: st.mtime.toISOString() };
  } catch (e) { return { ok: false, reason: `unreadable: ${e.message}` }; }
}

/** Lightweight tag-stack check (ignores CDATA/comments/PI/self-closing). Returns null or {line, msg}. */
function stackCheck(text) {
  const stack = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt); if (e < 0) return { line: lineOf(text, lt), msg: 'unterminated CDATA' }; i = e + 3; continue; }
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); if (e < 0) return { line: lineOf(text, lt), msg: 'unterminated comment' }; i = e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt); if (e < 0) return { line: lineOf(text, lt), msg: 'unterminated processing instruction' }; i = e + 2; continue; }
    if (text.startsWith('<!', lt)) { const e = text.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    // find the end of this tag, honoring quoted attribute values
    let j = lt + 1, q = null;
    while (j < n) { const c = text[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    if (j >= n) return { line: lineOf(text, lt), msg: 'unterminated tag' };
    const tag = text.slice(lt, j + 1);
    if (tag[1] === '/') {
      const name = tag.slice(2, -1).trim();
      const top = stack.pop();
      if (!top) return { line: lineOf(text, lt), msg: `closing </${name}> with nothing open` };
      if (top.name !== name) return { line: lineOf(text, lt), msg: `closing </${name}> but <${top.name}> (opened line ${top.line}) is still open` };
    } else if (!tag.endsWith('/>')) {
      const name = (tag.match(/^<([A-Za-z_][\w.:-]*)/) || [])[1];
      if (name) stack.push({ name, line: lineOf(text, lt) });
    }
    i = j + 1;
  }
  if (stack.length) { const top = stack[stack.length - 1]; return { line: top.line, msg: `<${top.name}> opened at line ${top.line} is never closed (${stack.length} open)` }; }
  return null;
}

/** <Tag ...>…</Tag> / <Tag .../> declarations inside a <Tags> section, in order (duplicates preserved). */
function parseTagDecls(sectionXml) {
  const out = [];
  const re = /<Tag\s([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(sectionXml)) !== null) {
    const attrs = ' ' + m[1];
    const name = attrOf(attrs, 'Name');
    let block = m[0];
    let end = m.index + m[0].length;
    if (m[2] !== '/') {
      const close = sectionXml.indexOf('</Tag>', m.index);
      if (close > 0) { block = sectionXml.slice(m.index, close + 6); end = close + 6; }
    }
    re.lastIndex = end;
    if (!name) continue;
    out.push({
      name, block, start: m.index,
      dataType: attrOf(attrs, 'DataType'), usage: attrOf(attrs, 'Usage'), tagType: attrOf(attrs, 'TagType'),
      dims: attrOf(attrs, 'Dimensions'), cls: attrOf(attrs, 'Class'), use: attrOf(attrs, 'Use'), aliasFor: attrOf(attrs, 'AliasFor'),
      motionModule: attrOf(block, 'MotionModule'), motionGroup: attrOf(block, 'MotionGroup'),
    });
  }
  return out;
}
const tagsSectionOf = (xml) => { const m = xml.match(/<Tags(?:\s[^>]*)?>[\s\S]*?<\/Tags>|<Tags\s*\/>/); return m ? m[0] : null; };
// Member-path leaf type for ParameterConnection endpoints (same walk as validator.js leafTypeOfPath, kept local):
// `.Member` via <DataTypes> (BIT -> BOOL) or the tag's own Decorated data (module-defined / predefined structures),
// `[n]` strips one array level, a trailing `.bit` on an integer is BOOL. null = cannot follow (compare root types).
const INTEGER_TYPES = new Set(['SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT']);
function leafTypeOfPath(rootDataType, rootDims, restPath, { tagBlock = '', dataTypesXml = '' } = {}) {
  if (!rootDataType || !restPath) return null;
  let type = rootDataType, dims = rootDims ? String(rootDims) : null, consumed = 0;
  for (const s of restPath.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[(\d+(?:,\d+){0,2})\]/g)) {
    consumed += s[0].length;
    if (s[2] !== undefined) { if (!dims) return null; dims = null; continue; }
    const name = s[1];
    if (/^\d+$/.test(name)) { if (INTEGER_TYPES.has(type) && !dims) { type = 'BOOL'; continue; } return null; }
    if (dims) return null;
    const dt = dataTypesXml && dataTypesXml.match(new RegExp(`<DataType\\s+Name="${type.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/DataType>`));
    if (dt) {
      const mem = dt[1].match(new RegExp(`<Member\\s+Name="${name}"\\s+DataType="([^"]+)"\\s+Dimension="(\\d+)"`));
      if (!mem) return null;
      type = mem[1] === 'BIT' ? 'BOOL' : mem[1]; dims = Number(mem[2]) ? mem[2] : null; continue;
    }
    const dm = tagBlock && tagBlock.match(new RegExp(`<(?:ArrayMember|DataValueMember|StructureMember)\\s+Name="${name}"\\s+DataType="([^"]+)"(?:\\s+Dimensions="(\\d+)")?`));
    if (!dm) return null;
    type = dm[1]; dims = dm[2] || null;
  }
  return consumed === restPath.length ? type : null;
}
const namedBlocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}\\s([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map((m) => ({ name: attrOf(' ' + m[1], 'Name'), open: m[1], body: m[2], block: m[0], start: m.index }));
const normBody = (s) => s.replace(/<Dependencies>[\s\S]*?<\/Dependencies>/g, '').replace(/\s(CreatedDate|EditedDate|CreatedBy|EditedBy|SoftwareRevision|ExportDate)="[^"]*"/g, '').replace(/\s+/g, ' ').trim();

// ── rung tokenizer (same grammar as validator.js, kept local so the gate has no src/ dependency) ──
function splitArgs(argText) {
  const args = []; let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < argText.length; i++) {
    const c = argText[i];
    if (inStr) { cur += c; if (c === '$') { cur += argText[++i] || ''; continue; } if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') args.push(cur.trim());
  return args;
}
function extractInstructions(rungText) {
  const calls = []; const re = /([A-Za-z_][A-Za-z0-9_]*)\(/g; let m;
  while ((m = re.exec(rungText)) !== null) {
    let depth = 1, i = re.lastIndex, inStr = false;
    while (i < rungText.length && depth > 0) {
      const c = rungText[i];
      if (inStr) { if (c === '$') i++; else if (c === "'") inStr = false; } else if (c === "'") inStr = true; else if (c === '(') depth++; else if (c === ')') depth--;
      i++;
    }
    calls.push({ name: m[1], args: splitArgs(rungText.slice(re.lastIndex, i - 1)) });
    re.lastIndex = i;
  }
  return calls;
}
/** roots = identifiers at path starts; programRefs = [{prog, tag}] for \Prog.tag; moduleRefs = identifiers followed by ':' */
function operandRoots(operand) {
  const roots = [], programRefs = [], moduleRefs = [];
  let expectRoot = true;
  const re = /(S:[A-Za-z0-9\/]+)|(\\)?([A-Za-z_][A-Za-z0-9_]*)(:)?|(\d[#\w.]*|\.\d+)|([.\[\]()+\-*\/%<>=,&|! ])|('(?:\$.|[^'$])*')/g;
  let m;
  // groups: 1 S: system tag · 2 leading backslash · 3 identifier · 4 trailing colon (module ref) · 5 numeric · 6 separator/operator · 7 string literal
  while ((m = re.exec(operand)) !== null) {
    if (m[1] !== undefined || m[7] !== undefined || m[5] !== undefined) { expectRoot = false; continue; }
    if (m[6] !== undefined) {
      const c = m[6];
      if (c === '.') expectRoot = false; else if (c !== ']' && c !== ')') expectRoot = true;
      continue;
    }
    if (m[2]) {
      const rest = operand.slice(m.index + m[0].length);
      const tag = (rest.match(/^\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] ?? null;
      programRefs.push({ prog: m[3], tag });
      expectRoot = false; continue;
    }
    if (m[4]) { if (expectRoot) moduleRefs.push(m[3]); expectRoot = false; continue; }
    if (expectRoot) roots.push(m[3]);
    expectRoot = false;
  }
  return { roots, programRefs, moduleRefs };
}
/** Balanced parens/brackets outside string literals + trailing ';'. */
function rungSyntax(text) {
  let depthP = 0, depthB = 0, inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '$') i++; else if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '(') depthP++; else if (c === ')') { depthP--; if (depthP < 0) return 'stray ")"'; }
    else if (c === '[') depthB++; else if (c === ']') { depthB--; if (depthB < 0) return 'stray "]"'; }
  }
  if (inStr) return 'unterminated string literal';
  if (depthP) return 'unbalanced parentheses';
  if (depthB) return 'unbalanced branch brackets';
  if (!/;\s*$/.test(text)) return 'rung text does not end with ";"';
  return null;
}

// ── report ──────────────────────────────────────────────────────────────────
const report = {
  tool: 'assemble1160', name: NAME, date: new Date().toISOString(),
  buildDir: relRoot(BUILD_DIR), outDir: relRoot(OUT_DIR), template: relRoot(TEMPLATE), fallbackRef: FALLBACK_REF,
  ok: false, exitCode: 1,
  inputs: { controller: {}, extraTags: null, programs: [], trailingSectionsFrom: relRoot(TEMPLATE) },
  controller: {}, schedule: [], programs: [], contract: {}, stats: {},
  hardFailures: [], warnings: [], info: [],
  undeclaredByProgram: {}, output: null,
};
const seenFail = new Set();
const fail = (code, message, where) => { const k = `${code}|${message}`; if (seenFail.has(k)) return; seenFail.add(k); report.hardFailures.push({ code, message, ...(where ? { where } : {}) }); };
const seenWarn = new Set();
const warn = (code, message, where) => { const k = `${code}|${message}`; if (seenWarn.has(k)) return; seenWarn.add(k); report.warnings.push({ code, message, ...(where ? { where } : {}) }); };
const info = (code, message) => report.info.push({ code, message });

// ── 1. load controller sections ─────────────────────────────────────────────
const CTRL_SECTIONS = [
  { key: '00_header', wrap: null },
  { key: 'DataTypes', wrap: 'DataTypes' },
  { key: 'Modules', wrap: 'Modules' },
  { key: 'AddOnInstructionDefinitions', wrap: 'AddOnInstructionDefinitions' },
  { key: 'ControllerTags', wrap: 'Tags' },
  { key: 'Tasks', wrap: 'Tasks' },
  { key: 'ParameterConnections', wrap: 'ParameterConnections' },
];
const ctrl = {};
for (const { key, wrap } of CTRL_SECTIONS) {
  const buildPath = path.join(BUILD_DIR, 'controller', `${key}.xml`);
  let r = readText(buildPath);
  let source = 'build';
  if (!r.ok && FALLBACK_REF) {
    const refPath = path.join(REF_DIR, `${key}.xml`);
    const rr = readText(refPath);
    if (rr.ok) { r = rr; source = 'ref-fallback'; warn('fallback-ref-section', `controller section ${key}.xml is ${readText(buildPath).reason} in the build tree — borrowed the PRISTINE ChassisStandard piece (${relRoot(refPath)}); the 1160 builder has not delivered it yet`); }
  }
  if (!r.ok) {
    report.inputs.controller[key] = { path: relRoot(buildPath), status: r.reason };
    fail('missing-controller-section', `controller section ${key}.xml is ${r.reason} (${relRoot(buildPath)})${FALLBACK_REF ? ' and no ref fallback exists' : ' — pass --fallback-ref to borrow the pristine ChassisStandard piece for a smoke build'}`);
    continue;
  }
  let text = r.text.trim();
  if (wrap) {
    const openRe = new RegExp(`^<${wrap}(\\s|>|/>)`);
    if (!openRe.test(text)) {
      if (text === '') text = `<${wrap}/>`; else text = `<${wrap}>\n${text}\n</${wrap}>`;
      warn('section-wrapped', `${key}.xml did not start with <${wrap}> — wrapped it`);
    }
    if (!(new RegExp(`</${wrap}>\\s*$`).test(text) || new RegExp(`^<${wrap}\\s*/>$`).test(text))) fail('section-shape', `${key}.xml does not end with </${wrap}>`);
    const sc = stackCheck(text);
    if (sc) fail('piece-malformed', `${key}.xml: ${sc.msg} (piece line ${sc.line})`);
    else if (XMLValidator) { const wf = XMLValidator.validate(text); if (wf !== true) fail('piece-malformed', `${key}.xml: ${wf.err.msg} (piece line ${wf.err.line})`); }
  } else {
    // header: <?xml …?> + <RSLogix5000Content …> + <Controller …> + RedundancyInfo/Security/SafetyInfo; nothing from <DataTypes on.
    const dt = text.indexOf('<DataTypes');
    if (dt >= 0) { warn('header-trimmed', '00_header.xml carried content from <DataTypes onward — trimmed (the DataTypes piece is authoritative)'); text = text.slice(0, dt).trim(); }
    if (!/^<\?xml/.test(text)) fail('header-shape', '00_header.xml must start with the <?xml …?> declaration');
    if (!/<RSLogix5000Content\s/.test(text)) fail('header-shape', '00_header.xml lacks <RSLogix5000Content …>');
    if (!/<Controller\s/.test(text)) fail('header-shape', '00_header.xml lacks <Controller …>');
    if (/<\/Controller>|<\/RSLogix5000Content>/.test(text)) fail('header-shape', '00_header.xml must not close <Controller> or <RSLogix5000Content> (the trailing sections come from the template)');
  }
  ctrl[key] = text;
  report.inputs.controller[key] = { path: relRoot(source === 'build' ? buildPath : path.join(REF_DIR, `${key}.xml`)), status: 'ok', source, bytes: r.bytes, mtime: r.mtime };
}

// EXTRA_TAGS.xml → merged into ControllerTags (before </Tags>)
{
  const p = path.join(BUILD_DIR, 'controller', 'EXTRA_TAGS.xml');
  const r = readText(p);
  if (r.ok) {
    let decls = parseTagDecls(r.text);
    report.inputs.extraTags = { path: relRoot(p), status: 'ok', bytes: r.bytes, tags: decls.map((d) => d.name), skippedIdentical: [] };
    if (ctrl.ControllerTags) {
      // Concurrent builders: a tag delivered in BOTH ControllerTags.xml and EXTRA_TAGS.xml is skipped when the
      // blocks are identical (warned); a differing twin stays a duplicate-controller-tag hard failure below.
      const existing = new Map(parseTagDecls(ctrl.ControllerTags).map((d) => [d.name, normBody(d.block)]));
      decls = decls.filter((d) => {
        if (existing.has(d.name) && existing.get(d.name) === normBody(d.block)) { report.inputs.extraTags.skippedIdentical.push(d.name); return false; }
        return true;
      });
      if (report.inputs.extraTags.skippedIdentical.length) warn('extra-tags-duplicate-identical', `EXTRA_TAGS.xml repeats ${report.inputs.extraTags.skippedIdentical.length} tag(s) already in ControllerTags.xml with identical bodies — skipped: ${report.inputs.extraTags.skippedIdentical.join(', ')} (remove one copy)`);
      if (decls.length) {
        const blocks = decls.map((d) => d.block).join('\n');
        if (/^<Tags\s*\/>$/.test(ctrl.ControllerTags)) ctrl.ControllerTags = `<Tags>\n${blocks}\n</Tags>`;
        else ctrl.ControllerTags = ctrl.ControllerTags.replace(/<\/Tags>\s*$/, `${blocks}\n</Tags>`);
      } else if (!report.inputs.extraTags.tags.length) warn('extra-tags-empty', 'EXTRA_TAGS.xml exists but contains no <Tag> elements');
    } else warn('extra-tags-orphan', 'EXTRA_TAGS.xml present but there is no ControllerTags section to merge into');
  } else report.inputs.extraTags = { path: relRoot(p), status: r.reason };
}

// ── 2. load programs ────────────────────────────────────────────────────────
const programs = []; // { name, file, text, open, cls, mainRoutine, tags[], routines[], rungs[] }
{
  const dir = path.join(BUILD_DIR, 'programs');
  let files = [];
  try { files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.xml$/i.test(f)).sort() : []; }
  catch (e) { fail('programs-dir-unreadable', `${relRoot(dir)}: ${e.message}`); }
  if (!fs.existsSync(dir)) warn('programs-dir-missing', `${relRoot(dir)} does not exist yet`);
  for (const f of files) {
    const p = path.join(dir, f);
    const r = readText(p);
    const entry = { file: relRoot(p), status: r.ok ? 'ok' : r.reason, bytes: r.bytes ?? 0, mtime: r.mtime ?? null, program: null };
    report.inputs.programs.push(entry);
    if (!r.ok) { fail('program-piece-unreadable', `${relRoot(p)}: ${r.reason}`); continue; }
    const text = r.text.trim();
    const openM = text.match(/^<Program\b([^>]*)>/);
    if (!openM || !/<\/Program>\s*$/.test(text)) { fail('program-piece-shape', `${relRoot(p)} is not a single <Program …>…</Program> element`); entry.status = 'bad-shape'; continue; }
    const open = ' ' + openM[1];
    const name = attrOf(open, 'Name');
    if (!name) { fail('program-piece-shape', `${relRoot(p)}: <Program> has no Name attribute`); entry.status = 'no-name'; continue; }
    entry.program = name;
    const sc = stackCheck(text);
    if (sc) { fail('piece-malformed', `${relRoot(p)} (${name}): ${sc.msg} (piece line ${sc.line}) — EXCLUDED from the assembly`); entry.status = 'malformed'; continue; }
    if (XMLValidator) { const wf = XMLValidator.validate(text); if (wf !== true) { fail('piece-malformed', `${relRoot(p)} (${name}): ${wf.err.msg} (piece line ${wf.err.line}) — EXCLUDED from the assembly`); entry.status = 'malformed'; continue; } }
    const base = f.replace(/\.xml$/i, '').replace(/^Program_/, '');
    if (base !== name) warn('program-file-name', `${relRoot(p)} declares <Program Name="${name}"> — rename the file to ${name}.xml`);
    if (programs.some((q) => q.name === name)) { fail('duplicate-program', `program "${name}" is declared by more than one file (${programs.find((q) => q.name === name).file}, ${relRoot(p)}) — second copy EXCLUDED`); entry.status = 'duplicate'; continue; }
    const tagsSec = tagsSectionOf(text.slice(0, text.indexOf('<Routines') > 0 ? text.indexOf('<Routines') : text.length));
    const routines = namedBlocks(text, 'Routine').map((b) => ({ name: b.name, type: attrOf(' ' + b.open, 'Type'), body: b.body }));
    const rungs = [];
    for (const rt of routines) {
      for (const m of rt.body.matchAll(/<Rung\s([^>]*)>([\s\S]*?)<\/Rung>/g)) {
        const t = m[2].match(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/);
        rungs.push({ routine: rt.name, number: attrOf(' ' + m[1], 'Number'), text: t ? t[1].trim() : null });
      }
    }
    programs.push({
      name, file: relRoot(p), text, open, cls: attrOf(open, 'Class') || 'Standard', mainRoutine: attrOf(open, 'MainRoutineName'),
      tags: tagsSec ? parseTagDecls(tagsSec) : [], routines, rungs,
    });
  }
}

// ── 3. schedule + order ─────────────────────────────────────────────────────
const tasks = ctrl.Tasks ? [...ctrl.Tasks.matchAll(/<Task\s([^>]*)>([\s\S]*?)<\/Task>/g)].map((m) => ({
  name: attrOf(' ' + m[1], 'Name'), type: attrOf(' ' + m[1], 'Type'), cls: attrOf(' ' + m[1], 'Class') || 'Standard',
  programs: [...m[2].matchAll(/<ScheduledProgram\s+Name="([^"]+)"/g)].map((s) => s[1]),
})) : [];
report.schedule = tasks;
const scheduledOrder = [];
const taskOf = new Map();
for (const t of tasks) for (const n of t.programs) { if (!taskOf.has(n)) { taskOf.set(n, t); scheduledOrder.push(n); } else fail('double-scheduled', `program "${n}" is scheduled in both ${taskOf.get(n).name} and ${t.name}`); }
const byName = new Map(programs.map((p) => [p.name, p]));
for (const n of scheduledOrder) if (!byName.has(n)) fail('scheduled-program-missing', `Tasks schedules "${n}" (${taskOf.get(n).name}) but no program file delivers it${CONTRACT_PROGRAMS.has(n) ? ' — a NAMES CONTRACT program still to be built' : ' — not a NAMES CONTRACT program either'}`);
const ordered = [
  ...scheduledOrder.filter((n) => byName.has(n)).map((n) => byName.get(n)),
  ...programs.filter((p) => !taskOf.has(p.name)).sort((a, b) => a.name.localeCompare(b.name)),
];
for (const p of ordered) {
  const t = taskOf.get(p.name) || null;
  if (!t) { fail('program-not-scheduled', `program "${p.name}" (${p.file}) is not scheduled in any Task — appended after the scheduled programs; add <ScheduledProgram Name="${p.name}"/> to Tasks.xml`); }
  else if ((t.cls === 'Safety') !== (p.cls === 'Safety')) fail('task-class-mismatch', `program "${p.name}" (Class=${p.cls}) is scheduled in ${t.name} (Class=${t.cls}) — Studio rejects the schedule`);
  report.programs.push({
    name: p.name, file: p.file, class: p.cls, task: t ? t.name : null, scheduled: !!t, position: t ? scheduledOrder.indexOf(p.name) : null,
    mainRoutine: p.mainRoutine, routines: p.routines.map((r) => r.name), tags: p.tags.length,
    params: p.tags.filter((d) => d.usage).map((d) => `${d.name}:${d.usage}`), rungs: p.rungs.length, bytes: p.text.length,
  });
}

// ── 4. trailing sections from the pristine template ────────────────────────
let trailing = null;
{
  const r = readText(TEMPLATE);
  if (!r.ok) fail('template-missing', `pristine template ${relRoot(TEMPLATE)} is ${r.reason} — trailing sections (CST/WallClockTime/Trends/DataLogs/TimeSynchronize/EthernetPorts/OpcUaInfo) cannot be copied`);
  else {
    let cut = r.text.indexOf('</ParameterConnections>');
    let after = cut >= 0 ? cut + '</ParameterConnections>'.length : -1;
    if (after < 0) { cut = r.text.indexOf('</Tasks>'); after = cut >= 0 ? cut + '</Tasks>'.length : -1; warn('template-no-paramconns', 'template has no </ParameterConnections> — trailing sections taken after </Tasks>'); }
    if (after < 0) fail('template-shape', 'template has neither </ParameterConnections> nor </Tasks>');
    else {
      trailing = r.text.slice(after).trim();
      if (!/<\/Controller>\s*<\/RSLogix5000Content>$/.test(trailing)) fail('template-shape', 'template trailing block does not end with </Controller></RSLogix5000Content>');
      report.inputs.trailingSections = [...trailing.matchAll(/^<([A-Za-z]+)/gm)].map((m) => m[1]).filter((n) => !/^(Controller|RSLogix5000Content)$/.test(n));
    }
  }
}

// ── 5. assemble ─────────────────────────────────────────────────────────────
const parts = [];
if (ctrl['00_header']) parts.push(ctrl['00_header']);
for (const k of ['DataTypes', 'Modules', 'AddOnInstructionDefinitions', 'ControllerTags']) if (ctrl[k]) parts.push(ctrl[k]);
parts.push('<Programs>', ...ordered.map((p) => p.text), '</Programs>');
if (ctrl.Tasks) parts.push(ctrl.Tasks);
if (ctrl.ParameterConnections) parts.push(ctrl.ParameterConnections);
if (trailing) parts.push(trailing);
const xml = parts.join('\n') + '\n';

// ── 6. gates on the assembled document ─────────────────────────────────────
// 6a. well-formedness (whole document)
{
  const sc = stackCheck(xml);
  if (sc) fail('malformed', `assembled document: ${sc.msg} (line ${sc.line})`);
  if (XMLValidator) { const wf = XMLValidator.validate(xml); if (wf !== true) fail('malformed', `assembled document: ${wf.err.msg} (line ${wf.err.line}, col ${wf.err.col})`); }
  else warn('no-fast-xml-parser', 'fast-xml-parser not installed — only the lightweight stack check ran');
}
// 6b. Use="…" attributes anywhere except the <Controller Use="Target"> root (the template carries exactly that one)
for (const m of xml.matchAll(/<([A-Za-z][A-Za-z0-9]*)\b[^>]*?\sUse="([^"]+)"/g)) {
  if (m[1] === 'Controller') continue;
  fail('use-attribute', `<${m[1]} Use="${m[2]}"> at line ${lineOf(xml, m.index)} — Program-target export shape leaked into a Controller export (strip the attribute; Context stubs are never carried)`);
}
// 6c. header sanity
{
  const root = xml.match(/<RSLogix5000Content\s[^>]*>/);
  const con = xml.match(/<Controller\s[^>]*>/);
  const rootOpen = root ? ' ' + root[0] : '';
  const conOpen = con ? ' ' + con[0] : '';
  const local = ctrl.Modules ? ([...ctrl.Modules.matchAll(/<Module\s([^>]*)>/g)].map((mm) => ' ' + mm[1]).find((o) => attrOf(o, 'Name') === 'Local') ?? null) : null;
  report.controller = {
    targetName: attrOf(rootOpen, 'TargetName'), targetType: attrOf(rootOpen, 'TargetType'), containsContext: attrOf(rootOpen, 'ContainsContext'),
    softwareRevision: attrOf(rootOpen, 'SoftwareRevision'), name: attrOf(conOpen, 'Name'), processorType: attrOf(conOpen, 'ProcessorType'),
    majorRev: attrOf(conOpen, 'MajorRev'), minorRev: attrOf(conOpen, 'MinorRev'), localCatalog: local ? attrOf(' ' + local, 'CatalogNumber') : null,
  };
  const c = report.controller;
  if (root && c.targetType !== 'Controller') fail('header-target-type', `TargetType="${c.targetType}" — a controller export must be TargetType="Controller"`);
  if (root && c.containsContext !== 'false') warn('header-contains-context', `ContainsContext="${c.containsContext}" — expected "false" for a controller export`);
  if (root && con && c.targetName !== c.name) warn('header-name-mismatch', `TargetName="${c.targetName}" but Controller Name="${c.name}"`);
  if (con && c.localCatalog && c.processorType !== c.localCatalog) warn('processor-vs-local', `Controller ProcessorType="${c.processorType}" but Local module CatalogNumber="${c.localCatalog}"`);
  if (con && report.inputs.controller['00_header']?.source === 'build') {
    if (c.name !== CONTRACT_CONTROLLER.name) warn('contract-controller-name', `Controller Name="${c.name}" — NAMES CONTRACT says ${CONTRACT_CONTROLLER.name}`);
    if (c.processorType !== CONTRACT_CONTROLLER.processor) warn('contract-processor', `ProcessorType="${c.processorType}" — NAMES CONTRACT says ${CONTRACT_CONTROLLER.processor}`);
  }
}
// 6d. declarations
const dataTypes = ctrl.DataTypes ? namedBlocks(ctrl.DataTypes, 'DataType') : [];
const aois = ctrl.AddOnInstructionDefinitions ? namedBlocks(ctrl.AddOnInstructionDefinitions, 'AddOnInstructionDefinition') : [];
const modules = ctrl.Modules ? [...ctrl.Modules.matchAll(/<Module\s([^>]*)>/g)].map((m) => ({ name: attrOf(' ' + m[1], 'Name'), catalog: attrOf(' ' + m[1], 'CatalogNumber'), open: m[1] })) : [];
const moduleNames = new Set(modules.map((m) => m.name).filter(Boolean));
// Module I/O endpoints for ParameterConnections (Local:3:I.Pt00.Data — how ShowRoomChassis wires local 5069 points):
// parent module + upstream port address (= slot for a Local card) + the connection-tag bodies so a member can be checked.
const moduleSlots = ctrl.Modules ? [...ctrl.Modules.matchAll(/<Module\s([^>]*)>([\s\S]*?)<\/Module>/g)].map((m) => {
  const open = ' ' + m[1], body = m[2];
  const port = body.match(/<Port\s[^>]*Upstream="true"[^>]*>/) || body.match(/<Port\s[^>]*>/);
  const sec = (tag) => { const s = body.indexOf(`<${tag}`), e = body.indexOf(`</${tag}>`); return s >= 0 && e > s ? body.slice(s, e) : null; };
  return { name: attrOf(open, 'Name'), catalog: attrOf(open, 'CatalogNumber'), parent: attrOf(open, 'ParentModule'), address: port ? attrOf(' ' + port[0], 'Address') : null, inputTag: sec('InputTag'), outputTag: sec('OutputTag'), configTag: sec('ConfigTag') };
}) : [];
const ctrlTagDecls = ctrl.ControllerTags ? parseTagDecls(ctrl.ControllerTags) : [];
const ctrlTags = new Map(ctrlTagDecls.map((d) => [d.name, d]));
const dtNames = new Set(dataTypes.map((d) => d.name));
const aoiNames = new Set(aois.map((a) => a.name));
const dupesOf = (names) => { const c = new Map(); for (const n of names) c.set(n, (c.get(n) || 0) + 1); return [...c.entries()].filter(([, k]) => k > 1).map(([n, k]) => `${n} x${k}`); };
for (const d of dupesOf(dataTypes.map((d) => d.name))) {
  const same = uniq(dataTypes.filter((x) => x.name === d.split(' x')[0]).map((x) => normBody(x.block))).length === 1;
  fail('duplicate-datatype', `DataType ${d} declared more than once${same ? ' (identical bodies — drop the copy)' : ' with DIFFERENT bodies — same name + different definition is a hard stop, never a silent keep'}`);
}
for (const d of dupesOf(aois.map((a) => a.name))) {
  const same = uniq(aois.filter((x) => x.name === d.split(' x')[0]).map((x) => normBody(x.block))).length === 1;
  fail('duplicate-aoi', `AddOnInstructionDefinition ${d} declared more than once${same ? ' (identical bodies — drop the copy)' : ' with DIFFERENT bodies — same name + different logic is a hard stop'}`);
}
for (const n of [...dtNames].filter((n) => aoiNames.has(n))) fail('datatype-aoi-collision', `"${n}" is both a DataType and an AddOnInstructionDefinition`);
for (const d of dupesOf(ctrlTagDecls.map((t) => t.name))) fail('duplicate-controller-tag', `controller Tag ${d} declared more than once (ControllerTags.xml + EXTRA_TAGS.xml?)`);
for (const d of dupesOf(modules.map((m) => m.name).filter(Boolean))) fail('duplicate-module', `Module ${d} declared more than once`);
for (const p of ordered) for (const d of dupesOf(p.tags.map((t) => t.name))) fail('duplicate-program-tag', `program ${p.name}: Tag ${d} declared more than once`);
for (const t of ctrlTagDecls) if (aoiNames.has(t.name)) warn('tag-aoi-name', `controller tag "${t.name}" shares its name with an AOI`);
for (const t of ctrlTagDecls) if (t.usage) fail('controller-tag-usage', `controller tag "${t.name}" carries Usage="${t.usage}" — Usage is a program-parameter attribute; a hoisted program tag`);
// module-defined data types on controller tags must be produced by a declared module.
// The PRISTINE ChassisStandard carries four such orphans itself (vb01_MainMachine_IN/OUT,
// cam01_Inspection_IN/OUT — their modules were deleted from the template but the tags
// stayed). A tag byte-identical to the pristine one is an inherited leftover: warned, not
// failed, so the template round-trips; the 1160 controller builder still deletes them or
// backs them with real modules.
const refCtrlBlocks = (() => {
  const r = readText(path.join(REF_DIR, 'ControllerTags.xml'));
  return new Map(r.ok ? parseTagDecls(r.text).map((d) => [d.name, normBody(d.block)]) : []);
})();
for (const t of ctrlTagDecls) {
  if (t.dataType && /:[IOC]:\d+$/.test(t.dataType) && ctrl.Modules && !ctrl.Modules.includes(`DataType="${t.dataType}"`)) {
    const msg = `controller tag "${t.name}" is typed ${t.dataType} but no <Module> in Modules.xml produces that connection type — the buffer's module is missing or its connection format differs`;
    if (refCtrlBlocks.get(t.name) === normBody(t.block)) warn('inherited-template-leftover', `${msg} (identical to the pristine ChassisStandard tag — template leftover: delete it or add the module)`);
    else fail('module-defined-type-missing', msg);
  }
}
// axis tags → MotionModule/MotionGroup must exist
for (const t of ctrlTagDecls) {
  if (t.dataType === 'AXIS_CIP_DRIVE' || t.dataType === 'AXIS_VIRTUAL') {
    const mod = t.motionModule ? t.motionModule.split(':')[0] : null;
    if (t.dataType === 'AXIS_CIP_DRIVE' && (!mod || !moduleNames.has(mod))) fail('axis-module-missing', `axis tag "${t.name}" binds MotionModule="${t.motionModule}" but no <Module Name="${mod}"> exists — Studio fails the axis import`);
    if (!t.motionGroup || !ctrlTags.has(t.motionGroup) || ctrlTags.get(t.motionGroup).dataType !== 'MOTION_GROUP') fail('axis-group-missing', `axis tag "${t.name}" names MotionGroup="${t.motionGroup}" which is not a MOTION_GROUP controller tag`);
  }
}
// 6e. per-program shape + rung syntax + JSR + main routine + contract params
const programTagMaps = new Map(ordered.map((p) => [p.name, new Map(p.tags.map((t) => [t.name, t]))]));
for (const p of ordered) {
  const routineNames = new Set(p.routines.map((r) => r.name));
  if (!p.mainRoutine) fail('main-routine-missing', `program ${p.name}: <Program> lacks MainRoutineName`);
  else if (!routineNames.has(p.mainRoutine)) fail('main-routine-missing', `program ${p.name}: MainRoutineName="${p.mainRoutine}" is not a routine of the program (${[...routineNames].join(', ') || 'none'})`);
  for (const r of p.routines) if (!r.type) warn('routine-type', `program ${p.name}: routine ${r.name} has no Type attribute (template: Type="RLL")`);
  const byRoutine = new Map();
  for (const r of p.rungs) { if (!byRoutine.has(r.routine)) byRoutine.set(r.routine, []); byRoutine.get(r.routine).push(r); }
  for (const [rn, list] of byRoutine) {
    const nums = list.map((r) => Number(r.number));
    if (nums.some((n, i) => n !== i)) warn('rung-numbering', `program ${p.name}/${rn}: rung Number attributes are not 0..${list.length - 1} in order`);
  }
  for (const r of p.rungs) {
    if (r.text === null) { fail('rung-no-text', `program ${p.name}/${r.routine} rung ${r.number}: no <Text><![CDATA[…]]></Text>`); continue; }
    const err = rungSyntax(r.text);
    if (err) fail('rung-syntax', `program ${p.name}/${r.routine} rung ${r.number}: ${err} — "${r.text.slice(0, 80)}"`);
    for (const call of extractInstructions(r.text)) {
      if (call.name === 'JSR' && call.args[0] && !routineNames.has(call.args[0])) fail('jsr-target-missing', `program ${p.name}/${r.routine} rung ${r.number}: JSR(${call.args[0]}) — no such routine in ${p.name}`);
    }
  }
  if (/^S\d\d_/.test(p.name) || p.name === 'Chassis') {
    for (const q of ['q_AlarmActive', 'q_WarningActive']) {
      const d = programTagMaps.get(p.name).get(q);
      if (!d) warn('contract-alarm-params', `program ${p.name} lacks ${q} (NAMES CONTRACT: every program declares Output BOOL q_AlarmActive and q_WarningActive for R20 ProgramAlarmHandler)`);
      else if (d.usage !== 'Output' || d.dataType !== 'BOOL') warn('contract-alarm-params', `program ${p.name}: ${q} must be Usage="Output" DataType="BOOL" (is ${d.usage}/${d.dataType})`);
    }
  }
}
// 6f. cross-program references, module refs, undeclared-tag audit
const REF_OK_USAGE = new Set(['Public', 'Output', 'Input']);
// Atomic Logix types — everything else declared without Dimensions is a structure and must never be followed by '['.
const ATOMIC_TYPES = new Set(['BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT', 'REAL', 'LREAL']);
const isMap = (n) => /^Map(Inputs|Outputs)$/.test(n);
const bufferUsedBy = new Map(); // controller buffer tag → programs
const moduleUsedBy = new Map();
const mapPairs = []; // { module, buffer, program } from CPS/COP rungs in MapInputs/MapOutputs
for (const p of ordered) {
  const local = programTagMaps.get(p.name);
  const undeclared = new Map(); // root → first location
  const routineNames = new Set(p.routines.map((r) => r.name));
  for (const r of p.rungs) {
    if (r.text === null) continue;
    const where = `${p.name}/${r.routine} rung ${r.number}`;
    for (const call of extractInstructions(r.text)) {
      const isAoi = aoiNames.has(call.name);
      if (!MNEMONICS.has(call.name) && !isAoi) { warn('unknown-instruction', `${where}: "${call.name}(" is not a Logix mnemonic in this gate's vocabulary nor a declared AOI (validate1160 decides; if it is a real instruction, add it to MNEMONICS)`); }
      const skip = SKIP_ARGS[call.name];
      call.args.forEach((arg, idx) => {
        if (arg === '' || arg === '?' || arg === '??') return;
        if (skip === 'all') return;
        if (skip === 'routine-first' && idx === 0) return;
        if (skip === 'routine-first' && /^\d/.test(arg)) return;
        if (skip instanceof Set && skip.has(idx)) return;
        if (MOTION_INSTRUCTIONS.has(call.name) && idx >= 2 && (arg.includes(' ') || MOTION_ENUM_WORDS.has(arg))) return;
        if (SAFETY_ENUM_WORDS.has(arg)) return;
        const { roots, programRefs, moduleRefs } = operandRoots(arg);
        // v0.1 lint #1 (import-fatal, invisible to the sim): a structure-typed root tag followed by '[' — the module buffers
        // (AB:ETHERNET_MODULE_SINT_4Bytes:I:0 …) are STRUCTURES whose array is the .Data member: vb01_X_IN.Data[1].2, never vb01_X_IN[1].2.
        for (const im of arg.matchAll(/(^|[^A-Za-z0-9_.\\])([A-Za-z_][A-Za-z0-9_]*)\[/g)) {
          const rootTag = im[2];
          const decl = local.get(rootTag) || ctrlTags.get(rootTag);
          if (!decl || decl.dims || decl.tagType === 'Alias' || !decl.dataType || ATOMIC_TYPES.has(decl.dataType)) continue;
          fail('structure-indexed-as-array', `${where}: "${rootTag}[" — ${rootTag} is a ${decl.dataType} structure with no Dimensions; Studio rejects the rung at import. Index its array member instead${/:[IOC]:\d+$/.test(decl.dataType) ? ` (module buffer: ${rootTag}.Data[n].b)` : ''}`);
        }
        if (isMap(p.name) && /^(CPS|COP)$/.test(call.name)) {
          // pair module connection ↔ buffer tag: CPS(mod:I, X_IN, 1) / CPS(X_OUT, mod:O, 1)
          const modRef = (arg.match(/^([A-Za-z_][A-Za-z0-9_]*):[IO]\b/) || [])[1];
          const buf = (arg.match(/^([A-Za-z_][A-Za-z0-9_]*_(?:IN|OUT))$/) || [])[1];
          const other = call.args[idx === 0 ? 1 : 0] || '';
          if (modRef) mapPairs.push({ module: modRef, buffer: (other.match(/^([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || other, program: p.name });
          else if (buf) mapPairs.push({ module: (other.match(/^([A-Za-z_][A-Za-z0-9_]*):/) || [])[1] || null, buffer: buf, program: p.name });
        }
        for (const ref of programRefs) {
          const target = byName.get(ref.prog);
          const label = `\\${ref.prog}${ref.tag ? '.' + ref.tag : ''}`;
          if (!target) { fail('xref-program-missing', `${where}: ${label} — no program "${ref.prog}" in this assembly${CONTRACT_PROGRAMS.has(ref.prog) ? ' (NAMES CONTRACT program not delivered yet)' : ' (NOT a NAMES CONTRACT program name)'}`); continue; }
          if (!ref.tag) continue;
          const decl = programTagMaps.get(ref.prog).get(ref.tag);
          if (!decl) { fail('xref-tag-missing', `${where}: ${label} — program ${ref.prog} declares no tag "${ref.tag}"`); continue; }
          if (!decl.usage) { fail('xref-not-parameter', `${where}: ${label} — "${ref.tag}" is a program-local tag in ${ref.prog} (no Usage); cross-program reads need Usage="Public" (or Output/Input)`); continue; }
          if (!REF_OK_USAGE.has(decl.usage)) { fail('xref-usage', `${where}: ${label} — Usage="${decl.usage}" cannot be referenced as \\Prog.tag (InOut is connection-only)`); continue; }
          if (/^p_/.test(ref.tag) && !(decl.usage === 'Public' || decl.usage === 'Output')) fail('xref-p-usage', `${where}: ${label} — p_ signals must be Public or Output parameters (is ${decl.usage})`);
        }
        for (const mod of moduleRefs) {
          if (!moduleNames.has(mod)) {
            if (isMap(p.name)) fail('map-module-missing', `${where}: "${mod}:" — no <Module Name="${mod}"> in Modules.xml`);
            else if (!undeclared.has(mod)) undeclared.set(mod, `${where}: ${call.name}(${arg}) [module ref]`);
          } else if (!moduleUsedBy.has(mod)) moduleUsedBy.set(mod, p.name);
        }
        for (const root of roots) {
          if (aoiNames.has(root) || routineNames.has(root)) continue;
          if (local.has(root)) continue;
          if (ctrlTags.has(root)) { if (/_(IN|OUT)$/.test(root) && !bufferUsedBy.has(root)) bufferUsedBy.set(root, p.name); continue; }
          if (moduleNames.has(root)) continue;
          if (isMap(p.name)) { fail(/_(IN|OUT)$/.test(root) ? 'map-buffer-missing' : 'map-undeclared', `${where}: "${root}" is not a controller tag${/_(IN|OUT)$/.test(root) ? ' — module buffer tag missing from ControllerTags.xml/EXTRA_TAGS.xml' : ''}`); continue; }
          if (!undeclared.has(root)) undeclared.set(root, `${where}: ${call.name}(${arg})`);
        }
      });
    }
  }
  if (undeclared.size) {
    report.undeclaredByProgram[p.name] = [...undeclared.entries()].map(([root, loc]) => ({ tag: root, firstSeen: loc }));
    warn('undeclared-tags', `program ${p.name} uses ${undeclared.size} tag(s) declared nowhere (program, controller, module, \\Prog): ${cap([...undeclared.keys()], 12).join(', ')}`);
  }
}
// module buffers: every generic-module buffer tag should be mapped by MapInputs/MapOutputs, every module with buffers should be mapped
{
  const mapProgs = ordered.filter((p) => isMap(p.name)).map((p) => p.name);
  const bufferTags = ctrlTagDecls.filter((t) => /_(IN|OUT)$/.test(t.name) && t.dataType && /:[IOC]:\d+$/.test(t.dataType));
  // Buffer ↔ module binding comes from the CPS rungs themselves ({kind}{NN}_{Name}_IN/_OUT is the contract
  // naming; the module name is only implied for generic Ethernet nodes, never for local cards like AIN1).
  report.stats.moduleBuffers = bufferTags.map((t) => {
    const pair = mapPairs.find((m) => m.buffer === t.name);
    return { tag: t.name, dataType: t.dataType, mappedBy: bufferUsedBy.get(t.name) || null, pairedModule: pair ? pair.module : null, pairedModuleExists: pair && pair.module ? moduleNames.has(pair.module) : null };
  });
  for (const b of report.stats.moduleBuffers) {
    if (mapProgs.length && !b.mappedBy) warn('buffer-unmapped', `buffer tag ${b.tag} is not referenced by ${mapProgs.join('/')} — field data never reaches the programs`);
    if (b.pairedModule && b.pairedModuleExists === false) fail('map-module-missing', `${b.tag} is copied to/from "${b.pairedModule}:" but no <Module Name="${b.pairedModule}"> exists`);
  }
  const genericModules = modules.filter((m) => m.catalog === 'ETHERNET-MODULE').map((m) => m.name);
  for (const m of genericModules) if (mapProgs.length && !mapPairs.some((p) => p.module === m)) warn('module-unmapped', `generic ETHERNET-MODULE "${m}" has no CPS rung in ${mapProgs.join('/')} — its connection data is never copied to a buffer`);
  report.stats.mapPairs = mapPairs;
  if (!mapProgs.length && bufferTags.length) info('no-map-programs', `MapInputs/MapOutputs not delivered yet — ${bufferTags.length} module buffer tag(s) unmapped so far`);
}
// 6g. ParameterConnections ↔ InOut parameters
const conns = ctrl.ParameterConnections ? [...ctrl.ParameterConnections.matchAll(/<ParameterConnection\s+EndPoint1="([^"]+)"\s+EndPoint2="([^"]+)"\s*\/>/g)].map((m) => ({ ep1: m[1], ep2: m[2] })) : [];
report.stats.parameterConnections = conns;
{
  const resolveEp = (ep) => {
    if (ep.startsWith('\\')) {
      const m = ep.match(/^\\([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
      if (!m) return { err: 'malformed program endpoint' };
      const prog = byName.get(m[1]);
      if (!prog) return { err: `program "${m[1]}" is not in this assembly` };
      const decl = programTagMaps.get(m[1]).get(m[2]);
      if (!decl) return { err: `program ${m[1]} has no parameter "${m[2]}" (deleted or absent — Jason's rejected-import class)` };
      if (!decl.usage) return { err: `${m[1]}.${m[2]} is a local tag, not a parameter` };
      if (decl.usage === 'Public') return { err: `${m[1]}.${m[2]} is Public — Public parameters cannot be connected` };
      return { decl };
    }
    // Module I/O endpoint: <parent>:<address>:<I|O|C>.<member>… — the card must exist in that slot and own the member.
    const mio = ep.match(/^([A-Za-z_][A-Za-z0-9_]*):(\d+):([IOC])((?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)*)$/);
    if (mio) {
      const mod = moduleSlots.find((x) => x.parent === mio[1] && x.address === mio[2] && x.name !== mio[1]);
      if (!mod) return { err: `module I/O endpoint ${mio[1]}:${mio[2]}:${mio[3]} — no <Module> with ParentModule="${mio[1]}" at address ${mio[2]} in Modules.xml` };
      const first = (mio[4].match(/^\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || null;
      if (!first) return { err: `module I/O endpoint ${ep} names the whole connection — connect one member (e.g. .Pt00.Data)` };
      const sec = mio[3] === 'I' ? mod.inputTag : mio[3] === 'O' ? mod.outputTag : mod.configTag;
      if (sec && !sec.includes(`Name="${first}"`)) return { err: `module ${mod.name} (${mod.catalog}) ${mio[3]} connection has no member "${first}" — a point the card does not have` };
      return { decl: { dataType: /\.Pt\d\d\.Data$/.test(mio[4]) ? 'BOOL' : null, module: mod.name } };
    }
    const root = ep.split(/[.[]/)[0];
    const decl = ctrlTags.get(root);
    if (!decl) return { err: `controller tag "${root}" is not declared` };
    // A member path (cam03_LeftBranchInspect_IN.Data[1].0) resolves to its leaf type - Studio connects a BOOL parameter
    // to a bit of an INT array element (Jason's IV4 example: cam02_IV4:I1.Data[1].0 <-> i_CameraResultsAvailable).
    const leaf = leafTypeOfPath(decl.dataType, decl.dims, ep.slice(root.length), { tagBlock: decl.block, dataTypesXml: ctrl.DataTypes || '' });
    return { decl: leaf ? { ...decl, dataType: leaf } : decl };
  };
  for (const c of conns) {
    const a = resolveEp(c.ep1), b = resolveEp(c.ep2);
    const label = `ParameterConnection ${c.ep1} <-> ${c.ep2}`;
    if (a.err) fail('paramconn-dangling', `${label}: ${a.err}`);
    if (b.err) fail('paramconn-dangling', `${label}: ${b.err}`);
    if (a.decl && b.decl && a.decl.dataType && b.decl.dataType && a.decl.dataType !== b.decl.dataType) fail('paramconn-type', `${label}: ${a.decl.dataType} vs ${b.decl.dataType} — incompatible`);
  }
  for (const p of ordered) for (const t of p.tags) {
    if (t.usage !== 'InOut') continue;
    const ep = `\\${p.name}.${t.name}`;
    if (!conns.some((c) => c.ep1 === ep || c.ep2 === ep)) fail('inout-unconnected', `${ep} (${t.dataType}) has no <ParameterConnection> — an unconnected InOut parameter is a Studio verify error`);
  }
}
// 6g2. Studio 5000 import limits (same numbers validator.js checkImportLimits enforces): Description 512,
//      operand comment 512, Logix name 40 + legal identifier, rung comment 4096 (warn) / 65000 (fail).
{
  const MAX_DESC = 512, MAX_NAME = 40, RUNG_WARN = 4096, RUNG_FAIL = 65000;
  const owner = (idx) => {
    const before = xml.slice(0, idx);
    const m = before.match(/<(Program|Tag|Routine|DataType|Member|Module|AddOnInstructionDefinition|Parameter|LocalTag|Rung)\b([^>]*)>(?![\s\S]*<(?:Program|Tag|Routine|DataType|Member|Module|AddOnInstructionDefinition|Parameter|LocalTag|Rung)\b)/);
    if (!m) return `line ${lineOf(xml, idx)}`;
    const prog = (before.match(/<Program\b[^>]*?\sName="([^"]+)"(?![\s\S]*<Program\b)/) || [])[1];
    const nm = attrOf(' ' + m[2], 'Name') ?? attrOf(' ' + m[2], 'Number');
    return `<${m[1]}${nm ? ` ${m[1] === 'Rung' ? 'Number' : 'Name'}="${nm}"` : ''}>${prog && m[1] !== 'Program' ? ` in program ${prog}` : ''} (line ${lineOf(xml, idx)})`;
  };
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Description>/g)) {
    if (m[1].length > MAX_DESC) fail('description-too-long', `Description is ${m[1].length} chars (Studio limit ${MAX_DESC} — import fails "Text may be too long") on ${owner(m.index)}: "${m[1].slice(0, 70).replace(/\s+/g, ' ')}..."`);
  }
  for (const m of xml.matchAll(/<Comment Operand="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    if (m[2].length > MAX_DESC) fail('operand-comment-too-long', `operand comment "${m[1]}" is ${m[2].length} chars (limit ${MAX_DESC}) on ${owner(m.index)}`);
  }
  for (const m of xml.matchAll(/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    if (m[1].length > RUNG_FAIL) fail('rung-comment-too-long', `rung comment is ${m[1].length} chars (> ${RUNG_FAIL}) on ${owner(m.index)}`);
    else if (m[1].length > RUNG_WARN) warn('rung-comment-long', `rung comment is ${m[1].length} chars (> ${RUNG_WARN}) on ${owner(m.index)} — verify it imports`);
  }
  for (const m of xml.matchAll(/<(Program|Routine|Tag|AddOnInstructionDefinition|DataType|Module|Task)\b[^>]*?\sName="([^"]+)"/g)) {
    const [, kind, name] = m;
    if (name.length > MAX_NAME) fail('name-too-long', `${kind} name "${name}" is ${name.length} chars — Logix names max ${MAX_NAME}`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail('name-illegal', `${kind} name "${name}" is not a legal Logix identifier`);
    else if (/__/.test(name) || /_$/.test(name)) fail('name-illegal', `${kind} name "${name}" has consecutive or trailing underscores — Logix rejects it`);
  }
}
// 6h. non-ASCII
{
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m; const badOut = [];
  const spans = [];
  while ((m = cdataRe.exec(xml)) !== null) {
    spans.push([m.index, m.index + m[0].length]);
    const bad = m[1].match(/[^\x09\x0A\x0D\x20-\x7E]/);
    if (bad) {
      const at = m.index + 9 + m[1].indexOf(bad[0]);
      const before = xml.slice(0, at);
      const prog = (before.match(/<Program\b[^>]*?\sName="([^"]+)"(?![\s\S]*<Program\b)/) || [])[1];
      const rt = (before.match(/<Routine\b[^>]*?\sName="([^"]+)"(?![\s\S]*<Routine\b)/) || [])[1];
      const code = bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      fail('non-ascii-cdata', `U+${code} ${JSON.stringify(bad[0])} inside CDATA at line ${lineOf(xml, at)}${prog ? ` (${prog}${rt ? '/' + rt : ''})` : ''} — Studio imports are ASCII-only (write 'deg', '-', "'"; never a degree sign or smart quote)`);
    }
  }
  const outRe = /[^\x09\x0A\x0D\x20-\x7E]/g;
  while ((m = outRe.exec(xml)) !== null) {
    if (spans.some(([s, e]) => m.index >= s && m.index < e)) continue;
    badOut.push(`U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} at line ${lineOf(xml, m.index)}`);
    if (badOut.length > 20) break;
  }
  if (badOut.length) warn('non-ascii-markup', `non-ASCII outside CDATA (attributes/markup): ${cap(badOut, 8).join('; ')}`);
}
// 6i. NAMES CONTRACT coverage
{
  const present = ordered.map((p) => p.name);
  report.contract = {
    programsExpected: CONTRACT_PROGRAMS.size,
    present: CONTRACT_MAIN_TASK.concat(CONTRACT_SAFETY_TASK).filter((n) => present.includes(n)),
    missing: CONTRACT_MAIN_TASK.concat(CONTRACT_SAFETY_TASK).filter((n) => !present.includes(n)),
    unexpected: present.filter((n) => !CONTRACT_PROGRAMS.has(n)),
    scheduleVsContract: (() => {
      const main = tasks.find((t) => t.name === 'MainTask');
      if (!main) return 'no MainTask in Tasks.xml';
      const got = main.programs.filter((n) => CONTRACT_PROGRAMS.has(n));
      const want = CONTRACT_MAIN_TASK.filter((n) => main.programs.includes(n));
      return JSON.stringify(got) === JSON.stringify(want) ? 'MainTask order matches the NAMES CONTRACT' : `MainTask order differs from the NAMES CONTRACT: got ${got.join(' > ')}`;
    })(),
  };
  for (const n of report.contract.unexpected) {
    const src = report.inputs.controller['00_header']?.source;
    if (src === 'ref-fallback' && /^(S0[123]_|S18_|S19_|S20_)/.test(n)) continue; // pristine template stations during a fallback smoke build
    warn('contract-unexpected-program', `program "${n}" is not in the NAMES CONTRACT program table — rename or remove (no invented program names)`);
  }
  if (report.contract.missing.length) info('contract-missing-programs', `${report.contract.missing.length} NAMES CONTRACT program(s) not delivered yet: ${report.contract.missing.join(', ')}`);
  if (!/matches/.test(report.contract.scheduleVsContract)) warn('contract-schedule-order', report.contract.scheduleVsContract);
}

// ── 7. write ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const outL5x = path.join(OUT_DIR, `${NAME}.L5X`);
const outRep = path.join(OUT_DIR, `${NAME}.report.json`);
const crlf = '﻿' + xml.replace(/\n/g, '\r\n');
fs.writeFileSync(outL5x, crlf, 'utf8');
report.stats.bytes = Buffer.byteLength(crlf, 'utf8');
report.stats.lines = xml.split('\n').length - 1;
report.stats.dataTypes = dataTypes.length;
report.stats.aois = aois.length;
report.stats.modules = modules.map((m) => `${m.name} (${m.catalog})`);
report.stats.controllerTags = ctrlTagDecls.length;
report.stats.programs = ordered.length;
report.stats.rungs = ordered.reduce((n, p) => n + p.rungs.length, 0);
report.ok = report.hardFailures.length === 0;
report.exitCode = report.ok ? 0 : 1;
report.output = { l5x: relRoot(outL5x), report: relRoot(outRep), importable: report.ok };
fs.writeFileSync(outRep, JSON.stringify(report, null, 2), 'utf8');

// ── 8. console ──────────────────────────────────────────────────────────────
if (!QUIET) {
  const c = report.controller;
  console.log(`assemble1160 ${NAME}: ${report.ok ? 'OK' : 'HARD FAILURES'} — ${report.hardFailures.length} hard, ${report.warnings.length} warnings`);
  console.log(`  controller: ${c.name ?? '?'} (${c.processorType ?? '?'} v${c.majorRev ?? '?'}) TargetType=${c.targetType ?? '?'} | DataTypes ${dataTypes.length} | AOIs ${aois.length} | Modules ${modules.length} | ctrl tags ${ctrlTagDecls.length} | programs ${ordered.length} (${report.stats.rungs} rungs) | ${report.stats.bytes} bytes`);
  console.log(`  sections: ${CTRL_SECTIONS.map(({ key }) => `${key}=${report.inputs.controller[key]?.status === 'ok' ? report.inputs.controller[key].source : report.inputs.controller[key]?.status}`).join(' ')}${report.inputs.extraTags?.status === 'ok' ? ` EXTRA_TAGS=${report.inputs.extraTags.tags.length}` : ''}`);
  console.log(`  programs: ${ordered.map((p) => `${p.name}${taskOf.has(p.name) ? '' : '(UNSCHEDULED)'}`).join(', ') || 'none delivered yet'}`);
  console.log(`  contract: ${report.contract.present.length}/${report.contract.programsExpected} present; missing: ${report.contract.missing.join(', ') || 'none'}${report.contract.unexpected.length ? `; unexpected: ${report.contract.unexpected.join(', ')}` : ''}`);
  if (report.hardFailures.length) { console.log('  HARD FAILURES:'); for (const f of report.hardFailures.slice(0, 40)) console.log(`    [${f.code}] ${f.message}`); if (report.hardFailures.length > 40) console.log(`    ...(+${report.hardFailures.length - 40} more in the report)`); }
  if (report.warnings.length) { console.log('  warnings:'); for (const w of report.warnings.slice(0, 25)) console.log(`    [${w.code}] ${w.message}`); if (report.warnings.length > 25) console.log(`    ...(+${report.warnings.length - 25} more in the report)`); }
  for (const i of report.info) console.log(`  info: [${i.code}] ${i.message}`);
  console.log(`  wrote ${relRoot(outL5x)}${report.ok ? '' : '  (NOT importable — fix the hard failures)'}`);
  console.log(`  wrote ${relRoot(outRep)}`);
}
process.exit(report.exitCode);
