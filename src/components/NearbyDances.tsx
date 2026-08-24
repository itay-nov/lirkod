"use client";

import { useCallback, useRef, useState } from "react";
import { DanceMap, type DanceMapLabels } from "@/components/DanceMap";
import { DistanceFilter, type DistanceFilterLabels } from "@/components/DistanceFilter";
import { DanceFilters, type DanceFiltersLabels } from "@/components/DanceFilters";
import { DanceRing } from "@/components/DanceRing";
import { DanceRingScroller } from "@/components/DanceRingScroller";
import { useDemoHidden } from "@/lib/demo/demoVisibility";
import { EMPTY_DANCE_FILTER, filterDances, type DanceAttributeFilter } from "@/lib/domain/danceFilter";
import type { DistanceRadiusMeters } from "@/lib/domain/distanceFilter";
import { fetchDancesNear } from "@/lib/maps/fetchDancesNear";
import type { MapDance } from "@/lib/maps/mapDance";

export interface NearbyDancesLabels {
  heading: string;
  /** The light map-screen framing above the map itself (Phase 4.6c). */
  tagline: string;
  empty: string;
  /** Shown when the filter (Phase 4.6b), not the query, is what leaves the list empty. */
  emptyFiltered: string;
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
 * server HTML and nothing here runs before it (§2.9). State changes only after
 * a dancer chooses a different distance or explicitly asks to be located.
 */
export function NearbyDances({
  initialDances,
  initialCenter,
  initialRadiusMeters,
  apiKey,
  mapId,
  mapLabels,
  distanceFilterLabels,
  filterLabels,
  labels,
  demoMode = false,
}: {
  initialDances: MapDance[];
  initialCenter: { lat: number; lng: number };
  initialRadiusMeters: DistanceRadiusMeters;
  apiKey: string;
  mapId: string;
  mapLabels: DanceMapLabels;
  distanceFilterLabels: DistanceFilterLabels;
  filterLabels: DanceFiltersLabels;
  labels: NearbyDancesLabels;
  /** DEMO_MODE only (AGENTS.md §13 Phase 4.0) — see the note on `demoHidden` below. */
  demoMode?: boolean;
}) {
  const [dances, setDances] = useState(initialDances);
  const [center, setCenter] = useState(initialCenter);
  const [radiusMeters, setRadiusMeters] = useState(initialRadiusMeters);
  const [radiusBusy, setRadiusBusy] = useState(false);
  const [radiusFailed, setRadiusFailed] = useState(false);
  const [filter, setFilter] = useState<DanceAttributeFilter>(EMPTY_DANCE_FILTER);
  const centerRef = useRef(initialCenter);
  const selectedRadiusRef = useRef(initialRadiusMeters);
  const appliedRadiusRef = useRef(initialRadiusMeters);
  const queryRequestRef = useRef(0);

  const queryNear = useCallback(
    async (queryCenter: { lat: number; lng: number }, queryRadius: DistanceRadiusMeters) => {
      const requestId = queryRequestRef.current + 1;
      queryRequestRef.current = requestId;

      try {
        const nearby = await fetchDancesNear(queryCenter, queryRadius);
        if (queryRequestRef.current !== requestId) return false;

        centerRef.current = queryCenter;
        appliedRadiusRef.current = queryRadius;
        setCenter(queryCenter);
        setDances(nearby);
        return true;
      } catch (error: unknown) {
        if (queryRequestRef.current !== requestId) return false;
        throw error;
      }
    },
    [],
  );

  const handleLocate = useCallback(
    async (locatedCenter: { lat: number; lng: number }) => {
      setRadiusBusy(false);
      setRadiusFailed(false);
      try {
        return await queryNear(locatedCenter, selectedRadiusRef.current);
      } catch (error: unknown) {
        selectedRadiusRef.current = appliedRadiusRef.current;
        setRadiusMeters(appliedRadiusRef.current);
        throw error;
      }
    },
    [queryNear],
  );

  const changeRadius = useCallback(
    (next: DistanceRadiusMeters) => {
      selectedRadiusRef.current = next;
      setRadiusMeters(next);
      setRadiusBusy(true);
      setRadiusFailed(false);

      void queryNear(centerRef.current, next).then(
        (applied) => {
          if (!applied) return;
          setRadiusBusy(false);
        },
        () => {
          selectedRadiusRef.current = appliedRadiusRef.current;
          setRadiusMeters(appliedRadiusRef.current);
          setRadiusBusy(false);
          setRadiusFailed(true);
        },
      );
    },
    [queryNear],
  );

  // The DEMO_MODE toggle in AppHeader flips this via the shared store; `demoMode`
  // is false in production (`page.tsx` reads NEXT_PUBLIC_DEMO_MODE the same way
  // it reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY), and with no button rendered to
  // ever flip `demoHidden`, `dances` always shows untouched. Display only — the
  // query result itself never changes.
  const demoHidden = useDemoHidden();
  const regionDances = demoMode && demoHidden ? [] : dances;
  // Attribute filtering runs on the set the current proximity query returned.
  // Distance changes re-run PostGIS; level/type/women-only remain a cheap
  // client-side refinement of at most 200 rows (migration 0003).
  const visibleDances = filterDances(regionDances, filter);

  return (
    // min-h-full, not min-h-dvh, and a div rather than a <main>: the shell in
    // layout.tsx owns both the viewport height and the <main> landmark, and a
    // nested <main> is invalid while a second dvh box would overflow the scroll
    // container it sits in by exactly the height of the header and bar.
    <div className="flex min-h-full flex-col">
      {/*
        Light map-screen framing (Phase 4.6c) — sits between AppHeader (every
        screen) and the map itself (this screen only), so a dancer opening a
        link from WhatsApp lands on a question the map then answers, rather
        than a wordmark directly over a grey box.
      */}
      <p className="px-4 pb-1 pt-3 font-display text-lg font-bold text-secondary">
        {labels.tagline}
      </p>

      <div className="px-4 pb-3">
        <DistanceFilter
          radiusMeters={radiusMeters}
          onChange={changeRadius}
          labels={distanceFilterLabels}
          busy={radiusBusy}
          failed={radiusFailed}
        />
      </div>

      <div className="px-4 pb-2">
        <DanceFilters filter={filter} onChange={setFilter} labels={filterLabels} />
      </div>

      <DanceMap
        dances={visibleDances}
        apiKey={apiKey}
        mapId={mapId}
        center={center}
        labels={mapLabels}
        onLocate={handleLocate}
      />

      <section className="mt-3 rounded-t-3xl bg-surface pb-8 pt-5 shadow-[0_-2px_12px_rgba(43,36,32,0.15)]">
        <h1 className="px-4 font-display text-3xl font-black">{labels.heading}</h1>

        {visibleDances.length === 0 ? (
          // Reached after a locate too, not only on first load: a dancer with
          // nothing within 10km of them must be told so, rather than left
          // looking at the previous region's list under an empty map. Also
          // what the DEMO_MODE toggle shows while it is on — the same honest
          // empty state, not a separate "demo" message.
          //
          // Two different reasons for "nothing to show" (Phase 4.6b): the
          // region itself has no dances, or a filter narrowed a real result
          // to nothing. Conflating them would tell a dancer with an active
          // filter that there is nothing near them at all, which is not true.
          <p className="px-4 pt-4">{regionDances.length === 0 ? labels.empty : labels.emptyFiltered}</p>
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
