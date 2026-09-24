const fs = require('fs');
const F = "X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\1158_PanduitT066Assembly.L5X";
const xml = fs.readFileSync(F, 'utf8');

// Correct tokenizer: walk <Tag ...> elements one at a time, respecting self-closing vs body form.
const tagOpenRe = /<Tag\s+([^>]*?)(\/)?>/g;
const realTags = []; // {name, selfClosed, start, end}
let m;
while ((m = tagOpenRe.exec(xml))) {
  const attrs = m[1];
  const nameMatch = /Name="([^"]+)"/.exec(attrs);
  const name = nameMatch ? nameMatch[1] : '(unknown)';
  const selfClosed = m[2] === '/';
  let end;
  if (selfClosed) {
    end = tagOpenRe.lastIndex;
  } else {
    const closeIdx = xml.indexOf('</Tag>', tagOpenRe.lastIndex);
    end = closeIdx + '</Tag>'.length;
    tagOpenRe.lastIndex = end; // skip past this tag's real body so nested <Tag-looking content inside Data doesn't confuse us
  }
  realTags.push({ name, selfClosed, start: m.index, end });
}
console.log('Total real <Tag> elements found (correct tokenizer):', realTags.length);
const selfClosedCount = realTags.filter(t => t.selfClosed).length;
console.log('Self-closing tags:', selfClosedCount);

// Now replicate the BUGGY regex the validator uses, and compare which tag NAMES it extracts.
const buggyRe = /<Tag\s+([^>]*)>([\s\S]*?)<\/Tag>/g;
const buggyNames = [];
let bm;
while ((bm = buggyRe.exec(xml))) {
  const nameMatch = /Name="([^"]+)"/.exec(bm[1]);
  buggyNames.push(nameMatch ? nameMatch[1] : '(unknown)');
}
console.log('Tags the buggy regex actually produced entries for:', buggyNames.length);

// Find real tag names that never appear as an entry the buggy regex produced (i.e. were swallowed).
const buggySet = new Set();
const seen = {};
for (const n of buggyNames) { seen[n] = (seen[n]||0)+1; }
const realNames = realTags.map(t => t.name);
const realCounts = {};
for (const n of realNames) { realCounts[n] = (realCounts[n]||0)+1; }
let missingCount = 0;
const missingExamples = [];
for (const [name, count] of Object.entries(realCounts)) {
  const gotCount = seen[name] || 0;
  if (gotCount < count) {
    missingCount += (count - gotCount);
    if (missingExamples.length < 25) missingExamples.push(`${name} (real:${count}, validator-saw:${gotCount})`);
  }
}
console.log('Distinct-name shortfall count (tags the validator under-counted vs real):', missingCount);
console.log('Examples:', missingExamples.join(' | '));
