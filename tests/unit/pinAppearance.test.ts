import { describe, expect, it } from "vitest";
import type { OccurrenceStatus } from "@/lib/db/dances";
import { PIN_HEIGHT_PX, PIN_WIDTH_PX, pinSvg } from "@/lib/maps/pinAppearance";

/**
 * AGENTS.md §2.6 in the one place it is easiest to break: a map pin is a small
 * coloured shape, and "make cancelled red" is the obvious implementation and
 * the wrong one. These assert the non-colour cues specifically — strip every
 * fill out of the markup and the three statuses must still be different.
 */

const STATUSES: readonly OccurrenceStatus[] = ["scheduled", "moved", "cancelled"];

/** What is left of a pin for a reader who cannot distinguish its colours. */
function withoutColour(markup: string): string {
  return markup.replace(/(fill|stroke)="[^"]*"/g, "");
}

describe("pinSvg", () => {
  it.each(STATUSES)("draws a pin for %s", (status) => {
    const markup = pinSvg(status, false);

    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup).toContain(`viewBox="0 0 ${PIN_WIDTH_PX} ${PIN_HEIGHT_PX}"`);
  });

  it("gives every status a different silhouette, not just a different colour", () => {
    const shapes = STATUSES.map((status) => withoutColour(pinSvg(status, false)));

    expect(new Set(shapes).size).toBe(STATUSES.length);
  });

  it("marks the two exceptional statuses and leaves a normal night unmarked", () => {
    // Presence versus absence of a glyph is the cue that survives greyscale:
    // "nothing is wrong" is the plain pin, so the other two read as exceptions.
    const glyphs = (status: OccurrenceStatus) =>
      (pinSvg(status, false).match(/<path/g) ?? []).length;

    expect(glyphs("scheduled")).toBe(1);
    expect(glyphs("moved")).toBe(2);
    expect(glyphs("cancelled")).toBe(2);
  });

  it("dashes the moved pin's edge, the same convention the rings use", () => {
    // danceStatusAppearance draws "הועבר" with border-dashed. A dancer who
    // learns the dashed edge on one screen must find it on the other.
    expect(pinSvg("moved", false)).toContain("stroke-dasharray");
    expect(pinSvg("scheduled", false)).not.toContain("stroke-dasharray");
    expect(pinSvg("cancelled", false)).not.toContain("stroke-dasharray");
  });

  it("shows the chosen pin with a ring, so selection is not colour either", () => {
    for (const status of STATUSES) {
      const plain = withoutColour(pinSvg(status, false));
      const selected = withoutColour(pinSvg(status, true));

      expect(selected).not.toBe(plain);
      expect(selected).toContain("<circle");
    }
  });

  it("clears the 48px minimum tap target — a pin is a control (AGENTS.md §5)", () => {
    expect(PIN_WIDTH_PX).toBeGreaterThanOrEqual(48);
    expect(PIN_HEIGHT_PX).toBeGreaterThanOrEqual(48);
  });

  it("references colour tokens by role, never a literal hex (docs/decisions/0006)", () => {
    for (const status of STATUSES) {
      const markup = pinSvg(status, true);

      expect(markup).toMatch(/var\(--color-/);
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("interpolates nothing, which is what makes assigning it to innerHTML safe", () => {
    // The caller sets this as innerHTML. That is only defensible because the
    // output is a closed set of constants — no venue name or other row data
    // can reach it. Two calls for the same inputs being identical is the
    // cheapest standing check that nobody has since threaded an argument in.
    for (const status of STATUSES) {
      for (const selected of [false, true]) {
        expect(pinSvg(status, selected)).toBe(pinSvg(status, selected));
      }
    }
  });
});
