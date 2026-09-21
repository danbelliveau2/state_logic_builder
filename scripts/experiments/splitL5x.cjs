#!/usr/bin/env node
// Split an L5X into reference pieces agents can Read one at a time:
//   00_header.xml            everything before <DataTypes> (RSLogix5000Content + Controller attrs)
//   DataTypes.xml, Modules.xml, AddOnInstructionDefinitions.xml, Tasks.xml, ParameterConnections.xml, ...
//   ControllerTags.xml       the controller-scope <Tags> block (the one directly under <Controller>)
//   Program_<Name>.xml       one file per <Program>
//   INDEX.txt                file list with sizes + per-program routine list
// usage: node scripts/experiments/splitL5x.cjs <in.L5X> <outDir>
const fs = require('fs'); const path = require('path');
const [, , inFile, outDir] = process.argv;
if (!inFile || !outDir) { console.error('usage: splitL5x.cjs <in.L5X> <outDir>'); process.exit(2); }
const x = fs.readFileSync(inFile, 'utf8');
fs.mkdirSync(outDir, { recursive: true });
const write = (name, body) => fs.writeFileSync(path.join(outDir, name), body);
const section = (tag) => { const a = x.indexOf('<' + tag + '>'); const a2 = x.indexOf('<' + tag + ' '); const start = [a, a2].filter(i => i >= 0).sort((p, q) => p - q)[0]; if (start === undefined) return null; const end = x.indexOf('</' + tag + '>', start); return end < 0 ? null : x.slice(start, end + tag.length + 3); };
const dt = x.indexOf('<DataTypes'); write('00_header.xml', x.slice(0, dt > 0 ? dt : 3000));
for (const t of ['DataTypes', 'Modules', 'AddOnInstructionDefinitions', 'Tasks', 'ParameterConnections', 'CST', 'WallClockTime', 'Trends', 'DataLogs', 'TimeSynchronize', 'SafetyInfo', 'RedundancyInfo', 'Security']) { const s = section(t); if (s) write(t + '.xml', s); }
// controller-scope tags: the <Tags> that follows </AddOnInstructionDefinitions> (or </Modules>) and precedes <Programs>
const progsAt = x.indexOf('<Programs>');
const aoiEnd = x.indexOf('</AddOnInstructionDefinitions>');
const tagsStart = x.indexOf('<Tags', aoiEnd > 0 ? aoiEnd : 0);
if (tagsStart > 0 && tagsStart < progsAt) { const tagsEnd = x.indexOf('</Tags>', tagsStart); write('ControllerTags.xml', x.slice(tagsStart, tagsEnd + 7)); }
const index = [];
// Name may not be the first attribute (partial exports write <Program Use="Target" Name=...>); \sName= keeps MainRoutineName out
const progRe = /<Program\b[^>]*?\sName="([^"]+)"[^>]*>[\s\S]*?<\/Program>/g; let m; let n = 0;
while ((m = progRe.exec(x))) { n++; write('Program_' + m[1] + '.xml', m[0]); const routines = [...m[0].matchAll(/<Routine Name="([^"]+)"/g)].map(r => r[1]); const tags = (m[0].match(/<Tag Name=/g) || []).length; const params = (m[0].match(/Usage="(Input|Output|InOut|Public)"/g) || []).length; index.push(`Program_${m[1]}.xml  ${m[0].length} bytes  tags=${tags} params=${params}  routines: ${routines.join(', ')}`); }
for (const f of fs.readdirSync(outDir)) if (!f.startsWith('Program_') && f !== 'INDEX.txt') index.unshift(`${f}  ${fs.statSync(path.join(outDir, f)).size} bytes`);
write('INDEX.txt', `source: ${inFile}\n${index.join('\n')}\n`);
console.log(`${path.basename(inFile)}: ${n} programs → ${outDir}`);
