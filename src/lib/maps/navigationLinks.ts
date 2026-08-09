/**
 * Deep links that hand turn-by-turn navigation to an app that already does it
 * (AGENTS.md §9 — navigation is delegated, not built). Waze first: it is what
 * this audience in Israel actually drives with.
 *
 * Pure string builders, no DOM and no env, so they are testable without jsdom
 * and survive the Capacitor wrap (AGENTS.md §3).
 */

export interface NavigationTarget {
  lat: number;
  lng: number;
}

/**
 * Six decimals is ~0.1m — far finer than a hall needs, and it keeps the URL
 * short and stable instead of pasting a float's full repr into a link a dancer
 * might share. Also sidesteps exponent notation ("1e-7") ever reaching a URL.
 */
const COORD_DECIMALS = 6;

function coordinate(value: number, name: string, limit: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    throw new Error(`${name} must be a finite number within ±${limit}, got ${value}`);
  }
  return value.toFixed(COORD_DECIMALS);
}

function coordinates(target: NavigationTarget): { lat: string; lng: string } {
  return {
    lat: coordinate(target.lat, "lat", 90),
    lng: coordinate(target.lng, "lng", 180),
  };
}

/**
 * Waze's universal deep link. `navigate=yes` starts the drive rather than only
 * dropping a pin, which is the whole point of handing off.
 *
 * Coordinates, never the venue's name: the name is a label a human typed, and
 * asking Waze to search for it can land a dancer at a different hall with a
 * similar name. The point in `venues.location` is the authoritative answer to
 * "where", the same way docs/decisions/0003 makes override_venue_id
 * authoritative over status.
 */
export function wazeNavigationUrl(target: NavigationTarget): string {
  const { lat, lng } = coordinates(target);
  return `https://www.waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
}

/**
 * Google Maps' documented Maps URLs API. Secondary to Waze, offered because a
 * dancer who does not have Waze installed still has to be able to get there.
 */
export function googleMapsNavigationUrl(target: NavigationTarget): string {
  const { lat, lng } = coordinates(target);
  return `https://www.google.com/maps/dir/?api=1&destination=${lat}%2C${lng}`;
}
