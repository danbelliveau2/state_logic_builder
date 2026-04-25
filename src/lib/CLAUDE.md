# `src/lib/` — Pure logic + L5X codegen

> ⚠️ **`l5xExporter.js` is 5,300 lines.** Read its ToC (lines 1-100) first. Don't read the whole file.

## What lives here

This folder is **everything that isn't React**: tag naming, edge geometry, step numbering, condition resolution, project save/load, and the L5X generator family.

| File                          | Purpose                                          |
|-------------------------------|--------------------------------------------------|
| `l5xExporter.js`              | Per-SM L5X generation. Has ToC at top.           |
| `supervisorL5xExporter.js`    | Supervisor program L5X.                          |
| `controllerL5xExporter.js`    | Controller-level L5X (combined).                 |
| `tagNaming.js`                | Single source of truth for `i_/q_/p_/a_` tags.   |
| `edgeRouting.js`              | `computeAutoRoute`, `enforceNodeClearance`.      |
| `computeStateNumbers.js`      | DFS step numbering (1, 4, 7, …).                 |
| `conditionBuilder.js`         | Verify-text builder for edges.                   |
| `entryRules.js`               | Entry-rule resolution + standards override.      |
| `indexSync.js`                | Index-sync resolution + standards override.      |
| `partTracking.js`             | Auto-derive PT fields from SM.                   |
| `availableInputs.js`          | What inputs can a verify edge consume?           |
| `outcomeColors.js`            | Pass/fail/etc. color map.                        |
| `deviceTypes.js`              | Device-type constants.                           |
| `deviceLibrary.js`            | Curated device library entries.                  |
| `standardsLibrary.js`         | Local standards cache + sync.                    |
| `standardsApi.js`             | Server API for standards.                        |
| `projectApi.js`               | Project save/load to server.                     |
| `useReactFlowZoomScale.js`    | Hook (only React thing here, unavoidable).       |

## Rules specific to this folder

1. **No React imports** except `useReactFlowZoomScale.js`. This folder is pure logic.
2. **No store imports.** `lib/` is leaf-level — store + components import lib, never reverse.
3. **Tag naming is centralized** in `tagNaming.js`. **Do not** hardcode `i_`/`q_`/`p_` prefixes anywhere else. If it's not in `tagNaming.js`, add it there.
4. **L5X generator: learn patterns, don't copy templates.** See user memory `feedback_generator_patterns_not_templates.md`. The generator must embody the SDC standard so it's correct without a reference file to match.

## L5X exporter shortcuts

The big file (`l5xExporter.js`) is organized by routine. Find the routine, jump straight to it:

| Routine             | Function                       | Approx line |
|---------------------|--------------------------------|-------------|
| R00_Main            | `generateR00Main`              | 1374        |
| R01_Inputs          | `generateR01Inputs`            | 1416        |
| R02_StateTransitions| `generateR02StateTransitions`  | 1769        |
| R03_StateLogic      | `generateR03StateLogic`        | 2325        |
| R20_Alarms          | `generateR20Alarms`            | 2903        |
| Servo R04/R05       | `generateServoAxisRoutine`     | 4433        |
| Recovery            | `generateRecoveryRoutine`      | 4632        |
| AOI 128Max          | `generateAOI`                  | 3629        |
| UDTs                | `generateDataTypes`            | 3199        |
| Per-SM tag emit     | `generateAllTags`              | 688         |
| Controller tags     | `generateControllerTagsXml`    | 4790        |
| ZIP packaging       | `buildZipBlob`, `crc32`        | 5140, 5214  |

See `src/WHERE.md` for the project-wide map.
