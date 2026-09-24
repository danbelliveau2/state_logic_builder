const fs = require('fs');
const F = "X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\1158_PanduitT066Assembly.L5X";
const xml = fs.readFileSync(F, 'utf8');

// collect Safety-class controller-scope tag names (only top-level <Tags>, before <Programs>)
const programsIdx = xml.indexOf('<Programs>');
const controllerScope = xml.slice(0, programsIdx);
const safetyTags = new Set();
for (const m of controllerScope.matchAll(/<Tag Name="([^"]+)" Class="Safety"/g)) safetyTags.add(m[1]);
console.log('Safety-class controller tags:', [...safetyTags].join(', '));

// find each Program block with its Class attribute
const progRe = /<Program Name="([^"]+)"[^>]*Class="([^"]+)"[^>]*>([\s\S]*?)<\/Program>/g;
let m;
while ((m = progRe.exec(xml))) {
  const [, name, cls, body] = m;
  if (cls !== 'Standard') continue;
  for (const tag of safetyTags) {
    const re = new RegExp('[^A-Za-z0-9_]' + tag + '[^A-Za-z0-9_]');
    if (re.test(body)) {
      console.log(`Standard program "${name}" references Safety tag "${tag}"`);
    }
  }
}
console.log('scan done');
