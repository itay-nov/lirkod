import { buildNightTimes, type NightTimesField } from "./nightTimes";

/**
 * Turns what an instructor typed into the two timestamps we store, or into a
 * named reason it cannot be stored.
 *
 * Pure, and separate from both the form and the server action, for the reason
 * AGENTS.md §3 gives: this is the product logic (what counts as a valid night,
 * how an evening that runs past midnight is read) and it is the part worth
 * testing. The action calls it; the form renders whichever field it names.
 *
 * The clock rules themselves live in `nightTimes.ts` and are shared with the
 * reschedule path, so changing one night's hours and publishing a new one
 * cannot come to different conclusions about the same two times. What stays
 * here is what only publishing needs: the venue, and reporting a blank field
 * before anything is converted.
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

export type NewDanceField = "venueId" | NightTimesField;

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

  const built = buildNightTimes({
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  if ("problems" in built) return { problems: built.problems };

  return {
    command: {
      venueId: input.venueId,
      startsAtUtc: built.times.startsAtUtc,
      endsAtUtc: built.times.endsAtUtc,
      endsNextDay: built.times.endsNextDay,
    },
  };
}
