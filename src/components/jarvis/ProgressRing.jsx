/**
 * ProgressRing — shared SVG progress ring (0–100%).
 *
 * Extracted from JarvisGenerateModal so the CreateStationPage summarize
 * step (and anything else) can reuse it. SDC colors: primary blue while
 * working, green at 100%, red on failure.
 *
 * Props:
 *   pct      0–100
 *   failed   render in the failure color with "failed" sublabel
 *   size     outer square in px (default 128 — the JarvisGenerateModal size)
 *   subLabel optional override for the small text under the percent
 *            (defaults to failed/done/working)
 */

export function ProgressRing({ pct, failed = false, size = 128, subLabel }) {
  // Geometry scales with size, matching the original 128px ring
  // (r=52, strokeWidth=10 at 128).
  const half = size / 2;
  const strokeWidth = (10 / 128) * size;
  const r = (52 / 128) * size;
  const c = 2 * Math.PI * r;
  const color = failed ? '#b83c3c' : pct >= 100 ? '#5a9a48' : '#1574C4';
  const label = subLabel ?? (failed ? 'failed' : pct >= 100 ? 'done' : 'working');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={half} cy={half} r={r} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
      <circle
        cx={half} cy={half} r={r} fill="none"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(pct, 100) / 100)}
        transform={`rotate(-90 ${half} ${half})`}
        style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
      />
      <text
        x={half} y={half - (4 / 128) * size} textAnchor="middle"
        fontSize={(24 / 128) * size} fontWeight="700" fill="#0f172a"
      >
        {Math.floor(pct)}%
      </text>
      <text
        x={half} y={half + (16 / 128) * size} textAnchor="middle"
        fontSize={(10 / 128) * size} fill="#64748b"
      >
        {label}
      </text>
    </svg>
  );
}
