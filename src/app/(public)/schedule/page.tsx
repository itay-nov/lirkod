import { DemoVisibilityGate } from "@/components/DemoVisibilityGate";
import { ScheduleDistanceFilter } from "@/components/ScheduleDistanceFilter";
import { ScheduleList, type ScheduleDayGroup } from "@/components/ScheduleList";
import { anonClient } from "@/lib/db/client";
import { findDancesNear } from "@/lib/db/dances";
import { findActivePromotedEventIds } from "@/lib/db/promotions";
import { DEFAULT_LAT, DEFAULT_LNG } from "@/lib/domain/defaultRegion";
import { danceFiltersLabels } from "@/lib/domain/danceFiltersLabels";
import { distanceRadiusFromSearchParam } from "@/lib/domain/distanceFilter";
import { distanceFilterLabels } from "@/lib/domain/distanceFilterLabels";
import { formatDayHeading } from "@/lib/domain/occurrenceTime";
import { boostPromotedWithinDay } from "@/lib/domain/promotedBoost";
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
  const client = anonClient();

  // Errors are not caught here on purpose — a failed read must surface, not
  // render as an empty schedule (AGENTS.md §6). That applies to the promotions
  // read too: it is one extra round trip, so the two are issued together rather
  // than in series, and a failure of either is a failed page rather than a
  // schedule that quietly loses its ordering.
  const [dances, promotedEventIds] = await Promise.all([
    findDancesNear(client, DEFAULT_LAT, DEFAULT_LNG, radiusMeters),
    findActivePromotedEventIds(client),
  ]);

  const days = groupDancesByDay(dances);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  const emptyState = <p className="pt-4">{he.schedule.empty}</p>;

  // Headings are formatted here, server-side (formatDayHeading uses Intl —
  // see its own note) — ScheduleList (Phase 4.6b) only filters and renders
  // the already-complete MapDance[] this produces, the same discipline
  // toMapDances/MapDance follow for the map (docs/decisions/0007).
  //
  // The promotion boost is applied HERE, and only here.
  //
  // Not in find_dances_near: the map calls the same RPC ((public)/page.tsx and
  // the "near me" route handler), and the confirmed product decision is that
  // the map's order does not change. Pushing the boost into the shared query
  // would move both, with nothing at either call site to say so.
  //
  // Not before grouping either: a dance sorted ninety minutes earlier could
  // cross midnight into the previous day's group and render under yesterday's
  // heading. Boosting inside the group bounds it to the day it belongs to.
  //
  // The heading still reads `day.dances[0]` — the group BEFORE the boost, whose
  // first entry is the earliest night of that day. A heading is a date either
  // way, but taking it from the unreordered tuple keeps it independent of who
  // paid for placement.
  const dayGroups: ScheduleDayGroup[] = days.map((day) => {
    const heading = formatDayHeading(day.dances[0].startsAt);
    return {
      dayKey: day.dayKey,
      heading,
      dayListLabel: he.schedule.dayListLabel(heading),
      dances: toMapDances(boostPromotedWithinDay(day.dances, promotedEventIds)),
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
