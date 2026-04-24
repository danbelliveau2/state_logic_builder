/**
 * DeviceIcons - Mechanical SVG icons for each SDC device type.
 * Used throughout the app in place of emoji icons.
 */

// ── Pneumatic Linear Actuator (SMC MXX slide table style) ─────────────────────
function LinearActuatorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cylinder body */}
      <rect x="1" y="7" width="15" height="10" rx="1.5" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Port holes on top */}
      <line x1="5"  y1="7" x2="5"  y2="5" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="11" y1="7" x2="11" y2="5" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      {/* Piston rod */}
      <line x1="16" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Rod end (clevis) */}
      <circle cx="22" cy="12" r="1.5" stroke={color} strokeWidth="1.2" fill="none"/>
      {/* Extend arrow */}
      <path d="M19 9.5 L21.5 12 L19 14.5" stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

// ── Pneumatic Rotary Actuator ───────────────────────────────────────────────────
function RotaryActuatorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <rect x="3" y="5" width="18" height="14" rx="7" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Center shaft */}
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" fill="none"/>
      <circle cx="12" cy="12" r="1" fill={color}/>
      {/* CW rotation arrow */}
      <path d="M8 6.5 A5.8 5.8 0 0 1 16 6.5" stroke={color} strokeWidth="1.3" fill="none" strokeLinecap="round"/>
      <path d="M14 5.2 L16 6.5 L14.8 8.2" stroke={color} strokeWidth="1.3" strokeLinejoin="round" fill="none" strokeLinecap="round"/>
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

// ── Vacuum Generator (cup + venturi body) ─────────────────────────────────────
function VacuumIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Generator body */}
      <rect x="6" y="2" width="12" height="9" rx="1.5" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Port lines */}
      <line x1="3" y1="5"    x2="6"  y2="5"    stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="3" y1="8"    x2="6"  y2="8"    stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="18" y1="5.5" x2="21" y2="5.5"  stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      {/* Hose to cup */}
      <line x1="12" y1="11" x2="12" y2="14" stroke={color} strokeWidth="1.5"/>
      {/* Vacuum cup dome */}
      <path d="M6 14 Q6 20 12 20 Q18 20 18 14 Z" stroke={color} strokeWidth="1.5" fill="none"/>
      <line x1="6" y1="14" x2="18" y2="14" stroke={color} strokeWidth="1.5"/>
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

// ── Digital Sensor / PEC (cylinder body + beam) ───────────────────────────────
function SensorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Sensor housing */}
      <rect x="1" y="6" width="10" height="12" rx="2" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Lens */}
      <circle cx="6" cy="12" r="2.5" stroke={color} strokeWidth="1.2" fill="none"/>
      <circle cx="6" cy="12" r="1" fill={color}/>
      {/* Emission beam (dashed) */}
      <line x1="11" y1="12" x2="22" y2="12" stroke={color} strokeWidth="1.2"
            strokeDasharray="2 1.5" strokeLinecap="round"/>
      {/* Target reflector */}
      <circle cx="22" cy="12" r="1.8" stroke={color} strokeWidth="1.2" fill="none"/>
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

// ── Vision System (camera icon) ───────────────────────────────────────────────
function VisionSystemIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Camera body */}
      <rect x="2" y="6" width="20" height="13" rx="2" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Lens */}
      <circle cx="12" cy="13" r="4" stroke={color} strokeWidth="1.5" fill="none"/>
      <circle cx="12" cy="13" r="1.5" fill={color}/>
      {/* Flash/indicator */}
      <rect x="15" y="3" width="5" height="3" rx="1" stroke={color} strokeWidth="1.2" fill="none"/>
      {/* LED indicator */}
      <circle cx="5" cy="9" r="0.8" fill={color}/>
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

// ── Conveyor (belt with rollers) ────────────────────────────────────────────
function ConveyorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Belt top */}
      <line x1="5" y1="8" x2="19" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Belt bottom */}
      <line x1="5" y1="16" x2="19" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Left roller */}
      <circle cx="5" cy="12" r="4" stroke={color} strokeWidth="1.5" fill="none"/>
      <circle cx="5" cy="12" r="1.2" fill={color}/>
      {/* Right roller */}
      <circle cx="19" cy="12" r="4" stroke={color} strokeWidth="1.5" fill="none"/>
      <circle cx="19" cy="12" r="1.2" fill={color}/>
      {/* Direction arrow on belt */}
      <path d="M10 6 L13 6 L12 4.5 M13 6 L12 7.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

// ── Analog Sensor / Probe (gauge with needle) ───────────────────────────────
function AnalogSensorIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Gauge body (half circle) */}
      <path d="M3 16 A9 9 0 0 1 21 16" stroke={color} strokeWidth="1.5" fill="none"/>
      {/* Base line */}
      <line x1="3" y1="16" x2="21" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Scale marks */}
      <line x1="5"  y1="12.5" x2="6.2" y2="13.3" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <line x1="7"  y1="9.5"  x2="8"   y2="10.5" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <line x1="12" y1="7"    x2="12"   y2="8.2"  stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <line x1="17" y1="9.5"  x2="16"   y2="10.5" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <line x1="19" y1="12.5" x2="17.8" y2="13.3" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      {/* Needle */}
      <line x1="12" y1="15.5" x2="16" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* Center pivot */}
      <circle cx="12" cy="15.5" r="1.5" stroke={color} strokeWidth="1.2" fill="none"/>
      <circle cx="12" cy="15.5" r="0.6" fill={color}/>
      {/* Probe shaft below */}
      <line x1="12" y1="17.5" x2="12" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Probe tip */}
      <circle cx="12" cy="22" r="1" stroke={color} strokeWidth="1" fill={color}/>
    </svg>
  );
}

// ── Icon registry ─────────────────────────────────────────────────────────────

// ── Custom Device (wrench + gear) ─────────────────────────────────────────────
function CustomDeviceIcon({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Gear */}
      <circle cx="15" cy="9" r="3" stroke={color} strokeWidth="1.4" fill="none"/>
      <circle cx="15" cy="9" r="1.2" fill={color}/>
      {/* Gear teeth */}
      <line x1="15" y1="4.5" x2="15" y2="6" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="15" y1="12" x2="15" y2="13.5" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="10.5" y1="9" x2="12" y2="9" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="18" y1="9" x2="19.5" y2="9" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      {/* Wrench handle */}
      <line x1="3" y1="21" x2="10" y2="14" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      {/* Wrench head */}
      <path d="M10 14 L12 12 L11 11 L13 9" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
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
