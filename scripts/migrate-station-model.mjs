/**
 * migrate-station-model.mjs — stamp STATION IDENTITY onto a project's state
 * machines (Dan's ruling, 2026-08-25: "This is ONE station. One station can
 * have multiple state machines — NOT station one and station two.").
 *
 * Writes four fields per SM record — stationId / stationNumber / stationName /
 * smName — which src/lib/stationModel.js reads to build the STATION grouping.
 * Idempotent: re-running with the same arguments changes nothing.
 *
 * Usage (run in a QUIET window — the app autosaves the open project over its
 * file, so a live session will overwrite an edit made behind its back):
 *
 *   node scripts/migrate-station-model.mjs projects/Magnet_Dial_v3.json \
 *        --station "Magnet Dial" --number 1 \
 *        --sms "MagnetLoad=Magnet Load,MagnetPickHead=Magnet Pick Head"
 *
 *   --sms is optional; without it each SM's displayName becomes its smName.
 *   --only "A,B"  restricts the migration to those SM names (others untouched).
 */
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : null;
};
if (!file) {
  console.error('usage: node scripts/migrate-station-model.mjs <project.json> --station "Name" --number 1 [--sms "SmName=Label,..."] [--only "A,B"]');
  process.exit(1);
}

const stationName = flag('station');
const stationNumber = Number(flag('number') ?? 1);
if (!stationName) { console.error('--station "Name" is required'); process.exit(1); }

const stationId = 'st_' + stationName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const labels = new Map(
  String(flag('sms') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((pair) => {
      const [k, v] = pair.split('=');
      return [String(k).trim(), String(v ?? k).trim()];
    })
);
const only = String(flag('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const abs = path.resolve(file);
const project = JSON.parse(fs.readFileSync(abs, 'utf8'));

// Back up first — always.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(path.dirname(abs), '_backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `${path.basename(abs, '.json')}__pre-station-model-${stamp}.json`);
fs.copyFileSync(abs, backup);

let touched = 0;
for (const sm of project.stateMachines ?? []) {
  if (only.length && !only.includes(sm.name)) continue;
  sm.stationId = stationId;
  sm.stationNumber = stationNumber;
  sm.stationName = stationName;
  sm.smName = labels.get(sm.name) ?? sm.smName ?? sm.displayName ?? sm.name;
  touched++;
}

fs.writeFileSync(abs, JSON.stringify(project, null, 2));
console.log(`Station "${stationName}" (S${String(stationNumber).padStart(2, '0')}, ${stationId}) — ${touched} state machines stamped.`);
console.log(`Backup: ${backup}`);
