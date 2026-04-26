# CLAUDE.md — SDC State Logic Builder
> Ground truth for all AI-assisted development. Critical rules always loaded here.
> Deep-dive reference: [@docs/architecture.md](docs/architecture.md) | [@docs/decisions.md](docs/decisions.md) | [@docs/known-issues.md](docs/known-issues.md) | [@docs/roadmap.md](docs/roadmap.md)

---

## 1. PROJECT OVERVIEW

A React web app that converts ME flowchart state machine diagrams into Allen Bradley L5X PLC code.

- **Stack:** React 18, @xyflow/react (React Flow v12), Zustand, Vite, Electron
- **Entry:** `START_APP.bat` or `npm install && npm run dev`
- **Dev server:** `http://localhost:5173`
- **⚠️ Windows note:** `preview_start` MCP tool does NOT work on Windows (spawn EINVAL). Always start the dev server via `Bash` tool and verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173`.

---

## 2. KEY FILES

```
src/
  store/useDiagramStore.js        — Zustand store (all state + actions)
  components/
    Canvas.jsx                    — React Flow canvas, edge rendering, onConnect
    ConnectMenu.jsx               — Click-handle connect menu
    nodes/StateNode.jsx           — State/action node
    nodes/DecisionNode.jsx        — Wait/Decision node
    edges/RoutableEdge.jsx        — Custom draggable orthogonal edge
    modals/SignalModal.jsx        — Create/edit signals
  lib/
    l5xExporter.js                — L5X XML generator
    edgeRouting.js                — Edge path computation
    computeStateNumbers.js        — DFS state number assignment
```

Full file map + all schemas → [@docs/architecture.md](docs/architecture.md)

---

## 3. SDC PLC CODING STANDARDS

### Tag Naming (full words, no abbreviations)
| Category | Pattern | Example |
|----------|---------|---------|
| Pneumatic solenoid output | `q_Extend{name}` / `q_Retract{name}` | `q_ExtendStampCyl` |
| Pneumatic sensor input | `i_{name}Extended` / `i_{name}Retracted` | `i_StampCylExtended` |
| Delay timer | `{name}ExtendDelay` / `{name}RetractDelay` | `StampCylExtendDelay` |
| Gripper (2-sol standard) | `q_Close{name}` / `q_Open{name}` | `q_ClosePNPGripper` |
| Digital sensor | `i_{name}` + `{name}Debounce` AOI | `i_PartInNest` |
| Servo axis (controller) | `a{NN}_S{station}{name}` | `a02_S01PNPXAxis` |
| Servo HMI tag | `HMI_{name}` (ServoOverall UDT) | `HMI_XAxis` |
| SM output / signal | `p_{signalName}` | `p_StampComplete` |

### Routine Naming
- Program: `S{nn}_{PascalCaseName}` (e.g. `S02_StampCycle`)
- R00_Main → R01_Inputs → R02_StateTransitions → R03_StateLogic → R04/R05 servo → R20_Alarms

### Step Counter
- DINT tag `Step` — base 1, increment +3 per state (1, 4, 7, 10...)
- Vision Inspect nodes: 4 sub-states
- Reserved: 0 (powerup), 1-3 (SDC reserved), 99 (lockout), 100–127 (init block), 127 (cycle-ready)

### HMI Toggles (fixed bit map — never change)
- `HMI_Toggle.0` → Lockout (forces Step=99)
- `HMI_Toggle.1` → DryRun
- `HMI_Toggle.2` → SS (Single-Step)

Full L5X generator rules, layered output architecture, servo details → [@docs/architecture.md](docs/architecture.md)

---

## 4. EDGE RULES (violations cause invisible edges)

- **Always** use `type: 'routableEdge'` — never `smoothstep` or `straight`
- **StateNode target** → `targetHandle: null`
- **DecisionNode target** → `targetHandle: 'input'`
- **Side handles** (`exit-pass`, `exit-fail`) → L-bend routing
- **Bottom handles** (`exit-single`, `exit-retry`, `null`) → Z-bend routing
- Side-handle detection uses **`sourceHandle` ID**, NOT `exitColor` — `exit-single` has `exitColor='pass'` but is a bottom handle
- `enforceNodeClearance()` runs on ALL edges (auto + manual); skips source/target nodes

---

## 5. DECISION NODE QUICK REFERENCE

- **`wait`** mode → blue, single or dual exit, no On/Off pill
- **`verify`** mode → orange, "Verify On/Off" pill inside node
- **`decide`** mode → purple, no pill (both paths equal)
- Popup opens on **inner content area click only** — not the border
- Done button needs `e.stopPropagation()` AND `onMouseDown={e => e.stopPropagation()}`
- Device display: `liveDevice.displayName ?? liveDevice.name` searched across ALL SMs
- Exit labels: just `On`, `Off`, `Pass`, `Fail` — never include the signal name

---

## 6. STORE PATTERNS

```js
// Always read fresh state with get() inside actions
updateFoo(id, val) {
  get()._pushHistory();
  const sm = get().project.stateMachines.find(s => s.id === smId);
  set(s => ({ project: { ...s.project, stateMachines: [...] } }));
}
```
- Use `get()` inside actions — never stale closures
- Call `get()._pushHistory()` before every mutating action
- `_connectMenuNodeId`, `_connectMenuHandleId`, `_connectPreset` — always cleared together

---

## 7. CORRECTIONS FROM USER FEEDBACK

Mistakes made previously that must NOT be repeated:

| # | Mistake | Correct Behavior |
|---|---------|-----------------|
| 1 | Used `type: 'smoothstep'` for decision exit edges | Always use `type: 'routableEdge'` |
| 2 | Used `type: 'straight'` for decision exit edges | Always use `type: 'routableEdge'` |
| 3 | Forced `targetHandle: 'input'` on ALL decision exit edges | Only force `'input'` if target is `decisionNode`; use `null` for StateNode targets |
| 4 | Decision node popup opened on ANY click (including border) | Only open popup when clicking inner text/content area |
| 5 | `e.stopPropagation()` without `store.setSelectedNode(id)` | Always call `setSelectedNode` explicitly when stopping propagation |
| 6 | Done button dismissed by click-outside handler | Done button needs both `onClick={e => e.stopPropagation()}` and `onMouseDown={e => e.stopPropagation()}` |
| 7 | Displayed `signalName` as big bold text for vision nodes | Vision: `signalSource` (device) is big+bold, `signalName` (job) is subtitle |
| 8 | Signal pick immediately committed with no branch options | Signals go to Step 2 branch config same as vision — never skip Step 2 |
| 9 | "Wait for Fail" existed as third option | Only TWO options: "Wait for Pass/True" and "Branch Pass/Fail" |
| 10 | `addDecisionBranches` only created branches for `exitCount === 2` | Both `exitCount === 1` and `2` need branch creation in `handleDone()` |
| 11 | Decision node X position used `currentNode.width ?? 300` | Use `currentNode.measured?.width ?? currentNode.width ?? 240` |
| 12 | `isDecisionExit && isSideways` fired before backward check | Add `&& !isBackward` guard so backward exits use U-route |
| 13 | Backward edge labels at `targetX` (inner segment) | Labels on outer vertical segment (side of U-shape) |
| 14 | State node dropdown showed `[13] Step 13` for Cycle Complete | Show `[13] Cycle Complete`, `[1] Home / Initial`, `[N] Wait: {device}` |
| 15 | Pass-only (single exit) branch showed no label on edge | Single exit must show `Pass_{name}` label |
| 16 | Dragging a decision node changed shape of connected branches | Move only lengthens/shortens the horizontal segment |
| 17 | Backward edge routing broke after adding decision exit routing | `isDecisionExit && isSideways` must check `!isBackward` first |
| 18 | `computeAutoRoute` used `exitColor` to detect side handles | Use actual `sourceHandle` ID — `exit-single` has `exitColor: 'pass'` but is a bottom handle |
| 19 | Exit-single edges got L-bend instead of Z-bend | Bottom handles route identically to regular StateNode edges |
| 20 | ConnectMenu hardcoded `sourceHandle` to `'exit-pass'` | Track actual clicked handle via `store._connectMenuHandleId` |
| 21 | Added icons/symbols to Verify mode header | Verify header says just "Verify" — no icons, no checkmark |
| 22 | Branch labels used full signal name (`On_Magnet_Presence`) | Shorten to first part before `_` — just "On", "Off", "Pass", "Fail" |
| 23 | Showed label on single-exit wait branches | `exit-single` edges have NO branch label |
| 24 | Modified StateNode ActionRow for verify On/Off | Verify On/Off pill goes INSIDE DecisionNode, not on StateNode |
| 25 | `enforceNodeClearance` only ran on manual routes | Must run on ALL edges (auto + manual) |
| 26 | `enforceNodeClearance` checked all nodes including source/target | Must skip source/target nodes to preserve perpendicular handle stubs |
| 27 | Exit labels included signal name | Labels: just `On`, `Off`, `Pass`, `Fail` — device name is on the node |
| 28 | Bold On/Off pill inside decide nodes | Only VERIFY nodes get the pill — decide is a fork (both paths equal) |
| 29 | Used `liveDevice.name` (PLC tag name) for display | Use `liveDevice.displayName ?? liveDevice.name` |
| 30 | Derived IO type from PLC tag prefix (`q_` → "DO") for Robot | Use `liveSignal.group` ('DI'/'DO') from robot perspective |
| 31 | Searched only `smDevices` (current SM) for live device | Must search `allSMs.flatMap(m => m.devices)` |
| 32 | Wait mode popup defaulted to exitCount=2 (Branch) | Wait mode opens with exitCount=1 (Single exit); Decide opens with 2 |
| 33 | Wait/decide: On/Off pill on separate line below condition | For wait/decide: condition row is `DI[2] [On] - MagnetPick` all inline |

---

## 8. DEVELOPMENT WORKFLOW

### Start Dev Server
```bash
npm run dev
# Verify:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

### Git Workflow (Jon's recommended process)
1. **Start session:** `git pull` — get latest from remote
2. **Feature work:** commit to `main` for small changes; create a feature branch for large/experimental work
3. **End session:** commit + push; update CHANGELOG.md for significant changes
4. **Experimental:** stays on a branch until tested and ready

### Test After Changes
1. Start dev server if not running
2. For edge routing changes: test forward, backward, and sideways cases
3. For popup changes: test click-to-open AND click-outside-to-close AND Done button
4. For store changes: test undo/redo (`Ctrl+Z` / `Ctrl+Y`)

### File Edit Safety Rules
- **Always read the file first** before editing — Edit tool fails if `old_string` not found exactly
- For large rewrites use `Write` tool (after reading)
- After editing Canvas.jsx or RoutableEdge.jsx, test BOTH backward and forward edge cases

---

## 9. ELECTRON RELEASE RULES

> ⚠️ Read before bumping any version. Careless releases have caused NSIS installer corruption across all machines.

- **`package.json` version field controls releases** — bumping it = new installer pushed to all machines within 2 minutes
- **`APP_VERSION` in `src/lib/version.js`** is display-only (changelog); does NOT trigger releases
- **Do NOT bump `package.json` on every commit** — batch features, then one deliberate release commit
- Correct commit message: `chore: release vX.Y`

### What Caused the April 2026 NSIS Corruption
5 package.json bumps in one day → rapid-fire NSIS upgrades → `autoInstallOnAppQuit = true` AND explicit `quitAndInstall()` fired simultaneously → two NSIS processes → second process found files deleted by first → error code 2 → left install directory empty → all subsequent upgrades broke with "Failed to uninstall old application files: 2"

### Fixes Applied (do not revert)
- `electron/main.js`: `autoInstallOnAppQuit = false`
- `build/installer.nsh`: custom uninstall hook — if old uninstaller fails, skip gracefully
- `package.json` nsis: `"include": "build/installer.nsh"`

### Release Checklist
- [ ] All features for this batch committed and tested
- [ ] `APP_VERSION` in `version.js` updated with changelog entry
- [ ] `package.json` version matches `APP_VERSION`
- [ ] Commit message: `chore: release vX.Y`

### Recovery (machine stuck in corrupted state)
```powershell
Remove-Item "$env:LOCALAPPDATA\Programs\SDC State Logic Builder" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.sdc.statelogicbuilder" -Force -ErrorAction SilentlyContinue
```
Then run the fresh installer.

---

*Last updated: 2026-04-26 — Restructured: added docs/ sub-files for architecture, decisions, known-issues, roadmap. CLAUDE.md now lean with pointers.*
