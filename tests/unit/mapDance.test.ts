import { describe, expect, it } from "vitest";
import type { NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { he } from "@/lib/i18n/he";
import { toMapDance, toMapDances } from "@/lib/maps/mapDance";

/**
 * The server-side view model that keeps `he` and the Intl formatters out of the
 * map's client bundle. Its job is to arrive complete: anything missing here has
 * to be computed in the browser instead, which is the thing it exists to stop.
 */

// 2025-06-02T17:30:00Z is 20:30 on a Monday in Asia/Jerusalem (IDT, UTC+3).
const STARTS_AT = "2025-06-02T17:30:00.000Z";

function dance(status: OccurrenceStatus): NearbyDance {
  return {
    occurrenceId: "d0000000-0000-0000-0000-000000000001",
    startsAt: STARTS_AT,
    originalStartsAt: null,
    status,
    venueId: "b0000000-0000-0000-0000-000000000001",
    venueName: "היכל התרבות חולון",
    venueLat: 32.0114,
    venueLng: 34.7736,
    instructorDisplayName: "רונית מרקידה",
    danceTypes: ["ריקודי עם"],
    priceAgorot: 3000,
  };
}

describe("toMapDance", () => {
  it("formats the time in Asia/Jerusalem, not UTC (AGENTS.md §7)", () => {
    // A UTC-naive formatter renders 17:30 here, and the weekday still says
    // Monday — so the time is the assertion that catches the timezone bug.
    expect(toMapDance(dance("scheduled")).timeText).toBe("יום שני, 20:30");
  });

  it("carries the venue and the instructor as ready-to-render Hebrew", () => {
    const mapped = toMapDance(dance("scheduled"));

    expect(mapped.venueName).toBe("היכל התרבות חולון");
    expect(mapped.instructorText).toBe("עם רונית מרקידה");
  });

  it("keeps the coordinates the pin is placed at", () => {
    const mapped = toMapDance(dance("scheduled"));

    expect(mapped.lat).toBe(32.0114);
    expect(mapped.lng).toBe(34.7736);
  });

  it("gives a normal night no status word — there is nothing to warn about", () => {
    expect(toMapDance(dance("scheduled")).statusLabel).toBeNull();
  });

  it.each([
    ["moved", he.dance.status.moved],
    ["cancelled", he.dance.status.cancelled],
  ] as const)("labels %s in words for the preview badge (§2.6)", (status, word) => {
    expect(toMapDance(dance(status)).statusLabel).toBe(word);
  });

  it("puts the status word inside the pin's accessible name too", () => {
    // The pin announces as one thing, so a screen reader user only hears this
    // string — a cancelled pin that sounds identical to a normal one is
    // exactly the failure AGENTS.md §10 cares about most.
    const label = toMapDance(dance("cancelled")).pinLabel;

    expect(label).toContain("20:30");
    expect(label).toContain("היכל התרבות חולון");
    expect(label).toContain("רונית מרקידה");
    expect(label).toContain(he.dance.status.cancelled);
  });

  it("omits the status clause from a scheduled pin's name", () => {
    const label = toMapDance(dance("scheduled")).pinLabel;

    expect(label).toContain("20:30");
    expect(label).not.toContain(he.dance.status.cancelled);
    expect(label).not.toContain(he.dance.status.moved);
  });

  it("builds both navigation links, Waze first (AGENTS.md §9)", () => {
    const mapped = toMapDance(dance("scheduled"));

    expect(mapped.wazeUrl).toContain("waze.com");
    expect(mapped.wazeUrl).toContain("navigate=yes");
    expect(mapped.googleMapsUrl).toContain("google.com/maps/dir");
  });

  it("names each link by venue, so it reads correctly out of context", () => {
    const mapped = toMapDance(dance("scheduled"));

    expect(mapped.wazeLabel).toContain("היכל התרבות חולון");
    expect(mapped.googleMapsLabel).toContain("היכל התרבות חולון");
    // Not the same string: a screen reader user tabbing between two links must
    // be able to tell which app each one opens.
    expect(mapped.wazeLabel).not.toBe(mapped.googleMapsLabel);
  });

  it("leaves nothing for the client to format", () => {
    // The point of this shape: every field is a string or a number the client
    // renders as-is. A raw ISO timestamp surviving into it would mean the
    // browser has to format dates after all.
    const mapped = toMapDance(dance("moved"));

    expect(Object.values(mapped)).not.toContain(STARTS_AT);
  });
});

describe("toMapDances", () => {
  it("maps a list and keeps its order", () => {
    const first = dance("scheduled");
    const second = { ...dance("cancelled"), occurrenceId: "second" };

    expect(toMapDances([first, second]).map((d) => d.occurrenceId)).toEqual([
      first.occurrenceId,
      "second",
    ]);
  });

  it("maps an empty list to an empty list, not to a thrown error", () => {
    expect(toMapDances([])).toEqual([]);
  });
});
