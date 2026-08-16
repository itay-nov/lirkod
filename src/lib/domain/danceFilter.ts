import type { DanceFormation, DanceLevel } from "@/lib/db/dances";

/**
 * The level/type/women-only filter (Phase 4.6b) — pure and DOM-free so it is
 * testable without jsdom (AGENTS.md §3) and shared, unchanged, between the
 * map and the schedule filter components.
 *
 * Client-side, on the set find_dances_near already returned: the task allows
 * this for v1, and docs/decisions/0005 is why the proximity query itself
 * stays server-side — filtering that already-bounded result further is a
 * display concern, not a second query. The 200-row cap on that result (0003)
 * applies BEFORE this filter runs, same as it does for any other client-side
 * narrowing of the RPC's rows.
 */

/** No filter applied on any axis — every dance matches. */
export const EMPTY_DANCE_FILTER: DanceAttributeFilter = {
  level: null,
  formations: [],
  womenOnly: false,
};

export interface DanceAttributeFilter {
  /** null = every level matches. A specific value narrows to exactly that level. */
  level: DanceLevel | null;
  /** Empty = every formation matches. Non-empty = a dance must carry at least one. */
  formations: DanceFormation[];
  /** false = women-only is not required. true = only women_only dances match. */
  womenOnly: boolean;
}

export interface FilterableDance {
  level: DanceLevel;
  danceFormations: DanceFormation[];
  womenOnly: boolean;
}

export function isEmptyDanceFilter(filter: DanceAttributeFilter): boolean {
  return filter.level === null && filter.formations.length === 0 && !filter.womenOnly;
}

export function matchesDanceFilter(
  dance: FilterableDance,
  filter: DanceAttributeFilter,
): boolean {
  if (filter.level !== null && dance.level !== filter.level) return false;
  if (filter.womenOnly && !dance.womenOnly) return false;
  if (
    filter.formations.length > 0 &&
    !filter.formations.some((formation) => dance.danceFormations.includes(formation))
  ) {
    return false;
  }
  return true;
}

export function filterDances<T extends FilterableDance>(
  dances: readonly T[],
  filter: DanceAttributeFilter,
): T[] {
  if (isEmptyDanceFilter(filter)) return [...dances];
  return dances.filter((dance) => matchesDanceFilter(dance, filter));
}
