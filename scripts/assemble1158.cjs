#!/usr/bin/env node
'use strict';
/**
 * assemble1158.cjs — splice builder-agent Program blocks into the 1158 working L5X.
 * Copied/adapted from assemble1160.cjs's intent, much simpler: this job starts from an
 * already-mostly-complete file (Matt's baseline), so assembly is "replace named <Program>
 * blocks with the builder's version", not "construct a controller from scratch".
 *
 * node scripts/assemble1158.cjs
 */
const fs = require('fs');
const path = require('path');

const JOB_DIR = 'X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build';
const BASELINE = path.join(JOB_DIR, '1158_baseline_from_Matt.L5X');
const PROGRAMS_DIR = path.join(JOB_DIR, 'programs');
const OUT = path.join(JOB_DIR, '1158_assembled.L5X');

// oldName (as it appears in the baseline) -> file to splice in (Program Name inside the file may differ, e.g. drop _IP)
const REPLACEMENTS = {
  D01_FlexFeeder: 'D01_FlexFeeder.xml',
  D01S01_PartLoad: 'D01S01_PartLoad.xml',
  D02S01_PlasticLoad: 'D02S01_PlasticLoad.xml',
  D02S13_MetalLoad: 'D02S13_MetalLoad.xml',
  D01S11_SleevePress: 'D01S11_SleevePress.xml', // baseline already renamed (fix script), name matches now
};

let xml = fs.readFileSync(BASELINE, 'utf8');

function extractProgramBlock(text, name) {
  const marker = `<Program Name="${name}" `;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Program "${name}" not found`);
  const end = text.indexOf('</Program>', start);
  if (end < 0) throw new Error(`</Program> not found for "${name}"`);
  return { start, end: end + '</Program>'.length };
}

const report = [];
for (const [oldName, file] of Object.entries(REPLACEMENTS)) {
  const newXmlPath = path.join(PROGRAMS_DIR, file);
  if (!fs.existsSync(newXmlPath)) throw new Error(`missing builder output: ${newXmlPath}`);
  let newBlock = fs.readFileSync(newXmlPath, 'utf8');
  // strip XML declaration if the builder included one
  newBlock = newBlock.replace(/^\s*<\?xml[^>]*\?>\s*/i, '').trim();
  const newNameMatch = newBlock.match(/<Program Name="([^"]+)"/);
  if (!newNameMatch) throw new Error(`no <Program Name=...> found in ${file}`);
  const { start, end } = extractProgramBlock(xml, oldName);
  const oldLen = end - start;
  xml = xml.slice(0, start) + newBlock + xml.slice(end);
  report.push(`  ${oldName} -> ${newNameMatch[1]}  (${oldLen} chars -> ${newBlock.length} chars)`);
  // rename in the task schedule if the program name changed
  if (newNameMatch[1] !== oldName) {
    const before = xml;
    xml = xml.split(`<ScheduledProgram Name="${oldName}"/>`).join(`<ScheduledProgram Name="${newNameMatch[1]}"/>`);
    if (xml === before) console.warn(`  ! no ScheduledProgram entry found for ${oldName} to rename`);
  }
}

fs.writeFileSync(OUT, xml);
console.log('Assembled ->', OUT);
console.log(report.join('\n'));

// quick sanity: program count unchanged, balanced tags
const progOpen = (xml.match(/<Program\b/g) || []).length;
const progClose = (xml.match(/<\/Program>/g) || []).length;
console.log(`\nPrograms: ${progOpen} open / ${progClose} close`);
if (progOpen !== progClose) { console.error('UNBALANCED <Program> tags'); process.exit(1); }
