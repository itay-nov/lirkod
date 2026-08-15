import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_USERS, demoUserFor } from "@/lib/auth/demoUsers";
import { roleFor } from "@/lib/domain/role";
import { DEMO_OTP } from "@/lib/auth/demoUsers";
import { anonClient, serviceClient, type Client } from "./helpers";

/**
 * The security properties of Phase 4.2's role model and demo login
 * (docs/decisions/0018), asserted against the running stack rather than argued
 * for in comments.
 *
 * Four questions, because they are the four ways this feature could be a hole:
 *
 *   1. With the demo flag off, does the demo path issue a session? (It must not
 *      — and "the button is hidden" is not an answer.)
 *   2. Can a typed number ever resolve to an account we did not seed?
 *   3. Does the role gate anything real? (It must not. A dancer must still be
 *      refused an instructor write BY POSTGRES, with the UI bypassed entirely.)
 *   4. Is the seeded cast actually shaped the way the demo claims?
 *
 * Needs a recent `npm run db:reset`: the demo accounts come from
 * supabase/seed.sql, and their phones are test numbers only in
 * supabase/config.toml's `[auth.sms.test_otp]`.
 */

/** The ids seed.sql assigns. Pinned here so a seed edit that renames them fails loudly. */
const SEEDED_INSTRUCTOR_ID = "d1000000-0000-0000-0000-000000000000";
const SEEDED_DANCER_ID = "d1000000-0000-0000-0000-000000000001";

/**
 * A stand-in for the Next cookie jar, recording every write.
 *
 * The point is the recording. "Yields no session" is only a real assertion if
 * something can prove nothing was written, and this is that something: after a
 * refused call, `writes` must still be empty. A test that merely checked the
 * returned object would pass just as happily against an action that refused in
 * its return value while setting a cookie on the way (see the guard tests below).
 */
interface FakeJar {
  writes: Array<{ name: string; value: string }>;
}

const fakeJar: FakeJar = { writes: [] };

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      get: () => undefined,
      set: (name: string, value: string) => {
        fakeJar.writes.push({ name, value });
      },
      delete: () => {},
    }),
}));

/**
 * Imported lazily, inside each test, and never at module scope.
 *
 * `demoSignInAction` reads `process.env.DEMO_LOGIN_ENABLED` when it RUNS rather
 * than when it loads, so a plain import would be fine — but importing it here
 * keeps each test's environment setup adjacent to the call it governs, which is
 * the thing a reader of a security test needs to be able to check at a glance.
 */
async function demoSignIn(typedNumber: string) {
  const { demoSignInAction } = await import("@/app/(public)/profile/demoAuthActions");
  return demoSignInAction(typedNumber);
}

describe("the demo flag is the gate, and it is server-side", () => {
  it("issues NO session when DEMO_LOGIN_ENABLED is unset — the production default", async () => {
    vi.stubEnv("DEMO_LOGIN_ENABLED", "");
    fakeJar.writes = [];

    // Index 0 is a real, correctly-seeded demo account. The number is not the
    // reason this is refused; the flag is.
    const result = await demoSignIn("0");

    expect(result).toEqual({ ok: false, reason: "disabled" });
    // The assertion the DoD actually asks for: no session came out of this.
    expect(fakeJar.writes).toHaveLength(0);

    vi.unstubAllEnvs();
  });

  it("issues NO session when the flag is set to anything other than \"true\"", async () => {
    // A truthy-looking value must not be a truthy value. `=== "true"` is what the
    // action checks, and this pins that it stays an exact comparison rather than
    // drifting into `Boolean(process.env.X)`, under which "false" would enable it.
    for (const value of ["false", "1", "yes", "TRUE", " true"]) {
      vi.stubEnv("DEMO_LOGIN_ENABLED", value);
      fakeJar.writes = [];

      const result = await demoSignIn("0");

      expect(result, `flag value ${JSON.stringify(value)}`).toEqual({
        ok: false,
        reason: "disabled",
      });
      expect(fakeJar.writes, `flag value ${JSON.stringify(value)}`).toHaveLength(0);
    }

    vi.unstubAllEnvs();
  });
});

describe("a typed number can only ever name a seeded demo account", () => {
  it("refuses every number outside the fixed table, issuing no session", async () => {
    vi.stubEnv("DEMO_LOGIN_ENABLED", "true");

    const outside = [
      String(DEMO_USERS.length), // one past the end
      "99",
      "-1",
      "1.5",
      // Would be 10 under `Number()`, which is exactly why the parse is digits-only.
      "1e1",
      "abc",
      "",
      "0x0",
      "٠", // Arabic-Indic zero: a digit to a human, not to /^\d+$/
    ];

    for (const typed of outside) {
      fakeJar.writes = [];
      const result = await demoSignIn(typed);

      expect(result, `typed ${JSON.stringify(typed)}`).toEqual({
        ok: false,
        reason: "unknownNumber",
      });
      expect(fakeJar.writes, `typed ${JSON.stringify(typed)}`).toHaveLength(0);
    }

    vi.unstubAllEnvs();
  });

  it("maps a number to an INDEX in the fixed table, never to a phone lookup", () => {
    // The distinction this whole design rests on: there is no input that means
    // "the account whose phone is 0500000001". Every resolvable input is a small
    // index, and the set of resolvable inputs is exactly the seeded cast.
    for (const [index, user] of DEMO_USERS.entries()) {
      expect(demoUserFor(String(index))).toEqual(user);
    }

    // A real Israeli mobile number, typed in full, names nobody.
    expect(demoUserFor("0501234567")).toBeNull();
    // Not even one of our own demo phones, typed as a phone rather than an index.
    expect(demoUserFor("972500009000")).toBeNull();

    // Surrounding whitespace is forgiven, and only whitespace. " 1 " is
    // unambiguously the index 1 somebody meant, and being strict about a stray
    // space would only punish whoever is presenting; it still lands in the fixed
    // table, so nothing about the boundary changes.
    expect(demoUserFor(" 1 ")).toEqual(DEMO_USERS[1]);
  });
});

/**
 * Signs in the way `demoSignInAction` does: `/verify` only, never `/otp`.
 *
 * Deliberately NOT `helpers.signInAs`, which requests a code first. That request
 * is rate-limited to one a minute per number (`[auth.sms] max_frequency`), so a
 * suite using it here fails whenever the e2e specs have recently signed in as the
 * same demo accounts — a cooldown that has nothing to do with what is asserted.
 * Verifying directly is also the more faithful test: it exercises the exact call
 * the action makes.
 */
async function demoVerifySignIn(phone: string): Promise<Client> {
  const client = anonClient();
  const { error } = await client.auth.verifyOtp({ phone, token: DEMO_OTP, type: "sms" });
  if (error) throw error;
  return client;
}

/** Signed in once for the whole file — the session is a fixture, not the subject. */
let demoInstructor: Client;
let demoDancer: Client;
let service: Client;

beforeAll(async () => {
  service = serviceClient();
  demoInstructor = await demoVerifySignIn(DEMO_USERS[0]!.phone);
  demoDancer = await demoVerifySignIn(DEMO_USERS[1]!.phone);
});

describe("the seeded demo cast is shaped the way the demo claims", () => {

  it("has exactly one מרקיד, at index 0, and רוקדים after it", async () => {
    for (const [index, user] of DEMO_USERS.entries()) {
      const { data: profile, error } = await service
        .from("profiles")
        .select("id, display_name")
        .eq("phone", user.phone)
        .single();
      if (error) throw error;

      expect(profile.display_name, `demo user ${index}`).toBe(user.displayName);

      const { data: instructor } = await service
        .from("instructors")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();

      // The role the app shows is derived from this row — so this asserts the
      // seed and `DEMO_USERS` agree about who is a מרקיד, which is the only
      // thing the `role` field on that table is allowed to be describing.
      expect(roleFor(instructor), `demo user ${index}`).toBe(user.role);
    }

    expect(DEMO_USERS.filter((u) => u.role === "instructor")).toHaveLength(1);
    expect(DEMO_USERS[0]?.role).toBe("instructor");
  });

  it("signs in through the REAL OTP path to the exact seeded ids", async () => {
    // Not the demo action here — the underlying identity. This proves the phones
    // in the fixed table belong to the accounts seed.sql created, which is the
    // link between "typed 0" and "is the seeded מרקיד".
    //
    // It is also the assertion that caught the real bug in this phase: GoTrue
    // stores phones without a leading "+", so a seeded row written as "+9725..."
    // was missed by its lookup and a brand-new empty user was created instead.
    // A test that only checked "a session came back" would have passed.
    const { data: instructorUser } = await demoInstructor.auth.getUser();
    expect(instructorUser.user?.id).toBe(SEEDED_INSTRUCTOR_ID);

    const { data: dancerUser } = await demoDancer.auth.getUser();
    expect(dancerUser.user?.id).toBe(SEEDED_DANCER_ID);
  });
});

describe("the role gates UI only — Postgres still refuses a dancer's writes", () => {
  it("refuses a dancer-role demo user an instructor write, with the UI bypassed entirely", async () => {
    // Signed in as the seeded רוקד, talking to PostgREST directly. There is no
    // component, no Server Action and no role check anywhere in this path — which
    // is the point. If the role were doing the protecting, this would succeed.
    const dancer = demoDancer;

    const { data: instructor, error: readError } = await service
      .from("instructors")
      .select("id")
      .eq("profile_id", SEEDED_INSTRUCTOR_ID)
      .single();
    if (readError) throw readError;

    const { data: venue, error: venueError } = await service
      .from("venues")
      .select("id")
      .limit(1)
      .single();
    if (venueError) throw venueError;

    // (a) Publishing under somebody else's instructor id — the obvious attempt.
    const { error: insertError } = await dancer.from("dance_events").insert({
      instructor_id: instructor.id,
      venue_id: venue.id,
      price_agorot: 0,
    });
    expect(insertError).not.toBeNull();

    // (b) The same thing through the RPC the UI would have used. SECURITY INVOKER,
    // so `dance_events_insert_own` checks it as the caller and `owns_instructor`
    // is false for this person.
    const { error: rpcError } = await dancer.rpc("publish_dance", {
      p_instructor_id: instructor.id,
      p_venue_id: venue.id,
      p_starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_ends_at: new Date(Date.now() + 90_000_000).toISOString(),
    });
    expect(rpcError).not.toBeNull();

    // And nothing was written by either attempt.
    const { count } = await service
      .from("dance_events")
      .select("id", { count: "exact", head: true })
      .eq("instructor_id", instructor.id);
    expect(count).toBe(0);
  });

  it("refuses a dancer-role demo user an instructors row belonging to someone else", async () => {
    // The other shape of the same question: could a dancer grant themselves the
    // role by writing the row the role is derived FROM? Only for themselves, and
    // only unverified — which is the documented, already-permitted self-service
    // path (docs/decisions/0018), not an escalation.
    const { error } = await demoDancer.from("instructors").insert({
      profile_id: SEEDED_INSTRUCTOR_ID, // somebody else's profile
      display_name: "לא שלי",
    });
    expect(error).not.toBeNull();
  });
});
