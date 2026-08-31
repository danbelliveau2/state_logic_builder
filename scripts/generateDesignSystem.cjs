/**
 * Generate SDC State Logic Builder — Design System Reference (.xlsx)
 *
 * Run: node scripts/generateDesignSystem.cjs
 * Output: Design_System_Reference.xlsx in project root
 */
const XLSX = require('xlsx');
const path = require('path');

// ─── Helper: create sheet from array-of-arrays with header row ───────────────
function makeSheet(headers, rows, colWidths) {
  const data = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: COLOR PALETTE
// ═══════════════════════════════════════════════════════════════════════════════
const colorHeaders = ['Category', 'Name', 'Hex Value', 'CSS Variable', 'Used For', 'File(s)'];
const colorRows = [
  // Brand / Primary
  ['Brand – Primary', 'SDC Blue', '#1574C4', '--color-primary', 'Primary buttons, toolbar bg, active tabs, links, station badges', 'index.css, IOMapEditor, Toolbar'],
  ['Brand – Primary', 'SDC Blue Hover', '#1264a8', '--color-primary-h', 'Hover state for primary blue elements, dark borders', 'index.css'],
  ['Brand – Primary', 'SDC Medium Blue', '#0072B5', '', 'Decision node Wait mode, selected edges, deep blue accents', 'DecisionNode, Canvas, RoutableEdge'],
  ['Brand – Primary', 'SDC Dark Navy', '#061d39', '', 'Grand total bars, servo category, very dark backgrounds', 'IOMapEditor, index.css'],
  ['Brand – Primary', 'SDC Light Blue', '#aacee8', '', 'Retract/passive operation badges, light accents, DO grand total', 'StateNode, IOMapEditor'],
  ['Brand – Primary', 'SDC Very Dark Blue', '#005a91', '', 'Decision node Wait mode border', 'DecisionNode'],
  ['Brand – Primary', 'SDC Navy', '#1e3a5f', '', 'Gradient dark end, state signal badge bg', 'PropertiesPanel, StateNode'],
  ['', '', '', '', '', ''],

  // Status
  ['Status', 'Success Green', '#5a9a48', '--color-success', 'Initial/complete nodes, "If Good" entry rule, DI color', 'index.css, Canvas, StateNode, IOMapEditor'],
  ['Status', 'Danger Red', '#b83c3c', '--color-danger', 'Delete buttons, danger actions, retry badge', 'index.css, Toolbar'],
  ['Status', 'Warning Amber', '#c9a643', '--color-warning', 'Warning indicators', 'index.css'],
  ['Status', 'Verify Amber', '#E8A317', '', 'Decision node Verify mode, vision category, AO color', 'DecisionNode, IOMapEditor'],
  ['Status', 'Verify Amber Border', '#b87d0f', '', 'Decision node Verify mode border', 'DecisionNode'],
  ['', '', '', '', '', ''],

  // Edge Colors
  ['Edge', 'Pass Green', '#16a34a', '', 'Pass/true branch edges and labels', 'Canvas, RoutableEdge'],
  ['Edge', 'Fail Red', '#dc2626', '', 'Fail/false branch edges and labels, fault nodes', 'Canvas, RoutableEdge, StateNode'],
  ['Edge', 'Retry Amber', '#f59e0b', '', 'Retry branch edges and labels', 'RoutableEdge, DecisionNode'],
  ['Edge', 'Selected Blue', '#0072B5', '', 'Currently selected edge highlight', 'Canvas, RoutableEdge'],
  ['Edge', 'Default Gray', '#6b7280', '', 'Unselected/normal edge stroke', 'Canvas, RoutableEdge'],
  ['', '', '', '', '', ''],

  // Decision Node Modes
  ['Decision Node', 'Wait Mode Fill', '#0072B5', '', 'Decision node in Wait mode (blue)', 'DecisionNode'],
  ['Decision Node', 'Wait Mode Border', '#005a91', '', 'Border for Wait mode', 'DecisionNode'],
  ['Decision Node', 'Decide Mode Fill', '#7c3aed', '', 'Decision node in Decide mode (purple)', 'DecisionNode'],
  ['Decision Node', 'Decide Mode Border', '#6d28d9', '', 'Border for Decide mode', 'DecisionNode'],
  ['Decision Node', 'Verify Mode Fill', '#E8A317', '', 'Decision node in Verify mode (amber)', 'DecisionNode'],
  ['Decision Node', 'Verify Mode Border', '#b87d0f', '', 'Border for Verify mode', 'DecisionNode'],
  ['', '', '', '', '', ''],

  // Text Colors
  ['Text', 'Primary Text', '#231f20', '--color-text', 'Main body text, headings', 'index.css'],
  ['Text', 'Muted Text', '#5a6a7e', '--color-text-muted', 'Secondary text, labels, descriptions', 'index.css'],
  ['Text', 'Light Text', '#8896a8', '--color-text-light', 'Tertiary text, placeholders, hints', 'index.css'],
  ['Text', 'Dark Theme Text', '#f1f5f9', '', 'Text on dark backgrounds (toolbar, dark panels)', 'Toolbar'],
  ['Text', 'Dark Theme Muted', '#94a3b8', '', 'Muted text on dark backgrounds', 'DecisionNode, Toolbar'],
  ['', '', '', '', '', ''],

  // Backgrounds
  ['Background', 'App Background', '#f0f2f5', '--color-bg', 'Main app canvas background', 'index.css'],
  ['Background', 'Surface White', '#ffffff', '--color-surface', 'Panels, modals, cards, inputs', 'index.css'],
  ['Background', 'Sidebar', '#f8fafc', '--color-sidebar', 'Left device sidebar, section bg, totals row', 'index.css'],
  ['Background', 'Border', '#e2e8f0', '--color-border', 'All standard borders, dividers, table borders', 'index.css'],
  ['Background', 'Row Hover', '#f0f2f5', '', 'Table row hover, input hover backgrounds', 'index.css'],
  ['Background', 'Code Tag BG', '#f0f2f5', '', 'Inline code/tag name backgrounds', 'index.css'],
  ['', '', '', '', '', ''],

  // IO Map Colors
  ['IO Map', 'Digital Input (DI)', '#5a9a48', '', 'DI count badges, section headers, grand total', 'IOMapEditor'],
  ['IO Map', 'Digital Output (DO)', '#1574C4', '', 'DO count badges, section headers, grand total', 'IOMapEditor'],
  ['IO Map', 'Analog Input (AI)', '#0072B5', '', 'AI count badges, section headers, grand total', 'IOMapEditor'],
  ['IO Map', 'Analog Output (AO)', '#E8A317', '', 'AO count badges, section headers, grand total', 'IOMapEditor'],
  ['IO Map', 'Internal Tags', '#5a6a7e', '', 'Internal tag section header', 'IOMapEditor'],
  ['IO Map', 'Grand Total Bar', '#061d39', '', 'Dark navy background for grand total bar', 'IOMapEditor'],
  ['IO Map', 'Grand Total Label', '#aacee8', '', 'Light blue label text in grand total bar', 'IOMapEditor'],
  ['', '', '', '', '', ''],

  // IO Map Category Colors
  ['IO Category', 'Pneumatic', '#1574C4', '', 'Pneumatic device category header', 'IOMapEditor'],
  ['IO Category', 'Servo', '#061d39', '', 'Servo axis category header', 'IOMapEditor'],
  ['IO Category', 'Robot', '#1264a8', '', 'Robot category header', 'IOMapEditor'],
  ['IO Category', 'Conveyor', '#0072B5', '', 'Conveyor category header', 'IOMapEditor'],
  ['IO Category', 'Vision', '#E8A317', '', 'Vision system category header', 'IOMapEditor'],
  ['IO Category', 'Sensor', '#5a6a7e', '', 'Sensor category header', 'IOMapEditor'],
  ['IO Category', 'Logic', '#8896a8', '', 'Timer/Parameter category header', 'IOMapEditor'],
  ['IO Category', 'Custom', '#5a6a7e', '', 'Custom device category header', 'IOMapEditor'],
  ['', '', '', '', '', ''],

  // Station Type Colors
  ['Station Type', 'Load', '#1574C4', '', 'Load station badge/pill', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Process', '#7B2D8E', '', 'Process station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Verify', '#E8A317', '', 'Verify station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Reject', '#DC2626', '', 'Reject station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Unload', '#5BB0D8', '', 'Unload station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Indexer', '#0d9488', '', 'Indexer station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Feed', '#ca8a04', '', 'Feed station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Robot', '#9333ea', '', 'Robot station badge', 'Toolbar, MachineConfigEditor'],
  ['Station Type', 'Empty', '#94a3b8', '', 'Empty station badge', 'Toolbar, MachineConfigEditor'],
  ['', '', '', '', '', ''],

  // Condition Logic Colors
  ['Logic', 'ON / TRUE / AND', '#16a34a', '', 'Boolean ON condition toggle, AND logic button', 'DecisionNode'],
  ['Logic', 'OFF / FALSE', '#dc2626', '', 'Boolean OFF condition toggle', 'DecisionNode'],
  ['Logic', 'OR Logic', '#2563eb', '', 'OR logic button in multi-condition', 'DecisionNode'],
  ['', '', '', '', '', ''],

  // Vision Outcome Colors
  ['Vision Outcome', 'Pass (Primary)', '#74c415', '', 'Vision pass outcome color', 'outcomeColors.js, StateNode'],
  ['Vision Outcome', 'Fail (Primary)', '#fa5650', '', 'Vision fail outcome color', 'outcomeColors.js, StateNode'],
  ['Vision Outcome', 'Outcome 3', '#5a9a48', '', 'Third vision outcome', 'outcomeColors.js'],
  ['Vision Outcome', 'Outcome 4', '#7b70a0', '', 'Fourth vision outcome', 'outcomeColors.js'],
  ['Vision Outcome', 'Outcome 5', '#b83c3c', '', 'Fifth vision outcome', 'outcomeColors.js'],
  ['Vision Outcome', 'Outcome 6', '#4a98a8', '', 'Sixth vision outcome', 'outcomeColors.js'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: DEVICE ICONS
// ═══════════════════════════════════════════════════════════════════════════════
const iconHeaders = ['Device Type Key', 'Display Label', 'Icon Component', 'Default Color', 'SVG Description', 'Stroke Width'];
const iconRows = [
  ['PneumaticLinearActuator', 'Linear Actuator', 'LinearActuatorIcon', '#3b82f6', 'Cylinder body rect + rod line + clevis circle', '1.5'],
  ['PneumaticRotaryActuator', 'Rotary Actuator', 'RotaryActuatorIcon', '#6366f1', 'Rounded rect body + center circle + clockwise arrow arc', '1.5'],
  ['PneumaticGripper', 'Gripper', 'GripperIcon', '#8b5cf6', 'Body block + dual jaw arms + jaw finger rects', '1.5'],
  ['PneumaticVacGenerator', 'Vacuum Generator', 'VacuumIcon', '#06b6d4', 'Generator body + port lines + dome cup shape', '1.5'],
  ['ServoAxis', 'Servo Axis', 'ServoIcon', '#f59e0b', 'Motor body rect + stator circle + encoder block + shaft line', '1.5'],
  ['Robot', 'Robot', 'RobotIcon', '#7c3aed', 'Base + 3 joint circles + arm segments + end-effector', '1.5'],
  ['Conveyor', 'Conveyor', 'ConveyorIcon', '#0891b2', 'Belt top/bottom lines + dual roller circles + direction arrow', '1.5'],
  ['Timer', 'Timer', 'TimerIcon', '#9ca3af', 'Clock face circle + hour/min hands + center dot', '1.5'],
  ['DigitalSensor', 'Digital Sensor', 'SensorIcon', '#64748b', 'Housing rect + lens circle + dashed beam line + reflector', '1.5'],
  ['AnalogSensor', 'Analog Sensor', 'AnalogSensorIcon', '#6366f1', 'Gauge arc + scale tick marks + needle + probe shaft', '1.5'],
  ['Parameter', 'Parameter', 'ParameterIcon', '#f97316', 'Tag shape polygon + hole circle + "p" letter', '1.5'],
  ['VisionSystem', 'Vision System', 'VisionSystemIcon', '#0891b2', 'Camera body rect + lens circle + flash line + LED dot', '1.5'],
  ['Custom', 'Custom Device', 'CustomDeviceIcon', '#6b7280', 'Gear circle + wrench handle line + head', '1.5'],
  ['(unknown)', 'Fallback', '(none)', '#9ca3af', 'Rectangle with "?" text', '1.5'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: NODE SHAPES
// ═══════════════════════════════════════════════════════════════════════════════
const shapeHeaders = ['Node Type', 'Shape Name', 'CSS Class', 'Width', 'Min Height', 'Border Radius', 'Border Width', 'Corner Inset (SVG)', 'Notes'];
const shapeRows = [
  ['StateNode (default)', 'Rounded Rectangle', '.state-node', '240–340px', '80px', '10px (--radius-lg)', '2px', 'N/A', 'Default when no device assigned'],
  ['StateNode (Linear Actuator)', 'Rectangle', '.state-node--rect', '240–340px', '80px', '0 (polygon)', '2px', '14px', 'Sharp corners via SVG polygon'],
  ['StateNode (Rotary Actuator)', 'Pentagon', '.state-node--pentagon', '240–340px', '80px', '0 (polygon)', '2px', '14px', '5-sided SVG polygon'],
  ['StateNode (Gripper)', 'Hexagon', '.state-node--hexagon', '240–340px', '80px', '0 (polygon)', '2px', '14px', '6-sided SVG polygon'],
  ['StateNode (Vacuum)', 'Octagon', '.state-node--octagon', '240–340px', '80px', '0 (polygon)', '2px', '14px', '8-sided SVG polygon'],
  ['StateNode (Servo)', 'Decagon', '.state-node--decagon', '240–340px', '80px', '0 (polygon)', '2px', '14px', '10-sided SVG polygon'],
  ['StateNode (Timer)', 'Dodecagon', '.state-node--dodecagon', '240–340px', '80px', '0 (polygon)', '2px', '14px', '12-sided SVG polygon'],
  ['StateNode (Sensor)', '14-Sided Polygon', '.state-node--poly14', '240–340px', '80px', '0 (polygon)', '2px', '14px', '14-sided, nearly circular'],
  ['StateNode (Parameter)', 'Pill / Oval', '.state-node--pill', '240–340px', '80px', '50vh', '2px', 'N/A', 'Fully rounded ends'],
  ['StateNode (Vision)', 'Rectangle', '.state-node--rect', '240–340px', '80px', '0 (polygon)', '2px', '14px', 'Same as linear actuator shape'],
  ['StateNode (CheckResults 2+)', '16-Sided Polygon', '.state-node--poly16', '240–340px', '80px', '0 (polygon)', '2px', '14px', 'Near-circle for multi-outcome'],
  ['StateNode (Initial)', 'Same as device shape', '.state-node--initial', '240–340px', '80px', 'varies', '2.5px', 'varies', 'Thicker border, green #5a9a48'],
  ['StateNode (Complete)', 'Same as device shape', '.state-node--complete', '240–340px', '80px', 'varies', '2.5px', 'varies', 'Thicker border, green #5a9a48'],
  ['StateNode (Fault)', 'Same as device shape', '.state-node--fault', '240–340px', '80px', 'varies', '2px', 'varies', 'Red #dc2626 accent'],
  ['DecisionNode', 'Rounded Rectangle', '(inline)', '240px (fixed)', 'auto (min ~64px)', '10px', '2px', 'N/A', 'Color varies by mode: blue/purple/amber'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: OPERATION COLORS
// ═══════════════════════════════════════════════════════════════════════════════
const opHeaders = ['Operation', 'Color Hex', 'Category', 'Light BG?', 'Used For'];
const opRows = [
  ['Extend', '#1574c4', 'Active (SDC Blue)', 'No', 'Pneumatic cylinder extend'],
  ['Engage', '#1574c4', 'Active (SDC Blue)', 'No', 'Gripper engage'],
  ['VacOn', '#1574c4', 'Active (SDC Blue)', 'No', 'Vacuum generator on'],
  ['SetOn', '#1574c4', 'Active (SDC Blue)', 'No', 'Digital output set on'],
  ['WaitOn', '#1574c4', 'Active (SDC Blue)', 'No', 'Wait for condition on'],
  ['ServoMove', '#1574c4', 'Active (SDC Blue)', 'No', 'Servo move to position'],
  ['', '', '', '', ''],
  ['Retract', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Pneumatic cylinder retract'],
  ['Disengage', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Gripper disengage'],
  ['VacOff', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Vacuum generator off'],
  ['SetOff', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Digital output set off'],
  ['WaitOff', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Wait for condition off'],
  ['ServoIndex', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Servo index motion'],
  ['VacOnEject', '#aacee8', 'Passive (SDC Light Blue)', 'Yes (dark text)', 'Vacuum eject pulse'],
  ['', '', '', '', ''],
  ['SetValue', '#befa4f', 'Parameter (Lime)', 'Yes (dark text)', 'Set parameter value'],
  ['ServoIncr', '#befa4f', 'Parameter (Lime)', 'Yes (dark text)', 'Servo incremental move'],
  ['', '', '', '', ''],
  ['VerifyValue', '#d9d9d9', 'Sensor (Light Gray)', 'Yes (dark text)', 'Verify sensor value'],
  ['Check', '#d9d9d9', 'Sensor (Light Gray)', 'Yes (dark text)', 'Check sensor state'],
  ['', '', '', '', ''],
  ['Inspect', '#ffde51', 'Vision (Yellow)', 'Yes (dark text)', 'Vision inspection action'],
  ['VisionInspect', '#ffde51', 'Vision (Yellow)', 'Yes (dark text)', 'Vision inspection action (full)'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5: HANDLES (connection points)
// ═══════════════════════════════════════════════════════════════════════════════
const handleHeaders = ['Handle Type', 'Handle ID', 'Position', 'Color', 'CSS Class', 'Dot Size', 'Hit Zone', 'Hover Size', 'Notes'];
const handleRows = [
  ['Target (input)', 'null (no id)', 'Top center', '#64748b (gray)', '.sdc-handle', '10px', '18px', 'No grow', 'StateNode target; no id prop on Handle'],
  ['Decision Input', '"input"', 'Top center', '#64748b (gray)', '.sdc-handle', '10px', '18px', 'No grow', 'DecisionNode target; id="input"'],
  ['Source (default)', 'null (no id)', 'Bottom center', '#64748b (gray)', '.sdc-handle', '10px', '30px', '18px', 'Default source handle for StateNode'],
  ['Pass Exit', '"exit-pass"', 'Bottom-left', '#5a9a48 (green)', '.sdc-handle--pass', '10px', '30px', '18px', 'Pass/true branch exit'],
  ['Fail Exit', '"exit-fail"', 'Bottom-right', '#ef4444 (red)', '.sdc-handle--fail', '10px', '30px', '18px', 'Fail/false branch exit'],
  ['Single Exit', '"exit-single"', 'Bottom center', '#6b7280 (gray)', '.sdc-handle', '10px', '30px', '18px', 'Single-exit decision branch'],
  ['Retry Exit', '"exit-retry"', 'Right side', '#f59e0b (amber)', '.sdc-handle--retry', '10px', '30px', '18px', 'Retry branch (when enabled)'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6: TYPOGRAPHY
// ═══════════════════════════════════════════════════════════════════════════════
const typoHeaders = ['Property', 'Value', 'Where Used', 'Notes'];
const typoRows = [
  ['Font Family (primary)', "Montserrat, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif", 'Entire app (:root)', 'All UI text'],
  ['Font Family (code)', "Consolas, Menlo, Monaco, monospace", '.mono class, tag names, code displays', 'PLC tags, code snippets'],
  ['', '', '', ''],
  ['Font Size — Base', '14px', ':root', 'Default body text size'],
  ['Font Size — XS', '8px', 'Footnotes, fine-print metadata', 'Smallest text in app'],
  ['Font Size — SM', '9–10px', 'Badges, small labels, state numbers', 'Status pills, counts'],
  ['Font Size — Body Secondary', '11–12px', 'Form labels, table cells, descriptions', 'Most common secondary size'],
  ['Font Size — Body', '13–14px', 'Body text, buttons, menu items', 'Primary readable text'],
  ['Font Size — Heading SM', '15–16px', 'Section headings, toolbar title', 'Small headings'],
  ['Font Size — Heading MD', '18–20px', 'Modal titles, major sections', 'Medium headings'],
  ['Font Size — Heading LG', '22–24px', 'Changelog version, large titles', 'Large headings'],
  ['Font Size — Logo', '28px', 'Toolbar logo', 'Largest text in toolbar'],
  ['', '', '', ''],
  ['Font Weight — Normal', '400', 'Body text', 'Default readable text'],
  ['Font Weight — Medium', '500', 'Inputs, secondary buttons', 'Subtle emphasis'],
  ['Font Weight — Semibold', '600', 'Labels, toolbar names, badges, section headers', 'Common for labels'],
  ['Font Weight — Bold', '700', 'Headings, important labels, primary buttons', 'Strong emphasis'],
  ['Font Weight — Extra Bold', '800', 'Major headings, state counters, IO counts', 'Maximum emphasis'],
  ['', '', '', ''],
  ['Letter Spacing — Tight', '0.02em', 'Subtle body text', 'Barely noticeable'],
  ['Letter Spacing — Normal', '0.04–0.05em', 'Section titles, sidebar labels', 'Standard for uppercase'],
  ['Letter Spacing — Wide', '0.06em', 'Table headers, operation labels', 'Uppercase labels'],
  ['Letter Spacing — Extra Wide', '0.7–0.8px', 'Small uppercase text, badges', 'Maximum tracking'],
  ['', '', '', ''],
  ['Line Height — Tight', '1.0', 'Badges, icon labels, compact pills', 'No extra spacing'],
  ['Line Height — Compact', '1.2–1.3', 'Form inputs, table rows, tooltips', 'Slightly compact'],
  ['Line Height — Normal', '1.4', 'Secondary text, popups', 'Comfortable reading'],
  ['Line Height — Relaxed', '1.5', ':root default', 'Base line height for app'],
  ['', '', '', ''],
  ['Text Transform', 'uppercase', 'Section headers, badge labels, column headers, metadata', 'Always paired with letter-spacing 0.05em+'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 7: SPACING & LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════
const spacingHeaders = ['Property', 'Value', 'Where Used', 'Notes'];
const spacingRows = [
  ['-- LAYOUT DIMENSIONS --', '', '', ''],
  ['Toolbar Height', '52px', '.toolbar', 'Main navigation bar'],
  ['Sidebar Width', '220px', '.device-sidebar', 'Left device panel'],
  ['Properties Panel Width', '280px', '.properties-panel', 'Right context panel'],
  ['Node Width (StateNode)', '240–340px', 'StateNode', 'min-width: 240, max-width: 340'],
  ['Node Width (DecisionNode)', '240px', 'DecisionNode', 'Fixed width constant NODE_WIDTH'],
  ['Node Min Height', '80px', 'StateNode', 'Pill/rounded variants'],
  ['', '', '', ''],
  ['-- BORDER RADIUS --', '', '', ''],
  ['Radius — Small', '3px', 'Small buttons, icons, badges', 'Tight rounding'],
  ['Radius — Default', '6px (--radius)', 'Cards, modals, standard buttons', 'Standard rounding'],
  ['Radius — Large', '10px (--radius-lg)', 'Nodes, large modals, major components', 'Generous rounding'],
  ['Radius — Pill', '50vh', 'Pill-shaped nodes, fully round badges', 'Full roundover'],
  ['Radius — Circle', '50%', 'Avatars, circular icons, dots', 'Perfect circle'],
  ['', '', '', ''],
  ['-- SHADOWS --', '', '', ''],
  ['Shadow — Small', '0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)', '--shadow-sm', 'Subtle lift'],
  ['Shadow — Medium', '0 4px 6px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.05)', '--shadow', 'Cards, panels'],
  ['Shadow — Large', '0 10px 24px rgba(0,0,0,.12)', '--shadow-lg', 'Modals, elevated elements'],
  ['Shadow — Popup', '0 8px 32px rgba(0,0,0,0.18)', '(inline)', 'Decision popup, dropdowns'],
  ['Shadow — Focus Ring', '0 0 0 3px #0072b566', '(inline)', 'Keyboard focus indicators'],
  ['', '', '', ''],
  ['-- GAP / SPACING --', '', '', ''],
  ['Gap — Tight', '2–3px', 'Icon + label, tight flex rows', 'Minimal spacing'],
  ['Gap — Compact', '4px', 'Badge internals, small controls', 'Most common tight gap'],
  ['Gap — Standard', '6–8px', 'Button rows, form groups, menu items', 'Default comfortable gap'],
  ['Gap — Large', '10–12px', 'Toolbar items, section separation', 'Roomy spacing'],
  ['Gap — XL', '16–20px', 'Major layout gaps, panel padding', 'Maximum spacing'],
  ['', '', '', ''],
  ['-- PADDING --', '', '', ''],
  ['Padding — Micro', '2–4px', 'Badge internal, icon buttons', 'Tightest padding'],
  ['Padding — Small', '4px 8–10px', 'Small buttons, pills, menu items', 'Common button padding'],
  ['Padding — Medium', '6px 12px', 'Section headers, form controls, action rows', 'Standard component padding'],
  ['Padding — Large', '8px 12–16px', 'Modal headers, card bodies, panels', 'Generous internal padding'],
  ['Padding — XL', '14px 18px', 'Grand total bar, large headers', 'Maximum padding'],
  ['', '', '', ''],
  ['-- Z-INDEX LAYERS --', '', '', ''],
  ['z-index: 0–5', '', 'Canvas backgrounds, sidebar layers', 'Base layer'],
  ['z-index: 9–10', '', 'Node toolbars, local popovers', 'Component overlays'],
  ['z-index: 100', '', 'Dropdown menus', 'Flyout menus'],
  ['z-index: 1000', '', 'Modal dialogs', 'Global modals'],
  ['z-index: 9999–10000', '', 'Popup overlays, backdrops, operation switcher', 'Topmost layer'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 8: START CONDITIONS & ENTRY RULES
// ═══════════════════════════════════════════════════════════════════════════════
const condHeaders = ['Type', 'Value', 'Label', 'Short Label', 'Color', 'BG Color', 'Border', 'Default For Station Types', 'Description'];
const condRows = [
  ['Start Condition', 'afterIndex', 'After Index', 'After', '#1574c4', 'rgba(21,116,196,0.12)', '#1574c4', 'process, verify, reject, unload, robot (all except load/feed)', 'Wait for dial index complete before running'],
  ['Start Condition', 'midIndex', 'Mid Index', 'Mid', '#aacee8', 'rgba(170,206,232,0.2)', '#7bb3d4', '(none — user picks)', 'Start during index at specified angle/encoder position'],
  ['Start Condition', 'independent', 'Independent', 'Independent', '#64748b', 'rgba(100,116,139,0.12)', '#64748b', 'load, feed', 'Not tied to index — runs on own timing'],
  ['', '', '', '', '', '', '', '', ''],
  ['Entry Rule', 'ifGood', 'If Good Part', 'Good', '#5a9a48', 'rgba(90,154,72,0.12)', '#5a9a48', 'process, verify, unload, robot (default)', 'Run only if part is good'],
  ['Entry Rule', 'ifReject', 'If Rejected', 'Reject', '#dc2626', 'rgba(220,38,38,0.12)', '#dc2626', 'reject', 'Run only if part is rejected'],
  ['Entry Rule', 'always', 'Always', 'Always', '#64748b', 'rgba(100,116,139,0.12)', '#64748b', 'load, indexer, empty, feed', 'Run every cycle regardless'],
];

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD WORKBOOK
// ═══════════════════════════════════════════════════════════════════════════════
const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb, makeSheet(colorHeaders, colorRows, [18, 22, 12, 20, 65, 40]), 'Color Palette');
XLSX.utils.book_append_sheet(wb, makeSheet(iconHeaders, iconRows, [28, 18, 22, 12, 55, 12]), 'Device Icons');
XLSX.utils.book_append_sheet(wb, makeSheet(shapeHeaders, shapeRows, [28, 22, 22, 16, 14, 18, 14, 18, 45]), 'Node Shapes');
XLSX.utils.book_append_sheet(wb, makeSheet(opHeaders, opRows, [16, 12, 24, 14, 40]), 'Operation Colors');
XLSX.utils.book_append_sheet(wb, makeSheet(handleHeaders, handleRows, [16, 18, 16, 18, 18, 10, 10, 12, 40]), 'Handles');
XLSX.utils.book_append_sheet(wb, makeSheet(typoHeaders, typoRows, [28, 60, 45, 40]), 'Typography');
XLSX.utils.book_append_sheet(wb, makeSheet(spacingHeaders, spacingRows, [28, 55, 40, 40]), 'Spacing & Layout');
XLSX.utils.book_append_sheet(wb, makeSheet(condHeaders, condRows, [16, 14, 16, 12, 10, 28, 10, 50, 50]), 'Start Conditions');

const outPath = path.join(__dirname, '..', 'docs', 'Design_System_Reference.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`✅ Design System Reference written to: ${outPath}`);
