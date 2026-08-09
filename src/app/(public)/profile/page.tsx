import { currentUser } from "@/lib/auth/session";
import { PhoneSignIn } from "@/components/PhoneSignIn";
import { SignOutButton } from "@/components/SignOutButton";
import { formatIsraeliPhone } from "@/lib/domain/phone";
import { he } from "@/lib/i18n/he";

/**
 * This route stays in `(public)` and stays publicly reachable.
 *
 * The sign-in lives INLINE, in place of the profile content, rather than behind a
 * route-group redirect. AGENTS.md §2.2 only requires auth for actions that need
 * identity — this whole screen is identity, but the route itself should still
 * render for an anonymous visitor so it can explain that and offer to sign in. A
 * redirect would make the destination invisible to someone who followed a link
 * here not yet knowing they need an account, which is the opposite of §2.1's
 * "tap a link in WhatsApp and it works".
 *
 * There is deliberately no middleware guard either. `src/proxy.ts` matches
 * this path, but only to refresh an expiring token — it never redirects, and the
 * comment there says so.
 *
 * Dynamic because `currentUser()` reads cookies; Next opts this page out of
 * static rendering on its own for that reason, which is why the note in
 * `(public)/layout.tsx` about /profile prerendering no longer holds.
 */
export default async function ProfilePage() {
  const user = await currentUser();

  // Read on the server and passed down, not read in the client component: it is
  // NEXT_PUBLIC_* either way, but this keeps "which environment variable" a
  // question with one answer per screen instead of one per component.
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;

  return (
    <div className="px-4 py-6">
      <h1 className="font-display text-3xl font-black">{he.profile.heading}</h1>

      {user === null ? (
        <PhoneSignIn siteKey={turnstileSiteKey} />
      ) : (
        <div className="flex flex-col gap-6 pt-4">
          {/*
            The phone number is the only thing we know about a dancer who has
            just signed in. There is no public.profiles row yet — that table
            requires a display_name nobody has been asked for, and inventing a
            question to ask would be inventing product (AGENTS.md §13). Phase
            3.2 is where an instructor gets a name and a dance.
          */}
          <p>
            {he.profile.signedInAs(
              user.phone === null ? "" : formatIsraeliPhone(user.phone),
            )}
          </p>
          <p>{he.common.screenNotReady}</p>
          <SignOutButton />
        </div>
      )}

      {/*
        Favorites was its own route and tab in the first pass of this shell;
        merged in here as a labeled section rather than kept as a fourth
        destination — see docs/decisions/0008 for why.
      */}
      <section className="pt-8">
        <h2 className="font-display text-2xl font-black">{he.favorites.heading}</h2>
        <p className="pt-4">{he.common.screenNotReady}</p>
      </section>
    </div>
  );
}
