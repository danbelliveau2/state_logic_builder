/**
 * PickerPreview — playground for the universal picker.
 *
 * Lives in Project Setup → "Picker Preview" tab. Subject manager on top,
 * picker + output below. No canvas changes.
 */

import { useState, useCallback, useEffect } from 'react';
import { UniversalPicker } from './UniversalPicker.jsx';
import { PickerTestSubjectManager } from './PickerTestSubjectManager.jsx';
import { loadGrammar } from '../lib/pickerGrammar.js';
import { loadTestSubjects, saveTestSubjects } from '../lib/pickerTestSubjects.js';

export function PickerPreview() {
  const [subjects, setSubjects] = useState(() => loadTestSubjects());
  const [pickerKey, setPickerKey] = useState(0);
  const [lastPick, setLastPick] = useState(null);

  // Persist subjects on change
  useEffect(() => {
    saveTestSubjects(subjects);
  }, [subjects]);

  const handlePick = useCallback((config) => {
    setLastPick(config);
  }, []);

  const handleSubjectsChange = useCallback((next) => {
    setSubjects(next);
    setPickerKey(k => k + 1); // reset picker so a deleted subject doesn't linger
  }, []);

  const grammar = loadGrammar();

  return (
    <div style={{ padding: '16px 20px', maxWidth: '100%', overflow: 'auto' }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
        Picker Preview
      </h2>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
        Test playground. Add a subject, then play with the picker.
      </div>

      {/* Subject manager */}
      <div style={{ marginBottom: 12 }}>
        <PickerTestSubjectManager
          subjects={subjects}
          onChange={handleSubjectsChange}
        />
      </div>

      {/* Picker + output */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <UniversalPicker
            key={pickerKey}
            grammar={grammar}
            subjects={subjects}
            onPick={handlePick}
          />
        </div>

        {lastPick && (
          <div style={{ flex: 1, minWidth: 320, maxWidth: 600 }}>
            <div style={sectionLabel}>Last pick</div>
            <pre style={outputPre}>
              {JSON.stringify(lastPick, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

const sectionLabel = {
  fontSize: 10, fontWeight: 700, color: '#475569',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  marginBottom: 4,
};

const outputPre = {
  background: '#0f172a', color: '#e0e7ff', padding: 10, borderRadius: 4,
  fontSize: 11, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap',
  margin: 0, lineHeight: 1.5,
};
