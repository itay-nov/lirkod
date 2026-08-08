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
// every render piles into the same document and getByRole("button") throws
// "found multiple elements" from the second test onwards.
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
  it("is a real button, so it is keyboard reachable (AGENTS.md §2.7)", () => {
    render(<DanceRing dance={dance("scheduled")} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows the start time in Asia/Jerusalem, not UTC (AGENTS.md §7)", () => {
    render(<DanceRing dance={dance("scheduled")} />);
    expect(screen.getByRole("button")).toHaveTextContent("20:30");
  });

  it("gives a scheduled dance no status word — there is nothing to warn about", () => {
    render(<DanceRing dance={dance("scheduled")} />);
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
      render(<DanceRing dance={dance(status)} />);
      expect(screen.getByRole("button")).toHaveTextContent(word);
    },
  );

  it("puts time, venue, instructor and status in a single aria-label", () => {
    render(<DanceRing dance={dance("cancelled")} />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";

    expect(label).toContain("20:30");
    expect(label).toContain("היכל התרבות חולון");
    expect(label).toContain("רונית מרקידה");
    expect(label).toContain(he.dance.status.cancelled);
  });

  it("omits the status clause from the aria-label of a scheduled dance", () => {
    render(<DanceRing dance={dance("scheduled")} />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";

    expect(label).toContain("20:30");
    expect(label).not.toContain(he.dance.status.cancelled);
    expect(label).not.toContain(he.dance.status.moved);
  });

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
