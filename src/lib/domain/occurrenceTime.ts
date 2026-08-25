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
 * `jerusalemDayKey` is the reason that distinction is worth stating precisely.
 * Bucketing occurrences by calendar day sounds like arithmetic — the tempting
 * implementation derives midnight boundaries and compares against them, which
 * is exactly the `Date` math §7 forbids and breaks twice a year when Israel's
 * DST shift makes a local day 23 or 25 hours long. Asking `Intl` which calendar
 * date an instant falls on in Asia/Jerusalem sidesteps the whole problem: the
 * timezone database already knows, and no interval is ever computed.
 *
 * Lives in src/lib/domain/ rather than in the component so it stays importable
 * without a DOM (AGENTS.md §3, ahead of the Capacitor wrap).
 */

import { jerusalemWallTimeToUtc } from "./jerusalemTime";

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

/**
 * "יום שני" for a bare calendar date, or null if it is not one.
 *
 * Takes "YYYY-MM-DD" rather than an instant, because the caller is a form field
 * and not a stored occurrence. It goes through `jerusalemWallTimeToUtc` rather
 * than `new Date("2026-08-18")` for the reason the module note above gives: that
 * constructor produces UTC midnight, which is the previous evening in half the
 * world, and reading a weekday off it is the class of bug §7 is about. Midday is
 * used as the reference time because no timezone offset can move it off its own
 * date.
 */
export function formatCalendarDateWeekday(date: string): string | null {
  const noon = jerusalemWallTimeToUtc({ date, time: "12:00" });
  if ("error" in noon) return null;

  return weekdayFormatter.format(new Date(noon.utcIso));
}

/**
 * Deliberately built from `formatToParts` under a fixed `en-US` locale rather
 * than from a `he-IL` or `en-CA` formatted string. The key is an internal
 * grouping identity, never shown to anyone, so it must not change shape with a
 * locale or a browser's CLDR version — `en-CA` happens to render ISO order
 * today, but nothing in the spec promises it will, and a key that silently
 * reorders would split one day into two groups.
 */
const dayPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Asia/Jerusalem calendar date an instant falls on, as "YYYY-MM-DD". */
export function jerusalemDayKey(startsAt: string): string {
  const parts = dayPartsFormatter.formatToParts(parse(startsAt));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Fixed `en-US` and `formatToParts` again, and for the third time in this file
 * the reason is that the output is an internal identity rather than something a
 * person reads: this one goes into an `<input type="time">`, which accepts
 * exactly "HH:MM" in ASCII digits and nothing else. `formatStartTime` renders
 * the same instant for display and is free to change shape with the locale or a
 * CLDR update; this one is not.
 */
const timeFieldFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "20:00" in Israel local time, in the shape a native time input requires. */
export function jerusalemTimeField(startsAt: string): string {
  const parts = timeFieldFormatter.formatToParts(parse(startsAt));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  // Some ICU versions render midnight as "24" under h23; jerusalemTime.ts
  // normalises the same way on the way in.
  const hour = String(Number(value("hour")) % 24).padStart(2, "0");
  return `${hour}:${value("minute")}`;
}

const dayHeadingFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "יום שני, 2 ביוני" — the visible header above one day's dances. */

const numericDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

/** "18.8.2026" — numeric date display */
export function formatNumericDate(startsAt: string): string {
  return numericDateFormatter.format(parse(startsAt));
}

export function formatDayHeading(startsAt: string): string {
  return dayHeadingFormatter.format(parse(startsAt));
}
