/**
 * agentLoop.js — Phase 1 of the Jarvis agent loop (Dan approved 2026-08-28;
 * design: docs/jarvis-agent-loop-design.md).
 *
 * ONE turn = a tool-use loop: the agent reads what it needs, applies typed
 * edits that return real diffs, re-checks, and speaks last. Caps: $1.00 /
 * 90s / 25 tool calls. A CHECKER pass reviews the accumulated diffs against
 * the engineer's message before anything renders (one bounce).
 *
 * The receipt the engineer sees is composed FROM state.diffs by the caller —
 * the model's own narration never becomes a receipt.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { buildEngineContext } = require('./engineContext.js');
const { TOOL_DEFINITIONS, createTurnState, executeTool, eventLabelFor } = require('./agentTools.js');

const MODEL = process.env.JARVIS_AGENT_MODEL || 'claude-sonnet-5';
const CHECK_MODEL = process.env.JARVIS_CHECK_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_CALLS = parseInt(process.env.JARVIS_AGENT_MAX_CALLS, 10) || 25;
const MAX_COST_USD = Number(process.env.JARVIS_AGENT_MAX_COST_USD) || 1.0;
const MAX_MS = parseInt(process.env.JARVIS_AGENT_MAX_MS, 10) || 90000;

let _client = null;
function getClient() {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) { const e = new Error('ANTHROPIC_API_KEY is not configured'); e.code = 'AI_NOT_CONFIGURED'; throw e; }
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

// Same pricing shape the other engines use (approximate, USD / MTok).
const PRICES = {
  'claude-sonnet-5': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-5': { in: 15, out: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};
function costOf(usage, model) {
  const p = PRICES[model] || PRICES['claude-sonnet-5'];
  if (!usage) return 0;
  return ((usage.input_tokens ?? 0) * p.in
    + (usage.output_tokens ?? 0) * p.out
    + (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite
    + (usage.cache_read_input_tokens ?? 0) * p.cacheRead) / 1e6;
}

function systemBlocks() {
  // Static block, prompt-cached: the contract + the standing laws.
  // Precedents / concepts / shipped code come through the READ TOOLS —
  // the ONE knowledge access layer shared with codegen (Dan's ONE BRAIN).
  const contract = [
    "You are JARVIS, SDC Automation's controls engineer, working a mechanical engineer's",
    'station draft as an AGENT: read what you need, edit through the typed tools, verify,',
    'then speak. THE CONTRACT:',
    '- ONE ENGINE: you are the same engineer who builds the station. Decide like SDC has',
    '  always decided — from precedent and the standing rulings; invention is the last resort.',
    '- READ BEFORE YOU WRITE: always read_sheet before editing. Edit ONLY what the engineer\'s',
    '  message calls for; everything else carries forward untouched.',
    '- TAG FEEDBACK IS NOT LINE FEEDBACK: "doesn\'t need to interact" = sequence.clear_tag,',
    '  NEVER sequence.remove. Deleting a step requires the engineer explicitly asking to',
    '  remove the step. When in doubt: keep the line, clear the tag.',
    '- REMOVALS ARE ATOMIC: device.remove handles the row, its questions, and its record in',
    '  one call — use it, never a partial.',
    '- AN EXPLICIT DIRECTIVE IS FINAL: "get rid of X" means remove X, now, no confirmation.',
    '  NEVER undo your own applied edit to ask whether he meant it; NEVER re-add what he told',
    '  you to remove. Confirm-first is for ambiguity only — an explicit instruction has none.',
    '- Never add or change tags the message did not ask about.',
    '- SIGNALS have both sides: a new wait needs its setter in the counterpart machine\'s',
    '  sequence (two edits). Sequence lines use the SDC operation vocabulary: Extend/Retract,',
    '  Engage/Disengage (grippers — never Open/Close), Servo Move, Index, Wait, Signal, Home.',
    '- SCOPE: the walked machine is the focus. Feedback about another machine is applied',
    '  there silently — the engineer finds it when the walk arrives; do not discuss it.',
    '  Never sweep or restyle lines the message does not touch (vocabulary fixes included) —',
    '  standing-law cleanups happen at gates, not as side effects of an unrelated request.',
    '- QUESTIONS: search precedents and the shipped code FIRST (cite what you find);',
    '  ask_engineer only for what nothing answers — and say you searched. Mechanical and',
    '  geometry questions belong to the engineer; controls decisions are yours.',
    '- VOICE: speak TO the engineer, second person, plain SDC speech, terse. Never explain',
    '  his own words back to him. Never print checker/internal notes.',
    '- YOUR FINAL MESSAGE: at most two short sentences. The receipt of what changed is',
    '  computed from your edits automatically — do NOT enumerate your edits; add only what',
    '  the diffs cannot say (an answer, a citation, a genuine question).',
    '- HONESTY: if you could not do something, say so plainly. Never claim an edit you did',
    '  not make; the diffs are checked.',
    '- NEVER REPLY EMPTY: when a message needs no edits (already done, already correct),',
    '  SAY that reading back in one sentence — e.g. "Those tags are already gone — nothing',
    '  needed changing." A silent turn is a hard failure.',
  ].join('\n');
  const laws = buildEngineContext(['meKnowledge']);
  return [
    { type: 'text', text: contract },
    { type: 'text', text: laws || '(no standing laws file found)', cache_control: { type: 'ephemeral' } },
  ];
}

/**
 * Run one agent turn.
 * @param {object} args
 * @param {object} args.draft            client draft snapshot
 * @param {string} args.message          the engineer's message (or gate framing)
 * @param {object} [args.cascadePosition]
 * @param {AbortSignal} [args.signal]
 * @param {(label:string)=>void} [args.onEvent]  streamed activity states
 */
async function runAgentTurn({ draft, message, cascadePosition = null, signal = null, onEvent = null }) {
  const client = getClient();
  const state = createTurnState(draft, cascadePosition);
  const t0 = Date.now();
  let cost = 0;
  let calls = 0;
  const emit = (label) => { try { onEvent?.(label); } catch { /* display only */ } };

  const system = systemBlocks();
  const messages = [{
    role: 'user',
    content: [
      cascadePosition?.activeStep?.label
        ? `(The engineer is on the "${cascadePosition.activeStep.label}" step.)`
        : '',
      `THE ENGINEER SAYS:\n${String(message ?? '').trim()}`,
      '\nWork the turn: read what you need, apply the edits his words call for, then reply in at most two short sentences.',
    ].filter(Boolean).join('\n'),
  }];

  let bounced = false;
  let capReason = null;
  let finalText = '';

  for (;;) {
    if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const overCap = calls >= MAX_TOOL_CALLS ? 'tool-call cap'
      : cost >= MAX_COST_USD ? 'cost cap'
        : (Date.now() - t0) >= MAX_MS ? 'time cap' : null;
    if (overCap && !capReason) {
      capReason = overCap;
      messages.push({
        role: 'user',
        content: `CAP REACHED (${overCap}). Apply nothing further. State honestly, in one or two sentences, what you did and did not get to.`,
      });
    }
    emit(calls === 0 ? 'thinking…' : 'thinking…');
    const response = await client.messages.create(
      {
        model: MODEL, max_tokens: 3000, system,
        tools: capReason ? [] : TOOL_DEFINITIONS,
        // READ BEFORE ANYTHING (structural, not advisory): the first
        // iteration MUST call a tool — chat history never substitutes for
        // reading the sheet as it is right now.
        ...(calls === 0 && !capReason ? { tool_choice: { type: 'any' } } : {}),
        messages,
      },
      signal ? { signal } : undefined
    );
    cost += costOf(response.usage, response.model || MODEL);

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();

    if (response.stop_reason !== 'tool_use' || !toolUses.length || capReason) {
      // The model finished speaking. Checker-over-diffs (one bounce).
      if (!bounced && !capReason) {
        emit('checking the work…');
        const chk = await checkTurn({ client, message, state, signal }).catch(() => null);
        if (chk) cost += chk.cost;
        if (chk && chk.verdict === 'fix' && chk.violations.length) {
          bounced = true;
          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'user',
            content: 'REVIEW FOUND PROBLEMS with this turn — fix them now via the tools, then reply again:\n'
              + chk.violations.map((v) => `- ${v}`).join('\n'),
          });
          continue;
        }
      }
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const tu of toolUses) {
      calls += 1;
      emit(eventLabelFor(tu.name, tu.input));
      let out;
      try { out = executeTool(state, tu.name, tu.input ?? {}); } catch (e) { out = { error: e.message }; }
      results.push({
        type: 'tool_result', tool_use_id: tu.id,
        content: JSON.stringify(out).slice(0, 30000),
        ...(out && out.error ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  // NEVER SILENT (send-path law): an empty reply with no edits gets an
  // honest fallback; with edits, the computed receipt carries the turn.
  if (!finalText && !state.diffs.length) {
    finalText = 'I read that and found nothing that needed changing — if you expected an edit, tell me which line or device.';
  }
  return {
    reply: finalText,
    diffs: state.diffs,
    asks: state.asks,
    notes: state.notes,
    closedQuestions: state.closedQuestions,
    draft: state.draft,
    capped: capReason,
    meta: { model: MODEL, toolCalls: calls, costUSD: Number(cost.toFixed(4)), ms: Date.now() - t0, bounced },
  };
}

/** Checker-over-diffs: did the turn's actual edits honor the message + laws? */
async function checkTurn({ client, message, state, signal }) {
  const sys = [
    'You are the REVIEWER for an SDC controls agent turn. The engineer sent a message; the',
    'agent applied the DIFFS below to the station draft. Check ONLY:',
    '1. Every edit the message called for shows up in the diffs (approval-with-comments =',
    '   approval PLUS every embedded edit).',
    '2. Nothing was deleted the message did not explicitly ask to delete (a comment about a',
    '   line\'s interaction/tag never authorizes deleting the line).',
    '3. New waits have their setter side (both-sides rule) when the message implies one.',
    '4. Sequence lines use the SDC vocabulary (Engage/Disengage for grippers, never Open/Close).',
    'ONLY OBJECTIVE FAILURES are violations: a requested edit missing from the diffs, an',
    'unrequested deletion, a missing counterpart side, wrong vocabulary ON AN EDITED LINE.',
    'An applied explicit directive is CORRECT — never second-guess it, never ask to confirm',
    'what the engineer explicitly ordered. Untouched lines are not in scope. If the diffs',
    'satisfy the message, the verdict is pass.',
    'Respond ONLY JSON: { "verdict": "pass" | "fix", "violations": ["<one line each>"] }',
    buildEngineContext(['meKnowledge']),
  ].join('\n');
  // The RESULTING state rides so "already done" claims are checkable.
  const machinesNow = (state.draft?.smProposal?.stateMachines ?? []).map((m) => ({
    name: m.name,
    sequence: (m.sequence ?? []).map((l, i) => `${i + 1}. ${l}`),
    tags: (m.sequenceSteps ?? []).map((s, i) => (s?.counterpart ? `${i + 1}→${s.counterpart}` : null)).filter(Boolean),
  }));
  const user = [
    '# The engineer\'s message', String(message ?? '').trim(),
    '', '# The diffs the agent applied', JSON.stringify(state.diffs, null, 1),
    '', '# The RESULTING sequences (numbered) + interaction tags (line→counterpart)',
    JSON.stringify(machinesNow, null, 1),
    '', '# Questions filed / closed',
    JSON.stringify({ asked: state.asks.map((a) => a.question), closed: state.closedQuestions }),
  ].join('\n');
  const r = await client.messages.create(
    { model: CHECK_MODEL, max_tokens: 1200, system: sys, messages: [{ role: 'user', content: user }] },
    signal ? { signal } : undefined
  );
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  let parsed = { verdict: 'pass', violations: [] };
  try { parsed = JSON.parse(text.slice(s, e + 1)); } catch { /* pass */ }
  return {
    verdict: parsed.verdict === 'fix' ? 'fix' : 'pass',
    violations: (Array.isArray(parsed.violations) ? parsed.violations : []).map(String).slice(0, 8),
    cost: costOf(r.usage, CHECK_MODEL),
  };
}

module.exports = { runAgentTurn };
