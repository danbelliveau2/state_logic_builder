# SDC State Logic Builder — Implementation Prompt
## Three Features to Add

Paste this entire prompt into Claude Code.

---

## Context

You are working on the SDC State Logic Builder — a React app at `C:\SDC-StateLogic`.
Stack: React 18, @xyflow/react, Zustand, Vite, Express backend.
Key files:
- `src/store/useDiagramStore.js` — Zustand store (all state lives here)
- `src/components/modals/AddDeviceModal.jsx` — device setup modal
- `src/components/DeviceSidebar.jsx` — left sidebar
- `src/components/nodes/StateNode.jsx` — canvas node rendering
- `src/lib/deviceTypes.js` — device type definitions
- `src/lib/availableInputs.js` — builds condition/input picker lists
- `src/lib/l5xExporter.js` — L5X XML generator

Read PROJECT_HISTORY.md before starting. Understand the existing data model fully before touching any file.

---

## Feature 1: Reference Positions

### What it is
A project-level panel (like Part Tracking) where the ME defines named "robot positions" by combining multiple servo axes at specific positions.

Example: "PickPos" = { XAxis: 150mm, YAxis: 0mm, ZAxis: 50mm }

This represents a meaningful machine position that multiple state machines can reference.

### Data model (add to Zustand store)
```js
referencePositions: [
  {
    id: uuid(),
    name: "PickPos",           // ME-defined name
    description: "",           // optional
    axes: [
      { axisDeviceId: "...", positionName: "Pick" },  // links to existing servo position
      { axisDeviceId: "...", positionName: "Home" },
    ]
  }
]
```

Each axis entry links to an existing servo device (by deviceId) and one of its named positions (by position name string).

### UI
- New collapsible panel in DeviceSidebar below Part Tracking: **"REFERENCE POSITIONS"** with `+ Add` button
- Click `+ Add` → modal opens:
  - Name field (text input)
  - Description field (optional)
  - Table of axis rows: each row = dropdown (pick from servo devices in this SM) + dropdown (pick from that servo's positions)
  - `+ Add Axis` button to add rows
  - Delete row button per row
  - Save / Cancel
- Click existing reference position to edit
- X button to delete

### How it appears in sequence flow
In the node action picker (InlinePicker), when ME is adding a "Wait" step:
- New section: **"Wait for Reference Position"**
- Lists all defined reference positions by name
- Selecting one adds a node: `Wait: [PickPos]`
- On canvas node displays as: yellow "WaitRef" badge + text "At: PickPos"

### L5X export behavior
For each reference position used in a Wait step, generate:
- A conditional BOOL tag `p_At[RefPositionName]` 
- A rung in R01_Inputs that evaluates TRUE when ALL axes are within tolerance of their target positions
- Use existing servo position tolerance values from each servo device definition
- In StateTransitions: `XIC(p_AtPickPos)` as the transition condition

---

## Feature 2: SM Outputs

### What it is
Each state machine can declare named "outputs" — signals it publishes for other state machines to consume. This replaces the need for MEs to manually create, set, and clear public parameters.

### Data model (add per state machine in Zustand store)
```js
smOutputs: [
  {
    id: uuid(),
    name: "PickComplete",      // ME-defined name, becomes p_[name] tag
    description: "",
    triggerNodeId: "...",      // which canvas node sets this ON
    clearNodeId: "...",        // which canvas node sets this OFF (optional)
    autoClear: true,           // if true, clears on return to State 1 (cycle reset)
  }
]
```

### UI — defining outputs
- New collapsible panel in DeviceSidebar: **"SM OUTPUTS"** with `+ Add` button
- Click `+ Add` → modal:
  - Name field
  - Description field
  - "Set ON at step:" dropdown — lists all current canvas nodes by their step label/number
  - "Clear ON at step:" dropdown — same list + "Auto (cycle reset)" option
  - Save / Cancel
- Existing outputs listed with edit/delete
- On the canvas, nodes that trigger an SM Output show a small green arrow-out badge

### How other SMs consume outputs
In InlinePicker when adding a Wait step:
- New section: **"Wait for SM Output"**  
- Shows outputs from ALL other state machines grouped by SM name
- Format: `S05_StamperPNP → PickComplete`
- Selecting adds a node: `Wait: S05 → PickComplete`
- Canvas displays: blue "WaitSM" badge + "S05:PickComplete"

### L5X export behavior
For each SM Output:
- Declare `p_[OutputName]` as a Public BOOL tag in that program's Tags section
- In R03_StateLogic: `XIC(Status.State[N]) OTL(p_OutputName);` at the trigger state
- If clearNodeId set: `XIC(Status.State[M]) OTU(p_OutputName);` at clear state  
- If autoClear: add OTU rung at State 1 (the reset/complete state)
- In consuming SM's StateTransitions: `XIC(\S05_StamperPNP.p_PickComplete)`

---

## Feature 3: Cleanup — Remove Manual Parameter Nodes from Normal Flow

### What to change
The current "Parameter" device type (Latch / Conditional) should still exist for advanced/edge cases, but:

1. **Hide Parameters from the main InlinePicker action list** — move them behind an "Advanced →" disclosure button at the bottom of the picker
2. **Add visual indicator** on sidebar Parameter items: small warning badge if a parameter is defined but not referenced by any SM Output or Reference Position (means ME created it manually and may not need to)
3. **In the node action picker**, the top-level sections should now be:
   - Pneumatic actions (Extend, Retract, etc.)
   - Servo actions (Move, Index, etc.)  
   - Vision (Inspect)
   - Timer / Dwell
   - Wait for Reference Position ← NEW
   - Wait for SM Output ← NEW
   - Cross-SM (Wait for other SM state) — existing, keep
   - Part Tracking — existing, keep
   - ── Advanced ──
   - Parameters (SetOn, SetOff, WaitOn, WaitOff) ← moved here

---

## Implementation Order

1. **Data model first** — add `referencePositions` and `smOutputs` to Zustand store with proper initialization, migration handling for existing saved projects (default empty arrays)
2. **Reference Positions UI** — sidebar panel + modal
3. **SM Outputs UI** — sidebar panel + modal  
4. **InlinePicker integration** — add both new sections to picker
5. **Canvas node rendering** — new badge types (WaitRef, WaitSM, output indicator)
6. **L5X exporter** — generate correct tags and rungs for both features
7. **Picker cleanup** — move Parameters to Advanced section

---

## SDC Coding Standards to Follow in L5X Output

- Tag prefixes: `i_` input, `q_` output, `p_` public parameter, local = no prefix
- PascalCase all tag names
- State numbers increment by 3 (each ME node = 3 states)
- Fault timeout → State 127 always
- Cross-SM reference format: `\ProgramName.p_TagName`
- Each program has R00_Main, R01_Inputs, R02_StateTransitions, R03_StateLogic routines
- StateLogic uses latched OTE pattern for cylinders: extend ON at state N, retract = XIO(q_Ext)
- Vision sequence always 4 states: VerifyTrigRdy → WaitTimer → Trigger → TrigDwell → advance

---

## Do Not Break

- Existing servo position card UI (absolute/incremental/index tabs)
- Vision node single-node expand behavior  
- Part Tracking panel and PT actions
- Cross-SM picker (existing functionality)
- Project save/load (add new fields with defaults, don't break existing JSON)
- Edge routing (straight lines, loop-back arcs)
- SDC color palette

---

## Test Case

After implementation, the ME should be able to build this sequence without touching any parameter:

1. PNP servo moves to PickPos (reference position)
2. Stamper waits for `S05 → PNPAtPickPos` output
3. Stamper extends cylinder
4. Stamper triggers camera
5. Camera pass → Stamper sets `PickComplete` output → PNP reads it and advances
6. Camera fail → route to cycle complete with fail flag

Zero manual parameter nodes. Zero SetOn/SetOff nodes. All p_ tags auto-generated on export.
