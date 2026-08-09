import { DanceMap } from "@/components/DanceMap";
import { DanceRing } from "@/components/DanceRing";
import { DanceRingScroller } from "@/components/DanceRingScroller";
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
    // min-h-full, not min-h-dvh, and a div rather than a <main>: the shell in
    // layout.tsx owns both the viewport height and the <main> landmark now, and
    // a nested <main> is invalid while a second dvh box would overflow the
    // scroll container it sits in by exactly the height of the header and bar.
    <div className="flex min-h-full flex-col">
      {/*
        The same query result the rings below render, drawn as pins. One read,
        two views — the map must never be able to disagree with the list under
        it about what is on tonight.

        Display strings are resolved here, on the server, so the client
        component ships no i18n dictionary and no date formatter (§2.9). Both
        env values are read as literal property accesses because that is the
        only form Next inlines at build time.
      */}
      <DanceMap
        dances={toMapDances(dances)}
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
        center={{ lat: DEFAULT_LAT, lng: DEFAULT_LNG }}
        locatedRadiusMeters={LOCATED_RADIUS_METERS}
        labels={{
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
      />

      <section className="mt-3 rounded-t-3xl bg-surface pb-8 pt-5 shadow-[0_-2px_12px_rgba(43,36,32,0.15)]">
        <h1 className="px-4 font-display text-3xl font-black">{he.home.heading}</h1>

        {dances.length === 0 ? (
          <p className="px-4 pt-4">{he.home.empty}</p>
        ) : (
          <DanceRingScroller
            listLabel={he.home.listLabel}
            prevLabel={he.home.prevLabel}
            nextLabel={he.home.nextLabel}
          >
            {dances.map((dance) => (
              <li key={dance.occurrenceId} className="flex">
                <DanceRing dance={dance} />
              </li>
            ))}
          </DanceRingScroller>
        )}
      </section>
    </div>
  );
}
