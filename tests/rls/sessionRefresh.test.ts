import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { localStack } from "./helpers";
import { refreshSession } from "@/lib/auth/sessionRefresh";

/**
 * The proxy's token refresh, driven end to end against a real GoTrue.
 *
 * Here rather than in `tests/unit/` because it needs the live stack — the same
 * reason `tests/db/**` sits under this config. There is no honest hermetic
 * version of it: the thing under test is what happens when an expired access
 * token is exchanged for a new one, and stubbing the exchange would assert only
 * that the stub was called.
 *
 * What it is guarding: a refresh response carries `Set-Cookie` with a freshly
 * rotated session. Next's own default of `no-cache, must-revalidate` still lets a
 * shared cache STORE that response, so a CDN or reverse proxy in front of the app
 * could serve one dancer's session cookie to whoever asks for /profile next.
 * `@supabase/ssr` hands `setAll` a set of no-store headers precisely to prevent
 * that, and they are worth nothing unless something puts them on the response.
 */

/** Its own number: [auth.sms] max_frequency is keyed on it (docs/decisions/0013). */
const PHONE = "+972500000006";
const TEST_OTP = "123456";
const CAPTCHA_TOKEN = "local-test-captcha-token";

/** The exact set `@supabase/ssr` 0.12.4 supplies alongside rotated auth cookies. */
const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0",
  expires: "0",
  pragma: "no-cache",
};

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  user: unknown;
}

type Jar = Array<{ name: string; value: string }>;

async function admin(path: string, init?: RequestInit): Promise<Response> {
  const { apiUrl, serviceRoleKey } = localStack();
  return fetch(`${apiUrl}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(init?.headers ?? {}),
    },
  });
}

/** Resets the per-number cooldown, so a rerun inside a minute still works. */
async function deleteUser(): Promise<void> {
  const listed = await admin("admin/users?per_page=200");
  const body = (await listed.json()) as { users?: Array<{ id: string; phone?: string }> };

  for (const user of body.users ?? []) {
    if (user.phone === PHONE.replace("+", "")) {
      await admin(`admin/users/${user.id}`, { method: "DELETE" });
    }
  }
}

/**
 * A real session, obtained through the real phone-OTP path.
 *
 * Deletes the user first, every time. Each test here needs its own sign-in, and
 * `[auth.sms] max_frequency` is 60s per number — so without the reset the second
 * test in the file fails on a cooldown that has nothing to do with what it
 * asserts. Deleting the user is what resets the counter it is keyed on.
 */
async function signIn(): Promise<Session> {
  await deleteUser();

  const { apiUrl, anonKey } = localStack();
  const headers = { apikey: anonKey, "Content-Type": "application/json" };

  const sent = await fetch(`${apiUrl}/auth/v1/otp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      phone: PHONE,
      gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN },
    }),
  });
  if (!sent.ok) throw new Error(`could not request an OTP: ${await sent.text()}`);

  const verified = await fetch(`${apiUrl}/auth/v1/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: PHONE, token: TEST_OTP, type: "sms" }),
  });
  if (!verified.ok) throw new Error(`could not verify the OTP: ${await verified.text()}`);

  return (await verified.json()) as Session;
}

/**
 * Gets `@supabase/ssr` to write the session into an in-memory jar, so the cookie
 * names and encoding come from the library rather than from this test's idea of
 * them. Hardcoding `sb-<ref>-auth-token` here would mean the test keeps passing
 * against a naming scheme the app no longer uses.
 */
async function cookiesFor(session: Session): Promise<Jar> {
  const { apiUrl, anonKey } = localStack();
  let jar: Jar = [];

  const client = createServerClient(apiUrl, anonKey, {
    cookies: {
      getAll: () => jar,
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          jar = jar.filter((cookie) => cookie.name !== name);
          if (value !== "") jar.push({ name, value });
        }
      },
    },
  });

  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
  if (jar.length === 0) throw new Error("the library wrote no cookies for the session");

  return jar;
}

const BASE64_PREFIX = "base64-";

/**
 * Rewrites the stored session so its access token is already expired, leaving the
 * refresh token intact.
 *
 * This is what forces the code path under test. `getUser()` only spends a refresh
 * token when the access token is at or near expiry, and `jwt_expiry` is an hour —
 * so without this the test would assert that a response which never refreshed
 * anything carries no-store headers, which it would not, and for the right reason.
 *
 * Chunks are reassembled first: the library splits a long value across
 * `name.0`, `name.1`, … and any single chunk on its own is not valid base64.
 */
function expire(jar: Jar): Jar {
  const chunks = [...jar].sort((a, b) => a.name.localeCompare(b.name));
  const base = chunks[0]?.name.replace(/\.\d+$/, "");
  if (base === undefined) throw new Error("empty cookie jar");

  const combined = chunks.map((cookie) => cookie.value).join("");
  if (!combined.startsWith(BASE64_PREFIX)) {
    throw new Error(`unexpected cookie encoding: ${combined.slice(0, 20)}`);
  }

  const decoded = Buffer.from(combined.slice(BASE64_PREFIX.length), "base64url").toString();
  const stored = JSON.parse(decoded) as Record<string, unknown>;

  const expired = JSON.stringify({
    ...stored,
    expires_in: -60,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  });

  // Written back as one cookie rather than re-chunked: the reader reassembles
  // whatever it is given and an unchunked value is the degenerate case.
  return [
    { name: base, value: BASE64_PREFIX + Buffer.from(expired).toString("base64url") },
  ];
}

function requestWith(jar: Jar): NextRequest {
  const request = new NextRequest("http://localhost/profile");
  for (const { name, value } of jar) request.cookies.set(name, value);
  return request;
}

let originalUrl: string | undefined;
let originalKey: string | undefined;

beforeAll(async () => {
  // refreshSession reads the environment directly, and this config does not load
  // .env.local — point it at the same stack every other test here uses.
  originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = localStack().apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = localStack().anonKey;

  await deleteUser();
});

afterAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  await deleteUser();
});

describe("refreshSession renews an expired access token", () => {
  it("rotates the session cookie and marks the response uncacheable", async () => {
    const session = await signIn();
    const response = await refreshSession(requestWith(expire(await cookiesFor(session))));

    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).not.toBe("");

    // A refresh actually happened: the response carries a session cookie that is
    // not the one that went in. Without this the header assertions below would
    // pass on a response that never refreshed anything.
    const rotated = response.cookies.getAll().filter((c) => c.name.includes("auth-token"));
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated.some((c) => c.value.includes(session.access_token))).toBe(false);

    // THE assertion this file exists for. Every header the library supplied has to
    // land on the response that carries the Set-Cookie, or a shared cache is free
    // to store one dancer's rotated session and serve it to the next.
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("still yields a working session after the refresh", async () => {
    // The rotation above must produce a usable token, not merely a different
    // string — a refresh that returns something GoTrue rejects would satisfy
    // every assertion in the previous test.
    const session = await signIn();
    const response = await refreshSession(requestWith(expire(await cookiesFor(session))));

    const jar = response.cookies.getAll().map(({ name, value }) => ({ name, value }));
    const client = createServerClient(localStack().apiUrl, localStack().anonKey, {
      cookies: { getAll: () => jar, setAll: () => {} },
    });

    const { data, error } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.phone).toBe(PHONE.replace("+", ""));
  });

  it("leaves a request with no session cookies alone", async () => {
    // The anonymous case, which is most of the traffic /profile sees. Nothing was
    // refreshed, so there is no Set-Cookie to protect and no reason to mark the
    // response uncacheable.
    const response = await refreshSession(new NextRequest("http://localhost/profile"));

    expect(response.headers.getSetCookie()).toHaveLength(0);
    for (const name of Object.keys(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBeNull();
    }
  });
});
