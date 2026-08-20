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

  return { tags, aoiNames, programs, routines };
}

// ── Rung extraction (Programs section only — never AOI logic) ───────────────

function extractRungs(xml) {
  const progStart = xml.indexOf('<Programs');
  const progEnd = xml.lastIndexOf('</Programs>');
  const section = progStart !== -1 && progEnd !== -1
    ? xml.slice(progStart, progEnd)
    : xml;

  const rungs = [];
  // Track routine context for readable error messages.
  const routineRe = /<Routine\b[^>]*\bName="([^"]+)"|<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/g;
  let currentRoutine = '(unknown routine)';
  let m;
  while ((m = routineRe.exec(section)) !== null) {
    if (m[1] !== undefined) currentRoutine = m[1];
    else if (m[2] !== undefined) rungs.push({ routine: currentRoutine, text: m[2].trim() });
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
          if (decl.tags.has(r) || decl.aoiNames.has(r) || decl.routines.has(r)) continue;
          if (!unresolved.has(r)) unresolved.set(r, `${rung.routine}: ${call.name}(${arg})`);
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

  // 5. L5K string LEN consistency
  checkL5kStrings(xml, errors);

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
    }
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

  // (d) motion intent coverage: speed staging + blending (Rule 14)
  checkMotionIntent(compiledIr.devices || [], gridStates, compiledIr.machineSpec, rungs, errors, warnings,
    'approved compiled sequence');

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
  isLegalState, detectCompareFamily,
};
