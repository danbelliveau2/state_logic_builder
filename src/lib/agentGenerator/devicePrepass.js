/**
 * devicePrepass.js — DETERMINISTIC DEVICE EMISSION (Dan's Rockwell-demo
 * debrief, 2026-08-31: "deterministic for known patterns, model only for
 * novel logic"). Audit of the real MidBasePickAndPlace plan: 49 of 68 ops
 * (72%) were mechanical device work — renames, removals, tag comments — and
 * the phantom-Z axis purge alone burned 4 paid fix rounds. Device blocks are
 * PARAMETERIZED PATTERNS: stamp them from the sheet BEFORE the model writes;
 * the model authors only R02/R03 flowchart logic + init/recovery reasoning.
 *
 * v1 scope (conservative — anything ambiguous is LEFT for the model, listed
 * in the note so it knows what is already done):
 *   1. AXIS PURGE: template axes with no matching sheet servo are removed
 *      completely — R0N_{X}Servo routine + JSR, every {X}* tag (iq_/HMI_/
 *      support), ParameterConnections, MotionGroup entry. (The exact work the
 *      model could not express before removeRoutine/removeTag existed.)
 *   2. GRIPPER RENAME: the template's single gripper family
 *      (q_Close/OpenGripper + delays) renames to the sheet gripper's name
 *      when the sheet has exactly one gripper.
 *   3. SENSOR RENAME: the template's single digital sensor family
 *      (i_{X} + {X}Debounce) renames to the sheet sensor when exactly one.
 *
 * Pure function: devicePrepass(templateXml, ir) → { xml, note, applied[] }.
 * Gate: JARVIS_DEVICE_PREPASS=on|off (default on) in client.js.
 */

const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pascal = (s) => String(s ?? '').replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '').replace(/^./, (c) => c.toUpperCase());

// Axis-name synonyms (mirrors multiProgram's dry-run-bug fix).
const AXIS_SYN = { x: ['x', 'horizontal'], z: ['z', 'vertical'], y: ['y'] };
function axisMatches(templateAxis, sheetName) {
  const t = nk(templateAxis).replace(/axis$/, '');
  const s = nk(sheetName).replace(/axis$/, '');
  if (t === s || t.includes(s) || s.includes(t)) return true;
  for (const [k, syns] of Object.entries(AXIS_SYN)) {
    if ((t === k || syns.some((y) => t.includes(y))) && (s === k || syns.some((y) => s.includes(y)))) return true;
  }
  return false;
}

/** Whole-word rename outside CDATA-string boundaries is overkill here: tag
 *  identifiers are \w-only, so \b replace is safe (same rule the merge
 *  engine's renameTag uses). */
function renameWord(xml, from, to) {
  return xml.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
}

/** Boundary-safe tag-block removal: a SELF-CLOSING <Tag .../> must never be
 *  matched through to the NEXT </Tag> (a lazy alternation regex here once
 *  swallowed neighboring tags — i_PartPresent died collaterally). */
function removeTagBlocks(xml, name) {
  let idx = 0;
  for (;;) {
    const open = xml.indexOf(`<Tag Name="${name}"`, idx);
    const open2 = open < 0 ? xml.indexOf(`Name="${name}"`, idx) : open;
    let start = open;
    if (start < 0) {
      // attribute order may differ — find the opening tag containing the name
      if (open2 < 0) return xml;
      start = xml.lastIndexOf('<Tag ', open2);
      if (start < 0 || xml.slice(start, open2).includes('>')) return xml;
    }
    const openEnd = xml.indexOf('>', start);
    if (openEnd < 0) return xml;
    let end;
    if (xml[openEnd - 1] === '/') {
      end = openEnd + 1;                       // self-closing
    } else {
      end = xml.indexOf('</Tag>', openEnd);
      if (end < 0) return xml;
      end += '</Tag>'.length;
    }
    while (xml[end] === '\r' || xml[end] === '\n') end++;
    xml = xml.slice(0, start) + xml.slice(end);
    idx = start;
  }
}

/** Remove one axis completely — the phantom-Z playbook, deterministic. */
function purgeAxis(xml, axis /* e.g. 'ZAxis' */, applied) {
  // 1. The servo routine (R0N_{axis}Servo) + every JSR to it.
  const rm = xml.match(new RegExp(`<Routine[^>]*Name="(R\\d+_${axis}Servo)"[\\s\\S]*?</Routine>\\s*`));
  if (rm) {
    xml = xml.replace(rm[0], '');
    xml = xml.replace(/<Rung\b[\s\S]*?<\/Rung>\s*/g, (blk) => (blk.includes(`JSR(${rm[1]}`) ? '' : blk));
    applied.push(`removed routine ${rm[1]} + JSR`);
  }
  // 2. Every tag whose name starts with the axis or its iq_/HMI_/a-number
  //    forms; plus delay/support tags ({axis}EnableDelay etc. start with axis).
  const names = new Set([...xml.matchAll(new RegExp(`<Tag\\s+[^>]*Name="((?:iq_|HMI_)?${axis}[A-Za-z0-9_]*)"`, 'g'))].map((m) => m[1]));
  for (const n of names) xml = removeTagBlocks(xml, n);
  if (names.size) applied.push(`removed ${names.size} ${axis}* tag(s)`);
  // 3. ParameterConnections touching the axis parameter (a dangling one
  //    cancels the whole Studio import — Jason round 2).
  xml = xml.replace(/<ParameterConnection\s+[^>]*\/>\s*/g, (blk) =>
    (new RegExp(`\\b(?:iq_)?${axis}\\b`).test(blk) || nk(blk).includes(nk(axis)) ? '' : blk));
  // 3b. Controller AXIS_CIP_DRIVE context tags + MotionGroup schedule entries
  //     naming this axis (a0N_S##...{axis} pattern).
  for (const m of [...xml.matchAll(/<Tag\s+[^>]*Name="(a\d+_[A-Za-z0-9_]+)"[^>]*DataType="AXIS_CIP_DRIVE"/g)]) {
    if (nk(m[1]).includes(nk(axis))) {
      xml = removeTagBlocks(xml, m[1]);
      xml = xml.replace(new RegExp(`<ParameterConnection\\s+[^>]*"${m[1]}"[^>]*/>\\s*`, 'g'), '');
      applied.push(`removed controller axis ${m[1]} + connection`);
    }
  }
  // 4. Any rung that still references the axis (R01 conditioning, alarms).
  xml = xml.replace(/<Rung\b[\s\S]*?<\/Rung>\s*/g, (blk) => (new RegExp(`\\b(?:iq_|HMI_)?${axis}[A-Za-z0-9_]*\\b`).test(blk.replace(/<!\[CDATA\[\*[^\]]*\]\]>/g, '')) && blk.includes(axis) ? '' : blk));
  return xml;
}

function devicePrepass(templateXml, ir) {
  let xml = templateXml;
  const applied = [];
  const devices = (ir?.devices ?? []).map((d) => ({
    name: pascal(d.displayName || d.name), raw: d.displayName || d.name, type: String(d.type ?? ''),
  }));

  // ── 1. Axis purge / keep ──────────────────────────────────────────────────
  const templateAxes = [...new Set([...xml.matchAll(/<Tag\s+[^>]*Name="iq_([A-Za-z0-9]+)"/g)].map((m) => m[1]))];
  const sheetServos = devices.filter((d) => /servo|axis_cip/i.test(d.type));
  for (const ax of templateAxes) {
    const hit = sheetServos.find((d) => axisMatches(ax, d.name));
    if (!hit) {
      xml = purgeAxis(xml, ax, applied);
    }
    // Matched axes keep template naming when nk-equal; a differing sheet name
    // is left for the model (axis renames touch protected boilerplate).
  }

  // ── 2. Gripper rename (exactly one on each side) ─────────────────────────
  const hasTemplateGripper = /Name="q_CloseGripper"/.test(xml);
  const sheetGrippers = devices.filter((d) => /gripper/i.test(d.type));
  if (hasTemplateGripper && sheetGrippers.length === 1 && nk(sheetGrippers[0].name) !== 'gripper') {
    const g = sheetGrippers[0].name;
    for (const [from, to] of [
      ['q_CloseGripper', `q_Close${g}`], ['q_OpenGripper', `q_Open${g}`],
      ['CloseGripperDelay', `${g}CloseDelay`], ['OpenGripperDelay', `${g}OpenDelay`],
      ['GripperClosed', `${g}Closed`], ['GripperOpened', `${g}Opened`],
    ]) {
      if (new RegExp(`\\b${from}\\b`).test(xml)) { xml = renameWord(xml, from, to); applied.push(`renamed ${from} → ${to}`); }
    }
  }

  // ── 3. Single digital sensor rename ──────────────────────────────────────
  const tSensors = [...new Set([...xml.matchAll(/<Tag\s+[^>]*Name="([A-Za-z0-9]+)Debounce"/g)].map((m) => m[1]))];
  const sheetSensors = devices.filter((d) => /digitalsensor/i.test(d.type));
  if (tSensors.length === 1 && sheetSensors.length === 1 && nk(tSensors[0]) !== nk(sheetSensors[0].name)) {
    const from = tSensors[0]; const to = sheetSensors[0].name;
    for (const [f, t] of [[`i_${from}`, `i_${to}`], [`${from}Debounce`, `${to}Debounce`]]) {
      if (new RegExp(`\\b${f}\\b`).test(xml)) { xml = renameWord(xml, f, t); applied.push(`renamed ${f} → ${t}`); }
    }
  }

  const note = applied.length ? [
    '',
    '# DEVICE LAYER ALREADY STAMPED (deterministic pre-pass — do NOT redo)',
    'The template you are reading has ALREADY had this device work applied:',
    ...applied.map((a) => `- ${a}`),
    'Do not author renameTag/removeRoutine/removeTag operations for the items',
    'above — they are done. Author the flowchart logic (R02/R03), initialization',
    'and recovery reasoning, remaining device additions, and alarm content.',
  ].join('\n') : '';

  return { xml, note, applied };
}

module.exports = { devicePrepass, _internals: { purgeAxis, axisMatches, removeTagBlocks } };
