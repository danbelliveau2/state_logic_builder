/**
 * multiProgram.js — ONE PLC PROGRAM PER STATE MACHINE (Jason's #1 correction
 * of MidBaseLoad v1.4.0, 2026-08-31; CE bible §3).
 *
 * A station whose approved split has N machines emits N PROGRAMS in one L5X:
 *   1. Per machine, a VIRTUAL SM is compiled deterministically from the
 *      approved structured steps (same conventions as the client's
 *      compileApprovedFlow — kept in step, see the mirror note there) with
 *      ONLY that machine's devices (no unused devices, ever).
 *   2. The HANDSHAKE INTERFACE — every cross-machine signal pair parsed from
 *      the approved sequences — rides each machine's job text: producer sets
 *      the controller-scope p_ tag at its approved step; consumer reads it in
 *      its wait transition. Wire exactly those, invent none.
 *   3. Each program runs the FULL existing pipeline (study, readiness +
 *      init-coverage hold, SDK writer, merge, byte-level validation with
 *      import simulation, internal review) — nothing is skipped.
 *   4. The programs merge into ONE L5X: base file keeps its controller
 *      shell; the other programs' <Program> blocks are appended, controller-
 *      scope tags/UDTs/AOIs deduped by name, and each program scheduled in
 *      the task. Merged file re-checked for well-formedness + program
 *      scheduling + handshake tags.
 *
 * generateStationPrograms(projectJson, smId, options) → same result contract
 * as generateL5X, plus meta.programs[] (per-machine outcomes). A HOLD in any
 * machine stops the whole build and surfaces that machine's questions.
 */

const { XMLValidator } = require('fast-xml-parser');

const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pascal = (s) => String(s ?? '').replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '').replace(/^./, (c) => c.toUpperCase());
const SIGNAL_TYPES = /parameter|signal|smoutput/i;

let _uid = 0;
const uid = (p) => `${p}_mp${Date.now().toString(36)}${(++_uid).toString(36)}`;

// ── Handshake interface: cross-machine signal pairs from the sequences ──────
// (Mirror of cascadeModel.signalPairsOf — that file is ESM/client-side.)
function handshakePairsOf(machines) {
  const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const sigKey = (s) => nk(s).replace(/[0-9]/g, (c) => NUMW[+c]).replace(/signal$/, '');
  const keysMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const ms = machines.map((m) => ({ name: m.name, key: nk(m.name), sets: [], waits: [] }));
  machines.forEach((m, i) => {
    for (const t of (m.sequence ?? []).map(String)) {
      let mm = t.match(/^(?:signal|set)\s+(.+?)\s+to\s+([A-Za-z0-9 '’.&-]+?)\s*$/i);
      if (mm) { ms[i].sets.push({ sig: sigKey(mm[1]), label: mm[1].trim(), to: mm[2].trim(), line: t }); continue; }
      mm = t.match(/^wait\s+for\s+(.+?)['’]s\s+(.+?)\s*(?:signal)?\s*$/i);
      if (mm) ms[i].waits.push({ sig: sigKey(mm[2]), label: mm[2].trim(), from: mm[1].trim(), line: t });
    }
  });
  const pairs = [];
  for (const m of ms) {
    for (const s of m.sets) {
      const partner = ms.find((x) => x !== m && (keysMatch(nk(s.to), x.key) || keysMatch(x.key, nk(s.to))));
      if (!partner) continue;
      const w = partner.waits.find((x) => keysMatch(x.sig, s.sig));
      pairs.push({
        tag: 'p_' + pascal(s.label),
        producer: m.name, producerStep: s.line,
        consumer: partner.name, consumerWait: w?.line ?? null,
      });
    }
  }
  return pairs;
}

// ── Device assignment across machines (NO UNUSED DEVICES; EXCLUSIVE — one
//    device belongs to one program; naming drift resolved by role) ──────────
function roleOf(d) {
  const t = String(d?.type ?? '') + ' ' + String(d?.displayName ?? d?.name ?? '');
  if (/gripper/i.test(t)) return 'gripper';
  if (/servo|axis/i.test(t)) return 'servo';
  if (/sensor/i.test(t)) return 'sensor';
  if (/linear|slide|cylinder|actuator|shuttle|finger/i.test(t)) return 'linear';
  return 'other';
}
function roleOfName(n) {
  if (/gripper/i.test(n)) return 'gripper';
  if (/axis|servo/i.test(n)) return 'servo';
  if (/sensor|present/i.test(n)) return 'sensor';
  if (/slide|cylinder|shuttle|finger/i.test(n)) return 'linear';
  return 'other';
}
function assignDevices(machines, allDevices) {
  const real = (allDevices ?? []).filter((d) => !SIGNAL_TYPES.test(String(d?.type ?? '')) && nk(d.displayName ?? d.name));
  const claimed = new Map(); // device -> machine index
  // Pass 1: exact/containment owned-name matches (strongest claims first).
  machines.forEach((m, mi) => {
    for (const n of (m.ownedDeviceNames ?? m.deviceNames ?? [])) {
      const a = nk(n);
      const hit = real.find((d) => !claimed.has(d) && (nk(d.displayName ?? d.name) === a));
      if (hit) claimed.set(hit, mi);
    }
  });
  machines.forEach((m, mi) => {
    for (const n of (m.ownedDeviceNames ?? m.deviceNames ?? [])) {
      const a = nk(n);
      const hit = real.find((d) => !claimed.has(d) && (nk(d.displayName ?? d.name).includes(a) || a.includes(nk(d.displayName ?? d.name))));
      if (hit) claimed.set(hit, mi);
    }
  });
  // Pass 2: role fill — an owned name that matched nothing claims an
  // unclaimed device of the SAME role ("Mid-Base Gripper" → PNPGripper).
  machines.forEach((m, mi) => {
    for (const n of (m.ownedDeviceNames ?? m.deviceNames ?? [])) {
      const a = nk(n);
      const already = real.some((d) => claimed.get(d) === mi && (nk(d.displayName ?? d.name) === a || nk(d.displayName ?? d.name).includes(a) || a.includes(nk(d.displayName ?? d.name))));
      if (already) continue;
      const role = roleOfName(n);
      const candidates = real.filter((d) => !claimed.has(d) && roleOf(d) === role);
      if (!candidates.length) continue;
      // Same-role fill prefers NAME AFFINITY over device order (the dry-run
      // bug: "Z Slide" grabbed Escapement_Finger_2 instead of the vertical):
      // shared word tokens first ("Z"/"vertical" both mean the vertical
      // motion; "gripper" matches grippers), then machine-name affinity.
      const ntoks = String(n).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const AXIS_SYNONYMS = { z: ['vertical', 'z'], vertical: ['vertical', 'z'], x: ['x', 'horizontal'], horizontal: ['x', 'horizontal'] };
      const scoreDev = (d) => {
        const dn = String(d.displayName ?? d.name).toLowerCase();
        let s = 0;
        for (const w of ntoks) {
          if (dn.includes(w)) s += 2;
          for (const syn of (AXIS_SYNONYMS[w] ?? [])) if (dn.includes(syn)) s += 2;
        }
        // Machine-name affinity ("Mid-Base Gripper" ← PNP_Gripper when the
        // machine is the Pick aNd Place): weak tiebreak only.
        const mw = String(m.name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        for (const w of mw) if (w.length > 2 && dn.includes(w)) s += 1;
        return s;
      };
      candidates.sort((a, b) => scoreDev(b) - scoreDev(a));
      // A zero-affinity fill is allowed ONLY when exactly one candidate
      // exists (unambiguous); ambiguity with no affinity stays unclaimed.
      const top = candidates[0];
      if (scoreDev(top) > 0 || candidates.length === 1) claimed.set(top, mi);
    }
  });
  // Pass 3: still-unclaimed devices go to the machine whose text names them.
  for (const d of real) {
    if (claimed.has(d)) continue;
    const b = nk(d.displayName ?? d.name);
    const mi = machines.findIndex((m) => nk((m.sequence ?? []).join(' ') + ' ' + (m.faultRecovery ?? []).join(' ')).includes(b));
    if (mi >= 0) claimed.set(d, mi);
    // Deliberately unassigned otherwise — deleted/legacy rows never ride.
  }
  return machines.map((_, mi) => real.filter((d) => claimed.get(d) === mi));
}
function devicesForMachine(machine, allDevices) {
  return assignDevices([machine], allDevices)[0];
}

// ── Virtual-SM compile (server-side mirror of src/lib/compileApprovedFlow.js
//    — keep the two in step; single machine, one column) ─────────────────────
const OP_MAP = [
  [/^extend$/i, 'Extend'], [/^retract$/i, 'Retract'],
  [/^engage$|^close$|^grip$/i, 'Engage'], [/^disengage$|^open$|^release$/i, 'Disengage'],
  [/^servo ?move$|^move$/i, 'ServoMove'], [/^index$/i, 'ServoIndex'],
];
const opOf = (a) => (OP_MAP.find(([re]) => re.test(String(a ?? '').trim())) ?? [null, null])[1];

function compileMachineSm(machine, devices, { stationNumber }) {
  const devs = devices.map((d) => ({ ...d, id: d.id || uid('dev') }));
  const findDev = (target) => {
    const k = nk(target);
    if (!k) return null;
    const direct = devs.find((d) => { const b = nk(d.displayName ?? d.name); return b === k || b.includes(k) || k.includes(b); });
    if (direct) return direct;
    // NAMING-DRIFT RESOLUTION (the sheet says "ShuttleGripper" inside the
    // Pick-and-Place — ITS gripper is PNP_Gripper): a step can only command
    // THIS machine's devices, so resolve by role within the machine. The
    // label is rewritten to the real device (no phantom names in code).
    const role = roleOfName(String(target));
    if (role === 'other') return null;
    const sameRole = devs.filter((d) => roleOf(d) === role);
    return sameRole.length === 1 ? sameRole[0] : null;
  };
  const nodes = []; const edges = [];
  let y = 80; const x = 220;
  const steps = Array.isArray(machine.sequenceSteps) && machine.sequenceSteps.length
    ? machine.sequenceSteps
    : (machine.sequence ?? []).map((l) => ({ action: String(l).split(' ')[0], target: String(l) }));
  const init = { id: uid('n'), type: 'stateNode', position: { x, y }, data: { label: 'Home / Initial', actions: [], isInitial: true, isComplete: false } };
  nodes.push(init); y += 150;
  let prev = init; let pendingCond = null;
  const link = (from, to) => {
    edges.push({
      id: uid('e'), source: from.id, target: to.id, sourceHandle: null, targetHandle: null, type: 'routableEdge',
      data: { conditionType: pendingCond ? 'custom' : 'trigger', label: pendingCond ? `Wait — ${pendingCond}` : '' },
    });
    pendingCond = null;
  };
  for (const s of steps) {
    const a = String(s?.action ?? '').trim();
    if (!a || /^(home|repeat)$/i.test(a)) continue;
    if (/^wait$/i.test(a)) { pendingCond = [s.target, s.counterpart ? `(${s.counterpart})` : ''].filter(Boolean).join(' ').trim(); continue; }
    const op = opOf(a);
    const dev = findDev(s?.target);
    // The label carries the REAL device name once resolved — a program never
    // names another machine's device.
    const targetLabel = (op && dev) ? String(dev.displayName ?? dev.name) : String(s?.target ?? '').trim();
    const n = {
      id: uid('n'), type: 'stateNode', position: { x, y },
      data: {
        label: /^signal$/i.test(a) ? `Signal ${String(s?.target ?? '').trim()}` : [a, targetLabel].filter(Boolean).join(' ') + (s?.detail && op === 'ServoMove' ? ` — ${s.detail}` : ''),
        actions: op && dev ? [{ id: uid('a'), deviceId: dev.id, operation: op, ...(op === 'ServoMove' && s?.detail ? { positionName: String(s.detail) } : {}) }] : [],
        isInitial: false, isComplete: false,
      },
    };
    nodes.push(n); link(prev, n); prev = n; y += 150;
  }
  const done = { id: uid('n'), type: 'stateNode', position: { x, y }, data: { label: 'Cycle Complete', actions: [], isInitial: false, isComplete: true } };
  nodes.push(done); link(prev, done);
  return { id: uid('sm'), name: pascal(machine.name), displayName: machine.name, stationNumber, devices: devs, nodes, edges };
}

// ── L5X merge: append the other file's Program + dedupe controller scope ────
/** The file's TARGET program name — the real emitted name (usually
 *  S{nn}_{Name}, NOT the bare SM name; the 2026-08-31 merge bug grabbed a
 *  Use="Context" program because it searched by bare name). */
function targetProgramNameOf(xml, hint) {
  // Parse opening tags and read attributes individually — a combined regex
  // here once matched MainRoutineName="R00_Main" as the Name (2026-08-31).
  const tags = [...xml.matchAll(/<Program\s[^>]*>/g)].map((m) => m[0]);
  const nameOf = (t) => (t.match(/\sName="([^"]+)"/) || [])[1] || null;
  const targets = tags.filter((t) => /\sUse="Target"/.test(t)).map(nameOf).filter(Boolean);
  const pool = targets.length ? targets
    : tags.filter((t) => !/\sUse="Context"/.test(t)).map(nameOf).filter(Boolean);
  return pool.find((n) => hint && nk(n).includes(nk(hint))) ?? pool[0] ?? null;
}
/** ASCII-fold characters Studio 5000 rejects (engine-injected IR labels can
 *  carry em-dashes — fold them here, at merge time, for EVERY program). */
function asciiFoldL5x(xml) {
  return xml
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/×/g, 'x');
}
function mergePrograms(baseXml, otherXml, otherProgramName) {
  let out = baseXml;
  const grab = (xml, re) => { const m = xml.match(re); return m ? m[0] : null; };
  // 1. The other file's TARGET <Program> block — by its REAL emitted name.
  const realName = targetProgramNameOf(otherXml, otherProgramName);
  if (!realName) throw new Error(`Merged file: no <Program> found in the second L5X (looking for "${otherProgramName}")`);
  const progRe = new RegExp(`<Program\\s+[^>]*Name="${realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</Program>`);
  const progBlock = grab(otherXml, progRe);
  if (!progBlock) throw new Error(`Merged file: could not extract program "${realName}" from the second L5X`);
  out = out.replace(/<\/Programs>/, `${progBlock}\n</Programs>`);
  otherProgramName = realName; // scheduling + checks use the real name
  // 1b. CONTEXT programs the other file references but the base lacks (its
  //     template family may differ — S01_PartLoad carries an HMI context
  //     program the S05 base does not): carry them over, deduped by name.
  const baseProgNames = new Set([...out.matchAll(/<Program\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]));
  const ctxBlocks = [...otherXml.matchAll(/<Program Use="Context"[^>]*\bName="([^"]+)"(?:(?!<Program[\s>])[\s\S])*?<\/Program>/g)]
    .filter((m) => !baseProgNames.has(m[1]))
    .map((m) => m[0]);
  if (ctxBlocks.length) out = out.replace(/<\/Programs>/, `${ctxBlocks.join('\n')}\n</Programs>`);
  // 2. Controller-scope Tags dedupe-by-name.
  const nameOf = (tag) => (tag.match(/Name="([^"]+)"/) ?? [])[1];
  const baseCtrlTags = new Set([...out.matchAll(/<Tag\s+[^>]*Name="([^"]+)"/g)].map((m) => m[1]));
  const otherCtrl = grab(otherXml, /<Controller[\s\S]*?<Tags>[\s\S]*?<\/Tags>/);
  if (otherCtrl) {
    const adds = [...otherCtrl.matchAll(/<Tag\s[\s\S]*?<\/Tag>|<Tag\s[^>]*\/>/g)]
      .map((m) => m[0]).filter((tg) => { const n = nameOf(tg); return n && !baseCtrlTags.has(n); });
    if (adds.length) out = out.replace(/<\/Tags>/, `${adds.join('\n')}\n</Tags>`); // first </Tags> = controller scope
  }
  // 3. DataTypes + AOIs dedupe-by-name.
  for (const [sectionRe, closer] of [[/<DataType\s[\s\S]*?<\/DataType>/g, /<\/DataTypes>/], [/<AddOnInstructionDefinition\s[\s\S]*?<\/AddOnInstructionDefinition>/g, /<\/AddOnInstructionDefinitions>/]]) {
    const have = new Set([...out.matchAll(sectionRe)].map((m) => nameOf(m[0])).filter(Boolean));
    const adds = [...otherXml.matchAll(sectionRe)].map((m) => m[0]).filter((b) => { const n = nameOf(b); return n && !have.has(n); });
    if (adds.length && closer.test(out)) out = out.replace(closer, `${adds.join('\n')}${closer.source.replace(/\\/g, '')}`);
  }
  // 4. Schedule the program in the task.
  if (!new RegExp(`<ScheduledProgram\\s+Name="${otherProgramName}"`).test(out)) {
    out = out.replace(/<\/ScheduledPrograms>/, `<ScheduledProgram Name="${otherProgramName}"/>\n</ScheduledPrograms>`);
  }
  return out;
}

async function generateStationPrograms(projectJson, smId, options = {}) {
  const gen = require('./client.js');
  const sm = (projectJson.stateMachines ?? []).find((s) => s.id === smId);
  let split = sm?.machineSpec?.smSplit;
  // PARTIAL BUILDS (Dan, 2026-09-01 free-order walk): machines the engineer
  // parked ("skip for now") are excluded — the ready machines build now; the
  // cover note names what was deferred. Per-machine programs make this natural.
  const deferredKeys = new Set((sm?.machineSpec?.cascadeState?.deferredMachines ?? []).map((k) => nk(k)));
  let deferredNames = [];
  if (Array.isArray(split) && deferredKeys.size) {
    deferredNames = split.filter((m) => deferredKeys.has(nk(m?.name))).map((m) => m.name);
    split = split.filter((m) => !deferredKeys.has(nk(m?.name)));
  }
  if (!Array.isArray(split) || split.length < 2) {
    const r = await (Array.isArray(split) && split.length === 1
      ? (async () => {
        // One ready machine — build it alone through the same virtual-SM path.
        const pairsAll = handshakePairsOf(sm.machineSpec.smSplit);
        const devs = devicesForMachine(split[0], sm.devices ?? []);
        const vsm = compileMachineSm(split[0], devs, { stationNumber: sm.stationNumber ?? 1 });
        vsm.machineSpec = { version: 1, smSplit: [split[0]], handshakeInterface: pairsAll, sourceDescription: sm.machineSpec?.sourceDescription ?? '' };
        return gen.generateL5X({ ...projectJson, stateMachines: [vsm] }, vsm.id, options);
      })()
      : gen.generateL5X(projectJson, smId, options)); // single machine — the normal path
    if (deferredNames.length && r?.writingNotes) {
      r.writingNotes.push({ text: `Partial build: ${deferredNames.join(', ')} deferred by the engineer — not in this file.` });
    }
    return r;
  }
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const pairs = handshakePairsOf(split);
  const programs = [];
  let mergedXml = null;
  const totalCost = { v: 0 };

  const deviceSets = assignDevices(split, sm.devices ?? []);
  for (let i = 0; i < split.length; i++) {
    const machine = split[i];
    const devs = deviceSets[i];
    const vsm = compileMachineSm(machine, devs, { stationNumber: sm.stationNumber ?? 1 });
    // The machine's OWN initialization + controls info + handshake contract.
    vsm.machineSpec = {
      version: 1,
      purpose: machine.oneLiner || machine.why || '',
      ...(sm.machineSpec?.controlsNotes ? { controlsNotes: sm.machineSpec.controlsNotes } : {}),
      smSplit: [machine], // its own approved steps ride for init coverage
      handshakeInterface: pairs.map((p) => ({
        tag: p.tag,
        role: p.producer === machine.name ? 'producer' : (p.consumer === machine.name ? 'consumer' : 'none'),
        producer: p.producer, producerStep: p.producerStep,
        consumer: p.consumer, consumerWait: p.consumerWait,
      })).filter((p) => p.role !== 'none'),
      sourceDescription: [
        `ONE PROGRAM PER STATE MACHINE (CE bible §3): this program is "${machine.name}", one of ${split.length} in station ${sm.displayName ?? sm.name}.`,
        '',
        '# HANDSHAKE INTERFACE (controller-scope p_ tags — wire EXACTLY these, invent none)',
        ...pairs.map((p) => `- ${p.tag}: SET by ${p.producer} at "${p.producerStep}"; READ by ${p.consumer}${p.consumerWait ? ` in "${p.consumerWait}"` : ''}${p.producer === machine.name ? '  ← YOU SET THIS' : p.consumer === machine.name ? '  ← YOU READ THIS' : ''}`),
        '',
        '# THIS MACHINE\'S APPROVED SEQUENCE',
        ...(machine.sequence ?? []).map((l, j) => `${j + 1}. ${l}`),
        '',
        '# THIS MACHINE\'S APPROVED INITIALIZATION',
        ...(machine.faultRecovery ?? []).map((l) => `- ${l}`),
      ].join('\n'),
    };
    const vproj = { ...projectJson, name: projectJson.name, stateMachines: [vsm] };
    const base = 5 + i * (85 / split.length);
    const span = 85 / split.length;
    onProgress(base, 'program', `Program ${i + 1}/${split.length}: ${machine.name}`);
    const r = await gen.generateL5X(vproj, vsm.id, {
      ...options,
      onProgress: (pct, stage, detail) => onProgress(base + (span * Math.min(pct, 100)) / 100, stage, `[${machine.name}] ${detail ?? stage}`),
    });
    totalCost.v += Number(r.meta?.costEstimate?.totalUSD) || 0;
    // The REAL emitted program name (S{nn}_… — not the bare SM name); all
    // merge/schedule/handshake checks run against it.
    const emittedName = (r.l5x && targetProgramNameOf(r.l5x, vsm.name)) || vsm.name;
    programs.push({ machine: machine.name, programName: emittedName, ok: r.ok, held: r.held ?? null, validation: r.validation, internalReview: r.internalReview ?? null, meta: r.meta, ir: r.ir });
    // PER-PROGRAM SIDECAR (2026-08-31 merge-bug lesson): each program's L5X
    // survives on disk so a failed merge is recoverable without re-paying
    // for the programs.
    if (r.l5x) {
      try {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(__dirname, '..', '..', '..', 'generated', '_programs');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${String(sm.name).replace(/[^A-Za-z0-9_-]+/g, '_')}__${emittedName}__${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.L5X`), r.l5x, 'utf8');
      } catch (_) { /* sidecar is best-effort */ }
    }
    if (r.l5x) r.l5x = asciiFoldL5x(r.l5x); // Studio imports are ASCII-only
    if (r.held) {
      // A hold in ANY machine stops the whole build — surface its questions.
      return { ...r, meta: { ...r.meta, engine: 'claude-agent-sdk', multiProgram: true, heldMachine: machine.name, programs, costEstimate: { totalUSD: Number(totalCost.v.toFixed(4)) } } };
    }
    if (!r.ok || !r.l5x) {
      return { ...r, meta: { ...r.meta, engine: 'claude-agent-sdk', multiProgram: true, failedMachine: machine.name, programs, costEstimate: { totalUSD: Number(totalCost.v.toFixed(4)) } } };
    }
    mergedXml = mergedXml == null ? r.l5x : mergePrograms(mergedXml, r.l5x, emittedName);
  }

  onProgress(92, 'merge', `Merging ${split.length} programs into one controller file`);
  const wf = XMLValidator.validate(mergedXml);
  const mergedErrors = [];
  if (wf !== true) mergedErrors.push(`Merged L5X not well-formed: ${wf.err?.msg}`);
  // FULL IMPORT-SIM ON THE MERGED FILE (Jason's real-controller import,
  // 2026-08-31: per-program validation passed while the MERGED file carried a
  // dangling ParameterConnection, cross-scope-undefined handshake tags, and
  // phantom q_ tags). The union of both machines' devices drives the
  // tag-level audit; scope-aware resolution runs across all programs.
  try {
    const { validateL5X } = require('./validator.js');
    const unionDevices = deviceSets.flat().map((d) => ({ name: d.displayName || d.name, type: d.type ?? '' }));
    const mv = validateL5X(mergedXml, { deviceNames: unionDevices.map((d) => d.name), devices: unionDevices });
    mergedErrors.push(...(mv.errors ?? []).map((e) => `[merged] ${e}`));
  } catch (e) { mergedErrors.push(`Merged-file validation unavailable: ${e.message}`); }
  // Program-target exports (our templates) carry no <Tasks>/<ScheduledPrograms>
  // section — Studio schedules at import. Require scheduling only when the
  // merged file actually has the section (controller-target exports).
  const hasSchedule = /<ScheduledPrograms>/.test(mergedXml);
  for (const pr of programs) {
    if (!new RegExp(`<Program\\s+[^>]*Name="${pr.programName}"`).test(mergedXml)) mergedErrors.push(`Program ${pr.programName} missing from the merged file`);
    if (hasSchedule && !new RegExp(`<ScheduledProgram\\s+Name="${pr.programName}"`).test(mergedXml)) mergedErrors.push(`Program ${pr.programName} not scheduled in the task`);
  }
  for (const p of pairs) {
    if (!mergedXml.includes(p.tag)) mergedErrors.push(`Handshake tag ${p.tag} missing from the merged file`);
  }

  const last = programs[programs.length - 1];
  const reviews = programs.map((p) => p.internalReview).filter(Boolean);
  const worst = reviews.find((r) => r.verdict === 'fix') ?? reviews.find((r) => r.verdict === 'unsure') ?? reviews[0] ?? null;
  return {
    ok: mergedErrors.length === 0,
    l5x: mergedXml,
    validation: {
      ok: mergedErrors.length === 0,
      errors: mergedErrors,
      warnings: programs.flatMap((p) => (p.validation?.warnings ?? []).map((w) => `[${p.machine}] ${w}`)),
    },
    editPlan: null,
    held: null,
    structuralChanges: null,
    patchedCompiledIr: null,
    internalReview: worst ? {
      ...worst,
      findings: programs.flatMap((p) => (p.internalReview?.findings ?? []).map((f) => (typeof f === 'string' ? `[${p.machine}] ${f}` : f))),
      summary: programs.map((p) => `${p.machine}: ${p.internalReview?.verdict ?? 'n/a'}`).join('; '),
    } : null,
    writingNotes: [
      { text: `Multi-program emission: ${split.length} programs (${programs.map((p) => p.programName).join(', ')}), ${pairs.length} handshake signals wired (${pairs.map((p) => p.tag).join(', ')}).` },
      ...(deferredNames.length ? [{ text: `Partial build: ${deferredNames.join(', ')} deferred by the engineer — not in this file.` }] : []),
    ],
    reviewNotes: [],
    ir: last?.ir ?? null,
    firstPassShip: null,
    roundsToShip: null,
    meta: {
      ...(last?.meta ?? {}),
      smName: sm.name,
      engine: 'claude-agent-sdk',
      multiProgram: true,
      programs: programs.map((p) => ({ machine: p.machine, programName: p.programName, ok: p.ok, review: p.internalReview?.verdict ?? null })),
      handshakes: pairs,
      costEstimate: { totalUSD: Number(totalCost.v.toFixed(4)) },
    },
  };
}

module.exports = { generateStationPrograms, handshakePairsOf, devicesForMachine, assignDevices, compileMachineSm, mergePrograms, targetProgramNameOf, asciiFoldL5x };
