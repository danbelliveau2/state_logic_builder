---
name: sdc-build
description: Build or rebuild a machine's PLC program (L5X) the SDC Engineer way — readiness, plan, contract, parallel builders, shape gate, assembly, import simulation, one delivered file. Use when asked to build, rebuild or add an increment to a job's code.
---

Before anything: read `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` in full and `X:\Electrical Dept\SDC Engineer\Knowledge\SDC-Engineer-Knowledge.md` → `## Engineer additions`. Both are binding. A job's working set (plan, contract, build programs, outputs) lives on the share at `X:\Electrical Dept\SDC Engineer\Deliveries\<job>\build-inputs\` so every PC sees the same files; the build scripts live in the repo clone (`scripts/`).

1. **Readiness first** — run `/sdc-readiness`. Build only on BUILD or BUILD ON ASSUMPTIONS; list the assumptions.
2. **Plan + contract** — one JSON per station (devices, numbered steps, part tracking, questions) and a NAMES CONTRACT (programs, parameters others read, device points, angles, side mapping, CE rulings). Reuse `generated/1160/build/NAMES_CONTRACT.md` as the shape.
3. **Example per station** — from `station-examples.json`. No example → the simplest example form that fits plus one question; never a new feature.
4. **Build** — one builder per program family in parallel; each must print 0 findings from the shape checker before returning. Twins A→B by script only. Builders never touch another builder's file.
5. **Assemble + verify** — `assemble1160.cjs` (copy and re-point for a new job) → `validate1160.cjs` (import simulation 0 errors) → whole-file verify of every CE ruling.
6. **Deliver** — one file, one name, stamped copy in `_history`. Reveal the full path.
7. **Cover note** — `/sdc-cover-note`. No agents.
8. **Cost** — keep a ledger row per increment (tokens, $, what changed). Stop at the cap the owner set and ask.
