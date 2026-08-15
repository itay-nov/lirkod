"use server";

import { actionClient } from "@/lib/auth/actionClient";
import { DEMO_OTP, demoUserFor } from "@/lib/auth/demoUsers";

/**
 * Demo sign-in: type a small number, press אישור, land on a seeded account.
 *
 * Kept in its own file rather than folded into `actions.ts` so the one path in
 * this product that can hand out a session without an SMS is a file somebody can
 * open and read end to end while reviewing it. Everything security-relevant
 * about it is in `demoSignInAction` below and in docs/decisions/0018.
 *
 * The short version, because it is the only thing that matters here: this is not
 * an alternative way to authenticate. It is a way to reach FOUR accounts that we
 * created, on a stack we control, and it fails closed everywhere else.
 */

export type DemoSignInResult =
  | { ok: true; displayName: string }
  | { ok: false; reason: "disabled" | "unknownNumber" | "failed" };

/**
 * Signs in as the seeded demo account at `typedNumber`, or refuses.
 *
 * **The gate is the first statement, and it is server-side.** `DEMO_LOGIN_ENABLED`
 * is deliberately NOT a `NEXT_PUBLIC_*` variable: it is never inlined into the
 * browser bundle, so no client can read it, flip it, or infer it. Hiding the form
 * is presentation; THIS is the control. A flag-off build reaches the return below
 * and issues nothing — no OTP is requested, no phone number is touched, no cookie
 * is written — which `tests/rls/roleAndDemoLogin.test.ts` asserts by checking for
 * the absence of a session rather than the absence of a button.
 *
 * The number is then resolved through `demoUserFor`, which INDEXES A FIXED TABLE
 * (`DEMO_USERS`) instead of searching for an account whose phone matches. There
 * is therefore no input — valid, malformed, hostile, or merely creative — that
 * resolves to a person we did not seed. See the note on that table.
 *
 * What happens on success is an ordinary sign-in through GoTrue's real `/verify`
 * endpoint, server-side, and what comes back is a normal session written to
 * cookies by `actionClient()`. Nothing is minted, `service_role` is NOT involved
 * — deliberately, because "use the service key to mint a session for a user id"
 * is the classic auth-bypass primitive and this feature does not need one — and
 * the credential never reaches the browser: the client gets a name and a boolean.
 * Downstream, RLS and `owns_instructor()` treat a demo user exactly like anybody
 * else, which is the point: a demo that bypassed RLS would be demonstrating
 * software we do not ship.
 *
 * **Only `/verify` is called, never `/otp`.** GoTrue short-circuits a number
 * listed under `[auth.sms.test_otp]` to its fixed code, so requesting a code
 * first is a round trip that sends nothing and achieves nothing — and it is
 * rate-limited to one call a minute per number (`[auth.sms] max_frequency`),
 * because that endpoint normally spends money on an SMS. Calling it here made
 * the demo fail whenever somebody signed out and back in within the minute,
 * which during a live demo is precisely what people do. Skipping it also means
 * no captcha token is involved, since `[auth.captcha]` covers `/otp` and not
 * `/verify` (docs/decisions/0013 documents that split).
 *
 * This narrows the path rather than widening it: `/verify` accepts the fixed
 * code ONLY for a number the stack has been told is a test number, which is
 * local/preview configuration. On a hosted project there is no such short
 * circuit, so this call cannot produce a session there at all.
 */
export async function demoSignInAction(typedNumber: string): Promise<DemoSignInResult> {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    return { ok: false, reason: "disabled" };
  }

  const demoUser = demoUserFor(typedNumber);
  if (demoUser === null) return { ok: false, reason: "unknownNumber" };

  const client = await actionClient();

  const { error } = await client.auth.verifyOtp({
    phone: demoUser.phone,
    token: DEMO_OTP,
    type: "sms",
  });
  // Not rethrown: every way this fails — the phone is not a configured test
  // number, the stack is not seeded, the code is not the configured one — has the
  // same answer for the person at the screen, and none of them should surface a
  // provider message on a demo form.
  if (error) return { ok: false, reason: "failed" };

  return { ok: true, displayName: demoUser.displayName };
}
