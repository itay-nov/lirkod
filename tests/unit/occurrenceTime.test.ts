import { describe, expect, it } from "vitest";
import {
  formatCalendarDateWeekday,
  formatDayHeading,
  formatStartTime,
  formatStartWeekday,
  jerusalemDayKey,
  jerusalemTimeField,
} from "@/lib/domain/occurrenceTime";

/**
 * Runs in the default "node" environment (no jsdom docblock), which is the point:
 * it proves this module has no DOM dependency and survives the Capacitor wrap
 * (AGENTS.md §3).
 */
describe("occurrence time formatting (AGENTS.md §7)", () => {
  it("renders a UTC timestamp in Asia/Jerusalem, not in UTC", () => {
    // Summer: Israel is UTC+3 (IDT).
    expect(formatStartTime("2025-06-02T17:30:00.000Z")).toBe("20:30");
  });

  it("uses the right offset on the other side of the DST boundary", () => {
    // Winter: Israel is UTC+2 (IST). A hardcoded +3 would render 20:30 here.
    expect(formatStartTime("2025-01-06T17:30:00.000Z")).toBe("19:30");
  });

  it("uses a 24-hour clock, which is how this audience reads a start time", () => {
    expect(formatStartTime("2025-06-02T05:00:00.000Z")).toBe("08:00");
  });

  it("names the weekday in Hebrew, in Israel local time", () => {
    expect(formatStartWeekday("2025-06-02T17:30:00.000Z")).toBe("יום שני");
  });

  it("takes the weekday from the Israeli day, not the UTC one", () => {
    // 22:30Z on Sunday is already 01:30 on Monday in Jerusalem.
    expect(formatStartWeekday("2025-06-01T22:30:00.000Z")).toBe("יום שני");
  });

  it("throws on an unparseable timestamp rather than rendering 'Invalid Date'", () => {
    expect(() => formatStartTime("not a timestamp")).toThrow();
    expect(() => formatStartWeekday("")).toThrow();
    expect(() => jerusalemDayKey("not a timestamp")).toThrow();
    expect(() => formatDayHeading("")).toThrow();
  });

  it("keys a day as ISO-ordered YYYY-MM-DD, zero-padded", () => {
    // The zero padding is the assertion that matters: an unpadded "2025-6-2"
    // still groups correctly but sorts and compares wrongly the moment anything
    // downstream treats the key as ordered text.
    expect(jerusalemDayKey("2025-06-02T05:00:00.000Z")).toBe("2025-06-02");
  });

  it("takes the day key from the Israeli calendar date, not the UTC one", () => {
    // 22:30Z on the 1st is 01:30 on the 2nd in Jerusalem.
    expect(jerusalemDayKey("2025-06-01T22:30:00.000Z")).toBe("2025-06-02");
  });

  it("heads a day with the weekday and the date, in Hebrew", () => {
    const heading = formatDayHeading("2025-06-02T17:30:00.000Z");

    expect(heading).toContain("יום שני");
    expect(heading).toContain("2");
    expect(heading).toContain("ביוני");
  });

  it("heads the Israeli day, so a late-night dance is not filed under yesterday", () => {
    expect(formatDayHeading("2025-06-01T22:30:00.000Z")).toContain("יום שני");
  });

  it("names the weekday of a bare calendar date", () => {
    // What the publish form says a recurring dance repeats on, in place of a
    // weekday selector.
    expect(formatCalendarDateWeekday("2025-06-02")).toBe("יום שני");
  });

  it("names the weekday of the date itself, not of its UTC midnight", () => {
    // THE assertion for this function. `new Date("2025-06-01")` is midnight UTC,
    // which is 03:00 on the 1st in Israel — so this case passes either way. The
    // one that does not is a date whose UTC midnight falls on the previous
    // evening somewhere; going through the wall-clock conversion is what keeps
    // the answer tied to the date the instructor typed rather than to an instant.
    expect(formatCalendarDateWeekday("2025-06-01")).toBe("יום ראשון");
    expect(formatCalendarDateWeekday("2025-12-31")).toBe("יום רביעי");
  });

  it("fills a native time input with ASCII HH:MM in Israel local time", () => {
    // What goes into `<input type="time">`, which accepts exactly this shape.
    // A localised string — with an RTL mark, or Eastern Arabic digits under a
    // different locale — leaves the field blank and the control dead.
    expect(jerusalemTimeField("2025-06-02T17:30:00.000Z")).toBe("20:30");
    expect(jerusalemTimeField("2025-01-02T17:30:00.000Z")).toBe("19:30");
    expect(jerusalemTimeField("2025-06-02T17:30:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("renders an Israeli midnight as 00:00, never 24:00", () => {
    // Some ICU versions render midnight as "24" under h23, which a time input
    // rejects outright.
    expect(jerusalemTimeField("2025-06-01T21:00:00.000Z")).toBe("00:00");
  });

  it("returns null for something that is not a calendar date", () => {
    // The form calls this on every keystroke of a native date input, which is
    // empty and then partial before it is valid. A throw would be an error
    // boundary in the middle of typing.
    expect(formatCalendarDateWeekday("")).toBeNull();
    expect(formatCalendarDateWeekday("2025-02-31")).toBeNull();
  });
});
