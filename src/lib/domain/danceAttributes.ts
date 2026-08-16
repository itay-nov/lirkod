import type { DanceFormation, DanceLevel } from "@/lib/db/dances";

/**
 * Level and formation (Phase 4.6b, migration 0013). `DanceLevel`/
 * `DanceFormation` themselves live in `src/lib/db/dances.ts`, alongside
 * `OccurrenceStatus` — this module adds the closed sets and the type guards,
 * the same role `avatar.ts` plays for `AvatarId`/`avatar_choice`, for the one
 * place a value arrives as a plain string from client input (a Server
 * Action, AGENTS.md §8) rather than through the database's own enum
 * constraint.
 */
export type { DanceFormation, DanceLevel };

/** Matches migration 0013's `dance_level` declaration order. */
export const DANCE_LEVELS: readonly DanceLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
  "all_levels",
] as const;

/** `dance_events.level`'s own DEFAULT (migration 0013) — every dance publishes open to everyone unless the instructor says otherwise. */
export const DEFAULT_DANCE_LEVEL: DanceLevel = "all_levels";

/** Matches migration 0013's `dance_formation` declaration order. */
export const DANCE_FORMATIONS: readonly DanceFormation[] = [
  "circle",
  "couples",
  "line",
  "mixed",
] as const;

export function isDanceLevel(value: string): value is DanceLevel {
  return (DANCE_LEVELS as readonly string[]).includes(value);
}

export function isDanceFormation(value: string): value is DanceFormation {
  return (DANCE_FORMATIONS as readonly string[]).includes(value);
}

/**
 * Narrows a form's `string[]` of checkbox values to `DanceFormation[]`,
 * silently dropping anything invalid rather than refusing the whole publish
 * over it — the checkboxes only ever send values from `DANCE_FORMATIONS` in
 * the first place, so an invalid entry here would be a forged request, not a
 * mistake worth showing an error for. The database's own array element check
 * (migration 0013) is the actual boundary; this is what keeps a forged value
 * from reaching it as a 22P02 instead of being quietly excluded.
 */
export function toDanceFormations(values: readonly string[]): DanceFormation[] {
  return values.filter(isDanceFormation);
}
