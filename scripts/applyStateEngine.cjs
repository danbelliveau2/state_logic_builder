'use strict';
// Bring an L5X up to the current State_Engine_128Max standard (Jason, 2026-10-26):
//   - replaces the State_Engine_128Max AOI definition
//   - replaces the StateLogicStatus UDT (adds StateDuration DINT[128])
//   - widens the data of every StateLogicStatus tag and every AOI instance tag
// Source of truth: plc-reference/standard/aoi/{State_Engine_128Max,StateLogicStatus}.L5X
//
// usage: node scripts/applyStateEngine.cjs <in.L5X> [--out <out.L5X>] [--check]
//   --check  report only, write nothing (exit 1 when the file is behind the standard)

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const inFile = args.find(a => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : inFile;
const checkOnly = args.includes('--check');
if (!inFile) { console.error('usage: node scripts/applyStateEngine.cjs <in.L5X> [--out <out.L5X>] [--check]'); process.exit(2); }

const STD = path.join(__dirname, '..', 'plc-reference', 'standard', 'aoi');
const stdAoiFile = fs.readFileSync(path.join(STD, 'State_Engine_128Max.L5X'), 'utf8');
const stdUdtFile = fs.readFileSync(path.join(STD, 'StateLogicStatus.L5X'), 'utf8');

const AOI_RE = /<AddOnInstructionDefinition [^>]*Name="State_Engine_128Max"[^>]*>[\s\S]*?<\/AddOnInstructionDefinition>/;
const UDT_RE = /<DataType [^>]*Name="StateLogicStatus"[^>]*>[\s\S]*?<\/DataType>/;

const stdAoi = (stdAoiFile.match(AOI_RE) || [])[0];
const stdUdt = (stdUdtFile.match(UDT_RE) || [])[0];
if (!stdAoi || !stdUdt) { console.error('standard AOI/UDT not found under ' + STD); process.exit(2); }
const noTarget = s => s.replace(' Use="Target"', '');

const ZEROS = Array(128).fill('0').join(',');
const DEC_ARRAY = '<ArrayMember Name="StateDuration" DataType="DINT" Dimensions="128" Radix="Decimal">\n'
  + Array.from({ length: 128 }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n')
  + '\n</ArrayMember>';

let xml = fs.readFileSync(inFile, 'utf8');
const report = { aoi: 'absent', udt: 'absent', statusTags: 0, statusTagsCurrent: 0, engineTags: 0, engineTagsCurrent: 0 };

// 1. AOI definition
if (AOI_RE.test(xml)) {
  const cur = xml.match(AOI_RE)[0];
  const curDate = (cur.match(/EditedDate="([^"]+)"/) || [])[1];
  const stdDate = (stdAoi.match(/EditedDate="([^"]+)"/) || [])[1];
  if (curDate === stdDate) report.aoi = 'current';
  else { xml = xml.replace(AOI_RE, () => noTarget(stdAoi)); report.aoi = `replaced (${curDate} -> ${stdDate})`; }
}

// 2. UDT
if (UDT_RE.test(xml)) {
  const cur = xml.match(UDT_RE)[0];
  if (/Member Name="StateDuration"/.test(cur)) report.udt = 'current';
  else { xml = xml.replace(UDT_RE, () => noTarget(stdUdt)); report.udt = 'replaced'; }
}

// 3. Tags of type StateLogicStatus (program Status tags, any InOut/Public copies)
xml = xml.replace(/<Tag [^>]*DataType="StateLogicStatus"[^>]*>[\s\S]*?<\/Tag>/g, tag => {
  if (/Name="StateDuration"/.test(tag)) { report.statusTagsCurrent++; return tag; }
  if (/Dimensions=/.test(tag.split('\n')[0])) { console.warn('array of StateLogicStatus not handled: ' + tag.split('\n')[0]); return tag; }
  let t = tag.replace(/\],(-?\d+),(-?\d+)\]\]\]>/, (m, p, q) => `],${p},${q},[${ZEROS}]]]]>`);
  t = t.replace(/(<DataValueMember Name="TransitionTimerDone" DataType="BOOL" Value="0"\/>)\r?\n<\/Structure>/, `$1\n${DEC_ARRAY}\n</Structure>`);
  if (t === tag) { console.warn('StateLogicStatus tag data not recognised: ' + tag.split('\n')[0]); return tag; }
  report.statusTags++;
  return t;
});

// 4. AOI instance tags (localStatus is the 6th element of the L5K: [EnableIn,[timer],i,prev,[timer],[status],size])
xml = xml.replace(/<Tag [^>]*DataType="State_Engine_128Max"[^>]*>[\s\S]*?<\/Tag>/g, tag => {
  // localStatus is [[128 bools],PreviousState,bits(,[128 durations])] followed by HistoryArraySize
  if (/\],-?\d+,-?\d+,\[[-\d,\s]*\]\],-?\d+\]\]\]>/.test(tag)) { report.engineTagsCurrent++; return tag; }
  const t = tag.replace(/\],(-?\d+),(-?\d+)\],(-?\d+)\]\]\]>/, (m, p, q, s) => `],${p},${q},[${ZEROS}]],${s}]]]>`);
  if (t === tag) { console.warn('State_Engine_128Max tag data not recognised: ' + tag.split('\n')[0]); return tag; }
  report.engineTags++;
  return t;
});

const behind = /replaced/.test(report.aoi) || report.udt === 'replaced' || report.statusTags || report.engineTags;
console.log(`${path.basename(inFile)}: AOI ${report.aoi}; UDT ${report.udt}; Status tags widened ${report.statusTags} (current ${report.statusTagsCurrent}); engine tags widened ${report.engineTags} (current ${report.engineTagsCurrent})`);
if (checkOnly) process.exit(behind ? 1 : 0);
if (behind) { fs.writeFileSync(outFile, xml); console.log('written ' + outFile); }
else console.log('already current, nothing written');
