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

## Merged 2026-09-28
- 2026-09-28 [standard] A part verify station does not get output parameters defined. D01S12 was defined as a part verify station, and Supervisor R01_Inputs included output parameters from it that are not defined, causing compile errors. — Jason
- 2026-09-28 [standard] All output controls go in R03_StateLogic. D02S13 had a routine called R04_DeviceControl; there is no such routine. — Jason
- 2026-09-28 [standard] Force checking belongs in R03_StateLogic, not in the transitions - D01S11 rung 11. — Jason
- 2026-09-28 [standard] Leave Matt's state numbering alone on 1158, it is the project convention - D01S04 runs 4, 6, 7, 10, 13, 16, 50 with a 100/105/110/115/124 camera init block, and that stands even though the template and Rev2 use the +3 grid. — Jason

## Merged 2026-09-28
- 2026-09-28 [standard] D01S12 is a Keyence GT2 air probe station: one solenoid, coil on extends, coil off retracts. ETHERNET-MODULE io3_KeyenceProbe at 10.11.58.32, Data-INT, input instance 100 size 84, output instance 101 size 5, config instance 1 size 0, io3_KeyenceProbe_IN typed KeyenceProbe_Inputs. States 4 wait index, 7 extend, 10 check value, 13 retract, 50 complete; both probe positions verified with AOI_RangeCheck; pass/fail is an HMI low/high window; initialized means retracted and it must be verified retracted to allow an index. — Jason
- 2026-09-28 [standard] A station with a state machine is a full station and declares q_AutoMode, q_AutoStopped and q_StartOK - only a part verify station goes without them. Changing a station's type means changing what the Supervisor polls. — Jason's D01S12 change
- 2026-09-28 [standard] The probe input parameter is DINT, connected straight to io3_KeyenceProbe_IN.Curnt_Val_0_ID1, and the divisor is 10000 to convert the raw count to mm. Scale inside the station, not in MapInputs. — Jason

## Merged 2026-09-28
- 2026-09-28 [standard] 1158 a03_Press is a 10mm screw - fix the ActuatorLead to 10.0, the ConversionConstant of 10000 is right. — Jason
- 2026-09-28 [standard] AOI_RangeCheck deadbands are literal constants in the call - 1.0 tight and 5.0 wide on the probe, 0.5 and 5 on the servo axes. Do not invent an HMI tolerance setpoint for them. — Jason's corrected export
- 2026-09-28 [standard] R01_Inputs drives four framework bits off Station[StaNum].OpStatus in this order: Lockout, Bypass, DryRun, SingleStep. Bypass was missing from my D01S12. — Jason's corrected export
- 2026-09-28 [standard] Bypass forces a pass: it is a parallel leg on the success rung and XIO(Bypass) in series on the failure rung. — Jason's corrected export
- 2026-09-28 [standard] Use the wide window to confirm an actuator reached position - ProbeExtended.InPosWide, not .InPos. — Jason's corrected export
- 2026-09-28 [standard] ConsecFails is the ConsecFails UDT, not a COUNTER: ADD(ConsecFails.Count,1,ConsecFails.Count) to increment, MOVE(0,ConsecFails.Count) to reset, GE(ConsecFails.Count,ConsecFails.Setpoint) to alarm, and the alarm rung resets the count. — Jason's corrected export
- 2026-09-28 [standard] FailureType is the station number then the dial number - station 12 on dial 1 is 121, not 112. — Jason's corrected export
- 2026-09-28 [standard] A CPS length counts DESTINATION elements. Copying a module's input into one UDT buffer is length 1, not the number of source words. — Jason's corrected export
- 2026-09-28 [standard] The Keyence probe is read only - it gets a CPS in MapInputs and none in MapOutputs. — Jason's corrected export
- 2026-09-28 [standard] On GuardLogix a Safety program reads only Safety-class tags. A Standard program writes a Standard 'Req' tag (q_RunReturnConvReq) and the safety tag mapping carries it to the Safety tag the Safety program reads. Safety reading Standard directly is NOT allowed - my 1158 v0.5 note said it was, and that was wrong. — Jason's corrected export
- 2026-09-28 [standard] An AOI call needs its backing tag declared in the same program - D02S01_PlasticLoad called StationPerformance with no StationPerformance tag. — Jason's corrected export
- 2026-09-28 [standard] Interlocks go in series with the trigger, not in a parallel branch leg - the R70 maintenance-position rung had the two AtRefPosn interlocks in one leg and the trigger in the other, so they gated nothing. — Jason's corrected export
- 2026-09-28 [standard] R03_StateLogic rung order: status to supervisor, actuators safe, part tracking and lockout, station complete, sample the measurement, judge it pass/fail, device control, station performance last. The judgement goes BEFORE the device control rungs - I appended mine after station performance. — Jason's corrected export
- 2026-09-28 [standard] A read-only device gets no output buffer tag at all, not just no CPS - io3_KeyenceProbe_OUT deleted. — Jason's corrected export

## Merged 2026-09-28
- 2026-09-28 [standard] The camera CPS length was wrong too - CPS(cam02_S04InspectLocation:I.Data[0],cam02_S04InspectLocation_IN,1), not 496. The destination is one VS_I. — Jason's corrected export
- 2026-09-28 [standard] On 1158 StationPerformance is the last rung of R03_StateLogic - moved to last in D01S11 and D02S13. Job 1160 puts it two or three rungs from the end, so this is the project's convention, not a universal rule. — Jason's corrected export

## Merged 2026-09-28
- 2026-09-28 [standard] D004 and D005 are Approved as RULES, not machine deviations - a lesson about choosing or reusing a reference belongs in the knowledge, and tagging a rule as a deviation puts it in the grid as Open where it reads like a blocker. — Jason

## Merged 2026-09-29
- 2026-09-28 [standard] 1131 Tarkett is not a dial project — do not base it on the dial project file (SoftwareStandardizationNew.L5X); it is a standalone, non-indexed machine. — Dan (job 1131, correcting the SDC Engineer's D003 platform proposal)
- 2026-09-28 [standard] Do not use a reference file that old for a build — the Jan-29 L5X under 1131 Software\PLCeference is a stale generic SoftwareStandardization export saved under the job name, not the machine; the current code is the L5X the CE exports on request (Tarkett_Tile_Grinder_092826.L5X). Check TargetName and the export date before treating any L5X as the job's code. — Dan (job 1131)
- 2026-09-28 [standard] Also look at the .pdf assembly files — they are in <job> Mechanical\<job> SW Files\<job>-X-000.pdf on every job, and the current code is the L5X the CE exports; both should already be in memory, we talk about them every time. — Dan (job 1131)
- 2026-09-28 [standard] A STRING L5K literal may carry stale bytes past LEN — Studio reads only LEN chars (SoftwareStandardizationNew.L5X Recipe saved STRING30 slots import with junk after LEN=1); only a LEN longer than the content is a defect. Validator relaxed accordingly. — SDC Engineer (job 1131, verified against the import-proven template)
- 2026-09-28 [standard] ParameterConnection endpoints may name a module connection directly (fd01_InfeedBelt:I <-> \S04.i_Belt whole connection) or a rack-optimized Point I/O bit (io01_InfeedPointIO:5:I.0) — both import (John Stanko's 1131 file); assembler and validator now resolve both forms against <Modules>. — SDC Engineer (job 1131)
- 2026-09-28 [standard] Two consecutive move states on the same axis, both in the MAM auto state list, leave the MAM rung true so the second move never edge-triggers; every move state needs a wait/confirm state not in the list before the next move on that axis (S05_ServoPNP form). Caught by the validator on 1131 S07 43->79. — SDC Engineer (job 1131)
- 2026-09-29 [standard] Keep the same servo points the machine already runs on (John's commissioned positions are the initial values), and every pick-and-place must use the new servo motion standard - Jason's updated Servo PNP master with blended moves (MCD speed transitions, corner rounding on InPosWide). The motion in the current 1131 code is not very good; the new build must fix that. — Dan (job 1131)
- 2026-09-29 [standard] A speed-transition position initialised to 0 makes the MCD slow-down / speed-up states unreachable (the wide band around 0 is never entered) — a transition height must be computed from its target (target minus 50 mm, S07 form) or carry a real initial value; caught on 1131 S03 by reading the built rungs, not by any gate. — SDC Engineer (job 1131)
- 2026-09-29 [standard] For all new projects, add a Sequence of Operation document as a deliverable - one table per state machine, every state, what happens in it and what moves it on, read out of the L5X. Added to the playbook as step 5b alongside the cover note. — Jason
- 2026-09-29 [standard] Word's filtered-HTML export declares charset=unicode (UTF-16). Saving the edited copy as UTF-8 without changing that declaration turns every en dash and curly quote in the whole document into mojibake, including text you never touched - set charset=utf-8 before converting back, and check the .docx text for the mojibake sequence afterwards. — me, editing the 1131 cover note
- 2026-09-29 [standard] Approve D006, D007 and D010 - the standalone non-indexed platform, the two safety programs and the two Supervisor / Alarms / HMI sets. All three follow from the same fact: two machines are controlled by one PLC. — Jason

## Merged 2026-09-29
- 2026-09-29 [standard] Job 1131 is two independent halves - a loader and an unloader, each with its own Supervisor, Alarms and HMI. This is a requirement of the machine, not an artifact of John's code; merging them into one in v0.1 was wrong. Logged as D010. — Jason
- 2026-09-29 [standard] The two supervisor / alarm / HMI is not our standard, but was a requirement for this project as two machines are being controlled by one PLC. That is the reason on D010, not a second deviation. — Jason
- 2026-09-29 [standard] D008 (Communications MSG stub) and D009 (blue stack light) are both outliers for this project, and I do not want them recorded - removed from the grid. A departure from the rule that rows are never deleted, but a decision about the grid, not a machine deviation, so it opens no row. — Jason

## Merged 2026-09-29
- 2026-09-29 [standard] A [deviation] tag in a lessons line is an instruction to the merge to OPEN A GRID ROW. When the deviation is already logged with logDeviation.cjs, write the lesson as [standard] and cite the ID - otherwise it double-logs. Opened three spurious rows today; the merge now redirects a [deviation] line that names an existing ID, and flags a new row that restates one. — me, after the merge opened D011-D013
- 2026-09-29 [standard] The cover note and sequence of operation documents are combined. From the cover note, Revision history, What I was given, and Machine sections stay - those are always first. Then start the Sequence Of Operation section. One document per job. — Jason
- 2026-09-29 [standard] I like it, thanks - the Devices cell as a table inside the cell, Device | Part | Purpose, one device per row, on every station. Keep it as the form. — Jason
- 2026-09-29 [standard] R15_EIPMonitor in each supervisor must only contain alarms for devices controlled on respective machine section. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] i_CycleStart, i_CycleStop, and i_AirPressureOK must be handled as shown in SoftwareStandardizationNew.L5X. Local tags were created which are not needed. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] There must be no control references to muting in the MainTask. Muting is a safety function that is controlled in the SafetyTask. Muting status could be used in MainTask if required. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] Why did you define an AOI for the infeed stack height laser and not the outfeed lasers? The laser I/O should be mapped the same way it was done in Justin's project. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] Safety program - only the PNP axes get a category 1 stop. Remaining axes are category 0. SUPERSEDED the same day: leave the safety programs as Justin Stanko had them (carts and camera axis cat 1, belt cat 0) - no change made. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] Were Justin's vision calculations changed in your version? Those must remain the same for both infeed and outfeed. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] Corner rounding is not needed in a state machine controlling a single servo axis, for example S02_InfeedVision. Rounding is only used to blend the motions of two or more servos together on the same station. — Jason, 1131 v0.4 review
- 2026-09-29 [standard] The commissioned 1131 code is Justin Stanko's, not John Stanko's - the cover note had the wrong first name from the BAK file names. — Jason
- 2026-09-29 [standard] EIP split per supervisor confirmed: loader sd01 sd02 sd06 sd08 vb01 vb04 cam01 fd01 io01, unloader sd03 sd04 sd05 sd07 vb02 vb03 vb05 cam02. — Jason
- 2026-09-29 [standard] Air pressure OK must be in the Supervisor StartOK string. Logged as D011 - the template Supervisor has no air-pressure input at all. Built in v0.5. — Jason
- 2026-09-29 [standard] Safety programs: leave as before, since that is the way Justin had it - the build does not touch them (D007 stands). — Jason
- 2026-09-29 [standard] There is an invalid expressions error on R06_ConveyorTracking rung 11. Please fix. — Jason, 1131 v0.5 Studio import
- 2026-09-29 [standard] Error: SafetyTask: Safety mapped tag "g_MuteInfeedLightcurtains" does not exist or is invalid. — Jason, 1131 v0.5 Studio import
- 2026-09-29 [standard] Errors are confirmed resolved - 1131 v0.5.1 imports clean in Studio after the R06 rung 11 expression and the SafetyTagMap fixes. — Jason

## Merged 2026-09-29
- 2026-09-29 [standard] Approve D011 and D012 - air pressure in the Supervisor StartOK string, and Justin's PNP XZ permissive networks kept as he developed them. — Jason
