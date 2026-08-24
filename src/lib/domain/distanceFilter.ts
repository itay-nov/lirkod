import { DEFAULT_RADIUS_METERS } from "@/lib/domain/defaultRegion";

export const DISTANCE_RADIUS_OPTIONS = [5_000, 15_000, 30_000, 50_000] as const;

export type DistanceRadiusMeters = (typeof DISTANCE_RADIUS_OPTIONS)[number];

export function isDistanceRadiusMeters(value: number): value is DistanceRadiusMeters {
  return DISTANCE_RADIUS_OPTIONS.some((option) => option === value);
}

/**
 * Reads the public schedule's radius from its URL.
 *
 * Only the four visible choices are accepted. This is presentation validation,
 * not the security boundary: direct RPC callers can still send any number, and
 * Postgres independently clamps it to 50km (migration 0003, carried through
 * migration 0013).
 */
export function distanceRadiusFromSearchParam(
  value: string | string[] | undefined,
): DistanceRadiusMeters {
  if (typeof value !== "string" || value.trim() === "") {
    return DEFAULT_RADIUS_METERS;
  }

  const parsed = Number(value);
  return isDistanceRadiusMeters(parsed) ? parsed : DEFAULT_RADIUS_METERS;
}
