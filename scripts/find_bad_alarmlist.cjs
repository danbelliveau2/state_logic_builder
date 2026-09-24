const fs = require('fs');
const F = "X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build\\1158_assembled.L5X";
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
        if (decoded !== 82) console.log('MISMATCH at source line', j+1, 'declaredLen', declaredLen, 'decoded', decoded, 'text-ish:', m[2].slice(0,40));
        break;
      }
    }
  }
}
console.log('scan done');
