# Team lessons — what the team has taught the SDC Engineer

One line per lesson, dated, in the engineer's words, with who said it. Merged daily from `Lessons\<user>.md`. General rules that hold move into PLAYBOOK.md.

## Seed — job 1160, September 2026
- 2026-09-01 Part tracking is not used for escapements; an escapement does not interface with the indexer. — Jason
- 2026-09-01 One rung cannot serve two states. — Jason
- 2026-09-01 The AlwaysOff bit on a rung is the placeholder that tells an engineer the condition must be replaced when known. — Jason
- 2026-09-03 FailureType = station number × 10 + failure reason (1–9). — Jason
- 2026-09-09 Lockout and single step are per station only; scope follows ownership. — Jason
- 2026-09-10 Success is set from physical evidence the part transferred, never from program completion. — Jason
- 2026-09-14 An input parameter marked constant means "you must decide this". — Jason
- 2026-09-16 Review scope is SDC standards and the right devices only; engineers judge correctness. — Dan
- 2026-09-17 Two-up chassis: one program per nest side, A = left, B = right; a shared mechanism is one program. — Jason
- 2026-09-17 R02_StateTransitions holds transitions only. — Jason
- 2026-09-17 Index permissive is built from clearance per axis, OR'd; X retracted is away from the indexer. — Jason
- 2026-09-18 Rung comments one sentence; tag descriptions 30 characters; no single step or auto idle on chassis stations; MapInputs first; feeders on/off only. — Jason
- 2026-09-18 Heater control: no state machine; PID in a 1-second periodic task; read the IY4 directly, no scaling. — Jason
- 2026-09-18 Same look and feel as the examples on every station; never invent a form the examples lack. — Dan
- 2026-09-18 Decide like a controls engineer; record assumptions; ask only what cannot be known, naming who answers. — Dan
- 2026-09-18 One HeatControl program in the periodic task (setpoints, then one PID rung per loop); station heat logic in MainTask. Limit is spelled LIMIT in v37. — Jason
- 2026-09-19 Fewest words everywhere: documents, comments, chat. — Dan
- 2026-09-19 Ratings change only when code changes; standard conformance is 10 or a named deviation with a question. — Dan
- 2026-09-19 The cover note is one document: revision history, inputs received, station blocks with numbered sequence; nobody edits it, fix the code. — Dan
- 2026-09-19 The standard inputs are nine SDC documents: transcript, ballooned assembly drawings, station description sheet, controls BOM, I/O list, pneumatic drawings, timing diagram, example per station, Ethernet device list. — Dan

## Merged 2026-09-22
- 2026-09-21 [standard] Studio 5000 v37 compare set is EQ NE LT GT LE GE LIMIT MEQ CMP and MOVE; the PLC-5 forms EQU NEQ LES GRT LEQ GEQ LIM MOV do not import (LIM failed the 1160 v1.4 import). Jason_return_0918 (OV_PID, HeaterControl_SUB) is a rung-form reference only, not vocabulary. — Jason (repo commit 1539f0c, shapeLint legacy-mnemonic rule)
- 2026-09-21 [standard] Don't ask me to do what you can decide and derive yourself — the corpus rebuilds from the examples. — Jason
- 2026-09-21 [standard] What I send the builder goes in Examples\<job> Examples\ — the IV4 and heater control logic I sent Dan via Teams is in Examples\1160 Examples. — Jason
- 2026-09-21 [standard] The correct vocabulary for Comparison instructions is CMP, LIMIT, MEQ, EQ, NE, LT, GT, LE, GE. — Jason
- 2026-09-21 [standard] MOVE is correct. — Jason
- 2026-09-21 [standard] The heater exports are from a previous SDC project NOT done using our new standards — included as an example; generated code must use our standard. — Jason


- 2026-09-22 [standard] All programs containing state machines in a SDC Chassis project must have output parameters q_StartOK, q_AutoMode and q_AutoStopped in R03_StateLogic as defined in SoftwareStandardization.L5X, referenced in Supervisor R01_Inputs. — Jason
- 2026-09-22 [standard] In Supervisor R20_Alarms the backing tags for AOI_EIPStatus should be local tags, not public parameters. — Jason
- 2026-09-22 [standard] Heater SSR outputs use AOI_HeatControl for time proportional output; the PID output feeds it as PowerIn scaled in percent. — Jason
- 2026-09-22 [standard] The master is a template — different applications use the same base servo code, but motor catalog numbers and conversion constants are set per application. — Jason
- 2026-09-22 [standard] Conversion constant is 5000.0 for a servo application direct coupled to a 5 mm ball screw, scaled in mm. — Jason
- 2026-09-22 [standard] AOI_HeatControl defaults are CycleTime 1.0 and MaxPowerPercent 100.0; the engineer changes them if needed per application. — Jason
- 2026-09-22 [standard] Job 1160 Z-axis motor is TLP-A046-010-Dxxx4x — the database form; the orderable number TLP-A046-010-DJA14S and uppercase DXXX4X both import as "motor invalid". — Jason
- 2026-09-22 [standard] AOI backing tags may carry a data block — 82 in the template do. Copy the shape from an example instance of that AOI, or declare the tag alone; never synthesise the L5K image. — Jason (measured on the 1160 build)
- 2026-09-22 [standard] Motor catalog numbers in an axis tag are the Studio database form, not the orderable part number — VPL drops the option suffix (VPL-A1003E-P, not VPL-A1003E-PJ12AA) and TLP carries lowercase option wildcards (TLP-A070-040-Dxxx2x). — Jason's template, confirmed against the 1160 BOM
- 2026-09-22 [standard] Ball screw pitch is set by ActuatorLead on the axis, not by ConversionConstant — with ScalingSource "From Calculator" Studio derives the conversion constant from the lead and overwrites whatever the file carries. — Jason (1160 v1.6.2 import)
- 2026-09-22 [standard] Scaling confirmed on v1.6.3 — actuator lead 5 mm/rev gives the right conversion constant on both Z axes. — Jason
- 2026-09-22 [standard] IY4 analog channel types set to RTD is correct. — Jason
- 2026-09-22 [standard] Mark ordered the exhaust centre valves, so the S05 gripper vent step stands as built. — Jason
- 2026-09-22 [standard] No spindle running after a stop. — Jason

## Merged 2026-09-22

## Merged 2026-09-23
- 2026-09-23 [standard] Single step is used on the dial platform only, not on the cam chassis. — Jason
- 2026-09-23 [standard] The Chassis_CamPos_Check AOI is only used on Chassis jobs; it was left in the SoftwareStandardization project by mistake. — Jason
- 2026-09-23 [standard] The project file wins; Examples is for programs not in it. — Jason
- 2026-09-23 [standard] The chassis template stays separate, it is its own platform standard. — Jason
- 2026-09-23 [standard] The old SoftwareStandardization.L5X is retired; SoftwareStandardizationNew.L5X replaces it. — Jason
- 2026-09-23 [standard] If MidBaseLoad's logic is the current basis for escapements, I do not want to change that architecture. — Jason
- 2026-09-23 [standard] There are 3 main SDC platforms: Chassis 1UP, Chassis 2UP (job 1160) and the indexing dial platform in SoftwareStandardizationNew. — Jason
- 2026-09-23 [standard] Re-saved SoftwareStandardizationNew.L5X without the Chassis_CamPos AOI, so it is correct now. — Jason

## Merged 2026-09-23
- 2026-09-23 [standard] The two S14 drop sensors connect to 1700MOD channels 2 and 3. — Jason
- 2026-09-23 [standard] SafetyProgram R03_Outputs rungs 1-8 are correct; rungs 9 and 10 are not needed, points 3 and 4 are not used in this control system. — Jason
- 2026-09-23 [standard] Our standard is 3 consecutive failures at a station stops the machine (fault), not 3 consecutive rejects unloaded; S15's three-reject stop was a customer request for this machine. — Jason
- 2026-09-23 [standard] Dan and I both have the authority to make decisions — either of us can set deviation Status in the grid. — Jason
- 2026-09-23 [standard] D001 (CROUT monitored safety outputs) and D002 (S15 three consecutive unload rejects) are both Approved. — Jason
