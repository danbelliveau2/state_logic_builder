/**
 * harvestPrecedents.cjs — build jarvis-knowledge/precedents.md, the NAMING
 * PRECEDENT PACK (Dan, 2026-08-26: "Controls engineers use what they have —
 * past work as their baseline. Every single step.").
 *
 * Scans the GOOD corpus only:
 *   - plc-reference/standard/*.L5X                       (the standard templates)
 *   - plc-reference/verified/*.L5X                       (Jason-verified builds)
 *   - plc-reference/training-material/Examples Following SDC Standard/*.L5X
 *   - plc-reference/training-material/SDC Standard Templates/*.L5X
 *   - projects/*.json                                    (real app projects; skips _backups/_sheet-images/drafts)
 * ("Examples NOT Following" and bad-examples are deliberately excluded.)
 *
 * Harvests: program/SM names, routine names, tag bases by prefix (i_/q_/p_/
 * HMI_/servo-axis), station & state-machine display names, device names by
 * type, and signal names — REAL examples only, frequency-ranked, capped so
 * the whole pack rides inside prompts (target < ~2K tokens).
 *
 * Rerunnable: overwrite-in-place. TODO(training): hook into the daily
 * training run so the pack refreshes as verified work lands.
 *
 * Usage: node scripts/harvestPrecedents.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'jarvis-knowledge', 'precedents.md');

const L5X_DIRS = [
  'plc-reference/standard',
  'plc-reference/verified',
  'plc-reference/training-material/Examples Following SDC Standard',
  'plc-reference/training-material/SDC Standard Templates',
];

function listFiles(dir, re) {
  const abs = path.join(ROOT, dir);
  try {
    return fs.readdirSync(abs).filter((f) => re.test(f)).map((f) => path.join(abs, f));
  } catch { return []; }
}

/** counter map helper */
function bump(map, key) {
  const k = String(key ?? '').trim();
  if (!k) return;
  map.set(k, (map.get(k) ?? 0) + 1);
}
function top(map, n, filter = () => true) {
  return [...map.entries()]
    .filter(([k]) => filter(k))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

// ── L5X harvest ──────────────────────────────────────────────────────────────
const programNames = new Map();
const routineNames = new Map();
const tagByPrefix = { i_: new Map(), q_: new Map(), p_: new Map(), HMI_: new Map(), axis: new Map() };

for (const dir of L5X_DIRS) {
  for (const file of listFiles(dir, /\.l5x$/i)) {
    let xml = '';
    try { xml = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of xml.matchAll(/<Program\s[^>]*Name="([^"]+)"/g)) bump(programNames, m[1]);
    for (const m of xml.matchAll(/<Routine\s[^>]*Name="([^"]+)"/g)) bump(routineNames, m[1]);
    for (const m of xml.matchAll(/<Tag\s[^>]*Name="([^"]+)"/g)) {
      const t = m[1];
      if (/^i_/.test(t)) bump(tagByPrefix.i_, t);
      else if (/^q_/.test(t)) bump(tagByPrefix.q_, t);
      else if (/^p_/.test(t)) bump(tagByPrefix.p_, t);
      else if (/^HMI_/.test(t)) bump(tagByPrefix.HMI_, t);
      else if (/^a\d\d_/.test(t)) bump(tagByPrefix.axis, t);
    }
  }
}

// ── App-project harvest (real shipped project files) ─────────────────────────
const stationNames = new Map();   // station display names ("Magnet Dial")
const smNames = new Map();        // state machine names/display names
const devicesByType = new Map();  // type -> Map(name)
const signalNames = new Map();    // smOutputs + project signals + p_* devices

const projDir = path.join(ROOT, 'projects');
for (const f of fs.readdirSync(projDir)) {
  if (!/\.json$/i.test(f) || /_draft\.json$/i.test(f)) continue;
  const abs = path.join(projDir, f);
  if (!fs.statSync(abs).isFile()) continue;
  let p;
  try { p = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
  for (const sm of p.stateMachines ?? []) {
    bump(smNames, sm.smName ?? sm.displayName ?? sm.name);
    if (sm.name && sm.name !== (sm.displayName ?? '')) bump(smNames, sm.name);
    bump(stationNames, sm.stationName);
    for (const d of sm.devices ?? []) {
      const type = String(d.type ?? 'Other');
      if (!devicesByType.has(type)) devicesByType.set(type, new Map());
      bump(devicesByType.get(type), d.displayName ?? d.name);
    }
    for (const o of sm.smOutputs ?? []) bump(signalNames, o?.name);
  }
  for (const s of p.signals ?? []) bump(signalNames, s?.name);
}

// ── Distill ──────────────────────────────────────────────────────────────────
const noise = (k) => k.length >= 3 && !/^(Untitled|New|Test)/i.test(k);
const lines = [];
lines.push('# SDC Naming Precedents (auto-harvested)');
lines.push('');
lines.push('> REAL names SDC has actually shipped — templates, Jason-verified builds,');
lines.push('> standard-following examples, and real app projects. These are the baseline:');
lines.push('> MATCH the pattern; never invent a style. Regenerate with');
lines.push('> `node scripts/harvestPrecedents.cjs`.');
lines.push('');
lines.push('## Station / PLC program names (S{nn}_{PascalName})');
lines.push(top(programNames, 20, (k) => /^S\d\d_/.test(k)).join(', ') || '(none found)');
lines.push('');
lines.push('## Routine names');
lines.push(top(routineNames, 18).join(', ') || '(none found)');
lines.push('');
lines.push('## State machine / station display names (as engineers say them)');
const smList = [...new Set([...top(stationNames, 12, noise), ...top(smNames, 18, noise)])];
lines.push(smList.join(', ') || '(none found)');
lines.push('');
lines.push('## Device names, by type (app projects)');
const typeOrder = ['ServoAxis', 'PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper',
  'PneumaticVacGenerator', 'DigitalSensor', 'AnalogSensor', 'VisionSystem', 'Robot', 'Conveyor'];
for (const t of typeOrder) {
  const m = devicesByType.get(t);
  if (!m || !m.size) continue;
  lines.push(`- ${t}: ${top(m, 10, noise).join(', ')}`);
}
lines.push('');
lines.push('## Signals / SM outputs (p_ pattern)');
lines.push(top(signalNames, 16, noise).join(', ') || '(none found)');
lines.push('');
lines.push('## Tag bases with real examples');
lines.push(`- i_ (inputs): ${top(tagByPrefix.i_, 12).join(', ')}`);
lines.push(`- q_ (outputs): ${top(tagByPrefix.q_, 12).join(', ')}`);
lines.push(`- p_ (SM outputs/signals): ${top(tagByPrefix.p_, 10).join(', ')}`);
lines.push(`- HMI_: ${top(tagByPrefix.HMI_, 10).join(', ')}`);
lines.push(`- servo axes (a{NN}_S{station}{name}): ${top(tagByPrefix.axis, 8).join(', ')}`);
lines.push('');

let out = lines.join('\n');
// Brevity budget: the pack rides in prompts — hard-cap ~8KB (≈2K tokens).
if (out.length > 8000) out = out.slice(0, 7980) + '\n(…trimmed to budget)';
fs.writeFileSync(OUT, out);
console.log(`precedents.md written — ${out.length} chars, ` +
  `${programNames.size} programs, ${routineNames.size} routines, ` +
  `${smList.length} SM/station names, ${signalNames.size} signals`);
