import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Client } from "./client";

export type OccurrenceStatus = Database["public"]["Enums"]["occurrence_status"];

export interface NearbyDance {
  occurrenceId: string;
  startsAt: string;
  status: OccurrenceStatus;
  venueId: string;
  venueName: string;
  venueLat: number;
  venueLng: number;
  instructorDisplayName: string;
  danceTypes: string[];
  priceAgorot: number;
}

/**
 * Future dances within radiusMeters of (lat, lng), for the public map (AGENTS.md §9).
 * Delegates the radius filter and the venue coalesce (docs/decisions/0003) to the
 * find_dances_near SQL function (docs/decisions/0005) — never fetch-then-filter in JS.
 * Includes cancelled and moved occurrences; the caller renders their status.
 */
export async function findDancesNear(
  client: SupabaseClient<Database>,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<NearbyDance[]> {
  const { data, error } = await client.rpc("find_dances_near", {
    p_lat: lat,
    p_lng: lng,
    p_radius_meters: radiusMeters,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    occurrenceId: row.occurrence_id,
    startsAt: row.starts_at,
    status: row.status,
    venueId: row.venue_id,
    venueName: row.venue_name,
    venueLat: row.venue_lat,
    venueLng: row.venue_lng,
    instructorDisplayName: row.instructor_display_name,
    danceTypes: row.dance_types,
    priceAgorot: row.price_agorot,
  }));
}

export interface PublishedDance {
  eventId: string;
  occurrenceId: string;
}

/**
 * Publishes one non-recurring dance: a `dance_events` row and the single
 * `event_occurrences` row that is the night itself.
 *
 * Two rows because occurrences are materialised, not computed (docs/decisions/
 * 0002) — a dance nobody can find is a dance that does not exist, and the read
 * path joins occurrences. `recurrence_rule` is null: this is one night, and 3.3
 * is where a pattern generates more.
 *
 * **One RPC, one transaction, on purpose.** This used to be two inserts with a
 * compensating delete, which left a `dance_events` row behind whenever the
 * process died between them. That orphan was not harmless: `anon` holds SELECT
 * on the table and `dance_events_select_public` is `using (true)`, so it was
 * served straight out of /rest/v1/dance_events to someone with no account —
 * a public claim that an instructor runs a dance, with no night attached.
 * Migration 0006 replaced the pair with `publish_dance`, where a failure on
 * either insert rolls back both.
 *
 * The function is SECURITY INVOKER, so this still runs as the CALLER and both
 * inserts are checked by the same policies as before — `dance_events_insert_own`
 * (owns_instructor) and `event_occurrences_insert_own` (owns_event). An
 * instructor id belonging to somebody else fails at the database, not here
 * (AGENTS.md §8).
 */
export async function publishDance(
  client: Client,
  dance: {
    instructorId: string;
    venueId: string;
    startsAtUtc: string;
    endsAtUtc: string;
  },
): Promise<PublishedDance> {
  const { data, error } = await client
    .rpc("publish_dance", {
      p_instructor_id: dance.instructorId,
      p_venue_id: dance.venueId,
      p_starts_at: dance.startsAtUtc,
      p_ends_at: dance.endsAtUtc,
    })
    .single();

  if (error) throw error;

  return { eventId: data.event_id, occurrenceId: data.occurrence_id };
}

export type PublishedSeries =
  | { ok: true; eventId: string; occurrenceCount: number }
  /** The series produces no nights between today and the generator's horizon. */
  | { ok: false; reason: "noNights" };

/**
 * Publishes a dance that REPEATS, and the first horizon of its nights, in one
 * transaction (migration 0009).
 *
 * Takes an Israel WALL CLOCK — a start date, a start and end time, an optional
 * end date — and not the UTC instants `publishDance` takes. That is the whole
 * difference between the two, and it is not a style choice: a series' nights sit
 * at different UTC offsets either side of a DST change, so there is no single
 * conversion to do here. The generator resolves each night against the timezone
 * database as it materialises it (src/lib/domain/newRecurringDance.ts has the
 * longer version).
 *
 * The occurrences are written inside the same RPC rather than by waiting for the
 * nightly pg_cron pass, so an instructor who publishes at 19:00 sees their dance
 * on the map at 19:00 rather than after 03:00 the next morning.
 *
 * `noNights` is a refusal, not a failure. It means every night the rule
 * describes is already in the past or beyond the horizon — an instructor who
 * believes they published something a dancer will never see — so the RPC rolls
 * the whole thing back rather than leave a dance_events row that `anon` can read
 * with nothing attached to it (the orphan docs/decisions/0014 is about).
 */
export async function publishRecurringDance(
  client: Client,
  dance: {
    instructorId: string;
    venueId: string;
    freq: "weekly" | "biweekly";
    startDate: string;
    localStartTime: string;
    localEndTime: string;
    untilDate: string | null;
  },
): Promise<PublishedSeries> {
  const { data, error } = await client
    .rpc("publish_recurring_dance", {
      p_instructor_id: dance.instructorId,
      p_venue_id: dance.venueId,
      p_freq: dance.freq,
      p_start_date: dance.startDate,
      p_local_start_time: dance.localStartTime,
      p_local_end_time: dance.localEndTime,
      p_until_date: dance.untilDate ?? undefined,
    })
    .single();

  // P0001 is what the RAISE in publish_recurring_dance reports. Narrowed to that
  // one code on purpose: every other error — a policy refusal, a bad venue id, a
  // dropped connection — is still thrown, because turning them all into
  // "no nights" would tell an instructor to fix their dates when the real problem
  // was something else entirely (AGENTS.md §6: never swallow).
  if (error?.code === "P0001") return { ok: false, reason: "noNights" };
  if (error) throw error;

  return { ok: true, eventId: data.event_id, occurrenceCount: data.occurrence_count };
}
