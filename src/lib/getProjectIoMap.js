/**
 * getProjectIoMap.js — Single source of truth for the project's I/O list.
 *
 * Derives every input / output / internal tag the project will emit, by
 * walking each SM's devices and asking `getDeviceTags` (the same function
 * the L5X exporter uses for tag declarations). What you see here is what
 * gets emitted to Studio 5000 — they cannot diverge.
 *
 * Consumers:
 *   - I/O Map header popup (header chip in Toolbar)
 *   - I/O Map canvas tab (alongside Normal / Recovery)
 *   - UniversalPicker SUBJECT panel I/O toggle (Decision-mode raw I/O picks)
 *
 * All three views read this same function so picking, browsing, and the
 * generated L5X stay perfectly in sync.
 */

import { getDeviceTags } from './tagNaming.js';
import { DEVICE_TYPES } from './deviceTypes.js';

// ── I/O classification ────────────────────────────────────────────────────────
//
// Mirrors the classification in IOMapEditor — usage + dataType decide section.
//   digital* = boolean signals (BOOL)
//   analog*  = numeric signals (REAL / INT / DINT)
//   internal = neither input nor output (timers, parameters, etc.)

function classifyTag(tag) {
  const u = tag.usage;
  const dt = tag.dataType;
  if (u === 'Input'  && (dt === 'REAL' || dt === 'INT' || dt === 'DINT')) return 'analogInput';
  if (u === 'Input')                                                       return 'digitalInput';
  if (u === 'Output' && (dt === 'REAL' || dt === 'INT' || dt === 'DINT')) return 'analogOutput';
  if (u === 'Output')                                                      return 'digitalOutput';
  return 'internal';
}

export const IO_SECTION_ORDER = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput', 'internal'];

// Badges reflect what these tags ARE in the program — input or output
// PARAMETERS (i_* / q_*), not hardware DI/DO addresses. Hardware mapping
// happens via aliases in the I/O Map editor; the picker / popup show
// the program-scope tags the user actually reads + writes. Full words
// (per user feedback — "DO" sounded like a hardware DO, "Input"/"Output"
// reads as a parameter).
export const IO_SECTION_META = {
  digitalInput:  { label: 'Inputs',          abbr: 'Input',         color: '#5a9a48' },
  digitalOutput: { label: 'Outputs',         abbr: 'Output',        color: '#1574C4' },
  analogInput:   { label: 'Analog Inputs',   abbr: 'Analog Input',  color: '#0072B5' },
  analogOutput:  { label: 'Analog Outputs',  abbr: 'Analog Output', color: '#E8A317' },
  internal:      { label: 'Internal Tags',   abbr: 'Internal',      color: '#5a6a7e' },
};

/**
 * Build the project's I/O map.
 *
 * Returns:
 *   {
 *     bySection: { digitalInput: [...], digitalOutput: [...], ... },
 *     bySm:      [ { smId, smName, station, sections: { ... } }, ... ],
 *     flat:      [ ...all I/O entries, sorted by station+name ],
 *   }
 *
 * Each entry shape:
 *   {
 *     tagName:     string,   // e.g. "q_ExtendVerticalCylinder"
 *     dataType:    string,   // BOOL / REAL / DINT / etc.
 *     usage:       string,   // Input / Output / Local
 *     description: string,
 *     section:     string,   // digitalInput / digitalOutput / analogInput / analogOutput / internal
 *     deviceId:    string,
 *     deviceName:  string,
 *     deviceType:  string,
 *     smId:        string,
 *     smName:      string,
 *     station:     string,   // 'S01', 'S02', ...
 *   }
 */
export function getProjectIoMap(project) {
  const sms = project?.stateMachines ?? [];
  const sectionMap = {};
  for (const k of IO_SECTION_ORDER) sectionMap[k] = [];

  const bySm = [];

  for (const sm of sms) {
    const station   = `S${String(sm.stationNumber ?? 0).padStart(2, '0')}`;
    const smName    = sm.displayName ?? sm.name ?? '';
    const smSection = {};
    for (const k of IO_SECTION_ORDER) smSection[k] = [];

    // Skip auto-derived devices (verify, vision auto-spawned) and cross-SM
    // mirrors — they aren't part of THIS SM's I/O.
    const devices = (sm.devices ?? []).filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId);

    for (const device of devices) {
      const typeInfo = DEVICE_TYPES[device.type];
      const tags     = getDeviceTags(device, { stationNumber: sm.stationNumber });

      for (const tag of tags) {
        const section = classifyTag(tag);
        const entry = {
          tagName:     tag.name,
          dataType:    tag.dataType,
          usage:       tag.usage,
          description: tag.description,
          section,
          deviceId:    device.id,
          deviceName:  device.displayName ?? device.name,
          deviceType:  typeInfo?.label ?? device.type,
          smId:        sm.id,
          smName,
          station,
        };
        sectionMap[section].push(entry);
        smSection[section].push(entry);
      }
    }

    // Sort each SM section by tag name for stable display.
    for (const k of IO_SECTION_ORDER) smSection[k].sort((a, b) => a.tagName.localeCompare(b.tagName));
    bySm.push({ smId: sm.id, smName, station, sections: smSection });
  }

  // Sort top-level sections by station, then tag name — same ordering the
  // existing IOMapEditor uses, so visually consistent across views.
  for (const k of IO_SECTION_ORDER) {
    sectionMap[k].sort((a, b) => {
      if (a.station !== b.station) return a.station.localeCompare(b.station);
      return a.tagName.localeCompare(b.tagName);
    });
  }

  // Flat list — convenient for the picker's I/O toggle (no SM grouping).
  const flat = IO_SECTION_ORDER.flatMap(k => sectionMap[k]);

  return { bySection: sectionMap, bySm, flat };
}

/**
 * Filter helper for the picker's I/O toggle. Returns the flat list filtered
 * to just digital points (booleans) — the only ones meaningful for binary
 * decisions. Analog points need range checks, which the existing analog
 * sensor picker subject already covers.
 */
export function getDigitalIoPoints(project) {
  const { bySection } = getProjectIoMap(project);
  return [...bySection.digitalInput, ...bySection.digitalOutput];
}
