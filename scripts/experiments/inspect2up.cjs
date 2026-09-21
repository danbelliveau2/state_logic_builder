// Inspect Jason's two-up chassis template: how Chassis/Tracking/HMI/Production/Alarms reference the A/B station programs
const fs = require('fs');
const R = 'generated/1160/ref/ChassisStandard_2UP/';
const read = (f) => fs.readFileSync(R + f, 'utf8');
const rungs = (xml, routine) => {
  const r = xml.match(new RegExp('<Routine Name="' + routine + '"[\\s\\S]*?</Routine>'));
  if (!r) return [];
  return [...r[0].matchAll(/<Rung Number="(\d+)"[\s\S]*?<Text><!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => {
    const c = m[0].match(/<Comment><!\[CDATA\[([\s\S]*?)\]\]>/);
    return { n: m[1], comment: c ? c[1].replace(/\s+/g, ' ').slice(0, 120) : '', text: m[2].replace(/\s+/g, ' ') };
  });
};
const c = read('Program_Chassis.xml'), t = read('Program_Tracking.xml'), h = read('Program_HMI.xml'), p = read('Program_Production.xml'), al = read('Program_Alarms.xml'), s19a = read('Program_S19_GoodUnloadA.xml'), s18a = read('Program_S18_RejectUnloadA.xml');
const progRefs = (xml) => [...new Set([...xml.matchAll(/\\(S\d\d_[A-Za-z0-9]+)\./g)].map(m => m[1]))];
console.log('Chassis refs:', progRefs(c).join(', '));
console.log('Production refs:', progRefs(p).join(', '));
console.log('Alarms refs:', progRefs(al).join(', '));
console.log('HMI refs:', progRefs(h).join(', '));
for (const r of rungs(c, 'R01_Inputs').filter(r => /IndexPermissive|PauseCondition|PauseReason/.test(r.text))) console.log('\nChassis R01 #' + r.n, r.comment, '\n   ', r.text.slice(0, 420));
for (const r of rungs(c, 'R03_CalcDialStationNestNums').slice(0, 3)) console.log('\nChassis R03 #' + r.n, r.comment, '\n   ', r.text.slice(0, 300));
console.log('\nTracking p_ tags:', [...t.matchAll(/<Tag Name="(p_[^"]+)"[^>]*DataType="([^"]+)"/g)].map(m => m[1] + ':' + m[2]).join(', '));
for (const r of rungs(t, 'R05_PartOverallStatus').slice(0, 2)) console.log('\nTracking R05 #' + r.n, r.comment, '\n   ', r.text.slice(0, 500));
for (const r of rungs(t, 'R02_Logic').filter(r => /Increment|NestPerformance/.test(r.text)).slice(0, 3)) console.log('\nTracking R02 #' + r.n, r.comment, '\n   ', r.text.slice(0, 400));
for (const r of rungs(h, 'R02_NestIndicators').slice(0, 2)) console.log('\nHMI R02 #' + r.n, r.comment, '\n   ', r.text.slice(0, 400));
for (const r of rungs(p, 'R01_ProductionData').filter(r => /Increment|Good|Reject/.test(r.text)).slice(0, 3)) console.log('\nProduction R01 #' + r.n, r.comment, '\n   ', r.text.slice(0, 300));
console.log('\nS19_GoodUnloadA params:', [...s19a.matchAll(/<Tag Name="([^"]+)"[^>]*Usage="([^"]+)"/g)].map(m => m[1] + ':' + m[2]).join(', '));
console.log('S18_RejectUnloadA params:', [...s18a.matchAll(/<Tag Name="([^"]+)"[^>]*Usage="([^"]+)"/g)].map(m => m[1] + ':' + m[2]).join(', '));
for (const r of rungs(s19a, 'R02_Logic').slice(0, 4)) console.log('\nS19A R02 #' + r.n, r.comment, '\n   ', r.text.slice(0, 380));
const gsl = read('ControllerTags.xml').match(/<Tag Name="g_StationList"[\s\S]*?<\/Tag>/);
console.log('\ng_StationList seeds:', gsl ? [...gsl[0].matchAll(/'([^']*)'/g)].map(m => m[1]).filter(Boolean).slice(0, 8).join(' | ') : 'none');
