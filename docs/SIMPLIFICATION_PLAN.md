# Simplification Plan

> **Dan's directive:** "Keep the code as simple as possible — let the agentic layer
> use the guidelines and standards. I don't want this to be a super hard-coded
> thing. I'm hoping we can remove a ton of code."
>
> **Operating principle:** code does **PLUMBING** (persistence, routing, rendering)
> and **CHECKING** (geometry, import-sim, validators, diffs). **THINKING** lives in
> agents + written knowledge (`meKnowledge.md`, `generationRules.md`,
> `jarvis-knowledge/concepts/`). See `docs/HOW_JARVIS_BUILDS_A_STATION.md`.
>
> Audit date: 2026-08-25, branch `v2-shell`, JARVIS v1.4.0. READ-ONLY audit — no
> code was changed. Every DEAD verdict below was verified by import grep.

---

## 1. The honest numbers

**Current total: ~87,700 lines** of JS/JSX (src 83,952 + server.js 3,473 + electron 292).

| Area | Lines | Notes |
|---|---|---|
| `src/lib` (excl. agentGenerator) | 14,762 | incl. l5xExporter 5,425 |
| `src/lib/agentGenerator` | 13,798 | the Jarvis pipeline |
| `src/components` (top level) | 13,106 | incl. Toolbar 945, UniversalPicker 1,990, MachineConfigEditor 1,345, IOMapEditor 1,001 |
| `src/components/jarvis` | 13,031 | incl. CreateStationPage 7,199, JarvisPage 2,616 |
| `src/components/nodes` | 10,580 | StateNode 6,423, DecisionNode 4,002 |
| `src/components/modals` | 7,297 | |
| `src/store` | 5,528 | useDiagramStore 5,497 |
| `src/v2` | 5,496 | the v2 shell |
| `server.js` | 3,473 | zero npm deps; persistence + all Jarvis routes + standards |
| `src/components/edges` | 435 | |
| `electron/` | 292 | |

**Ground truth on the two shells (matters for every phase below):**
- `vite build` inputs only `index.html` → **the production/Electron build ships the
  CLASSIC shell only**. `src/v2/` is dev-server-only today (`open: '/v2.html'`).
- The dev default is v2. Nothing switches shells at runtime; they are separate pages.
- If v2 is the future, `vite.config.js` needs `build.rollupOptions.input` to include
  `v2.html` — until then, deleting classic UI deletes the shipping app.

**The two independent L5X generation paths:**
1. **Classic deterministic exporter** — `l5xExporter.js` (5,425) +
   `controllerL5xExporter.js` (824) + `supervisorL5xExporter.js` (643) = **6,892
   lines**, in-browser, behind the Export buttons (classic Toolbar; v2 via Jarvis
   page → FilesMenu). **Zero references from server.js or agentGenerator/** —
   Jarvis does not use it.
2. **Jarvis pipeline** — the model authors a JSON edit plan; the deterministic
   merge engine applies it to a V4.2 template verbatim. This is the strategic path
   (new standards = law; old projects = reference only).

---

## 2. Module classification

Legend: **KEEP-P** = keep, plumbing · **KEEP-C** = keep, checking · **REPLACE** =
thinking encoded in code, superseded by agent + knowledge doc · **DEAD** =
unreferenced/superseded (grep-verified) · **LEGACY?** = live in classic only,
fate depends on Dan's classic-shell decision.

### agentGenerator (13,798 lines — mostly correct already)

| Module | Lines | Class | Notes |
|---|---|---|---|
| `client.js` | 1,155 | KEEP-P | generation loop, cost, SSE, resume — plumbing around agent calls |
| `mergeEngine.js` | 920 | KEEP-P | the only thing that turns an edit plan into bytes; byte-exact template surgery. Never agentic |
| `validator.js` | 1,499 | KEEP-C | the gates. Note: Rules 13–17/19 checks ARE encoded standards — but they must stay mechanical (a checker that thinks can be talked out of a defect). Rule text lives in `generationRules.md`; code just enforces |
| `importSimValidator.js` | 410 | KEEP-C | simulated Studio 5000 import. Never agentic |
| `ir.js` | 577 | KEEP-C | deterministic state-grid arithmetic + IR rendering. Never agentic |
| `coordinationAuthor.js` | 1,529 | KEEP-P | the compile (thinking) call + `renumberInlineOnGrid` / `validateCompiledIR` (checking) |
| `specAuthor.js` | 1,152 | KEEP-P | agent call + spec plumbing |
| `diagramAuthor.js` | 577 | KEEP-P | agent call |
| `promptBuilder.js` | 569 | KEEP-P | prompt assembly + cache breakpoints |
| `internalReviewer.js` / `diagramReviewer.js` | 640/596 | KEEP-P | agentic review passes |
| `preWriteStudy.js` | 414 | KEEP-P | study gathering + readiness gate |
| `correctionLearner.js` | 431 | KEEP-P/C | mechanical diff (checking) + one learning call |
| `codePatcher.js` | 322 | KEEP-P | $0 value patches + scoped section patch — built ON mergeEngine, not a rival |
| `verifyLoop.js` | ~200 | KEEP-P | DO→CHECK→REDO wrapper |
| `editPlanSchema.js` | 325 | KEEP-P | schema |
| `templatePatterns.js` | 541 | KEEP-C | derives structural invariants FROM the templates (anti-curation) — it is the replacement for hand-written rules, not a candidate |
| `editClassifier.js` | 469 | KEEP (deliberate) | deterministic-first edit routing exists to AVOID a model call (speed/cost). Replacing it with an agent costs latency. Keep; revisit if it misroutes |
| `questionRouter.js` | ~300 | **REPLACE** | pure keyword classifier deciding mechanical/controls/jarvis + addressee. Strongest agent+doc candidate in the repo: write the routing policy into `meKnowledge.md`/question policy, let the cheap-tier agent classify at queue time. Remaining plumbing: the queue store itself |
| `generationScope.js` | ~100 | **REPLACE** | hardcoded "covered / not yet" lists → a short section in `generationRules.md` (tiers already exist there), loaded as text |
| `buildScores.js`, `meKnowledge.js`, `jarvisVersion.js` | ~900 | KEEP-P | stores + knowledge loading + version identity |

**agentGenerator verdict: ~400 lines of REPLACE. The layer is already shaped right** —
thinking in prompts/knowledge, deterministic merge + validators as the floor.

### The legacy deterministic exporter family — the big REPLACE

| Module | Lines | Class |
|---|---|---|
| `lib/l5xExporter.js` | 5,425 | **REPLACE** (with caveats) |
| `lib/controllerL5xExporter.js` | 824 | **REPLACE** |
| `lib/supervisorL5xExporter.js` | 643 | **REPLACE** |

- **Superseded by:** the Jarvis pipeline (`coordinationAuthor` compile →
  `mergeEngine` translation), governed by `generationRules.md` + concepts + V4.2
  templates. Jarvis output is the SDC-standard-lawful path; the old exporter
  encodes an earlier, hand-maintained approximation of the standard.
- **What tiny plumbing must survive extraction (do NOT delete with it):**
  - `exportProjectJSON` — **save identity** for both shells (imported by
    `Toolbar.jsx` and `v2/AppV2.jsx` Ctrl+S). Move to `lib/projectApi.js`.
  - `buildZipBlob` / `crc32` download utilities if anything else needs zips.
- **Open question for Dan (see §5):** does the team still use the classic Export
  button for real work, or is Jarvis the only sanctioned codegen now? Until
  answered: archive behind a feature flag, don't delete.

### Dead code (grep-verified zero importers)

| File | Lines |
|---|---|
| `components/modals/CreateStationModal.jsx` (superseded by CreateStationPage — says so in its own header) | 490 |
| `components/modals/ReferencePositionModal.jsx` (superseded by SignalModal) | 232 |
| `components/IoMapView.jsx` (orphaned) | 170 |
| `components/modals/SmOutputModal.jsx` (superseded by SignalModal) | 121 |
| `v2/ContextPanelV2.jsx` (right panel removed from v2) | 37 |
| **Total** | **1,050** |

### Legacy classic-only clusters (live, but only via the classic shell)

| Cluster | Lines | Class |
|---|---|---|
| ProjectSetup config editors: `MachineConfigEditor` 1,345 + `IOMapEditor` 1,001 + `DesignSystemEditor` 849 + `PickerGrammarEditor` 740 + `IconAlternatives` 477 + `PickerPreview`/`PickerTestSubjectManager`/`pickerTestSubjects` ~330 + `ProjectSetup` 60 | ~4,800 | LEGACY? — v2 has NO route to any of these. DesignSystem/IconAlternatives/PickerGrammar editors are dev-time tuning tools, not ME workflow. MachineConfig/IOMap data still matters (l5x export + Jarvis specs read machineConfig) — the EDITORS are the question, not the data |
| Classic shell chrome: `Toolbar` 945 + `PropertiesPanel` 705 + `DeviceSidebar` 609 + `StandardsView` 414 + `ProjectTabBar` 123 | 2,796 | LEGACY? — duplicated by TopBarV2/DiagramSubBar/StationBanner (648), FeatureTreeV2+StationsPanel (740), v2 (no right panel by design). NOTE: `StandardsView` has no v2 home yet and standards are core to agentic law — needs a v2 surface before classic dies |
| `modals/JarvisDescribeModal.jsx` (Toolbar-only; v2 uses DescribeSurface) | 274 | LEGACY? |
| `lib/version.js` — ~975 lines of changelog ARRAY DATA, imported only by classic DeviceSidebar; v2 uses `whatsNew.js`/`buildMeta.js` | 984 | LEGACY? — data, not logic; move changelog to a .md/.json if history matters |

### Known duplications (classic ↔ v2)

- Project tab strip: `ProjectTabBar` vs `V2TabStrip` inside TopBarV2 (deliberate copy — comment admits it)
- Browser file-open fallback: **three copies** (Toolbar, StationsPanel, TopBarV2)
- Save handler + save-status: Toolbar `handleSaveProject` vs `AppV2` Ctrl+S (comment: "replicates Toolbar's")
- Error boundary: near-identical in App.jsx and AppV2.jsx
- Export closures: TopBarV2 Build handlers "replicate Toolbar's small export closures"

### Big KEEPs that are refactors, not deletions (out of scope here)

`CreateStationPage.jsx` 7,199 · `StateNode.jsx` 6,423 · `useDiagramStore.js` 5,497 ·
`DecisionNode.jsx` 4,002 · `JarvisPage.jsx` 2,616 · `UniversalPicker.jsx` 1,990 —
all KEEP-P (rendering/store plumbing). They're oversized files, not superseded
logic; splitting them (per `src/WHERE.md` planned restructure) changes no line
counts. Don't confuse "huge" with "deletable".

---

## 3. The phased shrink plan

Each phase is independently safe and independently shippable. Verify after each:
app boots (both shells while both exist), save→load round-trip byte-stable,
Jarvis benchmark passes, `vite build` succeeds.

### Phase 1 — Delete DEAD + archive changelog data (no behavior change)
- Delete the 5 zero-importer files (**−1,050**).
- Move `lib/version.js` changelog array to `docs/CHANGELOG_ARCHIVE.md` (or keep
  only the last few entries); DeviceSidebar keeps `APP_VERSION` from a 10-line
  module (**−950**).
- **Risk: none.** Verification: grep confirms zero importers (done in this audit);
  build + boot both shells.
- **Phase total: −2,000 → ~85,700.**

### Phase 2 — Archive the legacy deterministic exporter behind a flag
- Extract `exportProjectJSON` (+ zip utils if needed) into `lib/projectApi.js`
  first — **save identity must not move an inch**.
- Gate `downloadL5X` / `downloadAllL5XAsZip` / `downloadControllerL5X` UI behind a
  `LEGACY_EXPORT` flag (default per Dan's answer to Q1). Code stays in-repo,
  excluded from the bundle when off (dynamic import).
- When Dan confirms Jarvis-only: delete the family (**−6,892**, minus ~150
  extracted plumbing).
- **Risk: medium** — if any team member still exports classic L5X for real
  stations. That's exactly why it's a flag first, delete second.
- Verification: JSON save/load unchanged; Jarvis generate benchmark green;
  flag-on path still produces byte-identical L5X (snapshot one export before).
- **Phase total (at deletion): −6,750 → ~79,000.**

### Phase 3 — Collapse superseded rule paths in the agentic layer
- `questionRouter.js` classifier → question-routing policy paragraph in the
  knowledge docs + cheap-tier agent classification at enqueue; keep the queue
  store (**−~250**).
- `generationScope.js` lists → section in `generationRules.md` (**−~80**).
- Fold the three copies of the browser file-open fallback and the duplicate
  save handler into one shared helper (**−~150**).
- Explicit NON-candidates (leave alone): `templatePatterns.js` (derives law from
  templates — it deletes future rule-code), `editClassifier.js` (exists to avoid
  model latency), every validator check.
- **Risk: low.** Verification: question-queue behaves on the seeded questions
  (`scripts/seedJarvisQuestions.cjs`), benchmark green.
- **Phase total: −500 → ~78,500.**

### Phase 4 — Classic/v2 shell decision + dedup (needs Dan, Q2)
Blocked on: v2 becomes the shipped shell (`rollupOptions.input` + Electron/server
fallback to v2 page) AND a v2 home for Standards (and a call on MachineConfig/IOMap
editing).
- Delete classic chrome: Toolbar, PropertiesPanel*, DeviceSidebar, ProjectTabBar,
  App.jsx tree, JarvisDescribeModal (**−~3,100**). (*PropertiesPanel only if the
  "no right panel" v2 design is final — Q4.)
- Delete or port the ProjectSetup editor cluster (**−~4,800** if the tuning
  editors are declared dev-only tools and the two data editors get a thin v2
  surface or move to raw JSON + Jarvis-mediated editing — which IS the directive:
  describe the change, let the agent apply it).
- Delete `StandardsView` only after its v2 replacement exists.
- **Risk: highest of all phases** — this deletes the currently-shipping app.
  Sequence: flip the build to v2 → ship → soak → then delete classic.
- Verification: production build serves v2; Electron smoke test; every classic
  capability has a v2 route or a recorded decision that it dies.
- **Phase total: −7,900 → ~70,600.**

### Projection

| Milestone | Total lines |
|---|---|
| Today | ~87,700 |
| After Phase 1 | ~85,700 |
| After Phase 2 | ~79,000 |
| After Phase 3 | ~78,500 |
| After Phase 4 | ~70,600 |

**~17,100 lines removed (~20%)** with no thinking added to code — every removed
behavior is either dead, duplicated, or already superseded by the agentic path +
knowledge docs.

---

## 4. What must NEVER become agentic (the counter-list)

1. **`mergeEngine.js`** — byte-exact template application, BOM/CRLF, L5K sync.
   Determinism is why files import.
2. **`validator.js` + `importSimValidator.js`** — gates must be mechanical;
   negative tests (doctored files) keep them honest.
3. **Save identity** — `exportProjectJSON`, project JSON round-trip, IDs, undo
   history (`useDiagramStore` history), `projectApi.js`.
4. **Tag-name construction** (`tagNaming.js`) — the standard chooses names
   (knowledge); string assembly must be deterministic so regeneration is stable.
5. **Geometry** — `edgeRouting.js`, `computeStateNumbers.js`, `geometrySanity.js`,
   `branchLayout.mjs`, canvas rendering.
6. **State-grid arithmetic** — `ir.js` numbering, `renumberInlineOnGrid`,
   reserved-number enforcement.
7. **`templatePatterns.js`** — mechanical derivation of invariants from the
   templates themselves.

---

## 5. Questions for Dan (blocking decisions)

1. **Legacy exporter fate (Phase 2):** does anyone still ship stations from the
   classic Export button, or is Jarvis the only sanctioned codegen? (The exporter
   is 6,892 lines and Jarvis doesn't touch it.)
2. **Classic shell fate (Phase 4):** is v2 the shipping shell? Today `vite build`
   ships CLASSIC ONLY — v2 is dev-server-only until `vite.config.js` gets a
   `rollupOptions.input` for `v2.html`. Does the team use classic at all?
3. **Standards UI:** `StandardsView`/`StandardsProfileEditor` have no v2 home.
   Port, replace with Jarvis-mediated standards editing, or keep classic alive
   just for standards until then?
4. **Right properties panel:** v2 removed it by design. Is `PropertiesPanel`
   (705) dead-on-arrival for v2, or coming back?
5. **MachineConfig / IO-map editing:** keep dedicated editors (2,346 lines), or
   is "describe the change to Jarvis" the intended v2 editing path with a thin
   read-only view?
