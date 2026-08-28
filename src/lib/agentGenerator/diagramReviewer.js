/**
 * diagramReviewer.js — DIAGRAM CHECK: the agentic review pass over a DRAWN
 * diagram, run after every diagram build/rebuild, before the diagram is
 * presented as final.
 *
 * Dan's directive (2026-08-25): "The agentic layer has to build the diagrams —
 * it can't be a rule set. And there has to be a review process: check all the
 * branching, check how the motions split up, check that visually everything
 * connects. There are lessons learned there — train on them."
 *
 * Division of labor: branchLayout.mjs stays the deterministic LAYOUT engine —
 * layout is geometry and legitimately deterministic. What this module reviews
 * is the AUTHORING: states, actions, branches, connectivity — the part that is
 * judgment, not geometry. Modeled on internalReviewer.js (the code-side
 * "pre-Jason pass"); this is the diagram-side twin, at the cheap tier.
 *
 * THE CHECKS (against the concepts + ME knowledge, esp. the state-granularity
 * doctrine in concepts/coordination.md):
 *   granularity   — actions share one state ONLY when simultaneous; every
 *                   after-complete/timer chain between actuations inside a
 *                   node is a hidden transition (Dan's exact complaint);
 *                   servo strokes per the MCD model; consistency across the
 *                   diagram is itself a rule.
 *   branching     — every decide has all exits handled; retry/fault paths
 *                   land somewhere legal (a real node, a lawful loop-back).
 *   connectivity  — no orphans, exactly one initial, Cycle Complete reachable,
 *                   loop targets exist ("visually everything connects").
 *   decomposition — SM conformance with the asynchrony test / approved split.
 *   naming        — PascalCase SMs, SDC device naming, honest state labels.
 *
 * Verdict 'ship' | 'fix'. A 'fix' loops through the diagram AUTHOR agentically
 * (fixDiagram: the model corrects its own diagram, then the deterministic
 * validate + servo-split + layout passes re-run) with cap discipline
 * (JARVIS_DIAGRAM_FIX_ROUNDS, default 2). ZERO-AUTHORITY LAW: a diagram still
 * violating known standards after the cap is returned flagged held/needsFix —
 * it never renders as final. Blocker findings that survive the cap are filed
 * as lessons via correctionLearner.appendCorrectionLesson, attributed
 * 'diagram review'.
 *
 * Cost discipline: cheap tier (sonnet) for every round; round 1 reviews the
 * full diagram, rounds 2..N are DELTA rounds (verify prior findings + judge
 * the changed nodes/edges only). Free mechanical connectivity checks run
 * before any model call.
 *
 * CommonJS, plain Node — required lazily by server.js. Must NOT require
 * client.js or promptBuilder.js.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const { loadConcepts, loadMeKnowledge, SUPREME_LAW } = require('./meKnowledge');

const MODEL = process.env.JARVIS_DIAGRAM_REVIEW_MODEL || 'claude-sonnet-5';
// Adaptive thinking tokens count toward max_tokens — 16K truncated a live
// review's verdict (2026-08-25); 32K is the working floor.
const MAX_TOKENS = parseInt(process.env.JARVIS_DIAGRAM_REVIEW_MAX_TOKENS, 10) || 32000;
const FIX_MODEL = process.env.JARVIS_DIAGRAM_FIX_MODEL || process.env.JARVIS_MODEL || 'claude-opus-5';
const FIX_MAX_TOKENS = parseInt(process.env.JARVIS_DIAGRAM_MAX_TOKENS, 10) || 32000;
const MAX_FIX_ROUNDS = parseInt(process.env.JARVIS_DIAGRAM_FIX_ROUNDS, 10) || 2;

// $ per 1M tokens: [input, output] — kept local (this module never requires client.js).
const PRICING = {
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};
function costOfUsage(usage, model) {
  const [inRate, outRate] = PRICING[model] || PRICING['claude-sonnet-5'];
  return ((usage.input_tokens || 0) * inRate
    + (usage.cache_read_input_tokens || 0) * inRate * 0.10
    + (usage.cache_creation_input_tokens || 0) * inRate * 1.25
    + (usage.output_tokens || 0) * outRate) / 1e6;
}

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI review not configured — add ANTHROPIC_API_KEY to .env');
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

// ── Diagram rendering (structured data → review text) ───────────────────────

function resolveSm(project, smId) {
  const sms = project?.stateMachines || [];
  const sm = smId ? sms.find(s => s.id === smId || s.name === smId) : sms[0];
  if (!sm) throw new Error(`SM "${smId}" not found in project`);
  return sm;
}

function describeAction(a, devById) {
  if (a.deviceId === '_decision') {
    const mode = a.nodeMode || 'wait';
    return `[decision:${mode}] ${a.signalSource || ''} ${a.signalName || ''} (exits: ${a.exitCount || 1})`.trim();
  }
  const dev = devById.get(a.deviceId);
  const name = dev ? (dev.displayName || dev.name) : `?dev:${a.deviceId}`;
  const bits = [a.operation || '?op'];
  if (a.positionName) bits.push(`→ ${a.positionName}`);
  if (a.speedProfile) bits.push(`(${a.speedProfile})`);
  if (a.jobName) bits.push(`job:${a.jobName}`);
  if (a.advance === 'wideband') bits.push('≈wideband');
  const adv = a.advanceCondition;
  // null/absent = onComplete (the schema default) — say so explicitly: the
  // granularity check hinges on whether a chain is after-complete or concurrent.
  const advTxt = !adv || adv.type === 'onComplete' ? 'then-after-complete'
    : adv.type === 'timer' ? `then-after-${adv.timerMs || '?'}ms`
      : adv.type === 'none' ? 'concurrent' : `then-${adv.type}`;
  return `${name}: ${bits.join(' ')}   [advance: ${advTxt}]`;
}

const ACTUATION_OPS = new Set([
  'Extend', 'Retract', 'Engage', 'Disengage', 'VacOn', 'VacOff', 'VacOnEject',
  'ServoMove', 'ServoIncr', 'ServoIndex', 'Trigger', 'RunSequence', 'Run', 'Stop',
]);
const isActuation = (a) => a && a.deviceId !== '_decision' && ACTUATION_OPS.has(a.operation);

/** Render one SM's diagram as structured review text (never raw JSON dumps). */
function renderDiagramForReview(project, smId) {
  const sm = resolveSm(project, smId);
  const devById = new Map((sm.devices || []).map(d => [d.id, d]));
  const nodeById = new Map((sm.nodes || []).map(n => [n.id, n]));
  const lines = [];

  lines.push(`## State machine "${sm.displayName || sm.name}" (name: ${sm.name}, station ${sm.stationNumber ?? '?'})`);
  if (sm.description) lines.push(`Description: ${sm.description}`);

  lines.push('', '### Devices');
  for (const d of sm.devices || []) {
    const extra = [];
    if (d.sensorArrangement) extra.push(d.sensorArrangement);
    if (Array.isArray(d.positions) && d.positions.length) extra.push(`positions: ${d.positions.map(p => p.name).join(', ')}`);
    lines.push(`- ${d.type} "${d.displayName || d.name}" (${d.name})${extra.length ? ' — ' + extra.join('; ') : ''}`);
  }

  lines.push('', '### Nodes (states)');
  for (const n of sm.nodes || []) {
    const flags = [
      n.data?.isInitial ? 'INITIAL' : null,
      n.data?.isComplete ? 'CYCLE-COMPLETE' : null,
      n.type === 'decisionNode' ? 'DECISION-NODE' : null,
    ].filter(Boolean).join(', ');
    lines.push(`- ${n.id} "${n.data?.label || n.data?.signalSource || '(no label)'}"${flags ? ` [${flags}]` : ''}`);
    for (const a of n.data?.actions || []) lines.push(`    · ${describeAction(a, devById)}`);
  }

  lines.push('', '### Edges (transitions)');
  for (const e of sm.edges || []) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    const sl = s ? (s.data?.label || e.source) : `MISSING:${e.source}`;
    const tl = t ? (t.data?.label || e.target) : `MISSING:${e.target}`;
    const bits = [e.data?.conditionType || 'trigger'];
    if (e.sourceHandle) bits.push(`handle:${e.sourceHandle}`);
    if (e.data?.outcomeLabel) bits.push(`outcome:${e.data.outcomeLabel}`);
    if (e.data?.label) bits.push(`label:"${e.data.label}"`);
    lines.push(`- "${sl}" → "${tl}" (${bits.join(', ')})`);
  }
  return { text: lines.join('\n'), sm };
}

/** The compiled intent context: approved sequence IR when it exists, plus the
 *  recorded/approved SM split (decomposition conformance evidence). */
function renderCompiledIntent(project, sm, { maxChars = 24000 } = {}) {
  const parts = [];
  const split = sm.machineSpec?.smSplit;
  if (Array.isArray(split) && split.length) {
    const appr = sm.machineSpec?.smSplitApproval;
    parts.push(`### Recorded SM decomposition${appr?.approved ? ` (APPROVED by ${appr.by} ${appr.at})` : ' (not yet approved)'}`);
    for (const e of split) parts.push(`- ${e.name || e.programName || '?'}${e.oneLiner ? ` — ${e.oneLiner}` : ''}`);
  }
  const ir = sm.compiledSequence?.ir;
  if (ir?.text) {
    let t = String(ir.text);
    if (t.length > maxChars) t = t.slice(0, maxChars) + '\n… (truncated)';
    parts.push('', '### The compiled intent (approved sequence IR — what the diagram is supposed to draw)', t);
  }
  return parts.join('\n');
}

// ── Free mechanical checks (never pay a model for these) ────────────────────

function mechanicalDiagramChecks(sm) {
  const findings = [];
  const nodes = sm.nodes || [];
  const edges = sm.edges || [];
  const nodeIds = new Set(nodes.map(n => n.id));
  const push = (check, finding, node = null) =>
    findings.push({ severity: 'blocker', check, node, finding, mechanical: true });

  const initials = nodes.filter(n => n.data?.isInitial);
  if (initials.length !== 1) push('connectivity', `expected exactly 1 initial node, found ${initials.length}`);
  const completes = nodes.filter(n => n.data?.isComplete);
  if (completes.length === 0) push('connectivity', 'no Cycle Complete (isComplete) node');

  for (const e of edges) {
    if (!nodeIds.has(e.source)) push('connectivity', `edge ${e.id} source "${e.source}" does not exist`);
    if (!nodeIds.has(e.target)) push('connectivity', `edge ${e.id} loop/branch target "${e.target}" does not exist`);
  }

  // Reachability from the initial node.
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
  }
  if (initials.length === 1) {
    const seen = new Set([initials[0].id]);
    const stack = [initials[0].id];
    while (stack.length) {
      for (const t of out.get(stack.pop()) || []) {
        if (nodeIds.has(t) && !seen.has(t)) { seen.add(t); stack.push(t); }
      }
    }
    for (const n of nodes) {
      if (!seen.has(n.id)) push('connectivity', `node "${n.data?.label || n.id}" is unreachable from the initial node (orphan)`, n.id);
    }
    if (completes.length && !completes.some(c => seen.has(c.id))) {
      push('connectivity', 'Cycle Complete is not reachable from the initial node');
    }
  }

  // Every non-complete node has an outgoing edge; decide rows have both exits.
  for (const n of nodes) {
    const outs = edges.filter(e => e.source === n.id);
    if (!n.data?.isComplete && outs.length === 0) {
      push('connectivity', `node "${n.data?.label || n.id}" has no outgoing edge (dead end)`, n.id);
    }
    const lastAct = (n.data?.actions || []).slice(-1)[0];
    const isDecide = (n.type === 'decisionNode' && Number(n.data?.exitCount) === 2)
      || (lastAct && lastAct.deviceId === '_decision'
        && (lastAct.nodeMode === 'decide' || Number(lastAct.exitCount) === 2));
    if (isDecide) {
      const hasPass = outs.some(e => e.sourceHandle === 'exit-pass' || e.sourceHandle == null);
      const hasFail = outs.some(e => e.sourceHandle === 'exit-fail' || e.sourceHandle === 'exit-retry');
      if (!hasPass || !hasFail) {
        push('branching', `2-exit decision "${n.data?.label || n.id}" is missing its ${!hasPass ? 'pass' : 'fail'} exit edge`, n.id);
      }
    }
  }
  return findings;
}

// ── Model review ─────────────────────────────────────────────────────────────

const CHECKS = new Set(['granularity', 'branching', 'connectivity', 'decomposition', 'naming']);
const SEVERITIES = new Set(['blocker', 'style', 'note']);

const SYSTEM = `${SUPREME_LAW}
For this review that law means: a diagram that violates a KNOWN SDC standard at any level never renders as final — a known violation is a "blocker" and the verdict is "fix", never a style note.

You are the senior SDC controls engineer reviewing a DRAWN STATE DIAGRAM (nodes/actions/edges as structured data, plus the compiled intent it was drawn from) BEFORE it is presented to the mechanical engineer. This is the diagram-side twin of the code review: the layout geometry is deterministic and out of scope — you judge the AUTHORING. Be adversarial; "one set of changes, fixed right".

THE CHECKS — run all five, in this order:

1. STATE GRANULARITY (Dan's exact complaint — "check how the motions split up"; doctrine: concepts/coordination.md "State granularity"):
   - Actions share ONE state ONLY when SIMULTANEOUS (parallel non-conflicting actuations commanded at the same instant, e.g. all-retract-together). In generated code every row fires on the same scan at state entry — that is what "same state" means.
   - ANY sequential dependency between actuations = SEPARATE states, no exceptions. Flag EVERY actuation row chained after another actuation with [advance: then-after-complete] or [advance: then-after-Nms] — each is a hidden state transition. A wait/decision ROW between two actuations is the same hidden transition. Concurrent rows ([advance: concurrent]) are legal only when physically simultaneous.
   - Servo strokes follow the MCD model: one ServoMove per state, always; fast/slow strokes are chained states; blends only on edges.
   - CONSISTENCY IS ITSELF A RULE: the same physical pattern must resolve to the same state shape everywhere in this diagram — flag mixed granularity even when each instance alone might be defensible.
   - Judge simultaneity from the physics and the compiled intent: two actuations that genuinely start together may share a state; when the intent says "then"/"after", they may not.

2. BRANCHING COMPLETENESS: every 2-exit decision has BOTH exits drawn and each lands on a real node; retry paths loop back to a lawful re-entry point (start of the retried operation, not an arbitrary state); retries-exhausted / fault paths land somewhere legal (a fault-handling state, Cycle Complete via a reject path, or an explicit lawful loop) — never dangle; single-exit waits have exactly one exit.

3. CONNECTIVITY ("visually everything connects" — mechanical pre-check findings are given to you as established facts, do not re-derive them): exactly one initial node, Cycle Complete reachable, no orphans, no dead ends, loop-back targets exist and make sequence sense (a loop to a state AFTER the condition it retries is wrong).

4. SM DECOMPOSITION CONFORMANCE (the asynchrony test, concepts/multi-state-machine.md): this diagram must contain ONE sequence for ONE state machine. If it interleaves two mechanisms that can work at the same moment, that is an architecture blocker. Where a recorded/approved SM split exists, the diagram must stay inside its member's scope — handshakes with sibling SMs appear as signal waits/sets (Parameter devices), never as the sibling's own actuations drawn here.

5. NAMING: SM names PascalCase; device names full-word PascalCase (no abbreviations); state labels honest one-line descriptions of what the state does (a label claiming one action while rows do three is a finding); decision exit labels short (On/Off/Pass/Fail).

NOT findings: approved deviations recorded in the spec; differences the compiled intent itself requires; layout/geometry (positions, lanes, rails — deterministic engine's job); anything the ME explicitly asked for.

Severities: "blocker" = a CE would bounce the diagram (hidden transitions, missing exits, orphans, architecture violations); "style" = red pen, no bounce (naming drift, label wording); "note" = worth knowing.

Verdict "ship" ONLY with zero blockers. Any blocker → "fix".

Respond with ONLY a JSON object:
{"verdict":"ship"|"fix","findings":[{"severity":"blocker"|"style"|"note","check":"granularity"|"branching"|"connectivity"|"decomposition"|"naming","node":"<node id or label, or null>","finding":"<specific, actionable — name the rows/edges>","fixHint":"<one line: how the author should redraw it>"}],"summary":"2-4 sentences, the way you'd tell the junior"}`;

function extractJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const slice = t.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (_) {}
  try { return JSON.parse(slice.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')); } catch (_) { return null; }
}

function normalizeReview(raw, mechanicalFindings) {
  const findings = (Array.isArray(raw.findings) ? raw.findings : [])
    .filter(f => f && (f.finding || f.issue))
    .map(f => ({
      severity: SEVERITIES.has(String(f.severity || '').toLowerCase()) ? String(f.severity).toLowerCase() : 'note',
      check: CHECKS.has(String(f.check || '').toLowerCase()) ? String(f.check).toLowerCase() : 'general',
      node: f.node != null ? String(f.node) : null,
      finding: String(f.finding || f.issue || '').trim(),
      fixHint: f.fixHint != null ? String(f.fixHint) : null,
    }));
  // Mechanical findings ride along (deduped crudely by text).
  for (const m of mechanicalFindings || []) {
    if (!findings.some(f => f.finding === m.finding)) findings.push(m);
  }
  let verdict = String(raw.verdict || '').toLowerCase() === 'ship' ? 'ship' : 'fix';
  if (verdict === 'ship' && findings.some(f => f.severity === 'blocker')) verdict = 'fix';
  if (verdict === 'fix' && !findings.some(f => f.severity === 'blocker') && findings.length === 0) verdict = 'ship';
  return { verdict, findings, summary: String(raw.summary || '').trim() };
}

/**
 * Review one SM's drawn diagram. ONE model call (cheap tier) + free
 * mechanical pre-checks.
 *
 * @param {object} opts — { project, smId, priorFindings?, previousDiagramText?,
 *   model?, effort?, signal? }
 *   priorFindings + previousDiagramText ⇒ DELTA round: verify priors + judge
 *   what changed; never re-review settled unchanged states.
 */
async function reviewDiagram({
  project, smId, priorFindings = null, previousDiagramText = null,
  model = null, effort = null, signal = null,
} = {}) {
  if (!project) throw new Error('reviewDiagram needs project');
  const startedAt = Date.now();
  const { text: diagramText, sm } = renderDiagramForReview(project, smId);
  const mechanical = mechanicalDiagramChecks(sm);
  const intent = renderCompiledIntent(project, sm);
  const concepts = loadConcepts();
  const meKnowledge = loadMeKnowledge();

  const stableText = [
    ...(concepts ? ['# ENGINEERING CONCEPTS (how SDC thinks — the standard you are enforcing)', concepts, ''] : []),
    ...(meKnowledge ? ['# ME KNOWLEDGE (standing facts and learned corrections)', meKnowledge, ''] : []),
  ].join('\n');

  const deltaScoped = Boolean(priorFindings && previousDiagramText);
  const jobParts = [];
  if (intent) jobParts.push(intent, '');
  if (deltaScoped) {
    jobParts.push(
      `# DELTA-SCOPED FIX-ROUND REVIEW — "${sm.displayName || sm.name}"`,
      'You already reviewed this diagram in full and returned the findings below. The author',
      'has redrawn it. Judge ONLY: (1) is each prior finding genuinely fixed; (2) do the',
      'redrawn states/edges introduce any NEW violation. Unchanged states that passed round 1',
      'are settled — re-opening them is a contract violation.',
      '',
      '## Your prior findings (verify each)',
      ...priorFindings.map((f, i) => `${i + 1}. [${f.severity}] (${f.check}) ${f.node ? f.node + ': ' : ''}${f.finding}`),
      '',
      '## The diagram BEFORE the fix', previousDiagramText,
      '',
      '## The diagram AFTER the fix', diagramText,
    );
  } else {
    jobParts.push(`# THE DRAWN DIAGRAM — "${sm.displayName || sm.name}"`, diagramText);
  }
  if (mechanical.length) {
    jobParts.push('', '## Mechanical pre-check findings (established facts — include, do not re-derive)',
      ...mechanical.map(m => `- (${m.check}) ${m.finding}`));
  }
  jobParts.push('', '# TASK', 'Run the five checks. Respond with ONLY the JSON review object described in your instructions.');

  const reviewModel = model || MODEL;
  const client = getClient();
  const req = {
    model: reviewModel,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: effort || (deltaScoped ? 'medium' : 'high') },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: stableText, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: jobParts.join('\n') },
      ],
    }],
  };
  if (/^claude-(fable|opus)-/.test(reviewModel)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused the diagram review: ' + (response.stop_details?.explanation || 'no explanation'));
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const raw = extractJson(text);
  if (!raw || !raw.verdict) {
    throw new Error('Diagram review returned no parseable verdict'
      + (response.stop_reason === 'max_tokens' ? ' (response truncated)' : ''));
  }
  const review = normalizeReview(raw, mechanical);
  return {
    ...review,
    smName: sm.name,
    scope: deltaScoped ? 'delta' : 'full',
    diagramText,
    model: response.model || reviewModel,
    costUSD: response.usage ? Number(costOfUsage(response.usage, reviewModel).toFixed(4)) : null,
    durationS: Math.round((Date.now() - startedAt) / 1000),
    at: new Date().toISOString(),
  };
}

// ── Agentic fix (the diagram author corrects its own diagram) ───────────────

const FIX_SYSTEM = `${SUPREME_LAW}
You are JARVIS, the SDC station-diagram author, correcting YOUR OWN drawn diagram after the internal diagram review bounced it. Redraw ONLY what the findings require — every state/edge the review did not flag stays byte-identical (same ids, same labels, same actions). Splitting a state (the granularity doctrine: sequential actuations = separate states) means: keep the original node id on the FIRST resulting state so incoming edges stay valid, give new states new short ids, rewire the outgoing edges to the last state of the chain, and connect the chain with routableEdge edges (conditionType per the transition: servoAtTarget for servo completion, sensorOn/timer/trigger otherwise). One ServoMove per state, always. Every 2-exit decision keeps both exit edges (exit-pass / exit-fail). Positions/x/y need only be roughly right — the deterministic layout engine re-lays everything out after you.

Respond with ONLY a JSON object: {"sm": { ...the complete corrected state machine (same shape as the input: id, name, displayName, stationNumber, description, devices, nodes, edges)... }, "changes": ["<one line per finding: what you redrew>"]}`;

/** One agentic fix round: the model redraws the SM per the findings; the
 *  deterministic passes (validate, servo split, layout) re-run after. */
async function fixDiagram({ project, smId, findings, signal = null } = {}) {
  const sm = resolveSm(project, smId);
  const { text: diagramText } = renderDiagramForReview(project, smId);
  const client = getClient();
  const req = {
    model: FIX_MODEL,
    max_tokens: FIX_MAX_TOKENS,
    system: FIX_SYSTEM,
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: [
          '# The state machine JSON (correct THIS — return the complete corrected object)',
          JSON.stringify(sm),
          '',
          '# The drawn diagram (readable form, for orientation)',
          diagramText,
          '',
          '# Review findings to fix',
          ...findings.map((f, i) => `${i + 1}. [${f.severity}] (${f.check}) ${f.node ? f.node + ': ' : ''}${f.finding}${f.fixHint ? ` — fix: ${f.fixHint}` : ''}`),
        ].join('\n'),
      }],
    }],
  };
  if (/^claude-(fable|opus)-/.test(FIX_MODEL)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(req, signal ? { signal } : undefined);
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('Model refused the diagram fix: ' + (response.stop_details?.explanation || 'no explanation'));
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = extractJson(text);
  if (!parsed || !parsed.sm || !Array.isArray(parsed.sm.nodes)) {
    throw new Error('Diagram fix returned no usable state machine'
      + (response.stop_reason === 'max_tokens' ? ' (response truncated)' : ''));
  }

  // Deterministic post-passes — never left to the model (same ones as authoring).
  const author = require('./diagramAuthor');
  const wrapper = {
    id: project.id, name: project.name || 'Fix',
    stateMachines: [parsed.sm], signals: [], recipes: [], partTracking: { fields: [] },
  };
  const fixups = author.validateAndNormalizeProject(wrapper);
  fixups.push(...author.splitMultiServoMoveStates(wrapper));
  await author.normalizeLayout(wrapper);
  const fixedSm = wrapper.stateMachines[0];
  // Preserve identity + everything the fix has no business touching.
  fixedSm.id = sm.id;
  fixedSm.name = sm.name;
  fixedSm.displayName = sm.displayName;
  fixedSm.stationNumber = sm.stationNumber;
  if (sm.machineSpec) fixedSm.machineSpec = sm.machineSpec;
  if (sm.compiledSequence) fixedSm.compiledSequence = sm.compiledSequence;

  const idx = (project.stateMachines || []).findIndex(s => s.id === sm.id);
  if (idx >= 0) project.stateMachines[idx] = fixedSm;

  return {
    sm: fixedSm,
    changes: Array.isArray(parsed.changes) ? parsed.changes.map(String) : [],
    fixups,
    costUSD: response.usage ? Number(costOfUsage(response.usage, FIX_MODEL).toFixed(4)) : null,
    model: response.model || FIX_MODEL,
  };
}

// ── Lesson filing (findings that survive = training material) ───────────────

const CHECK_TO_AREA = {
  granularity: 'coordination',
  decomposition: 'coordination',
  branching: 'general',
  connectivity: 'general',
  naming: 'general',
  general: 'general',
};

/** File surviving blocker findings as dated lessons, attributed 'diagram review'. */
function fileDiagramLessons(findings, { smName = '?', buildRef = null } = {}) {
  const blockers = (findings || []).filter(f => f.severity === 'blocker' && !f.mechanical);
  if (!blockers.length) return [];
  let learner;
  try { learner = require('./correctionLearner'); } catch (_) { return []; }
  const date = new Date().toISOString().slice(0, 10);
  const filed = [];
  for (const f of blockers.slice(0, 6)) {
    const area = CHECK_TO_AREA[f.check] || 'general';
    const line = `- (${date}, from diagram review of ${smName}${buildRef ? ` — ${buildRef}` : ''}) ${f.finding}${f.fixHint ? ` Correct shape: ${f.fixHint}` : ''}`;
    try {
      const file = learner.appendCorrectionLesson(learner.CONCEPTS_DIR, area, line);
      filed.push({ area, file, lesson: f.finding });
    } catch (e) {
      console.warn('[diagramReviewer] lesson filing failed:', e.message);
    }
  }
  return filed;
}

// ── Orchestrator: review → fix loop → verdict (the DIAGRAM CHECK gate) ──────

/**
 * The full DIAGRAM CHECK: review, then (when 'fix' and applyFixes) loop the
 * findings through the diagram author agentically, capped at MAX_FIX_ROUNDS.
 * Findings that survive the cap are filed as lessons ('diagram review').
 * Mutates project in place when fixes apply.
 *
 * @returns {{ verdict, findings, rounds: [review…], fixes: [fix…],
 *   lessonsFiled, costUSD, needsFix }}
 *   needsFix=true ⇒ ZERO-AUTHORITY LAW: the diagram must not render as final.
 */
async function reviewAndFixDiagram({
  project, smId, applyFixes = true, maxFixRounds = MAX_FIX_ROUNDS,
  onProgress = () => {}, signal = null, buildRef = null,
} = {}) {
  const rounds = [];
  const fixes = [];
  let costUSD = 0;

  onProgress('review', 'Diagram check — full review');
  let review = await reviewDiagram({ project, smId, signal });
  rounds.push(review);
  costUSD += review.costUSD || 0;

  let fixRound = 0;
  while (review.verdict === 'fix' && applyFixes && fixRound < maxFixRounds) {
    fixRound++;
    const blockers = review.findings.filter(f => f.severity === 'blocker');
    if (!blockers.length) break;
    onProgress('fix', `Diagram check — author redrawing (round ${fixRound}/${maxFixRounds}, ${blockers.length} blocker(s))`);
    const previousDiagramText = review.diagramText;
    let fix;
    try {
      fix = await fixDiagram({ project, smId, findings: blockers, signal });
    } catch (e) {
      // A failed fix round never blocks reporting — the verdict simply stands.
      fixes.push({ error: e.message, round: fixRound });
      break;
    }
    fixes.push({ round: fixRound, changes: fix.changes, fixups: fix.fixups, costUSD: fix.costUSD });
    costUSD += fix.costUSD || 0;

    onProgress('review', `Diagram check — delta review (round ${fixRound})`);
    review = await reviewDiagram({
      project, smId, signal,
      priorFindings: blockers, previousDiagramText,
    });
    rounds.push(review);
    costUSD += review.costUSD || 0;
  }

  const surviving = review.verdict === 'fix' ? review.findings.filter(f => f.severity === 'blocker') : [];
  const lessonsFiled = surviving.length
    ? fileDiagramLessons(surviving, { smName: review.smName, buildRef })
    : [];

  return {
    verdict: review.verdict,
    findings: review.findings,
    summary: review.summary,
    rounds: rounds.map(({ diagramText, ...r }) => r), // strip bulky text from the record
    fixes,
    lessonsFiled,
    costUSD: Number(costUSD.toFixed(4)),
    // ZERO-AUTHORITY LAW: still 'fix' after the cap ⇒ never presented as final.
    needsFix: review.verdict === 'fix',
  };
}

module.exports = {
  reviewDiagram, fixDiagram, reviewAndFixDiagram,
  renderDiagramForReview, mechanicalDiagramChecks, fileDiagramLessons,
};
