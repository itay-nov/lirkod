import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Client = SupabaseClient<Database>;

/**
 * The anon-key client — the one an unauthenticated visitor's reads go through,
 * bound by the same RLS policies as the browser (AGENTS.md §2.2, §8). Used from
 * Server Components and Route Handlers so the public map needs no session.
 *
 * There is deliberately no service_role client here. That key bypasses RLS and
 * belongs only in the narrow server paths that genuinely need it (AGENTS.md §8);
 * putting it behind the same import as this one invites the wrong default.
 */
export function anonClient(): Client {
  // Read as literal property accesses, not process.env[name]: Next only inlines
  // NEXT_PUBLIC_* at build time when it can see the literal key.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. " +
        "Locally: run `npm run db:start` and copy the printed values into .env.local.",
    );
  }

  return createClient<Database>(url, anonKey, {
    // Server-side and request-scoped: there is no session to persist, and a
    // refresh timer would keep a handle alive past the response.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
