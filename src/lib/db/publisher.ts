import type { Client } from "./client";

/**
 * The two rows that stand between a signed-in phone number and a published
 * dance: the private `profiles` row, and the public `instructors` row.
 *
 * Every function here runs through the CALLER's session, never `service_role`.
 * That is the point of the module: each write is checked by the same RLS policy
 * that protects it from anyone else (AGENTS.md §8), so there is no path in this
 * codebase that can write one of these rows on someone else's behalf. A bug here
 * is a failed insert, not a privilege escalation.
 */

export interface Profile {
  id: string;
  displayName: string;
}

export interface Instructor {
  id: string;
  displayName: string;
  verified: boolean;
}

/**
 * The caller's own profile, or null if they have not set a name yet.
 *
 * **Filtered explicitly, on purpose.** `profiles_select_own` would narrow this to
 * the caller's row anyway, but writing the `eq` means this function does not
 * depend on which policy happens to be attached to the table — see the far
 * sharper version of that argument on `findOwnInstructor` below, where the
 * table's policy is `using (true)` and relying on RLS as a filter is simply
 * wrong.
 *
 * `maybeSingle`, not `single`: "no row" is the ordinary state of a user who
 * signed in a moment ago, and PostgREST reports it as an error for `single`,
 * which would turn the expected case into a thrown exception.
 */
export async function findOwnProfile(
  client: Client,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { id: data.id, displayName: data.display_name };
}

/**
 * Creates the caller's profile row.
 *
 * `id` and `phone` are supplied by the server from the verified session, never
 * from the form (AGENTS.md §8 — never trust a user id that arrived from the
 * client). `profiles_insert_own` checks `auth.uid() = id` on top of that, so a
 * forged id fails the policy rather than landing.
 */
export async function createOwnProfile(
  client: Client,
  profile: { id: string; displayName: string; phone: string },
): Promise<Profile> {
  const { data, error } = await client
    .from("profiles")
    .insert({ id: profile.id, display_name: profile.displayName, phone: profile.phone })
    .select("id, display_name")
    .single();

  if (error) throw error;

  return { id: data.id, displayName: data.display_name };
}

/**
 * The caller's instructor row, or null if they have never published.
 *
 * **The `eq` is load-bearing and must not be removed.** `instructors` is
 * world-readable by design — `instructors_select_public` is `using (true)`,
 * because the map has to name who runs a dance for a visitor with no account
 * (migration 0001, docs/decisions/0004). So unlike every owner-scoped table in
 * this schema, RLS here filters *nothing*, and an unfiltered read returns some
 * other instructor's row.
 *
 * That is not hypothetical: this function was written without the filter and
 * returned the seeded instructor to a brand-new user, who was then shown a
 * stranger's public name and told they were already a מרקיד. The write itself
 * would still have been refused — `dance_events_insert_own` checks
 * `owns_instructor` — which is exactly the defence in depth AGENTS.md §8 asks
 * for, and exactly why "RLS will catch it" is not a licence to query loosely.
 */
export async function findOwnInstructor(
  client: Client,
  profileId: string,
): Promise<Instructor | null> {
  const { data, error } = await client
    .from("instructors")
    .select("id, display_name, verified")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { id: data.id, displayName: data.display_name, verified: data.verified };
}

/**
 * Registers the caller as a מרקיד, unverified.
 *
 * `verified` is deliberately absent from this insert and must stay absent. It is
 * held down twice over (migration 0004, docs/decisions/0004): the column is
 * outside `authenticated`'s INSERT grant, so naming it fails with 42501 before
 * RLS is consulted, and `instructors_insert_own` additionally requires
 * `verified = false`. Do not "helpfully" add it here, even as `false` — passing
 * the column at all is what the grant refuses.
 *
 * Unverified instructors can publish. That is a v1 product decision, not an
 * oversight: nothing gates on `verified`, and the flag exists so the map can
 * eventually show who we have checked.
 */
export async function registerAsInstructor(
  client: Client,
  instructor: { profileId: string; displayName: string },
): Promise<Instructor> {
  const { data, error } = await client
    .from("instructors")
    .insert({ profile_id: instructor.profileId, display_name: instructor.displayName })
    .select("id, display_name, verified")
    .single();

  if (error) throw error;

  return { id: data.id, displayName: data.display_name, verified: data.verified };
}
