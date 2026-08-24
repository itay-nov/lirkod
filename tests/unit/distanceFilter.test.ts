import { describe, expect, it } from "vitest";
import {
  DISTANCE_RADIUS_OPTIONS,
  distanceRadiusFromSearchParam,
  isDistanceRadiusMeters,
} from "@/lib/domain/distanceFilter";

describe("distance radius choices", () => {
  it("offers only the four product choices, up to the database cap", () => {
    expect(DISTANCE_RADIUS_OPTIONS).toEqual([5_000, 15_000, 30_000, 50_000]);
  });

  it("accepts a visible choice from the schedule URL", () => {
    expect(distanceRadiusFromSearchParam("30000")).toBe(30_000);
  });

  it("falls back to 15km for missing, repeated, malformed or arbitrary values", () => {
    expect(distanceRadiusFromSearchParam(undefined)).toBe(15_000);
    expect(distanceRadiusFromSearchParam(["5000", "50000"])).toBe(15_000);
    expect(distanceRadiusFromSearchParam("50001")).toBe(15_000);
    expect(distanceRadiusFromSearchParam("not-a-number")).toBe(15_000);
  });

  it("narrows numbers to the supported union", () => {
    expect(isDistanceRadiusMeters(5_000)).toBe(true);
    expect(isDistanceRadiusMeters(10_000)).toBe(false);
  });
});
