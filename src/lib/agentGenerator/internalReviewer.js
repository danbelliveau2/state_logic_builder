/**
 * internalReviewer.js — the PRE-DELIVERY INTERNAL REVIEW ("pre-Jason pass").
 *
 * Before ANY generated file goes external, Jarvis reviews it the way the
 * senior SDC controls engineer would — adversarially, against the template.
 * Mechanical validators (validator.js) catch structure; THIS pass catches
 * what they can't: style drift, missing template blocks, wrong-shaped logic,
 * anything a CE would flag. One set of changes, fixed right — the file only
 * gets marked "ready to send" when this pass says ship.
 *
 * reviewGenerated({ l5xPath | l5x, projectJson, smId, signal }):
 *   ONE model call (JARVIS_MODEL, effort high). Input:
 *     - the generated file's ROUTINE BODIES (rung text + comments per
 *       routine — never tag data blobs; the input stays focused),
 *     - the matching template's same routines COMPLETE (the one place
 *       full-fidelity template context is worth every token — the reviewer
 *       must see the reference),
 *     - the compiled IR summary (the approved sequence when one exists,
 *       else the diagram IR),
 *     - the engineering concepts + ME knowledge (loadConcepts/loadMeKnowledge).
 *   Returns { verdict: 'ship'|'fix', findings, missingVsTemplate, summary,
 *             costUSD, model, durationS, at }.
 *
 * A 'fix' verdict does NOT auto-loop regeneration (cost discipline) — it
 * marks the build "not ready for external delivery" so a human decides.
 *
 * Gate: JARVIS_INTERNAL_REVIEW=on|off (default on) — checked by the CALLER
 * (client.js generateL5X), not here, so direct calls (benchmarks, the
 * calibration harness) always run.
 *
 * CommonJS, plain Node — required lazily by client.js. Must NOT require
 * client.js (client.js requires this module).
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { buildIR } = require('./ir');
const { selectTemplate } = require('./promptBuilder');
const { loadConcepts, loadMeKnowledge } = require('./meKnowledge');

const ROOT = path.join(__dirname, '..', '..', '..');
const STANDARD_DIR = path.join(ROOT, 'plc-reference', 'standard');

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
// A review is prose+JSON, not an edit plan — 32K output is generous headroom.
const MAX_TOKENS = parseInt(process.env.JARVIS_REVIEW_MAX_OUTPUT_TOKENS, 10) || 32000;

// $ per 1M tokens: [input, output] — same table as client.js (kept local so
// this module never requires client.js: client.js requires THIS module).
const PRICING = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

function costOfUsage(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-opus-5'];
  const input = (usage.input_tokens || 0) * inRate;
  const cacheRead = (usage.cache_read_input_tokens || 0) * inRate * 0.10;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * inRate * 1.25;
  const output = (usage.output_tokens || 0) * outRate;
  return (input + cacheRead + cacheWrite + output) / 1e6;
}

// ── L5X routine extraction (self-contained; mirrors promptBuilder's parsers) ─

function targetProgramSlice(xml) {
  const m = /<Program Use="Target"[^>]*>/.exec(xml);
  if (!m) throw new Error('L5X has no <Program Use="Target">');
  const end = xml.indexOf('</Program>', m.index);
  return xml.slice(m.index, end === -1 ? xml.length : end);
}

function listRoutineNames(progXml) {
  return [...progXml.matchAll(/<Routine Name="([^"]+)" Type="RLL"/g)].map(m => m[1]);
}

function extractRoutineRungs(progXml, routineName) {
  const rm = new RegExp(`<Routine Name="${routineName}"[^>]*>`).exec(progXml);
  if (!rm) return null;
  const end = progXml.indexOf('</Routine>', rm.index);
  const section = progXml.slice(rm.index, end === -1 ? progXml.length : end);
  const rungs = [];
  const re = /<Rung\b[^>]*>([\s\S]*?)<\/Rung>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const body = m[1];
    const cm = /<Comment>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Comment>/.exec(body);
    const tm = /<Text>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Text>/.exec(body);
    rungs.push({ comment: cm ? cm[1].trim() : null, text: tm ? tm[1].trim() : '' });
  }
  return rungs;
}

/** Render every RLL routine of a program as "rung N // comment \n text" —
 *  routine bodies ONLY (no tag data blobs). */
function renderProgramRoutines(xml) {
  const prog = targetProgramSlice(xml);
  const names = listRoutineNames(prog);
  const parts = [];
  for (const name of names) {
    const rungs = extractRoutineRungs(prog, name);
    if (!rungs) continue;
    const lines = [`### Routine ${name} (${rungs.length} rungs)`];
    rungs.forEach((r, i) => {
      if (r.comment) lines.push(`rung ${i} // ${r.comment.replace(/\r?\n/g, ' | ')}`);
      else lines.push(`rung ${i}`);
      lines.push(`  ${r.text}`);
    });
    parts.push(lines.join('\n'));
  }
  return { text: parts.join('\n\n'), routineNames: names };
}

// ── Response parsing ─────────────────────────────────────────────────────────

/** Pull the review JSON out of the model response (tolerates fences/prose). */
function extractReviewJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

const SEVERITIES = new Set(['blocker', 'style', 'note']);

function normalizeReview(raw) {
  const findings = (Array.isArray(raw.findings) ? raw.findings : [])
    .filter(f => f && (f.finding || f.issue))
    .map(f => ({
      severity: SEVERITIES.has(String(f.severity || '').toLowerCase())
        ? String(f.severity).toLowerCase() : 'note',
      routine: f.routine != null ? String(f.routine) : null,
      finding: String(f.finding || f.issue || '').trim(),
      templateEvidence: f.templateEvidence != null ? String(f.templateEvidence) : null,
    }));
  const missingVsTemplate = (Array.isArray(raw.missingVsTemplate) ? raw.missingVsTemplate : [])
    .map(x => String(typeof x === 'object' && x !== null ? (x.finding || x.item || JSON.stringify(x)) : x).trim())
    .filter(Boolean);
  let verdict = String(raw.verdict || '').toLowerCase() === 'ship' ? 'ship' : 'fix';
  // Consistency guard: a "ship" with blocker findings is a contradiction —
  // blockers win (the whole point is nothing questionable goes external).
  if (verdict === 'ship' && findings.some(f => f.severity === 'blocker')) verdict = 'fix';
  return {
    verdict,
    findings,
    missingVsTemplate,
    summary: String(raw.summary || '').trim(),
  };
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM = `You are the senior SDC controls engineer reviewing a junior's program against the standard template before it ships to the customer's controls team. Their culture is "one set of changes, fixed right" — anything a reviewing CE would flag costs the whole team credibility, so BE ADVERSARIAL. Mechanical validators already checked structure (state coverage, tag references, XML shape); your job is everything they cannot see.

Compare ROUTINE BY ROUTINE against the template: rung ordering, rung shapes, trigger/staging/alarm patterns, naming, completeness vs the template skeleton (missing init branches, dropped rungs), style drift. The junior's past failures — look hard for exactly this class:
- R02 sequence rungs out of ascending state-number order (spliced in flow order or appended at the end)
- invented per-state motion trigger latches (ONS trigger rungs, OTL/OTU move-trigger latches, sub-step counters) instead of the template's single state-list MAM rung per axis
- dropped init-block branches (e.g. init 106 carrying-part path missing)
- oversized rung descriptions / comments that drift from the template's terse style
- the wrong mnemonic family (EQU/NEQ/LES/GRT/GEQ/LEQ instead of the template's EQ/NE/LT/GT/GE/LE, or vice versa)
- separate speed-profile rungs instead of branches inside the one Auto Mode staging rung
- template boilerplate rungs altered or removed without the sequence requiring it

Severity meanings:
- "blocker": a reviewing CE would bounce the file — wrong-shaped logic, missing template blocks, ordering violations, invented patterns, anything that behaves differently from the standard.
- "style": would draw a red pen but not a bounce — comment style drift, naming inconsistency, non-standard-but-functional expression.
- "note": worth knowing, no action required.

Verdict discipline: "ship" ONLY when there are zero blockers and you would put your own name on the file. Any blocker means "fix". Differences the approved sequence itself requires (renamed positions, station-specific states, retargeted conditions) are NOT findings — judge the expression, not the intent.

Respond with ONLY a JSON object:
{"verdict":"ship"|"fix","findings":[{"severity":"blocker"|"style"|"note","routine":"R02_StateTransitions","finding":"...","templateEvidence":"the template rung/pattern that proves it"}],"missingVsTemplate":["..."],"summary":"2-4 sentences, the way you'd tell the junior"}`;

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Review one generated L5X against its matching template. ONE model call.
 *
 * @param {object} opts
 * @param {string} [opts.l5x]      the generated L5X content
 * @param {string} [opts.l5xPath]  path to it (used when l5x not given)
 * @param {object} opts.projectJson  the project the build came from
 * @param {string} opts.smId       state machine id (buildIR resolves it)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{verdict,findings,missingVsTemplate,summary,costUSD,model,durationS,at}>}
 */
async function reviewGenerated({ l5x, l5xPath, projectJson, smId, signal } = {}) {
  if (!l5x && l5xPath) l5x = fs.readFileSync(l5xPath, 'utf8');
  if (!l5x) throw new Error('reviewGenerated needs l5x or l5xPath');
  if (!projectJson) throw new Error('reviewGenerated needs projectJson');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI review not configured — add ANTHROPIC_API_KEY to .env');

  const startedAt = Date.now();
  const ir = buildIR(projectJson, smId);
  const sm = (projectJson.stateMachines || []).find(s => s.id === ir.smId);

  // The compiled IR summary — the approved sequence when one exists (that is
  // the contract the file was built to), else the diagram IR.
  const compiledIr = sm && sm.compiledSequence && sm.compiledSequence.ir ? sm.compiledSequence.ir : null;
  const irText = (compiledIr && compiledIr.text) ? compiledIr.text : ir.text;

  const choice = selectTemplate(sm);
  const templateXml = fs.readFileSync(path.join(STANDARD_DIR, choice.template), 'utf8');
  const template = renderProgramRoutines(templateXml); // COMPLETE routines — the reviewer must see the reference
  const generated = renderProgramRoutines(l5x);        // routine bodies only — focused input

  const concepts = loadConcepts();
  const meKnowledge = loadMeKnowledge();

  const userText = [
    ...(concepts ? ['# ENGINEERING CONCEPTS (how SDC thinks — the standard you are enforcing)', concepts, ''] : []),
    ...(meKnowledge ? ['# ME KNOWLEDGE (standing facts and learned corrections)', meKnowledge, ''] : []),
    `# THE STANDARD TEMPLATE — ${choice.template} (selected: ${choice.reason})`,
    'These are the template\'s routines COMPLETE. This is the reference the junior was',
    'supposed to perform surgery on — every idiom, every rung shape, every ordering here',
    'is the standard.',
    '',
    template.text,
    '',
    '# THE APPROVED SEQUENCE (what the program is supposed to implement)',
    irText,
    '',
    `# THE JUNIOR'S GENERATED PROGRAM — station "${ir.smName}" (routine bodies)`,
    generated.text,
    '',
    '# TASK',
    'Review the generated program against the template, routine by routine. Respond with',
    'ONLY the JSON review object described in your instructions.',
  ].join('\n');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const req = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive', display: 'summarized' },
    // The review earns full reasoning depth — this is the last gate before a
    // file goes external.
    output_config: { effort: 'high' },
    system: SYSTEM,
    messages: [{ role: 'user', content: userText }],
  };
  if (/^claude-(fable|opus)-/.test(MODEL)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused the review: ' + (response.stop_details?.explanation || 'no explanation'));
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const raw = extractReviewJson(text);
  if (!raw || !raw.verdict) {
    throw new Error('Internal review returned no parseable verdict'
      + (response.stop_reason === 'max_tokens' ? ' (response truncated)' : ''));
  }

  const costUSD = response.usage ? Number(costOfUsage(response.usage, MODEL).toFixed(4)) : null;
  return {
    ...normalizeReview(raw),
    template: choice.template,
    model: response.model || MODEL,
    costUSD,
    durationS: Math.round((Date.now() - startedAt) / 1000),
    at: new Date().toISOString(),
  };
}

module.exports = { reviewGenerated, renderProgramRoutines, normalizeReview, extractReviewJson };
