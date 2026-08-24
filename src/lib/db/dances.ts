import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Client } from "./client";
import { publicDanceFlyerUrl } from "@/lib/storage/danceFlyers";

export type OccurrenceStatus = Database["public"]["Enums"]["occurrence_status"];
/** Phase 4.6b — see migration 0013. */
export type DanceLevel = Database["public"]["Enums"]["dance_level"];
export type DanceFormation = Database["public"]["Enums"]["dance_formation"];

export interface OwnDanceFlyer {
  eventId: string;
  venueName: string;
  nextStartsAt: string;
  flyerUrl: string | null;
}

/**
 * Owned dances with at least one upcoming night, ordered by that next night.
 *
 * Starting from occurrences avoids an arbitrary event cap: the recurrence
 * generator already bounds the future horizon, and an old but still-running
 * weekly dance remains visible until its final materialized night has passed.
 */
export async function findOwnDanceFlyers(
  client: Client,
  instructorId: string,
): Promise<OwnDanceFlyer[]> {
  const now = new Date().toISOString();
  const pageSize = 200;
  const dances = new Map<string, OwnDanceFlyer>();

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("event_occurrences")
      .select(
        "event_id, starts_at, dance_events!inner(id, instructor_id, flyer_path, venues!inner(name))",
      )
      .eq("dance_events.instructor_id", instructorId)
      .gte("starts_at", now)
      .order("starts_at", { ascending: true })
      .order("event_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    for (const row of data) {
      if (dances.has(row.event_id)) continue;
      dances.set(row.event_id, {
        eventId: row.event_id,
        venueName: row.dance_events.venues.name,
        nextStartsAt: row.starts_at,
        flyerUrl: publicDanceFlyerUrl(client, row.dance_events.flyer_path),
      });
    }

    if (data.length < pageSize) break;
  }

  return [...dances.values()];
}

export interface NearbyDance {
  /** The series this night belongs to — what a dancer favorites, not the occurrence. */
  eventId: string;
  occurrenceId: string;
  startsAt: string;
  /**
   * The hour this night used to be at, or null if nobody moved it.
   *
   * Carried all the way to the dancer on purpose. A time change keeps
   * `status = 'scheduled'` — docs/decisions/0003 reserves 'moved' for a venue
   * change — so without this the one thing AGENTS.md §10 says must never happen
   * quietly would happen quietly.
   */
  originalStartsAt: string | null;
  status: OccurrenceStatus;
  venueId: string;
  venueName: string;
  venueAddress: string;
  venueLat: number;
  venueLng: number;
  /** ISO-8601 UTC. Not returned by find_dances_near/find_favorite_nights — see attachNightDetails. */
  endsAt: string;
  instructorDisplayName: string;
  danceTypes: string[];
  priceAgorot: number;
  /** Phase 4.6b — set by the instructor at publish time, migration 0013. */
  level: DanceLevel;
  danceFormations: DanceFormation[];
  womenOnly: boolean;
  flyerUrl: string | null;
}

/**
 * find_dances_near and find_favorite_nights return identical shapes (migration
 * 0012 — the second is the first's sibling, filtered by event id instead of by
 * distance), so both RPCs share this one mapper.
 */
interface NearbyDanceRow {
  event_id: string;
  occurrence_id: string;
  starts_at: string;
  original_starts_at: unknown;
  status: OccurrenceStatus;
  venue_id: string;
  venue_name: string;
  venue_lat: number;
  venue_lng: number;
  instructor_display_name: string;
  dance_types: string[];
  price_agorot: number;
  level: DanceLevel;
  dance_formations: DanceFormation[];
  women_only: boolean;
}

function toNearbyDance(row: NearbyDanceRow): NearbyDance {
  return {
    eventId: row.event_id,
    occurrenceId: row.occurrence_id,
    startsAt: row.starts_at,
    // `supabase gen types` marks every RETURNS TABLE column non-null, which is
    // right for the rest of them and wrong for this one — a night nobody moved
    // has no original time. Narrowed here rather than trusted.
    originalStartsAt: (row.original_starts_at as string | null) ?? null,
    status: row.status,
    venueId: row.venue_id,
    venueName: row.venue_name,
    // Filled in by attachNightDetails — find_dances_near/find_favorite_nights
    // do not return these two columns, and changing their RETURNS TABLE needs a
    // migration this task does not carry. Placeholders here, never returned as-is.
    venueAddress: "",
    endsAt: row.starts_at,
    venueLat: row.venue_lat,
    venueLng: row.venue_lng,
    instructorDisplayName: row.instructor_display_name,
    danceTypes: row.dance_types,
    priceAgorot: row.price_agorot,
    level: row.level,
    danceFormations: row.dance_formations,
    womenOnly: row.women_only,
    flyerUrl: null,
  };
}

/**
 * Fills in `venueAddress`, `endsAt` and the optional public flyer URL; none is
 * returned by find_dances_near/find_favorite_nights.
 * Both columns are already public-readable through `venues` and
 * `event_occurrences` directly — `venues_select_public` and
 * `event_occurrences_select_anon_horizon`/`_select_authenticated` — so this is
 * two more bounded, indexed lookups by primary key, not a widened exposure.
 *
 * Batched by id rather than N+1: the row counts here are the same 200-row cap
 * find_dances_near already carries.
 */
async function attachNightDetails(
  client: SupabaseClient<Database>,
  dances: NearbyDance[],
): Promise<NearbyDance[]> {
  if (dances.length === 0) return dances;

  const venueIds = [...new Set(dances.map((dance) => dance.venueId))];
  const occurrenceIds = dances.map((dance) => dance.occurrenceId);

  const eventIds = [...new Set(dances.map((dance) => dance.eventId))];
  const [venuesResult, occurrencesResult, eventsResult] = await Promise.all([
    client.from("venues").select("id, address").in("id", venueIds),
    client.from("event_occurrences").select("id, ends_at").in("id", occurrenceIds),
    client.from("dance_events").select("id, flyer_path").in("id", eventIds),
  ]);

  if (venuesResult.error) throw venuesResult.error;
  if (occurrencesResult.error) throw occurrencesResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const addressByVenueId = new Map(venuesResult.data.map((row) => [row.id, row.address]));
  const endsAtByOccurrenceId = new Map(
    occurrencesResult.data.map((row) => [row.id, row.ends_at]),
  );
  const flyerUrlByEventId = new Map(
    eventsResult.data.map((row) => [row.id, publicDanceFlyerUrl(client, row.flyer_path)]),
  );

  return dances.map((dance) => ({
    ...dance,
    venueAddress: addressByVenueId.get(dance.venueId) ?? "",
    endsAt: endsAtByOccurrenceId.get(dance.occurrenceId) ?? dance.startsAt,
    flyerUrl: flyerUrlByEventId.get(dance.eventId) ?? null,
  }));
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

  return attachNightDetails(client, (data ?? []).map(toNearbyDance));
}

/**
 * The caller's favorited dances' upcoming nights — including cancelled and
 * moved ones, exactly like findDancesNear (AGENTS.md §10: a follower must
 * learn a night is off, never just find an absence). Delegates to
 * find_favorite_nights (migration 0012), find_dances_near's sibling: same
 * shape, filtered by event id instead of distance, for the same reason
 * docs/decisions/0005 gives — PostgREST cannot express the
 * coalesce(override_venue_id, venue_id) join it needs.
 *
 * Takes the event ids rather than a user id: the caller (favoritesActions.ts)
 * has already read them from `favorites`, which IS the ownership boundary
 * (favorites_select_own) — this function does not re-check ownership, because
 * event_occurrences and dance_events are public-readable regardless (see the
 * note on this RPC's grant in migration 0012).
 */
export async function findFavoriteNights(
  client: SupabaseClient<Database>,
  eventIds: readonly string[],
): Promise<NearbyDance[]> {
  if (eventIds.length === 0) return [];

  const { data, error } = await client.rpc("find_favorite_nights", {
    p_event_ids: eventIds as string[],
  });

  if (error) throw error;

  return attachNightDetails(client, (data ?? []).map(toNearbyDance));
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
    level: DanceLevel;
    danceFormations: DanceFormation[];
    womenOnly: boolean;
  },
): Promise<PublishedDance> {
  const { data, error } = await client
    .rpc("publish_dance", {
      p_instructor_id: dance.instructorId,
      p_venue_id: dance.venueId,
      p_starts_at: dance.startsAtUtc,
      p_ends_at: dance.endsAtUtc,
      p_level: dance.level,
      p_dance_formations: dance.danceFormations,
      p_women_only: dance.womenOnly,
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
    level: DanceLevel;
    danceFormations: DanceFormation[];
    womenOnly: boolean;
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
      p_level: dance.level,
      p_dance_formations: dance.danceFormations,
      p_women_only: dance.womenOnly,
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
