# Station-Builder Mode — Claude Code as the authoring interface

> Dan's Rockwell-demo debrief (2026-08-31): any Claude Code session in this
> repo (Dan's, Jason's, an agent's) is a FIRST-CLASS driver of the station
> sheet — same data, same receipts, same history as the app. The app is one
> view; the server is the truth.

## The mandate (non-negotiable)

1. **Always read the draft before editing.** `GET /api/jarvis/sheet-draft?draftId=<id>`
   returns `{ rev, draft }`. Never edit from memory or a stale copy.
2. **Every edit goes through the API — never raw file pokes.**
   `projects/_sheet-drafts/*.json` is server-owned state: writing it directly
   skips rev bumps, conflict detection, and the live broadcast. There is no
   exception path — use the endpoints.
3. **Receipts from diffs.** Every change you apply lands in the draft's
   `chatThread` as a plain-words turn describing exactly what changed — the
   app's history stays whole and Dan sees your work in his widget within ~1s
   (draft-events SSE pushes every store write to subscribed pages).
4. **Server is truth for turns.** A finished agent turn is disk-persisted;
   `GET /api/jarvis/agent-turn/last?draftId=` + `running` tells you its fate.

## The endpoints (server on :3000, vite proxy on :3131)

| What | Call |
|------|------|
| List/find the active draft | `GET /api/jarvis/sheet-draft?draftId=<id>` (draft ids: `d_…`; the newest draft is the one the app's chat pill opens) |
| Read the draft | `GET /api/jarvis/sheet-draft?draftId=` → `{ rev, draft }` |
| Write the draft | `POST /api/jarvis/sheet-draft` body `{ draftId, draft, baseRev, clientId }` — 409 on conflict: re-read, merge (human edits win), re-post. NEVER omit `baseRev`. |
| Run an engine turn (preferred for anything non-trivial) | `POST /api/jarvis/agent-turn/stream` body `{ draftId, message, speaker, audience: 'ME'\|'CE', draft, clientId }` → SSE (`state`, `reading`, `done`, `error`) |
| Reattach / turn fate | `GET /api/jarvis/agent-turn/last?draftId=` → `{ ok, at, result, running }` |
| Live page updates | `GET /api/jarvis/draft-events?draftId&clientId` (SSE `draft` events — the app already subscribes; your writes appear there) |
| Questions queue | `GET /api/jarvis/questions`, `POST /api/jarvis/questions/:id/answer { answer, answeredBy }` |
| Build the station | `GET /api/generate/stream?filename=&smId=` (SSE; artifacts saved to `generated/<project>/`) |

## The two ways to drive

**A. Through the engine (default):** post your instruction as an agent turn —
the engine applies typed diff ops, the checker gates them, the receipt is
computed from the diffs, doctrine rides via buildEngineContext. Use this for
sequence/recovery/device changes. Your Claude Code session is then a chat
client with full visibility.

**B. Direct draft edit (mechanical changes only):** GET the draft, modify the
JSON structurally (summary.devices, sequence lines, controlsNotes…), APPEND a
`chatThread` turn `{ role: 'jarvis', at: Date.now(), text: '<plain-words
receipt of exactly what changed>' }`, POST with `baseRev`. Respect standing
data rules: `deviceTombstones` (an ME-deleted device never re-enters — you
must not re-add a tombstoned name), append-only chatThread, never reorder or
rewrite existing turns.

## Standing data rules that bind every driver

- Device tombstones: `draft.deviceTombstones` / `machineSpec.deviceTombstones`
  — names there never re-enter from any artifact; only a deliberate human
  re-add clears one.
- Chat thread is append-only history — the app renders it verbatim.
- `clientId`: use a stable string (e.g. `claude-code-<user>`) so your own
  echo is distinguishable in the draft-events stream.
- Doctrine lives in `src/lib/agentGenerator/meKnowledge.md` (+ concepts) —
  read it before making controls judgments; file new engineer rulings with
  `appendLearnedFacts` (dated, attributed), never as loose notes.
