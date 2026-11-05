'use strict';
// Kinetix TLP servo motor brake response times (Rockwell TLP brake specification table; Jason, 2026-11-05).
// An axis whose motor has the brake option carries MechanicalBrakeReleaseDelay / MechanicalBrakeEngageDelay
// in seconds; MechanicalBrakeControl stays Automatic. Non-brake motors keep 0.0.
//
//   frame 046 / 070 / 090 / 100 / 115        release 40 ms   engage 80 ms
//   frame 145                                release 50 ms   engage 110 ms
//   frame 200, rating <= 350                 release 60 ms   engage 120 ms
//   frame 200, rating >= 450                 release 100 ms  engage 150 ms
//   frame 235                                release 150 ms  engage 300 ms
//
// Catalog form TLP-{A|B}{frame}-{rating}-{option code}; option code position 5 = 4 means brake (Dxxx4x), 2 = no brake.

const ROWS = [
  { frames: ['046', '070', '090', '100', '115'], release: 0.04, engage: 0.08 },
  { frames: ['145'], release: 0.05, engage: 0.11 },
  { frames: ['200'], maxRating: 350, release: 0.06, engage: 0.12 },
  { frames: ['200'], minRating: 450, release: 0.10, engage: 0.15 },
  { frames: ['235'], release: 0.15, engage: 0.30 },
];

const rating = (s) => /K$/i.test(s) ? parseFloat(s) * 1000 : parseFloat(s);

/** Parse a TLP catalog number. Returns { frame, rating, option, brake } or null. */
function parseTlp(cat) {
  const m = /^TLP-[AB](\d{3})-(\d+K?)-([A-Za-z0-9]{6})$/i.exec(String(cat || '').trim());
  if (!m) return null;
  return { frame: m[1], rating: rating(m[2]), option: m[3], brake: m[3][4] === '4' };
}

/** Brake delays for a motor: { release, engage } in seconds when it has a brake, else null. */
function tlpBrake(cat) {
  const p = parseTlp(cat);
  if (!p || !p.brake) return null;
  const row = ROWS.find((r) => r.frames.includes(p.frame) && (r.maxRating == null || p.rating <= r.maxRating) && (r.minRating == null || p.rating >= r.minRating));
  if (!row) throw new Error('tlpBrake: no brake row for ' + cat);
  return { release: row.release, engage: row.engage };
}

module.exports = { tlpBrake, parseTlp };
