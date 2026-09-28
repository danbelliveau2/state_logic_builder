# Start here — SDC Engineer, for anyone at SDC

One common folder: `X:\Electrical Dept\SDC Engineer\`. Everything the code builder knows is in it or reached from it.

## Point your Claude at it (once)
1. Install Claude Code (desktop app). Map N: and X:.
2. Clone the tool once: `git clone https://github.com/danbelliveau2/state_logic_builder.git C:\SDC-StateLogic`, then `npm install` in that folder. Pull before each session.
3. In Claude Code, open the folder `X:\Electrical Dept\SDC Engineer`. Its CLAUDE.md and the `.claude\skills` inside load automatically.

## The prompt to give people
> Read `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` and `Knowledge\SDC-Engineer-Knowledge.md` (Engineer additions) first. The tool is the clone at `C:\SDC-StateLogic`. Then run `/sdc-readiness` for job `N:\<job folder>`.

## Then
- `/sdc-readiness <job>` — do we have the nine inputs? Verdict before any code.
- `/sdc-build <job>` — build or add an increment. One delivered file.
- `/sdc-review` — standards review before the CE sees it.
- `/sdc-cover-note` — the one-document note.
- `/sdc-learn-return` — a returned file, a CE note or a session export becomes rules.

## Rules of the folder
- `Knowledge\` is Jason's. Append under `## Engineer additions` only when he asks.
- `Examples\` is Jason's. Add nothing without him.
- `Playbook\` and `.claude\skills\` are synced from the repo (`node scripts/syncSharedFolder.cjs`). Edit them in the repo, not here.
- `Playbook\DEVIATIONS.csv` — the live deviation grid (Excel). Every deviation an engineer builds is a row, Status Open. The controls manager sets Approved / Denied. A deviation never blocks a build.
- `Lessons\<your username>\lessons.md` — your sessions write what you teach them here, one dated line each. Merged daily.
- `Sessions\` — export your Claude session zip here when a session settled rules worth learning.
- `Deliveries\<job>\` — delivered L5X and cover note per job, so the team finds the latest in one place.
