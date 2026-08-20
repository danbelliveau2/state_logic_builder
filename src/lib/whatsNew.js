/**
 * whatsNew.js — single source of truth for the in-app version badge.
 *
 * UPDATE THIS FILE WITH EVERY CHANGE BATCH — Dan reads it in the app.
 *
 * How to update:
 *   1. Bump UI_BUILD (v2.0.<n>) and BUILT_AT.
 *   2. Add a new entry to the FRONT of SHIPPED with plain-English,
 *      Dan-facing lines (what he can see/do, not implementation detail).
 *   3. Prune IN_PROGRESS — move finished items into the new SHIPPED entry.
 */

export const UI_BUILD = 'v2.0.3';

export const BUILT_AT = '2026-08-20';

// Newest first. items are short, plain-English, user-visible changes.
export const SHIPPED = [
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
  'Inline editing everywhere in the summary (no edit buttons; Resubmit bar on change) — lands in v2.0.4',
  'Non-standard detection — Jarvis flags "that isn’t SDC standard" instead of silently complying — lands in v2.0.4',
  'Per-project draft handling — New Station starts blank; unfinished drafts listed inside the project — lands in v2.0.4',
  'Feature tree left panel (matching the estimate builder) — design phase',
  'Full Controls view — compiled coordination rendered on the canvas',
  'Jarvis brain moves to the shared SDC AppStack database — one Jarvis for the whole team',
];
