/**
 * agentLoopSdk.js — THE EMBEDDED HARNESS (Dan, 2026-08-30: "build the exact
 * same chat window with the exact same skills right into the tool… it works
 * the same, it's just an API key running it").
 *
 * The engine is the Claude Agent SDK (@anthropic-ai/claude-agent-sdk — the
 * embeddable Claude Code engine, self-contained runtime bundled by npm).
 * This module replaced the hand-rolled tool-use loop (agentLoop.js, deleted
 * same release — one-door law). Everything the UI knew stays identical:
 * same runAgentTurn signature, same {reply, diffs, asks, notes, draft,
 * capped, meta} result, receipts still composed from the typed diffs.
 *
 * TOOL SCOPING IS THE SECURITY MODEL (Dan): the engine gets ONLY the
 * station-data tools registered below (in-process MCP). Every built-in is
 * disallowed by name AND permissionMode 'dontAsk' denies anything not
 * explicitly allowed AND settingSources:[] + an isolated CLAUDE_CONFIG_DIR
 * keep this machine's Claude Code login/settings/memory out of it.
 * Engineers change station information, never the app.
 *
 * SESSIONS: one SDK session per draft (jarvis-knowledge/agent-sessions.json
 * maps draftId → sessionId; transcripts live under the isolated config
 * dir), so the thread has real continuity — but tools always operate on the
 * TURN's working draft (the client stays the storage authority), and the
 * read-before-write contract forces a fresh read_sheet every turn.
 */

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { query, tool, createSdkMcpServer } = require('@anthropic-ai/claude-agent-sdk');
const { buildEngineContext } = require('./engineContext.js');
const { createTurnState, executeTool, eventLabelFor, TOOL_DEFINITIONS } = require('./agentTools.js');

const ROOT = path.join(__dirname, '..', '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const MODEL = process.env.JARVIS_LOOP_MODEL || process.env.JARVIS_AGENT_MODEL || 'claude-opus-5';
const CHECK_MODEL = process.env.JARVIS_CHECK_MODEL || 'claude-haiku-4-5';
const MAX_TURNS = parseInt(process.env.JARVIS_AGENT_MAX_CALLS, 10) || 25;
const MAX_BUDGET_USD = Number(process.env.JARVIS_AGENT_MAX_COST_USD) || 2.0;
const MAX_MS = parseInt(process.env.JARVIS_AGENT_MAX_MS, 10) || 240000;

// Isolated harness home: transcripts, no user settings, no auto-memory.
const RUNTIME_DIR = path.join(ROOT, 'jarvis-knowledge', 'agent-runtime');
const WORK_DIR = path.join(RUNTIME_DIR, 'work');
const SESSIONS_PATH = path.join(RUNTIME_DIR, 'agent-sessions.json');

// Every built-in the harness ships — disallowed BY NAME (belt) on top of
// permissionMode 'dontAsk' (suspenders). The engine sees station tools only.
const DISALLOWED_BUILTINS = [
  'Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite',
  'Skill', 'SlashCommand', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree',
  'ListMcpResources', 'ReadMcpResource', 'Monitor', 'TaskStop', 'SendMessage',
  'ToolSearch', 'Artifact',
];

function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8')); } catch { return {}; }
}
function writeSessions(map) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(map, null, 2) + '\n', 'utf8');
  } catch { /* continuity is best-effort; a lost id just starts a fresh session */ }
}

// ── the station tool server (in-process MCP over our typed registry) ────────
// Descriptions come from agentTools.TOOL_DEFINITIONS — ONE source of truth.
const descOf = (name) => TOOL_DEFINITIONS.find((t) => t.name === name)?.description ?? name;

function buildStationServer(state) {
  const wrap = (name) => async (args) => {
    let out;
    try { out = executeTool(state, name, args ?? {}); } catch (e) { out = { error: e.message }; }
    return {
      content: [{ type: 'text', text: JSON.stringify(out).slice(0, 30000) }],
      ...(out && out.error ? { isError: true } : {}),
    };
  };
  const loose = z.any();
  return createSdkMcpServer({
    name: 'station',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool('read_sheet', descOf('read_sheet'), {}, wrap('read_sheet')),
      tool('read_chat_history', descOf('read_chat_history'), { limit: z.number().optional() }, wrap('read_chat_history')),
      tool('read_cascade_position', descOf('read_cascade_position'), {}, wrap('read_cascade_position')),
      tool('read_knowledge', descOf('read_knowledge'), { name: z.string().optional() }, wrap('read_knowledge')),
      tool('search_precedents', descOf('search_precedents'), { query: z.string() }, wrap('search_precedents')),
      tool('search_shipped_code', descOf('search_shipped_code'), { query: z.string(), maxResults: z.number().optional() }, wrap('search_shipped_code')),
      tool('apply_edit', descOf('apply_edit'), {
        op: z.string().optional(),
        ops: z.array(z.record(z.string(), loose)).optional(),
        device: z.string().optional(), name: z.string().optional(), newName: z.string().optional(),
        machine: z.string().optional(), evidence: z.string().optional(),
        line: loose.optional(), afterLine: z.number().optional(),
        step: loose.optional(), counterpart: z.string().optional(),
        field: z.string().optional(), value: loose.optional(), type: z.string().optional(),
        recovery: z.array(loose).optional(),
      }, wrap('apply_edit')),
      tool('close_question', descOf('close_question'), { question: z.string(), answer: z.string().optional() }, wrap('close_question')),
      tool('ask_engineer', descOf('ask_engineer'), {
        covKey: z.enum(['devices', 'sequence', 'failures', 'interactions']).optional(),
        question: z.string(), proposedSolution: z.string().optional(), evidence: z.string(),
      }, wrap('ask_engineer')),
      tool('file_knowledge', descOf('file_knowledge'), { fact: z.string(), citedTo: z.string().optional() }, wrap('file_knowledge')),
      tool('propose_split', descOf('propose_split'), { stateMachines: z.array(loose), reasoning: z.string().optional() }, wrap('propose_split')),
      tool('file_law', descOf('file_law'), { rule: z.string() }, wrap('file_law')),
      tool('suggest_app_change', descOf('suggest_app_change'), { ask: z.string(), reading: z.string() }, wrap('suggest_app_change')),
      tool('note_to_engineer', descOf('note_to_engineer'), { text: z.string() }, wrap('note_to_engineer')),
      tool('file_controls_note', descOf('file_controls_note'), { text: z.string() }, wrap('file_controls_note')),
    ],
  });
}

// ── the voice + laws system prompt (full replacement of the default) ───────
function audienceBlock(audience) {
  if (String(audience).toUpperCase() === 'CE') {
    return [
      '- AUDIENCE: a CONTROLS engineer. Controls speech is welcome — tag names, routine',
      '  structure, rung logic, signal parameters, implementation detail. Be precise and',
      '  technical; cite shipped code the way one CE cites another\'s.',
    ].join('\n');
  }
  return [
    '- AUDIENCE: a MECHANICAL engineer. Speak in mechanical terms ONLY — motions, parts,',
    '  sensors, grippers, stations, timing. NO code or controls vocabulary, ever: no tag',
    '  names (p_PartReady), no rungs, OTL/OTU, routine or program names, no PLC-speak.',
    '  "Signal" as a concept is fine ("the escapement signals part-ready"); a tag is not.',
    '  Ground every explanation in what the machine physically does.',
  ].join('\n');
}

// THE DECOMPOSE GATE's extra contract (Phase 2, Dan 2026-08-30): the same
// doctrine the one-shot decomposer carried, now spoken to the agent.
const DECOMPOSE_GATE_BLOCK = [
  '',
  'THIS TURN IS A DECOMPOSE GATE: read the explanation (and the current proposal when one',
  'rides along), search precedents/concepts as needed, then produce or revise the split via',
  'ONE propose_split call. propose_split is MANDATORY this turn — even when the engineer asks',
  'for your ideas or open questions remain: THE PROPOSAL IS your answer, the concrete thing',
  'he reviews. File genuine blockers with ask_engineer IN ADDITION, never instead. A decompose',
  'turn that ends without propose_split is a failed turn. The doctrine:',
  '- THE ASYNCHRONY TEST: a purely sequential station is ONE machine; a second machine must',
  '  be justified by real overlap in time (its "why" says so, to the engineer).',
  '- Machine names are natural SDC speech with spaces ("Mid Base Escapement"), SPECIFIC to',
  '  what they handle — never a generic mechanism word alone, never PascalCase.',
  '- Every sheet device is owned by exactly one machine; sequences use structured steps',
  '  (device links, canonical shapes, decisions allowed); faultRecovery is a branching flow',
  '  on the shipped home pattern. Sequence lines: NO parenthetical annotations, ever.',
  '- CORRECTION ROUNDS: the current proposal rides along COMPLETE — the feedback edits IT;',
  '  everything untouched carries forward VERBATIM. Approved machine names are identity-',
  '  locked (the tool enforces it). Dictated feedback resolves against the REAL names.',
  '- After propose_split, your final message is the reasoning spoken to the engineer plus',
  '  the guide line (what to look at, what to approve next).',
].join('\n');

function systemPromptFor(audience, gate = null) {
  const contract = [
    "You are JARVIS, SDC Automation's controls engineer, working an engineer's station",
    'draft as an AGENT: read what you need, edit through the typed tools, verify, then',
    'speak. Your ONLY tools are the station tools — there is no file system, no shell,',
    'no web; never claim otherwise. THE CONTRACT:',
    audienceBlock(audience),
    '- CONVERSE WHEN THE TOPIC IS OPEN: when his message offers options or tradeoffs, a',
    '  short back-and-forth is GOOD — state the options in his terms, give YOUR',
    '  recommendation with the precedent reason, and ask which he wants. Apply what is',
    '  settled either way. Never re-ask settled things; land on a clear ball-location.',
    '- ONE ENGINE: decide like SDC has always decided — from precedent and the standing',
    '  rulings below; invention is the last resort.',
    '- THE THREE TIERS (what a message can change): TIER 1 — STATION DATA: devices, sequences,',
    '  recovery, questions — apply through the typed tools, as always. TIER 2 — DOCTRINE: a',
    '  stated RULE about how you should think or behave ("sequences must always use real',
    '  device names") → file_law; your reply confirms it plainly ("filed as a standing rule —',
    '  active" for Dan; "…pending Dan\'s approval" for anyone else). TIER 3 — APP CHANGES: how',
    '  things render, new panels, new features → you CANNOT change the app and must never',
    '  fake it with data edits; say so honestly and suggest_app_change (verbatim ask + your',
    '  reading) — "filed for Dan\'s review". Classifying the tier is YOUR judgment; a message',
    '  can span tiers — handle each part in its tier. Never silently drop any part.',
    '- THE OPTIONAL CE LANE: a CONTROLS engineer stating controls intent for THIS station',
    '  (signal handling — what sets/clears it, latching vs event; logic preferences) →',
    '  file_controls_note; it lands in the sheet\'s Controls notes and guides this station\'s',
    '  codegen with authority between Dan\'s words and generic precedent — never above SDC',
    '  standards or the ME\'s approved mechanical content (a conflict becomes a question).',
    '  A rule meant for EVERY station is Tier 2 → file_law (queues for Dan unless Dan said it).',
    '- DEVICE-LINKED LINES: every action line references a REAL device by its devId',
    '  (read_sheet lists them) with the device\'s CURRENT name as target — never shorthand',
    '  ("Z", "X"), never a made-up name. Waits reference the real sensor/signal record.',
    '- DETAIL RULES BY DEVICE TYPE (Dan): a pneumatic action IS the whole statement —',
    '  "Retract Vertical Slide", NEVER a trailing clause ("— to clear height" is wrong; the',
    '  sensors/timers say when it\'s there). Servo Move DOES carry the named position:',
    '  "Servo Move X Axis — Place Position". Waits/signals keep their object. TITLE CASE for',
    '  every named thing — devices, named positions, signals ("Place Position", "Part-Ready',
    '  Signal") — ordinary sentence words stay normal.',
    '- RECOVERY IS A BRANCHING FLOW, like the diagram: linear steps until a DECISION, then',
    '  labeled branches — write it with apply_edit {op:"recovery.set", machine, recovery:',
    '  [ step | {decision:"Gripper Engaged?", branches:[{label:"Yes", steps:[…]},',
    '  {label:"No", steps:[…]}]} ]}. NEVER inline "if …" conditions in a step\'s text.',
    '- READ BEFORE YOU WRITE: always read_sheet before editing — chat history never',
    '  substitutes for the sheet as it is right now. Edit ONLY what the engineer\'s message',
    '  calls for; everything else carries forward untouched.',
    '- TAG FEEDBACK IS NOT LINE FEEDBACK: "doesn\'t need to interact" = sequence.clear_tag,',
    '  NEVER sequence.remove. Deleting a step requires an explicit ask to remove the step.',
    '  When in doubt: keep the line, clear the tag.',
    '- REMOVALS ARE ATOMIC: device.remove handles the row, its questions, and its record in',
    '  one call — use it, never a partial.',
    '- AN EXPLICIT DIRECTIVE IS FINAL: "get rid of X" means remove X, now, no confirmation.',
    '  NEVER undo your own applied edit to ask whether he meant it.',
    '- Never add or change tags the message did not ask about. Never sweep or restyle lines',
    '  the message does not touch — standing-law cleanups happen at gates, not as side',
    '  effects of an unrelated request.',
    '- BATCH EDITS: a multi-line draft (a recovery, several sequence fixes) goes in ONE',
    '  apply_edit call with `ops` — never one call per line.',
    '- SIGNALS have both sides: a new wait needs its setter in the counterpart machine\'s',
    '  sequence. Sequence lines use the SDC operation vocabulary: Extend/Retract,',
    '  Engage/Disengage (grippers — never Open/Close), Servo Move, Index, Wait, Signal, Home.',
    '- SCOPE: the walked machine is the focus. Feedback about another machine is applied',
    '  there silently — the engineer finds it when the walk arrives; do not discuss it.',
    '- QUESTIONS: search precedents and the shipped code FIRST (cite what you find);',
    '  ask_engineer only for what nothing answers — evidence is REQUIRED. Mechanical and',
    '  geometry questions belong to the engineer; controls decisions are yours.',
    '- HIS ANSWERS RESOLVE QUESTIONS: one message often answers SEVERAL questions. Before',
    '  finishing, walk EVERY open question against his WHOLE message — each answered one',
    '  gets applied and close_question\'d; a confirmation of your proposal IS an answer.',
    '- EVERY INTENT LANDS: a message can carry answers AND a recovery description AND a',
    '  directive at once; a resent message is UNCONSUMED until every intent is applied or',
    '  explicitly answered. Enumerate the intents; account for each.',
    '- RESEARCH DIRECTIVES: "do we have examples in our code?" is a SEARCH TASK — run the',
    '  searches and answer with cited findings. Found nothing = say so explicitly.',
    '- GENERAL PATTERNS HE TEACHES → file_knowledge, dated, cited to him.',
    '- BE THE GUIDE: the cascade position carries the current step, its open questions, the',
    '  NEXT step, and the remaining count — SPEAK it. End every reply with the lead: what',
    '  closed, what is open here, the concrete next action, where to look.',
    '- SPEAK YOUR READING FIRST: on any substantive request, open with ONE or two plain',
    '  sentences saying how you read it — scope and intent — before or alongside your first',
    '  tool calls. Skip for trivial value-sets and agrees.',
    '- YOUR FINAL MESSAGE — THE SPEAKING LAYER: two to four sentences TO the engineer, in',
    '  HIS terms, about HIS content. Confirm each of his points/questions by name. One WHY',
    '  clause on judgment calls. INTERNAL MECHANICS NEVER PRINT: no "tool", "op", "diff",',
    '  "cap", line counts, or tool-failure stories. An internal step that failed while the',
    '  engineering outcome stands = say NOTHING about it. An outcome genuinely missing =',
    '  plain words + "I\'ll pick it up on your next message". The detailed change list',
    '  attaches automatically — never recite it. NEVER reply empty.',
    '- HONESTY: never claim an edit you did not make; the diffs are checked.',
  ].join('\n');
  const laws = buildEngineContext(['meKnowledge']);
  return `${contract}${gate === 'decompose' ? `\n${DECOMPOSE_GATE_BLOCK}` : ''}\n\n${laws || ''}`;
}

// ── the checker-over-diffs (our post-turn gate — unchanged discipline) ──────
let _anthropic = null;
function anthropicClient() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic();
  }
  return _anthropic;
}
const CHECK_PRICES = { in: 1, out: 5 };
async function checkTurn({ message, state, signal }) {
  const sys = [
    'You are the REVIEWER for an SDC controls agent turn. The engineer sent a message; the',
    'agent applied the DIFFS below to the station draft. Check ONLY:',
    '1. Every edit the message called for shows up in the diffs (approval-with-comments =',
    '   approval PLUS every embedded edit).',
    '2. Nothing was deleted the message did not explicitly ask to delete (a comment about a',
    '   line\'s interaction/tag never authorizes deleting the line).',
    '3. New waits have their setter side (both-sides rule) when the message implies one.',
    '4. Sequence lines use the SDC vocabulary (Engage/Disengage for grippers, never Open/Close).',
    '5. Every question asked carries evidence (cited shipped work or explicit found-nothing).',
    '6. A question was asked whose answer already exists in the engineer\'s messages upthread —',
    '   violation: his answer should have been filed, not re-asked.',
    '7. DEVICE-LINKED LINES: an edited action line (Extend/Retract/Engage/Disengage/Servo Move)',
    '   whose target is not a REAL device on that machine (shorthand like "Z" or "X", or a',
    '   made-up name) is a violation — the target must be the device\'s current name.',
    '8. TIER BOUNDARY: a request that needs an APP change (render, panels, new features) must',
    '   have been filed as an app suggestion, never applied as a data mutation — a data edit',
    '   that fakes an app behavior is a violation.',
    '9. DETAIL RULES: an edited PNEUMATIC action line carrying a detail clause ("Retract X —',
    '   to clear height") is a violation — the action is the whole statement. An edited Servo',
    '   Move without its named position is a violation the other way. Named things Title Case.',
    '10. RECOVERY SHAPE: an edited recovery containing inline "if …" conditions in step text',
    '    is a violation — recovery is a branching flow (decision + labeled branches).',
    'ONLY OBJECTIVE FAILURES are violations: a requested edit missing from the diffs, an',
    'unrequested deletion, a missing counterpart side, wrong vocabulary ON AN EDITED LINE.',
    'An applied explicit directive is CORRECT — never second-guess it. Untouched lines are',
    'not in scope. If the diffs satisfy the message, the verdict is pass.',
    'Respond ONLY JSON: { "verdict": "pass" | "fix", "violations": ["<one line each>"] }',
    buildEngineContext(['meKnowledge']),
  ].join('\n');
  const machinesNow = (state.draft?.smProposal?.stateMachines ?? []).map((m) => ({
    name: m.name,
    sequence: (m.sequence ?? []).map((l, i) => `${i + 1}. ${l}`),
    faultRecovery: m.faultRecovery ?? [],
    tags: (m.sequenceSteps ?? []).map((s, i) => (s?.counterpart ? `${i + 1}→${s.counterpart}` : null)).filter(Boolean),
  }));
  const user = [
    '# The engineer\'s message', String(message ?? '').trim(),
    '', '# His recent messages upthread (for rule 6 — never re-ask what these answer)',
    (state.draft?.chatThread ?? []).filter((t) => t?.role === 'me').slice(-5)
      .map((t) => `- ${String(t.text ?? '').slice(0, 400)}`).join('\n') || '(none)',
    '', '# The diffs the agent applied', JSON.stringify(state.diffs, null, 1),
    '', '# The RESULTING machines', JSON.stringify(machinesNow, null, 1),
    '', '# Questions filed / closed',
    JSON.stringify({ asked: state.asks.map((a) => a.question), closed: state.closedQuestions }),
  ].join('\n');
  const r = await anthropicClient().messages.create(
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
    cost: r.usage ? ((r.usage.input_tokens ?? 0) * CHECK_PRICES.in + (r.usage.output_tokens ?? 0) * CHECK_PRICES.out) / 1e6 : 0,
  };
}

// ── the can-hang guard (P0, 2026-08-30: a rewrite culled Pick-and-Place's
// outgoing part-gripped/part-clear signals and deadlocked both machines) ────
// Minimal mirror of cascadeModel.checkHandshakes rule 1 (that file is ESM /
// client-side; keep the two parsers in step). Cross-machine waits whose
// partner never signals = the can-hang-forever class. A turn may never
// INTRODUCE one: signals are legal data steps even though the flow render
// doesn't draw them — culling them is an objective failure, bounced.
function unmatchedWaits(machines = []) {
  const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const sigKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[0-9]/g, (c) => NUMW[+c]).replace(/signal$/, '');
  const nk = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const keysMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const ms = (machines ?? []).map((m) => ({
    name: m?.name, key: nk(m?.name),
    events: (m?.sequence ?? []).map(String).map((t) => {
      let mm = t.match(/^wait\s+for\s+(.+?)['’]s\s+(.+?)\s*(?:signal)?\s*$/i);
      if (mm) return { type: 'wait', from: mm[1], sig: sigKey(mm[2]), line: t };
      mm = t.match(/^(?:signal|set)\s+(.+?)\s+to\s+([A-Za-z0-9 '’.&-]+?)\s*$/i);
      if (mm) return { type: 'set', to: mm[2], sig: sigKey(mm[1]), line: t };
      return { type: 'other', line: t };
    }),
  }));
  const out = [];
  for (const m of ms) {
    for (const w of m.events.filter((e) => e.type === 'wait')) {
      const partner = ms.find((x) => x !== m && (keysMatch(nk(w.from), x.key) || keysMatch(x.key, nk(w.from))));
      if (!partner) continue;
      if (!partner.events.some((e) => e.type === 'set' && keysMatch(e.sig, w.sig))) {
        out.push(`${m.name}'s "${w.line}" can never be satisfied — ${partner.name} never signals it; the station would fault on timeout every cycle`);
      }
    }
  }
  return out;
}

// ── one turn through the embedded harness ───────────────────────────────────
/** Same contract as the old loop: {draft, message, cascadePosition, audience,
 *  draftId?, signal, onEvent} → {reply, diffs, asks, notes, closedQuestions,
 *  draft, capped, meta}. onEvent gets strings (activity) or {reading}. */
async function runAgentTurn({ draft, message, cascadePosition = null, audience = 'ME', speaker = 'Dan', gate = null, draftId = null, signal = null, onEvent = null }) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const state = createTurnState(draft, cascadePosition, { speaker });
  const t0 = Date.now();
  const emit = (ev) => { try { onEvent?.(ev); } catch { /* display only */ } };

  const sessions = readSessions();
  const priorSession = draftId ? sessions[draftId] : null;

  const abort = new AbortController();
  const onOuterAbort = () => abort.abort();
  signal?.addEventListener?.('abort', onOuterAbort);
  const timeCap = setTimeout(() => abort.abort(), MAX_MS);

  const promptText = [
    cascadePosition?.activeStep?.label
      ? `(The engineer is on the "${cascadePosition.activeStep.label}" step. Cascade position: ${JSON.stringify({
        openQuestionsOnStep: cascadePosition.openQuestionsOnStep ?? [],
        nextStep: cascadePosition.nextStep ?? null,
        stepsRemaining: cascadePosition.stepsRemaining ?? null,
      })})`
      : '',
    `THE ENGINEER SAYS:\n${String(message ?? '').trim()}`,
    '\nWork the turn: read what you need, apply what his words call for, then give your final message.',
  ].filter(Boolean).join('\n');

  let reply = '';
  let readingSpoken = false;
  let sessionId = null;
  let costUSD = 0;
  let turns = 0;
  let capped = null;
  let bounced = false;

  const runQuery = async (prompt, resumeId) => {
    const server = buildStationServer(state);
    const q = query({
      prompt,
      options: {
        systemPrompt: systemPromptFor(audience, gate),
        model: MODEL,
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
        abortController: abort,
        // TOOL SCOPING IS THE SECURITY MODEL — station tools only.
        mcpServers: { station: server },
        allowedTools: ['mcp__station__*'],
        disallowedTools: DISALLOWED_BUILTINS,
        permissionMode: 'dontAsk',
        // Isolation: no user settings, no CLAUDE.md, no auto-memory, own home.
        settingSources: [],
        cwd: WORK_DIR,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          CLAUDE_CONFIG_DIR: RUNTIME_DIR,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
        ...(resumeId ? { resume: resumeId } : {}),
      },
    });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init' && m.session_id) sessionId = m.session_id;
      else if (m.type === 'assistant') {
        const blocks = m.message?.content ?? [];
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
        const toolUses = blocks.filter((b) => b.type === 'tool_use');
        if (text) reply = text; // last prose wins (the final message)
        if (text && toolUses.length && !readingSpoken) {
          readingSpoken = true;
          emit({ reading: text });
        }
        for (const tu of toolUses) {
          turns += 1;
          const bare = String(tu.name).replace(/^mcp__station__/, '');
          emit(eventLabelFor(bare, tu.input));
        }
        if (toolUses.length === 0 && text) emit('thinking…');
      } else if (m.type === 'result') {
        if (typeof m.total_cost_usd === 'number') costUSD += m.total_cost_usd;
        if (m.session_id) sessionId = m.session_id;
        if (m.subtype === 'error_max_turns') capped = 'turn cap';
        else if (/budget/i.test(String(m.subtype ?? ''))) capped = 'cost cap';
        if (m.subtype && m.subtype !== 'success' && !capped) capped = String(m.subtype);
        if (typeof m.result === 'string' && m.result.trim()) reply = m.result.trim();
      }
    }
  };

  // Can-hang baseline BEFORE the turn (only NEW findings bounce — standing
  // ones are the engineer's open questions, not this turn's fault).
  let hangBaseline = [];
  try { hangBaseline = unmatchedWaits(draft?.smProposal?.stateMachines); } catch { /* guard optional */ }

  try {
    emit('thinking…');
    await runQuery(promptText, priorSession);

    // OUR GATE stays: checker before anything renders; one bounce. Decompose
    // gates use the DOMAIN checker (asynchrony, naming, feedback-applied,
    // identity lock); everything else the diff checker.
    if (!capped) {
      emit('checking the work…');
      let violations = [];
      if (gate === 'decompose' && !state.diffs.some((d) => d.op === 'split.propose')) {
        // OBJECTIVE FAILURE (fixture H, 2026-08-30): a decompose turn that
        // never proposed. No judgment call — bounce straight to the tool.
        violations = ['This is a DECOMPOSE GATE and no propose_split call was made. Produce the '
          + 'full split proposal NOW via ONE propose_split call — the proposal is the deliverable; '
          + 'keep any questions you filed, but the turn cannot end without a proposal.'];
      } else if (gate === 'decompose' && state.diffs.some((d) => d.op === 'split.propose')) {
        try {
          const { checkProposal } = require('./smDecomposer.js');
          const chk = await checkProposal({
            kind: 'decomposition',
            payload: {
              stateMachines: state.draft.smProposal?.stateMachines ?? [],
              reasoning: state.draft.smProposal?.reasoning ?? '',
              correctionRound: (state.cascadePosition?.approvedMachineNames?.length ?? 0) > 0,
            },
            description: String(state.draft?.description ?? message ?? ''),
            signal: abort.signal,
          });
          costUSD += chk.meta?.costUSD ?? 0;
          if (chk.verdict === 'fix') violations = chk.violations ?? [];
        } catch { /* checker unavailable — surface the turn as-is */ }
      } else {
        const chk = await checkTurn({ message, state, signal: abort.signal }).catch(() => null);
        if (chk) costUSD += chk.cost;
        if (chk && chk.verdict === 'fix') violations = chk.violations ?? [];
      }
      // THE CAN-HANG GUARD: objective, no judgment call — a turn that
      // introduced a new forever-wait (culled/orphaned an outgoing signal
      // step) gets it back before anything renders.
      try {
        const nowHangs = unmatchedWaits(state.draft?.smProposal?.stateMachines);
        const introduced = nowHangs.filter((h) => !hangBaseline.includes(h));
        if (introduced.length) {
          violations.push(...introduced.map((h) => `THIS TURN INTRODUCED A DEADLOCK: ${h}. `
            + 'Outgoing Signal steps are legal sequence steps (data, even though the flow render does not '
            + 'draw them as nodes) — restore the culled/orphaned Signal step in the canonical '
            + '"Signal <name> to <machine>" shape rather than removing the wait.'));
        }
      } catch { /* guard optional */ }
      if (violations.length) {
        bounced = true;
        emit('fixing what the review found…');
        await runQuery(
          'REVIEW FOUND PROBLEMS with that turn — fix them now via the tools'
          + (gate === 'decompose' ? ' (re-issue propose_split with the corrections; approved names stay exact)' : '')
          + ', then give your final message again:\n'
          + violations.map((v) => `- ${v}`).join('\n'),
          sessionId ?? priorSession
        );
      }
    }
  } finally {
    clearTimeout(timeCap);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }

  if (draftId && sessionId && sessions[draftId] !== sessionId) {
    sessions[draftId] = sessionId;
    writeSessions(sessions);
  }
  if (abort.signal.aborted && !capped) capped = 'time cap';
  if (!reply && !state.diffs.length) {
    reply = 'I read that and found nothing that needed changing — if you expected an edit, tell me which line or device.';
  }

  return {
    reply,
    diffs: state.diffs,
    asks: state.asks,
    notes: state.notes,
    closedQuestions: state.closedQuestions,
    draft: state.draft,
    capped,
    meta: {
      model: MODEL, engine: 'claude-agent-sdk', toolCalls: turns,
      costUSD: Number(costUSD.toFixed(4)), ms: Date.now() - t0, bounced,
      sessionId: sessionId ?? null,
    },
  };
}

module.exports = { runAgentTurn };
