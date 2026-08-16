import { describe, expect, it } from "vitest";
import type { NearbyDance } from "@/lib/db/dances";
import { groupDancesByDay } from "@/lib/domain/scheduleDays";

/**
 * Node environment, no jsdom: the grouping is domain logic and must stay
 * importable without a DOM (AGENTS.md §3).
 *
 * Every timestamp here is chosen so that grouping by the UTC date and grouping
 * by the Asia/Jerusalem date give *different* answers — a suite built on
 * midday timestamps would pass just as happily against the bug §7 warns about.
 */
function danceAt(startsAt: string, occurrenceId = startsAt): NearbyDance {
  return {
    eventId: "c0000000-0000-0000-0000-000000000001",
    occurrenceId,
    startsAt,
    originalStartsAt: null,
    status: "scheduled",
    venueId: "b0000000-0000-0000-0000-000000000001",
    venueName: "היכל התרבות חולון",
    venueAddress: "רחוב סוקולוב 15, חולון",
    venueLat: 32.0114,
    venueLng: 34.7736,
    endsAt: startsAt,
    instructorDisplayName: "רונית מרקידה",
    danceTypes: ["ריקודי עם"],
    priceAgorot: 3000,
    level: "all_levels",
    danceFormations: [],
    womenOnly: false,
  };
}

describe("groupDancesByDay (AGENTS.md §7)", () => {
  it("keeps one Israeli day together even when it spans two UTC dates", () => {
    // 22:30Z on the 1st is already 01:30 on the 2nd in Jerusalem, so both of
    // these are the same night out. Grouping on the UTC date would split them.
    const days = groupDancesByDay([
      danceAt("2025-06-01T22:30:00.000Z"),
      danceAt("2025-06-02T05:00:00.000Z"),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]?.dayKey).toBe("2025-06-02");
    expect(days[0]?.dances).toHaveLength(2);
  });

  it("splits two Israeli days that share a single UTC date", () => {
    // The mirror image: 21:30Z on the 2nd is 00:30 on the 3rd in Jerusalem.
    // Grouping on the UTC date would merge these into one day.
    const days = groupDancesByDay([
      danceAt("2025-06-02T05:00:00.000Z"),
      danceAt("2025-06-02T21:30:00.000Z"),
    ]);

    expect(days.map((day) => day.dayKey)).toEqual(["2025-06-02", "2025-06-03"]);
  });

  it("uses the winter offset on the other side of the DST boundary", () => {
    // Israel is UTC+2 in January, so 22:30Z is 00:30 the next day — but only
    // just. A hardcoded +3 would put this on the 7th in both seasons.
    expect(groupDancesByDay([danceAt("2025-01-06T21:30:00.000Z")])[0]?.dayKey).toBe(
      "2025-01-06",
    );
    expect(groupDancesByDay([danceAt("2025-01-06T22:30:00.000Z")])[0]?.dayKey).toBe(
      "2025-01-07",
    );
  });

  it("preserves the order the query returned, both of days and within a day", () => {
    const days = groupDancesByDay([
      danceAt("2025-06-02T17:00:00.000Z", "first"),
      danceAt("2025-06-02T18:00:00.000Z", "second"),
      danceAt("2025-06-03T17:00:00.000Z", "third"),
    ]);

    expect(days.map((day) => day.dayKey)).toEqual(["2025-06-02", "2025-06-03"]);
    expect(days[0]?.dances.map((dance) => dance.occurrenceId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("regroups a day whose rows arrive non-adjacent, rather than repeating it", () => {
    // Not the order find_dances_near returns today. It is here because the
    // alternative implementation — start a new group when the key changes —
    // passes every test above and fails this one by rendering the 2nd twice.
    const days = groupDancesByDay([
      danceAt("2025-06-02T17:00:00.000Z", "a"),
      danceAt("2025-06-03T17:00:00.000Z", "b"),
      danceAt("2025-06-02T19:00:00.000Z", "c"),
    ]);

    expect(days.map((day) => day.dayKey)).toEqual(["2025-06-02", "2025-06-03"]);
    expect(days[0]?.dances.map((dance) => dance.occurrenceId)).toEqual(["a", "c"]);
  });

  it("returns no days at all for no dances, rather than one empty day", () => {
    expect(groupDancesByDay([])).toEqual([]);
  });
});
