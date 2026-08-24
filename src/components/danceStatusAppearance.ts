import type { OccurrenceStatus } from "@/lib/db/dances";
import { formatStartTime } from "@/lib/domain/occurrenceTime";
import { he } from "@/lib/i18n/he";

export interface DanceStatusAppearance {
  /** Ring stroke: solid / dashed / muted — never the ONLY carrier of status. */
  ringClassName: string;
  /** The word a dancer reads. `null` for a normal dance, which needs no label. */
  statusLabel: string | null;
  statusBadgeClassName: string;
  timeClassName: string;
}

/**
 * How a dance's status looks, for every component that draws one.
 *
 * Extracted from DanceRing when the schedule's compact row appeared: the two
 * differ only in layout, and the status convention — dashed for "המיקום שונה", muted
 * and struck through for "בוטל", always with the word visible — is precisely
 * the part that must not drift between them. A dancer who learns what a dashed
 * ring means on the map has to find the same thing on the schedule.
 *
 * A plain module, not a hook or a component: it holds no state and touches no
 * DOM, so both Server Components can call it without shipping any JavaScript.
 *
 * A real `switch` on the database enum, not a lookup keyed by a class name:
 * TypeScript's exhaustiveness check is what guarantees a fourth
 * `occurrence_status` cannot be added without this file failing to compile —
 * which is exactly the failure mode AGENTS.md §10 calls the product's most
 * important moment (a moved or cancelled dance rendering as if it were normal).
 *
 * `originalStartsAt` is the second argument rather than a fourth enum value for
 * a reason the schema forced and docs/decisions/0003 predicted: a night moved to
 * a different HOUR keeps `status = 'scheduled'`, because 'moved' is reserved for
 * a venue change and is forbidden without one. Left to the status alone, a
 * re-timed night would render as an ordinary one — a dancer arriving an hour
 * late to a hall that is emptying, told nothing, which is §10's failure wearing
 * a different hat. Migration 0010 added the column so this function can see it.
 */
export function appearanceFor(
  status: OccurrenceStatus,
  /** The hour this night used to start at, or null if nobody moved it. */
  originalStartsAt: string | null = null,
): DanceStatusAppearance {
  switch (status) {
    case "scheduled":
      // A re-timed night borrows the dashed ring from 'moved' on purpose: the
      // ring means "something about this night is not what it was, read the
      // label", and the label is what distinguishes them (AGENTS.md §2.6 —
      // never state by shape or colour alone).
      if (originalStartsAt !== null) {
        return {
          ringClassName: "border-dashed border-secondary",
          statusLabel: he.dance.status.retimedFrom(formatStartTime(originalStartsAt)),
          statusBadgeClassName: "bg-highlight text-ink",
          timeClassName: "",
        };
      }

      return {
        ringClassName: "border-solid border-accent",
        statusLabel: null,
        statusBadgeClassName: "",
        timeClassName: "",
      };
    // A night moved to another hall AND to another hour shows the venue label
    // only. That is the one a dancer must not miss — the new hour is already the
    // time printed on the row, whereas the new address is not written anywhere
    // else on these screens (docs/decisions/0003: override_venue_id is
    // authoritative for WHERE).
    case "moved":
      return {
        ringClassName: "border-dashed border-secondary",
        statusLabel: he.dance.status.moved,
        // Gold fails contrast as a text colour but passes as a fill with ink on
        // top (6.5:1) — see the token table in globals.css.
        statusBadgeClassName: "bg-highlight text-ink",
        timeClassName: "",
      };
    case "cancelled":
      return {
        ringClassName: "border-solid border-muted",
        statusLabel: he.dance.status.cancelled,
        statusBadgeClassName: "bg-ink text-surface",
        // A second non-colour cue on top of the muted ring and the word "בוטל".
        timeClassName: "line-through decoration-2",
      };
  }
}
