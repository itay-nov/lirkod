import type { Client } from "./client";

export interface VenueOption {
  id: string;
  name: string;
  address: string;
}

/**
 * Every venue, for the create-dance pick list.
 *
 * Deliberately not paginated and not search-filtered in SQL. `venues` is a
 * curated table — three rows today, and it grows only when we add one, because
 * `authenticated` holds SELECT and nothing else on it (migration 0001). Filtering
 * happens in the browser over a list this size, which spends no round trip on
 * every keystroke and keeps the control usable with the network gone.
 *
 * The moment adding a venue becomes self-service (3.2b), this needs a bounded
 * query instead — the same reasoning docs/decisions/0010 applies to occurrences.
 * `location` is excluded because nothing on this screen puts a venue on a map;
 * it is also the one column here that is a PostGIS type and would need decoding.
 */
export async function listVenues(client: Client): Promise<VenueOption[]> {
  const { data, error } = await client
    .from("venues")
    .select("id, name, address")
    .order("name", { ascending: true });

  if (error) throw error;

  return data ?? [];
}
