import { describe, expect, it } from "vitest";
import { findDancesNear } from "@/lib/db/dances";
import { anonClient, serviceClient } from "../rls/helpers";

/**
 * Runs against the seeded data (supabase/seed.sql), not fixtures created here — those
 * three venues and their distances from Holon are the actual proof the radius filter
 * runs in Postgres, not just that the query executes.
 *
 * Requires a RECENT `npm run db:reset`, not just a running stack — `db:start` alone
 * does not load the seed. Seeded occurrences' `starts_at` values are only a few days
 * in the future, so if this suite starts failing days after the last reset, that is
 * stale seed data aging past `now()`, not a regression — reset and re-run before
 * assuming the query broke.
 */

const HOLON_VENUE = "היכל התרבות חולון";
const TEL_AVIV_VENUE = "בית ציוני אמריקה";
const EILAT_VENUE = "מועדון הפיס אילת"; // ~272.5km from Holon — beyond the 50km clamp too

// A point in Holon — the seeded Holon venue's own coordinates.
const HOLON_LAT = 32.0114;
const HOLON_LNG = 34.7736;
const HOLON_EVENT_ID = "c0000000-0000-0000-0000-000000000001";

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

  it("runs unauthenticated, through the same RLS an anonymous map visitor uses, ordered by starts_at", async () => {
    const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 5_000);

    expect(dances.length).toBeGreaterThan(0);

    // migration 0002 orders by starts_at, not by distance — asserted on the
    // invariant itself, not on which row happens to be first. Phase 4.0.1's
    // dense central cluster (supabase/seed.sql) put other venues inside 5km
    // of Holon too, so "the Holon dance is dances[0]" stopped being something
    // this data actually guarantees; the ordering does not depend on the
    // roster at all. Compared against a sorted copy rather than consecutive
    // indexing, so this reads under noUncheckedIndexedAccess with no `!`.
    const startTimes = dances.map((d) => Date.parse(d.startsAt));
    const sortedStartTimes = [...startTimes].sort((a, b) => a - b);
    expect(startTimes).toEqual(sortedStartTimes);

    // Every row is a real join result, not a partial one — the shape check
    // the old dances[0] assertion also did, kept without pinning it to one row.
    for (const dance of dances) {
      expect(dance.venueName.length).toBeGreaterThan(0);
      expect(dance.instructorDisplayName.length).toBeGreaterThan(0);
    }
  });
});

describe("find_dances_near bounds — an anonymous, unauthenticated RPC (migration 0003)", () => {
  it("clamps an oversized radius instead of returning the whole future table", async () => {
    const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 10_000_000);
    const venueNames = dances.map((d) => d.venueName);

    expect(venueNames).toContain(HOLON_VENUE);
    expect(venueNames).toContain(TEL_AVIV_VENUE);
    expect(venueNames).not.toContain(EILAT_VENUE);
  });

  it("rejects a zero or negative radius instead of silently reinterpreting it", async () => {
    await expect(findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 0)).rejects.toThrow();
    await expect(findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, -1)).rejects.toThrow();
  });

  it("rejects an out-of-range latitude or longitude", async () => {
    await expect(findDancesNear(anonClient(), 91, HOLON_LNG, 5_000)).rejects.toThrow();
    await expect(findDancesNear(anonClient(), HOLON_LAT, 181, 5_000)).rejects.toThrow();
  });

  it("caps the result at 200 rows (migration 0003's c_row_limit), even when far more match", async () => {
    const service = serviceClient();
    const rowsToInsert = 210;
    const baseStartsAt = Date.now() + 60 * 60 * 1000; // an hour from now — inside the horizon

    const { data, error } = await service
      .from("event_occurrences")
      .insert(
        Array.from({ length: rowsToInsert }, (_, i) => {
          const startsAt = new Date(baseStartsAt + i * 60 * 1000);
          const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
          return {
            event_id: HOLON_EVENT_ID,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            status: "scheduled" as const,
          };
        }),
      )
      .select("id");
    if (error) throw error;

    try {
      const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 50_000);
      expect(dances.length).toBe(200);
    } finally {
      await service
        .from("event_occurrences")
        .delete()
        .in(
          "id",
          data.map((row) => row.id),
        );
    }
  });

  it("returns level/danceFormations/womenOnly (Phase 4.6b, migration 0013) alongside the existing fields", async () => {
    // Proves the clamp/horizon/limit tests above and this one run against the
    // SAME function: migration 0013 dropped and recreated find_dances_near
    // rather than widening a copy, so if this passed the guards above still
    // hold for it.
    const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 5_000);
    const holon = dances.find((d) => d.venueName === HOLON_VENUE);

    expect(holon).toBeDefined();
    // The seeded fixture never sets these, so this is the migration's own
    // DEFAULT (`all_levels` / `{}` / false), read back through the RPC.
    expect(holon?.level).toBe("all_levels");
    expect(holon?.danceFormations).toEqual([]);
    expect(holon?.womenOnly).toBe(false);
  });

  it("excludes an occurrence beyond the 60-day horizon, even inside the radius", async () => {
    const service = serviceClient();
    const farStartsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const farEndsAt = new Date(farStartsAt.getTime() + 3 * 60 * 60 * 1000);

    const { data, error } = await service
      .from("event_occurrences")
      .insert({
        event_id: HOLON_EVENT_ID,
        starts_at: farStartsAt.toISOString(),
        ends_at: farEndsAt.toISOString(),
        status: "scheduled",
      })
      .select("id")
      .single();
    if (error) throw error;

    try {
      const dances = await findDancesNear(anonClient(), HOLON_LAT, HOLON_LNG, 5_000);
      expect(dances.map((d) => d.occurrenceId)).not.toContain(data.id);
    } finally {
      await service.from("event_occurrences").delete().eq("id", data.id);
    }
  });
});
