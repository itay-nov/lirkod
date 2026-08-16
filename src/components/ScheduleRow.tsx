import type { ReactNode } from "react";
import type { MapDance } from "@/lib/maps/mapDance";

/**
 * `DanceRow`'s layout, rendered from `MapDance` instead of `NearbyDance`.
 *
 * A separate component rather than widening `DanceRow` itself: `DanceRow`
 * imports `appearanceFor` (which imports `he`) and `formatStartTime`, and
 * both stay fine as long as every caller renders on the server — which
 * `DanceRow`'s other caller (`/profile`'s favorites list) still does. This
 * component exists because `ScheduleList.tsx` (Phase 4.6b) is a CLIENT
 * component — the schedule's filter has to re-render on every change — and a
 * client-rendered `DanceRow` would ship the whole `he` dictionary and an
 * `Intl` formatter setup into the browser (docs/decisions/0007's split,
 * AGENTS.md §2.9). `MapDance` already carries every one of these fields
 * pre-formatted, the same way `DanceRing` avoids the same problem.
 *
 * Kept in step with `DanceRow`'s markup on purpose: the schedule's filtered
 * list and the server-rendered favorites list must not visibly disagree
 * about what a row looks like.
 */
export function ScheduleRow({ dance, action }: { dance: MapDance; action?: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-3 rounded-2xl p-2 text-start">
      <span
        className={`flex size-16 shrink-0 items-center justify-center rounded-full border-4 ${dance.ringClassName}`}
      >
        <span className={`font-display font-extrabold ${dance.timeClassName}`}>
          {dance.time}
        </span>
      </span>

      <span className="flex min-w-24 flex-1 flex-col">
        <span className="font-semibold">{dance.venueName}</span>
        <span className="text-secondary">{dance.instructorName}</span>
      </span>

      {(dance.statusLabel !== null || action) && (
        <div className="ms-auto flex shrink-0 items-center gap-2">
          {dance.statusLabel !== null && (
            <span className={`rounded-full px-3 py-1 font-bold ${dance.statusBadgeClassName}`}>
              {dance.statusLabel}
            </span>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
