/**
 * AddDeviceModal - Add or edit a device in the current state machine.
 * Adapts fields based on device type (cylinder, gripper, servo, etc.)
 * Uses SVG icons for device types and checkbox-based sensor configuration.
 */

import { useState, useEffect } from 'react';
import { DEVICE_TYPES } from '../../lib/deviceTypes.js';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { DeviceIcon } from '../DeviceIcons.jsx';
import { CustomDeviceConfigurator } from './CustomDeviceConfigurator.jsx';
import { DeviceLibraryPicker } from './DeviceLibraryPicker.jsx';
import { saveToLibrary } from '../../lib/deviceLibrary.js';

// ── Sensor checkbox helpers ───────────────────────────────────────────────────

function linearConfigFromChecks(hasExt, hasRet) {
  if (hasExt && hasRet) return '2-sensor (Ext + Ret)';
  if (hasRet) return '1-sensor (Ret only)';
  if (hasExt) return '1-sensor (Ext only)';
  return 'No sensors';
}

function gripperConfigFromChecks(hasEng, hasDis) {
  if (hasEng && hasDis) return '2-sensor (Eng + Dis)';
  if (hasEng) return '1-sensor (Engaged only)';
  return 'No sensors';
}

function parseLinearConfig(arr) {
  const s = (arr ?? '').toLowerCase();
  return {
    hasExt: s.includes('2-sensor') || s.includes('ext only'),
    hasRet: s.includes('2-sensor') || s.includes('ret only') || s.includes('1-sensor'),
  };
}

function parseGripperConfig(arr) {
  const s = (arr ?? '').toLowerCase();
  return {
    hasEng: s.includes('2-sensor') || s.includes('1-sensor') || s.includes('engaged'),
    hasDis: s.includes('2-sensor'),
  };
}

// ── Speed Profile Row Component ───────────────────────────────────────────────

function SpeedProfileRow({ profile, index, onChange, onRemove, motionType }) {
  const isRotary = motionType === 'rotary';
  const speedUnit = isRotary ? 'deg / sec' : 'mm / sec';
  const accelUnit = isRotary ? 'deg / sec²' : 'mm / sec²';
  return (
    <div className="servo-profile-card">
      <div className="servo-profile-card__header">
        <input
          className="form-input"
          value={profile.name}
          onChange={e => onChange(index, 'name', e.target.value)}
          placeholder="Profile Name"
          style={{ flex: 1 }}
        />
        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          onClick={() => onRemove(index)}
          title="Remove profile"
        >✕</button>
      </div>
      <div className="servo-profile-card__fields">
        <div className="servo-field-row">
          <span className="servo-field-label">Speed</span>
          <input className="form-input servo-field-input" type="number" min="0"
            value={profile.speed ?? 100}
            onChange={e => onChange(index, 'speed', parseFloat(e.target.value) || 0)} />
          <span className="servo-field-unit">{speedUnit}</span>
        </div>
        <div className="servo-field-row">
          <span className="servo-field-label">Accel</span>
          <input className="form-input servo-field-input" type="number" min="0"
            value={profile.accel ?? 5000}
            onChange={e => onChange(index, 'accel', parseFloat(e.target.value) || 0)} />
          <span className="servo-field-unit">{accelUnit}</span>
        </div>
        <div className="servo-field-row">
          <span className="servo-field-label">Decel</span>
          <input className="form-input servo-field-input" type="number" min="0"
            value={profile.decel ?? 5000}
            onChange={e => onChange(index, 'decel', parseFloat(e.target.value) || 0)} />
          <span className="servo-field-unit">{accelUnit}</span>
        </div>
      </div>
    </div>
  );
}

// ── Vision Job Row Component ──────────────────────────────────────────────────

function VisionJobRow({ job, index, onChange, onRemove }) {
  const [showCustomize, setShowCustomize] = useState(false);
  const numericOutputs = job.numericOutputs ?? [];

  function handleNameChange(newName) {
    onChange(index, 'name', newName);
  }

  function addNumericOutput() {
    onChange(index, 'numericOutputs', [...numericOutputs, { name: '', unit: 'mm' }]);
  }
  function updateNumericOutput(oIdx, field, value) {
    const updated = numericOutputs.map((o, i) => i === oIdx ? { ...o, [field]: value } : o);
    onChange(index, 'numericOutputs', updated);
  }
  function removeNumericOutput(oIdx) {
    onChange(index, 'numericOutputs', numericOutputs.filter((_, i) => i !== oIdx));
  }

  return (
    <div className="vision-job-card">
      <div className="vision-job-card__row">
        <input
          className="form-input"
          value={job.name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder="Job Name (e.g. LocateStamp)"
          style={{ flex: 1 }}
        />
        <div className="vision-job-outcomes">
          <span className="vision-outcome-badge vision-outcome-badge--pass">✓ Pass</span>
          <span className="vision-outcome-badge vision-outcome-badge--fail">✗ Fail</span>
        </div>
        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          onClick={() => onRemove(index)}
          title="Remove job"
        >✕</button>
      </div>
      {/* Outcomes row */}
      <div style={{ fontSize: 11, color: '#666', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#74c415' }}>●</span> Pass → continue &nbsp;|&nbsp;
        <span style={{ color: '#fa5650' }}>●</span> Fail → reject part
      </div>
      {/* Data Outputs — always visible */}
      <div style={{ padding: '6px 8px', borderTop: '1px solid #e5e7eb', background: '#f8f9fa' }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center' }}>
          <span>📊 Data Outputs</span>
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>measurement values stored in Part Tracking</span>
          <span onClick={addNumericOutput} style={{ marginLeft: 'auto', cursor: 'pointer', color: '#0072B5', fontWeight: 500 }}>+ Add Output</span>
        </div>
        {numericOutputs.map((out, oIdx) => (
          <div key={oIdx} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: '#64748b', width: 16, textAlign: 'center' }}>R{oIdx}</span>
            <input className="form-input" value={out.name} onChange={e => updateNumericOutput(oIdx, 'name', e.target.value)}
              placeholder="e.g. X_Offset" style={{ flex: 1, fontSize: 11, padding: '2px 6px' }} />
            <select value={out.unit} onChange={e => updateNumericOutput(oIdx, 'unit', e.target.value)}
              style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid #d1d5db' }}>
              <option value="mm">mm</option>
              <option value="deg">deg</option>
            </select>
            <button onClick={() => removeNumericOutput(oIdx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 12 }}>✕</button>
          </div>
        ))}
        {numericOutputs.length === 0 && (
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '4px 0' }}>
            No data outputs — add if vision returns measurements (offsets, positions, etc.)
          </div>
        )}
      </div>
    </div>
  );
}

// ── Position Row Component ────────────────────────────────────────────────────

const MOVE_TYPE_META_LINEAR = {
  Pos:  { label: 'Absolute', color: '#0072B5', unit: 'mm', valueLabel: 'Position' },
  Incr: { label: 'Incremental', color: '#059669', unit: 'mm', valueLabel: 'Distance' },
  Idx:  { label: 'Index', color: '#d97706', unit: '°', valueLabel: 'Angle' },
};
const MOVE_TYPE_META_ROTARY_DEG = {
  Pos:  { label: 'Absolute', color: '#0072B5', unit: 'deg', valueLabel: 'Position' },
  Incr: { label: 'Incremental', color: '#059669', unit: 'deg', valueLabel: 'Distance' },
  Idx:  { label: 'Index', color: '#d97706', unit: '°', valueLabel: 'Angle' },
};

function PositionCard({ pos, index, onChange, onRemove, motionType }) {
  const lookup = motionType === 'rotary' ? MOVE_TYPE_META_ROTARY_DEG : MOVE_TYPE_META_LINEAR;
  const mt = lookup[pos.moveType] ? pos.moveType : 'Pos';
  const meta = lookup[mt];
  // Pull default heads from machine config nest count
  const nestCount = useDiagramStore(s => s.project?.machineConfig?.nestCount);
  const defaultHeads = nestCount && nestCount >= 2 ? nestCount : 6;
  const heads = pos.heads ?? defaultHeads;
  const computedAngle = Math.round((360 / heads) * 10000) / 10000;

  return (
    <div className="pos-card" style={{ '--pos-card-color': meta.color }}>
      <div className="pos-card__header">
        <div className="pos-card__tabs">
          {Object.entries(lookup).map(([key, m]) => (
            <button key={key} type="button"
              className={`pos-card__tab${mt === key ? ' pos-card__tab--active' : ''}`}
              style={mt === key ? { background: m.color, color: '#fff', borderColor: m.color } : {}}
              onClick={() => {
                onChange(index, 'moveType', key);
                // When switching to Index, auto-seed heads from machine config
                if (key === 'Idx' && !pos.heads) {
                  onChange(index, 'heads', defaultHeads);
                  onChange(index, 'defaultValue', Math.round((360 / defaultHeads) * 10000) / 10000);
                }
              }}
            >{m.label}</button>
          ))}
        </div>
        <button type="button" className="icon-btn icon-btn--sm icon-btn--danger pos-card__remove"
          onClick={() => onRemove(index)} title="Remove">✕</button>
      </div>
      <div className="pos-card__body">
        <div className="pos-card__field">
          <label className="pos-card__label">Name</label>
          <input className="form-input" value={pos.name}
            onChange={e => onChange(index, 'name', e.target.value)}
            placeholder={mt === 'Idx' ? 'e.g. Index' : mt === 'Incr' ? 'e.g. Nudge' : 'e.g. Pick'} />
        </div>
        {mt === 'Idx' ? (
          <>
            <div className="pos-card__field pos-card__field--value">
              <label className="pos-card__label">Heads</label>
              <input className="form-input" type="number" min="2" max="360"
                value={heads}
                onChange={e => {
                  const h = Math.max(2, parseInt(e.target.value) || 2);
                  onChange(index, 'heads', h);
                  // Auto-compute angle from heads
                  onChange(index, 'defaultValue', Math.round((360 / h) * 10000) / 10000);
                }}
                style={{ width: 65 }} />
            </div>
            <div className="pos-card__field pos-card__field--value">
              <label className="pos-card__label">Angle</label>
              <div className="pos-card__value-row">
                <input className="form-input" type="number" step="any"
                  value={pos.defaultValue ?? computedAngle}
                  onChange={e => onChange(index, 'defaultValue', parseFloat(e.target.value) || 0)}
                  style={{ width: 75 }} />
                <span className="pos-card__unit">°</span>
              </div>
            </div>
          </>
        ) : (
          <div className="pos-card__field pos-card__field--value">
            <label className="pos-card__label">{meta.valueLabel}</label>
            <div className="pos-card__value-row">
              <input className="form-input" type="number"
                value={pos.defaultValue ?? 0}
                onChange={e => onChange(index, 'defaultValue', parseFloat(e.target.value) || 0)}
                style={{ width: 65 }} />
              <span className="pos-card__unit">{meta.unit}</span>
            </div>
          </div>
        )}
      </div>
      <div className="pos-card__options">
        {mt === 'Pos' && (
          <label className="pos-card__check">
            <input type="checkbox" checked={pos.isHome ?? false}
              onChange={e => onChange(index, 'isHome', e.target.checked)} />
            <span>Home</span>
          </label>
        )}
        {mt === 'Idx' && (
          <div style={{ fontSize: 11, color: '#64748b', padding: '2px 0' }}>
            {heads} heads × {computedAngle}° = 360°
          </div>
        )}
      </div>
    </div>
  );
}

// ── Copy From Existing Device ────────────────────────────────────────────────

function CopyFromExisting({ allSMs, currentSmId, selectedType, onPick }) {
  const [open, setOpen] = useState(false);

  // Filter devices to only match the currently selected type, group by SM
  const groups = allSMs
    .map(sm => ({
      smId: sm.id,
      smName: sm.displayName || sm.name || 'Unnamed SM',
      isCurrent: sm.id === currentSmId,
      devices: (sm.devices ?? []).filter(d => d.type === selectedType),
    }))
    .filter(g => g.devices.length > 0);

  if (groups.length === 0) return null;

  const totalCount = groups.reduce((n, g) => n + g.devices.length, 0);
  const typeLabel = DEVICE_TYPES[selectedType]?.label ?? selectedType;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        className="btn btn--secondary"
        style={{ width: '100%', fontSize: 13, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: 16 }}>⧉</span>
        {open ? 'Hide' : `Copy from existing ${typeLabel}`}
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5 }}>
          {totalCount} found {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="copy-device-list">
          {groups.map(g => (
            <div key={g.smId}>
              <div className="copy-device-list__header">
                {g.smName}{g.isCurrent ? ' (current)' : ''}
              </div>
              {g.devices.map(dev => (
                <button
                  key={dev.id}
                  type="button"
                  className="copy-device-list__item"
                  onClick={() => { onPick(dev); setOpen(false); }}
                >
                  <DeviceIcon type={dev.type} size={18} color={DEVICE_TYPES[dev.type]?.color ?? '#888'} />
                  <span className="copy-device-list__name">{dev.displayName || dev.name}</span>
                  <span className="copy-device-list__tag">{dev.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Modal Component ──────────────────────────────────────────────────────

export function AddDeviceModal() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const allSMs = store.project?.stateMachines ?? [];
  const isEdit = store.showEditDeviceModal;
  const editId = store.editDeviceId;
  const existingDevice = isEdit ? sm?.devices?.find(d => d.id === editId) : null;

  const [type, setType] = useState(existingDevice?.type ?? 'PneumaticLinearActuator');
  const [displayName, setDisplayName] = useState(existingDevice?.displayName ?? '');
  const [name, setName] = useState(existingDevice?.name ?? '');
  const [sensorArrangement, setSensorArrangement] = useState(
    existingDevice?.sensorArrangement ?? DEVICE_TYPES['PneumaticLinearActuator'].defaultSensorArrangement
  );
  const [axisNumber, setAxisNumber] = useState(existingDevice?.axisNumber ?? 1);
  const [motionType, setMotionType] = useState(existingDevice?.motionType ?? 'linear'); // 'linear' | 'rotary'
  const [positions, setPositions] = useState(
    (existingDevice?.positions ?? []).map(p => ({
      ...p,
      moveType: p.moveType ?? (p.type === 'incremental' ? 'Incr' : p.type === 'index' ? 'Idx' : 'Pos'),
    }))
  );
  const [speedProfiles, setSpeedProfiles] = useState(() => {
    const defaults = [
      { name: 'Slow', speed: 100, accel: 1000, decel: 1000 },
      { name: 'Fast', speed: 2500, accel: 25000, decel: 25000 },
    ];
    if (!existingDevice?.speedProfiles) return defaults;
    // Migrate: ensure Fast profile exists for old devices
    const existing = existingDevice.speedProfiles;
    if (!existing.find(p => p.name === 'Fast')) {
      existing.push({ name: 'Fast', speed: 2500, accel: 25000, decel: 25000 });
    }
    // Migrate: fix old Slow defaults (accel/decel were 5000)
    const slow = existing.find(p => p.name === 'Slow');
    if (slow && slow.accel === 5000 && slow.decel === 5000) {
      slow.accel = 1000;
      slow.decel = 1000;
    }
    return existing;
  });
  const [extTimerMs, setExtTimerMs] = useState(existingDevice?.extTimerMs ?? 500);
  const [retTimerMs, setRetTimerMs] = useState(existingDevice?.retTimerMs ?? 500);
  const [engageTimerMs, setEngageTimerMs] = useState(existingDevice?.engageTimerMs ?? 300);
  const [disengageTimerMs, setDisengageTimerMs] = useState(existingDevice?.disengageTimerMs ?? 300);
  const [vacOnTimerMs, setVacOnTimerMs] = useState(existingDevice?.vacOnTimerMs ?? 300);
  const [hasEject, setHasEject] = useState(existingDevice?.hasEject ?? false);
  const [timerMs, setTimerMs] = useState(existingDevice?.timerMs ?? 1000);
  const [homePosition, setHomePosition] = useState(
    existingDevice?.homePosition ?? DEVICE_TYPES['PneumaticLinearActuator'].defaultHomePosition
  );
  // Parameter-specific state
  const [dataType, setDataType] = useState(existingDevice?.dataType ?? 'boolean');
  const [paramScope, setParamScope] = useState(existingDevice?.paramScope ?? 'local');
  const [crossSmId, setCrossSmId] = useState(existingDevice?.crossSmId ?? '');
  const [paramType, setParamType] = useState(existingDevice?.paramType ?? 'latch');
  const [conditions, setConditions] = useState(existingDevice?.conditions ?? []);
  // Vision-specific state
  const [waitTimerMs, setWaitTimerMs] = useState(existingDevice?.waitTimerMs ?? 50);
  const [trigDwellMs, setTrigDwellMs] = useState(existingDevice?.trigDwellMs ?? 100);
  const [jobs, setJobs] = useState(existingDevice?.jobs ?? []);

  // Robot-specific: Fanuc-style I/O signals
  // DI  = PLC→Robot digital (PLC outputs, robot reads as DI[n])
  // DO  = Robot→PLC digital (robot writes DO[n], PLC reads as input)
  // Register = bidirectional DINT/REAL values (R[n])
  // Minimal user-facing defaults. ME only cares about interactions that
  // affect sequencing — "is the part gripped?", "is it safe to move into
  // the dial?". Standard handshake plumbing (program command, program done,
  // ack registers, auto-mode status, etc.) is handled automatically by the
  // Run_Robot_Seq AOI and R95 output copies — not exposed here.
  const DEFAULT_ROBOT_SIGNALS = [
    // DI — PLC→Robot interlocks
    { id: 'di_ok_enter_dial', number: 1, name: 'OkToEnterDial', group: 'DI', direction: 'output', dataType: 'BOOL', description: 'PLC permits robot to enter the dial' },
    // DO — Robot→PLC status the PLC waits on
    { id: 'do_part_grip',     number: 1, name: 'PartGrip',      group: 'DO', direction: 'input',  dataType: 'BOOL', description: 'Robot has gripped the part' },
  ];

  // Migrate old-format signals (pre-Fanuc model): add number if missing, convert DCS→DO
  function migrateRobotSignals(signals) {
    return signals.map((s, i) => ({
      ...s,
      number: s.number ?? (i + 1),
      group: s.group === 'DCS' ? 'DO' : s.group,
    }));
  }

  const [robotSignals, setRobotSignals] = useState(
    migrateRobotSignals(existingDevice?.signals ?? DEFAULT_ROBOT_SIGNALS)
  );

  // Robot sequences (programs the robot can run — PLC sends number, waits for done)
  const DEFAULT_ROBOT_SEQUENCES = [
    { id: 'seq_1', number: 1, name: 'Home',  description: 'Move to home / perch position' },
    { id: 'seq_2', number: 2, name: 'Pick',  description: 'Pick part from nest' },
    { id: 'seq_3', number: 3, name: 'Place', description: 'Place part at target' },
  ];
  const [robotSequences, setRobotSequences] = useState(
    existingDevice?.sequences ?? DEFAULT_ROBOT_SEQUENCES
  );
  function addRobotSequence() {
    const nextNum = robotSequences.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;
    setRobotSequences(prev => [...prev, {
      id: `seq_${Date.now()}`,
      number: nextNum,
      name: '',
      description: '',
    }]);
  }
  function updateRobotSequence(index, field, value) {
    setRobotSequences(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }
  function removeRobotSequence(index) {
    setRobotSequences(prev => prev.filter((_, i) => i !== index));
  }

  function addRobotSignal(group = 'DO') {
    // Auto-assign next available number for this group
    const groupSigs = robotSignals.filter(s => s.group === group);
    const maxNum = groupSigs.reduce((max, s) => Math.max(max, s.number || 0), 0);
    setRobotSignals(prev => [...prev, {
      id: `sig_${Date.now()}`,
      number: maxNum + 1,
      name: '',
      group,
      direction: (group === 'DI' || (group === 'Register')) ? 'output' : 'input',
      dataType: group === 'Register' ? 'DINT' : 'BOOL',
      description: '',
    }]);
  }

  function updateRobotSignal(index, field, value) {
    setRobotSignals(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const updated = { ...s, [field]: value };
      // Auto-set direction and dataType when group changes
      if (field === 'group') {
        updated.direction = value === 'DI' ? 'output' : value === 'DO' ? 'input' : updated.direction;
        if (value === 'Register') updated.dataType = updated.dataType === 'BOOL' ? 'DINT' : updated.dataType;
        else updated.dataType = 'BOOL';
      }
      return updated;
    }));
  }

  function removeRobotSignal(index) {
    setRobotSignals(prev => prev.filter((_, i) => i !== index));
  }

  // Analog sensor-specific: setpoints with range
  const isAnalog = type === 'AnalogSensor';
  const [sensorUnit, setSensorUnit] = useState(existingDevice?.sensorUnit ?? 'mm');
  const [setpoints, setSetpoints] = useState(existingDevice?.setpoints ?? []);

  function addSetpoint() {
    setSetpoints(prev => [...prev, { name: `Check${prev.length + 1}`, nominal: 0, tolerance: 0.5, lowLimit: -0.5, highLimit: 0.5 }]);
  }

  function updateSetpoint(index, field, value) {
    setSetpoints(prev => prev.map((sp, i) => {
      if (i !== index) return sp;
      const updated = { ...sp, [field]: value };
      // Auto-calc limits from nominal + tolerance
      if (field === 'nominal' || field === 'tolerance') {
        const nom = field === 'nominal' ? parseFloat(value) || 0 : parseFloat(updated.nominal) || 0;
        const tol = field === 'tolerance' ? parseFloat(value) || 0 : parseFloat(updated.tolerance) || 0;
        updated.lowLimit = nom - tol;
        updated.highLimit = nom + tol;
      }
      return updated;
    }));
  }

  function removeSetpoint(index) {
    setSetpoints(prev => prev.filter((_, i) => i !== index));
  }

  // Conveyor-specific state
  const [driveType, setDriveType] = useState(existingDevice?.driveType ?? 'VFD');
  const [bidirectional, setBidirectional] = useState(existingDevice?.bidirectional ?? false);
  const [hasSpeedControl, setHasSpeedControl] = useState(existingDevice?.hasSpeedControl ?? true);

  // Custom device state
  const [customTypeDef, setCustomTypeDef] = useState(existingDevice?.customTypeDef ?? { outputs: [], inputs: [], operations: [], complementPairs: [], analogIO: [] });
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  // Sensor checkboxes — derived from sensorArrangement
  const isPneumatic = ['PneumaticLinearActuator', 'PneumaticRotaryActuator'].includes(type);
  const isGripper = type === 'PneumaticGripper';
  const isVac = type === 'PneumaticVacGenerator';
  const isServo = type === 'ServoAxis';
  const isTimer = type === 'Timer';
  const isParameter = type === 'Parameter';
  const isVision = type === 'VisionSystem';
  const isRobot = type === 'Robot';
  const isConveyor = type === 'Conveyor';
  const isCustom = type === 'Custom';

  const linearParsed = parseLinearConfig(sensorArrangement);
  const gripperParsed = parseGripperConfig(sensorArrangement);

  const [hasExtSensor, setHasExtSensor] = useState(linearParsed.hasExt);
  const [hasRetSensor, setHasRetSensor] = useState(linearParsed.hasRet);
  const [hasEngSensor, setHasEngSensor] = useState(gripperParsed.hasEng);
  const [hasDisSensor, setHasDisSensor] = useState(gripperParsed.hasDis);

  // Sync checkboxes → sensorArrangement string
  useEffect(() => {
    if (isPneumatic) {
      setSensorArrangement(linearConfigFromChecks(hasExtSensor, hasRetSensor));
    }
  }, [hasExtSensor, hasRetSensor, isPneumatic]);

  useEffect(() => {
    if (isGripper) {
      setSensorArrangement(gripperConfigFromChecks(hasEngSensor, hasDisSensor));
    }
  }, [hasEngSensor, hasDisSensor, isGripper]);

  // Auto-generate PLC name from display name
  useEffect(() => {
    if (!isEdit || !existingDevice) {
      const generated = displayName.replace(/[^a-zA-Z0-9]/g, '');
      setName(generated);
    }
  }, [displayName]);

  function handleTypeChange(newType) {
    setType(newType);
    const defaultArr = DEVICE_TYPES[newType]?.defaultSensorArrangement ?? '';
    setSensorArrangement(defaultArr);
    setPositions([]);
    // Reset home position for new type
    setHomePosition(DEVICE_TYPES[newType]?.defaultHomePosition ?? '');
    // Reset checkboxes for new type
    const lp = parseLinearConfig(defaultArr);
    setHasExtSensor(lp.hasExt);
    setHasRetSensor(lp.hasRet);
    const gp = parseGripperConfig(defaultArr);
    setHasEngSensor(gp.hasEng);
    setHasDisSensor(gp.hasDis);
    // Reset custom device def when switching away
    if (newType !== 'Custom') {
      setCustomTypeDef({ outputs: [], inputs: [], operations: [], complementPairs: [], analogIO: [] });
    }
  }

  function addSpeedProfile() {
    setSpeedProfiles(prev => [...prev, { name: '', speed: 100, accel: 5000, decel: 5000 }]);
  }

  function updateSpeedProfile(index, field, value) {
    setSpeedProfiles(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  }

  function removeSpeedProfile(index) {
    setSpeedProfiles(prev => prev.filter((_, i) => i !== index));
  }

  function addJob() {
    const jobName = `Job${jobs.length + 1}`;
    setJobs(prev => [...prev, { name: jobName, outcomes: [`Pass_${jobName}`, `Fail_${jobName}`] }]);
  }

  function updateJob(index, field, value) {
    setJobs(prev => prev.map((j, i) => i === index ? { ...j, [field]: value } : j));
  }

  function removeJob(index) {
    setJobs(prev => prev.filter((_, i) => i !== index));
  }

  function addPosition() {
    setPositions(prev => [...prev, { name: '', defaultValue: 0, moveType: 'Pos', isHome: false, isRecipe: false }]);
  }

  function updatePosition(index, field, value) {
    setPositions(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  }

  function removePosition(index) {
    setPositions(prev => prev.filter((_, i) => i !== index));
  }

  function handleClose() {
    if (isEdit) store.closeEditDeviceModal();
    else store.closeAddDeviceModal();
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!displayName.trim() || !name.trim()) return;
    if (!sm) return;

    const deviceData = {
      type,
      displayName: displayName.trim(),
      name: name.trim(),
      sensorArrangement,
      homePosition: DEVICE_TYPES[type]?.homePositions ? homePosition : undefined,
      axisNumber: Number(axisNumber) || 1,
      motionType: type === 'ServoAxis' ? motionType : undefined,
      positions: type === 'ServoAxis' ? positions.map(p => ({
        ...p,
        type: p.moveType === 'Incr' ? 'incremental' : p.moveType === 'Idx' ? 'index' : 'position',
      })) : undefined,
      speedProfiles: type === 'ServoAxis' ? speedProfiles : undefined,
      // Vision-specific
      waitTimerMs: isVision ? Number(waitTimerMs) : undefined,
      trigDwellMs: isVision ? Number(trigDwellMs) : undefined,
      jobs: isVision ? jobs : undefined,
      extTimerMs: Number(extTimerMs),
      retTimerMs: Number(retTimerMs),
      engageTimerMs: Number(engageTimerMs),
      disengageTimerMs: Number(disengageTimerMs),
      vacOnTimerMs: Number(vacOnTimerMs),
      hasEject,
      timerMs: Number(timerMs),
      // Parameter-specific
      dataType:   isParameter ? dataType : undefined,
      paramScope: isParameter ? paramScope : undefined,
      paramType:  isParameter ? paramType : undefined,
      conditions: isParameter && paramType === 'conditional' ? conditions : undefined,
      crossSmId:  undefined,
      // Analog sensor-specific
      sensorUnit: isAnalog ? sensorUnit : undefined,
      setpoints: isAnalog ? setpoints : undefined,
      // Robot-specific
      signals:   isRobot ? robotSignals.filter(s => s.name.trim())   : undefined,
      sequences: isRobot ? robotSequences.filter(s => s.name?.trim()) : undefined,
      // Conveyor-specific
      driveType: isConveyor ? driveType : undefined,
      bidirectional: isConveyor ? bidirectional : undefined,
      hasSpeedControl: isConveyor ? hasSpeedControl : undefined,
      // Custom device definition (denormalized for portability)
      customTypeDef: isCustom ? customTypeDef : undefined,
    };

    if (isEdit && editId) {
      store.updateDevice(sm.id, editId, deviceData);
    } else {
      store.addDevice(sm.id, deviceData);
    }

    handleClose();
  }

  const typeInfo = DEVICE_TYPES[type];

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" style={{ width: isServo ? 720 : (isRobot || isCustom) ? 640 : 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal__header">
          <span>{isEdit ? 'Edit Subject' : 'Add Subject'}</span>
          <button className="icon-btn" onClick={handleClose}>✕</button>
        </div>

        <form className="modal__body" onSubmit={handleSubmit}>

          {/* Subject Type Grid with SVG icons */}
          {!isEdit && (
            <>
              <label className="form-label">Subject Type *</label>
              <div className="device-type-grid">
                {Object.entries(DEVICE_TYPES).map(([key, info]) => (
                  <button
                    key={key}
                    type="button"
                    className={`device-type-card${type === key ? ' device-type-card--selected' : ''}`}
                    style={{ '--card-color': info.color }}
                    onClick={() => handleTypeChange(key)}
                  >
                    <span className="device-type-card__icon">
                      <DeviceIcon type={key} size={28} color="currentColor" />
                    </span>
                    <span className="device-type-card__label">{info.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Copy from existing device of same type */}
          {!isEdit && type && (
            <CopyFromExisting allSMs={allSMs} currentSmId={sm?.id} selectedType={type} onPick={(dev) => {
              // Pre-fill config but clear names so user gives unique identity
              setDisplayName('');
              setName('');
              setSensorArrangement(dev.sensorArrangement ?? 'both');
              setHomePosition(dev.homePosition ?? 'retracted');
              setAxisNumber(dev.axisNumber ?? 1);
              setMotionType(dev.motionType ?? 'linear');
              setPositions((dev.positions ?? []).map(p => ({
                ...p,
                moveType: p.moveType ?? (p.type === 'incremental' ? 'Incr' : p.type === 'index' ? 'Idx' : 'Pos'),
              })));
              if (dev.speedProfiles) setSpeedProfiles(dev.speedProfiles);
              setExtTimerMs(dev.extTimerMs ?? 500);
              setRetTimerMs(dev.retTimerMs ?? 500);
              setEngageTimerMs(dev.engageTimerMs ?? 300);
              setDisengageTimerMs(dev.disengageTimerMs ?? 300);
              setVacOnTimerMs(dev.vacOnTimerMs ?? 300);
              setHasEject(dev.hasEject ?? false);
              setTimerMs(dev.timerMs ?? 1000);
              if (dev.jobs) setJobs(dev.jobs);
              if (dev.signals) setRobotSignals(dev.signals);
              if (dev.sequences) setRobotSequences(dev.sequences);
              if (dev.setpoints) setSetpoints(dev.setpoints);
              setDataType(dev.dataType ?? 'boolean');
              setParamScope(dev.paramScope ?? 'local');
              setParamType(dev.paramType ?? 'latch');
            }} />
          )}

          {isEdit && (
            <div className="props-info-box">
              <div className="props-info-box__label">Type</div>
              <div className="props-info-box__value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DeviceIcon type={type} size={22} />
                {typeInfo?.label}
              </div>
            </div>
          )}

          {/* Display Name */}
          <label className="form-label">Subject Name *</label>
          <input
            className="form-input"
            autoFocus={!isEdit}
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={`e.g. Post Cutter Cylinder`}
          />
          <div className="form-hint">Plain English name as seen by the ME</div>

          {/* PLC Tag Name */}
          <label className="form-label">PLC Tag Stem *</label>
          <input
            className="form-input mono"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. PostCutterCylinder"
          />
          <div className="form-hint">PascalCase, no spaces — used in all generated tag names</div>

          {/* Home Position selector — shown for devices with fixed home positions (not servo) */}
          {Array.isArray(DEVICE_TYPES[type]?.homePositions) && (
            <>
              <label className="form-label">Home Position *</label>
              <select
                className="form-select"
                value={homePosition}
                onChange={e => setHomePosition(e.target.value)}
              >
                {(Array.isArray(DEVICE_TYPES[type].homePositions) ? DEVICE_TYPES[type].homePositions : []).map(hp => (
                  <option key={hp.value} value={hp.value}>{hp.label}</option>
                ))}
              </select>
              <div className="form-hint">Default position when station is in home/wait state</div>
            </>
          )}

          {/* Sensor checkboxes for pneumatic linear/rotary — Retract first (home position) */}
          {isPneumatic && (
            <>
              <label className="form-label">Sensors</label>
              <div className="sensor-checkbox-group">
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={hasRetSensor}
                    onChange={e => setHasRetSensor(e.target.checked)}
                  />
                  <span>Retract sensor</span>
                </label>
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={hasExtSensor}
                    onChange={e => setHasExtSensor(e.target.checked)}
                  />
                  <span>Extend sensor</span>
                </label>
              </div>
              <div className="form-hint sensor-cb-hint">
                Directions without a sensor use a delay timer instead
              </div>
            </>
          )}

          {/* Sensor checkboxes for gripper */}
          {isGripper && (
            <>
              <label className="form-label">Sensors</label>
              <div className="sensor-checkbox-group">
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={hasEngSensor}
                    onChange={e => setHasEngSensor(e.target.checked)}
                  />
                  <span>Engage sensor</span>
                </label>
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={hasDisSensor}
                    onChange={e => setHasDisSensor(e.target.checked)}
                  />
                  <span>Disengage sensor</span>
                </label>
              </div>
              <div className="form-hint sensor-cb-hint">
                Directions without a sensor will use a delay timer for verification
              </div>
            </>
          )}

          {/* Timer presets — only shown/enabled for directions WITHOUT a sensor */}
          {isPneumatic && (!hasRetSensor || !hasExtSensor) && (
            <div className="form-row-2">
              <div>
                <label className="form-label" style={hasRetSensor ? { opacity: 0.4 } : {}}>
                  Retract Verify Timer (ms)
                </label>
                <input className="form-input" type="number" min="0" step="1" value={retTimerMs}
                  onChange={e => setRetTimerMs(e.target.value)}
                  disabled={hasRetSensor}
                  style={hasRetSensor ? { opacity: 0.4 } : {}}
                  title={hasRetSensor ? 'Not needed — retract sensor handles verification' : ''}
                />
              </div>
              <div>
                <label className="form-label" style={hasExtSensor ? { opacity: 0.4 } : {}}>
                  Extend Verify Timer (ms)
                </label>
                <input className="form-input" type="number" min="0" step="1" value={extTimerMs}
                  onChange={e => setExtTimerMs(e.target.value)}
                  disabled={hasExtSensor}
                  style={hasExtSensor ? { opacity: 0.4 } : {}}
                  title={hasExtSensor ? 'Not needed — extend sensor handles verification' : ''}
                />
              </div>
            </div>
          )}

          {isGripper && (!hasEngSensor || !hasDisSensor) && (
            <div className="form-row-2">
              <div>
                <label className="form-label" style={hasEngSensor ? { opacity: 0.4 } : {}}>
                  Engage Timer (ms)
                </label>
                <input className="form-input" type="number" min="0" step="1" value={engageTimerMs}
                  onChange={e => setEngageTimerMs(e.target.value)}
                  disabled={hasEngSensor}
                  style={hasEngSensor ? { opacity: 0.4 } : {}}
                />
              </div>
              <div>
                <label className="form-label" style={hasDisSensor ? { opacity: 0.4 } : {}}>
                  Disengage Timer (ms)
                </label>
                <input className="form-input" type="number" min="0" step="1" value={disengageTimerMs}
                  onChange={e => setDisengageTimerMs(e.target.value)}
                  disabled={hasDisSensor}
                  style={hasDisSensor ? { opacity: 0.4 } : {}}
                />
              </div>
            </div>
          )}

          {isVac && (
            <>
              <label className="form-label">Vac On Verify Timer (ms)</label>
              <input className="form-input" type="number" min="0" step="1" value={vacOnTimerMs}
                onChange={e => setVacOnTimerMs(e.target.value)} />
              <label className="form-checkbox-row">
                <input type="checkbox" checked={hasEject}
                  onChange={e => setHasEject(e.target.checked)} />
                <span>Has Eject (blow-off) solenoid</span>
              </label>
            </>
          )}

          {isTimer && (
            <>
              <label className="form-label">Default Delay (ms)</label>
              <input className="form-input" type="number" min="0" step="1" value={timerMs}
                onChange={e => setTimerMs(e.target.value)} />
            </>
          )}

          {/* Vision System: timers + jobs */}
          {isVision && (
            <>
              <div className="form-row-2">
                <div>
                  <label className="form-label">Wait Timer (ms)</label>
                  <input className="form-input" type="number" min="0" step="10" value={waitTimerMs}
                    onChange={e => setWaitTimerMs(e.target.value)} />
                  <div className="form-hint">Dwell after trigger ready, before trigger</div>
                </div>
                <div>
                  <label className="form-label">Trigger Dwell (ms)</label>
                  <input className="form-input" type="number" min="0" step="10" value={trigDwellMs}
                    onChange={e => setTrigDwellMs(e.target.value)} />
                  <div className="form-hint">Hold after trigger, before next state</div>
                </div>
              </div>

              <div className="props-actions-header" style={{ marginTop: 8 }}>
                <span className="form-label" style={{ marginBottom: 0 }}>Jobs</span>
                <button type="button" className="btn btn--xs btn--primary" onClick={addJob}>
                  + Add Job
                </button>
              </div>
              <div className="form-hint">Each outcome becomes a global parameter (e.g. q_Pass_FindStamp)</div>

              {jobs.length === 0 && (
                <div className="props-empty">No jobs yet. Click + Add Job.</div>
              )}
              {jobs.map((job, i) => (
                <VisionJobRow
                  key={i}
                  job={job}
                  index={i}
                  onChange={updateJob}
                  onRemove={removeJob}
                />
              ))}

              <div className="form-hint" style={{ marginTop: 4, fontSize: 11, color: '#6b7280' }}>
                Sequence: Verify Trig Ready → Wait ({waitTimerMs}ms) → Trigger → Check Results → Branch
              </div>
            </>
          )}

          {/* Analog Sensor: setpoints with range */}
          {isAnalog && (
            <>
              <label className="form-label" style={{ marginTop: 8 }}>Sensor Unit</label>
              <div className="btn-group" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['mm', 'in', 'psi', 'bar', 'N', 'lbs', 'V', 'mA', '°C', '°F', 'custom'].map(u => (
                  <button key={u} type="button"
                    className={`btn btn--xs ${sensorUnit === u ? 'btn--primary' : 'btn--secondary'}`}
                    onClick={() => setSensorUnit(u)}
                  >{u}</button>
                ))}
              </div>

              <div className="props-actions-header" style={{ marginTop: 12 }}>
                <span className="form-label" style={{ marginBottom: 0 }}>Setpoints / Range Checks</span>
                <button type="button" className="btn btn--xs btn--primary" onClick={addSetpoint}>
                  + Add Setpoint
                </button>
              </div>
              <div className="form-hint">Each setpoint defines a range check — nominal value ± tolerance. Available as conditions in decision/wait nodes.</div>

              {setpoints.length === 0 && (
                <div className="props-empty">No setpoints yet. Click + Add Setpoint.</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {setpoints.map((sp, i) => (
                  <div key={i} style={{
                    background: '#f8fafc',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <input
                        className="form-input"
                        value={sp.name}
                        onChange={e => updateSetpoint(i, 'name', e.target.value)}
                        placeholder="Setpoint name"
                        style={{ fontSize: 13, fontWeight: 600 }}
                      />
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm icon-btn--danger"
                        onClick={() => removeSetpoint(i)}
                        title="Remove setpoint"
                      >✕</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <div>
                        <label className="form-label" style={{ fontSize: 11 }}>Nominal ({sensorUnit})</label>
                        <input className="form-input" type="number" step="any"
                          value={sp.nominal}
                          onChange={e => updateSetpoint(i, 'nominal', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: 11 }}>Tolerance (±{sensorUnit})</label>
                        <input className="form-input" type="number" step="any" min="0"
                          value={sp.tolerance}
                          onChange={e => updateSetpoint(i, 'tolerance', e.target.value)}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                      Range: {sp.lowLimit?.toFixed(3)} — {sp.highLimit?.toFixed(3)} {sensorUnit}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Robot: Sequences (programs the robot runs — PLC sends number, waits for done) */}
          {isRobot && (
            <>
              <div style={{ marginTop: 12 }}>
                <div className="props-actions-header">
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>Sequences — Robot Programs</span>
                  <button type="button" className="btn btn--xs btn--primary" onClick={addRobotSequence}>
                    + Add
                  </button>
                </div>
                <div className="form-hint" style={{ marginTop: 0 }}>
                  Programs the robot runs on command. PLC writes sequence number → robot echoes → robot runs program → robot signals complete.
                </div>
                {robotSequences.length === 0 && (
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0', fontStyle: 'italic' }}>
                    No sequences — add at least Home / Pick / Place
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                  {robotSequences.map((seq, idx) => (
                    <div key={seq.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '54px 140px 1fr auto',
                      gap: 5,
                      alignItems: 'center',
                      background: '#faf5ff',
                      padding: '4px 6px',
                      borderRadius: 5,
                      border: '1px solid #e9d5ff',
                      borderLeftWidth: 3,
                      borderLeftColor: '#7c3aed',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>#</span>
                        <input
                          className="form-input"
                          type="number"
                          min="1"
                          value={seq.number ?? ''}
                          onChange={e => updateRobotSequence(idx, 'number', Number(e.target.value) || 1)}
                          style={{ width: 38, fontSize: 11, padding: '2px 3px', textAlign: 'center' }}
                        />
                      </div>
                      <input
                        className="form-input"
                        value={seq.name}
                        onChange={e => updateRobotSequence(idx, 'name', e.target.value)}
                        placeholder="Name (e.g. Pick)"
                        style={{ fontSize: 12 }}
                      />
                      <input
                        className="form-input"
                        value={seq.description ?? ''}
                        onChange={e => updateRobotSequence(idx, 'description', e.target.value)}
                        placeholder="Description (optional)"
                        style={{ fontSize: 11, color: '#475569' }}
                      />
                      <button type="button"
                        className="icon-btn icon-btn--sm icon-btn--danger"
                        onClick={() => removeRobotSequence(idx)}
                        title="Remove sequence"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Robot: Fanuc-style I/O configuration — DI / DO / Registers */}
          {isRobot && (
            <>
              {[
                { key: 'DI',       label: 'DI — Digital Inputs to Robot',      hint: 'PLC writes these → Robot reads as DI[n]. Commands and interlocks.', color: '#2563eb', prefix: 'DI', showDir: false },
                { key: 'DO',       label: 'DO — Digital Outputs from Robot',    hint: 'Robot writes DO[n] → PLC reads. Status, program done, reference positions.', color: '#16a34a', prefix: 'DO', showDir: false },
                { key: 'Register', label: 'R — Data Registers',                hint: 'Bidirectional DINT/REAL values. Program command, speed override, acknowledge.', color: '#d97706', prefix: 'R', showDir: true },
              ].map(grp => {
                const groupSigs = robotSignals.map((s, origIdx) => ({ ...s, _idx: origIdx })).filter(s => s.group === grp.key);
                return (
                  <div key={grp.key} style={{ marginTop: 12 }}>
                    <div className="props-actions-header">
                      <span style={{ fontSize: 12, fontWeight: 700, color: grp.color }}>{grp.label}</span>
                      <button type="button" className="btn btn--xs btn--primary" onClick={() => addRobotSignal(grp.key)}>
                        + Add
                      </button>
                    </div>
                    <div className="form-hint" style={{ marginTop: 0 }}>{grp.hint}</div>

                    {groupSigs.length === 0 && (
                      <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0', fontStyle: 'italic' }}>No signals</div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {groupSigs.map(sig => (
                        <div key={sig.id} style={{
                          display: 'grid',
                          gridTemplateColumns: grp.showDir ? '52px 1fr 65px 65px auto' : '52px 1fr auto',
                          gap: 5,
                          alignItems: 'center',
                          background: '#f8fafc',
                          padding: '4px 6px',
                          borderRadius: 5,
                          border: '1px solid #e2e8f0',
                          borderLeftWidth: 3,
                          borderLeftColor: grp.color,
                        }}>
                          {/* Fanuc number */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 10, color: grp.color, fontWeight: 700 }}>{grp.prefix}[</span>
                            <input
                              className="form-input"
                              type="number"
                              min="1"
                              value={sig.number ?? ''}
                              onChange={e => updateRobotSignal(sig._idx, 'number', Number(e.target.value) || 1)}
                              style={{ width: 32, fontSize: 11, padding: '2px 3px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: 10, color: grp.color, fontWeight: 700 }}>]</span>
                          </div>
                          {/* Signal name */}
                          <input
                            className="form-input"
                            value={sig.name}
                            onChange={e => updateRobotSignal(sig._idx, 'name', e.target.value)}
                            placeholder="Signal name"
                            style={{ fontSize: 12 }}
                          />
                          {/* Register-only: direction + data type */}
                          {grp.showDir && (
                            <>
                              <select
                                className="form-input"
                                value={sig.direction}
                                onChange={e => updateRobotSignal(sig._idx, 'direction', e.target.value)}
                                style={{ fontSize: 11 }}
                              >
                                <option value="output">PLC→R</option>
                                <option value="input">R→PLC</option>
                              </select>
                              <select
                                className="form-input"
                                value={sig.dataType}
                                onChange={e => updateRobotSignal(sig._idx, 'dataType', e.target.value)}
                                style={{ fontSize: 11 }}
                              >
                                <option value="DINT">DINT</option>
                                <option value="REAL">REAL</option>
                              </select>
                            </>
                          )}
                          <button
                            type="button"
                            className="icon-btn icon-btn--sm icon-btn--danger"
                            onClick={() => removeRobotSignal(sig._idx)}
                            title="Remove signal"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Conveyor: drive configuration */}
          {isConveyor && (
            <>
              <label className="form-label" style={{ marginTop: 8 }}>Drive Type</label>
              <div className="btn-group" style={{ display: 'flex', gap: 6 }}>
                <button type="button"
                  className={`btn btn--sm ${driveType === 'VFD' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => { setDriveType('VFD'); setHasSpeedControl(true); }}
                >VFD</button>
                <button type="button"
                  className={`btn btn--sm ${driveType === 'Starter' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => { setDriveType('Starter'); setHasSpeedControl(false); }}
                >Motor Starter</button>
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={bidirectional} onChange={e => setBidirectional(e.target.checked)} />
                  Bidirectional
                </label>
                {driveType === 'VFD' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={hasSpeedControl} onChange={e => setHasSpeedControl(e.target.checked)} />
                    Speed Control
                  </label>
                )}
              </div>
              <div className="form-hint">
                {driveType === 'VFD' ? 'Variable Frequency Drive — speed + direction control' : 'Simple motor starter — run/stop only'}
              </div>
            </>
          )}

          {/* Custom Device Configurator */}
          {isCustom && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <label className="form-label" style={{ margin: 0 }}>Custom Device Definition</label>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowLibraryPicker(true)}>
                  Load from Library
                </button>
              </div>
              <CustomDeviceConfigurator
                value={customTypeDef}
                onChange={setCustomTypeDef}
              />
              {customTypeDef.operations?.length > 0 && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const def = { ...customTypeDef, label: displayName || 'Custom Device', icon: '🔧' };
                    saveToLibrary(def);
                    alert('Saved to device library!');
                  }}
                >
                  Save to Library
                </button>
              )}
              {showLibraryPicker && (
                <DeviceLibraryPicker
                  onSelect={(def) => {
                    setCustomTypeDef(def);
                    if (def.label && !displayName) setDisplayName(def.label);
                  }}
                  onClose={() => setShowLibraryPicker(false)}
                />
              )}
            </>
          )}

          {/* Parameter: data type + scope */}
          {isParameter && (
            <>
              <label className="form-label">Data Type *</label>
              <div className="btn-group" style={{ display: 'flex', gap: 6 }}>
                <button type="button"
                  className={`btn btn--sm ${dataType === 'boolean' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => setDataType('boolean')}
                >Boolean (On/Off)</button>
                <button type="button"
                  className={`btn btn--sm ${dataType === 'numeric' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => setDataType('numeric')}
                >Numeric (REAL)</button>
              </div>
              <div className="form-hint">Boolean for on/off flags; Numeric for recipe values</div>

              <label className="form-label" style={{ marginTop: 10 }}>Scope *</label>
              <div className="btn-group" style={{ display: 'flex', gap: 6 }}>
                <button type="button"
                  className={`btn btn--sm ${paramScope === 'local' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => setParamScope('local')}
                >Local</button>
                <button type="button"
                  className={`btn btn--sm ${paramScope === 'global' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => setParamScope('global')}
                >Global</button>
              </div>
              <div className="form-hint">
                Local: only used within this state machine.&nbsp;
                Global: visible to other state machines in this project.
              </div>

              <label className="form-label" style={{ marginTop: 10 }}>Parameter Type *</label>
              <div className="btn-group" style={{ display: 'flex', gap: 6 }}>
                <button type="button"
                  className={`btn btn--sm ${paramType === 'latch' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => setParamType('latch')}
                >Latch</button>
                <button type="button"
                  className={`btn btn--sm ${paramType === 'conditional' ? 'btn--primary' : 'btn--secondary'}`}
                  onClick={() => { setParamType('conditional'); setDataType('boolean'); }}
                >Conditional</button>
              </div>
              <div className="form-hint">
                {paramType === 'latch'
                  ? 'Latch: explicitly set ON/OFF via actions in the sequence (OTL/OTU).'
                  : 'Conditional: automatically ON when all conditions are true. PLC evaluates every scan.'}
              </div>

              {paramType === 'conditional' && (() => {
                // Gather all devices from all SMs for condition source picking
                const allDevices = allSMs.flatMap(s =>
                  (s.devices ?? []).map(d => ({ ...d, _smId: s.id, _smName: s.name }))
                );
                const servoDevices = allDevices.filter(d => d.type === 'ServoAxis');
                const sensorDevices = allDevices.filter(d => d.type === 'DigitalSensor');
                const paramDevices = allDevices.filter(d => d.type === 'Parameter' && d.id !== editId);
                const ptFields = store.project?.partTracking?.fields ?? [];

                function addCondition() {
                  setConditions(prev => [...prev, { sourceType: '', sourceId: '', field: '', operator: '==', value: '' }]);
                }
                function updateCondition(idx, updates) {
                  setConditions(prev => prev.map((c, i) => i === idx ? { ...c, ...updates } : c));
                }
                function removeCondition(idx) {
                  setConditions(prev => prev.filter((_, i) => i !== idx));
                }

                return (
                  <div style={{ marginTop: 12 }}>
                    <div className="servo-section-header" style={{ background: '#ffde51', color: '#333' }}>
                      CONDITIONS
                      <span style={{ float: 'right', cursor: 'pointer', fontSize: 13 }} onClick={addCondition}>+ Add Condition</span>
                    </div>
                    <div style={{ padding: '8px 0' }}>
                      {conditions.length === 0 && (
                        <div className="form-hint" style={{ textAlign: 'center', padding: 12 }}>
                          No conditions yet. Click "+ Add Condition" to define when this parameter is ON.
                        </div>
                      )}
                      {conditions.map((cond, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', marginBottom: 6,
                          border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafbfc', position: 'relative' }}>
                          <button onClick={() => removeCondition(idx)}
                            style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none',
                              cursor: 'pointer', fontSize: 14, color: '#999' }}>✕</button>

                          {/* Source type */}
                          <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
                            value={cond.sourceType}
                            onChange={e => updateCondition(idx, { sourceType: e.target.value, sourceId: '', field: '', value: '' })}>
                            <option value="">-- Pick source type --</option>
                            {servoDevices.length > 0 && <option value="servo">Servo Axis</option>}
                            {sensorDevices.length > 0 && <option value="sensor">Digital Sensor</option>}
                            {paramDevices.length > 0 && <option value="parameter">Parameter</option>}
                            {ptFields.length > 0 && <option value="partTracking">Part Tracking</option>}
                          </select>

                          {/* Source device */}
                          {cond.sourceType === 'servo' && (
                            <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
                              value={cond.sourceId}
                              onChange={e => {
                                const dev = servoDevices.find(d => d.id === e.target.value);
                                updateCondition(idx, { sourceId: e.target.value, sourceName: dev?.displayName, field: '', value: '' });
                              }}>
                              <option value="">-- Pick servo --</option>
                              {servoDevices.map(d => (
                                <option key={d.id} value={d.id}>{d.displayName} ({d._smName})</option>
                              ))}
                            </select>
                          )}
                          {cond.sourceType === 'sensor' && (
                            <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
                              value={cond.sourceId}
                              onChange={e => {
                                const dev = sensorDevices.find(d => d.id === e.target.value);
                                updateCondition(idx, { sourceId: e.target.value, sourceName: dev?.displayName, field: 'state', value: 'ON' });
                              }}>
                              <option value="">-- Pick sensor --</option>
                              {sensorDevices.map(d => (
                                <option key={d.id} value={d.id}>{d.displayName} ({d._smName})</option>
                              ))}
                            </select>
                          )}
                          {cond.sourceType === 'parameter' && (
                            <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
                              value={cond.sourceId}
                              onChange={e => {
                                const dev = paramDevices.find(d => d.id === e.target.value);
                                updateCondition(idx, { sourceId: e.target.value, sourceName: dev?.displayName, field: 'state', value: 'ON' });
                              }}>
                              <option value="">-- Pick parameter --</option>
                              {paramDevices.map(d => (
                                <option key={d.id} value={d.id}>{d.displayName} ({d._smName})</option>
                              ))}
                            </select>
                          )}
                          {cond.sourceType === 'partTracking' && (
                            <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
                              value={cond.sourceId}
                              onChange={e => updateCondition(idx, { sourceId: e.target.value, sourceName: e.target.value, field: 'state', value: 'SUCCESS' })}>
                              <option value="">-- Pick field --</option>
                              {ptFields.map(f => (
                                <option key={f.name} value={f.name}>{f.name}</option>
                              ))}
                            </select>
                          )}

                          {/* Servo field picker */}
                          {cond.sourceType === 'servo' && cond.sourceId && (() => {
                            const dev = servoDevices.find(d => d.id === cond.sourceId);
                            const positions = dev?.positions ?? [];
                            return (
                              <>
                                <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
                                  value={cond.field}
                                  onChange={e => updateCondition(idx, { field: e.target.value, value: e.target.value === 'motionComplete' || e.target.value === 'inPosition' ? 'ON' : '' })}>
                                  <option value="">-- Pick condition --</option>
                                  <option value="motionComplete">Motion Complete (MC)</option>
                                  <option value="inPosition">In Position</option>
                                  {positions.map(p => (
                                    <option key={p.name} value={`pos:${p.name}`}>At Position: {p.name} ({p.defaultValue}mm)</option>
                                  ))}
                                </select>
                                {cond.field?.startsWith('pos:') && (
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                                    <span>± Tolerance</span>
                                    <input type="number" step="0.1" style={{ width: 60, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db' }}
                                      value={cond.tolerance ?? 1} onChange={e => updateCondition(idx, { tolerance: Number(e.target.value) })} />
                                    <span>mm</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}

                          {/* Sensor/param/PT value */}
                          {(cond.sourceType === 'sensor' || cond.sourceType === 'parameter') && cond.sourceId && (
                            <div className="btn-group" style={{ display: 'flex', gap: 6 }}>
                              <button type="button" className={`btn btn--sm ${cond.value === 'ON' ? 'btn--primary' : 'btn--secondary'}`}
                                onClick={() => updateCondition(idx, { value: 'ON' })}>ON</button>
                              <button type="button" className={`btn btn--sm ${cond.value === 'OFF' ? 'btn--primary' : 'btn--secondary'}`}
                                onClick={() => updateCondition(idx, { value: 'OFF' })}>OFF</button>
                            </div>
                          )}
                          {cond.sourceType === 'partTracking' && cond.sourceId && (
                            <div className="btn-group" style={{ display: 'flex', gap: 6 }}>
                              <button type="button" className={`btn btn--sm ${cond.value === 'SUCCESS' ? 'btn--primary' : 'btn--secondary'}`}
                                style={cond.value === 'SUCCESS' ? { background: '#74c415' } : {}}
                                onClick={() => updateCondition(idx, { value: 'SUCCESS' })}>SUCCESS</button>
                              <button type="button" className={`btn btn--sm ${cond.value === 'FAILURE' ? 'btn--primary' : 'btn--secondary'}`}
                                style={cond.value === 'FAILURE' ? { background: '#fa5650' } : {}}
                                onClick={() => updateCondition(idx, { value: 'FAILURE' })}>FAILURE</button>
                            </div>
                          )}

                          {/* Summary line */}
                          {cond.sourceId && cond.field && (
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, fontStyle: 'italic' }}>
                              {cond.sourceName ?? cond.sourceId}
                              {cond.field === 'motionComplete' ? '.MotionComplete = ON' :
                               cond.field === 'inPosition' ? '.InPosition = ON' :
                               cond.field === 'state' ? ` = ${cond.value}` :
                               cond.field?.startsWith('pos:') ? ` at ${cond.field.replace('pos:','')} ±${cond.tolerance ?? 1}mm` :
                               ` ${cond.field} = ${cond.value}`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Servo: axis config + speed profiles + positions/moves */}
          {isServo && (
            <>
              {/* ── AXIS CONFIGURATION ─────────────────────── */}
              <div className="servo-section-header">AXIS CONFIGURATION</div>
              <div className="servo-section-body">
                <div className="servo-field-row">
                  <span className="servo-field-label">Axis Number</span>
                  <input className="form-input servo-field-input" type="number" min="1" max="99"
                    value={axisNumber} onChange={e => setAxisNumber(e.target.value)} />
                  <span className="servo-tag-preview mono">
                    a{String(axisNumber).padStart(2,'0')}_{name || '…'} (AXIS_CIP_DRIVE)
                  </span>
                </div>
                <div className="servo-field-row" style={{ marginTop: 6 }}>
                  <span className="servo-field-label">Motion Type</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button"
                      className={`btn btn--xs ${motionType === 'linear' ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setMotionType('linear')}
                    >Linear (mm)</button>
                    <button type="button"
                      className={`btn btn--xs ${motionType === 'rotary' ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setMotionType('rotary')}
                    >Rotary (deg)</button>
                  </div>
                </div>
              </div>

              {/* ── RUNTIME SERVO SETTINGS ─────────────────── */}
              <div className="servo-section-header">
                RUNTIME SERVO SETTINGS
                <button type="button" className="btn btn--xs btn--primary" onClick={addSpeedProfile}>
                  + Add Profile
                </button>
              </div>
              <div className="servo-section-body servo-profiles-scroll">
                {speedProfiles.map((profile, i) => (
                  <SpeedProfileRow
                    key={i}
                    profile={profile}
                    index={i}
                    onChange={updateSpeedProfile}
                    onRemove={removeSpeedProfile}
                    motionType={motionType}
                  />
                ))}
              </div>

              {/* ── POSITIONS / MOVES ──────────────────────── */}
              <div className="servo-section-header">
                POSITIONS / MOVES
                <button type="button" className="btn btn--xs btn--primary" onClick={addPosition}>
                  + Add
                </button>
              </div>
              <div className="servo-section-body pos-card-grid">
                {positions.length === 0 && (
                  <div className="props-empty">No positions yet. Click + Add.</div>
                )}
                {positions.map((pos, i) => (
                  <PositionCard
                    key={i}
                    pos={pos}
                    index={i}
                    onChange={updatePosition}
                    onRemove={removePosition}
                    motionType={motionType}
                  />
                ))}
              </div>
            </>
          )}

          {/* Tag preview — collapsible */}
          {name && (
            <details className="props-info-box" style={{ marginTop: 8 }}>
              <summary className="props-info-box__label" style={{ cursor: 'pointer', userSelect: 'none' }}>Sample Generated Tags</summary>
              <div className="props-info-box__value mono" style={{ fontSize: 10, lineHeight: 1.5, marginTop: 4 }}>
                {isPneumatic && (
                  <>
                    {hasRetSensor ? <>i_{name}Ret (INPUT)<br /></> : <>{name}RetDelay (TIMER)<br /></>}
                    {hasExtSensor ? <>i_{name}Ext (INPUT)<br /></> : <>{name}ExtDelay (TIMER)<br /></>}
                    q_Ext{name} (OUTPUT)<br />
                    q_Ret{name} (OUTPUT)<br />
                  </>
                )}
                {isGripper && (
                  <>
                    {hasEngSensor ? <>i_{name}Engage (INPUT)<br /></> : <>{name}EngageDelay (TIMER)<br /></>}
                    {hasDisSensor ? <>i_{name}Disengage (INPUT)<br /></> : <>{name}DisengageDelay (TIMER)<br /></>}
                    q_Engage{name} (OUTPUT)<br />
                    q_Disengage{name} (OUTPUT)<br />
                  </>
                )}
                {isVac && (
                  <>
                    i_{name}VacOn<br />
                    q_VacOn{name}<br />
                    q_VacOff{name}<br />
                  </>
                )}
                {isServo && (
                  <>
                    a{String(axisNumber).padStart(2,'0')}_{name} (AXIS_CIP_DRIVE)<br />
                    {positions.map((p, i) => p.name ? (
                      <span key={i}>
                        p_{name}{p.name}
                        {(p.moveType === 'Incr' || p.moveType === 'Idx') ? ' (REAL — mm)' : ''}
                        <br />
                      </span>
                    ) : null)}
                    {speedProfiles.map((sp, i) => sp.name ? (
                      <span key={`sp-${i}`}>
                        p_{name}{sp.name}Speed (REAL — {sp.speed} mm/s)<br />
                        p_{name}{sp.name}Accel (REAL — {sp.accel})<br />
                        p_{name}{sp.name}Decel (REAL — {sp.decel})<br />
                      </span>
                    ) : null)}
                  </>
                )}
                {isVision && (
                  <>
                    q_Trigger{name} (OUTPUT — camera trigger)<br />
                    i_{name}TrigRdy (INPUT — trigger ready)<br />
                    i_{name}ResultReady (INPUT — result ready)<br />
                    i_{name}InspPass (INPUT — inspection pass)<br />
                    {name}WaitTimer (TIMER — {waitTimerMs}ms)<br />
                    {name}TrigDwell (TIMER — {trigDwellMs}ms)<br />
                    {jobs.map((j, i) => j.name ? (
                      <span key={`vj-${i}`}>
                        {(j.outcomes ?? []).map((o, oi) => (
                          <span key={oi}>q_{o} (BOOL — {oi === 0 ? 'pass' : 'fail'} outcome)<br /></span>
                        ))}
                      </span>
                    ) : null)}
                  </>
                )}
                {isAnalog && (
                  <>
                    i_{name} (REAL — raw input)<br />
                    {name}Scaled (REAL — scaled value)<br />
                    {setpoints.filter(s => s.name?.trim()).map((sp, i) => (
                      <span key={i}>
                        {name}{sp.name}RC.In_Range (BOOL — {sp.lowLimit?.toFixed(2)} to {sp.highLimit?.toFixed(2)} {sensorUnit})<br />
                      </span>
                    ))}
                  </>
                )}
                {isRobot && (
                  <>
                    {['DI', 'DO', 'Register'].map(grp => {
                      const sigs = robotSignals.filter(s => s.group === grp && s.name?.trim());
                      if (sigs.length === 0) return null;
                      const prefix = grp === 'DI' ? 'DI' : grp === 'DO' ? 'DO' : 'R';
                      return (
                        <span key={grp}>
                          <strong style={{ fontSize: 10 }}>{grp}:</strong><br />
                          {sigs.map(sig => {
                            const tagPrefix = sig.direction === 'input' ? 'i' : 'q';
                            const tagName = grp === 'Register'
                              ? `${name}R${sig.number ?? 0}` : `${tagPrefix}_${name}${sig.name}`;
                            return (
                              <span key={sig.id}>
                                {tagName} ({sig.dataType}) — {prefix}[{sig.number}]<br />
                              </span>
                            );
                          })}
                        </span>
                      );
                    })}
                  </>
                )}
                {isConveyor && (
                  <>
                    q_Run{name} (BOOL — run output)<br />
                    {bidirectional && <>q_Fwd{name} (BOOL — direction)<br /></>}
                    {hasSpeedControl && <>p_{name}Speed (REAL — speed setpoint)<br /></>}
                  </>
                )}
                {isParameter && (
                  <>
                    <>p_{name} ({dataType === 'numeric' ? 'REAL' : 'BOOL'}{paramScope === 'global' ? ', global' : ''})</>

                  </>
                )}
                {isCustom && customTypeDef && (
                  <>
                    {(customTypeDef.outputs || []).map(o => (
                      <span key={o.name}>{(o.tagPattern || '').replace(/\{name\}/g, name)} (BOOL — output)<br /></span>
                    ))}
                    {(customTypeDef.inputs || []).map(i => (
                      <span key={i.name}>{(i.tagPattern || '').replace(/\{name\}/g, name)} ({i.dataType || 'BOOL'} — input)<br /></span>
                    ))}
                    {(customTypeDef.operations || []).filter(op => op.timerSuffix).map(op => (
                      <span key={op.value}>{name}{op.timerSuffix} (TIMER — {op.defaultTimerMs ?? 500}ms)<br /></span>
                    ))}
                  </>
                )}
              </div>
            </details>
          )}

          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={!displayName.trim() || !name.trim()}>
              {isEdit ? 'Save Changes' : 'Add Subject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
