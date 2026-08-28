# Branching & Edge Routing Scenarios

> **Purpose:** Define every edge routing case so the rules are explicit.  
> **How to use:** For each scenario, the "Current" column shows what happens now. Fill in the "Rule" column with what SHOULD happen. Add sketches or screenshots if helpful.

---

## 1. Source Handle Types

Edges can originate from different handles on different node types:

| # | Source Handle | Node Type | Position on Node |
|---|-------------|-----------|-----------------|
| 1a | Bottom (default) | StateNode | Bottom center |
| 1b | Bottom (exit-single) | DecisionNode (1 exit) | Bottom center |
| 1c | Left (exit-pass) | DecisionNode (2 exit) | Left center |
| 1d | Right (exit-fail) | DecisionNode (2 exit) | Right center |
| 1e | Bottom (exit-retry) | DecisionNode (retry) | Bottom center |

**Question:** Should the edge ALWAYS exit straight out of the handle (vertical from bottom, horizontal from side) before any turns? Currently side handles sometimes produce a jog that overlaps the node.

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 2. Forward Edges (target is BELOW source)

### 2a. Straight down (target aligned with source)
```
  [Source]
      |
      |
      v
  [Target]
```
**Current:** Works fine. Straight line, no waypoints.  
**Rule:**  
_[Confirm this is correct, or modify]_

### 2b. Forward with lateral offset (target is below AND to the left/right)
```
  [Source]          [Source]
      |                 |
      +---+         +---+
          |         |
          v         v
      [Target]  [Target]
```
**Current:** Z-bend — goes down to midpoint Y, horizontal to target X, then down. Sometimes the horizontal segment overlaps nodes in between.  
**Question:** Should it always be a Z-bend? Or should it be an L-bend (straight down then horizontal, or horizontal then straight down)? Should it avoid crossing over other nodes?

**Rule:**  
_[YOUR ANSWER HERE]_

### 2c. Decision pass/fail exit forward (side handle, target below)
```
  [Decision]---+
               |
               v
           [Target]
```
**Current:** L-bend — horizontal out from side handle, then vertical down to target. Works when target is directly below the handle exit direction, but can look wrong when target is on the opposite side.  
**Question:** What if pass (left handle) target is to the RIGHT of the decision node? Should it still exit left first, or go under the node to the right?

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 3. Backward Edges (target is ABOVE source)

### 3a. Backward from bottom handle, target is above-left
```
          [Target]
              ^
              |
  +---+-------+
  |   
  +---+
      |
  [Source]
```
**Current:** U-bend goes down from source, out to one side (currently picks wrong side), up past target, across to target. The side selection uses diagram-center heuristic which frequently picks the wrong direction.  
**Question:** If target is to the LEFT, should the U-bend always go LEFT? What if there are nodes in the way on the left?

**Rule:**  
_[YOUR ANSWER HERE]_

### 3b. Backward from bottom handle, target is above-right
```
  [Target]
      ^
      |
      +-------+---+
                   |
              +----+
              |
          [Source]
```
**Current:** Same issue as 3a — picks wrong side.  
**Question:** Mirror of 3a — should always go right?

**Rule:**  
_[YOUR ANSWER HERE]_

### 3c. Backward from bottom handle, target is directly above (aligned X)
```
  [Target]
      ^
      |
  +---+
  |
  +---+
      |
  [Source]
```
**Current:** Picks a side based on diagram center. Often wrong.  
**Question:** When source and target are vertically aligned, which side should the U-bend go? Left by default? Closest side with room? Should the user choose?

**Rule:**  
_[YOUR ANSWER HERE]_

### 3d. Backward from side handle (decision pass/fail exit going up)
```
  [Target]
      ^
      |
  +---+
  |
  +---[Decision]
```
**Current:** Fixed in Phase 1 — pass handle goes left, fail handle goes right. But the routing still uses diagram-edge bounds which can go very wide.

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 4. Sideways Edges (target at roughly same Y level)

### 4a. Target is to the right, same height
```
  [Source]---->[Target]
```
**Question:** Direct horizontal? Or should it drop down and come up into the target's top handle? (Since target handle is always on top)

**Rule:**  
_[YOUR ANSWER HERE]_

### 4b. Target is to the left, same height
```
  [Target]<----[Source]
```
**Question:** Same question — the target's input is on TOP, so a horizontal line can't reach it. How should this route?

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 5. Edge-Node Overlap Rules

### 5a. Can an edge cross over another node?
**Current:** No avoidance. Edges frequently cross over unrelated nodes.  
**Question:** Is this acceptable? Or should edges always route around other nodes? (Node avoidance is significantly more complex to implement.)

**Rule:**  
_[YOUR ANSWER HERE]_

### 5b. Can an edge overlap the source or target node?
**Current:** Sometimes the first segment of a side-handle exit overlaps the decision node body itself (the "jog" issue from pic 2).  
**Question:** The first segment from a handle should ALWAYS clear the node body before turning?

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 6. Edge Appearance

### 6a. Where should the label go?
**Current:** Labels on backward edges are on the outer vertical segment. Labels on forward edges are at the midpoint.  
**Question:** Is this correct? Any cases where label placement is wrong?

**Rule:**  
_[YOUR ANSWER HERE]_

### 6b. Edge spacing — parallel edges
**Current:** When two edges run parallel (e.g., pass and fail branches both going down), they can overlap visually.  
**Question:** Should parallel edges be offset from each other? By how much?

**Rule:**  
_[YOUR ANSWER HERE]_

### 6c. Minimum clearance from nodes
**Current:** Edges can run right along a node's border.  
**Question:** Should there be a minimum gap (e.g., 20px) between an edge path and any node it passes near?

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 7. Connection Method Preference

### 7a. Primary connection method
**Current:** Drag from handle → enters manual draw mode → click target.  
**Question:** Should ConnectMenu be the PRIMARY way to connect? (Click handle dot → pick direction/target.) Or should drag also work?

**Rule:**  
_[YOUR ANSWER HERE]_

### 7b. ConnectMenu directions
**Current:** New Node (down, down-left, down-right) + Connect (loop-left, loop-right).  
**Proposed additions:**
- Connect Below (straight down to existing node)
- Connect Below-Left / Below-Right
- Or just one "Connect" option where you click the target and the app picks the route based on relative position?

**Rule:**  
_[YOUR ANSWER HERE]_

---

## 8. Decision Node Branch Creation (auto-created on popup Done)

### 8a. Single exit (Wait for Pass/True)
```
  [Decision]
      |
      v
  [Pass_X]  (green edge, exit-single handle)
```
**Current:** Works correctly.  
**Rule:**  
_[Confirm or modify]_

### 8b. Dual exit (Branch Pass/Fail or True/False)
```
        [Decision]
       /          \
      v            v
  [Pass_X]    [Fail_X]
  (green)      (red)
```
**Current:** Pass node placed 280px left, fail 280px right. Pass from left handle, fail from right handle. L-bend routing.  
**Question:** Is 280px the right offset? Should it be closer? Should it adapt based on nearby nodes?

**Rule:**  
_[YOUR ANSWER HERE]_

### 8c. Dual exit + Retry
```
        [Decision]
       /    |      \
      v     v       v
  [Pass] [Retry]  [Fail]
```
**Current:** Retry goes straight down from bottom handle.  
**Rule:**  
_[Confirm or modify]_

---

## 9. When Nodes Move

### 9a. Moving a node that has edges
**Current:** `adjustTerminalRuns` stretches the first/last segments of manual routes. Middle waypoints are frozen. Sometimes this distorts the shape.  
**Question:** When you move a node, should edges: (a) stretch/shrink terminal segments only, (b) completely re-route, or (c) something else?

**Rule:**  
_[YOUR ANSWER HERE]_

### 9b. Moving a decision node with branches
**Current:** Known bug — moving decision node distorts branch shape instead of just lengthening horizontal segment.  
**Rule:**  
_[YOUR ANSWER HERE]_

---

## 10. Your Additional Scenarios

_Add any scenarios I missed here. Describe the setup and draw/describe what the correct routing should look like._

### 10a. _[Scenario name]_
**Setup:**  
**Correct routing:**  

### 10b. _[Scenario name]_  
**Setup:**  
**Correct routing:**  

---

*Generated by Claude — fill in the Rule fields and add scenarios. This becomes the spec for a routing rewrite.*
