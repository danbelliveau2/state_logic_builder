/**
 * reflexTurn.js — THE REFLEX LANE (Dan, 2026-09-01: interactive turns in
 * SECONDS; his acceptance case is the no-op — "names already match" must
 * answer in ~2s, not 2 minutes).
 *
 * ONE fast-model call, ZERO tool round-trips: the full current sheet,
 * cascade position, last ~10 turns, and the standing laws ride IN the prompt
 * (sheets are small; the stable blocks are cache-marked). The model emits
 * the SAME typed ops the agent loop uses (apply_edit / close_question /
 * note_to_engineer); the server applies them through executeTool — same
 * diffs, same receipts, same draft contract.
 *
 * ESCALATION: the reflex either resolves CONFIDENTLY or says deep —
 * structural split changes, shipped-code search, multi-intent, anything
 * init/codegen. When in doubt, escalate: correctness law unchanged. A
 * deterministic guard (ME-explicit pins, tombstones, machine-count,
 * Title Case) runs in ms on the result; any violation escalates too.
 *
 * Model: JARVIS_REFLEX_MODEL (default claude-haiku-4-5; falls back to the
 * loop's sonnet if haiku is unavailable at call time).
 */

const REFLEX_MODEL = process.env.JARVIS_REFLEX_MODEL || 'claude-haiku-4-5';
const FALLBACK_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 3000;
const CONFIDENCE_FLOOR = 0.6;

const { createTurnState, executeTool, normKey } = require('./agentTools.js');

const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const CONTRACT = [
  "You are the SDC Engineer's REFLEX — the fast lane for a mechanical engineer's chat",
  'turn on his station sheet. Everything you need is IN THIS PROMPT: the sheet, the',
  'walk position, the recent conversation, the standing laws. You get ONE shot, no',
  'tools, no searching. Handle ONLY what is safely yours:',
  '  - renames, value sets, moves, agrees/confirmations',
  '  - already-true no-ops ("those are already exactly your names — nothing to change")',
  '  - short factual questions the sheet itself answers',
  'CHECK BEFORE EDITING: read the sheet above FIRST — when the request is already',
  'true (names already match, value already set), emit edits: [] and SAY that:',
  '"Those are already exactly your names — nothing to change." Never claim an edit',
  'you did not need to make.',
  'ESCALATE (decision "deep") anything structural: split changes (add/remove/merge',
  'machines), sequence/recovery logic design, anything needing shipped-code evidence,',
  'multi-intent messages, initialization/codegen questions. WHEN IN DOUBT: deep.',
  '',
  'HARD LAWS (violations are never yours to risk):',
  '  - ME-EXPLICIT IS IMMUTABLE: a name/value the engineer set stays verbatim.',
  '  - Tombstoned devices never re-enter.',
  '  - No invented vocabulary — his words or names already on the sheet.',
  '  - Machine names: natural speech with spaces, Title Case.',
  '',
  'Respond ONLY with JSON:',
  '{"decision":"handle"|"deep","confidence":0.0-1.0,',
  ' "reply":"<plain words to the engineer — terse, his terms>",',
  ' "edits":[{"tool":"apply_edit"|"close_question"|"note_to_engineer","input":{...}}]}',
  'A no-op has edits: [] and a reply saying so. decision "deep" needs no reply.',
  '',
  'apply_edit input — BATCH with { ops: [ {op, ...}, ... ] }. The op vocabulary:',
  '  machine.rename {machine,newName} · device.rename {device,newName} ·',
  '  device.reassign {device,machine} · value.set {device,field,value} ·',
  '  sequence.reword {machine,line,step:{action,target,detail?}} ·',
  '  sequence.insert {machine,afterLine|beforeLine,step} · sequence.remove {machine,line} ·',
  '  recovery.reword/insert/remove {machine,...}',
  'Line refs: 1-based number or the line\'s exact text. Named things are Title Case.',
  'SEQUENCE STEPS ARE VERB + OBJECT, NOTHING ELSE: step = {action, target, detail?,',
  'counterpart?} with action from the operation set (Extend/Retract/Engage/Disengage/',
  'Servo Move/Index/Wait/Signal/Decide/Loop/Hold) and target = ONE named thing, never',
  'a clause, never leading punctuation, never a paraphrase of the whole line. A',
  'sequence.insert MUST carry afterLine or beforeLine (where it goes) — an insert',
  'without an anchor is rejected. Moving a line = remove + insert-with-anchor.',
  'Reordering more than one line, or any change to the branch/lane STRUCTURE',
  '(decisions, loops, retry lanes) = decision "deep".',
  'Anything beyond these ops (device.add/remove, split changes, recovery.set,',
  'multi-machine restructures) = decision "deep".',
].join('\n');

/** Slim sheet snapshot — everything a reflex decision can need, small. */
function sheetBlock(draft, cascadePosition) {
  const ms = draft?.smProposal?.stateMachines ?? [];
  return JSON.stringify({
    stationName: draft?.name ?? '',
    devices: (draft?.summary?.devices ?? []).map((d) => ({
      name: d.displayName ?? d.name, type: d.type, sensors: d.sensorArrangement,
      delays: d.delays, positions: d.positions, stroke: d.strokeMm,
    })),
    machines: ms.map((m) => ({
      name: m.name, nameByME: !!m.nameByME, oneLiner: m.oneLiner,
      ownedDeviceNames: m.ownedDeviceNames ?? m.deviceNames,
      sequence: m.sequence, faultRecovery: m.faultRecovery,
    })),
    deviceTombstones: draft?.deviceTombstones ?? [],
    controlsNotes: (draft?.controlsNotes ?? []).map((n) => n.text ?? n),
    cascadePosition: cascadePosition ?? null,
  });
}

/** Deterministic guard, runs in ms — a reflex result that trips ANY of these
 *  escalates instead of shipping. */
function reflexGuard(prevDraft, nextDraft) {
  const bad = [];
  const prevMs = prevDraft?.smProposal?.stateMachines ?? [];
  const nextMs = nextDraft?.smProposal?.stateMachines ?? [];
  for (const pm of prevMs) {
    if (pm?.nameByME && !nextMs.some((m) => m?.name === pm.name)) {
      bad.push(`ME-explicit name "${pm.name}" changed/dropped`);
    }
  }
  if (nextMs.length < prevMs.length) bad.push('machine dropped');
  const tombs = new Set((prevDraft?.deviceTombstones ?? []).map(nk));
  for (const d of (nextDraft?.summary?.devices ?? [])) {
    const k = nk(d.displayName ?? d.name);
    if (tombs.has(k)) bad.push(`tombstoned device re-added: ${d.displayName ?? d.name}`);
  }
  for (const m of nextMs) {
    if (/[_]|(?:[a-z][A-Z])/.test(String(m?.name ?? '')) ) bad.push(`machine name not natural speech: "${m.name}"`);
  }
  // SEQUENCE SHAPE (Dan, 2026-09-01 — the prose flatten): a reflex result
  // that adds ANY structured-step violation escalates; the vocabulary +
  // shape rules are objective and run in ms.
  try {
    const { sequenceGateViolations } = require('./smDecomposer.js');
    bad.push(...sequenceGateViolations(prevDraft, nextDraft));
  } catch { /* checker optional */ }
  return bad;
}

/**
 * @returns {{ handled: boolean, reason?, result?, meta? }}
 *   result matches the loop contract: { reply, diffs, asks, notes, draft }.
 */
async function runReflexTurn({ draft, message, cascadePosition = null, audience = 'ME', speaker = 'Dan', signal = null }) {
  if (!process.env.ANTHROPIC_API_KEY) return { handled: false, reason: 'no API key' };
  const t0 = Date.now();
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const { loadMeKnowledge } = require('./meKnowledge.js');
  let laws = '';
  try { laws = loadMeKnowledge(); } catch { /* optional */ }
  // RELEVANCE-LOADED KNOWLEDGE (Dan, 2026-09-01): only the concept modules
  // this turn touches ride — small, focused prompts.
  let concepts = { modules: [], text: '' };
  try {
    const { loadSelectedConcepts } = require('./conceptSelector.js');
    concepts = loadSelectedConcepts({
      deviceTypes: (draft?.summary?.devices ?? []).map((d) => String(d.type ?? '')),
      text: String(message),
      machineNames: (draft?.smProposal?.stateMachines ?? []).map((m) => String(m.name ?? '')),
    });
  } catch { /* optional */ }

  const thread = (Array.isArray(draft?.chatThread) ? draft.chatThread : []).slice(-10)
    .map((t) => `${t.role === 'me' ? 'ENGINEER' : 'SDC ENGINEER'}: ${String(t.text ?? '').slice(0, 220)}`).join('\n');

  const call = async (model) => client.beta.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: CONTRACT },
      // Stable, cacheable block: the standing laws + the turn's modules.
      { type: 'text', text: `# STANDING LAWS AND LESSONS\n${laws}${concepts.text ? `\n\n# CONCEPT MODULES (${concepts.modules.join(', ')})\n${concepts.text}` : ''}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: [
        '# THE SHEET (current, complete)',
        sheetBlock(draft, cascadePosition),
        '',
        '# RECENT CONVERSATION',
        thread || '(none)',
        '',
        `# THE ENGINEER'S MESSAGE (audience ${audience}, speaker ${speaker})`,
        String(message),
        '',
        'Decide: handle or deep. JSON only.',
      ].join('\n') }],
    }],
  }, signal ? { signal } : undefined);

  let resp;
  let model = REFLEX_MODEL;
  try { resp = await call(model); }
  catch (e) {
    if (e?.status === 404 || /model/i.test(String(e?.message))) {
      model = FALLBACK_MODEL;
      try { resp = await call(model); } catch (e2) { return { handled: false, reason: `reflex call failed: ${e2.message}` }; }
    } else return { handled: false, reason: `reflex call failed: ${e.message}` };
  }
  const costUSD = resp.usage
    ? Number((((resp.usage.input_tokens ?? 0) * 1 + (resp.usage.output_tokens ?? 0) * 5) / 1e6).toFixed(4))
    : 0;
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed = null;
  try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* not JSON */ }
  if (!parsed || parsed.decision !== 'handle' || Number(parsed.confidence ?? 0) < CONFIDENCE_FLOOR) {
    return { handled: false, reason: parsed ? `reflex says ${parsed.decision ?? '?'} (conf ${parsed?.confidence ?? '?'})` : 'unparseable reflex output' };
  }

  // Apply through the SAME typed tools — same diffs, receipts, guards.
  const ALLOWED = new Set(['apply_edit', 'close_question', 'note_to_engineer']);
  const state = createTurnState(draft, cascadePosition, { speaker });
  for (const e of (Array.isArray(parsed.edits) ? parsed.edits : [])) {
    if (!ALLOWED.has(e?.tool)) return { handled: false, reason: `reflex asked for non-reflex tool ${e?.tool}` };
    const r = executeTool(state, e.tool, e.input ?? {});
    if (r && r.error) return { handled: false, reason: `reflex edit failed: ${String(r.error).slice(0, 120)}` };
  }
  // No-op diffs (rename-to-same, set-to-same) are not changes — drop them,
  // and when NOTHING actually changed, say so honestly (Dan's acceptance
  // case) instead of echoing the model's "renamed" claim.
  const attemptedEdits = state.diffs.length;
  state.diffs = state.diffs.filter((d) => normKey(String(d?.before ?? '')) !== normKey(String(d?.after ?? '')));
  if (attemptedEdits && !state.diffs.length) {
    parsed.reply = 'Those are already exactly as you asked — nothing to change.';
  }

  const guard = reflexGuard(draft, state.draft);
  if (guard.length) return { handled: false, reason: `guard: ${guard.join('; ')}` };

  return {
    handled: true,
    result: {
      reply: String(parsed.reply ?? 'Done.'),
      diffs: state.diffs,
      asks: [],
      notes: [],
      closedQuestions: state.closedQuestions ?? [],
      draft: state.diffs.length ? state.draft : null, // no-op turns change nothing
    },
    meta: { lane: 'reflex', model, costUSD, ms: Date.now() - t0, confidence: Number(parsed.confidence) },
  };
}

module.exports = { runReflexTurn, _internals: { reflexGuard, sheetBlock } };
