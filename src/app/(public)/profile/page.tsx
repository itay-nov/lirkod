import { he } from "@/lib/i18n/he";

/**
 * This route intentionally stays in `(public)` rather than moving to
 * `(auth)`. Phone-OTP auth (AGENTS.md §2.3) doesn't exist yet, so there is no
 * session to gate on. Once it does, the right check here is an inline "is
 * there a session? if not, show a sign-in prompt in place" — NOT a route-group
 * redirect gate that bounces an anonymous visitor away before this page ever
 * renders. AGENTS.md §2.2 only requires auth for actions that need identity;
 * this whole screen is identity, but the profile route itself should still be
 * reachable so it can explain that and offer to sign in, rather than a
 * redirect making the destination invisible to someone who followed a link
 * to it not yet knowing they need an account.
 *
 * No sign-in flow is implemented here — that is genuinely later work, not
 * something to fake with a placeholder button that does nothing.
 */
export default function ProfilePage() {
  return (
    <div className="px-4 py-6">
      <h1 className="font-display text-3xl font-black">{he.profile.heading}</h1>
      <p className="pt-4">{he.common.screenNotReady}</p>

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
