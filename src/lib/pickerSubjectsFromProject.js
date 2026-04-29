/**
 * pickerSubjectsFromProject.js — Convert project devices/signals/PT fields
 * into the UniversalPicker's subject schema.
 *
 * Subject shape (matches src/lib/pickerTestSubjects.js):
 *   {
 *     id:           string,
 *     name:         string,
 *     grammarRowId: string,    // FK to pickerGrammar row
 *     detailValues: { [category]: string[] }
 *   }
 *
 * Mapping:
 *   - Devices in a state machine → look up grammar row by device.type
 *   - Project signals → grammarRowId: 'signal'
 *   - Part-tracking fields → grammarRowId: 'partTracking'
 */

// Map src/lib/deviceTypes.js DEVICE_TYPES keys → grammar row IDs.
// Stays in sync with DEFAULT_GRAMMAR row ids in src/lib/pickerGrammar.js.
const DEVICE_TYPE_TO_GRAMMAR = {
  PneumaticLinearActuator: 'cylinder',
  PneumaticRotaryActuator: 'rotary',
  PneumaticGripper:        'gripper',
  PneumaticVacGenerator:   'vacuum',
  ServoAxis:               'servo',
  Conveyor:                'conveyor',
  DigitalSensor:           'digitalSensor',
  AnalogSensor:            'analogSensor',
  VisionSystem:            'vision',
  Robot:                   'robot',
  Timer:                   'timer',
  Parameter:               'parameter',
  Custom:                  'custom',
};

/**
 * Build the subjects array for a specific state machine.
 *
 * @param {object} project       project root from store
 * @param {string} smId          which SM's devices to include
 * @returns {Array} picker subjects ready for UniversalPicker `subjects` prop
 */
export function getProjectSubjects(project, smId) {
  if (!project) return [];
  const sm = project.stateMachines?.find(s => s.id === smId);
  const subjects = [];

  // ── Devices in the current SM ──────────────────────────────────────────
  if (sm?.devices) {
    sm.devices.forEach(d => {
      const grammarRowId = DEVICE_TYPE_TO_GRAMMAR[d.type] || 'custom';
      const detailValues = {};
      // detailValueMeta lets one detail category drive auto-fills on
      // dependent categories. Format:
      //   detailValueMeta[primaryCategory][primaryValue] = { [otherCategory]: value }
      // The picker watches for changes on `primaryCategory` and writes the
      // metadata values into other detail categories. Used here so picking a
      // Servo position auto-fills its Move Type.
      const detailValueMeta = {};

      // Servo: positions[].name → "Position name" enum.
      // Also publish a fixed Move Type list AND a per-position meta map so
      // picking "Pick" auto-fills Move Type with the position's stored type.
      if (d.type === 'ServoAxis' && Array.isArray(d.positions)) {
        const positions = d.positions.filter(p => p?.name);
        const names = positions.map(p => p.name);
        if (names.length) {
          detailValues['Position name'] = names;
          detailValues['Move Type']     = ['Absolute', 'Incremental', 'Index'];
          // Build position → moveType lookup. Position records store the
          // type in `moveType` (canonical: 'Pos' | 'Incr' | 'Idx') and/or
          // `type` (legacy: 'position' | 'absolute' | 'incremental' | 'index').
          // Normalise both to the picker's chip labels.
          const posMeta = {};
          positions.forEach(p => {
            const raw = String(p.moveType ?? p.type ?? 'Pos').toLowerCase().trim();
            const normalised =
              (raw === 'pos' || raw === 'absolute' || raw === 'position') ? 'Absolute' :
              (raw === 'incr' || raw === 'incremental')                    ? 'Incremental' :
              (raw === 'idx' || raw === 'index')                            ? 'Index' :
              'Absolute';
            posMeta[p.name] = { 'Move Type': normalised };
          });
          detailValueMeta['Position name'] = posMeta;
        }
      }
      // Vision: jobs[].name → "Job name" enum
      if (d.type === 'VisionSystem' && Array.isArray(d.jobs)) {
        const names = d.jobs.map(j => j?.name).filter(Boolean);
        if (names.length) detailValues['Job name'] = names;
      }
      // Robot: signals + sequences → "Sequence #" / "Signal name" enums
      if (d.type === 'Robot') {
        if (Array.isArray(d.sequences)) {
          const seqs = d.sequences.map(s => String(s?.number ?? s?.name ?? '').trim()).filter(Boolean);
          if (seqs.length) detailValues['Sequence #'] = seqs;
        }
        if (Array.isArray(d.signals)) {
          const sigs = d.signals.map(s => s?.name).filter(Boolean);
          if (sigs.length) detailValues['Signal name'] = sigs;
        }
      }
      // Analog: setpoints → "Setpoint name" enum
      if (d.type === 'AnalogSensor' && Array.isArray(d.setpoints)) {
        const names = d.setpoints.map(s => s?.name).filter(Boolean);
        if (names.length) detailValues['Setpoint name'] = names;
      }

      subjects.push({
        id: d.id,
        name: d.displayName || d.name || '<unnamed>',
        grammarRowId,
        detailValues,
        detailValueMeta,
      });
    });
  }

  // ── Project-wide signals ───────────────────────────────────────────────
  // The SUBJECT is the signal itself — no redundant "Signal name" detail.
  if (Array.isArray(project.signals)) {
    project.signals.forEach(sig => {
      subjects.push({
        id: sig.id,
        name: sig.name || '<unnamed signal>',
        grammarRowId: 'signal',
        detailValues: {},
      });
    });
  }

  // ── Project-wide part-tracking fields ─────────────────────────────────
  // SUBJECT is the field name; no redundant "Field name" detail.
  if (Array.isArray(project.partTrackingFields)) {
    project.partTrackingFields.forEach(f => {
      subjects.push({
        id: f.id,
        name: f.name || '<unnamed field>',
        grammarRowId: 'partTracking',
        detailValues: {},
      });
    });
  }

  return subjects;
}
