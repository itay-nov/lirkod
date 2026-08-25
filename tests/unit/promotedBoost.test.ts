import { describe, expect, it } from "vitest";
import type { NearbyDance } from "@/lib/db/dances";
import { boostPromotedWithinDay } from "@/lib/domain/promotedBoost";

/**
 * The sort half of the sponsored-promotion boost (migration 0017,
 * docs/decisions/0026). Pure, so no jsdom and no database — the RLS half, which
 * asserts that the function feeding this can only ever see PAID promotions and
 * can never leak a price, lives in tests/rls/promotedBoost.test.ts.
 *
 * Every case here is really one question: does a paid promotion move a dance up
 * a bit, without ever moving it to the top and without ever moving it out of
 * its day.
 */

/** Israeli evening times, as the schedule actually receives them: UTC ISO. */
function danceAt(eventId: string, utcHour: number, utcMinute = 0): NearbyDance {
  const startsAt = new Date(Date.UTC(2026, 8, 14, utcHour, utcMinute)).toISOString();
  return {
    eventId,
    occurrenceId: `occ-${eventId}`,
    startsAt,
    originalStartsAt: null,
    status: "scheduled",
    venueId: `venue-${eventId}`,
    venueName: "אולם",
    venueAddress: "רחוב כלשהו 1",
    venueLat: 32.0853,
    venueLng: 34.7818,
    endsAt: startsAt,
    instructorDisplayName: "מרקיד",
    danceTypes: [],
    priceAgorot: 4000,
    level: "all_levels",
    danceFormations: [],
    womenOnly: false,
    flyerUrl: null,
  };
}

const ids = (dances: readonly NearbyDance[]): string[] => dances.map((dance) => dance.eventId);

describe("boostPromotedWithinDay", () => {
  it("leaves the order exactly as it arrived when nothing is promoted", () => {
    const day = [danceAt("a", 16), danceAt("b", 17), danceAt("c", 18)];

    expect(ids(boostPromotedWithinDay(day, new Set()))).toEqual(["a", "b", "c"]);
  });

  it("moves a promoted dance up past the nights it now outranks", () => {
    // 19:00, 19:30, 20:00 local. Boosting the 20:00 by 90 minutes puts it at an
    // effective 18:30, ahead of both.
    const day = [danceAt("early", 16), danceAt("middle", 16, 30), danceAt("promoted", 17)];

    expect(ids(boostPromotedWithinDay(day, new Set(["promoted"])))).toEqual([
      "promoted",
      "early",
      "middle",
    ]);
  });

  it("does NOT lift a promoted dance above a night more than the boost earlier", () => {
    // The product line: a boost inside the existing order, never a jump to the
    // top. Two hours is more than the ninety-minute boost, so the opener keeps
    // its place.
    const day = [danceAt("opener", 16), danceAt("promoted", 18)];

    expect(ids(boostPromotedWithinDay(day, new Set(["promoted"])))).toEqual([
      "opener",
      "promoted",
    ]);
  });

  it("wins a tie against an unpromoted dance at the very same time", () => {
    // Two nights at 20:00, one of them paid for. The paid one goes first — a
    // tie is exactly the case the boost is meant to decide, and the stability
    // guarantee below is about dances the boost treats identically, not about
    // holding a promoted dance back.
    const day = [danceAt("first", 17), danceAt("promoted", 17)];

    expect(ids(boostPromotedWithinDay(day, new Set(["promoted"])))).toEqual([
      "promoted",
      "first",
    ]);
  });

  it("is stable for the dances it does not touch", () => {
    const day = [
      danceAt("a", 16),
      danceAt("b", 16),
      danceAt("c", 16),
      danceAt("promoted", 17),
      danceAt("d", 17),
    ];

    // a, b and c share a start time and must stay in arrival order; only the
    // promoted night moves.
    expect(ids(boostPromotedWithinDay(day, new Set(["promoted"])))).toEqual([
      "promoted",
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("orders two promoted dances against each other by their real times", () => {
    const day = [danceAt("later", 18), danceAt("earlier", 17)];

    expect(ids(boostPromotedWithinDay(day, new Set(["later", "earlier"])))).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("ignores promoted ids that are not in this day", () => {
    const day = [danceAt("a", 16), danceAt("b", 17)];

    expect(ids(boostPromotedWithinDay(day, new Set(["somewhere-else"])))).toEqual(["a", "b"]);
  });

  it("does not mutate the array it was given", () => {
    const day = [danceAt("a", 16), danceAt("promoted", 17)];
    const before = ids(day);

    boostPromotedWithinDay(day, new Set(["promoted"]));

    expect(ids(day)).toEqual(before);
  });

  it("never changes a dance's displayed start time, only its position", () => {
    const promoted = danceAt("promoted", 17);
    const [moved] = boostPromotedWithinDay([danceAt("a", 16, 45), promoted], new Set(["promoted"]));

    expect(moved?.eventId).toBe("promoted");
    expect(moved?.startsAt).toBe(promoted.startsAt);
  });
});
