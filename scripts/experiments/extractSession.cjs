#!/usr/bin/env node
'use strict';
/**
 * extractSession.cjs — split a Claude Code session export (transcript.jsonl, or the .zip Jason drops in
 * X:\Electrical Dept\SDC Engineer\Sessions\) into two readable files: the engineer's own messages (the gold —
 * his words, his corrections) and the assistant's text replies (skim for rulings he confirmed).
 *
 *   node scripts/experiments/extractSession.cjs <transcript.jsonl | export.zip> <outDir>
 *
 * Writes <outDir>/engineer-messages.md and <outDir>/assistant-messages.md (numbered, timestamped sections) and
 * prints counts. Tool results, attachments and system frames are dropped. Nothing is interpreted here — read
 * engineer-messages.md in full before writing any rule from it (Dan, 2026-09-18: "connect the dots").
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) { console.error('usage: extractSession.cjs <transcript.jsonl|export.zip> <outDir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
let jsonl = src;
if (/\.zip$/i.test(src)) {
  execSync(`unzip -o -q "${src}" -d "${outDir}"`, { stdio: 'inherit' });
  const found = fs.readdirSync(outDir).find((f) => /^transcript\.jsonl$/i.test(f)) || fs.readdirSync(outDir).find((f) => /\.jsonl$/i.test(f));
  if (!found) { console.error('no .jsonl inside the zip'); process.exit(1); }
  jsonl = path.join(outDir, found);
}
const lines = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean);
const eng = [], asst = [];
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  const m = o.message; if (!m) continue;
  const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }];
  for (const b of content) {
    if (b.type !== 'text' || !b.text) continue;
    const text = b.text.trim();
    if (o.type === 'user' && !/^<(system-reminder|command|local-command|task-notification)/.test(text)) eng.push({ ts: o.timestamp, text });
    if (o.type === 'assistant') asst.push({ ts: o.timestamp, text });
  }
}
const render = (arr) => arr.map((x, i) => `### ${i + 1} (${x.ts || ''})\n${x.text}`).join('\n\n');
fs.writeFileSync(path.join(outDir, 'engineer-messages.md'), render(eng));
fs.writeFileSync(path.join(outDir, 'assistant-messages.md'), render(asst));
console.log(`${path.basename(jsonl)}: ${lines.length} lines → ${eng.length} engineer messages (${eng.reduce((a, x) => a + x.text.length, 0)} chars), ${asst.length} assistant replies (${asst.reduce((a, x) => a + x.text.length, 0)} chars) in ${outDir}`);
