/**
 * codegenSdk.js — PHASE 3 (Dan, 2026-08-30): the Generate pipeline's write
 * calls run "on the same version you are, with access to the folder with all
 * our samples and standards" — i.e. through the Claude Agent SDK (the same
 * embedded Claude Code engine that runs draft chat and the decompose gate),
 * with a READ-ONLY toolset over this repo's reference material.
 *
 * What this module is: the TRANSPORT ONLY. client.js generateL5X keeps its
 * whole deterministic spine — pre-write study, readiness hold, edit-plan
 * parse/schema, mergeEngine surgery, validator gates (importSimValidator
 * byte-level import simulation included), hold-for-help, internal review,
 * tuition, metrics. The only thing that changes is HOW the writer model is
 * called: an SDK session per build instead of a bare messages.stream call,
 * so the writer can OPEN the exemplars, templates, concept docs and shipped
 * code itself while writing, exactly like the engineer-facing agent does.
 *
 * TOOL SCOPING IS THE SECURITY MODEL (same law as agentLoopSdk.js), tuned
 * for codegen: Read/Grep/Glob ONLY — no Write, no Edit, no Bash, no web.
 * The deliverable leaves through the final message (the JSON edit plan),
 * never through the file system. cwd is the repo root so plc-reference/,
 * jarvis-knowledge/, generated/ and JARVIS Deliveries/ are all readable.
 *
 * SESSIONS: one session per build. Repair rounds resume the SAME session —
 * the writer keeps its own reading context across rounds instead of
 * re-reading everything (the transcript rides in the isolated
 * agent-runtime home, same as chat sessions).
 */

const fs = require('fs');
const path = require('path');
const { query } = require('@anthropic-ai/claude-agent-sdk');

const ROOT = path.join(__dirname, '..', '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const MODEL = process.env.JARVIS_MODEL || 'claude-opus-5';
// A write turn may legitimately read a dozen reference files before the plan.
const MAX_TURNS = parseInt(process.env.JARVIS_CODEGEN_MAX_TURNS, 10) || 40;
const MAX_BUDGET_USD = parseFloat(process.env.JARVIS_MAX_COST_USD) || 20;

// Isolated harness home (shared with the chat engine — one runtime).
const RUNTIME_DIR = path.join(ROOT, 'jarvis-knowledge', 'agent-runtime');

// Everything except the three read tools is disallowed BY NAME on top of
// permissionMode 'dontAsk'. The writer reads; it never touches disk or web.
const DISALLOWED = [
  'Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'Skill',
  'SlashCommand', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree',
  'ListMcpResources', 'ReadMcpResource', 'Monitor', 'TaskStop', 'SendMessage',
  'ToolSearch', 'Artifact',
];

const READING_NOTE = [
  '',
  '# YOUR READING TOOLS (Phase 3)',
  'You have READ-ONLY file tools (Read, Grep, Glob) over this repository. The reference',
  'material lives at:',
  '- plc-reference/standard/   — the SDC standard templates (the law of shapes)',
  '- plc-reference/verified/   — engineer-VERIFIED exemplars (gold: v7-class files)',
  '- generated/                — prior builds incl. *__corrected_by_* engineer corrections',
  '- jarvis-knowledge/concepts/ — distilled lessons per area',
  '- JARVIS Deliveries/        — files already delivered',
  'Open what you need while writing — verify a rung shape against the exemplar instead of',
  'recalling it. Do NOT write files, ever: the deliverable is the JSON edit plan in your',
  'final message, nothing else. Never dump whole large files into your reply.',
].join('\n');

/**
 * Create one per-build SDK writer session.
 * call(promptText) → { text, usage: null, model, truncated: false, costUSD }
 * The FIRST call carries the full assembled prompt; later calls (repair
 * feedback, continuations) resume the same session with just the new text.
 */
function createCodegenSession({ systemText, signal = null, onActivity = null } = {}) {
  let sessionId = null;
  const emit = (s) => { try { onActivity?.(s); } catch { /* display only */ } };

  async function call(promptText) {
    const abort = new AbortController();
    const onOuterAbort = () => abort.abort();
    signal?.addEventListener?.('abort', onOuterAbort);
    let text = '';
    let costUSD = 0;
    let model = MODEL;
    try {
      const q = query({
        prompt: promptText,
        options: {
          systemPrompt: `${systemText}${READING_NOTE}`,
          model: MODEL,
          maxTurns: MAX_TURNS,
          maxBudgetUsd: MAX_BUDGET_USD,
          abortController: abort,
          allowedTools: ['Read', 'Grep', 'Glob'],
          disallowedTools: DISALLOWED,
          permissionMode: 'dontAsk',
          settingSources: [],
          cwd: ROOT,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            CLAUDE_CONFIG_DIR: RUNTIME_DIR,
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          },
          ...(sessionId ? { resume: sessionId } : {}),
        },
      });
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) sessionId = m.session_id;
        else if (m.type === 'assistant') {
          const blocks = m.message?.content ?? [];
          const t = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (t) text = t; // the final plan is the last prose message
          for (const tu of blocks.filter((b) => b.type === 'tool_use')) {
            const target = String(tu.input?.file_path ?? tu.input?.pattern ?? tu.input?.path ?? '')
              .replace(/\\/g, '/').split('/').slice(-2).join('/');
            emit(`${String(tu.name).toLowerCase()}: ${target || '(reference)'}`);
          }
        } else if (m.type === 'result') {
          if (typeof m.total_cost_usd === 'number') costUSD += m.total_cost_usd;
          if (m.session_id) sessionId = m.session_id;
          if (typeof m.result === 'string' && m.result.trim()) text = m.result.trim();
          if (m.subtype && m.subtype !== 'success') {
            emit(`writer session ended: ${m.subtype}`);
          }
        }
      }
    } finally {
      signal?.removeEventListener?.('abort', onOuterAbort);
    }
    // The SDK loop continues past single-response token limits on its own, so
    // truncation as callModel knew it cannot be detected here — the parse /
    // toBeContinued contract in client.js remains the honest gate.
    return { text, usage: null, model, truncated: false, costUSD };
  }

  return { call, get sessionId() { return sessionId; } };
}

module.exports = { createCodegenSession };
