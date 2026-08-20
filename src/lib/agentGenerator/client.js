/**
 * client.js — Anthropic API client + JARVIS surgical generation loop.
 *
 * v1.0.2: continuation support — a plan that parses cleanly and ends with
 * "toBeContinued": true is a deliberate split; the loop requests the remainder
 * (up to MAX_CONTINUATIONS extra calls within the same attempt) and
 * concatenates the operations arrays before merging.
 *
 * generateL5X(projectJson, smId, options):
 *   promptBuilder (edit-plan prompt, cached stable prefix)
 *     -> Claude (JARVIS_MODEL, default claude-opus-5) authors a JSON edit plan
 *     -> editPlanSchema.validatePlan
 *     -> mergeEngine.applyEditPlan (deterministic template surgery)
 *     -> validator.validateL5X + validator.validateAgainstDiagram
 *   Failures at any stage (bad JSON, schema errors, merge assertion failures,
 *   validation errors) are fed back to the model for a revised plan, up to
 *   JARVIS_MAX_ATTEMPTS total model calls.
 *
 * Configuration (.env, all optional). Quality is the constraint, not cost —
 * caps exist for visibility and runaway protection only:
 *   JARVIS_MODEL              default claude-opus-5 ($5/$25 per M).
 *                             claude-fable-5 ($10/$50) is the QUALITY
 *                             ESCALATION PATH for hard stations — use it
 *                             freely; claude-sonnet-5 ($3/$15) for cheap runs.
 *   JARVIS_MAX_OUTPUT_TOKENS  default 64000 (an edit plan is 5-15K tokens but
 *                             machineSpec-driven stations produced 30K+ plans;
 *                             headroom is deliberate — never starve the plan.
 *                             SDK streaming is already used, so no timeout risk)
 *   JARVIS_MAX_ATTEMPTS       default 5 (total plan attempts incl. repairs;
 *                             continuation calls within an attempt don't count)
 *   JARVIS_MAX_COST_USD       default 20 (sanity ceiling, not a budget)
 *
 * Every result carries meta.costEstimate computed from the actual usage
 * numbers and the model's per-M pricing (cache reads at 10% of the input
 * rate, cache writes at 125%).
 *
 * Reads ANTHROPIC_API_KEY from process.env / repo-root .env (dotenv).
 * CommonJS, plain Node — required lazily by server.js.
 */

const fs = require('fs');
const path = require('path');

// Load repo-root .env (server.js uses only Node built-ins and doesn't).
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { buildGenerationPrompt } = require('./promptBuilder');
const { validateL5X, validateAgainstDiagram, formatReport } = require('./validator');
const { validatePlan } = require('./editPlanSchema');
const { applyEditPlan, MergeError } = require('./mergeEngine');
const { JARVIS_VERSION, currentEntry } = require('./jarvisVersion');

// $ per 1M tokens: [input, output]. Cache read = 10% of input rate,
// cache write = 125% of input rate.
const PRICING = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
const MAX_TOKENS = parseInt(process.env.JARVIS_MAX_OUTPUT_TOKENS, 10) || 64000;
const MAX_ATTEMPTS = parseInt(process.env.JARVIS_MAX_ATTEMPTS, 10) || 5;
// Max continuation calls per attempt for plans split with "toBeContinued".
const MAX_CONTINUATIONS = 4;
// Sanity ceiling only — cost is reported, not optimized for. Quality wins.
const MAX_COST_USD = parseFloat(process.env.JARVIS_MAX_COST_USD) || 20;

/** Thrown when no ANTHROPIC_API_KEY is configured. Endpoint maps it to 503. */
class AiNotConfiguredError extends Error {
  constructor() {
    super('AI generation not configured — add ANTHROPIC_API_KEY to .env');
    this.name = 'AiNotConfiguredError';
    this.code = 'AI_NOT_CONFIGURED';
  }
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client = null;
function getClient() {
  if (!isConfigured()) throw new AiNotConfiguredError();
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env
  }
  return _client;
}

/** Pull the JSON edit plan out of a model response (tolerates fences/prose). */
function extractPlanJson(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return { plan: null, error: 'Response contained no JSON object' };
  }
  try {
    return { plan: JSON.parse(t.slice(start, end + 1)), error: null };
  } catch (e) {
    return { plan: null, error: `JSON parse failed: ${e.message}` };
  }
}

/** Collect the engineer-action comments (*Replace ...) out of the generated L5X. */
function extractReviewNotes(l5x) {
  const notes = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(l5x)) !== null) {
    for (const line of m[1].split('\n')) {
      const s = line.trim();
      if (s.startsWith('*Replace') || s.startsWith('*Verify')) notes.push(s);
    }
  }
  return [...new Set(notes)];
}

function costOfUsage(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-opus-5'];
  const input = (usage.input_tokens || 0) * inRate;
  const cacheRead = (usage.cache_read_input_tokens || 0) * inRate * 0.10;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * inRate * 2.0; // 1h-TTL writes bill at 2x input rate
  const output = (usage.output_tokens || 0) * outRate;
  return (input + cacheRead + cacheWrite + output) / 1e6;
}

/** One model call. Streaming; adaptive thinking with SUMMARIZED display —
 *  on Fable/Opus-5-class models display defaults to "omitted", which streams
 *  thinking_delta events with EMPTY text: the ring froze for minutes during
 *  the reasoning phase with nothing to advance on. display:'summarized'
 *  streams readable summary text (billing unchanged) so the UI can show
 *  Jarvis literally thinking.
 *  Server-side refusal fallback enabled for fable/opus models.
 *  onText(textChars) fires as REAL output text streams in;
 *  onThinking(deltaText, totalThinkingChars) fires on each thinking summary
 *  delta; signal (AbortSignal) aborts the SDK stream mid-flight. */
async function callModel(client, system, messages, { onText, onThinking, signal } = {}) {
  const req = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive', display: 'summarized' },
    system,
    messages,
  };
  if (/^claude-(fable|opus)-/.test(MODEL)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  if (onText || onThinking) {
    let chars = 0;
    let thinkingChars = 0;
    stream.on('text', (delta) => {
      chars += delta.length;
      if (onText) { try { onText(chars) } catch (_) {} }
    });
    // Thinking summaries stream as thinking_delta events (readable text with
    // display:'summarized'); surface them so the progress UI stays alive
    // through the minutes-long reasoning phase.
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
        const t = event.delta.thinking || '';
        thinkingChars += t.length;
        if (onThinking) { try { onThinking(t, thinkingChars) } catch (_) {} }
      }
    });
  }
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    const why = response.stop_details?.explanation || 'model declined the request';
    throw new Error(`Model refused generation: ${why}`);
  }
  const truncated = response.stop_reason === 'max_tokens';
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return { text, usage: response.usage, model: response.model, truncated };
}

/**
 * Run the full surgical generation pipeline for one state machine.
 *
 * @returns {Promise<{ ok, l5x, validation, editPlan, reviewNotes, meta }>}
 * @throws {AiNotConfiguredError} when ANTHROPIC_API_KEY is not set
 */
async function generateL5X(projectJson, smId, options = {}) {
  const client = getClient(); // throws AiNotConfiguredError before any work

  // Live-progress plumbing (optional). onProgress(pct, stage, detail) is
  // called with monotonically increasing pct 0-100; signal (AbortSignal)
  // aborts the in-flight SDK stream when the caller cancels.
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const abortSignal = options.signal || null;
  // Expected output size for the writing progress ramp (45% -> 70%).
  // An edit plan is typically 5-15K tokens; ~20K keeps the bar honest.
  const EXPECTED_OUTPUT_TOKENS = 20000;
  // Expected thinking depth for the reasoning ramp (15% -> 45%). Build
  // history doesn't record thinking tokens yet, so this is a static budget;
  // if reasoning runs past it the ring HOLDS at the band top — it never
  // fakes progress and never steps backward.
  const EXPECTED_THINKING_TOKENS = 15000;

  const { system, stableText, jobText, ir, meta } = buildGenerationPrompt(projectJson, smId, options);
  onProgress(8, 'ir', 'Intermediate representation built');
  const templateXml = fs.readFileSync(meta.templatePath, 'utf8');
  const stamp = `Generated by JARVIS v${JARVIS_VERSION} (${currentEntry().date}) — SDC State Logic Builder`;

  // Cache layout: stable per-template content carries the breakpoint; the
  // per-job IR comes after it, so repeat runs and repair rounds reuse the
  // cached prefix.
  const messages = [{
    role: 'user',
    content: [
      // 1h TTL: attempts routinely run >5 minutes (adaptive thinking + long
      // plans), so the default 5m cache expired between repair rounds
      // (observed cacheRead=0 on every v1.0.1 benchmark attempt).
      { type: 'text', text: stableText, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: jobText },
    ],
  }];

  onProgress(15, 'prompt', `Prompt assembled (template: ${meta.template || 'selected'})`);

  const attempts = [];
  let l5x = null;
  let editPlan = null;
  let validation = { ok: false, errors: ['No generation attempt completed'], warnings: [] };
  let totalCost = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Attempt 1 streams 15% -> 70%; repair rounds squeeze into 88% -> 92%.
    const streamBase = attempt === 1 ? 15 : Math.min(88 + (attempt - 2) * 2, 91);
    const streamSpan = attempt === 1 ? 55 : 2;
    const stageName = attempt === 1 ? 'model' : 'repair';
    const stageDetail = attempt === 1
      ? 'Model authoring edit plan'
      : `Repair round ${attempt - 1}: model revising plan`;
    onProgress(streamBase, stageName, stageDetail);
    // Split the attempt's band: reasoning owns the first ~55% (attempt 1:
    // 15 -> 45), writing owns the rest (45 -> 70). Repair rounds split their
    // tiny band the same way.
    const thinkSpan = attempt === 1 ? 30 : streamSpan / 2;
    const writeBase = streamBase + thinkSpan;
    const writeSpan = streamSpan - thinkSpan;
    // Thinking-summary throttle state: at most one log line per ~2s, pct
    // updates at most 1/s, each line truncated to ~90 chars.
    let thinkBuf = '';
    let lastLineAt = 0;
    let lastPctAt = 0;
    const first = await callModel(client, system, messages, {
      signal: abortSignal,
      onThinking: (delta, thinkingChars) => {
        thinkBuf += delta;
        const thinkTokens = thinkingChars / 4; // rough chars->tokens
        const pct = streamBase + thinkSpan * Math.min(thinkTokens / EXPECTED_THINKING_TOKENS, 1);
        const now = Date.now();
        if (now - lastLineAt >= 2000 && thinkBuf.trim()) {
          const line = thinkBuf.replace(/\s+/g, ' ').trim();
          onProgress(pct, stageName,
            '· ' + (line.length > 90 ? line.slice(0, 90).trimEnd() + '…' : line));
          thinkBuf = '';
          lastLineAt = now;
          lastPctAt = now;
        } else if (now - lastPctAt >= 1000) {
          onProgress(pct, stageName); // pct-only tick — no log line
          lastPctAt = now;
        }
      },
      onText: (chars) => {
        const tokens = chars / 4; // rough chars->tokens
        const frac = Math.min(tokens / EXPECTED_OUTPUT_TOKENS, 1);
        onProgress(writeBase + writeSpan * frac, stageName,
          `${stageDetail} (~${Math.round(tokens).toLocaleString()} tokens streamed)`);
      },
    });
    let { text, usage, model } = first;
    let truncated = first.truncated;
    let cost = usage ? costOfUsage(usage, MODEL) : 0;
    totalCost += cost;
    const attemptUsage = usage ? {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
    } : null;
    // Record the assistant turn now — continuation and repair rounds both
    // build on it.
    messages.push({ role: 'assistant', content: text });

    let feedback = null; // set = this attempt failed; message goes back to the model
    let stage = null;
    let continuations = 0;

    // Continuation support: a plan that parses cleanly and ends with
    // "toBeContinued": true is a deliberate split — request the remainder and
    // concatenate the operations arrays. Only engages on clean JSON.
    let parsed = extractPlanJson(text);
    if (parsed.plan && parsed.plan.toBeContinued === true && Array.isArray(parsed.plan.operations)) {
      const basePlan = parsed.plan;
      const allOps = [...basePlan.operations];
      let chunk = basePlan;
      let contFailed = null;
      while (chunk && chunk.toBeContinued === true) {
        if (continuations >= MAX_CONTINUATIONS) {
          contFailed = `plan still marked toBeContinued after ${MAX_CONTINUATIONS} continuation calls`;
          break;
        }
        continuations++;
        onProgress(Math.min(streamBase + streamSpan, 87), stageName,
          `Continuation ${continuations}: requesting remaining operations (${allOps.length} so far)`);
        messages.push({
          role: 'user',
          content: `Continue your edit plan. You have sent ${allOps.length} operation(s) so far. ` +
            'Respond with ONLY a JSON object {"operations":[...], "toBeContinued": true|false} ' +
            'containing the REMAINING operations in order — do not repeat any operation already sent. ' +
            'Set "toBeContinued": false (or omit it) when the plan is complete.',
        });
        const cont = await callModel(client, system, messages, { signal: abortSignal });
        const contCost = cont.usage ? costOfUsage(cont.usage, MODEL) : 0;
        totalCost += contCost;
        cost += contCost;
        if (cont.usage && attemptUsage) {
          attemptUsage.input += cont.usage.input_tokens || 0;
          attemptUsage.output += cont.usage.output_tokens || 0;
          attemptUsage.cacheRead += cont.usage.cache_read_input_tokens || 0;
          attemptUsage.cacheWrite += cont.usage.cache_creation_input_tokens || 0;
        }
        messages.push({ role: 'assistant', content: cont.text });
        const p2 = extractPlanJson(cont.text);
        if (cont.truncated && !p2.plan) {
          contFailed = `continuation ${continuations} was itself truncated at ${MAX_TOKENS} tokens`;
          break;
        }
        if (!p2.plan || !Array.isArray(p2.plan.operations)) {
          contFailed = `continuation ${continuations} was not a valid JSON object with an "operations" array` +
            (p2.error ? ` (${p2.error})` : '');
          break;
        }
        chunk = p2.plan;
        allOps.push(...chunk.operations);
      }
      if (contFailed) {
        parsed = { plan: null, error: null };
        stage = 'continuation';
        feedback = `Your split edit plan could not be completed: ${contFailed}. ` +
          `You had sent ${allOps.length} operation(s). Continue with ONLY a JSON object ` +
          '{"operations":[...], "toBeContinued": true|false} containing the remaining operations, ' +
          'splitting into smaller chunks if needed.';
      } else {
        const combined = { ...basePlan, operations: allOps };
        delete combined.toBeContinued;
        parsed = { plan: combined, error: null };
        truncated = false; // each chunk was closed deliberately
      }
    }

    if (!feedback && truncated && !parsed.plan) {
      stage = 'truncated';
      const roughOps = (text.match(/"op"\s*:/g) || []).length;
      feedback = `Your response was truncated at ${MAX_TOKENS} output tokens` +
        (roughOps ? ` — the cut-off plan contained ~${roughOps} operations` : '') + '. Two ways to fix this: ' +
        '(1) produce a SMALLER edit plan — prefer updateRung over replaceRoutineRungs, use the shortest ' +
        'unique "match" strings, omit "notes", never restate unchanged rungs; or ' +
        '(2) SPLIT the plan across responses — end a response early with VALID, complete JSON whose last ' +
        'property is "toBeContinued": true; you will then be asked for the remainder and the ' +
        '"operations" arrays are concatenated in order before merging.';
    }

    if (!feedback) {
      const { plan, error } = parsed;
      if (error) { stage = 'parse'; feedback = `Your response was not a valid JSON edit plan. ${error}. Respond with ONLY the JSON object.`; }
      else {
        const schema = validatePlan(plan);
        if (!schema.ok) {
          stage = 'schema';
          feedback = 'Your edit plan failed schema validation. Fix every issue and respond with ONLY the corrected JSON plan:\n' +
            schema.errors.map(e => `- ${e}`).join('\n');
        } else {
          editPlan = plan;
          onProgress(attempt === 1 ? 78 : 91.5, 'merge', 'Merging edit plan into template');
          try {
            const merged = applyEditPlan(templateXml, plan, {
              smName: ir.smName, stationNumber: meta.stationNumber, stamp,
            });
            l5x = merged.xml;
          } catch (e) {
            if (!(e instanceof MergeError)) throw e;
            stage = 'merge';
            feedback = 'The merge engine could not apply your edit plan. Every anchor must match exactly once — ' +
              'for an ambiguous anchor, add "occurrence" (1-based index among the listed matches) or ' +
              '"nearComment" (substring of the intended rung\'s comment) to pin the rung. ' +
              'Fix these and respond with ONLY the corrected JSON plan:\n' +
              e.errors.map(x => `- ${x}`).join('\n');
          }
          if (!feedback) {
            onProgress(attempt === 1 ? 88 : 92, 'validate', 'Validating generated program');
            const v = validateL5X(l5x);
            const d = validateAgainstDiagram(projectJson, smId, l5x);
            validation = {
              ok: v.ok && d.ok,
              errors: [...v.errors, ...d.errors],
              warnings: [...v.warnings, ...d.warnings],
            };
            if (!validation.ok) {
              stage = 'validate';
              feedback = 'The merged program failed validation. Revise your edit plan to fix EVERY issue ' +
                'and respond with ONLY the corrected complete JSON plan:\n\n' + formatReport(validation);
            } else {
              stage = 'ok';
            }
          }
        }
      }
    }

    attempts.push({
      attempt,
      stage,
      ok: stage === 'ok',
      errors: validation.errors.length,
      warnings: validation.warnings.length,
      continuations,
      usage: attemptUsage,
      costUSD: Number(cost.toFixed(4)),
      model,
    });

    if (stage === 'ok') break;
    if (attempt === MAX_ATTEMPTS) {
      if (stage !== 'validate') {
        validation = { ok: false, errors: [`Pipeline stopped at stage "${stage}": ${feedback}`], warnings: [] };
      }
      break;
    }
    if (totalCost >= MAX_COST_USD) {
      validation = {
        ok: false,
        errors: [
          `Aborted: accumulated cost $${totalCost.toFixed(2)} reached the JARVIS_MAX_COST_USD cap ($${MAX_COST_USD}) after attempt ${attempt} (stage "${stage}")`,
          ...validation.errors,
        ],
        warnings: validation.warnings,
      };
      break;
    }
    messages.push({ role: 'user', content: feedback });
  }

  return {
    ok: validation.ok,
    l5x,
    validation,
    editPlan,
    reviewNotes: l5x ? extractReviewNotes(l5x) : [],
    // Full structured IR (irVersion 1) — persisted as .ir.json by the server /
    // benchmark harness so the UI can render the compiled "Full Controls" view.
    // `.text` remains the human-readable rendering (backward compatible).
    ir,
    meta: {
      ...meta,
      model: MODEL,
      maxOutputTokens: MAX_TOKENS,
      maxAttempts: MAX_ATTEMPTS,
      jarvisVersion: JARVIS_VERSION,
      attempts,
      repairRounds: attempts.length - 1,
      editPlanOps: editPlan ? (editPlan.operations || []).length : 0,
      costEstimate: {
        totalUSD: Number(totalCost.toFixed(4)),
        model: MODEL,
        pricingPerM: PRICING[MODEL] || PRICING['claude-opus-5'],
        note: 'input + 2.0x cache-write (1h TTL) + 0.10x cache-read + output, per attempt',
      },
    },
  };
}

module.exports = {
  generateL5X, isConfigured, AiNotConfiguredError,
  extractPlanJson, extractReviewNotes, costOfUsage, PRICING, MODEL, MAX_TOKENS, MAX_ATTEMPTS,
};
