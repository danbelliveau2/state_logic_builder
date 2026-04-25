# `src/components/` — React UI

> ⚠️ **`nodes/StateNode.jsx` is 3,900 lines.** Read its ToC (lines 1-50) first.

## Layout

```
components/
  Canvas.jsx                — React Flow canvas, edge mapping, onConnect
  ConnectMenu.jsx           — Click-handle connect menu + waypoint presets
  Toolbar.jsx               — Top bar
  ProjectTabBar.jsx         — Multi-project tabs
  PropertiesPanel.jsx       — Right panel (context-sensitive)
  PartTrackingPanel.jsx     — PT field CRUD UI + pill renderer
  DeviceSidebar.jsx         — Left panel: devices/signals
  StandardsView.jsx         — Standards browser
  StandardsProfileEditor.jsx
  DesignSystemEditor.jsx    — Theme/colors editor
  IOMapEditor.jsx           — Address-mapping table
  MachineConfigEditor.jsx   — Per-machine numeric config
  ProjectSetup.jsx          — Onboarding view
  DeviceIcons.jsx           — All SVG device icons (single file)
  nodes/
    StateNode.jsx           — Big. Has ToC at top. ★
    DecisionNode.jsx        — Wait/Decision pill
    PtBadge.jsx             — Tracking-field overlay
  edges/
    RoutableEdge.jsx        — Custom orthogonal edge w/ waypoints
    DrawingConnectionLine.jsx
    ManualDrawOverlay.jsx
  modals/
    AddDeviceModal.jsx, ActionModal.jsx, NewStateMachineModal.jsx,
    ProjectManagerModal.jsx, RecipeManagerModal.jsx,
    ReferencePositionModal.jsx, SignalModal.jsx, SmOutputModal.jsx,
    DeviceLibraryPicker.jsx, CustomDeviceConfigurator.jsx
```

## Rules specific to this folder

1. **All edges use `type: 'routableEdge'`.** Never `smoothstep` or `straight`. See root CLAUDE.md §5.1.
2. **Handle rules are critical.** A wrong `targetHandle` = invisible edge. See root CLAUDE.md §5.2.
3. **`createPortal(content, document.body)`** for any popup that must escape React Flow's stacking context. (DecisionNode popup, ConnectMenu, etc.)
4. **`stopPropagation` MUST be paired with `setSelectedNode(id)`** in node click handlers. RF won't auto-select if you stop propagation. See root CLAUDE.md §10 row 5.
5. **`node.measured?.width`** for live width, not `data.width` (stale until first layout).

## Common StateNode.jsx targets

| Want to change…                         | Component / location                  |
|-----------------------------------------|---------------------------------------|
| Operation color                         | `OPERATION_COLORS` map (line ~51)     |
| The action row layout                   | `<ActionRow>` (line ~607)             |
| Operation switcher dropdown             | `<OperationSwitcher>` (line ~89)      |
| The "+ Add Action" multi-step flow      | `<InlinePicker>` (line ~1055) — big   |
| Right-click menu                        | `<ContextMenu>` (line ~2828)          |
| Home node entry-rule pills              | `<HomeConfigPills>` (line ~3070)      |
| Top-level node container                | `<StateNode>` (line ~3190)            |

See `src/WHERE.md` for the project-wide map.
