# Jason Perry — line-by-line review of SDCServoPNP_JARVIS_v5

Source: Teams, 2026-08-24 10:46 AM. Relayed by Dan ("Jason should never have to
say any of this again"). File reviewed: `JARVIS Deliveries/SDCServoPNP_JARVIS_v5.L5X`
(build lineage b_mt3bnrp3_7yxhic, Test_Project_v2 / ServoPNP).

This document is the record of the review. Each item has been ingested through
Jarvis's learning channels (concept files, meKnowledge, validator/compiler
rules) — see the per-item disposition notes.

## The 11 items

1. **General — axis naming.** Rename `HorizontalAxis` → `XAxis`;
   `VerticalAxis` → `ZAxis`. SDC axes use the single-letter axis convention.
   *(Disposition: naming-and-structure.md concept + compile-prompt rule +
   validator soft warning.)*

2. **R00 — OK.** No changes.

3. **R01 — missing Part Present sensor.** The station has no part-present
   input; a PNP's cycle start is the part arriving. *(Disposition:
   coordination.md — part-present wait as the standard cycle start.)*

4. **R02 — state 4 semantics.** State 4 should be
   **"Start Of Sequence, Wait For Part Present"** — that is the standard name
   and meaning of the first sequence state. v5 had "Home / wait for supervisor
   cycle start". *(Disposition: naming-and-structure.md + coordination.md.)*

5. **R02 — state 7 not needed.** When `PartGripperDisengaged` is on and
   `Initialized` is on, the PNP is already at the X pick position — init
   leaves it at pick. A "move horizontal to pick" state after init is a
   redundant re-command of a position already held. *(Disposition:
   servo-motion.md — init exit posture IS the sequence's start posture.)*

6. **R02 — states 52/55/58/61 added OUT OF ORDER.** The sequence ran
   10 → 52 → back to 13. It must run 10 → 13 → 16: synthesized confirm states
   are **renumbered inline on the +3 grid** and downstream states pushed —
   never appended at high numbers out of flow. *(Disposition: coordination.md
   concept + MECHANICAL: inline renumbering pass in coordinationAuthor.js +
   flow-order validator checks at IR and L5X level.)*

7. **R03 — rungs 3, 6, 7 incorrectly formatted.** The S05_ServoPNP template
   has the proper formatting — copy the template's exact rung format.
   *(Disposition: naming-and-structure.md — R03 formatting = template's exact
   rung format.)*

8. **R04 — there is NO home position for the X axis.** Just pick and place.
   Dan's resolution (controls answer wins): horizontal PNP axes have no home —
   init leaves them at pick. Z still homes at Retract; grippers at Disengaged.
   *(Disposition: servo-motion.md + meKnowledge.md + alarm-position validator
   check.)*

9. **R04 rung 14 / R05 rung 14 must match his snippets.** Screenshots were not
   machine-readable; the S05 template's own R04/R05 rung-14 staging shape is
   the authority — per-state Positions[i]/speed staging in the template's
   exact format. *(Disposition: servo-motion.md; diff verdict below.)*

10. **R20 — remove references to the X home position.** v5's R20 rung 7
    ("Waiting For Horizontal Axis To Reach Home Position") references a
    position that must not exist. *(Disposition: alarms.md + validator check —
    no alarms referencing nonexistent positions.)*

11. **R20 — alarm 9 not needed.** v5's Alarm[9] ("Waiting For Cycle Start"
    warning on state 4). With state 4 = Wait For Part Present, sitting in
    state 4 with no part is the normal idle condition, not a warning.
    *(Disposition: alarms.md.)*

## v5-vs-template rung-14 diff (the item-9 check)

v5's staging rungs follow the template's structural skeleton exactly
(unconditioned defaults first — MoveType 0, AutoSpeed[0]/Accel[0]/Decel[0] —
then state-keyed branches, last write wins), with two deviations from the
template's literal rung 14:

- **X axis staged a third position — Positions[0] "Home"** (template X stages
  exactly two: Positions[0]/[1], the pick side and the place side). This is
  exactly item 8: the deviation, not the template, was the defect.
- **Axis names** HorizontalAxis/VerticalAxis instead of XAxis/ZAxis (item 1).
- The fast-speed override branch (AutoSpeed[1]/Accel[1]/Decel[1] keyed on the
  fast states) is Dan's sanctioned fast/slow extension, not a template
  violation; its staging implementation is already with the leads as
  `q_dan_20260821_staging_impl`.

**Verdict: v5 deviated from the template; the template was already the
answer.** No re-request of the screenshots is needed — match the template's
rung-14 shape exactly (two X positions, no Home) and the sanctioned speed
extension stays as the one declared addition.
