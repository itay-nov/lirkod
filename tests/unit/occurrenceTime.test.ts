import { describe, expect, it } from "vitest";
import { formatStartTime, formatStartWeekday } from "@/lib/domain/occurrenceTime";

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
  });
});
