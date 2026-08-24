import { appearanceFor } from "@/components/danceStatusAppearance";
import type { OwnNight } from "@/lib/db/nights";
import {
  formatDayHeading,
  formatStartTime,
  jerusalemTimeField,
} from "./occurrenceTime";
import { he } from "@/lib/i18n/he";

/**
 * One of an instructor's own nights, with everything the manage list needs
 * already turned into a display string.
 *
 * The same split `mapDance.ts` makes, for the same reason (AGENTS.md §2.9): the
 * controls under each night need state, so they are a client component, and a
 * client component that formatted its own dates would pull `Intl`, the `he`
 * dictionary and the status-to-class table into the bundle. Everything here is
 * computed on the server; the browser gets strings.
 *
 * Pure and DOM-free, so it is testable without jsdom (AGENTS.md §3).
 */
export interface ManageableNight {
  id: string;
  /** "יום שני, 17 באוגוסט" — the night's own date, its heading in the list. */
  dayText: string;
  /** "20:00", for display. */
  time: string;
  /** "20:00", in the shape `<input type="time">` requires. */
  startTimeField: string;
  /** "23:00", same. */
  endTimeField: string;
  /**
   * "יום שני, 17 באוגוסט בשעה 20:00" — names WHICH night a control acts on.
   * Twelve buttons all called "שינוי" are twelve identical announcements to a
   * screen reader user, and an unrecoverable mis-tap for everyone else.
   */
  whenText: string;
  venueName: string;
  /** "בוטל" / "המיקום שונה" / "הועבר מ-20:00", or null for an ordinary night. */
  statusLabel: string | null;
  statusBadgeClassName: string;
  /**
   * Cancelling is the one thing that cannot be undone from this screen, so a
   * night that is already off shows no cancel control at all rather than one
   * that would do nothing.
   */
  cancelled: boolean;
  /** What the instructor told the dancers, if anything. */
  cancellationText: string | null;
}

export function toManageableNight(night: OwnNight): ManageableNight {
  const time = formatStartTime(night.startsAt);
  const dayText = formatDayHeading(night.startsAt);
  const { statusLabel, statusBadgeClassName } = appearanceFor(
    night.status,
    night.originalStartsAt,
  );

  const cancelled = night.status === "cancelled";

  return {
    id: night.id,
    dayText,
    time,
    startTimeField: jerusalemTimeField(night.startsAt),
    endTimeField: jerusalemTimeField(night.endsAt),
    whenText: he.manageNights.whenText(dayText, time),
    venueName: night.venueName,
    statusLabel,
    statusBadgeClassName,
    cancelled,
    cancellationText: !cancelled
      ? null
      : night.cancellationReason === null
        ? he.manageNights.cancelledNoReason
        : he.manageNights.cancelledOn(night.cancellationReason),
  };
}

export function toManageableNights(nights: readonly OwnNight[]): ManageableNight[] {
  return nights.map(toManageableNight);
}
