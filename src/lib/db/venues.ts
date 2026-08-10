import type { Client } from "./client";
import type { NewVenueCommand } from "@/lib/domain/newVenue";

export interface VenueOption {
  id: string;
  name: string;
  address: string;
}

/**
 * How many halls one search may return.
 *
 * Bounded for the reason docs/decisions/0010 gives about occurrences: `venues`
 * became self-service in 3.2b, so it is no longer a table whose size we control,
 * and an unbounded select over it would grow into the same unbounded result set
 * migration 0003 set out to prevent — only slowly, and through a screen nobody
 * is watching. Twenty is more halls than anyone scrolls past before typing
 * another letter.
 */
const SEARCH_LIMIT = 20;

/**
 * PostgREST's `or` filter takes a comma-separated list, and a comma or a
 * parenthesis inside the pattern would be read as syntax rather than as text.
 * A `%` or `_` is a wildcard the caller does not get to choose either.
 */
function escapeForIlike(query: string): string {
  return query.replace(/[\\%_,().]/g, "\\$&");
}

/**
 * Halls matching `query`, by name or by address, newest naming conventions
 * aside — an instructor looks for "היכל" or for "חולון" and should find the same
 * hall either way.
 *
 * **Server-side, and that is the point of the change.** 3.2a filtered the whole
 * table in the browser, which was right while `venues` held three curated rows
 * and wrong the moment anyone could add one: the client would have to download
 * every hall in the country to find one. The query now runs in Postgres, bounded,
 * and the browser gets at most `SEARCH_LIMIT` rows.
 *
 * An empty query is not an error — it is the state the form opens in, and it
 * returns the first page alphabetically so there is something to pick before a
 * single key is pressed (AGENTS.md §2: fewer steps).
 *
 * `location` stays out of the select. Nothing on this screen puts a venue on a
 * map, and it is the one column here that is a PostGIS type needing decoding.
 */
export async function searchVenues(client: Client, query: string): Promise<VenueOption[]> {
  const trimmed = query.trim();

  let request = client.from("venues").select("id, name, address");

  if (trimmed !== "") {
    const pattern = `%${escapeForIlike(trimmed)}%`;
    request = request.or(`name.ilike.${pattern},address.ilike.${pattern}`);
  }

  const { data, error } = await request.order("name", { ascending: true }).limit(SEARCH_LIMIT);

  if (error) throw error;

  return data ?? [];
}

/**
 * Adds a venue from a Google Place, or hands back the one already recorded for
 * that place.
 *
 * Delegates to the `find_or_create_venue` RPC (migration 0007) rather than doing
 * select-then-insert here, and the difference matters: two instructors adding the
 * same hall at the same moment would both pass an application-level existence
 * check and one would then fail on the unique index. In the function it is one
 * transaction — `on conflict do nothing`, then select — so both converge on the
 * same row and the table gains exactly one.
 *
 * The RPC is SECURITY INVOKER, so this runs as the CALLER and the insert is
 * checked by `venues_insert_authenticated` and by the column-level grant. An
 * anonymous caller does not reach the insert at all: EXECUTE is granted to
 * `authenticated` only.
 */
export async function findOrCreateVenue(
  client: Client,
  venue: NewVenueCommand,
): Promise<VenueOption> {
  const { data, error } = await client
    .rpc("find_or_create_venue", {
      p_place_id: venue.placeId,
      p_name: venue.name,
      p_address: venue.address,
      p_lat: venue.lat,
      p_lng: venue.lng,
    })
    .single();

  if (error) throw error;

  return { id: data.id, name: data.name, address: data.address };
}
