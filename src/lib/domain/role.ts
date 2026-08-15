/**
 * Who a signed-in person is to this product: a רוקד or a מרקיד.
 *
 * DERIVED, never stored. The role is a reading of one fact that already exists —
 * does this profile own an `instructors` row — and that fact is the *same one*
 * every write policy in the database already checks: `owns_instructor()` and
 * `owns_event()` both reduce to `instructors.profile_id = auth.uid()`
 * (migration 0001). Deriving means the label on the screen and the rule in
 * Postgres cannot disagree, because they read the same row.
 *
 * A stored `profiles.role` column would have been the other option and was
 * rejected in docs/decisions/0018 for two reasons worth repeating where the code
 * is: it can drift (role says מרקיד, no instructors row exists, the menu offers
 * a button whose write is refused), and — the real danger — a column that looks
 * like a permission invites a future policy to be written against it, which is
 * exactly the "role authorizes writes" failure this model must not have.
 *
 * **This role gates UI only.** Nothing here is an authorization decision. A
 * dancer who forges the client state, calls the Server Action directly, or hits
 * PostgREST with the anon key still gets refused by RLS, because RLS never asks
 * this function anything. Read that as: showing the button is a courtesy;
 * refusing the write is the security boundary, and it lives in the database.
 *
 * Pure and DOM-free, so it is unit-testable without jsdom (AGENTS.md §3).
 */

/**
 * The two kinds of person the product is built for (AGENTS.md §1).
 *
 * There is deliberately no "guest" member. Not being signed in is the absence of
 * a role, not a third one — a guest has no profile to derive from, and modelling
 * it here would invite `role === "guest"` checks in place of the `user === null`
 * check that actually answers "is anyone signed in".
 */
export type UserRole = "dancer" | "instructor";

/**
 * The role of a signed-in profile, from whether they own an instructor row.
 *
 * Takes the already-fetched instructor (or null) rather than a client or an id:
 * `/profile` has looked it up through `findOwnInstructor` before it renders, and
 * a second query here would be a second chance to get the ownership filter
 * wrong — the exact bug the note on `findOwnInstructor` records having shipped
 * once, where an unfiltered read showed a new user a stranger's name.
 */
export function roleFor(instructor: { id: string } | null): UserRole {
  return instructor === null ? "dancer" : "instructor";
}

/**
 * Whether this role may be *offered* the publish and manage-nights surfaces.
 *
 * Named for what it decides — what to draw — rather than "canPublish", which
 * would read like a permission check and tempt a caller into treating it as one.
 * The database decides who may publish.
 */
export function showsInstructorTools(role: UserRole): boolean {
  return role === "instructor";
}
