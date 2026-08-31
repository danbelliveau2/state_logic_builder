# Robot Programming — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)


## Fanuc TP Program Conventions (SDC Standard) (2026-08-29)

## Scope
Covers SDC's conventions for Fanuc TP (.LS) programs — a separate domain from PLC ladder logic, used for robot cells (pick/place, flex-feed, assembly). New concept file; no PLC concept overlaps it.

## Program structure (every program)
- First lines: `UTOOL_NUM=1`, `UFRAME_NUM=1`, `PR[4]=PR[5]` (copy Zero PR into a working Temp Offset PR).
- Every major section gets a `!` remark line.
- Blank program line between motion instructions.

## Standard registers
- PR[5]=Zero (reference), PR[4]=Temp Offset (working, copied from PR[5] at init).
- PR[14]-PR[20] = motion PRs for station subs: PR[14]=shared clear/home, then pairs per station (PR[15]/16 = station 1 approach/work, PR[17]/18 = station 2, ...) up to PR[20]. Motion PRs must never collide between stations in a job.
- R[1] = fault/abort register (non-zero → JMP LBL[999]).
- LBL[1]/[2] = master loop top/terminate; LBL[900] = program-done/cleanup (subs); LBL[999] = fault-abort entry (placed after ABORT, reachable only via JMP); LBL[100],[200],... = one unique handshake-poll loop per handshake.

## Master-loop architecture
Top-level program is command-driven: PLC writes a command number into R[50] (EtherNet/IP EDA), the loop dispatches to the matching sub via `IF (R[50]=n), CALL <sub>`, waits `WAIT(R[60]<>R[50])` for the sub's ack, resets, loops. Holds no station work itself. Terminates at LBL[2] with no ABORT/fault label in the main.

## Subprogram architecture (station subs)
Init → move to clear (PR[14], fast/blended) → approach → work position (fine, touch-up offsets here) → grip/release → handshake poll (LBL[100]-style with R[1] abort check) → retract → set ack `R[60]=R[50]` → RETURN via LBL[900]/[999].

## Critical control-flow rule
A subprogram CALLed by the looping master must RETURN, never ABORT — ABORT clears the entire task stack and kills the master loop too. ABORT is reserved for top-level programs meant to actually stop.

## Compile-safe syntax rules (real MakeTP failure lessons — default posture)
1. No bracket comments on register/IO references (`PR[14:Epoxy Clear]` fails unless the controller's registered comment matches exactly) — use bare indices (`PR[14]`) and put descriptive text on the REMARK line above.
2. No Flag (F[]) instructions — the Mark option isn't always enabled; use numeric registers (R[1] as the fault register) instead.
3. No parenthesized compound WAIT (Mixed Logic option) — use a polling loop with a unique LBL per handshake instead.
4. Use `ABORT ;`, never bare `END ;` (invalid) or `CALL END ;` (depends on an END.TP existing in the cell).
Only use Mixed Logic / bracket comments / Line Tracking / Flags when the target controller is confirmed to have those options — the showroom reference cell does, hand-written/regenerated subs by default should not assume it.

## Job generation pattern
New job = standard folder: IO template (pick-place or flex-feeder variant), eipcfg.xml (copied verbatim, no per-cell edits needed — no IP addresses in it), MAIN_<job#>.LS (standard master loop, only dispatch CALLs change), station subs (compile-safe skeleton + job-specific interlocks), and a job sheet (command map, PRs to teach, deploy checklist). Program names take the job number as a SUFFIX only (must start with a letter) — e.g. `PICK_1210`, never `1210_PICK`.

## Typical motion speeds
Clear moves: 2000mm/sec CNT50 (fast, blended). Work positions: 500mm/sec FINE. Fine adjacent work: 250mm/sec FINE.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## Standard tray-to-dial single-arm job template (Job 1210 pattern) (2026-08-29)

SDC's standard single-arm pick-and-place robot job (seen in Job 1210, tray-to-dial) follows a fixed shape worth reusing as the reference pattern for similar cells:

**PLC/robot command protocol**: the PLC writes a command code into a shared register (e.g. R[50]) over EtherNet/IP; the robot's MAIN loop dispatches on that value to CALL the matching subroutine (1=pick, 2=place, 100=safehome — codes are job-specific but the pattern is fixed). Each sub, on completion, copies the command value into an ack register (R[60]). The PLC's wait condition is simply `R[60] <> R[50]` — clears the instant the robot echoes the command back. This is the standard robot-handshake shape; expect it on every robot-integrated station, not just this one.

**Position register layout convention**: 
- One register holds an all-zero reference (Zero PR), and a second is a working temp-offset register seeded from the zero PR at init — this pair exists so offset math elsewhere never mutates the true zero.
- One shared clear/home position register is used by every subroutine needing a safe travel point.
- Each station move gets an *approach* register and a *position* register as a pair (approach a fixed clearance short of the taught point, position the actual taught point) — pick and place each get their own approach/position pair.

**Handshake register/IO set** (standard, expect these names/roles on robot cells): an override register (EDA-style bypass), a station handshake pulse output, an ok-to-place input, a cycle-stop input, and a station-fault input that the robot maps into a fault register the PLC can read.

**Grip control**: grip/ungrip are their own callable subroutines wrapping dedicated output bits — never inlined raw DO toggles in the pick/place logic. Keeps grip timing/sequencing centralized and reusable across subs.

**Deploy order**: EtherNet/IP config (with the cell's live IP) loads first, then the IO map (built from the cell's IO template, station-specific tag fill), then the LS programs (which auto-compile to .TP on load), then the position registers get taught by hand, then UTOOL/UFRAME are verified, then each subroutine is dry-run at low speed with grip/handshake confirmation before full-speed operation. This order — config, IO, programs, teach, verify frames, dry-run — is the standard robot commissioning sequence and generalizes beyond this job.

_Source: JOB_1210.md (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## SDC Robot Job Scaffolding Standard (FANUC TP) (2026-08-29)

SDC standardizes robot (FANUC-style TP) job setup the same way it standardizes PLC stations — a generated skeleton the CE/ME refines, never hand-built from scratch.

**Generated folder contents per job** (`Jobs/<job#> <title>/`):
- `IO_Template_<job#>.xlsx` — standard I/O template, chosen by job type (pick-and-place vs flex-feeder)
- `eipcfg.xml` — standard single-arm EtherNet/IP config, loaded as-is unless the cell deviates
- `MAIN_<job#>.LS` — standard master loop; only the command dispatch (R[2]) changes per job
- Station subs, e.g. `PICK_<job#>.LS`, `PLACE_<job#>.LS` — compile-safe, tailored logic
- `JOB_<job#>.md` — job sheet: command map, PRs to teach, deploy checklist

**Naming convention:** job-number suffix on every file (`MAIN_1210`, `PICK_1210`, `PLACE_1210`) — same station-prefix discipline SDC uses in PLC tag/routine naming.

**Subroutine skeleton (law, not a suggestion):** init → clear PR[14] → approach → work → grip/handshake → retract → LBL[900]/[999]. Every station sub fits this shape; safe logic for the specific job description is filled inside it, not around it.

**Motion PR allocation (collision-avoidance scheme):** PR[14] is the shared clear/home register used by every station. Station-specific position registers are then allocated in pairs, sequentially: first station gets PR[15]/[16], second station PR[17]/[18], and so on. This mirrors the PLC-side discipline of giving every axis its own tag namespace — never reuse a station's PR pair for another station.

**Generate-then-refine flow:** a generator script (`_job_generator.py <job#> "<title>" <pick_medium> <place_medium> [pick_place|flex_feeder]`) produces the boilerplate (folder, I/O copy, eipcfg copy, MAIN, standard pick/place subs). The CE/Claude then refines the station subroutines for the job's actual mechanics — the boilerplate is a starting scaffold, not a final deliverable, exactly like the PLC compile-then-review flow.

_Source: README.md (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## FANUC iRPickTool line tracking (vision-guided conveyor pick) (2026-08-29)

For FANUC robots doing conveyor line-tracking with vision (iRPickTool / iRVision), several mechanisms are vendor-standard and worth knowing when specifying or reviewing a station that mixes a FANUC robot with SDC's PLC-driven conveyor:

- **Pulsecoder is required hardware**: line tracking needs a physical encoder on the conveyor wired into the robot controller (mini/wide-mini interface board or main board), configured with an Encoder Number and a moving-average smoothing setting (`Average (updates)`, typically 10) so robot motion stays smooth if the conveyor stops suddenly. This is a hardware/wiring dependency the ME must plan for, not a pure software setting.
- **Tracking frame/area is geometric, defined once**: measured via two calibration-grid points (upstream and downstream boundary) plus a recorded Z height, then auto-calculated into a tracking frame + conveyor object. Analogous to SDC's servo position tables — it's a one-time mechanical-calibration prerequisite, not a per-cycle decision.
- **Vision offset, not re-teaching**: the pick position is a single taught nominal position (position register) offset at runtime by a vision-found VOFFSET register — the vision system supplies an offset per detected part, it does not re-teach the whole position.
- **Payload switches at pick/place, same idea as gripper mass comp**: two payload profiles (hand-only vs hand+workpiece) are swapped via PAYLOAD[n] immediately after grip/release, affecting motion performance (accel/speed) same-cycle.
- **Queue-based station handoff**: conveyor and fixed-station parts are tracked through a queue abstraction (station ID + GETQUE/ACKQUE calls), not direct polling — FANUC's version of a station-to-station handoff/interlock.
- **`Continue track at prog end` must be TRUE** for any program that hands off between pick/place subroutines in a tracking loop — leaving it FALSE breaks tracking continuity between calls and causes jerky motion. This is a standard setting, always TRUE for continuous tracking loops, never a per-station judgment call.
- **Hard vendor limits**: auto visual track frame setup works only on 4-axis robots, line conveyors (not circular/servo), one robot group, up to 8 conveyors. These are FANUC hardware/software limitations to flag early if a station design assumes otherwise (e.g. a 6-axis robot or a circular conveyor can't use this auto-setup path).

_Source: picktool  quick setup guide.pdf (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## Fanuc Controller Startup & Standard Config Checklist (2026-08-29)

Every SDC Fanuc robot goes through the same controller bring-up sequence before any TP program work:

**1. Software verify + backup.** Confirm installed software/options against the robot's slip sheet (Status>Type>Version ID>Next>Order). If software is missing, load via the black Fanuc USB through the BIOS menu (F1+F5 during power cycle) — never select 'existing personality' during this load. Once verified, immediately take an 'Image Backup' and an 'all of the above' backup, filed in the job folder as the initial baseline (pre-config, pre-program). This baseline is the recovery point for the whole build.

**2. Config Menu is a fixed SDC standard, not per-station tuning.** Menu>Next>System>Type>Config gets set to the same ~45 register values on every SDC Fanuc robot — e.g. Hot Start=FALSE, I/O power fail recovery=Recover All, Cold/Hot Start AutoExec PRG=NULL, START for CONTINUE only=TRUE, CSTOPI for ABORT / abort-all-by-CSTOPI=TRUE, Return to top of program=TRUE, Force Message=ENABLE, Allow force I/O in AUTO / Allow chg override in AUTO=TRUE, Multi program selection=TRUE. Treat this whole block as a checklist to apply verbatim, the same way HMI toggle bits or fault-timer defaults are applied — never re-derive or negotiate these per station.

**3. UOP status DO mapping is standard and fixed**: DO[200]=set in AUTO mode, DO[201]=set in T1, DO[202]=set in T2, DO[203]=set on E-STOP, DO[204]=set if input simulated, DO[205]=set if output simulated, DO[206]=set if override=100. These are the robot's status outputs to the cell controls, always assigned the same way.

**4. I/O and EDA setup use standard config files**, not manual point-by-point entry: digital I/O + UOP assignments load from DIOCFGSV.IO; EDA (Ethernet/IP) loads from EIPCFG, with the rule that connection 2's config word size must be forced to zero.

**5. Ethernet Config** (Port 1 IP address) is set via Setup>Type>Next>HostComm>Port 1 — standard menu path, no station-specific deviation expected.

_Source: Fanuc Robot Startup Checklist.txt (network: Standards - Software), ingested 2026-08-29 by the inbox librarian._

## Fanuc TP program structure & standard position registers (2026-08-30)

SDC's FANUC TP program standard (for .LS files, MakeTP-compatible on any controller):

- Every program initializes with `UTOOL_NUM=1`, `UFRAME_NUM=1`, and `PR[4]=PR[5]` (copy Zero PR into Temp Offset PR) as its first lines.
- Every major code section gets a `!` remark line; every motion line is followed by a blank program line.
- Standard PR assignments: PR[1]=Home/Perch, PR[2]=LPOS snapshot, PR[3]=JPOS snapshot, PR[4]=Temp Offset (working), PR[5]=Zero (reference, all zero), PR[6]-PR[100]=open pool for job-specific motion positions (approach/work/retract) — assigned per job, documented in the job sheet, never a reserved sub-block.
- Standard labels: LBL[1]/LBL[2]=master loop top/terminate (main only), LBL[900]=program-done/cleanup (subs), LBL[999]=fault-abort entry (subs, placed AFTER the ABORT so only reachable via JMP), LBL[100],[200]...=one per unique handshake poll loop.
- Standard I/O highlights: DO[1]=Program Done, DO[30]=off-at-done, DO[2]=Invalid Command, DI[40]=cycle stop (checked top and bottom of loop), DI[39]/R[1]=fault register (non-zero aborts), RO[1]/RO[2]=gripper open/close via CALL UNGRIP/GRIP.
- Standard EtherNet/IP adapter map (eipcfg.xml, single-arm, group 1): R[50]-R[59] + PR[101]-[108] PLC→robot; R[60]-R[69] + PR[111]-[118] robot→PLC; R[50]=program command dispatch, R[60]=program ack, R[41]=speed override. This file has no cell-specific values and is reused verbatim across single-arm SDC robots.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Compile-safe TP syntax rules (from real MakeTP failures) (2026-08-30)

Default-safe TP syntax — assume the target controller lacks optional features unless confirmed otherwise:

1. **No bracket comments on register references** (`PR[6:Pick Approach]` fails to compile if the controller's registered comment doesn't match exactly) — use bare indices (`PR[6]`) and put the description on the REMARK line above instead.
2. **No Flag (F[]) instructions** — the Flag option isn't always enabled; use R[] registers instead (e.g. R[1]<>0 as the fault/abort flag, set externally to trigger abort). The showroom reference programs use F[] because that controller has the option — replace with R[] equivalents when generating for a plain controller.
3. **No parenthesized compound WAIT** (Mixed Logic option) — replace `WAIT (DI[4]=ON OR F[1]=ON)` with a polling loop: pulse handshake output, LBL[n], `WAIT .10(sec)`, check fault register, check condition, loop back. Each handshake gets its own unique LBL number.
4. **Use `ABORT`, never bare `END` (invalid syntax) or `CALL END`** (depends on an END.TP existing in the cell) — ABORT works everywhere with no dependencies.

Advanced features (iRPickTool, Line Tracking `/APPL LINE_TRACK`, Mixed Logic, group I/O, background tasks, Flags) are only used when the target cell is confirmed to have those options — otherwise default to the compile-safe baseline.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Master loop / sequence-main / subprogram architecture (2026-08-30)

Standard FANUC program layering for SDC cells:

- **Master loop (MAIN)**: command-driven, PLC-dispatched over EtherNet/IP. Holds no station work itself — init (UTOOL/UFRAME/PR[4]=PR[5], clear R[60], DO[1]=ON), top-of-loop LBL[1], cycle-stop check against DI[40], apply speed override from R[41], one `IF (R[50]=n), CALL <sub>` per supported command, `WAIT (R[60]<>R[50])` for the called sub's ack, reset ack + set Program Done, cycle-stop check again, loop. Terminates at LBL[2] with no ABORT/fault label — the main program never fails, it just dispatches.
- **Sequence-main** (e.g. flex-feed pick): one per product/command, called by the master loop. Orchestrates the full pick-place cycle: re-init loop (open gripper, vision on, init tool, start background sensor task, move to perch), pick loop, recipe/duplicate-part dispatch to a chute-drop or place branch, loop back, end block (stop sensor task, vision off, Program Done). Use as the template starting point for new flex-feed sequence-mains — adapt dispatch/sub calls, never hand-edit the vision-tool's internally-managed motion lines.
- **Subprogram (station sub) skeleton**: header remarks → init → (optional safe-position check) → move to home/perch → approach/work motions (PR[6]-[100], touch-up offsets here) → grip/release → wait-for-OK handshake (LBL[100]-style poll with fault check) → retract to approach then home/perch → send status to PLC → end block (LBL[900]: DO[1]=ON, DO[30]=OFF, ABORT; LBL[999]) → optional chain to next program. This is the reusable shape — station-specific work and interlocks (e.g. wait DI[5] 'ok to place') get added inside it, the skeleton itself never changes.
- Typical motion speeds: home/perch moves 2000mm/sec CNT50 (fast, blended); work positions 500mm/sec FINE; fine/adjacent work positions 250mm/sec FINE.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## New job folder generation workflow (2026-08-30)

When starting a new FANUC job (job number + short description), generate a complete starting set in `Jobs/<job#> <short title>/`:

- I/O template (pick-and-place or flex-feeder variant, chosen from the description).
- `eipcfg.xml` copied verbatim (no per-job edits unless the cell genuinely deviates).
- `MAIN_<job#>.LS` = the standard master loop, unchanged except which subs the dispatch CALLs point to.
- Station subs (`PICK_<job#>.LS`, `PLACE_<job#>.LS`, etc.) built on the compile-safe subprogram skeleton, tailored with safe interlocks fitting the job.
- For flex-feed jobs specifically, adapt `A1_PK_MAIN1_SDC.LS` / `PK_CV_PICK11.LS` as templates — dispatch/recipe/place calls change, iRPickTool's own motion lines never get hand-edited.
- `JOB_<job#>.md` job sheet documenting the PLC command map, position registers to teach, and deploy checklist.

Naming rule: job-number is always a SUFFIX (`MAIN_1210`), never a prefix — program names must start with a letter. PR[1] is always Home/Perch; PR[6]-[100] assigned upward per job, every assignment documented in the job sheet so PRs never collide across subs sharing a controller.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SDC Fanuc TP program structure & standard position registers (2026-08-30)

Every SDC Fanuc TP program (.LS) starts with the same init block: `UTOOL_NUM=1`, `UFRAME_NUM=1`, and `PR[4]=PR[5]` (copy Zero PR into the working Temp Offset PR). Every major section gets a `!` remark line; every motion line is followed by a blank program line.

Standard position-register (PR) map — never re-derive, always assume:
- PR[1] = Home/Perch
- PR[2] = LPOS snapshot, PR[3] = JPOS snapshot
- PR[4] = Temp Offset (working), PR[5] = Zero PR (reference, all zero)
- PR[6]-PR[100] = open pool for job/subroutine motion positions (approach, work, retract) — no fixed sub-block; each job assigns from this range and documents assignments in the job sheet. PRs must never collide across subs sharing a controller.

EtherNet/IP single-arm data exchange (`eipcfg.xml`, reusable as-is, no per-cell IPs): PLC→Robot writes R[50]-R[59] + PR[101]-PR[108]; Robot→PLC reports R[60]-R[69] + PR[111]-PR[118] + live position feedback. Program control convention: R[50] = command dispatch value the master loop reads, R[60] = ack the called sub sets to signal completion, R[41] = speed override applied via `OVERRIDE=R[41]`.

Standard labels: LBL[1]/LBL[2] = master-loop top/terminate (main only); LBL[900] = Program Done / end-of-run cleanup (subs); LBL[999] = Fault Abort entry, placed AFTER the ABORT so it's only reached via JMP; LBL[100],[200]... = one per unique handshake polling loop in a program.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Master loop and sequence-main architecture (2026-08-30)

The top-level program (`A1A_MAIN_SDC` / `SDC_MAIN_STD.LS`) is a command-driven master loop with no station work of its own: init → `R[60]=0`, `DO[1]=ON` (idle/ready) → LBL[1] top → cycle-stop check (`DI[40]`) → apply speed override → dispatch on R[50] value to the matching sequence/station sub via `IF (R[50]=n),CALL <sub>` → `WAIT (R[60]<>R[50])` for the sub's ack → reset ack, set Program Done → cycle-stop check again → loop. Terminates at LBL[2] with no ABORT/fault label — the main never faults itself.

A sequence-main (e.g. `A1_PK_MAIN1_SDC`, the flex-feed pick template) is the per-product/command orchestrator the master loop calls: clears Program Done, sets its own ack number into R[60], then runs a re-init loop (ungrip → vision light on → iRPickTool init → perch) feeding a pick loop (pick → recipe/duplicate dispatch → chute-drop or place → cycle-stop check → loop back), ending by stopping the vision task and setting Program Done. This is the reference shape for any new flex-feed sequence-main — copy/adapt the dispatch and sub calls, not the structure.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Compile-safe TP syntax rules (2026-08-30)

These rules come from real MakeTP failures and are the DEFAULT baseline for any program that must compile on an unknown/any controller (advanced features only when the target cell is confirmed to have the option):

1. No bracket comments on references (`PR[6:Pick Approach]` fails if the registered comment doesn't match exactly) — use bare indices (`PR[6]`) and put the description on the REMARK line above.
2. No Flag (F[]) instructions — the Flag option isn't always enabled; use R[] registers instead (e.g. R[1]<>0 as the fault register, set externally to trigger abort).
3. No compound WAIT with parentheses (`WAIT (DI[4]=ON OR F[1]=ON)`) — that needs Mixed Logic; use a polling loop instead: pulse the handshake output, then `LBL[n]: WAIT .10(sec); IF R[1]<>0,JMP LBL[999]; IF DI[x]=OFF,JMP LBL[n]`. Each handshake gets a unique LBL number.
4. Use `ABORT ;` to end a program — `END ;` alone is invalid TP syntax, `CALL END` depends on an END.TP existing in the cell.

The showroom reference cell (and its flex-feed templates) DOES use the advanced options (Line Tracking, Mixed Logic, registered comments, Flags, background tasks, socket messaging, group I/O) — those templates are valid as sourced, but generating a new compile-safe sub for an unspecified/any controller means stripping back to the four rules above.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Standard subprogram skeleton & new-job generation (2026-08-30)

Every SDC station subprogram follows one skeleton: header remarks → init (UTOOL/UFRAME/PR[4]=PR[5]) → move to home/perch (PR[1], 2000mm/sec CNT50) → work motions (approach→work, PR[6]-PR[100], 500mm/sec FINE, slowing to 250mm/sec FINE for fine work) → grip/release (CALL GRIP/UNGRIP or DO vacuum + short WAIT) → wait-for-OK handshake (LBL[100]-style poll with R[1] abort check) → retract to perch → send status to PLC → end block (LBL[900]: DO[1]=ON, DO[30]=OFF, ABORT; LBL[999]; !-END-) → optional chain-call to next program.

New job generation (`Jobs/_job_generator.py`) produces a complete starting set per job: standard IO template (pick-and-place or flex-feeder variant chosen from the description), `eipcfg.xml` copied verbatim, `MAIN_<job#>.LS` (standard master loop, only dispatch CALLs change), tailored station subs following the skeleton above, and a `JOB_<job#>.md` job sheet documenting the PLC command map and every PR[6]-PR[100] assignment. Naming: job number is always a suffix (`MAIN_1210`), program names must start with a letter. I/O and EtherNet/IP config are standard and untouched unless the cell genuinely deviates; only the main's dispatch calls and the station subs are tailored per job.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SDC FANUC TP program structure & standard registers/labels (2026-08-30)

SDC has a full standard for hand-written or generated FANUC TP (.LS) programs, parallel to the PLC ladder standard.

- **Init block (every program):** `UTOOL_NUM=1`, `UFRAME_NUM=1`, `PR[4]=PR[5]` (copy Zero PR into Temp Offset PR). Every major section gets a `!` remark; every motion line is followed by a blank program line.
- **Standard position-register map:** PR[1]=Home/Perch, PR[2]=LPOS snapshot, PR[3]=JPOS snapshot, PR[4]=Temp Offset (working), PR[5]=Zero PR (reference), PR[6]-PR[100]=open pool for job-specific motion positions (approach/work/retract) — assign per job, document in the job sheet, never let two subs on the same controller collide.
- **Standard labels:** LBL[1]/LBL[2]=master-loop top/terminate, LBL[900]=Program Done/cleanup (subs), LBL[999]=Fault Abort entry (placed AFTER the ABORT so it's only reached via JMP), LBL[100]/[200].../unique per handshake polling loop in a program.
- **Standard I/O:** DO[1]=Program Done, DO[2]=Invalid Command, DO[8]=handshake pulse (0.5s), DI[40]=cycle-stop, DI[39]=station fault, R[1]=fault/abort register (non-zero → JMP LBL[999]). RO[1]/RO[2]=gripper open/close (CALL UNGRIP/GRIP). Full signal map lives in DIO_Signal_Map.xlsx.
- **Standard EtherNet/IP data map (EDA)** for single-arm robots: R[50]-R[59]/PR[101]-PR[108] = PLC→robot inputs, R[60]-R[69]/PR[111]-PR[118] = robot→PLC outputs. R[50]=program command dispatch, R[60]=program ack, R[41]=speed override. `eipcfg.xml` has no cell-specific values and is reused verbatim across all single-arm SDC robots.

This is the FANUC-side equivalent of the PLC's tag/UDT naming standard: a fixed pool of registers/labels that generation always draws from rather than inventing new ones.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Compile-safe TP syntax rules (from real MakeTP failures) (2026-08-30)

These rules exist because they were debugged out of real ASCII-to-binary translation failures — they are the TP-program equivalent of the EQ/NE-vs-EQU/NEQ ladder-import rule.

- **No bracket comments on references** (`PR[6:Pick Approach]`, `DI[4:Epoxy Finished]`) — these fail to compile unless the controller's registered comment matches exactly. Use bare indices (`PR[6]`, `DI[4]`) and put the description on the `!` remark line above.
- **No Flag F[] instructions** unless the target controller is confirmed to have the Flag option — use R[] registers instead (R[1] as fault register, set externally to trigger abort via `IF R[1]<>0,JMP LBL[999]`).
- **No parenthesized compound WAIT** (`WAIT (DI[4]=ON OR F[1]=ON)`) — requires the Mixed Logic option. Use a polling loop instead: pulse the handshake output, `LBL[n]`, `WAIT .10(sec)`, check the fault register, check the condition, loop. Each handshake gets its own unique LBL number.
- **Use `ABORT`, never `END` or `CALL END`** — bare `END` is invalid TP syntax; `CALL END` depends on an END.TP existing in the cell; `ABORT` works everywhere with no dependency.
- **Advanced features (iRPickTool, Line Tracking `/APPL LINE_TRACK`, Mixed Logic, group I/O, background tasks, Flags) are only used when the target cell is KNOWN to have those options** — the compile-safe baseline (no bracket comments, no F[], no Mixed Logic, ABORT) is the default for hand-written or generated simple station subs.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Master-loop / sequence-main / subprogram architecture (2026-08-30)

SDC FANUC programs are structured in three tiers, analogous to the PLC's supervisor/station/state split:

1. **Master loop (main program):** command-driven, holds no station work. Reads a command number from R[50] each loop, dispatches via `IF (R[50]=n),CALL <sub>`, waits `WAIT (R[60]<>R[50])` for the called sub to set its ack, checks cycle-stop (DI[40]) top and bottom, loops via LBL[1]/terminates at LBL[2]. No fault label in the main — faults are handled inside subs.
2. **Sequence-main** (e.g. flex-feed pick, A1_PK_MAIN1_SDC pattern): orchestrates one full product cycle — init/re-init loop, pick loop, recipe/duplicate-part dispatch, place, end block that stops background tasks and sets Program Done. This is the template to copy/adapt for any new flex-feed job; only the dispatch and sub-call targets change per job.
3. **Station subprogram:** fixed skeleton — header remarks, init, (optional safe-position check), move to home/perch, approach→work motion (PR[6]-PR[100]), grip/release, wait-for-OK handshake (LBL[100]-style poll with fault check), retract to perch, send status, end block (LBL[900]: DO[1]=ON, DO[30]=OFF, ABORT; LBL[999]; end). Subroutines are the only tailored piece per job — main and I/O stay standard.

**New-job generation** follows this template mechanically: copy the standard I/O template and eipcfg.xml unchanged, copy the standard MAIN and only edit its dispatch CALLs, then write compile-safe tailored subs for each station, and produce a job sheet documenting the PR[6]-PR[100] assignments and PLC command map. Program names take the job number as a suffix, never a prefix.

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## PLC ↔ External Robot Controller Handshake (discrete I/O, non-PLC-native robots) (2026-08-31)

When the robot lives on its own controller (e.g. Epson RC700-A / SPEL+) rather than as PLC-native motion, the handshake is built from plain discrete I/O, not the SDC dial protocol:

- PLC asserts a dedicated **Run DI bit** per named sequence (e.g. RunSafeHome, RunPickWait, RunPick, RunPlaceWait, RunPlace) — one bit per motion state, not a single start command.
- On seeing its bit, the robot raises its own **in-progress DO** (e.g. `PickAct`), executes the corresponding motion sub-function, then **pulses a Move-Complete DO** for a fixed short duration (0.25s is the observed default) to signal done.
- The robot then **waits for the PLC to drop the Run bit** before re-arming for the next command, with a generous timeout (30s observed) guarding against a stuck PLC-side bit.
- In-position detection on the robot side uses named **'Box' windows** around each taught point (defined once at init), analogous to PLC InPos bands but implemented in the robot's own language.

This is the reference pattern for any station where robot motion is delegated to an external robot controller talking to the PLC over discrete I/O — expect Run-bit-per-sequence + pulsed complete + drop-and-rearm, not the dial's q_ActuatorsSafe/q_Pause/q_StationComplete signal set (that's for PLC-to-PLC/dial coordination).

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Multi-position vacuum grippers driven by a part-present bitmask (2026-08-31)

For robots picking multiple parts per cycle (e.g. a 6-up vacuum tool), the PLC supplies a **part-present bitmask** (one bit per pick position) each cycle; the robot's vacuum-energize routine reads the mask and fires only the cups over present parts, then waits for **per-cup vacuum sensor confirmation** before retracting — never firing cups blind and never assuming full occupancy. This generalizes the single-gripper 'confirm before retract' idea to N independently-gated cups on one tool.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Row-indexed placement with a mandatory clear/transition point (2026-08-31)

When a robot must place into one of many indexed slots (e.g. a 32-row basket), the target offset is computed with a simple linear formula (`offset = row × pitch − pitch`) from one base taught point rather than teaching every slot. Entry into a tight/enclosed target always routes through a dedicated **clear/transition point** immediately before and after the working point (clear → approach → descend → retract → clear) specifically to avoid tool-arm collision — this is the robot-side analog of PLC servo blend/clearance points and should be assumed whenever a robot reaches into a confined space.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Robot-side dry-run and self-instrumented cycle timing (2026-08-31)

Two patterns worth reusing: (1) Dry-Run for an externally-controlled robot is implemented as its own DI bit that skips actuation (e.g. vacuum) but still runs all motion — mirrors the PLC Dry-Run toggle's intent, just carried over discrete I/O to a foreign controller. (2) The robot program can self-instrument cycle performance with no PLC involvement: snapshot a timer at a repeating event (e.g. start of each pick), compute elapsed-since-last, and track running min/max, printing a one-line summary each cycle. Useful as a lightweight diagnostic pattern independent of the PLC's own fault-timer/alarm infrastructure.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## SDC Fanuc TP Program Conventions (2026-08-31)

## Program structure standard
- Every program starts with: `UTOOL_NUM=1`, `UFRAME_NUM=1`, `PR[4]=PR[5]` (copy Zero PR into Temp Offset PR).
- Every major section gets a `!` remark line; every motion line is followed by a blank program line.

## Standard Position Registers
- PR[1] = Home/Perch
- PR[2] = LPOS snapshot, PR[3] = JPOS snapshot
- PR[4] = Temp Offset (working), PR[5] = Zero PR (reference, all zeros)
- PR[6]-PR[100] = open pool for job-specific motion positions (approach/work/retract) — no reserved sub-blocks, assign per job and document in the job sheet.

## Standard I/O and labels
- DO[1]=Program Done, DO[30]=off-at-done, DO[2]=Invalid Command, DO[8]=handshake pulse (0.5s).
- DI[40]=cycle stop (checked top of master loop), DI[39]=station fault → drives R[1] non-zero abort register.
- RO[1]/RO[2] = gripper open/close (CALL UNGRIP/GRIP).
- LBL[1]/LBL[2] = master loop top/terminate; LBL[900]=Program Done/cleanup (subs); LBL[999]=Fault Abort entry (placed after the ABORT so only reachable by JMP); LBL[100],[200]... = one per unique handshake polling loop.

## Master loop architecture (command-driven over EtherNet/IP)
PLC writes a command number to R[50]; the top-level program (per-cell, e.g. `A1A_MAIN_SDC`/`SDC_MAIN_STD.LS`) dispatches `IF (R[50]=n), CALL <sub>`, waits `WAIT (R[60]<>R[50])` for the called sub's ack, resets R[60]=0, sets DO[1]=ON (done), checks cycle-stop, loops. The main program holds no station work itself — pure dispatcher. R[41] carries speed override (`OVERRIDE=R[41]`).

## Standard subprogram skeleton
Header remarks → init (UTOOL/UFRAME/PR[4]=PR[5]) → move to home/perch (`L PR[1] 2000mm/sec CNT50`) → approach/work motions (`500mm/sec FINE` or `250mm/sec FINE` for fine work) using PR[6]-PR[100] → grip/release (CALL GRIP/UNGRIP) → wait-for-OK handshake (LBL[100]-style poll with R[1] abort check) → retract to perch → status handshake to PLC → end block (LBL[900]: DO[1]=ON, DO[30]=OFF, ABORT; LBL[999]) → optional chain-call to next program.

## Compile-safe syntax rules (from real MakeTP failures)
1. **No bracket comments on register refs** (`PR[6:Pick Approach]` fails if controller's registered comment doesn't match exactly) — use bare indices (`PR[6]`), put the description on the remark line above.
2. **No Flag F[] instructions** — the Flag option isn't always enabled; use numeric registers instead (R[1] as the fault register convention, set externally to trigger abort via `IF R[1]<>0,JMP LBL[999]`).
3. **No parenthesized compound WAIT (Mixed Logic)** — replace `WAIT (DI[4]=ON OR F[1]=ON)` with a polling loop: pulse the handshake output, `LBL[n]`, `WAIT .10(sec)`, check fault register, loop back if input still off. Each handshake gets its own unique LBL number.
4. **Use ABORT, never `END` or `CALL END`** — `END` alone is invalid TP syntax; `CALL END` depends on an END.TP existing in the cell; `ABORT` works everywhere with no dependency.

Advanced controller options (iRPickTool flex-feed+vision, Line Tracking `/APPL LINE_TRACK`, Mixed Logic, registered bracket comments, background tasks `RUN SNSTART`, PC/PLC socket messaging GETDATA/SENDDATA, group I/O GI/GO, Flags) are only used on cells confirmed to have them enabled (e.g. the showroom reference cell) — when generating for an unknown/simple target controller, default to the compile-safe baseline above.

## New job folder generation
A new job gets: standard I/O template (pick-and-place or flex-feeder variant chosen by description), `eipcfg.xml` EtherNet/IP config (copied verbatim, no per-job edits), an unmodified master loop (only the dispatch CALL lines change per job), tailored station subs built on the compile-safe skeleton, and a job sheet documenting the PLC command map and every PR[6]-PR[100] assignment (to avoid collisions across subs sharing a controller). Naming: job-number as suffix, never prefix (`MAIN_1210`, `PICK_1210`).

_Source: CLAUDE.md (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## PLC↔Robot handshake pattern (per-sequence DI/DO, pulsed Move-Complete) (2026-08-31)

Standard pattern for a PLC-driven robot controller (seen in Epson RC700-A SPEL+ programs, generalizes to any robot integration):
- PLC owns a dedicated Run/Command DI per distinct robot sequence (e.g. SafeHome, PickWait, Pick, PlaceWait, Place) — not one generic 'go' bit.
- On receiving a Run bit, the robot raises its own per-sequence In-Progress DO, executes the motion/IO for that sequence, then pulses a SHARED Move-Complete DO (~0.25s) to signal done.
- The robot then waits for the PLC to DROP the Run bit before re-arming for the next command — with a timeout (30s typical) that should fault/alarm on the PLC side if exceeded.
- This is functionally the same request/acknowledge/release handshake SDC uses station-to-station (q_StationComplete pattern) but applied one level down, PLC-to-robot-controller, with one DI per named sequence instead of a single start bit.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Multi-position vacuum gripper: bitmask-driven selective pickup (2026-08-31)

When a robot end-effector has multiple vacuum cups picking a variable number of parts per cycle: the PLC sends a bitmask word (one bit per cup position) indicating which positions currently have a part present. The robot's pick routine energizes ONLY the cups whose bit is set, then waits for each energized cup's vacuum-confirm sensor before retracting — never blind-times a multi-cup vacuum grip. A robot-side Dry-Run input (separate from any PLC dry-run) skips coil energization but still runs the motion, mirroring SDC's station Dry-Run mode.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Multi-row nest placement: offset formula + collision-avoidance move sequence (2026-08-31)

For placing into a multi-slot fixture (e.g. a basket with N rows on fixed pitch): the robot computes a linear offset from one base 'reference' point using `offset = (targetIndex × pitch) − pitch`, rather than storing/teaching a discrete point per slot. To avoid tool-arm collision with fixture walls, entry/exit uses a 3-part move shape: transition/clear point → vertical approach → descend/release → retract → clear point again — same shape whether picking or placing into a walled nest.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Cycle-time performance monitoring on the robot controller (2026-08-31)

Simple diagnostic pattern independent of the PLC: the robot snapshots a timer at the start of each cycle-defining sequence (e.g. each Pick), computes elapsed time since the previous snapshot, and prints a one-line summary (current/min/max, cumulative since power-up) to the controller console. First cycle only establishes the baseline (no time reported); reporting starts at cycle 2. Useful as a built-in bottleneck indicator without adding PLC tags.

_Source: 1145_program_setup.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Epson SCARA conveyor line tracking — commissioning parameter checklist (2026-08-31)

When a job involves an Epson SCARA tracking parts on a moving conveyor (encoder-synchronized pick), the commissioning record covers a standard parameter set — useful as a checklist even though this particular document arrived blank:

- **Encoder**: type (incremental/absolute), resolution (PPR), and physical mount point (motor shaft vs conveyor drive shaft vs idler roller) — mount location affects scaling/slip.
- **Trigger sensor**: type/model and its X/Y/Z offset relative to robot origin — this offset feeds the line-tracking start-of-capture calculation.
- **Part geometry**: L x W x H, weight, and minimum center-to-center spacing on the conveyor — spacing drives cycle-time feasibility and window sizing.
- **SPEL+ line-tracking parameters**: LT.ENCBASE (encoder reference), LTWINDOW (active capture zone), LTSLIP (allowed slip/tolerance), LTFACT (encoder-count-to-mm scaling/calibration).
- **LTLIMIT** values define upstream/downstream tracking bounds in encoder counts or mm.
- Setup should record a tested/confirmed maximum reliable conveyor speed, distinct from the theoretical conveyor speed range.
- End-effector TCP offset (vacuum cup/gripper tool dimensions) is required for accurate pick-point calculation during tracking.

This is a reference checklist, not a resolved procedure — no actual calibration values, error resolutions, or judgment calls were captured in this instance of the document.

_Source: epson_flex_feeder_guide_v1.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## FANUC iRPickTool Workcell Tree, Defaults, and Priority-Model-Pick Pattern (2026-08-31)

For FANUC robots running iRPickTool on a tracked conveyor (line tracking + 2D vision), SDC has a fixed object tree, naming scheme, and default parameters:

- **Tree order** (always build in this order to keep cross-references valid): Grippers → Robots → Trays → Conveyors → Fix Stations. Naming: GRIPPERn/ZONEn, ROBOTn, TRAYn, CONVn (one per tracked belt) with child SENSn (camera trigger) and CSTNn (conveyor station/pick point), FSTNn (fixed drop/fixture). Operations: OP_CS_CSTN<n> (pick, prefix CS = Conveyor Station) and OP_FS_FSTN<n> (place, prefix FS = Fix Station).
- **Defaults that are SDC standard, not per-cell decisions**: Approach Offset Z = -50mm on both pick and place (adjust only for part/fixture clearance); Dynamic Error Adjustment = 30.000 (engineering-review-only change); Skip Outbound Motion = enabled, FLAG Num = 1 (skips the retreat-to-home when the next pick is already queued, cutting cycle time); Part-presence check enabled on BOTH pick (so a missed vacuum doesn't carry a phantom part to place) and place (confirms release).
- **Reference Position teach (§5 procedure)**: the pose that picks a part located at the vision-process origin. This is the second-most-common source of angle/position error after calibration — see vision-systems concept for the root-cause ordering rule (never compensate here for an upstream vision defect).
- **Conveyor/encoder setup**: Encoder Scale is a measured counts/mm value (calibrate via known belt travel, don't assume); Tracking Frame must show 'Trained' before commissioning continues; Upstream/Downstream Boundary and Discard Line must sit inside the robot's reachable envelope at production speed plus deceleration distance — set conservatively, widen only after dry-run validation.
- **Priority Model Pick pattern (TP program)**: when the pick queue must be filtered by model ID without blocking, use PKCSGETTIME to peek at estimated arrival time for a given model ID (non-blocking, returns immediately; stat=3 = no match) BEFORE calling the blocking PKCSGETQUE. Only allocate (call PKCSGETQUE) when a priority part's arrival time is under a threshold register (e.g. R[14], suggest 500ms). Chain up to 3 priority model slots (registers set to 0 disables a slot), falling through instantly to a normal unfiltered PKCSGETQUE/PKCSGETQINRG get if no priority part is imminent. This eliminates the race condition that sequential blocking-timeout attempts would otherwise create.

_Source: SDC_2D_iRPickTool_Setup_Procedure.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## DCS zones are a design choice, not a regulatory mandate (2026-08-31)

Fanuc's Dual Check Safety (DCS) — safety-rated space/speed monitoring at the robot controller — is a capable, cost-effective safeguarding tool but is **not required** by any applicable regulation:
- OSHA 29 CFR 1910.212 (general machine guarding) is performance-based: it requires hazards be controlled, names no specific technology.
- ANSI/RIA R15.06-2012 requires a documented risk assessment and appropriate safeguarding; it explicitly permits equivalents (physical barriers, light curtains, laser scanners, interlocked gates) alongside safety-rated soft-axis/space-limiting features like DCS.
- ISO 10218-1/-2 require safety-rated monitored space where applicable but likewise don't mandate a specific controller feature — the requirement is meeting the necessary PL/SIL, however achieved.

Practical implication for SDC: when a multi-robot machine's safeguarding approach is being decided (e.g. whether to license/configure DCS zones), treat it as an engineering choice driven by the machine's documented risk assessment and practical design constraints (cost, footprint, cycle time impact) — not as a checkbox regulatory requirement. Cite the risk assessment, not a code section, when justifying the choice made.

_Source: DCS_Regulatory_Memo_1118GE.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## iRPickTool Priority Model Pick (multi-model queue filtering) (2026-08-31)

FANUC `PKCSGETQUE` takes an optional, teach-pendant-undocumented 6th argument that filters the pick queue by Model ID. SDC pattern: reserve registers R[11]/R[12]/R[13] as up to three priority model-ID slots (0 = slot off). TP logic tries each slot in order via `PKCSGETQUE(...,"Stat Reg"=123, R[1x])`; first match wins and the robot picks it. If none of the three slots match (or all are set to 0), fall through to a normal unfiltered `PKCSGETQUE`/`PKCSGETQINRG` so non-priority parts still get picked as a fallback — priority filtering never blocks the line. To fully disable priority behavior and restore standard FIFO-by-queue picking, zero all three registers.

_Source: SDC_2D_iRPickTool_Setup_Procedure.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._

## Fanuc Dual-Arm Coordinated Motion — VIS Calibration (SDC Standard) (2026-08-31)

## Dual-arm coordination: leader/follower model
Coordinated motion between two Fanuc groups requires the controller to know the precise 6-DOF transform between the two robots' world frames. VIS (vision-based) calibration solves this as a hand-eye problem: a camera on one robot observes a calibration grid on the other from multiple poses (5–9), and the controller least-squares-solves the rigid transform.

- **Leader (Master)**: holds the workpiece; its TCP/UFRAME is what the follower's coordinated moves reference. Pick the arm with the more rigid grip on the part as leader — leader-side error amplifies into the follower path.
- **Follower (Slave)**: performs the process (weld/dispense/machine) on the leader-held part; motion computed relative to the leader's TCP in real time.

## SDC mounting convention (non-obvious, deviates from generic Fanuc training)
- Camera mounts on the **Follower** (Group 2) tool flange; target mounts on the **Leader** (Group 1) tool flange. This is the OPPOSITE of some Fanuc training materials — SDC does it this way so the follower has freedom to sweep through calibration poses while the leader holds the target stationary.
- Mounting must be rigid, flange-only (never forearm/external fixture) — mounting flex directly translates into calibration error. Use dowel pins.

## Tool frame reservation
- **UT9 is reserved on every SDC dual-arm cell for calibration tools only** — camera UTOOL on the follower, target UTOOL on the leader — so production tools (UT1–UT8) are never disturbed by recalibration.

## MultiCal workflow (SDC-preferred over manual pose capture)
- Configure Coord Cal entry: Method = VIS, Master Group = Leader, Slave Group = Follower, both UTOOLs = UT9.
- Run MultiCal at 25–50% override; **T1 (slow teach) mandatory for the very first run** on any new cell — only advance to T2 after verifying a collision-free path. Never change override mid-cycle (abort and restart from top instead).
- Program runs in two halves: TCP refinement first, then robot-to-robot relationship computation.
- Program stops at the top on completion — **results are discarded unless manually accepted from MultiCal's bottom page.** A completed-but-unaccepted run leaves the Coord Motion page stale with no error indication — this is a common silent-failure trap.
- On failure: try defaults once more before touching parameters; most MultiCal failures are target-detection issues (lighting/focus/glare), not motion-parameter issues; change one parameter at a time.

## Acceptance criteria (residual error)
- <0.5mm: excellent, suitable for precision welding/dispensing/machining.
- 0.5–1.0mm: acceptable for general handling/assembly.
- 1.0–2.0mm: marginal — investigate mastering, TCP, mount rigidity before use.
- \>2.0mm: reject, diagnose root cause, recalibrate.
- Pose diversity (angular variation) matters more than pose count — 5 well-distributed poses beat 9 clustered ones.

## Programming coordinated motion (TP)
- Program header declares group mask and a `COORD` instruction referencing the calibration entry (e.g. `COORD GP1 LEADER, GP2 FOLLOWER, CAL=1`).
- **Inside a COORD block, follower motion lines are interpreted in the leader's UFRAME, not the follower's own $WORLD** — this is the entire point of coordinated motion but is the most common source of programmer confusion when teaching points.
- Teach a safe-approach point above each coordinated work point — follower joints can pass through unexpected configurations during coordinated moves; sanity-check geometry at the approach point before committing to the work move.

## Verification (do both — they catch different failure classes)
- Static touch-up: command follower to touch a leader-mounted reference at multiple poses; acceptable error <1mm across the envelope.
- Dynamic: trace a path at both low (50mm/s) and production (500+mm/s) speed — error should not grow with speed. Dynamic verification catches mastering errors that static touch-up misses.

## Failure-pattern diagnosis (fast triage)
- Constant XYZ offset → UTOOL/UFRAME entry error.
- Error grows with distance from grid origin → camera calibration/lens distortion.
- Direction-dependent error → mastering issue on one arm.
- Speed-dependent error → Constant Path option (J518) missing or inactive.

## Re-calibration triggers
Any collision (even minor), re-mastering or motor/encoder replacement on either arm, lens/focus/aperture adjustment, or loosening/replacement of camera or grid mounting hardware. Scheduled cadence: every 6 months (production cells) / quarterly (high-precision).

## Required controller options
J686 (Coordinated Motion), R764 (Multi-Group Motion), R685 (iRVision 2D), R667/J901 (Coord Motion Calibration), J518 (Constant Path, strongly recommended for smooth blending) — none of these are field-retrofittable from the teach pendant; confirm via MENU > STATUS > Version ID > ORDER FILE before committing to a dual-arm cell design.

_Source: Fanuc_Dual_Arm_VIS_Calibration_Guide.docx (network: Standards - Software), ingested 2026-08-31 by the inbox librarian._
