# SDC State Logic — Active Work Tracking

> **Purpose:** Persistent record of current work, decisions made, and bugs found.
> AI agents MUST read this file at the start of every session to understand context.
> Update this file as work progresses.

---

## Current State (2026-04-18)

### App Version: 1.8 (clean)
- Canvas.jsx, RoutableEdge.jsx, edgeRouting.js — **DO NOT TOUCH**. Edge routing/branching is fragile. Any changes break it. User has explicitly banned modifications to these files.
- Dev server: `cd C:\SDC-StateLogic && npm run dev` → http://localhost:5173

### Active Feature: PT/Signal Badge on Nodes

**Component:** `src/components/nodes/PtBadge.jsx`

**What it does:**
- Small circular badge on bottom-left of state/decision nodes
- Shows "S" (blue) when signals are PRODUCED at this node
- Shows "PT" (purple) when Part Tracking fields are annotated on this node
- Shows combo gradient when both
- Click to expand popup with details; edit mode to add/remove PT fields
- Always visible when content exists, not just when selected
- When selected and no content, shows dashed empty circle so user can add PT

**Signal detection rule:**
- ONLY show signals PRODUCED at a node: `signal.type === 'state' && signal.stateNodeId === nodeId`
- Do NOT show consumed signals (decision nodes waiting on a signal) — those are already shown in the node's main display text
- Legacy SM outputs: `smOutput.activeNodeId === nodeId`

**Files modified:**
| File | Change |
|------|--------|
| `src/components/nodes/PtBadge.jsx` | NEW — badge component |
| `src/components/nodes/StateNode.jsx` | +import + render PtBadge before source handles |
| `src/components/nodes/DecisionNode.jsx` | +import + render PtBadge before Handles section |
| `src/store/useDiagramStore.js` | +`updateNodePtAnnotations(smId, nodeId, annotations)` action |
| `src/index.css` | +`.pt-badge`, `.pt-popup` styles at end of file |

**Badge sizing:** 34px circle, font-size 12px for label

**Known constraints:**
- Badge positioned `bottom: -12px; left: -12px` (absolute within node)
- Popup uses `createPortal(document.body)` to escape React Flow stacking
- No viewport overflow check on popup (same as decision node popup)

---

### Completed Feature: Supervisor L5X Generation

**File:** `src/lib/supervisorL5xExporter.js` (643 lines)
- Fully complete, integrated into "Export All" ZIP pipeline
- Generates Supervisor program with state engine, mode switching, station ready/fault checks
- See plan file for full spec: `C:\Users\dbelliveau\.claude\plans\humble-wobbling-melody.md`

---

### Completed Feature: ProjectTabBar

**File:** `src/components/ProjectTabBar.jsx`
- Tab bar for switching between state machines
- Taller tabs, file picker for "+" button

---

## Edge Routing Changes (2026-04-18)

User-approved modifications to routing code:

### Phase 1: Side-handle auto-route fix (edgeRouting.js)
**Bug:** Side-handle exits (pass/fail from decision nodes) always created a simple L-bend `{x: tgt.x, y: src.y}` regardless of target position. When target was above (backward), the edge went through/behind other nodes.

**Fix:** Added backward detection to `isSideHandleExit` block in `computeAutoRoute()`. When target is backward:
- Pass handle (left) → routes left around diagram boundary
- Fail handle (right) → routes right around diagram boundary
- Creates proper U-shape: horizontal out → vertical up → horizontal across → vertical down into target

Forward side-handle exits still use the simple L-bend (unchanged).

### Phase 2: Connect Menu (NEW)
**Component:** `src/components/ConnectMenu.jsx`

A route direction picker that appears when a node is selected. Small arrow buttons near source handles:
- Bottom: ↓ (straight), ↰ (loop left), ↱ (loop right)
- Side handles (decision 2-exit): ↙/↘ (forward), ↰/↱ (loop back)

**Flow:** Click direction → "Click target node" mode → click target → edge created with computed waypoints.

**Files modified:**
| File | Change |
|------|--------|
| `src/lib/edgeRouting.js` | Side-handle backward routing fix in `computeAutoRoute()` |
| `src/components/ConnectMenu.jsx` | NEW — direction picker + `computePresetWaypoints()` |
| `src/components/Canvas.jsx` | +import ConnectMenu, +`finalizePresetConnect()`, Escape/pane-click cancels preset |
| `src/components/nodes/StateNode.jsx` | +import + render ConnectMenu when selected |
| `src/components/nodes/DecisionNode.jsx` | +import + render ConnectMenu when selected |
| `src/store/useDiagramStore.js` | +`_connectPreset` state field |
| `src/index.css` | +`.connect-menu` styles |

### DO NOT TOUCH (still applies)
- `src/components/edges/RoutableEdge.jsx` — NO changes made, still fragile

---

## Known Bugs (not being worked on)

| Bug | Location | Notes |
|-----|----------|-------|
| Branch shape on node move | RoutableEdge.jsx | Moving decision node distorts branch shape |
| Draw Path mode broken | Canvas.jsx | User-drawn shapes not preserved; snaps to wrong shape. Pre-existing issue, not caused by PT badge work. DO NOT attempt to fix without explicit user request. |
| Popup viewport overflow | DecisionNode.jsx | Far-right nodes cause popup to go off-screen |

---

## Session Log

### 2026-04-18 — PT/Signal Badge
- Created PtBadge.jsx component
- Added to StateNode and DecisionNode renders
- Fixed: signal detection was showing consumed signals on decision nodes (removed — only show produced signals)
- Fixed: badge label now "S" for signals, "PT" for part tracking (was generic)
- Fixed: DecisionNode was missing PtBadge render JSX (lost during stash/restore)
- Fixed: badge size increased from 28px to 34px per user feedback
- Redesigned popup: now purely informational (no editor, no "Part Tracking" section when empty). Shows signal name + trigger mode ("Once reaching this state"), PT annotations only when they exist.
- Fixed: ProjectTabBar "+" button was calling missing `openProjectFromFile` — added the function to store. Opens project in NEW tab (snapshots current tab first), doesn't replace current project.
- Phase 1: Fixed side-handle auto-route in edgeRouting.js — backward edges from pass/fail handles now route correctly around diagram edges instead of through nodes.
- Phase 2: Added ConnectMenu — directional arrow buttons on selected nodes for creating edges with preset routing. Click direction → click target → done.
