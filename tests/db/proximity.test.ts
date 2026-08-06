import { describe, expect, it } from "vitest";
import { findDancesNear } from "@/lib/db/dances";
import { anonClient } from "../rls/helpers";

/**
 * Runs against the seeded data (supabase/seed.sql), not fixtures created here — those
 * three venues and their distances from Holon are the actual proof the radius filter
 * runs in Postgres, not just that the query executes. Requires `npm run db:reset` to
 * have loaded the seed before this suite runs.
 */

const HOLON_VENUE = "היכל התרבות חולון";
const TEL_AVIV_VENUE = "בית ציוני אמריקה";
const EILAT_VENUE = "מועדון הפיס אילת";

// A point in Holon — the seeded Holon venue's own coordinates.
const HOLON_LAT = 32.0114;
const HOLON_LNG = 34.7736;

describe("findDancesNear — proximity filtering runs in Postgres (AGENTS.md §9)", () => {
  it("returns the Holon venue and excludes Tel Aviv and Eilat within a 5km radius", async () => {
    const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 5_000);
    const venueNames = dances.map((d) => d.venueName);

    expect(venueNames).toContain(HOLON_VENUE);
    expect(venueNames).not.toContain(TEL_AVIV_VENUE);
    expect(venueNames).not.toContain(EILAT_VENUE);
  });

  it("includes Tel Aviv but still excludes Eilat within a 50km radius", async () => {
    const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 50_000);
    const venueNames = dances.map((d) => d.venueName);

    expect(venueNames).toContain(HOLON_VENUE);
    expect(venueNames).toContain(TEL_AVIV_VENUE);
    expect(venueNames).not.toContain(EILAT_VENUE);
  });

  it("runs unauthenticated, through the same RLS an anonymous map visitor uses", async () => {
    const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 5_000);

    expect(dances.length).toBeGreaterThan(0);
    expect(dances[0]).toMatchObject({
      status: "scheduled",
      venueName: HOLON_VENUE,
      instructorDisplayName: "רונית מרקידה",
    });
  });
});
