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
