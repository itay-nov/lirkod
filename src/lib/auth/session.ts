import { serverClient } from "./serverClient";

/**
 * What the rest of the app is allowed to know about whoever is signed in.
 *
 * Deliberately narrow. Supabase's `User` carries app_metadata, identities, raw
 * provider payloads and a dozen timestamps, and handing that around invites
 * screens to start rendering fields nobody decided to show (AGENTS.md §8 —
 * store and pass what a feature needs, nothing more). Widen it when a feature
 * needs a field, not before.
 */
export interface SignedInUser {
  id: string;
  /** E.164 without the leading "+" — GoTrue stores phones that way. */
  phone: string | null;
}

/**
 * "Is there a logged-in user?" — the one question the rest of the server code
 * should ask, and the foundation Phase 3.2's instructor write builds on.
 *
 * `getUser()`, never `getSession()`. `getSession()` decodes the cookie and
 * believes it; `getUser()` sends the token to the auth server and gets an answer
 * back. On the server the cookie is attacker-supplied input like any other
 * header, so the difference is the difference between an authorization check and
 * a decoded string. It costs a round trip, which is why this is not called on the
 * public map path at all — nothing there needs identity (AGENTS.md §2.2).
 *
 * Returns null for "nobody", including when the token is expired or malformed.
 * Callers render the signed-out state; they never treat null as an error.
 */
export async function currentUser(): Promise<SignedInUser | null> {
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.getUser();

  // Not swallowed (AGENTS.md §6): every failure mode here — no cookie, expired
  // token, a token this project did not issue — has one correct answer for a
  // caller, and it is the same answer as "not signed in". There is nothing for a
  // screen to do differently, and an error boundary on /profile would replace a
  // working sign-in form with a crash.
  if (error || !data.user) return null;

  return { id: data.user.id, phone: data.user.phone ?? null };
}
