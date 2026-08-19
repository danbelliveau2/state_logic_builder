/**
 * seedJarvisQuestions.cjs — seed jarvis-knowledge/questions.json from the
 * "Questions for the Controls Leads" section of
 * docs/SDC_PROGRAMMING_STANDARD_DRAFT.md.
 *
 * Idempotent: skips any question whose text already exists in the queue
 * (exact match after whitespace normalization). Never touches answered or
 * dismissed entries. GOLDEN_GAPS.md and the docx review items are NOT parsed
 * here (docx parsing is out of scope) — this covers the standards-draft set.
 *
 * Run: node scripts/seedJarvisQuestions.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRAFT = path.join(ROOT, 'docs', 'SDC_PROGRAMMING_STANDARD_DRAFT.md');
const OUT_DIR = path.join(ROOT, 'jarvis-knowledge');
const OUT = path.join(OUT_DIR, 'questions.json');

function normalize(s) { return String(s).replace(/\s+/g, ' ').trim(); }

function parseDraftQuestions() {
  const md = fs.readFileSync(DRAFT, 'utf8');
  const idx = md.indexOf('# Questions for the Controls Leads');
  if (idx === -1) throw new Error('Questions section not found in ' + DRAFT);
  const section = md.slice(idx);
  const questions = [];
  // Numbered items: "1. **Bold lead**: rest..." possibly wrapping lines until
  // the next numbered item or a blank/structural line.
  const lines = section.split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      if (current) questions.push(current);
      current = m[2];
    } else if (current !== null) {
      if (/^\s*$/.test(line) || /^\*\*Also requested/.test(line) || /^#/.test(line)) {
        questions.push(current);
        current = null;
      } else {
        current += ' ' + line.trim();
      }
    }
  }
  if (current) questions.push(current);
  // Strip markdown bold/italics markers, keep the text.
  return questions.map(q => normalize(q.replace(/\*\*/g, '').replace(/`/g, '')));
}

function main() {
  const parsed = parseDraftQuestions();
  if (!parsed.length) throw new Error('No questions parsed');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) {}
  if (!Array.isArray(existing)) existing = [];
  const existingTexts = new Set(existing.map(q => normalize(q.question || '')));

  let added = 0;
  const askedAt = new Date().toISOString();
  for (const [i, question] of parsed.entries()) {
    if (existingTexts.has(question)) continue;
    existing.push({
      id: `seed_std_draft_${String(i + 1).padStart(2, '0')}`,
      question,
      context: 'Standards draft review',
      source: 'manual',
      askedAt,
      status: 'open',
    });
    added++;
  }

  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(existing, null, 2), 'utf8');
  fs.renameSync(tmp, OUT);
  console.log(`Parsed ${parsed.length} questions from standards draft; added ${added}; queue now ${existing.length}.`);
}

main();
