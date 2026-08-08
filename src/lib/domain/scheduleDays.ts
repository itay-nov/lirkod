import type { NearbyDance } from "@/lib/db/dances";
import { jerusalemDayKey } from "@/lib/domain/occurrenceTime";

/** One calendar day's worth of dances, in start-time order. */
export interface DanceDay {
  /** "YYYY-MM-DD" in Asia/Jerusalem — a grouping identity, never displayed. */
  dayKey: string;
  /**
   * A non-empty tuple, not an array: a day exists here only because a dance
   * falls on it, and saying so in the type is what lets the header read
   * `dances[0].startsAt` under `noUncheckedIndexedAccess` without a `!` or an
   * unreachable empty-day branch to satisfy the compiler.
   */
  dances: [NearbyDance, ...NearbyDance[]];
}

/**
 * Groups occurrences into Asia/Jerusalem calendar days (AGENTS.md §7), keeping
 * both the days and the dances within each day in the order they arrived.
 *
 * A `Map` rather than a "start a new group when the key changes" scan over the
 * sorted rows. The scan is shorter, but it quietly depends on find_dances_near
 * keeping its `order by starts_at` — and if that ever changed, the failure would
 * not be an error, it would be one day rendered as two separate headers further
 * down the screen. A Map keyed by day cannot produce that, whatever order the
 * rows arrive in, and it still preserves first-seen order for free.
 *
 * Sorting the days here is deliberately not done: the rows are already ordered
 * by the query, and re-sorting a "YYYY-MM-DD" string would be inventing a second
 * source of truth for chronology.
 */
export function groupDancesByDay(dances: readonly NearbyDance[]): DanceDay[] {
  const days = new Map<string, [NearbyDance, ...NearbyDance[]]>();

  for (const dance of dances) {
    const dayKey = jerusalemDayKey(dance.startsAt);
    const existing = days.get(dayKey);

    if (existing === undefined) {
      days.set(dayKey, [dance]);
    } else {
      existing.push(dance);
    }
  }

  return [...days].map(([dayKey, dayDances]) => ({ dayKey, dances: dayDances }));
}
