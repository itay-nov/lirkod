import type { NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { formatStartTime, formatStartWeekday } from "@/lib/domain/occurrenceTime";
import { appearanceFor } from "@/components/danceStatusAppearance";
import { googleMapsNavigationUrl, wazeNavigationUrl } from "@/lib/maps/navigationLinks";
import { he } from "@/lib/i18n/he";

/**
 * One dance, with everything the hero screen needs already turned into display
 * strings.
 *
 * Named for the map because that is the screen it belongs to, but it now feeds
 * **both** views on that screen: the map's pins and the ring list underneath.
 * That is the point rather than an accident. The two used to be built from two
 * different sources — the list from the server's default-region render, the
 * pins from whatever the map held after "near me" — and they silently disagreed
 * the moment a dancer was located: pins around them, a list still describing Tel
 * Aviv. One shape, built once, is what makes that unrepresentable.
 *
 * The other point of this shape is what it keeps OUT of the browser. The hero
 * screen's client components render these strings and nothing else, so no `he`
 * dictionary, no `Intl` formatter setup and no status-to-class logic is shipped
 * — the split docs/decisions/0007 established for TabBar and DanceRingScroller
 * (AGENTS.md §2.9). Everything here is computed on the server: by the map page
 * for the first render, and by the route handler behind the "near me" control
 * for the refined one, so both paths produce identical shapes.
 *
 * Pure and DOM-free, so it is testable without jsdom (AGENTS.md §3).
 */
export interface MapDance {
  occurrenceId: string;
  lat: number;
  lng: number;
  venueName: string;
  /** "20:30" — already in Asia/Jerusalem (AGENTS.md §7). */
  time: string;
  /** "יום שני". */
  weekday: string;
  /**
   * "יום שני, 20:30". Kept alongside the two parts rather than joined in the
   * component: where the comma goes is a formatting decision, and formatting
   * decisions live on this side of the boundary.
   */
  timeText: string;
  /** "רונית מרקידה" — the ring shows the bare name. */
  instructorName: string;
  /** "עם רונית מרקידה" — the preview reads as a sentence. */
  instructorText: string;
  /** Drives the pin's silhouette. The client redraws from this, so it stays typed. */
  status: OccurrenceStatus;
  /** "בוטל" / "הועבר", or null for a night with nothing to warn about. */
  statusLabel: string | null;
  /**
   * The three status classes come from `appearanceFor`, resolved here rather
   * than in the components, so the ring, the preview badge and the schedule all
   * draw one convention — `danceStatusAppearance` imports `he`, and importing it
   * client-side would pull the dictionary into the bundle this module exists to
   * keep it out of.
   */
  ringClassName: string;
  timeClassName: string;
  statusBadgeClassName: string;
  /** The marker's accessible name: the whole night in one string. */
  pinLabel: string;
  wazeUrl: string;
  wazeLabel: string;
  googleMapsUrl: string;
  googleMapsLabel: string;
}

export function toMapDance(dance: NearbyDance): MapDance {
  const time = formatStartTime(dance.startsAt);
  const weekday = formatStartWeekday(dance.startsAt);
  const { statusLabel, statusBadgeClassName, ringClassName, timeClassName } =
    appearanceFor(dance.status);
  const target = { lat: dance.venueLat, lng: dance.venueLng };

  return {
    occurrenceId: dance.occurrenceId,
    lat: dance.venueLat,
    lng: dance.venueLng,
    venueName: dance.venueName,
    time,
    weekday,
    timeText: `${weekday}, ${time}`,
    instructorName: dance.instructorDisplayName,
    instructorText: he.dance.withInstructor(dance.instructorDisplayName),
    status: dance.status,
    statusLabel,
    ringClassName,
    timeClassName,
    statusBadgeClassName,
    pinLabel: he.dance.mapPinLabel({
      weekday,
      time,
      venue: dance.venueName,
      instructor: dance.instructorDisplayName,
      status: statusLabel,
    }),
    wazeUrl: wazeNavigationUrl(target),
    wazeLabel: he.map.preview.waze(dance.venueName),
    googleMapsUrl: googleMapsNavigationUrl(target),
    googleMapsLabel: he.map.preview.googleMaps(dance.venueName),
  };
}

export function toMapDances(dances: readonly NearbyDance[]): MapDance[] {
  return dances.map(toMapDance);
}
