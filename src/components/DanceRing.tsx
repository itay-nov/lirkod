import type { MapDance } from "@/lib/maps/mapDance";

/**
 * One dance occurrence, drawn as a ring rather than a card.
 *
 * Deliberately NOT interactive. It used to be a real `<button>` on the reasoning
 * that the detail route was the next task and the right element should be there
 * from the start — but there is still no such route and no click handler, so
 * what shipped was a focusable, enabled control that does nothing. That is worse
 * for this audience than a plain div: a keyboard or screen-reader user tabs to
 * it, presses Enter, and nothing happens, with no way to tell whether the app is
 * broken or slow (AGENTS.md §2). A non-interactive item at least reads as what
 * it is. The `<li>` around it is what a screen reader announces, and the visible
 * text — time, weekday, venue, instructor, status — is read in that order, which
 * is why there is no aria-label here either: naming a role-less element is
 * ignored by assistive tech.
 *
 * TODO(detail-route): when the dance detail screen lands at
 * `src/app/(public)/dance/[occurrenceId]/page.tsx` (AGENTS.md §4 lists it as a
 * public route), this becomes a `next/link` — a link, not a button, because it
 * navigates — and gets its single whole-night accessible name back. That string
 * is `he.dance.mapPinLabel`, which the map's pins already use for exactly this
 * reason; it is named for its consumer, so give it a neutral name rather than a
 * second copy. DanceRow needs the identical treatment at the same time.
 *
 * Renders `MapDance` — the same server-built view model the pins are drawn
 * from — rather than formatting a `NearbyDance` itself. That is what lets the
 * list follow a dancer who presses "הצגת הרקדות לידי": `NearbyDances` holds one
 * array of these and hands it to both views, so the rings cannot describe a
 * different region from the pins above them. It also means this component
 * renders strings and nothing else, so being pulled into the client bundle by
 * that owner costs no dictionary, no `Intl` setup and no status logic (§2.9).
 */
export function DanceRing({ dance }: { dance: MapDance }) {
  const { ringClassName, statusLabel, statusBadgeClassName, timeClassName } = dance;

  return (
    <div
      // Width is set so ~2.5 rings fit a 375px screen: the half-visible third
      // ring is the cue that the list scrolls sideways, and this audience does
      // not go hunting for content it cannot see (AGENTS.md §2.7). It is in rem,
      // so it grows with the text rather than squeezing it at 200%.
      className="flex w-32 shrink-0 snap-start flex-col items-center gap-2 rounded-2xl p-2 text-center"
    >
      <span
        className={`flex size-[4.5rem] items-center justify-center rounded-full border-4 ${ringClassName}`}
      >
        <span className={`font-display font-extrabold ${timeClassName}`}>{dance.time}</span>
      </span>

      <span className="flex flex-col gap-1">
        <span className="font-semibold">{dance.weekday}</span>
        <span>{dance.venueName}</span>
        <span className="text-secondary">{dance.instructorName}</span>
      </span>

      {statusLabel !== null && (
        <span className={`rounded-full px-3 py-1 font-bold ${statusBadgeClassName}`}>
          {statusLabel}
        </span>
      )}
    </div>
  );
}
