import { DemoVisibilityGate } from "@/components/DemoVisibilityGate";
import { ScheduleDistanceFilter } from "@/components/ScheduleDistanceFilter";
import { ScheduleList, type ScheduleDayGroup } from "@/components/ScheduleList";
import { anonClient } from "@/lib/db/client";
import { findDancesNear } from "@/lib/db/dances";
import { DEFAULT_LAT, DEFAULT_LNG } from "@/lib/domain/defaultRegion";
import { danceFiltersLabels } from "@/lib/domain/danceFiltersLabels";
import { distanceRadiusFromSearchParam } from "@/lib/domain/distanceFilter";
import { distanceFilterLabels } from "@/lib/domain/distanceFilterLabels";
import { formatDayHeading } from "@/lib/domain/occurrenceTime";
import { groupDancesByDay } from "@/lib/domain/scheduleDays";
import { he } from "@/lib/i18n/he";
import { toMapDances } from "@/lib/maps/mapDance";

/**
 * Never prerendered, for the same reason the map is not (AGENTS.md §10): a
 * build-time snapshot would keep showing a cancelled dance as still on for as
 * long as the deployment lives. This route used to be static, so adding this
 * changes what the shell in (public)/layout.tsx prerenders — see the note there.
 */
export const dynamic = "force-dynamic";

/**
 * The same dances the map shows, listed by day.
 *
 * Deliberately the same find_dances_near call and the same default region as the
 * hero — a schedule for this audience means "the nights I could actually get to",
 * not a national listing. An unbounded global query would also drop the radius
 * clamp, row limit and 60-day horizon that migration 0003 exists to enforce.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ radius?: string | string[] }>;
}) {
  const radiusMeters = distanceRadiusFromSearchParam((await searchParams).radius);
  // Errors are not caught here on purpose — a failed read must surface, not
  // render as an empty schedule (AGENTS.md §6).
  const dances = await findDancesNear(
    anonClient(),
    DEFAULT_LAT,
    DEFAULT_LNG,
    radiusMeters,
  );

  const days = groupDancesByDay(dances);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  const emptyState = <p className="pt-4">{he.schedule.empty}</p>;

  // Headings are formatted here, server-side (formatDayHeading uses Intl —
  // see its own note) — ScheduleList (Phase 4.6b) only filters and renders
  // the already-complete MapDance[] this produces, the same discipline
  // toMapDances/MapDance follow for the map (docs/decisions/0007).
  const dayGroups: ScheduleDayGroup[] = days.map((day) => {
    const heading = formatDayHeading(day.dances[0].startsAt);
    return {
      dayKey: day.dayKey,
      heading,
      dayListLabel: he.schedule.dayListLabel(heading),
      dances: toMapDances(day.dances),
    };
  });

  const scheduleContent =
    days.length === 0 ? (
      emptyState
    ) : (
      <ScheduleList
        days={dayGroups}
        filterLabels={danceFiltersLabels()}
        emptyFilteredLabel={he.filters.emptyFiltered}
      />
    );

  return (
    <div className="px-4 pb-8 pt-5">
      <h1 className="font-display text-3xl font-black">{he.schedule.heading}</h1>

      <div className="pt-4">
        <ScheduleDistanceFilter
          radiusMeters={radiusMeters}
          labels={distanceFilterLabels()}
        />
      </div>

      {demoMode ? (
        // Only mounted when NEXT_PUBLIC_DEMO_MODE is set, so this route never
        // hands a real dancer a live subscription to the toggle it has no way
        // to reach (AGENTS.md §13 Phase 4.0). `scheduleContent` is already
        // fully server-rendered JSX — the gate only picks which finished
        // subtree to mount, and never re-renders `groupDancesByDay` itself.
        <DemoVisibilityGate empty={emptyState}>{scheduleContent}</DemoVisibilityGate>
      ) : (
        scheduleContent
      )}
    </div>
  );
}
