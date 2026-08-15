import { cookies } from "next/headers";
import {
  INSTRUCTOR_INTENT_COOKIE,
  INSTRUCTOR_INTENT_VALUE,
} from "@/lib/auth/instructorIntent";
import { serverClient } from "@/lib/auth/serverClient";
import { currentUser } from "@/lib/auth/session";
import { findOwnNights } from "@/lib/db/nights";
import { findOwnInstructor, findOwnProfile } from "@/lib/db/publisher";
import { searchVenues } from "@/lib/db/venues";
import { toManageableNights } from "@/lib/domain/manageNight";
import { BecomeInstructor } from "@/components/BecomeInstructor";
import { CreateDanceForm } from "@/components/CreateDanceForm";
import { DemoSignIn } from "@/components/DemoSignIn";
import { ManageNights } from "@/components/ManageNights";
import { PhoneSignIn } from "@/components/PhoneSignIn";
import { ProfileNameForm } from "@/components/ProfileNameForm";
import { SignOutButton } from "@/components/SignOutButton";
import { formatIsraeliPhone } from "@/lib/domain/phone";
import { roleFor, showsInstructorTools } from "@/lib/domain/role";
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

  // Read server-side, and NOT a NEXT_PUBLIC_* variable on purpose: the flag must
  // never be inlined into the browser bundle where a client could read or fake
  // it. This decides which form to DRAW; `demoSignInAction` checks the same
  // variable again before it will issue anything, and that second check is the
  // actual gate (docs/decisions/0018). Production leaves it unset and ships the
  // real OTP form.
  const demoLoginEnabled = process.env.DEMO_LOGIN_ENABLED === "true";

  return (
    <div className="px-4 py-6">
      <h1 className="font-display text-3xl font-black">{he.profile.heading}</h1>
      {user === null ? (
        // One sign-in surface per build, never both: a demo build shows the demo
        // form so whoever is presenting is not asked to choose between two ways
        // in, and a production build has no demo path rendered at all.
        demoLoginEnabled ? (
          <DemoSignIn />
        ) : (
          <PhoneSignIn siteKey={turnstileSiteKey} />
        )
      ) : (
        <SignedIn userId={user.id} phone={user.phone} />
      )}

      {/*
        Favorites was its own route and tab in the first pass of this shell;
        merged in here as a labeled section rather than kept as a fourth
        destination — see docs/decisions/0008 for why.

        Real favorites (saving a dance) is Phase 4.5 — this is shell only, so
        the section is one of two honest empty-states rather than a "בבנייה"
        notice (AGENTS.md §2). Which one depends on whether signing in would
        change anything: an anonymous visitor is told to sign in, a signed-in
        one is told there is nothing saved yet.
      */}
      <section className="pt-8">
        <h2 className="font-display text-2xl font-black">{he.favorites.heading}</h2>
        <p className="pt-4">
          {user === null ? he.favorites.signedOutEmpty : he.favorites.empty}
        </p>
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
    // Ticking "אני מרקיד/ה" at sign-in leaves an intent this step is about to
    // act on, so the step has to SAY the name will also be public — the default
    // copy promises the opposite, and docs/decisions/0004 forbids promoting the
    // private name into the public one without asking.
    const jar = await cookies();
    const becomingInstructor =
      jar.get(INSTRUCTOR_INTENT_COOKIE)?.value === INSTRUCTOR_INTENT_VALUE;

    return (
      <div className="flex flex-col gap-6 pt-4">
        <ProfileNameForm becomingInstructor={becomingInstructor} />
        <SignOutButton />
      </div>
    );
  }

  // Only reached once there is a profile, so the two extra round trips are not on
  // the path of someone who has just signed in and has nothing to publish yet.
  const [instructor, venues] = await Promise.all([
    findOwnInstructor(client, profile.id),
    // The first page of halls; the picker searches server-side from here on.
    searchVenues(client, ""),
  ]);

  // The role is DERIVED from that instructor row — the same row `owns_instructor()`
  // reads when it decides whether a write is allowed (docs/decisions/0018). So the
  // menu below and the database cannot disagree about who is a מרקיד; they are
  // reading the same fact.
  //
  // What follows is presentation ONLY. Hiding the publish form does not protect
  // anything: `publishDanceAction` re-derives the actor from the session and the
  // insert is still checked by `dance_events_insert_own`, so a dancer who calls it
  // directly is refused by Postgres, not by this branch. That is asserted live in
  // tests/rls/roleAndDemoLogin.test.ts rather than assumed.
  const role = roleFor(instructor);

  // Only for someone who has actually published. A dancer with no instructor row
  // has no nights to manage, and the query needs an instructor id to filter by —
  // `event_occurrences_select_authenticated` is `using (true)`, so an unfiltered
  // version of it would list the whole country (see the note in db/nights.ts).
  const nights =
    instructor === null
      ? []
      : toManageableNights(await findOwnNights(client, instructor.id));

  return (
    <div className="flex flex-col gap-6 pt-4">
      <p className="font-bold">{he.profile.greeting(profile.displayName)}</p>
      <p>{he.profile.signedInAs(phone === null ? "" : formatIsraeliPhone(phone))}</p>

      {showsInstructorTools(role) ? (
        <>
          {/*
            The public name is prefilled from the private one but asked for
            explicitly, because they are different things (docs/decisions/0004)
            and promoting one to the other silently would publish a name nobody
            agreed to show.

            `needsInstructorName` is now always false here — this branch only
            renders for somebody who already has an instructor row, so the row's
            own name is authoritative. The prop stays because the form still
            takes it; it is the role gate, not the form, that changed.
          */}
          <CreateDanceForm
            venues={venues}
            mapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null}
            instructorName={instructor?.displayName ?? profile.displayName}
            needsInstructorName={instructor === null}
          />

          {/*
            Below the publish form, not above it. Publishing is what brings an
            instructor to this screen the first time and stays the more common
            errand; managing a night is what they come back for, and a list of
            twelve nights between the greeting and the form would bury it.
          */}
          <ManageNights nights={nights} />
        </>
      ) : (
        // A רוקד gets an invitation in the same place, not an empty gap and not
        // a message about a permission they lack. Ticking "אני מרקיד/ה" at
        // sign-in would have led here too; this is the way back for anyone who
        // did not (docs/decisions/0018).
        <BecomeInstructor />
      )}

      <SignOutButton />
    </div>
  );
}
