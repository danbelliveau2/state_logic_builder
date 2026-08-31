/**
 * resumeTwoProgramMerge.cjs — one-shot recovery for the 2026-08-31 MidBaseLoad
 * two-program build (merge-name bug): the merged file carried only
 * S01_MidBasePickAndPlace plus a junk context program; the Escapement
 * program's XML was never saved.
 *
 * Steps:
 *   1. Reconstruct the base (PickAndPlace) L5X from the bad merged file by
 *      dropping the appended duplicate context program.
 *   2. Re-generate ONLY the Mid-Base Escapement program (full pipeline).
 *   3. mergePrograms (fixed: Use="Target" extraction, real names, ASCII fold).
 *   4. Wire the two intra-station consumer stubs (AlwaysOff → the real
 *      handshake tags) — the internal reviewer's blocker.
 *   5. Post-merge checks + full import-sim validation; save merged L5X.
 *
 * Run: node scripts/resumeTwoProgramMerge.cjs
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const GEN_DIR = path.join(ROOT, 'generated', 'PNP_ServoX-_PneumaticZ');
const BAD_MERGED = path.join(GEN_DIR, 'MidBaseLoad__sdce_v1.4.0__2026-08-31_1809.L5X');

const { handshakePairsOf, assignDevices, compileMachineSm, mergePrograms, targetProgramNameOf, asciiFoldL5x } =
  require('../src/lib/agentGenerator/multiProgram.js');

async function main() {
  // ── 1. Base reconstruction ────────────────────────────────────────────────
  let base = fs.readFileSync(BAD_MERGED, 'utf8');
  // Tempered: the junk block may not contain another <Program — the first
  // (lazy-span) version of this regex ate everything from the FIRST context
  // program to the end of <Programs>, target included.
  const junkRe = /<Program Use="Context" Name="Alarms"(?:(?!<Program[\s>])[\s\S])*?<\/Program>\s*(?=<\/Programs>)/;
  if (junkRe.test(base)) {
    base = base.replace(junkRe, '');
    console.log('[1] dropped appended duplicate context program');
  } else {
    console.log('[1] no appended junk found — base used as-is');
  }
  base = asciiFoldL5x(base);
  const baseName = targetProgramNameOf(base, 'MidBasePickAndPlace');
  console.log('[1] base target program:', baseName);

  // ── 2. Escapement program (same vsm construction as generateStationPrograms)
  const projectJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'PNP_ServoX-_PneumaticZ.json'), 'utf8'));
  const sm = projectJson.stateMachines[0];
  const split = sm.machineSpec.smSplit;
  const pairs = handshakePairsOf(split);
  const deviceSets = assignDevices(split, sm.devices ?? []);
  const i = split.findIndex(m => /escapement/i.test(m.name));
  const machine = split[i];
  const vsm = compileMachineSm(machine, deviceSets[i], { stationNumber: sm.stationNumber ?? 1 });
  vsm.machineSpec = {
    version: 1,
    purpose: machine.oneLiner || machine.why || '',
    ...(sm.machineSpec?.controlsNotes ? { controlsNotes: sm.machineSpec.controlsNotes } : {}),
    smSplit: [machine],
    handshakeInterface: pairs.map(p => ({
      tag: p.tag,
      role: p.producer === machine.name ? 'producer' : (p.consumer === machine.name ? 'consumer' : 'none'),
      producer: p.producer, producerStep: p.producerStep,
      consumer: p.consumer, consumerWait: p.consumerWait,
    })).filter(p => p.role !== 'none'),
    sourceDescription: [
      `ONE PROGRAM PER STATE MACHINE (CE bible §3): this program is "${machine.name}", one of ${split.length} in station ${sm.displayName ?? sm.name}.`,
      '',
      '# HANDSHAKE INTERFACE (controller-scope p_ tags — wire EXACTLY these, invent none)',
      ...pairs.map(p => `- ${p.tag}: SET by ${p.producer} at "${p.producerStep}"; READ by ${p.consumer}${p.consumerWait ? ` in "${p.consumerWait}"` : ''}${p.producer === machine.name ? '  ← YOU SET THIS' : p.consumer === machine.name ? '  ← YOU READ THIS' : ''}`),
      '',
      '# THIS MACHINE\'S APPROVED SEQUENCE',
      ...(machine.sequence ?? []).map((l, j) => `${j + 1}. ${l}`),
      '',
      '# THIS MACHINE\'S APPROVED INITIALIZATION',
      ...(machine.faultRecovery ?? []).map(l => `- ${l}`),
    ].join('\n'),
  };
  const vproj = { ...projectJson, stateMachines: [vsm] };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/(\d{8})(\d{4})/, '$1_$2');
  // ALREADY-PAID PROGRAM: reuse the saved sidecar when present — the
  // 2026-08-31 run generated a clean S01_MidBaseEscapement; only the merge
  // was broken. Delete the sidecar to force a fresh generation.
  const sidecarDir = path.join(ROOT, 'generated', '_programs');
  const sidecar = fs.existsSync(sidecarDir)
    ? fs.readdirSync(sidecarDir).filter(f => /MidBaseLoad__.*\.L5X$/i.test(f)).sort().pop()
    : null;
  let escXml;
  if (sidecar) {
    escXml = asciiFoldL5x(fs.readFileSync(path.join(sidecarDir, sidecar), 'utf8'));
    console.log('[2] reusing saved program sidecar:', sidecar);
  } else {
    console.log('[2] generating', machine.name, 'with devices:', deviceSets[i].map(d => d.displayName ?? d.name).join(', '));
    const gen = require('../src/lib/agentGenerator/client.js');
    const r = await gen.generateL5X(vproj, vsm.id, {
      onProgress: (pct, stage, detail) => console.log(`  [${Math.round(pct)}%] ${stage}: ${detail ?? ''}`),
    });
    if (r.held) {
      console.error('[2] HELD:', JSON.stringify(r.held.questions ?? [], null, 1));
      process.exit(2);
    }
    if (!r.ok || !r.l5x) {
      console.error('[2] FAILED:', JSON.stringify(r.validation?.errors ?? [], null, 1));
      process.exit(3);
    }
    escXml = asciiFoldL5x(r.l5x);
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, `MidBaseLoad__escapement__${stamp}.L5X`), escXml, 'utf8');
    console.log('[2] escapement review:', r.internalReview?.verdict, '— findings:', (r.internalReview?.findings ?? []).length, '— cost $', r.meta?.costEstimate?.totalUSD);
    fs.writeFileSync(path.join(GEN_DIR, '_escapement.review.json'), JSON.stringify(r.internalReview ?? null, null, 2), 'utf8');
  }
  const escName = targetProgramNameOf(escXml, vsm.name) || vsm.name;
  console.log('[2] escapement program name:', escName);

  // ── 3. Merge ──────────────────────────────────────────────────────────────
  let merged = mergePrograms(base, escXml, escName);
  console.log('[3] merged');

  // ── 4. Wire the intra-station consumer stubs (reviewer blocker) ──────────
  // p_PartReadyForPick: state 4 → 7 wait; p_ShuttleGripperOpen: state 13 → 16.
  const wired = [];
  const wire = (stateN, tag) => {
    const re = new RegExp(`(XIC\\(Status\\.State\\[${stateN}\\]\\)\\s*\\[)XIC\\(g_MachineBasic\\.AlwaysOff\\)(\\s*,XIC\\(DryRun\\)\\s*\\])`);
    if (re.test(merged) && merged.includes(`"${tag}"`)) {
      merged = merged.replace(re, `$1XIC(${tag})$2`);
      wired.push(`${tag} @ state ${stateN}`);
    }
  };
  wire(4, 'p_PartReadyForPick');    // PickAndPlace waits on the escapement
  wire(13, 'p_ShuttleGripperOpen'); // PickAndPlace waits on the escapement
  wire(19, 'p_PartGripped');        // Escapement waits on the PickAndPlace
  wire(25, 'p_PartClear');          // Escapement waits on the PickAndPlace
  // Update the *Replace comments for the two waits we actually wired.
  if (wired.length) {
    merged = merged
      .replace(/\*Replace the AlwaysOff bit with the escapement's part ready at nest signal\./, `Wired to the escapement's p_PartReadyForPick (intra-station handshake).`)
      .replace(/\*Replace the AlwaysOff bit with the escapement's shuttle gripper open signal\./, `Wired to the escapement's p_ShuttleGripperOpen (intra-station handshake).`)
      .replace(/\*Replace the AlwaysOff bit with the pick and place's part gripped signal\.?/i, `Wired to the pick and place's p_PartGripped (intra-station handshake).`)
      .replace(/\*Replace the AlwaysOff bit with the pick and place's part clear signal\.?/i, `Wired to the pick and place's p_PartClear (intra-station handshake).`);
  }
  console.log('[4] consumer stubs wired:', wired.length ? wired.join('; ') : 'NONE (tags not found — left stubbed)');

  // ── 5. Checks + validation + save ─────────────────────────────────────────
  const errors = [];
  const hasSchedule = /<ScheduledPrograms>/.test(merged);
  for (const name of [baseName, escName]) {
    if (!new RegExp(`<Program\\s+[^>]*Name="${name}"`).test(merged)) errors.push(`Program ${name} missing`);
    if (hasSchedule && !new RegExp(`<ScheduledProgram\\s+Name="${name}"`).test(merged)) errors.push(`Program ${name} not scheduled`);
  }
  for (const p of pairs) if (!merged.includes(p.tag)) errors.push(`Handshake tag ${p.tag} missing`);
  const { validateL5X } = require('../src/lib/agentGenerator/validator.js');
  const v = validateL5X(merged);
  console.log('[5] structural:', errors.length ? errors.join(' | ') : 'OK');
  console.log('[5] import-sim:', v.ok ? 'PASS' : 'FAIL', JSON.stringify((v.errors ?? []).slice(0, 8), null, 1));
  console.log('[5] warnings:', JSON.stringify((v.warnings ?? []).slice(0, 6), null, 1));
  const out = path.join(GEN_DIR, `MidBaseLoad__sdce_v1.4.0__${stamp}.L5X`);
  fs.writeFileSync(out, merged, 'utf8');
  console.log('[5] saved:', out);
  process.exit(errors.length === 0 && v.ok ? 0 : 4);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
