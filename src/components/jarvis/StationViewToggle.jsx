/**
 * StationViewToggle — THE navigation between a station's two pages (Dan:
 * "the sheet creates the diagram — you don't go BACK to the diagram; the
 * spec sheet is first, the diagram second, and you just toggle back and
 * forth"). One segmented control, rendered IDENTICALLY on both pages:
 *
 *   [ Spec Sheet | Diagram ]      ← Spec Sheet first, active side highlighted
 *
 * Replaces the old "Station Specs" button (diagram side) and the
 * "← Back to diagram" button (sheet side). House pill style
 * (.canvas-mode-toggle / .canvas-mode-btn — same as Normal|Recovery and
 * Mechanical|Full Controls). Station-scoped: for a not-yet-built draft the
 * Diagram side renders visibly disabled with the reason ("build first") —
 * never silently.
 */

export function StationViewToggle({ active, onSheet, onDiagram, diagramDisabledReason = null }) {
  const diagramBlocked = !!diagramDisabledReason;
  return (
    <div className="canvas-mode-toggle" data-testid="station-view-toggle" style={{ flexShrink: 0, background: '#fff' }}>
      <button
        type="button"
        className={`canvas-mode-btn${active === 'sheet' ? ' canvas-mode-btn--active' : ''}`}
        data-testid="station-view-sheet"
        onClick={active === 'sheet' ? undefined : onSheet}
        title="The station's spec sheet — description, devices, servo values, sensors & timers, IO"
        style={{ whiteSpace: 'nowrap' }}
      >
        Spec Sheet
      </button>
      <button
        type="button"
        className={`canvas-mode-btn${active === 'diagram' ? ' canvas-mode-btn--active' : ''}`}
        data-testid="station-view-diagram"
        aria-disabled={diagramBlocked}
        onClick={active === 'diagram' || diagramBlocked ? undefined : onDiagram}
        title={diagramDisabledReason ?? 'The drawn station sequence on the canvas'}
        style={{
          whiteSpace: 'nowrap',
          ...(diagramBlocked ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
        }}
      >
        Diagram
      </button>
    </div>
  );
}
