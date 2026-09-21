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
runtime / downtime minutes, Runtime Efficiency, Cycle Efficiency, OEE. The
ProductionData UDT carries ElapsedSec/ElapsedMin, PPM, PerfectRunTotal and
GoodRate as a REAL, plus IdealCycleTime as a configured constant in seconds
and a batch counter — production tracking is expected to produce *rates and
perfect-run metrics*, not just good/bad tallies. A Recipe program (with an
example PanelView 5310 project) is the standard building block when the
process needs changeover or switchable parameter sets; don't invent ad hoc
batch/recipe logic.

Per-station data (§28): Attempts, Good, Reject, Efficiency. Failure types
(§27): code = station number + failure number (station 15 failure 2 → 152),
tallied per type and written into nest part tracking so rework can sort
rejects. Machine cycle time is averaged over 1 / 25 / 100 cycles with the
MovingAverage AOI (§24); each station's cycle time gets its own HMI display
(§25). These aren't optional dashboards — "every assembly machine must" is
the document's phrasing.

**Downtime is a fault metric, not "time not running."** It accumulates only
on a fault stop; an ordinary cycle stop, operator pause, or end-of-cycle idle
is normal operation and must not be charged against uptime. That single rule
is what makes the OEE number comparable between machines and shifts.

## OEE is three independent factors, and the AOI makes that visible

Seen in OEE.L5X: the standard AOI takes `PlannedProductionTime`, `RunTime`,
`Downtime` (DINT time counters), `IdealCycleTime` (REAL, seconds),
`TotalCount` and `GoodCount`, and returns four REALs: `Availability`,
`Performance`, `Quality`, `OEE`. That signature *is* the concept — SDC does
not publish a single blended "efficiency" number; it publishes the three
factors whose product is OEE, because only the factors tell you what to fix:

- **Availability** — did the machine get to run during time we planned for
  it? Driven by `PlannedProductionTime` vs `RunTime`/`Downtime`. Low
  Availability is a *reliability/fault* problem, which is why the fault-only
  downtime rule above matters: charge a clean cycle stop here and the number
  blames maintenance for a scheduling decision.
- **Performance** — while running, did it hit rate? This is where
  `IdealCycleTime × TotalCount` is compared against run time, so
  IdealCycleTime is a *commissioning-owned constant*, not a wish. Set it too
  slow and Performance reads >100% and hides real losses; set it to a number
  the machine has never achieved and Performance permanently reads low. It
  should be the proven best sustained cycle from the ramp-up step of debug.
- **Quality** — `GoodCount / TotalCount`. This is fed by the verify/part-
  tracking semantics above, which is exactly why Bypass and Lockout force
  the success bit: a bypassed check inflates Quality, and the standing
  WARNING is the only thing telling the operator the number is optimistic.

Judgment calls the interface leaves to the integrator: the DINT time inputs
carry no units, so **RunTime, Downtime and PlannedProductionTime must all be
in the same unit as IdealCycleTime (seconds)** or Performance is off by 60x —
feed it ElapsedSec-family tags, not ElapsedMin. And `PlannedProductionTime`
is a business decision, not a timer: it should exclude planned breaks and
planned changeover (pair it with the Recipe/batch counter on changeover
machines), otherwise the machine is penalised for the schedule.

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

## Debug/commissioning progression: subsystem isolation before full-auto (2026-08-31)

SDC's standard machine debug order builds up automatic-mode confidence incrementally rather than jumping straight to full-auto:
1. Manual functions first (HMI manual jog/actuate each device, slow speeds), verifying mechanics work as intended.
2. Subsystem-level automatic testing: single-step + dry-run on one subsystem (or the smallest multiple that must work together) at slow speed, verifying the sequence logic.
3. Once single-step passes, run that subsystem full-auto dry-run, then ramp speed up gradually until it meets or beats cycle time — **this ramp is where IdealCycleTime for the OEE AOI gets established.**
4. Repeat dry-run-proven sequence with real parts.
5. Only after subsystems are individually proven does full-machine automatic operation get tested, with full safety system active.

Fault checkout is a first-class step in this process: every alarm message must be verified as configured and useful; faults that occur often or are especially disruptive get root-caused, with proactive fixes, retry logic, automatic recovery, or automatic reject added to improve uptime rather than just leaving a hard stop — directly serving SDC's 'machines that stop less' philosophy already used for retries. Note the OEE feedback loop: a retry raises Availability but costs Performance, and an automatic reject protects Quality at the cost of counts — the three factors are how you argue which recovery strategy was right.

_Sources: Revision History.md (Standards - Software), EE Debug and Testing Process.docx, OEE.L5X (Standards - Software / AOI's / OEE)._

## PanelView Plus 6 slow response — firmware, not screen tuning, is often the real fix (2026-09-15)

When a PVP6 HMI (or similar legacy PanelView) becomes progressively slower as screens/animations/visibility logic accumulate over a project, the standard HMI-tuning knobs are NOT reliable fixes:
- Lowering Maximum Tag Update Rate per screen
- Lowering button hold time (symptom: buttons/outputs appear to hold ON longer than pressed)
- Deleting unused communication nodes (drives/ethernet devices not needed by the HMI)

These are worth trying but should not be assumed to be the fix — in a documented case none of them moved the needle.

The actual resolution was a PanelView firmware upgrade (v10 → v12) followed by building a fresh runtime file from the existing project on the new firmware. v12 was the latest Rockwell-supported firmware for PVP6 hardware, even though it wasn't officially certified against the project's Studio 5000 v37 controller firmware — Rockwell TechSupport recommended trying it anyway, and it worked.

If firmware upgrade doesn't resolve severe slowness, the next-tier fix is hardware replacement: move off PVP6 entirely to a PVP7 running v15/v16.

Takeaway for SDC: when an HMI on a legacy/reused-hardware project (components carried over from a prior machine) exhibits slow response that worsens as the project grows, suspect firmware/hardware headroom before spending more time on screen-level tag-rate/hold-time tuning.

_Source: Rockwell Ticket - 4011630515 - PVP6,, slow response from objects -IG.docx (network: SDC Knowledgebase), ingested 2026-09-15 by the inbox librarian._
