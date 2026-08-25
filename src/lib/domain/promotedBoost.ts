import type { NearbyDance } from "@/lib/db/dances";

/**
 * How far up the schedule a paid promotion moves a dance.
 *
 * The schedule is a chronological list, not a ranked one: `find_dances_near`
 * returns `order by starts_at` (migration 0003) and `groupDancesByDay` keeps
 * that order. So the boost is expressed in the currency the list actually sorts
 * in — time — by sorting a promoted dance as though it began this much earlier.
 * Its displayed time never changes; only its position does.
 *
 * Ninety minutes, and the number is doing real work. Israeli folk-dance
 * evenings in this data start on the hour or the half hour, mostly between
 * 19:00 and 21:30. Ninety minutes lets a promoted 21:00 dance sort above a
 * 21:30 and a 22:00 one — a genuine lift, roughly two or three places in a busy
 * evening — while leaving it below the 19:00 that opened the night. That is the
 * confirmed product line: a boost within the existing order, never a jump to
 * the top.
 *
 * A "modest" boost is not a hedge, it is the mechanism. A promoted dance that
 * always led the list would be an advertisement, and the same product decision
 * that forbids a "ממומן" label forbids the placement that would read as one.
 */
const BOOST_MINUTES = 90;

const BOOST_MS = BOOST_MINUTES * 60 * 1000;

/**
 * Reorders ONE day's dances so paid promotions sit a little higher.
 *
 * Takes a single day's list, never the whole schedule, and that is a
 * correctness property rather than a convenience. Applied across the flat
 * result the boost could pull a dance backwards past midnight into the previous
 * day's group — a dance appearing under yesterday's heading, which is a bug a
 * dancer would act on. Grouping first and boosting inside each group makes that
 * unrepresentable: a dance can only move among dances it already shares a
 * Jerusalem calendar day with.
 *
 * Stable. `Array.prototype.sort` has been required to be stable since ES2019,
 * so two dances with the same effective time keep the order
 * `find_dances_near` returned them in — which matters because the common case
 * is a tie: most nights start at the same handful of times, and an unstable
 * sort would shuffle unpromoted dances against each other for no reason on
 * every render.
 *
 * Pure and DOM-free, so it is testable without jsdom (AGENTS.md §3), and it
 * copies rather than sorting in place — the caller's array is
 * `groupDancesByDay`'s output and nothing else should observe a reorder.
 */
export function boostPromotedWithinDay(
  dances: readonly NearbyDance[],
  promotedEventIds: ReadonlySet<string>,
): NearbyDance[] {
  // Not merely an optimisation: with nothing promoted this returns the query's
  // own order untouched, so the schedule of a region with no promotions is
  // byte-for-byte what it was before this feature existed.
  if (promotedEventIds.size === 0) return [...dances];

  const effectiveTime = (dance: NearbyDance): number => {
    const startsAt = Date.parse(dance.startsAt);
    // NaN would make the comparator incoherent — every comparison against it
    // returns false — and an incoherent comparator does not sort the one bad
    // row to a wrong place, it leaves the whole day in arbitrary order. Rows
    // come from a `timestamptz` column and `groupDancesByDay` has already
    // parsed the same string to key the group, so reaching this line means
    // something upstream is already broken; sorting the row to the end of its
    // day is the containable failure.
    if (Number.isNaN(startsAt)) return Number.POSITIVE_INFINITY;

    return promotedEventIds.has(dance.eventId) ? startsAt - BOOST_MS : startsAt;
  };

  return [...dances].sort((a, b) => effectiveTime(a) - effectiveTime(b));
}
