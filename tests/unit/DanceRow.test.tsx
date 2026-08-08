// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DanceRing } from "@/components/DanceRing";
import { DanceRow } from "@/components/DanceRow";
import type { NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { he } from "@/lib/i18n/he";

/**
 * The schedule's compact row. These mirror tests/unit/DanceRing.test.tsx on
 * purpose: the row is a layout variant, so every guarantee the ring makes about
 * status and keyboard access has to hold here too, or the two screens disagree
 * about what a dashed ring means.
 */

// 20:30 on a Monday in Asia/Jerusalem — see the note in DanceRing.test.tsx.
const STARTS_AT = "2025-06-02T17:30:00.000Z";

afterEach(cleanup);

function dance(status: OccurrenceStatus): NearbyDance {
  return {
    occurrenceId: "d0000000-0000-0000-0000-000000000001",
    startsAt: STARTS_AT,
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

describe("DanceRow", () => {
  it("is a real button, so it is keyboard reachable (AGENTS.md §2.7)", () => {
    render(<DanceRow dance={dance("scheduled")} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows the start time in Asia/Jerusalem, not UTC (AGENTS.md §7)", () => {
    render(<DanceRow dance={dance("scheduled")} />);
    expect(screen.getByRole("button")).toHaveTextContent("20:30");
  });

  it("gives a scheduled dance no status word — there is nothing to warn about", () => {
    render(<DanceRow dance={dance("scheduled")} />);
    const button = screen.getByRole("button");

    expect(button).not.toHaveTextContent(he.dance.status.moved);
    expect(button).not.toHaveTextContent(he.dance.status.cancelled);
  });

  it.each([
    ["moved", he.dance.status.moved],
    ["cancelled", he.dance.status.cancelled],
  ] as const)(
    "renders %s as a visible word, not colour alone (AGENTS.md §2.6)",
    (status, word) => {
      render(<DanceRow dance={dance(status)} />);
      expect(screen.getByRole("button")).toHaveTextContent(word);
    },
  );

  it("puts time, venue, instructor and status in a single aria-label", () => {
    render(<DanceRow dance={dance("cancelled")} />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";

    expect(label).toContain("20:30");
    expect(label).toContain("היכל התרבות חולון");
    expect(label).toContain("רונית מרקידה");
    expect(label).toContain(he.dance.status.cancelled);
  });

  it("names the weekday too, for someone who tabs in past the day header", () => {
    render(<DanceRow dance={dance("scheduled")} />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";

    expect(label).toContain("יום שני");
  });

  it("aligns to the reading direction logically, never to a hardcoded side", () => {
    // text-right would look correct in this RTL app and silently break the
    // moment anything renders LTR (AGENTS.md §7).
    const { container } = render(<DanceRow dance={dance("scheduled")} />);
    const className = container.querySelector("button")?.className ?? "";

    expect(className).toContain("text-start");
    expect(className).not.toMatch(/\btext-(left|right)\b/);
  });

  it.each(["scheduled", "moved", "cancelled"] as const)(
    "draws %s with the same ring stroke the hero screen uses",
    (status) => {
      const strokeOf = (element: React.ReactElement): string => {
        const { container } = render(element);
        const ring = container.querySelector(".rounded-full.border-4");
        return ring?.className ?? "";
      };

      // Not a restatement of the switch: this compares the two components
      // against each other, so a change made to one and not the other fails
      // here rather than shipping as two screens that disagree.
      const rowStroke = strokeOf(<DanceRow dance={dance(status)} />);
      const ringStroke = strokeOf(<DanceRing dance={dance(status)} />);

      expect(rowStroke).not.toBe("");
      for (const token of ["border-solid", "border-dashed", "border-accent", "border-secondary", "border-muted"]) {
        expect(rowStroke.includes(token)).toBe(ringStroke.includes(token));
      }
    },
  );
});
