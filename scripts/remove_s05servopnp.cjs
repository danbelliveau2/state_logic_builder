const fs = require("fs");
const F = "X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build\\1158_baseline_from_Matt.L5X";
let xml = fs.readFileSync(F, "utf8");
const before = xml.length;

// 1) remove the whole <Program Name="S05_ServoPNP">...</Program> block
{
  const start = xml.indexOf('<Program Name="S05_ServoPNP" ');
  const end = xml.indexOf('<Program Name="SafetyProgram" ');
  if (start < 0 || end < 0 || end <= start) throw new Error("program block boundaries not found");
  xml = xml.slice(0, start) + xml.slice(end);
}

// 2) remove its ScheduledProgram entry
{
  const marker = '<ScheduledProgram Name="S05_ServoPNP"/>';
  if (!xml.includes(marker)) throw new Error("ScheduledProgram entry not found");
  xml = xml.split(marker).join('');
}

// 3) remove the two dead ParameterConnection lines (find by line, split on newline)
{
  const lines = xml.split('\n');
  const kept = lines.filter((line) => !line.includes('S05_ServoPNP.iq_XAxis') && !line.includes('S05_ServoPNP.iq_ZAxis'));
  const removed = lines.length - kept.length;
  if (removed !== 2) throw new Error('expected to remove 2 ParameterConnection lines, removed ' + removed);
  xml = kept.join('\n');
}

// 4) drop the dead OR-term from both Pause rungs (keep reasons 1/2 only)
{
  const bad = ',XIC(\\S05_ServoPNP.q_Pause) MOVE(3,PauseReason) ';
  const count = xml.split(bad).length - 1;
  if (count !== 2) throw new Error('expected 2 occurrences of the Pause OR-term, found ' + count);
  xml = xml.split(bad).join('');
}

fs.writeFileSync(F, xml);
console.log('removed S05_ServoPNP: file shrank', before - xml.length, 'chars');
