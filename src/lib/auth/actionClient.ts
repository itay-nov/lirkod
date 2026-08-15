import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import type { Client } from "@/lib/db/client";

/**
 * A Supabase client for a Server Action that needs to CHANGE the session, not
 * just read it.
 *
 * The sibling of `serverClient()`, and the difference is the whole reason this
 * file exists: that one's `setAll` is a deliberate no-op, because a Server
 * Component is already streaming by the time it runs and has nowhere to put a
 * cookie. A Server Action has not started its response yet, so `cookies().set()`
 * genuinely works there — which makes this the only place in the app that can
 * establish a session server-side.
 *
 * Use `serverClient()` for every read. Reach for this one only when the point of
 * the action is to sign somebody in, and say so at the call site; a client that
 * can rewrite the session is not a general-purpose one.
 *
 * `setAll` is wrapped in a try/catch that is NOT swallowing an error (AGENTS.md
 * §6). Next throws from `cookies().set()` when the caller turns out to be a
 * render rather than an action, and there is exactly one correct response to
 * that: leave the cookie unwritten. The alternative — letting it propagate —
 * would turn a read that merely touched auth into a crashed page, which is the
 * failure `serverClient()`'s no-op exists to avoid in the first place.
 */
export async function actionClient(): Promise<Client> {
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
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // See the note above: a write with nowhere to go, not an error to handle.
        }
      },
    },
  });
}
