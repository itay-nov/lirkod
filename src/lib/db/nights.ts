import type { Client } from "./client";
import { jerusalemDayKey } from "@/lib/domain/occurrenceTime";

/**
 * The nights an instructor manages: reading their own, cancelling one, moving
 * one to a different hour.
 *
 * Every function here runs through the CALLER's session, never `service_role` —
 * the same stance `publisher.ts` takes and for the same reason (AGENTS.md §8).
 * The database is the authority on who may write what: migration 0010 removed
 * DELETE from `authenticated` entirely, narrowed UPDATE to the columns an
 * instructor owns, and made `overridden_at` something a trigger stamps rather
 * than something a caller is trusted to remember. Nothing in this module
 * re-implements any of that.
 *
 * **There is no delete.** Not an omission — cancelling is the only way to take a
 * night off the board, because the generator (migration 0009) skips a slot on
 * the strength of a row EXISTING in it. Delete the row and the next nightly pass
 * re-creates the night, at its original time, marked 'scheduled'. See
 * docs/decisions/0017.
 *
 * **A denied UPDATE is not an error.** `event_occurrences_update_own` filters
 * with USING, so an update the caller does not own simply matches no rows and
 * PostgREST reports success. Every write below therefore `select()`s and checks
 * what came back — reporting "cancelled" on a statement that changed nothing is
 * how an instructor comes to believe a dance is off when every dancer still sees
 * it on (AGENTS.md §10).
 */

export interface OwnNight {
  id: string;
  /** ISO-8601 UTC. */
  startsAt: string;
  /** ISO-8601 UTC. */
  endsAt: string;
  status: "scheduled" | "cancelled" | "moved";
  cancellationReason: string | null;
  /** Non-null when this night has already been moved to a different hour. */
  originalStartsAt: string | null;
  /**
   * The Israel calendar date the night belongs to, "YYYY-MM-DD".
   *
   * The recurrence slot when there is one, so a night already moved to a
   * different hour still edits against the date it was scheduled for rather
   * than drifting a day each time it is touched. Falls back to the calendar
   * date of the night itself for a one-off nobody generated.
   */
  dateKey: string;
  venueName: string;
}

/** The window and the cap on the manage list. */
const HORIZON_DAYS = 60;
const ROW_LIMIT = 100;

/**
 * PostgREST cannot express `coalesce(override_venue_id, dance_events.venue_id)`
 * as a join — the reason `find_dances_near` exists at all (docs/decisions/0005)
 * — so both venues are embedded and the coalesce happens in the mapper below.
 *
 * That is not the fetch-then-filter AGENTS.md §9 forbids: no row is discarded
 * here and no distance is computed: the query returns exactly the nights the
 * caller manages, and picking which of two names to show is a field choice, not
 * a filter. The proximity path still runs entirely in Postgres.
 *
 * `dance_events!inner` is what makes the instructor filter apply to the join
 * rather than to the outer rows — without `!inner` PostgREST returns every night
 * with a null embed instead of returning none.
 */
const NIGHT_SELECT = `
  id,
  starts_at,
  ends_at,
  status,
  cancellation_reason,
  original_starts_at,
  series_date,
  dance_events!inner(instructor_id, venues!inner(name)),
  override_venue:venues(name)
`;

interface NightRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled" | "moved";
  cancellation_reason: string | null;
  original_starts_at: string | null;
  series_date: string | null;
  dance_events: { instructor_id: string; venues: { name: string } | null } | null;
  override_venue: { name: string } | null;
}

function toOwnNight(row: NightRow): OwnNight {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    originalStartsAt: row.original_starts_at,
    dateKey: row.series_date ?? jerusalemDayKey(row.original_starts_at ?? row.starts_at),
    // docs/decisions/0003: override_venue_id is authoritative for WHERE, and the
    // status is never consulted to work out a location.
    venueName: row.override_venue?.name ?? row.dance_events?.venues?.name ?? "",
  };
}

/**
 * The caller's own upcoming nights, soonest first.
 *
 * **The instructor filter is load-bearing and must not be removed.**
 * `event_occurrences_select_authenticated` is `using (true)` — a signed-in user
 * may read every occurrence, deliberately, because an instructor needs their own
 * history and the row carries no personal data. So RLS filters nothing here, and
 * an unfiltered version of this query would list every instructor in the country
 * on somebody's profile. This is the same trap `findOwnInstructor` fell into
 * against `instructors`, which is world-readable for its own good reasons.
 *
 * Bounded on both axes for the reason docs/decisions/0010 gives: a query with no
 * horizon grows without limit as the product ages, and the generator now creates
 * 90 days of nights per series without anyone typing them.
 *
 * Past nights are excluded. Not history-hiding — there is simply nothing to do
 * to a night that has already happened, and a manage list that opens on last
 * month is a list this audience has to scroll past to reach anything actionable.
 */
export async function findOwnNights(
  client: Client,
  instructorId: string,
): Promise<OwnNight[]> {
  const horizon = new Date(Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await client
    .from("event_occurrences")
    .select(NIGHT_SELECT)
    .eq("dance_events.instructor_id", instructorId)
    .gte("starts_at", new Date().toISOString())
    .lt("starts_at", horizon.toISOString())
    .order("starts_at", { ascending: true })
    .limit(ROW_LIMIT);

  if (error) throw error;

  return (data as unknown as NightRow[]).map(toOwnNight);
}

/** One of the caller's own nights, or null if it is not theirs (or not there). */
export async function findOwnNight(
  client: Client,
  instructorId: string,
  occurrenceId: string,
): Promise<OwnNight | null> {
  const { data, error } = await client
    .from("event_occurrences")
    .select(NIGHT_SELECT)
    .eq("dance_events.instructor_id", instructorId)
    .eq("id", occurrenceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toOwnNight(data as unknown as NightRow);
}

export type NightWriteResult = { ok: true } | { ok: false; reason: "notYours" };

/**
 * Takes one night off the board, leaving the row exactly where it is.
 *
 * `overridden_at` is not passed. Migration 0010's trigger stamps it, so there is
 * no version of this call that can cancel a night and leave it looking
 * untouched — including one made straight against PostgREST with the caller's
 * own token, which is the version this application cannot police.
 *
 * The night stays readable, with its status, to a visitor with no account. That
 * is deliberate and is the whole point of a soft cancel: a dancer who has
 * already made plans has to be able to see "בוטל" (AGENTS.md §2.6, §10). Hiding
 * the row would send them to a hall that is dark.
 */
export async function cancelNight(
  client: Client,
  night: { occurrenceId: string; reason: string | null },
): Promise<NightWriteResult> {
  const { data, error } = await client
    .from("event_occurrences")
    .update({
      status: "cancelled",
      cancellation_reason: night.reason,
    })
    .eq("id", night.occurrenceId)
    .select("id");

  if (error) throw error;

  return data.length === 1 ? { ok: true } : { ok: false, reason: "notYours" };
}

/**
 * Moves one night to a different hour, in place.
 *
 * An UPDATE of the existing row, never a delete and a re-insert. `series_date`
 * is untouched — it is not even in `authenticated`'s UPDATE grant since
 * migration 0010 — so the slot the generator keys on stays occupied and the
 * original 20:00 night is never put back beside the moved one.
 *
 * `originalStartsAt` records where the night started out, and is set only the
 * first time: a night moved twice still shows a dancer the time they originally
 * planned around, not the intermediate one they may never have seen. Reading it
 * back off the row rather than accepting it from the client is AGENTS.md §8 —
 * the caller is a browser, and this value decides what every dancer is told.
 *
 * `status` is deliberately not changed. docs/decisions/0003 reserves 'moved' for
 * a venue change and forbids it without one; a time move keeps 'scheduled' and
 * is shown from `original_starts_at` instead (migration 0010).
 */
export async function rescheduleNight(
  client: Client,
  night: {
    occurrenceId: string;
    startsAtUtc: string;
    endsAtUtc: string;
    /** The night's current start, from the server's own read of the row. */
    currentStartsAt: string;
    /** Its `original_starts_at`, if it has already been moved once. */
    currentOriginalStartsAt: string | null;
  },
): Promise<NightWriteResult> {
  const original = night.currentOriginalStartsAt ?? night.currentStartsAt;

  // A night moved back to where it began is not a moved night, and
  // `event_occurrences_original_differs` refuses a row that claims otherwise.
  const originalStartsAt =
    Date.parse(original) === Date.parse(night.startsAtUtc) ? null : original;

  const { data, error } = await client
    .from("event_occurrences")
    .update({
      starts_at: night.startsAtUtc,
      ends_at: night.endsAtUtc,
      original_starts_at: originalStartsAt,
    })
    .eq("id", night.occurrenceId)
    .select("id");

  if (error) throw error;

  return data.length === 1 ? { ok: true } : { ok: false, reason: "notYours" };
}
