/**
 * precedents.js — the NAMING PRECEDENT PACK loader (Dan, 2026-08-26:
 * "Controls engineers use what they have — past work as their baseline.
 * Every single step."). jarvis-knowledge/precedents.md is auto-harvested
 * from the shipped corpus by scripts/harvestPrecedents.cjs; every step call
 * (decompose, spec extraction, corrections, compile) rides it in the prompt.
 */

const fs = require('fs');
const path = require('path');

const PRECEDENTS_PATH = path.join(__dirname, '..', '..', '..', 'jarvis-knowledge', 'precedents.md');

/** The raw pack, or '' when it hasn't been harvested yet (never throws). */
function loadPrecedents() {
  try { return fs.readFileSync(PRECEDENTS_PATH, 'utf8'); } catch { return ''; }
}

/** The pack as a ready prompt block (with the standing instruction), or ''. */
function precedentsBlock() {
  const p = loadPrecedents();
  if (!p.trim()) return '';
  return '\n\n# SDC NAMING PRECEDENTS — the baseline\n'
    + 'Name things the way SDC has named them before — these are REAL shipped names. '
    + 'Match the pattern; never invent a style. Invention is the last resort, only '
    + 'when no precedent fits.\n'
    + p;
}

module.exports = { loadPrecedents, precedentsBlock, PRECEDENTS_PATH };
