// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DanceRing } from "@/components/DanceRing";
import type { NearbyDance, OccurrenceStatus } from "@/lib/db/dances";
import { he } from "@/lib/i18n/he";

/**
 * Replaces tests/unit/home.test.tsx, which rendered the home page to prove the
 * Vitest harness runs. That page is now an async Server Component that queries
 * Postgres, so it cannot be rendered by react-dom/test-utils — its behaviour is
 * covered by tests/e2e/home.spec.ts instead, and these tests take over the
 * harness-proving role.
 */

// 2025-06-02T17:30:00Z is 20:30 on a Monday in Asia/Jerusalem (IDT, UTC+3) —
// a UTC-naive formatter would render 17:30, and a UTC-naive weekday would still
// say Monday, so the time assertion is the one that catches the timezone bug.
const STARTS_AT = "2025-06-02T17:30:00.000Z";

// Testing Library only registers its own afterEach cleanup when Vitest runs with
// `globals: true`, which vitest.config.ts deliberately does not. Without this,
// every render piles into the same document and queries match across renders
// from the second test onwards.
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

describe("DanceRing", () => {
  it("is not interactive while there is nowhere to go", () => {
    // It used to be a `<button>` with no handler: focusable, enabled, and inert
    // on Enter. Until the dance detail route exists there must be no control
    // here at all — see the TODO in DanceRing.tsx.
    const { container } = render(<DanceRing dance={dance("scheduled")} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("button, a, [tabindex], [role]")).toBeNull();
  });

  it("leaves its text to be read in place, with no aria-label to override it", () => {
    // A name on a role-less element is ignored by assistive tech, so an
    // aria-label left behind here would be a label nobody hears.
    const { container } = render(<DanceRing dance={dance("cancelled")} />);

    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("shows the start time in Asia/Jerusalem, not UTC (AGENTS.md §7)", () => {
    const { container } = render(<DanceRing dance={dance("scheduled")} />);
    expect(container).toHaveTextContent("20:30");
  });

  it("names the venue, the instructor and the weekday in visible text", () => {
    // With no aria-label carrying the night as one string, the visible text is
    // the whole of what a screen reader gets — so it has to be all there.
    const { container } = render(<DanceRing dance={dance("scheduled")} />);

    expect(container).toHaveTextContent("היכל התרבות חולון");
    expect(container).toHaveTextContent("רונית מרקידה");
    expect(container).toHaveTextContent("יום שני");
  });

  it("gives a scheduled dance no status word — there is nothing to warn about", () => {
    const { container } = render(<DanceRing dance={dance("scheduled")} />);

    expect(container).not.toHaveTextContent(he.dance.status.moved);
    expect(container).not.toHaveTextContent(he.dance.status.cancelled);
  });

  it.each([
    ["moved", he.dance.status.moved],
    ["cancelled", he.dance.status.cancelled],
  ] as const)(
    "renders %s as a visible word, not colour alone (AGENTS.md §2.6)",
    (status, word) => {
      const { container } = render(<DanceRing dance={dance(status)} />);
      expect(container).toHaveTextContent(word);
    },
  );

  it("distinguishes the three statuses by stroke as well as by word", () => {
    const strokeOf = (status: OccurrenceStatus): string => {
      const { container } = render(<DanceRing dance={dance(status)} />);
      const ring = container.querySelector(".rounded-full.border-4");
      return ring?.className ?? "";
    };

    expect(strokeOf("scheduled")).toContain("border-solid");
    expect(strokeOf("moved")).toContain("border-dashed");
    // Cancelled is solid but muted — distinct from scheduled's accent stroke.
    expect(strokeOf("cancelled")).toContain("border-muted");
  });
});
