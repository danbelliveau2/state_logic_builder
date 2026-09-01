/**
 * measurePrepassBuild.cjs — before/after measurement for the deterministic
 * device pre-pass (Dan's Rockwell debrief). Rebuilds the MidBase
 * PickAndPlace program (S05 family — the axis-purge + gripper-rename case)
 * with JARVIS_DEVICE_PREPASS on and reports wall time, cost, repair rounds,
 * and the plan's op histogram for comparison against the 2026-08-31 baseline.
 *
 * Baseline (recorded): plan 68 ops (49 mechanical / 19 logic); first run
 * held 5 rounds @ $8.99 on the Z purge; clean rerun ~$12.5 and ~30 min wall.
 *
 * Run: node scripts/measurePrepassBuild.cjs
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.JARVIS_DEVICE_PREPASS = process.env.JARVIS_DEVICE_PREPASS || 'on';

const ROOT = path.join(__dirname, '..');
const { handshakePairsOf, assignDevices, compileMachineSm } = require('../src/lib/agentGenerator/multiProgram.js');

async function main() {
  const projectJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'PNP_ServoX-_PneumaticZ.json'), 'utf8'));
  const sm = projectJson.stateMachines[0];
  const split = sm.machineSpec.smSplit;
  const pairs = handshakePairsOf(split);
  const deviceSets = assignDevices(split, sm.devices ?? []);
  const i = split.findIndex(m => /pick/i.test(m.name));
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
      "# THIS MACHINE'S APPROVED SEQUENCE",
      ...(machine.sequence ?? []).map((l, j) => `${j + 1}. ${l}`),
      '',
      "# THIS MACHINE'S APPROVED INITIALIZATION",
      ...(machine.faultRecovery ?? []).map(l => `- ${l}`),
    ].join('\n'),
  };
  const vproj = { ...projectJson, stateMachines: [vsm] };
  const gen = require('../src/lib/agentGenerator/client.js');
  const t0 = Date.now();
  const marks = [];
  const r = await gen.generateL5X(vproj, vsm.id, {
    onProgress: (pct, stage, detail) => {
      marks.push({ t: Date.now() - t0, stage, detail });
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${stage}: ${String(detail ?? '').slice(0, 110)}`);
    },
  });
  const wallS = Math.round((Date.now() - t0) / 1000);
  const ops = r.editPlan?.operations ?? [];
  const h = {};
  for (const o of ops) h[o.op] = (h[o.op] || 0) + 1;
  console.log('\n== MEASUREMENT (JARVIS_DEVICE_PREPASS=' + process.env.JARVIS_DEVICE_PREPASS + ') ==');
  console.log('wall:', wallS, 's');
  console.log('cost: $', r.meta?.costEstimate?.totalUSD);
  console.log('repair rounds:', r.meta?.repairRounds, 'held:', !!r.held, 'ok:', r.ok);
  console.log('plan ops:', ops.length, JSON.stringify(h));
  console.log('prepass applied:', JSON.stringify(r.meta?.devicePrepass ?? []));
  console.log('validation:', r.validation?.ok, (r.validation?.errors ?? []).slice(0, 3));
  console.log('review:', r.internalReview?.verdict, 'findings:', (r.internalReview?.findings ?? []).length);
  if (r.l5x) {
    const dir = path.join(ROOT, 'generated', '_programs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `MEASURE_prepass_PickAndPlace_${Date.now().toString(36)}.L5X`), r.l5x, 'utf8');
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
