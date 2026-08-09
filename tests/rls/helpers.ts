import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Client = SupabaseClient<Database>;

interface LocalStack {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * The OTP wired to every test phone number in supabase/config.toml
 * ([auth.sms.test_otp]). Signing in through the real phone-OTP path keeps the
 * suite honest about AGENTS.md §2.3 — there is no password flow to fall back on.
 */
const TEST_OTP = "123456";

export const PHONE_INSTRUCTOR_A = "+972500000001";
export const PHONE_INSTRUCTOR_B = "+972500000002";
export const PHONE_DANCER = "+972500000003";

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `\`supabase status\` did not report ${key}. Start the local stack first: npm run db:start`,
    );
  }
  return value;
}

let cached: LocalStack | undefined;

export function localStack(): LocalStack {
  if (cached) return cached;

  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    throw new Error(
      "Could not read the local Supabase stack. Start it with: npm run db:start",
      { cause },
    );
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("`supabase status -o json` returned something that is not an object");
  }
  const fields = parsed as Record<string, unknown>;

  cached = {
    apiUrl: requireString(fields, "API_URL"),
    anonKey: requireString(fields, "ANON_KEY"),
    serviceRoleKey: requireString(fields, "SERVICE_ROLE_KEY"),
  };
  return cached;
}

function client(key: string): Client {
  return createClient<Database>(localStack().apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A browsing dancer who has never logged in — the product's default visitor. */
export function anonClient(): Client {
  return client(localStack().anonKey);
}

/** Bypasses RLS. Fixture setup and independent verification only, never an assertion subject. */
export function serviceClient(): Client {
  return client(localStack().serviceRoleKey);
}

/**
 * Any non-empty string. `[auth.captcha]` runs against Cloudflare's published
 * "always passes" test secret locally (docs/decisions/0013), so the value is
 * never inspected — but the field must be there, because GoTrue rejects a
 * tokenless `/otp` before it looks at anything else. That rejection is the
 * control working, and `authControls.test.ts` asserts it.
 */
const TEST_CAPTCHA_TOKEN = "local-test-captcha-token";

export async function signInAs(phone: string): Promise<Client> {
  const signedIn = anonClient();

  const { error: otpError } = await signedIn.auth.signInWithOtp({
    phone,
    options: { captchaToken: TEST_CAPTCHA_TOKEN },
  });
  if (otpError) throw otpError;

  const { error: verifyError } = await signedIn.auth.verifyOtp({
    phone,
    token: TEST_OTP,
    type: "sms",
  });
  if (verifyError) throw verifyError;

  return signedIn;
}

/** A point in Tel Aviv, as PostGIS WKT. */
export function point(lon: number, lat: number): string {
  return `POINT(${lon} ${lat})`;
}
