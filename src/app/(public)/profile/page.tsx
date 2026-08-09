import { serverClient } from "@/lib/auth/serverClient";
import { currentUser } from "@/lib/auth/session";
import { findOwnInstructor, findOwnProfile } from "@/lib/db/publisher";
import { listVenues } from "@/lib/db/venues";
import { CreateDanceForm } from "@/components/CreateDanceForm";
import { PhoneSignIn } from "@/components/PhoneSignIn";
import { ProfileNameForm } from "@/components/ProfileNameForm";
import { SignOutButton } from "@/components/SignOutButton";
import { formatIsraeliPhone } from "@/lib/domain/phone";
import { he } from "@/lib/i18n/he";

/**
 * This route stays in `(public)` and stays publicly reachable.
 *
 * Three states, all rendered INLINE in place of one another, none behind a
 * redirect: no session → sign in; session but no `profiles` row → set a name;
 * both → the profile, and the form that publishes a dance. AGENTS.md §2.2 only
 * requires auth for actions that need identity — this whole screen is identity,
 * but the route itself should still render for an anonymous visitor so it can
 * explain that and offer to sign in. A redirect would make the destination
 * invisible to someone who followed a link here not yet knowing they need an
 * account, which is the opposite of §2.1's "tap a link in WhatsApp and it works".
 *
 * The name step is not a nag that can be skipped: `profiles.display_name` is NOT
 * NULL with no default (migration 0001), so there is no profile row until it is
 * answered, and nothing downstream — including publishing — can happen first.
 *
 * There is deliberately no middleware guard either. `src/proxy.ts` matches this
 * path, but only to refresh an expiring token — it never redirects, and the
 * comment there says so.
 *
 * Dynamic because `currentUser()` reads cookies; Next opts this page out of
 * static rendering on its own for that reason.
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
        <SignedIn userId={user.id} phone={user.phone} />
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

/**
 * Split out so the page above reads as its three states rather than as one
 * function doing all of them (AGENTS.md §6). Still a Server Component: every
 * query below runs through the caller's own session, never `service_role`.
 *
 * That is not the same as "RLS filters these for us". `profiles` is owner-scoped
 * and `instructors` is deliberately world-readable, so the ownership filter lives
 * in the query — see the note on `findOwnInstructor`, which is where getting this
 * wrong showed a new user a stranger's public name.
 */
async function SignedIn({ userId, phone }: { userId: string; phone: string | null }) {
  const client = await serverClient();
  const profile = await findOwnProfile(client, userId);

  // Sign-out is rendered alongside the name step, not only after it. Without it
  // someone who signed in with the wrong number — or who simply changed their
  // mind — is stuck on a form they cannot leave and cannot skip, because there is
  // no profile row until it is answered. A screen with no way out is exactly the
  // dead end AGENTS.md §2.7 is about.
  if (profile === null) {
    return (
      <div className="flex flex-col gap-6 pt-4">
        <ProfileNameForm />
        <SignOutButton />
      </div>
    );
  }

  // Only reached once there is a profile, so the two extra round trips are not on
  // the path of someone who has just signed in and has nothing to publish yet.
  const [instructor, venues] = await Promise.all([
    findOwnInstructor(client, profile.id),
    listVenues(client),
  ]);

  return (
    <div className="flex flex-col gap-6 pt-4">
      <p className="font-bold">{he.profile.greeting(profile.displayName)}</p>
      <p>{he.profile.signedInAs(phone === null ? "" : formatIsraeliPhone(phone))}</p>

      {/*
        The public name is prefilled from the private one but asked for
        explicitly, because they are different things (docs/decisions/0004) and
        promoting one to the other silently would publish a name nobody agreed to
        show. Once an instructor row exists, its own name is authoritative and the
        field disappears.
      */}
      <CreateDanceForm
        venues={venues}
        instructorName={instructor?.displayName ?? profile.displayName}
        needsInstructorName={instructor === null}
      />

      <SignOutButton />
    </div>
  );
}
