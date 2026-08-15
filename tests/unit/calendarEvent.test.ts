import { describe, expect, it } from "vitest";
import { buildIcsEvent, icsDataUrl } from "@/lib/domain/calendarEvent";

const NOW = new Date("2026-08-15T09:00:00.000Z");

const BASE = {
  uid: "d0000000-0000-0000-0000-000000000001",
  title: "הרקדה עם רונית מרקידה",
  location: "היכל התרבות חולון, רחוב סוקולוב 15, חולון",
  startUtcIso: "2025-06-02T17:30:00.000Z",
  endUtcIso: "2025-06-02T19:30:00.000Z",
  now: NOW,
};

describe("buildIcsEvent", () => {
  it("writes exactly one VEVENT with CRLF line endings (RFC 5545 §3.1)", () => {
    const ics = buildIcsEvent(BASE);

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(1);
    // No bare \n anywhere — every line break in the file is CRLF.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("converts the stored UTC instant straight to the RFC 5545 UTC form, no timezone math", () => {
    const ics = buildIcsEvent(BASE);

    expect(ics).toContain("DTSTART:20250602T173000Z");
    expect(ics).toContain("DTEND:20250602T193000Z");
    expect(ics).toContain("DTSTAMP:20260815T090000Z");
  });

  it("keys the UID off the occurrence, so re-adding the same night updates rather than duplicates", () => {
    const ics = buildIcsEvent(BASE);

    expect(ics).toContain(`UID:${BASE.uid}@lirkod.app`);
  });

  it("carries the title through verbatim when it needs no escaping", () => {
    const ics = buildIcsEvent(BASE);

    expect(ics).toContain(`SUMMARY:${BASE.title}`);
  });

  it("escapes the location's own venue/address comma", () => {
    const ics = buildIcsEvent(BASE);

    expect(ics).toContain(
      "LOCATION:היכל התרבות חולון\\, רחוב סוקולוב 15\\, חולון",
    );
  });

  it("escapes commas, semicolons and backslashes per RFC 5545 §3.3.11", () => {
    const ics = buildIcsEvent({
      ...BASE,
      title: "a; b, c\\d",
    });

    expect(ics).toContain("SUMMARY:a\\; b\\, c\\\\d");
  });

  it("escapes a literal newline in a field to the two-character \\n sequence", () => {
    const ics = buildIcsEvent({
      ...BASE,
      location: "line one\nline two",
    });

    expect(ics).toContain("LOCATION:line one\\nline two");
    // Not a real line break — the escaped \n must not create a new physical
    // line inside the file, which would corrupt the property structure.
    expect(ics).not.toMatch(/LOCATION:line one\r\n/);
  });

  it("escapes backslashes before the characters that step introduces, not after", () => {
    // A location already containing "\;" must come out as "\\;", not "\\;"
    // mangled into something a parser reads as an unescaped semicolon.
    const ics = buildIcsEvent({ ...BASE, location: "a\\;b" });

    expect(ics).toContain("LOCATION:a\\\\\\;b");
  });

  it("refuses an end that is not after the start", () => {
    expect(() =>
      buildIcsEvent({ ...BASE, endUtcIso: BASE.startUtcIso }),
    ).toThrow(/must be after/);
    expect(() =>
      buildIcsEvent({ ...BASE, endUtcIso: "2025-06-02T16:00:00.000Z" }),
    ).toThrow(/must be after/);
  });

  it("refuses a timestamp it cannot parse", () => {
    expect(() => buildIcsEvent({ ...BASE, startUtcIso: "not-a-date" })).toThrow(
      /not a parseable timestamp/,
    );
  });
});

describe("icsDataUrl", () => {
  it("builds a downloadable calendar data URL that decodes back to the file", () => {
    const content = buildIcsEvent(BASE);
    const url = icsDataUrl(content);

    expect(url.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(content);
  });
});
