# Known Issues — SDC State Logic Builder

## Active Bugs

| Bug | Location | Description |
|-----|----------|-------------|
| Popup viewport overflow | `DecisionNode.jsx` | Popup positioned `rect.right + 8` with no right-edge overflow check; disappears off-screen on far-right nodes |
| Label midpoint on manual waypoints | `RoutableEdge.jsx` | After user manually moves edge waypoints, label may not stay at true midpoint of vertical segment |
| Stale L-bend waypoints on old edges | stored project data | Edges created before the exit-single routing fix have stale L-bend waypoints stored as `manualRoute: true` — delete and re-draw to fix |

---

## Hardcoded Values to Eventually Parameterize

| Value | Location | Notes |
|-------|----------|-------|
| Step base = 1, increment = 3 | `l5xExporter.js` | SDC standard, unlikely to change |
| Vision sub-state count = 4 | `l5xExporter.js`, `Canvas.jsx` | Fixed 4 sub-states per vision inspect |
| Node width = 240px | `DecisionNode.jsx`, `RoutableEdge.jsx` | Used in centering calculations |
| Snap threshold = 25px | `Canvas.jsx` | Distance for snap-to-vertical |
| Backward waypoint padding = 60px | `RoutableEdge.jsx` | Side clearance for U-routes |
| Fault time default = 5000ms | `l5xExporter.js` | SDC standard |
| Controller name = 'SDCController' | `l5xExporter.js` | Should come from project settings |
| Vision search timeout = 5000ms | `l5xExporter.js` | Should be per-device configurable |
| AOI_Debounce on/off times = 100ms | `l5xExporter.js` | Should be per-sensor configurable |
| Servo delay preset = 500ms | `l5xExporter.js` | Engineer adjusts post-export |
