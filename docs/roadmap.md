# Roadmap — SDC State Logic Builder

Features planned or in-progress. Update this as things ship or get deprioritized.

## In Progress

| Feature | Status | Notes |
|---------|--------|-------|
| L5X export for Decision/Wait nodes | In progress | R02 transition logic not yet generated from Decision nodes |
| L5X export for Signals | In progress | Signals not yet wired into L5X output (position, state, condition) |
| Signal branch config labels | Partial | "Wait for True/False" step 2 added; True/False labels need to auto-derive from signal name |

## Planned

| Feature | Notes |
|---------|-------|
| Custom Condition signals | UI placeholder exists; needs raw tag reference builder |
| Part Tracking L5X write logic | Field structure exported; write rungs are user-authored today |
| Vision job outcome editing | Must delete + re-add device to change pass/fail outcome labels |
| Cross-SM signal references in Decision node | Decision popup shows only current project signals |
| Multi-select nodes | Canvas has a TODO comment; needed for bulk move/delete |
| Popup right-edge overflow fix | Clamp popup to viewport width — see known-issues.md |
| Configurable AOI_Debounce timing | Per-sensor on/off times instead of global 100ms |
| Per-device vision search timeout | Currently hardcoded 5000ms in l5xExporter.js |
| Project settings: controller name, Studio 5000 version | Currently hardcoded defaults |

## Tabled (not now)

| Feature | Notes |
|---------|-------|
| Electron desktop app packaging | `electron/main.js` + `BUILD_DESKTOP.bat` exist but packaging untested. Revisit when web version is stable. |
| Servo R04/R05 velocity/acceleration inputs | CE always tunes post-export; keeping 0.0 placeholders is intentional |
| Additional station-type init templates | Standard pneumatic, inspection, robot-cell — add as needed per project type |

## Completed (recent)

- v1.24.22 — Fixed 6 bugs across vite config, server, main process, dev launcher
- v1.24.21 — Servo L5X fixes (clean R03, full AxisParameters)
- v1.24.20 — L5X generator unified with v1.24.19 signal UI
- v1.24.19 — Embedded decisions, signal latches, chip fixes
- v1.24 — Wait subtitle tag names, single-exit edges gray, Robot icon
- v1.23 — Team-shared standards library via /api/standards
- v1.22 — Wait-branching rule + standards library seed/export
- v1.21 — Edge clearance: owner nodes push their own stub-adjacent segments
- v1.20 — Standards auto-save, Copy + inline rename, category grouping
