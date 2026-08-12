"use client";

import { useCallback, useState } from "react";
import { DanceMap, type DanceMapLabels } from "@/components/DanceMap";
import { DanceRing } from "@/components/DanceRing";
import { DanceRingScroller } from "@/components/DanceRingScroller";
import { useDemoHidden } from "@/lib/demo/demoVisibility";
import type { MapDance } from "@/lib/maps/mapDance";

export interface NearbyDancesLabels {
  heading: string;
  empty: string;
  listLabel: string;
  prevLabel: string;
  nextLabel: string;
}

/**
 * The hero screen: a map of the dances near you, and the same dances as a ring
 * list underneath.
 *
 * This component exists for one reason — to own the array both views read.
 * Before it, the map held the located result in its own state and the ring list
 * kept rendering the server's default-region render, so pressing "הצגת הרקדות
 * לידי" in Netanya left pins around Netanya above a list still describing Tel
 * Aviv. Two views of one query disagreeing about where "near you" is is exactly
 * the failure AGENTS.md §2 is least forgiving of: this audience has no way to
 * tell which one is lying. One array, one owner, two renderers.
 *
 * It is the screen's only client boundary — `DanceMap` and `DanceRingScroller`
 * are rendered by it rather than alongside it, so the count is unchanged from
 * docs/decisions/0007 and 0011. Everything it renders is a string built on the
 * server (`MapDance`), so no `he` dictionary and no `Intl` setup follows it into
 * the bundle; the labels below arrive as props for the same reason.
 *
 * The initial array still comes from the server render, so the first paint is
 * server HTML and nothing here runs before it (§2.9). State only ever changes
 * when a dancer asks to be located.
 */
export function NearbyDances({
  initialDances,
  initialCenter,
  apiKey,
  mapId,
  locatedRadiusMeters,
  mapLabels,
  labels,
  demoMode = false,
}: {
  initialDances: MapDance[];
  initialCenter: { lat: number; lng: number };
  apiKey: string;
  mapId: string;
  locatedRadiusMeters: number;
  mapLabels: DanceMapLabels;
  labels: NearbyDancesLabels;
  /** DEMO_MODE only (AGENTS.md §13 Phase 4.0) — see the note on `demoHidden` below. */
  demoMode?: boolean;
}) {
  const [dances, setDances] = useState(initialDances);
  const [center, setCenter] = useState(initialCenter);

  const handleLocated = useCallback(
    (located: MapDance[], locatedCenter: { lat: number; lng: number }) => {
      setDances(located);
      setCenter(locatedCenter);
    },
    [],
  );

  // The DEMO_MODE toggle in AppHeader flips this via the shared store; `demoMode`
  // is false in production (`page.tsx` reads NEXT_PUBLIC_DEMO_MODE the same way
  // it reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY), and with no button rendered to
  // ever flip `demoHidden`, `dances` always shows untouched. Display only — the
  // query result itself never changes.
  const demoHidden = useDemoHidden();
  const visibleDances = demoMode && demoHidden ? [] : dances;

  return (
    // min-h-full, not min-h-dvh, and a div rather than a <main>: the shell in
    // layout.tsx owns both the viewport height and the <main> landmark, and a
    // nested <main> is invalid while a second dvh box would overflow the scroll
    // container it sits in by exactly the height of the header and bar.
    <div className="flex min-h-full flex-col">
      <DanceMap
        dances={visibleDances}
        apiKey={apiKey}
        mapId={mapId}
        center={center}
        locatedRadiusMeters={locatedRadiusMeters}
        labels={mapLabels}
        onLocated={handleLocated}
      />

      <section className="mt-3 rounded-t-3xl bg-surface pb-8 pt-5 shadow-[0_-2px_12px_rgba(43,36,32,0.15)]">
        <h1 className="px-4 font-display text-3xl font-black">{labels.heading}</h1>

        {visibleDances.length === 0 ? (
          // Reached after a locate too, not only on first load: a dancer with
          // nothing within 10km of them must be told so, rather than left
          // looking at the previous region's list under an empty map. Also
          // what the DEMO_MODE toggle shows while it is on — the same honest
          // empty state, not a separate "demo" message.
          <p className="px-4 pt-4">{labels.empty}</p>
        ) : (
          <DanceRingScroller
            listLabel={labels.listLabel}
            prevLabel={labels.prevLabel}
            nextLabel={labels.nextLabel}
          >
            {visibleDances.map((dance) => (
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
