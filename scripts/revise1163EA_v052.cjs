'use strict';
// v0.5.2: ConsecFails.Setpoint default 3 in both TubeFeed programs (Jason, 2026-10-30: "The default value for
// ConsecFails.Setpoint is 3 and will be accessible through the HMI."). Cover-note fragments + contract updated.
const fs = require('fs');
const D = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163';
const must = (c, m) => { if (!c) { console.error('!! ' + m); process.exit(1); } };

let x = fs.readFileSync(D + '/1163_Haemonetics.L5X', 'utf8');
const tagRe = /(<Tag Name="ConsecFails" [^>]*>\r?\n<Data Format="L5K">\r?\n<!\[CDATA\[\[0,)0(\]\]\]>[\s\S]*?<DataValueMember Name="Setpoint" DataType="DINT" Radix="Decimal" Value=")0(")/g;
let n = 0;
x = x.replace(tagRe, (m, a, b, c) => { n++; return a + '3' + b + '3' + c; });
must(n === 2, 'ConsecFails tags edited: ' + n);
must((x.match(/<!\[CDATA\[\[0,3\]\]\]>/g) || []).length === 2 && (x.match(/Name="Setpoint" DataType="DINT" Radix="Decimal" Value="3"/g) || []).length === 2, 'values');
fs.writeFileSync(D + '/1163_Haemonetics.L5X', x);
fs.copyFileSync(D + '/1163_Haemonetics.L5X', D + '/_history/1163_Haemonetics_v0.5.2_2026-10-30.L5X');
console.log('L5X: ConsecFails.Setpoint = 3 in both programs');

const B = D + '/build-inputs';
let h = fs.readFileSync(B + '/out/1163_CoverNote_head.html', 'utf8');
if (!h.includes('<tr><td>0.5.2</td>')) {
  const row = `<tr><td>0.5.2</td><td>Oct 30</td><td><code>ConsecFails.Setpoint</code> default 3 in both TubeFeed programs (was 0); the operator changes it on the HMI. Nothing else changed.</td><td>Jason, Oct 30: &ldquo;The default value for ConsecFails.Setpoint is 3 and will be accessible through the HMI.&rdquo;</td></tr>
</table>
<h2>What I was given</h2>`;
  must(/<\/table>\r?\n<h2>What I was given<\/h2>/.test(h), 'head table end');
  h = h.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, row);
  fs.writeFileSync(B + '/out/1163_CoverNote_head.html', h);
}
const mf = B + '/out/1163_CoverNote_meta.json';
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
{
  const e = m.L2_S01_TubeFeedUpstream;
  if (e.notes.includes('when Count &gt; Setpoint, the alarm clears the count.')) {
    e.notes = e.notes.replace('when Count &gt; Setpoint, the alarm clears the count.', 'when Count &gt; Setpoint (default 3, HMI), the alarm clears the count.');
    e.extra.Ask = e.extra.Ask.replace(', 16', '');
  }
}
fs.writeFileSync(mf, JSON.stringify(m, null, 2));
let b = fs.readFileSync(B + '/out/1163_CoverNote_back.html', 'utf8');
if (!b.includes('Closed: ConsecFails.Setpoint')) {
  const before = b;
  b = b.replace(/<tr><td>16<\/td><td>[\s\S]*?<\/td><td>Jason<\/td><\/tr>/, '<tr><td>16</td><td>Closed: ConsecFails.Setpoint default 3, operator-adjustable on the HMI (Jason, 0.5.2).</td><td>&ndash;</td></tr>');
  must(b !== before, 'ask 16 row');
  fs.writeFileSync(B + '/out/1163_CoverNote_back.html', b);
}
const cf = B + '/plan/NAMES_CONTRACT_L2S01_EA.md';
let c = fs.readFileSync(cf, 'utf8');
if (!c.includes('(0.5.2)')) { c = c.trimEnd() + '\nJason 2026-10-30 (0.5.2): `ConsecFails.Setpoint` default 3, HMI-adjustable; ask 16 closed.\n'; fs.writeFileSync(cf, c); }
console.log('fragments + contract updated for 0.5.2');
