import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

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
