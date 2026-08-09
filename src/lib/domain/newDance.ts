import {
  isCalendarDate,
  isWallClockTime,
  jerusalemWallTimeToUtc,
  nextCalendarDay,
  type WallClockError,
} from "./jerusalemTime";

/**
 * Turns what an instructor typed into the two timestamps we store, or into a
 * named reason it cannot be stored.
 *
 * Pure, and separate from both the form and the server action, for the reason
 * AGENTS.md §3 gives: this is the product logic (what counts as a valid night,
 * how an evening that runs past midnight is read) and it is the part worth
 * testing. The action calls it; the form renders whichever field it names.
 *
 * It deliberately does NOT check that the venue exists or that the instructor
 * owns anything. Those are the database's answers — a foreign key and an RLS
 * policy respectively — and re-implementing them here would produce a second,
 * weaker copy that could drift out of agreement with the real one (§8: never
 * trust the client, re-read on the server).
 */

export interface NewDanceInput {
  venueId: string;
  /** "YYYY-MM-DD", the Israel calendar date the dance starts on. */
  date: string;
  /** "HH:MM" Israel local. */
  startTime: string;
  /** "HH:MM" Israel local. */
  endTime: string;
}

export type NewDanceField = "venueId" | "date" | "startTime" | "endTime";

export interface NewDanceProblem {
  field: NewDanceField;
  reason: "missing" | "malformed" | "nonexistent" | "tooLong";
}

export interface NewDanceCommand {
  venueId: string;
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
 */
const MAX_HOURS = 12;

function problemFor(field: NewDanceField, error: WallClockError): NewDanceProblem {
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
  input: NewDanceInput,
  startsAtUtc: string,
): { endsAtUtc: string; endsNextDay: boolean } | NewDanceProblem {
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

export function buildNewDance(
  input: NewDanceInput,
): { command: NewDanceCommand } | { problems: NewDanceProblem[] } {
  const problems: NewDanceProblem[] = [];

  if (input.venueId.trim() === "") problems.push({ field: "venueId", reason: "missing" });
  if (input.date.trim() === "") problems.push({ field: "date", reason: "missing" });
  if (input.startTime.trim() === "") {
    problems.push({ field: "startTime", reason: "missing" });
  }
  if (input.endTime.trim() === "") problems.push({ field: "endTime", reason: "missing" });

  // Returned before any conversion: telling someone their blank field is also an
  // invalid date is two messages for one mistake.
  if (problems.length > 0) return { problems };

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
    command: {
      venueId: input.venueId,
      startsAtUtc: start.utcIso,
      endsAtUtc: end.endsAtUtc,
      endsNextDay: end.endsNextDay,
    },
  };
}
