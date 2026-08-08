import { DanceRow } from "@/components/DanceRow";
import { anonClient } from "@/lib/db/client";
import { findDancesNear } from "@/lib/db/dances";
import {
  DEFAULT_LAT,
  DEFAULT_LNG,
  DEFAULT_RADIUS_METERS,
} from "@/lib/domain/defaultRegion";
import { formatDayHeading } from "@/lib/domain/occurrenceTime";
import { groupDancesByDay } from "@/lib/domain/scheduleDays";
import { he } from "@/lib/i18n/he";

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
export default async function SchedulePage() {
  // Errors are not caught here on purpose — a failed read must surface, not
  // render as an empty schedule (AGENTS.md §6).
  const dances = await findDancesNear(
    anonClient(),
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEFAULT_RADIUS_METERS,
  );

  const days = groupDancesByDay(dances);

  return (
    <div className="px-4 pb-8 pt-5">
      <h1 className="font-display text-3xl font-black">{he.schedule.heading}</h1>

      {days.length === 0 ? (
        <p className="pt-4">{he.schedule.empty}</p>
      ) : (
        days.map((day) => {
          const heading = formatDayHeading(day.dances[0].startsAt);

          return (
            <section key={day.dayKey} className="pt-6">
              {/*
                A real heading, not a styled div: the day headers are how a
                screen reader user skims this screen, and heading navigation
                only reaches actual heading elements.
              */}
              <h2 className="border-b-2 border-muted pb-1 font-display text-xl font-bold">
                {heading}
              </h2>

              <ul aria-label={he.schedule.dayListLabel(heading)} className="pt-2">
                {day.dances.map((dance) => (
                  <li key={dance.occurrenceId}>
                    <DanceRow dance={dance} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
