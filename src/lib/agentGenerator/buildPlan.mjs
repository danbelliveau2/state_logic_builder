/**
 * buildPlan.mjs — THE BUILD PLAN (Dan, 2026-09-03).
 *
 * The station page is rebuilt around a ONE-PAGE-PER-STATION BUILD PLAN:
 * INPUTS → the engine's plan (a document the ME reads like a build sheet a
 * controls engineer would hand back) → he chats with it; edits show as
 * REDLINES on the document → he approves → SEQUENCE (the v3 canvas, "Use
 * first pass" compiles the plan's sequence; "Build your own" opens Home +
 * devices) → Build.
 *
 * ONE TRUTH: the plan is a DERIVED DOCUMENT over the sheet draft (machines /
 * devices / structured steps / interactions / failure handling) plus a small
 * plan-only overlay (`draft.plan.extras` — engineer-authored decisions,
 * standards notes, answered station-specific asks). Every chat edit lands on
 * the sheet through the existing typed ops (sequence.insert, device.rename,
 * value.set …) and the plan re-derives — so the redlines are simply
 * diff(plan.snapshot, buildPlan(draft)), and "✓ got it" moves the snapshot.
 *
 * Pure ESM, no React, no store — importable by the client (vite) and the
 * server (Node 24 `require(esm)`), the offline scripts, and the codegen IR.
 *
 * Sections per machine (Dan's seven codegen items):
 *   1 machine split w/ design owner (yours vs STANDARD SDC MACHINE built
 *     from shipped work — only the station-specific values asked)
 *   2 devices table
 *   3 sequence-as-states table (Step 4, 7, 10 … Rev2 §19)
 *   4 branches & retries (retry ×N → Initialize, law 2026-09-02 (c))
 *   5 handshakes (p_ public parameters, Jason 2026-09)
 *   6 initialization (100 → … → 127)
 *   7 standards applied + decisions + open questions
 */

export const PLAN_VERSION = 1;

const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pascal = (s) => String(s ?? '').replace(/[^A-Za-z0-9 _]/g, ' ').split(/[\s_]+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const strip = (s) => String(s ?? '').trim();

/** Standard SDC machines (precedent-built) — the ME never designs these. */
export const STANDARD_PRECEDENTS = {
  'dial-indexer': {
    file: 'plc-reference/standard/S00_IndexerSP.L5X',
    label: 'SDC standard servo dial indexer (S00_IndexerSP family)',
    note: 'Index-to-next-fixture, stack-present monitoring, consecutive-empty-fixture counter and the full-revolution reject all live inside the indexer program per shipped work.',
    init: ['100  Servo enabled + homed (MAH); confirm AxisHomedStatus', '124  Known safe: dial at a fixture position, index request clear', '127  Cycle-ready → first sequence step'],
  },
  'robot-load': {
    file: 'plc-reference/training-material/Examples Following SDC Standard/ShowRoomFlexFeeder.L5X (P01_Robot)',
    label: 'SDC standard robot partner program (FlexFeeder P01_Robot)',
    note: 'Thin PLC states: request the robot program, watch its registers/handshake bits, time-bound each phase with StateTimer[n]; Paused/Fault are branch conditions. No servo routine.',
    init: ['100  Command robot home over the register interface', '103  Confirm robot at home (status bit)', '124  Known safe: robot clear of the pick head', '127  Cycle-ready → first sequence step'],
  },
  'escapement': {
    file: 'plc-reference/verified (escapement precedents)',
    label: 'SDC standard escapement feed',
    note: 'One-at-a-time release, queue-hold finger pattern, starvation warning — no part-tracking writes (escapements feed, they do not index).',
    init: ['100  Fingers to hold position', '124  Known safe', '127  Cycle-ready'],
  },
  'standard-feeder': {
    file: 'plc-reference/training-material/Examples Following SDC Standard/ShowRoomFlexFeeder.L5X',
    label: 'SDC standard feeder',
    note: 'Run/idle control and low-level warnings follow the shipped FlexFeeder pattern.',
    init: ['100  Feeder idle', '124  Known safe', '127  Cycle-ready'],
  },
};

/** Deterministic standard-pattern detection (mirrors standardMachines.js, plus the robot partner). */
export function detectStandard(machine) {
  if (machine?.standardPattern?.key) return machine.standardPattern;
  const name = String(machine?.name ?? '');
  const devs = (machine?.ownedDeviceNames ?? machine?.deviceNames ?? []).map(String);
  if (/\b(dial|index(er)?)\b/i.test(name) || devs.some((d) => /dial|index/i.test(d))) {
    return { key: 'dial-indexer', label: 'Dial Indexer', asks: ['fixture/station count', 'nest sensors present?', 'reject behavior (full-revolution vs immediate)', 'index angle / stations per index'] };
  }
  // The robot partner machine is named for the robot — a machine that merely
  // trades a "…To_Robot" signal (the pick head) is NOT the robot program.
  if (/\brobot\b/i.test(name)) {
    return { key: 'robot-load', label: 'Robot Load', asks: ['robot make / interface (EtherNet/IP registers vs discrete I/O)', 'robot program number to start', 'handshake signals the robot gives back (in position / clear)'] };
  }
  if (/escapement/i.test(name)) return { key: 'escapement', label: 'Escapement Feed', asks: ['finger count (1 or 2)', 'nest part-present sensor?', 'starved-feed behavior (warn vs pause)'] };
  if (/\b(feeder|bowl|flex ?feed)\b/i.test(name)) return { key: 'standard-feeder', label: 'Standard Feeder', asks: ['feeder type (bowl / flex)', 'low-level sensor?', 'purge behavior'] };
  return null;
}

const TYPE_LABEL = {
  PneumaticLinearActuator: 'Cylinder',
  PneumaticRotaryActuator: 'Rotary actuator',
  PneumaticGripper: 'Gripper',
  PneumaticVacGenerator: 'Vacuum',
  ServoAxis: 'Servo axis',
  DigitalSensor: 'Digital sensor',
  AnalogSensor: 'Analog sensor',
  VisionSystem: 'Vision',
  Robot: 'Robot',
  Parameter: 'Signal',
  Conveyor: 'Conveyor',
};
const isSignalRow = (d) => d?.type === 'Parameter' || /counter|_flag$|flag$/i.test(String(d?.name ?? ''));
const isCounter = (d) => /counter/i.test(String(d?.name ?? ''));
const isPneumatic = (t) => /^Pneumatic/.test(String(t ?? ''));

/** Known answers to a standard machine's asks, read off the sheet itself (the sheet answers first — Dan 2026-08-31). */
function answerAsk(ask, machine, devices, draft, extras) {
  const a = String(ask).toLowerCase();
  const fromExtras = extras?.asks?.[ask];
  if (fromExtras != null && String(fromExtras).trim() !== '') return { value: String(fromExtras), source: 'you' };
  const servo = devices.find((d) => d.type === 'ServoAxis');
  if (/fixture|station count/.test(a) && servo?.fixtureCount) return { value: `${servo.fixtureCount} fixtures`, source: 'sheet · ' + servo.name };
  if (/index angle|per index/.test(a) && (servo?.indexIncrementDeg || servo?.fixtureCount)) {
    const deg = servo.indexIncrementDeg ?? (360 / servo.fixtureCount);
    return { value: `${deg}° per index (360° / ${servo.fixtureCount ?? Math.round(360 / deg)})${servo.rotationDirection ? ', ' + servo.rotationDirection.toUpperCase() : ''}`, source: 'sheet · ' + servo.name };
  }
  if (/nest sensor|sensors present/.test(a)) {
    const s = devices.filter((d) => d.type === 'DigitalSensor');
    if (s.length) return { value: s.map((d) => d.name).join(', '), source: 'sheet · devices' };
  }
  if (/reject/.test(a)) {
    const fh = (draft?.summary?.failureHandling ?? []).find((f) => /revolution|reject/i.test(f.when + ' ' + f.then));
    if (fh) return { value: fh.then, source: 'sheet · failure handling' };
  }
  if (/handshake/.test(a)) {
    const sig = devices.filter(isSignalRow).map((d) => d.name);
    if (sig.length) return { value: sig.join(', '), source: 'sheet · signals' };
  }
  if (/robot make|interface/.test(a)) {
    const hit = (machine.sequenceSteps ?? []).find((s) => /epson|fanuc|abb|kuka|yaskawa|denso/i.test(s.counterpart ?? ''));
    if (hit) return { value: `${hit.counterpart} — interface not stated`, source: 'sheet · sequence', partial: true };
  }
  return { value: null, source: null };
}

function fmtDelays(d) {
  const e = d?.delays?.extendMs; const r = d?.delays?.retractMs;
  if (e == null && r == null) return '';
  const s = (ms) => (ms == null ? '—' : `${(Number(ms) / 1000).toFixed(1).replace(/\.0$/, '')} s`);
  return d.type === 'PneumaticGripper' ? `Engage ${s(e)} / Disengage ${s(r)}` : `Extend ${s(e)} / Retract ${s(r)}`;
}
function fmtPositions(d) {
  if (d?.type !== 'ServoAxis') return '';
  const parts = [];
  if (Array.isArray(d.positions) && d.positions.length) parts.push(d.positions.map((p) => `${p.name}${p.valueMm != null || p.value != null ? ' = ' + (p.valueMm ?? p.value) + (d.motionType === 'rotary' ? '°' : ' mm') : ''}`).join('; '));
  if (d.fixtureCount) parts.push(`${d.fixtureCount} fixtures`);
  if (d.indexIncrementDeg) parts.push(`index ${d.indexIncrementDeg}°`);
  if (d.speeds?.fastMmS) parts.push(`fast ${d.speeds.fastMmS}${d.motionType === 'rotary' ? '°/s' : ' mm/s'}`);
  return parts.join(' · ');
}

const deviceRow = (d) => ({
  name: d.name,
  type: TYPE_LABEL[d.type] ?? d.type ?? 'Custom',
  purpose: strip(d.purpose) === 'Parameter' ? '' : strip(d.purpose),
  sensors: isPneumatic(d.type) ? (d.sensorArrangement ?? '2-sensor (Ext + Ret)') : (d.type === 'DigitalSensor' ? 'debounced input' : ''),
  home: isPneumatic(d.type) ? (d.homeState ?? d.homePosition ?? 'Retract') : (d.type === 'ServoAxis' ? (d.homePosition ?? 'Home') : ''),
  values: fmtDelays(d) || fmtPositions(d),
});

const stepTitle = (s) => `${strip(s.action)} ${strip(s.target)}`.trim();
const signalTag = (name) => 'p_' + pascal(String(name).replace(/\s+signal$/i, '').replace(/\s+output$/i, ''));

/** Structured steps → the states table + branches + handshakes for one machine. */
function statesOf(machine, ownedDevices) {
  const steps = (machine.sequenceSteps ?? []).filter(Boolean);
  const states = [];
  const branches = [];
  const handshakes = [];
  const counters = (machine.counters ?? []).map(String);
  let step = 4;
  const titleAt = new Map(); // nk(title) → state index (for loop-backs)
  let lastCheck = null;
  const ownedNk = new Set(ownedDevices.map((d) => nk(d.name)));
  const isOwnedSensor = (t) => ownedNk.has(nk(t));

  for (const raw of steps) {
    const action = strip(raw.action);
    const target = strip(raw.target);
    const a = action.toLowerCase();
    if (a === 'home' || a === 'yes' || a === 'no') {
      // Yes/No lines describe a branch of the last check in plain words.
      if ((a === 'yes' || a === 'no') && lastCheck) {
        const txt = target.replace(/^:\s*/, '') + (raw.detail ? ` — ${raw.detail}` : '');
        if (a === 'yes') lastCheck.on = lastCheck.on || txt; else lastCheck.off = lastCheck.off || txt;
      }
      continue;
    }
    if (a === 'repeat') {
      states.push({ step: null, kind: 'loop', title: 'Repeat cycle', detail: `→ back to step ${states[0]?.step ?? 4}`, counterpart: '', device: '', group: '' });
      continue;
    }
    if (a === 'loop') {
      const label = target.replace(/^(no|yes)\s*[—–-]\s*/i, '').replace(/^back to\s+/i, '');
      const prefix = /^no\b/i.test(target) ? 'Off' : /^yes\b/i.test(target) ? 'On' : '';
      const to = titleAt.get(nk(label));
      const toStep = to != null ? states[to].step : null;
      states.push({ step: null, kind: 'loop', title: (prefix ? `${prefix} → ` : '') + `back to ${label}`, detail: toStep ? `→ step ${toStep}` : '', counterpart: '', device: '', group: '' });
      if (lastCheck && prefix === 'Off' && !lastCheck.retry) {
        lastCheck.retry = { max: 3, backTo: label, backToStep: toStep };
      }
      continue;
    }
    if (a === 'decide') {
      const title = target.replace(/\?+$/, '');
      const s = { step, kind: 'check', title: `Check: ${title}?`, detail: raw.detail ?? '', counterpart: '', device: raw.deviceId ? '' : '', group: '' };
      states.push(s); titleAt.set(nk(stepTitle(raw)), states.length - 1); titleAt.set(nk(title), states.length - 1);
      lastCheck = { atStep: step, check: title, on: '', off: '', retry: null };
      branches.push(lastCheck);
      step += 3; continue;
    }
    if (a === 'wait') {
      const cp = strip(raw.counterpart);
      const owned = isOwnedSensor(target.replace(/\s+signal$/i, ''));
      const s = { step, kind: owned ? 'check' : 'wait', title: owned ? `Check: ${target} On?` : `Wait: ${target}`, detail: raw.detail ?? '', counterpart: cp, device: owned ? target : '', group: '' };
      states.push(s); titleAt.set(nk(stepTitle(raw)), states.length - 1);
      if (owned) { lastCheck = { atStep: step, check: `${target} on`, on: 'continue', off: '', retry: null }; branches.push(lastCheck); }
      else if (cp) handshakes.push({ dir: 'waits', signal: target, tag: signalTag(target), counterpart: cp, atStep: step });
      step += 3; continue;
    }
    if (a === 'signal') {
      const cp = strip(raw.counterpart);
      const s = { step, kind: 'signal', title: `Signal: ${target}`, detail: raw.detail ?? '', counterpart: cp, device: '', group: '' };
      states.push(s); titleAt.set(nk(stepTitle(raw)), states.length - 1);
      handshakes.push({ dir: 'sends', signal: target, tag: signalTag(target), counterpart: cp || '—', atStep: step });
      step += 3; continue;
    }
    // Device action (Extend / Retract / Engage / Disengage / Index / Servo Move / Hold / SetOn …)
    const group = raw.group === 'thenAfterComplete' || raw.thenAfterComplete ? 'then, after complete' : (raw.group === 'concurrent' || raw.concurrent ? 'concurrent' : '');
    if (group && states.length && states[states.length - 1].kind === 'action') {
      // Grouped rows share the previous action's state (Dan's multi-action node).
      const prev = states[states.length - 1];
      prev.rows = [...(prev.rows ?? [prev.title]), `${stepTitle(raw)} (${group})`];
      prev.title = prev.rows[0];
      prev.detail = prev.rows.slice(1).join(' · ');
      titleAt.set(nk(stepTitle(raw)), states.length - 1);
      continue;
    }
    const s = { step, kind: 'action', title: stepTitle(raw), detail: raw.detail ?? '', counterpart: '', device: target, group: '' };
    states.push(s); titleAt.set(nk(stepTitle(raw)), states.length - 1);
    step += 3;
  }
  // Retry defaults from counters ("Strip_Retry (3 max)") → checks with an Off loop.
  for (const b of branches) {
    if (b.retry) {
      const m = counters.map((c) => c.match(/\((\d+)\s*max\)/i)).find(Boolean);
      if (m) b.retry.max = Number(m[1]);
      b.exhausted = '→ Initialize (init block, state 100) — counter resets on pass';
    }
  }
  return { states, branches, handshakes, lastStep: step - 3 };
}

/** Initialization block per the SDC template, from device home states. */
function initOf(machine, devices, standard) {
  if (standard) return { template: STANDARD_PRECEDENTS[standard.key]?.label ?? 'standard', lines: STANDARD_PRECEDENTS[standard.key]?.init ?? [] };
  const pneum = devices.filter((d) => isPneumatic(d.type) && d.type !== 'PneumaticVacGenerator');
  const vac = devices.filter((d) => d.type === 'PneumaticVacGenerator');
  const servos = devices.filter((d) => d.type === 'ServoAxis');
  const lines = [];
  let n = 100;
  const homeVerb = (d) => (d.type === 'PneumaticGripper' ? (/(engage|close)/i.test(d.homeState ?? '') ? 'Engage' : 'Disengage') : (/extend/i.test(d.homeState ?? d.homePosition ?? '') ? 'Extend' : 'Retract'));
  // Anything carrying a part first (vacuum off = release), then linear clears, then rotaries.
  const linear = pneum.filter((d) => d.type === 'PneumaticLinearActuator');
  const rotary = pneum.filter((d) => d.type === 'PneumaticRotaryActuator');
  const grips = pneum.filter((d) => d.type === 'PneumaticGripper');
  if (vac.length) { lines.push(`${n}  ${vac.map((d) => `Vacuum off — ${d.name}`).join('; ')}`); n += 3; }
  if (linear.length) { lines.push(`${n}  ${linear.map((d) => `${homeVerb(d)} ${d.name} (home) — confirm ${/1-sensor|ret only/i.test(d.sensorArrangement ?? '') ? 'retract sensor' : 'position sensor'}`).join('; ')}`); n += 3; }
  if (rotary.length) { lines.push(`${n}  ${rotary.map((d) => `${homeVerb(d)} ${d.name} (home)`).join('; ')}`); n += 3; }
  if (grips.length) { lines.push(`${n}  ${grips.map((d) => `${homeVerb(d)} ${d.name} (home)`).join('; ')}`); n += 3; }
  if (servos.length) { lines.push(`${n}  ${servos.map((d) => `Home ${d.name} (MAH), then move to ${d.positions?.[0]?.name ?? 'Home'}`).join('; ')}`); n += 3; }
  lines.push('124  Known safe state — all devices at home, outgoing signals cleared');
  lines.push('127  Cycle-ready → first sequence step (state 4)');
  return { template: 'SDC standard init block (100 → 124 → 127)', lines };
}

function standardsOf(machine, devices, handshakes, branches, standard) {
  const out = [];
  out.push({ text: `One program per state machine: ${machine.program} (R00_Main → R01_Inputs → R02_StateTransitions → R03_StateLogic → R20_Alarms).`, source: 'Jason, round-1 law' });
  out.push({ text: 'Step counter: states 0–3 fixed supervisor modes; sequence starts at 4, +3 per state; 99 lockout; 100–127 init block.', source: 'PLC Software Standardization Rev2 §19' });
  if (handshakes.length) out.push({ text: 'Cross-machine signals are PUBLIC parameters on the producing program (p_ tags), consumed as \\Producer.p_X — never controller-scoped.', source: 'Jason (CE), 2026-09' });
  if (devices.some((d) => isPneumatic(d.type) && d.type !== 'PneumaticVacGenerator')) out.push({ text: 'Pneumatic position is DERIVED (sensor + own command on + opposite command off) — no AOI_Debounce on position sensors; one-sensor slides use the retract sensor plus the extend delay timer.', source: 'Jason (CE), 2026-09' });
  if (devices.some((d) => d.type === 'DigitalSensor')) out.push({ text: 'Digital sensors get AOI_Debounce (100 ms on/off) in R01_Inputs.', source: 'SDC standard' });
  if (devices.some((d) => d.type === 'ServoAxis')) out.push({ text: 'Servo positions, speeds and accel/decel are operator-adjustable in HMI_{axis} (ServoOverall UDT); rotary dial positions are in degrees, index = 360° / fixture count. MAM params ship as 0.0 for the CE to tune.', source: 'SDC standard; ME law 2026-08' });
  if (branches.some((b) => b.retry)) out.push({ text: `Retry is configured on the check, not drawn: ${branches.filter((b) => b.retry).map((b) => `“${b.check}” ×${b.retry.max}`).join(', ')}; retry exhausted → Initialization (state 100), no alarm on plain exhaustion.`, source: 'Dan, 2026-09-02 sequence grammar (b)(c)' });
  if (standard) out.push({ text: `Built from shipped work: ${STANDARD_PRECEDENTS[standard.key]?.label ?? standard.label} — ${STANDARD_PRECEDENTS[standard.key]?.file ?? 'precedent'}.`, source: 'Dan, 2026-08-26 precedent is the baseline' });
  out.push({ text: 'Every device output is ONE rung carrying auto and manual modes selected by State[1]; alarm text names this station’s own operation.', source: 'Jason (CE), 2026-09' });
  return out;
}

/**
 * Build the plan document from a sheet draft.
 * @param {object} draft   the sheet draft (server truth)
 * @param {object} [opts]  { project } — the SM project, to mark canvas-authoritative machines
 */
export function buildPlan(draft, { project = null } = {}) {
  const machinesIn = draft?.smProposal?.stateMachines ?? draft?.summary?.machines ?? [];
  const devicesIn = (draft?.summary?.devices ?? []).filter((d) => d && d.name);
  const extrasAll = draft?.plan?.extras ?? {};
  const stationNumber = Number(draft?.station) || Number(draft?.stationNumber) || 1;
  const stationName = strip(draft?.name || draft?.stationName || 'Station');
  const claimed = new Set();

  const machines = machinesIn.map((m, i) => {
    const key = m.key ?? nk(m.name);
    const extras = extrasAll[key] ?? extrasAll[nk(m.name)] ?? {};
    const ownedNames = (m.ownedDeviceNames ?? m.deviceNames ?? []).map(nk);
    const owned = devicesIn.filter((d) => ownedNames.includes(nk(d.name)));
    owned.forEach((d) => claimed.add(nk(d.name)));
    const realDevices = owned.filter((d) => !isSignalRow(d));
    const signalRows = owned.filter((d) => isSignalRow(d) && !isCounter(d));
    const counterRows = owned.filter(isCounter);
    const standard = detectStandard(m);
    const program = `S${String(stationNumber).padStart(2, '0')}${machinesIn.length > 1 ? String.fromCharCode(97 + i) : ''}_${pascal(m.name)}`;
    const mm = { ...m, program };
    const { states, branches, handshakes } = statesOf(mm, realDevices);
    const asks = standard ? (standard.asks ?? []).map((ask) => ({ ask, ...answerAsk(ask, mm, owned, draft, extras) })) : [];
    const sm = project?.stateMachines?.find((s) => s.machineSpec?.v3?.draftId === draft?.draftId && s.machineSpec?.v3?.machineKey === key) ?? null;
    const decisions = [
      ...(m.why ? [{ text: m.why, source: 'engine · machine split' }] : []),
      ...(standard ? [{ text: STANDARD_PRECEDENTS[standard.key]?.note ?? m.standardPattern?.doctrine ?? '', source: 'shipped work' }].filter((x) => x.text) : []),
      ...(m.standardPattern?.doctrine && standard && STANDARD_PRECEDENTS[standard.key]?.note !== m.standardPattern.doctrine ? [{ text: m.standardPattern.doctrine, source: 'doctrine' }] : []),
      ...(extras.decisions ?? []).map((t) => (typeof t === 'string' ? { text: t, source: 'you' } : t)),
    ];
    const openQuestions = [
      ...asks.filter((a) => !a.value || a.partial).map((a) => `${a.ask} — value needed for the standard ${standard.label}.`),
      ...(extras.questions ?? []),
    ];
    return {
      key, name: m.name, program, oneLiner: m.oneLiner ?? '', nameByME: !!m.nameByME,
      design: {
        owner: standard ? 'standard' : 'yours',
        label: standard ? `Standard SDC machine — ${standard.label}, built from shipped work` : 'Your machine — designed from your explanation',
        precedent: standard ? STANDARD_PRECEDENTS[standard.key] ?? null : null,
        asks,
      },
      devices: realDevices.map(deviceRow),
      signals: signalRows.map((d) => ({ name: d.name, tag: signalTag(d.name), purpose: strip(d.purpose) === 'Parameter' ? '' : strip(d.purpose) })),
      counters: counterRows.map((d) => d.name),
      sequenceSteps: m.sequenceSteps ?? [],
      states, branches, handshakes,
      initialization: initOf(mm, realDevices, standard),
      standards: standardsOf(mm, realDevices, handshakes, branches, standard).concat((extras.standards ?? []).map((t) => (typeof t === 'string' ? { text: t, source: 'you' } : t))),
      decisions,
      openQuestions,
      canvas: sm ? { smId: sm.id, authoritative: !!sm.machineSpec?.canvasAuthoritative, nodeCount: sm.nodes?.length ?? 0 } : null,
    };
  });

  const unclaimed = devicesIn.filter((d) => !claimed.has(nk(d.name)) && !isSignalRow(d)).map(deviceRow);
  // Station-level cross-machine signal table: every sends/waits pair joined by tag.
  const sigMap = new Map();
  for (const mc of machines) for (const h of mc.handshakes) {
    const k = h.tag;
    const e = sigMap.get(k) ?? { tag: h.tag, signal: h.signal, from: '', to: [] };
    if (h.dir === 'sends') e.from = e.from || mc.name; else e.to.push(mc.name);
    if (h.dir === 'sends' && h.counterpart && h.counterpart !== '—' && !machines.some((x) => nk(x.name) === nk(h.counterpart))) e.external = h.counterpart;
    if (h.dir === 'waits' && h.counterpart && !machines.some((x) => nk(x.name) === nk(h.counterpart))) e.from = e.from || h.counterpart + ' (external)';
    sigMap.set(k, e);
  }
  const signals = [...sigMap.values()].map((e) => ({ ...e, to: [...new Set([...e.to, ...(e.external ? [e.external] : [])])].join(', ') || '—', from: e.from || '—' }));
  const orphanWaits = signals.filter((s) => s.from === '—');

  const failure = (draft?.summary?.failureHandling ?? []).map((f) => ({
    when: f.when, then: f.then, retries: f.retries ?? null, whenExhausted: f.whenExhausted ?? '',
  }));
  const interactions = (draft?.summary?.interactions ?? []).map((x) => ({ station: x.station, how: x.how }));

  const stationQuestions = [
    ...(orphanWaits.length ? [`No machine sends ${orphanWaits.map((s) => s.tag).join(', ')} — who sets it?`] : []),
    ...(extrasAll._station?.questions ?? []),
  ];

  return {
    v: PLAN_VERSION,
    station: {
      name: stationName,
      number: stationNumber,
      purpose: strip(draft?.purpose ?? ''),
      machineCount: machines.length,
      standardCount: machines.filter((m) => m.design.owner === 'standard').length,
      splitReasoning: strip(draft?.smProposal?.reasoning ?? ''),
    },
    machines,
    signals,
    failure,
    interactions,
    unclaimedDevices: unclaimed,
    openQuestions: stationQuestions,
    controlsNotes: (draft?.controlsNotes ?? []).map((n) => (typeof n === 'string' ? n : n?.text ?? '')).filter(Boolean),
  };
}

/* ────────────────────────────── REDLINES ────────────────────────────── */

/** Stable row key per section so an insert does not redline every row below it. */
const ROW_KEY = {
  machines: (r) => r.key ?? nk(r.name),
  devices: (r) => nk(r.name),
  signals: (r) => nk(r.tag ?? r.name),
  counters: (r) => nk(r),
  states: (r, i) => nk(r.title) + (r.step != null ? '' : '#' + i),
  branches: (r) => nk(r.check),
  handshakes: (r) => r.dir + ':' + nk(r.signal) + ':' + nk(r.counterpart),
  standards: (r) => nk(r.text).slice(0, 40),
  decisions: (r) => nk(r.text).slice(0, 40),
  openQuestions: (r) => nk(r).slice(0, 40),
  asks: (r) => nk(r.ask),
  lines: (r) => nk(r).slice(0, 24),
  failure: (r) => nk(r.when),
  interactions: (r) => nk(r.station + r.how).slice(0, 40),
  unclaimedDevices: (r) => nk(r.name),
  controlsNotes: (r) => nk(r).slice(0, 40),
};
const leafStr = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Merge a snapshot plan and the current plan into ONE render tree carrying
 * marks: every row gets `_mark` ('add' | 'remove' | 'change' | null) and
 * every changed leaf becomes { before, after }. Removed rows are kept (from
 * the snapshot) so the document can strike them. Returns { tree, count }.
 */
export function redlinePlan(snapshot, current) {
  let count = 0;
  const mergeLeaf = (a, b) => {
    const sa = leafStr(a), sb = leafStr(b);
    if (sa === sb) return b;
    count++;
    return { __redline: true, before: a, after: b };
  };
  const mergeObj = (a, b, parentKey) => {
    if (a == null && b == null) return b;
    if (Array.isArray(b) || Array.isArray(a)) return mergeList(a ?? [], b ?? [], parentKey);
    if (typeof b === 'object' && b !== null || typeof a === 'object' && a !== null) {
      const out = {};
      const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
      for (const k of keys) {
        if (k === 'canvas' || k === 'sequenceSteps') { out[k] = b?.[k]; continue; } // not document content
        out[k] = mergeObj(a?.[k], b?.[k], k);
      }
      return out;
    }
    return mergeLeaf(a, b);
  };
  const mergeList = (a, b, key) => {
    const kf = ROW_KEY[key];
    if (!kf) {
      // Positional list of leaves.
      const n = Math.max(a.length, b.length);
      const out = [];
      for (let i = 0; i < n; i++) {
        if (i >= a.length) { count++; out.push({ __row: b[i], _mark: 'add' }); }
        else if (i >= b.length) { count++; out.push({ __row: a[i], _mark: 'remove' }); }
        else out.push(mergeObj(a[i], b[i], key));
      }
      return out;
    }
    // Duplicate keys (the same title twice in a sequence — "Extend Pick Linear
    // Cylinder" at steps 10 and 28) pair by occurrence, never by first hit.
    const occ = (list) => { const seen = new Map(); return list.map((r, i) => { const k = kf(r, i); const n = seen.get(k) ?? 0; seen.set(k, n + 1); return n ? `${k}~${n}` : k; }); };
    const aKeys = occ(a);
    const bKeys = occ(b);
    const out = [];
    const used = new Set();
    // Walk current order; insert removed snapshot rows where they were.
    let ai = 0;
    for (let bi = 0; bi < b.length; bi++) {
      // Flush removed rows that preceded this position in the snapshot.
      while (ai < a.length && !bKeys.includes(aKeys[ai])) { count++; out.push(markRow(a[ai], 'remove')); used.add(ai); ai++; }
      const j = aKeys.indexOf(bKeys[bi]);
      if (j < 0) { count++; out.push(markRow(b[bi], 'add')); continue; }
      used.add(j);
      if (j === ai) ai++;
      const before = count;
      const merged = typeof b[bi] === 'object' && b[bi] !== null ? mergeObj(a[j], b[bi], key) : mergeLeaf(a[j], b[bi]);
      if (typeof merged === 'object' && merged !== null && !merged.__redline && !Array.isArray(merged)) merged._mark = count > before ? 'change' : null;
      out.push(merged);
    }
    for (let k = 0; k < a.length; k++) if (!used.has(k) && !bKeys.includes(aKeys[k])) { count++; out.push(markRow(a[k], 'remove')); }
    return out;
  };
  const markRow = (r, mark) => (typeof r === 'object' && r !== null && !Array.isArray(r) ? { ...r, _mark: mark } : { __row: r, _mark: mark });
  const tree = mergeObj(snapshot ?? null, current, 'plan');
  return { tree, count };
}

/** Plain-text rendering (engine prompt block, cover notes, JSON export companion). */
export function planText(plan) {
  const L = [];
  L.push(`BUILD PLAN — ${plan.station.name} (station ${plan.station.number}) · ${plan.station.machineCount} machines, ${plan.station.standardCount} standard`);
  if (plan.station.purpose) L.push(`Purpose: ${plan.station.purpose}`);
  for (const m of plan.machines) {
    L.push('', `## ${m.name} — ${m.program}`, m.oneLiner, m.design.label);
    if (m.design.asks.length) L.push('Station-specific values: ' + m.design.asks.map((a) => `${a.ask}: ${a.value ?? 'NEEDED'}`).join('; '));
    L.push('Devices: ' + m.devices.map((d) => `${d.name} (${d.type}${d.sensors ? ', ' + d.sensors : ''}${d.values ? ', ' + d.values : ''})`).join('; '));
    L.push('States:'); for (const s of m.states) L.push(`  ${s.step ?? '  '}  ${s.title}${s.detail ? ' — ' + s.detail : ''}${s.counterpart ? ' [' + s.counterpart + ']' : ''}`);
    if (m.branches.length) { L.push('Branches:'); for (const b of m.branches) L.push(`  step ${b.atStep} ${b.check}: On → ${b.on || 'continue'}; Off → ${b.off || (b.retry ? `retry ×${b.retry.max} back to ${b.retry.backTo}` : 'alternate path')}${b.retry ? '; exhausted ' + b.exhausted : ''}`); }
    if (m.handshakes.length) { L.push('Handshakes:'); for (const h of m.handshakes) L.push(`  step ${h.atStep} ${h.dir} ${h.tag} (${h.signal}) ${h.dir === 'sends' ? 'to' : 'from'} ${h.counterpart}`); }
    L.push(`Initialization (${m.initialization.template}):`); for (const l of m.initialization.lines) L.push('  ' + l);
    L.push('Standards: ' + m.standards.map((s) => s.text).join(' | '));
    if (m.decisions.length) L.push('Decisions: ' + m.decisions.map((d) => d.text).join(' | '));
    if (m.openQuestions.length) L.push('Open: ' + m.openQuestions.join(' | '));
  }
  if (plan.signals.length) { L.push('', 'Cross-machine signals:'); for (const s of plan.signals) L.push(`  ${s.tag} — ${s.from} → ${s.to}`); }
  if (plan.openQuestions.length) L.push('', 'Station open questions: ' + plan.openQuestions.join(' | '));
  return L.join('\n');
}

/**
 * THE INTERCHANGE SHAPE — the same JSON the SDC Engineer's delivered Build Plan
 * document uses ("SDC Engineer Deliveries/<Station>__Build_Plan_v1.json",
 * kind 'build-plan', version 1): station · machines[{ name, program, does,
 * owner, ownerText, precedent, meSupplies[], devices[{device,type,sensors,
 * values}], states[{state,action,detail}], branches[], handshakes[],
 * initialization }] · standards[] · decisions[{decision,from}] ·
 * questions[{q,proposal}] · gaps[] · sources. One shape whether the plan came
 * from the app or from a Claude Code session writing the .docx.
 */
export function toDeliveryPlan(plan, { draftId = null, draftRev = null } = {}) {
  const uniq = (arr) => [...new Map(arr.map((x) => [nk(typeof x === 'string' ? x : x?.decision ?? x?.q ?? ''), x])).values()];
  return {
    version: 1,
    kind: 'build-plan',
    station: {
      name: plan.station.name, stationNumber: plan.station.number, draftId, draftRev,
      generatedAt: new Date().toISOString(), oneLiner: plan.station.purpose, machineCount: plan.station.machineCount,
    },
    machines: plan.machines.map((m) => ({
      name: m.name, program: m.program, does: m.oneLiner,
      owner: m.design.owner, ownerText: m.design.label,
      precedent: m.design.precedent ? `${m.design.precedent.label} — ${m.design.precedent.file}. ${m.design.precedent.note}` : '',
      meSupplies: m.design.asks.map((a) => `${a.ask}: ${a.value ?? 'NEEDED'}`),
      devices: m.devices.map((d) => ({ device: d.name, type: d.type, sensors: [d.sensors, d.home ? `home ${d.home}` : ''].filter(Boolean).join(' · '), values: d.values, purpose: d.purpose })),
      states: m.states.filter((s) => s.step != null).map((s) => ({ state: s.step, action: s.title, detail: [s.detail, s.counterpart ? `with ${s.counterpart}` : ''].filter(Boolean).join(' — ') })),
      statesNote: m.canvas?.authoritative ? `Canvas is authoritative (${m.canvas.nodeCount} states drawn).` : '',
      branches: m.branches.map((b) => ({ atState: b.atStep, check: b.check, on: b.on || 'continue', off: b.off || (b.retry ? `retry ×${b.retry.max} back to ${b.retry.backTo}` : 'alternate path'), exhausted: b.retry ? 'Initialize (state 100)' : '' })),
      handshakes: m.handshakes.map((h) => ({ atState: h.atStep, direction: h.dir, tag: h.tag, signal: h.signal, counterpart: h.counterpart })),
      initialization: { template: m.initialization.template, states: m.initialization.lines },
    })),
    standards: uniq(plan.machines.flatMap((m) => m.standards.map((s) => s.text))),
    decisions: uniq(plan.machines.flatMap((m) => m.decisions.map((d) => ({ decision: d.text, from: `${m.name} · ${d.source}` })))),
    questions: [...plan.openQuestions.map((q) => ({ q, proposal: '' })), ...plan.machines.flatMap((m) => m.openQuestions.map((q) => ({ q: `${m.name}: ${q}`, proposal: '' })))],
    gaps: plan.unclaimedDevices.map((d) => `Device no machine owns: ${d.name}`),
    sources: { explanation: 'the station sheet (INPUTS)', shippedWork: plan.machines.filter((m) => m.design.precedent).map((m) => m.design.precedent.file).join('; '), laws: 'src/lib/agentGenerator/meKnowledge.md' },
  };
}

/** The IR-facing slice of the plan (devices/handshakes/init/standards) — codegen reads this, the canvas supplies the sequence when canvas-authoritative. */
export function planForCodegen(plan) {
  return {
    v: plan.v,
    station: plan.station,
    machines: plan.machines.map((m) => ({
      key: m.key, name: m.name, program: m.program, design: { owner: m.design.owner, precedent: m.design.precedent?.file ?? null, asks: m.design.asks },
      devices: m.devices, signals: m.signals, counters: m.counters,
      handshakes: m.handshakes, branches: m.branches, initialization: m.initialization,
      standards: m.standards.map((s) => s.text), decisions: m.decisions.map((d) => d.text),
      sequenceSource: m.canvas?.authoritative ? 'canvas' : 'plan', states: m.canvas?.authoritative ? undefined : m.states,
    })),
    signals: plan.signals,
  };
}
