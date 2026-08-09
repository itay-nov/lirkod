import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, localStack } from "./helpers";

/**
 * The SMS-abuse controls on the phone-OTP path (docs/decisions/0013).
 *
 * These are the reason auth was its own task. `/auth/v1/otp` is the one endpoint
 * in this product where an anonymous stranger, holding nothing but the anon key
 * that ships in our JavaScript bundle, can make us spend money — so the controls
 * on it are asserted rather than assumed.
 *
 * Deliberately in `tests/rls/` and not `tests/unit/`: every claim here is about
 * what a running GoTrue actually does, and there is nothing to test in isolation.
 * The whole point is that these are enforced by the server, on the endpoint, and
 * therefore survive a caller who skips our UI entirely.
 *
 * Its own phone number, because `[auth.sms] max_frequency` is keyed on the number
 * and sharing one with the RLS fixtures would make each suite's timing depend on
 * the other's.
 */

const PHONE = "+972500000005";
const CAPTCHA_TOKEN = "local-test-captcha-token";

/** Bypasses the supabase-js client on purpose — see `otp` below. */
async function otp(body: Record<string, unknown>): Promise<{ status: number; code: string }> {
  const { apiUrl, anonKey } = localStack();

  // Raw fetch rather than `supabase.auth.signInWithOtp`, because the assertions
  // here are about the HTTP status and error code GoTrue returns, and the client
  // normalises both into an AuthError whose shape is its own concern. A caller
  // attacking this endpoint would not be using the client either.
  const response = await fetch(`${apiUrl}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload: unknown = await response.json().catch(() => ({}));
  const code = (payload as { error_code?: unknown }).error_code;

  return { status: response.status, code: typeof code === "string" ? code : "" };
}

/** Resets the per-number cooldown by removing the user it is keyed on. */
async function deleteUser(phone: string): Promise<void> {
  const { apiUrl, serviceRoleKey } = localStack();
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, { headers });
  const body: unknown = await listed.json();
  const users = (body as { users?: Array<{ id: string; phone?: string }> }).users ?? [];

  for (const user of users) {
    if (user.phone === phone.replace("+", "")) {
      await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers });
    }
  }
}

beforeAll(async () => {
  await deleteUser(PHONE);
});

afterAll(async () => {
  await deleteUser(PHONE);
});

describe("the captcha on /auth/v1/otp (docs/decisions/0013)", () => {
  it("refuses a request with no captcha token at all", async () => {
    // THE assertion of this file. docs/decisions/0012 had to concede that the
    // in-process limiter on the near route is skippable by calling Supabase REST
    // directly; this one is not, and this is what proves the difference. If this
    // ever starts passing a tokenless request, the control is off.
    const { status, code } = await otp({ phone: PHONE });

    expect(status).toBe(400);
    expect(code).toBe("captcha_failed");
  });

  it("refuses an empty token", async () => {
    const { status } = await otp({ phone: PHONE, gotrue_meta_security: { captcha_token: "" } });
    expect(status).toBe(400);
  });

  it("accepts a request that carries one", async () => {
    // The local secret is Cloudflare's always-passes test value, so this asserts
    // the plumbing (the token reaches Cloudflare and the verdict comes back), not
    // that a real challenge was solved.
    const { status } = await otp({
      phone: PHONE,
      gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN },
    });

    expect(status).toBe(200);
  });
});

describe("the per-number send-frequency limit ([auth.sms] max_frequency)", () => {
  it("refuses a second code for the same number inside the cooldown", async () => {
    // Runs after the accepted request above, which is what started the cooldown.
    // A valid captcha token is supplied, so a refusal here can only be the
    // frequency limit — the two controls are independent and this proves it.
    const { status, code } = await otp({
      phone: PHONE,
      gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN },
    });

    expect(status).toBe(429);
    expect(code).toBe("over_sms_send_rate_limit");
  });

  it("applies to numbers in [auth.sms.test_otp] too, even though no SMS is sent", async () => {
    // Worth pinning separately from the test above: this number is in
    // [auth.sms.test_otp], so GoTrue short-circuits before contacting any
    // provider — and the cooldown still applies anyway. It is why this file and
    // tests/e2e/signIn.spec.ts both delete their user before running, and someone
    // who assumes test numbers are exempt will write a flaky suite.
    const { status } = await otp({
      phone: PHONE,
      gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN },
    });
    expect(status).toBe(429);
  });
});

describe("the email provider is off — phone OTP is the only way in (AGENTS.md §2.3)", () => {
  /**
   * The hole this closes: "we did not build an email screen" is not the same as
   * "there is no email path". GoTrue serves the provider, not our UI. While
   * `[auth.email] enable_signup` was true, anyone holding the anon key out of our
   * JavaScript bundle could POST /auth/v1/signup with an email and a password and
   * receive a session whose role is `authenticated` — the role every RLS policy in
   * migration 0001 trusts — without ever proving they hold a phone. Confirmed
   * against this stack before the fix.
   *
   * The captcha is not what stops it: it sits on these endpoints too, but it
   * proves a human is present, not that the human is entitled to a session. Every
   * request below therefore carries a solved token, so a pass here means the
   * provider itself is off and not that the challenge happened to catch it.
   */
  async function auth(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; code: string }> {
    const { apiUrl, anonKey } = localStack();
    const response = await fetch(`${apiUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN },
      }),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    const code = (payload as { error_code?: unknown }).error_code;
    return { status: response.status, code: typeof code === "string" ? code : "" };
  }

  const EMAIL = "intruder@example.com";
  const PASSWORD = "correct-horse-battery";

  it("advertises the email provider as disabled", async () => {
    const { apiUrl, anonKey } = localStack();
    const response = await fetch(`${apiUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey },
    });
    const settings = (await response.json()) as { external: Record<string, boolean> };

    expect(settings.external.email).toBe(false);
    // Phone stays on, or this test would pass for the wrong reason — with all
    // authentication broken rather than only the email half.
    expect(settings.external.phone).toBe(true);
  });

  const EMAIL_PATHS: ReadonlyArray<{
    what: string;
    path: string;
    body: Record<string, unknown>;
  }> = [
    { what: "email + password signup", path: "signup", body: { email: EMAIL, password: PASSWORD } },
    {
      what: "password grant",
      path: "token?grant_type=password",
      body: { email: EMAIL, password: PASSWORD },
    },
    { what: "email OTP", path: "otp", body: { email: EMAIL } },
    { what: "magic link", path: "magiclink", body: { email: EMAIL } },
    { what: "password recovery", path: "recover", body: { email: EMAIL } },
  ];

  it.each(EMAIL_PATHS)("refuses $what as provider-disabled", async ({ path, body }) => {
    const { status, code } = await auth(path, body);

    // `email_provider_disabled` specifically, not `invalid_credentials`: the
    // latter would mean the path is live and merely rejected these particular
    // credentials, which is the finding rather than the fix.
    expect(code).toBe("email_provider_disabled");
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("leaves no email identity behind for any of it", async () => {
    const { apiUrl, serviceRoleKey } = localStack();
    const response = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    const body = (await response.json()) as { users?: Array<{ email?: string }> };

    expect((body.users ?? []).filter((user) => user.email)).toHaveLength(0);
  });
});

describe("the anon key alone still cannot read a profile", () => {
  it("returns no rows to a caller with no session", async () => {
    // A sanity check that the new auth surface did not quietly widen anything:
    // profiles are owner-only (migration 0001) and signing in is not supposed to
    // change what an anonymous caller can see.
    const { data, error } = await anonClient().from("profiles").select("id");

    expect(error === null || error.code === "42501").toBe(true);
    expect(data ?? []).toHaveLength(0);
  });
});
