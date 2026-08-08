/**
 * Display formatting for an occurrence's start time.
 *
 * AGENTS.md §7: timestamps are stored as UTC `timestamptz` and displayed in
 * Asia/Jerusalem. These are pure formatters — no date arithmetic happens here,
 * so the DST hazard §7 warns about does not arise and no date library is needed
 * (§13: don't add a dependency for something the platform already does). The
 * moment we need "is this tonight?" or "add 3 hours", that is arithmetic across
 * a DST boundary and it needs a real library, not `Date` math.
 *
 * Lives in src/lib/domain/ rather than in the component so it stays importable
 * without a DOM (AGENTS.md §3, ahead of the Capacitor wrap).
 */

const TIMEZONE = "Asia/Jerusalem";
const LOCALE = "he-IL";

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const weekdayFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  weekday: "long",
});

function parse(startsAt: string): Date {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Not a parseable timestamp: ${startsAt}`);
  }
  return date;
}

/** "20:30", in Israel local time. */
export function formatStartTime(startsAt: string): string {
  return timeFormatter.format(parse(startsAt));
}

/** "יום שני", in Israel local time — the same instant can fall on a different day elsewhere. */
export function formatStartWeekday(startsAt: string): string {
  return weekdayFormatter.format(parse(startsAt));
}
