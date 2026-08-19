# Questions for Controls Engineering Leads
> Purpose: gather what an AI agent needs to generate good, solid, reliable SDC PLC code.
> Meeting output = answers to these + the documents listed at the bottom.

---

## 1. What is "good SDC code"? (acceptance criteria)
1. If you opened a program from another SDC engineer, what would make you say "this is done right" in the first 5 minutes? List the tells.
2. What are the top 5 things the current generated code gets **wrong** that a competent engineer would never do?
3. Who is the authority when engineers disagree on style — is there one person whose code is the gold standard? Which project of theirs is the single best example?
4. What's the acceptance test? ("Imports clean into Studio 5000" is not enough — what makes you trust it enough to run on a machine?)

## 2. State transitions (worst area today)
5. Walk through one perfect transition rung, instruction by instruction: what conditions are ANDed, in what order, and why?
6. What are ALL the transition condition types you actually use? (sensor made, timer done, servo in position, vision result, signal from another station, operator input, part-tracking state…)
7. When a state has multiple exits (pass/fail, branch), how exactly is that structured in R02 — one rung per exit? Priority order?
8. How do timers work in transitions — where does the timer live, what starts it, what resets it? Show the standard pattern.
9. Backward jumps / retries — what does a "go back to step N" transition look like, and what has to be cleaned up when it fires?
10. Anti-patterns: show 2–3 real examples of transition code done WRONG (old projects are fine) and explain why it's wrong.

## 3. Devices — servo vs pneumatic vs everything else
11. For each device type (pneumatic cyl, gripper, servo axis, digital sensor, analog sensor, vision, robot, indexer/escapement): what code MUST exist when that device is on a machine? (tags, R01 rungs, state logic, faults, HMI)
12. Servo moves: walk through one complete servo move state — what's in R03, what's in R02, how "in position" is confirmed, and what the servo routine (R04/R05) handles vs. what the state logic handles.
13. Pneumatics: what's different between a 2-sensor cylinder, a 1-sensor cylinder, and a no-sensor (timer-only) cylinder in the generated code?
14. How does the code know a device is "safe to move"? Where do interlocks/permissives live and how are they named?
15. Mixed states: when one state fires a servo move AND a pneumatic action, how is completion of the state determined?

## 4. Faults & alarms
16. What faults are mandatory per device type, and what's the standard fault timeout for each?
17. What happens on fault — does the sequence hold in state, jump to a fault state, or lock out? Standard recovery path?
18. ProgramAlarmHandler: exactly what gets wired in, and what does the engineer configure vs. what should be generated?

## 5. Modes & HMI
19. Beyond Lockout / DryRun / Single-Step: what other modes exist (manual, home, purge, empty-out)? What code does each require?
20. Manual mode: is there a standard manual-control pattern per device the generator should emit, or is manual always hand-written?
21. Homing: what's the standard homing sequence logic for a station with servos, and does it belong in generated init states (100–127) or elsewhere?

## 6. Structure & naming edge cases
22. Where does the current tag-naming standard NOT cover a case, forcing engineers to improvise? List the improvisations.
23. Cross-station communication: exact standard for handshake tags between stations (who owns the tag, naming, set/clear responsibility)?
24. Part tracking: what should generated code write to PartTracking and when — and what stays engineer-authored?
25. What belongs in R01_Inputs beyond debounce/decode — any per-project conditioning the agent should ask about?

## 7. Judgment calls (where the agent must think, not follow rules)
26. Give 3 examples where two SDC-standard-compliant ways exist to code something and the engineer chose based on context. What drove the choice?
27. When old reference code conflicts with the new standard, are there any cases where the OLD way should still win?
28. What should the agent ASK the engineer before generating, vs. decide on its own? Where's the line?

## 8. Per-sequence questions (draft — the agent asks these before every generation)
Validate/edit this list — is this what you'd want to be asked before code is generated for a new station?
- Station type and what it physically does, in one sentence per state?
- Full device list with types, and which sensors each device actually has?
- For each transition: what condition, and what's the fault timeout?
- Any cross-station signals in or out?
- Part tracking pass/fail write points?
- Anything nonstandard about this machine the standard doesn't cover?

---

## Documents to collect at the meeting
| # | Item | Why |
|---|------|-----|
| 1 | The new coding standard doc (whatever form it exists in) | This is the law the agent codes to |
| 2 | 1–2 template/skeleton projects (.ACD or .L5X) for the new standard | Structural ground truth |
| 3 | The single best real project per lead (5–10 total), exported as L5X | Reference library — "how we actually solve problems" |
| 4 | One project that's known BAD (pre-standard) with notes on what's wrong | Teaches the agent what to avoid |
| 5 | Any device AOI/UDT library files | Exact definitions, not reconstructions |
| 6 | A marked-up printout/screenshot of one R02 + R03 done perfectly, with margin notes | Highest-value single artifact for transitions |
