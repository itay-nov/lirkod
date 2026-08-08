import { appearanceFor } from "@/components/danceStatusAppearance";
import type { NearbyDance } from "@/lib/db/dances";
import { formatStartTime } from "@/lib/domain/occurrenceTime";

/**
 * One dance occurrence as a compact list row — the schedule's denser take on
 * DanceRing, for a screen that shows a whole day at a time instead of the
 * three-or-so nights the hero's horizontal scroller holds.
 *
 * It shares DanceRing's status appearance verbatim (see danceStatusAppearance)
 * and differs from it only in layout: the ring sits beside the text on one line
 * rather than above a stacked card. That is the entire divergence, and it is why
 * the status logic lives in a module both import rather than being reimplemented
 * here — a dashed ring has to mean "הועבר" on every screen that draws one.
 *
 * Also non-interactive, for the same reason the ring is — see the comment on
 * DanceRing, including where the detail route that turns both into links is
 * meant to land. The two must change together; a row that navigates and a ring
 * that does not would be two screens disagreeing about what a dance is.
 *
 * No `"use client"` — this renders on the server and ships no JavaScript.
 */
export function DanceRow({ dance }: { dance: NearbyDance }) {
  const { ringClassName, statusLabel, statusBadgeClassName, timeClassName } =
    appearanceFor(dance.status);

  // No weekday here, unlike DanceRing: the row's day is the <h2> the schedule
  // groups it under, and the surrounding <ul> is labelled with it too. It used
  // to be repeated in this element's aria-label for someone who tabbed straight
  // onto the row past the header — which is not reachable now that nothing here
  // is a tab stop.
  const time = formatStartTime(dance.startsAt);

  return (
    <div
      // w-full and text-start, not text-right: the row must fill the list and
      // align to the reading direction, which is a logical property so it
      // follows dir="rtl" rather than hardcoding a side (AGENTS.md §7).
      className="flex w-full items-center gap-3 rounded-2xl p-2 text-start"
    >
      <span
        // shrink-0 so the ring keeps its shape when a long venue name pushes
        // against it, and size in rem so it grows with the text at 200% (§2.4).
        className={`flex size-16 shrink-0 items-center justify-center rounded-full border-4 ${ringClassName}`}
      >
        <span className={`font-display font-extrabold ${timeClassName}`}>{time}</span>
      </span>

      {/*
        These wrap rather than truncate. Truncating is the tidier-looking option
        and was the first thing here, but at 200% text on a 375px screen it cut
        "היכל התרבות חולון" down to "היכל …" — and which hall it is happens to be
        the single most important thing on the row. AGENTS.md §2.4 asks for a
        layout that stays *usable* at 200%, not merely one that doesn't overflow,
        and an ellipsis where the venue should be fails that for exactly the
        low-vision readers the rule exists for. Wrapping costs vertical space on
        a list that already scrolls.

        min-w-0 is still needed: without it a flex item's automatic minimum size
        is its content width, so a long name would push the row wider instead of
        wrapping inside it.
      */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{dance.venueName}</span>
        <span className="text-secondary">{dance.instructorDisplayName}</span>
      </span>

      {statusLabel !== null && (
        <span
          className={`shrink-0 rounded-full px-3 py-1 font-bold ${statusBadgeClassName}`}
        >
          {statusLabel}
        </span>
      )}
    </div>
  );
}
