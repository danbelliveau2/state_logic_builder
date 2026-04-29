# Design Decisions — SDC State Logic Builder

Why we chose X over Y. These are ADRs (Architecture Decision Records) for non-obvious choices.

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
| 2-solenoid gripper as default | SDC standard; single-solenoid spring-return is the exception and is authored manually |
| AOI_Debounce on DigitalSensor only | Pneumatic position sensors are conditioned by state logic; robot signals go through robot interface block |
| `autoInstallOnAppQuit = false` in electron-updater | Prevents double-trigger of NSIS uninstaller; explicit `quitAndInstall()` in `update-downloaded` is the single install trigger |
| Package.json version bump = release trigger | Decouples feature commits from releases; bumping every commit caused NSIS corruption incident (April 2026) |
