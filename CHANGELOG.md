# Changelog — SDC State Logic Builder

All notable changes to this project. Most recent first.

---

## Unreleased
- ONE MASTER KNOWLEDGE FILE on the share: `SDC Engineer\Knowledge\SDC-Engineer-Knowledge.md` — meKnowledge laws, all concept docs, precedents, standards extracts, template patterns in one file; auto-regenerated each librarian run; `## Engineer additions` section preserved verbatim and ingested back (attributed, top tier, rides buildEngineContext)
- Share minimalism (Dan): SDC Engineer folder = `CLAUDE.md` + `Knowledge\` (one file) + `Examples\` (Jason owns structure); drop-folder/README/category scaffolding and the questions-for-ce.md push retired — nothing auto-creates share structure anymore
- ANSWERS-EXIST LAW: every pre-write hold question (readiness + init coverage) is checked against standing doctrine, prior engineer answers, and the sheet before it may hold — decided questions become pre-write decisions, not asks (the gripper re-ask)
- Device TOMBSTONES: an ME-deleted device never re-enters from a stale artifact (spec re-extraction, re-summarize, agent turn); deliberate manual re-add clears the tombstone (the Escapement_Finger_2 resurrection)
- STUCK = LOUD: a held build announces itself instantly — banner under the top bar + Questions badge; agent-turn results persist to disk (a server restart can no longer eat a finished turn) and reconnect fetch-and-renders or fails fast with Retry
- Chat widget: always opens pinned to the latest turn; chat pill closed-widget states (unread badge + pulse, questions badge priority, thinking spinner); new layout invariants gate all three
- Two-program station build (MidBaseLoad → PickAndPlace + Escapement): resumed with Dan's gripper ruling as doctrine; merged multi-program L5X validated via import simulation
- JARVIS Inbox librarian: local drops + network watch folders (X:\Electrical Dept via UNC, read in place) classified and distilled into the one knowledge store; daily run, on-start scan, and "Learn now" on the Jarvis Knowledge tab; every read ledgered in `JARVIS Inbox\_learned\LEDGER.md`; conflicts filed as questions
- Docs folder created: architecture, decisions, known-issues, roadmap
- CLAUDE.md restructured to reference docs/ sub-files

---

## v1.24.22 (2026-04-26)
- Fix: 6 bugs across vite config, server, main process, and dev launcher
- Fix: bundle node_modules so electron-updater resolves in packaged app
- Fix: sync in-app version banner with servo L5X fixes

## v1.24.21 (2026-04-24)
- Fix: clean R03 servo duplication
- Fix: full AxisParameters defaults in L5X export

## v1.24.20
- Reunify L5X generator with v1.24.19 signal UI changes

## v1.24.19
- Embedded decisions in state nodes
- Signal latches
- Chip style fixes

## v1.24.3 / v1.24.2
- Fix: NSIS auto-update corruption — added `build/installer.nsh` custom uninstall hook
- Fix: `autoInstallOnAppQuit = false` to prevent double-trigger of installer

## v1.24.1
- Fix: Servo Edit modal — Axis Name label, dropped PLC Tag Stem field

## v1.24
- Wait node subtitle now names the actual PLC tag
- Single-exit edges render as plain gray (no color)
- Robot device icon added
- Fix: offline pill stuck on after successful standards sync

## v1.23 / v1.23.1
- Team-shared standards library via `/api/standards` endpoint
- Fix: offline pill stuck after sync + debug endpoint

## v1.22
- Wait-branching rule enforcement
- Standards library seed/export

## v1.21
- Edge clearance: owner nodes push their own stub-adjacent segments out of the way

## v1.20
- Standards auto-save
- Copy + inline rename for standards
- Category grouping in standards list

## v1.19
- Editable canvas spacing
- Selection-aware re-space

## v1.18
- Per-segment arrows on edges
- Op-pill switcher
- Live state signals in Decision node

## v1.17 / v1.16
- Save/Load: remembers file path, no repeated dialogs
- Unsaved-changes guard on close (Save / Don't Save / Cancel)
- Auto-restart on update — no manual restart required
- Default save dialog remembers last folder

## v1.15
- Signal badge replaced with flag icon
- Workflow: auto-sync version from APP_VERSION

## v1.14
- Pill header style
- Red recovery state
- Standards naming form in UI

## v1.13
- Standards Library — save/browse/open SM templates

## v1.12
- L5X export for R05_Recovery routine

---

> For full commit history: `git log --oneline`
