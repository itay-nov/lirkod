import type { OccurrenceStatus } from "@/lib/db/dances";

/**
 * How a dance's status looks as a map pin.
 *
 * The sibling of `src/components/danceStatusAppearance.ts`, and deliberately
 * built on the same conventions rather than a second visual language: gold fill
 * with a dashed edge means "הועבר" here exactly as a dashed gold-badged ring
 * does on the hero list and the schedule, and ink-with-paper means "בוטל" in
 * both places. A dancer who learns what a pin means should not have to learn it
 * again one screen down.
 *
 * AGENTS.md §2.6 — status is never carried by colour alone. Three separate
 * non-colour cues do that here:
 *   * silhouette differs — a plain pin, a pin with an arrow, a pin with an X
 *   * the edge differs — solid for a normal night, dashed for a moved one
 *   * the marker's accessible name spells the status out in words (see
 *     `mapDance.ts`, which builds it)
 * Any one of them survives a greyscale screenshot or a colour-blind reader.
 *
 * A plain module: no DOM, no React, no state, so it is unit-testable without
 * jsdom (AGENTS.md §3).
 */

/**
 * Pin geometry, in CSS pixels.
 *
 * 52 wide clears the 48x48 minimum tap target (AGENTS.md §5) on its own — pins
 * are controls here, not decoration, and this audience taps them with a thumb.
 * Fixed px rather than rem on purpose: this is a map graphic sized for touch
 * accuracy, not text, so it must not double at 200% and swallow the map.
 */
export const PIN_WIDTH_PX = 52;
export const PIN_HEIGHT_PX = 66;

/**
 * One teardrop: circle and tail as a single path, so the outline has no seam
 * where two shapes would meet. The tip sits at the bottom centre, which is
 * where an advanced marker anchors its content by default — the pin therefore
 * points at the venue's actual coordinates rather than near them.
 */
const SILHOUETTE = "M26 63 C20 51 8 39 8 26 a18 18 0 1 1 36 0 c0 13 -12 25 -18 37 z";

/**
 * A heavy ink outline on every pin regardless of fill. Google's tiles run from
 * pale sand to dark green depending on where you are, and a pin that only
 * contrasts with one of them is invisible over the other.
 */
const OUTLINE = 'stroke="var(--color-ink)" stroke-width="3" stroke-linejoin="round"';

const GLYPH = 'fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"';

/**
 * Points to the reading direction's "forward", which is leftwards in this RTL
 * app — mirrored from the LTR convention rather than borrowed from it, the same
 * call DanceRingScroller makes for its chevrons (AGENTS.md §7).
 */
const MOVED_ARROW = "M34 26 H18 M25 19 L18 26 L25 33";

const CANCELLED_CROSS = "M19 19 L33 33 M33 19 L19 33";

/**
 * Shows which pin the open preview belongs to. A ring, not just a colour change.
 *
 * Two concentric strokes, and secondary rather than ink. Ink is every pin's own
 * outline colour, so an ink ring 4px outside an ink outline reads as a slightly
 * thicker pin rather than as a selection — and it disappears entirely into the
 * ink fill of a cancelled one. Secondary is used by no pin fill or outline, so
 * it cannot blend into any of them, and the paper stroke behind it keeps the
 * ring off pale tiles.
 *
 * Colour is doing real work here, which §2.6 allows: this is which pin the open
 * panel belongs to, not the dance's status. The status stays carried by
 * silhouette and words, and the panel below names the venue outright.
 */
const SELECTION_HALO =
  '<circle cx="26" cy="26" r="22.5" fill="none" stroke="var(--color-surface)" stroke-width="8" />' +
  '<circle cx="26" cy="26" r="22.5" fill="none" stroke="var(--color-secondary)" stroke-width="4" />';

function svg(body: string, selected: boolean): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PIN_WIDTH_PX} ${PIN_HEIGHT_PX}" ` +
    `width="${PIN_WIDTH_PX}" height="${PIN_HEIGHT_PX}" aria-hidden="true" focusable="false">` +
    (selected ? SELECTION_HALO : "") +
    body +
    "</svg>"
  );
}

/**
 * The pin for a status, as SVG markup.
 *
 * Returns one of a closed set of constant strings — no argument is ever
 * interpolated into it, so the caller assigning this to `innerHTML` cannot be
 * injecting a venue name or anything else that came from the database.
 *
 * A real `switch` on the database enum, so TypeScript's exhaustiveness check
 * makes a fourth `occurrence_status` fail to compile rather than silently
 * rendering as a normal night — the failure AGENTS.md §10 cares most about.
 */
export function pinSvg(status: OccurrenceStatus, selected: boolean): string {
  switch (status) {
    case "scheduled":
      // Unmarked on purpose: "nothing is wrong" is the absence of a mark, which
      // is what makes the other two read as exceptions at a glance.
      return svg(`<path d="${SILHOUETTE}" fill="var(--color-accent)" ${OUTLINE} />`, selected);
    case "moved":
      return svg(
        `<path d="${SILHOUETTE}" fill="var(--color-highlight)" ${OUTLINE} stroke-dasharray="7 5" />` +
          `<path d="${MOVED_ARROW}" stroke="var(--color-ink)" ${GLYPH} />`,
        selected,
      );
    case "cancelled":
      return svg(
        `<path d="${SILHOUETTE}" fill="var(--color-ink)" ${OUTLINE} />` +
          `<path d="${CANCELLED_CROSS}" stroke="var(--color-surface)" ${GLYPH} />`,
        selected,
      );
  }
}
