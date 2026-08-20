/**
 * whatsNew.js — single source of truth for the in-app version badge.
 *
 * UPDATE THIS FILE WITH EVERY CHANGE BATCH — Dan reads it in the app.
 *
 * How to update:
 *   1. Bump UI_BUILD (v2.<minor>.<n>) and BUILT_AT.
 *   2. Add a new entry to the FRONT of SHIPPED with plain-English,
 *      Dan-facing lines (what he can see/do, not implementation detail).
 *   3. Prune IN_PROGRESS — move finished items into the new SHIPPED entry.
 */

export const UI_BUILD = 'v2.1.1';

export const BUILT_AT = '2026-08-20';

// Newest first. items are short, plain-English, user-visible changes.
export const SHIPPED = [
  {
    version: 'v2.1.1',
    date: '2026-08-20',
    items: [
      "Build always tells you what it's waiting for (and clicking it takes you there)",
      'Required vs optional is now visually explicit',
      "Questions: no more caps — Jarvis asks what he genuinely needs; 'you decide' is an answer he remembers",
      'Servo move chips now show the speed profile — "→ PickTransition 60.0 · Fast 2500" — so you can see fast-to-here-slow-the-rest right on the canvas; blended corners get a small "≈ blends" hint',
      'Machine tally lines expand — click Valves, Sensors, Inputs, Outputs (IO is now split in/out) or any other line to see exactly which device on which station contributes what',
      'Full Controls now surfaces the open controls questions at the top with talk-or-type answer boxes — "Apply answers" re-compiles with your answers applied and clears the matching queue items',
      'A "then what?" bar at the bottom of the canvas walks the journey: Compile → Review & Approve → Generate, with one button for whatever comes next',
      'Standard vertical spacing is now compact (50px gap) — new stations draw tighter, and the Re-space button applies the same standard to existing ones',
    ],
  },
  {
    version: 'v2.1.0',
    date: '2026-08-20',
    items: [
      'THE BIG ONE — the thinking moved to Build time. Build ▾ → "Compile sequence (Jarvis)": Jarvis reasons through the FULL sequence once (~4 min, well under a dollar) and you review it BEFORE any code exists',
      'Full Controls is real: the compiled sequence renders as a scannable view — every state with its number and actions, every transition with the actual rung condition, waits with their exits, handshakes with set/clear states, and amber "review before approving" flags',
      '"Approve — I agree with this sequence" right on the compiled view — approval is your sign-off, and it flips Generate into translation mode (~2.5 min, ~$0.95 instead of reasoning from scratch)',
      'Change something by explaining it: a talk-or-type notes box under the compiled sequence re-compiles with your notes attached (re-compiling always clears approval so you review again)',
      'Approve and walk away — code pre-builds in the background from your approved sequence; when it\'s ready, Generate shows "✓ code built — instant" and Start is an immediate download',
      'The Generate picker now tags each station: "approved → translation" (fast path) or "✓ code built — instant"',
      'No compiled sequence yet? Full Controls says so honestly and offers the Compile button right there',
      'Under the hood, today\'s batch: R02 rungs carry a state-map comment (readable in Studio 5000), generated comments are validated, stations can be addressed by name, and translation-mode numbers are live from real builds',
    ],
  },
  {
    version: 'v2.0.6',
    date: '2026-08-20',
    items: [
      'Generate now asks what you\'re generating — tiers: station sequence (pick one or several), multi-station integration (early), full machine (coming)',
      'Pick several stations and Jarvis generates each in turn — "Station 2 of 3" progress, one L5X per station, a score row for every build',
      'Cancel mid-run stops after the in-flight station and reports which ones completed',
      'No more "is it frozen?" — you now WATCH Jarvis think: live reasoning summaries stream into the log while it works, with a pulsing alive dot',
      'The ring moves honestly through the thinking phase (15→45%) and holds rather than fakes when reasoning runs long; when writing starts the status flips to "Writing the edit plan — N tokens" (45→70%)',
      'Typical-duration hint under the timer (from Jarvis\'s own build history), and an amber "connection may be stalled" warning only if the stream truly goes silent for 90+ seconds (the server now heartbeats every 15s)',
      'Dead stream mid-run? One-click "Retry generation" re-runs the station on a fresh connection; Cancel becomes "Cancel & clean up"',
      'Tree counts drop the ~ (looked like negative numbers)',
      'App-wide UI scaling control (−/100%/+ in the top bar), like the other SDC Tools apps',
    ],
  },
  {
    version: 'v2.0.5',
    date: '2026-08-20',
    items: [
      'Feature tree left panel — the same tree as the estimate builder: caret + colored square + name + dotted leader + right-aligned count on every row',
      'Tree levels: Machine root (name + job #) → Machine totals (the quoting tally) → Stations (each expands to its Spec line + devices; drafts listed too) → Documents',
      'Station squares tell you the state at a glance: amber = no spec yet, green ✓ = spec + logic drawn, red = last Jarvis build failed validation',
      'Quiet "incomplete: N no spec" badge on the machine root — never a popup',
      'The tree drives the canvas: click a station to show it; selecting a station anywhere auto-expands its tree node',
      'FIXED: scroll-wheel zoom dying after a project switch (the canvas briefly unmounts and lost its wheel listener) — zoom now survives project switches in both apps',
      'Station Spec: answer Jarvis\'s clarifying questions right in the banner — type or talk, then "Apply answers" folds them into the spec',
      'Answered questions disappear; Jarvis never re-asks a question you already answered, even reworded',
      'Saving a spec with open questions sends them to Jarvis\'s queue for the controls team (noted in the banner)',
    ],
  },
  {
    version: 'v2.0.4',
    date: '2026-08-20',
    items: [
      'After Build, you land on the canvas — no second review layer; open questions go to Jarvis\'s queue',
      'Summary is editable in place — click any line to change it, no edit buttons; "+ add a line" per section',
      'Edited the summary? A sticky bar offers "Resubmit to Jarvis" (re-checks with your edits) or "keep my edits as-is"',
      'Non-standard detection — when a request contradicts an SDC standard, an amber "Not SDC standard" card shows what you asked vs the standard; Jarvis builds it your way and flags it for controls review (saved with the station)',
      '+ New Station always starts blank — no more silent draft restore',
      'Unfinished drafts are listed per project: a banner on the fresh page and a "Drafts (N)" row in the Stations panel (resume with one click, discard with ✕)',
    ],
  },
  {
    version: 'v2.0.3',
    date: '2026-08-20',
    items: [
      'FIXED the recurring "server offline" / "Diagram request failed (500)" — the API server was dying whenever its launcher shell closed; it now runs as a detached process',
      'Build Station always clickable — the dead "Build as-is" path is gone; thin coverage = one confirm, then it builds',
      'Project lifecycle: close tabs → clean-slate start screen → ＋ New Project (name + job #) → stations inside',
      'Project delete actually deletes (fixed the save-on-switch resurrection bug); New Project + delete in the picker',
      'Stations panel: old-app device rows (icons + full names), expandable per station',
      'Machine totals (quoting estimate): servos, motors, pneumatics, ~valves, sensors, vision, ~IO — live',
      'View switcher merged into the station pill — no more overlapping headers',
      'Per-project Documents drawer (drag/paste/browse) for release docs Jarvis will read',
      'Summary cards: status chips in headers, device icons, IO & Pneumatics capture',
      'Build scoring: every build auto-recorded; score it 1-10 with a dictated comment; avg per version in Track record',
      'Mic on every text input (answers, comments, edits) — talk anywhere you can type',
      'Jarvis knowledge grouped by topic (servo PnP, pneumatics, recovery…) and editable per line',
      'Dev server now opens /v2.html, and v2 never navigates you back to the classic app',
    ],
  },
  {
    version: 'v2.0.2',
    date: '2026-08-19',
    items: [
      'Questions never block Build — Jarvis decides open ones per SDC standards and notes them for review',
      'No more question loops: max 3 per round, zero new questions after round two',
      '"Build as-is" escape hatch even when coverage is thin (Jarvis fills gaps and flags them)',
      'Device taxonomy fixed — valves and "EOAT assemblies" are no longer listed as devices',
      'Jarvis standing knowledge: standard-answer questions (servo speeds in HMI, timers…) are never asked',
      'Jarvis learns from your answers — standing rules are remembered permanently ("won’t ask again")',
      'The Jarvis page (v2 shell, top bar): question queue for the controls team, knowledge browser, track record',
      'This version badge — hard reset button, latest changes, and what’s still being built',
    ],
  },
  {
    version: 'v2.0.1',
    date: '2026-08-19',
    items: [
      'Describe-first Create Station — just talk; a live checklist fills in and gates the Build button',
      'Voice dictation with the checklist reacting live as you speak',
      'Create flow is now a full page with draft autosave — nothing is lost if you close it',
      'Ctrl+V pastes screenshots straight into the description',
      'Jarvis summary shown as scannable section cards, with its Questions called out',
      'Real progress rings while Jarvis works (no more fake spinners)',
      'Cost ceilings replace token limits — $5 for a summary, $20 for a generate',
      'New v2 shell: stations list on the left, view switcher, Build menu',
      'In-app project picker — open and switch projects without leaving the app',
      'Decision-node handle fix — branches connect from the correct side',
    ],
  },
];

// Being built right now — NOT in the current installed build yet.
export const IN_PROGRESS = [
  'Background pre-build service — the "instant Generate" backend piece (the UI is ready and lights up when it lands)',
  'Compiled sequence rendered as real nodes on the canvas (today it\'s the structured list view)',
  'Jarvis brain moves to the shared SDC AppStack database — one Jarvis for the whole team',
];
