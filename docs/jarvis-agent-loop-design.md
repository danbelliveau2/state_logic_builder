# Jarvis Agent Loop — Design (for Dan's review, 2026-08-28)

> Status: DESIGN ONLY — nothing built until Dan approves.
> Author: Jarvis engineering session, from Dan's directive: rebuild the engine
> from one-shot prompts into a tool-using agent that can "immediately step in
> and act and think" the way the assistant he talks to does.

---

## 1. What changes, in one paragraph

Today, every chat turn and gate event is a ONE-SHOT call: we stuff everything
we think Jarvis might need into a single prompt (the sheet, the proposal, the
chat, the knowledge), he answers once, and whatever he says is what we get —
if he "removed a device" that only existed in one of three artifacts, the
other two never heard about it, and we've been patching those propagation
holes one bug at a time (Finger 2, the struck sequence lines). The rebuild
makes Jarvis an AGENT: when you talk to him, he runs a loop — he reads what
he needs, thinks, makes each edit through a typed action that returns the
real diff, re-reads to confirm it landed, and only then speaks. Receipts
stop being possible to fake because they are assembled from the diffs the
actions returned, not from what the model says it did.

## 2. What Jarvis sees (the read tools)

Each is a tool the agent may call mid-turn, as many times as it needs.
Nothing is stuffed into the prompt "just in case" — he pulls what the task
requires, which is also what makes the shipped-code library usable at all
(it is far too big to stuff).

| Tool | Returns |
|---|---|
| `read_sheet` | The complete sheet state — devices with types/values, sequences, recovery, signals — INCLUDING the derived render data: interaction tags per line, device→machine grouping, which sections are revealed. **Jarvis sees exactly what Dan sees**, so "line 6's tag" is a real thing he can find. |
| `read_chat_history` | The draft's full conversation, both sides, timestamps. |
| `read_cascade_position` | Where the walk is: the active step, what's approved, what's hidden, open questions per step. |
| `read_knowledge` | The standing laws + filed rulings (meKnowledge), and any named concept file (station archetypes, multi-state-machine, servo motion). |
| `search_precedents` | Query against the harvested precedent digest — shipped names, ownership patterns, station shapes. |
| `search_shipped_code` | Query against `plc-reference/` incl. the verified library (v7 etc.) — returns matching rungs/routines/tag patterns with file + location cited. Search, never stuffed. |
| `read_changelog` | The sheet's recent actions — what was renamed, moved, approved, when. |

## 3. What Jarvis can do (the write tools)

Every write is a TYPED operation applied by our code, not free-form text the
client has to interpret. **Every one returns the actual before/after diff**,
and the agent's final receipt to Dan is composed from those returned diffs —
a claim with no diff behind it cannot be spoken.

| Tool | Operations |
|---|---|
| `apply_edit` | `device.add / device.remove / device.rename / device.reassign` (remove is atomic: sheet row + questions + assignment record, one call) · `sequence.insert / sequence.remove / sequence.reword / sequence.set_tag / sequence.clear_tag` (tag ops touch the counterpart only — a tag op physically cannot delete a line; step payloads are structured `{action, target, detail, counterpart}` and `action` is validated against the ONE operation vocabulary shared with diagram actions and codegen: Extend/Retract, Engage/Disengage for grippers — never Open/Close — Servo Move, Index, Wait, Signal, Home) · `value.set` (timer, position, setpoint) · `recovery.*` (same shapes as sequence) · `signal.add / signal.remove` (both sides required or the op is rejected) |
| `close_question` / `open_question` | Question lifecycle — removing a device auto-closes its questions inside `device.remove`, but the agent can also close a question it just answered from precedent, with the citation attached. |
| `ask_engineer` | Adds a numbered question to the active step (the Q1/Q2 panel). Carries the mandatory "I searched our shipped work…" framing when it's a no-precedent ask. |
| `note_to_engineer` | One user-facing sentence for when a request was honored somewhere other than a visible line. Only renders if the diffs support it (the never-silent guard stays). |

## 4. How Jarvis verifies (trust but re-read)

1. After each `apply_edit`, the agent RE-READS the affected artifact and
   confirms the change is present. An edit that didn't land is retried once,
   then reported honestly — never narrated as done.
2. When the agent says it's finished, the CHECKER still runs — a second,
   independent pass over the turn's accumulated diffs against the laws and
   the engineer's message: was every comment applied, did anything get
   deleted that wasn't asked for, does every signal have both sides, did an
   approved name change. Fix verdict = one bounce back into the loop with
   the violations named. Only then does the result render.
3. Receipts = the diff list, grouped and spoken plainly. The model's own
   prose never becomes a receipt.

## 5. What Dan sees while it works

Streamed progress states in the chat, live (the thinking indicator grows up
into a narrated activity line):

> *reading the sheet… · searching shipped work for "escapement bowl"… ·
> editing the Escapement sequence (2 changes)… · verifying… · checking…*

Each state is emitted by the loop as it happens (SSE, same transport as the
summarize progress bar today). If Dan closes the page mid-turn, the turn
finishes server-side and the result is waiting in the draft on reload.

## 6. When something breaks

- A tool error (bad edit target, server hiccup) is caught inside the loop:
  the agent sees the error text and can retry or work around it; if the turn
  dies entirely, Dan gets the real reason in one line and HIS TEXT STAYS IN
  THE BOX (the send-path law).
- Per-turn hard caps: **$1.00 or 90 seconds or 25 tool calls**, whichever
  hits first. On cap: the agent is told to wrap up — apply nothing further,
  state honestly what was and wasn't done. Never a silent partial.
- Abort: Dan sending a new message aborts the in-flight turn cleanly (edits
  already applied stay — they're real diffs — and the receipt says how far
  it got).

## 7. The laws ride the system prompt

The standing rulings load into the agent's system prompt on every turn, the
same way they ride today's calls (buildEngineContext), plus the agent-specific
contract: one engine · gate-driven only · no duplicate surfaces · SDC voice
(devices are "part of" a machine) · sequence lines are the action only, no
parentheses · tag feedback never deletes lines · ask once, file forever ·
precedent-cited decisions, invention last · never silent — every send gets a
receipt or a stated reading · internals never print.

## 8. Runtime shape

- Server-side (node, `@anthropic-ai/sdk` tool-use loop) in
  `src/lib/agentGenerator/agentLoop.js` — one module owning the loop, tool
  registry, caps, and streaming. The tools are thin wrappers over the same
  draft-state the client mirrors to the server today (`/api/jarvis/sheet-draft`),
  which becomes the agent's working copy: the client sends the current draft
  with the turn, the agent edits the server copy through the tools, and the
  client applies the returned diff list — the render never depends on the
  model, and the client remains the storage authority.
- Model: **opus for the loop** (Dan, 2026-08-30: "act and answer questions
  correctly — that's all I care about"; upgraded from the original sonnet
  design call). The checker stays on the cheap tier (bounded verification).
  Prompt caching on the system prompt + knowledge block keeps the multi-step
  overhead down; batched `apply_edit` ops keep call counts low. Per-turn
  caps: $2.00 / 90s / 25 tool calls.

## 9. Cost and speed, honestly

| Turn type | Today (one-shot, sonnet) | Agent loop (opus) |
|---|---|---|
| Simple chat correction | ~$0.03–0.08, 8–20s | ~$0.25–0.60, 12–30s |
| Multi-edit round (device + sequence + question) | ~$0.15–0.30, 20–40s — and propagation bugs | ~$0.50–1.20, 25–60s — verified, atomic |
| Gate event (split revision) | ~$0.20–0.35, 25–60s | ~$0.60–1.50, 30–75s |

Roughly 2–3× the sonnet-loop cost for the top reasoning tier — Dan's explicit
call (2026-08-30): "act and answer questions correctly — that's all I care
about." Fewer wrong turns is cheaper than cheap wrong turns — one misapply
costs more engineer time than a month of the delta. Cap $2.00/turn.

## 10. Migration — one door at a time, old doors deleted

- **Phase 1 — the chat engine** (highest pain): every chat turn on a draft
  routes through the loop. The one-shot correction paths
  (`routeCorrectionRound_`'s classify/fast-path branches and the decompose
  correction round) are DELETED when it lands, per the flow-replacement law.
  The structured sequence steps just shipped are this phase's data model.
- **Phase 2 — gate events**: explanation submitted, split approval,
  per-step approvals. `decompose` becomes the loop with a decomposition
  goal; `summarize` extraction likewise. One-shot versions deleted.
- **Phase 3 — codegen**: the Generate study/write/review pipeline adopts the
  same tool registry (it is already partially agentic); `search_shipped_code`
  replaces exemplar stuffing.

Each phase ships behind its own verification round on Dan's real drafts
before the old path is removed — but removal is in the SAME release that
proves the new path, never "later".

## 11. Build estimate

| Piece | Size |
|---|---|
| Tool registry + typed `apply_edit` ops with diffs (server) | 2–3 sessions |
| Agent loop module (SDK loop, caps, abort, streaming states) | 1–2 sessions |
| Client: turn transport, progress states, diff application, receipt render | 1–2 sessions |
| Checker-over-diffs pass + regression suite (transcripts as fixtures, incl. the Finger-2 and tag-misapply transcripts) | 1 session |
| Phase-1 cutover + old-path deletion + live verification with Dan | 1 session |

**Phase 1 total: roughly 6–9 working sessions.** Phases 2 and 3 are smaller
(the registry and loop are reused): ~2–3 sessions each.

## 12. What this fixes that patching cannot

Every recent P0 is the same disease: one-shot output applied to some
artifacts and narrated for the rest. Finger 2 (proposal edited, sheet not),
the struck sequence lines (tag feedback with no tag to grab), the eaten
message (no receipt path), the 200-HTML errors (no honest failure path).
The loop kills the class: reads are real, writes are typed and diffed,
receipts are computed, and verification is part of the turn — the same
architecture the assistant Dan talks to runs on, pointed at his sheet.
