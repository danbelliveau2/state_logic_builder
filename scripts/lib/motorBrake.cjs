'use strict';
// Kinetix servo motor brake response times (Rockwell TLP and VPL brake specification tables; Jason, 2026-11-05).
// An axis whose motor has the brake option carries MechanicalBrakeReleaseDelay / MechanicalBrakeEngageDelay
// in seconds; MechanicalBrakeControl stays Automatic. Non-brake motors keep 0.0.
//
// TLP (frame)                                   release   engage
//   046 / 070 / 090 / 100 / 115                 40 ms     80 ms
//   145                                         50 ms     110 ms
//   200, rating <= 350                          60 ms     120 ms
//   200, rating >= 450                          100 ms    150 ms
//   235                                         150 ms    300 ms
// VPL (frame + stack)
//   0631 / 0632 / 0633                          38 ms     25 ms
//   0751 / 0752 / 0753                          66 ms     42 ms
//   1001 / 1002 / 1003                          90 ms     65 ms
//   1152 / 1153                                 90 ms     95 ms
//   1303 / 1304 / 1306                          125 ms    120 ms
//   1651 / 1652 / 1653 / 1654                   140 ms    120 ms
//
// Brake option in the catalog number: TLP-A070-040-DJA34A (option code position 5 = 4 brake, 2 none);
// VPL-B1306F-PJ14AA (option code position 4 = 4 brake, 2 none). Studio's motion database names a VPL motor
// VPL-B1306F-P with no option code, so the caller passes { brake: true } from the BOM when the name is short.

const TLP = [
  { frames: ['046', '070', '090', '100', '115'], release: 0.04, engage: 0.08 },
  { frames: ['145'], release: 0.05, engage: 0.11 },
  { frames: ['200'], maxRating: 350, release: 0.06, engage: 0.12 },
  { frames: ['200'], minRating: 450, release: 0.10, engage: 0.15 },
  { frames: ['235'], release: 0.15, engage: 0.30 },
];
const VPL = [
  { frames: ['0631', '0632', '0633'], release: 0.038, engage: 0.025 },
  { frames: ['0751', '0752', '0753'], release: 0.066, engage: 0.042 },
  { frames: ['1001', '1002', '1003'], release: 0.09, engage: 0.065 },
  { frames: ['1152', '1153'], release: 0.09, engage: 0.095 },
  { frames: ['1303', '1304', '1306'], release: 0.125, engage: 0.12 },
  { frames: ['1651', '1652', '1653', '1654'], release: 0.14, engage: 0.12 },
];

const rating = (s) => /K$/i.test(s) ? parseFloat(s) * 1000 : parseFloat(s);

/** Parse a Kinetix catalog number. Returns { family, frame, rating?, option, brake } or null. brake is null when the number does not say. */
function parseMotor(cat) {
  const s = String(cat || '').trim();
  let m = /^TLP-[AB](\d{3})-(\d+K?)-([A-Za-z0-9]{6})$/i.exec(s);
  if (m) return { family: 'TLP', frame: m[1], rating: rating(m[2]), option: m[3], brake: m[3][4] === '4' };
  m = /^VPL-[AB](\d{4})[A-Z]-([A-Z])([A-Z0-9]{5})?$/i.exec(s);
  if (m) return { family: 'VPL', frame: m[1], option: m[2] + (m[3] || ''), brake: m[3] ? m[3][2] === '4' : null };
  return null;
}

/** Brake delays for a motor: { release, engage } in seconds when it has a brake, else null. opts.brake overrides what the number says. */
function motorBrake(cat, opts = {}) {
  const p = parseMotor(cat);
  if (!p) return null;
  const brake = opts.brake != null ? !!opts.brake : !!p.brake;
  if (!brake) return null;
  const rows = p.family === 'TLP' ? TLP : VPL;
  const row = rows.find((r) => r.frames.includes(p.frame) && (r.maxRating == null || p.rating <= r.maxRating) && (r.minRating == null || p.rating >= r.minRating));
  if (!row) throw new Error('motorBrake: no brake row for ' + cat);
  return { release: row.release, engage: row.engage };
}

module.exports = { motorBrake, parseMotor, tlpBrake: motorBrake };
