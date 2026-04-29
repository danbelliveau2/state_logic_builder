/**
 * IconAlternatives — preview-only icon comparison panel for the Design
 * System editor. NOT wired into the live `DeviceIcons.jsx` yet — when a
 * letter is finalised, the SVG gets ported into DeviceIcons.jsx by hand.
 *
 * Layout:
 *  · "Decided" row — compact, single icon per device that's been picked.
 *  · "Still deciding" rows — 3 options A/B/C side-by-side per device.
 */

const SW = 1.6;

// ── DECIDED — single confirmed icons ─────────────────────────────────────

// Linear Actuator — picked option B (ANSI cylinder w/ piston rod through rect).
const LinearActuatorPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6.5" width="14" height="11" stroke={color} strokeWidth={SW}/>
    <line x1="17" y1="12" x2="22" y2="12" stroke={color} strokeWidth={SW}/>
    <rect x="7.5" y="7.5" width="3" height="9" fill={color}/>
    <line x1="3" y1="12" x2="7.5" y2="12" stroke={color} strokeWidth={SW}/>
  </svg>
);

// Rotary Actuator — matches the real-world hardware:
//   • Rectangular body (housing)
//   • Rotating disk in the middle (the spinning part)
//   • Two air ports on the right side
//   • Big sweeping rotation arrow OVER the top of the body and ending
//     OUTSIDE to the right with a clear DOWN-pointing triangle tip.
const RotaryActuatorPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Body — sits in the LOWER portion so the arrow has clear space above */}
    <rect x="3" y="12" width="15" height="10" rx="0.5"
      stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12"/>

    {/* Air ports on the right side (top + bottom) */}
    <rect x="18" y="14" width="2.2" height="1.5" fill={color}/>
    <rect x="18" y="19" width="2.2" height="1.5" fill={color}/>

    {/* Rotating disk in the middle of the body */}
    <circle cx="10.5" cy="17" r="3" stroke={color} strokeWidth={SW} fill="#fff"/>
    <circle cx="10.5" cy="17" r="0.9" fill={color}/>

    {/* Big rotation arrow ENTIRELY ABOVE the body — clear gap to body top */}
    <path d="M 1 9 C 1 0, 21 0, 21 9"
      stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
    {/* Triangle tip stops at y=10.5 — body top is y=12, so 1.5 units of clean space */}
    <polygon points="21,10.5 19,9 23,9" fill={color}/>
  </svg>
);

// Vacuum Generator — body + 3 arrows representing airflow being sucked up.
// Each arrow has a THIN shaft (1.4 strokeWidth) and a BIG filled triangle
// tip (5 wide × 4 tall) — the head is ~3.5x wider than the shaft so the
// arrow reads unambiguously as an arrow even at small icon sizes.
const VacuumPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Body — flat top, gentle taper, narrow opening at bottom */}
    <path d="M 5 2 L 19 2 L 19 11 L 14 14 L 10 14 L 5 11 Z"
      stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12" strokeLinejoin="round"/>

    {/* LEFT — thin swoop from bottom-left, ending vertical, big triangle tip */}
    <path d="M 1 22 Q 7 21 7 18" stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
    <polygon points="7,14 4.5,18 9.5,18" fill={color}/>

    {/* MIDDLE — thin straight shaft, big triangle tip */}
    <line x1="12" y1="22" x2="12" y2="18" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    <polygon points="12,14 9.5,18 14.5,18" fill={color}/>

    {/* RIGHT — thin swoop mirror of left */}
    <path d="M 23 22 Q 17 21 17 18" stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
    <polygon points="17,14 14.5,18 19.5,18" fill={color}/>
  </svg>
);

// Conveyor — picked option A (with the bigger arrow above belt).
const ConveyorPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M3 6 L17 6" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M17 6 L13 3 M17 6 L13 9" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="5" cy="16" r="2.5" stroke={color} strokeWidth={SW}/>
    <circle cx="19" cy="16" r="2.5" stroke={color} strokeWidth={SW}/>
    <line x1="5" y1="13.5" x2="19" y2="13.5" stroke={color} strokeWidth={SW}/>
    <line x1="5" y1="18.5" x2="19" y2="18.5" stroke={color} strokeWidth={SW}/>
  </svg>
);

// Digital + Analog sensors share the SAME body shape. The difference:
//  · Digital → small ON/OFF indicator + TWO output arrows (binary)
//  · Analog  → numeric VALUE display + ONE output arrow
// Same family at-a-glance, distinct in role.
const SENSOR_BODY = (color) => (
  <rect x="2" y="5" width="11" height="14" rx="2" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12"/>
);

const DigitalSensorPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {SENSOR_BODY(color)}
    {/* Display showing binary state */}
    <rect x="3.2" y="7" width="8.6" height="6" rx="0.5" fill="#fff" stroke={color} strokeWidth="0.9"/>
    <text x="7.5" y="11.6" fontSize="4" fontWeight="700" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace">ON</text>
    {/* Two LEDs — one filled (active), one open (off) */}
    <circle cx="5" cy="16.5" r="0.9" fill={color}/>
    <circle cx="10" cy="16.5" r="0.9" stroke={color} strokeWidth="1" fill="#fff"/>
    {/* TWO output lines, top + bottom */}
    <line x1="13" y1="9" x2="22" y2="9" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M22 9 L19 7.5 M22 9 L19 10.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="13" y1="15" x2="22" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M22 15 L19 13.5 M22 15 L19 16.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const AnalogSensorPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {SENSOR_BODY(color)}
    {/* Display showing numeric value — same size/position as digital's "ON" */}
    <rect x="3.2" y="7" width="8.6" height="6" rx="0.5" fill="#fff" stroke={color} strokeWidth="0.9"/>
    <text x="7.5" y="11.6" fontSize="4" fontWeight="700" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace">12.4</text>
    {/* Bar-graph indicator below display */}
    <rect x="3.5" y="15.5" width="1.1" height="2" fill={color}/>
    <rect x="5.2" y="14.5" width="1.1" height="3" fill={color}/>
    <rect x="6.9" y="13.5" width="1.1" height="4" fill={color}/>
    <rect x="8.6" y="14.7" width="1.1" height="2.8" fill={color} opacity="0.4"/>
    {/* SINGLE output line carrying the value */}
    <line x1="13" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M22 12 L19 10 M22 12 L19 14" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Vision System — picked option C (square + lens + dotted FOV rays right).
const VisionSystemPick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6" width="11" height="12" rx="1" stroke={color} strokeWidth={SW}/>
    <circle cx="8.5" cy="12" r="2.5" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.2"/>
    <circle cx="8.5" cy="12" r="0.9" fill={color}/>
    <path d="M14 9 L22 5 M14 12 L22 12 M14 15 L22 19" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeDasharray="2 1.5"/>
  </svg>
);

// Custom Device — picked option B (wavy/scalloped rounded gear).
const CustomDevicePick = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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
      stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.18" strokeLinejoin="round"/>
    <circle cx="12" cy="12" r="3" stroke={color} strokeWidth={SW} fill="#fff"/>
    <circle cx="12" cy="12" r="1" fill={color}/>
  </svg>
);

const DECIDED = [
  { type: 'PneumaticLinearActuator', label: 'Linear Actuator (B)',  color: '#3b82f6', icon: LinearActuatorPick },
  { type: 'PneumaticRotaryActuator', label: 'Rotary Actuator (B refined)', color: '#6366f1', icon: RotaryActuatorPick },
  { type: 'PneumaticVacGenerator',   label: 'Vacuum Generator (A refined)', color: '#06b6d4', icon: VacuumPick },
  { type: 'Conveyor',                label: 'Conveyor (A)',          color: '#0891b2', icon: ConveyorPick },
  { type: 'DigitalSensor',           label: 'Digital Sensor (B)',    color: '#64748b', icon: DigitalSensorPick },
  { type: 'AnalogSensor',            label: 'Analog Sensor (C refined)', color: '#6366f1', icon: AnalogSensorPick },
  { type: 'VisionSystem',            label: 'Vision System (C)',     color: '#0891b2', icon: VisionSystemPick },
  { type: 'Custom',                  label: 'Custom Device (B)',     color: '#6b7280', icon: CustomDevicePick },
];

// ── STILL DECIDING — 3 options each, NEW iterations ───────────────────────

// ── Rotary Actuator ──
// User: "rectangle with the circle in the middle with an arrow that goes both ways."
const RotaryActuatorA = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6" width="18" height="12" rx="1" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.08"/>
    <circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth={SW} fill="#fff"/>
    <circle cx="12" cy="12" r="0.9" fill={color}/>
    {/* Bidirectional curved arrow above the shaft */}
    <path d="M8 9.5 A4.5 4.5 0 0 1 16 9.5" stroke={color} strokeWidth={SW} strokeLinecap="round" fill="none"/>
    <path d="M8 9.5 L7 7.7 M8 9.5 L9.6 8.2" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 9.5 L17 7.7 M16 9.5 L14.4 8.2" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const RotaryActuatorB = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="2" y="7" width="20" height="10" rx="1" stroke={color} strokeWidth={SW}/>
    <circle cx="12" cy="12" r="3.5" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12"/>
    {/* Horizontal bidirectional arrow inside the circle */}
    <line x1="9" y1="12" x2="15" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M9 12 L10.5 10.5 M9 12 L10.5 13.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 12 L13.5 10.5 M15 12 L13.5 13.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const RotaryActuatorC = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6" width="18" height="12" rx="1" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.08"/>
    <circle cx="12" cy="12" r="4" stroke={color} strokeWidth={SW} fill="#fff"/>
    {/* Two opposing curved arrows around shaft */}
    <path d="M9.5 9.5 A3.5 3.5 0 0 1 14.5 9.5" stroke={color} strokeWidth={SW} strokeLinecap="round" fill="none"/>
    <path d="M14.5 9.5 L15.5 8 M14.5 9.5 L13 8.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14.5 14.5 A3.5 3.5 0 0 1 9.5 14.5" stroke={color} strokeWidth={SW} strokeLinecap="round" fill="none"/>
    <path d="M9.5 14.5 L8.5 16 M9.5 14.5 L11 15.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── Vacuum Generator ──
// User: vertical body, hole at bottom, arrows going UP into the hole.
const VacuumA = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M7 3 L17 3 L17 14 L14 17 L10 17 L7 14 Z" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12" strokeLinejoin="round"/>
    {/* Three small arrows going up into the bottom opening */}
    <path d="M9 22 L9 18" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M9 18 L8 19 M9 18 L10 19" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 22 L12 18" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M12 18 L11 19 M12 18 L13 19" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 22 L15 18" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M15 18 L14 19 M15 18 L16 19" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const VacuumB = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="6" y="2.5" width="12" height="13" rx="1" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.1"/>
    {/* Stub / port at the bottom centre */}
    <rect x="10.5" y="15.5" width="3" height="3" stroke={color} strokeWidth={SW} fill="#fff"/>
    {/* Single bold up-arrow entering through the port */}
    <line x1="12" y1="22" x2="12" y2="18.5" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M12 18.5 L10 20.5 M12 18.5 L14 20.5" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const VacuumC = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Vertical body with V-cut funnel bottom */}
    <path d="M6 3 L18 3 L18 13 L12 18 L6 13 Z" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.1" strokeLinejoin="round"/>
    {/* Multiple small arrows converging into the V */}
    <path d="M8 22 L10 18.5" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M10 18.5 L8.7 18.5 M10 18.5 L10 19.8" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M12 22 L12 18.5" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M12 18.5 L11 19.5 M12 18.5 L13 19.5" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 22 L14 18.5" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M14 18.5 L15.3 18.5 M14 18.5 L14 19.8" stroke={color} strokeWidth={SW} strokeLinecap="round"/>
  </svg>
);

// ── Analog Sensor ──
// User: same body language as digital sensor (B), but with a numeric VALUE
// reading on it — captures "this thing reads a real value, not just on/off".
const AnalogSensorA = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="2" y="6" width="9" height="12" rx="1" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12"/>
    {/* Numeric display window */}
    <rect x="3.5" y="7.5" width="6" height="3.2" rx="0.4" stroke={color} strokeWidth="1" fill="#fff"/>
    <text x="6.5" y="10" fontSize="2.6" fontWeight="700" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace">3.5</text>
    <circle cx="6.5" cy="14" r="1.1" fill={color}/>
    {/* Signal output */}
    <line x1="11" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M22 12 L19 10 M22 12 L19 14" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const AnalogSensorB = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="2" y="6" width="9" height="12" rx="1" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12"/>
    {/* Bar-graph style level display */}
    <rect x="3.5" y="13.5" width="1.2" height="2.5" fill={color}/>
    <rect x="5.2" y="11.5" width="1.2" height="4.5" fill={color}/>
    <rect x="6.9" y="9.5" width="1.2" height="6.5" fill={color}/>
    <rect x="8.6" y="12" width="1.2" height="4" fill={color} opacity="0.4"/>
    {/* Output */}
    <line x1="11" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M22 12 L19 10 M22 12 L19 14" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const AnalogSensorC = ({ color, size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="2" y="7" width="10" height="10" rx="2" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.12"/>
    {/* LCD readout */}
    <rect x="3.2" y="8.5" width="7.6" height="3.5" rx="0.3" fill="#fff" stroke={color} strokeWidth="0.8"/>
    <text x="7" y="11.2" fontSize="2.6" fontWeight="700" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace">12.4</text>
    {/* Status LEDs */}
    <circle cx="4.5" cy="14.5" r="0.7" fill={color}/>
    <circle cx="6.5" cy="14.5" r="0.7" fill={color} opacity="0.3"/>
    <circle cx="8.5" cy="14.5" r="0.7" fill={color} opacity="0.3"/>
    <line x1="12" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M22 12 L19 10 M22 12 L19 14" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── Custom Device ──
// User: "more rounded gear".
const CustomDeviceA = ({ color, size = 32 }) => (
  // Sunflower-style: round body with circular bumps as teeth.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="3.5"  r="1.8" fill={color}/>
    <circle cx="18"   cy="6"    r="1.8" fill={color}/>
    <circle cx="20.5" cy="12"   r="1.8" fill={color}/>
    <circle cx="18"   cy="18"   r="1.8" fill={color}/>
    <circle cx="12"   cy="20.5" r="1.8" fill={color}/>
    <circle cx="6"    cy="18"   r="1.8" fill={color}/>
    <circle cx="3.5"  cy="12"   r="1.8" fill={color}/>
    <circle cx="6"    cy="6"    r="1.8" fill={color}/>
    <circle cx="12" cy="12" r="6" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.18"/>
    <circle cx="12" cy="12" r="2" stroke={color} strokeWidth={SW} fill="#fff"/>
  </svg>
);
const CustomDeviceB = ({ color, size = 32 }) => (
  // Wavy/scalloped gear silhouette using cubic curves — fully rounded teeth.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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
      stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.18" strokeLinejoin="round"/>
    <circle cx="12" cy="12" r="3" stroke={color} strokeWidth={SW} fill="#fff"/>
    <circle cx="12" cy="12" r="1" fill={color}/>
  </svg>
);
const CustomDeviceC = ({ color, size = 32 }) => (
  // Two interlocking sunflower gears.
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Big gear */}
    <circle cx="9" cy="13" r="1.3" fill={color}/>
    <circle cx="9" cy="6.5" r="1.3" fill={color}/>
    <circle cx="13.7" cy="8.3" r="1.3" fill={color}/>
    <circle cx="13.7" cy="17.7" r="1.3" fill={color}/>
    <circle cx="9" cy="19.5" r="1.3" fill={color}/>
    <circle cx="4.3" cy="17.7" r="1.3" fill={color}/>
    <circle cx="2.5" cy="13" r="1.3" fill={color}/>
    <circle cx="4.3" cy="8.3" r="1.3" fill={color}/>
    <circle cx="9" cy="13" r="4.5" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.18"/>
    <circle cx="9" cy="13" r="1.4" fill="#fff" stroke={color} strokeWidth="1"/>
    {/* Small gear */}
    <circle cx="17.5" cy="6.5" r="0.9" fill={color}/>
    <circle cx="20" cy="8" r="0.9" fill={color}/>
    <circle cx="20" cy="11" r="0.9" fill={color}/>
    <circle cx="17.5" cy="12.5" r="0.9" fill={color}/>
    <circle cx="15" cy="11" r="0.9" fill={color}/>
    <circle cx="15" cy="8" r="0.9" fill={color}/>
    <circle cx="17.5" cy="9.5" r="2.7" stroke={color} strokeWidth={SW} fill={color} fillOpacity="0.18"/>
    <circle cx="17.5" cy="9.5" r="0.9" fill="#fff" stroke={color} strokeWidth="0.7"/>
  </svg>
);

// ── Catalog ──────────────────────────────────────────────────────────────
// Empty — every device type has a pick. If you want to iterate again,
// re-add an entry here with options A/B/C and the panel will show it.
export const ICON_ALTERNATIVES = [];

// ── Preview Panel ────────────────────────────────────────────────────────
export function IconAlternativesPreview() {
  return (
    <div style={{ padding: 8 }}>
      <div style={{
        fontSize: 12, color: '#475569', marginBottom: 14, lineHeight: 1.5,
      }}>
        Compare 3 options per device, pick a letter. Picked icons are shown
        in the "Decided" row below — that's what'll get wired into
        <code> DeviceIcons.jsx</code> when finalised.
      </div>

      {/* Decided */}
      <div style={{
        marginBottom: 18, padding: 8,
        background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#065f46',
          letterSpacing: '0.04em', textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          ✓ Decided
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
        }}>
          {DECIDED.map(d => (
            <div key={d.type} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px',
              background: '#fff', border: '1px solid #d1fae5',
              borderRadius: 4,
            }}>
              <d.icon color={d.color} size={28} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#065f46' }}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Still deciding — hidden when nothing's left to decide */}
      {ICON_ALTERNATIVES.length > 0 && (<>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#7c2d12',
        letterSpacing: '0.04em', textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        Still deciding
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ICON_ALTERNATIVES.map(entry => (
          <div key={entry.type} style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 1fr 1fr',
            gap: 10,
            alignItems: 'center',
            padding: 8,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
              {entry.label}
            </div>
            {(['A', 'B', 'C']).map(letter => {
              const Icon = entry.options[letter];
              return (
                <div key={letter} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: 8,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 4,
                }}>
                  <Icon color={entry.color} size={40} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#475569',
                    letterSpacing: '0.05em',
                  }}>
                    Option {letter}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </>)}
    </div>
  );
}
