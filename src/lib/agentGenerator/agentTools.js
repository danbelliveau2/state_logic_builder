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

// Recovery-as-branching-flow + machine normalization live in smDecomposer.
const { flattenRecoveryItems, normalizeRecoveryItems, normalizeMachine } = require('./smDecomposer.js');

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
function createTurnState(draft, cascadePosition, { speaker = 'Dan' } = {}) {
  return {
    draft: JSON.parse(JSON.stringify(draft ?? {})),
    cascadePosition: cascadePosition ?? null,
    speaker: String(speaker || 'Dan'),
    diffs: [],
    asks: [],
    notes: [],
    closedQuestions: [],
    events: [],
  };
}

// ── TIER 2/3 stores (Dan's boundary design, 2026-08-30) ─────────────────────
const PENDING_LAWS_PATH = path.join(ROOT, 'jarvis-knowledge', 'pending-laws.json');
const APP_SUGGESTIONS_PATH = path.join(ROOT, 'jarvis-knowledge', 'app-suggestions.json');
function readJsonFile(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJsonFile(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
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
      // DEVICE-LINKED LINES (Dan, 2026-08-30: "the sequence can't be
      // different names — it's got to be based on the devices always"):
      // every sequence/recovery line that touches this device re-renders
      // with the new name — by devId link when present, name-match else.
      const devId = row.devId ?? null;
      for (const m of machinesOf(state)) {
        const steps = stepsOf(m);
        let touched = false;
        for (const s of steps) {
          if ((devId && s.deviceId === devId) || keysMatch(s.target, from)) {
            s.target = to;
            if (devId) s.deviceId = devId;
            touched = true;
          }
        }
        if (touched) writeSteps(m, steps);
        if (Array.isArray(m.faultRecovery) && m.faultRecovery.length) {
          const esc2 = String(before).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(esc2, 'gi');
          const next = m.faultRecovery.map((l) => String(l).replace(re, to));
          if (JSON.stringify(next) !== JSON.stringify(m.faultRecovery)) m.faultRecovery = next;
        }
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
    case 'recovery.set': {
      // THE branching-recovery writer (Dan, 2026-08-30): the whole recovery
      // in ONE call — linear steps until a DECISION, then labeled branches.
      const m = findMachine(state, input.machine);
      if (!m) return { error: `No machine matching "${input.machine}".` };
      const items = normalizeRecoveryItems(input.recovery);
      if (!items.length) return { error: 'recovery.set needs recovery: [ step | {decision, branches:[{label, steps:[…]}]} … ]' };
      const before = [...(m.faultRecovery ?? [])];
      m.faultRecoverySteps = items;
      m.faultRecovery = flattenRecoveryItems(items);
      return pushDiff(state, {
        op, machine: m.name,
        before: before.join(' | ').slice(0, 300) || null,
        after: m.faultRecovery.join(' | ').slice(0, 300),
        lines: m.faultRecovery.length,
      });
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
    description: 'Apply typed edits to the working draft. Returns the real diff(s) (or errors). BATCH related edits: pass `ops: [ {op, ...}, ... ]` to apply a whole set in ONE call (e.g. drafting a 5-line recovery = one call with 5 recovery.insert ops) — never one call per line. Single-edit form (top-level op) still works. Ops: device.remove {device} (atomic: row + questions + record) · device.add {name,type?,machine?} · device.rename {device,newName} · device.reassign {device,machine,evidence?} · machine.rename {machine,newName} (rejected for approved machines) · sequence.insert {machine, afterLine?, step:{action,target,detail?,counterpart?}} · sequence.remove {machine,line} · sequence.reword {machine,line,step} · sequence.set_tag {machine,line,counterpart} · sequence.clear_tag {machine,line} (tag ops touch the counterpart ONLY) · recovery.insert/remove/reword {machine,...} · value.set {device,field,value}. Line refs: 1-based number or the line\'s text. Action vocabulary: Extend/Retract, Engage/Disengage (grippers), Servo Move, Index, Wait, Signal, Home, Repeat. DEVICE LINKS: a step that acts on a sheet device carries its devId as step.deviceId and the device\'s REAL current name as target — never shorthand ("Z", "X"); read_sheet lists every device\'s devId. RECOVERY IS A BRANCHING FLOW: write it with recovery.set {machine, recovery:[ step | {decision:"Gripper Engaged?", branches:[{label:"Yes", steps:[…]}, {label:"No", steps:[…]}]} ]} — linear steps until a decision, then labeled branches; NEVER inline "if …" conditions in a step\'s text. DETAIL RULES: pneumatic actions are the whole statement — NO detail clause ("Retract Vertical Slide", never "— to clear height"); Servo Move carries the NAMED POSITION as detail ("Servo Move X Axis — Place Position"); named things (devices, positions, signals) are Title Case.',
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
    name: 'propose_split',
    description: 'THE DECOMPOSE GATE (structured output — never raw JSON in prose): propose or revise the station\'s state-machine split in ONE call. Pass the COMPLETE proposal: every machine with name (natural SDC speech, spaces), oneLiner, ownedDeviceNames (every sheet device owned somewhere), why (the asynchrony reason), sequence (structured steps; decisions allowed), faultRecovery (branching flow). On a REVISION, carry everything the feedback does not touch verbatim — approved machine names are identity-locked and cannot change. Also pass reasoning (1-2 sentences TO the engineer).',
    input_schema: {
      type: 'object',
      properties: {
        stateMachines: { type: 'array', items: { type: 'object' } },
        reasoning: { type: 'string' },
      },
      required: ['stateMachines'], additionalProperties: false,
    },
  },
  {
    name: 'file_law',
    description: 'TIER 2 — DOCTRINE: the engineer stated a RULE about how Jarvis should think or behave ("sequences must always use real device names", a naming convention, a question format). File it as a standing law, dated + attributed. Laws from Dan activate immediately; anyone else\'s go to a pending queue for Dan\'s approval (say which happened in your reply). Only for durable rules about JARVIS\'s behavior — station facts use file_knowledge; app changes use suggest_app_change.',
    input_schema: {
      type: 'object',
      properties: { rule: { type: 'string', description: 'the rule, stated generally, in the speaker\'s intent' } },
      required: ['rule'], additionalProperties: false,
    },
  },
  {
    name: 'suggest_app_change',
    description: 'TIER 3 — APP SUGGESTION: the request needs a CODE change (how things render, new panels, new features, app behavior). You cannot modify the app and must never fake it with data edits — say so honestly and file the ask here for Dan\'s review. Carries the engineer\'s verbatim ask + your one-line reading of what they want.',
    input_schema: {
      type: 'object',
      properties: {
        ask: { type: 'string', description: 'the engineer\'s ask, verbatim or near-verbatim' },
        reading: { type: 'string', description: 'your one-line reading of what they want and why' },
      },
      required: ['ask', 'reading'], additionalProperties: false,
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
  {
    name: 'file_controls_note',
    description: 'THE OPTIONAL CE LANE (Dan, 2026-08-30): a CONTROLS engineer states controls intent for THIS station — how a signal is handled (what turns it on/off, latching vs event), logic preferences, anything that sharpens this station\'s code. File each such statement here (attributed, dated); it lands in the sheet\'s Controls notes section and rides into codegen with authority between Dan\'s words and generic precedent — never above SDC standards or the ME\'s approved mechanical content (conflicts become questions). STATION-SCOPED only: a rule meant for every station is TIER 2 — file_law instead (it queues for Dan\'s approval as a standard).',
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
    case 'file_controls_note': return 'filing the controls intent on the sheet…';
    default: return `${name}…`;
  }
}

function executeTool(state, name, input) {
  switch (name) {
    case 'read_sheet': {
      const d = state.draft;
      // EFFECTIVE VALUES (Dan, 2026-08-31): the sheet's SEMANTICS, never raw
      // stored numbers — a delay grayed out because a sensor governs the exit
      // reads as inactive here. Never ask about a value the sheet marks unused.
      const effTiming = (x) => {
        const arr = String(x?.sensorArrangement ?? '');
        if (!arr && x?.extTimerMs == null && x?.retTimerMs == null) return null;
        const noSensors = /no sensors|timer only/i.test(arr);
        const hasExt = !noSensors && /both|extend/i.test(arr);
        const hasRet = !noSensors && /both|retract/i.test(arr);
        const seg = (label, has, ms) => `${label}: ${has ? 'sensor governs the exit (any stored delay is inactive)' : (ms != null ? `${ms} ms timer` : 'timer (value unset)')}`;
        return [seg('extend/engage', hasExt, x?.extTimerMs ?? x?.engageTimerMs), seg('retract/disengage', hasRet, x?.retTimerMs ?? x?.disengageTimerMs)].join('; ');
      };
      const devices = (d.summary?.devices ?? []).map((x, i) => ({
        n: i + 1, name: x?.displayName ?? x?.name, type: x?.type ?? null,
        // DEVICE LINKS (Dan, 2026-08-30): reference devices by devId in
        // sequence/recovery steps — names derive from the link.
        devId: x?.devId ?? null,
        machine: deviceMachineOf(state, x?.displayName ?? x?.name),
        ...(x?.sensorArrangement ? { sensors: x.sensorArrangement } : {}),
        ...(effTiming(x) ? { timing: effTiming(x) } : {}),
      }));
      const machines = machinesOf(state).map((m) => ({
        name: m.name,
        ownedDeviceNames: m.ownedDeviceNames ?? [],
        sequence: stepsOf(m).map((s, i) => ({
          n: i + 1, text: stepText(s),
          action: s.action || null, counterpart: s.counterpart || null,
          deviceId: s.deviceId ?? null,
        })),
        faultRecovery: m.faultRecovery ?? [],
      }));
      return {
        stationName: d.name ?? null,
        devices, machines,
        stationSequence: d.summary?.sequence ?? [],
        stationRecovery: d.summary?.failureHandling ?? [],
        // THE OPTIONAL CE LANE: station-scoped controls intent, attributed.
        controlsNotes: (d.controlsNotes ?? []).map((n2) => ({ text: n2.text, by: n2.by, at: n2.at })),
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
      // READ THE THREAD BEFORE ASKING (Dan, 2026-08-30: "always remember the
      // chat and try to answer questions from it") — when the engineer's own
      // recent words already cover the question's subject, the ask is
      // rejected: file HIS answer instead (close_question / file_knowledge)
      // or ask a sharper follow-up that references what he said.
      {
        const stop = new Set(['what', 'when', 'where', 'which', 'does', 'should', 'would', 'that', 'this', 'with', 'into', 'from', 'have', 'happens', 'machine', 'station', 'actually']);
        const terms = [...new Set(String(q.question).toLowerCase().split(/[^a-z0-9-]+/)
          .filter((w) => w.length > 3 && !stop.has(w)))];
        const meText = (state.draft?.chatThread ?? []).filter((t) => t?.role === 'me')
          .slice(-6).map((t) => String(t.text ?? '').toLowerCase()).join(' ');
        const hits = terms.filter((w) => meText.includes(w));
        if (terms.length >= 3 && hits.length / terms.length >= 0.5) {
          return {
            error: `REJECTED: the engineer's recent messages already address this (his words mention: ${hits.slice(0, 5).join(', ')}). `
              + 'Read the chat history, file his answer (close_question with it, or file_knowledge for a general pattern), '
              + 'or ask a follow-up that explicitly builds on what he said.',
          };
        }
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
        const who = String(input?.citedTo ?? '').trim() || state.speaker || 'the engineer, in the station chat';
        // Non-Dan teachings queue for Dan's approval like laws do.
        if (!/^dan\b/i.test(state.speaker || '')) {
          const arr = readJsonFile(PENDING_LAWS_PATH, []);
          arr.push({ id: 'pl_' + Date.now().toString(36), kind: 'fact', rule: fact, speaker: state.speaker, at: new Date().toISOString(), status: 'pending' });
          writeJsonFile(PENDING_LAWS_PATH, arr);
          pushDiff(state, { op: 'knowledge.pending', after: fact, before: null, speaker: state.speaker });
          return { filed: 'pending — visible to Dan for approval; not active until approved' };
        }
        const r = fileToMeKnowledgeShared([`${fact} (taught by ${who})`], 'station chat');
        pushDiff(state, { op: 'knowledge.file', after: fact, before: null });
        return { filed: r?.recorded?.length ? 'meKnowledge.md' : 'duplicate — already known' };
      } catch (e) { return { error: `filing failed: ${e.message}` }; }
    }
    case 'propose_split': {
      // PHASE 2 (Dan: "Why not? What are we waiting for?"): the decompose
      // gate is a typed tool call — normalized machines, identity lock
      // enforced structurally, diffed like every other write.
      const machines = (Array.isArray(input?.stateMachines) ? input.stateMachines : [])
        .map((raw) => ({ ...normalizeMachine(raw), ...(raw && raw.nameByME ? { nameByME: true } : {}) }))
        .filter((m) => m.name);
      if (!machines.length) return { error: 'propose_split needs stateMachines: [{name, oneLiner, ownedDeviceNames, why, sequence, faultRecovery}]' };
      const approved = (state.cascadePosition?.approvedMachineNames ?? []).map(normKey).filter(Boolean);
      const prior = machinesOf(state);
      if (approved.length && prior.length) {
        // IDENTITY LOCK: approved machines keep their EXACT names; a revision
        // may not rename or drop them.
        for (const name of state.cascadePosition.approvedMachineNames) {
          const hit = machines.find((m) => normKey(m.name) === normKey(name));
          if (!hit) {
            return { error: `IDENTITY LOCK: "${name}" is approved — the revision must keep it (carry it forward verbatim unless the engineer's feedback explicitly restructures the split).` };
          }
          hit.name = String(name); // exact prior spelling survives drift
        }
      }
      // ME-EXPLICIT OUTRANKS EVERYTHING (Dan, 2026-09-01 — the Magnet Dial
      // clobber: he renamed machines by pencil, asked the chat to ADD one,
      // and the add reverted his names). A machine whose name the engineer
      // set (nameByME, stamped the moment he edits — not only after
      // approval) is an IMMUTABLE FACT: it passes through every re-proposal
      // untouched. An add ADDS; it never regenerates siblings' identities.
      for (let pi = 0; pi < prior.length; pi++) {
        const pm = prior[pi];
        if (!pm?.nameByME || !pm.name) continue;
        let hit = machines.find((m) => normKey(m.name) === normKey(pm.name));
        if (!hit) {
          // The model drifted the name — find the same machine by owned
          // devices, then by position, and force the engineer's name back.
          const devs = new Set((pm.ownedDeviceNames ?? pm.deviceNames ?? []).map(normKey).filter(Boolean));
          hit = devs.size ? machines.find((m) => (m.ownedDeviceNames ?? []).some((n) => devs.has(normKey(n)))) : null;
          if (!hit) hit = machines[pi];
        }
        if (!hit) {
          return { error: `ME-EXPLICIT NAME: "${pm.name}" was named by the engineer — the proposal must keep that machine exactly (existing machines pass through untouched; an add only appends).` };
        }
        hit.name = String(pm.name);
        hit.nameByME = true;
      }
      const before = prior.map((m) => m.name);
      state.draft.smProposal = { ...(state.draft.smProposal ?? {}), stateMachines: machines, reasoning: String(input?.reasoning ?? '').trim(), at: Date.now() };
      return pushDiff(state, {
        op: 'split.propose',
        before: before.length ? before.join(', ') : null,
        after: machines.map((m) => m.name).join(', '),
        machines: machines.length,
      });
    }
    case 'file_law': {
      // TIER 2 (Dan's boundary design, 2026-08-30): rules about how JARVIS
      // behaves. Dan's activate immediately; anyone else's queue pending.
      const rule = String(input?.rule ?? '').trim();
      if (!rule) return { error: 'file_law needs a rule' };
      try {
        if (/^dan\b/i.test(state.speaker || '')) {
          const r = fileToMeKnowledgeShared([`LAW (${state.speaker}, via the station chat): ${rule}`], 'station chat');
          pushDiff(state, { op: 'law.file', after: rule, before: null, speaker: state.speaker });
          return { filed: r?.recorded?.length ? 'active immediately — standing law' : 'duplicate — already law' };
        }
        const arr = readJsonFile(PENDING_LAWS_PATH, []);
        arr.push({ id: 'pl_' + Date.now().toString(36), kind: 'law', rule, speaker: state.speaker, at: new Date().toISOString(), status: 'pending' });
        writeJsonFile(PENDING_LAWS_PATH, arr);
        pushDiff(state, { op: 'law.pending', after: rule, before: null, speaker: state.speaker });
        return { filed: 'pending Dan\'s approval — queued on the SDC Engineer page; not active until approved' };
      } catch (e) { return { error: `filing failed: ${e.message}` }; }
    }
    case 'suggest_app_change': {
      // TIER 3: app changes are never self-applied and never faked with
      // data — they file for Dan's review, attributed, verbatim.
      const ask = String(input?.ask ?? '').trim();
      const reading = String(input?.reading ?? '').trim();
      if (!ask) return { error: 'suggest_app_change needs the ask' };
      try {
        const arr = readJsonFile(APP_SUGGESTIONS_PATH, []);
        arr.push({ id: 'as_' + Date.now().toString(36), speaker: state.speaker, ask, reading, at: new Date().toISOString(), status: 'new' });
        writeJsonFile(APP_SUGGESTIONS_PATH, arr);
        pushDiff(state, { op: 'app.suggest', after: ask, before: null, speaker: state.speaker });
        return { filed: 'app-suggestions queue — Dan reviews; accepted ones flow to the dev loop' };
      } catch (e) { return { error: `filing failed: ${e.message}` }; }
    }
    case 'note_to_engineer': {
      const text = String(input?.text ?? '').trim();
      if (text) state.notes.push(text);
      return { noted: !!text };
    }
    case 'file_controls_note': {
      // THE OPTIONAL CE LANE (Dan, 2026-08-30): station-scoped controls
      // intent — attributed + dated, lands in the sheet's Controls notes.
      const text = String(input?.text ?? '').trim();
      if (!text) return { error: 'file_controls_note needs text' };
      const note = { text, by: state.speaker || 'CE', at: new Date().toISOString() };
      state.draft.controlsNotes = [...(state.draft.controlsNotes ?? []), note];
      pushDiff(state, { op: 'controls.note', after: text, before: null });
      return { filed: 'Controls notes (this station)', by: note.by };
    }
    default:
      return { error: `Unknown tool "${name}".` };
  }
}

module.exports = {
  TOOL_DEFINITIONS, createTurnState, executeTool, eventLabelFor,
  devKey, normKey, parseStepText,
};
