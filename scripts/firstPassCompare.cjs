/* firstPassCompare.cjs — rung-level diff of the first-pass experiment build
 * against the delivered v7 (which took the 8-round loop to reach).
 * Usage: node scripts/firstPassCompare.cjs <newFile.L5X> */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { diffL5X } = require(path.join(ROOT, 'src/lib/agentGenerator/correctionLearner.js'));

const newFile = process.argv[2];
if (!newFile) { console.error('usage: node scripts/firstPassCompare.cjs <newFile.L5X>'); process.exit(1); }
const v7 = fs.readFileSync(path.join(ROOT, 'JARVIS Deliveries', 'SDCServoPNP_JARVIS_v7.L5X'), 'utf8');
const nu = fs.readFileSync(newFile, 'utf8');

// diffL5X(original, corrected): treat v7 as "original", new build as "corrected"
const { changes, stats } = diffL5X(v7, nu);
const byRoutine = {};
for (const c of changes) {
  const key = c.routine || (c.kind.startsWith('tag-') ? '(tags)' : '(other)');
  (byRoutine[key] = byRoutine[key] || []).push(c);
}
console.log('=== v7 (8-round loop) vs FIRST-PASS build — rung-level diff ===');
console.log('stats:', JSON.stringify(stats));
for (const [rn, list] of Object.entries(byRoutine)) {
  console.log(`\n## ${rn} — ${list.length} difference(s)`);
  for (const c of list) {
    const clip = s => String(s || '').replace(/\s+/g, ' ').slice(0, 260);
    if (c.kind === 'rung-changed') {
      console.log(`- CHANGED${c.comment ? ` [${clip(c.comment).slice(0, 80)}]` : ''}`);
      console.log(`    v7 : ${clip(c.before)}`);
      console.log(`    new: ${clip(c.after)}`);
    } else if (c.kind === 'comment-changed') {
      console.log(`- COMMENT-ONLY: v7 "${clip(c.before).slice(0, 100)}" → new "${clip(c.after).slice(0, 100)}"`);
    } else if (c.kind === 'rung-added') {
      console.log(`- ONLY IN NEW${c.comment ? ` [${clip(c.comment).slice(0, 80)}]` : ''}: ${clip(c.text)}`);
    } else if (c.kind === 'rung-removed') {
      console.log(`- ONLY IN V7${c.comment ? ` [${clip(c.comment).slice(0, 80)}]` : ''}: ${clip(c.text)}`);
    } else {
      console.log(`- ${c.kind.toUpperCase()} ${c.name}: ${clip(c.before || '')}${c.before && c.after ? ' → ' : ''}${clip(c.after || '')}`);
    }
  }
}
