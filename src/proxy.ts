import type { NextRequest } from "next/server";
import { refreshSession } from "@/lib/auth/sessionRefresh";

/**
 * `proxy.ts`, not `middleware.ts` — Next 16 renamed the convention and the build
 * warns on the old name. Same file, same semantics.
 */
export function proxy(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  /*
   * Only the routes that actually read a session.
   *
   * Supabase's own Next.js example matches nearly everything, and that would be
   * wrong here: `refreshSession` makes a network call to GoTrue, and the default
   * matcher would put that round trip in front of the map — the hero screen, on a
   * mid-range Android over 4G, with a 2.5s first-contentful-paint budget
   * (AGENTS.md §2.9, §9). The map needs no identity at all (§2.2), so it must not
   * pay for one.
   *
   * This is a token refresh, NOT a guard. /profile stays publicly reachable and
   * renders its own signed-out state; nothing here redirects, and nothing here
   * should ever start to. Add a path when that path reads a session — which is
   * what Phase 3.2's instructor screens will need.
   */
  matcher: ["/profile"],
};
