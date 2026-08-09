import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import type { Client } from "@/lib/db/client";

/**
 * The Supabase client a Client Component signs in through.
 *
 * Deliberately NOT `src/lib/db/client.ts`'s `anonClient()`, and deliberately in a
 * different file from the server one. Two reasons, one of them a build error:
 *
 *   * `anonClient()` is built with `persistSession: false` — correct for a
 *     request-scoped server read, useless for a sign-in, because the session it
 *     obtains would evaporate the moment the promise settled.
 *   * the server counterpart imports `next/headers`. A single module exporting both
 *     would drag that into the browser bundle the first time a Client Component
 *     imported this half, and Next refuses to compile it. The split is the fix, not
 *     tidiness.
 *
 * `createBrowserClient` stores the session in COOKIES rather than localStorage, which
 * is the entire reason `@supabase/ssr` is here (docs/decisions/0013): the same session
 * a dancer creates in the browser is then readable by Server Components, Route
 * Handlers and Server Actions, which is what Phase 3.2's instructor write needs in
 * order to run under that instructor's own RLS policies.
 *
 * Not memoised: `createBrowserClient` already returns the same instance for a given
 * URL/key pair within a page, so a module-level singleton here would add a second
 * cache in front of one that already exists.
 */
export function browserClient(): Client {
  // Literal property accesses, not process.env[name] — Next only inlines
  // NEXT_PUBLIC_* at build time when it can see the literal key. Same reasoning as
  // the note in src/lib/db/client.ts.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. " +
        "Locally: run `npm run db:start` and copy the printed values into .env.local.",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
