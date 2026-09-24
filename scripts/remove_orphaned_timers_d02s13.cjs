const fs = require('fs');
const F = "X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build\\programs\\D02S13_MetalLoad.xml";
let xml = fs.readFileSync(F, 'utf8');
const before = xml.length;
const names = ['AlarmTimerShooterExtend','AlarmTimerShooterRetract','AlarmTimerRingToLoad','AlarmTimerRingToPick','AlarmTimerInsertionToolExtend','AlarmTimerInsertionToolRetract','AlarmTimerBackupToolExtend','AlarmTimerBackupToolRetract'];
for (const name of names) {
  const re = new RegExp('<Tag Name="' + name + '"[^>]*>[\\s\\S]*?</Tag>\\n?');
  const m = xml.match(re);
  if (!m) throw new Error('tag block not found for ' + name);
  xml = xml.replace(re, '');
}
fs.writeFileSync(F, xml);
console.log('removed 8 orphaned timer tags, file shrank', before - xml.length, 'chars');
