#!/usr/bin/env node
'use strict';
/**
 * gen1160_stubs.cjs - Job 1160 re-base (2026-09-17): the four STUB programs.
 *   S03_YSiteInspectA / S03_YSiteInspectB  (awaiting Jason IV4 standard program)
 *   S13_PhysicalCheckA / S13_PhysicalCheckB (awaiting Jason GT2 standard program)
 * Minimal valid programs: R00_Main only (RLL, one rung), Output BOOL q_AlarmActive + q_WarningActive held off.
 * Tag attribute shapes copied verbatim from generated/1160/ref/ChassisStandard_2UP/Program_S02_ProbeCheckA.xml
 * (lines 414-429). A and B are emitted from ONE source; only the side letter / side text differ.
 * Output: generated/1160/build/programs/<Name>.xml + STUBS_MANIFEST.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/SDC-StateLogic';
const OUT = path.join(ROOT, 'generated/1160/build/programs');
const REF = path.join(ROOT, 'generated/1160/ref/ChassisStandard_2UP/Program_S02_ProbeCheckA.xml');

// Side mapping per NAMES_CONTRACT v2.1 ruling 1: A = LEFT nest, B = RIGHT nest.
const SIDES = { A: 'left', B: 'right' };

// Tag shape lifted from the template (S02_ProbeCheckA lines 414-429) - Output BOOL, Read Only, L5K + Decorated data.
const outputBool = (name) => [
  `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal" Usage="Output" Constant="false" ExternalAccess="Read Only" OpcUaAccess="None">`,
  '<Data Format="L5K">',
  '<![CDATA[0]]>',
  '</Data>',
  '<Data Format="Decorated">',
  '<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>',
  '</Data>',
  '</Tag>',
].join('\n');

function stubProgram({ base, side, station, pending }) {
  const name = `${base}${side}`;
  const nest = SIDES[side];
  const description =
    `${station} Side ${side} (${nest} nest) - STUB. Placeholder until the Jason ${pending} standard program is delivered. ` +
    `Holds q_AlarmActive and q_WarningActive off so the Alarms roll-up and the MainTask schedule are complete. ` +
    `Replace the whole program; keep the program name and the two Output parameters. Job 1160 v1.0.`;
  const rungComment = `STUB - awaiting Jason ${pending} standard program`;
  return [
    `<Program Name="${name}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">`,
    '<Description>',
    `<![CDATA[${description}]]>`,
    '</Description>',
    '<Tags>',
    outputBool('q_AlarmActive'),
    outputBool('q_WarningActive'),
    '</Tags>',
    '<Routines>',
    '<Routine Name="R00_Main" Type="RLL">',
    '<RLLContent>',
    '<Rung Number="0" Type="N">',
    '<Comment>',
    `<![CDATA[${rungComment}]]>`,
    '</Comment>',
    '<Text>',
    '<![CDATA[OTU(q_AlarmActive)OTU(q_WarningActive);]]>',
    '</Text>',
    '</Rung>',
    '</RLLContent>',
    '</Routine>',
    '</Routines>',
    '</Program>',
    '',
  ].join('\n');
}

const STUBS = [
  { base: 'S03_YSiteInspect', station: 'S03 Y-Site Inspect', pending: 'IV4' },
  { base: 'S13_PhysicalCheck', station: 'S13 Physical Check', pending: 'GT2' },
];

// ---------------------------------------------------------------- lint (Jason's rules + contract)
const findings = [];
const fail = (file, rule, msg) => findings.push({ file, rule, msg });
const cdatas = (xml) => [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => ({ text: m[1], index: m.index }));
const tagDecls = (xml) => [...xml.matchAll(/<Tag\s([^>]*?)\/?>/g)].map((m) => ({
  name: (m[1].match(/\sName="([^"]+)"/) || [' ' + m[1]].map((s) => (s.match(/Name="([^"]+)"/) || [])[1]))[1] || (m[1].match(/^Name="([^"]+)"/) || [])[1],
  usage: (m[1].match(/\sUsage="([^"]+)"/) || [])[1] || 'Local',
  dataType: (m[1].match(/\sDataType="([^"]+)"/) || [])[1],
}));

function stackCheck(xml) {
  // strip CDATA then walk tags
  const s = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9_]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , selfClose] = m;
    if (selfClose) continue;
    if (close) { const top = stack.pop(); if (top !== tag) return `</${tag}> closes <${top}>`; }
    else stack.push(tag);
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}

function lint(file, xml) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const bad = xml.match(/[^\x09\x0A\x0D\x20-\x7E]/);
  if (bad) fail(rel, 'ascii', `non-ASCII char U+${bad[0].codePointAt(0).toString(16)}`);
  for (const c of cdatas(xml)) { const b = c.text.match(/[^\x09\x0A\x0D\x20-\x7E]/); if (b) fail(rel, 'ascii-cdata', `non-ASCII U+${b[0].codePointAt(0).toString(16)}`); }
  for (const m of xml.matchAll(/<[A-Za-z][^>]*\sUse="([^"]+)"/g)) fail(rel, 'use-attribute', `Use="${m[1]}"`);
  for (const m of xml.matchAll(/<Description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Description>/g)) if (m[1].length > 512) fail(rel, 'description-length', `${m[1].length} > 512`);
  const st = stackCheck(xml); if (st) fail(rel, 'xml-balance', st);
  const progName = (xml.match(/<Program Name="([^"]+)"/) || [])[1];
  if (progName !== path.basename(file, '.xml')) fail(rel, 'program-name', `<Program Name="${progName}"> != file name`);
  const main = (xml.match(/MainRoutineName="([^"]+)"/) || [])[1];
  const routines = [...xml.matchAll(/<Routine Name="([^"]+)"[^>]*>([\s\S]*?)<\/Routine>/g)];
  if (!routines.some((r) => r[1] === main)) fail(rel, 'main-routine', `MainRoutineName ${main} is not a routine`);
  const tags = tagDecls(xml);
  const seen = new Set(); for (const t of tags) { if (seen.has(t.name)) fail(rel, 'duplicate-tag', t.name); seen.add(t.name); }
  for (const q of ['q_AlarmActive', 'q_WarningActive']) {
    const t = tags.find((x) => x.name === q);
    if (!t || t.usage !== 'Output' || t.dataType !== 'BOOL') fail(rel, 'contract', `${q} must be Output BOOL`);
  }
  const local = new Set(tags.map((t) => t.name));
  const undeclared = [];
  for (const r of routines) {
    const rungs = [...r[2].matchAll(/<Rung Number="(\d+)"[^>]*>([\s\S]*?)<\/Rung>/g)];
    rungs.forEach((rg, i) => { if (Number(rg[1]) !== i) fail(rel, 'rung-numbering', `${r[1]} rung ${rg[1]} at ${i}`); });
    for (const rg of rungs) {
      const text = (rg[2].match(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || '';
      if ((text.match(/\(/g) || []).length !== (text.match(/\)/g) || []).length) fail(rel, 'rung-balance', `${r[1]} rung ${rg[1]}`);
      if (!/;\s*$/.test(text)) fail(rel, 'rung-terminator', `${r[1]} rung ${rg[1]}`);
      for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)/g)) {
        for (const arg of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (m[1] === 'JSR') continue;
          const root = arg.split(/[.[]/)[0];
          if (!local.has(root)) undeclared.push(`${r[1]} rung ${rg[1]}: ${m[1]}(${arg})`);
        }
      }
    }
  }
  for (const u of undeclared) fail(rel, 'undeclared-tag', u);
  // optional: fast-xml-parser well-formedness if installed in the repo
  try {
    const { XMLValidator } = require(path.join(ROOT, 'node_modules', 'fast-xml-parser'));
    const v = XMLValidator.validate(xml);
    if (v !== true) fail(rel, 'xml-parse', JSON.stringify(v.err));
  } catch (e) { /* parser not installed - stackCheck above stands */ }
  return { program: progName, tags: tags.length, routines: routines.map((r) => r[1]), controllerTagsUsed: [], crossProgramRefs: [], bytes: Buffer.byteLength(xml, 'utf8') };
}

// ---------------------------------------------------------------- template shape check
const ref = fs.readFileSync(REF, 'utf8').replace(/\r\n?/g, '\n');
for (const q of ['q_AlarmActive', 'q_WarningActive']) {
  if (!ref.includes(outputBool(q))) fail('template', 'tag-shape', `${q} shape does not match Program_S02_ProbeCheckA.xml verbatim`);
}

// ---------------------------------------------------------------- emit
fs.mkdirSync(OUT, { recursive: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  job: '1160',
  contract: 'generated/1160/build/NAMES_CONTRACT.md (v2.1, Jason rulings 2026-09-17 11:58)',
  tagShapeSource: 'generated/1160/ref/ChassisStandard_2UP/Program_S02_ProbeCheckA.xml (q_AlarmActive / q_WarningActive, lines 414-429)',
  sideMapping: { A: 'LEFT nest', B: 'RIGHT nest' },
  stubs: [],
  findings,
};
for (const s of STUBS) {
  const pair = {};
  const texts = {};
  for (const side of ['A', 'B']) {
    const xml = stubProgram({ ...s, side });
    const file = path.join(OUT, `${s.base}${side}.xml`);
    fs.writeFileSync(file, xml, 'utf8');
    texts[side] = xml;
    pair[side.toLowerCase()] = { file: path.relative(ROOT, file).replace(/\\/g, '/'), ...lint(file, xml) };
  }
  // diff-verify: A and B differ only by the side letter / side nest word
  const al = texts.A.split('\n'); const bl = texts.B.split('\n');
  const diff = [];
  if (al.length !== bl.length) fail(s.base, 'twin-shape', 'line count differs');
  for (let i = 0; i < al.length; i++) {
    if (al[i] === bl[i]) continue;
    const expected = al[i].replace(new RegExp(`\\b${s.base}A\\b`, 'g'), `${s.base}B`).replace(/\bSide A\b/g, 'Side B').replace(/\bleft nest\b/g, 'right nest');
    const ok = expected === bl[i];
    if (!ok) fail(s.base, 'twin-diff', `line ${i + 1} differs by more than the side substitution`);
    diff.push(`L${i + 1}${ok ? '' : ' !!'}: ${al[i].trim().slice(0, 160)} -> ${bl[i].trim().slice(0, 160)}`);
  }
  manifest.stubs.push({
    station: s.station, pendingStandardProgram: `Jason ${s.pending}`,
    parametersOthersRead: ['q_AlarmActive (Output BOOL)', 'q_WarningActive (Output BOOL)'],
    rung0: { comment: `STUB - awaiting Jason ${s.pending} standard program`, text: 'OTU(q_AlarmActive)OTU(q_WarningActive);' },
    ...pair, diffLines: diff.length, diff,
  });
}
const mf = path.join(OUT, 'STUBS_MANIFEST.json');
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2), 'utf8');

for (const st of manifest.stubs) {
  console.log(`== ${st.a.program} / ${st.b.program}  (${st.a.tags} tags, routines ${st.a.routines.join(' ')}, ${st.a.bytes} bytes)  A/B diff ${st.diffLines} line(s)`);
  for (const d of st.diff) console.log(`   ${d}`);
}
if (findings.length) { console.log(`\nFINDINGS (${findings.length}):`); for (const f of findings) console.log(`  [${f.rule}] ${f.file}: ${f.msg}`); }
else console.log('\nno findings');
console.log(`manifest: ${path.relative(ROOT, mf).replace(/\\/g, '/')}`);
process.exit(findings.length ? 1 : 0);
