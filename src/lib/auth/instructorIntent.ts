/**
 * The cookie that carries "I ticked אני מרקיד/ה" across the one gap where it
 * cannot be acted on: a brand-new user declares the role while signing in, but
 * `instructors.profile_id` references a `profiles` row that does not exist until
 * they answer the name step (docs/decisions/0018).
 *
 * In its own module because two different kinds of file need the name and a
 * `"use server"` file may only export async functions — so the actions cannot
 * hand this constant to `/profile`, which reads it to decide whether the name
 * step should disclose that the name will also be public.
 *
 * It is deliberately NOT signed or encrypted, and that is safe for one specific
 * reason worth writing down where the name lives: forging it gets an attacker an
 * UNVERIFIED instructors row on their own profile — which `instructors_insert_own`
 * already lets any authenticated user create for themselves (migration 0001,
 * docs/decisions/0004). There is no privilege here to protect. `verified` stays
 * false and stays outside the grant.
 */
export const INSTRUCTOR_INTENT_COOKIE = "lirkod_instructor_intent";

/** The only value that counts as "yes". Anything else is treated as absent. */
export const INSTRUCTOR_INTENT_VALUE = "1";
