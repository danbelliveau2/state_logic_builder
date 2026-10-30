'use strict';
// returnIntake — one run per file the CE sends back (Jason, 2026-10-30: "speed me up without losing learnings").
//
//   node scripts/returnIntake.cjs --job 1163 --returned "C:\1163 AI Code\_1163_Haemonetics.L5X" --version 0.5.1 --base 0.5
//        [--quote "here is a corrected copy."] [--row "<what changed, html>"] [--apply scripts/twin1163_v051.cjs]
//        [--dry] [--no-cover] [--no-deliver]
//
// Always: splits the returned file and the stamped baseline, diffs them program by program and rung by rung,
// writes build-inputs/out/intake_v<version>.md, runs the gates (import simulation vs the baseline, state engine,
// shape lint on the changed station programs, the job's regression script).
// Then the LESSON GATE: lessons.md must carry a line dated today for this job and version (or "v<base> returned").
// Without it the run stops there - read the diff, write the rules, run again. With it: stamp the returned file
// (_v<base>_returned_<date>), copy it to the delivery (optional --apply script runs on the delivery), stamp the
// delivery (_v<version>_<date>), add the revision row, regenerate and convert the cover note, stamp the docx.
// Per-job settings: Deliveries/<job>/build-inputs/intake.json  { machine, title, programs, shapeLintPrograms, lessons, regress }.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = k => argv.includes('--' + k);
const JOB = argOf('job'); const RETURNED = argOf('returned'); const VERSION = argOf('version'); const BASE = argOf('base');
if (!JOB || !RETURNED || !VERSION || !BASE) { console.error('usage: --job <n> --returned <L5X> --version <new> --base <stamped version> [--quote ..] [--row ..] [--apply ..] [--dry] [--no-cover] [--no-deliver]'); process.exit(2); }
const DRY = flag('dry'), NO_COVER = flag('no-cover'), NO_DELIVER = flag('no-deliver');

const D = `X:/Electrical Dept/SDC Engineer/Deliveries/${JOB}`;
const B = D + '/build-inputs', H = D + '/_history', OUT = B + '/out';
const cfg = JSON.parse(fs.readFileSync(B + '/intake.json', 'utf8'));
const M = cfg.machine;
const today = new Date();
const iso = today.toISOString().slice(0, 10);
const short = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const baseFiles = fs.readdirSync(H).filter(f => new RegExp('^' + esc(M) + '_v' + esc(BASE) + '_\\d{4}-\\d{2}-\\d{2}\\.L5X$').test(f)).sort();
if (!baseFiles.length) { console.error('no stamp for v' + BASE + ' in ' + H); process.exit(2); }
const BASEFILE = H + '/' + baseFiles[baseFiles.length - 1];
const read = f => fs.readFileSync(f, 'utf8');
const A = read(BASEFILE), R = read(RETURNED);
const exportDate = x => (x.match(/ExportDate="([^"]+)"/) || [])[1];

// ── parsing ──────────────────────────────────────────────────────────────────
const programsOf = xml => { const m = new Map(); for (const p of xml.matchAll(/<Program\b[^>]*\bName="([^"]+)"[\s\S]*?<\/Program>/g)) m.set(p[1], p[0]); return m; };
const routinesOf = prog => { const m = new Map(); for (const r of prog.matchAll(/<Routine\b[^>]*\bName="([^"]+)"[\s\S]*?<\/Routine>/g)) m.set(r[1], r[0]); return m; };
const rungsOf = routine => [...routine.matchAll(/<Rung Number="(\d+)"[^>]*>([\s\S]*?)<\/Rung>/g)].map(r => ({
  n: +r[1],
  comment: ((r[2].match(/<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || '').trim(),
  text: ((r[2].match(/<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1] || '').replace(/\s+/g, ' ').trim(),
}));
const tagsOf = prog => { const m = new Map(); const sec = (prog.match(/<Tags>([\s\S]*?)<\/Tags>/) || [])[1] || ''; for (const t of sec.matchAll(/<Tag\b[^>]*\bName="([^"]+)"[\s\S]*?<\/Tag>|<Tag\b[^>]*\bName="([^"]+)"[^>]*\/>/g)) m.set(t[1] || t[2], t[0].replace(/\s+/g, ' ')); return m; };
const stateCommentsOf = prog => { const m = new Map(); for (const c of prog.matchAll(/<Comment Operand="\.STATE\[(\d+)\]">\s*<!\[CDATA\[([\s\S]*?)\]\]>/gi)) m.set(+c[1], c[2].trim()); return m; };
const sectionOf = (xml, name) => { const s = xml.indexOf('<' + name + '>'), e = xml.indexOf('</' + name + '>'); return s >= 0 && e > s ? xml.slice(s, e) : ''; };
const lineSetDiff = (a, b) => { const sa = a.split(/\r?\n/).map(l => l.trim()).filter(Boolean), sb = b.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const cb = new Map(); for (const l of sb) cb.set(l, (cb.get(l) || 0) + 1); const ca = new Map(); for (const l of sa) ca.set(l, (ca.get(l) || 0) + 1); const onlyA = sa.filter(l => { const k = cb.get(l) || 0; if (k) { cb.set(l, k - 1); return false; } return true; }); const onlyB = sb.filter(l => { const k = ca.get(l) || 0; if (k) { ca.set(l, k - 1); return false; } return true; }); return { onlyA, onlyB }; };

// ── diff ─────────────────────────────────────────────────────────────────────
const rep = [];
const line = s => rep.push(s);
line(`# ${JOB} intake v${VERSION} (${iso})`);
line('');
line(`| | file | export |`); line(`|---|---|---|`);
line(`| baseline v${BASE} | ${BASEFILE} | ${exportDate(A)} |`);
line(`| returned | ${RETURNED} | ${exportDate(R)} |`);
line('');
const PA = programsOf(A), PR = programsOf(R);
const changedPrograms = [];
for (const name of [...PA.keys()].filter(k => !PR.has(k))) line(`- program removed: **${name}**`);
for (const name of [...PR.keys()].filter(k => !PA.has(k))) { line(`- program added: **${name}**`); changedPrograms.push(name); }
for (const [name, pa] of PA) {
  const pr = PR.get(name); if (!pr) continue;
  if (pa.replace(/\s+/g, ' ') === pr.replace(/\s+/g, ' ')) continue;
  changedPrograms.push(name);
  line(`## ${name}`);
  const ta = tagsOf(pa), tr = tagsOf(pr);
  for (const t of [...tr.keys()].filter(k => !ta.has(k))) line(`- tag added: \`${t}\` ${(tr.get(t).match(/DataType="([^"]+)"/) || [])[1] || ''}`);
  for (const t of [...ta.keys()].filter(k => !tr.has(k))) line(`- tag removed: \`${t}\``);
  for (const t of [...ta.keys()].filter(k => tr.has(k) && tr.get(k) !== ta.get(k))) line(`- tag data changed: \`${t}\``);
  const sa = stateCommentsOf(pa), sr = stateCommentsOf(pr);
  for (const n of new Set([...sa.keys(), ...sr.keys()])) if (sa.get(n) !== sr.get(n)) line(`- state ${n} name: "${sa.get(n) || '(none)'}" -> "${sr.get(n) || '(none)'}"`);
  const ra = routinesOf(pa), rr = routinesOf(pr);
  for (const [rn, routA] of ra) {
    const routR = rr.get(rn); if (!routR) { line(`- routine removed: ${rn}`); continue; }
    const xa = rungsOf(routA), xr = rungsOf(routR);
    const byText = arr => { const m = new Map(); for (const r of arr) { if (!m.has(r.text)) m.set(r.text, []); m.get(r.text).push(r); } return m; };
    const ma = byText(xa), mr = byText(xr);
    const items = [];
    for (const [text, list] of ma) {
      const other = mr.get(text) || [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = other[i];
        if (!b) items.push({ k: a.n, s: `  - rung ${a.n} removed: \`${a.text.slice(0, 220)}\`` });
        else { if (a.comment !== b.comment) items.push({ k: a.n, s: `  - rung ${a.n}${a.n !== b.n ? ' -> ' + b.n : ''} comment: "${a.comment}" -> "${b.comment}"` }); else if (a.n !== b.n) items.push({ k: a.n, s: `  - rung ${a.n} -> ${b.n} (moved)` }); }
      }
    }
    for (const [text, list] of mr) { const other = ma.get(text) || []; for (let i = other.length; i < list.length; i++) items.push({ k: list[i].n + 0.5, s: `  - rung ${list[i].n} added${list[i].comment ? ' "' + list[i].comment + '"' : ''}: \`${list[i].text.slice(0, 220)}\`` }); }
    // a block of consecutive rungs shifted by one offset is one line, not one per rung
    const moves = items.filter(it => /\(moved\)$/.test(it.s)).sort((p, q) => p.k - q.k);
    const grouped = [];
    for (const it of moves) {
      const [, from, to] = it.s.match(/rung (\d+) -> (\d+)/).map(Number);
      const g = grouped[grouped.length - 1];
      if (g && from === g.from0 + g.len && to - from === g.delta) g.len++;
      else grouped.push({ k: it.k, from0: from, len: 1, delta: to - from });
    }
    const rest = items.filter(it => !/\(moved\)$/.test(it.s));
    for (const g of grouped) rest.push({ k: g.k, s: g.len === 1 ? `  - rung ${g.from0} -> ${g.from0 + g.delta} (moved)` : `  - rungs ${g.from0}-${g.from0 + g.len - 1} shifted ${g.delta > 0 ? '+' : ''}${g.delta}` });
    if (rest.length) { line(`- ${rn}`); for (const it of rest.sort((p, q) => p.k - q.k)) line(it.s); }
  }
  for (const rn of [...rr.keys()].filter(k => !ra.has(k))) line(`- routine added: ${rn}`);
  line('');
}
const ctrlSections = ['DataTypes', 'AddOnInstructionDefinitions', 'Modules', 'Tags', 'ParameterConnections', 'Tasks'];
const ctrlChanges = [];
for (const s of ctrlSections) {
  const a = s === 'Tags' ? sectionOf(A.slice(0, A.indexOf('<Programs')), 'Tags') : sectionOf(A, s);
  const r = s === 'Tags' ? sectionOf(R.slice(0, R.indexOf('<Programs')), 'Tags') : sectionOf(R, s);
  const { onlyA, onlyB } = lineSetDiff(a, r);
  if (onlyA.length || onlyB.length) { ctrlChanges.push(s); line(`## controller ${s}: ${onlyA.length} line(s) gone, ${onlyB.length} new`); for (const l of onlyA.slice(0, 6)) line(`  - gone: \`${l.slice(0, 200)}\``); for (const l of onlyB.slice(0, 6)) line(`  - new: \`${l.slice(0, 200)}\``); line(''); }
}
if (!changedPrograms.length && !ctrlChanges.length) line('_No logic or tag differences; header only._');

// ── gates ────────────────────────────────────────────────────────────────────
const run = (args, opts = {}) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...opts }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
line('## gates');
fs.mkdirSync(OUT, { recursive: true });
const v = run(['scripts/validate1160.cjs', RETURNED, '--baseline', BASEFILE, '--json', `${OUT}/intake_v${VERSION}.validate.json`]);
const verdict = (v.out.match(/VERDICT: [^\n]*/) || ['VERDICT: (none)'])[0].trim();
const newVs = (v.out.match(/NEW vs baseline: [^\n]*/) || [''])[0].trim();
line(`- import simulation: ${verdict}${newVs ? ' — ' + newVs : ''}`);
const e = run(['scripts/applyStateEngine.cjs', RETURNED, '--check']);
line(`- state engine: ${e.code === 0 ? 'current' : 'BEHIND'} — ${e.out.trim().split('\n')[0]}`);
const lintProgs = changedPrograms.filter(p => new RegExp(cfg.shapeLintPrograms).test(p));
if (lintProgs.length) {
  const dir = path.join(ROOT, 'generated', JOB, 'build', 'programs'); fs.mkdirSync(dir, { recursive: true });
  const files = lintProgs.map(p => { const f = path.join(dir, p + '.xml'); fs.writeFileSync(f, PR.get(p)); return f; });
  const l = run(['scripts/shapeLint.cjs', ...files]);
  line(`- shape lint (${lintProgs.join(', ')}): ${(l.out.match(/shapeLint[^\n]*/) || [l.out.trim().split('\n').pop()])[0].trim()}`);
} else line('- shape lint: no station programs changed');
if (cfg.regress && fs.existsSync(path.join(ROOT, cfg.regress))) { const g = run([cfg.regress]); line(`- regression ${cfg.regress}: ${g.code === 0 ? 'pass' : 'FAIL'} — ${g.out.trim().split('\n').pop()}`); }
const gatesOk = /PASS/.test(verdict) && e.code === 0;

// ── lesson gate ──────────────────────────────────────────────────────────────
const lessons = fs.existsSync(cfg.lessons) ? read(cfg.lessons) : '';
// strict: the line names the NEW version ("1163 v0.5.1"); "v<base> returned" would let every later version through
const lessonRe = new RegExp('^- ' + iso + ' .*' + esc(JOB) + ' v' + esc(VERSION) + '\\b', 'm');
const hasLesson = lessonRe.test(lessons);
line(`- lesson line for ${JOB} v${VERSION}: ${hasLesson ? 'present' : 'MISSING'}`);
line('');
const reportFile = `${OUT}/intake_v${VERSION}.md`;
fs.writeFileSync(reportFile, rep.join('\n') + '\n');
console.log(rep.join('\n'));
console.log('report: ' + reportFile);
if (!gatesOk) { console.log('\nSTOP: a gate failed. Fix the file or the baseline before stamping.'); process.exit(1); }
if (!hasLesson) { console.log(`\nSTOP: write the lesson line(s) for ${JOB} v${VERSION} (dated ${iso}) in ${cfg.lessons}, then run again. Nothing stamped or delivered.`); process.exit(3); }
if (DRY) { console.log('\n--dry: nothing stamped or delivered.'); process.exit(0); }

// ── stamp, deliver, cover note ───────────────────────────────────────────────
const returnedStamp = `${H}/${M}_v${BASE}_returned_${iso}.L5X`;
if (!fs.existsSync(returnedStamp)) fs.copyFileSync(RETURNED, returnedStamp);
console.log('stamped ' + returnedStamp);
const delivery = `${D}/${M}.L5X`;
if (!NO_DELIVER) {
  fs.copyFileSync(RETURNED, delivery);
  const apply = argOf('apply');
  if (apply) { const a = run([apply]); console.log(a.out.trim()); if (a.code !== 0) { console.error('--apply failed'); process.exit(1); } }
  fs.copyFileSync(delivery, `${H}/${M}_v${VERSION}_${iso}.L5X`);
  console.log(`delivered ${delivery} and stamped _v${VERSION}_${iso}`);
}
if (!NO_COVER) {
  const headF = `${OUT}/${JOB}_CoverNote_head.html`;
  let head = read(headF);
  if (!head.includes(`<tr><td>${VERSION}</td>`)) {
    const row = argOf('row', `Jason&rsquo;s corrected copy of ${BASE} is the lineage; see intake_v${VERSION}.md for the rung-level changes.`);
    const quote = argOf('quote', '');
    const tr = `<tr><td>${VERSION}</td><td>${short}</td><td>${row}</td><td>${quote ? 'Jason, ' + short + ': &ldquo;' + quote + '&rdquo;' : 'Jason, ' + short}</td></tr>\n</table>\n<h2>What I was given</h2>`;
    if (!/<\/table>\r?\n<h2>What I was given<\/h2>/.test(head)) { console.error('head.html: revision table end not found'); process.exit(1); }
    head = head.replace(/<\/table>\r?\n<h2>What I was given<\/h2>/, tr);
    fs.writeFileSync(headF, head);
    console.log('revision row ' + VERSION + ' added');
  }
  const html = `${OUT}/${JOB}_CoverNote_v${VERSION}.html`;
  const s = run(['scripts/sequenceOfOperation.cjs', delivery, '--out', html, '--head', headF, '--meta', `${OUT}/${JOB}_CoverNote_meta.json`, '--front', `${OUT}/${JOB}_CoverNote_front.html`, '--back', `${OUT}/${JOB}_CoverNote_back.html`, '--foot', 'If a device or step is wrong, fix the code, not this sheet.', '--programs', cfg.programs, '--title', cfg.title, '--subtitle', `Cover note and sequence of operation - v${VERSION}`]);
  console.log(s.out.trim().split('\n').pop()); if (s.code !== 0) process.exit(1);
  const docx = `${D}/${M}_CoverNote.docx`;
  const w = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (B + '/w8_convert.ps1').replace(/\//g, '\\'), '-Html', html.replace(/\//g, '\\'), '-Docx', docx.replace(/\//g, '\\'), '-Pdf', `${OUT}/${JOB}_CoverNote_v${VERSION}.pdf`.replace(/\//g, '\\')], { encoding: 'utf8' });
  const wout = (w.stdout || '') + (w.stderr || '');
  console.log(wout.trim().split('\n').slice(-2).join('\n'));
  if (!/saved /.test(wout)) { console.error('cover note conversion failed (is Word open?)'); process.exit(1); }
  fs.copyFileSync(docx, `${H}/${M}_CoverNote_v${VERSION}_${iso}.docx`);
  console.log(`cover note stamped _v${VERSION}_${iso}`);
}
console.log('\ndone: v' + VERSION);
