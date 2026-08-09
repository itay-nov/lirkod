/**
 * The region the app queries before it knows where the user is: a fixed point in
 * central Tel Aviv (Rabin Square) and a radius that covers Gush Dan.
 *
 * Shared by every screen that reads find_dances_near, rather than redeclared per
 * page, so the map and the schedule cannot drift apart and start describing
 * different "near you" — the schedule is meant to be the same dances the map
 * shows, listed by day.
 *
 * AGENTS.md §9 is explicit that the first render must never wait on a
 * permission prompt, so this default is rendered unconditionally. The map's
 * "הצגת הרקדות לידי" control is the only thing that ever asks, and only when a
 * dancer presses it.
 */
export const DEFAULT_LAT = 32.0809;
export const DEFAULT_LNG = 34.7806;
export const DEFAULT_RADIUS_METERS = 15_000;

/**
 * The radius used once a dancer has actually granted location — smaller than
 * the default, not larger.
 *
 * 15km is padding around a guess: the centre is a fixed point in Tel Aviv that
 * may be nowhere near the person reading, so the radius has to be wide enough
 * to still catch them. Once the centre IS the person, that padding is what was
 * buying the coverage, and spending it on distance instead means offering a
 * 60-year-old dancer a hall 15km away as "לידי". 10km is roughly the far edge
 * of a reasonable evening drive across Gush Dan.
 */
export const LOCATED_RADIUS_METERS = 10_000;
