# Architecture — SDC State Logic Builder

## File Map

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

## State Machine Data Schema

### State Machine Root
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

### StateNode
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

### DecisionNode
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

### Action
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

## Edge Schema & Routing

### Edge Data
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
    manualRoute: boolean,
    isDecisionExit: boolean,
    exitColor: 'pass' | 'fail' | 'retry' | 'single',
    outcomeLabel: string,
    firstSegmentAxis: 'horizontal' | 'vertical',
    lastSegmentAxis: 'horizontal' | 'vertical',
    conditions: VerifyCondition[],
    deviceId: string,
    outcomeId: string,
    outcomeIndex: number,
  }
}
```

### Handle Rules (violations cause invisible edges)

| Node Type | Target Handle | Source Handle |
|-----------|--------------|---------------|
| StateNode (normal) | `null` | `null` |
| StateNode (vision, 2-node) | `null` | `'exit-pass'`, `'exit-fail'` |
| StateNode (vision, 1-node) | `null` | `'exit-single'` |
| DecisionNode | `'input'` | `'exit-single'`, `'exit-pass'`, `'exit-fail'`, `'exit-retry'` |

- **Side handles** (`exit-pass`, `exit-fail`): exit horizontally → L-bend routing
- **Bottom handles** (`exit-single`, `exit-retry`, `null`): exit vertically → Z-bend routing

### Auto-Route Priority (`computeAutoRoute` in edgeRouting.js)

1. **Side-handle exit** (`exit-pass`/`exit-fail` only, not backward): L-bend
2. **Backward edges** (targetY < sourceY - 30): U-route via `computeBackwardWaypoints()`
3. **Forward offset**: Z-bend (down to midY, over, down)
4. **Aligned**: straight line

**Critical:** side-handle detection uses `sourceHandle` ID, NOT `exitColor`. `exit-single` has `exitColor: 'pass'` but is a BOTTOM handle — routes as Z-bend.

Node clearance: `enforceNodeClearance()` runs on ALL edges, pushes segments 25px from nodes, skips source/target nodes.

---

## Decision Node (DecisionNode.jsx)

### Node Modes
- **`wait`** — Wait for signal to be true, then proceed (blue)
- **`verify`** — Assert sensor is On/Off; fault if wrong (orange). Shows "Verify On/Off" pill.
- **`decide`** — Fork: sensor On / Off go different paths (purple). No pill — both paths equal.

### Display Layout
**Wait/Decide:**
```
Wait                             ← small muted header
Magnet_Load_Robot                ← BIG BOLD — liveDevice.displayName
DI[2]  [On]  - MagnetPick        ← IO prefix, colored pill, condition name (all inline)
```
**Verify:**
```
Verify
Magnet_Load_Robot
[Verify On]                      ← pill on its own line
```
**Vision/State:**
```
Wait
StamperVision                    ← BIG BOLD (signalSource)
Link_Orient                      ← neutral pill (signalName)
```

### Live-Linking Rules
- Device name: `liveDevice.displayName ?? liveDevice.name` — searched across ALL SMs via `allSMs.flatMap()`
- Robot signal IO type: use `liveSignal.group` ('DI'/'DO') from robot perspective
- `conditions[0].ref` for robots: `"deviceId:signalId"` — signalId is stable UUID

### Popup Behavior
- Opens on click of **inner content area only** — not the border
- Renders via `createPortal(document.body)` to escape React Flow z-index
- Positioned RIGHT of node (`left: rect.right + 8px`)
- Done button needs `e.stopPropagation()` AND `onMouseDown={e => e.stopPropagation()}`

---

## Signal Types

### Position Signal
- TRUE when servo axes are at named positions within tolerance
- `axes[]` array (smId, deviceId, positionName, tolerance)
- L5X tag: `p_At{name}`

### State Signal
- TRUE when a specific state is active in a SM
- **Stored by `stateNodeId` (stable UUID) — NOT step number**
- `reachedMode: 'reached'` → `Step >= N` | `reachedMode: 'in'` → `Step == N`

### Condition Signal
- AND-combination of other signals

### Part Tracking (auto-generated)
- Auto-generated from VisionSystem devices: `{deviceName}_Pass`, `{deviceName}_Fail`
- Not in `project.signals[]` — computed dynamically

---

## Store Patterns (useDiagramStore.js)

```js
// CORRECT — read fresh state with get() inside action
updateFoo(id, val) {
  get()._pushHistory();
  const sm = get().project.stateMachines.find(s => s.id === smId);
  set(s => ({ project: { ...s.project, stateMachines: [...] } }));
}
```
- Always use `get()` inside actions — never stale closures
- Always call `get()._pushHistory()` before any mutating action
- History capped at 50; `_past`/`_future` NOT persisted (session-only)
- `_connectMenuNodeId`, `_connectMenuHandleId`, `_connectPreset` — all cleared together

---

## Canvas.jsx Key Patterns

### State Number Computation
```js
const { stateMap, visionSubStepsMap } = computeStateNumbers(smNodes, smEdges);
```
- DFS from initial node → step 1, 4, 7, 10...
- Vision Inspect nodes get 4 sub-states
- Outgoing edges sorted LEFT → RIGHT by target X before DFS
- Snap-to-vertical threshold: 25px

### Edge Render Mapping
```js
const isDecisionExit = e.data?.isDecisionExit === true && e.sourceHandle !== 'exit-single';
```
- `exit-single` excluded from colored styling — renders as plain gray
- Live labels computed via `computeExitLabels()` from source decision node config

---

## L5X Output Architecture (Layered)

| Layer | Contents | Gate |
|-------|----------|------|
| **L1 — Infrastructure** | `StateLogicControl`, `StateLogicStatus`, `PartTracking` UDTs; `State_Engine_128Max` AOI; `ProgramAlarmHandler` AOI | Always emitted |
| **L2 — Station-type template** | Init state skeleton 100→...→127 | Keyed on `sm.stationType` |
| **L3 — Per-device blocks** | Device UDTs/AOIs, tags, R01 inputs, R04/R05 servo | One block per declared device |
| **L4 — Flowchart-compiled logic** | R02 transitions + R03 OTL/OTU | DFS over nodes/edges |
| **L5 — Always-on boilerplate** | Lockout 99, HMI_Toggle decode, SS_OK, CPU_TimeDate_wJulian | Always emitted |

### Routines Per SM
- **R00_Main** — JSR calls to R01, R02, R03 (+ R04/R05 when servos, + R20 Alarms)
- **R01_Inputs** — HMI_Toggle decode, SS_OK, debounce, lockout, 1-sensor invert
- **R02_StateTransitions** — Step change conditions
- **R03_StateLogic** — OTL/OTU per step
- **R04/R05_{axis}Servo** — Per servo axis (MSO/MSF/MAFR/MASR/MAJ/MAS/MAH/MAM/GSV)
- **R20_Alarms** — ProgramAlarmHandler AOI + fault OTEs

### Reserved State Numbers
| State | Meaning |
|-------|---------|
| 0 | Pre-init / powerup |
| 1, 2, 3 | Reserved for future SDC use |
| 99 | Lockout (HMI_Toggle.0 → MOV 99) |
| 100–127 | Station-type init block |
| 127 | Init-complete / cycle-ready gate |

### SDCStandardPNP Init Template
- State 100: Retract Z → goto 103 (gripper open) or 106 (gripper closed)
- State 103: Retract X (empty return) → 124
- State 106: Extend X (carrying part) → open gripper → 124
- State 124: Known safe state → 127
- State 127: Cycle-ready → flowchart first step

### Servo Architecture
- Controller-scope: `a{NN}_S{station}{name}` (AXIS_CIP_DRIVE), `MotionGroup`
- Program-scope: `iq_{name}` InOut, `HMI_{name}` (ServoOverall UDT)
- Motion instances: `MSO_`, `MSF_`, `MAFR_`, `MASR_`, `MAJ_`, `MAS_Jog`, `MAH_`, `MAM_Auto`
- Support tags: `{Name}Ready`, `{Name}Permissive`, `{Name}AutoEnable`, `{Name}HomeConfimed` *(sic)*, `{Name}HomeRequested`
- Positions: `HMI_{name}.Parameters.Positions[N]` — stable indices, never reshuffled on delete

### R01_Inputs Boilerplate Order
1. HMI_Toggle decode (`.0`=Lockout, `.1`=DryRun, `.2`=SS)
2. SS_OK derivation
3. HMI_Momentary auto-clear (one rung per bit)
4. 1-sensor pneumatic invert (flagged devices only)
5. AOI_Debounce calls (DigitalSensor devices only — NOT pneumatic position sensors)
6. CPU_TimeDate_wJulian call

---

## React Flow v12 Specifics

- `useReactFlow()` for programmatic control; `useStore()` for internal RF state
- `Handle` with no `id` prop = null handle; `id="foo"` = named handle
- Edge `sourceHandle`/`targetHandle` must EXACTLY match Handle `id` — mismatch = invisible edge
- `node.measured?.width` = actual rendered width (after first layout)
- `createPortal(content, document.body)` needed to escape RF z-index stacking for overlays
- `onNodeClick` fires for any part of the node unless `stopPropagation` called in a child
