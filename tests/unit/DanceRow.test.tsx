// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DanceRing } from "@/components/DanceRing";
import { DanceRow } from "@/components/DanceRow";
import type { NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { he } from "@/lib/i18n/he";
import { toMapDance } from "@/lib/maps/mapDance";

/**
 * The schedule's compact row. These mirror tests/unit/DanceRing.test.tsx on
 * purpose: the row is a layout variant, so every guarantee the ring makes about
 * status and keyboard access has to hold here too, or the two screens disagree
 * about what a dashed ring means.
 */

// 20:30 on a Monday in Asia/Jerusalem — see the note in DanceRing.test.tsx.
const STARTS_AT = "2025-06-02T17:30:00.000Z";

afterEach(cleanup);

/** 19:30 on the same evening — an hour before STARTS_AT. */
const ORIGINALLY_AT = "2025-06-02T16:30:00.000Z";

function dance(status: OccurrenceStatus, originalStartsAt: string | null = null): NearbyDance {
  return {
    eventId: "c0000000-0000-0000-0000-000000000001",
    occurrenceId: "d0000000-0000-0000-0000-000000000001",
    startsAt: STARTS_AT,
    originalStartsAt,
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
  it("is not interactive while there is nowhere to go", () => {
    // Same reasoning as the ring's equivalent test, and it has to be asserted
    // separately: the two are meant to change together, so a row turned back
    // into a bare button while the ring stayed inert would be exactly the drift
    // these mirrored suites exist to catch.
    const { container } = render(<DanceRow dance={dance("scheduled")} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("button, a, [tabindex], [role]")).toBeNull();
  });

  it("renders exactly the action it was handed, and nothing else interactive (Phase 4.5)", () => {
    // The one exception to the test above — see the comment on `action` in
    // DanceRow.tsx. A caller opting in gets exactly what it passed, not a
    // control the row invented on its own.
    render(
      <DanceRow
        dance={dance("scheduled")}
        action={<button type="button">חבר בדיקה</button>}
      />,
    );

    const button = screen.getByRole("button", { name: "חבר בדיקה" });
    expect(button).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves its text to be read in place, with no aria-label to override it", () => {
    const { container } = render(<DanceRow dance={dance("cancelled")} />);

    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("shows the start time in Asia/Jerusalem, not UTC (AGENTS.md §7)", () => {
    const { container } = render(<DanceRow dance={dance("scheduled")} />);
    expect(container).toHaveTextContent("20:30");
  });

  it("names the venue and the instructor in visible text", () => {
    // Not the weekday: the schedule groups rows under a day heading and labels
    // each day's list with it, so repeating it on every row would make a screen
    // reader say the day once per dance.
    const { container } = render(<DanceRow dance={dance("scheduled")} />);

    expect(container).toHaveTextContent("היכל התרבות חולון");
    expect(container).toHaveTextContent("רונית מרקידה");
  });

  it("gives a scheduled dance no status word — there is nothing to warn about", () => {
    const { container } = render(<DanceRow dance={dance("scheduled")} />);

    expect(container).not.toHaveTextContent(he.dance.status.moved);
    expect(container).not.toHaveTextContent(he.dance.status.cancelled);
  });

  it.each([
    ["moved", he.dance.status.moved],
    ["cancelled", he.dance.status.cancelled],
  ] as const)(
    "renders %s as a visible word, not colour alone (AGENTS.md §2.6)",
    (status, word) => {
      const { container } = render(<DanceRow dance={dance(status)} />);
      expect(container).toHaveTextContent(word);
    },
  );

  it("says a night's hour moved, and says which hour it moved from", () => {
    // The 3.3b failure this exists to prevent: an instructor moves one night from
    // 19:30 to 20:30, the status stays 'scheduled' because docs/decisions/0003
    // reserves 'moved' for a venue change, and without a label the row renders as
    // an ordinary dance. A dancer who planned around 19:30 is told nothing —
    // AGENTS.md §10's failure arriving through the feature meant to prevent it.
    const { container } = render(<DanceRow dance={dance("scheduled", ORIGINALLY_AT)} />);

    expect(container).toHaveTextContent(he.dance.status.retimedFrom("19:30"));
    // And the row shows the NEW time, so the two together read as a change.
    expect(container).toHaveTextContent("20:30");
  });

  it("does not draw a re-timed night as an ordinary one", () => {
    const strokeOf = (element: React.ReactElement): string => {
      const { container } = render(element);
      return container.querySelector(".rounded-full.border-4")?.className ?? "";
    };

    expect(strokeOf(<DanceRow dance={dance("scheduled", ORIGINALLY_AT)} />)).not.toBe(
      strokeOf(<DanceRow dance={dance("scheduled")} />),
    );
  });

  it("lets a cancellation outrank a time change, because the dance is off either way", () => {
    // A night moved and then cancelled says "בוטל". Telling someone the hour
    // changed on a dance that is not happening is noise on the one message that
    // matters.
    const { container } = render(<DanceRow dance={dance("cancelled", ORIGINALLY_AT)} />);

    expect(container).toHaveTextContent(he.dance.status.cancelled);
    expect(container).not.toHaveTextContent(he.dance.status.retimedFrom("19:30"));
  });

  it("aligns to the reading direction logically, never to a hardcoded side", () => {
    // text-right would look correct in this RTL app and silently break the
    // moment anything renders LTR (AGENTS.md §7).
    const { container } = render(<DanceRow dance={dance("scheduled")} />);
    const className = container.firstElementChild?.className ?? "";

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
      // The row still takes a NearbyDance and resolves its own appearance; the
      // ring takes the server-built view model. Both routes end at the same
      // `appearanceFor` call, and this is what proves they still agree.
      const rowStroke = strokeOf(<DanceRow dance={dance(status)} />);
      const ringStroke = strokeOf(<DanceRing dance={toMapDance(dance(status))} />);

      expect(rowStroke).not.toBe("");
      for (const token of ["border-solid", "border-dashed", "border-accent", "border-secondary", "border-muted"]) {
        expect(rowStroke.includes(token)).toBe(ringStroke.includes(token));
      }
    },
  );
});
