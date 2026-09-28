// Check every AlarmList STRING tag's L5K data line: the decoded byte length
// (after $xx unescaping) must equal the buffer size declared in the tag's own
// bracketed length prefix — a mismatch is malformed L5K string padding.
// Usage: node scripts/find_bad_alarmlist.cjs <path-to-L5X>
const fs = require('fs');
const F = process.argv[2];
if (!F) { console.error('Usage: node find_bad_alarmlist.cjs <path-to-L5X>'); process.exit(1); }
const xml = fs.readFileSync(F, 'utf8');
const lines = xml.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<Tag Name="AlarmList" TagType="Base" DataType="STRING" Dimensions="10"')) {
    // the L5K data line is usually a couple lines later
    for (let j = i; j < i + 6; j++) {
      const m = /^\s*\],\[(\d+),'([^']*)'/.exec(lines[j]);
      if (m) {
        const declaredLen = Number(m[1]);
        const decoded = m[2].replace(/\$00/g, '\0').length;
        if (decoded !== declaredLen) console.log('MISMATCH at source line', j+1, 'declaredLen', declaredLen, 'decoded', decoded, 'text-ish:', m[2].slice(0,40));
        break;
      }
    }
  }
}
console.log('scan done');
