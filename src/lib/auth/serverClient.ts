import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import type { Client } from "@/lib/db/client";

/**
 * The Supabase client a Server Component, Route Handler or Server Action reads the
 * signed-in user through.
 *
 * `setAll` is a real no-op here, and that is not a swallowed error (AGENTS.md §6). A
 * Server Component genuinely cannot write cookies — Next has already begun streaming
 * the response by the time one runs — so there is no failure to handle, only a write
 * that has nowhere to go. Refreshing an expired token is `refreshSession` in
 * `sessionRefresh.ts`, which runs in `src/proxy.ts` where a response is still being
 * built.
 * Dropping the write silently here is what makes that split safe: the worst case is a
 * server render that sees no session for one request, never a corrupted cookie.
 *
 * Callers wanting "is anyone signed in" should use `currentUser()` in `session.ts`
 * rather than reaching for `.auth` on this directly — see the note there about why
 * `getUser()` and not `getSession()`.
 */
export async function serverClient(): Promise<Client> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. " +
        "Locally: run `npm run db:start` and copy the printed values into .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Intentionally nothing. See the note above this function.
      },
    },
  });
}
