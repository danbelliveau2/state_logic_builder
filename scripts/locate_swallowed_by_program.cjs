// Pinpoint which <Program> each swallowed tag (see find_swallowed_tags.cjs) falls in.
// Usage: node scripts/locate_swallowed_by_program.cjs <path-to-L5X>
const fs = require('fs');
const F = process.argv[2];
if (!F) { console.error('Usage: node locate_swallowed_by_program.cjs <path-to-L5X>'); process.exit(1); }
const xml = fs.readFileSync(F, 'utf8');

// program boundaries
const progRe = /<Program Name="([^"]+)"/g;
const progs = [];
let pm;
while ((pm = progRe.exec(xml))) progs.push({ name: pm[1], start: pm.index });
function programAt(idx) {
  let owner = '(controller scope)';
  for (const p of progs) { if (p.start <= idx) owner = p.name; else break; }
  return owner;
}

// correct tokenizer again, but this time record self-closing tag + the tag immediately following it
const tagOpenRe = /<Tag\s+([^>]*?)(\/)?>/g;
let m;
let prevSelfClosed = null;
while ((m = tagOpenRe.exec(xml))) {
  const attrs = m[1];
  const nameMatch = /Name="([^"]+)"/.exec(attrs);
  const name = nameMatch ? nameMatch[1] : '(unknown)';
  const selfClosed = m[2] === '/';
  const idx = m.index;
  if (prevSelfClosed) {
    console.log(`swallowed: "${name}" (in ${programAt(idx)}) — preceded by self-closed "${prevSelfClosed.name}" (in ${programAt(prevSelfClosed.idx)})`);
  }
  if (!selfClosed) {
    const closeIdx = xml.indexOf('</Tag>', tagOpenRe.lastIndex);
    tagOpenRe.lastIndex = closeIdx + '</Tag>'.length;
    prevSelfClosed = null;
  } else {
    prevSelfClosed = { name, idx };
  }
}
