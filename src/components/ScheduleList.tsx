"use client";

import { useMemo, useState } from "react";
import { DanceFilters, type DanceFiltersLabels } from "@/components/DanceFilters";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ScheduleRow } from "@/components/ScheduleRow";
import { EMPTY_DANCE_FILTER, filterDances, type DanceAttributeFilter } from "@/lib/domain/danceFilter";
import type { MapDance } from "@/lib/maps/mapDance";

export interface ScheduleDayGroup {
  /** "YYYY-MM-DD" in Asia/Jerusalem — a React key, never displayed. */
  dayKey: string;
  /** "יום שני, 2 ביוני" — computed server-side (formatDayHeading), never re-derived here. */
  heading: string;
  dayListLabel: string;
  dances: MapDance[];
}

/**
 * The schedule's level/type/women-only filter (Phase 4.6b) and the day-by-day
 * list underneath it.
 *
 * The one client boundary this screen gains. `days` arrives already grouped
 * and its headings already formatted by `schedule/page.tsx` — this component
 * only filters `MapDance[]` and picks which days still have anything in them,
 * the same "arrives complete, ships no `he`/`Intl`" discipline `NearbyDances`
 * follows for the map (docs/decisions/0007, AGENTS.md §2.9). `ScheduleRow`
 * (not `DanceRow`) is what makes that possible — see its own header.
 */
export function ScheduleList({
  days,
  filterLabels,
  emptyFilteredLabel,
}: {
  days: ScheduleDayGroup[];
  filterLabels: DanceFiltersLabels;
  emptyFilteredLabel: string;
}) {
  const [filter, setFilter] = useState<DanceAttributeFilter>(EMPTY_DANCE_FILTER);

  const filteredDays = useMemo(
    () =>
      days
        .map((day) => ({ ...day, dances: filterDances(day.dances, filter) }))
        .filter((day) => day.dances.length > 0),
    [days, filter],
  );

  return (
    <>
      <div className="pt-4">
        <DanceFilters filter={filter} onChange={setFilter} labels={filterLabels} />
      </div>

      {filteredDays.length === 0 ? (
        <p className="pt-4">{emptyFilteredLabel}</p>
      ) : (
        filteredDays.map((day) => (
          <section key={day.dayKey} className="pt-6">
            <h2 className="border-b-2 border-muted pb-1 font-display text-xl font-bold">
              {day.heading}
            </h2>

            <ul aria-label={day.dayListLabel} className="pt-2">
              {day.dances.map((dance) => (
                <li key={dance.occurrenceId}>
                  <ScheduleRow
                    dance={dance}
                    action={
                      <FavoriteButton eventId={dance.eventId} venueName={dance.venueName} />
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
