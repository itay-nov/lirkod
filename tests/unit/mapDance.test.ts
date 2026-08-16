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
// 22:30 the same evening.
const ENDS_AT = "2025-06-02T19:30:00.000Z";

function dance(status: OccurrenceStatus): NearbyDance {
  return {
    eventId: "c0000000-0000-0000-0000-000000000001",
    occurrenceId: "d0000000-0000-0000-0000-000000000001",
    startsAt: STARTS_AT,
    originalStartsAt: null,
    status,
    venueId: "b0000000-0000-0000-0000-000000000001",
    venueName: "היכל התרבות חולון",
    venueAddress: "רחוב סוקולוב 15, חולון",
    venueLat: 32.0114,
    venueLng: 34.7736,
    endsAt: ENDS_AT,
    instructorDisplayName: "רונית מרקידה",
    danceTypes: ["ריקודי עם"],
    priceAgorot: 3000,
    level: "intermediate",
    danceFormations: ["circle", "couples"],
    womenOnly: false,
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

  it("carries the SERIES id, not just the occurrence's, for the heart toggle to favorite (Phase 4.5)", () => {
    // docs/decisions/0002: an occurrence is one materialized night, but what
    // a dancer favorites is the recurring dance behind it — eventId has to
    // survive this conversion for FavoriteButton to have anything to act on.
    expect(toMapDance(dance("scheduled")).eventId).toBe(
      "c0000000-0000-0000-0000-000000000001",
    );
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

  it("builds a WhatsApp share link pre-filled with venue, address, time and instructor", () => {
    const mapped = toMapDance(dance("scheduled"));
    const text = decodeURIComponent(mapped.shareUrl.slice("https://wa.me/?text=".length));

    expect(text).toContain("רונית מרקידה");
    expect(text).toContain("היכל התרבות חולון");
    expect(text).toContain("רחוב סוקולוב 15, חולון");
    expect(text).toContain("20:30");
    expect(text).toContain(mapped.googleMapsUrl);
  });

  it("names the WhatsApp status word in the share text, never colour alone (§2.6)", () => {
    const mapped = toMapDance(dance("cancelled"));
    const text = decodeURIComponent(mapped.shareUrl.slice("https://wa.me/?text=".length));

    expect(text).toContain(he.dance.status.cancelled);
  });

  it("offers an .ics download for a normal or moved night", () => {
    expect(toMapDance(dance("scheduled")).icsUrl).not.toBeNull();
    expect(toMapDance(dance("moved")).icsUrl).not.toBeNull();
  });

  it("does not offer a calendar entry for a cancelled night", () => {
    expect(toMapDance(dance("cancelled")).icsUrl).toBeNull();
  });

  it("names the .ics file by occurrence, so two downloads from one session never collide", () => {
    const mapped = toMapDance(dance("scheduled"));
    expect(mapped.icsFilename).toBe("d0000000-0000-0000-0000-000000000001.ics");
  });

  it("builds the type/level tag from formations then level (Phase 4.6b)", () => {
    const mapped = toMapDance(dance("scheduled"));

    expect(mapped.attributeTags).toEqual(["מעגלים", "זוגות", "בינוני"]);
  });

  it("tags a dance with no chosen formations by level alone, not an empty tag", () => {
    const mapped = toMapDance({ ...dance("scheduled"), danceFormations: [] });

    expect(mapped.attributeTags).toEqual([he.dance.level.intermediate]);
  });

  it("gives no women-only badge when the dance is not women_only", () => {
    expect(toMapDance(dance("scheduled")).womenOnlyLabel).toBeNull();
  });

  it("labels a women_only dance with the dignified badge text", () => {
    const mapped = toMapDance({ ...dance("scheduled"), womenOnly: true });

    expect(mapped.womenOnlyLabel).toBe(he.dance.womenOnly);
  });

  it("carries the raw level/formations/womenOnly for the filter", () => {
    const mapped = toMapDance(dance("scheduled"));

    expect(mapped.level).toBe("intermediate");
    expect(mapped.danceFormations).toEqual(["circle", "couples"]);
    expect(mapped.womenOnly).toBe(false);
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
