/**
 * The region the app queries before it knows where the user is: a fixed point in
 * central Tel Aviv (Rabin Square) and a radius that covers Gush Dan.
 *
 * Shared by every screen that reads find_dances_near, rather than redeclared per
 * page, so the map and the schedule cannot drift apart and start describing
 * different "near you" — the schedule is meant to be the same dances the map
 * shows, listed by day.
 *
 * Real geolocation is a later task. AGENTS.md §9 is explicit that the first
 * render must never wait on a permission prompt, so this default is rendered
 * unconditionally and refined later once permission is granted.
 */
export const DEFAULT_LAT = 32.0809;
export const DEFAULT_LNG = 34.7806;
export const DEFAULT_RADIUS_METERS = 15_000;
