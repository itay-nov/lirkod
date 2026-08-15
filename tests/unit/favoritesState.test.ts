import { describe, expect, it } from "vitest";
import { toggleFavoriteId } from "@/lib/domain/favoritesState";

/**
 * Node environment, no jsdom: pure and DOM-free, same as `favoritesStore.ts`
 * needs it to be (AGENTS.md §3).
 */
describe("toggleFavoriteId", () => {
  it("adds an id that was not favorited, and says it wasn't", () => {
    const { ids, wasFavorited } = toggleFavoriteId(new Set(), "event-1");

    expect(wasFavorited).toBe(false);
    expect(ids.has("event-1")).toBe(true);
  });

  it("removes an id that was favorited, and says it was", () => {
    const { ids, wasFavorited } = toggleFavoriteId(new Set(["event-1"]), "event-1");

    expect(wasFavorited).toBe(true);
    expect(ids.has("event-1")).toBe(false);
  });

  it("leaves every other id untouched", () => {
    const before = new Set(["event-1", "event-2"]);
    const { ids } = toggleFavoriteId(before, "event-1");

    expect(ids.has("event-2")).toBe(true);
  });

  it("does not mutate the set it was given", () => {
    const before = new Set(["event-1"]);
    toggleFavoriteId(before, "event-2");

    expect(before.has("event-2")).toBe(false);
    expect(before.size).toBe(1);
  });

  it("toggling twice returns to the original membership — what a failed write reverts with", () => {
    const original = new Set(["event-1"]);
    const once = toggleFavoriteId(original, "event-2");
    const twice = toggleFavoriteId(once.ids, "event-2");

    expect(twice.ids).toEqual(original);
  });
});
