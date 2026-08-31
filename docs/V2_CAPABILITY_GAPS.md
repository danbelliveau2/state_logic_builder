# V2 Capability Gaps — v1 features with no v2 home yet

> Companion to `docs/SIMPLIFICATION_PLAN.md` (answers its Q3–Q5).
> Dan's ruling: **rebuild everything from v1 into v2, clean and simple; v1 stays
> frozen at `/classic.html` exactly as it is.** Nothing here is built yet — this
> is the inventory for Dan to prioritize. Where sensible the proposed v2 home is
> **Jarvis-mediated** (describe the change, agent applies it) with a thin
> read-only view, per the operating principle: code does plumbing/checking,
> thinking lives with the agent.
>
> Written 2026-08-26, branch `v2-shell`. Until a row ships, the frozen classic
> shell remains the working surface for that capability.

| # | v1 capability | v1 home (frozen) | v2 today | Proposed v2-native approach |
|---|---|---|---|---|
| 1 | **Standards library browse/edit** — browse saved standards, rename, copy, categories, profile editor | `StandardsView.jsx` (414) + `StandardsProfileEditor.jsx` | Save-to-library star exists on `StationBanner`; **no browse/manage surface** (TopBarV2 deliberately renders no Standards tab) | Highest priority — standards are the *law* the agentic path runs on. A slim "Standards" page off the v2 top bar: read-only cards (name, category, devices, preview) + rename/copy/delete. Structural edits go Jarvis-mediated: "open" a standard into a station draft, describe changes, re-save. Reuse `standardsLibrary.js`/`standardsApi.js` as-is |
| 2 | **Node/edge properties panel** — context-sensitive right panel: labels, condition types, waypoints, device params | `PropertiesPanel.jsx` (705) | Removed by design (ContextPanelV2 deleted as dead); inline node editing covers most day-to-day edits | Decide intent first (plan Q4). Recommendation: **no panel comes back**. Inventory what only the panel can edit (edge condition type, manual waypoint reset, rare node flags) and give each an inline home on the node/edge popover; anything rarer goes through the Corrections chat ("make this edge a 3s timer") |
| 3 | **Machine config editor** — per-machine numeric config (station numbers, controller settings) | `MachineConfigEditor.jsx` (1,345) via classic ProjectSetup | No route. The **data** still matters — l5x export and Jarvis specs read `machineConfig` | Thin read-only "Machine settings" card on Project Home showing current values + one talk/type box → Jarvis edits the JSON (validated mechanically on apply). No 1,300-line form rebuild |
| 4 | **IO Map + Network editor** — address mapping table, EtherNet/IP topology, chassis/slots, IP summary | `IOMapEditor.jsx` (1,001) via classic ProjectSetup | No route (the orphaned read-only `IoMapView` was deleted as dead code) | Derived IO list already exists on the spec sheet ("Inputs & Outputs" strip). Add a read-only project-level IO/Network summary (grouped DI/DO/AI/AO + IP table) on Project Home; edits (rename module, change IP/RPI) are Jarvis-mediated against the stored config |
| 5 | **Classic L5X export buttons** — per-SM L5X, Export-All ZIP, controller-level L5X (deterministic exporter) | `Toolbar.jsx` export menu | Reachable via Jarvis page → FilesMenu (legacy exporters) | Keep only in FilesMenu until Dan answers plan Q1 (is Jarvis the only sanctioned codegen?). If yes: flag → delete the 6,892-line exporter family per Phase 2 |
| 6 | **Signals list / device sidebar detail** — per-SM device+signal browsing, part-tracking fields list | `DeviceSidebar.jsx` (609) | StationsPanel shows stations/devices tree; signals appear on spec-sheet cards | Fold remaining gaps (signal list per SM, PT field list) into the spec sheet's derived strips — no dedicated sidebar |
| 7 | **Version changelog view** — the ~975-line changelog array in the classic sidebar | `lib/version.js` (984) | v2 has its own `whatsNew.js` badge | Freeze `version.js` with the classic shell (do not port). Optionally archive to `docs/CHANGELOG_ARCHIVE.md` later per Phase 1 |
| 8 | **Dev-time tuning editors** — design-system/theme, picker grammar, icon alternatives, picker test subjects | `DesignSystemEditor.jsx` (849), `PickerGrammarEditor.jsx` (740), `IconAlternatives.jsx` (477), `PickerPreview`/`PickerTestSubjectManager` (~330) | No route | Declare **dev tools, not ME workflow** — they live on in the frozen classic shell at `/classic.html`; never ported. Record the decision and they fall with classic in Phase 4 |
| 9 | **Recipe manager** | `RecipeManagerModal.jsx` | Already wired into v2 (`AppV2.jsx` renders it) | No gap — verify a v2 entry point exists in the UI (menu/keyboard) and keep |
| 10 | **Standalone diagram editing extras** — multi-project tab bar behaviors, reorder popups, misc Toolbar utilities | `ProjectTabBar.jsx`, `Toolbar.jsx` | `TopBarV2` tab strip + FilesMenu cover the core; some utilities (SM reorder, recipe dropdown) unverified in v2 | Sweep Toolbar feature-by-feature when classic chrome is deleted (Phase 4); anything still missing gets a Build-menu or banner home |

## Suggested order (for Dan to confirm)

1. **Standards page** (#1) — blocks Phase 4; standards are core to the agentic law.
2. **Machine settings + IO/Network read-only views with Jarvis-mediated edits** (#3, #4) — the data feeds codegen today.
3. **Properties-panel gap inventory** (#2) — cheap audit, closes plan Q4.
4. **Decisions to record, zero code**: #5 (exporter fate), #7 (changelog), #8 (dev tools die with classic).
