# SDC Ecosystem Reference — Estimate Builder, AppStack, Knowledge Base
> Permanent cross-app reference for the State Logic Builder. Digested 2026-08-20 from:
> `C:\Claude_Sandbox\SDC_Estimate_Builder` (app, v2.83), `C:\Estiamte Sheet` (knowledge base),
> `C:\Claude_Sandbox\sdc-sheets` (Abby's AppStack). Read-only digest — nothing outside
> `C:\SDC-StateLogic\docs\` was modified.

---

## 0. The Ecosystem Map (Dan's apps and how they relate)

| App | Where | Stack | Role |
|---|---|---|---|
| **SDC Estimate Builder** | `C:\Claude_Sandbox\SDC_Estimate_Builder` | React 19 + Vite + Tailwind 4, localStorage persistence, NO backend | Quoting: machine → stations → assemblies → $ and hours. Agentic "apps engineer" layer built in. v2.83, versions bump per change batch. |
| **sdc-sheets ("ETC Planner" / SDC Projects Reports)** | `C:\Claude_Sandbox\sdc-sheets`, deployed SERVER-APP1.stevendouglas.local:3010 | Next.js App Router + Prisma + **MySQL**, PM2 single process | **THE AppStack.** Labor-hours truth (quoted vs actual per job/section), ETC, project releases, syncs Paylocity + Total ETO + Power BI + Scheduler into its own DB. |
| **State Logic Builder** (this repo) | `C:\SDC-StateLogic` | React 18 + React Flow + Zustand + Vite + Electron, file/localStorage | Controls: flowchart → L5X. Jarvis agent layer (`src/lib/agentGenerator`, brain in `jarvis-knowledge/`). |
| **Estimating knowledge base** | `C:\Estiamte Sheet` (typo'd name is real) | Markdown + JSON files | PROJECT-BRAIN.md (52KB living doc), MACHINE-FAMILIES-AND-CORRELATIONS.md, co_occurrence_rules.md, assemblies_library.json (1,867 ETO assemblies w/ BOMs), parts_catalog.json, po_history.json, daily_learning/. |
| **SDC TOOLS launcher** | desktop app v1.6.1 | local services | Hosts: Assemblies Library (Abby's CAD library), Project Planner, Vendor Tracker, SDC Projects Reports, **State Logic Builder**. |
| **Total ETO** | MSSQL (MCP connector available in this env) | ERP | Parts-cost truth. Dan's directive 8/18/26: **never query ETO directly — go through sdc-sheets**, which pre-syncs it. |

Dan's strategic conclusion (PROJECT-BRAIN §5e): *"the future estimating app should EXTEND sdc-sheets, not be a new app."* Same logic applies to State Logic's shared data.

---

## A. THE FEATURE TREE (top priority — replicate in State Logic's stations panel)

**File:** `C:\Claude_Sandbox\SDC_Estimate_Builder\src\components\FeatureTree.jsx` (288 lines).
Self-described in its header comment:

```js
// SolidWorks-style feature tree spanning the whole estimate:
//   Machine
//     Section 10 > Project Engineering / Standard Components / Controls / Stations
//     Section 40 Testing · Section 50 Install · Fees · Summary
//   [Generate Proposal] hook at the bottom.
// Clicking a node scrolls to (and opens) the matching card.
```

### A.1 Hierarchy (exact levels)

```
Machine (root — machineTitle, machine-type label, "incomplete: …" amber badge)
├─ Section 10 — Design & Build            (GroupNode, defaultOpen, navy)
│  ├─ Project Engineering                 (LeafNode — the 'General Eng' station, effort not hardware)
│  ├─ Standard Machine Components — {type} (GroupNode, teal; = the 'Machine Base' station)
│  │  ├─ Frame            ┐
│  │  ├─ Chassis          │ BASE_GROUPS subsection labels (tiny uppercase strips),
│  │  ├─ Guarding         │ each holding small LeafNodes with per-line cost
│  │  ├─ HMI              │
│  │  ├─ Required Assemblies (head align, empty nest…)
│  │  ├─ Pneumatics & IO  (air prep + auto-tiered valve bank)
│  │  ├─ Controls Hardware (PLC, transformer)
│  │  └─ Control Panel    ┘
│  ├─ Station 1..N                        (StationNode — colored square, name, cost)
│  │  ├─ LOAD    band label               (blue caption)
│  │  │  └─ component leaves (▪ if the item has breakdown children, · if not; "(3)" child count)
│  │  └─ VERIFY  band label               (green; RED "Verify — empty!" if load w/o verify)
│  │     └─ component leaves
│  └─ Controls                            (GroupNode — labor only: "Programming & Software — CE Xh · Gen Yh")
├─ Section 40 — Testing                   (LeafNode, red)
├─ Section 50 — Install                   (LeafNode, teal)
├─ Standard Fees                          (LeafNode, yellow)
└─ Summary                                (LeafNode, navy)
[Generate Proposal] button + version stamp in tree footer
```

So the levels are: **Machine → Section → Station (or bundle) → Load/Verify band → Assembly line → (breakdown children implied by count badge)**.

### A.2 Node components (the actual structure)

Four node primitives, all rows with the same anatomy: `Caret + color square + name + dotted Leader + right-aligned $ cost`:

- `StationNode({ station, cost, onFocus, open })` — colored by `STATION_TYPE_META[type].color`; square turns **red** with red name when `stationNeedsVerify(station)` (load items but zero verify items). Expanded body shows `Load` / `Verify` band captions and `ComponentLeaf` rows.
- `GroupNode({ label, total, color, open, onClick, children })` — supports **controlled mode**: when `open` prop is passed, "node expansion IS card openness — clicking toggles both" (tree ↔ main pane mirror).
- `LeafNode({ label, total, color, onClick, small })` — "hierarchy by size: big parents, small children" (14px vs 10px font).
- `ComponentLeaf({ item })` — 10px gray leaf, `▪` prefix if item has `children[]` (grouped mini-assembly) else `·`, label suffixed `(N)` with child count.

Visual constants: `Leader()` = 1px dotted border fill between name and cost (SolidWorks/table-of-contents style); `Caret` = small rotating triangle; costs are `font-mono` 12px (small: 9px).

### A.3 How the tree drives the app (the interaction contract)

- **The tree is THE primary structure view** — fixed-position left panel, always visible, `TREE_WIDTH = 460` ("tree gets the larger share vs center at default zoom"). Header strip says: *"Machine Structure — click = open in main pane"*.
- The **main (center) pane shows only the selection**: clicking a tree node opens that station/section as a closable card. Since v2.73 the center is a **react-grid-layout dashboard** ("Smartsheet dashboard" model): every open card is an independent draggable/resizable tile on a 12-col grid, content-driven height via ResizeObserver, layout persisted per estimate (`sdc_layout_v1`).
- Open state is shared: `App.jsx` keeps `openCards[]`, derives `openKeys = new Set(openCards.map(cardKey))` with keys like `'station:{id}'`, `'base'`, `'controls'`; tree caret/highlight mirrors it (`isOpen(key)`), open row gets `background:#eef4fb`.
- Line-level focus: clicking a base-line leaf **ensure-opens** (never toggle-closes) the card, then dispatches `window.dispatchEvent(new CustomEvent('sdc-scroll-item', { detail: { id } }))` after 50/250ms so the card scrolls to that row.
- **Badges:** root shows the required-slot completeness badge — `missingRequiredSlots(machineType, stations)` returns unfilled slots and the tree renders quiet amber `incomplete: Chassis · Guarding` (title-tooltip explains where to fix). Station squares turn red on the missing-verify rule. No modals — "quiet amber, not modal".
- **Grouping logic:** `mandatory` stations split out — `General Eng` becomes "Project Engineering", other mandatory stations (Machine Base) become "Standard Machine Components — {machine type}"; everything else lists as work stations in order.
- Footer: `Generate Proposal` button (proposal-writer hook) + the app's ONE version display (`v2.83 · Aug 17`).

### A.4 What to replicate in State Logic

Map: Machine → Station (S00…S{nn} state machines) → Devices / Signals / (states?) with the same anatomy — caret, type-colored square, name, dotted leader, right-aligned metric (State Logic's natural right-column metric: step count, valve count, or IO count instead of $). Same contract: tree = master, clicking a node opens/focuses that station on the canvas; expansion state shared both ways; quiet amber badges for incompleteness (e.g. station with no Cycle Complete, device with no sensors, SM not exported).

---

## B. THE APPSTACK (sdc-sheets — what State Logic must migrate onto)

**Repo:** `C:\Claude_Sandbox\sdc-sheets` (github.com/abhikamuju36-ui/sdc-sheets, public). Docs in `docs/` are excellent: ARCHITECTURE.md, DEPLOYMENT.md, INTEGRATIONS.md, REALTIME-SYNC.md, REFRESH-PIPELINE.md, ETC-BUSINESS-LOGIC.md.

### B.1 Database facts

- **Engine: MySQL**, managed via **Prisma** (`prisma/schema.prisma`, `datasource db { provider = "mysql" }`), connection via `DATABASE_URL` env var. ~33 models today.
- Hosted with the app on **SERVER-APP1.stevendouglas.local** (single Windows box). App on **port 3010** under **PM2, single non-clustered process** (mandatory — in-memory realtime hub breaks with >1 instance).
- Schema conventions: `Int @id @default(autoincrement())` PKs; business key `jobId String @unique` ("1079"); `Decimal @db.Decimal(10,2)` for hours, `(12,2)` for dollars; `createdAt/updatedAt` on everything; `@@unique` composite keys at the natural grain (e.g. `@@unique([jobId, section, month])` on EtcEntry); **manual-edit guard booleans** (`quotedHoursManuallyEdited`, `costQuotedManuallyEdited`) so scheduled syncs never clobber a human correction; `source` string columns naming where each row came from (`'sharepoint' | 'power_bi' | 'totaleto_sync' | 'manual'`).
- Key models: `Job` (status, customer, type Custom/Duplicate/Hybrid/Service, costQuoted/costActualHistorical, ETO hour mirrors), `EstimatedHours` (per job+section: quotedHours / actualHistoricalHours / estimateToCompleteHours), `JobHoursDetail` (punch grain: job+section+workDate+employee), `JobMonthlyActualHours`, `EtcEntry` (monthly manager ETC, append-only + audited), `ProjectRelease` (parsed release .docx: milestones, delivery, budget image), `Employee`, `User`, `AuditLog`, `RefreshRun`/`RefreshLock`, `SavedView`.

### B.2 Server architecture (the pattern to copy)

- **Next.js App Router, no internal REST layer**: Server Components (`page.tsx`) call `prisma` directly; **mutations are Server Actions** (`src/lib/*-actions.ts`, `"use server"`); `api/` routes exist only for what actions can't do (SSE, machine-to-machine integration endpoints, health check). `import "server-only"` guards DB/secret modules.
- **"Everyone accesses the shared database"** = everyone hits the one web app URL; the app owns the one MySQL DB. No per-user DB credentials, no local files. Concurrency handled by autosave server actions + audit log + append-only entries.
- **Live output**: an in-process **realtime hub** (`lib/realtime-hub.ts`) streams changes to browsers over **SSE (EventSource)** — server actions call `recordChanges`, connected clients update live. Plus an **auto-sync scheduler** (`lib/auto-sync.ts`, hourly + on-demand) that pulls upstream systems into the app's own tables; UI reads the local copy (the one exception: Job Hour Details queries ETO live per job).
- **Upstream connections, all server-side:** Paylocity hours = OneDrive-synced .xlsx at `JOB_HOURS_LOCAL_PATH`; Total ETO = `mssql` package with `TOTALETO_DB_USER/PASSWORD`; Scheduler app's MySQL via `mysql2` read-only; Power BI legacy/metadata only.
- **Auth:** NextAuth v5, JWT sessions, one **email/password credentials provider** (bcrypt, `User` table). Entra SSO docs exist (`ENTRA-SSO-SETUP.md`, `GRAPH-APP-ONLY-SETUP.md` — a tenant Entra app with Graph app-only permissions is already provisioned) but SSO is **not currently wired in**. Authorization is deliberately flat — roles dropped 2026-08-02 in favor of one **shared "button password"** gating sensitive actions; one remaining ADMIN check.
- **Deploy:** `npm run deploy` = `next build && node scripts/free-port.mjs 3010 && pm2 restart` (free-port script exists because PM2 on Windows doesn't reliably kill the old process — silent stale-build hazard).

### B.3 What migrating Jarvis's brain onto this stack means

Jarvis's brain today is files in this repo:
- `jarvis-knowledge/questions.json` — CE-answered knowledge Q&A (seeded via `scripts/seedJarvisQuestions.cjs`)
- `jarvis-knowledge/buildScores.json` — benchmark/build scoring history (written by `src/lib/agentGenerator/buildScores.js`)
- `src/lib/agentGenerator/meKnowledge.md` + `generationRules.md` — the prompt-borne knowledge/rules
- `benchmarks/` — reference machines for scoring

Migration target = the sdc-sheets pattern, concretely:
1. **New Prisma models in the shared MySQL DB** (either inside sdc-sheets as new tables, or a sibling schema on the same server): e.g. `JarvisLesson { id, ts, text, src('seed'|'tweak'|'manual'), active }`, `JarvisQuestion { id, question, answer, answeredBy, status }`, `JarvisBuildScore { id, jarvisVersion, machineRef, score, breakdown Json, ts }`, `JarvisGenerationLog { id, description, proposal Json, accepted Boolean, ts, userId }`. Follow conventions: autoincrement id, source column, manual-edit guards, `@@unique` at natural grain, audit-friendly append-only for scores/logs.
2. **Server actions / integration endpoints** replace file reads: prompt assembly fetches lessons/knowledge at call time (exactly like the Estimate Builder's `buildCatalog()` — "assembled AT CALL TIME so the catalog can never go stale").
3. **Shared-by-default:** every CE's corrections land in one DB, so a lesson learned on Dan's machine trains everyone's Jarvis — the fix for "apps aren't interconnected."
4. Model the Estimate Builder's localStorage keys as the interim schema: `sdc_gen_lessons_v1` (lessons), `sdc_gen_log_v1` (accepted proposals, cap 200), `sdc_api_key_v1`, `sdc_agent_model_v1`, `sdc_custom_entries_v1` (custom library entries), `sdc_asm_breakdown_v1` (breakdown overrides). These are all single-user today — Dan's known pain — and are the same categories Jarvis has.

---

## C. THE AGENTIC LAYER (what Jarvis was modeled on)

**Files:** `src/agent/agentPrompt.js` (prompt + schemas), `generator.js` (transport), `lessons.js` (memory loop), `projectContext.js` (per-project brain feed).

### C.1 Model calls
- **Direct browser → Anthropic API** (`fetch('https://api.anthropic.com/v1/messages')` with `anthropic-dangerous-direct-browser-access: true`). API key lives ONLY in localStorage; model selectable: `claude-sonnet-5` (default "fast/cheap") or `claude-fable-5` ("hard concepting").
- **Streaming SSE** with visible progress (`onProgress(chars, secs)`), **60s idle timeout** (never a silent hang), plain-word error mapping per HTTP status, `max_tokens: 32000`.
- **Auto-continue:** replies hitting `max_tokens` are resumed up to 3 legs ("continue EXACTLY where you stopped") and stitched.
- **Defensive JSON extraction** (`parseProposalText`): prefer fenced ```json block, else outermost `{...}`; one corrective retry with the malformed output in context ("That response was malformed (X). Respond again with ONLY the JSON"). The `json_schema` API param was deliberately removed — schema rides in the prompt instead.
- **Keyless path:** `buildChatPrompt(description)` produces a copy-to-any-Claude-chat prompt; user pastes the JSON reply back into a paste box that renders the SAME proposal popup. Same brain, different transport.

### C.2 Prompt structure (`buildCoreBrief()` — one shared core, two output contracts)
Assembled at call time, in order:
1. **Identity:** "You are a senior applications engineer at SDC Automation…"
2. **SDC ESTIMATING LAWS** (non-negotiable: round numbers, SDC-fab is cheap, hours categories me/ce/mb/eb, assembly parts $ always zero — dollars on children, every LOAD needs a VERIFY, testing derived at k×D&B eng hours — never on station lines).
3. **HOW SDC THINKS** (reasoning patterns, not keywords: batch transfer beats singulation, proximity beats speed, geometry-family scaling, flex feeder is ONE station, reuse axes for reject…).
4. **COMPONENT ACTUALS** (PO-anchored planning prices: robot $25k, servo axis $2,500, Keyence camera $7.5k; hour granularity: never a 1-hour line, 2/4/8 increments).
5. **JOB HISTORY MEDIANS** (~6 stations, ~$463k typical; testing burns 0.50× engineering — calibrated on 96 closed jobs).
6. **YOUR LIBRARY** — the live catalog: compact JSON of every library item `{id, name, sec, usd, hrs:{me,ce,mb,eb}, dots:{srv,vis,pnu}, kids:[...breakdown children]}` so the model reuses real SDC structures by `libId`.
7. **LESSONS FROM DAN** (`lessonsPromptBlock()` — newest first, 2,000-char cap).
8. **PROJECT CONTEXT** (`projectContext.js` — customer/machine header + the estimator's own description + uploaded RFQ text, 12k chars/file, 40k total).

Then one of two **output contracts**, both strict JSON schemas:
- `RESPONSE_SCHEMA` — single-station concept: `{stationName, notes, questions[], assemblies[]}` where each assembly = `{name, libId|null, qty, parts, hours{me,ce,mb,eb}, children[{name,qty,parts,hours}], rationale, confidence: 'library'|'composed'|'guess'}`.
- `PROPOSE_SCHEMA` — whole-machine station list: `{machineName, notes, stations[{name, type: 'load'|'process'|'verify'|'unload'|'test', rationale, assemblies[…same shape]}]}`.

Key contract rules: reuse catalog by libId with price/hours verbatim; concept the missing (`confidence:'composed'`, children carry the dollars); **never silently drop a phrase from the description** — everything maps to an assembly, child, or question; real questions an apps engineer would ask; rationale per assembly; COMPACT single-line JSON.

### C.3 User interaction
- **Everything is a reviewable proposal, never an auto-commit.** Generated station → proposal popup Dan red-lines → Accept creates the lines. Same for propose-stations (Project Intake tab: high-level description + file uploads + voice).
- **Tweak loop with conversation memory:** `priorMessages` carries the full exchange so "Revise the proposal. {tweak}" iterations converge instead of restarting.
- Accepted proposals are logged (`logAcceptedProposal`, `sdc_gen_log_v1`, last 200) as future calibration data.

### C.4 How it learns (the memorization loop — the piece Jarvis should copy exactly)
- Every tweak Dan sends is run through `distillLesson(tweakText)` — a second model call: *"Distill it into ONE short reusable rule-of-thumb (max 120 chars, imperative). If purely one-off, reply SKIP."*
- Surviving lines are stored as lessons (`{id, ts, text, src:'tweak'|'manual'|'seed'}`), deduped on normalized text, capped at 300, **appended to EVERY system prompt** (newest first, 2,000-char budget).
- Lessons are **fully curatable on a Rules page** (view/edit/delete) — institutional knowledge is visible, not buried in code. Version-flagged seed blocks (`sdc_gen_lessons_seed_v279` etc.) inject Dan's corrections one-shot so his later edits/deletions stick.
- Deeper loop planned: accepted-vs-proposed JSON deltas (`sdc_gen_log_v1`) for calibration. Bedrock rule from PROJECT-BRAIN §5b: **NO RULE ENGINE** — "rules are guidance, not code"; the model reasons, checklists only verify.

---

## D. MACHINE TAXONOMY & ASSEMBLIES LIBRARY

### D.1 Machine types (Estimate Builder `jobInfo.machineType`)
`dial` (Dial/Indexing) · `linear` (Linear) · `robotic` (Robot Cell) · `test` (Test/Inspect) · `custom` (open canvas). Machine type drives:
- **Required slots** (`MACHINE_SLOT_CONFIG` — "future machine types are DATA, not code"): dial/linear require `chassis` + `guarding`; robotic requires `robot` (scope:'any') + `guarding`; test/custom prescribe nothing. Slots are QUESTIONS: satisfied by a library pick, by designating any assembly as "counts as…" (`coversSlot` — a flex feeder can BE the frame), or dismissed per machine type (`groupDismissable` — HMI/controls/panel never dismissable).
- **Auto-required assemblies** (`ensureRequiredAssemblies`): dial/linear machines get `head_align_station` + `empty_nest_station`; EVERY machine gets `air_prep` + a valve bank whose **tier auto-follows the machine's live pneumatic count**: `valveTierFor(count) = ≤4 → valve_bank_4, ≤8 → valve_bank_8, else valve_bank_15` (flag `vbAuto` while untouched; Dan's removal sticks via `baseAutoAdded`).

### D.2 Machine FAMILIES (MACHINE-FAMILIES-AND-CORRELATIONS.md — evidence-based, living)
1. **Rotary dial/indexer assembly** — central servo dial, stations around perimeter, load+verify per station.
2. **Linear indexing assembly** — same station logic on a straight indexing conveyor (distinct family: different chassis cost/footprint).
3. **Robotic pick/place cell (non-indexing)** — robots do the transfer, batch-transfer relaxes cycle time.
4. **Test/inspection equipment** (First Solar cluster — SDC's biggest repeat family, no assembly stations).
5. **Coil/wire/terminal assembly** (Diamond Electric book).
6. **Packaging/wrap/box**. 7. **Feed/bag/inspect (medical)**.

### D.3 Station types — the correspondence table for State Logic

| Estimate Builder station type (STATION_TYPE_META) | Agent type enum | State Logic station template analog |
|---|---|---|
| Feed & Load (#1574c4, variants: Bowl Feed / Flex Feeder / Dereeler / Tray Handler / Magnetic Gantry / Manual Load) | `load` | S01 part load; feeder/escapement device set |
| Vision Pick (#6F3168) | `load` | vision-guided pick station (VisionSystem device + PNP) |
| Press/Process (#FA9150) | `process` | press/heat/glue station templates |
| Inspect/Verify (#74c415, verifyFunction:true; variants: Sensor / Vision (Keyence) / Laser Profile / Probe-LVDT / Alignment Check) | `verify`/`test` | inspection station (Vision Inspect nodes, 4 sub-states) |
| Unload/Reject (#fa5650) | `unload` | unload/reject station |
| Machine Base / Guarding / General Eng (mandatory, single:true) | — | S00 indexer/chassis station + machine-level program |
| Mandatory dial extras: Head Align + Empty Nest (verifyFunction) | — | required verify stations on any indexing machine — State Logic should pre-seed these SMs for dial machines |

**Load+Verify law** (Dan's non-negotiable #5, enforced in tree + agent): every station that loads must verify. State Logic equivalent: every actuation state should be followed by sensor confirmation — the same completeness-badge idea maps directly to state diagrams.

### D.4 Library entry schema (the shared vocabulary candidate)
`LIBRARY_ITEMS` entry: `{ id, aliases[], label, parts, servo, vision, pneu, motor, me, ce, gen, build, wire, group, kind:'assembly'|'part', source:'curated'|'actuals'|'mined'|'judgment'|'custom', stdRef ('096-H-000' — N: drive CAD standard refs), partsOnly, hoursPerUnit, hmode }`. Groups: Frames, Guards, Chassis, Feed Systems, Escapements, Conveyors, SDC Pick & Place, Process Systems, Servo & Motion, Verify, … Breakdown children live in `STATIC_BREAKDOWNS` + user overrides (`sdc_asm_breakdown_v1`).

**The device-count dots are the valve/IO tie-in:** every line carries `servo/vision/pneu/motor` counts; `compute()` totals them machine-wide; the valve-bank tier and (future) IO sizing derive from those totals. State Logic knows the REAL device counts per station — see E.3.

### D.5 assemblies_library.json (`C:\Estiamte Sheet`, 1,867 entries, 3.4MB)
Array of ETO-mined assemblies: `{ id ('TOP 1082-40' / assembly number), description, job, family ('Electrical'|'Load/Unload'|'Structure'|'Verify'|'Process'…), bom: [{part, desc, qty, each, mfr}] }`. ETO family census: Load/Unload 582, Structure 426, Verify 170, Process 117 (of 2,682). The BIG CORRELATION JOB (brain §5g) enriches each entry with quoted-vs-actual. Companion files: `parts_catalog.json`, `po_history.json`, `mined_library.json`, `co_occurrence_stats.json` + `co_occurrence_rules.md` (mined from 145 estimate files/203 stations: "when X in a station, Y appears too — ☐ Agree ☐ No" for Dan's blessing; feeds "companions, not columns" suggestions — never auto-add).

### D.6 The $7,500 trap (retrieval law)
Never surface a line-item price alone — **the unit of retrieval is the STATION BLOCK** (header + children + subtotal). A "Vibratory Flex Feeder $7,500" line lives in an $81,840 station. Same law for State Logic: the unit of reuse is the station's whole state machine, not an individual device pattern.

---

## E. INTERCONNECTION OPPORTUNITIES (concrete)

1. **Estimate → State Logic project pre-seed (the headline win).** An accepted estimate already contains: machine name/type, ordered station list with types, and per-station assemblies with device counts (`servo/vision/pneu/motor`) and `libId`s. Import path: read the Estimate Builder's saved estimate JSON (today localStorage per proposal; tomorrow an AppStack table) → create a State Logic project with one SM per station (`stationNumber` from machine order, `name` from station name), pre-declare devices (pneu count → pneumatic cylinders, servo count → servo axes, vision → VisionSystem devices), and for dial/linear machines pre-seed Head Align + Empty Nest verify SMs. The agent's `PROPOSE_SCHEMA` types (`load/process/verify/unload/test`) map to State Logic station templates (D.3). Even a v1 "Import from Estimate…" file-drop closes Dan's loop: quote the machine → open State Logic → the machine is already there.
2. **Feature tree parity (this repo's stations panel).** Replicate FeatureTree.jsx anatomy and contract (§A.4): tree is master, main pane shows selection, expansion mirrored, quiet amber completeness badges, dotted-leader metrics. Use the same `STATION_TYPE_META` colors so a station looks identical in both apps.
3. **IO/valve totals flowing back.** State Logic knows ground truth after controls design: actual valve count, sensor count, servo axes, IO points per station. Feed that back to the estimate (or the AppStack) as estimated-vs-designed device deltas — validates the estimate library's device dots and auto-checks the quoted valve-bank tier (`valveTierFor`) and PLC size against reality. This is exactly the "Estimates are claims; ETO is truth" principle applied to controls content.
4. **Shared device/assembly vocabulary.** Adopt `libId` + `stdRef` (096/088/092/094 N:-drive standards numbers) as the cross-app keys. State Logic device types ↔ library entries (e.g. `pnp_std_2ax` ↔ SDCStandardPNP init template; `flex_feeder` ↔ flex-feed station SM pattern). One vocabulary means Jarvis and the estimate agent can cite the same standards.
5. **TotalETO / job linkage via sdc-sheets.** Key on `Job.jobId` ("1119") — State Logic project files already use job-number names (`projects/1119-Stamper_Machine.json`). Dan's rule: go through sdc-sheets (it pre-syncs ETO), never query ETO ad hoc. A State Logic project stamped with jobId inherits customer, quoted CE hours (`EstimatedHours` section codes), and release milestones (`ProjectRelease`).
6. **Jarvis brain onto the AppStack** (§B.3): lessons/questions/scores as MySQL tables + server actions; copy the Estimate Builder's lesson loop verbatim (distill → dedupe → cap → prompt block → curatable Rules page). CE hours actuals from sdc-sheets become Jarvis's calibration data the same way closed-job hours calibrated testing at 0.50×E.
7. **Shared agent transport module.** `generator.js` (streaming, idle timeout, auto-continue, defensive parse, keyless paste path, tweak-with-history) is battle-tested against exactly the failures Jarvis will hit — lift it as a shared client rather than re-deriving.
8. **CE hours ground truth for estimating.** Long-term: State Logic knows machine complexity (states, transitions, devices, vision sub-states) — the brain's own future idea ("estimate debug hours from the design itself: more/harder stations → more debug"). State Logic's diagram metrics are the natural predictor variables for that model.

---

## Appendix: source file index

| Topic | File |
|---|---|
| Feature tree | `C:\Claude_Sandbox\SDC_Estimate_Builder\src\components\FeatureTree.jsx` |
| Shell / dashboard grid / openCards | `src\App.jsx` (Builder component, v2.73 canvas notes) |
| Agent prompt + schemas | `src\agent\agentPrompt.js` |
| API transport | `src\agent\generator.js` |
| Lesson loop | `src\agent\lessons.js`; Rules page `src\components\RulesPage.jsx` |
| Project context feed | `src\agent\projectContext.js`; intake `src\components\ProjectIntake.jsx` |
| Library, station types, slots | `src\data\library.js` (STATION_TYPE_META ~1718, MACHINE_SLOT_CONFIG ~1621, BASE_GROUPS ~223, templates ~1837) |
| Estimate state + required assemblies | `src\hooks\useEstimate.js` (`ensureRequiredAssemblies` ~693, `valveTierFor` ~689) |
| Calculations / calibrations | `src\utils\calculations.js` (TEST_TD_CALIBRATION, LANDING_PCT) |
| Original spec | `SDC_Estimate_Builder_SPEC.md` |
| Estimating brain | `C:\Estiamte Sheet\PROJECT-BRAIN.md` (§0 master plan, §5b no-rule-engine, §5c taxonomy, §5c-2 apps-engineer patterns, §5e AppStack directive, §5f builder v2 spec) |
| Machine families | `C:\Estiamte Sheet\MACHINE-FAMILIES-AND-CORRELATIONS.md` |
| Co-occurrence | `C:\Estiamte Sheet\co_occurrence_rules.md` + `co_occurrence_stats.json` |
| Assemblies library | `C:\Estiamte Sheet\assemblies_library.json` (1,867), `parts_catalog.json`, `po_history.json` |
| Prototype | `C:\Estiamte Sheet\SDC Machine Builder Prototype.html` (superseded by the React app per Dan) |
| AppStack | `C:\Claude_Sandbox\sdc-sheets\docs\ARCHITECTURE.md`, `DEPLOYMENT.md`, `INTEGRATIONS.md`; `prisma\schema.prisma` |
| Jarvis brain (migration source) | `C:\SDC-StateLogic\jarvis-knowledge\{questions,buildScores}.json`, `src\lib\agentGenerator\{lessons in meKnowledge.md, generationRules.md, buildScores.js}` |

---

# SDC Tools App Stack (sdc-sheets)
> Deep digest 2026-08-20 of `C:\Claude_Sandbox\sdc-sheets` (read-only). This repo is a sandbox
> mirror of **`D:\AI Projects\sdc-etc-planner`** — the **"SDC Projects Reports"** app (aka ETC
> Planner). It is ONE app in the SDC Tools estate, not the whole platform, but its docs, schema
> and integration code define the estate's patterns and name the other members.

## A. Platform architecture

**The estate is multiple independent apps under one PM2 daemon on one Windows LAN server
(`server-app1`), each on its own port — NOT one Next.js app with routes.**

| Component | What | Where |
|---|---|---|
| SDC Projects Reports (this repo) | Next.js 16 App Router, React 19, Prisma/MySQL, NextAuth v5 | `http://server-app1:3010`, PM2 app `sdc-etc-planner`, code at `D:\AI Projects\sdc-etc-planner` |
| SDC Scheduler (**the "SDC Tools" hub** — the dashboard Dan showed with the 7 app cards is this app's SPA home) | Separate Express server + SPA (`public/app.js`) + its own MySQL (`sdc_scheduler`), own JWT auth | `http://server-app1:4003`, code at `D:\AI Projects\SDC_Scheduler` (not in sandbox) |
| SDC Standard Fees | Sibling Next.js app (Dan+Lisa only), later partially absorbed into Reports as the password-gated Standard Sheet tab | was `localhost:3011`, `D:\AI Projects\sdc-standard-fees` |
| MySQL 9.7 (local instance) | Databases `sdc_etc_planner`, `sdc_standard_fees`, `sdc_scheduler` | `D:\AI Projects\MYSQL Database`, port 3306 |
| Total ETO (ERP) | SQL Server, read-only via `mssql` | company ERP server |

- **Hosting/routing:** each app is its own PM2 entry (`ecosystem.config.js` here only declares
  `sdc-etc-planner` on 3010; comment: "same interactive-user PM2 daemon as the rest of the SDC
  Tools estate"). Plain HTTP on the LAN hostname; Windows Firewall opens each port inbound.
  Deploys use `npm run deploy` (build, then `scripts/free-port.mjs`, then pm2 restart) because
  PM2 on this box does NOT reliably kill Next servers (documented EADDRINUSE crash-loop trap).
- **App cards launch, they don't embed:** cards are plain links to each app's own host:port,
  carrying a 60-second single-use HMAC SSO assertion (below). Reports' grids likewise render
  "open in Scheduler" deep links (`http://server-app1:4003/?job=1101&view=schedule&sso=...`).
  State Logic Builder as a card = a link to wherever State Logic is served, with the same SSO
  token pattern.
- **Auth / identity:** each app has its OWN account table and session. Reports: NextAuth v5,
  JWT strategy, **Credentials provider only** (email/password, bcrypt against `User`) —
  Entra SSO docs exist but are stale; `src/lib/auth.ts` is ground truth. Dan signs in with
  email/password. Cross-app single sign-on is homegrown (`src/lib/scheduler-sso.ts`):
  `payload.signature` HMAC-SHA256 over `{email, exp(60s), nonce}` with the shared secret
  `SCHEDULER_SHARED_TOKEN`, domain-prefixed `"sso:v1"`, passed as `?sso=` query param,
  single-use nonce, both sides hold a copy of verify(). Sign-out and password-hash changes are
  mirrored via `/api/integration/revoke-session` and `/api/integration/sync-password`.
  Authorization is deliberately flat — being signed in is the boundary; destructive actions sit
  behind one shared "button password" (`lib/button-password.ts`).
- **Internal shape of Reports:** Server Components read Prisma directly, mutations are Server
  Actions (`src/lib/*-actions.ts`); `api/` routes exist ONLY for SSE realtime, health, exports,
  and the server-to-server `/api/integration/*` endpoints. In-process realtime hub (SSE
  presence + change events) and hourly auto-sync scheduler — single process by design.

## B. Database / object model (Prisma, MySQL)

Engine: **MySQL** (`datasource db { provider = "mysql" }`), local instance at
`D:\AI Projects\MYSQL Database`, database `sdc_etc_planner`, ~30 models in
`prisma/schema.prisma`. Newer tables are accessed by **raw SQL** (`$queryRaw`) because
`prisma generate` can't run while PM2 holds `node_modules/.prisma` — a pattern Jarvis tables
would need to follow too.

**Job — the estate's project anchor** (`Job.jobId` is the human "1079"-style string, unique;
`Job.id` is the internal PK — every FK gotcha in the codebase is about confusing the two):

```prisma
model Job {
  id        Int    @id @default(autoincrement())
  jobId     String @unique          // "1079"
  jobName   String
  status    String @default("Active")
  customer  String?
  type      String?                 // "Custom" | "Duplicate" | "Hybrid" | "Service"
  poStartDate DateTime?  startDate DateTime?  completeDate DateTime?
  billable  Boolean @default(true)
  costQuoted Decimal?  costActualHistorical Decimal?
  totEtoEstEngHours/ActEngHours/EstMfgHours/ActMfgHours Decimal?   // live TotalETO sync
  source    String @default("manual")   // 'manual' | 'scheduler_sync' | 'totaleto_sync'
  etcEntries EtcEntry[]  estimatedHours EstimatedHours[]  tasks JobTask[]
  monthlyActualHours JobMonthlyActualHours[]  hoursDetail JobHoursDetail[]
  projectRelease ProjectRelease?
}
```

**ProjectRelease — what Dan means by "pulling project releases from SDC Projects Reports"** —
one per Job, parsed from the uploaded SDC "Project Release" PDF/.docx
(`src/lib/project-release.ts`, upload via server action on `/jobs/[id]`):

```prisma
model ProjectRelease {
  id Int @id
  jobId Int @unique   job Job @relation(...)     // 1:1 with Job
  fileName String   uploadedAt DateTime   uploadedBy String?
  receiptOfPo DateTime?   deliveryWeeks Int?   deliveryDate String?  // "January 15 2027" as written
  penalty Boolean   penaltyWeeks Int?
  milestones Json?          // [{ pct, label }] financial milestones
  budgetImage String? @db.LongText   // data: URL of the Project Budget picture (.docx only)
  details Json?  // PDF fields: jobNumber, jobTitle, buyer, quote, poNumber,
                 // customerContact, warrantyMonths, commercialCost, budget[]
}
```

`budget[]` in `details` = `{ label, value, isCost }` lines — **hours by discipline + commercial
cost** — exactly the station/budget context a describe-first State Logic flow wants.

Other model clusters (full schema is the source of truth):
- **Hours**: `EstimatedHours` (quoted/actual/ETC per job+section code e.g. "10-111"),
  `JobHoursDetail` (punch-level, per employee/day/job/section from the Paylocity workbook),
  `JobMonthlyActualHours`, `JobTask`, plus import-forensics tables (`PaylocityImport` with
  sha256 file identity, `HoursImportIssue`, `UndefinedHoursRow`).
- **ETC**: `EtcEntry` (jobId+section+month unique; priorEtc/hoursWorked/newEtc + draft
  autosave), `MonthlyReportSubmission` (idempotency UUID), `DepartmentEtcCompletion`.
- **Standard Fees**: `ExecutionRate` (per-job engr/shop rates, parts markup),
  `StandardSheetSetting`, `StandardSheetSnapshot` (frozen monthly), `CategoryPool`.
- **Employees**: `Employee` (paylocityId, supervisor self-relation, `team` written directly by
  Scheduler into this table — the two apps already share a table with a dedicated MySQL user).
- **Build Readiness**: `BuildReadinessJobSnapshot` (per-job BOM readiness %, assemblies
  ready/partial/blocked, material $ at risk, `detailJson` LongText per-assembly/vendor
  breakdown), `BuildReadinessRefreshMeta`, `BuildReadinessSavedView`.
- **Ops**: `AuditLog` (append-only, per-cell history columns), `RefreshRun`, `RefreshLock`
  (single-row atomic claim), `PowerBiFreshness`, `SavedView`, Job Cost Explorer tables.
- **Vendors/POs are NOT modeled here** — PO/vendor data is read live from **Total ETO**
  (`src/lib/job-bom.ts`, `sync-totaleto.ts`) and appears only inside Build Readiness JSON. The
  "Vendor Tracker" card is a separate estate app (not in this repo).

## C. SDC Projects Reports — what it is and how to query it

Replaces the `Project Planner Data Control.xlsx` / `End Of Month ETC Sheet.xlsx` /
`Standard Fees.xlsx` workbooks. Pages: `/etc` (monthly ETC grid), `/quoted` (Projects grid),
`/job-hours` (Job Hour Details + Parts Cost + Procurement/BOM, live TotalETO),
`/build-readiness`, `/job-cost-explorer`, `/employees`, `/audit-log`.
Data sources: **Paylocity** hours workbook (OneDrive-synced xlsx read off disk, hash-identified
imports), **Total ETO** ERP (mssql, read-only: parts cost, POs, BOM), **Power BI/Fabric**
(legacy, metadata fallback only), **SDC Scheduler MySQL** (roster mirror). Hourly + on-demand
refresh pipeline (`lib/refresh-service.ts`, 8 steps, per-step failure isolation).

**The machine-to-machine API an external app uses today** (`src/app/api/integration/*`,
exempted from browser-session middleware, guarded by a `Bearer SCHEDULER_SHARED_TOKEN` header,
fail-closed 503 if unset — `src/lib/scheduler-api-auth.ts`):
- `GET /api/integration/jobs?q=&status=` returns `{ jobs: [{ jobId, jobName, status, customer,
  type, billable }] }` (type-gated to "real" jobs, numerically sorted).
- `GET /api/integration/jobs/996` returns full detail in one call: jobId/jobName/status/
  customer/type/billable, **poStartDate/startDate/completeDate**, TotalETO est/act eng+mfg
  hours, costQuoted/costActualHistorical, **quotedHoursBySection** (keyed "10-211" etc.),
  **executionEtc {engineering, shop, parts} + executionMonth**, totEtoSyncedAt.
- `GET/PATCH /api/integration/employees` (roster), `POST /api/integration/revoke-session`,
  `POST /api/integration/sync-password`.
- **Gap for State Logic:** the job-detail endpoint does NOT yet expose the `ProjectRelease` row
  (milestones, delivery, budget lines, budgetImage). That's a small additive change on the
  Reports side — either fold release fields into `GET jobs/[jobId]` or add
  `GET /api/integration/jobs/[jobId]/release`.

So concretely, "give me project 996's releases/info" =
`GET http://server-app1:3010/api/integration/jobs/996` with `Authorization: Bearer <shared
token>` (plus the release-fields addition above for the parsed Project Release document itself).

## D. Project Planner (Scheduler) — what this repo shows

The Project Planner / scheduling app is **SDC_Scheduler at server-app1:4003 — its code is NOT
in this sandbox**, so Smartsheet sync mechanics could not be verified here. What Reports' code
confirms about it: Express + SPA (`public/app.js` reads `?job=&view=schedule` on boot), own
MySQL `sdc_scheduler` with at least `projects` (with `job_number` stamped from Reports' jobId
when a schedule is created from the ETC job list — `routes/projects.js`), `team_members`
(name/discipline/active/is_lead/sort_order/specialty), `users` (own auth; `routes/auth.js` has
the SSO verify copy and `_ssoSpent` nonce set). It creates projects by calling Reports'
`/api/integration/jobs` picker and writes `Employee.team` directly into Reports' MySQL via a
dedicated user. **No Smartsheet references exist anywhere in sdc-sheets** — if Project Planner
syncs Smartsheet, that lives in the SDC_Scheduler repo (`D:\AI Projects\SDC_Scheduler`), which
must be digested separately.

## E. Assemblies Library — what this repo shows

**Not in this repo.** No SolidWorks/CAD models, file storage, or search API exist in sdc-sheets;
the "Assemblies Library" card is another estate app (likely under `D:\AI Projects\`). The closest
things here: (1) Build Readiness's per-assembly BOM analysis (assembly part numbers, buildable
qty, vendors) sourced live from **Total ETO's engineering BOM tree** via `src/lib/job-bom.ts`,
and (2) the estimate-side `assemblies_library.json` (1,867 assemblies) documented in the
Estimate Builder section above. Whether the Assemblies Library app stores CAD screenshots that
State Logic's describe flow could pull is **unverifiable from this repo** — digest that app's
code before designing against it. If it follows estate conventions it will be another PM2
app + MySQL DB + bearer-token integration route, so the same contract shape applies.

## F. Integration contract for State Logic Builder

Estate conventions to adopt (all proven in this repo):
1. **Bearer-token server-to-server API, fail-closed** — a shared secret env var on both sides;
   endpoints under `/api/integration/*` exempt from browser auth (pattern:
   `scheduler-api-auth.ts`).
2. **Homegrown HMAC SSO for the app card** — `?sso=payload.sig` (HMAC-SHA256, 60s TTL,
   single-use nonce, domain prefix like `"sso:v1"`), verify copy on both sides
   (pattern: `scheduler-sso.ts`). Card click on the SDC Tools hub opens State Logic already
   signed in as that user.
3. **Direct read-only MySQL as a second channel** where the API is too chatty — dedicated
   read-only MySQL user, fail-soft empty results (pattern: `scheduler-db.ts`).
4. **Own your writes; never write another app's DB** — except by explicit agreement with a
   dedicated user (the one precedent: Scheduler writes `Employee.team`).

**Exists today / must be built:**

| Piece | Exists | Build |
|---|---|---|
| Project list + detail API (996's info) | YES — `GET /api/integration/jobs[/:jobId]` on :3010 | State Logic: HTTP client + `REPORTS_SHARED_TOKEN` env; Reports: nothing (reuse SCHEDULER_SHARED_TOKEN or mint a second token var) |
| Project Release contents (milestones, delivery, budget lines, budgetImage) | YES — parsed + stored (`ProjectRelease`) | Reports: expose it on the integration API (additive route/fields) |
| App card on SDC Tools hub | YES — hub + card pattern (Scheduler SPA) | Scheduler repo: add the card/link; State Logic: serve on a fixed LAN port under PM2 (`ecosystem.config.js` entry + firewall rule) and accept the `?sso=` assertion, exchanging it for a local session |
| Shared user identity | YES — email-keyed accounts + SSO/password-hash sync between the two existing apps | State Logic: an accounts table keyed by email (or auto-provision on first SSO, seeding hash via the `password-hash` fetch pattern) |
| **Jarvis brain in the shared database** | NO (today: `C:\SDC-StateLogic\jarvis-knowledge\*.json`) | New MySQL schema — either new models in a State Logic-owned database on the same MySQL 9.7 instance (`sdc_statelogic`), or added to `sdc_etc_planner` via a Prisma migration. Estate precedent favors **own database, own Prisma schema**, tables e.g. `JarvisKnowledge` (lessons/rules, versioned), `JarvisQuestion` (describe-flow Q&A), `JarvisBuildScore` (benchmark runs), each with the estate's audit fields (who/when/appVersion). Note the raw-SQL-access pattern if tables must land without a deploy window |
| Station CAD imagery for describe flow | UNKNOWN — Assemblies Library app not digested | Digest the `D:\AI Projects\` Assemblies Library repo first; fallback: `ProjectRelease.budgetImage` + TotalETO BOM already give partial context |
| Vendor/PO context | YES — in Total ETO (Reports queries it live); a TotalETO MCP already exists in Dan's tooling | State Logic can query TotalETO the same way if ever needed — read-only |

**Top risks/gotchas:** `Job.id` (PK) vs `Job.jobId` ("1079") confusion; PM2-on-Windows doesn't
kill Node processes (always free the port in deploy scripts); `prisma generate` blocked while
PM2 runs (raw-SQL new tables); everything is plain HTTP on a LAN hostname (no
crypto.randomUUID in insecure contexts — see their `client-uuid.ts`); single-process realtime
assumptions.
