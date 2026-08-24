import type { ReactNode } from "react";
import Image from "next/image";
import { appearanceFor } from "@/components/danceStatusAppearance";
import type { NearbyDance } from "@/lib/db/dances";
import { formatStartTime } from "@/lib/domain/occurrenceTime";
import { he } from "@/lib/i18n/he";

/**
 * One dance occurrence as a compact list row — the schedule's denser take on
 * DanceRing, for a screen that shows a whole day at a time instead of the
 * three-or-so nights the hero's horizontal scroller holds.
 *
 * It shares DanceRing's status appearance verbatim (see danceStatusAppearance)
 * and differs from it only in layout: the ring sits beside the text on one line
 * rather than above a stacked card. That is the entire divergence, and it is why
 * the status logic lives in a module both import rather than being reimplemented
 * here — a dashed ring has to mean "המיקום שונה" on every screen that draws one.
 *
 * Non-interactive on its OWN account, for the same reason the ring is — see
 * the comment on DanceRing, including where the detail route that turns both
 * into links is meant to land. The two must change together; a row that
 * navigates and a ring that does not would be two screens disagreeing about
 * what a dance is.
 *
 * `action` is the one exception, added in Phase 4.5, and it is not that same
 * kind of control: the heart toggle is a real, fully-functional action in its
 * own right, not a stub waiting on a route that does not exist yet — the
 * exact distinction that comment draws. A caller that omits `action` gets a
 * row with zero interactive elements, unchanged from before.
 *
 * Still no `"use client"` on this file — the row itself renders on the server
 * and ships no JavaScript. `action` is typed `ReactNode` rather than imported
 * as a component, so a server caller can hand this a client element (a
 * `FavoriteButton`) without this file needing to know that, or ship its
 * client bundle.
 */
export function DanceRow({ dance, action }: { dance: NearbyDance; action?: ReactNode }) {
  const { ringClassName, statusLabel, statusBadgeClassName, timeClassName } = appearanceFor(
    dance.status,
    dance.originalStartsAt,
  );

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
      //
      // flex-wrap, added alongside the heart in Phase 4.5: the ring, the
      // status badge and the heart are all shrink-0 (fixed, deliberately —
      // shrinking a 48px control below its own tap-target floor to make room
      // is not a legal move under §5 either), and at 200% text on a 375px
      // phone their combined width can exceed the row. Wrapping the trailing
      // badge+heart cluster onto its own line is what stands in for shrinking
      // them; the alternative — letting the venue name's column absorb the
      // deficit — is the exact "clientWidth: 7px" bug this comment exists to
      // explain, found live rather than reasoned about in the abstract.
      className="flex w-full flex-wrap items-center gap-3 rounded-2xl p-2 text-start"
    >
      {dance.flyerUrl !== null && (
        <Image
          src={dance.flyerUrl}
          alt={he.dance.flyerAlt(dance.instructorDisplayName)}
          width={80}
          height={80}
          className="size-20 shrink-0 rounded-xl object-cover"
        />
      )}
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

        min-w-24, not min-w-0: a genuine floor below which this column refuses
        to shrink further, so at 200% it is the trailing badge+heart cluster
        that wraps to its own line once space runs out — never this column
        being squeezed down to an unreadable sliver. A long venue name still
        wraps freely inside that floor; the floor only stops the DEFICIT from
        landing here instead of there.
      */}
      <span className="flex min-w-24 flex-1 flex-col">
        <span className="font-semibold">{dance.venueName}</span>
        <span className="text-secondary">{dance.instructorDisplayName}</span>
      </span>

      {(statusLabel !== null || action) && (
        // ms-auto keeps this cluster pinned to the row's trailing edge
        // whether it shares the first line with the ring and venue or, once
        // that line is full, wraps onto a line of its own beneath them.
        <div className="ms-auto flex shrink-0 items-center gap-2">
          {statusLabel !== null && (
            <span className={`rounded-full px-3 py-1 font-bold ${statusBadgeClassName}`}>
              {statusLabel}
            </span>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
