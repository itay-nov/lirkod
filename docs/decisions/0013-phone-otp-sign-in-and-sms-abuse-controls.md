# 0013 — Phone-OTP sign-in, cookie sessions, and the SMS-abuse controls

**Status:** accepted
**Supersedes nothing. Extends:** 0004 (public and private identity), 0012 (partial rate limiting)

## Context

Phone OTP is the only authentication this product has (AGENTS.md §2.3): no email,
no password, no social login. That makes `/auth/v1/otp` unusual as an endpoint —
**every successful call spends money.** An unauthenticated stranger, with nothing
but the anon key that ships in our JavaScript bundle, can ask us to send an SMS.
Left open, that is not a nuisance; it is a billing incident, and one that
degrades the only way into the product while it runs.

Three separate decisions came out of building it.

## Decision 1 — cookie-backed sessions via `@supabase/ssr`

A new dependency, added with explicit approval (AGENTS.md §3 requires asking).

`@supabase/supabase-js` on its own stores a session in `localStorage`. The server
cannot read that, so a Server Component, Route Handler or Server Action has no
way to know who is signed in. Phase 3.2 is "an instructor creates a dance", and
the entire point of the RLS policies in migration 0001 is that such a write runs
**as that instructor**, under `auth.uid()`. That requires the access token to
reach the server, which requires cookies.

`@supabase/ssr` is Supabase's own, currently-documented package for this, and the
sanctioned companion to the `supabase-js` already here. The alternatives were
worse in ways that matter on an auth path:

- hand-rolling a cookie `storage` adapter means writing our own cookie chunking
  and encoding — security-sensitive code duplicating a maintained package;
- keeping the session in `localStorage` and passing a bearer token to route
  handlers leaves Server Components blind, and parks the token somewhere XSS can
  read it.

The deprecated `@supabase/auth-helpers-nextjs` is deliberately **not** installed;
Supabase warns against having both.

The shape this takes:

| File | Runs in | Can write cookies |
|---|---|---|
| `src/lib/auth/browserClient.ts` | the browser | yes — it owns them |
| `src/lib/auth/serverClient.ts` | Server Components etc. | no — `setAll` is a real no-op |
| `src/lib/auth/sessionRefresh.ts` | `src/proxy.ts` | yes — a response is still being built |
| `src/lib/auth/session.ts` | server | n/a — `currentUser()`, the public question |

The split is not tidiness. `serverClient.ts` imports `next/headers`; a single
module exporting both halves would drag that into the browser bundle and fail to
compile. And the no-op `setAll` is why `src/proxy.ts` exists at all: a Server Component
holding an expired access token and a perfectly good refresh token cannot spend
it, so the refresh happens in the proxy, where a response is still being built.
(Next 16 renamed the `middleware` file convention to `proxy`; it is the same
thing under a new name.)

`currentUser()` uses `getUser()`, never `getSession()`. On the server the session
cookie is attacker-supplied input; `getSession()` decodes it and believes it,
`getUser()` asks the auth server. That is the difference between an authorization
check and a decoded string.

**The proxy matcher is `["/profile"]`, not Supabase's example catch-all.**
`refreshSession` makes a network call to GoTrue. Putting that in front of the map
would spend the §2.9 first-contentful-paint budget on identity the map does not
need (§2.2). It is also a refresh, **not** a guard — nothing in it redirects, and
nothing in it should ever start to.

## Decision 2 — the sign-in is inline on `/profile`, not a route gate

`/profile` stays in the `(public)` route group and stays publicly reachable. With
no session it renders the sign-in form *in place of* the profile content.

A redirect would be the conventional choice and it is the wrong one here. §2.2
forbids gating reads, and a dancer who taps a link to `/profile` from WhatsApp
without yet knowing an account is involved should land on a screen that explains
that — not be bounced somewhere else, which makes the destination invisible and
reads, to a 50+ audience, as the app losing their tap.

The consequence to know about: `/profile` used to prerender and no longer does,
because reading the session cookie opts it out of static rendering. The note in
`(public)/layout.tsx` was updated to match.

## Decision 3 — the SMS-abuse controls, and where each one is enforced

Three layers, chosen so that the strongest one is the one an attacker cannot
route around.

### CAPTCHA on `/auth/v1/otp` — `[auth.captcha]`

```toml
[auth.captcha]
enabled = true
provider = "turnstile"
secret = "1x0000000000000000000000000000000AA"   # Cloudflare's always-passes TEST secret
```

**This is the control that actually holds.** docs/decisions/0012 had to admit
that the in-process limiter on the near route bounds one server instance and is
skippable by calling Supabase REST directly with the anon key out of our bundle.
The captcha has no such hole: GoTrue enforces it *on the endpoint*, so skipping
our UI does not skip the check. That is the whole reason this control lives in
GoTrue's config and not in a route handler of ours.

Verified against the running stack rather than assumed: the challenge covers
`/otp` (send me a code) and **not** `/verify` (here is my code). That is the split
we want — the money is spent on the first one, and the second is bounded by
`token_verifications`.

**Turnstile over hCaptcha**, on audience grounds. Managed mode usually resolves
with no puzzle and no checkbox; hCaptcha shows a tick-box. Friction on the sole
auth path costs us exactly the 50+, low-tech-literacy sign-ins §2 says to protect.
"Usually" is not "always" — Turnstile still challenges traffic it scores as
suspicious, which is the control working, not a defect. `SecurityCheck.tsx`
therefore renders a real, labelled, reachable region rather than a hidden one.

### Per-number send frequency — `[auth.sms] max_frequency`

Raised from the CLI default `5s` to `60s`. GoTrue keys this on the user's last
send, so it is the control that directly bounds what a **single phone number** can
cost: 60 SMS/hour instead of ~720. It maps to `GOTRUE_SMS_MAX_FREQUENCY` —
confirmed by reading the running auth container's environment, not inferred from
the key name. 60s also matches what Supabase applies per-user by default on the
hosted side, so local and deployed behaviour agree.

It applies to `[auth.sms.test_otp]` numbers too, even though no provider is ever
contacted for them (also confirmed against the stack). The suites cope by
deleting and recreating their auth users, which resets the counter — and each
suite has its own number, because a shared one would throttle across suites for
reasons unrelated to what they assert.

### Project-wide hourly ceiling — `[auth.rate_limit] sms_sent`

Left at 30/hour. It is the backstop, not the control: right for a local stack
that sends nothing, and wrong for production, where 30 sign-ins an hour across
all dancers would throttle a launch night. Raising it in the hosted project raises
the spend ceiling, and should happen with the two controls above already in place
rather than instead of them.

## What is NOT closed by this, and must be done in the hosted project

- **A real Turnstile key pair.** The committed secret is Cloudflare's published
  always-passes test value: it verifies *every* token. `supabase config push`
  would send it to the linked project and silently turn the captcha into a no-op
  on the one endpoint that spends money. The hosted project needs a real secret
  set in the Supabase dashboard (Authentication → Attack Protection) and the
  matching site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- **The SMS provider itself.** `[auth.sms.twilio]` still holds stub credentials
  and the real provider remains an open choice. Nothing here sends an SMS.
- **`sms_sent`, re-decided for production volume**, per the note above.
- **A `public.profiles` row.** Signing in creates an `auth.users` row and nothing
  else. `profiles.display_name` is `not null` with no default, so a row cannot be
  created without asking for a name — and inventing that question would be
  inventing product (§13). Phase 3.2 is where an instructor gets a name.
