import { buildNewDance, type NewDanceField, type NewDanceProblem } from "./newDance";
import { isCalendarDate } from "./jerusalemTime";

/**
 * What an instructor typed for a dance that REPEATS, turned into the recurrence
 * the database stores — or into a named reason it cannot be.
 *
 * The interesting difference from `newDance.ts` is what comes out the far end.
 * A one-off night is converted here, once, into two UTC instants. A series
 * cannot be: "every Tuesday at 20:00" is a wall clock, and the UTC instant of
 * each Tuesday depends on which side of a DST change it falls on. Converting the
 * first night and stepping by 7 × 24 hours from there is the exact bug
 * AGENTS.md §7 warns about, and it would move a series an hour twice a year.
 *
 * So this module hands the WALL CLOCK through to `publish_recurring_dance`, and
 * the per-night conversion happens in the generator, in Postgres, against the
 * same IANA timezone database `jerusalemTime.ts` reads through `Intl`.
 *
 * It still runs the first night through `buildNewDance`, and that is not
 * ceremony: that function is where "is this a real calendar date", "does this
 * time exist in Israel", and "is this night under twelve hours" already live,
 * tested, with an error vocabulary the form already renders. A second copy of
 * those rules is a copy that can disagree.
 */

/** What the form's repeat control offers. "once" keeps the 3.2a path. */
export type Repeat = "once" | "weekly" | "biweekly";

/** The two values `dance_events.recurrence_freq` accepts. */
export type RecurrenceFreq = Exclude<Repeat, "once">;

export interface NewRecurringDanceInput {
  venueId: string;
  repeat: RecurrenceFreq;
  /** "YYYY-MM-DD", the Israel calendar date of the FIRST night. */
  date: string;
  /** "HH:MM" Israel local. */
  startTime: string;
  /** "HH:MM" Israel local. */
  endTime: string;
  /** "YYYY-MM-DD", or "" for a series with no end date. */
  untilDate: string;
}

export type RecurringField = NewDanceField | "untilDate";

export interface RecurringProblem {
  field: RecurringField;
  reason: NewDanceProblem["reason"] | "beforeStart";
}

export interface NewRecurringDanceCommand {
  venueId: string;
  freq: RecurrenceFreq;
  /** "YYYY-MM-DD". */
  startDate: string;
  /** "HH:MM" Israel local — stored as a wall clock, never as an instant. */
  localStartTime: string;
  /** "HH:MM" Israel local. */
  localEndTime: string;
  /** "YYYY-MM-DD", or null for "until further notice". */
  untilDate: string | null;
}

/**
 * Deliberately NOT validated here: whether the series produces any nights at
 * all. That answer depends on today's date and on the generator's horizon, both
 * of which live in the database — `publish_recurring_dance` refuses a series
 * that materialises nothing, and the action turns that refusal into a message.
 * Re-deriving it in a pure function would mean reading the clock here and
 * keeping a second copy of the horizon in sync with the SQL one.
 */
export function buildNewRecurringDance(
  input: NewRecurringDanceInput,
): { command: NewRecurringDanceCommand } | { problems: RecurringProblem[] } {
  const firstNight = buildNewDance({
    venueId: input.venueId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  if ("problems" in firstNight) return { problems: firstNight.problems };

  // Checked after the first night, not alongside it: an end date is only
  // meaningful once there is a start date to compare it against, and naming two
  // date problems at once reads as a wall of red to this audience (§2).
  const untilDate = input.untilDate.trim();
  if (untilDate !== "") {
    if (!isCalendarDate(untilDate)) {
      return { problems: [{ field: "untilDate", reason: "malformed" }] };
    }
    // A string comparison, not a Date one. Both sides are "YYYY-MM-DD", where
    // lexical order and calendar order are the same thing — so there is no
    // instant to construct, and therefore no timezone to get wrong.
    if (untilDate < input.date) {
      return { problems: [{ field: "untilDate", reason: "beforeStart" }] };
    }
  }

  return {
    command: {
      venueId: input.venueId,
      freq: input.repeat,
      startDate: input.date,
      localStartTime: input.startTime,
      localEndTime: input.endTime,
      untilDate: untilDate === "" ? null : untilDate,
    },
  };
}
