/**
 * DeviceIcons - Mechanical SVG icons for each SDC device type.
 * Used throughout the app in place of emoji icons.
 */

// ── Pneumatic Linear Actuator (ANSI cylinder w/ piston rod through body) ─────
function LinearActuatorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="6.5" width="14" height="11" stroke={color} strokeWidth="1.6"/>
      <line x1="17" y1="12" x2="22" y2="12" stroke={color} strokeWidth="1.6"/>
      <rect x="7.5" y="7.5" width="3" height="9" fill={color}/>
      <line x1="3" y1="12" x2="7.5" y2="12" stroke={color} strokeWidth="1.6"/>
    </svg>
  );
}

// ── Pneumatic Rotary Actuator (body w/ rotating disk + ports + arrow above) ──
function RotaryActuatorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <rect x="3" y="12" width="15" height="10" rx="0.5" stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.12"/>
      {/* Air ports on the right side */}
      <rect x="18" y="14" width="2.2" height="1.5" fill={color}/>
      <rect x="18" y="19" width="2.2" height="1.5" fill={color}/>
      {/* Rotating disk in the middle */}
      <circle cx="10.5" cy="17" r="3" stroke={color} strokeWidth="1.6" fill="#fff"/>
      <circle cx="10.5" cy="17" r="0.9" fill={color}/>
      {/* Rotation arrow ENTIRELY above the body */}
      <path d="M 1 9 C 1 0, 21 0, 21 9" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
      <polygon points="21,10.5 19,9 23,9" fill={color}/>
    </svg>
  );
}

// ── Pneumatic Gripper (SMC MHZ2 parallel jaw style) ───────────────────────────
function GripperIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body block */}
      <rect x="8" y="2" width="8" height="8" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Left jaw arm */}
      <rect x="2" y="10" width="9" height="3.5" rx="0.5" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Left jaw finger */}
      <rect x="2" y="13.5" width="3.5" height="6" rx="0.5" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Right jaw arm */}
      <rect x="13" y="10" width="9" height="3.5" rx="0.5" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Right jaw finger */}
      <rect x="18.5" y="13.5" width="3.5" height="6" rx="0.5" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Center divider */}
      <line x1="11" y1="10" x2="13" y2="10" stroke={color} strokeWidth="1"/>
    </svg>
  );
}

// ── Vacuum Generator (funnel body + 3 swooping arrows pulling air up) ────────
function VacuumIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body — flat top, taper, narrow opening at bottom */}
      <path d="M 5 2 L 19 2 L 19 11 L 14 14 L 10 14 L 5 11 Z"
        stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.12" strokeLinejoin="round"/>
      {/* LEFT — thin swoop in from bottom-left, big triangle tip */}
      <path d="M 1 22 Q 7 21 7 18" stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      <polygon points="7,14 4.5,18 9.5,18" fill={color}/>
      {/* MIDDLE — thin straight shaft, big tip */}
      <line x1="12" y1="22" x2="12" y2="18" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <polygon points="12,14 9.5,18 14.5,18" fill={color}/>
      {/* RIGHT — mirror swoop */}
      <path d="M 23 22 Q 17 21 17 18" stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      <polygon points="17,14 14.5,18 19.5,18" fill={color}/>
    </svg>
  );
}

// ── Servo Motor (motor body + encoder + shaft) ────────────────────────────────
function ServoIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Motor body */}
      <rect x="1" y="5" width="14" height="14" rx="2" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Motor stator circle */}
      <circle cx="8" cy="12" r="4" stroke={color} strokeWidth="1.2" fill="none"/>
      <circle cx="8" cy="12" r="1.5" fill={color}/>
      {/* Encoder block */}
      <rect x="15" y="7" width="4" height="10" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Encoder marks */}
      <line x1="16.5" y1="9"  x2="17.5" y2="9"  stroke={color} strokeWidth="0.8"/>
      <line x1="16.5" y1="11" x2="17.5" y2="11" stroke={color} strokeWidth="0.8"/>
      <line x1="16.5" y1="13" x2="17.5" y2="13" stroke={color} strokeWidth="0.8"/>
      <line x1="16.5" y1="15" x2="17.5" y2="15" stroke={color} strokeWidth="0.8"/>
      {/* Output shaft */}
      <line x1="19" y1="12" x2="23" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

// ── Timer / Dwell (stopwatch) ─────────────────────────────────────────────────
function TimerIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Crown */}
      <line x1="9" y1="3.5" x2="15" y2="3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="12" y1="3.5" x2="12" y2="5.5" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Clock face */}
      <circle cx="12" cy="14" r="8" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Hour hand */}
      <line x1="12" y1="14" x2="12" y2="9" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Minute hand */}
      <line x1="12" y1="14" x2="16" y2="14" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Center dot */}
      <circle cx="12" cy="14" r="1" fill={color}/>
    </svg>
  );
}

// ── Digital Sensor (sensor body w/ ON display + binary LEDs + 2 outputs) ─────
function SensorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="11" height="14" rx="2" stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.12"/>
      <rect x="3.2" y="7" width="8.6" height="6" rx="0.5" fill="#fff" stroke={color} strokeWidth="0.9"/>
      <text x="7.5" y="11.6" fontSize="4" fontWeight="700" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace">ON</text>
      <circle cx="5" cy="16.5" r="0.9" fill={color}/>
      <circle cx="10" cy="16.5" r="0.9" stroke={color} strokeWidth="1" fill="#fff"/>
      <line x1="13" y1="9" x2="22" y2="9" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <path d="M22 9 L19 7.5 M22 9 L19 10.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="13" y1="15" x2="22" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <path d="M22 15 L19 13.5 M22 15 L19 16.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Signal (radio-wave / broadcast glyph) ────────────────────────────────────
// Used for embedded Decide / Verify / Wait rows that reference a project-level
// signal (as opposed to a device tag). Reads as "broadcast bit" — dot in the
// center with two outward arcs, visually distinct from the sensor beam icon.
function SignalIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Source dot */}
      <circle cx="12" cy="12" r="2" fill={color}/>
      {/* Inner arcs */}
      <path d="M 8.5 9 A 4.5 4.5 0 0 0 8.5 15" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <path d="M 15.5 9 A 4.5 4.5 0 0 1 15.5 15" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      {/* Outer arcs */}
      <path d="M 5.5 6.5 A 8 8 0 0 0 5.5 17.5" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <path d="M 18.5 6.5 A 8 8 0 0 1 18.5 17.5" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

// ── Parameter (tag / flag icon) ───────────────────────────────────────────────
function ParameterIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Tag shape */}
      <path d="M3 5a2 2 0 0 1 2-2h7.17a2 2 0 0 1 1.41.59l6.83 6.83a2 2 0 0 1 0 2.83l-5.17 5.17a2 2 0 0 1-2.83 0L5.59 11.41A2 2 0 0 1 5 10V5z"
            stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
      {/* Hole */}
      <circle cx="8.5" cy="8.5" r="1.2" fill={color}/>
      {/* p letter for "parameter" */}
      <text x="11" y="18" textAnchor="middle" fontSize="8" fontWeight="bold" fill={color} fontFamily="monospace">p</text>
    </svg>
  );
}

// ── Vision System (square camera body + lens + dotted FOV rays right) ───────
function VisionSystemIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="6" width="11" height="12" rx="1" stroke={color} strokeWidth="1.6"/>
      <circle cx="8.5" cy="12" r="2.5" stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.2"/>
      <circle cx="8.5" cy="12" r="0.9" fill={color}/>
      <path d="M14 9 L22 5 M14 12 L22 12 M14 15 L22 19" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 1.5"/>
    </svg>
  );
}

// ── Robot (FANUC-style articulated arm) ──────────────────────────────────────
function RobotIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Base */}
      <rect x="4" y="20" width="16" height="3" rx="1" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Base column */}
      <rect x="10" y="16" width="4" height="4" stroke={color} strokeWidth="1.3" fill="none"/>
      {/* Joint 1 (shoulder) */}
      <circle cx="12" cy="16" r="2" stroke={color} strokeWidth="1.3" fill="none"/>
      <circle cx="12" cy="16" r="0.8" fill={color}/>
      {/* Upper arm */}
      <line x1="12" y1="14" x2="7" y2="8" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Joint 2 (elbow) */}
      <circle cx="7" cy="8" r="1.8" stroke={color} strokeWidth="1.2" fill="none"/>
      <circle cx="7" cy="8" r="0.7" fill={color}/>
      {/* Forearm */}
      <line x1="7" y1="8" x2="15" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Joint 3 (wrist) */}
      <circle cx="15" cy="4" r="1.5" stroke={color} strokeWidth="1.2" fill="none"/>
      {/* End effector / gripper */}
      <line x1="16.2" y1="3.5" x2="19" y2="2" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="16.2" y1="4.5" x2="19" y2="6" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

// ── Conveyor (belt with rollers + bigger arrow above going right) ────────────
function ConveyorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6 L17 6" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
      <path d="M17 6 L13 3 M17 6 L13 9" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="5" cy="16" r="2.5" stroke={color} strokeWidth="1.6"/>
      <circle cx="19" cy="16" r="2.5" stroke={color} strokeWidth="1.6"/>
      <line x1="5" y1="13.5" x2="19" y2="13.5" stroke={color} strokeWidth="1.6"/>
      <line x1="5" y1="18.5" x2="19" y2="18.5" stroke={color} strokeWidth="1.6"/>
    </svg>
  );
}

// ── Analog Sensor (same body as Digital + numeric value + bar graph + 1 out) ─
function AnalogSensorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="11" height="14" rx="2" stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.12"/>
      <rect x="3.2" y="7" width="8.6" height="6" rx="0.5" fill="#fff" stroke={color} strokeWidth="0.9"/>
      <text x="7.5" y="11.6" fontSize="4" fontWeight="700" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace">12.4</text>
      <rect x="3.5" y="15.5" width="1.1" height="2" fill={color}/>
      <rect x="5.2" y="14.5" width="1.1" height="3" fill={color}/>
      <rect x="6.9" y="13.5" width="1.1" height="4" fill={color}/>
      <rect x="8.6" y="14.7" width="1.1" height="2.8" fill={color} opacity="0.4"/>
      <line x1="13" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <path d="M22 12 L19 10 M22 12 L19 14" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Icon registry ─────────────────────────────────────────────────────────────

// ── Custom Device (rounded wavy gear with center hub) ────────────────────────
function CustomDeviceIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="
        M 12 3
        C 13.4 3, 13.4 5, 14.6 5
        C 16 5, 16.4 3.8, 17.5 4.5
        C 18.7 5.3, 18.2 6.5, 19 7
        C 19.8 7.5, 21 7.4, 21.2 8.7
        C 21.5 10, 19.8 10.5, 19.5 11.6
        C 19.3 12.7, 21 13.5, 20.7 14.7
        C 20.5 16, 19.2 15.6, 18.6 16.5
        C 18 17.4, 18.7 18.7, 17.5 19.5
        C 16.3 20.2, 15.7 19, 14.6 19
        C 13.4 19, 13.4 21, 12 21
        C 10.6 21, 10.6 19, 9.4 19
        C 8.3 19, 7.7 20.2, 6.5 19.5
        C 5.3 18.7, 6 17.4, 5.4 16.5
        C 4.8 15.6, 3.5 16, 3.3 14.7
        C 3 13.5, 4.7 12.7, 4.5 11.6
        C 4.2 10.5, 2.5 10, 2.8 8.7
        C 3 7.4, 4.2 7.5, 5 7
        C 5.8 6.5, 5.3 5.3, 6.5 4.5
        C 7.6 3.8, 8 5, 9.4 5
        C 10.6 5, 10.6 3, 12 3 Z"
        stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.18" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.6" fill="#fff"/>
      <circle cx="12" cy="12" r="1" fill={color}/>
    </svg>
  );
}

const ICON_COMPONENTS = {
  PneumaticLinearActuator: LinearActuatorIcon,
  PneumaticRotaryActuator: RotaryActuatorIcon,
  PneumaticGripper:        GripperIcon,
  PneumaticVacGenerator:   VacuumIcon,
  ServoAxis:               ServoIcon,
  Robot:                   RobotIcon,
  Conveyor:                ConveyorIcon,
  Timer:                   TimerIcon,
  DigitalSensor:           SensorIcon,
  AnalogSensor:            AnalogSensorIcon,
  Parameter:               ParameterIcon,
  Signal:                  SignalIcon,
  VisionSystem:            VisionSystemIcon,
  Custom:                  CustomDeviceIcon,
};

export const DEVICE_ICON_COLORS = {
  PneumaticLinearActuator: '#3b82f6',
  PneumaticRotaryActuator: '#6366f1',
  PneumaticGripper:        '#8b5cf6',
  PneumaticVacGenerator:   '#06b6d4',
  ServoAxis:               '#f59e0b',
  Robot:                   '#7c3aed',
  Conveyor:                '#0891b2',
  Timer:                   '#9ca3af',
  DigitalSensor:           '#64748b',
  AnalogSensor:            '#6366f1',
  Parameter:               '#f97316',
  Signal:                  '#0072B5',
  VisionSystem:            '#0891b2',
  Custom:                  '#6b7280',
};

/**
 * DeviceIcon — renders the mechanical SVG icon for a device type.
 * @param {string} type   - device type key from DEVICE_TYPES
 * @param {number} size   - icon size in px (default 24)
 * @param {string} color  - override color (defaults to type color)
 */
export function DeviceIcon({ type, size = 24, color }) {
  const IconComponent = ICON_COMPONENTS[type];
  const iconColor = color ?? DEVICE_ICON_COLORS[type] ?? '#9ca3af';

  if (!IconComponent) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="2" width="20" height="20" rx="3"
              stroke="#9ca3af" strokeWidth="1.5" fill="none"/>
        <text x="12" y="17" textAnchor="middle" fontSize="14" fill="#9ca3af">?</text>
      </svg>
    );
  }

  return <IconComponent size={size} color={iconColor} />;
}

// ─── Topology icons for v2 picker sub-actions ──────────────────────────────
// Mini-diagrams showing the source NODE + its exit pattern. Used in both
// the picker button (UniversalPicker.SubActionBtn) and the canvas action
// pill (StateNode.PickerV2ActionRow). Living here in DeviceIcons.jsx
// breaks the circular dep that would arise if either component owned them.
//
//   CheckContinueIcon → small node + single arrow STRAIGHT DOWN out the
//                       bottom (one path forward).
//   CheckBranchIcon   → small node + L-shaped exits going OUT PERPENDICULAR
//                       (left + right sides), then DOWN, with arrowheads —
//                       mimics how branch edges actually leave a state on
//                       the canvas (side handles, then vertical to target).
//
// `currentColor` lets the icon inherit text color from its container so the
// same SVG works on a colored pill (white text → white strokes) and a plain
// button (slate text → slate strokes).

export function CheckContinueIcon({ size = 16, color = 'currentColor' }) {
  const w = size;
  const h = Math.round(size * (18 / 16));
  return (
    <svg width={w} height={h} viewBox="0 0 16 18" fill="none" aria-hidden="true">
      {/* node — rounded rectangle at top */}
      <rect x="3" y="1" width="10" height="5" rx="1.5"
            stroke={color} strokeWidth="1.5" fill="none" />
      {/* vertical line out the bottom of the node */}
      <path d="M8 6 L8 14"
            stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {/* arrowhead */}
      <path d="M5 11 L8 14.5 L11 11"
            stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function CheckBranchIcon({ size = 22, color = 'currentColor' }) {
  const w = size;
  const h = Math.round(size * (18 / 22));
  return (
    <svg width={w} height={h} viewBox="0 0 22 18" fill="none" aria-hidden="true">
      {/* node — rounded rectangle, centered at top */}
      <rect x="7" y="1" width="8" height="5" rx="1.5"
            stroke={color} strokeWidth="1.5" fill="none" />
      {/* left exit: out the left side, then turn 90° and go straight down */}
      <path d="M7 3.5 L3 3.5 L3 14"
            stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* right exit: out the right side, then turn 90° and go straight down */}
      <path d="M15 3.5 L19 3.5 L19 14"
            stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* left arrowhead */}
      <path d="M0.5 11 L3 14.5 L5.5 11"
            stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* right arrowhead */}
      <path d="M16.5 11 L19 14.5 L21.5 11"
            stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
