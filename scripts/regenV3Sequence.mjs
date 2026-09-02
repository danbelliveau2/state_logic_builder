/**
 * regenV3Sequence.mjs — PHASE B offline: regenerate ONE v3 machine's canvas
 * (SM nodes/edges) from its sheet draft's approved structured steps with the
 * v1-grammar compiler (src/v3/compileLaneFlow.js) + the column-law layout
 * (src/lib/branchLayout.mjs). Same code path the in-app "Redraft from sheet"
 * button runs; this one writes the project file directly and backs it up
 * first (projects/_backups/<file>__pre-regen-<stamp>.json).
 *
 * Usage:
 *   node scripts/regenV3Sequence.mjs <projectFile> <smName> <draftId> <proposalMachineName> [--dry]
 *   e.g. node scripts/regenV3Sequence.mjs Magnet_Dial_v3.json MagnetShuttle d_mt7ngweu_hl29y "Magnet Shuttle"
 *
 * NOTE: the live app keeps its copy of the project in the browser's
 * localStorage and auto-saves it back to the server file. After running this,
 * reopen the project in the app (Files → open) so the tab reloads from disk,
 * or use the canvas's "Redraft from sheet" button instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileLaneFlow, stepsToModel } from '../src/v3/compileLaneFlow.js';
import { layoutBranchDiagram, applyBranchLayout, estimateNodeWidth } from '../src/lib/branchLayout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [projectFile, smName, draftId, machineName, ...flags] = process.argv.slice(2);
if (!projectFile || !smName || !draftId || !machineName) {
  console.error('usage: node scripts/regenV3Sequence.mjs <projectFile> <smName> <draftId> <proposalMachineName> [--dry]');
  process.exit(2);
}
const dry = flags.includes('--dry');
const V3_STATE_NODE_W = 320; // keep equal to src/v3/sequenceSm.js V3_STATE_NODE_W

const projPath = path.join(ROOT, 'projects', projectFile);
const project = JSON.parse(fs.readFileSync(projPath, 'utf8'));
const sm = project.stateMachines.find((s) => s.name === smName || s.displayName === smName);
if (!sm) { console.error(`SM "${smName}" not in ${projectFile}`); process.exit(1); }

const draftRec = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', '_sheet-drafts', `${draftId}.json`), 'utf8'));
const draft = draftRec.draft ?? draftRec;
const proposal = (draft.smProposal?.stateMachines ?? []).find((m) => m.name === machineName);
if (!proposal) { console.error(`machine "${machineName}" not in draft ${draftId} smProposal`); process.exit(1); }
const steps = proposal.sequenceSteps ?? proposal.sequence ?? [];
const isPrimary = (draft.smProposal.stateMachines ?? []).findIndex((m) => m === proposal) === 0
  || /shuttle|primary/i.test(machineName); // the primary machine gets Cycle Complete

const model = stepsToModel(steps);
const compiled = compileLaneFlow(model, { devices: sm.devices ?? [], machineName, isPrimary: true });
const layout = layoutBranchDiagram(compiled.nodes, compiled.edges, {
  getHeight: (n) => (n.type === 'decisionNode' ? 96 : 120),
  getWidth: (n) => (n.type === 'stateNode' ? V3_STATE_NODE_W : estimateNodeWidth(n)),
});
const { nodes, edges } = layout.changed ? applyBranchLayout(compiled.nodes, compiled.edges, layout) : compiled;

// ── Report
const byId = new Map(nodes.map((n) => [n.id, n]));
const devName = (id) => (sm.devices ?? []).find((d) => d.id === id)?.displayName ?? id;
const describe = (n) => {
  if (n.type === 'decisionNode') {
    const d = n.data;
    if (d.nodeMode === 'wait') return `WAIT ${d.signalName}${d.signalSource ? ` (${d.signalSource})` : ''}`;
    const retry = d.retryEnabled ? ` [retry=${d.retryMax} → ${byId.get(d.retryTargetNodeId) ? describe(byId.get(d.retryTargetNodeId)).slice(0, 34) : '?'}; exhausted → init]` : '';
    return `CHECK ${d.signalName} ${d.exit1Label}${d.exitCount === 2 ? `/${d.exit2Label}` : ''}${retry}`;
  }
  if (n.data.isInitial) return 'HOME';
  if (n.data.isComplete) return 'CYCLE COMPLETE';
  const acts = (n.data.actions ?? []).map((a) => a.pickerV2
    ? `CHECK ${a.pickerConfig.subjectName} ${a.pickerConfig.condition}${a.pickerConfig.retryEnabled ? ` [retry=${a.pickerConfig.retryCount}]` : ''} exits ${a.pickerConfig.edgeLabels.join('/')}`
    : `${a.operation} ${devName(a.deviceId)}${a.advanceCondition?.type === 'none' ? ' (concurrent)' : ''}`);
  return acts.length ? acts.join(' + ') : n.data.label;
};
console.log(`\n${machineName} → ${smName}: ${nodes.length} nodes, ${edges.length} edges${isPrimary ? '' : ' (non-primary)'}\n`);
for (const n of nodes) console.log(`  [${String(Math.round(n.position.x)).padStart(5)},${String(Math.round(n.position.y)).padStart(5)}] ${describe(n)}`);
console.log('\n  edges:');
for (const e of edges) {
  const lbl = e.data?.outcomeLabel || e.data?.label || '';
  console.log(`    ${describe(byId.get(e.source)).slice(0, 44).padEnd(44)} -[${e.sourceHandle ?? 'bottom'}${lbl ? ` ${lbl}` : ''}]-> ${describe(byId.get(e.target)).slice(0, 44)}${e.targetHandle ? ` th=${e.targetHandle}` : ''}`);
}
if (dry) { console.log('\n(dry run — nothing written)'); process.exit(0); }

// ── Write with backup
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bdir = path.join(ROOT, 'projects', '_backups');
fs.mkdirSync(bdir, { recursive: true });
fs.copyFileSync(projPath, path.join(bdir, `${projectFile.replace(/\.json$/i, '')}__pre-regen-${stamp}.json`));
const now = new Date().toISOString();
const prevV3 = sm.machineSpec?.v3 ?? {};
sm.machineSpec = {
  ...(sm.machineSpec ?? {}),
  canvasAuthoritative: true,
  canvasAuthoritativeAt: now,
  v3: {
    ...prevV3,
    migratedAt: now, migratedFrom: 'sheet-structured-steps', redraftedAt: now,
    redraftBackups: [...(prevV3.redraftBackups ?? []), { at: now, nodes: sm.nodes ?? [], edges: sm.edges ?? [] }].slice(-3),
  },
};
delete sm.machineSpec.v3.measuredLayoutAt;
sm.nodes = nodes;
sm.edges = edges;
fs.writeFileSync(projPath, JSON.stringify(project, null, 2), 'utf8');
console.log(`\nwrote ${projPath} (backup in projects/_backups/)`);
