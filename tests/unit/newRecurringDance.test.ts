import { describe, expect, it } from "vitest";
import { buildNewRecurringDance } from "@/lib/domain/newRecurringDance";

/**
 * The recurring builder's own rules. Everything it inherits from
 * `buildNewDance` — malformed dates, nonexistent times, the twelve-hour ceiling
 * — is pinned in newDance.test.ts and deliberately not re-asserted here, except
 * for the one case that proves the inheritance is wired up at all.
 */

const VALID = {
  venueId: "b0000000-0000-0000-0000-000000000001",
  repeat: "weekly",
  date: "2026-09-01",
  startTime: "20:00",
  endTime: "23:00",
  untilDate: "",
} as const;

describe("buildNewRecurringDance", () => {
  it("hands the wall clock through untouched, with no conversion to UTC", () => {
    const built = buildNewRecurringDance(VALID);

    expect(built).toEqual({
      command: {
        venueId: VALID.venueId,
        freq: "weekly",
        startDate: "2026-09-01",
        localStartTime: "20:00",
        localEndTime: "23:00",
        untilDate: null,
      },
    });

    // Stated as its own assertion because it is the whole design difference from
    // the single-night path: a series has no ONE UTC instant to compute here, and
    // producing one would be the first step towards stepping a week in UTC.
    expect(JSON.stringify(built)).not.toContain("Z");
  });

  it("carries the biweekly pattern through", () => {
    const built = buildNewRecurringDance({ ...VALID, repeat: "biweekly" });

    expect("command" in built && built.command.freq).toBe("biweekly");
  });

  it("treats a blank end date as 'until further notice'", () => {
    const built = buildNewRecurringDance({ ...VALID, untilDate: "   " });

    expect("command" in built && built.command.untilDate).toBeNull();
  });

  it("keeps an end date that is given", () => {
    const built = buildNewRecurringDance({ ...VALID, untilDate: "2026-12-31" });

    expect("command" in built && built.command.untilDate).toBe("2026-12-31");
  });

  it("accepts an end date equal to the start date", () => {
    // A one-night series is odd but coherent, and the database agrees: the
    // constraint is `until >= start`. Refusing it here would be a second, stricter
    // rule that only this path knows about.
    const built = buildNewRecurringDance({ ...VALID, untilDate: VALID.date });

    expect("command" in built).toBe(true);
  });

  it("rejects an end date before the start date, and names that field", () => {
    const built = buildNewRecurringDance({ ...VALID, untilDate: "2026-08-31" });

    expect(built).toEqual({
      problems: [{ field: "untilDate", reason: "beforeStart" }],
    });
  });

  it("rejects an unparseable end date", () => {
    const built = buildNewRecurringDance({ ...VALID, untilDate: "31/12/2026" });

    expect(built).toEqual({ problems: [{ field: "untilDate", reason: "malformed" }] });
  });

  it("rejects 31 February as an end date", () => {
    const built = buildNewRecurringDance({ ...VALID, untilDate: "2026-02-31" });

    expect(built).toEqual({ problems: [{ field: "untilDate", reason: "malformed" }] });
  });

  it("reports the single-night problems before looking at the end date", () => {
    // Both halves are wrong. The start time is named, because telling someone
    // their end date is invalid when the real mistake is above it sends them to
    // fix the wrong field (AGENTS.md §2).
    const built = buildNewRecurringDance({
      ...VALID,
      startTime: "twenty",
      untilDate: "nonsense",
    });

    expect(built).toEqual({ problems: [{ field: "startTime", reason: "malformed" }] });
  });

  it("inherits the twelve-hour ceiling from the single-night rules", () => {
    // The one inherited rule asserted here, so a refactor that stopped calling
    // buildNewDance would be caught rather than silently dropping every check it
    // owns.
    const built = buildNewRecurringDance({ ...VALID, startTime: "20:00", endTime: "19:00" });

    expect(built).toEqual({ problems: [{ field: "endTime", reason: "tooLong" }] });
  });

  it("rejects a time that does not exist in Israel on the first night", () => {
    // Spring forward 2026: the clock jumps 02:00 → 03:00 on 27 March, so 02:30
    // never happens. Rejected rather than nudged, for the reason jerusalemTime.ts
    // gives — a dance silently moved an hour is the failure §10 is about.
    const built = buildNewRecurringDance({
      ...VALID,
      date: "2026-03-27",
      startTime: "02:30",
      endTime: "05:00",
    });

    expect(built).toEqual({ problems: [{ field: "startTime", reason: "nonexistent" }] });
  });

  it("requires a venue, like the single-night path", () => {
    const built = buildNewRecurringDance({ ...VALID, venueId: "" });

    expect(built).toEqual({ problems: [{ field: "venueId", reason: "missing" }] });
  });
});
