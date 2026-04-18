/**
 * PtBadge — Small informational badge on nodes.
 *
 * Shows:
 *   - "S"  (blue)   when signals are PRODUCED at this node
 *   - "PT" (purple)  when Part Tracking fields are annotated on this node
 *   - Combo gradient when both
 *
 * Click to see details (read-only popup):
 *   - Signal name + when it activates (reached / in / completed)
 *   - PT field name + value (SET / CLEAR / SUCCESS / FAILURE)
 *
 * This is purely informational — not an editor.
 * Signals are configured in the Sidebar signal editor.
 * PT annotations are stored on node data.
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDiagramStore } from '../../store/useDiagramStore.js';

const VALUE_COLORS = {
  SET:     { bg: '#7c3aed', text: '#fff' },
  CLEAR:   { bg: '#64748b', text: '#fff' },
  SUCCESS: { bg: '#16a34a', text: '#fff' },
  FAILURE: { bg: '#dc2626', text: '#fff' },
};

const REACHED_MODE_LABELS = {
  in:        'While in this state',
  completed: 'Once past this state',
  reached:   'Once reaching this state',
};

export function PtBadge({ nodeId, smId, annotations = [], selected = false }) {
  const [showPopup, setShowPopup] = useState(false);
  const badgeRef = useRef(null);
  const popupRef = useRef(null);

  const signals = useDiagramStore(s => s.project?.signals ?? []);
  const smOutputs = useDiagramStore(s => {
    const sm = (s.project?.stateMachines ?? []).find(m => m.id === smId);
    return sm?.smOutputs ?? [];
  });

  // ── Signal detection ────────────────────────────────────────────────
  // Only signals PRODUCED at this node (stateNodeId matches).
  const producedSignals = signals.filter(sig =>
    sig.type === 'state' && sig.stateNodeId === nodeId
  );

  // Legacy SM outputs active on this node
  const activeOutputs = smOutputs.filter(o => o.activeNodeId === nodeId);

  const allSignalItems = [...producedSignals, ...activeOutputs];

  const hasPt = annotations.length > 0;
  const hasSignals = allSignalItems.length > 0;
  const hasContent = hasPt || hasSignals;

  // Close popup on click outside — must be before early return (React hooks rule)
  useEffect(() => {
    if (!showPopup) return;
    function handleDown(e) {
      if (popupRef.current && !popupRef.current.contains(e.target) &&
          badgeRef.current && !badgeRef.current.contains(e.target)) {
        setShowPopup(false);
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleDown, true);
    };
  }, [showPopup]);

  // Only render when there's actual content
  if (!hasContent) return null;

  function handleBadgeClick(e) {
    e.stopPropagation();
    setShowPopup(v => !v);
  }

  // Compute popup position from badge ref
  const popupPos = (() => {
    if (!badgeRef.current) return { top: 0, left: 0 };
    const rect = badgeRef.current.getBoundingClientRect();
    return { top: rect.bottom + 6, left: rect.left - 20 };
  })();

  // Badge style
  let badgeClass;
  if (hasPt && hasSignals) {
    badgeClass = 'pt-badge--active pt-badge--combo';
  } else if (hasPt) {
    badgeClass = 'pt-badge--active';
  } else {
    badgeClass = 'pt-badge--active pt-badge--signal';
  }

  return (
    <>
      <div
        ref={badgeRef}
        className={`pt-badge ${badgeClass}`}
        onClick={handleBadgeClick}
        onMouseDown={e => e.stopPropagation()}
        title={[
          ...producedSignals.map(s => `Signal: ${s.name}`),
          ...activeOutputs.map(o => `Output: ${o.name}`),
          ...annotations.map(a => `PT: ${a.fieldName} → ${a.value}`),
        ].join('\n')}
      >
        {hasSignals && !hasPt && <span className="pt-badge__label">S</span>}
        {hasPt && !hasSignals && <span className="pt-badge__label">PT</span>}
        {hasPt && hasSignals && <span className="pt-badge__label">S</span>}
      </div>

      {/* Info popup — read-only */}
      {showPopup && createPortal(
        <div
          ref={popupRef}
          className="pt-popup nodrag nowheel"
          style={{ top: popupPos.top, left: popupPos.left }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* ── Signals ──────────────────────────────────────────── */}
          {producedSignals.map(sig => (
            <div key={`sig-${sig.id}`} className="pt-popup__signal-row">
              <div className="pt-popup__signal-name">{sig.name}</div>
              <div className="pt-popup__signal-desc">
                {REACHED_MODE_LABELS[sig.reachedMode] ?? 'Once reaching this state'}
              </div>
            </div>
          ))}

          {activeOutputs.map(out => (
            <div key={`out-${out.id}`} className="pt-popup__signal-row">
              <div className="pt-popup__signal-name">{out.name}</div>
              <div className="pt-popup__signal-desc">Output active at this state</div>
            </div>
          ))}

          {/* ── PT annotations (only if they exist) ──────────────── */}
          {hasPt && (
            <>
              {hasSignals && <div className="pt-popup__divider" />}
              {annotations.map(ann => {
                const vc = VALUE_COLORS[ann.value] ?? VALUE_COLORS.SET;
                return (
                  <div key={ann.fieldId} className="pt-popup__pt-row">
                    <span className="pt-popup__pt-field">{ann.fieldName}</span>
                    <span className="pt-popup__pt-arrow">&rarr;</span>
                    <span className="pt-popup__pt-value" style={{ background: vc.bg, color: vc.text }}>
                      {ann.value}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
