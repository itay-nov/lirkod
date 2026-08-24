import type { DistanceRadiusMeters } from "@/lib/domain/distanceFilter";
import type { MapDance } from "@/lib/maps/mapDance";

interface Center {
  lat: number;
  lng: number;
}

/**
 * Browser-side adapter for the existing bounded proximity route.
 *
 * POST keeps a granted GPS position out of browser history and referrer logs.
 * The route rejects radii above 50km, and the underlying anonymous RPC clamps
 * them independently, so this typed UI adapter is convenience rather than a
 * security control.
 */
export async function fetchDancesNear(
  center: Center,
  radiusMeters: DistanceRadiusMeters,
): Promise<MapDance[]> {
  const response = await fetch("/api/dances/near", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...center, radiusMeters }),
  });

  if (!response.ok) throw new Error(`near query failed: ${response.status}`);

  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { dances?: unknown }).dances)
  ) {
    throw new Error("near query returned an unexpected shape");
  }

  return (payload as { dances: MapDance[] }).dances;
}
