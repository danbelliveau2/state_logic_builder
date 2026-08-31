/**
 * validator.js — post-generation checks for AI-generated L5X.
 *
 * Pure functions, no API access needed. Reusable from the self-repair loop
 * (client.js), the /api/generate endpoint, and the CLI test harness.
 *
 * Checks:
 *   1. XML well-formedness (fast-xml-parser XMLValidator — real parser,
 *      not regex tag balancing)
 *   2. Every rung-text root identifier resolves against: declared tags
 *      (controller + program scope), AOI names, instruction mnemonics,
 *      context \Program references, or S: system tags
 *   3. MOVE(n, Control.StateReg) targets are within the legal SDC state set
 *   4. L5K string data LEN consistency ([LEN,'text'] pairs)
 *
 * Report shape: { ok: boolean, errors: string[], warnings: string[] }
 */

const { XMLValidator } = require('fast-xml-parser');

// ── Instruction mnemonics (standard Logix RLL) ──────────────────────────────
const MNEMONICS = new Set([
  'XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF',
  'TON', 'TOF', 'RTO', 'RES', 'CTU', 'CTD',
  'MOV', 'MOVE', 'MVM', 'COP', 'CPS', 'FLL', 'CLR', 'SWPB',
  'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'NEG', 'ABS', 'SQR', 'CPT',
  'EQU', 'NEQ', 'GRT', 'GEQ', 'LES', 'LEQ', 'LIM', 'MEQ', 'CMP',
  // Neutral-text forms emitted by Studio 5000 exports
  'EQ', 'NE', 'GT', 'GE', 'LT', 'LE', 'LIMIT',
  'AND', 'OR', 'XOR', 'NOT',
  'JSR', 'RET', 'SBR', 'JMP', 'LBL', 'NOP', 'AFI', 'TND', 'UID', 'UIE',
  'GSV', 'SSV', 'MSG', 'IOT', 'EVENT',
  'BTD', 'DTOS', 'STOD', 'RTOS', 'STOR', 'CONCAT', 'FIND', 'MID', 'DELETE', 'INSERT',
  // Motion
  'MSO', 'MSF', 'MASD', 'MASR', 'MAFR', 'MAS', 'MAH', 'MAJ', 'MAM', 'MAG',
  'MCD', 'MRP', 'MAOC', 'MDOC', 'MGS', 'MGSD', 'MGSR', 'MGSP',
]);

// Instructions whose leading operands are not tag references.
// value = set of argument indices to SKIP root-identifier resolution for.
const SKIP_ARGS = {
  JSR: 'routine-first',       // arg0 is a routine name; rest are param counts/params
  SBR: 'all',
  RET: 'all',
  JMP: 'all',                 // label name
  LBL: 'all',                 // label name
  GSV: new Set([0, 2]),       // ClassName, AttributeName (InstanceName may be a tag)
  SSV: new Set([0, 2]),
  MSG: new Set(),
};

// Motion instructions carry enumerated keyword operands ("Trapezoidal",
// "Units per sec", "Jog", ...) that are not tag references.
const MOTION_INSTRUCTIONS = new Set([
  'MSO', 'MSF', 'MASD', 'MASR', 'MAFR', 'MAS', 'MAH', 'MAJ', 'MAM', 'MAG',
  'MCD', 'MRP', 'MAOC', 'MDOC', 'MGS', 'MGSD', 'MGSR', 'MGSP',
]);
const MOTION_ENUM_WORDS = new Set([
  'Forward', 'Reverse', 'Trapezoidal', 'S-Curve', 'Disabled', 'Enabled',
  'None', 'Jog', 'Yes', 'No', 'All', 'Move', 'Gear', 'Home', 'Tune', 'Test',
  'Absolute', 'Incremental', 'Actual', 'Command', 'Programmed', 'Immediate',
  'Fast', 'Slow', 'Coarse', 'Fine', 'Unidirectional', 'Bidirectional',
  'Rotary', 'Linear', 'DEC',
]);

// ── Compare-mnemonic family (Rule 13) ────────────────────────────────────────
// SDC V4.2 standards (Studio 5000 v37 exports) write compare instructions as
// EQ/NE/LT/GT/GE/LE in rung neutral text. The long spellings are recognized by
// the import but land as DIFFERENT instructions next to the standard's —
// Jason's review, Aug 2026: "EQ came in as EQU, LT came in as LES". Family
// consistency with the template is a hard gate.
const COMPARE_LONG_TO_SHORT = {
  EQU: 'EQ', NEQ: 'NE', LES: 'LT', GRT: 'GT', GEQ: 'GE', LEQ: 'LE',
};
const COMPARE_SHORT_TO_LONG = {
  EQ: 'EQU', NE: 'NEQ', LT: 'LES', GT: 'GRT', GE: 'GEQ', LE: 'LEQ',
};

/** 'short' | 'long' | null — which compare family a document's rungs use.
 *  Used to derive the template's vocabulary; mixed usage returns the
 *  majority family. */
function detectCompareFamily(xml) {
  let short = 0, long = 0;
  for (const m of xml.matchAll(/\b(EQU|NEQ|LES|GRT|GEQ|LEQ|EQ|NE|LT|GT|GE|LE)\(/g)) {
    if (COMPARE_LONG_TO_SHORT[m[1]]) long++;
    else short++;
  }
  if (short === 0 && long === 0) return null;
  return short >= long ? 'short' : 'long';
}

const LEGAL_EXTRA_STATES = new Set([0, 1, 2, 3, 99]);
/** 'ok' = on the SDC grid; 'offgrid' = in sequence range but not on the
 *  4/7/10... grid (the standard's own indexer templates do this — warning);
 *  'illegal' = outside every legal range (hard error). */
function classifyState(n) {
  if (LEGAL_EXTRA_STATES.has(n)) return 'ok';
  if (n >= 100 && n <= 127) return 'ok';                       // init block + cycle-ready
  if (n >= 4 && n <= 97) return (n - 4) % 3 === 0 ? 'ok' : 'offgrid'; // 4, 7, 10 ... 97
  return 'illegal';
}
function isLegalState(n) { return classifyState(n) !== 'illegal'; }

// ── Declaration harvesting (regex over raw XML — attribute-order safe) ──────

function collectAll(re, text, group = 1) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[group]);
  return out;
}

/** Strip AOI definitions so their local rungs/params don't pollute scope. */
function sliceOut(xml, openTag, closeTag) {
  const start = xml.indexOf(openTag);
  if (start === -1) return xml;
  const end = xml.indexOf(closeTag, start);
  if (end === -1) return xml;
  return xml.slice(0, start) + xml.slice(end + closeTag.length);
}

function harvestDeclarations(xml) {
  const aoiNames = new Set(collectAll(
    /<AddOnInstructionDefinition\b[^>]*\bName="([^"]+)"/g, xml));

  // Remove the AOI definitions section before harvesting tags/programs,
  // so AOI-local tags and logic are not treated as globally declared.
  const aoiStart = xml.indexOf('<AddOnInstructionDefinitions');
  const aoiEnd = xml.indexOf('</AddOnInstructionDefinitions>');
  const scopeXml = (aoiStart !== -1 && aoiEnd !== -1)
    ? xml.slice(0, aoiStart) + xml.slice(aoiEnd + '</AddOnInstructionDefinitions>'.length)
    : xml;

  const tags = new Set(collectAll(/<Tag\b[^>]*\bName="([^"]+)"/g, scopeXml));
  const programs = new Set(collectAll(/<Program\b[^>]*\bName="([^"]+)"/g, scopeXml));
  const routines = new Set(collectAll(/<Routine\b[^>]*\bName="([^"]+)"/g, scopeXml));

  // SCOPE-AWARE TAGS (Jason's Import Configuration screenshot, 2026-08-31:
  // p_PartGripped flagged "Undefined" — it was defined in ANOTHER program's
  // scope, which Studio rightly does not see). A rung resolves a bare tag
  // against ITS OWN program's tags + controller scope only — never a sibling
  // program's. ctrlTags = everything declared before <Programs>; programTags
  // = per-program declarations.
  const progsStart = scopeXml.indexOf('<Programs');
  const ctrlSlice = progsStart > 0 ? scopeXml.slice(0, progsStart) : scopeXml;
  const ctrlTags = new Set(collectAll(/<Tag\b[^>]*\bName="([^"]+)"/g, ctrlSlice));
  const programTags = new Map();
  for (const m of scopeXml.matchAll(/<Program\s([^>]*)>([\s\S]*?)<\/Program>/g)) {
    const name = (m[1].match(/\bName="([^"]+)"/) || [])[1];
    if (name) programTags.set(name, new Set(collectAll(/<Tag\b[^>]*\bName="([^"]+)"/g, m[2])));
  }

  return { tags, aoiNames, programs, routines, ctrlTags, programTags };
}

// ── Rung extraction (Programs section only — never AOI logic) ───────────────

function extractRungs(xml) {
  const progStart = xml.indexOf('<Programs');
  const progEnd = xml.lastIndexOf('</Programs>');
  const section = progStart !== -1 && progEnd !== -1
    ? xml.slice(progStart, progEnd)
    : xml;

  const rungs = [];
  // Track program + routine context — multi-program files (one program per
  // machine, Jason 2026-08-31) repeat routine names like R02_StateTransitions
  // per program, and per-program rules must never mix the two.
  const routineRe = /<Program\b[^>]*\bName="([^"]+)"|<Routine\b[^>]*\bName="([^"]+)"|<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g;
  let currentProgram = '(unknown program)';
  let currentRoutine = '(unknown routine)';
  let m;
  while ((m = routineRe.exec(section)) !== null) {
    if (m[1] !== undefined) currentProgram = m[1];
    else if (m[2] !== undefined) currentRoutine = m[2];
    else if (m[3] !== undefined) rungs.push({ program: currentProgram, routine: currentRoutine, text: m[3].trim() });
  }
  return rungs;
}

// ── Rung-text parsing ────────────────────────────────────────────────────────

/** Split an instruction argument list on top-level commas. */
function splitArgs(argText) {
  const args = [];
  let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < argText.length; i++) {
    const c = argText[i];
    if (inStr) {
      cur += c;
      if (c === '$') { cur += argText[++i] || ''; continue; }
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') args.push(cur.trim());
  return args;
}

/** Extract instruction calls NAME(args) from a rung, ignoring branch brackets. */
function extractInstructions(rungText) {
  const calls = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\(/g;
  let m;
  while ((m = re.exec(rungText)) !== null) {
    // find matching close paren
    let depth = 1, i = re.lastIndex, inStr = false;
    while (i < rungText.length && depth > 0) {
      const c = rungText[i];
      if (inStr) { if (c === '$') i++; else if (c === "'") inStr = false; }
      else if (c === "'") inStr = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    calls.push({ name: m[1], args: splitArgs(rungText.slice(re.lastIndex, i - 1)) });
    re.lastIndex = i;
  }
  return calls;
}

/**
 * Extract root identifiers from one operand.
 * Roots = identifiers at path starts: the leading identifier, and any
 * identifier immediately following '[' or an arithmetic operator.
 * Identifiers after '.' are structure members and are not resolved.
 * Returns { roots: [...], programs: [...] } where programs are \Name refs.
 */
function operandRoots(operand) {
  const roots = [], programRefs = [];
  let expectRoot = true;
  const re = /(S:[A-Za-z0-9\/]+)|(\\)?([A-Za-z_][A-Za-z0-9_]*)|(\d[#\w.]*|\.\d+)|([.\[\]()+\-*\/%<>=, ])|('(?:\$.|[^'$])*')/g;
  let m;
  while ((m = re.exec(operand)) !== null) {
    if (m[1] !== undefined) { expectRoot = false; continue; }       // S: system tag
    if (m[6] !== undefined) { expectRoot = false; continue; }       // string literal
    if (m[4] !== undefined) { expectRoot = false; continue; }       // numeric literal
    if (m[5] !== undefined) {
      const c = m[5];
      if (c === '.') expectRoot = false;
      else if (c !== ']' && c !== ')') expectRoot = true;            // '[', ops, space, comma
      continue;
    }
    // identifier
    if (m[2]) { programRefs.push(m[3]); expectRoot = false; continue; }
    if (expectRoot) roots.push(m[3]);
    expectRoot = false;
  }
  return { roots, programRefs };
}

// ── L5K string LEN check ─────────────────────────────────────────────────────

/** Decoded character count of an L5K string body ('$' escapes = 1 char). */
function l5kDecodedInfo(body) {
  let count = 0;
  const chars = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$') {
      const next2 = body.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(next2)) { chars.push(next2.toUpperCase()); i += 2; }
      else { chars.push('ESC' + body[i + 1]); i += 1; }
    } else chars.push(body[i]);
    count++;
  }
  return { count, chars };
}

function checkL5kStrings(xml, errors) {
  // [LEN,'body'] pairs — the L5K serialization of STRING-family values.
  const re = /\[(\d+),'((?:\$.|[^'$])*)'\]/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const len = parseInt(m[1], 10);
    const { count, chars } = l5kDecodedInfo(m[2]);
    if (count === len) continue;
    // Allow zero padding past LEN (exports pad STRING buffers with $00)
    if (count > len && chars.slice(len).every(c => c === '00')) continue;
    errors.push(
      `L5K string LEN mismatch: declared LEN=${len} but content decodes to ` +
      `${count} chars — [${m[1]},'${m[2].length > 60 ? m[2].slice(0, 60) + '…' : m[2]}']`);
  }
}

// ── Studio 5000 import limits (Rule 12) ──────────────────────────────────────
//
// XML validity is NOT importability — Logix Designer rejects the whole import
// on the first over-limit value. Real CE failure (v2.1.0): a ~640-char
// Program Description died at import with "Failed to set the 'Description'
// property (Invalid value. Text may be too long.)". Documented/observed
// limits: descriptions and operand comments 512 chars; names 40 chars,
// [A-Za-z_][A-Za-z0-9_]*, no consecutive or trailing underscores.

const MAX_DESCRIPTION_CHARS = 512;
const MAX_NAME_CHARS = 40;
// Rung comments accept far more than descriptions; exact ceiling is not
// documented — error only at a size that is certainly pathological, warn
// well before it.
const RUNG_COMMENT_ERROR_CHARS = 65000;
const RUNG_COMMENT_WARN_CHARS = 4096;

/** Last Name="..." attribute before position idx — context for messages. */
function nearestNameBefore(xml, idx) {
  const slice = xml.slice(Math.max(0, idx - 4000), idx);
  const names = [...slice.matchAll(/<(?:Program|Routine|Tag|AddOnInstructionDefinition)\b[^>]*\bName="([^"]+)"/g)];
  return names.length ? names[names.length - 1][1] : '(unknown)';
}

function checkImportLimits(xml, errors, warnings) {
  // 1. Descriptions (Program/Routine/Tag/AOI) — 512 max
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Description>/g)) {
    const text = m[1];
    if (text.length > MAX_DESCRIPTION_CHARS) {
      errors.push(`Description too long for Studio 5000 import (${text.length} > ${MAX_DESCRIPTION_CHARS} chars) ` +
        `near "${nearestNameBefore(xml, m.index)}" — import fails with "Text may be too long": "${text.slice(0, 60)}…"`);
    }
  }
  // 2. Operand comments (tag member descriptions) — 512 max
  for (const m of xml.matchAll(/<Comment Operand="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    if (m[2].length > MAX_DESCRIPTION_CHARS) {
      errors.push(`Operand comment "${m[1]}" too long for import (${m[2].length} > ${MAX_DESCRIPTION_CHARS} chars) ` +
        `near "${nearestNameBefore(xml, m.index)}"`);
    }
  }
  // 3. Rung comments — generous but bounded
  for (const m of xml.matchAll(/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    const len = m[1].length;
    if (len > RUNG_COMMENT_ERROR_CHARS) {
      errors.push(`Rung comment is ${len} chars (> ${RUNG_COMMENT_ERROR_CHARS}) near "${nearestNameBefore(xml, m.index)}" — will not import`);
    } else if (len > RUNG_COMMENT_WARN_CHARS) {
      warnings.push(`Rung comment is ${len} chars near "${nearestNameBefore(xml, m.index)}" — unusually long, verify it imports`);
    }
  }
  // 4. Names: length + legal Logix identifier
  for (const m of xml.matchAll(/<(Program|Routine|Tag|AddOnInstructionDefinition)\b[^>]*\bName="([^"]+)"/g)) {
    const [, kind, name] = m;
    if (name.length > MAX_NAME_CHARS) {
      errors.push(`${kind} name "${name}" is ${name.length} chars — Logix names max ${MAX_NAME_CHARS}`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      errors.push(`${kind} name "${name}" is not a legal Logix identifier (letters/digits/underscores, must not start with a digit)`);
    } else if (/__/.test(name) || /_$/.test(name)) {
      errors.push(`${kind} name "${name}" has consecutive or trailing underscores — Logix rejects it`);
    }
  }
}

// ── Exitless-wait check (Rule 11) ────────────────────────────────────────────
//
// A "wait-style" transition is an R02 rung that MOVEs to a new state but is
// conditioned on something beyond the current state + always-available gates
// (SS_OK, DryRun, FaultReset, mode bits). If nothing can force that condition
// (no alarm/fault-timer rung in R20 references the waiting state), the machine
// can hang there silently — the exact defect the Machine Spec rule forbids.

const WAIT_EXEMPT_IDENTS = new Set([
  'SS_OK', 'DryRun', 'Lockout', 'FaultReset', 'Initialized', 'CycleRunning',
  'PartStarted', 'AutoMode', 'ManualMode',
]);

function checkExitlessWaits(rungs, warnings) {
  const r02Rungs = rungs.filter(r => /R02/i.test(r.routine));
  const alarmBlob = rungs.filter(r => /R20|Alarm/i.test(r.routine)).map(r => r.text).join('\n');
  if (r02Rungs.length === 0) return;

  // Conditions that are timer-derived self-complete (sensorless motions
  // confirmed by delay timers): a rung that OTEs the bit gated by a .DN
  // means the wait always resolves — not exitless.
  const timerDerived = new Set();
  for (const r of rungs) {
    if (!/\.DN\)/.test(r.text)) continue;
    for (const m of r.text.matchAll(/OTE\(([A-Za-z_][A-Za-z0-9_]*)\)/g)) timerDerived.add(m[1]);
  }

  const alarmCoveredStates = new Set(
    [...alarmBlob.matchAll(/Status\.State\[(\d+)\]/g)].map(m => parseInt(m[1], 10)));

  for (const rung of r02Rungs) {
    if (!/MOVE?\(\d+,\s*Control\.StateReg\)/.test(rung.text)) continue;

    // Source states this rung waits in (flowchart range only — init/mode
    // states are template law and have their own recovery paths).
    const srcStates = [...rung.text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)]
      .map(m => parseInt(m[1], 10))
      .filter(n => n >= 4 && n <= 97);
    if (srcStates.length === 0) continue;

    // Wait-style = conditioned on identifiers beyond state refs + exempt gates.
    const conditions = [...rung.text.matchAll(/XI[CO]\(([^)]+)\)/g)]
      .map(m => m[1])
      .filter(op => !/^Status\.State\[/.test(op))
      .filter(op => {
        const root = op.split(/[.\[]/)[0];
        return !WAIT_EXEMPT_IDENTS.has(root) && !WAIT_EXEMPT_IDENTS.has(op);
      });
    if (conditions.length === 0) continue; // pure sequencing rung, not a wait

    // Coverage, either idiom the standard uses:
    //  (a) a state-referenced fault-timer alarm rung (Control.FaultTime), or
    //  (b) a condition-mismatch alarm mentioning the waited identifier
    //      (e.g. XIC(q_ExtendXAxis) XIO(XAxisExtended) TON(...) rungs).
    if (srcStates.some(n => alarmCoveredStates.has(n))) continue;
    const uncovered = conditions.filter(op => {
      const root = op.split(/[.\[]/)[0];
      if (timerDerived.has(root)) return false;
      return !alarmBlob.includes(root);
    });
    if (uncovered.length > 0) {
      warnings.push(
        `Exitless wait: transition out of state ${srcStates.join('/')} waits on ` +
        `${uncovered.slice(0, 3).join(', ')}${uncovered.length > 3 ? ', …' : ''} ` +
        `with no fault/timeout path — no R20_Alarms rung references Status.State[${srcStates[0]}] ` +
        'or the waited condition (Rule 11: no exitless waits)');
    }
  }
}

// ── ParameterConnections (Jason's real-controller import, 2026-08-31) ───────
//
// Studio 5000 validates every <ParameterConnection> at import: both endpoints
// must exist and their usage/data types must be compatible. A connection left
// behind after its parameter was deleted (the iq_ZAxis case) cancels the WHOLE
// import. Checks, offline:
//   1. "\Program.param" endpoints: the program exists AND declares that tag.
//   2. Bare endpoints: a controller-scope tag of that name exists.
//   3. The program-side tag is a real PARAMETER (has a Usage attribute).
//   4. Data types match across the connection when both are known
//      (InOut AXIS_CIP_DRIVE ↔ controller AXIS_CIP_DRIVE etc.).

function parseTagDecls(sectionXml) {
  const out = new Map(); // name → { dataType, usage }
  for (const m of sectionXml.matchAll(/<Tag\s+([^>]*)\/?>/g)) {
    const attrs = m[1];
    const name = (attrs.match(/\bName="([^"]+)"/) || [])[1];
    if (!name) continue;
    out.set(name, {
      dataType: (attrs.match(/\bDataType="([^"]+)"/) || [])[1] ?? null,
      usage: (attrs.match(/\bUsage="([^"]+)"/) || [])[1] ?? null,
    });
  }
  return out;
}

function checkParameterConnections(xml, errors) {
  const conns = [...xml.matchAll(/<ParameterConnection\s+EndPoint1="([^"]+)"\s+EndPoint2="([^"]+)"\s*\/>/g)];
  if (!conns.length) return;

  // Controller-scope tags: the first <Tags> section before <Programs>.
  const progsStart = xml.indexOf('<Programs');
  const ctrlSlice = progsStart > 0 ? xml.slice(0, progsStart) : xml;
  const ctrlTagsM = ctrlSlice.match(/<Tags(?:\s[^>]*)?>[\s\S]*?<\/Tags>/);
  const ctrlTags = ctrlTagsM ? parseTagDecls(ctrlTagsM[0]) : new Map();

  // Per-program tag maps (a program's <Tags> is its parameter+local list).
  const progTags = new Map(); // programName → Map(tagName → decl)
  const progRe = /<Program\s([^>]*)>([\s\S]*?)<\/Program>/g;
  for (const m of xml.matchAll(progRe)) {
    const name = (m[1].match(/\bName="([^"]+)"/) || [])[1];
    if (!name) continue;
    const tagsM = m[2].match(/<Tags(?:\s[^>]*)?>[\s\S]*?<\/Tags>/);
    progTags.set(name, tagsM ? parseTagDecls(tagsM[0]) : new Map());
  }

  const resolve = (ep) => {
    if (ep.startsWith('\\')) {
      const dot = ep.indexOf('.');
      const prog = dot > 0 ? ep.slice(1, dot) : ep.slice(1);
      const tag = dot > 0 ? ep.slice(dot + 1).split('.')[0] : null;
      if (!progTags.has(prog)) return { err: `program "${prog}" is not declared in the file` };
      if (!tag) return { err: 'endpoint names a program but no parameter' };
      const decl = progTags.get(prog).get(tag);
      if (!decl) return { err: `program "${prog}" has no tag/parameter "${tag}" — the connection references a deleted or absent parameter` };
      if (!decl.usage) return { err: `"${prog}.${tag}" is a local tag, not a program parameter (no Usage) — Studio rejects the connection` };
      return { decl };
    }
    const root = ep.split('.')[0];
    const decl = ctrlTags.get(root);
    if (!decl) return { err: `controller tag "${root}" is not declared in the file` };
    return { decl };
  };

  for (const [, ep1, ep2] of conns) {
    const a = resolve(ep1);
    const b = resolve(ep2);
    const label = `ParameterConnection "${ep1}" <-> "${ep2}"`;
    if (a.err) errors.push(`${label}: ${a.err} — Studio 5000 cancels the whole import on this`);
    if (b.err) errors.push(`${label}: ${b.err} — Studio 5000 cancels the whole import on this`);
    if (a.decl && b.decl && a.decl.dataType && b.decl.dataType && a.decl.dataType !== b.decl.dataType) {
      errors.push(`${label}: incompatible data types (${a.decl.dataType} vs ${b.decl.dataType}) — Studio rejects the connection`);
    }
  }
}

// ── R02 rung order (Rule 15 — Jason's review, Aug 2026) ─────────────────────
//
// "There are many out of order state transitions": R02's layout is template
// law — sequence-state MOVE rungs in ASCENDING target order (synthesized /
// side-path states sit at their numeric position, like the indexer's 31/34/37
// recovery states), all BEFORE the override block (lockout 99, init 100→124,
// restart, fault 127, manual 1, safety 0), then the State_Engine call. The
// last write to Control.StateReg wins the scan.

function checkR02Order(rungs, errors) {
  // PER PROGRAM: a multi-program file restarts its state sequence in each
  // program — mixing the two R02s produced false "state 4 after state 40"
  // errors (2026-08-31 two-program merge).
  const byProgram = new Map();
  for (const r of rungs.filter(r => /R02/i.test(r.routine))) {
    const k = r.program ?? '(one)';
    if (!byProgram.has(k)) byProgram.set(k, []);
    byProgram.get(k).push(r);
  }
  for (const group of byProgram.values()) checkR02OrderOneProgram(group, errors);
}

function checkR02OrderOneProgram(r02, errors) {
  if (!r02.length) return;

  const seq = [];        // { n, idx } — targets 4..97
  const overrides = [];  // { n, idx } — targets 99, 100-127
  let engineIdx = -1;
  let lastMoveIdx = -1;
  r02.forEach((r, idx) => {
    if (engineIdx === -1 && /State_Engine/i.test(r.text)) engineIdx = idx;
    for (const m of r.text.matchAll(/MOVE?\((\d+),\s*Control\.StateReg\)/g)) {
      const n = parseInt(m[1], 10);
      lastMoveIdx = idx;
      if (n >= 4 && n <= 97) seq.push({ n, idx });
      else if (n === 99 || (n >= 100 && n <= 127)) overrides.push({ n, idx });
    }
  });

  // (1) sequence-state rungs strictly ascending by target
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].n < seq[i - 1].n) {
      errors.push(`R02 rung order: the rung for state ${seq[i].n} appears AFTER the rung for state ${seq[i - 1].n} — ` +
        'sequence-state MOVE rungs must be laid out in ascending target order; splice each rung at its numeric position (Rule 15)');
    }
  }

  // (2) every sequence rung before the override block
  if (seq.length && overrides.length) {
    const firstOverride = Math.min(...overrides.map(o => o.idx));
    for (const s of seq) {
      if (s.idx > firstOverride) {
        errors.push(`R02 rung order: the rung for sequence state ${s.n} appears after the lockout/init override block — ` +
          'all sequence rungs come before the overrides (last write to Control.StateReg wins the scan) (Rule 15)');
      }
    }
  }

  // (3) override block internally ascending (99 → 100 → … → 124 → 127)
  for (let i = 1; i < overrides.length; i++) {
    if (overrides[i].n < overrides[i - 1].n) {
      errors.push(`R02 rung order: override rung for state ${overrides[i].n} appears after the rung for state ${overrides[i - 1].n} — ` +
        'the override block keeps template order: lockout 99, init 100→124 ascending, fault 127 (Rule 15)');
    }
  }

  // (4) State_Engine call after every MOVE(n,Control.StateReg)
  if (engineIdx !== -1 && lastMoveIdx > engineIdx) {
    errors.push('R02 rung order: a MOVE(n,Control.StateReg) rung appears after the State_Engine call — ' +
      'the engine call comes after every state-transition rung (Rule 15)');
  }
}

// ── Flow order (Rule 17 — Jason Perry's review of v5, 2026-08-24) ───────────
//
// "States 52/55/58/61 were added out of order — the sequence must go
// 10 → 13 → 16": numeric RUNG order (Rule 15) is necessary but not
// sufficient. Walking the main flow's transitions, state numbers must be
// strictly ascending: a state synthesized into the middle of the flow takes
// its inline +3 grid position (downstream states shift up), never a high
// appended number the flow jumps out to and back from. Loop-backs (retry,
// next-cycle) and side-path returns go numerically backward as single edges
// and are NOT flagged; the defect signature is the sandwich — the flow runs
// a → X → b with a < b < X.

/** Side-path states of a compiled IR: states with NO main-flow incoming edge
 *  (every entry is a fail/retry branch, recovery, or timeout). Their backward
 *  re-entries into the main flow are legal (the indexer's 31/34/37 shape) and
 *  must not trip the sandwich check below. The main-flow definition mirrors
 *  coordinationAuthor.isMainFlowEdge — kept in sync by the unit test (a
 *  require here would cycle: coordinationAuthor → client → validator). */
function sidePathStatesOf(compiledIr) {
  const out = new Set();
  if (!compiledIr || !Array.isArray(compiledIr.states)) return out;
  const isMain = (t) => {
    if (!t) return false;
    if (!t.kind || t.kind === 'sequence' || t.kind === 'wait') return true;
    if (t.kind === 'branch') return t.branch === 'pass' || t.branch == null;
    return false;
  };
  const mainEntered = new Set();
  for (const t of compiledIr.transitions || []) {
    if (isMain(t)) mainEntered.add(t.toState);
  }
  for (const s of compiledIr.states) {
    if (Number.isInteger(s.stateNumber) && !s.isInitial && !mainEntered.has(s.stateNumber)) {
      out.add(s.stateNumber);
    }
  }
  return out;
}

function checkFlowOrder(rungs, errors, sidePathStates = null) {
  const incoming = new Map(); // state -> Set(fromState)
  const outgoing = new Map(); // state -> Set(toState)
  for (const r of rungs.filter(x => /R02/i.test(x.routine))) {
    const tos = [...r.text.matchAll(/MOVE?\((\d+),\s*Control\.StateReg\)/g)]
      .map(m => parseInt(m[1], 10)).filter(n => n >= 4 && n <= 97);
    if (!tos.length) continue;
    const froms = [...r.text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)]
      .map(m => parseInt(m[1], 10)).filter(n => n >= 4 && n <= 97);
    for (const t of tos) for (const f of froms) {
      if (f === t) continue;
      if (!incoming.has(t)) incoming.set(t, new Set());
      incoming.get(t).add(f);
      if (!outgoing.has(f)) outgoing.set(f, new Set());
      outgoing.get(f).add(t);
    }
  }
  const seen = new Set();
  for (const [x, outs] of outgoing) {
    // A side-path state (recovery/abandon excursion — no main-flow entry in
    // the compiled IR) legally re-enters the main flow backward.
    if (sidePathStates && sidePathStates.has(x)) continue;
    for (const b of outs) {
      if (b >= x) continue;
      for (const a of incoming.get(x) || new Set()) {
        if (a >= b) continue;
        const key = `${a}->${x}->${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        errors.push(`Flow order: the sequence runs ${a} → ${x} → back to ${b} — state ${x} was spliced into the ` +
          'flow out of numeric order. Synthesized/confirm states are renumbered INLINE on the +3 grid with ' +
          'downstream states shifted up, never appended at high numbers the flow jumps out to and back from ' +
          '(Rule 17 — Jason Perry review of v5, 2026-08-24)');
      }
    }
  }
}

// ── Axis naming (Rule 18 — Jason Perry's review of v5, 2026-08-24) ──────────
//
// "Rename HorizontalAxis → XAxis; VerticalAxis → ZAxis": an axis's program
// identity is its single-letter machine direction (XAxis/ZAxis/YAxis/RAxis),
// never the ME's descriptive words. Soft warning — a descriptive name imports
// fine, it just isn't SDC.

const DESCRIPTIVE_AXIS_WORDS =
  /^(Horizontal|Vertical|Rotary|Rotate|Traverse|Lift|Slide|UpDown|InOut|LeftRight|Linear|Lateral|Longitudinal|Elevator|Gantry|Overhead)/i;

function checkAxisNaming(xml, warnings) {
  const names = new Set();
  for (const m of xml.matchAll(/<Routine\b[^>]*\bName="R\d+_([A-Za-z0-9_]+?)Servo"/g)) names.add(m[1]);
  for (const m of xml.matchAll(/\bName="HMI_([A-Za-z0-9_]*?Axis)"/g)) names.add(m[1]);
  for (const n of names) {
    if (DESCRIPTIVE_AXIS_WORDS.test(n)) {
      warnings.push(`Axis naming: "${n}" is a descriptive axis name — SDC axes are named by single-letter machine ` +
        'direction (XAxis, ZAxis, YAxis, RAxis); map the ME\'s description to the letter once and use it in every ' +
        'routine name, HMI tag, parameter, and alarm message (Rule 18 — Jason Perry review of v5, 2026-08-24)');
    }
  }
}

// ── Alarm position references (Rule 19 — Jason Perry's review of v5, 2026-08-24)
//
// "Remove references to X home position" / "alarm 9 not needed": the alarm
// list is derived from the positions that exist. Every R20 "Waiting … To
// Reach {Position}" alarm must name a position declared in that axis's
// position table; an alarm about a nonexistent position (v5's X "Home" —
// horizontal PNP axes have no home) can never be the operator's truth.
// IR-based: runs from the cross-checks, where the device tables are known.

function checkAlarmPositionRefs(devices, rungs, errors) {
  const axes = (devices || []).filter(d => /servo/i.test(d.type || ''));
  if (!axes.length) return;
  const variants = deviceVariants(axes);
  const posOf = new Map(); // deviceId -> Set(normalized declared position names)
  for (const d of axes) {
    const list = Array.isArray(d.extras?.positions) ? d.extras.positions : [];
    if (!list.length) continue; // no declared table — nothing to judge against
    posOf.set(d.id, new Set(list.map(p => normIdent(p && p.name)).filter(Boolean)));
  }
  if (!posOf.size) return;
  const nameOf = id => axes.find(d => d.id === id)?.name || id;
  for (const r of rungs.filter(x => /R20/i.test(x.routine))) {
    const m = String(r.comment || '').match(/Waiting For (.+?) To Reach (?:The )?(.+?) (?:Position|Point)/i);
    if (!m) continue;
    const axisWords = normIdent(m[1]);
    let dev = null, bestLen = 0;
    for (const [id, set] of variants) {
      for (const v of set) if (axisWords.includes(v) && v.length > bestLen) { dev = id; bestLen = v.length; }
    }
    if (!dev || !posOf.has(dev)) continue;
    const posName = normIdent(m[2]);
    const declared = posOf.get(dev);
    const known = [...declared].some(p => p === posName || p.includes(posName) || posName.includes(p));
    if (!known) {
      errors.push(`Alarm position reference: R20 alarm "${String(r.comment || '').split('\n')[0].trim()}" names ` +
        `position "${m[2].trim()}" which is not in the declared position table for ${nameOf(dev)} — the alarm ` +
        'list is derived from the positions that exist; an alarm on a nonexistent position is removed, not kept ' +
        '(Rule 19 — Jason Perry review of v5, 2026-08-24; horizontal PNP axes have no home)');
    }
  }
}

// ── Motion trigger shape (Rule 16 — Jason's review, Aug 2026) ───────────────
//
// "The motion triggers have been reformatted": the template shape is ONE auto
// MAM per axis routine, in the single "Axis Motion Command" rung — manual
// branch (Status.State[1] + {Axis}ManMoveTrig) OR'd with a plain
// XIC(Status.State[n]) list, gated by ServoActionStatus + AxisHomedStatus +
// {Axis}Permissive. Invented shapes (per-state ONS trigger rungs, OTL/OTU
// move-trigger latches, sub-step counters) are errors. Because MAM only
// executes on rung false→true and state bits swap atomically, two states
// that are CONSECUTIVE in R02 and both in one axis's MAM list mean the
// second move never executes — distinct back-to-back moves need the template
// family's trigger/wait split (the indexer's Trigger Index → Wait For Index
// Complete shape), and fast/slow segments of ONE stroke are ONE MAM to the
// final target plus an MCD speed change keyed on segment states NOT in the
// MAM list (Jason's correction of b_mt7qbdtl_7i0izo, 2026-08-25).

function checkMotionTriggerShape(rungs, errors) {
  const seen = new Set();
  const emit = msg => { if (!seen.has(msg)) { seen.add(msg); errors.push(msg); } };

  // Flow adjacency (fromState -> toState) from R02 sequence rungs.
  const flowEdges = [];
  for (const r of rungs.filter(x => /R02/i.test(x.routine))) {
    const tos = [...r.text.matchAll(/MOVE?\((\d+),\s*Control\.StateReg\)/g)]
      .map(m => parseInt(m[1], 10)).filter(n => n >= 4 && n <= 97);
    if (!tos.length) continue;
    const froms = [...r.text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)]
      .map(m => parseInt(m[1], 10)).filter(n => n >= 4 && n <= 97);
    for (const t of tos) for (const f of froms) if (f !== t) flowEdges.push([f, t]);
  }

  const byRoutine = new Map();
  for (const r of rungs) {
    if (!byRoutine.has(r.routine)) byRoutine.set(r.routine, []);
    byRoutine.get(r.routine).push(r);
  }

  for (const [routine, rs] of byRoutine) {
    const mamRungs = [];
    for (const r of rs) {
      const calls = extractInstructions(r.text).filter(c => c.name === 'MAM');
      const main = calls.filter(c => !/inch/i.test(c.args[1] || ''));
      if (main.length) mamRungs.push(r);
    }
    if (!mamRungs.length) continue; // not a servo routine

    if (mamRungs.length > 1) {
      emit(`Motion trigger shape: ${routine} has ${mamRungs.length} main MAM rungs — the template has exactly ` +
        'ONE "Axis Motion Command" rung per axis (Rule 16)');
    }

    for (const r of mamRungs) {
      for (const m of r.text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*MoveTrig)\b/g)) {
        if (!/ManMoveTrig$/.test(m[1])) {
          emit(`Motion trigger shape: the MAM rung in ${routine} is gated by invented trigger latch "${m[1]}" — ` +
            'the auto branch is a plain XIC(Status.State[n]) list, never a latch bit (Rule 16)');
        }
      }
      for (const gate of ['ServoActionStatus', 'AxisHomedStatus', 'Permissive']) {
        if (!r.text.includes(gate)) {
          emit(`Motion trigger shape: the MAM rung in ${routine} is missing the standard ${gate} gating (Rule 16)`);
        }
      }
      const autoStates = [...r.text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)]
        .map(m => parseInt(m[1], 10)).filter(n => n !== 1);
      if (!autoStates.length) {
        emit(`Motion trigger shape: the MAM rung in ${routine} has no XIC(Status.State[n]) auto state list — ` +
          'the template gates the auto branch on the OR of every state in which the axis moves (Rule 16)');
      }
      const listed = new Set(autoStates);
      for (const [f, t] of flowEdges) {
        if (listed.has(f) && listed.has(t)) {
          emit(`Motion trigger shape: states ${f} and ${t} are consecutive in R02 and BOTH in the ${routine} MAM ` +
            'state list — the MAM rung never goes false between them, so the second move NEVER EXECUTES; distinct ' +
            "moves use the trigger/wait split (move state → wait/confirm state not in the list → next move state), " +
            'and speed segments of one stroke are ONE MAM + the MCD rung (segment states NOT in the MAM list) (Rule 16)');
        }
      }
    }

    for (const r of rs) {
      for (const m of r.text.matchAll(/OT[ELU]\(([A-Za-z_][A-Za-z0-9_]*MoveTrig)\)/g)) {
        if (!/ManMoveTrig$/.test(m[1])) {
          emit(`Motion trigger shape: ${routine} drives invented move trigger "${m[1]}" — per-state trigger ` +
            'latch rungs are a forbidden shape (Rule 16)');
        }
      }
      if (/\b[A-Za-z_][A-Za-z0-9_]*MoveStep\b/.test(r.text)) {
        emit(`Motion trigger shape: ${routine} uses a same-state sub-step counter (…MoveStep) — forbidden shape; ` +
          'split segments into real states (Rule 16)');
      }
    }
  }
}

// ── One move per state (compiled-IR level — Dan, Aug 2026) ──────────────────
//
// The incident: Jarvis compiled states carrying TWO ServoMove actions on one
// axis. The template's own structure (auto-derived — templatePatterns.js
// ONE_MOVE_PER_STATE / ONE_MAM_PER_AXIS) makes that impossible to execute:
// each axis has ONE auto MAM that edge-fires once per state, and the staging
// rung maps each state to exactly one Positions[i]. This check runs at the
// IR/edit-plan level so the defect dies at compile review, before any code.

const SERVO_MOVE_OPS = /^servo(move|incr|index)$/i;
// Detail text implying the second axis waits for the first to COMPLETE inside
// the same state (that is sequencing, which the template expresses as a
// transition — not overlap, which it expresses via permissive gating).
const AFTER_COMPLETE_HINT = /(after|then|once|when)[^.;|]*\b(complete|finish|\.PC\b|reaches|at position|in ?pos)/i;

/**
 * Check a compiled IR (or any {states:[{stateNumber,label,actions}]} shape)
 * for multi-move states. Pure function — used by validateAgainstCompiledIR,
 * coordinationAuthor's compile validation, and tests.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function checkOneMovePerState(ir) {
  const errors = [];
  const warnings = [];
  const states = (ir && Array.isArray(ir.states)) ? ir.states : [];

  // Template citation (auto-derived inventory) — best effort, never fatal.
  let citation = '';
  try {
    const { getTemplatePatterns } = require('./templatePatterns');
    const inv = getTemplatePatterns().patterns.invariants
      .find(i => i.id === 'ONE_MOVE_PER_STATE' && i.holds);
    if (inv) citation = ' [template pattern ONE_MOVE_PER_STATE: ' + inv.statement + ']';
  } catch (_) { /* inventory unavailable — message still stands */ }

  for (const s of states) {
    const moves = (s.actions || []).filter(a => SERVO_MOVE_OPS.test(String(a.operation || '')));
    if (moves.length < 2) continue;

    // (1) two+ moves on the SAME axis in one state — structurally impossible:
    // the axis's single MAM rung cannot edge-fire twice within one state.
    const byDevice = new Map();
    for (const m of moves) {
      const key = m.deviceId || m.deviceName || m.device || '(unknown axis)';
      if (!byDevice.has(key)) byDevice.set(key, []);
      byDevice.get(key).push(m);
    }
    for (const [, list] of byDevice) {
      if (list.length > 1) {
        const dev = list[0].deviceName || list[0].device || 'one axis';
        const positions = list.map(m => (m.params && m.params.positionName) || '?').join(' then ');
        errors.push(`One-move-per-state: state ${s.stateNumber} ("${s.label}") has ${list.length} ServoMove actions on ${dev} (${positions}) — ` +
          'an axis\'s single MAM rung edge-fires ONCE per state, so the second move never executes. ' +
          'A multi-speed stroke is ONE ServoMove state to the FINAL target (advance:\'inflight\') plus synthesized ' +
          'wait and ServoSpeedChange (MCD) segment states — never a second ServoMove (Jason 2026-08-25); ' +
          'genuinely distinct back-to-back moves use the trigger/wait split.' + citation);
      }
    }

    // (2) moves on DIFFERENT axes in one state: legitimate ONLY as
    // permissive-gated overlap (the wideband corner). A chained
    // "after the first completes" sequence inside one state is the same
    // defect — the template expresses sequencing via transitions.
    if (byDevice.size > 1) {
      const chained = moves.some(m => AFTER_COMPLETE_HINT.test(String(m.detail || '')));
      const devs = [...byDevice.keys()].map(k => {
        const m = byDevice.get(k)[0];
        return m.deviceName || m.device || String(k);
      }).join(' + ');
      if (chained) {
        errors.push(`One-move-per-state: state ${s.stateNumber} ("${s.label}") chains moves on different axes (${devs}) with an after-complete dependency inside ONE state — ` +
          'the template expresses cross-axis sequencing as a TRANSITION between states (strict MAM.PC+InPos, or the wideband OR for blended corners), never inside one state.' + citation);
      } else {
        warnings.push(`One-move-per-state: state ${s.stateNumber} ("${s.label}") commands ${byDevice.size} axes (${devs}) in one state — ` +
          'acceptable ONLY as permissive-gated overlap (the wideband corner, where the second axis edge-fires when the first enters its clearance band). ' +
          'If the intent is "move A, then move B", that is two states.');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Main entry points ────────────────────────────────────────────────────────

/**
 * Validate an L5X document string.
 * @param {string} xml
 * @param {object} [opts]
 * @param {'short'|'long'|null} [opts.compareFamily] compare-mnemonic family the
 *   template uses ('short' = EQ/NE/LT/GT/GE/LE — the SDC V4.2 standard and the
 *   default; pass detectCompareFamily(templateXml) to derive; null disables).
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateL5X(xml, opts = {}) {
  const compareFamily = 'compareFamily' in opts ? opts.compareFamily : 'short';
  const errors = [];
  const warnings = [];

  if (typeof xml !== 'string' || xml.trim() === '') {
    return { ok: false, errors: ['Empty document'], warnings };
  }

  // 1. XML well-formedness
  const wf = XMLValidator.validate(xml);
  if (wf !== true) {
    errors.push(`XML not well-formed: ${wf.err.msg} (line ${wf.err.line}, col ${wf.err.col})`);
    return { ok: false, errors, warnings }; // structural checks are meaningless past this
  }

  if (!/<RSLogix5000Content\b/.test(xml)) {
    errors.push('Not an L5X document: missing <RSLogix5000Content> root');
    return { ok: false, errors, warnings };
  }

  // 2. Declarations
  const decl = harvestDeclarations(xml);

  // 3. Rung-by-rung resolution
  const rungs = extractRungs(xml);
  if (rungs.length === 0) warnings.push('No rung logic found in Programs section');

  const unresolved = new Map();   // identifier -> first location
  const badPrograms = new Map();  // \Program  -> first location
  const seenStateMoves = [];

  for (const rung of rungs) {
    for (const call of extractInstructions(rung.text)) {
      const isAoi = decl.aoiNames.has(call.name);
      if (!MNEMONICS.has(call.name) && !isAoi) {
        errors.push(`Unknown instruction "${call.name}" in ${rung.routine} — not a Logix mnemonic or declared AOI`);
        continue;
      }

      // Rule 13: compare-mnemonic family must match the template's usage.
      if (!isAoi && compareFamily === 'short' && COMPARE_LONG_TO_SHORT[call.name]) {
        errors.push(`Compare mnemonic "${call.name}" in ${rung.routine} — the SDC standard template uses the ` +
          `short family; write ${COMPARE_LONG_TO_SHORT[call.name]}(...) instead of ${call.name}(...) ` +
          '(mixed families import as different instructions — Rule 13)');
      } else if (!isAoi && compareFamily === 'long' && COMPARE_SHORT_TO_LONG[call.name]) {
        errors.push(`Compare mnemonic "${call.name}" in ${rung.routine} — this template uses the long family; ` +
          `write ${COMPARE_SHORT_TO_LONG[call.name]}(...) instead of ${call.name}(...) (Rule 13)`);
      }

      const skip = SKIP_ARGS[call.name];
      call.args.forEach((arg, idx) => {
        if (arg === '' || arg === '?' || arg === '??') return;
        if (skip === 'all') return;
        if (skip === 'routine-first') {
          if (idx === 0) {
            if (!decl.routines.has(arg)) {
              errors.push(`JSR target routine "${arg}" is not declared (in ${rung.routine})`);
            }
            return;
          }
          if (/^\d/.test(arg)) return;
        }
        if (skip instanceof Set && skip.has(idx)) return;
        // Motion instruction enum operands are keywords, not tags
        if (MOTION_INSTRUCTIONS.has(call.name) && idx >= 2 &&
            (arg.includes(' ') || MOTION_ENUM_WORDS.has(arg))) return;

        const { roots, programRefs } = operandRoots(arg);
        for (const p of programRefs) {
          if (!decl.programs.has(p) && !badPrograms.has('\\' + p)) {
            badPrograms.set('\\' + p, `${rung.routine}: ${call.name}(...${arg}...)`);
          }
        }
        for (const r of roots) {
          if (decl.aoiNames.has(r) || decl.routines.has(r)) continue;
          // Scope-aware (Studio's "Undefined" import flag): a bare tag must
          // exist in THIS program's scope or controller scope — a sibling
          // program's tag does not count.
          const progSet = decl.programTags.get(rung.program);
          if (decl.ctrlTags.has(r) || (progSet ? progSet.has(r) : decl.tags.has(r))) continue;
          if (!unresolved.has(r)) {
            unresolved.set(r, `${rung.routine}: ${call.name}(${arg})`
              + (decl.tags.has(r) ? ` — defined only in another program's scope (Studio imports it as Undefined)` : ''));
          }
        }
      });

      // 4. Legal-state check on MOVE/MOV into Control.StateReg
      if ((call.name === 'MOVE' || call.name === 'MOV') && call.args.length >= 2) {
        const dest = call.args[1];
        if (/(^|\.)Control\.StateReg$/.test(dest) || dest === 'Control.StateReg') {
          const src = call.args[0];
          if (/^-?\d+$/.test(src)) {
            const n = parseInt(src, 10);
            seenStateMoves.push(n);
            const cls = classifyState(n);
            if (cls === 'illegal') {
              errors.push(
                `Illegal state number ${n} in ${rung.routine}: MOVE(${n},${dest}) — ` +
                'legal states are 0-3, 4/7/10...97, 99, 100-127');
            } else if (cls === 'offgrid') {
              warnings.push(
                `State ${n} in ${rung.routine} is off the 4/7/10... grid (MOVE(${n},${dest}))`);
            }
          }
        }
      }
    }
  }

  for (const [prog, loc] of badPrograms) {
    errors.push(`Program reference ${prog} does not resolve — no <Program Name="${prog.slice(1)}"> declared (first seen in ${loc})`);
  }
  for (const [id, loc] of unresolved) {
    errors.push(`Undeclared identifier "${id}" — not a declared tag, AOI, or routine (first seen in ${loc})`);
  }

  // 4b. PARAMETER CONNECTIONS (Jason's THIRD real-import failure, 2026-08-31:
  //     "Unable to import parameterconnection \S01_MidBasePickAndPlace.iq_ZAxis
  //     <-> a04_S01PNPZAxis — Tag or parameter usage types are incompatible."
  //     The phantom-Z purge deleted the iq_ZAxis parameter but the
  //     <ParameterConnection> element survived — a dangling connection our
  //     import sim never looked at. Every connection's BOTH ends must resolve
  //     to an existing program parameter / controller tag with compatible
  //     types; Studio rejects the whole import otherwise.)
  checkParameterConnections(xml, errors);

  // 5. L5K string LEN consistency
  checkL5kStrings(xml, errors);

  // 5a. IMPORT SIMULATION — MANDATORY gate (second Jason import failure,
  //     Aug 2026: AlarmList STRING[10] L5K blob lost its outer closing
  //     bracket — well-formed XML, correct LENs, dead on import with "Data
  //     type mismatch"). Structurally parses every tag's L5K literal against
  //     DataType/Dimensions, cross-checks Decorated element-by-element, and
  //     enforces ASCII in rung/tag-data CDATA. A file that fails this never
  //     leaves the pipeline.
  {
    const sim = require('./importSimValidator').simulateImport(xml);
    errors.push(...sim.errors);
    warnings.push(...sim.warnings);
  }

  // 5b. Studio 5000 import limits (Rule 12): description/comment lengths,
  //     name lengths, identifier legality — hard import gates.
  checkImportLimits(xml, errors, warnings);

  // 6. No exitless waits (Rule 11): every wait-style R02 transition — one
  //    that holds a flowchart state until an external condition comes true —
  //    must be forceable by a fault/timeout path. Heuristic: the waiting
  //    state must be referenced by some R20_Alarms rung (Control.FaultTime /
  //    ProgramAlarmHandler coverage). Warning, not error — the heuristic
  //    can't see cross-program recovery paths.
  checkExitlessWaits(rungs, warnings);

  // 7. R02 rung order is template law (Rule 15): sequence rungs ascending,
  //    before the override block; State_Engine call after every state MOVE.
  checkR02Order(rungs, errors);

  // 7b. Flow order (Rule 17 — Jason Perry review of v5, 2026-08-24): walking
  //     the main flow's transitions, state numbers strictly ascend; a spliced
  //     out-of-order confirm state (a → X → b with a < b < X) is an error.
  checkFlowOrder(rungs, errors, opts.compiledIr ? sidePathStatesOf(opts.compiledIr) : null);

  // 7c. Axis naming (Rule 18 — soft): descriptive axis names (HorizontalAxis)
  //     warn toward the single-letter convention (XAxis/ZAxis).
  checkAxisNaming(xml, warnings);

  // 7d. NO UNUSED DEVICES (Jason's correction of MidBaseLoad v1.4.0,
  //     2026-08-31): the emitted device set equals the sheet's device set —
  //     template baggage (the S05 Z servo) never ships. Hard errors:
  //     (a) any comment/text marking something unused or telling a future
  //         reader to delete it, (b) a servo routine / axis InOut / HMI axis
  //         structure for a device that is not on the sheet.
  if (Array.isArray(opts.deviceNames) && opts.deviceNames.length) {
    const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sheet = opts.deviceNames.map(nk).filter(Boolean);
    const onSheet = (name) => { const k = nk(name); return !!k && sheet.some((s) => s === k || s.includes(k) || k.includes(s)); };
    for (const m of xml.matchAll(/<Routine[^>]*Name="R\d+_([A-Za-z0-9]+?)Servo"/g)) {
      if (!onSheet(m[1]) && !onSheet(m[1] + 'axis')) {
        errors.push(`Unused device emitted: routine R##_${m[1]}Servo exists but "${m[1]}" is not on the sheet's device list — delete the routine, its JSR, and every ${m[1]} tag/UDT (no unused devices, ever — Jason 2026-08-31).`);
      }
    }
    const STD = new Set(['toggle', 'momentary']);
    for (const m of xml.matchAll(/<Tag[^>]*Name="(?:iq_|HMI_)([A-Za-z0-9]+)"[^>]*(?:DataType="(?:AXIS_CIP_DRIVE|ServoOverall)"|Usage="InOut")/g)) {
      const bare = m[1].toLowerCase();
      if (STD.has(bare)) continue;
      if (!onSheet(m[1]) && !onSheet(m[1] + 'axis') && !onSheet(m[1].replace(/axis$/i, ''))) {
        errors.push(`Unused device emitted: axis tag for "${m[1]}" (iq_/HMI_) but no such device on the sheet — remove it entirely (no unused devices, ever — Jason 2026-08-31).`);
      }
    }
    for (const m of xml.matchAll(/Comment[^>]*>(?:<!\[CDATA\[)?([^<\]]{0,300})/g)) {
      if (/\bunused\b|\bdelete (the|this) routine\b|delete .* at (machine )?integration/i.test(m[1] ?? '')) {
        errors.push(`"Unused/delete-me" content shipped in a comment ("${String(m[1]).trim().slice(0, 80)}…") — anything unused is DELETED before emission, never annotated (Jason 2026-08-31).`);
      }
    }

    // TAG-LEVEL DEVICE AUDIT (Jason's Import Configuration screenshot,
    // 2026-08-31: q_ExtendZAxis shipped for the DELETED Z axis, and
    // q_ExtendXAxis shipped for a SERVO — template leftovers from a template
    // family whose cylinders happened to be named XAxis/ZAxis). Every
    // directional q_ output must map to a sheet device of a pneumatic
    // family; a q_ tag for a non-device or a servo is a phantom. Types ride
    // in opts.devices when the caller has them.
    {
      const typed = Array.isArray(opts.devices)
        ? opts.devices.map((d) => ({ k: nk(d.name), type: String(d.type ?? '') }))
        : null;
      const typeOf = (base) => {
        if (!typed) return null;
        const k = nk(base);
        const hit = typed.find((d) => d.k === k || d.k.includes(k) || k.includes(d.k));
        return hit ? hit.type : null;
      };
      const seenQ = new Set();
      for (const m of xml.matchAll(/<Tag[^>]*\bName="q_(Extend|Retract|Engage|Disengage|Close|Open)([A-Za-z0-9_]+)"/g)) {
        const key = m[1] + m[2];
        if (seenQ.has(key)) continue;
        seenQ.add(key);
        const base = m[2];
        if (!onSheet(base)) {
          errors.push(`Phantom output tag q_${m[1]}${base}: "${base}" is not on the sheet's device list — delete it and every other artifact of the device that owned it (no unused devices, ever — Jason 2026-08-31).`);
          continue;
        }
        const t = typeOf(base);
        if (t && /servo|axis_cip/i.test(t)) {
          errors.push(`Wrong tag family: q_${m[1]}${base} is a pneumatic-style directional output but "${base}" is a ${t} — servos are commanded through motion instructions, never q_ outputs (Jason 2026-08-31).`);
        }
      }
    }
  }

  // 8. Motion trigger shape is template law (Rule 16): one MAM per axis,
  //    state-list gating, no invented trigger latches, no consecutive
  //    same-axis move states.
  checkMotionTriggerShape(rungs, errors);

  if (seenStateMoves.length === 0 && rungs.length > 0) {
    warnings.push('No MOVE(n, Control.StateReg) state transitions found');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Diagram cross-validation ─────────────────────────────────────────────────
//
// validateAgainstDiagram(projectJson, smId, l5x) cross-checks the generated
// program against the flowchart it was compiled from:
//   (a) every diagram state has its MOVE(n,Control.StateReg) transition in
//       R02, and every diagram action's device is evidenced in some rung
//       referencing that state number;
//   (b) no motion/output command references a flowchart state whose diagram
//       node has NO action for that device (the "Z axis commanded in the
//       gripper-close state" defect class).
// State numbers come from the same DFS as the IR/prompt (ir.js), so the
// check and the generation always agree on numbering.

const { buildIR } = require('./ir');

function normIdent(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Split "PNPZAxis" / "Vertical_Shuttle" into lowercase words. */
function splitWords(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

/** Name variants for a device: every word-suffix (>=4 chars) of name and
 *  displayName. Variants shared by two devices are dropped (ambiguous). */
function deviceVariants(devices) {
  const raw = new Map(); // deviceId -> Set(variants)
  for (const d of devices) {
    const set = new Set();
    for (const source of [d.name, d.displayName]) {
      const words = splitWords(source);
      for (let k = 0; k < words.length; k++) {
        const v = words.slice(k).join('');
        if (k === 0 || v.length >= 4) set.add(v);
      }
      // Word-prefix variants too: code tags keep the leading words and swap
      // the trailing noun (PartPresentSensor -> i_PartPresent /
      // PartPresentDebounce).
      for (let k = 1; k < words.length; k++) {
        const v = words.slice(0, k).join('');
        if (v.length >= 4) set.add(v);
      }
    }
    // Machine-direction axis-letter aliases (Jason's v5 naming rule): axis
    // names in code are single-letter machine directions (XAxis/ZAxis/RAxis)
    // even when the ME's device name says Horizontal/Vertical/Rotary — the
    // IR name will NEVER appear in the rungs for a correctly named axis.
    const nameBlob = normIdent(`${d.name || ''} ${d.displayName || ''}`);
    if (/horizontal|traverse/.test(nameBlob)) set.add(normIdent('XAxis'));
    if (/vertical/.test(nameBlob)) set.add(normIdent('ZAxis'));
    if (/rotary|rotational/.test(nameBlob)) set.add(normIdent('RAxis'));
    raw.set(d.id, set);
  }
  // drop ambiguous variants
  const owners = new Map();
  for (const [id, set] of raw) for (const v of set) owners.set(v, (owners.get(v) || 0) + 1);
  for (const [, set] of raw) for (const v of [...set]) {
    if (owners.get(v) > 1) set.delete(v);
  }
  return raw;
}

function rungMentionsDevice(rungBlob, variants) {
  for (const v of variants) if (rungBlob.includes(v)) return true;
  return false;
}

/** Target-program slice of an L5X document. */
function targetProgramXml(xml) {
  const m = /<Program Use="Target"[^>]*>/.exec(xml);
  if (!m) return null;
  const end = xml.indexOf('</Program>', m.index);
  return end === -1 ? null : xml.slice(m.index, end);
}

/** Rungs with routine + comment (target program only). */
function extractRungsWithComments(programXml) {
  const rungs = [];
  const re = /<Routine\b[^>]*\bName="([^"]+)"|<Rung\b[^>]*>([\s\S]*?)<\/Rung>/g;
  let routine = '(unknown)';
  let m;
  while ((m = re.exec(programXml)) !== null) {
    if (m[1] !== undefined) { routine = m[1]; continue; }
    const body = m[2];
    const cm = /<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/.exec(body);
    const tm = /<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/.exec(body);
    rungs.push({ routine, comment: cm ? cm[1] : '', text: tm ? tm[1] : '' });
  }
  return rungs;
}

const CONDITION_OPS = /^(wait|decide|waitinput|waitrefpos|waitsmoutput|verify|check)$/i;

// ── State-label comment consistency (Jason's-review fix) ────────────────────
//
// Comments are DOCUMENTATION, not logic — but wrong comments caused a real
// red-cross review (V42: reviewer read the new logic under the legacy state
// map). Every Status .STATE[n] tag comment and every R02 "State n: ..." rung
// comment must be consistent with the IR's label/actions for state n.
// Fuzzy: at least one significant word (>=4 chars) from the state's label or
// its actions' device/operation names must appear in the comment.

// Placeholder label words that carry no meaning ("Step 5", "State 19").
const GENERIC_LABEL_WORDS = new Set(['step', 'state']);

/** Significant expected words for one IR state (label + action device/op). */
function stateExpectedWords(s) {
  const words = new Set();
  for (const w of splitWords(s.label)) if (w.length >= 4 && !GENERIC_LABEL_WORDS.has(w)) words.add(w);
  for (const a of s.actions || []) {
    for (const w of splitWords(a.deviceName)) if (w.length >= 4) words.add(w);
    for (const w of splitWords(a.operation)) if (w.length >= 4) words.add(w);
  }
  // Convention words for special states — a terminal state commented
  // "Cycle Complete" (or an initial "Home / Wait For Start") is correct even
  // when the diagram node label is a generic placeholder.
  if (s.isComplete) { words.add('complete'); words.add('cycle'); words.add('done'); words.add('finished'); }
  if (s.isInitial) { words.add('home'); words.add('initial'); words.add('start'); words.add('wait'); }
  return words;
}

function commentMatchesState(comment, expectedWords) {
  if (expectedWords.size === 0) return true; // nothing to judge against
  const norm = normIdent(comment);
  for (const w of expectedWords) if (norm.includes(w)) return true;
  return false;
}

/**
 * Check Status.STATE[] tag comments and R02 rung comments against the IR's
 * state labels. Label mismatch on a state the IR has = ERROR; a grid-state
 * comment for a state the IR doesn't have = warning (stale template leftover).
 */
function checkStateComments(gridStates, progXml, rungs, errors, warnings, contract) {
  const stateByNumber = new Map(gridStates.map(s => [s.stateNumber, s]));
  const found = []; // { n, comment, where }

  // (i) Status tag .STATE[n] operand comments (target program slice)
  const tagRe = /<Comment Operand="\.STATE\[(\d+)\]">\s*<!\[CDATA\[([\s\S]*?)\]\]>/gi;
  let m;
  while ((m = tagRe.exec(progXml)) !== null) {
    found.push({ n: parseInt(m[1], 10), comment: m[2].trim(), where: `Status tag comment .STATE[${m[1]}]` });
  }

  // (ii) R02 rung comments "State n: ..." (the injected STATE MAP line uses
  //      "n=label" and never matches this pattern)
  for (const r of rungs) {
    if (!/R02/i.test(r.routine) || !r.comment) continue;
    for (const cm of r.comment.matchAll(/\bState\s+(\d+)\s*:\s*([^\r\n|]+)/gi)) {
      found.push({ n: parseInt(cm[1], 10), comment: cm[2].trim(), where: `R02 rung comment "State ${cm[1]}: ${cm[2].trim().slice(0, 60)}"` });
    }
  }

  for (const f of found) {
    if (!onSequenceGrid(f.n)) continue; // init/mode/fault comments are template law
    const s = stateByNumber.get(f.n);
    if (!s) {
      warnings.push(`${f.where} describes state ${f.n}, but the ${contract} has no state ${f.n} — stale template comment, remove or retarget it`);
      continue;
    }
    if (!commentMatchesState(f.comment, stateExpectedWords(s))) {
      errors.push(`${f.where} says "${f.comment.slice(0, 80)}" but ${contract} state ${f.n} is "${s.label}" — ` +
        'comment/label mismatch (comments must be generated from the state map, never copied from reference files)');
    }
  }
}

// ── Motion intent coverage (Rule 14 — Jason's review, Aug 2026) ─────────────
//
// "I do not see any logic for speed changes" / "the blending does not appear
// to be coded correctly": when the intent (IR states/spec) describes multiple
// speeds for an axis, the generated logic must stage more than one AutoSpeed
// index for it; when the intent describes blending, R02 must use the wideband
// InPosWide pattern.

/** Does this action look like a servo motion? */
const MOTION_OPS = /servomove|servoincr|servoindex|move/i;

function checkMotionIntent(devices, states, machineSpec, rungs, errors, warnings, contract) {
  const variants = deviceVariants(devices);
  const deviceForIdent = ident => {
    const n = normIdent(ident);
    let best = null, bestLen = 0;
    for (const [id, set] of variants) {
      for (const v of set) {
        if (n.includes(v) && v.length > bestLen) { best = id; bestLen = v.length; }
      }
    }
    return best;
  };

  // Generated evidence: distinct AutoSpeed indices staged per device. The
  // HMI_{Name} tag may keep the template's axis name (HMI_ZAxis) while the
  // rest of the rung uses the device's name (VerticalAxisMotionParameters) —
  // so attribute indices by ANY device mention in the rung, HMI ident first.
  const stagedSpeeds = new Map(); // deviceId -> Set(index)
  const attribute = (devId, idx) => {
    if (!devId) return;
    if (!stagedSpeeds.has(devId)) stagedSpeeds.set(devId, new Set());
    stagedSpeeds.get(devId).add(idx);
  };
  for (const r of rungs) {
    const matches = [...r.text.matchAll(/HMI_([A-Za-z0-9_]+)\.Parameters\.AutoSpeed\[(\d+)\]/g)];
    if (!matches.length) continue;
    const rungBlob = normIdent(r.text);
    const rungDevices = [...variants.entries()]
      .filter(([, set]) => rungMentionsDevice(rungBlob, set))
      .map(([id]) => id);
    for (const m of matches) {
      const idx = parseInt(m[2], 10);
      const byIdent = deviceForIdent(m[1]);
      if (byIdent) attribute(byIdent, idx);
      else for (const id of rungDevices) attribute(id, idx);
    }
  }

  let anyWideband = false;
  for (const d of devices) {
    if (!/servo/i.test(d.type || '')) continue;
    // Intent: distinct speed profiles referenced by this device's motion
    // actions (structured params first, label prose as fallback).
    const profiles = new Set();
    let fastWord = false, slowWord = false;
    for (const s of states) {
      const movers = new Set((s.actions || [])
        .filter(a => a.deviceId && MOTION_OPS.test(a.operation || ''))
        .map(a => a.deviceId));
      for (const a of s.actions || []) {
        if (a.deviceId !== d.id || !MOTION_OPS.test(a.operation || '')) continue;
        const sp = a.params?.speedProfile;
        if (sp) profiles.add(String(sp).toLowerCase());
        if (a.params?.advance === 'wideband') anyWideband = true;
        // Label prose is a fallback for diagrams without structured speed
        // params — only trustworthy when this device is the state's ONLY
        // mover (a multi-axis state's "fast/slow" words can't be attributed).
        if (movers.size === 1) {
          const hay = `${s.label || ''} ${a.detail || ''}`.toLowerCase();
          if (/\bfast\b/.test(hay)) fastWord = true;
          if (/\bslow\b/.test(hay)) slowWord = true;
        }
      }
    }
    const wantsMulti = profiles.size >= 2 || (fastWord && slowWord);
    if (!wantsMulti) continue;
    const staged = stagedSpeeds.get(d.id) || new Set();
    if (staged.size < 2) {
      errors.push(`Speed changes specified but not implemented: the ${contract} describes multiple speeds for ` +
        `"${d.name}" (${profiles.size >= 2 ? [...profiles].join('/') : 'fast/slow segments'}), but the generated ` +
        `logic stages ${staged.size ? `only AutoSpeed[${[...staged].join(',')}]` : 'no AutoSpeed index'} for it — ` +
        'each speed segment needs its own AutoSpeed[i]/Accel[i]/Decel[i] staging branch (Rule 14)');
    }
  }

  // Blending: structured wideband intent must appear as InPosWide in R02.
  const r02Blob = rungs.filter(r => /R02/i.test(r.routine)).map(r => r.text).join('\n');
  const purposes = machineSpec
    ? (Array.isArray(machineSpec.devicePurposes)
      ? machineSpec.devicePurposes.map(p => p?.purpose || '')
      : Object.values(machineSpec.devicePurposes || {}))
    : [];
  const specText = machineSpec
    ? `${machineSpec.sourceDescription || ''} ${purposes.join(' ')} ${machineSpec.purpose || ''}`
    : '';
  const proseBlend = /blend|round(?:ed|ing)?\s+(?:the\s+)?corner|corner.{0,20}round/i.test(specText);
  if (anyWideband && !/InPosWide/.test(r02Blob)) {
    errors.push(`Blending specified but not implemented: the ${contract} marks motion advance as 'wideband', ` +
      'but no R02 transition uses the [Axis_MAM.PC + InPos , Axis_MAM.IP + InPosWide] pattern (Rule 14)');
  } else if (!anyWideband && proseBlend && !/InPosWide/.test(r02Blob)) {
    warnings.push('The machine spec describes blended/rounded-corner motion but no R02 transition references ' +
      'InPosWide — verify the corners the ME described are actually blended (Rule 14)');
  }
}

/**
 * Cross-check generated L5X against the source flowchart.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateAgainstDiagram(projectJson, smId, l5x) {
  const errors = [];
  const warnings = [];

  let ir;
  try { ir = buildIR(projectJson, smId); }
  catch (e) { return { ok: false, errors: [`Diagram cross-check failed: ${e.message}`], warnings }; }

  const progXml = targetProgramXml(l5x);
  if (!progXml) return { ok: false, errors: ['Diagram cross-check: no <Program Use="Target"> in generated L5X'], warnings };

  const rungs = extractRungsWithComments(progXml);
  const flowStates = ir.states.filter(s =>
    s.stateNumber != null && s.stateNumber >= 4 && s.stateNumber <= 97 && (s.stateNumber - 4) % 3 === 0);
  const stateByNumber = new Map(flowStates.map(s => [s.stateNumber, s]));
  const variants = deviceVariants(ir.devices);

  const hasVision = ir.states.some(s => s.actions.some(a => /vision/i.test(a.operation || '')));
  if (hasVision) warnings.push('Diagram cross-check: vision sub-states are not checked (not yet implemented)');

  // (a1) every flowchart state has a MOVE(n,Control.StateReg) in R02
  const r02Blob = rungs.filter(r => /R02/i.test(r.routine)).map(r => r.text).join('\n');
  for (const s of flowStates) {
    if (!new RegExp(`MOVE?\\(${s.stateNumber},\\s*Control\\.StateReg\\)`).test(r02Blob) &&
        !r02Blob.includes(`MOVE(${s.stateNumber},Control.StateReg)`)) {
      errors.push(`Diagram state ${s.stateNumber} ("${s.label}") has no MOVE(${s.stateNumber},Control.StateReg) transition in R02_StateTransitions`);
    }
  }

  // Pre-normalize rung blobs. LOGIC TEXT ONLY — rung comments are never
  // device evidence (a wrong comment naming a device must not satisfy the
  // check the logic alone would fail); comments are validated separately by
  // checkStateComments.
  const normRungs = rungs.map(r => ({
    ...r,
    blob: normIdent(r.text),
    stateRefs: [...r.text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)].map(m => parseInt(m[1], 10)),
  }));

  // (a2) every diagram action's device is evidenced at its state
  for (const s of flowStates) {
    for (const a of s.actions) {
      if (!a.deviceId || !a.deviceName) continue;
      const v = variants.get(a.deviceId);
      if (!v || v.size === 0) continue;
      const evidenced = normRungs.some(r =>
        (r.stateRefs.includes(s.stateNumber) || r.text.includes(`State[${s.stateNumber}]`)) &&
        rungMentionsDevice(r.blob, v));
      if (!evidenced) {
        errors.push(`Diagram action "${a.operation} -> ${a.deviceName}" at state ${s.stateNumber} ("${s.label}") ` +
          `has no rung referencing Status.State[${s.stateNumber}] together with device "${a.deviceName}"`);
      }
    }
  }

  // (b) no command references a flowchart state whose node lacks an action
  //     for that device. Commands: OTE/OTL of q_*, MAM(iq_*, motion staging
  //     MOVE(HMI_*.
  const deviceForIdent = ident => {
    const n = normIdent(ident);
    let best = null, bestLen = 0;
    for (const [id, set] of variants) {
      for (const v of set) {
        if (n.includes(v) && v.length > bestLen) { best = id; bestLen = v.length; }
      }
    }
    return best;
  };
  const deviceName = id => ir.devices.find(d => d.id === id)?.name || id;
  const nodeHasDeviceAction = (s, devId) =>
    s.actions.some(a => a.deviceId === devId && !CONDITION_OPS.test(a.operation || ''));

  for (const r of normRungs) {
    const commands = [
      ...[...r.text.matchAll(/OT[EL]\((q_[A-Za-z0-9_]+)\)/g)].map(m => m[1]),
      ...[...r.text.matchAll(/MAM\((iq_[A-Za-z0-9_]+)/g)].map(m => m[1]),
      ...[...r.text.matchAll(/MOVE\(HMI_([A-Za-z0-9_]+)\.Parameters\.Positions/g)].map(m => m[1]),
    ];
    if (!commands.length) continue;
    const cmdDevices = new Set(commands.map(deviceForIdent).filter(Boolean));
    if (!cmdDevices.size) continue;
    for (const n of r.stateRefs) {
      if (n < 4 || n > 97 || (n - 4) % 3 !== 0) continue; // init/mode/fault states are template law
      const node = stateByNumber.get(n);
      if (!node) {
        errors.push(`Generated logic commands a device at state ${n} (${r.routine}) but the diagram has no state ${n}`);
        continue;
      }
      for (const devId of cmdDevices) {
        if (!nodeHasDeviceAction(node, devId)) {
          errors.push(`Device "${deviceName(devId)}" is commanded at state ${n} ("${node.label}") in ${r.routine}, ` +
            `but that diagram state has no ${deviceName(devId)} action — wrong-state command defect`);
        }
      }
    }
  }

  // (c) state-label comment consistency (tag .STATE[] + R02 rung comments)
  checkStateComments(flowStates, progXml, rungs, errors, warnings, 'diagram');

  // (d) motion intent coverage: speed staging + blending (Rule 14)
  checkMotionIntent(ir.devices, flowStates, ir.machineSpec, rungs, errors, warnings, 'diagram');

  // (e) alarm position references (Rule 19): every R20 "Waiting … To Reach"
  //     alarm names a position declared in the axis's position table.
  checkAlarmPositionRefs(ir.devices, rungs, errors);

  return { ok: errors.length === 0, errors, warnings };
}

// ── Compiled-IR cross-validation (JARVIS v1.1 translation mode) ─────────────
//
// When a station carries an engineer-APPROVED compiled sequence, the compiled
// IR — not the drawn diagram — is the approval contract. This check mirrors
// validateAgainstDiagram but sources its expectations from the compiled IR:
//   (a) every compiled sequence-grid state has its MOVE(n,Control.StateReg)
//       in R02, and each state's device actions are evidenced at that state;
//   (b) no MOVE targets a sequence-grid state the compiled sequence doesn't
//       have, and no device is commanded in a compiled state that has no
//       action for it.

function onSequenceGrid(n) {
  return Number.isInteger(n) && n >= 4 && n <= 97 && (n - 4) % 3 === 0;
}

/**
 * Cross-check generated L5X against an approved compiled sequence.
 * @param {object} compiledIr  sm.compiledSequence.ir (irVersion 1, compiled)
 * @param {string} l5x
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateAgainstCompiledIR(compiledIr, l5x) {
  const errors = [];
  const warnings = [];

  if (!compiledIr || !Array.isArray(compiledIr.states)) {
    return { ok: false, errors: ['Compiled-IR cross-check: compiled IR missing or malformed'], warnings };
  }
  const progXml = targetProgramXml(l5x);
  if (!progXml) return { ok: false, errors: ['Compiled-IR cross-check: no <Program Use="Target"> in generated L5X'], warnings };

  const rungs = extractRungsWithComments(progXml);
  const gridStates = compiledIr.states.filter(s => onSequenceGrid(s.stateNumber));
  const stateByNumber = new Map(gridStates.map(s => [s.stateNumber, s]));
  const variants = deviceVariants(compiledIr.devices || []);

  // (a1) every compiled state has a MOVE(n,Control.StateReg) in R02
  const r02Blob = rungs.filter(r => /R02/i.test(r.routine)).map(r => r.text).join('\n');
  for (const s of gridStates) {
    if (!new RegExp(`MOVE?\\(${s.stateNumber},\\s*Control\\.StateReg\\)`).test(r02Blob)) {
      errors.push(`Compiled state ${s.stateNumber} ("${s.label}") has no MOVE(${s.stateNumber},Control.StateReg) transition in R02_StateTransitions — the approved sequence requires it`);
    }
  }

  // (b1) no MOVE targets a sequence-grid state the compiled sequence lacks
  for (const m of r02Blob.matchAll(/MOVE?\((\d+),\s*Control\.StateReg\)/g)) {
    const n = parseInt(m[1], 10);
    if (onSequenceGrid(n) && !stateByNumber.has(n)) {
      errors.push(`Generated logic transitions to state ${n}, but the APPROVED compiled sequence has no state ${n} — states must match the approval contract exactly`);
    }
  }

  // Logic text only — rung comments are never device evidence (see the
  // diagram variant above); comments get their own consistency check below.
  const normRungs = rungs.map(r => ({
    ...r,
    blob: normIdent(r.text),
    stateRefs: [...r.text.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)].map(x => parseInt(x[1], 10)),
  }));

  // (a2) each compiled state's device actions are evidenced at that state
  for (const s of gridStates) {
    for (const a of s.actions || []) {
      if (!a.deviceId || !a.deviceName) continue;
      const v = variants.get(a.deviceId);
      if (!v || v.size === 0) continue;
      const evidenced = normRungs.some(r =>
        (r.stateRefs.includes(s.stateNumber) || r.text.includes(`State[${s.stateNumber}]`)) &&
        rungMentionsDevice(r.blob, v));
      if (!evidenced) {
        errors.push(`Compiled action "${a.operation} -> ${a.deviceName}" at state ${s.stateNumber} ("${s.label}") ` +
          `has no rung referencing Status.State[${s.stateNumber}] together with device "${a.deviceName}"`);
      }
    }
  }

  // (b2) no device commanded in a compiled state that has no action for it
  const deviceForIdent = ident => {
    const n = normIdent(ident);
    let best = null, bestLen = 0;
    for (const [id, set] of variants) {
      for (const v of set) {
        if (n.includes(v) && v.length > bestLen) { best = id; bestLen = v.length; }
      }
    }
    return best;
  };
  const deviceName = id => (compiledIr.devices || []).find(d => d.id === id)?.name || id;
  const stateHasDeviceAction = (s, devId) =>
    (s.actions || []).some(a => a.deviceId === devId && !CONDITION_OPS.test(a.operation || ''));

  for (const r of normRungs) {
    const commands = [
      ...[...r.text.matchAll(/OT[EL]\((q_[A-Za-z0-9_]+)\)/g)].map(m => m[1]),
      ...[...r.text.matchAll(/MAM\((iq_[A-Za-z0-9_]+)/g)].map(m => m[1]),
      ...[...r.text.matchAll(/MOVE\(HMI_([A-Za-z0-9_]+)\.Parameters\.Positions/g)].map(m => m[1]),
    ];
    if (!commands.length) continue;
    const cmdDevices = new Set(commands.map(deviceForIdent).filter(Boolean));
    if (!cmdDevices.size) continue;
    for (const n of r.stateRefs) {
      if (!onSequenceGrid(n)) continue;
      const node = stateByNumber.get(n);
      if (!node) {
        errors.push(`Generated logic commands a device at state ${n} (${r.routine}) but the approved compiled sequence has no state ${n}`);
        continue;
      }
      for (const devId of cmdDevices) {
        if (!stateHasDeviceAction(node, devId)) {
          errors.push(`Device "${deviceName(devId)}" is commanded at state ${n} ("${node.label}") in ${r.routine}, ` +
            `but the approved compiled sequence has no ${deviceName(devId)} action there — approval-contract violation`);
        }
      }
    }
  }

  // (c) state-label comment consistency against the approved compiled IR
  checkStateComments(gridStates, progXml, rungs, errors, warnings, 'approved compiled sequence');

  // (c2) one move per state in the approval contract itself — a multi-move
  // state that slipped past compile review must still die here.
  const omps = checkOneMovePerState(compiledIr);
  errors.push(...omps.errors);
  warnings.push(...omps.warnings);

  // (d) motion intent coverage: speed staging + blending (Rule 14)
  checkMotionIntent(compiledIr.devices || [], gridStates, compiledIr.machineSpec, rungs, errors, warnings,
    'approved compiled sequence');

  // (e) alarm position references (Rule 19): every R20 "Waiting … To Reach"
  //     alarm names a position declared in the axis's position table.
  checkAlarmPositionRefs(compiledIr.devices || [], rungs, errors);

  return { ok: errors.length === 0, errors, warnings };
}

/** Render a validation report as text (for repair prompts / CLI output). */
function formatReport(report) {
  const lines = [report.ok ? 'VALIDATION PASSED' : 'VALIDATION FAILED'];
  report.errors.forEach(e => lines.push(`  ERROR: ${e}`));
  report.warnings.forEach(w => lines.push(`  warning: ${w}`));
  return lines.join('\n');
}

module.exports = {
  validateL5X, validateAgainstDiagram, validateAgainstCompiledIR, formatReport,
  isLegalState, detectCompareFamily, checkOneMovePerState, sidePathStatesOf,
};
