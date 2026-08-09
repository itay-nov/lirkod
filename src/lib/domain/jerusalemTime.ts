/**
 * The inverse of `occurrenceTime.ts`: a wall-clock time an instructor typed in
 * Israel, turned into the UTC instant we store (AGENTS.md §7).
 *
 * `occurrenceTime.ts` says out loud that it does no arithmetic, and that the day
 * we need any is the day we need a real date library. This module is that day —
 * so it is worth being precise about what it does and does not do.
 *
 * It never adds or subtracts a duration to cross a DST boundary. It asks the
 * timezone database, through `Intl`, what Israel's offset *was at a specific
 * instant*, and subtracts that. That is a lookup, not interval arithmetic: the
 * hazard §7 warns about is code that assumes a day is 24 hours or that an offset
 * holds across a span, and nothing here assumes either. Which is also why no
 * dependency is added for it (§13) — the platform already ships the tz database.
 *
 * Pure and DOM-free, so it is testable without a browser (§3).
 */

const TIMEZONE = "Asia/Jerusalem";

/**
 * Fixed `en-US` and `formatToParts`, for the same reason `jerusalemDayKey` gives:
 * this is an internal identity, never shown to anyone, so it must not change
 * shape with a locale or a CLDR update.
 */
const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A calendar date and a time of day, with no offset — what a form collects. */
export interface WallClock {
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM", 24-hour. */
  time: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Exported so a caller can attribute a `malformed` result to the field that
 * actually caused it.
 *
 * `jerusalemWallTimeToUtc` takes a date and a time together and can only answer
 * about the pair, so a caller guessing which half was wrong will eventually
 * guess wrong — and point the person at a field that is perfectly fine, which is
 * worse than no message at all for a low-tech-literacy audience (AGENTS.md §2).
 * Sharing the patterns here keeps one definition of the format instead of a copy
 * in the validator that can drift.
 */
export function isCalendarDate(date: string): boolean {
  return parseWallClock({ date, time: "00:00" }) !== null;
}

export function isWallClockTime(time: string): boolean {
  return TIME_PATTERN.test(time) && parseWallClock({ date: "2000-01-01", time }) !== null;
}

function parseWallClock({ date, time }: WallClock): Fields | null {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const fields: Fields = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };

  if (fields.month < 1 || fields.month > 12) return null;
  if (fields.day < 1 || fields.day > 31) return null;
  if (fields.hour > 23 || fields.minute > 59) return null;

  // Rejects 31 February without a table of month lengths: Date.UTC rolls an
  // out-of-range day forward, so a round trip that comes back changed means the
  // date was never real.
  const asUtc = Date.UTC(fields.year, fields.month - 1, fields.day);
  const rolled = new Date(asUtc);
  if (
    rolled.getUTCFullYear() !== fields.year ||
    rolled.getUTCMonth() !== fields.month - 1 ||
    rolled.getUTCDate() !== fields.day
  ) {
    return null;
  }

  return fields;
}

/** The wall-clock fields Israel was showing at a given instant. */
function wallClockAt(instantMs: number): Fields {
  const parts = wallClockFormatter.formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    // Intl's h23 renders midnight as "24" in some ICU versions; normalise it so
    // the round-trip comparison below does not fail on a cosmetic difference.
    hour: value("hour") % 24,
    minute: value("minute"),
  };
}

function asPseudoUtc({ year, month, day, hour, minute }: Fields): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

/**
 * Israel's UTC offset, in milliseconds, at one specific instant.
 *
 * Derived by asking `Intl` what the clock read there and comparing it with what
 * the clock read in UTC. No table of transition dates lives in this repo, which
 * is the point — Israel's DST rule has been changed by the Knesset before and
 * will be again, and the tz database is the thing that gets updated for it.
 */
function offsetMsAt(instantMs: number): number {
  return asPseudoUtc(wallClockAt(instantMs)) - instantMs;
}

function sameInstantFields(a: Fields, b: Fields): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

export type WallClockError =
  /** Not a "YYYY-MM-DD" / "HH:MM" pair, or not a real calendar date. */
  | "malformed"
  /**
   * The time does not exist in Israel. On the spring-forward night the clock
   * jumps 02:00 → 03:00, so nothing between them ever happens.
   *
   * Rejected rather than nudged to 03:00. A dance silently moved an hour is
   * exactly the failure AGENTS.md §10 treats as the product's worst — the
   * instructor believes one time and every dancer is told another — and it would
   * be invisible at the moment it was made.
   */
  | "nonexistent";

export interface WallClockResult {
  /** The stored instant, ISO-8601 in UTC. */
  utcIso: string;
}

/**
 * A wall-clock time in Israel → the UTC instant to store.
 *
 * Two passes, then a verification. The first guess uses the offset in force at
 * the naive reading of the time; that offset can be the wrong side of a
 * transition, so the second pass re-asks at the corrected instant. Formatting the
 * result back and comparing is what catches the case where no instant satisfies
 * the request at all.
 *
 * On the autumn night when 01:30 happens twice, this resolves to the second one
 * (standard time, after the clocks go back). That is a deterministic, tested
 * choice rather than a considered product rule — no dance in this product starts
 * at 01:30, and if one ever does, the rule to apply is a question for whoever
 * builds it.
 */
export function jerusalemWallTimeToUtc(
  wall: WallClock,
): WallClockResult | { error: WallClockError } {
  const fields = parseWallClock(wall);
  if (fields === null) return { error: "malformed" };

  const naive = asPseudoUtc(fields);
  const firstPass = naive - offsetMsAt(naive);
  const instantMs = naive - offsetMsAt(firstPass);

  if (!sameInstantFields(wallClockAt(instantMs), fields)) {
    return { error: "nonexistent" };
  }

  return { utcIso: new Date(instantMs).toISOString() };
}

/**
 * The calendar day after "YYYY-MM-DD".
 *
 * Done in UTC on purpose, and it is not the arithmetic §7 forbids: UTC has no
 * DST, so adding 24 hours to a UTC midnight always lands on the next UTC
 * midnight. The timezone only enters afterwards, when the resulting date is
 * paired with a time and handed to `jerusalemWallTimeToUtc`. Doing it the other
 * way round — adding a day to an Israel-local instant — is the version that
 * breaks twice a year.
 */
export function nextCalendarDay(date: string): string | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;

  const next = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + 24 * 60 * 60 * 1000,
  );

  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
