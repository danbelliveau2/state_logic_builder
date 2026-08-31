/**
 * makeSubmissionForm.cjs — generates `SUBMISSION FORM.docx` for the JARVIS
 * Inbox (Dan, 2026-08-28: "they can give you specific information onto what
 * to study and what to ultimately put in your memory bank").
 *
 * One page, SDC plain speech. HTML → Word COM (Documents.Open → SaveAs
 * wdFormatXMLDocument=16). Writes to the LOCAL inbox root; the librarian
 * copies it to the network inbox root on its next run (and this script also
 * tries the network root directly).
 *
 * Run: node scripts/makeSubmissionForm.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCAL_INBOX = path.join(ROOT, 'SDC Engineer Inbox');
const NET_INBOX = '\\\\stevendouglas.local\\dfs\\Company\\Engineering\\Electrical Dept\\SDC Engineer Inbox';

const FIELD = (label, hint, lines = 1) =>
  `<tr><td class="lbl">${label}</td><td class="val">${'<div class="line">&nbsp;</div>'.repeat(lines)}<div class="hint">${hint}</div></td></tr>`;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { font-family: Calibri, sans-serif; font-size: 11pt; margin: 0.6in; color: #1a2733; }
  h1 { font-size: 16pt; margin: 0 0 2pt; color: #0f4c81; }
  .sub { font-size: 10pt; color: #4a5a6a; margin-bottom: 14pt; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 6pt 8pt; border: 1pt solid #b8c4d0; }
  td.lbl { width: 175pt; font-weight: bold; background: #eef3f8; }
  .line { border-bottom: 1pt solid #8a99a8; height: 14pt; margin-bottom: 3pt; }
  .hint { font-size: 8.5pt; color: #6a7a8a; margin-top: 2pt; }
  .yn { font-size: 11pt; }
  .foot { font-size: 9pt; color: #4a5a6a; margin-top: 12pt; }
</style></head><body>
<h1>SDC ENGINEER SUBMISSION FORM</h1>
<div class="sub">Feeding the department's AI controls engineer — copy this form, fill it in,
and drop it in the SDC Engineer Inbox <b>next to your files</b> (a subfolder for your drop keeps things tidy).
Save it with SUBMISSION in the name, e.g. <b>SUBMISSION - JSmith - 1119 robot.docx</b>.</div>
<table>
${FIELD('Your name', 'so the SDC Engineer can cite you — and write back if he has questions')}
${FIELD('Date', '')}
${FIELD('Machine / job it came from', 'e.g. 1119 Stamper, 1116 Molex')}
${FIELD('What’s attached', 'the files you dropped beside this form', 2)}
<tr><td class="lbl">What should the SDC Engineer study?</td><td class="val">
  <div class="line">&nbsp;</div><div class="line">&nbsp;</div><div class="line">&nbsp;</div>
  <div class="hint">the important part — point him at it: &ldquo;focus on the robot integration&rdquo;,
  &ldquo;the DC linear indexing conveyor&rdquo;, &ldquo;the laser marker handshake&rdquo;.
  This rides his study of every attached file and is cited in what he learns.</div>
</td></tr>
<tr><td class="lbl">Engineer-verified working code?</td><td class="val">
  <span class="yn">YES&nbsp;&nbsp;/&nbsp;&nbsp;NO&nbsp;&nbsp;&nbsp;(circle or delete one)</span>
  <div class="hint">YES = this code ran on a real machine and an engineer confirms it correct.
  Verified code ranks as a top exemplar the SDC Engineer writes new code from &mdash; only say YES when it&rsquo;s true.</div>
</td></tr>
${FIELD('Notes', 'anything else — quirks, what went wrong on the floor, what you’d do differently', 3)}
</table>
<div class="foot">What happens next: the SDC Engineer reads your drop on his daily pass (your files stay put on the network).
What he learned — and the citation to you — lands in his knowledge ledger. If he has questions, a
<b>&ldquo;Questions from Jarvis&rdquo;</b> document appears next to your files: type answers under each
question and he reads them on his next pass.</div>
</body></html>`;

function main() {
  const tmpHtml = path.join(os.tmpdir(), 'jarvis-submission-form.html');
  const tmpDocx = path.join(os.tmpdir(), 'jarvis-submission-form.docx');
  fs.writeFileSync(tmpHtml, HTML, 'utf8');
  try { fs.unlinkSync(tmpDocx); } catch (_) {}
  const ps = `
$w = New-Object -ComObject Word.Application; $w.Visible = $false
try {
  $d = $w.Documents.Open('${tmpHtml.replace(/'/g, "''")}')
  $d.SaveAs([ref]'${tmpDocx.replace(/'/g, "''")}', [ref]16)
  $d.Close($false)
} finally { $w.Quit() }`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 120000 });
  if (!fs.existsSync(tmpDocx)) throw new Error('Word COM produced no docx');
  const targets = [path.join(LOCAL_INBOX, 'SUBMISSION FORM.docx')];
  try { if (fs.existsSync(NET_INBOX)) targets.push(path.join(NET_INBOX, 'SUBMISSION FORM.docx')); } catch (_) {}
  for (const t of targets) {
    try { fs.copyFileSync(tmpDocx, t); console.log('wrote', t); }
    catch (e) { console.warn('could not write', t, '-', e.message); }
  }
}
main();
