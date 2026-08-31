/**
 * regressImportRejections.cjs — JASON'S REAL STUDIO-IMPORT FAILURES AS
 * PERMANENT FIXTURES (2026-08-31, round 2 corrections).
 *
 * Fixture: generated/PNP_ServoX-_PneumaticZ/MidBaseLoad__sdce_v1.4.0__2026-08-31_1835.L5X
 * — the exact file Studio 5000 rejected on Jason's machine. It must FAIL
 * offline with all three defect classes his import surfaced:
 *   1. Dangling ParameterConnection (iq_ZAxis deleted, connection survived)
 *      → "Unable to import parameterconnection … usage types are incompatible"
 *   2. Referenced-but-undefined tags across program scopes (p_PartGripped /
 *      p_PartClear defined only inside the PnP program; the Escapement's
 *      references imported "Undefined")
 *   3. Phantom directional q_ tags (q_ExtendZAxis for the deleted axis;
 *      q_ExtendXAxis on a SERVO — template leftovers)
 *
 * The repaired v1.4.1 must PASS the same gates clean.
 *
 * Run: node scripts/regressImportRejections.cjs   (exit 0 = pass)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { validateL5X } = require(path.join(ROOT, 'src', 'lib', 'agentGenerator', 'validator.js'));

const GEN = path.join(ROOT, 'generated', 'PNP_ServoX-_PneumaticZ');
const BAD = path.join(GEN, 'MidBaseLoad__sdce_v1.4.0__2026-08-31_1835.L5X');
const GOOD = path.join(GEN, 'MidBaseLoad__sdce_v1.4.1__2026-08-31_1845.L5X');

// The station's sheet devices (both machines) — drives the tag-level audit.
const DEVICES = [
  { name: 'Escapement_Finger_1', type: 'PneumaticLinearActuator' },
  { name: 'Escapement_Shuttle', type: 'PneumaticLinearActuator' },
  { name: 'Shuttle_Gripper', type: 'PneumaticGripper' },
  { name: 'Nest_Part_Present', type: 'DigitalSensor' },
  { name: 'X_Axis', type: 'ServoAxis' },
  { name: 'Vertical_Slide', type: 'PneumaticLinearActuator' },
  { name: 'PNP_Gripper', type: 'PneumaticGripper' },
];
const OPTS = { deviceNames: DEVICES.map(d => d.name), devices: DEVICES };

const failures = [];
function expectErrors(file, patterns, label) {
  const v = validateL5X(fs.readFileSync(file, 'utf8'), OPTS);
  if (v.ok) { failures.push(`${label}: expected FAIL, got PASS`); return; }
  for (const [name, re] of patterns) {
    if (!v.errors.some(e => re.test(e))) failures.push(`${label}: missing expected error class "${name}"`);
    else console.log(`  ${label}: catches ${name}`);
  }
}

// 1-3. The rejected file fails with all three classes.
expectErrors(BAD, [
  ['dangling ParameterConnection', /ParameterConnection .*iq_ZAxis.*deleted or absent parameter/],
  ['cross-scope undefined tag', /p_Part(Gripped|Clear).*another program's scope/],
  ['phantom q_ tag (deleted axis)', /Phantom output tag q_(Extend|Retract)ZAxis/],
  ['wrong tag family (servo q_)', /q_(Extend|Retract)XAxis is a pneumatic-style directional output but .* Servo/i],
], 'fixture v1.4.0 (Jason\'s rejected import)');

// 4. The repaired file passes the SAME gates clean.
{
  const v = validateL5X(fs.readFileSync(GOOD, 'utf8'), OPTS);
  if (!v.ok) failures.push(`v1.4.1 must PASS, got: ${v.errors.slice(0, 3).join(' | ')}`);
  else console.log('  v1.4.1 (repaired): PASS clean');
}

if (failures.length) {
  console.error('\nFAILURES:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll import-rejection regressions PASS.');
