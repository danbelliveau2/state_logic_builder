#!/usr/bin/env node
'use strict';
/**
 * sequenceOfOperation.cjs - the Sequence of Operation deliverable (Jason, 2026-09-29).
 *
 * One table per state machine: every state, what happens in it, where it goes and on what.
 * Everything is read out of the L5X - the rung comments carry the wording, the rung logic
 * carries the conditions. Nothing is invented.
 *
 *   node scripts/sequenceOfOperation.cjs <file.L5X> --out <file.html> [--meta <headers.json>]
 *        [--title "..."] [--subtitle "..."] [--programs "S\\d\\d_|Supervisor"]
 *
 * Then convert with scripts/html2docx.ps1. Page count from that script is NOT reliable
 * (2026-09-29: it reported 17 for an 18-page file); count the PDF if the number matters.
 *
 * --meta is optional: { "<Program>": { "title": "...", "does": "...", "devices": "...",
 *                                      "notes": "...", "extra": {"<label>": "<value>"} } }
 * Programs with no entry still get a table, headed by the program name.
 */
const fs = require('fs');
const path = require('path');

// ── args ──
const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith('--'));
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
if (!SRC) { console.error('usage: node scripts/sequenceOfOperation.cjs <file.L5X> --out <file.html>'); process.exit(2); }
const OUT = flag('out', SRC.replace(/\.L5X$/i, '_SequenceOfOperation.html'));
const META = flag('meta') ? JSON.parse(fs.readFileSync(flag('meta'), 'utf8')) : {};
const PROGRAM_RE = new RegExp(flag('programs', '^(S\\d\\d_|P\\d\\d_|D\\d\\d|Supervisor)'));

// ── L5X reading ──
const xml = fs.readFileSync(SRC, 'utf8');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const cdata = (s) => {
  if (s == null) return '';
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
  return (m ? m[1] : unesc(s)).replace(/\s*\r?\n\s*/g, ' ').trim();
};
function chunks(text, tag, stopTag) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b[^>]*\\bName="([^"]+)"[\\s\\S]*?(?=<' + tag + '\\b|</' + stopTag + '>)', 'g');
  let m; while ((m = re.exec(text))) out.push({ name: m[1], body: m[0] });
  return out;
}
function rungs(body) {
  const out = [];
  for (const m of body.matchAll(/<Rung\b[^>]*\bNumber="(\d+)"[^>]*>([\s\S]*?)<\/Rung>/g)) {
    const c = /<Comment>([\s\S]*?)<\/Comment>/.exec(m[2]);
    const t = /<Text>([\s\S]*?)<\/Text>/.exec(m[2]);
    out.push({ n: +m[1], comment: c ? cdata(c[1]) : '', text: t ? cdata(t[1]) : '' });
  }
  return out;
}

const PROGRAMS = {};
for (const p of chunks(xml, 'Program', 'Programs')) {
  if (!PROGRAM_RE.test(p.name)) continue;
  const rs = {};
  for (const r of chunks(p.body, 'Routine', 'Routines')) rs[r.name] = rungs(r.body);
  if (rs.R02_StateTransitions) PROGRAMS[p.name] = rs;   // no state machine, no table
}
if (!Object.keys(PROGRAMS).length) { console.error('no programs with R02_StateTransitions matched ' + PROGRAM_RE); process.exit(1); }

// ── condition rendering ──
// A transition rung usually gates several source states in parallel branch legs, so the
// condition is always rendered FOR ONE source state: other states' legs are pruned first.
const BOILER = new Set(['SS_OK', 'CycleRunning', 'Initialized', 'SafetyOK', 'ManualMode',
  'CycleStopped', 'Lockout', 'UseRestartLogic', 'q_AlarmActive', 'g_MachineBasic.AlwaysOn',
  'g_MachineBasic.AlwaysOff', 'S:FS']);

function parse(text, i = 0, depth = 0) {
  const legs = [[]]; let cur = legs[0];
  while (i < text.length) {
    const c = text[i];
    if (c === '[') { const r = parse(text, i + 1, depth + 1); cur.push(r.node); i = r.i; continue; }
    if (c === ']') return { node: { or: legs }, i: i + 1 };
    if (c === ',' && depth > 0) { cur = []; legs.push(cur); i++; continue; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(text.slice(i));
    if (m) {
      let j = i + m[0].length, d2 = 1, arg = '';
      while (j < text.length && d2 > 0) {
        if (text[j] === '(') d2++; else if (text[j] === ')') { d2--; if (!d2) break; }
        if (d2 > 0) arg += text[j];
        j++;
      }
      cur.push({ op: m[1], arg }); i = j + 1; continue;
    }
    i++;
  }
  return { node: { or: legs }, i };
}
function statesIn(node, out = new Set()) {
  if (node.or) { for (const leg of node.or) for (const n of leg) statesIn(n, out); return out; }
  const m = /^Status\.State\[(\d+)\]$/.exec(node.arg || '');
  if (m && node.op === 'XIC') out.add(+m[1]);
  return out;
}
function pruneFor(node, from) {
  if (!node.or) return node;
  const legs = [];
  for (const leg of node.or) {
    const st = new Set(); for (const n of leg) statesIn(n, st);
    if (st.size && !st.has(from)) continue;
    legs.push(leg.map((n) => pruneFor(n, from)));
  }
  return { or: legs.length ? legs : node.or };
}
function render(node) {
  if (node.or) {
    const legs = node.or.map((leg) => leg.map(render).filter(Boolean).join(' and ')).filter(Boolean);
    const uniq = [...new Set(legs)];
    if (!uniq.length) return '';
    return uniq.length === 1 ? uniq[0] : '(' + uniq.join(', or ') + ')';
  }
  const { op, arg } = node;
  if (op === 'XIC' || op === 'XIO') {
    if (/^Status\.State\[\d+\]$/.test(arg) || BOILER.has(arg)) return '';
    return (op === 'XIO' ? 'not ' : '') + arg;
  }
  const sign = { EQ: '=', NE: '<>', NEQ: '<>', GRT: '>', LES: '<', GEQ: '>=', LEQ: '<=',
    LT: '<', GT: '>', LE: '<=', GE: '>=' }[op];
  if (sign) { const [a, b] = arg.split(','); return a.trim() + ' ' + sign + ' ' + b.trim(); }
  return '';
}
function prettify(s) {
  s = s.replace(/\((\w+)_MAM\.PC and \1(\w+)\.InPos, or not DisableCornerRounding and \1_MAM\.IP and \1\2\.InPosWide\)/g,
    (_, ax, pos) => '(' + ax + ' at ' + pos + ', or inside the wide window when blending)');
  s = s.replace(/(\w+)_MAM\.PC and (\w+)\.InPos\b/g, (m, ax, tag) => tag.startsWith(ax) ? ax + ' at ' + tag.slice(ax.length) : m);
  s = s.replace(/\\[A-Za-z]\d\d_\w+\./g, (t) => t.slice(1).split('_')[0] + ' ');
  s = s.replace(/(\w+)Debounce\.On/g, '$1');
  s = s.replace(/Status\.TimeoutFlt/g, 'the state timer expired');
  s = s.replace(/Status\.TransitionTimerDone/g, 'the settle timer finished');
  s = s.replace(/(\w+)_MAM\.PC/g, '$1 move complete').replace(/(\w+)_MAM\.IP/g, '$1 moving')
       .replace(/(\w+)_MAJ\.IP/g, '$1 jog active').replace(/(\w+)_MAS\.PC/g, '$1 stop complete')
       .replace(/(\w+)_MAG\.IP/g, '$1 geared').replace(/(\w+)_MAS_Gear\.IP/g, '$1 ungearing');
  s = s.replace(/(\w+)\.InPosWide/g, '$1 inside the wide window').replace(/(\w+)\.InPos/g, '$1 reached');
  s = s.replace(/(\w+)Delay\.DN/g, 'the $1 delay finished');
  return s;
}
const conditionFrom = (text, from) => prettify(render(pruneFor(parse(text).node, from)));

// ── tables ──
const froms = (t) => [...new Set([...t.matchAll(/XIC\(Status\.State\[(\d+)\]\)/g)].map((m) => +m[1]))];
const tos = (t) => [...new Set([...t.matchAll(/MOVE\((\d+),Control\.StateReg\)/g)].map((m) => +m[1]))];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strip = (c) => String(c || '').replace(/^state\s+\d+\s*:\s*/i, '').trim();
const up = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
// some files carry the edit's provenance ahead of the behaviour; drop that clause, keep the rest
const cleanAct = (s) => String(s).replace(/^(NEW|REPLACES?|REPLACED)\b[^.]*\.\s*/i, '').replace(/^-\s*/, '').trim();
const MAX_ACTS = 5;

function stationRows(prog, wantInit) {
  const rs = PROGRAMS[prog];
  const r02 = rs.R02_StateTransitions || [];
  const r03 = rs.R03_StateLogic || Object.entries(rs).filter(([n]) => /^R03_/.test(n)).map(([, v]) => v)[0] || [];
  const name = new Map(), exits = new Map();
  for (const r of r02) {
    const to = tos(r.text); if (!to.length) continue;
    for (const t of to) if (!name.has(t)) name.set(t, strip(r.comment));
    for (const f of froms(r.text)) for (const t of to) {
      // mode exits are noise in the sequence table, but they are the real exits from 124 and 127
      if (f === t || t === 99 || (t < 4 && !wantInit)) continue;
      if (!exits.has(f)) exits.set(f, []);
      if (!exits.get(f).some((e) => e.to === t)) exits.get(f).push({ to: t, when: conditionFrom(r.text, f) });
    }
  }
  const inRange = (s) => wantInit ? s >= 100 : (s >= 4 && s < 99);
  const rows = [];
  for (const s of [...name.keys()].sort((a, b) => a - b)) {
    if (!inRange(s)) continue;
    const enables = new RegExp('XIC\\(Status\\.State\\[' + s + '\\]\\)');
    let acts = [...new Set(r03.filter((r) => enables.test(r.text)).map((r) => cleanAct(strip(r.comment))).filter(Boolean))];
    if (acts.length > MAX_ACTS) acts = acts.slice(0, MAX_ACTS).concat('+ ' + (acts.length - MAX_ACTS) + ' more rungs');
    const next = (exits.get(s) || []).sort((a, b) => a.to - b.to)
      .map((e) => ({ to: 'state ' + e.to, when: e.when || 'no further condition' }));
    rows.push({ s, what: up(name.get(s)), acts, next });
  }
  return rows;
}
function stateTable(prog, wantInit) {
  const rows = stationRows(prog, wantInit);
  if (!rows.length) return '';
  let h = '<table>\n<tr><th style="width:34pt">State</th><th style="width:206pt">What happens</th>'
        + '<th style="width:58pt">Goes to</th><th>On</th></tr>\n';
  for (const r of rows) {
    const nxt = r.next.length ? r.next : [{ to: '&mdash;', when: 'only the mode states 0&ndash;3 lead out' }];
    const acts = r.acts.length ? '<div class="acts">' + r.acts.map(esc).join(' &middot; ') + '</div>' : '';
    const what = r.what ? esc(r.what) : '<i>no rung comment in the source</i>';
    h += '<tr><td rowspan="' + nxt.length + '"><b>' + r.s + '</b></td>'
       + '<td rowspan="' + nxt.length + '">' + what + acts + '</td>'
       + '<td>' + nxt[0].to + '</td><td>' + esc(nxt[0].when) + '</td></tr>\n';
    for (const n of nxt.slice(1)) h += '<tr><td>' + n.to + '</td><td>' + esc(n.when) + '</td></tr>\n';
  }
  return h + '</table>\n';
}

// ── document ──
const controller = (/<Controller\b[^>]*\bName="([^"]+)"/.exec(xml) || [])[1] || path.basename(SRC);
const TITLE = flag('title', controller.replace(/_/g, ' ') + ' \u2013 Sequence of Operation');
const SUBTITLE = flag('subtitle', 'Source: <b>' + esc(path.basename(SRC)) + '</b>. One table per state machine. '
  + 'States, transitions and conditions are read out of the L5X.');

const P = [];
P.push(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(TITLE)}</title>
<style>
@page { size: 8.5in 11in; margin: 0.5in 0.55in; }
body { font-family: Calibri, sans-serif; font-size: 9pt; color: #000; }
h1 { font-size: 14pt; margin: 0 0 3pt 0; }
h2 { font-size: 11pt; margin: 12pt 0 4pt 0; border-bottom: 1pt solid #666; padding-bottom: 1pt; }
h3 { font-size: 9.5pt; margin: 8pt 0 3pt 0; }
table { border-collapse: collapse; width: 100%; margin-bottom: 7pt; }
td, th { border: 0.5pt solid #999; padding: 2pt 4pt; vertical-align: top; font-size: 8.5pt; text-align: left; }
th { background: #E8E8E8; font-weight: bold; }
td.k { background: #E8E8E8; font-weight: bold; width: 62pt; }
.sub { font-size: 9pt; margin: 0 0 8pt 0; color: #333; }
.acts { color: #444; font-size: 8pt; margin-top: 1pt; }
.foot { margin-top: 10pt; font-style: italic; font-size: 8.5pt; }
</style></head><body>`);
P.push('<h1>' + TITLE + '</h1>');
P.push('<p class="sub">' + SUBTITLE + '</p>');

// --head: the cover-note sections that always come first (revision history, what I was given,
// machine). With it, the sequence tables become one section of the one document (Jason, 2026-09-29).
if (flag('head')) {
  P.push(fs.readFileSync(flag('head'), 'utf8'));
  P.push('<h2 style="page-break-before:always">' + (flag('section-title') || 'Sequence of operation') + '</h2>');
}
const H = flag('head') ? 'h3' : 'h2';   // sub-headings sit one level down inside the combined document

P.push('<' + H + '>How to read the tables</' + H + '>');
P.push(`<table>
<tr><th style="width:62pt">Column</th><th>Means</th></tr>
<tr><td><b>State</b></td><td>The value in <b>Control.StateReg</b>. SDC sequence states run 4, 7, 10, &hellip; in steps of three.</td></tr>
<tr><td><b>What happens</b></td><td>What the station does while that state is active. The grey line lists the outputs R03 drives in it.</td></tr>
<tr><td><b>Goes to</b> / <b>On</b></td><td>Where the state machine moves next and what has to be true. Several rows = several exits. Terms joined by <b>or</b> are parallel branches in the rung.</td></tr>
</table>`);
P.push('<p class="sub">Conditions leave out the terms every rung carries &ndash; <b>SS_OK</b> (single-step acknowledge), <b>CycleRunning</b>, '
  + '<b>Initialized</b>, <b>SafetyOK</b>. A move written as &ldquo;X at Pick (or inside the wide window when blending)&rdquo; is the standard '
  + 'blended-move test: move complete and in position, or still moving but inside the wide deadband.</p>');

P.push('<' + H + '>States every station shares</' + H + '>');
P.push(`<table>
<tr><th style="width:34pt">State</th><th style="width:96pt">Name</th><th>What it means</th></tr>
<tr><td><b>0</b></td><td>Safety stop</td><td>Safety circuit open, or first scan. The state the station was in is stored for the restart.</td></tr>
<tr><td><b>1</b></td><td>Manual</td><td>Operator drives the devices from the HMI. Every actuator rung carries a manual leg.</td></tr>
<tr><td><b>2</b></td><td>Auto idle, not ready</td><td>In auto but not initialized. Leaving here runs the initialization block.</td></tr>
<tr><td><b>3</b></td><td>Auto idle, ready</td><td>Initialized and parked, waiting for the machine cycle to start.</td></tr>
<tr><td><b>99</b></td><td>Lockout</td><td>HMI lockout toggle while the cycle runs. The station stops where it is.</td></tr>
<tr><td><b>100&ndash;123</b></td><td>Initialization</td><td>Drives the station to a known safe start. Listed per station below.</td></tr>
<tr><td><b>124</b></td><td>Initialization complete</td><td>Hands the station to state 3.</td></tr>
<tr><td><b>127</b></td><td>Fault</td><td>An alarm is active. The state at the time of the fault is stored for the restart.</td></tr>
</table>`);

// optional extra sections: --front goes after the shared-states table, --back after the last station
if (flag('front')) P.push(fs.readFileSync(flag('front'), 'utf8'));

const order = Object.keys(META).filter((k) => PROGRAMS[k]).concat(Object.keys(PROGRAMS).filter((k) => !META[k]));
for (const prog of order) {
  const m = META[prog] || {};
  P.push('<h2 style="page-break-before:always">' + (m.title || prog) + '</h2>');
  let hdr = '<table>\n<tr><td class="k">Program</td><td>' + prog + '</td></tr>\n';
  if (m.does) hdr += '<tr><td class="k">Does</td><td>' + m.does + '</td></tr>\n';
  if (m.devices) hdr += '<tr><td class="k">Devices</td><td>' + m.devices + '</td></tr>\n';
  hdr += '<tr><td class="k">Routines</td><td>' + Object.entries(PROGRAMS[prog]).map(([n, v]) => n + ' (' + v.length + ')').join(' &middot; ') + '</td></tr>\n';
  if (m.notes) hdr += '<tr><td class="k">Notes</td><td>' + m.notes + '</td></tr>\n';
  for (const [k, v] of Object.entries(m.extra || {})) hdr += '<tr><td class="k">' + k + '</td><td>' + v + '</td></tr>\n';
  P.push(hdr + '</table>');
  P.push('<h3>Automatic sequence</h3>');
  P.push(stateTable(prog, false) || '<p class="sub">No sequence states.</p>');
  if (stationRows(prog, true).length) { P.push('<h3>Initialization</h3>'); P.push(stateTable(prog, true)); }
}
if (flag('back')) P.push(fs.readFileSync(flag('back'), 'utf8'));
P.push('<p class="foot">' + (flag('foot') || 'Read out of ' + esc(path.basename(SRC)) + '. Describes the code as written.') + '</p>');
P.push('</body></html>');

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, P.join('\n'), 'utf8');
let total = 0;
for (const prog of order) {
  const a = stationRows(prog, false).length, b = stationRows(prog, true).length;
  total += a + b;
  console.log('  ' + prog.padEnd(26) + a + ' sequence, ' + b + ' init');
}
console.log('wrote ' + OUT + '  (' + order.length + ' state machines, ' + total + ' states)');
