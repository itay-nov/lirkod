import type { DistanceFilterLabels } from "@/components/DistanceFilter";
import { DISTANCE_RADIUS_OPTIONS } from "@/lib/domain/distanceFilter";
import { he } from "@/lib/i18n/he";

/** Keeps the client component independent of the full Hebrew dictionary. */
export function distanceFilterLabels(): DistanceFilterLabels {
  return {
    legend: he.distanceFilter.legend,
    options: DISTANCE_RADIUS_OPTIONS.map((radiusMeters) => ({
      radiusMeters,
      label: he.distanceFilter.option(radiusMeters / 1_000),
    })),
    updating: he.distanceFilter.updating,
    updateFailed: he.distanceFilter.updateFailed,
  };
}
