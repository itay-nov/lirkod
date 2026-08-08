import { describe, expect, it } from "vitest";
import { isActiveTab } from "@/lib/domain/navigation";

/**
 * Default "node" environment, no jsdom docblock — this is the rule that decides
 * what `aria-current="page"` claims, and it must hold without a DOM (AGENTS.md §3).
 */
describe("isActiveTab", () => {
  it("marks a tab active on its own route", () => {
    expect(isActiveTab("/", "/")).toBe(true);
    expect(isActiveTab("/schedule", "/schedule")).toBe(true);
    expect(isActiveTab("/profile", "/profile")).toBe(true);
  });

  it("does not mark the map tab active on every other route", () => {
    // The bug a naive startsWith("/") check would produce: every path begins
    // with "/", so the map tab would claim to be the current page everywhere.
    expect(isActiveTab("/schedule", "/")).toBe(false);
    expect(isActiveTab("/profile", "/")).toBe(false);
  });

  it("keeps exactly one tab active for any of the three routes", () => {
    const hrefs = ["/", "/schedule", "/profile"];

    for (const pathname of hrefs) {
      const activeCount = hrefs.filter((href) => isActiveTab(pathname, href)).length;
      expect(activeCount).toBe(1);
    }
  });

  it("keeps the parent tab active inside its own subtree", () => {
    expect(isActiveTab("/schedule/2026-03-01", "/schedule")).toBe(true);
    // /profile/favorites is a plausible future URL shape for the merged
    // favorites section (docs/decisions/0008) — the profile tab should still
    // read as current if that ever becomes a real sub-route.
    expect(isActiveTab("/profile/favorites", "/profile")).toBe(true);
  });

  it("does not match a sibling route that merely shares a prefix", () => {
    // "/schedules" is not inside "/schedule" — a bare startsWith would say it is.
    expect(isActiveTab("/schedules", "/schedule")).toBe(false);
    expect(isActiveTab("/profile-settings", "/profile")).toBe(false);
  });
});
