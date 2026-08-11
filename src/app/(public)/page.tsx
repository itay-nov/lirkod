import { NearbyDances } from "@/components/NearbyDances";
import { anonClient } from "@/lib/db/client";
import { findDancesNear } from "@/lib/db/dances";
import {
  DEFAULT_LAT,
  DEFAULT_LNG,
  DEFAULT_RADIUS_METERS,
  LOCATED_RADIUS_METERS,
} from "@/lib/domain/defaultRegion";
import { he } from "@/lib/i18n/he";
import { toMapDances } from "@/lib/maps/mapDance";

/**
 * Never prerendered at build time. A cancellation or a venue change is the
 * product's most important moment (AGENTS.md §10); a build-time snapshot of the
 * occurrence list would happily show a cancelled dance as still on, for as long
 * as the deployment lives.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Query, not fetch-then-filter: the radius runs in PostGIS (AGENTS.md §9).
  // Errors are not caught here on purpose — a failed read must surface, not
  // render as "no dances near you" (AGENTS.md §6).
  const dances = await findDancesNear(
    anonClient(),
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEFAULT_RADIUS_METERS,
  );

  return (
    // One query result, handed to one owner that draws it twice — as pins and
    // as rings. The map must never be able to disagree with the list under it
    // about what is on tonight, and after "near me" it used to: see the note on
    // NearbyDances.
    //
    // Display strings are resolved here, on the server, so the client ships no
    // i18n dictionary and no date formatter (§2.9). Both env values are read as
    // literal property accesses because that is the only form Next inlines at
    // build time.
    <NearbyDances
      initialDances={toMapDances(dances)}
      initialCenter={{ lat: DEFAULT_LAT, lng: DEFAULT_LNG }}
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
      mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
      locatedRadiusMeters={LOCATED_RADIUS_METERS}
      demoMode={process.env.NEXT_PUBLIC_DEMO_MODE === "true"}
      mapLabels={{
        regionLabel: he.map.regionLabel,
        loading: he.map.loading,
        unavailable: he.map.unavailable,
        locate: he.map.locate,
        locating: he.map.locating,
        located: he.map.located,
        locateFailed: he.map.locateFailed,
        previewLabel: he.map.preview.label,
        previewClose: he.map.preview.close,
        previewHint: he.map.preview.hint,
      }}
      labels={{
        heading: he.home.heading,
        empty: he.home.empty,
        listLabel: he.home.listLabel,
        prevLabel: he.home.prevLabel,
        nextLabel: he.home.nextLabel,
      }}
    />
  );
}
