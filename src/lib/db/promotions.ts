import type { Client } from "./client";

/**
 * The read side of sponsored promotions (docs/decisions/0026).
 *
 * There is exactly one function here and there is meant to be exactly one.
 * `public.sponsored_promotions` is unreadable from any client — no anon grant,
 * and `authenticated` only reaches an instructor's own rows (migration 0016,
 * docs/decisions/0025) — so this module deliberately does NOT wrap that table.
 * It wraps `get_active_promoted_event_ids`, the narrow SECURITY DEFINER window
 * migration 0017 opened, which returns event ids and nothing else.
 *
 * If a future feature needs a promotion's price, window, or instructor, it does
 * not belong in this file: that is a signed-in instructor reading their own
 * rows through RLS, not a widening of the anonymous window.
 */

/**
 * Event ids that are promoted right now — paid, not cancelled, inside their
 * active window.
 *
 * `p_area` is left unset, which the function reads as "every area". Nothing on
 * this side has an area string to pass: `venues` has no area or city column and
 * the schedule queries by (lat, lng, radius). Migration 0017's header explains
 * why that parameter exists anyway and what it is reserved for.
 *
 * Returns a `Set` rather than an array because every caller asks the same
 * question of it — "is this one promoted" — once per dance in a list.
 */
export async function findActivePromotedEventIds(client: Client): Promise<Set<string>> {
  const { data, error } = await client.rpc("get_active_promoted_event_ids");

  if (error) throw error;

  return new Set((data ?? []).map((row) => row.event_id));
}
