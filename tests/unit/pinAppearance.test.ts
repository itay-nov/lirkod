// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { OccurrenceStatus } from "@/lib/db/dances";
import { PIN_HEIGHT_PX, PIN_WIDTH_PX, pinSvg } from "@/lib/maps/pinAppearance";

/**
 * AGENTS.md §2.6 in the one place it is easiest to break: a map pin is a small
 * coloured shape, and "make cancelled red" is the obvious implementation and
 * the wrong one. These assert the non-colour cues specifically — strip every
 * fill out of the markup and the three statuses must still be different.
 *
 * One test below runs under jsdom rather than this file's default node
 * environment, on purpose: a `.toContain()` substring match on the raw markup
 * cannot tell a well-formed `viewBox="..."` from one a browser's HTML parser
 * will mangle — both contain the substring. A real DOM parse is what would
 * have caught (this was found live, after the fact) that the opening `<svg>`
 * tag used to be built from two adjacent template literals joined by `+`,
 * and a production build (Next.js 16.2.12 / Turbopack) was dropping the
 * space+quote at that exact seam when folding them into one constant,
 * shipping `viewBox="0 0 52 66width="52"...` to every real browser —
 * `width`/`height` never parsed, so every pin rendered at the browser's
 * 300px SVG default and overflowed its anchored container, landing every pin
 * off its true position by the same offset. The fix was structural (one
 * literal, no `+` seam to corrupt); this test is what would have caught it.
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

  it.each(STATUSES)(
    "parses as a real %s SVG element with intact viewBox/width/height (not a mangled attribute string)",
    (status) => {
      // AdvancedMarkerElement anchors its content at the bottom-centre of the
      // content element's rendered box by default — the whole reason this
      // pin's silhouette tip sits at the bottom centre of its own viewBox
      // (see SILHOUETTE's comment). That anchoring only lands on the venue's
      // real coordinates if the SVG actually renders at PIN_WIDTH_PX ×
      // PIN_HEIGHT_PX. A `width`/`height` attribute that failed to parse —
      // the exact defect this regresses against — makes the browser fall
      // back to its 300×150 SVG default, which is how every pin ended up
      // rendered off its true position by the same fixed amount.
      const div = document.createElement("div");
      div.innerHTML = pinSvg(status, false);
      const svg = div.querySelector("svg");

      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${PIN_WIDTH_PX} ${PIN_HEIGHT_PX}`);
      expect(svg?.getAttribute("width")).toBe(String(PIN_WIDTH_PX));
      expect(svg?.getAttribute("height")).toBe(String(PIN_HEIGHT_PX));
    },
  );

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
    // danceStatusAppearance draws "המיקום שונה" with border-dashed. A dancer who
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

  it("draws the warm ring-pin band on every status (Phase 4.6c)", () => {
    // Purely decorative and identical across all three statuses — the
    // ring must not become a fourth cue any status leans on, or a screen
    // reader-equivalent reading of "one more circle" would start meaning
    // something. withoutColour already proves the three stay distinct
    // regardless (the test above), so this only checks the band exists.
    for (const status of STATUSES) {
      expect(withoutColour(pinSvg(status, false))).toContain('<circle cx="26" cy="24" r="13"');
    }
  });

  it("gives a normal night its own centre dot, not just an empty ring", () => {
    // The dot carries no status information (still zero <path> glyphs on a
    // scheduled pin — see "marks the two exceptional statuses" above), but a
    // scheduled pin should not be the only one of the three with a bare ring
    // at its centre once moved/cancelled have their arrow and cross there.
    expect(pinSvg("scheduled", false)).toContain('<circle cx="26" cy="24" r="4"');
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
