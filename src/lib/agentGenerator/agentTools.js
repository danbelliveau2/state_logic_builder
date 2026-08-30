/**
 * agentTools.js — the agent loop's tool registry (Phase 1, Dan approved
 * 2026-08-28; design: docs/jarvis-agent-loop-design.md).
 *
 * READS are the ONE knowledge access layer (Dan's ONE BRAIN mandate): they
 * load from the same single sources codegen reads — meKnowledge.md,
 * jarvis-knowledge/, plc-reference/. No sheet-side copies, ever.
 *
 * WRITES are TYPED operations applied by THIS code to the turn's working
 * draft. Every write returns the real before/after diff and appends it to
 * state.diffs — the receipt the engineer sees is composed from those diffs,
 * never from the model's narration.
 */

const fs = require('fs');
const path = require('path');
const { loadMeKnowledge, loadConcepts } = require('./meKnowledge.js');
const { loadPrecedents } = require('./precedents.js');
const { normalizeStep, stepText } = require('./smDecomposer.js');

const ROOT = path.join(__dirname, '..', '..', '..');

// ── identity helpers (mirror the client's — digits spelled out) ────────────
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const devKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  .replace(/[0-9]/g, (ch) => NUM_WORDS[+ch]);
const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const keysMatch = (a, b) => {
  const ka = devKey(a); const kb = devKey(b);
  return !!ka && !!kb && (ka === kb || ka.includes(kb) || kb.includes(ka));
};

// Parse a canonical prose line back into a structured step (legacy strings).
function parseStepText(t) {
  const s = String(t ?? '').trim();
  let m;
  if ((m = s.match(/^home\s*:?\s*(.*)$/i))) return { action: 'Home', target: '', detail: m[1], counterpart: '' };
  if (/^repeat\b/i.test(s)) return { action: 'Repeat', target: '', detail: '', counterpart: '' };
  if ((m = s.match(/^wait\s+for\s+(.+?)['’]s\s+(.+?)\s*signal\s*$/i))) {
    return { action: 'Wait', target: m[2], detail: '', counterpart: m[1] };
  }
  if ((m = s.match(/^wait\s+for\s+(.*?)(?:\s+—\s+(.*))?$/i))) {
    return { action: 'Wait', target: m[1], detail: m[2] ?? '', counterpart: '' };
  }
  if ((m = s.match(/^(?:signal|set)\s+(.+?)\s+to\s+([A-Za-z0-9 '’.&-]+?)\s*$/i))) {
    return { action: 'Signal', target: m[1], detail: '', counterpart: m[2] };
  }
  if ((m = s.match(/^servo\s+move\s+(.*?)(?:\s+—\s+(.*))?$/i))) {
    return { action: 'Servo Move', target: m[1], detail: m[2] ?? '', counterpart: '' };
  }
  if ((m = s.match(/^([A-Za-z]+)\s+(.*?)(?:\s+—\s+(.*))?$/))) {
    return { action: m[1], target: m[2], detail: m[3] ?? '', counterpart: '' };
  }
  return { action: '', target: s, detail: '', counterpart: '' };
}

// ── turn state ──────────────────────────────────────────────────────────────
/**
 * @param draft   deep-cloneable snapshot from the client: { description,
 *                summary, smProposal, jarvisCoverage, agreedNeeds:[],
 *                deviceAssignments, chatThread, changeLog }
 * @param cascadePosition { activeStep:{kind,smKey,smName,label}, approved:[labels],
 *                approvedMachineNames:[], stepStatuses? }
 */
function createTurnState(draft, cascadePosition) {
  return {
    draft: JSON.parse(JSON.stringify(draft ?? {})),
    cascadePosition: cascadePosition ?? null,
    diffs: [],
    asks: [],
    notes: [],
    closedQuestions: [],
    events: [],
  };
}

// ── read helpers over the working draft ────────────────────────────────────
function machinesOf(state) {
  return state.draft?.smProposal?.stateMachines ?? [];
}
function findMachine(state, name) {
  const k = normKey(name);
  return machinesOf(state).find((m) => normKey(m?.name) === k)
    ?? machinesOf(state).find((m) => keysMatch(m?.name, name));
}
function stepsOf(machine) {
  // Structured steps when present and in sync; else parse the strings.
  const seq = Array.isArray(machine?.sequence) ? machine.sequence : [];
  const st = Array.isArray(machine?.sequenceSteps) ? machine.sequenceSteps : null;
  if (st && st.length === seq.length) {
    return st.map((x) => (x?.raw ? parseStepText(x.raw) : { ...x }));
  }
  return seq.map((l) => parseStepText(l));
}
function writeSteps(machine, steps) {
  machine.sequenceSteps = steps;
  machine.sequence = steps.map(stepText).filter(Boolean);
}
function deviceMachineOf(state, deviceName) {
  for (const m of machinesOf(state)) {
    if ((m.ownedDeviceNames ?? []).some((n) => keysMatch(n, deviceName))) return m.name;
  }
  const rec = state.draft?.deviceAssignments?.[normKey(deviceName)];
  if (rec && typeof rec === 'object') {
    const m = machinesOf(state).find((x) => normKey(x.name) === rec.key);
    if (m) return m.name;
  }
  return null;
}
function openNeeds(state) {
  const agreed = new Set(state.draft?.agreedNeeds ?? []);
  const cov = state.draft?.jarvisCoverage ?? {};
  const out = [];
  for (const covKey of Object.keys(cov)) {
    for (const n of (cov[covKey]?.needs ?? [])) {
      if (!agreed.has(`${covKey}:${n.question}`)) out.push({ covKey, ...n });
    }
  }
  return out;
}
function resolveLine(steps, machine, lineRef) {
  // lineRef: 1-based number, or text to match.
  if (typeof lineRef === 'number' || /^\d+$/.test(String(lineRef))) {
    const i = Number(lineRef) - 1;
    return i >= 0 && i < steps.length ? i : -1;
  }
  const want = normKey(lineRef);
  let i = (machine.sequence ?? []).findIndex((l) => normKey(l) === want);
  if (i !== -1) return i;
  i = (machine.sequence ?? []).findIndex((l) => normKey(l).includes(want) || want.includes(normKey(l)));
  return i;
}
function pushDiff(state, entry) {
  state.diffs.push(entry);
  return entry;
}

// ── knowledge access (THE one access layer — ONE BRAIN) ────────────────────
/** Append learned facts via the ONE writer (meKnowledge.js). */
function fileToMeKnowledgeShared(facts, sourceName) {
  const { appendLearnedFacts } = require('./meKnowledge.js');
  return appendLearnedFacts(
    (Array.isArray(facts) ? facts : [facts]).map((f) => ({ fact: `${String(f).trim()} [source: ${sourceName}]`, scope: 'sdc-standard' })),
    { who: 'ME' }
  );
}
function readKnowledge(name) {
  if (!name || name === 'laws' || name === 'meKnowledge') return loadMeKnowledge();
  const p = path.join(ROOT, 'jarvis-knowledge', 'concepts', `${String(name).replace(/[^a-z0-9-]/gi, '')}.md`);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const listing = (loadConcepts?.() ?? []).map((c) => c.name ?? c).join(', ');
  return `No concept file named "${name}". Available: ${listing || fs.readdirSync(path.join(ROOT, 'jarvis-knowledge', 'concepts')).join(', ')}`;
}
function searchPrecedents(query) {
  // ONE LOADER (Dan's ONE BRAIN): the same precedents.js codegen reads.
  const text = loadPrecedents();
  if (!text) return 'No precedent digest found.';
  const terms = String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!terms.length) return text.slice(0, 4000);
  // Section-aware: return blocks containing any term, scored by hits.
  const blocks = text.split(/\n(?=#)/);
  const scored = blocks
    .map((b) => ({ b, score: terms.reduce((n, t) => n + (b.toLowerCase().split(t).length - 1), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, z) => z.score - a.score)
    .slice(0, 4);
  return scored.length ? scored.map((x) => x.b.trim()).join('\n\n---\n\n').slice(0, 6000)
    : `Nothing in the precedent digest matches "${query}". (Searched ${blocks.length} sections.)`;
}
function searchShippedCode(query, maxResults = 20) {
  const dir = path.join(ROOT, 'plc-reference');
  if (!fs.existsSync(dir)) return { hits: [], note: 'plc-reference/ not found' };
  const terms = String(query ?? '').split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
  if (!terms.length) return { hits: [], note: 'empty query' };
  const hits = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const fp = path.join(d, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) { walk(fp); continue; }
      if (!/\.(l5x|md|txt)$/i.test(name) || st.size > 40 * 1024 * 1024) continue;
      const verified = /verified/i.test(fp);
      const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < maxResults * 3; i++) {
        const low = lines[i].toLowerCase();
        if (terms.every((t) => low.includes(t)) || (terms.length > 1 && terms.filter((t) => low.includes(t)).length >= Math.ceil(terms.length / 2))) {
          hits.push({
            file: path.relative(ROOT, fp), line: i + 1, verified,
            text: lines[i].trim().slice(0, 240),
            exact: terms.every((t) => low.includes(t)),
          });
        }
      }
    }
  };
  try { walk(dir); } catch (e) { return { hits: [], note: `search failed: ${e.message}` }; }
  hits.sort((a, z) => (z.verified - a.verified) || (z.exact - a.exact));
  return { hits: hits.slice(0, maxResults), note: hits.length ? undefined : `no matches for "${query}"` };
}

// ── the write ops ───────────────────────────────────────────────────────────
function applyEdit(state, input) {
  const op = String(input?.op ?? '');
  const d = state.draft;
  const summary = d.summary ?? (d.summary = { devices: [], sequence: [], failureHandling: [], interactions: [] });

  // Approval identity guard: approved machine names never change.
  const approvedNames = new Set((state.cascadePosition?.approvedMachineNames ?? []).map(normKey));

  switch (op) {
    case 'device.remove': {
      const name = String(input.device ?? '');
      const before = (summary.devices ?? []).map((x) => x?.displayName ?? x?.name);
      const removedRows = (summary.devices ?? []).filter((x) => keysMatch(x?.displayName ?? x?.name, name));
      if (!removedRows.length && !machinesOf(state).some((m) => (m.ownedDeviceNames ?? []).some((n) => keysMatch(n, name)))) {
        return { error: `No device matching "${name}" on the sheet or in the proposal.` };
      }
      summary.devices = (summary.devices ?? []).filter((x) => !keysMatch(x?.displayName ?? x?.name, name));
      // proposal ownership + any sequence/recovery mention
      for (const m of machinesOf(state)) {
        m.ownedDeviceNames = (m.ownedDeviceNames ?? []).filter((n) => !keysMatch(n, name));
      }
      // auto-close its open questions (stale-questions rule)
      const closed = [];
      const agreed = new Set(d.agreedNeeds ?? []);
      for (const n of openNeeds(state)) {
        const qk = devKey(n.question ?? '');
        const k = devKey(name);
        if ((n.device && keysMatch(n.device, name)) || qk.includes(k) || (k.length > 8 && qk.includes(k.slice(-8)))) {
          agreed.add(`${n.covKey}:${n.question}`);
          closed.push(n.question);
        }
      }
      d.agreedNeeds = [...agreed];
      state.closedQuestions.push(...closed);
      if (d.deviceAssignments) {
        for (const k of Object.keys(d.deviceAssignments)) if (keysMatch(k, name)) delete d.deviceAssignments[k];
      }
      return pushDiff(state, {
        op, device: removedRows.map((x) => x?.displayName ?? x?.name).join(', ') || name,
        before: before.length, after: (summary.devices ?? []).length,
        closedQuestions: closed,
      });
    }
    case 'device.add': {
      const name = String(input.name ?? '').trim();
      if (!name) return { error: 'device.add needs a name' };
      if ((summary.devices ?? []).some((x) => keysMatch(x?.displayName ?? x?.name, name))) {
        return { error: `Device "${name}" already exists.` };
      }
      summary.devices = [...(summary.devices ?? []), { name, ...(input.type ? { type: String(input.type) } : {}) }];
      const machine = input.machine ? findMachine(state, input.machine) : null;
      if (machine) machine.ownedDeviceNames = [...(machine.ownedDeviceNames ?? []), name];
      return pushDiff(state, { op, device: name, machine: machine?.name ?? null, before: null, after: name });
    }
    case 'device.rename': {
      const from = String(input.device ?? ''); const to = String(input.newName ?? '').trim();
      if (!to) return { error: 'device.rename needs newName' };
      const row = (summary.devices ?? []).find((x) => keysMatch(x?.displayName ?? x?.name, from));
      if (!row) return { error: `No device matching "${from}".` };
      const before = row.displayName ?? row.name;
      if (row.displayName != null) row.displayName = to; else row.name = to;
      for (const m of machinesOf(state)) {
        m.ownedDeviceNames = (m.ownedDeviceNames ?? []).map((n) => (keysMatch(n, from) ? to : n));
      }
      return pushDiff(state, { op, before, after: to });
    }
    case 'device.reassign': {
      const name = String(input.device ?? ''); const target = findMachine(state, input.machine);
      if (!target) return { error: `No machine matching "${input.machine}".` };
      const fromMachine = deviceMachineOf(state, name);
      for (const m of machinesOf(state)) {
        m.ownedDeviceNames = (m.ownedDeviceNames ?? []).filter((n) => !keysMatch(n, name));
      }
      target.ownedDeviceNames = [...(target.ownedDeviceNames ?? []), name];
      d.deviceAssignments = { ...(d.deviceAssignments ?? {}), [normKey(name)]: { key: normKey(target.name), by: 'agent', evidence: String(input.evidence ?? '') } };
      return pushDiff(state, { op, device: name, before: fromMachine, after: target.name });
    }
    case 'machine.rename': {
      const m = findMachine(state, input.machine);
      if (!m) return { error: `No machine matching "${input.machine}".` };
      if (approvedNames.has(normKey(m.name))) {
        return { error: `IDENTITY LOCK: "${m.name}" is approved — approved machine names never change.` };
      }
      const before = m.name; m.name = String(input.newName ?? '').trim() || m.name;
      return pushDiff(state, { op, before, after: m.name });
    }
    case 'sequence.insert': case 'recovery.insert': {
      const m = findMachine(state, input.machine);
      if (!m) return { error: `No machine matching "${input.machine}".` };
      const isRec = op.startsWith('recovery');
      if (isRec) {
        const line = typeof input.step === 'string' ? input.step : stepText(normalizeStep(input.step));
        const list = [...(m.faultRecovery ?? [])];
        const at = input.afterLine != null ? Math.min(Number(input.afterLine), list.length) : list.length;
        list.splice(at, 0, line);
        m.faultRecovery = list;
        return pushDiff(state, { op, machine: m.name, before: null, after: line, line: at + 1 });
      }
      const steps = stepsOf(m);
      const step = normalizeStep(input.step);
      if (!step) return { error: 'sequence.insert needs a step {action, target, detail?, counterpart?}' };
      const at = input.afterLine != null ? Math.min(Number(input.afterLine), steps.length) : steps.length;
      steps.splice(at, 0, step);
      writeSteps(m, steps);
      return pushDiff(state, { op, machine: m.name, before: null, after: stepText(step), line: at + 1 });
    }
    case 'sequence.remove': case 'recovery.remove': {
      const m = findMachine(state, input.machine);
      if (!m) return { error: `No machine matching "${input.machine}".` };
      const isRec = op.startsWith('recovery');
      if (isRec) {
        const list = [...(m.faultRecovery ?? [])];
        const i = typeof input.line === 'number' ? input.line - 1 : list.findIndex((l) => normKey(l).includes(normKey(input.line)));
        if (i < 0 || i >= list.length) return { error: `No recovery line matching "${input.line}".` };
        const [gone] = list.splice(i, 1);
        m.faultRecovery = list;
        return pushDiff(state, { op, machine: m.name, before: gone, after: null, line: i + 1 });
      }
      const steps = stepsOf(m);
      const i = resolveLine(steps, m, input.line);
      if (i === -1) return { error: `No sequence line matching "${input.line}" on ${m.name}.` };
      const gone = stepText(steps[i]);
      steps.splice(i, 1);
      writeSteps(m, steps);
      return pushDiff(state, { op, machine: m.name, before: gone, after: null, line: i + 1 });
    }
    case 'sequence.reword': case 'recovery.reword': {
      const m = findMachine(state, input.machine);
      if (!m) return { error: `No machine matching "${input.machine}".` };
      if (op.startsWith('recovery')) {
        const list = [...(m.faultRecovery ?? [])];
        const i = typeof input.line === 'number' ? input.line - 1 : list.findIndex((l) => normKey(l).includes(normKey(input.line)));
        if (i < 0 || i >= list.length) return { error: `No recovery line matching "${input.line}".` };
        const before = list[i];
        list[i] = typeof input.step === 'string' ? input.step : stepText(normalizeStep(input.step));
        m.faultRecovery = list;
        return pushDiff(state, { op, machine: m.name, before, after: list[i], line: i + 1 });
      }
      const steps = stepsOf(m);
      const i = resolveLine(steps, m, input.line);
      if (i === -1) return { error: `No sequence line matching "${input.line}" on ${m.name}.` };
      const before = stepText(steps[i]);
      const step = normalizeStep(input.step);
      if (!step) return { error: 'sequence.reword needs a step object' };
      steps[i] = step;
      writeSteps(m, steps);
      return pushDiff(state, { op, machine: m.name, before, after: stepText(step), line: i + 1 });
    }
    case 'sequence.set_tag': case 'sequence.clear_tag': {
      // TAG OPS TOUCH THE COUNTERPART ONLY — physically cannot delete a line.
      const m = findMachine(state, input.machine);
      if (!m) return { error: `No machine matching "${input.machine}".` };
      const steps = stepsOf(m);
      const i = resolveLine(steps, m, input.line);
      if (i === -1) return { error: `No sequence line matching "${input.line}" on ${m.name}.` };
      const before = stepText(steps[i]);
      steps[i] = { ...steps[i], counterpart: op === 'sequence.set_tag' ? String(input.counterpart ?? '').trim() : '' };
      writeSteps(m, steps);
      return pushDiff(state, { op, machine: m.name, before, after: stepText(steps[i]), line: i + 1 });
    }
    case 'value.set': {
      const row = (summary.devices ?? []).find((x) => keysMatch(x?.displayName ?? x?.name, input.device));
      if (!row) return { error: `No device matching "${input.device}".` };
      const field = String(input.field ?? '').trim();
      if (!field || field === 'name' || field === 'displayName') return { error: 'value.set: bad field' };
      const before = row[field];
      row[field] = input.value;
      return pushDiff(state, { op, device: row.displayName ?? row.name, field, before: before ?? null, after: input.value });
    }
    default:
      return { error: `Unknown op "${op}".` };
  }
}

// ── tool schema (Anthropic format) ──────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'read_sheet',
    description: 'Read the complete current sheet + proposal exactly as the engineer sees it: devices (with their machine), each machine\'s sequence as numbered structured steps (action/target/detail/counterpart — the counterpart IS the interaction tag), fault recovery, and the open questions. ALWAYS read this before editing.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_chat_history',
    description: 'The draft\'s full conversation so far (both sides).',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'read_cascade_position',
    description: 'Where the engineer is in the walk: active step, approved steps, approved machine names.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_knowledge',
    description: 'Read a knowledge file: "laws" (the standing rulings, default) or a concept by name (e.g. "station-archetypes", "multi-state-machine", "servo-motion").',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'search_precedents',
    description: 'Search the shipped-work precedent digest (real device names, ownership patterns, station shapes). Cite what you find.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'search_shipped_code',
    description: 'Search the shipped PLC code library (plc-reference/, incl. engineer-VERIFIED exemplars, ranked first). Returns file + line + text. Use before asking a human anything a shipped file could answer.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'apply_edit',
    description: 'Apply typed edits to the working draft. Returns the real diff(s) (or errors). BATCH related edits: pass `ops: [ {op, ...}, ... ]` to apply a whole set in ONE call (e.g. drafting a 5-line recovery = one call with 5 recovery.insert ops) — never one call per line. Single-edit form (top-level op) still works. Ops: device.remove {device} (atomic: row + questions + record) · device.add {name,type?,machine?} · device.rename {device,newName} · device.reassign {device,machine,evidence?} · machine.rename {machine,newName} (rejected for approved machines) · sequence.insert {machine, afterLine?, step:{action,target,detail?,counterpart?}} · sequence.remove {machine,line} · sequence.reword {machine,line,step} · sequence.set_tag {machine,line,counterpart} · sequence.clear_tag {machine,line} (tag ops touch the counterpart ONLY) · recovery.insert/remove/reword {machine,...} · value.set {device,field,value}. Line refs: 1-based number or the line\'s text. Action vocabulary: Extend/Retract, Engage/Disengage (grippers), Servo Move, Index, Wait, Signal, Home, Repeat.',
    input_schema: {
      type: 'object',
      properties: {
        op: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' }, description: 'batch form: a list of op objects applied in order' },
        device: { type: 'string' }, name: { type: 'string' }, newName: { type: 'string' },
        machine: { type: 'string' }, evidence: { type: 'string' },
        line: {}, afterLine: { type: 'number' },
        step: {}, counterpart: { type: 'string' },
        field: { type: 'string' }, value: {}, type: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'close_question',
    description: 'Close an open question you have answered (from precedent/shipped work — include the citation) or that is now stale. Pass enough of the question text to identify it.',
    input_schema: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question'], additionalProperties: false },
  },
  {
    name: 'ask_engineer',
    description: 'File a question for the engineer on the active step. SEARCH FIRST — behavior/sequence/recovery questions require search_shipped_code / search_precedents BEFORE asking. `evidence` is REQUIRED: what the search found ("In our shipped bowl-feeder escapements — S05_ServoPNP, FlexFeeder — starved feed waits on part-present, no fault") or the explicit \'I searched our shipped work and standards — no example of X\'. A question without it is rejected. Mechanical/geometry questions are his; controls decisions are yours.',
    input_schema: {
      type: 'object',
      properties: {
        covKey: { type: 'string', enum: ['devices', 'sequence', 'failures', 'interactions'] },
        question: { type: 'string' }, proposedSolution: { type: 'string' },
        evidence: { type: 'string', description: 'what the shipped-work search found, cited — or the explicit found-nothing sentence' },
      },
      required: ['question', 'evidence'], additionalProperties: false,
    },
  },
  {
    name: 'file_knowledge',
    description: 'File a GENERAL SDC pattern the engineer just taught you ("loads are verified at the next check station when one exists") into the standing knowledge — dated, cited to him. Only for durable, general rules he states; never for one-station specifics (those live in the draft).',
    input_schema: {
      type: 'object',
      properties: { fact: { type: 'string' }, citedTo: { type: 'string', description: 'who taught it (default: the engineer)' } },
      required: ['fact'], additionalProperties: false,
    },
  },
  {
    name: 'note_to_engineer',
    description: 'ONE plain sentence, only when a request was honored somewhere other than a visible line — say where it went. Never for style notes or internals.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  },
];

// Human phrasing for the streamed activity line.
function eventLabelFor(name, input) {
  switch (name) {
    case 'read_sheet': return 'reading the sheet…';
    case 'read_chat_history': return 'reading the conversation…';
    case 'read_cascade_position': return 'checking where you are in the walk…';
    case 'read_knowledge': return `reading ${input?.name ?? 'the standing rulings'}…`;
    case 'search_precedents': return `searching shipped work for "${String(input?.query ?? '').slice(0, 40)}"…`;
    case 'search_shipped_code': return `searching the code library for "${String(input?.query ?? '').slice(0, 40)}"…`;
    case 'apply_edit': return `editing (${String(input?.op ?? 'edit')}${input?.machine ? ` — ${input.machine}` : ''})…`;
    case 'close_question': return 'closing a question…';
    case 'ask_engineer': return 'writing you a question…';
    case 'note_to_engineer': return 'noting where a change went…';
    default: return `${name}…`;
  }
}

function executeTool(state, name, input) {
  switch (name) {
    case 'read_sheet': {
      const d = state.draft;
      const devices = (d.summary?.devices ?? []).map((x, i) => ({
        n: i + 1, name: x?.displayName ?? x?.name, type: x?.type ?? null,
        machine: deviceMachineOf(state, x?.displayName ?? x?.name),
      }));
      const machines = machinesOf(state).map((m) => ({
        name: m.name,
        ownedDeviceNames: m.ownedDeviceNames ?? [],
        sequence: stepsOf(m).map((s, i) => ({
          n: i + 1, text: stepText(s),
          action: s.action || null, counterpart: s.counterpart || null,
        })),
        faultRecovery: m.faultRecovery ?? [],
      }));
      return {
        stationName: d.name ?? null,
        devices, machines,
        stationSequence: d.summary?.sequence ?? [],
        stationRecovery: d.summary?.failureHandling ?? [],
        openQuestions: openNeeds(state).map((n) => ({ covKey: n.covKey, question: n.question, device: n.device ?? null })),
      };
    }
    case 'read_chat_history': {
      const lim = Math.min(Number(input?.limit) || 40, 80);
      return { turns: (state.draft?.chatThread ?? []).slice(-lim).map((t) => ({ role: t.role, text: String(t.text ?? '').slice(0, 500) })) };
    }
    case 'read_cascade_position':
      return state.cascadePosition ?? { note: 'no cascade position provided' };
    case 'read_knowledge':
      return { text: String(readKnowledge(input?.name)).slice(0, 24000) };
    case 'search_precedents':
      return { text: searchPrecedents(input?.query) };
    case 'search_shipped_code':
      return searchShippedCode(input?.query, Math.min(Number(input?.maxResults) || 15, 30));
    case 'apply_edit': {
      // BATCH FORM (Dan's cost-cap turn, 2026-08-30): a whole recovery drafts
      // in ONE call — each op returns its own real diff, in order.
      if (Array.isArray(input?.ops) && input.ops.length) {
        return { results: input.ops.slice(0, 40).map((one) => applyEdit(state, one)) };
      }
      return applyEdit(state, input);
    }
    case 'close_question': {
      const want = normKey(input?.question);
      const hit = openNeeds(state).find((n) => normKey(n.question).includes(want) || want.includes(normKey(n.question)));
      if (!hit) return { error: 'No open question matches that text.' };
      state.draft.agreedNeeds = [...new Set([...(state.draft.agreedNeeds ?? []), `${hit.covKey}:${hit.question}`])];
      state.closedQuestions.push(hit.question);
      pushDiff(state, { op: 'question.close', before: hit.question, after: null, answer: String(input?.answer ?? '') });
      return { closed: hit.question };
    }
    case 'ask_engineer': {
      const covKey = ['devices', 'sequence', 'failures', 'interactions'].includes(input?.covKey) ? input.covKey : 'devices';
      const q = {
        question: String(input?.question ?? '').trim(),
        proposedSolution: String(input?.proposedSolution ?? '').trim(),
        evidence: String(input?.evidence ?? '').trim(),
        blocking: false,
      };
      if (!q.question) return { error: 'ask_engineer needs a question' };
      // SEARCH BEFORE ASK (Dan, 2026-08-30) — structural, not advisory.
      if (!q.evidence) {
        return { error: 'REJECTED: evidence is required — search the shipped work first and cite what you found, or state explicitly that the search found nothing.' };
      }
      const cov = state.draft.jarvisCoverage ?? (state.draft.jarvisCoverage = {});
      cov[covKey] = cov[covKey] ?? {};
      cov[covKey].needs = [...(cov[covKey].needs ?? []), q];
      state.asks.push({ covKey, ...q });
      pushDiff(state, { op: 'question.ask', covKey, after: q.question, before: null });
      return { filed: q.question };
    }
    case 'file_knowledge': {
      const fact = String(input?.fact ?? '').trim();
      if (!fact) return { error: 'file_knowledge needs a fact' };
      try {
        const who = String(input?.citedTo ?? '').trim() || 'the engineer, in the station chat';
        const r = fileToMeKnowledgeShared([`${fact} (taught by ${who})`], 'station chat');
        pushDiff(state, { op: 'knowledge.file', after: fact, before: null });
        return { filed: r?.recorded?.length ? 'meKnowledge.md' : 'duplicate — already known' };
      } catch (e) { return { error: `filing failed: ${e.message}` }; }
    }
    case 'note_to_engineer': {
      const text = String(input?.text ?? '').trim();
      if (text) state.notes.push(text);
      return { noted: !!text };
    }
    default:
      return { error: `Unknown tool "${name}".` };
  }
}

module.exports = {
  TOOL_DEFINITIONS, createTurnState, executeTool, eventLabelFor,
  devKey, normKey, parseStepText,
};
