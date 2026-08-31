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

const ET_FMT_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric', minute: '2-digit',
});
const ET_FMT_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short', day: 'numeric',
});

/** Time only, 12-hour: "7:20 AM" (Dan, 2026-08-31: never 24-hour anywhere
 *  a human reads — artifact FILENAMES keep the sortable 24h stamp, displays
 *  never do). */
export function fmtETTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return ET_FMT_TIME.format(d);
}

/** "7:20 AM" today, "Aug 30, 7:20 AM" otherwise — change logs, histories. */
export function fmtETWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const sameDay = ET_FMT_DAY.format(d) === ET_FMT_DAY.format(new Date());
  return sameDay ? ET_FMT_TIME.format(d) : `${ET_FMT_DAY.format(d)}, ${ET_FMT_TIME.format(d)}`;
}
