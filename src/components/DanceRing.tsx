import { appearanceFor } from "@/components/danceStatusAppearance";
import type { NearbyDance } from "@/lib/db/dances";
import { formatStartTime, formatStartWeekday } from "@/lib/domain/occurrenceTime";
import { he } from "@/lib/i18n/he";

/**
 * One dance occurrence, drawn as a ring rather than a card.
 *
 * A real `<button>`: it is in the tab order, takes Enter/Space, and shows a
 * focus ring, none of which a `<div onClick>` gives for free (AGENTS.md §2.7).
 * It has no click handler yet — the dance detail route is the next task — but
 * the element is the right one from the start rather than a div to be swapped
 * later.
 *
 * No `"use client"`: this renders on the server and ships no JavaScript, which
 * is what keeps the hero screen inside the §2.9 performance budget.
 */
export function DanceRing({ dance }: { dance: NearbyDance }) {
  const { ringClassName, statusLabel, statusBadgeClassName, timeClassName } =
    appearanceFor(dance.status);

  const time = formatStartTime(dance.startsAt);
  const weekday = formatStartWeekday(dance.startsAt);

  return (
    <button
      type="button"
      // The visible text is split across several nodes, and a button announces
      // as one thing. This label is that one thing: when, where, with whom, and
      // whether the night is still on. It overrides the child text for naming
      // purposes, so the children need no aria-hidden.
      aria-label={he.dance.ringLabel({
        weekday,
        time,
        venue: dance.venueName,
        instructor: dance.instructorDisplayName,
        status: statusLabel,
      })}
      // Width is set so ~2.5 rings fit a 375px screen: the half-visible third
      // ring is the cue that the list scrolls sideways, and this audience does
      // not go hunting for content it cannot see (AGENTS.md §2.7). It is in rem,
      // so it grows with the text rather than squeezing it at 200%.
      className="flex w-32 shrink-0 snap-start flex-col items-center gap-2 rounded-2xl p-2 text-center focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
    >
      <span
        className={`flex size-[4.5rem] items-center justify-center rounded-full border-4 ${ringClassName}`}
      >
        <span className={`font-display font-extrabold ${timeClassName}`}>{time}</span>
      </span>

      <span className="flex flex-col gap-1">
        <span className="font-semibold">{weekday}</span>
        <span>{dance.venueName}</span>
        <span className="text-secondary">{dance.instructorDisplayName}</span>
      </span>

      {statusLabel !== null && (
        <span className={`rounded-full px-3 py-1 font-bold ${statusBadgeClassName}`}>
          {statusLabel}
        </span>
      )}
    </button>
  );
}
