import {
  isCalendarDate,
  isWallClockTime,
  jerusalemWallTimeToUtc,
  nextCalendarDay,
  type WallClockError,
} from "./jerusalemTime";

/**
 * One night's start and end, as an instructor types them, turned into the two
 * UTC instants we store (AGENTS.md §7).
 *
 * Extracted from `newDance.ts` when per-night management arrived, because
 * changing an existing night's hours has to read the clock exactly as
 * publishing a new one does. The rules below — which times are real, what an end
 * time before the start means, how long a night is allowed to be — are the
 * product's, not one screen's, and a second copy of them in the reschedule path
 * is a copy that would eventually disagree about a 21:00-00:30 evening.
 *
 * Pure and DOM-free (AGENTS.md §3). Nothing here reads the clock, so a night in
 * the past is not this module's business — it has no way to know what "now" is
 * and no opinion about it.
 */

export interface NightTimesInput {
  /** "YYYY-MM-DD", the Israel calendar date the night belongs to. */
  date: string;
  /** "HH:MM" Israel local. */
  startTime: string;
  /** "HH:MM" Israel local. */
  endTime: string;
}

export type NightTimesField = "date" | "startTime" | "endTime";

export interface NightTimesProblem {
  field: NightTimesField;
  reason: "malformed" | "nonexistent" | "tooLong";
}

export interface NightTimes {
  /** ISO-8601 UTC. */
  startsAtUtc: string;
  /** ISO-8601 UTC. */
  endsAtUtc: string;
  /** True when the end time was read as belonging to the following day. */
  endsNextDay: boolean;
}

/**
 * The ceiling on how long one night can run, in hours.
 *
 * Exists because of how `endsNextDay` is inferred below. An end time at or
 * before the start is read as "the next morning", which is right for 21:00–00:30
 * and wrong for a typo where 20:00–19:00 was meant to be 20:00–21:00. Without a
 * bound the typo silently becomes a 23-hour dance. Twelve hours is far longer
 * than any הרקדה and far shorter than a mistake.
 *
 * The same number is restated as a CHECK on `dance_events` in migration 0009,
 * because a recurring series can be written without passing through here.
 */
const MAX_HOURS = 12;

function problemFor(field: NightTimesField, error: WallClockError): NightTimesProblem {
  return { field, reason: error };
}

/**
 * Reads the end time as the following calendar day when it is not after the
 * start.
 *
 * A folk-dance evening that runs 21:00–00:30 is ordinary, and an instructor
 * typing those two times means the small hours of tomorrow — they are not
 * describing a negative duration. Rejecting it would be technically defensible
 * and would read, to this audience, as the form refusing a perfectly normal
 * night (AGENTS.md §2).
 *
 * The roll happens on the calendar date and the conversion happens afterwards,
 * so a night that straddles a DST change still gets both of its timestamps from
 * the timezone database rather than from an assumed 24-hour day.
 */
function resolveEnd(
  input: NightTimesInput,
  startsAtUtc: string,
): { endsAtUtc: string; endsNextDay: boolean } | NightTimesProblem {
  const sameDay = jerusalemWallTimeToUtc({ date: input.date, time: input.endTime });
  if ("error" in sameDay) return problemFor("endTime", sameDay.error);

  if (Date.parse(sameDay.utcIso) > Date.parse(startsAtUtc)) {
    return { endsAtUtc: sameDay.utcIso, endsNextDay: false };
  }

  const tomorrow = nextCalendarDay(input.date);
  if (tomorrow === null) return { field: "date", reason: "malformed" };

  const rolled = jerusalemWallTimeToUtc({ date: tomorrow, time: input.endTime });
  if ("error" in rolled) return problemFor("endTime", rolled.error);

  return { endsAtUtc: rolled.utcIso, endsNextDay: true };
}

export function buildNightTimes(
  input: NightTimesInput,
): { times: NightTimes } | { problems: NightTimesProblem[] } {
  const problems: NightTimesProblem[] = [];

  // Shape-checked per field first, so a malformed *time* is never reported
  // against the date. The conversion below takes both at once and cannot tell
  // the caller which half it disliked.
  if (!isCalendarDate(input.date)) problems.push({ field: "date", reason: "malformed" });
  if (!isWallClockTime(input.startTime)) {
    problems.push({ field: "startTime", reason: "malformed" });
  }
  if (!isWallClockTime(input.endTime)) {
    problems.push({ field: "endTime", reason: "malformed" });
  }
  if (problems.length > 0) return { problems };

  const start = jerusalemWallTimeToUtc({ date: input.date, time: input.startTime });
  if ("error" in start) return { problems: [problemFor("startTime", start.error)] };

  const end = resolveEnd(input, start.utcIso);
  if ("field" in end) return { problems: [end] };

  const hours = (Date.parse(end.endsAtUtc) - Date.parse(start.utcIso)) / 3_600_000;
  if (hours > MAX_HOURS) return { problems: [{ field: "endTime", reason: "tooLong" }] };

  return {
    times: {
      startsAtUtc: start.utcIso,
      endsAtUtc: end.endsAtUtc,
      endsNextDay: end.endsNextDay,
    },
  };
}
