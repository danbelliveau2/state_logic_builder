# Pneumatics — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)

Sources: "Pneumatic Standardization Selection Guide, Rev2" (2025-07-10) and
"PLC Software Standardization, Rev2" §18 — both in
`plc-reference/standards-docs/`. SDC pneumatics are SMC, period.

## The valve type IS the control semantics

Which SY-series valve the ME's actuator gets determines what the outputs
mean in code (Pneumatic Guide §4):

- **Double solenoid (SY_200)** — horizontal motion, grippers. Two outputs
  (`q_Extend…`/`q_Retract…`, `q_Close…`/`q_Open…`). The valve REMEMBERS its
  last position: both outputs off = actuator stays put. This is why the
  gripper's commanded state survives a stop and can serve as the only memory
  of "carrying a part" (see coordination.md).
- **3-position center blocked (SY_300)** — vertical motion (PNP Z axes).
  Both outputs off = air blocked, load holds mid-stroke instead of drifting.
  Vertical axes get this specifically so dropping outputs is safe.
- **Spring return single solenoid (SY_100)** — one output, continuous-flow
  loads: air knife, feeder-bowl air, venturi supply. Output off = spring
  returns. There is no "reverse" output to interlock against.
- **3-position center exhaust (SY_400)** — safety depressurization in
  advanced safety applications only (safe-zone dumps). Not sequence logic.

## Sensorless actuators: the delay-timer trigger conditions

When an actuator has no sensor for a direction (very common — the default
device arrangement is a RETRACT sensor only), completion is a delay timer in
R01_Inputs, and the standard is precise about when that timer may run
(PLC Std §18): the timer is triggered only when

1. the output for the action is ON,
2. the output for the reverse action is OFF, and
3. the input (sensor) for the reverse action is OFF.

The point: the timer measures "commanded one way, demonstrably left the other
end" — not merely "output on." All three legs belong in the timer rung.

## Machine-level plumbing the station code can assume

Every machine has one air prep unit per safety zone: manual lockout,
filter/regulator, 24VDC soft-start dump valve, and an ISE40 digital pressure
switch with 2 PNP outputs (Pneumatic Guide §3) — so "air pressure OK" exists
as a real input for preconditions/alarms. Valves live on EX600 valve banks
(EtherNet/IP, up to 16 valves + IO modules; EX260 when IO-Link); standalone
valves appear only for robot grippers without internal solenoids or
actuators needing high-speed direct PLC-output control (§5). Vacuum comes
from SMC ZK2 electronic generators (integrated vacuum switch) or ZH venturis
with a standalone vacuum switch — either way a vacuum-confirm input
normally exists for pick verification (§10).

## Feeder bowl blow-off air is single-solenoid continuous flow (2026-08-28)

Feeder bowl blow-off assist air is a continuous-flow load, not a cylinder-style extend/retract actuator: it's driven by a single spring-return solenoid (SY_100) with one output and no reverse/retract output to interlock against. Don't model it with the standard extend/retract pneumatic device pattern (dual outputs, retract sensor default) — it's just an ON output.

_Source: Lesson notes - dial station feeder bowls.md (local inbox drop), ingested 2026-08-28 by the inbox librarian._

## Ethernet/IP proportional pressure/vacuum regulators (SMC ITV) (2026-08-30)

Some SDC stations may use an SMC Ethernet ITV — a proportional pressure or vacuum regulator that is a DEVICE in its own right (like a servo axis, not like a valve bank): it takes a setpoint and reports feedback over standard EtherNet/IP I/O rather than being driven by discrete valve outputs.

- **Data format**: setpoint and feedback are 16-bit INTs; the low 12 bits are 'counts' (0-4095 = 0-100% of the unit's full-scale range). An extend bit allows commanding/reading up to 120% (4914 counts) — useful when a lower full-scale body is deliberately used on a smaller-range application for finer precision.
- **Engineering units** (MPa, kg/cm², BAR, PSI, kPa) are selectable as an alternative to counts but require a unit- and body-specific integer multiplier — get the multiplier wrong and the setpoint is off by orders of magnitude, not just scaled wrong.
- **Comms-loss behavior is configurable and safety-relevant**: 'Hold on Connection Loss' either holds the last setpoint through a network dropout or forces setpoint to 0 (exhaust). Either way, on reconnect the ITV does NOT automatically resume the pre-loss setpoint — it must be re-commanded to a different value and then back to the desired one. Any fault-recovery logic built around this device must model that deliberate non-resume, not assume the setpoint just comes back.
- **POE daisy-chaining** (if used to avoid running separate 24V drops) has hard rules: max 5 ITVs per POE group, every unit except the last in the group must have POE enabled, and a POE-enabled unit's Bus Out may only ever feed the next unit's Bus In (never a random downstream device) — treat this as a wiring/network topology constraint, not a controls one.

_Source: Operation Manual - Ethernet IP ITV - IN19856.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## Proportional Pressure/Vacuum Regulators (SMC ITV, EtherNet/IP) (2026-08-30)

Some pneumatic setpoint devices are not valve-driven cylinders/actuators but proportional pressure/vacuum regulators (e.g. SMC ITV series) that live directly on EtherNet/IP as their own I/O device — distinct device class from the gripper/cylinder taxonomy.

- **I/O shape**: setpoint (output to device) and feedback (input from device) are each 16-bit INT words. Lower 12 bits = counts (0–4095 = 0–100% of rated full scale); an Ext/E bit allows commanding/reading up to 120% of full scale; feedback carries an extra diagnostics byte.
- **Scaling**: Counts = (desired pressure / max pressure) × 4095, or use the body-type-specific scale factor SMC publishes. The device also supports native engineering-unit mode (PSI/bar/kPa/MPa/kg/cm²) with a per-unit multiplier for integer math — counts is the default and simplest for PLC logic.
- **Comm-loss behavior is a real control decision, not a given**: default is fail-safe exhaust (setpoint snaps to 0) on EtherNet/IP connection loss. A 'Hold on Connection Loss' option makes it continue regulating to the last setpoint instead — but critically, if Hold was OFF during a loss, reconnecting does NOT automatically re-apply the previous setpoint; the PLC must re-command a different value then back to the desired one. This asymmetry matters for fault-recovery logic on any station using one of these regulators.
- **Tuning lives in the device, not the PLC program**: User Gain (0–15, default 8 ≈ 5s response) trades response speed for overshoot risk; User Sensitivity (0–7, default 2 ≈ 2%) trades precision for hunting resistance. Both are adjustable via explicit messaging or the device's built-in web page — treat like servo gain/tuning parameters, exposed for commissioning, not hardcoded.
- **Overrange trick**: rated range extends to 120% of nameplate full scale (except vacuum units), so a lower-full-scale-body ITV can sometimes be selected for a given max-pressure application to get finer counts resolution than a higher-range unit would give at the same operating point.

_Source: Operation Manual - Ethernet IP ITV - IN19856.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._

## SMC Valve Selection Standard (Pneumatic Standardization Guide Rev2) (2026-08-31)

SDC standardizes on SMC for all pneumatic hardware. Key selection judgments an engineer/Jarvis should apply when specifying valves and air system components:

- **Valve spool type follows motion type, not just port count:**
  - SY3200 (5-port, 2-position, double solenoid) → horizontal motion (PNP horizontal axis) and grippers — no need to hold mid-stroke position.
  - SY3300 (5-port, 3-position, CENTER BLOCKED) → vertical motion (PNP vertical/Z axis) — center-blocked holds the actuator's position on air or power loss, which matters for gravity-loaded axes.
  - SY3100 (5-port, 2-position, single/spring-return solenoid) → simple on/off flow devices like air knives, venturi supply.
  - SY3400 (5-port, 3-position, CENTER EXHAUST) → advanced safety applications that must actively depressurize/vent an actuator (used for extraction-cylinder safety releases), not general-purpose motion.
- **Valve body size (SY3000/5000/7000)** scales with actuator flow demand and required response time — bigger bore/faster stroke needs bigger valve.
- **Standalone valves (off the bank, direct PLC output or M12 base)** are used when: (a) a robot gripper has no internal solenoid option — Epson robots never offer this, Fanuc robots optionally do; or (b) an actuator needs high-speed response that can't tolerate valve-bank network/scan latency.
- **Air prep unit** (manual lockout + filter/regulator + 24VDC soft-start dump valve + digital pressure switch) sizing = total pneumatic consumption of all actuators on that safety zone **+ 20% safety factor**. Number of safety zones on the machine determines how many air prep units and valve bank groupings are needed — most SDC machines are a single zone; larger multi-zone machines need one air prep unit and its own valve banks per zone.
- **Vacuum generation** is a deliberate technology choice, not a default: SMC ZK2 electronic generator (integrated pressure switch, more compact/quieter) vs SMC ZH venturi with a standalone Coval vacuum switch — sized per the application's vacuum flow/hold requirements.
- **Valve bank platform**: EX600 (EtherNet/IP, up to 9 IO modules / 16 valves, standard when machine network is EtherNet/IP) is the default; EX260 (IO-Link master, no expansion IO capability) is used only when the machine's I/O architecture is IO-Link-based.
- **Tubing convention**: color-code by function — blue = supply, black = exhaust, red = signal — flexible polyurethane/nylon, avoid excess bends/length.

_Source: Pneumatic Standardization Selection Guide, Rev2.docx (network: EE Process and Standards Documents), ingested 2026-08-31 by the inbox librarian._

## Learned from corrections
- (2026-08-31, from the fix loop (tuition)'s correction of build PNP_ServoX- PneumaticZ / MidBasePickAndPlace [tuition]) A hybrid station (one servo axis plus pneumatic motion on the other axis) is a real and recurring SDC shape, and neither the two-servo PNP template nor the all-pneumatic load template fits it. The correct base is the servo template with the surplus axis deleted whole — routine, its JSR, its alarm rungs, every program tag, the HMI and iq_ tags, and the controller axis — and the pneumatic axis rebuilt from the pneumatic idiom (sensor-confirmed retract, delay-timer extend with all three trigger legs, centre-blocked valve semantics). The surviving servo axis's permissive then states the pneumatic interference directly (slide retracted), and the quickstop reason is that compare's exact complement.
- (2026-08-31, from the fix loop (tuition)'s correction of build PNP_ServoX- PneumaticZ / MidBaseEscapement [tuition]) Converting a template's 2-sensor actuator into a 1-sensor actuator (or vice versa) is a structural change that ripples beyond the one conditioning rung: the missing sensor's input tag must be removed, a delay timer added with the confirm rung rebuilt on the three-leg pattern (output on, reverse output off, reverse sensor off), and every rung that referenced the deleted sensor — misconfiguration alarms, Initialized posture, init branches, manual permissives — re-derived. Plan the sensor-arrangement delta per device up front; discovering it rung-by-rung guarantees orphaned references.
