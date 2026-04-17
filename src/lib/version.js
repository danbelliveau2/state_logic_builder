/**
 * Application revision number + changelog.
 * Incremented on every push to GitHub.
 * Minor bumps (1.1 -> 1.2) on regular pushes.
 * Major bumps (1.x -> 2.0) on request for larger changes.
 */
export const APP_VERSION = '1.6';

/** Changelog — newest first. Keep entries short. */
export const CHANGELOG = [
  {
    version: '1.6',
    date: '2026-04-17',
    changes: [
      'In-app Design System editor tab on Project Setup',
      'Visual reference for all colors, shapes, icons, typography, spacing',
      'Editable color swatches persist to project.designTheme',
      'Live SVG previews of node shapes and device icons',
      'SDC color palette applied to IO Map',
      'Consistent DeviceIcon SVG components throughout decision popup',
    ],
  },
  {
    version: '1.5',
    date: '2026-04-16',
    time: '14:30',
    author: 'Dan Belliveau',
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
    time: '10:15',
    author: 'Dan Belliveau',
    changes: [
      'Moved Release Notes button to sidebar below Rev number',
      'Enlarged Part Tracking and Signals section headers',
      'Cleaned up toolbar — removed version clutter from top bar',
    ],
  },
  {
    version: '1.3',
    date: '2026-04-16',
    time: '08:45',
    author: 'Dan Belliveau',
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
    time: '16:00',
    author: 'Dan Belliveau',
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
    time: '11:20',
    author: 'Dan Belliveau',
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
    time: '09:00',
    author: 'Dan Belliveau',
    changes: [
      'Initial release: state machine editor with L5X export',
      'Node alignment tools, start conditions, index sync',
      'Supervisor L5X generation',
      'Controller-level L5X export',
    ],
  },
];
