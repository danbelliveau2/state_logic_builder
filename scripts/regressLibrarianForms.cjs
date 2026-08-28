/**
 * regressLibrarianForms.cjs — the two-way channel end-to-end, offline where
 * possible (Word COM is real; the only model call is the answer-pairing one
 * plus the distill of one tiny note).
 *
 *  1. Builds a FILLED submission form (Word COM) + a small note in a local
 *     inbox test subfolder.
 *  2. runLibrarian: form parsed (name/focus/verified), note distilled WITH
 *     the study focus, ledger cites both.
 *  3. writeQuestionsDoc → simulates the CE typing an answer (Word COM) →
 *     checkQuestionsDocs: answer filed cited to the CE, app-queue entry
 *     answered, doc renamed "(answered)".
 *
 * Run: node -r dotenv/config scripts/regressLibrarianForms.cjs
 */
const fs = require('fs');
const path = require('path');
const lib = require('../src/lib/agentGenerator/librarian.js');
const { htmlToDocx, wordExtractText, parseSubmissionForm, writeQuestionsDoc, checkQuestionsDocs, loadState, saveState } = lib._internals;

const ROOT = path.join(__dirname, '..');
const DIR = path.join(lib.LOCAL_INBOX, 'REGRESSION test drop');
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok, extra });

const FILLED_FORM_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<h1>JARVIS SUBMISSION FORM</h1>
<table border="1">
<tr><td>Your name</td><td>Test Engineer</td></tr>
<tr><td>Date</td><td>2026-08-28</td></tr>
<tr><td>Machine / job it came from</td><td>1199 Regression Rig</td></tr>
<tr><td>What’s attached</td><td>gripper-timing-note.md</td></tr>
<tr><td>What should Jarvis study?</td><td>focus on the gripper engage timing for soft parts</td></tr>
<tr><td>Engineer-verified working code?</td><td>NO</td></tr>
<tr><td>Notes</td><td>timing came from floor debug on 1199</td></tr>
</table></body></html>`;

(async () => {
  // ── setup ──────────────────────────────────────────────────────────────────
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  await htmlToDocx(FILLED_FORM_HTML, path.join(DIR, 'SUBMISSION - Test Engineer - 1199.docx'));
  fs.writeFileSync(path.join(DIR, 'gripper-timing-note.md'),
    'Lesson from 1199: on soft parts, the gripper Engage must wait 250ms after the part-present sensor before closing, or the part deforms. Standard hard-part engage needs no delay.\n', 'utf8');

  // parse check (pure)
  const formText = await wordExtractText(path.join(DIR, 'SUBMISSION - Test Engineer - 1199.docx'));
  const ctx = parseSubmissionForm(formText);
  check('form: submitter parsed', /test engineer/i.test(ctx.submitter), ctx.submitter);
  check('form: focus parsed', /gripper engage timing/i.test(ctx.focus), ctx.focus);
  check('form: verified NO parsed', ctx.verified === false, String(ctx.verified));

  // ── the run (form + note; network runs too — that is production behavior) ─
  const r = await lib.runLibrarian({ trigger: 'regression' });
  const ledger = fs.readFileSync(lib.LEDGER_PATH, 'utf8');
  check('run: form ledgered with focus', /submission form from Test Engineer/i.test(ledger) && /gripper engage timing/i.test(ledger));
  check('run: note distilled citing submitter', /gripper-timing-note\.md/.test(ledger) && /submitted by Test Engineer/i.test(ledger));
  check('run: drop moved to _learned', !fs.existsSync(path.join(DIR, 'gripper-timing-note.md')));

  // ── the questions round-trip ───────────────────────────────────────────────
  const state = loadState();
  fs.mkdirSync(DIR, { recursive: true });
  const docPath = await writeQuestionsDoc(state, {
    dir: DIR, submitter: 'Test Engineer',
    questions: [{ question: 'On soft parts, does the 250ms engage delay apply to vacuum grippers too, or only mechanical fingers?', proposedSolution: 'Mechanical only.' }],
    sourceLabel: 'the regression drop',
  });
  saveState(state);
  check('qdoc: written next to the drop', !!docPath && fs.existsSync(docPath), docPath);

  // Simulate the CE typing an answer (Word COM append) — mtime/size change.
  const psq = (s) => String(s).replace(/'/g, "''");
  require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', `
$w = New-Object -ComObject Word.Application; $w.Visible=$false
try {
  $d = $w.Documents.Open('${psq(docPath)}')
  $d.Content.InsertAfter("ANSWER from Test Engineer: mechanical fingers only — vacuum grippers seal instantly, no delay needed.")
  $d.Save(); $d.Close($false)
} finally { $w.Quit() }`], { timeout: 120000 });

  const lines = [];
  const state2 = loadState();
  await checkQuestionsDocs(state2, lines);
  saveState(state2);
  const answeredPath = docPath.replace(/\.docx$/i, ' (answered).docx');
  check('qdoc: answer detected + doc renamed (answered)', fs.existsSync(answeredPath), lines.join(' | '));
  const me = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'meKnowledge.md'), 'utf8');
  check('qdoc: answer filed cited to the engineer', /vacuum grippers seal instantly/i.test(me) && /Test Engineer/.test(me));
  const qs = JSON.parse(fs.readFileSync(path.join(ROOT, 'jarvis-knowledge', 'questions.json'), 'utf8'));
  const qe = qs.find(q => /vacuum grippers too/i.test(q.question ?? ''));
  check('qdoc: app-queue entry marked answered', qe?.status === 'answered' && /Test Engineer/.test(qe?.answeredBy ?? ''));

  // ── report ─────────────────────────────────────────────────────────────────
  let fail = 0;
  for (const x of results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.extra ? ` (${x.extra})` : ''}`); }
  console.log(`\nrun summary: ${JSON.stringify(r.processed?.slice(0, 6) ?? [])}${r.errors?.length ? ' errors: ' + r.errors.join(' | ') : ''}`);
  console.log('\nCLEANUP: leaving the (answered) doc + _learned copies in place as evidence; delete the "REGRESSION test drop" folder when done.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('regression errored:', e); process.exit(2); });
