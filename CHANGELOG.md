# Changelog — SDC State Logic Builder

All notable changes to this project. Most recent first.

---

## Unreleased
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
