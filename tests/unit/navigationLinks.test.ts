import { describe, expect, it } from "vitest";
import {
  googleMapsNavigationUrl,
  wazeNavigationUrl,
} from "@/lib/maps/navigationLinks";

/**
 * These links leave our app and hand a dancer to another one, so a wrong
 * parameter is not a rendering bug — it drives someone to the wrong hall, or
 * drops them on a map with no route started. Asserted against the documented
 * URL shapes rather than against a snapshot of whatever we happen to build.
 */

// The seeded Holon venue.
const HOLON = { lat: 32.0114, lng: 34.7736 };

describe("wazeNavigationUrl", () => {
  it("starts navigation rather than only dropping a pin", () => {
    // Without navigate=yes Waze opens showing the place and waits — one more
    // step for a driver already holding a phone (AGENTS.md §2, fewer steps).
    expect(wazeNavigationUrl(HOLON)).toContain("navigate=yes");
  });

  it("addresses the venue by coordinates, never by name", () => {
    const url = wazeNavigationUrl(HOLON);

    // ll=<lat>,<lng>, comma percent-encoded. A `q=` name search could land a
    // dancer at a different hall that happens to share a word.
    expect(url).toBe("https://www.waze.com/ul?ll=32.011400%2C34.773600&navigate=yes");
    expect(url).not.toContain("q=");
  });
});

describe("googleMapsNavigationUrl", () => {
  it("asks for directions, not just a map centred on the place", () => {
    const url = googleMapsNavigationUrl(HOLON);

    expect(url).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=32.011400%2C34.773600",
    );
    // api=1 is what makes this the stable, documented Maps URL contract rather
    // than a scraped internal format.
    expect(url).toContain("api=1");
  });
});

describe("both builders", () => {
  const builders = [
    ["waze", wazeNavigationUrl],
    ["google maps", googleMapsNavigationUrl],
  ] as const;

  it.each(builders)("%s fixes precision instead of pasting a raw float", (_name, build) => {
    // 0.1m of precision is far past what a hall needs, and pinning it keeps a
    // float's full repr — or exponent notation — out of a URL a dancer may
    // well forward to somebody in WhatsApp.
    expect(build({ lat: 32.0000001234, lng: 34.5 })).toContain("32.000000%2C34.500000");
  });

  it.each(builders)("%s refuses a coordinate that is not on Earth", (_name, build) => {
    expect(() => build({ lat: 91, lng: 34 })).toThrow();
    expect(() => build({ lat: 32, lng: 181 })).toThrow();
  });

  it.each(builders)("%s refuses NaN rather than emitting a link to nowhere", (_name, build) => {
    // A NaN reaching here means an upstream bug; a "NaN,NaN" link would send
    // the dancer to Waze's error screen and look like Waze's fault.
    expect(() => build({ lat: Number.NaN, lng: 34 })).toThrow();
    expect(() => build({ lat: 32, lng: Number.POSITIVE_INFINITY })).toThrow();
  });
});
