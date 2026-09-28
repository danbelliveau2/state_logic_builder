const fs = require('fs');
const F = process.argv[2];
const lineNo = Number(process.argv[3]);
const lines = fs.readFileSync(F, 'utf8').split('\n');
const line = lines[lineNo - 1];
const m = /\[(\d+),'([^']*)'/.exec(line);
if (!m) { console.log('no match on line', lineNo, line.slice(0,120)); process.exit(1); }
const declaredLen = Number(m[1]);
const body = m[2];
const decoded = body.replace(/\$00/g, '\0');
console.log('declaredLen:', declaredLen, 'raw body chars:', body.length, 'decoded length:', decoded.length);
