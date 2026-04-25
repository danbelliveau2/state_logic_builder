# `src/store/` — Zustand store

> ⚠️ **Read [`useDiagramStore.js`](useDiagramStore.js) lines 1-80 first** for the table of contents. Do not read the whole file (4900 lines).

## Rules specific to this folder

1. **Always `get()` for fresh state inside actions.** Never read stale `state` parameter from `set()`.
2. **Always call `get()._pushHistory()` before any mutating action.** Undo/redo break otherwise.
3. **Persist middleware:** see ToC line range 4778-4873. Stuff that must NOT persist (history `_past`/`_future`, transient UI flags) goes in `partialize`'s denylist.
4. **Auto-save subscription** (lines 4878-4897) writes to the project file every 2s after a change. Don't add another subscribe — extend the existing one.
5. **Atomic helpers at the top** (lines 14-322): `_updateProject`, `_mutateNodeInSm`, `_uniqueName`. **Use them.** Don't roll your own.

## Common confusions

| Symbol                    | What it is                                         |
|---------------------------|----------------------------------------------------|
| `_pushHistory`            | Snapshot before mutate. Always first line of action. |
| `addDecisionBranches`     | Dual exit (pass + fail). Line 2069.                |
| `addDecisionSingleBranch` | Single exit (just one path). Line 2220.            |
| `syncDecisionExitLabels`  | Re-derives "Pass_X" / "Fail_X" labels. Line 2649.  |
| `findOrCreateVerifyDevice`| Ensures a verify-input device exists. Line 3561.   |
| `_connectMenuHandleId`    | Tracks which handle was clicked for ConnectMenu.   |

## Don't reinvent

- Tag naming → `lib/tagNaming.js`
- Step number → `lib/computeStateNumbers.js`
- Edge geometry → `lib/edgeRouting.js`
- Project save/load → `lib/projectApi.js`

See `src/WHERE.md` for the project-wide map.
