/**
 * ir.js — Intermediate Representation of one state machine for JARVIS.
 *
 * buildIR(projectJson, smId) returns (irVersion 1 — machine-readable, persisted
 * as .ir.json next to every generated L5X so the UI can render the compiled
 * "Full Controls" view):
 *   {
 *     irVersion: 1,
 *     smId, smName, displayName, stationNumber, description,
 *     devices:     [{ id, type, name, displayName, extras }],
 *     states:      [{ nodeId, type, label, stateNumber, isInitial, isComplete,
 *                     entryFrom: [stateNumber...],
 *                     actions: [{ operation, deviceId, deviceName, device,
 *                                 params: {...}, detail }] }],
 *     transitions: [{ fromLabel, toLabel, fromState, toState, from, to,
 *                     conditionType, label, outcomeLabel, branch,
 *                     conditionText, kind: 'sequence'|'wait'|'branch'|'recovery' }],
 *     waits:       [{ stateNumber, signal, source, partner, direction, mode }],
 *     stateRanges: { reserved, sequence: {from,to}, lockout, init: {from,to,cycleReady} },
 *     machineSpec: null | { purpose, devicePurposes, sequence, outcomeRules,
 *                     relationships, partnerDeclarations } — the Station Spec
 *                     questionnaire (mechanical intent) plus reciprocal
 *                     declarations from partner SMs; rendered into the IR
 *                     text as the "MACHINE SPEC" section,
 *     warnings:    [string],
 *     text:        human-readable rendering (what the engineer reviews and
 *                  what the model receives — the "intermediate representation")
 *   }
 *
 * State numbers are assigned deterministically here (DFS from the initial
 * node, first flowchart state = 4, +3 per state, outgoing edges visited
 * left-to-right by target X — same convention as the SDC standard templates
 * and src/lib/computeStateNumbers.js). The same numbers are used by the
 * prompt, by the merge validation, and by the diagram cross-check, so all
 * three always agree.
 *
 * CommonJS, plain Node, no dependencies.
 */

const STATE_BASE = 4;      // first flowchart state (template convention)
const STATE_STEP = 3;      // SDC grid: 4, 7, 10, ...
const VISION_SLOTS = 12;   // VisionInspect nodes consume 4 extra sub-states

function isVisionNode(node, devicesById) {
  return (node.data?.actions || []).some(a => {
    const op = (a.operation || '').toLowerCase();
    if (op.includes('vision')) return true;
    const dev = devicesById.get(a.deviceId);
    return dev && /vision/i.test(dev.type || '');
  });
}

/**
 * DFS state-number assignment.
 * @returns {{ numbers: Map<nodeId, number>, warnings: string[] }}
 */
function assignStateNumbers(nodes, edges, devicesById) {
  const warnings = [];
  const numbers = new Map();
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const initial = nodes.find(n => n.data?.isInitial) || nodes[0];
  if (!initial) return { numbers, warnings: ['No nodes in state machine'] };

  const outgoing = new Map(); // nodeId -> [edge]
  for (const e of edges || []) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e);
  }
  // Left-to-right by target X (matches Canvas DFS convention)
  for (const list of outgoing.values()) {
    list.sort((a, b) => {
      const ax = nodeById.get(a.target)?.position?.x ?? 0;
      const bx = nodeById.get(b.target)?.position?.x ?? 0;
      return ax - bx;
    });
  }

  let next = STATE_BASE;
  const stack = [initial.id];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodeById.get(id);
    if (!node) continue;
    numbers.set(id, next);
    if (isVisionNode(node, devicesById)) {
      warnings.push(`Node "${node.data?.label || id}" is a vision node — consumes ${VISION_SLOTS / STATE_STEP + 1} state slots`);
      next += STATE_STEP + VISION_SLOTS;
    } else {
      next += STATE_STEP;
    }
    // push children in REVERSE so the leftmost is numbered first (stack pop order)
    const kids = (outgoing.get(id) || []).map(e => e.target).filter(t => !seen.has(t));
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  if (next - STATE_STEP > 97) {
    warnings.push(`Highest assigned state ${next - STATE_STEP} exceeds the sequence range (4..97)`);
  }
  const unreachable = nodes.filter(n => !numbers.has(n.id));
  for (const n of unreachable) {
    warnings.push(`Node "${n.data?.label || n.id}" is unreachable from the initial node — no state number assigned`);
  }
  return { numbers, warnings };
}

function actionDetail(a) {
  return Object.entries(a)
    .filter(([k, v]) => !['id', 'deviceId', 'operation'].includes(k) && v != null && v !== '')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
}

/** Structured params object for one action (everything except identity keys). */
function actionParams(a) {
  return Object.fromEntries(Object.entries(a)
    .filter(([k, v]) => !['id', 'deviceId', 'operation'].includes(k) && v != null && v !== ''));
}

// ── Compiled-view enrichment (irVersion 1) ───────────────────────────────────
//
// The UI's "Full Controls" compiled view renders directly from these fields:
// real state numbers, transitions with readable conditions + kinds, the
// wait/handshake list, and the reserved/init state ranges. Everything here is
// derived deterministically from the diagram — no model involvement.

const IR_VERSION = 1;

/** Readable text for a stored edge conditionType. */
const CONDITION_TYPE_TEXT = {
  trigger: 'previous actions complete',
  timer: 'delay timer done',
  sensorOn: 'sensor on',
  sensorOff: 'sensor off',
  sensorTimer: 'sensor on + delay timer done',
  servoAtTarget: 'servo at target position',
  servoComplete: 'servo move complete',
  checkResult: 'check result',
  visionResult: 'vision result',
  ready: 'partner ready',
  always: 'always',
  custom: 'custom condition',
  indexComplete: 'index complete',
  escapementComplete: 'escapement complete',
  partPresent: 'part present',
  analogInRange: 'analog value in range',
};

/** Human-readable transition condition ("wait: Magnet_Presented",
 *  "StamperVision.Link_Orient = Fail", "delay timer done"). */
function transitionConditionText(edge, sourceNode) {
  const d = edge.data || {};
  const sd = sourceNode?.data || {};
  if (sourceNode?.type === 'decisionNode') {
    const sig = [sd.signalSource, sd.signalName].filter(Boolean).join('.') || 'signal';
    if ((sd.exitCount ?? 1) === 2) {
      const outcome = d.outcomeLabel || d.label ||
        (d.exitColor ? d.exitColor.charAt(0).toUpperCase() + d.exitColor.slice(1) : 'Pass');
      return `${sig} = ${outcome}`;
    }
    return `wait: ${sig}`;
  }
  // Embedded-decision exits on a StateNode: the outcome IS the condition.
  if (d.isDecisionExit) {
    return d.outcomeLabel || d.label ||
      (d.exitColor ? d.exitColor.charAt(0).toUpperCase() + d.exitColor.slice(1) : 'Pass');
  }
  // The edge label is the engineer-readable condition when present
  // (e.g. "ZAxis_MAM.PC + ZAxisPick.InPos"); fall back to the type text.
  if (d.label) return d.label;
  if (d.conditionType) return CONDITION_TYPE_TEXT[d.conditionType] || d.conditionType;
  if (d.outcomeLabel) return d.outcomeLabel;
  return 'step complete';
}

/** Classify a transition for the compiled view.
 *  'branch'   — decision node with two exits (pass/fail fork)
 *  'wait'     — decision node single exit (hold until signal true)
 *  'recovery' — non-decision edge jumping BACKWARD to an earlier state (retry loop)
 *  'sequence' — normal forward step
 *  ('init' is reserved for the 100..127 template block, which lives in
 *   stateRanges — flowchart edges never carry it.) */
function transitionKind(edge, sourceNode, fromState, toState) {
  if (sourceNode?.type === 'decisionNode') {
    return (sourceNode.data?.exitCount ?? 1) === 2 ? 'branch' : 'wait';
  }
  if (edge.data?.isDecisionExit) {
    return edge.sourceHandle === 'exit-single' ? 'wait' : 'branch';
  }
  if (fromState != null && toState != null && toState < fromState) return 'recovery';
  return 'sequence';
}

/** Build the IR for one state machine of a project. Throws when SM missing. */
function buildIR(projectJson, smId) {
  const sms = projectJson?.stateMachines || [];
  const sm = smId ? sms.find(s => s.id === smId) : sms[0];
  if (!sm) throw new Error(`State machine not found: ${smId || '(first)'} in project "${projectJson?.name}"`);

  const devicesById = new Map((sm.devices || []).map(d => [d.id, d]));
  const { numbers, warnings } = assignStateNumbers(sm.nodes || [], sm.edges || [], devicesById);
  const nodeById = new Map((sm.nodes || []).map(n => [n.id, n]));
  const nodeLabel = n => {
    if (!n) return '(unknown node)';
    const d = n.data || {};
    return d.label || d.signalSource || d.signalName || n.type || n.id;
  };

  const devices = (sm.devices || []).map(d => ({
    id: d.id,
    type: d.type,
    name: d.name,
    displayName: d.displayName || d.name,
    extras: Object.fromEntries(Object.entries(d)
      .filter(([k, v]) => !['id', 'type', 'name', 'displayName'].includes(k) && v != null)),
  }));

  const states = (sm.nodes || []).map(n => {
    const d = n.data || {};
    return {
      nodeId: n.id,
      type: n.type,
      label: nodeLabel(n),
      stateNumber: numbers.get(n.id) ?? null,
      isInitial: !!d.isInitial,
      isComplete: !!d.isComplete,
      decisionType: n.type === 'decisionNode' ? (d.decisionType || 'signal') : undefined,
      signalSource: d.signalSource,
      signalName: d.signalName,
      exitCount: d.exitCount,
      actions: (d.actions || []).map(a => ({
        operation: a.operation,
        deviceId: a.deviceId,
        deviceName: devicesById.get(a.deviceId)?.name || null,
        device: devicesById.get(a.deviceId)
          ? (devicesById.get(a.deviceId).displayName || devicesById.get(a.deviceId).name)
          : null,
        params: actionParams(a),
        detail: actionDetail(a),
      })),
      entryFrom: [], // filled below from transitions
    };
  }).sort((a, b) => (a.stateNumber ?? 1e9) - (b.stateNumber ?? 1e9));

  const transitions = (sm.edges || []).map(e => {
    const d = e.data || {};
    const src = nodeById.get(e.source);
    const fromState = numbers.get(e.source) ?? null;
    const toState = numbers.get(e.target) ?? null;
    return {
      fromLabel: nodeLabel(src),
      toLabel: nodeLabel(nodeById.get(e.target)),
      fromState,
      toState,
      from: fromState,
      to: toState,
      conditionType: d.conditionType || null,
      label: d.label || null,
      outcomeLabel: d.outcomeLabel || null,
      branch: d.exitColor || null,
      conditionText: transitionConditionText(e, src),
      kind: transitionKind(e, src, fromState, toState),
    };
  });

  // entryFrom: which states transition INTO each state (real state numbers).
  const stateByNumber = new Map(states.filter(s => s.stateNumber != null).map(s => [s.stateNumber, s]));
  for (const t of transitions) {
    if (t.toState == null || t.fromState == null) continue;
    const target = stateByNumber.get(t.toState);
    if (target && !target.entryFrom.includes(t.fromState)) target.entryFrom.push(t.fromState);
  }
  for (const s of states) s.entryFrom.sort((a, b) => a - b);

  // Waits / handshake signals — the compiled view's "what does this station
  // wait on" list. One entry per decision node, plus one per 'ready'-type
  // transition (partner-handshake conditions embedded on state exits).
  const waits = states
    .filter(s => s.type === 'decisionNode')
    .map(s => ({
      stateNumber: s.stateNumber,
      signal: s.signalName || null,
      source: s.signalSource || null,
      partner: nodeById.get(s.nodeId)?.data?.signalSmName || null,
      direction: 'incoming', // this SM waits on the signal; outgoing p_ latches live in actions
      mode: (s.exitCount ?? 1) === 2 ? 'branch' : 'wait',
    }));
  for (const t of transitions) {
    // Branch/decision exits also carry conditionType 'ready' — they're already
    // covered by the decision entries above / the transition's own kind.
    if (t.kind === 'sequence' && t.conditionType === 'ready' && t.fromState != null) {
      waits.push({
        stateNumber: t.fromState,
        signal: t.label || 'Ready',
        source: null,
        partner: null,
        direction: 'incoming',
        mode: 'handshake',
      });
    }
  }
  waits.sort((a, b) => (a.stateNumber ?? 1e9) - (b.stateNumber ?? 1e9));

  const assigned = [...numbers.values()];
  const stateRanges = {
    reserved: { powerup: 0, sdc: [1, 2, 3] },
    sequence: { from: STATE_BASE, to: assigned.length ? Math.max(...assigned) : null },
    lockout: 99,
    init: { from: 100, to: 127, cycleReady: 127 },
  };

  const ir = {
    irVersion: IR_VERSION,
    smId: sm.id,
    smName: sm.name,
    displayName: sm.displayName || sm.name,
    stationNumber: sm.stationNumber ?? 1,
    description: sm.description || '',
    devices,
    states,
    transitions,
    waits,
    stateRanges,
    machineSpec: buildMachineSpecIR(sm, sms),
    warnings,
  };
  ir.text = renderIRText(ir);
  return ir;
}

// ── Machine Spec (mechanical intent) ─────────────────────────────────────────
//
// sm.machineSpec is authored by the mechanical engineer through the Station
// Spec questionnaire (SpecEditorModal). It is AUTHORITATIVE intent: purposes,
// outcome rules (what can go wrong + how to handle it), and station
// relationships. JARVIS synthesizes the signals/waits/exits that realize it —
// the ME never authors those. We also gather the RECIPROCAL declarations that
// partner SMs make about this station, so the model sees both sides of every
// handshake.

function specHasContent(spec) {
  if (!spec) return false;
  return Boolean(
    (spec.purpose || '').trim() ||
    Object.keys(spec.devicePurposes || {}).length ||
    (spec.sequence || []).length ||
    (spec.outcomeRules || []).length ||
    (spec.relationships || []).length
  );
}

/** Structured machine-spec block for one SM, or null when nothing is authored
 *  by this SM or about it by any partner. */
function buildMachineSpecIR(sm, allSms) {
  const spec = sm.machineSpec || null;

  // Reciprocal declarations: any other SM whose spec has a relationship
  // pointing at this SM (by id or name).
  const partnerDeclarations = [];
  for (const other of allSms) {
    if (other.id === sm.id) continue;
    for (const rel of (other.machineSpec?.relationships || [])) {
      const hit = rel.withSmId === sm.id ||
        (rel.withSmName && (rel.withSmName === sm.name || rel.withSmName === sm.displayName));
      if (hit) {
        partnerDeclarations.push({
          partnerSmName: other.displayName || other.name,
          partnerStationNumber: other.stationNumber ?? null,
          kind: rel.kind || 'custom',
          description: rel.description || '',
          partnerOutcomeRules: (other.machineSpec?.outcomeRules || []).map(r => ({
            trigger: r.trigger, response: r.response,
            retryCount: r.retryCount ?? null, escalation: r.escalation || '',
          })),
        });
      }
    }
  }

  if (!specHasContent(spec) && partnerDeclarations.length === 0) return null;

  const smNameById = new Map(allSms.map(s => [s.id, s.displayName || s.name]));
  const deviceNameById = new Map((sm.devices || []).map(d => [d.id, d.displayName || d.name]));

  return {
    purpose: spec?.purpose || '',
    devicePurposes: Object.entries(spec?.devicePurposes || {}).map(([deviceId, purpose]) => ({
      deviceName: deviceNameById.get(deviceId) || deviceId,
      purpose,
    })),
    sequence: (spec?.sequence || []).map(s => s.text),
    outcomeRules: (spec?.outcomeRules || []).map(r => ({
      trigger: r.trigger || '',
      response: r.response || '',
      retryCount: r.retryCount ?? null,
      escalation: r.escalation || '',
    })),
    relationships: (spec?.relationships || []).map(r => ({
      withSm: smNameById.get(r.withSmId) || r.withSmName || r.withSmId || '(unknown station)',
      kind: r.kind || 'custom',
      description: r.description || '',
    })),
    partnerDeclarations,
  };
}

function renderMachineSpecText(ms, lines) {
  lines.push('', '## MACHINE SPEC (mechanical intent — compile the coordination)');
  lines.push('This section is AUTHORITATIVE intent authored by the mechanical engineer.');
  lines.push('Synthesize the signals, waits, exits, and cross-station handshakes that');
  lines.push('realize it. EVERY wait you create must have an exit for every partner');
  lines.push('failure mode listed here PLUS a timeout — no exitless waits.');
  if (ms.purpose) lines.push('', `Station purpose: ${ms.purpose}`);
  if (ms.devicePurposes.length) {
    lines.push('', '### Device purposes');
    for (const d of ms.devicePurposes) lines.push(`- ${d.deviceName}: ${d.purpose}`);
  }
  if (ms.sequence.length) {
    lines.push('', '### Spec-authored sequence (no drawn nodes — this is the sequence)');
    ms.sequence.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (ms.outcomeRules.length) {
    lines.push('', '### Outcome rules (verbatim — each one needs a reachable path in the program)');
    for (const r of ms.outcomeRules) {
      const retry = r.retryCount != null ? ` [retry up to ${r.retryCount}x]` : '';
      const esc = r.escalation ? ` WHEN RETRIES RUN OUT: ${r.escalation}` : '';
      lines.push(`- WHEN: ${r.trigger} -> DO: ${r.response}${retry}.${esc}`);
    }
  }
  if (ms.relationships.length) {
    lines.push('', '### Relationships declared by this station');
    for (const r of ms.relationships) {
      lines.push(`- ${r.kind} -> ${r.withSm}: ${r.description || '(no description)'}`);
    }
  }
  if (ms.partnerDeclarations.length) {
    lines.push('', '### Reciprocal declarations by partner stations (their side of the handshake)');
    for (const p of ms.partnerDeclarations) {
      const sta = p.partnerStationNumber != null ? ` (station ${p.partnerStationNumber})` : '';
      lines.push(`- ${p.partnerSmName}${sta} declares ${p.kind} -> this station: ${p.description || '(no description)'}`);
      for (const r of p.partnerOutcomeRules) {
        const retry = r.retryCount != null ? ` [retry up to ${r.retryCount}x]` : '';
        const esc = r.escalation ? ` WHEN RETRIES RUN OUT: ${r.escalation}` : '';
        lines.push(`    partner failure mode - WHEN: ${r.trigger} -> DO: ${r.response}${retry}.${esc}`);
      }
    }
  }
}

/** Human-readable IR rendering — reviewed by the engineer, consumed by the model. */
function renderIRText(ir) {
  const lines = [];
  lines.push(`# Intermediate Representation — ${ir.smName}` +
    (ir.displayName !== ir.smName ? ` (${ir.displayName})` : ''));
  lines.push(`Station number: ${ir.stationNumber}`);
  if (ir.description) lines.push(`Description: ${ir.description}`);

  lines.push('', '## Devices');
  for (const d of ir.devices) {
    const extras = Object.entries(d.extras).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    lines.push(`- [${d.type}] ${d.name}` +
      (d.displayName !== d.name ? ` "${d.displayName}"` : '') +
      (extras ? ` ${extras}` : ''));
  }

  lines.push('', '## States (assigned state numbers — these are FINAL, use them as-is)');
  for (const s of ir.states) {
    const flags = [
      s.isInitial ? 'INITIAL' : null,
      s.isComplete ? 'CYCLE-COMPLETE' : null,
      s.type === 'decisionNode' ? `DECISION(${s.decisionType})` : null,
    ].filter(Boolean).join(', ');
    const num = s.stateNumber != null ? `State ${s.stateNumber}` : 'UNREACHABLE';
    lines.push(`- ${num}: "${s.label}"` + (flags ? ` {${flags}}` : ''));
    for (const a of s.actions) {
      lines.push(`    action: ${a.operation} -> ${a.deviceName || a.deviceId || '(no device)'}` +
        (a.detail ? ` (${a.detail})` : ''));
    }
    if (s.type === 'decisionNode') {
      lines.push(`    condition: source=${s.signalSource || '?'} signal=${s.signalName || '?'} exits=${s.exitCount || 1}`);
    }
  }

  lines.push('', '## Transitions');
  for (const t of ir.transitions) {
    const cond = [
      t.conditionType ? `type=${t.conditionType}` : null,
      t.label ? `label="${t.label}"` : null,
      t.outcomeLabel ? `outcome="${t.outcomeLabel}"` : null,
      t.branch ? `branch=${t.branch}` : null,
    ].filter(Boolean).join(' ');
    lines.push(`- [${t.fromState ?? '?'}] "${t.fromLabel}" -> [${t.toState ?? '?'}] "${t.toLabel}"` +
      (cond ? ` (${cond})` : ''));
  }

  if (ir.machineSpec) renderMachineSpecText(ir.machineSpec, lines);

  if (ir.warnings.length) {
    lines.push('', '## IR warnings');
    for (const w of ir.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

module.exports = { buildIR, assignStateNumbers, STATE_BASE, STATE_STEP, IR_VERSION };
