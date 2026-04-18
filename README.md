# SDC State Logic Builder

> Visual state machine editor that converts ME flowchart diagrams into Allen-Bradley L5X PLC code.

Built by the SDC Automation engineering team to eliminate manual PLC state logic authoring. Draw your state machine, configure devices and signals, and export production-ready L5X directly into Studio 5000.

---

## Download & Install

Get the latest installer from the [**Releases page**](https://github.com/danbelliveau2/state_logic_builder/releases/latest).

1. Download `SDC-State-Logic-Builder-Setup-x.x.x.exe`
2. Run it — one-click install, creates a Desktop shortcut
3. The app **auto-updates** in the background whenever a new version is released

> Projects are saved to `%APPDATA%\SDC State Logic Builder\projects\` and survive updates.

---

## Features

### State Machine Editor
- Drag-and-drop canvas powered by React Flow
- State nodes with actions (Extend, Retract, ServoMove, VisionInspect, and more)
- Decision/Wait nodes with Pass/Fail or True/False branching
- Backward and sideways edge routing with draggable waypoints
- Snap-to-vertical alignment, renumber, and draw-path tools
- Undo / Redo (Ctrl+Z / Ctrl+Y) with 50-step history

### Devices & Signals
- Device library: Pneumatic cylinders, servos, vision systems, robots, analog sensors, conveyors, escapements
- Per-SM device list with IO map grouped by DI / DO / AI / AO
- Signals: Position signals, SM State signals, Condition (AND) signals
- Part Tracking fields auto-generated from vision decision nodes

### IO Map & Network
- IO Map tab shows all devices grouped by category with I/O point counts
- **Network tab** — EtherNet/IP topology auto-discovered from state machines
  - IP addressing follows SDC standard (subnet + decade offsets per device type)
  - Editable module names, catalog numbers, IP addresses, RPI rates
  - Chassis visual with slot layout (DI / DO / AI / AO / Safety modules)
  - IP Address Summary for quick reference

### L5X Export
- Exports per-SM programs with R00_Main, R01_Inputs, R02_StateTransitions, R03_StateLogic routines
- Step counter (DINT `Step`) compatible with `State_Engine_128Max` AOI
- State numbers base-1, increment +3; Vision Inspect nodes consume 4 sub-states
- Controller-level L5X with all programs bundled
- Export All as ZIP

### Desktop App
- Electron-based — runs locally, no internet required after install
- Auto-update: checks every 15 minutes + manual **Check for Updates** button in sidebar
- Projects stored in user AppData, safe across app updates

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 |
| Canvas / Diagram | [@xyflow/react](https://reactflow.dev/) (React Flow v12) |
| State Management | Zustand with localStorage persistence |
| Build Tool | Vite |
| Desktop Shell | Electron 28 |
| Auto-Update | electron-updater + GitHub Releases |
| CI/CD | GitHub Actions (Windows runner) |

---

## Development Setup

**Prerequisites:** Node.js 18+, Git

```bash
git clone https://github.com/danbelliveau2/state_logic_builder.git
cd state_logic_builder
npm install
npm run dev
```

App runs at `http://localhost:3131` (or next available port).

### Run as Electron (desktop mode)
```bash
npm run build          # build React first
npm run electron:dev   # open in Electron window
```

---

## Project Structure

```
src/
  components/
    Canvas.jsx              — React Flow canvas, edge rendering, state number computation
    Toolbar.jsx             — Top bar: project controls, SM selector, export buttons
    DeviceSidebar.jsx       — Left panel: device list, signals, part tracking, version
    PropertiesPanel.jsx     — Right panel: context-sensitive node/edge properties
    IOMapEditor.jsx         — IO Map + Network tab in Project Setup
    nodes/
      StateNode.jsx         — State/action node (rounded rect)
      DecisionNode.jsx      — Wait/Decision node (pill shape, orange)
    edges/
      RoutableEdge.jsx      — Draggable orthogonal edge with waypoints
    modals/                 — SignalModal, ActionModal, AddDeviceModal, etc.
  lib/
    l5xExporter.js          — L5X XML generator (per-SM programs)
    controllerL5xExporter.js — Controller-level L5X export
    deviceTypes.js          — Device type definitions
    tagNaming.js            — SDC tag naming conventions
    version.js              — App version + changelog
  store/
    useDiagramStore.js      — Zustand store (all state + actions)
electron/
  main.js                   — Electron main process + embedded HTTP server
  preload.js                — Context bridge for auto-update IPC
.github/
  workflows/
    release.yml             — Build & publish installer on version bump
```

---

## Releasing a New Version

Releases are fully automated via GitHub Actions. When the app is ready to ship:

1. Bump `"version"` in `package.json` (e.g. `"1.0.6"` → `"1.0.7"`)
2. Commit and push to `main`:
   ```bash
   git commit -am "chore: bump version to 1.0.7"
   git push
   ```
3. GitHub Actions builds the NSIS installer on a Windows runner (~5 min)
4. A new [GitHub Release](https://github.com/danbelliveau2/state_logic_builder/releases) is published automatically
5. All installed copies detect the update within 15 minutes and prompt users to restart

> Only a version number change triggers a release build. Regular code pushes without a version bump do **not** create a release.

---

## Local Build (for testing only)

```bat
BUILD_DESKTOP.bat
```

Produces a ZIP of the app in `release/` for local testing. Does **not** publish to GitHub.

---

## SDC PLC Coding Standards

The L5X output follows the [SDC PLC Software Standardization Guide](https://sdcautomation.com):

- Programs named `S{nn}_{PascalCaseName}` (e.g. `S02_StampCycle`)
- Step counter: DINT `Step`, base 1, increment +3
- Tag prefixes: `i_` inputs, `q_` outputs, `a{n}_` servo axes, `p_` parameters/signals
- Routines: R00_Main (JSR calls), R01_Inputs (debounce), R02_StateTransitions, R03_StateLogic (OTL/OTU)

---

## License

Internal SDC Automation tooling. Not for external distribution.
