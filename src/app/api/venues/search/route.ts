import { NextResponse } from "next/server";
import { anonClient } from "@/lib/db/client";
import { searchVenues, type VenueOption } from "@/lib/db/venues";
import { createRateLimiter } from "@/lib/domain/rateLimit";

/**
 * Venue search for the create-dance form, run in Postgres rather than in the
 * browser.
 *
 * Why this exists at all: 3.2a filtered the whole `venues` table client-side,
 * which was right for three curated rows and wrong the moment 3.2b let anyone
 * add one. The browser would have to download every hall in the country to find
 * one. `searchVenues` bounds the query and this is the door the form knocks on.
 *
 * A route handler rather than a Server Action because this is a read that fires
 * on keystrokes: Next serialises Server Actions, so a laggy search would queue
 * behind whatever else the page is doing, and a GET is cacheable in a way a POST
 * is not.
 *
 * GET, unlike `api/dances/near` — and the contrast is the point. That route is a
 * POST specifically because its body carries a dancer's own position, which has
 * no business in a URL, a history entry or an access log (AGENTS.md §8). A venue
 * search is "היכל" typed into a public directory: the same rows are already
 * anon-readable through PostgREST, and there is no personal data to keep out of
 * the query string.
 *
 * The anon key on purpose. `venues_select_public` is `using (true)`, so this
 * endpoint can reach exactly what an unauthenticated visitor could reach anyway —
 * it adds convenience, never privilege. It notably does NOT use the caller's
 * session, so it cannot become a way to read something session-scoped by
 * accident.
 */

/**
 * Twenty searches a minute is far more than someone typing a hall name and far
 * less than a script enumerating the table. Generous on purpose: a whole
 * building behind one NAT address shares this budget.
 *
 * The same caveat as docs/decisions/0012 applies and is worth repeating rather
 * than assuming it carries: this is one process's memory, so it bounds one
 * instance, and the same rows are reachable straight from Supabase REST with the
 * public anon key. It is a speed bump on a public directory, not a wall.
 */
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

/** Longer than any hall name; a longer one is a probe, not a search. */
const MAX_QUERY_LENGTH = 120;

function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

export async function GET(
  request: Request,
): Promise<NextResponse<{ venues: VenueOption[] } | { error: string }>> {
  const decision = limiter.check(callerKey(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
    );
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "query_too_long" }, { status: 400 });
  }

  const venues = await searchVenues(anonClient(), query);

  return NextResponse.json({ venues });
}
