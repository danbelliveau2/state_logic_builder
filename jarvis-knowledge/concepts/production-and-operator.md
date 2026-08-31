# Production data, verify stations & operator behavior — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Source: "PLC Software Standardization, Rev2" §13–17, §23–29, plus the
standard programs on the X drive (Production.L5X, CycleTime.L5X, OEE /
MovingAverage / TopAlarms AOIs) — copied to `plc-reference/standards-docs/`.

## Verify stations: pass is ON, and the sensor must prove it can say OFF

Every assembly machine verifies one station downstream of the action (§23).
The verification input is wired/configured so **ON = pass, OFF = fail** —
never inverted. Two required protections ride with every verify:

- **Consecutive-failures counter** — default preset 3, HMI-settable per
  station. Reaching it faults the station ("Station XX Verify: Consecutive
  Failures"). The counter resets when that fault sets AND whenever a
  verification passes.
- **Stuck-ON detection** — the OFF condition must be seen between cycles;
  a sensor that never drops is itself a fault ("Station XX Verify: Sensor
  stuck in ON state"). A verify that can only ever say "pass" is not a
  verify.

## Lockout and Bypass have exact part-tracking semantics (§28)

- **Bypass** (verify stations, toggle): the station still runs each cycle —
  camera still triggers — but the result is ignored and the part-tracking
  success bit is ALWAYS set.
- **Lockout** (any station, toggle): the station does not run at all,
  part tracking ignored — and the success bit MUST still be set, so a
  locked-out station never poisons downstream part status.
- Either condition raises a standing WARNING through the alarm handler
  ("S01 Coil Load: Station Bypass Is Active") so nobody ships parts without
  knowing a check was off.
- Nest lockout is gentler: the nest just stops being loaded; a part already
  present finishes processing (§29).

## The numbers every machine reports

Production data (§26, standard Production program: R01_ProductionData +
R02_ShiftData): Total/Good/Reject counts and percentages, faults, elapsed /
runtime / downtime minutes, Runtime Efficiency, Cycle Efficiency, OEE.
Per-station data (§28): Attempts, Good, Reject, Efficiency. Failure types
(§27): code = station number + failure number (station 15 failure 2 → 152),
tallied per type and written into nest part tracking so rework can sort
rejects. Machine cycle time is averaged over 1 / 25 / 100 cycles with the
MovingAverage AOI (§24); each station's cycle time gets its own HMI display
(§25). These aren't optional dashboards — "every assembly machine must" is
the document's phrasing.

## Start/stop choreography the station rides inside (§14–17)

Cycle start is deliberate: 2-second delay between button and motion, horn on
and lights at fast-flash while it counts, then ALL stations auto-initialize
and the first cycle begins with no further operator action. Cycle stop (and
any single-station fault) is a CONTROLLED stop: every non-faulted station
completes its current sequence to a known position before the Supervisor
enters Cycle Stopped; a 10-second stuck-in-run watchdog force-advances the
Supervisor if a state machine never finishes (§16). Light stack and reset /
start pushbutton flash patterns are fixed machine-standard (§13, §17) and
live at Supervisor level — station code just has to stop at known positions
and report its state honestly.

## Downtime accounting and production data granularity (2026-08-30)

- Downtime accumulates ONLY on a fault stop, not on a normal cycle stop — a station stopping cleanly at end of cycle (e.g. between parts, at a pause) does not count against uptime/OEE; only actual faults do.
- ProductionData UDT standard fields include ElapsedSec/ElapsedMin, PPM (parts per minute), and PerfectRunTotal, with GoodRate as a REAL — production tracking is expected to compute rate and perfect-run metrics, not just good/bad counts.
- A batch counter and a Recipe program (with an example PanelView 5310 HMI project) exist as standard building blocks for stations/machines that run in batches or need switchable parameter sets — reach for these rather than inventing ad hoc batch/recipe logic.

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Downtime accrual, batch counting, recipes (2026-08-30)

- Downtime accumulates only on **fault stops**, never on ordinary cycle stops — cycle stops are normal operation, not downtime.
- A batch counter and a Recipe program (with matching PanelView recipe HMI screens) are standard optional additions when the ME's process needs product changeover tracking or recipe-driven parameters.

_Source: Revision History.md (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Debug/commissioning progression: subsystem isolation before full-auto (2026-08-31)

SDC's standard machine debug order builds up automatic-mode confidence incrementally rather than jumping straight to full-auto:
1. Manual functions first (HMI manual jog/actuate each device, slow speeds), verifying mechanics work as intended.
2. Subsystem-level automatic testing: single-step + dry-run on one subsystem (or the smallest multiple that must work together) at slow speed, verifying the sequence logic.
3. Once single-step passes, run that subsystem full-auto dry-run, then ramp speed up gradually until it meets or beats cycle time.
4. Repeat dry-run-proven sequence with real parts.
5. Only after subsystems are individually proven does full-machine automatic operation get tested, with full safety system active.

Fault checkout is a first-class step in this process: every alarm message must be verified as configured and useful; faults that occur often or are especially disruptive get root-caused, with proactive fixes, retry logic, automatic recovery, or automatic reject added to improve uptime rather than just leaving a hard stop — directly serving SDC's 'machines that stop less' philosophy already used for retries.

_Source: EE Debug and Testing Process.docx (network: EE Process and Standards Documents), ingested 2026-08-31 by the inbox librarian._
