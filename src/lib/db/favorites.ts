import type { Client } from "./client";

/**
 * A signed-in dancer's saved dances (Phase 4.5) — reading the caller's own
 * favorited event ids, adding one, removing one.
 *
 * Every function here runs through the CALLER's session, never `service_role`
 * (AGENTS.md §8) — the same stance publisher.ts and nights.ts take. Migration
 * 0012's `favorites_select_own` / `_insert_own` / `_delete_own` enforce the
 * same ownership independently at the database; the explicit `.eq("user_id",
 * …)` calls below are defense in depth, the same stance `updateOwnProfile`
 * takes, not the actual boundary.
 */

/**
 * The caller's own favorited event ids. Explicitly filtered rather than
 * trusting `favorites_select_own` alone, for the same reason `findOwnProfile`
 * writes its own `.eq` — this function should not depend on which policy
 * happens to be attached to the table.
 */
export async function findOwnFavoriteEventIds(
  client: Client,
  userId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("favorites")
    .select("event_id")
    .eq("user_id", userId);

  if (error) throw error;

  return data.map((row) => row.event_id);
}

/**
 * Favorites one dance for the caller.
 *
 * `user_id` is passed explicitly rather than left to the column's `auth.uid()`
 * default, the same stance `createOwnProfile` takes on `id` — the actual
 * enforcement is `favorites_insert_own`'s WITH CHECK either way (migration
 * 0012), which refuses a value that does not match the caller's own session
 * regardless of whether this function ever calls it.
 *
 * Idempotent: `upsert` with `ignoreDuplicates` turns a second favorite of the
 * same dance into a silent no-op rather than a unique-constraint error a
 * dancer would otherwise see on a double tap or two racing tabs.
 */
export async function addFavorite(
  client: Client,
  favorite: { userId: string; eventId: string },
): Promise<void> {
  const { error } = await client.from("favorites").upsert(
    { user_id: favorite.userId, event_id: favorite.eventId },
    { onConflict: "user_id,event_id", ignoreDuplicates: true },
  );

  if (error) throw error;
}

/**
 * Un-favorites one dance for the caller.
 *
 * Also idempotent: unlike `cancelNight`, a delete matching zero rows here is
 * never "somebody else's favorite" — `.eq("user_id", …)` already narrows to
 * the caller's own, and `favorites_delete_own` would refuse anyone else's row
 * regardless — so zero rows only ever means "wasn't favorited to begin
 * with", which is not a failure worth reporting back.
 */
export async function removeFavorite(
  client: Client,
  favorite: { userId: string; eventId: string },
): Promise<void> {
  const { error } = await client
    .from("favorites")
    .delete()
    .eq("user_id", favorite.userId)
    .eq("event_id", favorite.eventId);

  if (error) throw error;
}
