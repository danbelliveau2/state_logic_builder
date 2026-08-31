/**
 * importSimValidator.js — structural import simulation for L5X tag data.
 *
 * WHY THIS EXISTS (Aug 2026, second import failure at Jason's desk):
 * Studio 5000 rejected a delivered file at
 *   Programs/Program[@Name='S01_ServoPNP']/Tags/Tag[@Name='AlarmList']/Data
 * with "Data type mismatch — the object's value does not match its data
 * type". Root cause: the AlarmList STRING[10] L5K blob lost the outer
 * array-literal closing bracket (`...']` + CDATA close instead of
 * `...']` `]` + CDATA close). XML well-formedness, LEN counting, and the
 * decorated block were all fine — only a real PARSE of the L5K value
 * literal against the tag's declared DataType/Dimensions catches it.
 *
 * simulateImport(xml) -> { ok, errors, warnings }
 *
 * For every <Tag> (controller + program scope) it:
 *   1. parses the L5K CDATA blob with a real recursive-descent value parser
 *      (numbers / 'strings' with $-escapes / [ ... ] nests) — unbalanced
 *      brackets, trailing garbage, or malformed tokens are hard errors;
 *   2. checks the parsed shape against DataType + Dimensions (element
 *      counts, STRING [LEN,'body'] pairs, LEN == decoded char count,
 *      $00-only padding to the STRING buffer size, legal $-escapes only,
 *      ASCII-only content);
 *   3. cross-checks the Decorated block element-by-element against L5K
 *      (array size, per-element LEN, decoded text equality, LEN member
 *      shape DINT/Decimal, DATA member Radix ASCII);
 *   4. verifies Decorated structure member names against the UDT / AOI
 *      definitions present in the file;
 *   5. rejects non-ASCII bytes in rung <Text> and tag-data CDATA (a Unicode
 *      dash in an alarm text imports as garbage or dies at import) — other
 *      CDATA (comments/descriptions) gets a warning.
 *
 * Pure functions, no deps. Wired as a MANDATORY gate inside
 * validator.validateL5X — every generation path and the pretranslated
 * serve path run it; a file that fails never leaves the pipeline.
 */

'use strict';

// ── Type knowledge ───────────────────────────────────────────────────────────

// Built-in STRING: LEN DINT + DATA SINT[82] => 82-char buffer.
const STRING_BUFFER = 82;
const ATOMIC_TYPES = new Set(['BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT', 'REAL', 'LREAL', 'BIT']);

// ── L5K value parser (recursive descent) ─────────────────────────────────────
//
// Grammar (whitespace incl. newlines/tabs between tokens):
//   value  := array | string | atom
//   array  := '[' value (',' value)* ']'     (also serializes structures)
//   string := '\'' body '\''                 ($-escapes inside)
//   atom   := /[^,\[\]'\s]+/                 (numbers, radix literals, floats)

function parseL5kValue(blob, tagName) {
  const errors = [];
  let i = 0;
  const n = blob.length;

  const ws = () => { while (i < n && /\s/.test(blob[i])) i++; };

  function parseString() {
    // at blob[i] === '\''
    const start = ++i;
    let body = '';
    while (i < n) {
      const c = blob[i];
      if (c === '$') {
        if (i + 1 >= n) { errors.push(`${tagName}: L5K string ends mid-escape ('$' at end of data)`); i = n; return null; }
        body += blob.slice(i, i + (/^[0-9A-Fa-f]{2}/.test(blob.slice(i + 1, i + 3)) ? 3 : 2));
        i += /^[0-9A-Fa-f]{2}/.test(blob.slice(i + 1, i + 3)) ? 3 : 2;
        continue;
      }
      if (c === "'") { i++; return { kind: 'string', body }; }
      body += c;
      i++;
    }
    errors.push(`${tagName}: L5K string starting at offset ${start - 1} is never closed (missing ')`);
    return null;
  }

  function parseValue(depth) {
    ws();
    if (i >= n) { errors.push(`${tagName}: L5K data ended where a value was expected (unbalanced brackets? missing ']')`); return null; }
    const c = blob[i];
    if (c === '[') {
      const openAt = i;
      i++;
      const items = [];
      ws();
      if (i < n && blob[i] === ']') { i++; return { kind: 'array', items }; } // empty
      for (;;) {
        const v = parseValue(depth + 1);
        if (v === null) return null;
        items.push(v);
        ws();
        if (i < n && blob[i] === ',') { i++; continue; }
        if (i < n && blob[i] === ']') { i++; return { kind: 'array', items }; }
        errors.push(`${tagName}: L5K array opened at offset ${openAt} is not terminated — expected ',' or ']' at offset ${i}` +
          (i >= n ? ' (end of data: the closing ] of the array literal is missing)' : ` (found ${JSON.stringify(blob[i])})`));
        return null;
      }
    }
    if (c === "'") return parseString();
    const m = /^[^,\[\]'\s]+/.exec(blob.slice(i));
    if (!m) { errors.push(`${tagName}: unexpected character ${JSON.stringify(c)} in L5K data at offset ${i}`); return null; }
    i += m[0].length;
    return { kind: 'atom', raw: m[0] };
  }

  const root = parseValue(0);
  if (root !== null) {
    ws();
    if (i < n) {
      errors.push(`${tagName}: trailing content after the L5K value literal at offset ${i}: ` +
        JSON.stringify(blob.slice(i, i + 24)) + (n - i > 24 ? '…' : '') +
        ' — the value must be exactly one literal (extra or missing brackets?)');
    }
  }
  return { root: errors.length ? null : root, errors };
}

// ── $-escape decoding (strict: illegal escapes are errors) ───────────────────

const SINGLE_ESCAPES = new Set(['$', "'", 'T', 't', 'L', 'l', 'N', 'n', 'P', 'p', 'R', 'r']);

/** Decode an encoded L5K/Decorated string body. Returns { chars: [code,…], errors }. */
function decodeBody(body, where) {
  const chars = [];
  const errors = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '$') {
      const code = body.charCodeAt(i);
      if (code > 126) errors.push(`${where}: non-ASCII character U+${code.toString(16).toUpperCase().padStart(4, '0')} in string data — Studio 5000 tag data must be ASCII ($-escape it as $XX if truly intended)`);
      chars.push(code);
      continue;
    }
    const two = body.slice(i + 1, i + 3);
    if (/^[0-9A-Fa-f]{2}$/.test(two)) { chars.push(parseInt(two, 16)); i += 2; continue; }
    const nxt = body[i + 1];
    if (nxt !== undefined && SINGLE_ESCAPES.has(nxt)) { chars.push(nxt === '$' ? 36 : 39); i += 1; continue; }
    errors.push(`${where}: illegal $-escape "$${nxt ?? ''}" — legal forms are $XX (two hex digits), $$, $', $T, $L, $N, $P, $R`);
    i += 1;
  }
  return { chars, errors };
}

/** Visible text of a decoded char array (up to first run of trailing NULs). */
function decodedText(chars, len) {
  return chars.slice(0, len).map(c => String.fromCharCode(c)).join('');
}

// ── STRING element check ─────────────────────────────────────────────────────

function checkStringElement(el, where, bufferSize, errors) {
  if (el.kind !== 'array' || el.items.length !== 2 ||
      el.items[0].kind !== 'atom' || el.items[1].kind !== 'string') {
    errors.push(`${where}: STRING value must be a [LEN,'body'] pair — got ${el.kind === 'array' ? `${el.items.length}-item array` : el.kind}`);
    return null;
  }
  const len = parseInt(el.items[0].raw, 10);
  if (!Number.isInteger(len) || len < 0) {
    errors.push(`${where}: STRING LEN "${el.items[0].raw}" is not a non-negative integer`);
    return null;
  }
  const dec = decodeBody(el.items[1].body, where);
  errors.push(...dec.errors);
  const total = dec.chars.length;
  if (len > bufferSize) errors.push(`${where}: LEN=${len} exceeds the STRING buffer (${bufferSize} chars)`);
  if (total !== bufferSize) {
    errors.push(`${where}: decoded content is ${total} chars but the STRING type's buffer is ${bufferSize} — pad with $00 to exactly ${bufferSize}`);
  }
  if (total >= len && dec.chars.slice(len).some(c => c !== 0)) {
    errors.push(`${where}: padding past LEN=${len} must be all $00 (found non-NUL bytes in the pad region)`);
  }
  if (total < len) errors.push(`${where}: declared LEN=${len} but content decodes to only ${total} chars`);
  return { len, text: decodedText(dec.chars, Math.min(len, total)) };
}

// ── Definition harvesting (UDTs, AOIs) ───────────────────────────────────────

function harvestTypeDefs(xml) {
  const udts = new Map(); // name -> { members: Map<name, {dataType, dimension, hidden}> }
  const udtRe = /<DataType\s+[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/DataType>/g;
  let m;
  while ((m = udtRe.exec(xml)) !== null) {
    const members = new Map();
    for (const mm of m[2].matchAll(/<Member\s+([^>]*?)\/?>/g)) {
      const attrs = mm[1];
      const name = (attrs.match(/\bName="([^"]+)"/) || [])[1];
      if (!name) continue;
      members.set(name, {
        dataType: (attrs.match(/\bDataType="([^"]+)"/) || [])[1] || '',
        dimension: parseInt((attrs.match(/\bDimension="([^"]+)"/) || [])[1] || '0', 10),
        hidden: /\bHidden="true"/i.test(attrs),
      });
    }
    udts.set(m[1], { members });
  }
  const aois = new Map(); // name -> Set of visible member names (params + local tags)
  const aoiRe = /<AddOnInstructionDefinition\s+[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/AddOnInstructionDefinition>/g;
  while ((m = aoiRe.exec(xml)) !== null) {
    const names = new Set();
    for (const pm of m[2].matchAll(/<(?:Parameter|LocalTag)\s+[^>]*Name="([^"]+)"/g)) names.add(pm[1]);
    aois.set(m[1], names);
  }
  return { udts, aois };
}

// ── Decorated block parsing ──────────────────────────────────────────────────

/** All immediate string-element records of a Decorated STRING array/scalar. */
function parseDecoratedStrings(decorated, where, errors) {
  const out = [];
  const elRe = /<Element\s+Index="\[(\d+)\]"[^>]*>([\s\S]*?)<\/Element>/g;
  const scan = (body, label) => {
    const lenM = body.match(/<DataValueMember\s+Name="LEN"\s+DataType="([^"]+)"(?:\s+Radix="([^"]+)")?\s+Value="([^"]+)"/);
    const dataM = body.match(/<DataValueMember\s+Name="DATA"\s+DataType="STRING"(?:\s+Radix="([^"]+)")?[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (!lenM || !dataM) { errors.push(`${label}: Decorated STRING structure must carry LEN and DATA members`); return; }
    if (lenM[1] !== 'DINT') errors.push(`${label}: Decorated LEN member DataType is "${lenM[1]}" — the template shape is DINT`);
    if (dataM[1] && dataM[1] !== 'ASCII') errors.push(`${label}: Decorated DATA member Radix is "${dataM[1]}" — the template shape is ASCII`);
    let text = dataM[2];
    // Studio wraps the DATA CDATA text in single quotes
    if (text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1);
    const dec = decodeBody(text, label);
    errors.push(...dec.errors);
    out.push({ len: parseInt(lenM[3], 10), text: dec.chars.map(c => String.fromCharCode(c)).join('') });
  };
  let m;
  let sawElements = false;
  while ((m = elRe.exec(decorated)) !== null) { sawElements = true; scan(m[2], `${where} Decorated element [${m[1]}]`); }
  if (!sawElements && /<Structure\s+DataType="STRING"/.test(decorated)) scan(decorated, `${where} Decorated`);
  return out;
}

// ── Per-tag check ────────────────────────────────────────────────────────────

function checkTag(tag, defs, errors, warnings) {
  const { name, dataType, dims, l5k, decorated } = tag;
  const where = `Tag ${name} (${dataType}${dims != null ? `[${dims}]` : ''})`;

  // A. Parse the L5K literal (when present).
  let root = null;
  if (l5k != null) {
    const parsed = parseL5kValue(l5k.trim(), where);
    errors.push(...parsed.errors);
    root = parsed.root;
  }

  const isString = dataType === 'STRING';
  const udt = defs.udts.get(dataType);
  const aoi = defs.aois.get(dataType);

  // B. Shape vs DataType/Dimensions.
  if (root) {
    if (dims != null) {
      if (root.kind !== 'array') {
        errors.push(`${where}: Dimensions="${dims}" but the L5K literal is not an array`);
      } else if (root.items.length !== dims) {
        errors.push(`${where}: Dimensions="${dims}" but the L5K array has ${root.items.length} elements`);
      } else if (isString) {
        root.items.forEach((el, idx) => checkStringElement(el, `${where} L5K element [${idx}]`, STRING_BUFFER, errors));
      }
    } else if (isString) {
      checkStringElement(root, `${where} L5K`, STRING_BUFFER, errors);
    } else if (ATOMIC_TYPES.has(dataType)) {
      if (root.kind !== 'atom') errors.push(`${where}: atomic ${dataType} tag's L5K value must be a single literal, got ${root.kind}`);
    }
    // UDT/AOI/TIMER etc.: the balanced parse above is the import-critical part.
  }

  // C. Decorated agreement (STRING family — the class that burned us).
  if (isString && decorated != null && root) {
    const decStrings = parseDecoratedStrings(decorated, where, errors);
    const l5kStrings = [];
    const collect = (el, idx) => {
      const silent = [];
      const r = checkStringElement(el, '', STRING_BUFFER, silent); // already reported above
      l5kStrings.push(r ? r : null);
    };
    if (dims != null && root.kind === 'array') root.items.forEach(collect);
    else collect(root, 0);

    const expected = dims != null ? dims : 1;
    if (decStrings.length !== expected) {
      errors.push(`${where}: Decorated block has ${decStrings.length} STRING element(s) but the tag declares ${expected}`);
    }
    const nBoth = Math.min(decStrings.length, l5kStrings.length);
    for (let i = 0; i < nBoth; i++) {
      const d = decStrings[i], k = l5kStrings[i];
      if (!d || !k) continue;
      if (d.len !== k.len) errors.push(`${where} element [${i}]: Decorated LEN=${d.len} disagrees with L5K LEN=${k.len}`);
      if (d.text !== k.text) {
        errors.push(`${where} element [${i}]: Decorated text ${JSON.stringify(d.text.slice(0, 48))} disagrees with L5K text ${JSON.stringify(k.text.slice(0, 48))}`);
      }
    }
    // Decorated Array Dimensions attribute must match the tag's.
    const dm = decorated.match(/<Array\s+DataType="STRING"\s+Dimensions="(\d+)"/);
    if (dims != null && dm && parseInt(dm[1], 10) !== dims) {
      errors.push(`${where}: Decorated <Array Dimensions="${dm[1]}"> disagrees with the tag's Dimensions="${dims}"`);
    }
  }

  // D. Decorated structure members vs UDT/AOI definitions in this file.
  if (decorated != null && (udt || aoi)) {
    const memberNames = udt
      ? new Set([...udt.members.entries()].filter(([, v]) => !v.hidden).map(([k]) => k))
      : aoi;
    for (const mm of decorated.matchAll(/<(?:DataValueMember|StructureMember|ArrayMember)\s+Name="([^"]+)"/g)) {
      // Only check members that belong to the TOP-level structure of this
      // type; nested UDT members would false-positive, so restrict to names
      // that appear nowhere in ANY definition.
      if (memberNames.has(mm[1])) continue;
      const anywhere = [...defs.udts.values()].some(u => u.members.has(mm[1])) ||
        [...defs.aois.values()].some(s => s.has(mm[1])) ||
        ['LEN', 'DATA', 'PRE', 'ACC', 'EN', 'TT', 'DN', 'CU', 'CD', 'OV', 'UN'].includes(mm[1]);
      if (!anywhere) {
        errors.push(`${where}: Decorated member "${mm[1]}" does not exist on ${dataType} (or any type defined in this file)`);
      }
    }
  }

  // E. L5K present without Decorated (or vice versa) — Studio tolerates it,
  //    but our generator always emits both; a lone half means an edit lost one.
  if ((l5k != null) !== (decorated != null) && !tag.hasStringFormat) {
    warnings.push(`${where}: has ${l5k != null ? 'L5K' : 'Decorated'} data but not its counterpart — generator edits must keep both in sync`);
  }
}

// ── Tag extraction ───────────────────────────────────────────────────────────

function extractTags(xml) {
  // Strip AOI definitions: their LocalTags carry DefaultData in other formats.
  let doc = xml;
  const aoiBlocks = [];
  doc = doc.replace(/<AddOnInstructionDefinition\b[\s\S]*?<\/AddOnInstructionDefinition>/g, s => { aoiBlocks.push(s); return ''; });

  const tags = [];
  const tagRe = /<Tag\s+([^>]*)>([\s\S]*?)<\/Tag>/g;
  let m;
  while ((m = tagRe.exec(doc)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const name = (attrs.match(/\bName="([^"]+)"/) || [])[1];
    if (!name) continue;
    const dataType = (attrs.match(/\bDataType="([^"]+)"/) || [])[1] || '';
    const dimsAttr = (attrs.match(/\bDimensions="([^"]+)"/) || [])[1];
    // Multi-dim ("3 4") — only total element count matters for L5K top level.
    const dims = dimsAttr != null
      ? dimsAttr.trim().split(/\s+/).map(Number).reduce((a, b) => a * b, 1)
      : null;
    if (dimsAttr != null && (!Number.isFinite(dims) || dims <= 0)) continue; // malformed dims caught by name checks elsewhere
    const l5kM = body.match(/<Data\s+Format="L5K">\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Data>/);
    const decM = body.match(/<Data\s+Format="Decorated">([\s\S]*?)<\/Data>/);
    if (dataType === 'AXIS_CIP_DRIVE' || dataType === 'MOTION_GROUP' || dataType === 'ALARM' || /^MESSAGE$/i.test(dataType)) continue;
    tags.push({
      name, dataType, dims,
      l5k: l5kM ? l5kM[1] : null,
      decorated: decM ? decM[1] : null,
      // Studio exports STRING scalars with <Data Format="String"> instead of
      // Decorated — that's normal, not a lost half.
      hasStringFormat: /<Data\s+Format="String"/.test(body),
    });
  }
  return { tags, aoiBlocks };
}

// ── ASCII discipline in CDATA ────────────────────────────────────────────────

function checkCdataAscii(xml, errors, warnings) {
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = cdataRe.exec(xml)) !== null) {
    const bad = /[^\x09\x0A\x0D\x20-\x7E]/.exec(m[1]);
    if (!bad) continue;
    const code = bad[0].codePointAt(0);
    const before = xml.slice(Math.max(0, m.index - 600), m.index);
    const ctx = (before.match(/<(?:Tag|Routine|Program)\b[^>]*\bName="([^"]+)"(?![\s\S]*<(?:Tag|Routine|Program)\b)/) || [])[1] || '(unknown)';
    const isTextOrData = /<(Text|Data)\b[^>]*>\s*$/.test(before);
    const msg = `Non-ASCII character U+${code.toString(16).toUpperCase().padStart(4, '0')} ` +
      `(${JSON.stringify(bad[0])}) in CDATA near "${ctx}" — Studio 5000 imports are ASCII-only; ` +
      'replace it (e.g. em-dash with "-") or $-escape it inside string data';
    if (isTextOrData) errors.push(msg);
    else warnings.push(msg);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Structurally simulate a Studio 5000 import of every tag's data blocks.
 * @param {string} xml — full L5X document
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function simulateImport(xml) {
  const errors = [];
  const warnings = [];
  if (typeof xml !== 'string' || !xml.trim()) return { ok: false, errors: ['Empty document'], warnings };

  const defs = harvestTypeDefs(xml);
  const { tags } = extractTags(xml);
  for (const tag of tags) {
    try { checkTag(tag, defs, errors, warnings); }
    catch (e) { errors.push(`Tag ${tag.name}: import simulation crashed — ${e.message}`); }
  }
  checkCdataAscii(xml, errors, warnings);
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { simulateImport, parseL5kValue, decodeBody, STRING_BUFFER };
