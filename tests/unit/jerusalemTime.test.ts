import { describe, expect, it } from "vitest";
import { jerusalemWallTimeToUtc, nextCalendarDay } from "@/lib/domain/jerusalemTime";

/**
 * The 2026 transition dates below are not remembered, they were measured against
 * this runtime's own tz database before the tests were written: Israel moves to
 * +03:00 on 2026-03-27 and back to +02:00 on 2026-10-25. The first test re-asserts
 * that through `Intl`, so if a future tz update moves the rule (the Knesset has
 * changed it before) this file says so instead of failing somewhere subtler.
 */
function israelOffsetAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(iso))
    .find((part) => part.type === "timeZoneName")!.value;
}

function utcOf(date: string, time: string): string {
  const result = jerusalemWallTimeToUtc({ date, time });
  if ("error" in result) throw new Error(`expected an instant, got ${result.error}`);
  return result.utcIso;
}

describe("the tz database this suite is written against", () => {
  it("still puts Israel's 2026 DST between 27 March and 25 October", () => {
    expect(israelOffsetAt("2026-03-26T12:00:00Z")).toBe("GMT+02:00");
    expect(israelOffsetAt("2026-03-27T12:00:00Z")).toBe("GMT+03:00");
    expect(israelOffsetAt("2026-10-24T12:00:00Z")).toBe("GMT+03:00");
    expect(israelOffsetAt("2026-10-25T12:00:00Z")).toBe("GMT+02:00");
  });
});

describe("jerusalemWallTimeToUtc", () => {
  it("subtracts two hours in winter (IST, +02:00)", () => {
    expect(utcOf("2026-01-15", "20:30")).toBe("2026-01-15T18:30:00.000Z");
  });

  it("subtracts three hours in summer (IDT, +03:00)", () => {
    expect(utcOf("2026-07-15", "20:30")).toBe("2026-07-15T17:30:00.000Z");
  });

  it("uses the offset in force on the day, not the offset in force today", () => {
    // The bug this guards: caching one offset, or deriving it from the machine's
    // own clock, makes every dance on the far side of a transition an hour wrong.
    expect(utcOf("2026-03-26", "21:00")).toBe("2026-03-26T19:00:00.000Z");
    expect(utcOf("2026-03-27", "21:00")).toBe("2026-03-27T18:00:00.000Z");
  });

  it("handles the evening either side of the autumn change", () => {
    expect(utcOf("2026-10-24", "21:00")).toBe("2026-10-24T18:00:00.000Z");
    expect(utcOf("2026-10-25", "21:00")).toBe("2026-10-25T19:00:00.000Z");
  });

  it("refuses a time that does not exist, rather than nudging it", () => {
    // 02:00 → 03:00 on the spring-forward night: 02:30 never happens. Moving it
    // silently to 03:30 would tell every dancer a time the instructor never
    // chose, which is the AGENTS.md §10 failure.
    expect(jerusalemWallTimeToUtc({ date: "2026-03-27", time: "02:30" })).toEqual({
      error: "nonexistent",
    });
  });

  it("resolves the hour that happens twice to the second one, deterministically", () => {
    // 01:30 occurs at both +03:00 and +02:00 on the autumn night. Which one is
    // arbitrary; that it is stable is not. Documented on the function.
    const resolved = utcOf("2026-10-25", "01:30");
    expect(resolved).toBe("2026-10-24T23:30:00.000Z");
    expect(israelOffsetAt(resolved)).toBe("GMT+02:00");
  });

  it("round-trips: the stored instant reads back as the time that was typed", () => {
    const readBack = (iso: string): string =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jerusalem",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso));

    for (const date of ["2026-01-15", "2026-03-27", "2026-07-01", "2026-10-25"]) {
      expect(readBack(utcOf(date, "20:30"))).toBe("20:30");
    }
  });

  it.each([
    ["", "20:30", "empty date"],
    ["2026-01-15", "", "empty time"],
    ["15/01/2026", "20:30", "a non-ISO date"],
    ["2026-01-15", "8:30pm", "a 12-hour time"],
    ["2026-13-01", "20:30", "month 13"],
    ["2026-02-31", "20:30", "31 February"],
    ["2026-01-15", "25:00", "hour 25"],
    ["2026-01-15", "20:60", "minute 60"],
  ])("rejects %s %s (%s) as malformed", (date, time) => {
    expect(jerusalemWallTimeToUtc({ date, time })).toEqual({ error: "malformed" });
  });

  it("accepts a real leap day", () => {
    expect(utcOf("2028-02-29", "20:00")).toBe("2028-02-29T18:00:00.000Z");
  });
});

describe("nextCalendarDay", () => {
  it("advances an ordinary day", () => {
    expect(nextCalendarDay("2026-01-15")).toBe("2026-01-16");
  });

  it.each([
    ["2026-01-31", "2026-02-01", "month end"],
    ["2026-12-31", "2027-01-01", "year end"],
    ["2028-02-28", "2028-02-29", "into a leap day"],
    ["2026-02-28", "2026-03-01", "past a non-leap February"],
  ])("crosses %s → %s (%s)", (from, to) => {
    expect(nextCalendarDay(from)).toBe(to);
  });

  it("is unaffected by the DST changes either side of it", () => {
    // Computed in UTC precisely so a 23- or 25-hour local day cannot shift it.
    expect(nextCalendarDay("2026-03-27")).toBe("2026-03-28");
    expect(nextCalendarDay("2026-10-25")).toBe("2026-10-26");
  });

  it("returns null for something that is not a date", () => {
    expect(nextCalendarDay("tomorrow")).toBeNull();
    expect(nextCalendarDay("")).toBeNull();
  });
});
