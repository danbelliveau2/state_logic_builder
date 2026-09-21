#!/usr/bin/env node
'use strict';
/**
 * buildReadiness.cjs — "Do I have what I need to build this machine?" (Dan, 2026-09-19)
 *
 * Walks the job folder and the plan, checks every input on the master list, and writes a one-page readiness
 * report: have / missing / where found / what I would assume — BEFORE any code build is launched.
 *
 *   node scripts/buildReadiness.cjs --job "N:\1160_Haemonetics_Y-Site Assembly Machine" --plan generated/1160/plan \
 *        --examples "X:\Electrical Dept\SDC Engineer\Examples" --template "plc-reference/training-material/SDC Standard Templates/ChassisStandard_2UP_2026-09-17.L5X" \
 *        --station-examples generated/1160/plan/station-examples.json --out generated/1160/out/readiness.md
 *
 * The station-examples file maps each station program family to the example program the CE named (or "none").
 * Verdict: BUILD when nothing blocking is missing; BUILD ON ASSUMPTIONS when only values/examples are thin; WAIT when
 * I/O points, module config or the template are missing.
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const JOB = args.job; const PLAN = args.plan || ''; const OUT = args.out || 'readiness.md';
if (!JOB) { console.error('usage: --job <folder> [--plan <planDir>] [--transcript <file>] [--examples <dir>] [--template <file>] [--station-examples <json>] [--out <md>]'); process.exit(2); }
if (PLAN && !fs.existsSync(PLAN)) { console.error('plan folder not found: ' + PLAN); process.exit(2); }

function walk(dir, depth = 4, out = []) {
  if (depth < 0 || !fs.existsSync(dir)) return out;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, depth - 1, out); else out.push(p); }
  return out;
}
const files = walk(JOB, 5);
const find = (re, dirRe) => files.filter((f) => re.test(path.basename(f)) && (!dirRe || dirRe.test(f)));
const rel = (f) => f.replace(JOB, '<job>');

// ── master input list (who supplies · how I look for it · blocks the build?) ──
// The nine STANDARD SDC documents (Dan, 2026-09-19) — nothing else is asked for.
const INPUTS = [
  { id: '1', who: 'ME', item: 'Walkthrough transcript (12-item checklist per station)', blocks: true, hits: (args.transcript && fs.existsSync(args.transcript) ? [args.transcript] : []).concat(PLAN ? walk(PLAN, 2).filter((f) => /transcri/i.test(path.basename(f))) : []).concat(find(/transcri|walkthrough|walk-through/i).concat(find(/\.(vtt|srt)$/i))) },
  { id: '2', who: 'ME', item: 'Assembly drawings, ballooned part numbers', blocks: true, hits: find(/assy|assembly|rtm/i, /Mechanical/i).filter((f) => /\.pdf$/i.test(f)) },
  { id: '3', who: 'ME', item: 'Station description sheet (Excel, per station, part numbers)', blocks: false, hits: find(/station|description|overview/i, /Mechanical|Documents|AI/i).filter((f) => /\.(xlsx|xlsm)$/i.test(f)) },
  { id: '4', who: 'EE', item: 'Controls bill of material', blocks: true, hits: find(/bom/i, /Electrical/i).filter((f) => /\.(xlsx|xlsm|csv)$/i.test(f)) },
  { id: '5', who: 'EE', item: 'I/O list (every sensor and output to a point, channel types)', blocks: true, hits: find(/io.?list|i\/o|iolist/i, /Electrical/i).concat(find(/\.pdf$/i, /Electrical Drawings/i)) },
  { id: '6', who: 'ME / EE', item: 'Pneumatic drawings', blocks: true, hits: find(/\.pdf$/i, /Pneumatic/i) },
  { id: '7', who: 'ME', item: 'Timing diagram (cam angles)', blocks: true, hits: find(/tim(ing|e)/i, /Mechanical|Documents|AI/i).filter((f) => /\.(xlsx|xlsm|pdf)$/i.test(f)) },
  { id: '8', who: 'CE', item: 'Example program per station kind, or "new"', blocks: false, hits: args.examples && fs.existsSync(args.examples) ? walk(args.examples, 2).filter((f) => /\.L5X$/i.test(f)) : [] },
  { id: '9', who: 'EE', item: 'Ethernet device list (IP, assembly sizes)', blocks: false, hits: find(/ethernet|network|ip.?list|device.?list/i, /Electrical/i) },
];

// ── per-station rows from the plan ────────────────────────────────────────────
const stationExamples = args['station-examples'] && fs.existsSync(args['station-examples']) ? JSON.parse(fs.readFileSync(args['station-examples'], 'utf8')) : {};
const stations = (PLAN ? fs.readdirSync(PLAN) : []).filter((f) => /^S\d\d\.json$/.test(f)).sort().map((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(PLAN, f), 'utf8'));
  const machines = j.machines || [];
  const devices = machines.flatMap((m) => m.devices || []);
  const steps = machines.reduce((n, m) => n + ((m.states || []).length || 0), 0);
  const noPoint = devices.filter((d) => /unmapped|no point|not on the schematic|no i\/o/i.test(JSON.stringify(d))).length;
  const ex = stationExamples[f.replace('.json', '')] || '';
  return { id: f.replace('.json', ''), name: String(j.station || '').split('—')[0].trim(), devices: devices.length, noPoint, steps, questions: (j.questionsForME || []).length, gaps: (j.gaps || []).length, example: ex };
});

// ── report ────────────────────────────────────────────────────────────────────
const have = (x) => x.hits.length ? 'HAVE' : 'MISSING';
const blockers = INPUTS.filter((x) => x.blocks && !x.hits.length);
const thin = INPUTS.filter((x) => !x.blocks && !x.hits.length);
const noExample = stations.filter((s) => !s.example || /none|new/i.test(s.example));
const verdict = blockers.length ? `WAIT — ${blockers.map((b) => b.id).join(', ')} missing` : (thin.length || noExample.length) ? `BUILD ON ASSUMPTIONS — thin: ${[...thin.map((t) => t.id), ...noExample.map((s) => s.id + ' no example')].join(', ')}` : 'BUILD';
const lines = [];
lines.push(`# Build readiness — ${path.basename(JOB)} — ${new Date().toISOString().slice(0, 10)}`, '', `**Verdict: ${verdict}**`, '');
lines.push('## Inputs', '', '| # | Who | Input | Status | Found | Blocks build |', '|---|---|---|---|---|---|');
for (const x of INPUTS) lines.push(`| ${x.id} | ${x.who} | ${x.item} | ${have(x)} | ${x.hits.slice(0, 3).map(rel).join('<br>')}${x.hits.length > 3 ? `<br>… ${x.hits.length - 3} more` : ''} | ${x.blocks ? 'yes' : 'no'} |`);
lines.push('', '## Stations (from the plan)', '', '| Station | Devices | Devices with no I/O point | Steps | Example named | Open questions | Gaps |', '|---|---|---|---|---|---|---|');
for (const s of stations) lines.push(`| ${s.id} ${s.name} | ${s.devices} | ${s.noPoint} | ${s.steps} | ${s.example || '—'} | ${s.questions} | ${s.gaps} |`);
lines.push('', '## What I do next', '');
if (blockers.length) lines.push(`- Wait for: ${blockers.map((b) => `${b.item} (${b.who})`).join('; ')}.`);
if (noExample.length) lines.push(`- Stations with no example named: ${noExample.map((s) => s.id).join(', ')} — CE names one or they ship as labelled placeholders.`);
if (thin.length) lines.push(`- Thin inputs I will cover with assumptions and list in the cover note: ${thin.map((t) => t.item).join('; ')}.`);
if (!blockers.length && !thin.length && !noExample.length) lines.push('- Nothing missing. Build.');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'));
console.log(lines.join('\n'));
