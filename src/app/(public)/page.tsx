import { DanceRing } from "@/components/DanceRing";
import { DanceRingScroller } from "@/components/DanceRingScroller";
import { anonClient } from "@/lib/db/client";
import { findDancesNear } from "@/lib/db/dances";
import { he } from "@/lib/i18n/he";

/**
 * A fixed point in central Tel Aviv (Rabin Square) and a radius that covers Gush
 * Dan. Real geolocation is a later task, and AGENTS.md §9 is explicit that the
 * first render must never wait on a permission prompt — so the default region is
 * rendered first, unconditionally, and refined later once permission is granted.
 */
const DEFAULT_LAT = 32.0809;
const DEFAULT_LNG = 34.7806;
const DEFAULT_RADIUS_METERS = 15_000;

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
        The map area is deliberately empty, not decorated with sample pins. A pin's
        position on a map is data — placing fake ones would put wrong geography on
        the hero screen, and the rings below already show the real query result.
      */}
      <div
        role="region"
        aria-label={he.map.placeholderRegionLabel}
        className="flex min-h-[40dvh] grow items-center justify-center bg-secondary/15"
      >
        <p className="text-secondary">{he.map.placeholder}</p>
      </div>

      <section className="-mt-4 rounded-t-3xl bg-surface pb-8 pt-5 shadow-[0_-2px_12px_rgba(43,36,32,0.15)]">
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
