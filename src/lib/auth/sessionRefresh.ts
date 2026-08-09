import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Renews an expiring access token and puts the new cookies on the response.
 *
 * This exists because of a hole `serverClient.ts` cannot close on its own: a
 * Server Component can read cookies but cannot write them, so when an access
 * token expires (`jwt_expiry`, one hour) it has no way to spend the refresh
 * token sitting right next to it. Without this, a dancer who signed in yesterday
 * opens /profile and is told to sign in again — with a perfectly good refresh
 * token in the jar. The proxy (Next 16's name for middleware) is the one place in
 * the request that can both see the cookies and still write to the response, so
 * the refresh happens here and every server render downstream reads the result.
 *
 * `getUser()` is what triggers the refresh; the return value is discarded on
 * purpose. Its job is to leave the cookies correct, not to decide
 * anything — /profile makes its own call (AGENTS.md §2.2 forbids gating reads,
 * and this must never grow into a redirect gate).
 *
 * Note the response wiring: cookies are written to BOTH `request` and
 * `response`. Writing only to the response leaves anything later in this same
 * request reading the stale value; writing only to the request never reaches the
 * browser. `@supabase/ssr` hands both to us in one `setAll` for exactly this
 * reason.
 */
export async function refreshSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // The proxy runs before anything else, so a misconfigured environment would
  // otherwise surface here as an unexplained 500 on every matched route. Let the
  // page render and fail with its own message instead.
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}
