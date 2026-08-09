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
 * path joins occurrences. `recurrence_rule` is explicitly null: this is one
 * night, and 3.3 is where a pattern generates more.
 *
 * Runs as the CALLER. `dance_events_insert_own` checks `owns_instructor
 * (instructor_id)` and `event_occurrences_insert_own` checks `owns_event
 * (event_id)`, so an instructor id belonging to somebody else fails at the
 * database rather than being trusted here (AGENTS.md §8).
 *
 * **Not atomic, deliberately and with a known cost.** PostgREST gives no
 * transaction across two calls, so the compensating delete below is what keeps a
 * failed publish from leaving a dance with no nights. A process that dies between
 * the two calls still can, and the honest description of the consequence is: an
 * orphaned `dance_events` row that no read path can reach, because every one of
 * them joins through occurrences. It is invisible rather than wrong. Making this
 * genuinely atomic wants a `security invoker` function doing both inserts in one
 * statement — the same shape as `find_dances_near` (docs/decisions/0005) — which
 * is a migration, and out of scope here.
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
  const { data: event, error: eventError } = await client
    .from("dance_events")
    .insert({
      instructor_id: dance.instructorId,
      venue_id: dance.venueId,
      recurrence_rule: null,
      // price_agorot is NOT NULL with no default and pricing is out of scope for
      // this phase, so every dance published here records zero. That is a
      // placeholder, NOT a claim that the dance is free — nothing renders a price
      // today, and whoever builds pricing must be able to tell "we never asked"
      // from "the instructor said it costs nothing". Flagged in the summary.
      price_agorot: 0,
    })
    .select("id")
    .single();

  if (eventError) throw eventError;

  const { data: occurrence, error: occurrenceError } = await client
    .from("event_occurrences")
    .insert({
      event_id: event.id,
      starts_at: dance.startsAtUtc,
      ends_at: dance.endsAtUtc,
      status: "scheduled",
      // Left null: an override venue on a scheduled night is the one combination
      // migration 0001's check constraint makes unrepresentable, because it is
      // how a dancer ends up at a dark hall (docs/decisions/0003).
      override_venue_id: null,
    })
    .select("id")
    .single();

  if (occurrenceError) {
    // The dance is unreachable without a night, so it is removed rather than
    // left behind. `dance_events_delete_own` permits exactly this and nothing
    // else — the caller can only delete what they just created.
    await client.from("dance_events").delete().eq("id", event.id);
    throw occurrenceError;
  }

  return { eventId: event.id, occurrenceId: occurrence.id };
}
