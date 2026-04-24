# CLAUDE.md — SDC State Logic Builder
> Complete coding standards, design decisions, corrections, and known issues.
> **This file is the ground truth for all AI-assisted development on this project.**

---

## 1. PROJECT OVERVIEW

A React web app that converts ME flowchart state machine diagrams into Allen Bradley L5X PLC code.

- **Location:** `N:\AI Folder\State Logic Diagrams\`
- **Stack:** React 18, @xyflow/react (React Flow v12), Zustand, Vite
- **Entry:** `START_APP.bat` or `npm install && npm run dev`
- **Dev server:** `http://localhost:5173`
- **⚠️ Windows note:** `preview_start` MCP tool does NOT work on Windows (spawn EINVAL). Always start the dev server via `Bash` tool and verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173`.

---

## 2. FILE MAP

```
src/
  store/
    useDiagramStore.js        — Zustand store (all state + actions)
  components/
    Canvas.jsx                — React Flow canvas, edge rendering/mapping, onConnect
    ConnectMenu.jsx           — Click-handle connect menu + preset waypoint computation
    ProjectTabBar.jsx         — Multi-project tab bar (open/switch/close projects)
    Sidebar.jsx               — Left panel: SM list, devices, signals
    Toolbar.jsx               — Top bar: project controls, export
    PropertiesPanel.jsx       — Right panel: context-sensitive node/edge props
    nodes/
      StateNode.jsx           — State/action node (rounded rect, polygon shapes)
      DecisionNode.jsx        — Wait/Decision node (pill shape, orange)
      PtBadge.jsx             — Part tracking badge overlay for nodes
    edges/
      RoutableEdge.jsx        — Custom draggable orthogonal edge with waypoints
    modals/
      SignalModal.jsx         — Create/edit signals (position, state, condition)
      ActionModal.jsx         — Edit transition conditions
      AddDeviceModal.jsx      — Add device to SM
      NewStateMachineModal.jsx
      ProjectManagerModal.jsx
      ReferencePositionModal.jsx  — Legacy (superseded by SignalModal)
      SmOutputModal.jsx           — Legacy (superseded by SignalModal)
  lib/
    l5xExporter.js            — L5X XML generator
    edgeRouting.js            — Edge path computation (auto-route, manual adjust, clearance)
    computeStateNumbers.js    — DFS state number assignment
    conditionBuilder.js       — Verify label builder for edges
    deviceTypes.js            — Device type definitions
    tagNaming.js              — SDC tag naming conventions
```

---

## 3. SDC PLC CODING STANDARDS

These standards are derived from the SDC PLC Software Standardization Guide and must be respected in all L5X output.

### 3.1 Tag Naming
> **All names are full words, not abbreviations.** `Extend`/`Retract`/`Extended`/`Retracted` — never `Ext`/`Ret`. See §15.2 for the complete generator rules.

| Category | Pattern | Type | Example |
|----------|---------|------|---------|
| Digital input sensor (pneumatic position) | `i_{name}Extended` / `i_{name}Retracted` | BOOL | `i_StampCylExtended` |
| Digital output solenoid | `q_Extend{name}` / `q_Retract{name}` | BOOL | `q_ExtendStampCyl` |
| Delay timer | `{name}ExtendDelay` / `{name}RetractDelay` | TIMER | `StampCylExtendDelay` |
| Gripper solenoid (2-sol standard) | `q_Close{name}` / `q_Open{name}` | BOOL | `q_ClosePNPGripper` |
| Part-present / generic digital sensor | `i_{name}` (debounced via `{name}Debounce`) | BOOL | `i_PartInNest` → `PartInNest Debounce.On` |
| Servo axis | `a{NN}_S{station}{name}` (controller-scope) + `iq_{name}` program InOut | AXIS_CIP_DRIVE | `a02_S01PNPXAxis` |
| Servo HMI tag | `HMI_{name}` (ServoOverall UDT) | UDT | `HMI_XAxis` |
| SM output / signal | `p_{signalName}` | BOOL (Public) | `p_StampComplete` |
| Parameter tag | `p_{name}` (REAL) or `q_{name}` (BOOL) | varies | |

### 3.2 Program / Routine Naming
- Program: `S{nn}_{PascalCaseName}` (e.g., `S02_StampCycle`)
- Routines per SM:
  - **R00_Main** — JSR calls to R01, R02, R03 (+ R04/R05 when servos present, + R20 Alarms)
  - **R01_Inputs** — HMI_Toggle decode, SS_OK, debounce, lockout rung, 1-sensor pneumatic invert
  - **R02_StateTransitions** — Step change conditions (XIC/XIO/MAM triggers)
  - **R03_StateLogic** — OTL/OTU complementary outputs per step
  - **R04_{axis}Servo** — one per servo axis (MSO/MSF/MAFR/MASR/MAJ/MAS/MAH+AOI_TorqueHome/MAM auto/position monitor/GSV); naming: `R04_StateLogicServo` for 1 axis, `R04_{axis1}Servo` + `R05_{axis2}Servo` for multi
  - **R20_Alarms** — `ProgramAlarmHandler` AOI call; fault summary OTEs
  - *(Fault detection delegated to `State_Engine_128Max` AOI via `EnaFaultDetect`/`TransitionTime`/`FaultTime`)*

### 3.3 Step Counter
- DINT tag `Step` — compatible with `State_Engine_128Max` AOI
- State numbers: base 1, increment **+3** per state (1, 4, 7, 10, 13, ...)
- Vision Inspect nodes consume **4 sub-states** (N, N+3, N+6, N+9)
- DFS traversal from initial node assigns numbers; unreachable nodes appended at end sorted by Y
- Reserved states (never assigned by DFS — see §15.5):
  - **0** — powerup / pre-init
  - **1, 2, 3** — reserved for future SDC use
  - **99** — lockout (forced by HMI_Toggle.0)
  - **100–127** — station-type initialization block
  - **127** — initialization complete / cycle-ready gate

### 3.4 State Engine AOI
- Wraps `StateLogicControl` UDT (StateReg, EnaFaultDetect, TransitionTime, FaultTime)
- `StateLogicStatus` UDT: `STATE[128]` array, PreviousState, TimeoutFlt
- Servo MAM velocity/acceleration exported as **0.0 placeholders** — CE configures post-export

### 3.5 Part Tracking
- `PartTracking` UDT with one BOOL per tracking field
- `PartStarted` BOOL set at cycle start / cleared at cycle complete — gates in-cycle-only logic
- L5X output stores field definitions but write logic remains in user code
- Vision-linked tracking fields auto-created via `syncVisionPartTracking()`

---

## 4. STATE MACHINE DATA SCHEMA

### 4.1 State Machine Root
```js
{
  id: string,
  name: string,            // PascalCase, used in tag/routine naming
  displayName: string,
  stationNumber: number,
  description: string,
  nodes: Node[],
  edges: Edge[],
  devices: Device[],
}
```

### 4.2 StateNode
```js
{
  id: string,
  type: 'stateNode',
  position: { x, y },
  data: {
    stepNumber: number,       // Computed by Canvas (DFS); do NOT store as authoritative
    label: string,
    actions: Action[],
    isInitial: boolean,
    isComplete: boolean,      // "Cycle Complete" terminal state
    stateNumber: number,      // Legacy alias for stepNumber
  }
}
```

### 4.3 DecisionNode
```js
{
  id: string,
  type: 'decisionNode',
  position: { x, y },
  data: {
    decisionType: 'signal' | 'vision',
    signalId: string,
    signalName: string,       // Job name or signal name (smaller text)
    signalSource: string,     // Device/SM name (BIG BOLD text)
    signalSmName: string,     // Source SM name
    signalType: 'visionJob' | 'position' | 'state' | 'condition',
    exitCount: 1 | 2,
    exit1Label: string,       // "Pass_X" or "True_X"
    exit2Label: string,       // "Fail_X" or "False_X"
    autoOpenPopup: boolean,   // Auto-open picker on creation
    stateNumber: number,      // Computed by Canvas
  }
}
```

### 4.4 Action
```js
{
  id: string,
  deviceId: string,
  operation: string,          // 'Extend'|'Retract'|'Engage'|'Disengage'|'ServoMove'|etc.
  positionName?: string,      // ServoMove
  incrementDist?: number,     // ServoIncr
  indexAngle?: number,        // ServoIndex
  indexStations?: number,
  jobName?: string,           // VisionInspect
  continuous?: boolean,
  continuousTimeoutMs?: number,
  outcomes?: Outcome[],
  setpointName?: string,      // AnalogSensor
  trackingFieldId?: string,
  trackingFieldName?: string,
  ptValue?: string,           // 'SUCCESS' | 'FAILURE'
  refPosId?: string,          // WaitRefPos
  refPosName?: string,
  outputSmId?: string,        // WaitSmOutput
  outputId?: string,
  outputName?: string,
}
```

---

## 5. EDGE SCHEMA & ROUTING RULES

### 5.1 Edge Data
```js
{
  id: string,
  source: string,
  sourceHandle: string | null,
  target: string,
  targetHandle: string | null,
  type: 'routableEdge',       // ALWAYS use routableEdge, not smoothstep or straight
  data: {
    conditionType: 'trigger'|'timer'|'sensorOn'|'sensorOff'|'sensorTimer'
                 |'servoAtTarget'|'checkResult'|'visionResult'|'ready'
                 |'always'|'custom'|'indexComplete'|'escapementComplete'
                 |'partPresent'|'servoComplete'|'analogInRange',
    label: string,
    waypoints: [{ x, y }, ...],    // Stored orthogonal bend points
    manualRoute: boolean,          // True if waypoints are user-drawn/preset (shape is sacred)
    isDecisionExit: boolean,       // True for pass/fail/single/retry exit edges
    exitColor: 'pass' | 'fail' | 'retry' | 'single',
    outcomeLabel: string,          // Label shown on decision exit pill
    firstSegmentAxis: 'horizontal' | 'vertical',  // Axis of first segment when drawn
    lastSegmentAxis: 'horizontal' | 'vertical',   // Axis of last segment when drawn
    conditions: VerifyCondition[], // For verify-input edges
    deviceId: string,
    outcomeId: string,
    outcomeIndex: number,
  }
}
```

### 5.2 Critical Handle Rules
> **VIOLATION OF THESE RULES CAUSES INVISIBLE EDGES**

| Node Type | Target Handle | Source Handle |
|-----------|--------------|---------------|
| StateNode (normal) | `null` (no id prop on Handle) | `null` |
| StateNode (vision, 2-node) | `null` | `'exit-pass'`, `'exit-fail'` |
| StateNode (vision, 1-node) | `null` | `'exit-single'` |
| DecisionNode | `'input'` | `'exit-single'`, `'exit-pass'`, `'exit-fail'`, `'exit-retry'` |

**Handle position types:**
- **Side handles** (`exit-pass`, `exit-fail`): exit horizontally from left/right of node → L-bend routing
- **Bottom handles** (`exit-single`, `exit-retry`, `null`): exit vertically from bottom → Z-bend routing (same as StateNode)

- When mapping edges in Canvas.jsx, always check: if target is DecisionNode → `targetHandle = 'input'`; if target is StateNode → `targetHandle = null`
- **Never force `targetHandle = 'input'` on edges targeting StateNodes** — this was a past bug causing invisible edges

### 5.3 Edge Styling (Canvas.jsx computed at render)
- Decision exit **Pass**: `stroke: '#16a34a'`, label bg `#16a34a`
- Decision exit **Fail**: `stroke: '#dc2626'`, label bg `#dc2626`
- Selected edge: `stroke: '#0072B5'`, `strokeWidth: 3`
- All edges: `type: 'routableEdge'` — **never use `smoothstep` or `straight`**

### 5.4 Edge Routing Behavior (`computeAutoRoute` in edgeRouting.js)

`computeAutoRoute(src, tgt, edgeData, allNodes, sourceHandle)` — takes actual source handle ID.

**Priority order (first match wins):**
1. **Side-handle exit** (`exit-pass`/`exit-fail` only): L-bend (horizontal out, vertical to target); backward → U-bend via handle direction
2. **Backward edges** (targetY < sourceY - 30): U-route via `computeBackwardWaypoints()` — 4-point U-shape, 60px side padding, 40px drop offsets
3. **Forward offset** (nodes not aligned): Z-bend (down to midY, over, down)
4. **Aligned**: straight line (no waypoints)

**Critical: side-handle detection uses `sourceHandle` ID, NOT `exitColor`.**
- `exit-single` has `exitColor: 'pass'` but is a BOTTOM handle → must route as Z-bend, not L-bend
- Previous bug: `exitColor === 'pass'` falsely triggered L-bend routing for bottom-handle exits

**Node clearance:** `enforceNodeClearance(wps, src, tgt, allNodes)` runs on ALL edges (auto + manual). Pushes waypoint segments 25px away from any node they pass too close to. Skips source/target nodes to preserve perpendicular handle stubs.

**Label position on backward edges**: Must be on the **outer vertical segment** (the side of the U), NOT the inner segment between nodes

### 5.5 onConnect Handler (Canvas.jsx)
When a new edge is drawn manually FROM a decision node handle, auto-apply correct styling:
- `exit-fail` → red color, `isDecisionExit: true`, `exitColor: 'fail'`
- `exit-pass` or `exit-single` → green color, `isDecisionExit: true`, `exitColor: 'pass'`
- `exit-retry` → amber color, `isDecisionExit: true`, `exitColor: 'retry'`
This ensures manually-redrawn branches retain their correct labels/colors.

Edges created via onConnect or ConnectMenu pre-compute waypoints via `computeAutoRoute` and store them as `manualRoute: true` so the shape is locked in and auto-route doesn't recalculate on re-render.

### 5.6 Edge Branch Labels (RoutableEdge.jsx)
Decision exit edges show a small colored pill label near the source handle:
- **Pass**: green pill, short label (e.g., `"On"`, `"Pass"`, `"True"`)
- **Fail**: red pill, short label (e.g., `"Off"`, `"Fail"`, `"False"`)
- **Retry-Fail**: amber pill, always shows `"Retry-Fail"`
- **Single-exit** (`exit-single`): **no label** — wait nodes with one exit don't need labels
- Pills are always rendered **horizontal**, positioned 36px along the first segment
- Text color: white for pass/fail, black for retry
- **Exit labels never include the signal/device name** — the node itself shows the device, labels are just `"On"`, `"Off"`, `"Pass"`, `"Fail"`, `"True"`, `"False"`, `"InRange"`, `"OutOfRange"`

### 5.7 ConnectMenu (ConnectMenu.jsx)
- Opens when user short-clicks a node handle (detected by `HandleClickZone` DOM listener)
- Tracks which handle was clicked via `store._connectMenuHandleId`
- Shows list of existing nodes to connect to, plus "New Action Node" / "New Wait Node"
- Uses `computePresetWaypoints()` to generate proper orthogonal waypoints for the connection
- All edges created through ConnectMenu use the actual clicked handle, not hardcoded values
- Escape key or clicking elsewhere dismisses the menu

---

## 6. DECISION NODE (DecisionNode.jsx)

### 6.1 Node Modes
DecisionNode has three modes (`data.nodeMode`):
- **`wait`** — Wait for a signal/condition to become true, then proceed (blue)
- **`verify`** — Verify a sensor is On or Off; if wrong, fault/fail (orange). Shows bold colored "Verify On/Off" pill inside node.
- **`decide`** — Branch: sensor On goes one way, Off goes the other (purple). **No On/Off pill** — both paths are equal, not an assertion of expected state. The branch labels on the edges ("On" / "Off") indicate which path is which.

### 6.2 Display Layout

**Wait / Decide (sensor node):**
```
Wait                             ← small muted header ("Branch" for decide)
Magnet_Load_Robot                ← BIG BOLD — liveDevice.displayName (live from store)
DI[2]  [On]  - MagnetPick        ← one inline row: IO prefix, colored pill, condition name
```

**Verify (sensor node):**
```
Verify                           ← small muted header
Magnet_Load_Robot                ← BIG BOLD — live device name
[Verify On]                      ← bold colored pill on its own line (green=On / red=Off)
```

**Vision / State signal (any mode):**
```
Wait                             ← small muted header
StamperVision                    ← BIG BOLD (signalSource = device/SM name)
Link_Orient                      ← neutral pill below (signalName = job/signal name)
```

**Live-linking rules (sensor nodes):**
- Device name: `liveDevice.displayName ?? liveDevice.name` — searched across ALL SMs via `allSMs.flatMap()`
- Condition name: for Robot signals, `liveDevice.signals.find(s => s.id === refSignalId).name` — stays linked after signal rename
- IO type: for Robot signals, use `liveSignal.group` (`'DI'`/`'DO'`) from robot perspective — NOT PLC tag prefix
- Falls back to `conditions[0].group` string (`"Robot DI"` → `"DI"`) when live signal not found
- `conditions[0].ref` format for robots: `"deviceId:signalId"` — signalId is stable UUID

**Exit count defaults:**
- Wait mode: always opens with `exitCount = 1` (Single exit selected)
- Decide mode: always opens with `exitCount = 2` (Branch selected)
- Switching tabs resets accordingly
- Unconfigured nodes (no signalName stored): always start at 1 for wait, 2 for decide
- Previously configured nodes: preserve stored `exitCount`

### 6.3 Popup Behavior
- Popup opens ONLY when clicking the **inner content/text area** — NOT the node border
- Clicking the border selects the node (for Delete key)
- `handleClick` must call `store.setSelectedNode(id)` explicitly (stopPropagation prevents RF from doing it)
- Popup renders via `createPortal(document.body)` to escape React Flow stacking context
- Popup positioned to the **RIGHT** of the node (`left: rect.right + 8px`)
- Click-outside handler dismisses popup — Done button needs `e.stopPropagation()` AND `onMouseDown={(e) => e.stopPropagation()}`

### 6.4 Popup Flow
**Step 1 — Pick signal:**
- Vision section: auto-generated from all SMs' VisionSystem devices + their jobs
- Signals section: flat list of all `project.signals[]` (position, state, condition — no separate categories)
- Picking ANY signal → go to Step 2

**Step 2 — Branch config (same for vision AND regular signals):**
- **"Wait for Pass"** / **"Wait for True"** → single exit (1 branch, bottom handle `exit-single`)
- **"Branch Pass / Fail"** / **"Branch True / False"** → dual exit (2 branches, left `exit-pass`, right `exit-fail`)
- Custom label inputs shown for dual-branch mode
- Done → calls `addDecisionSingleBranch()` or `addDecisionBranches()` in store

### 6.5 Branch Node Creation
- **`addDecisionSingleBranch(smId, nodeId, exitLabel)`**: Creates 1 StateNode below + 1 green edge from `exit-single`
- **`addDecisionBranches(smId, nodeId, exit1Label, exit2Label)`**: Creates pass node (left) + fail node (right) + green/red edges
- Both have duplicate guard: if `existingOut.length > 0` → return early
- Branch node X position: pass = `decisionX - 280`, fail = `decisionX + 280`
- Both use `targetHandle: null` for StateNode targets
- Branch label nodes (green/red pills) are StateNodes with `data.label = 'Pass_X'` or `data.label = 'Fail_X'`

---

## 7. SIGNAL TYPES

### 7.1 Position Signal
- TRUE when all specified servo axes are at named positions within tolerance
- Stored with `axes[]` array (smId, deviceId, positionName, tolerance)
- L5X tag: `p_At{name}` (BOOL)

### 7.2 State Signal (SM State)
- TRUE when a specific named state is active in a specific SM
- **Stored by `stateNodeId` (node ID, stable reference) — NOT by step number**
- `reachedMode: 'reached'` → `Step >= N` | `reachedMode: 'in'` → `Step == N`
- L5X resolves step number from node ID at export time — renumbering is safe
- Signal dropdown shows: `[13] Cycle Complete`, `[1] Home / Initial`, `[4] Wait: StamperVision`
- Special node labels: `isComplete → 'Cycle Complete'`, `isInitial → 'Home / Initial'`, `decisionNode → 'Wait: {device}'`

### 7.3 Condition Signal
- AND-combination of other signals (all must be true)
- Builder in SignalModal with optgroup sections by type

### 7.4 Part Tracking (auto-generated)
- Auto-generated from VisionSystem devices: `{deviceName}_Pass`, `{deviceName}_Fail`
- Not stored in `project.signals[]` — computed dynamically
- Available in condition picker under "Part Tracking" optgroup

---

## 8. STORE PATTERNS

### 8.1 Atomic Actions
```js
// CORRECT — read fresh state with get() inside action
updateFoo(id, val) {
  get()._pushHistory();
  const sm = get().project.stateMachines.find(s => s.id === smId);
  // ... transform ...
  set(s => ({ project: { ...s.project, stateMachines: [...] } }));
}
```
- Always use `get()` inside actions to read current state, not closures
- Always call `get()._pushHistory()` before any mutating action
- Never read stale `state` parameter from `set()` for derived values

### 8.2 localStorage Persistence
- Project state persisted via Zustand `persist` middleware
- History stacks (`_past`, `_future`) are NOT persisted (session-only)
- Max 50 undo snapshots

### 8.3 Selection & Delete
- `store.setSelectedNode(id)` — must be called explicitly when `stopPropagation` is used in node click handlers
- Delete key handling in Canvas: checks `selectedNodeId` / `selectedEdgeId`
- Nodes with no actions ARE selectable and deletable — selection is purely by click, not by content

### 8.4 ConnectMenu State
- `_connectMenuNodeId` — node ID whose handle was clicked (null when menu closed)
- `_connectMenuHandleId` — actual handle ID clicked ('exit-pass', 'exit-fail', 'exit-single', 'exit-retry', or null)
- `_connectPreset` — preset connection data (source node, handle, route type, target position)
- All three must be cleared together (Escape key, pane click, or finalize)

---

## 9. CANVAS.JSX KEY PATTERNS

### 9.1 State Number Computation
```js
// DFS from initial node → assign step 1, 4, 7, 10...
// Vision Inspect nodes get 4 sub-states
// Unreachable nodes appended, sorted by Y
const { stateMap, visionSubStepsMap } = computeStateNumbers(smNodes, smEdges);
```
- Runs every render (memoized on smNodes/smEdges)
- Result injected into node `data.stateNumber` and `data.visionSubSteps`
- Outgoing edges at each node sorted LEFT → RIGHT by target X before DFS

### 9.2 Edge Render Mapping
```js
// Decision exit edges (colored) — exit-single is treated as plain/gray
const isDecisionExit = e.data?.isDecisionExit === true && e.sourceHandle !== 'exit-single';
if (isDecisionExit) {
  const isPass = e.data?.exitColor === 'pass';
  const color = isPass ? '#16a34a' : '#dc2626';
  // Live label derived from source node config (stays in sync on rename)
  return { ...e, type: 'routableEdge', style: { stroke: color }, data: { ...e.data, outcomeLabel: liveLabel }, ... };
}
// All other edges (including exit-single) use routableEdge, plain gray
return { ...e, type: 'routableEdge', targetHandle, ... };
```
- `exit-single` edges excluded from colored styling — they render as plain gray edges
- Live labels computed from source decision node's current config via `computeExitLabels()`

### 9.3 Snap to Vertical
- Threshold: **25px** — nodes within 25px horizontal of each other snap to same X

---

## 10. CORRECTIONS FROM USER FEEDBACK

These are mistakes made previously that must NOT be repeated:

| # | Mistake | Correct Behavior |
|---|---------|-----------------|
| 1 | Used `type: 'smoothstep'` for decision exit edges | Always use `type: 'routableEdge'` |
| 2 | Used `type: 'straight'` for decision exit edges | Always use `type: 'routableEdge'` |
| 3 | Forced `targetHandle: 'input'` on ALL decision exit edges | Only force `'input'` if target is `decisionNode`; use `null` for StateNode targets |
| 4 | Decision node popup opened on ANY click (including border) | Only open popup when clicking inner text/content area |
| 5 | `e.stopPropagation()` in node click handlers without `store.setSelectedNode(id)` | Always call `setSelectedNode` explicitly when stopping propagation |
| 6 | Done button in popup dismissed by click-outside handler | Done button needs both `onClick={e => e.stopPropagation()}` and `onMouseDown={e => e.stopPropagation()}` |
| 7 | Displayed `signalName` (job name) as big bold text for vision | Vision: `signalSource` (device name) is big+bold, `signalName` (job) is subtitle. Non-vision: `signalName` is big+bold, `signalSource`/`signalSmName` is subtitle |
| 8 | Signal pick (non-vision) immediately committed with no branch options | Signals go to Step 2 branch config same as vision — never skip Step 2 |
| 9 | "Wait for Fail" button existed as third option | Only TWO options: "Wait for Pass/True" and "Branch Pass/Fail" — no third option |
| 10 | `addDecisionBranches` only created branches for `exitCount === 2` | Both `exitCount === 1` and `2` need branch creation in `handleDone()` |
| 11 | Decision node X position used `currentNode.width ?? 300` | Use `currentNode.measured?.width ?? currentNode.width ?? 240` |
| 12 | `isDecisionExit && isSideways` fired before backward check | Add `&& !isBackward` guard so backward exits use U-route |
| 13 | Backward edge labels placed at `targetX` (inner segment) | Labels on outer vertical segment (side of U-shape) for backward edges |
| 14 | State node dropdown in SignalModal showed `[13] Step 13` for Cycle Complete | Show `[13] Cycle Complete`, `[1] Home / Initial`, `[N] Wait: {device}` |
| 15 | Pass-only (single exit) branch showed no label on edge | Single exit must show `Pass_{name}` label, same as dual-branch pass |
| 16 | Dragging a decision node changed the shape of connected branches | Moving the decision node should only lengthen/shorten the horizontal segment of the branch — shape should not change |
| 17 | Backward edge routing broke after adding decision exit routing | The `isDecisionExit && isSideways` condition must check `!isBackward` first |
| 18 | `computeAutoRoute` used `exitColor` to detect side handles | Use actual `sourceHandle` ID — `exit-single` has `exitColor: 'pass'` but is a bottom handle |
| 19 | Exit-single edges got L-bend instead of Z-bend | Bottom handles (`exit-single`, `exit-retry`) must route identically to regular StateNode edges |
| 20 | ConnectMenu hardcoded `sourceHandle` to `'exit-pass'` for side handles | Track actual clicked handle via `store._connectMenuHandleId` and use it |
| 21 | Added icons/symbols to Verify mode header | Verify header must say just "Verify" — no icons, no checkmark, no symbols |
| 22 | Made branch labels full signal name (`On_Magnet_Presence`) | Shorten to first part before `_` (just "On", "Off", "Pass", "Fail") |
| 23 | Showed label on single-exit wait branches | `exit-single` edges should have NO branch label |
| 24 | Modified StateNode ActionRow for verify On/Off instead of DecisionNode | Verify On/Off pill goes INSIDE the DecisionNode, not on StateNode action rows |
| 25 | `enforceNodeClearance` only ran on manual routes | Must run on ALL edges (both auto-route and manual) |
| 26 | `enforceNodeClearance` checked all nodes including source/target | Must skip source/target nodes to preserve perpendicular handle stubs |
| 27 | Exit labels included signal name (e.g., `On_Magnet_Presence`) | Labels should be just `On`, `Off`, `Pass`, `Fail` — device name is already on the node |
| 28 | Showed bold On/Off pill inside decide nodes | Decide is a fork (both paths equal) — only VERIFY nodes get the On/Off pill since they assert an expected condition |
| 29 | Used `liveDevice.name` (PLC tag name) for device display label | Use `liveDevice.displayName ?? liveDevice.name` — displayName is the human-readable version |
| 30 | Derived IO type from PLC tag prefix (`q_` → "DO") for Robot signals | Use `liveSignal.group` ('DI'/'DO') which is the robot's perspective — a PLC `q_` output is DI to the robot |
| 31 | Searched only `smDevices` (current SM) for live device lookup | Must search `allSMs.flatMap(m => m.devices)` — robot may be in a different SM |
| 32 | Wait mode popup defaulted to exitCount=2 (Branch) | Wait mode always opens with exitCount=1 (Single exit); Decide opens with 2 |
| 33 | Wait/decide sensor nodes: On/Off pill on separate line below condition | For wait/decide: condition row is `DI[2] [On] - MagnetPick` all inline; verify keeps pill on its own line |

---

## 11. KNOWN BUGS & INCOMPLETE FEATURES

### 11.1 Active Bugs
| Bug | Location | Description |
|-----|----------|-------------|
| Popup viewport overflow | DecisionNode.jsx | Popup positioned `rect.right + 8` — no check for right-edge overflow; popup disappears off-screen on far-right nodes |
| Label midpoint on manual waypoints | RoutableEdge.jsx | After user manually moves edge waypoints, label may not stay at true midpoint of vertical segment |
| Existing bad waypoints from exit-single bug | stored edges | Edges created before the exit-single routing fix may have stale L-bend waypoints stored as `manualRoute: true` — need to delete and re-draw |

### 11.2 Incomplete Features
| Feature | Status | Notes |
|---------|--------|-------|
| Custom Condition signals | Placeholder | UI shows "condition" type but builder has no way to reference raw tags yet |
| L5X export for Decision nodes | Not implemented | Decision/Wait nodes not yet exported to R02 transition logic |
| L5X export for Signals | Not implemented | Signals not yet wired into L5X output |
| Signal branch config for regular signals | Partial | "Wait for True / False" second page added but True/False labels need to auto-derive from signal name |
| Part Tracking L5X write logic | Not implemented | Field structure exported but write rungs are user-authored |
| Electron desktop app packaging | Not implemented | `electron/main.js` and `BUILD_DESKTOP.bat` exist but packaging not tested. Tabled for later. |
| Vision job outcome editing | Not implemented | Must delete and re-add device to change pass/fail outcome labels |
| Cross-SM signal references in Decision node | Not implemented | Decision node popup only shows signals from current project, no cross-SM filtering |
| R04_StateLogicServo (servo MAM routine) | Partial | Servo MAM exported in R02 but velocity/accel are 0.0 placeholders |
| Undo/Redo for branch creation | Works | But edge waypoints are not undoable separately from edge creation |
| Multi-select nodes | Not implemented | Canvas comment references TODO for selection mode |

### 11.3 Hardcoded Values to Eventually Parameterize
| Value | Location | Notes |
|-------|----------|-------|
| Step base = 1, increment = 3 | l5xExporter.js | SDC standard, likely never changes |
| Vision sub-state count = 4 | l5xExporter.js, Canvas | Fixed 4 sub-states per vision inspect |
| Node width = 240px | DecisionNode.jsx, RoutableEdge.jsx | Used in centering calculations |
| Snap threshold = 25px | Canvas.jsx | Distance for snap-to-vertical |
| Backward waypoint padding = 60px | RoutableEdge.jsx | Side clearance for U-routes |
| Fault time default = 5000ms | l5xExporter.js | SDC standard |
| Controller name = 'SDCController' | l5xExporter.js | Should come from project settings |
| Vision search timeout = 5000ms | l5xExporter.js | Should be per-device configurable |

---

## 12. DESIGN DECISIONS (RATIONALE)

| Decision | Rationale |
|----------|-----------|
| Single `routableEdge` type for ALL edges | Consistent draggable waypoints; `smoothstep` doesn't route well from side handles |
| Decision node popup RIGHT of node | Left is often behind sidebar; below blocks the canvas; right is clearest |
| Signal + SM State merged in Decision popup | SM State signals ARE signals with a state condition — no separate category |
| Store by node ID not step number for state signals | Step numbers change during renumbering; node IDs are stable UUIDs |
| `targetHandle: null` for StateNode | StateNode's Handle component has no `id` prop — React Flow uses null (default) |
| `createPortal` for Decision popup | React Flow z-index stacking traps popups inside the canvas layer |
| `measured?.width` over `data.width` | React Flow computes actual render width after layout; `data.width` may be stale |
| Undo history capped at 50 | Memory management; 50 is sufficient for typical session |
| Servo MAM params = 0.0 in export | CE always tunes these post-export; pre-populating causes false confidence |
| DFS left-to-right edge sort | Ensures consistent step numbering when pass branch goes left, fail goes right |
| Decision node text: device=big, job=small | Device (StamperVision) is the primary identifier; job (Link_Orient) is a parameter of it |
| `autoOpenPopup` flag on new decision nodes | Created from StateNode "+" menu — should immediately prompt configuration |
| `sourceHandle` param in `computeAutoRoute` | `exitColor` can't distinguish side vs bottom handles (exit-single has exitColor='pass'); actual handle ID is authoritative |
| Pre-compute waypoints on edge creation | Edges store waypoints as `manualRoute: true` at creation so auto-route never recalculates and changes the shape |
| `enforceNodeClearance` as post-processing step | Runs after both auto-route and manual-route; skips source/target nodes; pushes segments 25px from other nodes |
| HandleClickZone for ConnectMenu | DOM-level mousedown/mouseup listener detects short clicks (<200ms, <5px) on handles vs drags; stores clicked handle ID |
| Shortened branch labels | Full `"On_Magnet_Presence"` is too long for small pills; first part before `_` is sufficient since the verify node already shows the signal name |
| No label on single-exit wait | Single-exit waits have only one path — label adds no information |

---

## 13. DEVELOPMENT WORKFLOW

### Start Dev Server
```bash
cd C:\SDC-StateLogic
npm run dev
# Verify:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

### Test After Changes
1. Start dev server if not running
2. Open `http://localhost:5173` in browser
3. For edge routing changes: test forward, backward, and sideways cases
4. For popup changes: test both click-to-open AND click-outside-to-close AND Done button
5. For store changes: test undo/redo (`Ctrl+Z` / `Ctrl+Y`)

### File Edit Safety Rules
- **Always read the file first** before editing — Edit tool fails if `old_string` not found exactly
- For large rewrites use `Write` tool (after reading)
- When `old_string` is not unique, add more surrounding context to make it unique
- After editing Canvas.jsx or RoutableEdge.jsx, test BOTH backward and forward edge cases

---

## 14. REACT FLOW SPECIFICS (v12 / @xyflow/react)

- `useReactFlow()` hook for programmatic control
- `useStore()` for accessing internal RF state (node positions, etc.)
- `Handle` component: no `id` prop = default null handle; `id="foo"` = named handle
- Edge `sourceHandle`/`targetHandle` must EXACTLY match the Handle's `id` prop or edge is invisible
- `node.measured?.width` = actual rendered width (available after first layout)
- `node.data.width` = initial width passed to node (may differ from measured)
- Drag events on nodes intercept Handle drag unless `e.target.closest('.react-flow__handle')` check is added
- `onNodeClick` fires for any part of the node unless `stopPropagation` is called in a child
- `createPortal(content, document.body)` needed to escape RF's stacking context for overlays

---

## 15. SDC PLC STANDARDS (GENERATOR RULES)

> **Source of truth:** SDC PLC Software Standardization Guide Rev 1 (`X:\Electrical Dept\EE Process and Standards Documents\PLC Software Standardization Guide - Rev1.pdf`) + engineer reference `S05_ServoPNP.L5X` + confirmed user answers (2026-04-23).
>
> **Guiding principle:** The exporter embodies these standards as *rules*. Reference L5X files are for pattern-learning only; the generator MUST produce correct output for machines we've never seen, with no reference file available. Every rule below must be honored by `l5xExporter.js` — if a machine doesn't need a feature, it is gated on declared device/signal presence, never on matching a reference file.

### 15.1 Layered Output Architecture

The L5X output is composed in layers. Each layer's contribution is **gated on declared project state**, never on the presence of a reference file.

| Layer | Contents | Gate |
|-------|----------|------|
| **L1 — Infrastructure** | `StateLogicControl`, `StateLogicStatus`, `PartTracking` UDTs; `State_Engine_128Max` AOI; `ProgramAlarmHandler` AOI | Always emitted |
| **L2 — Station-type template** | Init state skeleton 100→...→127; station-specific rungs | Keyed on `sm.stationType` (first supported: `SDCStandardPNP`) |
| **L3 — Per-device blocks** | Device UDTs/AOIs, tags, R01 inputs, R04/R05 servo, gripper rungs | One block per declared device — no device, no block |
| **L4 — Flowchart-compiled logic** | R02 transitions + R03 OTL/OTU from diagram nodes/edges | DFS over `sm.nodes`/`sm.edges` |
| **L5 — Always-on boilerplate** | Lockout state 99, HMI_Toggle decode, SS_OK, HMI_Momentary auto-clear, cycle-complete/cycle-start latching, `CPU_TimeDate_wJulian` | Always emitted at program scope |

### 15.2 Tag Naming (authoritative)

Per SDC Guide §8 and §10. Deviations from the old exporter behavior are marked ❗.

- **Pneumatic single-solenoid:**
  - Solenoid output: `q_Extend{name}` / `q_Retract{name}` ❗ (was `q_Ext{name}`)
  - Sensor input: `i_{name}Extended` / `i_{name}Retracted` ❗ (was `i_{name}Ext`)
  - Delay timers: `{name}ExtendDelay` / `{name}RetractDelay`
- **2-solenoid gripper (default):** `q_Close{name}` / `q_Open{name}` + `{name}CloseDelay` / `{name}OpenDelay`. Single-solenoid spring-return gripper is a unique case — programmer handles manually, exporter only emits 2-sol pattern for `PneumaticGripper` type.
- **Digital sensor (part-present and generic):** `i_{name}`. AOI_Debounce instance `{name}Debounce` is REQUIRED for part-present sensors; extend/retract position sensors do NOT debounce. Downstream references use `{name}Debounce.On`.
- **Servo axis tag:** controller-scope `a{NN}_S{station}{name}` ❗ where `{NN}` is 2-digit global axis number (01, 02, 03…) and `{station}` is the SM's station number (e.g., `a02_S01PNPXAxis`). Program scope exposes `iq_{name}` as InOut param aliased to the controller tag.
- **Servo HMI tag:** `HMI_{name}` of type `ServoOverall` (UDT defined in L1 for servo machines). Standard — do not rename.
- **Servo motion-instruction instances (one set per axis):** `MSO_{name}`, `MSF_{name}`, `MAFR_{name}`, `MASR_{name}`, `MAJ_{name}`, `MAS_{name}_Jog`, `MAH_{name}`, `MAM_{name}_Auto`.
- **Per-axis support tags:** `{Name}Ready`, `{Name}Permissive`, `{Name}AutoEnable`, `{Name}HomeConfimed` *(sic — spelling per guide)*, `{Name}HomeRequested`, `{Name}HomeSelect`, `{Name}TorqueHome`.
- **Signals (SM outputs):** `p_{signalName}` BOOL Public. Position signals: `p_At{name}`.
- **HMI toggles — FIXED BIT MAP (SDC standard, never change):**
  - `HMI_Toggle.0` → Lockout (forces Step=99)
  - `HMI_Toggle.1` → DryRun
  - `HMI_Toggle.2` → SS (Single-Step mode)
- **HMI_Momentary:** dynamic — bits allocated per machine based on momentary buttons declared. `HMI_Button` is **not used** (legacy).
- **CamelCase:** tag names are PascalCase segments joined without underscore inside a segment; underscore separates prefix/segment (`q_ExtendStampCyl`, not `q_Extend_StampCyl`).

### 15.3 Position Array Stability

Per SDC Guide §10 and user confirmation:
- Servo positions live in `HMI_{name}.Parameters.Positions[N]`, `AutoSpeed[N]`, `Accel[N]`, `Decel[N]`.
- Each declared position gets a **stable index** assigned at creation and **never reshuffled**. Deleting a position leaves a gap — indices ≥ the deleted one do not shift.
- Position index must be persisted on the position object (`positionIndex: number`) and preserved across rename/delete of other positions.
- Default MAM arguments in R04/R05 reference `HMI_{name}.Parameters.AutoSpeed[0]`, `Accel[0]`, `Decel[0]` unless the diagram specifies otherwise.

### 15.4 Servo Architecture (applies when `sm.devices` includes any `ServoAxis`)

**Controller-scope emissions:**
- One `MotionGroup` tag of type `MOTION_GROUP` (shared across all axes in the project).
- One `a{NN}_S{station}{name}` AXIS_CIP_DRIVE tag per servo axis.

**Program-scope emissions (per axis):**
- `iq_{name}` InOut parameter aliased to the controller-scope axis tag.
- `HMI_{name}` of type `ServoOverall`.
- All motion instruction instances (§15.2).
- All support tags (§15.2).
- Position data in `HMI_{name}.Parameters.Positions[]`.

**Required UDTs (emit once when any servo present):**
- `ServoOverall` (container)
- `ServoStatus`, `ServoControl`, `ServoParameters`, `ServoMomentary` (sub-UDTs)
- `STRING100` (string type used by ServoOverall)

**Required AOI (always embedded on servo machines):**
- `AOI_TorqueHome` — full definition pasted into the L5X. The engineer may or may not USE it in the home rung (a plain MAH is the alternative), but the AOI must be available. Default generator emits AOI_TorqueHome call in the home rung; CE switches to MAH post-export if desired.

**R04/R05 routine content (per axis):**
1. MSO (enable) — on `{Name}AutoEnable` + `{Name}Permissive`
2. MSF (disable) — on fault or E-stop
3. MAFR (fault reset) — on `HMI_{name}.Momentary.FaultReset`
4. MASR (shutdown reset)
5. MAJ (+/−) — on HMI jog buttons, using `HMI_{name}.Parameters.JogSpeed/JogAccel/JogDecel`
6. MAS_Jog (stop jog)
7. MAH / AOI_TorqueHome — on `{Name}HomeRequested`
8. MAM auto — triggered by state logic writing to `HMI_{name}.Control.MoveType` and firing `HMI_{name}.Momentary.MoveTrigger` (or equivalent flag set by R03)
9. Position monitoring — compare `a{NN}_...ActualPosition` to each `HMI_{name}.Parameters.Positions[N]` within `HMI_{name}.Parameters.PositionTolerance[N]`, set `HMI_{name}.Status.AtPosition[N]`
10. GSV — copy axis status into `HMI_{name}.Status` fields

### 15.5 State Machine Skeleton (reserved state numbers)

DFS numbering (§3.3) starts at 1 by default, but certain state numbers are RESERVED across all SDC machines and must not be assigned by the flowchart DFS. The exporter inserts them independently of the diagram:

| State | Meaning | Emission |
|-------|---------|----------|
| **0** | Pre-init / powerup | Implicit — `Step = 0` at controller start |
| **1, 2, 3** | Reserved for future SDC use | Do not emit, do not assign |
| **99** | Lockout | Always emitted. R02 rung: `XIC(HMI_Toggle.0) MOV(99, Step)` forces Step=99 when lockout toggled. R03: only OTL of safe-state outputs (retract solenoids, disable servos). |
| **100–127** | Station-type initialization block | Emitted from station-type template (§15.6) |
| **127** | Init-complete / cycle-ready | Station template's terminal init state. Exit transition: `XIC(HMI_Toggle.1_NOT_Lockout) XIC(CycleStart) MOV({flowchart_first_step}, Step)` |

**The flowchart-compiled logic (R02/R03) is responsible for states ≥ the first non-reserved step returned by DFS** (typically 4 onward, or wherever the diagram's initial node lands). State 127 bridges the fixed init block to the flowchart block.

### 15.6 Station-Type Init Templates

Each SM carries a `stationType` field. Exporter emits a canned init block for the chosen type. First supported type:

**`SDCStandardPNP`** (2-axis PNP with 2-solenoid gripper):
- **State 100** — Retract Z axis. Exit: `XIC(ZAxisAtPosition[RetractedIdx])` → depends on gripper state: if `i_{gripper}Open` at init → MOV 103; if `i_{gripper}Closed` at init → MOV 106.
- **State 103** — Retract X axis (gripper-open path, empty return). Exit: `XIC(XAxisAtPosition[HomeIdx])` → MOV 124.
- **State 106** — Extend X axis (gripper-closed path, carrying part from incomplete prior cycle). Exit: `XIC(XAxisAtPosition[PickOrPlaceIdx])` → MOV 109 (open gripper) → ... → eventually MOV 124.
- **State 124** — Initialization complete. Gripper and axes at known safe state. Exit: `XIC(CycleStart) XIO(HMI_Toggle.0)` → MOV 127.
- **State 127** — Cycle-ready. Exit to flowchart's initial step.

Other station types (not yet implemented): standard pneumatic station, inspection station, robot-cell station. Adding a new type = adding a template; core exporter is unaffected.

### 15.7 R01_Inputs Boilerplate (always emitted)

Order of rungs in R01:
1. **HMI_Toggle decode:**
   - `XIC(HMI_Toggle.0) OTE(Lockout)`
   - `XIC(HMI_Toggle.1) OTE(DryRun)`
   - `XIC(HMI_Toggle.2) OTE(SS)`
2. **SS_OK derivation:** `XIO(SS) OTE(SS_OK)` ORed with `XIC(SS) XIC(HMI_Momentary.StepAdvance) OTE(SS_OK)` (advance pulse).
3. **HMI_Momentary auto-clear:** one rung per declared momentary bit — `XIC(HMI_Momentary.X) OTU(HMI_Momentary.X)` on next scan.
4. **1-sensor pneumatic invert** (only for devices flagged as 1-sensor): `XIO(i_{name}Extended) OTE(i_{name}Retracted)` or the reverse.
5. **Debounce calls** (per §15.8).
6. **CPU_TimeDate_wJulian** call (once per program).

### 15.8 AOI_Debounce Usage

Per user confirmation:
- **Required:** every `DigitalSensor` (part-present) device.
- **Not required:** pneumatic extend/retract sensors (those are already conditioned by state logic).
- **Not required:** robot DI/DO (`TrigReady`, `InspPass`, etc.) — those come through a robot interface block.

Emission: `AOI_Debounce({name}Debounce, i_{name}, 100, 100)` in R01 (100 ms on, 100 ms off defaults). Downstream references (R02 transitions, signals) use `{name}Debounce.On` rather than `i_{name}`.

### 15.9 Gripper Rules (2-solenoid default)

For each `PneumaticGripper` device:
- Emit outputs `q_Close{name}` and `q_Open{name}`.
- Emit delay timers `{name}CloseDelay` and `{name}OpenDelay`.
- Default delay preset: 500 ms (engineer adjusts post-export).
- R03 rungs: gripper-close states OTL `q_Close{name}` + OTU `q_Open{name}`; gripper-open states do the reverse.
- Transitions (R02) consume `{name}CloseDelay.DN` / `{name}OpenDelay.DN` as the completion signal.
- Single-solenoid spring-return gripper: NOT auto-generated — flagged for manual authoring.

### 15.10 R20_Alarms

Always emitted. Contains:
- One `ProgramAlarmHandler` AOI call.
- Summary OTEs aggregating fault bits from State_Engine_128Max (`StateLogicStatus.TimeoutFlt` → fault bit per state).
- Empty by default beyond the AOI call; fills in as device/signal fault types are declared.

### 15.11 Version Fields

- `SoftwareRevision` in L5X header: follow target Studio 5000 version. Current standard: **37.00** (engineer's file). Older projects at 35.00 still supported — drive this from a project setting (default 37.00 for new exports).
- `ControllerName`: read from project settings. No hardcoded `SDCController`.

### 15.12 What NOT to Do

Hard-learned rules:
- **Never splice from a reference L5X file.** Generator must produce correct output from declared project state alone.
- **Never strip the station prefix from axis names** (bug in prior splice: `a02_PNPXAxis` is WRONG; correct is `a02_S01PNPXAxis`).
- **Never assign flowchart states to reserved numbers** (99, 100–127, 1–3). Let the init template and lockout rung own those.
- **Never pre-populate servo velocity/acceleration** with non-zero values in motion instructions — CE tunes post-export.
- **Never emit device-type-specific blocks unconditionally.** Gate on `sm.devices.some(d => d.type === X)` or equivalent.
- **Never check the confidential PLC guide into the repo.** `plc_guide.*` and SDC guide PDFs are gitignored; copies in the worktree must be deleted before commit.

---

*Last updated: 2026-04-23 — Rev 1.11: Added §15 SDC PLC Standards (Generator Rules) — layered architecture, full tag naming per guide §8/§10, servo architecture (ServoOverall UDT, AOI_TorqueHome, controller-scope axis + iq_ InOut + MotionGroup), reserved state skeleton (99/100–127), SDCStandardPNP init template (100→103 or 100→106 →124→127), 2-solenoid gripper default, AOI_Debounce scope rules, R01 boilerplate (HMI_Toggle decode .0/.1/.2 fixed, SS_OK, HMI_Momentary auto-clear), position array stable indexing. Corrected §3.1 tag naming to full words (q_Extend / i_{name}Extended) per guide.*
