SDC Automation
Questions for Controls Engineering Leads
Purpose: gather what an AI agent needs to generate good, solid, reliable SDC PLC code.
Meeting output = answers to these questions + the documents listed on the last page.
# 1. What is “good SDC code”? (acceptance criteria)
1. If you opened a program from another SDC engineer, what would make you say “this is done right” in the first 5 minutes? List the tells.
- Follows SDC standard program structure
- Follows SDC standard naming convention
- Programs broken down by station with appropriate numbering scheme
- Proper organization (inputs in inputs routine, state sequence transitions in state transitions, outputs in outputs routine, ect.)
- Descriptive comments
- Easy to follow logic
- Only one state transition per rung
- Move to states only in one rung.  Example, multiple parallel paths to state 4 on one rung.
- Program free of errors, no compile errors.
2. What are the top 5 things the current generated code gets WRONG that a competent engineer would never do?
- Moves to the same state in multiple rungs
- Digital outputs and/or servo moves triggered in incorrect states
- Many out of order states with complicated logic.
- Improper interpretation of decision states from state logic builder GUI
- Unable to handle state assignments beyond state 99 (active sequence states are 4-99)
3. Who is the authority when engineers disagree on style — is there one person whose code is the gold standard? Which project of theirs is the single best example?
- SDC standard template is gold standard
4. What is the acceptance test? (“Imports clean into Studio 5000” is not enough — what makes you trust it enough to run on a machine?)
- Engineering audit of each line of code
# 2. State transitions (worst area today)
5. Walk through one perfect transition rung, instruction by instruction: what conditions are ANDed, in what order, and why?
- There is no perfect transistion rung, each one is unique to station requirements.
6. What are ALL the transition condition types you actually use? (sensor made, timer done, servo in position, vision result, signal from another station, operator input, part-tracking state…)
- All of the above are valid, plus anything else that is necessary.  Highly dependent on station devices.
7. When a state has multiple exits (pass/fail, branch), how exactly is that structured in R02 — one rung per exit? Priority order?
- Only one state transition per rung.  Multiple paths out of the same state require a separate rung or branch to each one of those states.
8. How do timers work in transitions — where does the timer live, what starts it, what resets it? Show the standard pattern.
- State logic AOI has built in state timer that can be used for state transitions.
- Other specific conditions may require a new timer to be defined.
- Most common timer is TON which does not require a reset.
9. Backward jumps / retries — what does a “go back to step N” transition look like, and what has to be cleaned up when it fires?
- Retry requires a counter.  When attempt maximum is reached sequence will move into necessary state.
- Go back to previous step looks like a standard state transition.  For example, if in state 20 and counter maximum has not been reached and check failed then go to beginning of sequence and retry.
10. Anti-patterns: show 2–3 real examples of transition code done WRONG (old projects are fine) and explain why it is wrong.

Above does not follow SDC standard due to multiple paths out of same state on same rung.

Above does not follow SDC standard due to paths to same state on different rungs.
# 3. Devices — servo vs pneumatic vs everything else
11. For each device type (pneumatic cylinder, gripper, servo axis, digital sensor, analog sensor, vision, robot, indexer/escapement): what code MUST exist when that device is on a machine? (tags, R01 rungs, state logic, faults, HMI)
- Pneumatic cylinder – see S01_PartLoad, XAxis has two sensors, ZAxis has one sensor
- Gripper – see S01_PartLoad and cross reference q_OpenGripper and q_CloseGripper
- Servo axis – see S05_ServoPNP, iq_XAxis
12. Servo moves: walk through one complete servo move state — what is in R03, what is in R02, how “in position” is confirmed, and what the servo routine (R04/R05) handles vs. what the state logic handles.
- For a servo axis, in most cases, state transitions in R02 will consist of the AxisName_MAM.PC bit AND .InPos bit from AOI_RangeCheck.  In other cases, a parallel branch is used for rounding moves.  MAM instruction is triggered in move state(s) from R02.
- R03 contains no control of servos.
- R04/R05 contain the motion instructions for controlling individual axes
13. Pneumatics: what is different between a 2-sensor cylinder, a 1-sensor cylinder, and a no-sensor (timer-only) cylinder in the generated code?
- 2 sensor cylinder – see S01_PartLoad, XAxis
- 1 sensor cylinder – see S01_PartLoad, ZAxis
- No-sensor cylinder – see S01_PartLoad, Gripper
14. How does the code know a device is “safe to move”? Where do interlocks/permissives live and how are they named?
- Permissives are added as needed for device protection.  This is based upon the physical construction of the station, speeds, ect.
- See S05_Servo PNP / R04_XaxisServo rung 2 as a permissive example.
15. Mixed states: when one state fires a servo move AND a pneumatic action, how is completion of the state determined?
- When both the servo AND pneumatic action have reached their end positions.  Servo end position is .PC bit and InPos from Range Check AOI.  Pneumatic action will be confirmed by sensor feedback, if present, and cylinder output state.
# 4. Faults & alarms
16. What faults are mandatory per device type, and what is the standard fault timeout for each?
- Fault timeouts are dependent on station requirements and motion profiles of pneumatic cylinders/servos.
- For pneumatic cylinders, faults are based upon quantity of sensors.
- For servos, axis fault and loss of absolute position reference are mandatory, along with “waiting to reach commanded position” faults.
17. What happens on fault — does the sequence hold in state, jump to a fault state, or lock out? What is the standard recovery path?
- State machine goes into state 127.
- No standard recovery path, completely dependendent on machine/station conditions.
18. ProgramAlarmHandler: exactly what gets wired in, and what does the engineer configure vs. what should be generated?

Above is standard configuration of ProgramAlarmHandler
5. Modes & HMI
19. Beyond Lockout / DryRun / Single-Step: what other modes exist (manual, home, purge, empty-out)? What code does each require?
- Additional machine modes are defined in the Supervisor program
20. Manual mode: is there a standard manual-control pattern per device the generator should emit, or is manual always hand-written?
- Manual control of servos is defined in S05_ServoPNP, R04 and R05.

Above is an example of how a pneumatic cylinder is controlled when Status.State[1] is on, which is manual mode.
21. Homing: what is the standard homing sequence logic for a station with servos, and does it belong in generated init states (100–127) or elsewhere?
- Homing is controlled in R04/R05 rungs 9-11.  This is different from intialization, which is controlled in states 100-124.
# 6. Structure & naming edge cases
22. Where does the current tag-naming standard NOT cover a case, forcing engineers to improvise? List the improvisations.
- Should not happen, easy to conform to naming standards
23. Cross-station communication: what is the exact standard for handshake tags between stations (who owns the tag, naming, set/clear responsibility)?
- Using input/public/output parameters
- Some are connections and some are direct references
24. Part tracking: what should generated code write to PartTracking and when — and what stays engineer-authored?
- Revisit at later date
25. What belongs in R01_Inputs beyond debounce/decode — any per-project conditioning the agent should ask about?
- The inputs routine handles standard sensor debounces and input formatting, along with logic used for decision making for state sequence.
# 7. Judgment calls (where the agent must think, not follow rules)
26. Give 3 examples where two SDC-standard-compliant ways exist to code something and the engineer chose based on context. What drove the choice?
- One instance would be station recovery logic after an emergency stop.  There are a number of ways to recover properly.  The engineer must think through best approach for machine conditions, robust operation, and simplicty of code structure.
27. When old reference code conflicts with the new standard, are there any cases where the OLD way should still win?
- No
28. What should the agent ASK the engineer before generating, vs. decide on its own? Where is the line?
- This will be defined as the code generator evolves.
# 8. Per-sequence questions (draft — the agent asks these before every generation)
Validate or edit this list — is this what you would want to be asked before code is generated for a new station?
- Station type and what it physically does, in one sentence per state?  ME will define when building state sequence.  Consider adding text boxes to state logic builder GUI for more advanced descriptions of state operation.
- Full device list with types, and which sensors each device actually has?  Should be output from state logic builder.
- For each transition: what condition, and what is the fault timeout?  Should be output from state logic builder.  Fault timeout is highly dependent on device.
- Any cross-station signals in or out?  This is a good question to ask.
- Part tracking pass/fail write points?  Revisit part tracking integration at a later date.
- Anything nonstandard about this machine that the standard does not cover?  This is a good question to ask.

# Documents to collect at the meeting
| # | Item | Why |
|---|---|---|
| 1 | The new coding standard document (whatever form it exists in) | This is the law the agent codes to |
| 2 | 1–2 template / skeleton projects (.ACD or .L5X) for the new standard | Structural ground truth |
| 3 | The single best real project per lead (5–10 total), exported as L5X | Reference library — "how we actually solve problems" |
| 4 | One project that is known BAD (pre-standard) with notes on what is wrong | Teaches the agent what to avoid |
| 5 | Any device AOI / UDT library files | Exact definitions, not reconstructions |
| 6 | A marked-up printout of one perfect R02 + R03 with margin notes | Highest-value single artifact for state transitions |
