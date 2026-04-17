/**
 * Application revision number + changelog.
 * Incremented on every push to GitHub.
 * Minor bumps (1.1 -> 1.2) on regular pushes.
 * Major bumps (1.x -> 2.0) on request for larger changes.
 */
export const APP_VERSION = '1.5';

/** Changelog — newest first. Keep entries short. */
export const CHANGELOG = [
  {
    version: '1.5',
    date: '2026-04-16',
    changes: [
      'IO Map tab on Project Setup: Device List + IO Map sub-tabs',
      'Device List groups by category with DI/DO/AI/AO counts',
      'Vision Systems split into own category in IO Map',
      'Part Tracking toggle in decision node popup (Wait/Decide/Verify)',
      'Auto-create PT fields from decision nodes on Done',
      'PT badge shown on decision nodes when enabled',
    ],
  },
  {
    version: '1.4',
    date: '2026-04-16',
    changes: [
      'Moved Release Notes button to sidebar below Rev number',
      'Enlarged Part Tracking and Signals section headers',
      'Cleaned up toolbar — removed version clutter from top bar',
    ],
  },
  {
    version: '1.3',
    date: '2026-04-16',
    changes: [
      'Refactored all edge routing into edgeRouting.js module',
      'Fixed edge shape preservation when dragging connected nodes',
      'Terminal run adjustment keeps drawn shape frozen, stretches only endpoints',
      'Removed duplicate routing code from RoutableEdge and Canvas',
      'Added version badge with changelog popup',
    ],
  },
  {
    version: '1.2',
    date: '2026-04-15',
    changes: [
      'Decision node modes: live exit labels, sensor/signal/vision branching',
      'Proximity handles on decision nodes',
      'Edge routing fixes for backward and sideways edges',
      'UI polish and label sync improvements',
    ],
  },
  {
    version: '1.1',
    date: '2026-04-14',
    changes: [
      'CompactLogix Motion (ERM) processor support',
      'L5X export fixes for program-scoped BOOL tags',
      'Part tracking panel and robot sequencing',
      'Analog probe flow support',
    ],
  },
  {
    version: '1.0',
    date: '2026-04-12',
    changes: [
      'Initial release: state machine editor with L5X export',
      'Node alignment tools, start conditions, index sync',
      'Supervisor L5X generation',
      'Controller-level L5X export',
    ],
  },
];
