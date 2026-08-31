/**
 * fmtTime — app-wide timestamp formatting (Dan: "we don't take time in
 * military time"). Everything user-facing renders EASTERN TIME, 12-hour.
 */

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});
const ET_FMT_FULL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

/** "Aug 21, 5:45 PM" — or '—' / the raw string when unparseable. */
export function fmtET(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return ET_FMT.format(d);
}

/** Full form for tooltips: "Aug 21, 2026, 5:45 PM EDT". */
export function fmtETFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return ET_FMT_FULL.format(d);
}
