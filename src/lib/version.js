/**
 * Application revision number + changelog.
 * Incremented on every push to GitHub.
 * Minor bumps (1.1 -> 1.2) on regular pushes.
 * Major bumps (1.x -> 2.0) on request for larger changes.
 */
export const APP_VERSION = '1.11';

/** Changelog — newest first. Keep entries short. */
export const CHANGELOG = [
  {
    version: '1.11',
    date: '2026-04-19',
    changes: [
      'Recovery sequences per SM: states 100-124 (+3 intervals), fault = 127',
      'Normal/Recovery toggle in canvas header — red button for recovery mode',
      'Recovery mode canvas is fully functional: add/edit/delete nodes & edges',
      'Recovery variant support: multiple named sequences per SM (recipe-ready)',
      'computeStateNumbers accepts startAt option (100 for recovery, 1 for normal)',
      'Store actions: addRecoverySeq, addRecoveryNode, addRecoveryEdge, and matching delete/update',
    ],
  },
  {
    version: '1.10',
    date: '2026-04-19',
    changes: [
      'Wait node redesign: device name (bold) + DI[2] / On / SignalName all on one row',
      'Live signal linking: Robot signal names update instantly when renamed in robot builder',
      'Correct DI/DO label for robot signals (robot perspective, not PLC tag prefix)',
      'Device name uses displayName (human-readable) not PLC tag name',
      'Cross-SM device lookup: searches all SMs for robot devices',
      'Wait mode popup defaults to Single exit (1); Decide defaults to Branch (2)',
      'Switching mode tabs resets exit count appropriately',
    ],
  },
  {
    version: '1.9',
    date: '2026-04-19',
    changes: [
      'Decision popup opens directly to the builder — no separate signal picker page',
      'Signal / Condition panel always visible in builder with "+ Pick Signal" CTA',
      'Done button disabled until a signal/condition is picked (prevents half-configured nodes)',
      'Multi-outcome decide nodes: dynamic handles for 3+ outcomes with color-coded labels',
      'Decide mode: single-exit option hidden (decide always branches 2+)',
      'Shortened exit labels to just On/Off/Pass/Fail/True/False — device name already on node',
      'Bold colored On/Off pill restricted to verify mode (decide is a fork, both paths equal)',
      'Fixed wait/decision exit-single edges: now Z-bend like regular state nodes (was L-bend)',
      'ConnectMenu tracks actual clicked handle ID instead of hardcoding exit-pass',
      'enforceNodeClearance runs on ALL edges (auto + manual) to push segments 25px off nodes',
    ],
  },
  {
    version: '1.8',
    date: '2026-04-18',
    changes: [
      'Multi-project tabs: open multiple projects simultaneously',
      'Dark navy tab bar above toolbar with project names',
      'Click tab to switch, X to close, + to open another project',
      '"+ Tab" button in Project Manager opens project in new tab',
      'Project state preserved per tab (SM selection, recipe, undo history)',
      'Network tab on IO Map: EtherNet/IP topology + backplane layout',
      'Auto-discovers servo, vision, robot, conveyor devices from state machines',
      'IP addressing follows SDC standard: subnet + decade offsets per device type',
    ],
  },
  {
    version: '1.7',
    date: '2026-04-17',
    changes: [
      'Network tab on IO Map: EtherNet/IP device topology + backplane layout',
      'Editable module names, catalog numbers, IP addresses, RPI rates',
      'Chassis visual: slot layout with DI/DO/AI/AO/Safety module types',
      'IP Address Summary view for quick reference',
      'Add manual EtherNet/IP modules and backplane modules',
    ],
  },
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
