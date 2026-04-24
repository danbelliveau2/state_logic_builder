/**
 * PtBadge — Small informational badge on nodes.
 *
 * Shows:
 *   - "⚑" (blue)    when a LEGACY SM output is active at this node
 *   - "PT" (purple) when Part Tracking fields are annotated on this node
 *   - Combo gradient when both
 *
 * Note: Project-level signals (state signals with `stateNodeId`) NO LONGER
 * render here — they surface as green/red chips inside `state-node__body`
 * (see StateNode.jsx's onSideSignals / offSideSignals chip row). This
 * avoids double-visualizing the same signal and frees the corner badge
 * for PT annotations + the small remaining pool of legacy smOutputs.
 *
 * Click to see details (read-only popup):
 *   - Output name + "Output active at this state"
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

export function PtBadge({ nodeId, smId, annotations = [], selected = false }) {
  const [showPopup, setShowPopup] = useState(false);
  const badgeRef = useRef(null);
  const popupRef = useRef(null);

  const smOutputs = useDiagramStore(s => {
    const sm = (s.project?.stateMachines ?? []).find(m => m.id === smId);
    return sm?.smOutputs ?? [];
  });

  // ── Signal detection ────────────────────────────────────────────────
  // Project-level signals (type === 'state') render as chips inside the
  // state-node body, not here — we used to double-show them as a blue ⚑
  // which confused users who'd just placed a green ON chip via the signal
  // editor. PtBadge now only surfaces legacy SM outputs + PT annotations.
  const activeOutputs = smOutputs.filter(o => o.activeNodeId === nodeId);

  const hasPt = annotations.length > 0;
  const hasSignals = activeOutputs.length > 0;
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
          ...activeOutputs.map(o => `Output: ${o.name}`),
          ...annotations.map(a => `PT: ${a.fieldName} → ${a.value}`),
        ].join('\n')}
      >
        {hasSignals && !hasPt && <span className="pt-badge__label">⚑</span>}
        {hasPt && !hasSignals && <span className="pt-badge__label">PT</span>}
        {hasPt && hasSignals && <span className="pt-badge__label">⚑</span>}
      </div>

      {/* Info popup — read-only */}
      {showPopup && createPortal(
        <div
          ref={popupRef}
          className="pt-popup nodrag nowheel"
          style={{ top: popupPos.top, left: popupPos.left }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* ── Legacy SM outputs ────────────────────────────────── */}
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
