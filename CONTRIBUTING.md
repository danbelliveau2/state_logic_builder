# Contributing to State Logic Builder

## Team Workflow — Parallel Development

Four developers work on this repo in parallel. This guide keeps everyone from stepping on each other.

---

## Branch Naming

Each person works on their own branch, never directly on `main`:

```
dev/dan-<short-description>
dev/tim-<short-description>
dev/ian-<short-description>
dev/jason-<short-description>
```

**Examples:**
```
dev/tim-servo-export-fix
dev/ian-pneumatic-device-type
dev/jason-picker-grammar-update
dev/dan-store-edge-refactor
```

---

## Ownership Zones

To minimize merge conflicts, each developer owns a zone of the codebase.
**Coordinate with the zone owner before editing their files.**

### Dan — Canvas & Store (project lead)
- `src/store/useDiagramStore.js`
- `src/components/Canvas.jsx`
- `src/components/Toolbar.jsx`
- `src/App.jsx`
- `package.json` (version bumps — see warning below)

### Tim — L5X Export & Tag Naming
- `src/lib/l5xExporter.js`
- `src/lib/controllerL5xExporter.js`
- `src/lib/supervisorL5xExporter.js`
- `src/lib/tagNaming.js`
- `src/lib/computeStateNumbers.js`

### Ian — Device & IO Layer
- `src/lib/deviceTypes.js`
- `src/lib/deviceLibrary.js`
- `src/components/DeviceSidebar.jsx`
- `src/components/IOMapEditor.jsx`
- `src/components/IoMapView.jsx`
- `src/lib/availableInputs.js`
- `src/lib/getProjectIoMap.js`

### Jason — Standards, Picker & Conditions
- `src/lib/standardsLibrary.js`
- `src/lib/pickerGrammar.js`
- `src/lib/conditionBuilder.js`
- `src/components/UniversalPicker.jsx`
- `src/components/StandardsProfileEditor.jsx`
- `src/components/PartTrackingPanel.jsx`
- `src/lib/partTracking.js`

---

## Daily Workflow

### Starting a new task
```bash
# Always branch from the latest main
git checkout main
git pull origin main
git checkout -b dev/your-name-short-description
```

### Staying up to date while you work
```bash
# Pull main into your branch regularly to avoid large conflict batches
git fetch origin
git merge origin/main
```

### Finishing a task
```bash
git push origin dev/your-name-short-description
# Then open a Pull Request on GitHub: dev/your-branch -> main
# Tag Dan as reviewer
```

---

## Pull Request Rules

1. All PRs merge into `main` — no direct pushes to `main`
2. Dan reviews every PR before merge
3. Keep PRs small and focused — one feature or fix per PR
4. Reference the relevant files from `src/WHERE.md` in your PR description so reviewers know where to look

---

## Hard Rules (read carefully)

### DO NOT touch these without coordinating with Dan:
- `src/store/useDiagramStore.js` — central Zustand store, changes ripple everywhere
- `package.json` version field — bumping version triggers the GitHub Actions release pipeline and builds a new Electron installer within 2 minutes. Rapid bumps have caused NSIS installer corruption (2026 incident).

### Shared risk files (narrow your edits, communicate):
- `src/lib/l5xExporter.js` (253 KB) — use the internal table of contents; keep PRs to one section at a time
- `src/index.css` (162 KB) — own only the styles for your zone's components
- `src/components/Canvas.jsx` — owned by Dan; open an issue before editing

---

## Resolving Merge Conflicts

If you and another developer edited the same file:

```bash
# On your branch, merge main to surface conflicts early
git merge origin/main

# Git marks conflict zones like this:
# <<<<<<< HEAD
#   your code
# =======
#   their code
# >>>>>>> origin/main

# Edit the file to keep the correct version, then:
git add <conflicted-file>
git commit -m "Resolve merge conflict in <file>"
git push origin dev/your-branch
```

When in doubt, call Dan or the zone owner before resolving — don't guess on PLC logic.

---

## Reference

- `src/WHERE.md` — task-to-file mapping; start here before any new work
- `src/components/CLAUDE.md` — component-level guidance
- `src/lib/CLAUDE.md` — library-level guidance
- `CLAUDE.md` (root) — full AI-assisted development reference and 30 critical corrections
