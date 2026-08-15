import type { Database } from "@/types/database";

/**
 * The closed set of preset profile avatars (Phase 4.3, docs/decisions/0019).
 *
 * Derived from the database enum rather than hand-typed, the same way
 * `OccurrenceStatus` in `src/lib/db/dances.ts` is — one source of truth for
 * "what counts as valid" is `public.avatar_choice` (migration 0011), and this
 * is a reading of it, not a second list that can drift from it.
 *
 * A `type` import only: this file stays pure (no React, no fetch, no env
 * access, AGENTS.md §4) even though the type it names ultimately comes from
 * generated database types — the import is erased at compile time.
 */
export type AvatarId = Database["public"]["Enums"]["avatar_choice"];

/**
 * Every valid id, in the order the picker shows them.
 *
 * Faces first, then the four folk/dance symbols — a person looking for "one
 * that looks like me" scans faces, and a person who wants a symbol instead
 * reaches the same conclusion faster if the symbols are grouped at the end
 * rather than interleaved.
 *
 * Deliberately NOT alphabetical or derived by reflection from the enum: the
 * enum's declaration order in migration 0011 already matches this, but this
 * array is the one components actually iterate, so it is the one whose order
 * is a product decision. `tests/unit/avatar.test.ts` pins that this set
 * matches the database enum exactly — same length, same members — so the two
 * cannot silently diverge.
 */
export const AVATAR_IDS: readonly AvatarId[] = [
  "woman_short_hair",
  "man_curly",
  "woman_long_hair",
  "man_glasses",
  "woman_gray_bun",
  "man_bald_mustache",
  "woman_curly_gray",
  "man_gray_beard",
  "dancer_figure",
  "circle_dance",
  "pomegranate",
  "musical_notes",
] as const;

/**
 * What a brand-new profile gets before anyone has chosen anything —
 * `profiles.avatar_id`'s own DEFAULT in migration 0011, restated here so the
 * app has one place to ask "what should already be selected the first time
 * the picker renders", rather than re-deriving it from the column default.
 *
 * The pomegranate, not a face: it is not gendered, it is not any particular
 * age, and it is a symbol this specific community already recognises — it
 * shares its name with `--color-accent` in globals.css. A generic "blank
 * person" silhouette would have been the placeholder-that-never-gets-chosen;
 * this is a real option someone might keep on purpose.
 */
export const DEFAULT_AVATAR_ID: AvatarId = "pomegranate";

/**
 * Narrows an arbitrary string to `AvatarId`, for the one place that has to
 * check a value that did NOT come through the database's own enum
 * constraint — a Server Action reading client input (AGENTS.md §8). The
 * database enforces this again independently on the way in; this is what lets
 * the action refuse cleanly, with a real error, instead of relying on a
 * Postgres 22P02 surfacing all the way back to the form.
 */
export function isAvatarId(value: string): value is AvatarId {
  return (AVATAR_IDS as readonly string[]).includes(value);
}
