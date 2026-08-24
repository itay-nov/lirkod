import type { DanceFormation, DanceLevel, NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { formatStartTime, formatStartWeekday } from "@/lib/domain/occurrenceTime";
import { appearanceFor } from "@/components/danceStatusAppearance";
import { googleMapsNavigationUrl, wazeNavigationUrl } from "@/lib/maps/navigationLinks";
import { whatsAppShareUrl } from "@/lib/maps/shareLinks";
import { buildIcsEvent, icsDataUrl } from "@/lib/domain/calendarEvent";
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
  /** The series this night belongs to — what the heart toggle favorites, not the occurrence. */
  eventId: string;
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
  /**
   * "יום שני, 20:30–22:30" — `timeText` with the end time appended (Phase
   * 4.6c: the preview panel's day/time line, next to a clock icon). A
   * separate field rather than a replacement for `timeText`, which other
   * callers still use for the start time alone.
   */
  timeRangeText: string;
  /** "רונית מרקידה" — the ring shows the bare name. */
  instructorName: string;
  /** "עם רונית מרקידה" — the preview reads as a sentence. */
  instructorText: string;
  /**
   * "הרקדה עם רונית מרקידה" — the preview panel's heading (Phase 4.6c). The
   * same string `he.dance.title` already builds for the calendar event's
   * SUMMARY (Phase 4.6a); this just also reaches the screen now.
   */
  danceTitle: string;
  /** Drives the pin's silhouette. The client redraws from this, so it stays typed. */
  status: OccurrenceStatus;
  /** "בוטל" / "המיקום שונה", or null for a night with nothing to warn about. */
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
  /** wa.me, pre-filled with a plain-text summary of the night (Phase 4.6a). */
  shareUrl: string;
  shareLabel: string;
  /**
   * A `data:` .ics download, or null for a cancelled night — a calendar entry
   * for a dance that is off is not a "normal calendar event" (Phase 4.6a task).
   * The button that would use this simply does not render when it is null.
   */
  icsUrl: string | null;
  icsFilename: string;
  calendarLabel: string;
  /** Phase 4.6b — raw values, for the filter (src/lib/domain/danceFilter.ts). */
  level: DanceLevel;
  danceFormations: DanceFormation[];
  womenOnly: boolean;
  /**
   * The type/level tag the map preview card left unused (docs/decisions/0022)
   * — the formations' labels, then the level's, e.g. `["מעגלים", "זוגות",
   * "בינוני"]`. Always at least one entry: level always has a real value, so
   * showing it is truthful even when nothing was explicitly chosen (ADR
   * 0022's own "don't invent data" standard — this is not invented, it is
   * the stored default).
   */
  attributeTags: string[];
  /** "הרקדה לנשים בלבד", or null when the dance is not women_only — nothing renders when null. */
  womenOnlyLabel: string | null;
}

export function toMapDance(dance: NearbyDance): MapDance {
  const time = formatStartTime(dance.startsAt);
  const weekday = formatStartWeekday(dance.startsAt);
  const endTime = formatStartTime(dance.endsAt);
  const { statusLabel, statusBadgeClassName, ringClassName, timeClassName } = appearanceFor(
    dance.status,
    dance.originalStartsAt,
  );
  const target = { lat: dance.venueLat, lng: dance.venueLng };
  const googleMapsUrl = googleMapsNavigationUrl(target);

  const shareText = he.map.preview.shareText({
    instructor: dance.instructorDisplayName,
    weekday,
    timeRange: `${time}–${endTime}`,
    venue: dance.venueName,
    address: dance.venueAddress,
    status: statusLabel,
    mapsUrl: googleMapsUrl,
  });

  // A cancelled night gets no calendar entry at all (Phase 4.6a task) — an
  // added event nobody removes is worse than no button, and there is no
  // "cancelled" state for a dancer's own calendar app to show it in.
  const icsUrl =
    dance.status === "cancelled"
      ? null
      : icsDataUrl(
          buildIcsEvent({
            uid: dance.occurrenceId,
            title: he.dance.title(dance.instructorDisplayName),
            location: `${dance.venueName}, ${dance.venueAddress}`,
            startUtcIso: dance.startsAt,
            endUtcIso: dance.endsAt,
            now: new Date(),
          }),
        );

  return {
    eventId: dance.eventId,
    occurrenceId: dance.occurrenceId,
    lat: dance.venueLat,
    lng: dance.venueLng,
    venueName: dance.venueName,
    time,
    weekday,
    timeText: `${weekday}, ${time}`,
    timeRangeText: `${weekday}, ${time}–${endTime}`,
    instructorName: dance.instructorDisplayName,
    instructorText: he.dance.withInstructor(dance.instructorDisplayName),
    danceTitle: he.dance.title(dance.instructorDisplayName),
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
    googleMapsUrl,
    googleMapsLabel: he.map.preview.googleMaps(dance.venueName),
    shareUrl: whatsAppShareUrl(shareText),
    shareLabel: he.map.preview.shareWhatsapp,
    icsUrl,
    icsFilename: `${dance.occurrenceId}.ics`,
    calendarLabel: he.map.preview.addToCalendar,
    level: dance.level,
    danceFormations: dance.danceFormations,
    womenOnly: dance.womenOnly,
    attributeTags: [
      ...dance.danceFormations.map((formation) => he.dance.formation[formation]),
      he.dance.level[dance.level],
    ],
    womenOnlyLabel: dance.womenOnly ? he.dance.womenOnly : null,
  };
}

export function toMapDances(dances: readonly NearbyDance[]): MapDance[] {
  return dances.map(toMapDance);
}
