import { describe, expect, it } from "vitest";
import {
  EMPTY_DANCE_FILTER,
  filterDances,
  isEmptyDanceFilter,
  matchesDanceFilter,
  type FilterableDance,
} from "@/lib/domain/danceFilter";

function dance(overrides: Partial<FilterableDance> = {}): FilterableDance {
  return {
    level: "all_levels",
    danceFormations: [],
    womenOnly: false,
    ...overrides,
  };
}

describe("isEmptyDanceFilter", () => {
  it("is true for the default filter", () => {
    expect(isEmptyDanceFilter(EMPTY_DANCE_FILTER)).toBe(true);
  });

  it("is false once any axis is set", () => {
    expect(isEmptyDanceFilter({ ...EMPTY_DANCE_FILTER, level: "beginner" })).toBe(false);
    expect(isEmptyDanceFilter({ ...EMPTY_DANCE_FILTER, formations: ["circle"] })).toBe(false);
    expect(isEmptyDanceFilter({ ...EMPTY_DANCE_FILTER, womenOnly: true })).toBe(false);
  });
});

describe("matchesDanceFilter", () => {
  it("matches everything under the default filter", () => {
    expect(matchesDanceFilter(dance({ level: "advanced", womenOnly: true }), EMPTY_DANCE_FILTER)).toBe(
      true,
    );
  });

  it("narrows to an exact level", () => {
    const filter = { ...EMPTY_DANCE_FILTER, level: "beginner" as const };

    expect(matchesDanceFilter(dance({ level: "beginner" }), filter)).toBe(true);
    expect(matchesDanceFilter(dance({ level: "advanced" }), filter)).toBe(false);
  });

  it("matches a dance carrying ANY of the selected formations", () => {
    const filter = { ...EMPTY_DANCE_FILTER, formations: ["circle", "line"] as FilterableDance["danceFormations"] };

    expect(matchesDanceFilter(dance({ danceFormations: ["circle", "couples"] }), filter)).toBe(
      true,
    );
    expect(matchesDanceFilter(dance({ danceFormations: ["couples"] }), filter)).toBe(false);
    expect(matchesDanceFilter(dance({ danceFormations: [] }), filter)).toBe(false);
  });

  it("requires women_only when the toggle is on", () => {
    const filter = { ...EMPTY_DANCE_FILTER, womenOnly: true };

    expect(matchesDanceFilter(dance({ womenOnly: true }), filter)).toBe(true);
    expect(matchesDanceFilter(dance({ womenOnly: false }), filter)).toBe(false);
  });

  it("requires every axis at once when more than one is set", () => {
    const filter = { level: "beginner" as const, formations: ["circle" as const], womenOnly: true };

    expect(
      matchesDanceFilter(dance({ level: "beginner", danceFormations: ["circle"], womenOnly: true }), filter),
    ).toBe(true);
    expect(
      matchesDanceFilter(dance({ level: "beginner", danceFormations: ["circle"], womenOnly: false }), filter),
    ).toBe(false);
  });
});

describe("filterDances", () => {
  it("returns a new array with every dance under the default filter", () => {
    const dances = [dance(), dance({ level: "advanced" })];

    expect(filterDances(dances, EMPTY_DANCE_FILTER)).toEqual(dances);
    expect(filterDances(dances, EMPTY_DANCE_FILTER)).not.toBe(dances);
  });

  it("drops non-matching dances, keeping order", () => {
    const beginner = dance({ level: "beginner" });
    const advanced = dance({ level: "advanced" });

    const result = filterDances([beginner, advanced], {
      ...EMPTY_DANCE_FILTER,
      level: "beginner",
    });

    expect(result).toEqual([beginner]);
  });
});
