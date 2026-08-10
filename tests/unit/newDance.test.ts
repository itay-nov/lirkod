import { describe, expect, it } from "vitest";
import { buildNewDance, type NewDanceInput } from "@/lib/domain/newDance";

const VENUE = "b0000000-0000-0000-0000-000000000001";

function input(overrides: Partial<NewDanceInput> = {}): NewDanceInput {
  return {
    venueId: VENUE,
    date: "2026-01-15",
    startTime: "20:00",
    endTime: "23:00",
    ...overrides,
  };
}

function commandOf(overrides: Partial<NewDanceInput> = {}) {
  const result = buildNewDance(input(overrides));
  if ("problems" in result) {
    throw new Error(`expected a command, got ${JSON.stringify(result.problems)}`);
  }
  return result.command;
}

function problemsOf(overrides: Partial<NewDanceInput> = {}) {
  const result = buildNewDance(input(overrides));
  if ("command" in result) throw new Error("expected problems, got a command");
  return result.problems;
}

describe("buildNewDance", () => {
  it("converts an ordinary winter evening to UTC", () => {
    expect(commandOf()).toEqual({
      venueId: VENUE,
      startsAtUtc: "2026-01-15T18:00:00.000Z",
      endsAtUtc: "2026-01-15T21:00:00.000Z",
      endsNextDay: false,
    });
  });

  it("keeps the venue exactly as given, without inspecting it", () => {
    // Whether the venue exists is the foreign key's answer and whether the
    // instructor may use it is RLS's. A second opinion here could only ever
    // disagree with the real one.
    expect(commandOf({ venueId: "not-a-uuid" }).venueId).toBe("not-a-uuid");
  });

  describe("an evening that runs past midnight", () => {
    it("reads the end time as the next morning", () => {
      const command = commandOf({ startTime: "21:00", endTime: "00:30" });

      expect(command.startsAtUtc).toBe("2026-01-15T19:00:00.000Z");
      expect(command.endsAtUtc).toBe("2026-01-15T22:30:00.000Z");
      expect(command.endsNextDay).toBe(true);
    });

    it("crosses a month boundary correctly", () => {
      const command = commandOf({ date: "2026-01-31", startTime: "22:00", endTime: "01:00" });
      expect(command.endsAtUtc).toBe("2026-01-31T23:00:00.000Z");
      expect(command.endsNextDay).toBe(true);
    });

    it("still ends after it starts when the night straddles the autumn DST change", () => {
      // 2026-10-25 is when the clocks go back, so this local evening is one hour
      // longer than it looks. The check that matters is the DB constraint's:
      // ends_at > starts_at, computed from real instants rather than from an
      // assumed 24-hour day.
      const command = commandOf({ date: "2026-10-24", startTime: "22:00", endTime: "02:00" });

      expect(Date.parse(command.endsAtUtc)).toBeGreaterThan(Date.parse(command.startsAtUtc));
      expect(command.endsNextDay).toBe(true);
    });
  });

  it("rejects a night longer than twelve hours rather than inventing one", () => {
    // 20:00–19:00 is a typo, not a 23-hour dance. Without the ceiling the
    // next-day reading turns the mistake into a plausible-looking row.
    expect(problemsOf({ startTime: "20:00", endTime: "19:00" })).toEqual([
      { field: "endTime", reason: "tooLong" },
    ]);
  });

  it("allows a night that is long but believable", () => {
    expect(commandOf({ startTime: "20:00", endTime: "02:00" }).endsNextDay).toBe(true);
  });

  it.each([
    [{ venueId: "" }, "venueId"],
    [{ date: "" }, "date"],
    [{ startTime: "" }, "startTime"],
    [{ endTime: "" }, "endTime"],
  ])("names the blank field %o", (overrides, field) => {
    expect(problemsOf(overrides)).toEqual([{ field, reason: "missing" }]);
  });

  it("reports every blank field at once, so the form is filled in one pass", () => {
    // This audience should not discover a second empty field only after fixing
    // the first (AGENTS.md §2).
    expect(problemsOf({ venueId: "", date: "", startTime: "", endTime: "" })).toHaveLength(4);
  });

  it("does not also complain about the date when a field is merely blank", () => {
    expect(problemsOf({ startTime: "" })).toEqual([{ field: "startTime", reason: "missing" }]);
  });

  it("blames the date field for an unparseable date", () => {
    expect(problemsOf({ date: "15/01/2026" })).toEqual([{ field: "date", reason: "malformed" }]);
  });

  it("blames the time field for an unparseable time", () => {
    expect(problemsOf({ startTime: "8pm" })).toEqual([
      { field: "startTime", reason: "malformed" },
    ]);
  });

  it("surfaces a start time that does not exist on the spring-forward night", () => {
    expect(problemsOf({ date: "2026-03-27", startTime: "02:30", endTime: "05:00" })).toEqual([
      { field: "startTime", reason: "nonexistent" },
    ]);
  });
});
