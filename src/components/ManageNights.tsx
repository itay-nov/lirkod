import type { ManageableNight } from "@/lib/domain/manageNight";
import { NightControls } from "./NightControls";
import { he } from "@/lib/i18n/he";

/**
 * An instructor's upcoming nights, each with its own controls.
 *
 * A Server Component wrapping a client one per row: the list, the dates and the
 * status badges render on the server and ship no JavaScript, and only the
 * controls — which need state — cross into the browser (AGENTS.md §2.9).
 *
 * Deliberately a flat list of NIGHTS rather than a list of series with nights
 * nested under them. A מרקיד cancelling tonight is not thinking about which
 * pattern produced it; they are thinking "the one on Monday". Grouping would add
 * a level to walk through for the case this screen exists for, and 3.3a's
 * generator means most instructors will have one or two series and a lot of
 * nights.
 */
export function ManageNights({ nights }: { nights: readonly ManageableNight[] }) {
  return (
    <section className="pt-8">
      <h2 className="font-display text-2xl font-black">{he.manageNights.heading}</h2>
      <p className="pt-4">{he.manageNights.intro}</p>

      {nights.length === 0 ? (
        <p className="pt-4">{he.manageNights.empty}</p>
      ) : (
        <ul aria-label={he.manageNights.listLabel} className="flex flex-col gap-4 pt-4">
          {nights.map((night) => (
            <li
              key={night.id}
              className="rounded-2xl border-2 border-muted/50 p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-lg font-bold">{night.time}</span>
                <span className="font-semibold">{night.dayText}</span>
                {night.statusLabel !== null && (
                  <span
                    className={`rounded-full px-3 py-1 font-bold ${night.statusBadgeClassName}`}
                  >
                    {night.statusLabel}
                  </span>
                )}
              </div>

              <p className="text-secondary">{night.venueName}</p>

              {/* The reason is shown back to the instructor, because it is what
                  every dancer is being told and they should be able to see it. */}
              {night.cancellationText !== null && (
                <p className="pt-1">{night.cancellationText}</p>
              )}

              <NightControls night={night} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
