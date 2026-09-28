/**
 * parseCheckChanged.cjs — THE PARSE GATE (2026-09-01: an unescaped apostrophe
 * in whatsNew.js shipped and red-overlayed the live app; "vite-ok" had only
 * grepped the log, and data-file modules compile lazily). EVERY touched
 * .js/.jsx/.cjs/.mjs file must PARSE before any done report — esbuild handles
 * JSX and ESM/CJS alike.
 *
 * Run: node scripts/parseCheckChanged.cjs [base-ref]   (default: HEAD)
 * Checks: git-modified + staged + untracked script files. Exit 0 = all parse.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const base = process.argv[2] || 'HEAD';

let files = [];
try {
  const out = execSync(`git -C "${ROOT}" diff --name-only ${base} && git -C "${ROOT}" diff --name-only --cached ${base} && git -C "${ROOT}" ls-files --others --exclude-standard`, { encoding: 'utf8' });
  files = [...new Set(out.split(/\r?\n/).filter(Boolean))];
} catch (e) {
  console.error('git enumeration failed:', e.message);
  process.exit(1);
}
const targets = files
  .filter((f) => /\.(js|jsx|cjs|mjs)$/i.test(f))
  .filter((f) => !/node_modules|worktrees|dist\//.test(f))
  .map((f) => path.join(ROOT, f))
  .filter((f) => fs.existsSync(f));

if (!targets.length) { console.log('parse gate: no changed script files.'); process.exit(0); }

let esbuild;
try { esbuild = require(path.join(ROOT, 'node_modules', 'esbuild')); } catch { esbuild = null; }

let failed = 0;
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    if (esbuild) {
      esbuild.transformSync(src, { loader: f.endsWith('x') ? 'jsx' : 'js', logLevel: 'silent' });
    } else {
      // Fallback: node --check (no JSX) — JSX files get a naive strip first.
      execSync(`node --check "${f}"`, { stdio: 'pipe' });
    }
    console.log('  ok', path.relative(ROOT, f));
  } catch (e) {
    failed++;
    const msg = e.errors?.[0] ? `${e.errors[0].text} @ line ${e.errors[0].location?.line}` : String(e.message).split('\n')[0];
    console.error('  PARSE FAIL', path.relative(ROOT, f), '—', msg);
  }
}
if (failed) { console.error(`\n${failed} file(s) failed to parse.`); process.exit(1); }
console.log(`\nAll ${targets.length} changed script file(s) parse.`);
