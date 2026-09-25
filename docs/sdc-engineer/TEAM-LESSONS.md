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

## Merged 2026-09-23
- 2026-09-23 [standard] The dial platform has no cams — "timing diagram (cam angles)" on the nine-input list is a chassis-only requirement and does not apply to a dial job; do not wait on it or flag it missing for a dial build. — Dan (job 1158 readiness)
- 2026-09-23 [standard] Skip the upfront full-plan workflow before any code exists — on 1160 it cost ~$228 across two attempts and neither survived into the real build. Go straight to incremental per-station-family builds. — Dan (confirmed on job 1158, matches BUDGET.md's own lesson)
- 2026-09-23 [standard] When a job already has a hand-built PLC project (e.g. job 1158's Studio 5000 .ACD under Electrical\Software), don't build onto it and don't ignore it: generate the station code independently from the template/examples, then use the existing file as a standards/correctness check and a learning reference for how that device type is normally set up. — Dan (job 1158)

## Merged 2026-09-23
- 2026-09-23 [standard] A .ACD file is Rockwell's proprietary binary Studio 5000 project format — cannot be opened or parsed outside Studio 5000. Only .L5X (plain XML export) is readable directly. When a job's only PLC artifact is a .ACD, ask the CE/EE to export it to L5X (File → Save As / Export, type L5X, all content) before it can be used as a reference.
- 2026-09-23 [standard] Rename the shape checker to shapeLint.cjs with a job config block instead of forking a per-job copy. — Jason

## Merged 2026-09-24
- 2026-09-24 [standard] A Fanuc robot cell's peripheral pick-conveyor servo axis is typically owned and driven by the ROBOT CONTROLLER directly, not by the plant PLC — the PLC only exchanges simple discrete handshake bits with the robot (request-conveyor-on, conveyor-run-OK, conveyor-moving feedback) via custom extensions to the robot's own UOP-style control/status UDTs. Don't model this as a Kinetix/AXIS_CIP_DRIVE axis in the PLC controller; check the robot's BOM part number (a Fanuc-brand servo, e.g. A06B-01xx, is the tell) before assuming the PLC drives it. Confirmed against job 1116's FanucRobotROUT/FanucRobotRIN UDTs (ReqConvOn/ConvRunOK bits) and job 1158's own electrical BOM (Fanuc-brand pick-conveyor servo, no PLC-side axis anywhere). — Dan / job 1158 correction
- 2026-09-24 [standard] Before modeling any device from a generic platform template, check the job's own electrical BOM/IO tab first — a company-wide parts catalog tab (e.g. "Control Parts- Field/Panel") is NOT job-specific and a hit there (e.g. Lexium/Schneider drives, an "RC+ conveyor tracking kit") does not mean that hardware is on this job; only the job's own BOM/" IO" tabs (with station/tag references) are authoritative. Confirmed on job 1158: a company-wide catalog listed Epson RC+ conveyor-tracking and Lexium drives that looked like a match but belonged to a completely different (Epson SCARA) robot cell, not this job. — Dan / job 1158 correction
- 2026-09-24 [standard] GuardLogix Safety/Standard tag direction: a Safety-class routine may freely READ a Standard-class tag, but a Standard-class routine may never WRITE a Safety-class tag without an explicit Safety Tag Mapping (a real, certified project-level construct — do not hand-invent its L5X form). If a Standard program needs to influence something in the Safety task, route it the allowed direction: have the Safety-task rung read the Standard tag directly, not the other way around. Confirmed on job 1158, a real SIL2/PLd controller (`<SafetyInfo SafetyLevel="SIL2/PLd"/>`) — I had written a Standard program's output into a Safety-class tag; Jason's real Studio 5000 import caught it (part of a 25-error batch). — Jason (job 1158, real import)
- 2026-09-24 [standard] A custom-built validator/import-simulator is a proxy for Studio 5000, not a replacement for it — "0 findings" from it is real but weaker evidence than it looks, especially for anything involving GuardLogix safety partitioning or module-specific connection typing, neither of which this job's checker models at all. Found and confirmed (by reading the checker's own source, not just inferring) a real parsing bug in it too: its tag-extraction regex requires a closing `</Tag>`, so a self-closing `<Tag .../>` causes it to silently swallow the NEXT tag's content and skip validating that next tag entirely (47 instances in job 1158's file). When a CE's real import disagrees with this tool's "clean" verdict, trust the real import; use the tool for a first pass, not the final word. — Dan / Jason (job 1158, real import found what the tool didn't)
- 2026-09-24 [standard] When the engineer names a specific reference job because it has the matching hardware ("use Molex, it has the right robot, not the standard flex feeder"), that reference is the primary vocabulary/form source for that device, not just a sequencing idea — the general rule "a reference supplies form, never vocabulary" is for a reference that predates the standard, not for one the engineer just pointed at as the real analog. Built job 1158's flex-feeder off the generic template's Fanuc-cell archetype instead (Kinetix process-conveyor axis, Lenze-VFD incline/return conveyors, none of which exist on this machine) and used the named reference only for "sequencing" — exactly backwards. — Dan (job 1158, caught by Matt/Jason's review after delivery)
- 2026-09-24 [standard] Copying an AOI (e.g. AOI_Fanuc_IN/_OUT) from a template into a new job is not safe by itself when the AOI's own parameters are hard-typed to a specific module connection SIZE (e.g. `FR:Standard_RobotPlus_24Bytes:I1:0`) — that size must match the target job's ACTUAL configured module connection (`<Module>`'s `<Connection InputSize=.../>`), not the template's. Check this before reusing any AOI whose parameter DataType names encode a byte count; when the sizes don't match, a direct `CPS` copy against the real connection (matching a proven working reference job with the same module) is safer than forcing the mismatched AOI to fit. — Jason (job 1158, real import; fixed by matching job 1116's proven CPS pattern for the identical Fanuc R30iB Plus module at the identical 20/300-byte connection size)

## Merged 2026-09-25
- 2026-09-25 [standard] A device the PLC only needs to confirm is communicating gets an AOI_EIPStatus check and no CPS in MapInputs/MapOutputs — cam01_S01FlexFeed on 1158 talks direct to the robot controller, the PLC is not involved. — Jason
- 2026-09-25 [standard] For job 1158 only, structure the Flex Feeder robot logic exactly as job 1116 Molex — 1116 and 1158 use a flex feeder style I have not taught you yet and I have not been able to develop a standard program for it. — Jason
- 2026-09-25 [standard] The 1116 robot logic I want copied for 1158 is S01_PickRobot only — it does not involve S56_WireFeed. — Jason
- 2026-09-25 [standard] D003 (1158 Flex Feeder robot follows 1116 Molex) is Approved. — Jason
- 2026-09-25 [standard] There is no tool changer on job 1158 — other than the tool changer, the 1158 robot logic matches 1116, and this is unique to 1158 at this point. — Jason
- 2026-09-25 [standard] 1116 robot sequence numbers 1 (safe home), 10 (PK main), 30 (place dial) and 35 (maintenance position) carry over to 1158 unchanged; 32 was the tool change and does not. — Jason
- 2026-09-25 [standard] Option A for 1158: keep 1158's outward parameter interface (q_ActuatorsSafe, q_Pause, q_StationComplete, q_StartOK, q_AlarmActive, q_WarningActive, q_AutoMode, q_AutoStopped, q_ReturnConveyorRun) and drive it from the 1116 internals — the dial, supervisor, alarms and safety interfaces are 1158's own. — Jason
- 2026-09-25 [standard] 1158 D01_FlexFeeder: q_Pause and q_StationComplete stay declared but are AlwaysOff placeholders until the robot/dial contract is defined; replace the 1116 HMI structure with the SDC standard structure from SoftwareStandardizationNew.L5X. — Jason
- 2026-09-25 [standard] For the 1158 robot port: strip the 1116 debug tags, wire recipe to 1158's Recipe program, and there ARE analog outputs for feeder control on 1158 with the CPS output mapping the same as 1116 — unique to 1158, outside the standard. — Jason
- 2026-09-25 [standard] Option B for 1158 recipe: extend 1158's Recipe_Structure with the robot fields rather than carrying a second recipe model. — Jason
- 2026-09-25 [standard] When you strip a term out of a rung, check what the brackets look like afterwards - a branch left with one leg or an empty leg is a Studio syntax error, and it kills every rung after it in that routine. Job 1158 v0.6: 21 import errors from 4 bad rungs. The import simulator only checked tag data, never rung syntax; it does now. — Jason’s v0.6 Studio import
- 2026-09-25 [standard] EDA.in is written once, in R05_RobotInputs, off the robot's I2 connection. The R01_Inputs copy off I1 is wrong — I1 is the 20-byte status connection, EDA.in is the 300-byte explicit-data payload. Carried over from 1116, which still has it. — Jason
- 2026-09-25 [standard] AOI_FanucRecipe belongs in R95_RobotOutputs. When removing a feature from a ported program, decide rung by rung on what the rung DOES - filtering on a tag name took three recipe/state rungs that only mentioned the end effector. — Jason
- 2026-09-25 [standard] 1158: the robot recipe number gets its own Recipe_Structure field, RobotRecipeNum. — Jason
- 2026-09-25 [standard] When a UDT that a recipe copies gains a member, i_RecipeStructureUDTSizeBytes must be recomputed from SIZE() of the type - it is a typed-in byte count, not derived, and it was already 4 bytes short in the file handed over (TerminalPosition never copied). — Jason's RobotRecipeNum request
- 2026-09-25 [standard] ROUT.ReqConvOn / ROUT.ReqFeederOn are latched bits - every writer is OTL or OTU. Never drive a latched bit with an OTE coil; it overwrites the latch every scan. — Jason's Studio verify
- 2026-09-25 [standard] A one-shot storage bit (ONS/OSR/OSF) is used by exactly one instruction in a program. Reusing it makes both misfire. — Jason's Studio verify
- 2026-09-25 [standard] Run Studio's verify checks, not just the import gate. Duplicate destructive bit references were a whole class my gates never looked at, and Jason found them by hand. — Jason's Studio verify
- 2026-09-25 [standard] Match the project, not the newest standard. This engineer wrote 1158 before the new single-step logic was released, so use the old form - D02S06_SubFlare R01_Inputs is the example. The new form does not even fit the UDT in this project. — Jason
- 2026-09-25 [standard] Before writing a member reference, check the member exists in THIS controller's copy of the type. Ported logic brings the source project's UDT shape with it. — Jason
