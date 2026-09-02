> **AI sessions: ALWAYS read this file first.** It maps tasks → files. Probing
> the codebase without reading this is wasted time.

# WHERE TO FIND THINGS

If your task isn't listed here, use the **Explore sub-agent** — don't probe.

---

## Common tasks (most-frequent first)

### v3 — the SEQUENCE section IS the v1 canvas (Dan, 2026-09-02)
- Embedded canvas per machine (Expand ↗ full-window, device sidebar) → `v3/SequenceCanvas.jsx`
- Sheet machine ↔ SM record, ONE-TIME migration on first open        → `v3/sequenceSm.js` (`ensureMachineSm`, `findMachineSm`; stamps `machineSpec.canvasAuthoritative` + `machineSpec.v3`)
- Structured steps (Decide/Loop lane grid) → v1 nodes/edges         → `v3/compileLaneFlow.js`
- Where the sheet mounts it                                          → `components/jarvis/CreateStationPage.jsx` (search `SequenceCanvas`)
- Opening a v3-created SM lands on ITS DRAFT (never a twin sheet)    → `v2/openStation.js` (`v3DraftIdOf`)
- Canvas modals in the shell                                         → `v2/AppV2.jsx` (AddDeviceModal / ActionModal / RecipeManagerModal)
- **RETIRED for sequences:** the `SheetFlow mode="seq"` lane render (SheetFlow stays for the Initialization panel only); the chat pill's free-text authoring input (Questions/receipts/ME-CE only — authoring = canvas + INPUTS + Open in Claude Code).
- Entries: `index.html` → v3 (default); `v2.html` frozen v2; `classic.html` frozen v1.

### v2 shell — opening a station / adding a station (ONE DOOR, 2026-09-02)
- THE only opener            → `v2/openStation.js` (`openStationSheet`, `openFreshStationDraft`, `isClassicStation`, `migrateSmToCascade`)
- The station sheet          → `components/jarvis/CreateStationPage.jsx` (embedded for built stations, full-viewport for fresh drafts; the INPUTS band holds the explanation editor before the proposal)
- v1 canvas stations in v2   → `v2/ClassicStationCard.jsx` (read-only card → /classic.html)
- Shell composition + landing → `v2/AppV2.jsx`; banner (crumb + identity only) → `v2/StationBanner.jsx`
- Gate                       → `v2/layoutInvariants.js` (`no-legacy-surface-in-v2`, `add-station-opens-cascade`, `reload-lands-on-sheet`)
- **DELETED — do not re-add a door:** the classic canvas mount in v2, the Spec Sheet|Diagram pill, `DiagramSubBar` (Sequence|Controls detail, ⚙ Compile, ✨ Generate), `ControlsFlowView`/`controlsFlowDerive`, `GenerationResultCard`, `CompileSequenceModal`, the Generate-modal mount, the `SpecEditorModal` tree line, the summarize-era intake form ("Explain this station like you would…", "Done explaining →"), the unfinished-drafts banner, the EXPLANATION coverage strip, the init-time `autoGenerateIndexerSM` (S99 Dial_Indexer). The classic canvas lives ONLY at `/classic.html` (frozen, `src/main.jsx`).

### JARVIS Inbox librarian (learning from dropped/network files)
- Classify/distill/file logic → `lib/agentGenerator/librarian.js` (local inbox + network watch folders)
- Server routes + daily timer → `server.js` (search `librarian`)
- "Learn now" panel (Knowledge tab) → `components/jarvis/JarvisPage.jsx` (search `InboxLibrarianPanel`)
- Watch-list / batch config   → `jarvis-knowledge/inbox-sources.json`

### Adding / editing an operation (Extend, ServoMove, etc.)
- Operation list + colors    → `components/nodes/StateNode.jsx` (search `OPERATION_COLORS`)
- Action UI row              → `components/nodes/StateNode.jsx` (search `function ActionRow`)
- Operation switcher dropdown → `components/nodes/StateNode.jsx` (search `OperationSwitcher`)
- Inline picker (multi-step)  → `components/nodes/StateNode.jsx` (search `function InlinePicker`)
- Tag generation             → `lib/tagNaming.js`
- L5X codegen                → `lib/l5xExporter.js` (search `R03_StateLogic`)
- Sensor/timer detection     → `lib/conditionBuilder.js`

### Adding a new node type
- Render component           → `components/nodes/<Name>Node.jsx`
- Store action               → `store/useDiagramStore.js` (Node section — see ToC at top)
- Decision branch wiring     → `store/useDiagramStore.js` (search `addDecisionBranches`, `addDecisionSingleBranch`)
- Add to canvas type registry→ `components/Canvas.jsx` (search `nodeTypes`)

### Edge routing changes
- Auto-route geometry        → `lib/edgeRouting.js`
- Visual render              → `components/edges/RoutableEdge.jsx`
- Connection menu / preset wp→ `components/ConnectMenu.jsx`
- Manual draw overlay        → `components/edges/ManualDrawOverlay.jsx`

### Decision / Wait / Verify nodes
- Render + popup             → `components/nodes/DecisionNode.jsx`
- Branch creation actions    → `store/useDiagramStore.js` (search `addDecision`, `addVision`)
- Exit edge label sync       → `store/useDiagramStore.js` (search `syncDecisionExitLabels`)
- Verify device wiring       → `store/useDiagramStore.js` (search `findOrCreateVerifyDevice`, `addVerifyCondition`)

### L5X export — adding / fixing a routine
- Everything routine-level   → `lib/l5xExporter.js` (search `R00_Main`, `R01_Inputs`, `R02_StateTransitions`, `R03_StateLogic`, `R20_Alarms`, `generateRecoveryRoutine`)
- Servo R04/R05              → `lib/l5xExporter.js` (search `generateServoAxisRoutine`)
- State_Engine_128Max AOI    → `lib/l5xExporter.js` (search `function generateAOI`)
- UDT definitions            → `lib/l5xExporter.js` (search `generateDataTypes`)
- Tag generation (per-SM)    → `lib/l5xExporter.js` (search `generateAllTags`)
- XML primitives + escape    → `lib/l5xExporter.js` (search `escapeXml`, `buildRung`, `buildBoolTagXml`)
- ZIP / download             → `lib/l5xExporter.js` (search `buildZipBlob`, `downloadL5X`)
- Supervisor program export  → `lib/supervisorL5xExporter.js`
- Controller-level export    → `lib/controllerL5xExporter.js`

### Adding a new device type
- Type constant              → `lib/deviceTypes.js`
- Library entry              → `lib/deviceLibrary.js`
- Icon                       → `components/DeviceIcons.jsx`
- Tag-naming rules           → `lib/tagNaming.js`
- Add device modal options   → `components/modals/AddDeviceModal.jsx`
- Library picker             → `components/modals/DeviceLibraryPicker.jsx`
- L5X tag generation         → `lib/l5xExporter.js` (search `generateAllTags`)

### Project / state-machine actions
- All store actions          → `store/useDiagramStore.js` (see ToC at top of file)
- Save/load JSON             → `lib/projectApi.js` (server REST + `exportProjectJSON` Ctrl+S save — both shells)

### Standards library
- Local cache + sync         → `lib/standardsLibrary.js`
- Server API                 → `lib/standardsApi.js`
- Standards view             → `components/StandardsView.jsx`
- Standards profile editor   → `components/StandardsProfileEditor.jsx`

### Signals (position, state, condition)
- Store actions              → `store/useDiagramStore.js` (search `addSignal`, `updateSignal`)
- Picker UI                  → `components/modals/SignalModal.jsx`

### Part tracking
- Field CRUD + roles         → `store/useDiagramStore.js` (search `addTrackingField`, `addPartTrackingCustomRole`)
- Auto-derive PT from SM     → `lib/partTracking.js`
- L5X PT UDT generation      → `lib/l5xExporter.js` (search `PartTracking_UDT`)
- PT panel UI                → `components/PartTrackingPanel.jsx`

### Modals (every dialog the user sees)
All under `components/modals/`:
- `AddDeviceModal.jsx`, `CustomDeviceConfigurator.jsx`, `DeviceLibraryPicker.jsx`
- `ActionModal.jsx`, `NewStateMachineModal.jsx`
- `ProjectManagerModal.jsx`, `RecipeManagerModal.jsx`
- `SignalModal.jsx` (unified signals — replaced ReferencePositionModal + SmOutputModal, both deleted)

### Undo / redo / history
- All actions                → `store/useDiagramStore.js` (search `_pushHistory`, `undo`, `redo`)

### Selection / modal flags
- All UI flags + selection   → `store/useDiagramStore.js` (search `setSelectedNode`, `openActionModal`)

---

## Common helpers — DON'T reinvent these

| Helper                         | File                                  |
|--------------------------------|---------------------------------------|
| Tag naming (i_, q_, p_, etc.)  | `lib/tagNaming.js`                    |
| Build verify-text from action  | `lib/conditionBuilder.js`             |
| Step number assignment (DFS)   | `lib/computeStateNumbers.js`          |
| Edge auto-route + clearance    | `lib/edgeRouting.js`                  |
| Available inputs (sensors etc.)| `lib/availableInputs.js`              |
| React Flow zoom-aware sizing   | `lib/useReactFlowZoomScale.js`        |
| Outcome colors (pass/fail/etc) | `lib/outcomeColors.js`                |
| Entry rule resolution          | `lib/entryRules.js`                   |
| Index sync overrides           | `lib/indexSync.js`                    |
| Project save/load              | `lib/projectApi.js`                   |
| Standards library (local)      | `lib/standardsLibrary.js`             |
| Standards server API           | `lib/standardsApi.js`                 |
| Device type constants          | `lib/deviceTypes.js`                  |
| Device library (curated list)  | `lib/deviceLibrary.js`                |
| Part tracking auto-derive      | `lib/partTracking.js`                 |
| Device icons (SVG)             | `components/DeviceIcons.jsx`          |

---

## Big-file ToCs

The three biggest files have a **table of contents at the top** mapping sections to line numbers:
- `store/useDiagramStore.js` (~4,900 lines) — see ToC at top
- `lib/l5xExporter.js` (~5,300 lines) — see ToC at top
- `components/nodes/StateNode.jsx` (~3,900 lines) — see ToC at top

**Read the ToC first** (`Read` with `limit: 60`), then jump to the section with `offset`/`limit`.
Do not read the whole file unless you genuinely need all of it.

---

## Planned restructure (in progress)

These files are scheduled to be split into smaller pieces. Once split, this section
will be replaced with the new file paths.

| File | Planned split |
|---|---|
| `store/useDiagramStore.js` | `store/slices/{project,stateMachine,device,node,edge,signal,partTracking,history,ui,recipe}Slice.js` |
| `lib/l5xExporter.js` | `exporter/{routines/R00_main,R01_inputs,R02_transitions,R03_stateLogic,recovery,AOI,servo}.js` + `xml.js`, `udts.js`, `tags.js`, `zip.js` |
| `components/nodes/StateNode.jsx` | `components/nodes/StateNode/{index,ActionRow,InlinePicker,OperationSwitcher,ContextMenu,operationColors}.jsx` |

---

## When in doubt

- Open the per-folder **CLAUDE.md** for that area
- Use the **Explore sub-agent** for cross-cutting questions
- Read the ToC at the top of any large file before reading the body
