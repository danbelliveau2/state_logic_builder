/**
 * StandardsProfileEditor - Configurable naming conventions table.
 * Companies fill this out once to define their PLC coding standards.
 */

import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';

// Field definitions for the standards table
const SECTIONS = [
  {
    title: 'Tag Naming',
    fields: [
      { key: 'tagCase', label: 'Tag Case Style', type: 'select', options: ['PascalCase', 'camelCase', 'snake_case'] },
      { key: 'inputPrefix', label: 'Input Prefix', type: 'text', placeholder: 'i_' },
      { key: 'outputPrefix', label: 'Output Prefix', type: 'text', placeholder: 'q_' },
      { key: 'parameterPrefix', label: 'Parameter Prefix', type: 'text', placeholder: 'p_' },
      { key: 'globalPrefix', label: 'Global Prefix', type: 'text', placeholder: 'g_' },
      { key: 'localPrefix', label: 'Local Prefix', type: 'text', placeholder: '(none)' },
    ],
  },
  {
    title: 'Tag Patterns',
    description: 'Use {name} for device name, {suffix} for position suffix (Ext/Ret/etc.)',
    fields: [
      { key: 'sensorExtendPattern', label: 'Sensor Extend', type: 'text', placeholder: 'i_{name}Ext' },
      { key: 'sensorRetractPattern', label: 'Sensor Retract', type: 'text', placeholder: 'i_{name}Ret' },
      { key: 'outputExtendPattern', label: 'Output Extend', type: 'text', placeholder: 'q_Ext{name}' },
      { key: 'outputRetractPattern', label: 'Output Retract', type: 'text', placeholder: 'q_Ret{name}' },
      { key: 'delayTimerPattern', label: 'Delay Timer', type: 'text', placeholder: '{name}{suffix}Delay' },
    ],
  },
  {
    title: 'Program Naming',
    fields: [
      { key: 'stationPrefix', label: 'Station Prefix', type: 'text', placeholder: 'S' },
      { key: 'processPrefix', label: 'Process Prefix', type: 'text', placeholder: 'P' },
      { key: 'programNameSeparator', label: 'Name Separator', type: 'text', placeholder: '_' },
    ],
  },
  {
    title: 'Routine Names',
    fields: [
      { key: 'routineNames.main', label: 'Main', type: 'text', placeholder: 'R00_Main' },
      { key: 'routineNames.inputs', label: 'Inputs', type: 'text', placeholder: 'R01_Inputs' },
      { key: 'routineNames.stateTransitions', label: 'State Transitions', type: 'text', placeholder: 'R02_StateTransitions' },
      { key: 'routineNames.stateLogicValves', label: 'State Logic', type: 'text', placeholder: 'R03_StateLogic' },
      { key: 'routineNames.stateLogicServo', label: 'State Logic (Servo)', type: 'text', placeholder: 'R04_StateLogicServo' },
      { key: 'routineNames.alarms', label: 'Alarms', type: 'text', placeholder: 'R20_Alarms' },
    ],
  },
  {
    title: 'AOI References',
    fields: [
      { key: 'stateEngineAOI', label: 'State Engine AOI', type: 'text', placeholder: 'State_Engine_128Max' },
      { key: 'alarmHandlerAOI', label: 'Alarm Handler AOI', type: 'text', placeholder: 'ProgramAlarmHandler' },
      { key: 'clockAOI', label: 'Clock AOI', type: 'text', placeholder: 'CPU_TimeDate_wJulian' },
      { key: 'cycleTimeAOI', label: 'Cycle Time AOI', type: 'text', placeholder: 'MovingAverage' },
    ],
  },
  {
    title: 'Network Device Prefixes',
    fields: [
      { key: 'networkPrefixes.camera', label: 'Camera/Scanner', type: 'text', placeholder: 'cam' },
      { key: 'networkPrefixes.robot', label: 'Robot', type: 'text', placeholder: 'rob' },
      { key: 'networkPrefixes.servoDrive', label: 'Servo Drive', type: 'text', placeholder: 'sd' },
      { key: 'networkPrefixes.valveBank', label: 'Valve Bank', type: 'text', placeholder: 'vb' },
      { key: 'networkPrefixes.ioBlock', label: 'I/O Block', type: 'text', placeholder: 'io' },
      { key: 'networkPrefixes.vfd', label: 'VFD', type: 'text', placeholder: 'fd' },
      { key: 'networkPrefixes.genericDevice', label: 'Generic Device', type: 'text', placeholder: 'gd' },
    ],
  },
  {
    title: 'Axis Naming',
    fields: [
      { key: 'axisPrefix', label: 'CIP Axis Prefix', type: 'text', placeholder: 'a' },
    ],
  },
  {
    title: 'Machine Behavior',
    fields: [
      { key: 'cycleStartDelay', label: 'Cycle Start Delay (ms)', type: 'number', placeholder: '2000' },
      { key: 'stuckInRunTimeout', label: 'Stuck-in-Run Timeout (ms)', type: 'number', placeholder: '10000' },
      { key: 'consecutiveFailuresDefault', label: 'Consecutive Failures Default', type: 'number', placeholder: '3' },
    ],
  },
  {
    title: 'Alarm Messages',
    description: 'Use {station} for station number, {stationName} for name, {message} for alarm text',
    fields: [
      { key: 'alarmMessageFormat', label: 'Message Format', type: 'text', placeholder: '{station} {stationName}: {message}' },
    ],
  },
];

// Deep get/set for dotted keys like "routineNames.main"
function deepGet(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function deepSet(obj, path, value) {
  const keys = path.split('.');
  if (keys.length === 1) return { ...obj, [keys[0]]: value };
  return { ...obj, [keys[0]]: deepSet(obj[keys[0]] ?? {}, keys.slice(1).join('.'), value) };
}

export function StandardsProfileEditor() {
  const profile = useDiagramStore(s => s.project.standardsProfile ?? {});
  const updateStandardsProfile = useDiagramStore(s => s.updateStandardsProfile);
  const resetStandardsProfile = useDiagramStore(s => s.resetStandardsProfile);
  const [expandedSections, setExpandedSections] = useState(() => new Set(['Tag Naming', 'Program Naming']));

  function toggleSection(title) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function handleChange(key, value) {
    // For dotted keys, build nested update
    const keys = key.split('.');
    if (keys.length === 1) {
      updateStandardsProfile({ [key]: value });
    } else {
      // e.g. routineNames.main → update the whole routineNames object
      const topKey = keys[0];
      const currentObj = profile[topKey] ?? {};
      const updated = deepSet({ [topKey]: currentObj }, key, value);
      updateStandardsProfile(updated);
    }
  }

  // Preview: show example generated tags based on current settings
  const exampleDevice = 'XAxis';
  const previewTags = [
    { label: 'Sensor (extend)', value: (profile.sensorExtendPattern ?? '').replace('{name}', exampleDevice) },
    { label: 'Sensor (retract)', value: (profile.sensorRetractPattern ?? '').replace('{name}', exampleDevice) },
    { label: 'Output (extend)', value: (profile.outputExtendPattern ?? '').replace('{name}', exampleDevice) },
    { label: 'Output (retract)', value: (profile.outputRetractPattern ?? '').replace('{name}', exampleDevice) },
    { label: 'Delay timer', value: (profile.delayTimerPattern ?? '').replace('{name}', exampleDevice).replace('{suffix}', 'Ext') },
    { label: 'Program name', value: `${profile.stationPrefix ?? 'S'}01${profile.programNameSeparator ?? '_'}PartLoad` },
  ];

  return (
    <div className="standards-editor">
      <div className="standards-editor__header">
        <div>
          <h2 className="standards-editor__title">Standards Profile</h2>
          <p className="standards-editor__subtitle">
            Configure naming conventions and PLC structure rules. These settings define how tags, programs, and routines are named in exported code.
          </p>
        </div>
        <div className="standards-editor__actions">
          <span className="standards-editor__profile-name">{profile.name ?? 'Custom'}</span>
          <button className="btn btn--ghost btn--sm" onClick={resetStandardsProfile} title="Reset to SDC defaults">
            Reset to SDC Default
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div className="standards-editor__preview">
        <div className="standards-editor__preview-title">Live Preview — device "{exampleDevice}" at Station 01</div>
        <div className="standards-editor__preview-grid">
          {previewTags.map(t => (
            <div key={t.label} className="standards-editor__preview-item">
              <span className="standards-editor__preview-label">{t.label}</span>
              <code className="standards-editor__preview-value">{t.value}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className="standards-editor__sections">
        {SECTIONS.map(section => {
          const isOpen = expandedSections.has(section.title);
          return (
            <div key={section.title} className={`standards-editor__section${isOpen ? ' standards-editor__section--open' : ''}`}>
              <button className="standards-editor__section-header" onClick={() => toggleSection(section.title)}>
                <span className="standards-editor__section-chevron">{isOpen ? '▼' : '▶'}</span>
                <span className="standards-editor__section-title">{section.title}</span>
                <span className="standards-editor__section-count">{section.fields.length} fields</span>
              </button>
              {isOpen && (
                <div className="standards-editor__section-body">
                  {section.description && (
                    <p className="standards-editor__section-desc">{section.description}</p>
                  )}
                  <div className="standards-editor__table">
                    {section.fields.map(field => {
                      const currentVal = deepGet(profile, field.key) ?? '';
                      return (
                        <div key={field.key} className="standards-editor__row">
                          <label className="standards-editor__label">{field.label}</label>
                          {field.type === 'select' ? (
                            <select
                              className="standards-editor__input"
                              value={currentVal}
                              onChange={e => handleChange(field.key, e.target.value)}
                            >
                              {field.options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="standards-editor__input"
                              type={field.type === 'number' ? 'number' : 'text'}
                              value={currentVal}
                              placeholder={field.placeholder}
                              onChange={e => handleChange(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
