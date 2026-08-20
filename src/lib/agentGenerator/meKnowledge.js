/**
 * meKnowledge.js — JARVIS's ME-facing standing knowledge.
 *
 * loadMeKnowledge():        read meKnowledge.md fresh (so newly learned facts
 *                           apply on the very next call — no restart needed).
 * appendLearnedFacts(facts): append 'sdc-standard' scoped facts to the
 *                           "## Learned from the MEs" section, deduped by
 *                           fuzzy word overlap (>70% shared words = same fact).
 *
 * CommonJS, plain Node — required lazily by server.js and the author modules.
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_PATH = path.join(__dirname, 'meKnowledge.md');
const LEARNED_HEADING = '## Learned from the MEs';
// jarvis-knowledge/concepts/ — engineer's-understanding docs (Dan's directive,
// Aug 2026: concepts, not rules). Loaded fresh into every compile/translation
// prompt so deepening a concept doc applies on the next call, no restart.
const CONCEPTS_DIR = path.join(__dirname, '..', '..', '..', 'jarvis-knowledge', 'concepts');

function loadMeKnowledge() {
  try {
    return fs.readFileSync(KNOWLEDGE_PATH, 'utf8').trim();
  } catch (e) {
    return ''; // knowledge file missing — prompts degrade gracefully
  }
}

/**
 * Concatenate every concept doc in jarvis-knowledge/concepts/ (README
 * excluded — it's for humans). These are ENGINEERING CONCEPTS: mechanism,
 * intent, and judgment written for generalization — the layer that covers
 * stations no template covers. Returns '' when the directory is absent.
 */
function loadConcepts() {
  try {
    const files = fs.readdirSync(CONCEPTS_DIR)
      .filter(f => f.toLowerCase().endsWith('.md') && !/^readme\.md$/i.test(f))
      .sort();
    const parts = [];
    for (const f of files) {
      const body = fs.readFileSync(path.join(CONCEPTS_DIR, f), 'utf8').trim();
      if (body) parts.push(body);
    }
    return parts.join('\n\n---\n\n');
  } catch (e) {
    return ''; // no concepts yet — prompts degrade gracefully
  }
}

/** Significant lowercase words of a fact line (for fuzzy dedupe). */
function factWords(s) {
  return new Set(
    String(s).toLowerCase()
      .replace(/\((\d{4}-\d{2}[^)]*)\)/g, ' ') // strip "(date, who)" attributions
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2)
  );
}

/** True when >70% of the smaller set's words appear in the other. */
function isFuzzyDuplicate(a, b) {
  const wa = factWords(a);
  const wb = factWords(b);
  if (!wa.size || !wb.size) return false;
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size > 0.7;
}

/**
 * Append learned facts to the "## Learned from the MEs" section.
 * Only 'sdc-standard' scoped facts persist; 'this-project' facts are the
 * caller's business. Returns { recorded: [fact...], skipped: [fact...] }.
 */
function appendLearnedFacts(facts, { who = 'ME' } = {}) {
  const out = { recorded: [], skipped: [] };
  const list = (Array.isArray(facts) ? facts : [])
    .filter(f => f && String(f.fact || '').trim() && f.scope === 'sdc-standard')
    .map(f => String(f.fact).trim().replace(/\s+/g, ' '));
  if (!list.length) return out;

  let md;
  try {
    md = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
  } catch (e) {
    return out; // no knowledge file — nothing to append to
  }
  const idx = md.indexOf(LEARNED_HEADING);
  if (idx === -1) return out;

  // Existing learned lines (and everything else) for dedupe — a "learned"
  // fact that merely restates a standing fact elsewhere in the file is also
  // a duplicate.
  const existingLines = md.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2));

  const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
  const additions = [];
  for (const fact of list) {
    const dupe = existingLines.some(l => isFuzzyDuplicate(l, fact))
      || additions.some(l => isFuzzyDuplicate(l, fact));
    if (dupe) { out.skipped.push(fact); continue; }
    const line = `- (${stamp}, ${who}) ${fact}`;
    additions.push(line);
    existingLines.push(fact);
    out.recorded.push(fact);
  }
  if (!additions.length) return out;

  const updated = md.replace(/\s*$/, '') + '\n' + additions.join('\n') + '\n';
  try {
    fs.writeFileSync(KNOWLEDGE_PATH, updated, 'utf8');
  } catch (e) {
    return { recorded: [], skipped: list }; // write failed — report nothing recorded
  }
  return out;
}

module.exports = { loadMeKnowledge, loadConcepts, appendLearnedFacts, isFuzzyDuplicate, KNOWLEDGE_PATH, CONCEPTS_DIR };
