import type { NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { formatStartTime, formatStartWeekday } from "@/lib/domain/occurrenceTime";
import { appearanceFor } from "@/components/danceStatusAppearance";
import { googleMapsNavigationUrl, wazeNavigationUrl } from "@/lib/maps/navigationLinks";
import { he } from "@/lib/i18n/he";

/**
 * One dance, with everything the map needs already turned into display strings.
 *
 * The point of this shape is what it keeps OUT of the browser. `DanceMap` is
 * the screen's one client component, and if it formatted times and looked up
 * Hebrew itself it would drag `he` — a dictionary that only grows — and the
 * `Intl` formatter setup into the client bundle, which is exactly the split
 * docs/decisions/0007 established for TabBar and DanceRingScroller (AGENTS.md
 * §2.9). Everything here is computed on the server: by the map page for the
 * first render, and by the route handler behind the "near me" control for the
 * refined one, so both paths produce identical shapes.
 *
 * Pure and DOM-free, so it is testable without jsdom (AGENTS.md §3).
 */
export interface MapDance {
  occurrenceId: string;
  lat: number;
  lng: number;
  venueName: string;
  /** "יום שני, 20:30" — already in Asia/Jerusalem (AGENTS.md §7). */
  timeText: string;
  /** "עם רונית מרקידה". */
  instructorText: string;
  /** Drives the pin's silhouette. The client redraws from this, so it stays typed. */
  status: OccurrenceStatus;
  /** "בוטל" / "הועבר", or null for a night with nothing to warn about. */
  statusLabel: string | null;
  /**
   * Resolved here rather than in the component so the preview's badge is the
   * same one the rings and the schedule draw — `danceStatusAppearance` imports
   * `he`, and importing it client-side would pull the dictionary into the
   * bundle this whole module exists to keep it out of.
   */
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
  const { statusLabel, statusBadgeClassName } = appearanceFor(dance.status);
  const target = { lat: dance.venueLat, lng: dance.venueLng };

  return {
    occurrenceId: dance.occurrenceId,
    lat: dance.venueLat,
    lng: dance.venueLng,
    venueName: dance.venueName,
    timeText: `${weekday}, ${time}`,
    instructorText: he.dance.withInstructor(dance.instructorDisplayName),
    status: dance.status,
    statusLabel,
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
